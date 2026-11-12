/**
 * 길 잇기의 규칙. 화면과 분리된 순수 함수라서 숫자만 바꿔 밸런스를 조정할 수 있다.
 * 판은 size × size 격자이고, 칸은 번호 하나로 적는다: row * size + col, 왼쪽 위가 0번이다.
 * 판에는 같은 모양의 점이 두 개씩 놓여 있다. 한 점에서 짝 점까지 위아래와 옆으로 이어진 길을 그리되,
 * 길끼리 겹치지 않고 모든 칸이 길로 덮여야 판을 깬다.
 * 무작위가 필요한 곳은 random(0 이상 1 미만의 수를 돌려주는 함수)을 받아서 쓴다.
 */
import { difficultyOf } from '../../core/stages';

// ───────── 칸 ─────────

/** 칸 번호를 (col, row)로 바꾼다. */
export function cellOf(size: number, cell: number): { col: number; row: number } {
  return { col: cell % size, row: Math.floor(cell / size) };
}

/** 위, 아래, 왼쪽, 오른쪽으로 붙은 칸의 번호. 가장자리에서는 판 안에 있는 칸만 돌려준다. */
export function neighboursOf(size: number, cell: number): number[] {
  const { col, row } = cellOf(size, cell);
  const around: number[] = [];
  if (row > 0) around.push(cell - size);
  if (col > 0) around.push(cell - 1);
  if (col < size - 1) around.push(cell + 1);
  if (row < size - 1) around.push(cell + size);
  return around;
}

/** 두 칸이 위아래나 옆으로 붙어 있는지 */
export function areAdjacent(size: number, a: number, b: number): boolean {
  const first = cellOf(size, a);
  const second = cellOf(size, b);
  return Math.abs(first.col - second.col) + Math.abs(first.row - second.row) === 1;
}

// ───────── 문제 ─────────

/** 한 쌍의 길: 한 점에서 짝 점까지 차례로 지나는 칸 */
export type Path = readonly number[];

export interface Puzzle {
  size: number;
  /** 쌍마다 두 점이 놓인 칸 */
  dots: readonly (readonly [number, number])[];
  /** 칸마다 거기 놓인 점의 쌍 번호. 점이 없는 칸은 -1이다. */
  dotAt: readonly number[];
  /** 이 판을 만들 때 쓴 풀이. 쌍마다 첫 점에서 둘째 점까지의 칸이고, 모든 칸을 한 번씩 덮는다. */
  solution: readonly Path[];
}

/** 풀이(길들의 묶음)에서 문제를 만든다. 길마다 양 끝이 그 쌍의 두 점이 된다. */
export function puzzleFrom(size: number, solution: readonly Path[]): Puzzle {
  const dotAt = Array<number>(size * size).fill(-1);
  const dots = solution.map((path, pair) => {
    const first = path[0];
    const last = path[path.length - 1];
    dotAt[first] = pair;
    dotAt[last] = pair;
    return [first, last] as const;
  });
  return { size, dots, dotAt, solution: solution.map((path) => [...path]) };
}

// ───────── 판 만들기 ─────────

/** 길 하나가 덮는 가장 적은 칸 수. 두 칸짜리 길은 점 둘이 붙어 있어서 풀 것이 없다. */
export const MIN_PATH_CELLS = 3;

/** 판 크기에 따른 쌍의 수: [가장 적을 때, 가장 많을 때] */
export function pairRange(size: number): readonly [number, number] {
  if (size <= 5) return [4, 5];
  if (size === 6) return [5, 6];
  return [size - 1, size + 1];
}

/**
 * 길 하나가 덮는 가장 많은 칸 수. 한 길이 판의 절반 가까이를 휘감으면 나머지 길이 모두 토막이 되어
 * 재미가 없으므로 판의 5분의 2쯤에서 끊는다.
 */
export function maxPathCells(size: number): number {
  return Math.floor(size * size * 0.4);
}

/**
 * 가장 짧은 길(MIN_PATH_CELLS칸짜리)은 한 판에 이만큼까지만 둔다.
 * 점 둘이 한 칸 건너에 있어서 보자마자 이을 수 있는 쌍이라, 많으면 판이 싱겁다.
 */
export const MAX_STUBS = 1;

/** 가장 짧은 길의 수 */
export function stubCount(paths: readonly Path[]): number {
  return paths.filter((path) => path.length <= MIN_PATH_CELLS).length;
}

