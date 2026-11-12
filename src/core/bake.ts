/**
 * 바뀌지 않는 도형을 그림 한 장으로 구워 둔다.
 *
 * Graphics는 화면에 그릴 때마다 둥근 모서리와 원을 삼각형으로 다시 쪼갠다. 같은 모양이 수십 개 놓이는 판에서는
 * 그 일이 프레임마다 쌓여서 느린 기기에서 끊긴다. 한 번 구워 둔 그림은 네모 하나로 그려진다.
 */
import Phaser from 'phaser';
import { addHiResCanvas, renderScale } from './hidpi';

export interface BakeBox {
  /** 그림의 크기(논리 픽셀) */
  width: number;
  height: number;
  /** 도형을 그릴 때의 원점이 그림의 어디에 오는지(논리 픽셀). 기본은 한가운데다. */
  originX?: number;
  originY?: number;
  /** 이미지를 이만큼까지 키워 놓아도 또렷하도록 더 촘촘하게 굽는다. 기본은 1이다. */
  zoom?: number;
}

/**
 * draw가 그린 도형을 key라는 텍스처로 만들어 두고 그 이름을 돌려준다. 이미 있으면 다시 만들지 않는다.
 * 텍스처는 화면 배율에 맞춰 촘촘하게 굽고, 이미지를 놓으면 width × height(논리 픽셀)로 보인다.
 * draw는 받은 Graphics에 그리기만 한다. clear()를 부르면 원점을 옮겨 둔 것이 지워지므로 부르지 않는다.
 */
export function bakeShape(
  scene: Phaser.Scene,
  key: string,
  box: BakeBox,
  draw: (graphics: Phaser.GameObjects.Graphics) => void,
): string {
  if (scene.textures.exists(key)) return key;

  const density = renderScale();
  const canvas = document.createElement('canvas');
  const zoom = box.zoom ?? 1;
  canvas.width = Math.ceil(box.width * density * zoom);
  canvas.height = Math.ceil(box.height * density * zoom);
  const scaleX = canvas.width / box.width;
  const scaleY = canvas.height / box.height;

  const originX = box.originX ?? box.width / 2;
  const originY = box.originY ?? box.height / 2;
  const graphics = scene.make.graphics({}, false);
  // 원점을 옮기는 명령을 맨 앞에 넣어 둔다. draw가 clear()를 부르면 이 명령이 지워져서 그림이 어긋난다.
  graphics.translateCanvas(originX, originY);
  const marker = graphics.commandBuffer.slice(0, 3);
  draw(graphics);
  if (marker.some((value, index) => graphics.commandBuffer[index] !== value)) {
    throw new Error(`bakeShape(${key}): draw에서 clear()를 부르면 안 됩니다.`);
  }
  graphics.setScale(scaleX, scaleY);
  graphics.generateTexture(canvas, canvas.width, canvas.height);
  graphics.destroy();

  addHiResCanvas(scene.textures, key, canvas, box.width, box.height);
  return key;
}
