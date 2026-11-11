import { describe, expect, it } from 'vitest';
import { GAME_WIDTH, MIN_GAME_HEIGHT } from '../../config';
import {
  blockageOf,
  blockedShare,
  BLOCKED_SHARE_SPREAD,
  BUMP_PENALTY_SECONDS,
  canLeave,
  carAt,
  carPoints,
  CAR_POINTS,
  cellsOf,
  clearPoints,
  clearSeconds,
  elapse,
  exitPath,
  FIRST_CLEAR_SECONDS,
  generateLot,
  isOver,
  LONG_CAR,
  LOT_MARGIN,
  lotLayout,
  MAX_CELL,
  MAX_COLS,
  MAX_ROWS,
  MAX_STREAK_BONUS,
  MIN_CLEAR_SECONDS,
  newRun,
  nextStage,
  SHORT_CAR,
  solveOrder,
  stageSpec,
  STREAK_STEP,
  tapCell,
  TIME_BANK_SECONDS,
  type Car,
  type Facing,
  type Lot,
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

const car = (id: number, col: number, row: number, length: number, facing: Facing): Car => ({
  id,
  col,
  row,
  length,
  facing,
});

const lotOf = (cols: number, rows: number, cars: Car[]): Lot => ({ cols, rows, cars });

/** 손으로 만든 주차장으로 시작하는 진행 상태 */
const runWith = (lot: Lot, extra: Partial<RunState> = {}): RunState => ({
  stage: 1,
  lot,
  timeLeft: TIME_BANK_SECONDS,
  score: 0,
  streak: 0,
  carsOut: 0,
  lotsCleared: 0,
  bumps: 0,
  ...extra,
});

/** 주어진 순서(차 id)대로 빼낼 수 있는지 한 대씩 확인한다. */
function clearsInOrder(lot: Lot, order: readonly number[]): boolean {
  let rest = lot;
  for (const id of order) {
    const target = rest.cars.find((other) => other.id === id);
    if (!target || !canLeave(rest, target)) return false;
    rest = { ...rest, cars: rest.cars.filter((other) => other !== target) };
  }
  return rest.cars.length === 0;
}

/**
 * 작은 본보기 주차장(5×4).
 *   . A A . .      A: 왼쪽을 본다 (나갈 수 있다)
 *   B . . . C      B: 위를 본다 (나갈 수 있다), C: 아래를 본다 (나갈 수 있다)
 *   B D D D C      D: 오른쪽을 본다 (C에 막혔다)
 *   . . E E .      E: 왼쪽을 본다 (나갈 수 있다)
 */
const A = car(0, 1, 0, SHORT_CAR, 'left');
const B = car(1, 0, 1, SHORT_CAR, 'up');
const C = car(2, 4, 1, SHORT_CAR, 'down');
const D = car(3, 1, 2, LONG_CAR, 'right');
const E = car(4, 2, 3, SHORT_CAR, 'left');
const SAMPLE = lotOf(5, 4, [A, B, C, D, E]);

describe('주차장', () => {
  it('차는 보는 방향을 따라 가로나 세로로 칸을 차지한다', () => {
    expect(cellsOf(D)).toEqual([
      { col: 1, row: 2 },
      { col: 2, row: 2 },
      { col: 3, row: 2 },
    ]);
    expect(cellsOf(C)).toEqual([
      { col: 4, row: 1 },
      { col: 4, row: 2 },
    ]);
  });

  it('앞길은 앞머리 바로 앞 칸부터 주차장 끝까지, 가까운 칸부터다', () => {
    const size = { cols: 6, rows: 6 };
    expect(exitPath(size, car(0, 2, 3, SHORT_CAR, 'up'))).toEqual([
      { col: 2, row: 2 },
      { col: 2, row: 1 },
      { col: 2, row: 0 },
    ]);
    // 아래를 보는 차는 맨 아래 칸이 앞머리다.
    expect(exitPath(size, car(0, 2, 2, SHORT_CAR, 'down'))).toEqual([
      { col: 2, row: 4 },
      { col: 2, row: 5 },
    ]);
    expect(exitPath(size, car(0, 2, 3, LONG_CAR, 'left'))).toEqual([
      { col: 1, row: 3 },
      { col: 0, row: 3 },
    ]);
    expect(exitPath(size, car(0, 1, 3, LONG_CAR, 'right'))).toEqual([
      { col: 4, row: 3 },
      { col: 5, row: 3 },
    ]);
    // 끝에 붙어서 밖을 보는 차는 지날 칸이 없다.
    expect(exitPath(size, car(0, 4, 0, SHORT_CAR, 'right'))).toEqual([]);
  });

  it('칸을 짚으면 거기 선 차를 알려 주고, 빈칸이나 주차장 밖은 null이다', () => {
    expect(carAt(SAMPLE, 1, 0)).toBe(A);
    expect(carAt(SAMPLE, 2, 0)).toBe(A);
    expect(carAt(SAMPLE, 3, 2)).toBe(D);
    expect(carAt(SAMPLE, 4, 2)).toBe(C);
    expect(carAt(SAMPLE, 0, 0)).toBeNull();
    expect(carAt(SAMPLE, 3, 0)).toBeNull();
    expect(carAt(SAMPLE, -1, 2)).toBeNull();
    expect(carAt(SAMPLE, 2, 9)).toBeNull();
  });

  it('앞머리에서 주차장 끝까지 비어 있는 차만 나갈 수 있다', () => {
    expect(SAMPLE.cars.filter((each) => canLeave(SAMPLE, each))).toEqual([A, B, C, E]);
    expect(blockageOf(SAMPLE, D)).toEqual({ blocker: C, gap: 0 });
    expect(blockageOf(SAMPLE, A)).toBeNull();
  });

  it('뒤나 옆에 있는 차는 길을 막지 않는다', () => {
    // E의 뒤(오른쪽)와 위에 차가 있어도 앞(왼쪽)만 비어 있으면 된다.
    const crowded = lotOf(5, 4, [E, car(9, 4, 2, SHORT_CAR, 'down'), D]);
    expect(canLeave(crowded, E)).toBe(true);
  });

  it('길을 막은 차가 여럿이면 가장 가까운 차와 그 사이의 빈칸 수를 알려 준다', () => {
    const near = car(1, 3, 0, SHORT_CAR, 'down');
    const far = car(2, 5, 0, SHORT_CAR, 'down');
    const lot = lotOf(6, 3, [car(0, 0, 1, SHORT_CAR, 'right'), near, far]);
    expect(blockageOf(lot, lot.cars[0])).toEqual({ blocker: near, gap: 1 });
  });

  it('막힌 차의 비율을 센다', () => {
    expect(blockedShare(SAMPLE)).toBeCloseTo(1 / 5);
    expect(blockedShare(lotOf(5, 4, [A, B]))).toBe(0);
    expect(blockedShare(lotOf(5, 4, []))).toBe(0);
  });
});

describe('풀이', () => {
  it('나갈 수 있는 차부터 빼내는 순서를 돌려준다', () => {
    const order = solveOrder(SAMPLE);
    expect(order).not.toBeNull();
    expect([...(order ?? [])].sort()).toEqual([0, 1, 2, 3, 4]);
    expect(clearsInOrder(SAMPLE, order ?? [])).toBe(true);
    // D는 C가 나간 뒤에야 나갈 수 있다.
    expect(order?.indexOf(D.id)).toBeGreaterThan(order?.indexOf(C.id) ?? -1);
  });

  it('빈 주차장은 풀 것이 없다', () => {
    expect(solveOrder(lotOf(5, 5, []))).toEqual([]);
  });

  it('마주 보는 두 대는 서로 막아서 비울 수 없다', () => {
    const lot = lotOf(6, 1, [car(0, 0, 0, SHORT_CAR, 'right'), car(1, 4, 0, SHORT_CAR, 'left')]);
    expect(solveOrder(lot)).toBeNull();
  });

  it('네 대가 돌아가며 서로 막고 있어도 비울 수 없다', () => {
    // 저마다 앞차의 옆구리에 막혀 있다: 0 → 1 → 2 → 3 → 0
    const lot = lotOf(4, 4, [
      car(0, 0, 0, LONG_CAR, 'right'),
      car(1, 3, 0, LONG_CAR, 'down'),
      car(2, 1, 3, LONG_CAR, 'left'),
      car(3, 0, 1, LONG_CAR, 'up'),
    ]);
    expect(lot.cars.every((each) => !canLeave(lot, each))).toBe(true);
    expect(solveOrder(lot)).toBeNull();
    // 한 대만 방향을 바꿔도 풀린다.
    const fixed = lotOf(4, 4, [car(0, 0, 0, LONG_CAR, 'left'), ...lot.cars.slice(1)]);
    expect(clearsInOrder(fixed, solveOrder(fixed) ?? [])).toBe(true);
  });
});

const STAGES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 12];
const SEEDS = Array.from({ length: 120 }, (_, index) => index + 1);
/** 판과 시드를 바꿔 가며 만든 주차장들. 아래 검사들이 같이 쓴다. */
const GENERATED = STAGES.flatMap((stage) =>
  SEEDS.map((seed) => ({ stage, lot: generateLot(stage, seeded(seed * 1009 + stage)) })),
);

