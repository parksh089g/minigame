/**
 * 논리 타일의 규칙. 화면과 분리된 순수 함수라서 숫자만 바꿔 밸런스를 조정할 수 있다.
 * 판은 풀로 덮인 칸의 격자이고, 그 가운데 몇 칸에 함정이 숨어 있다. 안전한 칸을 열면
 * 둘레 여덟 칸에 숨은 함정의 수가 보인다. 함정에는 깃발을 꽂고 나머지를 모두 열면 판을 깬다.
 * 칸은 번호 하나로 적는다: row * cols + col, 왼쪽 위가 0번이다.
 * 무작위가 필요한 곳은 random(0 이상 1 미만의 수를 돌려주는 함수)을 받아서 쓴다.
 */
import { difficultyOf } from '../../core/stages';

export interface BoardSize {
  cols: number;
  rows: number;
}

/** covered: 덮인 칸, open: 열린 칸, marked: 깃발을 꽂은 칸, tripped: 밟아서 드러난 함정 */
export type Tile = 'covered' | 'open' | 'marked' | 'tripped';

export interface Board extends BoardSize {
  /** 이 판에 숨은 함정의 수 */
  trapCount: number;
  /** 칸마다 함정인지. 첫 칸을 열 때 정해지므로 그 전에는 null이다. */
  traps: readonly boolean[] | null;
  /** 칸마다 둘레 여덟 칸에 있는 함정의 수. 함정이 놓이기 전에는 모두 0이다. */
  counts: readonly number[];
  tiles: readonly Tile[];
}

// ───────── 칸과 둘레 ─────────

/** 칸 번호를 (col, row)로 바꾼다. */
export function cellOf(size: BoardSize, index: number): { col: number; row: number } {
  return { col: index % size.cols, row: Math.floor(index / size.cols) };
}

/** 둘레 여덟 칸의 번호. 가장자리에서는 판 안에 있는 칸만 돌려준다. */
export function neighboursOf(size: BoardSize, index: number): number[] {
  const { col, row } = cellOf(size, index);
  const around: number[] = [];
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      const c = col + dc;
      const r = row + dr;
      const self = dc === 0 && dr === 0;
      if (!self && c >= 0 && c < size.cols && r >= 0 && r < size.rows) around.push(r * size.cols + c);
    }
  }
  return around;
}

/** 모든 칸의 둘레를 한 번에 구해 둔다. 판을 여러 번 훑는 풀이와 판 만들기에서 쓴다. */
function allNeighbours(size: BoardSize): number[][] {
  return Array.from({ length: size.cols * size.rows }, (_, index) => neighboursOf(size, index));
}

/** 칸마다 둘레에 있는 함정의 수 */
export function countsOf(size: BoardSize, traps: readonly boolean[]): number[] {
  return allNeighbours(size).map((around) => around.filter((cell) => traps[cell]).length);
}

// ───────── 판 ─────────

/** 아직 아무것도 열지 않은 판. 함정은 첫 칸을 열 때 놓인다. */
export function emptyBoard(size: BoardSize, trapCount: number): Board {
  const cells = size.cols * size.rows;
  return {
    cols: size.cols,
    rows: size.rows,
    trapCount,
    traps: null,
    counts: Array<number>(cells).fill(0),
    tiles: Array<Tile>(cells).fill('covered'),
  };
}

/** 판에 함정을 놓는다. 깃발과 열린 칸은 그대로 둔다. */
export function withTraps(board: Board, traps: readonly boolean[]): Board {
  return {
    ...board,
    traps,
    counts: countsOf(board, traps),
    trapCount: traps.filter(Boolean).length,
  };
}

export interface Reveal {
  board: Board;
  /** 이번에 열린 안전한 칸들. 누른 칸에서 퍼져 나간 순서다. */
  opened: number[];
  /** 이번에 밟은 함정들 */
  tripped: number[];
}

/**
 * 덮인 칸들을 차례로 연다. 안전한 칸은 열리고, 둘레에 함정이 없는 칸(0)은 둘레도 이어서 연다.
 * 함정이면 밟은 것으로 드러난다. 깃발을 꽂은 칸은 저절로 열리지 않는다.
 */
