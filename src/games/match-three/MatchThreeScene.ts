import Phaser from 'phaser';
import { FONT_SIZE, GAME_WIDTH, SCENE, THEME } from '../../config';
import { TEXTURE } from '../../art/sprites';
import { vibrate } from '../../core/haptics';
import { sfx } from '../../core/sfx';
import { StartGate } from '../../core/start-gate';
import { addBackdrop, addText, drawPanel } from '../../core/ui';
import { floatText, GameHud, HUD_HEIGHT, showBanner } from '../../scenes/GameHud';
import { MiniGameScene, type ResultStat } from '../../scenes/MiniGameScene';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  boardTexture,
  CELL,
  drawDone,
  drawSelection,
  LOOK,
  pieceTexture,
  RIM,
  RIM_LIP,
} from './art';
import {
  afterTurn,
  ARCADE_KINDS,
  areAdjacent,
  CELLS,
  cellOf,
  chainOf,
  clockRuns,
  colOf,
  COLS,
  findMoves,
  goalLeft,
  isLevelCleared,
  isLevelFailed,
  levelPlan,
  neighbourOf,
  newBoard,
  playSwap,
  refillRandom,
  rowOf,
  ROWS,
  secondsBack,
  START_SECONDS,
  startLevel,
  type BoardPhase,
  type Direction,
  type LevelRun,
  type Move,
  type Piece,
  type Step,
  type Turn,
} from './rules';

// ───────── 자리 ─────────

const BOARD_LEFT = (GAME_WIDTH - BOARD_WIDTH) / 2;
/** 판 위에 안내 두 줄이나 단계의 목표가 들어갈 자리. 화면이 짧아도 이만큼은 비워 둔다. */
const TOP_ROOM = 44;
/** 판 아래에 한 줄 설명이 들어갈 자리 */
const NOTE_ROOM = 22;
/** 단계의 목표 하나가 차지하는 너비: 조각 그림과 남은 수 */
const GOAL_WIDTH = 50;
const GOAL_HEIGHT = 28;
/** 목표에 그리는 조각의 크기(판의 조각에 대한 비율) */
const GOAL_SCALE = 0.62;

// ───────── 움직임 ─────────

/** 두 조각이 자리를 바꾸는 시간(ms) */
const SWAP_MS = 110;
/** 맞은 조각이 사라지는 시간(ms) */
const POP_MS = 150;
/** 조각이 떨어지는 시간(ms): 한 칸은 DROP_BASE_MS + DROP_CELL_MS, 멀리서 떨어질수록 조금씩 길다. */
const DROP_BASE_MS = 90;
const DROP_CELL_MS = 40;
/** 다 떨어진 뒤 다음 연쇄까지 쉬는 시간(ms). 무엇이 맞았는지 눈에 들어오게 한다. */
const STEP_GAP_MS = 70;
/** 섞인 조각이 제자리를 찾아가는 시간(ms) */
const SHUFFLE_MS = 340;
/** 이만큼 끌면 그쪽 조각과 바꾼다. */
const DRAG_DISTANCE = CELL * 0.36;
/** 이 시간(초) 동안 아무것도 하지 않으면 바꿀 수 있는 자리를 흔들어 알려 준다. */
const HINT_SECONDS = 5;
/** 알려 준 뒤 다시 알려 주기까지(초) */
const HINT_REPEAT_SECONDS = 2.5;
/** 알려 줄 때 두 조각이 서로에게 다가가는 거리 */
const HINT_NUDGE = 4;
/** 마지막 몇 초를 째깍 소리로 알리는지 */
const TICK_FROM_SECONDS = 5;

const DEPTH = { board: 1, piece: 5, select: 6, effect: 20, hud: 30, hint: 32, banner: 40 } as const;

/** 손가락 하나가 누른 조각. 한 번 누른 동안에는 한 번만 바꾼다. */
interface Touch {
  id: number;
  cell: number;
  x: number;
  y: number;
  used: boolean;
}

/** 단계의 목표 하나를 보여 주는 것: 조각 그림, 남은 수, 다 모았다는 표시 */
interface GoalView {
  kind: number;
  count: number;
  icon: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  done: Phaser.GameObjects.Graphics;
  /** 지금 화면에 적힌 남은 수 */
  shown: number;
}

/**
 * 세 개 맞추기: 이웃한 두 조각을 맞바꿔 같은 조각 셋을 나란히 놓으면 사라진다.
 * 점수 도전은 제한 시간 안에 점수를 겨루고, 단계 모드는 정해진 횟수 안에 목표 조각을 모은다.
 * 규칙은 rules.ts에, 그림은 art.ts에 있고, 이 씬은 입력과 움직임만 맡는다.
 */
