import Phaser from 'phaser';
import { mascotTexture } from '../../art/cosmetics';
import { TEXTURE } from '../../art/sprites';
import { GAME_WIDTH, SCENE } from '../../config';
import { vibrate } from '../../core/haptics';
import { sfx, tone } from '../../core/sfx';
import { store } from '../../core/store';
import { SWIPE_MIN_DISTANCE, swipeDirection } from '../../core/swipe';
import { addBackdrop, addText, PixelButton } from '../../core/ui';
import { GameHud, HUD_HEIGHT, showBanner } from '../../scenes/GameHud';
import { MiniGameScene } from '../../scenes/MiniGameScene';
import { drawBox, drawRoom, drawShade, LOOK, RIM, type BoxLook } from './art';
import { GUIDED_LEVELS, levelRun } from './levels';
import {
  advance,
  boardLayout,
  boxAt,
  canUndo,
  cellAt,
  centerOf,
  claimClear,
  deadCells,
  elapse,
  finalScore,
  hasMoved,
  isOver,
  isSolved,
  isTarget,
  neighbour,
  DIRECTIONS,
  newRun,
  nextStage,
  pendingPoints,
  placedCount,
  restart,
  routeTo,
  START_SECONDS,
  stuckBoxes,
  undo,
  type Area,
  type Board,
  type BoardLayout,
  type ClearReward,
  type Direction,
  type RunState,
} from './rules';

// ───────── 자리 ─────────

/** 판 위에 도움말 두 줄이나 알림 한 줄이 들어갈 자리의 높이 */
const HINT_ROOM = 42;
/** 도움말 두 줄의 줄 간격과, 판의 테두리에서 띄우는 거리 */
const HINT_LINE = 16;
const HINT_GAP = 6;
/** 판 아래에 놓은 상자와 민 횟수를 적는 줄, 그 아래의 버튼 두 개가 들어갈 자리의 높이 */
const CONTROL_ROOM = 72;
/** 화면 아래 끝에서 버튼의 위쪽 끝까지, 버튼의 크기와 두 버튼 사이의 틈 */
const BUTTON = { bottom: 42, width: 98, height: 32, gap: 12 } as const;
/** 버튼 위쪽 끝에서 상태 글자의 가운데까지 */
const STATUS_OFFSET = 14;
/** 상태 글자를 화면 양 끝에서 들이는 거리 */
const STATUS_INSET = 16;

// ───────── 조작 ─────────

/**
 * 손가락을 떼지 않고 계속 밀 때, 이만큼(칸 크기에 대한 비율) 더 밀 때마다 한 칸씩 더 간다.
 * 첫 칸은 SWIPE_MIN_DISTANCE만 밀어도 간다.
 */
const CHAIN_RATIO = 0.8;
/** 누른 자리에서 이보다 멀리 움직이지 않고 떼면 그 칸을 누른 것으로 본다(px). */
const TAP_SLOP = 10;
/** 밀어서 받아 둔 걸음은 이만큼까지만 쌓는다. 손이 화면보다 앞서가도 캐릭터가 한참 뒤늦게 따라오지 않는다. */
const MAX_QUEUED_SWIPES = 2;

// ───────── 움직임과 시간 ─────────

/** 한 칸을 걷는 시간, 상자를 밀며 걷는 시간, 눌러서 멀리 갈 때 한 칸을 걷는 시간(ms) */
const WALK_MS = 80;
const PUSH_MS = 110;
const ROUTE_MS = 55;
/** 되돌리거나 처음으로 돌릴 때 제자리로 미끄러지는 시간(ms) */
const REWIND_MS = 120;
/** 새 판이 나타나는 시간(ms). 이동안은 움직일 수 없다. */
const DEAL_MS = 200;
/** 판을 깬 뒤 "클리어!"가 뜨기까지, 그리고 다음 판이 깔리기까지(ms). 그동안 시간은 멈춘다. */
const CLEAR_BANNER_MS = 220;
const NEXT_BOARD_MS = 1200;
/** "클리어!" 아래에 적는 "+점수 +시간" 한 줄: 큰 글자에서 내려온 거리와 글자 뒤에 까는 알약 모양 바탕 */
const BONUS = { offsetY: 32, height: 18, padding: 9, alpha: 0.92 } as const;
/** 첫 판에서 아무것도 하지 않아도 이 시간이 지나면 시계가 가기 시작한다(초). 도움말을 읽을 틈이다. */
const AUTO_START_SECONDS = 4;
/** 일시정지에서 돌아온 뒤 다시 시간이 흐르기까지의 여유(초). 가려져 있던 판을 다시 볼 틈을 준다. */
const RESUME_GRACE_SECONDS = 0.6;
/** 남은 시간이 이 아래로 내려가면 1초마다 소리로 알린다 */
const TICK_FROM_SECONDS = 5;

