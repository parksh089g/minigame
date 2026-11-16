/**
 * 행운 슬롯의 규칙. 화면과 분리된 순수 함수라서 숫자만 바꿔 밸런스를 조정할 수 있다.
 *
 * 3×3 칸에 그림이 하나씩 나오고, 가로·세로·대각선 여덟 줄 가운데 같은 그림 셋이 놓인 줄마다 금화를 받는다.
 * 라운드마다 정해진 횟수만 돌릴 수 있고, 다 돌리면 그 라운드의 목표만큼 금화를 낸다. 모자라면 판이 끝난다.
 * 낸 뒤에 남은 금화로는 가게에서 부적을 사서 붙인다. 부적은 그림이 나올 확률이나 줄의 상금을 바꾼다.
 *
 * 칸 번호는 왼쪽 위부터 오른쪽으로 매긴다(칸 번호 = 줄 × SIZE + 열).
 * 무작위가 필요한 곳은 random(0 이상 1 미만의 수를 돌려주는 함수)을 받아서 쓴다.
 * 여기서 말하는 금화는 이 게임 안에서만 쓰는 것이고, 앱의 코인과는 상관없다.
 */

// ───────── 그림 ─────────

export const SIZE = 3;
export const CELLS = SIZE * SIZE;

export type SymbolKey = 'cherry' | 'clover' | 'bell' | 'horseshoe' | 'diamond' | 'seven';

export interface SymbolInfo {
  key: SymbolKey;
  name: string;
  /** 이 그림 셋이 한 줄에 놓였을 때 받는 금화 */
  value: number;
  /** 한 칸에 이 그림이 나오는 무게. 확률은 이 값을 모든 그림의 무게의 합으로 나눈 것이다. */
  weight: number;
}

/**
 * 그림의 번호 순서대로. 흔한 그림일수록 상금이 적다.
 * 7은 어떤 그림으로도 쳐 주는 그림이고, 7 셋이 한 줄에 놓이면 7의 상금을 준다.
 */
export const SYMBOLS: readonly SymbolInfo[] = [
  { key: 'cherry', name: '체리', value: 2, weight: 30 },
  { key: 'clover', name: '클로버', value: 3, weight: 25 },
  { key: 'bell', name: '종', value: 5, weight: 19 },
  { key: 'horseshoe', name: '말굽', value: 8, weight: 13 },
  { key: 'diamond', name: '다이아', value: 12, weight: 8 },
  { key: 'seven', name: '7', value: 20, weight: 5 },
];

/** 7의 그림 번호 */
export const WILD = 5;
/** 부적으로 줄여도 그림의 무게는 이 밑으로 내려가지 않는다. 어떤 그림도 아예 안 나오게 되지는 않는다. */
export const MIN_WEIGHT = 3;

/** 칸마다 놓인 그림의 번호. 길이는 언제나 CELLS다. */
export type Grid = readonly number[];

// ───────── 줄 ─────────

export type LineKind = 'row' | 'col' | 'diag';

export interface Line {
  kind: LineKind;
  cells: readonly [number, number, number];
}

/** 상금을 따지는 여덟 줄: 가로 셋, 세로 셋, 대각선 둘 */
export const LINES: readonly Line[] = [
  { kind: 'row', cells: [0, 1, 2] },
  { kind: 'row', cells: [3, 4, 5] },
  { kind: 'row', cells: [6, 7, 8] },
  { kind: 'col', cells: [0, 3, 6] },
  { kind: 'col', cells: [1, 4, 7] },
  { kind: 'col', cells: [2, 5, 8] },
  { kind: 'diag', cells: [0, 4, 8] },
  { kind: 'diag', cells: [2, 4, 6] },
];

/**
 * 한 줄의 세 칸이 어떤 그림으로 맞았는지. 맞지 않았으면 null.
 * 7은 다른 그림으로 쳐 주고, 셋이 다 7이면 7로 맞은 것이다.
 */
export function lineSymbol(grid: Grid, line: Line): number | null {
  let symbol: number | null = null;
  for (const cell of line.cells) {
    const here = grid[cell];
    if (here === WILD) continue;
    if (symbol !== null && symbol !== here) return null;
    symbol = here;
  }
  return symbol ?? WILD;
}

