import Phaser from 'phaser';
import { TEXTURE } from '../../art/sprites';
import { GAME_WIDTH, SCENE } from '../../config';
import { vibrate } from '../../core/haptics';
import { sfx, tone } from '../../core/sfx';
import { store } from '../../core/store';
import { addBackdrop, addText } from '../../core/ui';
import { GameHud, HUD_HEIGHT, showBanner } from '../../scenes/GameHud';
import { MiniGameScene } from '../../scenes/MiniGameScene';
import {
  dotRadius,
  drawBoard,
  drawDot,
  drawFinger,
  drawLeftover,
  drawRibbonEdge,
  drawRibbonFace,
  drawRibbonHead,
  drawRibbonMarks,
  fillCell,
  ghostLook,
  LOOK,
  pairLook,
  ribbonWidth,
  RIM,
  type PairLook,
  type Point,
} from './art';
import {
  boardLayout,
  cellAt,
  cellOf,
  claimClear,
  coveredCount,
  dragTo,
  elapse,
  endStroke,
  finalScore,
  isLinked,
  isOver,
  isSolved,
  levelPuzzle,
  levelStage,
  linkedCount,
  newRun,
  nextStage,
  openCells,
  pendingPoints,
  puzzleRun,
  START_SECONDS,
  startStroke,
  stickyCellAt,
  type Area,
  type Board,
  type BoardLayout,
  type ClearReward,
  type Path,
  type Puzzle,
  type RunState,
} from './rules';

// ───────── 자리 ─────────

/** 판 위에 도움말 두 줄이나 알림 한 줄이 들어갈 자리의 높이 */
const HINT_ROOM = 42;
/** 판 아래에 이은 쌍과 채운 칸을 적는 자리의 높이 */
const STATUS_ROOM = 34;
/** 도움말 두 줄의 줄 간격과, 판의 테두리에서 띄우는 거리 */
const HINT_LINE = 16;
const HINT_GAP = 5;
/** 판의 테두리(그림자 포함) 아래에서 상태 글자의 가운데까지 */
const STATUS_OFFSET = 15;

// ───────── 그리기 ─────────

/**
 * 손가락이 있는 칸을 옮길 때, 칸의 경계를 이만큼(칸 크기에 대한 비율) 넘어야 옆 칸으로 넘어간 것으로 본다.
 * 경계에 걸친 손가락이 조금 떨려도 길이 왔다 갔다 하지 않는다.
 */
const STICKY_RATIO = 0.1;
/** 판 밖으로 이만큼(칸 크기에 대한 비율) 나간 데까지는 가장자리 칸에 있는 것으로 친다. */
const REACH_RATIO = 0.9;
/**
 * 손가락이 한 번에 멀리 움직였으면 그 사이를 이 간격(칸 크기에 대한 비율)으로 잘라서 지나간 칸을 찾는다.
 * 빠르게 그어도 길이 끊기지 않는다.
 */
const SAMPLE_RATIO = 0.25;
/** 그리는 동안 손가락 둘레에 깔리는 동그라미. 손가락에 가려도 지금 어느 색을 그리는지 보인다. */
const HALO = { extra: 15, alpha: 0.3 } as const;

// ───────── 움직임과 시간 ─────────

/** 새 판이 나타나는 시간(ms). 이동안은 그릴 수 없다. */
const DEAL_MS = 200;
/** 판을 깬 뒤 "클리어!"가 뜨기까지, 그리고 다음 판이 깔리기까지(ms). 그동안 시간은 멈춘다. */
const CLEAR_BANNER_MS = 200;
const NEXT_BOARD_MS = 1150;
/** "클리어!" 아래에 적는 "+점수 +시간" 한 줄: 큰 글자에서 내려온 거리와 글자 뒤에 까는 알약 모양 바탕 */
const BONUS = { offsetY: 32, height: 18, padding: 9, alpha: 0.92 } as const;
/** 첫 판에서 아무것도 누르지 않아도 이 시간이 지나면 시계가 가기 시작한다(초). 도움말을 읽을 틈이다. */
const AUTO_START_SECONDS = 4;
/** 일시정지에서 돌아온 뒤 다시 시간이 흐르기까지의 여유(초). 가려져 있던 판을 다시 볼 틈을 준다. */
const RESUME_GRACE_SECONDS = 0.6;
/** 남은 시간이 이 아래로 내려가면 1초마다 소리로 알린다 */
const TICK_FROM_SECONDS = 5;

const HINT_LINES = ['같은 모양끼리 선으로 이어요', '선이 겹치지 않게 모든 칸을 채워요'] as const;
const LEFTOVER_NOTICE = '빈칸이 남았어요';

