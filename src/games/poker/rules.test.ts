import { describe, expect, it } from 'vitest';
import type { Card, Suit } from '../high-low/rules';
import { chooseMove, estimateEquity, BOT_STYLES } from './bot';
import { Category, compareHands, evaluate, HAND_RANKS, handName } from './hands';
import {
  act,
  buildPots,
  createTable,
  currentHand,
  HIDDEN_CARD,
  options,
  potTotal,
  runOver,
  startHand,
  viewFor,
  type PokerTable,
} from './rules';

const SUIT: Record<string, Suit> = { S: 'spade', H: 'heart', D: 'diamond', C: 'club' };
const RANK: Record<string, number> = { A: 1, J: 11, Q: 12, K: 13 };

/** "AS 10H" 같은 글을 카드로 */
function cards(text: string): Card[] {
  return text
    .trim()
    .split(/\s+/)
    .map((token) => {
      const suit = SUIT[token.slice(-1)];
      const body = token.slice(0, -1);
      return { rank: RANK[body] ?? Number(body), suit };
    });
}

/** 늘 같은 수를 내는 random(시험용) */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** 정한 카드가 정한 차례로 나오게 덱을 짠다(맨 끝이 먼저 나온다). */
function rig(table: PokerTable, order: Card[]): void {
  const used = new Set(order.map((card) => `${card.rank}${card.suit}`));
  const rest: Card[] = [];
  for (const suit of Object.values(SUIT)) for (let rank = 1; rank <= 13; rank += 1) if (!used.has(`${rank}${suit}`)) rest.push({ rank, suit });
  table.deck = [...rest, ...[...order].reverse()];
}

describe('족보', () => {
  it('등급을 바르게 가린다', () => {
    expect(evaluate(cards('AS KS QS JS 10S 2D 3C')).category).toBe(Category.RoyalFlush);
    expect(evaluate(cards('9H 8H 7H 6H 5H KD KC')).category).toBe(Category.StraightFlush);
    expect(evaluate(cards('8S 8H 8D 8C KS 2D 3C')).category).toBe(Category.Quads);
    expect(evaluate(cards('QC QD QS 4H 4S 2D 3C')).category).toBe(Category.FullHouse);
    expect(evaluate(cards('KD 9D 7D 4D 2D QC QS')).category).toBe(Category.Flush);
    expect(evaluate(cards('8C 7D 6S 5H 4C KD KS')).category).toBe(Category.Straight);
    expect(evaluate(cards('7S 7H 7D KC 2H 9S 4D')).category).toBe(Category.Trips);
    expect(evaluate(cards('JS JD 5C 5H 9S 2D 3C')).category).toBe(Category.TwoPair);
    expect(evaluate(cards('10H 10C AS 6D 3C 8S 2H')).category).toBe(Category.OnePair);
    expect(evaluate(cards('AH JC 8S 6D 2C 4H 9S')).category).toBe(Category.HighCard);
  });

  it('족보표의 예시가 그 족보다', () => {
    const parse = (token: string): Card => cards(token)[0];
    for (const info of HAND_RANKS) expect(evaluate(info.example.map(parse)).category, info.name).toBe(info.category);
  });

  it('A는 가장 낮은 스트레이트에서 1이다', () => {
    const wheel = evaluate(cards('AS 2D 3C 4H 5S KD 9C'));
    expect(wheel.category).toBe(Category.Straight);
    expect(wheel.kickers).toEqual([5]);
    const six = evaluate(cards('2D 3C 4H 5S 6S KD 9C'));
    expect(compareHands(six, wheel)).toBeGreaterThan(0);
  });

  it('트리플 둘이면 풀하우스, 페어 셋이면 높은 두 쌍과 높은 키커', () => {
    expect(evaluate(cards('9S 9H 9D 4C 4S 4H AD')).kickers).toEqual([9, 4]);
    const twoPair = evaluate(cards('KS KH 7D 7C 3S 3H QD'));
    expect(twoPair.category).toBe(Category.TwoPair);
    expect(twoPair.kickers).toEqual([13, 7, 12]);
  });

  it('같은 족보는 숫자와 키커로 가리고, 다 같으면 비긴다', () => {
    const a = evaluate(cards('AS AD KC 9H 5S 3D 2C'));
    const b = evaluate(cards('AH AC QC 9D 5H 3S 2D'));
    expect(compareHands(a, b)).toBeGreaterThan(0);
    const board = cards('KS QD JH 9C 2S');
    expect(compareHands(evaluate([...cards('3C 4D'), ...board]), evaluate([...cards('3S 4H'), ...board]))).toBe(0);
  });

  it('족보를 이루는 다섯 장을 돌려준다', () => {
    const value = evaluate(cards('KD 9D 7D 4D 2D 3D QS'));
    expect(value.cards).toHaveLength(5);
    expect(value.cards.every((card) => card.suit === 'diamond')).toBe(true);
    expect(value.kickers[0]).toBe(13);
  });

  it('판 중간의 두 장, 다섯 장, 여섯 장도 본다', () => {
    expect(evaluate(cards('7S 7H')).category).toBe(Category.OnePair);
    expect(evaluate(cards('AS 9H')).category).toBe(Category.HighCard);
    expect(handName(evaluate(cards('KS KH 2D')))).toBe('K 원페어');
    expect(handName(evaluate(cards('JS JD 5C 5H 9S')))).toBe('J·5 투페어');
  });
});

