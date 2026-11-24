import Phaser from 'phaser';
import { GAME_WIDTH } from '../../config';
import { promptText, showCode } from '../../core/dialog';
import { vibrate } from '../../core/haptics';
import { homeScene } from '../../core/home';
import { sfx } from '../../core/sfx';
import { store } from '../../core/store';
import { addTapZone, addText, fadeToScene, whileBlocked } from '../../core/ui';
import { api, failureText, type ApiFailure } from '../../online/api';
import { cleanName, NAME_MAX, NAME_MIN } from '../../online/protocol';
import { AwayBanner } from '../../versus/away-banner';
import { friendStore, recordText, roundKey } from '../../versus/friend-store';
import { closedText } from '../../versus/friends-kit';
import { foeSeat, LocalMatch, OnlineMatch, type Match } from '../../versus/match';
import { cleanRoomCode, formatRoomCode, type RoomView } from '../../versus/protocol';
import { RematchWatch, type RematchState } from '../../versus/rematch';
import { savedRoom } from '../../versus/saved-room';
import { shortName, withAnd, withSubject } from '../../versus/text';
import { MiniGameScene, type ResultStat } from '../../scenes/MiniGameScene';
import { CARD, cardTexture, MINI, PX, PX_CSS, registerHulaTextures, TEX } from './art';
import { chooseDraw, choosePlay } from './bot';
import { byRank, bySuit, cardName, meldKindOf, objectMark } from './cards';
import { HULA_GAME_ID, HULA_SCENE } from './data';
import {
  attachTargets,
  canDiscard,
  canMeld,
  canTakeDiscard,
  discard,
  drawStock,
  layOff,
  LEVEL_FACTOR,
  LEVEL_NAME,
  LEVELS,
  meld,
  newRound,
  roundScore,
  takeDiscard,
  topDiscard,
  type HulaState,
  type Level,
} from './rules';
import { hulaStore } from './store';
import { drawBackdrop, pxBox, PxButton } from './ui';
import { hulaVersus, readHulaView, type HulaMove, type HulaStep, type HulaView } from './versus';


/** 씬을 열 때 넘기는 값. level이 있으면 준비 화면을 건너뛰고 바로 그 난이도로 시작한다(결과 화면의 "다시 하기"). */
export interface HulaStart {
  level?: Level;
  /** 친구와 하기. menu는 온라인 방을 만들거나 들어가는 화면, local은 한 폰으로 번갈아 하기다. */
  friends?: 'menu' | 'local';
  /** 들어갈 온라인 방. view가 있으면 그것부터 그리고(방을 막 만들었거나 들어왔을 때), 없으면 서버에 물어본다. */
  room?: { code: string; token: string; view?: RoomView<HulaView> };
}

/** 한 폰으로 번갈아 할 때의 두 사람 이름 */
const LOCAL_NAMES = ['1P', '2P'] as const;
const NAME_RULE = `${NAME_MIN}~${NAME_MAX}자의 한글, 영문, 숫자로 지어 주세요.`;

const MARGIN = 8;
const WIDTH = GAME_WIDTH - MARGIN * 2;
/** 탁자의 카드가 겹쳐 놓일 때 보이는 폭 */
const MINI_STEP = 7;
/** 고른 카드가 위로 올라오는 높이 */
const RAISE = 8;
/** 컴퓨터가 한 가지 일을 하고 다음 일을 하기까지 기다리는 시간(ms) */
const CPU_STEP_MS = 650;

const LEVEL_NOTE: Readonly<Record<Level, string>> = {
  easy: '갖춰진 묶음만 내고, 아무 카드나 버려요',
  normal: '버린 카드도 챙기고, 큰 카드부터 버려요',
  hard: '나온 카드를 기억하고, 내가 쓸 카드는 안 줘요',
};

/** friends: 온라인 방 고르기, room: 방에 들어가 친구를 기다리거나 방이 닫힌 것을 알리는 화면 */
type Mode = 'lobby' | 'friends' | 'room' | 'round' | 'over';

/**
 * 훌라: 나와 컴퓨터가 7장씩 들고 겨루는 카드 게임. 같은 숫자나 같은 무늬로 이어지는 숫자를 모아 등록하고,
 * 손을 먼저 비우면 이긴다. 규칙은 rules.ts, 컴퓨터의 판단은 bot.ts가 맡고, 이 씬은 판을 그리고 손가락을 받는다.
 * 판이 바뀔 때마다 판에 놓인 것을 모두 지우고 다시 그린다(버튼과 글은 그대로 둔다).
 */
export class HulaScene extends MiniGameScene {
  protected readonly gameId = HULA_GAME_ID;

  private mode: Mode = 'lobby';
  private level: Level = 'normal';
  /** 하고 있는 판. 자동 점검이 들여다본다. */
  state: HulaState | null = null;
  /** 내가 고른 손패 */
  selected: number[] = [];
  private sortBySuit = false;
  /** 방금 컴퓨터가 내려놓거나 버린 카드. 한 번 빛나게 그린다. */
  private fresh = new Set<number>();
  /** 내가 방금 뽑은 카드 */
  private drawn: number | null = null;

  /** 화면에서 누를 자리(논리 좌표). 자동 점검이 손가락으로 누를 때 쓴다. */
  readonly points = {
    hand: new Map<number, { x: number; y: number }>(),
    melds: [] as { x: number; y: number }[],
    stock: { x: 0, y: 0 },
    pile: { x: 0, y: 0 },
  };

  private layer: Phaser.GameObjects.GameObject[] = [];
  private status!: Phaser.GameObjects.Text;
  private stockLabel!: Phaser.GameObjects.Text;
  private cpuLabel!: Phaser.GameObjects.Text;
  private meldButton!: PxButton;
  private discardButton!: PxButton;
  private sortButton!: PxButton;
  private subLabel: Phaser.GameObjects.Text | null = null;

  // ───────── 친구와 하기 ─────────
  /** 친구와 하는 판. 컴퓨터와 할 때는 null */
  match: Match<HulaView, HulaMove> | null = null;
  /** 판 화면(버튼, 글)을 이미 만들었는지 */
  private roundBuilt = false;
  /** 판 화면이 아닌 화면(방 기다리기, 연결 중)에 놓인 것. 판이 시작되면 지운다. */
  private screenLayer: Phaser.GameObjects.GameObject[] = [];
  /** 판이 끝났을 때 띄운 결과 판. 한 판 더 하면 지운다. */
  private endLayer: Phaser.GameObjects.GameObject[] = [];
  private againButton: PxButton | null = null;
  /** 상대가 마지막 차례에 한 일. 바뀌었을 때만 알린다. */
  private theirsKey = '';
  /** 상대가 마지막으로 한 일을 알리는 한 줄 */
  private foeNote: string | null = null;
  /** 보낸 수의 답을 기다리는 중 */
  private sending = false;
  /** 이 씬이 떠났는지. 늦게 온 서버의 답이 떠난 씬을 그리지 않게 한다. */
  private alive = false;
  /** 한 폰으로 할 때, 마지막으로 패를 보여 준 자리. 둘 차례가 바뀌면 화면을 가리고 폰을 넘기게 한다. */
  private shownSeat: number | null = null;
  /** 폰을 넘기는 동안 패를 가리는 판. 자동 점검이 들여다본다. */
  covered = false;
  private coverLayer: Phaser.GameObjects.GameObject[] = [];
  /** 판을 마친 방의 번호. 같은 판의 끝을 두 번 기록하지 않는다. */
  private settledRound = -1;
  /** 친구와 온라인 화면에서 마지막으로 같이 한 친구의 방을 들여다보는 것 */
  rematch: RematchWatch<HulaView> | null = null;
  /** 같은 방을 새 화면으로 다시 여는 중이면 true. 씬을 떠나도 방에서 나가지 않는다. */
  private reopening = false;

  constructor() {
    super(HULA_SCENE);
  }

