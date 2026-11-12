/**
 * 주차장 빼기의 규칙. 화면과 분리된 순수 함수라서 숫자만 바꿔 밸런스를 조정할 수 있다.
 * 주차장은 칸으로 된 격자다. 칸은 (col, row)로 적고 왼쪽 위가 (0, 0)이다.
 * 차는 폭이 한 칸, 길이가 두세 칸이고, 가로나 세로로 서서 앞머리 쪽으로만 나간다.
 * 무작위가 필요한 곳은 random(0 이상 1 미만의 수를 돌려주는 함수)을 받아서 쓴다.
 */
import { difficultyOf, STAGE_HEARTS } from '../../core/stages';

export type Facing = 'up' | 'down' | 'left' | 'right';

export interface Cell {
  col: number;
  row: number;
}

export interface Car {
  id: number;
  /** 차가 차지한 칸 가운데 가장 왼쪽 위 칸 */
  col: number;
  row: number;
  /** 길이(칸). 폭은 언제나 한 칸이다. */
  length: number;
  /** 앞머리가 향하는 쪽. 이쪽으로만 나갈 수 있다. */
  facing: Facing;
}

export interface Lot {
  cols: number;
  rows: number;
  cars: readonly Car[];
}

export const SHORT_CAR = 2;
export const LONG_CAR = 3;

/** 앞으로 한 칸 나아갈 때 칸 번호가 바뀌는 양 */
const STEP: Readonly<Record<Facing, Cell>> = {
  up: { col: 0, row: -1 },
  down: { col: 0, row: 1 },
  left: { col: -1, row: 0 },
  right: { col: 1, row: 0 },
};

export function isVertical(facing: Facing): boolean {
  return facing === 'up' || facing === 'down';
}

// ───────── 주차장 ─────────

/** 차가 차지한 칸들. 왼쪽 위 칸부터 차례로. */
export function cellsOf(car: Car): Cell[] {
  const vertical = isVertical(car.facing);
  return Array.from({ length: car.length }, (_, index) => ({
    col: car.col + (vertical ? 0 : index),
    row: car.row + (vertical ? index : 0),
  }));
}

/** 차가 나가면서 지나는 칸들: 앞머리 바로 앞 칸부터 주차장 끝까지, 가까운 칸부터. */
export function exitPath(lot: Pick<Lot, 'cols' | 'rows'>, car: Car): Cell[] {
  const step = STEP[car.facing];
  // 앞머리가 놓인 칸. 오른쪽이나 아래를 보는 차는 맨 끝 칸이 앞머리다.
  const ahead = car.facing === 'right' || car.facing === 'down' ? car.length - 1 : 0;
  const path: Cell[] = [];
  let col = car.col + step.col * (ahead + 1);
  let row = car.row + step.row * (ahead + 1);
  while (col >= 0 && col < lot.cols && row >= 0 && row < lot.rows) {
    path.push({ col, row });
    col += step.col;
    row += step.row;
  }
  return path;
}

/** (col, row) 칸에 서 있는 차. 빈칸이거나 주차장 밖이면 null. */
export function carAt(lot: Lot, col: number, row: number): Car | null {
  for (const car of lot.cars) {
    const vertical = isVertical(car.facing);
    const along = vertical ? row - car.row : col - car.col;
    const across = vertical ? col - car.col : row - car.row;
    if (across === 0 && along >= 0 && along < car.length) return car;
  }
  return null;
}

export interface Blockage {
  /** 앞길을 가장 가까이에서 막고 있는 차 */
  blocker: Car;
  /** 앞머리와 그 차 사이에 비어 있는 칸 수. 바로 붙어 있으면 0. */
  gap: number;
}

/** 차의 앞길이 무엇에 막혀 있는지. 주차장 끝까지 비어 있으면 null. */
export function blockageOf(lot: Lot, car: Car): Blockage | null {
  const path = exitPath(lot, car);
  for (let gap = 0; gap < path.length; gap += 1) {
    const blocker = carAt(lot, path[gap].col, path[gap].row);
    if (blocker) return { blocker, gap };
  }
  return null;
}

