import Phaser from 'phaser';
import { TEXTURE } from '../../art/sprites';
import { GAME_WIDTH, SCENE, THEME, THEME_CSS } from '../../config';
import { vibrate } from '../../core/haptics';
import { sfx } from '../../core/sfx';
import { store } from '../../core/store';
import { addBackdrop, addText, drawPanel } from '../../core/ui';
import { floatText, GameHud, HUD_HEIGHT, showBanner } from '../../scenes/GameHud';
import { MiniGameScene, type ResultStat } from '../../scenes/MiniGameScene';
import {
  canPour,
  clearBonus,
  dealStage,
  dealLevel,
  levelPourBudget,
  levelStage,
  isComplete,
  isSolved,
  isStuck,
  LEFTOVER_POINTS,
  pour,
  pourBudget,
  topRun,
  TUBE_CAPACITY,
  TUBE_POINTS,
  type PourResult,
  type Stage,
  type Tubes,
} from './rules';

interface LiquidColors {
  face: number;
  light: number;
  dark: number;
}

interface TubeView {
  /** 병을 이루는 그림들을 담는 그릇. 원점은 병 입구의 가운데다. */
  container: Phaser.GameObjects.Container;
  liquid: Phaser.GameObjects.Graphics;
  cork: Phaser.GameObjects.Graphics;
  /** 제자리(들어 올리지 않았을 때)의 좌표 */
  x: number;
  y: number;
}

/** 물 한 칸의 높이 */
const UNIT_HEIGHT = 14;
/** 병 안쪽의 폭 */
const INNER_WIDTH = 22;
/** 유리의 두께 */
const WALL = 2;
/** 병 입구에서 맨 위 칸까지 비어 있는 높이 */
const NECK = 8;
const TUBE_HEIGHT = NECK + TUBE_CAPACITY * UNIT_HEIGHT + WALL;
/** 병 바닥 안쪽의 둥근 정도 */
const BOTTOM_RADIUS = 10;
/** 고른 병이 떠오르는 높이 */
const LIFT = 10;
/** 옆 병과의 간격(가운데에서 가운데까지). 손가락으로 누르기 좋게 넉넉히 둔다. */
const COLUMN = 40;
/** 윗줄 병의 바닥에서 아랫줄 병의 입구까지 */
const ROW_GAP = 36;
/** 한 줄에 놓는 병의 수. 이보다 많으면 두 줄로 나눈다. */
const MAX_PER_ROW = 5;
/** 판의 좌우 여백과 아래 여백 */
const PANEL_MARGIN = 10;
/** 판 위쪽에 단계와 도움말을 적는 자리의 높이 */
const HEADER_HEIGHT = 58;

/** 물이 건너가는 움직임: 올라가기, 옆으로 가기(거리에 따라 늘어남), 내려가기(ms) */
const HOP_UP_MS = 70;
const HOP_ACROSS_MS = 60;
const HOP_ACROSS_PER_PX = 0.4;
const HOP_DOWN_MS = 70;
/** 단계를 깬 뒤 다음 단계가 나오기까지(ms) */
const NEXT_STAGE_MS = 1100;
/** 병이 하나씩 나타나는 간격(ms) */
const DEAL_STAGGER_MS = 35;

/**
 * 이 게임의 색을 한곳에 모아 둔다. 겉모습을 바꿀 때는 여기와 draw로 시작하는 함수들만 고치면 된다.
 */
