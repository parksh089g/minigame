import Phaser from 'phaser';
import { GAME_WIDTH, SCENE } from '../../config';
import { vibrate } from '../../core/haptics';
import { sfx } from '../../core/sfx';
import { homeScene } from '../../core/home';
import { store } from '../../core/store';
import { addTapZone, addText, drawPanel, fadeToScene, PixelButton, type ButtonStyle } from '../../core/ui';
import { MiniGameScene } from '../../scenes/MiniGameScene';
import { FriendsKit, type FriendsResult, type FriendsStart } from '../../versus/friends-kit';
import type { RoomView } from '../../versus/protocol';
import { withSubject } from '../../versus/text';
import {
  CHIP_ROUNDS,
  CHIP_START,
  CHIP_STEPS,
  chipCoins,
  chipGuess,
  chipMinBet,
  chipRunOver,
  chipSkip,
  payoutFor,
  rate10For,
  rateLabel,
  startChipRun,
  type ChipRun,
} from './chips';
import { chipRecord } from './chip-record';
import {
  CARD_H,
  CARD_W,
  MINI_H,
  MINI_W,
  PX,
  PX_CSS,
  rankSize,
  rankTexture,
  registerHighLowTextures,
  suitTexture,
  TEX,
} from './art';
import {
  accuracy,
  GAME_ID,
  isRed,
  LIVES,
  makeGuess,
  pointsFor,
  skipCard,
  startState,
  streakBonus,
  winChance,
  type Card,
  type Guess,
  type HighLowState,
  type Verdict,
} from './rules';
import { highLowVersus, readHighLowView, type HighLowMove, type HighLowView } from './versus';

/** 씬을 열 때 넘기는 값. mode가 있으면 준비 화면을 건너뛰고 그 모드로 바로 시작한다("다시 하기"). */
export interface HighLowStart extends FriendsStart {
  mode?: 'hearts' | 'chips';
}

/** 칩 버튼 색: 5, 10, 25, 50 */
const CHIP_STYLES: readonly ButtonStyle[] = ['neutral', 'red', 'green', 'blue'];

const MARGIN = 8;
/** 지나간 카드를 몇 장까지 보여 줄지 */
const HISTORY_MAX = 9;
const DEPTH = { back: -10, base: 0, card: 5, moving: 10, float: 20 } as const;
/** 칩 걸기의 고르기 버튼 높이와 그 위의 칩 줄 높이 */
const CHIP_BUTTON_H = 62;
const BET_ROW_H = 28;

/** 지나간 카드 밑의 점 색: 맞힘, 같음, 틀림, 넘김 */
const OUTCOME_COLOR: Readonly<Record<Verdict | 'skip', number>> = {
  win: PX.lime,
  tie: PX.sky,
  lose: PX.red,
  skip: PX.edge,
};

interface GuessButton {
  guess: Guess;
  draw: (pressed: boolean) => void;
  title: Phaser.GameObjects.Text;
  points: Phaser.GameObjects.Text;
  chance: Phaser.GameObjects.Text;
  icon: Phaser.GameObjects.Image;
  enabled: boolean;
}

/**
 * 하이로우: 펼친 카드를 보고 다음 카드가 높을지 낮을지 맞힌다.
 * 나오기 어려운 쪽을 맞힐수록 점수가 크고, 연속으로 맞히면 보너스가 붙는다. 하트 세 개를 다 잃으면 끝난다.
 * 화면은 등불지기, 구름 탑 모험과 같은 어두운 바탕의 픽셀 그림이다.
 */
export class HighLowScene extends MiniGameScene {
  protected readonly gameId = GAME_ID;

  private state!: HighLowState;
  /** 칩 걸기 판. 하트 모드면 null. 친구와 할 때는 서버가 보낸 내 판이다. 자동 점검이 들여다본다. */
  run: ChipRun | null = null;
  /** 칩 걸기에서 다음에 걸 칩 */
  private betAmount = 0;
  /** 친구와 하기. 자동 점검이 들여다본다. */
  friends!: FriendsKit<HighLowView, HighLowMove>;
  private versusBuilt = false;
  /** 마지막으로 그린 친구와의 판의 수 번호 */
  private seenMoves = -1;
  /** 마지막으로 그린 판이 어느 자리의 것인지. 한 폰으로 할 때 사람이 바뀌면 카드를 새로 놓는다. */
  private viewSeat: number | null = null;
  private subText!: Phaser.GameObjects.Text;
  private roundText!: Phaser.GameObjects.Text;
  private foeText!: Phaser.GameObjects.Text;
  private betButtons: PixelButton[] = [];
  /** 카드가 넘어가는 동안에는 누를 수 없다 */
  private busy = false;
  private history: Array<{ card: Card; outcome: Verdict | 'skip' }> = [];

  private currentX = 0;
  private deckX = 0;
  private cardY = 0;
  private historyY = 0;
  private currentCard!: Phaser.GameObjects.Container;

  private scoreText!: Phaser.GameObjects.Text;
  private streakText!: Phaser.GameObjects.Text;
  private deckText!: Phaser.GameObjects.Text;
  private promptText!: Phaser.GameObjects.Text;
  private hearts: Phaser.GameObjects.Image[] = [];
  private historyLayer!: Phaser.GameObjects.Container;
  private buttons: GuessButton[] = [];
  private skipDraw!: (pressed: boolean) => void;
  private skipLabel!: Phaser.GameObjects.Text;

  constructor() {
    super(SCENE.highLow);
  }

