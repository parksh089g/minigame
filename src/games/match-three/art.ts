/**
 * 세 개 맞추기의 그림. 색은 LOOK 한곳에 모아 두고, 모든 것을 둥근 도형으로 그린다.
 * 조각은 갈래마다 한 번 구워 텍스처로 두고, 씬은 그것을 놓고 움직이기만 한다.
 * 조각은 색과 함께 모양이 모두 달라서, 색을 가려 보기 어려워도 모양으로 짝을 찾을 수 있다.
 */
import type Phaser from 'phaser';
import { THEME, THEME_CSS } from '../../config';
import { bakeShape } from '../../core/bake';
import { COLS, MAX_KINDS, ROWS } from './rules';

type Graphics = Phaser.GameObjects.Graphics;

interface Point {
  x: number;
  y: number;
}

/** 윗면 색보다 어두운 옆면 색 */
function shade(color: number, amount = 0.8): number {
  const channel = (shift: number): number => Math.round(((color >> shift) & 0xff) * amount) << shift;
  return channel(16) | channel(8) | channel(0);
}

/** 조각의 모양 */
export type Shape = 'heart' | 'drop' | 'leaf' | 'star' | 'gem' | 'flower';

export interface PieceLook {
  shape: Shape;
  face: number;
  /** 아래로 도톰하게 내려오는 옆면 */
  lip: number;
  /** 모양 안에 덧그리는 것의 색: 꽃의 가운데, 보석의 밝은 면 */
  detail: number;
}

const piece = (shape: Shape, face: number, detail: number = THEME.white, lip = shade(face)): PieceLook => ({
  shape,
  face,
  lip,
  detail,
});

export const LOOK = {
  board: {
    /** 판을 두르는 테두리와 그 아래 두께 */
    rim: THEME.card,
    rimLip: THEME.shadow,
    /** 칸의 바닥. 바둑판처럼 두 색을 번갈아 깔아 칸이 눈에 들어오게 한다. */
    slot: THEME.dim,
    slotAlt: THEME.bg,
  },
  /** 조각의 갈래 순서대로: 빨간 하트, 파란 물방울, 초록 잎, 노란 별, 보라 보석, 분홍 꽃 */
  pieces: [
    piece('heart', THEME.coralDeep),
    piece('drop', THEME.skyDeep),
    piece('leaf', THEME.mintDeep),
    piece('star', THEME.gold, THEME.white, shade(THEME.gold, 0.84)),
    piece('gem', THEME.lilacDeep, THEME.lilac),
    piece('flower', THEME.pink, THEME.butter, THEME.pinkDeep),
  ] as readonly PieceLook[],
  shine: THEME.white,
  /** 폭죽 조각의 뒤에 깔리는 빛: 흰 동그라미에 금색 테, 네 쪽으로 뻗는 금색 살 */
  burst: { glow: THEME.white, ring: THEME.gold, ray: THEME.gold },
  /** 고른 조각에 두르는 테 */
  select: THEME.inkDeep,
  /** 폭죽이 쓸고 지나가는 줄 */
  beam: THEME.gold,
  sparks: [THEME.gold, THEME.pink, THEME.mintDeep, THEME.skyDeep, THEME.white],
  /** 목표를 다 모았다는 표시 */
  done: THEME.mintDeep,
  text: {
    hint: THEME_CSS.ink,
    hintSub: THEME_CSS.sub,
    note: THEME_CSS.sub,
    outline: THEME_CSS.white,
    points: THEME_CSS.accent,
    bonus: THEME_CSS.good,
    chain: THEME_CSS.accent,
    start: THEME_CSS.good,
    over: THEME_CSS.bad,
    good: THEME_CSS.good,
    goal: THEME_CSS.inkDeep,
    goalDone: THEME_CSS.good,
    moves: THEME_CSS.accent,
    movesLow: THEME_CSS.bad,
  },
} as const;

/** 한 칸의 크기 */
export const CELL = 32;
/** 판의 테두리 폭과 그 아래 두께 */
export const RIM = 4;
export const RIM_LIP = 4;
export const BOARD_WIDTH = COLS * CELL + RIM * 2;
export const BOARD_HEIGHT = ROWS * CELL + RIM * 2;

/** 조각 그림의 크기. 폭죽의 살이 칸 끝까지 뻗으므로 칸과 같은 크기로 굽는다. */
const PIECE_BOX = CELL + 2;
/** 조각의 반쯤 되는 크기 */
const HALF = 11;
/** 옆면이 아래로 내려오는 두께 */
const LIP = 2;