/** 판은 깊이를 따로 주지 않고 만든 순서대로 겹친다. */
const DEPTH = { effect: 20, hud: 30, banner: 40 } as const;

/** 길이 한 칸 늘거나 줄 때 내는 음: 길어질수록 다섯 음 음계를 따라 올라간다. */
const STEP_NOTES = [0, 2, 4, 7, 9] as const;
const STEP_TOP = 9;

function playStep(length: number): void {
  const index = Math.min(Math.max(0, length - 2), STEP_TOP);
  const semitone = STEP_NOTES[index % STEP_NOTES.length] + 12 * Math.floor(index / STEP_NOTES.length);
  tone(392 * 2 ** (semitone / 12), 0.045, { type: 'triangle', volume: 0.22 });
}

/** 손가락 하나가 길을 그리는 동안의 기록 */
interface Stroke {
  pointerId: number;
  /** 그리는 쌍 */
  pair: number;
  /** 손가락이 있는 칸 */
  cell: number;
  /** 마지막으로 본 손가락의 자리 */
  x: number;
  y: number;
  /** 누르기 전에 이 쌍의 길이 있었는지. 점을 눌렀다 떼서 길을 지웠을 때 소리를 내는 데 쓴다. */
  hadPath: boolean;
  /**
   * 누르기 전의 길들. 남의 길을 스쳐서 잘랐더라도 손가락을 떼기 전에 되돌아오면 이것으로 되살린다.
   * 손가락을 떼면 그때의 모습으로 굳는다.
   */
  restore: readonly Path[];
  /**
   * 길 가운데를 눌렀을 때, 손가락이 다른 칸으로 움직이면 쓸 판(누른 칸 뒤쪽을 잘라 낸 판).
   * 움직이지 않고 떼면 쓰지 않으므로, 잘못 눌러도 그려 둔 길이 사라지지 않는다. 점을 눌렀으면 null이다.
   */
  pending: Board | null;
}

/**
 * 단계 모드에서 가장 최근에 만든 문제. 단계 모드의 문제는 단계 번호로 정해져서 다시 만들어도 똑같은 문제가 나오는데,
 * 만드는 데 시간이 걸린다(판 여럿을 만들어 그 가운데 하나를 고르느라, 느린 기기에서는 반 초쯤 화면이 멈춘다).
 * 그래서 같은 단계를 다시 할 때는 만들어 둔 것을 그대로 쓴다. 문제는 바뀌지 않는 값이라(길을 그릴 때마다 새 판을 만든다) 다시 써도 된다.
 */
let lastLevelPuzzle: { level: number; puzzle: Puzzle } | null = null;

/**
 * 길 잇기: 같은 모양의 점 두 개를 선으로 잇는다. 선끼리 겹칠 수 없고, 모든 쌍을 이으면서
 * 판의 모든 칸을 채워야 판을 깬다. 시간 안에 판을 깨면 시간을 돌려받고 더 큰 판이 나온다.
 * 규칙은 rules.ts에, 그림은 art.ts에 있고 이 씬은 입력과 진행만 맡는다.
 */
export class PathLinkScene extends MiniGameScene {
  protected readonly gameId = 'path-link';

  private run!: RunState;
  private layout: BoardLayout = { cell: 0, left: 0, top: 0 };
  private stroke: Stroke | null = null;
  /** 색 구분 도우미가 켜져 있는지. 판을 시작할 때 설정에서 읽는다. */
  private assist = false;
  /** 시계가 가기 시작했는지. 처음 판을 누를 때, 또는 조금 기다리면 시작한다. */
  private started = false;
  private waited = 0;
  /** 0보다 크면 일시정지에서 막 돌아와 잠깐 멈춰 있는 중 */
  private grace = 0;
  private lastTickSecond = 0;
  /** 쌍마다 두 점의 그림 */
  private dots: Phaser.GameObjects.Graphics[][] = [];
  /** 판 위에 떠 있는 도움말 줄들 */
  private hints: Phaser.GameObjects.Text[] = [];
  /** 빈칸이 남았다는 알림이 떠 있는지 */
  private leftoverShown = false;
  /** 그리는 법을 보여 주는 움직임의 진행. 보여 주지 않을 때는 null이다. */
  private demo: { step: number } | null = null;
  /** 지금 들썩이고 있는 짝 점 */
  private beacon: Phaser.GameObjects.Graphics | null = null;