export function openTiles(board: Board, targets: readonly number[]): Reveal {
  const traps = board.traps;
  if (!traps) return { board, opened: [], tripped: [] };
  const tiles = [...board.tiles];
  const opened: number[] = [];
  const tripped: number[] = [];

  for (const target of targets) {
    if (tiles[target] !== 'covered') continue;
    if (traps[target]) {
      tiles[target] = 'tripped';
      tripped.push(target);
      continue;
    }
    tiles[target] = 'open';
    const queue = [target];
    for (let head = 0; head < queue.length; head += 1) {
      const cell = queue[head];
      opened.push(cell);
      if (board.counts[cell] !== 0) continue;
      for (const next of neighboursOf(board, cell)) {
        if (tiles[next] !== 'covered') continue;
        tiles[next] = 'open';
        queue.push(next);
      }
    }
  }
  return { board: { ...board, tiles }, opened, tripped };
}

/** 깃발이 꽂혔거나 밟아서 드러난 칸인지. 둘 다 "함정으로 표시된 칸"으로 센다. */
function isFlagged(tile: Tile): boolean {
  return tile === 'marked' || tile === 'tripped';
}

/**
 * 열린 숫자를 눌렀을 때 한꺼번에 열 칸들.
 * 둘레에 표시된 칸의 수가 숫자와 같을 때만 나머지 덮인 둘레 칸을 돌려주고, 아니면 빈 목록이다.
 */
export function chordTargets(board: Board, index: number): number[] {
  if (board.tiles[index] !== 'open' || board.counts[index] === 0) return [];
  const around = neighboursOf(board, index);
  const flagged = around.filter((cell) => isFlagged(board.tiles[cell])).length;
  if (flagged !== board.counts[index]) return [];
  return around.filter((cell) => board.tiles[cell] === 'covered');
}

/** 덮인 칸에 깃발을 꽂거나, 꽂힌 깃발을 뽑는다. 열린 칸과 드러난 함정은 그대로다. */
export function toggleMark(board: Board, index: number): Board {
  const tile = board.tiles[index];
  if (tile !== 'covered' && tile !== 'marked') return board;
  const tiles = [...board.tiles];
  tiles[index] = tile === 'covered' ? 'marked' : 'covered';
  return { ...board, tiles };
}

/** 안전한 칸을 모두 열었는지. 깃발을 다 꽂았는지는 따지지 않는다. */
export function isCleared(board: Board): boolean {
  const traps = board.traps;
  if (!traps) return false;
  return board.tiles.every((tile, index) => traps[index] || tile === 'open');
}

/** 아직 표시하지 않은 함정의 수. 깃발을 너무 많이 꽂아도 0 아래로는 내려가지 않는다. */
export function trapsLeft(board: Board): number {
  return Math.max(0, board.trapCount - board.tiles.filter(isFlagged).length);
}

/** 판을 깼을 때 남은 함정에 깃발을 마저 꽂아 준다. */
function markAllTraps(board: Board): Board {
  const traps = board.traps;
  if (!traps) return board;
  const tiles = board.tiles.map((tile, index) => (traps[index] && tile === 'covered' ? 'marked' : tile));
  return { ...board, tiles };
}

// ───────── 풀이 ─────────

/**
 * 풀이에 쓰는 추론의 수준.
 * counting: 숫자 하나만 보고 센다. 남은 함정이 0이면 둘레가 모두 안전하고,
 *           남은 함정이 모르는 칸의 수와 같으면 둘레가 모두 함정이다.
 * subset:   거기에 두 숫자를 견주는 규칙을 더한다. 한 숫자의 모르는 칸이 다른 숫자의 모르는 칸에
 *           모두 들어 있으면, 남는 칸들에는 두 숫자의 차이만큼 함정이 있다.
 */
export type Logic = 'counting' | 'subset';

const UNKNOWN = 0;
const SAFE = 1;
const TRAP = 2;

/** 열린 숫자 하나가 말해 주는 것: 아직 모르는 둘레 칸들과 그 가운데 함정의 수 */
interface Clue {
  cells: number[];
  traps: number;
}