/** 한 판을 만들 때 길 나누기를 다시 해 보는 횟수. 이 안에 못 만들면 정해 둔 판을 쓴다. */
export const MAX_GENERATE_ATTEMPTS = 200;

/** 모든 칸의 이웃을 한 번에 구해 둔다. */
function neighbourTable(size: number): number[][] {
  return Array.from({ length: size * size }, (_, cell) => neighboursOf(size, cell));
}

/** list에서 하나를 고른다. */
function pick<T>(list: readonly T[], random: () => number): T {
  return list[Math.min(list.length - 1, Math.floor(random() * list.length))];
}

/** 순서를 섞은 새 배열을 돌려준다. */
function shuffled<T>(list: readonly T[], random: () => number): T[] {
  const result = [...list];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.min(index, Math.floor(random() * (index + 1)));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

/**
 * 길 a와 b를 이으면 한 길이 채운 2 × 2 덩어리가 생기는지.
 * 새로 생기는 덩어리에는 두 길의 칸이 모두 들어 있으므로, 짧은 쪽 길(shorter)의 칸을 낀 덩어리만 보면 된다.
 */
function closesBlock(
  size: number,
  owner: readonly number[],
  a: number,
  b: number,
  shorter: readonly number[],
): boolean {
  const mine = (cell: number): boolean => owner[cell] === a || owner[cell] === b;
  for (const cell of shorter) {
    const col = cell % size;
    const row = (cell - col) / size;
    // 이 칸을 낀 덩어리는 넷까지 있다. 덩어리의 왼쪽 위 칸으로 하나씩 본다.
    for (let top = Math.max(0, row - 1); top <= Math.min(size - 2, row); top += 1) {
      for (let left = Math.max(0, col - 1); left <= Math.min(size - 2, col); left += 1) {
        const corner = top * size + left;
        if (mine(corner) && mine(corner + 1) && mine(corner + size) && mine(corner + size + 1)) return true;
      }
    }
  }
  return false;
}

/** 두 길의 끝이 맞닿은 자리: a의 끝 칸 aEnd와 b의 끝 칸 bEnd가 붙어 있다. */
interface Join {
  a: number;
  b: number;
  aEnd: number;
  bEnd: number;
}

/**
 * 판을 길 target개로 나눠 본다. 처음에는 칸 하나하나가 길이고, 끝이 맞닿은 두 길을 골라 잇기를 되풀이한다.
 * 너무 짧은 길(MIN_PATH_CELLS 미만)을 먼저 없애는데, 그 가운데서도 이을 곳이 가장 적은 길부터 잇는다.
 * 이을 수 없는 짧은 길이 남거나 길 수를 맞추지 못하면 null이다.
 */
function tryPartition(size: number, target: number, random: () => number): number[][] | null {
  const cells = size * size;
  const around = neighbourTable(size);
  const longest = maxPathCells(size);
  const owner = Array.from({ length: cells }, (_, cell) => cell);
  const paths: (number[] | null)[] = Array.from({ length: cells }, (_, cell) => [cell]);
  let count = cells;

  const isEnd = (path: readonly number[], cell: number): boolean =>
    path[0] === cell || path[path.length - 1] === cell;

  for (;;) {
    const joins: Join[] = [];
    let shortPaths = 0;
    paths.forEach((path, a) => {
      if (!path) return;
      if (path.length < MIN_PATH_CELLS) shortPaths += 1;
      const ends = path.length === 1 ? [path[0]] : [path[0], path[path.length - 1]];
      for (const aEnd of ends) {
        for (const bEnd of around[aEnd]) {
          const b = owner[bEnd];
          const other = paths[b];
          // 같은 두 길의 같은 자리를 두 번 세지 않도록 번호가 작은 쪽에서만 센다.
          if (b <= a || !other || !isEnd(other, bEnd)) continue;
          const length = path.length + other.length;
          if (length > longest) continue;
          const shorter = path.length <= other.length ? path : other;
          if (length >= 4 && closesBlock(size, owner, a, b, shorter)) continue;
          joins.push({ a, b, aEnd, bEnd });
        }
      }
    });

    if (shortPaths === 0 && count <= target) break;

    const isShort = (id: number): boolean => (paths[id]?.length ?? 0) < MIN_PATH_CELLS;
    let pool = joins;
    if (shortPaths > 0) {
      // 짧은 길마다 이을 수 있는 자리를 모으고, 그 수가 가장 적은 길을 먼저 잇는다.
      const options = new Map<number, Join[]>();
      for (const join of joins) {
        for (const id of [join.a, join.b]) {
          if (isShort(id)) options.set(id, [...(options.get(id) ?? []), join]);
        }
      }
      if (options.size < shortPaths) return null;
      const fewest = Math.min(...[...options.values()].map((list) => list.length));
      pool = pick(
        [...options.values()].filter((list) => list.length === fewest),
        random,
      );
    }
    if (pool.length === 0) return null;

    const { a, b, aEnd, bEnd } = pick(pool, random);
    const head = paths[a] as number[];
    const tail = paths[b] as number[];
    if (head[head.length - 1] !== aEnd) head.reverse();
    if (tail[0] !== bEnd) tail.reverse();
    for (const cell of tail) owner[cell] = a;
    paths[a] = [...head, ...tail];
    paths[b] = null;
    count -= 1;
  }

  return paths.filter((path): path is number[] => path !== null);
}

/**
 * 길들이 좋은 문제의 조건을 모두 지키는지 본다.
 * 모든 칸을 한 번씩 덮고, 길마다 이웃한 칸으로 이어지며 MIN_PATH_CELLS칸 이상이고,
 * 길의 두 끝(두 점)이 서로 붙어 있지 않고, 한 길이 2 × 2 덩어리를 채우지 않고, 쌍의 수가 범위 안이다.
 */
export function isGoodPartition(size: number, paths: readonly Path[]): boolean {
  const [fewest, most] = pairRange(size);
  if (paths.length < fewest || paths.length > most) return false;
  const owner = Array<number>(size * size).fill(-1);
  for (const [pair, path] of paths.entries()) {
    if (path.length < MIN_PATH_CELLS) return false;
    if (areAdjacent(size, path[0], path[path.length - 1])) return false;
    for (const [index, cell] of path.entries()) {
      if (!(cell >= 0 && cell < owner.length) || owner[cell] !== -1) return false;
      if (index > 0 && !areAdjacent(size, path[index - 1], cell)) return false;
      owner[cell] = pair;
    }
  }
  if (owner.includes(-1)) return false;
  for (let row = 0; row < size - 1; row += 1) {
    for (let col = 0; col < size - 1; col += 1) {
      const cell = row * size + col;
      const pair = owner[cell];
      if (owner[cell + 1] === pair && owner[cell + size] === pair && owner[cell + size + 1] === pair) {
        return false;
      }
    }
  }
  return true;
}

/**
 * 길 나누기가 끝내 안 될 때 쓰는 정해진 판: 줄마다 길 하나가 왼쪽 끝에서 오른쪽 끝까지 간다.
 * 재미는 덜해도 조건을 모두 지킨다(size가 4 이상일 때).
 */
export function fallbackPartition(size: number): number[][] {
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) => row * size + col),
  );
}

