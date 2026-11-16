/**
 * 네모 로직의 그림. 색은 LOOK 한곳에 모아 두고, 모든 것을 둥근 도형으로 그린다.
 * 겉모습을 바꿀 때는 이 파일만 고치면 된다. 씬은 여기 함수들이 그린 것을 놓고 움직이기만 한다.
 * 빈칸은 평평한 종이 바닥, 칠한 칸은 도톰한 물감 방석, 칠하지 않을 칸은 연필로 그은 X다.
 */
import type Phaser from 'phaser';
import { THEME, THEME_CSS } from '../../config';
import { bakeShape } from '../../core/bake';
import { drawPanel } from '../../core/ui';
import type { BoardLayout, BoardSize, Tool } from './rules';

type Graphics = Phaser.GameObjects.Graphics;

/** 단추에 놓이는 순서대로의 도구 */
export const TOOLS = ['fill', 'mark'] as const satisfies readonly Tool[];

export const LOOK = {
  board: {
    /** 판을 두르는 테두리와 그 아래 두께 */
    rim: THEME.card,
    rimLip: THEME.shadow,
    /** X 도구일 때 테두리에 두르는 띠. 지금 누르면 X가 그어진다는 것을 판에서도 알 수 있다. */
    markRim: THEME.coral,
    /** 빈칸의 바닥과 칸 사이의 옅은 금, 다섯 칸마다 긋는 굵은 금 */
    floor: THEME.butterSoft,
    seam: THEME.butterDeep,
    /** 틀려서 X가 그어진 칸의 바닥 */
    missed: THEME.pinkSoft,
  },
  /** 줄마다의 숫자 뒤에 까는 띠: 아직 칠할 것이 남은 줄과 다 칠한 줄 */
  clue: { strip: THEME.card, done: THEME.mintSoft },
  /** 푸는 동안의 칠한 칸. 다 칠하면 그림의 색으로 바뀐다. */
  ink: THEME.lilacDeep,
  /** 손으로 그은 X와, 틀려서 드러난 X */
  mark: THEME.faint,
  miss: THEME.bad,
  /** 연습에서 지금 볼 곳에 두르는 테 */
  focus: THEME.skyDeep,
  /** 손가락이 지나가는 칸에 미리 보여 주는 테: 칠하기와 X */
  stroke: { fill: THEME.lilacDeep, mark: THEME.coralDeep },
  /** 무작위로 만든 판을 다 칠했을 때 입히는 색. 판마다 차례로 돌아가며 쓴다. */
  patterns: [THEME.pinkDeep, THEME.skyDeep, THEME.mintDeep, THEME.lilacDeep, THEME.butterDeep, THEME.coral],
  hearts: { plate: THEME.card, plateLip: THEME.shadow, full: THEME.pinkDeep, empty: THEME.shadow },
  toggle: {
    plate: THEME.card,
    plateLip: THEME.shadow,
    pressed: THEME.dim,
    fill: { face: THEME.lilac, lip: THEME.lilacDeep },
    mark: { face: THEME.coral, lip: THEME.coralDeep },
    iconOn: THEME.inkDeep,
    iconOff: THEME.faint,
  },
  sparks: {
    fill: [THEME.lilac, THEME.lilacDeep, THEME.lilacSoft],
    miss: [THEME.coral, THEME.coralDeep, THEME.butter],
    clear: [THEME.gold, THEME.pink, THEME.mintDeep, THEME.skyDeep],
  },
  text: {
    clue: THEME_CSS.inkDeep,
    clueDone: THEME_CSS.faint,
    hint: THEME_CSS.ink,
    hintSub: THEME_CSS.sub,
    outline: THEME_CSS.white,
    /** 판 위에 뜨는 "+점수 +시간" 글자 뒤의 바탕 */
    plate: THEME.card,
    points: THEME_CSS.accent,
    good: THEME_CSS.good,
    bad: THEME_CSS.bad,
    ready: THEME_CSS.accent,
    over: THEME_CSS.accent,
    stage: THEME_CSS.sub,
    name: THEME_CSS.inkDeep,
    count: THEME_CSS.white,
    countOutline: THEME_CSS.inkDeep,
    toggleOn: THEME_CSS.inkDeep,
    toggleOff: THEME_CSS.faint,
  },
} as const;

/** X를 그릴 때 기준으로 삼은 칸 크기. 칸이 더 크거나 작으면 그만큼 맞춰서 놓는다. */
export const ART_CELL = 24;
/** 판의 테두리 폭 */
export const RIM = 4;
/** 칠한 칸 아래에 보이는 두께 */
const PAD_LIP = 2;
/** 이 칸 수마다 굵은 금을 그어서 칸을 세기 쉽게 한다. */
const COUNT_EVERY = 5;