function cluesOf(
  around: readonly number[][],
  counts: readonly number[],
  open: readonly boolean[],
  known: readonly number[],
): Clue[] {
  const clues: Clue[] = [];
  for (let index = 0; index < open.length; index += 1) {
    if (!open[index] || counts[index] === 0) continue;
    const cells = around[index].filter((cell) => !open[cell] && known[cell] === UNKNOWN);
    if (cells.length === 0) continue;
    const found = around[index].filter((cell) => known[cell] === TRAP).length;
    clues.push({ cells, traps: counts[index] - found });
  }
  return clues;
}

/**
 * 보이는 숫자를 한 바퀴 훑어서 새로 알게 된 칸을 known에 적고, 그 수를 돌려준다.
 * 쉬운 규칙(하나만 보고 세기)으로 알아낸 것이 있으면 거기서 멈추고,
 * 없을 때만 두 숫자를 견준다. 사람이 푸는 순서와 같다.
 */
function learn(
  around: readonly number[][],
  counts: readonly number[],
  open: readonly boolean[],
  known: number[],
  logic: Logic,
): number {
  const clues = cluesOf(around, counts, open, known);
  let learned = 0;
  const note = (cells: readonly number[], value: number): void => {
    for (const cell of cells) {
      if (known[cell] !== UNKNOWN) continue;
      known[cell] = value;
      learned += 1;
    }
  };

  for (const clue of clues) {
    if (clue.traps === 0) note(clue.cells, SAFE);
    else if (clue.traps === clue.cells.length) note(clue.cells, TRAP);
  }
  if (learned > 0 || logic === 'counting') return learned;

  // 같은 칸을 보는 숫자끼리만 견주면 된다.
  const watchers = new Map<number, Clue[]>();
  for (const clue of clues) {
    for (const cell of clue.cells) watchers.set(cell, [...(watchers.get(cell) ?? []), clue]);
  }
  for (const inner of clues) {
    for (const outer of watchers.get(inner.cells[0]) ?? []) {
      if (outer.cells.length <= inner.cells.length) continue;
      if (!inner.cells.every((cell) => outer.cells.includes(cell))) continue;
      const rest = outer.cells.filter((cell) => !inner.cells.includes(cell));
      const extra = outer.traps - inner.traps;
      if (extra === 0) note(rest, SAFE);
      else if (extra === rest.length) note(rest, TRAP);
    }
  }
  return learned;
}

export interface Deduction {
  /** 열어도 되는 것이 확실한 덮인 칸들 */
  safe: number[];
  /** 함정인 것이 확실한 덮인 칸들 */
  traps: number[];
}

/**
 * 지금 보이는 숫자만으로 확실히 알 수 있는 칸을 모두 찾는다. 더 열어 보지는 않는다.
 * 플레이어가 꽂은 깃발은 믿지 않고(틀렸을 수 있다), 밟아서 드러난 함정만 아는 것으로 친다.
 */
export function deduce(board: Board, logic: Logic = 'subset'): Deduction {
  const around = allNeighbours(board);
  const open = board.tiles.map((tile) => tile === 'open');
  const known = board.tiles.map((tile) => (tile === 'tripped' ? TRAP : UNKNOWN));
  while (learn(around, board.counts, open, known, logic) > 0);

  // 밟아서 이미 드러난 함정은 새로 알아낸 것이 아니므로 뺀다.
  const learned = (value: number): number[] =>
    known.flatMap((mark, cell) => (mark === value && board.tiles[cell] !== 'tripped' ? [cell] : []));
  return { safe: learned(SAFE), traps: learned(TRAP) };
}

interface Exploration {
  /** 추론만으로 열 수 있었던 칸 */
  open: boolean[];
  /** 덮인 칸에 대해 알아낸 것 */
  known: number[];
  /** 안전한 칸을 모두 열었는지 */
  cleared: boolean;
}

/**
 * first 칸을 열고, 추론으로 안전하다고 알게 된 칸을 계속 열어 나가며 갈 수 있는 데까지 간다.
 * 함정을 놓을 때 한 판에 수백 번까지 부르므로, 판을 매번 새로 만들지 않고 배열 두 개만 고쳐 쓴다.
 */
