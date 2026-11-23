import Phaser from 'phaser';
import { GAME_WIDTH, SCENE } from '../../config';
import { vibrate } from '../../core/haptics';
import { homeScene } from '../../core/home';
import { sfx } from '../../core/sfx';
import { addText, drawPanel, fadeToScene, PixelButton } from '../../core/ui';
import { MiniGameScene } from '../../scenes/MiniGameScene';
import { FriendsKit, type FriendsResult, type FriendsStart } from '../../versus/friends-kit';
import type { RoomView, Seat as RoomSeat } from '../../versus/protocol';
import { withSubject } from '../../versus/text';
import { PX, PX_CSS, rankSize, rankTexture, registerCardBase, registerHighLowTextures, suitTexture } from '../high-low/art';
import { isRed } from '../high-low/rules';
import { BOT_STYLES, chooseMove } from './bot';
import { Category, HAND_RANKS, handName, rankInfo, type HandRankInfo } from './hands';
import {
  ACTION_LABEL,
  act,
  BIG_BLIND,
  BOT_NAMES,
  createTable,
  currentHand,
  HANDS,
  inHand,
  options,
  POKER_GAME_ID,
  potTotal,
  runOver,
  seatsInPlay,
  startHand,
  START_CHIPS,
  type Card,
  type Move,
  type PokerSeat,
  type PokerTable,
  type Street,
} from './rules';
import { pokerTurn, pokerVersus, readPokerView, seatPlan, type PokerLog, type PokerVersusMove, type PokerView } from './versus';

/** 씬을 열 때 넘기는 값. solo면 준비 화면을 건너뛰고 컴퓨터와 하는 판을 연다. */
export interface PokerStart extends FriendsStart {
  solo?: boolean;
}

/** 공용 카드(가운데 다섯 장) */
const BOARD_W = 26;
const BOARD_H = 36;
/** 내 카드 */
const HOLE_W = 40;
const HOLE_H = 56;
/** 컴퓨터 자리의 카드는 공용 카드를 줄여 그린다 */
const CPU_SCALE = 0.78;
const TEX = { board: 'pk-board', boardBack: 'pk-board-back', hole: 'pk-hole', holeBack: 'pk-hole-back' } as const;

const MARGIN = 8;
const BUTTON_H = 34;
const GAP = 6;
/** 오른쪽의 족보표 폭 */
const CHART_W = 76;
/** 컴퓨터 자리 칸의 높이 */
const SEAT_H = 66;
const DEPTH = { back: -10, felt: -5, base: 0, card: 5, label: 6, float: 20, popup: 25 } as const;
/** 컴퓨터가 생각하는 시간. 내가 폴드했거나 올인했으면 빨리 넘긴다. */
const BOT_MS = 620;
const BOT_FAST_MS = 260;
/** 사람의 자리 */
const ME = 0;

/** 초록 카지노 탁자(블랙잭과 같은 색) */
const FELT = { glow: 0x239066, mark: 0x176646, rim: 0x5d3a1a, rimLight: 0x8a5a2b } as const;

const STREET_LABEL: Readonly<Record<Street, string>> = {
  preflop: '프리플롭',
  flop: '플롭',
  turn: '턴',
  river: '리버',
  showdown: '쇼다운',
};

interface DrawnCard {
  key: string;
  card: Card;
  hidden: boolean;
  x: number;
  y: number;
  size: 'board' | 'hole' | 'cpu';
  dim: boolean;
  glow: boolean;
}

/**
 * 포커(텍사스 홀덤): 컴퓨터 셋과 한 탁자에 앉아 칩을 건다. 내 카드 두 장과 공용 카드 다섯 장으로 가장 센 족보를 만든다.
 * 한 판은 열 핸드이고 칩 100개로 시작해서, 남은 칩이 점수가 된다. 칩을 다 잃으면 거기서 끝나고, 컴퓨터를 모두 이기면 일찍 끝난다.
 * 오른쪽에는 늘 족보표가 있어서 지금 내 패가 어디쯤인지 빛나고, 줄을 누르면 그 족보의 예를 보여 준다.
 * 칩은 이 게임 안에서만 쓰이고 앱의 코인과는 따로다. 규칙(rules.ts)은 자리 번호로 수를 받는 탁자라서 화면과 떨어져 있다.
 */
export class PokerScene extends MiniGameScene {
  protected readonly gameId = POKER_GAME_ID;

  table!: PokerTable;
  /** 카드가 날아가거나 컴퓨터가 생각하는 중이면 true */
  busy = false;
  private wins = 0;
  private peak = START_CHIPS;
  private best: Category | null = null;
  private raiseTo = 0;

  private seatY = 0;
  private boardY = 0;
  private potY = 0;
  private messageY = 0;
  private holeY = 0;
  private leftCenter = 0;
  private chartX = 0;
  private chartTop = 0;
  private rowH = 18;
  private deckX = 0;
  private deckY = 0;

  private shown = new Map<string, boolean>();
  private cardLayer!: Phaser.GameObjects.Container;
  private seatLayer!: Phaser.GameObjects.Container;
  private chartRows: { info: HandRankInfo; bg: Phaser.GameObjects.Rectangle; text: Phaser.GameObjects.Text }[] = [];
  private popup: Phaser.GameObjects.Container | null = null;

  private chipsText!: Phaser.GameObjects.Text;
  private roundText!: Phaser.GameObjects.Text;
  private potText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private handText!: Phaser.GameObjects.Text;
  private myInfoText!: Phaser.GameObjects.Text;

  private foldButton!: PixelButton;
  private callButton!: PixelButton;
  private allInButton!: PixelButton;
  private lessButton!: PixelButton;
  private raiseButton!: PixelButton;
  private moreButton!: PixelButton;
  private dealButton!: PixelButton;
  /** 친구와 할 때 첫 판에 함께 앉을 컴퓨터 수를 고르는 버튼 */
  private setupButtons: PixelButton[] = [];

  /** 친구와 하기. 자동 점검이 들여다본다. */
  friends!: FriendsKit<PokerView, PokerVersusMove>;
  /** 친구와 하는 판에서 방의 자리마다 앉은 탁자 자리(보는 사람이 0번). 혼자 할 때는 null */
  private humans: [number, number] | null = null;
  /** 친구와 하는 판의 화면을 그렸는지 */
  private versusBuilt = false;
  /** 마지막으로 알린 수의 번호 */
  private seenMoves = -1;
  /** 지난번에 화면에 그린 방의 자리(한 폰이면 차례마다 바뀐다) */
  private seenSeat: RoomSeat | null = null;

  constructor() {
    super(SCENE.poker);
  }

