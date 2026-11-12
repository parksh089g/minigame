import Phaser from 'phaser';
import { TEXTURE } from '../../art/sprites';
import { FONT_SIZE, GAME_WIDTH, MIN_GAME_HEIGHT, SCENE, THEME, THEME_CSS } from '../../config';
import { bakeShape } from '../../core/bake';
import { vibrate } from '../../core/haptics';
import { sfx } from '../../core/sfx';
import { addBackdrop, addText, drawPanel } from '../../core/ui';
import { floatText, GameHud, HUD_HEIGHT, showBanner } from '../../scenes/GameHud';
import { MiniGameScene, type ResultStat } from '../../scenes/MiniGameScene';
import {
  betterCandidate,
  BOARD_COLS,
  BOARD_ROWS,
  BOX_POINTS,
  BOX_SIZE,
  buildStage,
  levelStage,
  canTake,
  cellAt,
  cellPosition,
  freeScrews,
  OPEN_BOXES,
  plateRects,
  proposeStage,
  screwAt,
  STAGE_CANDIDATES,
  stageBonus,
  startStage,
  takeScrew,
  topPlateAt,
  TRAY_SIZE,
  type Bench,
  type Candidate,
  type Stage,
  type TakeOutcome,
} from './rules';

/** 나사 머리에 새긴 무늬. 색을 가리지 못해도 무늬로 구분할 수 있다. */
type MarkShape = 'cross' | 'bar' | 'ex' | 'ring' | 'triangle' | 'square';

interface ScrewLook {
  face: number;
  deep: number;
  mark: number;
  shape: MarkShape;
}

interface PlateLook {
  face: number;
  deep: number;
}

/** 판에서 풀려나온 나사. 상자나 쟁반으로 날아간다. */
interface Token {
  head: Phaser.GameObjects.Image;
  /** 톡 튀어나오는 움직임이 끝나는 시각. 그 뒤에 날아가기 시작한다. */
  readyAt: number;
  /** 지금 가고 있는 길. 가는 곳이 바뀌면 멈추고 새로 간다. */
  flight: Phaser.Tweens.Tween | null;
}

/** 화면에 차례로 보여 줄 일 하나. 다음 일을 시작하기까지 기다릴 시간(ms)을 돌려준다. */
type Step = () => number;

/** 작업대 칸의 가로 크기. 세로는 화면 높이에 따라 CELL_MIN_HEIGHT~CELL_MAX_HEIGHT 사이에서 정한다. */
const CELL_WIDTH = 32;
const CELL_MIN_HEIGHT = 32;
const CELL_MAX_HEIGHT = 44;
/** 작업대 카드: 좌우 여백, 칸과 카드 가장자리 사이, 화면 아래 여백 */
const BENCH = { margin: 4, pad: 4, bottom: 6, radius: 14, lip: 3 } as const;
/** 판: 칸 가장자리에서 들여 그리는 폭, 모서리 반지름, 아래쪽 두께 */
const PLATE = { inset: 1.5, radius: 7, lip: 3 } as const;
const SCREW_RADIUS = 7.5;
const HOLE_RADIUS = 3;
/** 상자: 나사 세 개가 들어가는 칸(well)이 가로로 놓인다. */
const BOX = {
  width: 76,
  height: 30,
  radius: 10,
  lip: 3,
  gap: 6,
  left: 8,
  wellPitch: 22,
  wellRadius: 9.5,
} as const;
/** 다음 상자 미리 보기 */
const NEXT = { width: 58, height: 26 } as const;
/** 쟁반: 왼쪽에 이름표, 그 옆으로 자리 다섯 개 */
const TRAY = { width: 152, height: 26, lip: 3, labelWidth: 30, wellPitch: 22, wellRadius: 9.5 } as const;
/** 위쪽 줄들 사이의 간격. 화면이 길면 EXTRA_AIR까지 더 벌린다. */
const ROW_GAP = 4;
const EXTRA_AIR = 6;

/** 나사가 톡 튀어나오는 시간, 날아가는 시간, 쟁반에서 상자로 건너가는 시간(ms) */
const POP_MS = 110;
const FLY_MS = 200;
const HOP_MS = 160;
/** 쟁반의 나사가 하나씩 건너가는 간격(ms) */
const HOP_STAGGER_MS = 70;
/** 상자가 닫히는 시간, 새 상자가 미끄러져 들어오는 시간(ms) */
const CLOSE_MS = 260;
const SLIDE_MS = 180;
const FALL_MS = 560;
/** 판을 나눠 줄 때 한 장마다 늦추는 시간, 한 장이 나타나는 시간(ms) */
const DEAL_STAGGER_MS = 45;
const DEAL_MS = 160;
/** 단계를 깬 뒤 다음 단계가 나오기까지(ms) */
const NEXT_STAGE_MS = 1000;
/** 마지막으로 누른 뒤 이만큼 조용하면 그 틈에 다음 단계의 후보를 하나씩 만들어 둔다(ms). */
const PREP_IDLE_MS = 350;
const HINT_MS = 5000;
/** 작업대 위쪽에 뜨는 한 줄 알림이 머무는 시간(ms): 쟁반을 처음 쓸 때, 풀 수 없는 나사를 눌렀을 때 */
const TRAY_NOTICE_MS = 2600;
const REFUSE_NOTICE_MS = 1100;

/**
 * 이 게임의 색을 한곳에 모아 둔다. 겉모습을 바꿀 때는 여기와 아래의 draw 함수들만 고치면 된다.
 */
