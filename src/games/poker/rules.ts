/**
 * 포커(텍사스 홀덤)의 규칙. 화면과 Phaser에 기대지 않는 순수한 탁자라서 숫자만 바꿔 밸런스를 조정할 수 있고,
 * 자리(seat) 번호로 수를 받기 때문에 나중에 여럿이 하는 판(한 폰으로 돌려 하기, 온라인 방)에 그대로 꽂을 수 있다.
 * 지금 화면은 0번 자리에 사람을, 나머지 자리에 컴퓨터(bot.ts)를 앉힌다. 자리마다 보이는 판은 viewFor가 만든다.
 *
 * - 저마다 카드 두 장(내 카드)을 받고, 가운데에 다섯 장(공용 카드)이 플롭 3장, 턴 1장, 리버 1장으로 깔린다.
 * - 딜러 버튼 왼쪽 두 자리가 스몰·빅 블라인드를 먼저 낸다. 둘이 남으면 버튼이 스몰 블라인드다.
 * - 차례마다 폴드, 체크, 콜, 레이즈, 올인 가운데 하나를 한다. 레이즈는 앞선 레이즈만큼 이상 올려야 한다.
 * - 한 사람만 남으면 그 사람이 팟을 모두 가진다. 리버까지 가면 내 카드와 공용 카드 7장 중 가장 센 5장으로 겨룬다.
 * - 올인한 사람이 있으면 사이드 팟으로 나눠서, 각자 건 만큼까지만 가져갈 수 있다.
 * - 칩은 이 게임 안에서만 쓰는 놀이 칩이고 앱의 코인과는 따로다. 판이 끝날 때 사람이 가진 칩이 점수가 된다.
 */
import type { Card } from '../high-low/rules';
import { SUITS } from '../high-low/rules';
import { compareHands, evaluate, type HandValue } from './hands';

export type { Card };

export const POKER_GAME_ID = 'poker';

/** 한 판을 시작할 때 받는 칩 */
export const START_CHIPS = 100;
/** 한 판에 하는 핸드 수 */
export const HANDS = 10;
export const SMALL_BLIND = 2;
export const BIG_BLIND = 4;
/** 사람과 함께 앉는 컴퓨터 */
export const BOT_NAMES: readonly string[] = ['토끼', '곰돌이', '여우'];

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
export type Phase = 'idle' | 'betting' | 'done';

export type Move =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  /** 이번 거리에서 내 앞에 놓일 칩이 to가 되게 올린다 */
  | { type: 'raise'; to: number }
  | { type: 'allin' };

export type LastAction = { type: Move['type'] | 'blind'; amount: number };

export interface PokerSeat {
  name: string;
  chips: number;
  hole: Card[];
  /** 이번 거리에 낸 칩 */
  bet: number;
  /** 이번 핸드에 낸 칩 모두 */
  committed: number;
  folded: boolean;
  allIn: boolean;
  /** 이번 거리에서 이미 했는지(레이즈가 나오면 다시 false) */
  acted: boolean;
  /** 칩을 다 잃어 탁자에서 빠졌는지 */
  out: boolean;
  /** 이번 핸드에서 마지막으로 한 일 */
  last: LastAction | null;
}

export interface PotResult {
  amount: number;
  /** 이 팟을 가질 수 있던 자리 */
  eligible: number[];
  winners: number[];
}

export interface HandResult {
  /** 쇼다운까지 갔으면 true, 다 폴드해서 끝났으면 false */
  showdown: boolean;
  pots: PotResult[];
  /** 자리마다 돌려받은 칩 */
  payouts: number[];
  /** 쇼다운에서 자리마다의 족보(폴드했거나 빠졌으면 null) */
  values: (HandValue | null)[];
}

