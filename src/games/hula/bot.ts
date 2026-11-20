/**
 * 훌라의 컴퓨터 상대. AI 서비스 없이 정해 둔 판단 규칙으로 둔다.
 *
 * - 쉬움: 늘 덱에서 뽑고, 손에 다 갖춰진 묶음만 등록한다. 붙이기는 가끔 놓치고, 버릴 카드는 아무렇게나 고른다.
 * - 보통: 버린 카드가 바로 묶음이 되면 가져온다. 가장 점수가 큰 묶음 조합을 등록하고 붙일 수 있는 것은 다 붙인다.
 *   버릴 때는 짝이 없고 숫자가 큰 카드부터 버린다.
 * - 어려움: 보통에 더해, 이미 나와 버린 카드를 기억해서 더는 짝이 생길 수 없는 카드를 먼저 버리고,
 *   내가 바로 가져가 쓸 수 있는 카드(탁자의 묶음에 붙는 카드, 내가 모으는 숫자 근처의 카드)는 되도록 내주지 않는다.
 *   상대 손이 적게 남으면 큰 카드를 서둘러 버린다.
 */
import { attachTargets, canDiscard, canTakeDiscard, meldsUsing, other, type HulaState, type Level } from './rules';
import { bestMelds, canAttach, cardOf, meldCandidates, pointsOf, rankOf, suitOf, SEVEN, type Suit } from './cards';

/** 컴퓨터가 한 차례에 하는 일 하나. 화면은 이것을 하나씩 보여 준다. */
export type BotStep =
  | { type: 'draw' }
  | { type: 'take' }
  | { type: 'meld'; cards: number[] }
  | { type: 'layoff'; card: number; meld: number }
  | { type: 'discard'; card: number };

/** 뽑기: 덱에서 뽑을지, 버린 카드를 가져올지 */
export function chooseDraw(state: HulaState, level: Level): BotStep {
  if (level !== 'easy' && canTakeDiscard(state)) return { type: 'take' };
  return { type: 'draw' };
}

/**
 * 뽑은 뒤에 할 다음 일 하나(등록, 붙이기, 버리기 가운데). 차례가 끝나면(버렸거나 판이 끝났으면) 더 부르지 않는다.
 * random은 쉬움의 실수와 같은 값끼리의 고르기에 쓴다.
 */
export function choosePlay(state: HulaState, level: Level, random: () => number): BotStep {
  const hand = state.hands[state.turn];

  // 1. 등록: 쉬움은 처음 찾은 묶음을, 나머지는 가장 점수가 큰 조합의 첫 묶음을 낸다.
  const melds = level === 'easy' ? meldCandidates(hand).filter((m) => m.length >= 3 || rankOf(m[0]) === SEVEN) : bestMelds(hand);
  // 가져온 카드가 들어간 묶음을 먼저 낸다(그래야 버릴 수 있다).
  const withTaken = state.taken === null ? null : findMeldWith(hand, state.taken);
  if (withTaken) return { type: 'meld', cards: withTaken };
  if (melds.length > 0) return { type: 'meld', cards: melds[0] };

  // 2. 붙이기
  const order = [...hand].sort((a, b) => pointsOf(b) - pointsOf(a));
  for (const card of order) {
    const targets = attachTargets(state, card);
    if (targets.length === 0) continue;
    if (level === 'easy' && card !== state.taken && random() < 0.4) continue;
    return { type: 'layoff', card, meld: targets[0] };
  }

  // 3. 버리기
  return { type: 'discard', card: chooseDiscard(state, level, random) };
}

function findMeldWith(hand: readonly number[], card: number): number[] | null {
  const all = meldCandidates(hand).filter((meld) => meld.includes(card));
  if (all.length === 0) return null;
  return all.sort((a, b) => b.length - a.length)[0];
}