/** 앞머리에서 주차장 끝까지 비어 있어서 지금 나갈 수 있는지 */
export function canLeave(lot: Lot, car: Car): boolean {
  return blockageOf(lot, car) === null;
}

/** 지금은 나갈 수 없는 차의 비율(0~1). 차가 없으면 0. */
export function blockedShare(lot: Lot): number {
  if (lot.cars.length === 0) return 0;
  const blocked = lot.cars.filter((car) => !canLeave(lot, car)).length;
  return blocked / lot.cars.length;
}

/**
 * 주차장을 모두 비우는 순서(차 id)를 찾는다. 비울 수 없으면 null.
 * 나갈 수 있는 차를 보이는 대로 빼내기만 하면 된다. 차가 나가면 길이 열리기만 하고
 * 새로 막히는 차는 없으므로, 이렇게 해서 막히는 주차장은 어떤 순서로도 비울 수 없다.
 */
export function solveOrder(lot: Lot): number[] | null {
  const order: number[] = [];
  let rest = lot;
  while (rest.cars.length > 0) {
    const current = rest;
    const free = current.cars.filter((car) => canLeave(current, car));
    if (free.length === 0) return null;
    for (const car of free) order.push(car.id);
    rest = { ...current, cars: current.cars.filter((car) => !free.includes(car)) };
  }
  return order;
}

// ───────── 판 ─────────

export interface StageSpec {
  cols: number;
  rows: number;
  /** 세워 두는 차의 수 */
  cars: number;
  /** 처음에 막혀 있어야 하는 차의 비율. 이보다 뻥 뚫린 주차장은 쓰지 않는다. */
  minBlockedShare: number;
}

/**
 * 판마다의 주차장. 5×5에 6대로 시작해 7×8에 18대까지 넓어지고 빽빽해진다.
 * 가장 큰 7×8은 가장 작은 화면(가로 240, HUD 아래 344)에 한 칸 30px로 들어가는 크기다.
 */
const STAGES: readonly StageSpec[] = [
  { cols: 5, rows: 5, cars: 6, minBlockedShare: 0.4 },
  { cols: 5, rows: 6, cars: 8, minBlockedShare: 0.45 },
  { cols: 6, rows: 6, cars: 10, minBlockedShare: 0.5 },
  { cols: 6, rows: 7, cars: 12, minBlockedShare: 0.5 },
  { cols: 7, rows: 7, cars: 14, minBlockedShare: 0.55 },
  { cols: 7, rows: 8, cars: 16, minBlockedShare: 0.6 },
  { cols: 7, rows: 8, cars: 18, minBlockedShare: 0.65 },
];

/**
 * 막힌 차의 비율이 최소보다 이만큼 넘게 높은 주차장도 쓰지 않는다.
 * 첫 판부터 한 줄로 꽉 묶인 주차장이 나와서 아무 차나 눌러 보다 시간을 다 잃는 일을 막는다.
 */
export const BLOCKED_SHARE_SPREAD = 0.2;

/** 가장 큰 주차장의 크기. 화면에 맞는지 볼 때 쓴다. */
export const MAX_COLS = Math.max(...STAGES.map((spec) => spec.cols));
export const MAX_ROWS = Math.max(...STAGES.map((spec) => spec.rows));

/** stage(1부터)번째 판의 주차장. 마지막 단계 뒤로는 같은 크기가 이어진다. */
export function stageSpec(stage: number): StageSpec {
  const index = Math.min(STAGES.length, Math.max(1, Math.floor(stage))) - 1;
  return STAGES[index];
}

// ───────── 주차장 만들기 ─────────

/** 긴 차(3칸)를 고를 때의 무게. 짧은 차는 1이다. 긴 차가 많으면 차를 다 세우기 전에 자리가 모자란다. */
export const LONG_CAR_WEIGHT = 0.6;
/**
 * 아직 앞이 뚫려 있는 차를 막는 자리에 주는 덤 무게(막는 차 한 대마다).
 * 클수록 처음에 막힌 차가 많아진다.
 */
