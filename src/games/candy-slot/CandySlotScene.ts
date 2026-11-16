import Phaser from 'phaser';
import { TEXTURE } from '../../art/sprites';
import { FONT_SIZE, GAME_WIDTH, SCENE, THEME } from '../../config';
import { vibrate } from '../../core/haptics';
import { reducedMotion } from '../../core/motion-guard';
import { sfx, tone } from '../../core/sfx';
import { addTapZone, addText, drawPanel } from '../../core/ui';
import { floatText, GameHud, HUD_HEIGHT, showBanner } from '../../scenes/GameHud';
import { MiniGameScene, type ResultStat, type ResultStrip } from '../../scenes/MiniGameScene';
import type { SharedStart, ShareOverride } from '../../share/link';
import {
  COIN_ICON,
  coinTexture,
  CHARM_BOX,
  charmChipTexture,
  charmTexture,
  drawBulbs,
  drawFelt,
  drawMachine,
  emptySlotTexture,
  LOOK,
  MINI_BOX,
  miniSymbolTexture,
  SYMBOL_BOX,
  symbolColor,
  symbolTexture,
} from './art';
import {
  addDailyRun,
  DAILY_LABEL,
  dailyDayOf,
  dailyInfo,
  dailySeed,
  dailyShare,
  dailyToday,
  dailyVerdict,
  dayIndexOf,
  friendNotice,
  friendScoreOf,
  friendVerdict,
  SHARED_DAY_PASSED,
} from './daily';
import { slotDailyStore } from './daily-store';
import {
  buy,
  buyBlock,
  CELLS,
  charmOf,
  clearedRounds,
  discard,
  layoutFor,
  LINES,
  MACHINE_FRAME,
  newRun,
  nextRound,
  oddsOf,
  randomOf,
  OFFERS,
  reroll,
  scoreOf,
  settleRound,
  SHOP_HEAD,
  SHOP_ROW,
  SIZE,
  SLOTS,
  spin,
  spinsOf,
  SYMBOLS,
  targetOf,
  valuesOf,
  type Box,
  type Boost,
  type Layout,
  type LineWin,
  type RunState,
  type SpinOutcome,
} from './rules';

// ───────── 움직임 ─────────

/** 돌아가는 칸의 그림이 바뀌는 간격(ms). 움직임을 줄인 기기에서는 천천히 바뀐다. */
const FLICK_MS = 55;
const FLICK_CALM_MS = 180;
/** 첫 열이 멈출 때까지의 시간과, 그 뒤로 열마다 늦게 멈추는 시간(ms) */
const STOP_FIRST_MS = 360;
const STOP_STEP_MS = 190;
/** 몸통의 전구가 켜진 것과 꺼진 것을 바꾸는 간격 */
const BULB_MS = 480;
/** 맞은 줄을 하나씩 보여 주는 간격(ms). 줄이 많으면 다 보여 주는 데 LINES_MAX_MS를 넘지 않게 좁힌다. */
const LINE_STEP_MS = 280;
const LINES_MAX_MS = 960;
/** 곱해진 상금을 알리는 글이 떠 있는 시간(ms) */
const BOOST_MS = 620;
/** 꽝을 보여 준 뒤 다음 스핀을 받을 때까지(ms) */
const MISS_MS = 260;
/** 마지막 스핀의 결과를 보여 준 뒤 라운드를 맺을 때까지(ms) */
const SETTLE_DELAY_MS = 420;
/** 목표를 채웠다고 알린 뒤 가게가 열릴 때까지(ms) */
const SHOP_DELAY_MS = 900;
/** 판이 끝난 뒤 결과 화면이 뜰 때까지(ms) */
const OVER_RESULT_MS = 1600;
/** 한 번에 이만큼 넘게 받으면 크게 축하한다(그 라운드의 목표에 견준 비율). */
const BIG_WIN_RATIO = 0.5;

/** 가게의 창이 길 때 부적 한 줄이 더 커질 수 있는 높이와, 줄 아래에 안내를 적으려면 남아야 하는 높이 */
const SHOP_ROW_GROW = 8;
const SHOP_FOOT_MIN = 20;

/** 판을 시작할 때 보여 주는 그림. 맞은 줄이 없는 판이다. */
const START_GRID: readonly number[] = [0, 1, 2, 3, 4, 5, 1, 2, 0];

/** 이 라운드까지는 돌리기 전에 상금을 따지는 여덟 줄을 흐리게 그어 보여 준다. */
const GUIDE_ROUNDS = 1;
const HINTS = ['돌리기를 눌러요', '같은 그림 셋이 한 줄이면 금화!'] as const;

/**
 * 씬을 열 때 넘겨받는 것. daily는 결과 화면의 "다시 하기"가 오늘의 판을 다시 열 때 넘긴다.
 * 오늘의 판을 공유한 주소로 들어오면 그날(sharedDay)과 보낸 사람의 점수(sharedScore)가 온다.
 */
interface SlotStart extends SharedStart {
  daily?: boolean;
}

/** 시작 화면에서 여느 판과 오늘의 판을 오가는 버튼. 도움말 카드에서 gap만큼 띄워 그 바로 위에 놓는다. */
const DAILY_SWITCH = { width: 96, height: 24, gap: 6 } as const;
/** 오늘의 판을 골랐을 때 버튼 위에 적는 한 줄(오늘의 기록)의 높이와, 버튼과의 틈 */
const DAILY_INFO = { height: 16, gap: 4 } as const;
/** 오늘의 판을 하는 동안 점수 아래에 띄워 두는 표시의 한가운데 높이와 그 높이 */
const DAILY_BADGE = { y: 46, height: 14 } as const;

const DEPTH = {
  machine: 1,
  glow: 2,
  /** 첫 라운드에 보여 주는 여덟 줄의 길잡이. 맞은 칸의 빛 위, 맞은 줄의 선 아래에 깔린다. */
  guide: 2.2,
  /** 맞은 줄을 긋는 선. 그림 밑에 깔려서, 선이 지나가도 무슨 그림인지 그대로 보인다. */
  line: 2.5,
  cell: 3,
  panel: 8,
  effect: 20,
  hud: 30,
  hint: 32,
  shop: 34,
  bubble: 38,
  banner: 40,
} as const;

type Image = Phaser.GameObjects.Image;
type Text = Phaser.GameObjects.Text;
type Graphics = Phaser.GameObjects.Graphics;

// ───────── 버튼 ─────────

const BUTTON_TONES = {
  /** 돌리기와 다음 라운드: 카지노의 금빛 버튼 */
  gold: { face: 0xffcf4a, lip: 0xc98f1a },
  mint: { face: THEME.mint, lip: THEME.mintDeep },
  coral: { face: THEME.coral, lip: THEME.coralDeep },
  plain: { face: THEME.card, lip: THEME.shadow },
} as const;

type ButtonTone = keyof typeof BUTTON_TONES;

/**
 * 눌리는 느낌이 나는 둥근 버튼. 공용 버튼(core/ui.ts의 PixelButton)과 같은 모양이지만,
 * 가게 창 위에 놓을 수 있게 층을 정할 수 있고, 다 쓰면 치울 수 있고, 글 옆에 금화 값을 적을 수 있다.
 */
class SoftButton {
  private readonly graphics: Graphics;
  private readonly label: Text;
  private readonly coin: Image;
  private readonly amount: Text;
  /** 누르는 자리. 버튼을 누른 것인지 가려야 하는 쪽에서 읽는다. */
  readonly zone: Phaser.GameObjects.Zone;
  private pressed = false;
  private enabled = true;
  private price: number | null = null;

