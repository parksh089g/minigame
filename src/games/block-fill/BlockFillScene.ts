import Phaser from 'phaser';
import { mascotTexture } from '../../art/cosmetics';
import { TEXTURE } from '../../art/sprites';
import { FONT_SIZE, GAME_WIDTH, SCENE } from '../../config';
import { vibrate } from '../../core/haptics';
import { sfx } from '../../core/sfx';
import { store } from '../../core/store';
import { addBackdrop, addText } from '../../core/ui';
import { GameHud, HUD_HEIGHT } from '../../scenes/GameHud';
import { MiniGameScene } from '../../scenes/MiniGameScene';
import {
  BLOCK_ART,
  blockColor,
  blockTexture,
  drawBoard,
  drawTray,
  LOOK,
  registerBlockTextures,
} from './art';
import {
  BOARD_RIM,
  boardCoords,
  CELLS,
  dragCenter,
  DRAG_LIFT,
  fitsAnywhere,
  layoutFor,
  linesAfter,
  newRun,
  placePiece,
  SIZE,
  slotAt,
  snapTarget,
  TRAY_SIZE,
  type Layout,
  type Piece,
  type Placement,
  type RunState,
} from './rules';

// ───────── 움직임 ─────────

/** 쟁반의 블록을 집으면 판의 크기로 커지며 손가락 위로 떠오르는 시간(ms) */
const PICKUP_MS = 90;
/** 놓을 수 없는 곳에서 손을 떼면 쟁반으로 돌아가는 시간(ms) */
const RETURN_MS = 150;
/** 손을 떼면 블록이 들려 있던 자리에서 칸으로 미끄러져 들어가는 시간(ms) */
const SETTLE_MS = 70;
/** 놓인 칸이 톡 튀는 시간(ms) */
const POP_MS = 160;
/** 지워지는 칸 하나가 줄어들며 사라지는 시간(ms) */
const CLEAR_MS = 190;
/** 블록이 내려앉는 것을 잠깐 보여 준 뒤에 지우기 시작한다(ms). */
const CLEAR_DELAY_MS = 70;
/** 놓은 자리에서 한 칸 멀어질 때마다 늦게 지워지는 시간(ms). 놓은 곳에서부터 퍼져 나가듯 지워진다. */
const CLEAR_STEP_MS = 24;
/** 새 블록이 쟁반에 나타나는 시간과, 자리마다 늦어지는 시간(ms) */
const DEAL_MS = 180;
const DEAL_STEP_MS = 55;
/** 누른 자리에서 이만큼 움직이기 전에는 끈 것으로 치지 않는다(px). 쟁반을 톡 건드린 것으로 블록이 놓이지 않게 한다. */
const TAP_SLOP = 8;
/**
 * 끌고 있는 블록은 놓일 자리를 따질 때의 위치보다 이만큼 위에 그린다(px).
 * 블록이 판에서 살짝 떠 있는 것처럼 보이고, 그 아래로 놓일 자리의 그림자가 비어져 나와 보인다.
 */
const HOVER = 5;
/** 끝난 뒤 남은 블록이 흐려지기 시작할 때까지, 그리고 결과 화면이 뜰 때까지의 시간(ms) */
const OVER_DIM_MS = 450;
const OVER_RESULT_MS = 1600;

/**
 * 화면이 길어 판 위가 비면, 고른 캐릭터를 판 위에 세워 둔다.
 * top은 캐릭터의 머리가 올라갈 수 있는 가장 높은 곳(점수와 일시정지 버튼의 아래)이고,
 * 자리가 모자라면 minScale까지 줄여 보고 그래도 안 들어가면 세우지 않는다.
 */
const MASCOT = { height: 66, top: 42, minScale: 0.8, sink: 2, cheerMs: 700 } as const;

const HINTS = ['블록을 끌어서 판에 놓아요', '한 줄을 가득 채우면 사라져요'] as const;

