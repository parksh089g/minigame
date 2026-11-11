import Phaser from 'phaser';
import { COLOR } from '../../config';

const RADIUS = 26;
const KNOB = 9;

/**
 * 화면 아무 곳이나 누르면 그 자리에 생기는 조이스틱. 끄는 방향과 거리로 이동을 정한다.
 * 키보드(방향키, WASD)도 함께 받는다.
 */
export class Joystick {
  /** 길이 1 이하의 이동 방향 */
  x = 0;
  y = 0;
  enabled = false;

  private pointerId: number | null = null;
  private originX = 0;
  private originY = 0;
  private dragX = 0;
  private dragY = 0;
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly keys?: Record<'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd', Phaser.Input.Keyboard.Key>;

  constructor(
    scene: Phaser.Scene,
    /** 이 높이보다 위(HUD)를 누른 것은 무시한다 */
    private readonly top: number,
    depth: number,
  ) {
    this.graphics = scene.add.graphics().setDepth(depth);
    const keyboard = scene.input.keyboard;
    if (keyboard) {
      this.keys = keyboard.addKeys({
        up: Phaser.Input.Keyboard.KeyCodes.UP,
        down: Phaser.Input.Keyboard.KeyCodes.DOWN,
        left: Phaser.Input.Keyboard.KeyCodes.LEFT,
        right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
        w: Phaser.Input.Keyboard.KeyCodes.W,
        a: Phaser.Input.Keyboard.KeyCodes.A,
        s: Phaser.Input.Keyboard.KeyCodes.S,
        d: Phaser.Input.Keyboard.KeyCodes.D,
      }) as Joystick['keys'];
    }

    const { input, events } = scene;
    input.on(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
    input.on(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
    input.on(Phaser.Input.Events.POINTER_UP, this.onUp, this);
    input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);
    // 일시정지 동안 손을 뗐을 수 있으므로 돌아올 때 비운다.
    events.on(Phaser.Scenes.Events.RESUME, this.reset, this);
    events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      input.off(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
      input.off(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
      input.off(Phaser.Input.Events.POINTER_UP, this.onUp, this);
      input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);
      events.off(Phaser.Scenes.Events.RESUME, this.reset, this);
    });
  }

  reset(): void {
    this.pointerId = null;
    if (this.keys) for (const key of Object.values(this.keys)) key.reset();
    this.x = 0;
    this.y = 0;
    this.graphics.clear();
  }

  /** 매 프레임 부른다. 터치가 없으면 키보드를 본다. */
  update(): void {
    if (!this.enabled) {
      this.x = 0;
      this.y = 0;
      return;
    }
    if (this.pointerId !== null) {
      const length = Math.hypot(this.dragX, this.dragY);
      // 살짝 닿은 정도로는 움직이지 않게 가운데에 여유를 둔다.
      const power = length < 4 ? 0 : Math.min(1, length / RADIUS);
      this.x = length > 0 ? (this.dragX / length) * power : 0;
      this.y = length > 0 ? (this.dragY / length) * power : 0;
      return;
    }
    const k = this.keys;
    if (!k) return;
    const kx = (k.right.isDown || k.d.isDown ? 1 : 0) - (k.left.isDown || k.a.isDown ? 1 : 0);
    const ky = (k.down.isDown || k.s.isDown ? 1 : 0) - (k.up.isDown || k.w.isDown ? 1 : 0);
    const length = Math.hypot(kx, ky) || 1;
    this.x = kx / length;
    this.y = ky / length;
  }

  private onDown(pointer: Phaser.Input.Pointer): void {
    // 카메라 배율이 바뀌어도 논리 좌표로 받도록 worldX, worldY를 쓴다.
    if (!this.enabled || this.pointerId !== null || pointer.worldY < this.top) return;
    this.pointerId = pointer.id;
    this.originX = pointer.worldX;
    this.originY = pointer.worldY;
    this.dragX = 0;
    this.dragY = 0;
    this.draw();
  }

  private onMove(pointer: Phaser.Input.Pointer): void {
    if (pointer.id !== this.pointerId) return;
    this.dragX = pointer.worldX - this.originX;
    this.dragY = pointer.worldY - this.originY;
    // 멀리 끌면 기준점이 따라와서, 방향을 바꿀 때 손을 크게 되돌리지 않아도 된다.
    const length = Math.hypot(this.dragX, this.dragY);
    if (length > RADIUS) {
      const over = (length - RADIUS) / length;
      this.originX += this.dragX * over;
      this.originY += this.dragY * over;
      this.dragX = pointer.worldX - this.originX;
      this.dragY = pointer.worldY - this.originY;
    }
    this.draw();
  }

  private onUp(pointer: Phaser.Input.Pointer): void {
    if (pointer.id !== this.pointerId) return;
    this.pointerId = null;
    this.x = 0;
    this.y = 0;
    this.graphics.clear();
  }

  private draw(): void {
    const g = this.graphics;
    const x = Math.round(this.originX);
    const y = Math.round(this.originY);
    g.clear();
    g.fillStyle(COLOR.ink, 0.28);
    g.fillCircle(x, y, RADIUS);
    g.lineStyle(1, COLOR.silver, 0.5);
    g.strokeCircle(x, y, RADIUS);
    g.fillStyle(COLOR.white, 0.55);
    g.fillCircle(Math.round(x + this.dragX), Math.round(y + this.dragY), KNOB);
  }
}