  create(data: HulaStart = {}): void {
    this.beginMiniGame();
    registerHulaTextures(this);
    drawBackdrop(this);
    this.layer = [];
    this.state = null;
    this.selected = [];
    this.fresh = new Set();
    this.drawn = null;
    this.match = null;
    this.roundBuilt = false;
    this.screenLayer = [];
    this.endLayer = [];
    this.againButton = null;
    this.subLabel = null;
    this.theirsKey = '';
    this.foeNote = null;
    this.sending = false;
    this.shownSeat = null;
    this.covered = false;
    this.coverLayer = [];
    this.settledRound = -1;
    this.closedShown = false;
    this.awayBanner = null;
    this.rematch = null;
    this.reopening = false;
    this.alive = true;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.closeFriends());
    if (data.room) this.connectRoom(data.room.code, data.room.token, data.room.view ?? null);
    else if (data.friends === 'menu') this.openFriends();
    else if (data.friends === 'local') this.startLocal();
    else if (data.level && LEVELS.includes(data.level)) this.startRound(data.level);
    else this.openLobby();
  }

  // ───────── 준비 화면 ─────────

  private openLobby(): void {
    this.mode = 'lobby';
    const { height } = this.scale;
    const record = hulaStore.data;
    new PxButton(this, { x: MARGIN, y: 8, width: 26, height: 26, icon: TEX.back_arrow, hitPadding: 6, onTap: () => this.leave() });
    addText(this, 42, 21, '훌라', { size: 18, color: PX_CSS.accent, originY: 0.5 });
    addText(this, 84, 22, '컴퓨터와 1 대 1', { size: 11, color: PX_CSS.sub, originY: 0.5 });
    // 규칙을 모르는 사람을 위한 안내서. 처음 하는 사람에게는 한 번 저절로 열린다.
    new PxButton(this, { x: GAME_WIDTH - MARGIN - 44, y: 8, width: 44, height: 26, label: '규칙', size: 12, style: 'gold', hitPadding: 4, onTap: () => this.openRuleBook() });
    this.offerRuleBook(() => this.mode === 'lobby');

    // 카드 몇 장을 부채처럼 펼쳐 둔다.
    const fan = [cardTexture(0 * 13 + 6), cardTexture(1 * 13 + 6), cardTexture(2 * 13 + 6), cardTexture(3 * 13 + 6)];
    const fanTop = 46;
    fan.forEach((key, i) => {
      this.add
        .image(GAME_WIDTH / 2 + (i - 1.5) * 22, fanTop + 24 + Math.abs(i - 1.5) * 3, key)
        .setAngle((i - 1.5) * 9)
        .setDisplaySize(CARD.w, CARD.h);
    });

    const rowsTop = fanTop + 64;
    addText(this, MARGIN, rowsTop, '상대 고르기', { size: 12, color: PX_CSS.text });
    const rowHeight = 50;
    LEVELS.forEach((level, i) => {
      const y = rowsTop + 18 + i * (rowHeight + 6);
      const g = this.add.graphics();
      const draw = (pressed: boolean): void => {
        g.clear();
        const picked = record.level === level;
        pxBox(g, MARGIN, y + (pressed ? 1 : 0), WIDTH, rowHeight, pressed ? PX.navy : PX.charcoal, picked ? PX.yellow : PX.ink);
      };
      draw(false);
      const r = record.records[level];
      addText(this, MARGIN + 10, y + 8, LEVEL_NAME[level], { size: 15, color: PX_CSS.text });
      addText(this, MARGIN + 10, y + 29, LEVEL_NOTE[level], { size: 10, color: PX_CSS.sub });
      addText(this, MARGIN + WIDTH - 10, y + 10, `${r.wins}승 ${r.losses}패`, { size: 11, color: PX_CSS.accent, originX: 1 });
      addText(this, MARGIN + WIDTH - 10, y + 26, `점수 ×${LEVEL_FACTOR[level]}`, { size: 9, color: PX_CSS.faint, originX: 1 });
      addTapZone(this, MARGIN, y, WIDTH, rowHeight, draw, () => {
        hulaStore.set({ ...hulaStore.data, level });
        this.scene.restart({ level } satisfies HulaStart);
      });
    });

    // 친구와 하기: 온라인(방 코드)과 한 폰으로 번갈아 하기 가운데 고른다.
    const friendsTop = rowsTop + 18 + 3 * (rowHeight + 6);
    addText(this, MARGIN, friendsTop, '친구와 함께', { size: 12, color: PX_CSS.text });
    const friends = record.friends;
    if (friends.wins + friends.losses > 0) {
      addText(this, MARGIN + WIDTH, friendsTop + 2, `온라인 ${friends.wins}승 ${friends.losses}패`, { size: 9, color: PX_CSS.faint, originX: 1 });
    }
    const half = Math.floor((WIDTH - 6) / 2);
    new PxButton(this, {
      x: MARGIN,
      y: friendsTop + 17,
      width: half,
      height: 34,
      label: '온라인 · 방 코드',
      size: 11,
      style: 'blue',
      onTap: () => this.scene.restart({ friends: 'menu' } satisfies HulaStart),
    });
    new PxButton(this, {
      x: MARGIN + WIDTH - half,
      y: friendsTop + 17,
      width: half,
      height: 34,
      label: '한 폰으로',
      size: 11,
      onTap: () => this.scene.restart({ friends: 'local' } satisfies HulaStart),
    });

    const rulesTop = friendsTop + 17 + 34 + 10;
    const rules = [
      '같은 숫자 3장, 같은 무늬로 이어진 3장을 모아 내요',
      '7은 한 장만으로도 낼 수 있어요',
      '손을 먼저 다 비우면 이겨요',
      '한 번도 안 내다가 한 차례에 다 내면 훌라(점수 두 배)',
    ];
    const room = height - rulesTop - 10;
    const box = this.add.graphics();
    const lineHeight = 15;
    const boxHeight = Math.min(room, rules.length * lineHeight + 12);
    if (boxHeight >= lineHeight * 2 + 12) {
      pxBox(box, MARGIN, rulesTop, WIDTH, boxHeight, PX.ink, PX.slate);
      rules.slice(0, Math.floor((boxHeight - 12) / lineHeight)).forEach((line, i) => {
        addText(this, MARGIN + 8, rulesTop + 7 + i * lineHeight, `· ${line}`, { size: 10, color: PX_CSS.sub });
      });
    }
  }

  private leave(): void {
    fadeToScene(this, homeScene());
  }

  override onBackRequest(): void {
    if (this.mode === 'lobby') this.leave();
    else if (this.mode === 'friends') this.scene.restart({} satisfies HulaStart);
    else if (this.mode === 'room' || (this.mode === 'over' && this.match)) this.exitFriends();
    else this.pauseGame();
  }

  protected override pauseGame(): void {
    if (this.mode !== 'round') return;
    super.pauseGame();
  }

  /** 일시정지는 판을 하는 동안에만 열리고, 그때 이 버튼은 판을 진 것으로 치고 나간다(forfeit). 누르기 전에 알 수 있게 적는다. */
  protected override restartLabel(): string | null {
    if (this.match?.kind === 'online') return '방에서 나가고 상대 고르기';
    if (this.match) return '그만하고 상대 고르기';
    return '진 판으로 하고 상대 고르기';
  }

  protected override quitWarning(): string | null {
    if (this.mode !== 'round') return null;
    if (this.match?.kind === 'local') return null;
    if (this.match?.awayUntil != null) return '친구가 자리를 비워서, 지금 나가면 내가 이긴 판이 돼요';
    if (this.match) return '지금 나가면 진 판으로 치고 방이 닫혀요';
    return '지금 나가면 진 판으로 쳐요';
  }

  /**
   * 판을 나눠 준 뒤에 끝나기 전에 씬을 떠나면(그만하기, 상대 다시 고르기) 그 난이도에서 진 판으로 센다.
   * 지는 판만 골라 버려서 승률을 부풀리지 못하게 한다. 끝난 판은 endRound()가 이미 기록했다.
   */
  private forfeit(): void {
    if (this.match || this.mode !== 'round' || !this.state || this.state.phase === 'over') return;
    this.mode = 'over';
    hulaStore.addResult(this.level, false);
  }

  protected override retryData(): object | undefined {
    return { level: this.level } satisfies HulaStart;
  }

  // ───────── 판 ─────────

  private get layout() {
    const { height } = this.scale;
    const buttonsTop = height - 42;
    const handTop = buttonsTop - 8 - CARD.h;
    const pileTop = handTop - RAISE - 26 - CARD.h;
    return {
      cpuTop: 40,
      tableTop: 68,
      tableBottom: pileTop - 6,
      pileTop,
      handTop,
      buttonsTop,
    };
  }

  private startRound(level: Level): void {
    this.mode = 'round';
    this.level = level;
    this.playing = true;
    const first = Math.random() < 0.5 ? 'me' : 'cpu';
    this.state = newRound(Math.random, first);
    // 판을 나눠 준 순간부터는 끝나기 전에 떠나면 진 판이다.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.forfeit());
    this.buildRound(`컴퓨터 · ${LEVEL_NAME[level]}`);
    this.render();
    if (this.state.turn === 'cpu') this.time.delayedCall(700, () => this.cpuTurn());
  }

  /** 판 화면의 버튼과 글을 만든다. 컴퓨터와 할 때와 친구와 할 때가 같이 쓴다. sub는 제목 아래의 작은 글이다. */
  private buildRound(sub: string): void {
    this.roundBuilt = true;
    const pause = new PxButton(this, { x: MARGIN, y: 8, width: 26, height: 26, icon: TEX.pause, hitPadding: 6, onTap: () => this.pauseGame() });
    pause.setDepth(5);
    addText(this, 42, 14, '훌라', { size: 14, color: PX_CSS.text, originY: 0.5 });
    this.subLabel = addText(this, 42, 29, sub, { size: 9, color: PX_CSS.sub, originY: 0.5 });
    this.cpuLabel = addText(this, GAME_WIDTH - MARGIN, 21, '', { size: 11, color: PX_CSS.sub, originX: 1, originY: 0.5 });

    const { pileTop, buttonsTop } = this.layout;
    this.stockLabel = addText(this, MARGIN + CARD.w / 2, pileTop + CARD.h + 3, '', { size: 9, color: PX_CSS.faint, originX: 0.5 });
    addText(this, MARGIN + CARD.w + 6 + CARD.w / 2, pileTop + CARD.h + 3, '버린 카드', { size: 9, color: PX_CSS.faint, originX: 0.5 });
    const statusLeft = MARGIN + CARD.w * 2 + 16;
    this.status = addText(this, statusLeft, pileTop + CARD.h / 2, '', {
      size: 11,
      color: PX_CSS.text,
      originY: 0.5,
      wrapWidth: GAME_WIDTH - MARGIN - statusLeft,
      lineSpacing: 2,
    });

    this.sortButton = new PxButton(this, {
      x: MARGIN,
      y: buttonsTop,
      width: 52,
      height: 34,
      label: '숫자순',
      size: 11,
      onTap: () => {
        this.sortBySuit = !this.sortBySuit;
        this.render();
      },
    });
    this.meldButton = new PxButton(this, {
      x: MARGIN + 58,
      y: buttonsTop,
      width: 84,
      height: 34,
      label: '등록',
      style: 'green',
      onTap: () => this.onMeld(),
    });
    this.discardButton = new PxButton(this, {
      x: MARGIN + 148,
      y: buttonsTop,
      width: WIDTH - 148,
      height: 34,
      label: '버리기',
      style: 'red',
      onTap: () => this.onDiscard(),
    });
  }

  /** 판에 놓인 것(카드, 탁자, 더미)을 지우고 지금 상태대로 다시 그린다. */
  private render(): void {
    const state = this.state;
    if (!state) return;
    for (const object of this.layer) object.destroy();
    this.layer = [];
    this.points.hand.clear();
    this.points.melds = [];
    this.selected = this.selected.filter((card) => state.hands.me.includes(card));
    this.drawCpuHand(state);
    this.drawTable(state);
    this.drawPiles(state);
    this.drawHand(state);
    this.updateControls(state);
  }

  private keep<T extends Phaser.GameObjects.GameObject>(object: T): T {
    this.layer.push(object);
    return object;
  }

  private drawCpuHand(state: HulaState): void {
    const { cpuTop } = this.layout;
    const hand = state.hands.cpu;
    const reveal = state.phase === 'over';
    const step = reveal ? MINI.w + 1 : 9;
    const width = MINI.w + step * Math.max(0, hand.length - 1);
    const left = Math.round(GAME_WIDTH / 2 - width / 2);
    const cards = reveal ? [...hand].sort(byRank) : hand;
    cards.forEach((card, i) => {
      this.keep(this.add.image(left + i * step, cpuTop, reveal ? cardTexture(card) : TEX.back).setOrigin(0, 0).setDisplaySize(MINI.w, MINI.h));
    });
    this.cpuLabel.setText(this.match ? `${shortName(this.foeName, 5)} ${hand.length}장` : `${hand.length}장`);
    if (state.turn === 'cpu' && state.phase !== 'over') {
      const g = this.keep(this.add.graphics());
      g.fillStyle(PX.yellow, 1);
      g.fillRect(left - 6, cpuTop + 8, 3, 5);
      g.fillRect(left - 7, cpuTop + 9, 1, 3);
    }
  }

  private drawTable(state: HulaState): void {
    const { tableTop, tableBottom } = this.layout;
    const g = this.keep(this.add.graphics());
    pxBox(g, MARGIN, tableTop, WIDTH, tableBottom - tableTop, 0x1f2a44, PX.ink);
    if (state.melds.length === 0) {
      this.keep(
        addText(this, GAME_WIDTH / 2, (tableTop + tableBottom) / 2, '등록한 카드가 여기에 놓여요', {
          size: 10,
          color: PX_CSS.faint,
          originX: 0.5,
          originY: 0.5,
        }),
      );
      return;
    }
    const single = this.selected.length === 1 && state.turn === 'me' && state.phase === 'play' ? this.selected[0] : null;
    const targets = new Set(single === null ? [] : attachTargets(state, single));
    // 묶음이 적을 때는 손패만 한 크기로, 많아져서 넘치면 그 절반 크기로 놓는다.
    const placed = placeMelds(state.melds.map((m) => m.cards.length), 2, tableTop, tableBottom) ?? placeMelds(state.melds.map((m) => m.cards.length), 1, tableTop, tableBottom, true)!;
    const { scale, spots } = placed;
    const w = MINI.w * scale;
    const h = MINI.h * scale;
    const step = MINI_STEP * scale;
    const pad = TABLE_PAD;
    state.melds.forEach((meldItem, index) => {
      const { x, y, width } = spots[index];
      this.points.melds[index] = { x: x + width / 2, y: y + pad + h / 2 };
      const frame = targets.has(index) ? PX.yellow : meldItem.owner === 'me' ? PX.teal : PX.plum;
      g.fillStyle(frame, 1);
      g.fillRect(x, y, width, h + pad * 2);
      g.fillStyle(PX.ink, 1);
      g.fillRect(x + 1, y + 1, width - 2, h + pad * 2 - 2);
      meldItem.cards.forEach((card, i) => {
        const cx = x + pad + i * step;
        this.keep(this.add.image(cx, y + pad, cardTexture(card)).setOrigin(0, 0).setDisplaySize(w, h));
        if (this.fresh.has(card)) {
          g.fillStyle(PX.yellow, 1);
          g.fillRect(cx, y + pad + h - 1, i === meldItem.cards.length - 1 ? w : step, 2);
        }
      });
      if (targets.has(index)) {
        this.keep(addTapZone(this, x - 2, y - 2, width + 4, h + pad * 2 + 4, () => {}, () => this.onLayOff(index)));
      }
    });
  }

  private drawPiles(state: HulaState): void {
    const { pileTop } = this.layout;
    const myDraw = state.turn === 'me' && state.phase === 'draw';
    const g = this.keep(this.add.graphics());
    // 덱
    const stockX = MARGIN;
    this.points.stock = { x: stockX + CARD.w / 2, y: pileTop + CARD.h / 2 };
    if (state.stock.length > 0) {
      if (state.stock.length > 1) this.keep(this.add.image(stockX + 2, pileTop + 2, TEX.back).setOrigin(0, 0));
      this.keep(this.add.image(stockX, pileTop, TEX.back).setOrigin(0, 0));
    } else {
      pxBox(g, stockX, pileTop, CARD.w, CARD.h, PX.ink, PX.slate);
    }
    this.stockLabel.setText(`덱 ${state.stock.length}`);
    if (myDraw) this.outline(g, stockX, pileTop, CARD.w, CARD.h, PX.yellow);
    if (myDraw && state.stock.length > 0) {
      this.keep(addTapZone(this, stockX - 4, pileTop - 4, CARD.w + 8, CARD.h + 8, () => {}, () => this.onDrawStock()));
    }
    // 버린 카드
    const pileX = MARGIN + CARD.w + 6;
    this.points.pile = { x: pileX + CARD.w / 2, y: pileTop + CARD.h / 2 };
    const top = topDiscard(state);
    if (top === null) {
      pxBox(g, pileX, pileTop, CARD.w, CARD.h, PX.ink, PX.slate);
    } else {
      if (state.discard.length > 1) {
        this.keep(this.add.image(pileX + 2, pileTop + 2, cardTexture(state.discard[state.discard.length - 2])).setOrigin(0, 0));
      }
      this.keep(this.add.image(pileX, pileTop, cardTexture(top)).setOrigin(0, 0));
      if (this.fresh.has(top)) this.outline(g, pileX, pileTop, CARD.w, CARD.h, PX.orange);
    }
    if (myDraw) {
      const usable = canTakeDiscard(state, 'me');
      if (usable) this.outline(g, pileX, pileTop, CARD.w, CARD.h, PX.lime);
      this.keep(
        addTapZone(this, pileX - 2, pileTop - 4, CARD.w + 6, CARD.h + 8, () => {}, () => {
          if (usable) this.onTakeDiscard();
          else this.say('버린 카드는 바로 낼 수 있을 때만 가져와요', true);
        }),
      );
    }
  }

  private outline(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, color: number): void {
    g.fillStyle(color, 1);
    g.fillRect(x - 2, y - 2, w + 4, 2);
    g.fillRect(x - 2, y + h, w + 4, 2);
    g.fillRect(x - 2, y, 2, h);
    g.fillRect(x + w, y, 2, h);
  }

  private handOrder(state: HulaState): number[] {
    return [...state.hands.me].sort(this.sortBySuit ? bySuit : byRank);
  }

  private drawHand(state: HulaState): void {
    const { handTop } = this.layout;
    const hand = this.handOrder(state);
    if (hand.length === 0) return;
    const step = hand.length === 1 ? 0 : Math.min(CARD.w + 2, Math.floor((WIDTH - CARD.w) / (hand.length - 1)));
    const width = CARD.w + step * (hand.length - 1);
    const left = Math.round(GAME_WIDTH / 2 - width / 2);
    const g = this.keep(this.add.graphics());
    const canPick = state.turn === 'me' && state.phase === 'play';
    hand.forEach((card, i) => {
      const picked = this.selected.includes(card);
      const x = left + i * step;
      const y = handTop - (picked ? RAISE : 0);
      const image = this.keep(this.add.image(x, y, cardTexture(card)).setOrigin(0, 0));
      if (!canPick && state.phase !== 'over') image.setAlpha(state.turn === 'me' ? 1 : 0.85);
      if (picked) this.outline(g, x, y, CARD.w, CARD.h, PX.yellow);
      // 표시: 방금 뽑은 카드는 연두 점, 가져와서 꼭 내야 하는 카드는 주황 띠
      if (card === state.taken) {
        g.fillStyle(PX.orange, 1);
        g.fillRect(x + 2, y - 5, CARD.w - 4, 3);
      } else if (card === this.drawn) {
        g.fillStyle(PX.lime, 1);
        g.fillRect(x + CARD.w / 2 - 2, y - 6, 4, 4);
      }
      const zoneWidth = i === hand.length - 1 ? CARD.w : step;
      this.points.hand.set(card, { x: x + zoneWidth / 2, y: handTop + CARD.h / 2 });
      this.keep(
        addTapZone(this, x, handTop - RAISE, zoneWidth, CARD.h + RAISE + 6, () => {}, () => this.toggle(card)),
      );
    });
  }

  private updateControls(state: HulaState): void {
    const mine = state.turn === 'me' && state.phase === 'play';
    this.sortButton.setLabel(this.sortBySuit ? '무늬순' : '숫자순');
    this.meldButton.setEnabled(mine && canMeld(state, this.selected));
    this.discardButton.setEnabled(mine && this.selected.length === 1 && canDiscard(state, this.selected[0]));
    if (state.phase === 'over') return;
    if (state.turn === 'cpu') {
      if (this.match) this.say(this.foeNote ?? `${withSubject(this.foeName)} 두는 중이에요`);
      return;
    }
    if (state.phase === 'draw' && this.match) {
      const turn = this.match.kind === 'local' ? `${this.myName} 차례!` : '내 차례!';
      this.say(this.foeNote ? `${this.foeNote}. ${turn}` : `${turn} 덱을 눌러 한 장 뽑아요`);
      return;
    }
    if (state.phase === 'draw') {
      this.say(canTakeDiscard(state, 'me') ? '덱이나 버린 카드를 눌러 한 장 가져와요' : '덱을 눌러 한 장 뽑아요');
      return;
    }
    if (state.taken !== null && !this.selected.includes(state.taken)) {
      // 묶음 모양은 맞는데 등록이 안 되면, 그 카드를 내고 나면 가져온 카드를 낼 길이 없어서다.
      if (meldKindOf(this.selected) !== null && !canMeld(state, this.selected)) {
        this.say(`그 카드를 내면 가져온 ${cardName(state.taken)}${objectMark(state.taken)} 낼 수 없어요`, true);
        return;
      }
      this.say(`가져온 ${cardName(state.taken)}${objectMark(state.taken)} 먼저 내려놓아요`);
      return;
    }
    if (this.selected.length === 1 && attachTargets(state, this.selected[0]).length > 0) {
      this.say('빛나는 묶음을 누르면 붙여요. 버려도 돼요');
      return;
    }
    if (this.selected.length > 0 && canMeld(state, this.selected)) {
      this.say('등록할 수 있어요!');
      return;
    }
    if (this.selected.length === 0) {
      this.say('카드를 골라 등록하거나, 한 장 버려요');
      return;
    }
    this.say(this.selected.length === 1 ? '이 카드를 버릴까요?' : '같은 숫자 3장이나 이어진 3장이어야 해요');
  }

  private say(text: string, warn = false): void {
    this.status.setText(text).setColor(warn ? PX_CSS.bad : PX_CSS.text);
  }

  // ───────── 내 차례 ─────────

  private toggle(card: number): void {
    const state = this.state;
    if (!state || state.turn !== 'me' || state.phase !== 'play') return;
    sfx.flip();
    this.selected = this.selected.includes(card) ? this.selected.filter((c) => c !== card) : [...this.selected, card];
    this.render();
  }

  private onDrawStock(): void {
    const state = this.state;
    if (!state) return;
    if (this.match) {
      const before = [...state.hands.me];
      this.sendMove({ type: 'draw' }, () => {
        this.fresh.clear();
        this.foeNote = null;
        this.drawn = this.state?.hands.me.find((card) => !before.includes(card)) ?? null;
        this.selected = [];
        sfx.flip();
      });
      return;
    }
    this.fresh.clear();
    this.drawn = drawStock(state);
    if (this.drawn === null) return;
    sfx.flip();
    this.selected = [];
    this.render();
  }

  private onTakeDiscard(): void {
    const state = this.state;
    if (!state) return;
    if (this.match) {
      this.sendMove({ type: 'take' }, () => {
        this.fresh.clear();
        this.foeNote = null;
        this.drawn = null;
        const taken = this.state?.taken ?? null;
        this.selected = taken === null ? [] : [taken];
        sfx.flip();
      });
      return;
    }
    this.fresh.clear();
    const card = takeDiscard(state);
    if (card === null) return;
    sfx.flip();
    this.drawn = null;
    this.selected = [card];
    this.render();
  }

  private onMeld(): void {
    const state = this.state;
    if (this.match) {
      this.sendMove({ type: 'meld', cards: [...this.selected] }, () => {
        sfx.coin();
        vibrate(12);
        this.selected = [];
      });
      return;
    }
    if (!state || !meld(state, this.selected)) {
      sfx.deny();
      return;
    }
    sfx.coin();
    vibrate(12);
    this.selected = [];
    this.afterMyMove();
  }

  private onLayOff(index: number): void {
    const state = this.state;
    if (this.match && this.selected.length === 1) {
      this.sendMove({ type: 'layoff', card: this.selected[0], meld: index }, () => {
        sfx.coin();
        this.selected = [];
      });
      return;
    }
    if (!state || this.selected.length !== 1 || !layOff(state, this.selected[0], index)) {
      sfx.deny();
      return;
    }
    sfx.coin();
    this.selected = [];
    this.afterMyMove();
  }

  private onDiscard(): void {
    const state = this.state;
    if (this.match && this.selected.length === 1) {
      this.sendMove({ type: 'discard', card: this.selected[0] }, () => {
        sfx.flip();
        this.selected = [];
        this.drawn = null;
      });
      return;
    }
    if (!state || this.selected.length !== 1 || !discard(state, this.selected[0])) {
      sfx.deny();
      return;
    }
    sfx.flip();
    this.selected = [];
    this.drawn = null;
    this.afterMyMove();
    if (state.phase !== 'over' && state.turn === 'cpu') this.time.delayedCall(500, () => this.cpuTurn());
  }

  private afterMyMove(): void {
    this.render();
    if (this.state?.phase === 'over') this.endRound();
  }

  // ───────── 컴퓨터 차례 ─────────

  private cpuTurn(): void {
    const state = this.state;
    if (!state || state.turn !== 'cpu' || state.phase !== 'draw') return;
    this.fresh.clear();
    const pick = chooseDraw(state, this.level);
    if (pick.type === 'take') {
      const card = takeDiscard(state);
      this.say(card === null ? '컴퓨터가 버린 카드를 가져갔어요' : `컴퓨터가 버린 ${cardName(card)}${objectMark(card)} 가져갔어요`);
    } else {
      drawStock(state);
      this.say('컴퓨터가 덱에서 한 장 뽑았어요');
    }
    sfx.flip();
    this.render();
    this.time.delayedCall(CPU_STEP_MS, () => this.cpuStep());
  }

  private cpuStep(): void {
    const state = this.state;
    if (!state || state.turn !== 'cpu' || state.phase !== 'play') return;
    const step = choosePlay(state, this.level, Math.random);
    if (step.type === 'meld') {
      meld(state, step.cards);
      for (const card of step.cards) this.fresh.add(card);
      this.say('컴퓨터가 등록했어요');
      sfx.coin();
    } else if (step.type === 'layoff') {
      layOff(state, step.card, step.meld);
      this.fresh.add(step.card);
      this.say(`컴퓨터가 ${cardName(step.card)}${objectMark(step.card)} 붙였어요`);
      sfx.coin();
    } else if (step.type === 'discard') {
      discard(state, step.card);
      this.fresh.add(step.card);
      sfx.flip();
      this.render();
      if (isOver(state)) {
        this.endRound();
        return;
      }
      this.say(`컴퓨터가 ${cardName(step.card)}${objectMark(step.card)} 버렸어요. 내 차례!`);
      return;
    } else {
      return;
    }
    this.render();
    if (isOver(state)) {
      this.endRound();
      return;
    }
    this.time.delayedCall(CPU_STEP_MS, () => this.cpuStep());
  }

  // ───────── 친구와 하기 ─────────

  /** 상대의 이름. 컴퓨터와 할 때는 "컴퓨터" */
  get foeName(): string {
    const room = this.match?.room;
    return room ? (room.names[foeSeat(room)] ?? '친구') : '컴퓨터';
  }

  /** 화면 아래의 패를 든 사람의 이름. 온라인이면 "나" */
  private get myName(): string {
    const room = this.match?.room;
    if (!room) return '나';
    return this.match?.kind === 'local' ? room.names[room.seat] ?? '나' : '나';
  }

  /** 온라인 방 고르기: 방 만들기, 코드로 들어가기, 하던 방으로 돌아가기 */
  private openFriends(): void {
    this.mode = 'friends';
    const { height } = this.scale;
    new PxButton(this, { x: MARGIN, y: 8, width: 26, height: 26, icon: TEX.back_arrow, hitPadding: 6, onTap: () => this.scene.restart({} satisfies HulaStart) });
    addText(this, 42, 21, '친구와 온라인', { size: 16, color: PX_CSS.accent, originY: 0.5 });

    const rows: Array<{ title: string; note: string; onTap: () => void; gold?: boolean; rematch?: boolean }> = [];
    const saved = savedRoom.get('hula');
    if (saved) {
      rows.push({
        title: '하던 방으로 돌아가기',
        note: `방 코드 ${formatRoomCode(saved.code)}`,
        gold: true,
        onTap: () => this.scene.restart({ room: { code: saved.code, token: saved.token } } satisfies HulaStart),
      });
    }
    const again = friendStore.rematch('hula');
    let rematchRow: { title: Phaser.GameObjects.Text; note: Phaser.GameObjects.Text } | null = null;
    if (again && again.code !== saved?.code) {
      rows.push({
        title: `${withAnd(shortName(again.foe, 8))} 한 판 더`,
        note: '같은 방으로 다시 불러요 · 코드는 필요 없어요',
        gold: true,
        onTap: () => this.acceptRematch(),
        rematch: true,
      });
    }
    rows.push(
      { title: '방 만들기', note: '코드를 받아 친구에게 보내요', onTap: () => this.makeRoom() },
      { title: '코드로 들어가기', note: '친구가 보낸 여섯 글자를 넣어요', onTap: () => this.joinByCode() },
    );
    const rowHeight = again ? 44 : 48;
    let y = 48;
    for (const row of rows) {
      const top = y;
      const g = this.add.graphics();
      const draw = (pressed: boolean): void => {
        g.clear();
        pxBox(g, MARGIN, top + (pressed ? 1 : 0), WIDTH, rowHeight, pressed ? PX.navy : PX.charcoal, row.gold ? PX.yellow : PX.ink);
      };
      draw(false);
      const title = addText(this, MARGIN + 10, top + 7, row.title, { size: 14, color: row.gold ? PX_CSS.accent : PX_CSS.text });
      const note = addText(this, MARGIN + 10, top + rowHeight - 20, row.note, { size: 10, color: PX_CSS.sub });
      if (row.rematch) rematchRow = { title, note };
      addTapZone(this, MARGIN, top, WIDTH, rowHeight, draw, row.onTap);
      y += rowHeight + 6;
    }
    if (again && rematchRow) this.watchRematch(again, rematchRow.title, rematchRow.note);

    // 친구 전적: 같이 한 친구들을 최근 순으로 몇 줄
    const friends = friendStore.friends('hula');
    if (friends.length > 0) {
      const shown = friends.slice(0, 3);
      addText(this, MARGIN + 2, y + 2, '친구 전적', { size: 11, color: PX_CSS.text });
      if (friends.length > shown.length) addText(this, MARGIN + WIDTH, y + 3, `외 ${friends.length - shown.length}명`, { size: 9, color: PX_CSS.faint, originX: 1 });
      y += 20;
      for (const friend of shown) {
        const record = friend.games.hula ?? { wins: 0, losses: 0 };
        addText(this, MARGIN + 10, y, shortName(friend.name, 10), { size: 10, color: PX_CSS.sub });
        addText(this, MARGIN + WIDTH - 8, y, recordText(record), { size: 10, color: record.wins > record.losses ? PX_CSS.accent : PX_CSS.sub, originX: 1 });
        y += 15;
      }
    }

    this.status = addText(this, GAME_WIDTH / 2, y + 4, '', { size: 10, color: PX_CSS.text, originX: 0.5, align: 'center', wrapWidth: WIDTH - 8 });

    const notes = [
      '각자 자기 폰으로 차례대로 둬요',
      '두 사람 모두 인터넷이 있어야 해요',
      '30분 동안 아무도 안 두면 방이 닫혀요',
    ];
    const boxTop = y + (friends.length > 0 ? 30 : 40);
    const lineHeight = 15;
    const boxHeight = notes.length * lineHeight + 12;
    const box = this.add.graphics();
    pxBox(box, MARGIN, boxTop, WIDTH, boxHeight, PX.ink, PX.slate);
    notes.forEach((line, i) => addText(this, MARGIN + 8, boxTop + 7 + i * lineHeight, `· ${line}`, { size: 10, color: PX_CSS.sub }));

    // 인터넷이 없을 때 고를 수 있게 한 폰으로 하기를 바로 아래에 둔다.
    const localTop = Math.min(height - 46, boxTop + boxHeight + 10);
    new PxButton(this, {
      x: MARGIN,
      y: localTop,
      width: WIDTH,
      height: 34,
      label: '인터넷이 없으면 · 한 폰으로 하기',
      size: 11,
      onTap: () => this.scene.restart({ friends: 'local' } satisfies HulaStart),
    });
  }

  /** 마지막으로 같이 한 친구의 방을 몇 초마다 들여다보고, 친구가 먼저 다시 하자고 했으면 알린다. */
  private watchRematch(saved: NonNullable<ReturnType<typeof friendStore.rematch>>, title: Phaser.GameObjects.Text, note: Phaser.GameObjects.Text): void {
    const show = (state: RematchState): void => {
      if (!this.alive || this.mode !== 'friends') return;
      if (state === 'invited') {
        title.setText(`${withSubject(shortName(saved.foe, 8))} 한 판 더 하재요!`);
        note.setText('눌러서 바로 시작해요').setColor(PX_CSS.good);
        sfx.coin();
        vibrate(30);
      } else if (state === 'asked') {
        note.setText('다시 하자고 했어요 · 눌러서 방으로 가요').setColor(PX_CSS.sub);
      } else if (state === 'gone') {
        friendStore.clearRematch();
        title.setColor(PX_CSS.faint);
        note.setText('방이 사라졌어요 · 방을 새로 만들어 주세요').setColor(PX_CSS.faint);
      }
    };
    this.rematch = new RematchWatch<HulaView>(api, saved, readHulaView, show);
  }

  /** 다시 하자: 같은 방을 다시 열어 친구를 부르고 그 방으로 들어간다. 친구가 먼저 불렀으면 바로 새 판이 시작된다. */
  private acceptRematch(): void {
    const watch = this.rematch;
    if (!watch || watch.state === 'gone') return;
    void whileBlocked(this, async () => {
      if (navigator.onLine === false) return this.menuFail('offline');
      this.menuSay(watch.state === 'invited' ? '방에 들어가는 중이에요…' : `${withAnd(watch.saved.foe)} 할 방을 여는 중이에요…`);
      const result = await watch.accept();
      if (!this.alive) return;
      if (!result.ok) {
        if (result.reason === 'notfound' || result.reason === 'invalid') {
          friendStore.clearRematch();
          this.menuSay('방이 사라졌어요.\n방을 새로 만들어 주세요.', true);
        } else this.menuFail(result.reason);
        return;
      }
      const { code, token } = watch.saved;
      savedRoom.set('hula', code, token);
      friendStore.clearRematch();
      this.scene.restart({ room: { code, token, view: result.data } } satisfies HulaStart);
    });
  }

  /** 온라인 판 하나의 결과를 전적(훌라의 친구 전적과 친구마다)에 넣는다. 이미 센 판이면 넘어간다. */
  private countFriend(room: RoomView<HulaView>, won: boolean | null, key = roundKey(room)): void {
    if (friendStore.addFriendResult('hula', room as RoomView<unknown>, won, key)) hulaStore.addFriendResult(won);
  }

  /** 방 고르기 화면에 알리는 글 */
  private menuSay(text: string, warn = false): void {
    if (this.mode === 'friends' && this.alive) this.say(text, warn);
  }

  /** 서버에 닿지 못한 까닭을 알린다. 인터넷이 없으면 한 폰으로 하기를 권한다. */
  private menuFail(reason: ApiFailure): void {
    this.menuSay(reason === 'offline' ? '인터넷에 닿지 못했어요.\n인터넷이 없으면 한 폰으로 하기를 골라요.' : failureText(reason), true);
  }

  /** 친구 화면에 보일 내 이름을 묻는다. 지난번 이름이나 랭킹 닉네임을 미리 적어 둔다. 그만두면 null */
  private async askName(): Promise<string | null> {
    const answer = await promptText({
      title: '내 이름',
      hint: '친구 화면에 보이는 이름이에요.',
      value: hulaStore.data.friendName ?? store.data.online.name ?? '',
      placeholder: '이름',
      maxLength: NAME_MAX,
      confirmLabel: '좋아요',
      check: (value) => {
        const name = cleanName(value);
        return name === null ? { error: NAME_RULE } : { value: name };
      },
    });
    if (answer.action !== 'confirm') return null;
    hulaStore.setFriendName(answer.value);
    return answer.value;
  }

  private makeRoom(): void {
    void whileBlocked(this, async () => {
      if (navigator.onLine === false) return this.menuFail('offline');
      const name = await this.askName();
      if (!name || !this.alive) return;
      this.menuSay('방을 만드는 중이에요…');
      const result = await api.openRoom('hula', name, readHulaView, friendStore.id());
      if (!this.alive) return;
      if (!result.ok) return this.menuFail(result.reason);
      const { token, room } = result.data;
      savedRoom.set('hula', room.code, token);
      this.scene.restart({ room: { code: room.code, token, view: room } } satisfies HulaStart);
    });
  }

  private joinByCode(): void {
    void whileBlocked(this, async () => {
      if (navigator.onLine === false) return this.menuFail('offline');
      const asked = await promptText({
        title: '방 코드',
        hint: '친구가 보낸 여섯 글자를 넣어 주세요.',
        placeholder: 'ABC-DEF',
        maxLength: 9,
        code: true,
        confirmLabel: '다음',
        check: (value) => {
          const code = cleanRoomCode(value);
          return code === null ? { error: '여섯 글자 코드를 다시 확인해 주세요.' } : { value: code };
        },
      });
      if (asked.action !== 'confirm' || !this.alive) return;
      const name = await this.askName();
      if (!name || !this.alive) return;
      this.menuSay('방에 들어가는 중이에요…');
      const result = await api.joinRoom(asked.value, name, readHulaView, friendStore.id());
      if (!this.alive) return;
      if (!result.ok) {
        if (result.reason === 'notfound') this.menuSay('없는 방이거나 이미 둘이 들어간 방이에요.\n코드를 다시 확인해 주세요.', true);
        else this.menuFail(result.reason);
        return;
      }
      const { token, room } = result.data;
      savedRoom.set('hula', room.code, token);
      this.scene.restart({ room: { code: room.code, token, view: room } } satisfies HulaStart);
    });
  }

  /** 온라인 방에 들어간다. view가 없으면(앱을 다시 열어 돌아온 경우) 서버에 방을 한 번 물어본다. */
  private connectRoom(code: string, token: string, view: RoomView<HulaView> | null): void {
    this.mode = 'room';
    if (view) {
      this.attachOnline(token, view);
      return;
    }
    this.drawScreenHeader('방으로 돌아가는 중');
    this.status = this.screen(addText(this, GAME_WIDTH / 2, this.scale.height / 2, '방에 다시 들어가는 중이에요…', { size: 11, color: PX_CSS.text, originX: 0.5, originY: 0.5, align: 'center', wrapWidth: WIDTH - 8 }));
    void api.lookRoom(code, token, 0, readHulaView).then((result) => {
      if (!this.alive) return;
      if (result.ok && result.data !== 'same') {
        this.clearScreen();
        this.attachOnline(token, result.data);
        return;
      }
      if (!result.ok && result.reason === 'notfound') savedRoom.clear();
      this.say(
        !result.ok && result.reason !== 'notfound'
          ? failureText(result.reason)
          : '방이 닫혔어요.\n30분 동안 아무도 두지 않으면 방이 사라져요.',
        true,
      );
    });
  }

  private attachOnline(token: string, view: RoomView<HulaView>): void {
    const match = new OnlineMatch<HulaView, HulaMove>(api, token, view, readHulaView, (room) => room.game?.round.turn === 'me');
    this.match = match;
    match.onChange(() => this.onRoomChange());
    // 다른 앱에 다녀오면 바로 소식을 묻는다(기다리는 동안 앱이 잠들어 묻지 못했을 수 있다).
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void match.poll();
    };
    document.addEventListener('visibilitychange', onVisible);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => document.removeEventListener('visibilitychange', onVisible));
    this.awayBanner = new AwayBanner(this, () => ({ match: this.match as Match<unknown, unknown> | null, foe: this.foeName, poll: () => void match.poll() }), this.layout.tableTop + 6, 30);
    this.onRoomChange();
  }

  /** 한 폰으로 번갈아 하기. 인터넷 없이 된다. */
  private startLocal(): void {
    this.match = new LocalMatch(hulaVersus, LOCAL_NAMES);
    this.match.onChange(() => this.onRoomChange());
    this.onRoomChange();
  }

  /**
   * 씬을 떠날 때(그만하기, 나가기, 허브로). 온라인 방이면 방을 나간다. 판을 하는 중에 나가면 진 판으로 센다
   * (친구 쪽에서는 이긴 판이 된다).
   */
  private closeFriends(): void {
    this.alive = false;
    this.rematch?.stop();
    const match = this.match;
    if (!match) return;
    if (match.kind === 'online' && !this.reopening) {
      const room = match.room;
      // 친구가 자리를 비운 사이에 나가면 친구가 판을 버린 것으로 친다(서버도 그렇게 센다).
      if (room.status === 'playing') this.countFriend(room, match.awayUntil !== null, roundKey(room, 1));
      // 같이 한 판이라도 했으면, 친구와 온라인 화면에서 같은 방으로 다시 부를 수 있게 적어 둔다.
      const online = match as OnlineMatch<HulaView, HulaMove>;
      if (room.names[1] !== null && room.game !== null && (room.status !== 'closed' || online.reopenable)) {
        friendStore.setRematch('hula', room.code, online.token, room.names[foeSeat(room)] ?? '친구');
      }
      if (room.status !== 'closed') match.leave();
      savedRoom.clear();
    }
    match.stop();
  }

  /** 방에서 나가 방 고르기(온라인) 또는 준비 화면(한 폰)으로 간다. */
  private exitFriends(): void {
    const online = this.match?.kind === 'online' || this.mode === 'room';
    this.scene.restart((online ? { friends: 'menu' } : {}) satisfies HulaStart);
  }

  private screen<T extends Phaser.GameObjects.GameObject>(object: T): T {
    this.screenLayer.push(object);
    return object;
  }

  private clearScreen(): void {
    for (const object of this.screenLayer) object.destroy();
    this.screenLayer = [];
  }

  /** 판이 아닌 화면의 머리: 나가기 버튼과 제목 */
  private drawScreenHeader(title: string): void {
    const back = new PxButton(this, { x: MARGIN, y: 8, width: 26, height: 26, icon: TEX.back_arrow, hitPadding: 6, onTap: () => this.exitFriends() });
    this.screen({ destroy: () => back.destroy() } as unknown as Phaser.GameObjects.GameObject);
    this.screen(addText(this, 42, 21, title, { size: 15, color: PX_CSS.accent, originY: 0.5 }));
  }

  /** 방이 바뀌었을 때(친구가 두었거나 들어왔거나 나갔을 때, 내가 둔 뒤에) 화면을 맞춘다. */
  private onRoomChange(): void {
    const match = this.match;
    if (!match || !this.alive) return;
    const room = match.room;
    this.awayBanner?.refresh();
    if (match.kind === 'online') {
      if (room.status === 'closed') savedRoom.clear();
      else savedRoom.set('hula', room.code, (match as OnlineMatch<HulaView, HulaMove>).token);
    }
    if (room.status === 'waiting') {
      this.showWaiting(room);
      return;
    }
    if (room.status === 'closed') {
      this.showClosed(room);
      return;
    }
    if (this.closedShown && match.kind === 'online') {
      // 닫혔던 방을 누군가 "다시 하자"로 다시 열었다. 화면을 처음부터 다시 그린다.
      this.reopening = true;
      this.scene.restart({ room: { code: room.code, token: (match as OnlineMatch<HulaView, HulaMove>).token, view: room } } satisfies HulaStart);
      return;
    }
    if (room.status === 'over' && room.rematch) {
      this.showRematch(room);
      return;
    }
    const view = room.game;
    if (!view) return;
    if (!this.roundBuilt) {
      this.clearScreen();
      this.mode = 'round';
      this.playing = true;
      this.buildRound('');
    }
    // 한 판 더: 지난 판의 결과 판을 치우고 새 판을 그린다.
    if (room.status === 'playing' && this.mode === 'over') this.resetFriendRound();
    this.state = view.round;
    this.subLabel?.setText(this.scoreLine(room));
    this.noteTheirs(view);

    const handOff = match.kind === 'local' && room.status === 'playing' && this.shownSeat !== room.seat;
    this.render();
    if (room.status === 'over') {
      if (this.settledRound !== room.version) this.endFriendRound(room);
      else this.updateAgain(room);
    } else if (handOff) {
      this.shownSeat = room.seat;
      this.showCover(room);
    }
    if (match.trouble && room.status === 'playing') this.say(`${failureText(match.trouble)}\n다시 잇는 중이에요…`, true);
  }

  /** 제목 아래의 이긴 판 수. 한 폰이면 1P와 2P의 차례 그대로, 온라인이면 나와 친구 */
  private scoreLine(room: RoomView<HulaView>): string {
    if (this.match?.kind === 'local') return `${room.names[0]} ${room.wins[0]} : ${room.wins[1]} ${room.names[1] ?? ''}`;
    const foe = foeSeat(room);
    return `나 ${room.wins[room.seat]} : ${room.wins[foe]} ${shortName(room.names[foe] ?? '친구', 6)}`;
  }

  /** 상대가 마지막 차례에 한 일이 바뀌었으면, 그 카드를 빛나게 하고 한 줄로 알린다. */
  private noteTheirs(view: HulaView): void {
    const key = JSON.stringify(view.theirs);
    if (key === this.theirsKey) return;
    this.theirsKey = key;
    const steps = view.theirs;
    const last = steps[steps.length - 1];
    if (!last) return;
    this.fresh.clear();
    for (const step of steps) for (const card of stepCards(step)) this.fresh.add(card);
    this.foeNote = describeStep(this.foeName, last);
    if (this.match?.kind === 'online') {
      if (last.type === 'meld' || last.type === 'layoff') sfx.coin();
      else sfx.flip();
    }
  }

  /** 보낸 수를 기다렸다가, 받아들여졌으면 done으로 화면을 맞춘다. 받지 않았으면 거절음을 낸다. */
  private sendMove(move: HulaMove, done: () => void): void {
    const match = this.match;
    if (!match || this.sending || this.covered) return;
    this.sending = true;
    void match.send(move).then((ok) => {
      this.sending = false;
      if (!this.alive || this.match !== match) return;
      if (!ok) {
        sfx.deny();
        this.render();
        if (match.trouble) this.say(`${failureText(match.trouble)}\n다시 눌러 주세요`, true);
        return;
      }
      done();
      this.render();
    });
  }

  /** 친구를 기다리는 화면: 방 코드와 보내기 버튼 */
  private showWaiting(room: RoomView<HulaView>): void {
    if (this.screenLayer.length > 0) {
      const trouble = this.match?.trouble;
      this.say(trouble ? `${failureText(trouble)}\n다시 잇는 중이에요…` : '친구가 들어오기를 기다리는 중…', trouble != null);
      return;
    }
    const { height } = this.scale;
    this.drawScreenHeader('방을 만들었어요');
    const top = 56;
    const g = this.screen(this.add.graphics());
    pxBox(g, MARGIN, top, WIDTH, 112, PX.charcoal, PX.yellow);
    this.screen(addText(this, GAME_WIDTH / 2, top + 12, '방 코드', { size: 11, color: PX_CSS.sub, originX: 0.5 }));
    this.screen(addText(this, GAME_WIDTH / 2, top + 30, formatRoomCode(room.code), { size: 30, color: PX_CSS.accent, originX: 0.5 }));
    this.screen(addText(this, GAME_WIDTH / 2, top + 78, '친구에게 이 코드를 보내 주세요.\n친구가 들어오면 바로 시작해요.', { size: 10, color: PX_CSS.text, originX: 0.5, align: 'center' }));

    const send = new PxButton(this, {
      x: MARGIN,
      y: top + 124,
      width: WIDTH,
      height: 36,
      label: '코드 보내기',
      style: 'gold',
      onTap: () => void this.shareCode(room.code),
    });
    this.screen({ destroy: () => send.destroy() } as unknown as Phaser.GameObjects.GameObject);
    const close = new PxButton(this, {
      x: MARGIN,
      y: top + 168,
      width: WIDTH,
      height: 30,
      label: '방 닫기',
      size: 11,
      onTap: () => this.exitFriends(),
    });
    this.screen({ destroy: () => close.destroy() } as unknown as Phaser.GameObjects.GameObject);
    this.status = this.screen(addText(this, GAME_WIDTH / 2, Math.min(height - 40, top + 216), '친구가 들어오기를 기다리는 중…', { size: 11, color: PX_CSS.text, originX: 0.5, align: 'center', wrapWidth: WIDTH - 8 }));
    // 기다리는 동안 점 세 개가 깜빡인다.
    const dots = this.screen(addText(this, GAME_WIDTH / 2, Math.min(height - 22, top + 236), '●  ●  ●', { size: 10, color: PX_CSS.faint, originX: 0.5 }));
    this.tweens.add({ targets: dots, alpha: 0.25, duration: 700, yoyo: true, repeat: -1 });
  }

  /**
   * 다시 연 방에서 새 판을 기다리는 화면: 누구와 하는지, 지금까지의 전적, "한 판 더"와 "나가기".
   * 판은 닫히기 전의 것이라(끝나지 않았을 수도 있다) 그리지 않는다. 둘 다 누르면 새 판이 시작된다.
   */
  private showRematch(room: RoomView<HulaView>): void {
    this.mode = 'room';
    this.clearScreen();
    const { height } = this.scale;
    const foe = this.foeName;
    const mine = room.again[room.seat];
    const theirs = room.again[foeSeat(room)];
    this.drawScreenHeader('다시 하자');
    const top = 56;
    pxBox(this.screen(this.add.graphics()), MARGIN, top, WIDTH, 112, PX.charcoal, PX.yellow);
    this.screen(addText(this, GAME_WIDTH / 2, top + 12, '훌라 · 같은 방', { size: 11, color: PX_CSS.sub, originX: 0.5 }));
    this.screen(addText(this, GAME_WIDTH / 2, top + 32, `${withAnd(shortName(foe, 8))} 한 판 더`, { size: 20, color: PX_CSS.accent, originX: 0.5 }));
    this.screen(addText(this, GAME_WIDTH / 2, top + 66, `이 방에서 ${this.scoreLine(room)}`, { size: 10, color: PX_CSS.text, originX: 0.5 }));
    const record = friendStore.versus('hula', room as RoomView<unknown>);
    this.screen(addText(this, GAME_WIDTH / 2, top + 84, `${withAnd(shortName(foe, 6))} 전적 ${recordText(record)}`, { size: 10, color: PX_CSS.sub, originX: 0.5 }));
    let y = top + 124;
    this.againButton = null;
    if (!mine) {
      const again = new PxButton(this, { x: MARGIN, y, width: WIDTH, height: 36, label: '한 판 더', style: 'green', onTap: () => this.askAgain() });
      this.againButton = again;
      this.screen({ destroy: () => again.destroy() } as unknown as Phaser.GameObjects.GameObject);
      y += 44;
    }
    const out = new PxButton(this, { x: MARGIN, y, width: WIDTH, height: 30, label: '나가기', size: 11, onTap: () => this.exitFriends() });
    this.screen({ destroy: () => out.destroy() } as unknown as Phaser.GameObjects.GameObject);
    const trouble = this.match?.trouble;
    const line = trouble
      ? `${failureText(trouble)}\n다시 잇는 중이에요…`
      : mine
        ? `${withSubject(foe)} 한 판 더를 누르면 시작해요`
        : theirs
          ? `${withSubject(foe)} 다시 하재요!`
          : '';
    this.status = this.screen(addText(this, GAME_WIDTH / 2, Math.min(height - 40, y + 48), line, { size: 11, color: trouble ? PX_CSS.bad : theirs && !mine ? PX_CSS.good : PX_CSS.text, originX: 0.5, align: 'center', wrapWidth: WIDTH - 8 }));
    if (mine) {
      const dots = this.screen(addText(this, GAME_WIDTH / 2, Math.min(height - 22, y + 68), '●  ●  ●', { size: 10, color: PX_CSS.faint, originX: 0.5 }));
      this.tweens.add({ targets: dots, alpha: 0.25, duration: 700, yoyo: true, repeat: -1 });
    }
  }

  /** 방 코드를 메신저로 보낸다. 보내기를 못 하는 브라우저면 복사할 수 있게 크게 보여 준다. */
  private async shareCode(code: string): Promise<void> {
    const text = `포켓 아케이드에서 훌라 같이 해요! 방 코드: ${formatRoomCode(code)}`;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ text, url: `${location.origin}${location.pathname}` });
        return;
      } catch (error) {
        // 보내기 창을 닫은 것이면 그대로 둔다.
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    await showCode({ title: '방 코드', code: formatRoomCode(code), hint: '복사해서 친구에게 보내 주세요.' });
  }

  /** 방이 닫혔을 때: 친구가 나갔거나, 오래 두지 않아 방이 사라졌다. */
  private showClosed(room: RoomView<HulaView>): void {
    const wasPlaying = this.mode === 'round';
    if (this.closedShown) return;
    this.closedShown = true;
    const online = this.match?.kind === 'online' ? (this.match as OnlineMatch<HulaView, HulaMove>) : null;
    // 다시 열 수 있는 방이면 소식 묻기를 멈추지 않는다: 친구가 먼저 "다시 하자"를 누르면 곧바로 알게 된다.
    const reopenable = online?.reopenable === true;
    if (!reopenable) this.match?.stop();
    const closed = closedText(room, this.foeName, wasPlaying);
    const { title, foeLeft, meDropped } = closed;
    const note = reopenable && !wasPlaying ? '다시 하자를 누르면 같은 방으로 불러요' : closed.note;
    if (wasPlaying && online && (foeLeft || meDropped)) this.countFriend(room, foeLeft);
    const half = Math.floor((WIDTH - 40 - 6) / 2);

    if (!this.roundBuilt) {
      this.clearScreen();
      this.drawScreenHeader('방이 닫혔어요');
      this.status = this.screen(addText(this, GAME_WIDTH / 2, this.scale.height / 2 - 20, `${title}\n${note}`, { size: 11, color: PX_CSS.text, originX: 0.5, originY: 0.5, align: 'center', wrapWidth: WIDTH - 8 }));
      if (reopenable) {
        const again = new PxButton(this, { x: MARGIN, y: this.scale.height / 2 + 20, width: WIDTH, height: 34, label: '다시 하자', style: 'green', onTap: () => this.askReopen() });
        this.againButton = again;
        this.screen({ destroy: () => again.destroy() } as unknown as Phaser.GameObjects.GameObject);
      }
      const out = new PxButton(this, { x: MARGIN, y: this.scale.height / 2 + (reopenable ? 62 : 20), width: WIDTH, height: reopenable ? 30 : 34, label: '나가기', onTap: () => this.exitFriends() });
      this.screen({ destroy: () => out.destroy() } as unknown as Phaser.GameObjects.GameObject);
      return;
    }
    this.mode = 'over';
    this.playing = false;
    this.hideCover();
    this.meldButton.setEnabled(false);
    this.discardButton.setEnabled(false);
    this.sortButton.setEnabled(false);
    for (const object of this.endLayer) object.destroy();
    this.endLayer = [];
    this.againButton = null;
    const { tableTop, tableBottom } = this.layout;
    const boxHeight = 96;
    const boxTop = Math.round((tableTop + tableBottom) / 2 - boxHeight / 2);
    const g = this.end(this.add.graphics().setDepth(20));
    pxBox(g, MARGIN + 10, boxTop, WIDTH - 20, boxHeight, PX.charcoal, PX.slate);
    this.end(addText(this, GAME_WIDTH / 2, boxTop + 10, title, { size: 15, color: PX_CSS.text, originX: 0.5 }).setDepth(21));
    this.end(addText(this, GAME_WIDTH / 2, boxTop + 32, note, { size: 10, color: PX_CSS.sub, originX: 0.5 }).setDepth(21));
    if (reopenable) {
      const again = new PxButton(this, { x: MARGIN + 20, y: boxTop + boxHeight - 44, width: half, height: 32, label: '다시 하자', style: 'green', onTap: () => this.askReopen() }).setDepth(22);
      this.againButton = again;
      this.end({ destroy: () => again.destroy() } as unknown as Phaser.GameObjects.GameObject);
    }
    const out = new PxButton(this, {
      x: reopenable ? MARGIN + WIDTH - 20 - half : MARGIN + 20,
      y: boxTop + boxHeight - 44,
      width: reopenable ? half : WIDTH - 40,
      height: 32,
      label: '나가기',
      onTap: () => this.exitFriends(),
    }).setDepth(22);
    this.end({ destroy: () => out.destroy() } as unknown as Phaser.GameObjects.GameObject);
    this.say(title, foeLeft);
  }

  /** 방이 닫힌 것을 이미 알렸는지 */
  private closedShown = false;
  /** 친구가 자리를 비웠을 때 남은 초를 세는 띠(온라인 방에서만) */
  awayBanner: AwayBanner | null = null;

  private end<T extends Phaser.GameObjects.GameObject>(object: T): T {
    this.endLayer.push(object);
    return object;
  }

  /** 친구와의 판이 끝났다: 결과 판에 "한 판 더"와 "나가기"를 둔다. */
  private endFriendRound(room: RoomView<HulaView>): void {
    const state = this.state;
    const result = state?.result;
    const match = this.match;
    if (!state || !result || !match) return;
    this.settledRound = room.version;
    this.mode = 'over';
    this.playing = false;
    this.selected = [];
    this.hideCover();
    this.render();
    this.meldButton.setEnabled(false);
    this.discardButton.setEnabled(false);
    this.sortButton.setEnabled(false);

    const won = result.winner === null ? null : result.winner === 'me';
    if (match.kind === 'online') this.countFriend(room, won);
    const me = this.myName;
    const foe = this.foeName;
    const local = match.kind === 'local';
    const winner = won ? me : foe;
    const title =
      won === null
        ? '비겼어요'
        : local
          ? `${withSubject(winner)} 이겼어요!${result.how === 'hula' ? ' 훌라!' : ''}`
          : won
            ? result.how === 'hula'
              ? '훌라! 이겼어요'
              : '이겼어요!'
            : result.how === 'hula'
              ? `${shortName(foe, 6)}의 훌라!`
              : '졌어요';
    const how = result.how === 'stock' ? '덱이 떨어져 남은 숫자를 견줬어요' : `${withSubject(won === false ? foe : me)} 카드를 다 냈어요`;
    const extra: string[] = [];
    if (result.how === 'hula') extra.push('훌라 ×2');
    if (result.shutout) extra.push('박 ×2');

    const { tableTop, tableBottom } = this.layout;
    const online = match.kind === 'online';
    const boxHeight = online ? 130 : 118;
    const boxTop = Math.max(tableTop + 2, Math.round((tableTop + tableBottom) / 2 - boxHeight / 2));
    const g = this.end(this.add.graphics().setDepth(20));
    const bright = local ? won !== null : won === true;
    pxBox(g, MARGIN + 10, boxTop, WIDTH - 20, boxHeight, PX.charcoal, bright ? PX.yellow : PX.slate);
    this.end(addText(this, GAME_WIDTH / 2, boxTop + 9, title, {
      size: 16,
      color: bright ? PX_CSS.accent : won === null ? PX_CSS.text : PX_CSS.bad,
      originX: 0.5,
    }).setDepth(21));
    this.end(addText(this, GAME_WIDTH / 2, boxTop + 31, how, { size: 10, color: PX_CSS.sub, originX: 0.5 }).setDepth(21));
    this.end(addText(this, GAME_WIDTH / 2, boxTop + 46, `남은 숫자  ${shortName(me, 4)} ${result.left.me} · ${shortName(foe, 4)} ${result.left.cpu}${extra.length ? `  ${extra.join(' ')}` : ''}`, {
      size: 10,
      color: PX_CSS.text,
      originX: 0.5,
    }).setDepth(21));
    if (online) {
      const versus = `${withAnd(shortName(foe, 6))} 전적 ${recordText(friendStore.versus('hula', room as RoomView<unknown>))}`;
      this.end(addText(this, GAME_WIDTH / 2, boxTop + 61, versus, { size: 9, color: PX_CSS.sub, originX: 0.5 }).setDepth(21));
    }
    const half = Math.floor((WIDTH - 40 - 6) / 2);
    const again = new PxButton(this, {
      x: MARGIN + 20,
      y: boxTop + boxHeight - 46,
      width: half,
      height: 34,
      label: '한 판 더',
      style: 'green',
      onTap: () => this.askAgain(),
    }).setDepth(22);
    const out = new PxButton(this, {
      x: MARGIN + WIDTH - 20 - half,
      y: boxTop + boxHeight - 46,
      width: half,
      height: 34,
      label: '나가기',
      onTap: () => this.exitFriends(),
    }).setDepth(22);
    this.againButton = again;
    this.end({ destroy: () => again.destroy() } as unknown as Phaser.GameObjects.GameObject);
    this.end({ destroy: () => out.destroy() } as unknown as Phaser.GameObjects.GameObject);

    if (bright) {
      sfx.gold();
      vibrate([20, 40, 20]);
    } else {
      sfx.finish();
    }
    this.say(local ? '한 판 더 하면 먼저 하는 사람이 바뀌어요' : won ? '친구에게 이겼어요!' : '다음 판엔 이겨 봐요', !local && won === false);
    this.updateAgain(room);
  }

  /** "한 판 더"를 누른 사람을 알린다. 온라인에서는 둘 다 눌러야 시작한다. */
  private updateAgain(room: RoomView<HulaView>): void {
    if (this.match?.kind !== 'online' || room.status !== 'over') return;
    const mine = room.again[room.seat];
    const theirs = room.again[foeSeat(room)];
    if (mine) {
      this.againButton?.setEnabled(false).setLabel('기다리는 중');
      this.say(`${withSubject(this.foeName)} 한 판 더를 누르면 시작해요`);
    } else if (theirs) {
      this.say(`${withSubject(this.foeName)} 한 판 더 하고 싶어 해요!`);
    }
  }

  private askAgain(): void {
    const match = this.match;
    if (!match) return;
    this.againButton?.setEnabled(false);
    void match.again().then(() => {
      if (!this.alive || this.match !== match) return;
      if (match.trouble) {
        this.againButton?.setEnabled(true);
        this.say(failureText(match.trouble), true);
      }
    });
  }

  /** 친구가 나가 닫힌 방에서 "다시 하자": 같은 방을 다시 열고 친구가 한 판 더를 누르기를 기다린다. */
  private askReopen(): void {
    const match = this.match;
    if (!match) return;
    this.againButton?.setEnabled(false).setLabel('부르는 중');
    void match.again().then(() => {
      if (!this.alive || this.match !== match) return;
      // 다시 열렸으면 onRoomChange가 화면을 다시 그린다. 여기까지 왔으면 열지 못한 것이다.
      if (match.room.status !== 'closed') return;
      if (match.trouble) {
        this.againButton?.setEnabled(true).setLabel('다시 하자');
        this.say(failureText(match.trouble), true);
      } else {
        this.againButton?.setEnabled(false).setLabel('방이 사라졌어요');
      }
    });
  }

  /** 한 판 더: 결과 판을 치우고 새 판을 시작할 준비를 한다. */
  private resetFriendRound(): void {
    for (const object of this.endLayer) object.destroy();
    this.endLayer = [];
    this.againButton = null;
    this.mode = 'round';
    this.playing = true;
    this.selected = [];
    this.drawn = null;
    this.fresh.clear();
    this.foeNote = null;
    this.shownSeat = null;
    this.sortButton.setEnabled(true);
  }

  /** 한 폰으로 할 때 차례가 바뀌면 패를 가리고, 다음 사람에게 폰을 넘기게 한다. */
  private showCover(room: RoomView<HulaView>): void {
    this.hideCover();
    this.covered = true;
    const { height } = this.scale;
    const name = room.names[room.seat] ?? '';
    const keep = <T extends Phaser.GameObjects.GameObject>(object: T): T => {
      this.coverLayer.push(object);
      return object;
    };
    const g = keep(this.add.graphics().setDepth(40));
    g.fillStyle(PX.ink, 1);
    g.fillRect(0, 0, GAME_WIDTH, height);
    const mid = Math.round(height / 2);
    keep(this.add.image(GAME_WIDTH / 2 - 10, mid - 70, TEX.back).setAngle(-8).setDepth(41));
    keep(this.add.image(GAME_WIDTH / 2 + 10, mid - 68, TEX.back).setAngle(8).setDepth(41));
    keep(addText(this, GAME_WIDTH / 2, mid - 26, `${name} 차례예요`, { size: 20, color: PX_CSS.accent, originX: 0.5 }).setDepth(41));
    keep(addText(this, GAME_WIDTH / 2, mid + 4, `폰을 ${name}에게 넘겨 주세요`, { size: 12, color: PX_CSS.text, originX: 0.5 }).setDepth(41));
    if (this.foeNote) {
      keep(addText(this, GAME_WIDTH / 2, mid + 28, this.foeNote, { size: 10, color: PX_CSS.sub, originX: 0.5, align: 'center', wrapWidth: WIDTH - 16 }).setDepth(41));
    }
    keep(addText(this, GAME_WIDTH / 2, height - 40, '화면을 누르면 내 패가 보여요', { size: 11, color: PX_CSS.good, originX: 0.5 }).setDepth(41));
    const zone = keep(this.add.zone(0, 0, GAME_WIDTH, height).setOrigin(0, 0).setDepth(42).setInteractive({ useHandCursor: true }));
    zone.once(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, () => {
      sfx.click();
      this.hideCover();
    });
  }

  private hideCover(): void {
    for (const object of this.coverLayer) object.destroy();
    this.coverLayer = [];
    this.covered = false;
  }

  // ───────── 판의 끝 ─────────

  private endRound(): void {
    const state = this.state;
    const result = state?.result;
    if (!state || !result || this.mode === 'over') return;
    this.mode = 'over';
    this.selected = [];
    this.render();
    this.meldButton.setEnabled(false);
    this.discardButton.setEnabled(false);
    this.sortButton.setEnabled(false);

    const won = result.winner === null ? null : result.winner === 'me';
    const record = hulaStore.addResult(this.level, won);
    const score = roundScore(result, this.level);

    const title = won === null ? '비겼어요' : won ? (result.how === 'hula' ? '훌라! 이겼어요' : '이겼어요!') : result.how === 'hula' ? '컴퓨터의 훌라!' : '졌어요';
    const how =
      result.how === 'stock'
        ? '덱이 떨어져 남은 숫자를 견줬어요'
        : won
          ? '손의 카드를 다 냈어요'
          : '컴퓨터가 카드를 다 냈어요';
    const extra: string[] = [];
    if (result.how === 'hula') extra.push('훌라 ×2');
    if (result.shutout) extra.push('박 ×2');

    // 가운데에 결과 판
    const { tableTop, tableBottom } = this.layout;
    const boxHeight = 74;
    const boxTop = Math.round((tableTop + tableBottom) / 2 - boxHeight / 2);
    const g = this.add.graphics().setDepth(20);
    pxBox(g, MARGIN + 10, boxTop, WIDTH - 20, boxHeight, PX.charcoal, won ? PX.yellow : PX.slate);
    addText(this, GAME_WIDTH / 2, boxTop + 10, title, {
      size: 17,
      color: won ? PX_CSS.accent : won === null ? PX_CSS.text : PX_CSS.bad,
      originX: 0.5,
    }).setDepth(21);
    addText(this, GAME_WIDTH / 2, boxTop + 34, how, { size: 10, color: PX_CSS.sub, originX: 0.5 }).setDepth(21);
    addText(this, GAME_WIDTH / 2, boxTop + 50, `남은 숫자  나 ${result.left.me} · 컴퓨터 ${result.left.cpu}${extra.length ? `  ${extra.join(' ')}` : ''}`, {
      size: 10,
      color: PX_CSS.text,
      originX: 0.5,
    }).setDepth(21);
    this.say(won ? `${score}점을 얻었어요` : '다음 판엔 이겨 봐요', !won);
    if (won) {
      sfx.gold();
      vibrate([20, 40, 20]);
    }

    const r = record.records[this.level];
    const outcome = won === null ? '비김' : won ? (result.how === 'hula' ? '승리 (훌라)' : '승리') : '패배';
    const stats: ResultStat[] = [
      ['결과', `${outcome} · ${LEVEL_NAME[this.level]}`],
      ['남은 숫자', `나 ${result.left.me} · 컴퓨터 ${result.left.cpu}`],
      [`${LEVEL_NAME[this.level]} 전적`, `${r.wins}승 ${r.losses}패`],
    ];
    this.finishMiniGame(score, stats, 2400);
  }
}