/**
 * size × size 판의 문제를 만든다. 먼저 모든 칸을 덮는 길들을 만들고 그 양 끝에 점을 놓으므로,
 * 만들어진 판에는 모든 칸을 채우는 풀이가 반드시 하나는 있다.
 * 길 나누기는 MAX_GENERATE_ATTEMPTS번까지만 해 보고, 그래도 안 되면 정해 둔 판을 쓴다.
 * 그래서 random이 무엇을 내놓든 언제나 끝난다.
 * pairs를 주면 쌍의 수를 그것으로 정한다(단계 모드가 쓴다). 주지 않으면 판 크기에 맞는 범위에서 뽑는다.
 */
export function generatePuzzle(size: number, random: () => number, pairs?: number): Puzzle {
  const [fewest, most] = pairRange(size);
  // 쌍의 수는 한 번만 정한다. 다시 해 볼 때마다 새로 뽑으면 만들기 쉬운 쪽(쌍이 많은 판)으로 쏠린다.
  const target = pairs ?? fewest + Math.min(most - fewest, Math.floor(random() * (most - fewest + 1)));
  for (let attempt = 0; attempt < MAX_GENERATE_ATTEMPTS; attempt += 1) {
    const paths = tryPartition(size, target, random);
    if (!paths || !isGoodPartition(size, paths) || stubCount(paths) > MAX_STUBS) continue;
    // 길을 잇다 보면 바란 것보다 쌍이 적어질 수 있다. 쌍의 수를 정해서 받았으면 꼭 그 수여야 한다.
    if (pairs !== undefined && paths.length !== pairs) continue;
    // 길의 순서와 방향을 섞어서, 쌍 번호(색과 모양)가 판의 자리와 얽히지 않게 한다.
    const mixed = shuffled(paths, random).map((path) => (random() < 0.5 ? path : [...path].reverse()));
    return puzzleFrom(size, mixed);
  }
  return puzzleFrom(size, fallbackPartition(size));
}

