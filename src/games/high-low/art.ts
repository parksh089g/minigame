/**
 * 하이로우 전용 픽셀 그림. 공용 art/ 폴더를 건드리지 않도록 이 게임 안에서 만든다.
 * 등불지기와 구름 탑 모험처럼 픽셀 그림을 어두운 바탕에 놓는다. 한 글자가 한 칸이고,
 * 16진수 한 글자(0~f)는 config.ts의 PALETTE 색 번호, '.'은 투명이다.
 * 기기의 화면 밀도에 맞춰 한 칸을 정수 개의 실제 픽셀로 칠해서, 확대해도 칸이 번지지 않는다.
 */
import Phaser from 'phaser';
import { COLOR, PALETTE } from '../../config';
import { addHiResCanvas, renderScale } from '../../core/hidpi';
import { isRed, SUITS, type Suit } from './rules';

type Rows = readonly string[];

/** 도형에 쓰는 색. 모두 등불지기와 같은 팔레트에서 고른다. */
export const PX = {
  ink: COLOR.ink,
  panel: COLOR.charcoal,
  edge: COLOR.slate,
  navy: COLOR.navy,
  plum: COLOR.plum,
  red: COLOR.red,
  orange: COLOR.orange,
  yellow: COLOR.yellow,
  lime: COLOR.lime,
  green: COLOR.green,
  teal: COLOR.teal,
  blue: COLOR.blue,
  sky: COLOR.sky,
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

/** 카드의 논리 크기. 한 칸이 2px이다. */
export const CARD_W = 72;
export const CARD_H = 100;
export const MINI_W = 20;
export const MINI_H = 28;

export const TEX = {
  face: 'hl-face',
  back: 'hl-back',
  miniFace: 'hl-mini-face',
  heart: 'hl-heart',
  heartEmpty: 'hl-heart-empty',
  up: 'hl-up',
  down: 'hl-down',
  skip: 'hl-skip',
} as const;

export const rankTexture = (rank: number, red: boolean): string => `hl-rank-${rank}-${red ? 'r' : 'k'}`;
export const suitTexture = (suit: Suit, size: 'small' | 'big'): string => `hl-suit-${suit}-${size}`;

// ───────── 글자와 무늬 ─────────

/** 숫자와 글자. '#'이 칠하는 칸이다. 10은 두 글자를 붙인다. */
const GLYPHS: Readonly<Record<string, Rows>> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  '2': ['.###.', '#...#', '....#', '..##.', '.#...', '#....', '#####'],
  '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  '4': ['#..#.', '#..#.', '#..#.', '#####', '...#.', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
  '10': ['.#..##.', '##.#..#', '.#.#..#', '.#.#..#', '.#.#..#', '.#.#..#', '###.##.'],
  J: ['..###', '...#.', '...#.', '...#.', '#..#.', '#..#.', '.##..'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
};

const RANK_KEYS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;

/** 무늬. '#'이 무늬의 색, 'h'가 살짝 밝은 빛이다. */
const SUIT_ROWS: Readonly<Record<Suit, Rows>> = {
  heart: ['.##.##.', '#h#####', '#h#####', '#######', '.#####.', '..###..', '...#...'],
  diamond: ['...#...', '..#h#..', '.#h###.', '#######', '.#####.', '..###..', '...#...'],
  spade: ['...#...', '..###..', '.#h###.', '#h#####', '#######', '...#...', '..###..'],
  club: ['..###..', '..#h#..', '###.###', '#h#####', '###.###', '...#...', '..###..'],
};

/** '#'을 color 번호로, 'h'를 light 번호로 바꾼다. */
function paint(rows: Rows, color: string, light: string = color): Rows {
  return rows.map((row) => row.replace(/#/g, color).replace(/h/g, light));
}

// ───────── 카드 바탕 ─────────

/** 카드 앞면: 검은 테두리, 흰 바탕, 오른쪽 아래에 옅은 그늘. 모서리는 한 칸씩 깎는다. */
function faceRows(cellsX: number, cellsY: number): Rows {
  const rows: string[] = [];
  for (let y = 0; y < cellsY; y += 1) {
    let row = '';
    for (let x = 0; x < cellsX; x += 1) {
      const edgeX = x === 0 || x === cellsX - 1;
      const edgeY = y === 0 || y === cellsY - 1;
      if (edgeX && edgeY) row += '.';
      else if (edgeX || edgeY) row += '0';
      else if ((x === 1 || x === cellsX - 2) && (y === 1 || y === cellsY - 2)) row += '0';
      else if (y === cellsY - 2 || x === cellsX - 2) row += 'd';
      else row += 'c';
    }
    rows.push(row);
  }
  return rows;
}

/** 카드 뒷면: 흰 테두리 안에 남색과 파란색의 마름모 무늬, 가운데 노란 별 */
function backRows(cellsX: number, cellsY: number): Rows {
  const face = faceRows(cellsX, cellsY);
  const cx = (cellsX - 1) / 2;
  const cy = (cellsY - 1) / 2;
  return face.map((row, y) =>
    [...row]
      .map((ch, x) => {
        if (ch !== 'c' && ch !== 'd') return ch;
        const inner = x >= 3 && x <= cellsX - 4 && y >= 3 && y <= cellsY - 4;
        if (!inner) return ch === 'd' ? 'd' : 'c';
        if (x === 3 || x === cellsX - 4 || y === 3 || y === cellsY - 4) return '8';
        const dx = Math.abs(x - cx);
        const dy = Math.abs(y - cy);
        if (dx + dy <= 2) return '4';
        if (dx + dy <= 3) return '3';
        return (x + y) % 4 === 0 || (x - y + 400) % 4 === 0 ? '9' : '8';
      })
      .join(''),
  );
}

// ───────── 작은 그림 ─────────

const HEART = ['.00.00.', '0220220', '02c2220', '0222220', '.02220.', '..020..', '...0...'];
const HEART_EMPTY = ['.00.00.', '0ff0ff0', '0fffff0', '0fffff0', '.0fff0.', '..0f0..', '...0...'];
const UP = ['...0...', '..0c0..', '.0ccc0.', '0ccccc0', '000c000', '..0c0..', '..000..'];
const DOWN = ['..000..', '..0c0..', '000c000', '0ccccc0', '.0ccc0.', '..0c0..', '...0...'];
const SKIP = ['0..0...', '00.00..', '0c00c0.', '0cc0cc0', '0c00c0.', '00.00..', '0..0...'];

/** 칸 그림을 논리 크기 width × height로 등록한다. */
function addRows(scene: Phaser.Scene, key: string, rows: Rows, width: number, height: number): void {
  if (scene.textures.exists(key)) return;
  const cellsX = Math.max(...rows.map((row) => row.length));
  const cellsY = rows.length;
  const cell = Math.max(1, Math.ceil(Math.max(width / cellsX, height / cellsY) * renderScale()));
  const canvas = document.createElement('canvas');
  canvas.width = cellsX * cell;
  canvas.height = cellsY * cell;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D 캔버스를 만들 수 없습니다.');
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      const index = Number.parseInt(row[x], 16);
      if (Number.isNaN(index)) continue;
      context.fillStyle = PALETTE[index];
      context.fillRect(x * cell, y * cell, cell, cell);
    }
  });
  addHiResCanvas(scene.textures, key, canvas, width, height);
  scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
}

