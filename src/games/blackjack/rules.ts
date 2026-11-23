/**
 * 블랙잭의 규칙. 화면과 분리된 순수 함수라서 숫자만 바꿔 밸런스를 조정할 수 있고,
 * 자리(Seat)를 여럿 두는 탁자로 짜 두어서 나중에 여럿이 하는 판(온라인, 한 기기에서 돌려 하기)에 그대로 꽂을 수 있다.
 * 지금 화면은 자리 하나만 쓴다.
 *
 * - 카드 합이 21에 가깝게 만들되 넘으면(버스트) 진다. A는 1이나 11, J·Q·K는 10이다.
 * - 처음 두 장이 A와 10점짜리면 블랙잭이고 건 칩의 1.5배를 더 받는다.
 * - 딜러는 16 이하면 더 받고 17 이상이면 멈춘다(A를 11로 센 17에서도 멈춘다).
 * - 딜러의 보이는 카드가 A나 10점짜리면 숨긴 카드를 먼저 보고, 블랙잭이면 바로 판이 끝난다.
 * - 더블: 처음 두 장일 때 건 만큼 더 걸고 한 장만 더 받는다.
 * - 스플릿: 처음 두 장이 같은 숫자면 건 만큼 더 걸고 두 손으로 나눈다(한 번만). A를 나누면 한 장씩만 받는다.
 * - 칩은 이 게임 안에서만 쓰이고 앱의 코인과는 따로다. 판이 끝날 때 남은 칩이 점수가 된다.
 */
import type { Card, Suit } from '../high-low/rules';
import { SUITS } from '../high-low/rules';

export type { Card, Suit };

export const BLACKJACK_GAME_ID = 'blackjack';

/** 한 판을 시작할 때 받는 칩 */
export const START_CHIPS = 100;
/** 한 판에 하는 손(딜) 수 */
export const ROUNDS = 10;
/** 칩 버튼으로 더하는 단위 */
export const CHIP_STEPS: readonly number[] = [5, 10, 25, 50];
/** 가장 적게 거는 칩. 남은 칩이 이보다 적으면 남은 칩을 모두 건다. */
export const MIN_BET = 5;
/** 처음 거는 칩 */
export const DEFAULT_BET = 10;
/** 카드 묶음(슈)에 넣는 덱 수 */
export const DECKS = 4;
/** 슈에 남은 카드가 이보다 적으면 다음 딜 전에 새로 섞는다 */
export const RESHUFFLE_AT = 30;
/** 한 자리가 나눌 수 있는 가장 많은 손 수 */
export const MAX_HANDS = 2;

export type HandResult = 'blackjack' | 'win' | 'push' | 'lose' | 'bust';
export type Phase = 'betting' | 'playing' | 'dealer' | 'settled';
export type Action = 'hit' | 'stand' | 'double' | 'split';

export interface Hand {
  cards: Card[];
  /** 이 손에 건 칩(더블하면 두 배) */
  bet: number;
  doubled: boolean;
  /** 스플릿으로 생긴 손이면 true. 이런 손의 21은 블랙잭이 아니다. */
  fromSplit: boolean;
  /** 더 할 것이 없는 손(멈춤, 버스트, 21, 블랙잭, 더블, A 스플릿) */
  done: boolean;
  /** 판이 끝난 뒤의 결과와 돌려받은 칩(건 칩 포함) */
  result: HandResult | null;
  payout: number;
}

export interface Seat {
  chips: number;
  /** 다음 딜에 걸 칩 */
  bet: number;
  hands: Hand[];
  /** 지금 하는 손 */
  active: number;
}

export interface Table {
  /** 남은 카드. 맨 끝이 다음에 나올 카드다. */
  shoe: Card[];
  dealer: Card[];
  /** 딜러의 둘째 카드를 아직 엎어 두었는지 */
  holeHidden: boolean;
  seats: Seat[];
  /** 지금 차례인 자리 */
  turn: number;
  phase: Phase;
  /** 지금까지 한 딜의 수 */
  round: number;
}

// ───────── 카드와 합 ─────────

export function cardValue(card: Card): number {
  if (card.rank === 1) return 11;
  return Math.min(10, card.rank);
}