const LOOK = {
  /** 작업대와 그 위의 구멍 무늬 */
  bench: { face: THEME.lilacSoft, lip: THEME.lilac, peg: THEME.lilac },
  /** 판의 색. 겹친 판이 구분되도록 차례로 돌려 쓴다. 나사 색과 헷갈리지 않게 옅은 색만 쓴다. */
  plates: [
    { face: THEME.card, deep: THEME.shadow },
    { face: THEME.butterSoft, deep: THEME.butterDeep },
    { face: THEME.dim, deep: THEME.faint },
  ] as readonly PlateLook[],
  /** 나사 색 여섯 가지. 순서가 rules의 색 번호다. */
  screws: [
    { face: THEME.coral, deep: THEME.coralDeep, mark: THEME.inkDeep, shape: 'cross' },
    { face: THEME.gold, deep: THEME.butterDeep, mark: THEME.inkDeep, shape: 'bar' },
    { face: THEME.mint, deep: THEME.mintDeep, mark: THEME.inkDeep, shape: 'ex' },
    { face: THEME.sky, deep: THEME.skyDeep, mark: THEME.inkDeep, shape: 'ring' },
    { face: THEME.lilac, deep: THEME.lilacDeep, mark: THEME.inkDeep, shape: 'triangle' },
    { face: THEME.sub, deep: THEME.inkDeep, mark: THEME.white, shape: 'square' },
  ] as readonly ScrewLook[],
  /** 나사 머리와 판의 반짝임 */
  shine: THEME.white,
  /** 상자 안의 빈 나사 자리: 어둑하게 파인 면과 그 위에 새긴 무늬 */
  well: { shade: THEME.inkDeep, shadeAlpha: 0.26, mark: THEME.white, markAlpha: 0.9 },
  tray: { face: THEME.card, lip: THEME.shadow, well: THEME.dim },
  /** 쟁반이 한 자리 남았을 때, 가득 찼을 때의 테두리와 자리 색 */
  trayWarn: { border: THEME.gold, well: THEME.butterSoft },
  trayFull: { border: THEME.coral, well: THEME.pinkSoft },
  next: { face: THEME.card, lip: THEME.shadow, empty: THEME.dim },
  /** 쟁반이 가득 찼을 때 아직 풀 수 있는 나사를 알려 주는 테두리 */
  alert: THEME.coralDeep,
  sparks: [THEME.gold, THEME.pink, THEME.mintDeep],
  text: {
    hint: THEME_CSS.ink,
    hintSub: THEME_CSS.sub,
    label: THEME_CSS.sub,
    outline: THEME_CSS.white,
    points: THEME_CSS.accent,
    clear: THEME_CSS.good,
    warn: THEME_CSS.bad,
    over: THEME_CSS.bad,
  },
} as const;

const DEPTH = {
  bench: 1,
  panel: 2,
  box: 3,
  board: 5,
  falling: 10,
  token: 20,
  effect: 25,
  hud: 30,
  hint: 32,
  banner: 40,
} as const;

/** 나사 머리의 무늬를 (cx, cy)를 가운데로 그린다. */
function drawMark(
  graphics: Phaser.GameObjects.Graphics,
  shape: MarkShape,
  color: number,
  cx: number,
  cy: number,
  alpha = 1,
): void {
  graphics.fillStyle(color, alpha);
  graphics.lineStyle(2.2, color, alpha);
  switch (shape) {
    case 'cross':
      graphics.fillRoundedRect(cx - 3.6, cy - 1.1, 7.2, 2.2, 1);
      graphics.fillRoundedRect(cx - 1.1, cy - 3.6, 2.2, 7.2, 1);
      break;
    case 'bar':
      graphics.fillRoundedRect(cx - 3.8, cy - 1.3, 7.6, 2.6, 1.3);
      break;
    case 'ex':
      graphics.lineBetween(cx - 2.7, cy - 2.7, cx + 2.7, cy + 2.7);
      graphics.lineBetween(cx - 2.7, cy + 2.7, cx + 2.7, cy - 2.7);
      break;
    case 'ring':
      graphics.lineStyle(1.9, color, alpha);
      graphics.strokeCircle(cx, cy, 2.9);
      break;
    case 'triangle':
      graphics.fillTriangle(cx, cy - 3.6, cx + 3.6, cy + 2.6, cx - 3.6, cy + 2.6);
      break;
    case 'square':
      graphics.fillRoundedRect(cx - 2.8, cy - 2.8, 5.6, 5.6, 1.2);
      break;
  }
}

/** 나사 머리를 (0, 0)을 가운데로 그린다. 아래쪽에 짙은 테가 살짝 보여 도톰해 보인다. */
function drawScrew(graphics: Phaser.GameObjects.Graphics, look: ScrewLook): void {
  graphics.fillStyle(look.deep, 1);
  graphics.fillCircle(0, 1.5, SCREW_RADIUS);
  graphics.fillStyle(look.face, 1);
  graphics.fillCircle(0, 0, SCREW_RADIUS);
  graphics.fillStyle(LOOK.shine, 0.55);
  graphics.fillEllipse(-2.8, -4, 5, 2.4);
  drawMark(graphics, look.shape, look.mark, 0, 0);
}

/** 나사 머리 그림의 크기. 아래쪽 테가 들어가도록 지름보다 조금 넉넉하다. */
const SCREW_ART = Math.ceil(SCREW_RADIUS * 2) + 4;

/**
 * 나사 머리의 그림. 판마다 여러 개가 박혀 있으므로 색마다 한 장씩 구워서 같이 쓴다.
 * 이미지의 한가운데가 나사의 한가운데다.
 */
function screwTexture(scene: Phaser.Scene, color: number): string {
  return bakeShape(scene, `screw-sort-screw-${color}`, { width: SCREW_ART, height: SCREW_ART }, (graphics) =>
    drawScrew(graphics, LOOK.screws[color]),
  );
}

interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 판 하나를 그린다. rects는 판을 덮는 네모들, holes는 나사 구멍의 자리다(둘 다 그릇의 원점 기준).
 * 짙은 색으로 전체를 칠하고 그 안쪽 위에 밝은 면을 얹어서, 둘레에는 가는 테가, 아래에는 두께가 보인다.
 */
