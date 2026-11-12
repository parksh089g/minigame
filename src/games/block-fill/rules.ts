/**
 * 블록 채우기의 규칙. 화면과 분리된 순수 함수라서 숫자만 바꿔 밸런스를 조정할 수 있다.
 * 판은 SIZE × SIZE이고, 칸 번호는 왼쪽 위부터 오른쪽으로 매긴다(칸 번호 = 줄 × SIZE + 열).
 * 칸에는 그 자리에 놓인 블록의 색 번호(1부터)를 적고, 빈칸은 0이다.
 * 무작위가 필요한 곳은 rng(0 이상 1 미만의 수를 돌려주는 함수)를 받아서 쓴다.
 */

// ───────── 판 ─────────

export const SIZE = 8;
export const CELLS = SIZE * SIZE;

/** 칸마다 놓인 블록의 색 번호. 빈칸은 0이다. 길이는 언제나 CELLS다. */
export type Board = readonly number[];

export function emptyBoard(): number[] {
  return new Array<number>(CELLS).fill(0);
}

export function cellIndex(col: number, row: number): number {
  return row * SIZE + col;
}

/** 판에서 채워진 칸의 수 */
export function filledCount(board: Board): number {
  return board.reduce((count, color) => count + (color > 0 ? 1 : 0), 0);
}

// ───────── 블록 ─────────

/** 블록 하나. 돌리거나 뒤집을 수 없으므로, 돌린 모양과 뒤집은 모양도 저마다 다른 블록이다. */
export interface Piece {
  /** 고유한 이름. 예: 'bar3-1' */
  id: string;
  /** 모양의 갈래. 돌리거나 뒤집어서 겹치는 모양끼리 같은 갈래다. */
  family: string;
  /** 색 번호(1부터). 같은 갈래는 같은 색을 쓴다. */
  color: number;
  /** 차지하는 칸의 [열, 줄]. 왼쪽 위 모서리가 [0, 0]이다. */
  cells: readonly (readonly [number, number])[];
  width: number;
  height: number;
  /** 판을 시작할 때와 난이도가 다 올랐을 때 뽑히는 무게 */
  early: number;
  late: number;
}

interface Family {
  family: string;
  /** 판을 시작할 때 이 갈래가 뽑히는 무게. 갈래 안의 모양들이 똑같이 나눠 갖는다. */
  early: number;
  /** 난이도가 다 올랐을 때의 무게 */
  late: number;
  /** 모양 그림. '#'이 블록이 차지하는 칸이다. */
  pictures: readonly (readonly string[])[];
}

/**
 * 블록의 갈래. 적힌 순서가 색 번호(1부터)다.
 * 앞쪽의 작은 블록은 처음에 자주 나오고, 뒤쪽의 크고 놓기 까다로운 블록은 갈수록 자주 나온다.
 */
const FAMILIES: readonly Family[] = [
  { family: 'dot', early: 5, late: 1, pictures: [['#']] },
  { family: 'bar2', early: 9, late: 2, pictures: [['##'], ['#', '#']] },
  { family: 'bar3', early: 12, late: 4, pictures: [['###'], ['#', '#', '#']] },
  {
    family: 'bend3',
    early: 12,
    late: 5,
    pictures: [
      ['#.', '##'],
      ['.#', '##'],
      ['##', '#.'],
      ['##', '.#'],
    ],
  },
  { family: 'bar4', early: 9, late: 7, pictures: [['####'], ['#', '#', '#', '#']] },
  { family: 'box2', early: 10, late: 7, pictures: [['##', '##']] },
  {
    family: 'ell4',
    early: 12,
    late: 14,
    pictures: [
      ['#.', '#.', '##'],
      ['.#', '.#', '##'],
      ['##', '#.', '#.'],
      ['##', '.#', '.#'],
      ['#..', '###'],
      ['..#', '###'],
      ['###', '#..'],
      ['###', '..#'],
    ],
  },
  {
    family: 'tee4',
    early: 7,
    late: 11,
    pictures: [
      ['###', '.#.'],
      ['.#.', '###'],
      ['#.', '##', '#.'],
      ['.#', '##', '.#'],
    ],
  },
  {
    family: 'zig4',
    early: 4,
    late: 13,
    pictures: [
      ['.##', '##.'],
      ['##.', '.##'],
      ['#.', '##', '.#'],
      ['.#', '##', '#.'],
    ],
  },
  { family: 'bar5', early: 5, late: 11, pictures: [['#####'], ['#', '#', '#', '#', '#']] },
  {
    family: 'bend5',
    early: 3,
    late: 13,
    pictures: [
      ['#..', '#..', '###'],
      ['..#', '..#', '###'],
      ['###', '#..', '#..'],
      ['###', '..#', '..#'],
    ],
  },
  { family: 'box3', early: 1, late: 12, pictures: [['###', '###', '###']] },
];

