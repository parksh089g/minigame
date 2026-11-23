/**
 * 포커의 족보: 카드 5~7장에서 가장 센 다섯 장을 골라 등급과 비교할 숫자를 낸다.
 * 화면과 Phaser에 기대지 않는 순수 함수라서 시험에서 그대로 돌리고, 나중에 서버도 그대로 쓸 수 있다.
 *
 * - 카드는 하이로우의 Card(A=1, J=11, Q=12, K=13)를 쓰고, 셈할 때는 A를 14로 친다.
 * - A는 5-4-3-2-A 스트레이트(가장 낮은 스트레이트)에서만 1로 친다.
 * - 무늬끼리는 높고 낮음이 없다. 같은 족보면 숫자로 가리고, 숫자까지 같으면 비긴다.
 */
import type { Card } from '../high-low/rules';

/** 족보 등급. 클수록 세다. */
export const Category = {
  HighCard: 0,
  OnePair: 1,
  TwoPair: 2,
  Trips: 3,
  Straight: 4,
  Flush: 5,
  FullHouse: 6,
  Quads: 7,
  StraightFlush: 8,
  RoyalFlush: 9,
} as const;
export type Category = (typeof Category)[keyof typeof Category];

export interface HandRankInfo {
  category: Category;
  /** 족보표에 적는 이름 */
  name: string;
  /** 족보표 아래에 적는 짧은 설명 */
  hint: string;
  /** 규칙 안내와 족보표에서 보여 주는 예(카드 다섯 장, 규칙 안내서의 그림 글) */
  example: readonly string[];
}

/** 센 것부터 적은 족보표 */
export const HAND_RANKS: readonly HandRankInfo[] = [
  { category: Category.RoyalFlush, name: '로열 플러시', hint: '같은 무늬 10 J Q K A', example: ['AS', 'KS', 'QS', 'JS', '10S'] },
  { category: Category.StraightFlush, name: '스트레이트 플러시', hint: '같은 무늬로 이어진 5장', example: ['9H', '8H', '7H', '6H', '5H'] },
  { category: Category.Quads, name: '포카드', hint: '같은 숫자 4장', example: ['8S', '8H', '8D', '8C', 'KS'] },
  { category: Category.FullHouse, name: '풀하우스', hint: '트리플 + 원페어', example: ['QC', 'QD', 'QS', '4H', '4S'] },
  { category: Category.Flush, name: '플러시', hint: '같은 무늬 5장', example: ['KD', '9D', '7D', '4D', '2D'] },
  { category: Category.Straight, name: '스트레이트', hint: '이어진 숫자 5장', example: ['8C', '7D', '6S', '5H', '4C'] },
  { category: Category.Trips, name: '트리플', hint: '같은 숫자 3장', example: ['7S', '7H', '7D', 'KC', '2H'] },
  { category: Category.TwoPair, name: '투페어', hint: '같은 숫자 2장이 두 쌍', example: ['JS', 'JD', '5C', '5H', '9S'] },
  { category: Category.OnePair, name: '원페어', hint: '같은 숫자 2장', example: ['10H', '10C', 'AS', '6D', '3C'] },
  { category: Category.HighCard, name: '하이카드', hint: '아무것도 없으면 큰 숫자', example: ['AH', 'JC', '8S', '6D', '2C'] },
];

export function rankInfo(category: Category): HandRankInfo {
  return HAND_RANKS.find((info) => info.category === category) as HandRankInfo;
}

export interface HandValue {
  category: Category;
  /** 같은 등급끼리 앞에서부터 견주는 숫자(A=14). 스트레이트는 가장 높은 숫자 하나다. */
  kickers: number[];
  /** 족보를 이루는 다섯 장 */
  cards: Card[];
}

/** 셈하는 숫자: A는 14 */
export function valueOf(card: Card): number {
  return card.rank === 1 ? 14 : card.rank;
}

const byValueDesc = (a: Card, b: Card): number => valueOf(b) - valueOf(a);

/** 이 카드들 안의 가장 높은 스트레이트의 꼭대기 숫자(5-4-3-2-A면 5). 없으면 0. */
function straightHigh(cards: readonly Card[]): number {
  const present = new Set(cards.map(valueOf));
  if (present.has(14)) present.add(1);
  for (let high = 14; high >= 5; high -= 1) {
    let ok = true;
    for (let v = high; v > high - 5; v -= 1) {
      if (!present.has(v)) {
        ok = false;
        break;
      }
    }
    if (ok) return high;
  }
  return 0;
}

