/**
 * 사탕 슬롯의 그림. 색은 LOOK 한곳에 모아 둔다. 슬롯의 여섯 그림은 카지노 슬롯에서 보는 것들
 * (체리, 클로버, 종, 말굽, 다이아, 7)이고, 이 앱의 다른 그림처럼 아래로 도톰한 두께를 넣어 그린다.
 * 그림과 부적은 한 번 구워 텍스처로 두고, 씬은 그것을 놓고 움직이기만 한다.
 *
 * 여섯 그림은 색과 함께 모양이 모두 달라서, 색을 가려 보기 어려워도 모양으로 줄을 알아볼 수 있다.
 * 부적은 갈래마다 테두리 색이 다르지만, 무엇을 하는 부적인지는 안에 그린 그림과 표시(더하기, 빼기, 사탕)로 알 수 있다.
 */
import type Phaser from 'phaser';
import { THEME, THEME_CSS } from '../../config';
import { bakeShape } from '../../core/bake';
import {
  CENTER,
  charmOf,
  LINES,
  SIZE,
  SYMBOLS,
  WILD,
  type CharmInfo,
  type CharmKind,
  type LineKind,
  type SymbolKey,
} from './rules';

type Graphics = Phaser.GameObjects.Graphics;

interface Point {
  x: number;
  y: number;
}

interface Tone {
  face: number;
  /** 아래로 도톰하게 내려오는 옆면 */
  lip: number;
}

export const LOOK = {
  /** 기계: 빨간 몸통과 그 아래 두께, 그림이 놓이는 칸의 바닥, 칸을 두르는 금테, 몸통을 따라 박힌 전구 */
  machine: {
    body: 0xc92a3c,
    lip: 0x7f1424,
    shine: 0xf0707c,
    slot: THEME.white,
    slotAlt: 0xfff1d6,
    trim: 0xffd24a,
    trimLip: 0xb5810f,
    bulbOn: 0xfff6c2,
    bulbOff: 0xe39a1c,
  },
  /** 기계가 놓인 카지노 테이블의 초록 천: 바탕, 기계 둘레의 밝은 자리, 천의 무늬 */
  felt: { base: 0x1b7350, glow: 0x239066, mark: 0x176646 },
  /** 그림마다의 색. 카지노 슬롯의 그림답게 짙고 또렷한 색을 쓴다. */
  symbols: {
    cherry: { face: 0xdc2f45, lip: 0x8f1830 },
    clover: { face: 0x33ad4f, lip: 0x1c7436 },
    bell: { face: 0xf6c23c, lip: 0xb9801a },
    horseshoe: { face: 0x97a3bd, lip: 0x5c6887 },
    diamond: { face: 0x38a8ec, lip: 0x1b6cb8 },
    seven: { face: 0xe8283c, lip: 0x8a1022 },
  } satisfies Record<SymbolKey, Tone>,
  /** 7을 두르는 금빛 테두리 */
  sevenTrim: { face: 0xffd24a, lip: 0xb5810f },
  /** 체리의 꼭지와 잎 */
  stem: { face: 0x58b04a, lip: 0x2f7a33 },
  /** 종 아래로 보이는 추 */
  clapper: 0x8a5a14,
  /** 다이아의 깎인 면: 밝은 면과 중간 면 */
  gem: { light: 0xc8f0ff, mid: 0x7fd0fa },
  shine: THEME.white,
  /** 맞은 줄을 긋는 선: 겉과 속 */
  winLine: { edge: THEME.accent, core: THEME.gold },
  /** 맞은 칸의 바닥에 잠깐 깔리는 빛 */
  winGlow: THEME.butter,
  /** 부적의 갈래마다의 테두리 */
  charm: {
    odds: { edge: THEME.mintDeep, face: THEME.mintSoft },
    prize: { edge: THEME.pinkDeep, face: THEME.pinkSoft },
    line: { edge: THEME.skyDeep, face: THEME.skySoft },
    trick: { edge: THEME.butterDeep, face: THEME.butterSoft },
  } satisfies Record<CharmKind, { edge: number; face: number }>,
  /** 부적이 붙지 않은 빈자리 */
  emptySlot: { edge: 0x12573b, face: 0x186848 },
  /** 부적 그림 위의 표시: 더하기, 빼기 */
  plus: THEME.good,
  minus: THEME.bad,
  mark: THEME.white,
  /** 줄 부적의 작은 판: 여느 칸과 곱해지는 칸 */
  dot: THEME.white,
  dotOn: THEME.accent,
  candy: { face: THEME.pink, lip: THEME.pinkDeep, wrap: THEME.pinkSoft, swirl: THEME.white },
  goalBar: { back: THEME.dim, fill: THEME.gold, full: THEME.mintDeep },
  sparks: [THEME.gold, THEME.pink, THEME.mintDeep, THEME.skyDeep, THEME.white],
  text: {
    ink: THEME_CSS.ink,
    sub: THEME_CSS.sub,
    faint: THEME_CSS.faint,
    outline: THEME_CSS.white,
    shadow: THEME_CSS.shadow,
    points: THEME_CSS.accent,
    good: THEME_CSS.good,
    bad: THEME_CSS.bad,
  },
} as const;