// ───────── 판 ─────────

/**
 * 판의 바닥을 그린다. 원점은 판(칸들)의 한가운데다.
 * 칠한 칸과 X는 이 위에 따로 얹으므로, 여기서는 테두리와 빈칸의 바닥, 칸 사이의 금만 그린다.
 */
export function drawBoard(g: Graphics, size: BoardSize, cell: number, tool: Tool): void {
  const width = size.cols * cell;
  const height = size.rows * cell;
  const left = -width / 2;
  const top = -height / 2;

  g.clear();
  drawPanel(g, left - RIM, top - RIM, width + RIM * 2, height + RIM * 2, {
    fill: LOOK.board.rim,
    shadow: LOOK.board.rimLip,
    border: tool === 'mark' ? LOOK.board.markRim : undefined,
    radius: RIM + 5,
  });
  g.fillStyle(LOOK.board.floor, 1);
  g.fillRoundedRect(left, top, width, height, 6);

  // 칸 사이의 금. 다섯 칸마다는 굵고 짙게 긋는다.
  for (let col = 1; col < size.cols; col += 1) {
    const thick = col % COUNT_EVERY === 0;
    g.fillStyle(LOOK.board.seam, thick ? 0.95 : 0.5);
    g.fillRect(left + col * cell - (thick ? 1 : 0.5), top + 2, thick ? 2 : 1, height - 4);
  }
  for (let row = 1; row < size.rows; row += 1) {
    const thick = row % COUNT_EVERY === 0;
    g.fillStyle(LOOK.board.seam, thick ? 0.95 : 0.5);
    g.fillRect(left + 2, top + row * cell - (thick ? 1 : 0.5), width - 4, thick ? 2 : 1);
  }
}

/**
 * 줄마다의 숫자 뒤에 까는 띠를 그린다. 원점은 판의 한가운데다.
 * 가로줄의 띠는 판의 왼쪽에, 세로줄의 띠는 판의 위쪽에 놓인다. 다 칠한 줄의 띠는 색이 바뀐다.
 * 띠는 한 줄 걸러 조금 옅어서, 숫자가 어느 줄의 것인지 따라가기 쉽다.
 */
export function drawClueStrips(
  g: Graphics,
  size: BoardSize,
  layout: BoardLayout,
  rowsDone: readonly boolean[],
  colsDone: readonly boolean[],
): void {
  const { cell, clueWidth, clueHeight } = layout;
  const left = -(size.cols * cell) / 2;
  const top = -(size.rows * cell) / 2;
  const gap = RIM + 1;

  g.clear();
  for (let row = 0; row < size.rows; row += 1) {
    g.fillStyle(rowsDone[row] ? LOOK.clue.done : LOOK.clue.strip, rowsDone[row] || row % 2 === 0 ? 0.9 : 0.55);
    g.fillRoundedRect(left - clueWidth, top + row * cell + 1, clueWidth - gap, cell - 2, 5);
  }
  for (let col = 0; col < size.cols; col += 1) {
    g.fillStyle(colsDone[col] ? LOOK.clue.done : LOOK.clue.strip, colsDone[col] || col % 2 === 0 ? 0.9 : 0.55);
    g.fillRoundedRect(left + col * cell + 1, top - clueHeight, cell - 2, clueHeight - gap, 5);
  }
}

// ───────── 칸 ─────────

/** 칠한 칸: 도톰한 물감 방석. 원점은 칸의 한가운데다. 흰 물감은 바닥과 섞이지 않게 아래 두께를 회색으로 둔다. */
function drawPad(g: Graphics, cell: number, color: number): void {
  const size = cell - 2;
  const half = size / 2;
  const radius = cell * 0.24;
  g.fillStyle(lipOf(color), 1);
  g.fillRoundedRect(-half, -half + PAD_LIP, size, size - PAD_LIP, radius);
  g.fillStyle(color, 1);
  g.fillRoundedRect(-half, -half, size, size - PAD_LIP, radius);
}

/** 물감 색의 아래 두께 색: 같은 색을 조금 어둡게 한 것 */
function lipOf(color: number): number {
  const shade = (channel: number): number => Math.round(channel * 0.8);
  return (shade((color >> 16) & 0xff) << 16) | (shade((color >> 8) & 0xff) << 8) | shade(color & 0xff);
}

