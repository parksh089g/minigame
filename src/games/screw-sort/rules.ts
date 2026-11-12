/**
 * 나사 풀기의 규칙: 판과 나사, 상자와 쟁반, 단계 만들기, 점수.
 * 화면과 Phaser에 의존하지 않는 순수 함수들이다. 무작위가 필요한 곳은 random을 받아서 쓴다.
 *
 * 작업대는 칸으로 나뉘어 있고, 판은 칸 몇 개를 덮으며 아래에서 위로 겹쳐 쌓인다.
 * 나사는 칸 한가운데에 박혀 판 하나를 붙든다. 더 위에 놓인 판이 그 칸을 덮고 있으면 가려져서 풀 수 없다.
 * 푼 나사는 같은 색의 열린 상자로 가고, 맞는 상자가 없으면 쟁반에서 기다린다.
 * 판은 마지막 나사가 풀리면 떨어지고, 나사를 모두 풀면 단계를 깬 것이다.
 *
 * 끝나는 규칙은 하나다: 쟁반이 가득 찼고, 풀 수 있는 나사 가운데 상자로 갈 것이 하나도 없으면 끝난다.
 * 곧 "더 둘 수가 없을 때"만 끝난다. 쟁반이 가득 차도 상자에 넣을 나사가 보이면 계속할 수 있고,
 * 그동안 상자가 없는 나사는 눌러도 풀리지 않는다.
 */
import { difficultyOf } from '../../core/stages';

// ───────── 작업대 ─────────

/** 작업대의 칸 수. 나사는 칸 한가운데에 박히므로 칸의 크기가 곧 나사 사이의 거리다. */
export const BOARD_COLS = 7;
export const BOARD_ROWS = 8;
/** 상자 하나에 들어가는 나사 수 */
export const BOX_SIZE = 3;
/** 한 번에 열려 있는 상자 수 */
export const OPEN_BOXES = 2;
/** 쟁반의 자리 수 */
export const TRAY_SIZE = 5;
/** 나사 색의 가짓수. 색 번호는 0부터 이 수 미만이다. */
export const COLOR_COUNT = 6;

/** 판 하나. 덮고 있는 칸의 번호들(칸 번호 = 줄 × BOARD_COLS + 열) */
export interface Plate {
  cells: readonly number[];
}

export interface Screw {
  /** 이 나사가 붙들고 있는 판의 번호. 번호가 큰 판이 위에 놓인다. */
  plate: number;
  cell: number;
  color: number;
}

export interface Stage {
  /** 아래에서 위로 쌓인 순서 */
  plates: readonly Plate[];
  screws: readonly Screw[];
  /** 상자가 나오는 순서대로 적은 색. 처음 OPEN_BOXES개가 열려 있다. */
  boxes: readonly number[];
  /** 만들 때 찾아 둔 풀이: 이 순서로 나사를 풀면 반드시 깬다. */
  solution: readonly number[];
}

export function cellAt(col: number, row: number): number {
  return row * BOARD_COLS + col;
}

export function cellPosition(cell: number): { col: number; row: number } {
  return { col: cell % BOARD_COLS, row: Math.floor(cell / BOARD_COLS) };
}

/** 칸으로 잰 네모. col, row는 왼쪽 위 칸이고 cols, rows는 가로세로 칸 수다. */
export interface CellRect {
  col: number;
  row: number;
  cols: number;
  rows: number;
}

/**
 * 판을 빈틈없이 덮는 가장 큰 네모들. 막대와 네모는 하나, ㄱ자는 둘(가로 팔과 세로 팔)이 나온다.
 * 화면은 이 네모들을 겹쳐 그려서 판의 모양을 만든다.
 */
export function plateRects(plate: Plate): CellRect[] {
  const inside = new Set(plate.cells);
  const fits = (rect: CellRect): boolean => {
    for (let row = rect.row; row < rect.row + rect.rows; row += 1) {
      for (let col = rect.col; col < rect.col + rect.cols; col += 1) {
        if (col >= BOARD_COLS || row >= BOARD_ROWS || !inside.has(cellAt(col, row))) return false;
      }
    }
    return true;
  };
  const all: CellRect[] = [];
  for (const cell of plate.cells) {
    const { col, row } = cellPosition(cell);
    for (let rows = 1; fits({ col, row, cols: 1, rows }); rows += 1) {
      for (let cols = 1; fits({ col, row, cols, rows }); cols += 1) all.push({ col, row, cols, rows });
    }
  }
  const within = (a: CellRect, b: CellRect): boolean =>
    a.col >= b.col && a.row >= b.row && a.col + a.cols <= b.col + b.cols && a.row + a.rows <= b.row + b.rows;
  return all.filter((rect) => !all.some((other) => other !== rect && within(rect, other)));
}

/** 판마다 아직 박혀 있는 나사의 수. 0이면 떨어진 판이다. */
function screwsLeft(stage: Stage, inPlace: readonly boolean[]): number[] {
  const left = stage.plates.map(() => 0);
  stage.screws.forEach((screw, id) => {
    if (inPlace[id]) left[screw.plate] += 1;
  });
  return left;
}