describe('판', () => {
  it('첫 판은 5×5에 6대이고, 뒤로 갈수록 주차장과 차 수와 막힌 비율이 줄지 않는다', () => {
    expect(stageSpec(1)).toMatchObject({ cols: 5, rows: 5, cars: 6 });
    for (let stage = 2; stage <= 12; stage += 1) {
      const before = stageSpec(stage - 1);
      const now = stageSpec(stage);
      expect(now.cols).toBeGreaterThanOrEqual(before.cols);
      expect(now.rows).toBeGreaterThanOrEqual(before.rows);
      expect(now.cars).toBeGreaterThanOrEqual(before.cars);
      expect(now.minBlockedShare).toBeGreaterThanOrEqual(before.minBlockedShare);
    }
    expect(stageSpec(7).cars).toBeGreaterThan(stageSpec(1).cars * 2);
  });

  it('처음부터 차의 40% 이상이 막혀 있어야 한다', () => {
    for (let stage = 1; stage <= 12; stage += 1) {
      expect(stageSpec(stage).minBlockedShare).toBeGreaterThanOrEqual(0.4);
      expect(stageSpec(stage).minBlockedShare + BLOCKED_SHARE_SPREAD).toBeLessThan(1);
    }
  });

  it('마지막 단계 뒤로는 같은 주차장이 이어지고, 잘못된 번호는 첫 판으로 본다', () => {
    expect(stageSpec(50)).toEqual(stageSpec(7));
    expect(stageSpec(50)).toMatchObject({ cols: MAX_COLS, rows: MAX_ROWS });
    expect(stageSpec(0)).toEqual(stageSpec(1));
    expect(stageSpec(-3)).toEqual(stageSpec(1));
    expect(stageSpec(2.9)).toEqual(stageSpec(2));
  });
});