export class MatchThreeScene extends MiniGameScene {
  protected readonly gameId = 'match-three';

  private hud!: GameHud;
  private board: Piece[] = [];
  /** 칸 번호 → 그 칸에 놓인 조각 그림 */
  private views: (Phaser.GameObjects.Image | null)[] = [];
  private pool: Phaser.GameObjects.Image[] = [];
  private pieceLayer!: Phaser.GameObjects.Container;
  private selection!: Phaser.GameObjects.Graphics;
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  private hints: Phaser.GameObjects.Text[] = [];
  private goals: GoalView[] = [];
  private boardTop = 0;
  private bounds!: Phaser.Geom.Rectangle;

  private phase: BoardPhase = 'idle';
  private kinds = ARCADE_KINDS;
  private random: () => number = Math.random;
  private touch: Touch | null = null;
  private selected: number | null = null;
  /** 아무것도 하지 않고 지난 시간(초). 바꿀 수 있는 자리를 알려 줄 때를 잰다. */
  private idle = 0;
  /** 지금 흔들어 알려 주고 있는 두 칸 */
  private hinted: Move | null = null;

  private score = 0;
  private popped = 0;
  private longest = 0;
  private bursts = 0;
  private timeLeft = START_SECONDS;
  private readonly gate = new StartGate();
  private lastTick = 0;

  /** 단계 모드의 진행. 점수 도전이면 null */
  private run: LevelRun | null = null;
  /** 단계 모드에서 갈래마다 지금까지 화면에 반영한 모은 수. 연쇄가 이어지는 동안 한 걸음씩 는다. */
  private collected: number[] = [];

  constructor() {
    super(SCENE.matchThree);
  }

  create(): void {
    this.beginMiniGame();
    this.resetState();

    const height = this.scale.height;
    const room = height - HUD_HEIGHT - TOP_ROOM - BOARD_HEIGHT - RIM_LIP - NOTE_ROOM;
    this.boardTop = Math.round(HUD_HEIGHT + TOP_ROOM + Math.max(0, room / 2));
    this.bounds = new Phaser.Geom.Rectangle(0, HUD_HEIGHT, GAME_WIDTH, height - HUD_HEIGHT);

    addBackdrop(this);
    this.add.image(BOARD_LEFT, this.boardTop, boardTexture(this)).setOrigin(0, 0).setDepth(DEPTH.board);
    this.pieceLayer = this.add.container(0, 0).setDepth(DEPTH.piece);
    this.selection = this.add.graphics().setDepth(DEPTH.select).setVisible(false);
    drawSelection(this.selection);
    this.sparks = this.add
      .particles(0, 0, TEXTURE.spark, {
        speed: { min: 30, max: 110 },
        lifespan: { min: 180, max: 380 },
        alpha: { start: 1, end: 0 },
        tint: [...LOOK.sparks],
        emitting: false,
      })
      .setDepth(DEPTH.effect);

    this.addPauseButton();
    this.hud = new GameHud(this, DEPTH.hud);

    if (this.stageLevel === null) {
      this.kinds = ARCADE_KINDS;
      this.random = Math.random;
      this.board = newBoard(this.kinds, Math.random);
      this.hud.setTime(this.timeLeft, START_SECONDS);
      this.showHints();
      this.addNote('넷 이상 맞추면 폭죽이 생겨요');
    } else {
      // 같은 단계는 언제나 같은 판이고, 새로 들어오는 조각도 같은 차례로 나온다.
      const plan = levelPlan(this.stageLevel);
      this.run = startLevel(plan);
      this.kinds = plan.kinds;
      this.random = refillRandom(plan.seed);
      this.board = [...plan.board];
      this.hud.showStage(this.stageLevel);
      this.showMoves(false);
      this.createGoals();
      this.addNote('횟수 안에 위의 조각을 모두 모아요');
      // 단계 모드는 시간을 재지 않으므로 기다릴 것이 없다.
      this.gate.start();
    }
    this.syncViews();
    this.dealIn();

    this.bindInput();
    showBanner(this, this.boardCenterY(), '시작!', LOOK.text.start, 600, DEPTH.banner);
    sfx.go();
    this.playing = true;
  }