function explore(size: BoardSize, traps: readonly boolean[], first: number, logic: Logic): Exploration {
  const around = allNeighbours(size);
  const counts = countsOf(size, traps);
  const open = traps.map(() => false);
  const known = traps.map(() => UNKNOWN);

  // 안전한 칸 하나를 열고, 0이면 둘레로 퍼져 나간다.
  const spread = (start: number): void => {
    if (open[start]) return;
    open[start] = true;
    const queue = [start];
    for (let head = 0; head < queue.length; head += 1) {
      if (counts[queue[head]] !== 0) continue;
      for (const next of around[queue[head]]) {
        if (open[next]) continue;
        open[next] = true;
        queue.push(next);
      }
    }
  };

  if (!traps[first]) spread(first);
  while (learn(around, counts, open, known, logic) > 0) {
    known.forEach((mark, cell) => {
      if (mark === SAFE) spread(cell);
    });
  }
  return { open, known, cleared: open.every((isOpen, cell) => isOpen || traps[cell]) };
}

/** first 칸에서 시작해 찍지 않고 추론만으로 판을 깰 수 있는지 */
export function isSolvable(
  size: BoardSize,
  traps: readonly boolean[],
  first: number,
  logic: Logic = 'subset',
): boolean {
  return explore(size, traps, first, logic).cleared;
}

// ───────── 판마다의 크기 ─────────

export interface StageSpec extends BoardSize {
  /** 숨기는 함정의 수 */
  traps: number;
  /** 이 판을 푸는 데 필요할 수 있는 가장 어려운 추론 */
  logic: Logic;
}

/**
 * 판마다의 크기와 함정 수. 6×6에 함정 5개(약 14%)로 시작해 8×10에 18개(약 23%)까지 간다.
 * 처음 두 판은 숫자 하나만 보고 세어도 풀리는 판만 나오고, 그 뒤로는 두 숫자를 견줘야 하는 판도 나온다.
 * 가장 큰 8×10은 가장 작은 화면(가로 240, 세로 400)에 한 칸 27px로 들어가는 크기다.
 */
const STAGES: readonly StageSpec[] = [
  { cols: 6, rows: 6, traps: 5, logic: 'counting' },
  { cols: 6, rows: 7, traps: 7, logic: 'counting' },
  { cols: 7, rows: 7, traps: 8, logic: 'subset' },
  { cols: 7, rows: 8, traps: 10, logic: 'subset' },
  { cols: 7, rows: 9, traps: 12, logic: 'subset' },
  { cols: 8, rows: 9, traps: 14, logic: 'subset' },
  { cols: 8, rows: 10, traps: 16, logic: 'subset' },
  { cols: 8, rows: 10, traps: 18, logic: 'subset' },
];

/** 가장 큰 판의 크기. 화면에 맞는지 볼 때 쓴다. */
export const MAX_COLS = Math.max(...STAGES.map((spec) => spec.cols));
export const MAX_ROWS = Math.max(...STAGES.map((spec) => spec.rows));

/** stage(1부터)번째 판의 크기. 마지막 단계 뒤로는 같은 판이 이어진다. */
export function stageSpec(stage: number): StageSpec {
  const index = Math.min(STAGES.length, Math.max(1, Math.floor(stage))) - 1;
  return STAGES[index];
}

// ───────── 함정 놓기 ─────────

/**
 * 한 판의 함정을 놓을 때 다시 뿌려 보는 횟수의 상한.
 * 가장 빽빽한 판에서 모서리를 처음 눌러도 열다섯 번에 한 번쯤은 추론만으로 풀리는 배치가 나오므로,
 * 이 횟수를 다 쓰는 일은 거의 없다.
 */
export const MAX_ATTEMPTS = 300;

/**
 * 함정 count개를 무작위로 뿌린다. 처음 누른 칸과 그 둘레에는 놓지 않아서,
 * 첫 칸은 언제나 0이고 열자마자 주변이 넓게 열린다.
 */
