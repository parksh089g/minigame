import Phaser from 'phaser';
import { GAME_WIDTH } from '../../config';
import { homeScene } from '../../core/home';
import { sfx } from '../../core/sfx';
import { addTapZone, addText, fadeToScene, PixelButton } from '../../core/ui';
import { MiniGameScene, type ResultStat } from '../../scenes/MiniGameScene';
import { FriendsKit, type FriendsResult, type FriendsStart } from '../../versus/friends-kit';
import type { RoomView, Seat } from '../../versus/protocol';
import { withSubject } from '../../versus/text';
import { PX, PX_CSS } from '../cloud-tower/art';
import { drawSky, pxPanel } from '../cloud-tower/bits';
import { botTexture, CARD, jokerTexture, registerOneCardTextures, suitTexture, TEX } from './art';
import { chooseMove, chooseSuitFor, REACTION, selfCallDelay } from './bot';
import { loadPrefs, savePrefs, type OneCardPrefs } from './prefs';
import {
  callOneCard,
  canPlay,
  catchOneCard,
  chooseSuit,
  closeOneCard,
  createGame,
  drawTurn,
  isJoker,
  isRed,
  LEVELS,
  matchScore,
  MAX_BOTS,
  playableCards,
  playCard,
  SUITS,
  takeEvents,
  topCard,
  type Card,
  type GameEvent,
  type GameState,
  type Level,
  type Suit,
} from './rules';
import {
  cardEffect,
  cardLabel,
  FRIEND_TEXT,
  eventLine,
  LEVEL_NAME,
  LEVEL_NOTE,
  nameOf,
  ONE_CARD_GAME_ID,
  ONE_CARD_SCENE,
  RANK_LABEL,
  SPECIAL_RULES,
  SUIT_NAME,
  TEXT,
} from './text';
import { CALL_WINDOW_MS, oneCardVersus, readOneCardView, type OneCardMove, type OneCardView } from './versus';

/** 씬을 열 때 넘기는 값. quick이면 준비 화면을 건너뛰고 지난 설정으로 바로 시작한다("다시 하기"). */
export interface OneCardStart extends FriendsStart {
  quick?: boolean;
}

type Phase = 'lobby' | 'play' | 'over';

const MARGIN = 8;
const WIDTH = GAME_WIDTH - MARGIN * 2;
/** 컴퓨터가 한 수를 두기까지 기다리는 시간(ms) */
const BOT_DELAY: Readonly<Record<Level, number>> = { easy: 850, normal: 750, hard: 700 };
/** 컴퓨터의 원카드를 사람이 잡을 수 있는 시간(ms) */
const CATCH_WINDOW = 2600;
const FLY_MS = 220;
const NOTICE_MS = 1700;

interface Layout {
  oppTop: number;
  oppHeight: number;
  pileTop: number;
  deckX: number;
  discardX: number;
  messageTop: number;
  handTop: number;
  handBottom: number;
  buttonTop: number;
}

/**
 * 원카드: 컴퓨터 1~3명과 겨루는 카드 게임. 같은 무늬나 숫자를 내고 먼저 다 내면 이긴다.
 * 규칙은 rules.ts, 컴퓨터의 판단은 bot.ts가 맡고, 이 씬은 그리기와 차례 진행, 원카드를 외치는 시간을 맡는다.
 * 그림은 구름 탑 모험처럼 어두운 바탕의 픽셀 그림이다.
 */
export class OneCardScene extends MiniGameScene {
  protected readonly gameId = ONE_CARD_GAME_ID;

  private phase: Phase = 'lobby';
  private prefs: OneCardPrefs = loadPrefs();
  /** 하고 있는 판. 자동 점검이 들여다본다. */
  state: GameState | null = null;
  private layout!: Layout;
  /** 판이 바뀔 때마다 다시 그리는 것들 */
  private table: Phaser.GameObjects.GameObject[] = [];
  private overlay: Phaser.GameObjects.GameObject[] = [];
  private message!: Phaser.GameObjects.Text;
  private drawButton!: PixelButton;
  private oneCardButton!: PixelButton;
  /** 연출이나 컴퓨터 차례 중이라 사람이 누를 수 없을 때 true */
  private busy = false;
  private selected: number | null = null;
  private notice: string | null = null;
  private noticeTimer: Phaser.Time.TimerEvent | null = null;
  /** 원카드를 기다리는 동안 걸어 둔 시계들 */
  private oneCardTimers: Phaser.Time.TimerEvent[] = [];

  // ───────── 친구와 하기 ─────────
  /** 친구와 하기 화면. 자동 점검이 들여다본다. */
  friends!: FriendsKit<OneCardView, OneCardMove>;
  /** 친구와 하는 판의 화면 틀(위쪽 줄, 버튼)을 그렸는지 */
  private frameBuilt = false;
  private subLabel: Phaser.GameObjects.Text | null = null;
  /** 마지막으로 알린 수의 번호. 같은 일을 두 번 알리지 않는다. */
  private seenMoves = -1;
  /** 친구가 한 마지막 일. 폰을 넘길 때 가림 판에 적는다. */
  private lastLine: string | null = null;
  /** 원카드를 외칠 시간을 재는 시계와, 그 시계를 건 수의 번호 */
  private callTimer: Phaser.Time.TimerEvent | null = null;
  private callFor = -1;
  private suitOpen = false;

  constructor() {
    super(ONE_CARD_SCENE);
  }

