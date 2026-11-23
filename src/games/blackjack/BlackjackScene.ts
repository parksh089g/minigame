import Phaser from 'phaser';
import { GAME_WIDTH, SCENE } from '../../config';
import { vibrate } from '../../core/haptics';
import { sfx } from '../../core/sfx';
import { homeScene } from '../../core/home';
import { addText, drawPanel, fadeToScene, PixelButton, type ButtonStyle } from '../../core/ui';
import { MiniGameScene } from '../../scenes/MiniGameScene';
import { FriendsKit, type FriendsResult, type FriendsStart } from '../../versus/friends-kit';
import type { RoomView, Seat as RoomSeat } from '../../versus/protocol';
import { withSubject } from '../../versus/text';
import { PX, PX_CSS, rankSize, rankTexture, registerCardBase, registerHighLowTextures, suitTexture } from '../high-low/art';
import { isRed } from '../high-low/rules';
import {
  activeHand,
  addToBet,
  availableActions,
  BLACKJACK_GAME_ID,
  CHIP_STEPS,
  deal,
  dealerDraw,
  dealerShouldHit,
  double,
  createTable,
  handTotal,
  hit,
  minBetFor,
  RESULT_LABEL,
  ROUNDS,
  runOver,
  setBet,
  settle,
  split,
  stand,
  START_CHIPS,
  totalLabel,
  type Action,
  type Card,
  type HandResult,
  type Seat,
  type Table,
} from './rules';
import { blackjackTurn, blackjackVersus, readBlackjackView, type BlackjackMove, type BlackjackView } from './versus';

/** 씬을 열 때 넘기는 값. solo면 준비 화면을 건너뛰고 바로 혼자 하는 판을 연다("다시 하기"). */
export interface BlackjackStart extends FriendsStart {
  solo?: boolean;
}

/** 이 화면에서 쓰는 카드 크기(논리 px). 하이로우의 카드 그림을 작게 등록해 쓴다. */
const CARD_W = 52;
const CARD_H = 72;
const TEX = { face: 'bj-face', back: 'bj-back' } as const;
/** 겹쳐 놓을 때 다음 카드가 비켜 앉는 거리 */
const FAN = 18;
const MARGIN = 8;
const BUTTON_H = 34;
const DEPTH = { back: -10, felt: -5, base: 0, card: 5, moving: 10, float: 20 } as const;
/** 딜러가 카드를 한 장씩 받는 사이 */
const DEALER_STEP_MS = 520;
/** 친구와 할 때 두 자리의 카드를 줄여 그리는 배율 */
const SEAT_SCALE = 0.7;
/** 친구와 할 때 한 자리가 차지하는 폭 */
const SEAT_W = (GAME_WIDTH - MARGIN * 2 - 8) / 2;

/** 초록 카지노 탁자(행운 슬롯과 같은 색) */
const FELT = { base: 0x1b7350, glow: 0x239066, mark: 0x176646, rim: 0x5d3a1a, rimLight: 0x8a5a2b } as const;

const RESULT_COLOR: Readonly<Record<HandResult, string>> = {
  blackjack: PX_CSS.accent,
  win: PX_CSS.good,
  push: PX_CSS.sky,
  lose: PX_CSS.bad,
  bust: PX_CSS.bad,
};

/** 칩 버튼 색: 5, 10, 25, 50 */
const CHIP_COLORS: readonly number[] = [PX.white, PX.red, PX.green, PX.blue];
const CHIP_STYLES: readonly ButtonStyle[] = ['neutral', 'red', 'green', 'blue'];

interface DrawnCard {
  key: string;
  card: Card;
  hidden: boolean;
  x: number;
  y: number;
  scale: number;
}

/**
 * 블랙잭: 칩을 걸고 딜러보다 21에 가깝게 만든다. 히트, 스탠드, 더블, 스플릿을 할 수 있다.
 * 한 판은 열 번의 딜이고, 칩 100개로 시작해서 남은 칩이 점수가 된다. 칩을 다 잃으면 거기서 끝난다.
 * 칩은 이 게임 안에서만 쓰이고 앱의 코인과는 따로다.
 * 규칙(rules.ts)은 자리 여럿을 받는 탁자로 짜여 있고, 이 화면은 그중 한 자리만 쓴다.
 */
export class BlackjackScene extends MiniGameScene {
  protected readonly gameId = BLACKJACK_GAME_ID;

  table!: Table;
  /** 내 자리. 혼자 할 때는 0, 친구와 할 때는 방에서 앉은 자리(한 폰이면 지금 차례인 자리) */
  private me = 0;
  /** 친구와 하기. 자동 점검이 들여다본다. */
  friends!: FriendsKit<BlackjackView, BlackjackMove>;
  /** 친구와 하는 판의 화면(탁자, 버튼)을 그렸는지 */
  private versusBuilt = false;
  /** 친구와 할 때 다음에 걸 칩(보내기 전) */
  private pendingBet = 0;
  /** 마지막으로 알린 수의 번호 */
  private seenMoves = -1;
  private busy = false;
  /** 다음 판에 걸 칩을 고르는 중인지 */
  private betting = false;
  private wins = 0;
  private blackjacks = 0;
  private peak = START_CHIPS;

  private dealerY = 0;
  private playerY = 0;
  private messageY = 0;
  private shoeX = 0;
  private shoeY = 0;
  /** 지금 그려 둔 카드(열쇠 → 엎었는지). 새로 생긴 카드만 슈에서 날아오게 한다. */
  private shown = new Map<string, boolean>();
  private cardLayer!: Phaser.GameObjects.Container;
  private labelLayer!: Phaser.GameObjects.Container;

  private chipsText!: Phaser.GameObjects.Text;
  private roundText!: Phaser.GameObjects.Text;
  private dealerText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private betText!: Phaser.GameObjects.Text;
  private betChips!: Phaser.GameObjects.Graphics;

  private chipButtons: PixelButton[] = [];
  private clearButton!: PixelButton;
  private dealButton!: PixelButton;
  private actionButtons = new Map<Action, PixelButton>();