const HINT_LINES = ['화면을 밀면 그쪽으로 한 칸 걸어요', '상자를 밀어서 별 자리에 올려요'] as const;
const STUCK_NOTICE = '더 갈 곳이 없는 상자가 있어요';
const STUCK_ADVICE = '되돌리기를 눌러 봐요';

/** 방과 상자와 캐릭터는 깊이를 따로 주지 않고 만든 순서대로 겹친다. */
const DEPTH = { effect: 20, hud: 30, banner: 40 } as const;

/** 키보드로도 할 수 있다(컴퓨터에서 해 볼 때): 화살표와 WASD. */
const KEY_STEPS: Readonly<Record<string, Direction>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
};
/** 되돌리기와 처음부터 다시의 키 */
const KEY_UNDO = new Set(['KeyZ', 'Backspace']);
const KEY_RESTART = 'KeyR';

/** 받아 둔 걸음 하나: 밀어서 낸 것인지, 칸을 눌러서 가는 길의 한 걸음인지 */
interface QueuedStep {
  direction: Direction;
  routed: boolean;
}

/** 누르고 있는 손가락 하나의 기록 */
interface Touch {
  pointerId: number;
  /** 처음 누른 자리. 밀지 않고 떼면 이 자리의 칸을 누른 것이다. */
  downX: number;
  downY: number;
  /** 다음 걸음을 재기 시작하는 자리. 한 칸 갈 때마다 손가락이 있던 자리로 옮긴다. */
  fromX: number;
  fromY: number;
  /** 이 손가락으로 한 번이라도 밀었는지 */
  swiped: boolean;
}

/**
 * 상자 밀기: 캐릭터를 걸려서 상자를 밀어 모두 별 자리에 올린다. 상자는 밀 수만 있고 당길 수 없어서,
 * 어느 상자를 어느 쪽에서 먼저 밀지를 따져야 한다. 시간 안에 판을 깨면 시간을 돌려받고 더 어려운 판이 나온다.
 * 규칙은 rules.ts에, 그림은 art.ts에, 단계 모드의 판은 levels.ts에 있고 이 씬은 입력과 진행만 맡는다.
 */
export class BoxPushScene extends MiniGameScene {
  protected readonly gameId = 'box-push';

  private run!: RunState;
  private layout: BoardLayout = { cell: 0, left: 0, top: 0 };
  /** 지금 판에서 상자가 들어가면 더 갈 곳이 없는 칸들 */
  private dead: readonly boolean[] = [];
  private touch: Touch | null = null;
  /** 받아 두고 아직 걷지 않은 걸음들 */
  private queue: QueuedStep[] = [];
  /** 한 걸음을 걷는 중인지 */
  private stepping = false;
  /** 걷는 중에 누른 칸. 그 걸음이 끝난 자리에서 길을 찾아 간다. 없으면 null이다. */
  private tapped: number | null = null;
  /** 시계가 가기 시작했는지. 처음 움직일 때, 또는 조금 기다리면 시작한다. */
  private started = false;
  private waited = 0;
  /** 0보다 크면 일시정지에서 막 돌아와 잠깐 멈춰 있는 중 */
  private grace = 0;
  private lastTickSecond = 0;
  /** 상자마다의 그림과 지금 그려진 모습 */
  private boxViews: Phaser.GameObjects.Graphics[] = [];
  private boxLooks: BoxLook[] = [];
  /** 판 위에 떠 있는 도움말 줄들 */
  private hints: Phaser.GameObjects.Text[] = [];
  /** 더 갈 곳이 없는 상자가 있다는 알림이 떠 있는지 */
  private stuckShown = false;