  create(data: PokerStart = {}): void {
    this.beginMiniGame();
    registerHighLowTextures(this);
    registerCardBase(this, TEX.board, TEX.boardBack, BOARD_W, BOARD_H);
    registerCardBase(this, TEX.hole, TEX.holeBack, HOLE_W, HOLE_H);
    this.table = createTable(['나', ...BOT_NAMES]);
    this.busy = false;
    this.wins = 0;
    this.peak = START_CHIPS;
    this.best = null;
    this.shown = new Map();
    this.chartRows = [];
    this.popup = null;
    this.setupButtons = [];
    this.humans = null;
    this.versusBuilt = false;
    this.seenMoves = -1;
    this.seenSeat = null;
    this.friends = new FriendsKit<PokerView, PokerVersusMove>(this, {
      game: 'poker',
      title: '포커',
      rules: pokerVersus,
      readView: readPokerView,
      isMyTurn: (room) => !!room.game && pokerTurn(room.game) === room.seat,
      // 남의 손패를 가려야 하므로 한 폰으로 할 때는 차례가 바뀌면 화면을 가린다.
      cover: true,
      onRoom: (room, fresh) => this.onRoom(room, fresh),
      result: (room) => this.friendResult(room),
      onClosed: () => this.hideAllControls(),
      say: (text, warn) => this.say(text, warn ? PX_CSS.bad : PX_CSS.text),
      coverNote: () => this.coverNote(),
      restart: (start) => this.scene.restart(start satisfies PokerStart),
    });
    if (this.friends.begin(data)) return;
    if (data.solo) this.startSolo();
    else this.openLobby();
  }

  /** 혼자 하는 판: 컴퓨터 셋과 열 판 */
  private startSolo(): void {
    this.buildTable();
    this.addPauseButton();
    this.betweenHands(true);
    this.playing = true;
    // 처음 하는 사람에게는 규칙 안내서를 한 번 띄운다. 그 사이에 이미 딜했으면 띄우지 않는다.
    this.offerRuleBook(() => this.table.handNo === 0 && !this.busy);
  }

  /** 준비 화면: 혼자 하기와 친구와 함께 */
  private openLobby(): void {
    const { height } = this.scale;
    this.drawFelt(0, height, false);
    new PixelButton(this, { x: MARGIN, y: 8, width: 26, height: 26, icon: 'icon-back', hitPadding: 6, onTap: () => fadeToScene(this, homeScene()) });
    addText(this, 42, 21, '포커', { size: 16, color: PX_CSS.accent, originY: 0.5, shadow: PX_CSS.dark });
    new PixelButton(this, { x: GAME_WIDTH - MARGIN - 44, y: 8, width: 44, height: 26, label: '규칙', style: 'yellow', hitPadding: 4, onTap: () => this.openRuleBook() });
    this.offerRuleBook(() => !this.playing && !this.friends.active);

    const mid = Math.round(height * 0.36);
    // 탁자 위에 펼친 A 두 장과 칩 더미
    const ace = this.makeFace({ rank: 1, suit: 'spade' }, 'hole').setPosition(GAME_WIDTH / 2 - 18, mid - 40).setAngle(-8);
    const other = this.makeFace({ rank: 1, suit: 'heart' }, 'hole').setPosition(GAME_WIDTH / 2 + 18, mid - 36).setAngle(8);
    ace.setDepth(DEPTH.card);
    other.setDepth(DEPTH.card);
    const chips = this.add.graphics().setDepth(DEPTH.card + 1);
    [PX.red, PX.green, PX.blue, PX.white].forEach((color, index) => this.drawChip(chips, GAME_WIDTH / 2 + 56, mid - 10 - index * 3, color, 7));
    this.panel(this.add.graphics(), MARGIN + 6, mid + 10, GAME_WIDTH - MARGIN * 2 - 12, 74);
    const lines = ['내 카드 2장 + 공용 카드 5장으로 겨뤄요', `놀이 칩 ${START_CHIPS}개로 ${HANDS}판, 남은 칩이 점수예요`, '친구와 한 탁자에, 빈자리는 컴퓨터가'];
    lines.forEach((line, index) =>
      addText(this, GAME_WIDTH / 2, mid + 24 + index * 18, line, { size: 10, color: index === 2 ? PX_CSS.accent : PX_CSS.text, originX: 0.5, originY: 0.5 }),
    );

    const bottom = height - MARGIN - 36;
    this.friends.lobbyButton(MARGIN, bottom, 92, 36);
    new PixelButton(this, {
      x: MARGIN + 98,
      y: bottom,
      width: GAME_WIDTH - MARGIN * 2 - 98,
      height: 36,
      label: '혼자 하기',
      style: 'pink',
      onTap: () => this.scene.restart({ solo: true } satisfies PokerStart),
    });
  }

  /** 판을 하는 화면: 탁자, 위쪽 줄, 족보표, 버튼, 글 */
  private buildTable(): void {
    const { height } = this.scale;
    const controlsTop = height - MARGIN - BUTTON_H * 2 - GAP;
    this.seatY = 42;
    const middleTop = this.seatY + SEAT_H + 6;
    const middleBottom = controlsTop - 6;
    const extra = Math.max(0, middleBottom - middleTop - 198);
    this.leftCenter = Math.round((MARGIN + GAME_WIDTH - MARGIN - CHART_W - 4) / 2);
    this.potY = middleTop + 8 + Math.round(extra * 0.15);
    this.boardY = this.potY + 12 + BOARD_H / 2 + Math.round(extra * 0.15);
    this.messageY = this.boardY + BOARD_H / 2 + 18 + Math.round(extra * 0.2);
    this.holeY = this.messageY + 20 + HOLE_H / 2 + Math.round(extra * 0.25);
    this.chartX = GAME_WIDTH - MARGIN - CHART_W;
    this.chartTop = middleTop;
    this.rowH = Math.min(22, Math.floor((middleBottom - middleTop - 16) / HAND_RANKS.length));
    this.deckX = this.leftCenter;
    this.deckY = this.seatY + SEAT_H + 4;

    this.drawFelt(middleTop, controlsTop);
    this.drawTop();
    this.drawChart();
    this.drawControls(controlsTop);

    this.seatLayer = this.add.container(0, 0).setDepth(DEPTH.base);
    this.cardLayer = this.add.container(0, 0).setDepth(DEPTH.card);
    this.potText = addText(this, this.leftCenter, this.potY, '', {
      size: 10,
      color: PX_CSS.accent,
      originX: 0.5,
      originY: 0.5,
      shadow: PX_CSS.dark,
    }).setDepth(DEPTH.label);
    this.messageText = addText(this, this.leftCenter, this.messageY, '', {
      size: 11,
      color: PX_CSS.text,
      originX: 0.5,
      originY: 0.5,
      stroke: PX_CSS.dark,
      align: 'center',
      // 족보표를 덮지 않게 왼쪽 자리 안에서 줄을 바꾼다.
      wrapWidth: (this.leftCenter - MARGIN) * 2,
      lineSpacing: -2,
    }).setDepth(DEPTH.float);
    this.handText = addText(this, this.leftCenter, this.holeY + HOLE_H / 2 + 9, '', {
      size: 10,
      color: PX_CSS.accent,
      originX: 0.5,
      originY: 0.5,
      shadow: PX_CSS.dark,
    }).setDepth(DEPTH.label);
    this.myInfoText = addText(this, this.leftCenter, this.holeY + HOLE_H / 2 + 23, '', {
      size: 9,
      color: '#d8f2e2',
      originX: 0.5,
      originY: 0.5,
    }).setDepth(DEPTH.label);
  }