  constructor() {
    super(SCENE.blackjack);
  }

  create(data: BlackjackStart = {}): void {
    this.beginMiniGame();
    registerHighLowTextures(this);
    registerCardBase(this, TEX.face, TEX.back, CARD_W, CARD_H);
    this.table = createTable(1);
    this.me = 0;
    this.versusBuilt = false;
    this.pendingBet = 0;
    this.seenMoves = -1;
    this.busy = false;
    this.betting = false;
    this.wins = 0;
    this.blackjacks = 0;
    this.peak = START_CHIPS;
    this.shown = new Map();
    this.chipButtons = [];
    this.actionButtons = new Map();
    this.friends = new FriendsKit<BlackjackView, BlackjackMove>(this, {
      game: 'blackjack',
      title: '블랙잭',
      rules: blackjackVersus,
      readView: readBlackjackView,
      isMyTurn: (room) => {
        const view = room.game;
        return !!view && this.turnOf(view) === room.seat;
      },
      cover: false,
      onRoom: (room, fresh) => this.onRoom(room, fresh),
      result: (room) => this.friendResult(room),
      onClosed: () => this.hideControls(),
      say: (text, warn) => this.say(text, warn ? PX_CSS.bad : PX_CSS.text),
      restart: (start) => this.scene.restart(start satisfies BlackjackStart),
    });
    if (this.friends.begin(data)) return;
    if (data.solo) this.startSolo();
    else this.openLobby();
  }

  /** 혼자 하는 판(칩 100개로 열 판) */
  private startSolo(): void {
    this.buildTable();
    this.addPauseButton();
    this.enterBetting(true);
    this.playing = true;
    // 처음 하는 사람에게는 규칙 안내서를 한 번 띄운다. 그 사이에 이미 딜했으면 띄우지 않는다.
    this.offerRuleBook(() => this.table.round === 0 && !this.busy);
  }

  /** 준비 화면: 혼자 하기와 친구와 함께 */
  private openLobby(): void {
    const { height } = this.scale;
    this.drawBackdrop();
    new PixelButton(this, { x: MARGIN, y: 8, width: 26, height: 26, icon: 'icon-back', hitPadding: 6, onTap: () => fadeToScene(this, homeScene()) });
    addText(this, 42, 21, '블랙잭', { size: 16, color: PX_CSS.accent, originY: 0.5, shadow: PX_CSS.dark });
    const rulesX = GAME_WIDTH - MARGIN - 44;
    new PixelButton(this, { x: rulesX, y: 8, width: 44, height: 26, label: '규칙', style: 'yellow', hitPadding: 4, onTap: () => this.openRuleBook() });
    this.offerRuleBook(() => !this.playing && !this.friends.active);

    const mid = Math.round(height * 0.36);
    // 탁자 위에 놓인 카드 두 장과 칩 더미
    const ace = this.makeFace({ rank: 1, suit: 'spade' }).setPosition(GAME_WIDTH / 2 - 16, mid - 40).setAngle(-8);
    const king = this.makeFace({ rank: 13, suit: 'heart' }).setPosition(GAME_WIDTH / 2 + 16, mid - 36).setAngle(8);
    ace.setDepth(DEPTH.card);
    king.setDepth(DEPTH.card);
    const chips = this.add.graphics().setDepth(DEPTH.card + 1);
    [PX.red, PX.green, PX.blue, PX.white].forEach((color, index) => this.drawChip(chips, GAME_WIDTH / 2 + 52, mid - 10 - index * 3, color, 7));
    const box = this.add.graphics();
    this.panel(box, MARGIN + 6, mid + 10, GAME_WIDTH - MARGIN * 2 - 12, 74);
    const lines = ['딜러보다 21에 가깝게 만들어요', `놀이 칩 ${START_CHIPS}개로 ${ROUNDS}판, 남은 칩이 점수예요`, '친구와는 같은 딜러를 두고 칩을 겨뤄요'];
    lines.forEach((line, index) => addText(this, GAME_WIDTH / 2, mid + 24 + index * 18, line, { size: 10, color: index === 2 ? PX_CSS.accent : PX_CSS.text, originX: 0.5, originY: 0.5 }));

    const bottom = height - MARGIN - 36;
    this.friends.lobbyButton(MARGIN, bottom, 92, 36);
    new PixelButton(this, {
      x: MARGIN + 98,
      y: bottom,
      width: GAME_WIDTH - MARGIN * 2 - 98,
      height: 36,
      label: '혼자 하기',
      style: 'pink',
      onTap: () => this.scene.restart({ solo: true } satisfies BlackjackStart),
    });
  }

  /** 초록 탁자 바탕만(준비 화면) */
  private drawBackdrop(): void {
    const { height } = this.scale;
    const g = this.add.graphics().setDepth(DEPTH.back);
    g.fillStyle(FELT.rim, 1);
    g.fillRect(0, 0, GAME_WIDTH, height);
    g.fillStyle(FELT.base, 1);
    g.fillRect(4, 40, GAME_WIDTH - 8, height - 44);
    g.fillStyle(FELT.rimLight, 1);
    g.fillRect(4, 38, GAME_WIDTH - 8, 2);
  }