function pieceOf(family: Family, color: number, picture: readonly string[], index: number): Piece {
  const cells: [number, number][] = [];
  picture.forEach((line, row) => {
    for (let col = 0; col < line.length; col += 1) {
      if (line[col] === '#') cells.push([col, row]);
    }
  });
  return {
    id: `${family.family}-${index + 1}`,
    family: family.family,
    color,
    cells,
    width: picture[0].length,
    height: picture.length,
    early: family.early / family.pictures.length,
    late: family.late / family.pictures.length,
  };
}

/** 나올 수 있는 모든 블록 */
export const PIECES: readonly Piece[] = FAMILIES.flatMap((family, index) =>
  family.pictures.map((picture, nth) => pieceOf(family, index + 1, picture, nth)),
);

/** 블록 색의 가짓수. 색 번호는 1부터 이 수까지다. */
export const COLOR_COUNT = FAMILIES.length;

/** 블록에서 가장 긴 변의 칸 수. 쟁반의 자리 크기를 정할 때 쓴다. */
export const MAX_SPAN = PIECES.reduce((span, piece) => Math.max(span, piece.width, piece.height), 0);

export function pieceById(id: string): Piece | undefined {
  return PIECES.find((piece) => piece.id === id);
}

// ───────── 놓기 ─────────

/** 블록의 왼쪽 위를 (col, row) 칸에 맞춰 놓을 수 있는지. 판 밖으로 나가거나 채워진 칸과 겹치면 안 된다. */
export function canPlace(board: Board, piece: Piece, col: number, row: number): boolean {
  if (!Number.isInteger(col) || !Number.isInteger(row)) return false;
  if (col < 0 || row < 0 || col + piece.width > SIZE || row + piece.height > SIZE) return false;
  return piece.cells.every(([dx, dy]) => board[cellIndex(col + dx, row + dy)] === 0);
}

/** 블록을 (col, row)에 놓았을 때 차지하는 칸 번호들 */
export function cellsAt(piece: Piece, col: number, row: number): number[] {
  return piece.cells.map(([dx, dy]) => cellIndex(col + dx, row + dy));
}

/** 블록을 놓을 수 있는 모든 자리 */
export function placementsOf(board: Board, piece: Piece): { col: number; row: number }[] {
  const spots: { col: number; row: number }[] = [];
  for (let row = 0; row + piece.height <= SIZE; row += 1) {
    for (let col = 0; col + piece.width <= SIZE; col += 1) {
      if (canPlace(board, piece, col, row)) spots.push({ col, row });
    }
  }
  return spots;
}

/** 블록을 판 어딘가에 놓을 수 있는지 */
export function fitsAnywhere(board: Board, piece: Piece): boolean {
  for (let row = 0; row + piece.height <= SIZE; row += 1) {
    for (let col = 0; col + piece.width <= SIZE; col += 1) {
      if (canPlace(board, piece, col, row)) return true;
    }
  }
  return false;
}

/** 손에서 놓은 자리가 맞는 자리에서 이만큼(칸) 안쪽이면 그 자리에 붙는다. */
export const SNAP_REACH = 0.9;
/**
 * 이미 붙어 있던 자리는 다른 자리가 이만큼(칸) 넘게 더 가까워져야 놓아준다.
 * 두 칸의 경계에서 손가락이 조금 떨려도 놓일 자리가 왔다 갔다 하지 않는다.
 */