export function scatterTraps(
  size: BoardSize,
  count: number,
  first: number,
  random: () => number,
): boolean[] {
  const cells = size.cols * size.rows;
  const keepOut = new Set([first, ...neighboursOf(size, first)]);
  const pool: number[] = [];
  for (let cell = 0; cell < cells; cell += 1) {
    if (!keepOut.has(cell)) pool.push(cell);
  }

  const traps = Array<boolean>(cells).fill(false);
  const wanted = Math.min(Math.max(0, Math.floor(count)), pool.length);
  for (let placed = 0; placed < wanted; placed += 1) {
    const span = pool.length - placed;
    const pick = placed + Math.min(span - 1, Math.floor(random() * span));
    [pool[placed], pool[pick]] = [pool[pick], pool[placed]];
    traps[pool[placed]] = true;
  }
  return traps;
}

/**
 * 추론으로 풀리지 않는 배치를 풀리게 고친다: 막힌 곳의 함정을 하나씩 치운다.
 * 치울 때마다 함정이 하나 줄고, 함정이 하나도 없으면 첫 칸에서 판이 다 열리므로 반드시 끝난다.
 */
function repair(size: BoardSize, traps: readonly boolean[], first: number, logic: Logic): boolean[] {
  const around = allNeighbours(size);
  const fixed = [...traps];
  for (;;) {
    const { open, known, cleared } = explore(size, fixed, first, logic);
    if (cleared) return fixed;
    const hidden = fixed.flatMap((isTrap, cell) => (isTrap && known[cell] !== TRAP ? [cell] : []));
    // 아직 알아내지 못한 함정 가운데 열린 칸과 맞닿은 것을 먼저 치운다. 그런 함정이 없으면
    // 알아낸 함정들에 둘러싸여 닿을 수 없는 칸이 남은 것이므로, 그 칸을 가둔 함정을 치운다.
    // 어느 쪽에도 들지 않으면 아무 함정이나 치운다. 무엇을 고르든 함정은 한 번에 하나씩 줄어든다.
    const walls = fixed.flatMap((isTrap, cell) =>
      isTrap && around[cell].some((next) => !open[next] && !fixed[next]) ? [cell] : [],
    );
    const blocker =
      hidden.find((cell) => around[cell].some((next) => open[next])) ??
      hidden[0] ??
      walls[0] ??
      fixed.indexOf(true);
    fixed[blocker] = false;
  }
}

/**
 * 첫 칸을 연 뒤에 함정을 놓는다. 첫 칸과 그 둘레를 피해서 뿌리고, 거기서부터 찍지 않고
 * 추론만으로 풀리는 배치가 나올 때까지 다시 뿌린다.
 * 횟수를 다 쓰도록 나오지 않으면 마지막 배치에서 막히는 함정을 치워서 풀리게 만든다.
 * 그때는 함정이 spec.traps보다 적을 수 있다.
 */
export function layTraps(spec: StageSpec, first: number, random: () => number): boolean[] {
  let traps = scatterTraps(spec, spec.traps, first, random);
  for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (isSolvable(spec, traps, first, spec.logic)) return traps;
    traps = scatterTraps(spec, spec.traps, first, random);
  }
  return repair(spec, traps, first, spec.logic);
}

// ───────── 화면 배치 ─────────

/** 한 칸의 가장 작은 크기(px). 손가락으로 한 칸을 골라 누를 수 있는 한계다. */
export const MIN_CELL = 26;
/** 한 칸의 가장 큰 크기(px). 작은 판이 화면을 꽉 채워 칸이 지나치게 커 보이지 않게 한다. */
export const MAX_CELL = 34;
/** 판 둘레에 비워 두는 여백(px). 흰 테두리와 그 아래 그림자가 들어간다. */
export const BOARD_MARGIN = { x: 10, y: 8 } as const;
/**
 * 화면 맨 아래에 열기·깃발 단추와 목숨을 두는 자리의 높이(px). 판은 이 위까지만 차지한다.
 * 단추가 판에 붙어 있으면 맨 아랫줄을 누르다 모드를 바꾸게 되므로 사이를 띄울 만큼 넉넉히 잡는다.
 */
export const CONTROLS_HEIGHT = 54;

export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BoardLayout {
  /** 한 칸의 크기(px) */
  cell: number;
  /** 왼쪽 위 칸의 왼쪽 위 모서리 */
  left: number;
  top: number;
}

