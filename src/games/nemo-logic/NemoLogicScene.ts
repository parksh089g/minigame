import Phaser from 'phaser';
import { TEXTURE } from '../../art/sprites';
import { FONT_SIZE, GAME_WIDTH, SCENE } from '../../config';
import { vibrate } from '../../core/haptics';
import { LENS_ROOM } from '../../core/lens';
import { PressLens } from '../../core/lens-view';
import { sfx } from '../../core/sfx';
import { clearedOf } from '../../core/stages';
import { StartGate } from '../../core/start-gate';
import { store } from '../../core/store';
import { addBackdrop, addTapZone, addText } from '../../core/ui';
import { floatText, GameHud, HUD_HEIGHT, showBanner } from '../../scenes/GameHud';
import { MiniGameScene, type ResultStat } from '../../scenes/MiniGameScene';
import {
  ART_CELL,
  drawBoard,
  drawClueStrips,
  drawFocus,
  drawHearts,
  drawStroke,
  drawToggle,
  HEARTS_SIZE,
  LOOK,
  markTexture,
  missTexture,
  padTexture,
  toggleCenter,
  TOOLS,
} from './art';
import { colorsOf } from './pictures';
import {
  boardArea,
  boardLayout,
  cellOf,
  cellsLeft,
  elapse,
  forgive,
  HEADER_HEIGHT,
  isColDone,
  isOver,
  isRowDone,
  levelRun,
  newRun,
  nextStage,
  paint,
  PRACTICE_STEPS,
  practiceCells,
  practiceRun,
  practiceStep,
  practiceTool,
  START_HEARTS,
  strokeCells,
  TIME_BANK_SECONDS,
  type BoardLayout,
  type ClearReward,
  type PaintOutcome,
  type PracticeStep,
  type RunState,
  type Tool,
} from './rules';

type Filled = Extract<PaintOutcome, { kind: 'filled' }>;

/** 손가락이 판 위에 눌려 있는 동안의 기록 */
interface Stroke {
  /** 처음 누른 칸 */
  from: number;
  pointerId: number;
  /** 이번에 쓰는 도구. 마우스의 오른쪽 단추로 누르면 고른 도구와 상관없이 X다. */
  tool: Tool;
  /** 지금 손을 떼면 도구가 지나갈 칸들. 손가락이 판 밖으로 나가 있으면 비어 있다(떼면 없던 일이 된다). */
  path: number[];
}

/** 씬을 열 때 넘겨받는 것 가운데 이 게임만 쓰는 것 */
interface PracticeStart {
  /** 연습 판을 막 마쳤거나 건너뛰고 다시 연 것인지 */
  practiced?: boolean;
}

/**
 * 앱을 연 뒤로 연습 판을 마쳤거나 건너뛴 적이 있는지. 한 판도 끝내지 못하고 다시 하는 사람에게
 * 연습을 또 시키지 않는다. 앱을 다시 열면 지워지지만, 그때도 한 판이라도 마쳤으면 연습은 나오지 않는다.
 */
let practicedThisSession = false;

/** 끌던 손가락이 판 밖으로 이만큼(칸 크기의 배수)까지 벗어나도 가장 가까운 칸을 누른 것으로 본다. */
const DRAG_SLOP = 0.6;

/** 화면 아래의 줄: 목숨, 판 번호, 칠하기·X 단추 */
const BAR = {
  /** 단추의 높이와 화면 아래 끝에서 띄우는 거리 */
  height: 34,
  bottom: 10,
  /** 화면 좌우 끝에서 띄우는 거리 */
  side: 10,
  /** 단추 반쪽의 폭. 엄지로 누르기 좋게 넉넉히 둔다. */
  segment: 64,
  /** 단추 반쪽의 가운데에서 아이콘과 글자까지의 거리. 글자 수가 달라서 도구마다 따로 둔다. */
  iconOffset: { fill: -20, mark: -14 },
  labelOffset: { fill: 7, mark: 7 },
  /** 보이는 단추보다 누르는 자리를 위아래로 넓히는 폭 */
  hitPadding: 5,
} as const;
/** 칠하기·X 단추의 왼쪽 끝 */
const TOGGLE_LEFT = GAME_WIDTH - BAR.side - BAR.segment * 2;

/** 칸 하나가 칠해지는 시간(ms)과, 한 번에 여러 칸을 칠할 때 한 칸마다 늦어지는 시간 */
const FILL_MS = 120;
const FILL_STEP_MS = 22;
/** 새 판이 나타나는 시간(ms). 이동안은 눌러도 칠해지지 않는다. */
const DEAL_MS = 180;
/** 다 칠한 그림에 색이 입혀질 때 한 칸 건너마다 늦어지는 시간(ms). 왼쪽 위에서 오른쪽 아래로 번진다. */
const REVEAL_STEP_MS = 32;
/** 색이 다 번진 뒤에 그림을 보여 주는 시간(ms). 단계 모드에서는 이 뒤에 결과 화면이 뜬다. */
const REVEAL_HOLD_MS = 1900;
/** 점수 도전에서 마지막 칸을 칠한 뒤 "클리어!"가 뜨기까지, 그리고 다음 판이 깔리기까지(ms). 그동안 시간은 멈춘다. */
const CLEAR_BANNER_MS = 420;
const NEXT_BOARD_MS = 1500;
/**
 * "클리어!" 아래에 적는 "+점수 +시간" 한 줄: 큰 글자에서 내려온 거리와, 글자 뒤에 까는 알약 모양 바탕.
 * 칠한 판 위에 뜨기 때문에 바탕이 없으면 무늬와 섞여 읽기 어렵다.
 */
const BONUS = { offsetY: 32, height: 18, padding: 9, alpha: 0.92 } as const;
/** 일시정지에서 돌아온 뒤 다시 시간이 흐르기까지의 여유(초). 가려져 있던 판을 다시 볼 틈을 준다. */
const RESUME_GRACE_SECONDS = 0.6;
/** 남은 시간이 이 아래로 내려가면 1초마다 소리로 알린다 */
const TICK_FROM_SECONDS = 5;
/** 연습 판을 다 칠한 뒤 본 게임이 열리기까지(ms). 그림에 색이 번지고 "잘했어요!"를 읽을 틈이다. */
const PRACTICE_DONE_MS = 2200;
/** 연습 판의 오른쪽 위에 두는 건너뛰기 단추: 글자와, 누르는 자리의 크기 */
const SKIP = { label: '건너뛰기', width: 76, height: 40 } as const;
/** 도움말 한 묶음이 떠 있는 시간(ms) */
const HINT_MS = 7000;

type HintLines = readonly [string, string];

