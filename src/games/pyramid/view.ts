/**
 * 피라미드의 화면들이 같이 쓰는 작은 부품: 밤하늘 바탕, 네모난 픽셀 판, 눌리는 줄 버튼.
 * 모서리를 둥글리지 않고 한 칸씩 깎아서 등불지기, 구름 탑 모험과 같은 픽셀 느낌을 낸다.
 */
import Phaser from 'phaser';
import { GAME_WIDTH } from '../../config';
import { addTapZone, addText } from '../../core/ui';
import { PX, PX_CSS } from './art';

export interface BoxColors {
  fill?: number;
  border?: number;
  /** 아래로 비어져 나오는 그림자. null이면 그리지 않는다. */
  shadow?: number | null;
}

/** 모서리를 한 칸(2px) 깎은 네모 판. 테두리 2px, 아래 그림자 2px */
export function pxBox(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  width: number,
  height: number,
  colors: BoxColors = {},
): Phaser.GameObjects.Graphics {
  const { fill = PX.panel, border = PX.edge, shadow = PX.ink } = colors;
  const chamfer = (color: number, top: number): void => {
    graphics.fillStyle(color, 1);
    graphics.fillRect(x + 2, top, width - 4, height);
    graphics.fillRect(x, top + 2, width, height - 4);
  };
  if (shadow !== null) chamfer(shadow, y + 2);
  chamfer(border, y);
  graphics.fillStyle(fill, 1);
  graphics.fillRect(x + 2, y + 2, width - 4, height - 4);
  return graphics;
}

/** 밤하늘: 위는 짙은 남색, 아래로 갈수록 검게 계단처럼 칠하고 작은 별을 띄운다. */
export function drawSky(scene: Phaser.Scene, depth = -10): Phaser.GameObjects.Graphics {
  const { height } = scene.scale;
  const g = scene.add.graphics().setDepth(depth);
  const from = Phaser.Display.Color.ValueToColor(0x29366f);
  const to = Phaser.Display.Color.ValueToColor(0x1a1c2c);
  const bands = 8;
  for (let i = 0; i < bands; i += 1) {
    const mixed = Phaser.Display.Color.Interpolate.ColorWithColor(from, to, bands - 1, i);
    g.fillStyle(Phaser.Display.Color.GetColor(mixed.r, mixed.g, mixed.b), 1);
    g.fillRect(0, Math.floor((height * i) / bands), GAME_WIDTH, Math.ceil(height / bands) + 1);
  }
  const stars: readonly (readonly [number, number, number])[] = [
    [18, 46, 0xf4f4f4],
    [64, 30, 0x94b0c2],
    [210, 52, 0xffcd75],
    [150, 18, 0x94b0c2],
    [228, 140, 0xf4f4f4],
    [10, 170, 0x94b0c2],
    [100, 64, 0x73eff7],
    [190, 250, 0x94b0c2],
    [30, 320, 0xf4f4f4],
    [222, 380, 0x94b0c2],
    [120, 470, 0xffcd75],
  ];
  for (const [x, y, color] of stars) {
    if (y >= height) continue;
    g.fillStyle(color, 0.8);
    g.fillRect(x, y, 2, 2);
  }
  return g;
}

export interface RowButtonOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  note?: string;
  /** 오른쪽 끝에 적는 짧은 글 */
  side?: string;
  sideColor?: string;
  fill?: number;
  border?: number;
  /** 가운데에 제목만 적는다. */
  center?: boolean;
  depth?: number;
  onTap: () => void;
}

/** 눌리는 줄 버튼. 누르는 동안 한 칸 내려간다. 놓인 것들을 돌려준다. */
export function addRowButton(scene: Phaser.Scene, options: RowButtonOptions): Phaser.GameObjects.GameObject[] {
  const { x, y, width, height, depth = 0 } = options;
  const panel = scene.add.graphics().setDepth(depth);
  const title = addText(scene, 0, 0, options.title, { size: options.note ? 13 : 12, color: PX_CSS.text }).setDepth(depth + 1);
  const note = options.note
    ? addText(scene, 0, 0, options.note, { size: 10, color: PX_CSS.sub }).setDepth(depth + 1)
    : null;
  const side = options.side
    ? addText(scene, 0, 0, options.side, { size: 11, color: options.sideColor ?? PX_CSS.accent, originX: 1, originY: 0.5 }).setDepth(depth + 1)
    : null;
  const place = (pressed: boolean): void => {
    const top = y + (pressed ? 2 : 0);
    panel.clear();
    pxBox(panel, x, top, width, height, { fill: options.fill, border: options.border, shadow: pressed ? null : PX.ink });
    if (options.center && !note) {
      title.setOrigin(0.5, 0.5).setPosition(Math.round(x + width / 2), Math.round(top + height / 2));
    } else if (note) {
      title.setOrigin(0, 1).setPosition(x + 10, Math.round(top + height / 2));
      note.setOrigin(0, 0).setPosition(x + 10, Math.round(top + height / 2 + 1));
    } else {
      title.setOrigin(0, 0.5).setPosition(x + 10, Math.round(top + height / 2));
    }
    side?.setPosition(x + width - 10, Math.round(top + height / 2));
  };
  place(false);
  const zone = addTapZone(scene, x, y, width, height, place, options.onTap).setDepth(depth + 2);
  return [panel, title, ...(note ? [note] : []), ...(side ? [side] : []), zone];
}