  create(data: HighLowStart = {}): void {
    this.beginMiniGame();
    registerHighLowTextures(this);
    this.state = startState();
    this.run = null;
    this.betAmount = 0;
    this.versusBuilt = false;
    this.seenMoves = -1;
    this.viewSeat = null;
    this.betButtons = [];
    this.busy = false;
    this.history = [];
    this.hearts = [];
    this.buttons = [];
    this.friends = new FriendsKit<HighLowView, HighLowMove>(this, {
      game: 'high-low',
      title: '하이로우',
      rules: highLowVersus,
      readView: readHighLowView,
      isMyTurn: (room) => !!room.game && !chipRunOver(room.game.mine) && (room.game.foe.done || room.game.first === room.seat),
      cover: true,
      onRoom: (room, fresh) => this.onRoom(room, fresh),
      result: (room) => this.friendResult(room),
      say: (text, warn) => this.say(text, warn ? PX_CSS.bad : PX_CSS.text),
      coverNote: () => this.coverNote(),
      restart: (start) => this.scene.restart(start satisfies HighLowStart),
    });
    if (this.friends.begin(data)) return;
    if (data.mode === 'hearts') this.startHearts();
    else if (data.mode === 'chips') this.startChips();
    else this.openLobby();
  }

  /** 하트 모드(처음부터 있던 하이로우) */
  private startHearts(): void {
    this.buildBoard();
    this.currentCard = this.makeFace(this.state.current, this.currentX, this.cardY).setDepth(DEPTH.card);
    this.refresh();
    this.addPauseButton();
    this.playing = true;
    // 처음 하는 사람에게는 규칙 안내서를 한 번 띄운다. 그 사이에 이미 골랐으면 띄우지 않는다.
    this.offerRuleBook(() => this.history.length === 0 && !this.busy);
  }

  /** 칩 걸기 혼자 하기 */
  private startChips(): void {
    this.run = startChipRun();
    this.betAmount = this.run.bet;
    this.playing = true;
    this.buildBoard();
    this.currentCard = this.makeFace(this.run.current, this.currentX, this.cardY).setDepth(DEPTH.card);
    this.refresh();
    this.addPauseButton();
  }

  // ───────── 준비 화면 ─────────

  private openLobby(): void {
    const { height } = this.scale;
    this.drawSky();
    new PixelButton(this, { x: MARGIN, y: 8, width: 26, height: 26, icon: 'icon-back', hitPadding: 6, onTap: () => fadeToScene(this, homeScene()) });
    addText(this, 42, 21, '하이로우', { size: 16, color: PX_CSS.accent, originY: 0.5 });
    const rulesX = GAME_WIDTH - MARGIN - 44;
    new PixelButton(this, { x: rulesX, y: 8, width: 44, height: 26, label: '규칙', style: 'yellow', hitPadding: 4, onTap: () => this.openRuleBook() });
    this.offerRuleBook(() => !this.playing && !this.friends.active);

    const best = store.data.games[GAME_ID]?.best ?? 0;
    const chips = chipRecord.get();
    const modes: Array<{ title: string; lines: string[]; record: string; icon: string; onTap: () => void }> = [
      {
        title: '하트 모드',
        lines: ['하트 세 개로 오래 맞혀요', '어려운 쪽을 맞힐수록 큰 점수'],
        record: best > 0 ? `최고 ${best}점` : '',
        icon: TEX.heart,
        onTap: () => this.scene.restart({ mode: 'hearts' } satisfies HighLowStart),
      },
      {
        title: '칩 걸기',
        lines: [`놀이 칩 ${CHIP_START}개로 ${CHIP_ROUNDS}번 걸어요`, '어려운 쪽일수록 배당이 커요'],
        record: chips.best > 0 ? `최고 ${chips.best}칩` : '',
        icon: TEX.up,
        onTap: () => this.scene.restart({ mode: 'chips' } satisfies HighLowStart),
      },
    ];
    const cardHeight = 74;
    let y = Math.max(48, Math.round(height * 0.14));
    for (const mode of modes) {
      const top = y;
      const g = this.add.graphics();
      const draw = (pressed: boolean): void => {
        g.clear();
        this.panel(g, MARGIN, top + (pressed ? 2 : 0), GAME_WIDTH - MARGIN * 2, cardHeight, pressed ? PX.navy : PX.panel, PX.edge);
      };
      draw(false);
      this.add.image(MARGIN + 16, top + 18, mode.icon);
      addText(this, MARGIN + 28, top + 18, mode.title, { size: 15, color: PX_CSS.accent, originY: 0.5 });
      if (mode.record) addText(this, GAME_WIDTH - MARGIN - 10, top + 18, mode.record, { size: 10, color: PX_CSS.sub, originX: 1, originY: 0.5 });
      mode.lines.forEach((line, index) => addText(this, MARGIN + 12, top + 36 + index * 16, line, { size: 10, color: PX_CSS.text }));
      addTapZone(this, MARGIN, top, GAME_WIDTH - MARGIN * 2, cardHeight, draw, mode.onTap);
      y += cardHeight + 10;
    }
    addText(this, GAME_WIDTH / 2, y + 6, '친구와는 같은 카드 순서로 칩 걸기를 겨뤄요', { size: 10, color: PX_CSS.faint, originX: 0.5 });
    addText(this, GAME_WIDTH / 2, y + 22, '칩은 게임 안에서만 쓰여서 코인을 잃지 않아요', { size: 10, color: PX_CSS.faint, originX: 0.5 });
    this.friends.lobbyButton(MARGIN, height - MARGIN - 36, GAME_WIDTH - MARGIN * 2, 36);
  }

