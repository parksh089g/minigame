import { describe, expect, it } from 'vitest';
import { GAME_WIDTH, MAX_GAME_HEIGHT, MIN_GAME_HEIGHT } from '../../config';
import {
  areAdjacent,
  BOARD_MARGIN,
  boardLayout,
  cellAt,
  cellOf,
  claimClear,
  clearPath,
  clearPoints,
  clearSeconds,
  coveredCount,
  dragTo,
  elapse,
  endStroke,
  fallbackPartition,
  finalScore,
  generatePuzzle,
  isGoodPartition,
  isLinked,
  isOver,
  isSolved,
  LATE_SECONDS_STEP,
  linkedCount,
  MAX_CELL,
  MAX_GENERATE_ATTEMPTS,
  MAX_STUBS,
  maxPathCells,
  MIN_CLEAR_SECONDS,
  MIN_PATH_CELLS,
  neighboursOf,
  newBoard,
  newRun,
  nextStage,
  openCells,
  ownersOf,
  PAIR_POINTS,
  pairRange,
  pendingPoints,
  puzzleFrom,
  SIZE_PLANS,
  stageSize,
  START_SECONDS,
  startStroke,
  stickyCellAt,
  stubCount,
  type Board,
  type Puzzle,
  type RunState,
} from './rules';

/** 시드가 같으면 같은 수열이 나오는 난수(mulberry32). */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SIZES = [5, 6, 7] as const;
/** 크기마다 만들어 보는 판의 수 */
const BOARDS_PER_SIZE = 300;

/**
 * 손으로 만든 5 × 5 판. 대문자가 점, 소문자가 풀이의 길이다. 쌍 번호는 A가 0, B가 1, ... 이다.
 *
 *   A a a a a
 *   B b E C a
 *   D b e c A
 *   d B E c c
 *   d d d D C
 */
const at = (row: number, col: number): number => row * 5 + col;
const HAND_PATHS: number[][] = [
  [at(0, 0), at(0, 1), at(0, 2), at(0, 3), at(0, 4), at(1, 4), at(2, 4)],
  [at(1, 0), at(1, 1), at(2, 1), at(3, 1)],
  [at(1, 3), at(2, 3), at(3, 3), at(3, 4), at(4, 4)],
  [at(2, 0), at(3, 0), at(4, 0), at(4, 1), at(4, 2), at(4, 3)],
  [at(1, 2), at(2, 2), at(3, 2)],
];
const A = 0;
const B = 1;
const C = 2;
const D = 3;
const E = 4;
const handPuzzle = (): Puzzle => puzzleFrom(5, HAND_PATHS);

/**
 * 점이 두 쌍뿐이라 가운데가 텅 빈 5 × 5 판. 길을 마음대로 돌려 보는 데 쓴다.
 * 첫 쌍(0)의 점은 (0, 0)과 (0, 2), 둘째 쌍(1)의 점은 (4, 0)과 (4, 2)다.
 */
const openPuzzle = (): Puzzle =>
  puzzleFrom(5, [
    [at(0, 0), at(0, 1), at(0, 2)],
    [at(4, 0), at(4, 1), at(4, 2)],
  ]);

/** cells를 차례로 지나게 그린다. 첫 칸에서 그리기를 시작하고, 손가락은 떼지 않은 상태다. */
function draw(board: Board, cells: readonly number[]): { board: Board; pair: number } {
  const started = startStroke(board, cells[0]);
  if (!started) throw new Error(`${cells[0]}번 칸에서는 그리기를 시작할 수 없다`);
  let next = started.board;
  for (const cell of cells.slice(1)) next = dragTo(next, started.pair, cell).board;
  return { board: next, pair: started.pair };
}

/** cells를 차례로 지나게 그리고 손가락을 뗀다. */
function drawn(board: Board, cells: readonly number[]): Board {
  const stroke = draw(board, cells);
  return endStroke(stroke.board, stroke.pair);
}

/** 저장된 풀이대로 모든 쌍을 그린 판 */
function solved(puzzle: Puzzle): Board {
  return puzzle.solution.reduce((board, path) => drawn(board, path), newBoard(puzzle));
}

/** 길에서 방향이 바뀌는 칸과 마지막 칸만 남긴다. 손가락이 빨라 그 사이를 건너뛴 것을 흉내 낸다. */
function cornersOf(path: readonly number[]): number[] {
  return path.filter(
    (cell, index) =>
      index === 0 ||
      index === path.length - 1 ||
      cell - path[index - 1] !== path[index + 1] - cell,
  );
}

describe('칸', () => {
  it('칸 번호는 왼쪽 위부터 오른쪽으로 매긴다', () => {
    expect(cellOf(5, 0)).toEqual({ col: 0, row: 0 });
    expect(cellOf(5, 7)).toEqual({ col: 2, row: 1 });
    expect(cellOf(7, 48)).toEqual({ col: 6, row: 6 });
  });

  it('이웃은 위아래와 옆의 칸이고, 가장자리에서는 판 안의 칸만 센다', () => {
    expect(neighboursOf(5, 12).sort((a, b) => a - b)).toEqual([7, 11, 13, 17]);
    expect(neighboursOf(5, 0).sort((a, b) => a - b)).toEqual([1, 5]);
    expect(neighboursOf(5, 4).sort((a, b) => a - b)).toEqual([3, 9]);
    expect(neighboursOf(5, 24).sort((a, b) => a - b)).toEqual([19, 23]);
  });

  it('줄이 바뀌는 자리의 두 칸은 번호가 이어져도 붙어 있지 않다', () => {
    expect(areAdjacent(5, 4, 5)).toBe(false);
    expect(areAdjacent(5, 3, 4)).toBe(true);
    expect(areAdjacent(5, 4, 9)).toBe(true);
    expect(areAdjacent(5, 0, 6)).toBe(false);
    expect(areAdjacent(5, 7, 7)).toBe(false);
  });
});

/** 크기마다 만들어 둔 판들과, 한 판을 만드는 데 걸린 평균 시간(ms). 여러 테스트가 같은 판을 본다. */
const made = new Map<number, { puzzles: Puzzle[]; averageMs: number }>();

function madeBoards(size: number): { puzzles: Puzzle[]; averageMs: number } {
  const ready = made.get(size);
  if (ready) return ready;
  const random = seeded(4000 + size);
  const began = performance.now();
  const puzzles = Array.from({ length: BOARDS_PER_SIZE }, () => generatePuzzle(size, random));
  const result = { puzzles, averageMs: (performance.now() - began) / BOARDS_PER_SIZE };
  made.set(size, result);
  return result;
}

