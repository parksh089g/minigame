import Phaser from 'phaser';
import { TEXTURE } from '../../art/sprites';
import { GAME_WIDTH, SCENE } from '../../config';
import { vibrate } from '../../core/haptics';
import { LENS_ROOM } from '../../core/lens';
import { PressLens } from '../../core/lens-view';
import { sfx } from '../../core/sfx';
import { StartGate } from '../../core/start-gate';
import { addBackdrop, addTapZone, addText } from '../../core/ui';
import { floatText, GameHud, HUD_HEIGHT, showBanner } from '../../scenes/GameHud';
import { MiniGameScene, type ResultStat } from '../../scenes/MiniGameScene';
import {
  ART_CELL,
  drawBoard,
  drawHearts,
  drawToggle,
  drawTrippedFloor,
  flagTexture,
  HEARTS_SIZE,
  hogTexture,
  LOOK,
  MODES,
  padTexture,
  RIM,
  toggleCenter,
  type HogMood,
  type Mode,
} from './art';
import {
  boardLayout,
  cellOf,
  CONTROLS_HEIGHT,
  elapse,
  isOver,
  levelRun,
  markTile,
  neighboursOf,
  newRun,
  nextStage,
  START_HEARTS,
  tapTile,
  TIME_BANK_SECONDS,
  trapsLeft,
  type BoardLayout,
  type ClearReward,
  type RunState,
  type TapOutcome,
} from './rules';

type Opened = Extract<TapOutcome, { kind: 'opened' }>;

/** 손가락이 칸 위에 눌려 있는 동안의 기록 */
interface Press {
  index: number;
  pointerId: number;
  /** 누른 자리 */
  x: number;
  y: number;
  /** 누르기 시작한 때(performance.now()) */
  since: number;
}

/**
 * 이만큼 누르고 있으면 길게 누른 것으로 보고 깃발을 꽂는다(ms).
 * 손가락이 머문 시간은 게임 시간이 아니라 실제 시간으로 잰다. 화면이 버벅여서 게임 시간이
 * 느리게 흐르는 동안에도 손가락은 같은 빠르기로 기다리기 때문이다.
 */
const LONG_PRESS_MS = 350;
/** 누른 자리에서 이보다 멀리 움직이면 누르기를 취소한다(px). 판을 쓸다가 칸이 열리지 않게 한다. */
const PRESS_SLOP = 10;
/** 눌린 칸이 움츠러드는 정도. 숫자를 눌렀을 때 둘레 칸이 움찔하는 정도이기도 하다. */
const PRESSED_SCALE = 0.88;
/** 판 위에 도움말 두 줄을 적는 자리의 높이. 판이 작은 처음 두 판에서만 비워 둔다. */
const HEADER_HEIGHT = 36;
const HEADER_STAGES = 2;
/** 숫자의 글자 크기: 칸 크기에 이 값을 곱한다. 가장 작은 칸(27px)에서 16px이다. */
const DIGIT_RATIO = 0.6;

/** 화면 아래의 줄: 목숨, 판 번호, 열기·깃발 단추 */
const BAR = {
  /** 단추의 높이와 화면 아래 끝에서 띄우는 거리 */
  height: 34,
  bottom: 10,
  /** 화면 좌우 끝에서 띄우는 거리 */
  side: 10,
  /** 단추 반쪽의 폭. 엄지로 누르기 좋게 넉넉히 둔다. */
  segment: 64,
  /** 단추 반쪽의 가운데에서 아이콘과 글자까지의 거리 */
  iconOffset: -15,
  labelOffset: 8,
  /** 보이는 단추보다 누르는 자리를 위아래로 넓히는 폭 */
  hitPadding: 5,
} as const;
/** 열기·깃발 단추의 왼쪽 끝 */
const TOGGLE_LEFT = GAME_WIDTH - BAR.side - BAR.segment * 2;

