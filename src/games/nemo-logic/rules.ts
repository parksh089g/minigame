/**
 * 네모 로직의 규칙. 화면과 분리된 순수 함수라서 숫자만 바꿔 밸런스를 조정할 수 있다.
 * 판은 칸의 격자이고, 가로줄과 세로줄마다 숫자가 적혀 있다. 숫자는 그 줄에서 이어서 칠할 칸의 수이고,
 * 숫자가 여럿이면 적힌 차례대로, 사이를 한 칸 넘게 띄워서 칠한다. 숫자대로 다 칠하면 그림이 나온다.
 * 칸은 번호 하나로 적는다: row * cols + col, 왼쪽 위가 0번이다.
 * 무작위가 필요한 곳은 random(0 이상 1 미만의 수를 돌려주는 함수)을 받아서 쓴다.
 */
import { toLevel } from '../../core/stages';
import { paintedOf, PICTURES, type Picture } from './pictures';

export interface BoardSize {
  cols: number;
  rows: number;
}

/** 한 줄의 숫자. 칠할 칸이 없는 줄은 빈 목록이다(화면에는 0으로 적는다). */
export type Clue = readonly number[];

export interface Puzzle extends BoardSize {
  /** 칸마다 칠해야 하는 칸인지 */
  solution: readonly boolean[];
  rowClues: readonly Clue[];
  colClues: readonly Clue[];
}

// ───────── 줄과 숫자 ─────────

/** 칸 번호를 (col, row)로 바꾼다. */
export function cellOf(size: BoardSize, index: number): { col: number; row: number } {
  return { col: index % size.cols, row: Math.floor(index / size.cols) };
}

/** row번째 가로줄의 칸들. 왼쪽부터다. */
export function rowCells(size: BoardSize, row: number): number[] {
  return Array.from({ length: size.cols }, (_, col) => row * size.cols + col);
}

/** col번째 세로줄의 칸들. 위쪽부터다. */
export function colCells(size: BoardSize, col: number): number[] {
  return Array.from({ length: size.rows }, (_, row) => row * size.cols + col);
}

/** 한 줄에서 이어서 칠해진 칸의 수를 차례로 센다. */
export function clueOf(line: readonly boolean[]): number[] {
  const clue: number[] = [];
  let run = 0;
  for (const filled of line) {
    if (filled) run += 1;
    else if (run > 0) {
      clue.push(run);
      run = 0;
    }
  }
  if (run > 0) clue.push(run);
  return clue;
}

/** 칠해야 하는 칸들에서 줄마다의 숫자를 세어 판을 만든다. */
export function puzzleOf(size: BoardSize, solution: readonly boolean[]): Puzzle {
  const clue = (cells: readonly number[]): number[] => clueOf(cells.map((cell) => solution[cell]));
  return {
    cols: size.cols,
    rows: size.rows,
    solution,
    rowClues: Array.from({ length: size.rows }, (_, row) => clue(rowCells(size, row))),
    colClues: Array.from({ length: size.cols }, (_, col) => clue(colCells(size, col))),
  };
}

/** 가로줄과 세로줄 가운데 숫자가 가장 많이 적힌 줄의 숫자 수. 화면에서 숫자를 적을 자리를 잡을 때 쓴다. */
export function mostRuns(clues: readonly Clue[]): number {
  return Math.max(1, ...clues.map((clue) => clue.length));
}

// ───────── 풀이 ─────────

/**
 * 한 줄에 숫자대로 칠하는 모든 방법. 방법 하나는 비트 묶음이고, i번째 비트가 그 줄의 i번째 칸이다.
 * 줄이 길어야 열 칸이라 방법이 많아야 수십 가지다.
 */
function arrangementsOf(length: number, clue: Clue): number[] {
  const found: number[] = [];
  const place = (at: number, start: number, mask: number): void => {
    if (at === clue.length) {
      found.push(mask);
      return;
    }
    // 뒤에 남은 숫자들이 들어갈 자리는 남겨 둔다.
    let rest = 0;
    for (let later = at + 1; later < clue.length; later += 1) rest += clue[later] + 1;
    const run = clue[at];
    for (let from = start; from + run + rest <= length; from += 1) {
      place(at + 1, from + run + 1, mask | (((1 << run) - 1) << from));
    }
  };
  place(0, 0, 0);
  return found;
}

