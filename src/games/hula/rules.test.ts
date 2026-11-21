import { describe, expect, it } from 'vitest';
import { chooseDraw, choosePlay } from './bot';
import { bestMelds, cardOf, handPoints, meldKindOf, seededRandom, type Suit } from './cards';
import {
  attachTargets,
  canLayOff,
  canMeld,
  canTakeDiscard,
  discard,
  drawStock,
  layOff,
  LEVELS,
  meld,
  newRound,
  roundScore,
  takeDiscard,
  type HulaState,
  type Level,
  type Side,
} from './rules';

const S = 0 as Suit;
const H = 1 as Suit;
const D = 2 as Suit;
const C = 3 as Suit;

/** 원하는 손패로 판을 만든다. 나머지 카드는 덱에 둔다. */
function fixed(me: number[], cpu: number[], top: number, turn: Side = 'me'): HulaState {
  const used = new Set([...me, ...cpu, top]);
  return {
    stock: Array.from({ length: 52 }, (_, i) => i).filter((card) => !used.has(card)),
    discard: [top],
    hands: { me: [...me], cpu: [...cpu] },
    melds: [],
    turn,
    phase: 'draw',
    taken: null,
    freshTurn: true,
    registered: { me: false, cpu: false },
    pickups: { me: [], cpu: [] },
    result: null,
  };
}

describe('묶음', () => {
  it('같은 숫자 3~4장, 같은 무늬로 이어진 3장 이상, 혼자 놓인 7을 알아본다', () => {
    expect(meldKindOf([cardOf(S, 5), cardOf(H, 5), cardOf(D, 5)])).toBe('set');
    expect(meldKindOf([cardOf(S, 1), cardOf(S, 2), cardOf(S, 3)])).toBe('run');
    expect(meldKindOf([cardOf(H, 7)])).toBe('seven');
    expect(meldKindOf([cardOf(S, 12), cardOf(S, 13), cardOf(S, 1)])).toBeNull();
    expect(meldKindOf([cardOf(S, 4), cardOf(H, 5), cardOf(S, 6)])).toBeNull();
    expect(meldKindOf([cardOf(S, 5), cardOf(H, 5)])).toBeNull();
  });

  it('손패에서 점수가 가장 큰 묶음 조합을 찾는다', () => {
    const hand = [cardOf(S, 9), cardOf(S, 10), cardOf(S, 11), cardOf(H, 11), cardOf(D, 11), cardOf(C, 2)];
    const melds = bestMelds(hand);
    // J 세 장(33)보다 9-10-J(30)... 겹치므로 둘 중 하나: 더 큰 J 세 장을 고른다.
    expect(melds).toHaveLength(1);
    expect(handPoints(melds[0])).toBe(33);
  });
});

