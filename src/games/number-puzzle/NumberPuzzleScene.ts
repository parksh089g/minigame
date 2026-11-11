import Phaser from 'phaser';
import { TEXTURE } from '../../art/sprites';
import { GAME_WIDTH, SCENE } from '../../config';
import { vibrate } from '../../core/haptics';
import { sfx } from '../../core/sfx';
import { addBackdrop, addText } from '../../core/ui';
import { floatText, GameHud, HUD_HEIGHT, showBanner } from '../../scenes/GameHud';
import { MiniGameScene } from '../../scenes/MiniGameScene';
import {
  digitSize,
  drawBoard,
  drawCellFlash,
  drawCellPlate,
  drawCellRing,
  drawCells,
  drawHearts,
  drawPadFace,
  drawPadLip,
  drawPlate,
  heartsWidth,
  LOOK,
  PAD_LIP,
  type PadLook,
} from './art';
import {
  boardLayout,
  cellArea,
  cellAt,
  countBlanks,
  elapse,
  highlightedDigit,
  HINT_ROOM,
  isDigitDone,
  isOver,
  moveCursor,
  newRun,
  nextStage,
  NO_SELECTION,
  padDigitAt,
  peersOf,
  placeDigit,
  pressCell,
  pressDigit,
  settleSelection,
  START_HEARTS,
  TIME_BANK_SECONDS,
  type Area,
  type Attempt,
  type BoardLayout,
  type PlaceOutcome,
  type Press,
  type RunState,
  type Selection,
} from './rules';

/**
 * dealing: 새 판이 나타나는 중, idle: 칸과 숫자를 고르는 중(이때만 시간이 흐른다),
 * cleared: 판을 다 채워서 다음 판을 기다리는 중, over: 시간이나 목숨이 다해서 끝남
 */
type Phase = 'dealing' | 'idle' | 'cleared' | 'over';

type Placed = Extract<PlaceOutcome, { kind: 'placed' }>;
type Wrong = Extract<PlaceOutcome, { kind: 'wrong' }>;

interface PadButton {
  digit: number;
  area: Area;
  lip: Phaser.GameObjects.Graphics;
  /** 윗면과 숫자를 담는 그릇. 누르면 이것만 살짝 내려간다. */
  top: Phaser.GameObjects.Container;
  face: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  look: PadLook | null;
}

/** 새 판이 나타나는 시간(ms). 이동안은 눌러도 골라지지 않고 시간도 흐르지 않는다. */
const DEAL_MS = 180;
/** 마지막 칸을 채운 뒤 "클리어!"가 뜨기까지, 그리고 다음 판이 나오기까지(ms). 그동안 시간은 멈춘다. */
const CLEAR_BANNER_MS = 240;
const NEXT_BOARD_MS = 1150;
/** 마지막 목숨을 잃은 뒤 끝을 알리기까지(ms). 틀린 칸이 흔들리는 것을 볼 틈이다. */
const END_PAUSE_MS = 500;
/** 일시정지에서 돌아온 뒤 다시 시간이 흐르기까지의 여유(초). 가려 두었던 판을 다시 볼 틈을 준다. */
const RESUME_GRACE_SECONDS = 0.6;
/** 처음에 보여 주는 도움말이 사라지기 시작하는 때(ms). 그 전에 첫 숫자를 맞게 두면 바로 사라진다. */
const HINT_MS = 9000;
/** 남은 시간이 이 아래로 내려가면 1초마다 소리로 알린다 */
const TICK_FROM_SECONDS = 5;
/**
 * 틀린 칸이 흔들리는 시간(ms). 그동안은 그 칸에 다시 두려고 해도 받지 않아서,
 * 손가락이 두 번 닿아 하트를 두 개 잃는 일이 없다.
 */
const WRONG_SHAKE_MS = 360;
/** 숫자 버튼이 눌려 들어가는 깊이(px)와 되돌아오는 시간(ms) */
const PAD_PRESS = { depth: 2, ms: 130 } as const;
/** 숫자 버튼의 글자 크기 */
const PAD_FONT_SIZE = 20;

