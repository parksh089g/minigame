/**
 * 피라미드 전용 그림. 공용 art/ 폴더를 건드리지 않도록 이 게임 안에서 만든다.
 * 등불지기, 구름 탑 모험처럼 픽셀 그림을 어두운 바탕에 놓는다. 색은 모두 같은 팔레트(config.ts의 PALETTE)에서 고른다.
 * 카드는 한 칸이 논리 2픽셀인 15 × 20칸 그림이다. 기기의 화면 밀도에 맞춰 한 칸을 정수 개의 실제 픽셀로 칠해서
 * 확대해도 칸이 번지지 않는다.
 */
import Phaser from 'phaser';
import { COLOR, PALETTE } from '../../config';
import { addHiResCanvas, renderScale } from '../../core/hidpi';
import { isRed, rankLabel, SUITS, type Card, type Suit } from './rules';

/** 도형에 쓰는 색 */
export const PX = {
  ink: COLOR.ink,
  night: COLOR.charcoal,
  panel: COLOR.charcoal,
  edge: COLOR.slate,
  navy: COLOR.navy,
  plum: COLOR.plum,
  red: COLOR.red,
  yellow: COLOR.yellow,
  lime: COLOR.lime,
  green: COLOR.green,
  teal: COLOR.teal,
  blue: COLOR.blue,
  sky: COLOR.sky,
  cyan: COLOR.cyan,
  white: COLOR.white,
  silver: COLOR.silver,
} as const;

/** 글자에 쓰는 색 */
export const PX_CSS = {
  text: PALETTE[12],
  sub: PALETTE[13],
  faint: '#7d93ab',
  accent: PALETTE[4],
  good: PALETTE[5],
  bad: PALETTE[3],
  sky: PALETTE[11],
  dark: PALETTE[0],
} as const;

/** 카드의 칸 수와 한 칸의 논리 크기 */
const CELLS_X = 15;
const CELLS_Y = 20;
const CELL = 2;
export const CARD_W = CELLS_X * CELL;
export const CARD_H = CELLS_Y * CELL;

export const cardTexture = (card: Card): string => `pyr-${card.suit}-${card.rank}`;
export const TEX = {
  back: 'pyr-back',
  slot: 'pyr-slot',
  /** 허브의 아이콘과 같은 모양의 작은 피라미드(준비 화면에 놓는다) */
  emblem: 'pyr-emblem',
} as const;

type Rows = readonly string[];

/** 3 × 5칸 숫자 글꼴. '#'이 칠하는 칸이다. 10은 '1'을 한 칸 폭으로 줄여 붙인다. */
const GLYPHS: Readonly<Record<string, Rows>> = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  '2': ['##.', '..#', '.#.', '#..', '###'],
  '3': ['##.', '..#', '.#.', '..#', '##.'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '##.', '..#', '##.'],
  '6': ['.##', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '##.'],
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['#', '#', '#', '#', '#'],
  J: ['..#', '..#', '..#', '#.#', '.#.'],
  Q: ['.#.', '#.#', '#.#', '##.', '.##'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
};

/** 작은 무늬(5 × 5칸). 숫자 옆에 놓여서 카드가 아래 줄에 덮여도 보인다. */
const SMALL: Readonly<Record<Suit, Rows>> = {
  spade: ['..#..', '.###.', '#####', '..#..', '.###.'],
  heart: ['.#.#.', '#####', '#####', '.###.', '..#..'],
  diamond: ['..#..', '.###.', '#####', '.###.', '..#..'],
  club: ['.###.', '.###.', '#####', '..#..', '.###.'],
};

/** 큰 무늬(7 × 7칸). 카드의 아래쪽 가운데에 놓는다. */
const LARGE: Readonly<Record<Suit, Rows>> = {
  spade: ['...#...', '..###..', '.#####.', '#######', '#######', '...#...', '..###..'],
  heart: ['.##.##.', '#######', '#######', '#######', '.#####.', '..###..', '...#...'],
  diamond: ['...#...', '..###..', '.#####.', '#######', '.#####.', '..###..', '...#...'],
  club: ['..###..', '..###..', '##.#.##', '#######', '##.#.##', '...#...', '..###..'],
};

/** 칸 그림판: 팔레트 번호(0~15)를 칸마다 적는다. -1은 투명 */
type Grid = number[][];

const grid = (width: number, height: number, fill = -1): Grid =>
  Array.from({ length: height }, () => Array.from({ length: width }, () => fill));

function stamp(target: Grid, rows: Rows, left: number, top: number, color: number): void {
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] === '#' && target[top + y]?.[left + x] !== undefined) target[top + y][left + x] = color;
    }
  });
}

