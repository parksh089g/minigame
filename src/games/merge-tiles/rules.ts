/**
 * 머지 타일의 규칙. 화면과 분리된 순수 함수라서 숫자만 바꿔 밸런스를 조정할 수 있다.
 * 판은 SIZE × SIZE이고, 칸 번호는 왼쪽 위부터 오른쪽으로 매긴다(칸 번호 = 줄 × SIZE + 열).
 * 타일은 적힌 숫자가 아니라 "단계"로 적는다: 단계 1이 2, 단계 2가 4, 단계 3이 8이고 빈칸은 0이다.
 * 무작위가 필요한 곳은 random(0 이상 1 미만의 수를 돌려주는 함수)을 받아서 쓴다.
 */
import type { SwipeDirection } from '../../core/swipe';

// ───────── 판 ─────────

export const SIZE = 4;
export const CELLS = SIZE * SIZE;

/** 칸마다 놓인 타일의 단계. 빈칸은 0이다. 길이는 언제나 CELLS다. */
export type Board = readonly number[];

export function emptyBoard(): number[] {
  return new Array<number>(CELLS).fill(0);
}

/** 단계를 타일에 적는 숫자로 바꾼다. */
export function tileValue(level: number): number {
  return level <= 0 ? 0 : 2 ** level;
}

/** 판에서 가장 높은 단계. 빈 판이면 0이다. */
export function maxLevel(board: Board): number {
  return board.reduce((highest, level) => Math.max(highest, level), 0);
}

export function emptyCells(board: Board): number[] {
  const cells: number[] = [];
  board.forEach((level, cell) => {
    if (level === 0) cells.push(cell);
  });
  return cells;
}

// ───────── 밀기 ─────────

/**
 * 미는 쪽 벽에서부터 차례로 적은 한 줄의 칸 번호들.
 * 왼쪽으로 밀면 줄마다 왼쪽 칸이 먼저 오고, 아래로 밀면 열마다 아래 칸이 먼저 온다.
 */
export function linesFor(direction: SwipeDirection): number[][] {
  const lines: number[][] = [];
  for (let line = 0; line < SIZE; line += 1) {
    const cells: number[] = [];
    for (let step = 0; step < SIZE; step += 1) {
      const along = direction === 'left' || direction === 'up' ? step : SIZE - 1 - step;
      const horizontal = direction === 'left' || direction === 'right';
      cells.push(horizontal ? line * SIZE + along : along * SIZE + line);
    }
    lines.push(cells);
  }
  return lines;
}

/** 민 뒤에 타일 하나가 어디로 가는지 */
export interface TileMove {
  from: number;
  to: number;
  /** 움직이기 전의 단계 */
  level: number;
  /** 앞선 타일에 합쳐져 사라지면 true. 합쳐진 타일은 to 칸에 남는다. */
  absorbed: boolean;
}

export interface Merge {
  cell: number;
  /** 합쳐져서 생긴 타일의 단계 */
  level: number;
}

export interface SlideResult {
  board: number[];
  /** 밀기 전에 판에 있던 모든 타일의 이동. 제자리에 머문 타일도 들어 있다. */
  moves: TileMove[];
  merges: Merge[];
  /** 하나라도 움직이거나 합쳐졌는지. false면 헛민 것이라 새 타일이 나오지 않는다. */
  moved: boolean;
  /** 이번 밀기로 얻은 점수 */
  points: number;
}

/**
 * 판을 한쪽으로 민다. 타일은 벽이나 다른 타일에 닿을 때까지 미끄러지고,
 * 같은 단계끼리 만나면 한 단계 높은 타일 하나가 된다.
 * 한 번 밀 때 한 타일은 한 번만 합쳐진다(2 2 2 2를 밀면 8이 아니라 4 4가 된다).
 * 원본 판은 바꾸지 않는다.
 */
export function slide(board: Board, direction: SwipeDirection): SlideResult {
  const next = emptyBoard();
  const moves: TileMove[] = [];
  const merges: Merge[] = [];
  let points = 0;

  for (const line of linesFor(direction)) {
    let slot = 0;
    /** 바로 앞에 놓인 타일. 방금 합쳐진 타일은 다시 합쳐지지 않게 null로 둔다. */
    let ahead: { level: number; cell: number } | null = null;
    for (const cell of line) {
      const level = board[cell];
      if (level === 0) continue;
      if (ahead && ahead.level === level) {
        next[ahead.cell] = level + 1;
        moves.push({ from: cell, to: ahead.cell, level, absorbed: true });
        merges.push({ cell: ahead.cell, level: level + 1 });
        points += mergePoints(level + 1);
        ahead = null;
      } else {
        const to = line[slot];
        next[to] = level;
        moves.push({ from: cell, to, level, absorbed: false });
        ahead = { level, cell: to };
        slot += 1;
      }
    }
  }

  const moved = moves.some((move) => move.from !== move.to);
  return { board: next, moves, merges, moved, points };
}

