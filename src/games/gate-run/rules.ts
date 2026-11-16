/**
 * 관문 달리기의 규칙. 화면과 분리된 순수 함수라서 숫자만 바꿔 밸런스를 조정할 수 있다.
 * 길이는 논리 픽셀, 시간은 초다. 가로 위치는 화면 왼쪽 끝이 0이다.
 *
 * 길은 "구간"이 끝없이 이어진 것이다. 한 구간은 관문 줄 두세 개와 그 뒤의 적 한 무리로 되어 있다.
 * 더 좋은 관문만 골랐을 때의 무리 수(ideal)를 따라가며 적의 수를 정하므로,
 * 늘 잘 고르면 반드시 뚫을 수 있고 잘못 고른 것은 쌓여서 언젠가 무리가 바닥난다.
 */

// ───────── 무리 ─────────

/** 처음 무리의 수 */
export const START_CROWD = 5;
/** 무리의 수는 세 자리까지만 보여 준다. 어떤 관문을 지나도 이 수를 넘지 않는다. */
export const MAX_CROWD = 999;

// ───────── 길과 조종 ─────────

export const ROAD_LEFT = 16;
export const ROAD_RIGHT = 224;
/** 두 관문이 맞닿는 가운데 선 */
export const ROAD_CENTER = (ROAD_LEFT + ROAD_RIGHT) / 2;
/** 무리의 중심은 길 가장자리에서 이만큼 떨어져 있어야 한다. 무리가 길 밖으로 삐져나가지 않게 한다. */
export const ROAD_MARGIN = 31;

export type Side = 'left' | 'right';

/** 가로 위치 x가 어느 쪽 관문 아래인지. 딱 가운데 선은 오른쪽으로 친다. */
export function sideAt(x: number): Side {
  return x < ROAD_CENTER ? 'left' : 'right';
}

/** 한쪽 관문의 가운데 가로 위치 */
export function laneCenter(side: Side): number {
  return side === 'left' ? (ROAD_LEFT + ROAD_CENTER) / 2 : (ROAD_CENTER + ROAD_RIGHT) / 2;
}

/** 무리의 중심이 있을 수 있는 범위 안으로 x를 맞춘다. */
export function clampToRoad(x: number): number {
  return Math.min(ROAD_RIGHT - ROAD_MARGIN, Math.max(ROAD_LEFT + ROAD_MARGIN, x));
}

/** 무리가 손가락을 따라붙는 빠르기. 0.2초쯤이면 반대쪽 관문까지 거의 다 간다. */
export const STEER_RATE = 14;

/** dt초 뒤 무리의 가로 위치. 가려는 곳(target)에 가까워질수록 느려져서 부드럽게 멈춘다. */
export function steer(x: number, target: number, dt: number): number {
  const goal = clampToRoad(target);
  return goal + (x - goal) * Math.exp(-STEER_RATE * Math.max(0, dt));
}

// ───────── 속도 ─────────

export const START_SPEED = 72;
export const MAX_SPEED = 150;
/** 구간을 하나 지날 때마다 빨라지는 정도(px/s). 30구간에 MAX_SPEED에 닿는다. */
const SPEED_GAIN = 2.6;
/** MAX_SPEED에 닿은 뒤로도 구간마다 조금씩 더 빨라진다. 오래 버틴 판이 한 난이도에 머물지 않게 한다. */
export const LATE_SPEED_GAIN = 0.5;
/** 아무리 오래 달려도 이보다 빨라지지는 않는다. 관문 줄 하나를 0.8초쯤에 지나는 속도다. */
export const TOP_SPEED = 180;

/** 길이 흘러내리는 속도(px/s). segment는 지금 달리는 구간 번호(0부터). */
export function scrollSpeed(segment: number): number {
  const at = Math.max(0, segment);
  const early = START_SPEED + SPEED_GAIN * at;
  if (early <= MAX_SPEED) return early;
  const knee = (MAX_SPEED - START_SPEED) / SPEED_GAIN;
  return Math.min(TOP_SPEED, MAX_SPEED + LATE_SPEED_GAIN * (at - knee));
}

/** 줄(관문 줄, 적)과 다음 줄 사이의 거리. 처음에는 한 줄에 2초쯤, 가장 빠를 때는 1초쯤 걸린다. */
export const ROW_GAP = 140;

// ───────── 관문 ─────────

/** add: 더하기, sub: 빼기, mul: 곱하기, div: 나누기 */
export type GateKind = 'add' | 'sub' | 'mul' | 'div';

