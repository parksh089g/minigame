/**
 * 훌라 전용 픽셀 그림: 카드 앞면 52장과 뒷면, 작은 아이콘. 공용 art/ 폴더를 건드리지 않도록 이 게임 안에서 만든다.
 * 등불지기·구름 탑 모험과 같은 팔레트(config.ts의 PALETTE)로 칠하고, 한 칸을 정수 개의 실제 픽셀로 칠해서 확대해도 번지지 않는다.
 */
import Phaser from 'phaser';
import { COLOR, PALETTE } from '../../config';
import { addHiResCanvas, renderScale } from '../../core/hidpi';
import { DECK_SIZE, isRed, rankOf, suitOf } from './cards';

/** 도형에 쓰는 색 */
export const PX = {
  ink: COLOR.ink,
  charcoal: COLOR.charcoal,
  slate: COLOR.slate,
  silver: COLOR.silver,
  white: COLOR.white,
  navy: COLOR.navy,
  blue: COLOR.blue,
  sky: COLOR.sky,
  teal: COLOR.teal,
  green: COLOR.green,
  lime: COLOR.lime,
  yellow: COLOR.yellow,
  orange: COLOR.orange,
  red: COLOR.red,
  plum: COLOR.plum,
} as const;

/** 글자에 쓰는 색 */
export const PX_CSS = {
  text: PALETTE[12],
  sub: PALETTE[13],
  faint: '#7d93ab',
  accent: PALETTE[4],
  good: PALETTE[5],
  bad: PALETTE[3],
  dark: PALETTE[0],
} as const;

/** 카드 한 장의 칸 수. 손패는 한 칸을 2 논리 픽셀로, 탁자의 카드는 1 논리 픽셀로 그린다. */
export const CARD_CELLS = { w: 14, h: 21 } as const;
export const CARD = { w: CARD_CELLS.w * 2, h: CARD_CELLS.h * 2 } as const;
export const MINI = { w: CARD_CELLS.w, h: CARD_CELLS.h } as const;

export const cardTexture = (card: number): string => `hula-card-${card}`;
export const TEX = { back: 'hula-back', pause: 'hula-pause', back_arrow: 'hula-arrow' } as const;

type Rows = readonly string[];

// 숫자: 3칸 × 5줄(10만 5칸)
const RANK_ROWS: Readonly<Record<number, Rows>> = {
  1: ['.#.', '#.#', '###', '#.#', '#.#'],
  2: ['##.', '..#', '.#.', '#..', '###'],
  3: ['##.', '..#', '.#.', '..#', '##.'],
  4: ['#.#', '#.#', '###', '..#', '..#'],
  5: ['###', '#..', '##.', '..#', '##.'],
  6: ['.##', '#..', '###', '#.#', '###'],
  7: ['###', '..#', '.#.', '.#.', '.#.'],
  8: ['###', '#.#', '###', '#.#', '###'],
  9: ['###', '#.#', '###', '..#', '##.'],
  10: ['#.###', '#.#.#', '#.#.#', '#.#.#', '#.###'],
  11: ['..#', '..#', '..#', '#.#', '.#.'],
  12: ['.#.', '#.#', '#.#', '##.', '.##'],
  13: ['#.#', '#.#', '##.', '#.#', '#.#'],
};

// 무늬: 작은 것 5칸, 큰 것 7칸. 0 스페이드, 1 하트, 2 다이아, 3 클로버
const SUIT_SMALL: readonly Rows[] = [
  ['..#..', '.###.', '#####', '#####', '..#..'],
  ['.#.#.', '#####', '#####', '.###.', '..#..'],
  ['..#..', '.###.', '#####', '.###.', '..#..'],
  ['.###.', '.###.', '#####', '#####', '..#..'],
];
const SUIT_BIG: readonly Rows[] = [
  ['...#...', '..###..', '.#####.', '#######', '#######', '...#...', '..###..'],
  ['.##.##.', '#######', '#######', '#######', '.#####.', '..###..', '...#...'],
  ['...#...', '..###..', '.#####.', '#######', '.#####.', '..###..', '...#...'],
  ['..###..', '..###..', '##.#.##', '#######', '##.#.##', '...#...', '..###..'],
];

/** 칸 그림 한 장: 팔레트 번호(0~15)나 비움(-1)의 2차원 배열 */
type Grid = number[][];

const grid = (w: number, h: number): Grid => Array.from({ length: h }, () => Array<number>(w).fill(-1));

function stamp(target: Grid, rows: Rows, x: number, y: number, color: number): void {
  rows.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx += 1) if (row[dx] === '#') target[y + dy][x + dx] = color;
  });
}

/** 테두리와 모서리를 깎은 카드 바탕 */
function cardBase(face: number, shade: number): Grid {
  const { w, h } = CARD_CELLS;
  const g = grid(w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      const corner = (x === 0 || x === w - 1) && (y === 0 || y === h - 1);
      if (corner) continue;
      g[y][x] = edge ? 0 : face;
    }
  }
  // 아래쪽과 오른쪽 안쪽에 그늘 한 줄
  for (let x = 1; x < w - 1; x += 1) g[h - 2][x] = shade;
  for (let y = 1; y < h - 1; y += 1) g[y][w - 2] = shade;
  return g;
}

export function cardGrid(card: number): Grid {
  const g = cardBase(12, 13);
  const color = isRed(card) ? 2 : 0;
  stamp(g, RANK_ROWS[rankOf(card)], 2, 2, color);
  stamp(g, SUIT_SMALL[suitOf(card)], 2, 8, color);
  stamp(g, SUIT_BIG[suitOf(card)], 5, 12, color);
  return g;
}

function backGrid(): Grid {
  const g = cardBase(8, 15);
  const { w, h } = CARD_CELLS;
  // 안쪽 테두리와 마름모 무늬
  for (let y = 2; y < h - 3; y += 1) {
    for (let x = 2; x < w - 3; x += 1) {
      const frame = x === 2 || y === 2 || x === w - 4 || y === h - 4;
      if (frame) g[y][x] = 9;
      else if ((x + y) % 4 === 0 || (x - y + 40) % 4 === 0) g[y][x] = 9;
    }
  }
  stamp(g, ['..#..', '.###.', '##.##', '.###.', '..#..'], 4, 8, 4);
  return g;
}

const PAUSE: Rows = ['##.##', '##.##', '##.##', '##.##', '##.##', '##.##'];
const ARROW: Rows = ['...#..', '..##..', '.#####', '######', '.#####', '..##..', '...#..'];

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

function iconGrid(rows: Rows, color: number): Grid {
  const g = grid(rows[0].length, rows.length);
  stamp(g, rows, 0, 0, color);
  return g;
}

export function registerHulaTextures(scene: Phaser.Scene): void {
  for (let card = 0; card < DECK_SIZE; card += 1) addGrid(scene, cardTexture(card), cardGrid(card), CARD.w, CARD.h);
  addGrid(scene, TEX.back, backGrid(), CARD.w, CARD.h);
  addGrid(scene, TEX.pause, iconGrid(PAUSE, 12), 10, 12);
  addGrid(scene, TEX.back_arrow, iconGrid(ARROW, 12), 12, 14);
}