const DEPTH = {
  board: 1,
  /** 지워지는 중인 칸. 그 자리에 바로 새 블록을 놓아도 새 블록이 위에 보인다. */
  fading: 2,
  cell: 3,
  ghost: 4,
  tray: 6,
  effect: 20,
  drag: 25,
  hud: 30,
  hint: 32,
  banner: 40,
} as const;

type Image = Phaser.GameObjects.Image;

/** 쟁반에 놓인 블록 하나의 그림 */
interface TrayView {
  piece: Piece;
  container: Phaser.GameObjects.Container;
}

/** 블록 하나를 끌고 있는 동안의 기록 */
interface Drag {
  pointer: Phaser.Input.Pointer;
  slot: number;
  view: TrayView;
  /** 누른 자리 */
  downX: number;
  downY: number;
  /** 누른 자리에서 TAP_SLOP보다 멀리 움직인 적이 있는지 */
  moved: boolean;
  /** 블록의 한가운데가 있어야 할 곳. 놓일 자리는 이 위치로 따진다. */
  x: number;
  y: number;
  /** 집는 순간의 위치와 크기. 여기에서 손가락 위로 떠오른다. */
  fromX: number;
  fromY: number;
  fromScale: number;
  /** 떠오르는 움직임이 얼마나 진행됐는지(0~1) */
  lift: number;
  /** 지금 손을 떼면 놓일 자리. 놓을 수 없으면 null이다. */
  snap: { col: number; row: number } | null;
}

/**
 * 블록 채우기: 쟁반의 블록 세 개를 끌어다 8×8 판에 놓고, 가로줄이나 세로줄을 가득 채워 지운다.
 * 시간 제한은 없고, 쟁반에 남은 블록을 놓을 곳이 없으면 끝난다.
 * 규칙은 rules.ts에 있고, 이 씬은 입력과 그리기만 맡는다.
 */
export class BlockFillScene extends MiniGameScene {
  protected readonly gameId = 'block-fill';

  /** 지금 판의 상태. 자동 플레이 검사에서도 읽는다. */
  run!: RunState;
  /** 판과 쟁반의 자리. 자동 플레이 검사에서도 읽는다. */
  layout!: Layout;
  /** 끌고 있는 블록의 아래 끝과 손가락 사이의 거리(px). 자동 플레이 검사가 끌 자리를 계산할 때 읽는다. */
  readonly dragLift = DRAG_LIFT;

  private hud!: GameHud;
  private ghost!: Phaser.GameObjects.Graphics;
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** 칸 번호마다 그 칸에 놓인 블록의 그림 */
  private cellViews: (Image | null)[] = [];
  private trayViews: (TrayView | null)[] = [];
  private drag: Drag | null = null;
  private hints: Phaser.GameObjects.Text[] = [];
  /** 판 위에 서 있는 캐릭터. 화면이 짧으면 없다. */
  private mascot: Image | null = null;
  private mascotCalm: Phaser.Time.TimerEvent | null = null;

  constructor() {
    super(SCENE.blockFill);
  }

  create(): void {
    this.beginMiniGame();
    this.resetState();
    registerBlockTextures(this);

    const { height } = this.scale;
    this.layout = layoutFor({ x: 0, y: HUD_HEIGHT, width: GAME_WIDTH, height: height - HUD_HEIGHT });

    addBackdrop(this);
    const table = this.add.graphics().setDepth(DEPTH.board);
    drawBoard(table, this.layout);
    drawTray(table, this.layout);
    this.addMascot();
    this.ghost = this.add.graphics().setDepth(DEPTH.ghost);
    this.sparks = this.add
      .particles(0, 0, TEXTURE.spark, {
        speed: { min: 20, max: 70 },
        lifespan: { min: 220, max: 420 },
        alpha: { start: 1, end: 0 },
        tint: [...LOOK.sparks],
        emitting: false,
      })
      .setDepth(DEPTH.effect);

    this.addPauseButton();
    this.hud = new GameHud(this, DEPTH.hud);

    this.run = newRun(Math.random);
    this.refreshSide(false);
    this.dealViews();
    this.refreshTray();
    this.bindInput();
    this.showHints();
    sfx.go();
    this.playing = true;
    if (this.run.over) this.endRun();
  }

