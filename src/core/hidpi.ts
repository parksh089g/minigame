/**
 * 고해상도 렌더링.
 *
 * 모든 씬은 가로 240의 "논리 픽셀"로 자리를 잡는다. 캔버스는 그 정수배(renderScale)로 만들고
 * 카메라를 같은 배율로 확대해서, 좌표는 그대로 쓰면서 곡선과 글자가 매끄럽게 나오게 한다.
 *
 * 씬에서 지킬 것:
 * - this.scale.width / height 는 논리 크기다(아래 플러그인이 바꿔 둔다).
 * - 포인터 좌표는 pointer.x / y 대신 pointer.worldX / worldY (또는 logicalPoint)를 쓴다.
 * - 글자는 core/ui.ts의 addText로 만든다(배율에 맞는 해상도로 그린다).
 */
import Phaser from 'phaser';
import { applyPendingRefit } from './refit';
import { renderScale } from './render-scale';

export { pickRenderScale, renderScale, setRenderScale } from './render-scale';

/** 포인터 위치를 논리 좌표로 바꾼다. */
export function logicalPoint(pointer: Phaser.Input.Pointer): { x: number; y: number } {
  return { x: pointer.x / renderScale(), y: pointer.y / renderScale() };
}

/** 폭과 높이만 논리 크기로 보여 주는 ScaleManager. 나머지는 원본 그대로다. */
function logicalScaleManager(manager: Phaser.Scale.ScaleManager): Phaser.Scale.ScaleManager {
  return new Proxy(manager, {
    get(target, property) {
      if (property === 'width') return target.width / renderScale();
      if (property === 'height') return target.height / renderScale();
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

/**
 * 모든 씬에 자동으로 붙는 플러그인. 씬이 시작될 때마다 카메라를 확대하고
 * this.scale이 논리 크기를 돌려주게 한다.
 */
export class HiDpiPlugin extends Phaser.Plugins.ScenePlugin {
  static readonly KEY = 'HiDpiPlugin';

  override boot(): void {
    this.systems?.events.on(Phaser.Scenes.Events.START, this.apply, this);
    this.systems?.events.once(Phaser.Scenes.Events.DESTROY, () => {
      this.systems?.events.off(Phaser.Scenes.Events.START, this.apply, this);
    });
  }

  private apply(): void {
    const scene = this.scene;
    if (!scene) return;
    // 화면 크기가 바뀌어 있었다면, 씬이 자리를 잡기 전에 게임 화면의 길이부터 맞춘다.
    applyPendingRefit(scene);
    scene.cameras.main.setOrigin(0, 0).setZoom(renderScale());
    scene.scale = logicalScaleManager(scene.game.scale);
  }
}

/**
 * 논리 크기보다 촘촘하게 그린 캔버스를 텍스처로 등록한다.
 * 프레임 크기를 논리 크기로 맞춰 두어서, 이미지를 놓으면 width × height(논리 픽셀)로 보인다.
 */
export function addHiResCanvas(
  textures: Phaser.Textures.TextureManager,
  key: string,
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): void {
  const texture = textures.addCanvas(key, canvas);
  if (!texture) return;
  const frame = texture.get();
  frame.source.resolution = canvas.width / width;
  frame.width = width;
  frame.height = height;
  frame.halfWidth = width / 2;
  frame.halfHeight = height / 2;
  frame.centerX = width / 2;
  frame.centerY = height / 2;
  const data = (frame as unknown as { data: unknown }).data as {
    sourceSize: { w: number; h: number };
    spriteSourceSize: { w: number; h: number };
    radius: number;
  };
  data.sourceSize.w = width;
  data.sourceSize.h = height;
  data.spriteSourceSize.w = width;
  data.spriteSourceSize.h = height;
  data.radius = 0.5 * Math.hypot(width, height);
}