  private hud!: GameHud;
  /** 방, 상자, 캐릭터를 담는 층. 일시정지 중에 통째로 가린다. */
  private boardLayer!: Phaser.GameObjects.Container;
  private room!: Phaser.GameObjects.Graphics;
  private boxLayer!: Phaser.GameObjects.Container;
  private shade!: Phaser.GameObjects.Graphics;
  private player!: Phaser.GameObjects.Image;
  private notice!: Phaser.GameObjects.Text;
  private advice!: Phaser.GameObjects.Text;
  private placedLabel!: Phaser.GameObjects.Text;
  private pushesLabel!: Phaser.GameObjects.Text;
  private undoButton!: PixelButton;
  private restartButton!: PixelButton;
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor() {
    super(SCENE.boxPush);
  }

  create(): void {
    this.beginMiniGame();
    this.resetState();

    addBackdrop(this);
    this.room = this.add.graphics();
    this.shade = this.add.graphics();
    this.boxLayer = this.add.container(0, 0);
    this.player = this.add.image(0, 0, this.playerTexture('idle'));
    this.boardLayer = this.add.container(0, 0, [this.room, this.shade, this.boxLayer, this.player]);
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
    this.createButtons();

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

  private resetState(): void {
    this.run = this.stageLevel === null ? newRun(Math.random) : levelRun(this.stageLevel);
    this.layout = { cell: 0, left: 0, top: 0 };
    this.dead = [];
    this.touch = null;
    this.queue = [];
    this.stepping = false;
    this.tapped = null;
    this.started = false;
    this.waited = 0;
    this.grace = 0;
    this.lastTickSecond = 0;
    this.boxViews = [];
    this.boxLooks = [];
    this.hints = [];
    this.stuckShown = false;
  }

  private playerTexture(pose: 'idle' | 'cheer'): string {
    return mascotTexture(store.data.cosmetics.equipped.runner, pose);
  }

  // ───────── 화면 구성 ─────────

  /** 판이 들어갈 자리: HUD와 도움말 아래, 상태 글자와 버튼 위 */
  private boardArea(): Area {
    const top = HUD_HEIGHT + HINT_ROOM;
    return { x: 0, y: top, width: GAME_WIDTH, height: this.scale.height - top - CONTROL_ROOM };
  }

  /** 판 위의 알림과 판 아래의 상태 글자를 만든다. 알림의 자리는 판을 깔 때 맞춘다. */
  private createLabels(): void {
    const notice = (line: string, color: string): Phaser.GameObjects.Text =>
      addText(this, GAME_WIDTH / 2, 0, line, { color, originX: 0.5, stroke: LOOK.text.outline })
        .setDepth(DEPTH.hud)
        .setVisible(false);
    this.notice = notice(STUCK_NOTICE, LOOK.text.notice);
    this.advice = notice(STUCK_ADVICE, LOOK.text.hintSub);

    const statusY = this.scale.height - BUTTON.bottom - STATUS_OFFSET;
    this.placedLabel = addText(this, STATUS_INSET, statusY, '', {
      color: LOOK.text.status,
      originY: 0.5,
      stroke: LOOK.text.outline,
    });
    this.pushesLabel = addText(this, GAME_WIDTH - STATUS_INSET, statusY, '', {
      color: LOOK.text.status,
      originX: 1,
      originY: 0.5,
      stroke: LOOK.text.outline,
    });
  }

  private createButtons(): void {
    const y = this.scale.height - BUTTON.bottom;
    const left = (GAME_WIDTH - BUTTON.width * 2 - BUTTON.gap) / 2;
    this.undoButton = new PixelButton(this, {
      x: left,
      y,
      width: BUTTON.width,
      height: BUTTON.height,
      label: '되돌리기',
      style: 'yellow',
      onTap: () => this.undoPush(),
    });
    this.restartButton = new PixelButton(this, {
      x: left + BUTTON.width + BUTTON.gap,
      y,
      width: BUTTON.width,
      height: BUTTON.height,
      label: '처음부터',
      onTap: () => this.restartBoard(),
    });
  }

  /** 판의 위쪽 끝(테두리 포함) */
  private get boardTop(): number {
    return this.layout.top - RIM;
  }

  /** 판 안쪽의 한가운데 */
  private get boardCenter(): { x: number; y: number } {
    const { puzzle } = this.run.board;
    const { cell, left, top } = this.layout;
    return { x: left + ((puzzle.cols - 2) * cell) / 2, y: top + ((puzzle.rows - 2) * cell) / 2 };
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

  /** 지금 판을 새로 깐다. 다 나타나면 움직일 수 있고 시간이 흐른다. */
  private dealBoard(): void {
    const { board, stage } = this.run;
    const { puzzle } = board;
    this.layout = boardLayout(puzzle, this.boardArea());
    this.dead = deadCells(puzzle);
    const { cell, left, top } = this.layout;

    this.queue = [];
    this.stepping = false;
    this.tapped = null;
    this.touch = null;
    this.setStuck(false);
    this.tweens.killTweensOf([this.player, this.shade, ...this.boxViews]);
    this.boxLayer.removeAll(true);
    this.room.setPosition(left, top);
    drawRoom(this.room, puzzle, cell);
    drawShade(this.shade, cell);
    this.boxViews = board.boxes.map(() => {
      const view = this.add.graphics();
      this.boxLayer.add(view);
      return view;
    });
    this.boxLooks = [];
    // 캐릭터는 칸보다 조금 작게, 발이 칸의 아래쪽에 닿게 세운다.
    this.player
      .setTexture(this.playerTexture('idle'))
      .setOrigin(0.5, 0.62)
      .setScale((cell * 0.92) / this.player.height)
      .setAngle(0);
    this.placeAll(board);

    const hintTop = this.boardTop - HINT_GAP - HINT_LINE * 2;
    this.notice.setY(hintTop);
    this.advice.setY(hintTop + HINT_LINE);
    this.refreshStatus();
    const level = this.stageLevel;
    if (level === null) this.hud.setSide(`${stage}판`, stage > 1);
    // 단계 모드에서는 상자가 하나뿐인 첫 단계들에서만 방법을 알려 준다.
    const guided = level === null ? stage === 1 : level <= GUIDED_LEVELS;

    this.boardLayer.setAlpha(0);
    this.tweens.add({ targets: this.boardLayer, alpha: 1, duration: DEAL_MS, ease: 'Quad.Out' });
    this.clearHints();
    if (guided) this.showHints();
    else if (level === null) sfx.pop();

    this.time.delayedCall(DEAL_MS, () => {
      this.playing = true;
      if (stage === 1) sfx.go();
    });
  }

  /** 칸의 가운데 */
  private spotOf(cell: number): { x: number; y: number } {
    return centerOf(this.run.board.puzzle, this.layout, cell);
  }

  /** 상자가 지금 어떤 모습이어야 하는지 */
  private lookOf(board: Board, box: number): BoxLook {
    const at = board.boxes[box];
    if (isTarget(board.puzzle, at)) return 'placed';
    return this.dead[at] ? 'stuck' : 'loose';
  }

  /** 상자의 모습이 달라졌으면 다시 그린다. */
  private refreshBox(board: Board, box: number): void {
    const look = this.lookOf(board, box);
    if (this.boxLooks[box] === look) return;
    this.boxLooks[box] = look;
    drawBox(this.boxViews[box], look, this.layout.cell);
  }

  /** 캐릭터와 상자를 모두 board의 자리에 바로 놓는다. */
  private placeAll(board: Board): void {
    const at = this.spotOf(board.player);
    this.player.setPosition(at.x, at.y);
    this.shade.setPosition(at.x, at.y);
    board.boxes.forEach((cell, box) => {
      const spot = this.spotOf(cell);
      this.boxViews[box].setPosition(spot.x, spot.y).setScale(1);
      this.refreshBox(board, box);
    });
  }

  /** 판 아래의 놓은 상자와 민 횟수를 고쳐 적고, 두 버튼을 누를 수 있는지 맞춘다. */
  private refreshStatus(): void {
    const { board } = this.run;
    const placed = placedCount(board);
    const boxes = board.boxes.length;
    this.placedLabel
      .setText(`놓은 상자 ${placed}/${boxes}`)
      .setColor(placed === boxes ? LOOK.text.statusDone : LOOK.text.status);
    // 가장 적게 미는 횟수를 넘기 전까지는 잘하고 있다는 색으로 적는다.
    this.pushesLabel
      .setText(`민 횟수 ${board.pushes} · 최소 ${board.puzzle.par}`)
      .setColor(board.pushes <= board.puzzle.par ? LOOK.text.statusDone : LOOK.text.status);
    this.undoButton.setEnabled(canUndo(this.run));
    this.restartButton.setEnabled(hasMoved(this.run));
  }

  /**
   * 더 갈 곳이 없는 칸에 상자가 들어갔을 때: 판 위에 알리고 되돌리기를 권한다.
   * 상자는 당길 수 없어서 구석에 넣으면 그 판은 깰 수 없는데, 처음 하는 사람은 그것을 모르고 헤매기 쉽다.
   */
  private setStuck(shown: boolean): void {
    if (shown === this.stuckShown) return;
    this.stuckShown = shown;
    this.notice.setVisible(shown);
    this.advice.setVisible(shown);
    for (const line of this.hints) line.setVisible(!shown);
    this.undoButton.setStyle(shown ? 'pink' : 'yellow');
    this.tweens.killTweensOf(this.notice);
    this.notice.setScale(1);
    if (!shown) return;
    this.tweens.add({ targets: this.notice, scale: { from: 0.7, to: 1 }, duration: 220, ease: 'Back.Out' });
    sfx.deny();
    vibrate(20);
  }

  // ───────── 입력 ─────────

  private bindInput(): void {
    const { input } = this;
    input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onPointerLost, this);
    input.keyboard?.on(Phaser.Input.Keyboard.Events.ANY_KEY_DOWN, this.onKeyDown, this);
    // 일시정지한 동안 시간을 들이지 않고 판을 궁리할 수 없게 판을 가린다.
    this.events.on(Phaser.Scenes.Events.PAUSE, this.onPause, this);
    this.events.on(Phaser.Scenes.Events.RESUME, this.onResume, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      input.off(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
      input.off(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
      input.off(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
      input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onPointerLost, this);
      input.keyboard?.off(Phaser.Input.Keyboard.Events.ANY_KEY_DOWN, this.onKeyDown, this);
      this.events.off(Phaser.Scenes.Events.PAUSE, this.onPause, this);
      this.events.off(Phaser.Scenes.Events.RESUME, this.onResume, this);
    });
  }

  private onPause(): void {
    this.touch = null;
    this.queue = [];
    // 끝난 뒤 결과 화면이 뜰 때는 풀던 판을 그대로 보여 준다. 시간을 재지 않는 단계 모드에서도 가리지 않는다.
    if (this.playing && this.stageLevel === null) this.boardLayer.setVisible(false);
  }

  private onResume(): void {
    this.boardLayer.setVisible(true);
    if (!this.playing || !this.started || this.stageLevel !== null) return;
    this.grace = RESUME_GRACE_SECONDS;
    showBanner(this, this.boardCenter.y, '준비!', LOOK.text.ready, RESUME_GRACE_SECONDS * 1000, DEPTH.banner);
  }

  /** 지금 조작을 받을 수 있는지: 판이 깔려 있고, 일시정지에서 막 돌아온 참이 아니다. */
  private get canAct(): boolean {
    return this.playing && this.grace <= 0;
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    // 위쪽 HUD(일시정지 버튼)와 아래쪽 버튼을 누른 것은 판을 조작한 것이 아니다.
    const controlsTop = this.scale.height - BUTTON.bottom - 4;
    if (!this.canAct || pointer.worldY < HUD_HEIGHT || pointer.worldY >= controlsTop) return;
    this.touch = {
      pointerId: pointer.id,
      downX: pointer.worldX,
      downY: pointer.worldY,
      fromX: pointer.worldX,
      fromY: pointer.worldY,
      swiped: false,
    };
  }

  /**
   * 손가락이 움직이는 도중에, 정해진 거리를 넘는 순간 한 칸을 간다. 떼기를 기다리지 않는다.
   * 간 뒤에는 그 자리에서부터 다시 재므로, 떼지 않고 죽 밀면 여러 칸을 가고 꺾어 밀면 방향도 바뀐다.
   */
  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    const touch = this.touch;
    if (!touch || touch.pointerId !== pointer.id || !pointer.isDown || !this.canAct) return;
    const reach = touch.swiped ? Math.max(SWIPE_MIN_DISTANCE, this.layout.cell * CHAIN_RATIO) : SWIPE_MIN_DISTANCE;
    const direction = swipeDirection(pointer.worldX - touch.fromX, pointer.worldY - touch.fromY, reach);
    if (!direction) return;
    touch.swiped = true;
    touch.fromX = pointer.worldX;
    touch.fromY = pointer.worldY;
    this.queueSwipe(direction);
  }

  /** 밀지 않고 뗐으면 누른 칸으로 걸어간다. 뗀 자리가 아니라 누른 자리로 따진다. */
  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    const touch = this.touch;
    if (!touch || touch.pointerId !== pointer.id) return;
    this.touch = null;
    if (touch.swiped || !this.canAct) return;
    if (Math.hypot(pointer.worldX - touch.downX, pointer.worldY - touch.downY) > TAP_SLOP) return;
    const cell = cellAt(this.run.board.puzzle, this.layout, touch.downX, touch.downY);
    if (cell !== null) this.tapCell(cell);
  }

