import { describe, expect, it } from 'vitest';
import { chooseMove, chooseSuitFor, selfCallDelay } from './bot';
import {
  activePlayers,
  attackPower,
  callOneCard,
  canPlay,
  catchOneCard,
  chooseSuit,
  createGame,
  drawTurn,
  fullDeck,
  LEVELS,
  matchScore,
  MAX_HAND,
  playCard,
  takeEvents,
  type Card,
  type GameState,
  type Level,
  type Suit,
} from './rules';

const card = (id: number, suit: Suit | null, rank: number): Card => ({ id, suit, rank });

/** 원하는 손과 맨 위 카드로 판을 꾸민다. */
function setup(hands: Card[][], top: Card, extra: Partial<GameState> = {}): GameState {
  const state = createGame(hands.length - 1, 7);
  state.players = hands.map((hand) => ({ hand, out: false }));
  state.voids = hands.map(() => []);
  state.discard = [top];
  state.suit = top.suit;
  state.deck = Array.from({ length: 30 }, (_, i) => card(500 + i, 'C', 4));
  Object.assign(state, extra);
  return state;
}

describe('카드 더미', () => {
  it('트럼프 52장과 조커 2장이고 번호가 겹치지 않는다', () => {
    const deck = fullDeck();
    expect(deck).toHaveLength(54);
    expect(new Set(deck.map((item) => item.id)).size).toBe(54);
  });

  it('처음에 7장씩 나누고 특수 카드가 아닌 것을 뒤집는다', () => {
    for (let seed = 1; seed < 40; seed += 1) {
      const state = createGame(3, seed);
      expect(state.players.every((player) => player.hand.length === 7)).toBe(true);
      const top = state.discard[0];
      expect(top.suit).not.toBeNull();
      expect([1, 2, 7, 11, 12, 13]).not.toContain(top.rank);
      expect(state.deck.length + 28 + 1).toBe(54);
    }
  });

  it('공격 카드의 세기', () => {
    expect(attackPower(card(0, 'H', 1))).toBe(3);
    expect(attackPower(card(0, 'S', 1))).toBe(5);
    expect(attackPower(card(0, 'D', 2))).toBe(2);
    expect(attackPower(card(0, null, 0))).toBe(5);
    expect(attackPower(card(0, null, 1))).toBe(7);
    expect(attackPower(card(0, 'D', 9))).toBe(0);
  });
});

describe('낼 수 있는 카드', () => {
  it('무늬나 숫자가 같으면 내고, 조커는 언제든 낸다', () => {
    const state = setup([[], []], card(1, 'H', 5));
    expect(canPlay(state, card(2, 'H', 9))).toBe(true);
    expect(canPlay(state, card(3, 'S', 5))).toBe(true);
    expect(canPlay(state, card(4, 'S', 9))).toBe(false);
    expect(canPlay(state, card(5, null, 0))).toBe(true);
  });

  it('조커 다음에는 아무거나 낸다', () => {
    const state = setup([[], []], card(1, null, 0), { suit: null });
    expect(canPlay(state, card(2, 'C', 9))).toBe(true);
  });

  it('공격을 받으면 같거나 센 공격 카드, 같은 무늬의 3만 낸다', () => {
    const state = setup([[], []], card(1, 'H', 2), { attack: 2 });
    expect(canPlay(state, card(2, 'H', 9))).toBe(false);
    expect(canPlay(state, card(3, 'S', 2))).toBe(true);
    expect(canPlay(state, card(4, 'H', 1))).toBe(true);
    expect(canPlay(state, card(5, 'S', 1))).toBe(false);
    expect(canPlay(state, card(6, 'H', 3))).toBe(true);
    expect(canPlay(state, card(7, 'S', 3))).toBe(false);
    expect(canPlay(state, card(8, null, 0))).toBe(true);
    // A 위에는 2를 낼 수 없다.
    const ace = setup([[], []], card(1, 'H', 1), { attack: 3 });
    expect(canPlay(ace, card(2, 'H', 2))).toBe(false);
    expect(canPlay(ace, card(3, 'D', 1))).toBe(true);
  });

  it('조커 공격은 더 센 조커로만 넘긴다', () => {
    const black = setup([[], []], card(1, null, 0), { attack: 5, suit: null });
    expect(canPlay(black, card(2, null, 1))).toBe(true);
    expect(canPlay(black, card(3, 'S', 1))).toBe(false);
    expect(canPlay(black, card(4, 'S', 3))).toBe(false);
    const color = setup([[], []], card(1, null, 1), { attack: 7, suit: null });
    expect(canPlay(color, card(2, null, 0))).toBe(false);
  });
});

