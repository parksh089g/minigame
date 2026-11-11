/** 스프라이트 문자열과 간단한 도형으로 게임에서 쓸 텍스처를 만든다. */
import type Phaser from 'phaser';
import { PALETTE } from '../config';
import { SPRITES, TEXTURE, type SpriteRows } from './sprites';

function createCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D 캔버스를 만들 수 없습니다.');
  return [canvas, context];
}

function drawRows(rows: SpriteRows): HTMLCanvasElement {
  const [canvas, context] = createCanvas(rows[0].length, rows.length);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      const index = Number.parseInt(row[x], 16);
      if (Number.isNaN(index)) continue;
      context.fillStyle = PALETTE[index];
      context.fillRect(x, y, 1, 1);
    }
  });
  return canvas;
}

/**
 * 동심원 구슬을 그린다. 픽셀 중심까지의 거리로 색을 정해 계단 현상 없이 또렷한 원이 나온다.
 * rings는 바깥에서 안쪽 순서의 [반지름, 팔레트 번호].
 */
function drawOrb(size: number, rings: ReadonlyArray<readonly [number, number]>): HTMLCanvasElement {
  const [canvas, context] = createCanvas(size, size);
  const center = size / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x + 0.5 - center, y + 0.5 - center);
      let color = -1;
      for (const [radius, index] of rings) {
        if (distance <= radius) color = index;
      }
      if (color < 0) continue;
      context.fillStyle = PALETTE[color];
      context.fillRect(x, y, 1, 1);
    }
  }
  // 왼쪽 위의 반짝임
  const glint = Math.round(size * 0.3);
  context.fillStyle = PALETTE[12];
  context.fillRect(glint, glint - 1, 2, 1);
  context.fillRect(glint - 1, glint, 1, 2);
  return canvas;
}

function drawBackdrop(): HTMLCanvasElement {
  const size = 16;
  const [canvas, context] = createCanvas(size, size);
  context.fillStyle = PALETTE[0];
  context.fillRect(0, 0, size, size);
  context.fillStyle = PALETTE[8];
  context.fillRect(0, 0, 1, 1);
  context.fillRect(8, 8, 1, 1);
  return canvas;
}

function drawSpark(): HTMLCanvasElement {
  const [canvas, context] = createCanvas(2, 2);
  context.fillStyle = PALETTE[12];
  context.fillRect(0, 0, 2, 2);
  return canvas;
}

/** 모서리 한 픽셀을 깎은 사각형을 칠한다. */
function fillChamfer(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
): void {
  context.fillStyle = color;
  context.fillRect(x + 1, y, width - 2, 1);
  context.fillRect(x, y + 1, width, height - 2);
  context.fillRect(x + 1, y + height - 1, width - 2, 1);
}

/** 카드 뒷면: 남색 바탕에 마름모 무늬. 어느 카드든 똑같이 보여야 한다. */
function drawCardBack(width: number, height: number): HTMLCanvasElement {
  const [canvas, context] = createCanvas(width, height);
  fillChamfer(context, 0, 0, width, height, PALETTE[0]);
  fillChamfer(context, 1, 1, width - 2, height - 2, PALETTE[9]);
  context.fillStyle = PALETTE[8];
  context.fillRect(3, 3, width - 6, height - 6);

  // 가운데에서부터 대칭이 되도록 6px 간격으로 작은 마름모를 놓는다.
  const step = 6;
  context.fillStyle = PALETTE[9];
  for (let y = 7; y <= height - 8; y += step) {
    for (let x = 6; x <= width - 7; x += step) {
      context.fillRect(x, y - 1, 1, 3);
      context.fillRect(x - 1, y, 3, 1);
    }
  }
  // 아래쪽 두께
  context.fillStyle = PALETTE[0];
  context.globalAlpha = 0.35;
  context.fillRect(1, height - 3, width - 2, 2);
  context.globalAlpha = 1;
  return canvas;
}

/** 카드 앞면: 그림이 잘 보이도록 밝은 바탕. */
function drawCardFront(width: number, height: number): HTMLCanvasElement {
  const [canvas, context] = createCanvas(width, height);
  fillChamfer(context, 0, 0, width, height, PALETTE[0]);
  fillChamfer(context, 1, 1, width - 2, height - 2, PALETTE[12]);
  context.fillStyle = PALETTE[13];
  context.fillRect(2, height - 3, width - 4, 2);
  return canvas;
}

export const ORB_SIZE = 28;
export const CARD_WIDTH = 48;
export const CARD_HEIGHT = 56;

/** 모든 텍스처를 한 번에 등록한다. 부트 씬에서 부른다. */
export function registerTextures(scene: Phaser.Scene): void {
  const add = (key: string, canvas: HTMLCanvasElement): void => {
    if (!scene.textures.exists(key)) scene.textures.addCanvas(key, canvas);
  };

  for (const [key, rows] of Object.entries(SPRITES)) add(key, drawRows(rows));

  add(
    TEXTURE.orb,
    drawOrb(ORB_SIZE, [
      [14, 0],
      [13, 9],
      [10.5, 10],
      [7, 11],
      [3.5, 12],
    ]),
  );
  add(
    TEXTURE.orbGold,
    drawOrb(ORB_SIZE, [
      [14, 0],
      [13, 3],
      [10.5, 4],
      [4.5, 12],
    ]),
  );
  add(TEXTURE.spark, drawSpark());
  add(TEXTURE.cardBack, drawCardBack(CARD_WIDTH, CARD_HEIGHT));
  add(TEXTURE.cardFront, drawCardFront(CARD_WIDTH, CARD_HEIGHT));
  add(TEXTURE.backdrop, drawBackdrop());
}
