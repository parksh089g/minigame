/**
 * 숫자 퍼즐의 규칙. 화면과 분리된 순수 함수라서 숫자만 바꿔 밸런스를 조정할 수 있다.
 * 판은 한 변이 size칸인 정사각형이다. 칸은 왼쪽 위가 0번이고, 오른쪽으로, 그다음 줄로 번호가 이어진다.
 * 칸의 값은 1부터 size까지의 숫자이고 0은 빈칸이다.
 * 가로줄, 세로줄, 상자마다 모든 숫자가 한 번씩 들어가면 판이 풀린다.
 * 무작위가 필요한 곳은 random(0 이상 1 미만의 수를 돌려주는 함수)을 받아서 쓴다.
 */

import { difficultyOf } from '../../core/stages';

/** 판의 한 변의 칸 수. 숫자도 1부터 이 수까지 쓴다. */
export type BoardSize = 4 | 6 | 9;
export const BOARD_SIZES: readonly BoardSize[] = [4, 6, 9];

/** 칸의 값들. 길이는 size * size다. */
export type Grid = readonly number[];

export interface BoxShape {
  /** 상자 하나의 세로 칸 수 */
  rows: number;
  /** 상자 하나의 가로 칸 수 */
  cols: number;
}

/** 판 크기마다의 상자 모양. 6칸 판의 상자는 가로로 긴 2×3이다. */
const BOX_SHAPES: Readonly<Record<BoardSize, BoxShape>> = {
  4: { rows: 2, cols: 2 },
  6: { rows: 2, cols: 3 },
  9: { rows: 3, cols: 3 },
};

// ───────── 줄과 상자 ─────────

export function boxShape(size: BoardSize): BoxShape {
  return BOX_SHAPES[size];
}

export function rowOf(size: BoardSize, cell: number): number {
  return Math.floor(cell / size);
}

export function colOf(size: BoardSize, cell: number): number {
  return cell % size;
}

/** 칸이 든 상자의 번호. 왼쪽 위 상자가 0번이고, 오른쪽으로, 그다음 줄로 이어진다. */
export function boxOf(size: BoardSize, cell: number): number {
  const shape = BOX_SHAPES[size];
  const boxesAcross = size / shape.cols;
  return (
    Math.floor(rowOf(size, cell) / shape.rows) * boxesAcross +
    Math.floor(colOf(size, cell) / shape.cols)
  );
}

interface Geometry {
  /** 가로줄 size개, 세로줄 size개, 상자 size개의 순서로, 저마다 거기에 든 칸 번호들 */
  units: readonly (readonly number[])[];
  /** 칸마다, 같은 가로줄이나 세로줄이나 상자에 있는 다른 칸들 */
  peers: readonly (readonly number[])[];
}

/** 판 크기는 세 가지뿐이라, 한 번 계산한 줄과 상자를 그대로 다시 쓴다. */
const GEOMETRY = new Map<BoardSize, Geometry>();

function geometryOf(size: BoardSize): Geometry {
  const known = GEOMETRY.get(size);
  if (known) return known;

  const units: number[][] = Array.from({ length: size * 3 }, () => []);
  for (let cell = 0; cell < size * size; cell += 1) {
    units[rowOf(size, cell)].push(cell);
    units[size + colOf(size, cell)].push(cell);
    units[size * 2 + boxOf(size, cell)].push(cell);
  }
  const peers = Array.from({ length: size * size }, (_, cell) => {
    const through = [rowOf(size, cell), size + colOf(size, cell), size * 2 + boxOf(size, cell)];
    const others = new Set(through.flatMap((unit) => units[unit]));
    others.delete(cell);
    return [...others].sort((a, b) => a - b);
  });
  const geometry: Geometry = { units, peers };
  GEOMETRY.set(size, geometry);
  return geometry;
}

/** 숫자가 한 번씩 들어가야 하는 모든 묶음: 가로줄들, 세로줄들, 상자들의 순서다. */
export function unitsOf(size: BoardSize): readonly (readonly number[])[] {
  return geometryOf(size).units;
}

/** 그 칸을 지나는 세 묶음: 가로줄, 세로줄, 상자. */
export function unitsThrough(size: BoardSize, cell: number): readonly (readonly number[])[] {
  const { units } = geometryOf(size);
  return [
    units[rowOf(size, cell)],
    units[size + colOf(size, cell)],
    units[size * 2 + boxOf(size, cell)],
  ];
}

/** 같은 가로줄이나 세로줄이나 상자에 있는 다른 칸들. 이 칸들과는 숫자가 달라야 한다. */
export function peersOf(size: BoardSize, cell: number): readonly number[] {
  return geometryOf(size).peers[cell];
}

// ───────── 둘 수 있는 숫자 ─────────