  private hud!: GameHud;
  /** 판 전체를 담는 그릇. 원점은 판의 한가운데다. */
  private boardBox!: Phaser.GameObjects.Container;
  private card!: Phaser.GameObjects.Graphics;
  /** 점과 길을 담는 층. 일시정지 중에 통째로 가린다. */
  private inkLayer!: Phaser.GameObjects.Container;
  private fills!: Phaser.GameObjects.Graphics;
  private ribbons!: Phaser.GameObjects.Graphics;
  private dotLayer!: Phaser.GameObjects.Container;
  private leftover!: Phaser.GameObjects.Graphics;
  /** 그리는 법을 보여 주는 옅은 길(점 아래)과 손가락(점 위) */
  private demoView!: Phaser.GameObjects.Graphics;
  private fingerView!: Phaser.GameObjects.Graphics;
  private halo!: Phaser.GameObjects.Graphics;
  private notice!: Phaser.GameObjects.Text;
  private pairsLabel!: Phaser.GameObjects.Text;
  private cellsLabel!: Phaser.GameObjects.Text;
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor() {
    super(SCENE.pathLink);
  }

  create(): void {
    this.beginMiniGame();
    this.resetState();
    this.assist = store.data.settings.colorAssist;

    addBackdrop(this);
    this.card = this.add.graphics();
    this.fills = this.add.graphics();
    this.ribbons = this.add.graphics();
    this.demoView = this.add.graphics();
    this.dotLayer = this.add.container(0, 0);
    this.leftover = this.add.graphics().setVisible(false);
    this.fingerView = this.add.graphics();
    this.halo = this.add.graphics().setVisible(false);
    this.inkLayer = this.add.container(0, 0, [
      this.fills,
      this.ribbons,
      this.demoView,
      this.dotLayer,
      this.leftover,
      this.fingerView,
      this.halo,
    ]);
    this.boardBox = this.add.container(0, 0, [this.card, this.inkLayer]);
    this.sparks = this.add
      .particles(0, 0, TEXTURE.spark, {
        speed: { min: 40, max: 130 },
        lifespan: { min: 200, max: 420 },
        alpha: { start: 1, end: 0 },
        tint: [...LOOK.sparks.clear],
        emitting: false,
      })
      .setDepth(DEPTH.effect);
    this.createLabels();

    this.addPauseButton();
    this.hud = new GameHud(this, DEPTH.hud);
    if (this.stageLevel !== null) this.hud.showStage(this.stageLevel);
    this.hud.setTime(START_SECONDS, START_SECONDS);

    this.bindInput();
    this.dealBoard();
  }

  override update(_time: number, deltaMs: number): void {
    // 단계 모드는 시간을 재지 않는다.
    if (!this.playing || this.stageLevel !== null) return;
    // 탭이 가려졌다 돌아와도 시간이 한꺼번에 흐르지 않게 한 프레임의 길이를 제한한다.
    const dt = Math.min(deltaMs, 100) / 1000;
    if (this.grace > 0) {
      this.grace -= dt;
      return;
    }
    if (!this.started) {
      this.waited += dt;
      if (this.waited >= AUTO_START_SECONDS) this.started = true;
      return;
    }

    this.run = elapse(this.run, dt);
    this.hud.setTime(this.run.timeLeft, START_SECONDS);
    if (isOver(this.run)) {
      this.endRun();
      return;
    }
    const remaining = Math.ceil(this.run.timeLeft);
    if (remaining > TICK_FROM_SECONDS) {
      // 시간을 돌려받아 다시 넉넉해졌으면, 다음에 줄어들 때 처음부터 알린다.
      this.lastTickSecond = 0;
    } else if (remaining !== this.lastTickSecond) {
      this.lastTickSecond = remaining;
      sfx.tick();
    }
  }

  /** 단계 모드의 그 단계의 문제. 방금 한 단계를 다시 하는 것이면 만들어 둔 문제를 그대로 준다. */
  private levelPuzzle(level: number): Puzzle {
    if (lastLevelPuzzle?.level !== level) lastLevelPuzzle = { level, puzzle: levelPuzzle(level, this.levelRandom()) };
    return lastLevelPuzzle.puzzle;
  }

  private resetState(): void {
    this.run = this.stageLevel === null ? newRun(Math.random) : puzzleRun(this.levelPuzzle(this.stageLevel));
    this.layout = { cell: 0, left: 0, top: 0 };
    this.stroke = null;
    this.started = false;
    this.waited = 0;
    this.grace = 0;
    this.lastTickSecond = 0;
    this.dots = [];
    this.hints = [];
    this.leftoverShown = false;
    this.demo = null;
    this.beacon = null;
  }

  // ───────── 화면 구성 ─────────

  /** 판이 들어갈 자리: HUD와 도움말 아래, 상태 글자 위 */
  private boardArea(): Area {
    const top = HUD_HEIGHT + HINT_ROOM;
    return { x: 0, y: top, width: GAME_WIDTH, height: this.scale.height - top - STATUS_ROOM };
  }

