/**
 * 친구와 함께하는 포커: 공용 방 규칙(versus/room.ts)에 포커를 끼우는 부분. Phaser에 기대지 않아서 서버도 그대로 쓴다.
 *
 * 방에는 두 사람이 들어오고, 남는 자리는 컴퓨터(bot.ts)가 채운다.
 * - 첫 핸드를 나누는 사람이 함께 앉을 컴퓨터 수(0~2명)를 고른다. 그래서 탁자는 둘에서 넷까지다.
 *   사람은 탁자에서 마주 보게 앉는다(0번과 2번 자리 또는 0번과 1번 자리).
 * - 컴퓨터의 차례는 사람이 수를 둔 바로 뒤에 저절로 둔다. 그래서 둘 차례는 늘 사람이다.
 * - 핸드가 끝나면 마지막으로 수를 둔 사람이 "다음 판"을 눌러 딜한다(한 폰이면 지금 폰을 든 사람이다).
 * - HANDS번 딜하거나 친구 중 누가 칩을 다 잃으면 끝나고, 칩이 더 많은 사람이 이긴다(같으면 비긴다).
 * 화면에 보낼 때는 보는 사람이 늘 0번 자리가 되도록 탁자를 돌리고, 남의 손패와 덱, 난수(seed)는 가린다.
 * 그래서 화면은 컴퓨터와 할 때와 같은 그리기 코드로 친구와의 판도 그린다.
 */
import type { Seat as RoomSeat } from '../../versus/protocol';
import type { TurnGame } from '../../versus/room';
import { seededRandom, seedFrom } from '../../versus/seeded';
import { SUITS } from '../high-low/rules';
import { BOT_STYLES, chooseMove, VERSUS_SAMPLES } from './bot';
import type { HandValue } from './hands';
import {
  act,
  BOT_NAMES,
  createTable,
  HANDS,
  seatsInPlay,
  shownAtShowdown,
  startHand,
  type Card,
  type HandResult,
  type LastAction,
  type Move,
  type PokerSeat,
  type PokerTable,
  type Street,
} from './rules';

/** 함께 앉힐 수 있는 컴퓨터의 수 */
export const MAX_BOTS = 2;
/** 고르지 않았을 때 앉히는 컴퓨터의 수 */
export const DEFAULT_BOTS = 2;

export type PokerVersusMove = Move | { type: 'deal'; bots?: number };

/** 한 번에 일어난 일 하나: 누가(탁자 자리) 무엇을 했는지 */
export interface PokerLog {
  who: number;
  type: LastAction['type'];
  amount: number;
}

/** 서버에 저장하는 판 */
export interface PokerMatch {
  /** 탁자. 첫 핸드를 나누기 전(컴퓨터 수를 고르기 전)에는 null */
  table: PokerTable | null;
  seed: number;
  /** 방의 자리마다 앉은 탁자 자리 */
  humans: [number, number];
  /** 다음에 딜할 사람(첫 핸드는 컴퓨터 수도 고른다) */
  dealer: RoomSeat;
  /** 둔 수의 수 */
  moves: number;
  /** 마지막 수로 일어난 일(사람의 수와 그 뒤 컴퓨터들의 수). 화면이 알림 줄에 쓴다. */
  log: PokerLog[];
}

/** 한 자리가 보는 판. 탁자는 보는 사람이 0번 자리가 되도록 돌려 두었다. */
export interface PokerView {
  table: PokerTable | null;
  /** 방의 자리마다 앉은 탁자 자리(돌린 뒤의 번호) */
  humans: [number, number];
  dealer: RoomSeat;
  moves: number;
  log: PokerLog[];
}

const MOVE_TYPES = ['fold', 'check', 'call', 'raise', 'allin'] as const;
const LOG_TYPES: readonly LastAction['type'][] = ['fold', 'check', 'call', 'raise', 'allin', 'blind'];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isInt = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

export function readPokerMove(raw: unknown): PokerVersusMove | null {
  if (!isObject(raw)) return null;
  if (raw.type === 'deal') {
    if (raw.bots === undefined) return { type: 'deal' };
    return isInt(raw.bots, 0, MAX_BOTS) ? { type: 'deal', bots: raw.bots } : null;
  }
  if (raw.type === 'raise') return isInt(raw.to, 1, 1_000_000) ? { type: 'raise', to: raw.to } : null;
  return (MOVE_TYPES as readonly string[]).includes(raw.type as string) ? ({ type: raw.type } as Move) : null;
}