/** 칸마다 맨 위에 보이는 판의 번호. 판이 없는 칸은 -1. */
function topPlates(stage: Stage, inPlace: readonly boolean[]): number[] {
  const left = screwsLeft(stage, inPlace);
  const top = Array<number>(BOARD_COLS * BOARD_ROWS).fill(-1);
  // 아래 판부터 적어 나가면 마지막에 남는 것이 맨 위 판이다.
  stage.plates.forEach((plate, index) => {
    if (left[index] === 0) return;
    for (const cell of plate.cells) top[cell] = index;
  });
  return top;
}

/** 지금 풀 수 있는(가려지지 않은) 나사의 번호들 */
function freeIn(stage: Stage, inPlace: readonly boolean[]): number[] {
  const top = topPlates(stage, inPlace);
  const free: number[] = [];
  stage.screws.forEach((screw, id) => {
    if (inPlace[id] && top[screw.cell] === screw.plate) free.push(id);
  });
  return free;
}

// ───────── 진행 상태 ─────────

export interface OpenBox {
  color: number;
  /** 들어 있는 나사 수 */
  count: number;
}

/** playing: 진행 중, cleared: 나사를 모두 풀었음, stuck: 더 둘 수가 없어서 끝남 */
export type Status = 'playing' | 'cleared' | 'stuck';

export interface Bench {
  stage: Stage;
  /** 나사마다 아직 박혀 있는지 */
  inPlace: readonly boolean[];
  /** 열려 있는 상자. 더 나올 상자가 없는 자리는 null */
  open: readonly (OpenBox | null)[];
  /** 다음에 나올 상자의 순번(stage.boxes의 번호). 다 나왔으면 boxes.length */
  nextBox: number;
  /** 쟁반에서 기다리는 나사의 번호들. 들어온 순서대로다. */
  tray: readonly number[];
  status: Status;
}

/** 단계를 막 시작한 상태 */
export function startStage(stage: Stage): Bench {
  const opened = Math.min(OPEN_BOXES, stage.boxes.length);
  return {
    stage,
    inPlace: stage.screws.map(() => true),
    open: Array.from({ length: OPEN_BOXES }, (_, slot) =>
      slot < opened ? { color: stage.boxes[slot], count: 0 } : null,
    ),
    nextBox: opened,
    tray: [],
    status: stage.screws.length === 0 ? 'cleared' : 'playing',
  };
}

/** 그 칸에서 맨 위에 보이는 판의 번호. 판이 없으면 -1. */
export function topPlateAt(bench: Bench, cell: number): number {
  return topPlates(bench.stage, bench.inPlace)[cell] ?? -1;
}

/** 나사가 아직 박혀 있고 더 위의 판에 가려지지 않았는지 */
export function isFree(bench: Bench, screw: number): boolean {
  const target = bench.stage.screws[screw];
  if (!target || !bench.inPlace[screw]) return false;
  return topPlateAt(bench, target.cell) === target.plate;
}

export function freeScrews(bench: Bench): number[] {
  return freeIn(bench.stage, bench.inPlace);
}

/** 그 칸을 눌렀을 때 풀리는 나사의 번호. 맨 위 판의 나사가 그 칸에 박혀 있을 때만 있고, 없으면 -1. */
export function screwAt(bench: Bench, cell: number): number {
  const plate = topPlateAt(bench, cell);
  if (plate < 0) return -1;
  return bench.stage.screws.findIndex(
    (screw, id) => bench.inPlace[id] && screw.plate === plate && screw.cell === cell,
  );
}

/**
 * 그 색의 나사를 받을 상자의 자리. 없으면 -1.
 * 같은 색 상자가 둘 다 열려 있으면 더 많이 찬 쪽으로 간다(먼저 닫히는 편이 언제나 낫다).
 */
export function boxFor(open: readonly (OpenBox | null)[], color: number): number {
  let best = -1;
  open.forEach((box, slot) => {
    if (!box || box.color !== color || box.count >= BOX_SIZE) return;
    if (best < 0 || box.count > (open[best]?.count ?? 0)) best = slot;
  });
  return best;
}

/** 지금 눌러서 풀 수 있는지: 가려지지 않았고, 갈 상자가 있거나 쟁반에 자리가 있어야 한다. */
export function canTake(bench: Bench, screw: number): boolean {
  if (bench.status !== 'playing' || !isFree(bench, screw)) return false;
  return bench.tray.length < TRAY_SIZE || boxFor(bench.open, bench.stage.screws[screw].color) >= 0;
}

/** 더 둘 수가 없는지: 쟁반이 가득 찼고, 풀 수 있는 나사 가운데 상자로 갈 것이 없다. */
function isStuck(
  stage: Stage,
  inPlace: readonly boolean[],
  open: readonly (OpenBox | null)[],
  tray: readonly number[],
): boolean {
  if (tray.length < TRAY_SIZE) return false;
  return freeIn(stage, inPlace).every((id) => boxFor(open, stage.screws[id].color) < 0);
}

// ───────── 나사 풀기 ─────────

/** 나사 하나를 풀었을 때 차례로 일어나는 일. 화면은 이 순서대로 보여 주면 된다. */
export type TakeEvent =
  /** 푼 나사가 slot번 상자의 place번째 자리로 간다. */
  | { kind: 'box'; screw: number; slot: number; place: number }
  /** 푼 나사가 쟁반의 place번째 자리로 간다. */
  | { kind: 'tray'; screw: number; place: number }
  /** 마지막 나사가 풀려 판이 떨어진다. */
  | { kind: 'plate'; plate: number }
  /** 가득 찬 상자가 닫힌다. */
  | { kind: 'close'; slot: number; color: number }
  /** 닫힌 자리에 다음 상자가 들어온다. */
  | { kind: 'open'; slot: number; color: number }
  /** 쟁반에서 기다리던 나사가 새 상자로 옮겨 간다. from은 옮기기 직전 쟁반에서의 자리. */
  | { kind: 'fromTray'; screw: number; from: number; slot: number; place: number };