/** 숫자 묶음은 비트로 적는다: 숫자 d가 2의 d제곱 자리다. */
function allDigitBits(size: BoardSize): number {
  return (2 << size) - 2;
}

/** 빈칸에 아직 둘 수 있는 숫자들(비트). 같은 줄과 상자에 이미 있는 숫자를 뺀 것이다. */
function candidateBits(grid: Grid, size: BoardSize, cell: number): number {
  let used = 0;
  for (const peer of geometryOf(size).peers[cell]) used |= 1 << grid[peer];
  return allDigitBits(size) & ~used;
}

function countBits(bits: number): number {
  let count = 0;
  for (let rest = bits; rest !== 0; rest &= rest - 1) count += 1;
  return count;
}

function digitsIn(bits: number): number[] {
  const digits: number[] = [];
  for (let digit = 1; bits >> digit !== 0; digit += 1) {
    if ((bits >> digit) & 1) digits.push(digit);
  }
  return digits;
}

/** 그 칸에 두어도 같은 줄과 상자의 숫자와 겹치지 않는 숫자들. 작은 수부터. */
export function candidatesOf(grid: Grid, size: BoardSize, cell: number): number[] {
  return digitsIn(candidateBits(grid, size, cell));
}

/** 그 칸에 digit을 두면 겹치게 되는 칸들: 같은 줄이나 상자에서 이미 digit이 든 칸. */
export function clashesOf(grid: Grid, size: BoardSize, cell: number, digit: number): number[] {
  return peersOf(size, cell).filter((peer) => grid[peer] === digit);
}

export function countBlanks(grid: Grid): number {
  return grid.reduce((count, value) => count + (value === 0 ? 1 : 0), 0);
}

/** 판에 digit이 size번 다 들어갔는지. 다 들어간 숫자는 더 둘 곳이 없다. */
export function isDigitDone(grid: Grid, size: BoardSize, digit: number): boolean {
  return grid.reduce((count, value) => count + (value === digit ? 1 : 0), 0) >= size;
}

/** 크기와 값이 맞고, 어느 줄이나 상자에도 같은 숫자가 두 번 들어 있지 않은지. 빈칸은 있어도 된다. */
export function isValidGrid(grid: Grid, size: BoardSize): boolean {
  if (grid.length !== size * size) return false;
  if (!grid.every((value) => Number.isInteger(value) && value >= 0 && value <= size)) return false;
  return unitsOf(size).every((unit) => {
    let seen = 0;
    for (const cell of unit) {
      const bit = 1 << grid[cell];
      if (grid[cell] !== 0 && seen & bit) return false;
      seen |= bit;
    }
    return true;
  });
}

/** 빈칸 없이 규칙대로 다 채워졌는지 */
export function isSolved(grid: Grid, size: BoardSize): boolean {
  return isValidGrid(grid, size) && !grid.includes(0);
}

// ───────── 풀이 ─────────

export interface SinglesStep {
  cell: number;
  digit: number;
  /**
   * cell: 그 칸에 둘 수 있는 숫자가 하나뿐이다.
   * unit: 어느 줄이나 상자에서 그 숫자가 들어갈 칸이 거기 하나뿐이다.
   */
  kind: 'cell' | 'unit';
}

export interface SinglesResult {
  /** 끝까지 풀렸는지 */
  solved: boolean;
  /** 풀 수 있는 데까지 채운 판 */
  grid: number[];
  /** 채운 순서 */
  steps: SinglesStep[];
}

/** 둘 수 있는 숫자가 하나뿐인 빈칸을 모두 채운다. 채운 칸 수를 돌려준다. */
function fillCellSingles(work: number[], size: BoardSize, steps: SinglesStep[]): number {
  let filled = 0;
  for (let cell = 0; cell < work.length; cell += 1) {
    if (work[cell] !== 0) continue;
    const bits = candidateBits(work, size, cell);
    if (countBits(bits) !== 1) continue;
    const digit = digitsIn(bits)[0];
    work[cell] = digit;
    steps.push({ cell, digit, kind: 'cell' });
    filled += 1;
  }
  return filled;
}

/** 줄이나 상자에서 어떤 숫자가 들어갈 칸이 하나뿐이면 거기에 채운다. 채운 칸 수를 돌려준다. */
function fillUnitSingles(work: number[], size: BoardSize, steps: SinglesStep[]): number {
  let filled = 0;
  for (const unit of unitsOf(size)) {
    for (let digit = 1; digit <= size; digit += 1) {
      let home = -1;
      let homes = 0;
      // 그 숫자가 이미 든 줄이나 상자에서는 어느 빈칸에도 둘 수 없으므로 저절로 건너뛴다.
      for (const cell of unit) {
        if (work[cell] !== 0 || !((candidateBits(work, size, cell) >> digit) & 1)) continue;
        home = cell;
        homes += 1;
      }
      if (homes !== 1) continue;
      work[home] = digit;
      steps.push({ cell: home, digit, kind: 'unit' });
      filled += 1;
    }
  }
  return filled;
}

