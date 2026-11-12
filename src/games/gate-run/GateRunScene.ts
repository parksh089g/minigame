import Phaser from 'phaser';
import { TEXTURE } from '../../art/sprites';
import { FONT_SIZE, GAME_WIDTH, SCENE, THEME, THEME_CSS } from '../../config';
import { bakeShape } from '../../core/bake';
import { vibrate } from '../../core/haptics';
import { sfx } from '../../core/sfx';
import { StartGate } from '../../core/start-gate';
import { addBackdrop, addText } from '../../core/ui';
import { floatText, GameHud, HUD_HEIGHT, showBanner } from '../../scenes/GameHud';
import { MiniGameScene } from '../../scenes/MiniGameScene';
import {
  clampToRoad,
  gateLabel,
  hitWall,
  isBoost,
  isOver,
  laneCenter,
  newCourse,
  newRun,
  nextSegment,
  passGate,
  ROAD_CENTER,
  ROAD_LEFT,
  ROAD_RIGHT,
  ROW_GAP,
  scrollSpeed,
  sideAt,
  steer,
  type Clash,
  type Course,
  type Gate,
  type GatePair,
  type RunState,
  type Side,
} from './rules';

interface ShadeColors {
  face: number;
  light: number;
  dark: number;
}

/** 길 위에 놓일 차례를 기다리는 줄 */
type RowPlan =
  | { kind: 'gates'; segment: number; pair: GatePair }
  | { kind: 'wall'; segment: number; enemies: number };

interface RowBase {
  /** 이 줄이 속한 구간 번호 */
  segment: number;
  /** 줄의 가운데 높이(화면 좌표). 길과 함께 아래로 흘러내린다. */
  y: number;
  /** 무리가 이미 지나갔는지 */
  passed: boolean;
  /** 사라지는 연출이 끝나서 목록에서 빼도 되는지 */
  done: boolean;
  container: Phaser.GameObjects.Container;
}

interface GateRow extends RowBase {
  kind: 'gates';
  pair: GatePair;
  panels: Record<Side, Phaser.GameObjects.Container>;
}

interface WallRow extends RowBase {
  kind: 'wall';
  enemies: number;
  foes: Phaser.GameObjects.Image[];
  badge: CountBadge;
}

type Row = GateRow | WallRow;

/** 적과 부딪혀 양쪽 수가 줄어드는 동안의 상태 */
interface ClashState {
  wall: WallRow;
  /** 부딪히기 전 무리의 수 */
  from: number;
  /** 다 줄어든 뒤의 상태 */
  after: RunState;
  outcome: Clash;
  /** 부딪힌 뒤 지난 시간(초) */
  time: number;
  /** 지금까지 화면에서 줄인 수 */
  shown: number;
}

/** run: 달리는 중, clash: 적과 부딪혀 멈춘 중, over: 무리가 바닥나서 끝남 */
type Phase = 'run' | 'clash' | 'over';

/** 무리가 머무는 높이. 놀이 영역의 위에서부터의 비율이고, 그 아래는 손가락을 둘 자리다. */
const CROWD_LINE_RATIO = 0.76;
/** 첫 관문 줄이 처음에 무리보다 얼마나 앞에 있는지. 조작을 읽을 시간을 3초쯤 준다. */
const FIRST_ROW_AHEAD = 210;
/** 적과 부딪혀 수가 줄어드는 동안 길이 멈춰 있는 시간(초) */
const CLASH_SECONDS = 0.35;
/** 일시정지에서 돌아온 뒤 다시 달리기까지의 여유(초) */
const RESUME_GRACE_SECONDS = 0.8;
/** 속도가 새 구간의 속도로 바뀌는 빠르기. 뚝 끊기지 않고 스르륵 빨라진다. */
const SPEED_EASE = 2;

/** 길 윗변이 HUD 아래로 떨어진 거리 */
const ROAD_TOP_GAP = 2;
/** 길 가운데 점선: 한 토막의 길이와 되풀이되는 간격 */
const DASH = { length: 12, period: 34, width: 3 } as const;
/** 길 가장자리의 눈금: 가장자리에서 떨어진 거리, 크기, 되풀이되는 간격 */
const TICK = { inset: 5, width: 6, height: 3, period: 34 } as const;

/** 관문 한 칸의 크기. 아래쪽 두께(lip)는 높이에 더해진다. */
const GATE = { width: 94, height: 34, lip: 3, radius: 10 } as const;
/** 나누기 기호: 막대의 길이와 두께, 점의 반지름과 막대에서 떨어진 거리, 기호와 수 사이의 틈. 글꼴에 ÷가 없어서 도형으로 그린다. */
const DIVIDE_SIGN = { width: 13, bar: 3, dot: 1.9, dotGap: 2, gap: 2 } as const;
/** 관문의 가운데가 무리의 중심보다 이만큼 위에 왔을 때 지난 것으로 친다. 무리의 앞머리가 관문에 들어선 때다. */
const GATE_CONTACT = 14;
/** 줄이 길 위쪽에서 나타날 때 서서히 진해지는 거리 */
const ROW_FADE = 22;
/** 줄의 가운데에서 그림의 위쪽 끝까지. 여기까지 길 안에 들어온 뒤에야 보이기 시작한다. */
const ROW_REACH = { gates: 18, wall: 46 } as const;
/** 지나간 줄이 사라지는 데 걸리는 시간(ms) */
const ROW_OUT_MS = 220;