export interface PokerTable {
  /** 남은 카드. 맨 끝이 다음에 나올 카드다. */
  deck: Card[];
  board: Card[];
  seats: PokerSeat[];
  /** 딜러 버튼 자리. 아직 한 핸드도 안 했으면 -1 */
  button: number;
  smallBlind: number;
  bigBlind: number;
  street: Street;
  phase: Phase;
  /** 지금 둘 차례인 자리. 없으면 null */
  toAct: number | null;
  /** 이번 거리에서 맞춰야 하는 칩 */
  currentBet: number;
  /** 다음 레이즈가 적어도 올려야 하는 폭 */
  minRaise: number;
  /** 지금까지 시작한 핸드 수 */
  handNo: number;
  result: HandResult | null;
}

// ───────── 카드 ─────────

export function newDeck(random: () => number = Math.random): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (let rank = 1; rank <= 13; rank += 1) deck.push({ rank, suit });
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function draw(table: PokerTable): Card {
  return table.deck.pop() as Card;
}

// ───────── 탁자 ─────────

export function createTable(names: readonly string[], chips = START_CHIPS): PokerTable {
  return {
    deck: [],
    board: [],
    seats: names.map((name) => ({
      name,
      chips,
      hole: [],
      bet: 0,
      committed: 0,
      folded: false,
      allIn: false,
      acted: false,
      out: false,
      last: null,
    })),
    button: -1,
    smallBlind: SMALL_BLIND,
    bigBlind: BIG_BLIND,
    street: 'preflop',
    phase: 'idle',
    toAct: null,
    currentBet: 0,
    minRaise: BIG_BLIND,
    handNo: 0,
    result: null,
  };
}

/** 이번 핸드에 카드를 받은 자리(폴드했어도 포함) */
function dealtIn(seat: PokerSeat): boolean {
  return !seat.out && seat.hole.length > 0;
}

/** 아직 팟을 가질 수 있는 자리 */
export function inHand(seat: PokerSeat): boolean {
  return dealtIn(seat) && !seat.folded;
}

/** 아직 칩을 더 낼 수 있는 자리 */
function canAct(seat: PokerSeat): boolean {
  return inHand(seat) && !seat.allIn;
}

/** from 다음(시계 방향)부터 조건에 맞는 첫 자리. 없으면 -1 */
function nextSeat(table: PokerTable, from: number, test: (seat: PokerSeat) => boolean): number {
  const count = table.seats.length;
  for (let step = 1; step <= count; step += 1) {
    const index = (((from + step) % count) + count) % count;
    if (test(table.seats[index])) return index;
  }
  return -1;
}

/** 탁자에 남은(칩이 있는) 자리 수 */
export function seatsInPlay(table: PokerTable): number {
  return table.seats.filter((seat) => !seat.out).length;
}

/** 지금 팟에 모인 칩 모두 */
export function potTotal(table: PokerTable): number {
  return table.seats.reduce((sum, seat) => sum + seat.committed, 0);
}

function pay(table: PokerTable, index: number, amount: number): number {
  const seat = table.seats[index];
  const paid = Math.max(0, Math.min(seat.chips, amount));
  seat.chips -= paid;
  seat.bet += paid;
  seat.committed += paid;
  if (seat.chips === 0) seat.allIn = true;
  return paid;
}

/**
 * 새 핸드를 시작한다: 버튼을 옮기고, 블라인드를 걷고, 카드를 두 장씩 나눈다.
 * 칩이 있는 자리가 둘보다 적거나 핸드가 돌고 있으면 false.
 */