/**
 * 찍지 않고 풀 수 있는 데까지 푼다. 쓰는 방법은 두 가지뿐이다:
 * 둘 수 있는 숫자가 하나뿐인 칸을 채우기, 줄이나 상자에서 갈 곳이 하나뿐인 숫자를 채우기.
 * 두 방법 모두 그 숫자일 수밖에 없는 칸만 채우므로, 이렇게 끝까지 풀리는 판은 답이 하나뿐이다.
 * 받은 판은 바꾸지 않는다.
 */
export function solveWithSingles(grid: Grid, size: BoardSize): SinglesResult {
  const work = [...grid];
  const steps: SinglesStep[] = [];
  // 한 바퀴 돌아도 더 채운 칸이 없을 때까지 되풀이한다.
  let filled = 1;
  while (filled > 0) {
    filled = fillCellSingles(work, size, steps) + fillUnitSingles(work, size, steps);
  }
  return { solved: isSolved(work, size), grid: work, steps };
}

/** 빈칸 가운데 둘 수 있는 숫자가 가장 적은 칸. 빈칸이 없으면 null. */
function tightestBlank(grid: Grid, size: BoardSize): { cell: number; bits: number } | null {
  let best: { cell: number; bits: number } | null = null;
  let fewest = Infinity;
  for (let cell = 0; cell < grid.length; cell += 1) {
    if (grid[cell] !== 0) continue;
    const bits = candidateBits(grid, size, cell);
    const count = countBits(bits);
    if (count >= fewest) continue;
    best = { cell, bits };
    fewest = count;
  }
  return best;
}

function countFrom(work: number[], size: BoardSize, limit: number): number {
  const blank = tightestBlank(work, size);
  if (!blank) return 1;
  let found = 0;
  for (const digit of digitsIn(blank.bits)) {
    work[blank.cell] = digit;
    found += countFrom(work, size, limit - found);
    if (found >= limit) break;
  }
  work[blank.cell] = 0;
  return found;
}

/**
 * 답이 몇 가지인지 센다. limit개를 찾으면 더 세지 않는다(기본 2: 답이 하나뿐인지만 알면 된다).
 * 숫자를 하나씩 넣어 보며 끝까지 따져서, solveWithSingles와는 다른 길로 답이 하나임을 확인해 준다.
 */
export function countSolutions(grid: Grid, size: BoardSize, limit = 2): number {
  if (limit <= 0 || !isValidGrid(grid, size)) return 0;
  return countFrom([...grid], size, limit);
}

// ───────── 판 만들기 ─────────

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function fillFrom(work: number[], size: BoardSize, random: () => number): boolean {
  const blank = tightestBlank(work, size);
  if (!blank) return true;
  for (const digit of shuffled(digitsIn(blank.bits), random)) {
    work[blank.cell] = digit;
    if (fillFrom(work, size, random)) return true;
  }
  work[blank.cell] = 0;
  return false;
}

/**
 * 규칙대로 다 채워진 판을 무작위로 하나 만든다.
 * 둘 수 있는 숫자가 가장 적은 칸부터 무작위 숫자를 넣고, 막히면 되돌아가 다른 숫자를 넣는다.
 */
export function generateSolution(size: BoardSize, random: () => number): number[] {
  const work = Array<number>(size * size).fill(0);
  fillFrom(work, size, random);
  return work;
}

export interface StageSpec {
  size: BoardSize;
  /** 비워 두는 칸 수 */
  blanks: number;
}

/**
 * 처음 몇 판의 크기와 빈칸 수. 4칸 판에서 규칙을 익히고, 6칸 판을 거쳐 9칸 판으로 간다.
 * 판이 커질 때는 빈칸을 조금만 두어, 넓어진 판에 눈이 익을 틈을 준다.
 */
const LADDER: readonly StageSpec[] = [
  { size: 4, blanks: 4 },
  { size: 4, blanks: 6 },
  { size: 4, blanks: 8 },
  { size: 6, blanks: 8 },
  { size: 6, blanks: 11 },
  { size: 6, blanks: 14 },
  { size: 9, blanks: 12 },
];

/** LADDER가 끝난 뒤로는 9칸 판에서 판마다 빈칸이 이만큼씩 늘어난다. */
export const BLANKS_STEP = 3;
/**
 * 9칸 판의 빈칸 수의 상한. 이보다 많이 비우면 찍지 않고 풀리는 판을 만들기가 어려워지고,
 * 한 판이 지나치게 길어진다.
 */
export const MAX_BLANKS = 45;