// ───────── 부적 ─────────

/** 부적의 갈래. 그림의 테두리 색과 가게의 설명에 쓴다. */
export type CharmKind = 'odds' | 'prize' | 'line' | 'trick';

/**
 * 부적 하나가 하는 일. 같은 부적은 한 장만 붙일 수 있고, 서로 다른 부적의 효과는 겹친다:
 * 더하는 것은 더해지고, 곱하는 것은 곱해진다.
 */
export interface CharmEffect {
  /** 그림의 무게에 더하는 값. [그림 번호, 더할 값] */
  weight?: readonly [symbol: number, delta: number];
  /** 그림의 상금에 더하는 값. [그림 번호, 더할 값] */
  value?: readonly [symbol: number, delta: number];
  /** 그 갈래의 줄의 상금에 곱하는 값 */
  lineTimes?: readonly [kind: LineKind, times: number];
  /** 라운드마다 더 돌릴 수 있는 횟수 */
  spins?: number;
  /** 한 줄도 맞지 않았을 때 더 받는 금화 */
  consolation?: number;
  /** 한 번에 lines줄 이상 맞았을 때 그 스핀의 상금에 곱하는 값 */
  combo?: readonly [lines: number, times: number];
  /** 라운드의 마지막 스핀의 상금에 곱하는 값 */
  lastTimes?: number;
  /** 한 줄도 맞지 않은 스핀의 바로 다음 스핀의 상금에 곱하는 값 */
  reboundTimes?: number;
  /** 가운데 칸이 다른 그림 대신 7로 나올 확률(0~1). 그림을 뽑기 전에 먼저 따진다. */
  centerWild?: number;
  /** 라운드를 넘길 때, 남은 금화 SAVINGS_PER개마다 한 개씩 받는 덤의 한도 */
  savingsCap?: number;
}

export interface CharmInfo {
  id: string;
  name: string;
  /** 가게의 카드에 적는 한 줄. 좁은 카드에 들어가게 짧게 쓴다. */
  description: string;
  kind: CharmKind;
  price: number;
  effect: CharmEffect;
}

const CHERRY = 0;
const CLOVER = 1;
const BELL = 2;
const HORSESHOE = 3;
const DIAMOND = 4;

/** 저금통: 남은 금화 이만큼마다 한 개를 덤으로 받는다. */
export const SAVINGS_PER = 5;

/**
 * 부적의 목록. 가게에는 이 가운데 아직 붙이지 않은 것 세 장이 고르게 뽑혀 나온다.
 * 한 줄을 더하면 가게에 나오고, 그림은 art.ts가 갈래와 효과를 보고 그린다(trick은 id마다 따로 그린다).
 */
