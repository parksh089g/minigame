/**
 * 블록 채우기의 그림. 색은 LOOK 한곳에 모아 두고, 모든 것을 둥근 도형으로 그린다.
 * 블록 한 칸은 색마다 캔버스에 한 번 그려 텍스처로 등록해 두고, 씬은 그것을 놓고 움직이기만 한다.
 */
import type Phaser from 'phaser';
import { THEME, THEME_CSS } from '../../config';
import { bakeShape } from '../../core/bake';
import { addHiResCanvas, renderScale } from '../../core/hidpi';
import { drawPanel } from '../../core/ui';
import { BOARD_LIP, BOARD_RIM, COLOR_COUNT, MAX_CELL, SIZE, type Layout } from './rules';

type Graphics = Phaser.GameObjects.Graphics;

/** 윗면 색보다 조금 어두운 옆면 색. 짝이 되는 짙은 색이 테마에 없는 블록에 쓴다. */
function shade(css: string): string {
  const value = Number.parseInt(css.slice(1), 16);
  const channel = (shift: number): number => Math.round(((value >> shift) & 0xff) * 0.84);
  const mixed = (channel(16) << 16) | (channel(8) << 8) | channel(0);
  return `#${mixed.toString(16).padStart(6, '0')}`;
}

const toNumber = (css: string): number => Number.parseInt(css.slice(1), 16);

/** 테마에 없는 살구색. 블록 갈래가 열두 가지라 색 하나를 보탰다. */
const PEACH = '#ffb98a';

/**
 * 블록의 색. 차례는 rules.ts의 갈래 순서(색 번호 1부터)와 같다.
 * 판 위에서 자주 이웃하는 작은 블록들은 색상이 모두 다르고, 큰 블록은 같은 색상을 한 번 더 짙게 돈다.
 */
const BLOCK_COLORS: readonly { face: string; lip: string }[] = [
  { face: THEME_CSS.gold, lip: shade(THEME_CSS.gold) },
  { face: THEME_CSS.sky, lip: THEME_CSS.skyDeep },
  { face: THEME_CSS.mint, lip: THEME_CSS.mintDeep },
  { face: THEME_CSS.pink, lip: THEME_CSS.pinkDeep },
  { face: THEME_CSS.lilac, lip: THEME_CSS.lilacDeep },
  { face: THEME_CSS.butter, lip: THEME_CSS.butterDeep },
  { face: THEME_CSS.coral, lip: THEME_CSS.coralDeep },
  { face: THEME_CSS.skyDeep, lip: shade(THEME_CSS.skyDeep) },
  { face: THEME_CSS.mintDeep, lip: shade(THEME_CSS.mintDeep) },
  { face: THEME_CSS.lilacDeep, lip: shade(THEME_CSS.lilacDeep) },
  { face: THEME_CSS.pinkDeep, lip: shade(THEME_CSS.pinkDeep) },
  { face: PEACH, lip: shade(PEACH) },
];

export const LOOK = {
  board: {
    /** 판을 두르는 테두리와 그 아래 두께 */
    rim: THEME.card,
    rimLip: THEME.shadow,
    /** 판의 바닥과 빈칸 */
    floor: THEME.card,
    slot: THEME.dim,
  },
  /** 쟁반: 블록 세 개가 놓이는 흰 받침과 그 아래 두께 */
  tray: { plate: THEME.card, plateLip: THEME.shadow, seam: THEME.dim },
  /** 블록을 놓을 자리에 비치는 그림자의 진하기 */
  ghostAlpha: 0.55,
  /** 블록을 놓으면 지워질 줄을 미리 알리는 띠: 줄을 희게 밝히고 금색 테를 두른다. */
  lineHint: { wash: THEME.white, washAlpha: 0.45, border: THEME.gold, borderWidth: 2 },
  /** 줄이 지워지는 순간 그 줄을 훑는 빛 */
  flash: THEME.white,
  /** 놓을 곳이 없는 쟁반의 블록 */
  stuckAlpha: 0.38,
  /** 판이 끝났을 때 남은 블록이 흐려지는 정도 */
  overAlpha: 0.5,
  sparks: [THEME.gold, THEME.pink, THEME.mintDeep, THEME.skyDeep, THEME.lilac],
  text: {
    hint: THEME_CSS.ink,
    hintSub: THEME_CSS.sub,
    outline: THEME_CSS.white,
    points: THEME_CSS.accent,
    streak: THEME_CSS.good,
    over: THEME_CSS.bad,
    shadow: THEME_CSS.shadow,
  },
} as const;

/** 블록 색 번호(1부터)의 윗면 색. 놓을 자리의 그림자를 그릴 때 쓴다. */
export function blockColor(color: number): number {
  return toNumber(BLOCK_COLORS[(color - 1) % BLOCK_COLORS.length].face);
}