export interface Gate {
  kind: GateKind;
  /** 더하거나 빼는 수, 또는 곱하거나 나누는 수. 1 이상의 정수. */
  value: number;
}

export interface GatePair {
  left: Gate;
  right: Gate;
}

const GATE_SIGN: Readonly<Record<GateKind, string>> = { add: '+', sub: '-', mul: 'x', div: '÷' };

/** 관문에 적는 글자. 예: +8, -5, x2, ÷2 */
export function gateLabel(gate: Gate): string {
  return `${GATE_SIGN[gate.kind]}${gate.value}`;
}

/** 무리를 불리는 관문인지. 화면에서 좋은 관문과 나쁜 관문의 색을 가른다. */
export function isBoost(gate: Gate): boolean {
  return gate.kind === 'add' || gate.kind === 'mul';
}

/**
 * 관문을 지난 뒤의 무리 수. 0 아래로 내려가지 않고 MAX_CROWD를 넘지 않는다.
 * 나누기는 올림이라서, 나누기만으로 무리가 사라지지는 않는다.
 */
export function applyGate(crowd: number, gate: Gate): number {
  const count = Math.max(0, crowd);
  switch (gate.kind) {
    case 'add':
      return Math.min(MAX_CROWD, count + gate.value);
    case 'sub':
      return Math.max(0, count - gate.value);
    case 'mul':
      return Math.min(MAX_CROWD, count * gate.value);
    case 'div':
      return Math.ceil(count / gate.value);
  }
}

/** 지금 무리 수에서 더 많이 남는 쪽. 같으면 왼쪽. */
export function betterSide(crowd: number, pair: GatePair): Side {
  return applyGate(crowd, pair.right) > applyGate(crowd, pair.left) ? 'right' : 'left';
}

// ───────── 난이도 ─────────

/** 적의 수를 정하는 비율: 가장 잘 고른 무리의 이만큼이 적으로 나온다. */
export const RATIO_START = 0.4;
export const RATIO_MAX = 0.85;
/** 이 구간에서 비율이 RATIO_MAX에 닿는다. */
export const RATIO_FULL_SEGMENT = 30;
/** 1보다 크면 처음에는 천천히, 뒤로 갈수록 가파르게 오른다. 초반의 실수 한 번은 봐주려는 것이다. */
const RATIO_CURVE = 1.5;
/** RATIO_MAX에 닿은 뒤로도 구간마다 조금씩 더 오른다. */
export const LATE_RATIO_GAIN = 0.0025;
/** 아무리 오래 달려도 비율은 이보다 커지지 않는다. 가장 잘 고르면 언제나 몇 마리는 남는다. */
export const RATIO_TOP = 0.92;

export function enemyRatio(segment: number): number {
  const at = Math.max(0, segment);
  if (at > RATIO_FULL_SEGMENT) {
    return Math.min(RATIO_TOP, RATIO_MAX + LATE_RATIO_GAIN * (at - RATIO_FULL_SEGMENT));
  }
  const progress = at / RATIO_FULL_SEGMENT;
  return RATIO_START + (RATIO_MAX - RATIO_START) * progress ** RATIO_CURVE;
}

/**
 * 구간 끝에 서 있는 적의 수. ideal은 가장 좋은 관문만 골랐을 때 적 앞에 선 무리 수(2 이상).
 * 언제나 ideal보다 적어서, 잘 고르기만 하면 한 마리는 남는다.
 */
export function enemiesFor(ideal: number, segment: number): number {
  const wanted = Math.round(ideal * enemyRatio(segment));
  return Math.max(1, Math.min(ideal - 1, wanted));
}

/** 첫 구간은 관문 줄이 둘뿐이다. 조작을 익히자마자 첫 적을 만난다. */
export const FIRST_SEGMENT_ROWS = 2;

/** 구간에 들어가는 관문 줄 수. 첫 구간 뒤로는 둘 아니면 셋이다. */
export function rowsIn(segment: number, roll: number): number {
  if (segment <= 0) return FIRST_SEGMENT_ROWS;
  return roll < 0.5 ? 2 : 3;
}

/**
 * 적을 만나기 직전에 무리가 이르기를 바라는 크기.
 * 관문은 이 크기를 향해 무리를 불려 주므로, 수가 끝없이 커지지 않고 읽기 쉬운 범위에 머문다.
 */