export const CHARMS: readonly CharmInfo[] = [
  // 확률: 그림이 나올 확률을 바꾼다.
  { id: 'more-cherry', name: '체리 듬뿍', description: '체리가 더 자주 나와요', kind: 'odds', price: 5, effect: { weight: [CHERRY, 36] } },
  { id: 'more-clover', name: '클로버 듬뿍', description: '클로버가 더 자주 나와요', kind: 'odds', price: 5, effect: { weight: [CLOVER, 30] } },
  { id: 'more-bell', name: '종 듬뿍', description: '종이 더 자주 나와요', kind: 'odds', price: 6, effect: { weight: [BELL, 26] } },
  { id: 'more-horseshoe', name: '말굽 듬뿍', description: '말굽이 더 자주 나와요', kind: 'odds', price: 7, effect: { weight: [HORSESHOE, 22] } },
  { id: 'more-diamond', name: '다이아 듬뿍', description: '다이아가 더 자주 나와요', kind: 'odds', price: 8, effect: { weight: [DIAMOND, 20] } },
  { id: 'more-seven', name: '7 듬뿍', description: '7이 더 자주 나와요', kind: 'odds', price: 8, effect: { weight: [WILD, 4] } },
  { id: 'less-cherry', name: '체리 덜기', description: '체리가 덜 나와요', kind: 'odds', price: 5, effect: { weight: [CHERRY, -18] } },
  { id: 'less-clover', name: '클로버 덜기', description: '클로버가 덜 나와요', kind: 'odds', price: 5, effect: { weight: [CLOVER, -15] } },
  // 상금: 그림의 상금을 올린다.
  { id: 'gold-cherry', name: '황금 체리', description: '체리 줄의 상금 +3', kind: 'prize', price: 5, effect: { value: [CHERRY, 3] } },
  { id: 'gold-clover', name: '황금 클로버', description: '클로버 줄의 상금 +4', kind: 'prize', price: 5, effect: { value: [CLOVER, 4] } },
  { id: 'gold-bell', name: '황금 종', description: '종 줄의 상금 +6', kind: 'prize', price: 6, effect: { value: [BELL, 6] } },
  { id: 'gold-horseshoe', name: '황금 말굽', description: '말굽 줄의 상금 +10', kind: 'prize', price: 7, effect: { value: [HORSESHOE, 10] } },
  { id: 'gold-diamond', name: '황금 다이아', description: '다이아 줄의 상금 +16', kind: 'prize', price: 8, effect: { value: [DIAMOND, 16] } },
  // 줄: 줄의 갈래마다 상금을 곱한다.
  { id: 'wide', name: '가로 두 배', description: '가로줄의 상금이 두 배', kind: 'line', price: 8, effect: { lineTimes: ['row', 2] } },
  { id: 'tall', name: '세로 두 배', description: '세로줄의 상금이 두 배', kind: 'line', price: 8, effect: { lineTimes: ['col', 2] } },
  { id: 'slant', name: '대각선 세 배', description: '대각선의 상금이 세 배', kind: 'line', price: 8, effect: { lineTimes: ['diag', 3] } },
  // 재주: 판의 흐름을 바꾼다.
  { id: 'extra', name: '덤 스핀', description: '라운드마다 한 번 더 돌려요', kind: 'trick', price: 7, effect: { spins: 1 } },
  { id: 'piggy', name: '저금통', description: '남긴 금화 5개마다 +1', kind: 'trick', price: 6, effect: { savingsCap: 8 } },
  { id: 'comfort', name: '위로 금화', description: '꽝이면 금화를 2개 더 받아요', kind: 'trick', price: 5, effect: { consolation: 2 } },
  { id: 'twins', name: '쌍둥이 줄', description: '두 줄 넘게 맞으면 두 배', kind: 'trick', price: 9, effect: { combo: [2, 2] } },
  { id: 'crown', name: '왕관', description: '세 줄 넘게 맞으면 두 배', kind: 'trick', price: 6, effect: { combo: [3, 2] } },
  { id: 'middle', name: '가운데 7', description: '가운데에 7이 자주 떠요', kind: 'trick', price: 9, effect: { centerWild: 0.25 } },
  { id: 'finale', name: '막판 한 방', description: '마지막 스핀의 상금이 세 배', kind: 'trick', price: 6, effect: { lastTimes: 3 } },
  { id: 'rebound', name: '오뚝이', description: '꽝 다음 스핀의 상금이 두 배', kind: 'trick', price: 6, effect: { reboundTimes: 2 } },
];

const CHARM_BY_ID: ReadonlyMap<string, CharmInfo> = new Map(CHARMS.map((charm) => [charm.id, charm]));

/** id로 부적을 찾는다. 없는 id면 undefined. */
export function charmOf(id: string): CharmInfo | undefined {
  return CHARM_BY_ID.get(id);
}

/** 붙일 수 있는 부적의 수 */
export const SLOTS = 5;

function effectsOf(charms: readonly string[]): CharmEffect[] {
  return charms.flatMap((id) => {
    const charm = CHARM_BY_ID.get(id);
    return charm ? [charm.effect] : [];
  });
}

// ───────── 확률과 상금 ─────────

/** 붙인 부적을 반영한 그림마다의 무게 */
export function weightsOf(charms: readonly string[]): number[] {
  const weights = SYMBOLS.map((symbol) => symbol.weight);
  for (const effect of effectsOf(charms)) {
    if (effect.weight) weights[effect.weight[0]] += effect.weight[1];
  }
  return weights.map((weight) => Math.max(MIN_WEIGHT, weight));
}

