/**
 * 숫자 퍼즐의 그림. 색은 LOOK 한곳에 모아 두고, 모든 것을 둥근 도형으로 그린다.
 * 겉모습을 바꿀 때는 이 파일만 고치면 된다. 씬은 여기 함수들이 그린 것을 놓고 움직이기만 한다.
 */
import type Phaser from 'phaser';
import { THEME, THEME_CSS } from '../../config';
import { BOARD_LIP, cellArea, type Area, type BoardLayout, type Grid } from './rules';

type Graphics = Phaser.GameObjects.Graphics;

export const LOOK = {
  /** 판의 바탕. 칸 사이로 비쳐서 칸과 상자를 나누는 선이 된다. */
  board: { face: THEME.lilac, lip: THEME.lilacDeep },
  cell: {
    /** 처음부터 숫자가 적혀 있던 칸 */
    given: THEME.lilacSoft,
    /** 빈칸과, 맞게 채운 칸 */
    open: THEME.white,
    /** 골라 둔 칸과 같은 가로줄, 세로줄, 상자 */
    peer: THEME.pinkSoft,
    /** 골라 둔 숫자와 같은 숫자가 든 칸 */
    same: THEME.butter,
    cursor: THEME.pink,
    cursorRim: THEME.pinkDeep,
    /** 틀린 숫자를 두려던 칸과, 그 숫자가 이미 들어 있던 칸 */
    wrong: THEME.coral,
    /** 방금 다 채워진 줄이나 상자 */
    filled: THEME.mint,
  },
  digit: {
    given: THEME_CSS.inkDeep,
    /** 맞게 채운 숫자. 처음 숫자와는 색도, 칸의 면(흰색)도 다르다. */
    placed: THEME_CSS.good,
    /** 틀려서 흔들리는 숫자. 붉은 면 위에 놓이므로 짙은 색이어야 읽힌다. */
    wrong: THEME_CSS.inkDeep,
  },
  pad: {
    idle: { face: THEME.card, lip: THEME.shadow, text: THEME_CSS.ink },
    /** 들고 있는 숫자 */
    armed: { face: THEME.pink, lip: THEME.pinkDeep, text: THEME_CSS.inkDeep },
    /** 판에 다 들어가서 더 둘 곳이 없는 숫자 */
    done: { face: THEME.dim, lip: THEME.dim, text: THEME_CSS.faint },
  },
  /** 판 위의 줄에 놓이는 알약 모양 판: 하트와 남은 칸 수가 그 위에 놓인다. */
  plate: { face: THEME.card, lip: THEME.shadow },
  hearts: { full: THEME.pinkDeep, empty: THEME.shadow },
  /** 하트의 반짝임 */
  glint: THEME.white,
  confetti: [THEME.gold, THEME.pink, THEME.mintDeep, THEME.lilacDeep],
  text: {
    hint: THEME_CSS.ink,
    hintSub: THEME_CSS.sub,
    outline: THEME_CSS.white,
    blanks: THEME_CSS.ink,
    points: THEME_CSS.accent,
    clear: THEME_CSS.good,
    ready: THEME_CSS.accent,
    over: THEME_CSS.accent,
  },
} as const;

export type PadLook = keyof typeof LOOK.pad;

// ───────── 판과 칸 ─────────

/** 칸의 면은 칸 자리보다 사방으로 이만큼 작다. 그 틈으로 판의 바탕이 가는 선처럼 보인다. */
const CELL_INSET = 0.5;
/** 골라 둔 칸에 두르는 테두리의 두께 */
const CURSOR_RIM = 2;

/** 칸 모서리의 반지름. 칸이 클수록 더 둥글다. */
function cellRadius(layout: BoardLayout): number {
  return Math.round(layout.cell * 0.17);
}

/** 숫자의 글자 크기. 가장 작은 칸(24px)에서도 16px로 또렷하다. */
export function digitSize(layout: BoardLayout): number {
  return Math.round(layout.cell * 0.68);
}

function fillCell(g: Graphics, area: Area, radius: number, color: number, inset = CELL_INSET): void {
  g.fillStyle(color, 1);
  g.fillRoundedRect(
    area.x + inset,
    area.y + inset,
    area.width - inset * 2,
    area.height - inset * 2,
    Math.max(1, radius - (inset - CELL_INSET)),
  );
}

/** 판의 바탕: 둥근 카드와 그 아래의 두께 */
export function drawBoard(g: Graphics, layout: BoardLayout): void {
  const { x, y, width, height } = layout.board;
  const radius = cellRadius(layout) + 5;
  g.fillStyle(LOOK.board.lip, 1);
  g.fillRoundedRect(x, y + BOARD_LIP, width, height, radius);
  g.fillStyle(LOOK.board.face, 1);
  g.fillRoundedRect(x, y, width, height, radius);
}

export interface CellMarks {
  /** 골라 둔 칸 */
  cursor: number | null;
  /** 골라 둔 칸과 같은 줄이나 상자에 있는 칸들 */
  peers: readonly number[];
  /** 눈에 띄게 할 숫자 */
  digit: number | null;
}

/**
 * 모든 칸의 면을 그린다. 처음 숫자가 있던 칸은 옅은 보라, 채울 칸은 흰색이고,
 * 그 위에 고른 칸(분홍 테두리), 같은 숫자(노랑), 같은 줄과 상자(옅은 분홍)를 표시한다.
 */