export const SNAP_STICKY = 0.15;

/**
 * 끌고 있는 블록의 왼쪽 위가 판의 칸 좌표로 (col, row)에 있을 때(소수일 수 있다) 블록이 놓일 자리.
 * 놓을 수 있는 자리 가운데 가장 가까운 것을 고르고, SNAP_REACH 안에 그런 자리가 없으면 null이다.
 * held는 바로 전에 붙어 있던 자리다. 그 자리가 아직 닿는 거리 안이고 가장 가까운 자리와 별 차이가 없으면 그대로 둔다.
 */
export function snapTarget(
  board: Board,
  piece: Piece,
  col: number,
  row: number,
  held: { col: number; row: number } | null = null,
  reach = SNAP_REACH,
): { col: number; row: number } | null {
  let best: { col: number; row: number } | null = null;
  let bestDistance = reach;
  // Math.ceil은 -0을 돌려줄 수 있다. 0을 더해 +0으로 맞춘다.
  const firstCol = Math.ceil(col - reach) + 0;
  const firstRow = Math.ceil(row - reach) + 0;
  for (let y = firstRow; y <= Math.floor(row + reach); y += 1) {
    for (let x = firstCol; x <= Math.floor(col + reach); x += 1) {
      const distance = Math.hypot(x - col, y - row);
      if (distance > bestDistance || !canPlace(board, piece, x, y)) continue;
      // 거리가 같으면 먼저 찾은 자리(위쪽, 왼쪽)를 그대로 둔다.
      if (best && distance === bestDistance) continue;
      best = { col: x, row: y };
      bestDistance = distance;
    }
  }
  if (held && best && canPlace(board, piece, held.col, held.row)) {
    const heldDistance = Math.hypot(held.col - col, held.row - row);
    if (heldDistance <= reach && heldDistance - bestDistance < SNAP_STICKY) {
      return { col: held.col, row: held.row };
    }
  }
  return best;
}

// ───────── 줄 지우기 ─────────

export interface Lines {
  /** 가득 찬 가로줄의 번호(위에서부터 0) */
  rows: number[];
  /** 가득 찬 세로줄의 번호(왼쪽에서부터 0) */
  cols: number[];
}

/** 판에서 가득 찬 가로줄과 세로줄 */
export function fullLines(board: Board): Lines {
  const rows: number[] = [];
  const cols: number[] = [];
  for (let line = 0; line < SIZE; line += 1) {
    let rowFull = true;
    let colFull = true;
    for (let step = 0; step < SIZE; step += 1) {
      if (board[cellIndex(step, line)] === 0) rowFull = false;
      if (board[cellIndex(line, step)] === 0) colFull = false;
    }
    if (rowFull) rows.push(line);
    if (colFull) cols.push(line);
  }
  return { rows, cols };
}

/** 줄들이 차지하는 칸 번호. 가로줄과 세로줄이 만나는 칸은 한 번만 들어간다. 작은 번호부터 차례로다. */
export function lineCells(lines: Lines): number[] {
  const cells = new Set<number>();
  for (const row of lines.rows) {
    for (let col = 0; col < SIZE; col += 1) cells.add(cellIndex(col, row));
  }
  for (const col of lines.cols) {
    for (let row = 0; row < SIZE; row += 1) cells.add(cellIndex(col, row));
  }
  return [...cells].sort((a, b) => a - b);
}

/**
 * 블록을 (col, row)에 놓으면 가득 차게 되는 줄. 놓기 전에 어느 줄이 지워질지 미리 보여 줄 때 쓴다.
 * 놓을 수 없는 자리면 빈 목록이다.
 */
export function linesAfter(board: Board, piece: Piece, col: number, row: number): Lines {
  if (!canPlace(board, piece, col, row)) return { rows: [], cols: [] };
  const next = [...board];
  for (const cell of cellsAt(piece, col, row)) next[cell] = piece.color;
  return fullLines(next);
}

// ───────── 점수 ─────────