  /** 판 화면: 카드 자리, 위쪽 줄, 버튼 */
  private buildBoard(): void {
    const { height } = this.scale;
    // 화면이 길면 남는 자리를 카드 둘레에 나눠 준다.
    const extra = Math.max(0, height - 400);
    this.cardY = Math.round(72 + extra * 0.3 + CARD_H / 2);
    this.currentX = Math.round(GAME_WIDTH / 2 - CARD_W / 2 - 10);
    this.deckX = Math.round(GAME_WIDTH / 2 + CARD_W / 2 + 10);
    // 지나간 카드 줄은 카드 이름 아래와 버튼 위의 안내 글 사이 한가운데에 둔다(drawControls와 같은 셈).
    const labelsBottom = this.cardY + CARD_H / 2 + 22;
    const promptTop = height - MARGIN - 3 - 30 - 10 - 74 - 22;
    // 칩 걸기는 고르기 버튼 위에 칩 줄이 더 있다(drawControls와 같은 셈).
    const chipsPromptTop = height - MARGIN - 3 - 30 - 10 - CHIP_BUTTON_H - 8 - BET_ROW_H - 22;
    this.historyY = Math.round((labelsBottom + (this.run ? chipsPromptTop : promptTop)) / 2 - 4);

    this.drawSky();
    this.drawTop();
    this.drawTable();
    this.drawControls();
  }

  // ───────── 화면 구성 ─────────

  /** 위는 짙은 남색, 아래로 갈수록 검게. 띠로 나눠 칠해서 픽셀 느낌의 계단 그러데이션을 만든다. */
  private drawSky(): void {
    const { height } = this.scale;
    const g = this.add.graphics().setDepth(DEPTH.back);
    const bands = 8;
    const from = Phaser.Display.Color.ValueToColor(0x29366f);
    const to = Phaser.Display.Color.ValueToColor(0x1a1c2c);
    for (let i = 0; i < bands; i += 1) {
      const mixed = Phaser.Display.Color.Interpolate.ColorWithColor(from, to, bands - 1, i);
      g.fillStyle(Phaser.Display.Color.GetColor(mixed.r, mixed.g, mixed.b), 1);
      g.fillRect(0, Math.floor((height * i) / bands), GAME_WIDTH, Math.ceil(height / bands) + 1);
    }
    const stars: readonly (readonly [number, number, number])[] = [
      [18, 52, PX.white],
      [70, 40, PX.silver],
      [214, 58, PX.yellow],
      [128, 66, PX.silver],
      [226, 196, PX.white],
      [10, 230, PX.silver],
      [118, 250, 0x73eff7],
      [200, 300, PX.silver],
    ];
    for (const [x, y, color] of stars) {
      g.fillStyle(color, 0.7);
      g.fillRect(x, y, 2, 2);
    }
  }

  private panel(g: Phaser.GameObjects.Graphics, x: number, y: number, width: number, height: number, fill: number = PX.panel, border: number = PX.edge): void {
    drawPanel(g, x, y, width, height, { fill, border, shadow: PX.ink, radius: 3, depth: 3 });
  }

  private drawTop(): void {
    if (this.run) {
      this.drawChipTop();
      return;
    }
    addText(this, 40, 9, '하이로우', { size: 14, color: PX_CSS.text });
    const best = store.data.games[GAME_ID]?.best ?? 0;
    addText(this, 40, 27, best > 0 ? `최고 ${best}점` : '높을까 낮을까', { size: 9, color: PX_CSS.faint });

    const width = 74;
    const left = GAME_WIDTH - MARGIN - width;
    this.panel(this.add.graphics(), left, 8, width, 24);
    addText(this, left + 8, 20, '점수', { size: 9, color: PX_CSS.sub, originY: 0.5 });
    this.scoreText = addText(this, left + width - 8, 20, '0', { size: 14, color: PX_CSS.accent, originX: 1, originY: 0.5 });

    for (let i = 0; i < LIVES; i += 1) {
      this.hearts.push(this.add.image(MARGIN + 7 + i * 17, 50, TEX.heart));
    }
    this.streakText = addText(this, GAME_WIDTH - MARGIN, 50, '', { size: 11, color: PX_CSS.text, originX: 1, originY: 0.5 });
  }

  private drawTable(): void {
    // 카드가 놓이는 자리: 펼친 카드 자리와 카드 묶음
    const g = this.add.graphics().setDepth(DEPTH.base);
    g.fillStyle(PX.ink, 0.45);
    g.fillRect(this.currentX - CARD_W / 2 - 4, this.cardY - CARD_H / 2 - 4, CARD_W + 8, CARD_H + 8);
    g.fillRect(this.deckX - CARD_W / 2 - 4, this.cardY - CARD_H / 2 - 4, CARD_W + 8, CARD_H + 8);
    // 묶음은 몇 장 겹친 것처럼 보이게 아래로 두 장을 깐다.
    this.add.image(this.deckX + 3, this.cardY + 3, TEX.back).setDepth(DEPTH.base).setTint(0x8892a8);
    this.add.image(this.deckX + 1.5, this.cardY + 1.5, TEX.back).setDepth(DEPTH.base).setTint(0xb8c0d0);
    this.add.image(this.deckX, this.cardY, TEX.back).setDepth(DEPTH.base);

    const labelY = this.cardY + CARD_H / 2 + 8;
    addText(this, this.currentX, labelY, '지금 카드', { size: 9, color: PX_CSS.faint, originX: 0.5 });
    this.deckText = addText(this, this.deckX, labelY, '', { size: 9, color: PX_CSS.faint, originX: 0.5 });

    this.historyLayer = this.add.container(0, 0).setDepth(DEPTH.base);
  }

