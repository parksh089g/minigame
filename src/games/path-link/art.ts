/**
 * 길 잇기의 그림. 색은 LOOK 한곳에 모아 두고, 모든 것을 둥근 도형으로 그린다.
 * 겉모습을 바꿀 때는 이 파일만 고치면 된다. 씬은 여기 함수들이 그린 것을 놓고 움직이기만 한다.
 * 쌍마다 색과 함께 점에 그리는 모양이 달라서, 색을 가려 보기 어려워도 모양으로 짝을 찾을 수 있다.
 */
import type Phaser from 'phaser';
import { THEME, THEME_CSS } from '../../config';
import { drawPanel } from '../../core/ui';

type Graphics = Phaser.GameObjects.Graphics;

/** 점에 그리는 모양 */
export type Mark = 'heart' | 'drop' | 'triangle' | 'star' | 'diamond' | 'moon' | 'plus' | 'ring';

export interface PairLook {
  /** 길과 점의 윗면 */
  face: number;
  /** 길과 점의 테두리. 옅은 색의 길도 밝은 판 위에서 또렷하게 보이게 한다. */
  edge: number;
  /** 이어진 길이 지나는 칸을 물들이는 색 */
  tint: number;
  mark: Mark;
  /** 모양의 색. 밝은 점에는 짙은 색, 어두운 점에는 흰색이다. */
  markColor: number;
}

/** 윗면 색을 어둡게 한 테두리 색 */
function shade(color: number, amount = 0.7): number {
  const channel = (shift: number): number => Math.round(((color >> shift) & 0xff) * amount) << shift;
  return channel(16) | channel(8) | channel(0);
}

/** 두 색을 섞는다. ratio가 0이면 a, 1이면 b다. */
function mix(a: number, b: number, ratio: number): number {
  const channel = (shift: number): number =>
    Math.round(((a >> shift) & 0xff) * (1 - ratio) + ((b >> shift) & 0xff) * ratio) << shift;
  return channel(16) | channel(8) | channel(0);
}

const pair = (face: number, mark: Mark, markColor: number = THEME.inkDeep, edge = shade(face)): PairLook => ({
  face,
  edge,
  // 흰색 길은 윗면 색으로 물들이면 보이지 않으므로 테두리 색으로 물들인다.
  tint: face === THEME.white ? edge : face,
  mark,
  markColor,
});

export const LOOK = {
  board: {
    /** 판을 두르는 테두리와 그 아래 두께 */
    rim: THEME.card,
    rimLip: THEME.shadow,
    /** 빈칸의 바닥 */
    cell: THEME.dim,
  },
  /**
   * 쌍의 색과 모양. 앞에서부터 쓰므로 서로 가장 잘 가려지는 색을 앞에 두었다
   * (작은 판은 앞의 다섯이나 여섯만 쓴다): 빨강, 파랑, 초록, 노랑, 보라, 짙은 회색, 흰색, 갈색.
   */
  pairs: [
    pair(THEME.coralDeep, 'heart'),
    pair(THEME.skyDeep, 'drop'),
    pair(THEME.mintDeep, 'triangle'),
    pair(THEME.gold, 'star'),
    pair(THEME.lilacDeep, 'diamond'),
    pair(THEME.sub, 'moon', THEME.white, THEME.inkDeep),
    pair(THEME.white, 'plus', THEME.inkDeep, THEME.faint),
    pair(THEME.accent, 'ring', THEME.white),
  ] as readonly PairLook[],
  /** 이어진 길이 지나는 칸을 그 색으로 물들이는 정도 */
  linkedTint: 0.36,
  /** 빈칸이 남았다고 알릴 때 빈칸에 찍는 표시 */
  leftover: THEME.coralDeep,
  /** 그리는 법을 보여 주는 손가락 */
  finger: { face: THEME.white, edge: THEME.inkDeep },
  sparks: {
    clear: [THEME.gold, THEME.pink, THEME.mintDeep, THEME.skyDeep],
  },
  text: {
    hint: THEME_CSS.ink,
    hintSub: THEME_CSS.sub,
    outline: THEME_CSS.white,
    notice: THEME_CSS.bad,
    status: THEME_CSS.sub,
    statusDone: THEME_CSS.good,
    /** 판 위에 뜨는 "+점수 +시간" 글자 뒤의 바탕 */
    plate: THEME.card,
    points: THEME_CSS.accent,
    good: THEME_CSS.good,
    ready: THEME_CSS.accent,
    over: THEME_CSS.accent,
  },
} as const;