  override update(time: number, deltaMs: number): void {
    if (!this.playing) return;
    // 탭이 가려졌다 돌아와도 시간이 한꺼번에 흐르지 않게 한 프레임의 길이를 제한한다.
    const dt = Math.min(deltaMs, 100) / 1000;
    if (this.phase === 'idle') {
      this.pulseBursts(time);
      this.idle += dt;
      if (this.idle >= HINT_SECONDS) this.showMoveHint();
    }

    // 조각이 사라지고 떨어지는 동안에는 시간이 흐르지 않는다: 길게 이어진 연쇄가 시간을 잡아먹지 않는다.
    // 맞지 않는 바꾸기가 되돌아오는 동안에는 흐른다(clockRuns).
    if (this.stageLevel !== null || !clockRuns(this.phase)) return;
    if (!this.gate.open) {
      if (this.gate.wait(dt)) this.hideHints();
      return;
    }
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    this.hud.setTime(this.timeLeft, START_SECONDS);
    this.tickLastSeconds();
    if (this.timeLeft <= 0) this.endRun();
  }

  private resetState(): void {
    this.board = [];
    this.views = Array<Phaser.GameObjects.Image | null>(CELLS).fill(null);
    this.pool = [];
    this.hints = [];
    this.goals = [];
    this.phase = 'idle';
    this.kinds = ARCADE_KINDS;
    this.random = Math.random;
    this.touch = null;
    this.selected = null;
    this.idle = 0;
    this.hinted = null;
    this.score = 0;
    this.popped = 0;
    this.longest = 0;
    this.bursts = 0;
    this.timeLeft = START_SECONDS;
    this.gate.reset();
    this.lastTick = 0;
    this.run = null;
    this.collected = [];
  }

  // ───────── 자리와 그림 ─────────

  /** 칸의 한가운데 */
  private centerOf(cell: number): { x: number; y: number } {
    return {
      x: BOARD_LEFT + RIM + colOf(cell) * CELL + CELL / 2,
      y: this.boardTop + RIM + rowOf(cell) * CELL + CELL / 2,
    };
  }

  private boardCenterY(): number {
    return this.boardTop + BOARD_HEIGHT / 2;
  }

  /** 그 자리의 칸. 판 밖이면 null */
  private cellAt(x: number, y: number): number | null {
    const col = Math.floor((x - BOARD_LEFT - RIM) / CELL);
    const row = Math.floor((y - this.boardTop - RIM) / CELL);
    return col < 0 || col >= COLS || row < 0 || row >= ROWS ? null : cellOf(col, row);
  }

  /** 조각 그림 하나를 꺼내 그 조각의 모습으로 맞춘다. 사라진 조각의 그림을 다시 쓴다. */
  private takeView(piece: Piece): Phaser.GameObjects.Image {
    const texture = pieceTexture(this, piece.kind, piece.burst);
    const view = this.pool.pop();
    if (view) return view.setTexture(texture).setVisible(true).setAlpha(1).setScale(1);
    const created = this.add.image(0, 0, texture);
    this.pieceLayer.add(created);
    return created;
  }

  private dropView(view: Phaser.GameObjects.Image): void {
    this.tweens.killTweensOf(view);
    view.setVisible(false);
    this.pool.push(view);
  }

  /**
   * 조각 그림을 판과 똑같이 맞춘다: 칸마다 그 조각의 그림이 제자리에 온전한 크기로 놓인다.
   * 움직임이 끝날 때마다 불러서, 도중에 무엇이 어긋났더라도 화면과 판이 달라지지 않게 한다.
   */
  private syncViews(): void {
    this.board.forEach((piece, cell) => {
      const view = this.views[cell] ?? this.takeView(piece);
      this.views[cell] = view;
      this.tweens.killTweensOf(view);
      const { x, y } = this.centerOf(cell);
      view
        .setTexture(pieceTexture(this, piece.kind, piece.burst))
        .setPosition(x, y)
        .setScale(1)
        .setAlpha(1)
        .setVisible(true);
    });
  }

  /** 처음에 조각이 줄줄이 톡톡 나타난다. */
  private dealIn(): void {
    this.views.forEach((view, cell) => {
      if (!view) return;
      this.tweens.add({
        targets: view,
        scale: { from: 0.2, to: 1 },
        delay: (colOf(cell) + rowOf(cell)) * 18,
        duration: 160,
        ease: 'Back.Out',
      });
    });
  }

  /** 폭죽 조각은 가만히 있는 동안 살짝 커졌다 작아져서 눈에 띈다. */
  private pulseBursts(time: number): void {
    const scale = 1 + 0.05 * Math.sin(time / 180);
    this.board.forEach((piece, cell) => {
      if (!piece.burst) return;
      const view = this.views[cell];
      if (view && !this.tweens.isTweening(view)) view.setScale(scale);
    });
  }