  /** 판 위의 알림과 판 아래의 상태 글자를 만든다. 자리는 판을 깔 때 맞춘다. */
  private createLabels(): void {
    this.notice = addText(this, GAME_WIDTH / 2, 0, LEFTOVER_NOTICE, {
      color: LOOK.text.notice,
      originX: 0.5,
      originY: 0.5,
      stroke: LOOK.text.outline,
    })
      .setDepth(DEPTH.hud)
      .setVisible(false);
    this.pairsLabel = addText(this, 0, 0, '', {
      color: LOOK.text.status,
      originY: 0.5,
      stroke: LOOK.text.outline,
    });
    this.cellsLabel = addText(this, 0, 0, '', {
      color: LOOK.text.status,
      originX: 1,
      originY: 0.5,
      stroke: LOOK.text.outline,
    });
  }

  /** 판의 위쪽 끝(테두리 포함) */
  private get boardTop(): number {
    return this.layout.top - RIM;
  }

  private get boardSpan(): number {
    return this.run.board.puzzle.size * this.layout.cell;
  }

  private showHints(): void {
    this.clearHints();
    const top = this.boardTop - HINT_GAP - HINT_LINE * HINT_LINES.length;
    this.hints = HINT_LINES.map((line, index) =>
      addText(this, GAME_WIDTH / 2, top + index * HINT_LINE, line, {
        color: index === 0 ? LOOK.text.hint : LOOK.text.hintSub,
        originX: 0.5,
        stroke: LOOK.text.outline,
      }).setDepth(DEPTH.hud),
    );
  }

  private clearHints(): void {
    for (const line of this.hints) line.destroy();
    this.hints = [];
  }

  // ───────── 판 깔기 ─────────

  /** 지금 판을 새로 깐다. 다 나타나면 그릴 수 있고 시간이 흐른다. */
  private dealBoard(): void {
    const { board, stage } = this.run;
    const { size, dots } = board.puzzle;
    this.layout = boardLayout(size, this.boardArea());
    const { cell, left, top } = this.layout;
    const span = size * cell;

    this.beacon = null;
    this.dotLayer.removeAll(true);
    this.setLeftover(false);
    this.boardBox.setPosition(left + span / 2, top + span / 2);
    drawBoard(this.card, size, cell);
    this.dots = dots.map((ends, pair) =>
      ends.map((dotCell) => {
        const spot = this.spotOf(dotCell);
        const dot = this.add.graphics().setPosition(spot.x, spot.y);
        drawDot(dot, pairLook(pair), dotRadius(cell));
        this.dotLayer.add(dot);
        return dot;
      }),
    );

    const statusY = top + span + RIM + STATUS_OFFSET;
    this.notice.setY(Math.round(this.boardTop - HINT_GAP - HINT_LINE));
    this.pairsLabel.setPosition(left, Math.round(statusY));
    this.cellsLabel.setPosition(left + span, Math.round(statusY));
    this.redraw();
    this.refreshStatus();
    const level = this.stageLevel;
    if (level === null) this.hud.setSide(`${stage}판`, stage > 1);
    // 단계 모드에서는 가장 쉬운 난이도의 단계에서만 방법을 알려 준다.
    const guided = level === null ? stage === 1 : levelStage(level) === 1;

    this.tweens.add({
      targets: this.boardBox,
      scale: { from: 0.94, to: 1 },
      alpha: { from: 0, to: 1 },
      duration: DEAL_MS,
      ease: 'Back.Out',
    });
    if (guided) this.showHints();
    else if (level === null) sfx.pop();

    this.time.delayedCall(DEAL_MS, () => {
      this.playing = true;
      if (stage > 1) return;
      sfx.go();
      if (guided) this.startDemo();
    });
  }

  /** 칸의 가운데. 판 그릇 안에서의 좌표다(원점이 판의 한가운데). */
  private spotOf(cell: number): Point {
    const { size } = this.run.board.puzzle;
    const { col, row } = cellOf(size, cell);
    return {
      x: (col + 0.5 - size / 2) * this.layout.cell,
      y: (row + 0.5 - size / 2) * this.layout.cell,
    };
  }

  // ───────── 그리기 ─────────