export function startHand(table: PokerTable, random: () => number = Math.random): boolean {
  if (table.phase === 'betting' || seatsInPlay(table) < 2) return false;
  table.deck = newDeck(random);
  table.board = [];
  table.result = null;
  table.street = 'preflop';
  table.handNo += 1;
  for (const seat of table.seats) {
    seat.hole = [];
    seat.bet = 0;
    seat.committed = 0;
    seat.folded = false;
    seat.allIn = false;
    seat.acted = false;
    seat.last = null;
  }
  const playing = (seat: PokerSeat): boolean => !seat.out;
  table.button = nextSeat(table, table.button, playing);
  const headsUp = seatsInPlay(table) === 2;
  const sb = headsUp ? table.button : nextSeat(table, table.button, playing);
  const bb = nextSeat(table, sb, playing);

  for (let pass = 0; pass < 2; pass += 1) {
    for (let step = 1; step <= table.seats.length; step += 1) {
      const index = (table.button + step) % table.seats.length;
      if (playing(table.seats[index])) table.seats[index].hole.push(draw(table));
    }
  }
  table.seats[sb].last = { type: 'blind', amount: pay(table, sb, table.smallBlind) };
  table.seats[bb].last = { type: 'blind', amount: pay(table, bb, table.bigBlind) };
  table.currentBet = table.bigBlind;
  table.minRaise = table.bigBlind;
  table.phase = 'betting';
  table.toAct = null;
  // 빅 블라인드 다음 자리부터. 모두 올인이면 바로 끝까지 깐다.
  const first = nextSeat(table, bb, canAct);
  if (first === -1 || !roundOpen(table)) {
    finishStreet(table);
  } else {
    table.toAct = first;
  }
  return true;
}

/** 이번 거리에서 아직 누군가 해야 하는지 */
function roundOpen(table: PokerTable): boolean {
  const live = table.seats.filter(inHand);
  if (live.length <= 1) return false;
  const actors = table.seats.filter(canAct);
  if (actors.length === 0) return false;
  // 혼자만 칩이 남았고 이미 맞췄으면 더 걸 상대가 없다.
  if (actors.length === 1 && actors[0].bet >= table.currentBet) return false;
  return actors.some((seat) => !seat.acted || seat.bet < table.currentBet);
}

export interface Options {
  fold: boolean;
  check: boolean;
  /** 콜에 더 낼 칩. 0이면 콜할 것이 없다. */
  call: number;
  /** 레이즈로 정할 수 있는 칩(이번 거리에 내 앞에 놓일 칩)의 범위. 레이즈할 수 없으면 null */
  raise: { min: number; max: number } | null;
  /** 올인하면 더 낼 칩 */
  allIn: number;
}

/** 그 자리가 지금 할 수 있는 일. 차례가 아니면 모두 막힌다. */
export function options(table: PokerTable, index: number): Options {
  const none: Options = { fold: false, check: false, call: 0, raise: null, allIn: 0 };
  if (table.phase !== 'betting' || table.toAct !== index) return none;
  const seat = table.seats[index];
  const toCall = Math.max(0, table.currentBet - seat.bet);
  const max = seat.bet + seat.chips;
  const min = table.currentBet + table.minRaise;
  // 다른 사람이 모두 올인이면 더 올려 봐야 받을 사람이 없다.
  const rivals = table.seats.some((other, i) => i !== index && canAct(other));
  return {
    fold: toCall > 0,
    check: toCall === 0,
    call: Math.min(toCall, seat.chips),
    raise: rivals && max > min ? { min, max } : null,
    allIn: rivals || toCall > 0 ? seat.chips : 0,
  };
}

/**
 * 그 자리가 수를 둔다. 받아들였으면 true.
 * 거리가 끝나면 다음 공용 카드를 깔고, 핸드가 끝나면 팟을 나눠 result에 적는다.
 */
export function act(table: PokerTable, index: number, move: Move): boolean {
  const can = options(table, index);
  if (table.toAct !== index) return false;
  const seat = table.seats[index];
  switch (move.type) {
    case 'fold':
      if (!can.fold) return false;
      seat.folded = true;
      seat.last = { type: 'fold', amount: 0 };
      break;
    case 'check':
      if (!can.check) return false;
      seat.last = { type: 'check', amount: 0 };
      break;
    case 'call': {
      if (can.call <= 0) return false;
      seat.last = { type: seat.chips <= can.call ? 'allin' : 'call', amount: pay(table, index, can.call) };
      break;
    }
    case 'raise': {
      if (!can.raise) return false;
      const to = Math.floor(move.to);
      if (to < can.raise.min || to > can.raise.max) return false;
      raiseTo(table, index, to);
      seat.last = { type: seat.allIn ? 'allin' : 'raise', amount: to };
      break;
    }
    case 'allin': {
      if (can.allIn <= 0) return false;
      const to = seat.bet + seat.chips;
      if (to > table.currentBet) raiseTo(table, index, to);
      else pay(table, index, seat.chips);
      seat.last = { type: 'allin', amount: seat.bet };
      break;
    }
  }
  seat.acted = true;
  advance(table, index);
  return true;
}