/** 칸 하나가 열리는 시간(ms) */
const OPEN_MS = 120;
/** 여러 칸이 퍼져 열릴 때 한 칸마다 늦어지는 시간과 그 상한(ms) */
const RIPPLE_STEP_MS = 12;
const RIPPLE_MAX_MS = 260;
/** 새 판이 나타나는 시간(ms). 이동안은 눌러도 열리지 않는다. */
const DEAL_MS = 180;
/** 마지막 칸을 연 뒤 "클리어!"가 뜨기까지, 그리고 다음 판이 깔리기까지(ms). 그동안 시간은 멈춘다. */
const CLEAR_BANNER_MS = 220;
const NEXT_BOARD_MS = 1150;
/**
 * "클리어!" 아래에 적는 "+점수 +시간" 한 줄: 큰 글자에서 내려온 거리와, 글자 뒤에 까는 알약 모양 바탕.
 * 숫자가 빽빽한 판 위에 뜨기 때문에 바탕이 없으면 판의 숫자와 섞여 읽기 어렵다.
 */
const BONUS = { offsetY: 32, height: 18, padding: 9, alpha: 0.92 } as const;
/** 끝났을 때 숨어 있던 함정이 하나씩 드러나는 간격과 그 상한(ms) */
const UNVEIL_STEP_MS = 40;
const UNVEIL_MAX_MS = 400;
/** 일시정지에서 돌아온 뒤 다시 시간이 흐르기까지의 여유(초). 가려져 있던 판을 다시 볼 틈을 준다. */
const RESUME_GRACE_SECONDS = 0.6;
/** 남은 시간이 이 아래로 내려가면 1초마다 소리로 알린다 */
const TICK_FROM_SECONDS = 5;
/** 도움말 한 묶음이 떠 있는 시간(ms) */
const HINT_MS = 7000;

type HintLines = readonly [string, string];

/**
 * 판 위에 두 줄씩 띄우는 도움말. 첫 판에서는 start가 첫 칸을 열 때까지 떠 있고,
 * 그 뒤로 numbers와 flags가 차례로 나왔다 사라진다. chord는 둘째 판에서 한 번 나온다.
 */
const HINTS = {
  start: ['아무 칸이나 눌러서 열어요', '첫 칸은 언제나 안전해요'],
  numbers: ['숫자는 둘레 여덟 칸의 함정 수예요', '함정만 남기고 모두 열면 판을 깨요'],
  flags: ['함정 자리는 길게 눌러 깃발을 꽂아요', '아래 깃발 단추를 켜고 눌러도 돼요'],
  chord: ['숫자만큼 깃발을 꽂았으면', '그 숫자를 눌러 둘레를 한 번에 열어요'],
} as const satisfies Record<string, HintLines>;

const MODE_LABELS: Record<Mode, string> = { open: '열기', flag: '깃발' };

/** 판과 아래 줄은 깊이를 따로 주지 않고 만든 순서대로 겹친다. */
const DEPTH = { effect: 20, lens: 25, hud: 30, banner: 40 } as const;
/** 칸이 이보다 작은 판(일곱 줄부터)에서는 누른 칸을 손가락 위에 크게 띄워 보여 준다. */
const LENS_BELOW_CELL = 33;

/**
 * 논리 타일: 풀로 덮인 판에서 숫자를 실마리로 함정(낮잠 자는 고슴도치)을 피해 안전한 칸을 모두 연다.
 * 누르면 칸이 열리고, 길게 누르거나 깃발 모드에서 누르면 깃발이 꽂힌다. 모든 판은 찍지 않고 풀 수 있다.
 * 함정을 밟으면 목숨이 줄고, 목숨이나 시간이 다하면 끝난다. 판을 깨면 시간을 돌려받고 더 큰 판이 나온다.
 */
export class LogicTilesScene extends MiniGameScene {
  protected readonly gameId = 'logic-tiles';

  private run: RunState = newRun();
  private mode: Mode = 'open';
  private layout: BoardLayout = { cell: 0, left: 0, top: 0 };
  /** 칸마다의 덮개 그림. 열린 칸은 null이다. */
  private pads: (Phaser.GameObjects.Image | null)[] = [];
  /** 꽂혀 있는 깃발 그림. 칸 번호로 찾는다. */
  private flags = new Map<number, Phaser.GameObjects.Image>();
  private press: Press | null = null;
  /** 손가락이 눌려 있는 단추 반쪽 */
  private pressedSide: Mode | null = null;
  /** 첫 판에서 눌러 보라고 들썩이고 있는 칸 */
  private pointed: Phaser.GameObjects.Image | null = null;
  /** 판 위에 떠 있는 도움말 줄들. 사라진 뒤에는 비어 있다. */
  private hints: Phaser.GameObjects.Text[] = [];
  /** 0보다 크면 일시정지에서 막 돌아와 잠깐 멈춰 있는 중 */
  private grace = 0;
  /** 첫 칸을 누르거나 잠깐 기다릴 때까지 시간을 세워 둔다. 처음 하는 사람이 설명을 읽을 틈이다. */
  private readonly gate = new StartGate();
  private lastTickSecond = 0;
  /** 함정을 놓을 때 쓰는 난수. 단계 모드에서는 단계 번호로 정해진다. */
  private random: () => number = Math.random;