  /** 판을 하는 화면: 탁자, 위쪽 줄, 버튼, 글 */
  private buildTable(): void {
    const { height } = this.scale;
    // 화면이 길면 남는 자리를 딜러와 사람 사이에 나눠 준다.
    const extra = Math.max(0, height - 400);
    const controlsTop = height - MARGIN - BUTTON_H * 2 - 6;
    this.dealerY = Math.round(62 + extra * 0.2 + CARD_H / 2);
    this.playerY = Math.round(controlsTop - 26 - CARD_H / 2 - extra * 0.2);
    this.messageY = Math.round((this.dealerY + CARD_H / 2 + 14 + this.playerY - CARD_H / 2 - 6) / 2);
    this.shoeX = GAME_WIDTH - MARGIN - CARD_W / 2 - 4;
    this.shoeY = this.dealerY;

    this.drawFelt();
    this.drawTop();
    this.drawControls(controlsTop);

    this.cardLayer = this.add.container(0, 0).setDepth(DEPTH.card);
    this.labelLayer = this.add.container(0, 0).setDepth(DEPTH.card + 1);
    this.dealerText = addText(this, GAME_WIDTH / 2, this.dealerY - CARD_H / 2 - 10, '', {
      size: 10,
      color: PX_CSS.text,
      originX: 0.5,
      originY: 0.5,
      shadow: PX_CSS.dark,
    }).setDepth(DEPTH.card + 1);
    this.messageText = addText(this, GAME_WIDTH / 2, this.messageY - 7, '', {
      size: 14,
      color: PX_CSS.text,
      originX: 0.5,
      originY: 0.5,
      stroke: PX_CSS.dark,
    }).setDepth(DEPTH.float);
    this.betChips = this.add.graphics().setDepth(DEPTH.base);
    this.betText = addText(this, GAME_WIDTH / 2, this.messageY + 13, '', {
      size: 10,
      color: PX_CSS.accent,
      originX: 0.5,
      originY: 0.5,
      shadow: PX_CSS.dark,
    }).setDepth(DEPTH.float);
  }

  private get seat(): Seat {
    return this.table.seats[this.me];
  }

  private get versus(): boolean {
    return this.friends.match !== null;
  }

  // ───────── 화면 구성 ─────────

  private drawFelt(): void {
    const { height } = this.scale;
    const g = this.add.graphics().setDepth(DEPTH.back);
    // 나무 테두리 위에 초록 천. 띠로 나눠 칠해 픽셀 느낌의 계단 그러데이션을 만든다.
    g.fillStyle(FELT.rim, 1);
    g.fillRect(0, 0, GAME_WIDTH, height);
    const bands = 8;
    const from = Phaser.Display.Color.ValueToColor(FELT.glow);
    const to = Phaser.Display.Color.ValueToColor(FELT.mark);
    for (let i = 0; i < bands; i += 1) {
      const mixed = Phaser.Display.Color.Interpolate.ColorWithColor(from, to, bands - 1, i);
      g.fillStyle(Phaser.Display.Color.GetColor(mixed.r, mixed.g, mixed.b), 1);
      g.fillRect(4, 40 + Math.floor(((height - 44) * i) / bands), GAME_WIDTH - 8, Math.ceil((height - 44) / bands) + 1);
    }
    g.fillStyle(FELT.rimLight, 1);
    g.fillRect(4, 38, GAME_WIDTH - 8, 2);

    // 천에 새긴 글: 딜러 카드 바로 아래
    const markY = this.dealerY + CARD_H / 2 + 12;
    g.lineStyle(1, 0xffffff, 0.16);
    g.lineBetween(24, markY - 7, GAME_WIDTH - 24, markY - 7);
    addText(this, GAME_WIDTH / 2, markY, '블랙잭은 1.5배 · 딜러는 17에서 멈춰요', {
      size: 8,
      color: '#bfe8cf',
      originX: 0.5,
      originY: 0.5,
    })
      .setAlpha(0.75)
      .setDepth(DEPTH.felt);

    // 오른쪽 위의 카드 묶음(슈)
    for (let i = 2; i >= 0; i -= 1) {
      this.add
        .image(this.shoeX + i * 1.5, this.shoeY + i * 1.5, TEX.back)
        .setDepth(DEPTH.base)
        .setTint(i === 0 ? 0xffffff : i === 1 ? 0xb8c0d0 : 0x8892a8);
    }
  }

  private panel(g: Phaser.GameObjects.Graphics, x: number, y: number, width: number, height: number): void {
    drawPanel(g, x, y, width, height, { fill: PX.panel, border: PX.edge, shadow: PX.ink, radius: 3, depth: 3 });
  }

  private drawTop(): void {
    addText(this, 40, 7, '블랙잭', { size: 14, color: PX_CSS.text, shadow: PX_CSS.dark });
    this.roundText = addText(this, 40, 25, '', { size: 9, color: '#d8f2e2' });

    const width = 82;
    const left = GAME_WIDTH - MARGIN - width;
    this.panel(this.add.graphics(), left, 7, width, 24);
    this.drawChip(this.add.graphics(), left + 12, 19, PX.yellow);
    this.chipsText = addText(this, left + width - 8, 19, '', { size: 14, color: PX_CSS.accent, originX: 1, originY: 0.5 });
  }

  /** 칩 하나: 색 테두리에 흰 눈금 */
  private drawChip(g: Phaser.GameObjects.Graphics, x: number, y: number, color: number, radius = 6): void {
    g.fillStyle(PX.ink, 1);
    g.fillCircle(x, y + 1, radius + 1);
    g.fillStyle(color, 1);
    g.fillCircle(x, y, radius);
    g.fillStyle(color === PX.white ? PX.silver : PX.white, 1);
    for (let i = 0; i < 4; i += 1) {
      const angle = (Math.PI / 2) * i;
      g.fillRect(Math.round(x + Math.cos(angle) * (radius - 2)) - 1, Math.round(y + Math.sin(angle) * (radius - 2)) - 1, 2, 2);
    }
    g.lineStyle(1, color === PX.white ? PX.silver : PX.white, 0.7);
    g.strokeCircle(x, y, radius - 3.5);
  }