// ───────── 그리는 판 ─────────

export interface Board {
  puzzle: Puzzle;
  /**
   * 쌍마다 지금까지 그린 길. 비어 있거나, 그 쌍의 한 점에서 시작해 이웃한 칸으로 이어진다.
   * 길끼리는 겹치지 않고, 다른 쌍의 점은 지나지 않는다.
   */
  paths: readonly Path[];
}

export function newBoard(puzzle: Puzzle): Board {
  return { puzzle, paths: puzzle.dots.map(() => []) };
}

function withPath(board: Board, pair: number, path: Path): Board {
  return { ...board, paths: board.paths.map((old, index) => (index === pair ? path : old)) };
}

/** 칸마다 그 칸을 지나는 길의 쌍 번호. 아무 길도 지나지 않으면 -1이다. */
export function ownersOf(board: Board): number[] {
  const owners = Array<number>(board.puzzle.size ** 2).fill(-1);
  board.paths.forEach((path, pair) => {
    for (const cell of path) owners[cell] = pair;
  });
  return owners;
}

function reachesPartner(puzzle: Puzzle, pair: number, path: Path): boolean {
  return path.length >= 2 && puzzle.dotAt[path[path.length - 1]] === pair;
}

/** 그 쌍의 두 점이 길로 이어졌는지 */
export function isLinked(board: Board, pair: number): boolean {
  return reachesPartner(board.puzzle, pair, board.paths[pair]);
}

/** 이어진 쌍의 수 */
export function linkedCount(board: Board): number {
  return board.paths.filter((_, pair) => isLinked(board, pair)).length;
}

/** 길이 덮은 칸의 수. 점만 눌러 놓고 아직 한 칸도 나가지 않은 길은 세지 않는다. */
export function coveredCount(board: Board): number {
  return board.paths.reduce((sum, path) => sum + (path.length >= 2 ? path.length : 0), 0);
}

/** 아직 어느 길도 덮지 않은 칸들 */
export function openCells(board: Board): number[] {
  const covered = new Set(board.paths.filter((path) => path.length >= 2).flat());
  const open: number[] = [];
  for (let cell = 0; cell < board.puzzle.size ** 2; cell += 1) {
    if (!covered.has(cell)) open.push(cell);
  }
  return open;
}

/** 판을 깼는지: 모든 쌍이 이어지고 모든 칸이 길로 덮여야 한다. */
export function isSolved(board: Board): boolean {
  return linkedCount(board) === board.paths.length && coveredCount(board) === board.puzzle.size ** 2;
}

// ───────── 길 그리기 ─────────

export interface Stroke {
  board: Board;
  /** 지금 그리는 쌍 */
  pair: number;
}

/**
 * cell 칸에서 그리기를 시작한다.
 * 점을 누르면 그 쌍의 길을 지우고 그 점에서 새로 시작한다. 길 위의 칸을 누르면 그 칸 뒤쪽을 잘라 내고
 * 거기서 이어 그린다. 점도 길도 없는 칸에서는 시작할 수 없다(null).
 */
export function startStroke(board: Board, cell: number): Stroke | null {
  const dot = board.puzzle.dotAt[cell];
  if (dot === undefined) return null;
  if (dot >= 0) return { pair: dot, board: withPath(board, dot, [cell]) };
  const pair = ownersOf(board)[cell];
  if (pair < 0) return null;
  const path = board.paths[pair];
  return { pair, board: withPath(board, pair, path.slice(0, path.indexOf(cell) + 1)) };
}

export interface DragResult {
  board: Board;
  /** 그리던 길의 칸 수가 얼마나 달라졌는지. 되돌아가서 줄었으면 음수다. */
  grew: number;
  /** 이번에 지나가면서 잘린 다른 쌍들 */
  cut: number[];
  /** 이번에 되돌아가면서 잘렸던 길이 되살아난 쌍들. restore를 주었을 때만 생긴다. */
  mended: number[];
  /** 이번에 짝 점에 닿아 두 점이 이어졌는지 */
  linked: boolean;
  /** 막혀서 가지 못한 칸이 있었는지 */
  blocked: boolean;
}