  private drawControls(): void {
    const { height } = this.scale;
    const skipHeight = 30;
    const skipY = height - MARGIN - 3 - skipHeight;
    const buttonHeight = this.run ? CHIP_BUTTON_H : 74;
    const buttonY = skipY - 10 - buttonHeight;
    const buttonWidth = (GAME_WIDTH - MARGIN * 2 - 8) / 2;
    // 칩 걸기: 고르기 버튼 위에 칩 버튼 줄
    const betY = buttonY - 8 - BET_ROW_H;
    if (this.run) this.drawBetRow(betY);

    this.promptText = addText(this, GAME_WIDTH / 2, (this.run ? betY : buttonY) - 12, '', {
      size: 11,
      color: PX_CSS.sub,
      originX: 0.5,
      originY: 0.5,
    });

    const specs: ReadonlyArray<{ guess: Guess; x: number; label: string; icon: string; face: number; lip: number }> = [
      { guess: 'high', x: MARGIN, label: '높다', icon: TEX.up, face: PX.green, lip: PX.teal },
      { guess: 'low', x: MARGIN + buttonWidth + 8, label: '낮다', icon: TEX.down, face: PX.red, lip: PX.plum },
    ];
    for (const spec of specs) {
      const g = this.add.graphics();
      const icon = this.add.image(0, 0, spec.icon);
      const title = addText(this, 0, 0, spec.label, { size: 16, color: PX_CSS.text, originY: 0.5, shadow: PX_CSS.dark });
      const points = addText(this, 0, 0, '', { size: 13, color: PX_CSS.accent, originX: 0.5, originY: 0.5, shadow: PX_CSS.dark });
      const chance = addText(this, 0, 0, '', { size: 9, color: PX_CSS.text, originX: 0.5, originY: 0.5 });
      const button: GuessButton = {
        guess: spec.guess,
        title,
        points,
        chance,
        icon,
        enabled: true,
        draw: (pressed) => {
          const enabled = button.enabled;
          const offset = pressed && enabled ? 3 : 0;
          g.clear();
          g.fillStyle(PX.ink, 1);
          g.fillRect(spec.x, buttonY + 3, buttonWidth, buttonHeight);
          g.fillStyle(enabled ? spec.lip : PX.panel, 1);
          g.fillRect(spec.x, buttonY + offset, buttonWidth, buttonHeight);
          g.fillStyle(PX.ink, 1);
          g.fillRect(spec.x, buttonY + offset, buttonWidth, buttonHeight - 3);
          g.fillStyle(enabled ? spec.face : PX.panel, 1);
          g.fillRect(spec.x + 2, buttonY + offset + 2, buttonWidth - 4, buttonHeight - 7);
          // 왼쪽 위의 밝은 줄
          g.fillStyle(PX.white, enabled ? 0.25 : 0.08);
          g.fillRect(spec.x + 4, buttonY + offset + 4, buttonWidth - 8, 2);
          const center = spec.x + buttonWidth / 2;
          const titleWidth = title.width + 18;
          // 칩 걸기 버튼은 낮아서 줄 사이를 좁힌다.
          const rows = buttonHeight < 74 ? [15, 34, 49] : [18, 40, 57];
          icon.setPosition(Math.round(center - titleWidth / 2 + 7), buttonY + offset + rows[0]).setAlpha(enabled ? 1 : 0.4);
          title.setPosition(Math.round(center - titleWidth / 2 + 18), buttonY + offset + rows[0]).setAlpha(enabled ? 1 : 0.4);
          points.setPosition(center, buttonY + offset + rows[1]).setAlpha(enabled ? 1 : 0.5);
          chance.setPosition(center, buttonY + offset + rows[2]).setAlpha(enabled ? 0.85 : 0.5);
        },
      };
      addTapZone(this, spec.x, buttonY, buttonWidth, buttonHeight, (pressed) => button.draw(pressed), () => this.guess(spec.guess));
      button.draw(false);
      this.buttons.push(button);
    }

    const skipG = this.add.graphics();
    const skipIcon = this.add.image(0, 0, TEX.skip);
    this.skipLabel = addText(this, 0, 0, '', { size: 11, color: PX_CSS.text, originY: 0.5 });
    const skipWidth = GAME_WIDTH - MARGIN * 2;
    this.skipDraw = (pressed) => {
      const enabled = (this.run ? this.run.skips : this.state.skips) > 0;
      const offset = pressed && enabled ? 2 : 0;
      skipG.clear();
      this.panel(skipG, MARGIN, skipY + offset, skipWidth, skipHeight - offset, enabled ? PX.navy : PX.panel);
      const total = this.skipLabel.width + 20;
      const left = GAME_WIDTH / 2 - total / 2;
      skipIcon.setPosition(Math.round(left + 7), skipY + offset + skipHeight / 2 - 1).setAlpha(enabled ? 1 : 0.4);
      this.skipLabel.setPosition(Math.round(left + 20), skipY + offset + skipHeight / 2 - 1).setAlpha(enabled ? 1 : 0.5);
    };
    addTapZone(this, MARGIN, skipY, skipWidth, skipHeight, this.skipDraw, () => this.skip());
  }

  // ───────── 카드 ─────────