/** stage(1부터)번째 판의 크기와 빈칸 수 */
export function stageSpec(stage: number): StageSpec {
  const level = Math.max(1, Math.floor(stage));
  if (level <= LADDER.length) return LADDER[level - 1];
  const last = LADDER[LADDER.length - 1];
  const blanks = last.blanks + (level - LADDER.length) * BLANKS_STEP;
  return { size: last.size, blanks: Math.min(MAX_BLANKS, blanks) };
}

export interface Puzzle {
  size: BoardSize;
  /** 처음에 보이는 판. 0은 채워야 할 빈칸이다. */
  givens: Grid;
  /** 다 채운 판. 답은 이것 하나뿐이다. */
  solution: Grid;
}

/** 한 판을 만들 때 다 채운 판을 새로 뽑아 다시 해 보는 횟수의 상한 */
export const MAX_ATTEMPTS = 30;

/**
 * 다 채운 판에서 칸을 무작위 순서로 하나씩 비운다.
 * 비운 뒤에도 solveWithSingles로 끝까지 풀리는 칸만 비우고, 그렇지 않은 칸은 도로 채운다.
 */
function dig(solution: Grid, size: BoardSize, blanks: number, random: () => number): number[] {
  const givens = [...solution];
  let removed = 0;
  for (const cell of shuffled([...givens.keys()], random)) {
    if (removed >= blanks) break;
    givens[cell] = 0;
    if (solveWithSingles(givens, size).solved) removed += 1;
    else givens[cell] = solution[cell];
  }
  return givens;
}

/**
 * stage(1부터)번째 판을 만든다. 답이 하나뿐이고 찍지 않고 풀 수 있는 판만 나온다.
 * 빈칸을 정해진 수만큼 비우지 못하면 다 채운 판을 새로 뽑아 다시 한다.
 * 횟수를 다 쓰도록 안 되면(고장 난 random이 아니고서는 일어나지 않는다)
 * 그동안 나온 것 가운데 빈칸이 가장 많은 판을 쓴다. 그것도 찍지 않고 풀리는 판이다.
 */
export function generatePuzzle(stage: number, random: () => number): Puzzle {
  const { size, blanks } = stageSpec(stage);
  const attempt = (): Puzzle => {
    const solution = generateSolution(size, random);
    return { size, givens: dig(solution, size, blanks, random), solution };
  };
  let best = attempt();
  for (let tries = 1; tries < MAX_ATTEMPTS && countBlanks(best.givens) < blanks; tries += 1) {
    const puzzle = attempt();
    if (countBlanks(puzzle.givens) > countBlanks(best.givens)) best = puzzle;
  }
  return best;
}

// ───────── 시간과 목숨 ─────────

/** 처음에 주어지는 시간(초). 판을 깨서 돌려받아도 이보다 많아지지는 않는다. */
export const TIME_BANK_SECONDS = 90;

/**
 * 판을 깼을 때 돌려받는 시간(초). 큰 판일수록 많이 돌려받는다.
 * 9칸 판은 빈칸이 판마다 늘어나는데 돌려받는 시간은 그대로라서, 한 판(런)은 언젠가 끝난다.
 */
const CLEAR_SECONDS: Readonly<Record<BoardSize, number>> = { 4: 10, 6: 20, 9: 30 };

/** stage번째 판을 깼을 때 돌려받는 시간(초) */
export function clearSeconds(stage: number): number {
  return CLEAR_SECONDS[stageSpec(stage).size];
}

/** 목숨(하트)의 수. 틀린 숫자를 두려고 할 때마다 하나씩 줄고, 다시 늘지 않는다. */
export const START_HEARTS = 3;

// ───────── 점수 ─────────

/** 맞게 채운 칸 하나의 점수. 큰 판일수록 맞는 숫자를 찾기 어려워서 조금 더 준다. */
const CELL_POINTS: Readonly<Record<BoardSize, number>> = { 4: 2, 6: 3, 9: 4 };
/** 판을 깼을 때의 보너스: 판 번호에 이 값을 곱한다. */
export const CLEAR_POINTS_PER_STAGE = 5;

export function cellPoints(size: BoardSize): number {
  return CELL_POINTS[size];
}

/** stage번째 판을 깼을 때의 보너스. 뒤의 판일수록 크다. */
export function clearPoints(stage: number): number {
  return CLEAR_POINTS_PER_STAGE * Math.max(1, Math.floor(stage));
}

// ───────── 한 판(런)의 진행 ─────────

export interface RunState {
  /** 지금 판의 번호. 1부터 센다. */
  stage: number;
  puzzle: Puzzle;
  /** 지금 판의 모습: 처음 숫자에 맞게 채운 숫자가 더해진다. */
  grid: Grid;
  /** 남은 시간(초) */
  timeLeft: number;
  hearts: number;
  score: number;
  cellsFilled: number;
  puzzlesCleared: number;
  /** 틀린 숫자를 두려고 한 횟수 */
  mistakes: number;
}

