import Phaser from 'phaser';
import { GAME_WIDTH } from '../../config';
import { vibrate } from '../../core/haptics';
import { homeScene } from '../../core/home';
import { sfx } from '../../core/sfx';
import { addText, fadeToScene } from '../../core/ui';
import { knownDayRank, noteDayScore, syncScores } from '../../online/online';
import { floatText, showBanner } from '../../scenes/GameHud';
import { MiniGameScene, type ResultStat } from '../../scenes/MiniGameScene';
import { CARD_H, CARD_W, cardTexture, PX, PX_CSS, registerPyramidTextures, TEX } from './art';
import { PYRAMID_GAME_ID, PYRAMID_SCENE } from './data';
import { addDailyRun, boardDayOf, dailySeed, dayIndexOf, dayLabel, freeSeed, recordOn } from './daily';
import { pyramidDailyStore } from './daily-store';
import { openRankView, type RankView } from './rank-view';
import {
  availableMoves,
  canClear,
  canRecycle,
  cardAt,
  clearPoints,
  clearSpots,
  deal,
  drawCard,
  finishBonus,
  isCleared,
  isFree,
  isStuck,
  PASSES,
  PYRAMID_SIZE,
  pyramidLeft,
  sameSpot,
  slotCenter,
  type Board,
  type Card,
  type Spot,
} from './rules';
import { PYRAMID_TEXT as T, timeLabel } from './text';
import { addRowButton, drawSky } from './view';

/** 씬을 시작할 때 넘기는 값. 없으면 준비 화면부터 연다. */
export interface PyramidStart {
  mode?: 'daily' | 'free';
}

type Phase = 'lobby' | 'play' | 'over';

/**
 * 카드 사이는 띄우지 않는다. 띄우면 그 틈으로 윗줄 카드의 아래쪽 그림이 비쳐 보인다.
 * 카드마다 한 칸짜리 검은 테두리가 있어서 붙여 놓아도 낱장으로 보인다.
 */
const CARD = { width: CARD_W, height: CARD_H, gap: 0, step: 20 } as const;
/** 피라미드의 높이: 여섯 번 내려가고 맨 아랫줄의 카드 한 장 */
const PYRAMID_HEIGHT = 6 * CARD.step + CARD.height;
/** 위쪽 줄의 높이 */
const TOP_BAR = 40;
/** 피라미드 아래의 더미 줄까지의 간격 */
const PILE_GAP = 14;
/** 판 전체(피라미드, 더미 줄, 안내 줄, 힌트 버튼)의 높이 */
const PLAY_HEIGHT = PYRAMID_HEIGHT + PILE_GAP + CARD.height + 50;
/** 덮인 카드에 거는 색. 고를 수 있는 카드와 한눈에 가려진다. */
const COVERED_TINT = 0x8890a8;
/** 카드를 치운 뒤 사라지는 시간(ms) */
const VANISH_MS = 160;

const DEPTH = { sky: -10, card: 10, mark: 30, effect: 40, ui: 50, banner: 60, overlay: 80 } as const;

/**
 * 피라미드: 일곱 줄로 쌓인 카드에서 합이 13인 두 장을 골라 치운다. K는 혼자 치운다.
 * 짝이 없으면 더미에서 한 장씩 넘겨 맨 위 카드와 맞춘다. 더미는 세 번까지 넘길 수 있다.
 * 피라미드를 다 치우거나 더 둘 곳이 없으면 끝나고, 일시정지 화면에서 지금 점수로 끝낼 수도 있다.
 * 준비 화면에서 오늘의 판(모두 같은 카드, 오늘의 랭킹)과 자유 판(매번 새로 섞은 카드)을 고른다.
 * 규칙은 rules.ts가 맡고, 이 씬은 판을 그리고 누른 것을 규칙에 넘긴다.
 */
export class PyramidScene extends MiniGameScene {
  protected readonly gameId = PYRAMID_GAME_ID;