const DIRECTIONS: readonly SwipeDirection[] = ['left', 'right', 'up', 'down'];

/** 어느 쪽으로든 밀어서 판이 바뀔 수 있는지. false면 꽉 막힌 것이라 게임이 끝난다. */
export function canMove(board: Board): boolean {
  return DIRECTIONS.some((direction) => slide(board, direction).moved);
}

// ───────── 새 타일 ─────────

/** 새 타일이 2가 아니라 4로 나올 확률. 가끔 섞여 나와야 판이 단조롭지 않다. */
export const FOUR_CHANCE = 0.1;
/** 처음 판에 놓이는 타일 수 */
export const START_TILES = 2;

export interface Spawn {
  board: number[];
  cell: number;
  level: number;
}

/** 빈칸 하나를 골라 새 타일을 놓는다. 빈칸이 없으면 null이다. 원본 판은 바꾸지 않는다. */
export function spawnTile(board: Board, random: () => number): Spawn | null {
  const free = emptyCells(board);
  if (free.length === 0) return null;
  const cell = free[Math.min(free.length - 1, Math.floor(random() * free.length))];
  const level = random() < FOUR_CHANCE ? 2 : 1;
  const next = [...board];
  next[cell] = level;
  return { board: next, cell, level };
}

export function startBoard(random: () => number): number[] {
  let board = emptyBoard();
  for (let count = 0; count < START_TILES; count += 1) {
    board = spawnTile(board, random)?.board ?? board;
  }
  return board;
}

// ───────── 점수 ─────────

/**
 * 합쳐서 만든 타일의 점수. 4를 만들면 1점이고 한 단계 오를 때마다 두 배다(8은 2점, 16은 4점).
 * 타일에 적힌 숫자의 4분의 1이라, 큰 타일을 만들수록 점수가 훨씬 빨리 오른다.
 */
export function mergePoints(level: number): number {
  return level < 2 ? 0 : 2 ** (level - 2);
}

// ───────── 시간 ─────────

/** 한 판의 제한 시간(초). 미니게임답게 짧게 끝나도록 시간을 겨루는 방식으로 했다. */
export const START_SECONDS = 90;
/** 이 단계(32)부터는 처음 만들 때마다 시간을 더 준다. 큰 타일을 노릴 이유가 된다. */
export const BONUS_FROM_LEVEL = 5;
/** 새 기록 타일 하나에 더해 주는 시간(초) */
export const BONUS_SECONDS = 5;

/**
 * 판에서 가장 높은 단계가 before에서 after로 올랐을 때 더해 주는 시간(초).
 * 한 번에 두 단계가 오를 수는 없지만, 그렇게 들어와도 넘어간 단계만큼 준다.
 */
export function bonusSeconds(before: number, after: number): number {
  const from = Math.max(before, BONUS_FROM_LEVEL - 1);
  return after > from ? (after - from) * BONUS_SECONDS : 0;
}

// ───────── 한 수 ─────────

export interface Turn {
  board: number[];
  slide: SlideResult;
  /** 새로 나온 타일. 헛밀었으면 null이다. */
  spawn: Spawn | null;
  /** 이번 수로 더 받는 시간(초) */
  bonus: number;
  /** 이 수를 두고 나서 더 밀 수 있는지 */
  alive: boolean;
}

/** 한쪽으로 밀고, 판이 바뀌었으면 새 타일을 하나 놓는다. 헛밀었으면 판은 그대로다. */
export function playTurn(board: Board, direction: SwipeDirection, random: () => number): Turn {
  const result = slide(board, direction);
  if (!result.moved) {
    return { board: [...board], slide: result, spawn: null, bonus: 0, alive: canMove(board) };
  }
  const spawn = spawnTile(result.board, random);
  const next = spawn?.board ?? result.board;
  return {
    board: next,
    slide: result,
    spawn,
    bonus: bonusSeconds(maxLevel(board), maxLevel(result.board)),
    alive: canMove(next),
  };
}
