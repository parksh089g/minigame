/** 말랑한 UI 부품: 글자, 카드, 버튼, 씬 전환. 모든 씬이 같이 쓴다. */
import Phaser from 'phaser';
import { FONT_FAMILY, FONT_SIZE, THEME, THEME_CSS } from '../config';
import { vibrate } from './haptics';
import { renderScale } from './hidpi';
import { sfx } from './sfx';
import { store } from './store';

export interface TextOptions {
  size?: number;
  color?: string;
  /** 주아는 굵기가 하나라서 아무 일도 하지 않는다. 예전 코드와 맞추려고 남겨 둔다. */
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
  /** 0~1. 기본은 왼쪽 위(0, 0) */
  originX?: number;
  originY?: number;
  /** 이 폭을 넘으면 줄을 바꾼다 */
  wrapWidth?: number;
  lineSpacing?: number;
  /** 글자 아래에 깔리는 얇은 그림자 색 */
  shadow?: string;
  /** 글자 둘레에 두르는 테두리 색. 게임 화면 위에 뜨는 글자가 묻히지 않게 한다. */
  stroke?: string;
}

export function addText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  content: string,
  options: TextOptions = {},
): Phaser.GameObjects.Text {
  const size = options.size ?? FONT_SIZE.normal;
  const text = scene.add.text(Math.round(x), Math.round(y), content, {
    fontFamily: FONT_FAMILY,
    fontSize: `${size}px`,
    color: options.color ?? THEME_CSS.ink,
    align: options.align ?? 'left',
    lineSpacing: options.lineSpacing ?? 3,
    wordWrap: options.wrapWidth ? { width: options.wrapWidth, useAdvancedWrap: true } : undefined,
    // 카메라가 확대하는 만큼 촘촘하게 그려야 글자가 흐려지지 않는다.
    resolution: renderScale(),
    // 받침 없는 글자의 윗부분과 테두리가 잘리지 않게 여유를 둔다.
    padding: { x: 1, y: 1 },
  });
  text.setOrigin(options.originX ?? 0, options.originY ?? 0);
  if (options.stroke) {
    text.setStroke(options.stroke, Math.max(2, size / 5));
  }
  if (options.shadow) {
    const offset = Math.max(1, size / 14);
    text.setShadow(0, offset, options.shadow, 0, Boolean(options.stroke), true);
  }
  return text;
}

/** 모서리가 살짝 둥근 사각형을 칠한다. 작은 점이나 띠에 쓴다. */
export function fillChamfer(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  width: number,
  height: number,
  color: number,
  alpha = 1,
): void {
  graphics.fillStyle(color, alpha);
  graphics.fillRoundedRect(x, y, width, height, Math.min(3, width / 2, height / 2));
}

export interface PanelColors {
  fill?: number;
  /** 주면 둘레에 2px 테두리를 두른다(고른 것, 받을 것이 있는 것 표시). */
  border?: number;
  /** 예전 픽셀 패널의 윗줄 색. 지금은 쓰지 않는다. */
  highlight?: number;
  /** 아래에 깔리는 그림자 색. null이면 그림자를 그리지 않는다. */
  shadow?: number | null;
  /** 모서리 반지름. 기본 12 */
  radius?: number;
  /** 그림자가 아래로 비어져 나오는 두께. 기본 3 */
  depth?: number;
}

/** 둥근 카드를 graphics에 그린다. 그림자는 height 아래로 depth만큼 더 내려간다. */
export function drawPanel(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  width: number,
  height: number,
  colors: PanelColors = {},
): void {
  const radius = Math.min(colors.radius ?? 12, width / 2, height / 2);
  const depth = colors.depth ?? 3;
  if (colors.shadow !== null && depth > 0) {
    graphics.fillStyle(colors.shadow ?? THEME.shadow, 1);
    graphics.fillRoundedRect(x, y + depth, width, height, radius);
  }
  const fill = colors.fill ?? THEME.card;
  if (colors.border === undefined) {
    graphics.fillStyle(fill, 1);
    graphics.fillRoundedRect(x, y, width, height, radius);
    return;
  }
  graphics.fillStyle(colors.border, 1);
  graphics.fillRoundedRect(x, y, width, height, radius);
  graphics.fillStyle(fill, 1);
  graphics.fillRoundedRect(x + 2, y + 2, width - 4, height - 4, Math.max(1, radius - 2));
}