function drawPlate(
  graphics: Phaser.GameObjects.Graphics,
  rects: readonly PixelRect[],
  holes: ReadonlyArray<{ x: number; y: number }>,
  look: PlateLook,
): void {
  graphics.fillStyle(look.deep, 1);
  for (const rect of rects) {
    graphics.fillRoundedRect(rect.x, rect.y, rect.width, rect.height, PLATE.radius);
  }
  graphics.fillStyle(look.face, 1);
  for (const rect of rects) {
    const height = rect.height - 2 - PLATE.lip;
    graphics.fillRoundedRect(rect.x + 1, rect.y + 1, rect.width - 2, height, PLATE.radius - 1);
  }
  const [first] = rects;
  graphics.fillStyle(LOOK.shine, 0.8);
  graphics.fillRoundedRect(first.x + 6, first.y + 4, Math.min(12, first.width - 12), 2, 1);
  graphics.fillStyle(look.deep, 1);
  for (const hole of holes) graphics.fillCircle(hole.x, hole.y, HOLE_RADIUS);
}

/**
 * 상자를 (0, 0)을 가운데로 그린다. 빈 자리는 어둑하게 파여 있고 그 색의 무늬가 희게 새겨져 있어서,
 * 무엇을 넣는 상자인지와 몇 자리가 비었는지를 함께 알 수 있다.
 */
function drawBox(graphics: Phaser.GameObjects.Graphics, look: ScrewLook): void {
  const left = -BOX.width / 2;
  const top = -BOX.height / 2;
  graphics.fillStyle(look.deep, 1);
  graphics.fillRoundedRect(left, top + BOX.lip, BOX.width, BOX.height, BOX.radius);
  graphics.fillStyle(look.face, 1);
  graphics.fillRoundedRect(left, top, BOX.width, BOX.height, BOX.radius);
  for (let place = 0; place < BOX_SIZE; place += 1) {
    const x = (place - (BOX_SIZE - 1) / 2) * BOX.wellPitch;
    graphics.fillStyle(LOOK.well.shade, LOOK.well.shadeAlpha);
    graphics.fillCircle(x, 0, BOX.wellRadius);
    drawMark(graphics, look.shape, LOOK.well.mark, x, 0, LOOK.well.markAlpha);
  }
}

/** 상자의 그림. 색마다 한 장씩 구워 둔다. 이미지의 왼쪽 위가 상자의 왼쪽 위다. */
function boxTexture(scene: Phaser.Scene, color: number): string {
  const box = {
    width: BOX.width,
    height: BOX.height + BOX.lip,
    originX: BOX.width / 2,
    originY: BOX.height / 2,
  };
  return bakeShape(scene, `screw-sort-box-${color}`, box, (graphics) => drawBox(graphics, LOOK.screws[color]));
}

/** 판의 그림은 단계마다 모양이 달라서 그때그때 굽는다. 이름 앞에 이것을 붙여 두고, 다 쓴 것은 지운다. */
const PLATE_TEXTURE = 'screw-sort-plate-';

const EMPTY_STAGE: Stage = { plates: [], screws: [], boxes: [], solution: [] };

/**
 * 나사 풀기: 겹쳐 쌓인 판에서 가려지지 않은 나사를 눌러 푼다.
 * 푼 나사는 같은 색 상자로 가고, 상자는 셋이 차면 닫힌다. 맞는 상자가 없으면 쟁반에서 기다린다.
 * 쟁반이 가득 차서 더 풀 수 있는 나사가 없으면 끝난다. 나사를 모두 풀면 더 어려운 단계가 나온다.
 */
export class ScrewSortScene extends MiniGameScene {
  protected readonly gameId = 'screw-sort';

  private bench: Bench = startStage(EMPTY_STAGE);
  private stageNumber = 1;
  private score = 0;
  private screwsOut = 0;
  private boxesClosed = 0;
  private stagesCleared = 0;
  /** 나사를 누를 수 있는지. 판을 나눠 주는 동안과 단계가 끝난 뒤에는 false. */
  private accepting = false;
  private lastTapAt = 0;

  // 자리: create()에서 화면 높이에 맞춰 정한다.
  private cellHeight = CELL_MIN_HEIGHT;
  private gridLeft = 0;
  private gridTop = 0;
  private boxY = 0;
  private trayTop = 0;
  private benchArea = new Phaser.Geom.Rectangle();
  /** HUD 아래의 화면 전체. 떠오르는 글자가 이 밖으로 나가지 않는다. */
  private playArea = new Phaser.Geom.Rectangle();

  private hud!: GameHud;
  /** 판들을 아래에서 위로 쌓인 순서대로 담는 층 */
  private boardLayer!: Phaser.GameObjects.Container;
  private plateViews: Array<Phaser.GameObjects.Container | null> = [];
  /** 단계를 깐 횟수. 판 그림의 이름에 넣어서 단계마다 다른 텍스처를 쓴다. */
  private deals = 0;
  /** 나사 번호로 찾는 나사 머리 */
  private tokens: Token[] = [];
  /** 자리마다 열려 있는 상자. 담긴 나사도 이 그릇에 들어 있어서 상자와 함께 움직인다. */
  private boxViews: Array<Phaser.GameObjects.Container | null> = [];
  /** 자리마다, 그 상자로 날아가는 나사가 모두 닿는 시각 */
  private slotBusyUntil: number[] = [];
  /** 화면의 쟁반에 놓인 나사 번호들. 왼쪽부터다. */
  private trayTokens: number[] = [];
  private trayPanel!: Phaser.GameObjects.Graphics;
  private nextIcon!: Phaser.GameObjects.Graphics;
  private alerts: Phaser.GameObjects.Graphics[] = [];
  /** 작업대 위쪽에 잠깐 뜨는 한 줄 알림 */
  private notice!: Phaser.GameObjects.Text;
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  private trayHintShown = false;

  /** 차례로 보여 줄 일들. 규칙은 누르는 즉시 반영하고, 상자와 쟁반의 움직임만 줄을 세워 보여 준다. */
  private steps: Step[] = [];
  private stepping = false;

  /** 쉬는 틈에 골라 둔 다음 단계의 후보와, 더 만들어 볼 횟수 */
  private prepared: Candidate | null = null;
  private toPropose = 0;

  constructor() {
    super(SCENE.screwSort);
  }

