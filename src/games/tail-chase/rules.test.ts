import { describe, expect, it } from 'vitest';
import {
  COLS,
  crawlFrom,
  distance,
  FOOD_MIN_POINTS,
  FOOD_POINTS,
  FOOD_STALE_STEPS,
  foodPoints,
  foodSpot,
  freeCells,
  FULL_GARDEN_BONUS,
  isInside,
  isOpposite,
  isOver,
  MAX_QUEUED_TURNS,
  MIN_STEP_MS,
  newGarden,
  nextCell,
  queueTurn,
  ROWS,
  sameCell,
  START_LENGTH,
  START_ROWS_BELOW,
  START_STEP_MS,
  step,
  STEP_MS_PER_GROWTH,
  stepMs,
  TREAT_DISTANCE,
  TREAT_EVERY,
  TREAT_POINTS,
  TREAT_STEPS,
  treatSpot,
  type Cell,
  type Direction,
  type Garden,
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

const DIRECTIONS: readonly Direction[] = ['up', 'down', 'left', 'right'];

const cell = (col: number, row: number): Cell => ({ col, row });

/** 언제나 첫 번째 것을 고르게 하는 난수와 마지막 것을 고르게 하는 난수 */
const pickFirst = (): number => 0;
const pickLast = (): number => 0.999999;

/**
 * 손으로 만든 작은 밭(6×6). 애벌레는 셋째 줄 왼쪽에서 오른쪽을 보고 있다.
 *   . . . . . .
 *   . . . . . .
 *   o o O . . .      O: 머리, o: 몸
 *   . . . . . .
 *   . . . . . .
 *   . . . . . F      F: 먹이
 */
const gardenWith = (extra: Partial<Garden> = {}): Garden => ({
  cols: 6,
  rows: 6,
  body: [cell(2, 2), cell(1, 2), cell(0, 2)],
  heading: 'right',
  turns: [],
  food: { cell: cell(5, 5), age: 0 },
  treat: null,
  foodsToTreat: 99,
  score: 0,
  eaten: 0,
  treats: 0,
  steps: 0,
  status: 'playing',
  ...extra,
});

/** 방향들을 차례로 받아 둔다. */
const queueAll = (garden: Garden, ...turns: Direction[]): Garden =>
  turns.reduce((current, turn) => queueTurn(current, turn), garden);

/** 꺾지 않고 n걸음 나아간다. */
function walk(garden: Garden, steps: number, random: () => number = pickFirst): Garden {
  let current = garden;
  for (let index = 0; index < steps; index += 1) current = step(current, random).garden;
  return current;
}

const includesCell = (cells: readonly Cell[], target: Cell): boolean =>
  cells.some((other) => sameCell(other, target));

/** 밭의 모든 칸을 뱀처럼 한 줄로 이은 길(왼쪽 위에서 시작해 줄마다 방향을 바꾼다). */
function serpentine(cols: number, rows: number): Cell[] {
  const path: Cell[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let index = 0; index < cols; index += 1) {
      path.push(cell(row % 2 === 0 ? index : cols - 1 - index, row));
    }
  }
  return path;
}

/**
 * 밭의 모든 칸을 한 번씩 지나 제자리로 돌아오는 길에서, 칸마다 가야 할 방향(줄 수가 짝수여야 한다).
 * 맨 위 줄을 오른쪽으로 가고, 그 아래로는 왼쪽 줄을 남겨 둔 채 지그재그로 내려갔다가, 왼쪽 줄로 올라온다.
 * 이 길만 따라가면 몸이 아무리 길어도 부딪히지 않는다.
 */
function loopDirection(at: Cell, cols: number, rows: number): Direction {
  if (at.col === 0) return at.row === 0 ? 'right' : 'up';
  if (at.row === 0) return at.col === cols - 1 ? 'down' : 'right';
  if (at.row % 2 === 1) return at.col === 1 && at.row < rows - 1 ? 'down' : 'left';
  return at.col === cols - 1 ? 'down' : 'right';
}

