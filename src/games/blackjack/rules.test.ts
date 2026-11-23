import { describe, expect, it } from 'vitest';
import {
  addToBet,
  availableActions,
  coinsFor,
  createTable,
  deal,
  dealerShouldHit,
  double,
  handTotal,
  hit,
  isBlackjack,
  judgeHand,
  payoutFor,
  playDealerOut,
  runOver,
  setBet,
  split,
  stand,
  START_CHIPS,
  totalLabel,
  type Card,
  type Hand,
  type Table,
} from './rules';

const c = (rank: number, suit: Card['suit'] = 'spade'): Card => ({ rank, suit });

/**
 * 나올 카드를 차례로 정해 둔 탁자. deal은 사람, 딜러, 사람, 딜러 순서로 나눈다.
 * 슈의 맨 끝이 다음 카드라서 거꾸로 넣고, 섞지 않게 넉넉히 채운다.
 */
function rigged(order: Card[], chips = START_CHIPS): Table {
  const table = createTable(1, () => 0, chips);
  const filler = Array.from({ length: 60 }, () => c(2, 'club'));
  table.shoe = [...filler, ...order.slice().reverse()];
  return table;
}

const hand = (cards: Card[], extra: Partial<Hand> = {}): Hand => ({
  cards,
  bet: 10,
  doubled: false,
  fromSplit: false,
  done: true,
  result: null,
  payout: 0,
  ...extra,
});

describe('카드의 합', () => {
  it('A는 넘지 않으면 11, 넘으면 1로 센다', () => {
    expect(handTotal([c(1), c(6)])).toEqual({ total: 17, soft: true });
    expect(handTotal([c(1), c(6), c(10)])).toEqual({ total: 17, soft: false });
    expect(handTotal([c(1), c(1), c(9)])).toEqual({ total: 21, soft: true });
    expect(handTotal([c(13), c(12), c(5)]).total).toBe(25);
  });

  it('블랙잭은 처음 두 장의 21이고, 스플릿한 손은 아니다', () => {
    expect(isBlackjack([c(1), c(13)])).toBe(true);
    expect(isBlackjack([c(1), c(13)], true)).toBe(false);
    expect(isBlackjack([c(7), c(7), c(7)])).toBe(false);
    expect(totalLabel([c(1), c(5)])).toBe('6/16');
    expect(totalLabel([c(1), c(12)])).toBe('블랙잭');
  });
});

describe('베팅', () => {
  it('가진 칩 안에서만 걸고, 칩이 5보다 적으면 남은 칩을 모두 건다', () => {
    const table = createTable(1, Math.random, 30);
    expect(addToBet(table, 0, 50)).toBe(30);
    expect(setBet(table, 0, 1)).toBe(5);
    table.seats[0].chips = 3;
    expect(setBet(table, 0, 10)).toBe(3);
  });

  it('딜하면 건 칩이 빠지고, 칩이 없으면 딜하지 않는다', () => {
    const table = rigged([c(10), c(9), c(7), c(8)]);
    setBet(table, 0, 25);
    deal(table);
    expect(table.seats[0].chips).toBe(START_CHIPS - 25);
    const broke = createTable(1, Math.random, 0);
    expect(deal(broke)).toBeNull();
    expect(runOver(broke)).toBe(true);
  });
});

describe('한 손 하기', () => {
  it('이기면 건 칩의 두 배를 돌려받는다', () => {
    // 사람 10, 9 = 19 / 딜러 7, 10 = 17
    const table = rigged([c(10), c(7), c(9), c(10)]);
    setBet(table, 0, 10);
    deal(table);
    expect(table.phase).toBe('playing');
    stand(table);
    expect(table.phase).toBe('dealer');
    const [summary] = playDealerOut(table);
    expect(summary).toEqual({ net: 10, results: ['win'] });
    expect(table.seats[0].chips).toBe(START_CHIPS + 10);
  });

  it('21을 넘으면 버스트로 지고, 딜러는 더 받지 않는다', () => {
    // 사람 10, 6 + 9 / 딜러 5, 10
    const table = rigged([c(10), c(5), c(6), c(10), c(9)]);
    deal(table);
    hit(table);
    expect(table.phase).toBe('dealer');
    expect(dealerShouldHit(table)).toBe(false);
    const [summary] = playDealerOut(table);
    expect(summary.results).toEqual(['bust']);
    expect(table.dealer).toHaveLength(2);
  });

  it('블랙잭은 1.5배를 더 받는다', () => {
    const table = rigged([c(1), c(9), c(13), c(7)]);
    setBet(table, 0, 10);
    deal(table);
    // 할 것이 없어 바로 딜러 차례다.
    expect(table.phase).toBe('dealer');
    const [summary] = playDealerOut(table);
    expect(summary).toEqual({ net: 15, results: ['blackjack'] });
  });

  it('딜러가 블랙잭이면 바로 끝나고, 둘 다 블랙잭이면 비긴다', () => {
    const lose = rigged([c(10), c(1), c(9), c(13)]);
    expect(deal(lose)?.dealerBlackjack).toBe(true);
    expect(lose.phase).toBe('settled');
    expect(lose.seats[0].hands[0].result).toBe('lose');

    const push = rigged([c(1), c(1), c(13), c(12)]);
    deal(push);
    expect(push.seats[0].hands[0].result).toBe('push');
    expect(push.seats[0].chips).toBe(START_CHIPS);
  });

  it('딜러는 16까지 받고 17(소프트 17 포함)에서 멈춘다', () => {
    const table = rigged([c(10), c(6), c(8), c(10), c(1)]);
    deal(table);
    stand(table);
    expect(dealerShouldHit(table)).toBe(true);
    playDealerOut(table);
    expect(handTotal(table.dealer).total).toBe(17);
    expect(table.seats[0].hands[0].result).toBe('win');

    const soft = rigged([c(10), c(1), c(8), c(6)]);
    deal(soft);
    stand(soft);
    expect(dealerShouldHit(soft)).toBe(false);
  });
});

