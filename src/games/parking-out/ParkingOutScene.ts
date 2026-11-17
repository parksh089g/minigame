import Phaser from 'phaser';
import { TEXTURE } from '../../art/sprites';
import { GAME_WIDTH, SCENE, THEME, THEME_CSS } from '../../config';
import { vibrate } from '../../core/haptics';
import { sfx } from '../../core/sfx';
import { StartGate } from '../../core/start-gate';
import { addBackdrop, addText, drawPanel } from '../../core/ui';
import { floatText, GameHud, HUD_HEIGHT, showBanner } from '../../scenes/GameHud';
import { MiniGameScene, type ResultStat } from '../../scenes/MiniGameScene';
import {
  BUMP_PENALTY_SECONDS,
  canLeave,
  carAt,
  elapse,
  chancesLeft,
  isOver,
  levelRun,
  levelStage,
  isVertical,
  LONG_CAR,
  lotLayout,
  newRun,
  nextStage,
  tapCell,
  TIME_BANK_SECONDS,
  type Car,
  type Facing,
  type Lot,
  type LotLayout,
  type RunState,
  type TapOutcome,
} from './rules';

interface CarColors {
  /** 몸통 */
  face: number;
  /** 몸통 아래에 보이는 두께, 지붕의 화살표 */
  lip: number;
  /** 지붕과 짐칸 */
  soft: number;
}

interface CarView {
  car: Car;
  /** 차 그림을 담는 그릇. 원점은 차의 한가운데다. */
  container: Phaser.GameObjects.Container;
  /** 부딪혔을 때 차 위에서 번쩍이는 붉은 테두리와 막 */
  flash: Phaser.GameObjects.Graphics;
  /** 제자리의 좌표 */
  x: number;
  y: number;
  /** 앞차까지 갔다가 돌아오는 중인지. 그동안은 다시 눌러도 벌을 받지 않는다. */
  lurching: boolean;
}

type Exit = Extract<TapOutcome, { kind: 'exit' }>;
type Blocked = Extract<TapOutcome, { kind: 'blocked' }>;

/** 주차장 바닥을 두르는 흰 테두리의 폭 */
const RIM = 8;
/** 칸 가장자리에서 차까지의 틈 */
const CAR_INSET = 3;
/** 차 아래쪽에 보이는 두께 */
const CAR_LIP = 2.5;
/** 차가 화면 밖으로 빠져나가는 데 걸리는 시간(ms) */
const EXIT_MS = 320;
/** 꼬리와 아래 두께까지 화면 밖으로 나가도록 더 가는 거리 */
const EXIT_OVERSHOOT = 10;
/** 막힌 차가 앞차까지 가는 시간: 기본(ms)과 거리 1px마다 더해지는 시간(ms) */
const LURCH_MS = 70;
const LURCH_MS_PER_PX = 0.7;
/**
 * 부딪힌 차가 제자리로 돌아오는 시간(ms). 그동안은 그 차를 다시 눌러도 벌을 받지 않으므로,
 * 손가락이 두 번 닿아 시간을 두 번 잃지 않을 만큼은 길어야 한다.
 */
const LURCH_BACK_MS = 260;
/** 앞차에 닿은 뒤 더 밀고 들어가는 깊이, 받힌 차가 밀려나는 거리 */
const BUMP_PUSH = 1.5;
const JOLT = 2;
/** 주차장이 깔릴 때 차가 한 대씩 나타나는 간격과 한 대가 나타나는 시간(ms) */
const DEAL_STAGGER_MS = 16;
const DEAL_POP_MS = 150;
/** 마지막 차를 누른 뒤 "클리어!"가 뜨기까지, 그리고 다음 주차장이 깔리기까지(ms). 그동안 시간은 멈춘다. */
const CLEAR_BANNER_MS = 240;
const NEXT_LOT_MS = 1050;
/** 일시정지에서 돌아온 뒤 다시 시간이 흐르기까지의 여유(초). 가려져 있던 차들을 다시 볼 틈을 준다. */
const RESUME_GRACE_SECONDS = 0.6;
/** 도움말이 떠 있는 시간(ms) */
const HINT_MS = 5000;

/**
 * 이 게임의 색을 한곳에 모아 둔다. 겉모습을 바꿀 때는 여기와 draw로 시작하는 함수들만 고치면 된다.
 */
