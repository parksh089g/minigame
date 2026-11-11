import Phaser from 'phaser';
import { COLOR } from '../../config';
import { dangerTexture, dawnTexture } from './art';

/** 체력이 낮은 동안 가장자리에 남아 있는 붉은 기 */
const EDGE_REST = 0.42;

/**
 * 화면 전체에 덮는 연출: 맞았을 때의 붉은 번쩍임, 위험할 때 붉어지는 가장자리,
 * 큰 일이 일어났을 때의 흰 번쩍임, 판이 끝날 때 밝아지거나 어두워지는 막.
 * 싸움 화면보다는 위, 조작 표시와 HUD보다는 아래에 놓는다.
 */
export class RunEffects {
  private readonly veil: Phaser.GameObjects.Rectangle;
  private readonly glow: Phaser.GameObjects.Image;
  private readonly edge: Phaser.GameObjects.Image;
  private readonly red: Phaser.GameObjects.Rectangle;
  private readonly white: Phaser.GameObjects.Rectangle;
  private low = false;

  /** top: 화면 위쪽에서 HUD가 덮는 높이. 가장자리 그림은 그 아래부터 그려야 위쪽 띠가 가려지지 않는다. */
  constructor(
    private readonly scene: Phaser.Scene,
    depth: number,
    top: number,
  ) {
    const { width, height } = scene.scale;
    const cover = (color: number): Phaser.GameObjects.Rectangle =>
      scene.add.rectangle(0, 0, width, height, color).setOrigin(0, 0).setAlpha(0).setDepth(depth);
    const below = (key: string): Phaser.GameObjects.Image =>
      scene.add.image(0, top, key).setOrigin(0, 0).setAlpha(0).setDepth(depth);
    this.veil = cover(COLOR.ink);
    this.glow = below(dawnTexture(scene, width, height - top));
    this.edge = below(dangerTexture(scene, width, height - top));
    this.red = cover(COLOR.red);
    this.white = cover(COLOR.white);
  }

  private fade(
    target: Phaser.GameObjects.Rectangle | Phaser.GameObjects.Image,
    from: number,
    to: number,
    ms: number,
    ease = 'Quad.Out',
  ): void {
    this.scene.tweens.killTweensOf(target);
    target.setAlpha(from);
    this.scene.tweens.add({ targets: target, alpha: to, duration: ms, ease });
  }

  /** 맞았다: 화면이 잠깐 붉어진다. */
  hurt(): void {
    this.fade(this.red, 0.3, 0, 240);
  }

  /** 큰 일이 일어났다: 화면이 하얗게 번쩍인다. */
  flash(strength = 0.5, ms = 320): void {
    this.fade(this.white, strength, 0, ms);
  }

  /** 가장자리가 붉게 한 번 뛴다. 심장 소리, 보스 등장, 밀물에 맞춘다. */
  beat(): void {
    this.fade(this.edge, 1, this.low ? EDGE_REST : 0, 520);
  }

  /** 체력이 낮은지 알려 준다. 낮은 동안에는 가장자리에 붉은 기가 남는다. */
  setLow(low: boolean): void {
    if (low === this.low) return;
    this.low = low;
    this.fade(this.edge, this.edge.alpha, low ? EDGE_REST : 0, 400);
  }

  /** 새벽: 따뜻한 빛이 위에서부터 번져 내려온다. */
  dawn(ms: number): void {
    this.setLow(false);
    this.fade(this.glow, 0, 1, ms, 'Sine.Out');
  }

  /**
   * 화면을 흔든다. strength는 화면 크기에 대한 비율이다(0.01이면 화면의 1%).
   * 카메라가 캔버스 배율만큼 확대되어 있어서, Phaser에 그대로 넘기면 배율의 제곱만큼 크게 흔들린다.
   */
  shake(ms: number, strength: number): void {
    const camera = this.scene.cameras.main;
    camera.shake(ms, strength / (camera.zoom * camera.zoom));
  }

  /** 등불이 꺼졌다: 화면이 어두워진다. */
  dusk(ms: number): void {
    this.setLow(false);
    this.fade(this.veil, 0, 0.74, ms, 'Sine.In');
  }
}