const arrangementCache = new Map<string, number[]>();

function arrangements(length: number, clue: Clue): number[] {
  const key = `${length}:${clue.join(',')}`;
  let found = arrangementCache.get(key);
  if (!found) {
    found = arrangementsOf(length, clue);
    arrangementCache.set(key, found);
  }
  return found;
}

/** 풀이가 칸마다 아는 것 */
export const UNKNOWN = 0;
export const FILLED = 1;
export const EMPTY = 2;

/**
 * 한 줄만 보고 알 수 있는 것을 찾는다. 지금까지 아는 칸과 어긋나지 않는 방법들을 모두 견줘서,
 * 어느 방법에서나 칠해지는 칸과 어느 방법에서도 칠해지지 않는 칸을 known에 적는다.
 * 새로 알게 된 칸의 수를 돌려준다. 맞는 방법이 하나도 없으면(아는 것이 틀렸으면) -1이다.
 */
function learnLine(clue: Clue, cells: readonly number[], known: number[]): number {
  let filled = 0;
  let empty = 0;
  cells.forEach((cell, bit) => {
    if (known[cell] === FILLED) filled |= 1 << bit;
    else if (known[cell] === EMPTY) empty |= 1 << bit;
  });

  let always = (1 << cells.length) - 1;
  let ever = 0;
  let fits = 0;
  for (const mask of arrangements(cells.length, clue)) {
    if ((mask & filled) !== filled || (mask & empty) !== 0) continue;
    always &= mask;
    ever |= mask;
    fits += 1;
  }
  if (fits === 0) return -1;

  let learned = 0;
  cells.forEach((cell, bit) => {
    if (known[cell] !== UNKNOWN) return;
    if ((always >> bit) & 1) known[cell] = FILLED;
    else if (!((ever >> bit) & 1)) known[cell] = EMPTY;
    else return;
    learned += 1;
  });
  return learned;
}

export interface Solving {
  /** 칸마다 알아낸 것: UNKNOWN, FILLED, EMPTY */
  known: number[];
  /** 모든 칸을 알아냈는지. true이면 숫자에 맞는 그림이 하나뿐이고, 찍지 않고 풀 수 있다. */
  solved: boolean;
  /** 모든 줄을 몇 바퀴 훑었는지. 많을수록 앞에서 알아낸 것을 딛고 더 멀리 따져야 하는 판이다. */
  sweeps: number;
  /** 첫 바퀴에서 알아낸 칸의 수. 적을수록 시작할 곳을 찾기 어렵다. */
  firstSweep: number;
}

/**
 * 한 줄씩 따져서 갈 수 있는 데까지 푼다. 사람이 푸는 방법과 같아서, 이것으로 다 풀리는 판은
 * 찍지 않고 풀 수 있고 답도 하나뿐이다. 찍어야 하는 판은 다 풀리지 않은 채로 돌아온다.
 */
export function solve(puzzle: Puzzle): Solving {
  const known = Array<number>(puzzle.cols * puzzle.rows).fill(UNKNOWN);
  const lines = [
    ...puzzle.rowClues.map((clue, row) => ({ clue, cells: rowCells(puzzle, row) })),
    ...puzzle.colClues.map((clue, col) => ({ clue, cells: colCells(puzzle, col) })),
  ];
  let sweeps = 0;
  let firstSweep = 0;
  for (;;) {
    let learned = 0;
    for (const line of lines) {
      const found = learnLine(line.clue, line.cells, known);
      if (found < 0) return { known, solved: false, sweeps, firstSweep };
      learned += found;
    }
    if (learned === 0) break;
    sweeps += 1;
    if (sweeps === 1) firstSweep = learned;
  }
  return { known, solved: known.every((mark) => mark !== UNKNOWN), sweeps, firstSweep };
}

/** 찍지 않고 한 줄씩 따져서 끝까지 풀 수 있는지. 풀리면 답도 하나뿐이다. */
export function isSolvable(puzzle: Puzzle): boolean {
  return solve(puzzle).solved;
}

