/**
 * 훌라 한 판의 진행. 나와 컴퓨터 둘이서 7장씩 받아 시작한다. Phaser에 의존하지 않는다.
 *
 * 차례마다
 * 1. 덱에서 한 장을 뽑거나, 버린 카드 맨 위의 한 장을 가져온다. 버린 카드는 그 차례에 바로 내려놓을 수 있을 때만
 *    가져올 수 있고, 가져왔으면 버리기 전에 꼭 내려놓아야 한다.
 * 2. 같은 숫자 3~4장이나 같은 무늬로 이어지는 숫자 3장 이상을 등록한다. 7은 혼자서도 등록할 수 있다.
 *    탁자에 놓인 묶음(누구 것이든)에 한 장씩 붙일 수도 있다.
 * 3. 한 장을 버린다.
 * 손에 카드가 하나도 안 남으면 이긴다(땡). 그때까지 하나도 등록하지 않았다가 한 차례에 모두 내려놓았으면 훌라다.
 * 덱이 다 떨어지면 남은 카드의 숫자 합이 적은 쪽이 이긴다.
 */
import {
  canAttach,
  handPoints,
  meldKindOf,
  rankOf,
  SEVEN,
  shuffledDeck,
  sortMeld,
  type MeldKind,
} from './cards';

export type Side = 'me' | 'cpu';
export const other = (side: Side): Side => (side === 'me' ? 'cpu' : 'me');

export const HAND_SIZE = 7;

export interface Meld {
  cards: number[];
  owner: Side;
  kind: MeldKind;
}

export type Phase = 'draw' | 'play' | 'over';

export interface RoundResult {
  /** null이면 비겼다(덱이 떨어졌는데 합이 같다). */
  winner: Side | null;
  /** out: 손을 다 비움, hula: 한 차례에 모두 내려놓음, stock: 덱이 떨어져 합을 견줌 */
  how: 'out' | 'hula' | 'stock';
  /** 판이 끝났을 때 각자 손에 남은 카드의 숫자 합 */
  left: Record<Side, number>;
  /** 진 쪽이 낸 점수(훌라와 박은 두 배씩). 비기면 0 */
  penalty: number;
  /** 진 쪽이 한 번도 등록하지 못했으면(박) true */
  shutout: boolean;
}

export interface HulaState {
  stock: number[];
  /** 버린 카드 더미. 마지막이 맨 위다. */
  discard: number[];
  hands: Record<Side, number[]>;
  melds: Meld[];
  turn: Side;
  phase: Phase;
  /** 이번 차례에 버린 카드 더미에서 가져와서 아직 내려놓지 않은 카드 */
  taken: number | null;
  /** 이번 차례가 시작될 때 탁자에 자기 카드가 하나도 없었는지(훌라 판정에 쓴다) */
  freshTurn: boolean;
  /** 지금까지 탁자에 카드를 내려놓은 적이 있는지 */
  registered: Record<Side, boolean>;
  /** 각자가 버린 카드 더미에서 가져간 카드. 어려운 컴퓨터가 상대가 모으는 것을 짐작하는 데 쓴다. */
  pickups: Record<Side, number[]>;
  result: RoundResult | null;
}

export function newRound(random: () => number, first: Side): HulaState {
  const deck = shuffledDeck(random);
  const hands: Record<Side, number[]> = { me: [], cpu: [] };
  for (let i = 0; i < HAND_SIZE; i += 1) {
    hands[first].push(deck.pop()!);
    hands[other(first)].push(deck.pop()!);
  }
  const discard = [deck.pop()!];
  return {
    stock: deck,
    discard,
    hands,
    melds: [],
    turn: first,
    phase: 'draw',
    taken: null,
    freshTurn: true,
    registered: { me: false, cpu: false },
    pickups: { me: [], cpu: [] },
    result: null,
  };
}

export const topDiscard = (state: HulaState): number | null => state.discard[state.discard.length - 1] ?? null;

/** 이 카드를 손패와 함께, 또는 탁자에 바로 내려놓을 수 있는지 */
export function usableNow(hand: readonly number[], melds: readonly Meld[], card: number): boolean {
  if (rankOf(card) === SEVEN) return true;
  if (melds.some((meld) => canAttach(meld.cards, card))) return true;
  return meldsUsing(hand, card).length > 0;
}

/** 손패의 카드와 card로 만들 수 있는 묶음들(card가 꼭 들어간다) */
export function meldsUsing(hand: readonly number[], card: number): number[][] {
  const others = hand.filter((c) => c !== card);
  const out: number[][] = [];
  // 같은 숫자
  const same = others.filter((c) => rankOf(c) === rankOf(card));
  if (same.length >= 2) {
    out.push([card, ...same.slice(0, 2)]);
    if (same.length === 3) out.push([card, ...same]);
  }
  // 이어지는 숫자: card를 품는 구간들
  const suitCards = new Set(others.filter((c) => Math.floor(c / 13) === Math.floor(card / 13)));
  const base = card - (rankOf(card) - 1);
  let low = rankOf(card);
  while (low > 1 && suitCards.has(base + low - 2)) low -= 1;
  let high = rankOf(card);
  while (high < 13 && suitCards.has(base + high)) high += 1;
  for (let from = low; from <= rankOf(card); from += 1) {
    for (let to = Math.max(rankOf(card), from + 2); to <= high; to += 1) {
      const run: number[] = [];
      for (let rank = from; rank <= to; rank += 1) run.push(base + rank - 1);
      out.push(run);
    }
  }
  return out;
}

export function canTakeDiscard(state: HulaState, side: Side = state.turn): boolean {
  const top = topDiscard(state);
  if (state.phase !== 'draw' || state.turn !== side || top === null) return false;
  return usableNow(state.hands[side], state.melds, top);
}