/** 한 칸에 그림마다 나올 확률(0~1). 모두 더하면 1이다. */
export function oddsOf(charms: readonly string[]): number[] {
  const weights = weightsOf(charms);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => weight / total);
}

/** 붙인 부적을 반영한 그림마다의 상금 */
export function valuesOf(charms: readonly string[]): number[] {
  const values = SYMBOLS.map((symbol) => symbol.value);
  for (const effect of effectsOf(charms)) {
    if (effect.value) values[effect.value[0]] += effect.value[1];
  }
  return values;
}

/** 줄의 갈래마다 상금에 곱하는 값 */
export function lineTimesOf(charms: readonly string[]): Record<LineKind, number> {
  const times: Record<LineKind, number> = { row: 1, col: 1, diag: 1 };
  for (const effect of effectsOf(charms)) {
    if (effect.lineTimes) times[effect.lineTimes[0]] *= effect.lineTimes[1];
  }
  return times;
}

/**
 * 어느 한 줄이 그림마다 그 그림으로 맞을 확률(0~1). 세 칸이 그 그림이거나 7이면 맞는다
 * (셋이 다 7인 것은 7로 맞은 것으로 센다).
 */
export function lineOdds(charms: readonly string[]): number[] {
  const odds = oddsOf(charms);
  const wild = odds[WILD];
  return odds.map((chance, symbol) => (symbol === WILD ? wild ** 3 : (chance + wild) ** 3 - wild ** 3));
}

/** 무게에 따라 그림 하나를 뽑는다. */
export function drawSymbol(weights: readonly number[], random: () => number): number {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let at = random() * total;
  for (let symbol = 0; symbol < weights.length; symbol += 1) {
    at -= weights[symbol];
    if (at < 0) return symbol;
  }
  return weights.length - 1;
}

/** 가운데 칸의 번호 */
export const CENTER = 4;

/** 가운데 칸이 다른 그림 대신 7로 나올 확률(0~1). 그런 부적이 없으면 0이다. */
export function centerWildOf(charms: readonly string[]): number {
  // 부적마다 따로 따지는 것과 같다: 하나라도 걸리면 7이다.
  return 1 - effectsOf(charms).reduce((miss, effect) => miss * (1 - (effect.centerWild ?? 0)), 1);
}

/** 아홉 칸을 칸마다 따로 뽑는다. */
export function rollGrid(charms: readonly string[], random: () => number): number[] {
  const weights = weightsOf(charms);
  const centerWild = centerWildOf(charms);
  return Array.from({ length: CELLS }, (_, cell) =>
    cell === CENTER && centerWild > 0 && random() < centerWild ? WILD : drawSymbol(weights, random),
  );
}

// ───────── 한 번 돌린 결과 ─────────

/** 아홉 칸이 모두 맞았을 때(여덟 줄이 다 맞았을 때) 상금에 곱하는 기본 값 */
export const JACKPOT_TIMES = 2;
/** 한 줄도 맞지 않은 스핀(꽝)에 주는 위로 금화. 부적이 없어도 준다. */
export const MISS_COIN = 1;

export interface LineWin {
  /** LINES에서의 번호 */
  line: number;
  /** 맞은 그림 */
  symbol: number;
  /** 이 줄로 받는 금화(줄의 갈래에 곱하는 값까지 넣은 것) */
  amount: number;
}

/** 상금에 곱해진 까닭. 화면이 "두 배!" 같은 글을 띄울 때 쓴다. */
export type BoostKind = 'jackpot' | 'combo' | 'last' | 'rebound';

export interface Boost {
  kind: BoostKind;
  times: number;
}

export interface SpinOutcome {
  grid: number[];
  wins: LineWin[];
  /** 줄의 상금을 더한 것 */
  base: number;
  /** base에 곱해진 것들. 곱해진 차례대로 들어 있다. */
  boosts: Boost[];
  /** 한 줄도 맞지 않아서 받은 위로 금화 */
  consolation: number;
  /** 이번 스핀으로 받는 금화 */
  total: number;
  /** 아홉 칸이 모두 맞았는지 */
  jackpot: boolean;
}