/** 블록을 놓으면 칸 하나에 받는 점수 */
export const CELL_POINTS = 1;
/** 줄 하나를 지운 점수. 여러 줄을 한꺼번에 지우면 줄 수만큼 곱해진다. */
export const LINE_POINTS = 10;
/** 연달아 지울 때, 이어진 횟수 하나마다 더 받는 점수 */
export const STREAK_POINTS = 10;
/** 연속 보너스가 더 커지지 않는 횟수. 이보다 길게 이어도 보너스는 그대로다. */
export const STREAK_CAP = 6;

/** 한 번에 count줄을 지운 점수. 한 줄 10, 두 줄 40, 세 줄 90으로 줄 수의 제곱만큼 커진다. */
export function linePoints(count: number): number {
  return count <= 0 ? 0 : LINE_POINTS * count * count;
}

/**
 * 연속 보너스. streak은 블록을 놓을 때마다 빠짐없이 줄을 지운 횟수다.
 * 처음 지울 때는 없고, 두 번째부터 10점씩 커진다.
 */
export function streakBonus(streak: number): number {
  return streak < 2 ? 0 : STREAK_POINTS * (Math.min(streak, STREAK_CAP) - 1);
}

// ───────── 난이도와 나눠 주기 ─────────

/** 쟁반에 한 번에 놓이는 블록 수 */
export const TRAY_SIZE = 3;
/** 이만큼 놓을 때까지는 가장 쉬운 무게로 나온다. */
export const RAMP_START = 9;
/** 이만큼 놓으면 난이도가 다 오른다. 한 판이 끝없이 이어지지 않게 하는 숫자다. */
export const RAMP_END = 120;
/** 셋 다 놓을 수 없는 벌이 나왔을 때 다시 뽑아 보는 횟수 */
export const DEAL_ATTEMPTS = 12;

/** 지금까지 놓은 블록 수에 따른 난이도. 0(시작)에서 1(다 오름)까지 고르게 오른다. */
export function difficultyAt(placed: number): number {
  const ratio = (placed - RAMP_START) / (RAMP_END - RAMP_START);
  return Math.min(1, Math.max(0, ratio));
}

/** 블록이 뽑히는 무게. 놓은 블록이 늘수록 early에서 late로 옮겨 간다. */
export function weightOf(piece: Piece, placed: number): number {
  const difficulty = difficultyAt(placed);
  return piece.early + (piece.late - piece.early) * difficulty;
}

/** 무게에 따라 블록 하나를 뽑는다. */
export function pickPiece(placed: number, rng: () => number): Piece {
  const total = PIECES.reduce((sum, piece) => sum + weightOf(piece, placed), 0);
  let roll = rng() * total;
  for (const piece of PIECES) {
    roll -= weightOf(piece, placed);
    if (roll < 0) return piece;
  }
  return PIECES[PIECES.length - 1];
}

/**
 * 지금 판에 놓을 수 있는 블록 가운데 가장 큰 것. 칸 수가 같으면 목록에서 앞선 것이다.
 * 빈칸이 하나라도 있으면 한 칸짜리가 들어가므로, 판이 꽉 차지 않은 한 null이 아니다.
 */
export function largestFitting(board: Board): Piece | null {
  let best: Piece | null = null;
  for (const piece of PIECES) {
    if (best && piece.cells.length <= best.cells.length) continue;
    if (fitsAnywhere(board, piece)) best = piece;
  }
  return best;
}

/**
 * 새 블록 세 개를 뽑는다.
 * 셋 가운데 하나는 반드시 지금 판에 놓을 수 있다: 셋 다 놓을 수 없으면 DEAL_ATTEMPTS번까지 다시 뽑고,
 * 그래도 안 되면 첫 자리를 놓을 수 있는 가장 큰 블록으로 바꾼다. 어떤 블록도 놓을 수 없는 판(꽉 찬 판)이면
 * 마지막으로 뽑은 것을 그대로 돌려준다.
 */