  create(data: OneCardStart = {}): void {
    this.sys.settings.data = {};
    this.beginMiniGame();
    registerOneCardTextures(this);
    this.prefs = loadPrefs();
    this.state = null;
    this.table = [];
    this.overlay = [];
    this.busy = false;
    this.selected = null;
    this.notice = null;
    this.noticeTimer = null;
    this.oneCardTimers = [];
    this.frameBuilt = false;
    this.subLabel = null;
    this.seenMoves = -1;
    this.lastLine = null;
    this.callTimer = null;
    this.callFor = -1;
    this.suitOpen = false;
    drawSky(this, 0);
    this.friends = new FriendsKit<OneCardView, OneCardMove>(this, {
      game: 'one-card',
      title: TEXT.title,
      rules: oneCardVersus,
      readView: readOneCardView,
      isMyTurn: (room) => {
        const game = room.game?.game;
        if (!game || game.winner !== null) return false;
        return game.oneCard !== null ? game.oneCard === 0 : game.turn === 0;
      },
      cover: true,
      onRoom: (room, fresh) => this.onRoom(room, fresh),
      result: (room) => this.friendResult(room),
      onClosed: () => this.friendsClosed(),
      say: (text) => this.showNotice(text),
      coverNote: () => this.lastLine,
      restart: (start) => this.scene.restart(start satisfies OneCardStart),
    });
    if (this.friends.begin(data)) return;
    if (data.quick) this.startGame();
    else this.openLobby();
  }

  // ───────── 준비 화면 ─────────

  private openLobby(): void {
    this.phase = 'lobby';
    const { height } = this.scale;
    const objects: Phaser.GameObjects.GameObject[] = [];
    const redraw = (): void => {
      for (const object of objects) object.destroy();
      objects.length = 0;
      const before = this.children.list.length;
      this.drawLobby(redraw);
      objects.push(...this.children.list.slice(before));
    };
    new PixelButton(this, { x: 8, y: 8, width: 26, height: 26, icon: 'icon-back', hitPadding: 6, onTap: () => fadeToScene(this, homeScene()) });
    addText(this, 42, 21, TEXT.title, { size: 16, color: PX_CSS.accent, originY: 0.5 });
    const record = this.prefs.plays > 0 ? TEXT.record(this.prefs.wins, this.prefs.plays) : TEXT.firstTime;
    // 오른쪽 위에 규칙 안내서 버튼을 두고, 전적은 그 왼쪽에 적는다. 처음 하는 사람에게는 안내서가 한 번 저절로 열린다.
    const rulesX = GAME_WIDTH - MARGIN - 44;
    new PixelButton(this, { x: rulesX, y: 8, width: 44, height: 26, label: TEXT.ruleBook, style: 'yellow', hitPadding: 4, onTap: () => this.openRuleBook() });
    addText(this, rulesX - 6, 21, record, { size: 10, color: PX_CSS.sub, originX: 1, originY: 0.5 });
    this.offerRuleBook(() => this.phase === 'lobby');
    redraw();
    // 아래 줄: 왼쪽은 친구와 함께, 오른쪽은 컴퓨터와 시작
    const friendsWidth = 92;
    this.friends.lobbyButton(MARGIN, height - 8 - 36, friendsWidth, 36);
    new PixelButton(this, {
      x: MARGIN + friendsWidth + 6,
      y: height - 8 - 36,
      width: WIDTH - friendsWidth - 6,
      height: 36,
      label: TEXT.start,
      style: 'green',
      onTap: () => this.startGame(),
    });
  }

  /** 준비 화면에서 고를 때마다 다시 그리는 부분 */
  private drawLobby(redraw: () => void): void {
    const { height } = this.scale;
    pxPanel(this.add.graphics(), MARGIN, 40, WIDTH, 34, { depth: 2, radius: 6 });
    addText(this, GAME_WIDTH / 2, 57, TEXT.intro, {
      size: 10,
      color: PX_CSS.sub,
      originX: 0.5,
      originY: 0.5,
      align: 'center',
      lineSpacing: 1,
    });

    // 컴퓨터 실력
    addText(this, MARGIN + 2, 84, TEXT.level, { size: 11, color: PX_CSS.text });
    const levelWidth = (WIDTH - 8) / 3;
    LEVELS.forEach((level, index) => {
      this.toggle(MARGIN + index * (levelWidth + 4), 100, levelWidth, 28, LEVEL_NAME[level], this.prefs.level === level, () => {
        this.prefs = { ...this.prefs, level };
        savePrefs(this.prefs);
        redraw();
      });
    });
    addText(this, GAME_WIDTH / 2, 140, LEVEL_NOTE[this.prefs.level], { size: 10, color: PX_CSS.faint, originX: 0.5, originY: 0.5 });

    // 상대 수
    addText(this, MARGIN + 2, 154, TEXT.bots, { size: 11, color: PX_CSS.text });
    for (let bots = 1; bots <= MAX_BOTS; bots += 1) {
      const x = MARGIN + (bots - 1) * (levelWidth + 4);
      this.toggle(x, 170, levelWidth, 26, TEXT.botCount[bots - 1], this.prefs.bots === bots, () => {
        this.prefs = { ...this.prefs, bots };
        savePrefs(this.prefs);
        redraw();
      });
    }

    // 특수 카드
    const top = 206;
    const bottom = height - 8 - 36 - 8;
    pxPanel(this.add.graphics(), MARGIN, top, WIDTH, bottom - top, { depth: 2, radius: 6, fill: PX.navy });
    addText(this, MARGIN + 8, top + 6, TEXT.rules, { size: 11, color: PX_CSS.accent });
    const rowHeight = Math.min(17, (bottom - top - 26) / SPECIAL_RULES.length);
    SPECIAL_RULES.forEach(([label, text], index) => {
      const y = top + 24 + index * rowHeight;
      const chip = this.add.graphics();
      const chipWidth = label.length > 1 ? 30 : 16;
      chip.fillStyle(PX.ink, 1).fillRect(MARGIN + 8, y, chipWidth, 14);
      chip.fillStyle(PX.white, 1).fillRect(MARGIN + 9, y + 1, chipWidth - 2, 12);
      addText(this, MARGIN + 8 + chipWidth / 2, y + 7, label, {
        size: 10,
        color: label === 'A' || label === '2' || label === '조커' ? PX_CSS.bad : PX_CSS.dark,
        originX: 0.5,
        originY: 0.5,
      });
      addText(this, MARGIN + 46, y + 7, text, { size: 10, color: PX_CSS.text, originY: 0.5 });
    });
  }