/**
 * 판 위에 두 줄씩 띄우는 도움말. 첫 판에서는 start가 첫 칸을 칠할 때까지 떠 있고,
 * 그 뒤로 marks가 나왔다 사라진다. drag는 둘째 판에서 한 번 나온다.
 */
const HINTS = {
  start: ['숫자만큼 이어서 칸을 칠해요', '숫자가 여럿이면 사이를 띄워요'],
  marks: ['칠하지 않을 칸은 X로 표시해요', '아래의 X 단추를 켜고 눌러요'],
  drag: ['끌면 여러 칸을 한 번에 칠해요', '틀린 칸을 칠하면 하트를 잃어요'],
  /** 연습에서 칠할 칸에 X를 쳐 버렸을 때. X를 친 칸은 칠해지지 않으므로 지우는 법을 알려 준다. */
  unmark: ['X를 친 칸은 칠해지지 않아요', '표시를 켜고 X를 눌러 지워요'],
} as const satisfies Record<string, HintLines>;

const TOOL_LABELS: Record<Tool, string> = { fill: '칠하기', mark: '표시' };

/** 판과 아래 줄은 깊이를 따로 주지 않고 만든 순서대로 겹친다. */
const DEPTH = { focus: 19, effect: 20, hud: 30, lens: 35, banner: 40 } as const;
/** 칸이 이보다 작은 판에서는 누른 칸을 손가락 위에 크게 띄워 보여 준다. */
const LENS_BELOW_CELL = 33;
/**
 * 누른 칸을 띄워 보여 주는 말풍선이 올라가도 되는 위쪽 끝. 말풍선은 손가락을 누르고 있는 동안만 뜨므로
 * 위쪽 HUD(점수, 시간 막대)를 잠깐 덮어도 된다. HUD 아래에서 멈추게 하면 작은 화면의 큰 판에서
 * 맨 윗줄을 누를 때 말풍선이 옆으로 비켜 떠서, 옆 세로줄의 숫자와 끌어 갈 칸들을 가린다.
 */
const LENS_TOP = 2;
/** 그림의 이름이 이 글자 수를 넘으면 조금 작게 적는다(화면의 폭을 넘지 않게). */
const LONG_NAME = 5;

/**
 * 네모 로직: 줄마다 적힌 숫자를 실마리로 칸을 칠해서 숨은 그림을 완성한다.
 * 숫자는 그 줄에서 이어서 칠할 칸의 수다. 칠하기 도구로 누르거나 끌면 칸이 칠해지고, X 도구로는 칠하지 않을 칸을 표시해 둔다.
 * 칠하면 안 되는 칸을 칠하면 목숨이 줄고, 목숨이나 시간이 다하면 끝난다. 모든 판은 찍지 않고 풀 수 있다.
 * 점수 도전에서는 판을 깨면 시간을 돌려받고 더 큰 판이 나오고, 단계 모드에서는 단계마다 정해진 그림을 그린다.
 * 한 판도 마친 적이 없는 사람에게는 본 게임에 앞서 연습 판이 나온다: 한 줄씩 따라 칠하며 방법을 익힌다.
 */
export class NemoLogicScene extends MiniGameScene {
  protected readonly gameId = 'nemo-logic';

  private run!: RunState;
  private tool: Tool = 'fill';
  private layout!: BoardLayout;
  /** 칸마다의 칠한 그림. 칠하지 않은 칸은 null이다. */
  private pads: (Phaser.GameObjects.Image | null)[] = [];
  /** 칸마다의 X 그림(손으로 그은 것과 틀려서 드러난 것). 없는 칸은 null이다. */
  private marks: (Phaser.GameObjects.Image | null)[] = [];
  /** 줄마다의 숫자들. 다 칠한 줄은 흐리게 바꾼다. */
  private rowLabels: Phaser.GameObjects.Text[][] = [];
  private colLabels: Phaser.GameObjects.Text[][] = [];
  private stroke: Stroke | null = null;
  /** 손가락이 눌려 있는 단추 반쪽 */
  private pressedSide: Tool | null = null;
  /** 여기부터 보라고 들썩이고 있는 숫자들 */
  private pointed: Phaser.GameObjects.Text[] = [];
  /** 연습 판을 하고 있는지. 시간이 흐르지 않고 틀려도 목숨이 줄지 않으며, 다 칠하면 본 게임이 열린다. */
  private practice = false;
  /** 연습에서 지금 안내하고 있는 걸음. 아직 안내한 것이 없으면 -1 */
  private practiceAt = -1;
  /** 연습에서 지금 걸음의 칠할 칸에 X를 쳐 버려서, X를 지우는 법을 안내하고 있는지 */
  private practiceUnmark = false;
  /** 판 위에 떠 있는 도움말 줄들. 사라진 뒤에는 비어 있다. */
  private hints: Phaser.GameObjects.Text[] = [];
  /** 첫 판의 첫 도움말이 아직 떠 있는지. 첫 칸을 칠하면 다음 도움말로 넘어간다. */
  private startHintUp = false;
  /** 다 칠한 뒤에 판 위에 적는 그림의 이름 */
  private nameLabel: Phaser.GameObjects.Text | null = null;
  /** 0보다 크면 일시정지에서 막 돌아와 잠깐 멈춰 있는 중 */
  private grace = 0;
  /** 첫 칸을 누르거나 잠깐 기다릴 때까지 시간을 세워 둔다. 처음 하는 사람이 설명을 읽을 틈이다. */
  private readonly gate = new StartGate();
  private lastTickSecond = 0;
  /** 점수 도전의 판을 만드는 난수 */
  private random: () => number = Math.random;

  private hud!: GameHud;
  private playArea!: Phaser.Geom.Rectangle;
  /** 판 전체를 담는 그릇. 원점은 판(칸들)의 한가운데다. */
  private boardBox!: Phaser.GameObjects.Container;
  private boardCard!: Phaser.GameObjects.Graphics;
  private clueStrips!: Phaser.GameObjects.Graphics;
  /** 줄마다의 숫자를 담는 층과, 칠한 칸과 X를 담는 층. 일시정지 중에 통째로 가린다. */
  private clueLayer!: Phaser.GameObjects.Container;
  private tileLayer!: Phaser.GameObjects.Container;
  /** 손가락이 지나가는 칸에 두르는 테 */
  private strokeView!: Phaser.GameObjects.Graphics;
  /** 연습에서 지금 볼 곳에 두르는 깜빡이는 테 */
  private focusView!: Phaser.GameObjects.Graphics;
  private heartsView!: Phaser.GameObjects.Graphics;
  private stageLabel!: Phaser.GameObjects.Text;
  private toggleView!: Phaser.GameObjects.Graphics;
  private toggleLabels!: Record<Tool, Phaser.GameObjects.Text>;
  private sparks!: Record<keyof typeof LOOK.sparks, Phaser.GameObjects.Particles.ParticleEmitter>;
  private lens!: PressLens;

