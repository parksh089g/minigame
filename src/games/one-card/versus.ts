/**
 * 친구와 함께하는 원카드: 공용 방 규칙(versus/room.ts)에 원카드를 끼우는 부분. Phaser에 기대지 않아서 서버도 그대로 쓴다.
 *
 * 판은 rules.ts의 GameState를 두 사람으로 만들어 쓰고, 자리 0이 0번, 자리 1이 1번 사람이다.
 * 화면에 보낼 때는 보는 자리가 늘 0번이 되도록 뒤집고, 상대의 손패와 덱, 난수(seed)는 가린다.
 * 그래서 화면은 컴퓨터와 할 때와 같은 그리기 코드로 친구와의 판도 그린다.
 *
 * 원카드 외치기: 컴퓨터와 할 때는 누가 먼저 누르는지 겨루지만, 친구와는 각자의 폰이라 그렇게 겨룰 수 없다.
 * 그래서 카드가 한 장 남은 사람이 정해진 시간 안에 "원카드!"를 누르는지로 한다. 그동안 차례는 그 사람에게 머물고,
 * 시간 안에 누르면 'call', 놓치면 화면이 'miss'를 보내 한 장을 받는다.
 */
import type { Seat } from '../../versus/protocol';
import type { TurnGame } from '../../versus/room';
import { seedFrom } from '../../versus/seeded';
import {
  callOneCard,
  catchOneCard,
  chooseSuit,
  createGame,
  drawTurn,
  MAX_HAND,
  playCard,
  SUITS,
  takeEvents,
  type Card,
  type GameEvent,
  type GameState,
  type Suit,
} from './rules';

/** 원카드를 외칠 수 있는 시간(ms). 화면이 잰다. */
export const CALL_WINDOW_MS = 3000;

export type OneCardMove =
  | { type: 'play'; card: number }
  | { type: 'draw' }
  | { type: 'suit'; suit: Suit }
  | { type: 'call' }
  | { type: 'miss' };

/** 서버에 저장하는 판: 원카드의 판과, 마지막 수로 일어난 일 */
export interface OneCardMatch {
  game: GameState;
  /** 마지막 수로 일어난 일. 화면이 알림 줄과 소리에 쓴다. */
  events: GameEvent[];
  /** 둔 수의 수. 화면이 새로 일어난 일인지 가린다. */
  moves: number;
}

/** 한 자리가 보는 판. game은 보는 자리가 0번이다. */
export interface OneCardView {
  game: GameState;
  events: GameEvent[];
  moves: number;
}

/** 장 수만 알 수 있게 가린 카드 */
export const HIDDEN_CARD = -1;
const hidden = (count: number): Card[] => Array.from({ length: count }, (_, index) => ({ id: HIDDEN_CARD - index, suit: null, rank: -1 }));

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isInt = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
const isSuit = (value: unknown): value is Suit => typeof value === 'string' && (SUITS as readonly string[]).includes(value);

/** 밖에서 온 수를 확인하며 읽는다. */
export function readOneCardMove(raw: unknown): OneCardMove | null {
  if (!isObject(raw)) return null;
  switch (raw.type) {
    case 'play':
      return isInt(raw.card, 0, 53) ? { type: 'play', card: raw.card } : null;
    case 'suit':
      return isSuit(raw.suit) ? { type: 'suit', suit: raw.suit } : null;
    case 'draw':
    case 'call':
    case 'miss':
      return { type: raw.type };
    default:
      return null;
  }
}

/** 두 사람의 판을 나눈다. first가 먼저 낸다. */
export function startOneCard(random: () => number, first: Seat): OneCardMatch {
  const game = createGame(1, seedFrom(random));
  game.turn = first;
  return { game, events: [], moves: 0 };
}

/** 지금 둘 차례인 자리. 원카드를 외칠 사람이 있으면 그 사람이다. 판이 끝났으면 null */
export function oneCardTurn(game: GameState): Seat | null {
  if (game.winner !== null) return null;
  if (game.oneCard !== null) return game.oneCard as Seat;
  return game.turn as Seat;
}

function apply(game: GameState, seat: Seat, move: OneCardMove): boolean {
  if (game.oneCard !== null) {
    // 한 장 남은 사람이 외치거나(call), 시간을 놓쳐 한 장 받는다(miss). 그 밖의 수는 받지 않는다.
    if (game.oneCard !== seat) return false;
    if (move.type === 'call') return callOneCard(game, seat);
    if (move.type === 'miss') return catchOneCard(game, seat === 0 ? 1 : 0);
    return false;
  }
  if (game.turn !== seat) return false;
  if (game.choosingSuit) return move.type === 'suit' && chooseSuit(game, move.suit);
  if (move.type === 'play') return playCard(game, seat, move.card);
  if (move.type === 'draw') return drawTurn(game, seat);
  return false;
}

/** 자리 seat에서 본 사람 번호(보는 사람이 0번) */
const turned = (seat: Seat, who: number): number => (seat === 0 ? who : who === 0 ? 1 : who === 1 ? 0 : who);

function turnEvent(event: GameEvent, seat: Seat): GameEvent {
  const copy = { ...event } as GameEvent & { who?: number; by?: number };
  if ('who' in event) copy.who = turned(seat, event.who);
  if ('by' in event) copy.by = turned(seat, event.by);
  if ('card' in event) (copy as { card: Card }).card = { ...event.card };
  return copy;
}