export interface SpinContext {
  /** 라운드의 마지막 스핀인지 */
  last: boolean;
  /** 바로 앞 스핀에서 한 줄도 맞지 않았는지 */
  afterMiss: boolean;
}

/** 나온 판과 붙인 부적으로 받는 금화를 셈한다. */
export function scoreSpin(grid: Grid, charms: readonly string[], context: SpinContext): SpinOutcome {
  const values = valuesOf(charms);
  const times = lineTimesOf(charms);
  const effects = effectsOf(charms);

  const wins: LineWin[] = [];
  LINES.forEach((line, index) => {
    const symbol = lineSymbol(grid, line);
    if (symbol === null) return;
    wins.push({ line: index, symbol, amount: values[symbol] * times[line.kind] });
  });
  const base = wins.reduce((sum, win) => sum + win.amount, 0);
  const jackpot = wins.length === LINES.length;

  const boosts: Boost[] = [];
  const boost = (kind: BoostKind, value: number): void => {
    if (value > 1) boosts.push({ kind, times: value });
  };
  if (wins.length > 0) {
    if (jackpot) boost('jackpot', JACKPOT_TIMES);
    boost(
      'combo',
      effects.reduce(
        (product, effect) => product * (effect.combo && wins.length >= effect.combo[0] ? effect.combo[1] : 1),
        1,
      ),
    );
    if (context.last) boost('last', effects.reduce((product, effect) => product * (effect.lastTimes ?? 1), 1));
    if (context.afterMiss) {
      boost('rebound', effects.reduce((product, effect) => product * (effect.reboundTimes ?? 1), 1));
    }
  }
  const consolation =
    wins.length === 0 ? effects.reduce((sum, effect) => sum + (effect.consolation ?? 0), MISS_COIN) : 0;
  const total = boosts.reduce((amount, item) => amount * item.times, base) + consolation;
  return { grid: [...grid], wins, base, boosts, consolation, total, jackpot };
}

// ───────── 라운드 ─────────

/** 라운드마다 돌릴 수 있는 기본 횟수 */
export const BASE_SPINS = 6;
/** 판을 시작할 때 가진 금화 */
export const START_COIN = 3;

/**
 * 라운드마다 내야 하는 금화. 적힌 것보다 뒤의 라운드는 앞 라운드의 한 배 반씩 오른다(정수로만 셈한다).
 * 부적 다섯 장으로 벌 수 있는 금화에는 끝이 있어서, 아무리 잘 골라도 판은 언젠가 끝난다.
 */
const TARGETS: readonly number[] = [5, 10, 16, 24, 34, 48, 66, 90, 122, 165, 222, 300];

export function targetOf(round: number): number {
  const at = Math.max(1, Math.floor(round));
  if (at <= TARGETS.length) return TARGETS[at - 1];
  let target = TARGETS[TARGETS.length - 1];
  for (let step = TARGETS.length; step < at; step += 1) target = Math.floor((target * 3) / 2);
  return target;
}

/** 라운드마다 돌릴 수 있는 횟수(부적의 덤까지) */
export function spinsOf(charms: readonly string[]): number {
  return BASE_SPINS + effectsOf(charms).reduce((sum, effect) => sum + (effect.spins ?? 0), 0);
}

/** 라운드를 넘길 때 남은 금화에 붙는 덤. 저금통이 없으면 0이다. */
export function savingsFor(coin: number, charms: readonly string[]): number {
  return effectsOf(charms).reduce(
    (sum, effect) =>
      sum + (effect.savingsCap ? Math.min(effect.savingsCap, Math.floor(Math.max(0, coin) / SAVINGS_PER)) : 0),
    0,
  );
}

// ───────── 가게 ─────────

/** 가게에 한 번에 나오는 부적의 수 */
export const OFFERS = 3;
/** 가게의 부적을 다시 뽑는 값. 같은 가게에서 다시 뽑을 때마다 REROLL_STEP씩 오른다. */
export const REROLL_COST = 2;
export const REROLL_STEP = 1;