export const BLOCKING_WEIGHT = 30;
/**
 * 나가는 끝에서 한 칸 더 안쪽일수록 붙는 덤 무게.
 * 안쪽에 선 차는 앞길이 길어서 나중에 세우는 차에 막히기 쉽고, 그만큼 푸는 순서가 길어진다.
 */
export const DEPTH_WEIGHT = 1;
/** 한 판을 만들 때 다시 세워 보는 횟수의 상한 */
export const MAX_ATTEMPTS = 400;

const FACINGS: readonly Facing[] = ['up', 'down', 'left', 'right'];

/**
 * 차를 세우는 동안 쓰는 장부.
 * 차들은 비트 묶음으로 적는다: i번째로 세운 차가 2의 i제곱 자리다(그래서 차는 31대까지).
 */
interface Ledger {
  cols: number;
  rows: number;
  cars: Car[];
  /** 칸마다 차가 서 있는지. 칸 번호는 row * cols + col */
  taken: boolean[];
  /** 칸마다, 그 칸을 지나서 나가야 하는 차들 */
  crossing: number[];
  /** 아직 앞길이 뚫려 있는 차들 */
  open: number;
}

/** 차를 세울 자리: facing 쪽으로 나가는 lane번째 줄에서, 나가는 끝에서 depth칸 들어온 곳에 앞머리를 둔다. */
interface Spot {
  facing: Facing;
  lane: number;
  depth: number;
  length: number;
  /** 이 자리에 차를 세우면 앞길이 막히는 차들 */
  crossed: number;
  weight: number;
}

/** facing 쪽으로 나가는 lane번째 줄에서, 나가는 끝에서 depth칸 들어온 칸 */
function laneCell(size: Pick<Lot, 'cols' | 'rows'>, facing: Facing, lane: number, depth: number): Cell {
  switch (facing) {
    case 'up':
      return { col: lane, row: depth };
    case 'down':
      return { col: lane, row: size.rows - 1 - depth };
    case 'left':
      return { col: depth, row: lane };
    case 'right':
      return { col: size.cols - 1 - depth, row: lane };
  }
}

function countBits(bits: number): number {
  let count = 0;
  for (let rest = bits; rest !== 0; rest &= rest - 1) count += 1;
  return count;
}

/**
 * 지금 새 차를 세울 수 있는 모든 자리.
 * 새 차는 앞길이 비어 있어야 하므로, 줄마다 나가는 끝에서부터 이어진 빈칸 안에만 세울 수 있다.
 */
function openSpots(ledger: Ledger): Spot[] {
  const index = (facing: Facing, lane: number, depth: number): number => {
    const cell = laneCell(ledger, facing, lane, depth);
    return cell.row * ledger.cols + cell.col;
  };
  const spots: Spot[] = [];
  for (const facing of FACINGS) {
    const lanes = isVertical(facing) ? ledger.cols : ledger.rows;
    const laneLength = isVertical(facing) ? ledger.rows : ledger.cols;
    for (let lane = 0; lane < lanes; lane += 1) {
      let run = 0;
      while (run < laneLength && !ledger.taken[index(facing, lane, run)]) run += 1;
      for (const length of [SHORT_CAR, LONG_CAR]) {
        for (let depth = 0; depth + length <= run; depth += 1) {
          let crossed = 0;
          for (let k = 0; k < length; k += 1) crossed |= ledger.crossing[index(facing, lane, depth + k)];
          const blocks = countBits(crossed & ledger.open);
          const weight =
            (length === LONG_CAR ? LONG_CAR_WEIGHT : 1) *
            (1 + DEPTH_WEIGHT * depth) *
            (1 + BLOCKING_WEIGHT * blocks);
          spots.push({ facing, lane, depth, length, crossed, weight });
        }
      }
    }
  }
  return spots;
}