describe('탁자', () => {
  it('블라인드를 걷고 카드를 두 장씩 나눈다', () => {
    const table = createTable(['나', 'A', 'B', 'C']);
    expect(startHand(table, seeded(1))).toBe(true);
    // 버튼은 0번, 스몰 1번, 빅 2번, 먼저 하는 사람은 3번
    expect(table.button).toBe(0);
    expect(table.seats.map((seat) => seat.bet)).toEqual([0, 2, 4, 0]);
    expect(table.seats.every((seat) => seat.hole.length === 2)).toBe(true);
    expect(table.toAct).toBe(3);
    expect(potTotal(table)).toBe(6);
    expect(table.deck).toHaveLength(52 - 8);
  });

  it('차례가 아니면 수를 받지 않는다', () => {
    const table = createTable(['나', 'A', 'B', 'C']);
    startHand(table, seeded(2));
    expect(act(table, 0, { type: 'call' })).toBe(false);
    expect(act(table, 3, { type: 'check' })).toBe(false);
    expect(act(table, 3, { type: 'raise', to: 6 })).toBe(false);
  });

  it('모두 콜하면 빅 블라인드가 한 번 더 고르고 플롭이 깔린다', () => {
    const table = createTable(['나', 'A', 'B', 'C']);
    startHand(table, seeded(3));
    expect(act(table, 3, { type: 'call' })).toBe(true);
    expect(act(table, 0, { type: 'call' })).toBe(true);
    expect(act(table, 1, { type: 'call' })).toBe(true);
    expect(table.toAct).toBe(2);
    expect(options(table, 2).check).toBe(true);
    expect(act(table, 2, { type: 'check' })).toBe(true);
    expect(table.street).toBe('flop');
    expect(table.board).toHaveLength(3);
    // 플롭부터는 버튼 다음 자리(스몰)가 먼저다.
    expect(table.toAct).toBe(1);
    expect(potTotal(table)).toBe(16);
  });

  it('레이즈가 나오면 앞서 한 사람도 다시 하고, 최소 레이즈는 앞선 폭 이상이다', () => {
    const table = createTable(['나', 'A', 'B', 'C']);
    startHand(table, seeded(4));
    act(table, 3, { type: 'call' });
    expect(options(table, 0).raise).toEqual({ min: 8, max: 100 });
    expect(act(table, 0, { type: 'raise', to: 7 })).toBe(false);
    expect(act(table, 0, { type: 'raise', to: 12 })).toBe(true);
    expect(options(table, 1).raise?.min).toBe(20);
    act(table, 1, { type: 'fold' });
    act(table, 2, { type: 'fold' });
    expect(table.toAct).toBe(3);
    expect(options(table, 3).call).toBe(8);
    act(table, 3, { type: 'call' });
    expect(table.street).toBe('flop');
  });

  it('다 폴드하면 남은 한 사람이 팟을 다 가진다', () => {
    const table = createTable(['나', 'A', 'B', 'C']);
    startHand(table, seeded(5));
    act(table, 3, { type: 'fold' });
    act(table, 0, { type: 'fold' });
    act(table, 1, { type: 'fold' });
    expect(table.phase).toBe('done');
    expect(table.result?.showdown).toBe(false);
    expect(table.seats[2].chips).toBe(102);
    expect(table.seats[1].chips).toBe(98);
  });

  it('쇼다운에서 센 패가 팟을 가진다', () => {
    const table = createTable(['나', 'A']);
    // 둘이면 버튼(0번)이 스몰이고 먼저 한다. 손패와 공용 카드를 정해 둔다.
    startHand(table, seeded(6));
    table.seats[0].hole = cards('AS AH');
    table.seats[1].hole = cards('2C 7D');
    rig(table, cards('KS KD 9C 3S 4H'));
    expect(table.toAct).toBe(0);
    act(table, 0, { type: 'call' });
    act(table, 1, { type: 'check' });
    for (const street of ['flop', 'turn', 'river']) {
      expect(table.street).toBe(street);
      act(table, 1, { type: 'check' });
      act(table, 0, { type: 'check' });
    }
    expect(table.phase).toBe('done');
    expect(table.result?.showdown).toBe(true);
    // 0번: AS AH + KS KD 9C 3S 4H → 투페어(A, K), 1번: 2C 7D → K 원페어
    expect(table.result?.values[0]?.category).toBe(Category.TwoPair);
    expect(table.seats[0].chips).toBe(104);
    expect(table.seats[1].chips).toBe(96);
  });

  it('올인하면 사이드 팟으로 나눈다', () => {
    const table = createTable(['나', 'A', 'B']);
    table.seats[0].chips = 20;
    table.seats[1].chips = 60;
    table.seats[2].chips = 100;
    startHand(table, seeded(7));
    // 버튼 0, 스몰 1, 빅 2, 먼저 0
    act(table, 0, { type: 'allin' });
    expect(table.seats[0].allIn).toBe(true);
    act(table, 1, { type: 'allin' });
    act(table, 2, { type: 'call' });
    // 셋 다 더 걸 수 없으니 리버까지 한 번에 깔린다.
    expect(table.phase).toBe('done');
    expect(table.board).toHaveLength(5);
    const pots = table.result?.pots ?? [];
    expect(pots.map((pot) => pot.amount)).toEqual([60, 80]);
    expect(pots[0].eligible).toEqual([0, 1, 2]);
    expect(pots[1].eligible).toEqual([1, 2]);
    const total = table.seats.reduce((sum, seat) => sum + seat.chips, 0);
    expect(total).toBe(180);
  });

  it('팟 나누기: 폴드한 사람의 칩도 들어가고 받을 수는 없다', () => {
    const seat = (committed: number, folded = false) => ({
      name: '',
      chips: 0,
      hole: cards('2C 3C'),
      bet: 0,
      committed,
      folded,
      allIn: false,
      acted: true,
      out: false,
      last: null,
    });
    const pots = buildPots([seat(10), seat(30, true), seat(50), seat(50)]);
    expect(pots).toEqual([
      { amount: 40, eligible: [0, 2, 3] },
      { amount: 100, eligible: [2, 3] },
    ]);
  });

  it('칩을 다 잃은 자리는 빠지고, 혼자 남거나 핸드를 다 하면 판이 끝난다', () => {
    const table = createTable(['나', 'A']);
    table.seats[1].chips = 4;
    startHand(table, seeded(8));
    // 1번이 빅 블라인드로 올인
    expect(table.seats[1].allIn).toBe(true);
    act(table, 0, { type: 'call' });
    expect(table.phase).toBe('done');
    const loser = table.seats.findIndex((seat) => seat.out);
    if (loser >= 0) expect(runOver(table)).toBe(true);
    const fresh = createTable(['나', 'A']);
    fresh.handNo = 10;
    expect(runOver(fresh)).toBe(true);
  });

  it('남의 손패와 덱은 가려서 보여 준다', () => {
    const table = createTable(['나', 'A', 'B']);
    startHand(table, seeded(9));
    const view = viewFor(table, 0);
    expect(view.deck).toEqual([]);
    expect(view.seats[0].hole).toEqual(table.seats[0].hole);
    expect(view.seats[1].hole).toEqual([HIDDEN_CARD, HIDDEN_CARD]);
    expect(currentHand(view, 1)).toBeNull();
    expect(currentHand(view, 0)).not.toBeNull();
  });

  it('여러 핸드를 컴퓨터끼리 해도 칩의 합이 늘 같다', () => {
    const random = seeded(10);
    const table = createTable(['나', 'A', 'B', 'C']);
    for (let hand = 0; hand < 30 && !runOver(table, 0, 30); hand += 1) {
      startHand(table, random);
      for (let step = 0; step < 200 && table.phase === 'betting'; step += 1) {
        const index = table.toAct as number;
        const move = chooseMove(table, index, BOT_STYLES[index % BOT_STYLES.length], random);
        expect(move, `핸드 ${hand}`).not.toBeNull();
        expect(act(table, index, move!), JSON.stringify(move)).toBe(true);
      }
      expect(table.phase).toBe('done');
      expect(table.seats.reduce((sum, seat) => sum + seat.chips, 0)).toBe(400);
    }
  });
});

