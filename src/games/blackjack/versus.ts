/**
 * 친구와 함께하는 블랙잭: 공용 방 규칙(versus/room.ts)에 블랙잭을 끼우는 부분. Phaser에 기대지 않아서 서버도 그대로 쓴다.
 *
 * 두 사람이 같은 딜러를 상대로 한 탁자에 앉는다(자리 0과 1이 rules.ts 탁자의 자리 0과 1이다).
 * - 딜마다 두 사람이 차례로 칩을 건다. 둘 다 걸면 카드를 나누고, 자리 0부터 차례로 손을 한다.
 * - 두 사람이 다 하면 딜러가 저절로 받고 정산한다. 정산한 판은 다음 딜에 걸 때까지 그대로 보인다.
 * - ROUNDS번 딜하거나 누군가 칩을 다 잃으면 끝나고, 칩이 더 많은 사람이 이긴다(같으면 비긴다).
 * 블랙잭은 원래 모든 카드를 펼쳐 놓고 하므로 서로의 손은 보인다. 딜러의 엎은 카드와 슈, 난수(seed)만 가린다.
 * 난수는 판 안의 seed로 굴린다(서버에 저장하고 수를 둘 때 난수를 따로 받지 않기 때문).
 */
import type { Seat as RoomSeat } from '../../versus/protocol';
import type { TurnGame } from '../../versus/room';
import { seededRandom, seedFrom } from '../../versus/seeded';
import { SUITS } from '../high-low/rules';
import {
  availableActions,
  createTable,
  deal,
  double,
  hit,
  MAX_HANDS,
  playDealerOut,
  ROUNDS,
  setBet,
  split,
  stand,
  type Action,
  type Card,
  type Hand,
  type HandResult,
  type Table,
} from './rules';

export type BlackjackMove = { type: 'bet'; amount: number } | { type: Action };

/** 서버에 저장하는 판 */
export interface BlackjackMatch {
  table: Table;
  seed: number;
  /** 이번 딜에 먼저 거는 자리. 딜마다 번갈아 바뀐다. */
  first: RoomSeat;
  /** 이번 딜에 칩을 건 자리 */
  placed: [boolean, boolean];
  /** 둔 수의 수 */
  moves: number;
  /** 마지막으로 둔 자리와 수. 화면이 알림 줄에 쓴다. */
  last: { seat: RoomSeat; move: BlackjackMove } | null;
}

/** 한 자리가 보는 판. 탁자의 자리 번호는 그대로이고, 어느 쪽이 나인지는 방의 seat로 안다. */
export interface BlackjackView {
  table: Table;
  /** 슈에 남은 카드 수 */
  shoeLeft: number;
  first: RoomSeat;
  placed: [boolean, boolean];
  moves: number;
  last: { seat: RoomSeat; move: BlackjackMove } | null;
}

const ACTIONS: readonly Action[] = ['hit', 'stand', 'double', 'split'];
/** 엎어 둔 카드. 무엇인지 알 수 없게 숫자 0으로 보낸다. */
const HIDDEN_CARD: Card = { rank: 0, suit: 'spade' };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isInt = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

export function readBlackjackMove(raw: unknown): BlackjackMove | null {
  if (!isObject(raw)) return null;
  if (raw.type === 'bet') return isInt(raw.amount, 0, 1_000_000) ? { type: 'bet', amount: raw.amount } : null;
  return ACTIONS.includes(raw.type as Action) ? { type: raw.type as Action } : null;
}

export function startBlackjack(random: () => number, first: RoomSeat): BlackjackMatch {
  const state = { seed: seedFrom(random) };
  const table = createTable(2, seededRandom(state));
  return { table, seed: state.seed, first, placed: [false, false], moves: 0, last: null };
}

/** 칩을 걸 수 있는 때(판을 나누기 전이나 지난 딜을 정산한 뒤)인지 */
const betting = (table: Table): boolean => table.phase === 'betting' || table.phase === 'settled';

/** 판이 끝났는지: 정한 수만큼 딜했거나 누군가 칩을 다 잃었다. */
export function blackjackOver(state: BlackjackMatch): boolean {
  const { table } = state;
  if (table.phase !== 'settled') return false;
  return table.round >= ROUNDS || table.seats.some((seat) => seat.chips <= 0);
}

export function blackjackTurn(state: BlackjackMatch): RoomSeat | null {
  if (blackjackOver(state)) return null;
  const { table } = state;
  if (betting(table)) {
    const second: RoomSeat = state.first === 0 ? 1 : 0;
    if (!state.placed[state.first]) return state.first;
    if (!state.placed[second]) return second;
    return null;
  }
  if (table.phase === 'playing') return table.turn as RoomSeat;
  return null;
}

/** 가진 칩 + 이번 딜에 걸어 둔 칩 */
export function chipsOf(table: Table, seat: number): number {
  const chairs = table.seats[seat];
  if (!chairs) return 0;
  const onTable = table.phase === 'playing' || table.phase === 'dealer' ? chairs.hands.reduce((sum, hand) => sum + hand.bet, 0) : 0;
  return chairs.chips + onTable;
}