const LOOK = {
  lot: {
    /** 바닥을 두르는 테두리. 여기를 넘어가면 주차장 밖이다. */
    rim: THEME.card,
    rimLip: THEME.shadow,
    asphalt: THEME.faint,
    /** 칸을 나누는 선 */
    line: THEME.white,
    /** 테두리에 그리는, 나가는 쪽을 가리키는 세모 */
    exit: THEME.faint,
  },
  /** 차의 색. 맞닿은 차끼리는 되도록 다른 색을 쓴다. */
  cars: [
    { face: THEME.pink, lip: THEME.pinkDeep, soft: THEME.pinkSoft },
    { face: THEME.mint, lip: THEME.mintDeep, soft: THEME.mintSoft },
    { face: THEME.butter, lip: THEME.butterDeep, soft: THEME.butterSoft },
    { face: THEME.lilac, lip: THEME.lilacDeep, soft: THEME.lilacSoft },
    { face: THEME.sky, lip: THEME.skyDeep, soft: THEME.skySoft },
    { face: THEME.coral, lip: THEME.coralDeep, soft: THEME.pinkSoft },
  ] as readonly CarColors[],
  /** 앞유리와 뒷유리 */
  glass: THEME.inkDeep,
  /** 앞머리의 전조등 */
  lamp: THEME.white,
  /** 막힌 차를 눌렀을 때 차에 두르는 번쩍임 */
  bumpFlash: THEME.bad,
  /** 차가 떠날 때 꼬리에서 이는 먼지, 판을 깼을 때의 꽃가루 */
  dust: [THEME.white, THEME.dim],
  confetti: [THEME.gold, THEME.pink, THEME.mintDeep, THEME.skyDeep],
  text: {
    hint: THEME_CSS.ink,
    hintSub: THEME_CSS.sub,
    outline: THEME_CSS.white,
    points: THEME_CSS.accent,
    penalty: THEME_CSS.bad,
    clear: THEME_CSS.good,
    ready: THEME_CSS.accent,
    over: THEME_CSS.accent,
  },
} as const;

/** 주차장, 차, HUD 자리를 덮는 배경은 깊이를 따로 주지 않고 만든 순서대로 겹친다. */
const DEPTH = { effect: 20, hud: 30, banner: 40 } as const;

/** 앞머리 쪽으로 1만큼 나아갈 때 화면 좌표가 바뀌는 양 */
const FORWARD: Readonly<Record<Facing, { x: number; y: number }>> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/**
 * 차를 그리는 붓. 자리를 "앞머리에서 뒤로 잰 거리(along)"와 "차의 왼쪽 옆에서 잰 거리(across)"로
 * 말하면, 차가 보는 방향에 맞게 돌려서 그린다. 원점은 차의 한가운데다.
 */
class CarBrush {
  constructor(
    private readonly graphics: Phaser.GameObjects.Graphics,
    private readonly facing: Facing,
    /** 차의 길이와 폭(px) */
    readonly length: number,
    readonly width: number,
  ) {}

  private point(along: number, across: number): { x: number; y: number } {
    const a = along - this.length / 2;
    const c = across - this.width / 2;
    switch (this.facing) {
      case 'up':
        return { x: c, y: a };
      case 'down':
        return { x: -c, y: -a };
      case 'left':
        return { x: a, y: -c };
      case 'right':
        return { x: -a, y: c };
    }
  }

  /** 앞머리에서 along, 왼쪽에서 across만큼 떨어진 곳에서 시작하는 네모가 화면에서 놓이는 자리 */
  private box(
    along: number,
    across: number,
    alongSize: number,
    acrossSize: number,
  ): { x: number; y: number; width: number; height: number } {
    const from = this.point(along, across);
    const to = this.point(along + alongSize, across + acrossSize);
    return {
      x: Math.min(from.x, to.x),
      y: Math.min(from.y, to.y),
      width: Math.abs(to.x - from.x),
      height: Math.abs(to.y - from.y),
    };
  }

  /** 둥근 네모. drop을 주면 화면 아래쪽으로 그만큼 내려 그린다(아래 두께). */
  pill(
    along: number,
    across: number,
    alongSize: number,
    acrossSize: number,
    radius: number,
    color: number,
    alpha = 1,
    drop = 0,
  ): void {
    const { x, y, width, height } = this.box(along, across, alongSize, acrossSize);
    this.graphics.fillStyle(color, alpha);
    this.graphics.fillRoundedRect(x, y + drop, width, height, Math.min(radius, width / 2, height / 2));
  }

  /** 둥근 네모의 테두리만 그린다. */
  outline(
    along: number,
    across: number,
    alongSize: number,
    acrossSize: number,
    radius: number,
    color: number,
    thickness: number,
  ): void {
    const { x, y, width, height } = this.box(along, across, alongSize, acrossSize);
    this.graphics.lineStyle(thickness, color, 1);
    this.graphics.strokeRoundedRect(x, y, width, height, Math.min(radius, width / 2, height / 2));
  }

  dot(along: number, across: number, radius: number, color: number): void {
    const center = this.point(along, across);
    this.graphics.fillStyle(color, 1);
    this.graphics.fillCircle(center.x, center.y, radius);
  }