export type TakeOutcome =
  /** closed는 이번에 닫힌 상자 수 */
  | { kind: 'taken'; events: readonly TakeEvent[]; closed: number; points: number }
  /** covered: 가려졌거나 이미 풀린 나사(단계가 끝난 뒤에는 모든 나사), trayFull: 갈 상자가 없는데 쟁반도 가득 참 */
  | { kind: 'refused'; reason: 'covered' | 'trayFull' };

/**
 * 나사를 푼다. 받은 상태는 바꾸지 않고 새 상태를 돌려준다. 풀 수 없으면 상태는 그대로다.
 * 상자가 가득 차면 닫히고 다음 상자가 들어오며, 쟁반에서 그 색을 기다리던 나사가 곧바로 옮겨 간다.
 * 그렇게 옮겨 간 나사로 새 상자가 또 가득 차면 이어서 닫힌다.
 */
export function takeScrew(bench: Bench, screw: number): { bench: Bench; outcome: TakeOutcome } {
  if (bench.status !== 'playing' || !isFree(bench, screw)) {
    return { bench, outcome: { kind: 'refused', reason: 'covered' } };
  }
  const { stage } = bench;
  const target = stage.screws[screw];
  const open = bench.open.map((box) => (box ? { ...box } : null));
  const tray = [...bench.tray];
  const events: TakeEvent[] = [];

  const slot = boxFor(open, target.color);
  if (slot < 0 && tray.length >= TRAY_SIZE) {
    return { bench, outcome: { kind: 'refused', reason: 'trayFull' } };
  }
  const inPlace = bench.inPlace.map((there, id) => there && id !== screw);
  if (slot >= 0) {
    const box = open[slot]!;
    events.push({ kind: 'box', screw, slot, place: box.count });
    box.count += 1;
  } else {
    events.push({ kind: 'tray', screw, place: tray.length });
    tray.push(screw);
  }
  if (!stage.screws.some((other, id) => inPlace[id] && other.plate === target.plate)) {
    events.push({ kind: 'plate', plate: target.plate });
  }

  let nextBox = bench.nextBox;
  let closed = 0;
  for (let full = fullSlot(open); full >= 0; full = fullSlot(open)) {
    events.push({ kind: 'close', slot: full, color: open[full]!.color });
    closed += 1;
    if (nextBox >= stage.boxes.length) {
      open[full] = null;
      continue;
    }
    const box: OpenBox = { color: stage.boxes[nextBox], count: 0 };
    nextBox += 1;
    open[full] = box;
    events.push({ kind: 'open', slot: full, color: box.color });
    // 쟁반에서 이 색을 기다리던 나사가 들어온 순서대로 옮겨 간다.
    for (let from = 0; from < tray.length && box.count < BOX_SIZE; ) {
      if (stage.screws[tray[from]].color !== box.color) {
        from += 1;
        continue;
      }
      events.push({ kind: 'fromTray', screw: tray[from], from, slot: full, place: box.count });
      tray.splice(from, 1);
      box.count += 1;
    }
  }

  const status: Status = inPlace.every((there) => !there)
    ? 'cleared'
    : isStuck(stage, inPlace, open, tray)
      ? 'stuck'
      : 'playing';
  return {
    bench: { stage, inPlace, open, nextBox, tray, status },
    outcome: { kind: 'taken', events, closed, points: SCREW_POINTS + BOX_POINTS * closed },
  };
}

function fullSlot(open: readonly (OpenBox | null)[]): number {
  return open.findIndex((box) => box !== null && box.count >= BOX_SIZE);
}

export interface ReplayResult {
  /** 순서대로 모두 풀어서 단계를 깼는지 */
  solved: boolean;
  /** 푸는 동안 쟁반에 가장 많이 쌓였던 나사 수 */
  peakTray: number;
  /** 막히기 전까지 푼 나사 수 */
  taken: number;
}

/** 주어진 순서로 나사를 풀어 본다. 풀 수 없는 나사를 만나거나 끝나 버리면 거기서 멈춘다. */
export function replay(stage: Stage, order: readonly number[]): ReplayResult {
  let bench = startStage(stage);
  let peakTray = 0;
  let taken = 0;
  for (const screw of order) {
    const step = takeScrew(bench, screw);
    if (step.outcome.kind !== 'taken') break;
    bench = step.bench;
    taken += 1;
    peakTray = Math.max(peakTray, bench.tray.length);
  }
  return { solved: bench.status === 'cleared', peakTray, taken };
}

// ───────── 점수 ─────────

/** 나사 하나를 풀 때마다 */
export const SCREW_POINTS = 1;
/** 상자 하나를 닫을 때마다 */
export const BOX_POINTS = 5;
/** 단계를 깼을 때의 보너스는 단계 번호에 이 값을 곱한 만큼이다. */
export const STAGE_BONUS = 10;