/**
 * 판이 얼마나 어려운지를 수 하나로. 판이 클수록, 여러 바퀴를 돌아야 풀릴수록,
 * 처음에 바로 알 수 있는 칸이 적을수록 크다. 풀리지 않는 판은 견줄 수 없으므로 Infinity다.
 */
export function difficultyOf(puzzle: Puzzle): number {
  const { solved, sweeps, firstSweep } = solve(puzzle);
  if (!solved) return Number.POSITIVE_INFINITY;
  const cells = puzzle.cols * puzzle.rows;
  return cells + sweeps * 4 + (1 - firstSweep / cells) * 10;
}

// ───────── 판 만들기 (점수 도전) ─────────

export interface StageSpec extends BoardSize {
  /** 칠하는 칸의 비율. 높을수록 긴 숫자가 많아서 풀기 쉽다. */
  density: number;
}

/**
 * 점수 도전의 판마다의 크기. 5×5에서 시작해 8×10까지 간다.
 * 가장 큰 8×10은 가장 작은 화면(가로 240, 세로 400)에 한 칸 22px로 들어가는 크기다.
 * 뒤로 갈수록 판이 커지면서 칠하는 칸의 비율도 조금씩 낮아져서 따질 것이 늘어난다.
 */
const STAGES: readonly StageSpec[] = [
  { cols: 5, rows: 5, density: 0.66 },
  { cols: 5, rows: 5, density: 0.6 },
  { cols: 6, rows: 6, density: 0.62 },
  { cols: 6, rows: 7, density: 0.6 },
  { cols: 7, rows: 7, density: 0.6 },
  { cols: 7, rows: 8, density: 0.58 },
  { cols: 8, rows: 8, density: 0.58 },
  { cols: 8, rows: 9, density: 0.57 },
  { cols: 8, rows: 10, density: 0.56 },
];

/** 가장 큰 판의 크기. 화면에 맞는지 볼 때 쓴다. */
export const MAX_COLS = 8;
export const MAX_ROWS = 10;
/** 한 줄에 적는 숫자의 가장 많은 수. 이보다 많으면 숫자를 적을 자리가 판을 밀어내서 칸이 작아진다. */
export const MAX_RUNS = 4;

/** stage(1부터)번째 판의 크기. 마지막 뒤로는 같은 크기가 이어진다. */
export function stageSpec(stage: number): StageSpec {
  const index = Math.min(STAGES.length, Math.max(1, Math.floor(stage))) - 1;
  return STAGES[index];
}

/** 판 하나를 만들 때 다시 뿌려 보는 횟수의 상한 */
export const MAX_ATTEMPTS = 200;
/** 좌우가 같은 무늬로 만드는 비율. 좌우가 같으면 다 칠했을 때 무언가의 모습처럼 보인다. */
export const MIRROR_CHANCE = 0.5;

/** 칸을 무작위로 칠한다. 좌우가 같은 무늬는 왼쪽 절반을 뿌려서 오른쪽에 비춘다. */
export function scatter(spec: StageSpec, random: () => number): boolean[] {
  const { cols, rows, density } = spec;
  const mirrored = random() < MIRROR_CHANCE;
  const filled = Array<boolean>(cols * rows).fill(false);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < (mirrored ? Math.ceil(cols / 2) : cols); col += 1) {
      const fill = random() < density;
      filled[row * cols + col] = fill;
      if (mirrored) filled[row * cols + (cols - 1 - col)] = fill;
    }
  }
  return filled;
}

/** 빈 줄이 없고, 숫자가 너무 많이 적히는 줄도 없는지 */
function isTidy(puzzle: Puzzle): boolean {
  return [...puzzle.rowClues, ...puzzle.colClues].every((clue) => clue.length >= 1 && clue.length <= MAX_RUNS);
}

/**
 * 풀리지 않는 판을 풀리게 고친다: 따져서 알아내지 못한 빈칸을 하나씩 칠한다.
 * 칠할 때마다 칠한 칸이 하나 늘고, 모두 칠한 판은 어느 줄이나 숫자 하나로 다 칠해지므로 반드시 끝난다.
 */