  private phase: Phase = 'lobby';
  private mode: 'daily' | 'free' = 'free';
  /** 오늘의 판이면 그 판의 날 */
  private day: number | null = null;
  /** 지금 판. 자동 점검이 들여다본다. */
  board: Board | null = null;
  private selected: Spot | null = null;
  private slotViews: (Phaser.GameObjects.Image | null)[] = [];
  private pileObjects: Phaser.GameObjects.GameObject[] = [];
  private marks!: Phaser.GameObjects.Graphics;
  private hintMarks!: Phaser.GameObjects.Graphics;
  private hintTimer: Phaser.Time.TimerEvent | null = null;
  private scoreText!: Phaser.GameObjects.Text;
  private timeText!: Phaser.GameObjects.Text;
  private chainText!: Phaser.GameObjects.Text;
  private area = new Phaser.Geom.Rectangle();
  private top = 0;
  private pileY = 0;
  private score = 0;
  private chain = 0;
  private maxChain = 0;
  private removed = 0;
  private elapsed = 0;
  /** 판에서 무엇이든 눌렀는지. 오늘의 판을 나갈 때 알릴지 정하는 데만 쓴다(시계는 판이 깔리면 바로 간다). */
  private touched = false;
  private rankView: RankView | null = null;

  constructor() {
    super(PYRAMID_SCENE);
  }

  create(data: PyramidStart = {}): void {
    // Phaser는 값 없이 다시 시작하면 지난번 값을 그대로 넘긴다. "처음부터 다시"가 준비 화면으로 가도록 비워 둔다.
    this.sys.settings.data = {};
    this.beginMiniGame();
    registerPyramidTextures(this);
    this.cameras.main.setBackgroundColor(PX_CSS.dark);
    drawSky(this, DEPTH.sky);
    this.board = null;
    this.selected = null;
    this.slotViews = [];
    this.pileObjects = [];
    this.hintTimer = null;
    this.rankView = null;
    this.score = 0;
    this.chain = 0;
    this.maxChain = 0;
    this.removed = 0;
    this.elapsed = 0;
    this.touched = false;

    if (data.mode === 'daily' || data.mode === 'free') this.startPlay(data.mode);
    else {
      this.phase = 'lobby';
      this.offerRuleBook(() => this.phase === 'lobby' && !this.rankView);
      void pyramidDailyStore.load().then(() => {
        if (this.sys.isActive() && this.phase === 'lobby' && !this.rankView) this.openLobby();
      });
    }
  }

  override update(_time: number, deltaMs: number): void {
    // 카드가 다 앞면이라 누르기 전에 수를 다 생각해 둘 수 있다. 그래서 첫 탭이 아니라 판이 깔리고 두기 시작할 때부터 잰다.
    if (this.phase !== 'play' || !this.playing) return;
    // 탭이 가려졌다 돌아와도 시간이 한꺼번에 흐르지 않게 한 프레임의 길이를 제한한다.
    this.elapsed += Math.min(deltaMs, 100) / 1000;
    this.timeText.setText(timeLabel(this.elapsed));
  }

  // ───────── 준비 화면 ─────────

  private lobbyObjects: Phaser.GameObjects.GameObject[] = [];