  private get me(): PokerSeat {
    return this.table.seats[ME];
  }

  // ───────── 화면 구성 ─────────

  private drawFelt(middleTop: number, controlsTop: number, slots = true): void {
    const { height } = this.scale;
    const g = this.add.graphics().setDepth(DEPTH.back);
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
    if (!slots) return;
    // 공용 카드 자리: 다섯 칸을 옅게 그려 둔다.
    g.lineStyle(1, 0xffffff, 0.18);
    for (let i = 0; i < 5; i += 1) {
      const x = this.boardX(i);
      g.strokeRoundedRect(x - BOARD_W / 2, this.boardY - BOARD_H / 2, BOARD_W, BOARD_H, 3);
    }
    g.lineStyle(1, 0xffffff, 0.12);
    g.lineBetween(MARGIN + 4, controlsTop - 4, GAME_WIDTH - MARGIN - 4, controlsTop - 4);
    void middleTop;
  }

  private panel(g: Phaser.GameObjects.Graphics, x: number, y: number, width: number, height: number, border: number = PX.edge): void {
    drawPanel(g, x, y, width, height, { fill: PX.panel, border, shadow: PX.ink, radius: 3, depth: 3 });
  }

  private drawTop(): void {
    addText(this, 40, 7, '포커', { size: 14, color: PX_CSS.text, shadow: PX_CSS.dark });
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
    g.fillStyle(PX.white, 1);
    for (let i = 0; i < 4; i += 1) {
      const angle = (Math.PI / 2) * i;
      g.fillRect(Math.round(x + Math.cos(angle) * (radius - 2)) - 1, Math.round(y + Math.sin(angle) * (radius - 2)) - 1, 2, 2);
    }
    g.lineStyle(1, PX.white, 0.7);
    g.strokeCircle(x, y, radius - 3.5);
  }

  /** 오른쪽의 족보표: 센 것부터 열 줄. 누르면 그 족보의 예를 보여 준다. */
  private drawChart(): void {
    const height = 16 + this.rowH * HAND_RANKS.length + 4;
    this.panel(this.add.graphics().setDepth(DEPTH.base), this.chartX, this.chartTop, CHART_W, height);
    addText(this, this.chartX + CHART_W / 2, this.chartTop + 9, '족보 (센 순서)', {
      size: 8,
      color: PX_CSS.sub,
      originX: 0.5,
      originY: 0.5,
    }).setDepth(DEPTH.base + 1);
    HAND_RANKS.forEach((info, index) => {
      const y = this.chartTop + 16 + index * this.rowH;
      const bg = this.add
        .rectangle(this.chartX + 3, y, CHART_W - 6, this.rowH - 2, PX.yellow, 0)
        .setOrigin(0, 0)
        .setDepth(DEPTH.base + 1)
        .setInteractive({ useHandCursor: true });
      bg.on('pointerup', () => this.showExample(info));
      const text = addText(this, this.chartX + 6, y + (this.rowH - 2) / 2, info.name, {
        size: 8,
        color: PX_CSS.text,
        originX: 0,
        originY: 0.5,
      }).setDepth(DEPTH.base + 2);
      const room = CHART_W - 12;
      if (text.width > room) text.setScale(room / text.width);
      this.chartRows.push({ info, bg, text });
    });
  }

  /** 지금 내 패의 줄을 빛낸다 */
  private refreshChart(): void {
    const value = this.me.folded ? null : currentHand(this.table, ME);
    for (const row of this.chartRows) {
      const lit = value !== null && row.info.category === value.category;
      row.bg.setFillStyle(PX.yellow, lit ? 1 : 0);
      row.text.setColor(lit ? PX_CSS.dark : value && row.info.category < value.category ? PX_CSS.faint : PX_CSS.text);
    }
  }

  private drawControls(top: number): void {
    const row2 = top + BUTTON_H + GAP;
    const full = GAME_WIDTH - MARGIN * 2;
    const foldW = 64;
    const allInW = 64;
    const callW = full - foldW - allInW - GAP * 2;
    this.foldButton = new PixelButton(this, {
      x: MARGIN,
      y: top,
      width: foldW,
      height: BUTTON_H,
      label: '폴드',
      style: 'red',
      onTap: () => this.play({ type: 'fold' }),
    });
    this.callButton = new PixelButton(this, {
      x: MARGIN + foldW + GAP,
      y: top,
      width: callW,
      height: BUTTON_H,
      label: '체크',
      style: 'green',
      onTap: () => this.play(options(this.table, ME).check ? { type: 'check' } : { type: 'call' }),
    });
    this.allInButton = new PixelButton(this, {
      x: MARGIN + foldW + GAP + callW + GAP,
      y: top,
      width: allInW,
      height: BUTTON_H,
      label: '올인',
      style: 'pink',
      onTap: () => this.play({ type: 'allin' }),
    });
    const stepW = 40;
    this.lessButton = new PixelButton(this, {
      x: MARGIN,
      y: row2,
      width: stepW,
      height: BUTTON_H,
      label: '-',
      onTap: () => this.nudgeRaise(-1),
    });
    this.raiseButton = new PixelButton(this, {
      x: MARGIN + stepW + GAP,
      y: row2,
      width: full - stepW * 2 - GAP * 2,
      height: BUTTON_H,
      label: '레이즈',
      style: 'yellow',
      onTap: () => this.play({ type: 'raise', to: this.raiseTo }),
    });
    this.moreButton = new PixelButton(this, {
      x: GAME_WIDTH - MARGIN - stepW,
      y: row2,
      width: stepW,
      height: BUTTON_H,
      label: '+',
      onTap: () => this.nudgeRaise(1),
    });
    this.dealButton = new PixelButton(this, {
      x: MARGIN,
      y: row2,
      width: full,
      height: BUTTON_H,
      label: '딜하기',
      style: 'pink',
      onTap: () => this.startNextHand(),
    });
  }

  // ───────── 카드 ─────────

  private boardX(index: number): number {
    return this.leftCenter + (index - 2) * (BOARD_W + 3);
  }