// ───────── 둥근 도형 ─────────

/** 꼭짓점을 둥글린 다각형의 둘레. round는 꼭짓점에서 깎아 내는 길이다. */
function rounded(vertices: readonly Point[], round: number, steps = 5): Point[] {
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

/** 모양의 둘레. 원점이 모양의 한가운데이고 s가 반쯤 되는 크기다. 꽃은 둘레 대신 꽃잎을 따로 그린다. */
function outline(shape: Exclude<Shape, 'flower'>, s: number): Point[] {
  switch (shape) {
    case 'heart':
      // 하트 곡선을 따라 점을 찍는다.
      return Array.from({ length: 40 }, (_, index) => {
        const t = (index / 40) * Math.PI * 2;
        const x = 16 * Math.sin(t) ** 3;
        const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
        return { x: (x / 16) * s * 1.02, y: (y / 16) * s * 1.02 - s * 0.08 };
      });
    case 'drop': {
      // 아래는 동그랗고 위는 뾰족하다.
      const radius = s * 0.74;
      const centerY = s * 0.26;
      const arc = Array.from({ length: 25 }, (_, index) => {
        const angle = -Math.PI * 0.22 + (index / 24) * Math.PI * 1.44;
        return { x: radius * Math.cos(angle), y: centerY + radius * Math.sin(angle) };
      });
      return [...arc, ...rounded([arc[24], { x: 0, y: -s * 1.08 }, arc[0]], s * 0.22).slice(1, -1)];
    }
    case 'leaf':
      return rounded(
        [
          { x: 0, y: -s * 0.98 },
          { x: s * 1.02, y: s * 0.82 },
          { x: -s * 1.02, y: s * 0.82 },
        ],
        s * 0.42,
      );
    case 'star':
      return rounded(
        Array.from({ length: 10 }, (_, index) => {
          const radius = index % 2 === 0 ? s * 1.16 : s * 0.6;
          const angle = -Math.PI / 2 + (index * Math.PI) / 5;
          return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) + s * 0.04 };
        }),
        s * 0.16,
        3,
      );
    case 'gem':
      return rounded(
        [
          { x: 0, y: -s * 1.08 },
          { x: s * 0.94, y: 0 },
          { x: 0, y: s * 1.08 },
          { x: -s * 0.94, y: 0 },
        ],
        s * 0.26,
      );
  }
}