/** 고른 자리에 차를 세우고 장부를 고친다. */
function park(ledger: Ledger, spot: Spot): void {
  const { facing, lane, depth, length } = spot;
  const bit = 1 << ledger.cars.length;
  const cells = Array.from({ length }, (_, k) => laneCell(ledger, facing, lane, depth + k));
  for (const cell of cells) ledger.taken[cell.row * ledger.cols + cell.col] = true;
  for (let ahead = 0; ahead < depth; ahead += 1) {
    const cell = laneCell(ledger, facing, lane, ahead);
    ledger.crossing[cell.row * ledger.cols + cell.col] |= bit;
  }
  ledger.open = (ledger.open & ~spot.crossed) | bit;
  // 왼쪽이나 위를 보는 차는 앞머리 칸이, 오른쪽이나 아래를 보는 차는 꼬리 칸이 가장 왼쪽 위다.
  const corner = facing === 'up' || facing === 'left' ? cells[0] : cells[length - 1];
  ledger.cars.push({ id: ledger.cars.length, col: corner.col, row: corner.row, length, facing });
}

function pickWeighted(spots: readonly Spot[], random: () => number): Spot {
  const total = spots.reduce((sum, spot) => sum + spot.weight, 0);
  let roll = random() * total;
  for (const spot of spots) {
    roll -= spot.weight;
    if (roll < 0) return spot;
  }
  return spots[spots.length - 1];
}

/**
 * 차를 한 대씩 무작위로 세워서 주차장을 채운다. 자리가 모자라면 세운 데까지만 돌려준다.
 * 새 차는 지금 서 있는 차들에 앞길이 막히지 않는 자리에만 세운다. 아무 데나 세우면
 * 마주 보는 두 대처럼 서로 막아서 비울 수 없는 주차장이 대부분이라, 거의 다 버려야 한다.
 */
function fillLot(spec: StageSpec, random: () => number): Lot {
  const cells = spec.cols * spec.rows;
  const ledger: Ledger = {
    cols: spec.cols,
    rows: spec.rows,
    cars: [],
    taken: Array<boolean>(cells).fill(false),
    crossing: Array<number>(cells).fill(0),
    open: 0,
  };
  while (ledger.cars.length < spec.cars) {
    const spots = openSpots(ledger);
    if (spots.length === 0) break;
    park(ledger, pickWeighted(spots, random));
  }
  return { cols: spec.cols, rows: spec.rows, cars: ledger.cars };
}

/** 차 번호를 왼쪽 위부터 읽는 순서로 다시 매긴다. 세운 순서가 번호에 남으면 푸는 순서가 드러난다. */
function renumber(lot: Lot): Lot {
  const sorted = [...lot.cars].sort((a, b) => a.row - b.row || a.col - b.col);
  return { ...lot, cars: sorted.map((car, id) => ({ ...car, id })) };
}

/** 차를 다 세웠고, 비울 수 있고, 처음에 막힌 차의 비율이 그 판의 범위 안인지 */
function suits(lot: Lot, spec: StageSpec): boolean {
  if (lot.cars.length !== spec.cars) return false;
  const share = blockedShare(lot);
  // 비율의 경계에서 소수 오차로 떨어지지 않게 작은 여유를 둔다.
  const inRange =
    share >= spec.minBlockedShare - 1e-9 &&
    share <= spec.minBlockedShare + BLOCKED_SHARE_SPREAD + 1e-9;
  return inRange && solveOrder(lot) !== null;
}

/**
 * stage(1부터)번째 판의 주차장을 만든다.
 * 차를 무작위로 세운 뒤 solveOrder로 비울 수 있는지 확인하고, 처음에 막힌 차의 비율이
 * 그 판에 맞는 주차장만 쓴다. 맞는 것이 나올 때까지 다시 세운다.
 * 횟수를 다 쓰도록 나오지 않으면(고장 난 random이 아니고서는 일어나지 않는다)
 * 그동안 나온 것 가운데 차가 가장 많은 주차장을 쓴다. 그것도 비울 수 있는 주차장이다.
 */
export function generateLot(stage: number, random: () => number): Lot {
  const spec = stageSpec(stage);
  let fallback: Lot = { cols: spec.cols, rows: spec.rows, cars: [] };
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const lot = fillLot(spec, random);
    if (suits(lot, spec)) return renumber(lot);
    if (lot.cars.length > fallback.cars.length && solveOrder(lot) !== null) fallback = lot;
  }
  return renumber(fallback);
}

// ───────── 화면 배치 ─────────