  private makeFace(card: Card, size: 'board' | 'hole' | 'cpu'): Phaser.GameObjects.Container {
    const red = isRed(card.suit);
    const rank = rankSize(card.rank);
    if (size === 'hole') {
      const left = -HOLE_W / 2 + 5;
      const top = -HOLE_H / 2 + 5;
      const cornerX = left + Math.max(rank.width, 14) / 2;
      return this.add.container(0, 0, [
        this.add.image(0, 0, TEX.hole),
        this.add.image(cornerX, top + rank.height / 2, rankTexture(card.rank, red)),
        this.add.image(cornerX, top + rank.height + 9, suitTexture(card.suit, 'small')),
        this.add.image(4, 12, suitTexture(card.suit, 'big')).setScale(0.75),
      ]);
    }
    const left = -BOARD_W / 2 + 4;
    const top = -BOARD_H / 2 + 4;
    const face = this.add.container(0, 0, [
      this.add.image(0, 0, TEX.board),
      this.add.image(left + rank.width / 2, top + rank.height / 2, rankTexture(card.rank, red)),
      this.add.image(2, 9, suitTexture(card.suit, 'small')),
    ]);
    if (size === 'cpu') face.setScale(CPU_SCALE);
    return face;
  }

  private makeBack(size: 'board' | 'hole' | 'cpu'): Phaser.GameObjects.Image {
    const image = this.add.image(0, 0, size === 'hole' ? TEX.holeBack : TEX.boardBack);
    if (size === 'cpu') image.setScale(CPU_SCALE);
    return image;
  }

  /** 위쪽 자리 칸(나 말고 다른 자리)의 수. 혼자 할 때는 셋, 친구와는 하나에서 셋이다. */
  private get columns(): number {
    return Math.max(1, this.table.seats.length - 1);
  }

  /** 위쪽 자리 칸의 폭. 칸이 적어도 셋일 때의 두 칸보다 넓히지 않고 가운데에 모은다. */
  private seatWidth(): number {
    const third = (GAME_WIDTH - MARGIN * 2 - GAP * 2) / 3;
    const fit = (GAME_WIDTH - MARGIN * 2 - GAP * (this.columns - 1)) / this.columns;
    return Math.min(fit, third * 2 + GAP);
  }

  /** 위쪽 자리 칸의 왼쪽 x */
  private seatLeft(index: number): number {
    const width = this.seatWidth();
    const row = width * this.columns + GAP * (this.columns - 1);
    return Math.round((GAME_WIDTH - row) / 2 + (index - 1) * (width + GAP));
  }

  /** 쇼다운에서 첫 팟을 가진 사람의 족보를 이루는 카드(빛낼 카드). 친구와 하면 판이 JSON으로 오므로 숫자와 무늬로 견준다. */
  private winningCards(): { has(card: Card): boolean } {
    const result = this.table.result;
    const winner = result?.showdown ? result.pots[0]?.winners[0] : undefined;
    const value = winner === undefined ? null : result?.values[winner];
    const keys = new Set((value?.cards ?? []).map((card) => `${card.rank}${card.suit}`));
    return { has: (card) => keys.has(`${card.rank}${card.suit}`) };
  }

  /** 자리의 이름. 친구와 할 때 사람 자리는 방의 이름(온라인에서 내 자리는 "나")이다. */
  seatName(index: number): string {
    const seat = this.humans?.indexOf(index) ?? -1;
    if (seat === 0 || seat === 1) return this.friends.nameOf(seat);
    return this.table.seats[index]?.name ?? '';
  }

  private layout(): DrawnCard[] {
    const drawn: DrawnCard[] = [];
    const { table } = this;
    const glow = this.winningCards();
    table.board.forEach((card, index) => {
      drawn.push({ key: `b${index}`, card, hidden: false, x: this.boardX(index), y: this.boardY, size: 'board', dim: false, glow: glow.has(card) });
    });
    const reveal = table.result?.showdown ?? false;
    table.seats.forEach((seat, index) => {
      if (seat.hole.length === 0 || seat.out) return;
      if (index === ME) {
        seat.hole.forEach((card, i) => {
          drawn.push({
            key: `m${i}`,
            card,
            hidden: false,
            x: this.leftCenter + (i - 0.5) * (HOLE_W + 4),
            y: this.holeY,
            size: 'hole',
            dim: seat.folded,
            glow: glow.has(card),
          });
        });
        return;
      }
      const center = this.seatLeft(index) + this.seatWidth() / 2;
      const show = reveal && inHand(seat);
      seat.hole.forEach((card, i) => {
        drawn.push({
          key: `c${index}-${i}`,
          card,
          hidden: !show,
          x: center + (i - 0.5) * (BOARD_W * CPU_SCALE + 2),
          y: this.seatY + 34,
          size: 'cpu',
          dim: seat.folded,
          glow: glow.has(card),
        });
      });
    });
    return drawn;
  }

  /**
   * 탁자의 카드를 다시 그린다. 새로 생긴 카드는 가운데 덱에서 날아오고, 엎었던 카드가 펼쳐지면 뒤집힌다.
   * 날아오는 카드는 차례로 늦춰서 나눠 주는 느낌을 낸다. 다 그리면 done을 부른다.
   */
  private render(done?: () => void): void {
    this.cardLayer.removeAll(true);
    const next = new Map<string, boolean>();
    let delay = 0;
    let last = 0;
    for (const item of this.layout()) {
      next.set(item.key, item.hidden);
      const object: Phaser.GameObjects.Container | Phaser.GameObjects.Image = item.hidden ? this.makeBack(item.size) : this.makeFace(item.card, item.size);
      object.setPosition(item.x, item.y);
      if (item.dim) object.setAlpha(0.45);
      this.cardLayer.add(object);
      if (item.glow) {
        const w = item.size === 'hole' ? HOLE_W : item.size === 'cpu' ? BOARD_W * CPU_SCALE : BOARD_W;
        const h = item.size === 'hole' ? HOLE_H : item.size === 'cpu' ? BOARD_H * CPU_SCALE : BOARD_H;
        const ring = this.add.graphics();
        ring.lineStyle(2, PX.yellow, 1);
        ring.strokeRoundedRect(item.x - w / 2 - 2, item.y - h / 2 - 2, w + 4, h + 4, 3);
        this.cardLayer.add(ring);
      }
      const before = this.shown.get(item.key);
      if (before === undefined) {
        const alpha = item.dim ? 0.45 : 1;
        object.setPosition(this.deckX, this.deckY).setAlpha(0);
        this.tweens.add({
          targets: object,
          x: item.x,
          y: item.y,
          alpha,
          delay,
          duration: 180,
          ease: 'Cubic.Out',
          onStart: () => sfx.flip(),
        });
        last = delay + 180;
        delay += 90;
      } else if (before && !item.hidden) {
        const scale = item.size === 'cpu' ? CPU_SCALE : 1;
        object.setScale(0, scale);
        this.tweens.add({ targets: object, scaleX: scale, delay, duration: 140, onStart: () => sfx.flip() });
        last = delay + 140;
        delay += 100;
      }
    }
    this.shown = next;
    this.renderSeats();
    this.renderInfo();
    if (done) this.time.delayedCall(last + 40, done);
  }