describe('칸', () => {
  it('한 칸 옆은 방향에 따라 줄이나 칸 번호가 하나 바뀐다', () => {
    expect(nextCell(cell(3, 3), 'up')).toEqual(cell(3, 2));
    expect(nextCell(cell(3, 3), 'down')).toEqual(cell(3, 4));
    expect(nextCell(cell(3, 3), 'left')).toEqual(cell(2, 3));
    expect(nextCell(cell(3, 3), 'right')).toEqual(cell(4, 3));
  });

  it('밭 안쪽인지는 네 변 모두에서 가린다', () => {
    const size = { cols: 4, rows: 3 };
    expect(isInside(size, cell(0, 0))).toBe(true);
    expect(isInside(size, cell(3, 2))).toBe(true);
    expect(isInside(size, cell(-1, 0))).toBe(false);
    expect(isInside(size, cell(4, 0))).toBe(false);
    expect(isInside(size, cell(0, -1))).toBe(false);
    expect(isInside(size, cell(0, 3))).toBe(false);
  });

  it('정반대 방향은 위와 아래, 왼쪽과 오른쪽뿐이다', () => {
    for (const a of DIRECTIONS) {
      const opposites = DIRECTIONS.filter((b) => isOpposite(a, b));
      expect(opposites).toHaveLength(1);
      expect(isOpposite(opposites[0], a)).toBe(true);
      expect(isOpposite(a, a)).toBe(false);
    }
    expect(isOpposite('up', 'down')).toBe(true);
    expect(isOpposite('left', 'right')).toBe(true);
    expect(isOpposite('up', 'left')).toBe(false);
  });

  it('거리는 가로세로로만 가는 걸음 수다', () => {
    expect(distance(cell(1, 1), cell(1, 1))).toBe(0);
    expect(distance(cell(0, 0), cell(3, 4))).toBe(7);
    expect(distance(cell(3, 4), cell(0, 0))).toBe(7);
  });

  it('빈칸은 차지한 칸을 뺀 나머지 전부다', () => {
    const size = { cols: 3, rows: 2 };
    expect(freeCells(size, [])).toHaveLength(6);
    expect(freeCells(size, [cell(0, 0), cell(2, 1)])).toEqual([
      cell(1, 0),
      cell(2, 0),
      cell(0, 1),
      cell(1, 1),
    ]);
    expect(freeCells(size, serpentine(3, 2))).toEqual([]);
  });
});

describe('빠르기', () => {
  it('처음 빠르기에서 시작해 길어질수록 빨라지고 가장 빠른 데서 멈춘다', () => {
    expect(stepMs(START_LENGTH)).toBe(START_STEP_MS);
    expect(stepMs(START_LENGTH + 1)).toBe(START_STEP_MS - STEP_MS_PER_GROWTH);
    expect(stepMs(COLS * ROWS)).toBe(MIN_STEP_MS);
    expect(stepMs(0)).toBe(START_STEP_MS);
  });

  it('길이가 늘어서 느려지는 일은 없다', () => {
    for (let length = START_LENGTH; length < COLS * ROWS; length += 1) {
      expect(stepMs(length + 1)).toBeLessThanOrEqual(stepMs(length));
    }
  });

  it('조금씩 빨라져서, 먹이를 서른 개 먹어도 아직 가장 빠르지 않다', () => {
    expect(STEP_MS_PER_GROWTH).toBeLessThanOrEqual(4);
    expect(stepMs(START_LENGTH + 30)).toBeGreaterThan(MIN_STEP_MS);
  });

  it('가장 빠를 때도 한 걸음에 0.1초는 걸려서 밀어서 따라갈 수 있다', () => {
    expect(MIN_STEP_MS).toBeGreaterThanOrEqual(100);
    expect(START_STEP_MS).toBeGreaterThan(MIN_STEP_MS);
  });
});

describe('점수', () => {
  it('갓 나온 먹이가 가장 값지고, 오래 둘수록 1점씩 줄어든다', () => {
    expect(foodPoints(0)).toBe(FOOD_POINTS);
    expect(foodPoints(FOOD_STALE_STEPS - 1)).toBe(FOOD_POINTS);
    expect(foodPoints(FOOD_STALE_STEPS)).toBe(FOOD_POINTS - 1);
    expect(foodPoints(FOOD_STALE_STEPS * 2)).toBe(FOOD_POINTS - 2);
  });

  it('아무리 오래 두어도 정해진 점수 아래로는 내려가지 않는다', () => {
    expect(foodPoints(100000)).toBe(FOOD_MIN_POINTS);
    expect(FOOD_MIN_POINTS).toBeGreaterThan(0);
    for (let age = 0; age < 200; age += 1) {
      expect(foodPoints(age + 1)).toBeLessThanOrEqual(foodPoints(age));
      expect(Number.isInteger(foodPoints(age))).toBe(true);
    }
  });

  it('별사탕은 갓 나온 먹이보다 값지다', () => {
    expect(TREAT_POINTS).toBeGreaterThan(FOOD_POINTS * 2);
  });

  it('별사탕은 가장 먼 자리에 놓여도 곧장 가면 닿을 만큼 오래 놓여 있다', () => {
    expect(TREAT_STEPS).toBeGreaterThan(TREAT_DISTANCE.max);
    expect(TREAT_DISTANCE.min).toBeGreaterThan(1);
    expect(TREAT_DISTANCE.max).toBeGreaterThan(TREAT_DISTANCE.min);
  });
});

