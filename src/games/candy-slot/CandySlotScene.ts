import Phaser from 'phaser';
import { TEXTURE } from '../../art/sprites';
import { FONT_SIZE, GAME_WIDTH, SCENE, THEME } from '../../config';
import { vibrate } from '../../core/haptics';
import { reducedMotion } from '../../core/motion-guard';
import { sfx, tone } from '../../core/sfx';
import { addTapZone, addText, drawPanel } from '../../core/ui';
import { floatText, GameHud, HUD_HEIGHT, showBanner } from '../../scenes/GameHud';
import { MiniGameScene, type ResultStrip } from '../../scenes/MiniGameScene';
import {
  COIN_ICON,
  coinTexture,
  CHARM_BOX,
  charmChipTexture,
  charmTexture,
  drawBulbs,
  drawFelt,
  drawHoldFrame,
  drawLock,
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
  buy,
  buyBlock,
  canHold,
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
  WILD,
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
/** 맞았을 때 전구가 빨라지는 간격과 그렇게 깜빡이는 시간(ms): 작게 맞았을 때, 크게 맞았을 때 */
const BULB_QUICK_MS = 150;
const BULB_QUICK_FOR_MS = 700;
const BULB_PARTY_MS = 70;
const BULB_PARTY_FOR_MS = 1700;
/** 크게 맞았을 때 금화가 솟는 횟수와 그 간격(ms) */
const PARTY_BURSTS = 5;
const PARTY_BURST_MS = 280;
/** 크게 축하하려면 적어도 이만큼은 받아야 한다. 첫 라운드는 목표가 작아서, 비율만 보면 거의 모든 줄이 크게 맞은 것이 된다. */
const BIG_WIN_MIN = 8;
/** 결과가 저절로 다 보인 뒤 이 시간(ms) 안에 기계를 누른 것은 건너뛰려던 것으로 보고 열을 잠그지 않는다. */
const HOLD_GRACE_MS = 300;
/** 열을 잠그는 법을 처음 알리는 글이 떠 있는 시간(ms) */
const HOLD_TIP_MS = 2600;
const HOLD_NOTES = {
  how: '열을 누르면 한 번 잠글 수 있어요',
  first: '한 번 돌린 뒤에 잠글 수 있어요',
  used: '잠그기는 라운드마다 한 번이에요',
} as const;
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

const DEPTH = {
  machine: 1,
  glow: 2,
  /** 첫 라운드에 보여 주는 여덟 줄의 길잡이. 맞은 칸의 빛 위, 맞은 줄의 선 아래에 깔린다. */
  guide: 2.2,
  /** 맞은 줄을 긋는 선. 그림 밑에 깔려서, 선이 지나가도 무슨 그림인지 그대로 보인다. */
  line: 2.5,
  cell: 3,
  /** 잠근 열을 두르는 금테와 자물쇠. 그림 위에 놓인다. */
  hold: 3.5,
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

/** 결과를 보여 주고 있는 스핀. 건너뛸 때 어디까지 보여 줬는지 알아야 해서 적어 둔다. */
interface Showing {
  outcome: SpinOutcome;
  /** 이미 그은 맞은 줄의 수 */
  lines: number;
  /** 곱해진 상금을 알렸는지 */
  boosted: boolean;
  /** 기계가 축하했는지 */
  cheered: boolean;
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
  /** 결과를 보여 주고 있는 스핀과, 그것을 차례로 보여 주려고 걸어 둔 일들. 건너뛰면 남은 일을 거둔다. */
  private showing: Showing | null = null;
  private showTimers: Phaser.Time.TimerEvent[] = [];
  /** 다음 스핀에서 잠그려고 골라 둔 열과, 지금 돌고 있는 스핀에서 잠가 둔 열. 없으면 null이다. */
  private holdCol: number | null = null;
  private heldNow: number | null = null;
  private holdFx!: Graphics;
  private holdChip!: Graphics;
  private holdCount!: Text;
  /** 열을 잠그는 법을 이미 알렸는지 */
  private holdTold = false;
  /** 결과가 저절로 다 보여서 다음 스핀을 받기 시작한 때(씬의 시계) */
  private idleAt = 0;
  private bulbs!: Graphics;
  private bulbPhase = 0;
  /** 전구가 돌아가며 켜지는 중인지(크게 맞았을 때) */
  private bulbChase = false;
  private bulbTimer: Phaser.Time.TimerEvent | null = null;
  private bulbCalm: Phaser.Time.TimerEvent | null = null;
  /** 크게 맞았을 때 솟는 금화. 처음 쓸 때 만든다. */
  private coins: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  /** 받았지만 아직 화면의 수에 넣지 않은 금화. 맞은 줄을 하나씩 보여 주는 동안 줄어든다. */
  private pending = 0;
  private hints: Array<Text | Graphics> = [];
  /** 가게가 열려 있는 동안 떠 있는 것들 */
  private shopViews: Disposable[] = [];
  private offerRows: Array<OfferRow | null> = [];
  private rerollButton: SoftButton | null = null;
  /** 붙인 부적을 눌렀을 때 뜨는 설명 */
  private bubble: { views: Disposable[]; zones: Phaser.GameObjects.GameObject[] } | null = null;

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
    sfx.go();
    this.playing = true;
  }

  override update(_time: number, deltaMs: number): void {
    const reel = this.reel;
    if (!reel) return;
    reel.elapsed += deltaMs;
    reel.sinceFlick += deltaMs;
    // 잠근 열은 돌지 않는다. 나머지 열만 왼쪽부터 차례로 멈춘다.
    const cols = this.spinningCols();
    while (reel.stopped < cols.length && reel.elapsed >= STOP_FIRST_MS + STOP_STEP_MS * reel.stopped) {
      this.stopColumn(cols[reel.stopped], reel.outcome.grid);
      reel.stopped += 1;
    }
    if (reel.stopped >= cols.length) {
      this.reel = null;
      this.showOutcome(reel.outcome);
      return;
    }
    if (reel.sinceFlick < (reducedMotion() ? FLICK_CALM_MS : FLICK_MS)) return;
    reel.sinceFlick = 0;
    const turning = cols.slice(reel.stopped);
    for (let cell = 0; cell < CELLS; cell += 1) {
      if (!turning.includes(cell % SIZE)) continue;
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
    this.showing = null;
    this.showTimers = [];
    this.holdCol = null;
    this.heldNow = null;
    this.holdTold = false;
    this.idleAt = 0;
    this.bulbPhase = 0;
    this.bulbChase = false;
    this.bulbTimer = null;
    this.bulbCalm = null;
    this.coins = null;
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
    this.bulbs = this.add.graphics().setDepth(DEPTH.machine);
    this.blinkBulbs();
    this.paceBulbs(BULB_MS);
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
    this.addHold();
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

  /**
   * 가진 금화, 목표, 남은 스핀, 점수를 지금 상태대로 적는다. 아직 보여 주지 않은 금화(pending)은 뺀다.
   * 남은 잠그기와 돌리기 버튼의 글도 같이 맞춘다.
   */
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
    this.refreshHold();
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
    const onKey = (event: KeyboardEvent): void => {
      // 누르고 있어서 되풀이되는 것은 받지 않는다. 건너뛰기와 돌리기가 번갈아 쏟아지지 않게 한다.
      if (!event.repeat) this.trySpin();
    };
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
    // 돌고 있거나 결과를 보여 주는 중에 누른 것은 건너뛰기다. 그 누름으로 다음 스핀까지 돌리지는 않는다.
    if (this.skipSpin()) return;
    if (!this.playing || this.busy || this.run.phase !== 'spin') return;
    const result = spin(this.run, randomOf(this.run, 'spin', Math.random), this.holdCol);
    if (!result) return;
    // 잠그기 횟수가 줄었으면 골라 둔 열이 잠긴 것이다.
    this.heldNow = result.run.holdsLeft < this.run.holdsLeft ? this.holdCol : null;
    this.holdCol = null;
    this.hideHints();
    this.hideGuide();
    this.hideBubble();
    this.clearWins();
    this.busy = true;
    this.run = result.run;
    this.pending = result.outcome.total;
    this.reel = { outcome: result.outcome, elapsed: 0, sinceFlick: 0, stopped: 0 };
    this.refreshNumbers();
    for (const image of this.cells) {
      this.tweens.killTweensOf(image);
      image.setScale(this.cellScale * 0.92).setAlpha(0.8);
    }
    this.keepHeld();
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
    this.showing = { outcome, lines: 0, boosted: false, cheered: false };
    if (wins.length === 0) {
      const { goal } = this.layout;
      sfx.expire();
      this.note('꽝', LOOK.text.sub);
      this.floatCoin(goal.x + goal.width / 2, goal.y + goal.height, outcome.total);
      this.later(MISS_MS, () => this.afterSpin(outcome));
      return;
    }
    const step = Math.min(LINE_STEP_MS, LINES_MAX_MS / wins.length);
    wins.forEach((win, index) => this.later(index * step, () => this.showWin(win, index)));
    const linesEnd = wins.length * step;
    const boosted = outcome.boosts.length > 0;
    if (boosted) this.later(linesEnd, () => this.showBoosts(outcome));
    this.later(linesEnd + (boosted ? BOOST_MS : 0), () => this.afterSpin(outcome));
  }

  /**
   * 맞은 줄 하나: 줄을 긋고, 세 칸이 튀고, 그 줄의 금화가 떠오른다.
   * quiet면 줄만 긋는다(건너뛸 때 남은 줄을 한꺼번에 그을 때).
   */
  private showWin(win: LineWin, order: number, quiet = false): void {
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
    if (this.showing) this.showing.lines = order + 1;
    if (quiet) return;

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
    if (this.showing) this.showing.boosted = true;
    showBanner(this, this.machineMiddle, `${label} ${times}배`, LOOK.text.points, BOOST_MS + 200, DEPTH.banner, FONT_SIZE.large);
    sfx.gold();
    vibrate([15, 30, 15]);
    this.sparks.setParticleTint(THEME.gold);
    this.sparks.explode(14, GAME_WIDTH / 2, this.machineMiddle);
    this.cheer(outcome);
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
    // 크게 맞았으면 기계가 종을 울리므로 금화 소리는 겹쳐 내지 않는다.
    const big = this.cheer(outcome);
    this.showing = null;
    this.showTimers = [];
    this.heldNow = null;
    this.refreshNumbers();
    if (outcome.wins.length > 0) {
      const { goal } = this.layout;
      this.floatCoin(goal.x + goal.width / 2, goal.y + goal.height, outcome.total);
      if (!big && outcome.total >= targetOf(this.run.round) * BIG_WIN_RATIO && outcome.boosts.length === 0) sfx.coin();
    }
    if (this.run.spinsLeft > 0) {
      this.busy = false;
      this.idleAt = this.time.now;
      this.spinButton.setEnabled(true);
      // 맞은 줄을 보여 주는 동안에는 길잡이를 겹쳐 긋지 않는다.
      if (outcome.wins.length === 0) this.showGuide();
      this.tellHold();
      return;
    }
    // 라운드를 맺는 동안에는 건너뛸 것이 없다.
    this.spinButton.setEnabled(false);
    this.time.delayedCall(SETTLE_DELAY_MS, () => this.settle());
  }

  // ───────── 건너뛰기 ─────────

  /** 결과를 차례로 보여 주는 일을 걸어 둔다. 건너뛰면 아직 하지 않은 것은 거둔다. */
  private later(ms: number, task: () => void): void {
    this.showTimers.push(this.time.delayedCall(ms, task));
  }

  /**
   * 돌고 있는 스핀이나 보여 주고 있는 결과를 끝까지 건너뛴다: 모든 열을 멈추고, 남은 줄을 한꺼번에 긋고, 수를 맞춘다.
   * 건너뛴 것이 있으면 true를 돌려준다. 받은 금화는 돌릴 때 이미 run에 들어갔으므로, 건너뛰어도 잃거나 두 번 받지 않는다.
   */
  private skipSpin(): boolean {
    if (!this.playing) return false;
    const reel = this.reel;
    if (reel) {
      // 아직 돌고 있으면 다 멈춘 것으로 친다. 꽝은 여기서 바로 알린다.
      this.reel = null;
      this.showOutcome(reel.outcome);
    }
    const showing = this.showing;
    if (!showing) return false;
    for (const timer of this.showTimers) timer.remove();
    this.showTimers = [];

    const { outcome } = showing;
    this.cells.forEach((image, cell) => {
      this.tweens.killTweensOf(image);
      image.setTexture(symbolTexture(this, outcome.grid[cell])).setScale(this.cellScale).setAlpha(1);
    });
    const rest = outcome.wins.slice(showing.lines);
    rest.forEach((win, index) => this.showWin(win, showing.lines + index, true));
    if (rest.length > 0) {
      // 줄마다 따로 튀고 울리는 대신, 방금 그은 줄의 칸들이 한 번에 튄다. 받은 금화는 afterSpin이 한 번에 띄운다.
      this.sparks.setParticleTint(THEME.gold);
      for (const cell of new Set(rest.flatMap((win) => LINES[win.line].cells))) {
        const { x, y } = this.centerOf(cell);
        this.tweens.add({
          targets: this.cells[cell],
          scale: this.cellScale * 1.2,
          duration: 110,
          yoyo: true,
          ease: 'Quad.Out',
        });
        this.sparks.explode(2, x, y);
      }
      sfx.hit(outcome.wins.length * 2);
      vibrate(10);
    }
    if (outcome.boosts.length > 0 && !showing.boosted) this.showBoosts(outcome);
    this.afterSpin(outcome);
    // 건너뛴 뒤에는 기계를 바로 눌러 열을 잠글 수 있다.
    this.idleAt = 0;
    return true;
  }

  // ───────── 열 잠그기 ─────────

  /** 남은 잠그기를 적는 작은 표의 자리. 기계의 오른쪽 옆, 화면 가장자리와의 사이에 놓인다. */
  private get holdChipBox(): Box {
    const { machine } = this.layout;
    return { x: machine.x + machine.width + 3, y: machine.y + 4, width: 20, height: 34 };
  }

  /** 잠그기를 알리는 글이 뜨는 높이. 기계의 아래쪽 가장자리라서 그림과 길잡이를 거의 가리지 않는다. */
  private get holdNoteY(): number {
    return this.layout.machine.y + this.layout.machine.height - 3;
  }

  /** 잠근 열의 금테, 남은 잠그기를 적는 표, 열마다 누르는 자리를 놓는다. */
  private addHold(): void {
    const { machine, cell, gridLeft } = this.layout;
    const chip = this.holdChipBox;
    this.holdFx = this.add.graphics().setDepth(DEPTH.hold);
    this.holdChip = this.add.graphics().setDepth(DEPTH.panel);
    this.holdCount = addText(this, chip.x + chip.width / 2, chip.y + chip.height - 9, '', {
      originX: 0.5,
      originY: 0.5,
    }).setDepth(DEPTH.panel);
    addTapZone(
      this,
      chip.x - 3,
      chip.y - 3,
      chip.width + 6,
      chip.height + 6,
      () => undefined,
      () => this.explainHold(),
    );
    // 열마다 누르는 자리. 양 끝 열은 몸통의 테두리까지 넓힌다.
    for (let col = 0; col < SIZE; col += 1) {
      const left = col === 0 ? machine.x : gridLeft + col * cell;
      const right = col === SIZE - 1 ? machine.x + machine.width : gridLeft + (col + 1) * cell;
      // 부적의 설명이 떠 있을 때 누른 것은 설명을 치우는 것으로 끝낸다.
      let closing = false;
      addTapZone(
        this,
        left,
        machine.y,
        right - left,
        machine.height,
        (pressed) => {
          if (pressed) closing = this.bubble !== null;
        },
        () => {
          if (!closing) this.onColumnTap(col);
        },
      );
    }
  }

  /** 잠근 열의 금테, 남은 잠그기의 표, 돌리기 버튼의 글을 지금 상태대로 맞춘다. */
  private refreshHold(): void {
    const { run } = this;
    const { cell, gridLeft, gridTop } = this.layout;
    const able = canHold(run);
    // 잠글 수 없게 되면(잠그기를 썼거나 라운드가 끝났으면) 골라 둔 열도 풀린다.
    if (!able) this.holdCol = null;
    const col = this.heldNow ?? this.holdCol;
    this.holdFx.clear();
    if (col !== null) drawHoldFrame(this.holdFx, gridLeft + col * cell, gridTop, cell);

    // 표는 스핀을 돌리는 동안에만 보인다. 지금 잠글 수 있으면 금테를 두르고, 아니면 흐리게 둔다.
    const chip = this.holdChipBox;
    const shown = run.phase === 'spin';
    this.holdChip.clear().setVisible(shown);
    drawPanel(this.holdChip, chip.x, chip.y, chip.width, chip.height, {
      radius: 8,
      depth: 2,
      border: able ? LOOK.hold.frame : undefined,
    });
    drawLock(this.holdChip, chip.x + chip.width / 2, chip.y + 10, 5, able ? LOOK.hold.lock : LOOK.hold.off, THEME.card);
    this.holdCount
      .setVisible(shown)
      .setText(String(run.holdsLeft))
      .setColor(able ? LOOK.text.ink : LOOK.text.faint);

    const skippable = this.reel !== null || this.showing !== null;
    this.spinButton.setLabel(skippable ? '건너뛰기' : this.holdCol !== null ? '잠그고 돌리기' : '돌리기');
  }

  /** 기계의 열을 눌렀을 때: 스핀을 보여 주는 중이면 건너뛰고, 기다리는 중이면 그 열을 잠그거나 푼다. */
  private onColumnTap(col: number): void {
    if (!this.playing || this.run.phase !== 'spin') return;
    if (this.busy) {
      this.skipSpin();
      return;
    }
    if (this.time.now - this.idleAt < HOLD_GRACE_MS) return;
    if (!canHold(this.run)) {
      this.explainHold();
      return;
    }
    // 고른 열을 다시 누르면 풀리고, 다른 열을 누르면 그 열로 옮겨 간다.
    const locked = this.holdCol !== col;
    this.holdCol = locked ? col : null;
    this.refreshHold();
    for (let row = 0; row < SIZE; row += 1) {
      const image = this.cells[row * SIZE + col];
      this.tweens.killTweensOf(image);
      image.setScale(this.cellScale);
      if (locked) {
        this.tweens.add({
          targets: image,
          scale: { from: this.cellScale * 1.12, to: this.cellScale },
          duration: 180,
          ease: 'Back.Out',
        });
      }
    }
    if (locked) {
      tone(392, 0.04, { volume: 0.3 });
      tone(784, 0.07, { type: 'triangle', volume: 0.35, delay: 0.04 });
    } else {
      tone(784, 0.07, { type: 'triangle', slideTo: 392, volume: 0.3 });
    }
    vibrate(8);
  }

  /** 지금 열을 잠글 수 있는지, 없으면 왜인지를 알린다. 처음의 도움말이 떠 있는 동안에는 말을 보태지 않는다. */
  private explainHold(): void {
    if (!this.playing || this.busy || this.run.phase !== 'spin' || this.hints.length > 0) return;
    if (canHold(this.run)) {
      this.holdNote(HOLD_NOTES.how);
      return;
    }
    sfx.deny();
    this.holdNote(this.run.holdsLeft > 0 ? HOLD_NOTES.first : HOLD_NOTES.used);
  }

  /** 첫 라운드에서 열을 잠글 수 있게 된 첫 순간에 한 번, 잠그는 법을 알린다. */
  private tellHold(): void {
    if (this.holdTold || this.run.round > GUIDE_ROUNDS || !canHold(this.run)) return;
    this.holdTold = true;
    this.holdNote(HOLD_NOTES.how, HOLD_TIP_MS);
  }

  private holdNote(label: string, ms = 1300): void {
    showBanner(this, this.holdNoteY, label, LOOK.text.points, ms, DEPTH.banner, FONT_SIZE.normal + 2);
  }

  /** 이번 스핀에서 도는 열들. 잠근 열은 빠진다. */
  private spinningCols(): number[] {
    return Array.from({ length: SIZE }, (_, col) => col).filter((col) => col !== this.heldNow);
  }

  /** 잠근 열의 세 칸은 돌지 않고 또렷하게 그대로 둔다. */
  private keepHeld(): void {
    const col = this.heldNow;
    if (col === null) return;
    for (let row = 0; row < SIZE; row += 1) this.cells[row * SIZE + col].setScale(this.cellScale).setAlpha(1);
    tone(523, 0.05, { type: 'triangle', volume: 0.3, delay: 0.03 });
  }

  // ───────── 축하 ─────────

  /** 전구를 지금 차례대로 그리고 차례를 넘긴다. */
  private blinkBulbs(): void {
    const { machine, cell } = this.layout;
    this.bulbs.clear();
    drawBulbs(this.bulbs, machine.x, machine.y, cell, MACHINE_FRAME, this.bulbPhase, this.bulbChase);
    // 번갈아 켤 때(둘)와 돌아가며 켤 때(셋)에 모두 맞게 여섯 차례로 돈다.
    this.bulbPhase = (this.bulbPhase + 1) % 6;
  }

  /** 전구가 깜빡이는 간격을 정한다. 움직임을 줄인 기기에서는 깜빡이지 않고 켜 둔 그대로 둔다. */
  private paceBulbs(ms: number, chase = false): void {
    this.bulbTimer?.remove();
    this.bulbTimer = null;
    this.bulbChase = chase;
    if (reducedMotion()) return;
    this.bulbTimer = this.time.addEvent({ delay: ms, loop: true, callback: () => this.blinkBulbs() });
  }

  /** 전구를 한동안 빠르게 깜빡이게 했다가 여느 빠르기로 돌린다. */
  private rushBulbs(ms: number, forMs: number, chase: boolean): void {
    // 크게 맞아 돌아가고 있는 전구를 작게 맞은 스핀이 끊지 않는다.
    if (reducedMotion() || (this.bulbChase && !chase)) return;
    this.bulbCalm?.remove();
    this.paceBulbs(ms, chase);
    this.blinkBulbs();
    this.bulbCalm = this.time.delayedCall(forMs, () => this.paceBulbs(BULB_MS));
  }

  /** 크게 축하할 스핀인지: 아홉 칸이 다 맞았거나, 진짜 7 셋이 한 줄에 놓였거나, 한 번에 많이 받았을 때 */
  private isBigWin(outcome: SpinOutcome): boolean {
    if (outcome.wins.length === 0) return false;
    if (outcome.jackpot || outcome.wins.some((win) => win.symbol === WILD)) return true;
    return outcome.total >= Math.max(BIG_WIN_MIN, targetOf(this.run.round) * BIG_WIN_RATIO);
  }

  /**
   * 맞은 스핀을 기계가 축하한다. 작게 맞으면 전구가 잠깐 빨라지고, 크게 맞으면 전구가 돌아가며 켜지고 금화가 솟고 종이 울린다.
   * 한 스핀에 한 번만 한다. 크게 맞은 스핀이면 true를 돌려준다.
   */
  private cheer(outcome: SpinOutcome): boolean {
    const big = this.isBigWin(outcome);
    const showing = this.showing;
    if (!showing || showing.cheered || outcome.wins.length === 0) return big;
    showing.cheered = true;
    if (!big) {
      this.rushBulbs(BULB_QUICK_MS, BULB_QUICK_FOR_MS, false);
      return false;
    }
    this.rushBulbs(BULB_PARTY_MS, BULB_PARTY_FOR_MS, true);
    // 종소리: 높은 두 음이 빠르게 번갈아 울리다가 한 음 올라가 맺는다. 줄과 곱의 소리가 지나간 뒤에 울린다.
    const bell = [1319, 1568, 1319, 1568, 1319, 1568, 2093];
    bell.forEach((note, index) =>
      tone(note, index === bell.length - 1 ? 0.32 : 0.08, { type: 'triangle', volume: 0.4, delay: 0.22 + index * 0.085 }),
    );
    vibrate([20, 40, 20, 40, 40]);
    this.burstCoins();
    // 움직임을 줄인 기기에서는 금화가 한 번만 솟는다.
    if (!reducedMotion()) {
      this.time.addEvent({ delay: PARTY_BURST_MS, repeat: PARTY_BURSTS - 2, callback: () => this.burstCoins() });
    }
    return true;
  }

  /** 기계 한가운데에서 금화가 솟았다가 떨어지고, 몸통의 테두리 어딘가에서 불꽃이 튄다. */
  private burstCoins(): void {
    const { machine } = this.layout;
    this.coins ??= this.add
      .particles(0, 0, coinTexture(this), {
        speedX: { min: -80, max: 80 },
        speedY: { min: -200, max: -90 },
        gravityY: 460,
        lifespan: { min: 700, max: 1000 },
        alpha: { start: 1, end: 0, ease: 'Cubic.In' },
        emitting: false,
      })
      .setDepth(DEPTH.effect);
    this.coins.explode(7, machine.x + machine.width / 2, this.machineMiddle);
    const side = Math.floor(Math.random() * 4);
    const along = Math.random();
    const x = side % 2 === 0 ? machine.x + along * machine.width : machine.x + (side === 1 ? machine.width : 0);
    const y = side % 2 === 1 ? machine.y + along * machine.height : machine.y + (side === 2 ? machine.height : 0);
    this.sparks.setParticleTint(THEME.gold);
    this.sparks.explode(8, x, y);
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
    this.finishMiniGame(
      scoreOf(run),
      [
        ['넘긴 라운드', `${clearedRounds(run)}번`],
        ['가장 큰 한 방', `금화 ${run.bestSpin}개`],
      ],
      OVER_RESULT_MS,
      strip,
    );
  }

  /** 끝이 정해져 있지 않은 게임이라, 점수가 있으면 일시정지 화면에서 기록하고 끝낼 수 있다. */
  protected override canFinishEarly(): boolean {
    return this.playing && scoreOf(this.run) > 0;
  }

  protected override finishEarly(): void {
    // 돌고 있던 스핀은 결과까지 보여 주고 끝낸다.
    this.skipSpin();
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
