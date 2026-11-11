/**
 * 핀 뽑기의 규칙. 화면과 분리된 순수 함수라서 숫자만 바꿔 밸런스를 조정할 수 있다.
 * 물리 계산은 없다. 핀을 뽑으면 그 방에 든 것이 곧장 아래 칸으로 떨어지고, 닿은 칸에서 한 번 섞인다.
 */

// ───────── 판의 모양 ─────────

/** 방에 처음 들어 있는 것 */
export type Item = 'treasure' | 'lava' | 'water';

export const MIN_SHAFTS = 2;
export const MAX_SHAFTS = 4;
/** 통로 하나에 위아래로 놓이는 방의 최대 수 */
export const MAX_STACK = 2;
/** 핀의 최대 수(문 핀 포함). 뽑는 순서를 모두 따져도 720가지라서 풀이를 빠짐없이 셀 수 있다. */
export const MAX_PINS = 6;

export interface Puzzle {
  /** 통로마다, 위에서 아래 순서로 방에 든 것. 방마다 그 아래를 핀이 받치고 있다. */
  shafts: readonly (readonly Item[])[];
  /** 구덩이에 괴물이 있는지 */
  monster: boolean;
}

/** 방을 받치는 핀(level은 위에서부터 0)이거나, 용사의 방을 막은 문 핀 */
export type Pin = { kind: 'chamber'; shaft: number; level: number } | { kind: 'door' };

/** 떨어진 것이 닿는 곳 */
export type Place = { kind: 'chamber'; shaft: number; level: number } | { kind: 'pit' };

/** 한 칸(방이나 구덩이)에 들어 있는 것의 개수 */
export interface Contents {
  treasure: number;
  lava: number;
  water: number;
  /** 용암과 물이 만나 굳은 돌. 아무 일도 일으키지 않는다. */
  stone: number;
}

export interface Chamber {
  contents: Contents;
  /** 아래를 받치는 핀이 아직 꽂혀 있는지 */
  pinned: boolean;
}

export type Status = 'playing' | 'won' | 'lost';
/** 진 까닭: 보물이 탐, 용사가 용암에 닿음, 용사가 괴물을 만남 */
export type LossCause = 'burnt' | 'lava' | 'monster';

export interface PuzzleState {
  shafts: readonly (readonly Chamber[])[];
  pit: Contents;
  /** 구덩이에 괴물이 살아 있는지 */
  monster: boolean;
  /** 용사가 있는 곳. 문 핀을 뽑으면 구덩이로 간다. */
  hero: 'room' | 'pit';
  status: Status;
  lossCause: LossCause | null;
}

const NOTHING: Contents = { treasure: 0, lava: 0, water: 0, stone: 0 };

/** 모든 핀. 통로 순서, 그 안에서는 위에서 아래 순서이고 문 핀이 맨 끝이다. */
export function pinsOf(puzzle: Puzzle): Pin[] {
  const pins: Pin[] = [];
  puzzle.shafts.forEach((chambers, shaft) => {
    chambers.forEach((_, level) => pins.push({ kind: 'chamber', shaft, level }));
  });
  pins.push({ kind: 'door' });
  return pins;
}

export function samePin(a: Pin, b: Pin): boolean {
  if (a.kind === 'door' || b.kind === 'door') return a.kind === b.kind;
  return a.shaft === b.shaft && a.level === b.level;
}

export function samePuzzle(a: Puzzle, b: Puzzle): boolean {
  return (
    a.monster === b.monster &&
    a.shafts.length === b.shafts.length &&
    a.shafts.every((chambers, shaft) => chambers.join() === b.shafts[shaft].join())
  );
}

/** 아무 핀도 뽑지 않은 처음 상태 */
export function startPuzzle(puzzle: Puzzle): PuzzleState {
  return {
    shafts: puzzle.shafts.map((chambers) =>
      chambers.map((item) => ({ contents: { ...NOTHING, [item]: 1 }, pinned: true })),
    ),
    pit: NOTHING,
    monster: puzzle.monster,
    hero: 'room',
    status: 'playing',
    lossCause: null,
  };
}