  private openLobby(): void {
    for (const object of this.lobbyObjects) object.destroy();
    this.lobbyObjects = [];
    const { height } = this.scale;
    const today = dayIndexOf(new Date());
    const record = recordOn(pyramidDailyStore.data, today);
    const rank = knownDayRank(PYRAMID_GAME_ID, today);
    const contentHeight = 300;
    const top = Math.max(24, Math.round((height - contentHeight) / 2) - 10);
    const left = 16;
    const width = GAME_WIDTH - 32;
    const add = <T extends Phaser.GameObjects.GameObject>(object: T): T => {
      this.lobbyObjects.push(object);
      return object;
    };

    // 오른쪽 위: 규칙을 모르는 사람을 위한 안내서. 처음 하는 사람에게는 한 번 저절로 열린다.
    for (const object of addRowButton(this, { x: GAME_WIDTH - 8 - 46, y: 8, width: 46, height: 26, title: T.ruleBook, center: true, onTap: () => this.openRuleBook() })) {
      add(object);
    }
    add(this.add.image(GAME_WIDTH / 2, top + 27, TEX.emblem));
    add(addText(this, GAME_WIDTH / 2, top + 66, T.title, { size: 24, color: PX_CSS.accent, originX: 0.5 }));
    add(addText(this, GAME_WIDTH / 2, top + 98, T.tagline, { size: 11, color: PX_CSS.text, originX: 0.5 }));
    add(addText(this, GAME_WIDTH / 2, top + 114, T.rule, { size: 10, color: PX_CSS.sub, originX: 0.5 }));

    let y = top + 140;
    const row = (options: Omit<Parameters<typeof addRowButton>[1], 'x' | 'width'>): void => {
      for (const object of addRowButton(this, { x: left, width, ...options })) add(object);
    };
    row({
      y,
      height: 40,
      title: T.daily,
      note: `${dayLabel(today)} · ${T.dailyNote}`,
      side: record.plays > 0 ? T.dailyBest(record.best) : T.dailyNew,
      fill: PX.navy,
      border: PX.yellow,
      onTap: () => this.scene.restart({ mode: 'daily' } satisfies PyramidStart),
    });
    y += 48;
    row({
      y,
      height: 40,
      title: T.free,
      note: T.freeNote,
      onTap: () => this.scene.restart({ mode: 'free' } satisfies PyramidStart),
    });
    y += 48;
    row({
      y,
      height: 40,
      title: T.rank,
      note: T.rankNote,
      side: rank !== null ? T.rankMine(rank) : undefined,
      sideColor: PX_CSS.sky,
      onTap: () => this.openRank(),
    });
    y += 52;
    row({ y, height: 28, title: T.back, center: true, onTap: () => fadeToScene(this, homeScene()) });
  }

  private openRank(): void {
    if (this.rankView) return;
    const today = dayIndexOf(new Date());
    this.rankView = openRankView(this, DEPTH.overlay, today, () => {
      this.rankView = null;
      // 랭킹을 보고 나면 내 순위가 바뀌었을 수 있어서 준비 화면을 다시 그린다.
      if (this.phase === 'lobby' && this.sys.isActive()) this.openLobby();
    });
  }

  /** 준비 화면에서는 뒤로 가기가 허브로 나가고(랭킹 창이 열려 있으면 창을 닫는다), 판을 하는 동안에는 일시정지한다. */
  override onBackRequest(): void {
    if (this.phase !== 'lobby') {
      this.pauseGame();
      return;
    }
    if (this.rankView) {
      this.rankView.destroy();
      this.rankView = null;
      this.openLobby();
      return;
    }
    fadeToScene(this, homeScene());
  }

  protected override pauseGame(): void {
    if (this.phase !== 'play') return;
    super.pauseGame();
  }

  protected override restartLabel(): string | null {
    return '처음 화면으로';
  }

  protected override retryData(): object | undefined {
    return { mode: this.mode } satisfies PyramidStart;
  }

  protected override canFinishEarly(): boolean {
    return this.phase === 'play' && this.board !== null;
  }

  protected override finishEarly(): void {
    this.endGame(null);
  }

  protected override quitWarning(): string | null {
    return this.mode === 'daily' && this.touched ? T.quitDaily : null;
  }

  /**
   * 오늘의 판은 카드 순서가 정해져 있어서 다시 할수록 유리하다. 그래서 여느 판과 같은 최고 기록과 전체 랭킹에 넣지 않고
   * 그날의 기록과 오늘의 랭킹에만 남긴다. 날이 넘어간 뒤에 마친 판은 어디에도 넣지 않는다.
   */
  protected override offRecordNote(): string | null {
    if (this.mode !== 'daily') return null;
    return boardDayOf(this.day, Date.now()) !== null ? T.offRecordToday : T.offRecordPast;
  }

  // ───────── 판 ─────────