describe('카드 내기', () => {
  it('공격이 쌓이고, 받으면 쌓인 만큼 받는다', () => {
    const state = setup([[card(1, 'H', 2), card(9, 'C', 9)], [card(2, 'H', 1), card(8, 'D', 8)]], card(0, 'H', 5));
    expect(playCard(state, 0, 1)).toBe(true);
    expect(state.attack).toBe(2);
    expect(state.turn).toBe(1);
    expect(playCard(state, 1, 2)).toBe(true);
    expect(state.attack).toBe(5);
    expect(drawTurn(state, 0)).toBe(true);
    expect(state.players[0].hand).toHaveLength(6);
    expect(state.attack).toBe(0);
    expect(state.turn).toBe(1);
  });

  it('같은 무늬의 3으로 막는다', () => {
    const state = setup([[card(1, 'H', 3), card(9, 'C', 9)], [card(2, 'D', 8)]], card(0, 'H', 1), { attack: 3 });
    playCard(state, 0, 1);
    expect(state.attack).toBe(0);
    expect(takeEvents(state).some((event) => event.k === 'block')).toBe(true);
  });

  it('7은 무늬를 고를 때까지 차례가 넘어가지 않는다', () => {
    const state = setup([[card(1, 'H', 7), card(9, 'C', 9)], [card(2, 'D', 8)]], card(0, 'H', 5));
    playCard(state, 0, 1);
    expect(state.choosingSuit).toBe(true);
    expect(state.turn).toBe(0);
    expect(drawTurn(state, 0)).toBe(false);
    chooseSuit(state, 'C');
    expect(state.suit).toBe('C');
    expect(state.turn).toBe(1);
  });

  it('J는 건너뛰고, Q는 방향을 바꾸고, K는 한 번 더 낸다', () => {
    const hands = (): Card[][] => [[card(1, 'H', 11), card(2, 'H', 12), card(3, 'H', 13), card(4, 'C', 9)], [card(5, 'D', 8)], [card(6, 'D', 8)], [card(7, 'D', 8)]];
    const jack = setup(hands(), card(0, 'H', 5));
    playCard(jack, 0, 1);
    expect(jack.turn).toBe(2);
    const queen = setup(hands(), card(0, 'H', 5));
    playCard(queen, 0, 2);
    expect(queen.turn).toBe(3);
    const king = setup(hands(), card(0, 'H', 5));
    playCard(king, 0, 3);
    expect(king.turn).toBe(0);
    // 둘이서 J를 내면 다시 내 차례다.
    const pair = setup([[card(1, 'H', 11), card(4, 'C', 9)], [card(5, 'D', 8)]], card(0, 'H', 5));
    playCard(pair, 0, 1);
    expect(pair.turn).toBe(0);
  });

  it('차례가 아니거나 낼 수 없는 카드는 내지 못한다', () => {
    const state = setup([[card(1, 'S', 9), card(2, 'H', 9)], [card(3, 'H', 8)]], card(0, 'H', 5));
    expect(playCard(state, 1, 3)).toBe(false);
    expect(playCard(state, 0, 1)).toBe(false);
    expect(state.players[0].hand).toHaveLength(2);
  });

  it('다 내면 이긴다', () => {
    const state = setup([[card(1, 'H', 9)], [card(3, 'H', 8)]], card(0, 'H', 5));
    playCard(state, 0, 1);
    expect(state.winner).toBe(0);
    expect(matchScore(state, 'hard')).toBe(300 + 10);
  });
});