  /** 화면 밖에서 뗀 손가락은 자리가 엉뚱한 값이라서, 아무것도 하지 않고 잊는다. */
  private onPointerLost(pointer: Phaser.Input.Pointer): void {
    if (this.touch?.pointerId === pointer.id) this.touch = null;
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (!this.canAct) return;
    const direction = KEY_STEPS[event.code];
    if (direction) this.queueSwipe(direction);
    else if (KEY_UNDO.has(event.code)) this.undoPush();
    else if (event.code === KEY_RESTART && !event.repeat) this.restartBoard();
  }

  /** 밀어서(또는 키보드로) 낸 한 걸음을 받아 둔다. 눌러서 가던 길이 있으면 그만두고 이 걸음을 따른다. */
  private queueSwipe(direction: Direction): void {
    this.tapped = null;
    this.queue = this.queue.filter((queued) => !queued.routed);
    if (this.queue.length >= MAX_QUEUED_SWIPES) return;
    this.queue.push({ direction, routed: false });
    this.walk();
  }

  /**
   * 칸을 눌렀다. 캐릭터 바로 옆의 상자를 누르면 그 상자를 한 칸 밀고,
   * 빈 바닥을 누르면 상자를 밀지 않고 갈 수 있는 가장 짧은 길로 걸어간다.
   */
  private tapCell(cell: number): void {
    const { board } = this.run;
    if (boxAt(board, cell) >= 0) {
      const direction = DIRECTIONS.find((way) => neighbour(board.puzzle, board.player, way) === cell);
      if (direction) this.queueSwipe(direction);
      return;
    }
    // 걷는 중에 눌렀으면 그 걸음이 끝난 자리에서 길을 찾아야 하므로, 걷던 것을 멈추고 끝난 뒤에 다시 따진다.
    if (this.stepping) {
      this.queue = [];
      this.tapped = cell;
      return;
    }
    const route = routeTo(board, cell);
    if (!route || route.length === 0) return;
    this.queue = route.map((direction) => ({ direction, routed: true }));
    this.walk();
  }

