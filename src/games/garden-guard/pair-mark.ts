/**
 * 짝 효과(data.ts의 PAIRS)를 보여 주는 작은 하트. 밭에서 짝이 맞닿은 자리와, 가게 카드의 짝 줄 앞에 그린다.
 * 글자 대신 그림으로 그려서 작은 글자(10px 밑)를 쓰지 않는다.
 */
import type Phaser from 'phaser';
import { THEME } from '../../config';

/** 하트의 반지름(가로 폭의 절반쯤)과 둘레에 두르는 하얀 테의 두께 */
export const HEART = { radius: 3.6, rim: 1.3 } as const;

/** 하트 모양 하나를 칠한다: 둥근 두 봉우리와 아래로 뾰족한 끝 */
function fillHeart(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, color: number): void {
  g.fillStyle(color, 1);
  g.fillCircle(x - r * 0.48, y - r * 0.28, r * 0.55);
  g.fillCircle(x + r * 0.48, y - r * 0.28, r * 0.55);
  g.fillTriangle(x - r * 1.02, y - r * 0.1, x + r * 1.02, y - r * 0.1, x, y + r * 0.95);
}

/** (x, y)를 한가운데로 하는 하트를 그린다. 풀밭과 흙 위에서도 보이게 하얀 테를 두른다. */
export function drawHeart(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number = HEART.radius): void {
  fillHeart(g, x, y, r + HEART.rim, THEME.white);
  fillHeart(g, x, y, r, THEME.pinkDeep);
}
