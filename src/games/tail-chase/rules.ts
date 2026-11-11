/**
 * 꼬리 잡기의 규칙. 화면과 분리된 순수 함수라서 숫자만 바꿔 밸런스를 조정할 수 있다.
 * 밭은 칸으로 된 격자다. 칸은 (col, row)로 적고 왼쪽 위가 (0, 0)이다.
 * 애벌레는 한 걸음에 한 칸씩 저절로 기어가고, 플레이어는 방향만 바꾼다.
 * 무작위가 필요한 곳은 random(0 이상 1 미만의 수를 돌려주는 함수)을 받아서 쓴다.
 */

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface Cell {
  col: number;
  row: number;
}

/** 밭의 크기(칸) */
export type Size = Pick<Garden, 'cols' | 'rows'>;

/** 밭의 크기. 한 칸을 18px로 그리면 가장 짧은 화면(높이 400)에도 테두리까지 들어간다. */
export const COLS = 12;
export const ROWS = 16;
/** 처음 몸길이(머리 포함). 꼬리가 있어야 "몸에 부딪힌다"는 것이 처음부터 보인다. */
export const START_LENGTH = 3;
/** 처음에 꼬리 끝 아래로 비워 두는 줄 수. 머리 앞으로는 그만큼 긴 길이 남는다. */
export const START_ROWS_BELOW = 2;
/** 미리 받아 두는 방향 전환의 수. "위, 왼쪽"처럼 빠르게 이어 민 것을 둘 다 살린다. */
export const MAX_QUEUED_TURNS = 2;

/** 한 칸 나아갈 때 칸 번호가 바뀌는 양 */
const DELTA: Readonly<Record<Direction, Cell>> = {
  up: { col: 0, row: -1 },
  down: { col: 0, row: 1 },
  left: { col: -1, row: 0 },
  right: { col: 1, row: 0 },
};

const OPPOSITE: Readonly<Record<Direction, Direction>> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
};

// ───────── 칸 ─────────

export function sameCell(a: Cell, b: Cell): boolean {
  return a.col === b.col && a.row === b.row;
}

/** cell에서 direction 쪽으로 한 칸 옆 */
export function nextCell(cell: Cell, direction: Direction): Cell {
  const delta = DELTA[direction];
  return { col: cell.col + delta.col, row: cell.row + delta.row };
}

export function isInside(size: Size, cell: Cell): boolean {
  return cell.col >= 0 && cell.col < size.cols && cell.row >= 0 && cell.row < size.rows;
}

export function isOpposite(a: Direction, b: Direction): boolean {
  return OPPOSITE[a] === b;
}

/** 두 칸 사이를 가로세로로만 갈 때의 걸음 수 */
export function distance(a: Cell, b: Cell): number {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
}

/** 밭에서 taken에 없는 칸을 왼쪽 위부터 차례로 모은다. */
export function freeCells(size: Size, taken: readonly Cell[]): Cell[] {
  const used = new Set(taken.map((cell) => cell.row * size.cols + cell.col));
  const free: Cell[] = [];
  for (let row = 0; row < size.rows; row += 1) {
    for (let col = 0; col < size.cols; col += 1) {
      if (!used.has(row * size.cols + col)) free.push({ col, row });
    }
  }
  return free;
}

/** 여럿 가운데 하나를 고르게 뽑는다. 고를 것이 없으면 null. */
function pick<T>(items: readonly T[], random: () => number): T | null {
  if (items.length === 0) return null;
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
}

// ───────── 빠르기 ─────────

/** 한 걸음에 걸리는 시간(ms). 처음에는 화면을 읽을 만큼 느긋하고, 가장 빨라도 밀어서 따라갈 수 있다. */
export const START_STEP_MS = 230;
export const MIN_STEP_MS = 110;
/** 몸이 한 칸 길어질 때마다 줄어드는 시간(ms). 조금씩만 빨라져서 먹이 60개째에야 가장 빨라진다. */
export const STEP_MS_PER_GROWTH = 2;

/** 몸길이가 length일 때 한 걸음에 걸리는 시간(ms) */
export function stepMs(length: number): number {
  const grown = Math.max(0, length - START_LENGTH);
  return Math.max(MIN_STEP_MS, START_STEP_MS - STEP_MS_PER_GROWTH * grown);
}

// ───────── 점수 ─────────

