/**
 * 원카드의 픽셀 그림: 카드 무늬, 컴퓨터 얼굴, 카드 뒷면. 구름 탑 모험, 등불지기와 같은 팔레트와 어두운 바탕을 쓴다.
 * 그림은 16진수 한 글자가 팔레트(config.ts PALETTE)의 색 하나인 문자열이다. '.'은 비어 있다.
 * 기기의 화면 밀도에 맞춰 한 칸을 정수 개의 실제 픽셀로 칠해서, 확대해도 칸이 번지지 않는다.
 */
import Phaser from 'phaser';
import { PALETTE } from '../../config';
import { addHiResCanvas, renderScale } from '../../core/hidpi';
import type { Suit } from './rules';

export type Rows = readonly string[];

export const SUIT_ROWS: Readonly<Record<Suit, Rows>> = {
  S: [
    '...0...',
    '..000..',
    '.00000.',
    '0000000',
    '0000000',
    '.0.0.0.',
    '..000..',
  ],
  H: [
    '.22.22.',
    '2222222',
    '2222222',
    '2222222',
    '.22222.',
    '..222..',
    '...2...',
  ],
  D: [
    '...2...',
    '..222..',
    '.22222.',
    '2222222',
    '.22222.',
    '..222..',
    '...2...',
  ],
  C: [
    '..000..',
    '..000..',
    '0000000',
    '0000000',
    '.0.0.0.',
    '...0...',
    '..000..',
  ],
};

/** 조커의 별. 흑백은 회색, 컬러는 노랑과 빨강 */
export const JOKER_ROWS: readonly [Rows, Rows] = [
  [
    '....e....',
    '...eee...',
    'eeeefeeee',
    '.efffffe.',
    '..efffe..',
    '..effffe.',
    '.eff.ffe.',
    '.ee...ee.',
    '.........',
  ],
  [
    '....4....',
    '...434...',
    '44443444.',
    '.4333334.',
    '..42324..',
    '..433334.',
    '.433.334.',
    '.44...44.',
    '.........',
  ],
];

/** 컴퓨터 얼굴(작은 로봇). 이름(text.ts BOT_NAMES)과 같은 차례다. */
export const BOT_ROWS: readonly Rows[] = [
  [
    '.....33.....',
    '.....3......',
    '.0000000000.',
    '0aaaaaaaaaa0',
    '0a00aaaa00a0',
    '0a0caaaa0ca0',
    '0aaaaaaaaaa0',
    '0aaa0000aaa0',
    '0aaaaaaaaaa0',
    '.0000000000.',
    '...0dddd0...',
    '...000000...',
  ],
  [
    '..4......4..',
    '..0......0..',
    '.0000000000.',
    '033333333330',
    '03cc3333cc30',
    '03c03333c030',
    '033333333330',
    '033322223330',
    '033333333330',
    '.0000000000.',
    '...0dddd0...',
    '...000000...',
  ],
  [
    '............',
    '.0000000000.',
    '055555555550',
    '055c5555c550',
    '055055550550',
    '055555555550',
    '055500005550',
    '055555555550',
    '.0000000000.',
    '..0dd00dd0..',
    '..0dd00dd0..',
    '..00000000..',
  ],
];

/** 카드 뒷면 텍스처 이름 */
export const TEX = {
  back: 'oc-back',
  backSmall: 'oc-back-s',
} as const;

export const suitTexture = (suit: Suit, big = false): string => `oc-suit-${suit}${big ? '-b' : ''}`;
export const jokerTexture = (rank: number): string => `oc-joker-${rank}`;
export const botTexture = (index: number): string => `oc-bot-${index}`;

/** 카드 크기(논리 픽셀) */
export const CARD = {
  /** 손의 카드 */
  w: 30,
  h: 42,
  /** 가운데 더미 */
  bigW: 40,
  bigH: 56,
  /** 상대의 카드 뒷면 */
  smallW: 10,
  smallH: 14,
} as const;

/** 카드 뒷면: 테두리 안에 남색과 파랑의 마름모 무늬 */
function backRows(width: number, height: number): Rows {
  const rows: string[] = [];
  for (let y = 0; y < height; y += 1) {
    let row = '';
    for (let x = 0; x < width; x += 1) {
      const edge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      const corner = (x === 0 || x === width - 1) && (y === 0 || y === height - 1);
      const rim = x === 1 || y === 1 || x === width - 2 || y === height - 2;
      if (corner) row += '.';
      else if (edge) row += '0';
      else if (rim) row += 'c';
      else row += (x + y) % 4 === 0 || (x - y + 400) % 4 === 0 ? '9' : '8';
    }
    rows.push(row);
  }
  return rows;
}

/** 상대 자리의 작은 뒷면. 무늬를 넣으면 너무 작아 글자처럼 보여서 파란 바탕에 점 두 개만 둔다. */
const SMALL_BACK: Rows = ['.000.', '09990', '09a90', '09990', '09a90', '09990', '.000.'];

/** 그림을 논리 크기 width × height로 등록한다. */
function addRows(scene: Phaser.Scene, key: string, rows: Rows, width: number, height: number): void {
  if (scene.textures.exists(key)) return;
  const cellsX = rows[0].length;
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

export function registerOneCardTextures(scene: Phaser.Scene): void {
  for (const [suit, rows] of Object.entries(SUIT_ROWS)) {
    addRows(scene, suitTexture(suit as Suit), rows, 7, 7);
    addRows(scene, suitTexture(suit as Suit, true), rows, 14, 14);
  }
  JOKER_ROWS.forEach((rows, rank) => addRows(scene, jokerTexture(rank), rows, 18, 18));
  BOT_ROWS.forEach((rows, index) => addRows(scene, botTexture(index), rows, 24, 24));
  addRows(scene, TEX.back, backRows(CARD.w / 2, CARD.h / 2), CARD.w, CARD.h);
  addRows(scene, TEX.backSmall, SMALL_BACK, CARD.smallW, CARD.smallH);
}