describe('새 판', () => {
  it('애벌레는 아래쪽 가운데에서 위를 보고 서 있다', () => {
    const garden = newGarden(seeded(1));
    expect(garden.cols).toBe(COLS);
    expect(garden.rows).toBe(ROWS);
    expect(garden.body).toHaveLength(START_LENGTH);
    expect(garden.heading).toBe('up');
    expect(garden.status).toBe('playing');
    expect([garden.score, garden.eaten, garden.treats, garden.steps]).toEqual([0, 0, 0, 0]);
    expect(garden.turns).toEqual([]);
    expect(garden.treat).toBeNull();

    const [head, ...rest] = garden.body;
    rest.forEach((part, index) => expect(part).toEqual(cell(head.col, head.row + index + 1)));
    const tail = garden.body[garden.body.length - 1];
    expect(ROWS - 1 - tail.row).toBe(START_ROWS_BELOW);
  });

  it('가만히 두어도 벽에 닿기까지 여러 걸음이 남는다', () => {
    const garden = newGarden(seeded(2));
    // 머리 앞에 열 칸은 비어 있어야 화면을 읽을 틈이 있다.
    expect(garden.body[0].row).toBeGreaterThanOrEqual(10);
    const walked = walk({ ...garden, food: { cell: cell(0, ROWS - 1), age: 0 } }, garden.body[0].row);
    expect(walked.status).toBe('playing');
    expect(walked.body[0].row).toBe(0);
    expect(step(walked, pickFirst).garden.status).toBe('crashed');
  });

  it('첫 먹이는 어떤 시드에서도 몸이 없는 칸에 놓인다', () => {
    const spots = new Set<string>();
    for (let seed = 0; seed < 500; seed += 1) {
      const garden = newGarden(seeded(seed));
      expect(garden.food).not.toBeNull();
      const spot = garden.food?.cell ?? cell(-1, -1);
      expect(isInside(garden, spot)).toBe(true);
      expect(includesCell(garden.body, spot)).toBe(false);
      expect(garden.food?.age).toBe(0);
      expect(garden.foodsToTreat).toBeGreaterThanOrEqual(TREAT_EVERY.min);
      expect(garden.foodsToTreat).toBeLessThanOrEqual(TREAT_EVERY.max);
      spots.add(`${spot.col},${spot.row}`);
    }
    // 늘 같은 자리가 아니라 밭 곳곳에 놓인다.
    expect(spots.size).toBeGreaterThan(100);
  });
});

describe('방향 바꾸기', () => {
  it('옆으로 꺾는 것은 받아 두었다가 다음 걸음에 쓴다', () => {
    const queued = queueTurn(gardenWith(), 'up');
    expect(queued.turns).toEqual(['up']);
    expect(queued.heading).toBe('right');

    const { garden } = step(queued, pickFirst);
    expect(garden.heading).toBe('up');
    expect(garden.turns).toEqual([]);
    expect(garden.body[0]).toEqual(cell(2, 1));
  });

  it('가던 쪽으로 또 미는 것은 무시한다', () => {
    const garden = gardenWith();
    expect(queueTurn(garden, 'right')).toBe(garden);
  });

  it('목덜미 쪽으로 곧장 되돌아가는 것은 무시한다', () => {
    const garden = gardenWith();
    expect(queueTurn(garden, 'left')).toBe(garden);
    expect(step(queueTurn(garden, 'left'), pickFirst).garden.body[0]).toEqual(cell(3, 2));
  });

  it('빠르게 이어 민 두 번은 둘 다 받아서 한 걸음에 하나씩 쓴다', () => {
    const queued = queueAll(gardenWith(), 'up', 'left');
    expect(queued.turns).toEqual(['up', 'left']);

    const first = step(queued, pickFirst).garden;
    expect(first.heading).toBe('up');
    expect(first.turns).toEqual(['left']);
    expect(first.body[0]).toEqual(cell(2, 1));

    const second = step(first, pickFirst).garden;
    expect(second.heading).toBe('left');
    expect(second.turns).toEqual([]);
    expect(second.body[0]).toEqual(cell(1, 1));
  });

  it('받아 둔 것이 있으면 그 마지막 방향을 기준으로 같은 쪽과 정반대 쪽을 가린다', () => {
    const queued = queueTurn(gardenWith(), 'up');
    // 위로 꺾기로 했으니 또 위나, 그 반대인 아래는 무시한다.
    expect(queueTurn(queued, 'up')).toBe(queued);
    expect(queueTurn(queued, 'down')).toBe(queued);
    // 지금 가는 쪽(오른쪽)의 반대인 왼쪽은, 위로 꺾은 다음이라면 되돌아가는 것이 아니다.
    expect(queueTurn(queued, 'left').turns).toEqual(['up', 'left']);
    expect(queueTurn(queued, 'right').turns).toEqual(['up', 'right']);
  });

  it('정해진 수보다 많이는 받아 두지 않는다', () => {
    const full = queueAll(gardenWith(), 'up', 'left');
    expect(full.turns).toHaveLength(MAX_QUEUED_TURNS);
    expect(queueTurn(full, 'down')).toBe(full);
    expect(queueTurn(full, 'up')).toBe(full);
  });

  it('받아 둔 방향 전환만으로는 제 몸 쪽으로 되돌아가지 못한다', () => {
    // 아무렇게나 밀어도, 걸음마다 머리는 바로 전의 목덜미 칸으로 들어가지 않는다.
    const random = seeded(7);
    let garden = gardenWith({ cols: 30, rows: 30, body: [cell(15, 15), cell(14, 15), cell(13, 15)] });
    for (let index = 0; index < 400 && !isOver(garden); index += 1) {
      const presses = Math.floor(random() * 4);
      for (let press = 0; press < presses; press += 1) {
        garden = queueTurn(garden, DIRECTIONS[Math.floor(random() * 4)]);
      }
      const neck = garden.body[1];
      const result = step(garden, random);
      if (result.event.kind === 'crash') break;
      garden = result.garden;
      expect(sameCell(garden.body[0], neck)).toBe(false);
    }
  });

  it('끝난 판에서는 받지 않는다', () => {
    const crashed = gardenWith({ status: 'crashed' });
    expect(queueTurn(crashed, 'up')).toBe(crashed);
  });
});