export const TARGET_START = 12;
export const TARGET_MAX = 160;
const TARGET_GAIN = 8;

export function wallTarget(segment: number): number {
  return Math.min(TARGET_MAX, TARGET_START + TARGET_GAIN * Math.max(0, segment));
}

/** clear: 한쪽이 뻔히 낫다, arith: 셈을 해 봐야 안다, evil: 둘 다 나빠서 덜 나쁜 쪽을 고른다 */
export type PairKind = 'clear' | 'arith' | 'evil';

const ARITH_SHARE_GAIN = 0.1;
const ARITH_SHARE_MAX = 0.7;
const EVIL_SHARE_GAIN = 0.03;
const EVIL_SHARE_MAX = 0.15;

/**
 * 구간마다 관문 쌍의 종류가 섞이는 비율. 갈수록 셈이 필요한 쌍과 둘 다 나쁜 쌍이 늘어난다.
 * 셈이 필요한 쌍은 곱하기가 끼므로, 무리가 두 배쯤 불어나도 되는 줄에서만 나온다.
 */
export function pairMix(segment: number): Readonly<Record<PairKind, number>> {
  const index = Math.max(0, segment);
  const arith = Math.min(ARITH_SHARE_MAX, ARITH_SHARE_GAIN * index);
  const evil = Math.min(EVIL_SHARE_MAX, EVIL_SHARE_GAIN * Math.max(0, index - 2));
  return { clear: 1 - arith - evil, arith, evil };
}

/** 이 구간쯤이면 나쁜 관문이 가장 독해진다. */
const HARSH_SEGMENT = 16;

/** 나쁜 관문이 얼마나 독한지(0~1). 처음에는 조금만 깎고 갈수록 많이 깎는다. */
function harshness(segment: number): number {
  return Math.min(1, Math.max(0, segment) / HARSH_SEGMENT);
}

// ───────── 관문 만들기 ─────────

/** 한 줄에서 바라는 배수의 상한. x3보다 큰 곱하기는 내지 않는다. */
const MAX_GROWTH = 3;
/** 좋은 관문이라면 적어도 이만큼은 불려 준다. */
const MIN_GROWTH = 1.12;
/** 바라는 배수를 줄마다 이 범위에서 흔들어, 같은 구간이라도 관문이 매번 달라지게 한다. */
const GROWTH_JITTER = [0.85, 1.25] as const;
/** 바라는 배수가 이보다 크면 곱하기 관문을 낼 수 있다. */
const MUL_MIN_GROWTH = 1.6;
/** 무리가 목표보다 훌쩍 커서 바라는 배수가 이보다 작으면, 둘 다 나쁜 쌍으로 덜어 낸다. */
const SHRINK_BELOW = 0.8;
/** 무리가 이보다 적으면 둘 다 나쁜 쌍을 내지 않는다. 깎을 것이 없으면 재미도 없다. */
const EVIL_MIN_CROWD = 10;

/** 더 좋은 관문(best)과 나쁜 관문(worse). 좌우는 나중에 정한다. */
interface Ranked {
  best: Gate;
  worse: Gate;
}

const between = (low: number, high: number, random: () => number): number =>
  low + (high - low) * random();

/** 무리를 growth배쯤으로 불리는 관문. 배수가 크면 곱하기도 섞는다. */
function boostGate(ideal: number, growth: number, random: () => number): Gate {
  if (growth >= MUL_MIN_GROWTH && random() < 0.5) {
    return { kind: 'mul', value: growth >= 2.5 ? 3 : 2 };
  }
  return { kind: 'add', value: Math.max(1, Math.round(ideal * (growth - 1))) };
}

/** 한쪽이 뻔히 나은 쌍: 불리는 관문 옆에 깎는 관문이나 훨씬 작은 더하기를 둔다. */
function clearPair(ideal: number, growth: number, segment: number, random: () => number): Ranked {
  const best = boostGate(ideal, growth, random);
  const harsh = harshness(segment);
  const roll = random();
  const gain = applyGate(ideal, best) - ideal;

  // 곱하기 옆의 더하기는 셈이 필요하므로, 더하기끼리일 때만 작은 더하기를 둔다.
  // 첫 구간에서는 나쁜 관문의 색부터 익히도록 언제나 깎는 관문을 둔다.
  if (best.kind === 'add' && roll < 0.45 && gain >= 2 && segment >= 1) {
    const weak = Math.round(gain * between(0.3 - 0.15 * harsh, 0.6 - 0.15 * harsh, random));
    return { best, worse: { kind: 'add', value: Math.min(gain - 1, Math.max(1, weak)) } };
  }
  if (roll < 0.6 && segment >= 1 && ideal >= 4) {
    return { best, worse: { kind: 'div', value: random() < 0.4 * harsh ? 3 : 2 } };
  }
  if (ideal >= 2) {
    const cut = Math.round(ideal * between(0.15 + 0.15 * harsh, 0.3 + 0.3 * harsh, random));
    return { best, worse: { kind: 'sub', value: Math.min(ideal - 1, Math.max(1, cut)) } };
  }
  // 한 마리뿐이면 빼기는 곧 끝이라서, 나누기로 제자리걸음을 시킨다.
  return { best, worse: { kind: 'div', value: 2 } };
}