  /** 지금 판의 길을 모두 다시 그린다. 칸이 많아야 마흔아홉이라 바뀔 때마다 통째로 그려도 가볍다. */
  private redraw(): void {
    const { board } = this.run;
    const { cell } = this.layout;
    const width = ribbonWidth(cell);
    const lines = board.paths.map((path) => path.map((at) => this.spotOf(at)));

    this.fills.clear();
    this.ribbons.clear();
    lines.forEach((points, pair) => {
      if (!isLinked(board, pair)) return;
      this.fills.fillStyle(pairLook(pair).tint, LOOK.linkedTint);
      for (const spot of points) fillCell(this.fills, spot.x, spot.y, cell);
    });
    // 테두리를 모두 그린 다음에 윗면을 그려야 옆 칸의 테두리가 윗면을 덮지 않는다.
    lines.forEach((points, pair) => {
      if (points.length >= 2) drawRibbonEdge(this.ribbons, points, width, pairLook(pair));
    });
    lines.forEach((points, pair) => {
      if (points.length >= 2) drawRibbonFace(this.ribbons, points, width, pairLook(pair));
    });
    // 색 구분 도우미: 길이 지나는 칸마다 그 쌍의 모양을 찍는다. 양 끝의 점에는 이미 모양이 있다.
    if (this.assist) {
      board.paths.forEach((path, pair) => {
        if (path.length < 2) return;
        const ends = board.puzzle.dots[pair];
        const inner = path.filter((at) => !ends.includes(at)).map((at) => this.spotOf(at));
        drawRibbonMarks(this.ribbons, inner, width, pairLook(pair));
      });
    }

    // 그리고 있는 길의 머리. 길 가운데를 누르고 아직 움직이지 않았으면 누른 칸에 둔다.
    const stroke = this.stroke;
    if (!stroke) return;
    const points = lines[stroke.pair];
    const head = stroke.pending ? this.spotOf(stroke.cell) : points[points.length - 1];
    if (head && points.length >= 2 && (stroke.pending || !isLinked(board, stroke.pair))) {
      drawRibbonHead(this.ribbons, head, width, pairLook(stroke.pair));
    }
  }

  /** 판 아래의 이은 쌍과 채운 칸을 고쳐 적고, 빈칸이 남았는지 살핀다. */
  private refreshStatus(): void {
    const { board } = this.run;
    const pairs = board.paths.length;
    const cells = board.puzzle.size ** 2;
    const linked = linkedCount(board);
    const covered = coveredCount(board);
    this.pairsLabel
      .setText(`이은 쌍 ${linked}/${pairs}`)
      .setColor(linked === pairs ? LOOK.text.statusDone : LOOK.text.status);
    this.cellsLabel
      .setText(`채운 칸 ${covered}/${cells}`)
      .setColor(covered === cells ? LOOK.text.statusDone : LOOK.text.status);
    this.setLeftover(linked === pairs && covered < cells);
  }

  /**
   * 모든 쌍을 이었는데 빈칸이 남았을 때: 판 위에 알리고, 빈칸마다 고리가 깜빡인다.
   * 모든 칸을 채워야 한다는 것은 놓치기 쉬운 규칙이라 그 순간에 바로 알려 준다.
   */
  private setLeftover(shown: boolean): void {
    if (shown === this.leftoverShown) return;
    this.leftoverShown = shown;
    this.notice.setVisible(shown);
    for (const line of this.hints) line.setVisible(!shown);
    this.tweens.killTweensOf([this.leftover, this.notice]);
    this.leftover.setVisible(shown);
    if (!shown) return;

    const spots = openCells(this.run.board).map((cell) => this.spotOf(cell));
    drawLeftover(this.leftover, spots, this.layout.cell);
    this.leftover.setAlpha(1);
    this.tweens.add({
      targets: this.leftover,
      alpha: 0.2,
      duration: 420,
      ease: 'Sine.InOut',
      yoyo: true,
      repeat: -1,
    });
    this.notice.setScale(1);
    this.tweens.add({ targets: this.notice, scale: { from: 0.7, to: 1 }, duration: 220, ease: 'Back.Out' });
    sfx.land();
    vibrate(20);
  }

  // ───────── 그리는 법 보여 주기 ─────────

  /**
   * 첫 판에서 아직 아무것도 누르지 않았을 때, 가장 짧은 길 하나를 옅은 선과 손가락으로 되풀이해 그려 보인다.
   * 판을 처음 누르면 사라진다.
   */
  private startDemo(): void {
    const { solution } = this.run.board.puzzle;
    const pair = solution.reduce((best, path, index) => (path.length < solution[best].length ? index : best), 0);
    const points = solution[pair].map((cell) => this.spotOf(cell));
    const look = ghostLook(pairLook(pair));
    const demo = { step: 0 };
    this.demo = demo;
    this.tweens.add({
      targets: demo,
      step: points.length - 1,
      duration: 360 * (points.length - 1),
      delay: 500,
      hold: 450,
      repeat: -1,
      repeatDelay: 650,
      ease: 'Sine.InOut',
      onUpdate: () => this.drawDemo(points, demo.step, look),
      onRepeat: () => this.clearDemoViews(),
    });
  }