  /** 컴퓨터 자리 칸: 이름, 칩, 마지막에 한 일, 딜러 버튼, 차례 표시 */
  private renderSeats(): void {
    this.seatLayer.removeAll(true);
    const { table } = this;
    const result = table.result;
    for (let index = 1; index < table.seats.length; index += 1) {
      const seat = table.seats[index];
      const left = this.seatLeft(index);
      const width = this.seatWidth();
      const won = result?.payouts[index] ? result.payouts[index] > 0 : false;
      const turn = table.toAct === index;
      const g = this.add.graphics();
      this.panel(g, left, this.seatY, width, SEAT_H, won ? PX.lime : turn ? PX.yellow : PX.edge);
      if (seat.out || seat.folded) g.setAlpha(0.6);
      this.seatLayer.add(g);
      // 친구 자리는 이름을 노랗게 적어 컴퓨터와 가린다.
      const friend = this.humans?.includes(index) ?? false;
      const name = addText(this, left + 5, this.seatY + 9, this.seatName(index), { size: 9, color: friend ? PX_CSS.accent : PX_CSS.text, originX: 0, originY: 0.5 });
      const room = width - 34;
      if (name.width > room) name.setScale(room / name.width);
      this.seatLayer.add(name);
      this.seatLayer.add(
        addText(this, left + width - 5, this.seatY + 9, seat.out ? '-' : String(seat.chips), {
          size: 9,
          color: PX_CSS.accent,
          originX: 1,
          originY: 0.5,
        }),
      );
      if (table.button === index && !seat.out) this.seatLayer.add(this.dealerChip(left + width - 8, this.seatY + 24));
      const label = this.seatLabel(index);
      this.seatLayer.add(
        addText(this, left + width / 2, this.seatY + SEAT_H - 8, label.text, {
          size: 8,
          color: label.color,
          originX: 0.5,
          originY: 0.5,
        }),
      );
    }
  }

  private dealerChip(x: number, y: number): Phaser.GameObjects.Container {
    const g = this.add.graphics();
    g.fillStyle(PX.ink, 1);
    g.fillCircle(0, 1, 6);
    g.fillStyle(PX.white, 1);
    g.fillCircle(0, 0, 5);
    return this.add.container(x, y, [g, addText(this, 0, 0, 'D', { size: 7, color: PX_CSS.dark, originX: 0.5, originY: 0.5 })]);
  }

  /** 컴퓨터 칸 아래에 적는 글: 차례, 한 일, 쇼다운의 족보 */
  private seatLabel(index: number): { text: string; color: string } {
    const { table } = this;
    const seat = table.seats[index];
    if (seat.out) return { text: '탈락', color: PX_CSS.faint };
    const result = table.result;
    if (result) {
      const value = result.values[index];
      const gain = result.payouts[index] - seat.committed;
      if (gain > 0) return { text: value ? `${rankInfo(value.category).name} +${gain}` : `+${gain}`, color: PX_CSS.good };
      if (value) return { text: rankInfo(value.category).name, color: PX_CSS.sub };
    }
    if (table.toAct === index) return { text: this.humans?.includes(index) ? '하는 중…' : '생각 중…', color: PX_CSS.accent };
    if (!seat.last) return { text: '', color: PX_CSS.sub };
    const name = ACTION_LABEL[seat.last.type];
    const amount = seat.last.type === 'fold' || seat.last.type === 'check' ? '' : ` ${seat.last.amount}`;
    return { text: `${name}${amount}`, color: seat.last.type === 'fold' ? PX_CSS.faint : PX_CSS.text };
  }

  /** 팟, 내 패, 내 칩과 위쪽 글 */
  private renderInfo(): void {
    const { table } = this;
    const me = this.me;
    this.chipsText.setText(String(me.chips));
    const hand = `${Math.max(1, Math.min(HANDS, table.handNo))}/${HANDS}`;
    this.roundText.setText(this.humans ? `${hand}판 · ${this.friends.scoreLine()}` : `${hand}번째 판`);
    // 위쪽 칩 칸에 닿지 않게 줄인다.
    const room = GAME_WIDTH - MARGIN - 82 - 6 - 40;
    this.roundText.setScale(this.roundText.width * this.roundText.scaleX > room ? room / (this.roundText.width) : 1);
    const pot = potTotal(table);
    this.potText.setText(table.handNo === 0 ? `블라인드 ${table.smallBlind}/${table.bigBlind}` : `${STREET_LABEL[table.street]} · 팟 ${pot}`);
    const value = me.hole.length > 0 ? currentHand(table, ME) : null;
    if (me.out) this.handText.setText('');
    else if (me.folded) this.handText.setText('폴드했어요').setColor(PX_CSS.faint);
    else if (value) this.handText.setText(`내 패: ${handName(value)}`).setColor(PX_CSS.accent);
    else this.handText.setText('');
    const parts: string[] = [];
    if (table.button === ME) parts.push('딜러(D)');
    if (me.hole.length > 0 && table.phase === 'betting') parts.push(`이번에 건 칩 ${me.bet}`);
    if (me.allIn && table.phase === 'betting') parts.push('올인!');
    this.myInfoText.setText(parts.join(' · '));
    this.refreshChart();
    if (value && !me.folded && (this.best === null || value.category > this.best)) this.best = value.category;
  }

  private say(label: string, color: string = PX_CSS.text): void {
    this.messageText.setText(label).setColor(color);
    this.tweens.killTweensOf(this.messageText);
    this.messageText.setScale(1.15);
    this.tweens.add({ targets: this.messageText, scale: 1, duration: 160, ease: 'Back.Out' });
  }

  // ───────── 족보 예시 ─────────