  /** 앞을 가리키는 화살표. along은 뾰족한 끝의 자리이고, 차의 폭 한가운데에 놓인다. */
  arrow(along: number, size: number, color: number): void {
    const middle = this.width / 2;
    const tip = this.point(along, middle);
    const left = this.point(along + size * 0.6, middle - size * 0.55);
    const right = this.point(along + size * 0.6, middle + size * 0.55);
    this.graphics.fillStyle(color, 1);
    this.graphics.fillTriangle(tip.x, tip.y, left.x, left.y, right.x, right.y);
    this.pill(along + size * 0.5, middle - size * 0.16, size * 0.5, size * 0.32, 1, color);
  }
}

/** 앞머리 양쪽의 전조등 */
function drawLamps(brush: CarBrush): void {
  brush.dot(3.5, brush.width * 0.25, 2, LOOK.lamp);
  brush.dot(3.5, brush.width * 0.75, 2, LOOK.lamp);
}

/** 두 칸짜리 승용차: 앞머리의 전조등, 짙은 앞유리, 앞을 가리키는 화살표가 있는 지붕. */
function drawSedan(brush: CarBrush, colors: CarColors): void {
  const { length, width } = brush;
  const round = width * 0.36;
  brush.pill(0, 0, length, width, round, colors.lip, 1, CAR_LIP);
  brush.pill(0, 0, length, width, round, colors.face);
  drawLamps(brush);

  const glassAt = length * 0.25;
  const roofAt = glassAt + 7.5;
  const roofEnd = length - 11;
  brush.pill(glassAt, 3, 6, width - 6, 3, LOOK.glass, 0.85);
  brush.pill(roofAt, 3.5, roofEnd - roofAt, width - 7, 4, colors.soft);
  const arrow = Math.min(12, roofEnd - roofAt - 4);
  brush.arrow(roofAt + (roofEnd - roofAt - arrow) / 2, arrow, colors.lip);
  // 뒷유리는 앞유리와 헷갈리지 않게 몸통의 짙은 색으로 가늘게 그린다.
  brush.pill(roofEnd + 1.5, 4.5, 3, width - 9, 1.5, colors.lip);
}

/** 세 칸짜리 짐차: 앞쪽의 운전석과 그 뒤로 길게 덮인 밝은 짐칸. 화살표는 짐칸 위에 있다. */
function drawTruck(brush: CarBrush, colors: CarColors): void {
  const { length, width } = brush;
  const round = width * 0.3;
  const bedAt = width * 0.9;
  const bedLength = length - bedAt - 3;
  brush.pill(0, 0, length, width, round, colors.lip, 1, CAR_LIP);
  brush.pill(0, 0, length, width, round, colors.face);
  drawLamps(brush);
  brush.pill(bedAt * 0.38, 3, 6, width - 6, 3, LOOK.glass, 0.85);
  brush.pill(bedAt, 2.5, bedLength, width - 5, 4, colors.soft);
  const arrow = 14;
  brush.arrow(bedAt + (bedLength - arrow) / 2, arrow, colors.lip);
}

/** 차 한 대를 그린다. 길이에 따라 승용차나 짐차가 된다. */
function drawCar(graphics: Phaser.GameObjects.Graphics, car: Car, cell: number, colors: CarColors): void {
  const brush = new CarBrush(graphics, car.facing, car.length * cell - CAR_INSET * 2, cell - CAR_INSET * 2);
  if (car.length === LONG_CAR) drawTruck(brush, colors);
  else drawSedan(brush, colors);
}

/** 막힌 차를 눌렀을 때의 번쩍임: 차 둘레의 붉은 테두리와 차를 엷게 덮는 붉은 막. */
function drawFlash(graphics: Phaser.GameObjects.Graphics, car: Car, cell: number): void {
  const brush = new CarBrush(graphics, car.facing, car.length * cell - CAR_INSET * 2, cell - CAR_INSET * 2);
  const { length, width } = brush;
  const round = width * 0.33;
  brush.pill(0, 0, length, width, round, LOOK.bumpFlash, 0.3);
  brush.outline(-1, -1, length + 2, width + 2, round + 1, LOOK.bumpFlash, 2.5);
}

