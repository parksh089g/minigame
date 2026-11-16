/**
 * 세 개 맞추기의 규칙. 화면과 분리된 순수 함수라서 숫자만 바꿔 밸런스를 조정할 수 있다.
 * 판은 COLS × ROWS 격자이고, 칸은 번호 하나로 적는다: row * COLS + col, 왼쪽 위가 0번이다.
 * 이웃한 두 조각을 맞바꿔 같은 조각을 가로나 세로로 셋 이상 나란히 놓으면 사라지고,
 * 위의 조각이 떨어져 내려오고, 빈 자리에는 새 조각이 들어온다. 그래서 또 맞으면 이어서 사라진다(연쇄).
 * 무작위가 필요한 곳은 random(0 이상 1 미만의 수를 돌려주는 함수)을 받아서 쓴다.
 */
import { difficultyOf, seededRandom, STAGE_LEVELS, stepProgress } from '../../core/stages';

// ───────── 판 ─────────

export const COLS = 7;
export const ROWS = 8;
export const CELLS = COLS * ROWS;
/** 조각의 가짓수: 가장 적을 때와 가장 많을 때 */
export const MIN_KINDS = 5;
export const MAX_KINDS = 6;
/** 나란히 놓여야 사라지는 조각의 수 */
export const MATCH = 3;
/** 한 번에 이만큼 이어져 사라지면 그 자리에 폭죽이 생긴다. RAINBOW_MATCH개부터는 폭죽 대신 무지개다. */
export const BURST_MATCH = 4;
/** 한 번에 이만큼 이상 이어져 사라지면 폭죽 대신 무지개 조각이 생긴다. 한 줄로 다섯이어도, 꺾이거나 엇갈린 모양으로 다섯이어도 된다. */
export const RAINBOW_MATCH = 5;

/**
 * 특수 조각의 갈래. 둘 다 제 갈래의 조각으로 맞추거나 다른 특수 조각에 휩쓸려서 사라질 때 일을 한다.
 * 폭죽(burst)은 그 가로줄과 세로줄을 함께 터뜨리고, 무지개(rainbow)는 판에 있는 같은 갈래의 조각을 모두 함께 지운다.
 */
export type Power = 'burst' | 'rainbow';

export interface Piece {
  /** 조각의 갈래: 0부터 */
  kind: number;
  /** 특수 조각이면 그 갈래, 여느 조각이면 null */
  power: Power | null;
}

/** 칸마다 놓인 조각. 차례와 차례 사이에는 빈칸이 없다. */
export type Board = readonly Piece[];

export function cellOf(col: number, row: number): number {
  return row * COLS + col;
}

export function colOf(cell: number): number {
  return cell % COLS;
}

export function rowOf(cell: number): number {
  return Math.floor(cell / COLS);
}

export function isCell(cell: number): boolean {
  return Number.isInteger(cell) && cell >= 0 && cell < CELLS;
}

/** 두 칸이 위아래나 옆으로 붙어 있는지 */
export function areAdjacent(a: number, b: number): boolean {
  if (!isCell(a) || !isCell(b)) return false;
  return Math.abs(colOf(a) - colOf(b)) + Math.abs(rowOf(a) - rowOf(b)) === 1;
}

export type Direction = 'left' | 'right' | 'up' | 'down';

/** 그 칸에서 그 쪽으로 붙은 칸. 판 밖이면 null */
export function neighbourOf(cell: number, direction: Direction): number | null {
  const col = colOf(cell) + (direction === 'left' ? -1 : direction === 'right' ? 1 : 0);
  const row = rowOf(cell) + (direction === 'up' ? -1 : direction === 'down' ? 1 : 0);
  return col < 0 || col >= COLS || row < 0 || row >= ROWS ? null : cellOf(col, row);
}

/** 두 칸의 조각을 맞바꾼 판 */
export function swapped(board: Board, a: number, b: number): Piece[] {
  const next = [...board];
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}

// ───────── 맞은 조각 찾기 ─────────

/** 같은 조각이 가로나 세로로 MATCH개 이상 나란히 놓인 줄 */
export interface Run {
  cells: number[];
  kind: number;
  horizontal: boolean;
}