/**
 * 만들어진 판이 어긴 조건을 글로 모은다. 규칙 쪽의 isGoodPartition을 믿지 않고 여기서 따로 따진다.
 * 비어 있으면 모든 조건을 지킨 판이다.
 */
function problemsOf(puzzle: Puzzle): string[] {
  const { size, solution, dots, dotAt } = puzzle;
  const problems: string[] = [];
  const [fewest, most] = pairRange(size);
  if (solution.length < fewest || solution.length > most) problems.push(`쌍이 ${solution.length}개다`);

  const owner = Array<number>(size * size).fill(-1);
  solution.forEach((path, pair) => {
    for (const cell of path) {
      if (owner[cell] !== -1) problems.push(`${cell}번 칸을 두 길이 지난다`);
      owner[cell] = pair;
    }
  });
  if (owner.includes(-1)) problems.push('덮이지 않은 칸이 있다');

  solution.forEach((path, pair) => {
    if (path.length < MIN_PATH_CELLS) problems.push(`${pair}번 길이 ${path.length}칸뿐이다`);
    if (path.length > maxPathCells(size)) problems.push(`${pair}번 길이 ${path.length}칸이나 된다`);
    for (let index = 1; index < path.length; index += 1) {
      if (!areAdjacent(size, path[index - 1], path[index])) problems.push(`${pair}번 길이 끊겼다`);
    }
    const [first, last] = dots[pair];
    if (first !== path[0] || last !== path[path.length - 1]) problems.push(`${pair}번 쌍의 점이 길 끝에 없다`);
    if (areAdjacent(size, first, last)) problems.push(`${pair}번 쌍의 두 점이 붙어 있다`);
  });

  for (let row = 0; row < size - 1; row += 1) {
    for (let col = 0; col < size - 1; col += 1) {
      const cell = row * size + col;
      const block = [owner[cell + 1], owner[cell + size], owner[cell + size + 1]];
      if (block.every((pair) => pair === owner[cell])) problems.push(`${cell}번 칸에서 한 길이 2 × 2를 채운다`);
    }
  }

  // 점이 놓인 칸은 쌍마다 둘이고, 나머지 칸에는 점이 없다.
  const dotCells = new Set(dots.flat());
  if (dotCells.size !== solution.length * 2) problems.push('점의 수가 맞지 않는다');
  dotAt.forEach((pair, cell) => {
    if (pair !== (dotCells.has(cell) ? owner[cell] : -1)) problems.push(`${cell}번 칸의 점 표시가 틀렸다`);
  });
  if (dotAt.length !== size * size) problems.push('점 표시의 칸 수가 틀렸다');

  const stubs = solution.filter((path) => path.length === MIN_PATH_CELLS).length;
  if (stubs > MAX_STUBS) problems.push(`세 칸짜리 길이 ${stubs}개다`);
  return problems;
}