/** 쌍 번호에 맞는 색과 모양. 쌍이 준비한 것보다 많으면 처음부터 다시 돈다. */
export function pairLook(index: number): PairLook {
  return LOOK.pairs[index % LOOK.pairs.length];
}

/** 그리는 법을 보여 줄 때 쓰는 옅은 길. 진짜 길과 헷갈리지 않게 판의 바닥 색을 섞는다. */
export function ghostLook(look: PairLook): PairLook {
  return { ...look, face: mix(look.face, LOOK.board.cell, 0.45), edge: mix(look.edge, LOOK.board.cell, 0.45) };
}

/** 판의 테두리 폭 */
export const RIM = 5;
/** 칸의 바닥을 칸 경계에서 안쪽으로 들이는 폭 */
const CELL_INSET = 1.5;
/** 길과 점에 두르는 테두리의 두께 */
const EDGE = 1.5;

/** 칸 크기에 따른 길의 굵기, 점의 반지름 */
export function ribbonWidth(cell: number): number {
  return Math.round(cell * 0.3);
}

export function dotRadius(cell: number): number {
  return Math.round(cell * 0.33);
}

// ───────── 판 ─────────

/** 판의 테두리와 빈칸의 바닥을 그린다. 원점은 판의 한가운데다. */
export function drawBoard(g: Graphics, size: number, cell: number): void {
  const span = size * cell;
  const left = -span / 2;
  g.clear();
  drawPanel(g, left - RIM, left - RIM, span + RIM * 2, span + RIM * 2, {
    fill: LOOK.board.rim,
    shadow: LOOK.board.rimLip,
    radius: RIM + 8,
    depth: 4,
  });
  g.fillStyle(LOOK.board.cell, 1);
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      fillCell(g, left + (col + 0.5) * cell, left + (row + 0.5) * cell, cell);
    }
  }
}

/** 가운데가 (x, y)인 칸의 바닥 모양을 지금 색으로 칠한다. */
export function fillCell(g: Graphics, x: number, y: number, cell: number): void {
  const side = cell - CELL_INSET * 2;
  g.fillRoundedRect(x - side / 2, y - side / 2, side, side, cell * 0.2);
}

// ───────── 길 ─────────

export interface Point {
  x: number;
  y: number;
}

/** 점들을 차례로 잇는 굵고 둥근 띠를 지금 색으로 칠한다. 이웃한 점은 가로나 세로로 나란하다. */
function fillRibbon(g: Graphics, points: readonly Point[], width: number): void {
  const half = width / 2;
  points.forEach((point, index) => {
    g.fillCircle(point.x, point.y, half);
    if (index === 0) return;
    const previous = points[index - 1];
    if (previous.y === point.y) {
      g.fillRect(Math.min(previous.x, point.x), point.y - half, Math.abs(point.x - previous.x), width);
    } else {
      g.fillRect(point.x - half, Math.min(previous.y, point.y), width, Math.abs(point.y - previous.y));
    }
  });
}

/** 길의 테두리. 모든 길의 테두리를 먼저 그리고 그 위에 윗면을 그려야 길이 꺾이는 곳이 깔끔하다. */
export function drawRibbonEdge(g: Graphics, points: readonly Point[], width: number, look: PairLook): void {
  g.fillStyle(look.edge, 1);
  fillRibbon(g, points, width + EDGE * 2);
}

/** 길의 윗면 */
export function drawRibbonFace(g: Graphics, points: readonly Point[], width: number, look: PairLook): void {
  g.fillStyle(look.face, 1);
  fillRibbon(g, points, width);
}

/** 그리고 있는 길의 머리: 길보다 조금 큰 동그라미라 손가락 옆으로 삐져나와 보인다. */
export function drawRibbonHead(g: Graphics, point: Point, width: number, look: PairLook): void {
  const radius = width * 0.72;
  g.fillStyle(look.edge, 1);
  g.fillCircle(point.x, point.y, radius + EDGE);
  g.fillStyle(look.face, 1);
  g.fillCircle(point.x, point.y, radius);
}

// ───────── 점 ─────────

function starPoints(outer: number, inner: number): Point[] {
  return Array.from({ length: 10 }, (_, index) => {
    const radius = index % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (index * Math.PI) / 5;
    return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
  });
}

/** 가운데 (cx, cy)에서 둘레의 점들로 부채꼴처럼 세모를 이어 붙여 별 같은 모양을 칠한다. */
function fillFan(g: Graphics, points: readonly Point[], cx: number, cy: number): void {
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    g.fillTriangle(cx, cy, cx + point.x, cy + point.y, cx + next.x, cy + next.y);
  });
}