/** 모퉁이를 돌아가는 길로 고를 때의 순위. 낮을수록 좋다. */
const CORNER = { free: 0, own: 1, cut: 2, never: 3 } as const;

function cornerRank(board: Board, owners: readonly number[], pair: number, cell: number): number {
  const dot = board.puzzle.dotAt[cell];
  const owner = owners[cell];
  if (owner === pair) return CORNER.own;
  // 다른 쌍의 점은 지날 수 없고, 짝 점은 닿는 순간 길이 끝나서 그 너머로 갈 수 없다.
  if (dot >= 0) return CORNER.never;
  return owner >= 0 ? CORNER.cut : CORNER.free;
}

/**
 * 길의 머리(head)에서 cell까지 한 칸씩 밟아 갈 칸들.
 * 같은 줄이나 같은 열이면 그 사이를 차례로 지난다. 대각선으로 한 칸 떨어진 곳이면 두 모퉁이 가운데
 * 비어 있는 쪽을 골라 돌아간다. 그보다 멀리 비스듬히 떨어진 곳은 어느 길로 갈지 알 수 없으므로 null이다.
 */
function routeTo(board: Board, pair: number, head: number, cell: number): number[] | null {
  const { size } = board.puzzle;
  const from = cellOf(size, head);
  const to = cellOf(size, cell);
  const dc = to.col - from.col;
  const dr = to.row - from.row;

  if (dc === 0 || dr === 0) {
    const stride = dr === 0 ? Math.sign(dc) : Math.sign(dr) * size;
    const steps = Math.abs(dc) + Math.abs(dr);
    return Array.from({ length: steps }, (_, index) => head + stride * (index + 1));
  }
  if (Math.abs(dc) !== 1 || Math.abs(dr) !== 1) return null;

  // 가려는 칸이 다른 쌍의 점이면 모퉁이까지만 가는 것도 하지 않는다.
  const dot = board.puzzle.dotAt[cell];
  if (dot >= 0 && dot !== pair) return null;
  const owners = ownersOf(board);
  // 옆으로 먼저 가는 모퉁이, 위아래로 먼저 가는 모퉁이
  const corners = [from.row * size + to.col, to.row * size + from.col];
  const ranks = corners.map((corner) => cornerRank(board, owners, pair, corner));
  const best = ranks[1] < ranks[0] ? 1 : 0;
  if (ranks[best] === CORNER.never) return null;
  return [corners[best], cell];
}

/**
 * 그리던 길(path)을 이웃한 칸 cell로 한 칸 옮긴다. 갈 수 없으면 false이고 아무것도 바뀌지 않는다.
 * path를 직접 고쳐 쓴다. 다른 쌍의 길은 여기서 따지지 않는다.
 */
function stepInto(puzzle: Puzzle, pair: number, path: number[], cell: number): boolean {
  // 자기 길을 다시 밟으면 거기까지 되돌아간다. 이어진 길도 되돌아갈 수는 있다.
  const own = path.indexOf(cell);
  if (own >= 0) {
    path.length = own + 1;
    return true;
  }
  // 짝 점에 닿은 길은 더 나아가지 않는다.
  if (reachesPartner(puzzle, pair, path)) return false;
  const dot = puzzle.dotAt[cell];
  if (dot >= 0 && dot !== pair) return false;
  path.push(cell);
  return true;
}

/**
 * 다른 쌍의 길(theirs)에서 지금 그리는 길(mine)이 지나간 칸부터 뒤쪽을 잘라 낸다.
 * 그 쌍의 첫 점에 붙은 쪽만 남고, 점만 남으면 길이 없는 것으로 친다.
 */
function trimmed(theirs: Path, mine: ReadonlySet<number>): Path {
  const hit = theirs.findIndex((cell) => mine.has(cell));
  if (hit < 0) return theirs;
  return hit <= 1 ? [] : theirs.slice(0, hit);
}