  private hud!: GameHud;
  private playArea!: Phaser.Geom.Rectangle;
  /** 판 전체를 담는 그릇. 원점은 판의 한가운데다. */
  private boardBox!: Phaser.GameObjects.Container;
  private boardCard!: Phaser.GameObjects.Graphics;
  /** 덮개, 숫자, 깃발, 고슴도치를 담는 층. 일시정지 중에 통째로 가린다. */
  private tileLayer!: Phaser.GameObjects.Container;
  private heartsView!: Phaser.GameObjects.Graphics;
  private stageLabel!: Phaser.GameObjects.Text;
  private toggleView!: Phaser.GameObjects.Graphics;
  private toggleLabels!: Record<Mode, Phaser.GameObjects.Text>;
  private sparks!: Record<keyof typeof LOOK.sparks, Phaser.GameObjects.Particles.ParticleEmitter>;
  private lens!: PressLens;

  constructor() {
    super(SCENE.logicTiles);
  }

  create(): void {
    this.beginMiniGame();
    this.resetState();

    this.playArea = new Phaser.Geom.Rectangle(0, HUD_HEIGHT, GAME_WIDTH, this.scale.height - HUD_HEIGHT);

    addBackdrop(this);
    this.boardCard = this.add.graphics();
    this.tileLayer = this.add.container(0, 0);
    this.boardBox = this.add.container(0, 0, [this.boardCard, this.tileLayer]);
    this.sparks = {
      open: this.createSparks(LOOK.sparks.open, 60),
      trip: this.createSparks(LOOK.sparks.trip, 90),
      clear: this.createSparks(LOOK.sparks.clear, 130),
    };
    this.createControls();
    this.lens = new PressLens(this, DEPTH.lens);

    this.addPauseButton();
    this.hud = new GameHud(this, DEPTH.hud);
    this.hud.setTime(TIME_BANK_SECONDS, TIME_BANK_SECONDS);
    if (this.stageLevel !== null) this.hud.showStage(this.stageLevel);

    this.bindInput();
    this.dealBoard();
  }

  override update(_time: number, deltaMs: number): void {
    if (!this.playing) return;
    if (this.press && performance.now() - this.press.since >= LONG_PRESS_MS) this.onLongPress(this.press);
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
    this.run = this.stageLevel === null ? newRun() : levelRun(this.stageLevel);
    this.random = this.levelRandom();
    this.mode = 'open';
    this.layout = { cell: 0, left: 0, top: 0 };
    this.pads = [];
    this.flags = new Map();
    this.press = null;
    this.pressedSide = null;
    this.pointed = null;
    this.hints = [];
    this.grace = 0;
    this.gate.reset();
    this.lastTickSecond = 0;
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
    return toggleCenter(TOGGLE_LEFT, this.barTop, BAR.segment, BAR.height, 'open').y;
  }