export type PlaceOutcome =
  /** 아무 일도 없다: 빈칸이 아니거나, 없는 숫자이거나, 이미 끝났다. */
  | { kind: 'none' }
  | {
      kind: 'placed';
      cell: number;
      digit: number;
      points: number;
      /** 이번 숫자로 다 채워진 줄과 상자들(저마다 칸 번호들) */
      filledUnits: readonly (readonly number[])[];
      /** 이 숫자가 판에 다 들어갔는지 */
      digitDone: boolean;
      /** 마지막 빈칸이었으면 판을 깬 보상(점수, 돌려받은 시간) */
      cleared: { points: number; seconds: number } | null;
    }
  /** 틀린 숫자라서 두지 않았다. clashes는 같은 줄이나 상자에서 그 숫자가 이미 든 칸들이다. */
  | { kind: 'wrong'; cell: number; digit: number; clashes: number[] };

function startStage(stage: number, random: () => number): Pick<RunState, 'stage' | 'puzzle' | 'grid'> {
  const puzzle = generatePuzzle(stage, random);
  return { stage, puzzle, grid: puzzle.givens };
}

/** stage번째 판에서 새로 시작하는 한 판: 시간과 목숨이 가득하고 점수는 0이다. */
function runAt(stage: number, random: () => number): RunState {
  return {
    ...startStage(stage, random),
    timeLeft: TIME_BANK_SECONDS,
    hearts: START_HEARTS,
    score: 0,
    cellsFilled: 0,
    puzzlesCleared: 0,
    mistakes: 0,
  };
}

export function newRun(random: () => number): RunState {
  return runAt(1, random);
}

/** 시간이나 목숨이 다해서 끝났는지 */
export function isOver(run: RunState): boolean {
  return run.timeLeft <= 0 || run.hearts <= 0;
}

/**
 * 빈칸 cell에 digit을 두려고 한다. 답과 같으면 두고 점수를 주고, 다르면 두지 않고 목숨을 하나 깎는다.
 * 받은 상태는 바꾸지 않고 새 상태를 돌려준다.
 */
export function placeDigit(
  run: RunState,
  cell: number,
  digit: number,
): { run: RunState; outcome: PlaceOutcome } {
  const { size, solution } = run.puzzle;
  const playable = !isOver(run) && run.grid[cell] === 0 && Number.isInteger(digit);
  if (!playable || digit < 1 || digit > size) return { run, outcome: { kind: 'none' } };

  if (solution[cell] !== digit) {
    return {
      run: { ...run, hearts: run.hearts - 1, mistakes: run.mistakes + 1 },
      outcome: { kind: 'wrong', cell, digit, clashes: clashesOf(run.grid, size, cell, digit) },
    };
  }

  const grid = run.grid.map((value, index) => (index === cell ? digit : value));
  const points = cellPoints(size);
  const placed = {
    kind: 'placed',
    cell,
    digit,
    points,
    filledUnits: unitsThrough(size, cell).filter((unit) => unit.every((each) => grid[each] !== 0)),
    digitDone: isDigitDone(grid, size, digit),
  } as const;
  const next: RunState = { ...run, grid, score: run.score + points, cellsFilled: run.cellsFilled + 1 };
  if (grid.includes(0)) return { run: next, outcome: { ...placed, cleared: null } };

  const timeLeft = Math.min(TIME_BANK_SECONDS, run.timeLeft + clearSeconds(run.stage));
  const cleared = { points: clearPoints(run.stage), seconds: timeLeft - run.timeLeft };
  return {
    run: {
      ...next,
      timeLeft,
      score: next.score + cleared.points,
      puzzlesCleared: run.puzzlesCleared + 1,
    },
    outcome: { ...placed, cleared },
  };
}

/** 시간이 흐른다. 0 아래로는 내려가지 않는다. */
export function elapse(run: RunState, seconds: number): RunState {
  return { ...run, timeLeft: Math.max(0, run.timeLeft - Math.max(0, seconds)) };
}

/** 다음 판으로 넘어간다. 판을 다 채운 뒤에 부른다. */
export function nextStage(run: RunState, random: () => number): RunState {
  return { ...run, ...startStage(run.stage + 1, random) };
}

// ───────── 단계 모드 ─────────

/** 단계 모드가 거치는 난이도의 수: 첫 판부터 빈칸이 MAX_BLANKS에 닿는 판까지 */
export const LEVEL_STEPS =
  LADDER.length + Math.ceil((MAX_BLANKS - LADDER[LADDER.length - 1].blanks) / BLANKS_STEP);