  /** 앞면 카드 하나. 왼쪽 위와 오른쪽 아래(거꾸로)에 숫자와 무늬, 가운데에 큰 무늬 */
  private makeFace(card: Card, x: number, y: number): Phaser.GameObjects.Container {
    const red = isRed(card.suit);
    const rank = rankTexture(card.rank, red);
    const size = rankSize(card.rank);
    const left = -CARD_W / 2 + 6;
    const top = -CARD_H / 2 + 6;
    const cornerX = left + Math.max(size.width, 14) / 2;
    const parts: Phaser.GameObjects.GameObject[] = [
      this.add.image(0, 0, TEX.face),
      this.add.image(cornerX, top + size.height / 2, rank),
      this.add.image(cornerX, top + size.height + 10, suitTexture(card.suit, 'small')),
      this.add.image(-cornerX, -top - size.height / 2, rank).setAngle(180),
      this.add.image(-cornerX, -top - size.height - 10, suitTexture(card.suit, 'small')).setAngle(180),
      this.add.image(0, 0, suitTexture(card.suit, 'big')),
    ];
    return this.add.container(x, y, parts);
  }

  private makeMini(card: Card, x: number, y: number, outcome: Verdict | 'skip'): Phaser.GameObjects.GameObject[] {
    const dot = this.add.graphics();
    dot.fillStyle(OUTCOME_COLOR[outcome], 1);
    dot.fillRect(x - 3, y + MINI_H / 2 + 4, 6, 4);
    return [
      this.add.image(x, y, TEX.miniFace),
      this.add.image(x, y - 3, rankTexture(card.rank, isRed(card.suit))).setScale(card.rank === 10 ? 0.7 : 0.8),
      this.add.image(x, y + 8, suitTexture(card.suit, 'small')).setScale(0.5),
      dot,
    ];
  }

  private drawHistory(): void {
    this.historyLayer.removeAll(true);
    const shown = this.history.slice(-HISTORY_MAX);
    if (shown.length === 0) {
      this.historyLayer.add(
        addText(this, GAME_WIDTH / 2, this.historyY, '맞힌 카드가 여기에 쌓여요', { size: 9, color: PX_CSS.faint, originX: 0.5, originY: 0.5 }),
      );
      return;
    }
    const gap = MINI_W + 4;
    const left = GAME_WIDTH / 2 - ((shown.length - 1) * gap) / 2;
    shown.forEach((entry, index) => {
      this.historyLayer.add(this.makeMini(entry.card, left + index * gap, this.historyY, entry.outcome));
    });
  }

  // ───────── 상태 보여 주기 ─────────

  private refresh(): void {
    if (this.run) {
      this.refreshChips(this.run);
      return;
    }
    const { state } = this;
    this.scoreText.setText(String(state.score));
    this.hearts.forEach((heart, index) => heart.setTexture(index < state.lives ? TEX.heart : TEX.heartEmpty));
    const bonus = streakBonus(state.streak);
    this.streakText.setText(state.streak > 0 ? `연속 ${state.streak}${bonus > 0 ? `  보너스 +${bonus}` : ''}` : '');
    this.streakText.setColor(bonus > 0 ? PX_CSS.accent : PX_CSS.text);
    this.deckText.setText(`남은 카드 ${state.deck.length}장`);
    if (!this.promptText.text || this.promptText.getData('sticky') !== true) {
      this.promptText.setText('다음 카드는 높을까, 낮을까?').setColor(PX_CSS.sub);
    }
    this.promptText.setData('sticky', false);

    for (const button of this.buttons) {
      const points = pointsFor(button.guess, state.current.rank, state.deck);
      button.enabled = points > 0;
      const total = points > 0 ? points + bonus : 0;
      button.points.setText(points > 0 ? `+${total}점` : '나올 카드 없음');
      button.points.setFontSize(points > 0 ? 13 : 10);
      button.chance.setText(points > 0 ? `맞힐 확률 ${Math.round(winChance(button.guess, state.current.rank, state.deck) * 100)}%` : '');
      button.draw(false);
    }
    this.skipLabel.setText(state.skips > 0 ? `넘기기 (${state.skips}번 남음)` : '넘기기를 다 썼어요');
    this.skipDraw(false);
    this.drawHistory();
  }

  private say(label: string, color: string): void {
    this.promptText.setText(label).setColor(color).setData('sticky', true);
    this.tweens.killTweensOf(this.promptText);
    this.promptText.setScale(1.25);
    this.tweens.add({ targets: this.promptText, scale: 1, duration: 160, ease: 'Back.Out' });
  }

  private float(label: string, color: string): void {
    const text = addText(this, this.currentX, this.cardY - CARD_H / 2 - 4, label, {
      size: 16,
      color,
      originX: 0.5,
      originY: 1,
      stroke: PX_CSS.dark,
    }).setDepth(DEPTH.float);
    this.tweens.add({ targets: text, y: text.y - 18, alpha: 0, duration: 750, ease: 'Cubic.Out', onComplete: () => text.destroy() });
  }

  // ───────── 고르기 ─────────