// ───────── 둥근 도형 ─────────

/** 꼭짓점을 둥글린 다각형의 둘레. round는 꼭짓점에서 깎아 내는 길이다. */
function rounded(vertices: readonly Point[], round: number, steps = 4): Point[] {
  const points: Point[] = [];
  vertices.forEach((vertex, index) => {
    const before = vertices[(index + vertices.length - 1) % vertices.length];
    const after = vertices[(index + 1) % vertices.length];
    const toward = (other: Point): Point => {
      const length = Math.hypot(other.x - vertex.x, other.y - vertex.y);
      const cut = Math.min(round, length / 2) / length;
      return { x: vertex.x + (other.x - vertex.x) * cut, y: vertex.y + (other.y - vertex.y) * cut };
    };
    const from = toward(before);
    const to = toward(after);
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const a = (1 - t) * (1 - t);
      const b = 2 * (1 - t) * t;
      const c = t * t;
      points.push({ x: a * from.x + b * vertex.x + c * to.x, y: a * from.y + b * vertex.y + c * to.y });
    }
  });
  return points;
}

/** 기울인 타원의 둘레 */
function tilted(cx: number, cy: number, rx: number, ry: number, angle: number, steps = 22): Point[] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return Array.from({ length: steps }, (_, index) => {
    const t = (index / steps) * Math.PI * 2;
    const x = rx * Math.cos(t);
    const y = ry * Math.sin(t);
    return { x: cx + x * cos - y * sin, y: cy + x * sin + y * cos };
  });
}

function fillShape(g: Graphics, points: readonly Point[], dx: number, dy: number, color: number, alpha = 1): void {
  g.fillStyle(color, alpha);
  g.beginPath();
  points.forEach((point, index) => {
    if (index === 0) g.moveTo(point.x + dx, point.y + dy);
    else g.lineTo(point.x + dx, point.y + dy);
  });
  g.closePath();
  g.fillPath();
}

/** 옆면을 아래에 깔고 그 위에 윗면을 올린다. */
function chunky(g: Graphics, points: readonly Point[], x: number, y: number, tone: Tone, lip: number): void {
  fillShape(g, points, x, y + lip, tone.lip);
  fillShape(g, points, x, y, tone.face);
}

// ───────── 여섯 그림 ─────────

/** 둘레를 원점을 중심으로 돌린다. */
function turned(points: readonly Point[], angle: number): Point[] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return points.map((point) => ({ x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos }));
}

/** 클로버의 잎 하나: 뾰족한 끝이 원점에 있고 위로 벌어지는 하트 모양. h가 반쯤 되는 너비다. */
function leaf(h: number): Point[] {
  return Array.from({ length: 30 }, (_, index) => {
    const t = (index / 30) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    return { x: (x / 16) * h, y: ((y - 17) / 16) * h };
  });
}

/** 종의 몸통: 둥근 머리에서 아래로 벌어진다. */
function bellBody(s: number): Point[] {
  return rounded(
    [
      { x: -s * 0.3, y: -s * 0.8 },
      { x: s * 0.3, y: -s * 0.8 },
      { x: s * 0.62, y: -s * 0.2 },
      { x: s * 0.7, y: s * 0.42 },
      { x: s * 0.98, y: s * 0.68 },
      { x: -s * 0.98, y: s * 0.68 },
      { x: -s * 0.7, y: s * 0.42 },
      { x: -s * 0.62, y: -s * 0.2 },
    ],
    s * 0.26,
  );
}