/**
 * 그리는 손가락이 cell 칸으로 옮겨 갔을 때.
 * - 자기 길 위의 칸이면 거기까지 되돌아간다(바로 앞 칸이면 한 칸 줄어든다).
 * - 빈칸이면 길이 늘어난다. 다른 쌍의 길이 있던 칸이면 그 길을 거기서 자르고 지나간다.
 * - 다른 쌍의 점으로는 갈 수 없고, 짝 점에 닿으면 길이 이어져서 더 늘어나지 않는다.
 * - 손가락이 빨라 여러 칸을 건너뛰었으면 그 사이의 칸을 차례로 밟는다(routeTo). 가다가 막히면 거기서 멈춘다.
 *
 * restore에 그리기 시작할 때의 길들을 주면, 다른 쌍의 길은 그때의 모습에서 지금 길이 덮은 데만 잘라 낸다.
 * 그래서 남의 길을 스쳤다가 손가락을 떼기 전에 되돌아오면 잘렸던 길이 되살아난다.
 * 주지 않으면 한 번 잘린 길은 그대로다.
 * 받은 판은 바꾸지 않는다. 달라진 것이 없으면 받은 판을 그대로 돌려준다.
 */
export function dragTo(board: Board, pair: number, cell: number, restore?: readonly Path[]): DragResult {
  const before = board.paths[pair] ?? [];
  const same = (blocked: boolean): DragResult => ({
    board,
    grew: 0,
    cut: [],
    mended: [],
    linked: false,
    blocked,
  });
  const cells = board.puzzle.size ** 2;
  if (before.length === 0 || !(cell >= 0 && cell < cells)) return same(true);
  const head = before[before.length - 1];
  if (cell === head) return same(false);

  const after = [...before];
  let blocked = false;
  if (before.includes(cell)) {
    stepInto(board.puzzle, pair, after, cell);
  } else {
    const route = routeTo(board, pair, head, cell);
    if (!route) return same(true);
    for (const next of route) {
      if (stepInto(board.puzzle, pair, after, next)) continue;
      blocked = true;
      break;
    }
  }
  if (after.length === before.length && after[after.length - 1] === head) return same(blocked);

  const mine = new Set(after);
  const cut: number[] = [];
  const mended: number[] = [];
  const paths = board.paths.map((old, other) => {
    if (other === pair) return after;
    const next = trimmed(restore?.[other] ?? old, mine);
    if (next.length < old.length) cut.push(other);
    else if (next.length > old.length) mended.push(other);
    return next.length === old.length ? old : next;
  });
  return {
    board: { ...board, paths },
    grew: after.length - before.length,
    cut,
    mended,
    linked: reachesPartner(board.puzzle, pair, after) && !reachesPartner(board.puzzle, pair, before),
    blocked,
  };
}

/** 손가락을 뗐을 때. 점만 누르고 한 칸도 나가지 않았으면 그 쌍의 길은 없는 것이 된다. */
export function endStroke(board: Board, pair: number): Board {
  const path = board.paths[pair];
  return path && path.length === 1 ? withPath(board, pair, []) : board;
}

/** 그 쌍의 길을 지운다. */
export function clearPath(board: Board, pair: number): Board {
  return board.paths[pair]?.length ? withPath(board, pair, []) : board;
}

// ───────── 화면 배치 ─────────

/** 한 칸의 가장 큰 크기(px). 작은 판에서 칸이 지나치게 커지지 않게 한다. */
export const MAX_CELL = 44;
/** 판 둘레에 비워 두는 여백(px). 판의 테두리와 그림자가 들어간다. */
export const BOARD_MARGIN = 8;

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

/** 주어진 자리에서 여백을 뺀 곳에 들어가는 가장 큰 칸 크기를 구하고, 판을 그 자리 한가운데에 놓는다. */
export function boardLayout(size: number, area: Area): BoardLayout {
  const cell = Math.min(
    MAX_CELL,
    Math.floor((area.width - BOARD_MARGIN * 2) / size),
    Math.floor((area.height - BOARD_MARGIN * 2) / size),
  );
  return {
    cell,
    left: Math.round(area.x + (area.width - size * cell) / 2),
    top: Math.round(area.y + (area.height - size * cell) / 2),
  };
}

/**
 * (x, y)에 놓인 칸의 번호. 판 밖이면 null이다.
 * reach를 주면 판 밖으로 그만큼 벗어난 자리까지는 가장 가까운 가장자리 칸으로 친다.
 * 가장자리를 따라 그리다 손가락이 살짝 나가도 길이 끊기지 않게 하려는 것이다.
 */