describe('원카드와 파산', () => {
  it('한 장 남으면 외칠 틈이 생기고, 남이 먼저 외치면 한 장 받는다', () => {
    const state = setup([[card(1, 'H', 9), card(2, 'C', 4)], [card(3, 'H', 8), card(4, 'D', 4)]], card(0, 'H', 5));
    playCard(state, 0, 1);
    expect(state.oneCard).toBe(0);
    expect(catchOneCard(state, 1)).toBe(true);
    expect(state.players[0].hand).toHaveLength(2);
    expect(state.oneCard).toBeNull();
  });

  it('스스로 외치면 벌이 없다', () => {
    const state = setup([[card(1, 'H', 9), card(2, 'C', 4)], [card(3, 'H', 8)]], card(0, 'H', 5));
    playCard(state, 0, 1);
    expect(callOneCard(state, 0)).toBe(true);
    expect(catchOneCard(state, 1)).toBe(false);
    expect(state.players[0].hand).toHaveLength(1);
  });

  it(`카드가 ${MAX_HAND}장을 넘으면 파산하고, 혼자 남은 사람이 이긴다`, () => {
    const many = Array.from({ length: MAX_HAND - 1 }, (_, i) => card(100 + i, 'S', 9));
    const state = setup([[card(1, null, 1), card(2, 'C', 4)], many], card(0, 'H', 5));
    playCard(state, 0, 1);
    drawTurn(state, 1);
    expect(state.players[1].out).toBe(true);
    expect(state.winner).toBe(0);
    expect(matchScore(state, 'easy')).toBe(100 + MAX_HAND * 10);
  });

  it('셋 이상이면 파산한 사람만 빠지고 계속한다', () => {
    const many = Array.from({ length: MAX_HAND }, (_, i) => card(100 + i, 'S', 9));
    const state = setup([[card(2, 'C', 4), card(1, 'C', 6)], many, [card(3, 'D', 9)]], card(0, 'H', 5), { turn: 1 });
    drawTurn(state, 1);
    expect(state.players[1].out).toBe(true);
    expect(state.winner).toBeNull();
    expect(state.turn).toBe(2);
    expect(activePlayers(state)).toEqual([0, 2]);
  });
});

describe('사람이 파산하면', () => {
  const many = (from: number, count: number): Card[] => Array.from({ length: count }, (_, i) => card(from + i, 'S', 9));

  it('컴퓨터가 둘 이상 남아도 판이 바로 끝나고 카드가 가장 적은 컴퓨터가 이긴다', () => {
    const state = setup([many(100, MAX_HAND), [card(1, 'D', 9), card(2, 'D', 8), card(3, 'D', 6)], [card(4, 'C', 9)], [card(5, 'C', 8), card(6, 'C', 6)]], card(0, 'H', 5));
    drawTurn(state, 0);
    expect(state.players[0].out).toBe(true);
    expect(state.winner).toBe(2);
    expect(matchScore(state, 'hard')).toBe(0);
    const events = takeEvents(state);
    expect(events.map((event) => event.k)).toEqual(['broke', 'win', 'draw']);
    // 끝난 판에서는 아무도 움직이지 못한다.
    expect(drawTurn(state, state.turn)).toBe(false);
  });

  it('카드 수가 같으면 다음 차례에 가까운 컴퓨터가 이긴다', () => {
    const hands = (): Card[][] => [many(100, MAX_HAND), [card(1, 'D', 9), card(2, 'D', 8)], [card(3, 'C', 9)], [card(4, 'C', 8)]];
    const forward = setup(hands(), card(0, 'H', 5));
    drawTurn(forward, 0);
    expect(forward.winner).toBe(2);
    const backward = setup(hands(), card(0, 'H', 5), { dir: -1 });
    drawTurn(backward, 0);
    expect(backward.winner).toBe(3);
  });

  it('공격을 받아 파산해도 끝나고, 파산한 컴퓨터는 고르지 않는다', () => {
    const state = setup([many(100, MAX_HAND - 2), [card(1, 'D', 9)], [card(2, 'C', 9), card(3, 'C', 8)], [card(4, 'H', 8), card(5, 'H', 4)]], card(0, 'H', 1), { attack: 3 });
    state.players[1].out = true;
    state.players[1].hand = [];
    drawTurn(state, 0);
    expect(state.players[0].out).toBe(true);
    expect(state.winner).toBe(2);
    expect(state.attack).toBe(0);
  });

  it('원카드를 들켜 파산해도 끝난다', () => {
    const state = setup([many(100, MAX_HAND), [card(1, 'D', 9), card(2, 'D', 8)], [card(3, 'C', 9), card(4, 'C', 8)]], card(0, 'H', 5), { oneCard: 0, turn: 1 });
    catchOneCard(state, 1);
    expect(state.players[0].out).toBe(true);
    expect(state.winner).toBe(1);
  });
});

