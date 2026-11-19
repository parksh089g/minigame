/**
 * 행운 슬롯의 라운드 이벤트와 대장 라운드.
 *
 * 둘째 라운드부터 라운드마다 이벤트가 하나씩 걸린다. 이벤트는 그 라운드에만 듣는 작은 규칙이다
 * (어느 그림의 상금이 두 배, 대각선이 쉬는 날, 한 번 더 돌리기 같은 것). 좋은 것과 나쁜 것과 비트는 것이 섞여 있다.
 * 첫 라운드에는 걸지 않는다. 처음 하는 사람이 바탕 규칙부터 익히게 한다.
 * 다섯째 라운드마다(5, 10, 15, ...) 여느 이벤트 대신 대장이 나온다. 대장은 이름이 있고 규칙이 더 사납다.
 * 대장 라운드를 넘기면 상을 하나 고른다: 한 단계 강화한 공짜 부적 세 장 가운데 한 장, 아니면 판이 끝날 때 받는 행운 조각.
 * 대장은 여느 이벤트보다 판을 조금 짧게 하고, 상과 좋은 이벤트(넉넉한 날의 두 번 더 돌리기)가 그만큼을 메운다.
 *
 * 다음 라운드의 이벤트는 라운드를 넘길 때(settleRound) 뽑아서 가게에서부터 미리 보인다. 무엇을 살지 고를 때 쓴다.
 * 오늘의 판은 이벤트와 상을 스핀이나 가게와는 따로 센 운(eventLuck, rewardLuck)으로 뽑는다. 씨앗과 라운드로만 정해져서
 * 누구에게나 같고, 무엇을 사든 그대로이며, 스핀과 가게의 운도 이벤트가 생기기 전과 같은 차례로 쓰인다.
 *
 * 규칙(RoundRule)이 하는 일은 rules.ts가 셈에 넣는다. 이 파일은 rules.ts의 값에 기대지 않는다(타입만 쓴다).
 * 그림의 이름이 들어가는 글은 round-event-text.ts가 만든다.
 */
import { seededRandom } from '../../core/stages';
import type { LineKind } from './rules';

/** 이벤트가 그 라운드에만 바꾸는 것. 적히지 않은 것은 그대로다. */
export interface RoundRule {
  /** 그 그림의 상금에 곱하는 값(부적까지 더한 상금에 곱한다). [그림 번호, 곱] */
  valueTimes?: readonly [symbol: number, times: number];
  /** 그 그림의 무게에 더하는 값. [그림 번호, 더할 값] */
  weight?: readonly [symbol: number, delta: number];
  /** 아예 나오지 않는 그림. 7이면 가운데 7 부적도 듣지 않는다. */
  ban?: number;
  /** 이 라운드에 더(음수면 덜) 돌리는 횟수 */
  spins?: number;
  /** 이 라운드에 더 잠글 수 있는 횟수 */
  holds?: number;
  /** 이 라운드에는 열을 잠글 수 없다. */
  noHolds?: boolean;
  /** 이 라운드의 목표에 곱하는 백분율(75면 25% 낮고, 130이면 30% 높다) */
  targetRate?: number;
  /** 가운데 칸이 7로 나올 확률(0~1). 부적의 것과 따로 따진다(하나라도 걸리면 7이다). */
  centerWild?: number;
  /** 맞아도 금화를 주지 않는(맞은 줄로 치지도 않는) 줄의 갈래 */
  offLine?: LineKind;
  /** 꽝이어도 위로 금화(기본과 부적의 것 모두)를 받지 않는다. */
  noConsolation?: boolean;
}

/** 이벤트의 느낌. 화면의 색과 테스트(좋은 것과 나쁜 것이 섞여 있는지)에 쓴다. */
export type EventTone = 'good' | 'bad' | 'twist';

export const EVENT_IDS = ['gold', 'lucky', 'bonus', 'center', 'holds', 'short', 'no-diag', 'no-miss', 'heavy'] as const;
export const BOSS_IDS = ['lock', 'greed', 'thief', 'slow'] as const;
export type EventId = (typeof EVENT_IDS)[number];
export type BossId = (typeof BOSS_IDS)[number];
export type RoundEventId = EventId | BossId;

export interface RoundEventInfo {
  id: RoundEventId;
  boss: boolean;
  tone: EventTone;
  /** 그림 하나를 골라서 쓰는 이벤트인지(그 그림은 뽑을 때 정해진다) */
  picksSymbol: boolean;
  /** 그 라운드의 규칙. 그림을 고르는 이벤트는 고른 그림을 받는다. */
  rule: (symbol: number) => RoundRule;
}

/** 그림을 고르는 이벤트가 고르는 그림: 체리부터 다이아까지(7은 고르지 않는다). rules.ts의 그림 번호와 같다. */
export const PICKABLE_SYMBOLS = 5;
/** 7의 그림 번호(rules.ts의 WILD와 같다. 테스트가 둘이 같은지 본다) */
export const SEVEN = 5;

/**
 * 여느 라운드의 이벤트. 숫자는 자동 플레이로 맞췄다: 좋은 것과 나쁜 것이 서로 비겨서, 이벤트가 생기기 전과
 * 판의 길이가 거의 같다(rules.test.ts의 밸런스). 한 줄로 설명할 수 있을 만큼만 바꾼다.
 */
