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
  it('두 사람은 같은 카드 순서로 하고, 먼저 하는 사람이 다 해야 다음 사람 차례다', () => {
    const state = highLowVersus.start(seeded(), 1);
    expect(state.runs[0].current).toEqual(state.runs[1].current);
    expect(state.runs[0].deck).toEqual(state.runs[1].deck);
    expect(highLowTurn(state)).toBe(1);
    expect(highLowVersus.play(state, 0, { type: 'skip' })).toBe(false);
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