  private showExample(info: HandRankInfo): void {
    this.popup?.destroy();
    const width = GAME_WIDTH - MARGIN * 2 - CHART_W - 6;
    const height = 76;
    const x = MARGIN;
    const y = Math.round(this.boardY - height / 2);
    const g = this.add.graphics();
    drawPanel(g, 0, 0, width, height, { fill: PX.navy, border: PX.yellow, shadow: PX.ink, radius: 4, depth: 3 });
    const items: Phaser.GameObjects.GameObject[] = [g];
    items.push(addText(this, width / 2, 10, info.name, { size: 10, color: PX_CSS.accent, originX: 0.5, originY: 0.5 }));
    info.example.forEach((token, index) => {
      const card = parseExample(token);
      const face = this.makeFace(card, 'board');
      face.setPosition(width / 2 + (index - 2) * (BOARD_W + 2), 40);
      items.push(face);
    });
    items.push(addText(this, width / 2, height - 9, info.hint, { size: 8, color: PX_CSS.text, originX: 0.5, originY: 0.5 }));
    const popup = this.add.container(x, y, items).setDepth(DEPTH.popup);
    popup.setSize(width, height).setInteractive(new Phaser.Geom.Rectangle(width / 2, height / 2, width, height), Phaser.Geom.Rectangle.Contains);
    popup.on('pointerup', () => this.hideExample());
    this.popup = popup;
    sfx.click();
    this.time.delayedCall(2600, () => {
      if (this.popup === popup) this.hideExample();
    });
  }

  private hideExample(): void {
    this.popup?.destroy();
    this.popup = null;
  }

  // ───────── 버튼 ─────────

  private hideControls(): void {
    for (const button of [this.foldButton, this.callButton, this.allInButton, this.lessButton, this.raiseButton, this.moreButton]) {
      button.setVisible(false);
    }
  }

  /** 버튼을 모두 감춘다(친구와의 판이 끝났거나 방이 닫혔을 때) */
  private hideAllControls(): void {
    if (!this.versusBuilt) return;
    this.hideControls();
    this.dealButton?.setVisible(false);
    for (const button of this.setupButtons) button.setVisible(false);
  }

  private showMyTurn(): void {
    const can = options(this.table, ME);
    this.dealButton.setVisible(false);
    for (const button of [this.foldButton, this.callButton, this.allInButton, this.lessButton, this.raiseButton, this.moreButton]) {
      button.setVisible(true);
    }
    this.foldButton.setEnabled(can.fold);
    this.callButton.setLabel(can.check ? '체크' : `콜 ${can.call}`).setEnabled(can.check || can.call > 0);
    this.allInButton.setLabel(`올인 ${can.allIn}`).setEnabled(can.allIn > 0);
    this.raiseTo = can.raise ? can.raise.min : 0;
    this.refreshRaise();
  }

  private refreshRaise(): void {
    const can = options(this.table, ME);
    if (!can.raise) {
      this.raiseButton.setLabel('레이즈').setEnabled(false);
      this.lessButton.setEnabled(false);
      this.moreButton.setEnabled(false);
      return;
    }
    this.raiseButton.setLabel(`레이즈 ${this.raiseTo}`).setEnabled(true);
    this.lessButton.setEnabled(this.raiseTo > can.raise.min);
    this.moreButton.setEnabled(this.raiseTo < can.raise.max);
  }

  private nudgeRaise(direction: number): void {
    const can = options(this.table, ME);
    if (!this.playing || this.busy || !can.raise) return;
    // 팟이 크면 한 번에 더 크게 움직인다.
    const step = Math.max(BIG_BLIND, Math.floor(potTotal(this.table) / 4 / BIG_BLIND) * BIG_BLIND);
    this.raiseTo = Phaser.Math.Clamp(this.raiseTo + direction * step, can.raise.min, can.raise.max);
    sfx.click();
    this.refreshRaise();
  }

  // ───────── 핸드 ─────────

  private betweenHands(first = false): void {
    this.busy = false;
    this.hideControls();
    this.dealButton.setVisible(true).setEnabled(true);
    this.dealButton.setLabel(first ? '딜하기 · 첫 판 시작' : `다음 판 (${this.table.handNo + 1}/${HANDS})`);
    if (first) {
      this.say('족보표를 누르면 예가 나와요', PX_CSS.sub);
      this.render();
    }
  }

  startNextHand(): void {
    if (this.humans) {
      this.sendMove({ type: 'deal' });
      return;
    }
    if (!this.playing || this.busy || this.table.phase === 'betting') return;
    if (!startHand(this.table)) return;
    this.hideExample();
    this.busy = true;
    this.shown = new Map();
    this.dealButton.setVisible(false);
    this.hideControls();
    this.say('');
    this.render(() => this.step());
  }

  /** 다음 사람이 둘 차례: 나면 버튼을 보이고, 컴퓨터면 잠깐 생각한 뒤에 둔다. */
  private step(): void {
    const { table } = this;
    if (table.phase === 'done') {
      this.onHandDone();
      return;
    }
    const turn = table.toAct;
    if (turn === null) return;
    if (turn === ME) {
      this.busy = false;
      const can = options(table, ME);
      this.say(can.check ? '내 차례예요' : `${can.call}칩을 내야 따라가요`, PX_CSS.text);
      this.renderSeats();
      this.showMyTurn();
      return;
    }
    this.busy = true;
    this.hideControls();
    this.renderSeats();
    const fast = this.me.folded || this.me.allIn || this.me.out;
    this.time.delayedCall(fast ? BOT_FAST_MS : BOT_MS, () => {
      const move = chooseMove(table, turn, BOT_STYLES[(turn - 1) % BOT_STYLES.length]) ?? { type: 'fold' };
      const street = table.street;
      act(table, turn, move);
      this.sayMove(turn, move);
      // 거리가 바뀌어 카드가 깔리면 잠깐 쉬었다가 다음 사람으로 간다.
      const pause = table.street !== street && table.phase === 'betting' ? 250 : 0;
      this.render(() => this.time.delayedCall(pause, () => this.step()));
    });
  }

  private sayMove(index: number, move: Move): void {
    const seat = { ...this.table.seats[index], name: this.seatName(index) };
    const label = seat.last ? ACTION_LABEL[seat.last.type] : ACTION_LABEL[move.type];
    if (move.type === 'raise' || move.type === 'allin') {
      sfx.coin();
      this.say(`${seat.name}: ${label} ${seat.last?.amount ?? ''}`, PX_CSS.accent);
    } else if (move.type === 'call') {
      sfx.click();
      this.say(`${seat.name}: ${label}`, PX_CSS.text);
    } else {
      this.say(`${seat.name}: ${label}`, move.type === 'fold' ? PX_CSS.faint : PX_CSS.sub);
    }
  }

  private play(move: Move): void {
    if (this.humans) {
      if (this.table.toAct === ME) this.sendMove(move);
      return;
    }
    if (!this.playing || this.busy || this.table.toAct !== ME) return;
    if (!act(this.table, ME, move)) {
      sfx.deny();
      return;
    }
    this.busy = true;
    this.hideControls();
    if (move.type === 'fold') sfx.miss();
    else if (move.type === 'raise' || move.type === 'allin') sfx.coin();
    else sfx.click();
    this.say(`나: ${ACTION_LABEL[this.me.last?.type ?? move.type]}`, PX_CSS.sub);
    this.render(() => this.step());
  }