/** 남은 칸 수를 적는 판에서 글자 양옆에 두는 여백(px) */
const TAG_PADDING = 7;

/** 판 위의 줄(strip)은 떠오르는 점수 글자보다 위에 있어서, 맨 윗줄의 점수는 그 뒤로 지나간다. */
const DEPTH = { board: 5, effect: 20, strip: 25, hud: 30, banner: 40 } as const;

/** 방향키가 고른 칸을 옮기는 쪽(가로, 세로) */
const ARROWS: Readonly<Record<string, readonly [dCol: number, dRow: number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * 숫자 퍼즐: 가로줄, 세로줄, 상자마다 숫자가 한 번씩 들어가게 빈칸을 채운다.
 * 빈칸을 누르고 아래의 숫자를 누르면(또는 숫자를 먼저 누르고 빈칸을 누르면) 맞는 숫자만 들어가고,
 * 틀리면 하트가 하나 줄어든다. 판을 다 채우면 시간을 조금 돌려받고 더 큰 판이 나온다.
 * 시간이나 하트가 다 떨어지면 끝난다.
 */
export class NumberPuzzleScene extends MiniGameScene {
  protected readonly gameId = 'number-puzzle';

  private run!: RunState;
  private selection: Selection = NO_SELECTION;
  private phase: Phase = 'dealing';
  /** 0보다 크면 일시정지에서 막 돌아와 잠깐 멈춰 있는 중 */
  private grace = 0;
  private lastTickSecond = 0;
  /** 이번 판에서 틀리지 않고 이어서 채운 칸의 수. 이어질수록 효과음이 높아진다. */
  private streak = 0;
  /** 방금 틀려서 흔들리고 있는 칸과, 흔들림이 끝나는 때(씬 시계, ms) */
  private shaking: { cell: number; until: number } | null = null;

  private layout!: BoardLayout;
  private playArea!: Phaser.Geom.Rectangle;
  private hud!: GameHud;
  /** 판에 속한 것을 모두 담는 그릇. 일시정지 중에 통째로 가린다. */
  private boardLayer!: Phaser.GameObjects.Container;
  private cellsView!: Phaser.GameObjects.Graphics;
  /** 칸의 면과 숫자 사이에 끼어, 번쩍이는 표시가 놓이는 층 */
  private flashLayer!: Phaser.GameObjects.Container;
  /** 숫자 위에 놓이는 것: 틀려서 흔들리는 칸, 처음에 누를 칸을 알려 주는 고리 */
  private overLayer!: Phaser.GameObjects.Container;
  /** 칸마다의 숫자 글자. 빈칸은 빈 글자다. */
  private digits: Phaser.GameObjects.Text[] = [];
  private padLayer!: Phaser.GameObjects.Container;
  private pads: PadButton[] = [];
  private heartsView!: Phaser.GameObjects.Graphics;
  /** 남은 칸 수와 그 밑의 판 */
  private blanksPlate!: Phaser.GameObjects.Graphics;
  private blanksText!: Phaser.GameObjects.Text;
  /** 처음에 떠 있는 도움말 줄들. 사라진 뒤에는 비어 있다. */
  private hints: Phaser.GameObjects.Text[] = [];
  /** 첫 판에서 누를 칸을 알려 주는 고리 */
  private pointer: Phaser.GameObjects.Graphics | null = null;
  private confetti!: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor() {
    super(SCENE.numberPuzzle);
  }

  create(): void {
    this.beginMiniGame();
    this.resetState();

    this.playArea = new Phaser.Geom.Rectangle(
      0,
      HUD_HEIGHT,
      GAME_WIDTH,
      this.scale.height - HUD_HEIGHT,
    );

    addBackdrop(this);
    this.boardLayer = this.add.container(0, 0).setDepth(DEPTH.board);
    this.padLayer = this.add.container(0, 0).setDepth(DEPTH.board);
    this.heartsView = this.add.graphics().setDepth(DEPTH.strip);
    this.blanksPlate = this.add.graphics().setDepth(DEPTH.strip);
    this.blanksText = addText(this, 0, 0, '', {
      color: LOOK.text.blanks,
      originX: 0.5,
      originY: 0.5,
    }).setDepth(DEPTH.strip);
    this.confetti = this.add
      .particles(0, 0, TEXTURE.spark, {
        speed: { min: 40, max: 130 },
        lifespan: { min: 220, max: 440 },
        alpha: { start: 1, end: 0 },
        tint: [...LOOK.confetti],
        emitting: false,
      })
      .setDepth(DEPTH.effect);

    this.addPauseButton();
    this.hud = new GameHud(this, DEPTH.hud);
    this.drawTime();

    this.listen();
    this.deal();
    this.showHints();
    this.pointOutBlank();
    sfx.go();
    this.playing = true;
  }

  override update(_time: number, deltaMs: number): void {
    if (!this.playing || this.phase !== 'idle') return;
    // 탭이 가려졌다 돌아와도 시간이 한꺼번에 흐르지 않게 한 프레임의 길이를 제한한다.
    const dt = Math.min(deltaMs, 100) / 1000;
    if (this.grace > 0) {
      this.grace -= dt;
      return;
    }

    this.run = elapse(this.run, dt);
    this.drawTime();
    if (isOver(this.run)) {
      sfx.expire();
      this.endRun();
      return;
    }
    const second = Math.ceil(this.run.timeLeft);
    if (second <= TICK_FROM_SECONDS && second !== this.lastTickSecond) {
      this.lastTickSecond = second;
      sfx.tick();
    }
  }

  private resetState(): void {
    this.run = newRun(Math.random);
    this.selection = NO_SELECTION;
    this.phase = 'dealing';
    this.grace = 0;
    this.lastTickSecond = 0;
    this.streak = 0;
    this.shaking = null;
    this.digits = [];
    this.pads = [];
    this.hints = [];
    this.pointer = null;
  }

  /** 터치, 키보드, 일시정지를 듣는다. 씬이 닫힐 때 모두 거둔다. */
  private listen(): void {
    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    // 일시정지한 동안 시간 걱정 없이 판을 들여다볼 수 없게 가린다.
    this.events.on(Phaser.Scenes.Events.PAUSE, this.onPause, this);
    this.events.on(Phaser.Scenes.Events.RESUME, this.onResume, this);
    const keyboard = this.input.keyboard;
    keyboard?.on('keydown', this.onKeyDown, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.off(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
      this.events.off(Phaser.Scenes.Events.PAUSE, this.onPause, this);
      this.events.off(Phaser.Scenes.Events.RESUME, this.onResume, this);
      keyboard?.off('keydown', this.onKeyDown, this);
    });
  }

  // ───────── 판 깔기 ─────────

  /** 지금 판을 화면에 깐다. 다 나타나면 시간이 흐르기 시작한다. */
  private deal(): void {
    const { puzzle, stage } = this.run;
    this.layout = boardLayout(puzzle.size, this.playArea);
    this.selection = NO_SELECTION;
    this.streak = 0;
    this.shaking = null;
    this.lastTickSecond = 0;

    this.buildBoard();
    this.buildPad();
    this.refresh();
    this.hud.setSide(`${stage}판`, stage > 1);
    if (stage > 1) sfx.pop();

    this.phase = 'dealing';
    this.tweens.add({
      targets: [this.boardLayer, this.padLayer],
      alpha: { from: 0, to: 1 },
      duration: DEAL_MS,
      onComplete: () => {
        if (this.phase === 'dealing') this.phase = 'idle';
      },
    });
  }

  /** 그릇에 든 것을 모두 없앤다. 움직이던 것은 먼저 멈춘다. */
  private emptyLayer(layer: Phaser.GameObjects.Container): void {
    const stop = (object: Phaser.GameObjects.GameObject): void => {
      this.tweens.killTweensOf(object);
      if (object instanceof Phaser.GameObjects.Container) object.list.forEach(stop);
    };
    layer.list.forEach(stop);
    layer.removeAll(true);
  }

  private cellCenter(cell: number): { x: number; y: number } {
    const area = cellArea(this.layout, cell);
    return { x: area.x + area.width / 2, y: area.y + area.height / 2 };
  }

  private buildBoard(): void {
    this.emptyLayer(this.boardLayer);
    this.pointer = null;

    const card = this.add.graphics();
    drawBoard(card, this.layout);
    this.cellsView = this.add.graphics();
    this.flashLayer = this.add.container(0, 0);
    this.overLayer = this.add.container(0, 0);
    const size = digitSize(this.layout);
    this.digits = this.run.grid.map((value, cell) => {
      const { x, y } = this.cellCenter(cell);
      return addText(this, x, y, value === 0 ? '' : String(value), {
        size,
        color: LOOK.digit.given,
        originX: 0.5,
        originY: 0.5,
      });
    });
    this.boardLayer.add([card, this.cellsView, this.flashLayer, ...this.digits, this.overLayer]);
  }

  private buildPad(): void {
    this.emptyLayer(this.padLayer);
    this.pads = this.layout.pad.map((area, index) => {
      const lip = this.add.graphics().setPosition(area.x, area.y);
      const face = this.add.graphics();
      const label = addText(this, area.width / 2, (area.height - PAD_LIP) / 2, String(index + 1), {
        size: PAD_FONT_SIZE,
        originX: 0.5,
        originY: 0.5,
      });
      const top = this.add.container(area.x, area.y, [face, label]);
      this.padLayer.add([lip, top]);
      return { digit: index + 1, area, lip, top, face, label, look: null };
    });
  }

  /** 판 바로 위의 줄: 왼쪽 끝에 하트, 오른쪽 끝에 남은 칸 수 */
  private drawStrip(): void {
    const { strip } = this.layout;
    const centerY = strip.y + strip.height / 2;
    this.heartsView.setPosition(strip.x + heartsWidth(START_HEARTS) / 2, centerY);
    drawHearts(this.heartsView, this.run.hearts, START_HEARTS);

    this.blanksText.setText(`남은 칸 ${countBlanks(this.run.grid)}`);
    const width = Math.ceil(this.blanksText.width) + TAG_PADDING * 2;
    const centerX = strip.x + strip.width - width / 2;
    this.blanksPlate.setPosition(centerX, centerY);
    drawPlate(this.blanksPlate, width);
    this.blanksText.setPosition(Math.round(centerX), Math.round(centerY));
  }

  private drawTime(): void {
    this.hud.setTime(this.run.timeLeft, TIME_BANK_SECONDS);
  }

  /** 고른 것과 판의 모습에 맞게 칸의 면, 숫자 버튼, 판 위의 줄을 다시 그린다. */
  private refresh(): void {
    const { grid, puzzle } = this.run;
    const { cursor, armed } = this.selection;
    drawCells(this.cellsView, this.layout, puzzle.givens, grid, {
      cursor,
      peers: cursor === null ? [] : peersOf(puzzle.size, cursor),
      digit: highlightedDigit(grid, this.selection),
    });
    for (const pad of this.pads) {
      const done = isDigitDone(grid, puzzle.size, pad.digit);
      this.setPadLook(pad, done ? 'done' : pad.digit === armed ? 'armed' : 'idle');
    }
    this.drawStrip();
  }

  private setPadLook(pad: PadButton, look: PadLook): void {
    if (pad.look === look) return;
    pad.look = look;
    drawPadLip(pad.lip, pad.area, look);
    drawPadFace(pad.face, pad.area, look);
    pad.label.setColor(LOOK.pad[look].text);
    // 다 쓴 숫자는 눌린 채로 납작하게 둔다.
    this.tweens.killTweensOf(pad.top);
    pad.top.setY(pad.area.y + (look === 'done' ? PAD_LIP : 0));
  }

  // ───────── 도움말 ─────────

  /** 첫 판 바로 위에 도움말 두 줄을 잠깐 띄운다. */
  private showHints(): void {
    const top = this.layout.strip.y - HINT_ROOM + 1;
    this.hints = [
      addText(this, GAME_WIDTH / 2, top, '빈칸을 누르고 숫자를 골라요', {
        color: LOOK.text.hint,
        originX: 0.5,
        stroke: LOOK.text.outline,
      }),
      addText(this, GAME_WIDTH / 2, top + 16, '가로, 세로, 상자에 한 번씩만 들어가요', {
        color: LOOK.text.hintSub,
        originX: 0.5,
        stroke: LOOK.text.outline,
      }),
    ];
    for (const line of this.hints) line.setDepth(DEPTH.hud);
    this.fadeHints(HINT_MS);
  }

  /** delayMs 뒤에 도움말을 흐리게 지운다. 이미 지워지는 중이면 새로 정한 때에 맞춘다. */
  private fadeHints(delayMs: number): void {
    const lines = this.hints;
    if (lines.length === 0) return;
    this.tweens.killTweensOf(lines);
    this.tweens.add({
      targets: lines,
      alpha: 0,
      delay: delayMs,
      duration: 400,
      onComplete: () => {
        for (const line of lines) line.destroy();
        if (this.hints === lines) this.hints = [];
      },
    });
  }

  /** 첫 판에서 아직 아무것도 누르지 않았을 때, 빈칸 하나에 고리가 깜빡여서 누를 곳을 알려 준다. */
  private pointOutBlank(): void {
    const cell = this.run.grid.indexOf(0);
    if (cell < 0) return;
    const { x, y } = this.cellCenter(cell);
    const ring = this.add.graphics().setPosition(x, y);
    drawCellRing(ring, this.layout);
    this.overLayer.add(ring);
    this.pointer = ring;
    this.tweens.add({
      targets: ring,
      scale: { from: 1, to: 1.12 },
      alpha: { from: 1, to: 0.35 },
      duration: 420,
      ease: 'Sine.InOut',
      yoyo: true,
      repeat: -1,
    });
  }

  private stopPointing(): void {
    if (!this.pointer) return;
    this.tweens.killTweensOf(this.pointer);
    this.pointer.destroy();
    this.pointer = null;
  }

  // ───────── 입력 ─────────

  private get canPlay(): boolean {
    return this.playing && this.phase === 'idle' && this.grace <= 0;
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    // 위쪽 HUD(일시정지 버튼)를 누른 것은 칸이나 숫자를 고른 것이 아니다.
    if (!this.canPlay || pointer.worldY < HUD_HEIGHT) return;
    const digit = padDigitAt(this.layout, pointer.worldX, pointer.worldY);
    if (digit !== null) {
      this.onDigit(digit);
      return;
    }
    const cell = cellAt(this.layout, pointer.worldX, pointer.worldY);
    if (cell !== null) this.apply(pressCell(this.run.grid, this.selection, cell));
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (!this.canPlay) return;
    const arrow = ARROWS[event.key];
    if (arrow) {
      event.preventDefault();
      const { grid, puzzle } = this.run;
      this.stopPointing();
      this.selection = moveCursor(grid, puzzle.size, this.selection, arrow[0], arrow[1]);
      this.refresh();
      return;
    }
    const digit = Number.parseInt(event.key, 10);
    if (event.key.length === 1 && digit >= 1 && digit <= this.run.puzzle.size) this.onDigit(digit);
  }

  /** 숫자 버튼을 눌렀거나 숫자 키를 쳤을 때 */
  private onDigit(digit: number): void {
    const { grid, puzzle } = this.run;
    if (isDigitDone(grid, puzzle.size, digit)) {
      sfx.deny();
      return;
    }
    this.apply(pressDigit(grid, puzzle.size, this.selection, digit));
    // 방금 둔 것으로 이 숫자가 다 들어갔으면 버튼은 눌린 채로 남는다.
    if (!isDigitDone(this.run.grid, puzzle.size, digit)) this.pressPad(digit);
  }

  /** 누른 결과를 받아들인다: 고른 것을 바꾸고, 숫자를 두게 되었으면 둔다. */
  private apply(press: Press): void {
    this.stopPointing();
    this.selection = press.selection;
    if (press.attempt) {
      this.attempt(press.attempt);
      return;
    }
    sfx.flip();
    this.refresh();
  }

  /** 숫자 버튼의 윗면이 쑥 들어갔다가 올라온다. */
  private pressPad(digit: number): void {
    const pad = this.pads[digit - 1];
    this.tweens.killTweensOf(pad.top);
    this.tweens.add({
      targets: pad.top,
      y: { from: pad.area.y + PAD_PRESS.depth, to: pad.area.y },
      duration: PAD_PRESS.ms,
      ease: 'Quad.Out',
    });
  }

  // ───────── 숫자 두기 ─────────

  private attempt(attempt: Attempt): void {
    // 방금 틀려서 흔들리는 칸은 흔들림이 끝날 때까지 받지 않는다.
    if (this.shaking?.cell === attempt.cell && this.time.now < this.shaking.until) return;
    const { run, outcome } = placeDigit(this.run, attempt.cell, attempt.digit);
    this.run = run;
    if (outcome.kind === 'placed') this.onPlaced(outcome);
    else if (outcome.kind === 'wrong') this.onWrong(outcome);
  }

  private onPlaced(outcome: Placed): void {
    const { cell, digit } = outcome;
    const { grid, puzzle, score } = this.run;
    this.selection = settleSelection(grid, puzzle.size, this.selection, { cell, digit });

    const text = this.digits[cell].setText(String(digit)).setColor(LOOK.digit.placed);
    this.tweens.add({ targets: text, scale: { from: 1.6, to: 1 }, duration: 170, ease: 'Back.Out' });
    for (const unit of outcome.filledUnits) this.flashCells(unit, LOOK.cell.filled, 520);

    sfx.hit(this.streak);
    this.streak += 1;
    vibrate(8);
    this.hud.setScore(score);
    const { x } = this.cellCenter(cell);
    const top = cellArea(this.layout, cell).y + 3;
    floatText(this, x, top, `+${outcome.points}`, LOOK.text.points, this.playArea, DEPTH.effect);
    this.fadeHints(0);
    // 다 채운 판은 고른 표시 없이 깨끗하게 보여 준다.
    if (outcome.cleared) this.selection = NO_SELECTION;
    this.refresh();
    if (outcome.cleared) this.onCleared(outcome.cleared);
  }

  private onWrong(outcome: Wrong): void {
    this.streak = 0;
    this.shaking = { cell: outcome.cell, until: this.time.now + WRONG_SHAKE_MS };
    this.shakeCell(outcome.cell, outcome.digit);
    this.flashCells(outcome.clashes, LOOK.cell.wrong, WRONG_SHAKE_MS + 240);

    this.drawStrip();
    this.tweens.killTweensOf(this.heartsView);
    this.tweens.add({
      targets: this.heartsView,
      scale: { from: 1.25, to: 1 },
      duration: 220,
      ease: 'Back.Out',
    });
    sfx.miss();
    vibrate([20, 30, 20]);
    this.cameras.main.shake(120, 0.005);

    if (!isOver(this.run)) return;
    this.phase = 'over';
    this.time.delayedCall(END_PAUSE_MS, () => this.endRun());
  }

  /** 틀린 숫자가 붉은 칸에 실려 좌우로 흔들리다 사라진다. 그 숫자는 판에 남지 않는다. */
  private shakeCell(cell: number, digit: number): void {
    const { x, y } = this.cellCenter(cell);
    const plate = this.add.graphics();
    drawCellPlate(plate, this.layout, LOOK.cell.wrong);
    const label = addText(this, 0, 0, String(digit), {
      size: digitSize(this.layout),
      color: LOOK.digit.wrong,
      originX: 0.5,
      originY: 0.5,
    });
    const tile = this.add.container(x, y, [plate, label]);
    this.overLayer.add(tile);
    this.tweens.add({
      targets: tile,
      x: { from: x - 3, to: x + 3 },
      duration: WRONG_SHAKE_MS / 6,
      ease: 'Sine.InOut',
      yoyo: true,
      repeat: 2,
      onComplete: () => {
        this.tweens.add({
          targets: tile,
          alpha: 0,
          duration: 160,
          onComplete: () => tile.destroy(),
        });
      },
    });
  }

  /** 칸들이 한 가지 색으로 번쩍였다가 사라진다. */
  private flashCells(cells: readonly number[], color: number, durationMs: number): void {
    if (cells.length === 0) return;
    const flash = this.add.graphics();
    drawCellFlash(flash, this.layout, cells, color);
    this.flashLayer.add(flash);
    this.tweens.add({
      targets: flash,
      alpha: { from: 0.9, to: 0 },
      duration: durationMs,
      ease: 'Quad.In',
      onComplete: () => flash.destroy(),
    });
  }

  // ───────── 판이 바뀜 ─────────

  private get boardCenterY(): number {
    return this.layout.board.y + this.layout.board.height / 2;
  }

  private onCleared(cleared: { points: number; seconds: number }): void {
    // 다음 판이 나올 때까지 시간이 멈춘다.
    this.phase = 'cleared';
    this.drawTime();

    this.time.delayedCall(CLEAR_BANNER_MS, () => {
      sfx.gold();
      vibrate([15, 30, 15]);
      this.confetti.explode(18, GAME_WIDTH / 2, this.boardCenterY);
      this.showClearBanner(cleared, NEXT_BOARD_MS - CLEAR_BANNER_MS);
    });
    this.time.delayedCall(NEXT_BOARD_MS, () => {
      this.run = nextStage(this.run, Math.random);
      this.deal();
    });
  }

  /** 다 채운 판 한가운데에 "클리어!"와, 그 아래에 받은 점수와 돌려받은 시간을 띄운다. */
  private showClearBanner(cleared: { points: number; seconds: number }, durationMs: number): void {
    const centerY = this.boardCenterY;
    showBanner(this, centerY, '클리어!', LOOK.text.clear, durationMs, DEPTH.banner);
    // 시간이 이미 가득해서 돌려받은 것이 없으면 점수만 보여 준다.
    const seconds = Math.round(cleared.seconds);
    const label = seconds >= 1 ? `+${cleared.points}점  +${seconds}초` : `+${cleared.points}점`;
    const text = addText(this, 0, 0, label, { color: LOOK.text.points, originX: 0.5, originY: 0.5 });
    // 숫자가 빽빽한 판 위에서도 읽히게 흰 판을 받친다.
    const plate = this.add.graphics();
    drawPlate(plate, Math.ceil(text.width) + TAG_PADDING * 2);
    const bonus = this.add.container(GAME_WIDTH / 2, Math.round(centerY + 34), [plate, text]);
    bonus.setDepth(DEPTH.banner);
    this.tweens.add({
      targets: bonus,
      alpha: 0,
      delay: durationMs * 0.6,
      duration: durationMs * 0.4,
      onComplete: () => bonus.destroy(),
    });
  }

  private onPause(): void {
    if (this.playing) this.boardLayer.setVisible(false);
  }

  private onResume(): void {
    this.boardLayer.setVisible(true);
    // 판을 고르던 중이 아니면 시간이 흐르고 있지 않았으니 여유도 필요 없다.
    if (!this.playing || this.phase !== 'idle') return;
    this.grace = RESUME_GRACE_SECONDS;
    const ms = RESUME_GRACE_SECONDS * 1000;
    showBanner(this, this.boardCenterY, '준비!', LOOK.text.ready, ms, DEPTH.banner);
  }

  private endRun(): void {
    this.phase = 'over';
    this.stopPointing();
    this.selection = NO_SELECTION;
    this.refresh();
    showBanner(this, this.boardCenterY, '끝!', LOOK.text.over, 900, DEPTH.banner);
    this.finishMiniGame(this.run.score, [
      ['깬 판', `${this.run.puzzlesCleared}판`],
      ['채운 칸', `${this.run.cellsFilled}칸`],
      ['틀린 횟수', `${this.run.mistakes}번`],
    ]);
  }
}