  private drawDemo(points: readonly Point[], step: number, look: PairLook): void {
    const whole = Math.min(points.length - 1, Math.floor(step));
    const shown = points.slice(0, whole + 1);
    const next = points[whole + 1];
    if (next) {
      const from = points[whole];
      const part = step - whole;
      shown.push({ x: from.x + (next.x - from.x) * part, y: from.y + (next.y - from.y) * part });
    }
    const width = ribbonWidth(this.layout.cell);
    this.clearDemoViews();
    drawRibbonEdge(this.demoView, shown, width, look);
    drawRibbonFace(this.demoView, shown, width, look);
    drawFinger(this.fingerView, shown[shown.length - 1], this.layout.cell);
  }

  private clearDemoViews(): void {
    this.demoView.clear();
    this.fingerView.clear();
  }

  private stopDemo(): void {
    if (!this.demo) return;
    this.tweens.killTweensOf(this.demo);
    this.demo = null;
    this.clearDemoViews();
  }

  // ───────── 입력 ─────────

  private bindInput(): void {
    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    this.input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onPointerUp, this);
    // 일시정지한 동안 시간을 들이지 않고 판을 궁리할 수 없게 점과 길을 가린다.
    this.events.on(Phaser.Scenes.Events.PAUSE, this.onPause, this);
    this.events.on(Phaser.Scenes.Events.RESUME, this.onResume, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.off(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
      this.input.off(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
      this.input.off(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
      this.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onPointerUp, this);
      this.events.off(Phaser.Scenes.Events.PAUSE, this.onPause, this);
      this.events.off(Phaser.Scenes.Events.RESUME, this.onResume, this);
    });
  }

  private onPause(): void {
    this.finishStroke();
    // 끝난 뒤 결과 화면이 뜰 때는 그리던 판을 그대로 보여 준다. 시간을 재지 않는 단계 모드에서도 가리지 않는다.
    if (this.playing && this.stageLevel === null) this.inkLayer.setVisible(false);
  }

  private onResume(): void {
    this.inkLayer.setVisible(true);
    if (!this.playing || !this.started || this.stageLevel !== null) return;
    this.grace = RESUME_GRACE_SECONDS;
    showBanner(this, this.boardBox.y, '준비!', LOOK.text.ready, RESUME_GRACE_SECONDS * 1000, DEPTH.banner);
  }

  /** 점이나 길 위의 칸을 누르면 그 쌍의 길을 그리기 시작한다. */
  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    // 위쪽 HUD(일시정지 버튼)를 누른 것은 판을 누른 것이 아니다.
    if (!this.playing || this.grace > 0 || pointer.worldY < HUD_HEIGHT) return;
    // 그리던 손가락을 뗐다는 알림을 놓쳤더라도, 그리기가 끝나지 않은 채로 남아 새 입력을 막지 않게 한다.
    const drawing = this.stroke;
    if (drawing && !this.input.manager.pointers.some((held) => held.id === drawing.pointerId && held.isDown)) {
      this.finishStroke();
    }
    if (this.stroke) return;
    const { board } = this.run;
    const { size, dotAt } = board.puzzle;
    const cell = cellAt(size, this.layout, pointer.worldX, pointer.worldY);
    if (cell === null) return;

    this.started = true;
    this.stopDemo();
    const begun = startStroke(board, cell);
    if (!begun) return;

    const before = board.paths[begun.pair];
    // 점을 눌렀거나 길의 맨 끝을 눌렀으면 바로 그 판으로 바꾼다. 길 가운데를 눌렀으면 움직일 때까지 미룬다.
    const settled = dotAt[cell] >= 0 || begun.board.paths[begun.pair].length === before.length;
    this.stroke = {
      pointerId: pointer.id,
      pair: begun.pair,
      cell,
      x: pointer.worldX,
      y: pointer.worldY,
      hadPath: before.length >= 2,
      restore: board.paths,
      pending: settled ? null : begun.board,
    };
    if (settled) this.run = { ...this.run, board: begun.board };

    this.showHalo(begun.pair, pointer.worldX, pointer.worldY);
    this.syncBeacon();
    playStep(2);
    vibrate(6);
    this.redraw();
    this.refreshStatus();
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    const stroke = this.stroke;
    if (!stroke || pointer.id !== stroke.pointerId || !this.playing) return;