const LOOK = {
  /** 병이 놓이는 판 */
  panel: { fill: THEME.card, shadow: THEME.shadow },
  /** 병이 서 있는 선반 */
  shelf: { top: THEME.butter, side: THEME.butterDeep },
  /** 유리는 어떤 색의 물과도 섞여 보이지 않게 색을 뺀 회보라로 둔다. */
  glass: { edge: THEME.faint, inside: THEME.dim, shine: THEME.white },
  cork: { face: THEME.butterDeep, dark: THEME.accent },
  /**
   * 색 번호 순서의 물 색. 단계가 오를수록 뒤쪽 색까지 쓴다.
   * 나란히 놓였을 때 헷갈리지 않게, 밝기와 색조가 서로 멀리 떨어진 것만 골랐다.
   */
  liquids: [
    { face: THEME.pink, light: THEME.pinkSoft, dark: THEME.pinkDeep },
    { face: THEME.gold, light: THEME.butterSoft, dark: THEME.accent },
    { face: THEME.sky, light: THEME.skySoft, dark: THEME.skyDeep },
    { face: THEME.mint, light: THEME.mintSoft, dark: THEME.good },
    { face: THEME.lilacDeep, light: THEME.lilac, dark: THEME.inkDeep },
    { face: THEME.coralDeep, light: THEME.coral, dark: THEME.bad },
    { face: THEME.sub, light: THEME.faint, dark: THEME.inkDeep },
  ] as readonly LiquidColors[],
  /** 색 구분 도우미를 켰을 때의 무늬: 흰 테두리를 두른 짙은 무늬라 어떤 색의 물 위에서도 또렷하다. */
  assist: { mark: THEME.inkDeep, halo: THEME.white },
  sparks: [THEME.gold, THEME.pink, THEME.mintDeep],
  text: {
    stage: THEME_CSS.ink,
    hint: THEME_CSS.sub,
    start: THEME_CSS.good,
    clear: THEME_CSS.good,
    over: THEME_CSS.bad,
    points: THEME_CSS.accent,
  },
} as const;

/**
 * 색마다 다른 작은 무늬. 색을 구별하기 어려운 사람도 무늬로 알아볼 수 있다.
 * 평소에는 물보다 조금 짙은 색으로 은은하게 그리고, 설정의 색 구분 도우미를 켜면 흰 테두리를 두른 짙은 색으로 그린다.
 * 칸의 가운데를 (0, 0)으로 본 [x, y, 폭, 높이] 목록이다.
 */
const MARKS: ReadonlyArray<ReadonlyArray<readonly [number, number, number, number]>> = [
  [[-1.5, -1.5, 3, 3]],
  [[-4, -1, 8, 2]],
  [[-1, -4, 2, 8]],
  [
    [-4, -1, 8, 2],
    [-1, -4, 2, 8],
  ],
  [
    [-4, -1.5, 3, 3],
    [1, -1.5, 3, 3],
  ],
  [
    [-4, -3, 8, 2],
    [-4, 1, 8, 2],
  ],
  [
    [-4, 1, 3, 3],
    [-1.5, -1.5, 3, 3],
    [1, -4, 3, 3],
  ],
];

const DEPTH = { panel: 1, tube: 10, flying: 15, effect: 20, hud: 30, banner: 40 } as const;

/** 병 안에서 아래에서 count번째 칸까지 찼을 때, 물의 윗면 높이(병 입구가 0) */
function surfaceOf(count: number): number {
  return NECK + (TUBE_CAPACITY - count) * UNIT_HEIGHT;
}

/** 도우미를 켰을 때 무늬에 두르는 흰 테두리의 두께 */
const HALO = 1.5;

/**
 * 물 한 칸을 (left, top)에서부터 그린다.
 * lit이면 윗줄을 밝게 해서 물의 윗면처럼 보이게 하고, atBottom이면 병 바닥에 맞춰 아래를 둥글린다.
 * assist면 무늬를 또렷하게 그린다(색 구분 도우미).
 */
function drawUnit(
  graphics: Phaser.GameObjects.Graphics,
  left: number,
  top: number,
  color: number,
  lit: boolean,
  atBottom: boolean,
  assist: boolean,
): void {
  const colors = LOOK.liquids[color % LOOK.liquids.length];
  graphics.fillStyle(colors.face, 1);
  if (atBottom) {
    graphics.fillRoundedRect(left, top, INNER_WIDTH, UNIT_HEIGHT, {
      tl: 0,
      tr: 0,
      bl: BOTTOM_RADIUS,
      br: BOTTOM_RADIUS,
    });
  } else {
    graphics.fillRect(left, top, INNER_WIDTH, UNIT_HEIGHT);
  }
  if (lit) {
    graphics.fillStyle(colors.light, 1);
    graphics.fillRect(left, top, INNER_WIDTH, 2);
  }
  const marks = MARKS[color % MARKS.length];
  const centerX = left + INNER_WIDTH / 2;
  const centerY = top + UNIT_HEIGHT / 2 + 1;
  if (assist) {
    graphics.fillStyle(LOOK.assist.halo, 1);
    for (const [x, y, width, height] of marks) {
      graphics.fillRoundedRect(
        centerX + x - HALO,
        centerY + y - HALO,
        width + HALO * 2,
        height + HALO * 2,
        1 + HALO,
      );
    }
  }
  graphics.fillStyle(assist ? LOOK.assist.mark : colors.dark, 1);
  for (const [x, y, width, height] of marks) {
    graphics.fillRoundedRect(centerX + x, centerY + y, width, height, 1);
  }
}