/** 말굽: 위가 트인 두꺼운 U 모양 */
function horseshoe(s: number): Point[] {
  const outer = s * 0.94;
  const inner = s * 0.5;
  const top = -s * 0.86;
  const centerY = s * 0.04;
  const steps = 18;
  const points: Point[] = [{ x: -outer, y: top }];
  for (let step = 0; step <= steps; step += 1) {
    const angle = Math.PI - (Math.PI * step) / steps;
    points.push({ x: outer * Math.cos(angle), y: centerY + outer * Math.sin(angle) });
  }
  points.push({ x: outer, y: top }, { x: inner, y: top });
  for (let step = 0; step <= steps; step += 1) {
    const angle = (Math.PI * step) / steps;
    points.push({ x: inner * Math.cos(angle), y: centerY + inner * Math.sin(angle) });
  }
  points.push({ x: -inner, y: top });
  return points;
}

/** 다이아: 위가 평평하고 아래가 뾰족한 보석 */
function gem(s: number): Point[] {
  return rounded(
    [
      { x: -s * 0.56, y: -s * 0.72 },
      { x: s * 0.56, y: -s * 0.72 },
      { x: s, y: -s * 0.2 },
      { x: 0, y: s * 0.94 },
      { x: -s, y: -s * 0.2 },
    ],
    s * 0.1,
    2,
  );
}

/** 굵은 숫자 7: 위의 가로대와 왼쪽 아래로 내려가는 기둥, 가로대 왼쪽 끝의 짧은 턱 */
function sevenShape(s: number): Point[] {
  return [
    { x: -s * 0.8, y: -s * 0.86 },
    { x: s * 0.82, y: -s * 0.86 },
    { x: s * 0.82, y: -s * 0.46 },
    { x: s * 0.1, y: s * 0.9 },
    { x: -s * 0.5, y: s * 0.9 },
    { x: s * 0.2, y: -s * 0.4 },
    { x: -s * 0.48, y: -s * 0.4 },
    { x: -s * 0.48, y: -s * 0.14 },
    { x: -s * 0.8, y: -s * 0.14 },
  ];
}

/** 둘레를 여덟 방향으로 조금씩 밀어 찍어서 테두리를 두른다. */
function rim(g: Graphics, points: readonly Point[], x: number, y: number, width: number, color: number): void {
  for (let index = 0; index < 8; index += 1) {
    const angle = (index * Math.PI) / 4;
    fillShape(g, points, x + Math.cos(angle) * width, y + Math.sin(angle) * width, color);
  }
}