    // 한 번에 멀리 움직였으면 그 사이를 잘게 잘라 지나간 칸을 차례로 밟는다.
    const { size } = this.run.board.puzzle;
    const { cell } = this.layout;
    const dx = pointer.worldX - stroke.x;
    const dy = pointer.worldY - stroke.y;
    const pieces = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (cell * SAMPLE_RATIO)));
    for (let piece = 1; piece <= pieces; piece += 1) {
      const at = stickyCellAt(
        size,
        this.layout,
        stroke.x + (dx * piece) / pieces,
        stroke.y + (dy * piece) / pieces,
        stroke.cell,
        cell * STICKY_RATIO,
        cell * REACH_RATIO,
      );
      if (at === null || at === stroke.cell) continue;
      this.enterCell(stroke, at);
      // 마지막 쌍을 이어 판을 깼으면 그리기도 끝난다.
      if (this.stroke !== stroke) return;
    }
    stroke.x = pointer.worldX;
    stroke.y = pointer.worldY;
    this.moveHalo(pointer.worldX, pointer.worldY);
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    if (this.stroke?.pointerId === pointer.id) this.finishStroke();
  }

  /** 그리는 손가락이 cell 칸으로 넘어왔다. */
  private enterCell(stroke: Stroke, cell: number): void {
    stroke.cell = cell;
    const base = stroke.pending ?? this.run.board;
    const result = dragTo(base, stroke.pair, cell, stroke.restore);
    if (result.board === base) {
      // 다른 쌍의 점에 막혔으면 툭 소리로 알린다. 이어진 길 너머로 손가락이 더 나간 것은 조용히 넘긴다.
      const dot = base.puzzle.dotAt[cell];
      if (result.blocked && dot >= 0 && dot !== stroke.pair && !isLinked(base, stroke.pair)) sfx.land();
      return;
    }

    stroke.pending = null;
    this.run = { ...this.run, board: result.board };
    this.syncBeacon();
    if (result.linked) {
      this.onLinked(stroke.pair);
    } else if (result.cut.length > 0) {
      sfx.pull();
      vibrate(8);
    } else if (result.mended.length > 0) {
      sfx.pop();
    } else {
      playStep(result.board.paths[stroke.pair].length);
    }
    this.redraw();
    this.refreshStatus();
    if (isSolved(result.board)) this.onSolved();
  }

  /** 손가락을 뗐다(또는 그리기가 끊겼다). 점만 누르고 뗐으면 그 쌍의 길이 지워진다. */
  private finishStroke(): void {
    const stroke = this.stroke;
    if (!stroke) return;
    this.stroke = null;
    this.halo.setVisible(false);
    this.syncBeacon();

    const board = endStroke(this.run.board, stroke.pair);
    if (board !== this.run.board) {
      this.run = { ...this.run, board };
      if (stroke.hadPath) sfx.pull();
    }
    this.redraw();
    this.refreshStatus();
  }

  // ───────── 손가락 둘레의 동그라미 ─────────

  private showHalo(pair: number, x: number, y: number): void {
    this.halo.clear();
    this.halo.fillStyle(pairLook(pair).face, HALO.alpha);
    this.halo.fillCircle(0, 0, this.layout.cell / 2 + HALO.extra);
    this.halo.setVisible(true);
    this.moveHalo(x, y);
  }

  /** 동그라미는 손가락을 따라가되 판 밖으로 멀리 나가지는 않는다. */
  private moveHalo(x: number, y: number): void {
    const half = this.boardSpan / 2 + RIM;
    this.halo.setPosition(
      Phaser.Math.Clamp(x - this.boardBox.x, -half, half),
      Phaser.Math.Clamp(y - this.boardBox.y, -half, half),
    );
  }

  // ───────── 짝 점 알려 주기 ─────────

  /**
   * 길을 그리는 동안에는 가야 할 짝 점이 들썩여서 어디로 이어야 하는지 알려 준다.
   * 이어졌거나 손가락을 떼면 멈춘다. 그리는 상태가 바뀔 때마다 부른다.
   */
  private syncBeacon(): void {
    const stroke = this.stroke;
    const { board } = this.run;
    let wanted: Phaser.GameObjects.Graphics | null = null;
    if (stroke && !isLinked(board, stroke.pair)) {
      const start = (stroke.pending ?? board).paths[stroke.pair][0];
      const far = board.puzzle.dots[stroke.pair].findIndex((cell) => cell !== start);
      wanted = this.dots[stroke.pair]?.[far] ?? null;
    }
    if (wanted === this.beacon) return;
    if (this.beacon) {
      this.tweens.killTweensOf(this.beacon);
      this.beacon.setScale(1);
    }
    this.beacon = wanted;
    if (!wanted) return;
    this.tweens.killTweensOf(wanted);
    wanted.setScale(1);
    this.tweens.add({ targets: wanted, scale: 1.16, duration: 300, ease: 'Sine.InOut', yoyo: true, repeat: -1 });
  }

  // ───────── 이어짐과 판 깨기 ─────────

  private popDots(pair: number, scale: number): void {
    for (const dot of this.dots[pair] ?? []) {
      this.tweens.killTweensOf(dot);
      this.tweens.add({ targets: dot, scale: { from: scale, to: 1 }, duration: 240, ease: 'Back.Out' });
    }
  }

  /** 한 쌍이 이어졌다: 두 점이 통 튀고, 이은 쌍이 늘수록 높은 음이 난다. 길이 지나는 칸은 redraw가 물들인다. */
  private onLinked(pair: number): void {
    sfx.hit(linkedCount(this.run.board));
    vibrate(12);
    this.popDots(pair, 1.32);
  }

  private onSolved(): void {
    const { run, reward } = claimClear(this.run);
    if (!reward) return;
    // 다음 판이 깔릴 때까지 시간이 멈춘다.
    this.playing = false;
    this.lastTickSecond = 0;
    this.finishStroke();
    this.run = run;
    this.hud.setScore(run.score);
    this.hud.setTime(run.timeLeft, START_SECONDS);
    this.clearHints();

    this.dots.flat().forEach((dot, index) => {
      this.tweens.add({
        targets: dot,
        scale: { from: 1.25, to: 1 },
        delay: 60 + index * 25,
        duration: 240,
        ease: 'Back.Out',
      });
    });
    if (this.stageLevel !== null) {
      // 단계 모드는 판 하나가 한 판이다. 다음 단계는 결과 화면에서 고른다.
      this.time.delayedCall(CLEAR_BANNER_MS, () => {
        sfx.gold();
        vibrate([15, 30, 15]);
        this.sparks.explode(18, GAME_WIDTH / 2, this.boardBox.y);
        showBanner(this, this.boardBox.y, '클리어!', LOOK.text.good, 900, DEPTH.banner);
      });
      const { board } = run;
      this.finishStage(
        true,
        [
          ['판 크기', `한 변 ${board.puzzle.size}칸`],
          ['이은 쌍', `${board.paths.length}쌍`],
        ],
        CLEAR_BANNER_MS + 1000,
      );
      return;
    }
    this.time.delayedCall(CLEAR_BANNER_MS, () => {
      sfx.gold();
      vibrate([15, 30, 15]);
      this.sparks.explode(18, GAME_WIDTH / 2, this.boardBox.y);
      this.showClearBanner(reward, NEXT_BOARD_MS - CLEAR_BANNER_MS);
    });
    this.time.delayedCall(NEXT_BOARD_MS, () => {
      this.run = nextStage(this.run, Math.random);
      this.dealBoard();
    });
  }

  /** 판 한가운데에 깼다는 글자와, 그 아래에 받은 점수와 돌려받은 시간을 띄운다. */
  private showClearBanner(reward: ClearReward, durationMs: number): void {
    const centerY = this.boardBox.y;
    showBanner(this, centerY, '클리어!', LOOK.text.good, durationMs, DEPTH.banner);
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
    const width = Math.ceil(bonus.width) + BONUS.padding * 2;
    plate.fillStyle(LOOK.text.plate, BONUS.alpha);
    plate.fillRoundedRect((GAME_WIDTH - width) / 2, y - BONUS.height / 2, width, BONUS.height, BONUS.height / 2);
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

  /** 시간이 다 됐다. 풀던 판에서 이어 둔 쌍의 점수를 더해 끝낸다. */
  private endRun(): void {
    this.playing = false;
    this.finishStroke();
    this.stopDemo();
    this.clearHints();
    this.setLeftover(false);

    const bonus = pendingPoints(this.run);
    const score = finalScore(this.run);
    const linked = this.run.pairsLinked + linkedCount(this.run.board);
    this.hud.setScore(score);
    if (bonus > 0) {
      // 풀던 판에서 이어 둔 쌍으로 받은 점수를, 이은 쌍을 적은 자리 옆에 보여 준다.
      this.pairsLabel.setText(`${this.pairsLabel.text}  +${bonus}점`).setColor(LOOK.text.points);
      this.tweens.add({ targets: this.pairsLabel, scale: { from: 1.25, to: 1 }, duration: 220, ease: 'Back.Out' });
    }
    sfx.expire();
    vibrate([20, 40, 20]);
    showBanner(this, this.boardBox.y, '시간 끝!', LOOK.text.over, 900, DEPTH.banner);
    this.finishMiniGame(score, [
      ['깬 판', `${this.run.boardsCleared}판`],
      ['이은 쌍', `${linked}쌍`],
      ['마지막 판', `한 변 ${this.run.board.puzzle.size}칸`],
    ]);
  }
}