/** 단계 모드의 level단계가 점수 도전의 몇째 판과 같은 크기와 빈칸 수인지 */
export function levelStage(level: number): number {
  return difficultyOf(level, LEVEL_STEPS);
}

/**
 * 단계 모드의 한 단계. 시간은 흐르지 않고(elapse를 부르지 않는다), 판 하나를 다 채우면 끝난다.
 * 목숨은 단계마다 새로 받는다. 같은 random이면 같은 판이 나온다.
 */
export function levelRun(level: number, random: () => number): RunState {
  return runAt(levelStage(level), random);
}

// ───────── 고르기 ─────────

/**
 * 지금 골라 둔 것. 칸을 먼저 고르고 숫자를 누를 수도 있고(cursor),
 * 숫자를 먼저 고르고 빈칸을 누를 수도 있다(armed). 둘이 함께 골라져 있지는 않다.
 */
export interface Selection {
  /** 골라 둔 칸. 채워진 칸일 수도 있다(그 숫자를 찾아볼 때). */
  cursor: number | null;
  /** 들고 있는 숫자. 빈칸을 누르면 이 숫자를 둔다. */
  armed: number | null;
}

export const NO_SELECTION: Selection = { cursor: null, armed: null };

/** 숫자를 두려는 시도 */
export interface Attempt {
  cell: number;
  digit: number;
}

export interface Press {
  selection: Selection;
  /** 이번에 누른 것으로 숫자를 두게 되었으면 그 시도. placeDigit에 넘긴다. */
  attempt: Attempt | null;
}

/**
 * 칸을 눌렀을 때. 숫자를 들고 있으면 빈칸에 그 숫자를 두려고 하고,
 * 아니면 그 칸을 고른다. 골라 둔 칸을 다시 누르면 고른 것이 풀린다.
 */
export function pressCell(grid: Grid, selection: Selection, cell: number): Press {
  if (cell < 0 || cell >= grid.length) return { selection, attempt: null };
  if (grid[cell] === 0 && selection.armed !== null) {
    return { selection, attempt: { cell, digit: selection.armed } };
  }
  const cursor = selection.cursor === cell ? null : cell;
  return { selection: { cursor, armed: null }, attempt: null };
}

/**
 * 숫자를 눌렀을 때. 빈칸을 골라 두었으면 거기에 그 숫자를 두려고 하고,
 * 아니면 그 숫자를 든다. 들고 있는 숫자를 다시 누르면 내려놓는다.
 * 판에 이미 다 들어간 숫자는 눌러도 아무 일이 없다.
 */
export function pressDigit(grid: Grid, size: BoardSize, selection: Selection, digit: number): Press {
  const known = Number.isInteger(digit) && digit >= 1 && digit <= size;
  if (!known || isDigitDone(grid, size, digit)) return { selection, attempt: null };
  if (selection.cursor !== null && grid[selection.cursor] === 0) {
    return { selection, attempt: { cell: selection.cursor, digit } };
  }
  const armed = selection.armed === digit ? null : digit;
  return { selection: { cursor: null, armed }, attempt: null };
}

/**
 * 숫자를 맞게 둔 뒤의 고르기. grid는 숫자를 둔 뒤의 판이다.
 * 방금 채운 칸을 골라 둔 채로 두어서 같은 숫자가 눈에 띄게 한다. 다만 들고 있는 숫자가
 * 아직 더 들어갈 곳이 있으면 그대로 들고 있어서, 같은 숫자를 이어서 둘 수 있다.
 */
export function settleSelection(
  grid: Grid,
  size: BoardSize,
  selection: Selection,
  placed: Attempt,
): Selection {
  const keepArmed = selection.armed !== null && !isDigitDone(grid, size, selection.armed);
  return keepArmed ? selection : { cursor: placed.cell, armed: null };
}

/**
 * 방향키로 고른 칸을 옮긴다. 판 끝에서는 더 가지 않는다.
 * 골라 둔 칸이 없으면 첫 빈칸을 고른다. 들고 있던 숫자는 내려놓는다.
 */
export function moveCursor(
  grid: Grid,
  size: BoardSize,
  selection: Selection,
  dCol: number,
  dRow: number,
): Selection {
  if (selection.cursor === null) {
    return { cursor: Math.max(0, grid.indexOf(0)), armed: null };
  }
  const clamp = (value: number): number => Math.min(size - 1, Math.max(0, value));
  const col = clamp(colOf(size, selection.cursor) + dCol);
  const row = clamp(rowOf(size, selection.cursor) + dRow);
  return { cursor: row * size + col, armed: null };
}