/** stage번째(1부터) 단계를 깼을 때의 보너스. 뒤 단계일수록 크다. */
export function stageBonus(stage: number): number {
  return STAGE_BONUS * Math.max(1, Math.floor(stage));
}

// ───────── 난이도 ─────────

export const START_SCREWS = 9;
/** 단계마다 늘어나는 나사 수. 상자 하나 분량이다. */
export const SCREWS_PER_STAGE = BOX_SIZE;
/** 한 화면에서 알아볼 수 있는 나사 수의 상한 */
export const MAX_SCREWS = 30;
export const MIN_COLORS = 3;

export interface StageSpec {
  /** 나사 수. 언제나 BOX_SIZE의 배수다. */
  screws: number;
  /** 쓰는 색의 가짓수. 열린 상자는 둘뿐이라 색이 많을수록 쟁반으로 가는 나사가 늘어난다. */
  colors: number;
  /** 판을 놓는 범위(칸). 작업대 한가운데에 잡는다. */
  cols: number;
  rows: number;
  /** 새 판을 놓을 때 아래 판의 나사를 가리게 놓을 확률 */
  cover: number;
  /** 판 하나가 한꺼번에 가릴 수 있는 나사 수 */
  hideLimit: number;
  /** 한 칸 위에 겹쳐 쌓이는 판 수의 상한. 너무 깊으면 무엇이 위인지 알아보기 어렵다. */
  stack: number;
  /** 색을 맞바꿔 보는 횟수. 많을수록 상자 순서와 어긋난 색이 먼저 풀린다. */
  mixTries: number;
  /** 풀이 순서에서 이 거리 안에 있는 나사끼리만 색을 맞바꾼다. */
  mixReach: number;
  /** 찾아 둔 풀이가 쟁반을 이만큼까지만 쓴다. 쟁반에는 언제나 한 자리 이상의 여유가 남는다. */
  trayBudget: number;
  /** 꼼꼼하게 풀면 깰 확률이 이보다 낮은 단계는 되도록 내지 않는다(실력보다 운에 달린 단계를 거른다). */
  carefulFloor: number;
  /** 덤벙대며 풀면 깰 확률이 이 값에 가까운 단계를 고른다. 낮을수록 함정이 많은 단계다. */
  carelessTarget: number;
}

/** stage번째(1부터) 단계의 크기와 어려움. 뒤로 갈수록 어느 값도 쉬워지지 않는다. */
export function stageSpec(stage: number): StageSpec {
  const level = Math.max(1, Math.floor(stage));
  return {
    screws: Math.min(MAX_SCREWS, START_SCREWS + SCREWS_PER_STAGE * (level - 1)),
    colors: Math.min(COLOR_COUNT, MIN_COLORS + Math.floor(level / 2)),
    // 첫 단계는 가운데 5×5칸만 써서 작업대 아래쪽이 비어 있다(도움말이 놓이는 자리).
    cols: Math.min(BOARD_COLS, 4 + level),
    rows: Math.min(BOARD_ROWS, 4 + level),
    cover: Math.min(1, 0.4 + 0.075 * level),
    hideLimit: level < 4 ? 2 : level < 8 ? 3 : 4,
    stack: level < 8 ? 3 : 4,
    mixTries: Math.min(50, 8 * level),
    mixReach: Math.min(MAX_SCREWS, 2 + 3 * level),
    trayBudget: Math.min(TRAY_SIZE - 1, 1 + Math.floor(level / 2)),
    carefulFloor: Math.max(0.3, Math.min(0.8, 1.1 - 0.05 * level)),
    carelessTarget: Math.max(0, Math.min(1, 1.3 - 0.15 * level)),
  };
}

// ───────── 풀이 찾기 ─────────

/** 풀이를 찾을 때 살펴보는 상태 수의 상한. 단계를 만드는 데 드는 시간을 묶어 둔다. */
const SOLVE_NODES = 60;
/** 단계가 얼마나 쉬운지 어림할 때 풀어 보는 횟수 */
const EASE_PLAYS = 8;

/**
 * 지금 풀 수 있는 나사를 좋아 보이는 것부터 늘어놓는다. 쟁반은 trayLimit개까지만 쓴다.
 * 상자에 바로 들어가는 나사가 가장 좋고, 쟁반으로 가야 한다면 곧 상자가 나올 색이 낫다.
 * 어느 쪽이든 판을 곧 떼어 낼 수 있는(판에 남은 나사가 적은) 쪽을 먼저 본다.
 * allKnown이 false면 사람처럼 보이는 것만 안다: 가려진 나사는 세지 않고, 상자는 미리 보기 하나만 안다.
 */
function rankedMoves(bench: Bench, trayLimit: number, allKnown: boolean, jitter: () => number): number[] {
  const { stage } = bench;
  const free = freeIn(stage, bench.inPlace);
  const left = allKnown ? screwsLeft(stage, bench.inPlace) : stage.plates.map(() => 0);
  if (!allKnown) for (const screw of free) left[stage.screws[screw].plate] += 1;
  const foresight = allKnown ? stage.boxes.length : 1;
  const roomInTray = bench.tray.length < trayLimit;

  const ranked: Array<{ screw: number; appeal: number }> = [];
  for (const screw of free) {
    const { color, plate } = stage.screws[screw];
    const loosens = 1 / left[plate];
    if (boxFor(bench.open, color) >= 0) {
      ranked.push({ screw, appeal: 100 + loosens + jitter() });
    } else if (roomInTray) {
      const upcoming = stage.boxes.slice(bench.nextBox, bench.nextBox + foresight).indexOf(color);
      ranked.push({ screw, appeal: loosens - (upcoming < 0 ? foresight : upcoming) + jitter() });
    }
  }
  return ranked.sort((a, b) => b.appeal - a.appeal).map((item) => item.screw);
}