/** 병에 든 물을 그린다. 같은 색이 이어진 덩어리마다 맨 위 칸만 윗면을 밝게 한다. */
function drawLiquid(graphics: Phaser.GameObjects.Graphics, tube: readonly number[], assist: boolean): void {
  graphics.clear();
  tube.forEach((color, index) => {
    const lit = index === tube.length - 1 || tube[index + 1] !== color;
    drawUnit(graphics, -INNER_WIDTH / 2, surfaceOf(index + 1), color, lit, index === 0, assist);
  });
}

/** 빈 유리병을 그린다. 원점은 입구의 가운데다. */
function drawGlass(graphics: Phaser.GameObjects.Graphics): void {
  const half = INNER_WIDTH / 2;
  const outer = half + WALL;
  graphics.fillStyle(LOOK.glass.edge, 1);
  graphics.fillRoundedRect(-outer, 0, outer * 2, TUBE_HEIGHT, {
    tl: 2,
    tr: 2,
    bl: BOTTOM_RADIUS + WALL,
    br: BOTTOM_RADIUS + WALL,
  });
  // 입구의 턱
  graphics.fillRoundedRect(-outer - 2, -2, outer * 2 + 4, 4, 2);
  graphics.fillStyle(LOOK.glass.inside, 1);
  graphics.fillRoundedRect(-half, -2, INNER_WIDTH, TUBE_HEIGHT - WALL + 2, {
    tl: 0,
    tr: 0,
    bl: BOTTOM_RADIUS,
    br: BOTTOM_RADIUS,
  });
}

/** 물 위에 겹쳐 그리는 유리의 반짝임 */
function drawShine(graphics: Phaser.GameObjects.Graphics): void {
  graphics.fillStyle(LOOK.glass.shine, 0.55);
  graphics.fillRoundedRect(-INNER_WIDTH / 2 + 3, NECK + 2, 2, TUBE_HEIGHT - NECK - 18, 1);
}

/** 다 된 병을 막는 마개 */
function drawCork(graphics: Phaser.GameObjects.Graphics): void {
  const half = INNER_WIDTH / 2;
  graphics.fillStyle(LOOK.cork.dark, 1);
  graphics.fillRoundedRect(-half + 1, -6, INNER_WIDTH - 2, 10, 3);
  graphics.fillStyle(LOOK.cork.face, 1);
  graphics.fillRoundedRect(-half + 1, -6, INNER_WIDTH - 2, 8, 3);
}

/**
 * 단계 모드에서 가장 최근에 만든 판. 단계 모드의 판은 단계 번호로 정해져서 다시 만들어도 똑같은 판이 나오는데,
 * 만드는 데 시간이 걸린다(판 여럿을 만들어 저마다 아무렇게나 여러 번 부어 보느라, 느린 기기에서는 반 초쯤 화면이 멈춘다).
 * 그래서 같은 단계를 다시 할 때는 만들어 둔 것을 그대로 쓴다. 판은 바뀌지 않는 값이라(부을 때마다 새 병들을 만든다) 다시 써도 된다.
 */
let lastLevelDeal: { level: number; stage: Stage } | null = null;

/**
 * 색깔 물 나누기: 병을 누르고 다른 병을 누르면 맨 위의 물이 건너간다.
 * 같은 색끼리 한 병에 모으면 단계를 깨고, 단계마다 부을 수 있는 횟수가 정해져 있다.
 * 횟수가 다 떨어지거나 더 부을 곳이 없으면 끝난다.
 */
export class ColorSortScene extends MiniGameScene {
  protected readonly gameId = 'color-sort';