/** 그림 하나를 (x, y)를 한가운데로, s를 반쯤 되는 크기로 그린다. */
export function drawSymbol(g: Graphics, key: SymbolKey, x: number, y: number, s: number): void {
  const lip = Math.max(1, s * 0.14);
  switch (key) {
    case 'cherry': {
      const tone = LOOK.symbols.cherry;
      const joint = { x: x + s * 0.16, y: y - s * 0.9 };
      const fruits = [
        { x: x - s * 0.44, y: y + s * 0.4, r: s * 0.46 },
        { x: x + s * 0.5, y: y + s * 0.48, r: s * 0.42 },
      ];
      // 두 알을 잇는 꼭지와 잎
      g.lineStyle(Math.max(1, s * 0.13), LOOK.stem.lip, 1);
      for (const fruit of fruits) {
        g.beginPath();
        g.moveTo(fruit.x, fruit.y - fruit.r * 0.6);
        g.lineTo(joint.x, joint.y);
        g.strokePath();
      }
      fillShape(g, tilted(s * 0.56, -s * 0.78, s * 0.4, s * 0.2, -0.3), x, y + lip * 0.5, LOOK.stem.lip);
      fillShape(g, tilted(s * 0.56, -s * 0.78, s * 0.4, s * 0.2, -0.3), x, y, LOOK.stem.face);
      for (const fruit of fruits) {
        g.fillStyle(tone.lip, 1);
        g.fillCircle(fruit.x, fruit.y + lip * 0.6, fruit.r);
        g.fillStyle(tone.face, 1);
        g.fillCircle(fruit.x, fruit.y - lip * 0.2, fruit.r * 0.96);
        fillShape(g, tilted(-fruit.r * 0.36, -fruit.r * 0.5, fruit.r * 0.3, fruit.r * 0.16, -0.6), fruit.x, fruit.y, LOOK.shine, 0.75);
      }
      return;
    }
    case 'clover': {
      const tone = LOOK.symbols.clover;
      const cy = y - s * 0.12;
      // 줄기를 먼저 깔고, 네 잎을 비스듬히 벌려 얹는다.
      g.lineStyle(Math.max(1, s * 0.16), tone.lip, 1);
      g.beginPath();
      g.moveTo(x, cy);
      g.lineTo(x + s * 0.14, y + s * 0.98);
      g.strokePath();
      const leaves = [0, 1, 2, 3].map((index) => turned(leaf(s * 0.5), Math.PI / 4 + (index * Math.PI) / 2));
      for (const part of leaves) fillShape(g, part, x, cy + lip, tone.lip);
      for (const part of leaves) fillShape(g, part, x, cy, tone.face);
      fillShape(g, tilted(-s * 0.56, -s * 0.5, s * 0.2, s * 0.1, -0.8), x, cy, LOOK.shine, 0.6);
      return;
    }
    case 'bell': {
      const tone = LOOK.symbols.bell;
      const top = y - lip / 2;
      // 추, 꼭지, 몸통, 아래 띠
      g.fillStyle(LOOK.clapper, 1);
      g.fillCircle(x, top + s * 0.84, s * 0.2);
      g.fillStyle(tone.lip, 1);
      g.fillCircle(x, top - s * 0.84 + lip * 0.4, s * 0.17);
      g.fillStyle(tone.face, 1);
      g.fillCircle(x, top - s * 0.84, s * 0.17);
      chunky(g, bellBody(s), x, top, tone, lip);
      g.fillStyle(tone.lip, 1);
      g.fillRoundedRect(x - s * 0.72, top + s * 0.3, s * 1.44, s * 0.13, s * 0.06);
      fillShape(g, tilted(-s * 0.3, -s * 0.3, s * 0.1, s * 0.3, 0.3), x, top, LOOK.shine, 0.75);
      return;
    }
    case 'horseshoe': {
      const tone = LOOK.symbols.horseshoe;
      const top = y - lip / 2;
      chunky(g, horseshoe(s), x, top, tone, lip);
      // 못 구멍
      g.fillStyle(tone.lip, 1);
      for (const angle of [0.08, 0.3, 0.7, 0.92]) {
        const at = Math.PI * angle;
        g.fillCircle(x + s * 0.72 * Math.cos(at), top + s * 0.04 + s * 0.72 * Math.sin(at), Math.max(0.6, s * 0.08));
      }
      for (const side of [-1, 1]) g.fillCircle(x + side * s * 0.72, top - s * 0.46, Math.max(0.6, s * 0.08));
      fillShape(g, tilted(-s * 0.82, -s * 0.4, s * 0.06, s * 0.3, 0), x, top, LOOK.shine, 0.7);
      return;
    }
    case 'diamond': {
      const tone = LOOK.symbols.diamond;
      const top = y - lip / 2;
      chunky(g, gem(s), x, top, tone, lip);
      // 깎인 면: 위의 평평한 면과 가운데로 내려가는 면
      const table = [
        { x: -s * 0.5, y: -s * 0.66 },
        { x: s * 0.5, y: -s * 0.66 },
        { x: s * 0.3, y: -s * 0.2 },
        { x: -s * 0.3, y: -s * 0.2 },
      ];
      const heart = [
        { x: -s * 0.3, y: -s * 0.2 },
        { x: s * 0.3, y: -s * 0.2 },
        { x: 0, y: s * 0.8 },
      ];
      const side = [
        { x: -s * 0.5, y: -s * 0.66 },
        { x: -s * 0.3, y: -s * 0.2 },
        { x: -s * 0.88, y: -s * 0.2 },
      ];
      fillShape(g, heart, x, top, LOOK.gem.mid);
      fillShape(g, table, x, top, LOOK.gem.light);
      fillShape(g, side, x, top, LOOK.gem.mid);
      return;
    }
    case 'seven': {
      const tone = LOOK.symbols.seven;
      const shape = sevenShape(s);
      const top = y - lip / 2;
      const width = Math.max(0.8, s * 0.11);
      // 금빛 테두리와 그 아래 두께, 그 위에 빨간 숫자
      rim(g, shape, x, top + lip, width, LOOK.sevenTrim.lip);
      rim(g, shape, x, top, width, LOOK.sevenTrim.face);
      fillShape(g, shape, x, top, tone.lip);
      fillShape(g, shape, x, top - lip * 0.3, tone.face);
      g.fillStyle(LOOK.shine, 0.55);
      g.fillRoundedRect(x - s * 0.66, top - s * 0.78, s * 1.3, s * 0.1, s * 0.05);
      return;
    }
  }
}

/** 큰 그림(기계의 칸)의 크기. 칸이 이보다 크면 이미지를 키워 놓는다. */
export const SYMBOL_BOX = 44;
/** 작은 그림(확률 줄)의 크기 */
export const MINI_BOX = 14;