/**
 * 쌍의 모양을 그린다. (cx, cy)가 모양의 가운데이고, s는 모양의 반쯤 되는 크기다.
 * 달과 고리는 바깥 모양을 칠한 뒤 바탕의 색(face)으로 안쪽을 덮어서 만든다.
 */
function drawMark(g: Graphics, mark: Mark, s: number, color: number, face: number, cx = 0, cy = 0): void {
  g.fillStyle(color, 1);
  switch (mark) {
    case 'heart':
      g.fillCircle(cx - s * 0.48, cy - s * 0.28, s * 0.56);
      g.fillCircle(cx + s * 0.48, cy - s * 0.28, s * 0.56);
      g.fillTriangle(cx - s * 0.99, cy + s * 0.02, cx + s * 0.99, cy + s * 0.02, cx, cy + s * 1.02);
      break;
    case 'drop':
      g.fillCircle(cx, cy + s * 0.3, s * 0.68);
      g.fillTriangle(cx, cy - s * 1.05, cx - s * 0.6, cy + s * 0.02, cx + s * 0.6, cy + s * 0.02);
      break;
    case 'triangle':
      g.fillTriangle(cx, cy - s * 0.95, cx - s, cy + s * 0.75, cx + s, cy + s * 0.75);
      break;
    case 'star':
      fillFan(g, starPoints(s * 1.12, s * 0.52), cx, cy);
      break;
    case 'diamond':
      g.fillTriangle(cx, cy - s * 1.1, cx + s * 0.78, cy, cx - s * 0.78, cy);
      g.fillTriangle(cx, cy + s * 1.1, cx + s * 0.78, cy, cx - s * 0.78, cy);
      break;
    case 'moon':
      g.fillCircle(cx - s * 0.1, cy, s * 0.95);
      g.fillStyle(face, 1);
      g.fillCircle(cx + s * 0.38, cy - s * 0.22, s * 0.78);
      break;
    case 'plus':
      g.fillRoundedRect(cx - s, cy - s * 0.34, s * 2, s * 0.68, s * 0.2);
      g.fillRoundedRect(cx - s * 0.34, cy - s, s * 0.68, s * 2, s * 0.2);
      break;
    case 'ring':
      g.fillCircle(cx, cy, s);
      g.fillStyle(face, 1);
      g.fillCircle(cx, cy, s * 0.46);
      break;
  }
}

/** 길 위에 찍는 모양의 크기: 길의 굵기에 대한 비율(모양의 반쯤 되는 크기) */
const RIBBON_MARK = 0.4;

/**
 * 색 구분 도우미: 길이 지나는 칸마다 그 쌍의 모양을 찍는다. 길이 나란히 붙어 있어도 어느 쌍의 길인지 모양으로 알 수 있다.
 * 양 끝의 점에는 이미 모양이 있으므로 points에는 그 사이의 칸만 넘긴다. 윗면을 그린 뒤에 부른다.
 */
export function drawRibbonMarks(g: Graphics, points: readonly Point[], width: number, look: PairLook): void {
  for (const point of points) {
    drawMark(g, look.mark, width * RIBBON_MARK, look.markColor, look.face, point.x, point.y);
  }
}

/** 점: 테두리를 두른 동그라미 위에 그 쌍의 모양을 얹는다. 원점은 점의 한가운데다. */
export function drawDot(g: Graphics, look: PairLook, radius: number): void {
  g.clear();
  g.fillStyle(look.edge, 1);
  g.fillCircle(0, 0, radius + EDGE);
  g.fillStyle(look.face, 1);
  g.fillCircle(0, 0, radius);
  drawMark(g, look.mark, radius * 0.5, look.markColor, look.face);
}

// ───────── 알림 ─────────

/** 아직 덮이지 않은 칸에 찍는 표시: 가운데의 작은 고리. 원점은 판의 한가운데다. */
export function drawLeftover(g: Graphics, points: readonly Point[], cell: number): void {
  g.clear();
  g.lineStyle(2, LOOK.leftover, 1);
  for (const point of points) g.strokeCircle(point.x, point.y, cell * 0.17);
}

/** 그리는 법을 보여 주는 손가락 끝: 흰 동그라미. 원점은 손가락 끝이다. */
export function drawFinger(g: Graphics, point: Point, cell: number): void {
  const radius = cell * 0.24;
  g.fillStyle(LOOK.finger.edge, 0.55);
  g.fillCircle(point.x, point.y + 1.5, radius + 1.5);
  g.fillStyle(LOOK.finger.face, 0.95);
  g.fillCircle(point.x, point.y, radius);
}