/** 주차장 바닥을 그린다. 원점은 주차장의 한가운데다. */
function drawLot(graphics: Phaser.GameObjects.Graphics, lot: Lot, cell: number): void {
  const width = lot.cols * cell;
  const height = lot.rows * cell;
  const left = -width / 2;
  const top = -height / 2;

  graphics.clear();
  drawPanel(graphics, left - RIM, top - RIM, width + RIM * 2, height + RIM * 2, {
    fill: LOOK.lot.rim,
    shadow: LOOK.lot.rimLip,
    radius: RIM + 6,
  });
  graphics.fillStyle(LOOK.lot.asphalt, 1);
  graphics.fillRoundedRect(left, top, width, height, 7);

  // 칸을 나누는 선. 모서리에서 겹치지 않게 칸마다 짧게 끊어 그린다.
  graphics.fillStyle(LOOK.lot.line, 0.45);
  for (let row = 0; row < lot.rows; row += 1) {
    for (let col = 0; col < lot.cols; col += 1) {
      const x = left + col * cell;
      const y = top + row * cell;
      if (col > 0) graphics.fillRect(x - 0.5, y + 6, 1, cell - 12);
      if (row > 0) graphics.fillRect(x + 6, y - 0.5, cell - 12, 1);
    }
  }

  // 나가는 곳: 줄 끝마다 테두리에 바깥을 가리키는 작은 세모를 그린다.
  graphics.fillStyle(LOOK.lot.exit, 1);
  const near = 2;
  const far = RIM - 2;
  for (let col = 0; col < lot.cols; col += 1) {
    const x = left + (col + 0.5) * cell;
    graphics.fillTriangle(x - 3.5, top - near, x + 3.5, top - near, x, top - far);
    graphics.fillTriangle(x - 3.5, -top + near, x + 3.5, -top + near, x, -top + far);
  }
  for (let row = 0; row < lot.rows; row += 1) {
    const y = top + (row + 0.5) * cell;
    graphics.fillTriangle(left - near, y - 3.5, left - near, y + 3.5, left - far, y);
    graphics.fillTriangle(-left + near, y - 3.5, -left + near, y + 3.5, -left + far, y);
  }
}

/** 두 차가 맞닿아 있는지(모서리끼리 닿은 것도 친다) */
function touches(a: Car, b: Car): boolean {
  const box = (car: Car): { left: number; top: number; right: number; bottom: number } => {
    const vertical = isVertical(car.facing);
    return {
      left: car.col,
      top: car.row,
      right: car.col + (vertical ? 0 : car.length - 1),
      bottom: car.row + (vertical ? car.length - 1 : 0),
    };
  };
  const first = box(a);
  const second = box(b);
  return (
    first.left <= second.right + 1 &&
    second.left <= first.right + 1 &&
    first.top <= second.bottom + 1 &&
    second.top <= first.bottom + 1
  );
}

/**
 * 차마다 색을 고른다. 맞닿은 차와 같은 색을 피하고, 그 가운데 아직 덜 쓴 색을 골라서
 * 한 가지 색이 몰리지 않게 한다. 피할 수 없으면 모든 색에서 고른다.
 */
function pickColors(lot: Lot): Map<number, CarColors> {
  const chosen = new Map<number, CarColors>();
  const uses = new Map<CarColors, number>();
  const usesOf = (colors: CarColors): number => uses.get(colors) ?? 0;
  for (const car of lot.cars) {
    const taken = lot.cars
      .filter((other) => chosen.has(other.id) && touches(car, other))
      .map((other) => chosen.get(other.id));
    const fresh = LOOK.cars.filter((colors) => !taken.includes(colors));
    const pool = fresh.length > 0 ? fresh : LOOK.cars;
    const fewest = Math.min(...pool.map(usesOf));
    const rarest = pool.filter((colors) => usesOf(colors) === fewest);
    const pick = rarest[Math.floor(Math.random() * rarest.length)];
    chosen.set(car.id, pick);
    uses.set(pick, usesOf(pick) + 1);
  }
  return chosen;
}

/**
 * 주차장 빼기: 빽빽한 주차장에서 앞이 뚫린 차를 눌러 하나씩 빼낸다.
 * 차는 앞머리 쪽으로만 나가고, 막힌 차를 누르면 앞차에 부딪혀 시간이 깎인다.
 * 주차장을 다 비우면 시간을 조금 돌려받고 더 크고 빽빽한 주차장이 나온다. 시간이 다 되면 끝난다.
 */
export class ParkingOutScene extends MiniGameScene {
  protected readonly gameId = 'parking-out';

  private run: RunState = newRun(Math.random);
  private layout: LotLayout = { cell: 0, left: 0, top: 0 };
  /** 지금 주차장에 서 있는 차들. 차 id로 찾는다. */
  private views = new Map<number, CarView>();
  /** 첫 판에서 눌러 보라고 들썩이고 있는 차 */
  private pointed: CarView | null = null;
  /** 처음에 떠 있는 도움말 줄들. 사라진 뒤에는 비어 있다. */
  private hint: Phaser.GameObjects.Text[] = [];
  /** 0보다 크면 일시정지에서 막 돌아와 잠깐 멈춰 있는 중 */
  private grace = 0;
  /** 첫 차를 누르거나 잠깐 기다릴 때까지 시간을 세워 둔다. 처음 하는 사람이 설명을 읽을 틈이다. */
  private readonly gate = new StartGate();
  private lastTickSecond = 0;