describe('더블과 스플릿', () => {
  it('더블은 건 만큼 더 걸고 한 장만 받는다', () => {
    const table = rigged([c(6), c(10), c(5), c(7), c(10)]);
    setBet(table, 0, 20);
    deal(table);
    expect(availableActions(table).double).toBe(true);
    double(table);
    const played = table.seats[0].hands[0];
    expect(played.cards).toHaveLength(3);
    expect(played.bet).toBe(40);
    expect(table.phase).toBe('dealer');
    const [summary] = playDealerOut(table);
    expect(summary.net).toBe(40);
  });

  it('칩이 모자라면 더블도 스플릿도 할 수 없다', () => {
    const table = rigged([c(8), c(10), c(8), c(7)], 30);
    setBet(table, 0, 20);
    deal(table);
    expect(availableActions(table)).toEqual({ hit: true, stand: true, double: false, split: false });
  });

  it('같은 숫자 두 장을 나눠 두 손을 차례로 한다', () => {
    // 사람 8, 8 / 딜러 10, 7 → 나눈 뒤 첫 손 8+3, 둘째 손 8+10
    const table = rigged([c(8), c(10), c(8, 'heart'), c(7), c(3), c(10, 'heart')]);
    setBet(table, 0, 10);
    deal(table);
    expect(availableActions(table).split).toBe(true);
    split(table);
    const seat = table.seats[0];
    expect(seat.hands).toHaveLength(2);
    expect(seat.chips).toBe(START_CHIPS - 20);
    expect(seat.hands[0].cards.map((card) => card.rank)).toEqual([8, 3]);
    expect(availableActions(table).split).toBe(false);
    stand(table);
    // 둘째 손에 차례가 오면 한 장을 받는다.
    expect(seat.active).toBe(1);
    expect(seat.hands[1].cards.map((card) => card.rank)).toEqual([8, 10]);
    stand(table);
    const [summary] = playDealerOut(table);
    expect(summary.results).toEqual(['lose', 'win']);
    expect(seat.chips).toBe(START_CHIPS);
  });

  it('A를 나누면 한 장씩만 받고, 21이어도 블랙잭이 아니다', () => {
    const table = rigged([c(1), c(9), c(1, 'heart'), c(8), c(13), c(9)]);
    deal(table);
    split(table);
    expect(table.phase).toBe('dealer');
    const [summary] = playDealerOut(table);
    expect(summary.results).toEqual(['win', 'win']);
    expect(summary.net).toBe(20);
  });
});

describe('정산과 판', () => {
  it('결과마다 돌려받는 칩', () => {
    expect(payoutFor('blackjack', 10)).toBe(25);
    expect(payoutFor('blackjack', 5)).toBe(12);
    expect(payoutFor('win', 10)).toBe(20);
    expect(payoutFor('push', 10)).toBe(10);
    expect(payoutFor('lose', 10)).toBe(0);
    expect(judgeHand(hand([c(10), c(9)]), [c(10), c(10), c(5)])).toBe('win');
    expect(judgeHand(hand([c(10), c(7)]), [c(10), c(7)])).toBe('push');
  });

  it('칩을 다 잃으면 판이 끝나고, 열 번 딜하면 끝난다', () => {
    const table = rigged([c(10), c(10), c(6), c(9), c(10)], 10);
    setBet(table, 0, 10);
    deal(table);
    hit(table);
    playDealerOut(table);
    expect(table.seats[0].chips).toBe(0);
    expect(runOver(table)).toBe(true);

    const long = createTable(1, Math.random);
    long.round = 10;
    long.phase = 'settled';
    expect(runOver(long)).toBe(true);
  });

  it('여러 자리가 앉아도 자리마다 차례로 한다', () => {
    const table = createTable(2, () => 0.5);
    deal(table);
    for (let guard = 0; guard < 20 && table.phase === 'playing'; guard += 1) stand(table);
    expect(table.phase === 'dealer' || table.phase === 'settled').toBe(true);
    if (table.phase === 'dealer') playDealerOut(table);
    expect(table.seats.every((seat) => seat.hands[0].result !== null)).toBe(true);
  });

  it('남은 칩 10개마다 코인 1개', () => {
    expect(coinsFor(100)).toBe(10);
    expect(coinsFor(9)).toBe(0);
  });
});