  private tubes: Tubes = [];
  private views: TubeView[] = [];
  /** 지금 단계. 찾아 둔 풀이도 들어 있어서 자동 검증이 그대로 따라 풀 수 있다. */
  stageData: Stage | null = null;
  private stage = 0;
  private budget = 0;
  private poursLeft = 0;
  /** 들어 올린 병의 번호. 없으면 -1 */
  private selected = -1;
  /** 물이 건너가는 중에는 누를 수 없다. */
  private busy = false;
  private score = 0;
  private poursMade = 0;
  private tubesFilled = 0;
  private stagesCleared = 0;
  /** 이번 단계에서 채운 병의 수. 채울수록 소리가 높아진다. */
  private filledThisStage = 0;
  /** 색 구분 도우미가 켜져 있는지. 판을 시작할 때 설정에서 읽는다. */
  private assist = false;

  private hud!: GameHud;
  private stageLabel!: Phaser.GameObjects.Text;
  private hints: Phaser.GameObjects.Text[] = [];
  private shelves!: Phaser.GameObjects.Graphics;
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** 병을 놓을 수 있는 영역 */
  private area!: Phaser.Geom.Rectangle;

  constructor() {
    super(SCENE.colorSort);
  }

  create(): void {
    this.beginMiniGame();
    this.resetState();
    this.assist = store.data.settings.colorAssist;

    const { height } = this.scale;
    const panelTop = HUD_HEIGHT + 4;
    const panelHeight = height - panelTop - PANEL_MARGIN - 3;
    this.area = new Phaser.Geom.Rectangle(
      PANEL_MARGIN,
      panelTop + HEADER_HEIGHT,
      GAME_WIDTH - PANEL_MARGIN * 2,
      panelHeight - HEADER_HEIGHT - 6,
    );

    addBackdrop(this);
    const panel = this.add.graphics().setDepth(DEPTH.panel);
    drawPanel(panel, PANEL_MARGIN, panelTop, GAME_WIDTH - PANEL_MARGIN * 2, panelHeight, LOOK.panel);
    this.shelves = this.add.graphics().setDepth(DEPTH.panel);

    this.stageLabel = addText(this, GAME_WIDTH / 2, panelTop + 8, '', {
      color: LOOK.text.stage,
      originX: 0.5,
    }).setDepth(DEPTH.panel);
    // 단계 모드에서는 가장 쉬운 난이도의 단계에서만 방법을 알려 준다.
    const lines =
      this.stageLevel === null || levelStage(this.stageLevel) === 0
        ? ['병을 누르고, 부을 병을 눌러요', '같은 색끼리 한 병에 모아요']
        : [];
    this.hints = lines.map((line, index) =>
      addText(this, GAME_WIDTH / 2, panelTop + 26 + index * 15, line, {
        color: LOOK.text.hint,
        originX: 0.5,
      }).setDepth(DEPTH.panel),
    );

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

    this.dealNext(true);
  }

  private resetState(): void {
    this.tubes = [];
    this.views = [];
    this.stageData = null;
    this.stage = 0;
    this.budget = 0;
    this.poursLeft = 0;
    this.selected = -1;
    this.busy = false;
    this.score = 0;
    this.poursMade = 0;
    this.tubesFilled = 0;
    this.stagesCleared = 0;
    this.filledThisStage = 0;
    this.hints = [];
  }

  // ───────── 단계 ─────────

  /** 지금 단계의 병을 새로 깔고, 다 나타나면 누를 수 있게 한다. */
  private dealNext(first: boolean): void {
    // 단계 모드에서는 단계 번호로 정해진 판 하나만 나오고, 부을 수 있는 횟수는 단계가 오를수록 빠듯해진다.
    const level = this.stageLevel;
    const dealt = level === null ? dealStage(this.stage, Math.random) : this.levelDeal(level);
    this.stageData = dealt;
    this.tubes = dealt.tubes;
    this.budget = level === null ? pourBudget(dealt.par, this.stage) : levelPourBudget(dealt.par, level);
    this.poursLeft = this.budget;
    this.selected = -1;
    this.busy = false;
    this.filledThisStage = 0;

    this.stageLabel.setText(level === null ? `${this.stage + 1}단계` : `붓기 ${this.budget}번 안에 모아요`);
    this.showBudget(false);
    this.buildViews();
    sfx.flip();

    const ready = this.views.length * DEAL_STAGGER_MS + 160;
    this.time.delayedCall(ready, () => {
      if (first) {
        showBanner(this, this.area.centerY, '시작!', LOOK.text.start, 520, DEPTH.banner);
        sfx.go();
      }
      this.playing = true;
    });
  }