describe('한 걸음', () => {
  it('빈칸으로 나아가면 모든 마디가 앞 마디의 자리로 따라간다', () => {
    const before = gardenWith();
    const { garden, event, treatAppeared, treatExpired } = step(before, pickFirst);
    expect(event).toEqual({ kind: 'move' });
    expect(garden.body).toEqual([cell(3, 2), cell(2, 2), cell(1, 2)]);
    expect(garden.steps).toBe(1);
    expect(garden.score).toBe(0);
    expect(garden.status).toBe('playing');
    expect(treatAppeared).toBe(false);
    expect(treatExpired).toBe(false);
    // 받은 상태는 바뀌지 않는다.
    expect(before.body).toEqual([cell(2, 2), cell(1, 2), cell(0, 2)]);
    expect(before.steps).toBe(0);
  });

  it('네 벽 어디에든 부딪히면 그 자리에 멈추고 끝난다', () => {
    const cases: ReadonlyArray<readonly [Direction, Cell[]]> = [
      ['right', [cell(5, 2), cell(4, 2), cell(3, 2)]],
      ['left', [cell(0, 2), cell(1, 2), cell(2, 2)]],
      ['up', [cell(2, 0), cell(2, 1), cell(2, 2)]],
      ['down', [cell(2, 5), cell(2, 4), cell(2, 3)]],
    ];
    for (const [heading, body] of cases) {
      const before = gardenWith({ heading, body, food: { cell: cell(4, 4), age: 0 } });
      const { garden, event } = step(before, pickFirst);
      expect(event).toEqual({ kind: 'crash', cause: 'wall' });
      expect(garden.status).toBe('crashed');
      expect(garden.body).toEqual(body);
      expect(garden.steps).toBe(0);
      expect(garden.score).toBe(0);
    }
  });

  it('벽 바로 앞에서 꺾으면 부딪히지 않는다', () => {
    const atWall = gardenWith({ body: [cell(5, 2), cell(4, 2), cell(3, 2)] });
    const { garden, event } = step(queueTurn(atWall, 'down'), pickFirst);
    expect(event.kind).toBe('move');
    expect(garden.body[0]).toEqual(cell(5, 3));
  });

  it('제 몸에 부딪히면 끝난다', () => {
    /*
     *   . 2 1 .        머리 O에서 꼬리 끝 5까지 번호 순서로 이어진 몸이다.
     *   . 3 O .        머리가 아래로 내려온 참에 왼쪽으로 꺾으면 3번 마디에 닿는다.
     *   . 4 5 .
     */
    const body = [cell(2, 2), cell(2, 1), cell(1, 1), cell(1, 2), cell(1, 3), cell(2, 3)];
    const coiled = gardenWith({ heading: 'down', body });
    const { garden, event } = step(queueTurn(coiled, 'left'), pickFirst);
    expect(event).toEqual({ kind: 'crash', cause: 'self' });
    expect(garden.status).toBe('crashed');
    expect(garden.heading).toBe('left');
    expect(garden.body).toEqual(body);
  });

  it('꼬리 끝이 막 비켜난 칸으로는 들어갈 수 있다', () => {
    // 네 칸짜리 몸이 2×2로 돌고 있다. 머리가 가려는 칸에 지금은 꼬리 끝이 있다.
    const body = [cell(1, 1), cell(1, 2), cell(2, 2), cell(2, 1)];
    const circling = gardenWith({ heading: 'up', body });
    const { garden, event } = step(queueTurn(circling, 'right'), pickFirst);
    expect(event.kind).toBe('move');
    expect(garden.body).toEqual([cell(2, 1), cell(1, 1), cell(1, 2), cell(2, 2)]);
    // 계속 돌아도 부딪히지 않는다.
    let turning = garden;
    for (const turn of ['down', 'left', 'up', 'right'] as const) {
      turning = step(queueTurn(turning, turn), pickFirst).garden;
      expect(turning.status).toBe('playing');
    }
  });

  it('꼬리 끝 바로 앞 마디에는 부딪힌다', () => {
    const body = [cell(1, 1), cell(1, 2), cell(2, 2), cell(2, 1), cell(3, 1)];
    const { event } = step(queueTurn(gardenWith({ heading: 'up', body }), 'right'), pickFirst);
    expect(event).toEqual({ kind: 'crash', cause: 'self' });
  });

  it('먹이를 먹으면 꼬리는 그대로 두고 머리만 나아가서 한 칸 길어진다', () => {
    const before = gardenWith({ food: { cell: cell(3, 2), age: 0 } });
    const { garden, event } = step(before, seeded(3));
    expect(event).toEqual({ kind: 'food', cell: cell(3, 2), points: FOOD_POINTS });
    expect(garden.body).toEqual([cell(3, 2), cell(2, 2), cell(1, 2), cell(0, 2)]);
    expect(garden.eaten).toBe(1);
    expect(garden.score).toBe(FOOD_POINTS);
    expect(garden.steps).toBe(1);
    expect(garden.foodsToTreat).toBe(98);
  });

  it('먹이를 먹으면 몸이 없는 칸에 갓 나온 새 먹이가 놓인다', () => {
    for (let seed = 0; seed < 300; seed += 1) {
      const before = gardenWith({ food: { cell: cell(3, 2), age: 9 } });
      const { garden } = step(before, seeded(seed));
      expect(garden.food).not.toBeNull();
      const spot = garden.food?.cell ?? cell(-1, -1);
      expect(garden.food?.age).toBe(0);
      expect(isInside(garden, spot)).toBe(true);
      expect(includesCell(garden.body, spot)).toBe(false);
    }
  });

  it('먹이는 먹히지 않고 지나간 걸음마다 나이를 먹고, 그만큼 점수가 줄어든다', () => {
    const aged = walk(gardenWith({ food: { cell: cell(5, 5), age: 0 } }), 2);
    expect(aged.food).toEqual({ cell: cell(5, 5), age: 2 });

    const stale = gardenWith({ food: { cell: cell(3, 2), age: FOOD_STALE_STEPS * 2 } });
    const { garden, event } = step(stale, seeded(4));
    expect(event).toEqual({ kind: 'food', cell: cell(3, 2), points: FOOD_POINTS - 2 });
    expect(garden.score).toBe(FOOD_POINTS - 2);
  });

  it('별사탕을 먹으면 점수만 오르고 몸은 길어지지 않는다', () => {
    const before = gardenWith({ treat: { cell: cell(3, 2), stepsLeft: 5 }, score: 7 });
    const { garden, event, treatExpired } = step(before, pickFirst);
    expect(event).toEqual({ kind: 'treat', cell: cell(3, 2), points: TREAT_POINTS });
    expect(garden.body).toEqual([cell(3, 2), cell(2, 2), cell(1, 2)]);
    expect(garden.score).toBe(7 + TREAT_POINTS);
    expect(garden.treats).toBe(1);
    expect(garden.eaten).toBe(0);
    expect(garden.treat).toBeNull();
    expect(treatExpired).toBe(false);
    // 먹이는 그 걸음에도 나이를 먹는다.
    expect(garden.food).toEqual({ cell: cell(5, 5), age: 1 });
  });

  it('별사탕은 남은 걸음이 다하면 사라진다', () => {
    const before = gardenWith({ treat: { cell: cell(0, 5), stepsLeft: 2 } });
    const first = step(before, pickFirst);
    expect(first.garden.treat).toEqual({ cell: cell(0, 5), stepsLeft: 1 });
    expect(first.treatExpired).toBe(false);

    const second = step(first.garden, pickFirst);
    expect(second.garden.treat).toBeNull();
    expect(second.treatExpired).toBe(true);
    expect(second.garden.treats).toBe(0);
    expect(second.garden.score).toBe(0);
  });

  it('별사탕은 마지막 남은 한 걸음에 닿아도 먹는다', () => {
    const before = gardenWith({ treat: { cell: cell(3, 2), stepsLeft: 1 } });
    const { garden, event, treatExpired } = step(before, pickFirst);
    expect(event.kind).toBe('treat');
    expect(garden.score).toBe(TREAT_POINTS);
    expect(treatExpired).toBe(false);
  });

  it('끝난 판은 더 움직이지 않는다', () => {
    for (const status of ['crashed', 'full'] as const) {
      const over = gardenWith({ status });
      const result = step(over, pickFirst);
      expect(result.garden).toBe(over);
      expect(result.event).toEqual({ kind: 'none' });
      expect(isOver(over)).toBe(true);
    }
    expect(isOver(gardenWith())).toBe(false);
  });
});