/**
 * 칠한 칸의 그림. 판에 수십 개가 놓이므로 칸 크기와 색마다 한 장씩 구워서 같이 쓴다.
 * 돌려주는 것은 텍스처의 이름이고, 이미지의 한가운데가 칸의 한가운데다.
 */
export function padTexture(scene: Phaser.Scene, cell: number, color: number = LOOK.ink): string {
  // 칸의 크기는 판의 크기에 따라 달라진다. 소수 둘째 자리까지 같으면 같은 그림을 쓴다.
  const size = Math.round(cell * 100) / 100;
  const key = `nemo-logic-pad-${size}-${color.toString(16)}`;
  return bakeShape(scene, key, { width: Math.ceil(size), height: Math.ceil(size) }, (g) =>
    drawPad(g, size, color),
  );
}

/** X: 둥근 끝의 굵은 금 두 줄. 원점은 칸의 한가운데이고, ART_CELL 크기의 칸에 맞춰 그린다. */
function drawCross(g: Graphics, color: number, reach: number, width: number): void {
  g.lineStyle(width, color, 1);
  g.lineBetween(-reach, -reach, reach, reach);
  g.lineBetween(-reach, reach, reach, -reach);
  g.fillStyle(color, 1);
  for (const x of [-reach, reach]) {
    for (const y of [-reach, reach]) g.fillCircle(x, y, width / 2);
  }
}

/** X의 그림은 ART_CELL 크기로 굽는다. 칸이 그보다 커도 또렷하게 ART_ZOOM배까지 촘촘하게 둔다. */
const ART_ZOOM = 1.5;
const ART_BOX = { width: ART_CELL, height: ART_CELL, zoom: ART_ZOOM } as const;

/** 손으로 그은 X의 텍스처 이름. 이미지의 한가운데가 칸의 한가운데다. */
export function markTexture(scene: Phaser.Scene): string {
  return bakeShape(scene, 'nemo-logic-mark', ART_BOX, (g) => drawCross(g, LOOK.mark, 4.5, 2.2));
}

/** 틀려서 드러난 X의 텍스처 이름. 붉은 바닥 위에 짙은 X라서 손으로 그은 X와 색이 아니어도 구별된다. */
export function missTexture(scene: Phaser.Scene): string {
  return bakeShape(scene, 'nemo-logic-miss', ART_BOX, (g) => {
    const size = ART_CELL - 3;
    g.fillStyle(LOOK.board.missed, 1);
    g.fillRoundedRect(-size / 2, -size / 2, size, size, ART_CELL * 0.24);
    drawCross(g, LOOK.miss, 5.5, 3);
  });
}

/** 손가락이 지나가는 칸들에 테를 둘러서, 손을 떼면 어디가 칠해질지 미리 보여 준다. (x, y)는 칸의 왼쪽 위다. */
export function drawStroke(
  g: Graphics,
  spots: ReadonlyArray<{ x: number; y: number }>,
  cell: number,
  tool: Tool,
): void {
  g.clear();
  const color = LOOK.stroke[tool];
  for (const { x, y } of spots) {
    g.fillStyle(color, 0.28);
    g.fillRoundedRect(x + 1, y + 1, cell - 2, cell - 2, cell * 0.24);
    g.lineStyle(2, color, 1);
    g.strokeRoundedRect(x + 1, y + 1, cell - 2, cell - 2, cell * 0.24);
  }
}

/** 연습에서 지금 볼 곳(줄이나 칸, 단추)에 테를 두른다. 깜빡이는 것은 씬이 한다. */
export function drawFocus(
  g: Graphics,
  spots: ReadonlyArray<{ x: number; y: number; width: number; height: number; radius: number }>,
): void {
  g.clear();
  g.lineStyle(3, LOOK.focus, 1);
  for (const { x, y, width, height, radius } of spots) {
    g.strokeRoundedRect(x - 1, y - 1, width + 2, height + 2, radius);
  }
}

// ───────── 목숨 ─────────

const HEART_GAP = 14;
/** 목숨 판의 크기. 옆에 다른 것을 놓을 때 쓴다. */
export const HEARTS_SIZE = { width: 3 * HEART_GAP + 10, height: 20 } as const;

function drawHeart(g: Graphics, x: number, y: number, color: number): void {
  g.fillStyle(color, 1);
  g.fillCircle(x - 2.7, y - 1.7, 3.1);
  g.fillCircle(x + 2.7, y - 1.7, 3.1);
  g.fillTriangle(x - 5.5, y - 0.2, x + 5.5, y - 0.2, x, y + 5.6);
}