/** 같은 나사가 남아 있고 상자와 쟁반의 색이 같으면 같은 상태다. */
function benchKey(bench: Bench): string {
  const { screws } = bench.stage;
  const left = bench.inPlace.map((there) => (there ? '1' : '0')).join('');
  const open = bench.open.map((box) => (box ? `${box.color}${box.count}` : '-')).join('');
  const tray = bench.tray
    .map((id) => screws[id].color)
    .sort()
    .join('');
  return `${left}|${open}|${bench.nextBox}|${tray}`;
}

/**
 * 쟁반을 trayLimit개까지만 쓰면서 단계를 깨는 순서를 깊이 우선으로 찾는다. 못 찾으면 null.
 * nodeLimit개의 상태를 보고도 못 찾으면 포기하므로, null이 풀이가 없다는 뜻은 아니다.
 */
export function solve(stage: Stage, trayLimit: number, nodeLimit = SOLVE_NODES): number[] | null {
  const dead = new Set<string>();
  const path: number[] = [];
  let nodes = 0;

  const visit = (bench: Bench): boolean => {
    if (bench.status === 'cleared') return true;
    if (bench.status === 'stuck') return false;
    const key = benchKey(bench);
    if (dead.has(key)) return false;
    nodes += 1;
    if (nodes > nodeLimit) return false;
    for (const screw of rankedMoves(bench, trayLimit, true, () => 0)) {
      path.push(screw);
      if (visit(takeScrew(bench, screw).bench)) return true;
      path.pop();
      if (nodes > nodeLimit) return false;
    }
    dead.add(key);
    return false;
  };

  return visit(startStage(stage)) ? path : null;
}

/** choose가 고르는 대로 plays번 풀어 보고, 단계를 깬 비율을 돌려준다(0~1). */
function clearRate(stage: Stage, plays: number, choose: (bench: Bench) => number): number {
  let cleared = 0;
  for (let play = 0; play < plays; play += 1) {
    let bench = startStage(stage);
    while (bench.status === 'playing') bench = takeScrew(bench, choose(bench)).bench;
    if (bench.status === 'cleared') cleared += 1;
  }
  return cleared / plays;
}

/**
 * 꼼꼼한 사람이 풀었을 때 단계를 깰 확률을 어림한다(0~1).
 * 보이는 것만 가지고 가장 좋아 보이는 나사를 푼다. 비슷하게 좋아 보이면 그때그때 다르게 고른다.
 * 가려진 나사는 모르는 채로 푸니까, 이 값이 낮은 단계는 실력보다 운에 달린 단계다.
 */
export function carefulEase(stage: Stage, random: () => number, plays = EASE_PLAYS): number {
  return clearRate(stage, plays, (bench) => rankedMoves(bench, TRAY_SIZE, false, () => random() * 0.5)[0]);
}

/**
 * 덤벙대는 사람이 풀었을 때 단계를 깰 확률을 어림한다(0~1).
 * 상자에 맞는 나사가 보이면 그 가운데 아무거나, 없으면 보이는 나사 아무거나 푼다.
 */
export function carelessEase(stage: Stage, random: () => number, plays = EASE_PLAYS): number {
  return clearRate(stage, plays, (bench) => {
    const free = freeIn(stage, bench.inPlace);
    const fits = free.filter((screw) => boxFor(bench.open, stage.screws[screw].color) >= 0);
    return pickOne(fits.length > 0 ? fits : free, random);
  });
}

// ───────── 단계 만들기 ─────────

/** 판 하나를 놓으려고 모양을 바꿔 보는 횟수, 배치 전체를 다시 해 보는 횟수 */
const SHAPE_TRIES = 40;
const LAYOUT_TRIES = 30;
/** 단계 하나를 낼 때 만들어 보는 후보의 수. 그 가운데 그 단계에 가장 잘 맞는 것을 고른다. */
export const STAGE_CANDIDATES = 6;

interface Shape {
  /** 칸의 [열, 줄] 차이들. 왼쪽 위가 (0, 0) */
  cells: ReadonlyArray<readonly [number, number]>;
  /** 박을 수 있는 나사 수의 범위 */
  minScrews: number;
  maxScrews: number;
  /** 뽑힐 비중 */
  weight: number;
}

/** 판의 기본 모양. 돌리고 뒤집은 것까지 모두 쓴다. */
const BASE_SHAPES: readonly Shape[] = [
  // 막대
  { cells: [[0, 0], [1, 0]], minScrews: 2, maxScrews: 2, weight: 3 },
  { cells: [[0, 0], [1, 0], [2, 0]], minScrews: 2, maxScrews: 3, weight: 4 },
  { cells: [[0, 0], [1, 0], [2, 0], [3, 0]], minScrews: 2, maxScrews: 3, weight: 2 },
  // 네모
  { cells: [[0, 0], [1, 0], [0, 1], [1, 1]], minScrews: 2, maxScrews: 4, weight: 3 },
  { cells: [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]], minScrews: 3, maxScrews: 4, weight: 2 },
  // ㄱ자
  { cells: [[0, 0], [1, 0], [0, 1]], minScrews: 2, maxScrews: 3, weight: 3 },
  { cells: [[0, 0], [0, 1], [0, 2], [1, 2]], minScrews: 2, maxScrews: 3, weight: 2 },
];