/** 그 핀이 아직 꽂혀 있는지 */
export function isPinned(state: PuzzleState, pin: Pin): boolean {
  if (pin.kind === 'door') return state.hero === 'room';
  return state.shafts[pin.shaft]?.[pin.level]?.pinned ?? false;
}

/** 아직 꽂혀 있는 핀 */
export function remainingPins(state: PuzzleState): Pin[] {
  const pins: Pin[] = [];
  state.shafts.forEach((chambers, shaft) => {
    chambers.forEach((chamber, level) => {
      if (chamber.pinned) pins.push({ kind: 'chamber', shaft, level });
    });
  });
  if (state.hero === 'room') pins.push({ kind: 'door' });
  return pins;
}

// ───────── 핀 뽑기 ─────────

export interface PullResult {
  state: PuzzleState;
  /** 핀이 뽑혔는지. 이미 뽑힌 핀이거나 판이 끝난 뒤라면 false이고 상태는 그대로다. */
  pulled: boolean;
  /** 방에서 떨어진 것과 닿은 곳. 문 핀을 뽑았으면 null */
  fall: { contents: Contents; to: Place } | null;
  /** 닿은 칸에서 물과 만나 돌이 된 용암의 수 */
  cooled: number;
  /** 구덩이의 괴물이 용암에 사라졌는지 */
  slain: boolean;
}

function add(a: Contents, b: Contents): Contents {
  return {
    treasure: a.treasure + b.treasure,
    lava: a.lava + b.lava,
    water: a.water + b.water,
    stone: a.stone + b.stone,
  };
}

/**
 * 한 칸에 모인 것을 섞는다. 용암과 물은 하나씩 짝지어 돌이 되고, 그러고도 용암이 남으면 보물이 탄다.
 * 물이 먼저 용암을 식히므로, 물이 넉넉한 칸에서는 용암이 아무것도 해치지 못한다.
 */
function mix(contents: Contents): { contents: Contents; cooled: number; burnt: boolean } {
  const cooled = Math.min(contents.lava, contents.water);
  const lava = contents.lava - cooled;
  const burnt = lava > 0 && contents.treasure > 0;
  return {
    contents: {
      treasure: burnt ? 0 : contents.treasure,
      lava,
      water: contents.water - cooled,
      stone: contents.stone + cooled,
    },
    cooled,
    burnt,
  };
}

/**
 * 구덩이에 새로 무언가(떨어진 것이나 용사)가 들어온 뒤의 상태를 정한다.
 * 섞고 남은 용암은 괴물을 없애고 그대로 남는다. 용사는 용암이나 괴물과 함께 있으면 지고,
 * 위험한 것 없이 보물과 함께 있으면 이긴다. 그 밖에는 구덩이에서 기다린다.
 */
function settlePit(
  state: PuzzleState,
  arrived: Contents,
  hero: 'room' | 'pit',
): { state: PuzzleState; cooled: number; slain: boolean } {
  const mixed = mix(add(state.pit, arrived));
  const pit = mixed.contents;
  const slain = state.monster && pit.lava > 0;
  const monster = state.monster && !slain;

  let status: Status = 'playing';
  let lossCause: LossCause | null = null;
  if (mixed.burnt) [status, lossCause] = ['lost', 'burnt'];
  else if (hero === 'pit' && pit.lava > 0) [status, lossCause] = ['lost', 'lava'];
  else if (hero === 'pit' && monster) [status, lossCause] = ['lost', 'monster'];
  else if (hero === 'pit' && pit.treasure > 0) status = 'won';

  return {
    state: { ...state, pit, monster, hero, status, lossCause },
    cooled: mixed.cooled,
    slain,
  };
}

/** 그 방에서 떨어진 것이 닿는 곳: 바로 아래에 핀이 꽂힌 방이 있으면 그 방, 없으면 구덩이 */
function landingOf(state: PuzzleState, shaft: number, level: number): Place {
  const chambers = state.shafts[shaft];
  for (let below = level + 1; below < chambers.length; below += 1) {
    if (chambers[below].pinned) return { kind: 'chamber', shaft, level: below };
  }
  return { kind: 'pit' };
}

