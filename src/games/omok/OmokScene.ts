import Phaser from 'phaser';
import { GAME_WIDTH } from '../../config';
import { homeScene } from '../../core/home';
import { sfx } from '../../core/sfx';
import { addTapZone, addText, fadeToScene, PixelButton } from '../../core/ui';
import { MiniGameScene, type ResultStat } from '../../scenes/MiniGameScene';
import { FriendsKit, type FriendsResult, type FriendsStart } from '../../versus/friends-kit';
import { otherSeat, type RoomView, type Seat } from '../../versus/protocol';
import { shortName, withSubject } from '../../versus/text';
import { PX, PX_CSS } from '../cloud-tower/art';
import { drawSky, pxPanel } from '../cloud-tower/bits';
import { chooseMove } from './bot';
import { loadPrefs, playsBlack, savePrefs, type OmokPrefs } from './prefs';
import {
  BLACK,
  createGame,
  isOver,
  LEVELS,
  matchScore,
  other,
  placeStone,
  pointAt,
  replay,
  SIZE,
  toMove,
  undoMoves,
  UNDO_LIMIT,
  WHITE,
  xOf,
  yOf,
  type OmokState,
  type Stone,
} from './rules';
import { COLOR_CHOICES, COLOR_NAME, FRIEND_TEXT, LEVEL_NAME, LEVEL_NOTE, OMOK_GAME_ID, OMOK_SCENE, RULE_LINES, TEXT } from './text';
import { omokVersus, readOmokView, type OmokMove, type OmokView } from './versus';

/** 씬을 열 때 넘기는 값. quick이면 준비 화면을 건너뛰고 지난 설정으로 바로 시작한다("다시 하기"). */
export interface OmokStart extends FriendsStart {
  quick?: boolean;
}

type Phase = 'lobby' | 'play' | 'over';

const MARGIN = 8;
const WIDTH = GAME_WIDTH - MARGIN * 2;
/** 판의 줄 사이 간격과, 판 테두리에서 첫 줄까지의 여백 */
const GAP = 14;
const PAD = 14;
const BOARD = GAP * (SIZE - 1) + PAD * 2;
const STONE_R = 6;
/** 컴퓨터가 한 수를 두기까지 기다리는 시간(ms) */
const BOT_DELAY = 420;
const NOTICE_MS = 1600;
/** 화점: 판 위에 작은 점을 찍는 자리 */
const STAR_POINTS = [pointAt(3, 3), pointAt(11, 3), pointAt(7, 7), pointAt(3, 11), pointAt(11, 11)];

const WOOD = { fill: 0xe8b86d, deep: 0xc98f45, line: 0x6b4423 } as const;

interface Layout {
  stripTop: number;
  boardTop: number;
  messageTop: number;
  buttonTop: number;
}

/**
 * 오목: 15 × 15 판에서 다섯 개를 먼저 잇는 게임. 컴퓨터와 하거나(실력 셋), 친구와 한다(방 코드, 한 폰으로).
 * 규칙은 rules.ts, 컴퓨터의 판단은 bot.ts, 친구와 하는 판은 versus.ts가 맡고, 이 씬은 그리기와 차례 진행을 맡는다.
 * 점이 작아서 잘못 누르기 쉬우므로, 점을 누르면 흐린 돌을 미리 보여 주고 한 번 더 누르거나 "여기에 두기"를 눌러야 놓는다.
 */
export class OmokScene extends MiniGameScene {
  protected readonly gameId = OMOK_GAME_ID;

  private phase: Phase = 'lobby';
  private prefs: OmokPrefs = loadPrefs();
  /** 하고 있는 판. 자동 점검이 들여다본다. */
  state: OmokState | null = null;
  /** 이 화면을 보는 사람의 돌 */
  mine: Stone = BLACK;
  /** 미리 보여 주는 점. 자동 점검이 들여다본다. */
  cursor: number | null = null;
  private undos = 0;
  private layout!: Layout;
  private stones!: Phaser.GameObjects.Graphics;
  private strip: Phaser.GameObjects.GameObject[] = [];
  private message!: Phaser.GameObjects.Text;
  private placeButton!: PixelButton;
  private undoButton: PixelButton | null = null;
  private subLabel: Phaser.GameObjects.Text | null = null;
  /** 컴퓨터 차례이거나 보내는 중이라 사람이 누를 수 없을 때 true */
  private busy = false;
  private notice: string | null = null;
  private noticeTimer: Phaser.Time.TimerEvent | null = null;