  constructor(
    scene: Phaser.Scene,
    private readonly box: Box,
    private readonly tone: ButtonTone,
    depth: number,
    text: string,
    onTap: () => void,
  ) {
    this.graphics = scene.add.graphics().setDepth(depth);
    this.label = addText(scene, 0, 0, text, { color: LOOK.text.ink, originY: 0.5 }).setDepth(depth);
    this.coin = scene.add.image(0, 0, coinTexture(scene)).setDepth(depth).setVisible(false);
    this.amount = addText(scene, 0, 0, '', { color: LOOK.text.ink, originY: 0.5 }).setDepth(depth).setVisible(false);
    this.zone = addTapZone(
      scene,
      box.x,
      box.y,
      box.width,
      box.height,
      (pressed) => {
        this.pressed = pressed && this.enabled;
        this.draw();
      },
      () => {
        if (!this.enabled) return;
        sfx.click();
        vibrate(8);
        onTap();
      },
    ).setDepth(depth);
    this.draw();
  }

  setLabel(text: string): this {
    this.label.setText(text);
    this.draw();
    return this;
  }

  /** 글 옆에 금화 그림과 값을 적는다. null이면 지운다. */
  setPrice(price: number | null): this {
    this.price = price;
    this.coin.setVisible(price !== null && this.graphics.visible);
    this.amount.setVisible(price !== null && this.graphics.visible).setText(price === null ? '' : String(price));
    this.draw();
    return this;
  }

  setEnabled(enabled: boolean): this {
    this.enabled = enabled;
    this.pressed = false;
    const alpha = enabled ? 1 : 0.45;
    for (const part of [this.graphics, this.label, this.coin, this.amount]) part.setAlpha(alpha);
    this.draw();
    return this;
  }

  setVisible(visible: boolean): this {
    this.graphics.setVisible(visible);
    this.label.setVisible(visible);
    this.coin.setVisible(visible && this.price !== null);
    this.amount.setVisible(visible && this.price !== null);
    if (visible) this.zone.setInteractive();
    else this.zone.disableInteractive();
    return this;
  }

  destroy(): void {
    for (const part of [this.graphics, this.label, this.coin, this.amount, this.zone]) part.destroy();
  }

  private draw(): void {
    const { x, y, width, height } = this.box;
    const colors = BUTTON_TONES[this.tone];
    const lip = 3;
    const offset = this.pressed ? 2 : 0;
    const face = height - lip;
    const radius = Math.min(12, face / 2, width / 2);
    const g = this.graphics;
    g.clear();
    g.fillStyle(colors.lip, 1);
    g.fillRoundedRect(x, y + lip, width, face, radius);
    g.fillStyle(colors.face, 1);
    g.fillRoundedRect(x, y + offset, width, face, radius);

    // 글과 금화 값을 한 덩어리로 가운데에 놓는다.
    const centerY = Math.round(y + offset + face / 2);
    const extra = this.price === null ? 0 : 4 + COIN_ICON.width + 2 + Math.ceil(this.amount.width);
    let left = Math.round(x + (width - Math.ceil(this.label.width) - extra) / 2);
    this.label.setPosition(left, centerY);
    left += Math.ceil(this.label.width) + 4;
    this.coin.setPosition(left + COIN_ICON.width / 2, centerY);
    this.amount.setPosition(left + COIN_ICON.width + 2, centerY);
  }
}

// ───────── 씬 ─────────

/** 돌아가고 있는 스핀 */
interface Reel {
  outcome: SpinOutcome;
  /** 돌기 시작한 뒤로 흐른 시간(ms) */
  elapsed: number;
  /** 그림을 마지막으로 바꾼 뒤로 흐른 시간(ms) */
  sinceFlick: number;
  /** 멈춘 열의 수 */
  stopped: number;
}

/** 치울 수 있는 것 */
interface Disposable {
  destroy(): void;
}

/** 가게에 놓인 부적 한 줄 */
interface OfferRow {
  box: Box;
  back: Graphics;
  icon: Image;
  name: Text;
  description: Text;
  priceBack: Graphics;
  coin: Image;
  price: Text;
  pressed: boolean;
}

/**
 * 행운 슬롯: 3×3 칸의 그림을 돌려 같은 그림 셋이 놓인 줄마다 금화를 받고, 라운드마다 오르는 목표만큼 금화를 낸다.
 * 남은 금화로는 가게에서 부적을 사서 그림이 나올 확률과 줄의 상금을 바꾼다.
 * 규칙은 rules.ts에 있고, 이 씬은 입력과 그리기만 맡는다.
 */
export class CandySlotScene extends MiniGameScene {
  protected readonly gameId = 'candy-slot';

  /** 지금 판의 상태. 자동 플레이 검사에서도 읽는다. */
  run!: RunState;
  /** 화면에 놓인 것들의 자리. 자동 플레이 검사에서도 읽는다. */
  layout!: Layout;
  /** 스핀의 결과를 보여 주고 있거나 라운드를 맺는 중이면 true. 그동안에는 돌리기와 가게를 받지 않는다. */
  busy = false;

  private hud!: GameHud;
  private cells: Image[] = [];
  private glow!: Graphics;
  private lineFx!: Graphics;
  private guideFx!: Graphics;
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  private goalBack!: Graphics;
  private goalLabel!: Text;
  private goalText!: Text;
  private spinsText!: Text;
  private slotImages: Image[] = [];
  private oddsTexts: Array<{ value: Text; chance: Text }> = [];
  /** 확률 줄에 지금 적혀 있는 값. 바뀐 칸만 톡 튀게 하려고 기억해 둔다. */
  private shownOdds: number[] = [];
  private shownValues: number[] = [];
  private spinButton!: SoftButton;
  private reel: Reel | null = null;
  /** 받았지만 아직 화면의 수에 넣지 않은 금화. 맞은 줄을 하나씩 보여 주는 동안 줄어든다. */
  private pending = 0;
  private hints: Array<Text | Graphics> = [];
  /** 가게가 열려 있는 동안 떠 있는 것들 */
  private shopViews: Disposable[] = [];
  private offerRows: Array<OfferRow | null> = [];
  private rerollButton: SoftButton | null = null;
  /** 붙인 부적을 눌렀을 때 뜨는 설명 */
  private bubble: { views: Disposable[]; zones: Phaser.GameObjects.GameObject[] } | null = null;
  /** 씬을 열 때 넘겨받은 것. init이 적어 두고 setUpDaily가 쓴다. */
  private dailyStart: SlotStart = {};
  /** 시작 화면에서 여느 판과 오늘의 판을 오가는 버튼. 첫 스핀에 도움말과 함께 사라진다. */
  private dailySwitch: SoftButton | null = null;
  /** 오늘의 판을 골랐을 때 그 버튼 위에 적는 한 줄 */
  private dailyNote: { back: Graphics; text: Text } | null = null;
  /** 오늘의 판을 하는 동안 점수 아래에 떠 있는 표시 */
  private dailyBadge: { back: Graphics; text: Text } | null = null;
  /** 공유받은 주소로 들어왔는데 그날이 이미 지났으면 true. 시작 화면에 한 줄로 알린다. */
  private sharedDayPassed = false;
  /** 공유받은 주소에 실려 온 친구의 오늘 점수. 없으면 null */
  private friendScore: number | null = null;

  constructor() {
    super(SCENE.candySlot);
  }

  create(): void {
    this.beginMiniGame();
    this.resetState();

    const { height } = this.scale;
    this.layout = layoutFor({ x: 0, y: HUD_HEIGHT, width: GAME_WIDTH, height: height - HUD_HEIGHT });
    this.run = newRun();

    this.addTable();
    this.addMachine();
    this.addGoal();
    this.addSlots();
    this.addOdds();
    this.sparks = this.add
      .particles(0, 0, TEXTURE.spark, {
        speed: { min: 30, max: 90 },
        lifespan: { min: 240, max: 460 },
        alpha: { start: 1, end: 0 },
        tint: [...LOOK.sparks],
        emitting: false,
      })
      .setDepth(DEPTH.effect);

    this.addPauseButton();
    this.hud = new GameHud(this, DEPTH.hud);
    this.spinButton = new SoftButton(this, this.layout.button, 'gold', DEPTH.panel, '돌리기', () => this.trySpin());

    this.refreshNumbers();
    this.refreshSlots();
    this.refreshOdds(false);
    this.bindInput();
    this.showHints();
    this.showGuide();
    this.setUpDaily();
    sfx.go();
    this.playing = true;
  }