  /** 단계 모드의 그 단계의 판. 방금 한 단계를 다시 하는 것이면 만들어 둔 판을 그대로 준다. */
  private levelDeal(level: number): Stage {
    if (lastLevelDeal?.level !== level) lastLevelDeal = { level, stage: dealLevel(level, this.levelRandom()) };
    return lastLevelDeal.stage;
  }

  /** 병들의 자리를 정해서 그린다. 병이 많으면 두 줄로 나눈다. */
  private buildViews(): void {
    const count = this.tubes.length;
    const rows = count > MAX_PER_ROW ? 2 : 1;
    const firstRow = Math.ceil(count / rows);
    const contentHeight = rows * TUBE_HEIGHT + (rows - 1) * ROW_GAP;
    // 고른 병이 떠오를 자리를 위에 남기고, 남는 높이의 가운데에 놓는다.
    const top = Math.round(
      this.area.top + LIFT + Math.max(0, (this.area.height - LIFT - contentHeight) / 2),
    );

    this.shelves.clear();
    this.views = this.tubes.map((tube, index) => {
      const row = index < firstRow ? 0 : 1;
      const inRow = row === 0 ? firstRow : count - firstRow;
      const column = row === 0 ? index : index - firstRow;
      const x = Math.round(GAME_WIDTH / 2 + (column - (inRow - 1) / 2) * COLUMN);
      const y = top + row * (TUBE_HEIGHT + ROW_GAP);
      return this.createView(tube, x, y, index);
    });

    for (let row = 0; row < rows; row += 1) {
      const inRow = row === 0 ? firstRow : count - firstRow;
      const width = inRow * COLUMN;
      const left = Math.round(GAME_WIDTH / 2 - width / 2);
      const y = top + row * (TUBE_HEIGHT + ROW_GAP) + TUBE_HEIGHT;
      this.shelves.fillStyle(LOOK.shelf.side, 1);
      this.shelves.fillRoundedRect(left, y + 1, width, 6, 3);
      this.shelves.fillStyle(LOOK.shelf.top, 1);
      this.shelves.fillRoundedRect(left, y + 1, width, 4, 2);
    }
  }

  private createView(tube: readonly number[], x: number, y: number, index: number): TubeView {
    const glass = this.add.graphics();
    drawGlass(glass);
    const liquid = this.add.graphics();
    drawLiquid(liquid, tube, this.assist);
    const shine = this.add.graphics();
    drawShine(shine);
    const cork = this.add.graphics().setVisible(false);
    drawCork(cork);

    const container = this.add
      .container(x, y, [glass, liquid, shine, cork])
      .setDepth(DEPTH.tube)
      .setScale(0);
    // 한 병씩 차례로 나타난다.
    this.tweens.add({
      targets: container,
      scale: 1,
      duration: 140,
      delay: index * DEAL_STAGGER_MS,
      ease: 'Back.Out',
    });
    return { container, liquid, cork, x, y };
  }

  private showBudget(bounce: boolean): void {
    this.hud.setSide(`붓기 ${this.poursLeft}`, bounce);
    this.hud.setTime(this.poursLeft, this.budget);
  }