describe('별사탕', () => {
  it('먹이를 정해진 만큼 먹은 걸음에 나오고, 다음 차례가 새로 정해진다', () => {
    const notYet = step(gardenWith({ food: { cell: cell(3, 2), age: 0 }, foodsToTreat: 2 }), seeded(5));
    expect(notYet.treatAppeared).toBe(false);
    expect(notYet.garden.treat).toBeNull();
    expect(notYet.garden.foodsToTreat).toBe(1);

    for (let seed = 0; seed < 200; seed += 1) {
      const due = gardenWith({ food: { cell: cell(3, 2), age: 0 }, foodsToTreat: 1 });
      const { garden, treatAppeared } = step(due, seeded(seed));
      expect(treatAppeared).toBe(true);
      expect(garden.treat?.stepsLeft).toBe(TREAT_STEPS);
      expect(garden.foodsToTreat).toBeGreaterThanOrEqual(TREAT_EVERY.min);
      expect(garden.foodsToTreat).toBeLessThanOrEqual(TREAT_EVERY.max);
    }
  });

  it('몸과 먹이를 피해서, 머리에서 알맞게 떨어진 칸에 놓인다', () => {
    for (let seed = 0; seed < 500; seed += 1) {
      const random = seeded(seed);
      const garden = newGarden(random);
      const food = garden.food?.cell ?? cell(0, 0);
      const spot = treatSpot(garden, garden.body, food, random);
      expect(spot).not.toBeNull();
      if (!spot) continue;
      expect(isInside(garden, spot)).toBe(true);
      expect(includesCell(garden.body, spot)).toBe(false);
      expect(sameCell(spot, food)).toBe(false);
      const steps = distance(garden.body[0], spot);
      expect(steps).toBeGreaterThanOrEqual(TREAT_DISTANCE.min);
      expect(steps).toBeLessThanOrEqual(TREAT_DISTANCE.max);
    }
  });

  it('알맞게 떨어진 빈칸이 없으면 남은 빈칸 아무 데나 놓인다', () => {
    // 2×3 밭에서는 어떤 칸도 머리에서 다섯 걸음 넘게 떨어져 있지 않다.
    const size = { cols: 3, rows: 2 };
    const body = [cell(0, 0), cell(1, 0)];
    const spot = treatSpot(size, body, cell(2, 0), pickLast);
    expect(spot).toEqual(cell(2, 1));
  });

  it('빈칸이 하나도 없으면 놓이지 않는다', () => {
    const size = { cols: 3, rows: 2 };
    const path = serpentine(3, 2);
    expect(treatSpot(size, path.slice(0, 5), path[5], pickFirst)).toBeNull();
  });

  it('앞의 별사탕이 아직 남아 있으면 이번 차례는 건너뛴다', () => {
    const before = gardenWith({
      food: { cell: cell(3, 2), age: 0 },
      foodsToTreat: 1,
      treat: { cell: cell(0, 5), stepsLeft: 9 },
    });
    const { garden, treatAppeared, treatExpired } = step(before, seeded(6));
    expect(treatAppeared).toBe(false);
    expect(treatExpired).toBe(false);
    expect(garden.treat).toEqual({ cell: cell(0, 5), stepsLeft: 8 });
    expect(garden.foodsToTreat).toBeGreaterThanOrEqual(TREAT_EVERY.min);
  });

  it('새 먹이는 별사탕이 놓인 칸을 피한다', () => {
    for (let seed = 0; seed < 300; seed += 1) {
      const before = gardenWith({
        food: { cell: cell(3, 2), age: 0 },
        treat: { cell: cell(4, 4), stepsLeft: 9 },
      });
      const { garden } = step(before, seeded(seed));
      expect(garden.food?.cell).not.toEqual(cell(4, 4));
    }
  });
});

