/**
 * 컴퓨터 상대. AI 서버 없이 정해 둔 판단 규칙으로 고른다. 난이도는 규칙을 얼마나 깊이 따지는지로 나뉜다.
 * - 쉬움: 낼 수 있는 카드 가운데 아무거나 낸다. 공격을 받으면 절반쯤은 그냥 받는다. 원카드를 자주 잊는다.
 * - 보통: 평범한 카드를 먼저 내고, 많이 가진 무늬를 이어 가고, 조커와 공격 카드는 막을 때를 위해 아낀다.
 * - 어려움: 보통의 규칙에 더해, 다음 사람이 카드를 거의 다 냈으면 공격과 건너뛰기로 막고,
 *   다음 사람에게 없다고 드러난 무늬로 몰아가고, 마지막 두 장은 끝낼 수 있게 순서를 맞춘다.
 */
import { attackPower, isJoker, nextPlayer, nextRandom, playableCards, SUITS, type Card, type GameState, type Level, type Suit } from './rules';

export type Move = { k: 'play'; cardId: number } | { k: 'draw' };

/** 무늬마다 몇 장 가졌는지 */
function suitCounts(hand: readonly Card[]): Record<Suit, number> {
  const counts: Record<Suit, number> = { S: 0, D: 0, H: 0, C: 0 };
  for (const card of hand) if (card.suit) counts[card.suit] += 1;
  return counts;
}

/** card를 낸 뒤 남은 손에서 이어서 낼 수 있는 카드가 있는지(K로 한 번 더 낼 때, 마지막 한 장을 남길 때) */
function followsAfter(card: Card, rest: readonly Card[]): boolean {
  return rest.some((other) => isJoker(other) || isJoker(card) || other.suit === card.suit || other.rank === card.rank || other.rank === 7);
}

/** 낼 카드의 점수. 높을수록 먼저 낸다. */
function scoreCard(state: GameState, who: number, card: Card, level: Level): number {
  const hand = state.players[who].hand;
  const rest = hand.filter((other) => other.id !== card.id);
  const counts = suitCounts(rest);
  const next = nextPlayer(state, who);
  const nextCount = state.players[next].hand.length;
  const power = attackPower(card);
  let score = 10;

  if (state.attack > 0) {
    // 막을 때는 3이 가장 싸고, 공격 카드는 약한 것부터 넘긴다.
    if (card.rank === 3 && !isJoker(card)) return 50;
    return 40 - power;
  }

  if (card.suit) score += counts[card.suit] * 2;
  if (power > 0) score -= 6;
  if (isJoker(card)) score -= 14;
  if (!isJoker(card) && card.rank === 7) score -= 4;
  if (!isJoker(card) && card.rank === 13) score += followsAfter(card, rest) ? 8 : -8;
  if (!isJoker(card) && card.rank === 11) score += 3;
  // 손이 거의 비었으면 아껴 둔 카드도 쓴다.
  if (hand.length <= 3) score += power > 0 ? 8 : 0;

  if (level === 'hard') {
    if (nextCount <= 2) {
      if (power > 0) score += 25;
      if (!isJoker(card) && card.rank === 11) score += 18;
    }
    // 다음 사람에게 없는 무늬로 몰아간다.
    if (card.suit && state.voids[next].includes(card.suit)) score += 7;
    // 두 장 남았으면 마지막 한 장을 낼 수 있게 남긴다.
    if (hand.length === 2) score += followsAfter(card, rest) ? 12 : -6;
    // 상대가 적게 가졌을 때 큰 공격을 오래 들고 있지 않는다.
    if (isJoker(card) && nextCount <= 3) score += 18;
  }
  return score;
}

/** 차례인 컴퓨터가 할 일을 고른다. random은 쉬움의 무작위와 같은 점수끼리 고를 때 쓴다. */
export function chooseMove(state: GameState, who: number, level: Level, random: () => number = () => nextRandom(state)): Move {
  const playable = playableCards(state, who);
  if (playable.length === 0) return { k: 'draw' };
  if (level === 'easy') {
    if (state.attack > 0 && random() < 0.5) return { k: 'draw' };
    return { k: 'play', cardId: playable[Math.floor(random() * playable.length)].id };
  }
  let best = playable[0];
  let bestScore = -Infinity;
  for (const card of playable) {
    const score = scoreCard(state, who, card, level) + random() * 0.5;
    if (score > bestScore) {
      best = card;
      bestScore = score;
    }
  }
  return { k: 'play', cardId: best.id };
}

/** 7을 낸 컴퓨터가 다음 무늬를 고른다. */
export function chooseSuitFor(state: GameState, who: number, level: Level, random: () => number = () => nextRandom(state)): Suit {
  if (level === 'easy') return SUITS[Math.floor(random() * SUITS.length)];
  const hand = state.players[who].hand;
  const counts = suitCounts(hand);
  const next = nextPlayer(state, who);
  let best: Suit = SUITS[0];
  let bestScore = -Infinity;
  for (const suit of SUITS) {
    let score = counts[suit] * 3 + random() * 0.5;
    if (level === 'hard' && state.voids[next].includes(suit)) score += 4;
    if (score > bestScore) {
      best = suit;
      bestScore = score;
    }
  }
  return best;
}

/** 원카드를 외치는 데 걸리는 시간(ms). 사람의 원카드를 잡을 때도, 스스로 외칠 때도 쓴다. */
export const REACTION: Readonly<Record<Level, { catchMs: number; callMs: readonly [number, number]; forget: number }>> = {
  easy: { catchMs: 3600, callMs: [1400, 2400], forget: 0.45 },
  normal: { catchMs: 2300, callMs: [900, 1700], forget: 0.15 },
  hard: { catchMs: 1300, callMs: [450, 900], forget: 0 },
};

/** 컴퓨터가 스스로 원카드를 외칠 때까지의 시간. 잊어버리면 null */
export function selfCallDelay(level: Level, random: () => number): number | null {
  const reaction = REACTION[level];
  if (random() < reaction.forget) return null;
  const [low, high] = reaction.callMs;
  return Math.round(low + (high - low) * random());
}