  private onHandDone(): void {
    const { table } = this;
    const result = table.result;
    this.busy = true;
    this.hideControls();
    // 쇼다운이면 남은 사람의 카드를 펼치고 이긴 족보를 빛낸다.
    this.render(() => {
      if (!result) return;
      const gain = result.payouts[ME] - this.me.committed;
      const winners = [...new Set(result.pots.flatMap((pot) => pot.winners))];
      const head = winners[0];
      const value = head === undefined ? null : result.values[head];
      const names = winners.map((index) => (index === ME ? '나' : this.seatName(index))).join(', ');
      const how = result.showdown && value ? ` · ${handName(value)}` : result.showdown ? '' : ' · 모두 폴드';
      if (result.payouts[ME] > 0) {
        this.wins += 1;
        this.say(`${winners.length > 1 ? '나눠 가져요' : '이겼어요!'} +${result.payouts[ME]}${how}`, PX_CSS.good);
        this.floatChips(`+${result.payouts[ME]}`, PX_CSS.good);
        if (value && value.category >= Category.Straight) sfx.fanfare();
        else sfx.coin();
        vibrate(15);
      } else {
        this.say(`${names} 승리${how}`, gain < 0 ? PX_CSS.bad : PX_CSS.sub);
        if (gain < 0 && !this.me.folded) {
          sfx.miss();
          vibrate(25);
        }
      }
      this.peak = Math.max(this.peak, this.me.chips);
      this.renderInfo();
      this.time.delayedCall(700, () => {
        if (runOver(table)) {
          this.endRun();
          return;
        }
        this.betweenHands();
      });
    });
  }

  private floatChips(label: string, color: string): void {
    // 내 카드 위에서 떠오른다(컴퓨터 칸의 글을 가리지 않게).
    const text = addText(this, this.leftCenter, this.holeY, label, {
      size: 14,
      color,
      originX: 0.5,
      originY: 0.5,
      stroke: PX_CSS.dark,
    }).setDepth(DEPTH.float);
    this.tweens.add({ targets: text, y: text.y - 16, alpha: 0, duration: 900, ease: 'Cubic.Out', onComplete: () => text.destroy() });
  }

  // ───────── 끝 ─────────

  private endRun(): void {
    const me = this.me;
    this.busy = true;
    this.hideControls();
    this.dealButton.setVisible(false);
    if (me.out) this.say('칩을 다 잃었어요. 다음엔 100개로 다시!', PX_CSS.bad);
    else if (seatsInPlay(this.table) < 2) this.say('컴퓨터를 모두 이겼어요!', PX_CSS.accent);
    else this.say(`${HANDS}판 끝! 남은 칩 ${me.chips}개`, PX_CSS.accent);
    this.finish(1600);
  }

  private finish(delay: number): void {
    const chips = this.me.chips;
    const change = chips - START_CHIPS;
    this.finishMiniGame(
      chips,
      [
        ['처음보다', change >= 0 ? `+${change}칩` : `${change}칩`],
        ['이긴 판', `${this.wins}번`],
        ['가장 센 패', this.best === null ? '-' : rankInfo(this.best).name],
        ['가장 많던 칩', `${this.peak}개`],
      ],
      delay,
    );
  }