export interface Shop {
  /** 팔고 있는 부적의 id. 팔린 자리는 null이다. */
  offers: (string | null)[];
  /** 지금 다시 뽑는 값 */
  rerollCost: number;
}

/** 아직 붙이지 않은 부적 가운데 서로 다른 OFFERS장을 고르게 뽑는다. */
export function drawOffers(owned: readonly string[], random: () => number): string[] {
  const pool = CHARMS.map((charm) => charm.id).filter((id) => !owned.includes(id));
  const offers: string[] = [];
  while (offers.length < OFFERS && pool.length > 0) {
    const index = Math.min(pool.length - 1, Math.floor(random() * pool.length));
    offers.push(pool.splice(index, 1)[0]);
  }
  return offers;
}

// ───────── 한 판 ─────────

export type Phase = 'spin' | 'shop' | 'over';

export interface RunState {
  phase: Phase;
  /** 지금 라운드(1부터). 판이 끝났으면 넘지 못한 라운드다. */
  round: number;
  /** 이 라운드에 남은 스핀 */
  spinsLeft: number;
  /** 가진 금화 */
  coin: number;
  /** 이번 판에 받은 금화를 모두 더한 것. 이것이 점수다. */
  earned: number;
  /** 붙인 부적의 id. 많아야 SLOTS장이다. */
  charms: string[];
  /** 가게가 열려 있을 때의 가게. 아니면 null. */
  shop: Shop | null;
  /** 바로 앞 스핀에서 한 줄도 맞지 않았는지. 라운드가 바뀌면 지워진다. */
  afterMiss: boolean;
  /** 한 번의 스핀으로 받은 가장 많은 금화 */
  bestSpin: number;
}

export function newRun(): RunState {
  return {
    phase: 'spin',
    round: 1,
    spinsLeft: spinsOf([]),
    coin: START_COIN,
    earned: 0,
    charms: [],
    shop: null,
    afterMiss: false,
    bestSpin: 0,
  };
}

/** 넘긴 라운드의 수. 가게가 열려 있으면 지금 라운드까지 넘긴 것이다. */
export function clearedRounds(run: RunState): number {
  return run.phase === 'shop' ? run.round : run.round - 1;
}

/**
 * 한 번 돌린다. 돌릴 수 없는 때(가게, 끝난 판, 스핀이 없을 때)에는 null을 돌려준다.
 * 마지막 스핀까지 돌려도 라운드는 저절로 넘어가지 않는다. 화면이 결과를 다 보여 준 뒤 settleRound를 부른다.
 */
export function spin(run: RunState, random: () => number): { run: RunState; outcome: SpinOutcome } | null {
  if (run.phase !== 'spin' || run.spinsLeft <= 0) return null;
  const grid = rollGrid(run.charms, random);
  const outcome = scoreSpin(grid, run.charms, { last: run.spinsLeft === 1, afterMiss: run.afterMiss });
  return {
    outcome,
    run: {
      ...run,
      spinsLeft: run.spinsLeft - 1,
      coin: run.coin + outcome.total,
      earned: run.earned + outcome.total,
      afterMiss: outcome.wins.length === 0,
      bestSpin: Math.max(run.bestSpin, outcome.total),
    },
  };
}

export interface Settlement {
  run: RunState;
  /** 목표를 채웠는지. false면 판이 끝났다. */
  cleared: boolean;
  /** 낸 금화(목표). 채우지 못했으면 0이다. */
  paid: number;
  /** 저금통으로 받은 덤 */
  savings: number;
}

/**
 * 스핀을 다 쓴 라운드를 맺는다. 가진 금화가 목표 이상이면 목표만큼 내고 가게를 열고, 모자라면 판이 끝난다.
 * 아직 스핀이 남았거나 맺을 라운드가 아니면 null을 돌려준다.
 */