describe('화면 배치', () => {
  // 가장 작은 화면에서 HUD(56px) 아래에 남는 놀이 영역
  const smallest = { x: 0, y: 56, width: GAME_WIDTH, height: MIN_GAME_HEIGHT - 56 };
  /** 손가락으로 누르기에 모자라지 않은 칸 크기 */
  const TAPPABLE_CELL = 24;

  it.each(STAGES)('%i번째 판의 주차장이 가장 작은 화면에 여백을 두고 들어간다', (stage) => {
    const size = stageSpec(stage);
    const { cell, left, top } = lotLayout(size, smallest);
    expect(Number.isInteger(cell)).toBe(true);
    expect(Number.isInteger(left)).toBe(true);
    expect(Number.isInteger(top)).toBe(true);
    expect(cell).toBeGreaterThanOrEqual(TAPPABLE_CELL);
    expect(cell).toBeLessThanOrEqual(MAX_CELL);
    expect(left).toBeGreaterThanOrEqual(smallest.x + LOT_MARGIN.x);
    expect(left + size.cols * cell).toBeLessThanOrEqual(smallest.x + smallest.width - LOT_MARGIN.x);
    expect(top).toBeGreaterThanOrEqual(smallest.y + LOT_MARGIN.y);
    expect(top + size.rows * cell).toBeLessThanOrEqual(smallest.y + smallest.height - LOT_MARGIN.y);
  });

  it('주차장은 영역의 한가운데에 놓인다', () => {
    const size = stageSpec(3);
    const { cell, left, top } = lotLayout(size, smallest);
    expect(left + (size.cols * cell) / 2).toBeCloseTo(smallest.x + smallest.width / 2, 0);
    expect(top + (size.rows * cell) / 2).toBeCloseTo(smallest.y + smallest.height / 2, 0);
  });

  it('화면이 길어져도 칸은 정해진 크기보다 커지지 않는다', () => {
    const tall = { x: 0, y: 56, width: GAME_WIDTH, height: 504 };
    expect(lotLayout(stageSpec(1), tall).cell).toBe(MAX_CELL);
    expect(lotLayout(stageSpec(7), tall).cell).toBe(lotLayout(stageSpec(7), smallest).cell);
  });
});

