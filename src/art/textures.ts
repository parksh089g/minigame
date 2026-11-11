/** 게임에서 쓸 텍스처를 만든다. 말랑 파스텔 그림은 vector.ts에, 픽셀 스프라이트는 sprites.ts에 있다. */
import Phaser from 'phaser';
import { PALETTE } from '../config';
import { SPRITES, type SpriteRows } from './sprites';
import { registerVectorTextures } from './vector';

export { CARD_HEIGHT, CARD_WIDTH, ORB_SIZE } from './vector';

/** 스프라이트 문자열 한 장을 1글자 = 1픽셀로 캔버스에 옮긴다. */
function drawRows(rows: SpriteRows): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = rows[0].length;
  canvas.height = rows.length;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D 캔버스를 만들 수 없습니다.');
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

/** 모든 텍스처를 한 번에 등록한다. 부트 씬에서 부른다. */
export function registerTextures(scene: Phaser.Scene): void {
  // 말랑 파스텔 그림을 먼저 등록한다. 같은 이름의 픽셀 스프라이트는 아래에서 건너뛴다.
  registerVectorTextures(scene);

  // 아직 새로 그리지 않은 픽셀 스프라이트. 확대해도 번지지 않게 한다.
  for (const [key, rows] of Object.entries(SPRITES)) {
    if (scene.textures.exists(key)) continue;
    scene.textures.addCanvas(key, drawRows(rows))?.setFilter(Phaser.Textures.FilterMode.NEAREST);
  }
}