/** 기계의 칸에 놓는 그림. 칸이 커져도 또렷하게 촘촘히 굽는다. */
export function symbolTexture(scene: Phaser.Scene, symbol: number): string {
  const key = SYMBOLS[symbol].key;
  return bakeShape(scene, `candy-slot-symbol-${key}`, { width: SYMBOL_BOX, height: SYMBOL_BOX, zoom: 1.4 }, (g) =>
    drawSymbol(g, key, 0, 0, SYMBOL_BOX * 0.36),
  );
}

/** 확률 줄에 놓는 작은 그림 */
export function miniSymbolTexture(scene: Phaser.Scene, symbol: number): string {
  const key = SYMBOLS[symbol].key;
  return bakeShape(scene, `candy-slot-mini-${key}`, { width: MINI_BOX, height: MINI_BOX }, (g) =>
    drawSymbol(g, key, 0, 0, MINI_BOX * 0.4),
  );
}

// ───────── 사탕 ─────────

/** 포장한 사탕 하나를 (x, y)를 한가운데로 그린다. r은 알맹이의 반지름이다. */
function drawCandy(g: Graphics, x: number, y: number, r: number): void {
  const look = LOOK.candy;
  // 양쪽으로 묶인 포장 끝
  for (const side of [-1, 1]) {
    g.fillStyle(look.lip, 1);
    g.fillTriangle(x + side * r * 0.7, y, x + side * r * 1.9, y - r * 0.8, x + side * r * 1.9, y + r * 0.8);
    g.fillStyle(look.wrap, 1);
    g.fillTriangle(x + side * r * 0.8, y, x + side * r * 1.75, y - r * 0.5, x + side * r * 1.75, y + r * 0.5);
  }
  g.fillStyle(look.lip, 1);
  g.fillCircle(x, y + r * 0.14, r);
  g.fillStyle(look.face, 1);
  g.fillCircle(x, y - r * 0.06, r * 0.94);
  g.fillStyle(look.swirl, 0.85);
  g.fillEllipse(x - r * 0.3, y - r * 0.38, r * 0.7, r * 0.4);
}

/** 사탕 아이콘의 크기 */
export const CANDY_ICON = { width: 16, height: 12 } as const;

/** 사탕의 수 옆에 놓는 작은 사탕 */
export function candyTexture(scene: Phaser.Scene): string {
  return bakeShape(scene, 'candy-slot-candy', CANDY_ICON, (g) => drawCandy(g, 0, 0, 4.2));
}

// ───────── 부적 ─────────

/** 부적 그림의 크기 */
export const CHARM_BOX = 30;

/** 작은 동그란 표시: 더하기나 빼기 */
function drawBadge(g: Graphics, x: number, y: number, sign: 'plus' | 'minus'): void {
  g.fillStyle(LOOK.mark, 1);
  g.fillCircle(x, y, 5.6);
  g.fillStyle(sign === 'plus' ? LOOK.plus : LOOK.minus, 1);
  g.fillCircle(x, y, 4.6);
  g.fillStyle(LOOK.mark, 1);
  g.fillRoundedRect(x - 2.8, y - 0.9, 5.6, 1.8, 0.9);
  if (sign === 'plus') g.fillRoundedRect(x - 0.9, y - 2.8, 1.8, 5.6, 0.9);
}

/** 작은 3×3 판. on에 든 칸은 짙게 칠한다. */
function drawMiniGrid(g: Graphics, on: readonly number[]): void {
  const dot = 5.4;
  const gap = 1.6;
  const start = -(dot * SIZE + gap * (SIZE - 1)) / 2;
  for (let cell = 0; cell < SIZE * SIZE; cell += 1) {
    const x = start + (cell % SIZE) * (dot + gap);
    const y = start + Math.floor(cell / SIZE) * (dot + gap);
    const lit = on.includes(cell);
    g.fillStyle(lit ? LOOK.dotOn : LOOK.dot, 1);
    g.fillRoundedRect(x, y, dot, dot, 1.6);
  }
}

