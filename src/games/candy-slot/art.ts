/**
 * 사탕 슬롯의 그림. 색은 LOOK 한곳에 모아 두고, 모든 것을 둥근 도형으로 그린다.
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
  /** 기계: 몸통과 그 아래 두께, 그림이 놓이는 칸의 바닥 */
  machine: { body: THEME.lilac, lip: THEME.lilacDeep, shine: THEME.lilacSoft, slot: THEME.white, slotAlt: THEME.bg },
  symbols: {
    sprout: { face: THEME.mintDeep, lip: 0x5fb892 },
    drop: { face: THEME.skyDeep, lip: 0x5c9fd6 },
    heart: { face: THEME.coral, lip: THEME.coralDeep },
    star: { face: THEME.gold, lip: 0xe0ac3c },
    moon: { face: THEME.lilacDeep, lip: 0x7765c4 },
  } satisfies Record<Exclude<SymbolKey, 'rainbow'>, Tone>,
  /** 무지개의 띠: 바깥부터 */
  rainbow: [THEME.coral, THEME.gold, THEME.mintDeep, THEME.skyDeep],
  cloud: THEME.white,
  cloudLip: THEME.shadow,
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
  emptySlot: { edge: THEME.shadow, face: THEME.dim },
  /** 부적 그림 위의 표시: 더하기, 빼기 */
  plus: THEME.good,
  minus: THEME.bad,
  mark: THEME.white,
  /** 줄 부적의 작은 판: 여느 칸과 곱해지는 칸 */
  dot: THEME.white,
  dotOn: THEME.accent,
  candy: { face: THEME.pink, lip: THEME.pinkDeep, wrap: THEME.pinkSoft, swirl: THEME.white },
  goalBar: { back: THEME.dim, fill: THEME.pink, full: THEME.mintDeep },
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

/** 모양의 둘레. 원점이 모양의 한가운데이고 s가 반쯤 되는 크기다. */
function outline(shape: 'drop' | 'heart' | 'star', s: number): Point[] {
  switch (shape) {
    case 'heart':
      return Array.from({ length: 36 }, (_, index) => {
        const t = (index / 36) * Math.PI * 2;
        const x = 16 * Math.sin(t) ** 3;
        const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
        return { x: (x / 16) * s, y: (y / 16) * s - s * 0.1 };
      });
    case 'drop': {
      const radius = s * 0.72;
      const centerY = s * 0.26;
      const arc = Array.from({ length: 21 }, (_, index) => {
        const angle = -Math.PI * 0.2 + (index / 20) * Math.PI * 1.4;
        return { x: radius * Math.cos(angle), y: centerY + radius * Math.sin(angle) };
      });
      return [...arc, ...rounded([arc[20], { x: 0, y: -s * 1.05 }, arc[0]], s * 0.2).slice(1, -1)];
    }
    case 'star':
      return rounded(
        Array.from({ length: 10 }, (_, index) => {
          const radius = index % 2 === 0 ? s * 1.1 : s * 0.56;
          const angle = -Math.PI / 2 + (index * Math.PI) / 5;
          return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) + s * 0.05 };
        }),
        s * 0.16,
        3,
      );
  }
}

/** 초승달의 둘레: 큰 원에서 오른쪽 위로 비켜 놓은 원을 파낸 모양 */
function crescent(s: number): Point[] {
  const outer = s * 0.98;
  const inner = s * 0.8;
  const shift = { x: s * 0.46, y: -s * 0.3 };
  const distance = Math.hypot(shift.x, shift.y);
  const toward = Math.atan2(shift.y, shift.x);
  // 두 원이 만나는 각도
  const outerHalf = Math.acos((distance * distance + outer * outer - inner * inner) / (2 * distance * outer));
  const innerHalf = Math.acos((distance * distance + inner * inner - outer * outer) / (2 * distance * inner));
  const points: Point[] = [];
  const steps = 26;
  for (let step = 0; step <= steps; step += 1) {
    const angle = toward + outerHalf + ((Math.PI * 2 - outerHalf * 2) * step) / steps;
    points.push({ x: outer * Math.cos(angle), y: outer * Math.sin(angle) });
  }
  for (let step = 0; step <= steps; step += 1) {
    const angle = toward - innerHalf - ((Math.PI * 2 - innerHalf * 2) * step) / steps;
    points.push({ x: shift.x + inner * Math.cos(angle), y: shift.y + inner * Math.sin(angle) });
  }
  return points;
}