  /** 픽셀 판 모양의 고르기 버튼 */
  private toggle(x: number, y: number, width: number, height: number, label: string, on: boolean, onTap: () => void): void {
    const panel = this.add.graphics();
    const draw = (pressed: boolean): void => {
      panel.clear();
      pxPanel(panel, x, y + (pressed ? 1 : 0), width, height, {
        depth: 2,
        radius: 4,
        fill: on ? PX.panelHi : PX.panel,
        border: on ? PX.yellow : undefined,
      });
    };
    draw(false);
    addText(this, x + width / 2, y + height / 2, label, { size: 12, color: on ? PX_CSS.accent : PX_CSS.sub, originX: 0.5, originY: 0.5 });
    addTapZone(this, x, y, width, height, draw, () => {
      if (!on) sfx.click();
      onTap();
    });
  }

  // ───────── 판 ─────────

  private startGame(): void {
    // 준비 화면의 것들을 지우고 판을 그린다.
    this.children.removeAll(true);
    drawSky(this, 0);
    this.phase = 'play';
    this.playing = true;
    this.state = createGame(this.prefs.bots, Math.floor(Math.random() * 0x7fffffff));
    this.layout = this.computeLayout();
    this.drawFrame();
    this.advance();
  }

  private computeLayout(): Layout {
    const { height } = this.scale;
    // 화면이 400보다 길면 남는 자리를 더미 둘레에 나눠 준다.
    const extra = Math.max(0, height - 400);
    const oppTop = 40;
    const oppHeight = 52;
    const pileTop = oppTop + oppHeight + 12 + Math.round(extra * 0.6);
    const messageTop = pileTop + CARD.bigH + 12;
    const buttonTop = height - 8 - 34;
    return {
      oppTop,
      oppHeight,
      pileTop,
      deckX: GAME_WIDTH / 2 - 8 - CARD.bigW,
      discardX: GAME_WIDTH / 2 + 8,
      messageTop,
      handTop: messageTop + 30,
      handBottom: buttonTop - 6,
      buttonTop,
    };
  }

  /** 판 동안 바뀌지 않는 것: 위쪽 줄, 탁자, 알림 줄, 버튼 */
  private drawFrame(): void {
    const L = this.layout;
    this.addPauseButton();
    addText(this, 40, 14, TEXT.title, { size: 14, color: PX_CSS.text, originY: 0.5 });
    const sub = this.friends.match ? this.friends.scoreLine() : `${LEVEL_NAME[this.prefs.level]} · 상대 ${this.prefs.bots}명`;
    this.subLabel = addText(this, 40, 29, sub, { size: 9, color: PX_CSS.sub, originY: 0.5 });
    // 더미가 놓이는 탁자
    const felt = this.add.graphics().setDepth(-5);
    pxPanel(felt, MARGIN, L.pileTop - 8, WIDTH, CARD.bigH + 16, { fill: 0x1f4e55, border: PX.teal, shadow: PX.ink, radius: 4 });
    const panel = this.add.graphics();
    pxPanel(panel, MARGIN, L.messageTop, WIDTH, 24, { fill: PX.navy, shadow: null, radius: 4 });
    this.message = addText(this, GAME_WIDTH / 2, L.messageTop + 12, '', { size: 10, color: PX_CSS.text, originX: 0.5, originY: 0.5 });
    this.drawButton = new PixelButton(this, {
      x: MARGIN,
      y: L.buttonTop,
      width: 140,
      height: 34,
      label: TEXT.draw,
      onTap: () => this.humanDraw(),
    });
    this.oneCardButton = new PixelButton(this, {
      x: MARGIN + 146,
      y: L.buttonTop,
      width: WIDTH - 146,
      height: 34,
      label: TEXT.oneCard,
      style: 'yellow',
      onTap: () => this.humanCall(),
    });
  }

  /** 지금 판을 다시 그린다. */
  private redraw(): void {
    for (const object of this.table) object.destroy();
    this.table = [];
    const state = this.state;
    if (!state) return;
    const before = this.children.list.length;
    this.drawOpponents(state);
    this.drawPiles(state);
    this.drawHand(state);
    this.table.push(...this.children.list.slice(before));
    this.updateControls();
  }

  private oppBox(index: number): { x: number; y: number; w: number; h: number } {
    const bots = (this.state?.players.length ?? 2) - 1;
    const gap = 4;
    const w = (WIDTH - gap * (bots - 1)) / bots;
    return { x: MARGIN + (index - 1) * (w + gap), y: this.layout.oppTop, w, h: this.layout.oppHeight };
  }

  private drawOpponents(state: GameState): void {
    for (let index = 1; index < state.players.length; index += 1) {
      const player = state.players[index];
      const box = this.oppBox(index);
      const turn = state.turn === index && state.winner === null;
      pxPanel(this.add.graphics(), box.x, box.y, box.w, box.h, {
        depth: 2,
        radius: 4,
        fill: player.out ? PX.ink : turn ? PX.panelHi : PX.panel,
        border: turn ? PX.yellow : undefined,
      });
      const face = this.add.image(box.x + 16, box.y + 17, botTexture(index - 1));
      if (player.out) face.setAlpha(0.4);
      addText(this, box.x + 31, box.y + 10, this.who(index), { size: 11, color: player.out ? PX_CSS.faint : PX_CSS.text, originY: 0.5 });
      const count = player.out ? TEXT.broke : TEXT.cards(player.hand.length);
      addText(this, box.x + 31, box.y + 24, count, {
        size: 10,
        color: player.out ? PX_CSS.bad : player.hand.length === 1 ? PX_CSS.accent : PX_CSS.sub,
        originY: 0.5,
      });
      if (player.out) continue;
      // 뒷면을 겹쳐 늘어놓아 몇 장인지 보여 준다.
      const shown = Math.min(player.hand.length, 20);
      const room = box.w - 12 - CARD.smallW;
      const step = shown > 1 ? Math.min(6, room / (shown - 1)) : 0;
      for (let i = 0; i < shown; i += 1) {
        this.add.image(box.x + 6 + i * step, box.y + 33, TEX.backSmall).setOrigin(0, 0);
      }
    }
  }