  // ───────── 걷고 밀기 ─────────

  /** 받아 둔 걸음을 하나 꺼내 걷는다. 걷는 중이면 그 걸음이 끝난 뒤에 이어서 걷는다. */
  private walk(): void {
    if (this.stepping || !this.canAct) return;
    const next = this.queue.shift();
    if (!next) return;
    this.started = true;

    const before = this.run.board;
    const { run, step } = advance(this.run, next.direction);
    if (!step.moved) {
      this.queue = [];
      this.bump(before, next.direction);
      return;
    }
    this.run = run;
    this.stepping = true;
    const pushed = step.pushed >= 0;
    const duration = pushed ? PUSH_MS : next.routed ? ROUTE_MS : WALK_MS;
    const to = this.spotOf(run.board.player);
    this.tweens.add({ targets: [this.player, this.shade], x: to.x, y: to.y, duration, ease: 'Sine.Out' });
    if (pushed) {
      const spot = this.spotOf(run.board.boxes[step.pushed]);
      this.tweens.add({ targets: this.boxViews[step.pushed], x: spot.x, y: spot.y, duration, ease: 'Sine.Out' });
      sfx.stack();
      vibrate(8);
    } else if (!next.routed) {
      tone(330, 0.03, { type: 'triangle', volume: 0.14 });
    }
    this.time.delayedCall(duration, () => {
      this.stepping = false;
      if (pushed) this.afterPush(before, step.pushed);
      if (!this.playing) return;
      const tapped = this.tapped;
      this.tapped = null;
      if (tapped !== null) this.tapCell(tapped);
      else this.walk();
    });
  }