/** 한 칸의 가장 큰 크기(px). 작은 주차장이 화면을 꽉 채워 차가 지나치게 커 보이지 않게 한다. */
export const MAX_CELL = 34;
/** 주차장 둘레에 비워 두는 여백(px). 테두리와 그림자가 들어가고, 화면 끝에 바짝 붙지 않게 한다. */
export const LOT_MARGIN = { x: 12, y: 16 } as const;

export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LotLayout {
  /** 한 칸의 크기(px) */
  cell: number;
  /** 주차장 왼쪽 위 모서리의 좌표 */
  left: number;
  top: number;
}

/**
 * 놀이 영역에서 여백을 뺀 자리에 들어가는 가장 큰 칸 크기를 구하고, 주차장을 영역 한가운데에 놓는다.
 * 칸 크기와 좌표는 정수다.
 */
export function lotLayout(size: Pick<Lot, 'cols' | 'rows'>, area: Area): LotLayout {
  const cell = Math.min(
    MAX_CELL,
    Math.floor((area.width - LOT_MARGIN.x * 2) / size.cols),
    Math.floor((area.height - LOT_MARGIN.y * 2) / size.rows),
  );
  return {
    cell,
    left: Math.round(area.x + (area.width - size.cols * cell) / 2),
    top: Math.round(area.y + (area.height - size.rows * cell) / 2),
  };
}

// ───────── 시간 ─────────

/** 처음에 주어지는 시간(초). 판을 깨서 돌려받아도 이보다 많아지지는 않는다. */
export const TIME_BANK_SECONDS = 60;
/** 막힌 차를 눌렀을 때 깎이는 시간(초) */
export const BUMP_PENALTY_SECONDS = 3;
/** 첫 판을 깼을 때 돌려받는 시간(초) */
export const FIRST_CLEAR_SECONDS = 6;
/** 아무리 뒤의 판이라도 이만큼은 돌려받는다(초) */
export const MIN_CLEAR_SECONDS = 2;

/**
 * stage번째 판을 깼을 때 돌려받는 시간(초). 두 판마다 1초씩 줄어든다.
 * 뒤로 갈수록 한 판에 드는 시간은 늘고 돌려받는 시간은 줄어서, 한 판은 언젠가 끝난다.
 */
export function clearSeconds(stage: number): number {
  const level = Math.max(1, Math.floor(stage));
  return Math.max(MIN_CLEAR_SECONDS, FIRST_CLEAR_SECONDS - Math.floor((level - 1) / 2));
}

// ───────── 점수 ─────────

/** 차 한 대를 빼냈을 때의 기본 점수 */
export const CAR_POINTS = 2;
/** 부딪히지 않고 이만큼 이어서 빼낼 때마다 차 한 대의 점수가 1점씩 오른다. */
export const STREAK_STEP = 5;
/** 연속으로 붙는 점수의 상한 */
export const MAX_STREAK_BONUS = 2;
/** 판을 깼을 때의 보너스: 판 번호에 이 값을 곱한다. */
export const CLEAR_POINTS_PER_STAGE = 5;

/** 차 한 대의 점수. streak은 이번 차까지 센, 부딪히지 않고 이어서 빼낸 수. */
export function carPoints(streak: number): number {
  const bonus = Math.floor(Math.max(0, streak) / STREAK_STEP);
  return CAR_POINTS + Math.min(MAX_STREAK_BONUS, bonus);
}

/** stage번째 판을 깼을 때의 보너스. 뒤의 판일수록 크다. */
export function clearPoints(stage: number): number {
  return CLEAR_POINTS_PER_STAGE * Math.max(1, Math.floor(stage));
}

// ───────── 한 판의 진행 ─────────

export interface RunState {
  /** 지금 판의 번호. 1부터 센다. */
  stage: number;
  lot: Lot;
  /** 남은 시간(초) */
  timeLeft: number;
  score: number;
  /** 막힌 차를 누르지 않고 이어서 빼낸 차의 수 */
  streak: number;
  carsOut: number;
  lotsCleared: number;
  /** 막힌 차를 누른 횟수 */
  bumps: number;
}