  protected override canFinishEarly(): boolean {
    return !this.humans && !this.friends.active && this.playing && this.table.handNo > 0;
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

  protected override retryData(): object {
    return { solo: true } satisfies PokerStart;
  }

  protected override restartLabel(): string | null {
    return this.friends.restartLabel();
  }

  protected override quitWarning(): string | null {
    return this.friends.quitWarning();
  }

  // ───────── 친구와 하기 ─────────

  /** 친구와 하는 방이 바뀌었다. 탁자를 다시 그리고, 내 차례면 버튼을 보인다. */
  private onRoom(room: RoomView<PokerView>, fresh: boolean): void {
    const view = room.game;
    if (!view) return;
    if (!this.versusBuilt) {
      this.versusBuilt = true;
      this.buildTable();
      this.buildSetup();
      this.addPauseButton();
    }
    this.playing = room.status === 'playing';
    if (fresh) {
      this.shown = new Map();
      this.seenMoves = -1;
    }
    const before = this.table;
    const newMoves = view.moves !== this.seenMoves;
    this.seenMoves = view.moves;
    this.humans = view.humans;
    this.table = view.table ?? this.setupTable(room);
    if (view.table && before.handNo !== view.table.handNo) this.shown = new Map();
    else if (this.seenSeat !== room.seat) {
      // 한 폰으로 할 때 폰을 넘기면 탁자를 다른 사람 쪽에서 본다. 카드가 다시 날아오지 않게 지금 모습을 그대로 둔다.
      this.shown = new Map(this.layout().map((item) => [item.key, item.hidden]));
    }
    this.seenSeat = room.seat;
    this.hideExample();
    this.render();
    if (newMoves) this.soundFor(view);
    this.updateVersus(room, view);
  }

  /** 아직 첫 판을 나누기 전: 두 사람만 앉은 빈 탁자를 보인다. */
  private setupTable(room: RoomView<PokerView>): PokerTable {
    const table = createTable(seatPlan(0).names);
    this.humans = [room.seat === 0 ? 0 : 1, room.seat === 0 ? 1 : 0];
    return table;
  }

  /** 첫 판에 함께 앉을 컴퓨터 수를 고르는 버튼. 판 버튼과 같은 자리에 둔다. */
  private buildSetup(): void {
    const top = this.scale.height - MARGIN - BUTTON_H * 2 - GAP;
    const full = GAME_WIDTH - MARGIN * 2;
    const half = (full - GAP) / 2;
    const choices = [
      { bots: 2, x: MARGIN, y: top, width: full, label: '컴퓨터 2명과 넷이서', style: 'pink' as const },
      { bots: 1, x: MARGIN, y: top + BUTTON_H + GAP, width: half, label: '컴퓨터 1명과', style: 'green' as const },
      { bots: 0, x: MARGIN + half + GAP, y: top + BUTTON_H + GAP, width: half, label: '둘이서만', style: 'blue' as const },
    ];
    this.setupButtons = choices.map(
      (choice) =>
        new PixelButton(this, {
          x: choice.x,
          y: choice.y,
          width: choice.width,
          height: BUTTON_H,
          label: choice.label,
          style: choice.style,
          onTap: () => this.sendMove({ type: 'deal', bots: choice.bots }),
        }),
    );
    for (const button of this.setupButtons) button.setVisible(false);
  }

  private updateVersus(room: RoomView<PokerView>, view: PokerView): void {
    const { table } = this;
    const mine = room.status === 'playing' && pokerTurn(view) === room.seat;
    const turn = pokerTurn(view);
    const other = turn === null ? '' : this.friends.nameOf(turn);
    const who = this.friends.kind === 'local' ? this.friends.nameOf(room.seat) : '내';
    this.hideAllControls();
    if (room.status !== 'playing') {
      const line = this.handLine();
      if (line) this.say(line.text, line.color);
      return;
    }
    if (!view.table) {
      if (mine) {
        for (const button of this.setupButtons) button.setVisible(true).setEnabled(true);
        this.say('함께 앉을 컴퓨터를 골라요\n고르면 바로 첫 판을 나눠요', PX_CSS.text);
      } else {
        this.say(`${withSubject(other)} 자리를 정하는 중…`, PX_CSS.sub);
      }
      return;
    }
    if (table.phase === 'betting') {
      const head = this.logLine(view.log);
      if (mine) {
        const can = options(table, ME);
        this.say(`${head ? `${head}\n` : ''}${who} 차례 · ${can.check ? '체크할 수 있어요' : `콜 ${can.call}칩`}`, PX_CSS.text);
        this.showMyTurn();
      } else {
        this.say(`${head ? `${head}\n` : ''}${withSubject(other)} 하는 중…`, PX_CSS.sub);
      }
      return;
    }
    // 핸드가 끝났다: 결과를 알리고, 딜할 사람에게 "다음 판"을 보인다.
    const line = this.handLine();
    if (mine) {
      this.dealButton.setVisible(true).setEnabled(true).setLabel(`다음 판 (${table.handNo + 1}/${HANDS})`);
      if (line) this.say(line.text, line.color);
    } else {
      this.say(`${line ? `${line.text}\n` : ''}${withSubject(other)} 다음 판을 나눠요`, line?.color ?? PX_CSS.sub);
    }
  }

  /** 마지막 수로 일어난 일(블라인드는 빼고) 한 줄. 길면 끝의 셋만 */
  private logLine(log: readonly PokerLog[]): string {
    const parts = log
      .filter((entry) => entry.type !== 'blind')
      .map((entry) => {
        const amount = entry.type === 'raise' || entry.type === 'allin' || entry.type === 'call' ? ` ${entry.amount}` : '';
        return `${this.seatName(entry.who)} ${ACTION_LABEL[entry.type]}${entry.type === 'call' ? '' : amount}`;
      });
    return parts.slice(-3).join(' · ');
  }

  /** 끝난 핸드의 결과 한 줄(보는 사람 쪽에서) */
  private handLine(): { text: string; color: string } | null {
    const { table } = this;
    const result = table.result;
    if (!result || table.phase !== 'done') return null;
    const winners = [...new Set(result.pots.flatMap((pot) => pot.winners))];
    const head = winners[0];
    const value = head === undefined ? null : result.values[head];
    const how = result.showdown && value ? ` · ${handName(value)}` : result.showdown ? '' : ' · 모두 폴드';
    if (result.payouts[ME] > 0) {
      return { text: `${winners.length > 1 ? '나눠 가져요' : `${this.friends.kind === 'local' ? `${this.seatName(ME)} ` : ''}이겼어요!`} +${result.payouts[ME]}${how}`, color: PX_CSS.good };
    }
    const names = winners.map((index) => this.seatName(index)).join(', ');
    return { text: `${names} 승리${how}`, color: result.payouts[ME] - this.me.committed < 0 ? PX_CSS.bad : PX_CSS.sub };
  }

  private soundFor(view: PokerView): void {
    const table = view.table;
    if (!table) return;
    if (table.phase === 'done' && table.result) {
      if (table.result.payouts[ME] > 0) {
        sfx.coin();
        vibrate(15);
      } else if (!this.me.folded && table.result.payouts[ME] - this.me.committed < 0) {
        sfx.miss();
      }
      return;
    }
    const last = view.log[view.log.length - 1];
    if (!last) return;
    if (last.type === 'raise' || last.type === 'allin') sfx.coin();
    else if (last.type === 'fold') sfx.miss();
    else sfx.click();
  }

  /** 한 폰으로 할 때 폰을 넘기는 판에 덧붙일 한 줄 */
  private coverNote(): string | null {
    const view = this.friends.room?.game;
    if (!view?.table) return null;
    if (view.table.phase === 'done') return this.handLine()?.text ?? null;
    return this.logLine(view.log) || null;
  }

  private sendMove(move: PokerVersusMove): void {
    if (this.busy || !this.friends.myTurn()) return;
    this.busy = true;
    this.hideAllControls();
    void this.friends.send(move).then((ok) => {
      this.busy = false;
      // 받아들여졌으면 방이 이미 바뀌어 다시 그렸다. 답을 기다리는 동안 감춘 버튼을 지금 차례에 맞게 다시 보인다.
      const room = this.friends.room;
      if (room?.game && (!ok || this.friends.myTurn())) this.updateVersus(room, room.game);
    });
  }

  /** 친구와의 판이 끝났을 때 결과 판에 적을 것 */
  private friendResult(room: RoomView<PokerView>): FriendsResult & { won: boolean | null } {
    const view = room.game!;
    const table = view.table!;
    const [a, b] = view.humans.map((index) => table.seats[index]);
    const winner: RoomSeat | null = a.out !== b.out ? (a.out ? 1 : 0) : a.chips === b.chips ? null : a.chips > b.chips ? 0 : 1;
    const local = this.friends.kind === 'local';
    const won = winner === null ? null : winner === room.seat;
    const title = winner === null ? '비겼어요' : local ? `${withSubject(room.names[winner] ?? '')} 이겼어요!` : won ? '이겼어요!' : '졌어요';
    const broke = a.out ? 0 : b.out ? 1 : -1;
    const how = broke >= 0 ? `${withSubject(this.friends.nameOf(broke as RoomSeat))} 칩을 다 잃었어요` : `${HANDS}판을 다 했어요`;
    const line = `남은 칩  ${this.friends.nameOf(0)} ${a.chips} · ${this.friends.nameOf(1)} ${b.chips}`;
    return { title, lines: [line, how], bright: local ? winner !== null : won === true, lost: !local && won === false, won };
  }

  /** 기록하고 끝내기: 지금 가진 칩이 점수다. 판 위에 걸려 있던 칩은 돌려받지 못한다. */
  protected override finishEarly(): void {
    this.hideControls();
    this.dealButton.setVisible(false);
    this.finish(300);
  }
}

const EXAMPLE_SUIT: Readonly<Record<string, Card['suit']>> = { S: 'spade', H: 'heart', D: 'diamond', C: 'club' };
const EXAMPLE_RANK: Readonly<Record<string, number>> = { A: 1, J: 11, Q: 12, K: 13 };

/** 족보표 예시의 그림 글("10S", "KH")을 카드로 */
function parseExample(token: string): Card {
  const body = token.slice(0, -1);
  return { rank: EXAMPLE_RANK[body] ?? Number(body), suit: EXAMPLE_SUIT[token.slice(-1)] };
}