  private startPlay(mode: 'daily' | 'free'): void {
    this.phase = 'play';
    this.mode = mode;
    this.day = mode === 'daily' ? dayIndexOf(new Date()) : null;
    const seed = this.day !== null ? dailySeed(this.day) : freeSeed();
    const board = deal(seed);
    this.board = board;

    const { height } = this.scale;
    this.top = TOP_BAR + Math.max(4, Math.round((height - TOP_BAR - PLAY_HEIGHT) / 2) - 6);
    this.pileY = this.top + PYRAMID_HEIGHT + PILE_GAP + CARD.height / 2;
    this.area.setTo(0, TOP_BAR, GAME_WIDTH, height - TOP_BAR);

    this.addPauseButton();
    const bar = this.add.graphics().setDepth(DEPTH.ui - 1);
    bar.fillStyle(PX.ink, 0.6).fillRect(0, 0, GAME_WIDTH, TOP_BAR - 4);
    addText(this, 42, 9, mode === 'daily' ? T.daily : T.free, { size: 12, color: mode === 'daily' ? PX_CSS.accent : PX_CSS.text }).setDepth(DEPTH.ui);
    this.timeText = addText(this, 42, 24, timeLabel(0), { size: 10, color: PX_CSS.sub }).setDepth(DEPTH.ui);
    this.scoreText = addText(this, GAME_WIDTH - 10, 18, '0', { size: 20, color: PX_CSS.text, originX: 1, originY: 0.5 }).setDepth(DEPTH.ui);
    this.chainText = addText(this, GAME_WIDTH - 10, 34, '', { size: 9, color: PX_CSS.accent, originX: 1, originY: 0.5 }).setDepth(DEPTH.ui);

    this.marks = this.add.graphics().setDepth(DEPTH.mark);
    this.hintMarks = this.add.graphics().setDepth(DEPTH.mark);

    // 피라미드: 아래 줄이 윗줄을 덮도록 번호 순서대로 쌓는다(번호가 클수록 아래 줄).
    for (let slot = 0; slot < PYRAMID_SIZE; slot += 1) {
      const card = board.pyramid[slot] as Card;
      const { x, y } = slotCenter(slot, GAME_WIDTH / 2, this.top, CARD);
      const image = this.add.image(x, y, cardTexture(card)).setDepth(DEPTH.card + slot * 0.01).setScale(0);
      this.tweens.add({ targets: image, scale: 1, duration: 120, delay: slot * 14, ease: 'Back.Out' });
      this.slotViews.push(image);
    }

    const hintY = this.pileY + CARD.height / 2 + 26;
    addRowButton(this, {
      x: GAME_WIDTH / 2 - 40,
      y: hintY,
      width: 80,
      height: 22,
      title: T.hint,
      center: true,
      depth: DEPTH.ui,
      onTap: () => this.showHint(),
    });

    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    this.drawPiles();
    this.refresh();
    sfx.flip();
    this.time.delayedCall(PYRAMID_SIZE * 14 + 160, () => {
      if (this.phase !== 'play') return;
      showBanner(this, this.top + PYRAMID_HEIGHT / 2, T.start, PX_CSS.accent, 900, DEPTH.banner);
      this.playing = true;
    });
  }

  private stockPos(): { x: number; y: number } {
    return { x: GAME_WIDTH / 2 - 24, y: this.pileY };
  }

  private wastePos(): { x: number; y: number } {
    return { x: GAME_WIDTH / 2 + 24, y: this.pileY };
  }