describe('판 만들기', () => {
  it.each(SIZES)('한 변이 %i칸인 판 수백 개가 모두 조건을 지킨다', (size) => {
    const { puzzles } = madeBoards(size);
    expect(puzzles).toHaveLength(BOARDS_PER_SIZE);
    for (const puzzle of puzzles) {
      expect(puzzle.size).toBe(size);
      expect(problemsOf(puzzle)).toEqual([]);
      expect(isGoodPartition(size, puzzle.solution)).toBe(true);
      expect(stubCount(puzzle.solution)).toBeLessThanOrEqual(MAX_STUBS);
    }

    // 쌍의 수가 한쪽으로 쏠리지 않고 범위 안의 수가 모두 나온다.
    const [fewest, most] = pairRange(size);
    const pairCounts = new Set(puzzles.map((puzzle) => puzzle.solution.length));
    expect([...pairCounts].sort((a, b) => a - b)).toEqual(
      Array.from({ length: most - fewest + 1 }, (_, index) => fewest + index),
    );
    // 같은 판이 되풀이되지 않는다.
    expect(new Set(puzzles.map((puzzle) => JSON.stringify(puzzle.solution))).size).toBeGreaterThan(
      BOARDS_PER_SIZE * 0.95,
    );
  });

  it('조건을 따지는 테스트 쪽 검사가 어긴 판을 잡아낸다', () => {
    expect(problemsOf(handPuzzle())).toEqual([]);
    // 한 길이 2 × 2를 채우고 두 점이 붙어 있는 판
    const bad = puzzleFrom(5, [[0, 1, 6, 5], ...fallbackPartition(5).slice(2), [2, 3, 4, 9, 8, 7]]);
    const problems = problemsOf(bad).join(' / ');
    expect(problems).toContain('2 × 2');
    expect(problems).toContain('붙어 있다');
  });

  it.each(SIZES)('한 변이 %i칸인 판의 저장된 풀이를 그대로 그리면 판을 깬다', (size) => {
    for (const puzzle of madeBoards(size).puzzles) {
      const board = solved(puzzle);
      expect(isSolved(board)).toBe(true);
      expect(board.paths).toEqual(puzzle.solution);

      // 꺾이는 칸만 짚으며 빠르게 그어도 사이의 칸이 채워져 같은 결과가 된다.
      const quick = puzzle.solution.reduce(
        (drawing, path) => drawn(drawing, cornersOf(path)),
        newBoard(puzzle),
      );
      expect(quick.paths).toEqual(puzzle.solution);
    }
  });

  it('한 판을 만드는 데 평균 50ms가 한참 안 걸린다', () => {
    for (const size of SIZES) expect(madeBoards(size).averageMs).toBeLessThan(50);
  });

  it('씨앗이 같으면 같은 판이 나오고, 다르면 다른 판이 나온다', () => {
    for (const size of SIZES) {
      const first = generatePuzzle(size, seeded(77));
      expect(generatePuzzle(size, seeded(77))).toEqual(first);
      const seen = new Set<string>();
      for (let seed = 0; seed < 40; seed += 1) {
        seen.add(JSON.stringify(generatePuzzle(size, seeded(seed)).solution));
      }
      expect(seen.size).toBeGreaterThanOrEqual(38);
    }
  });

  it('난수가 무엇을 내놓든 정해진 횟수 안에 끝나고, 안 되면 정해 둔 판을 쓴다', () => {
    for (const size of SIZES) {
      for (const stuck of [0, 0.5, 0.999999]) {
        let calls = 0;
        const puzzle = generatePuzzle(size, () => {
          calls += 1;
          return stuck;
        });
        expect(isGoodPartition(size, puzzle.solution)).toBe(true);
        expect(isSolved(solved(puzzle))).toBe(true);
        // 한 번 해 볼 때 길을 잇는 횟수는 칸 수보다 적고, 이을 때마다 난수를 많아야 두 번 쓴다.
        expect(calls).toBeLessThanOrEqual(MAX_GENERATE_ATTEMPTS * size * size * 2 + 20);
      }
    }
  });

  it('정해 둔 판은 줄마다 길 하나이고 조건을 모두 지킨다', () => {
    for (const size of SIZES) {
      const paths = fallbackPartition(size);
      expect(paths).toHaveLength(size);
      expect(isGoodPartition(size, paths)).toBe(true);
      expect(stubCount(paths)).toBe(0);
    }
  });

  it('조건을 어긴 길 나누기를 걸러 낸다', () => {
    expect(isGoodPartition(5, HAND_PATHS)).toBe(true);
    const without = (pair: number): number[][] => HAND_PATHS.filter((_, index) => index !== pair);

    // 덮이지 않은 칸이 있다: E의 가운데 칸을 뺐다.
    expect(isGoodPartition(5, [...without(E), [at(1, 2), at(3, 2)]])).toBe(false);
    // 길이 이웃한 칸으로 이어지지 않는다: B의 두 칸을 맞바꿨다.
    expect(isGoodPartition(5, [...without(B), [at(1, 0), at(2, 1), at(1, 1), at(3, 1)]])).toBe(false);
    // 한 칸을 두 길이 지난다: E가 C의 칸까지 간다.
    expect(isGoodPartition(5, [...without(E), [at(1, 2), at(2, 2), at(3, 2), at(3, 3)]])).toBe(false);
    // 두 칸짜리 길: C의 끝 두 칸을 따로 떼었다. (여섯 쌍이라 쌍의 수도 넘친다.)
    const short = [...without(C), HAND_PATHS[C].slice(0, 3), HAND_PATHS[C].slice(3)];
    expect(isGoodPartition(5, short)).toBe(false);

    const rows6 = fallbackPartition(6);
    const on6 = (row: number, col: number): number => row * 6 + col;
    // 두 점이 붙어 있다: 가운데 세 칸을 빙 둘러싼 길의 양 끝이 맞닿는다. 다른 조건은 모두 지킨다.
    const ring = [
      ...[0, 1, 2, 3, 4].map((col) => on6(0, col)),
      on6(1, 4),
      ...[4, 3, 2, 1, 0].map((col) => on6(2, col)),
      on6(1, 0),
    ];
    const inside = [on6(1, 1), on6(1, 2), on6(1, 3)];
    const side = [on6(0, 5), on6(1, 5), on6(2, 5)];
    expect(areAdjacent(6, ring[0], ring[ring.length - 1])).toBe(true);
    expect(isGoodPartition(6, [ring, inside, side, ...rows6.slice(3)])).toBe(false);
    // 양 끝을 떼어 놓으면(둘러싼 길이 한 칸 짧고 안쪽 길이 한 칸 길면) 좋은 판이다.
    expect(isGoodPartition(6, [ring.slice(0, -1), [on6(1, 0), ...inside], side, ...rows6.slice(3)])).toBe(true);

    // 2 × 2 덩어리: 첫 줄을 다 지난 길이 되돌아 꺾여 오른쪽 위 네 칸을 채운다. 다른 조건은 모두 지킨다.
    const hook = [...rows6[0], on6(1, 5), on6(1, 4)];
    const rest = [on6(1, 0), on6(1, 1), on6(1, 2), on6(1, 3)];
    expect(isGoodPartition(6, [hook, rest, ...rows6.slice(2)])).toBe(false);
    expect(isGoodPartition(6, [[...rows6[0], on6(1, 5)], [...rest, on6(1, 4)], ...rows6.slice(2)])).toBe(true);

    // 쌍이 너무 많다: 7 × 7 판의 위 두 줄을 넷으로 쪼개 아홉 쌍이 됐다. 다른 조건은 모두 지킨다.
    const rows7 = fallbackPartition(7);
    const nine = [[0, 1, 2], [3, 4, 5, 6], [7, 8, 9], [10, 11, 12, 13], ...rows7.slice(2)];
    expect(nine).toHaveLength(9);
    expect(isGoodPartition(7, nine)).toBe(false);
    expect(isGoodPartition(7, [[0, 1, 2], [3, 4, 5, 6], ...rows7.slice(1)])).toBe(true);
  });

  it('쌍의 수는 판이 클수록 많다', () => {
    expect(pairRange(5)).toEqual([4, 5]);
    expect(pairRange(6)).toEqual([5, 6]);
    expect(pairRange(7)).toEqual([6, 8]);
  });
});