  constructor() {
    super(SCENE.nemoLogic);
  }

  create(): void {
    // 연습을 마치고 다시 연 것인지는 beginMiniGame이 넘겨받은 것을 지우기 전에 읽는다.
    const practiced = (this.scene.settings.data as PracticeStart | undefined)?.practiced === true;
    this.beginMiniGame();
    this.practice = !practiced && this.isNewcomer();
    this.resetState();

    this.playArea = new Phaser.Geom.Rectangle(0, HUD_HEIGHT, GAME_WIDTH, this.scale.height - HUD_HEIGHT);

    addBackdrop(this);
    this.boardCard = this.add.graphics();
    this.clueStrips = this.add.graphics();
    this.clueLayer = this.add.container(0, 0);
    this.tileLayer = this.add.container(0, 0);
    this.boardBox = this.add.container(0, 0, [this.boardCard, this.clueStrips, this.clueLayer, this.tileLayer]);
    this.strokeView = this.add.graphics().setDepth(DEPTH.effect);
    this.focusView = this.add.graphics().setDepth(DEPTH.focus);
    this.sparks = {
      fill: this.createSparks(LOOK.sparks.fill, 60),
      miss: this.createSparks(LOOK.sparks.miss, 90),
      clear: this.createSparks(LOOK.sparks.clear, 130),
    };
    this.createControls();
    this.lens = new PressLens(this, DEPTH.lens);

    this.addPauseButton();
    this.hud = new GameHud(this, DEPTH.hud);
    this.hud.setTime(TIME_BANK_SECONDS, TIME_BANK_SECONDS);
    if (this.practice) this.showPracticeHud();
    else if (this.stageLevel !== null) this.hud.showStage(this.stageLevel);

    this.bindInput();
    this.dealBoard();
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
    // 단계 모드와 연습 판에는 시간 제한이 없다.
    if (this.stageLevel !== null || this.practice) return;

    this.run = elapse(this.run, dt);
    this.hud.setTime(this.run.timeLeft, TIME_BANK_SECONDS);
    if (isOver(this.run)) {
      sfx.expire();
      this.endRun();
      return;
    }
    const remaining = Math.ceil(this.run.timeLeft);
    if (remaining <= TICK_FROM_SECONDS && remaining !== this.lastTickSecond) {
      this.lastTickSecond = remaining;
      sfx.tick();
    }
  }

  private resetState(): void {
    this.random = this.levelRandom();
    if (this.practice) this.run = practiceRun();
    else this.run = this.stageLevel === null ? newRun(this.random) : levelRun(this.stageLevel);
    this.practiceAt = -1;
    this.practiceUnmark = false;
    this.tool = 'fill';
    this.pads = [];
    this.marks = [];
    this.rowLabels = [];
    this.colLabels = [];
    this.stroke = null;
    this.pressedSide = null;
    this.pointed = [];
    this.hints = [];
    this.nameLabel = null;
    this.grace = 0;
    this.gate.reset();
    this.lastTickSecond = 0;
  }

  // ───────── 연습 판 ─────────

  /** 이 게임을 한 판도 마친 적이 없는지: 점수 도전을 끝낸 적도, 단계를 깬 적도 없는 사람 */
  private isNewcomer(): boolean {
    if (practicedThisSession) return false;
    const { games, stages } = store.data;
    return (games[this.gameId]?.plays ?? 0) === 0 && clearedOf(stages, this.gameId) === 0;
  }

  /** 연습 판의 HUD: 점수와 시간 대신 "연습"을 적고, 오른쪽 위에 건너뛰기 단추를 둔다. */
  private showPracticeHud(): void {
    this.hud.showTitle('연습');
    this.hud.setSide(SKIP.label);
    addTapZone(
      this,
      GAME_WIDTH - SKIP.width,
      0,
      SKIP.width,
      SKIP.height,
      () => undefined,
      () => {
        sfx.click();
        this.endPractice();
      },
    );
    this.tweens.add({
      targets: this.focusView,
      alpha: { from: 1, to: 0.3 },
      duration: 520,
      ease: 'Sine.InOut',
      yoyo: true,
      repeat: -1,
    });
  }

  /**
   * 지금 해 볼 걸음을 안내한다: 판 위에 두 줄로 적고, 볼 줄의 숫자를 들썩이고, 칠할 곳에 테를 두른다.
   * 칸을 칠하거나 X를 표시할 때마다 불러서, 걸음을 마쳤으면 다음 걸음으로 넘어간다.
   */
  private showPracticeStep(): void {
    const at = practiceStep(this.run.board);
    const step = PRACTICE_STEPS[at];
    if (!step) return;
    const unmark = this.strayMarks(step).length > 0;
    if (at !== this.practiceAt) {
      if (this.practiceAt >= 0) sfx.pop();
      this.practiceAt = at;
      this.stopPointing();
      this.point(this.rowLabels[step.row] ?? []);
    } else if (unmark === this.practiceUnmark) {
      this.drawPracticeFocus();
      return;
    }
    this.practiceUnmark = unmark;
    this.showHints([unmark ? HINTS.unmark : step.lines], true);
    this.drawPracticeFocus();
  }

  /**
   * 칠하는 걸음에서, 그 줄의 칠할 칸 가운데 X를 쳐 둔 칸들. X를 친 칸은 칠해지지 않으므로
   * 이것이 남아 있으면 그 걸음을 마칠 수 없다(표시를 켠 채 안내하는 줄을 누르면 생긴다).
   */
  private strayMarks(step: PracticeStep): number[] {
    if (practiceTool(step) !== 'fill') return [];
    const { board } = this.run;
    return practiceCells(board, step).filter((cell) => board.solution[cell] && board.cells[cell] === 'marked');
  }

  /** 지금 걸음에서 칠할 곳에 테를 두른다. 그 걸음에 쓸 도구가 켜져 있지 않으면 켤 단추에도 두른다. */
  private drawPracticeFocus(): void {
    const step = PRACTICE_STEPS[this.practiceAt];
    if (!this.practice || !step) {
      this.focusView.clear();
      return;
    }
    const { board } = this.run;
    const { cell, left, top } = this.layout;
    // X를 지우는 법을 안내하는 동안에는 X를 친 칸들과 표시 단추에 테를 두른다.
    const stray = this.strayMarks(step);
    const spots = stray.map((index) => {
      const at = cellOf(board, index);
      return { x: left + at.col * cell, y: top + at.row * cell, width: cell, height: cell, radius: 7 };
    });
    if (spots.length === 0) {
      const cells = practiceCells(board, step);
      const first = cellOf(board, cells[0]);
      spots.push({ x: left + first.col * cell, y: top + first.row * cell, width: cells.length * cell, height: cell, radius: 7 });
    }
    const tool = stray.length > 0 ? 'mark' : practiceTool(step);
    if (tool !== this.tool) {
      spots.push({
        x: TOGGLE_LEFT + (tool === 'fill' ? 0 : BAR.segment),
        y: this.barTop,
        width: BAR.segment,
        height: BAR.height,
        radius: BAR.height / 2,
      });
    }
    drawFocus(this.focusView, spots);
  }