/** 판에서 눈에 띄게 할 숫자: 들고 있는 숫자이거나, 골라 둔 칸에 든 숫자. 없으면 null. */
export function highlightedDigit(grid: Grid, selection: Selection): number | null {
  if (selection.armed !== null) return selection.armed;
  if (selection.cursor === null) return null;
  return grid[selection.cursor] === 0 ? null : grid[selection.cursor];
}

// ───────── 화면 배치 ─────────

/** 판과 화면 옆 끝 사이의 여백(px) */
export const SIDE_MARGIN = 5;
/** 판의 테두리 두께(px). 칸들은 이만큼 안쪽에서 시작한다. */
export const BOARD_RIM = 4;
/** 상자와 상자 사이의 틈(px). 칸과 칸은 틈 없이 맞닿는다. */
export const BOX_GAP = 3;
/** 판 아래쪽에 보이는 두께(px) */
export const BOARD_LIP = 3;
/** 한 칸의 가장 큰 크기(px). 4칸 판이 화면을 꽉 채워 숫자가 지나치게 커 보이지 않게 한다. */
export const MAX_CELL = 46;
/** 판 위에 하트와 남은 칸 수를 적는 줄의 높이, 그 줄과 판 사이의 틈(px) */
export const STRIP_HEIGHT = 18;
export const STRIP_GAP = 3;
/** 숫자 버튼의 높이(px). 화면이 길면 max까지 커진다. */
export const PAD_BUTTON_HEIGHT = { min: 34, max: 44 } as const;
/** 숫자 버튼 사이의 틈(px) */
export const PAD_BUTTON_GAP = 4;
/** 숫자 버튼의 가장 큰 폭(px) */
export const PAD_BUTTON_MAX_WIDTH = 48;
/** 숫자 버튼이 이보다 많으면 두 줄로 나눈다. 9칸 판은 다섯 개와 네 개로 나뉜다. */
export const PAD_MAX_PER_ROW = 6;
/** 판과 숫자 버튼 사이의 틈(px). 화면이 길면 max까지 벌어진다. */
export const PAD_GAP = { min: 7, max: 14 } as const;
/** 맨 위와 맨 아래에 남기는 여백(px) */
export const EDGE_MARGIN = { top: 2, bottom: 4 } as const;
/** 4칸 판 위에 도움말 두 줄을 띄우려고 비워 두는 높이(px) */
export const HINT_ROOM = 38;
/** 판이나 숫자 버튼의 바깥을 이만큼 벗어나 눌러도 가장 가까운 칸이나 버튼을 누른 것으로 친다(px). */
export const TOUCH_SLOP = 4;

export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BoardLayout {
  size: BoardSize;
  /** 한 칸의 크기(px) */
  cell: number;
  /** 하트와 남은 칸 수를 적는 줄 */
  strip: Area;
  /** 판(둥근 카드). 아래 두께는 넣지 않았다. */
  board: Area;
  /** 숫자 버튼들. i번째가 숫자 i + 1이다. 높이에는 아래 두께도 들어 있다. */
  pad: Area[];
}

function padRows(size: BoardSize): number {
  return Math.ceil(size / PAD_MAX_PER_ROW);
}

/** 숫자 버튼들의 자리. width 폭의 가운데에 모으고, 두 줄이면 위 줄에 하나 더 놓는다. */
function padAreas(size: BoardSize, centerX: number, top: number, width: number, height: number): Area[] {
  const rows = padRows(size);
  const perRow = Math.ceil(size / rows);
  const buttonWidth = Math.min(
    PAD_BUTTON_MAX_WIDTH,
    Math.floor((width - (perRow - 1) * PAD_BUTTON_GAP) / perRow),
  );
  const pitch = buttonWidth + PAD_BUTTON_GAP;
  return Array.from({ length: size }, (_, index) => {
    const row = Math.floor(index / perRow);
    const inRow = Math.min(perRow, size - row * perRow);
    const left = centerX - (inRow * pitch - PAD_BUTTON_GAP) / 2;
    return {
      x: Math.round(left + (index - row * perRow) * pitch),
      y: top + row * (height + PAD_BUTTON_GAP),
      width: buttonWidth,
      height,
    };
  });
}

/**
 * 놀이 영역(HUD 아래)에 위에서부터 하트 줄, 판, 숫자 버튼을 놓는다.
 * 칸은 영역에 들어가는 가장 큰 크기로 하고, 남는 높이는 버튼을 키우고 틈을 벌리는 데 먼저 쓴 뒤
 * 나머지로 전체를 세로 가운데에 놓는다. 칸 크기와 좌표는 모두 정수다.
 */