describe('길 그리기', () => {
  it('점에서 시작해 빈칸으로 가면 길이 한 칸씩 늘어난다', () => {
    const board = newBoard(handPuzzle());
    const started = startStroke(board, at(1, 0));
    expect(started?.pair).toBe(B);
    expect(started?.board.paths[B]).toEqual([at(1, 0)]);

    const step = dragTo(started!.board, B, at(1, 1));
    expect(step).toMatchObject({ grew: 1, cut: [], linked: false, blocked: false });
    expect(step.board.paths[B]).toEqual([at(1, 0), at(1, 1)]);
    // 받은 판은 바뀌지 않는다.
    expect(started!.board.paths[B]).toEqual([at(1, 0)]);
    expect(board.paths[B]).toEqual([]);
  });

  it('점도 길도 없는 칸이나 판 밖에서는 시작할 수 없다', () => {
    const board = newBoard(handPuzzle());
    expect(startStroke(board, at(0, 2))).toBeNull();
    expect(startStroke(board, -1)).toBeNull();
    expect(startStroke(board, 25)).toBeNull();
  });

  it('어느 점에서든 시작할 수 있다', () => {
    const board = newBoard(handPuzzle());
    const backwards = drawn(board, [...HAND_PATHS[B]].reverse());
    expect(isLinked(backwards, B)).toBe(true);
    expect(backwards.paths[B]).toEqual([...HAND_PATHS[B]].reverse());
  });

  it('바로 앞 칸으로 돌아가면 한 칸 줄어든다', () => {
    const { board, pair } = draw(newBoard(handPuzzle()), [at(1, 0), at(1, 1), at(2, 1)]);
    const back = dragTo(board, pair, at(1, 1));
    expect(back).toMatchObject({ grew: -1, blocked: false, linked: false });
    expect(back.board.paths[B]).toEqual([at(1, 0), at(1, 1)]);
  });

  it('자기 길의 앞쪽 칸을 다시 밟으면 거기까지 되돌아간다', () => {
    // 둘째 쌍의 점에서 올라가 오른쪽으로 꺾고 다시 내려와, 자기 길의 둘째 칸 옆에 선다.
    const cells = [at(4, 0), at(3, 0), at(2, 0), at(2, 1), at(3, 1)];
    const { board, pair } = draw(newBoard(openPuzzle()), cells);
    expect(pair).toBe(1);
    expect(board.paths[1]).toEqual(cells);

    const back = dragTo(board, 1, at(3, 0));
    expect(back).toMatchObject({ grew: -3, blocked: false, cut: [] });
    expect(back.board.paths[1]).toEqual([at(4, 0), at(3, 0)]);
    // 떨어져 있는 칸이어도 자기 길 위라면 되돌아간다.
    expect(dragTo(board, 1, at(2, 0)).board.paths[1]).toEqual(cells.slice(0, 3));
    // 처음 점까지 되돌아갈 수도 있다.
    expect(dragTo(board, 1, at(4, 0)).board.paths[1]).toEqual([at(4, 0)]);
  });

  it('같은 칸에 머물면 아무 일도 없다', () => {
    const { board, pair } = draw(newBoard(handPuzzle()), [at(1, 0), at(1, 1)]);
    const stay = dragTo(board, pair, at(1, 1));
    expect(stay.board).toBe(board);
    expect(stay).toMatchObject({ grew: 0, blocked: false });
  });

  it('다른 쌍의 점으로는 갈 수 없다', () => {
    const { board, pair } = draw(newBoard(handPuzzle()), [at(1, 0), at(1, 1)]);
    // (1, 2)는 E의 점이다.
    const bump = dragTo(board, pair, at(1, 2));
    expect(bump.board).toBe(board);
    expect(bump).toMatchObject({ grew: 0, blocked: true, linked: false, cut: [] });
  });

  it('짝 점에 닿으면 이어지고, 그 뒤로는 더 늘어나지 않는다', () => {
    const { board, pair } = draw(newBoard(handPuzzle()), HAND_PATHS[B].slice(0, -1));
    expect(isLinked(board, B)).toBe(false);
    const link = dragTo(board, pair, at(3, 1));
    expect(link).toMatchObject({ grew: 1, linked: true, blocked: false });
    expect(isLinked(link.board, B)).toBe(true);
    expect(linkedCount(link.board)).toBe(1);

    // 이어진 길의 끝에서 옆의 빈칸으로 끌어도 그대로다.
    const more = dragTo(link.board, B, at(3, 0));
    expect(more.board).toBe(link.board);
    expect(more.blocked).toBe(true);

    // 되돌아가면 다시 풀린다.
    const back = dragTo(link.board, B, at(2, 1));
    expect(back).toMatchObject({ grew: -1, linked: false });
    expect(isLinked(back.board, B)).toBe(false);
  });

  it('처음 점으로 돌아와도 이어진 것으로 치지 않는다', () => {
    const { board, pair } = draw(newBoard(handPuzzle()), [at(1, 0), at(1, 1), at(1, 0)]);
    expect(board.paths[pair]).toEqual([at(1, 0)]);
    expect(isLinked(board, pair)).toBe(false);
  });

  it('다른 쌍의 길을 지나가면 그 길이 거기서 잘린다', () => {
    // E를 먼저 잇고, B가 E의 가운데 칸을 가로지른다.
    const linked = drawn(newBoard(handPuzzle()), HAND_PATHS[E]);
    expect(isLinked(linked, E)).toBe(true);
    const { board } = draw(linked, [at(1, 0), at(1, 1), at(2, 1)]);
    const crossing = dragTo(board, B, at(2, 2));
    expect(crossing).toMatchObject({ grew: 1, cut: [E], blocked: false });
    // E는 첫 점만 남으므로 길이 없는 것이 된다.
    expect(crossing.board.paths[E]).toEqual([]);
    expect(isLinked(crossing.board, E)).toBe(false);
    expect(ownersOf(crossing.board)[at(2, 2)]).toBe(B);
  });

  it('잘린 길은 처음 점에 붙은 쪽만 남는다', () => {
    const linked = drawn(newBoard(handPuzzle()), HAND_PATHS[D]);
    // E의 점 (3, 2)에서 내려와 D의 길 (4, 2)를 밟는다.
    const { board, pair } = draw(linked, [at(3, 2), at(4, 2)]);
    expect(pair).toBe(E);
    expect(board.paths[D]).toEqual([at(2, 0), at(3, 0), at(4, 0), at(4, 1)]);
    expect(isLinked(board, D)).toBe(false);
    expect(board.paths[E]).toEqual([at(3, 2), at(4, 2)]);
    // 길끼리는 겹치지 않는다.
    const all = board.paths.flat();
    expect(new Set(all).size).toBe(all.length);
  });

  it('남의 길을 가로질렀다가 손가락을 떼기 전에 되돌아오면 잘렸던 길이 되살아난다', () => {
    const linked = drawn(drawn(newBoard(handPuzzle()), HAND_PATHS[E]), HAND_PATHS[D]);
    // 그리기 시작할 때의 길들을 기억해 둔다.
    const restore = linked.paths;
    const started = startStroke(linked, at(1, 0))!;
    let board = dragTo(started.board, B, at(1, 1), restore).board;
    board = dragTo(board, B, at(2, 1), restore).board;

    const crossing = dragTo(board, B, at(2, 2), restore);
    expect(crossing).toMatchObject({ cut: [E], mended: [] });
    expect(isLinked(crossing.board, E)).toBe(false);

    const back = dragTo(crossing.board, B, at(2, 1), restore);
    expect(back).toMatchObject({ grew: -1, cut: [], mended: [E] });
    expect(back.board.paths[E]).toEqual(HAND_PATHS[E]);
    expect(isLinked(back.board, E)).toBe(true);
    // 건드리지 않은 길은 같은 배열 그대로다.
    expect(back.board.paths[D]).toBe(linked.paths[D]);

    // 여러 칸을 한꺼번에 되돌아가도 되살아난다.
    const far = dragTo(crossing.board, B, at(1, 0), restore);
    expect(far.mended).toEqual([E]);
    expect(far.board.paths[E]).toEqual(HAND_PATHS[E]);

    // 손가락을 떼고 새로 그리기 시작하면(기억해 둔 길이 잘린 뒤의 것이면) 되살아나지 않는다.
    const lifted = endStroke(crossing.board, B);
    const again = startStroke(lifted, at(2, 2))!;
    const retreat = dragTo(again.board, B, at(2, 1), lifted.paths);
    expect(retreat.mended).toEqual([]);
    expect(retreat.board.paths[E]).toEqual([]);

    // restore를 주지 않으면 한 번 잘린 길은 그대로다.
    const plain = dragTo(crossing.board, B, at(2, 1));
    expect(plain.mended).toEqual([]);
    expect(plain.board.paths[E]).toEqual([]);
  });

  it('되살아난 길도 지금 그리는 길이 덮고 있는 데까지만 돌아온다', () => {
    const linked = drawn(newBoard(handPuzzle()), HAND_PATHS[D]);
    const restore = linked.paths;
    // E의 점 (3, 2)에서 내려가 D의 길 (4, 2)를 밟고, 왼쪽으로 (4, 1)까지 따라간다.
    let board = startStroke(linked, at(3, 2))!.board;
    board = dragTo(board, E, at(4, 2), restore).board;
    board = dragTo(board, E, at(4, 1), restore).board;
    expect(board.paths[D]).toEqual(HAND_PATHS[D].slice(0, 3));
    // 한 칸 되돌아오면 D는 (4, 1)까지 돌아오고, 아직 밟고 있는 (4, 2)부터는 잘린 채다.
    const back = dragTo(board, E, at(4, 2), restore);
    expect(back.mended).toEqual([D]);
    expect(back.board.paths[D]).toEqual(HAND_PATHS[D].slice(0, 4));
    const all = back.board.paths.flat();
    expect(new Set(all).size).toBe(all.length);
  });

  it('손가락이 같은 줄에서 여러 칸을 건너뛰면 사이의 칸을 차례로 지난다', () => {
    const started = startStroke(newBoard(handPuzzle()), at(0, 0))!;
    const jump = dragTo(started.board, A, at(0, 4));
    expect(jump).toMatchObject({ grew: 4, blocked: false });
    expect(jump.board.paths[A]).toEqual(HAND_PATHS[A].slice(0, 5));

    // 세로로도 같다. 마지막 칸이 짝 점이면 이어진다.
    const down = dragTo(jump.board, A, at(2, 4));
    expect(down).toMatchObject({ grew: 2, linked: true });
    expect(down.board.paths[A]).toEqual(HAND_PATHS[A]);
  });

  it('건너뛰다가 다른 쌍의 점에 막히면 그 앞에서 멈춘다', () => {
    // D의 점 (2, 0)에서 오른쪽 끝까지: (2, 1)은 빈칸, (2, 2)도 빈칸, (2, 3)도 빈칸, (2, 4)는 A의 점이다.
    const started = startStroke(newBoard(handPuzzle()), at(2, 0))!;
    const jump = dragTo(started.board, D, at(2, 4));
    expect(jump).toMatchObject({ grew: 3, blocked: true, linked: false });
    expect(jump.board.paths[D]).toEqual([at(2, 0), at(2, 1), at(2, 2), at(2, 3)]);

    // 바로 옆이 다른 쌍의 점이면 한 칸도 못 간다.
    const stuck = startStroke(newBoard(handPuzzle()), at(1, 2))!;
    expect(dragTo(stuck.board, E, at(1, 4))).toMatchObject({ grew: 0, blocked: true });
  });

  it('건너뛰는 길에 다른 쌍의 길이 있으면 자르고 지나간다', () => {
    const linked = drawn(newBoard(handPuzzle()), HAND_PATHS[B]);
    const started = startStroke(linked, at(2, 0))!;
    const jump = dragTo(started.board, D, at(2, 3));
    expect(jump).toMatchObject({ grew: 3, cut: [B], blocked: false });
    expect(jump.board.paths[B]).toEqual([at(1, 0), at(1, 1)]);
  });

  it('대각선으로 한 칸 건너뛰면 비어 있는 모퉁이로 돌아간다', () => {
    const board = newBoard(handPuzzle());
    // B의 점 (1, 0)에서 (2, 1)로: 옆 모퉁이 (1, 1)은 빈칸, 아래 모퉁이 (2, 0)은 D의 점이다.
    const viaSide = dragTo(startStroke(board, at(1, 0))!.board, B, at(2, 1));
    expect(viaSide).toMatchObject({ grew: 2, blocked: false });
    expect(viaSide.board.paths[B]).toEqual([at(1, 0), at(1, 1), at(2, 1)]);

    // C의 점 (1, 3)에서 (2, 2)로: 옆 모퉁이 (1, 2)는 E의 점이라 아래 모퉁이 (2, 3)으로 돈다.
    const viaDown = dragTo(startStroke(board, at(1, 3))!.board, C, at(2, 2));
    expect(viaDown.board.paths[C]).toEqual([at(1, 3), at(2, 3), at(2, 2)]);
  });

  it('대각선으로 갈 때 다른 쌍의 길을 자르지 않는 모퉁이를 고른다', () => {
    // 첫 쌍이 (0, 0), (1, 0), (1, 1)까지 그려져 있고, 둘째 쌍이 올라와 그 아래 칸 (2, 1)에 서 있다.
    const first = drawn(newBoard(openPuzzle()), [at(0, 0), at(1, 0), at(1, 1)]);
    const second = draw(first, [at(4, 0), at(3, 0), at(2, 0), at(2, 1)]).board;
    // (1, 2)로 가는 두 모퉁이 가운데 (1, 1)에는 첫 쌍의 길이 있고 (2, 2)는 비어 있다.
    const around = dragTo(second, 1, at(1, 2));
    expect(around).toMatchObject({ grew: 2, cut: [], blocked: false });
    expect(around.board.paths[1]).toEqual([at(4, 0), at(3, 0), at(2, 0), at(2, 1), at(2, 2), at(1, 2)]);
    expect(around.board.paths[0]).toEqual([at(0, 0), at(1, 0), at(1, 1)]);
  });

  it('대각선으로 갈 때 빈 모퉁이가 없으면 다른 쌍의 길을 자르고 간다', () => {
    // A의 길이 (0, 1)까지 와 있고, B가 그 아래 (1, 1)에 서 있다.
    const withA = drawn(newBoard(handPuzzle()), [at(0, 0), at(0, 1)]);
    const fromB = draw(withA, [at(1, 0), at(1, 1)]).board;
    // (0, 2)로 가는 두 모퉁이 가운데 (1, 2)는 E의 점이라 못 가고, (0, 1)에는 A의 길이 있다.
    const forced = dragTo(fromB, B, at(0, 2));
    expect(forced).toMatchObject({ grew: 2, cut: [A], blocked: false });
    expect(forced.board.paths[B]).toEqual([at(1, 0), at(1, 1), at(0, 1), at(0, 2)]);
    expect(forced.board.paths[A]).toEqual([]);
  });

  it('대각선으로 갈 때 자기 길이 있는 모퉁이로는 되돌아가서 간다', () => {
    // 둘째 쌍이 (4, 0), (3, 0), (3, 1)로 가 있다. (2, 0)으로 가는 모퉁이는 자기 길 (3, 0)과 빈칸 (2, 1)이다.
    const { board } = draw(newBoard(openPuzzle()), [at(4, 0), at(3, 0), at(3, 1)]);
    // 빈 모퉁이가 있으면 그쪽으로 돈다.
    expect(dragTo(board, 1, at(2, 0)).board.paths[1]).toEqual([at(4, 0), at(3, 0), at(3, 1), at(2, 1), at(2, 0)]);
    // 빈 모퉁이에 다른 쌍의 길이 있으면, 그 길을 자르는 대신 자기 길을 되돌아가서 간다.
    const crowded = draw(drawn(newBoard(openPuzzle()), [at(0, 0), at(1, 0), at(1, 1), at(2, 1)]), [
      at(4, 0),
      at(3, 0),
      at(3, 1),
    ]).board;
    const backed = dragTo(crowded, 1, at(2, 0));
    expect(backed.cut).toEqual([]);
    expect(backed.board.paths[1]).toEqual([at(4, 0), at(3, 0), at(2, 0)]);
  });

  it('대각선으로 가려는 칸이나 두 모퉁이가 모두 막혀 있으면 가지 않는다', () => {
    const board = newBoard(handPuzzle());
    // 한쪽 모퉁이만 막혀 있으면 갈 수 있다: E의 점 (1, 2)에서 (2, 3)으로, (1, 3)은 C의 점이고 (2, 2)는 빈칸이다.
    expect(dragTo(startStroke(board, at(1, 2))!.board, E, at(2, 3)).grew).toBe(2);

    // 가려는 칸이 다른 쌍의 점이면 모퉁이까지도 가지 않는다: (1, 1)에서 A의 점 (0, 0)으로.
    const fromB = draw(board, [at(1, 0), at(1, 1)]).board;
    const toDot = dragTo(fromB, B, at(0, 0));
    expect(toDot.board).toBe(fromB);
    expect(toDot).toMatchObject({ grew: 0, blocked: true });

    // 두 모퉁이가 모두 다른 쌍의 점인 3 × 3 판: 가운데 점(4)에서 오른쪽 위(2)로 가려 한다.
    const tight = puzzleFrom(3, [
      [0, 3, 6],
      [1, 2, 5],
      [4, 7, 8],
    ]);
    const started = startStroke(newBoard(tight), 4)!;
    expect(started.pair).toBe(2);
    expect(dragTo(started.board, 2, 2)).toMatchObject({ board: started.board, grew: 0, blocked: true });
  });

  it('비스듬히 멀리 건너뛴 것은 무시한다', () => {
    const started = startStroke(newBoard(handPuzzle()), at(2, 0))!;
    const far = dragTo(started.board, D, at(4, 1));
    expect(far.board).toBe(started.board);
    expect(far).toMatchObject({ grew: 0, blocked: true });
  });

  it('길 위의 칸에서 다시 시작하면 그 뒤쪽이 잘리고 거기서 이어 그린다', () => {
    const linked = drawn(newBoard(handPuzzle()), HAND_PATHS[A]);
    const again = startStroke(linked, at(0, 2));
    expect(again?.pair).toBe(A);
    expect(again?.board.paths[A]).toEqual([at(0, 0), at(0, 1), at(0, 2)]);
    // 아래의 (1, 2)는 E의 점이라 갈 수 없고, 오른쪽으로는 다시 이어 갈 수 있다.
    expect(dragTo(again!.board, A, at(1, 2)).blocked).toBe(true);
    expect(dragTo(again!.board, A, at(0, 3)).board.paths[A]).toEqual(HAND_PATHS[A].slice(0, 4));

    // 길의 맨 끝에서 시작하면 잘리는 것 없이 이어 그린다.
    const partial = drawn(newBoard(handPuzzle()), HAND_PATHS[A].slice(0, 3));
    expect(startStroke(partial, at(0, 2))?.board.paths[A]).toEqual(partial.paths[A]);
  });

  it('이어진 길의 점을 누르면 그 점에서 새로 시작한다', () => {
    const linked = drawn(newBoard(handPuzzle()), HAND_PATHS[A]);
    const fromFar = startStroke(linked, at(2, 4));
    expect(fromFar?.pair).toBe(A);
    expect(fromFar?.board.paths[A]).toEqual([at(2, 4)]);
    expect(isLinked(fromFar!.board, A)).toBe(false);
  });

  it('점을 눌렀다가 그대로 떼면 그 쌍의 길이 지워진다', () => {
    const linked = drawn(newBoard(handPuzzle()), HAND_PATHS[A]);
    const tapped = startStroke(linked, at(0, 0))!;
    const after = endStroke(tapped.board, tapped.pair);
    expect(after.paths[A]).toEqual([]);
    expect(coveredCount(after)).toBe(0);

    // 그리다 만 길의 점을 눌러도 같다.
    const partial = drawn(newBoard(handPuzzle()), HAND_PATHS[A].slice(0, 3));
    const other = startStroke(partial, at(2, 4))!;
    expect(endStroke(other.board, other.pair).paths[A]).toEqual([]);
  });

  it('손가락을 떼어도 두 칸 이상 그린 길은 남는다', () => {
    const { board, pair } = draw(newBoard(handPuzzle()), [at(1, 0), at(1, 1)]);
    expect(endStroke(board, pair)).toBe(board);
  });

  it('길을 지운다', () => {
    const linked = drawn(newBoard(handPuzzle()), HAND_PATHS[C]);
    expect(clearPath(linked, C).paths[C]).toEqual([]);
    // 지울 길이 없으면 그대로다.
    expect(clearPath(linked, A)).toBe(linked);
  });

  it('없는 쌍이나 아직 시작하지 않은 쌍은 끌 수 없다', () => {
    const board = newBoard(handPuzzle());
    expect(dragTo(board, A, at(0, 1))).toMatchObject({ board, grew: 0, blocked: true });
    expect(dragTo(board, 9, at(0, 1))).toMatchObject({ board, grew: 0, blocked: true });
    const started = startStroke(board, at(0, 0))!;
    expect(dragTo(started.board, A, 99)).toMatchObject({ grew: 0, blocked: true });
  });
});