  override update(_time: number, deltaMs: number): void {
    const drag = this.drag;
    if (!drag) return;
    // 손을 뗐다는 신호를 놓쳤으면(다른 창이 가로챈 경우 등) 블록을 쟁반으로 돌려보낸다.
    if (!drag.pointer.isDown) {
      this.returnToTray();
      return;
    }
    drag.lift = Math.min(1, drag.lift + deltaMs / PICKUP_MS);
    this.moveDragView(drag);
  }

  private resetState(): void {
    this.cellViews = new Array<Image | null>(CELLS).fill(null);
    this.trayViews = new Array<TrayView | null>(TRAY_SIZE).fill(null);
    this.drag = null;
    this.hints = [];
    this.mascot = null;
    this.mascotCalm = null;
  }

  // ───────── 그리기 ─────────

  /** 칸의 한가운데 */
  private centerOf(cell: number): { x: number; y: number } {
    const { cell: size, left, top } = this.layout;
    return {
      x: left + ((cell % SIZE) + 0.5) * size,
      y: top + (Math.floor(cell / SIZE) + 0.5) * size,
    };
  }

  /** 판의 칸에 놓인 블록 한 칸의 배율. 텍스처를 칸 크기에 맞춘다. */
  private get cellScale(): number {
    return this.layout.cell / BLOCK_ART;
  }

  /** 쟁반에 놓여 있을 때의 블록 배율. 끌 때는 1로 커져서 판의 칸과 같은 크기가 된다. */
  private get trayScale(): number {
    return this.layout.trayCell / this.layout.cell;
  }

  private addCell(cell: number, color: number): Image {
    this.cellViews[cell]?.destroy();
    const { x, y } = this.centerOf(cell);
    const image = this.add.image(x, y, blockTexture(color)).setScale(this.cellScale).setDepth(DEPTH.cell);
    this.cellViews[cell] = image;
    return image;
  }

  /** 쟁반의 빈자리에 지금 상태의 블록을 그려 넣는다. 새로 생긴 블록은 작게 시작해서 톡 튀어나온다. */
  private dealViews(): void {
    const { cell, slots } = this.layout;
    this.run.tray.forEach((piece, slot) => {
      if (!piece || this.trayViews[slot]) return;
      const container = this.add.container(slots[slot].x, slots[slot].y).setDepth(DEPTH.tray);
      for (const [dx, dy] of piece.cells) {
        container.add(
          this.add
            .image(
              (dx + 0.5 - piece.width / 2) * cell,
              (dy + 0.5 - piece.height / 2) * cell,
              blockTexture(piece.color),
            )
            .setScale(this.cellScale),
        );
      }
      this.trayViews[slot] = { piece, container };
      container.setScale(0);
      this.tweens.add({
        targets: container,
        scale: this.trayScale,
        delay: slot * DEAL_STEP_MS,
        duration: DEAL_MS,
        ease: 'Back.Out',
      });
    });
  }

  private addMascot(): void {
    const rimTop = this.layout.top - BOARD_RIM;
    const scale = Math.min(1, (rimTop + MASCOT.sink - MASCOT.top) / MASCOT.height);
    if (scale < MASCOT.minScale) return;
    this.mascot = this.add
      .image(GAME_WIDTH / 2, rimTop + MASCOT.sink, this.mascotKey('idle'))
      .setOrigin(0.5, 1)
      .setScale(scale)
      .setDepth(DEPTH.board);
  }

  private mascotKey(pose: 'idle' | 'cheer'): string {
    return mascotTexture(store.data.cosmetics.equipped.runner, pose);
  }