  private drawControls(top: number): void {
    const row2 = top + BUTTON_H + 6;
    const fullWidth = GAME_WIDTH - MARGIN * 2;

    // 베팅: 칩 네 개, 아래에 지우기와 딜하기
    const chipWidth = (fullWidth - 6 * 3) / 4;
    CHIP_STEPS.forEach((step, index) => {
      this.chipButtons.push(
        new PixelButton(this, {
          x: MARGIN + index * (chipWidth + 6),
          y: top,
          width: chipWidth,
          height: BUTTON_H,
          label: `+${step}`,
          style: CHIP_STYLES[index],
          onTap: () => this.addChips(step),
        }),
      );
    });
    const clearWidth = 70;
    this.clearButton = new PixelButton(this, {
      x: MARGIN,
      y: row2,
      width: clearWidth,
      height: BUTTON_H,
      label: '지우기',
      onTap: () => this.clearBet(),
    });
    this.dealButton = new PixelButton(this, {
      x: MARGIN + clearWidth + 6,
      y: row2,
      width: fullWidth - clearWidth - 6,
      height: BUTTON_H,
      label: '딜하기',
      style: 'pink',
      onTap: () => this.startDeal(),
    });

    // 판: 히트와 스탠드, 아래에 더블과 스플릿
    const half = (fullWidth - 6) / 2;
    const specs: ReadonlyArray<{ action: Action; label: string; style: ButtonStyle; x: number; y: number }> = [
      { action: 'hit', label: '히트 (한 장 더)', style: 'green', x: MARGIN, y: top },
      { action: 'stand', label: '스탠드 (멈춤)', style: 'red', x: MARGIN + half + 6, y: top },
      { action: 'double', label: '더블', style: 'yellow', x: MARGIN, y: row2 },
      { action: 'split', label: '스플릿', style: 'blue', x: MARGIN + half + 6, y: row2 },
    ];
    for (const spec of specs) {
      this.actionButtons.set(
        spec.action,
        new PixelButton(this, {
          x: spec.x,
          y: spec.y,
          width: half,
          height: BUTTON_H,
          label: spec.label,
          style: spec.style,
          onTap: () => this.act(spec.action),
        }),
      );
    }
  }

  // ───────── 카드 ─────────

  private makeFace(card: Card): Phaser.GameObjects.Container {
    const red = isRed(card.suit);
    const size = rankSize(card.rank);
    const left = -CARD_W / 2 + 5;
    const top = -CARD_H / 2 + 5;
    const cornerX = left + Math.max(size.width, 14) / 2;
    return this.add.container(0, 0, [
      this.add.image(0, 0, TEX.face),
      this.add.image(cornerX, top + size.height / 2, rankTexture(card.rank, red)),
      this.add.image(cornerX, top + size.height + 9, suitTexture(card.suit, 'small')),
      this.add.image(4, 10, suitTexture(card.suit, 'big')),
    ]);
  }

  /** 카드 n장을 가운데 x에 겹쳐 놓을 때 첫 카드의 가운데와 비켜 앉는 거리. 자리 폭을 넘지 않게 좁힌다. */
  private fanOf(count: number, room: number): number {
    if (count <= 1) return FAN;
    return Math.min(FAN, (room - CARD_W) / (count - 1));
  }

  private layout(): DrawnCard[] {
    const drawn: DrawnCard[] = [];
    const { table } = this;
    const dealerFan = this.fanOf(table.dealer.length, GAME_WIDTH - 80);
    const dealerLeft = GAME_WIDTH / 2 - 20 - ((table.dealer.length - 1) * dealerFan) / 2;
    table.dealer.forEach((card, index) => {
      drawn.push({
        key: `d${index}`,
        card,
        hidden: index === 1 && table.holeHidden,
        x: dealerLeft + index * dealerFan,
        y: this.dealerY,
        scale: 1,
      });
    });
    if (this.versus) {
      table.seats.forEach((seat, seatIndex) => {
        seat.hands.forEach((hand, handIndex) => {
          const { center, room } = this.handSpot(seatIndex, handIndex, seat.hands.length);
          const width = CARD_W * SEAT_SCALE;
          const fan = hand.cards.length > 1 ? Math.min(FAN * SEAT_SCALE, (room - width) / (hand.cards.length - 1)) : 0;
          const left = center - ((hand.cards.length - 1) * fan) / 2;
          hand.cards.forEach((card, index) => {
            drawn.push({ key: `s${seatIndex}-${handIndex}-${index}`, card, hidden: false, x: left + index * fan, y: this.playerY, scale: SEAT_SCALE });
          });
        });
      });
      return drawn;
    }
    const hands = this.seat.hands;
    const room = hands.length > 1 ? (GAME_WIDTH - MARGIN * 2 - 8) / 2 : GAME_WIDTH - MARGIN * 2;
    hands.forEach((hand, handIndex) => {
      const center = hands.length > 1 ? MARGIN + room / 2 + handIndex * (room + 8) : GAME_WIDTH / 2;
      const fan = this.fanOf(hand.cards.length, room);
      const left = center - ((hand.cards.length - 1) * fan) / 2;
      hand.cards.forEach((card, index) => {
        drawn.push({ key: `h${handIndex}-${index}`, card, hidden: false, x: left + index * fan, y: this.playerY, scale: 1 });
      });
    });
    return drawn;
  }

  /**
   * 탁자의 카드를 다시 그린다. 새로 생긴 카드는 슈에서 날아오고, 엎었던 카드가 펼쳐지면 뒤집힌다.
   * 날아오는 카드는 차례로 늦춰서 나눠 주는 느낌을 낸다. 다 그리면 done을 부른다.
   */
  private render(done?: () => void): void {
    this.cardLayer.removeAll(true);
    const next = new Map<string, boolean>();
    let delay = 0;
    let last = 0;
    for (const item of this.layout()) {
      next.set(item.key, item.hidden);
      const object = item.hidden ? this.add.image(0, 0, TEX.back) : this.makeFace(item.card);
      object.setPosition(item.x, item.y).setScale(item.scale);
      this.cardLayer.add(object);
      const before = this.shown.get(item.key);
      if (before === undefined) {
        object.setPosition(this.shoeX, this.shoeY).setAlpha(0);
        this.tweens.add({
          targets: object,
          x: item.x,
          y: item.y,
          alpha: 1,
          delay,
          duration: 200,
          ease: 'Cubic.Out',
          onStart: () => sfx.flip(),
        });
        last = delay + 200;
        delay += 140;
      } else if (before && !item.hidden) {
        // 엎었던 카드를 펼친다.
        object.setScale(0, item.scale);
        this.tweens.add({ targets: object, scaleX: item.scale, delay, duration: 140, onStart: () => sfx.flip() });
        last = delay + 140;
        delay += 140;
      }
    }
    this.shown = next;
    this.renderLabels();
    if (done) this.time.delayedCall(last + 40, done);
  }