  /** 더미와 버린 카드 더미를 다시 그린다. */
  private drawPiles(): void {
    const board = this.board;
    if (!board) return;
    for (const object of this.pileObjects) object.destroy();
    this.pileObjects = [];
    const stock = this.stockPos();
    const waste = this.wastePos();
    const put = <T extends Phaser.GameObjects.GameObject>(object: T): T => {
      this.pileObjects.push(object);
      return object;
    };
    const labelY = this.pileY + CARD.height / 2 + 10;

    if (board.stock.length > 0) {
      // 남은 장수만큼 두께를 준다.
      const layers = Math.min(3, Math.ceil(board.stock.length / 8));
      for (let i = layers - 1; i >= 0; i -= 1) put(this.add.image(stock.x - i, stock.y - i, TEX.back).setDepth(DEPTH.card));
    } else {
      put(this.add.image(stock.x, stock.y, TEX.slot).setDepth(DEPTH.card));
      const recycle = canRecycle(board);
      put(
        addText(this, stock.x, stock.y, recycle ? T.recycle : T.stockEmpty, {
          size: 11,
          color: recycle ? PX_CSS.sky : PX_CSS.faint,
          originX: 0.5,
          originY: 0.5,
        }).setDepth(DEPTH.card + 1),
      );
    }

    const top = board.waste.at(-1);
    const under = board.waste.at(-2);
    if (!top) put(this.add.image(waste.x, waste.y, TEX.slot).setDepth(DEPTH.card));
    if (under) put(this.add.image(waste.x + 3, waste.y - 2, cardTexture(under)).setDepth(DEPTH.card).setTint(COVERED_TINT));
    if (top) put(this.add.image(waste.x, waste.y, cardTexture(top)).setDepth(DEPTH.card + 0.5));
    // 더미의 남은 장수와 다시 돌릴 수 있는 횟수를 한 줄로 적는다.
    const passesLeft = PASSES - board.pass;
    put(
      addText(this, GAME_WIDTH / 2, labelY, `${T.stockLeft(board.stock.length)} · ${passesLeft > 0 ? T.passesLeft(passesLeft) : T.noPasses}`, {
        size: 10,
        color: passesLeft > 0 ? PX_CSS.sub : PX_CSS.bad,
        originX: 0.5,
        originY: 0.5,
      }).setDepth(DEPTH.ui),
    );
  }

  /** 고를 수 있는 카드와 고른 카드의 표시를 맞춘다. */
  private refresh(): void {
    const board = this.board;
    if (!board) return;
    this.slotViews.forEach((view, slot) => {
      if (!view) return;
      if (isFree(board, slot)) view.clearTint();
      else view.setTint(COVERED_TINT);
    });
    this.marks.clear();
    if (this.selected) this.markSpot(this.marks, this.selected, PX.yellow);
    this.scoreText.setText(String(this.score));
    this.chainText.setText(this.chain >= 2 ? T.chain(this.chain) : '');
  }

  private spotCenter(spot: Spot): { x: number; y: number } {
    return spot.kind === 'waste' ? this.wastePos() : slotCenter(spot.slot, GAME_WIDTH / 2, this.top, CARD);
  }

  private markSpot(graphics: Phaser.GameObjects.Graphics, spot: Spot | 'stock', color: number): void {
    const { x, y } = spot === 'stock' ? this.stockPos() : this.spotCenter(spot);
    const left = x - CARD.width / 2 - 2;
    const top = y - CARD.height / 2 - 2;
    graphics.fillStyle(color, 1);
    // 네 변을 2px 두께로 두른다.
    graphics.fillRect(left, top, CARD.width + 4, 2);
    graphics.fillRect(left, top + CARD.height + 2, CARD.width + 4, 2);
    graphics.fillRect(left, top, 2, CARD.height + 4);
    graphics.fillRect(left + CARD.width + 2, top, 2, CARD.height + 4);
  }

