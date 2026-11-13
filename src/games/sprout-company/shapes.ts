/**
 * 새싹 컴퍼니 화면의 도형을 그림으로 구워 두고 쓰는 도구들.
 *
 * Graphics는 프레임마다 둥근 모서리를 다시 쪼개서 그린다. 책상이 열두 개인 사옥에서는 도형이 90개를 넘어서
 * 4배 느린 CPU에서 한 프레임에 40ms쯤 들었다. 여기서는 모양을 흰색으로 한 번만 굽고 색은 tint로 입혀서,
 * 같은 모양을 여러 색으로 다시 쓴다. 길이가 바뀌는 막대(Pill)는 구운 그림을 옮기고 늘이기만 한다.
 */
import Phaser from 'phaser';
import { bakeShape } from '../../core/bake';

type Scene = Phaser.Scene;
type Image = Phaser.GameObjects.Image;

const WHITE = 0xffffff;
/** Phaser가 처음부터 갖고 있는 흰 네모 그림. 늘여도 흰 네모다. */
const PLAIN = '__WHITE';

const size = (value: number): string => value.toFixed(2);

/** 흰 둥근 네모(채움)의 그림. 왼쪽 위가 (0, 0)인 width × height 그림이다. */
export function roundRect(scene: Scene, width: number, height: number, radius: number): string {
  const corner = Math.min(radius, width / 2, height / 2);
  const key = `sc-rect:${size(width)}:${size(height)}:${size(corner)}`;
  return bakeShape(scene, key, { width, height, originX: 0, originY: 0 }, (graphics) => {
    graphics.fillStyle(WHITE, 1).fillRoundedRect(0, 0, width, height, corner);
  });
}

/**
 * 흰 둥근 테두리의 그림. width × height 그림의 inset만큼 안쪽에 lineWidth 굵기로 긋는다.
 * Graphics로 strokeRoundedRect(x + inset, y + inset, width - inset * 2, height - inset * 2, radius)를 긋던 것과 같은 자리다.
 */
export function roundStroke(
  scene: Scene,
  width: number,
  height: number,
  radius: number,
  lineWidth: number,
  inset: number,
): string {
  const key = `sc-stroke:${size(width)}:${size(height)}:${size(radius)}:${lineWidth}:${inset}`;
  return bakeShape(scene, key, { width, height, originX: 0, originY: 0 }, (graphics) => {
    graphics.lineStyle(lineWidth, WHITE, 1).strokeRoundedRect(inset, inset, width - inset * 2, height - inset * 2, radius);
  });
}

/** 흰 동그라미. 그림의 한가운데가 동그라미의 가운데다. */
export function circle(scene: Scene, radius: number): string {
  const key = `sc-circle:${size(radius)}`;
  return bakeShape(scene, key, { width: radius * 2, height: radius * 2 }, (graphics) => {
    graphics.fillStyle(WHITE, 1).fillCircle(0, 0, radius);
  });
}

/** 흰 고리. radius는 선의 한가운데까지의 반지름이고, 그림의 한가운데가 고리의 가운데다. */
export function ring(scene: Scene, radius: number, lineWidth: number): string {
  const outer = radius + lineWidth / 2;
  const key = `sc-ring:${size(radius)}:${lineWidth}`;
  return bakeShape(scene, key, { width: outer * 2, height: outer * 2 }, (graphics) => {
    graphics.lineStyle(lineWidth, WHITE, 1).strokeCircle(0, 0, radius);
  });
}

/** 둥근 네모 한 장을 왼쪽 위 (x, y)에 놓는다. 색은 tint로 입힌다. */
export function addRoundRect(
  scene: Scene,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  color: number,
  alpha = 1,
): Image {
  return scene.add
    .image(x, y, roundRect(scene, width, height, radius))
    .setOrigin(0, 0)
    .setTint(color)
    .setAlpha(alpha);
}

/** 반듯한 네모 한 장을 왼쪽 위 (x, y)에 놓는다. */
export function addPlainRect(scene: Scene, x: number, y: number, width: number, height: number, color: number): Image {
  return scene.add.image(x, y, PLAIN).setOrigin(0, 0).setDisplaySize(width, height).setTint(color);
}

/**
 * 길이가 바뀌는 둥근 막대(양 끝이 반원). 양 끝의 동그라미 두 장과 가운데 네모 한 장으로 그린다.
 * 그림이 서로 겹치므로 불투명한 색으로만 쓴다(반투명이면 겹친 곳이 진해진다).
 */
export class Pill {
  readonly parts: readonly Image[];
  private readonly head: Image;
  private readonly body: Image;
  private readonly tail: Image;
  private readonly radius: number;
  private x: number;
  private y: number;
  private length: number;

  constructor(scene: Scene, x: number, y: number, height: number, color: number) {
    this.radius = height / 2;
    this.x = x;
    this.y = y;
    this.length = height;
    const key = circle(scene, this.radius);
    this.body = scene.add.image(0, 0, PLAIN).setOrigin(0, 0).setTint(color);
    this.head = scene.add.image(0, 0, key).setTint(color);
    this.tail = scene.add.image(0, 0, key).setTint(color);
    this.parts = [this.body, this.head, this.tail];
    this.layout();
  }

  /** 막대의 길이. 높이보다 짧게는 줄지 않는다. */
  setLength(length: number): this {
    const next = Math.max(this.radius * 2, length);
    if (next !== this.length) {
      this.length = next;
      this.layout();
    }
    return this;
  }

  /** 왼쪽 위의 자리를 옮긴다. */
  setPosition(x: number, y: number): this {
    if (x !== this.x || y !== this.y) {
      this.x = x;
      this.y = y;
      this.layout();
    }
    return this;
  }

  setColor(color: number): this {
    for (const part of this.parts) part.setTint(color);
    return this;
  }

  setVisible(visible: boolean): this {
    for (const part of this.parts) part.setVisible(visible);
    return this;
  }

  setAlpha(alpha: number): this {
    for (const part of this.parts) part.setAlpha(alpha);
    return this;
  }

  private layout(): void {
    const radius = this.radius;
    const middle = this.y + radius;
    this.head.setPosition(this.x + radius, middle);
    this.tail.setPosition(this.x + this.length - radius, middle);
    this.body.setPosition(this.x + radius, this.y).setDisplaySize(this.length - radius * 2, radius * 2);
  }
}