  private drawPiles(state: GameState): void {
    const L = this.layout;
    // 뽑을 더미: 두께를 보이게 두 장을 어긋나게 놓는다.
    if (state.deck.length > 0) {
      if (state.deck.length > 1) this.add.image(L.deckX + 2, L.pileTop + 2, TEX.back).setOrigin(0, 0).setDisplaySize(CARD.bigW, CARD.bigH);
      this.add.image(L.deckX, L.pileTop, TEX.back).setOrigin(0, 0).setDisplaySize(CARD.bigW, CARD.bigH);
    }
    addText(this, L.deckX + CARD.bigW / 2, L.pileTop + CARD.bigH + 1, String(state.deck.length), {
      size: 9,
      color: PX_CSS.sub,
      originX: 0.5,
    });
    this.addCard(L.discardX, L.pileTop, topCard(state), true);
    // 공격이 쌓였으면 더미 왼쪽에, 맞출 무늬는 오른쪽에 보인다.
    const sideY = L.pileTop + CARD.bigH / 2;
    if (state.attack > 0) {
      const g = this.add.graphics();
      pxPanel(g, MARGIN + 4, sideY - 14, 50, 28, { fill: PX.red, border: PX.yellow, shadow: PX.ink, radius: 3 });
      addText(this, MARGIN + 29, sideY, `+${state.attack}`, { size: 15, color: PX_CSS.text, originX: 0.5, originY: 0.5 });
    }
    const right = L.discardX + CARD.bigW + 6;
    addText(this, right + 25, sideY - 16, TEXT.suitNow, { size: 9, color: PX_CSS.sub, originX: 0.5 });
    if (state.suit) {
      const g = this.add.graphics();
      g.fillStyle(PX.ink, 1).fillRect(right + 13, sideY - 3, 24, 22);
      g.fillStyle(PX.white, 1).fillRect(right + 14, sideY - 2, 22, 20);
      this.add.image(right + 25, sideY + 8, suitTexture(state.suit, true));
    } else {
      addText(this, right + 25, sideY + 8, TEXT.anySuit, { size: 10, color: PX_CSS.accent, originX: 0.5, originY: 0.5 });
    }
  }

  /** 손의 카드 자리. 일곱 장까지는 한 줄, 넘으면 두 줄로 겹쳐 놓는다. */
  private handSlots(count: number): Array<{ x: number; y: number }> {
    const L = this.layout;
    const rows = count > 7 ? 2 : 1;
    const perRow = Math.ceil(count / rows);
    const rowGap = CARD.h + 6;
    const blockHeight = rows * CARD.h + (rows - 1) * 6;
    // 손의 카드는 버튼 바로 위에 붙여 놓는다.
    const top = Math.max(L.handTop + 8, L.handBottom - blockHeight);
    const slots: Array<{ x: number; y: number }> = [];
    for (let row = 0; row < rows; row += 1) {
      const inRow = row === 0 ? perRow : count - perRow;
      const step = inRow > 1 ? Math.min(CARD.w + 3, (WIDTH - CARD.w) / (inRow - 1)) : 0;
      const span = CARD.w + step * (inRow - 1);
      const left = (GAME_WIDTH - span) / 2;
      for (let i = 0; i < inRow; i += 1) slots.push({ x: Math.round(left + i * step), y: Math.round(top + row * rowGap) });
    }
    return slots;
  }

  /** 손의 index번째 카드를 누를 자리(논리 좌표). 자동 점검이 쓴다. */
  handPoint(index: number): { x: number; y: number } | null {
    const state = this.state;
    if (!state) return null;
    const hand = state.players[0].hand;
    const slot = this.handSlots(hand.length)[index];
    if (!slot) return null;
    // 겹친 카드는 왼쪽 끝만 보이므로 왼쪽 위를 누른다.
    const raised = this.selected === hand[index].id ? 8 : 0;
    return { x: slot.x + 6, y: slot.y - raised + 12 };
  }