const CREATURE_RADIUS = 6.2;
/** 무리 안에서 옆 친구와의 거리 */
const CREATURE_SPACING = 11.8;
/** 무리로 그리는 가장 많은 수. 그보다 많으면 숫자로만 안다. */
const CROWD_SHOWN_MAX = 19;
/** 달리는 동안 몸이 위아래로 들썩이는 폭과 빠르기 */
const BOB = { height: 1.3, rate: 11 } as const;

/** 적은 길을 가로질러 두 줄까지 선다: 한 줄에 서는 수, 줄의 앞뒤 간격, 길 가장자리에서 띄우는 폭 */
const WALL = { perRow: 14, rowOffset: 6.5, inset: 8, matHeight: 32, badgeY: -32 } as const;
/** 수를 적는 알약 모양 칸 */
const BADGE = { height: 22, lip: 2, minWidth: 30, padding: 7 } as const;
/** 내 무리의 수는 무리 위에 이만큼 띄워 적는다. */
const BADGE_GAP = 5;

/**
 * 이 게임의 색을 한곳에 모아 둔다. 겉모습을 바꿀 때는 여기와 아래의 draw 함수들만 고치면 된다.
 */
const LOOK = {
  /** 길: 모래빛 바닥, 테두리, 흘러내리는 점선과 눈금 */
  road: { face: THEME.butterSoft, edge: THEME.butterDeep, mark: THEME.butter },
  /** 내 무리 */
  buddy: { face: THEME.sky, light: THEME.skySoft, dark: THEME.skyDeep } as ShadeColors,
  /** 적 */
  foe: { face: THEME.coral, light: THEME.pinkSoft, dark: THEME.coralDeep } as ShadeColors,
  eye: THEME.inkDeep,
  /** 무리를 불리는 관문과 깎는 관문 */
  boost: { face: THEME.mint, light: THEME.mintSoft, dark: THEME.mintDeep } as ShadeColors,
  harm: { face: THEME.coral, light: THEME.pinkSoft, dark: THEME.coralDeep } as ShadeColors,
  gateSign: THEME.inkDeep,
  /** 적이 서 있는 자리에 깔리는 띠 */
  mat: { face: THEME.pinkSoft, dark: THEME.pink },
  /** 수를 적는 칸 */
  buddyBadge: { face: THEME.card, light: THEME.white, dark: THEME.skyDeep } as ShadeColors,
  foeBadge: { face: THEME.card, light: THEME.white, dark: THEME.coralDeep } as ShadeColors,
  /** 무리가 불어날 때와 줄어들 때 튀는 알갱이 */
  sparks: [THEME.gold, THEME.mint, THEME.white],
  puffs: [THEME.sky, THEME.skySoft, THEME.coral],
  text: {
    gate: THEME_CSS.inkDeep,
    count: THEME_CSS.inkDeep,
    hint: THEME_CSS.ink,
    hintSub: THEME_CSS.sub,
    outline: THEME_CSS.white,
    start: THEME_CSS.good,
    ready: THEME_CSS.accent,
    over: THEME_CSS.bad,
    gain: THEME_CSS.good,
    loss: THEME_CSS.bad,
    points: THEME_CSS.accent,
  },
} as const;

const DEPTH = { road: 1, row: 5, crowd: 10, badge: 12, effect: 20, hud: 30, banner: 40 } as const;

/**
 * 무리 안의 자리. 가운데에서부터 벌집 모양으로 채워 나가서 몇 마리든 동그랗게 뭉친다.
 * 가운데, 둘레 여섯, 그 바깥 열둘의 차례다.
 */
const CROWD_SPOTS: ReadonlyArray<{ x: number; y: number }> = (() => {
  const spots: { x: number; y: number }[] = [];
  for (let q = -2; q <= 2; q += 1) {
    for (let r = -2; r <= 2; r += 1) {
      if (Math.abs(q + r) > 2) continue;
      spots.push({
        x: (q + r / 2) * CREATURE_SPACING,
        y: ((r * Math.sqrt(3)) / 2) * CREATURE_SPACING,
      });
    }
  }
  const angle = (spot: { x: number; y: number }): number => Math.atan2(spot.y, spot.x);
  return spots.sort(
    (a, b) => Math.round(Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y)) || angle(a) - angle(b),
  );
})();

/** count마리가 서는 자리. 무게중심이 (0, 0)에 오도록 맞춰서 무리가 언제나 손가락 아래에 있다. */
function crowdSpots(count: number): { x: number; y: number }[] {
  const used = CROWD_SPOTS.slice(0, Math.min(count, CROWD_SHOWN_MAX));
  if (used.length === 0) return [];
  const centerX = used.reduce((sum, spot) => sum + spot.x, 0) / used.length;
  const centerY = used.reduce((sum, spot) => sum + spot.y, 0) / used.length;
  return used.map((spot) => ({ x: spot.x - centerX, y: spot.y - centerY }));
}

