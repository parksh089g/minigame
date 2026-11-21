import Phaser from 'phaser';
import { GAME_WIDTH } from '../../config';
import { vibrate } from '../../core/haptics';
import { homeScene } from '../../core/home';
import { sfx } from '../../core/sfx';
import { addTapZone, addText, fadeToScene } from '../../core/ui';
import { MiniGameScene, type ResultStat } from '../../scenes/MiniGameScene';
import { CARD, cardTexture, MINI, PX, PX_CSS, registerHulaTextures, TEX } from './art';
import { chooseDraw, choosePlay } from './bot';
import { byRank, bySuit, cardName, objectMark } from './cards';
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

/** 씬을 열 때 넘기는 값. level이 있으면 준비 화면을 건너뛰고 바로 그 난이도로 시작한다(결과 화면의 "다시 하기"). */
export interface HulaStart {
  level?: Level;
}

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

type Mode = 'lobby' | 'round' | 'over';

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
    if (data.level && LEVELS.includes(data.level)) this.startRound(data.level);
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

    const rulesTop = rowsTop + 18 + 3 * (rowHeight + 6) + 4;
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
    else this.pauseGame();
  }

  protected override pauseGame(): void {
    if (this.mode !== 'round') return;
    super.pauseGame();
  }

  protected override restartLabel(): string | null {
    return '상대 다시 고르기';
  }

  protected override quitWarning(): string | null {
    return this.mode === 'round' ? '지금 판은 진 것으로 치지 않고 사라져요' : null;
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

    const pause = new PxButton(this, { x: MARGIN, y: 8, width: 26, height: 26, icon: TEX.pause, hitPadding: 6, onTap: () => this.pauseGame() });
    pause.setDepth(5);
    addText(this, 42, 14, '훌라', { size: 14, color: PX_CSS.text, originY: 0.5 });
    addText(this, 42, 29, `컴퓨터 · ${LEVEL_NAME[level]}`, { size: 9, color: PX_CSS.sub, originY: 0.5 });
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

    this.render();
    if (this.state.turn === 'cpu') this.time.delayedCall(700, () => this.cpuTurn());
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
    this.cpuLabel.setText(`${hand.length}장`);
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
    if (state.turn === 'cpu') return;
    if (state.phase === 'draw') {
      this.say(canTakeDiscard(state, 'me') ? '덱이나 버린 카드를 눌러 한 장 가져와요' : '덱을 눌러 한 장 뽑아요');
      return;
    }
    if (state.taken !== null && !this.selected.includes(state.taken)) {
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