  private hud!: GameHud;
  private playArea!: Phaser.Geom.Rectangle;
  private lotCard!: Phaser.GameObjects.Graphics;
  /** 모든 차를 담는 층. 일시정지 중에 통째로 가린다. */
  private carLayer!: Phaser.GameObjects.Container;
  private dust!: Phaser.GameObjects.Particles.ParticleEmitter;
  private confetti!: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor() {
    super(SCENE.parkingOut);
  }

  create(): void {
    this.beginMiniGame();
    this.resetState();

    const { height } = this.scale;
    this.playArea = new Phaser.Geom.Rectangle(0, HUD_HEIGHT, GAME_WIDTH, height - HUD_HEIGHT);

    addBackdrop(this);
    this.lotCard = this.add.graphics();
    this.carLayer = this.add.container(0, 0);
    // 위로 빠져나가는 차가 점수와 시간 막대 위를 지나지 않고 그 뒤로 숨도록, HUD 자리에 배경을 한 겹 더 덮는다.
    addBackdrop(this).setSize(GAME_WIDTH, HUD_HEIGHT);
    this.dust = this.createParticles([...LOOK.dust], 50);
    this.confetti = this.createParticles([...LOOK.confetti], 130);

    this.addPauseButton();
    this.hud = new GameHud(this, DEPTH.hud);
    this.hud.setTime(TIME_BANK_SECONDS, TIME_BANK_SECONDS);
    if (this.stageLevel !== null) this.hud.showStage(this.stageLevel);

    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    // 일시정지한 동안 시간을 들이지 않고 순서를 궁리할 수 없게 차를 가린다. 결과 화면이 뜰 때도 같은 길로 가려진다.
    this.events.on(Phaser.Scenes.Events.PAUSE, this.hideCars, this);
    this.events.on(Phaser.Scenes.Events.RESUME, this.onResume, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off(Phaser.Scenes.Events.PAUSE, this.hideCars, this);
      this.events.off(Phaser.Scenes.Events.RESUME, this.onResume, this);
    });