  private addNote(label: string): void {
    addText(this, GAME_WIDTH / 2, this.boardTop + BOARD_HEIGHT + RIM_LIP + 5, label, {
      size: FONT_SIZE.small,
      color: LOOK.text.note,
      originX: 0.5,
    }).setDepth(DEPTH.board);
  }

  private showHints(): void {
    const top = this.boardTop - TOP_ROOM + 8;
    this.hints = [
      addText(this, GAME_WIDTH / 2, top, '이웃한 조각을 끌어서 자리를 바꿔요', {
        color: LOOK.text.hint,
        originX: 0.5,
        stroke: LOOK.text.outline,
      }),
      addText(this, GAME_WIDTH / 2, top + 17, '같은 조각 셋이 나란하면 사라져요', {
        color: LOOK.text.hintSub,
        originX: 0.5,
        stroke: LOOK.text.outline,
      }),
    ];
    for (const hint of this.hints) hint.setDepth(DEPTH.hint);
  }

  private hideHints(): void {
    if (this.hints.length === 0) return;
    this.tweens.add({ targets: this.hints, alpha: 0, duration: 400 });
    this.hints = [];
  }

  // ───────── 단계의 목표 ─────────

  /** 판 위에 모아야 하는 조각과 남은 수를 늘어놓는다. */
  private createGoals(): void {
    const run = this.run;
    if (!run) return;
    this.collected = [...run.collected];
    const count = run.plan.goals.length;
    const width = count * GOAL_WIDTH + 12;
    const left = (GAME_WIDTH - width) / 2;
    const top = this.boardTop - TOP_ROOM + (TOP_ROOM - GOAL_HEIGHT - 3) / 2;
    const panel = this.add.graphics().setDepth(DEPTH.board);
    drawPanel(panel, left, top, width, GOAL_HEIGHT, { fill: THEME.card, shadow: THEME.shadow, radius: 12, depth: 3 });

    this.goals = run.plan.goals.map((goal, index) => {
      const x = left + 6 + index * GOAL_WIDTH;
      const y = top + GOAL_HEIGHT / 2;
      const icon = this.add
        .image(x + 14, y, pieceTexture(this, goal.kind, false))
        .setScale(GOAL_SCALE)
        .setDepth(DEPTH.board + 1);
      const label = addText(this, x + 27, y, String(goal.count), {
        color: LOOK.text.goal,
        originY: 0.5,
      }).setDepth(DEPTH.board + 1);
      const done = this.add
        .graphics()
        .setPosition(x + 35, y)
        .setDepth(DEPTH.board + 1)
        .setVisible(false);
      drawDone(done);
      return { kind: goal.kind, count: goal.count, icon, label, done, shown: goal.count };
    });
  }

  /** 목표의 남은 수를 지금까지 모은 것에 맞춘다. 줄어든 목표는 톡 튄다. */
  private refreshGoals(): void {
    for (const goal of this.goals) {
      const left = Math.max(0, goal.count - (this.collected[goal.kind] ?? 0));
      if (left === goal.shown) continue;
      goal.shown = left;
      goal.label.setText(String(left)).setVisible(left > 0);
      goal.done.setVisible(left === 0);
      this.tweens.killTweensOf(goal.icon);
      this.tweens.add({
        targets: goal.icon,
        scale: { from: GOAL_SCALE * 1.35, to: GOAL_SCALE },
        duration: 180,
        ease: 'Quad.Out',
      });
      if (left === 0) {
        sfx.coin();
        this.tweens.add({ targets: goal.done, scale: { from: 0.3, to: 1 }, duration: 200, ease: 'Back.Out' });
      }
    }
  }

  private showMoves(bounce: boolean): void {
    if (this.run) this.hud.setSide(`횟수 ${this.run.movesLeft}`, bounce);
  }

  // ───────── 입력 ─────────