  /** 연습을 마친다(다 칠했거나 건너뛰었다): 본 게임으로 다시 연다. */
  private endPractice(): void {
    if (!this.practice) return;
    this.practice = false;
    this.playing = false;
    practicedThisSession = true;
    this.cancelStroke();
    this.scene.restart({
      stageLevel: this.stageLevel ?? undefined,
      practiced: true,
    } satisfies PracticeStart & { stageLevel?: number });
  }

  // ───────── 화면 구성 ─────────

  private createSparks(
    tint: readonly number[],
    speed: number,
  ): Phaser.GameObjects.Particles.ParticleEmitter {
    return this.add
      .particles(0, 0, TEXTURE.spark, {
        speed: { min: speed * 0.3, max: speed },
        lifespan: { min: 200, max: 420 },
        alpha: { start: 1, end: 0 },
        tint: [...tint],
        emitting: false,
      })
      .setDepth(DEPTH.effect);
  }

  /** 아래 줄의 위쪽 끝과, 그 줄에 놓인 것들의 가운데 높이 */
  private get barTop(): number {
    return this.scale.height - BAR.bottom - BAR.height;
  }

  private get barMiddle(): number {
    return toggleCenter(TOGGLE_LEFT, this.barTop, BAR.segment, BAR.height, 'fill').y;
  }

  /** 화면 아래의 줄을 만든다: 왼쪽에 목숨과 판 번호, 오른쪽에 칠하기·X 단추. */
  private createControls(): void {
    this.heartsView = this.add.graphics();
    this.drawHeartsView();
    const heartsRight = BAR.side + HEARTS_SIZE.width;
    this.stageLabel = addText(this, (heartsRight + TOGGLE_LEFT) / 2, this.barMiddle, '', {
      color: LOOK.text.stage,
      originX: 0.5,
      originY: 0.5,
      stroke: LOOK.text.outline,
    });

    this.toggleView = this.add.graphics();
    const label = (side: Tool): Phaser.GameObjects.Text =>
      addText(this, 0, 0, TOOL_LABELS[side], { originX: 0.5, originY: 0.5 });
    this.toggleLabels = { fill: label('fill'), mark: label('mark') };
    for (const side of TOOLS) {
      const left = TOGGLE_LEFT + (side === 'fill' ? 0 : BAR.segment);
      // 누르는 자리는 보이는 단추보다 위아래로 조금 넓다.
      addTapZone(
        this,
        left,
        this.barTop - BAR.hitPadding,
        BAR.segment,
        BAR.height + BAR.hitPadding * 2,
        (pressed) => {
          this.pressedSide = pressed ? side : null;
          this.drawToggleView();
        },
        () => {
          sfx.click();
          vibrate(8);
          this.setTool(side);
        },
      );
    }
    this.drawToggleView();
  }

  private drawHeartsView(): void {
    const y = this.barMiddle - HEARTS_SIZE.height / 2;
    drawHearts(this.heartsView, BAR.side, y, this.run.hearts, START_HEARTS);
  }

  /** 단추를 지금 도구대로 다시 그린다. 고른 쪽은 색 있는 알약 위에 짙은 글자, 다른 쪽은 옅은 글자다. */
  private drawToggleView(): void {
    const top = this.barTop;
    const { segment, height } = BAR;
    drawToggle(this.toggleView, TOGGLE_LEFT, top, segment, height, this.tool, this.pressedSide, BAR.iconOffset);
    for (const side of TOOLS) {
      const active = side === this.tool;
      const center = toggleCenter(TOGGLE_LEFT, top, segment, height, side);
      // 색 있는 알약은 아래 두께만큼 윗면이 올라가 있으므로 글자도 같이 올린다.
      this.toggleLabels[side]
        .setColor(active ? LOOK.text.toggleOn : LOOK.text.toggleOff)
        .setPosition(Math.round(center.x + BAR.labelOffset[side]), Math.round(center.y - (active ? 1 : 0)));
    }
  }

  /** 도구를 바꾼다. 단추와 함께 판의 테두리 색도 바뀌어서, 판만 보고 있어도 지금 도구를 알 수 있다. */
  private setTool(tool: Tool): void {
    this.tool = tool;
    this.drawToggleView();
    drawBoard(this.boardCard, this.run.board, this.layout.cell, tool);
    this.drawPracticeFocus();
  }

  private showCellsLeft(bounce: boolean): void {
    // 연습 판에서는 그 자리에 건너뛰기 단추가 있다.
    if (this.practice) return;
    this.hud.setSide(`남은 칸 ${cellsLeft(this.run.board)}`, bounce);
  }

  // ───────── 도움말 ─────────

  /**
   * 판 바로 위에 도움말 두 줄을 띄운다. 묶음을 여럿 주면 하나씩 차례로 나왔다가 사라지고,
   * stay를 주면 사라지지 않고 떠 있는다(다음 도움말이나 판이 바뀔 때 치운다).
   */
  private showHints(queue: readonly HintLines[], stay = false): void {
    const [lines, ...rest] = queue;
    this.clearHints();
    const top = this.layout.top - this.layout.clueHeight - HEADER_HEIGHT;
    this.hints = lines.map((line, index) =>
      addText(this, GAME_WIDTH / 2, top + index * 16, line, {
        color: index === 0 ? LOOK.text.hint : LOOK.text.hintSub,
        originX: 0.5,
        stroke: LOOK.text.outline,
      }).setDepth(DEPTH.hud),
    );
    if (stay) return;
    this.tweens.add({
      targets: this.hints,
      alpha: 0,
      delay: HINT_MS,
      duration: 400,
      onComplete: () => {
        this.clearHints();
        if (rest.length > 0) this.showHints(rest);
      },
    });
  }

  private clearHints(): void {
    for (const line of this.hints) {
      this.tweens.killTweensOf(line);
      line.destroy();
    }
    this.hints = [];
  }

  // ───────── 판 깔기 ─────────

