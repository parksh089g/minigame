/**
 * 하이로우의 규칙. 화면과 분리된 순수 함수라서 숫자만 바꿔 밸런스를 조정할 수 있다.
 *
 * 뒤집힌 카드를 보고, 다음 카드가 그보다 높을지 낮을지 맞힌다.
 * - A가 가장 낮고(1) K가 가장 높다(13). 무늬는 셈하지 않는다.
 * - 같은 숫자가 나오면 비긴 것이라 점수도 하트도 그대로다.
 * - 맞히면 그쪽이 나올 가능성이 낮을수록 큰 점수를 받고, 연속으로 맞힐수록 보너스가 붙는다.
 * - 틀리면 하트를 하나 잃고 연속 기록이 끊긴다. 하트를 다 잃으면 끝난다.
 * - 카드 묶음(52장)은 한 장씩 줄어들어서, 이미 나온 카드를 기억하면 유리하다. 다 쓰면 새 묶음을 섞는다.
 */

export const GAME_ID = 'high-low';

/** 처음 하트 수 */
export const LIVES = 3;
/** 한 판에 쓸 수 있는 넘기기(맞히지 않고 카드를 바꾸기) 수 */
export const SKIPS = 2;
/** 한 번 맞혔을 때의 점수 범위 */
export const MIN_POINTS = 1;
export const MAX_POINTS = 10;
/** 연속으로 이만큼 맞힐 때마다 맞힐 때 붙는 보너스가 1점씩 는다 */
export const STREAK_STEP = 5;
export const MAX_STREAK_BONUS = 5;

export type Suit = 'spade' | 'heart' | 'diamond' | 'club';
export const SUITS: readonly Suit[] = ['spade', 'heart', 'diamond', 'club'];

export interface Card {
  /** 1(A)부터 13(K)까지 */
  rank: number;
  suit: Suit;
}

export type Guess = 'high' | 'low';
export type Verdict = 'win' | 'tie' | 'lose';

export function isRed(suit: Suit): boolean {
  return suit === 'heart' || suit === 'diamond';
}

/** 카드에 적는 글자: A, 2~10, J, Q, K */
export function rankLabel(rank: number): string {
  switch (rank) {
    case 1:
      return 'A';
    case 11:
      return 'J';
    case 12:
      return 'Q';
    case 13:
      return 'K';
    default:
      return String(rank);
  }
}

/** 52장을 섞은 새 카드 묶음. 맨 끝이 다음에 뒤집을 카드다. */
export function newDeck(random: () => number = Math.random): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (let rank = 1; rank <= 13; rank += 1) deck.push({ rank, suit });
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/** 남은 카드 가운데 지금 카드보다 높은 것, 낮은 것, 같은 것의 수 */
export function countOutcomes(current: number, deck: readonly Card[]): { high: number; low: number; same: number } {
  let high = 0;
  let low = 0;
  let same = 0;
  for (const card of deck) {
    if (card.rank > current) high += 1;
    else if (card.rank < current) low += 1;
    else same += 1;
  }
  return { high, low, same };
}

/** 그쪽을 골랐을 때 맞힐 가능성(0~1). 남은 카드가 없으면 0. */
export function winChance(guess: Guess, current: number, deck: readonly Card[]): number {
  if (deck.length === 0) return 0;
  return countOutcomes(current, deck)[guess] / deck.length;
}

/**
 * 그쪽을 맞혔을 때 받는 기본 점수. 나올 가능성이 낮을수록 크다(가능성의 역수, 1~10점).
 * 나올 수 없는 쪽이면 0이고 고를 수 없다.
 */
export function pointsFor(guess: Guess, current: number, deck: readonly Card[]): number {
  const chance = winChance(guess, current, deck);
  if (chance <= 0) return 0;
  return Math.min(MAX_POINTS, Math.max(MIN_POINTS, Math.round(1 / chance)));
}

/** 연속으로 맞힌 수에 따라 맞힐 때 덧붙는 보너스. streak는 이번에 맞히기 전까지 이어진 수다. */
export function streakBonus(streak: number): number {
  return Math.min(MAX_STREAK_BONUS, Math.floor(Math.max(0, streak) / STREAK_STEP));
}