  /** 합과 건 칩을 적는다. 스플릿한 손은 지금 하는 손에 노란 테를 두른다. */
  private renderLabels(): void {
    this.labelLayer.removeAll(true);
    const { table } = this;
    if (table.dealer.length === 0) {
      this.dealerText.setText('딜러');
    } else if (table.holeHidden) {
      this.dealerText.setText(`딜러 ${totalLabel([table.dealer[0]])} + ?`);
    } else {
      this.dealerText.setText(`딜러 ${totalLabel(table.dealer)}`);
    }
    if (this.versus) {
      this.renderSeatLabels();
      return;
    }

    const hands = this.seat.hands;
    const current = activeHand(table);
    const room = hands.length > 1 ? (GAME_WIDTH - MARGIN * 2 - 8) / 2 : GAME_WIDTH - MARGIN * 2;
    hands.forEach((hand, index) => {
      const center = hands.length > 1 ? MARGIN + room / 2 + index * (room + 8) : GAME_WIDTH / 2;
      const y = this.playerY + CARD_H / 2 + 10;
      const parts = hand.result === 'blackjack' ? [] : [totalLabel(hand.cards, hand.fromSplit)];
      if (hand.result) parts.push(RESULT_LABEL[hand.result]);
      else parts.push(`베팅 ${hand.bet}${hand.doubled ? ' (더블)' : ''}`);
      const color = hand.result ? RESULT_COLOR[hand.result] : handTotal(hand.cards).total > 21 ? PX_CSS.bad : PX_CSS.text;
      this.labelLayer.add(addText(this, center, y, parts.join(' · '), { size: 10, color, originX: 0.5, originY: 0.5, shadow: PX_CSS.dark }));
      if (hands.length > 1 && hand === current) {
        const g = this.add.graphics();
        g.lineStyle(2, PX.yellow, 1);
        g.strokeRect(center - room / 2 + 2, this.playerY - CARD_H / 2 - 5, room - 4, CARD_H + 10);
        this.labelLayer.add(g);
      }
    });
  }

  // ───────── 위쪽 글과 버튼 ─────────

  private refreshTop(): void {
    this.chipsText.setText(String(this.seat.chips));
    if (this.versus) {
      const round = Math.min(ROUNDS, Math.max(1, this.table.round + (this.table.phase === 'settled' || this.table.phase === 'betting' ? 1 : 0)));
      this.roundText.setText(`${round}/${ROUNDS}판 · ${this.friends.scoreLine()}`);
      return;
    }
    const round = Math.min(ROUNDS, this.table.round + (this.betting ? 1 : 0));
    this.roundText.setText(`${round}/${ROUNDS}번째 판`);
  }

  private say(label: string, color: string = PX_CSS.text): void {
    this.messageText.setText(label).setColor(color);
    this.tweens.killTweensOf(this.messageText);
    this.messageText.setScale(1.2);
    this.tweens.add({ targets: this.messageText, scale: 1, duration: 160, ease: 'Back.Out' });
  }

  /** 거는 칩을 탁자 가운데에 칩 더미로 보여 준다 */
  private showBet(amount: number | null): void {
    this.betChips.clear();
    if (amount === null || amount <= 0) {
      this.betText.setText('');
      return;
    }
    this.betText.setText(`베팅 ${amount}`);
    const stacks: number[] = [];
    let left = amount;
    for (let i = CHIP_STEPS.length - 1; i >= 0 && stacks.length < 8; i -= 1) {
      while (left >= CHIP_STEPS[i] && stacks.length < 8) {
        stacks.push(i);
        left -= CHIP_STEPS[i];
      }
    }
    if (stacks.length === 0) stacks.push(0);
    const x = GAME_WIDTH / 2 + this.betText.width / 2 + 14;
    stacks.forEach((index, n) => this.drawChip(this.betChips, x, this.messageY + 15 - n * 3, CHIP_COLORS[index], 6));
  }

  private showBetting(visible: boolean): void {
    for (const button of this.chipButtons) button.setVisible(visible);
    this.clearButton.setVisible(visible);
    this.dealButton.setVisible(visible);
  }

  private showActions(visible: boolean): void {
    const can = availableActions(this.table);
    for (const [action, button] of this.actionButtons) {
      button.setVisible(visible);
      if (visible) button.setEnabled(can[action]);
    }
  }

  private refreshBetButtons(): void {
    const seat = this.seat;
    this.dealButton.setLabel(`딜하기 · ${seat.bet}칩`);
    this.chipButtons.forEach((button, index) => button.setEnabled(seat.bet + CHIP_STEPS[index] <= seat.chips || seat.bet < seat.chips));
    this.clearButton.setEnabled(seat.bet > minBetFor(seat.chips));
    this.showBet(seat.bet);
  }

  // ───────── 베팅 ─────────

  private enterBetting(first = false): void {
    this.busy = false;
    this.betting = true;
    this.showActions(false);
    this.showBetting(true);
    this.refreshBetButtons();
    this.refreshTop();
    if (first) {
      this.say('칩을 걸고 딜하기를 눌러요', PX_CSS.text);
      this.render();
    } else {
      this.say(this.seat.chips < START_CHIPS / 4 ? '칩이 얼마 안 남았어요. 조심!' : '다음 판에 걸 칩을 골라요', PX_CSS.sub);
    }
  }

  private addChips(step: number): void {
    if (this.versus) {
      this.versusAddChips(step);
      return;
    }
    if (!this.playing || this.busy || !this.betting) return;
    const before = this.seat.bet;
    const after = addToBet(this.table, this.me, step);
    if (after === before) {
      sfx.deny();
      this.say('가진 칩보다 많이 걸 수 없어요', PX_CSS.bad);
    }
    this.refreshBetButtons();
  }