export function registerHighLowTextures(scene: Phaser.Scene): void {
  addRows(scene, TEX.face, faceRows(CARD_W / 2, CARD_H / 2), CARD_W, CARD_H);
  addRows(scene, TEX.back, backRows(CARD_W / 2, CARD_H / 2), CARD_W, CARD_H);
  addRows(scene, TEX.miniFace, faceRows(MINI_W / 2, MINI_H / 2), MINI_W, MINI_H);
  addRows(scene, TEX.heart, HEART, 14, 14);
  addRows(scene, TEX.heartEmpty, HEART_EMPTY, 14, 14);
  addRows(scene, TEX.up, UP, 14, 14);
  addRows(scene, TEX.down, DOWN, 14, 14);
  addRows(scene, TEX.skip, SKIP, 14, 14);
  RANK_KEYS.forEach((label, index) => {
    const rows = GLYPHS[label];
    for (const red of [false, true]) {
      addRows(scene, rankTexture(index + 1, red), paint(rows, red ? '2' : '0'), rows[0].length * 2, rows.length * 2);
    }
  });
  for (const suit of SUITS) {
    const rows = isRed(suit) ? paint(SUIT_ROWS[suit], '2', '3') : paint(SUIT_ROWS[suit], '0', 'e');
    addRows(scene, suitTexture(suit, 'small'), rows, 14, 14);
    addRows(scene, suitTexture(suit, 'big'), rows, 28, 28);
  }
}

/** 숫자 글자의 논리 크기(한 칸 2px) */
export function rankSize(rank: number): { width: number; height: number } {
  const rows = GLYPHS[RANK_KEYS[rank - 1]];
  return { width: rows[0].length * 2, height: rows.length * 2 };
}
