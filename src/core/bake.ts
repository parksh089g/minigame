/**
 * 바뀌지 않는 도형을 그림 한 장으로 구워 둔다.
 *
 * Graphics는 화면에 그릴 때마다 둥근 모서리와 원을 삼각형으로 다시 쪼갠다. 같은 모양이 수십 개 놓이는 판에서는
 * 그 일이 프레임마다 쌓여서 느린 기기에서 끊긴다. 한 번 구워 둔 그림은 네모 하나로 그려진다.
 */
import Phaser from 'phaser';
import { addHiResCanvas, renderScale } from './hidpi';

/** bakedPanel이 받는 카드의 모습. ui.ts의 drawPanel이 받는 것 가운데 쓰는 것만 추렸다. */
export interface BakedPanelLook {
  fill: number;
  /** 아래에 깔리는 그림자 색. 없으면 그림자를 그리지 않는다. */
  shadow?: number;
  radius: number;
  /** 그림자가 아래로 비어져 나오는 두께 */
  depth: number;
  /** 카드 위에 덧그리는 것(예: 구석의 점). 카드의 왼쪽 위가 원점이다. tag는 덧그린 것마다 다른 이름이어야 한다. */
  extra?: { tag: string; draw: (graphics: Phaser.GameObjects.Graphics) => void };
}

/**
 * 둥근 카드 한 장을 그림으로 구워 두고 그 텍스처의 이름을 돌려준다. 크기와 모습이 같으면 같은 그림을 다시 쓴다.
 * 그림의 크기는 width × (height + depth)이고, 이미지를 (0, 0) 원점으로 놓으면 drawPanel로 그린 것과 같은 자리에 온다.
 * 같은 카드가 수십 장 놓이는 화면(단계 칸, 게임 카드)에서 Graphics 대신 쓴다.
 */
export function bakedPanel(scene: Phaser.Scene, width: number, height: number, look: BakedPanelLook): string {
  const key = [
    'panel',
    width.toFixed(2),
    height.toFixed(2),
    look.fill.toString(16),
    look.shadow === undefined ? 'flat' : look.shadow.toString(16),
    look.radius,
    look.depth,
    look.extra?.tag ?? '',
  ].join(':');
  const depth = look.shadow === undefined ? 0 : look.depth;
  return bakeShape(scene, key, { width, height: height + depth, originX: 0, originY: 0 }, (graphics) => {
    const radius = Math.min(look.radius, width / 2, height / 2);
    if (look.shadow !== undefined && depth > 0) {
      graphics.fillStyle(look.shadow, 1);
      graphics.fillRoundedRect(0, depth, width, height, radius);
    }
    graphics.fillStyle(look.fill, 1);
    graphics.fillRoundedRect(0, 0, width, height, radius);
    look.extra?.draw(graphics);
  });
}

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