export const EVENTS: readonly RoundEventInfo[] = [
  { id: 'gold', boss: false, tone: 'good', picksSymbol: true, rule: (symbol) => ({ valueTimes: [symbol, 2] }) },
  { id: 'lucky', boss: false, tone: 'twist', picksSymbol: true, rule: (symbol) => ({ weight: [symbol, 20] }) },
  { id: 'bonus', boss: false, tone: 'good', picksSymbol: false, rule: () => ({ spins: 2 }) },
  { id: 'center', boss: false, tone: 'good', picksSymbol: false, rule: () => ({ centerWild: 0.5 }) },
  { id: 'holds', boss: false, tone: 'good', picksSymbol: false, rule: () => ({ holds: 2 }) },
  { id: 'short', boss: false, tone: 'twist', picksSymbol: false, rule: () => ({ spins: -1, targetRate: 75 }) },
  { id: 'no-diag', boss: false, tone: 'bad', picksSymbol: false, rule: () => ({ offLine: 'diag' }) },
  { id: 'no-miss', boss: false, tone: 'bad', picksSymbol: false, rule: () => ({ noConsolation: true }) },
  { id: 'heavy', boss: false, tone: 'bad', picksSymbol: false, rule: () => ({ targetRate: 120 }) },
];

/** 대장. 여느 이벤트보다 사납고, 넘기면 상을 준다. */
export const BOSSES: readonly RoundEventInfo[] = [
  { id: 'lock', boss: true, tone: 'bad', picksSymbol: false, rule: () => ({ noHolds: true }) },
  { id: 'greed', boss: true, tone: 'bad', picksSymbol: false, rule: () => ({ targetRate: 125 }) },
  { id: 'thief', boss: true, tone: 'bad', picksSymbol: false, rule: () => ({ ban: SEVEN }) },
  { id: 'slow', boss: true, tone: 'bad', picksSymbol: false, rule: () => ({ spins: -2 }) },
];

const INFO_BY_ID: ReadonlyMap<string, RoundEventInfo> = new Map([...EVENTS, ...BOSSES].map((info) => [info.id, info]));

/** id로 이벤트를 찾는다. 없는 id면 undefined. */
export function eventInfoOf(id: string): RoundEventInfo | undefined {
  return INFO_BY_ID.get(id);
}

/** 판에 걸린 이벤트 하나. 어느 라운드의 것인지까지 적어 둔다. */
export interface RoundEvent {
  id: RoundEventId;
  /** 이 이벤트가 걸린 라운드 */
  round: number;
  /** 그림을 고르는 이벤트가 고른 그림. 아니면 없다. */
  symbol?: number;
}

/** 이벤트가 걸리기 시작하는 라운드 */
export const EVENT_FROM = 2;
/** 대장이 나오는 라운드의 간격 */
export const BOSS_EVERY = 5;
/** 대장의 상에서 고르는 공짜 부적의 수. 부적은 한 단계 강화해서 내놓는다. */
export const REWARD_OFFERS = 3;
/** 이벤트로 한 라운드에 더 잠글 수 있는 가장 많은 횟수. 저장한 판을 읽을 때 쓴다. */
export const MAX_EXTRA_HOLDS = Math.max(...EVENTS.map((info) => info.rule(0).holds ?? 0));

/** 대장이 나오는 라운드인지 */
export function isBossRound(round: number): boolean {
  return round >= BOSS_EVERY && round % BOSS_EVERY === 0;
}

/** 그 라운드에 이벤트가 걸리는지 */
export function hasEvent(round: number): boolean {
  return round >= EVENT_FROM;
}

/**
 * 대장을 넘기고 부적 대신 고르는 행운 조각: 대장을 만날 때마다 두 개씩 많아진다(다섯째 2개, 열째 4개, ...).
 * 넘긴 라운드마다 받는 한 개(perks.ts의 piecesFor)에 얹히므로, 일곱 라운드쯤 가는 판의 조각이 7개에서 9개가 된다.
 */
export function bossPiecesOf(round: number): number {
  return 2 * Math.max(1, Math.floor(round / BOSS_EVERY));
}

/** 그 라운드의 이벤트를 뽑는다. 이벤트가 없는 라운드면 undefined. 대장 라운드에는 대장이 나온다. */
export function drawEvent(round: number, random: () => number): RoundEvent | undefined {
  if (!hasEvent(round)) return undefined;
  const pool = isBossRound(round) ? BOSSES : EVENTS;
  const info = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
  if (!info.picksSymbol) return { id: info.id, round };
  return { id: info.id, round, symbol: Math.min(PICKABLE_SYMBOLS - 1, Math.floor(random() * PICKABLE_SYMBOLS)) };
}

/** 아무것도 바꾸지 않는 규칙 */
export const NO_RULE: RoundRule = Object.freeze({});

/** 이벤트의 규칙. 이벤트가 없거나 모르는 이벤트면 NO_RULE. */
export function ruleOf(event: RoundEvent | undefined): RoundRule {
  const info = event ? eventInfoOf(event.id) : undefined;
  return info ? info.rule(event?.symbol ?? 0) : NO_RULE;
}

/**
 * 정해진 운의 판(오늘의 판)에서 그 라운드의 이벤트를 뽑는 운. 씨앗과 라운드로만 정해진다.
 * 스핀('spin')과 가게('shop')의 운과는 이름이 달라서 그 차례를 건드리지 않는다.
 */
export function eventLuck(seed: string, round: number): () => number {
  return seededRandom(`${seed}:event:${round}`);
}

/** 정해진 운의 판에서 그 대장 라운드의 상(공짜 부적)을 뽑는 운 */
export function rewardLuck(seed: string, round: number): () => number {
  return seededRandom(`${seed}:boss:${round}`);
}