/**
 * 핀 하나를 뽑는다. 받은 상태는 바꾸지 않고 새 상태를 돌려준다.
 * 방의 핀이면 든 것이 아래로 떨어져 닿은 칸에서 섞이고, 문 핀이면 용사가 구덩이로 들어간다.
 */
export function pull(state: PuzzleState, pin: Pin): PullResult {
  if (state.status !== 'playing' || !isPinned(state, pin)) {
    return { state, pulled: false, fall: null, cooled: 0, slain: false };
  }

  if (pin.kind === 'door') {
    return { ...settlePit(state, NOTHING, 'pit'), pulled: true, fall: null };
  }

  const falling = state.shafts[pin.shaft][pin.level].contents;
  const to = landingOf(state, pin.shaft, pin.level);
  const emptied = state.shafts.map((chambers, shaft) =>
    shaft !== pin.shaft
      ? chambers
      : chambers.map((chamber, level) =>
          level === pin.level ? { contents: NOTHING, pinned: false } : chamber,
        ),
  );
  const fall = { contents: falling, to };

  if (to.kind === 'pit') {
    return { ...settlePit({ ...state, shafts: emptied }, falling, state.hero), pulled: true, fall };
  }

  const mixed = mix(add(emptied[to.shaft][to.level].contents, falling));
  const shafts = emptied.map((chambers, shaft) =>
    shaft !== to.shaft
      ? chambers
      : chambers.map((chamber, level) =>
          level === to.level ? { contents: mixed.contents, pinned: true } : chamber,
        ),
  );
  return {
    state: {
      ...state,
      shafts,
      status: mixed.burnt ? 'lost' : 'playing',
      lossCause: mixed.burnt ? 'burnt' : null,
    },
    pulled: true,
    fall,
    cooled: mixed.cooled,
    slain: false,
  };
}

// ───────── 풀이 ─────────

export interface Solution {
  /** 남은 핀을 모두 뽑는 순서의 수(핀 수의 계승) */
  orders: number;
  /** 그 가운데 보물을 얻는 순서의 수. 도중에 이기면 남은 핀의 순서는 모두 이긴 것으로 센다. */
  winning: number;
  /** 보물을 얻는 가장 짧은 순서. 얻을 길이 없으면 null */
  shortest: readonly Pin[] | null;
}

function factorial(n: number): number {
  let product = 1;
  for (let i = 2; i <= n; i += 1) product *= i;
  return product;
}

/**
 * 지금 상태에서 남은 핀을 뽑는 순서를 빠짐없이 따져 본다.
 * 핀을 다 뽑으면 모든 것이 구덩이에 모이므로, 어느 순서든 이기거나 지는 것으로 끝난다.
 */
export function solveFrom(state: PuzzleState): Solution {
  let winning = 0;
  let shortest: Pin[] | null = null;

  const visit = (current: PuzzleState, path: Pin[]): void => {
    const pins = remainingPins(current);
    if (current.status === 'won') {
      winning += factorial(pins.length);
      if (!shortest || path.length < shortest.length) shortest = [...path];
      return;
    }
    if (current.status === 'lost') return;
    for (const pin of pins) {
      path.push(pin);
      visit(pull(current, pin).state, path);
      path.pop();
    }
  };
  visit(state, []);

  return { orders: factorial(remainingPins(state).length), winning, shortest };
}

export function solve(puzzle: Puzzle): Solution {
  return solveFrom(startPuzzle(puzzle));
}

/**
 * 핀을 limit개까지만 뽑아서 이길 수 있는지. 순서를 모두 세는 것보다 훨씬 빨라서,
 * 판을 만들 때 너무 짧게 풀리는 판을 먼저 걸러 내는 데 쓴다.
 */
export function canWinWithin(state: PuzzleState, limit: number): boolean {
  if (state.status === 'won') return true;
  if (state.status === 'lost' || limit <= 0) return false;
  return remainingPins(state).some((pin) => canWinWithin(pull(state, pin).state, limit - 1));
}