  private guess(guess: Guess): void {
    if (this.run) {
      this.chipGuessTap(guess);
      return;
    }
    if (!this.playing || this.busy) return;
    const previous = this.state.current;
    const outcome = makeGuess(this.state, guess);
    if (!outcome) {
      sfx.deny();
      return;
    }
    this.reveal(outcome.card, () => {
      this.history.push({ card: previous, outcome: outcome.verdict });
      if (outcome.verdict === 'win') {
        sfx.hit(this.state.streak);
        vibrate(10);
        this.float(`+${outcome.points}`, PX_CSS.good);
        this.say(outcome.bonus > 0 ? `맞혔어요! 연속 보너스 +${outcome.bonus}` : '맞혔어요!', PX_CSS.good);
      } else if (outcome.verdict === 'tie') {
        sfx.click();
        this.float('같은 숫자', PX_CSS.sky);
        this.say('같은 숫자라서 비겼어요', PX_CSS.sky);
      } else {
        sfx.miss();
        vibrate(30);
        this.cameras.main.shake(110, 0.008);
        this.float('틀렸어요', PX_CSS.bad);
        this.say(outcome.over ? '하트를 다 잃었어요' : '틀렸어요. 하트 하나를 잃었어요', PX_CSS.bad);
        const heart = this.hearts[this.state.lives];
        if (heart) this.tweens.add({ targets: heart, scale: 1.6, duration: 90, yoyo: true });
      }
      if (outcome.reshuffled && !outcome.over) this.time.delayedCall(600, () => this.say('카드를 다 써서 새로 섞었어요', PX_CSS.accent));
      this.refresh();
      if (outcome.over) this.finish();
    });
  }

  private skip(): void {
    if (this.run) {
      this.chipSkipTap();
      return;
    }
    if (!this.playing || this.busy) return;
    const previous = this.state.current;
    const drawn = skipCard(this.state);
    if (!drawn) {
      sfx.deny();
      return;
    }
    this.reveal(drawn.card, () => {
      this.history.push({ card: previous, outcome: 'skip' });
      this.say(drawn.reshuffled ? '카드를 다 써서 새로 섞었어요' : '카드를 넘겼어요', PX_CSS.sub);
      this.refresh();
    });
  }

  /** 묶음 맨 위의 카드를 뒤집어 펼친 카드 자리로 옮긴다. 다 옮기면 done을 부른다. */
  private reveal(card: Card, done: () => void): void {
    this.busy = true;
    sfx.flip();
    const back = this.add.image(this.deckX, this.cardY, TEX.back).setDepth(DEPTH.moving);
    const face = this.makeFace(card, this.deckX, this.cardY).setDepth(DEPTH.moving).setScale(0, 1);
    this.tweens.add({
      targets: back,
      scaleX: 0,
      duration: 90,
      onComplete: () => {
        back.destroy();
        this.tweens.add({
          targets: face,
          scaleX: 1,
          duration: 90,
          onComplete: () => {
            this.tweens.add({
              targets: face,
              x: this.currentX,
              duration: 170,
              ease: 'Cubic.Out',
              onComplete: () => {
                this.currentCard.destroy();
                this.currentCard = face.setDepth(DEPTH.card);
                this.busy = false;
                done();
              },
            });
          },
        });
      },
    });
  }

  private finish(): void {
    const { state } = this;
    this.finishMiniGame(
      state.score,
      [
        ['최고 연속', `${state.bestStreak}번`],
        ['맞힌 카드', `${state.wins}장`],
        ['정확도', `${accuracy(state.wins, state.losses)}%`],
      ],
      1100,
    );
  }

  // ───────── 칩 걸기 ─────────

  /** 칩 걸기의 위쪽 줄: 제목 아래에 기록(친구와 하면 이긴 판 수), 오른쪽에 칩, 둘째 줄에 몇 번째인지와 상대 */
  private drawChipTop(): void {
    addText(this, 40, 9, '하이로우', { size: 14, color: PX_CSS.text });
    const best = chipRecord.get().best;
    this.subText = addText(this, 40, 27, this.friends.match ? this.friends.scoreLine() : best > 0 ? `칩 걸기 · 최고 ${best}칩` : '칩 걸기', { size: 9, color: PX_CSS.faint });
    const width = 74;
    const left = GAME_WIDTH - MARGIN - width;
    this.panel(this.add.graphics(), left, 8, width, 24);
    const coin = this.add.graphics();
    coin.fillStyle(PX.ink, 1).fillCircle(left + 12, 21, 7);
    coin.fillStyle(PX.yellow, 1).fillCircle(left + 12, 20, 6);
    coin.fillStyle(PX.white, 1).fillRect(left + 11, 15, 2, 2).fillRect(left + 11, 23, 2, 2).fillRect(left + 7, 19, 2, 2).fillRect(left + 15, 19, 2, 2);
    this.scoreText = addText(this, left + width - 8, 20, '0', { size: 14, color: PX_CSS.accent, originX: 1, originY: 0.5 });
    this.roundText = addText(this, MARGIN + 2, 50, '', { size: 11, color: PX_CSS.text, originY: 0.5 });
    this.streakText = addText(this, GAME_WIDTH - MARGIN, 50, '', { size: 11, color: PX_CSS.text, originX: 1, originY: 0.5 });
    // 친구와 할 때는 상대의 진행을 한 줄 더 적는다.
    this.foeText = addText(this, GAME_WIDTH / 2, 64, '', { size: 9, color: PX_CSS.sub, originX: 0.5, originY: 0.5 });
  }

  /** 칩 버튼 줄: 지우기와 +5 +10 +25 +50 */
  private drawBetRow(y: number): void {
    const full = GAME_WIDTH - MARGIN * 2;
    const clearWidth = 44;
    const gap = 4;
    const chipWidth = (full - clearWidth - gap * CHIP_STEPS.length) / CHIP_STEPS.length;
    this.betButtons.push(
      new PixelButton(this, { x: MARGIN, y, width: clearWidth, height: BET_ROW_H, label: '지우기', onTap: () => this.setBet(0) }),
    );
    CHIP_STEPS.forEach((step, index) => {
      this.betButtons.push(
        new PixelButton(this, {
          x: MARGIN + clearWidth + gap + index * (chipWidth + gap),
          y,
          width: chipWidth,
          height: BET_ROW_H,
          label: `+${step}`,
          style: CHIP_STYLES[index],
          onTap: () => this.setBet(this.betAmount + step),
        }),
      );
    });
    for (const button of this.betButtons) button.setDepth(DEPTH.base);
  }