/** 버릴 카드를 고른다. */
export function chooseDiscard(state: HulaState, level: Level, random: () => number): number {
  const hand = state.hands[state.turn].filter((card) => canDiscard(state, card));
  if (hand.length === 0) return state.hands[state.turn][0];
  if (level === 'easy') {
    // 쉬움: 아무 카드나. 다만 7은 아깝게 여긴다.
    const plain = hand.filter((card) => rankOf(card) !== SEVEN);
    const pool = plain.length > 0 ? plain : hand;
    return pool[Math.floor(random() * pool.length)];
  }
  const seen = level === 'hard' ? seenCards(state) : new Set<number>();
  const foe = other(state.turn);
  const foeLeft = state.hands[foe].length;
  let best = hand[0];
  let bestValue = -Infinity;
  for (const card of hand) {
    let value = level === 'hard' ? hardValue(state, hand, card, seen) : pointsOf(card) - keepValue(hand, card, seen);
    if (level === 'hard') {
      // 상대가 바로 가져가 쓸 수 있는 카드는 내주지 않는다.
      if (attachTargets(state, card).length > 0 || rankOf(card) === SEVEN) value -= HARD.danger;
      value -= foeWants(state.pickups[foe], card) * HARD.want;
      // 상대 손이 얼마 안 남았으면 큰 카드를 먼저 털어 낸다.
      if (foeLeft <= 3) value += pointsOf(card) * HARD.rush;
    }
    // 같은 값이면 조금씩 흔들어서 매번 같은 수를 두지 않게 한다.
    value += random() * 0.5;
    if (value > bestValue) {
      bestValue = value;
      best = card;
    }
  }
  return best;
}

/**
 * 어려움의 버리기 값: 이 카드를 버린 뒤 남은 손으로 앞으로 뽑을 수 있는 쓸모 있는 카드(아직 안 나온 카드 가운데
 * 뽑으면 바로 묶음이 되거나 탁자에 붙는 카드)가 몇 장인지와, 버리는 카드의 숫자를 함께 본다.
 */
function hardValue(state: HulaState, hand: readonly number[], card: number, seen: ReadonlySet<number>): number {
  const rest = hand.filter((c) => c !== card);
  let outs = 0;
  for (let c = 0; c < 52; c += 1) {
    if (c === card || hand.includes(c) || seen.has(c)) continue;
    if (rankOf(c) === SEVEN || state.melds.some((meld) => canAttach(meld.cards, c)) || meldsUsing([...rest, c], c).length > 0) outs += 1;
  }
  return pointsOf(card) * HARD.point + outs * HARD.out + (rankOf(card) === SEVEN ? -20 : 0);
}

/** 어려움의 버리기 판단에 쓰는 무게. 컴퓨터끼리 수천 판을 두어 보며 맞췄다. */
export const HARD = { point: 1, out: 6, danger: 30, want: 4, rush: 0.8 };


/** 이 카드를 손에 두면 좋은 정도: 같은 숫자 짝, 같은 무늬로 붙거나 한 칸 띈 카드, 7 */
function keepValue(hand: readonly number[], card: number, seen: ReadonlySet<number>): number {
  const rank = rankOf(card);
  const suit = suitOf(card);
  let keep = rank === SEVEN ? 20 : 0;
  const pairs = hand.filter((c) => c !== card && rankOf(c) === rank).length;
  // 같은 숫자의 남은 카드가 다 나와 버렸으면 짝이 있어도 묶음이 될 수 없다.
  const liveSame = [0, 1, 2, 3].filter((s) => s !== suit && !hand.includes(cardOf(s as Suit, rank)) && !seen.has(cardOf(s as Suit, rank))).length;
  if (pairs > 0 && (pairs >= 2 || liveSame > 0)) keep += 6 * pairs + 2;
  for (const step of [-2, -1, 1, 2]) {
    const near = rank + step;
    if (near < 1 || near > 13) continue;
    if (!hand.includes(cardOf(suit, near))) continue;
    // 사이를 메우거나 끝에 붙을 카드가 아직 남아 있는지
    const needs = Math.abs(step) === 1 ? [rank - 1, rank + 1, near - 1, near + 1] : [rank + step / 2];
    const live = needs.some((r) => r >= 1 && r <= 13 && !hand.includes(cardOf(suit, r)) && !seen.has(cardOf(suit, r)));
    if (live) keep += Math.abs(step) === 1 ? 5 : 3;
  }
  return keep;
}

/** 버린 카드 더미와 탁자에 나와 있어서 더는 뽑을 수 없는 카드들 */
function seenCards(state: HulaState): Set<number> {
  const seen = new Set<number>(state.discard);
  for (const meld of state.melds) for (const card of meld.cards) seen.add(card);
  return seen;
}

/** 상대가 버린 카드 더미에서 가져간 카드로 보아, 이 카드를 상대가 얼마나 원할지 */
function foeWants(pickups: readonly number[], card: number): number {
  let want = 0;
  for (const picked of pickups) {
    if (rankOf(picked) === rankOf(card)) want += 1;
    if (suitOf(picked) === suitOf(card) && Math.abs(rankOf(picked) - rankOf(card)) <= 2) want += 1;
  }
  return want;
}