/**
 * 셈을 해 봐야 아는 쌍: 곱하기와 더하기. 어느 쪽이 나은지는 지금 무리 수에 달려 있다.
 * 무리가 너무 적어 두 결과를 다르게 만들 수 없으면 null.
 */
function arithPair(ideal: number, growth: number, segment: number, random: () => number): Ranked | null {
  const harsh = harshness(segment);
  // 나쁜 쪽의 결과가 좋은 쪽의 몇 할인지. 갈수록 1에 가까워져 가려내기 어려워진다.
  const closeness = between(0.6 + 0.15 * harsh, 0.8 + 0.12 * harsh, random);

  if (random() < 0.5) {
    const factor = growth >= 2.5 ? 3 : 2;
    const product = ideal * factor;
    const add = Math.min(product - ideal - 1, Math.round(product * closeness) - ideal);
    if (add < 1) return null;
    return { best: { kind: 'mul', value: factor }, worse: { kind: 'add', value: add } };
  }
  const product = ideal * 2;
  const add = Math.max(product - ideal + 1, Math.round(product / closeness) - ideal);
  return { best: { kind: 'add', value: add }, worse: { kind: 'mul', value: 2 } };
}

/**
 * 둘 다 나쁜 쌍: 덜 깎이는 쪽을 골라야 한다. ideal은 EVIL_MIN_CROWD 이상.
 * deep이면 무리가 너무 커진 것이라 좋은 쪽도 절반을 깎는다.
 */
function evilPair(ideal: number, deep: boolean, random: () => number): Ranked {
  const halved = Math.ceil(ideal / 2);
  const roll = random();

  if (deep || roll < 0.3) {
    if (random() < 0.3) return { best: { kind: 'div', value: 2 }, worse: { kind: 'div', value: 3 } };
    // 절반보다 더 깎는 빼기. 반으로 나누는 쪽이 낫다.
    const cut = Math.round(ideal * between(0.6, 0.8, random));
    const value = Math.min(ideal - 1, Math.max(ideal - halved + 1, cut));
    return { best: { kind: 'div', value: 2 }, worse: { kind: 'sub', value } };
  }
  if (roll < 0.65) {
    // 절반보다 덜 깎는 빼기. 빼는 쪽이 낫다.
    const cut = Math.round(ideal * between(0.15, 0.4, random));
    const value = Math.max(1, Math.min(ideal - halved - 1, cut));
    return { best: { kind: 'sub', value }, worse: { kind: 'div', value: 2 } };
  }
  const small = Math.max(1, Math.round(ideal * between(0.08, 0.2, random)));
  const big = Math.min(ideal - 1, Math.max(small + 1, Math.round(ideal * between(0.3, 0.5, random))));
  return { best: { kind: 'sub', value: small }, worse: { kind: 'sub', value: big } };
}

/** 구간마다 한 줄은 "큰 줄"이다. 그 구간에서 불어날 몫의 대부분을 맡아서 곱하기와 큰 더하기가 나온다. */
const BIG_ROW_SHARE = 0.7;

/**
 * 이번 줄에서 무리가 몇 배가 되기를 바라는지.
 * total은 적 앞까지 불어나야 하는 배수, rowsLeft는 이 줄을 포함해 남은 관문 줄 수,
 * bigIn은 큰 줄까지 남은 줄 수(0이면 이 줄이 큰 줄, 음수면 이미 지났다).
 */
function rowNeed(total: number, rowsLeft: number, bigIn: number): number {
  if (bigIn < 0 || rowsLeft === 1) return total ** (1 / rowsLeft);
  if (bigIn === 0) return total ** BIG_ROW_SHARE;
  return total ** ((1 - BIG_ROW_SHARE) / (rowsLeft - 1));
}