/** 목숨을 흰 알약 모양 판 위에 하트로 그린다. (x, y)가 판의 왼쪽 위다. */
export function drawHearts(g: Graphics, x: number, y: number, full: number, total: number): void {
  const { width, height } = HEARTS_SIZE;
  g.clear();
  g.fillStyle(LOOK.hearts.plateLip, 1);
  g.fillRoundedRect(x, y + 2, width, height, height / 2);
  g.fillStyle(LOOK.hearts.plate, 1);
  g.fillRoundedRect(x, y, width, height, height / 2);
  for (let i = 0; i < total; i += 1) {
    const color = i < full ? LOOK.hearts.full : LOOK.hearts.empty;
    drawHeart(g, x + 12 + i * HEART_GAP, y + height / 2 - 0.6, color);
  }
}

// ───────── 칠하기·X 단추 ─────────

/** 단추 아래에 보이는 두께 */
const TOGGLE_LIP = 3;
/** 흰 판 가장자리에서 색 있는 알약까지의 틈 */
const TOGGLE_INSET = 3;

/** 단추 반쪽의 가운데 좌표. 글자와 아이콘을 놓을 때 쓴다. */
export function toggleCenter(
  x: number,
  y: number,
  segment: number,
  height: number,
  tool: Tool,
): { x: number; y: number } {
  return { x: x + (tool === 'fill' ? 0.5 : 1.5) * segment, y: y + (height - TOGGLE_LIP) / 2 };
}

/** "칠하기" 아이콘: 칠한 칸 하나 */
function drawFillIcon(g: Graphics, x: number, y: number, color: number): void {
  g.fillStyle(color, 1);
  g.fillRoundedRect(x - 5, y - 5, 10, 10, 2.5);
}

/** "X" 아이콘: 판에 긋는 X를 줄여 그린 것 */
function drawMarkIcon(g: Graphics, x: number, y: number, color: number): void {
  g.lineStyle(2.2, color, 1);
  g.lineBetween(x - 4, y - 4, x + 4, y + 4);
  g.lineBetween(x - 4, y + 4, x + 4, y - 4);
}

/**
 * 칠하기·X 단추를 그린다. 흰 판 위에서 지금 고른 쪽만 색 있는 알약으로 도드라진다.
 * (x, y)가 왼쪽 위이고, 반쪽의 폭이 segment다. pressed는 손가락이 눌려 있는 쪽이다.
 * iconOffset은 반쪽의 가운데에서 아이콘까지의 거리(왼쪽이 음수)다. 글자 수가 달라서 도구마다 따로 받는다.
 */
export function drawToggle(
  g: Graphics,
  x: number,
  y: number,
  segment: number,
  height: number,
  tool: Tool,
  pressed: Tool | null,
  iconOffset: Readonly<Record<Tool, number>>,
): void {
  const face = height - TOGGLE_LIP;
  g.clear();
  g.fillStyle(LOOK.toggle.plateLip, 1);
  g.fillRoundedRect(x, y + TOGGLE_LIP, segment * 2, face, face / 2);
  g.fillStyle(LOOK.toggle.plate, 1);
  g.fillRoundedRect(x, y, segment * 2, face, face / 2);

  for (const side of TOOLS) {
    const left = x + (side === 'fill' ? 0 : segment) + TOGGLE_INSET;
    const width = segment - TOGGLE_INSET * 2;
    const pillHeight = face - TOGGLE_INSET * 2;
    const radius = pillHeight / 2;
    if (side === tool) {
      g.fillStyle(LOOK.toggle[side].lip, 1);
      g.fillRoundedRect(left, y + TOGGLE_INSET, width, pillHeight, radius);
      g.fillStyle(LOOK.toggle[side].face, 1);
      g.fillRoundedRect(left, y + TOGGLE_INSET, width, pillHeight - 2, radius - 1);
    } else if (side === pressed) {
      g.fillStyle(LOOK.toggle.pressed, 1);
      g.fillRoundedRect(left, y + TOGGLE_INSET, width, pillHeight, radius);
    }

    const center = toggleCenter(x, y, segment, height, side);
    const active = side === tool;
    const color = active ? LOOK.toggle.iconOn : LOOK.toggle.iconOff;
    // 색 있는 알약은 아래 두께만큼 윗면이 올라가 있으므로 아이콘도 같이 올린다.
    const iconY = center.y - (active ? 1 : 0);
    if (side === 'fill') drawFillIcon(g, center.x + iconOffset.fill, iconY, color);
    else drawMarkIcon(g, center.x + iconOffset.mark, iconY, color);
  }
}