  /** 줄을 지우면 캐릭터가 팔을 들고 폴짝 뛴다. */
  private cheerMascot(): void {
    const mascot = this.mascot;
    if (!mascot) return;
    const ground = this.layout.top - BOARD_RIM + MASCOT.sink;
    this.tweens.killTweensOf(mascot);
    mascot.setTexture(this.mascotKey('cheer')).setY(ground);
    this.tweens.add({ targets: mascot, y: ground - 7, duration: 130, yoyo: true, repeat: 1, ease: 'Quad.Out' });
    this.mascotCalm?.remove();
    this.mascotCalm = this.time.delayedCall(MASCOT.cheerMs, () => mascot.setTexture(this.mascotKey('idle')));
  }

  /** 놓을 곳이 없는 블록은 흐리게 보여서, 끝이 다가오는 것을 미리 알 수 있다. */
  private refreshTray(): void {
    this.trayViews.forEach((view) => {
      if (!view) return;
      view.container.setAlpha(fitsAnywhere(this.run.board, view.piece) ? 1 : LOOK.stuckAlpha);
    });
  }

  private refreshSide(bounce: boolean): void {
    const { streak, lines } = this.run;
    this.hud.setSide(streak >= 2 ? `${streak}연속` : `줄 ${lines}`, bounce);
  }

  /** 놓일 자리의 그림자와, 놓으면 지워질 줄을 그린다. */
  private drawGhost(): void {
    const g = this.ghost;
    g.clear();
    const drag = this.drag;
    if (!drag?.snap) return;
    const { piece } = drag.view;
    const { col, row } = drag.snap;
    const { cell, left, top } = this.layout;

    const lines = linesAfter(this.run.board, piece, col, row);
    const bands = [
      ...lines.rows.map((line) => [left, top + line * cell, cell * SIZE, cell] as const),
      ...lines.cols.map((line) => [left + line * cell, top, cell, cell * SIZE] as const),
    ];
    const hint = LOOK.lineHint;
    g.fillStyle(hint.wash, hint.washAlpha);
    for (const [x, y, width, height] of bands) g.fillRoundedRect(x + 1, y + 1, width - 2, height - 2, 6);
    g.lineStyle(hint.borderWidth, hint.border, 1);
    for (const [x, y, width, height] of bands) g.strokeRoundedRect(x + 1, y + 1, width - 2, height - 2, 6);

    g.fillStyle(blockColor(piece.color), LOOK.ghostAlpha);
    for (const [dx, dy] of piece.cells) {
      g.fillRoundedRect(left + (col + dx) * cell + 1, top + (row + dy) * cell + 1, cell - 2, cell - 2, 6);
    }
  }

  /** 위로 떠오르며 사라지는 글자. 화면 좌우로 나가지 않게 자리를 맞춘다. */
  private floatLabel(x: number, y: number, label: string, color: string): void {
    const text = addText(this, x, Math.max(y, HUD_HEIGHT + 16), label, {
      color,
      originX: 0.5,
      originY: 1,
      stroke: LOOK.text.outline,
    }).setDepth(DEPTH.effect);
    const half = text.width / 2 + 4;
    text.setX(Math.round(Phaser.Math.Clamp(x, half, GAME_WIDTH - half)));
    this.tweens.add({
      targets: text,
      y: text.y - 16,
      alpha: 0,
      delay: 160,
      duration: 520,
      ease: 'Quad.In',
      onComplete: () => text.destroy(),
    });
  }

  private showHints(): void {
    const { cell, top } = this.layout;
    const middle = top + (cell * SIZE) / 2;
    this.hints = [
      addText(this, GAME_WIDTH / 2, middle - 17, HINTS[0], {
        color: LOOK.text.hint,
        originX: 0.5,
        stroke: LOOK.text.outline,
      }),
      addText(this, GAME_WIDTH / 2, middle + 1, HINTS[1], {
        color: LOOK.text.hintSub,
        originX: 0.5,
        stroke: LOOK.text.outline,
      }),
    ];
    for (const hint of this.hints) hint.setDepth(DEPTH.hint);
  }