/** 무리의 중심에서 맨 앞 친구의 머리끝까지의 거리 */
function crowdReach(spots: ReadonlyArray<{ y: number }>): number {
  return CREATURE_RADIUS - Math.min(0, ...spots.map((spot) => spot.y));
}

/** 적 count마리가 서는 자리(줄의 가운데가 y = 0). 앞줄부터 채우고 길을 고르게 가로지른다. */
function wallSpots(count: number): { x: number; y: number }[] {
  const shown = Math.min(count, WALL.perRow * 2);
  const front = Math.min(shown, WALL.perRow);
  const width = ROAD_RIGHT - ROAD_LEFT - WALL.inset * 2;
  const line = (size: number, y: number): { x: number; y: number }[] =>
    Array.from({ length: size }, (_, index) => ({
      x: ROAD_LEFT + WALL.inset + ((index + 0.5) * width) / size,
      y,
    }));
  return [...line(front, WALL.rowOffset), ...line(shown - front, -WALL.rowOffset)];
}

/**
 * 동그란 친구 하나를 (0, 0)에 그린다. 위에서 내려다본 모습이다.
 * 내 무리는 달리는 쪽(위)을 보고, 적은 뿔이 있고 나를 향해(아래) 본다.
 */
function drawCreature(graphics: Phaser.GameObjects.Graphics, colors: ShadeColors, hostile: boolean): void {
  const r = CREATURE_RADIUS;
  if (hostile) {
    graphics.fillStyle(colors.dark, 1);
    graphics.fillTriangle(-r * 0.95, -r * 0.3, -r * 0.2, -r * 0.9, -r * 0.8, -r * 1.35);
    graphics.fillTriangle(r * 0.95, -r * 0.3, r * 0.2, -r * 0.9, r * 0.8, -r * 1.35);
  }
  graphics.fillStyle(colors.dark, 1);
  graphics.fillCircle(0, 1.4, r);
  graphics.fillStyle(colors.face, 1);
  graphics.fillCircle(0, 0, r);
  graphics.fillStyle(colors.light, 1);
  graphics.fillEllipse(-r * 0.35, hostile ? -r * 0.5 : r * 0.45, r * 0.7, r * 0.4);
  const eyeY = hostile ? r * 0.25 : -r * 0.3;
  graphics.fillStyle(LOOK.eye, 1);
  graphics.fillCircle(-r * 0.38, eyeY, r * 0.19);
  graphics.fillCircle(r * 0.38, eyeY, r * 0.19);
}

/**
 * 친구 하나의 그림. 무리와 적으로 수십 마리가 한꺼번에 보이므로 한 장씩 구워서 같이 쓴다.
 * 이미지의 한가운데가 몸의 한가운데다. 뿔과 아래쪽 두께가 들어가도록 몸보다 넉넉하게 잡는다.
 */
function creatureTexture(scene: Phaser.Scene, hostile: boolean): string {
  const box = { width: 16, height: 20 };
  return bakeShape(scene, hostile ? 'gate-run-foe' : 'gate-run-buddy', box, (graphics) =>
    drawCreature(graphics, hostile ? LOOK.foe : LOOK.buddy, hostile),
  );
}

/** 길 가운데 점선 한 토막의 그림. 왼쪽 위가 토막의 왼쪽 위에서 반 픽셀 바깥이다. */
function dashTexture(scene: Phaser.Scene): string {
  const box = { width: DASH.width + 1, height: DASH.length, originX: 0.5, originY: 0 };
  return bakeShape(scene, 'gate-run-dash', box, (graphics) => {
    graphics.fillStyle(LOOK.road.mark, 1);
    graphics.fillRoundedRect(0, 0, DASH.width, DASH.length, DASH.width / 2);
  });
}

/** 길 양쪽 가장자리의 눈금 한 쌍의 그림. 왼쪽 눈금의 왼쪽 위에서 반 픽셀 위가 그림의 왼쪽 위다. */
function tickTexture(scene: Phaser.Scene): string {
  const span = ROAD_RIGHT - ROAD_LEFT - TICK.inset * 2;
  const box = { width: span, height: TICK.height + 1, originX: 0, originY: 0.5 };
  return bakeShape(scene, 'gate-run-tick', box, (graphics) => {
    graphics.fillStyle(LOOK.road.mark, 1);
    graphics.fillRoundedRect(0, 0, TICK.width, TICK.height, TICK.height / 2);
    graphics.fillRoundedRect(span - TICK.width, 0, TICK.width, TICK.height, TICK.height / 2);
  });
}

/** 관문 한 칸을 가운데가 (0, 0)에 오도록 그린다. 아래쪽에 짙은 두께를 둔다. */
function drawGate(graphics: Phaser.GameObjects.Graphics, colors: ShadeColors): void {
  const left = -GATE.width / 2;
  const top = -GATE.height / 2;
  graphics.clear();
  graphics.fillStyle(colors.dark, 1);
  graphics.fillRoundedRect(left, top + GATE.lip, GATE.width, GATE.height, GATE.radius);
  graphics.fillStyle(colors.face, 1);
  graphics.fillRoundedRect(left, top, GATE.width, GATE.height, GATE.radius);
  graphics.fillStyle(colors.light, 1);
  graphics.fillRoundedRect(left + 9, top + 4, 16, 3, 1.5);
}