const SHAPES: readonly Shape[] = BASE_SHAPES.flatMap(orientations);

/** 한 모양을 돌리고 뒤집어서 나오는 서로 다른 모양들. 비중은 그 수만큼 나눠 가진다. */
function orientations(shape: Shape): Shape[] {
  const seen = new Map<string, Array<readonly [number, number]>>();
  let cells = shape.cells.map(([x, y]) => [x, y] as const);
  for (let turn = 0; turn < 8; turn += 1) {
    // 네 번 돌린 뒤에 한 번 뒤집어서 여덟 가지를 모두 본다.
    cells = cells.map(([x, y]) => (turn === 4 ? ([-x, y] as const) : ([-y, x] as const)));
    const minX = Math.min(...cells.map(([x]) => x));
    const minY = Math.min(...cells.map(([, y]) => y));
    const moved = cells
      .map(([x, y]) => [x - minX, y - minY] as const)
      .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    seen.set(moved.map(([x, y]) => `${x},${y}`).join(' '), moved);
  }
  return [...seen.values()].map((variant) => ({
    ...shape,
    cells: variant,
    weight: shape.weight / seen.size,
  }));
}

/** 0 이상 count 미만의 정수 */
function pick(count: number, random: () => number): number {
  return Math.min(count - 1, Math.floor(random() * count));
}

function pickOne<T>(items: readonly T[], random: () => number): T {
  return items[pick(items.length, random)];
}

/** 피셔-예이츠 섞기. 받은 배열을 그 자리에서 섞어 돌려준다. */
function shuffle<T>(items: T[], random: () => number): T[] {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const other = pick(index + 1, random);
    [items[index], items[other]] = [items[other], items[index]];
  }
  return items;
}

function pickShape(random: () => number): Shape {
  const total = SHAPES.reduce((sum, shape) => sum + shape.weight, 0);
  let roll = random() * total;
  for (const shape of SHAPES) {
    roll -= shape.weight;
    if (roll < 0) return shape;
  }
  return SHAPES[SHAPES.length - 1];
}

/** 색을 정하기 전의 나사 */
interface Peg {
  plate: number;
  cell: number;
}

/** 판을 하나씩 올려 가는 동안의 배치 */
interface Layout {
  plates: number[][];
  pegs: Peg[];
  /** 칸마다 쌓인 판의 수 */
  stack: number[];
  /** 칸마다 맨 위에 있는 판의 번호(-1은 빈 칸) */
  top: number[];
  /** 칸마다 지금 보이는 나사가 있는지 */
  shown: boolean[];
}

/** 놓을 자리 후보: 덮는 칸들과, 거기 놓으면 가려지는 나사 수 */
interface Spot {
  cells: number[];
  hides: number;
}

/**
 * 모양 하나를 범위 안에 놓을 수 있는 자리를 모두 찾는다.
 * 한 칸에 너무 많이 쌓이거나, 아래 판을 통째로 가려 버리는 자리는 뺀다(모든 판이 처음부터 조금은 보인다).
 */
function spotsFor(shape: Shape, layout: Layout, spec: StageSpec): Spot[] {
  const left = Math.floor((BOARD_COLS - spec.cols) / 2);
  const up = Math.floor((BOARD_ROWS - spec.rows) / 2);
  const width = Math.max(...shape.cells.map(([x]) => x)) + 1;
  const height = Math.max(...shape.cells.map(([, y]) => y)) + 1;
  const visible = layout.plates.map(() => 0);
  for (const plate of layout.top) if (plate >= 0) visible[plate] += 1;

  const spots: Spot[] = [];
  for (let row = up; row + height <= up + spec.rows; row += 1) {
    for (let col = left; col + width <= left + spec.cols; col += 1) {
      const cells = shape.cells.map(([x, y]) => cellAt(col + x, row + y));
      if (cells.some((cell) => layout.stack[cell] >= spec.stack)) continue;
      const lost = new Map<number, number>();
      for (const cell of cells) {
        const under = layout.top[cell];
        if (under >= 0) lost.set(under, (lost.get(under) ?? 0) + 1);
      }
      if ([...lost].some(([plate, count]) => count >= visible[plate])) continue;
      const hides = cells.filter((cell) => layout.shown[cell]).length;
      if (hides <= spec.hideLimit) spots.push({ cells, hides });
    }
  }
  return spots;
}

/** 판에 나사를 박을 칸을 고른다. 끝과 모서리(이웃한 칸이 적은 칸)부터 박는다. */
function pegCells(cells: readonly number[], count: number, random: () => number): number[] {
  const neighbours = (cell: number): number => {
    const { col, row } = cellPosition(cell);
    return cells.filter((other) => {
      const at = cellPosition(other);
      return Math.abs(at.col - col) + Math.abs(at.row - row) === 1;
    }).length;
  };
  return shuffle([...cells], random)
    .map((cell) => ({ cell, neighbours: neighbours(cell) }))
    .sort((a, b) => a.neighbours - b.neighbours)
    .slice(0, count)
    .map((item) => item.cell);
}