  override update(_time: number, deltaMs: number): void {
    const reel = this.reel;
    if (!reel) return;
    reel.elapsed += deltaMs;
    reel.sinceFlick += deltaMs;
    while (reel.stopped < SIZE && reel.elapsed >= STOP_FIRST_MS + STOP_STEP_MS * reel.stopped) {
      this.stopColumn(reel.stopped, reel.outcome.grid);
      reel.stopped += 1;
    }
    if (reel.stopped >= SIZE) {
      this.reel = null;
      this.showOutcome(reel.outcome);
      return;
    }
    if (reel.sinceFlick < (reducedMotion() ? FLICK_CALM_MS : FLICK_MS)) return;
    reel.sinceFlick = 0;
    for (let cell = 0; cell < CELLS; cell += 1) {
      if (cell % SIZE < reel.stopped) continue;
      // 돌아가는 동안 스쳐 가는 그림은 보여 주기만 하는 것이라 결과와 상관없다.
      this.cells[cell].setTexture(symbolTexture(this, Math.floor(Math.random() * SYMBOLS.length)));
    }
  }

  private resetState(): void {
    this.busy = false;
    this.cells = [];
    this.slotImages = [];
    this.oddsTexts = [];
    this.shownOdds = [];
    this.shownValues = [];
    this.reel = null;
    this.pending = 0;
    this.hints = [];
    this.shopViews = [];
    this.offerRows = [];
    this.rerollButton = null;
    this.bubble = null;
  }

  // ───────── 놓기 ─────────

  private get cellScale(): number {
    return (this.layout.cell * 0.82) / SYMBOL_BOX;
  }

  /** 칸의 한가운데 */
  private centerOf(cell: number): { x: number; y: number } {
    const { cell: size, gridLeft, gridTop } = this.layout;
    return {
      x: gridLeft + ((cell % SIZE) + 0.5) * size,
      y: gridTop + (Math.floor(cell / SIZE) + 0.5) * size,
    };
  }

  /** 기계의 한가운데 높이. 알림 글자를 여기에 띄운다. */
  private get machineMiddle(): number {
    return this.layout.machine.y + this.layout.machine.height / 2;
  }

  /** 화면을 덮는 초록 천. 이 게임은 꾸미기 상점의 배경 대신 카지노 테이블 위에서 한다. */
  private addTable(): void {
    const { width, height } = this.scale;
    const { machine } = this.layout;
    const focus = { x: machine.x + machine.width / 2, y: machine.y + machine.height / 2 };
    drawFelt(this.add.graphics(), width, height, focus, machine.width * 0.78);
  }

  private addMachine(): void {
    const { machine, cell } = this.layout;
    const body = this.add.graphics().setDepth(DEPTH.machine);
    drawMachine(body, machine.x, machine.y, cell, MACHINE_FRAME);
    // 몸통의 전구는 하나 걸러 하나씩 번갈아 깜빡인다. 움직임을 줄인 기기에서는 깜빡이지 않는다.
    const bulbs = this.add.graphics().setDepth(DEPTH.machine);
    let phase = 0;
    const blink = (): void => {
      bulbs.clear();
      drawBulbs(bulbs, machine.x, machine.y, cell, MACHINE_FRAME, phase);
      phase = 1 - phase;
    };
    blink();
    if (!reducedMotion()) this.time.addEvent({ delay: BULB_MS, loop: true, callback: blink });
    this.glow = this.add.graphics().setDepth(DEPTH.glow);
    this.guideFx = this.add.graphics().setDepth(DEPTH.guide).setAlpha(0);
    this.drawGuide();
    this.lineFx = this.add.graphics().setDepth(DEPTH.line);
    for (let index = 0; index < CELLS; index += 1) {
      const { x, y } = this.centerOf(index);
      this.cells.push(
        this.add
          .image(x, y, symbolTexture(this, START_GRID[index]))
          .setScale(this.cellScale)
          .setDepth(DEPTH.cell),
      );
    }
  }

  private addGoal(): void {
    const { goal } = this.layout;
    const middle = goal.y + goal.height / 2;
    this.goalBack = this.add.graphics().setDepth(DEPTH.panel);
    this.goalLabel = addText(this, goal.x + 10, middle, '목표', { color: LOOK.text.sub, originY: 0.5 }).setDepth(
      DEPTH.panel,
    );
    this.goalText = addText(this, 0, middle, '', { color: LOOK.text.ink, originX: 0.5, originY: 0.5 }).setDepth(
      DEPTH.panel,
    );
    this.spinsText = addText(this, goal.x + goal.width - 10, middle, '', {
      color: LOOK.text.points,
      originX: 1,
      originY: 0.5,
    }).setDepth(DEPTH.panel);
  }

  private addSlots(): void {
    const { slots, slotSize } = this.layout;
    slots.forEach((slot, index) => {
      const image = this.add
        .image(slot.x + slotSize / 2, slot.y + slotSize / 2, emptySlotTexture(this))
        .setDepth(DEPTH.panel);
      this.slotImages.push(image);
      addTapZone(
        this,
        slot.x - 2,
        slot.y - 2,
        slotSize + 4,
        slotSize + 4,
        (pressed) => image.setScale(pressed && index < this.run.charms.length ? 0.92 : 1),
        () => this.onSlotTap(index),
      ).setDepth(DEPTH.panel);
    });
  }

  private addOdds(): void {
    const { box, cells, cellWidth } = this.layout.odds;
    const panel = this.add.graphics().setDepth(DEPTH.panel);
    drawPanel(panel, box.x, box.y, box.width, box.height, { radius: 10, depth: 2 });
    cells.forEach((left, symbol) => {
      // 위: 작은 그림과 그 줄의 상금. 아래: 한 칸에 나올 확률.
      const top = box.y + 3 + MINI_BOX / 2;
      this.add.image(left + 2 + MINI_BOX / 2, top, miniSymbolTexture(this, symbol)).setDepth(DEPTH.panel);
      const value = addText(this, left + 4 + MINI_BOX, top, '', { color: LOOK.text.points, originY: 0.5 }).setDepth(
        DEPTH.panel,
      );
      const chance = addText(this, left + cellWidth / 2, box.y + 2 + MINI_BOX, '', {
        size: FONT_SIZE.small,
        color: LOOK.text.sub,
        originX: 0.5,
      }).setDepth(DEPTH.panel);
      this.oddsTexts.push({ value, chance });
    });
  }

  // ───────── 고쳐 그리기 ─────────