export function boardLayout(size: BoardSize, area: Area): BoardLayout {
  const shape = BOX_SHAPES[size];
  const gapsAcross = (size / shape.cols - 1) * BOX_GAP;
  const gapsDown = (size / shape.rows - 1) * BOX_GAP;
  const rows = padRows(size);
  const padHeight = (button: number): number => rows * button + (rows - 1) * PAD_BUTTON_GAP;
  const fixed =
    EDGE_MARGIN.top +
    STRIP_HEIGHT +
    STRIP_GAP +
    BOARD_RIM * 2 +
    gapsDown +
    BOARD_LIP +
    PAD_GAP.min +
    padHeight(PAD_BUTTON_HEIGHT.min) +
    EDGE_MARGIN.bottom;
  const cell = Math.min(
    MAX_CELL,
    Math.floor((area.width - SIDE_MARGIN * 2 - BOARD_RIM * 2 - gapsAcross) / size),
    Math.floor((area.height - fixed) / size),
  );
  const boardWidth = size * cell + gapsAcross + BOARD_RIM * 2;
  const boardHeight = size * cell + gapsDown + BOARD_RIM * 2;

  let spare = area.height - fixed - size * cell;
  const button = Math.min(PAD_BUTTON_HEIGHT.max, PAD_BUTTON_HEIGHT.min + Math.floor(spare / rows));
  spare -= (button - PAD_BUTTON_HEIGHT.min) * rows;
  const padGap = Math.min(PAD_GAP.max, PAD_GAP.min + Math.floor(spare / 4));
  spare -= padGap - PAD_GAP.min;
  const hintRoom = size === BOARD_SIZES[0] ? Math.min(HINT_ROOM, spare) : 0;

  const left = Math.round(area.x + (area.width - boardWidth) / 2);
  const stripTop = area.y + EDGE_MARGIN.top + hintRoom + Math.floor((spare - hintRoom) / 2);
  const boardTop = stripTop + STRIP_HEIGHT + STRIP_GAP;
  const padTop = boardTop + boardHeight + BOARD_LIP + padGap;
  return {
    size,
    cell,
    strip: { x: left, y: stripTop, width: boardWidth, height: STRIP_HEIGHT },
    board: { x: left, y: boardTop, width: boardWidth, height: boardHeight },
    pad: padAreas(size, area.x + area.width / 2, padTop, boardWidth, button),
  };
}

/** 줄(가로든 세로든) 안에서 index번째 칸이 시작하는 자리. perBox는 그 방향으로 상자 하나에 든 칸 수다. */
function lineOffset(layout: BoardLayout, index: number, perBox: number): number {
  return BOARD_RIM + index * layout.cell + Math.floor(index / perBox) * BOX_GAP;
}

/** 칸이 화면에서 차지하는 자리 */
export function cellArea(layout: BoardLayout, cell: number): Area {
  const shape = BOX_SHAPES[layout.size];
  return {
    x: layout.board.x + lineOffset(layout, colOf(layout.size, cell), shape.cols),
    y: layout.board.y + lineOffset(layout, rowOf(layout.size, cell), shape.rows),
    width: layout.cell,
    height: layout.cell,
  };
}

/** 줄 안에서 offset(판의 끝에서 잰 거리)에 가장 가까운 칸의 번호 */
function nearestInLine(layout: BoardLayout, offset: number, perBox: number): number {
  let best = 0;
  let bestDistance = Infinity;
  for (let index = 0; index < layout.size; index += 1) {
    const center = lineOffset(layout, index, perBox) + layout.cell / 2;
    const distance = Math.abs(offset - center);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return best;
}

/** (x, y)를 눌렀을 때 고르게 되는 칸. 상자 사이의 틈이나 테두리를 누르면 가장 가까운 칸이고, 판 밖이면 null. */
export function cellAt(layout: BoardLayout, x: number, y: number): number | null {
  const { board, size } = layout;
  const inside =
    x >= board.x - TOUCH_SLOP &&
    x < board.x + board.width + TOUCH_SLOP &&
    y >= board.y - TOUCH_SLOP &&
    y < board.y + board.height + TOUCH_SLOP;
  if (!inside) return null;
  const shape = BOX_SHAPES[size];
  const col = nearestInLine(layout, x - board.x, shape.cols);
  const row = nearestInLine(layout, y - board.y, shape.rows);
  return row * size + col;
}

/** (x, y)를 눌렀을 때 누르게 되는 숫자 버튼의 숫자. 버튼 사이의 틈도 가까운 버튼으로 친다. 없으면 null. */
export function padDigitAt(layout: BoardLayout, x: number, y: number): number | null {
  let best: number | null = null;
  let bestDistance = Infinity;
  layout.pad.forEach((button, index) => {
    const dx = Math.max(button.x - x, 0, x - (button.x + button.width));
    const dy = Math.max(button.y - y, 0, y - (button.y + button.height));
    const distance = Math.max(dx, dy);
    if (distance > TOUCH_SLOP || distance >= bestDistance) return;
    best = index + 1;
    bestDistance = distance;
  });
  return best;
}