/** 판에서 맞은 줄을 모두 찾는다. 빈칸(null)은 어느 줄에도 들지 않는다. */
export function runsOf(board: readonly (Piece | null)[]): Run[] {
  const runs: Run[] = [];
  const scan = (count: number, length: number, at: (line: number, step: number) => number, horizontal: boolean): void => {
    for (let line = 0; line < count; line += 1) {
      let start = 0;
      for (let step = 1; step <= length; step += 1) {
        const first = board[at(line, start)];
        const here = step < length ? board[at(line, step)] : null;
        if (first && here && here.kind === first.kind) continue;
        if (first && step - start >= MATCH) {
          const cells = Array.from({ length: step - start }, (_, index) => at(line, start + index));
          runs.push({ cells, kind: first.kind, horizontal });
        }
        start = step;
      }
    }
  };
  scan(ROWS, COLS, (row, col) => cellOf(col, row), true);
  scan(COLS, ROWS, (col, row) => cellOf(col, row), false);
  return runs;
}

export function hasMatch(board: readonly (Piece | null)[]): boolean {
  return runsOf(board).length > 0;
}

/** 그 두 칸을 맞바꿀 수 있는지: 붙어 있고, 바꾸면 맞는 줄이 생긴다. */
export function isValidSwap(board: Board, a: number, b: number): boolean {
  return areAdjacent(a, b) && hasMatch(swapped(board, a, b));
}

export interface Move {
  a: number;
  b: number;
}

/** 지금 할 수 있는 맞바꾸기를 모두 찾는다. 왼쪽 위 칸부터 차례로, 오른쪽 칸과 아래 칸만 본다. */
export function findMoves(board: Board): Move[] {
  const moves: Move[] = [];
  for (let cell = 0; cell < CELLS; cell += 1) {
    for (const direction of ['right', 'down'] as const) {
      const other = neighbourOf(cell, direction);
      if (other !== null && board[cell].kind !== board[other].kind && hasMatch(swapped(board, cell, other))) {
        moves.push({ a: cell, b: other });
      }
    }
  }
  return moves;
}

export function hasMove(board: Board): boolean {
  return findMoves(board).length > 0;
}

// ───────── 판 만들기 ─────────

/** 조각의 가짓수를 MIN_KINDS와 MAX_KINDS 사이의 정수로 맞춘다. */
export function toKinds(kinds: number): number {
  if (!Number.isFinite(kinds)) return MAX_KINDS;
  return Math.min(MAX_KINDS, Math.max(MIN_KINDS, Math.floor(kinds)));
}

function randomKind(kinds: number, random: () => number): number {
  return Math.min(kinds - 1, Math.floor(random() * kinds));
}

/** 판을 새로 만들 때 다시 해 보는 횟수. 할 수 있는 맞바꾸기가 없는 판은 드물어서 한두 번이면 된다. */
export const BOARD_ATTEMPTS = 50;

/**
 * 새 판: 처음부터 맞아 있는 줄이 없고, 할 수 있는 맞바꾸기가 하나는 있다.
 * 칸을 차례로 채우면서 왼쪽 두 칸이나 위 두 칸과 같은 조각은 피한다.
 */
export function newBoard(kinds: number, random: () => number): Piece[] {
  const count = toKinds(kinds);
  let board: Piece[] = [];
  for (let attempt = 0; attempt < BOARD_ATTEMPTS; attempt += 1) {
    board = [];
    for (let cell = 0; cell < CELLS; cell += 1) {
      const col = colOf(cell);
      const row = rowOf(cell);
      const banned = new Set<number>();
      if (col >= 2 && board[cell - 1].kind === board[cell - 2].kind) banned.add(board[cell - 1].kind);
      if (row >= 2 && board[cell - COLS].kind === board[cell - COLS * 2].kind) banned.add(board[cell - COLS].kind);
      let kind = randomKind(count, random);
      while (banned.has(kind)) kind = (kind + 1) % count;
      board.push({ kind, power: null });
    }
    if (hasMove(board)) return board;
  }
  return board;
}