describe('한 판의 진행', () => {
  it('버린 카드는 바로 쓸 수 있을 때만 가져오고, 쓰기 전에는 버릴 수 없다', () => {
    const state = fixed([cardOf(S, 4), cardOf(H, 4), cardOf(C, 9), cardOf(D, 13)], [cardOf(S, 2)], cardOf(D, 4));
    expect(canTakeDiscard(state)).toBe(true);
    const card = takeDiscard(state)!;
    expect(discard(state, cardOf(C, 9))).toBe(false);
    expect(meld(state, [cardOf(S, 4), cardOf(H, 4), card])).toBe(true);
    expect(discard(state, cardOf(C, 9))).toBe(true);
    expect(state.turn).toBe('cpu');

    const none = fixed([cardOf(S, 4), cardOf(C, 9)], [cardOf(S, 2)], cardOf(D, 12));
    expect(canTakeDiscard(none)).toBe(false);
  });

  it('가져온 카드를 낼 길을 없애는 등록은 받지 않는다(판이 멈추지 않게)', () => {
    // 9♠ 9♣ 8♠ 10♠ + 쓸모없는 카드를 들고 9♥를 가져온다.
    const me = [cardOf(S, 9), cardOf(C, 9), cardOf(S, 8), cardOf(S, 10), cardOf(D, 2), cardOf(C, 13)];
    const state = fixed(me, [cardOf(H, 2)], cardOf(H, 9));
    expect(takeDiscard(state)).toBe(cardOf(H, 9));
    const run = [cardOf(S, 8), cardOf(S, 9), cardOf(S, 10)];
    // 8♠-9♠-10♠부터 내면 9♥의 짝(9♠)이 사라지므로 막는다.
    expect(canMeld(state, run)).toBe(false);
    expect(meld(state, run)).toBe(false);
    expect(state.hands.me).toHaveLength(7);
    // 9♥와 함께 내면 된다. 그 뒤에는 무엇이든 자유롭다.
    expect(meld(state, [cardOf(H, 9), cardOf(S, 9), cardOf(C, 9)])).toBe(true);
    expect(state.taken).toBeNull();
    expect(discard(state, cardOf(C, 13))).toBe(true);
  });

  it('가져온 카드를 쓸 길이 남으면 다른 묶음부터 내도 된다', () => {
    // 9♥는 9♠ 9♣ 9♦로도 묶이므로, 8♠-9♠-10♠를 먼저 내도 9♣ 9♦가 남는다.
    const me = [cardOf(S, 9), cardOf(C, 9), cardOf(D, 9), cardOf(S, 8), cardOf(S, 10), cardOf(C, 13)];
    const state = fixed(me, [cardOf(H, 2)], cardOf(H, 9));
    takeDiscard(state);
    expect(meld(state, [cardOf(S, 8), cardOf(S, 9), cardOf(S, 10)])).toBe(true);
    expect(state.taken).toBe(cardOf(H, 9));
    expect(meld(state, [cardOf(H, 9), cardOf(C, 9), cardOf(D, 9)])).toBe(true);
    expect(discard(state, cardOf(C, 13))).toBe(true);
  });

  it('가져온 카드를 낼 길을 없애는 붙이기도 받지 않는다', () => {
    // 탁자에 J♠-Q♠-K♠가 있고, 손에 10♠ 10♣를 들고 10♥를 가져온다.
    // 10♠를 J♠-Q♠-K♠에 붙이면 10♥의 짝이 10♣ 하나만 남아 낼 수 없다.
    const me = [cardOf(S, 10), cardOf(C, 10), cardOf(D, 2), cardOf(C, 13)];
    const state = fixed(me, [cardOf(H, 2)], cardOf(H, 10));
    state.melds.push({ cards: [cardOf(S, 11), cardOf(S, 12), cardOf(S, 13)], owner: 'cpu', kind: 'run' });
    takeDiscard(state);
    expect(canLayOff(state, cardOf(S, 10), 0)).toBe(false);
    expect(layOff(state, cardOf(S, 10), 0)).toBe(false);
    expect(attachTargets(state, cardOf(S, 10))).toEqual([]);
    expect(meld(state, [cardOf(H, 10), cardOf(S, 10), cardOf(C, 10)])).toBe(true);
  });

  it('가져온 카드가 있을 때 컴퓨터는 막히는 묶음을 고르지 않는다', () => {
    const cpu = [cardOf(S, 9), cardOf(C, 9), cardOf(S, 8), cardOf(S, 10), cardOf(D, 2), cardOf(C, 13)];
    for (const level of LEVELS) {
      const state = fixed([cardOf(H, 2)], cpu, cardOf(H, 9), 'cpu');
      expect(takeDiscard(state)).toBe(cardOf(H, 9));
      const step = choosePlay(state, level, () => 0.5);
      expect(step.type).toBe('meld');
      expect(meld(state, (step as { cards: number[] }).cards)).toBe(true);
      expect(state.taken).toBeNull();
    }
  });

  it('탁자의 묶음에 붙일 수 있고, 손을 다 비우면 이긴다', () => {
    const state = fixed([cardOf(S, 4), cardOf(S, 5), cardOf(S, 6), cardOf(S, 7)], [cardOf(H, 10), cardOf(H, 2)], cardOf(D, 1));
    state.registered.me = true;
    state.freshTurn = false;
    drawStock(state);
    const drawn = state.hands.me[4];
    expect(meld(state, [cardOf(S, 4), cardOf(S, 5), cardOf(S, 6)])).toBe(true);
    expect(layOff(state, cardOf(S, 7), 0)).toBe(true);
    expect(state.melds[0].cards).toHaveLength(4);
    expect(discard(state, drawn)).toBe(true);
    expect(state.result).toMatchObject({ winner: 'me', how: 'out', shutout: true, penalty: 24 });
  });

  it('하나도 등록하지 않았다가 한 차례에 모두 내려놓으면 훌라라서 두 배, 상대가 하나도 못 냈으면(박) 또 두 배다', () => {
    const me = [cardOf(S, 1), cardOf(S, 2), cardOf(S, 3), cardOf(H, 9), cardOf(D, 9), cardOf(C, 9)];
    const state = fixed(me, [cardOf(H, 10), cardOf(H, 3)], cardOf(H, 7));
    expect(takeDiscard(state)).toBe(cardOf(H, 7));
    expect(meld(state, [cardOf(H, 7)])).toBe(true);
    expect(meld(state, [cardOf(S, 1), cardOf(S, 2), cardOf(S, 3)])).toBe(true);
    expect(meld(state, [cardOf(H, 9), cardOf(D, 9), cardOf(C, 9)])).toBe(true);
    expect(state.result).toMatchObject({ winner: 'me', how: 'hula', shutout: true, penalty: 13 * 4 });
    expect(roundScore(state.result!, 'hard')).toBe(13 * 4 * 3);
  });

  it('덱이 떨어지면 남은 숫자의 합이 적은 쪽이 이긴다', () => {
    const state = fixed([cardOf(S, 2), cardOf(C, 13)], [cardOf(H, 10), cardOf(H, 12)], cardOf(D, 1));
    state.stock = [cardOf(D, 3)];
    drawStock(state);
    expect(discard(state, cardOf(C, 13))).toBe(true);
    expect(state.result).toMatchObject({ winner: 'me', how: 'stock', left: { me: 5, cpu: 22 }, penalty: 17 });
  });
});

