import { describe, expect, it } from 'vitest';
import { createRoom, joinRoom, playMove, roomView } from '../../versus/room';
import { HANDS, options, START_CHIPS } from './rules';
import { pokerTurn, pokerVersus, readPokerMove, readPokerView, seatPlan, type PokerMatch, type PokerVersusMove } from './versus';

function seeded(seed = 11): () => number {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

/** 차례인 사람의 수: 딜할 차례면 딜하고, 아니면 체크나 콜 */
function easyMove(state: PokerMatch): { seat: 0 | 1; move: PokerVersusMove } {
  const seat = pokerTurn(state)!;
  const table = state.table;
  if (!table || table.phase !== 'betting') return { seat, move: { type: 'deal' } };
  const can = options(table, state.humans[seat]);
  return { seat, move: can.check ? { type: 'check' } : { type: 'call' } };
}

const total = (state: PokerMatch): number => state.table!.seats.reduce((sum, seat) => sum + seat.chips + seat.committed * (state.table!.phase === 'betting' ? 1 : 0), 0);

describe('친구와 하는 포커', () => {
  it('처음 딜하는 사람이 컴퓨터 수를 고르고, 사람은 마주 앉는다', () => {
    expect(seatPlan(0).humans).toEqual([0, 1]);
    expect(seatPlan(1).names).toHaveLength(3);
    expect(seatPlan(2).humans).toEqual([0, 2]);
    const state = pokerVersus.start(seeded(), 1);
    expect(state.table).toBeNull();
    expect(pokerTurn(state)).toBe(1);
    expect(pokerVersus.play(state, 0, { type: 'deal', bots: 1 })).toBe(false);
    expect(pokerVersus.play(state, 1, { type: 'deal', bots: 1 })).toBe(true);
    expect(state.table!.seats).toHaveLength(3);
    expect(state.table!.handNo).toBe(1);
    // 처음 딜한 사람이 버튼이다.
    expect(state.table!.button).toBe(state.humans[1]);
    // 컴퓨터는 저절로 둬서, 둘 차례는 늘 사람이다.
    expect(state.humans).toContain(state.table!.toAct);
  });

  it('컴퓨터 없이 둘이서도 할 수 있다', () => {
    const state = pokerVersus.start(seeded(3), 0);
    pokerVersus.play(state, 0, { type: 'deal', bots: 0 });
    expect(state.table!.seats).toHaveLength(2);
    expect(pokerTurn(state)).not.toBeNull();
  });

  it('남의 손패와 덱과 seed는 보내지 않고, 보는 사람이 0번 자리가 된다', () => {
    const state = pokerVersus.start(seeded(5), 0);
    pokerVersus.play(state, 0, { type: 'deal', bots: 2 });
    for (const seat of [0, 1] as const) {
      const view = JSON.parse(JSON.stringify(pokerVersus.view(state, seat)));
      expect(view.seed).toBeUndefined();
      expect(view.table.deck).toEqual([]);
      expect(view.humans[seat]).toBe(0);
      expect(view.table.seats[0].hole).toEqual(state.table!.seats[state.humans[seat]].hole);
      for (let i = 1; i < view.table.seats.length; i += 1) {
        for (const card of view.table.seats[i].hole) expect(card.rank).toBe(0);
      }
      const read = readPokerView(view);
      expect(read).not.toBeNull();
      expect(read!.table!.seats).toHaveLength(4);
    }
  });

  it('차례가 아니거나 둘 수 없는 수는 받지 않는다', () => {
    const state = pokerVersus.start(seeded(7), 0);
    pokerVersus.play(state, 0, { type: 'deal' });
    const turn = pokerTurn(state)!;
    const other = turn === 0 ? 1 : 0;
    expect(pokerVersus.play(state, other, { type: 'check' })).toBe(false);
    expect(pokerVersus.play(state, turn, { type: 'deal' })).toBe(false);
    expect(pokerVersus.play(state, turn, { type: 'raise', to: 1 })).toBe(false);
    expect(readPokerMove({ type: 'deal', bots: 3 })).toBeNull();
    expect(readPokerMove({ type: 'raise', to: 'a' })).toBeNull();
    expect(readPokerMove({ type: 'allin' })).toEqual({ type: 'allin' });
  });

  it('방에서 끝까지 하면 칩이 많은 사람이 이기고, 칩은 새지 않는다', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const random = seeded(seed);
      const room = createRoom<PokerMatch>('poker', '민수');
      expect(joinRoom(room, pokerVersus, '지원', random)).toBe(true);
      const bots = seed % 3;
      for (let step = 0; step < 2000 && room.status === 'playing'; step += 1) {
        const state = room.round!;
        const { seat, move } = easyMove(state);
        const sent = state.table === null && move.type === 'deal' ? { type: 'deal' as const, bots } : move;
        expect(playMove(room, pokerVersus, seat, sent)).toBe(true);
        if (state.table && state.table.phase !== 'betting') expect(total(state)).toBe(START_CHIPS * state.table.seats.length);
      }
      expect(room.status).toBe('over');
      const state = room.round!;
      expect(state.table!.handNo).toBeLessThanOrEqual(HANDS);
      const [a, b] = state.humans.map((index) => state.table!.seats[index]);
      if (a.out !== b.out) expect(room.wins[a.out ? 1 : 0]).toBe(1);
      else if (a.chips !== b.chips) expect(room.wins[a.chips > b.chips ? 0 : 1]).toBe(1);
      const view = roomView(room, pokerVersus, 1, 'ABCDEF');
      expect(readPokerView(JSON.parse(JSON.stringify(view.game)))).not.toBeNull();
    }
  });

  it('쇼다운에서 끝까지 남은 사람의 손패는 모두에게 보인다', () => {
    for (let seed = 1; seed < 40; seed += 1) {
      const state = pokerVersus.start(seeded(seed), 0);
      pokerVersus.play(state, 0, { type: 'deal', bots: 0 });
      for (let step = 0; step < 20 && state.table!.phase === 'betting'; step += 1) {
        const { seat, move } = easyMove(state);
        pokerVersus.play(state, seat, move);
      }
      if (!state.table!.result?.showdown) continue;
      const view = pokerVersus.view(state, 0);
      expect(view.table!.seats[1].hole).toEqual(state.table!.seats[1].hole);
      expect(view.table!.result!.values[1]).not.toBeNull();
      return;
    }
    throw new Error('쇼다운까지 간 판이 없다');
  });
});