  // ───────── 친구와 하기 ─────────
  /** 친구와 하기 화면. 자동 점검이 들여다본다. */
  friends!: FriendsKit<OmokView, OmokMove>;
  private frameBuilt = false;
  private seenMoves = -1;

  constructor() {
    super(OMOK_SCENE);
  }

  create(data: OmokStart = {}): void {
    this.sys.settings.data = {};
    this.beginMiniGame();
    this.prefs = loadPrefs();
    this.state = null;
    this.mine = BLACK;
    this.cursor = null;
    this.undos = 0;
    this.strip = [];
    this.undoButton = null;
    this.subLabel = null;
    this.busy = false;
    this.notice = null;
    this.noticeTimer = null;
    this.frameBuilt = false;
    this.seenMoves = -1;
    drawSky(this, 2);
    this.friends = new FriendsKit<OmokView, OmokMove>(this, {
      game: 'omok',
      title: TEXT.title,
      rules: omokVersus,
      readView: readOmokView,
      isMyTurn: (room) => {
        const view = room.game;
        if (!view) return false;
        const state = replay(view.moves);
        return !!state && !isOver(state) && toMove(state) === view.mine;
      },
      // 오목은 상대가 몰라야 할 것이 없어서, 한 폰으로 할 때도 판을 가리지 않고 바로 다음 사람이 둔다.
      cover: false,
      // 알림 줄 바로 위. 판 머리의 이름 줄과 판을 가리지 않는다.
      awayTop: () => (this.layout ?? this.computeLayout()).messageTop - 2,
      onRoom: (room, fresh) => this.onRoom(room, fresh),
      result: (room) => this.friendResult(room),
      onClosed: () => this.friendsClosed(),
      say: (text) => this.showNotice(text),
      restart: (start) => this.scene.restart(start satisfies OmokStart),
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
    const rulesX = GAME_WIDTH - MARGIN - 44;
    new PixelButton(this, { x: rulesX, y: 8, width: 44, height: 26, label: TEXT.ruleBook, style: 'yellow', hitPadding: 4, onTap: () => this.openRuleBook() });
    addText(this, rulesX - 6, 21, record, { size: 10, color: PX_CSS.sub, originX: 1, originY: 0.5 });
    this.offerRuleBook(() => this.phase === 'lobby');
    redraw();
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

  private drawLobby(redraw: () => void): void {
    const { height } = this.scale;
    pxPanel(this.add.graphics(), MARGIN, 40, WIDTH, 34, { depth: 2, radius: 6 });
    addText(this, GAME_WIDTH / 2, 57, TEXT.intro, { size: 10, color: PX_CSS.sub, originX: 0.5, originY: 0.5, align: 'center', lineSpacing: 1 });

    addText(this, MARGIN + 2, 84, TEXT.level, { size: 11, color: PX_CSS.text });
    const third = (WIDTH - 8) / 3;
    LEVELS.forEach((level, index) => {
      this.toggle(MARGIN + index * (third + 4), 100, third, 28, LEVEL_NAME[level], this.prefs.level === level, () => {
        this.prefs = { ...this.prefs, level };
        savePrefs(this.prefs);
        redraw();
      });
    });
    addText(this, GAME_WIDTH / 2, 140, LEVEL_NOTE[this.prefs.level], { size: 10, color: PX_CSS.faint, originX: 0.5, originY: 0.5 });

    addText(this, MARGIN + 2, 154, TEXT.color, { size: 11, color: PX_CSS.text });
    COLOR_CHOICES.forEach((color, index) => {
      this.toggle(MARGIN + index * (third + 4), 170, third, 26, COLOR_NAME[color], this.prefs.color === color, () => {
        this.prefs = { ...this.prefs, color };
        savePrefs(this.prefs);
        redraw();
      });
    });

    // 규칙 칸: 왼쪽에 작은 그림(다섯 개를 이은 줄), 오른쪽에 규칙 몇 줄
    const top = 206;
    const bottom = height - 8 - 36 - 8;
    pxPanel(this.add.graphics(), MARGIN, top, WIDTH, bottom - top, { depth: 2, radius: 6, fill: PX.navy });
    addText(this, MARGIN + 8, top + 6, TEXT.rules, { size: 11, color: PX_CSS.accent });
    const rows = Math.max(1, Math.min(RULE_LINES.length, Math.floor((bottom - top - 30) / 16)));
    const rowHeight = Math.min(20, (bottom - top - 26) / rows);
    const g = this.add.graphics();
    RULE_LINES.slice(0, rows).forEach((line, index) => {
      const y = top + 24 + index * rowHeight + 7;
      this.drawStone(g, MARGIN + 16, y, index % 2 === 0 ? BLACK : WHITE, 4);
      addText(this, MARGIN + 26, y, line, { size: 10, color: PX_CSS.text, originY: 0.5 });
    });
  }

  private toggle(x: number, y: number, width: number, height: number, label: string, on: boolean, onTap: () => void): void {
    const panel = this.add.graphics();
    const draw = (pressed: boolean): void => {
      panel.clear();
      pxPanel(panel, x, y + (pressed ? 1 : 0), width, height, { depth: 2, radius: 4, fill: on ? PX.panelHi : PX.panel, border: on ? PX.yellow : undefined });
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
    this.children.removeAll(true);
    drawSky(this, 2);
    this.phase = 'play';
    this.playing = true;
    this.state = createGame();
    this.mine = playsBlack(this.prefs) ? BLACK : WHITE;
    this.cursor = null;
    this.undos = 0;
    this.layout = this.computeLayout();
    this.drawFrame();
    this.advance();
  }

  private computeLayout(): Layout {
    const { height } = this.scale;
    const extra = Math.max(0, height - 400);
    const stripTop = 38 + Math.round(extra * 0.25);
    const boardTop = stripTop + 30 + Math.round(extra * 0.15);
    const messageTop = boardTop + BOARD + 6;
    return { stripTop, boardTop, messageTop, buttonTop: height - 8 - 34 };
  }

  /** 점의 화면 자리 */
  private spot(point: number): { x: number; y: number } {
    return { x: MARGIN + PAD + xOf(point) * GAP, y: this.layout.boardTop + PAD + yOf(point) * GAP };
  }

  /** 점을 누를 자리(논리 좌표). 자동 점검이 쓴다. */
  pointPosition(point: number): { x: number; y: number } {
    return this.spot(point);
  }

  /** 판 동안 바뀌지 않는 것: 위쪽 줄, 판, 알림 줄, 버튼 */
  private drawFrame(): void {
    const L = this.layout;
    this.addPauseButton();
    addText(this, 40, 14, TEXT.title, { size: 14, color: PX_CSS.text, originY: 0.5 });
    const sub = this.friends.match ? this.friends.scoreLine() : `${LEVEL_NAME[this.prefs.level]} · ${this.mine === BLACK ? '흑' : '백'}으로 둬요`;
    this.subLabel = addText(this, 40, 29, sub, { size: 9, color: PX_CSS.sub, originY: 0.5 });

    // 나무 판과 줄
    const board = this.add.graphics();
    board.fillStyle(PX.ink, 1).fillRect(MARGIN + 1, L.boardTop + 2, BOARD, BOARD);
    board.fillStyle(WOOD.deep, 1).fillRect(MARGIN, L.boardTop, BOARD, BOARD);
    board.fillStyle(WOOD.fill, 1).fillRect(MARGIN + 1, L.boardTop + 1, BOARD - 2, BOARD - 3);
    board.fillStyle(WOOD.line, 1);
    const left = MARGIN + PAD;
    const top = L.boardTop + PAD;
    const span = GAP * (SIZE - 1);
    for (let i = 0; i < SIZE; i += 1) {
      board.fillRect(left, top + i * GAP, span + 1, 1);
      board.fillRect(left + i * GAP, top, 1, span + 1);
    }
    for (const point of STAR_POINTS) {
      const { x, y } = this.spot(point);
      board.fillRect(x - 1, y - 1, 3, 3);
    }
    this.stones = this.add.graphics();

    // 판을 누르는 자리: 가장 가까운 점을 고른다.
    const zone = this.add.zone(MARGIN, L.boardTop, BOARD, BOARD).setOrigin(0, 0).setInteractive({ useHandCursor: true });
    zone.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, (pointer: Phaser.Input.Pointer) => {
      const x = Math.round((pointer.worldX - left) / GAP);
      const y = Math.round((pointer.worldY - top) / GAP);
      if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
      this.tapPoint(pointAt(x, y));
    });

    const panel = this.add.graphics();
    pxPanel(panel, MARGIN, L.messageTop, WIDTH, 22, { fill: PX.navy, shadow: null, radius: 4 });
    this.message = addText(this, GAME_WIDTH / 2, L.messageTop + 11, '', { size: 10, color: PX_CSS.text, originX: 0.5, originY: 0.5 });

    const vsBot = !this.friends.match;
    const undoWidth = vsBot ? 78 : 0;
    if (vsBot) {
      this.undoButton = new PixelButton(this, {
        x: MARGIN,
        y: L.buttonTop,
        width: undoWidth,
        height: 34,
        label: TEXT.undo(UNDO_LIMIT),
        onTap: () => this.undo(),
      });
    }
    this.placeButton = new PixelButton(this, {
      x: MARGIN + (vsBot ? undoWidth + 6 : 0),
      y: L.buttonTop,
      width: WIDTH - (vsBot ? undoWidth + 6 : 0),
      height: 34,
      label: TEXT.place,
      style: 'green',
      onTap: () => {
        if (this.cursor !== null) this.commit(this.cursor);
      },
    });
  }

  /** 판 머리 아래의 두 사람 줄: 흑과 백, 지금 둘 차례인 쪽을 밝게 */
  private drawStrip(): void {
    for (const object of this.strip) object.destroy();
    this.strip = [];
    const state = this.state;
    if (!state) return;
    const before = this.children.list.length;
    const L = this.layout;
    const half = (WIDTH - 6) / 2;
    const turn = isOver(state) ? null : toMove(state);
    ([BLACK, WHITE] as const).forEach((stone, index) => {
      const x = MARGIN + index * (half + 6);
      const lit = turn === stone;
      const won = state.winner === stone;
      pxPanel(this.add.graphics(), x, L.stripTop, half, 24, {
        depth: 2,
        radius: 4,
        fill: lit || won ? PX.panelHi : PX.panel,
        border: lit || won ? PX.yellow : undefined,
      });
      this.drawStone(this.add.graphics(), x + 13, L.stripTop + 12, stone, 6);
      const name = shortName(this.nameOfStone(stone), 7);
      addText(this, x + 24, L.stripTop + 12, name, { size: 11, color: lit || won ? PX_CSS.accent : PX_CSS.text, originY: 0.5 });
    });
    this.strip.push(...this.children.list.slice(before));
  }

  /** 그 돌을 쥔 사람의 이름 */
  private nameOfStone(stone: Stone): string {
    if (!this.friends.match) return stone === this.mine ? TEXT.me : TEXT.bot;
    const room = this.friends.room;
    if (!room) return '';
    const seat: Seat = stone === this.mine ? room.seat : otherSeat(room.seat);
    return this.friends.nameOf(seat);
  }

  /** 돌 하나. 검은 돌은 위쪽에 작은 빛을, 흰 돌은 아래쪽에 그림자를 넣는다. */
  private drawStone(g: Phaser.GameObjects.Graphics, x: number, y: number, stone: Stone, r: number, alpha = 1): void {
    g.fillStyle(PX.ink, 0.35 * alpha).fillCircle(x + 1, y + 1.5, r);
    if (stone === BLACK) {
      g.fillStyle(0x1a1c2c, alpha).fillCircle(x, y, r);
      g.fillStyle(0x566c86, alpha).fillCircle(x - r * 0.35, y - r * 0.35, Math.max(1, r * 0.3));
    } else {
      g.fillStyle(0x94b0c2, alpha).fillCircle(x, y, r);
      g.fillStyle(0xf4f4f4, alpha).fillCircle(x - 0.4, y - 0.6, r - 1);
    }
  }

  /** 판 위의 돌, 마지막 수, 이긴 줄, 미리 보는 돌을 다시 그린다. */
  private redraw(): void {
    const state = this.state;
    if (!state) return;
    const g = this.stones.clear();
    state.moves.forEach((point, index) => {
      const { x, y } = this.spot(point);
      this.drawStone(g, x, y, index % 2 === 0 ? BLACK : WHITE, STONE_R);
    });
    const last = state.moves[state.moves.length - 1];
    if (last !== undefined) {
      const { x, y } = this.spot(last);
      g.fillStyle(PX.red, 1).fillRect(x - 1.5, y - 1.5, 3, 3);
    }
    for (const point of state.line) {
      const { x, y } = this.spot(point);
      g.lineStyle(2, PX.yellow, 1).strokeCircle(x, y, STONE_R + 1);
    }
    if (this.cursor !== null && state.board[this.cursor] === 0 && this.humanCanAct()) {
      const { x, y } = this.spot(this.cursor);
      this.drawStone(g, x, y, this.mine, STONE_R, 0.55);
      // 고른 점을 네 귀퉁이 꺾쇠로 둘러 눈에 띄게 한다.
      const s = STONE_R + 3;
      g.fillStyle(PX.yellow, 1);
      for (const [sx, sy] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ] as const) {
        const cx = x + sx * s;
        const cy = y + sy * s;
        g.fillRect(sx < 0 ? cx : cx - 3, cy - (sy < 0 ? 0 : 1), 4, 1);
        g.fillRect(cx - (sx < 0 ? 0 : 1), sy < 0 ? cy : cy - 3, 1, 4);
      }
    }
    this.drawStrip();
    this.updateControls();
  }

  /** 사람이 지금 돌을 놓을 수 있는지 */
  private humanCanAct(): boolean {
    const state = this.state;
    if (!state || this.phase !== 'play' || this.busy || isOver(state)) return false;
    if (this.friends.match) return this.friends.myTurn();
    return toMove(state) === this.mine;
  }

  private updateControls(): void {
    const state = this.state;
    if (!state) return;
    const canAct = this.humanCanAct();
    this.placeButton.setEnabled(canAct && this.cursor !== null);
    if (this.undoButton) {
      const left = UNDO_LIMIT - this.undos;
      this.undoButton.setLabel(TEXT.undo(left));
      // 내 돌이 하나라도 놓였고, 내 차례일 때만 무를 수 있다.
      const myStones = state.moves.filter((_, index) => (index % 2 === 0 ? BLACK : WHITE) === this.mine).length;
      this.undoButton.setEnabled(canAct && left > 0 && myStones > 0);
    }
    this.message.setText(this.notice ?? this.defaultMessage(state));
  }

  private defaultMessage(state: OmokState): string {
    if (state.winner !== null) {
      if (this.friends.match && this.friends.kind === 'local') return FRIEND_TEXT.winBy(withSubject(this.nameOfStone(state.winner)));
      return state.winner === this.mine ? TEXT.win : TEXT.lose;
    }
    if (state.draw) return TEXT.draw;
    if (this.friends.match) {
      if (!this.friends.myTurn()) return FRIEND_TEXT.waiting(this.friends.foeName);
      if (this.cursor !== null) return TEXT.tapAgain;
      return this.friends.kind === 'local' ? FRIEND_TEXT.myTurn(this.friends.myName) : TEXT.myTurn;
    }
    if (toMove(state) !== this.mine) return TEXT.thinking;
    return this.cursor !== null ? TEXT.tapAgain : TEXT.myTurn;
  }

  private showNotice(line: string): void {
    this.notice = line;
    this.noticeTimer?.remove();
    this.noticeTimer = this.time.delayedCall(NOTICE_MS, () => {
      this.notice = null;
      this.noticeTimer = null;
      if (this.state) this.updateControls();
    });
    if (this.state) this.updateControls();
  }

  /** 점을 눌렀다: 처음 누르면 미리 보이고, 같은 점을 다시 누르면 놓는다. */
  private tapPoint(point: number): void {
    const state = this.state;
    if (!state || !this.humanCanAct()) return;
    if (state.board[point] !== 0) {
      sfx.deny();
      this.showNotice(TEXT.taken);
      return;
    }
    if (this.cursor === point) {
      this.commit(point);
      return;
    }
    sfx.click();
    this.cursor = point;
    this.notice = null;
    this.redraw();
  }

  /** 내 돌을 놓는다. */
  private commit(point: number): void {
    const state = this.state;
    if (!state || !this.humanCanAct() || state.board[point] !== 0) return;
    this.cursor = null;
    if (this.friends.match) {
      this.busy = true;
      // 서버의 답을 기다리는 동안에도 놓은 자리가 보이게 먼저 그려 둔다.
      placeStone(state, point);
      sfx.pop();
      this.redraw();
      void this.friends.send({ type: 'place', at: point }).then((ok) => {
        this.busy = false;
        if (!ok) {
          const room = this.friends.room;
          if (room) this.onRoom(room, false);
        }
      });
      return;
    }
    placeStone(state, point);
    sfx.pop();
    this.advance();
  }

  /** 컴퓨터와 하는 판이 바뀐 뒤에 부른다. 다시 그리고, 끝났는지와 컴퓨터 차례를 본다. */
  private advance(): void {
    const state = this.state;
    if (!state || this.phase !== 'play') return;
    this.redraw();
    if (isOver(state)) {
      this.endGame(state);
      return;
    }
    if (toMove(state) === this.mine) return;
    this.busy = true;
    this.updateControls();
    this.time.delayedCall(BOT_DELAY, () => this.botTurn());
  }

  private botTurn(): void {
    const state = this.state;
    if (!state || isOver(state) || this.phase !== 'play') return;
    const point = chooseMove(state.board, other(this.mine), this.prefs.level);
    placeStone(state, point);
    sfx.flip();
    this.busy = false;
    this.advance();
  }

  /** 무르기: 컴퓨터의 마지막 수와 내 마지막 수를 되돌린다. */
  private undo(): void {
    const state = this.state;
    if (!state || !this.humanCanAct() || this.undos >= UNDO_LIMIT) return;
    // 내 차례이므로 마지막 수는 컴퓨터의 것이다. 내가 흑이고 컴퓨터가 아직 안 뒀으면(첫 수 뒤) 한 수만 무른다.
    const count = state.moves.length >= 2 ? 2 : 1;
    undoMoves(state, count);
    this.undos += 1;
    this.cursor = null;
    sfx.whoosh();
    this.showNotice(TEXT.undone);
    this.advance();
  }

  private endGame(state: OmokState): void {
    this.phase = 'over';
    this.busy = true;
    this.cursor = null;
    this.redraw();
    const result = state.winner === null ? 'draw' : state.winner === this.mine ? 'win' : 'lose';
    const won = result === 'win';
    const black = this.mine === BLACK;
    this.prefs = { ...this.prefs, plays: this.prefs.plays + 1, wins: this.prefs.wins + (won ? 1 : 0), lastBlack: black };
    savePrefs(this.prefs);
    if (won) sfx.fanfare();
    // 알림 판이 이긴 줄을 가리지 않게, 줄이 판의 위쪽에 있으면 아래쪽에, 아니면 위쪽에 띄운다.
    const lineRow = state.line.length > 0 ? state.line.reduce((sum, point) => sum + yOf(point), 0) / state.line.length : SIZE;
    const y = Math.round(lineRow < SIZE / 2 ? this.layout.boardTop + BOARD - 50 - 8 : this.layout.boardTop + 8);
    const banner = this.add.graphics().setDepth(45);
    pxPanel(banner, MARGIN + 20, y, WIDTH - 40, 50, { border: won ? PX.yellow : result === 'draw' ? PX.sky : PX.red, radius: 4 });
    const title = result === 'win' ? TEXT.win : result === 'draw' ? TEXT.draw : TEXT.lose;
    const sub = result === 'draw' ? TEXT.fullBoard : TEXT.fiveLine(withSubject(this.nameOfStone(state.winner!)));
    addText(this, GAME_WIDTH / 2, y + 18, title, { size: 18, color: won ? PX_CSS.accent : result === 'draw' ? PX_CSS.sky : PX_CSS.bad, originX: 0.5, originY: 0.5 }).setDepth(46);
    addText(this, GAME_WIDTH / 2, y + 38, sub, { size: 10, color: PX_CSS.sub, originX: 0.5, originY: 0.5 }).setDepth(46);
    const myStones = state.moves.filter((_, index) => (index % 2 === 0 ? BLACK : WHITE) === this.mine).length;
    const stats: ResultStat[] = [
      [TEXT.resultLevel, LEVEL_NAME[this.prefs.level]],
      [TEXT.resultStone, black ? '흑' : '백'],
      [TEXT.resultMoves, TEXT.moves(state.moves.length)],
    ];
    if (this.undos > 0) stats.push([TEXT.resultUndo, TEXT.times(this.undos)]);
    this.finishMiniGame(matchScore(result, this.prefs.level, myStones, this.undos), stats, 1600);
  }

  protected override retryData(): object {
    return { quick: true } satisfies OmokStart;
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

  private onRoom(room: RoomView<OmokView>, fresh: boolean): void {
    const view = room.game;
    if (!view) return;
    const state = replay(view.moves);
    if (!state) return;
    if (!this.frameBuilt) {
      this.frameBuilt = true;
      this.phase = 'play';
      this.playing = true;
      this.layout = this.computeLayout();
      this.drawFrame();
    }
    if (fresh) {
      this.phase = 'play';
      this.cursor = null;
      this.notice = null;
      this.seenMoves = -1;
    }
    this.subLabel?.setText(this.friends.scoreLine());
    const changed = view.moves.length !== this.seenMoves;
    // 온라인에서 친구가 둔 수가 새로 왔으면 소리를 낸다(내가 둔 수는 놓을 때 이미 냈다).
    if (changed && this.seenMoves >= 0 && this.friends.kind === 'online' && !this.wasMine(view)) sfx.flip();
    this.state = state;
    this.mine = view.mine;
    if (changed) {
      this.seenMoves = view.moves.length;
      this.cursor = null;
    }
    if (room.status === 'over') this.phase = 'over';
    this.redraw();
  }

  /** 마지막 수가 이 화면의 돌인지 */
  private wasMine(view: OmokView): boolean {
    return view.moves.length > 0 && ((view.moves.length - 1) % 2 === 0 ? BLACK : WHITE) === view.mine;
  }

  private friendsClosed(): void {
    this.phase = 'over';
    this.cursor = null;
    if (this.state) this.redraw();
  }

  private friendResult(room: RoomView<OmokView>): FriendsResult & { won: boolean | null } {
    const view = room.game!;
    const state = replay(view.moves) ?? createGame();
    const local = this.friends.kind === 'local';
    const lines: string[] = [];
    if (state.winner === null) {
      lines.push(TEXT.fullBoard);
      lines.push(FRIEND_TEXT.nextColors);
      return { title: TEXT.draw, lines, bright: false, won: null };
    }
    const winnerSeat: Seat = state.winner === view.mine ? room.seat : otherSeat(room.seat);
    const won = winnerSeat === room.seat;
    const winnerName = room.names[winnerSeat] ?? '';
    lines.push(TEXT.fiveLine(withSubject(local ? winnerName : this.friends.nameOf(winnerSeat))));
    lines.push(FRIEND_TEXT.nextColors);
    const title = local ? FRIEND_TEXT.winBy(withSubject(winnerName)) : won ? TEXT.win : TEXT.lose;
    return { title, lines, bright: local || won, lost: !local && !won, won };
  }
}
