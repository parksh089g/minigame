import { describe, expect, it } from 'vitest';
import { createRoom, joinRoom, playMove, roomView } from '../../versus/room';
import { availableActions, handTotal, ROUNDS, START_CHIPS } from './rules';
import { blackjackTurn, blackjackVersus, readBlackjackMove, readBlackjackView, type BlackjackMatch } from './versus';

function seeded(seed = 11): () => number {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

/** 차례인 자리의 그럴듯한 수: 걸 때는 10칩, 손은 16까지 받고 멈춘다. */
function simpleMove(state: BlackjackMatch) {
  const seat = blackjackTurn(state)!;
  const table = state.table;
  if (table.phase === 'betting' || table.phase === 'settled') return { seat, move: { type: 'bet' as const, amount: 10 } };
  const seatHands = table.seats[seat];
  const hand = seatHands.hands[seatHands.active];
  const can = availableActions(table);
  return { seat, move: { type: handTotal(hand.cards).total < 17 && can.hit ? ('hit' as const) : ('stand' as const) } };
}

describe('친구와 하는 블랙잭', () => {
  it('두 사람이 차례로 걸면 카드를 나누고, 먼저 거는 사람은 딜마다 바뀐다', () => {
    const state = blackjackVersus.start(seeded(), 1);
    expect(state.table.seats.map((seat) => seat.chips)).toEqual([START_CHIPS, START_CHIPS]);
    expect(blackjackTurn(state)).toBe(1);
    expect(blackjackVersus.play(state, 0, { type: 'bet', amount: 20 })).toBe(false);
    expect(blackjackVersus.play(state, 1, { type: 'bet', amount: 20 })).toBe(true);
    expect(state.table.phase).toBe('betting');
    expect(blackjackVersus.play(state, 0, { type: 'bet', amount: 30 })).toBe(true);
    expect(state.table.round).toBe(1);
    expect(state.first).toBe(0);
    expect(state.table.seats[0].hands[0].bet).toBe(30);
    expect(state.table.seats[1].hands[0].bet).toBe(20);
  });

  it('딜러의 엎은 카드와 슈는 보내지 않는다', () => {
    const state = blackjackVersus.start(seeded(5), 0);
    blackjackVersus.play(state, 0, { type: 'bet', amount: 10 });
    blackjackVersus.play(state, 1, { type: 'bet', amount: 10 });
    const view = JSON.parse(JSON.stringify(blackjackVersus.view(state, 0)));
    if (state.table.holeHidden) expect(view.table.dealer[1].rank).toBe(0);
    expect(view.table.shoe).toEqual([]);
    expect(view.seed).toBeUndefined();
    expect(readBlackjackView(view)).not.toBeNull();
  });

  it('방 규칙과 함께 정한 딜 수만큼 하면 칩이 많은 사람이 이긴다', () => {
    const room = createRoom<BlackjackMatch>('blackjack', '민수');
    joinRoom(room, blackjackVersus, '지원', seeded(9));
    let guard = 0;
    while (room.status === 'playing' && guard < 1000) {
      const { seat, move } = simpleMove(room.round!);
      expect(playMove(room, blackjackVersus, seat, move)).toBe(true);
      const view = roomView(room, blackjackVersus, seat, 'ABCDEF');
      expect(readBlackjackView(JSON.parse(JSON.stringify(view.game)))).not.toBeNull();
      guard += 1;
    }
    expect(room.status).toBe('over');
    const table = room.round!.table;
    expect(table.phase).toBe('settled');
    expect(table.round === ROUNDS || table.seats.some((seat) => seat.chips <= 0)).toBe(true);
    const [a, b] = table.seats.map((seat) => seat.chips);
    if (a !== b) expect(room.wins[a > b ? 0 : 1]).toBe(1);
  });

  it('수를 읽을 때 모양이 맞지 않으면 버린다', () => {
    expect(readBlackjackMove({ type: 'bet', amount: 25 })).toEqual({ type: 'bet', amount: 25 });
    expect(readBlackjackMove({ type: 'bet', amount: -1 })).toBeNull();
    expect(readBlackjackMove({ type: 'hit' })).toEqual({ type: 'hit' });
    expect(readBlackjackMove({ type: 'fold' })).toBeNull();
  });
});