  /** 막혀서 가지 못했다: 캐릭터가 그쪽으로 살짝 부딪혔다 돌아온다. */
  private bump(board: Board, direction: Direction): void {
    const here = this.spotOf(board.player);
    const way = DIRECTIONS.indexOf(direction);
    const nudge = this.layout.cell * 0.14;
    const dx = [0, nudge, 0, -nudge][way];
    const dy = [-nudge, 0, nudge, 0][way];
    this.tweens.killTweensOf([this.player, this.shade]);
    this.player.setPosition(here.x, here.y);
    this.shade.setPosition(here.x, here.y);
    this.tweens.add({ targets: this.player, x: here.x + dx, y: here.y + dy, duration: 60, yoyo: true, ease: 'Sine.Out' });
    sfx.land();
  }

  /** 상자 하나를 밀고 난 뒤: 상자의 모습과 상태 글자를 고치고, 별 자리에 올랐는지와 판을 깼는지 본다. */
  private afterPush(before: Board, box: number): void {
    const { board } = this.run;
    const wasPlaced = isTarget(before.puzzle, before.boxes[box]);
    const nowPlaced = isTarget(board.puzzle, board.boxes[box]);
    this.refreshBox(board, box);
    this.refreshStatus();
    if (nowPlaced && !wasPlaced) {
      const spot = this.spotOf(board.boxes[box]);
      const view = this.boxViews[box];
      this.tweens.add({ targets: view, scale: { from: 1.22, to: 1 }, duration: 220, ease: 'Back.Out' });
      this.sparks.setParticleTint(LOOK.sparks.place[0]);
      this.sparks.explode(7, spot.x, spot.y);
      sfx.hit(placedCount(board));
      vibrate(12);
    }
    if (isSolved(board)) {
      this.onSolved();
      return;
    }
    this.setStuck(stuckBoxes(board, this.dead).length > 0);
  }