/** 모서리를 한 칸 깎은 카드 모양: 바깥 한 칸은 테두리, 안은 fill */
function cardShape(fill: number, border: number): Grid {
  const g = grid(CELLS_X, CELLS_Y);
  for (let y = 0; y < CELLS_Y; y += 1) {
    for (let x = 0; x < CELLS_X; x += 1) {
      const edgeX = x === 0 || x === CELLS_X - 1;
      const edgeY = y === 0 || y === CELLS_Y - 1;
      if (edgeX && edgeY) continue;
      g[y][x] = edgeX || edgeY ? border : fill;
    }
  }
  return g;
}

/** 숫자 글자들을 한 칸씩 띄워 이어 붙인 그림 */
function rankRows(rank: number): Rows {
  const glyphs = [...rankLabel(rank)].map((char) => GLYPHS[char]);
  return Array.from({ length: 5 }, (_, y) => glyphs.map((glyph) => glyph[y]).join('.'));
}

function faceGrid(card: Card): Grid {
  const ink = isRed(card) ? 2 : 0;
  const g = cardShape(12, 0);
  // 아래쪽 한 줄은 그림자처럼 어둡게 칠해서 두께를 준다.
  for (let x = 1; x < CELLS_X - 1; x += 1) g[CELLS_Y - 2][x] = 13;
  stamp(g, rankRows(card.rank), 2, 2, ink);
  stamp(g, SMALL[card.suit], CELLS_X - 7, 2, ink);
  stamp(g, LARGE[card.suit], 4, 10, ink);
  return g;
}

function backGrid(): Grid {
  const g = cardShape(8, 0);
  // 안쪽 테두리와 마름모 무늬
  for (let y = 2; y < CELLS_Y - 2; y += 1) {
    for (let x = 2; x < CELLS_X - 2; x += 1) {
      const frame = x === 2 || x === CELLS_X - 3 || y === 2 || y === CELLS_Y - 3;
      if (frame) g[y][x] = 9;
      else if ((x + y) % 4 === 0 || (x - y + 40) % 4 === 0) g[y][x] = 1;
    }
  }
  for (let x = 1; x < CELLS_X - 1; x += 1) g[CELLS_Y - 2][x] = 15;
  return g;
}

/** 빈 자리: 점선 테두리만 */
function slotGrid(): Grid {
  const g = grid(CELLS_X, CELLS_Y);
  for (let y = 1; y < CELLS_Y - 1; y += 1) {
    for (let x = 1; x < CELLS_X - 1; x += 1) {
      const edge = x === 1 || x === CELLS_X - 2 || y === 1 || y === CELLS_Y - 2;
      if (edge && (x + y) % 2 === 0) g[y][x] = 14;
    }
  }
  return g;
}

/** 작은 피라미드(11 × 9칸): 카드 여섯 장이 세 줄로 쌓인 모양 */
const EMBLEM: Rows = [
  '....222....',
  '....2c2....',
  '..000.222..',
  '..0c0.2c2..',
  '222.000.000',
  '2c2.0c0.0c0',
  '222.000.000',
  '...........',
  '44444444444',
];

function emblemGrid(): Grid {
  const g = grid(EMBLEM[0].length, EMBLEM.length);
  EMBLEM.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      const index = Number.parseInt(row[x], 16);
      if (!Number.isNaN(index)) g[y][x] = index === 0 ? 13 : index;
    }
  });
  return g;
}

function addGrid(scene: Phaser.Scene, key: string, g: Grid, width: number, height: number): void {
  if (scene.textures.exists(key)) return;
  const cellsX = g[0].length;
  const cellsY = g.length;
  const cell = Math.max(1, Math.ceil(Math.max(width / cellsX, height / cellsY) * renderScale()));
  const canvas = document.createElement('canvas');
  canvas.width = cellsX * cell;
  canvas.height = cellsY * cell;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D 캔버스를 만들 수 없습니다.');
  g.forEach((row, y) =>
    row.forEach((index, x) => {
      if (index < 0) return;
      context.fillStyle = PALETTE[index];
      context.fillRect(x * cell, y * cell, cell, cell);
    }),
  );
  addHiResCanvas(scene.textures, key, canvas, width, height);
  scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
}

export function registerPyramidTextures(scene: Phaser.Scene): void {
  for (const suit of SUITS) {
    for (let rank = 1; rank <= 13; rank += 1) {
      const card = { rank, suit };
      addGrid(scene, cardTexture(card), faceGrid(card), CARD_W, CARD_H);
    }
  }
  addGrid(scene, TEX.back, backGrid(), CARD_W, CARD_H);
  addGrid(scene, TEX.slot, slotGrid(), CARD_W, CARD_H);
  addGrid(scene, TEX.emblem, emblemGrid(), 66, 54);
}