  private hideHints(): void {
    if (this.hints.length === 0) return;
    const hints = this.hints;
    this.hints = [];
    this.tweens.add({
      targets: hints,
      alpha: 0,
      duration: 250,
      onComplete: () => hints.forEach((hint) => hint.destroy()),
    });
  }

  // ───────── 입력 ─────────

  private bindInput(): void {
    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    this.input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onPointerUp, this);
    // 일시정지하면 끌던 블록은 쟁반으로 돌아간다. 멈춘 동안에는 손을 떼는 것을 알 수 없기 때문이다.
    this.events.on(Phaser.Scenes.Events.PAUSE, this.cancelDrag, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.off(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
      this.input.off(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
      this.input.off(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
      this.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onPointerUp, this);
      this.events.off(Phaser.Scenes.Events.PAUSE, this.cancelDrag, this);
    });
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    // 한 번에 블록 하나만 끈다. 끄는 동안 다른 손가락이 닿은 것은 무시한다.
    if (!this.playing || this.drag) return;
    const slot = slotAt(this.layout, pointer.worldX, pointer.worldY);
    const view = slot >= 0 ? this.trayViews[slot] : null;
    if (!view) return;

    this.hideHints();
    // 쟁반으로 돌아가던 중이거나 막 나타나던 중이면, 그 자리에서 바로 집는다.
    this.tweens.killTweensOf(view.container);
    view.container.setDepth(DEPTH.drag);
    this.drag = {
      pointer,
      slot,
      view,
      downX: pointer.worldX,
      downY: pointer.worldY,
      moved: false,
      x: view.container.x,
      y: view.container.y,
      fromX: view.container.x,
      fromY: view.container.y,
      fromScale: view.container.scale,
      lift: 0,
      snap: null,
    };
    this.aimDrag(pointer.worldX, pointer.worldY);
    sfx.flip();
    vibrate(5);
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (this.drag?.pointer !== pointer) return;
    this.aimDrag(pointer.worldX, pointer.worldY);
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    const drag = this.drag;
    if (drag?.pointer !== pointer) return;
    if (!pointer.wasCanceled) this.aimDrag(pointer.worldX, pointer.worldY);
    if (pointer.wasCanceled || !drag.snap || !this.playing) {
      this.returnToTray();
      return;
    }
    this.place(drag, drag.snap.col, drag.snap.row);
  }

  /** 손가락이 (x, y)에 있을 때 블록이 있어야 할 곳과 놓일 자리를 다시 정한다. */
  private aimDrag(x: number, y: number): void {
    const drag = this.drag;
    if (!drag) return;
    const { piece } = drag.view;
    if (!drag.moved && Math.hypot(x - drag.downX, y - drag.downY) > TAP_SLOP) drag.moved = true;
    const center = dragCenter(piece, this.layout.cell, x, y, GAME_WIDTH);
    drag.x = center.x;
    drag.y = center.y;

    const at = boardCoords(this.layout, piece, center.x, center.y);
    const snap = drag.moved ? snapTarget(this.run.board, piece, at.col, at.row, drag.snap) : null;
    if (snap?.col === drag.snap?.col && snap?.row === drag.snap?.row) return;
    drag.snap = snap;
    this.drawGhost();
  }

  /** 끌고 있는 블록을 제자리에 그린다. 집은 직후에는 쟁반에서 손가락 위로 부드럽게 떠오른다. */
  private moveDragView(drag: Drag): void {
    const t = Phaser.Math.Easing.Cubic.Out(drag.lift);
    drag.view.container
      .setPosition(
        Phaser.Math.Linear(drag.fromX, drag.x, t),
        Phaser.Math.Linear(drag.fromY, drag.y - HOVER, t),
      )
      .setScale(Phaser.Math.Linear(drag.fromScale, 1, t));
  }