  private clearBet(): void {
    if (this.versus) {
      this.pendingBet = minBetFor(this.seat.chips);
      this.refreshVersusBet();
      return;
    }
    if (!this.playing || this.busy || !this.betting) return;
    setBet(this.table, this.me, minBetFor(this.seat.chips));
    this.refreshBetButtons();
  }

  private startDeal(): void {
    if (this.versus) {
      this.sendMove({ type: 'bet', amount: this.pendingBet });
      return;
    }
    if (!this.playing || this.busy || !this.betting) return;
    this.shown = new Map();
    const outcome = deal(this.table);
    if (!outcome) {
      sfx.deny();
      return;
    }
    this.busy = true;
    this.betting = false;
    this.showBetting(false);
    this.showBet(this.seat.hands[0]?.bet ?? null);
    this.refreshTop();
    this.say(outcome.reshuffled && this.table.round > 1 ? '카드를 새로 섞었어요' : '', PX_CSS.sub);
    this.render(() => {
      if (outcome.dealerBlackjack) {
        this.say('딜러가 블랙잭이에요', PX_CSS.bad);
        this.time.delayedCall(450, () => this.onSettled());
        return;
      }
      this.afterMove();
    });
  }

  // ───────── 판 ─────────

  private act(action: Action): void {
    if (this.versus) {
      if (!this.friends.myTurn() || !availableActions(this.table)[action]) {
        sfx.deny();
        return;
      }
      this.sendMove({ type: action });
      return;
    }
    if (!this.playing || this.busy || this.table.phase !== 'playing') return;
    if (!availableActions(this.table)[action]) {
      sfx.deny();
      return;
    }
    this.busy = true;
    if (action === 'hit') hit(this.table);
    else if (action === 'stand') stand(this.table);
    else if (action === 'double') double(this.table);
    else split(this.table);
    if (action === 'double' || action === 'split') {
      this.refreshTop();
      this.showBet(this.seat.hands.reduce((sum, hand) => sum + hand.bet, 0));
    }
    this.showActions(false);
    this.render(() => this.afterMove());
  }

  /** 한 수를 둔 뒤: 아직 할 손이 있으면 버튼을 다시 보이고, 다 했으면 딜러 차례 */
  private afterMove(): void {
    const { table } = this;
    if (table.phase === 'playing') {
      this.busy = false;
      const hand = activeHand(table);
      if (hand && this.seat.hands.length > 1) {
        this.say(`${this.seat.active + 1}번째 손을 해요`, PX_CSS.sub);
      } else if (hand) {
        const total = handTotal(hand.cards).total;
        this.say(total >= 17 ? `${total}! 멈출까요?` : `${total}, 한 장 더 받을까요?`, PX_CSS.text);
      }
      this.renderLabels();
      this.showActions(true);
      return;
    }
    this.showActions(false);
    this.runDealer();
  }

  private runDealer(): void {
    const { table } = this;
    this.busy = true;
    const busted = this.seat.hands.every((hand) => handTotal(hand.cards).total > 21);
    this.say(busted ? '21을 넘었어요' : '딜러 차례예요', busted ? PX_CSS.bad : PX_CSS.sub);
    // 엎었던 카드를 먼저 펼친다.
    this.render(() => {
      const step = (): void => {
        if (dealerShouldHit(table)) {
          this.time.delayedCall(DEALER_STEP_MS, () => {
            dealerDraw(table);
            this.render(step);
          });
          return;
        }
        this.time.delayedCall(300, () => {
          settle(table);
          this.onSettled();
        });
      };
      step();
    });
  }

  private onSettled(): void {
    const seat = this.seat;
    let net = 0;
    for (const hand of seat.hands) {
      net += hand.payout - hand.bet;
      if (hand.result === 'win' || hand.result === 'blackjack') this.wins += 1;
      if (hand.result === 'blackjack') this.blackjacks += 1;
    }
    this.peak = Math.max(this.peak, seat.chips);
    this.renderLabels();
    this.refreshTop();
    this.showBet(null);

    const results = seat.hands.map((hand) => hand.result as HandResult);
    const best: HandResult = results.includes('blackjack')
      ? 'blackjack'
      : net > 0
        ? 'win'
        : net === 0
          ? 'push'
          : results.includes('bust') && results.every((r) => r === 'bust')
            ? 'bust'
            : 'lose';
    const amount = net > 0 ? `+${net}` : net < 0 ? `${net}` : '±0';
    const dealerBust = handTotal(this.table.dealer).total > 21;
    const head = best === 'win' && dealerBust ? '딜러 버스트! 이겼어요' : RESULT_LABEL[best];
    this.say(`${head}  ${amount}칩`, RESULT_COLOR[best]);
    this.floatChips(amount, RESULT_COLOR[best]);
    if (best === 'blackjack') {
      sfx.fanfare();
      vibrate(20);
    } else if (net > 0) {
      sfx.coin();
      vibrate(10);
    } else if (net < 0) {
      sfx.miss();
      vibrate(30);
      this.cameras.main.shake(100, 0.006);
    } else {
      sfx.click();
    }

    this.time.delayedCall(1300, () => {
      if (runOver(this.table)) {
        this.endRun();
        return;
      }
      this.enterBetting();
    });
  }

  private floatChips(label: string, color: string): void {
    const text = addText(this, GAME_WIDTH - MARGIN - 40, 40, label, {
      size: 13,
      color,
      originX: 0.5,
      originY: 0,
      stroke: PX_CSS.dark,
    }).setDepth(DEPTH.float);
    this.tweens.add({ targets: text, y: text.y + 14, alpha: 0, duration: 900, ease: 'Cubic.Out', onComplete: () => text.destroy() });
  }

  // ───────── 끝 ─────────

  private endRun(): void {
    const broke = this.seat.chips <= 0;
    this.busy = true;
    this.betting = false;
    this.showBetting(false);
    this.showActions(false);
    if (broke) this.say('칩을 다 잃었어요. 다음엔 100개로 다시!', PX_CSS.bad);
    else this.say(`${ROUNDS}판 끝! 남은 칩 ${this.seat.chips}개`, PX_CSS.accent);
    this.finish(1400);
  }

