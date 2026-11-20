/**
 * 훌라의 픽셀 UI 부품: 모서리가 각진 버튼과 판. 공용 버튼(core/ui.ts의 PixelButton)은 둥근 파스텔이라 따로 둔다.
 */
import Phaser from 'phaser';
import { addText } from '../../core/ui';
import { vibrate } from '../../core/haptics';
import { sfx } from '../../core/sfx';
import { PX, PX_CSS } from './art';

const STYLES = {
  green: { face: PX.green, lip: PX.teal, light: PX.lime, text: PX_CSS.dark },
  gold: { face: PX.yellow, lip: PX.orange, light: PX.white, text: PX_CSS.dark },
  red: { face: PX.red, lip: PX.plum, light: PX.orange, text: PX_CSS.text },
  blue: { face: PX.blue, lip: PX.navy, light: PX.sky, text: PX_CSS.text },
  plain: { face: PX.slate, lip: PX.charcoal, light: PX.silver, text: PX_CSS.text },
} as const;

export type PxStyle = keyof typeof STYLES;

/** 버튼 아래쪽에 보이는 두께. 누르면 이만큼 들어간다. */
const LIP = 3;

export interface PxButtonConfig {
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  icon?: string;
  style?: PxStyle;
  size?: number;
  hitPadding?: number;
  onTap: () => void;
}

/** 검은 테두리를 두른 각진 버튼. 손을 뗄 때 눌리고, 누른 채 밖으로 끌면 취소된다. */
export class PxButton {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly zone: Phaser.GameObjects.Zone;
  private readonly label?: Phaser.GameObjects.Text;
  private readonly icon?: Phaser.GameObjects.Image;
  private pressed = false;
  private enabled = true;
  private style: PxStyle;

  constructor(
    scene: Phaser.Scene,
    private readonly config: PxButtonConfig,
  ) {
    this.style = config.style ?? 'plain';
    this.graphics = scene.add.graphics();
    if (config.label !== undefined) {
      this.label = addText(scene, 0, 0, config.label, { size: config.size ?? 13, originX: 0.5, originY: 0.5 });
    }
    if (config.icon) this.icon = scene.add.image(0, 0, config.icon);
    const pad = config.hitPadding ?? 0;
    this.zone = scene.add
      .zone(config.x - pad, config.y - pad, config.width + pad * 2, config.height + pad * 2)
      .setOrigin(0, 0)
      .setInteractive({ useHandCursor: true });
    this.zone.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      if (!this.enabled) return;
      this.pressed = true;
      this.draw();
    });
    this.zone.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, () => this.release());
    this.zone.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, () => {
      if (!this.pressed) return;
      this.release();
      sfx.click();
      vibrate(8);
      this.config.onTap();
    });
    scene.input.on(Phaser.Input.Events.POINTER_UP, this.release, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.input.off(Phaser.Input.Events.POINTER_UP, this.release, this));
    this.draw();
  }

  setEnabled(enabled: boolean): this {
    if (this.enabled === enabled) return this;
    this.enabled = enabled;
    this.pressed = false;
    this.draw();
    return this;
  }

  setStyle(style: PxStyle): this {
    this.style = style;
    this.draw();
    return this;
  }

  setLabel(label: string): this {
    this.label?.setText(label);
    return this;
  }

  setDepth(depth: number): this {
    this.graphics.setDepth(depth);
    this.label?.setDepth(depth + 1);
    this.icon?.setDepth(depth + 1);
    this.zone.setDepth(depth + 1);
    return this;
  }

  destroy(): void {
    this.graphics.destroy();
    this.label?.destroy();
    this.icon?.destroy();
    this.zone.destroy();
  }

  private release(): void {
    if (!this.pressed) return;
    this.pressed = false;
    this.draw();
  }

  private draw(): void {
    const { x, y, width, height } = this.config;
    const look = this.enabled ? STYLES[this.style] : STYLES.plain;
    const down = this.pressed ? LIP - 1 : 0;
    const g = this.graphics;
    g.clear();
    // 검은 테두리(모서리 한 칸을 깎는다)
    g.fillStyle(PX.ink, 1);
    g.fillRect(x + 1, y + down, width - 2, height - down);
    g.fillRect(x, y + 1 + down, width, height - 2 - down);
    // 두께
    g.fillStyle(look.lip, 1);
    g.fillRect(x + 1, y + 1 + down, width - 2, height - 2 - down);
    // 윗면
    const faceHeight = height - 2 - LIP;
    g.fillStyle(look.face, 1);
    g.fillRect(x + 1, y + 1 + down, width - 2, faceHeight);
    // 윗줄 빛
    g.fillStyle(look.light, 1);
    g.fillRect(x + 2, y + 2 + down, width - 4, 1);
    const alpha = this.enabled ? 1 : 0.5;
    g.setAlpha(alpha);
    const cx = Math.round(x + width / 2);
    const cy = Math.round(y + 1 + down + faceHeight / 2);
    this.label?.setColor(look.text).setPosition(cx, cy).setAlpha(alpha);
    this.icon?.setPosition(cx, cy).setAlpha(alpha);
  }
}

/** 어두운 판: 검은 테두리, 짙은 면, 윗줄 빛. 모서리를 한 칸 깎는다. */
export function pxBox(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: number = PX.charcoal,
  border: number = PX.ink,
): void {
  g.fillStyle(border, 1);
  g.fillRect(x + 1, y, width - 2, height);
  g.fillRect(x, y + 1, width, height - 2);
  g.fillStyle(fill, 1);
  g.fillRect(x + 1, y + 1, width - 2, height - 2);
}

/** 바탕: 짙은 남색에서 검정으로 계단처럼 어두워지는 띠와 작은 별 */
export function drawBackdrop(scene: Phaser.Scene): void {
  const { width, height } = scene.scale;
  const g = scene.add.graphics().setDepth(-10);
  const bands = 8;
  const from = Phaser.Display.Color.ValueToColor(PX.navy);
  const to = Phaser.Display.Color.ValueToColor(PX.ink);
  for (let i = 0; i < bands; i += 1) {
    const mixed = Phaser.Display.Color.Interpolate.ColorWithColor(from, to, bands - 1, i);
    g.fillStyle(Phaser.Display.Color.GetColor(mixed.r, mixed.g, mixed.b), 1);
    g.fillRect(0, Math.floor((height * i) / bands), width, Math.ceil(height / bands) + 1);
  }
  const stars: readonly (readonly [number, number])[] = [
    [18, 52], [212, 44], [120, 30], [60, 120], [226, 160], [10, 230], [170, 270], [36, 330], [214, 380],
  ];
  for (const [x, y] of stars) {
    g.fillStyle(PX.silver, 0.6);
    g.fillRect(x, y, 2, 2);
  }
}
