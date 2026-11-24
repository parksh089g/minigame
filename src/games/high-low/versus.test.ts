import { describe, expect, it } from 'vitest';
import { createRoom, joinRoom, playMove, roomView } from '../../versus/room';
import { rate10For } from './chips';
import { highLowTurn, highLowVersus, readHighLowMove, readHighLowView, type HighLowMatch } from './versus';

function seeded(seed = 13): () => number {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

describe('친구와 하는 하이로우', () => {
  it('두 사람은 따로 섞인 카드로 하고, 먼저 하는 사람이 다 해야 다음 사람 차례다', () => {
    const state = highLowVersus.start(seeded(), 1);
    expect(highLowTurn(state)).toBe(1);
    expect(highLowVersus.play(state, 0, { type: 'skip' })).toBe(false);
  });

  it('한 폰으로 할 때 뒷사람이 앞사람의 카드를 봐도 자기 카드를 알 수 없다', () => {
    const order = (match: HighLowMatch, seat: 0 | 1) => [...match.runs[seat].deck, match.runs[seat].current].map((card) => `${card.suit}${card.rank}`);
    let same = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const state = highLowVersus.start(seeded(seed * 7919), 0);
      const [a, b] = [order(state, 0), order(state, 1)];
      // 두 묶음 모두 52장이 한 장씩 다 있다.
      expect(new Set(a).size).toBe(52);
      expect([...a].sort()).toEqual([...b].sort());
      expect(a).not.toEqual(b);
      // 앞쪽 몇 장(실제로 펼쳐질 카드)의 숫자가 우연 이상으로 겹치지 않는다.
      for (let i = 0; i < 13; i += 1) if (state.runs[0].deck.at(-1 - i)!.rank === state.runs[1].deck.at(-1 - i)!.rank) same += 1;
    }
    // 숫자가 같을 확률은 1/13쯤이라 40판 × 13장 = 520장에서 40장 안팎이 겹친다. 같은 순서라면 520장이 다 겹친다.
    expect(same).toBeLessThan(80);
  });

  it('앞사람이 넘기거나 고르는 것이 뒷사람의 카드를 바꾸지 않는다', () => {
    const state = highLowVersus.start(seeded(5), 0);
    const before = JSON.stringify([state.runs[1].current, state.runs[1].deck]);
    expect(highLowVersus.play(state, 0, { type: 'skip' })).toBe(true);
    const run = state.runs[0];
    const guess = rate10For('high', run.current.rank, run.deck) > 0 ? 'high' : 'low';
    expect(highLowVersus.play(state, 0, { type: 'guess', guess, bet: 10 })).toBe(true);
    expect(JSON.stringify([state.runs[1].current, state.runs[1].deck])).toBe(before);
  });

  it('내 판을 마치기 전에는 상대가 본 카드를 보내지 않고, 남은 카드는 순서 없이 보낸다', () => {
    const room = createRoom<HighLowMatch>('high-low', '민수');
    joinRoom(room, highLowVersus, '지원', seeded(21));
    const state = room.round!;
    const first = state.first;
    const second = first === 0 ? 1 : 0;
    while (highLowTurn(state) === first) {
      const run = state.runs[first];
      const guess = rate10For('high', run.current.rank, run.deck) > 0 ? 'high' : 'low';
      expect(playMove(room, highLowVersus, first, { type: 'guess', guess, bet: 10 })).toBe(true);
    }
    const view = roomView(room, highLowVersus, second, 'ABCDEF').game!;
    expect(view.foe.done).toBe(true);
    expect(view.foe.history).toEqual([]);
    const deck = view.mine.deck.map((card) => card.rank);
    expect(deck).toEqual([...deck].sort((a, b) => a - b));
    expect(readHighLowView(JSON.parse(JSON.stringify(view)))).not.toBeNull();
    // 앞사람은 이제 상대가 무엇을 하는지 본다(이미 본 카드들이다).
    const firstView = roomView(room, highLowVersus, first, 'ABCDEF').game!;
    expect(firstView.mine.history.length).toBeGreaterThan(0);

    while (room.status === 'playing') {
      const run = state.runs[second];
      const guess = rate10For('low', run.current.rank, run.deck) > 0 ? 'low' : 'high';
      expect(playMove(room, highLowVersus, second, { type: 'guess', guess, bet: 10 })).toBe(true);
    }
    expect(room.status).toBe('over');
    const after = roomView(room, highLowVersus, second, 'ABCDEF').game!;
    expect(after.foe.history.length).toBeGreaterThan(0);
    const [a, b] = state.runs.map((run) => run.chips);
    expect(room.wins[0] + room.wins[1]).toBe(a === b ? 0 : 1);
  });

  it('수를 읽을 때 모양이 맞지 않으면 버린다', () => {
    expect(readHighLowMove({ type: 'guess', guess: 'high', bet: 10 })).toEqual({ type: 'guess', guess: 'high', bet: 10 });
    expect(readHighLowMove({ type: 'guess', guess: 'up', bet: 10 })).toBeNull();
    expect(readHighLowMove({ type: 'skip' })).toEqual({ type: 'skip' });
  });
});