export function addPanel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  height: number,
  colors: PanelColors = {},
): Phaser.GameObjects.Graphics {
  const graphics = scene.add.graphics();
  drawPanel(graphics, x, y, width, height, colors);
  return graphics;
}

/** 날마다의 달성 여부를 한 줄의 동그라미로 그릴 때의 한 칸 */
export interface DayDot {
  cleared: boolean;
  /** 오늘 칸에는 테를 둘러서 아직 달성할 수 있는 날임을 보여 준다. */
  today: boolean;
}

/**
 * 최근 며칠의 달성 여부를 동그라미 한 줄로 그린다. 오래된 날이 왼쪽이고, 맨 오른쪽 동그라미의 오른쪽 끝이 right다.
 * 달성한 날은 짙게 채우고 아닌 날은 옅은 색(empty, 바탕에 맞춰 고른다)으로 둔다. 줄의 왼쪽 끝을 돌려준다.
 */
export function drawDayDots(
  graphics: Phaser.GameObjects.Graphics,
  days: readonly DayDot[],
  right: number,
  centerY: number,
  radius: number,
  pitch: number,
  empty: number = THEME.white,
): number {
  const left = right - radius * 2 - (days.length - 1) * pitch;
  days.forEach((day, index) => {
    const x = left + radius + index * pitch;
    if (day.today) {
      graphics.fillStyle(THEME.accent, 1);
      graphics.fillCircle(x, centerY, radius + 1.4);
      graphics.fillStyle(THEME.white, 1);
      graphics.fillCircle(x, centerY, radius + 0.4);
    }
    graphics.fillStyle(day.cleared ? THEME.accent : empty, day.cleared ? 1 : 0.85);
    graphics.fillCircle(x, centerY, day.cleared ? radius : radius - 0.4);
  });
  return left - (days.some((day) => day.today) ? 1.4 : 0);
}

/** 게임 위에 겹쳐 뜨는 화면(일시정지, 결과)의 뒤를 가리는 막. 뒤쪽이 눌리지 않게 입력도 받는다. */
export function addScrim(scene: Phaser.Scene): Phaser.GameObjects.Rectangle {
  const { width, height } = scene.scale;
  return scene.add.rectangle(0, 0, width, height, THEME.bg, 0.82).setOrigin(0, 0).setInteractive();
}

/** 화면을 덮는 배경 무늬. 상점에서 고른 배경을 쓴다. */
export function addBackdrop(scene: Phaser.Scene): Phaser.GameObjects.TileSprite {
  const { width, height } = scene.scale;
  return scene.add
    .tileSprite(0, 0, width, height, store.data.cosmetics.equipped.backdrop)
    .setOrigin(0, 0);
}

/** 누른 자리에서 이보다 멀리 움직였다가 떼면 누른 것이 아니라 민 것으로 본다(px). */
const TAP_SLOP = 12;

/**
 * 누르는 동안 모양이 바뀌고, 그 위에서 손을 떼면 onTap이 불리는 영역을 만든다.
 * draw는 눌린 상태가 바뀔 때마다 불린다. 누른 채 밖으로 끌거나 옆으로 밀면 취소된다.
 */
export function addTapZone(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  height: number,
  draw: (pressed: boolean) => void,
  onTap: () => void,
): Phaser.GameObjects.Zone {
  const zone = scene.add
    .zone(x, y, width, height)
    .setOrigin(0, 0)
    .setInteractive({ useHandCursor: true });
  let pressed = false;
  // 누른 자리. 카메라가 확대되어 있어도 맞도록 화면 좌표가 아니라 씬 좌표로 잰다.
  let downX = 0;
  let downY = 0;
  const release = (): void => {
    pressed = false;
    draw(false);
  };
  zone.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
    pressed = true;
    downX = pointer.worldX;
    downY = pointer.worldY;
    draw(true);
  });
  zone.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, release);
  zone.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, (pointer: Phaser.Input.Pointer) => {
    if (!pressed) return;
    release();
    if (Math.hypot(pointer.worldX - downX, pointer.worldY - downY) > TAP_SLOP) return;
    onTap();
  });
  return zone;
}

/** 가로로 민 것으로 보는 가장 짧은 거리(px) */
const SWIPE_MIN = 28;

/**
 * area 안에서 시작한 가로 밀기를 알려 준다.
 * 왼쪽으로 밀면 1(다음 쪽), 오른쪽으로 밀면 -1(이전 쪽)을 넘긴다. 위아래로 민 것은 세지 않는다.
 */