/** 아무렇게나 뽑았을 때 이길 확률(0~1). 낮을수록 순서를 따져야 하는 판이다. */
export function winShare(solution: Solution): number {
  return solution.winning / solution.orders;
}

// ───────── 단계와 판 만들기 ─────────

export interface StageSpec {
  /** 핀의 수(문 핀 포함) */
  pins: number;
  /** 위아래로 놓인 방이 나올 수 있는지 */
  stacked: boolean;
  /** 구덩이에 괴물이 있을 확률 */
  monsterChance: number;
  /** 이기는 가장 짧은 순서가 적어도 이만큼은 길어야 한다. 4면 용암을 식혀야만 풀리는 판이다. */
  minPulls: number;
  /** 이기는 순서의 비율이 이보다 높으면 너무 쉬운 판이라 쓰지 않는다 */
  maxWinShare: number;
}

/**
 * 단계별 판의 조건. 핀이 늘고, 위아래로 놓인 방과 괴물이 차례로 나오고,
 * 아무렇게나 뽑아서 이길 확률은 낮아진다. 마지막 줄이 그 뒤의 모든 단계에 쓰인다.
 */
export const STAGES: readonly StageSpec[] = [
  { pins: 3, stacked: false, monsterChance: 0, minPulls: 2, maxWinShare: 0.34 },
  { pins: 4, stacked: true, monsterChance: 0, minPulls: 2, maxWinShare: 0.34 },
  { pins: 5, stacked: true, monsterChance: 0, minPulls: 2, maxWinShare: 0.25 },
  { pins: 5, stacked: true, monsterChance: 0, minPulls: 4, maxWinShare: 0.25 },
  { pins: 5, stacked: true, monsterChance: 1, minPulls: 4, maxWinShare: 0.1 },
  { pins: 6, stacked: true, monsterChance: 0.7, minPulls: 4, maxWinShare: 0.1 },
  { pins: 6, stacked: true, monsterChance: 0.7, minPulls: 4, maxWinShare: 0.05 },
];

/** stage(1부터)의 조건 */
export function stageSpec(stage: number): StageSpec {
  const index = Math.min(STAGES.length, Math.max(1, Math.floor(stage))) - 1;
  return STAGES[index];
}

/** 보물이 아닌 방에 용암이 들어갈 확률. 나머지는 물이다. */
export const LAVA_CHANCE = 0.5;
/** 조건에 맞는 판이 나올 때까지 다시 만들어 보는 횟수 */
export const MAX_ATTEMPTS = 1000;
/**
 * 끝내 조건에 맞는 판을 만들지 못했을 때 내는 판: 보물 하나와 용암 하나.
 * 가장 까다로운 단계도 스무 번에 한 번은 맞는 판이 나와서 실제로 쓰일 일은 없다.
 */
export const FALLBACK_PUZZLE: Puzzle = { shafts: [['treasure'], ['lava']], monster: false };

/**
 * 방 count개를 통로에 나눠 담는 모든 방법. 돌려주는 배열은 통로마다의 방 수다.
 * stacked가 false면 통로마다 방이 하나씩만 놓인다.
 */
export function shaftShapes(count: number, stacked: boolean): number[][] {
  const shapes: number[][] = [];
  const extend = (shape: number[], left: number): void => {
    if (left === 0) {
      if (shape.length >= MIN_SHAFTS) shapes.push(shape);
      return;
    }
    if (shape.length === MAX_SHAFTS) return;
    for (let size = 1; size <= (stacked ? MAX_STACK : 1) && size <= left; size += 1) {
      extend([...shape, size], left - size);
    }
  };
  extend([], count);
  return shapes;
}

/** 조건의 겉모양(핀 수, 쌓인 방)만 맞춰 방을 아무렇게나 채운다. 풀리는지는 따지지 않는다. */
function randomShafts(spec: StageSpec, random: () => number): Item[][] {
  const count = spec.pins - 1;
  const shapes = shaftShapes(count, spec.stacked);
  const shape = shapes[Math.floor(random() * shapes.length)];
  const treasureAt = Math.floor(random() * count);

  let index = 0;
  return shape.map((size) =>
    Array.from({ length: size }, (): Item => {
      const item = index === treasureAt ? 'treasure' : random() < LAVA_CHANCE ? 'lava' : 'water';
      index += 1;
      return item;
    }),
  );
}