  /** 끌던 블록을 쟁반의 제자리로 돌려보낸다. */
  private returnToTray(): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    this.ghost.clear();
    const { container } = drag.view;
    const slot = this.layout.slots[drag.slot];
    this.tweens.add({
      targets: container,
      x: slot.x,
      y: slot.y,
      scale: this.trayScale,
      duration: RETURN_MS,
      ease: 'Cubic.Out',
      onComplete: () => container.setDepth(DEPTH.tray),
    });
    sfx.land();
  }

  /** 일시정지처럼 끌기가 끊겼을 때: 움직임 없이 바로 쟁반에 돌려놓는다. */
  private cancelDrag(): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    this.ghost.clear();
    const slot = this.layout.slots[drag.slot];
    drag.view.container.setPosition(slot.x, slot.y).setScale(this.trayScale).setDepth(DEPTH.tray);
  }

  // ───────── 한 수 ─────────

  private place(drag: Drag, col: number, row: number): void {
    const result = placePiece(this.run, drag.slot, col, row, Math.random);
    if (!result) {
      this.returnToTray();
      return;
    }
    this.drag = null;
    this.ghost.clear();
    // 손에 들려 있던 자리에서 칸으로 미끄러져 들어가도록, 블록이 그려져 있던 곳과 놓인 곳의 차이를 넘긴다.
    const { cell, left, top } = this.layout;
    const { container } = drag.view;
    const shiftX = container.x - (left + (col + result.piece.width / 2) * cell);
    const shiftY = container.y - (top + (row + result.piece.height / 2) * cell);
    container.destroy();
    this.trayViews[drag.slot] = null;
    this.run = result.run;

    this.showPlacement(result, shiftX, shiftY);
    this.hud.setScore(this.run.score);
    this.refreshSide(result.points.streak > 0);
    if (result.dealt) this.dealViews();
    this.refreshTray();
    if (this.run.over) this.endRun();
  }

  /**
   * 놓인 칸을 그리고, 줄이 지워졌으면 지워지는 모습과 점수를 보여 준다.
   * (shiftX, shiftY)는 손에 들려 있던 블록이 놓인 자리에서 벗어나 있던 만큼이다. 거기에서 칸으로 미끄러져 들어온다.
   */
  private showPlacement(result: Placement, shiftX: number, shiftY: number): void {
    const gone = new Set(result.cleared.map((entry) => entry.cell));
    for (const cell of result.cells) {
      const image = this.addCell(cell, result.piece.color);
      // 곧바로 지워질 칸은 지워지는 움직임만 보여 준다.
      if (gone.has(cell)) continue;
      const { x, y } = image;
      image.setPosition(x + shiftX, y + shiftY);
      this.tweens.add({ targets: image, x, y, duration: SETTLE_MS, ease: 'Quad.Out' });
      this.tweens.add({
        targets: image,
        scale: { from: this.cellScale * 1.16, to: this.cellScale },
        duration: POP_MS,
        ease: 'Back.Out',
      });
    }
    sfx.stack();

    const count = result.lines.rows.length + result.lines.cols.length;
    if (count === 0) {
      vibrate(8);
      return;
    }
    this.showClear(result);
    this.cheerMascot();

    const { streak } = result.run;
    if (count >= 2) sfx.gold();
    else sfx.hit(Math.min(streak - 1, 6) * 2);
    vibrate(count >= 2 ? [15, 30, 15] : 20);

    const centers = result.cells.map((cell) => this.centerOf(cell));
    const x = centers.reduce((sum, center) => sum + center.x, 0) / centers.length;
    const y = Math.min(...centers.map((center) => center.y)) - this.layout.cell / 2;
    const gained = result.points.lines + result.points.streak;
    if (result.points.streak > 0) {
      this.floatLabel(x, y, `${streak}연속 +${gained}`, LOOK.text.streak);
    } else {
      this.floatLabel(x, y, count >= 2 ? `${count}줄 +${gained}` : `+${gained}`, LOOK.text.points);
    }
  }

  /**
   * 지워진 칸들이 놓은 자리에서부터 차례로 줄어들며 사라진다.
   * 판의 상태는 이미 바뀌어 있고 그림만 따로 사라지므로, 그동안 다음 블록을 끌어 그 자리에 놓아도 된다.
   */
  private showClear(result: Placement): void {
    const { cell: size, left, top } = this.layout;
    const placed = result.cells.map((cell) => ({ col: cell % SIZE, row: Math.floor(cell / SIZE) }));
    for (const { cell } of result.cleared) {
      const view = this.cellViews[cell];
      if (!view) continue;
      this.cellViews[cell] = null;
      const col = cell % SIZE;
      const row = Math.floor(cell / SIZE);
      const distance = Math.min(...placed.map((at) => Math.abs(at.col - col) + Math.abs(at.row - row)));
      const delay = CLEAR_DELAY_MS + distance * CLEAR_STEP_MS;
      this.tweens.killTweensOf(view);
      view.setScale(this.cellScale).setDepth(DEPTH.fading);
      this.tweens.add({
        targets: view,
        scale: this.cellScale * 0.2,
        alpha: 0,
        delay,
        duration: CLEAR_MS,
        ease: 'Back.In',
        onComplete: () => view.destroy(),
      });
      const { x, y } = view;
      this.time.delayedCall(delay + CLEAR_MS * 0.6, () => this.sparks.explode(2, x, y));
    }

    for (const row of result.lines.rows) {
      this.flashBand(left, top + row * size, size * SIZE, size);
    }
    for (const col of result.lines.cols) {
      this.flashBand(left + col * size, top, size, size * SIZE);
    }
  }

  /** 지워지는 줄을 흰 빛이 한 번 훑고 사라진다. */
  private flashBand(x: number, y: number, width: number, height: number): void {
    const band = this.add.graphics().setDepth(DEPTH.effect);
    band.fillStyle(LOOK.flash, 0.75);
    band.fillRoundedRect(x + 1, y + 1, width - 2, height - 2, 6);
    this.tweens.add({
      targets: band,
      alpha: 0,
      duration: 280,
      ease: 'Quad.Out',
      onComplete: () => band.destroy(),
    });
  }

  private endRun(): void {
    if (!this.playing) return;
    this.playing = false;
    this.cancelDrag();
    this.hideHints();
    vibrate([20, 40, 20]);

    // 마지막으로 놓은 블록과 지워진 줄을 잠깐 보여 준 뒤에, 남은 블록을 흐리게 하고 끝났다고 알린다.
    this.time.delayedCall(OVER_DIM_MS, () => {
      this.cellViews.forEach((view, cell) => {
        if (!view) return;
        this.tweens.add({
          targets: view,
          alpha: LOOK.overAlpha,
          delay: ((cell % SIZE) + Math.floor(cell / SIZE)) * 18,
          duration: 160,
        });
      });
      const { cell, top } = this.layout;
      const banner = addText(this, GAME_WIDTH / 2, top + (cell * SIZE) / 2, '놓을 곳이 없어요', {
        size: FONT_SIZE.large,
        color: LOOK.text.over,
        originX: 0.5,
        originY: 0.5,
        stroke: LOOK.text.outline,
        shadow: LOOK.text.shadow,
      }).setDepth(DEPTH.banner);
      this.tweens.add({
        targets: banner,
        scale: { from: 0.7, to: 1 },
        duration: 180,
        ease: 'Back.Out',
      });
    });

    this.finishMiniGame(
      this.run.score,
      [
        ['지운 줄', `${this.run.lines}줄`],
        ['최고 연속', `${this.run.bestStreak}번`],
        ['놓은 블록', `${this.run.placed}개`],
      ],
      OVER_RESULT_MS,
    );
  }
}