/** 컴퓨터 수에 맞는 탁자의 이름과, 두 사람이 앉을 자리. 사람 자리의 이름은 화면이 방의 이름으로 바꿔 적는다. */
export function seatPlan(bots: number): { names: string[]; humans: [number, number] } {
  if (bots <= 0) return { names: ['', ''], humans: [0, 1] };
  if (bots === 1) return { names: ['', BOT_NAMES[0], ''], humans: [0, 2] };
  return { names: ['', BOT_NAMES[0], '', BOT_NAMES[1]], humans: [0, 2] };
}

export function startPoker(random: () => number, first: RoomSeat): PokerMatch {
  return { table: null, seed: seedFrom(random), humans: [0, 2], dealer: first, moves: 0, log: [] };
}

/** 판이 끝났는지: 정한 수만큼 딜했거나, 친구 중 누가 칩을 다 잃었거나, 혼자 남았다. */
export function pokerOver(state: { table: PokerTable | null; humans: readonly number[] }): boolean {
  const { table } = state;
  if (!table || table.phase === 'betting' || table.handNo === 0) return false;
  return table.handNo >= HANDS || state.humans.some((index) => table.seats[index].out) || seatsInPlay(table) < 2;
}

/** 지금 둘 차례인 자리. 판이 끝났으면 null */
export function pokerTurn(state: { table: PokerTable | null; humans: readonly number[]; dealer: RoomSeat }): RoomSeat | null {
  const { table } = state;
  if (!table || table.phase !== 'betting') return pokerOver(state) ? null : state.dealer;
  const seat = state.humans.indexOf(table.toAct ?? -1);
  return seat === 0 || seat === 1 ? seat : null;
}

/**
 * seat가 지금 수를 둘 수 있는지. 핸드와 핸드 사이에는 두 사람 누구나 "다음 판"을 눌러 딜할 수 있다
 * (온라인에서 한 사람만 누를 수 있으면 그 사람이 자리를 비웠을 때 판이 멈춘다). 그 밖에는 차례인 사람만 둔다.
 */
export function pokerCanPlay(state: { table: PokerTable | null; humans: readonly number[]; dealer: RoomSeat }, seat: RoomSeat): boolean {
  const turn = pokerTurn(state);
  if (turn === null) return false;
  if (state.table && state.table.phase !== 'betting') return true;
  return turn === seat;
}

const isHuman = (state: PokerMatch, index: number): boolean => state.humans.includes(index);

/** 컴퓨터의 차례가 이어지는 동안 대신 둔다. */
function runBots(state: PokerMatch, random: () => number): void {
  const table = state.table;
  if (!table) return;
  // 한 핸드에 둘 수 있는 수는 많아야 수십 번이다. 혹시라도 멈추지 않으면 끊는다.
  for (let guard = 0; guard < 200 && table.phase === 'betting' && table.toAct !== null && !isHuman(state, table.toAct); guard += 1) {
    const index = table.toAct;
    const botNo = table.seats.slice(0, index).filter((_, i) => !isHuman(state, i)).length;
    const move = chooseMove(table, index, BOT_STYLES[botNo % BOT_STYLES.length], random, VERSUS_SAMPLES) ?? { type: 'fold' };
    if (!act(table, index, move) && !act(table, index, { type: 'fold' })) act(table, index, { type: 'check' });
    note(state, index);
  }
}

function note(state: PokerMatch, index: number): void {
  const last = state.table?.seats[index].last;
  if (last) state.log.push({ who: index, type: last.type, amount: last.amount });
}

function play(state: PokerMatch, seat: RoomSeat, move: PokerVersusMove): boolean {
  if (!pokerCanPlay(state, seat)) return false;
  const random = seededRandom(state);
  if (move.type === 'deal') {
    if (!state.table) {
      const plan = seatPlan(move.bots ?? DEFAULT_BOTS);
      state.table = createTable(plan.names);
      state.humans = plan.humans;
      // 처음 딜하는 사람이 버튼(딜러)이 되게 바로 앞 자리에 둔다. startHand가 한 칸 옮긴다.
      const count = state.table.seats.length;
      state.table.button = (state.humans[seat] - 1 + count) % count;
    }
    if (state.table.phase === 'betting' || !startHand(state.table, random)) return false;
    state.log = [];
  } else {
    const table = state.table;
    if (!table || table.phase !== 'betting') return false;
    if (!act(table, state.humans[seat], move)) return false;
    state.log = [];
    note(state, state.humans[seat]);
  }
  state.dealer = seat;
  runBots(state, random);
  return true;
}