  private drawHand(state: GameState): void {
    const hand = state.players[0].hand;
    const slots = this.handSlots(hand.length);
    const myTurn = this.humanCanAct();
    hand.forEach((card, index) => {
      const slot = slots[index];
      const playable = myTurn && canPlay(state, card);
      const picked = this.selected === card.id;
      const y = slot.y - (picked ? 8 : 0);
      this.addCard(slot.x, y, card, false, { dim: myTurn && !playable, picked });
      const zone = this.add.zone(slot.x, y, CARD.w, CARD.h).setOrigin(0, 0).setInteractive({ useHandCursor: true });
      zone.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, () => this.tapCard(card));
    });
  }

  /**
   * 카드 한 장의 앞면을 그린다. 흰 바탕에 검은 테두리, 왼쪽 위에 숫자와 작은 무늬, 가운데에 큰 무늬.
   * 모서리 한 칸을 비워 픽셀 카드처럼 보이게 한다.
   */
  private addCard(x: number, y: number, card: Card, big: boolean, options: { dim?: boolean; picked?: boolean } = {}): Phaser.GameObjects.Container {
    const w = big ? CARD.bigW : CARD.w;
    const h = big ? CARD.bigH : CARD.h;
    const container = this.add.container(x, y);
    const g = this.add.graphics();
    const edge = options.picked ? PX.yellow : PX.ink;
    g.fillStyle(PX.ink, 0.6).fillRect(1, h, w - 1, 2);
    g.fillStyle(edge, 1).fillRect(1, 0, w - 2, h).fillRect(0, 1, w, h - 2);
    const inset = options.picked ? 2 : 1;
    g.fillStyle(PX.white, 1).fillRect(inset, inset, w - inset * 2, h - inset * 2);
    if (isJoker(card)) g.fillStyle(card.rank === 1 ? 0xffe9b0 : 0xd8dee6, 1).fillRect(inset + 2, inset + 2, w - inset * 2 - 4, h - inset * 2 - 4);
    container.add(g);
    const color = isRed(card) ? PX_CSS.bad : PX_CSS.dark;
    if (isJoker(card)) {
      container.add(addText(this, 4, 2, 'JK', { size: big ? 11 : 9, color: card.rank === 1 ? '#b13e53' : '#333c57' }));
      container.add(this.add.image(w / 2, h / 2 + 4, jokerTexture(card.rank)).setScale(big ? 1.3 : 1));
    } else {
      const rankText = addText(this, big ? 4 : 3, big ? 1 : 0, RANK_LABEL[card.rank], { size: big ? 14 : 11, color });
      container.add(rankText);
      container.add(this.add.image(big ? 8 : 6, big ? 24 : 19, suitTexture(card.suit!)).setOrigin(0.5, 0.5));
      container.add(this.add.image(w / 2 + (big ? 3 : 2), h / 2 + (big ? 8 : 6), suitTexture(card.suit!, true)).setScale(big ? 1.3 : 1));
    }
    if (options.dim) {
      const shade = this.add.graphics();
      shade.fillStyle(PX.ink, 0.5).fillRect(0, 0, w, h);
      container.add(shade);
    }
    return container;
  }

  /** 사람이 지금 카드를 내거나 받을 수 있는지 */
  private humanCanAct(): boolean {
    const state = this.state;
    if (this.friends.match && !this.friends.myTurn()) return false;
    return !!state && this.phase === 'play' && !this.busy && state.winner === null && state.turn === 0 && !state.choosingSuit && state.oneCard === null;
  }

  /** 사람 번호의 이름. 컴퓨터와 할 때는 "나"와 컴퓨터 이름, 친구와 할 때는 나(한 폰이면 1P, 2P)와 친구 */
  private who(index: number): string {
    if (!this.friends.match) return nameOf(index);
    return index === 0 ? this.friends.myName : this.friends.foeName;
  }

  private updateControls(): void {
    const state = this.state;
    if (!state) return;
    const canAct = this.humanCanAct();
    this.drawButton.setLabel(state.turn === 0 && state.attack > 0 ? TEXT.takeAttack(state.attack) : TEXT.draw);
    this.drawButton.setEnabled(canAct);
    const canCall = this.friends.match ? state.oneCard === 0 && this.friends.myTurn() : state.oneCard !== null;
    this.oneCardButton.setEnabled(canCall && this.phase === 'play');
    this.message.setText(state.oneCard !== null ? this.defaultMessage(state) : (this.notice ?? this.defaultMessage(state)));
  }

  private defaultMessage(state: GameState): string {
    if (this.friends.match) return this.friendMessage(state);
    if (state.winner !== null) return state.winner === 0 ? TEXT.win : TEXT.lose;
    if (state.oneCard !== null) return state.oneCard === 0 ? TEXT.callNow : TEXT.catchNow(nameOf(state.oneCard));
    if (state.choosingSuit) return state.turn === 0 ? TEXT.pickSuit : TEXT.thinking(nameOf(state.turn));
    if (state.turn !== 0) return TEXT.thinking(nameOf(state.turn));
    if (this.selected !== null) {
      const card = state.players[0].hand.find((item) => item.id === this.selected);
      if (card) {
        const effect = cardEffect(card, state.attack);
        return effect ? `${effect} · ${TEXT.tapAgain}` : TEXT.tapAgain;
      }
    }
    if (state.attack > 0) return TEXT.attacked(state.attack);
    return playableCards(state, 0).length > 0 ? TEXT.myTurn : TEXT.noCard;
  }

  /** 잠깐 보이는 알림. 시간이 지나면 차례 안내로 돌아간다. */
  private showNotice(line: string): void {
    this.notice = line;
    this.noticeTimer?.remove();
    this.noticeTimer = this.time.delayedCall(NOTICE_MS, () => {
      this.notice = null;
      this.noticeTimer = null;
      if (this.state && this.phase === 'play') this.updateControls();
    });
    this.updateControls();
  }

  /** 쌓인 일을 소리와 알림으로 보여 준다. */
  private handleEvents(events: readonly GameEvent[]): void {
    let line: string | null = null;
    for (const event of events) {
      line = eventLine(event, (who) => this.who(who)) ?? line;
      switch (event.k) {
        case 'play':
          if (event.card.suit === null || event.card.rank <= 2) sfx.whoosh();
          else sfx.flip();
          break;
        case 'block':
          sfx.bump();
          break;
        case 'call':
          sfx.gold();
          break;
        case 'caught':
          sfx.deny();
          break;
        case 'broke':
          sfx.miss();
          break;
        case 'draw':
          sfx.pull();
          break;
        default:
          break;
      }
    }
    if (line) this.showNotice(line);
  }

  // ───────── 차례 진행 ─────────

  /** 판이 바뀐 뒤에 부른다. 다시 그리고, 다음에 할 일(끝, 원카드, 컴퓨터 차례)을 건다. */
  private advance(): void {
    const state = this.state;
    if (!state || this.phase !== 'play') return;
    this.handleEvents(takeEvents(state));
    this.redraw();
    if (state.winner !== null) {
      this.endGame(state);
      return;
    }
    if (state.oneCard !== null) {
      this.openOneCardWindow(state.oneCard);
      return;
    }
    if (state.turn === 0) {
      // 이미 열려 있으면 다시 열지 않는다(두 겹으로 열리면 아래 창의 무늬를 누를 수 없다).
      if (state.choosingSuit && !this.suitOpen) this.openSuitPicker();
      return;
    }
    this.busy = true;
    this.updateControls();
    this.time.delayedCall(BOT_DELAY[this.prefs.level], () => this.botTurn());
  }

  private botTurn(): void {
    const state = this.state;
    if (!state || state.winner !== null || this.phase !== 'play') return;
    const who = state.turn;
    if (who === 0) {
      this.busy = false;
      this.advance();
      return;
    }
    if (state.choosingSuit) {
      chooseSuit(state, chooseSuitFor(state, who, this.prefs.level));
      this.busy = false;
      this.advance();
      return;
    }
    const move = chooseMove(state, who, this.prefs.level);
    const box = this.oppBox(who);
    if (move.k === 'play') {
      const card = state.players[who].hand.find((item) => item.id === move.cardId)!;
      this.flyCard(card, box.x + box.w / 2 - CARD.bigW / 2, box.y + 10, () => {
        playCard(state, who, move.cardId);
        this.busy = false;
        this.advance();
      });
    } else {
      const count = state.attack > 0 ? state.attack : 1;
      this.flyBacks(count, box.x + box.w / 2, box.y + box.h / 2, () => {
        drawTurn(state, who);
        this.busy = false;
        this.advance();
      });
    }
  }

  private tapCard(card: Card): void {
    const state = this.state;
    if (!state || !this.humanCanAct()) return;
    if (!canPlay(state, card)) {
      sfx.deny();
      this.selected = null;
      this.showNotice(TEXT.cannot);
      this.redraw();
      return;
    }
    if (this.selected !== card.id) {
      sfx.click();
      this.selected = card.id;
      this.notice = null;
      this.redraw();
      return;
    }
    // 두 번째 누르면 낸다.
    const slots = this.handSlots(state.players[0].hand.length);
    const index = state.players[0].hand.findIndex((item) => item.id === card.id);
    const from = slots[index];
    this.selected = null;
    this.busy = true;
    this.redrawWithout(card.id);
    this.flyCard(card, from.x, from.y - 8, () => {
      if (this.friends.match) {
        this.busy = false;
        this.sendMove({ type: 'play', card: card.id });
        return;
      }
      playCard(state, 0, card.id);
      this.busy = false;
      this.advance();
    });
  }

  /** 날아가는 카드가 손에 남아 보이지 않게, 그 카드를 빼고 그린다. */
  private redrawWithout(cardId: number): void {
    const state = this.state;
    if (!state) return;
    const hand = state.players[0].hand;
    const kept = hand.slice();
    state.players[0].hand = hand.filter((card) => card.id !== cardId);
    this.redraw();
    state.players[0].hand = kept;
  }

  private humanDraw(): void {
    const state = this.state;
    if (!state || !this.humanCanAct()) return;
    this.selected = null;
    this.busy = true;
    const count = state.attack > 0 ? state.attack : 1;
    this.flyBacks(count, GAME_WIDTH / 2, this.layout.handBottom - CARD.h / 2, () => {
      if (this.friends.match) {
        this.busy = false;
        this.sendMove({ type: 'draw' });
        return;
      }
      drawTurn(state, 0);
      this.busy = false;
      this.advance();
    });
  }

  /** 카드 한 장이 from에서 버린 더미로 날아간다. */
  private flyCard(card: Card, fromX: number, fromY: number, done: () => void): void {
    const L = this.layout;
    const flying = this.addCard(fromX, fromY, card, true).setDepth(40).setScale(0.8);
    this.tweens.add({
      targets: flying,
      x: L.discardX,
      y: L.pileTop,
      scale: 1,
      duration: FLY_MS,
      ease: 'Quad.easeOut',
      onComplete: () => {
        flying.destroy();
        done();
      },
    });
  }

  /** 뒷면 카드 몇 장이 뽑을 더미에서 (toX, toY)로 날아간다. */
  private flyBacks(count: number, toX: number, toY: number, done: () => void): void {
    const L = this.layout;
    const shown = Math.min(count, 5);
    for (let i = 0; i < shown; i += 1) {
      const back = this.add.image(L.deckX + CARD.bigW / 2, L.pileTop + CARD.bigH / 2, TEX.back).setDepth(40);
      this.tweens.add({
        targets: back,
        x: toX,
        y: toY,
        delay: i * 60,
        duration: FLY_MS,
        ease: 'Quad.easeIn',
        onComplete: () => back.destroy(),
      });
    }
    this.time.delayedCall(FLY_MS + (shown - 1) * 60 + 20, done);
  }

  // ───────── 원카드 ─────────

  /**
   * 카드가 한 장 남은 사람이 생겼다. 사람이면 컴퓨터가 잡기 전에 "원카드!"를 눌러야 하고,
   * 컴퓨터면 스스로 외치기 전에 사람이 누르면 잡는다. 그동안 차례는 멈춘다.
   */
  private openOneCardWindow(who: number): void {
    const state = this.state!;
    this.busy = true;
    this.updateControls();
    const level = this.prefs.level;
    const random = Math.random;
    const timers: Phaser.Time.TimerEvent[] = [];
    if (who === 0) {
      const catcher = state.players.findIndex((player, index) => index > 0 && !player.out);
      const delay = REACTION[level].catchMs + Math.round(random() * 300);
      timers.push(this.time.delayedCall(delay, () => this.resolveOneCard(() => catchOneCard(state, catcher))));
    } else {
      const self = selfCallDelay(level, random);
      if (self !== null) timers.push(this.time.delayedCall(self, () => this.resolveOneCard(() => callOneCard(state, who))));
      // 다른 컴퓨터도 잡으려고 한다.
      const other = state.players.findIndex((player, index) => index > 0 && index !== who && !player.out);
      if (other > 0) {
        const delay = REACTION[level].catchMs + 400 + Math.round(random() * 400);
        timers.push(this.time.delayedCall(delay, () => this.resolveOneCard(() => catchOneCard(state, other))));
      }
      timers.push(this.time.delayedCall(CATCH_WINDOW, () => this.resolveOneCard(() => closeOneCard(state))));
    }
    this.oneCardTimers = timers;
  }

  private resolveOneCard(apply: () => void): void {
    const state = this.state;
    if (!state || state.oneCard === null) return;
    for (const timer of this.oneCardTimers) timer.remove();
    this.oneCardTimers = [];
    apply();
    this.busy = false;
    this.advance();
  }

  private humanCall(): void {
    const state = this.state;
    if (!state || state.oneCard === null || this.phase !== 'play') return;
    if (this.friends.match) {
      if (state.oneCard !== 0 || !this.friends.myTurn()) return;
      this.stopCallTimer();
      this.sendMove({ type: 'call' });
      return;
    }
    const who = state.oneCard;
    this.resolveOneCard(() => (who === 0 ? callOneCard(state, 0) : catchOneCard(state, 0)));
  }

  // ───────── 무늬 고르기 ─────────

  private openSuitPicker(): void {
    const state = this.state!;
    this.suitOpen = true;
    const { height } = this.scale;
    const top = Math.round(height / 2 - 70);
    const before = this.children.list.length;
    this.add.rectangle(0, 0, GAME_WIDTH, height, PX.ink, 0.7).setOrigin(0, 0).setInteractive();
    pxPanel(this.add.graphics(), MARGIN + 12, top, WIDTH - 24, 132, { border: PX.yellow, radius: 4 });
    addText(this, GAME_WIDTH / 2, top + 16, TEXT.pickSuit, { size: 13, color: PX_CSS.accent, originX: 0.5, originY: 0.5 });
    const size = 44;
    const gap = 6;
    const left = (GAME_WIDTH - (size * 4 + gap * 3)) / 2;
    const counts = SUITS.map((suit) => state.players[0].hand.filter((card) => card.suit === suit).length);
    SUITS.forEach((suit: Suit, index) => {
      const x = left + index * (size + gap);
      const y = top + 34;
      const g = this.add.graphics();
      const draw = (pressed: boolean): void => {
        g.clear();
        const offset = pressed ? 1 : 0;
        g.fillStyle(PX.ink, 1).fillRect(x, y + offset, size, size + 4);
        g.fillStyle(PX.white, 1).fillRect(x + 1, y + 1 + offset, size - 2, size + 2);
      };
      draw(false);
      this.add.image(x + size / 2, y + size / 2 - 2, suitTexture(suit, true)).setScale(1.6);
      addText(this, x + size / 2, y + size + 12, SUIT_NAME[suit], { size: 9, color: PX_CSS.text, originX: 0.5, originY: 0.5 });
      addText(this, x + size / 2, y + size + 26, TEXT.cards(counts[index]), { size: 9, color: PX_CSS.faint, originX: 0.5, originY: 0.5 });
      addTapZone(this, x, y, size, size + 4, draw, () => {
        sfx.click();
        for (const object of this.overlay) object.destroy();
        this.overlay = [];
        this.suitOpen = false;
        if (this.friends.match) {
          this.sendMove({ type: 'suit', suit });
          return;
        }
        chooseSuit(state, suit);
        this.advance();
      });
    });
    this.overlay = this.children.list.slice(before);
    for (const object of this.overlay) (object as unknown as Phaser.GameObjects.Components.Depth).setDepth?.(50);
  }

  // ───────── 끝 ─────────

  private endGame(state: GameState): void {
    this.phase = 'over';
    this.busy = true;
    this.updateControls();
    const won = state.winner === 0;
    this.prefs = { ...this.prefs, plays: this.prefs.plays + 1, wins: this.prefs.wins + (won ? 1 : 0) };
    savePrefs(this.prefs);
    if (won) sfx.fanfare();
    const { height } = this.scale;
    const banner = this.add.graphics().setDepth(45);
    const y = Math.round(height / 2 - 30);
    pxPanel(banner, MARGIN + 20, y, WIDTH - 40, 50, { border: won ? PX.yellow : PX.red, radius: 4 });
    const sub = state.players[0].out ? TEXT.youBroke : won ? '' : TEXT.winnerLine(nameOf(state.winner!));
    addText(this, GAME_WIDTH / 2, sub ? y + 18 : y + 25, won ? TEXT.win : TEXT.lose, { size: 18, color: won ? PX_CSS.accent : PX_CSS.bad, originX: 0.5, originY: 0.5 }).setDepth(46);
    if (sub) addText(this, GAME_WIDTH / 2, y + 38, sub, { size: 10, color: PX_CSS.sub, originX: 0.5, originY: 0.5 }).setDepth(46);
    const stats: ResultStat[] = [
      [TEXT.resultWinner, nameOf(state.winner!)],
      [TEXT.resultLevel, LEVEL_NAME[this.prefs.level]],
      [TEXT.resultBots, TEXT.botCount[state.players.length - 2]],
    ];
    if (!won && !state.players[0].out) stats.push([TEXT.resultLeft, TEXT.cards(state.players[0].hand.length)]);
    this.finishMiniGame(matchScore(state, this.prefs.level), stats, 1500);
  }

  protected override retryData(): object {
    return { quick: true } satisfies OneCardStart;
  }

  override onBackRequest(): void {
    if (this.friends.back()) return;
    if (this.phase === 'lobby') fadeToScene(this, homeScene());
    else this.pauseGame();
  }

  protected override pauseGame(): void {
    if (this.phase !== 'play') return;
    super.pauseGame();
  }

  protected override restartLabel(): string | null {
    return this.friends.restartLabel();
  }

  protected override quitWarning(): string | null {
    return this.friends.quitWarning();
  }

  // ───────── 친구와 하기 ─────────

  /** 친구와 하는 방이 바뀌었다. 판을 다시 그리고, 새로 일어난 일을 알린다. */
  private onRoom(room: RoomView<OneCardView>, fresh: boolean): void {
    const view = room.game;
    if (!view) return;
    if (!this.frameBuilt) {
      this.frameBuilt = true;
      this.phase = 'play';
      this.playing = true;
      this.layout = this.computeLayout();
      this.drawFrame();
    }
    if (fresh) {
      this.phase = 'play';
      this.selected = null;
      this.notice = null;
      this.seenMoves = -1;
      this.stopCallTimer();
      this.closeSuitPicker();
    }
    this.subLabel?.setText(this.friends.scoreLine());
    this.state = view.game;
    if (view.moves !== this.seenMoves) {
      this.seenMoves = view.moves;
      this.selected = null;
      // 내가 한 일은 이미 보았으니 소리만, 상대가 한 일은 알림 줄에도 적는다.
      const lines = view.events.map((event) => eventLine(event, (who) => this.who(who))).filter((line): line is string => !!line);
      this.lastLine = lines[lines.length - 1] ?? this.lastPlayLine(view);
      if (view.events.length > 0) this.handleEvents(view.events);
    }
    if (room.status === 'over') {
      this.phase = 'over';
      this.stopCallTimer();
      this.closeSuitPicker();
    }
    this.redraw();
    if (room.status !== 'playing' || this.friends.covered) return;
    const game = view.game;
    if (game.oneCard === 0 && this.friends.myTurn()) this.startCallTimer(view.moves);
    else this.stopCallTimer();
    if (game.choosingSuit && game.turn === 0 && game.oneCard === null && this.friends.myTurn() && !this.suitOpen) this.openSuitPicker();
  }

  /** 상대가 낸 카드를 한 줄로(알릴 일이 따로 없을 때) */
  private lastPlayLine(view: OneCardView): string | null {
    const play = [...view.events].reverse().find((event) => event.k === 'play');
    if (!play || play.k !== 'play') return null;
    return `${withSubject(this.who(play.who))} ${cardLabel(play.card)} 냈어요`;
  }

  private friendMessage(state: GameState): string {
    if (state.winner !== null) return state.winner === 0 ? TEXT.win : TEXT.lose;
    const me = this.friends.kind === 'local' ? this.friends.myName : TEXT.me;
    const foe = this.friends.foeName;
    if (state.oneCard === 0) {
      const left = this.callTimer ? Math.max(1, Math.ceil(this.callTimer.getRemaining() / 1000)) : Math.ceil(CALL_WINDOW_MS / 1000);
      return FRIEND_TEXT.callNow(left);
    }
    if (state.oneCard === 1) return FRIEND_TEXT.foeCalling(withSubject(foe));
    if (state.choosingSuit) return state.turn === 0 ? TEXT.pickSuit : FRIEND_TEXT.pickSuit(withSubject(foe));
    if (state.turn !== 0) return FRIEND_TEXT.waiting(foe);
    if (this.selected !== null) {
      const card = state.players[0].hand.find((item) => item.id === this.selected);
      if (card) {
        const effect = cardEffect(card, state.attack);
        return effect ? `${effect} · ${TEXT.tapAgain}` : TEXT.tapAgain;
      }
    }
    if (state.attack > 0) return TEXT.attacked(state.attack);
    return playableCards(state, 0).length > 0 ? FRIEND_TEXT.myTurn(me) : TEXT.noCard;
  }

  private sendMove(move: OneCardMove): void {
    this.busy = true;
    void this.friends.send(move).then((ok) => {
      this.busy = false;
      if (!ok && this.state) this.redraw();
    });
  }

  /** 한 장 남았을 때 원카드를 외칠 시간을 잰다. 시간이 지나면 놓친 것으로 보내 한 장 받는다. */
  private startCallTimer(moves: number): void {
    if (this.callFor === moves && this.callTimer) return;
    this.stopCallTimer();
    this.callFor = moves;
    sfx.gold();
    const tick = this.time.addEvent({ delay: 250, loop: true, callback: () => this.updateControls() });
    this.callTimer = this.time.delayedCall(CALL_WINDOW_MS, () => {
      tick.remove();
      this.callTimer = null;
      if (this.state?.oneCard !== 0 || !this.friends.myTurn()) return;
      this.showNotice(FRIEND_TEXT.missed);
      this.sendMove({ type: 'miss' });
    });
    this.oneCardTimers = [tick];
  }

  private stopCallTimer(): void {
    this.callTimer?.remove();
    this.callTimer = null;
    for (const timer of this.oneCardTimers) timer.remove();
    this.oneCardTimers = [];
  }

  private closeSuitPicker(): void {
    for (const object of this.overlay) object.destroy();
    this.overlay = [];
    this.suitOpen = false;
  }

  private friendsClosed(): void {
    this.phase = 'over';
    this.stopCallTimer();
    this.closeSuitPicker();
    if (this.state) this.redraw();
  }

  /** 친구와의 판이 끝났을 때 결과 판에 적을 것 */
  private friendResult(room: RoomView<OneCardView>): FriendsResult & { won: boolean | null } {
    const game = room.game!.game;
    const winnerIndex = game.winner ?? 0;
    const won = winnerIndex === 0;
    const local = this.friends.kind === 'local';
    const winnerSeat: Seat = (winnerIndex === 0 ? room.seat : room.seat === 0 ? 1 : 0) as Seat;
    const winnerName = room.names[winnerSeat] ?? '';
    const loserIndex = winnerIndex === 0 ? 1 : 0;
    const loser = game.players[loserIndex];
    const title = local ? FRIEND_TEXT.winBy(withSubject(winnerName)) : won ? TEXT.win : TEXT.lose;
    const how = loser.out ? FRIEND_TEXT.brokeLine(withSubject(this.who(loserIndex))) : FRIEND_TEXT.emptyLine(withSubject(this.who(winnerIndex)));
    const lines = [how];
    if (!loser.out) lines.push(FRIEND_TEXT.left(this.who(0), game.players[0].hand.length, this.who(1), game.players[1].hand.length));
    return { title, lines, bright: local || won, lost: !local && !won, won };
  }
}