/** 재주 부적의 그림. id마다 따로 그린다. 원점이 한가운데다. */
const TRICKS: Readonly<Record<string, (g: Graphics) => void>> = {
  /** 덤 스핀: 한 바퀴 도는 화살표 */
  extra: (g) => {
    g.lineStyle(3, THEME.lilacDeep, 1);
    g.beginPath();
    g.arc(0, 0.5, 6.4, -Math.PI * 0.35, Math.PI * 1.25);
    g.strokePath();
    g.fillStyle(THEME.lilacDeep, 1);
    g.fillTriangle(1.2, -9.4, 1.2, -1.8, 7.4, -5.2);
    drawBadge(g, 8.4, 8.2, 'plus');
  },
  /** 저금통: 귀와 코가 있는 분홍 돼지 */
  piggy: (g) => {
    g.fillStyle(THEME.pinkDeep, 1);
    g.fillTriangle(-7.6, -4, -4.6, -9.6, -1.6, -5.4);
    g.fillTriangle(7.6, -4, 4.6, -9.6, 1.6, -5.4);
    g.fillEllipse(0, 1.9, 19, 15.4);
    g.fillStyle(THEME.pink, 1);
    g.fillEllipse(0, 0.9, 18.4, 14.6);
    g.fillStyle(THEME.pinkSoft, 1);
    g.fillEllipse(0, 2.6, 8.2, 5.6);
    g.fillStyle(THEME.pinkDeep, 1);
    g.fillCircle(-1.6, 2.6, 0.9);
    g.fillCircle(1.6, 2.6, 0.9);
    g.fillStyle(THEME.inkDeep, 1);
    g.fillCircle(-4.4, -1.6, 1);
    g.fillCircle(4.4, -1.6, 1);
    g.fillRoundedRect(-2.4, -5.9, 4.8, 1.3, 0.6);
  },
  /** 위로 사탕: 큼직한 사탕 */
  comfort: (g) => drawCandy(g, 0, 0, 5.6),
  /** 쌍둥이 줄: 나란한 두 줄 */
  twins: (g) => {
    for (const y of [-4.4, 4.4]) {
      g.fillStyle(THEME.accent, 1);
      g.fillRoundedRect(-9, y - 1.3, 18, 2.6, 1.3);
      g.fillStyle(THEME.gold, 1);
      for (const x of [-7.4, 0, 7.4]) g.fillCircle(x, y, 2.5);
    }
  },
  /** 왕관 */
  crown: (g) => {
    const points = rounded(
      [
        { x: -9, y: 6.4 },
        { x: -9.6, y: -4.8 },
        { x: -4.4, y: 0.4 },
        { x: 0, y: -7.4 },
        { x: 4.4, y: 0.4 },
        { x: 9.6, y: -4.8 },
        { x: 9, y: 6.4 },
      ],
      1.6,
      3,
    );
    fillShape(g, points, 0, 1.2, 0xe0ac3c);
    fillShape(g, points, 0, 0, THEME.gold);
    g.fillStyle(THEME.coral, 1);
    g.fillCircle(0, 3, 1.7);
    g.fillStyle(THEME.skyDeep, 1);
    g.fillCircle(-5.2, 3.4, 1.3);
    g.fillCircle(5.2, 3.4, 1.3);
  },
  /** 가운데 7: 작은 판의 가운데 칸에 뜬 7 */
  middle: (g) => {
    drawMiniGrid(g, []);
    g.fillStyle(LOOK.mark, 1);
    g.fillCircle(0, 0, 6.4);
    drawSymbol(g, 'seven', 0, 0, 4.6);
  },
  /** 막판 한 방: 결승점의 깃발 */
  finale: (g) => {
    g.fillStyle(THEME.inkDeep, 1);
    g.fillRoundedRect(-6.6, -9, 2, 18.4, 1);
    g.fillStyle(THEME.coralDeep, 1);
    g.fillTriangle(-4.6, -8.2, -4.6, 2.4, 8.4, -2.4);
    g.fillStyle(THEME.coral, 1);
    g.fillTriangle(-4.6, -8.6, -4.6, 1, 7.6, -3.4);
  },
  /** 오뚝이: 넘어져도 일어나는 둥근 인형 */
  rebound: (g) => {
    g.fillStyle(THEME.skyDeep, 1);
    g.fillCircle(0, 4.4, 7.2);
    g.fillStyle(THEME.sky, 1);
    g.fillCircle(0, 3.6, 7);
    g.fillStyle(THEME.shadow, 1);
    g.fillCircle(0, -4.6, 5.2);
    g.fillStyle(THEME.white, 1);
    g.fillCircle(0, -5.1, 5);
    g.fillStyle(THEME.inkDeep, 1);
    g.fillCircle(-1.8, -5.4, 0.8);
    g.fillCircle(1.8, -5.4, 0.8);
    g.fillStyle(THEME.coral, 1);
    g.fillRoundedRect(-4.6, 2.4, 9.2, 2, 1);
  },
};