describe('판을 깼는지', () => {
  it('덮은 칸과 이어진 쌍을 센다', () => {
    let board = newBoard(handPuzzle());
    expect(coveredCount(board)).toBe(0);
    expect(linkedCount(board)).toBe(0);
    expect(openCells(board)).toHaveLength(25);

    board = drawn(board, HAND_PATHS[E]);
    expect(coveredCount(board)).toBe(3);
    expect(linkedCount(board)).toBe(1);

    // 그리다 만 길의 칸도 덮은 칸으로 세지만 이어진 쌍은 아니다.
    board = drawn(board, HAND_PATHS[A].slice(0, 4));
    expect(coveredCount(board)).toBe(7);
    expect(linkedCount(board)).toBe(1);
    expect(openCells(board)).toHaveLength(18);

    // 점만 눌러 놓은 길은 세지 않는다.
    const pressed = startStroke(board, at(1, 0))!.board;
    expect(coveredCount(pressed)).toBe(7);
  });

  it('모든 쌍을 잇고 모든 칸을 덮으면 판을 깬다', () => {
    const puzzle = handPuzzle();
    let board = newBoard(puzzle);
    for (const [pair, path] of puzzle.solution.entries()) {
      expect(isSolved(board)).toBe(false);
      board = drawn(board, path);
      expect(linkedCount(board)).toBe(pair + 1);
    }
    expect(coveredCount(board)).toBe(25);
    expect(openCells(board)).toEqual([]);
    expect(isSolved(board)).toBe(true);
    // 길 하나를 지우면 다시 못 깬 판이 된다.
    expect(isSolved(clearPath(board, B))).toBe(false);
  });

  it('모든 쌍을 이어도 빈칸이 남으면 깬 것이 아니다', () => {
    // 3 × 3 판: 첫 쌍은 위와 오른쪽을 돌고, 둘째 쌍은 왼쪽 아래를 돌아가야 칸이 다 찬다.
    //   A a a
    //   b B a
    //   b B A
    const puzzle = puzzleFrom(3, [
      [0, 1, 2, 5, 8],
      [4, 3, 6, 7],
    ]);
    const first = drawn(newBoard(puzzle), puzzle.solution[0]);
    // 둘째 쌍의 두 점은 붙어 있어서 곧장 이을 수 있다.
    const shortcut = drawn(first, [4, 7]);
    expect(linkedCount(shortcut)).toBe(2);
    expect(coveredCount(shortcut)).toBe(7);
    expect(openCells(shortcut)).toEqual([3, 6]);
    expect(isSolved(shortcut)).toBe(false);

    // 돌아가는 길로 다시 그리면 깬다.
    const full = drawn(shortcut, puzzle.solution[1]);
    expect(isSolved(full)).toBe(true);
  });

  it('저장된 풀이와 다른 길로 채워도 깬 것으로 친다', () => {
    // 3 × 3 판에서 첫 쌍의 점은 0번과 3번 칸, 둘째 쌍의 점은 2번과 6번 칸에 있다.
    // 저장된 풀이에서는 첫 쌍이 1번과 4번 칸을 돌아가지만, 첫 쌍을 곧장 잇고 둘째 쌍이 그 칸들을 지나가도 모든 칸이 찬다.
    const puzzle = puzzleFrom(3, [
      [0, 1, 4, 3],
      [2, 5, 8, 7, 6],
    ]);
    const other = drawn(drawn(newBoard(puzzle), [0, 3]), [2, 1, 4, 5, 8, 7, 6]);
    expect(other.paths).not.toEqual(puzzle.solution);
    expect(isSolved(other)).toBe(true);
  });
});