/** 판이 끝났는지. 규칙 함수가 상태를 바꾼 뒤에 읽으므로 TypeScript의 좁히기를 피해 함수로 묻는다. */
function isOver(state: HulaState): boolean {
  return state.phase === 'over';
}

const TABLE_PAD = 3;
const TABLE_GAP = 4;

/**
 * 탁자에 묶음들을 왼쪽 위부터 줄지어 놓을 자리. 카드 크기는 scale배(1이면 탁자용 작은 카드, 2면 손패 크기)다.
 * 탁자에 다 들어가지 않으면 null이다(force면 넘쳐도 자리를 돌려준다).
 */
function placeMelds(
  lengths: readonly number[],
  scale: number,
  top: number,
  bottom: number,
  force = false,
): { scale: number; spots: { x: number; y: number; width: number }[] } | null {
  const h = MINI.h * scale + TABLE_PAD * 2;
  const left = MARGIN + 5;
  const right = MARGIN + WIDTH - 4;
  let x = left;
  let y = top + 5;
  const spots: { x: number; y: number; width: number }[] = [];
  for (const length of lengths) {
    const width = MINI.w * scale + MINI_STEP * scale * (length - 1) + TABLE_PAD * 2;
    if (x + width > right && x > left) {
      x = left;
      y += h + TABLE_GAP;
    }
    spots.push({ x, y, width });
    x += width + TABLE_GAP;
  }
  if (!force && y + h > bottom - 4) return null;
  return { scale, spots };
}

/** 상대가 한 일에서 탁자나 더미에 새로 놓인 카드 */
function stepCards(step: HulaStep): number[] {
  if (step.type === 'meld') return step.cards;
  if (step.type === 'layoff' || step.type === 'discard') return [step.card];
  return [];
}

/** 상대가 한 일을 한 줄로 */
function describeStep(name: string, step: HulaStep): string {
  const who = withSubject(name);
  switch (step.type) {
    case 'draw':
      return `${who} 덱에서 한 장 뽑았어요`;
    case 'take':
      return step.card === undefined ? `${who} 버린 카드를 가져갔어요` : `${who} 버린 ${cardName(step.card)}${objectMark(step.card)} 가져갔어요`;
    case 'meld':
      return `${who} 등록했어요`;
    case 'layoff':
      return `${who} ${cardName(step.card)}${objectMark(step.card)} 붙였어요`;
    case 'discard':
      return `${who} ${cardName(step.card)}${objectMark(step.card)} 버렸어요`;
  }
}