export function dealTray(board: Board, placed: number, rng: () => number): Piece[] {
  let tray: Piece[] = [];
  for (let attempt = 0; attempt < DEAL_ATTEMPTS; attempt += 1) {
    tray = [];
    for (let slot = 0; slot < TRAY_SIZE; slot += 1) tray.push(pickPiece(placed, rng));
    if (tray.some((piece) => fitsAnywhere(board, piece))) return tray;
  }
  const rescue = largestFitting(board);
  if (rescue) tray[0] = rescue;
  return tray;
}

// ───────── 한 판 ─────────

export interface RunState {
  board: number[];
  /** 쟁반의 세 자리. 이미 놓은 자리는 null이다. */
  tray: (Piece | null)[];
  score: number;
  /** 지금까지 놓은 블록 수 */
  placed: number;
  /** 지금까지 지운 줄 수 */
  lines: number;
  /** 블록을 놓을 때마다 빠짐없이 줄을 지운 횟수. 줄을 지우지 못하고 놓으면 0으로 돌아간다. */
  streak: number;
  bestStreak: number;
  /** 쟁반에 남은 블록을 어디에도 놓을 수 없어서 끝났는지 */
  over: boolean;
}

/** 쟁반에 남은 블록 가운데 하나라도 판에 놓을 수 있는지. 쟁반이 비어 있으면 false다. */
export function anyFits(board: Board, tray: readonly (Piece | null)[]): boolean {
  return tray.some((piece) => piece !== null && fitsAnywhere(board, piece));
}

export function newRun(rng: () => number): RunState {
  const board = emptyBoard();
  const tray = dealTray(board, 0, rng);
  return {
    board,
    tray,
    score: 0,
    placed: 0,
    lines: 0,
    streak: 0,
    bestStreak: 0,
    over: !anyFits(board, tray),
  };
}

export interface ClearedCell {
  cell: number;
  /** 지워지기 전의 색 번호 */
  color: number;
}

export interface Placement {
  /** 놓은 뒤의 상태 */
  run: RunState;
  piece: Piece;
  /** 블록이 차지한 칸 번호 */
  cells: number[];
  /** 이번에 지워진 줄 */
  lines: Lines;
  /** 지워진 칸과 그 칸의 색. 방금 놓은 칸도 줄에 들어 있으면 여기에 있다. */
  cleared: ClearedCell[];
  /** 이번에 받은 점수의 내역 */
  points: { cells: number; lines: number; streak: number; total: number };
  /** 쟁반이 비어서 새 블록 세 개를 받았는지 */
  dealt: boolean;
}

/**
 * 쟁반의 slot번 블록을 (col, row)에 놓는다. 놓을 수 없으면 null이다. 원본 상태는 바꾸지 않는다.
 * 가득 찬 줄을 지우고, 점수와 연속 횟수를 올리고, 쟁반이 비었으면 새로 채운 뒤,
 * 남은 블록을 놓을 곳이 없으면 판을 끝낸다.
 */
export function placePiece(
  run: RunState,
  slot: number,
  col: number,
  row: number,
  rng: () => number,
): Placement | null {
  const piece = run.tray[slot];
  if (run.over || !piece || !canPlace(run.board, piece, col, row)) return null;

  const board = [...run.board];
  const cells = cellsAt(piece, col, row);
  for (const cell of cells) board[cell] = piece.color;

  const lines = fullLines(board);
  const count = lines.rows.length + lines.cols.length;
  const cleared = lineCells(lines).map((cell) => ({ cell, color: board[cell] }));
  for (const { cell } of cleared) board[cell] = 0;

  const streak = count > 0 ? run.streak + 1 : 0;
  const points = {
    cells: cells.length * CELL_POINTS,
    lines: linePoints(count),
    streak: count > 0 ? streakBonus(streak) : 0,
    total: 0,
  };
  points.total = points.cells + points.lines + points.streak;

  const placed = run.placed + 1;
  let tray = run.tray.map((held, index) => (index === slot ? null : held));
  const dealt = tray.every((held) => held === null);
  if (dealt) tray = dealTray(board, placed, rng);

  return {
    run: {
      board,
      tray,
      score: run.score + points.total,
      placed,
      lines: run.lines + count,
      streak,
      bestStreak: Math.max(run.bestStreak, streak),
      over: !anyFits(board, tray),
    },
    piece,
    cells,
    lines,
    cleared,
    points,
    dealt,
  };
}