/**
 * 남은 나사 수에 맞춰 이 판에 박을 나사 수를 고른다. 맞출 수 없으면 0.
 * 나사가 하나만 남으면 판을 만들 수 없으므로 그렇게 남기지 않는다.
 */
function pegCount(shape: Shape, left: number, random: () => number): number {
  const options: number[] = [];
  for (let count = shape.minScrews; count <= Math.min(shape.maxScrews, left); count += 1) {
    if (left - count !== 1) options.push(count);
  }
  return options.length > 0 ? pickOne(options, random) : 0;
}

/** 판 하나를 맨 위에 올리고, 거기 박은 나사 수를 돌려준다. 놓을 자리가 없으면 0. */
function addPlate(layout: Layout, spec: StageSpec, left: number, random: () => number): number {
  for (let attempt = 0; attempt < SHAPE_TRIES; attempt += 1) {
    const shape = pickShape(random);
    const count = pegCount(shape, left, random);
    if (count === 0) continue;
    const spots = spotsFor(shape, layout, spec);
    const covering = spots.filter((spot) => spot.hides > 0);
    const clear = spots.filter((spot) => spot.hides === 0);
    const wantCover = random() < spec.cover;
    const pool = wantCover && covering.length > 0 ? covering : clear.length > 0 ? clear : covering;
    if (pool.length === 0) continue;

    const { cells } = pickOne(pool, random);
    const plate = layout.plates.length;
    layout.plates.push(cells);
    for (const cell of cells) {
      layout.stack[cell] += 1;
      layout.top[cell] = plate;
      layout.shown[cell] = false;
    }
    for (const cell of pegCells(cells, count, random)) {
      layout.pegs.push({ plate, cell });
      layout.shown[cell] = true;
    }
    return count;
  }
  return 0;
}

/** 판을 아래에서부터 하나씩 올려 나사 수를 딱 맞춘다. 자리가 모자라 실패하면 null. */
function layOut(spec: StageSpec, random: () => number): Layout | null {
  const cells = BOARD_COLS * BOARD_ROWS;
  const layout: Layout = {
    plates: [],
    pegs: [],
    stack: Array<number>(cells).fill(0),
    top: Array<number>(cells).fill(-1),
    shown: Array<boolean>(cells).fill(false),
  };
  let left = spec.screws;
  while (left > 0) {
    const added = addPlate(layout, spec, left, random);
    if (added === 0) return null;
    left -= added;
  }
  return layout;
}

/**
 * 반드시 만들어지는 배치: 나사 셋짜리 가로 막대를 겹치지 않게 두 줄로 늘어놓는다.
 * 무작위 배치가 거듭 실패했을 때만 쓴다(실제로는 거의 일어나지 않는다).
 */
function fallbackLayout(spec: StageSpec): Pick<Layout, 'plates' | 'pegs'> {
  const plates: number[][] = [];
  const pegs: Peg[] = [];
  for (let index = 0; index * BOX_SIZE < spec.screws; index += 1) {
    const col = (index % 2) * 4;
    const row = Math.floor(index / 2);
    const cells = [cellAt(col, row), cellAt(col + 1, row), cellAt(col + 2, row)];
    plates.push(cells);
    for (const cell of cells) pegs.push({ plate: index, cell });
  }
  return { plates, pegs };
}

/** 가려진 것을 지키면서 나사를 모두 푸는 순서 하나를 무작위로 고른다. */
function removalOrder(stage: Stage, random: () => number): number[] {
  const inPlace = stage.screws.map(() => true);
  const order: number[] = [];
  for (let free = freeIn(stage, inPlace); free.length > 0; free = freeIn(stage, inPlace)) {
    const screw = pickOne(free, random);
    inPlace[screw] = false;
    order.push(screw);
  }
  return order;
}

/**
 * 상자가 나올 순서의 색을 정한다. 쓰는 색을 고르게 돌려 쓰되,
 * 바로 앞의 두 상자와는 다른 색을 골라서 같은 색 상자가 나란히 열리는 일을 줄인다.
 */
function boxColors(count: number, colors: number, random: () => number): number[] {
  const palette = shuffle(
    Array.from({ length: COLOR_COUNT }, (_, color) => color),
    random,
  ).slice(0, colors);
  const used = new Map<number, number>(palette.map((color) => [color, 0]));
  const queue: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const recent = queue.slice(-Math.min(2, colors - 1));
    const allowed = palette.filter((color) => !recent.includes(color));
    const fewest = Math.min(...allowed.map((color) => used.get(color) ?? 0));
    const color = pickOne(
      allowed.filter((candidate) => used.get(candidate) === fewest),
      random,
    );
    used.set(color, fewest + 1);
    queue.push(color);
  }
  return queue;
}

/** 두 나사의 색을 맞바꾼 단계 */
function swapColors(stage: Stage, a: number, b: number): Stage {
  const screws = stage.screws.map((screw, id) => {
    if (id === a) return { ...screw, color: stage.screws[b].color };
    if (id === b) return { ...screw, color: stage.screws[a].color };
    return screw;
  });
  return { ...stage, screws };
}

/**
 * 풀이 순서에서 가까이 있는 나사끼리 색을 맞바꿔서, 상자와 어긋난 색이 먼저 풀리게 만든다.
 * 바꿀 때마다 풀이가 여전히 있는지 확인한다: 찾아 둔 풀이가 쟁반 예산 안에서 그대로 통하면 그대로 두고,
 * 통하지 않으면 새 풀이를 찾아 바꿔 둔다. 풀이를 찾지 못한 맞바꿈은 되돌린다.
 */