/**
 * 주어진 자리에서 여백을 뺀 곳에 들어가는 가장 큰 칸 크기를 구하고, 판을 그 자리 한가운데에 놓는다.
 * 칸 크기와 좌표는 정수다.
 */
export function boardLayout(size: BoardSize, area: Area): BoardLayout {
  const cell = Math.min(
    MAX_CELL,
    Math.floor((area.width - BOARD_MARGIN.x * 2) / size.cols),
    Math.floor((area.height - BOARD_MARGIN.y * 2) / size.rows),
  );
  return {
    cell,
    left: Math.round(area.x + (area.width - size.cols * cell) / 2),
    top: Math.round(area.y + (area.height - size.rows * cell) / 2),
  };
}

// ───────── 목숨과 시간 ─────────

/** 처음의 목숨. 함정을 밟을 때마다 하나씩 줄고, 다 떨어지면 끝난다. */
export const START_HEARTS = 3;
/** 처음에 주어지는 시간(초). 판을 깨서 돌려받아도 이보다 많아지지는 않는다. */
export const TIME_BANK_SECONDS = 80;
/** 첫 판을 깼을 때 돌려받는 시간(초) */
export const FIRST_CLEAR_SECONDS = 28;
/** 판이 하나 오를 때마다 돌려받는 시간이 줄어드는 양(초) */
export const CLEAR_SECONDS_STEP = 3;
/** 아무리 뒤의 판이라도 이만큼은 돌려받는다(초) */
export const MIN_CLEAR_SECONDS = 10;

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

/** 안전한 칸 하나를 열었을 때의 점수. 한꺼번에 퍼져서 열린 칸도 하나하나 센다. */
export const TILE_POINTS = 1;
/** 판을 깼을 때의 보너스: 판 번호에 이 값을 곱한다. */
export const CLEAR_POINTS_PER_STAGE = 10;
/** 함정을 한 번도 밟지 않고 판을 깼을 때 더 주는 점수 */
export const FLAWLESS_POINTS = 5;

/** stage번째 판을 깼을 때의 보너스. 뒤의 판일수록 크고, 함정을 밟지 않았으면 조금 더 준다. */
export function clearPoints(stage: number, flawless: boolean): number {
  const base = CLEAR_POINTS_PER_STAGE * Math.max(1, Math.floor(stage));
  return base + (flawless ? FLAWLESS_POINTS : 0);
}

// ───────── 한 판의 진행 ─────────

export interface RunState {
  /** 지금 판의 번호. 1부터 센다. */
  stage: number;
  board: Board;
  /** 남은 목숨 */
  hearts: number;
  /** 남은 시간(초) */
  timeLeft: number;
  score: number;
  boardsCleared: number;
  /** 지금까지 연 안전한 칸의 수 */
  tilesOpened: number;
  /** 지금까지 밟은 함정의 수 */
  trapsTripped: number;
  /** 지금 판에서 아직 함정을 밟지 않았는지 */
  flawless: boolean;
}

export interface ClearReward {
  points: number;
  /** 함정을 밟지 않고 깨서 덤 점수가 들어 있는지 */
  flawless: boolean;
  /** 돌려받은 시간(초). 시간이 이미 가득하면 0일 수 있다. */
  seconds: number;
}

export type TapOutcome =
  /** 아무 일도 없다: 깃발이 꽂힌 칸, 깃발 수가 맞지 않는 숫자, 이미 끝난 판 */
  | { kind: 'none' }
  | {
      kind: 'opened';
      /** 열린 안전한 칸들(퍼져 나간 순서)과 그 점수 */
      opened: number[];
      points: number;
      /** 밟은 함정들. 하나마다 목숨이 하나 줄었다. */
      tripped: number[];
      /** 이 판의 첫 칸이어서 이때 함정이 놓였는지 */
      first: boolean;
      /** 열린 숫자를 눌러 둘레를 한꺼번에 연 것인지 */
      chord: boolean;
      /** 판을 깼으면 그 보상 */
      cleared: ClearReward | null;
    };