function raiseTo(table: PokerTable, index: number, to: number): void {
  const seat = table.seats[index];
  pay(table, index, to - seat.bet);
  const size = seat.bet - table.currentBet;
  if (size >= table.minRaise) table.minRaise = size;
  table.currentBet = Math.max(table.currentBet, seat.bet);
  // 올렸으니 다른 사람은 다시 해야 한다.
  for (const other of table.seats) if (other !== seat && canAct(other)) other.acted = false;
}

function advance(table: PokerTable, from: number): void {
  const live = table.seats.filter(inHand);
  if (live.length === 1) {
    awardUncontested(table);
    return;
  }
  if (roundOpen(table)) {
    table.toAct = nextSeat(table, from, (seat) => canAct(seat) && (!seat.acted || seat.bet < table.currentBet));
    return;
  }
  finishStreet(table);
}

/** 거리를 닫고 다음 카드를 깐다. 더 걸 사람이 없으면 리버까지 한 번에 깔고 쇼다운한다. */
function finishStreet(table: PokerTable): void {
  for (;;) {
    for (const seat of table.seats) {
      seat.bet = 0;
      seat.acted = false;
    }
    table.currentBet = 0;
    table.minRaise = table.bigBlind;
    if (table.street === 'river') {
      showdown(table);
      return;
    }
    if (table.street === 'preflop') {
      table.street = 'flop';
      for (let i = 0; i < 3; i += 1) table.board.push(draw(table));
    } else {
      table.street = table.street === 'flop' ? 'turn' : 'river';
      table.board.push(draw(table));
    }
    if (roundOpenFresh(table)) {
      table.toAct = nextSeat(table, table.button, canAct);
      return;
    }
  }
}

/** 새 거리에서 걸 사람이 둘 이상인지 */
function roundOpenFresh(table: PokerTable): boolean {
  return table.seats.filter(canAct).length >= 2;
}

function endHand(table: PokerTable, result: HandResult): void {
  table.result = result;
  table.phase = 'done';
  table.toAct = null;
  for (let i = 0; i < table.seats.length; i += 1) {
    const seat = table.seats[i];
    seat.chips += result.payouts[i];
    seat.bet = 0;
    if (seat.chips <= 0) seat.out = true;
  }
}

function awardUncontested(table: PokerTable): void {
  const winner = table.seats.findIndex(inHand);
  const amount = potTotal(table);
  const payouts = table.seats.map((_, i) => (i === winner ? amount : 0));
  endHand(table, {
    showdown: false,
    pots: [{ amount, eligible: [winner], winners: [winner] }],
    payouts,
    values: table.seats.map(() => null),
  });
}

/** 낸 칩에 따라 메인 팟과 사이드 팟으로 나눈다. */
export function buildPots(seats: readonly PokerSeat[]): { amount: number; eligible: number[] }[] {
  const levels = [...new Set(seats.filter(inHand).map((seat) => seat.committed))].filter((v) => v > 0).sort((a, b) => a - b);
  const pots: { amount: number; eligible: number[] }[] = [];
  let previous = 0;
  for (const level of levels) {
    let amount = 0;
    for (const seat of seats) amount += Math.max(0, Math.min(seat.committed, level) - previous);
    const eligible = seats.flatMap((seat, i) => (inHand(seat) && seat.committed >= level ? [i] : []));
    if (amount > 0) pots.push({ amount, eligible });
    previous = level;
  }
  // 폴드한 사람이 남은 누구보다 많이 냈으면(드문 일) 그 칩은 마지막 팟에 얹는다.
  const extra = seats.reduce((sum, seat) => sum + Math.max(0, seat.committed - previous), 0);
  if (extra > 0 && pots.length > 0) pots[pots.length - 1].amount += extra;
  return pots;
}