describe('가득 차 가는 밭', () => {
  /** 3×2 밭을 뱀처럼 채운 길: (0,0) (1,0) (2,0) (2,1) (1,1) (0,1) */
  const size = { cols: 3, rows: 2 };
  const path = serpentine(3, 2);

  it('빈칸이 하나만 남아도 먹이는 바로 그 칸에 놓인다', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      expect(foodSpot(size, path.slice(0, 5), null, seeded(seed))).toEqual(path[5]);
    }
    expect(foodSpot(size, path, null, pickFirst)).toBeNull();
  });

  it('남은 빈칸이 별사탕 자리뿐이면 별사탕을 치우고 그 자리에 먹이를 놓는다', () => {
    // 몸이 세 칸, 먹이 한 칸, 별사탕 한 칸, 빈칸 한 칸. 먹이를 먹으면 빈칸은 별사탕 자리만 남는다.
    const before = gardenWith({
      ...size,
      body: [path[2], path[1], path[0]],
      heading: 'right',
      turns: ['down'],
      food: { cell: path[3], age: 0 },
      treat: { cell: path[5], stepsLeft: 9 },
    });
    const mid = step(before, pickFirst);
    // 한 칸 길어지고 새 먹이는 하나 남은 빈칸(1,1)에 놓인다.
    expect(mid.garden.food?.cell).toEqual(path[4]);
    expect(mid.garden.treat?.cell).toEqual(path[5]);

    const after = step(queueTurn(mid.garden, 'left'), pickFirst);
    expect(after.event.kind).toBe('food');
    expect(after.garden.body).toHaveLength(5);
    expect(after.garden.status).toBe('playing');
    expect(after.garden.food).toEqual({ cell: path[5], age: 0 });
    expect(after.garden.treat).toBeNull();
    expect(after.treatExpired).toBe(true);
    expect(after.treatAppeared).toBe(false);
  });

  it('마지막 빈칸의 먹이를 먹으면 밭을 가득 채운 것으로 끝나고 보너스를 받는다', () => {
    const before = gardenWith({
      ...size,
      body: [...path.slice(0, 5)].reverse(),
      heading: 'left',
      food: { cell: path[5], age: 0 },
      foodsToTreat: 1,
      score: 40,
      eaten: 2,
    });
    const { garden, event, treatAppeared } = step(before, pickFirst);
    expect(event).toEqual({ kind: 'food', cell: path[5], points: FOOD_POINTS });
    expect(garden.status).toBe('full');
    expect(isOver(garden)).toBe(true);
    expect(garden.body).toHaveLength(6);
    expect(garden.food).toBeNull();
    expect(garden.treat).toBeNull();
    expect(treatAppeared).toBe(false);
    expect(garden.score).toBe(40 + FOOD_POINTS + FULL_GARDEN_BONUS);
    expect(garden.eaten).toBe(3);
    // 더 걸어도 그대로다.
    expect(step(garden, pickFirst).garden).toBe(garden);
  });

  it('부딪히지 않는 길만 따라가면 어떤 시드에서도 밭을 가득 채우고 끝난다', () => {
    const boards: ReadonlyArray<readonly [cols: number, rows: number]> = [
      [4, 4],
      [5, 6],
      [COLS, ROWS],
    ];
    for (const [cols, rows] of boards) {
      for (let seed = 0; seed < (cols === COLS ? 3 : 40); seed += 1) {
        const random = seeded(seed);
        const body = [cell(2, 0), cell(1, 0), cell(0, 0)];
        const first = foodSpot({ cols, rows }, body, null, random) ?? cell(3, 0);
        let garden = gardenWith({
          cols,
          rows,
          body,
          food: { cell: first, age: 0 },
          foodsToTreat: 2,
        });
        // 먹이 하나에 많아야 밭을 한 바퀴 돌면 되므로 걸음 수에는 끝이 있다.
        const limit = cols * rows * cols * rows;
        while (!isOver(garden) && garden.steps < limit) {
          garden = queueTurn(garden, loopDirection(garden.body[0], cols, rows));
          garden = step(garden, random).garden;
        }
        expect(garden.status).toBe('full');
        expect(garden.body).toHaveLength(cols * rows);
        expect(freeCells(garden, garden.body)).toEqual([]);
        expect(garden.eaten).toBe(cols * rows - START_LENGTH);
        expect(garden.food).toBeNull();
        expect(garden.treat).toBeNull();
        expect(garden.score).toBeGreaterThanOrEqual(FULL_GARDEN_BONUS + garden.eaten * FOOD_MIN_POINTS);
      }
    }
  });
});