/** 카드의 합. A는 넘지 않는 한 11로 센다. soft는 A를 11로 센 합인지다. */
export function handTotal(cards: readonly Card[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    total += cardValue(card);
    if (card.rank === 1) aces += 1;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return { total, soft: aces > 0 };
}

export function isBlackjack(cards: readonly Card[], fromSplit = false): boolean {
  return !fromSplit && cards.length === 2 && handTotal(cards).total === 21;
}

export function isBust(cards: readonly Card[]): boolean {
  return handTotal(cards).total > 21;
}

/** 합을 적는 말: "17", "7/17"(A를 1로도 11로도 셀 수 있을 때), "블랙잭" */
export function totalLabel(cards: readonly Card[], fromSplit = false): string {
  if (cards.length === 0) return '';
  if (isBlackjack(cards, fromSplit)) return '블랙잭';
  const { total, soft } = handTotal(cards);
  return soft && total < 21 ? `${total - 10}/${total}` : String(total);
}

// ───────── 슈 ─────────

export function newShoe(random: () => number = Math.random, decks = DECKS): Card[] {
  const shoe: Card[] = [];
  for (let d = 0; d < decks; d += 1) {
    for (const suit of SUITS) for (let rank = 1; rank <= 13; rank += 1) shoe.push({ rank, suit });
  }
  for (let i = shoe.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
  }
  return shoe;
}

function draw(table: Table, random: () => number): Card {
  if (table.shoe.length === 0) table.shoe = newShoe(random);
  return table.shoe.pop() as Card;
}

// ───────── 탁자 ─────────

export function createTable(seatCount = 1, random: () => number = Math.random, chips = START_CHIPS): Table {
  return {
    shoe: newShoe(random),
    dealer: [],
    holeHidden: true,
    seats: Array.from({ length: seatCount }, () => ({ chips, bet: Math.min(DEFAULT_BET, chips), hands: [], active: 0 })),
    turn: 0,
    phase: 'betting',
    round: 0,
  };
}

/** 이 칩으로 걸 수 있는 가장 적은 칩. 칩이 MIN_BET보다 적으면 남은 칩 모두. 칩이 없으면 0. */
export function minBetFor(chips: number): number {
  return Math.min(MIN_BET, Math.max(0, chips));
}

/** 이 자리가 더 걸 수 있는지(칩을 다 잃지 않았는지) */
export function canBet(seat: Seat): boolean {
  return seat.chips > 0;
}

/** 걸 칩을 정한다. 걸 수 있는 범위(가장 적은 칩 ~ 가진 칩)로 맞춘 값을 돌려준다. */
export function setBet(table: Table, seatIndex: number, amount: number): number {
  const seat = table.seats[seatIndex];
  if (!seat || table.phase === 'playing' || table.phase === 'dealer') return seat?.bet ?? 0;
  const low = minBetFor(seat.chips);
  seat.bet = Math.max(low, Math.min(seat.chips, Math.floor(amount)));
  return seat.bet;
}

/** 칩 버튼을 눌러 건 칩에 더한다. 가진 칩을 넘으면 가진 만큼만. */
export function addToBet(table: Table, seatIndex: number, step: number): number {
  const seat = table.seats[seatIndex];
  if (!seat) return 0;
  return setBet(table, seatIndex, seat.bet + step);
}

function newHand(cards: Card[], bet: number, fromSplit: boolean): Hand {
  return { cards, bet, doubled: false, fromSplit, done: false, result: null, payout: 0 };
}

export interface DealOutcome {
  /** 딜하기 전에 슈를 새로 섞었는지 */
  reshuffled: boolean;
  /** 딜러가 블랙잭이라 바로 끝났는지 */
  dealerBlackjack: boolean;
}

/**
 * 카드를 나눈다. 칩을 건 자리마다 두 장, 딜러에게 두 장(한 장은 엎어 둠).
 * 딜러의 보이는 카드가 A나 10점이면 숨긴 카드를 보고, 블랙잭이면 바로 정산한다.
 * 걸 수 있는 자리가 하나도 없거나 이미 판이 돌고 있으면 null.
 */
export function deal(table: Table, random: () => number = Math.random): DealOutcome | null {
  if (table.phase === 'playing' || table.phase === 'dealer') return null;
  const players = table.seats.filter((seat) => canBet(seat));
  if (players.length === 0) return null;

  let reshuffled = false;
  if (table.shoe.length < RESHUFFLE_AT) {
    table.shoe = newShoe(random);
    reshuffled = true;
  }
  table.round += 1;
  table.dealer = [];
  table.holeHidden = true;
  for (const seat of table.seats) {
    seat.hands = [];
    seat.active = 0;
    if (!canBet(seat)) continue;
    seat.bet = Math.max(minBetFor(seat.chips), Math.min(seat.chips, seat.bet));
    seat.chips -= seat.bet;
    seat.hands.push(newHand([], seat.bet, false));
  }
  for (let pass = 0; pass < 2; pass += 1) {
    for (const seat of table.seats) if (seat.hands[0]) seat.hands[0].cards.push(draw(table, random));
    table.dealer.push(draw(table, random));
  }
  for (const seat of table.seats) {
    const hand = seat.hands[0];
    if (hand && isBlackjack(hand.cards)) hand.done = true;
  }

  const up = table.dealer[0];
  const peeks = cardValue(up) >= 10;
  const dealerBlackjack = peeks && isBlackjack(table.dealer);
  if (dealerBlackjack) {
    for (const seat of table.seats) for (const hand of seat.hands) hand.done = true;
    table.holeHidden = false;
    settle(table);
    return { reshuffled, dealerBlackjack: true };
  }
  table.phase = 'playing';
  table.turn = 0;
  moveToOpenHand(table);
  return { reshuffled, dealerBlackjack: false };
}

/** 지금 차례인 손. 사람이 할 차례가 아니면 null. */
export function activeHand(table: Table): Hand | null {
  if (table.phase !== 'playing') return null;
  const seat = table.seats[table.turn];
  return seat?.hands[seat.active] ?? null;
}

/** 아직 할 것이 남은 다음 손으로 옮긴다. 남은 손이 없으면 딜러 차례가 된다. */
function moveToOpenHand(table: Table): void {
  while (table.turn < table.seats.length) {
    const seat = table.seats[table.turn];
    while (seat.active < seat.hands.length) {
      const hand = seat.hands[seat.active];
      // 스플릿으로 한 장만 남은 손도 여기서 멈추고, advance가 한 장을 채운다.
      if (!hand.done) return;
      seat.active += 1;
    }
    table.turn += 1;
  }
  table.phase = 'dealer';
  table.holeHidden = false;
}

/** 스플릿한 손에 차례가 오면 둘째 카드를 받는다. 받은 카드로 21이 되거나 A 스플릿이면 그 손은 끝난다. */
function fillSplitHand(table: Table, random: () => number): void {
  const hand = activeHand(table);
  if (!hand || hand.cards.length !== 1) return;
  const wasAce = hand.cards[0].rank === 1;
  hand.cards.push(draw(table, random));
  if (wasAce || handTotal(hand.cards).total >= 21) {
    hand.done = true;
    advance(table, random);
  }
}

function advance(table: Table, random: () => number): void {
  moveToOpenHand(table);
  if (table.phase === 'playing') fillSplitHand(table, random);
}

/** 지금 손에서 할 수 있는 일 */
export function availableActions(table: Table): Record<Action, boolean> {
  const none = { hit: false, stand: false, double: false, split: false };
  const hand = activeHand(table);
  if (!hand || hand.done) return none;
  const seat = table.seats[table.turn];
  const firstTwo = hand.cards.length === 2 && !hand.doubled;
  return {
    hit: true,
    stand: true,
    double: firstTwo && seat.chips >= hand.bet,
    split:
      firstTwo &&
      seat.hands.length < MAX_HANDS &&
      hand.cards[0].rank === hand.cards[1].rank &&
      seat.chips >= hand.bet,
  };
}

/** 한 장 더 받는다. 21이 되거나 넘으면 그 손은 끝난다. */
export function hit(table: Table, random: () => number = Math.random): Card | null {
  if (!availableActions(table).hit) return null;
  const hand = activeHand(table) as Hand;
  const card = draw(table, random);
  hand.cards.push(card);
  if (handTotal(hand.cards).total >= 21) {
    hand.done = true;
    advance(table, random);
  }
  return card;
}

/** 멈춘다 */
export function stand(table: Table, random: () => number = Math.random): boolean {
  if (!availableActions(table).stand) return false;
  (activeHand(table) as Hand).done = true;
  advance(table, random);
  return true;
}

/** 건 만큼 더 걸고 딱 한 장만 받는다 */
export function double(table: Table, random: () => number = Math.random): Card | null {
  if (!availableActions(table).double) return null;
  const seat = table.seats[table.turn];
  const hand = activeHand(table) as Hand;
  seat.chips -= hand.bet;
  hand.bet *= 2;
  hand.doubled = true;
  const card = draw(table, random);
  hand.cards.push(card);
  hand.done = true;
  advance(table, random);
  return card;
}

/** 같은 숫자 두 장을 두 손으로 나눈다. 건 만큼 더 건다. */
export function split(table: Table, random: () => number = Math.random): boolean {
  if (!availableActions(table).split) return false;
  const seat = table.seats[table.turn];
  const hand = activeHand(table) as Hand;
  seat.chips -= hand.bet;
  const second = hand.cards.pop() as Card;
  hand.fromSplit = true;
  seat.hands.splice(seat.active + 1, 0, newHand([second], hand.bet, true));
  // 지금 손이 한 장이 되었으니 한 장을 받는다.
  fillSplitHand(table, random);
  return true;
}

// ───────── 딜러와 정산 ─────────

/** 딜러가 더 받을 차례인지. 모든 손이 버스트했으면 받지 않는다. */
export function dealerShouldHit(table: Table): boolean {
  if (table.phase !== 'dealer') return false;
  const live = table.seats.some((seat) => seat.hands.some((hand) => !isBust(hand.cards) && !isBlackjack(hand.cards, hand.fromSplit)));
  if (!live) return false;
  return handTotal(table.dealer).total < 17;
}

/** 딜러가 한 장 받는다 */
export function dealerDraw(table: Table, random: () => number = Math.random): Card | null {
  if (!dealerShouldHit(table)) return null;
  const card = draw(table, random);
  table.dealer.push(card);
  return card;
}

/** 손 하나의 결과. 딜러의 카드를 다 연 뒤에 부른다. */
export function judgeHand(hand: Hand, dealer: readonly Card[]): HandResult {
  const player = handTotal(hand.cards).total;
  const playerBj = isBlackjack(hand.cards, hand.fromSplit);
  const dealerBj = isBlackjack(dealer);
  if (player > 21) return 'bust';
  if (playerBj && dealerBj) return 'push';
  if (playerBj) return 'blackjack';
  if (dealerBj) return 'lose';
  const house = handTotal(dealer).total;
  if (house > 21 || player > house) return 'win';
  if (player === house) return 'push';
  return 'lose';
}

/** 결과에 따라 돌려받는 칩(건 칩 포함). 블랙잭은 1.5배를 더 받는다(끝수는 버림). */
export function payoutFor(result: HandResult, bet: number): number {
  switch (result) {
    case 'blackjack':
      return bet + Math.floor(bet * 1.5);
    case 'win':
      return bet * 2;
    case 'push':
      return bet;
    default:
      return 0;
  }
}

export interface SeatSummary {
  /** 이 딜에서 늘거나 준 칩 */
  net: number;
  results: HandResult[];
}

/** 딜러가 다 받은 뒤 손마다 결과를 정하고 칩을 돌려준다. */
export function settle(table: Table): SeatSummary[] {
  table.holeHidden = false;
  table.phase = 'settled';
  return table.seats.map((seat) => {
    let net = 0;
    const results: HandResult[] = [];
    for (const hand of seat.hands) {
      hand.result = judgeHand(hand, table.dealer);
      hand.payout = payoutFor(hand.result, hand.bet);
      seat.chips += hand.payout;
      net += hand.payout - hand.bet;
      results.push(hand.result);
    }
    // 다음 딜에 걸 칩이 가진 칩보다 많으면 줄인다.
    seat.bet = Math.max(minBetFor(seat.chips), Math.min(seat.bet, seat.chips));
    return { net, results };
  });
}

/** 딜러의 판을 끝까지 한 번에 한다(카드를 하나씩 보이지 않아도 될 때, 시험과 컴퓨터 자리용). */
export function playDealerOut(table: Table, random: () => number = Math.random): SeatSummary[] {
  while (dealerDraw(table, random)) {
    // 17 이상이 될 때까지 받는다.
  }
  return settle(table);
}

/** 한 판(ROUNDS 딜)이 끝났거나 칩을 다 잃었는지 */
export function runOver(table: Table, rounds = ROUNDS): boolean {
  if (table.phase !== 'settled' && table.phase !== 'betting') return false;
  return table.round >= rounds || table.seats.every((seat) => !canBet(seat));
}

/** 판이 끝나고 받는 코인. 점수는 남은 칩이다. */
export function coinsFor(score: number): number {
  return Math.floor(score / 10);
}

export const RESULT_LABEL: Readonly<Record<HandResult, string>> = {
  blackjack: '블랙잭!',
  win: '이겼어요',
  push: '비겼어요',
  lose: '졌어요',
  bust: '버스트',
};
