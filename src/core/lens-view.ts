/** 누른 칸을 손가락 위에 크게 띄워 보여 주는 말풍선을 그린다. 자리 계산은 lens.ts에 있다. */
import Phaser from 'phaser';
import { THEME } from '../config';
import { LENS, lensSpot, type LensCell } from './lens';

export class PressLens {
  private readonly box: Phaser.GameObjects.Container;
  private readonly frame: Phaser.GameObjects.Graphics;
  private readonly content: Phaser.GameObjects.Container;
  /** 눌린 칸에 두르는 테 */
  private readonly ring: Phaser.GameObjects.Graphics;

  constructor(
    private readonly scene: Phaser.Scene,
    depth: number,
  ) {
    this.ring = scene.add.graphics().setDepth(depth).setVisible(false);
    this.frame = scene.add.graphics();
    this.content = scene.add.container(0, 0);
    this.box = scene.add.container(0, 0, [this.frame, this.content]).setDepth(depth).setVisible(false);
  }

  get shown(): boolean {
    return this.box.visible;
  }

  /**
   * cell 위에 말풍선을 띄운다. fill이 말풍선 안에 보여 줄 것을 content에 넣는다.
   * content의 원점은 말풍선의 한가운데이고, 한 변이 LENS_ROOM인 네모 안에 그리면 된다.
   */
  show(cell: LensCell, top: number, fill: (content: Phaser.GameObjects.Container) => void): void {
    const spot = lensSpot(cell, top);
    const half = LENS.size / 2;

    this.content.removeAll(true);
    fill(this.content);

    const frame = this.frame;
    frame.clear();
    frame.fillStyle(THEME.accent, 1);
    frame.fillRoundedRect(-half - 2, -half - 2, LENS.size + 4, LENS.size + 4, LENS.radius + 2);
    if (spot.tailX !== null) {
      const tail = spot.tailX - spot.x;
      frame.fillTriangle(tail - LENS.tail, half + 1, tail + LENS.tail, half + 1, tail, half + 2 + LENS.tail);
    }
    frame.fillStyle(THEME.card, 1);
    frame.fillRoundedRect(-half, -half, LENS.size, LENS.size, LENS.radius);

    const ring = this.ring;
    ring.clear();
    ring.lineStyle(2, THEME.accent, 1);
    ring.strokeRoundedRect(cell.x - cell.size / 2, cell.y - cell.size / 2, cell.size, cell.size, cell.size * 0.24);
    ring.setVisible(true);

    const wasShown = this.box.visible;
    this.box.setPosition(spot.x, spot.y).setVisible(true);
    // 다른 칸으로 옮겨 갈 때는 다시 튀어나오지 않는다.
    if (wasShown) return;
    this.scene.tweens.killTweensOf(this.box);
    this.box.setScale(0.6);
    this.scene.tweens.add({ targets: this.box, scale: 1, duration: 90, ease: 'Back.Out' });
  }

  hide(): void {
    if (!this.box.visible) return;
    this.scene.tweens.killTweensOf(this.box);
    this.content.removeAll(true);
    this.box.setVisible(false);
    this.ring.setVisible(false);
  }
}