/** 풀어 본 결과가 그 단계의 조건에 맞는지: 이길 수도 질 수도 있고, 충분히 길고, 충분히 까다롭다. */
export function fitsStage(spec: StageSpec, solution: Solution): boolean {
  if (!solution.shortest || solution.winning === solution.orders) return false;
  return solution.shortest.length >= spec.minPulls && winShare(solution) <= spec.maxWinShare;
}

/**
 * stage(1부터)에 맞는 판을 만든다. 아무렇게나 만든 판을 빠짐없이 풀어 보고 조건에 맞는 것만 낸다.
 * random은 0 이상 1 미만의 수를 돌려주는 함수(Math.random과 같은 모양).
 * avoid를 주면 그것과 다른 판을 낸다. 같은 단계를 다시 할 때 방금 그 판이 또 나오지 않게 한다.
 */
export function generatePuzzle(stage: number, random: () => number, avoid?: Puzzle): Puzzle {
  const spec = stageSpec(stage);
  // 괴물이 있는 판이 조건에 맞기 쉬워서, 괴물부터 정해 두어야 정한 확률대로 나온다.
  const monster = random() < spec.monsterChance;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const puzzle: Puzzle = { shafts: randomShafts(spec, random), monster };
    if (avoid && samePuzzle(puzzle, avoid)) continue;
    // 버려지는 판은 대부분 너무 짧게 풀리는 판이라서, 그것부터 싸게 걸러 낸다.
    if (canWinWithin(startPuzzle(puzzle), spec.minPulls - 1)) continue;
    if (fitsStage(spec, solve(puzzle))) return puzzle;
  }
  return FALLBACK_PUZZLE;
}

// ───────── 한 판의 흐름: 목숨, 시간, 점수 ─────────

export const START_HEARTS = 3;
/** 첫 단계의 제한 시간(초) */
export const FIRST_SECONDS = 15;
/** 단계가 아무리 올라도 이보다 짧아지지는 않는다(초). 판을 읽고 핀 네 개를 뽑기에 빠듯한 시간이다. */
export const MIN_SECONDS = 5;
/**
 * 한 단계 오를 때마다 남은 여유(제한 시간 - 가장 짧은 시간)가 이 비율로 줄어든다.
 * 처음에는 빨리, 갈수록 천천히 줄어서 10단계에 10초, 16단계쯤에 8초 남짓이 된다.
 */
export const SECONDS_DECAY = 0.93;

/** stage(1부터)의 판 하나에 주어지는 시간(초). 떨어지는 동안과 판이 바뀌는 동안에는 흐르지 않는다. */
export function puzzleSeconds(stage: number): number {
  const steps = Math.max(1, Math.floor(stage)) - 1;
  return MIN_SECONDS + (FIRST_SECONDS - MIN_SECONDS) * SECONDS_DECAY ** steps;
}

export const BASE_POINTS = 10;
/** 한 단계 오를 때마다 늘어나는 기본 점수 */
export const STAGE_POINTS = 2;
/** 이 단계부터는 기본 점수가 더 늘지 않는다. 오래 버틴 판의 점수가 끝없이 불어나지 않게 한다. */
export const TOP_POINT_STAGE = 11;

/** stage(1부터)의 판을 깼을 때의 기본 점수 */
export function stagePoints(stage: number): number {
  const steps = Math.min(TOP_POINT_STAGE, Math.max(1, Math.floor(stage))) - 1;
  return BASE_POINTS + STAGE_POINTS * steps;
}

/** 남긴 시간 1초마다 1점. 소수점 아래는 버린다. */
export function timeBonus(secondsLeft: number): number {
  return Math.max(0, Math.floor(secondsLeft));
}

/** 판을 깼을 때 받는 점수: 단계의 기본 점수에 남긴 시간만큼 더한다. */
export function winPoints(stage: number, secondsLeft: number): number {
  return stagePoints(stage) + timeBonus(secondsLeft);
}