function mixColors(stage: Stage, spec: StageSpec, random: () => number): Stage {
  let mixed = stage;
  for (let attempt = 0; attempt < spec.mixTries; attempt += 1) {
    const { solution } = mixed;
    const from = pick(solution.length, random);
    const to = from + 1 + pick(spec.mixReach, random);
    if (to >= solution.length) continue;
    if (mixed.screws[solution[from]].color === mixed.screws[solution[to]].color) continue;

    const candidate = swapColors(mixed, solution[from], solution[to]);
    const kept = replay(candidate, solution);
    if (kept.solved && kept.peakTray <= spec.trayBudget) {
      mixed = candidate;
      continue;
    }
    const found = solve(candidate, spec.trayBudget);
    if (found) mixed = { ...candidate, solution: found };
  }
  return mixed;
}

/**
 * 반드시 풀리는 단계 하나를 만든다.
 * 판과 나사를 놓고, 나사를 모두 푸는 순서를 하나 정한 다음, 그 순서대로 셋씩 같은 색을 칠하고
 * 상자도 그 순서로 줄 세운다(이대로면 쟁반 없이 풀린다). 끝으로 색을 섞어 쟁반이 필요하게 만든다.
 */
function draftStage(spec: StageSpec, random: () => number): Stage {
  let layout: Pick<Layout, 'plates' | 'pegs'> | null = null;
  for (let attempt = 0; attempt < LAYOUT_TRIES && !layout; attempt += 1) layout = layOut(spec, random);
  const { plates, pegs } = layout ?? fallbackLayout(spec);

  const blank: Stage = {
    plates: plates.map((cells) => ({ cells })),
    screws: pegs.map((peg) => ({ ...peg, color: 0 })),
    boxes: [],
    solution: [],
  };
  const solution = removalOrder(blank, random);
  const boxes = boxColors(spec.screws / BOX_SIZE, spec.colors, random);
  const colorOf = new Map(solution.map((screw, index) => [screw, boxes[Math.floor(index / BOX_SIZE)]]));
  const screws = blank.screws.map((screw, id) => ({ ...screw, color: colorOf.get(id) ?? 0 }));
  return mixColors({ ...blank, screws, boxes, solution }, spec, random);
}

/** 단계 후보 하나와, 그것이 바라는 어려움에 얼마나 맞는지. fit은 0이 가장 좋고 작을수록 나쁘다. */
export interface Candidate {
  stage: Stage;
  fit: number;
}

/**
 * 후보 하나를 만들어 여러 번 풀어 보고 점수를 매긴다.
 * 꼼꼼하게 풀어도 잘 안 풀리는(운에 달린) 단계는 크게 깎고,
 * 덤벙대며 풀었을 때 깨는 비율이 바라는 값에서 멀수록 깎는다.
 */
export function proposeFromSpec(spec: StageSpec, random: () => number): Candidate {
  const stage = draftStage(spec, random);
  const unfair = Math.max(0, spec.carefulFloor - carefulEase(stage, random));
  const off = Math.abs(carelessEase(stage, random) - spec.carelessTarget);
  return { stage, fit: -(2 * unfair + off) };
}

/** 두 후보 가운데 더 잘 맞는 쪽. current가 없으면 candidate. */
export function betterCandidate(current: Candidate | null, candidate: Candidate): Candidate {
  return current && current.fit >= candidate.fit ? current : candidate;
}

/** stage번째(1부터) 단계의 후보 하나. 화면은 쉬는 틈에 이것을 여러 번 불러 가장 나은 후보를 골라 둔다. */
export function proposeStage(stage: number, random: () => number): Candidate {
  return proposeFromSpec(stageSpec(stage), random);
}

/** 주어진 크기와 어려움의 단계를 만든다. 후보를 여러 개 만들어 가장 잘 맞는 것을 낸다. 언제나 풀 수 있다. */
export function buildFromSpec(spec: StageSpec, random: () => number, candidates = STAGE_CANDIDATES): Stage {
  let best = proposeFromSpec(spec, random);
  // 더 나아질 수 없는 후보가 나오면 그만 만든다(앞 단계는 대개 첫 후보에서 끝난다).
  for (let made = 1; made < candidates && best.fit < 0; made += 1) {
    best = betterCandidate(best, proposeFromSpec(spec, random));
  }
  return best.stage;
}

/** stage번째(1부터) 단계를 만든다. */
export function buildStage(stage: number, random: () => number): Stage {
  return buildFromSpec(stageSpec(stage), random);
}

// ───────── 단계 모드 ─────────

/**
 * 단계 모드가 거치는 난이도의 수. 나사와 판은 여덟째 난이도에서 다 커지고, 그 뒤로는 함정이 더 깊어진다.
 * 그보다 뒤의 난이도는 꼼꼼히 풀어도 운에 기대는 단계가 섞여서 쓰지 않는다.
 */
export const LEVEL_STEPS = 12;

/** 단계 모드의 level(1부터)번째 단계가 쓰는 난이도. stageSpec과 buildStage의 stage로 넘긴다. */
export function levelStage(level: number): number {
  return difficultyOf(level, LEVEL_STEPS);
}