describe('여러 판을 아무렇게나 해 봐도', () => {
  /** 당장 부딪히지 않는 방향 가운데 하나를 아무거나 고른다. 없으면 가던 대로 간다. */
  function wander(garden: Garden, random: () => number): Direction {
    const open = DIRECTIONS.filter((way) => {
      if (isOpposite(way, garden.heading)) return false;
      const ahead = nextCell(garden.body[0], way);
      return isInside(garden, ahead) && !includesCell(garden.body.slice(0, -1), ahead);
    });
    if (open.length === 0) return garden.heading;
    // 먹이 쪽으로 가까워지는 방향을 조금 더 자주 고른다. 그래야 몸이 길어진다.
    const food = garden.food?.cell ?? garden.body[0];
    const closer = open.filter(
      (way) => distance(nextCell(garden.body[0], way), food) < distance(garden.body[0], food),
    );
    const pool = closer.length > 0 && random() < 0.8 ? closer : open;
    return pool[Math.floor(random() * pool.length)];
  }

  it('규칙이 어긋나는 상태는 나오지 않는다', () => {
    let foods = 0;
    let treatsShown = 0;
    let treatsEaten = 0;
    let treatsLost = 0;
    for (let seed = 0; seed < 150; seed += 1) {
      const random = seeded(seed);
      let garden = newGarden(random);
      while (!isOver(garden) && garden.steps < 3000) {
        garden = queueTurn(garden, wander(garden, random));
        const before = garden;
        const result = step(garden, random);
        garden = result.garden;
        if (result.event.kind === 'crash') break;

        const { body, food, treat } = garden;
        expect(new Set(body.map((part) => `${part.col},${part.row}`)).size).toBe(body.length);
        expect(body.every((part) => isInside(garden, part))).toBe(true);
        expect(distance(body[0], body[1])).toBe(1);
        expect(body.length).toBe(START_LENGTH + garden.eaten);
        expect(garden.steps).toBe(before.steps + 1);
        expect(garden.turns.length).toBeLessThanOrEqual(MAX_QUEUED_TURNS);
        expect(Number.isInteger(garden.score)).toBe(true);
        expect(garden.score).toBeGreaterThanOrEqual(before.score);
        expect(garden.foodsToTreat).toBeGreaterThanOrEqual(1);
        expect(garden.foodsToTreat).toBeLessThanOrEqual(TREAT_EVERY.max);

        expect(food).not.toBeNull();
        if (food) {
          expect(isInside(garden, food.cell)).toBe(true);
          expect(includesCell(body, food.cell)).toBe(false);
        }
        if (treat) {
          expect(isInside(garden, treat.cell)).toBe(true);
          expect(includesCell(body, treat.cell)).toBe(false);
          if (food) expect(sameCell(food.cell, treat.cell)).toBe(false);
          expect(treat.stepsLeft).toBeGreaterThanOrEqual(1);
          expect(treat.stepsLeft).toBeLessThanOrEqual(TREAT_STEPS);
        }

        if (result.event.kind === 'food') foods += 1;
        if (result.event.kind === 'treat') treatsEaten += 1;
        if (result.treatAppeared) treatsShown += 1;
        if (result.treatExpired) treatsLost += 1;
        // 별사탕이 나오는 것은 먹이를 먹은 걸음뿐이다.
        if (result.treatAppeared) expect(result.event.kind).toBe('food');
      }
      // 점수는 먹은 것으로 받을 수 있는 가장 낮은 값과 가장 높은 값 사이에 있다.
      const fromTreats = garden.treats * TREAT_POINTS;
      expect(garden.score).toBeGreaterThanOrEqual(garden.eaten * FOOD_MIN_POINTS + fromTreats);
      expect(garden.score).toBeLessThanOrEqual(garden.eaten * FOOD_POINTS + fromTreats);
    }
    // 아무렇게나 해도 먹이도 별사탕도 여러 번 나오고, 별사탕은 먹히기도 사라지기도 한다.
    expect(foods).toBeGreaterThan(500);
    expect(treatsShown).toBeGreaterThan(50);
    expect(treatsEaten).toBeGreaterThan(0);
    expect(treatsLost).toBeGreaterThan(0);
    expect(treatsEaten + treatsLost).toBeLessThanOrEqual(treatsShown);
  });
});