/** 나누기 기호(÷)를 (centerX, 0)에 그린다. */
function drawDivideSign(graphics: Phaser.GameObjects.Graphics, centerX: number): void {
  const { width, bar, dot, dotGap } = DIVIDE_SIGN;
  const dotY = bar / 2 + dotGap + dot;
  graphics.fillStyle(LOOK.gateSign, 1);
  graphics.fillRoundedRect(centerX - width / 2, -bar / 2, width, bar, bar / 2);
  graphics.fillCircle(centerX, -dotY, dot);
  graphics.fillCircle(centerX, dotY, dot);
}

/** 적이 서 있는 자리의 띠. 길을 끝에서 끝까지 막고 있다는 것을 보여 준다. */
function drawMat(graphics: Phaser.GameObjects.Graphics): void {
  const left = ROAD_LEFT + 3;
  const width = ROAD_RIGHT - ROAD_LEFT - 6;
  const top = -WALL.matHeight / 2;
  graphics.fillStyle(LOOK.mat.dark, 1);
  graphics.fillRoundedRect(left, top + 2, width, WALL.matHeight, 10);
  graphics.fillStyle(LOOK.mat.face, 1);
  graphics.fillRoundedRect(left, top, width, WALL.matHeight, 10);
}

/** 수를 적는 알약 모양 칸. 뒤가 막혀 있어서 관문 글자 위를 지나가도 수가 또렷하다. */
class CountBadge {
  readonly container: Phaser.GameObjects.Container;
  private readonly pill: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private shown = -1;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly colors: ShadeColors,
  ) {
    this.pill = scene.add.graphics();
    this.label = addText(scene, 0, 0, '', {
      size: FONT_SIZE.large,
      color: LOOK.text.count,
      originX: 0.5,
      originY: 0.5,
    });
    this.container = scene.add.container(0, 0, [this.pill, this.label]);
  }

  set(count: number): void {
    if (count === this.shown) return;
    this.shown = count;
    this.label.setText(String(count));
    const width = Math.max(BADGE.minWidth, Math.ceil(this.label.width) + BADGE.padding * 2);
    const top = -BADGE.height / 2;
    this.pill.clear();
    this.pill.fillStyle(this.colors.dark, 1);
    this.pill.fillRoundedRect(-width / 2, top + BADGE.lip, width, BADGE.height, BADGE.height / 2);
    this.pill.fillStyle(this.colors.face, 1);
    this.pill.fillRoundedRect(-width / 2, top, width, BADGE.height, BADGE.height / 2);
  }

  /** 수가 바뀌었을 때 살짝 커졌다 돌아온다. */
  pop(): void {
    this.scene.tweens.killTweensOf(this.container);
    this.container.setScale(1.3);
    this.scene.tweens.add({ targets: this.container, scale: 1, duration: 200, ease: 'Back.Out' });
  }
}

/**
 * 관문 달리기: 위에서 내려다본 길을 작은 무리가 달린다. 좌우로 끌어 두 관문 가운데 하나를 지나면
 * 무리가 불어나거나 줄어들고, 몇 줄마다 길을 막은 적과 부딪혀 적의 수만큼 줄어든다.
 * 무리가 바닥나면 끝난다.
 */
export class GateRunScene extends MiniGameScene {
  protected readonly gameId = 'gate-run';

  private run: RunState = newRun();
  private course: Course = newCourse();
  /** 만들어 두고 아직 길 위에 놓지 않은 줄 */
  private plans: RowPlan[] = [];
  /** 길 위에 놓인 줄. 앞의 것이 무리에 더 가깝다. */
  private rows: Row[] = [];
  private phase: Phase = 'run';
  private clash: ClashState | null = null;
  /** 무리 중심의 가로 위치와, 가려는 곳 */
  private crowdX = ROAD_CENTER;
  private targetX = ROAD_CENTER;
  /** 지금 무리를 끌고 있는 손가락. 없으면 -1. */
  private dragId = -1;
  private speed = 0;
  /** 지금까지 길이 흘러내린 거리. 점선과 눈금을 흘리는 데 쓴다. */
  private distance = 0;
  /** 가장 나중에 놓은 줄의 높이. 여기서 ROW_GAP 위에 다음 줄이 놓인다. */
  private frontier = 0;
  /** 0보다 크면 잠깐 멈춰 있는 중 */
  private grace = 0;
  /** 처음 화면을 누르거나 잠깐 기다릴 때까지 달리지 않는다. 처음 하는 사람이 설명을 읽을 틈이다. */
  private readonly gate = new StartGate();
  private bobTime = 0;
  /** 화면에 그려 둔 무리의 자리 */
  private spots: { x: number; y: number }[] = [];
  private roadTop = 0;
  private crowdY = 0;

  private hud!: GameHud;
  /** 길 가운데 점선과 가장자리 눈금. 화면에 보일 수 있는 만큼 만들어 두고 자리만 옮긴다. */
  private dashes: Phaser.GameObjects.Image[] = [];
  private ticks: Phaser.GameObjects.Image[] = [];
  private crowd!: Phaser.GameObjects.Container;
  private buddies: Phaser.GameObjects.Image[] = [];
  private badge!: CountBadge;
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  private puffs!: Phaser.GameObjects.Particles.ParticleEmitter;
  private playArea!: Phaser.Geom.Rectangle;