describe('컴퓨터', () => {
  it('센 패의 승률이 약한 패보다 높다', () => {
    const random = seeded(11);
    const aces = estimateEquity(cards('AS AH'), [], 1, random, 400);
    const junk = estimateEquity(cards('7C 2D'), [], 1, random, 400);
    expect(aces).toBeGreaterThan(0.75);
    expect(junk).toBeLessThan(0.45);
    expect(estimateEquity(cards('AS AH'), cards('AD AC KS'), 2, random, 100)).toBeGreaterThan(0.95);
  });

  it('너트를 쥐면 폴드하지 않고, 아주 약하면 큰 레이즈에 폴드한다', () => {
    const table = createTable(['나', 'A']);
    startHand(table, seeded(12));
    table.seats[1].hole = cards('AS AH');
    table.seats[0].hole = cards('7C 2D');
    // 0번(버튼)이 크게 올린다.
    act(table, 0, { type: 'raise', to: 40 });
    const strong = chooseMove(table, 1, BOT_STYLES[0], seeded(13));
    expect(strong?.type).not.toBe('fold');

    const other = createTable(['나', 'A']);
    startHand(other, seeded(14));
    other.seats[1].hole = cards('7C 2D');
    other.seats[0].hole = cards('AS AH');
    act(other, 0, { type: 'raise', to: 60 });
    expect(chooseMove(other, 1, BOT_STYLES[0], seeded(15))?.type).toBe('fold');
  });
});