  /** 지금 판을 새로 깐다. 다 나타나면 시간이 흐르기 시작한다. 새 판은 언제나 칠하기 도구로 시작한다. */
  private dealBoard(): void {
    const { board, stage } = this.run;
    this.layout = boardLayout(board, boardArea(GAME_WIDTH, this.scale.height, HUD_HEIGHT, stage));
    const { cell, left, top } = this.layout;

    this.clearTiles();
    this.boardBox.setPosition(left + (board.cols * cell) / 2, top + (board.rows * cell) / 2);
    this.setTool('fill');
    this.addClues();
    this.pads = board.cells.map(() => null);
    // 칠할 칸이 없는 줄은 처음부터 X가 그어져 있다.
    this.marks = board.cells.map((state, index) => (state === 'marked' ? this.addMark(index, 0) : null));
    this.refreshClues();
    // 단계 모드에서는 단계 번호가 위쪽에 적혀 있다.
    this.stageLabel.setText(this.stageLevel === null && !this.practice ? `${stage}판` : '');
    this.showCellsLeft(stage > 1 && this.stageLevel === null);

    this.tweens.add({
      targets: this.boardBox,
      scale: { from: 0.94, to: 1 },
      alpha: { from: 0, to: 1 },
      duration: DEAL_MS,
      ease: 'Back.Out',
    });
    this.clearHints();
    this.startHintUp = stage === 1 && !this.practice;
    if (this.practice) this.showPracticeStep();
    else if (stage === 1) this.showHints([HINTS.start], true);
    else if (stage === 2) this.showHints([HINTS.drag]);
    const first = stage === 1 || this.stageLevel !== null;
    if (!first) sfx.pop();

    this.time.delayedCall(DEAL_MS, () => {
      this.playing = true;
      if (!first) return;
      sfx.go();
      if (stage === 1 && !this.practice) this.pointOutFullLine();
    });
  }

  /** 지난 판의 숫자와 칸 그림을 모두 치운다. */
  private clearTiles(): void {
    for (const layer of [this.clueLayer, this.tileLayer]) {
      for (const child of layer.list) this.tweens.killTweensOf(child);
      layer.removeAll(true);
      layer.setAlpha(1);
    }
    this.tweens.killTweensOf(this.clueStrips);
    this.clueStrips.setAlpha(1);
    this.nameLabel?.destroy();
    this.nameLabel = null;
    this.pads = [];
    this.marks = [];
    this.rowLabels = [];
    this.colLabels = [];
    this.pointed = [];
  }

  /** 줄마다의 숫자를 적는다. 가로줄의 숫자는 판의 왼쪽에 오른쪽으로 붙여서, 세로줄의 숫자는 위쪽에 아래로 붙여서 적는다. */
  private addClues(): void {
    const { board } = this.run;
    const { cell, clueSize, clueStep } = this.layout;
    const left = -(board.cols * cell) / 2;
    const top = -(board.rows * cell) / 2;
    const label = (x: number, y: number, value: number): Phaser.GameObjects.Text => {
      const text = addText(this, x, y, String(value), {
        size: clueSize,
        color: LOOK.text.clue,
        originX: 0.5,
        originY: 0.5,
      });
      this.clueLayer.add(text);
      return text;
    };
    // 칠할 칸이 없는 줄에는 0을 적는다.
    const shown = (clue: readonly number[]): readonly number[] => (clue.length > 0 ? clue : [0]);

    this.rowLabels = board.rowClues.map((clue, row) => {
      const numbers = shown(clue);
      return numbers.map((value, at) =>
        label(left - 5.5 - (numbers.length - 1 - at + 0.5) * clueStep.x, top + (row + 0.5) * cell, value),
      );
    });
    this.colLabels = board.colClues.map((clue, col) => {
      const numbers = shown(clue);
      return numbers.map((value, at) =>
        label(left + (col + 0.5) * cell, top - 5 - (numbers.length - 1 - at + 0.5) * clueStep.y, value),
      );
    });
  }

  /** 다 칠한 줄의 숫자를 흐리게 하고 띠의 색을 바꾼다. */
  private refreshClues(): void {
    const { board } = this.run;
    const rowsDone = board.rowClues.map((_, row) => isRowDone(board, row));
    const colsDone = board.colClues.map((_, col) => isColDone(board, col));
    drawClueStrips(this.clueStrips, board, this.layout, rowsDone, colsDone);
    const paint = (labels: readonly Phaser.GameObjects.Text[], done: boolean): void => {
      for (const text of labels) text.setColor(done ? LOOK.text.clueDone : LOOK.text.clue);
    };
    this.rowLabels.forEach((labels, row) => paint(labels, rowsDone[row]));
    this.colLabels.forEach((labels, col) => paint(labels, colsDone[col]));
  }

  /** 칸의 가운데. 판 그릇 안에서의 좌표다(원점이 판의 한가운데). */
  private cellSpot(index: number): { x: number; y: number } {
    const { board } = this.run;
    const { col, row } = cellOf(board, index);
    return {
      x: (col + 0.5 - board.cols / 2) * this.layout.cell,
      y: (row + 0.5 - board.rows / 2) * this.layout.cell,
    };
  }

  /** 칸의 가운데를 화면 좌표로. 효과와 떠오르는 글자를 놓을 때 쓴다. */
  private cellOnScreen(index: number): { x: number; y: number } {
    const spot = this.cellSpot(index);
    return { x: this.boardBox.x + spot.x, y: this.boardBox.y + spot.y };
  }

  /**
   * (x, y)에 놓인 칸의 번호. 판 밖이면 null.
   * slop을 주면 판 밖으로 그만큼(칸 크기의 배수)까지 벗어난 자리도 가장 가까운 칸으로 본다.
   */
  private cellAt(x: number, y: number, slop = 0): number | null {
    const { board } = this.run;
    const { cell, left, top } = this.layout;
    const col = (x - left) / cell;
    const row = (y - top) / cell;
    if (col < -slop || col >= board.cols + slop || row < -slop || row >= board.rows + slop) return null;
    const clamp = (value: number, count: number): number => Math.min(count - 1, Math.max(0, Math.floor(value)));
    return clamp(row, board.rows) * board.cols + clamp(col, board.cols);
  }

  /** 첫 판에서 아직 아무것도 칠하지 않았을 때, 모두 칠하는 줄의 숫자가 들썩여서 시작할 곳을 알려 준다. */
  private pointOutFullLine(): void {
    const { board } = this.run;
    const row = board.rowClues.findIndex((clue) => clue[0] === board.cols);
    const col = board.colClues.findIndex((clue) => clue[0] === board.rows);
    const label = row >= 0 ? this.rowLabels[row]?.[0] : col >= 0 ? this.colLabels[col]?.[0] : undefined;
    if (label) this.point([label]);
  }

  /** 숫자들을 들썩여서 눈에 띄게 한다. 칸을 누르면 멈춘다. */
  private point(labels: readonly Phaser.GameObjects.Text[]): void {
    if (labels.length === 0) return;
    this.pointed = [...labels];
    this.tweens.add({
      targets: this.pointed,
      scale: 1.35,
      duration: 340,
      ease: 'Sine.InOut',
      yoyo: true,
      repeat: -1,
    });
  }