  /** 누른 자리의 카드. 아래 줄이 위에 그려지므로 아래 줄부터 본다. */
  private spotAt(x: number, y: number): Spot | 'stock' | { covered: number } | null {
    const inside = (center: { x: number; y: number }): boolean =>
      Math.abs(x - center.x) <= CARD.width / 2 + 1 && Math.abs(y - center.y) <= CARD.height / 2 + 1;
    if (inside(this.stockPos())) return 'stock';
    if (inside(this.wastePos())) return { kind: 'waste' };
    const board = this.board;
    if (!board) return null;
    for (let slot = PYRAMID_SIZE - 1; slot >= 0; slot -= 1) {
      if (board.pyramid[slot] === null) continue;
      if (inside(slotCenter(slot, GAME_WIDTH / 2, this.top, CARD))) {
        return isFree(board, slot) ? { kind: 'pyramid', slot } : { covered: slot };
      }
    }
    return null;
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.phase !== 'play' || !this.playing || !this.board) return;
    // 카메라가 화면을 확대해 그리므로 화면 좌표가 아니라 게임 좌표로 본다.
    const hit = this.spotAt(pointer.worldX, pointer.worldY);
    if (hit === null) return;
    this.touched = true;
    this.clearHint();
    if (hit === 'stock') {
      this.draw();
      return;
    }
    if ('covered' in hit) {
      // 덮인 카드는 고를 수 없다. 살짝 흔들어 알린다.
      const view = this.slotViews[hit.covered];
      if (view) this.tweens.add({ targets: view, x: view.x + 2, duration: 40, yoyo: true, repeat: 1 });
      sfx.miss();
      return;
    }
    this.pick(hit);
  }

  private pick(spot: Spot): void {
    const board = this.board as Board;
    const card = cardAt(board, spot);
    if (!card) return;
    if (canClear([card])) {
      this.selected = null;
      this.clear([spot]);
      return;
    }
    const selected = this.selected;
    if (selected && sameSpot(selected, spot)) {
      this.selected = null;
      sfx.flip();
    } else if (selected && canClear([cardAt(board, selected) as Card, card])) {
      this.selected = null;
      this.clear([selected, spot]);
      return;
    } else {
      if (selected) {
        vibrate(10);
        sfx.miss();
      } else sfx.flip();
      this.selected = spot;
    }
    this.refresh();
  }

  /** 그 카드들을 치우고 점수를 더한다. */
  private clear(spots: readonly Spot[]): void {
    const board = this.board as Board;
    const centers = spots.map((spot) => this.spotCenter(spot));
    const slots = spots.flatMap((spot) => (spot.kind === 'pyramid' ? [spot.slot] : []));
    if (!clearSpots(board, spots)) return;
    this.chain += 1;
    this.maxChain = Math.max(this.maxChain, this.chain);
    this.removed += spots.length;
    const points = clearPoints(slots.length, spots.length - slots.length, this.chain);
    this.score += points;

    for (const slot of slots) {
      const view = this.slotViews[slot];
      this.slotViews[slot] = null;
      if (!view) continue;
      this.tweens.add({
        targets: view,
        scale: 1.15,
        alpha: 0,
        y: view.y - 6,
        duration: VANISH_MS,
        ease: 'Quad.Out',
        onComplete: () => view.destroy(),
      });
    }
    if (spots.some((spot) => spot.kind === 'waste')) this.drawPiles();
    const last = centers[centers.length - 1];
    floatText(this, last.x, last.y - CARD.height / 2, `+${points}`, PX_CSS.accent, this.area, DEPTH.effect);
    this.sparkle(centers);
    sfx.hit(Math.min(this.chain, 8));
    vibrate(12);
    this.refresh();
    this.checkEnd();
  }

  /** 치운 자리에 작은 네모 불꽃을 튀긴다. */
  private sparkle(centers: readonly { x: number; y: number }[]): void {
    const colors = [PX.yellow, PX.cyan, PX.white, PX.lime];
    for (const { x, y } of centers) {
      for (let i = 0; i < 6; i += 1) {
        const angle = (Math.PI * 2 * i) / 6 + Math.random() * 0.5;
        const bit = this.add.rectangle(x, y, 3, 3, colors[i % colors.length]).setDepth(DEPTH.effect);
        this.tweens.add({
          targets: bit,
          x: x + Math.cos(angle) * 22,
          y: y + Math.sin(angle) * 22,
          alpha: 0,
          duration: 320,
          ease: 'Quad.Out',
          onComplete: () => bit.destroy(),
        });
      }
    }
  }

  /** 더미를 누르면 한 장 넘기거나, 다 넘겼으면 다시 돌린다. 이어 치우기가 끊긴다. */
  private draw(): void {
    const board = this.board as Board;
    const outcome = drawCard(board);
    if (outcome === 'none') {
      sfx.miss();
      vibrate(10);
      return;
    }
    this.chain = 0;
    if (this.selected?.kind === 'waste') this.selected = null;
    sfx.flip();
    this.drawPiles();
    const top = this.pileObjects.find(
      (object): object is Phaser.GameObjects.Image =>
        object instanceof Phaser.GameObjects.Image && object.x === this.wastePos().x && object.y === this.wastePos().y,
    );
    if (outcome === 'drew' && top) {
      const from = this.stockPos();
      top.setPosition(from.x, from.y).setScale(0.2, 1);
      this.tweens.add({ targets: top, x: this.wastePos().x, scaleX: 1, duration: 120, ease: 'Quad.Out' });
    }
    this.refresh();
    this.checkEnd();
  }

  private clearHint(): void {
    this.hintTimer?.remove();
    this.hintTimer = null;
    this.hintMarks?.clear();
  }

  /** 지금 치울 수 있는 짝 하나를 잠깐 보여 준다. 없으면 더미를 가리킨다. */
  private showHint(): void {
    const board = this.board;
    if (this.phase !== 'play' || !this.playing || !board) return;
    this.clearHint();
    const move = availableMoves(board)[0];
    const at = this.stockPos();
    if (move) for (const spot of move) this.markSpot(this.hintMarks, spot, PX.cyan);
    else if (board.stock.length > 0 || canRecycle(board)) {
      this.markSpot(this.hintMarks, 'stock', PX.cyan);
      floatText(this, at.x, at.y - CARD.height / 2, T.hintDraw, PX_CSS.sky, this.area, DEPTH.effect);
    } else floatText(this, GAME_WIDTH / 2, this.pileY, T.hintNone, PX_CSS.bad, this.area, DEPTH.effect);
    this.hintTimer = this.time.delayedCall(1400, () => this.clearHint());
  }

  private checkEnd(): void {
    const board = this.board as Board;
    if (isCleared(board)) this.endGame('cleared');
    else if (isStuck(board)) this.endGame('stuck');
  }

  // ───────── 끝 ─────────

  private endGame(reason: 'cleared' | 'stuck' | null): void {
    const board = this.board;
    if (!board || this.phase !== 'play') return;
    this.phase = 'over';
    this.playing = false;
    this.clearHint();
    this.selected = null;
    this.marks.clear();
    const bonus = finishBonus(board, this.elapsed);
    this.score += bonus;
    this.scoreText.setText(String(this.score));
    if (reason === 'cleared') {
      sfx.gold();
      vibrate([15, 30, 15]);
      showBanner(this, this.top + PYRAMID_HEIGHT / 2, T.cleared, PX_CSS.good, 1100, DEPTH.banner);
      floatText(this, GAME_WIDTH / 2, this.top + PYRAMID_HEIGHT / 2 + 30, `+${bonus}`, PX_CSS.accent, this.area, DEPTH.banner);
    } else if (reason === 'stuck') {
      showBanner(this, this.top + PYRAMID_HEIGHT / 2, T.stuck, PX_CSS.bad, 1100, DEPTH.banner);
    }
    const stats: ResultStat[] = [
      [T.statCleared, `${this.removed}장`],
      [T.statLeft, `${pyramidLeft(board)}장`],
      [T.statChain, String(this.maxChain)],
      [T.statTime, timeLabel(this.elapsed)],
    ];
    const daily = this.recordDaily(isCleared(board));
    if (daily) stats.unshift([T.statDaily, daily]);
    this.finishMiniGame(this.score, stats, reason === null ? 300 : 1300);
  }

  /**
   * 끝난 판이 오늘 시작한 오늘의 판이면 그날의 기록에 보태고 오늘의 랭킹에 올린 뒤, 결과 화면에 적을 말을 돌려준다.
   * 오늘의 판은 최고 기록과 전체 랭킹에 들지 않아서(offRecordNote) 판을 마칠 때의 올리기가 없다. 그래서 여기서 바로 올린다.
   */
  private recordDaily(cleared: boolean): string | null {
    const day = boardDayOf(this.day, Date.now());
    if (this.mode !== 'daily' || day === null) return null;
    const outcome = addDailyRun(pyramidDailyStore.data, day, this.score, cleared);
    pyramidDailyStore.set(outcome.record);
    if (this.score > 0) {
      noteDayScore(this.gameId, this.score, day);
      void syncScores();
    }
    return outcome.newBest ? T.dailyNewBest : T.dailyRecord(outcome.record.best);
  }
}