// ───────── 자리 ─────────

/** 판 한 칸의 가장 큰 크기와 가장 작은 크기(px) */
export const MAX_CELL = 27;
export const MIN_CELL = 22;
/** 쟁반에 놓인 블록 한 칸의 가장 큰 크기와 가장 작은 크기(px) */
export const MAX_TRAY_CELL = 14;
export const MIN_TRAY_CELL = 12;
/** 판을 두르는 테두리의 폭과 그 아래로 보이는 두께(px) */
export const BOARD_RIM = 5;
export const BOARD_LIP = 3;
/** 판 테두리와 화면 좌우 끝 사이의 가장 좁은 여백(px) */
export const SIDE_MARGIN = 6;
/** 판 위, 판과 쟁반 사이, 쟁반 아래에 적어도 비워 두는 높이(px) */
export const GAPS = { top: 4, middle: 10, bottom: 6 } as const;
/** 화면이 길 때 판과 쟁반 사이를 이만큼까지 더 벌린다(px). */
export const MAX_EXTRA_MIDDLE = 14;
/** 쟁반의 블록 위아래로 두는 여유(px). 화면이 길면 MAX_TRAY_PAD까지 늘린다. */
export const MIN_TRAY_PAD = 4;
export const MAX_TRAY_PAD = 12;
/** 쟁반 받침의 좌우 끝과 바깥쪽 자리 사이의 여유(px). 가장 긴 블록이 받침 끝에 닿지 않게 한다. */
export const TRAY_INSET = 3;

export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Layout {
  /** 판 한 칸의 크기(px) */
  cell: number;
  /** 판의 왼쪽 위 칸의 왼쪽 위 모서리 */
  left: number;
  top: number;
  /** 쟁반에 놓인 블록 한 칸의 크기(px) */
  trayCell: number;
  /** 쟁반 세 자리의 한가운데. 블록은 여기에 가운데를 맞춰 놓인다. */
  slots: { x: number; y: number }[];
  /** 쟁반 한 자리의 폭과 높이 */
  slotWidth: number;
  slotHeight: number;
  /** 쟁반 받침의 자리. 높이는 slotHeight와 같다. */
  tray: Area;
}

/**
 * 주어진 자리(HUD 아래)에 판과 쟁반을 놓는다. 좌표와 크기는 모두 정수다.
 * 판은 가로 폭이 허락하는 만큼 키우고, 높이가 모자라면 쟁반의 블록을 먼저 줄이고 그다음에 판의 칸을 줄인다.
 * 높이가 남으면 판과 쟁반 사이와 쟁반의 위아래를 넓히고, 나머지는 위아래로 나눠 가운데에 놓는다.
 */