export type TapOutcome =
  /** 아무 일도 없다: 빈칸이나 주차장 밖을 눌렀거나, 시간이 이미 다 됐다. */
  | { kind: 'none' }
  /** 차가 나갔다. 마지막 차였으면 cleared에 판을 깬 보상(점수, 돌려받은 시간)이 담긴다. */
  | { kind: 'exit'; car: Car; points: number; cleared: { points: number; seconds: number } | null }
  /** 앞이 막혀서 못 나갔다. gap은 막은 차와의 사이에 빈 칸 수, seconds는 깎인 시간. */
  | { kind: 'blocked'; car: Car; blocker: Car; gap: number; seconds: number };

export function newRun(random: () => number): RunState {
  return {
    stage: 1,
    lot: generateLot(1, random),
    timeLeft: TIME_BANK_SECONDS,
    score: 0,
    streak: 0,
    carsOut: 0,
    lotsCleared: 0,
    bumps: 0,
  };
}

/**
 * (col, row) 칸을 눌렀을 때: 거기 선 차가 나갈 수 있으면 빼내고, 막혀 있으면 시간을 깎는다.
 * 받은 상태는 바꾸지 않고 새 상태를 돌려준다.
 */
export function tapCell(
  run: RunState,
  col: number,
  row: number,
): { run: RunState; outcome: TapOutcome } {
  const car = isOver(run) ? null : carAt(run.lot, col, row);
  if (!car) return { run, outcome: { kind: 'none' } };

  const blockage = blockageOf(run.lot, car);
  if (blockage) {
    const seconds = Math.min(BUMP_PENALTY_SECONDS, run.timeLeft);
    return {
      run: { ...run, timeLeft: run.timeLeft - seconds, streak: 0, bumps: run.bumps + 1 },
      outcome: { kind: 'blocked', car, ...blockage, seconds },
    };
  }

  const streak = run.streak + 1;
  const points = carPoints(streak);
  const lot: Lot = { ...run.lot, cars: run.lot.cars.filter((other) => other !== car) };
  const next: RunState = { ...run, lot, streak, score: run.score + points, carsOut: run.carsOut + 1 };
  if (lot.cars.length > 0) {
    return { run: next, outcome: { kind: 'exit', car, points, cleared: null } };
  }

  const timeLeft = Math.min(TIME_BANK_SECONDS, run.timeLeft + clearSeconds(run.stage));
  const cleared = { points: clearPoints(run.stage), seconds: timeLeft - run.timeLeft };
  return {
    run: { ...next, timeLeft, score: next.score + cleared.points, lotsCleared: run.lotsCleared + 1 },
    outcome: { kind: 'exit', car, points, cleared },
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

/** 다음 판으로 넘어간다. 주차장을 비운 뒤에 부른다. */
export function nextStage(run: RunState, random: () => number): RunState {
  const stage = run.stage + 1;
  return { ...run, stage, lot: generateLot(stage, random) };
}

// ───────── 단계 모드 ─────────

/** 단계 모드가 거치는 난이도의 수: 가장 작은 주차장부터 가장 붐비는 주차장까지 */
export const LEVEL_STEPS = STAGES.length;

/** 단계 모드의 level(1부터)번째 단계가 쓰는 판 번호. stageSpec과 generateLot의 stage로 넘긴다. */
export function levelStage(level: number): number {
  return difficultyOf(level, LEVEL_STEPS);
}

/**
 * 단계 모드의 한 단계. 시간은 흐르지 않고(elapse를 부르지 않는다), 주차장 하나를 비우면 깬 것이다.
 * 막힌 차를 누를 수 있는 횟수가 정해져 있어서, 아무 차나 눌러 보는 것으로는 깰 수 없다.
 */
export function levelRun(level: number, random: () => number): RunState {
  const stage = levelStage(level);
  return {
    stage,
    lot: generateLot(stage, random),
    timeLeft: TIME_BANK_SECONDS,
    score: 0,
    streak: 0,
    carsOut: 0,
    lotsCleared: 0,
    bumps: 0,
  };
}

/** 단계 모드에서 남은 기회: 막힌 차를 더 누를 수 있는 횟수 */
export function chancesLeft(run: RunState): number {
  return Math.max(0, STAGE_HEARTS - run.bumps);
}