function play(state: BlackjackMatch, seat: RoomSeat, move: BlackjackMove): boolean {
  if (blackjackTurn(state) !== seat) return false;
  const { table } = state;
  const random = seededRandom(state);
  if (move.type === 'bet') {
    if (!betting(table)) return false;
    setBet(table, seat, move.amount);
    state.placed[seat] = true;
    if (state.placed[0] && state.placed[1]) {
      deal(table, random);
      state.placed = [false, false];
      state.first = state.first === 0 ? 1 : 0;
    }
  } else {
    if (table.phase !== 'playing' || !availableActions(table)[move.type]) return false;
    if (move.type === 'hit') hit(table, random);
    else if (move.type === 'stand') stand(table, random);
    else if (move.type === 'double') double(table, random);
    else split(table, random);
  }
  // 두 사람이 다 했으면(둘 다 블랙잭이어도) 딜러가 마저 받고 정산한다.
  if (table.phase === 'dealer') playDealerOut(table, random);
  return true;
}

/** 이긴 자리. 칩이 같으면 null */
export function blackjackWinner(table: Table): RoomSeat | null {
  const [a, b] = [table.seats[0].chips, table.seats[1].chips];
  if (a === b) return null;
  return a > b ? 0 : 1;
}

export function blackjackView(state: BlackjackMatch): BlackjackView {
  const { table } = state;
  const copyHand = (hand: Hand): Hand => ({ ...hand, cards: hand.cards.map((card) => ({ ...card })) });
  return {
    table: {
      shoe: [],
      dealer: table.dealer.map((card, index) => (index === 1 && table.holeHidden ? { ...HIDDEN_CARD } : { ...card })),
      holeHidden: table.holeHidden,
      seats: table.seats.map((seat) => ({ ...seat, hands: seat.hands.map(copyHand) })),
      turn: table.turn,
      phase: table.phase,
      round: table.round,
    },
    shoeLeft: table.shoe.length,
    first: state.first,
    placed: [state.placed[0], state.placed[1]],
    moves: state.moves,
    last: state.last && { seat: state.last.seat, move: { ...state.last.move } },
  };
}

const RESULTS: readonly HandResult[] = ['blackjack', 'win', 'push', 'lose', 'bust'];
const PHASES = ['betting', 'playing', 'dealer', 'settled'] as const;

function isCard(raw: unknown, allowHidden: boolean): raw is Card {
  if (!isObject(raw) || !SUITS.includes(raw.suit as Card['suit'])) return false;
  return isInt(raw.rank, allowHidden ? 0 : 1, 13);
}

function isHand(raw: unknown): raw is Hand {
  if (!isObject(raw) || !Array.isArray(raw.cards) || raw.cards.length > 22 || !raw.cards.every((card) => isCard(card, false))) return false;
  if (!isInt(raw.bet, 0, 1_000_000) || !isInt(raw.payout, 0, 10_000_000)) return false;
  if (typeof raw.doubled !== 'boolean' || typeof raw.fromSplit !== 'boolean' || typeof raw.done !== 'boolean') return false;
  return raw.result === null || RESULTS.includes(raw.result as HandResult);
}

export function readBlackjackView(raw: unknown): BlackjackView | null {
  if (!isObject(raw) || !isObject(raw.table)) return null;
  const table = raw.table;
  if (!Array.isArray(table.dealer) || table.dealer.length > 22 || !table.dealer.every((card) => isCard(card, true))) return null;
  if (typeof table.holeHidden !== 'boolean' || !PHASES.includes(table.phase as (typeof PHASES)[number])) return null;
  if (!isInt(table.turn, 0, 2) || !isInt(table.round, 0, 1000)) return null;
  if (!Array.isArray(table.seats) || table.seats.length !== 2) return null;
  for (const seat of table.seats) {
    if (!isObject(seat) || !isInt(seat.chips, 0, 10_000_000) || !isInt(seat.bet, 0, 10_000_000) || !isInt(seat.active, 0, MAX_HANDS)) return null;
    if (!Array.isArray(seat.hands) || seat.hands.length > MAX_HANDS || !seat.hands.every(isHand)) return null;
  }
  if (!isInt(raw.shoeLeft, 0, 10_000) || !isInt(raw.first, 0, 1) || !isInt(raw.moves, 0, 1_000_000)) return null;
  if (!Array.isArray(raw.placed) || raw.placed.length !== 2 || !raw.placed.every((v) => typeof v === 'boolean')) return null;
  let last: BlackjackView['last'] = null;
  if (raw.last !== null) {
    if (!isObject(raw.last) || !isInt(raw.last.seat, 0, 1)) return null;
    const move = readBlackjackMove(raw.last.move);
    if (!move) return null;
    last = { seat: raw.last.seat as RoomSeat, move };
  }
  return {
    table: {
      shoe: [],
      dealer: table.dealer as Card[],
      holeHidden: table.holeHidden,
      seats: table.seats as Table['seats'],
      turn: table.turn,
      phase: table.phase as Table['phase'],
      round: table.round,
    },
    shoeLeft: raw.shoeLeft,
    first: raw.first as RoomSeat,
    placed: [raw.placed[0], raw.placed[1]],
    moves: raw.moves,
    last,
  };
}

export const blackjackVersus: TurnGame<BlackjackMatch, BlackjackMove, BlackjackView> = {
  id: 'blackjack',
  start: startBlackjack,
  readMove: readBlackjackMove,
  play(state, seat, move) {
    if (!play(state, seat, move)) return false;
    state.moves += 1;
    state.last = { seat, move: { ...move } };
    return true;
  },
  turnOf: blackjackTurn,
  outcome(state) {
    return blackjackOver(state) ? { winner: blackjackWinner(state.table) } : undefined;
  },
  view(state) {
    return blackjackView(state);
  },
  readView: readBlackjackView,
};