export function onSwipe(
  scene: Phaser.Scene,
  area: Phaser.Geom.Rectangle,
  handler: (direction: 1 | -1) => void,
): void {
  // 손가락마다 누른 자리를 기억한다. 카메라가 확대되어 있어도 맞도록 씬 좌표로 잰다.
  const starts = new Map<number, { x: number; y: number }>();
  const onDown = (pointer: Phaser.Input.Pointer): void => {
    starts.set(pointer.id, { x: pointer.worldX, y: pointer.worldY });
  };
  const onUp = (pointer: Phaser.Input.Pointer): void => {
    const from = starts.get(pointer.id);
    starts.delete(pointer.id);
    if (!from || !area.contains(from.x, from.y)) return;
    const dx = pointer.worldX - from.x;
    const dy = pointer.worldY - from.y;
    if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    handler(dx < 0 ? 1 : -1);
  };
  scene.input.on(Phaser.Input.Events.POINTER_DOWN, onDown);
  scene.input.on(Phaser.Input.Events.POINTER_UP, onUp);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.input.off(Phaser.Input.Events.POINTER_DOWN, onDown);
    scene.input.off(Phaser.Input.Events.POINTER_UP, onUp);
  });
}

/** 가진 코인을 보여 주는 알약 모양 칸. 오른쪽 끝이 right에 맞춰지고, 금액에 따라 왼쪽으로 늘어난다. */
export class CoinCounter {
  static readonly HEIGHT = 22;

  private readonly panel: Phaser.GameObjects.Graphics;
  private readonly icon: Phaser.GameObjects.Image;
  private readonly amount: Phaser.GameObjects.Text;
  /** 칸의 왼쪽 끝. 옆에 다른 것을 놓을 때 쓴다. */
  left = 0;

  constructor(
    scene: Phaser.Scene,
    private readonly right: number,
    private readonly y: number,
    coins: number,
  ) {
    this.panel = scene.add.graphics();
    this.icon = scene.add.image(0, y + CoinCounter.HEIGHT / 2, 'coin').setOrigin(0, 0.5);
    this.amount = addText(scene, 0, y + CoinCounter.HEIGHT / 2, '', { originY: 0.5 });
    this.set(coins);
  }

  set(coins: number): void {
    this.amount.setText(String(coins));
    const width = Math.ceil(this.amount.width) + 28;
    this.left = this.right - width;
    this.panel.clear();
    drawPanel(this.panel, this.left, this.y, width, CoinCounter.HEIGHT, { depth: 2 });
    this.icon.setX(this.left + 5);
    this.amount.setX(this.left + 19);
  }
}

/**
 * 버튼 색. pink는 그 화면에서 가장 먼저 누를 버튼, neutral은 흰 버튼이다.
 * green, blue, red, yellow는 예전 이름을 그대로 둔 것으로 각각 민트, 연보라, 산호, 버터색이다.
 */
const BUTTON_STYLES = {
  pink: { face: THEME.pink, lip: THEME.pinkDeep, text: THEME_CSS.inkDeep },
  green: { face: THEME.mint, lip: THEME.mintDeep, text: THEME_CSS.inkDeep },
  blue: { face: THEME.lilac, lip: THEME.lilacDeep, text: THEME_CSS.inkDeep },
  red: { face: THEME.coral, lip: THEME.coralDeep, text: THEME_CSS.inkDeep },
  yellow: { face: THEME.butter, lip: THEME.butterDeep, text: THEME_CSS.inkDeep },
  neutral: { face: THEME.card, lip: THEME.shadow, text: THEME_CSS.ink },
} as const;

export type ButtonStyle = keyof typeof BUTTON_STYLES;

export interface ButtonConfig {
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  /** 텍스처 이름. label 없이 아이콘만 둘 때 쓴다. */
  icon?: string;
  style?: ButtonStyle;
  /** 보이는 크기보다 터치 영역을 사방으로 얼마나 넓힐지(px) */
  hitPadding?: number;
  onTap: () => void;
}

/** 버튼 아래쪽에 보이는 두께(px). 누르면 이만큼 들어간다. */
const BUTTON_DEPTH = 3;
const PRESS_OFFSET = 2;

/**
 * 눌리는 느낌이 나는 둥근 버튼. (이름은 픽셀 UI 시절 그대로다.)
 * 손가락을 뗄 때 동작해서, 누른 채 밖으로 끌면 취소할 수 있다.
 */