export interface Shuffle {
  board: Piece[];
  /** 새 판의 칸마다, 그 조각이 있던 옛 칸. 화면이 조각을 제자리로 옮길 때 쓴다. */
  from: number[];
}

/** 섞기를 다시 해 보는 횟수 */
export const SHUFFLE_ATTEMPTS = 200;

/**
 * 할 수 있는 맞바꾸기가 없을 때 조각을 섞는다. 조각의 수와 특수 조각은 그대로이고 자리만 바뀐다.
 * 섞은 판에는 맞아 있는 줄이 없고 할 수 있는 맞바꾸기가 있다. 끝내 그런 판이 안 나오면 null.
 */
export function shuffleBoard(board: Board, random: () => number): Shuffle | null {
  for (let attempt = 0; attempt < SHUFFLE_ATTEMPTS; attempt += 1) {
    const from = Array.from({ length: CELLS }, (_, cell) => cell);
    for (let index = CELLS - 1; index > 0; index -= 1) {
      const other = Math.min(index, Math.floor(random() * (index + 1)));
      [from[index], from[other]] = [from[other], from[index]];
    }
    const next = from.map((cell) => board[cell]);
    if (!hasMatch(next) && hasMove(next)) return { board: next, from };
  }
  return null;
}

// ───────── 사라지기 ─────────

/** 이번에 사라지는 것. 판은 바꾸지 않고 무엇이 사라질지만 셈한다. */
export interface Clearing {
  /** 맞아서 사라지는 칸 */
  matched: number[];
  /** 폭죽이나 무지개에 휩쓸려 사라지는 칸. matched와 겹치지 않는다. */
  blasted: number[];
  /** 터지는 폭죽이 있던 칸 */
  detonated: number[];
  /** 터지는 무지개가 있던 칸과, 그 무지개가 지우는 갈래 */
  swept: { cell: number; kind: number }[];
  /** 새로 생기는 특수 조각: 그 칸의 조각이 사라진 자리에 놓인다. */
  made: { cell: number; kind: number; power: Power }[];
}