  /** 마지막으로 민 것을 되돌린다. */
  private undoPush(): void {
    if (!this.canAct || this.stepping || !canUndo(this.run)) return;
    this.started = true;
    this.rewind(undo(this.run));
    sfx.pull();
  }

  /** 지금 판을 처음 모습으로 되돌린다. */
  private restartBoard(): void {
    if (!this.canAct || this.stepping || !hasMoved(this.run)) return;
    this.started = true;
    this.rewind(restart(this.run));
    sfx.whoosh();
  }

  /** 되돌린 모습으로 바꾸고, 캐릭터와 상자를 그 자리로 미끄러뜨린다. */
  private rewind(run: RunState): void {
    this.queue = [];
    this.tapped = null;
    this.run = run;
    const { board } = run;
    const at = this.spotOf(board.player);
    this.tweens.killTweensOf([this.player, this.shade, ...this.boxViews]);
    this.tweens.add({ targets: [this.player, this.shade], x: at.x, y: at.y, duration: REWIND_MS, ease: 'Sine.Out' });
    board.boxes.forEach((cell, box) => {
      const spot = this.spotOf(cell);
      const view = this.boxViews[box].setScale(1);
      this.tweens.add({ targets: view, x: spot.x, y: spot.y, duration: REWIND_MS, ease: 'Sine.Out' });
      this.refreshBox(board, box);
    });
    this.refreshStatus();
    this.setStuck(stuckBoxes(board, this.dead).length > 0);
  }

  // ───────── 판 깨기 ─────────