describe('주차장 만들기', () => {
  it('차 수가 그 판에 맞고, 차는 두 칸이나 세 칸이며 번호가 겹치지 않는다', () => {
    for (const { stage, lot } of GENERATED) {
      const spec = stageSpec(stage);
      expect(lot).toMatchObject({ cols: spec.cols, rows: spec.rows });
      expect(lot.cars).toHaveLength(spec.cars);
      expect(new Set(lot.cars.map((each) => each.id)).size).toBe(spec.cars);
      expect(lot.cars.every((each) => each.length === SHORT_CAR || each.length === LONG_CAR)).toBe(true);
    }
  });

  it('차는 주차장 밖으로 나가지 않고 서로 겹치지 않는다', () => {
    for (const { lot } of GENERATED) {
      const cells = lot.cars.flatMap(cellsOf);
      const inside = cells.every(
        (cell) => cell.col >= 0 && cell.col < lot.cols && cell.row >= 0 && cell.row < lot.rows,
      );
      expect(inside).toBe(true);
      expect(new Set(cells.map((cell) => cell.row * lot.cols + cell.col)).size).toBe(cells.length);
    }
  });

  it('어느 시드로 만든 주차장이든 끝까지 비울 수 있다', () => {
    for (const { lot } of GENERATED) {
      const order = solveOrder(lot);
      expect(order).not.toBeNull();
      expect(clearsInOrder(lot, order ?? [])).toBe(true);
    }
  });

  it('나갈 수 있는 차를 아무 순서로나 빼내도 막히지 않는다', () => {
    const random = seeded(77);
    for (const { lot } of GENERATED) {
      let rest = lot;
      while (rest.cars.length > 0) {
        const current = rest;
        const free = current.cars.filter((each) => canLeave(current, each));
        expect(free.length).toBeGreaterThan(0);
        const pick = free[Math.floor(random() * free.length)];
        rest = { ...current, cars: current.cars.filter((each) => each !== pick) };
      }
    }
  });

  it('처음에 막힌 차의 비율이 그 판의 범위 안이라서, 뻥 뚫리지도 꽉 묶이지도 않는다', () => {
    for (const { stage, lot } of GENERATED) {
      const { minBlockedShare } = stageSpec(stage);
      const share = blockedShare(lot);
      expect(share).toBeGreaterThanOrEqual(minBlockedShare - 1e-9);
      expect(share).toBeLessThanOrEqual(minBlockedShare + BLOCKED_SHARE_SPREAD + 1e-9);
    }
  });

  it('첫 판은 차의 절반이 바로 나갈 수 있어서 시작하기 쉽다', () => {
    for (const { stage, lot } of GENERATED) {
      if (stage !== 1) continue;
      expect(lot.cars.filter((each) => canLeave(lot, each))).toHaveLength(3);
    }
  });

  it('네 방향과 두 가지 길이가 고루 나온다', () => {
    const cars = GENERATED.flatMap(({ lot }) => lot.cars);
    for (const facing of ['up', 'down', 'left', 'right'] as const) {
      const share = cars.filter((each) => each.facing === facing).length / cars.length;
      expect(share).toBeGreaterThan(0.15);
    }
    const long = cars.filter((each) => each.length === LONG_CAR).length / cars.length;
    expect(long).toBeGreaterThan(0.15);
    expect(long).toBeLessThan(0.45);
  });

  it('번호는 왼쪽 위부터 읽는 순서라서 푸는 순서를 알려 주지 않는다', () => {
    for (const { lot } of GENERATED) {
      expect(lot.cars.map((each) => each.id)).toEqual(lot.cars.map((_, index) => index));
      const places = lot.cars.map((each) => each.row * lot.cols + each.col);
      expect(places).toEqual([...places].sort((a, b) => a - b));
    }
  });

  it('시드가 같으면 같은 주차장, 다르면 다른 주차장이 나온다', () => {
    expect(generateLot(5, seeded(11))).toEqual(generateLot(5, seeded(11)));
    expect(generateLot(5, seeded(11))).not.toEqual(generateLot(5, seeded(12)));
  });

  it('고장 난 난수를 줘도 멈추지 않고, 비울 수 있는 주차장을 돌려준다', () => {
    for (const stuck of [0, 0.5, 0.999999]) {
      for (const stage of [1, 4, 7]) {
        const lot = generateLot(stage, () => stuck);
        expect(lot.cars.length).toBeGreaterThan(0);
        expect(clearsInOrder(lot, solveOrder(lot) ?? [-1])).toBe(true);
      }
    }
  });
});