/** 꼭대기가 high인 스트레이트를 이루는 다섯 장(숫자마다 한 장) */
function straightCards(cards: readonly Card[], high: number): Card[] {
  const picked: Card[] = [];
  for (let v = high; v > high - 5; v -= 1) {
    const want = v === 1 ? 14 : v;
    picked.push(cards.find((card) => valueOf(card) === want) as Card);
  }
  return picked;
}

/**
 * 카드 5~7장의 가장 센 족보. 카드가 5장보다 적으면 있는 장으로만 본다(판 중간에 지금 내 패를 보여 줄 때).
 */
export function evaluate(input: readonly Card[]): HandValue {
  const cards = [...input].sort(byValueDesc);

  // 무늬별로 모아 플러시를 찾는다.
  const bySuit = new Map<string, Card[]>();
  for (const card of cards) {
    const list = bySuit.get(card.suit) ?? [];
    list.push(card);
    bySuit.set(card.suit, list);
  }
  let flush: Card[] | null = null;
  for (const list of bySuit.values()) if (list.length >= 5) flush = list;

  if (flush) {
    const high = straightHigh(flush);
    if (high > 0) {
      return {
        category: high === 14 ? Category.RoyalFlush : Category.StraightFlush,
        kickers: [high],
        cards: straightCards(flush, high),
      };
    }
  }

  // 숫자별로 모은다. 장 수가 많은 쪽, 같으면 높은 숫자가 앞이다.
  const groups = new Map<number, Card[]>();
  for (const card of cards) {
    const list = groups.get(valueOf(card)) ?? [];
    list.push(card);
    groups.set(valueOf(card), list);
  }
  const sets = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || b[0] - a[0]);
  const rest = (used: readonly Card[], count: number): Card[] => cards.filter((card) => !used.includes(card)).slice(0, count);

  const [first, second] = sets;
  if (first && first[1].length === 4) {
    const kick = rest(first[1], 1);
    return { category: Category.Quads, kickers: [first[0], ...kick.map(valueOf)], cards: [...first[1], ...kick] };
  }
  if (first && first[1].length === 3) {
    // 트리플이 둘이면 낮은 쪽의 두 장을 페어로 쓴다.
    const pair = sets.slice(1).find(([, list]) => list.length >= 2);
    if (pair) {
      return {
        category: Category.FullHouse,
        kickers: [first[0], pair[0]],
        cards: [...first[1], ...pair[1].slice(0, 2)],
      };
    }
  }
  if (flush) {
    const top = flush.slice(0, 5);
    return { category: Category.Flush, kickers: top.map(valueOf), cards: top };
  }
  const high = straightHigh(cards);
  if (high > 0) return { category: Category.Straight, kickers: [high], cards: straightCards(cards, high) };
  if (first && first[1].length === 3) {
    const kick = rest(first[1], 2);
    return { category: Category.Trips, kickers: [first[0], ...kick.map(valueOf)], cards: [...first[1], ...kick] };
  }
  if (first && second && first[1].length === 2 && second[1].length === 2) {
    const used = [...first[1], ...second[1]];
    const kick = rest(used, 1);
    return { category: Category.TwoPair, kickers: [first[0], second[0], ...kick.map(valueOf)], cards: [...used, ...kick] };
  }
  if (first && first[1].length === 2) {
    const kick = rest(first[1], 3);
    return { category: Category.OnePair, kickers: [first[0], ...kick.map(valueOf)], cards: [...first[1], ...kick] };
  }
  const top = cards.slice(0, 5);
  return { category: Category.HighCard, kickers: top.map(valueOf), cards: top };
}

/** a가 세면 양수, b가 세면 음수, 같으면 0 */
export function compareHands(a: HandValue, b: HandValue): number {
  if (a.category !== b.category) return a.category - b.category;
  const length = Math.max(a.kickers.length, b.kickers.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (a.kickers[i] ?? 0) - (b.kickers[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** 족보 이름. 원페어처럼 숫자가 중요한 것은 "K 원페어"처럼 숫자를 붙인다. */
export function handName(value: HandValue): string {
  const base = rankInfo(value.category).name;
  const label = (v: number): string => (v === 14 ? 'A' : v === 13 ? 'K' : v === 12 ? 'Q' : v === 11 ? 'J' : String(v));
  switch (value.category) {
    case Category.OnePair:
    case Category.Trips:
    case Category.Quads:
      return `${label(value.kickers[0])} ${base}`;
    case Category.TwoPair:
      return `${label(value.kickers[0])}·${label(value.kickers[1])} ${base}`;
    case Category.Straight:
    case Category.StraightFlush:
      return `${label(value.kickers[0])} ${base}`;
    case Category.HighCard:
      return `${label(value.kickers[0])} ${base}`;
    default:
      return base;
  }
}