export function judge(guess: Guess, current: number, next: number): Verdict {
  if (next === current) return 'tie';
  const higher = next > current;
  return higher === (guess === 'high') ? 'win' : 'lose';
}

/** 한 판의 상태. 화면은 이것을 보고 그리기만 한다. */
export interface HighLowState {
  /** 지금 펼쳐 놓은 카드 */
  current: Card;
  /** 남은 카드 묶음. 맨 끝이 다음 카드다. */
  deck: Card[];
  score: number;
  lives: number;
  skips: number;
  streak: number;
  bestStreak: number;
  /** 맞힌 수, 틀린 수, 비긴 수 */
  wins: number;
  losses: number;
  ties: number;
  /** 새 카드 묶음을 섞은 횟수 */
  reshuffles: number;
}

export function startState(random: () => number = Math.random): HighLowState {
  const deck = newDeck(random);
  const current = deck.pop() as Card;
  return {
    current,
    deck,
    score: 0,
    lives: LIVES,
    skips: SKIPS,
    streak: 0,
    bestStreak: 0,
    wins: 0,
    losses: 0,
    ties: 0,
    reshuffles: 0,
  };
}

/**
 * 다음 카드를 뽑는다. 마지막 장을 뽑아 묶음이 비면 바로 새로 섞어서(state.deck을 바꾼다),
 * 다음에 고를 때의 가능성을 언제나 남은 묶음으로 셈할 수 있게 한다.
 */
function draw(state: HighLowState, random: () => number): { card: Card; reshuffled: boolean } {
  const card = state.deck.pop() as Card;
  let reshuffled = false;
  if (state.deck.length === 0) {
    state.deck = newDeck(random);
    state.reshuffles += 1;
    reshuffled = true;
  }
  return { card, reshuffled };
}

export interface GuessOutcome {
  verdict: Verdict;
  /** 뒤집힌 카드 */
  card: Card;
  /** 이번에 받은 점수(기본 점수 + 연속 보너스). 맞히지 못했으면 0 */
  points: number;
  bonus: number;
  /** 이 카드가 묶음의 마지막 장이라서 새 묶음을 섞었는지 */
  reshuffled: boolean;
  /** 이번에 하트를 다 잃어 판이 끝났는지 */
  over: boolean;
}

/** 고른 쪽으로 다음 카드를 뒤집는다. 상태를 바꾸고 결과를 돌려준다. 고를 수 없는 쪽이면 null. */
export function makeGuess(state: HighLowState, guess: Guess, random: () => number = Math.random): GuessOutcome | null {
  if (state.lives <= 0) return null;
  const base = pointsFor(guess, state.current.rank, state.deck);
  if (base === 0) return null;
  const { card, reshuffled } = draw(state, random);
  const verdict = judge(guess, state.current.rank, card.rank);
  let points = 0;
  let bonus = 0;
  if (verdict === 'win') {
    bonus = streakBonus(state.streak);
    points = base + bonus;
    state.score += points;
    state.streak += 1;
    state.bestStreak = Math.max(state.bestStreak, state.streak);
    state.wins += 1;
  } else if (verdict === 'tie') {
    state.ties += 1;
  } else {
    state.lives -= 1;
    state.streak = 0;
    state.losses += 1;
  }
  state.current = card;
  return { verdict, card, points, bonus, reshuffled, over: state.lives <= 0 };
}

/** 넘기기: 맞히지 않고 지금 카드를 다음 카드로 바꾼다. 연속 기록은 그대로다. 넘기기를 다 썼으면 null. */
export function skipCard(state: HighLowState, random: () => number = Math.random): { card: Card; reshuffled: boolean } | null {
  if (state.skips <= 0 || state.lives <= 0) return null;
  state.skips -= 1;
  const drawn = draw(state, random);
  state.current = drawn.card;
  return drawn;
}

/** 판이 끝나고 받는 코인 */
export function coinsFor(score: number): number {
  return Math.floor(score / 2);
}

/** 맞힌 비율(0~100 정수). 비긴 것은 셈하지 않는다. */
export function accuracy(wins: number, losses: number): number {
  const total = wins + losses;
  return total > 0 ? Math.round((wins / total) * 100) : 0;
}