  /** 가진 금화, 목표, 남은 스핀, 점수를 지금 상태대로 적는다. 아직 보여 주지 않은 금화(pending)은 뺀다. */
  private refreshNumbers(): void {
    const { goal } = this.layout;
    const { run } = this;
    const shopping = run.phase === 'shop';
    const coin = Math.max(0, run.coin - this.pending);
    const target = targetOf(shopping ? run.round + 1 : run.round);
    const reached = coin >= target;

    this.hud.setScore(Math.max(0, scoreOf(run) - this.pending));
    this.hud.setSide(`라운드 ${run.round}`);
    this.goalLabel.setText(shopping ? '다음 목표' : '목표');
    this.spinsText.setText(`스핀 ${shopping ? spinsOf(run.charms) : run.spinsLeft}`);

    const barLeft = Math.ceil(this.goalLabel.x + this.goalLabel.width) + 6;
    const barRight = Math.floor(this.spinsText.x - this.spinsText.width) - 6;
    const bar = { x: barLeft, y: goal.y + 7, width: barRight - barLeft, height: goal.height - 14 };
    const g = this.goalBack;
    g.clear();
    drawPanel(g, goal.x, goal.y, goal.width, goal.height, { radius: 10, depth: 2 });
    g.fillStyle(LOOK.goalBar.back, 1);
    g.fillRoundedRect(bar.x, bar.y, bar.width, bar.height, bar.height / 2);
    const ratio = Phaser.Math.Clamp(coin / target, 0, 1);
    if (ratio > 0) {
      g.fillStyle(reached ? LOOK.goalBar.full : LOOK.goalBar.fill, 1);
      g.fillRoundedRect(bar.x, bar.y, Math.max(bar.height, bar.width * ratio), bar.height, bar.height / 2);
    }
    this.goalText.setText(`${coin} / ${target}`).setX(Math.round(bar.x + bar.width / 2));
    this.refreshDailyBadge();
  }

  private refreshSlots(): void {
    this.slotImages.forEach((image, index) => {
      const id = this.run.charms[index];
      image.setTexture(id ? charmTexture(this, id) : emptySlotTexture(this)).setScale(1);
    });
  }

  /** 그림마다의 상금과 확률을 적는다. bounce면 바뀐 칸이 톡 튄다(부적을 붙이거나 뗐을 때). */
  private refreshOdds(bounce: boolean): void {
    const odds = oddsOf(this.run.charms).map((chance) => Math.round(chance * 100));
    const values = valuesOf(this.run.charms);
    this.oddsTexts.forEach((texts, symbol) => {
      const changed = [
        [texts.value, values[symbol], this.shownValues[symbol]] as const,
        [texts.chance, odds[symbol], this.shownOdds[symbol]] as const,
      ];
      texts.value.setText(String(values[symbol]));
      texts.chance.setText(`${odds[symbol]}%`);
      if (!bounce) return;
      for (const [text, now, before] of changed) {
        if (now === before) continue;
        // 올랐으면 초록, 내렸으면 빨강으로 잠깐 물든다.
        const rest = text === texts.value ? LOOK.text.points : LOOK.text.sub;
        text.setColor(now > before ? LOOK.text.good : LOOK.text.bad);
        this.tweens.killTweensOf(text);
        this.tweens.add({
          targets: text,
          scale: { from: 1.5, to: 1 },
          duration: 320,
          ease: 'Back.Out',
          onComplete: () => text.setColor(rest),
        });
      }
    });
    this.shownOdds = odds;
    this.shownValues = values;
  }

  /** 처음의 도움말. 그림 위에서도 잘 읽히게 흰 판에 얹어 기계 한가운데에 띄운다. */
  private showHints(): void {
    const middle = this.machineMiddle;
    const lines = [
      addText(this, GAME_WIDTH / 2, middle - 17, HINTS[0], { color: LOOK.text.ink, originX: 0.5 }),
      addText(this, GAME_WIDTH / 2, middle + 1, HINTS[1], { color: LOOK.text.sub, originX: 0.5 }),
    ];
    const width = Math.max(...lines.map((line) => line.width)) + 20;
    const back = this.add.graphics().setDepth(DEPTH.hint);
    const box = { x: Math.round(GAME_WIDTH / 2 - width / 2), y: middle - 23, width: Math.round(width), height: 44 };
    back.fillStyle(LOOK.machine.trimLip, 1);
    back.fillRoundedRect(box.x, box.y + 2, box.width, box.height, 10);
    back.fillStyle(LOOK.machine.trim, 1);
    back.fillRoundedRect(box.x, box.y, box.width, box.height, 10);
    back.fillStyle(THEME.white, 1);
    back.fillRoundedRect(box.x + 2, box.y + 2, box.width - 4, box.height - 4, 8);
    this.hints = [back, ...lines];
    // 글은 판보다 위에 놓는다.
    for (const line of lines) line.setDepth(DEPTH.hint + 0.5);
  }

  /** 처음의 도움말을 치운다. now면 흐려지는 움직임 없이 바로 치운다(그 위에 다른 것이 덮일 때). */
  private hideHints(now = false): void {
    this.hideDailySwitch();
    if (this.hints.length === 0) return;
    const hints = this.hints;
    this.hints = [];
    if (now) {
      for (const hint of hints) hint.destroy();
      return;
    }
    this.tweens.add({
      targets: hints,
      alpha: 0,
      duration: 200,
      onComplete: () => hints.forEach((hint) => hint.destroy()),
    });
  }

  /** 기계 위에 작은 알림을 잠깐 띄운다. */
  private note(label: string, color: string, y = this.machineMiddle): void {
    showBanner(this, y, label, color, 1300, DEPTH.banner, FONT_SIZE.normal + 2);
  }

  // ───────── 입력 ─────────