  private bindInput(): void {
    const onDown = (pointer: Phaser.Input.Pointer): void => {
      if (!this.playing || this.phase !== 'idle') return;
      const cell = this.cellAt(pointer.worldX, pointer.worldY);
      if (cell === null) {
        this.select(null);
        return;
      }
      this.wake();
      this.touch = { id: pointer.id, cell, x: pointer.worldX, y: pointer.worldY, used: false };
      // 조각을 고른 뒤 이웃한 조각을 누르면 바꾼다. 끌기 어려운 사람은 두 번 눌러서 한다.
      if (this.selected !== null && areAdjacent(this.selected, cell)) {
        const from = this.selected;
        this.touch.used = true;
        this.trySwap(from, cell);
        return;
      }
      this.select(this.selected === cell ? null : cell);
      sfx.click();
    };
    // 손가락을 떼기를 기다리지 않고, 충분히 끈 순간에 바로 바꾼다.
    const onMove = (pointer: Phaser.Input.Pointer): void => {
      const touch = this.touch;
      if (!touch || touch.used || touch.id !== pointer.id || !pointer.isDown) return;
      if (!this.playing || this.phase !== 'idle') return;
      const dx = pointer.worldX - touch.x;
      const dy = pointer.worldY - touch.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < DRAG_DISTANCE) return;
      const direction: Direction =
        Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
      touch.used = true;
      const other = neighbourOf(touch.cell, direction);
      if (other !== null) this.trySwap(touch.cell, other);
    };
    const onUp = (pointer: Phaser.Input.Pointer): void => {
      if (this.touch?.id === pointer.id) this.touch = null;
    };
    const onPause = (): void => {
      this.touch = null;
      // 일시정지한 동안 시간을 들이지 않고 판을 궁리할 수 없게 조각을 가린다.
      // 끝난 뒤 결과 화면이 뜰 때와, 시간을 재지 않는 단계 모드에서는 가리지 않는다.
      if (this.playing && this.stageLevel === null) this.pieceLayer.setVisible(false);
    };
    const onResume = (): void => {
      this.touch = null;
      this.pieceLayer.setVisible(true);
    };