  create(): void {
    this.beginMiniGame();
    this.resetState();
    this.placeRows();

    addBackdrop(this);
    this.drawBench();
    this.boardLayer = this.add.container(0, 0).setDepth(DEPTH.board);
    this.trayPanel = this.add.graphics().setDepth(DEPTH.panel);
    this.addLabels();
    this.nextIcon = this.add.graphics().setDepth(DEPTH.box);
    this.notice = addText(this, GAME_WIDTH / 2, this.benchArea.top + 5, '', {
      color: LOOK.text.warn,
      originX: 0.5,
      stroke: LOOK.text.outline,
    })
      .setDepth(DEPTH.hint)
      .setAlpha(0);
    this.sparks = this.add
      .particles(0, 0, TEXTURE.spark, {
        speed: { min: 30, max: 100 },
        lifespan: { min: 200, max: 380 },
        alpha: { start: 1, end: 0 },
        tint: [...LOOK.sparks],
        emitting: false,
      })
      .setDepth(DEPTH.effect);

    this.addPauseButton();
    this.hud = new GameHud(this, DEPTH.hud);
    if (this.stageLevel !== null) this.hud.showStage(this.stageLevel);
    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);

    // 단계 모드에서는 단계 번호로 정해진 판 하나만 나온다.
    if (this.stageLevel !== null) this.stageNumber = levelStage(this.stageLevel);
    // 도움말은 작업대 아래가 비어 있는 첫 난이도에서만 적는다.
    if (this.stageNumber === 1) this.showHint();
    this.dealStage(buildStage(this.stageNumber, this.levelRandom()));
    sfx.go();
  }

  override update(): void {
    // 단계 모드는 한 단계가 한 판이라 다음 단계를 미리 만들어 둘 일이 없다.
    if (this.stageLevel !== null) return;
    if (this.toPropose <= 0 || !this.accepting || this.stepping) return;
    if (this.time.now - this.lastTapAt < PREP_IDLE_MS) return;
    // 손이 쉬는 틈에 다음 단계의 후보를 한 번에 하나씩만 만들어서, 화면이 끊기지 않게 한다.
    this.prepared = betterCandidate(this.prepared, proposeStage(this.stageNumber + 1, Math.random));
    this.toPropose = this.prepared.fit >= 0 ? 0 : this.toPropose - 1;
  }

  private resetState(): void {
    this.bench = startStage(EMPTY_STAGE);
    this.stageNumber = 1;
    this.score = 0;
    this.screwsOut = 0;
    this.boxesClosed = 0;
    this.stagesCleared = 0;
    this.accepting = false;
    this.lastTapAt = 0;
    this.plateViews = [];
    this.tokens = [];
    this.boxViews = Array.from({ length: OPEN_BOXES }, () => null);
    this.slotBusyUntil = Array.from({ length: OPEN_BOXES }, () => 0);
    this.trayTokens = [];
    this.alerts = [];
    this.trayHintShown = false;
    this.steps = [];
    this.stepping = false;
    this.prepared = null;
    this.toPropose = 0;
  }

  // ───────── 자리 잡기 ─────────

  /** 위에서부터 상자 줄, 쟁반, 작업대를 놓는다. 화면이 길면 줄 사이를 조금 벌리고 나머지는 작업대가 쓴다. */
  private placeRows(): void {
    const { height } = this.scale;
    this.playArea = new Phaser.Geom.Rectangle(0, HUD_HEIGHT, GAME_WIDTH, height - HUD_HEIGHT);
    const air = Math.min(EXTRA_AIR, Math.floor((height - MIN_GAME_HEIGHT) / 14));
    const boxTop = HUD_HEIGHT + 2 + air;
    this.boxY = boxTop + BOX.height / 2;
    this.trayTop = boxTop + BOX.height + BOX.lip + ROW_GAP + air;
    const benchTop = this.trayTop + TRAY.height + TRAY.lip + ROW_GAP + air;
    const benchHeight = height - BENCH.bottom - benchTop;
    const benchWidth = GAME_WIDTH - BENCH.margin * 2;
    this.benchArea = new Phaser.Geom.Rectangle(BENCH.margin, benchTop, benchWidth, benchHeight);

    this.cellHeight = Phaser.Math.Clamp(
      Math.floor((benchHeight - BENCH.pad * 2) / BOARD_ROWS),
      CELL_MIN_HEIGHT,
      CELL_MAX_HEIGHT,
    );
    this.gridLeft = Math.round((GAME_WIDTH - BOARD_COLS * CELL_WIDTH) / 2);
    this.gridTop = Math.round(benchTop + (benchHeight - BOARD_ROWS * this.cellHeight) / 2);
  }

  private cellCenter(cell: number): { x: number; y: number } {
    const { col, row } = cellPosition(cell);
    return {
      x: this.gridLeft + col * CELL_WIDTH + CELL_WIDTH / 2,
      y: this.gridTop + row * this.cellHeight + this.cellHeight / 2,
    };
  }

  /** 그 자리의 칸 번호. 작업대 밖이면 -1. */
  private cellUnder(x: number, y: number): number {
    const col = Math.floor((x - this.gridLeft) / CELL_WIDTH);
    const row = Math.floor((y - this.gridTop) / this.cellHeight);
    if (col < 0 || col >= BOARD_COLS || row < 0 || row >= BOARD_ROWS) return -1;
    return cellAt(col, row);
  }

  private slotX(slot: number): number {
    return BOX.left + BOX.width / 2 + slot * (BOX.width + BOX.gap);
  }

  /** slot번 상자의 place번째 나사 자리 */
  private wellPosition(slot: number, place: number): { x: number; y: number } {
    return { x: this.slotX(slot) + (place - (BOX_SIZE - 1) / 2) * BOX.wellPitch, y: this.boxY };
  }

  private get nextX(): number {
    return BOX.left + OPEN_BOXES * (BOX.width + BOX.gap) + NEXT.width / 2;
  }

  private get trayLeft(): number {
    return Math.round((GAME_WIDTH - TRAY.width) / 2);
  }

  private trayPosition(place: number): { x: number; y: number } {
    const first = this.trayLeft + TRAY.labelWidth + TRAY.wellPitch / 2 + 3;
    return { x: first + place * TRAY.wellPitch, y: this.trayTop + TRAY.height / 2 };
  }

  // ───────── 바탕 그리기 ─────────

  /** upTo번째까지 깔았던 단계의 판 그림을 지운다. */
  private dropPlateTextures(upTo: number): void {
    for (const key of this.textures.getTextureKeys()) {
      if (!key.startsWith(PLATE_TEXTURE)) continue;
      const deal = Number(key.slice(PLATE_TEXTURE.length).split('-')[0]);
      if (deal <= upTo) this.textures.remove(key);
    }
  }

  /** 작업대. 구멍이 많아서 한 장으로 구워 놓는다. 화면의 길이에 따라 크기가 달라지므로 들어올 때마다 새로 굽는다. */
  private drawBench(): void {
    const area = this.benchArea;
    const key = 'screw-sort-bench';
    if (this.textures.exists(key)) this.textures.remove(key);
    const box = { width: area.width, height: area.height + BENCH.lip, originX: -area.x, originY: -area.y };
    bakeShape(this, key, box, (graphics) => {
      drawPanel(graphics, area.x, area.y, area.width, area.height, {
        fill: LOOK.bench.face,
        shadow: LOOK.bench.lip,
        radius: BENCH.radius,
        depth: BENCH.lip,
      });
      // 칸마다 작은 구멍을 찍어서 나사가 박힐 자리가 어디인지 보이게 한다.
      graphics.fillStyle(LOOK.bench.peg, 1);
      for (let cell = 0; cell < BOARD_COLS * BOARD_ROWS; cell += 1) {
        const { x, y } = this.cellCenter(cell);
        graphics.fillCircle(x, y, 1.6);
      }
    });
    this.add.image(area.x, area.y, key).setOrigin(0, 0).setDepth(DEPTH.bench);
  }

  private addLabels(): void {
    const tray = this.trayPosition(0);
    addText(this, this.trayLeft + 9, tray.y, '쟁반', {
      size: FONT_SIZE.small,
      color: LOOK.text.label,
      originY: 0.5,
    }).setDepth(DEPTH.box);

    const left = this.nextX - NEXT.width / 2;
    const top = this.boxY - NEXT.height / 2;
    const panel = this.add.graphics().setDepth(DEPTH.panel);
    drawPanel(panel, left, top, NEXT.width, NEXT.height, {
      fill: LOOK.next.face,
      shadow: LOOK.next.lip,
      radius: NEXT.height / 2,
    });
    addText(this, left + 9, this.boxY, '다음', {
      size: FONT_SIZE.small,
      color: LOOK.text.label,
      originY: 0.5,
    }).setDepth(DEPTH.box);
  }

  /** 쟁반을 그린다. 한 자리 남으면 노랗게, 가득 차면 붉게 바뀐다. */
  private drawTray(): void {
    const count = this.trayTokens.length;
    const warn = count >= TRAY_SIZE ? LOOK.trayFull : count === TRAY_SIZE - 1 ? LOOK.trayWarn : null;
    const graphics = this.trayPanel;
    graphics.clear();
    drawPanel(graphics, this.trayLeft, this.trayTop, TRAY.width, TRAY.height, {
      fill: LOOK.tray.face,
      shadow: LOOK.tray.lip,
      border: warn?.border,
      radius: TRAY.height / 2,
      depth: TRAY.lip,
    });
    for (let place = 0; place < TRAY_SIZE; place += 1) {
      const { x, y } = this.trayPosition(place);
      // 아직 빈 자리만 경고색으로 칠해서, 몇 자리 남았는지가 눈에 들어온다.
      graphics.fillStyle(warn && place >= count ? warn.well : LOOK.tray.well, 1);
      graphics.fillCircle(x, y, TRAY.wellRadius);
    }
  }

  /** 다음에 나올 상자의 색을 미리 보여 준다. 더 나올 상자가 없으면 빈 자리만 남는다. */
  private showNext(color: number | null): void {
    const icon = this.nextIcon;
    icon.setPosition(this.nextX + 13, this.boxY);
    icon.clear();
    if (color === null) {
      icon.fillStyle(LOOK.next.empty, 1);
      icon.fillCircle(0, 0, SCREW_RADIUS);
      return;
    }
    drawScrew(icon, LOOK.screws[color]);
    this.tweens.killTweensOf(icon);
    this.tweens.add({ targets: icon, scale: { from: 0.5, to: 1 }, duration: 160, ease: 'Back.Out' });
  }

  private showHint(): void {
    // 첫 단계는 작업대 아래 두 줄이 비어 있어서 거기에 적는다.
    const y = this.gridTop + (BOARD_ROWS - 1) * this.cellHeight;
    const lines = [
      addText(this, GAME_WIDTH / 2, y - 16, '가려지지 않은 나사를 눌러요', {
        color: LOOK.text.hint,
        originX: 0.5,
        stroke: LOOK.text.outline,
      }),
      addText(this, GAME_WIDTH / 2, y + 2, '같은 색 셋이 모이면 상자가 닫혀요', {
        color: LOOK.text.hintSub,
        originX: 0.5,
        stroke: LOOK.text.outline,
      }),
    ];
    for (const line of lines) line.setDepth(DEPTH.hint);
    this.tweens.add({
      targets: lines,
      alpha: 0,
      delay: HINT_MS,
      duration: 500,
      onComplete: () => {
        for (const line of lines) line.destroy();
      },
    });
  }

  /** 작업대 위쪽에 한 줄 알림을 잠깐 보여 준다. 먼저 떠 있던 알림은 새것으로 바뀐다. */
  private showNotice(label: string, holdMs: number): void {
    this.tweens.killTweensOf(this.notice);
    this.notice.setText(label).setAlpha(1);
    this.tweens.add({ targets: this.notice, alpha: 0, delay: holdMs, duration: 300 });
  }

  // ───────── 단계 ─────────

  /** 새 단계를 깐다. 판이 아래 것부터 차례로 나타나고, 다 깔린 뒤부터 누를 수 있다. */
  private dealStage(stage: Stage): void {
    this.bench = startStage(stage);
    if (this.stageLevel === null) this.hud.setSide(`${this.stageNumber}단계`, this.stageNumber > 1);
    this.buildBoard(stage);
    this.bench.open.forEach((box, slot) => {
      if (box) this.enterBox(slot, box.color, slot * 90);
    });
    this.showNext(stage.boxes[this.bench.nextBox] ?? null);
    this.drawTray();

    this.time.delayedCall(stage.plates.length * DEAL_STAGGER_MS + DEAL_MS, () => {
      this.accepting = true;
      this.playing = true;
      this.lastTapAt = this.time.now;
      this.prepared = null;
      this.toPropose = STAGE_CANDIDATES;
    });
  }

  private buildBoard(stage: Stage): void {
    // 두 단계 전의 판 그림은 이제 화면에 없으므로 지운다(바로 앞 단계의 판은 아직 사라지는 중일 수 있다).
    this.deals += 1;
    this.dropPlateTextures(this.deals - 2);
    this.plateViews = stage.plates.map((plate, index) => {
      const centers = plate.cells.map((cell) => this.cellCenter(cell));
      const x = centers.reduce((sum, center) => sum + center.x, 0) / centers.length;
      const y = centers.reduce((sum, center) => sum + center.y, 0) / centers.length;
      const rects = plateRects(plate).map((rect) => ({
        x: this.gridLeft + rect.col * CELL_WIDTH + PLATE.inset - x,
        y: this.gridTop + rect.row * this.cellHeight + PLATE.inset - y,
        width: rect.cols * CELL_WIDTH - PLATE.inset * 2,
        height: rect.rows * this.cellHeight - PLATE.inset * 2,
      }));
      const holes = stage.screws
        .filter((screw) => screw.plate === index)
        .map((screw) => {
          const center = this.cellCenter(screw.cell);
          return { x: center.x - x, y: center.y - y };
        });
      // 판은 둥근 네모 여럿으로 이루어져 있어서, 한 장으로 구워 두고 그 그림을 놓는다.
      const left = Math.min(...rects.map((rect) => rect.x));
      const top = Math.min(...rects.map((rect) => rect.y));
      const box = {
        width: Math.max(...rects.map((rect) => rect.x + rect.width)) - left,
        height: Math.max(...rects.map((rect) => rect.y + rect.height)) - top,
        originX: -left,
        originY: -top,
      };
      const texture = bakeShape(this, `${PLATE_TEXTURE}${this.deals}-${index}`, box, (graphics) =>
        drawPlate(graphics, rects, holes, LOOK.plates[index % LOOK.plates.length]),
      );
      const body = this.add.image(left, top, texture).setOrigin(0, 0);

      const view = this.add.container(x, y, [body]).setScale(0.7).setAlpha(0);
      this.boardLayer.add(view);
      this.tweens.add({
        targets: view,
        scale: 1,
        alpha: 1,
        duration: DEAL_MS,
        delay: index * DEAL_STAGGER_MS,
        ease: 'Back.Out',
      });
      return view;
    });

    this.tokens = stage.screws.map((screw) => {
      const view = this.plateViews[screw.plate]!;
      const center = this.cellCenter(screw.cell);
      const head = this.add.image(center.x - view.x, center.y - view.y, screwTexture(this, screw.color));
      view.add(head);
      return { head, readyAt: 0, flight: null };
    });
  }

  /** 단계를 깼을 때: 보너스를 주고 잠깐 뒤에 다음 단계를 깐다. */
  private celebrateClear(): number {
    if (this.stageLevel !== null) {
      // 단계 모드는 여기서 끝난다. 다음 단계는 결과 화면에서 고른다.
      sfx.gold();
      vibrate([15, 30, 15]);
      const { centerX, centerY } = this.benchArea;
      showBanner(this, centerY, '클리어!', LOOK.text.clear, 900, DEPTH.banner);
      this.sparks.explode(16, centerX, centerY);
      this.finishStage(true, this.stageStats(), 1100);
      return 1100;
    }
    const bonus = stageBonus(this.stageNumber);
    this.stagesCleared += 1;
    this.score += bonus;
    this.hud.setScore(this.score);
    sfx.gold();
    vibrate([15, 30, 15]);
    const { centerX, centerY } = this.benchArea;
    showBanner(this, centerY, '클리어!', LOOK.text.clear, NEXT_STAGE_MS - 200, DEPTH.banner);
    floatText(this, centerX, centerY + 44, `+${bonus}`, LOOK.text.points, this.playArea, DEPTH.banner);
    this.sparks.explode(16, centerX, centerY);
    this.time.delayedCall(NEXT_STAGE_MS, () => this.nextStage());
    return NEXT_STAGE_MS;
  }

  private nextStage(): void {
    this.stageNumber += 1;
    this.boardLayer.removeAll(true);
    // 쉬는 틈에 골라 둔 후보가 있으면 그것을 쓴다. 너무 빨리 깨서 없으면 그 자리에서 만든다.
    const stage = this.prepared?.stage ?? buildStage(this.stageNumber, Math.random);
    this.prepared = null;
    this.toPropose = 0;
    this.dealStage(stage);
  }

  /** 더 둘 수가 없을 때: 쟁반이 가득 찼다고 알리고 끝낸다. */
  private endRun(): number {
    sfx.miss();
    vibrate([40, 30, 80]);
    this.cameras.main.shake(180, 0.01);
    showBanner(this, this.benchArea.centerY, '꽉 찼어요!', LOOK.text.over, 900, DEPTH.banner);
    if (this.stageLevel !== null) {
      this.finishStage(false, this.stageStats());
      return 0;
    }
    this.finishMiniGame(this.score, [
      ['푼 나사', `${this.screwsOut}개`],
      ['채운 상자', `${this.boxesClosed}개`],
      ['깬 단계', `${this.stagesCleared}단계`],
    ]);
    return 0;
  }

  /** 단계 모드의 결과 화면에 적는 것 */
  private stageStats(): ResultStat[] {
    return [
      ['푼 나사', `${this.screwsOut}개`],
      ['채운 상자', `${this.boxesClosed}개`],
    ];
  }

  // ───────── 입력 ─────────

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    // 위쪽 HUD(일시정지 버튼)를 누른 것은 게임 입력이 아니다.
    if (!this.accepting || pointer.worldY < HUD_HEIGHT) return;
    const cell = this.cellUnder(pointer.worldX, pointer.worldY);
    if (cell < 0) return;

    const screw = screwAt(this.bench, cell);
    if (screw < 0) {
      this.nudgePlate(topPlateAt(this.bench, cell));
      return;
    }
    const before = this.bench;
    const { bench, outcome } = takeScrew(before, screw);
    if (outcome.kind === 'refused') {
      this.refuse();
      return;
    }
    this.bench = bench;
    this.lastTapAt = this.time.now;
    this.showTake(before, screw, outcome);
  }

  /** 나사가 없는 판을 눌렀을 때: 판이 살짝 흔들릴 뿐 아무 일도 없다. */
  private nudgePlate(plate: number): void {
    const view = this.plateViews[plate];
    if (!view || this.tweens.isTweening(view)) return;
    sfx.land();
    this.tweens.add({ targets: view, x: view.x + 1.5, duration: 45, yoyo: true, repeat: 1 });
  }

  /** 쟁반이 가득 차서 풀 수 없는 나사를 눌렀을 때 */
  private refuse(): void {
    sfx.deny();
    vibrate(20);
    this.showNotice('상자 색만 풀 수 있어요', REFUSE_NOTICE_MS);
    if (this.tweens.isTweening(this.trayPanel)) return;
    this.tweens.add({ targets: this.trayPanel, x: 3, duration: 40, yoyo: true, repeat: 2 });
  }

  // ───────── 나사를 풀었을 때 ─────────

  /**
   * 푼 결과를 화면에 옮긴다. 작업대(나사가 빠지고 판이 떨어지는 것)는 바로 보여 주고,
   * 상자와 쟁반에서 일어나는 일은 순서가 뒤섞이지 않게 줄을 세워 차례로 보여 준다.
   */
  private showTake(before: Bench, screw: number, outcome: Extract<TakeOutcome, { kind: 'taken' }>): void {
    const { stage } = before;
    this.screwsOut += 1;
    this.boxesClosed += outcome.closed;
    this.score += outcome.points;
    this.hud.setScore(this.score);
    this.popScrew(screw);
    sfx.pull();
    vibrate(8);

    let upcoming = before.nextBox;
    for (const event of outcome.events) {
      switch (event.kind) {
        case 'plate':
          this.dropPlate(event.plate);
          break;
        case 'box':
          this.steps.push(() => this.sendToBox(event.screw, event.slot, event.place, false));
          break;
        case 'tray':
          this.steps.push(() => this.sendToTray(event.screw));
          break;
        case 'close':
          this.steps.push(() => this.closeBox(event.slot));
          break;
        case 'open': {
          upcoming += 1;
          const following = stage.boxes[upcoming] ?? null;
          this.steps.push(() => this.openBox(event.slot, event.color, following));
          break;
        }
        case 'fromTray':
          this.steps.push(() => this.sendToBox(event.screw, event.slot, event.place, true));
          break;
      }
    }
    if (this.bench.status !== 'playing') {
      this.accepting = false;
      // 마지막 나사가 제자리에 닿은 뒤에 결과를 보여 준다.
      this.steps.push(() => POP_MS + FLY_MS);
      this.steps.push(this.bench.status === 'cleared' ? () => this.celebrateClear() : () => this.endRun());
    }
    this.markTakeable();
    this.runSteps();
  }

  /** 줄 세워 둔 일을 차례로 한다. 기다려야 하는 일을 만나면 그만큼 쉬었다가 이어서 한다. */
  private runSteps(): void {
    if (this.stepping) return;
    while (this.steps.length > 0) {
      const wait = this.steps.shift()!();
      if (wait <= 0) continue;
      this.stepping = true;
      this.time.delayedCall(wait, () => {
        this.stepping = false;
        this.runSteps();
      });
      return;
    }
  }

  /** 나사가 판에서 톡 튀어나온다. 이때부터 판의 것이 아니라 혼자 움직인다. */
  private popScrew(screw: number): void {
    const token = this.tokens[screw];
    const { head } = token;
    const view = this.plateViews[this.bench.stage.screws[screw].plate];
    const { x, y } = this.cellCenter(this.bench.stage.screws[screw].cell);
    view?.remove(head);
    head.setPosition(x, y).setDepth(DEPTH.token).addToDisplayList();
    this.tweens.add({
      targets: head,
      scale: 1.35,
      angle: -180,
      y: y - 5,
      duration: POP_MS,
      ease: 'Quad.Out',
    });
    token.readyAt = this.time.now + POP_MS;
  }

  /** 마지막 나사가 풀린 판이 기울며 아래로 떨어진다. */
  private dropPlate(plate: number): void {
    const view = this.plateViews[plate];
    if (!view) return;
    this.plateViews[plate] = null;
    this.boardLayer.remove(view);
    view.setDepth(DEPTH.falling).addToDisplayList();
    const side = view.x < GAME_WIDTH / 2 ? -1 : 1;
    this.tweens.killTweensOf(view);
    this.tweens.add({
      targets: view,
      y: this.scale.height + 90,
      x: view.x + side * 16,
      angle: side * 28,
      duration: FALL_MS,
      delay: POP_MS,
      ease: 'Quad.In',
      onStart: () => sfx.whoosh(),
      onComplete: () => view.destroy(),
    });
  }

  /**
   * 나사를 (x, y)로 보낸다. 걸리는 시간(ms)을 돌려준다.
   * 막 튀어나온 나사는 그 움직임이 끝난 뒤에 날아간다. 가던 길이 있으면 그만두고 새 자리로 간다.
   */
  private moveToken(
    token: Token,
    x: number,
    y: number,
    duration: number,
    onArrive?: () => void,
  ): number {
    const { head } = token;
    const delay = Math.max(0, token.readyAt - this.time.now);
    token.flight?.stop();
    token.flight = this.tweens.add({
      targets: head,
      x,
      y,
      scale: 1,
      // 풀려나오며 반 바퀴 돌았던 나사는 날아가며 나머지 반 바퀴를 마저 돈다.
      angle: head.angle === 0 && delay === 0 ? 0 : -360,
      duration,
      delay,
      ease: 'Sine.InOut',
      onComplete: () => {
        head.setAngle(0);
        token.flight = null;
        onArrive?.();
      },
    });
    return delay + duration;
  }

  /** 나사가 상자의 제자리로 간다. fromTray면 쟁반에서 건너가는 것이라 남은 나사들이 왼쪽으로 당겨 앉는다. */
  private sendToBox(screw: number, slot: number, place: number, fromTray: boolean): number {
    const token = this.tokens[screw];
    const box = this.boxViews[slot];
    const { x, y } = this.wellPosition(slot, place);
    const takes = this.moveToken(token, x, y, fromTray ? HOP_MS : FLY_MS, () => {
      sfx.hit(place + 1);
      // 닿은 뒤에는 상자에 담겨서, 상자가 닫힐 때 같이 움직인다.
      if (!box) return;
      token.head.setPosition(x - box.x, y - box.y);
      box.add(token.head);
    });
    this.slotBusyUntil[slot] = Math.max(this.slotBusyUntil[slot], this.time.now + takes);
    if (!fromTray) return 0;

    this.trayTokens.splice(this.trayTokens.indexOf(screw), 1);
    this.trayTokens.forEach((id, index) => {
      const home = this.trayPosition(index);
      this.moveToken(this.tokens[id], home.x, home.y, HOP_MS);
    });
    this.drawTray();
    return HOP_STAGGER_MS;
  }

  private sendToTray(screw: number): number {
    const { x, y } = this.trayPosition(this.trayTokens.length);
    this.trayTokens.push(screw);
    this.moveToken(this.tokens[screw], x, y, FLY_MS, () => sfx.land());
    this.drawTray();
    if (this.trayTokens.length === TRAY_SIZE - 1) sfx.tick();
    // 쟁반을 처음 쓸 때 한 번, 쟁반이 무엇인지 알려 준다.
    if (!this.trayHintShown) {
      this.trayHintShown = true;
      this.showNotice('쟁반이 꽉 차면 끝나요', TRAY_NOTICE_MS);
    }
    return 0;
  }

  /** 가득 찬 상자가 닫힌다. 날아오는 나사가 모두 닿기를 기다렸다가, 톡 커졌다가 위로 사라진다. */
  private closeBox(slot: number): number {
    const container = this.boxViews[slot];
    if (!container) return 0;
    this.boxViews[slot] = null;
    const wait = Math.max(0, this.slotBusyUntil[slot] - this.time.now);
    this.tweens.add({
      targets: container,
      scale: 1.14,
      duration: CLOSE_MS * 0.4,
      delay: wait,
      ease: 'Quad.Out',
      onStart: () => {
        sfx.coin();
        vibrate([12, 20, 12]);
        const { x, y } = container;
        this.sparks.explode(10, x, y);
        this.floatPoints(x, y - 4, BOX_POINTS, LOOK.text.points, this.playArea, DEPTH.effect);
      },
      onComplete: () => {
        this.tweens.add({
          targets: container,
          y: container.y - 14,
          scale: 0.8,
          alpha: 0,
          duration: CLOSE_MS * 0.6,
          ease: 'Quad.In',
          onComplete: () => container.destroy(),
        });
      },
    });
    return wait + CLOSE_MS;
  }

  private openBox(slot: number, color: number, following: number | null): number {
    this.enterBox(slot, color, 0);
    this.showNext(following);
    return SLIDE_MS;
  }

  /** 새 상자가 미리 보기 자리에서 제자리로 미끄러져 들어온다. */
  private enterBox(slot: number, color: number, delay: number): void {
    const body = this.add.image(-BOX.width / 2, -BOX.height / 2, boxTexture(this, color)).setOrigin(0, 0);
    const container = this.add
      .container(this.nextX, this.boxY, [body])
      .setDepth(DEPTH.box)
      .setScale(0.6)
      .setAlpha(0);
    this.tweens.add({
      targets: container,
      x: this.slotX(slot),
      scale: 1,
      alpha: 1,
      duration: SLIDE_MS,
      delay,
      ease: 'Back.Out',
    });
    this.boxViews[slot] = container;
    this.slotBusyUntil[slot] = this.time.now + delay + SLIDE_MS;
  }

  /**
   * 쟁반이 가득 찼는데도 아직 풀 수 있는 나사(상자로 바로 가는 나사)에 테두리를 둘러 알려 준다.
   * 쟁반에 자리가 있으면 아무 표시도 하지 않는다.
   */
  private markTakeable(): void {
    for (const ring of this.alerts) ring.destroy();
    this.alerts = [];
    if (this.bench.status !== 'playing' || this.bench.tray.length < TRAY_SIZE) return;
    for (const screw of freeScrews(this.bench)) {
      if (!canTake(this.bench, screw)) continue;
      const { x, y } = this.cellCenter(this.bench.stage.screws[screw].cell);
      const ring = this.add.graphics().setPosition(x, y).setDepth(DEPTH.effect);
      ring.lineStyle(2, LOOK.alert, 1);
      ring.strokeCircle(0, 0, SCREW_RADIUS + 3);
      this.tweens.add({ targets: ring, scale: 1.25, alpha: 0.3, duration: 420, yoyo: true, repeat: -1 });
      this.alerts.push(ring);
    }
  }
}