  private setBet(amount: number): void {
    const run = this.run;
    if (!run || this.busy || chipRunOver(run)) return;
    const next = Math.max(chipMinBet(run.chips), Math.min(run.chips, Math.floor(amount)));
    if (amount > run.chips && next === this.betAmount) {
      sfx.deny();
      this.say('가진 칩보다 많이 걸 수 없어요', PX_CSS.bad);
    }
    this.betAmount = next;
    this.refresh();
  }

  private refreshChips(run: ChipRun): void {
    this.betAmount = Math.max(chipMinBet(run.chips), Math.min(run.chips, this.betAmount || run.bet));
    this.scoreText.setText(String(run.chips));
    this.roundText.setText(`${Math.min(CHIP_ROUNDS, run.round + (chipRunOver(run) ? 0 : 1))}/${CHIP_ROUNDS}번째`);
    this.streakText.setText(run.streak > 1 ? `연속 ${run.streak}` : '').setColor(run.streak >= 3 ? PX_CSS.accent : PX_CSS.text);
    this.deckText.setText(`남은 카드 ${run.deck.length}장`);
    const versus = this.friends.room?.game ?? null;
    this.foeText.setText(versus ? this.foeLine(versus) : '');
    if (this.friends.match) this.subText.setText(this.friends.scoreLine());
    if (!this.promptText.text || this.promptText.getData('sticky') !== true) {
      this.promptText.setText(this.myChipTurn() ? `${this.betAmount}칩을 걸고 골라요` : this.waitLine()).setColor(PX_CSS.sub);
    }
    this.promptText.setData('sticky', false);
    const canAct = this.myChipTurn();
    for (const button of this.buttons) {
      const rate10 = rate10For(button.guess, run.current.rank, run.deck);
      button.enabled = rate10 > 0 && canAct;
      const gain = payoutFor(this.betAmount, rate10) - this.betAmount;
      button.points.setText(rate10 > 0 ? `+${gain}칩` : '나올 카드 없음');
      button.points.setFontSize(rate10 > 0 ? 13 : 10);
      button.chance.setText(rate10 > 0 ? `${rateLabel(rate10)} · ${Math.round(winChance(button.guess, run.current.rank, run.deck) * 100)}%` : '');
      button.draw(false);
    }
    for (const button of this.betButtons) button.setEnabled(canAct);
    this.skipLabel.setText(run.skips > 0 ? `넘기기 (${run.skips}번 남음)` : '넘기기를 다 썼어요');
    this.skipDraw(false);
    this.history = run.history.map((step) => ({ card: step.card, outcome: step.verdict }));
    this.drawHistory();
  }

  /** 지금 내가(한 폰이면 지금 폰을 든 사람이) 고를 수 있는지 */
  private myChipTurn(): boolean {
    const run = this.run;
    if (!run || chipRunOver(run) || !this.playing) return false;
    return this.friends.match ? this.friends.myTurn() : true;
  }

  private waitLine(): string {
    const room = this.friends.room;
    const view = room?.game;
    if (!room || !view) return '';
    if (room.status !== 'playing') return '';
    if (chipRunOver(view.mine)) return `${withSubject(this.friends.foeName)} 같은 카드로 하는 중이에요`;
    return `${withSubject(this.friends.foeName)} 먼저 하는 중이에요`;
  }

  /** 상대의 진행 한 줄 */
  private foeLine(view: HighLowView): string {
    const foe = view.foe;
    const name = this.friends.foeName;
    if (foe.done) return `${name}: 끝! ${foe.chips}칩 남김`;
    if (foe.round === 0 && !chipRunOver(view.mine)) return `${name}: 내가 다 하면 같은 카드로 해요`;
    return `${name}: ${foe.round}/${CHIP_ROUNDS}번째 · ${foe.chips}칩`;
  }

  private chipGuessTap(guess: Guess): void {
    const run = this.run;
    if (!run || this.busy || !this.myChipTurn()) return;
    const rate10 = rate10For(guess, run.current.rank, run.deck);
    if (rate10 === 0) {
      sfx.deny();
      return;
    }
    if (this.friends.match) {
      this.sendMove({ type: 'guess', guess, bet: this.betAmount });
      return;
    }
    const outcome = chipGuess(run, guess, this.betAmount);
    if (!outcome) return;
    this.betAmount = run.bet;
    this.reveal(outcome.next, () => this.afterChipStep(run));
  }

  private chipSkipTap(): void {
    const run = this.run;
    if (!run || this.busy || !this.myChipTurn() || run.skips <= 0) {
      if (run && run.skips <= 0) sfx.deny();
      return;
    }
    if (this.friends.match) {
      this.sendMove({ type: 'skip' });
      return;
    }
    const card = chipSkip(run);
    if (!card) return;
    this.reveal(card, () => this.afterChipStep(run));
  }

  /** 한 장을 뒤집은 뒤: 결과를 알리고, 판이 끝났으면 마친다. */
  private afterChipStep(run: ChipRun): void {
    const step = run.history[run.history.length - 1];
    if (step) this.announceStep(step.verdict, step.net);
    this.refresh();
    if (!this.friends.match && chipRunOver(run)) this.finishChips(run);
  }