function showdown(table: PokerTable): void {
  table.street = 'showdown';
  const values = table.seats.map((seat) => (inHand(seat) ? evaluate([...seat.hole, ...table.board]) : null));
  const payouts = table.seats.map(() => 0);
  const pots: PotResult[] = buildPots(table.seats).map((pot) => {
    let best: HandValue | null = null;
    let winners: number[] = [];
    for (const index of pot.eligible) {
      const value = values[index] as HandValue;
      const diff = best ? compareHands(value, best) : 1;
      if (diff > 0) {
        best = value;
        winners = [index];
      } else if (diff === 0) {
        winners.push(index);
      }
    }
    // 나누어 떨어지지 않는 칩은 버튼 왼쪽에 가까운 사람부터 하나씩 더 받는다.
    const order = [...winners].sort(
      (a, b) =>
        ((a - table.button + table.seats.length) % table.seats.length) - ((b - table.button + table.seats.length) % table.seats.length),
    );
    const share = Math.floor(pot.amount / winners.length);
    let left = pot.amount - share * winners.length;
    for (const index of order) {
      payouts[index] += share + (left > 0 ? 1 : 0);
      left -= 1;
    }
    return { amount: pot.amount, eligible: pot.eligible, winners: order };
  });
  endHand(table, { showdown: true, pots, payouts, values });
}

// ───────── 판의 끝 ─────────

/** 한 판이 끝났는지: 핸드를 다 했거나, 사람이 칩을 다 잃었거나, 혼자 남았다. */
export function runOver(table: PokerTable, me = 0, hands = HANDS): boolean {
  if (table.phase === 'betting') return false;
  return table.handNo >= hands || table.seats[me].out || seatsInPlay(table) < 2;
}

/** 판이 끝나고 받는 코인. 점수는 남은 칩이다. */
export function coinsFor(score: number): number {
  return Math.floor(score / 10);
}

// ───────── 자리마다 보이는 판 ─────────

/** 가린 카드(남의 손패). 장 수만 알 수 있다. */
export const HIDDEN_CARD: Card = { rank: 0, suit: 'spade' };

/**
 * 한 자리에서 보이는 탁자: 남은 카드 묶음과 남의 손패를 가린다. 쇼다운에서 끝까지 남은 사람의 손패는 보인다.
 * 여럿이 하는 판에서 서버가 이 모양으로 보내면 화면은 컴퓨터와 할 때와 같은 코드로 그릴 수 있다.
 */
export function viewFor(table: PokerTable, viewer: number): PokerTable {
  const reveal = table.result?.showdown ?? false;
  return {
    ...table,
    deck: [],
    seats: table.seats.map((seat, i) => ({
      ...seat,
      hole: i === viewer || (reveal && inHand(seat)) ? seat.hole.map((card) => ({ ...card })) : seat.hole.map(() => HIDDEN_CARD),
    })),
    board: table.board.map((card) => ({ ...card })),
  };
}

/** 그 자리의 지금 족보(내 카드 + 깔린 공용 카드). 카드가 없으면 null */
export function currentHand(table: PokerTable, index: number): HandValue | null {
  const seat = table.seats[index];
  if (!seat || seat.hole.length === 0 || seat.hole.some((card) => card.rank === 0)) return null;
  return evaluate([...seat.hole, ...table.board]);
}

export const ACTION_LABEL: Readonly<Record<LastAction['type'], string>> = {
  fold: '폴드',
  check: '체크',
  call: '콜',
  raise: '레이즈',
  allin: '올인',
  blind: '블라인드',
};