  private stopPointing(): void {
    if (this.pointed.length === 0) return;
    this.tweens.killTweensOf(this.pointed);
    for (const label of this.pointed) label.setScale(1);
    this.pointed = [];
  }

  // ───────── 입력 ─────────

  private bindInput(): void {
    const keyboard = this.input.keyboard;
    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    this.input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.cancelStroke, this);
    // 키보드가 있으면 스페이스나 X로 도구를 바꾼다.
    keyboard?.on('keydown-SPACE', this.flipTool, this);
    keyboard?.on('keydown-X', this.flipTool, this);
    // 일시정지한 동안 시간을 들이지 않고 판을 궁리할 수 없게 숫자와 칸을 가린다.
    this.events.on(Phaser.Scenes.Events.PAUSE, this.onPause, this);
    this.events.on(Phaser.Scenes.Events.RESUME, this.onResume, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.off(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
      this.input.off(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
      this.input.off(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
      this.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.cancelStroke, this);
      keyboard?.off('keydown-SPACE', this.flipTool, this);
      keyboard?.off('keydown-X', this.flipTool, this);
      this.events.off(Phaser.Scenes.Events.PAUSE, this.onPause, this);
      this.events.off(Phaser.Scenes.Events.RESUME, this.onResume, this);
    });
  }

  private flipTool(): void {
    if (!this.playing) return;
    sfx.click();
    this.setTool(this.tool === 'fill' ? 'mark' : 'fill');
  }

  private setSecretsVisible(visible: boolean): void {
    this.clueLayer.setVisible(visible);
    this.tileLayer.setVisible(visible);
  }

  private onPause(): void {
    this.cancelStroke();
    // "준비!"가 끝나기 전에 다시 멈췄으면 그동안 판을 본 시간을 시계에서 뺀다.
    // 그러지 않으면 멈추기와 계속하기를 되풀이해서 시계를 세워 둔 채 판을 볼 수 있다.
    if (this.grace > 0) this.chargeGrace();
    // 끝난 뒤 결과 화면이 뜰 때는 판을 그대로 보여 준다. 시간이 흐르지 않는 단계 모드에서도 가리지 않는다.
    if (this.playing && this.stageLevel === null && !this.practice) this.setSecretsVisible(false);
  }

  private onResume(): void {
    this.setSecretsVisible(true);
    // 아직 시간이 가지 않고 있었으면 숨 고를 시간도 필요 없다. 시간이 다 됐으면 다음 프레임에 끝난다.
    if (!this.playing || !this.gate.open || this.stageLevel !== null || this.practice || isOver(this.run)) return;
    this.grace = RESUME_GRACE_SECONDS;
    showBanner(this, this.boardBox.y, '준비!', LOOK.text.ready, RESUME_GRACE_SECONDS * 1000, DEPTH.banner);
  }

  /** 일시정지에서 돌아와 "준비!"가 떠 있던 동안(판이 보이던 동안)을 시계에 달고, 남은 여유를 거둔다. */
  private chargeGrace(): void {
    const seen = RESUME_GRACE_SECONDS - this.grace;
    this.grace = 0;
    this.run = elapse(this.run, seen);
    this.hud.setTime(this.run.timeLeft, TIME_BANK_SECONDS);
  }

  /** 칸을 누르기 시작했다. 그대로 떼면 그 칸에, 끌다가 떼면 지나간 줄에 도구를 쓴다. */
  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    // 위쪽 HUD(일시정지 버튼)를 누른 것은 칸을 누른 것이 아니다.
    if (!this.playing || this.grace > 0 || this.stroke || pointer.worldY < HUD_HEIGHT) return;
    const index = this.cellAt(pointer.worldX, pointer.worldY);
    if (index === null) return;