function repair(size: BoardSize, filled: readonly boolean[]): Puzzle {
  const fixed = [...filled];
  for (;;) {
    const puzzle = puzzleOf(size, fixed);
    const { known, solved } = solve(puzzle);
    if (solved) return puzzle;
    const stuck = fixed.findIndex((fill, cell) => !fill && known[cell] === UNKNOWN);
    fixed[stuck >= 0 ? stuck : fixed.indexOf(false)] = true;
  }
}

/**
 * 찍지 않고 풀 수 있는 판을 하나 만든다. 무작위로 칠해 보고, 풀리는 것이 나올 때까지 다시 뿌린다.
 * 횟수를 다 쓰도록 나오지 않으면 마지막 것에서 막히는 칸을 칠해서 풀리게 만든다.
 */
export function makePuzzle(spec: StageSpec, random: () => number): Puzzle {
  let filled = scatter(spec, random);
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const puzzle = puzzleOf(spec, filled);
    if (isTidy(puzzle) && isSolvable(puzzle)) return puzzle;
    if (attempt < MAX_ATTEMPTS) filled = scatter(spec, random);
  }
  return repair(spec, filled);
}

// ───────── 칸의 상태 ─────────

/**
 * blank: 아직 손대지 않은 칸, filled: 맞게 칠한 칸,
 * marked: 칠하지 않을 칸이라고 X로 표시해 둔 칸(줄을 다 칠하면 남은 칸에도 저절로 표시된다),
 * crossed: 칠하면 안 되는데 칠하려다 틀린 칸. 빈칸인 것이 드러나서 다시 칠할 수 없다.
 */
export type Cell = 'blank' | 'filled' | 'marked' | 'crossed';

export interface Board extends Puzzle {
  cells: readonly Cell[];
  /** 다 칠하면 나오는 그림. 무작위로 만든 판에는 없다. */
  picture: Picture | null;
}

/** 그 줄에서 칠해야 하는 칸을 모두 칠했는지 */
function isLineDone(solution: readonly boolean[], cells: readonly Cell[], line: readonly number[]): boolean {
  return line.every((cell) => !solution[cell] || cells[cell] === 'filled');
}

/** row번째 가로줄을 다 칠했는지. 다 칠한 줄은 숫자가 흐려진다. */
export function isRowDone(board: Board, row: number): boolean {
  return isLineDone(board.solution, board.cells, rowCells(board, row));
}

/** col번째 세로줄을 다 칠했는지 */
export function isColDone(board: Board, col: number): boolean {
  return isLineDone(board.solution, board.cells, colCells(board, col));
}

/** 아무것도 칠하지 않은 판. 칠할 칸이 하나도 없는 줄은 처음부터 X로 표시해 둔다. */
export function freshBoard(puzzle: Puzzle, picture: Picture | null = null): Board {
  const cells = Array<Cell>(puzzle.cols * puzzle.rows).fill('blank');
  puzzle.rowClues.forEach((clue, row) => {
    if (clue.length === 0) for (const cell of rowCells(puzzle, row)) cells[cell] = 'marked';
  });
  puzzle.colClues.forEach((clue, col) => {
    if (clue.length === 0) for (const cell of colCells(puzzle, col)) cells[cell] = 'marked';
  });
  return { ...puzzle, cells, picture };
}

/** 칠해야 하는 칸을 모두 칠했는지 */
export function isCleared(board: Board): boolean {
  return board.solution.every((fill, cell) => !fill || board.cells[cell] === 'filled');
}

/** 아직 칠하지 않은, 칠해야 하는 칸의 수 */
export function cellsLeft(board: Board): number {
  return board.solution.filter((fill, cell) => fill && board.cells[cell] !== 'filled').length;
}

/**
 * 손가락을 from 칸에서 to 칸까지 끌었을 때 한 번에 칠하는 칸들. from부터 차례로 적는다.
 * 한 줄로만 칠한다: 더 멀리 간 쪽(가로나 세로)의 줄을 따라가고, 다른 쪽으로 벗어난 것은 무시한다.
 */
export function strokeCells(size: BoardSize, from: number, to: number): number[] {
  const start = cellOf(size, from);
  const end = cellOf(size, to);
  const across = Math.abs(end.col - start.col) >= Math.abs(end.row - start.row);
  const steps = across ? end.col - start.col : end.row - start.row;
  const stride = (across ? 1 : size.cols) * Math.sign(steps);
  return Array.from({ length: Math.abs(steps) + 1 }, (_, step) => from + step * stride);
}