  constructor() {
    super(SCENE.gateRun);
  }

  create(): void {
    this.beginMiniGame();
    this.resetState();

    const { height } = this.scale;
    this.roadTop = HUD_HEIGHT + ROAD_TOP_GAP;
    this.playArea = new Phaser.Geom.Rectangle(0, HUD_HEIGHT, GAME_WIDTH, height - HUD_HEIGHT);
    this.crowdY = HUD_HEIGHT + Math.round(this.playArea.height * CROWD_LINE_RATIO);
    this.frontier = this.crowdY - FIRST_ROW_AHEAD + ROW_GAP;
    this.speed = scrollSpeed(0);

    addBackdrop(this);
    this.drawRoad();
    this.createMarks();
    this.createCrowd();
    this.sparks = this.createEmitter(LOOK.sparks);
    this.puffs = this.createEmitter(LOOK.puffs);

    this.addPauseButton();
    this.hud = new GameHud(this, DEPTH.hud);
    this.hud.setSide('돌파 0');

    this.bindInput();
    this.events.on(Phaser.Scenes.Events.RESUME, this.onResume, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off(Phaser.Scenes.Events.RESUME, this.onResume, this);
    });

    this.showHint();
    this.spawnRows();
    this.drawMarks();
    // 달리기는 첫 터치와 함께(또는 잠깐 기다린 뒤) 시작한다. setOff()를 본다.
    this.playing = true;
  }

  /** 서 있던 무리가 달리기 시작한다. */
  private setOff(): void {
    showBanner(this, this.roadTop + 62, '출발!', LOOK.text.start, 600, DEPTH.banner);
    sfx.go();
  }

  override update(_time: number, deltaMs: number): void {
    if (!this.playing) return;
    // 탭이 가려졌다 돌아와도 시간이 한꺼번에 흐르지 않게 한 프레임의 길이를 제한한다.
    const dt = Math.min(deltaMs, 100) / 1000;
    if (this.grace > 0) {
      this.grace -= dt;
      return;
    }

    this.crowdX = steer(this.crowdX, this.targetX, dt);
    this.bobTime += dt;
    this.placeCrowd();
    // 출발하기 전에도 무리는 손가락을 따라 좌우로 움직인다. 길만 흐르지 않는다.
    if (!this.gate.open) {
      if (this.gate.wait(dt)) this.setOff();
      return;
    }

    this.rows = this.rows.filter((row) => !row.done);
    if (this.phase === 'clash') this.advanceClash(dt);
    else this.advanceRoad(dt);
  }

  private resetState(): void {
    this.run = newRun();
    this.course = newCourse();
    this.plans = [];
    this.rows = [];
    this.phase = 'run';
    this.clash = null;
    this.crowdX = ROAD_CENTER;
    this.targetX = ROAD_CENTER;
    this.dragId = -1;
    this.speed = 0;
    this.distance = 0;
    this.frontier = 0;
    this.grace = 0;
    this.gate.reset();
    this.bobTime = 0;
    this.spots = [];
    this.buddies = [];
    this.dashes = [];
    this.ticks = [];
  }

  // ───────── 입력 ─────────

  private bindInput(): void {
    const follow = (pointer: Phaser.Input.Pointer): void => {
      this.targetX = clampToRoad(pointer.worldX);
    };
    const letGo = (pointer: Phaser.Input.Pointer): void => {
      if (pointer.id === this.dragId) this.dragId = -1;
    };
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      // 위쪽 HUD(일시정지 버튼)를 누른 것은 조종이 아니다.
      if (pointer.worldY < HUD_HEIGHT) return;
      this.dragId = pointer.id;
      follow(pointer);
      if (this.playing && this.gate.start()) this.setOff();
    });
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (pointer: Phaser.Input.Pointer) => {
      if (pointer.id === this.dragId && pointer.isDown) follow(pointer);
    });
    this.input.on(Phaser.Input.Events.POINTER_UP, letGo);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, letGo);

    // 키보드로도 할 수 있다(컴퓨터에서 해 볼 때). 화살표를 누르면 그쪽 관문 앞으로 간다.
    const keyboard = this.input.keyboard;
    if (keyboard) {
      const goLeft = (): void => {
        this.targetX = laneCenter('left');
        if (this.playing && this.gate.start()) this.setOff();
      };
      const goRight = (): void => {
        this.targetX = laneCenter('right');
        if (this.playing && this.gate.start()) this.setOff();
      };
      keyboard.on('keydown-LEFT', goLeft);
      keyboard.on('keydown-RIGHT', goRight);
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        keyboard.off('keydown-LEFT', goLeft);
        keyboard.off('keydown-RIGHT', goRight);
      });
    }
  }

  private onResume(): void {
    // 멈춰 있는 동안 손을 뗐을 수 있으니 끌던 손가락은 잊는다.
    this.dragId = -1;
    // 아직 출발하지 않았으면 숨 고를 시간도 필요 없다.
    if (!this.playing || !this.gate.open) return;
    // 돌아오자마자 관문을 지나쳐 버리지 않도록 잠깐 멈춰서 길을 다시 보게 한다.
    this.grace = RESUME_GRACE_SECONDS;
    showBanner(this, this.roadTop + 62, '준비!', LOOK.text.ready, RESUME_GRACE_SECONDS * 1000, DEPTH.banner);
  }

  private showHint(): void {
    const top = this.crowdY + 36;
    const lines = [
      addText(this, GAME_WIDTH / 2, top, '좌우로 끌어 관문을 골라요', {
        color: LOOK.text.hint,
        originX: 0.5,
        stroke: LOOK.text.outline,
      }),
      addText(this, GAME_WIDTH / 2, top + 16, '무리가 많아야 적을 뚫어요', {
        color: LOOK.text.hintSub,
        originX: 0.5,
        stroke: LOOK.text.outline,
      }),
    ];
    for (const line of lines) line.setDepth(DEPTH.hud);
    this.tweens.add({
      targets: lines,
      alpha: 0,
      delay: 5000,
      duration: 500,
      onComplete: () => {
        for (const line of lines) line.destroy();
      },
    });
  }

  // ───────── 길 ─────────

  /** 길 바닥. 화면 아래로 이어지도록 아래쪽 둥근 모서리는 화면 밖에 둔다. */
  private drawRoad(): void {
    const road = this.add.graphics().setDepth(DEPTH.road);
    const width = ROAD_RIGHT - ROAD_LEFT;
    const bottom = this.scale.height + 20;
    road.fillStyle(LOOK.road.edge, 1);
    road.fillRoundedRect(ROAD_LEFT - 2, this.roadTop, width + 4, bottom - this.roadTop, 12);
    road.fillStyle(LOOK.road.face, 1);
    road.fillRoundedRect(ROAD_LEFT, this.roadTop + 2, width, bottom - this.roadTop, 10);
  }

  private createMarks(): void {
    const count = Math.ceil((this.scale.height - this.roadTop) / DASH.period) + 1;
    const make = (texture: string): Phaser.GameObjects.Image[] =>
      Array.from({ length: count }, () =>
        this.add.image(0, 0, texture).setOrigin(0, 0).setDepth(DEPTH.road).setVisible(false),
      );
    this.dashes = make(dashTexture(this));
    this.ticks = make(tickTexture(this));
  }

  /** 가운데 점선과 가장자리 눈금을 흘러내린 거리에 맞춰 다시 놓는다. */
  private drawMarks(): void {
    const top = this.roadTop + 8;
    const bottom = this.scale.height;
    /** 맨 위 자리(first)부터 간격마다 하나씩 놓고, 남는 것은 숨긴다. 길 윗변을 넘는 자리는 건너뛴다. */
    const place = (marks: Phaser.GameObjects.Image[], x: number, first: number, period: number): void => {
      let used = 0;
      for (let y = first; y < bottom && used < marks.length; y += period) {
        if (y < top) continue;
        marks[used].setPosition(x, y).setVisible(true);
        used += 1;
      }
      for (let index = used; index < marks.length; index += 1) marks[index].setVisible(false);
    };
    const dashTop = top + (this.distance % DASH.period) - DASH.period;
    place(this.dashes, ROAD_CENTER - DASH.width / 2 - 0.5, dashTop, DASH.period);
    // 눈금은 점선과 반 박자 어긋나게 놓는다.
    const shift = (this.distance + TICK.period / 2) % TICK.period;
    place(this.ticks, ROAD_LEFT + TICK.inset, top + shift - TICK.period - 0.5, TICK.period);
  }

  /** 달리는 동안: 길을 흘려보내고, 무리에 닿은 줄을 처리한다. */
  private advanceRoad(dt: number): void {
    const ahead = this.rows.find((row) => !row.passed);
    const wanted = scrollSpeed(ahead?.segment ?? this.course.segment);
    this.speed += (wanted - this.speed) * Math.min(1, dt * SPEED_EASE);

    const dy = this.speed * dt;
    this.distance += dy;
    this.frontier += dy;
    for (const row of this.rows) row.y += dy;
    this.spawnRows();
    this.drawMarks();

    for (const row of this.rows) {
      row.container.y = row.y;
      if (!row.passed) row.container.setAlpha(this.entryAlpha(row));
    }

    const next = this.rows.find((row) => !row.passed);
    if (!next) return;
    if (next.kind === 'gates') {
      if (next.y >= this.crowdY - GATE_CONTACT) this.enterGate(next);
    } else if (next.y + WALL.rowOffset + CREATURE_RADIUS >= this.crowdY - crowdReach(this.spots)) {
      this.startClash(next);
    }
  }

  /** 길 위쪽 끝에서 줄이 서서히 나타나게 하는 투명도. 줄이 HUD 쪽으로 삐져나와 보이지 않게 한다. */
  private entryAlpha(row: Row): number {
    return Phaser.Math.Clamp((row.y - ROW_REACH[row.kind] - this.roadTop) / ROW_FADE, 0, 1);
  }

  /** 길 위쪽 밖에 다음 줄이 언제나 준비되어 있게 한다. */
  private spawnRows(): void {
    const spawnY = this.roadTop - ROW_GAP / 2;
    while (this.frontier - ROW_GAP >= spawnY) {
      this.frontier -= ROW_GAP;
      const plan = this.nextPlan();
      const row =
        plan.kind === 'gates'
          ? this.addGateRow(plan.pair, plan.segment, this.frontier)
          : this.addWallRow(plan.enemies, plan.segment, this.frontier);
      row.container.setAlpha(this.entryAlpha(row));
      this.rows.push(row);
    }
  }

  /** 다음에 놓을 줄. 만들어 둔 것이 떨어지면 구간 하나를 새로 만든다. */
  private nextPlan(): RowPlan {
    const ready = this.plans.shift();
    if (ready) return ready;
    const { segment, course } = nextSegment(this.course, Math.random);
    this.course = course;
    const [first, ...rest] = segment.pairs.map(
      (pair): RowPlan => ({ kind: 'gates', segment: segment.index, pair }),
    );
    this.plans = [...rest, { kind: 'wall', segment: segment.index, enemies: segment.enemies }];
    return first;
  }

  /** 지나간 줄을 흐리게 지운다. 줄은 무리를 지나자마자 사라지므로 화면 아래까지 흘러가는 줄은 없다. */
  private fadeOut(row: Row): void {
    this.tweens.add({
      targets: row.container,
      alpha: 0,
      duration: ROW_OUT_MS,
      onComplete: () => {
        row.container.destroy();
        row.done = true;
      },
    });
  }

  // ───────── 관문 ─────────

  private addGateRow(pair: GatePair, segment: number, y: number): GateRow {
    const panels = {
      left: this.createGate(pair.left, laneCenter('left')),
      right: this.createGate(pair.right, laneCenter('right')),
    };
    const container = this.add.container(0, y, [panels.left, panels.right]).setDepth(DEPTH.row);
    return { kind: 'gates', segment, pair, y, passed: false, done: false, container, panels };
  }

  /** 관문 한 칸: 색 있는 판과 그 위의 글자. 나누기는 기호를 도형으로 그리고 수만 글자로 적는다. */
  private createGate(gate: Gate, x: number): Phaser.GameObjects.Container {
    const panel = this.add.graphics();
    drawGate(panel, isBoost(gate) ? LOOK.boost : LOOK.harm);

    const text = gate.kind === 'div' ? String(gate.value) : gateLabel(gate);
    const label = addText(this, 0, -1, text, {
      size: FONT_SIZE.large,
      color: LOOK.text.gate,
      originX: 0.5,
      originY: 0.5,
    });
    if (gate.kind === 'div') {
      const total = DIVIDE_SIGN.width + DIVIDE_SIGN.gap + label.width;
      drawDivideSign(panel, -total / 2 + DIVIDE_SIGN.width / 2);
      label.setX(Math.round(total / 2 - label.width / 2));
    }
    return this.add.container(x, 0, [panel, label]);
  }

  /** 무리가 관문 줄에 들어섰을 때: 중심이 있는 쪽의 관문을 지난다. */
  private enterGate(row: GateRow): void {
    const side = sideAt(this.crowdX);
    const gate = row.pair[side];
    const before = this.run.crowd;
    this.run = passGate(this.run, gate);
    row.passed = true;

    const chosen = row.panels[side];
    this.tweens.add({ targets: chosen, scale: 1.12, duration: ROW_OUT_MS, ease: 'Quad.Out' });
    this.fadeOut(row);

    const change = this.run.crowd - before;
    this.showCrowd(true);
    if (change !== 0) {
      floatText(
        this,
        this.crowdX + 34,
        this.crowdY - 18,
        change > 0 ? `+${change}` : String(change),
        change > 0 ? LOOK.text.gain : LOOK.text.loss,
        this.playArea,
        DEPTH.effect,
      );
    }
    if (change >= 0) {
      this.sparks.explode(6, this.crowdX, this.crowdY - 10);
      sfx.pop();
      vibrate(10);
    } else {
      this.puffs.explode(6, this.crowdX, this.crowdY);
      sfx.expire();
      vibrate(25);
    }

    this.hud.setScore(this.run.score);
    if (isOver(this.run)) this.endRun();
  }

  // ───────── 적 ─────────

  private addWallRow(enemies: number, segment: number, y: number): WallRow {
    const mat = this.add.graphics();
    drawMat(mat);
    const foes = wallSpots(enemies).map((spot) => this.add.image(spot.x, spot.y, creatureTexture(this, true)));
    const badge = new CountBadge(this, LOOK.foeBadge);
    badge.container.setPosition(ROAD_CENTER, WALL.badgeY);
    badge.set(enemies);
    const container = this.add
      .container(0, y, [mat, ...foes, badge.container])
      .setDepth(DEPTH.row);
    return { kind: 'wall', segment, enemies, y, passed: false, done: false, container, foes, badge };
  }

  /** 적과 맞닿았을 때: 길을 멈추고 양쪽 수를 줄여 나가기 시작한다. */
  private startClash(wall: WallRow): void {
    const { state, clash } = hitWall(this.run, wall.enemies, wall.segment);
    wall.passed = true;
    // 무리와 가까운 적부터 사라지도록, 먼 적이 목록의 앞에 오게 한다.
    wall.foes.sort((a, b) => Math.abs(b.x - this.crowdX) - Math.abs(a.x - this.crowdX));
    this.clash = { wall, from: this.run.crowd, after: state, outcome: clash, time: 0, shown: 0 };
    this.phase = 'clash';
    sfx.bump();
    vibrate(20);
    this.cameras.main.shake(120, 0.006);
  }

  /** 부딪힌 동안: 양쪽 수가 같은 빠르기로 줄어들고, 다 줄면 결과를 따른다. */
  private advanceClash(dt: number): void {
    const clash = this.clash;
    if (!clash) return;
    clash.time += dt;
    const progress = Math.min(1, clash.time / CLASH_SECONDS);
    const gone = Math.round(clash.outcome.lost * progress);
    if (gone !== clash.shown) {
      clash.shown = gone;
      this.run = { ...this.run, crowd: clash.from - gone };
      this.showCrowd(false);
      this.showFoes(clash.wall, clash.wall.enemies - gone);
      this.puffs.explode(2, this.crowdX, this.crowdY - crowdReach(this.spots));
      sfx.tick();
    }
    if (progress >= 1) this.endClash(clash);
  }

  private showFoes(wall: WallRow, left: number): void {
    wall.badge.set(left);
    const shown = Math.ceil((wall.foes.length * left) / wall.enemies);
    wall.foes.forEach((foe, index) => foe.setVisible(index < shown));
  }

  private endClash(clash: ClashState): void {
    this.run = clash.after;
    this.clash = null;
    this.showCrowd(true);
    this.hud.setScore(this.run.score);

    if (!clash.outcome.broken) {
      this.endRun();
      return;
    }
    this.phase = 'run';
    this.fadeOut(clash.wall);
    this.hud.setSide(`돌파 ${this.run.walls}`, true);
    this.sparks.explode(14, this.crowdX, clash.wall.y);
    floatText(
      this,
      ROAD_CENTER,
      clash.wall.y + WALL.badgeY,
      `+${clash.outcome.points}`,
      LOOK.text.points,
      this.playArea,
      DEPTH.effect,
    );
    sfx.hit(this.run.walls);
    vibrate([12, 20, 12]);
  }

  /** 무리가 바닥났을 때 */
  private endRun(): void {
    this.phase = 'over';
    sfx.miss();
    vibrate([40, 30, 80]);
    this.cameras.main.shake(180, 0.012);
    this.puffs.explode(12, this.crowdX, this.crowdY);
    this.badge.container.setVisible(false);

    showBanner(this, this.roadTop + 62, '앗!', LOOK.text.over, 900, DEPTH.banner);
    this.finishMiniGame(this.run.score, [
      ['뚫은 적', `${this.run.walls}번`],
      ['지나간 관문', `${this.run.gates}개`],
      ['최대 무리', `${this.run.maxCrowd}마리`],
    ]);
  }

  // ───────── 무리 ─────────

  private createCrowd(): void {
    this.buddies = Array.from({ length: CROWD_SHOWN_MAX }, () =>
      this.add.image(0, 0, creatureTexture(this, false)).setVisible(false),
    );
    this.crowd = this.add.container(this.crowdX, this.crowdY, this.buddies).setDepth(DEPTH.crowd);
    this.badge = new CountBadge(this, LOOK.buddyBadge);
    this.badge.container.setDepth(DEPTH.badge);
    this.showCrowd(false);
    this.placeCrowd();
  }

  /** 지금 무리 수에 맞춰 친구들과 숫자를 다시 놓는다. pop이면 수가 바뀐 것을 튀는 움직임으로 알린다. */
  private showCrowd(pop: boolean): void {
    const before = this.spots.length;
    this.spots = crowdSpots(this.run.crowd);
    this.buddies.forEach((buddy, index) => {
      const shown = index < this.spots.length;
      buddy.setVisible(shown);
      if (!shown) return;
      this.tweens.killTweensOf(buddy);
      buddy.setScale(1);
      // 새로 들어온 친구는 작게 나타나서 제 크기로 커진다.
      if (pop && index >= before) {
        this.tweens.add({ targets: buddy, scale: { from: 0.2, to: 1 }, duration: 200, ease: 'Back.Out' });
      }
    });
    this.badge.set(this.run.crowd);
    if (pop) this.badge.pop();
  }

  /** 무리와 숫자를 지금 자리에 놓는다. 친구마다 박자를 달리해 들썩인다. */
  private placeCrowd(): void {
    this.crowd.setPosition(this.crowdX, this.crowdY);
    this.spots.forEach((spot, index) => {
      const bob = Math.sin(this.bobTime * BOB.rate + index * 1.9) * BOB.height;
      this.buddies[index].setPosition(spot.x, spot.y + bob);
    });
    const badgeY = this.crowdY - crowdReach(this.spots) - BADGE_GAP - BADGE.height / 2;
    this.badge.container.setPosition(this.crowdX, badgeY);
  }

  private createEmitter(tints: readonly number[]): Phaser.GameObjects.Particles.ParticleEmitter {
    return this.add
      .particles(0, 0, TEXTURE.spark, {
        speed: { min: 30, max: 90 },
        lifespan: { min: 200, max: 380 },
        alpha: { start: 1, end: 0 },
        tint: [...tints],
        emitting: false,
      })
      .setDepth(DEPTH.effect);
  }
}