  private finish(delay: number): void {
    const chips = this.seat.chips;
    const change = chips - START_CHIPS;
    this.finishMiniGame(
      chips,
      [
        ['처음보다', change >= 0 ? `+${change}칩` : `${change}칩`],
        ['이긴 손', `${this.wins}번`],
        ['블랙잭', `${this.blackjacks}번`],
        ['가장 많던 칩', `${this.peak}개`],
      ],
      delay,
    );
  }

  protected override canFinishEarly(): boolean {
    return !this.versus && this.playing && this.table.round > 0;
  }

  override onBackRequest(): void {
    if (this.friends.back()) return;
    if (!this.playing && !this.versus) fadeToScene(this, homeScene());
    else this.pauseGame();
  }

  protected override pauseGame(): void {
    if (!this.playing) return;
    super.pauseGame();
  }

  protected override retryData(): object {
    return { solo: true } satisfies BlackjackStart;
  }

  protected override restartLabel(): string | null {
    return this.friends.restartLabel();
  }

  protected override quitWarning(): string | null {
    return this.friends.quitWarning();
  }

  // ───────── 친구와 하기 ─────────

  private turnOf(view: BlackjackView): RoomSeat | null {
    return blackjackTurn({ table: view.table, first: view.first, placed: view.placed, seed: 0, moves: 0, last: null });
  }

  /** 친구와 할 때 seat의 hand번째 손을 놓을 가운데와 폭. 자리 0이 왼쪽, 1이 오른쪽이다. */
  private handSpot(seat: number, hand: number, hands: number): { center: number; room: number } {
    const left = MARGIN + seat * (SEAT_W + 8);
    if (hands <= 1) return { center: left + SEAT_W / 2, room: SEAT_W };
    const room = (SEAT_W - 4) / 2;
    return { center: left + room / 2 + hand * (room + 4), room };
  }

  /** 친구와 할 때 자리마다의 이름, 칩, 합, 건 칩을 적는다. 차례인 자리에 노란 테를 두른다. */
  private renderSeatLabels(): void {
    const { table } = this;
    const view = this.friends.room?.game;
    const turn = view ? this.turnOf(view) : null;
    const top = this.playerY - (CARD_H * SEAT_SCALE) / 2 - 22;
    const height = CARD_H * SEAT_SCALE + 44;
    table.seats.forEach((seat, index) => {
      const left = MARGIN + index * (SEAT_W + 8);
      const g = this.add.graphics();
      const active = turn === index && this.friends.room?.status === 'playing';
      g.fillStyle(PX.ink, 0.28);
      g.fillRoundedRect(left, top, SEAT_W, height, 4);
      if (active) {
        g.lineStyle(2, PX.yellow, 1);
        g.strokeRoundedRect(left + 1, top + 1, SEAT_W - 2, height - 2, 4);
      }
      this.labelLayer.add(g);
      const name = this.friends.nameOf(index as RoomSeat);
      this.labelLayer.add(addText(this, left + 6, top + 8, name, { size: 10, color: active ? PX_CSS.accent : PX_CSS.text, originY: 0.5, shadow: PX_CSS.dark }));
      const chips = this.add.graphics();
      this.drawChip(chips, left + SEAT_W - 30, top + 8, PX.yellow, 4);
      this.labelLayer.add(chips);
      this.labelLayer.add(addText(this, left + SEAT_W - 6, top + 8, String(seat.chips), { size: 10, color: PX_CSS.accent, originX: 1, originY: 0.5, shadow: PX_CSS.dark }));
      const labelY = this.playerY + (CARD_H * SEAT_SCALE) / 2 + 10;
      if (seat.hands.length === 0) {
        const placed = view?.placed[index] ?? false;
        const text = table.phase === 'settled' || table.phase === 'betting' ? (placed ? `${seat.bet}칩 걸었어요` : '거는 중…') : '';
        this.labelLayer.add(addText(this, left + SEAT_W / 2, this.playerY, text, { size: 10, color: placed ? PX_CSS.accent : PX_CSS.sub, originX: 0.5, originY: 0.5 }));
      }
      seat.hands.forEach((hand, handIndex) => {
        const { center, room } = this.handSpot(index, handIndex, seat.hands.length);
        const parts = hand.result === 'blackjack' ? [] : [totalLabel(hand.cards, hand.fromSplit)];
        if (hand.result) parts.push(RESULT_LABEL[hand.result]);
        else parts.push(`${hand.bet}칩${hand.doubled ? '×2' : ''}`);
        const color = hand.result ? RESULT_COLOR[hand.result] : handTotal(hand.cards).total > 21 ? PX_CSS.bad : PX_CSS.text;
        this.labelLayer.add(addText(this, center, labelY, parts.join(' · '), { size: seat.hands.length > 1 ? 8 : 9, color, originX: 0.5, originY: 0.5, shadow: PX_CSS.dark }));
        if (seat.hands.length > 1 && active && handIndex === seat.active) {
          const frame = this.add.graphics();
          frame.lineStyle(1, PX.yellow, 1);
          frame.strokeRect(center - room / 2, this.playerY - (CARD_H * SEAT_SCALE) / 2 - 3, room, CARD_H * SEAT_SCALE + 6);
          this.labelLayer.add(frame);
        }
      });
    });
  }