// ───────── 화면 배치 ─────────

/** 한 칸의 가장 작은 크기(px). 손가락으로 한 칸을 골라 누를 수 있는 한계다. */
export const MIN_CELL = 22;
/** 한 칸의 가장 큰 크기(px). 작은 판이 화면을 꽉 채워 칸이 지나치게 커 보이지 않게 한다. */
export const MAX_CELL = 34;
/** 판 둘레에 비워 두는 여백(px). 흰 테두리와 그 아래 그림자가 들어간다. */
export const BOARD_MARGIN = { x: 8, y: 8 } as const;
/**
 * 화면 맨 아래에 칠하기·X 단추와 목숨을 두는 자리의 높이(px). 판은 이 위까지만 차지한다.
 * 단추가 판에 붙어 있으면 맨 아랫줄을 누르다 모드를 바꾸게 되므로 사이를 띄울 만큼 넉넉히 잡는다.
 */
export const CONTROLS_HEIGHT = 54;

export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 처음 몇 판은 판 위에 안내 글을 두는데, 그 자리의 높이와 그런 판의 수 */
export const HEADER_HEIGHT = 36;
export const HEADER_STAGES = 2;

/**
 * 판과 숫자가 놓일 자리. 위쪽 HUD(hudHeight) 아래부터 아래쪽 단추 줄 위까지이고,
 * 안내 글을 두는 판에서는 그만큼 더 내려와서 시작한다.
 */
export function boardArea(width: number, height: number, hudHeight: number, stage: number): Area {
  const header = stage <= HEADER_STAGES ? HEADER_HEIGHT : 0;
  return { x: 0, y: hudHeight + header, width, height: height - hudHeight - header - CONTROLS_HEIGHT };
}

export interface BoardLayout {
  /** 한 칸의 크기(px) */
  cell: number;
  /** 왼쪽 위 칸의 왼쪽 위 모서리 */
  left: number;
  top: number;
  /** 줄마다의 숫자의 글자 크기 */
  clueSize: number;
  /** 숫자 하나가 차지하는 폭(가로줄의 숫자들 사이)과 높이(세로줄의 숫자들 사이) */
  clueStep: { x: number; y: number };
  /** 판의 왼쪽과 위쪽에 숫자를 적는 자리의 크기 */
  clueWidth: number;
  clueHeight: number;
}

/** 칸 크기에 맞는 숫자의 글자 크기 */
function clueSizeFor(cell: number): number {
  return cell >= 30 ? 12 : cell >= 25 ? 11 : 10;
}

/** 칸 크기가 cell일 때 숫자를 적을 자리까지 더한 배치. 자리는 가장 숫자가 많은 줄에 맞춘다. */
function layoutWith(puzzle: Puzzle, cell: number): Omit<BoardLayout, 'left' | 'top'> {
  const clueSize = clueSizeFor(cell);
  const clueStep = { x: clueSize - 2, y: clueSize + 1 };
  return {
    cell,
    clueSize,
    clueStep,
    clueWidth: mostRuns(puzzle.rowClues) * clueStep.x + 6,
    clueHeight: mostRuns(puzzle.colClues) * clueStep.y + 4,
  };
}

/**
 * 주어진 자리에서 여백을 뺀 곳에, 줄마다의 숫자와 판이 함께 들어가는 가장 큰 칸 크기를 구한다.
 * 숫자를 적는 자리와 판을 한 덩어리로 보고 그 자리 한가운데에 놓는다. 칸 크기와 좌표는 정수다.
 * 아무리 줄여도 들어가지 않으면 가장 작은 칸으로 놓는다(그림을 그릴 때 들어가는 크기인지 테스트가 본다).
 */