export function layoutFor(area: Area): Layout {
  const heightWith = (cell: number, trayCell: number): number =>
    GAPS.top +
    cell * SIZE +
    BOARD_RIM * 2 +
    BOARD_LIP +
    GAPS.middle +
    trayCell * MAX_SPAN +
    MIN_TRAY_PAD * 2 +
    GAPS.bottom;

  let cell = Math.min(
    MAX_CELL,
    Math.floor((area.width - (SIDE_MARGIN + BOARD_RIM) * 2) / SIZE),
  );
  let trayCell = MAX_TRAY_CELL;
  while (trayCell > MIN_TRAY_CELL && heightWith(cell, trayCell) > area.height) trayCell -= 1;
  while (cell > MIN_CELL && heightWith(cell, trayCell) > area.height) cell -= 1;

  let spare = Math.max(0, area.height - heightWith(cell, trayCell));
  const trayPad = MIN_TRAY_PAD + Math.min(MAX_TRAY_PAD - MIN_TRAY_PAD, Math.floor(spare / 4));
  spare -= (trayPad - MIN_TRAY_PAD) * 2;
  const middle = GAPS.middle + Math.min(MAX_EXTRA_MIDDLE, Math.floor(spare / 4));
  spare -= middle - GAPS.middle;
  // 남은 높이는 위아래로 나눈다. 엄지가 닿기 쉽도록 쟁반이 조금 아래로 가게 위쪽을 더 비운다.
  const above = GAPS.top + Math.floor(spare * 0.55);

  const board = cell * SIZE;
  const top = Math.round(area.y + above + BOARD_RIM);
  const left = Math.round(area.x + (area.width - board) / 2);
  const slotHeight = trayCell * MAX_SPAN + trayPad * 2;
  const tray = {
    x: area.x + SIDE_MARGIN,
    y: top + board + BOARD_RIM + BOARD_LIP + middle,
    width: area.width - SIDE_MARGIN * 2,
    height: slotHeight,
  };
  const slotWidth = Math.floor((tray.width - TRAY_INSET * 2) / TRAY_SIZE);
  const slotsLeft = tray.x + (tray.width - slotWidth * TRAY_SIZE) / 2;
  const slots = Array.from({ length: TRAY_SIZE }, (_, slot) => ({
    x: Math.round(slotsLeft + slotWidth * (slot + 0.5)),
    y: Math.round(tray.y + slotHeight / 2),
  }));
  return { cell, left, top, trayCell, slots, slotWidth, slotHeight, tray };
}

/** 쟁반 받침의 위아래로 이만큼 벗어난 곳을 눌러도 쟁반을 누른 것으로 친다(px). */
export const TRAY_REACH = 6;

/**
 * (x, y)를 누르면 집게 되는 쟁반 자리의 번호. 쟁반을 벗어난 곳이면 -1이다.
 * 좌우로는 화면 끝까지 받아서, 받침의 가장자리를 눌러도 가장 가까운 자리의 블록이 집힌다.
 */
export function slotAt(layout: Layout, x: number, y: number): number {
  const { tray, slots, slotWidth } = layout;
  if (y < tray.y - TRAY_REACH || y > tray.y + tray.height + TRAY_REACH) return -1;
  const first = slots[0].x - slotWidth / 2;
  return Math.min(TRAY_SIZE - 1, Math.max(0, Math.floor((x - first) / slotWidth)));
}

/** 끌고 있는 블록의 아래 끝이 손가락보다 이만큼 위에 그려진다(px). 손가락이 블록을 가리지 않게 한다. */
export const DRAG_LIFT = 42;
/** 끌고 있는 블록은 화면 좌우 끝에서 적어도 이만큼 안쪽에 그려진다(px). */
export const DRAG_EDGE = 2;

/**
 * 손가락이 (x, y)에 있을 때 끌고 있는 블록의 한가운데가 놓이는 곳.
 * 가로는 손가락에 가운데를 맞추고, 세로는 블록의 아래 끝이 손가락보다 DRAG_LIFT만큼 위에 오게 한다.
 * 긴 블록을 화면 가장자리의 쟁반 자리에서 집어도 화면 밖으로 삐져나가지 않게, 가로는 화면 폭(width) 안으로 당긴다.
 * 판은 화면 좌우 끝보다 안쪽에 있으므로, 이렇게 당겨도 판의 어느 칸에나 놓을 수 있다.
 */
export function dragCenter(
  piece: Piece,
  cell: number,
  x: number,
  y: number,
  width: number,
): { x: number; y: number } {
  const half = (piece.width * cell) / 2;
  const reach = Math.max(0, width / 2 - half - DRAG_EDGE);
  return {
    x: Math.min(width / 2 + reach, Math.max(width / 2 - reach, x)),
    y: y - DRAG_LIFT - (piece.height * cell) / 2,
  };
}

/** 블록의 한가운데가 화면의 (x, y)에 있을 때, 블록의 왼쪽 위가 판의 칸 좌표로 어디인지(소수). */
export function boardCoords(
  layout: Layout,
  piece: Piece,
  x: number,
  y: number,
): { col: number; row: number } {
  return {
    col: (x - (piece.width * layout.cell) / 2 - layout.left) / layout.cell,
    row: (y - (piece.height * layout.cell) / 2 - layout.top) / layout.cell,
  };
}