    this.gate.start();
    this.stopPointing();
    this.stroke = {
      from: index,
      pointerId: pointer.id,
      // 마우스가 있으면 오른쪽 단추가 곧 X다.
      tool: pointer.rightButtonDown() ? 'mark' : this.tool,
      path: [index],
    };
    this.showStroke();
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    const stroke = this.stroke;
    if (!stroke || pointer.id !== stroke.pointerId) return;
    const to = this.cellAt(pointer.worldX, pointer.worldY, DRAG_SLOP);
    const path = to === null ? [] : strokeCells(this.run.board, stroke.from, to);
    if (path.length === stroke.path.length && path.at(-1) === stroke.path.at(-1)) return;
    stroke.path = path;
    this.showStroke();
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    const stroke = this.stroke;
    if (!stroke || pointer.id !== stroke.pointerId) return;
    this.cancelStroke();
    // 전화가 오거나 알림 창을 내려서 터치가 취소된 것은 손을 뗀 것이 아니다: 없던 일로 한다.
    if (pointer.wasCanceled) return;
    if (this.playing && stroke.path.length > 0) this.applyStroke(stroke.path, stroke.tool);
  }

  /** 누르던 것을 없던 일로 한다. 미리 보여 주던 테와 말풍선을 치운다. */
  private cancelStroke(): void {
    if (!this.stroke) return;
    this.stroke = null;
    this.strokeView.clear();
    this.lens.hide();
  }

  /**
   * 손을 떼면 도구가 지나갈 칸들에 테를 두른다. 칸이 작은 판에서는 손가락이 칸을 가리므로,
   * 손가락 아래의 칸을 손가락 위에 크게 띄우고, 여러 칸을 끌고 있으면 몇 칸인지도 적어 준다.
   */
  private showStroke(): void {
    const stroke = this.stroke;
    if (!stroke) return;
    const { cell } = this.layout;
    const spots = stroke.path.map((index) => {
      const spot = this.cellOnScreen(index);
      return { x: spot.x - cell / 2, y: spot.y - cell / 2 };
    });
    drawStroke(this.strokeView, spots, cell, stroke.tool);

    const last = stroke.path.at(-1);
    if (last === undefined || cell >= LENS_BELOW_CELL) {
      this.lens.hide();
      return;
    }
    const count = stroke.path.length;
    this.lens.show({ ...this.cellOnScreen(last), size: cell }, LENS_TOP, (content) => {
      if (stroke.tool === 'fill') content.add(this.add.image(0, 0, padTexture(this, LENS_ROOM)));
      else content.add(this.add.image(0, 0, markTexture(this)).setScale(LENS_ROOM / ART_CELL));
      if (count < 2) return;
      content.add(
        addText(this, 0, 0, String(count), {
          size: FONT_SIZE.large - 4,
          color: LOOK.text.count,
          originX: 0.5,
          originY: 0.5,
          stroke: LOOK.text.countOutline,
        }),
      );
    });
  }

  // ───────── 칠하기와 X ─────────

  private applyStroke(path: readonly number[], tool: Tool): void {
    const before = this.run.board.cells[path[0]];
    const { run, outcome } = paint(this.run, path, tool);
    // 연습에서는 틀려도 목숨이 줄지 않는다.
    this.run = this.practice ? forgive(run) : run;
    if (outcome.kind === 'filled') this.onFilled(outcome);
    else if (outcome.kind === 'marked') this.onMarked(outcome.marked, outcome.unmarked);
    // X를 그어 둔 칸은 칠해지지 않는다. X가 도리도리 흔들려서 알려 준다.
    else if (tool === 'fill' && before === 'marked') this.refuseMarked(path[0]);
    // 연습에서는 걸음을 마쳤으면 다음 걸음을 안내한다(다 칠했으면 판이 넘어가는 중이다).
    if (this.practice && this.playing) this.showPracticeStep();
  }

  private onMarked(marked: readonly number[], unmarked: readonly number[]): void {
    marked.forEach((cell, order) => {
      this.marks[cell] = this.addMark(cell, order * FILL_STEP_MS);
    });
    for (const cell of unmarked) this.removeMark(cell);
    if (marked.length > 0) sfx.pop();
    else sfx.pull();
    vibrate(8);
  }

  /** X가 톡 튀어나오며 그어진다. */
  private addMark(index: number, delay: number, texture = markTexture(this)): Phaser.GameObjects.Image {
    const { x, y } = this.cellSpot(index);
    const mark = this.add.image(x, y, texture).setScale(0);
    this.tileLayer.add(mark);
    this.tweens.add({
      targets: mark,
      scale: this.layout.cell / ART_CELL,
      delay,
      duration: 150,
      ease: 'Back.Out',
    });
    return mark;
  }

  private removeMark(index: number): void {
    const mark = this.marks[index];
    if (!mark) return;
    this.marks[index] = null;
    this.tweens.killTweensOf(mark);
    this.tweens.add({
      targets: mark,
      scale: 0,
      duration: 90,
      ease: 'Quad.In',
      onComplete: () => mark.destroy(),
    });
  }

  private refuseMarked(index: number): void {
    const mark = this.marks[index];
    if (!mark) return;
    sfx.deny();
    this.tweens.killTweensOf(mark);
    mark.setScale(this.layout.cell / ART_CELL).setAngle(0);
    this.tweens.add({
      targets: mark,
      angle: { from: -14, to: 14 },
      duration: 60,
      yoyo: true,
      repeat: 1,
      onComplete: () => mark.setAngle(0),
    });
  }

  /** 칠한 칸이 톡 튀어나온다. */
  private addPad(index: number, delay: number): void {
    const { x, y } = this.cellSpot(index);
    const pad = this.add.image(x, y, padTexture(this, this.layout.cell)).setScale(0);
    this.tileLayer.add(pad);
    this.pads[index] = pad;
    this.tweens.add({ targets: pad, scale: 1, delay, duration: FILL_MS, ease: 'Back.Out' });
  }

  private onFilled(outcome: Filled): void {
    const { filled, missed, autoMarked } = outcome;
    filled.forEach((cell, order) => this.addPad(cell, order * FILL_STEP_MS));
    const settle = filled.length * FILL_STEP_MS;
    autoMarked.forEach((cell, order) => {
      this.marks[cell] = this.addMark(cell, settle + order * 12);
    });
    if (outcome.rowsDone.length + outcome.colsDone.length > 0) this.refreshClues();
    this.hud.setScore(this.run.score);
    this.showCellsLeft(false);

    const last = filled.at(-1);
    if (last !== undefined) {
      const spot = this.cellOnScreen(last);
      sfx.hit(Math.min(filled.length - 1, 8));
      vibrate(8);
      this.sparks.fill.explode(Math.min(10, 2 + filled.length), spot.x, spot.y);
      // 연습 판에는 점수가 없다.
      if (!this.practice) {
        const top = spot.y - this.layout.cell / 2;
        this.floatPoints(spot.x, top, outcome.points, LOOK.text.points, this.playArea, DEPTH.effect);
      }
    }
    if (missed !== null) this.onMissed(missed);

    const going = !isOver(this.run) && !outcome.cleared;
    if (this.startHintUp && filled.length > 0) {
      this.startHintUp = false;
      if (going) this.showHints([HINTS.marks]);
      else this.clearHints();
    }

    if (isOver(this.run)) this.endRun();
    else if (outcome.cleared) this.onBoardCleared(outcome.cleared);
  }

  /** 칠하면 안 되는 칸을 칠하려 했다: 그 칸에 붉은 X가 그어지고 목숨이 줄어든다. */
  private onMissed(index: number): void {
    this.marks[index] = this.addMark(index, 0, missTexture(this));
    this.drawHeartsView();
    sfx.miss();
    vibrate([30, 30, 60]);
    this.cameras.main.shake(140, 0.006);

    const spot = this.cellOnScreen(index);
    this.sparks.miss.explode(8, spot.x, spot.y);
    floatText(this, spot.x, spot.y - this.layout.cell / 2, '앗!', LOOK.text.bad, this.playArea, DEPTH.effect);
  }

  // ───────── 판이 바뀜 ─────────

  /**
   * 다 칠한 판에 색을 입힌다. X와 줄마다의 숫자는 사라지고, 칠한 칸이 왼쪽 위부터 차례로 제 색으로 바뀐다.
   * 그림이 정해진 판은 그림의 색으로, 무작위로 만든 판은 한 가지 색으로 물든다.
   * 색이 다 번지기까지 걸리는 시간(ms)을 돌려준다.
   */
  private reveal(): number {
    const { board, stage } = this.run;
    const { cell } = this.layout;
    const plain = LOOK.patterns[(stage - 1) % LOOK.patterns.length];
    const colors = board.picture ? colorsOf(board.picture) : null;

    this.tweens.add({ targets: [this.clueLayer, this.clueStrips], alpha: 0, duration: 260 });
    for (const mark of this.marks) {
      if (!mark) continue;
      this.tweens.killTweensOf(mark);
      this.tweens.add({ targets: mark, alpha: 0, scale: 0, duration: 200 });
    }

    let longest = 0;
    this.pads.forEach((pad, index) => {
      if (!pad) return;
      const { col, row } = cellOf(board, index);
      const delay = 200 + (col + row) * REVEAL_STEP_MS;
      longest = Math.max(longest, delay);
      const texture = padTexture(this, cell, colors?.[index] ?? plain);
      this.tweens.killTweensOf(pad);
      pad.setScale(1);
      this.tweens.add({
        targets: pad,
        scale: { from: 1.25, to: 1 },
        delay,
        duration: 180,
        ease: 'Back.Out',
        onStart: () => pad.setTexture(texture),
      });
    });
    return longest + 180;
  }

  /** 그림의 이름을 판 위(세로줄의 숫자가 있던 자리)에 적는다. */
  private showName(name: string): void {
    const y = this.layout.top - this.layout.clueHeight / 2 - 3;
    const label = addText(this, this.boardBox.x, y, name, {
      size: [...name].length > LONG_NAME ? FONT_SIZE.large - 4 : FONT_SIZE.large,
      color: LOOK.text.name,
      originX: 0.5,
      originY: 0.5,
      stroke: LOOK.text.outline,
    }).setDepth(DEPTH.banner);
    // 긴 이름도 화면 밖으로 나가지 않게 가운데를 안쪽으로 당긴다.
    const half = label.width / 2 + 4;
    label.setX(Math.round(Math.min(GAME_WIDTH - half, Math.max(half, label.x))));
    label.setScale(0);
    this.tweens.add({ targets: label, scale: 1, duration: 220, ease: 'Back.Out' });
    this.nameLabel = label;
  }

  private onBoardCleared(reward: ClearReward): void {
    // 다음 판이 깔릴 때까지 시간이 멈춘다.
    this.playing = false;
    this.lastTickSecond = 0;
    this.cancelStroke();
    this.stopPointing();
    this.hud.setTime(this.run.timeLeft, TIME_BANK_SECONDS);
    this.clearHints();
    const revealed = this.reveal();

    if (this.practice) {
      // 연습 판을 다 칠했다: 하트에 색이 번지면 칭찬하고, 잠깐 뒤에 본 게임을 연다.
      this.practiceAt = -1;
      this.drawPracticeFocus();
      this.hud.setSide('');
      this.time.delayedCall(revealed, () => {
        sfx.gold();
        vibrate([15, 30, 15]);
        this.sparks.clear.explode(18, this.boardBox.x, this.boardBox.y);
        // 색이 입혀진 하트를 가리지 않게 판 위쪽(도움말이 있던 자리)에 띄운다.
        const y = this.layout.top - this.layout.clueHeight - HEADER_HEIGHT / 2;
        showBanner(this, y, '잘했어요!', LOOK.text.good, PRACTICE_DONE_MS - revealed, DEPTH.banner);
      });
      this.time.delayedCall(PRACTICE_DONE_MS, () => this.endPractice());
      return;
    }

    if (this.stageLevel !== null) {
      // 단계 모드는 그림 하나가 한 판이다. 그림이 다 드러나면 이름을 알려 주고, 다음 단계는 결과 화면에서 고른다.
      const name = this.run.board.picture?.name;
      this.time.delayedCall(revealed, () => {
        sfx.gold();
        vibrate([15, 30, 15]);
        this.sparks.clear.explode(18, this.boardBox.x, this.boardBox.y);
        if (name) this.showName(name);
      });
      this.finishStage(true, this.stageStats(true), revealed + REVEAL_HOLD_MS);
      return;
    }

    this.time.delayedCall(CLEAR_BANNER_MS, () => {
      sfx.gold();
      vibrate([15, 30, 15]);
      this.sparks.clear.explode(18, GAME_WIDTH / 2, this.boardBox.y);
      this.showClearBanner(reward, NEXT_BOARD_MS - CLEAR_BANNER_MS);
    });
    this.time.delayedCall(NEXT_BOARD_MS, () => {
      this.run = nextStage(this.run, this.random);
      this.dealBoard();
    });
  }

  /** 판 한가운데에 깼다는 글자와, 그 아래에 받은 점수와 돌려받은 시간을 띄운다. */
  private showClearBanner(reward: ClearReward, durationMs: number): void {
    const centerY = this.boardBox.y;
    const title = reward.flawless ? '완벽해요!' : '클리어!';
    showBanner(this, centerY, title, LOOK.text.good, durationMs, DEPTH.banner);
    // 시간이 이미 가득해서 돌려받은 것이 없으면 점수만 보여 준다.
    const seconds = Math.round(reward.seconds);
    const label = seconds >= 1 ? `+${reward.points}점  +${seconds}초` : `+${reward.points}점`;
    const y = centerY + BONUS.offsetY;
    // 바탕을 글자보다 먼저 만들어야 글자 아래에 깔린다.
    const plate = this.add.graphics().setDepth(DEPTH.banner);
    const bonus = addText(this, GAME_WIDTH / 2, y, label, {
      color: LOOK.text.points,
      originX: 0.5,
      originY: 0.5,
      stroke: LOOK.text.outline,
    }).setDepth(DEPTH.banner);
    const { height } = BONUS;
    const width = Math.ceil(bonus.width) + BONUS.padding * 2;
    plate.fillStyle(LOOK.text.plate, BONUS.alpha);
    plate.fillRoundedRect((GAME_WIDTH - width) / 2, y - height / 2, width, height, height / 2);
    this.tweens.add({
      targets: [plate, bonus],
      alpha: 0,
      delay: durationMs * 0.6,
      duration: durationMs * 0.4,
      onComplete: () => {
        plate.destroy();
        bonus.destroy();
      },
    });
  }

  private endRun(): void {
    this.playing = false;
    this.cancelStroke();
    this.stopPointing();
    this.clearHints();
    showBanner(this, this.boardBox.y, '끝!', LOOK.text.over, 900, DEPTH.banner);
    if (this.stageLevel !== null) {
      this.finishStage(false, this.stageStats(false), 1100);
      return;
    }
    this.finishMiniGame(this.run.score, [
      ['깬 판', `${this.run.boardsCleared}판`],
      ['칠한 칸', `${this.run.cellsFilled}칸`],
      ['틀린 횟수', `${this.run.mistakes}번`],
    ]);
  }

  /**
   * 단계 도전은 시간 제한 없이 큰 그림을 오래 칠하고, 하던 그림은 남지 않는다.
   * 칠하던 그림이 있으면 "그만하기"를 누른 뒤에 한 번 더 묻는다.
   */
  protected override quitWarning(): string | null {
    if (this.stageLevel === null || this.practice || !this.playing) return null;
    return this.run.cellsFilled > 0 || this.run.mistakes > 0 ? '칠하던 그림이 사라져요' : null;
  }

  /** 단계 모드의 결과 화면에 적는 것. 다 그렸을 때만 무슨 그림이었는지 알려 준다. */
  private stageStats(cleared: boolean): ResultStat[] {
    const name = cleared ? this.run.board.picture?.name : undefined;
    return [
      ...(name ? [['그림', name] as const] : []),
      ['칠한 칸', `${this.run.cellsFilled}칸`],
      ['틀린 횟수', `${this.run.mistakes}번`],
    ];
  }
}
