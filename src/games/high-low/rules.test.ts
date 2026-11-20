import { describe, expect, it } from 'vitest';
import {
  coinsFor,
  countOutcomes,
  judge,
  LIVES,
  makeGuess,
  newDeck,
  pointsFor,
  rankLabel,
  skipCard,
  SKIPS,
  startState,
  streakBonus,
  winChance,
  type Card,
  type HighLowState,
} from './rules';

const card = (rank: number): Card => ({ rank, suit: 'spade' });

/** 지금 카드와 뒤집힐 카드를 정해 둔 상태. 묶음의 맨 끝이 다음 카드다. */
function stateWith(current: number, deck: number[]): HighLowState {
  return { ...startState(), current: card(current), deck: deck.map(card) };
}

describe('하이로우 규칙', () => {
  it('카드 묶음은 52장이고 같은 카드가 없다', () => {
    const deck = newDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map((c) => `${c.rank}${c.suit}`)).size).toBe(52);
  });

  it('카드 글자는 A, 숫자, J, Q, K다', () => {
    expect([1, 2, 10, 11, 12, 13].map(rankLabel)).toEqual(['A', '2', '10', 'J', 'Q', 'K']);
  });

  it('높다·낮다를 맞히고, 같은 숫자는 비긴다', () => {
    expect(judge('high', 5, 9)).toBe('win');
    expect(judge('high', 5, 2)).toBe('lose');
    expect(judge('low', 5, 2)).toBe('win');
    expect(judge('low', 5, 5)).toBe('tie');
  });

  it('남은 카드로 가능성과 점수를 셈한다: 나오기 어려운 쪽이 점수가 크다', () => {
    const deck = [1, 2, 3, 9, 10, 11, 12, 13].map(card);
    expect(countOutcomes(8, deck)).toEqual({ high: 5, low: 3, same: 0 });
    expect(winChance('high', 8, deck)).toBeCloseTo(5 / 8);
    expect(pointsFor('high', 8, deck)).toBe(2);
    expect(pointsFor('low', 8, deck)).toBe(3);
    // K보다 높은 카드는 없어서 고를 수 없다.
    expect(pointsFor('high', 13, newDeck())).toBe(0);
    // 아주 드문 쪽도 10점까지만 준다.
    expect(pointsFor('low', 2, newDeck())).toBe(10);
  });

  it('맞히면 점수와 연속 기록이 쌓이고 연속 5번마다 보너스가 붙는다', () => {
    expect(streakBonus(4)).toBe(0);
    expect(streakBonus(5)).toBe(1);
    expect(streakBonus(100)).toBe(5);
    const state = stateWith(2, [13, 13, 13]);
    state.streak = 5;
    const outcome = makeGuess(state, 'high');
    expect(outcome?.verdict).toBe('win');
    expect(outcome?.points).toBe(1 + 1);
    expect(state.streak).toBe(6);
    expect(state.score).toBe(2);
    expect(state.current.rank).toBe(13);
  });

  it('틀리면 하트를 잃고 연속이 끊기며, 하트를 다 잃으면 끝난다', () => {
    const state = stateWith(7, [1, 1, 1, 1, 13]);
    state.streak = 3;
    state.lives = 1;
    const outcome = makeGuess(state, 'low');
    expect(outcome?.verdict).toBe('lose');
    expect(outcome?.over).toBe(true);
    expect(state.streak).toBe(0);
    expect(state.bestStreak).toBe(0);
    expect(makeGuess(state, 'low')).toBeNull();
  });

  it('비기면 점수도 하트도 연속도 그대로다', () => {
    const state = stateWith(7, [13, 7]);
    state.streak = 2;
    const outcome = makeGuess(state, 'high');
    expect(outcome?.verdict).toBe('tie');
    expect(state.lives).toBe(LIVES);
    expect(state.streak).toBe(2);
    expect(state.score).toBe(0);
  });

  it('마지막 장을 뽑으면 바로 새로 섞어서 묶음이 비지 않는다', () => {
    const state = stateWith(3, [9]);
    const outcome = makeGuess(state, 'high');
    expect(outcome?.reshuffled).toBe(true);
    expect(state.deck).toHaveLength(52);
    expect(state.reshuffles).toBe(1);
  });

  it('넘기기는 두 번까지이고 연속 기록을 지킨다', () => {
    const state = stateWith(7, [1, 2, 3, 4]);
    state.streak = 4;
    for (let i = 0; i < SKIPS; i += 1) expect(skipCard(state)).not.toBeNull();
    expect(skipCard(state)).toBeNull();
    expect(state.streak).toBe(4);
    expect(state.current.rank).toBe(3);
  });

  it('한 판은 언젠가 끝난다', () => {
    const state = startState();
    let guard = 0;
    while (state.lives > 0 && guard < 10_000) {
      makeGuess(state, state.current.rank <= 7 ? 'high' : 'low');
      guard += 1;
    }
    expect(state.lives).toBe(0);
  });

  it('코인은 점수의 절반이다', () => {
    expect(coinsFor(0)).toBe(0);
    expect(coinsFor(25)).toBe(12);
  });
});
