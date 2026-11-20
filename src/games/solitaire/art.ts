/**
 * 솔리테어 전용 그림. 공용 art/ 폴더를 건드리지 않도록 이 게임 안에서 만든다.
 * 등불지기, 구름 탑 모험처럼 픽셀 그림을 어두운 바탕에 놓는다. 카드 한 칸이 논리 픽셀 하나이고,
 * 기기의 화면 밀도에 맞춰 한 칸을 정수 개의 실제 픽셀로 칠해서 확대해도 칸이 번지지 않는다.
 * 색은 모두 config.ts의 PALETTE(Sweetie 16)에서 고른다.
 */
import Phaser from 'phaser';
import { COLOR, PALETTE } from '../../config';
import { addHiResCanvas, renderScale } from '../../core/hidpi';
import { cardId, isRed, SUITS, type Card, type Suit } from './rules';

/** 카드의 논리 크기 */
export const CARD_W = 30;
export const CARD_H = 42;

/** 도형에 쓰는 색 */
export const PX = {
  ink: COLOR.ink,
  night: COLOR.charcoal,
  panel: COLOR.charcoal,
  edge: COLOR.slate,
  navy: COLOR.navy,
  teal: COLOR.teal,
  yellow: COLOR.yellow,
  green: COLOR.green,
  lime: COLOR.lime,
  red: COLOR.red,
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

export const TEX = {
  back: 'sol-back',
  slot: 'sol-slot',
  recycle: 'sol-recycle',
} as const;

export const faceTexture = (card: Pick<Card, 'suit' | 'rank'>): string => `sol-card-${cardId({ ...card, up: true })}`;
export const foundationTexture = (suit: Suit): string => `sol-found-${suit}`;

// ───────── 작은 그림 ─────────

type Rows = readonly string[];

/** 3×5 숫자와 글자 */
const GLYPHS: Readonly<Record<string, Rows>> = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  J: ['..#', '..#', '..#', '#.#', '.#.'],
  Q: ['.#.', '#.#', '#.#', '##.', '.##'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['##.', '..#', '.#.', '#..', '###'],
  '3': ['##.', '..#', '.#.', '..#', '##.'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '##.', '..#', '##.'],
  '6': ['.##', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '##.'],
};

/** 7×7 무늬 */
const SUIT_ROWS: Readonly<Record<Suit, Rows>> = {
  0: ['...#...', '..###..', '.#####.', '#######', '#######', '...#...', '..###..'],
  1: ['.##.##.', '#######', '#######', '#######', '.#####.', '..###..', '...#...'],
  2: ['...#...', '..###..', '.#####.', '#######', '.#####.', '..###..', '...#...'],
  3: ['..###..', '..###..', '##.#.##', '#######', '##.#.##', '...#...', '..###..'],
};

/** 더미를 다시 뒤집는 자리의 둥근 화살표 9×9 */
const RECYCLE_ROWS: Rows = [
  '..####...',
  '.#....#..',
  '#......#.',
  '#.....###',
  '#......#.',
  '#........',
  '.#....#..',
  '..####...',
  '.........',
];

const RANK_TEXT = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;

/** 카드 글자와 무늬의 색: 빨강은 PALETTE 2, 검정은 PALETTE 0 */
const inkOf = (suit: Suit): number => (isRed(suit) ? 2 : 0);

// ───────── 칠하기 ─────────

class Painter {
  readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;

  constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly cell: number,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width * cell;
    this.canvas.height = height * cell;
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('2D 캔버스를 만들 수 없습니다.');
    this.context = context;
  }

  rect(x: number, y: number, w: number, h: number, color: number): void {
    this.context.fillStyle = PALETTE[color];
    this.context.fillRect(x * this.cell, y * this.cell, w * this.cell, h * this.cell);
  }

  /** '#'인 칸을 color로 칠한다. scale배로 키워서 칠한다. */
  rows(rows: Rows, x: number, y: number, color: number, scale = 1): void {
    rows.forEach((row, dy) => {
      for (let dx = 0; dx < row.length; dx += 1) {
        if (row[dx] === '#') this.rect(x + dx * scale, y + dy * scale, scale, scale, color);
      }
    });
  }

  /** 모서리 한 칸을 깎은 테두리 상자 */
  box(x: number, y: number, w: number, h: number, border: number, fill: number | null): void {
    this.rect(x + 1, y, w - 2, 1, border);
    this.rect(x + 1, y + h - 1, w - 2, 1, border);
    this.rect(x, y + 1, 1, h - 2, border);
    this.rect(x + w - 1, y + 1, 1, h - 2, border);
    if (fill !== null) this.rect(x + 1, y + 1, w - 2, h - 2, fill);
  }

  /** 점선 테두리(빈 자리) */
  dashed(x: number, y: number, w: number, h: number, color: number): void {
    for (let i = 2; i < w - 2; i += 3) {
      this.rect(x + i, y, 2, 1, color);
      this.rect(x + i, y + h - 1, 2, 1, color);
    }
    for (let i = 2; i < h - 2; i += 3) {
      this.rect(x, y + i, 1, 2, color);
      this.rect(x + w - 1, y + i, 1, 2, color);
    }
  }

  register(scene: Phaser.Scene, key: string): void {
    addHiResCanvas(scene.textures, key, this.canvas, this.width, this.height);
    scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
  }
}