export function boardLayout(puzzle: Puzzle, area: Area): BoardLayout {
  const width = area.width - BOARD_MARGIN.x * 2;
  const height = area.height - BOARD_MARGIN.y * 2;
  let fitted = layoutWith(puzzle, MIN_CELL);
  for (let cell = MAX_CELL; cell > MIN_CELL; cell -= 1) {
    const tried = layoutWith(puzzle, cell);
    if (tried.clueWidth + puzzle.cols * cell > width) continue;
    if (tried.clueHeight + puzzle.rows * cell > height) continue;
    fitted = tried;
    break;
  }
  const totalWidth = fitted.clueWidth + puzzle.cols * fitted.cell;
  const totalHeight = fitted.clueHeight + puzzle.rows * fitted.cell;
  return {
    ...fitted,
    left: Math.round(area.x + (area.width - totalWidth) / 2 + fitted.clueWidth),
    top: Math.round(area.y + (area.height - totalHeight) / 2 + fitted.clueHeight),
  };
}

/** 그 배치가 주어진 자리 안에 다 들어가는지 */
export function fitsArea(puzzle: Puzzle, layout: BoardLayout, area: Area): boolean {
  return (
    layout.left - layout.clueWidth >= area.x + BOARD_MARGIN.x - 0.5 &&
    layout.top - layout.clueHeight >= area.y + BOARD_MARGIN.y - 0.5 &&
    layout.left + puzzle.cols * layout.cell <= area.x + area.width - BOARD_MARGIN.x + 0.5 &&
    layout.top + puzzle.rows * layout.cell <= area.y + area.height - BOARD_MARGIN.y + 0.5
  );
}

// ───────── 목숨과 시간 ─────────

/** 처음의 목숨. 칠하면 안 되는 칸을 칠할 때마다 하나씩 줄고, 다 떨어지면 끝난다. */
export const START_HEARTS = 3;
/** 처음에 주어지는 시간(초). 판을 깨서 돌려받아도 이보다 많아지지는 않는다. */
export const TIME_BANK_SECONDS = 100;
/** 첫 판을 깼을 때 돌려받는 시간(초) */
export const FIRST_CLEAR_SECONDS = 30;
/** 판이 하나 오를 때마다 돌려받는 시간이 줄어드는 양(초) */
export const CLEAR_SECONDS_STEP = 2;
/** 아무리 뒤의 판이라도 이만큼은 돌려받는다(초) */
export const MIN_CLEAR_SECONDS = 14;

/**
 * stage번째 판을 깼을 때 돌려받는 시간(초).
 * 뒤로 갈수록 판은 커져서 오래 걸리는데 돌려받는 시간은 줄어든다. 가장 큰 판은 아무리 빨리 풀어도
 * MIN_CLEAR_SECONDS보다 오래 걸리므로, 한 판은 언젠가 끝난다.
 */
export function clearSeconds(stage: number): number {
  const level = Math.max(1, Math.floor(stage));
  return Math.max(MIN_CLEAR_SECONDS, FIRST_CLEAR_SECONDS - CLEAR_SECONDS_STEP * (level - 1));
}

// ───────── 점수 ─────────

/** 칸 하나를 맞게 칠했을 때의 점수 */
export const CELL_POINTS = 1;
/** 판을 깼을 때의 보너스: 판 번호에 이 값을 곱한다. */
export const CLEAR_POINTS_PER_STAGE = 10;
/** 한 번도 틀리지 않고 판을 깼을 때 더 주는 점수 */
export const FLAWLESS_POINTS = 5;

/** stage번째 판을 깼을 때의 보너스. 뒤의 판일수록 크고, 틀리지 않았으면 조금 더 준다. */
export function clearPoints(stage: number, flawless: boolean): number {
  const base = CLEAR_POINTS_PER_STAGE * Math.max(1, Math.floor(stage));
  return base + (flawless ? FLAWLESS_POINTS : 0);
}

// ───────── 한 판의 진행 ─────────

export interface RunState {
  /** 지금 판의 번호. 1부터 센다. 단계 모드에서는 단계 번호다. */
  stage: number;
  board: Board;
  /** 남은 목숨 */
  hearts: number;
  /** 남은 시간(초) */
  timeLeft: number;
  score: number;
  boardsCleared: number;
  /** 지금까지 맞게 칠한 칸의 수 */
  cellsFilled: number;
  /** 지금까지 틀린 횟수 */
  mistakes: number;
  /** 지금 판에서 아직 틀리지 않았는지 */
  flawless: boolean;
}