function fillShape(g: Graphics, points: readonly Point[], dx: number, dy: number, scale = 1): void {
  g.beginPath();
  points.forEach((point, index) => {
    const x = point.x * scale + dx;
    const y = point.y * scale + dy;
    if (index === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  });
  g.closePath();
  g.fillPath();
}

/** 꽃: 동그란 꽃잎 여섯 장 */
function fillPetals(g: Graphics, s: number, dy: number): void {
  for (let index = 0; index < 6; index += 1) {
    const angle = -Math.PI / 2 + (index * Math.PI) / 3;
    g.fillCircle(s * 0.62 * Math.cos(angle), s * 0.62 * Math.sin(angle) + dy, s * 0.44);
  }
  g.fillCircle(0, dy, s * 0.6);
}

/** 조각 하나를 그린다. 원점이 조각의 한가운데다. */
function drawPiece(g: Graphics, look: PieceLook, s: number): void {
  if (look.shape === 'flower') {
    g.fillStyle(look.lip, 1);
    fillPetals(g, s, LIP);
    g.fillStyle(look.face, 1);
    fillPetals(g, s, 0);
    g.fillStyle(look.detail, 1);
    g.fillCircle(0, 0, s * 0.34);
    g.fillStyle(LOOK.shine, 0.6);
    g.fillEllipse(-s * 0.3, -s * 0.72, s * 0.34, s * 0.2);
    return;
  }

  const points = outline(look.shape, s);
  g.fillStyle(look.lip, 1);
  fillShape(g, points, 0, LIP);
  g.fillStyle(look.face, 1);
  fillShape(g, points, 0, 0);
  if (look.shape === 'gem') {
    // 보석의 위쪽 면을 밝게 해서 깎인 느낌을 낸다.
    g.fillStyle(look.detail, 0.75);
    g.fillTriangle(0, -s * 0.74, s * 0.56, -s * 0.04, -s * 0.56, -s * 0.04);
  }
  // 왼쪽 위의 반짝임. 모양마다 윗면이 다르게 생겨서 자리를 조금씩 옮긴다.
  const shine: Record<Exclude<Shape, 'flower'>, Point> = {
    heart: { x: -s * 0.5, y: -s * 0.52 },
    drop: { x: -s * 0.3, y: s * 0.02 },
    leaf: { x: -s * 0.2, y: -s * 0.2 },
    star: { x: -s * 0.2, y: -s * 0.3 },
    gem: { x: -s * 0.3, y: -s * 0.4 },
  };
  g.fillStyle(LOOK.shine, 0.6);
  g.fillEllipse(shine[look.shape].x, shine[look.shape].y, s * 0.36, s * 0.22);
}

/** 폭죽 조각의 뒤에 깔리는 빛. 가로줄과 세로줄을 터뜨린다는 뜻으로 네 쪽에 살을 뻗는다. */
function drawGlow(g: Graphics): void {
  const reach = CELL / 2;
  g.fillStyle(LOOK.burst.ray, 1);
  for (let index = 0; index < 4; index += 1) {
    const angle = (index * Math.PI) / 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // 바깥으로 뾰족한 세모: 밑변은 동그라미에 걸치고 꼭짓점은 칸의 끝에 닿는다.
    g.fillTriangle(
      cos * (reach + 1),
      sin * (reach + 1),
      cos * (reach - 7) - sin * 6,
      sin * (reach - 7) + cos * 6,
      cos * (reach - 7) + sin * 6,
      sin * (reach - 7) - cos * 6,
    );
  }
  g.fillCircle(0, 0, reach - 2.5);
  g.fillStyle(LOOK.burst.glow, 1);
  g.fillCircle(0, 0, reach - 5);
}

/** 그 갈래의 조각 텍스처. burst면 폭죽 조각이다. 처음 부를 때 굽는다. */
export function pieceTexture(scene: Phaser.Scene, kind: number, burst: boolean): string {
  const index = ((Math.floor(kind) % MAX_KINDS) + MAX_KINDS) % MAX_KINDS;
  const look = LOOK.pieces[index];
  return bakeShape(
    scene,
    `match-three:${burst ? 'burst' : 'piece'}:${index}`,
    { width: PIECE_BOX, height: PIECE_BOX, zoom: 1.4 },
    (g) => {
      if (burst) drawGlow(g);
      drawPiece(g, look, burst ? HALF * 0.78 : HALF);
    },
  );
}

/** 판: 테두리와 칸의 바닥. 그림의 왼쪽 위가 원점이고, 첫 칸은 (RIM, RIM)에서 시작한다. */
export function boardTexture(scene: Phaser.Scene): string {
  return bakeShape(
    scene,
    'match-three:board',
    { width: BOARD_WIDTH, height: BOARD_HEIGHT + RIM_LIP, originX: 0, originY: 0 },
    (g) => {
      g.fillStyle(LOOK.board.rimLip, 1);
      g.fillRoundedRect(0, RIM_LIP, BOARD_WIDTH, BOARD_HEIGHT, 12);
      g.fillStyle(LOOK.board.rim, 1);
      g.fillRoundedRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT, 12);
      for (let row = 0; row < ROWS; row += 1) {
        for (let col = 0; col < COLS; col += 1) {
          g.fillStyle((col + row) % 2 === 0 ? LOOK.board.slot : LOOK.board.slotAlt, 1);
          g.fillRoundedRect(RIM + col * CELL + 1, RIM + row * CELL + 1, CELL - 2, CELL - 2, 7);
        }
      }
    },
  );
}

/** 고른 조각에 두르는 테. 원점은 칸의 한가운데다. */
export function drawSelection(g: Graphics): void {
  g.clear();
  g.lineStyle(2, LOOK.select, 0.9);
  g.strokeRoundedRect(-CELL / 2 + 1.5, -CELL / 2 + 1.5, CELL - 3, CELL - 3, 8);
}

/** 목표를 다 모았다는 표시: 초록 동그라미 안의 흰 갈고리. 원점은 표시의 한가운데다. */
export function drawDone(g: Graphics): void {
  g.clear();
  g.fillStyle(LOOK.done, 1);
  g.fillCircle(0, 0, 7);
  g.lineStyle(2.2, THEME.white, 1);
  g.beginPath();
  g.moveTo(-3.4, 0.2);
  g.lineTo(-0.8, 2.8);
  g.lineTo(3.6, -2.4);
  g.strokePath();
}