describe('화면 배치', () => {
  const heights = [MIN_GAME_HEIGHT, 427, 488, 520, MAX_GAME_HEIGHT];

  it('판이 주어진 자리 안에 들어가고 칸은 손가락으로 짚을 만큼 크다', () => {
    for (const height of heights) {
      for (const size of SIZES) {
        const area = { x: 0, y: 90, width: GAME_WIDTH, height: height - 90 - 40 };
        const { cell, left, top } = boardLayout(size, area);
        expect(Number.isInteger(cell)).toBe(true);
        expect(cell).toBeGreaterThanOrEqual(32);
        expect(cell).toBeLessThanOrEqual(MAX_CELL);
        expect(left).toBeGreaterThanOrEqual(area.x + BOARD_MARGIN);
        expect(left + size * cell).toBeLessThanOrEqual(area.x + area.width - BOARD_MARGIN);
        expect(top).toBeGreaterThanOrEqual(area.y + BOARD_MARGIN);
        expect(top + size * cell).toBeLessThanOrEqual(area.y + area.height - BOARD_MARGIN);
      }
    }
  });

  it('판은 자리의 한가운데에 놓인다', () => {
    const { cell, left, top } = boardLayout(7, { x: 0, y: 100, width: 240, height: 300 });
    expect(cell).toBe(32);
    expect(left).toBe(8);
    expect(top).toBe(100 + (300 - 224) / 2);
  });

  it('좌표로 칸을 찾는다', () => {
    const layout = { cell: 40, left: 20, top: 100 };
    expect(cellAt(5, layout, 20, 100)).toBe(0);
    expect(cellAt(5, layout, 59.9, 139.9)).toBe(0);
    expect(cellAt(5, layout, 60, 100)).toBe(1);
    expect(cellAt(5, layout, 219, 299)).toBe(24);
    expect(cellAt(5, layout, 19.9, 150)).toBeNull();
    expect(cellAt(5, layout, 220, 150)).toBeNull();
    expect(cellAt(5, layout, 100, 99)).toBeNull();
    expect(cellAt(5, layout, 100, 300)).toBeNull();
  });

  it('판 밖으로 조금 나간 자리는 가장 가까운 가장자리 칸으로 친다', () => {
    const layout = { cell: 40, left: 20, top: 100 };
    expect(cellAt(5, layout, 10, 150, 20)).toBe(5);
    expect(cellAt(5, layout, 230, 90, 20)).toBe(4);
    expect(cellAt(5, layout, 100, 315, 20)).toBe(22);
    expect(cellAt(5, layout, -1, 150, 20)).toBeNull();
    expect(cellAt(5, layout, 100, 321, 20)).toBeNull();
  });

  it('그리는 동안에는 경계를 조금 넘어도 아직 그 칸에 있는 것으로 친다', () => {
    const layout = { cell: 40, left: 20, top: 100 };
    // 0번 칸의 오른쪽 경계는 x = 60이다.
    expect(stickyCellAt(5, layout, 62, 120, 0, 3)).toBe(0);
    expect(stickyCellAt(5, layout, 63, 120, 0, 3)).toBe(1);
    // 1번 칸으로 넘어간 뒤에는 되돌아올 때도 경계를 조금 넘어야 한다.
    expect(stickyCellAt(5, layout, 58, 120, 1, 3)).toBe(1);
    expect(stickyCellAt(5, layout, 56.9, 120, 1, 3)).toBe(0);
    // 모서리 근처에서는 대각선 칸으로 곧장 넘어갈 수 있다.
    expect(stickyCellAt(5, layout, 62, 142, 0, 3)).toBe(0);
    expect(stickyCellAt(5, layout, 64, 144, 0, 3)).toBe(6);
    // 판 밖으로 나가면 reach 안에서만 가장자리 칸으로 친다.
    expect(stickyCellAt(5, layout, 100, 80, 2, 3, 30)).toBe(2);
    expect(stickyCellAt(5, layout, 100, 60, 2, 3, 30)).toBeNull();
  });
});

