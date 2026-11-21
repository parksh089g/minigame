import Phaser from 'phaser';
import { GAME_WIDTH } from '../../config';
import { vibrate } from '../../core/haptics';
import { homeScene } from '../../core/home';
import { sfx } from '../../core/sfx';
import { store } from '../../core/store';
import { addText, fadeToScene, PixelButton } from '../../core/ui';
import { noteDayScore, syncScores } from '../../online/online';
import { showBanner } from '../../scenes/GameHud';
import { MiniGameScene, type ResultStat } from '../../scenes/MiniGameScene';
import { CARD_H, CARD_W, faceTexture, foundationTexture, PX, PX_CSS, registerSolitaireTextures, TEX } from './art';
import { DAILY_TEXT, dailyDeal, dayBestOf, dayIndexOf, dayLabel, freshDeal } from './daily';
import { addRankPage } from './rank-page';
import {
  applyMove,
  autoTarget,
  canAutoFinish,
  cardId,
  COLUMNS,
  drawStock,
  finalScore,
  foundCount,
  hasUsefulMove,
  isLegal,
  isWon,
  nextFoundationMove,
  pickUp,
  SOLITAIRE_GAME_ID,
  SOLITAIRE_SCENE,
  timeBonus,
  undoPenalty,
  POINTS,
  type Board,
  type Card,
  type Move,
  type Pile,
} from './rules';

/** 씬을 시작할 때 넘기는 값. 없으면 시작 화면부터 연다. */
export interface SolitaireStart {
  /** play면 바로 새 판을, rank면 오늘의 랭킹을 연다. */
  mode?: 'play' | 'rank';
  /** play일 때 오늘의 판인지 */
  daily?: boolean;
}

type Phase = 'lobby' | 'rank' | 'play' | 'over';

const SIDE = 6;
const GAP = 3;
const TOP_BAR = 34;
/** 더미, 버림 칸, 모음 칸이 놓이는 줄의 위쪽 */
const ROW_Y = 40;
/** 일곱 줄이 시작하는 위쪽 */
const TAB_Y = ROW_Y + CARD_H + 8;
/** 줄에 겹친 카드끼리의 간격: 뒷면, 앞면. 줄이 길어 화면을 넘으면 앞면 간격부터 줄인다. */
const STEP = { down: 4, up: 13, minDown: 3, minUp: 7 } as const;
/** 버림 칸에서 부채꼴로 펼쳐 보이는 장 수와 그 간격 */
const WASTE_FAN = { shown: 3, step: 8 } as const;
/** 이만큼 움직이면 끌기로 본다 */
const DRAG_START = 5;
/** 되돌리기에 남겨 두는 판의 수 */
const HISTORY_MAX = 300;
const MOVE_MS = 110;
const AUTO_STEP_MS = 90;

const DEPTH = { felt: -10, slot: 0, card: 10, drag: 500, ui: 600, banner: 700 } as const;

const TEXT = {
  title: '솔리테어',
  intro: '같은 무늬끼리 A부터 K까지 모아요.\n언제나 끝까지 풀 수 있는 판이 나와요.',
  fresh: '새 판',
  daily: '오늘의 판',
  rank: '오늘의 랭킹',
  undo: '되돌리기',
  stuck: '더 둘 수 있는 수가 없어요',
  finish: '끝내기',
  won: '다 모았어요!',
  autoFinish: '남은 카드를 모아요',
} as const;

/** 카드 그림 하나 */
interface CardView {
  image: Phaser.GameObjects.Image;
  x: number;
  y: number;
}

/** 손가락이 집은 것 */
interface Grab {
  from: Pile;
  count: number;
  /** 집은 카드들(위에서부터) */
  ids: number[];
  startX: number;
  startY: number;
  /** 손가락과 맨 위 카드의 왼쪽 위 사이 */
  offsetX: number;
  offsetY: number;
  dragging: boolean;
}

export const colLeft = (column: number): number => SIDE + column * (CARD_W + GAP);
const stockPos = (): { x: number; y: number } => ({ x: colLeft(0), y: ROW_Y });
const wastePos = (): { x: number; y: number } => ({ x: colLeft(1), y: ROW_Y });
const foundationPos = (suit: number): { x: number; y: number } => ({ x: colLeft(3 + suit), y: ROW_Y });