export function settleRound(run: RunState, random: () => number): Settlement | null {
  if (run.phase !== 'spin' || run.spinsLeft > 0) return null;
  const target = targetOf(run.round);
  if (run.coin < target) {
    return { run: { ...run, phase: 'over', shop: null }, cleared: false, paid: 0, savings: 0 };
  }
  const left = run.coin - target;
  const savings = savingsFor(left, run.charms);
  return {
    cleared: true,
    paid: target,
    savings,
    run: {
      ...run,
      phase: 'shop',
      coin: left + savings,
      earned: run.earned + savings,
      afterMiss: false,
      shop: { offers: drawOffers(run.charms, random), rerollCost: REROLL_COST },
    },
  };
}

/** 가게에서 offer번째 부적을 살 수 없는 까닭. 살 수 있으면 null. */
export type BuyBlock = 'closed' | 'sold' | 'coin' | 'full';

export function buyBlock(run: RunState, offer: number): BuyBlock | null {
  const id = run.phase === 'shop' ? run.shop?.offers[offer] : undefined;
  if (run.phase !== 'shop' || !run.shop) return 'closed';
  const charm = id ? charmOf(id) : undefined;
  if (!charm) return 'sold';
  if (run.charms.includes(charm.id)) return 'sold';
  if (run.charms.length >= SLOTS) return 'full';
  if (run.coin < charm.price) return 'coin';
  return null;
}

/** 가게의 offer번째 부적을 사서 붙인다. 살 수 없으면 run을 그대로 돌려준다. */
export function buy(run: RunState, offer: number): RunState {
  if (buyBlock(run, offer) !== null || !run.shop) return run;
  const id = run.shop.offers[offer];
  const charm = id ? charmOf(id) : undefined;
  if (!id || !charm) return run;
  const offers = run.shop.offers.map((item, index) => (index === offer ? null : item));
  return {
    ...run,
    coin: run.coin - charm.price,
    charms: [...run.charms, id],
    shop: { ...run.shop, offers },
  };
}

/** 가게의 부적을 값을 치르고 다시 뽑는다. 금화가 모자라거나 가게가 아니면 run을 그대로 돌려준다. */
export function reroll(run: RunState, random: () => number): RunState {
  if (run.phase !== 'shop' || !run.shop || run.coin < run.shop.rerollCost) return run;
  return {
    ...run,
    coin: run.coin - run.shop.rerollCost,
    shop: { offers: drawOffers(run.charms, random), rerollCost: run.shop.rerollCost + REROLL_STEP },
  };
}

/** 붙여 둔 slot번째 부적을 뗀다. 돌려받는 것은 없다. 가게에서만 뗄 수 있다. */
export function discard(run: RunState, slot: number): RunState {
  if (run.phase !== 'shop' || slot < 0 || slot >= run.charms.length) return run;
  return { ...run, charms: run.charms.filter((_, index) => index !== slot) };
}

/** 가게를 닫고 다음 라운드를 시작한다. */
export function nextRound(run: RunState): RunState {
  if (run.phase !== 'shop') return run;
  return {
    ...run,
    phase: 'spin',
    round: run.round + 1,
    spinsLeft: spinsOf(run.charms),
    shop: null,
    afterMiss: false,
  };
}

/** 이번 판의 점수: 받은 금화를 모두 더한 것 */
export function scoreOf(run: RunState): number {
  return run.earned;
}

// ───────── 화면의 자리 ─────────

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 화면에 놓이는 것들의 자리. 길이는 모두 논리 픽셀이다. */
export interface Layout {
  /** 목표와 남은 스핀을 적는 카드 */
  goal: Box;
  /** 기계의 몸통 */
  machine: Box;
  /** 그림 칸 한 변의 길이 */
  cell: number;
  /** 아홉 칸의 왼쪽 위 */
  gridLeft: number;
  gridTop: number;
  /** 붙인 부적이 놓이는 줄: 칸의 한 변과 칸마다의 왼쪽 위 */
  slotSize: number;
  slots: ReadonlyArray<{ x: number; y: number }>;
  /** 그림마다의 상금과 확률을 적는 카드와, 그 안에서 그림마다 차지하는 칸의 폭과 왼쪽 끝 */
  odds: { box: Box; cellWidth: number; cells: readonly number[] };
  /** 돌리기 버튼. 가게에서는 이 자리에 다시 뽑기와 다음 라운드 버튼이 놓인다. */
  button: Box;
  /** 가게의 창. 기계를 덮는다. */
  shop: Box;
}