export class PixelButton {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly zone: Phaser.GameObjects.Zone;
  private readonly label?: Phaser.GameObjects.Text;
  private readonly icon?: Phaser.GameObjects.Image;
  private style: ButtonStyle;
  private pressed = false;
  private enabled = true;

  constructor(
    scene: Phaser.Scene,
    private readonly config: ButtonConfig,
  ) {
    this.style = config.style ?? 'neutral';
    this.graphics = scene.add.graphics();

    if (config.label !== undefined) {
      this.label = addText(scene, 0, 0, config.label, { originX: 0.5, originY: 0.5 });
    }
    if (config.icon) {
      this.icon = scene.add.image(0, 0, config.icon);
    }

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
    // 버튼 밖에서 손을 뗀 경우에도 눌린 모양이 남지 않게 한다.
    scene.input.on(Phaser.Input.Events.POINTER_UP, this.release, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.input.off(Phaser.Input.Events.POINTER_UP, this.release, this);
    });

    this.draw();
  }

  setLabel(label: string): this {
    this.label?.setText(label);
    return this;
  }

  setStyle(style: ButtonStyle): this {
    this.style = style;
    this.draw();
    return this;
  }

  setEnabled(enabled: boolean): this {
    this.enabled = enabled;
    this.pressed = false;
    const alpha = enabled ? 1 : 0.45;
    this.graphics.setAlpha(alpha);
    this.label?.setAlpha(alpha);
    this.icon?.setAlpha(alpha);
    this.draw();
    return this;
  }

  setVisible(visible: boolean): this {
    this.graphics.setVisible(visible);
    this.label?.setVisible(visible);
    this.icon?.setVisible(visible);
    if (visible) this.zone.setInteractive();
    else this.zone.disableInteractive();
    return this;
  }

  private release(): void {
    if (!this.pressed) return;
    this.pressed = false;
    this.draw();
  }

  private draw(): void {
    const { x, y, width, height } = this.config;
    const colors = BUTTON_STYLES[this.style];
    const offset = this.pressed ? PRESS_OFFSET : 0;
    const faceHeight = height - BUTTON_DEPTH;
    const radius = Math.min(12, faceHeight / 2, width / 2);
    const g = this.graphics;

    g.clear();
    g.fillStyle(colors.lip, 1);
    g.fillRoundedRect(x, y + BUTTON_DEPTH, width, faceHeight, radius);
    g.fillStyle(colors.face, 1);
    g.fillRoundedRect(x, y + offset, width, faceHeight, radius);

    const centerX = x + width / 2;
    const centerY = y + offset + faceHeight / 2;
    this.label?.setColor(colors.text).setPosition(Math.round(centerX), Math.round(centerY));
    this.icon?.setPosition(centerX, centerY);
  }
}

/** 쪽 넘김 줄이 차지하는 높이. 목록 아래에 이만큼 자리를 비워 둔다. */
export const PAGER_HEIGHT = 30;
const PAGER_BUTTON_WIDTH = 34;
const PAGER_BUTTON_HEIGHT = 22;
/** 두 버튼 사이, 쪽을 나타내는 점이 놓이는 폭 */
const PAGER_MIDDLE = 56;
const PAGER_DOT = 6;
const PAGER_DOT_GAP = 5;
/** 쪽이 이보다 많으면 점 대신 "2/9"처럼 숫자로 보여 준다. */
const PAGER_MAX_DOTS = 6;
/** 쪽 넘김 줄의 색. 버튼은 PixelButton의 기본 모양을 그대로 쓴다. */
const PAGER_LOOK = { current: THEME.pink, other: THEME.shadow, count: THEME_CSS.sub } as const;

/**
 * 목록을 쪽으로 나눴을 때 그 아래에 두는 줄: 이전 버튼, 쪽을 나타내는 점, 다음 버튼.
 * 쪽이 하나뿐이면 보이지 않는다. 어느 쪽을 보여 줄지는 부르는 쪽이 정하고 set()으로 알려 준다.
 */
export class Pager {
  private readonly prev: PixelButton;
  private readonly next: PixelButton;
  private readonly dots: Phaser.GameObjects.Graphics;
  private readonly count: Phaser.GameObjects.Text;
  private pages = 1;
  private page = 0;