/** 줄 부적의 작은 판에서 짙게 칠할 칸들. 가로와 세로는 가운데 줄 하나로 방향을 보여 주고, 대각선은 두 줄을 다 칠한다. */
function lineCells(kind: LineKind): number[] {
  const cells = new Set<number>();
  LINES.forEach((line) => {
    if (line.kind !== kind) return;
    if (kind !== 'diag' && !line.cells.includes(CENTER)) return;
    for (const cell of line.cells) cells.add(cell);
  });
  return [...cells];
}

/** 부적 하나를 한가운데가 (0, 0)에 오도록 그린다. */
function drawCharm(g: Graphics, charm: CharmInfo): void {
  const tone = LOOK.charm[charm.kind];
  const half = CHARM_BOX / 2;
  g.fillStyle(tone.edge, 1);
  g.fillRoundedRect(-half, -half, CHARM_BOX, CHARM_BOX, 8);
  g.fillStyle(tone.face, 1);
  g.fillRoundedRect(-half + 2, -half + 2, CHARM_BOX - 4, CHARM_BOX - 4, 6);

  const { effect } = charm;
  if (effect.weight) {
    drawSymbol(g, SYMBOLS[effect.weight[0]].key, -1.5, 1, 7.6);
    drawBadge(g, 8.2, -8.2, effect.weight[1] > 0 ? 'plus' : 'minus');
  } else if (effect.value) {
    drawSymbol(g, SYMBOLS[effect.value[0]].key, -2, -1.5, 7.6);
    g.fillStyle(LOOK.mark, 1);
    g.fillEllipse(6.4, 8, 14.6, 9);
    drawCandy(g, 6.4, 8, 3);
  } else if (effect.lineTimes) {
    drawMiniGrid(g, lineCells(effect.lineTimes[0]));
  } else {
    TRICKS[charm.id]?.(g);
  }
}

/** 부적의 그림. 없는 id면 빈자리의 그림을 돌려준다. */
export function charmTexture(scene: Phaser.Scene, id: string): string {
  const charm = charmOf(id);
  if (!charm) return emptySlotTexture(scene);
  const box = { width: CHARM_BOX, height: CHARM_BOX };
  return bakeShape(scene, `candy-slot-charm-${id}`, box, (g) => drawCharm(g, charm));
}

/** 결과 화면의 아이콘 줄에 놓는 작은 부적 그림의 크기 */
export const CHIP_BOX = 18;

/** 결과 화면의 아이콘 줄에 놓는 작은 부적 그림 */
export function charmChipTexture(scene: Phaser.Scene, id: string): string | null {
  const charm = charmOf(id);
  if (!charm) return null;
  const box = { width: CHIP_BOX, height: CHIP_BOX };
  return bakeShape(scene, `candy-slot-chip-${id}`, box, (g) => {
    g.scaleCanvas(CHIP_BOX / CHARM_BOX, CHIP_BOX / CHARM_BOX);
    drawCharm(g, charm);
  });
}

/** 부적이 붙지 않은 빈자리 */
export function emptySlotTexture(scene: Phaser.Scene): string {
  const box = { width: CHARM_BOX, height: CHARM_BOX };
  return bakeShape(scene, 'candy-slot-charm-empty', box, (g) => {
    const half = CHARM_BOX / 2;
    g.fillStyle(LOOK.emptySlot.edge, 1);
    g.fillRoundedRect(-half, -half, CHARM_BOX, CHARM_BOX, 8);
    g.fillStyle(LOOK.emptySlot.face, 1);
    g.fillRoundedRect(-half + 2, -half + 2, CHARM_BOX - 4, CHARM_BOX - 4, 6);
  });
}

// ───────── 기계 ─────────

/**
 * 기계의 몸통과 아홉 칸의 바닥을 그린다. (x, y)는 몸통의 왼쪽 위, frame은 몸통이 칸들을 두르는 두께다.
 * 칸의 바닥은 바둑판처럼 두 색을 번갈아 깔아서 칸이 눈에 들어오게 한다.
 */