/** 기계 몸통이 칸들을 두르는 두께 */
export const MACHINE_FRAME = 7;
/** 칸 한 변의 가장 짧은 길이와 가장 긴 길이 */
export const CELL_MIN = 44;
export const CELL_MAX = 58;

const GOAL_HEIGHT = 30;
const SLOT_SIZE = 34;
const SLOT_GAP = 6;
const ODDS_HEIGHT = 32;
const ODDS_WIDTH = 37;
const BUTTON_HEIGHT = 40;
const ROW_GAP = 8;
const BOTTOM_MARGIN = 10;

/**
 * 게임 영역(area: HUD 아래의 자리)에 맞춰 자리를 잡는다. 화면이 길면 칸이 커지고, 그래도 남는 길이는 줄 사이에 나눈다.
 * 가장 짧은 화면(높이 400)에서도 모든 줄이 들어간다.
 */
export function layoutFor(area: Box): Layout {
  const fixed = GOAL_HEIGHT + SLOT_SIZE + ODDS_HEIGHT + BUTTON_HEIGHT + ROW_GAP * 4 + BOTTOM_MARGIN + 2;
  const room = area.height - fixed - MACHINE_FRAME * 2;
  const cell = Math.max(CELL_MIN, Math.min(CELL_MAX, Math.floor(room / SIZE)));
  const machineSize = cell * SIZE + MACHINE_FRAME * 2;
  // 남는 길이는 다섯 틈(기계 위, 기계 아래, 부적 줄 아래, 확률 줄 아래, 맨 아래)에 고르게 나눈다.
  const spare = Math.max(0, Math.floor((area.height - fixed - machineSize) / 5));
  const centerX = area.x + area.width / 2;

  const goal: Box = { x: area.x + 8, y: area.y + 2, width: area.width - 16, height: GOAL_HEIGHT };
  const machine: Box = {
    x: Math.round(centerX - machineSize / 2),
    y: goal.y + goal.height + ROW_GAP + spare,
    width: machineSize,
    height: machineSize,
  };
  const slotsWidth = SLOTS * SLOT_SIZE + (SLOTS - 1) * SLOT_GAP;
  const slotsTop = machine.y + machine.height + ROW_GAP + spare;
  const slots = Array.from({ length: SLOTS }, (_, index) => ({
    x: Math.round(centerX - slotsWidth / 2) + index * (SLOT_SIZE + SLOT_GAP),
    y: slotsTop,
  }));
  const oddsTop = slotsTop + SLOT_SIZE + ROW_GAP + spare;
  const oddsBox: Box = { x: area.x + 8, y: oddsTop, width: area.width - 16, height: ODDS_HEIGHT };
  const oddsLeft = Math.round(centerX - (SYMBOLS.length * ODDS_WIDTH) / 2);
  const oddsCells = SYMBOLS.map((_, index) => oddsLeft + index * ODDS_WIDTH);
  const button: Box = {
    x: area.x + 12,
    y: oddsTop + ODDS_HEIGHT + ROW_GAP + spare,
    width: area.width - 24,
    height: BUTTON_HEIGHT,
  };
  return {
    goal,
    machine,
    cell,
    gridLeft: machine.x + MACHINE_FRAME,
    gridTop: machine.y + MACHINE_FRAME,
    slotSize: SLOT_SIZE,
    slots,
    odds: { box: oddsBox, cellWidth: ODDS_WIDTH, cells: oddsCells },
    button,
    shop: {
      x: area.x + 8,
      y: goal.y + goal.height + 4,
      width: area.width - 16,
      // 창 아래의 그림자가 부적 줄에 닿지 않게 조금 띄운다.
      height: slotsTop - 7 - (goal.y + goal.height + 4),
    },
  };
}

/** 가게의 창에서 부적 한 줄이 차지하는 높이와, 그 위의 머리글이 차지하는 높이 */
export const SHOP_ROW = 44;
export const SHOP_HEAD = 24;
