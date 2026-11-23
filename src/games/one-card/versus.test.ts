import { describe, expect, it } from 'vitest';
import { createRoom, joinRoom, playMove, roomView } from '../../versus/room';
import { canPlay, type GameState } from './rules';
import { oneCardTurn, oneCardVersus, readOneCardMove, readOneCardView, type OneCardMatch } from './versus';

function seeded(seed = 7): () => number {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

/** 지금 차례인 자리가 둘 수 있는 수 하나: 낼 수 있는 카드가 있으면 내고, 없으면 받는다. */
function anyMove(state: OneCardMatch) {
  const game = state.game;
  const seat = oneCardTurn(game)!;
  if (game.oneCard !== null) return { seat, move: { type: 'call' as const } };
  if (game.choosingSuit) return { seat, move: { type: 'suit' as const, suit: 'S' as const } };
  const card = game.players[seat].hand.find((item) => canPlay(game, item));
  return { seat, move: card ? { type: 'play' as const, card: card.id } : { type: 'draw' as const } };
}

describe('친구와 하는 원카드', () => {
  it('두 사람에게 7장씩 나누고, 먼저 할 자리부터 시작한다', () => {
    const state = oneCardVersus.start(seeded(), 1);
    expect(state.game.players).toHaveLength(2);
    expect(state.game.players.every((player) => player.hand.length === 7)).toBe(true);
    expect(oneCardVersus.turnOf(state)).toBe(1);
  });

  it('보는 자리가 늘 0번이 되고, 상대의 손패와 덱과 seed는 가린다', () => {
    const state = oneCardVersus.start(seeded(), 0);
    const one = oneCardVersus.view(state, 1);
    expect(one.game.players[0].hand.map((card) => card.id)).toEqual(state.game.players[1].hand.map((card) => card.id));
    expect(one.game.players[1].hand.every((card) => card.id < 0)).toBe(true);
    expect(one.game.deck.every((card) => card.id < 0)).toBe(true);
    expect(one.game.seed).toBe(0);
    expect(one.game.turn).toBe(1);
    const sent = JSON.parse(JSON.stringify(one));
    expect(readOneCardView(sent)).not.toBeNull();
    const ids = new Set(state.game.players[0].hand.map((card) => card.id));
    expect(sent.game.players.flatMap((p: GameState['players'][number]) => p.hand).some((card: { id: number }) => ids.has(card.id))).toBe(false);
  });

  it('차례가 아닌 자리의 수는 받지 않는다', () => {
    const state = oneCardVersus.start(seeded(), 0);
    expect(oneCardVersus.play(state, 1, { type: 'draw' })).toBe(false);
    expect(oneCardVersus.play(state, 0, { type: 'draw' })).toBe(true);
    expect(oneCardVersus.turnOf(state)).toBe(1);
    expect(state.events.some((event) => event.k === 'draw')).toBe(true);
  });

  it('카드가 한 장 남으면 그 사람이 외치거나 놓칠 때까지 차례가 머문다', () => {
    const state = oneCardVersus.start(seeded(), 0);
    const game = state.game;
    // 0번의 손을 두 장으로 줄이고, 낼 수 있는 카드를 하나 둔다.
    const top = game.discard[game.discard.length - 1];
    const same = game.deck.find((card) => card.suit === top.suit && card.rank >= 4 && card.rank <= 6)!;
    game.deck = game.deck.filter((card) => card !== same);
    game.players[0].hand = [same, game.players[0].hand[0]];
    expect(oneCardVersus.play(state, 0, { type: 'play', card: same.id })).toBe(true);
    expect(game.oneCard).toBe(0);
    expect(oneCardVersus.turnOf(state)).toBe(0);
    expect(oneCardVersus.play(state, 1, { type: 'draw' })).toBe(false);
    expect(oneCardVersus.play(state, 0, { type: 'miss' })).toBe(true);
    expect(game.players[0].hand).toHaveLength(2);
    expect(oneCardVersus.turnOf(state)).toBe(1);
  });

  it('방 규칙과 함께 판을 끝까지 하면 이긴 자리가 정해진다', () => {
    const room = createRoom<OneCardMatch>('one-card', '민수');
    joinRoom(room, oneCardVersus, '지원', seeded(3));
    let guard = 0;
    while (room.status === 'playing' && guard < 2000) {
      const { seat, move } = anyMove(room.round!);
      expect(playMove(room, oneCardVersus, seat, move)).toBe(true);
      // 매번 두 자리 모두에게 보낼 판을 다시 읽을 수 있어야 한다.
      for (const look of [0, 1] as const) {
        const view = roomView(room, oneCardVersus, look, 'ABCDEF');
        expect(readOneCardView(JSON.parse(JSON.stringify(view.game)))).not.toBeNull();
      }
      guard += 1;
    }
    expect(room.status).toBe('over');
    expect(room.wins[0] + room.wins[1]).toBe(1);
  });

  it('수를 읽을 때 모양이 맞지 않으면 버린다', () => {
    expect(readOneCardMove({ type: 'play', card: 3 })).toEqual({ type: 'play', card: 3 });
    expect(readOneCardMove({ type: 'play', card: 99 })).toBeNull();
    expect(readOneCardMove({ type: 'suit', suit: 'X' })).toBeNull();
    expect(readOneCardMove({ type: 'call' })).toEqual({ type: 'call' });
    expect(readOneCardMove('draw')).toBeNull();
  });
});