describe('시간', () => {
  it('판을 깨면 돌려받는 시간은 뒤로 갈수록 줄다가 바닥에서 멈춘다', () => {
    expect(clearSeconds(1)).toBe(FIRST_CLEAR_SECONDS);
    for (let stage = 2; stage <= 30; stage += 1) {
      expect(clearSeconds(stage)).toBeLessThanOrEqual(clearSeconds(stage - 1));
      expect(clearSeconds(stage)).toBeGreaterThanOrEqual(MIN_CLEAR_SECONDS);
    }
    expect(clearSeconds(30)).toBe(MIN_CLEAR_SECONDS);
    expect(clearSeconds(0)).toBe(FIRST_CLEAR_SECONDS);
  });

  it('돌려받는 시간은 몇 초뿐이라 시간이 처음보다 불어나지 않는다', () => {
    expect(FIRST_CLEAR_SECONDS).toBeLessThan(TIME_BANK_SECONDS / 5);
    expect(MIN_CLEAR_SECONDS).toBeGreaterThan(0);
  });

  it('시간이 흐르면 줄어들고 0 아래로는 내려가지 않는다', () => {
    const run = runWith(SAMPLE, { timeLeft: 1 });
    expect(elapse(run, 0.25).timeLeft).toBeCloseTo(0.75);
    expect(isOver(elapse(run, 0.25))).toBe(false);
    expect(elapse(run, 5).timeLeft).toBe(0);
    expect(isOver(elapse(run, 5))).toBe(true);
    expect(elapse(run, -3).timeLeft).toBe(1);
    // 원본은 그대로다.
    expect(run.timeLeft).toBe(1);
  });
});

