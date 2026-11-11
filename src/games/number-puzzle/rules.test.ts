import { describe, expect, it } from 'vitest';
import { GAME_WIDTH, MAX_GAME_HEIGHT, MIN_GAME_HEIGHT } from '../../config';
import {
  BLANKS_STEP,
  BOARD_LIP,
  BOARD_SIZES,
  boardLayout,
  BOX_GAP,
  boxOf,
  boxShape,
  candidatesOf,
  cellArea,
  cellAt,
  cellPoints,
  clashesOf,
  CLEAR_POINTS_PER_STAGE,
  clearPoints,
  clearSeconds,
  colOf,
  countBlanks,
  countSolutions,
  elapse,
  generatePuzzle,
  generateSolution,
  highlightedDigit,
  HINT_ROOM,
  isDigitDone,
  isOver,
  isSolved,
  isValidGrid,
  MAX_BLANKS,
  moveCursor,
  newRun,
  nextStage,
  NO_SELECTION,
  PAD_BUTTON_GAP,
  padDigitAt,
  peersOf,
  placeDigit,
  pressCell,
  pressDigit,
  rowOf,
  settleSelection,
  solveWithSingles,
  stageSpec,
  START_HEARTS,
  TIME_BANK_SECONDS,
  TOUCH_SLOP,
  unitsOf,
  unitsThrough,
  type Area,
  type BoardSize,
  type Grid,
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

/**
 * 다 채운 본보기 4칸 판.
 *   1 2 | 3 4
 *   3 4 | 1 2
 *   ----+----
 *   2 1 | 4 3
 *   4 3 | 2 1
 */
const FULL: Grid = [1, 2, 3, 4, 3, 4, 1, 2, 2, 1, 4, 3, 4, 3, 2, 1];

/** 판에서 고른 칸들을 비운다. */
const without = (grid: Grid, cells: readonly number[]): number[] =>
  grid.map((value, cell) => (cells.includes(cell) ? 0 : value));

const empty = (size: BoardSize): number[] => Array<number>(size * size).fill(0);

/**
 * 본보기 판에서 네 칸(0, 2, 4, 6번)을 비운 판. 비운 자리의 1과 3을 서로 바꿔 넣어도 규칙에 맞아서
 * 답이 두 가지다.
 *   . 2 | . 4
 *   . 4 | . 2
 */
const TWO_WAYS = without(FULL, [0, 2, 4, 6]);

const puzzleOf = (givens: Grid, solution: Grid = FULL): Puzzle => ({ size: 4, givens, solution });

/** 손으로 만든 판으로 시작하는 진행 상태 */
const runWith = (givens: Grid, extra: Partial<RunState> = {}): RunState => ({
  stage: 1,
  puzzle: puzzleOf(givens),
  grid: givens,
  timeLeft: TIME_BANK_SECONDS,
  hearts: START_HEARTS,
  score: 0,
  cellsFilled: 0,
  puzzlesCleared: 0,
  mistakes: 0,
  ...extra,
});

/** 지금 판을 답대로 끝까지 채운다. 마지막 칸을 채운 뒤의 상태를 돌려준다. */
function fillOut(run: RunState): RunState {
  let current = run;
  current.puzzle.solution.forEach((digit, cell) => {
    if (current.grid[cell] === 0) current = placeDigit(current, cell, digit).run;
  });
  return current;
}

describe('줄과 상자', () => {
  it('판 크기마다 상자 모양이 정해져 있다', () => {
    expect(boxShape(4)).toEqual({ rows: 2, cols: 2 });
    // 6칸 판의 상자는 가로로 긴 2×3이다.
    expect(boxShape(6)).toEqual({ rows: 2, cols: 3 });
    expect(boxShape(9)).toEqual({ rows: 3, cols: 3 });
  });

  it('칸 번호에서 가로줄, 세로줄, 상자를 알 수 있다', () => {
    expect([rowOf(4, 6), colOf(4, 6), boxOf(4, 6)]).toEqual([1, 2, 1]);
    expect([rowOf(4, 10), colOf(4, 10), boxOf(4, 10)]).toEqual([2, 2, 3]);
    // 6칸 판은 상자가 가로로 둘, 세로로 셋이다.
    expect([0, 2, 3, 11, 12, 21, 30, 35].map((cell) => boxOf(6, cell))).toEqual([0, 0, 1, 1, 2, 3, 4, 5]);
    expect([rowOf(9, 40), colOf(9, 40), boxOf(9, 40)]).toEqual([4, 4, 4]);
    expect([0, 8, 27, 53, 80].map((cell) => boxOf(9, cell))).toEqual([0, 2, 3, 5, 8]);
  });

  it('묶음은 가로줄, 세로줄, 상자가 size개씩이고 저마다 size칸이다', () => {
    for (const size of BOARD_SIZES) {
      const units = unitsOf(size);
      expect(units).toHaveLength(size * 3);
      for (const unit of units) expect(new Set(unit).size).toBe(size);
      // 종류마다 판 전체를 빠짐없이 한 번씩 덮는다.
      for (const kind of [0, 1, 2]) {
        const cells = units.slice(kind * size, (kind + 1) * size).flat();
        expect([...cells].sort((a, b) => a - b)).toEqual([...Array(size * size).keys()]);
      }
    }
  });

  it('상자는 정해진 모양의 네모로 붙어 있다', () => {
    for (const size of BOARD_SIZES) {
      const shape = boxShape(size);
      for (const box of unitsOf(size).slice(size * 2)) {
        const rows = box.map((cell) => rowOf(size, cell));
        const cols = box.map((cell) => colOf(size, cell));
        expect(Math.max(...rows) - Math.min(...rows) + 1).toBe(shape.rows);
        expect(Math.max(...cols) - Math.min(...cols) + 1).toBe(shape.cols);
      }
    }
  });

  it('칸을 지나는 묶음은 그 칸의 가로줄, 세로줄, 상자다', () => {
    // 6칸 판의 14번 칸: 셋째 줄, 셋째 칸
    const [row, col, box] = unitsThrough(6, 14);
    expect(row).toEqual([12, 13, 14, 15, 16, 17]);
    expect(col).toEqual([2, 8, 14, 20, 26, 32]);
    expect(box).toEqual([12, 13, 14, 18, 19, 20]);
  });

  it('숫자가 달라야 하는 다른 칸은 판 크기에 따라 7칸, 12칸, 20칸이다', () => {
    const expected: Record<BoardSize, number> = { 4: 7, 6: 12, 9: 20 };
    for (const size of BOARD_SIZES) {
      for (let cell = 0; cell < size * size; cell += 1) {
        const peers = peersOf(size, cell);
        expect(peers).toHaveLength(expected[size]);
        expect(peers).not.toContain(cell);
        // 서로 마주 본다: 내가 그 칸의 이웃이면 그 칸도 내 이웃이다.
        for (const peer of peers) expect(peersOf(size, peer)).toContain(cell);
      }
    }
    expect(peersOf(4, 0)).toEqual([1, 2, 3, 4, 5, 8, 12]);
  });
});

describe('둘 수 있는 숫자', () => {
  it('같은 줄과 상자에 이미 있는 숫자는 둘 수 없다', () => {
    expect(candidatesOf(empty(4), 4, 0)).toEqual([1, 2, 3, 4]);
    // 0번 칸: 가로줄에 2, 세로줄에 3, 상자에 4가 있으면 1만 남는다.
    const grid = empty(4);
    grid[1] = 2;
    grid[8] = 3;
    grid[5] = 4;
    expect(candidatesOf(grid, 4, 0)).toEqual([1]);
    // 줄도 상자도 다른 칸의 숫자는 상관없다.
    expect(candidatesOf(grid, 4, 15)).toEqual([1, 2, 3, 4]);
  });

  it('겹치는 칸을 알려 준다', () => {
    const grid = without(FULL, [1]);
    // 1번 칸에 3을 두면 같은 가로줄(2번), 같은 상자(4번), 같은 세로줄(13번)의 3과 겹친다.
    expect(clashesOf(grid, 4, 1, 3)).toEqual([2, 4, 13]);
    expect(clashesOf(grid, 4, 1, 2)).toEqual([]);
  });

  it('빈칸과 다 들어간 숫자를 센다', () => {
    expect(countBlanks(FULL)).toBe(0);
    expect(countBlanks(TWO_WAYS)).toBe(4);
    expect(isDigitDone(FULL, 4, 1)).toBe(true);
    expect(isDigitDone(TWO_WAYS, 4, 1)).toBe(false);
    expect(isDigitDone(TWO_WAYS, 4, 2)).toBe(true);
  });

  it('같은 숫자가 가로줄, 세로줄, 상자 어디에든 두 번 있으면 규칙에 어긋난다', () => {
    expect(isValidGrid(FULL, 4)).toBe(true);
    expect(isValidGrid(empty(9), 9)).toBe(true);
    const inRow = empty(4);
    inRow[0] = 1;
    inRow[3] = 1;
    expect(isValidGrid(inRow, 4)).toBe(false);
    const inCol = empty(4);
    inCol[1] = 2;
    inCol[13] = 2;
    expect(isValidGrid(inCol, 4)).toBe(false);
    // 줄은 다르지만 같은 상자다.
    const inBox = empty(4);
    inBox[0] = 3;
    inBox[5] = 3;
    expect(isValidGrid(inBox, 4)).toBe(false);
  });

  it('크기가 다르거나 없는 숫자가 든 판은 규칙에 어긋난다', () => {
    expect(isValidGrid(FULL, 6)).toBe(false);
    expect(isValidGrid(FULL.map((value) => (value === 4 ? 5 : value)), 4)).toBe(false);
    expect(isValidGrid(FULL.map((value) => value - 0.5), 4)).toBe(false);
  });

  it('빈칸 없이 규칙에 맞아야 다 풀린 것이다', () => {
    expect(isSolved(FULL, 4)).toBe(true);
    expect(isSolved(TWO_WAYS, 4)).toBe(false);
    const swapped = [...FULL];
    [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
    expect(isSolved(swapped, 4)).toBe(false);
  });
});

describe('찍지 않는 풀이', () => {
  it('둘 수 있는 숫자가 하나뿐인 칸을 채워서 끝까지 푼다', () => {
    const givens = without(FULL, [0, 5, 6, 11, 12]);
    const result = solveWithSingles(givens, 4);
    expect(result.solved).toBe(true);
    expect(result.grid).toEqual(FULL);
    expect(result.steps).toHaveLength(5);
    for (const step of result.steps) expect(step.digit).toBe(FULL[step.cell]);
  });

  it('줄이나 상자에서 갈 곳이 하나뿐인 숫자를 채운다', () => {
    // 1이 둘뿐인 판. 어느 빈칸도 둘 수 있는 숫자가 하나로 줄지는 않지만,
    // 맨 윗줄에서 1이 갈 수 있는 칸은 1번뿐이고, 그러고 나면 맨 아랫줄에서는 15번뿐이다.
    const givens = empty(4);
    givens[8] = 1;
    givens[6] = 1;
    const result = solveWithSingles(givens, 4);
    expect(result.steps).toEqual([
      { cell: 1, digit: 1, kind: 'unit' },
      { cell: 15, digit: 1, kind: 'unit' },
    ]);
    // 나머지 숫자는 정해지지 않으므로 더 나아가지 못한다.
    expect(result.solved).toBe(false);
    expect(countBlanks(result.grid)).toBe(12);
  });

  it('찍어야 하는 판은 끝까지 풀지 못한다', () => {
    expect(solveWithSingles(empty(9), 9)).toMatchObject({ solved: false, steps: [] });
    expect(solveWithSingles(TWO_WAYS, 4)).toMatchObject({ solved: false, steps: [] });
  });

  it('받은 판은 바꾸지 않는다', () => {
    const givens = without(FULL, [3, 9]);
    const copy = [...givens];
    solveWithSingles(givens, 4);
    expect(givens).toEqual(copy);
  });
});

describe('답의 수', () => {
  it('빈 4칸 판을 채우는 방법은 288가지다', () => {
    expect(countSolutions(empty(4), 4, 1000)).toBe(288);
  });

  it('정한 수만큼 찾으면 더 세지 않는다', () => {
    expect(countSolutions(empty(4), 4)).toBe(2);
    expect(countSolutions(empty(4), 4, 5)).toBe(5);
    expect(countSolutions(empty(9), 9, 3)).toBe(3);
  });

  it('답이 하나인 판과 둘인 판을 가려낸다', () => {
    expect(countSolutions(FULL, 4)).toBe(1);
    expect(countSolutions(without(FULL, [0, 5, 6, 11, 12]), 4)).toBe(1);
    expect(countSolutions(TWO_WAYS, 4)).toBe(2);
  });

  it('규칙에 어긋난 판과 막다른 판은 답이 없다', () => {
    const broken = [...FULL];
    broken[1] = 1;
    expect(countSolutions(broken, 4)).toBe(0);
    // 0번 칸에 둘 수 있는 숫자가 없다: 가로줄에 2와 3, 세로줄에 4, 상자에 1이 있다.
    const stuck = empty(4);
    stuck[1] = 2;
    stuck[2] = 3;
    stuck[8] = 4;
    stuck[5] = 1;
    expect(countSolutions(stuck, 4)).toBe(0);
  });
});

describe('다 채운 판 만들기', () => {
  it('어떤 시드에서도 규칙에 맞게 다 채운 판이 나온다', () => {
    for (const size of BOARD_SIZES) {
      for (let seed = 1; seed <= 150; seed += 1) {
        expect(isSolved(generateSolution(size, seeded(seed * 31 + size)), size)).toBe(true);
      }
    }
  });

  it('시드가 같으면 같은 판이, 다르면 여러 가지 판이 나온다', () => {
    expect(generateSolution(9, seeded(7))).toEqual(generateSolution(9, seeded(7)));
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed += 1) seen.add(generateSolution(6, seeded(seed)).join(''));
    expect(seen.size).toBeGreaterThan(35);
  });

  it('random이 한 가지 값만 돌려줘도 판은 나온다', () => {
    for (const size of BOARD_SIZES) {
      expect(isSolved(generateSolution(size, () => 0), size)).toBe(true);
      expect(isSolved(generateSolution(size, () => 0.999999), size)).toBe(true);
    }
  });
});

describe('단계', () => {
  it('빈칸이 적은 4칸 판으로 시작해 6칸 판을 거쳐 9칸 판으로 간다', () => {
    expect(stageSpec(1)).toEqual({ size: 4, blanks: 4 });
    const sizes = Array.from({ length: 12 }, (_, index) => stageSpec(index + 1).size);
    expect([...new Set(sizes)]).toEqual([4, 6, 9]);
    // 판은 커지기만 하고 작아지지 않는다.
    for (let index = 1; index < sizes.length; index += 1) {
      expect(sizes[index]).toBeGreaterThanOrEqual(sizes[index - 1]);
    }
  });

  it('같은 크기의 판에서는 빈칸이 판마다 늘어난다', () => {
    for (let stage = 2; stage <= 17; stage += 1) {
      const before = stageSpec(stage - 1);
      const now = stageSpec(stage);
      if (now.size === before.size) expect(now.blanks).toBeGreaterThan(before.blanks);
    }
    expect(stageSpec(9).blanks - stageSpec(8).blanks).toBe(BLANKS_STEP);
  });

  it('판이 커지는 순간에는 빈칸의 비율이 줄어 숨을 돌린다', () => {
    const share = (stage: number): number => {
      const spec = stageSpec(stage);
      return spec.blanks / (spec.size * spec.size);
    };
    for (let stage = 2; stage <= 12; stage += 1) {
      if (stageSpec(stage).size !== stageSpec(stage - 1).size) {
        expect(share(stage)).toBeLessThan(share(stage - 1));
      }
    }
  });

  it('빈칸은 상한에서 멈춘다', () => {
    expect(stageSpec(18)).toEqual({ size: 9, blanks: MAX_BLANKS });
    expect(stageSpec(500)).toEqual({ size: 9, blanks: MAX_BLANKS });
    for (let stage = 1; stage <= 40; stage += 1) {
      const spec = stageSpec(stage);
      expect(spec.blanks).toBeLessThan(spec.size * spec.size);
    }
  });

  it('1보다 작거나 정수가 아닌 판 번호도 받아 준다', () => {
    expect(stageSpec(0)).toEqual(stageSpec(1));
    expect(stageSpec(-3)).toEqual(stageSpec(1));
    expect(stageSpec(4.9)).toEqual(stageSpec(4));
  });
});

describe('판 만들기', () => {
  /** 모든 크기와, 빈칸이 상한에 이른 판까지 고루 본다. */
  const STAGES = [1, 2, 3, 4, 5, 6, 7, 8, 10, 13, 16, 18, 25];

  it('어떤 시드에서도 그 판의 빈칸 수를 꼭 맞게 비운다', () => {
    for (const stage of STAGES) {
      const spec = stageSpec(stage);
      for (let seed = 1; seed <= 60; seed += 1) {
        const puzzle = generatePuzzle(stage, seeded(seed * 101 + stage));
        expect(puzzle.size).toBe(spec.size);
        expect(countBlanks(puzzle.givens)).toBe(spec.blanks);
      }
    }
  });

  it('처음 숫자는 답의 일부이고, 답은 규칙에 맞게 다 채운 판이다', () => {
    for (const stage of STAGES) {
      for (let seed = 1; seed <= 40; seed += 1) {
        const { size, givens, solution } = generatePuzzle(stage, seeded(seed * 211 + stage));
        expect(isSolved(solution, size)).toBe(true);
        givens.forEach((value, cell) => {
          if (value !== 0) expect(value).toBe(solution[cell]);
        });
      }
    }
  });

  it('모든 판은 찍지 않고 끝까지 풀리고, 그렇게 푼 것이 답과 같다', () => {
    for (const stage of STAGES) {
      for (let seed = 1; seed <= 60; seed += 1) {
        const puzzle = generatePuzzle(stage, seeded(seed * 307 + stage));
        const result = solveWithSingles(puzzle.givens, puzzle.size);
        expect(result.solved).toBe(true);
        expect(result.grid).toEqual(puzzle.solution);
      }
    }
  });

  it('모든 판은 답이 하나뿐이다', () => {
    for (const stage of STAGES) {
      for (let seed = 1; seed <= 40; seed += 1) {
        const puzzle = generatePuzzle(stage, seeded(seed * 401 + stage));
        expect(countSolutions(puzzle.givens, puzzle.size)).toBe(1);
      }
    }
  });

  it('시드가 같으면 같은 판이 나오고, 받은 random만 쓴다', () => {
    expect(generatePuzzle(7, seeded(5))).toEqual(generatePuzzle(7, seeded(5)));
    expect(generatePuzzle(7, seeded(5))).not.toEqual(generatePuzzle(7, seeded(6)));
  });

  it('random이 한 가지 값만 돌려줘도 풀 수 있는 판이 나온다', () => {
    for (const stage of [1, 5, 9, 18]) {
      for (const stuck of [0, 0.5, 0.999999]) {
        const puzzle = generatePuzzle(stage, () => stuck);
        expect(countBlanks(puzzle.givens)).toBeGreaterThan(0);
        expect(solveWithSingles(puzzle.givens, puzzle.size).solved).toBe(true);
      }
    }
  });
});

describe('시간', () => {
  it('큰 판을 깰수록 시간을 많이 돌려받는다', () => {
    expect(clearSeconds(1)).toBeLessThan(clearSeconds(4));
    expect(clearSeconds(4)).toBeLessThan(clearSeconds(7));
    // 같은 크기의 판에서는 돌려받는 시간이 같다.
    expect(clearSeconds(3)).toBe(clearSeconds(1));
    expect(clearSeconds(30)).toBe(clearSeconds(7));
  });

  it('빈칸 하나에 돌아오는 시간은 뒤의 판일수록 줄어서, 한 판은 언젠가 끝난다', () => {
    const perBlank = (stage: number): number => clearSeconds(stage) / stageSpec(stage).blanks;
    for (let stage = 2; stage <= 20; stage += 1) {
      if (stageSpec(stage).size !== stageSpec(stage - 1).size) continue;
      expect(perBlank(stage)).toBeLessThanOrEqual(perBlank(stage - 1));
    }
    expect(perBlank(18)).toBeLessThan(1);
  });

  it('시간이 흐르고, 0 아래로는 내려가지 않는다', () => {
    const run = runWith(TWO_WAYS);
    expect(elapse(run, 1.5).timeLeft).toBeCloseTo(TIME_BANK_SECONDS - 1.5);
    expect(elapse(run, -4).timeLeft).toBe(TIME_BANK_SECONDS);
    const spent = elapse(run, TIME_BANK_SECONDS + 10);
    expect(spent.timeLeft).toBe(0);
    expect(isOver(spent)).toBe(true);
    expect(isOver(run)).toBe(false);
  });
});

describe('점수', () => {
  it('큰 판일수록 한 칸의 점수가 조금 더 높다', () => {
    expect(cellPoints(4)).toBeGreaterThan(0);
    expect(cellPoints(6)).toBeGreaterThan(cellPoints(4));
    expect(cellPoints(9)).toBeGreaterThan(cellPoints(6));
    expect(cellPoints(9)).toBeLessThanOrEqual(cellPoints(4) * 2);
  });

  it('판을 깬 보너스는 판 번호에 비례해 커진다', () => {
    expect(clearPoints(1)).toBe(CLEAR_POINTS_PER_STAGE);
    expect(clearPoints(6)).toBe(CLEAR_POINTS_PER_STAGE * 6);
    for (let stage = 2; stage <= 20; stage += 1) {
      expect(clearPoints(stage)).toBeGreaterThan(clearPoints(stage - 1));
    }
    expect(clearPoints(0)).toBe(clearPoints(1));
  });

  it('틀리지 않고 깬 판의 점수는 빈칸 수 × 칸 점수 + 보너스다', () => {
    for (const stage of [1, 4, 7, 11]) {
      const spec = stageSpec(stage);
      const puzzle = generatePuzzle(stage, seeded(stage));
      const start: RunState = { ...runWith(puzzle.givens), stage, puzzle };
      const done = fillOut(start);
      expect(done.score).toBe(spec.blanks * cellPoints(spec.size) + clearPoints(stage));
      expect(done.cellsFilled).toBe(spec.blanks);
    }
  });
});

describe('숫자 두기', () => {
  it('맞는 숫자는 판에 들어가고 점수가 오른다', () => {
    const run = runWith(TWO_WAYS);
    const { run: next, outcome } = placeDigit(run, 0, 1);
    expect(outcome).toMatchObject({ kind: 'placed', cell: 0, digit: 1, points: cellPoints(4) });
    expect(next.grid[0]).toBe(1);
    expect(next.score).toBe(cellPoints(4));
    expect(next.cellsFilled).toBe(1);
    expect(next.hearts).toBe(START_HEARTS);
    // 받은 상태는 그대로다.
    expect(run.grid[0]).toBe(0);
    expect(run.score).toBe(0);
  });

  it('틀린 숫자는 들어가지 않고 목숨이 하나 줄어든다', () => {
    const run = runWith(without(FULL, [1, 6]));
    const { run: next, outcome } = placeDigit(run, 1, 3);
    expect(outcome).toEqual({ kind: 'wrong', cell: 1, digit: 3, clashes: [2, 4, 13] });
    expect(next.grid).toEqual(run.grid);
    expect(next.hearts).toBe(START_HEARTS - 1);
    expect(next.mistakes).toBe(1);
    expect(next.score).toBe(0);
  });

  it('줄과 상자에 겹치는 숫자가 없어도 답과 다르면 틀린 것이다', () => {
    // 0번 칸의 답은 1이다. 3은 지금 어느 숫자와도 겹치지 않지만 답이 아니다.
    const { run: next, outcome } = placeDigit(runWith(TWO_WAYS), 0, 3);
    expect(outcome).toEqual({ kind: 'wrong', cell: 0, digit: 3, clashes: [] });
    expect(next.hearts).toBe(START_HEARTS - 1);
  });

  it('채워진 칸, 없는 칸, 없는 숫자에는 아무 일도 없다', () => {
    const run = runWith(TWO_WAYS);
    for (const [cell, digit] of [
      [1, 2],
      [1, 3],
      [-1, 1],
      [16, 1],
      [0.5, 1],
      [0, 0],
      [0, 5],
      [0, 1.5],
    ]) {
      const result = placeDigit(run, cell, digit);
      expect(result.outcome).toEqual({ kind: 'none' });
      expect(result.run).toBe(run);
    }
  });

  it('이번 숫자로 다 채워진 줄과 상자를 알려 준다', () => {
    // 0번과 2번을 비운 판에서 0번을 채우면 세로줄과 상자가 다 차고, 가로줄은 아직이다.
    const first = placeDigit(runWith(without(FULL, [0, 2])), 0, 1);
    expect(first.outcome).toMatchObject({
      kind: 'placed',
      filledUnits: [
        [0, 4, 8, 12],
        [0, 1, 4, 5],
      ],
    });
    const second = placeDigit(first.run, 2, 3);
    expect(second.outcome).toMatchObject({ kind: 'placed' });
    if (second.outcome.kind === 'placed') expect(second.outcome.filledUnits).toHaveLength(3);
  });

  it('판에 다 들어간 숫자를 알려 준다', () => {
    const first = placeDigit(runWith(TWO_WAYS), 0, 1);
    expect(first.outcome).toMatchObject({ kind: 'placed', digitDone: false });
    const second = placeDigit(first.run, 6, 1);
    expect(second.outcome).toMatchObject({ kind: 'placed', digitDone: true });
  });

  it('마지막 빈칸을 채우면 보너스와 시간을 받는다', () => {
    const run = runWith(without(FULL, [9]), { stage: 3, timeLeft: 40 });
    const { run: next, outcome } = placeDigit(run, 9, 1);
    expect(outcome).toMatchObject({
      kind: 'placed',
      cleared: { points: clearPoints(3), seconds: clearSeconds(3) },
    });
    expect(next.score).toBe(cellPoints(4) + clearPoints(3));
    expect(next.timeLeft).toBe(40 + clearSeconds(3));
    expect(next.puzzlesCleared).toBe(1);
    expect(isSolved(next.grid, 4)).toBe(true);
  });

  it('빈칸이 남아 있으면 판을 깬 것이 아니다', () => {
    const { run: next, outcome } = placeDigit(runWith(TWO_WAYS), 0, 1);
    expect(outcome).toMatchObject({ kind: 'placed', cleared: null });
    expect(next.puzzlesCleared).toBe(0);
    expect(next.timeLeft).toBe(TIME_BANK_SECONDS);
  });

  it('돌려받아도 시간은 처음보다 많아지지 않는다', () => {
    const run = runWith(without(FULL, [9]), { timeLeft: TIME_BANK_SECONDS - 4 });
    const { run: next, outcome } = placeDigit(run, 9, 1);
    expect(next.timeLeft).toBe(TIME_BANK_SECONDS);
    expect(outcome).toMatchObject({ cleared: { seconds: 4 } });
  });

  it('목숨이 다하면 끝나고, 끝난 뒤에는 둘 수 없다', () => {
    let run = runWith(TWO_WAYS);
    for (let miss = 1; miss <= START_HEARTS; miss += 1) {
      expect(isOver(run)).toBe(false);
      run = placeDigit(run, 0, 3).run;
      expect(run.hearts).toBe(START_HEARTS - miss);
    }
    expect(isOver(run)).toBe(true);
    expect(run.mistakes).toBe(START_HEARTS);
    expect(placeDigit(run, 0, 1).outcome).toEqual({ kind: 'none' });
    expect(placeDigit(elapse(runWith(TWO_WAYS), 999), 0, 1).outcome).toEqual({ kind: 'none' });
  });
});

describe('한 판(런)의 진행', () => {
  it('첫 판은 4칸 판이고 시간과 목숨이 가득하다', () => {
    const run = newRun(seeded(1));
    expect(run.stage).toBe(1);
    expect(run.puzzle.size).toBe(4);
    expect(run.grid).toEqual(run.puzzle.givens);
    expect(run.timeLeft).toBe(TIME_BANK_SECONDS);
    expect(run.hearts).toBe(START_HEARTS);
    expect([run.score, run.cellsFilled, run.puzzlesCleared, run.mistakes]).toEqual([0, 0, 0, 0]);
  });

  it('다음 판으로 넘어가면 판만 바뀌고 점수, 시간, 목숨은 이어진다', () => {
    const run: RunState = { ...newRun(seeded(2)), score: 37, timeLeft: 51, hearts: 2, mistakes: 1 };
    const next = nextStage(run, seeded(3));
    expect(next.stage).toBe(2);
    expect(countBlanks(next.grid)).toBe(stageSpec(2).blanks);
    expect(next.grid).toEqual(next.puzzle.givens);
    expect([next.score, next.timeLeft, next.hearts, next.mistakes]).toEqual([37, 51, 2, 1]);
  });

  it('답대로 두면 4칸, 6칸, 9칸 판을 차례로 깬다', () => {
    const random = seeded(11);
    let run = newRun(random);
    let expected = 0;
    for (let stage = 1; stage <= 9; stage += 1) {
      const spec = stageSpec(stage);
      expect(run.puzzle.size).toBe(spec.size);
      run = fillOut(run);
      expected += spec.blanks * cellPoints(spec.size) + clearPoints(stage);
      expect(run.puzzlesCleared).toBe(stage);
      expect(run.score).toBe(expected);
      run = nextStage(run, random);
    }
    expect(run.stage).toBe(10);
    expect(run.hearts).toBe(START_HEARTS);
    expect(run.mistakes).toBe(0);
  });
});

describe('고르기', () => {
  const grid = TWO_WAYS;

  it('빈칸을 누르면 그 칸이 골라지고, 다시 누르면 풀린다', () => {
    const first = pressCell(grid, NO_SELECTION, 0);
    expect(first).toEqual({ selection: { cursor: 0, armed: null }, attempt: null });
    expect(pressCell(grid, first.selection, 0).selection).toEqual(NO_SELECTION);
    expect(pressCell(grid, first.selection, 2).selection).toEqual({ cursor: 2, armed: null });
  });

  it('빈칸을 고르고 숫자를 누르면 그 칸에 두려고 한다', () => {
    const selection = { cursor: 0, armed: null };
    expect(pressDigit(grid, 4, selection, 3)).toEqual({ selection, attempt: { cell: 0, digit: 3 } });
  });

  it('고른 빈칸이 없을 때 숫자를 누르면 그 숫자를 든다', () => {
    const armed = pressDigit(grid, 4, NO_SELECTION, 3);
    expect(armed).toEqual({ selection: { cursor: null, armed: 3 }, attempt: null });
    // 다른 숫자를 누르면 바꿔 들고, 같은 숫자를 다시 누르면 내려놓는다.
    expect(pressDigit(grid, 4, armed.selection, 1).selection).toEqual({ cursor: null, armed: 1 });
    expect(pressDigit(grid, 4, armed.selection, 3).selection).toEqual(NO_SELECTION);
  });

  it('숫자를 들고 빈칸을 누르면 그 칸에 두려고 하고, 숫자는 계속 들고 있다', () => {
    const selection = { cursor: null, armed: 3 };
    expect(pressCell(grid, selection, 4)).toEqual({ selection, attempt: { cell: 4, digit: 3 } });
  });

  it('채워진 칸을 누르면 두지 않고 그 칸을 고른다', () => {
    expect(pressCell(grid, { cursor: null, armed: 3 }, 1)).toEqual({
      selection: { cursor: 1, armed: null },
      attempt: null,
    });
    // 채워진 칸을 골라 둔 채 숫자를 누르면 그 숫자를 든다.
    expect(pressDigit(grid, 4, { cursor: 1, armed: null }, 3)).toEqual({
      selection: { cursor: null, armed: 3 },
      attempt: null,
    });
  });

  it('다 들어간 숫자, 없는 숫자, 판 밖의 칸은 눌러도 그대로다', () => {
    const selection = { cursor: 0, armed: null };
    // 2는 이미 네 번 다 들어갔다.
    expect(pressDigit(grid, 4, selection, 2)).toEqual({ selection, attempt: null });
    expect(pressDigit(grid, 4, NO_SELECTION, 2)).toEqual({ selection: NO_SELECTION, attempt: null });
    expect(pressDigit(grid, 4, selection, 5)).toEqual({ selection, attempt: null });
    expect(pressDigit(grid, 4, selection, 0)).toEqual({ selection, attempt: null });
    expect(pressCell(grid, selection, 16)).toEqual({ selection, attempt: null });
    expect(pressCell(grid, selection, -1)).toEqual({ selection, attempt: null });
  });

  it('맞게 둔 뒤에는 그 칸이 골라진 채로 남는다', () => {
    const after = placeDigit(runWith(grid), 0, 1).run.grid;
    expect(settleSelection(after, 4, { cursor: 0, armed: null }, { cell: 0, digit: 1 })).toEqual({
      cursor: 0,
      armed: null,
    });
  });

  it('들고 있던 숫자는 둘 곳이 남아 있는 동안 계속 들고 있다', () => {
    const holding = { cursor: null, armed: 1 };
    const one = placeDigit(runWith(grid), 0, 1).run;
    expect(settleSelection(one.grid, 4, holding, { cell: 0, digit: 1 })).toEqual(holding);
    // 마지막 1을 두면 내려놓고, 방금 채운 칸을 고른다.
    const two = placeDigit(one, 6, 1).run;
    expect(settleSelection(two.grid, 4, holding, { cell: 6, digit: 1 })).toEqual({
      cursor: 6,
      armed: null,
    });
  });

  it('들고 있는 숫자나 고른 칸의 숫자가 눈에 띄는 숫자다', () => {
    expect(highlightedDigit(grid, NO_SELECTION)).toBeNull();
    expect(highlightedDigit(grid, { cursor: null, armed: 3 })).toBe(3);
    expect(highlightedDigit(grid, { cursor: 1, armed: null })).toBe(2);
    // 빈칸을 골랐을 때는 눈에 띄게 할 숫자가 없다.
    expect(highlightedDigit(grid, { cursor: 0, armed: null })).toBeNull();
  });

  it('방향키는 고른 칸을 한 칸씩 옮기고 판 끝에서 멈춘다', () => {
    const at = (cursor: number) => ({ cursor, armed: null });
    expect(moveCursor(grid, 4, at(5), 1, 0)).toEqual(at(6));
    expect(moveCursor(grid, 4, at(5), -1, 0)).toEqual(at(4));
    expect(moveCursor(grid, 4, at(5), 0, 1)).toEqual(at(9));
    expect(moveCursor(grid, 4, at(5), 0, -1)).toEqual(at(1));
    expect(moveCursor(grid, 4, at(3), 1, 0)).toEqual(at(3));
    expect(moveCursor(grid, 4, at(12), 0, 1)).toEqual(at(12));
    expect(moveCursor(grid, 4, at(0), -1, 0)).toEqual(at(0));
  });

  it('고른 칸이 없을 때 방향키를 누르면 첫 빈칸이 골라지고, 들고 있던 숫자는 내려놓는다', () => {
    const blankAtSix = without(FULL, [6, 9]);
    expect(moveCursor(blankAtSix, 4, NO_SELECTION, 1, 0)).toEqual({ cursor: 6, armed: null });
    expect(moveCursor(blankAtSix, 4, { cursor: null, armed: 2 }, 0, 1)).toEqual({
      cursor: 6,
      armed: null,
    });
    expect(moveCursor(FULL, 4, NO_SELECTION, 1, 0)).toEqual({ cursor: 0, armed: null });
  });
});

describe('화면 배치', () => {
  const HUD = 56;
  const areaFor = (height: number): Area => ({ x: 0, y: HUD, width: GAME_WIDTH, height: height - HUD });
  const HEIGHTS = [MIN_GAME_HEIGHT, 480, MAX_GAME_HEIGHT];
  const bottomOf = (area: Area): number => area.y + area.height;
  const rightOf = (area: Area): number => area.x + area.width;

  it('가장 작은 화면부터 가장 큰 화면까지, 모든 것이 놀이 영역 안에 순서대로 놓인다', () => {
    for (const height of HEIGHTS) {
      const area = areaFor(height);
      for (const size of BOARD_SIZES) {
        const layout = boardLayout(size, area);
        const { strip, board, pad } = layout;
        expect(strip.y).toBeGreaterThanOrEqual(area.y);
        expect(bottomOf(strip)).toBeLessThanOrEqual(board.y);
        // 판 아래의 두께까지 지나서 숫자 버튼이 시작한다.
        for (const button of pad) {
          expect(button.y).toBeGreaterThan(bottomOf(board) + BOARD_LIP);
          expect(bottomOf(button)).toBeLessThanOrEqual(bottomOf(area));
          expect(button.x).toBeGreaterThanOrEqual(0);
          expect(rightOf(button)).toBeLessThanOrEqual(GAME_WIDTH);
        }
        expect(board.x).toBeGreaterThanOrEqual(4);
        expect(rightOf(board)).toBeLessThanOrEqual(GAME_WIDTH - 4);
        for (const value of [layout.cell, board.x, board.y, strip.y, ...pad.flatMap((b) => [b.x, b.y])]) {
          expect(Number.isInteger(value)).toBe(true);
        }
      }
    }
  });

  it('판은 화면의 가로 가운데에 놓인다', () => {
    for (const size of BOARD_SIZES) {
      const { board } = boardLayout(size, areaFor(MIN_GAME_HEIGHT));
      expect(Math.abs(board.x + board.width / 2 - GAME_WIDTH / 2)).toBeLessThanOrEqual(0.5);
    }
  });

  it('가장 작은 화면에서도 9칸 판의 칸은 24px 이상이고, 작은 판일수록 칸이 크다', () => {
    const area = areaFor(MIN_GAME_HEIGHT);
    const nine = boardLayout(9, area).cell;
    const six = boardLayout(6, area).cell;
    const four = boardLayout(4, area).cell;
    expect(nine).toBeGreaterThanOrEqual(24);
    expect(six).toBeGreaterThan(nine);
    expect(four).toBeGreaterThan(six);
  });

  it('숫자 버튼은 숫자마다 하나씩이고, 손가락으로 누를 만큼 크며 서로 겹치지 않는다', () => {
    for (const height of HEIGHTS) {
      for (const size of BOARD_SIZES) {
        const { pad } = boardLayout(size, areaFor(height));
        expect(pad).toHaveLength(size);
        for (const button of pad) {
          expect(button.width).toBeGreaterThanOrEqual(32);
          expect(button.height).toBeGreaterThanOrEqual(32);
        }
        for (let a = 0; a < pad.length; a += 1) {
          for (let b = a + 1; b < pad.length; b += 1) {
            const apart =
              rightOf(pad[a]) + PAD_BUTTON_GAP <= pad[b].x ||
              bottomOf(pad[a]) + PAD_BUTTON_GAP <= pad[b].y;
            expect(apart).toBe(true);
          }
        }
      }
    }
  });

  it('9칸 판의 숫자 버튼은 다섯 개와 네 개의 두 줄이고, 작은 판은 한 줄이다', () => {
    const area = areaFor(MIN_GAME_HEIGHT);
    const rowsOf = (size: BoardSize): number[] => {
      const counts = new Map<number, number>();
      for (const button of boardLayout(size, area).pad) {
        counts.set(button.y, (counts.get(button.y) ?? 0) + 1);
      }
      return [...counts.values()];
    };
    expect(rowsOf(4)).toEqual([4]);
    expect(rowsOf(6)).toEqual([6]);
    expect(rowsOf(9)).toEqual([5, 4]);
  });

  it('화면이 길어지면 버튼이 커지고 전체가 아래로 내려와 가운데에 놓인다', () => {
    for (const size of BOARD_SIZES) {
      const short = boardLayout(size, areaFor(MIN_GAME_HEIGHT));
      const tall = boardLayout(size, areaFor(MAX_GAME_HEIGHT));
      expect(tall.cell).toBeGreaterThanOrEqual(short.cell);
      expect(tall.pad[0].height).toBeGreaterThanOrEqual(short.pad[0].height);
      expect(tall.strip.y).toBeGreaterThan(short.strip.y);
      // 위아래에 남는 높이가 크게 다르지 않다.
      const above = tall.strip.y - HUD;
      const below = MAX_GAME_HEIGHT - bottomOf(tall.pad[size - 1]);
      expect(Math.abs(above - below)).toBeLessThanOrEqual(HINT_ROOM + 8);
    }
  });

  it('4칸 판 위에는 가장 작은 화면에서도 도움말 두 줄이 들어갈 자리가 있다', () => {
    const { strip } = boardLayout(4, areaFor(MIN_GAME_HEIGHT));
    expect(strip.y - HUD).toBeGreaterThanOrEqual(HINT_ROOM);
  });

  it('칸들은 겹치지 않고, 상자 사이에만 틈이 있다', () => {
    for (const size of BOARD_SIZES) {
      const layout = boardLayout(size, areaFor(MIN_GAME_HEIGHT));
      const shape = boxShape(size);
      for (let cell = 0; cell < size * size; cell += 1) {
        const area = cellArea(layout, cell);
        expect(area.width).toBe(layout.cell);
        expect(area.x).toBeGreaterThan(layout.board.x);
        expect(rightOf(area)).toBeLessThan(rightOf(layout.board));
        expect(area.y).toBeGreaterThan(layout.board.y);
        expect(bottomOf(area)).toBeLessThan(bottomOf(layout.board));
        if (colOf(size, cell) > 0) {
          const gap = area.x - rightOf(cellArea(layout, cell - 1));
          expect(gap).toBe(colOf(size, cell) % shape.cols === 0 ? BOX_GAP : 0);
        }
        if (rowOf(size, cell) > 0) {
          const gap = area.y - bottomOf(cellArea(layout, cell - size));
          expect(gap).toBe(rowOf(size, cell) % shape.rows === 0 ? BOX_GAP : 0);
        }
      }
    }
  });

  it('칸 안의 어디를 눌러도 그 칸이 골라진다', () => {
    for (const height of HEIGHTS) {
      for (const size of BOARD_SIZES) {
        const layout = boardLayout(size, areaFor(height));
        for (let cell = 0; cell < size * size; cell += 1) {
          const { x, y, width, height: tall } = cellArea(layout, cell);
          expect(cellAt(layout, x + width / 2, y + tall / 2)).toBe(cell);
          expect(cellAt(layout, x + 0.5, y + 0.5)).toBe(cell);
          expect(cellAt(layout, x + width - 0.5, y + tall - 0.5)).toBe(cell);
        }
      }
    }
  });

  it('상자 사이의 틈이나 테두리를 누르면 가장 가까운 칸이, 판 밖을 누르면 아무것도 골라지지 않는다', () => {
    const layout = boardLayout(9, areaFor(MIN_GAME_HEIGHT));
    const third = cellArea(layout, 2);
    const fourth = cellArea(layout, 3);
    const middle = third.y + third.height / 2;
    // 2번 칸과 3번 칸 사이의 틈: 왼쪽 반은 2번, 오른쪽 반은 3번이다.
    expect(cellAt(layout, rightOf(third) + 0.5, middle)).toBe(2);
    expect(cellAt(layout, fourth.x - 0.5, middle)).toBe(3);
    // 테두리와 그 바로 바깥은 맨 끝 칸으로 친다.
    expect(cellAt(layout, layout.board.x + 1, layout.board.y + 1)).toBe(0);
    expect(cellAt(layout, layout.board.x - TOUCH_SLOP + 1, middle)).toBe(0);
    expect(cellAt(layout, rightOf(layout.board) + TOUCH_SLOP - 1, bottomOf(layout.board) - 1)).toBe(80);
    expect(cellAt(layout, layout.board.x - TOUCH_SLOP - 1, middle)).toBeNull();
    expect(cellAt(layout, GAME_WIDTH / 2, layout.board.y - TOUCH_SLOP - 1)).toBeNull();
    expect(cellAt(layout, GAME_WIDTH / 2, layout.pad[0].y + 10)).toBeNull();
  });

  it('숫자 버튼을 누르면 그 숫자를, 버튼 사이를 누르면 가까운 쪽을 알려 준다', () => {
    for (const size of BOARD_SIZES) {
      const layout = boardLayout(size, areaFor(MIN_GAME_HEIGHT));
      layout.pad.forEach((button, index) => {
        expect(padDigitAt(layout, button.x + button.width / 2, button.y + button.height / 2)).toBe(index + 1);
        expect(padDigitAt(layout, button.x + 0.5, button.y + 0.5)).toBe(index + 1);
      });
      const [first, second] = layout.pad;
      const middle = first.y + first.height / 2;
      expect(padDigitAt(layout, rightOf(first) + 1, middle)).toBe(1);
      expect(padDigitAt(layout, second.x - 1, middle)).toBe(2);
      // 판을 누른 것은 숫자를 누른 것이 아니다.
      expect(padDigitAt(layout, GAME_WIDTH / 2, bottomOf(layout.board) - 2)).toBeNull();
      expect(padDigitAt(layout, first.x - TOUCH_SLOP - 1, middle)).toBeNull();
    }
  });
});