  private announceStep(verdict: Verdict | 'skip', net: number): void {
    if (verdict === 'win') {
      sfx.hit(this.run?.streak ?? 1);
      vibrate(10);
      this.float(`+${net}칩`, PX_CSS.good);
      this.say(`맞혔어요! ${net}칩을 땄어요`, PX_CSS.good);
    } else if (verdict === 'tie') {
      sfx.click();
      this.float('같은 숫자', PX_CSS.sky);
      this.say('같은 숫자라서 건 칩을 돌려받아요', PX_CSS.sky);
    } else if (verdict === 'lose') {
      sfx.miss();
      vibrate(30);
      this.cameras.main.shake(110, 0.008);
      this.float(`${net}칩`, PX_CSS.bad);
      this.say(this.run && this.run.chips <= 0 ? '칩을 다 잃었어요' : '틀렸어요. 건 칩을 잃었어요', PX_CSS.bad);
    } else {
      this.say('카드를 넘겼어요', PX_CSS.sub);
    }
  }

  private finishChips(run: ChipRun): void {
    const beat = chipRecord.add(run.chips);
    const change = run.chips - CHIP_START;
    this.say(run.chips <= 0 ? '칩을 다 잃었어요' : beat ? `새 기록! 칩 ${run.chips}개` : `끝! 남은 칩 ${run.chips}개`, run.chips <= 0 ? PX_CSS.bad : PX_CSS.accent);
    this.finishMiniGame(
      run.chips,
      [
        ['처음보다', change >= 0 ? `+${change}칩` : `${change}칩`],
        ['맞힌 카드', `${run.wins}장`],
        ['최고 연속', `${run.bestStreak}번`],
        ['가장 많던 칩', `${run.peak}개`],
      ],
      1200,
    );
  }

  protected override coinsForScore(score: number): number {
    return this.run ? chipCoins(score) : super.coinsForScore(score);
  }

  /** 칩 걸기는 하트 모드의 최고 점수, 랭킹과 견줄 수 없어서 공용 기록에 넣지 않는다(코인은 받는다). */
  protected override offRecordNote(): string | null {
    return this.run ? '칩 걸기는 하트 모드 기록과 따로 세요' : null;
  }

  protected override retryData(): object {
    return { mode: this.run ? 'chips' : 'hearts' } satisfies HighLowStart;
  }

  override onBackRequest(): void {
    if (this.friends.back()) return;
    if (!this.playing && !this.friends.active) fadeToScene(this, homeScene());
    else this.pauseGame();
  }

  protected override pauseGame(): void {
    if (!this.playing) return;
    super.pauseGame();
  }

  protected override restartLabel(): string | null {
    return this.friends.restartLabel();
  }

  protected override quitWarning(): string | null {
    return this.friends.quitWarning();
  }

  // ───────── 친구와 하기 ─────────

  private onRoom(room: RoomView<HighLowView>, fresh: boolean): void {
    const view = room.game;
    if (!view) return;
    const previous = this.run;
    const before = previous ? { current: previous.current, steps: previous.history.length } : null;
    this.run = view.mine;
    if (!this.versusBuilt) {
      this.versusBuilt = true;
      this.betAmount = view.mine.bet;
      this.buildBoard();
      this.currentCard = this.makeFace(view.mine.current, this.currentX, this.cardY).setDepth(DEPTH.card);
      this.addPauseButton();
    }
    this.playing = room.status === 'playing';
    if (this.viewSeat !== room.seat && this.viewSeat !== null) fresh = true;
    this.viewSeat = room.seat;
    if (fresh) {
      this.seenMoves = -1;
      this.betAmount = view.mine.bet;
      this.currentCard.destroy();
      this.currentCard = this.makeFace(view.mine.current, this.currentX, this.cardY).setDepth(DEPTH.card);
    }
    const moved = view.moves !== this.seenMoves;
    this.seenMoves = view.moves;
    // 내 판에 새 카드가 나왔으면 뒤집어 보이고 결과를 알린다.
    if (!fresh && moved && before && view.mine.history.length > before.steps) {
      this.betAmount = view.mine.bet;
      const run = view.mine;
      this.reveal(run.current, () => this.afterChipStep(run));
      return;
    }
    this.refresh();
  }

  private sendMove(move: HighLowMove): void {
    this.busy = true;
    void this.friends.send(move).then((ok) => {
      this.busy = false;
      if (!ok) this.refresh();
    });
  }

  /** 폰을 넘길 때 다음 사람에게 보일 한 줄: 앞사람이 남긴 칩 */
  private coverNote(): string | null {
    const view = this.friends.room?.game;
    if (!view || !view.foe.done) return '같은 카드 순서로 칩을 더 많이 남기면 이겨요';
    return `${withSubject(this.friends.foeName)} ${view.foe.chips}칩을 남겼어요. 넘어 봐요!`;
  }

  private friendResult(room: RoomView<HighLowView>): FriendsResult & { won: boolean | null } {
    const view = room.game!;
    const mine = view.mine.chips;
    const theirs = view.foe.chips;
    const local = this.friends.kind === 'local';
    const won = mine === theirs ? null : mine > theirs;
    const me = this.friends.myName;
    const foe = this.friends.foeName;
    const title = won === null ? '비겼어요' : local ? `${withSubject(won ? me : foe)} 이겼어요!` : won ? '이겼어요!' : '졌어요';
    const lines = [`남은 칩  ${me} ${mine} · ${foe} ${theirs}`, `맞힌 카드  ${me} ${view.mine.wins}장 · ${foe} ${view.foe.wins}장`];
    return { title, lines, bright: local ? won !== null : won === true, lost: !local && won === false, won };
  }
}