  /** 화면 아래의 줄을 만든다: 왼쪽에 목숨과 판 번호, 오른쪽에 열기·깃발 단추. */
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
    const label = (side: Mode): Phaser.GameObjects.Text =>
      addText(this, 0, 0, MODE_LABELS[side], { originX: 0.5, originY: 0.5 });
    this.toggleLabels = { open: label('open'), flag: label('flag') };
    for (const side of MODES) {
      const left = TOGGLE_LEFT + (side === 'open' ? 0 : BAR.segment);
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
          this.setMode(side);
        },
      );
    }
    this.drawToggleView();
  }

  private drawHeartsView(): void {
    const y = this.barMiddle - HEARTS_SIZE.height / 2;
    drawHearts(this.heartsView, BAR.side, y, this.run.hearts, START_HEARTS);
  }

  /** 단추를 지금 모드대로 다시 그린다. 고른 쪽은 색 있는 알약 위에 짙은 글자, 다른 쪽은 옅은 글자다. */
  private drawToggleView(): void {
    const top = this.barTop;
    const { segment, height, iconOffset, labelOffset } = BAR;
    drawToggle(this.toggleView, TOGGLE_LEFT, top, segment, height, this.mode, this.pressedSide, iconOffset);
    for (const side of MODES) {
      const active = side === this.mode;
      const center = toggleCenter(TOGGLE_LEFT, top, segment, height, side);
      // 색 있는 알약은 아래 두께만큼 윗면이 올라가 있으므로 글자도 같이 올린다.
      this.toggleLabels[side]
        .setColor(active ? LOOK.text.toggleOn : LOOK.text.toggleOff)
        .setPosition(Math.round(center.x + labelOffset), Math.round(center.y - (active ? 1 : 0)));
    }
  }

  /** 모드를 바꾼다. 단추와 함께 판의 테두리 색도 바뀌어서, 판만 보고 있어도 지금 모드를 알 수 있다. */
  private setMode(mode: Mode): void {
    this.mode = mode;
    this.drawToggleView();
    drawBoard(this.boardCard, this.run.board.cols, this.run.board.rows, this.layout.cell, mode);
  }

  private showTrapsLeft(bounce: boolean): void {
    this.hud.setSide(`함정 ${trapsLeft(this.run.board)}`, bounce);
  }

  // ───────── 도움말 ─────────

  /**
   * 판 바로 위에 도움말 두 줄을 띄운다. 묶음을 여럿 주면 하나씩 차례로 나왔다가 사라지고,
   * stay를 주면 사라지지 않고 떠 있는다(다음 도움말이나 판이 바뀔 때 치운다).
   */
  private showHints(queue: readonly HintLines[], stay = false): void {
    const [lines, ...rest] = queue;
    this.clearHints();
    const top = this.layout.top - RIM - HEADER_HEIGHT;
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

  /** 지금 판을 새로 깐다. 다 나타나면 시간이 흐르기 시작한다. 새 판은 언제나 열기 모드로 시작한다. */
  private dealBoard(): void {
    const { board, stage } = this.run;
    const header = stage <= HEADER_STAGES ? HEADER_HEIGHT : 0;
    this.layout = boardLayout(board, {
      x: 0,
      y: HUD_HEIGHT + header,
      width: GAME_WIDTH,
      height: this.scale.height - HUD_HEIGHT - header - CONTROLS_HEIGHT,
    });
    const { cell, left, top } = this.layout;

    this.clearTiles();
    this.boardBox.setPosition(left + (board.cols * cell) / 2, top + (board.rows * cell) / 2);
    this.setMode('open');
    this.pads = board.tiles.map((_, index) => this.addPad(index));
    // 단계 모드에서는 단계 번호가 위쪽에 적혀 있다.
    this.stageLabel.setText(this.stageLevel === null ? `${stage}판` : '');
    this.showTrapsLeft(stage > 1);

    this.tweens.add({
      targets: this.boardBox,
      scale: { from: 0.94, to: 1 },
      alpha: { from: 0, to: 1 },
      duration: DEAL_MS,
      ease: 'Back.Out',
    });
    if (stage === 1) this.showHints([HINTS.start], true);
    else if (stage === 2) this.showHints([HINTS.chord]);
    if (stage > 1) sfx.pop();

    this.time.delayedCall(DEAL_MS, () => {
      this.playing = true;
      if (stage > 1) return;
      sfx.go();
      this.pointOutMiddle();
    });
  }

  /** 지난 판의 칸 그림을 모두 치운다. */
  private clearTiles(): void {
    for (const child of this.tileLayer.list) this.tweens.killTweensOf(child);
    this.tileLayer.removeAll(true);
    this.pads = [];
    this.flags = new Map();
    this.pointed = null;
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

  /** (x, y)에 놓인 칸의 번호. 판 밖이면 null. */
  private cellAt(x: number, y: number): number | null {
    const { board } = this.run;
    const { cell, left, top } = this.layout;
    const col = Math.floor((x - left) / cell);
    const row = Math.floor((y - top) / cell);
    if (col < 0 || col >= board.cols || row < 0 || row >= board.rows) return null;
    return row * board.cols + col;
  }

  private addPad(index: number): Phaser.GameObjects.Image {
    const { x, y } = this.cellSpot(index);
    const pad = this.add.image(x, y, padTexture(this, this.layout.cell));
    this.tileLayer.add(pad);
    return pad;
  }

  /** 첫 판에서 아직 아무것도 누르지 않았을 때, 가운데 칸이 들썩여서 누를 곳을 알려 준다. */
  private pointOutMiddle(): void {
    const { cols, rows } = this.run.board;
    const pad = this.pads[Math.floor(rows / 2) * cols + Math.floor(cols / 2)];
    if (!pad) return;
    this.pointed = pad;
    this.tweens.add({
      targets: pad,
      scale: 1.1,
      duration: 340,
      ease: 'Sine.InOut',
      yoyo: true,
      repeat: -1,
    });
  }

  private stopPointing(): void {
    if (!this.pointed) return;
    this.tweens.killTweensOf(this.pointed);
    this.pointed.setScale(1);
    this.pointed = null;
  }

  // ───────── 입력 ─────────

  private bindInput(): void {
    const keyboard = this.input.keyboard;
    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    this.input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.cancelPress, this);
    // 키보드가 있으면 스페이스나 F로 모드를 바꾼다.
    keyboard?.on('keydown-SPACE', this.flipMode, this);
    keyboard?.on('keydown-F', this.flipMode, this);
    // 일시정지한 동안 시간을 들이지 않고 판을 궁리할 수 없게 칸을 가린다.
    this.events.on(Phaser.Scenes.Events.PAUSE, this.onPause, this);
    this.events.on(Phaser.Scenes.Events.RESUME, this.onResume, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.off(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
      this.input.off(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
      this.input.off(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
      this.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.cancelPress, this);
      keyboard?.off('keydown-SPACE', this.flipMode, this);
      keyboard?.off('keydown-F', this.flipMode, this);
      this.events.off(Phaser.Scenes.Events.PAUSE, this.onPause, this);
      this.events.off(Phaser.Scenes.Events.RESUME, this.onResume, this);
    });
  }

  private flipMode(): void {
    if (!this.playing) return;
    sfx.click();
    this.setMode(this.mode === 'open' ? 'flag' : 'open');
  }

  private onPause(): void {
    this.cancelPress();
    // 끝난 뒤 결과 화면이 뜰 때는 드러난 판을 그대로 보여 준다. 시간이 흐르지 않는 단계 모드에서도 가리지 않는다.
    if (this.playing && this.stageLevel === null) this.tileLayer.setVisible(false);
  }

  private onResume(): void {
    this.tileLayer.setVisible(true);
    // 아직 시간이 가지 않고 있었으면 숨 고를 시간도 필요 없다.
    if (!this.playing || !this.gate.open || this.stageLevel !== null) return;
    this.grace = RESUME_GRACE_SECONDS;
    showBanner(this, this.boardBox.y, '준비!', LOOK.text.ready, RESUME_GRACE_SECONDS * 1000, DEPTH.banner);
  }

  /** 칸을 누르기 시작했다. 손을 떼면 누른 것이고, 그대로 있으면 길게 누른 것이 된다. */
  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    // 위쪽 HUD(일시정지 버튼)를 누른 것은 칸을 누른 것이 아니다.
    if (!this.playing || this.grace > 0 || this.press || pointer.worldY < HUD_HEIGHT) return;
    const index = this.cellAt(pointer.worldX, pointer.worldY);
    if (index === null) return;

    this.gate.start();
    this.stopPointing();
    // 마우스가 있으면 오른쪽 단추가 곧 깃발이다.
    if (pointer.rightButtonDown()) {
      this.toggleFlag(index);
      return;
    }
    this.press = {
      index,
      pointerId: pointer.id,
      x: pointer.worldX,
      y: pointer.worldY,
      since: performance.now(),
    };
    this.showLens(index);
    const pad = this.pads[index];
    if (!pad) return;
    this.tweens.killTweensOf(pad);
    pad.setScale(PRESSED_SCALE);
  }

  /**
   * 칸이 작은 판에서는 손가락이 칸을 가리므로, 누른 칸을 손가락 위에 크게 띄워 보여 준다.
   * 눌러도 아무 일이 없는 칸(둘레에 함정이 없는 열린 칸, 드러난 함정)에는 띄우지 않는다.
   */
  private showLens(index: number): void {
    const { cell } = this.layout;
    if (cell >= LENS_BELOW_CELL) return;
    const { tiles, counts } = this.run.board;
    const tile = tiles[index];
    const count = counts[index];
    if (tile !== 'covered' && tile !== 'marked' && !(tile === 'open' && count > 0)) return;

    const spot = this.cellOnScreen(index);
    this.lens.show({ ...spot, size: cell }, HUD_HEIGHT + 2, (content) => {
      if (tile === 'open') {
        content.add(
          addText(this, 0, 0, String(count), {
            size: Math.round(LENS_ROOM * DIGIT_RATIO),
            color: LOOK.digits[count - 1],
            originX: 0.5,
            originY: 0.5,
          }),
        );
        return;
      }
      content.add(this.add.image(0, 0, padTexture(this, LENS_ROOM)));
      if (tile === 'marked') content.add(this.add.image(0, -1, flagTexture(this)).setScale(LENS_ROOM / ART_CELL));
    });
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    const press = this.press;
    if (!press || pointer.id !== press.pointerId) return;
    if (Math.hypot(pointer.worldX - press.x, pointer.worldY - press.y) > PRESS_SLOP) this.cancelPress();
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    const press = this.press;
    if (!press || pointer.id !== press.pointerId) return;
    this.cancelPress();
    if (this.playing) this.onTap(press.index);
  }

  /** 누르던 것을 없던 일로 한다. 눌려 있던 칸은 제 모양으로 돌아온다. */
  private cancelPress(): void {
    const press = this.press;
    if (!press) return;
    this.pads[press.index]?.setScale(1);
    this.press = null;
    this.lens.hide();
  }

  /**
   * 길게 눌렀다: 어느 모드에서든 깃발을 꽂거나 뽑는다. 손을 뗄 때는 더 아무 일도 하지 않는다.
   * 열린 칸은 깃발을 꽂을 수 없으니 그대로 두어서, 숫자를 조금 오래 눌렀다 떼도 둘레가 열린다.
   */
  private onLongPress(press: Press): void {
    const tile = this.run.board.tiles[press.index];
    if (tile !== 'covered' && tile !== 'marked') return;
    this.cancelPress();
    this.toggleFlag(press.index);
    vibrate(15);
  }

  /** 짧게 눌렀다: 열기 모드에서는 칸을 열고, 깃발 모드에서는 깃발을 꽂는다. 열린 숫자는 어느 모드에서든 둘레를 연다. */
  private onTap(index: number): void {
    const tile = this.run.board.tiles[index];
    if (this.mode === 'flag' && (tile === 'covered' || tile === 'marked')) {
      this.toggleFlag(index);
      return;
    }
    if (tile === 'marked') {
      this.refuseFlagged(index);
      return;
    }
    const { run, outcome } = tapTile(this.run, index, this.random);
    this.run = run;
    if (outcome.kind === 'opened') this.onOpened(index, outcome);
    else if (tile === 'open') this.nudgeAround(index);
  }

  /** 깃발 수가 맞지 않는 숫자를 눌렀다: 아직 덮인 둘레 칸이 움찔해서 그 숫자가 어느 칸을 세는지 보여 준다. */
  private nudgeAround(index: number): void {
    for (const cell of neighboursOf(this.run.board, index)) {
      const pad = this.pads[cell];
      if (!pad) continue;
      this.tweens.killTweensOf(pad);
      pad.setScale(1);
      this.tweens.add({ targets: pad, scale: PRESSED_SCALE, duration: 70, yoyo: true });
    }
  }

  // ───────── 깃발 ─────────

  /** 깃발을 꽂거나 뽑는다. 열린 칸이나 드러난 함정이면 아무 일도 없다. */
  private toggleFlag(index: number): void {
    const next = markTile(this.run, index);
    if (next === this.run) return;
    this.run = next;
    if (next.board.tiles[index] === 'marked') {
      this.addFlag(index, 0);
      sfx.pop();
    } else {
      this.removeFlag(index);
      sfx.pull();
    }
    this.showTrapsLeft(true);
  }

  /** 깃발이 톡 튀어나오며 꽂힌다. */
  private addFlag(index: number, delay: number): void {
    const { x, y } = this.cellSpot(index);
    const size = this.layout.cell / ART_CELL;
    const flag = this.add.image(x, y - 1, flagTexture(this)).setScale(0);
    this.tileLayer.add(flag);
    this.flags.set(index, flag);
    this.tweens.add({ targets: flag, scale: size, delay, duration: 150, ease: 'Back.Out' });
  }

  private removeFlag(index: number): void {
    const flag = this.flags.get(index);
    if (!flag) return;
    this.flags.delete(index);
    this.tweens.killTweensOf(flag);
    this.tweens.add({
      targets: flag,
      scale: 0,
      duration: 90,
      ease: 'Quad.In',
      onComplete: () => flag.destroy(),
    });
  }

  /** 깃발이 꽂힌 칸은 열리지 않는다. 깃발이 도리도리 흔들려서 알려 준다. */
  private refuseFlagged(index: number): void {
    const flag = this.flags.get(index);
    if (!flag) return;
    sfx.deny();
    this.tweens.killTweensOf(flag);
    flag.setScale(this.layout.cell / ART_CELL).setAngle(0);
    this.tweens.add({
      targets: flag,
      angle: { from: -14, to: 14 },
      duration: 60,
      yoyo: true,
      repeat: 1,
      onComplete: () => flag.setAngle(0),
    });
  }

  /** 판을 깨면 깃발을 꽂지 않은 함정에도 깃발이 마저 꽂힌다. */
  private plantMissingFlags(): void {
    let planted = 0;
    this.run.board.tiles.forEach((tile, index) => {
      if (tile !== 'marked' || this.flags.has(index)) return;
      this.addFlag(index, planted * 30);
      planted += 1;
    });
  }

  // ───────── 칸 열기 ─────────

  private onOpened(index: number, outcome: Opened): void {
    if (outcome.first) this.onFirstOpen();
    outcome.opened.forEach((cell, order) => {
      this.openPad(cell, Math.min(order * RIPPLE_STEP_MS, RIPPLE_MAX_MS));
    });
    this.hud.setScore(this.run.score);

    const spot = this.cellOnScreen(index);
    if (outcome.points > 0) {
      if (outcome.opened.length > 3) sfx.whoosh();
      else sfx.flip();
      vibrate(8);
      this.sparks.open.explode(Math.min(10, 2 + outcome.opened.length), spot.x, spot.y);
      this.floatPoints(
        spot.x,
        spot.y - this.layout.cell / 2,
        outcome.points,
        LOOK.text.points,
        this.playArea,
        DEPTH.effect,
      );
    }
    if (outcome.tripped.length > 0) this.onTripped(outcome.tripped);

    if (isOver(this.run)) this.endRun();
    else if (outcome.cleared) this.onBoardCleared(outcome.cleared);
  }

  /** 판의 첫 칸을 열었다. 이때 함정이 놓였으므로 함정 수를 다시 적고, 첫 판이면 숫자 읽는 법을 알려 준다. */
  private onFirstOpen(): void {
    this.showTrapsLeft(false);
    if (this.run.stage === 1) this.showHints([HINTS.numbers, HINTS.flags]);
  }

  /** 덮개가 움츠러들며 사라지고, 둘레에 함정이 있으면 그 수가 나타난다. */
  private openPad(index: number, delay: number): void {
    this.removePad(index, delay);
    const count = this.run.board.counts[index];
    if (count === 0) return;
    const { x, y } = this.cellSpot(index);
    const digit = addText(this, x, y, String(count), {
      size: Math.round(this.layout.cell * DIGIT_RATIO),
      color: LOOK.digits[count - 1],
      originX: 0.5,
      originY: 0.5,
    }).setScale(0);
    this.tileLayer.add(digit);
    this.tweens.add({
      targets: digit,
      scale: 1,
      delay: delay + OPEN_MS / 2,
      duration: OPEN_MS,
      ease: 'Back.Out',
    });
  }

  private removePad(index: number, delay: number): void {
    const pad = this.pads[index];
    if (!pad) return;
    this.pads[index] = null;
    this.tweens.killTweensOf(pad);
    this.tweens.add({
      targets: pad,
      scale: 0.3,
      alpha: 0,
      delay,
      duration: OPEN_MS,
      ease: 'Quad.In',
      onComplete: () => pad.destroy(),
    });
  }

  // ───────── 함정 ─────────

  /** 함정을 밟았다: 고슴도치가 튀어나오고 목숨이 줄어든다. */
  private onTripped(cells: readonly number[]): void {
    for (const cell of cells) this.showHog(cell, 'awake', 0);
    this.drawHeartsView();
    this.showTrapsLeft(true);
    sfx.miss();
    vibrate([30, 30, 60]);
    this.cameras.main.shake(140, 0.006);

    const spot = this.cellOnScreen(cells[0]);
    this.sparks.trip.explode(8, spot.x, spot.y);
    floatText(
      this,
      spot.x,
      spot.y - this.layout.cell / 2,
      '따끔!',
      LOOK.text.bad,
      this.playArea,
      DEPTH.effect,
    );
  }

  /** 칸의 덮개를 걷고 고슴도치를 보여 준다. 밟은 것(awake)은 바닥도 붉게 물든다. */
  private showHog(index: number, mood: HogMood, delay: number): void {
    const { x, y } = this.cellSpot(index);
    const size = this.layout.cell / ART_CELL;
    this.removePad(index, delay);
    if (mood === 'awake') {
      const floor = this.add.graphics().setPosition(x, y);
      drawTrippedFloor(floor, this.layout.cell);
      this.tileLayer.add(floor);
    }
    const hog = this.add.image(x, y, hogTexture(this, mood)).setScale(0);
    this.tileLayer.add(hog);
    this.tweens.add({ targets: hog, scale: size, delay, duration: 180, ease: 'Back.Out' });
  }

  /** 끝났을 때 아직 숨어 있던 함정을 하나씩 보여 준다. 깃발을 꽂아 둔 칸은 그대로 둔다. */
  private unveilHogs(): void {
    const { traps, tiles } = this.run.board;
    if (!traps) return;
    let shown = 0;
    traps.forEach((isTrap, index) => {
      if (!isTrap || tiles[index] !== 'covered') return;
      this.showHog(index, 'asleep', Math.min(shown * UNVEIL_STEP_MS, UNVEIL_MAX_MS));
      shown += 1;
    });
  }

  // ───────── 판이 바뀜 ─────────

  private onBoardCleared(reward: ClearReward): void {
    // 다음 판이 깔릴 때까지 시간이 멈춘다.
    this.playing = false;
    this.lastTickSecond = 0;
    this.cancelPress();
    this.hud.setTime(this.run.timeLeft, TIME_BANK_SECONDS);
    this.clearHints();
    this.plantMissingFlags();
    this.showTrapsLeft(false);

    if (this.stageLevel !== null) {
      // 단계 모드는 판 하나가 한 판이다. 다음 단계는 결과 화면에서 고른다.
      this.time.delayedCall(CLEAR_BANNER_MS, () => {
        sfx.gold();
        vibrate([15, 30, 15]);
        this.sparks.clear.explode(18, GAME_WIDTH / 2, this.boardBox.y);
        const title = reward.flawless ? '완벽해요!' : '클리어!';
        showBanner(this, this.boardBox.y, title, LOOK.text.good, 900, DEPTH.banner);
      });
      this.finishStage(true, this.stageStats(), CLEAR_BANNER_MS + 1000);
      return;
    }

    this.time.delayedCall(CLEAR_BANNER_MS, () => {
      sfx.gold();
      vibrate([15, 30, 15]);
      this.sparks.clear.explode(18, GAME_WIDTH / 2, this.boardBox.y);
      this.showClearBanner(reward, NEXT_BOARD_MS - CLEAR_BANNER_MS);
    });
    this.time.delayedCall(NEXT_BOARD_MS, () => {
      this.run = nextStage(this.run);
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
    this.cancelPress();
    this.stopPointing();
    this.clearHints();
    this.unveilHogs();
    showBanner(this, this.boardBox.y, '끝!', LOOK.text.over, 900, DEPTH.banner);
    if (this.stageLevel !== null) {
      // 숨어 있던 함정이 다 드러난 뒤에 결과를 띄운다.
      this.finishStage(false, this.stageStats(), 1400);
      return;
    }
    this.finishMiniGame(this.run.score, [
      ['깬 판', `${this.run.boardsCleared}판`],
      ['연 칸', `${this.run.tilesOpened}칸`],
      ['밟은 함정', `${this.run.trapsTripped}개`],
    ]);
  }

  /** 단계 모드의 결과 화면에 적는 것 */
  private stageStats(): ResultStat[] {
    return [
      ['연 칸', `${this.run.tilesOpened}칸`],
      ['밟은 함정', `${this.run.trapsTripped}개`],
    ];
  }
}