  /** 친구와 하는 방이 바뀌었다. 탁자를 다시 그리고, 내 차례면 버튼을 보인다. */
  private onRoom(room: RoomView<BlackjackView>, fresh: boolean): void {
    const view = room.game;
    if (!view) return;
    if (!this.versusBuilt) {
      this.versusBuilt = true;
      this.buildTable();
      this.addPauseButton();
      this.playing = true;
      // 두 줄 알림이 자리 칸에 닿지 않게, 딜러 아래 글과 자리 칸 사이 한가운데에 조금 작게 적는다.
      const markBottom = this.dealerY + CARD_H / 2 + 18;
      const seatTop = this.playerY - (CARD_H * SEAT_SCALE) / 2 - 22;
      this.messageText.setFontSize(12).setY(Math.round((markBottom + seatTop) / 2));
      // 건 칩은 자리 칸마다 적으므로 가운데의 칩 더미와 글은 쓰지 않는다.
      this.betText.setVisible(false);
      this.betChips.setVisible(false);
    }
    if (fresh) {
      this.shown = new Map();
      this.seenMoves = -1;
      this.playing = true;
    }
    const before = this.table;
    this.table = view.table;
    this.me = room.seat;
    const newMoves = view.moves !== this.seenMoves;
    this.seenMoves = view.moves;
    if (newMoves && before.round !== view.table.round) this.shown = new Map([...this.shown].filter(([key]) => !key.startsWith('s') && !key.startsWith('d')));
    this.render();
    this.refreshTop();
    this.showBet(null);
    if (room.status === 'over') {
      this.playing = false;
      this.hideControls();
      this.say(this.dealLine(), PX_CSS.text);
      return;
    }
    this.updateVersusControls(room, view, newMoves);
  }

  /** 정산한 딜에서 자리마다 늘거나 준 칩 한 줄 */
  private dealLine(): string {
    return this.table.seats
      .map((seat, index) => {
        const net = seat.hands.reduce((sum, hand) => sum + hand.payout - hand.bet, 0);
        return `${this.friends.nameOf(index as RoomSeat)} ${net > 0 ? `+${net}` : net < 0 ? `${net}` : '±0'}`;
      })
      .join('  ·  ');
  }

  private updateVersusControls(room: RoomView<BlackjackView>, view: BlackjackView, newMoves: boolean): void {
    const { table } = this;
    const turn = this.turnOf(view);
    const mine = turn === room.seat && room.status === 'playing';
    const betting = table.phase === 'settled' || table.phase === 'betting';
    const who = this.friends.kind === 'local' ? this.friends.nameOf(room.seat) : '내';
    if (betting && newMoves && table.phase === 'settled' && table.round > 0) {
      const net = this.seat.hands.reduce((sum, hand) => sum + hand.payout - hand.bet, 0);
      if (net > 0) sfx.coin();
      else if (net < 0) sfx.miss();
    }
    if (mine && betting) {
      this.showActions(false);
      this.showBetting(true);
      if (newMoves) this.pendingBet = Math.max(minBetFor(this.seat.chips), Math.min(this.seat.chips, this.seat.bet));
      this.refreshVersusBet();
      const head = table.phase === 'settled' && table.round > 0 ? `${this.dealLine()}\n` : '';
      this.say(`${head}${who} 차례! 칩을 걸어요`, PX_CSS.text);
      return;
    }
    if (mine && table.phase === 'playing') {
      this.showBetting(false);
      this.showActions(true);
      this.showBet(null);
      const hand = this.seat.hands[this.seat.active];
      const total = hand ? handTotal(hand.cards).total : 0;
      const label = this.seat.hands.length > 1 ? `${this.seat.active + 1}번째 손 · ${total}` : `${total}`;
      this.say(`${who} 차례 · ${label}`, PX_CSS.text);
      return;
    }
    this.hideControls();
    const foe = turn === null ? '' : this.friends.nameOf(turn);
    const head = betting && table.phase === 'settled' && table.round > 0 ? `${this.dealLine()}\n` : '';
    this.say(turn === null ? '' : `${head}${withSubject(foe)} ${betting ? '칩을 거는 중' : '하는 중'}…`, PX_CSS.sub);
  }

  private hideControls(): void {
    this.showBetting(false);
    this.showActions(false);
  }

  private versusAddChips(step: number): void {
    if (!this.friends.myTurn()) return;
    const chips = this.seat.chips;
    const next = Math.min(chips, this.pendingBet + step);
    if (next === this.pendingBet) {
      sfx.deny();
      this.say('가진 칩보다 많이 걸 수 없어요', PX_CSS.bad);
    }
    this.pendingBet = next;
    this.refreshVersusBet();
  }

  private refreshVersusBet(): void {
    const chips = this.seat.chips;
    this.dealButton.setLabel(`걸기 · ${this.pendingBet}칩`);
    this.chipButtons.forEach((button) => button.setEnabled(this.pendingBet < chips));
    this.clearButton.setEnabled(this.pendingBet > minBetFor(chips));
  }

  private sendMove(move: BlackjackMove): void {
    if (this.busy) return;
    this.busy = true;
    this.hideControls();
    void this.friends.send(move).then((ok) => {
      this.busy = false;
      const room = this.friends.room;
      if (!ok && room?.game) this.updateVersusControls(room, room.game, false);
    });
  }

  /** 친구와의 판이 끝났을 때 결과 판에 적을 것 */
  private friendResult(room: RoomView<BlackjackView>): FriendsResult & { won: boolean | null } {
    const table = room.game!.table;
    const chips = table.seats.map((seat) => seat.chips);
    const winner: RoomSeat | null = chips[0] === chips[1] ? null : chips[0] > chips[1] ? 0 : 1;
    const local = this.friends.kind === 'local';
    const won = winner === null ? null : winner === room.seat;
    const title = winner === null ? '비겼어요' : local ? `${withSubject(room.names[winner] ?? '')} 이겼어요!` : won ? '이겼어요!' : '졌어요';
    const broke = table.seats.findIndex((seat) => seat.chips <= 0);
    const how = broke >= 0 ? `${withSubject(this.friends.nameOf(broke as RoomSeat))} 칩을 다 잃었어요` : `${ROUNDS}판을 다 했어요`;
    const line = `남은 칩  ${this.friends.nameOf(0)} ${chips[0]} · ${this.friends.nameOf(1)} ${chips[1]}`;
    return { title, lines: [line, how], bright: local ? winner !== null : won === true, lost: !local && won === false, won };
  }

  /** 기록하고 끝내기: 지금 가진 칩이 점수다. 판 위에 걸려 있던 칩은 돌려받지 못한다. */
  protected override finishEarly(): void {
    this.showBetting(false);
    this.showActions(false);
    this.finish(300);
  }
}