describe('점수', () => {
  it('부딪히지 않고 이어서 빼낼수록 차 한 대의 점수가 조금씩 오르다가 멈춘다', () => {
    expect(carPoints(1)).toBe(CAR_POINTS);
    expect(carPoints(STREAK_STEP - 1)).toBe(CAR_POINTS);
    expect(carPoints(STREAK_STEP)).toBe(CAR_POINTS + 1);
    expect(carPoints(STREAK_STEP * 2)).toBe(CAR_POINTS + 2);
    expect(carPoints(500)).toBe(CAR_POINTS + MAX_STREAK_BONUS);
    for (let streak = 1; streak <= 40; streak += 1) {
      expect(carPoints(streak)).toBeGreaterThanOrEqual(carPoints(streak - 1));
    }
    expect(carPoints(-2)).toBe(CAR_POINTS);
  });

  it('뒤의 판을 깰수록 보너스가 크다', () => {
    for (let stage = 2; stage <= 20; stage += 1) {
      expect(clearPoints(stage)).toBeGreaterThan(clearPoints(stage - 1));
    }
    expect(clearPoints(1)).toBeGreaterThan(0);
    expect(clearPoints(0)).toBe(clearPoints(1));
  });
});

describe('진행', () => {
  it('새 판은 첫 주차장과 가득 찬 시간으로 시작한다', () => {
    const run = newRun(seeded(5));
    expect(run).toMatchObject({
      stage: 1,
      timeLeft: TIME_BANK_SECONDS,
      score: 0,
      streak: 0,
      carsOut: 0,
      lotsCleared: 0,
      bumps: 0,
    });
    expect(run.lot.cars).toHaveLength(stageSpec(1).cars);
  });

  it('나갈 수 있는 차를 누르면 그 차가 빠지고 점수가 오른다', () => {
    const before = runWith(SAMPLE);
    // 차의 어느 칸을 눌러도 된다.
    const { run, outcome } = tapCell(before, 2, 0);
    expect(outcome).toEqual({ kind: 'exit', car: A, points: CAR_POINTS, cleared: null });
    expect(run.lot.cars).toEqual([B, C, D, E]);
    expect(run).toMatchObject({ score: CAR_POINTS, streak: 1, carsOut: 1, bumps: 0 });
    expect(run.timeLeft).toBe(TIME_BANK_SECONDS);
    // 원본은 그대로다.
    expect(before.lot.cars).toHaveLength(5);
    expect(before.score).toBe(0);
  });

  it('막힌 차를 누르면 차는 그대로이고 시간이 깎이며 연속이 끊긴다', () => {
    const before = runWith(SAMPLE, { streak: 7, score: 30 });
    const { run, outcome } = tapCell(before, 2, 2);
    expect(outcome).toEqual({
      kind: 'blocked',
      car: D,
      blocker: C,
      gap: 0,
      seconds: BUMP_PENALTY_SECONDS,
    });
    expect(run.lot).toBe(before.lot);
    expect(run).toMatchObject({ streak: 0, score: 30, bumps: 1, carsOut: 0 });
    expect(run.timeLeft).toBe(TIME_BANK_SECONDS - BUMP_PENALTY_SECONDS);
  });

  it('빈칸이나 주차장 밖을 누르면 아무 일도 없다', () => {
    const before = runWith(SAMPLE, { streak: 3 });
    for (const [col, row] of [
      [0, 0],
      [3, 1],
      [-1, 0],
      [5, 2],
      [2, 4],
    ]) {
      const { run, outcome } = tapCell(before, col, row);
      expect(outcome).toEqual({ kind: 'none' });
      expect(run).toBe(before);
    }
  });

  it('길을 막던 차가 나가면 막혔던 차도 나갈 수 있다', () => {
    const afterC = tapCell(runWith(SAMPLE), 4, 1).run;
    const { run, outcome } = tapCell(afterC, 1, 2);
    expect(outcome).toMatchObject({ kind: 'exit', car: D });
    expect(run.carsOut).toBe(2);
  });

  it('마지막 차를 빼내면 판을 깬 보너스와 시간을 받는다', () => {
    const last = runWith(lotOf(5, 4, [A]), { stage: 3, timeLeft: 20, score: 100, streak: 2 });
    const { run, outcome } = tapCell(last, 1, 0);
    expect(outcome).toEqual({
      kind: 'exit',
      car: A,
      points: CAR_POINTS,
      cleared: { points: clearPoints(3), seconds: clearSeconds(3) },
    });
    expect(run.lot.cars).toEqual([]);
    expect(run).toMatchObject({ stage: 3, lotsCleared: 1, carsOut: 1, streak: 3 });
    expect(run.score).toBe(100 + CAR_POINTS + clearPoints(3));
    expect(run.timeLeft).toBe(20 + clearSeconds(3));
  });

  it('돌려받아도 시간은 처음보다 많아지지 않는다', () => {
    const nearlyFull = runWith(lotOf(5, 4, [A]), { timeLeft: TIME_BANK_SECONDS - 1.5 });
    const { run, outcome } = tapCell(nearlyFull, 1, 0);
    expect(run.timeLeft).toBe(TIME_BANK_SECONDS);
    expect(outcome).toMatchObject({ cleared: { seconds: 1.5 } });
  });

  it('벌로 시간이 0 아래로 내려가지는 않고, 시간이 다 되면 눌러도 아무 일도 없다', () => {
    const { run, outcome } = tapCell(runWith(SAMPLE, { timeLeft: 1.2 }), 2, 2);
    expect(run.timeLeft).toBe(0);
    expect(outcome).toMatchObject({ kind: 'blocked', seconds: 1.2 });
    expect(isOver(run)).toBe(true);
    expect(tapCell(run, 1, 0)).toEqual({ run, outcome: { kind: 'none' } });
  });

  it('연속은 판이 바뀌어도 이어지고, 부딪히면 처음부터 다시 센다', () => {
    let run = runWith(SAMPLE, { streak: STREAK_STEP - 1 });
    let result = tapCell(run, 1, 0);
    expect(result.outcome).toMatchObject({ kind: 'exit', points: CAR_POINTS + 1 });
    run = tapCell(result.run, 2, 2).run;
    expect(run.streak).toBe(0);
    result = tapCell(run, 0, 1);
    expect(result.outcome).toMatchObject({ kind: 'exit', points: CAR_POINTS });

    const cleared = tapCell(runWith(lotOf(5, 4, [A]), { streak: 9 }), 1, 0).run;
    expect(nextStage(cleared, seeded(3)).streak).toBe(10);
  });

  it('다음 판으로 넘어가면 판 번호가 오르고 새 주차장이 깔리며 나머지는 그대로다', () => {
    const cleared = tapCell(runWith(lotOf(5, 4, [A]), { stage: 4, timeLeft: 33, bumps: 2 }), 1, 0).run;
    const next = nextStage(cleared, seeded(9));
    expect(next.stage).toBe(5);
    expect(next.lot.cars).toHaveLength(stageSpec(5).cars);
    expect(next).toMatchObject({
      timeLeft: cleared.timeLeft,
      score: cleared.score,
      carsOut: 1,
      lotsCleared: 1,
      bumps: 2,
    });
  });

  it('여러 판을 이어서 풀면 점수는 받은 점수를 모두 더한 것이다', () => {
    const random = seeded(2024);
    let run = newRun(random);
    let total = 0;
    while (run.stage <= 4) {
      const lot = run.lot;
      const free = lot.cars.find((each) => canLeave(lot, each));
      expect(free).toBeDefined();
      if (!free) return;
      const result = tapCell(run, free.col, free.row);
      expect(result.outcome.kind).toBe('exit');
      if (result.outcome.kind !== 'exit') return;
      total += result.outcome.points + (result.outcome.cleared?.points ?? 0);
      run = result.outcome.cleared ? nextStage(result.run, random) : result.run;
    }
    const cars = [1, 2, 3, 4].reduce((sum, stage) => sum + stageSpec(stage).cars, 0);
    expect(run).toMatchObject({ carsOut: cars, lotsCleared: 4, bumps: 0, streak: cars });
    expect(run.score).toBe(total);
    expect(run.score).toBeGreaterThan(cars * CAR_POINTS + clearPoints(4));
    expect(run.timeLeft).toBe(TIME_BANK_SECONDS);
  });
});