/** 그림 하나를 (x, y)를 한가운데로, s를 반쯤 되는 크기로 그린다. */
export function drawSymbol(g: Graphics, key: SymbolKey, x: number, y: number, s: number): void {
  const lip = Math.max(1, s * 0.14);
  switch (key) {
    case 'sprout': {
      const tone = LOOK.symbols.sprout;
      // 줄기와 양쪽으로 벌어진 두 잎
      const stem = rounded(
        [
          { x: -s * 0.13, y: s * 0.02 },
          { x: s * 0.13, y: s * 0.02 },
          { x: s * 0.13, y: s * 0.98 },
          { x: -s * 0.13, y: s * 0.98 },
        ],
        s * 0.12,
      );
      const left = tilted(-s * 0.5, -s * 0.28, s * 0.58, s * 0.36, 0.5);
      const right = tilted(s * 0.5, -s * 0.36, s * 0.58, s * 0.36, -0.6);
      for (const part of [stem, left, right]) fillShape(g, part, x, y + lip, tone.lip);
      for (const part of [stem, left, right]) fillShape(g, part, x, y, tone.face);
      fillShape(g, tilted(-s * 0.56, -s * 0.36, s * 0.22, s * 0.09, 0.5), x, y, LOOK.shine, 0.7);
      return;
    }
    case 'drop':
      chunky(g, outline('drop', s), x, y - lip / 2, LOOK.symbols.drop, lip);
      fillShape(g, tilted(-s * 0.3, s * 0.12, s * 0.14, s * 0.26, 0.3), x, y - lip / 2, LOOK.shine, 0.75);
      return;
    case 'heart':
      chunky(g, outline('heart', s), x, y - lip / 2, LOOK.symbols.heart, lip);
      fillShape(g, tilted(-s * 0.46, -s * 0.42, s * 0.2, s * 0.12, -0.6), x, y - lip / 2, LOOK.shine, 0.75);
      return;
    case 'star':
      chunky(g, outline('star', s), x, y - lip / 2, LOOK.symbols.star, lip);
      fillShape(g, tilted(-s * 0.2, -s * 0.3, s * 0.18, s * 0.1, -0.5), x, y - lip / 2, LOOK.shine, 0.8);
      return;
    case 'moon':
      chunky(g, crescent(s), x - s * 0.1, y - lip / 2, LOOK.symbols.moon, lip);
      fillShape(g, tilted(-s * 0.62, -s * 0.2, s * 0.1, s * 0.26, 0.25), x - s * 0.1, y - lip / 2, LOOK.shine, 0.6);
      return;
    case 'rainbow': {
      // 네 띠의 반원과, 양 끝을 받치는 구름
      const baseY = y + s * 0.46;
      const band = s * 0.2;
      LOOK.rainbow.forEach((color, index) => {
        const radius = s * 0.94 - band * index - band / 2;
        g.lineStyle(band + 0.4, color, 1);
        g.beginPath();
        g.arc(x, baseY, radius, Math.PI, Math.PI * 2);
        g.strokePath();
      });
      for (const side of [-1, 1]) {
        const cx = x + side * s * 0.62;
        g.fillStyle(LOOK.cloudLip, 1);
        g.fillEllipse(cx, baseY + s * 0.2 + lip * 0.6, s * 0.86, s * 0.42);
        g.fillStyle(LOOK.cloud, 1);
        g.fillEllipse(cx, baseY + s * 0.2, s * 0.86, s * 0.42);
        g.fillCircle(cx - side * s * 0.08, baseY + s * 0.02, s * 0.22);
        g.fillCircle(cx + side * s * 0.18, baseY + s * 0.1, s * 0.17);
      }
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
  /** 가운데 무지개: 작은 판의 가운데 칸에 뜬 무지개 */
  middle: (g) => {
    drawMiniGrid(g, []);
    g.fillStyle(LOOK.mark, 1);
    g.fillCircle(0, 0, 5.6);
    LOOK.rainbow.slice(0, 3).forEach((color, index) => {
      g.lineStyle(1.7, color, 1);
      g.beginPath();
      g.arc(0, 2.6, 5 - index * 1.6, Math.PI, Math.PI * 2);
      g.strokePath();
    });
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
  g.fillStyle(LOOK.machine.lip, 1);
  g.fillRoundedRect(x, y + 4, size, size, 14);
  g.fillStyle(LOOK.machine.body, 1);
  g.fillRoundedRect(x, y, size, size, 14);
  g.fillStyle(LOOK.machine.shine, 1);
  g.fillRoundedRect(x + 12, y + 2, size * 0.3, 2.4, 1.2);
  for (let index = 0; index < SIZE * SIZE; index += 1) {
    const col = index % SIZE;
    const row = Math.floor(index / SIZE);
    g.fillStyle(index % 2 === 0 ? LOOK.machine.slot : LOOK.machine.slotAlt, 1);
    g.fillRoundedRect(x + frame + col * cell + 1, y + frame + row * cell + 1, cell - 2, cell - 2, 9);
  }
  // 가운데 칸은 네 줄이 지나는 자리라서 작은 점으로 표시해 둔다.
  const center = { col: CENTER % SIZE, row: Math.floor(CENTER / SIZE) };
  g.fillStyle(LOOK.machine.body, 0.5);
  g.fillCircle(x + frame + (center.col + 0.5) * cell, y + frame + (center.row + 1) * cell - 5, 1.6);
}

/** 무지개가 아닌 그림의 색. 맞은 줄에서 튀는 알갱이에 쓴다. */
export function symbolColor(symbol: number): number {
  if (symbol === WILD) return THEME.gold;
  const key = SYMBOLS[symbol].key as Exclude<SymbolKey, 'rainbow'>;
  return LOOK.symbols[key].face;
}