    this.input.on(Phaser.Input.Events.POINTER_DOWN, onDown);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, onMove);
    this.input.on(Phaser.Input.Events.POINTER_UP, onUp);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, onUp);
    this.events.on(Phaser.Scenes.Events.PAUSE, onPause);
    this.events.on(Phaser.Scenes.Events.RESUME, onResume);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.off(Phaser.Input.Events.POINTER_DOWN, onDown);
      this.input.off(Phaser.Input.Events.POINTER_MOVE, onMove);
      this.input.off(Phaser.Input.Events.POINTER_UP, onUp);
      this.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, onUp);
      this.events.off(Phaser.Scenes.Events.PAUSE, onPause);
      this.events.off(Phaser.Scenes.Events.RESUME, onResume);
    });
  }

  /** 고른 칸을 바꾼다. null이면 고른 것을 푼다. */
  private select(cell: number | null): void {
    this.selected = cell;
    if (cell === null) {
      this.selection.setVisible(false);
      return;
    }
    const { x, y } = this.centerOf(cell);
    this.selection.setPosition(x, y).setVisible(true);
  }

  /** 무언가를 했다: 기다리던 시간을 처음부터 다시 재고, 흔들어 알려 주던 것을 멈춘다. */
  private wake(): void {
    this.idle = 0;
    const hinted = this.hinted;
    if (!hinted) return;
    this.hinted = null;
    for (const cell of [hinted.a, hinted.b]) {
      const view = this.views[cell];
      if (!view) continue;
      this.tweens.killTweensOf(view);
      const { x, y } = this.centerOf(cell);
      view.setPosition(x, y);
    }
  }

  /** 바꿀 수 있는 자리 하나를 골라 두 조각을 서로에게 살짝 다가가게 흔든다. */
  private showMoveHint(): void {
    this.wake();
    this.idle = HINT_SECONDS - HINT_REPEAT_SECONDS;
    const moves = findMoves(this.board);
    if (moves.length === 0) return;
    const move = moves[Math.floor(moves.length / 2)];
    this.hinted = move;
    const a = this.centerOf(move.a);
    const b = this.centerOf(move.b);
    const nudge = (cell: number, from: { x: number; y: number }, to: { x: number; y: number }): void => {
      const view = this.views[cell];
      if (!view) return;
      this.tweens.add({
        targets: view,
        x: from.x + Math.sign(to.x - from.x) * HINT_NUDGE,
        y: from.y + Math.sign(to.y - from.y) * HINT_NUDGE,
        duration: 170,
        ease: 'Sine.InOut',
        yoyo: true,
        repeat: 1,
      });
    };
    nudge(move.a, a, b);
    nudge(move.b, b, a);
  }

  // ───────── 한 차례 ─────────

  /** 두 칸의 조각을 맞바꿔 본다. 맞는 줄이 생기지 않으면 되돌아온다. */
  private trySwap(a: number, b: number): void {
    if (!this.playing || this.phase !== 'idle' || !areAdjacent(a, b)) return;
    this.wake();
    this.select(null);
    if (this.gate.start()) this.hideHints();
    this.phase = 'busy';

    const first = this.views[a];
    const second = this.views[b];
    const at = this.centerOf(a);
    const to = this.centerOf(b);
    const slide = (view: Phaser.GameObjects.Image | null, x: number, y: number, back: boolean): void => {
      if (!view) return;
      view.setScale(1);
      this.tweens.add({ targets: view, x, y, duration: SWAP_MS, ease: 'Quad.Out', yoyo: back });
    };

    const turn = playSwap(this.board, a, b, this.kinds, this.random);
    if (!turn) {
      // 맞는 줄이 생기지 않는다: 갔다가 제자리로 돌아온다. 단계 모드의 횟수도 줄지 않는다.
      // 돌아오는 동안 손은 먹지 않지만 점수 도전의 시계는 흐른다.
      this.phase = 'bounce';
      slide(first, to.x, to.y, true);
      slide(second, at.x, at.y, true);
      sfx.deny();
      this.time.delayedCall(SWAP_MS * 2 + 20, () => {
        this.syncViews();
        this.backToIdle();
      });
      return;
    }

    slide(first, to.x, to.y, false);
    slide(second, at.x, at.y, false);
    sfx.flip();
    this.views[a] = second;
    this.views[b] = first;
    [this.board[a], this.board[b]] = [this.board[b], this.board[a]];
    if (this.run) {
      this.run = { ...this.run, movesLeft: Math.max(0, this.run.movesLeft - 1) };
      this.showMoves(true);
    }
    this.time.delayedCall(SWAP_MS, () => this.playStep(turn, 0));
  }

  /** 연쇄의 한 걸음을 보여 준다: 맞은 조각이 사라지고, 위의 조각이 떨어지고, 새 조각이 들어온다. */
  private playStep(turn: Turn, index: number): void {
    const step = turn.steps[index];
    if (!step) {
      this.finishTurn(turn);
      return;
    }

    const gone = [...step.matched, ...step.blasted];
    this.popCells(step, gone);
    this.reward(step, gone);
    this.time.delayedCall(POP_MS, () => {
      const fallMs = this.dropPieces(step);
      this.time.delayedCall(fallMs + STEP_GAP_MS, () => {
        this.board = [...step.board];
        this.syncViews();
        this.playStep(turn, index + 1);
      });
    });
  }

  /** 사라지는 조각을 터뜨린다. 폭죽이 생기는 칸의 조각은 사라지는 대신 폭죽으로 바뀐다. */
  private popCells(step: Step, gone: readonly number[]): void {
    const made = new Map(step.made.map((burst) => [burst.cell, burst.kind]));
    for (const cell of step.detonated) this.flashLines(cell);
    for (const cell of gone) {
      const view = this.views[cell];
      const { x, y } = this.centerOf(cell);
      this.sparks.explode(2, x, y);
      if (!view) continue;
      this.tweens.killTweensOf(view);
      const kind = made.get(cell);
      if (kind !== undefined) {
        view.setTexture(pieceTexture(this, kind, true)).setPosition(x, y);
        this.tweens.add({ targets: view, scale: { from: 1.45, to: 1 }, duration: POP_MS + 60, ease: 'Back.Out' });
        continue;
      }
      this.views[cell] = null;
      this.tweens.add({
        targets: view,
        scale: 0.1,
        alpha: 0,
        duration: POP_MS,
        ease: 'Back.In',
        onComplete: () => this.dropView(view),
      });
    }
  }

  /** 폭죽이 터진 칸의 가로줄과 세로줄을 금색 띠로 잠깐 밝힌다. */
  private flashLines(cell: number): void {
    const { x, y } = this.centerOf(cell);
    const left = BOARD_LEFT + RIM;
    const top = this.boardTop + RIM;
    const beam = this.add.graphics().setDepth(DEPTH.effect);
    beam.fillStyle(LOOK.beam, 0.75);
    beam.fillRoundedRect(left, y - 7, COLS * CELL, 14, 7);
    beam.fillRoundedRect(x - 7, top, 14, ROWS * CELL, 7);
    this.tweens.add({
      targets: beam,
      alpha: 0,
      duration: POP_MS + 120,
      ease: 'Quad.In',
      onComplete: () => beam.destroy(),
    });
  }

  /** 걸음 하나의 점수와 모은 조각을 반영하고, 소리와 글자로 알려 준다. */
  private reward(step: Step, gone: readonly number[]): void {
    this.popped += gone.length;
    this.bursts += step.detonated.length;
    this.longest = Math.max(this.longest, step.chain);

    if (step.detonated.length > 0) {
      sfx.whoosh();
      vibrate(25);
    } else if (step.made.length > 0) {
      sfx.gold();
      vibrate(15);
    } else {
      sfx.hit(step.chain);
    }

    // 사라진 조각들의 한가운데에 점수를 띄운다.
    const center = gone.reduce(
      (sum, cell) => {
        const { x, y } = this.centerOf(cell);
        return { x: sum.x + x / gone.length, y: sum.y + y / gone.length };
      },
      { x: 0, y: 0 },
    );
    if (this.run) {
      for (const cell of gone) {
        const kind = this.board[cell]?.kind;
        if (kind !== undefined) this.collected[kind] = (this.collected[kind] ?? 0) + 1;
      }
      this.refreshGoals();
      if (step.chain >= 2) {
        floatText(this, center.x, center.y, `${step.chain}연쇄!`, LOOK.text.chain, this.bounds, DEPTH.effect);
      }
      return;
    }
    this.score += step.points;
    this.hud.setScore(this.score);
    const label = step.chain >= 2 ? `${step.chain}연쇄 +${step.points}` : `+${step.points}`;
    floatText(this, center.x, center.y, label, LOOK.text.points, this.bounds, DEPTH.effect);
    if (this.longest >= 2) this.hud.setSide(`연쇄 ${this.longest}`, step.chain === this.longest && step.chain >= 2);
  }

  /** 빈칸 위의 조각을 떨어뜨리고 새 조각을 위에서 들여보낸다. 다 떨어지는 데 걸리는 시간(ms)을 돌려준다. */
  private dropPieces(step: Step): number {
    let longest = 0;
    const fall = (view: Phaser.GameObjects.Image, cell: number, rows: number, fadeIn: boolean): void => {
      const { x, y } = this.centerOf(cell);
      const duration = DROP_BASE_MS + DROP_CELL_MS * rows;
      longest = Math.max(longest, duration);
      // 새 조각은 판 위쪽 바깥에서 오므로, 판의 맨 윗줄에 들어설 때 서서히 보이게 한다.
      const edge = this.boardTop + RIM;
      this.tweens.add({
        targets: view,
        y,
        duration,
        ease: 'Quad.In',
        onUpdate: fadeIn ? () => view.setAlpha(Phaser.Math.Clamp((view.y - edge + CELL / 2) / CELL, 0, 1)) : undefined,
        onComplete: () => view.setPosition(x, y).setAlpha(1),
      });
    };

    const moving = new Map<number, Phaser.GameObjects.Image>();
    for (const drop of step.drops) {
      const view = this.views[drop.from];
      if (!view) continue;
      moving.set(drop.to, view);
      this.views[drop.from] = null;
    }
    for (const [cell, view] of moving) {
      const rows = Math.round((this.centerOf(cell).y - view.y) / CELL);
      this.views[cell] = view;
      view.setScale(1);
      fall(view, cell, Math.max(1, rows), false);
    }
    for (const spawn of step.spawns) {
      const view = this.takeView(spawn.piece);
      const { x, y } = this.centerOf(spawn.cell);
      view.setPosition(x, y - spawn.above * CELL).setAlpha(0);
      this.views[spawn.cell] = view;
      fall(view, spawn.cell, spawn.above, true);
    }
    if (step.drops.length + step.spawns.length > 0) sfx.land();
    return longest;
  }

  /** 연쇄가 모두 끝났다: 돌려받은 시간을 더하고, 섞였으면 섞고, 판이 끝났는지 본다. */
  private finishTurn(turn: Turn): void {
    if (this.run) {
      // 걸음마다 세어 온 것과 어긋나지 않게, 차례가 끝나면 규칙이 센 값으로 맞춘다.
      const moved = { ...this.run, movesLeft: this.run.movesLeft + 1 };
      this.run = afterTurn(moved, turn);
      this.collected = [...this.run.collected];
      this.refreshGoals();
    } else {
      const back = secondsBack(turn);
      if (back > 0) {
        this.timeLeft = Math.min(START_SECONDS, this.timeLeft + back);
        this.hud.setTime(this.timeLeft, START_SECONDS);
        this.showBonus(back);
      }
    }
    if (chainOf(turn) >= 3) vibrate([15, 25, 15]);

    const shuffle = turn.shuffle;
    // 단계를 이미 깼거나 횟수가 끝났으면 섞을 것 없이 끝낸다.
    const ending = this.run !== null && (isLevelCleared(this.run) || isLevelFailed(this.run));
    if (!shuffle || ending) {
      this.board = [...turn.board];
      if (!ending) this.syncViews();
      this.endTurn();
      return;
    }

    // 바꿀 수 있는 자리가 없다: 조각을 섞는다.
    showBanner(this, this.boardCenterY(), '섞을게요!', LOOK.text.good, 700, DEPTH.banner, FONT_SIZE.large);
    sfx.pour();
    const before = this.views;
    this.views = shuffle.from.map((from) => before[from]);
    this.views.forEach((view, cell) => {
      if (!view) return;
      const { x, y } = this.centerOf(cell);
      this.tweens.add({ targets: view, x, y, duration: SHUFFLE_MS, ease: 'Cubic.InOut' });
    });
    this.time.delayedCall(SHUFFLE_MS + 40, () => {
      this.board = [...turn.board];
      this.syncViews();
      this.endTurn();
    });
  }

  /** 한 차례가 끝났다. 단계 모드는 깼는지와 횟수가 남았는지를 본다. */
  private endTurn(): void {
    const run = this.run;
    if (run && isLevelCleared(run)) {
      this.endStage(true);
      return;
    }
    if (run && isLevelFailed(run)) {
      this.endStage(false);
      return;
    }
    this.backToIdle();
  }

  private backToIdle(): void {
    if (this.phase === 'over') return;
    this.phase = 'idle';
    this.idle = 0;
  }

  /** 시간을 돌려받았다는 것을 판 위에 띄운다. */
  private showBonus(seconds: number): void {
    const text = addText(this, GAME_WIDTH / 2, this.boardTop - 6, `+${seconds}초`, {
      size: FONT_SIZE.large,
      color: LOOK.text.bonus,
      originX: 0.5,
      originY: 1,
      stroke: LOOK.text.outline,
    }).setDepth(DEPTH.effect);
    this.tweens.add({ targets: text, scale: { from: 0.6, to: 1 }, duration: 160, ease: 'Back.Out' });
    this.tweens.add({
      targets: text,
      y: text.y - 10,
      alpha: 0,
      delay: 380,
      duration: 340,
      ease: 'Quad.In',
      onComplete: () => text.destroy(),
    });
  }

  /** 마지막 몇 초는 1초마다 째깍 소리로 알린다. */
  private tickLastSeconds(): void {
    const second = Math.ceil(this.timeLeft);
    if (second > TICK_FROM_SECONDS) {
      // 시간을 돌려받아 다시 넉넉해졌으면, 다음에 줄어들 때 처음부터 알린다.
      this.lastTick = 0;
      return;
    }
    if (second === this.lastTick || second <= 0) return;
    this.lastTick = second;
    sfx.tick();
  }

  // ───────── 끝 ─────────

  private stop(): void {
    this.playing = false;
    this.phase = 'over';
    this.touch = null;
    this.wake();
    this.select(null);
  }

  /** 점수 도전: 시간이 다 됐다. */
  private endRun(): void {
    if (!this.playing) return;
    this.stop();
    showBanner(this, this.boardCenterY(), '시간 끝!', LOOK.text.over, 900, DEPTH.banner);
    vibrate([20, 40, 20]);
    this.finishMiniGame(this.score, [
      ['맞춘 조각', `${this.popped}개`],
      ['가장 긴 연쇄', `${this.longest}연쇄`],
      ['터뜨린 폭죽', `${this.bursts}개`],
    ]);
  }

  /** 단계 모드: 목표를 다 모았거나 횟수가 끝났다. */
  private endStage(cleared: boolean): void {
    const run = this.run;
    if (!this.playing || !run) return;
    this.stop();
    const gathered = run.plan.goals.reduce((sum, goal) => sum + goal.count - goalLeft(run, goal), 0);
    const wanted = run.plan.goals.reduce((sum, goal) => sum + goal.count, 0);
    const stats: ResultStat[] = [
      ['모은 조각', `${gathered}/${wanted}개`],
      ['남은 횟수', `${run.movesLeft}번`],
    ];
    if (!cleared) {
      showBanner(this, this.boardCenterY(), '횟수 끝!', LOOK.text.over, 900, DEPTH.banner);
      vibrate([20, 40, 20]);
      this.finishStage(false, stats);
      return;
    }
    sfx.gold();
    vibrate([15, 30, 15]);
    this.sparks.explode(22, GAME_WIDTH / 2, this.boardCenterY());
    showBanner(this, this.boardCenterY(), '클리어!', LOOK.text.good, 900, DEPTH.banner);
    this.finishStage(true, stats, 1000);
  }
}