function freshBoard(stage: number): Board {
  const spec = stageSpec(stage);
  return emptyBoard(spec, spec.traps);
}

export function newRun(): RunState {
  return {
    stage: 1,
    board: freshBoard(1),
    hearts: START_HEARTS,
    timeLeft: TIME_BANK_SECONDS,
    score: 0,
    boardsCleared: 0,
    tilesOpened: 0,
    trapsTripped: 0,
    flawless: true,
  };
}

/**
 * index 칸을 눌렀을 때. 덮인 칸이면 열고, 열린 숫자이면 둘레의 깃발 수가 맞을 때 나머지 둘레를 연다.
 * 판의 첫 칸이면 이때 함정이 놓인다(그래서 첫 칸은 언제나 안전하다).
 * 받은 상태는 바꾸지 않고 새 상태를 돌려준다.
 */
export function tapTile(
  run: RunState,
  index: number,
  random: () => number,
): { run: RunState; outcome: TapOutcome } {
  const tile = isOver(run) ? undefined : run.board.tiles[index];
  if (tile !== 'covered' && tile !== 'open') return { run, outcome: { kind: 'none' } };

  const first = run.board.traps === null;
  const chord = tile === 'open';
  const targets = chord ? chordTargets(run.board, index) : [index];
  if (targets.length === 0) return { run, outcome: { kind: 'none' } };

  const placed = first ? withTraps(run.board, layTraps(stageSpec(run.stage), index, random)) : run.board;
  const { board, opened, tripped } = openTiles(placed, targets);
  const points = opened.length * TILE_POINTS;
  const next: RunState = {
    ...run,
    board,
    hearts: Math.max(0, run.hearts - tripped.length),
    score: run.score + points,
    tilesOpened: run.tilesOpened + opened.length,
    trapsTripped: run.trapsTripped + tripped.length,
    flawless: run.flawless && tripped.length === 0,
  };
  const outcome = { kind: 'opened', opened, points, tripped, first, chord } as const;
  // 마지막 목숨을 잃으면서 판을 다 열었다면 깬 것으로 치지 않는다.
  if (next.hearts === 0 || !isCleared(board)) return { run: next, outcome: { ...outcome, cleared: null } };

  const timeLeft = Math.min(TIME_BANK_SECONDS, run.timeLeft + clearSeconds(run.stage));
  const cleared: ClearReward = {
    points: clearPoints(run.stage, next.flawless),
    flawless: next.flawless,
    seconds: timeLeft - run.timeLeft,
  };
  return {
    run: {
      ...next,
      board: markAllTraps(board),
      timeLeft,
      score: next.score + cleared.points,
      boardsCleared: run.boardsCleared + 1,
    },
    outcome: { ...outcome, cleared },
  };
}

/** index 칸에 깃발을 꽂거나 뽑는다. 바뀐 것이 없으면 받은 상태를 그대로 돌려준다. */
export function markTile(run: RunState, index: number): RunState {
  if (isOver(run)) return run;
  const board = toggleMark(run.board, index);
  return board === run.board ? run : { ...run, board };
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
export function nextStage(run: RunState): RunState {
  const stage = run.stage + 1;
  return { ...run, stage, board: freshBoard(stage), flawless: true };
}

// ───────── 단계 모드 ─────────

/** 단계 모드가 거치는 난이도의 수: 가장 작은 판부터 가장 큰 판까지 */
export const LEVEL_STEPS = STAGES.length;

/** 단계 모드의 level(1부터)번째 단계가 쓰는 판 번호. stageSpec의 stage로 넘긴다. */
export function levelStage(level: number): number {
  return difficultyOf(level, LEVEL_STEPS);
}

/**
 * 단계 모드의 한 단계. 시간은 흐르지 않고(elapse를 부르지 않는다), 판 하나를 깨면 끝난다.
 * 목숨은 단계마다 새로 받는다. 함정은 여느 때처럼 첫 칸을 누를 때 놓이므로,
 * 같은 단계라도 누른 첫 칸이 다르면 다른 판이 된다.
 */
export function levelRun(level: number): RunState {
  const stage = levelStage(level);
  return { ...newRun(), stage, board: freshBoard(stage) };
}