describe('판의 차례와 시간, 점수', () => {
  it('5 × 5로 시작해 몇 판마다 6 × 6, 7 × 7로 커진다', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 30].map(stageSize)).toEqual([5, 5, 5, 6, 6, 6, 7, 7, 7]);
    expect(stageSize(0)).toBe(5);
    expect(SIZE_PLANS.map((plan) => plan.size)).toEqual([5, 6, 7]);
  });

  it('큰 판일수록 점수도 돌려받는 시간도 많다', () => {
    expect(clearPoints(1)).toBeLessThan(clearPoints(4));
    expect(clearPoints(4)).toBeLessThan(clearPoints(7));
    expect(clearSeconds(1)).toBeLessThan(clearSeconds(4));
    expect(clearSeconds(4)).toBeLessThan(clearSeconds(7));
    expect(clearPoints(8)).toBe(clearPoints(7));
  });

  it('가장 큰 판은 거듭될수록 돌려받는 시간이 줄어 바닥에 닿는다', () => {
    expect(clearSeconds(8)).toBe(clearSeconds(7) - LATE_SECONDS_STEP);
    let previous = clearSeconds(7);
    for (let stage = 8; stage < 40; stage += 1) {
      const seconds = clearSeconds(stage);
      expect(seconds).toBeLessThanOrEqual(previous);
      expect(seconds).toBeGreaterThanOrEqual(MIN_CLEAR_SECONDS);
      previous = seconds;
    }
    expect(clearSeconds(40)).toBe(MIN_CLEAR_SECONDS);
    // 가장 큰 판은 칸을 긋기만 해도 바닥보다 오래 걸리므로, 아무리 잘 풀어도 한 판은 언젠가 끝난다.
    expect(MIN_CLEAR_SECONDS).toBeLessThanOrEqual(6);
  });

  it('이어 둔 쌍의 점수를 다 모아도 그 판을 깬 점수보다 적다', () => {
    for (const plan of SIZE_PLANS) {
      expect((pairRange(plan.size)[1] - 1) * PAIR_POINTS).toBeLessThan(plan.points);
    }
  });

  it('새 판은 60초와 0점, 5 × 5 판으로 시작한다', () => {
    const run = newRun(seeded(1));
    expect(run).toMatchObject({ stage: 1, timeLeft: START_SECONDS, score: 0, boardsCleared: 0, pairsLinked: 0 });
    expect(START_SECONDS).toBe(60);
    expect(run.board.puzzle.size).toBe(5);
    expect(coveredCount(run.board)).toBe(0);
  });

  it('시간이 흐르고, 다 되면 끝난다', () => {
    const run = newRun(seeded(2));
    expect(isOver(run)).toBe(false);
    expect(elapse(run, 12.5).timeLeft).toBe(START_SECONDS - 12.5);
    expect(elapse(run, -3).timeLeft).toBe(START_SECONDS);
    const done = elapse(run, START_SECONDS + 5);
    expect(done.timeLeft).toBe(0);
    expect(isOver(done)).toBe(true);
  });

  it('판을 깨면 점수와 시간을 받고, 시간은 처음보다 많아지지 않는다', () => {
    const start = elapse(newRun(seeded(3)), 30);
    const run: RunState = { ...start, board: solved(start.board.puzzle) };
    const { run: after, reward } = claimClear(run);
    expect(reward).toEqual({ points: clearPoints(1), seconds: clearSeconds(1) });
    expect(after.timeLeft).toBe(30 + clearSeconds(1));
    expect(after.score).toBe(clearPoints(1));
    expect(after.boardsCleared).toBe(1);
    expect(after.pairsLinked).toBe(run.board.paths.length);

    // 시간이 거의 가득하면 넘치는 만큼은 받지 못한다.
    const early = claimClear({ ...run, timeLeft: START_SECONDS - 2 });
    expect(early.run.timeLeft).toBe(START_SECONDS);
    expect(early.reward?.seconds).toBe(2);
  });

  it('못 깬 판이나 끝난 판에서는 받는 것이 없다', () => {
    const run = newRun(seeded(4));
    expect(claimClear(run)).toEqual({ run, reward: null });
    const partial = { ...run, board: drawn(run.board, run.board.puzzle.solution[0]) };
    expect(claimClear(partial).reward).toBeNull();
    const late = elapse({ ...run, board: solved(run.board.puzzle) }, START_SECONDS);
    expect(claimClear(late)).toEqual({ run: late, reward: null });
  });

  it('다음 판으로 넘어가면 새 판이 깔리고 점수와 시간은 이어진다', () => {
    const random = seeded(5);
    let run = newRun(random);
    for (let stage = 1; stage <= 8; stage += 1) {
      expect(run.stage).toBe(stage);
      expect(run.board.puzzle.size).toBe(stageSize(stage));
      const claimed = claimClear({ ...run, board: solved(run.board.puzzle) });
      expect(claimed.reward).not.toBeNull();
      run = nextStage(claimed.run, random);
      expect(coveredCount(run.board)).toBe(0);
      expect(run.score).toBe(claimed.run.score);
      expect(run.timeLeft).toBe(claimed.run.timeLeft);
    }
    expect(run.boardsCleared).toBe(8);
    expect(run.score).toBe(3 * clearPoints(1) + 3 * clearPoints(4) + 2 * clearPoints(7));
  });

  it('끝났을 때 풀던 판에서 이어 둔 쌍마다 점수를 조금 받는다', () => {
    const run = { ...newRun(seeded(6)), score: 55 };
    expect(pendingPoints(run)).toBe(0);
    expect(finalScore(run)).toBe(55);

    const [first, second] = run.board.puzzle.solution;
    const two = { ...run, board: drawn(drawn(run.board, first), second) };
    expect(pendingPoints(two)).toBe(2 * PAIR_POINTS);
    expect(finalScore(two)).toBe(55 + 2 * PAIR_POINTS);

    // 그리다 만 길은 점수가 없다.
    const half = { ...run, board: drawn(run.board, first.slice(0, -1)) };
    expect(finalScore(half)).toBe(55);

    // 이미 깬 판의 쌍은 그 판의 점수에 들어 있으므로 따로 세지 않는다.
    const whole = { ...run, board: solved(run.board.puzzle) };
    expect(pendingPoints(whole)).toBe(0);
    expect(finalScore(claimClear(whole).run)).toBe(55 + clearPoints(1));
  });
});