  // ───────── 입력 ─────────

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (!this.playing || this.busy) return;
    // 위쪽 HUD(일시정지 버튼)를 누른 것은 병을 고른 것이 아니다.
    if (pointer.worldY < HUD_HEIGHT) return;
    const index = this.tubeAt(pointer.worldX, pointer.worldY);
    if (index < 0) {
      this.deselect();
      return;
    }
    this.tapTube(index);
  }

  /** (x, y)에 있는 병의 번호. 병 사이의 틈을 눌러도 가까운 병으로 친다. 없으면 -1 */
  private tubeAt(x: number, y: number): number {
    return this.views.findIndex(
      (view) =>
        Math.abs(x - view.x) <= COLUMN / 2 &&
        y >= view.y - LIFT - 8 &&
        y <= view.y + TUBE_HEIGHT + 10,
    );
  }

  private tapTube(index: number): void {
    if (index === this.selected) {
      this.deselect();
      return;
    }
    if (this.selected >= 0 && canPour(this.tubes, this.selected, index)) {
      this.pourInto(this.selected, index);
      return;
    }
    // 부을 수 없는 병을 눌렀으면, 그 병에서 부으려는 것으로 보고 그 병을 대신 고른다.
    const tube = this.tubes[index];
    if (tube.length === 0 || isComplete(tube)) {
      this.refuse(index);
      return;
    }
    this.deselect(false);
    this.select(index);
  }

  private select(index: number): void {
    this.selected = index;
    const view = this.views[index];
    this.tweens.killTweensOf(view.container);
    view.container.setScale(1).setX(view.x);
    this.tweens.add({ targets: view.container, y: view.y - LIFT, duration: 80, ease: 'Quad.Out' });
    sfx.flip();
  }

  private deselect(withSound = true): void {
    if (this.selected < 0) return;
    this.settle(this.views[this.selected]);
    this.selected = -1;
    if (withSound) sfx.land();
  }

  /** 떠 있는 병을 제자리에 내려놓는다. */
  private settle(view: TubeView): void {
    this.tweens.killTweensOf(view.container);
    view.container.setScale(1).setX(view.x);
    this.tweens.add({ targets: view.container, y: view.y, duration: 80, ease: 'Quad.In' });
  }

  /** 고를 수 없는 병(빈 병, 다 된 병)을 눌렀을 때 좌우로 살짝 흔든다. */
  private refuse(index: number): void {
    const view = this.views[index];
    sfx.deny();
    this.tweens.killTweensOf(view.container);
    view.container.setScale(1).setPosition(view.x, view.y);
    this.tweens.add({
      targets: view.container,
      x: view.x + 2,
      duration: 40,
      yoyo: true,
      repeat: 2,
      onComplete: () => view.container.setX(view.x),
    });
  }

  // ───────── 붓기 ─────────

  /** from 병의 맨 위 물을 to 병으로 옮긴다. 규칙은 바로 반영하고, 화면에서는 물이 건너가는 것을 보여 준다. */
  private pourInto(from: number, to: number): void {
    const run = topRun(this.tubes[from]);
    const result = pour(this.tubes, from, to);
    if (!run || !result) return;

    const sourceCount = this.tubes[from].length;
    this.tubes = result.tubes;
    this.poursLeft -= 1;
    this.poursMade += 1;
    this.selected = -1;
    this.busy = true;
    this.showBudget(true);
    this.hideHints();
    sfx.pour();

    const source = this.views[from];
    const target = this.views[to];
    drawLiquid(source.liquid, this.tubes[from], this.assist);

    // 건너가는 물 덩어리. 떠 있는 병의 물 윗면에서 출발해 받는 병의 물 위에 내려앉는다.
    const height = result.moved * UNIT_HEIGHT;
    const flying = this.add.graphics().setDepth(DEPTH.flying);
    for (let unit = 0; unit < result.moved; unit += 1) {
      drawUnit(flying, 0, unit * UNIT_HEIGHT, result.color, unit === 0, false, this.assist);
    }
    const left = -INNER_WIDTH / 2;
    flying.setPosition(source.x + left, source.container.y + surfaceOf(sourceCount));
    const hopY = Math.min(source.container.y, target.y) - height - 6;
    const landY = target.y + surfaceOf(this.tubes[to].length);

    this.tweens.chain({
      targets: flying,
      tweens: [
        { y: hopY, duration: HOP_UP_MS, ease: 'Quad.Out' },
        {
          x: target.x + left,
          duration: HOP_ACROSS_MS + Math.abs(target.x - source.x) * HOP_ACROSS_PER_PX,
          ease: 'Sine.InOut',
        },
        { y: landY, duration: HOP_DOWN_MS, ease: 'Quad.In' },
      ],
      onComplete: () => {
        flying.destroy();
        drawLiquid(target.liquid, this.tubes[to], this.assist);
        this.settle(source);
        this.busy = false;
        this.afterPour(result, to);
      },
    });
  }

  /** 물이 내려앉은 뒤: 다 된 병을 축하하고, 단계를 깼는지 끝났는지 본다. */
  private afterPour(result: PourResult, to: number): void {
    if (result.completed) this.celebrateTube(to);
    else vibrate(8);

    if (isSolved(this.tubes)) {
      this.clearStage();
    } else if (this.poursLeft <= 0) {
      this.endRun('붓기 끝!');
    } else if (isStuck(this.tubes)) {
      this.endRun('막혔어요!');
    }
  }

  private celebrateTube(index: number): void {
    const view = this.views[index];
    this.tubesFilled += 1;
    this.filledThisStage += 1;
    this.score += TUBE_POINTS;
    this.hud.setScore(this.score);

    view.cork.setVisible(true);
    this.sparks.explode(10, view.x, view.y + 6);
    this.tweens.add({
      targets: view.container,
      scale: 1.1,
      duration: 90,
      yoyo: true,
      ease: 'Quad.Out',
    });
    this.floatPoints(view.x, view.y - 6, TUBE_POINTS, LOOK.text.points, this.area, DEPTH.effect);
    sfx.hit(this.filledThisStage * 2);
    vibrate(12);
  }

  private clearStage(): void {
    // 다음 단계가 깔릴 때까지 누를 수 없다.
    this.playing = false;
    const bonus = clearBonus(this.stage) + this.poursLeft * LEFTOVER_POINTS;
    this.score += bonus;
    this.stagesCleared += 1;
    this.hud.setScore(this.score);

    if (this.stageLevel !== null) {
      // 단계 모드는 한 단계가 한 판이다. 다음 단계는 결과 화면에서 고른다.
      this.time.delayedCall(260, () => {
        sfx.gold();
        vibrate([15, 30, 15]);
        showBanner(this, this.area.centerY, '클리어!', LOOK.text.clear, 900, DEPTH.banner);
      });
      this.finishStage(true, this.stageStats(), 1100);
      return;
    }

    this.time.delayedCall(260, () => {
      sfx.gold();
      vibrate([15, 30, 15]);
      showBanner(this, this.area.centerY, '클리어!', LOOK.text.clear, NEXT_STAGE_MS - 360, DEPTH.banner);
      floatText(
        this,
        GAME_WIDTH / 2,
        this.area.centerY + 42,
        `+${bonus}`,
        LOOK.text.points,
        this.area,
        DEPTH.banner,
      );
    });

    this.time.delayedCall(NEXT_STAGE_MS, () => {
      const cleared = this.views;
      this.views = [];
      for (const view of cleared) {
        this.tweens.killTweensOf(view.container);
        this.tweens.add({
          targets: view.container,
          scale: 0,
          duration: 140,
          ease: 'Quad.In',
          onComplete: () => view.container.destroy(),
        });
      }
      this.stage += 1;
      this.time.delayedCall(180, () => this.dealNext(false));
    });
  }

  private endRun(label: string): void {
    sfx.miss();
    vibrate([40, 30, 80]);
    showBanner(this, this.area.centerY, label, LOOK.text.over, 900, DEPTH.banner);
    if (this.stageLevel !== null) {
      this.finishStage(false, this.stageStats());
      return;
    }
    this.finishMiniGame(this.score, [
      ['깬 단계', `${this.stagesCleared}단계`],
      ['채운 병', `${this.tubesFilled}개`],
      ['부은 횟수', `${this.poursMade}번`],
    ]);
  }

  /** 단계 모드의 결과 화면에 적는 것 */
  private stageStats(): ResultStat[] {
    return [
      ['부은 횟수', `${this.poursMade}번`],
      ['남은 붓기', `${this.poursLeft}번`],
    ];
  }

  /** 한 번 부어 봤으면 도움말은 더 필요 없다. */
  private hideHints(): void {
    if (this.hints.length === 0) return;
    const lines = this.hints;
    this.hints = [];
    this.tweens.add({
      targets: lines,
      alpha: 0,
      duration: 400,
      onComplete: () => {
        for (const line of lines) line.destroy();
      },
    });
  }
}