const cellSize = (): number => Math.max(1, Math.ceil(renderScale()));

/** 카드 글자(A, 2…10, J, Q, K)를 scale배로 그린다. 그린 폭(칸)을 돌려준다. */
function drawRank(painter: Painter, rank: number, x: number, y: number, color: number, scale: number): number {
  let left = x;
  for (const letter of RANK_TEXT[rank]) {
    painter.rows(GLYPHS[letter], left, y, color, scale);
    left += 4 * scale;
  }
  return left - x - scale;
}

function paintFace(painter: Painter, card: Pick<Card, 'suit' | 'rank'>): void {
  const ink = inkOf(card.suit);
  painter.box(0, 0, CARD_W, CARD_H, 0, 12);
  // 아래쪽에 옅은 그늘을 깔아 두께를 낸다.
  painter.rect(1, CARD_H - 3, CARD_W - 2, 2, 13);
  // 위쪽 띠: 겹쳐 놓아도 보이는 자리에 숫자와 무늬
  drawRank(painter, card.rank, 3, 3, ink, 2);
  painter.rows(SUIT_ROWS[card.suit], CARD_W - 10, 4, ink);
  if (card.rank >= 11) {
    // 그림 카드: 금색 테두리 칸 안에 큰 글자와 무늬
    painter.box(6, 14, 18, 25, 4, 12);
    painter.rows(GLYPHS[RANK_TEXT[card.rank]], 11, 16, ink, 3);
    painter.rows(SUIT_ROWS[card.suit], 12, 31, ink);
  } else {
    painter.rows(SUIT_ROWS[card.suit], 8, 19, ink, 2);
  }
}

function paintBack(painter: Painter): void {
  painter.box(0, 0, CARD_W, CARD_H, 0, 8);
  painter.box(2, 2, CARD_W - 4, CARD_H - 4, 9, 8);
  // 바둑판 무늬
  for (let y = 4; y < CARD_H - 4; y += 2) {
    for (let x = 4 + ((y / 2) % 2) * 2; x < CARD_W - 4; x += 4) painter.rect(x, y, 2, 2, 9);
  }
  // 가운데 마름모
  painter.rows(SUIT_ROWS[2], 11, 17, 10, 1);
  painter.rows(['.#.', '###', '.#.'], 13, 19, 4, 1);
}

/** 이 게임의 텍스처를 한 번만 만든다. */
export function registerSolitaireTextures(scene: Phaser.Scene): void {
  if (scene.textures.exists(TEX.back)) return;
  const cell = cellSize();
  for (const suit of SUITS) {
    for (let rank = 1; rank <= 13; rank += 1) {
      const painter = new Painter(CARD_W, CARD_H, cell);
      paintFace(painter, { suit, rank });
      painter.register(scene, faceTexture({ suit, rank }));
    }
    const slot = new Painter(CARD_W, CARD_H, cell);
    slot.dashed(0, 0, CARD_W, CARD_H, 14);
    slot.rows(SUIT_ROWS[suit], 8, 14, 14, 2);
    slot.register(scene, foundationTexture(suit));
  }
  const back = new Painter(CARD_W, CARD_H, cell);
  paintBack(back);
  back.register(scene, TEX.back);

  const slot = new Painter(CARD_W, CARD_H, cell);
  slot.dashed(0, 0, CARD_W, CARD_H, 14);
  slot.register(scene, TEX.slot);

  const recycle = new Painter(CARD_W, CARD_H, cell);
  recycle.dashed(0, 0, CARD_W, CARD_H, 14);
  recycle.rows(RECYCLE_ROWS, 6, 12, 13, 2);
  recycle.register(scene, TEX.recycle);
}