/** 갓 나온 먹이의 점수 */
export const FOOD_POINTS = 5;
/** 아무리 오래 두어도 먹이는 이만큼은 준다. 멀리 돌아가도 먹는 보람은 남는다. */
export const FOOD_MIN_POINTS = 2;
/** 먹이는 놓인 뒤 이만큼 걸을 때마다 1점씩 줄어든다. 곧장 가면 대개 한 번쯤만 줄어든다. */
export const FOOD_STALE_STEPS = 6;
/** 별사탕의 점수. 먹이 네 개 값이라 조금 무리해서라도 노릴 만하다. */
export const TREAT_POINTS = 20;
/** 별사탕이 놓여 있는 걸음 수. 시간으로는 처음에 5초 남짓, 가장 빠를 때 3초가 조금 안 된다. */
export const TREAT_STEPS = 24;
/** 별사탕은 먹이를 이만큼 먹을 때마다 한 번 나온다(그 사이에서 무작위). */
export const TREAT_EVERY = { min: 4, max: 6 } as const;
/**
 * 별사탕이 놓이는 자리는 머리에서 이만큼 떨어진 칸이다(걸음 수).
 * 너무 가까우면 공짜가 되고, 너무 멀면 곧장 가도 닿지 못한다.
 */
export const TREAT_DISTANCE = { min: 5, max: 14 } as const;
/** 밭을 몸으로 가득 채웠을 때 더 주는 점수 */
export const FULL_GARDEN_BONUS = 500;

/** 놓인 뒤 age걸음이 지난 먹이의 점수 */
export function foodPoints(age: number): number {
  const lost = Math.floor(Math.max(0, age) / FOOD_STALE_STEPS);
  return Math.max(FOOD_MIN_POINTS, FOOD_POINTS - lost);
}

// ───────── 밭 ─────────

export interface Food {
  cell: Cell;
  /** 놓인 뒤 애벌레가 나아간 걸음 수. 클수록 점수가 줄어든다. */
  age: number;
}

export interface Treat {
  cell: Cell;
  /** 사라지기까지 남은 걸음 수. 이 걸음 안에 머리가 닿아야 먹는다. */
  stepsLeft: number;
}

/** playing: 기어가는 중, crashed: 부딪혀서 끝남, full: 밭을 가득 채워서 끝남(성공) */
export type Status = 'playing' | 'crashed' | 'full';

export interface Garden {
  cols: number;
  rows: number;
  /** 애벌레가 차지한 칸. 머리부터 꼬리 끝까지 차례로. */
  body: readonly Cell[];
  /** 마지막으로 나아간 쪽. 따로 꺾지 않으면 다음 걸음도 이쪽이다. */
  heading: Direction;
  /** 미리 받아 둔 방향 전환. 앞의 것부터 한 걸음에 하나씩 쓴다. */
  turns: readonly Direction[];
  /** 밭이 가득 차서 끝났을 때만 null이다. */
  food: Food | null;
  treat: Treat | null;
  /** 먹이를 이만큼 더 먹으면 별사탕이 나온다 */
  foodsToTreat: number;
  score: number;
  /** 먹은 먹이의 수 */
  eaten: number;
  /** 먹은 별사탕의 수 */
  treats: number;
  /** 지금까지 나아간 걸음 수 */
  steps: number;
  status: Status;
}

/** 다음 별사탕까지 먹어야 하는 먹이의 수를 정한다. */
function rollTreatGap(random: () => number): number {
  const span = TREAT_EVERY.max - TREAT_EVERY.min + 1;
  return TREAT_EVERY.min + Math.min(span - 1, Math.floor(random() * span));
}

/** 먹이를 놓을 칸: 몸과 별사탕이 없는 칸 가운데 아무 데나. 빈칸이 없으면 null. */
export function foodSpot(
  size: Size,
  body: readonly Cell[],
  treat: Cell | null,
  random: () => number,
): Cell | null {
  return pick(freeCells(size, treat ? [...body, treat] : body), random);
}

/**
 * 별사탕을 놓을 칸: 몸과 먹이가 없는 칸 가운데 머리에서 알맞게 떨어진 곳.
 * 그런 칸이 없으면 빈칸 아무 데나 놓고, 빈칸이 아예 없으면 null이다.
 */