/** 덱에서 한 장 뽑는다. 뽑은 카드를 돌려준다. */
export function drawStock(state: HulaState): number | null {
  if (state.phase !== 'draw' || state.stock.length === 0) return null;
  const card = state.stock.pop()!;
  state.hands[state.turn].push(card);
  state.phase = 'play';
  return card;
}

export function takeDiscard(state: HulaState): number | null {
  if (!canTakeDiscard(state)) return null;
  const card = state.discard.pop()!;
  state.hands[state.turn].push(card);
  state.taken = card;
  state.pickups[state.turn].push(card);
  state.phase = 'play';
  return card;
}

const inHand = (state: HulaState, cards: readonly number[]): boolean =>
  new Set(cards).size === cards.length && cards.every((card) => state.hands[state.turn].includes(card));

/**
 * 고른 카드들을 등록할 수 있는지. 7만 한두 장 고른 것은 한 장씩 따로 등록한다.
 */
export function canMeld(state: HulaState, cards: readonly number[]): boolean {
  if (state.phase !== 'play' || cards.length === 0 || !inHand(state, cards)) return false;
  if (meldKindOf(cards) !== null) return true;
  return cards.length <= 2 && cards.every((card) => rankOf(card) === SEVEN);
}

/** 고른 카드를 등록한다. 해냈으면 true */
export function meld(state: HulaState, cards: readonly number[]): boolean {
  if (!canMeld(state, cards)) return false;
  const kind = meldKindOf(cards);
  const groups = kind === null ? cards.map((card) => [card]) : [sortMeld(cards)];
  for (const group of groups) {
    state.melds.push({ cards: group, owner: state.turn, kind: meldKindOf(group)! });
  }
  removeFromHand(state, cards);
  afterPlace(state);
  return true;
}

export function canLayOff(state: HulaState, card: number, meldIndex: number): boolean {
  const target = state.melds[meldIndex];
  return state.phase === 'play' && target !== undefined && inHand(state, [card]) && canAttach(target.cards, card);
}

/** 탁자의 묶음 하나에 카드 한 장을 붙인다. 해냈으면 true */
export function layOff(state: HulaState, card: number, meldIndex: number): boolean {
  if (!canLayOff(state, card, meldIndex)) return false;
  const target = state.melds[meldIndex];
  target.cards = sortMeld([...target.cards, card]);
  target.kind = meldKindOf(target.cards)!;
  removeFromHand(state, [card]);
  afterPlace(state);
  return true;
}

/** 이 카드가 붙을 수 있는 탁자의 묶음 번호들 */
export function attachTargets(state: HulaState, card: number): number[] {
  return state.melds.flatMap((meld, i) => (canAttach(meld.cards, card) ? [i] : []));
}

export function canDiscard(state: HulaState, card: number): boolean {
  return state.phase === 'play' && state.taken === null && inHand(state, [card]);
}

/** 한 장 버리고 차례를 넘긴다. 해냈으면 true */
export function discard(state: HulaState, card: number): boolean {
  if (!canDiscard(state, card)) return false;
  removeFromHand(state, [card]);
  state.discard.push(card);
  if (state.hands[state.turn].length === 0) {
    finish(state, state.turn);
    return true;
  }
  if (state.stock.length === 0) {
    finishByCount(state);
    return true;
  }
  state.turn = other(state.turn);
  state.phase = 'draw';
  state.freshTurn = !state.registered[state.turn];
  return true;
}

function removeFromHand(state: HulaState, cards: readonly number[]): void {
  const hand = state.hands[state.turn];
  state.hands[state.turn] = hand.filter((card) => !cards.includes(card));
  if (state.taken !== null && cards.includes(state.taken)) state.taken = null;
}

function afterPlace(state: HulaState): void {
  state.registered[state.turn] = true;
  if (state.hands[state.turn].length === 0) finish(state, state.turn);
}

function finish(state: HulaState, winner: Side): void {
  const loser = other(winner);
  const hula = state.freshTurn;
  const shutout = !state.registered[loser];
  const left = { me: handPoints(state.hands.me), cpu: handPoints(state.hands.cpu) };
  const penalty = left[loser] * (hula ? 2 : 1) * (shutout ? 2 : 1);
  state.phase = 'over';
  state.result = { winner, how: hula ? 'hula' : 'out', left, penalty, shutout };
}

function finishByCount(state: HulaState): void {
  const left = { me: handPoints(state.hands.me), cpu: handPoints(state.hands.cpu) };
  const winner: Side | null = left.me === left.cpu ? null : left.me < left.cpu ? 'me' : 'cpu';
  state.phase = 'over';
  state.result = {
    winner,
    how: 'stock',
    left,
    penalty: Math.abs(left.me - left.cpu),
    shutout: false,
  };
}

/** 난이도 */
export const LEVELS = ['easy', 'normal', 'hard'] as const;
export type Level = (typeof LEVELS)[number];
export const LEVEL_NAME: Readonly<Record<Level, string>> = { easy: '쉬움', normal: '보통', hard: '어려움' };
/** 이긴 판의 점수에 곱하는 수. 어려운 상대를 이길수록 기록이 높다. */
export const LEVEL_FACTOR: Readonly<Record<Level, number>> = { easy: 1, normal: 2, hard: 3 };

/** 이 판으로 받는 점수(최고 기록과 코인에 쓴다). 내가 이겼을 때만 점수가 있다. */
export function roundScore(result: RoundResult, level: Level): number {
  if (result.winner !== 'me') return 0;
  return Math.max(1, result.penalty) * LEVEL_FACTOR[level];
}