/**
 * 관문 줄 하나를 만든다. need는 이번 줄에서 바라는 배수.
 * evilUsed는 이 구간에 둘 다 나쁜 쌍이 이미 나왔는지. 한 구간에 두 번은 내지 않는다.
 */
function makePair(
  ideal: number,
  need: number,
  segment: number,
  evilUsed: boolean,
  random: () => number,
): Ranked & { kind: PairKind } {
  const mix = pairMix(segment);
  const roll = random();

  if (!evilUsed && ideal >= EVIL_MIN_CROWD && (need < SHRINK_BELOW || roll < mix.evil)) {
    return { ...evilPair(ideal, need < SHRINK_BELOW, random), kind: 'evil' };
  }
  const jitter = between(GROWTH_JITTER[0], GROWTH_JITTER[1], random);
  const growth = Math.min(MAX_GROWTH, Math.max(MIN_GROWTH, need * jitter));
  if (roll < mix.evil + mix.arith && growth >= MUL_MIN_GROWTH) {
    const pair = arithPair(ideal, growth, segment, random);
    if (pair) return { ...pair, kind: 'arith' };
  }
  return { ...clearPair(ideal, growth, segment, random), kind: 'clear' };
}

// ───────── 구간 ─────────

export interface Segment {
  /** 구간 번호(0부터) */
  index: number;
  /** 차례로 지나는 관문 줄 */
  pairs: GatePair[];
  /** 구간 끝에서 길을 막는 적의 수 */
  enemies: number;
  /** 더 좋은 관문만 골랐을 때 적 앞에 선 무리 수 */
  idealAtWall: number;
}

/** 길을 이어서 만들어 가는 데 필요한 상태: 다음 구간 번호와, 거기에 들어설 때의 가장 좋은 무리 수 */
export interface Course {
  segment: number;
  ideal: number;
}

export function newCourse(): Course {
  return { segment: 0, ideal: START_CROWD };
}

/** 좋은 쪽과 나쁜 쪽을 좌우 아무 데나 놓는다. */
function place({ best, worse }: Ranked, random: () => number): GatePair {
  return random() < 0.5 ? { left: best, right: worse } : { left: worse, right: best };
}

/** 구간의 관문 줄들을 차례로 만든다. */
function buildPairs(course: Course, random: () => number): GatePair[] {
  const index = course.segment;
  const rows = rowsIn(index, random());
  const bigRow = Math.floor(random() * rows);
  const pairs: GatePair[] = [];
  let ideal = course.ideal;
  let evilUsed = false;

  for (let row = 0; row < rows; row += 1) {
    const need = rowNeed(wallTarget(index) / ideal, rows - row, bigRow - row);
    const ranked = makePair(ideal, need, index, evilUsed, random);
    pairs.push(place(ranked, random));
    ideal = applyGate(ideal, ranked.best);
    evilUsed ||= ranked.kind === 'evil';
  }
  return pairs;
}

/**
 * 관문 줄들을 지난 뒤의 무리 수. 줄마다 더 좋은 쪽을 고르되, slip번째 줄에서만 나쁜 쪽을 고른다.
 * slip이 없으면 끝까지 좋은 쪽만 고른 수다.
 */
function crowdAfter(crowd: number, pairs: readonly GatePair[], slip = -1): number {
  return pairs.reduce((count, pair, row) => {
    const best = betterSide(count, pair);
    const side = row === slip ? (best === 'left' ? 'right' : 'left') : best;
    return applyGate(count, pair[side]);
  }, crowd);
}

/** 어느 한 줄에서 잘못 골라도 구간 끝의 적을 뚫을 수 있는지 */
function forgivesOneSlip(crowd: number, pairs: readonly GatePair[], segment: number): boolean {
  const enemies = enemiesFor(crowdAfter(crowd, pairs), segment);
  return pairs.every((_, slip) => crowdAfter(crowd, pairs, slip) > enemies);
}

/**
 * 첫 구간은 한 번 잘못 골라도 끝나지 않게 만든다. 나쁜 관문이 무엇인지 겪어 보고도 계속할 수 있어야 한다.
 * 열에 여섯은 한 번에 그렇게 나오므로 몇 번 다시 만들어 보고, 그래도 안 되면 정해 둔 줄을 쓴다.
 */