/** 이긴 자리. 칩을 다 잃은 사람이 지고, 아니면 칩이 많은 사람이 이긴다. 같으면 null */
export function pokerWinner(table: PokerTable, humans: readonly number[]): RoomSeat | null {
  const [a, b] = humans.map((index) => table.seats[index]);
  if (a.out !== b.out) return a.out ? 1 : 0;
  if (a.chips === b.chips) return null;
  return a.chips > b.chips ? 0 : 1;
}

// ───────── 자리마다 보이는 판 ─────────

/** 남의 손패. 장 수만 알 수 있게 숫자 0으로 보낸다. */
const HIDDEN: Card = { rank: 0, suit: 'spade' };

const copyCard = (card: Card): Card => ({ rank: card.rank, suit: card.suit });

/**
 * viewer 자리가 0번이 되도록 탁자를 돌리고, 그 자리가 보면 안 되는 카드를 가린다.
 * 쇼다운까지 남은 사람의 손패는 모두에게 보인다.
 */
export function turnTable(table: PokerTable, viewer: number): PokerTable {
  const count = table.seats.length;
  const to = (index: number): number => (index - viewer + count) % count;
  const order = table.seats.map((_, i) => (i + viewer) % count);
  const result: HandResult | null = table.result && {
    showdown: table.result.showdown,
    pots: table.result.pots.map((pot) => ({ amount: pot.amount, eligible: pot.eligible.map(to), winners: pot.winners.map(to) })),
    payouts: order.map((i) => table.result!.payouts[i]),
    values: order.map((i) => {
      const value = table.result!.values[i];
      return value ? { category: value.category, kickers: [...value.kickers], cards: value.cards.map(copyCard) } : null;
    }),
  };
  return {
    ...table,
    deck: [],
    board: table.board.map(copyCard),
    seats: order.map((i): PokerSeat => {
      const seat = table.seats[i];
      const open = i === viewer || shownAtShowdown(table, i);
      return { ...seat, last: seat.last && { ...seat.last }, hole: seat.hole.map((card) => (open ? copyCard(card) : { ...HIDDEN })) };
    }),
    button: table.button < 0 ? -1 : to(table.button),
    toAct: table.toAct === null ? null : to(table.toAct),
    result,
  };
}

export function pokerView(state: PokerMatch, seat: RoomSeat): PokerView {
  const viewer = state.humans[seat];
  const count = state.table?.seats.length ?? 1;
  const to = (index: number): number => (index - viewer + count) % count;
  return {
    table: state.table && turnTable(state.table, viewer),
    humans: state.table ? [to(state.humans[0]), to(state.humans[1])] : [0, 0],
    dealer: state.dealer,
    moves: state.moves,
    log: state.log.map((entry) => ({ ...entry, who: to(entry.who) })),
  };
}

// ───────── 서버가 보낸 판 읽기 ─────────

const STREETS: readonly Street[] = ['preflop', 'flop', 'turn', 'river', 'showdown'];
const PHASES = ['idle', 'betting', 'done'] as const;
const CHIPS = 1_000_000;

function isCard(raw: unknown, allowHidden: boolean): raw is Card {
  if (!isObject(raw) || !SUITS.includes(raw.suit as Card['suit'])) return false;
  return isInt(raw.rank, allowHidden ? 0 : 1, 13);
}

const isCards = (raw: unknown, max: number, allowHidden: boolean): raw is Card[] =>
  Array.isArray(raw) && raw.length <= max && raw.every((card) => isCard(card, allowHidden));

function isSeat(raw: unknown): raw is PokerSeat {
  if (!isObject(raw) || typeof raw.name !== 'string' || raw.name.length > 20) return false;
  if (!isInt(raw.chips, 0, CHIPS) || !isInt(raw.bet, 0, CHIPS) || !isInt(raw.committed, 0, CHIPS)) return false;
  if (!isCards(raw.hole, 2, true)) return false;
  for (const key of ['folded', 'allIn', 'acted', 'out'] as const) if (typeof raw[key] !== 'boolean') return false;
  if (raw.last === null) return true;
  return isObject(raw.last) && LOG_TYPES.includes(raw.last.type as LastAction['type']) && isInt(raw.last.amount, 0, CHIPS);
}