export function drawCells(
  g: Graphics,
  layout: BoardLayout,
  givens: Grid,
  grid: Grid,
  marks: CellMarks,
): void {
  const radius = cellRadius(layout);
  const peers = new Set(marks.peers);
  g.clear();
  grid.forEach((value, cell) => {
    const area = cellArea(layout, cell);
    if (cell === marks.cursor) {
      fillCell(g, area, radius, LOOK.cell.cursorRim);
      fillCell(g, area, radius, LOOK.cell.cursor, CELL_INSET + CURSOR_RIM);
    } else if (value !== 0 && value === marks.digit) {
      fillCell(g, area, radius, LOOK.cell.same);
    } else if (peers.has(cell)) {
      fillCell(g, area, radius, LOOK.cell.peer);
    } else {
      fillCell(g, area, radius, givens[cell] === 0 ? LOOK.cell.open : LOOK.cell.given);
    }
  });
}

/** 칸들을 한 가지 색으로 덮는다. 잠깐 번쩍였다 사라지는 표시에 쓴다. */
export function drawCellFlash(
  g: Graphics,
  layout: BoardLayout,
  cells: readonly number[],
  color: number,
): void {
  const radius = cellRadius(layout);
  for (const cell of cells) fillCell(g, cellArea(layout, cell), radius, color);
}

/** 칸 하나만 한 둥근 면. 가운데가 (0, 0)이라서 흔들거나 키울 때 쓴다. */
export function drawCellPlate(g: Graphics, layout: BoardLayout, color: number): void {
  const size = layout.cell;
  fillCell(g, { x: -size / 2, y: -size / 2, width: size, height: size }, cellRadius(layout), color);
}

/** 칸을 두르는 고리. 가운데가 (0, 0)이다. 처음에 누를 칸을 알려 줄 때 쓴다. */
export function drawCellRing(g: Graphics, layout: BoardLayout): void {
  const size = layout.cell - 2;
  g.lineStyle(2.5, LOOK.cell.cursorRim, 1);
  g.strokeRoundedRect(-size / 2, -size / 2, size, size, cellRadius(layout));
}

// ───────── 숫자 버튼 ─────────

/** 버튼 아래쪽에 보이는 두께. 누르면 그만큼 들어간다. */
export const PAD_LIP = 3;

function padRadius(area: Area): number {
  return Math.min(11, (area.height - PAD_LIP) / 2, area.width / 2);
}

/** 버튼 아래에 깔리는 두께. (0, 0)이 버튼의 왼쪽 위다. */
export function drawPadLip(g: Graphics, area: Area, look: PadLook): void {
  g.clear();
  g.fillStyle(LOOK.pad[look].lip, 1);
  g.fillRoundedRect(0, PAD_LIP, area.width, area.height - PAD_LIP, padRadius(area));
}

/** 버튼의 윗면. (0, 0)이 버튼의 왼쪽 위다. */
export function drawPadFace(g: Graphics, area: Area, look: PadLook): void {
  g.clear();
  g.fillStyle(LOOK.pad[look].face, 1);
  g.fillRoundedRect(0, 0, area.width, area.height - PAD_LIP, padRadius(area));
}

// ───────── 판 위의 줄 ─────────

const HEART_GAP = 14;
/** 알약 모양 판의 높이 */
const PLATE_HEIGHT = 16;

/** 흰 알약 모양 판. 가운데가 (0, 0)이다. */
export function drawPlate(g: Graphics, width: number): void {
  const left = -width / 2;
  const top = -PLATE_HEIGHT / 2;
  g.clear();
  g.fillStyle(LOOK.plate.lip, 1);
  g.fillRoundedRect(left, top + 1.5, width, PLATE_HEIGHT, PLATE_HEIGHT / 2);
  g.fillStyle(LOOK.plate.face, 1);
  g.fillRoundedRect(left, top, width, PLATE_HEIGHT, PLATE_HEIGHT / 2);
}

/** 하트 판의 폭 */
export function heartsWidth(total: number): number {
  return total * HEART_GAP + 8;
}

function drawHeart(g: Graphics, x: number, y: number, color: number, shine: boolean): void {
  g.fillStyle(color, 1);
  g.fillCircle(x - 2.6, y - 1.5, 3);
  g.fillCircle(x + 2.6, y - 1.5, 3);
  g.fillTriangle(x - 5.3, y, x + 5.3, y, x, y + 5.4);
  if (!shine) return;
  g.fillStyle(LOOK.glint, 0.85);
  g.fillCircle(x - 3.2, y - 2.4, 1);
}

/** 목숨을 알약 모양 판 위에 하트로 그린다. 판의 가운데가 (0, 0)이다. 잃은 하트는 빈 자국으로 남는다. */
export function drawHearts(g: Graphics, full: number, total: number): void {
  const width = heartsWidth(total);
  drawPlate(g, width);
  for (let index = 0; index < total; index += 1) {
    const alive = index < full;
    const x = -width / 2 + 4 + HEART_GAP * (index + 0.5);
    drawHeart(g, x, -0.6, alive ? LOOK.hearts.full : LOOK.hearts.empty, alive);
  }
}