describe('컴퓨터 상대', () => {
  /** 컴퓨터끼리(사람 자리도 컴퓨터가) 한 판을 끝까지 둔다. */
  function autoplay(levels: Level[], seed: number): GameState {
    const state = createGame(levels.length - 1, seed);
    let steps = 0;
    while (state.winner === null && steps < 3000) {
      steps += 1;
      const who = state.turn;
      const level = levels[who];
      if (state.oneCard !== null) {
        if (selfCallDelay(level, Math.random) !== null) callOneCard(state, state.oneCard);
        else catchOneCard(state, (state.oneCard + 1) % state.players.length);
        continue;
      }
      if (state.choosingSuit) {
        chooseSuit(state, chooseSuitFor(state, who, level));
        continue;
      }
      const move = chooseMove(state, who, level);
      const ok = move.k === 'draw' ? drawTurn(state, who) : playCard(state, who, move.cardId);
      expect(ok).toBe(true);
      // 카드는 늘 54장이다.
      const total = state.deck.length + state.discard.length + state.players.reduce((sum, player) => sum + player.hand.length, 0);
      expect(total).toBe(54);
    }
    return state;
  }

  it('모든 난이도와 인원에서 판이 끝난다', () => {
    for (const level of LEVELS) {
      for (let bots = 1; bots <= 3; bots += 1) {
        for (let seed = 1; seed <= 15; seed += 1) {
          const state = autoplay(Array(bots + 1).fill(level), seed * 31 + bots);
          expect(state.winner, `${level} ${bots} ${seed}`).not.toBeNull();
        }
      }
    }
  });

  it('어려움이 쉬움보다 자주 이긴다', () => {
    let hardWins = 0;
    const games = 400;
    for (let seed = 1; seed <= games; seed += 1) {
      // 자리에 따른 유불리를 없애려고 번갈아 앉는다.
      const hardFirst = seed % 2 === 0;
      const state = autoplay(hardFirst ? ['hard', 'easy'] : ['easy', 'hard'], seed);
      if (state.winner === (hardFirst ? 0 : 1)) hardWins += 1;
    }
    expect(hardWins / games).toBeGreaterThan(0.55);
  });

  it('공격을 받으면 보통 이상은 막을 수 있을 때 막는다', () => {
    const state = setup([[card(1, 'H', 9)], [card(2, 'H', 3), card(3, 'C', 9)]], card(0, 'H', 1), { attack: 3, turn: 1 });
    for (const level of ['normal', 'hard'] as const) {
      expect(chooseMove(state, 1, level)).toEqual({ k: 'play', cardId: 2 });
    }
  });

  it('7을 내면 많이 가진 무늬를 고른다', () => {
    const state = setup([[card(1, 'H', 9)], [card(2, 'C', 3), card(3, 'C', 9), card(4, 'D', 9)]], card(0, 'H', 7), { turn: 1, choosingSuit: true });
    expect(chooseSuitFor(state, 1, 'normal')).toBe('C');
  });
});