describe('화면이 따라 그릴 자리', () => {
  it('길어지지 않은 걸음에서는 모든 마디가 바로 전의 제자리에서 출발한다', () => {
    const before = gardenWith();
    const after = step(before, pickFirst).garden;
    expect(crawlFrom(before.body, after.body)).toEqual(before.body);
  });

  it('길어진 걸음에서는 머리만 움직이고 나머지 마디는 제자리다', () => {
    const before = gardenWith({ food: { cell: cell(3, 2), age: 0 } });
    const after = step(before, seeded(8)).garden;
    const from = crawlFrom(before.body, after.body);
    expect(from).toHaveLength(after.body.length);
    // 머리는 전의 머리 자리에서 나오고,
    expect(from[0]).toEqual(before.body[0]);
    // 나머지는 이미 서 있는 자리 그대로다(새 마디가 머리 뒤에서 생겨난다).
    expect(from.slice(1)).toEqual(after.body.slice(1));
  });

  it('출발하는 칸과 가는 칸은 언제나 같거나 바로 옆이다', () => {
    const random = seeded(9);
    let garden = newGarden(random);
    for (let index = 0; index < 60 && !isOver(garden); index += 1) {
      if (index % 5 === 4) garden = queueTurn(garden, index % 2 === 0 ? 'left' : 'up');
      const before = garden.body;
      const result = step(garden, random);
      if (result.event.kind === 'crash') break;
      garden = result.garden;
      crawlFrom(before, garden.body).forEach((from, part) => {
        expect(distance(from, garden.body[part])).toBeLessThanOrEqual(1);
      });
    }
  });
});