export interface ClearReward {
  points: number;
  /** 틀리지 않고 깨서 덤 점수가 들어 있는지 */
  flawless: boolean;
  /** 돌려받은 시간(초). 시간이 이미 가득하면 0일 수 있다. */
  seconds: number;
}

/** 누르면 칸을 칠하는 도구와 X로 표시하는 도구 */
export type Tool = 'fill' | 'mark';

export type PaintOutcome =
  /** 아무 일도 없다: 이미 정해진 칸만 지나갔거나, 이미 끝난 판 */
  | { kind: 'none' }
  | {
      kind: 'marked';
      /** 새로 X로 표시한 칸들과, 표시를 지운 칸들. 한 번에는 둘 가운데 한쪽만 있다. */
      marked: number[];
      unmarked: number[];
    }
  | {
      kind: 'filled';
      /** 맞게 칠한 칸들(지나간 순서)과 그 점수 */
      filled: number[];
      points: number;
      /** 칠하면 안 되는 칸을 칠하려 했으면 그 칸. 목숨이 하나 줄었고, 거기서 멈췄다. */
      missed: number | null;
      /** 이번에 다 칠한 가로줄과 세로줄 */
      rowsDone: number[];
      colsDone: number[];
      /** 다 칠한 줄에 남아 있어서 저절로 X로 표시된 칸들 */
      autoMarked: number[];
      /** 판을 깼으면 그 보상 */
      cleared: ClearReward | null;
    };

function startRun(stage: number, board: Board): RunState {
  return {
    stage,
    board,
    hearts: START_HEARTS,
    timeLeft: TIME_BANK_SECONDS,
    score: 0,
    boardsCleared: 0,
    cellsFilled: 0,
    mistakes: 0,
    flawless: true,
  };
}

/** 점수 도전의 첫 판 */
export function newRun(random: () => number): RunState {
  return startRun(1, freshBoard(makePuzzle(stageSpec(1), random)));
}

/**
 * 지나간 칸들에 도구를 쓴다. path는 손가락이 지나간 칸들이다(strokeCells).
 * 칠하기: 빈칸만 칠하고, X로 표시해 둔 칸과 이미 정해진 칸은 건너뛴다. 칠하면 안 되는 칸을 만나면
 *         목숨을 하나 잃고 거기서 멈춘다. 줄을 다 칠하면 그 줄에 남은 빈칸에 저절로 X가 표시된다.
 * X 표시: 처음 지나간 칸이 빈칸이면 지나간 빈칸을 모두 표시하고, 표시된 칸이면 지나간 표시를 모두 지운다.
 * 받은 상태는 바꾸지 않고 새 상태를 돌려준다.
 */
export function paint(
  run: RunState,
  path: readonly number[],
  tool: Tool,
): { run: RunState; outcome: PaintOutcome } {
  if (isOver(run) || isCleared(run.board)) return { run, outcome: { kind: 'none' } };
  return tool === 'mark' ? markCells(run, path) : fillCells(run, path);
}

function markCells(run: RunState, path: readonly number[]): { run: RunState; outcome: PaintOutcome } {
  const cells = [...run.board.cells];
  const first = path.find((cell) => cells[cell] === 'blank' || cells[cell] === 'marked');
  if (first === undefined) return { run, outcome: { kind: 'none' } };

  const from: Cell = cells[first];
  const to: Cell = from === 'blank' ? 'marked' : 'blank';
  const changed = path.filter((cell, at) => cells[cell] === from && path.indexOf(cell) === at);
  for (const cell of changed) cells[cell] = to;
  return {
    run: { ...run, board: { ...run.board, cells } },
    outcome: {
      kind: 'marked',
      marked: to === 'marked' ? changed : [],
      unmarked: to === 'blank' ? changed : [],
    },
  };
}