export function treatSpot(
  size: Size,
  body: readonly Cell[],
  food: Cell,
  random: () => number,
): Cell | null {
  const free = freeCells(size, [...body, food]);
  const reachable = free.filter((cell) => {
    const steps = distance(body[0], cell);
    return steps >= TREAT_DISTANCE.min && steps <= TREAT_DISTANCE.max;
  });
  return pick(reachable.length > 0 ? reachable : free, random);
}

/**
 * 새 판. 애벌레는 밭 아래쪽 가운데에서 위를 보고 서 있어서, 머리 앞으로 긴 길이 남는다.
 * 첫 먹이는 빈칸 아무 데나 놓인다.
 */
export function newGarden(random: () => number): Garden {
  const size: Size = { cols: COLS, rows: ROWS };
  const col = Math.floor(COLS / 2);
  const headRow = ROWS - START_ROWS_BELOW - START_LENGTH;
  const body = Array.from({ length: START_LENGTH }, (_, index) => ({ col, row: headRow + index }));
  const spot = foodSpot(size, body, null, random);
  return {
    ...size,
    body,
    heading: 'up',
    turns: [],
    food: spot && { cell: spot, age: 0 },
    treat: null,
    foodsToTreat: rollTreatGap(random),
    score: 0,
    eaten: 0,
    treats: 0,
    steps: 0,
    status: 'playing',
  };
}

export function isOver(garden: Garden): boolean {
  return garden.status !== 'playing';
}

// ───────── 방향 바꾸기 ─────────

/**
 * 방향 전환을 받아 둔다. 다음 걸음부터 차례로 쓰인다.
 * 받아 둔 것이 있으면 그 마지막 방향을, 없으면 지금 가는 방향을 기준으로 삼아서
 * 같은 쪽이나 정반대 쪽(목덜미 쪽)은 무시한다. 이미 가득 받아 두었을 때도 무시한다.
 * 무시했으면 받은 상태를 그대로 돌려준다.
 */
export function queueTurn(garden: Garden, direction: Direction): Garden {
  if (isOver(garden) || garden.turns.length >= MAX_QUEUED_TURNS) return garden;
  const facing = garden.turns[garden.turns.length - 1] ?? garden.heading;
  if (direction === facing || isOpposite(direction, facing)) return garden;
  return { ...garden, turns: [...garden.turns, direction] };
}

// ───────── 한 걸음 ─────────

export type CrashCause = 'wall' | 'self';

export type StepEvent =
  /** 빈칸으로 한 칸 나아갔다 */
  | { kind: 'move' }
  /** 먹이를 먹고 한 칸 길어졌다 */
  | { kind: 'food'; cell: Cell; points: number }
  /** 별사탕을 먹었다. 몸은 길어지지 않는다. */
  | { kind: 'treat'; cell: Cell; points: number }
  /** 벽이나 제 몸에 부딪혔다. 애벌레는 그 자리에 멈춘다. */
  | { kind: 'crash'; cause: CrashCause }
  /** 이미 끝난 판이라 아무 일도 없었다 */
  | { kind: 'none' };

export interface StepResult {
  garden: Garden;
  event: StepEvent;
  /** 이번 걸음에 별사탕이 새로 나왔는지 */
  treatAppeared: boolean;
  /** 이번 걸음에 별사탕이 먹히지 않은 채 사라졌는지 */
  treatExpired: boolean;
}

/** 머리가 head 칸으로 들어가면 부딪히는지. 부딪히지 않으면 null. */
function crashCause(garden: Garden, head: Cell): CrashCause | null {
  if (!isInside(garden, head)) return 'wall';
  // 꼬리 끝은 같은 걸음에 비켜나므로 그 자리로는 들어갈 수 있다.
  // (먹이는 몸 위에 놓이지 않으니, 꼬리 끝 칸으로 들어가는 걸음에 몸이 길어지는 일은 없다.)
  const blocking = garden.body.slice(0, -1);
  return blocking.some((cell) => sameCell(cell, head)) ? 'self' : null;
}

/** 별사탕의 남은 걸음을 하나 줄인다. 다 되면 사라진다. */
function ageTreat(treat: Treat | null): { treat: Treat | null; expired: boolean } {
  if (!treat) return { treat: null, expired: false };
  if (treat.stepsLeft <= 1) return { treat: null, expired: true };
  return { treat: { ...treat, stepsLeft: treat.stepsLeft - 1 }, expired: false };
}