/** 판을 보는 자리 쪽에서 본 모습으로 바꾼다. 판이 끝나기 전까지 상대의 손패와 덱은 장 수만 남기고, seed는 지운다. */
export function oneCardPerspective(game: GameState, seat: Seat): GameState {
  const order = seat === 0 ? [0, 1] : [1, 0];
  const over = game.winner !== null;
  const map = (who: number | null): number | null => (who === null ? null : turned(seat, who));
  return {
    players: order.map((who, index) => {
      const player = game.players[who];
      const hand = index === 0 || over ? player.hand.map((card) => ({ ...card })) : hidden(player.hand.length);
      return { hand, out: player.out };
    }),
    deck: hidden(game.deck.length),
    discard: game.discard.map((card) => ({ ...card })),
    suit: game.suit,
    turn: turned(seat, game.turn),
    dir: game.dir,
    attack: game.attack,
    choosingSuit: game.choosingSuit,
    oneCard: map(game.oneCard),
    winner: map(game.winner),
    voids: [[], []],
    seed: 0,
    events: [],
  };
}

function readCard(raw: unknown, allowHidden: boolean): raw is Card {
  if (!isObject(raw)) return false;
  if (allowHidden && typeof raw.id === 'number' && raw.id < 0) return raw.suit === null && raw.rank === -1;
  if (!isInt(raw.id, 0, 53)) return false;
  if (raw.suit === null) return raw.rank === 0 || raw.rank === 1;
  return isSuit(raw.suit) && isInt(raw.rank, 1, 13);
}

const isCards = (value: unknown, allowHidden: boolean, max = 54): value is Card[] =>
  Array.isArray(value) && value.length <= max && value.every((card) => readCard(card, allowHidden));

const EVENT_KINDS = ['play', 'draw', 'suit', 'skip', 'reverse', 'again', 'block', 'broke', 'call', 'caught', 'win'] as const;

function isEvent(raw: unknown): raw is GameEvent {
  if (!isObject(raw) || !EVENT_KINDS.includes(raw.k as (typeof EVENT_KINDS)[number])) return false;
  if (raw.k !== 'reverse' && !isInt(raw.who, 0, 1)) return false;
  if (raw.k === 'play') return readCard(raw.card, false);
  if (raw.k === 'draw') return isInt(raw.count, 0, 54) && typeof raw.attack === 'boolean';
  if (raw.k === 'suit') return isSuit(raw.suit);
  if (raw.k === 'caught') return isInt(raw.by, 0, 1);
  return true;
}

const isWho = (value: unknown): value is number | null => value === null || isInt(value, 0, 1);

/** 서버가 보낸 판을 확인하며 읽는다. 그리는 데 쓰는 것만 확인하고, 모양이 맞지 않으면 null */
export function readOneCardView(raw: unknown): OneCardView | null {
  if (!isObject(raw) || !isObject(raw.game) || !Array.isArray(raw.events) || !isInt(raw.moves, 0, 1_000_000)) return null;
  const game = raw.game;
  if (!Array.isArray(game.players) || game.players.length !== 2) return null;
  for (const player of game.players) {
    if (!isObject(player) || !isCards(player.hand, true, MAX_HAND + 8) || typeof player.out !== 'boolean') return null;
  }
  if (!isCards(game.deck, true) || !isCards(game.discard, false) || game.discard.length === 0) return null;
  if (game.suit !== null && !isSuit(game.suit)) return null;
  if (!isInt(game.turn, 0, 1) || (game.dir !== 1 && game.dir !== -1) || !isInt(game.attack, 0, 200)) return null;
  if (typeof game.choosingSuit !== 'boolean' || !isWho(game.oneCard) || !isWho(game.winner)) return null;
  if (!raw.events.every(isEvent)) return null;
  const state: GameState = {
    players: (game.players as Array<{ hand: Card[]; out: boolean }>).map((player) => ({ hand: player.hand, out: player.out })),
    deck: game.deck,
    discard: game.discard,
    suit: game.suit as Suit | null,
    turn: game.turn,
    dir: game.dir,
    attack: game.attack,
    choosingSuit: game.choosingSuit,
    oneCard: game.oneCard,
    winner: game.winner,
    voids: [[], []],
    seed: 0,
    events: [],
  };
  return { game: state, events: raw.events as GameEvent[], moves: raw.moves };
}

export const oneCardVersus: TurnGame<OneCardMatch, OneCardMove, OneCardView> = {
  id: 'one-card',
  start: startOneCard,
  readMove: readOneCardMove,
  play(state, seat, move) {
    if (!apply(state.game, seat, move)) return false;
    state.events = takeEvents(state.game);
    state.moves += 1;
    return true;
  },
  turnOf(state) {
    return oneCardTurn(state.game);
  },
  outcome(state) {
    const winner = state.game.winner;
    return winner === null ? undefined : { winner: winner as Seat };
  },
  view(state, seat) {
    return {
      game: oneCardPerspective(state.game, seat),
      events: state.events.map((event) => turnEvent(event, seat)),
      moves: state.moves,
    };
  },
  readView: readOneCardView,
};