export function cellAt(size: number, layout: BoardLayout, x: number, y: number, reach = 0): number | null {
  const span = size * layout.cell;
  const dx = x - layout.left;
  const dy = y - layout.top;
  if (dx < -reach || dy < -reach || dx >= span + reach || dy >= span + reach) return null;
  const col = Math.min(size - 1, Math.max(0, Math.floor(dx / layout.cell)));
  const row = Math.min(size - 1, Math.max(0, Math.floor(dy / layout.cell)));
  return row * size + col;
}

/**
 * 그리는 도중에 손가락이 있는 칸. cellAt과 같지만, 지금 있는 칸(current)의 둘레로 slack만큼 벗어난 데까지는
 * 아직 그 칸에 있는 것으로 친다. 손가락이 두 칸의 경계에 걸쳐 있을 때 길이 왔다 갔다 떨리지 않게 한다.
 */
export function stickyCellAt(
  size: number,
  layout: BoardLayout,
  x: number,
  y: number,
  current: number,
  slack: number,
  reach = 0,
): number | null {
  const { col, row } = cellOf(size, current);
  const left = layout.left + col * layout.cell;
  const top = layout.top + row * layout.cell;
  const inside =
    x >= left - slack &&
    x < left + layout.cell + slack &&
    y >= top - slack &&
    y < top + layout.cell + slack;
  return inside ? current : cellAt(size, layout, x, y, reach);
}

// ───────── 판의 차례 ─────────

/** 판 크기마다: 몇 판 동안 나오는지, 깼을 때의 점수, 깼을 때 돌려받는 시간(초) */
export interface SizePlan {
  size: number;
  boards: number;
  points: number;
  seconds: number;
}

/** 뒤로 갈수록 판이 커진다. 마지막 크기는 끝날 때까지 나온다. */
export const SIZE_PLANS: readonly SizePlan[] = [
  { size: 5, boards: 3, points: 20, seconds: 12 },
  { size: 6, boards: 3, points: 35, seconds: 14 },
  { size: 7, boards: Number.POSITIVE_INFINITY, points: 50, seconds: 16 },
];

/** stage번째 판(1부터)의 계획과, 그 크기의 판으로는 몇 번째인지(0부터) */
function planFor(stage: number): { plan: SizePlan; turn: number } {
  let turn = Math.max(1, Math.floor(stage)) - 1;
  for (const plan of SIZE_PLANS) {
    if (turn < plan.boards) return { plan, turn };
    turn -= plan.boards;
  }
  return { plan: SIZE_PLANS[SIZE_PLANS.length - 1], turn };
}

/** stage번째 판의 크기 */
export function stageSize(stage: number): number {
  return planFor(stage).plan.size;
}

// ───────── 시간과 점수 ─────────

/** 처음에 주어지는 시간(초). 판을 깨서 돌려받아도 이보다 많아지지는 않는다. */
export const START_SECONDS = 60;
/** 가장 큰 판이 거듭될 때마다 돌려받는 시간이 줄어드는 양(초) */
export const LATE_SECONDS_STEP = 2;
/** 아무리 뒤의 판이라도 이만큼은 돌려받는다(초) */
export const MIN_CLEAR_SECONDS = 5;
/** 끝났을 때 풀던 판에서 이어 둔 쌍 하나마다 주는 점수 */
export const PAIR_POINTS = 2;

/** stage번째 판을 깼을 때의 점수. 큰 판일수록 많다. */
export function clearPoints(stage: number): number {
  return planFor(stage).plan.points;
}

/**
 * stage번째 판을 깼을 때 돌려받는 시간(초). 큰 판일수록 많이 돌려받지만,
 * 가장 큰 판은 거듭될수록 조금씩 줄어서 아무리 잘 풀어도 한 판은 언젠가 끝난다.
 */
export function clearSeconds(stage: number): number {
  const { plan, turn } = planFor(stage);
  const late = Number.isFinite(plan.boards) ? 0 : turn * LATE_SECONDS_STEP;
  return Math.max(MIN_CLEAR_SECONDS, plan.seconds - late);
}

// ───────── 한 판의 진행 ─────────

export interface RunState {
  /** 지금 판의 번호. 1부터 센다. */
  stage: number;
  board: Board;
  /** 남은 시간(초) */
  timeLeft: number;
  /** 깬 판으로 얻은 점수. 풀던 판에서 이어 둔 쌍의 점수는 finalScore가 더한다. */
  score: number;
  boardsCleared: number;
  /** 깬 판들에서 이은 쌍의 수 */
  pairsLinked: number;
}