    this.dealLot();
    // 단계 모드에서는 가장 쉬운 난이도의 단계에서만 방법을 알려 준다.
    if (this.stageLevel === null || levelStage(this.stageLevel) === 1) this.showHint();
  }

  override update(_time: number, deltaMs: number): void {
    if (!this.playing) return;
    // 탭이 가려졌다 돌아와도 시간이 한꺼번에 흐르지 않게 한 프레임의 길이를 제한한다.
    const dt = Math.min(deltaMs, 100) / 1000;
    if (this.grace > 0) {
      this.grace -= dt;
      return;
    }
    if (!this.gate.open) {
      this.gate.wait(dt);
      return;
    }
    // 단계 모드에는 시간 제한이 없다.
    if (this.stageLevel !== null) return;

    this.run = elapse(this.run, dt);
    this.drawTime();
    if (isOver(this.run)) {
      this.endRun();
      return;
    }
    const remaining = Math.ceil(this.run.timeLeft);
    if (remaining <= 5 && remaining !== this.lastTickSecond) {
      this.lastTickSecond = remaining;
      sfx.tick();
    }
  }

  private resetState(): void {
    this.run =
      this.stageLevel === null ? newRun(Math.random) : levelRun(this.stageLevel, this.levelRandom());
    this.layout = { cell: 0, left: 0, top: 0 };
    this.views = new Map();
    this.pointed = null;
    this.hint = [];
    this.gate.reset();
    this.grace = 0;
    this.lastTickSecond = 0;
  }

  // ───────── 화면 구성 ─────────

  private createParticles(tint: number[], speed: number): Phaser.GameObjects.Particles.ParticleEmitter {
    return this.add
      .particles(0, 0, TEXTURE.spark, {
        speed: { min: speed * 0.3, max: speed },
        lifespan: { min: 200, max: 420 },
        alpha: { start: 1, end: 0 },
        tint,
        emitting: false,
      })
      .setDepth(DEPTH.effect);
  }

  private drawTime(): void {
    this.hud.setTime(this.run.timeLeft, TIME_BANK_SECONDS);
  }

  private hideCars(): void {
    this.chargeGrace();
    // 단계 모드는 시간이 흐르지 않으므로 멈춰 놓고 궁리해도 된다.
    if (this.stageLevel !== null) return;
    this.carLayer.setVisible(false);
  }

  private onResume(): void {
    this.carLayer.setVisible(true);
    // 아직 시간이 가지 않고 있었으면 숨 고를 시간도 필요 없다.
    // 시간이 이미 다 되었으면 여유 없이 다음 프레임에 끝낸다.
    if (!this.playing || !this.gate.open || this.stageLevel !== null || isOver(this.run)) return;
    this.grace = RESUME_GRACE_SECONDS;
    showBanner(this, this.lotCard.y, '준비!', LOOK.text.ready, RESUME_GRACE_SECONDS * 1000, DEPTH.banner);
  }

  /**
   * "준비!"가 끝나기 전에 다시 멈추면, 그동안 판을 본 시간을 시계에서 뺀다.
   * 그러지 않으면 멈추기를 되풀이해 시계를 세워 둔 채 판을 볼 수 있다.
   */
  private chargeGrace(): void {
    if (this.grace <= 0) return;
    const seen = RESUME_GRACE_SECONDS - this.grace;
    this.grace = 0;
    if (!this.playing || this.stageLevel !== null) return;
    this.run = elapse(this.run, seen);
    this.drawTime();
  }

  /** 첫 주차장 바로 위에 도움말 두 줄을 잠깐 띄운다. */
  private showHint(): void {
    const top = Math.max(this.playArea.top + 6, this.layout.top - RIM - 46);
    this.hint = [
      addText(this, GAME_WIDTH / 2, top, '앞이 뚫린 차를 눌러 빼내요', {
        color: LOOK.text.hint,
        originX: 0.5,
        stroke: LOOK.text.outline,
      }),
      addText(this, GAME_WIDTH / 2, top + 17, this.bumpHint(), {
        color: LOOK.text.hintSub,
        originX: 0.5,
        stroke: LOOK.text.outline,
      }),
    ];
    for (const line of this.hint) line.setDepth(DEPTH.hud);
    this.fadeHint(HINT_MS);
  }

  /** 막힌 차를 누르면 무엇을 잃는지: 점수 도전에서는 시간, 단계 모드에서는 기회다. */
  private bumpHint(): string {
    return this.stageLevel === null ? '막힌 차를 누르면 시간이 깎여요' : '막힌 차를 누르면 기회가 줄어요';
  }

  /** 오른쪽 위에 지금 판의 번호를, 단계 모드에서는 남은 기회를 적는다. */
  private showSide(bounce: boolean): void {
    if (this.stageLevel === null) this.hud.setSide(`${this.run.stage}판`, bounce);
    else this.hud.setSide(`기회 ${chancesLeft(this.run)}`, bounce);
  }

  /** delayMs 뒤에 도움말을 흐리게 지운다. 이미 지워지는 중이면 새로 정한 때에 맞춘다. */
  private fadeHint(delayMs: number): void {
    const lines = this.hint;
    if (lines.length === 0) return;
    this.tweens.killTweensOf(lines);
    this.tweens.add({
      targets: lines,
      alpha: 0,
      delay: delayMs,
      duration: 400,
      onComplete: () => {
        for (const line of lines) line.destroy();
        if (this.hint === lines) this.hint = [];
      },
    });
  }

  // ───────── 주차장 깔기 ─────────

  /** 지금 판의 주차장을 그리고 차를 세운다. 차가 다 나타나면 시간이 흐르기 시작한다. */
  private dealLot(): void {
    const { lot, stage } = this.run;
    this.layout = lotLayout(lot, this.playArea);
    const { cell, left, top } = this.layout;

    drawLot(this.lotCard, lot, cell);
    this.lotCard.setPosition(left + (lot.cols * cell) / 2, top + (lot.rows * cell) / 2);
    this.tweens.add({
      targets: this.lotCard,
      scale: { from: 0.94, to: 1 },
      duration: DEAL_POP_MS,
      ease: 'Back.Out',
    });
    this.showSide(this.stageLevel === null && stage > 1);
    if (this.stageLevel === null && stage > 1) sfx.pop();

    const colors = pickColors(lot);
    this.views = new Map();
    lot.cars.forEach((car, index) => {
      this.views.set(car.id, this.createCar(car, colors.get(car.id) ?? LOOK.cars[0], index));
    });

    this.time.delayedCall(lot.cars.length * DEAL_STAGGER_MS + DEAL_POP_MS, () => {
      this.playing = true;
      if (stage > 1) return;
      sfx.go();
      this.pointOutFreeCar();
    });
  }

  private createCar(car: Car, colors: CarColors, index: number): CarView {
    const { cell, left, top } = this.layout;
    const vertical = isVertical(car.facing);
    const x = left + (car.col + (vertical ? 1 : car.length) / 2) * cell;
    const y = top + (car.row + (vertical ? car.length : 1) / 2) * cell;

    const body = this.add.graphics();
    drawCar(body, car, cell, colors);
    const flash = this.add.graphics().setAlpha(0);
    drawFlash(flash, car, cell);
    const container = this.add.container(x, y, [body, flash]).setScale(0);
    this.carLayer.add(container);

    // 한 대씩 차례로 나타난다.
    this.tweens.add({
      targets: container,
      scale: 1,
      duration: DEAL_POP_MS,
      delay: index * DEAL_STAGGER_MS,
      ease: 'Back.Out',
    });
    return { car, container, flash, x, y, lurching: false };
  }

  /** 첫 판에서 아직 아무것도 누르지 않았을 때, 나갈 수 있는 차 한 대가 들썩여서 눈에 띄게 한다. */
  private pointOutFreeCar(): void {
    const { lot } = this.run;
    const free = lot.cars.find((car) => canLeave(lot, car));
    const view = free ? this.views.get(free.id) : undefined;
    if (!view) return;
    this.pointed = view;
    this.tweens.add({
      targets: view.container,
      scale: 1.09,
      duration: 340,
      ease: 'Sine.InOut',
      yoyo: true,
      repeat: -1,
    });
  }

  private stopPointing(): void {
    if (!this.pointed) return;
    this.tweens.killTweensOf(this.pointed.container);
    this.pointed.container.setScale(1);
    this.pointed = null;
  }

  // ───────── 입력 ─────────

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    // 위쪽 HUD(일시정지 버튼)를 누른 것은 차를 누른 것이 아니다.
    if (!this.playing || this.grace > 0 || pointer.worldY < HUD_HEIGHT) return;
    const { cell, left, top } = this.layout;
    const col = Math.floor((pointer.worldX - left) / cell);
    const row = Math.floor((pointer.worldY - top) / cell);

    const target = carAt(this.run.lot, col, row);
    const view = target ? this.views.get(target.id) : undefined;
    if (!view || view.lurching) return;

    this.gate.start();
    this.stopPointing();
    const { run, outcome } = tapCell(this.run, col, row);
    this.run = run;
    if (outcome.kind === 'exit') this.onExit(view, outcome);
    else if (outcome.kind === 'blocked') this.onBlocked(view, outcome);
  }

  // ───────── 차가 나감 ─────────

  private onExit(view: CarView, outcome: Exit): void {
    this.views.delete(view.car.id);
    this.driveOut(view);
    sfx.whoosh();
    vibrate(8);
    this.hud.setScore(this.run.score);
    this.floatPoints(view.x, view.y, outcome.points, LOOK.text.points, this.playArea, DEPTH.effect);
    if (outcome.cleared) this.onLotCleared(outcome.cleared);
  }

  /** 차가 앞머리 쪽으로 속도를 올리며 화면 밖으로 나간다. 위쪽으로 나간 차는 HUD 뒤로 사라진다. */
  private driveOut(view: CarView): void {
    const { container, car } = view;
    const forward = FORWARD[car.facing];
    const half = (car.length * this.layout.cell) / 2;
    this.tweens.killTweensOf(container);
    container.setScale(1);
    this.carLayer.bringToTop(container);
    this.dust.explode(4, container.x - forward.x * half, container.y - forward.y * half);

    // 꼬리가 화면 끝(위쪽은 HUD의 아래 끝)을 넘어갈 때까지의 거리
    const toEdge: Record<Facing, number> = {
      up: container.y - HUD_HEIGHT,
      down: this.scale.height - container.y,
      left: container.x,
      right: GAME_WIDTH - container.x,
    };
    const distance = toEdge[car.facing] + half + EXIT_OVERSHOOT;
    this.tweens.add({
      targets: container,
      x: container.x + forward.x * distance,
      y: container.y + forward.y * distance,
      duration: EXIT_MS,
      ease: 'Quad.In',
      onComplete: () => container.destroy(),
    });
  }

  // ───────── 막힘 ─────────

  private onBlocked(view: CarView, outcome: Blocked): void {
    this.drawTime();
    vibrate([20, 30, 20]);
    this.cameras.main.shake(110, 0.004);
    const staged = this.stageLevel !== null;
    if (staged) this.showSide(true);
    floatText(
      this,
      view.x,
      view.y,
      staged ? '기회 -1' : `-${BUMP_PENALTY_SECONDS}초`,
      LOOK.text.penalty,
      this.playArea,
      DEPTH.effect,
    );
    view.flash.setAlpha(1);
    this.tweens.add({ targets: view.flash, alpha: 0, duration: 420, ease: 'Quad.In' });
    this.lurch(view, outcome);
    // 단계 모드에서 기회를 다 쓰면 그 단계는 끝이다.
    if (staged && chancesLeft(this.run) <= 0) this.endRun();
  }

  /** 막힌 차가 앞차에 닿을 때까지 나아가 쿵 부딪히고 제자리로 돌아온다. 무엇에 막혔는지 보여 준다. */
  private lurch(view: CarView, outcome: Blocked): void {
    const forward = FORWARD[view.car.facing];
    const reach = outcome.gap * this.layout.cell + CAR_INSET * 2 + BUMP_PUSH;
    view.lurching = true;
    this.tweens.add({
      targets: view.container,
      x: view.x + forward.x * reach,
      y: view.y + forward.y * reach,
      duration: LURCH_MS + reach * LURCH_MS_PER_PX,
      ease: 'Quad.In',
      onComplete: () => {
        sfx.bump();
        this.jolt(outcome.blocker, forward);
        this.tweens.add({
          targets: view.container,
          x: view.x,
          y: view.y,
          duration: LURCH_BACK_MS,
          ease: 'Quad.Out',
          onComplete: () => {
            view.lurching = false;
          },
        });
      },
    });
  }

  /** 받힌 차가 밀리는 쪽으로 살짝 움찔한다. 그 사이에 나갔거나 저도 움직이는 중이면 그대로 둔다. */
  private jolt(blocker: Car, push: { x: number; y: number }): void {
    const view = this.views.get(blocker.id);
    if (!view || view.car !== blocker || view.lurching) return;
    this.tweens.killTweensOf(view.container);
    view.container.setPosition(view.x, view.y);
    this.tweens.add({
      targets: view.container,
      x: view.x + push.x * JOLT,
      y: view.y + push.y * JOLT,
      duration: 60,
      ease: 'Quad.Out',
      yoyo: true,
    });
  }

  // ───────── 판이 바뀜 ─────────

  private onLotCleared(cleared: { points: number; seconds: number }): void {
    // 다음 주차장이 깔릴 때까지 시간이 멈춘다.
    this.playing = false;
    this.drawTime();
    // 더 큰 주차장이 도움말 자리까지 올라오므로, 아직 떠 있으면 치운다.
    this.fadeHint(0);

    if (this.stageLevel !== null) {
      // 단계 모드는 주차장 하나가 한 판이다. 다음 단계는 결과 화면에서 고른다.
      this.time.delayedCall(CLEAR_BANNER_MS, () => {
        sfx.gold();
        vibrate([15, 30, 15]);
        this.confetti.explode(18, GAME_WIDTH / 2, this.lotCard.y);
        showBanner(this, this.lotCard.y, '클리어!', LOOK.text.clear, 900, DEPTH.banner);
      });
      this.finishStage(true, this.stageStats(), CLEAR_BANNER_MS + 1000);
      return;
    }

    this.time.delayedCall(CLEAR_BANNER_MS, () => {
      sfx.gold();
      vibrate([15, 30, 15]);
      this.confetti.explode(18, GAME_WIDTH / 2, this.lotCard.y);
      this.showClearBanner(cleared, NEXT_LOT_MS - CLEAR_BANNER_MS);
    });
    this.time.delayedCall(NEXT_LOT_MS, () => {
      this.run = nextStage(this.run, Math.random);
      this.dealLot();
    });
  }

  /** 빈 주차장 한가운데에 "클리어!"와, 그 아래에 받은 점수와 돌려받은 시간을 띄운다. */
  private showClearBanner(cleared: { points: number; seconds: number }, durationMs: number): void {
    const centerY = this.lotCard.y;
    showBanner(this, centerY, '클리어!', LOOK.text.clear, durationMs, DEPTH.banner);
    // 시간이 이미 가득해서 돌려받은 것이 없으면 점수만 보여 준다.
    const seconds = Math.round(cleared.seconds);
    const label = seconds >= 1 ? `+${cleared.points}점  +${seconds}초` : `+${cleared.points}점`;
    const bonus = addText(this, GAME_WIDTH / 2, centerY + 32, label, {
      color: LOOK.text.points,
      originX: 0.5,
      originY: 0.5,
      stroke: LOOK.text.outline,
    }).setDepth(DEPTH.banner);
    this.tweens.add({
      targets: bonus,
      alpha: 0,
      delay: durationMs * 0.6,
      duration: durationMs * 0.4,
      onComplete: () => bonus.destroy(),
    });
  }

  private endRun(): void {
    this.stopPointing();
    if (this.stageLevel !== null) {
      showBanner(this, this.lotCard.y, '기회 끝!', LOOK.text.over, 900, DEPTH.banner);
      this.finishStage(false, this.stageStats());
      return;
    }
    showBanner(this, this.lotCard.y, '끝!', LOOK.text.over, 900, DEPTH.banner);
    this.finishMiniGame(this.run.score, [
      ['빼낸 차', `${this.run.carsOut}대`],
      ['깬 판', `${this.run.lotsCleared}판`],
      ['부딪힘', `${this.run.bumps}번`],
    ]);
  }

  /** 단계 모드의 결과 화면에 적는 것 */
  private stageStats(): ResultStat[] {
    return [
      ['빼낸 차', `${this.run.carsOut}대`],
      ['부딪힘', `${this.run.bumps}번`],
    ];
  }
}