/**
 * 머리가 먹이 칸(head)으로 들어갔다: 꼬리는 그대로 두어 한 칸 길어지고, 새 먹이를 놓는다.
 * 먹이를 정해진 만큼 먹었으면 별사탕도 나온다. 더 놓을 빈칸이 없으면 밭을 가득 채운 것이다.
 */
function eatFood(moved: Garden, eaten: Food, head: Cell, random: () => number): StepResult {
  const body = [head, ...moved.body];
  const points = foodPoints(eaten.age);
  const event: StepEvent = { kind: 'food', cell: head, points };
  const grown: Garden = { ...moved, body, score: moved.score + points, eaten: moved.eaten + 1 };
  let { treat, expired } = ageTreat(moved.treat);

  let spot = foodSpot(moved, body, treat?.cell ?? null, random);
  if (!spot && treat) {
    // 남은 빈칸이 별사탕 자리뿐이면 별사탕을 치우고 그 자리에 먹이를 놓는다.
    spot = treat.cell;
    treat = null;
    expired = true;
  }
  if (!spot) {
    return {
      garden: {
        ...grown,
        food: null,
        treat: null,
        score: grown.score + FULL_GARDEN_BONUS,
        status: 'full',
      },
      event,
      treatAppeared: false,
      treatExpired: expired,
    };
  }

  let foodsToTreat = moved.foodsToTreat - 1;
  let appeared = false;
  if (foodsToTreat <= 0) {
    foodsToTreat = rollTreatGap(random);
    // 앞의 별사탕이 아직 남아 있으면 이번 차례는 건너뛴다.
    const cell = treat ? null : treatSpot(moved, body, spot, random);
    if (cell) {
      treat = { cell, stepsLeft: TREAT_STEPS };
      appeared = true;
    }
  }
  return {
    garden: { ...grown, food: { cell: spot, age: 0 }, treat, foodsToTreat },
    event,
    treatAppeared: appeared,
    treatExpired: expired,
  };
}

/**
 * 애벌레가 한 걸음 나아간다. 받아 둔 방향 전환이 있으면 하나를 쓴다.
 * 받은 상태는 바꾸지 않고 새 상태와 이번 걸음에 일어난 일을 돌려준다.
 */
export function step(garden: Garden, random: () => number): StepResult {
  const quiet = { treatAppeared: false, treatExpired: false };
  if (isOver(garden)) return { garden, event: { kind: 'none' }, ...quiet };

  const [turn, ...turns] = garden.turns;
  const heading = turn ?? garden.heading;
  const head = nextCell(garden.body[0], heading);
  const cause = crashCause(garden, head);
  if (cause) {
    return {
      garden: { ...garden, heading, turns, status: 'crashed' },
      event: { kind: 'crash', cause },
      ...quiet,
    };
  }

  const moved: Garden = { ...garden, heading, turns, steps: garden.steps + 1 };
  if (garden.food && sameCell(head, garden.food.cell)) {
    return eatFood(moved, garden.food, head, random);
  }

  const body = [head, ...garden.body.slice(0, -1)];
  const food = garden.food && { ...garden.food, age: garden.food.age + 1 };
  if (garden.treat && sameCell(head, garden.treat.cell)) {
    return {
      garden: {
        ...moved,
        body,
        food,
        treat: null,
        score: garden.score + TREAT_POINTS,
        treats: garden.treats + 1,
      },
      event: { kind: 'treat', cell: head, points: TREAT_POINTS },
      ...quiet,
    };
  }
  const { treat, expired } = ageTreat(garden.treat);
  return {
    garden: { ...moved, body, food, treat },
    event: { kind: 'move' },
    treatAppeared: false,
    treatExpired: expired,
  };
}

/**
 * 한 걸음 사이에 각 마디가 출발하는 칸. 화면은 여기서 after의 같은 번호 칸까지 부드럽게 옮겨 그린다.
 * 길어지지 않은 걸음에서는 모든 마디가 앞 마디의 자리로 한 칸씩 따라간다.
 * 길어진 걸음에서는 머리만 나아가고 나머지는 제자리라서, 머리 뒤에서 새 마디가 나오는 것처럼 보인다.
 */
export function crawlFrom(before: readonly Cell[], after: readonly Cell[]): Cell[] {
  const grew = after.length > before.length;
  return after.map((_, index) => before[grew ? Math.max(0, index - 1) : index]);
}