export interface ClearReward {
  points: number;
  /** 돌려받은 시간(초). 시간이 이미 가득하면 0일 수 있다. */
  seconds: number;
}

export function newRun(random: () => number): RunState {
  return {
    stage: 1,
    board: newBoard(generatePuzzle(stageSize(1), random)),
    timeLeft: START_SECONDS,
    score: 0,
    boardsCleared: 0,
    pairsLinked: 0,
  };
}

/** 시간이 흐른다. 0 아래로는 내려가지 않는다. */
export function elapse(run: RunState, seconds: number): RunState {
  return { ...run, timeLeft: Math.max(0, run.timeLeft - Math.max(0, seconds)) };
}

/** 시간이 다 되어 끝났는지 */
export function isOver(run: RunState): boolean {
  return run.timeLeft <= 0;
}

/**
 * 지금 판을 깼으면 점수와 시간을 받는다. 아직 못 깼거나 이미 끝났으면 reward가 null이고 상태는 그대로다.
 * 다음 판은 nextStage가 깐다.
 */
export function claimClear(run: RunState): { run: RunState; reward: ClearReward | null } {
  if (isOver(run) || !isSolved(run.board)) return { run, reward: null };
  const timeLeft = Math.min(START_SECONDS, run.timeLeft + clearSeconds(run.stage));
  const reward: ClearReward = { points: clearPoints(run.stage), seconds: timeLeft - run.timeLeft };
  return {
    run: {
      ...run,
      timeLeft,
      score: run.score + reward.points,
      boardsCleared: run.boardsCleared + 1,
      pairsLinked: run.pairsLinked + run.board.paths.length,
    },
    reward,
  };
}

/** 다음 판으로 넘어간다. 판을 깬 뒤에 부른다. */
export function nextStage(run: RunState, random: () => number): RunState {
  const stage = run.stage + 1;
  return { ...run, stage, board: newBoard(generatePuzzle(stageSize(stage), random)) };
}

/** 풀던 판에서 이어 둔 쌍으로 받는 점수. 이미 깬 판이면 그 판의 점수에 들어 있으므로 0이다. */
export function pendingPoints(run: RunState): number {
  return isSolved(run.board) ? 0 : linkedCount(run.board) * PAIR_POINTS;
}

/** 끝났을 때의 점수: 깬 판의 점수에, 풀던 판에서 이어 둔 쌍의 점수를 더한다. */
export function finalScore(run: RunState): number {
  return run.score + pendingPoints(run);
}

// ───────── 단계 모드 ─────────

/** 단계 모드의 난이도 한 칸: 판의 크기와 쌍의 수 */
export interface LevelPlan {
  size: number;
  pairs: number;
}

/**
 * 단계 모드가 거치는 난이도. 판이 커지고, 같은 크기에서는 쌍이 줄어든다:
 * 쌍이 적을수록 길 하나가 길고 구불구불해서 어렵다. 쌍은 모양의 가짓수(여덟)를 넘지 않는다.
 */
export const LEVEL_PLANS: readonly LevelPlan[] = [
  { size: 5, pairs: 5 },
  { size: 5, pairs: 4 },
  { size: 6, pairs: 6 },
  { size: 6, pairs: 5 },
  { size: 7, pairs: 8 },
  { size: 7, pairs: 7 },
  { size: 7, pairs: 6 },
  { size: 8, pairs: 8 },
  { size: 8, pairs: 7 },
];

/** 단계 모드가 거치는 난이도의 수 */
export const LEVEL_STEPS = LEVEL_PLANS.length;

/** 단계 모드의 level(1부터)번째 단계가 쓰는 난이도 번호(1부터) */
export function levelStage(level: number): number {
  return difficultyOf(level, LEVEL_STEPS);
}

/** 단계 모드의 level번째 단계의 판 크기와 쌍의 수 */
export function levelPlan(level: number): LevelPlan {
  return LEVEL_PLANS[levelStage(level) - 1];
}

/**
 * 단계 모드의 한 단계. 시간은 흐르지 않고(elapse를 부르지 않는다), 판 하나를 깨면 끝난다.
 * 같은 random이면 같은 판이 나온다.
 */
export function levelRun(level: number, random: () => number): RunState {
  const plan = levelPlan(level);
  return {
    stage: 1,
    board: newBoard(generatePuzzle(plan.size, random, plan.pairs)),
    timeLeft: START_SECONDS,
    score: 0,
    boardsCleared: 0,
    pairsLinked: 0,
  };
}