/** 컴퓨터끼리 한 판을 끝까지 둔다. */
function playOut(seed: number, levels: Record<Side, Level>): HulaState {
  const random = seededRandom(seed);
  const state = newRound(random, seed % 2 === 0 ? 'me' : 'cpu');
  for (let turns = 0; turns < 500 && state.phase !== 'over'; turns += 1) {
    const level = levels[state.turn];
    const pick = chooseDraw(state, level);
    if (pick.type === 'take') expect(takeDiscard(state)).not.toBeNull();
    else expect(drawStock(state)).not.toBeNull();
    for (let steps = 0; steps < 30 && state.phase === 'play'; steps += 1) {
      const step = choosePlay(state, level, random);
      if (step.type === 'meld') expect(meld(state, step.cards)).toBe(true);
      else if (step.type === 'layoff') expect(layOff(state, step.card, step.meld)).toBe(true);
      else if (step.type === 'discard') {
        expect(discard(state, step.card)).toBe(true);
        break;
      }
    }
  }
  return state;
}

describe('컴퓨터 상대', () => {
  it('어느 난이도끼리 두어도 규칙을 어기지 않고 판이 끝난다', () => {
    for (let seed = 1; seed <= 120; seed += 1) {
      const a = LEVELS[seed % 3];
      const b = LEVELS[Math.floor(seed / 3) % 3];
      const state = playOut(seed, { me: a, cpu: b });
      expect(state.phase, `seed ${seed}`).toBe('over');
      const total = state.stock.length + state.discard.length + state.hands.me.length + state.hands.cpu.length
        + state.melds.reduce((sum, m) => sum + m.cards.length, 0);
      expect(total).toBe(52);
    }
  });

  it('어려울수록 더 자주 이긴다', () => {
    const wins = (strong: Level, weak: Level): number => {
      let count = 0;
      for (let seed = 1; seed <= 300; seed += 1) {
        if (playOut(seed, { me: strong, cpu: weak }).result?.winner === 'me') count += 1;
      }
      return count;
    };
    expect(wins('normal', 'easy')).toBeGreaterThan(150);
    expect(wins('hard', 'normal')).toBeGreaterThan(150);
  });
});