function fillCells(run: RunState, path: readonly number[]): { run: RunState; outcome: PaintOutcome } {
  const { board } = run;
  const cells = [...board.cells];
  const filled: number[] = [];
  let missed: number | null = null;
  let left = cellsLeft(board);
  for (const cell of path) {
    // 마지막 칸을 칠했으면 그 뒤로 지나간 칸은 보지 않는다.
    if (left === 0) break;
    if (cells[cell] !== 'blank') continue;
    if (!board.solution[cell]) {
      cells[cell] = 'crossed';
      missed = cell;
      break;
    }
    cells[cell] = 'filled';
    filled.push(cell);
    left -= 1;
  }
  if (filled.length === 0 && missed === null) return { run, outcome: { kind: 'none' } };

  // 이번에 칠한 칸이 지나는 줄 가운데 다 칠해진 줄을 찾고, 그 줄에 남은 빈칸을 X로 표시한다.
  const rows = [...new Set(filled.map((cell) => cellOf(board, cell).row))];
  const cols = [...new Set(filled.map((cell) => cellOf(board, cell).col))];
  const rowsDone = rows.filter((row) => isLineDone(board.solution, cells, rowCells(board, row)));
  const colsDone = cols.filter((col) => isLineDone(board.solution, cells, colCells(board, col)));
  const autoMarked: number[] = [];
  const doneLines = [
    ...rowsDone.map((row) => rowCells(board, row)),
    ...colsDone.map((col) => colCells(board, col)),
  ];
  for (const line of doneLines) {
    for (const cell of line) {
      if (cells[cell] !== 'blank') continue;
      cells[cell] = 'marked';
      autoMarked.push(cell);
    }
  }

  const points = filled.length * CELL_POINTS;
  const next: RunState = {
    ...run,
    board: { ...board, cells },
    hearts: Math.max(0, run.hearts - (missed === null ? 0 : 1)),
    score: run.score + points,
    cellsFilled: run.cellsFilled + filled.length,
    mistakes: run.mistakes + (missed === null ? 0 : 1),
    flawless: run.flawless && missed === null,
  };
  const outcome = { kind: 'filled', filled, points, missed, rowsDone, colsDone, autoMarked } as const;
  if (left > 0) return { run: next, outcome: { ...outcome, cleared: null } };

  const timeLeft = Math.min(TIME_BANK_SECONDS, run.timeLeft + clearSeconds(run.stage));
  const cleared: ClearReward = {
    points: clearPoints(run.stage, next.flawless),
    flawless: next.flawless,
    seconds: timeLeft - run.timeLeft,
  };
  return {
    run: { ...next, timeLeft, score: next.score + cleared.points, boardsCleared: run.boardsCleared + 1 },
    outcome: { ...outcome, cleared },
  };
}

/** 시간이 흐른다. 0 아래로는 내려가지 않는다. */
export function elapse(run: RunState, seconds: number): RunState {
  return { ...run, timeLeft: Math.max(0, run.timeLeft - Math.max(0, seconds)) };
}

/** 목숨이 다했거나 시간이 다 되어 끝났는지 */
export function isOver(run: RunState): boolean {
  return run.hearts <= 0 || run.timeLeft <= 0;
}

/** 다음 판으로 넘어간다. 판을 깬 뒤에 부른다. */
export function nextStage(run: RunState, random: () => number): RunState {
  const stage = run.stage + 1;
  return { ...run, stage, board: freshBoard(makePuzzle(stageSpec(stage), random)), flawless: true };
}

// ───────── 단계 모드 ─────────

/**
 * 단계 모드의 level(1부터)번째 단계에서 그리는 그림. 단계마다 그림이 하나씩 정해져 있고,
 * 작은 그림부터 큰 그림으로, 같은 크기에서는 쉬운 것부터 어려운 것으로 놓여 있다(pictures.ts).
 */
export function levelPicture(level: number): Picture {
  return PICTURES[Math.min(PICTURES.length, toLevel(level)) - 1];
}

/** 그림에서 판을 만든다. */
export function picturePuzzle(picture: Picture): Puzzle {
  const rows = picture.rows.length;
  const cols = picture.rows[0].length;
  return puzzleOf({ cols, rows }, paintedOf(picture));
}

/**
 * 단계 모드의 한 단계. 시간은 흐르지 않고(elapse를 부르지 않는다), 그림 하나를 다 칠하면 끝난다.
 * 목숨은 단계마다 새로 받는다.
 */
export function levelRun(level: number): RunState {
  const picture = levelPicture(level);
  return startRun(toLevel(level), freshBoard(picturePuzzle(picture), picture));
}