const clock = (seconds: number): string => {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

/**
 * 솔리테어(클론다이크): 카드를 일곱 줄에 나눠 놓고, 같은 무늬끼리 A부터 K까지 모음 칸에 모은다.
 * 카드를 누르면 알맞은 곳으로 알아서 가고, 끌어서 놓을 수도 있다. 되돌리기는 몇 번이든 된다.
 * 시간 제한은 없고, 빨리 다 모을수록 보너스가 크다. 판은 언제나 끝까지 풀 수 있는 것으로 고른다(solver.ts).
 * 오늘의 판은 날마다 누구에게나 같은 판이고, 그 점수는 오늘의 랭킹에 오른다(daily.ts).
 */
export class SolitaireScene extends MiniGameScene {
  protected readonly gameId = SOLITAIRE_GAME_ID;

  private phase: Phase = 'lobby';
  /** 지금 판. 자동 점검이 들여다본다. */
  board: Board | null = null;
  /** 오늘의 판이면 그 날(daily.ts의 dayIndexOf), 여느 판이면 null */
  daily: number | null = null;
  private history: Board[] = [];
  private views = new Map<number, CardView>();
  private grab: Grab | null = null;
  /** 첫 수를 둔 뒤부터 흐른 시간(초) */
  elapsed = 0;
  private started = false;
  private undos = 0;
  private autoFinishing = false;
  private scoreText!: Phaser.GameObjects.Text;
  private timeText!: Phaser.GameObjects.Text;
  private undoButton!: PixelButton;
  private stuckObjects: Phaser.GameObjects.GameObject[] = [];
  private stuckButtons: PixelButton[] = [];
  private highlight!: Phaser.GameObjects.Graphics;

  constructor() {
    super(SOLITAIRE_SCENE);
  }

  create(data: SolitaireStart = {}): void {
    // Phaser는 값 없이 다시 시작하면 지난번 값을 그대로 넘긴다. "처음부터 다시"가 시작 화면으로 가도록 비워 둔다.
    this.sys.settings.data = {};
    this.beginMiniGame();
    registerSolitaireTextures(this);
    this.cameras.main.setBackgroundColor(PX_CSS.dark);
    this.board = null;
    this.daily = null;
    this.history = [];
    this.views = new Map();
    this.grab = null;
    this.elapsed = 0;
    this.started = false;
    this.undos = 0;
    this.autoFinishing = false;
    this.stuckObjects = [];
    this.stuckButtons = [];
    this.drawFelt();

    if (data.mode === 'play') this.startGame(data.daily === true);
    else if (data.mode === 'rank') this.openRank();
    else this.openLobby();
  }

  override update(_time: number, deltaMs: number): void {
    if (this.phase !== 'play' || !this.started || !this.playing) return;
    this.elapsed += Math.min(deltaMs, 100) / 1000;
    this.timeText.setText(clock(this.elapsed));
  }

  /** 시작 화면과 랭킹에서는 뒤로 가기가 나가고, 판을 하는 동안에는 일시정지한다. */
  override onBackRequest(): void {
    if (this.phase === 'lobby') fadeToScene(this, homeScene());
    else if (this.phase === 'rank') this.scene.restart({});
    else this.pauseGame();
  }

  protected override pauseGame(): void {
    if (this.phase !== 'play') return;
    super.pauseGame();
  }

  protected override restartLabel(): string | null {
    return '시작 화면으로';
  }

  protected override quitWarning(): string | null {
    return this.started ? '하던 판은 기록되지 않아요' : null;
  }

  protected override canFinishEarly(): boolean {
    return this.phase === 'play' && this.started;
  }

  protected override finishEarly(): void {
    this.endGame();
  }

  protected override retryData(): SolitaireStart {
    return { mode: 'play', daily: this.daily !== null };
  }

  protected override offRecordNote(): string | null {
    if (this.daily === null) return null;
    return this.daily === dayIndexOf(new Date()) ? DAILY_TEXT.offToday : DAILY_TEXT.offPast;
  }

  // ───────── 바탕 ─────────

  /** 짙은 청록에서 검게 내려가는 계단 그러데이션. 카드 탁자의 천처럼 보인다. */
  private drawFelt(): void {
    const { height } = this.scale;
    const g = this.add.graphics().setDepth(DEPTH.felt);
    const from = Phaser.Display.Color.ValueToColor(0x1d5560);
    const to = Phaser.Display.Color.ValueToColor(0x1a1c2c);
    const bands = 8;
    for (let i = 0; i < bands; i += 1) {
      const mixed = Phaser.Display.Color.Interpolate.ColorWithColor(from, to, bands - 1, i);
      g.fillStyle(Phaser.Display.Color.GetColor(mixed.r, mixed.g, mixed.b), 1);
      g.fillRect(0, Math.floor((height * i) / bands), GAME_WIDTH, Math.ceil(height / bands) + 1);
    }
    // 천의 결: 자리를 고정한 작은 점
    g.fillStyle(0x257179, 0.6);
    for (let i = 0; i < 40; i += 1) {
      const x = (i * 53) % GAME_WIDTH;
      const y = (i * 97) % height;
      g.fillRect(x, y, 1, 1);
    }
  }

  // ───────── 시작 화면 ─────────

  private openLobby(): void {
    this.phase = 'lobby';
    const { height } = this.scale;
    new PixelButton(this, { x: 8, y: 8, width: 26, height: 26, icon: 'icon-back', hitPadding: 6, onTap: () => fadeToScene(this, homeScene()) });
    addText(this, 42, 21, TEXT.title, { size: 16, color: PX_CSS.accent, originY: 0.5 });
    // 규칙을 모르는 사람을 위한 안내서. 처음 하는 사람에게는 한 번 저절로 열린다.
    new PixelButton(this, { x: GAME_WIDTH - 8 - 44, y: 8, width: 44, height: 26, label: '규칙', style: 'yellow', hitPadding: 4, onTap: () => this.openRuleBook() });
    this.offerRuleBook(() => this.phase === 'lobby');

    // 가운데: 부채꼴로 펼친 A 네 장
    const fanY = 64 + (height - 400) * 0.25;
    [0, 1, 2, 3].forEach((suit, index) => {
      const spread = index - 1.5;
      this.add
        .image(GAME_WIDTH / 2 + spread * 34, fanY + CARD_H * 0.75 + Math.abs(spread) * 6, faceTexture({ suit: suit as Card['suit'], rank: 1 }))
        .setScale(1.5)
        .setRotation(spread * 0.16);
    });

    const best = store.data.games[SOLITAIRE_GAME_ID]?.best ?? 0;
    const infoY = fanY + CARD_H * 1.5 + 24;
    this.panel(SIDE + 2, infoY, GAME_WIDTH - (SIDE + 2) * 2, 40);
    addText(this, GAME_WIDTH / 2, infoY + 20, best > 0 ? `최고 ${best}점` : TEXT.intro, {
      size: best > 0 ? 14 : 10,
      color: best > 0 ? PX_CSS.accent : PX_CSS.sub,
      originX: 0.5,
      originY: 0.5,
      align: 'center',
      lineSpacing: 1,
    });

    const today = dayIndexOf(new Date());
    const dayBest = dayBestOf(store.data.online.day, today);
    const width = GAME_WIDTH - 16 * 2;
    const footTop = height - 12 - 36 * 3 - 8 * 2;
    new PixelButton(this, {
      x: 16,
      y: footTop,
      width,
      height: 36,
      label: TEXT.fresh,
      style: 'green',
      onTap: () => this.scene.restart({ mode: 'play' } satisfies SolitaireStart),
    });
    new PixelButton(this, {
      x: 16,
      y: footTop + 44,
      width,
      height: 36,
      label: dayBest > 0 ? `${TEXT.daily} · 오늘 ${dayBest}점` : `${TEXT.daily} · ${dayLabel(today)}`,
      onTap: () => this.scene.restart({ mode: 'play', daily: true } satisfies SolitaireStart),
    });
    new PixelButton(this, {
      x: 16,
      y: footTop + 88,
      width,
      height: 36,
      label: TEXT.rank,
      onTap: () => this.scene.restart({ mode: 'rank' } satisfies SolitaireStart),
    });
  }

  private openRank(): void {
    this.phase = 'rank';
    new PixelButton(this, { x: 8, y: 8, width: 26, height: 26, icon: 'icon-back', hitPadding: 6, onTap: () => this.scene.restart({}) });
    addText(this, 42, 21, TEXT.rank, { size: 16, color: PX_CSS.accent, originY: 0.5 });
    addRankPage(this, dayIndexOf(new Date()), this.scale.height);
  }

  private panel(x: number, y: number, width: number, height: number): Phaser.GameObjects.Graphics {
    const g = this.add.graphics();
    g.fillStyle(PX.ink, 1);
    g.fillRect(x, y + 2, width, height);
    g.fillStyle(PX.panel, 1);
    g.fillRect(x, y, width, height);
    g.lineStyle(1, PX.edge, 1);
    g.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
    return g;
  }

  // ───────── 판 ─────────

  private startGame(daily: boolean): void {
    this.phase = 'play';
    const today = dayIndexOf(new Date());
    this.daily = daily ? today : null;
    this.board = daily ? dailyDeal(today) : freshDeal();

    this.addPauseButton();
    this.scoreText = addText(this, 42, 13, '0점', { size: 14, color: PX_CSS.accent, originY: 0.5 }).setDepth(DEPTH.ui);
    this.timeText = addText(this, 42, 28, '0:00', { size: 9, color: PX_CSS.sub, originY: 0.5 }).setDepth(DEPTH.ui);
    if (daily) {
      addText(this, 74, 28, DAILY_TEXT.name, { size: 9, color: PX_CSS.sky, originY: 0.5 }).setDepth(DEPTH.ui);
    }
    this.undoButton = new PixelButton(this, {
      x: GAME_WIDTH - 8 - 64,
      y: 8,
      width: 64,
      height: 26,
      label: TEXT.undo,
      onTap: () => this.undo(),
    });

    // 빈 자리 그림
    this.add.image(stockPos().x, stockPos().y, TEX.slot).setOrigin(0).setDepth(DEPTH.slot).setName('stock-slot');
    this.add.image(wastePos().x, wastePos().y, TEX.slot).setOrigin(0).setDepth(DEPTH.slot);
    for (let suit = 0; suit < 4; suit += 1) {
      const { x, y } = foundationPos(suit);
      this.add.image(x, y, foundationTexture(suit as Card['suit'])).setOrigin(0).setDepth(DEPTH.slot);
    }
    for (let column = 0; column < COLUMNS; column += 1) {
      this.add.image(colLeft(column), TAB_Y, TEX.slot).setOrigin(0).setDepth(DEPTH.slot);
    }
    this.highlight = this.add.graphics().setDepth(DEPTH.drag + 50);

    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
    this.input.on(Phaser.Input.Events.POINTER_UP, this.onUp, this);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);

    this.render(false);
    this.dealIn();
    this.playing = true;
    this.refreshHud();
  }

  /** 처음에 카드가 더미에서 한 장씩 줄로 날아간다. */
  private dealIn(): void {
    const { x, y } = stockPos();
    let order = 0;
    for (const view of this.views.values()) {
      if (view.x === x && view.y === y) continue;
      view.image.setPosition(x, y);
      this.tweens.add({ targets: view.image, x: view.x, y: view.y, duration: 160, delay: order * 22, ease: 'Quad.Out' });
      order += 1;
    }
    sfx.flip();
  }

  /** 줄 하나의 카드 간격. 화면 아래를 넘지 않게 줄인다. */
  private stepsFor(column: Card[]): { down: number; up: number } {
    const bottom = this.scale.height - 6;
    const room = bottom - TAB_Y - CARD_H;
    const downs = column.filter((card) => !card.up).length;
    const ups = Math.max(0, column.length - downs - 1);
    let down: number = STEP.down;
    let up: number = STEP.up;
    if (downs * down + ups * up > room) {
      up = Math.max(STEP.minUp, Math.floor((room - downs * down) / Math.max(1, ups)));
      if (downs * down + ups * up > room) down = STEP.minDown;
      if (downs * down + ups * up > room) up = Math.max(4, Math.floor((room - downs * down) / Math.max(1, ups)));
    }
    return { down, up };
  }

  /** 판의 카드마다 놓일 자리(왼쪽 위)와 앞뒷면, 겹치는 차례 */
  private layout(board: Board): Map<number, { x: number; y: number; up: boolean; depth: number }> {
    const places = new Map<number, { x: number; y: number; up: boolean; depth: number }>();
    const stock = stockPos();
    board.stock.forEach((card, index) => places.set(cardId(card), { ...stock, up: false, depth: index }));
    const waste = wastePos();
    const fanFrom = Math.max(0, board.waste.length - WASTE_FAN.shown);
    board.waste.forEach((card, index) => {
      const fan = Math.max(0, index - fanFrom);
      places.set(cardId(card), { x: waste.x + fan * WASTE_FAN.step, y: waste.y, up: true, depth: index });
    });
    board.foundations.forEach((pile, suit) => {
      const pos = foundationPos(suit);
      pile.forEach((card, index) => places.set(cardId(card), { ...pos, up: true, depth: index }));
    });
    board.tableau.forEach((column, index) => {
      const steps = this.stepsFor(column);
      let y = TAB_Y;
      column.forEach((card, order) => {
        places.set(cardId(card), { x: colLeft(index), y, up: card.up, depth: order });
        y += card.up ? steps.up : steps.down;
      });
    });
    return places;
  }

  /** 판대로 카드를 놓는다. animate면 옮겨 간 카드가 미끄러져 간다. */
  private render(animate: boolean): void {
    const board = this.board;
    if (!board) return;
    const places = this.layout(board);
    // 판에 없는 카드(되돌리기로 사라질 일은 없지만, 점검이 판을 바꿔 넣을 때)는 감춘다.
    for (const [id, view] of this.views) view.image.setVisible(places.has(id));
    for (const [id, place] of places) {
      let view = this.views.get(id);
      const suit = Math.floor(id / 13) as Card['suit'];
      const texture = place.up ? faceTexture({ suit, rank: (id % 13) + 1 }) : TEX.back;
      if (!view) {
        const image = this.add.image(place.x, place.y, texture).setOrigin(0);
        view = { image, x: place.x, y: place.y };
        this.views.set(id, view);
      }
      view.image.setTexture(texture).setDepth(DEPTH.card + place.depth);
      const moved = view.x !== place.x || view.y !== place.y || view.image.x !== place.x || view.image.y !== place.y;
      view.x = place.x;
      view.y = place.y;
      this.tweens.killTweensOf(view.image);
      if (animate && moved) {
        // 움직이는 동안에는 다른 카드 위로 지나간다.
        view.image.setDepth(DEPTH.drag + place.depth);
        this.tweens.add({
          targets: view.image,
          x: place.x,
          y: place.y,
          duration: MOVE_MS,
          ease: 'Quad.Out',
          onComplete: () => view?.image.setDepth(DEPTH.card + place.depth),
        });
      } else {
        view.image.setPosition(place.x, place.y);
      }
    }
    const stockSlot = this.children.getByName('stock-slot') as Phaser.GameObjects.Image | null;
    stockSlot?.setTexture(board.stock.length === 0 && board.waste.length > 0 ? TEX.recycle : TEX.slot);
  }

  private refreshHud(): void {
    const board = this.board;
    if (!board) return;
    // 오늘의 판에서는 되돌린 만큼 깎인 점수를 보인다(finalScore와 같은 셈).
    const penalty = this.daily !== null ? undoPenalty(this.undos) : 0;
    this.scoreText.setText(`${Math.max(0, Math.max(0, board.score) + penalty)}점`);
    this.undoButton.setEnabled(this.history.length > 0 && !this.autoFinishing);
  }

  // ───────── 입력 ─────────

  /** 그 자리에 있는 것: 더미, 또는 집을 수 있는 카드들 */
  private hitAt(x: number, y: number): { stock: true } | { from: Pile; count: number } | null {
    const board = this.board;
    if (!board) return null;
    const reach = GAP / 2 + 1;
    const within = (left: number, top: number, width: number, height: number): boolean =>
      x >= left - reach && x <= left + width + reach && y >= top - reach && y <= top + height + reach;
    const stock = stockPos();
    if (within(stock.x, stock.y, CARD_W, CARD_H)) return { stock: true };
    if (board.waste.length > 0) {
      const top = this.views.get(cardId(board.waste[board.waste.length - 1]));
      if (top && within(top.x, top.y, CARD_W, CARD_H)) return { from: { kind: 'waste' }, count: 1 };
    }
    for (let suit = 0; suit < 4; suit += 1) {
      const pos = foundationPos(suit);
      if (board.foundations[suit].length > 0 && within(pos.x, pos.y, CARD_W, CARD_H)) {
        return { from: { kind: 'found', index: suit }, count: 1 };
      }
    }
    for (let index = 0; index < COLUMNS; index += 1) {
      const column = board.tableau[index];
      const left = colLeft(index);
      if (column.length === 0 || x < left - reach || x > left + CARD_W + reach) continue;
      // 맨 아래(위에 보이는) 카드부터 거꾸로 본다.
      for (let order = column.length - 1; order >= 0; order -= 1) {
        const view = this.views.get(cardId(column[order]));
        if (!view) continue;
        const next = order < column.length - 1 ? this.views.get(cardId(column[order + 1])) : undefined;
        const bottom = next ? next.y : view.y + CARD_H;
        if (y >= view.y - (order === column.length - 1 ? reach : 0) && y <= bottom + (next ? 0 : reach)) {
          if (!column[order].up) return null;
          return { from: { kind: 'tab', index }, count: column.length - order };
        }
      }
    }
    return null;
  }

  private onDown(pointer: Phaser.Input.Pointer): void {
    if (!this.playing || this.autoFinishing || !this.board) return;
    // 위쪽 줄(일시정지, 되돌리기 버튼)은 버튼이 맡는다.
    if (pointer.worldY < TOP_BAR) return;
    const hit = this.hitAt(pointer.worldX, pointer.worldY);
    if (!hit) return;
    if ('stock' in hit) {
      this.draw();
      return;
    }
    const cards = pickUp(this.board, hit.from, hit.count);
    if (!cards) return;
    const ids = cards.map(cardId);
    const lead = this.views.get(ids[0]);
    if (!lead) return;
    this.grab = {
      from: hit.from,
      count: hit.count,
      ids,
      startX: pointer.worldX,
      startY: pointer.worldY,
      offsetX: pointer.worldX - lead.x,
      offsetY: pointer.worldY - lead.y,
      dragging: false,
    };
  }

  private onMove(pointer: Phaser.Input.Pointer): void {
    const grab = this.grab;
    if (!grab || !pointer.isDown) return;
    if (!grab.dragging) {
      if (Math.hypot(pointer.worldX - grab.startX, pointer.worldY - grab.startY) < DRAG_START) return;
      grab.dragging = true;
      sfx.flip();
    }
    const left = pointer.worldX - grab.offsetX;
    const top = pointer.worldY - grab.offsetY;
    grab.ids.forEach((id, index) => {
      const view = this.views.get(id);
      if (!view) return;
      this.tweens.killTweensOf(view.image);
      const gap = view.y - (this.views.get(grab.ids[0])?.y ?? view.y);
      view.image.setPosition(left, top + gap).setDepth(DEPTH.drag + index);
    });
    this.drawDropHint(this.dropTarget(grab, left, top));
  }

  private onUp(pointer: Phaser.Input.Pointer): void {
    const grab = this.grab;
    this.grab = null;
    this.highlight.clear();
    if (!grab || !this.board) return;
    if (grab.dragging) {
      const target = this.dropTarget(grab, pointer.worldX - grab.offsetX, pointer.worldY - grab.offsetY);
      if (target && this.tryMove({ from: grab.from, count: grab.count, to: target })) return;
      sfx.deny();
      this.render(true);
      return;
    }
    // 끌지 않고 뗐으면 알맞은 곳으로 보낸다.
    const to = autoTarget(this.board, grab.from, grab.count);
    if (to && this.tryMove({ from: grab.from, count: grab.count, to })) return;
    this.shake(grab.ids);
  }

  /** 끌고 있는 카드를 놓을 곳: 맨 위 카드의 가운데가 들어간 자리. 놓을 수 없는 곳이면 null. */
  private dropTarget(grab: Grab, left: number, top: number): Pile | null {
    const board = this.board;
    if (!board) return null;
    const centerX = left + CARD_W / 2;
    const centerY = top + CARD_H / 2;
    const column = Math.floor((centerX - SIDE + GAP / 2) / (CARD_W + GAP));
    if (column < 0 || column >= COLUMNS) return null;
    const candidates: Pile[] = [];
    if (centerY < TAB_Y - 2 && column >= 3) candidates.push({ kind: 'found', index: column - 3 });
    candidates.push({ kind: 'tab', index: column });
    // 모음 칸 줄 근처에서 놓았으면 제 무늬의 모음 칸도 받아 준다.
    if (centerY < TAB_Y + 6 && grab.count === 1) {
      const suit = Math.floor(grab.ids[0] / 13);
      candidates.push({ kind: 'found', index: suit });
    }
    return candidates.find((to) => isLegal(board, { from: grab.from, count: grab.count, to })) ?? null;
  }

  private drawDropHint(target: Pile | null): void {
    const g = this.highlight;
    g.clear();
    if (!target || !this.board) return;
    let x: number;
    let y: number;
    if (target.kind === 'found') ({ x, y } = foundationPos(target.index));
    else if (target.kind === 'tab') {
      const column = this.board.tableau[target.index];
      const last = column[column.length - 1];
      const view = last ? this.views.get(cardId(last)) : undefined;
      x = colLeft(target.index);
      y = view ? view.y : TAB_Y;
    } else return;
    g.lineStyle(2, PX.yellow, 1);
    g.strokeRect(x - 1, y - 1, CARD_W + 2, CARD_H + 2);
  }

  /** 옮길 수 없을 때 카드를 살짝 흔든다. */
  private shake(ids: number[]): void {
    sfx.deny();
    vibrate(10);
    for (const id of ids) {
      const view = this.views.get(id);
      if (!view) continue;
      this.tweens.killTweensOf(view.image);
      view.image.setPosition(view.x, view.y);
      this.tweens.add({ targets: view.image, x: view.x + 2, duration: 40, yoyo: true, repeat: 1 });
    }
  }

  // ───────── 수 ─────────

  private remember(): void {
    if (!this.board) return;
    this.history.push(this.board);
    if (this.history.length > HISTORY_MAX) this.history.shift();
  }

  private firstAction(): void {
    if (this.started) return;
    this.started = true;
  }

  private draw(): void {
    const board = this.board;
    if (!board) return;
    const next = drawStock(board);
    if (!next) {
      sfx.deny();
      return;
    }
    this.firstAction();
    this.remember();
    const recycled = next.recycles > board.recycles;
    this.board = next;
    if (recycled) {
      sfx.whoosh();
      if (next.recycles > 1) this.popPoints(stockPos().x + CARD_W / 2, ROW_Y + CARD_H + 2, POINTS.recycle);
    } else sfx.flip();
    this.render(true);
    this.afterAction();
  }

  private tryMove(move: Move): boolean {
    const board = this.board;
    if (!board) return false;
    const leadCard = pickUp(board, move.from, move.count)?.[0];
    const outcome = applyMove(board, move);
    if (!outcome || !leadCard) return false;
    this.firstAction();
    this.remember();
    this.board = outcome.board;
    const gained = outcome.board.score - board.score;
    if (move.to.kind === 'found') {
      sfx.hit(foundCount(outcome.board) % 14);
      vibrate(8);
    } else sfx.pop();
    this.render(true);
    if (gained !== 0) {
      const lead = this.views.get(cardId(leadCard));
      const x = lead ? lead.x + CARD_W / 2 : GAME_WIDTH / 2;
      const y = lead ? lead.y : TAB_Y;
      this.popPoints(x, y, gained);
    }
    this.afterAction();
    return true;
  }

  private popPoints(x: number, y: number, points: number): void {
    const text = addText(this, x, y, points > 0 ? `+${points}` : String(points), {
      size: 10,
      color: points > 0 ? PX_CSS.accent : PX_CSS.bad,
      originX: 0.5,
      originY: 1,
      stroke: PX_CSS.dark,
    }).setDepth(DEPTH.banner);
    this.tweens.add({ targets: text, y: y - 14, alpha: 0, duration: 600, ease: 'Quad.Out', onComplete: () => text.destroy() });
  }

  private undo(): void {
    if (!this.playing || this.autoFinishing) return;
    const previous = this.history.pop();
    if (!previous) return;
    this.undos += 1;
    this.board = previous;
    sfx.flip();
    if (this.daily !== null) this.popPoints(GAME_WIDTH - 8 - 32, 8 + 26 + 14, POINTS.undo);
    this.render(true);
    this.afterAction();
  }

  private afterAction(): void {
    const board = this.board;
    if (!board) return;
    this.refreshHud();
    this.clearStuck();
    if (isWon(board)) {
      this.win();
      return;
    }
    if (canAutoFinish(board)) {
      this.runAutoFinish();
      return;
    }
    if (!hasUsefulMove(board)) this.showStuck();
  }

  /** 남은 카드를 차례로 모음 칸에 올린다. */
  private runAutoFinish(): void {
    if (this.autoFinishing) return;
    this.autoFinishing = true;
    this.refreshHud();
    showBanner(this, this.scale.height / 2, TEXT.autoFinish, PX_CSS.good, 700, DEPTH.banner);
    const step = (): void => {
      const board = this.board;
      if (!board || !this.scene.isActive()) return;
      const move = nextFoundationMove(board);
      const outcome = move ? applyMove(board, move) : null;
      if (!outcome) {
        this.autoFinishing = false;
        this.afterAction();
        return;
      }
      this.board = outcome.board;
      sfx.hit(foundCount(outcome.board) % 14);
      this.render(true);
      this.refreshHud();
      if (isWon(outcome.board)) {
        this.autoFinishing = false;
        this.win();
        return;
      }
      this.time.delayedCall(AUTO_STEP_MS, step);
    };
    this.time.delayedCall(AUTO_STEP_MS * 3, step);
  }

  private showStuck(): void {
    const { height } = this.scale;
    const top = Math.round(height / 2 - 36);
    const width = GAME_WIDTH - 32;
    const panel = this.panel(16, top, width, 72).setDepth(DEPTH.banner);
    const text = addText(this, GAME_WIDTH / 2, top + 18, TEXT.stuck, { color: PX_CSS.text, originX: 0.5, originY: 0.5 }).setDepth(DEPTH.banner);
    this.stuckObjects.push(panel, text);
    const half = (width - 8 * 3) / 2;
    this.stuckButtons.push(
      this.onTop(() => new PixelButton(this, { x: 16 + 8, y: top + 34, width: half, height: 30, label: TEXT.undo, onTap: () => this.undo() })),
      this.onTop(
        () =>
          new PixelButton(this, {
            x: 16 + 16 + half,
            y: top + 34,
            width: half,
            height: 30,
            label: TEXT.finish,
            style: 'green',
            onTap: () => this.endGame(),
          }),
      ),
    );
  }

  /** 버튼을 만들고, 그 버튼이 더한 것들을 카드 위로 올린다(PixelButton은 깊이를 받지 않는다). */
  private onTop(make: () => PixelButton): PixelButton {
    const before = new Set(this.children.list);
    const button = make();
    for (const object of this.children.list) {
      if (!before.has(object)) (object as Phaser.GameObjects.GameObject & { setDepth(depth: number): unknown }).setDepth(DEPTH.banner + 1);
    }
    this.stuckObjects.push(...this.children.list.filter((object) => !before.has(object)));
    return button;
  }

  private clearStuck(): void {
    for (const object of this.stuckObjects) object.destroy();
    this.stuckObjects = [];
    this.stuckButtons = [];
  }

  private win(): void {
    if (this.phase !== 'play') return;
    sfx.fanfare();
    vibrate([20, 40, 20]);
    showBanner(this, this.scale.height / 2, TEXT.won, PX_CSS.accent, 1400, DEPTH.banner);
    // 모음 칸의 카드가 차례로 통통 뛴다.
    let order = 0;
    for (const pile of this.board?.foundations ?? []) {
      for (const card of pile) {
        const view = this.views.get(cardId(card));
        if (!view) continue;
        this.tweens.add({ targets: view.image, y: view.y - 6, duration: 120, yoyo: true, delay: order * 18 });
        order += 1;
      }
    }
    this.endGame(1800);
  }

  private endGame(delay = 900): void {
    const board = this.board;
    if (!board || this.phase !== 'play') return;
    this.phase = 'over';
    this.clearStuck();
    const won = isWon(board);
    // 오늘의 판에서는 되돌릴 때마다 점수를 깎는다(되돌려서 더미의 차례를 미리 보는 것을 막으려고).
    const penalized = this.daily !== null ? this.undos : 0;
    const score = finalScore(board, this.elapsed, penalized);
    const stats: ResultStat[] = [
      ['모은 카드', `${foundCount(board)}장`],
      ['걸린 시간', clock(this.elapsed)],
    ];
    if (won) stats.push(['시간 보너스', `+${timeBonus(this.elapsed)}`]);
    stats.push(['되돌리기', penalized > 0 ? `${this.undos}번 (${undoPenalty(penalized)})` : `${this.undos}번`]);
    if (this.daily !== null) {
      const today = dayIndexOf(new Date());
      if (this.daily === today) {
        // 오늘의 판은 최고 기록과 전체 랭킹에 들지 않아서(offRecordNote) 판을 마칠 때의 올리기가 없다. 여기서 바로 올린다.
        noteDayScore(this.gameId, score, today);
        void syncScores();
      }
      stats.unshift([DAILY_TEXT.name, dayLabel(this.daily)]);
    }
    this.finishMiniGame(score, stats, delay);
  }
}