  private onSolved(): void {
    const { run, reward } = claimClear(this.run);
    if (!reward) return;
    // 다음 판이 깔릴 때까지 시간이 멈춘다.
    this.playing = false;
    this.lastTickSecond = 0;
    this.queue = [];
    this.touch = null;
    this.run = run;
    this.hud.setScore(run.score);
    this.hud.setTime(run.timeLeft, START_SECONDS);
    this.clearHints();
    this.setStuck(false);
    this.undoButton.setEnabled(false);
    this.restartButton.setEnabled(false);

    // 캐릭터가 팔을 들고 폴짝 뛴다.
    this.player.setTexture(this.playerTexture('cheer'));
    this.tweens.add({ targets: this.player, y: this.player.y - 6, duration: 130, yoyo: true, repeat: 1, ease: 'Quad.Out' });
    this.boxViews.forEach((view, index) => {
      this.tweens.add({ targets: view, scale: { from: 1.2, to: 1 }, delay: 60 + index * 40, duration: 240, ease: 'Back.Out' });
    });

    const { board } = run;
    const center = this.boardCenter;
    const celebrate = (): void => {
      sfx.gold();
      vibrate([15, 30, 15]);
      this.sparks.setParticleTint(LOOK.sparks.clear[0]);
      this.sparks.explode(18, center.x, center.y);
    };
    if (this.stageLevel !== null) {
      // 단계 모드는 판 하나가 한 판이다. 다음 단계는 결과 화면에서 고른다.
      this.time.delayedCall(CLEAR_BANNER_MS, () => {
        celebrate();
        showBanner(this, center.y, '클리어!', LOOK.text.good, 900, DEPTH.banner);
      });
      this.finishStage(
        true,
        [
          ['민 횟수', `${board.pushes}번`],
          ['가장 적게 밀면', `${board.puzzle.par}번`],
        ],
        CLEAR_BANNER_MS + 1000,
      );
      return;
    }
    this.time.delayedCall(CLEAR_BANNER_MS, () => {
      celebrate();
      this.showClearBanner(reward, NEXT_BOARD_MS - CLEAR_BANNER_MS);
    });
    this.time.delayedCall(NEXT_BOARD_MS, () => {
      this.run = nextStage(this.run, Math.random);
      this.dealBoard();
    });
  }

  /** 판 한가운데에 깼다는 글자와, 그 아래에 받은 점수와 돌려받은 시간을 띄운다. */
  private showClearBanner(reward: ClearReward, durationMs: number): void {
    const centerY = this.boardCenter.y;
    // 가장 적게 미는 횟수로 깼으면 그렇다고 알린다. 점수가 더 붙는다.
    showBanner(this, centerY, reward.neat ? '딱 맞게!' : '클리어!', LOOK.text.good, durationMs, DEPTH.banner);
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

  /** 시간이 다 됐다. 풀던 판에서 놓아 둔 상자의 점수를 더해 끝낸다. */
  private endRun(): void {
    this.playing = false;
    this.queue = [];
    this.touch = null;
    this.clearHints();
    this.setStuck(false);
    this.undoButton.setEnabled(false);
    this.restartButton.setEnabled(false);

    const bonus = pendingPoints(this.run);
    const score = finalScore(this.run);
    const placed = this.run.boxesPlaced + placedCount(this.run.board);
    this.hud.setScore(score);
    if (bonus > 0) {
      // 풀던 판에서 놓아 둔 상자로 받은 점수를, 놓은 상자를 적은 자리 옆에 보여 준다.
      this.placedLabel.setText(`${this.placedLabel.text}  +${bonus}점`).setColor(LOOK.text.points);
      this.tweens.add({ targets: this.placedLabel, scale: { from: 1.25, to: 1 }, duration: 220, ease: 'Back.Out' });
    }
    sfx.expire();
    vibrate([20, 40, 20]);
    showBanner(this, this.boardCenter.y, '시간 끝!', LOOK.text.over, 900, DEPTH.banner);
    this.finishMiniGame(score, [
      ['깬 판', `${this.run.boardsCleared}판`],
      ['놓은 상자', `${placed}개`],
      ['딱 맞게 깬 판', `${this.run.neatClears}판`],
    ]);
  }
}