/** 맞은 칸들을 붙어 있는 같은 조각끼리 묶는다. */
function groupsOf(board: readonly (Piece | null)[], matched: ReadonlySet<number>): number[][] {
  const seen = new Set<number>();
  const groups: number[][] = [];
  for (const start of [...matched].sort((a, b) => a - b)) {
    if (seen.has(start)) continue;
    const kind = board[start]?.kind;
    const group: number[] = [];
    const queue = [start];
    seen.add(start);
    while (queue.length > 0) {
      const cell = queue.pop() as number;
      group.push(cell);
      for (const direction of ['left', 'right', 'up', 'down'] as const) {
        const next = neighbourOf(cell, direction);
        if (next === null || seen.has(next) || !matched.has(next) || board[next]?.kind !== kind) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    groups.push(group.sort((a, b) => a - b));
  }
  return groups;
}

/**
 * 지금 판에서 사라질 것을 셈한다. 맞은 줄이 없으면 null.
 * 붙어 있는 같은 조각의 묶음이 BURST_MATCH개 이상이면 폭죽이, RAINBOW_MATCH개 이상이면 폭죽 대신 무지개가 생긴다.
 * prefer는 방금 맞바꾼 두 칸: 특수 조각이 생길 때 그 칸에 놓인다. 없으면 가로줄과 세로줄이 만나는 칸,
 * 그것도 없으면 묶음의 가운데 칸에 놓인다.
 */
export function clearingOf(board: readonly (Piece | null)[], prefer: readonly number[] = []): Clearing | null {
  const runs = runsOf(board);
  if (runs.length === 0) return null;

  const matched = new Set<number>();
  const across = new Set<number>();
  const down = new Set<number>();
  for (const run of runs) {
    for (const cell of run.cells) {
      matched.add(cell);
      (run.horizontal ? across : down).add(cell);
    }
  }

  const made: Clearing['made'] = [];
  for (const group of groupsOf(board, matched)) {
    if (group.length < BURST_MATCH) continue;
    const anchor =
      prefer.find((cell) => group.includes(cell)) ??
      group.find((cell) => across.has(cell) && down.has(cell)) ??
      group[Math.floor(group.length / 2)];
    const power: Power = group.length >= RAINBOW_MATCH ? 'rainbow' : 'burst';
    made.push({ cell: anchor, kind: (board[anchor] as Piece).kind, power });
  }

  // 사라지는 칸에 특수 조각이 있으면 그것이 지우는 칸도 함께 사라지고, 거기 있던 특수 조각도 이어서 터진다.
  // 폭죽은 그 가로줄과 세로줄을, 무지개는 판에 있는 같은 갈래의 조각을 모두 지운다.
  const cleared = new Set(matched);
  const detonated: number[] = [];
  const swept: Clearing['swept'] = [];
  const queue = [...matched].filter((cell) => board[cell]?.power);
  const queued = new Set(queue);
  while (queue.length > 0) {
    const cell = queue.shift() as number;
    const piece = board[cell] as Piece;
    let reach: number[];
    if (piece.power === 'rainbow') {
      swept.push({ cell, kind: piece.kind });
      reach = Array.from({ length: CELLS }, (_, other) => other).filter((other) => board[other]?.kind === piece.kind);
    } else {
      detonated.push(cell);
      const col = colOf(cell);
      const row = rowOf(cell);
      reach = [
        ...Array.from({ length: COLS }, (_, c) => cellOf(c, row)),
        ...Array.from({ length: ROWS }, (_, r) => cellOf(col, r)),
      ];
    }
    for (const other of reach) {
      if (!board[other]) continue;
      cleared.add(other);
      if (board[other]?.power && !queued.has(other)) {
        queued.add(other);
        queue.push(other);
      }
    }
  }

  const sorted = (cells: Iterable<number>): number[] => [...cells].sort((a, b) => a - b);
  return {
    matched: sorted(matched),
    blasted: sorted([...cleared].filter((cell) => !matched.has(cell))),
    detonated: sorted(detonated),
    swept: swept.sort((a, b) => a.cell - b.cell),
    made,
  };
}

// ───────── 떨어지기 ─────────

export interface Drop {
  from: number;
  to: number;
}

export interface Spawn {
  cell: number;
  piece: Piece;
  /** 판 위 몇 칸 높이에서 떨어져 들어오는지. 같은 세로줄의 새 조각은 모두 같은 값이라 나란히 떨어진다. */
  above: number;
}

export interface Settled {
  board: Piece[];
  drops: Drop[];
  spawns: Spawn[];
}

/**
 * 빈칸(null) 위의 조각을 아래로 떨어뜨리고, 위에서부터 새 조각을 채운다.
 * 새 조각은 왼쪽 세로줄부터, 세로줄 안에서는 아래 칸부터 차례로 뽑는다.
 */
export function settle(board: readonly (Piece | null)[], kinds: number, random: () => number): Settled {
  const count = toKinds(kinds);
  const next: (Piece | null)[] = [...board];
  const drops: Drop[] = [];
  const spawns: Spawn[] = [];
  for (let col = 0; col < COLS; col += 1) {
    let write = ROWS - 1;
    for (let row = ROWS - 1; row >= 0; row -= 1) {
      const from = cellOf(col, row);
      const piece = next[from];
      if (!piece) continue;
      const to = cellOf(col, write);
      if (to !== from) {
        next[to] = piece;
        next[from] = null;
        drops.push({ from, to });
      }
      write -= 1;
    }
    const empty = write + 1;
    for (let row = write; row >= 0; row -= 1) {
      const piece: Piece = { kind: randomKind(count, random), power: null };
      const cell = cellOf(col, row);
      next[cell] = piece;
      spawns.push({ cell, piece, above: empty });
    }
  }
  return { board: next as Piece[], drops, spawns };
}

// ───────── 한 차례 ─────────

/** 사라진 조각 하나의 점수. 연쇄가 이어지면 그 차례 수만큼 곱한다. */
export const PIECE_POINTS = 10;
/** 연쇄로 곱해지는 가장 큰 수 */
export const MAX_CHAIN_BONUS = 5;
/** 한 차례에 이어지는 연쇄의 끝. 이보다 길게 이어지는 일은 없다시피 하지만, 끝없이 돌지 않게 막아 둔다. */
export const MAX_CHAIN = 40;

/** 연쇄 chain번째(1부터)에 사라진 조각 count개의 점수 */
export function stepPoints(count: number, chain: number): number {
  const bonus = Math.min(MAX_CHAIN_BONUS, Math.max(1, Math.floor(chain)));
  return Math.max(0, Math.floor(count)) * PIECE_POINTS * bonus;
}

/** 한 차례 안에서 한 번 사라지고 떨어지는 것 */
export interface Step extends Clearing {
  /** 몇 번째 연쇄인지: 1부터 */
  chain: number;
  drops: Drop[];
  spawns: Spawn[];
  points: number;
  /** 떨어지고 채워진 뒤의 판 */
  board: Piece[];
}

export interface Turn {
  steps: Step[];
  /** 모두 끝난 뒤의 판. 섞였으면 섞인 판이다. */
  board: Piece[];
  points: number;
  /** 갈래마다 사라진 조각의 수 */
  cleared: number[];
  /** 터진 폭죽의 수 */
  bursts: number;
  /** 터진 무지개의 수 */
  rainbows: number;
  /** 새로 생긴 특수 조각(폭죽과 무지개)의 수 */
  made: number;
  /** 할 수 있는 맞바꾸기가 없어서 섞었으면 그 섞기. 조각은 steps가 끝난 뒤의 자리에서 옮겨 간다. */
  shuffle: Shuffle | null;
}

/**
 * 맞아 있는 줄이 없어질 때까지 사라지고 떨어지기를 되풀이한다. 받은 판은 바꾸지 않는다.
 * prefer는 방금 맞바꾼 두 칸(첫 연쇄에서 특수 조각이 놓일 자리)이다.
 */
export function resolve(
  start: readonly (Piece | null)[],
  kinds: number,
  random: () => number,
  prefer: readonly number[] = [],
): Turn {
  const count = toKinds(kinds);
  const steps: Step[] = [];
  const cleared = Array<number>(MAX_KINDS).fill(0);
  let board: readonly (Piece | null)[] = start;
  let bursts = 0;
  let rainbows = 0;
  let made = 0;

  for (let chain = 1; chain <= MAX_CHAIN; chain += 1) {
    const clearing = clearingOf(board, chain === 1 ? prefer : []);
    if (!clearing) break;
    const gone = [...clearing.matched, ...clearing.blasted];
    const holes: (Piece | null)[] = [...board];
    for (const cell of gone) {
      const piece = holes[cell];
      if (piece) cleared[piece.kind] += 1;
      holes[cell] = null;
    }
    for (const special of clearing.made) holes[special.cell] = { kind: special.kind, power: special.power };
    const settled = settle(holes, count, random);
    steps.push({
      ...clearing,
      chain,
      drops: settled.drops,
      spawns: settled.spawns,
      points: stepPoints(gone.length, chain),
      board: settled.board,
    });
    bursts += clearing.detonated.length;
    rainbows += clearing.swept.length;
    made += clearing.made.length;
    board = settled.board;
  }

  let final = [...board] as Piece[];
  let shuffle: Shuffle | null = null;
  if (steps.length > 0 && (hasMatch(final) || !hasMove(final))) {
    // 할 수 있는 것이 없으면 섞는다. 연쇄가 끝까지 가서 맞은 줄이 남은 드문 경우도 섞어서 푼다.
    shuffle = shuffleBoard(final, random);
    if (shuffle) final = shuffle.board;
    else {
      // 섞어도 안 되면 새 판을 깐다. 조각이 한 갈래로 쏠렸을 때뿐이라 실제로는 일어나지 않는다.
      final = newBoard(count, random);
      shuffle = { board: final, from: Array.from({ length: CELLS }, (_, cell) => cell) };
    }
  }

  return {
    steps,
    board: final,
    points: steps.reduce((sum, step) => sum + step.points, 0),
    cleared,
    bursts,
    rainbows,
    made,
    shuffle,
  };
}

/**
 * 두 칸을 맞바꿔 한 차례를 둔다. 바꿀 수 없는 자리(붙어 있지 않거나, 바꿔도 맞는 줄이 없음)면 null이고
 * 판은 그대로다. 받은 판은 바꾸지 않는다.
 */
export function playSwap(board: Board, a: number, b: number, kinds: number, random: () => number): Turn | null {
  if (!isValidSwap(board, a, b)) return null;
  return resolve(swapped(board, a, b), kinds, random, [b, a]);
}

/** 한 차례에서 가장 길게 이어진 연쇄 */
export function chainOf(turn: Turn): number {
  return turn.steps.length;
}

// ───────── 점수 도전: 시간 ─────────

/** 점수 도전에서 쓰는 조각의 가짓수 */
export const ARCADE_KINDS = MAX_KINDS;
/** 처음에 주어지는 시간(초). 돌려받아도 이보다 많아지지는 않는다. */
export const START_SECONDS = 60;
/** 폭죽을 하나 터뜨릴 때마다 돌려받는 시간(초) */
export const BURST_SECONDS = 1;
/** 무지개를 하나 터뜨릴 때마다 돌려받는 시간(초) */
export const RAINBOW_SECONDS = 1;
/** 한 차례에 돌려받는 시간의 끝(초). 특수 조각이 줄줄이 터져도 시간이 한꺼번에 차지는 않는다. */
export const MAX_TURN_SECONDS = 3;

/**
 * 그 차례로 돌려받는 시간(초): 폭죽이나 무지개를 터뜨리면 받는다.
 * 시간은 조각이 사라지고 떨어지는 동안에는 흐르지 않으므로, 한 차례에 돌려받는 시간은
 * 다음 자리를 찾는 데 드는 시간보다 한참 적어야 판이 끝난다.
 */
export function secondsBack(turn: Turn): number {
  return Math.min(MAX_TURN_SECONDS, turn.bursts * BURST_SECONDS + turn.rainbows * RAINBOW_SECONDS);
}

/**
 * 판이 지금 무엇을 하는가.
 * idle은 손을 기다리는 중, bounce는 맞지 않는 바꾸기가 제자리로 되돌아오는 중,
 * busy는 맞은 조각이 사라지고 떨어지는 중, over는 판이 끝난 뒤다. idle이 아니면 손이 먹지 않는다.
 */
export type BoardPhase = 'idle' | 'bounce' | 'busy' | 'over';

/**
 * 점수 도전의 시계가 흐르는 때인가. 맞은 조각이 사라지고 떨어지는 동안에만 선다.
 * 맞지 않는 바꾸기가 되돌아오는 동안에도 서면, 맞지 않는 자리를 이어서 건드리는 것만으로
 * 시간을 쓰지 않고 다음 자리를 찾을 수 있다. 돌려받는 시간(secondsBack)이 적은 까닭이 그것으로 무너진다.
 */
export function clockRuns(phase: BoardPhase): boolean {
  return phase === 'idle' || phase === 'bounce';
}

// ───────── 단계 모드 ─────────

/** 단계 모드의 난이도 한 칸 */
export interface LevelSpec {
  kinds: number;
  /** 맞바꿀 수 있는 횟수. 그 칸의 첫 단계의 값이다. */
  moves: number;
  /** 그 칸의 마지막 단계에서 맞바꿀 수 있는 횟수. 칸 안에서 뒤로 갈수록 moves에서 여기까지 줄어든다. */
  tight: number;
  /** 모아야 하는 조각의 갈래 수 */
  goals: number;
  /** 갈래마다 모아야 하는 수 */
  count: number;
}

/**
 * 단계 모드가 거치는 난이도. 조각의 갈래가 늘고, 모을 갈래와 수가 늘고, 횟수는 빠듯해진다.
 * 같은 칸 안에서도 뒤로 갈수록 횟수가 줄어서(moves → tight), 칸이 바뀌지 않는 동안에도 조금씩 어려워진다.
 */
export const LEVEL_SPECS: readonly LevelSpec[] = [
  { kinds: 5, moves: 18, tight: 16, goals: 1, count: 10 },
  { kinds: 5, moves: 16, tight: 14, goals: 1, count: 14 },
  { kinds: 5, moves: 15, tight: 14, goals: 2, count: 12 },
  { kinds: 5, moves: 16, tight: 14, goals: 2, count: 14 },
  { kinds: 6, moves: 19, tight: 17, goals: 2, count: 10 },
  { kinds: 6, moves: 18, tight: 16, goals: 2, count: 12 },
  { kinds: 6, moves: 20, tight: 18, goals: 3, count: 10 },
  { kinds: 6, moves: 19, tight: 17, goals: 3, count: 12 },
  { kinds: 6, moves: 19, tight: 17, goals: 3, count: 14 },
  { kinds: 6, moves: 17, tight: 15, goals: 3, count: 14 },
];

/** 단계 모드가 거치는 난이도의 수 */
export const LEVEL_STEPS = LEVEL_SPECS.length;

/** 단계 모드의 level(1부터)번째 단계가 쓰는 난이도 번호(1부터) */
export function levelStage(level: number): number {
  return difficultyOf(level, LEVEL_STEPS);
}

/** 단계 모드의 level번째 단계에서 맞바꿀 수 있는 횟수: 그 칸의 moves에서 tight까지, 칸 안의 자리에 따라 줄어든다. */
export function levelMoves(level: number): number {
  const spec = levelSpec(level);
  return spec.moves - Math.round(stepProgress(level, LEVEL_STEPS) * (spec.moves - spec.tight));
}

export function levelSpec(level: number): LevelSpec {
  return LEVEL_SPECS[levelStage(level) - 1];
}

export interface Goal {
  kind: number;
  count: number;
}

/** 단계 하나: 처음 판, 모을 것, 횟수, 그리고 새 조각을 뽑는 난수의 씨앗 */
export interface LevelPlan {
  level: number;
  kinds: number;
  moves: number;
  goals: Goal[];
  board: Piece[];
  /** 새 조각을 뽑는 난수의 씨앗. refillRandom에 넘긴다. */
  seed: string;
}

/** 단계에서 지금까지의 진행 */
export interface LevelRun {
  plan: LevelPlan;
  board: Piece[];
  movesLeft: number;
  /** 갈래마다 지금까지 모은 수 */
  collected: number[];
}

/** 그 단계의 새 조각을 뽑는 난수. 같은 씨앗이면 언제나 같은 조각이 같은 차례로 나온다. */
export function refillRandom(seed: string): () => number {
  return seededRandom(`${seed}:refill`);
}

export function startLevel(plan: LevelPlan): LevelRun {
  return { plan, board: [...plan.board], movesLeft: plan.moves, collected: Array<number>(MAX_KINDS).fill(0) };
}

/** 그 목표에서 아직 모아야 하는 수 */
export function goalLeft(run: LevelRun, goal: Goal): number {
  return Math.max(0, goal.count - (run.collected[goal.kind] ?? 0));
}

/** 목표를 모두 채웠는지 */
export function isLevelCleared(run: LevelRun): boolean {
  return run.plan.goals.every((goal) => goalLeft(run, goal) === 0);
}

/** 횟수를 다 썼는데 목표를 채우지 못했는지 */
export function isLevelFailed(run: LevelRun): boolean {
  return run.movesLeft <= 0 && !isLevelCleared(run);
}

/** 단계에서 한 차례를 둔 뒤의 진행. 그 차례의 결과(turn)를 받아 횟수를 하나 줄이고 모은 수를 더한다. */
export function afterTurn(run: LevelRun, turn: Turn): LevelRun {
  return {
    plan: run.plan,
    board: turn.board,
    movesLeft: Math.max(0, run.movesLeft - 1),
    collected: run.collected.map((count, kind) => count + (turn.cleared[kind] ?? 0)),
  };
}

/**
 * 단계를 깨 보는 풀이꾼이 고르는 맞바꾸기: 지금 판만 보고(새로 들어올 조각은 모른다),
 * 아직 모아야 하는 조각이 가장 많이 사라지는 자리를 고른다. 같으면 조각이 많이 사라지는 자리,
 * 그것도 같으면 먼저 찾은 자리다. 할 수 있는 맞바꾸기가 없으면 null(섞인 뒤라 실제로는 없다).
 */
export function solverMove(run: LevelRun): Move | null {
  let best: Move | null = null;
  let bestScore = -1;
  for (const move of findMoves(run.board)) {
    const after = swapped(run.board, move.a, move.b);
    const clearing = clearingOf(after, [move.b, move.a]);
    if (!clearing) continue;
    const gone = [...clearing.matched, ...clearing.blasted];
    const need = run.plan.goals.map((goal) => ({ kind: goal.kind, left: goalLeft(run, goal) }));
    let wanted = 0;
    for (const cell of gone) {
      const slot = need.find((item) => item.kind === after[cell].kind);
      if (slot && slot.left > 0) {
        slot.left -= 1;
        wanted += 1;
      }
    }
    const score = wanted * 100 + gone.length * 2 + clearing.made.length;
    if (score > bestScore) {
      best = move;
      bestScore = score;
    }
  }
  return best;
}

/**
 * 풀이꾼이 그 단계를 처음부터 끝까지 해 본다. 깼으면 남긴 횟수, 못 깼으면 null.
 * 새 조각은 실제로 할 때와 같은 난수로 뽑으므로, 풀이꾼이 깬 단계는 같은 차례로 두면 누구나 깬다.
 */
export function solveLevel(plan: LevelPlan): number | null {
  const random = refillRandom(plan.seed);
  let run = startLevel(plan);
  while (!isLevelCleared(run) && run.movesLeft > 0) {
    const move = solverMove(run);
    if (!move) return null;
    const turn = playSwap(run.board, move.a, move.b, plan.kinds, random);
    if (!turn) return null;
    run = afterTurn(run, turn);
  }
  return isLevelCleared(run) ? run.movesLeft : null;
}

/** 깰 수 있는 판이 나올 때까지 단계를 다시 만들어 보는 횟수 */
export const LEVEL_ATTEMPTS = 40;
/** 풀이꾼이 이만큼은 횟수를 남기고 깨야 그 판을 쓴다. 사람에게도 조금의 여유가 있다는 뜻이다. */
export const SOLVER_MARGIN = 2;

function planFrom(level: number, attempt: number): LevelPlan {
  const spec = levelSpec(level);
  const seed = `stage:match-three:${level}:${attempt}`;
  const random = seededRandom(seed);
  const board = newBoard(spec.kinds, random);
  // 모을 갈래를 겹치지 않게 뽑는다.
  const pool = Array.from({ length: spec.kinds }, (_, kind) => kind);
  const goals: Goal[] = [];
  for (let index = 0; index < spec.goals; index += 1) {
    const [kind] = pool.splice(Math.min(pool.length - 1, Math.floor(random() * pool.length)), 1);
    goals.push({ kind, count: spec.count });
  }
  goals.sort((a, b) => a.kind - b.kind);
  return { level, kinds: spec.kinds, moves: levelMoves(level), goals, board, seed };
}

/**
 * 단계 모드의 level(1부터)번째 단계. 같은 단계는 언제 누가 해도 같은 판이고 같은 조각이 들어온다.
 * 풀이꾼이 여유 있게 깨는 판이 나올 때까지 다시 만들어서, 어느 단계든 깰 수 있다.
 */
export function levelPlan(level: number): LevelPlan {
  const at = Math.min(STAGE_LEVELS, Math.max(1, Math.floor(Number.isFinite(level) ? level : 1)));
  let fallback: LevelPlan | null = null;
  for (let attempt = 0; attempt < LEVEL_ATTEMPTS; attempt += 1) {
    const plan = planFrom(at, attempt);
    const left = solveLevel(plan);
    if (left !== null && left >= SOLVER_MARGIN) return plan;
    if (left !== null && !fallback) fallback = plan;
  }
  // 여유 있게 깨는 판이 끝내 없으면 빠듯하게라도 깨는 판, 그것도 없으면 첫 판을 쓴다. 테스트가 이 길로 오는 단계가 없는지 본다.
  return fallback ?? planFrom(at, 0);
}