const isIndexList = (raw: unknown, count: number): raw is number[] =>
  Array.isArray(raw) && raw.length <= count && raw.every((value) => isInt(value, 0, count - 1));

function isValue(raw: unknown): raw is HandValue {
  if (!isObject(raw) || !isInt(raw.category, 0, 9)) return false;
  return Array.isArray(raw.kickers) && raw.kickers.length <= 5 && raw.kickers.every((v) => isInt(v, 1, 14)) && isCards(raw.cards, 5, false);
}

function isResult(raw: unknown, count: number): raw is HandResult {
  if (!isObject(raw) || typeof raw.showdown !== 'boolean') return false;
  if (!Array.isArray(raw.pots) || raw.pots.length > count) return false;
  for (const pot of raw.pots) {
    if (!isObject(pot) || !isInt(pot.amount, 0, CHIPS * count) || !isIndexList(pot.eligible, count) || !isIndexList(pot.winners, count)) return false;
  }
  if (!Array.isArray(raw.payouts) || raw.payouts.length !== count || !raw.payouts.every((v) => isInt(v, 0, CHIPS * count))) return false;
  return Array.isArray(raw.values) && raw.values.length === count && raw.values.every((v) => v === null || isValue(v));
}

function readTable(raw: unknown): PokerTable | null {
  if (!isObject(raw) || !Array.isArray(raw.seats) || raw.seats.length < 2 || raw.seats.length > 2 + MAX_BOTS) return null;
  const count = raw.seats.length;
  if (!raw.seats.every(isSeat) || !isCards(raw.board, 5, false)) return null;
  if (!isInt(raw.button, -1, count - 1) || !isInt(raw.smallBlind, 0, CHIPS) || !isInt(raw.bigBlind, 0, CHIPS)) return null;
  if (!STREETS.includes(raw.street as Street) || !PHASES.includes(raw.phase as (typeof PHASES)[number])) return null;
  if (raw.toAct !== null && !isInt(raw.toAct, 0, count - 1)) return null;
  if (!isInt(raw.currentBet, 0, CHIPS) || !isInt(raw.minRaise, 0, CHIPS) || !isInt(raw.handNo, 0, 1000)) return null;
  if (raw.result !== null && !isResult(raw.result, count)) return null;
  return {
    deck: [],
    board: raw.board,
    seats: raw.seats,
    button: raw.button,
    smallBlind: raw.smallBlind,
    bigBlind: raw.bigBlind,
    street: raw.street as Street,
    phase: raw.phase as PokerTable['phase'],
    toAct: raw.toAct,
    currentBet: raw.currentBet,
    minRaise: raw.minRaise,
    handNo: raw.handNo,
    result: raw.result as HandResult | null,
  };
}

export function readPokerView(raw: unknown): PokerView | null {
  if (!isObject(raw) || !isInt(raw.moves, 0, 1_000_000) || !isInt(raw.dealer, 0, 1)) return null;
  let table: PokerTable | null = null;
  if (raw.table !== null) {
    table = readTable(raw.table);
    if (!table) return null;
  }
  const count = table?.seats.length ?? 1;
  if (!Array.isArray(raw.humans) || raw.humans.length !== 2 || !raw.humans.every((v) => isInt(v, 0, count - 1))) return null;
  if (!Array.isArray(raw.log) || raw.log.length > 200) return null;
  for (const entry of raw.log) {
    if (!isObject(entry) || !isInt(entry.who, 0, count - 1) || !LOG_TYPES.includes(entry.type as LastAction['type']) || !isInt(entry.amount, 0, CHIPS)) return null;
  }
  return {
    table,
    humans: [raw.humans[0], raw.humans[1]],
    dealer: raw.dealer as RoomSeat,
    moves: raw.moves,
    log: raw.log as PokerLog[],
  };
}

export const pokerVersus: TurnGame<PokerMatch, PokerVersusMove, PokerView> = {
  id: 'poker',
  start: startPoker,
  readMove: readPokerMove,
  play(state, seat, move) {
    if (!play(state, seat, move)) return false;
    state.moves += 1;
    return true;
  },
  turnOf: pokerTurn,
  outcome(state) {
    return state.table && pokerOver(state) ? { winner: pokerWinner(state.table, state.humans) } : undefined;
  },
  view: pokerView,
  readView: readPokerView,
};