  /** y는 비워 둔 자리(PAGER_HEIGHT)의 위쪽 끝. onChange에는 옮겨 갈 쪽 번호(0부터)가 넘어온다. */
  constructor(
    scene: Phaser.Scene,
    private readonly centerX: number,
    private readonly y: number,
    onChange: (page: number) => void,
  ) {
    const top = y + Math.floor((PAGER_HEIGHT - PAGER_BUTTON_HEIGHT) / 2);
    const button = { y: top, width: PAGER_BUTTON_WIDTH, height: PAGER_BUTTON_HEIGHT, hitPadding: 4 };
    this.prev = new PixelButton(scene, {
      ...button,
      x: centerX - PAGER_MIDDLE / 2 - PAGER_BUTTON_WIDTH,
      icon: 'icon-prev',
      onTap: () => onChange(this.page - 1),
    });
    this.next = new PixelButton(scene, {
      ...button,
      x: centerX + PAGER_MIDDLE / 2,
      icon: 'icon-play',
      onTap: () => onChange(this.page + 1),
    });
    this.dots = scene.add.graphics();
    this.count = addText(scene, centerX, y + PAGER_HEIGHT / 2, '', {
      color: PAGER_LOOK.count,
      originX: 0.5,
      originY: 0.5,
    });
    this.set(1, 0);
  }

  /** 쪽 수와 지금 쪽(0부터)을 알려 주면 거기에 맞춰 다시 그린다. */
  set(pages: number, page: number): void {
    this.pages = Math.max(1, Math.floor(pages));
    this.page = Math.min(this.pages - 1, Math.max(0, Math.floor(page)));
    const visible = this.pages > 1;
    const asDots = this.pages <= PAGER_MAX_DOTS;

    this.prev.setVisible(visible).setEnabled(this.page > 0);
    this.next.setVisible(visible).setEnabled(this.page < this.pages - 1);
    this.count.setVisible(visible && !asDots).setText(`${this.page + 1}/${this.pages}`);

    this.dots.clear();
    if (!visible || !asDots) return;
    const width = this.pages * PAGER_DOT + (this.pages - 1) * PAGER_DOT_GAP;
    const left = Math.round(this.centerX - width / 2);
    const top = this.y + (PAGER_HEIGHT - PAGER_DOT) / 2;
    for (let index = 0; index < this.pages; index += 1) {
      this.dots.fillStyle(index === this.page ? PAGER_LOOK.current : PAGER_LOOK.other, 1);
      this.dots.fillCircle(
        left + index * (PAGER_DOT + PAGER_DOT_GAP) + PAGER_DOT / 2,
        top + PAGER_DOT / 2,
        PAGER_DOT / 2,
      );
    }
  }
}

const FADE_MS = 140;
/** 화면 바탕색(THEME.bg). 밝은 화면이 어둡게 번쩍이지 않도록 바탕색으로 넘긴다. */
const FADE_RGB = [255, 244, 236] as const;

/** 화면을 바탕색으로 덮은 뒤 다른 씬으로 넘어간다. */
export function fadeToScene(scene: Phaser.Scene, key: string, data?: object): void {
  const camera = scene.cameras.main;
  if (camera.fadeEffect.isRunning) return;
  scene.input.enabled = false;
  camera.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => scene.scene.start(key, data));
  camera.fadeOut(FADE_MS, FADE_RGB[0], FADE_RGB[1], FADE_RGB[2]);
}

/** 씬이 시작될 때 부르면 바탕색에서 서서히 나타난다. */
export function fadeIn(scene: Phaser.Scene): void {
  scene.input.enabled = true;
  scene.cameras.main.fadeIn(FADE_MS, FADE_RGB[0], FADE_RGB[1], FADE_RGB[2]);
}

/**
 * 캔버스 밖의 창(core/dialog.ts)이 떠 있거나 서버의 답을 기다리는 동안 씬의 입력을 꺼 둔다.
 * 입력이 꺼져 있으면 뒤로 가기와 화면 크기 맞춤도 이 씬을 건드리지 않아서, 일이 끝났을 때 씬이 그대로 있다.
 * 이미 다른 일로 입력이 꺼져 있으면 task를 하지 않고 undefined를 돌려준다.
 */
export async function whileBlocked<T>(scene: Phaser.Scene, task: () => Promise<T>): Promise<T | undefined> {
  if (!scene.input.enabled) return undefined;
  scene.input.enabled = false;
  try {
    return await task();
  } finally {
    scene.input.enabled = true;
  }
}
