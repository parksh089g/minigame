/**
 * 훌라의 카드와 묶음(등록할 수 있는 카드 모음) 규칙. Phaser에 의존하지 않는다.
 *
 * 카드는 0~51의 수 하나로 나타낸다: 무늬 = Math.floor(card / 13), 숫자 = card % 13 + 1 (A=1, J=11, Q=12, K=13).
 */

export const SUITS = 4;
export const RANKS = 13;
export const DECK_SIZE = SUITS * RANKS;

/** 0 스페이드, 1 하트, 2 다이아, 3 클로버 */
export type Suit = 0 | 1 | 2 | 3;

export const suitOf = (card: number): Suit => Math.floor(card / RANKS) as Suit;
export const rankOf = (card: number): number => (card % RANKS) + 1;
export const cardOf = (suit: Suit, rank: number): number => suit * RANKS + rank - 1;
export const isRed = (card: number): boolean => suitOf(card) === 1 || suitOf(card) === 2;

/** 남은 카드로 내는 점수: 카드의 숫자 그대로다(A=1, J=11, Q=12, K=13). */
export const pointsOf = (card: number): number => rankOf(card);
export const handPoints = (hand: readonly number[]): number => hand.reduce((sum, card) => sum + pointsOf(card), 0);

export const RANK_LABEL = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
export const SUIT_NAME = ['스페이드', '하트', '다이아', '클로버'] as const;

/** 카드의 이름. 예: "하트 7" */
export const cardName = (card: number): string => `${SUIT_NAME[suitOf(card)]} ${RANK_LABEL[rankOf(card)]}`;

/** 카드 이름 뒤에 붙는 을/를. 숫자를 읽는 소리의 받침을 따른다(칠을, 구를, 에이를). */
export function objectMark(card: number): '을' | '를' {
  return [3, 6, 7, 8, 10].includes(rankOf(card)) ? '을' : '를';
}

/** 7은 혼자서도 등록할 수 있다. */
export const SEVEN = 7;

export type MeldKind = 'set' | 'run' | 'seven';

/** 같은 숫자 3~4장 */
function isSet(cards: readonly number[]): boolean {
  if (cards.length < 3 || cards.length > 4) return false;
  const rank = rankOf(cards[0]);
  return cards.every((card) => rankOf(card) === rank);
}

/** 같은 무늬로 이어지는 숫자 3장 이상. A는 가장 낮은 카드로만 쓴다(A-2-3은 되고 Q-K-A는 안 된다). */
function isRun(cards: readonly number[]): boolean {
  if (cards.length < 3) return false;
  const suit = suitOf(cards[0]);
  if (!cards.every((card) => suitOf(card) === suit)) return false;
  const ranks = cards.map(rankOf).sort((a, b) => a - b);
  return ranks.every((rank, i) => i === 0 || rank === ranks[i - 1] + 1);
}

/** 이 카드들이 한 묶음으로 등록할 수 있는 모양인지. 아니면 null. */
export function meldKindOf(cards: readonly number[]): MeldKind | null {
  if (cards.length === 1 && rankOf(cards[0]) === SEVEN) return 'seven';
  if (isSet(cards)) return 'set';
  if (isRun(cards)) return 'run';
  return null;
}

/** 묶음을 보기 좋게 늘어놓는다: 이어지는 숫자는 작은 것부터, 같은 숫자는 무늬 순서로. */
export function sortMeld(cards: readonly number[]): number[] {
  return [...cards].sort((a, b) => rankOf(a) - rankOf(b) || suitOf(a) - suitOf(b));
}

/**
 * 탁자의 묶음에 카드 한 장을 붙일 수 있는지. 붙인 뒤에도 같은 숫자나 이어지는 숫자 묶음이어야 한다.
 * 혼자 놓인 7에는 붙일 수 없다(7 두 장은 묶음이 아니다).
 */
export function canAttach(meld: readonly number[], card: number): boolean {
  const kind = meldKindOf([...meld, card]);
  return kind === 'set' || kind === 'run';
}

/** 손패를 숫자 순서(같으면 무늬 순서)로 */
export const byRank = (a: number, b: number): number => rankOf(a) - rankOf(b) || suitOf(a) - suitOf(b);
/** 손패를 무늬 순서(같으면 숫자 순서)로 */
export const bySuit = (a: number, b: number): number => suitOf(a) - suitOf(b) || rankOf(a) - rankOf(b);

/**
 * 손패 안에서 만들 수 있는 모든 묶음 후보. 같은 숫자는 3장·4장 고르기를 모두, 이어지는 숫자는 3장 이상의
 * 모든 구간을 넣는다. 7은 한 장짜리 묶음으로도 넣는다.
 */
export function meldCandidates(hand: readonly number[]): number[][] {
  const out: number[][] = [];
  const have = new Set(hand);
  // 같은 숫자
  for (let rank = 1; rank <= RANKS; rank += 1) {
    const same = hand.filter((card) => rankOf(card) === rank);
    if (same.length === 4) {
      out.push([...same]);
      for (let skip = 0; skip < 4; skip += 1) out.push(same.filter((_, i) => i !== skip));
    } else if (same.length === 3) {
      out.push([...same]);
    }
  }
  // 이어지는 숫자
  for (let suit = 0 as Suit; suit < SUITS; suit = (suit + 1) as Suit) {
    for (let start = 1; start <= RANKS - 2; start += 1) {
      const run: number[] = [];
      for (let rank = start; rank <= RANKS; rank += 1) {
        const card = cardOf(suit, rank);
        if (!have.has(card)) break;
        run.push(card);
        if (run.length >= 3) out.push([...run]);
      }
    }
  }
  for (const card of hand) if (rankOf(card) === SEVEN) out.push([card]);
  return out;
}

/**
 * 손패에서 겹치지 않게 묶음을 골라 가장 많은 점수를 내려놓는 방법. 손패는 많아야 8장이라 모두 살펴본다.
 * 같은 점수면 더 많은 장을 내려놓는 쪽을 고른다.
 */
export function bestMelds(hand: readonly number[]): number[][] {
  const candidates = meldCandidates(hand);
  let best: number[][] = [];
  let bestScore = -1;
  const scoreOf = (melds: readonly number[][]): number =>
    melds.reduce((sum, meld) => sum + handPoints(meld) * 100 + meld.length, 0);
  const walk = (from: number, used: Set<number>, chosen: number[][]): void => {
    const score = scoreOf(chosen);
    if (score > bestScore) {
      bestScore = score;
      best = chosen.map((meld) => [...meld]);
    }
    for (let i = from; i < candidates.length; i += 1) {
      const meld = candidates[i];
      if (meld.some((card) => used.has(card))) continue;
      for (const card of meld) used.add(card);
      chosen.push(meld);
      walk(i + 1, used, chosen);
      chosen.pop();
      for (const card of meld) used.delete(card);
    }
  };
  walk(0, new Set(), []);
  return best;
}

/** 새로 섞은 카드 한 벌 */
export function shuffledDeck(random: () => number): number[] {
  const deck = Array.from({ length: DECK_SIZE }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/** 시드로 정해지는 난수(테스트와 같은 판을 다시 만들 때 쓴다) */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