/**
 * 블록 한 칸 텍스처의 크기(논리 픽셀). 판의 칸이 가장 클 때와 같아서, 보통은 줄이거나 키우지 않고 그대로 놓인다.
 * 칸이 더 작은 화면에서는 씬이 칸 크기에 맞춰 줄여서 놓는다.
 */
export const BLOCK_ART = MAX_CELL;
/** 텍스처 안에서 블록 둘레에 비워 두는 폭. 이웃한 블록 사이의 틈이 된다. */
const BLOCK_INSET = 1;
const BLOCK_RADIUS = 6;
/** 블록 아래로 도톰하게 내려오는 옆면의 두께 */
const BLOCK_LIP = 3;

/** 색 번호(1부터)에 해당하는 블록 한 칸의 텍스처 이름 */
export function blockTexture(color: number): string {
  return `block-fill-cell-${color}`;
}

/** 블록 한 칸의 텍스처를 색마다 하나씩 만들어 둔다. 이미 있으면 건너뛴다. */
export function registerBlockTextures(scene: Phaser.Scene): void {
  const density = renderScale();
  for (let color = 1; color <= COLOR_COUNT; color += 1) {
    const key = blockTexture(color);
    if (scene.textures.exists(key)) continue;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(BLOCK_ART * density);
    canvas.height = Math.ceil(BLOCK_ART * density);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2D 캔버스를 만들 수 없습니다.');
    context.scale(canvas.width / BLOCK_ART, canvas.height / BLOCK_ART);

    const { face, lip } = BLOCK_COLORS[(color - 1) % BLOCK_COLORS.length];
    const size = BLOCK_ART - BLOCK_INSET * 2;
    context.fillStyle = lip;
    context.beginPath();
    context.roundRect(BLOCK_INSET, BLOCK_INSET, size, size, BLOCK_RADIUS);
    context.fill();
    context.fillStyle = face;
    context.beginPath();
    context.roundRect(BLOCK_INSET, BLOCK_INSET, size, size - BLOCK_LIP, BLOCK_RADIUS);
    context.fill();
    context.fillStyle = 'rgba(255, 255, 255, 0.6)';
    context.beginPath();
    context.roundRect(BLOCK_INSET + 4.5, BLOCK_INSET + 4, 8, 3, 1.5);
    context.fill();

    addHiResCanvas(scene.textures, key, canvas, BLOCK_ART, BLOCK_ART);
  }
}

/** 판의 테두리와 바닥, 빈칸을 그린다. */
function drawBoard(g: Graphics, layout: Layout): void {
  const { cell, left, top } = layout;
  const size = cell * SIZE;
  drawPanel(g, left - BOARD_RIM, top - BOARD_RIM, size + BOARD_RIM * 2, size + BOARD_RIM * 2, {
    fill: LOOK.board.rim,
    shadow: LOOK.board.rimLip,
    radius: BOARD_RIM + 8,
    depth: BOARD_LIP,
  });
  g.fillStyle(LOOK.board.floor, 1);
  g.fillRoundedRect(left, top, size, size, 8);
  g.fillStyle(LOOK.board.slot, 1);
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      g.fillRoundedRect(left + col * cell + 1.5, top + row * cell + 1.5, cell - 3, cell - 3, 5);
    }
  }
}

/**
 * 판을 한 장의 그림으로 구워서 놓는다. 빈칸이 예순네 개라서 도형으로 두면 프레임마다 다시 쪼개느라 무겁다.
 * 화면의 길이에 따라 칸의 크기가 달라지므로 들어올 때마다 새로 굽는다.
 */
export function addBoard(scene: Phaser.Scene, layout: Layout): Phaser.GameObjects.Image {
  const key = 'block-fill-board';
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const size = layout.cell * SIZE + BOARD_RIM * 2;
  const left = layout.left - BOARD_RIM;
  const top = layout.top - BOARD_RIM;
  bakeShape(scene, key, { width: size, height: size + BOARD_LIP, originX: -left, originY: -top }, (g) =>
    drawBoard(g, layout),
  );
  return scene.add.image(left, top, key).setOrigin(0, 0);
}

/** 쟁반의 받침을 그린다. 세 자리를 한 장의 둥근 판이 받치고, 자리 사이에 옅은 금을 긋는다. */
export function drawTray(g: Graphics, layout: Layout): void {
  const { tray, slots, slotWidth } = layout;
  drawPanel(g, tray.x, tray.y, tray.width, tray.height, {
    fill: LOOK.tray.plate,
    shadow: LOOK.tray.plateLip,
    radius: 14,
    depth: BOARD_LIP,
  });
  g.fillStyle(LOOK.tray.seam, 1);
  const seamHeight = Math.round(tray.height * 0.5);
  for (const slot of slots.slice(1)) {
    g.fillRoundedRect(slot.x - slotWidth / 2 - 1, tray.y + (tray.height - seamHeight) / 2, 2, seamHeight, 1);
  }
}