export function drawMachine(g: Graphics, x: number, y: number, cell: number, frame: number): void {
  const size = cell * SIZE + frame * 2;
  const look = LOOK.machine;
  g.fillStyle(look.lip, 1);
  g.fillRoundedRect(x, y + 4, size, size, 14);
  g.fillStyle(look.body, 1);
  g.fillRoundedRect(x, y, size, size, 14);
  // 칸들을 두르는 금테
  const trim = 2;
  g.fillStyle(look.trimLip, 1);
  g.fillRoundedRect(x + frame - trim, y + frame - trim + 1, size - (frame - trim) * 2, size - (frame - trim) * 2, 11);
  g.fillStyle(look.trim, 1);
  g.fillRoundedRect(x + frame - trim, y + frame - trim, size - (frame - trim) * 2, size - (frame - trim) * 2 - 1, 11);
  for (let index = 0; index < SIZE * SIZE; index += 1) {
    const col = index % SIZE;
    const row = Math.floor(index / SIZE);
    g.fillStyle(index % 2 === 0 ? look.slot : look.slotAlt, 1);
    g.fillRoundedRect(x + frame + col * cell + 1, y + frame + row * cell + 1, cell - 2, cell - 2, 9);
  }
  // 가운데 칸은 네 줄이 지나는 자리라서 작은 점으로 표시해 둔다.
  const center = { col: CENTER % SIZE, row: Math.floor(CENTER / SIZE) };
  g.fillStyle(look.trimLip, 0.5);
  g.fillCircle(x + frame + (center.col + 0.5) * cell, y + frame + (center.row + 1) * cell - 5, 1.6);
}

/** 몸통의 한 변에 박는 전구의 수 */
const BULBS_PER_SIDE = 9;

/**
 * 몸통의 테두리를 따라 박힌 전구를 그린다. 하나 걸러 하나씩 켜지고, phase가 바뀌면 켜진 것과 꺼진 것이 바뀐다.
 * 자리는 drawMachine과 같이 준다.
 */
export function drawBulbs(g: Graphics, x: number, y: number, cell: number, frame: number, phase: number): void {
  const size = cell * SIZE + frame * 2;
  const look = LOOK.machine;
  const inset = (frame - 2) / 2;
  const radius = Math.min(1.7, inset - 0.6);
  // 둥근 모서리를 비켜서 네 변에 고르게 놓는다.
  const from = 15;
  const step = (size - from * 2) / (BULBS_PER_SIDE - 1);
  let count = 0;
  const bulb = (bx: number, by: number): void => {
    const lit = (count + phase) % 2 === 0;
    count += 1;
    g.fillStyle(lit ? look.bulbOn : look.bulbOff, 1);
    g.fillCircle(bx, by, lit ? radius : radius - 0.3);
  };
  for (let index = 0; index < BULBS_PER_SIDE; index += 1) bulb(x + from + step * index, y + inset);
  for (let index = 0; index < BULBS_PER_SIDE; index += 1) bulb(x + size - inset, y + from + step * index);
  for (let index = BULBS_PER_SIDE - 1; index >= 0; index -= 1) bulb(x + from + step * index, y + size - inset);
  for (let index = BULBS_PER_SIDE - 1; index >= 0; index -= 1) bulb(x + inset, y + from + step * index);
}

// ───────── 테이블 ─────────

/** 천의 무늬가 놓이는 간격 */
const FELT_STEP = 20;

/**
 * 화면을 덮는 카지노 테이블의 초록 천을 그린다. 기계가 놓인 자리(focus)는 조명을 받은 듯 조금 밝고,
 * 천에는 작은 마름모 무늬가 엇갈려 깔린다.
 */
export function drawFelt(g: Graphics, width: number, height: number, focus: Point, reach: number): void {
  const look = LOOK.felt;
  g.fillStyle(look.base, 1);
  g.fillRect(0, 0, width, height);
  for (const scale of [1, 0.8, 0.6]) {
    g.fillStyle(look.glow, 0.3);
    g.fillEllipse(focus.x, focus.y, reach * 2 * scale, reach * 2.2 * scale);
  }
  const half = 2.2;
  g.fillStyle(look.mark, 0.8);
  for (let row = 0; row * FELT_STEP < height + FELT_STEP; row += 1) {
    const shift = row % 2 === 0 ? 0 : FELT_STEP / 2;
    for (let col = 0; col * FELT_STEP < width + FELT_STEP; col += 1) {
      const cx = col * FELT_STEP + shift;
      const cy = row * FELT_STEP + 4;
      g.fillTriangle(cx - half, cy, cx, cy - half * 1.4, cx + half, cy);
      g.fillTriangle(cx - half, cy, cx, cy + half * 1.4, cx + half, cy);
    }
  }
}

/** 그림의 색. 맞은 줄에서 튀는 알갱이에 쓴다. 7은 테두리의 금빛으로 튄다. */
export function symbolColor(symbol: number): number {
  if (symbol === WILD) return LOOK.sevenTrim.face;
  return LOOK.symbols[SYMBOLS[symbol].key].face;
}