  private bindInput(): void {
    // 설명이 떠 있을 때 다른 곳을 누르면 설명을 치운다. 설명 안의 버튼을 누른 것은 그대로 둔다.
    const onDown = (_pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]): void => {
      if (this.bubble && !over.some((item) => this.bubble?.zones.includes(item))) this.hideBubble();
    };
    this.input.on(Phaser.Input.Events.POINTER_DOWN, onDown);
    // 키보드로도 돌릴 수 있다(컴퓨터에서 해 볼 때).
    const keyboard = this.input.keyboard;
    const onKey = (): void => this.trySpin();
    keyboard?.on('keydown-SPACE', onKey);
    keyboard?.on('keydown-ENTER', onKey);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.off(Phaser.Input.Events.POINTER_DOWN, onDown);
      keyboard?.off('keydown-SPACE', onKey);
      keyboard?.off('keydown-ENTER', onKey);
    });
  }

  // ───────── 스핀 ─────────

  private trySpin(): void {
    if (!this.playing || this.busy || this.run.phase !== 'spin') return;
    const result = spin(this.run, randomOf(this.run, 'spin', Math.random));
    if (!result) return;
    this.hideHints();
    this.hideGuide();
    this.hideBubble();
    this.clearWins();
    this.busy = true;
    this.run = result.run;
    this.pending = result.outcome.total;
    this.reel = { outcome: result.outcome, elapsed: 0, sinceFlick: 0, stopped: 0 };
    this.spinButton.setEnabled(false);
    this.refreshNumbers();
    for (const image of this.cells) {
      this.tweens.killTweensOf(image);
      image.setScale(this.cellScale * 0.92).setAlpha(0.8);
    }
    sfx.whoosh();
    vibrate(8);
  }

  /** 한 열을 멈춰 나온 그림을 보여 준다. */
  private stopColumn(col: number, grid: readonly number[]): void {
    for (let row = 0; row < SIZE; row += 1) {
      const cell = row * SIZE + col;
      const image = this.cells[cell];
      image.setTexture(symbolTexture(this, grid[cell])).setAlpha(1);
      this.tweens.add({
        targets: image,
        scale: { from: this.cellScale * 1.18, to: this.cellScale },
        duration: 200,
        ease: 'Back.Out',
      });
    }
    tone(330 + col * 70, 0.06, { type: 'triangle', volume: 0.35 });
    vibrate(5);
  }

  /** 상금을 따지는 여덟 줄을 흐리게 긋는다. 줄의 양 끝에는 점을 찍어서 어디에서 어디까지인지 보이게 한다. */
  private drawGuide(): void {
    const g = this.guideFx;
    const reach = this.layout.cell * 0.36;
    for (const line of LINES) {
      const from = this.centerOf(line.cells[0]);
      const to = this.centerOf(line.cells[2]);
      const length = Math.hypot(to.x - from.x, to.y - from.y);
      const ux = (to.x - from.x) / length;
      const uy = (to.y - from.y) / length;
      const a = { x: from.x - ux * reach, y: from.y - uy * reach };
      const b = { x: to.x + ux * reach, y: to.y + uy * reach };
      g.lineStyle(2, LOOK.guide, 0.5);
      g.lineBetween(a.x, a.y, b.x, b.y);
      g.fillStyle(LOOK.guide, 0.8);
      g.fillCircle(a.x, a.y, 2);
      g.fillCircle(b.x, b.y, 2);
    }
  }

  /** 첫 라운드에서 돌리기를 기다리는 동안 여덟 줄의 길잡이를 보여 준다. */
  private showGuide(): void {
    if (this.run.phase !== 'spin' || this.run.round > GUIDE_ROUNDS) return;
    this.tweens.killTweensOf(this.guideFx);
    this.tweens.add({ targets: this.guideFx, alpha: 1, duration: 220 });
  }

  private hideGuide(): void {
    this.tweens.killTweensOf(this.guideFx);
    this.guideFx.setAlpha(0);
  }

  private clearWins(): void {
    this.glow.clear();
    this.lineFx.clear();
  }

  /** 다 멈춘 판의 결과를 차례로 보여 준다: 맞은 줄을 하나씩, 그다음 곱해진 상금. */
  private showOutcome(outcome: SpinOutcome): void {
    const { wins } = outcome;
    if (wins.length === 0) {
      const { goal } = this.layout;
      sfx.expire();
      this.note('꽝', LOOK.text.sub);
      this.floatCoin(goal.x + goal.width / 2, goal.y + goal.height, outcome.total);
      this.time.delayedCall(MISS_MS, () => this.afterSpin(outcome));
      return;
    }
    const step = Math.min(LINE_STEP_MS, LINES_MAX_MS / wins.length);
    wins.forEach((win, index) => this.time.delayedCall(index * step, () => this.showWin(win, index)));
    const linesEnd = wins.length * step;
    const boosted = outcome.boosts.length > 0;
    if (boosted) this.time.delayedCall(linesEnd, () => this.showBoosts(outcome));
    this.time.delayedCall(linesEnd + (boosted ? BOOST_MS : 0), () => this.afterSpin(outcome));
  }

  /** 맞은 줄 하나: 줄을 긋고, 세 칸이 튀고, 그 줄의 금화가 떠오른다. */
  private showWin(win: LineWin, order: number): void {
    const line = LINES[win.line];
    const centers = line.cells.map((cell) => this.centerOf(cell));
    const size = this.layout.cell;

    this.glow.fillStyle(LOOK.winGlow, 1);
    for (const center of centers) {
      this.glow.fillRoundedRect(center.x - size / 2 + 1, center.y - size / 2 + 1, size - 2, size - 2, 9);
    }
    const [from, , to] = centers;
    for (const [width, color] of [
      [8, LOOK.winLine.edge],
      [4, LOOK.winLine.core],
    ] as const) {
      this.lineFx.lineStyle(width, color, 1);
      this.lineFx.beginPath();
      this.lineFx.moveTo(from.x, from.y);
      this.lineFx.lineTo(to.x, to.y);
      this.lineFx.strokePath();
      this.lineFx.fillStyle(color, 1);
      this.lineFx.fillCircle(from.x, from.y, width / 2);
      this.lineFx.fillCircle(to.x, to.y, width / 2);
    }

    line.cells.forEach((cell, index) => {
      const image = this.cells[cell];
      this.tweens.killTweensOf(image);
      image.setScale(this.cellScale);
      this.tweens.add({
        targets: image,
        scale: this.cellScale * 1.2,
        duration: 110,
        yoyo: true,
        ease: 'Quad.Out',
      });
      this.sparks.setParticleTint(symbolColor(win.symbol));
      this.sparks.explode(3, centers[index].x, centers[index].y);
    });

    this.pending = Math.max(0, this.pending - win.amount);
    this.refreshNumbers();
    const middle = centers[1];
    const bounds = new Phaser.Geom.Rectangle(0, HUD_HEIGHT, GAME_WIDTH, this.scale.height - HUD_HEIGHT);
    floatText(this, middle.x, middle.y - size * 0.3, `+${win.amount}`, LOOK.text.points, bounds, DEPTH.effect);
    sfx.hit(order * 2);
    vibrate(10);
  }

  /** 상금이 곱해졌으면 까닭과 곱해진 값을 크게 알린다. */
  private showBoosts(outcome: SpinOutcome): void {
    const times = outcome.boosts.reduce((product, boost) => product * boost.times, 1);
    const label = this.boostLabel(outcome.boosts[0], outcome.wins.length);
    showBanner(this, this.machineMiddle, `${label} ${times}배`, LOOK.text.points, BOOST_MS + 200, DEPTH.banner, FONT_SIZE.large);
    sfx.gold();
    vibrate([15, 30, 15]);
    this.sparks.setParticleTint(THEME.gold);
    this.sparks.explode(14, GAME_WIDTH / 2, this.machineMiddle);
  }

  private boostLabel(boost: Boost, lines: number): string {
    switch (boost.kind) {
      case 'jackpot':
        return '대박!';
      case 'combo':
        return `${lines}줄!`;
      case 'last':
        return '막판 한 방!';
      case 'rebound':
        return '오뚝이!';
    }
  }

  /** 금화를 얼마 받았는지(또는 냈는지) 띄운다. */
  private floatCoin(x: number, y: number, amount: number): void {
    if (amount === 0) return;
    const bounds = new Phaser.Geom.Rectangle(0, HUD_HEIGHT, GAME_WIDTH, this.scale.height - HUD_HEIGHT);
    const color = amount > 0 ? LOOK.text.good : LOOK.text.bad;
    floatText(this, x, y + 14, amount > 0 ? `+${amount}` : String(amount), color, bounds, DEPTH.effect);
  }

  /** 스핀 하나의 결과를 다 보여 준 뒤: 수를 맞추고, 스핀이 남았으면 다음을 받고, 다 썼으면 라운드를 맺는다. */
  private afterSpin(outcome: SpinOutcome): void {
    if (!this.playing) return;
    this.pending = 0;
    this.refreshNumbers();
    if (outcome.wins.length > 0) {
      const { goal } = this.layout;
      this.floatCoin(goal.x + goal.width / 2, goal.y + goal.height, outcome.total);
      if (outcome.total >= targetOf(this.run.round) * BIG_WIN_RATIO && outcome.boosts.length === 0) sfx.coin();
    }
    if (this.run.spinsLeft > 0) {
      this.busy = false;
      this.spinButton.setEnabled(true);
      // 맞은 줄을 보여 주는 동안에는 길잡이를 겹쳐 긋지 않는다.
      if (outcome.wins.length === 0) this.showGuide();
      return;
    }
    this.time.delayedCall(SETTLE_DELAY_MS, () => this.settle());
  }

  // ───────── 라운드 ─────────

  private settle(): void {
    if (!this.playing) return;
    const short = targetOf(this.run.round) - this.run.coin;
    const settlement = settleRound(this.run, randomOf(this.run, 'shop', Math.random));
    if (!settlement) return;
    this.run = settlement.run;
    if (!settlement.cleared) {
      this.endRun(`금화가 ${short}개 모자라요`);
      return;
    }
    const { goal } = this.layout;
    showBanner(this, this.machineMiddle, '목표 달성!', LOOK.text.good, SHOP_DELAY_MS, DEPTH.banner, FONT_SIZE.large);
    sfx.coin();
    vibrate([15, 30, 15]);
    this.sparks.setParticleTint(THEME.mintDeep);
    this.sparks.explode(12, GAME_WIDTH / 2, this.machineMiddle);
    // 목표만큼 낸 것과 저금통의 덤을 따로 보여 준다.
    this.floatCoin(goal.x + goal.width / 2 - 24, goal.y + goal.height, -settlement.paid);
    if (settlement.savings > 0) {
      this.time.delayedCall(260, () =>
        this.floatCoin(goal.x + goal.width / 2 + 24, goal.y + goal.height, settlement.savings),
      );
    }
    this.time.delayedCall(SHOP_DELAY_MS, () => this.openShop());
  }

  /** 판을 끝낸다. 목표를 채우지 못해 끝났을 때와 스스로 끝냈을 때 알리는 글이 다르다. */
  private endRun(notice: string): void {
    if (!this.playing) return;
    this.playing = false;
    this.busy = true;
    this.reel = null;
    this.hideHints();
    this.hideBubble();
    this.spinButton.setEnabled(false);
    this.rerollButton?.setEnabled(false);
    vibrate([20, 40, 20]);

    const banner = addText(this, GAME_WIDTH / 2, this.machineMiddle, notice, {
      size: 18,
      color: LOOK.text.bad,
      originX: 0.5,
      originY: 0.5,
      stroke: LOOK.text.outline,
      shadow: LOOK.text.shadow,
    }).setDepth(DEPTH.banner);
    this.tweens.add({ targets: banner, scale: { from: 0.7, to: 1 }, duration: 180, ease: 'Back.Out' });

    const { run } = this;
    const chips = run.charms.flatMap((id) => {
      const texture = charmChipTexture(this, id);
      return texture ? [{ texture, label: '' }] : [];
    });
    const strip: ResultStrip | undefined = chips.length > 0 ? { caption: '붙인 부적', chips } : undefined;
    const daily = this.recordDaily();
    this.finishMiniGame(
      scoreOf(run),
      [
        ...(daily?.stats ?? []),
        ['넘긴 라운드', `${clearedRounds(run)}번`],
        ['가장 큰 한 방', `금화 ${run.bestSpin}개`],
      ],
      OVER_RESULT_MS,
      strip,
      daily?.share,
    );
  }

  /** 끝이 정해져 있지 않은 게임이라, 점수가 있으면 일시정지 화면에서 기록하고 끝낼 수 있다. */
  protected override canFinishEarly(): boolean {
    return this.playing && scoreOf(this.run) > 0;
  }

  protected override finishEarly(): void {
    this.endRun('여기까지!');
  }

  /** 한 판이 길어서, 점수가 있는 판을 그만두려 하면 한 번 더 묻는다. */
  protected override quitWarning(): string | null {
    return this.playing && scoreOf(this.run) > 0 ? '지금 점수는 기록되지 않아요' : null;
  }

  // ───────── 가게 ─────────

  private openShop(): void {
    if (!this.playing || this.run.phase !== 'shop') return;
    const { shop, button } = this.layout;
    this.clearWins();
    this.hideHints(true);
    this.busy = false;
    this.spinButton.setVisible(false);
    this.refreshNumbers();

    const panel = this.add.graphics().setDepth(DEPTH.shop);
    drawPanel(panel, shop.x, shop.y, shop.width, shop.height, { radius: 14 });
    // 가게 창을 누른 것이 그 밑으로 새지 않게 한다.
    const blocker = this.add
      .zone(shop.x, shop.y, shop.width, shop.height)
      .setOrigin(0, 0)
      .setInteractive()
      .setDepth(DEPTH.shop);
    const title = addText(this, shop.x + 12, shop.y + 6, '부적 가게', { color: LOOK.text.ink }).setDepth(DEPTH.shop);
    const guide = addText(this, shop.x + shop.width - 12, shop.y + 8, '눌러서 사요', {
      size: FONT_SIZE.small,
      color: LOOK.text.sub,
      originX: 1,
    }).setDepth(DEPTH.shop);
    this.shopViews.push(panel, blocker, title, guide);

    // 창이 길면 줄을 조금 키우고, 그래도 남는 자리에는 한 줄 안내를 적는다.
    const spare = shop.height - SHOP_HEAD - OFFERS * SHOP_ROW - 4;
    const pitch = SHOP_ROW + Phaser.Math.Clamp(Math.floor(spare / OFFERS), 0, SHOP_ROW_GROW);
    const top = shop.y + SHOP_HEAD;
    this.offerRows = [];
    for (let offer = 0; offer < OFFERS; offer += 1) {
      this.offerRows.push(
        this.addOfferRow(offer, { x: shop.x + 6, y: top + offer * pitch, width: shop.width - 12, height: pitch - 4 }),
      );
    }
    const rowsBottom = top + OFFERS * pitch;
    const footRoom = shop.y + shop.height - rowsBottom;
    if (footRoom >= SHOP_FOOT_MIN) {
      this.shopViews.push(
        addText(this, shop.x + shop.width / 2, rowsBottom + (footRoom - 4) / 2, `부적은 ${SLOTS}장까지 붙일 수 있어요`, {
          size: FONT_SIZE.small,
          color: LOOK.text.faint,
          originX: 0.5,
          originY: 0.5,
        }).setDepth(DEPTH.shop),
      );
    }

    const gap = 8;
    const half = (button.width - gap) / 2;
    this.rerollButton = new SoftButton(
      this,
      { ...button, width: half },
      'plain',
      DEPTH.panel,
      '다시 뽑기',
      () => this.tryReroll(),
    );
    const next = new SoftButton(
      this,
      { ...button, x: button.x + half + gap, width: half },
      'gold',
      DEPTH.panel,
      '다음 라운드',
      () => this.closeShop(),
    );
    this.shopViews.push(this.rerollButton, next);
    this.refreshShop();
    sfx.pop();
  }

  private addOfferRow(offer: number, box: Box): OfferRow {
    const depth = DEPTH.shop;
    const middle = box.y + box.height / 2;
    const textLeft = box.x + CHARM_BOX + 10;
    const pill = { width: 40, height: 22 };
    const row: OfferRow = {
      box,
      back: this.add.graphics().setDepth(depth),
      icon: this.add.image(box.x + 5 + CHARM_BOX / 2, middle, emptySlotTexture(this)).setDepth(depth),
      name: addText(this, textLeft, middle - 15, '', { color: LOOK.text.ink }).setDepth(depth),
      description: addText(this, textLeft, middle + 2, '', { size: FONT_SIZE.small, color: LOOK.text.sub }).setDepth(
        depth,
      ),
      priceBack: this.add.graphics().setDepth(depth),
      coin: this.add
        .image(box.x + box.width - pill.width - 5 + 4 + COIN_ICON.width / 2, middle, coinTexture(this))
        .setDepth(depth),
      price: addText(this, box.x + box.width - 5 - 6, middle, '', { originX: 1, originY: 0.5 }).setDepth(depth),
      pressed: false,
    };
    const zone = addTapZone(
      this,
      box.x,
      box.y,
      box.width,
      box.height,
      (pressed) => {
        row.pressed = pressed;
        this.drawOfferRow(offer);
      },
      () => this.tryBuy(offer),
    ).setDepth(depth);
    this.shopViews.push(row.back, row.icon, row.name, row.description, row.priceBack, row.coin, row.price, zone);
    return row;
  }

  /** 가게의 부적 한 줄을 지금 상태대로 그린다: 팔렸는지, 살 수 있는지, 눌려 있는지. */
  private drawOfferRow(offer: number): void {
    const row = this.offerRows[offer];
    if (!row) return;
    const { box } = row;
    const id = this.run.shop?.offers[offer] ?? null;
    const charm = id ? charmOf(id) : undefined;
    const block = buyBlock(this.run, offer);
    const middle = box.y + box.height / 2;

    row.back.clear();
    row.back.fillStyle(row.pressed && charm ? THEME.dim : THEME.bg, 1);
    row.back.fillRoundedRect(box.x, box.y, box.width, box.height, 10);
    row.priceBack.clear();

    const sold = !charm;
    for (const part of [row.icon, row.description, row.coin, row.price]) part.setVisible(!sold);
    if (!charm) {
      row.name.setText('붙였어요').setColor(LOOK.text.faint).setY(Math.round(middle - row.name.height / 2));
      return;
    }
    row.icon.setTexture(charmTexture(this, charm.id));
    row.name.setText(charm.name).setColor(LOOK.text.ink).setY(Math.round(middle - 15));
    row.description.setText(charm.description);
    // 좁은 줄에서 설명이 값에 닿지 않게, 넘치면 그만큼 줄인다.
    const room = box.x + box.width - 50 - row.description.x;
    row.description.setScale(Math.min(1, room / Math.max(1, row.description.width / row.description.scaleX)));

    const pill = { x: box.x + box.width - 45, y: middle - 11, width: 40, height: 22 };
    const afford = block !== 'coin';
    row.priceBack.fillStyle(afford ? THEME.butter : THEME.dim, 1);
    row.priceBack.fillRoundedRect(pill.x, pill.y, pill.width, pill.height, 11);
    row.price.setText(String(charm.price)).setColor(afford ? LOOK.text.ink : LOOK.text.bad);
    row.coin.setAlpha(afford ? 1 : 0.5);
  }

  private refreshShop(): void {
    for (let offer = 0; offer < OFFERS; offer += 1) this.drawOfferRow(offer);
    const cost = this.run.shop?.rerollCost ?? 0;
    this.rerollButton?.setPrice(cost).setEnabled(this.run.coin >= cost);
  }

  private tryBuy(offer: number): void {
    if (!this.playing || this.busy || this.run.phase !== 'shop') return;
    this.hideBubble();
    const block = buyBlock(this.run, offer);
    if (block === 'sold' || block === 'closed') return;
    if (block !== null) {
      sfx.deny();
      const y = this.layout.slots[0].y - 14;
      if (block === 'full') this.note('자리가 없어요. 부적을 눌러 떼요', LOOK.text.bad, y);
      else this.note('금화가 모자라요', LOOK.text.bad, y);
      return;
    }
    this.run = buy(this.run, offer);
    sfx.coin();
    vibrate(12);
    this.refreshNumbers();
    this.refreshSlots();
    this.refreshOdds(true);
    this.refreshShop();
    // 방금 붙인 부적이 제자리에서 톡 튄다.
    const image = this.slotImages[this.run.charms.length - 1];
    this.tweens.add({ targets: image, scale: { from: 1.4, to: 1 }, duration: 260, ease: 'Back.Out' });
  }

  private tryReroll(): void {
    if (!this.playing || this.busy || this.run.phase !== 'shop') return;
    this.hideBubble();
    const next = reroll(this.run, randomOf(this.run, 'shop', Math.random));
    if (next === this.run) {
      sfx.deny();
      return;
    }
    this.run = next;
    sfx.flip();
    this.refreshNumbers();
    this.refreshShop();
    for (const row of this.offerRows) {
      if (!row) continue;
      this.tweens.add({ targets: row.icon, scale: { from: 0.4, to: 1 }, duration: 220, ease: 'Back.Out' });
    }
  }

  private closeShop(): void {
    if (!this.playing || this.busy || this.run.phase !== 'shop') return;
    this.hideBubble();
    for (const view of this.shopViews) view.destroy();
    this.shopViews = [];
    this.offerRows = [];
    this.rerollButton = null;
    this.run = nextRound(this.run);
    this.spinButton.setVisible(true).setEnabled(true);
    this.refreshNumbers();
    showBanner(this, this.machineMiddle, `라운드 ${this.run.round}`, LOOK.text.good, 700, DEPTH.banner, FONT_SIZE.large);
    sfx.go();
  }

  // ───────── 오늘의 판 ─────────

  /** 씬을 열 때마다 create보다 먼저 불린다. 넘겨받은 것을 적어 두고, 지난번에 만들어 둔 것은 잊는다. */
  init(data?: SlotStart): void {
    this.dailyStart = data ?? {};
    this.dailySwitch = null;
    this.dailyNote = null;
    this.dailyBadge = null;
    this.sharedDayPassed = false;
    this.friendScore = null;
  }

  /** 지금 판이 오늘의 판이면 그 날(daily.ts의 dayIndexOf). 여느 판이면 null. */
  private get dailyDay(): number | null {
    return dailyDayOf(this.run.seed);
  }

  /** 여느 판과 오늘의 판을 바꿀 수 있는지: 아직 한 번도 돌리지 않은 판에서만 바꾼다. */
  private canSwitchMode(): boolean {
    const { run } = this;
    return !this.busy && run.phase === 'spin' && run.round === 1 && run.spinCount === 0;
  }

  /**
   * 판을 열 때 한 번 부른다. 오늘의 판으로 열어 달라고 했으면("다시 하기"나 공유받은 주소) 오늘의 판으로 바꾸고,
   * 시작 화면에 판을 바꾸는 버튼을 놓고, 기기에 저장해 둔 오늘의 기록을 읽어 온다.
   */
  private setUpDaily(): void {
    const start = this.dailyStart;
    const today = dayIndexOf(new Date());
    const shared = start.sharedDay !== undefined;
    if ((start.daily === true || shared) && this.dailyDay === null && this.canSwitchMode()) {
      this.run = newRun(dailySeed(today));
      this.refreshNumbers();
    }
    // 지난 날의 판은 다시 할 수 없어서 오늘의 판을 열고 그렇다고 알린다. 오늘의 것이면 친구의 점수를 넘어 볼 기록으로 보인다.
    this.sharedDayPassed = shared && start.sharedDay !== today;
    this.friendScore = friendScoreOf(start.sharedDay, start.sharedScore, today);
    this.showDailySwitch();

    let alive = true;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      alive = false;
    });
    void slotDailyStore.refresh().then(() => {
      if (alive) this.refreshDailyNote();
    });
  }

  /**
   * 시작 화면의 도움말 카드 바로 위에 판을 바꾸는 버튼을 놓는다. 여느 판에서는 오늘의 판으로,
   * 오늘의 판에서는 여느 판으로 돌아가는 버튼이고, 오늘의 판이면 그 위에 오늘의 기록을 한 줄 적는다.
   */
  private showDailySwitch(): void {
    this.hideDailySwitch();
    if (this.hints.length === 0 || !this.canSwitchMode()) return;
    const daily = this.dailyDay !== null;
    const { width, height, gap } = DAILY_SWITCH;
    // 도움말 카드의 위쪽 끝은 기계의 한가운데에서 23만큼 위다(showHints).
    const box = {
      x: Math.round(GAME_WIDTH / 2 - width / 2),
      y: Math.round(this.machineMiddle - 23 - gap - height),
      width,
      height,
    };
    const label = daily ? DAILY_LABEL.back : DAILY_LABEL.name;
    this.dailySwitch = new SoftButton(this, box, daily ? 'plain' : 'mint', DEPTH.hint, label, () => this.switchMode());
    if (!daily) return;
    const middle = box.y - DAILY_INFO.gap - DAILY_INFO.height / 2;
    this.dailyNote = {
      back: this.add.graphics().setDepth(DEPTH.hint),
      text: addText(this, GAME_WIDTH / 2, middle, '', {
        size: FONT_SIZE.small,
        color: LOOK.text.ink,
        originX: 0.5,
        originY: 0.5,
      }).setDepth(DEPTH.hint + 0.5),
    };
    this.refreshDailyNote();
  }

  /** 판을 바꾸는 버튼과 그 위의 한 줄을 치운다. 첫 스핀을 돌리면 도움말과 함께 사라진다. */
  private hideDailySwitch(): void {
    this.dailySwitch?.destroy();
    this.dailySwitch = null;
    this.dailyNote?.back.destroy();
    this.dailyNote?.text.destroy();
    this.dailyNote = null;
  }

  /** 버튼 위의 한 줄을 지금의 기록대로 적는다: 지난 날의 주소로 왔다는 것, 넘어 볼 친구 기록, 아니면 오늘의 최고 기록. */
  private refreshDailyNote(): void {
    const note = this.dailyNote;
    if (!note) return;
    const today = dayIndexOf(new Date());
    const record = dailyToday(slotDailyStore.data, today);
    const friend = this.friendScore;
    const line = this.sharedDayPassed
      ? SHARED_DAY_PASSED
      : friend !== null && !(record.tries > 0 && record.best > friend)
        ? friendNotice(friend)
        : dailyInfo(record, today);
    // 화면보다 넓은 줄은 그만큼 줄인다.
    note.text.setScale(1).setText(line);
    note.text.setScale(Math.min(1, (GAME_WIDTH - 40) / note.text.width));
    const width = Math.ceil(note.text.displayWidth) + 16;
    const { height } = DAILY_INFO;
    const x = Math.round(GAME_WIDTH / 2 - width / 2);
    const y = Math.round(note.text.y - height / 2);
    note.back.clear();
    note.back.fillStyle(LOOK.machine.trimLip, 1);
    note.back.fillRoundedRect(x, y + 1, width, height, height / 2);
    note.back.fillStyle(LOOK.machine.slotAlt, 1);
    note.back.fillRoundedRect(x, y, width, height, height / 2);
  }

  /** 여느 판과 오늘의 판을 바꾼다. 아직 돌리지 않은 판이라 새 판으로 갈아 끼우기만 하면 된다. */
  private switchMode(): void {
    if (!this.playing || !this.canSwitchMode()) return;
    this.run = newRun(this.dailyDay === null ? dailySeed(dayIndexOf(new Date())) : null);
    this.refreshNumbers();
    this.showDailySwitch();
    // 오늘의 판으로 바꿨으면 점수 아래의 표시가 스르르 나타나 어디가 달라졌는지 알린다.
    const badge = this.dailyBadge;
    if (this.dailyDay === null || !badge) return;
    this.tweens.killTweensOf([badge.back, badge.text]);
    this.tweens.add({ targets: [badge.back, badge.text], alpha: { from: 0, to: 1 }, duration: 220 });
  }

  /** 오늘의 판을 하는 동안 점수 아래에 작은 표시를 띄워 둔다. 여느 판이면 감춘다. */
  private refreshDailyBadge(): void {
    const daily = this.dailyDay !== null;
    if (!this.dailyBadge) {
      if (!daily) return;
      const { y, height } = DAILY_BADGE;
      const text = addText(this, GAME_WIDTH / 2, y, DAILY_LABEL.name, {
        size: FONT_SIZE.small,
        color: LOOK.text.ink,
        originX: 0.5,
        originY: 0.5,
      }).setDepth(DEPTH.hud);
      const width = Math.ceil(text.width) + 14;
      const left = Math.round(GAME_WIDTH / 2 - width / 2);
      const back = this.add.graphics().setDepth(DEPTH.hud - 0.5);
      back.fillStyle(LOOK.machine.trimLip, 1);
      back.fillRoundedRect(left, y - height / 2 + 2, width, height, height / 2);
      back.fillStyle(LOOK.machine.trim, 1);
      back.fillRoundedRect(left, y - height / 2, width, height, height / 2);
      this.dailyBadge = { back, text };
    }
    this.dailyBadge.back.setVisible(daily);
    this.dailyBadge.text.setVisible(daily);
  }

  /**
   * 끝난 판이 오늘의 판이면 그날의 기록에 보태고, 결과 화면에 적을 줄과 공유할 것을 돌려준다. 여느 판이면 null.
   * 오늘 시작한 오늘의 판만 그날의 기록에 남는다. 날이 넘어간 뒤에 끝낸 판은 여느 판으로 친다.
   */
  private recordDaily(): { stats: ResultStat[]; share: ShareOverride } | null {
    const today = dayIndexOf(new Date());
    if (this.dailyDay !== today) return null;
    const result = { score: scoreOf(this.run), rounds: clearedRounds(this.run) };
    const outcome = addDailyRun(slotDailyStore.data, today, result);
    slotDailyStore.set(outcome.record);
    const stats: ResultStat[] = [[DAILY_LABEL.name, dailyVerdict(outcome)]];
    if (this.friendScore !== null) stats.push([DAILY_LABEL.friend, friendVerdict(this.friendScore, result.score)]);
    return { stats, share: dailyShare(today, result, outcome.record.streak) };
  }

  /** 오늘의 판을 마쳤으면 결과 화면의 "다시 하기"가 오늘의 판을 다시 연다. 넘어 볼 친구 기록도 이어서 넘긴다. */
  protected override retryData(): SlotStart | undefined {
    const day = this.dailyDay;
    if (day === null) return undefined;
    if (this.friendScore === null) return { daily: true };
    return { daily: true, sharedDay: day, sharedScore: this.friendScore };
  }

  // ───────── 붙인 부적 ─────────

  private onSlotTap(slot: number): void {
    if (!this.playing) return;
    const id = this.run.charms[slot];
    const charm = id ? charmOf(id) : undefined;
    if (!charm) {
      this.hideBubble();
      return;
    }
    sfx.click();
    this.showBubble(slot, charm.name, charm.description);
  }

  /** 붙인 부적의 이름과 설명을 그 위에 띄운다. 가게에서는 떼는 버튼이 같이 뜬다. */
  private showBubble(slot: number, name: string, description: string): void {
    this.hideBubble();
    const { slots, slotSize } = this.layout;
    const canDiscard = this.run.phase === 'shop' && !this.busy;
    const box = { x: 16, y: slots[0].y - 50, width: GAME_WIDTH - 32, height: 44 };
    const depth = DEPTH.bubble;

    const back = this.add.graphics().setDepth(depth);
    drawPanel(back, box.x, box.y, box.width, box.height, { radius: 10, border: LOOK.machine.trim });
    // 어느 부적의 설명인지 가리키는 꼬리
    const tipX = slots[slot].x + slotSize / 2;
    back.fillStyle(LOOK.machine.trim, 1);
    back.fillTriangle(tipX - 6, box.y + box.height - 1, tipX + 6, box.y + box.height - 1, tipX, box.y + box.height + 6);
    const title = addText(this, box.x + 10, box.y + 6, name, { color: LOOK.text.ink }).setDepth(depth);
    const body = addText(this, box.x + 10, box.y + 24, description, {
      size: FONT_SIZE.small,
      color: LOOK.text.sub,
    }).setDepth(depth);
    const views: Disposable[] = [back, title, body];
    const zones: Phaser.GameObjects.GameObject[] = [];
    if (canDiscard) {
      const button = new SoftButton(
        this,
        { x: box.x + box.width - 54, y: box.y + 8, width: 46, height: 28 },
        'coral',
        depth,
        '떼기',
        () => this.discardSlot(slot),
      );
      // 설명의 창이나 그 안의 버튼을 누른 것으로는 창을 닫지 않는다. 닫히면 버튼이 손을 떼기 전에 사라져 눌리지 않는다.
      const area = this.add.zone(box.x, box.y, box.width, box.height).setOrigin(0, 0).setInteractive().setDepth(depth - 1);
      views.push(button, area);
      zones.push(button.zone, area);
    }
    this.bubble = { views, zones };
  }

  private hideBubble(): void {
    if (!this.bubble) return;
    for (const view of this.bubble.views) view.destroy();
    this.bubble = null;
  }

  private discardSlot(slot: number): void {
    if (!this.playing || this.run.phase !== 'shop') return;
    const next = discard(this.run, slot);
    this.hideBubble();
    if (next === this.run) return;
    this.run = next;
    sfx.pull();
    this.refreshNumbers();
    this.refreshSlots();
    this.refreshOdds(true);
    this.refreshShop();
  }
}