const OPENING_TRIES = 8;
const OPENING_FALLBACK: readonly Ranked[] = [
  { best: { kind: 'add', value: 3 }, worse: { kind: 'sub', value: 1 } },
  { best: { kind: 'add', value: 4 }, worse: { kind: 'sub', value: 1 } },
];

function buildOpening(course: Course, random: () => number): GatePair[] {
  for (let attempt = 0; attempt < OPENING_TRIES; attempt += 1) {
    const pairs = buildPairs(course, random);
    if (forgivesOneSlip(course.ideal, pairs, course.segment)) return pairs;
  }
  return OPENING_FALLBACK.map((ranked) => place(ranked, random));
}

/**
 * 다음 구간을 만든다. 받은 course는 바꾸지 않고, 그다음 구간을 만들 때 쓸 course를 함께 돌려준다.
 * random은 0 이상 1 미만의 수를 돌려주는 함수(Math.random과 같은 모양).
 */
export function nextSegment(
  course: Course,
  random: () => number,
): { segment: Segment; course: Course } {
  const index = course.segment;
  const pairs = index === 0 ? buildOpening(course, random) : buildPairs(course, random);
  const ideal = crowdAfter(course.ideal, pairs);
  const enemies = enemiesFor(ideal, index);
  return {
    segment: { index, pairs, enemies, idealAtWall: ideal },
    course: { segment: index + 1, ideal: ideal - enemies },
  };
}

// ───────── 한 판 ─────────

/** 관문 줄 하나를 지날 때의 점수 */
export const GATE_POINTS = 1;
/** 첫 구간의 적을 뚫었을 때의 점수 */
export const WALL_POINTS = 5;
/** 구간이 하나 뒤일수록 적을 뚫은 점수가 이만큼 더 붙는다. */
export const WALL_POINTS_GAIN = 1;
/** 적을 뚫은 점수는 이 구간부터 더 오르지 않는다. */
export const WALL_POINTS_CAP_SEGMENT = 25;

/** segment번째 구간의 적을 뚫었을 때의 점수. 뒤로 갈수록 많다. */
export function wallPoints(segment: number): number {
  const index = Math.min(WALL_POINTS_CAP_SEGMENT, Math.max(0, segment));
  return WALL_POINTS + WALL_POINTS_GAIN * index;
}

export interface RunState {
  /** 지금 무리의 수. 0이면 끝난 것이다. */
  crowd: number;
  score: number;
  /** 지나간 관문 줄 수 */
  gates: number;
  /** 뚫은 적의 무리 수 */
  walls: number;
  /** 이번 판에서 무리가 가장 많았을 때의 수 */
  maxCrowd: number;
}

export function newRun(): RunState {
  return { crowd: START_CROWD, score: 0, gates: 0, walls: 0, maxCrowd: START_CROWD };
}

export function isOver(run: RunState): boolean {
  return run.crowd <= 0;
}

/**
 * 관문 하나를 지난다. 받은 상태는 바꾸지 않고 새 상태를 돌려준다.
 * 무리가 남아 있어야 지나간 것으로 쳐서 점수를 준다.
 */
export function passGate(run: RunState, gate: Gate): RunState {
  const crowd = applyGate(run.crowd, gate);
  if (crowd <= 0) return { ...run, crowd: 0 };
  return {
    ...run,
    crowd,
    gates: run.gates + 1,
    score: run.score + GATE_POINTS,
    maxCrowd: Math.max(run.maxCrowd, crowd),
  };
}

export interface Clash {
  /** 서로 부딪혀 양쪽에서 똑같이 사라지는 수 */
  lost: number;
  /** 적을 모두 없애고 무리가 남았는지 */
  broken: boolean;
  /** 뚫어서 받은 점수. 못 뚫었으면 0. */
  points: number;
}

/**
 * segment번째 구간의 적 enemies와 부딪힌다. 적의 수만큼 무리가 줄고, 한 마리라도 남아야 뚫은 것이다.
 * 받은 상태는 바꾸지 않고 새 상태를 돌려준다.
 */
export function hitWall(
  run: RunState,
  enemies: number,
  segment: number,
): { state: RunState; clash: Clash } {
  const lost = Math.min(run.crowd, Math.max(0, enemies));
  const crowd = run.crowd - lost;
  const broken = crowd > 0;
  const points = broken ? wallPoints(segment) : 0;
  return {
    state: {
      ...run,
      crowd,
      walls: run.walls + (broken ? 1 : 0),
      score: run.score + points,
    },
    clash: { lost, broken, points },
  };
}
