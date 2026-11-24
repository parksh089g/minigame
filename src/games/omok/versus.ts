/**
 * 친구와 함께하는 오목: 공용 방 규칙(versus/room.ts)에 오목을 끼우는 부분. Phaser에 기대지 않아서 서버도 그대로 쓴다.
 *
 * 판은 둔 자리의 목록(moves)과, 검은 돌을 쥔 자리(black)만 저장한다. 판의 모습은 목록을 처음부터 다시 놓아 만든다.
 * 먼저 두는 자리(first)가 검은 돌이다. 방은 판마다 먼저 두는 자리를 번갈아 바꾸므로 흑백도 판마다 바뀐다.
 * 오목은 상대가 몰라야 할 것이 없어서 두 자리 모두 같은 판을 보고, 내 돌의 색만 다르게 알려 준다.
 */
import type { Seat } from '../../versus/protocol';
import type { TurnGame } from '../../versus/room';
import { BLACK, isOver, isPoint, placeStone, POINTS, replay, toMove, WHITE, type OmokState, type Stone } from './rules';

export type OmokMove = { type: 'place'; at: number };

/** 서버에 저장하는 판 */
export interface OmokMatch {
  moves: number[];
  /** 검은 돌(먼저 두는 쪽)을 쥔 자리 */
  black: Seat;
}

/** 한 자리가 보는 판 */
export interface OmokView {
  moves: number[];
  /** 이 자리의 돌 */
  mine: Stone;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function readOmokMove(raw: unknown): OmokMove | null {
  if (!isObject(raw) || raw.type !== 'place' || !isPoint(raw.at)) return null;
  return { type: 'place', at: raw.at };
}

export const stoneOf = (match: Pick<OmokMatch, 'black'>, seat: Seat): Stone => (seat === match.black ? BLACK : WHITE);
const seatOf = (match: Pick<OmokMatch, 'black'>, stone: Stone): Seat => (stone === BLACK ? match.black : match.black === 0 ? 1 : 0);

/** 저장된 판을 다시 놓아 본다. 저장된 것은 늘 둘 수 있는 수만 담고 있다. */
const board = (match: OmokMatch): OmokState => replay(match.moves) ?? replay([])!;

export function omokTurn(match: OmokMatch): Seat | null {
  const state = board(match);
  if (isOver(state)) return null;
  return seatOf(match, toMove(state));
}

/** 서버가 보낸 판을 확인하며 읽는다. 둘 수 없는 수가 끼어 있으면 null */
export function readOmokView(raw: unknown): OmokView | null {
  if (!isObject(raw) || (raw.mine !== BLACK && raw.mine !== WHITE)) return null;
  if (!Array.isArray(raw.moves) || raw.moves.length > POINTS || !raw.moves.every(isPoint)) return null;
  const moves = raw.moves as number[];
  if (replay(moves) === null) return null;
  return { moves: moves.slice(), mine: raw.mine };
}

export const omokVersus: TurnGame<OmokMatch, OmokMove, OmokView> = {
  id: 'omok',
  start: (_random, first) => ({ moves: [], black: first }),
  readMove: readOmokMove,
  play(match, seat, move) {
    if (omokTurn(match) !== seat) return false;
    const state = board(match);
    if (!placeStone(state, move.at)) return false;
    match.moves.push(move.at);
    return true;
  },
  turnOf: omokTurn,
  outcome(match) {
    const state = board(match);
    if (state.winner !== null) return { winner: seatOf(match, state.winner) };
    if (state.draw) return { winner: null };
    return undefined;
  },
  view: (match, seat) => ({ moves: match.moves.slice(), mine: stoneOf(match, seat) }),
  readView: readOmokView,
};
