/**
 * 친구와 함께하는 훌라: 공용 방 규칙(versus/room.ts)에 훌라를 끼우는 부분. Phaser에 의존하지 않아서 서버도 그대로 쓴다.
 *
 * 판은 rules.ts의 HulaState를 그대로 쓰고, 0번 자리를 'me', 1번 자리를 'cpu' 쪽에 앉힌다.
 * 화면에 보낼 때는 보는 자리가 늘 'me' 쪽이 되도록 뒤집고, 상대의 손패와 덱은 가린다(HIDDEN).
 * 그래서 화면은 컴퓨터와 할 때와 같은 그리기 코드로 친구와의 판도 그린다.
 */
import type { Seat } from '../../versus/protocol';
import type { TurnGame } from '../../versus/room';
import { DECK_SIZE } from './cards';
import {
  discard,
  drawStock,
  layOff,
  meld,
  newRound,
  other,
  takeDiscard,
  type HulaState,
  type Meld,
  type Phase,
  type Side,
} from './rules';

/** 가린 카드. 장 수만 알 수 있다. */
export const HIDDEN = -1;

/** 친구와의 판에서 두는 수 하나. 컴퓨터가 두는 수(bot.ts의 BotStep)와 모양이 같다. */
export type HulaMove =
  | { type: 'draw' }
  | { type: 'take' }
  | { type: 'meld'; cards: number[] }
  | { type: 'layoff'; card: number; meld: number }
  | { type: 'discard'; card: number };

/** 지난 차례에 한 일 하나. 버린 카드 더미에서 가져온 카드는 모두가 봤으므로 적어 둔다. */
export type HulaStep = HulaMove & { card?: number };

/** 서버에 저장하는 판: 훌라의 판과, 자리마다 마지막 차례에 한 일 */
export interface HulaMatch {
  round: HulaState;
  turns: [HulaStep[], HulaStep[]];
}

/** 한 자리가 보는 판. round는 보는 자리가 'me'이고, theirs는 상대가 마지막 차례에 한 일이다. */
export interface HulaView {
  round: HulaState;
  theirs: HulaStep[];
}

export const sideOfSeat = (seat: Seat): Side => (seat === 0 ? 'me' : 'cpu');
const seatOfSide = (side: Side): Seat => (side === 'me' ? 0 : 1);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isCard = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < DECK_SIZE;
const isSeen = (value: unknown): value is number => value === HIDDEN || isCard(value);
const isCards = (value: unknown, max = DECK_SIZE): value is number[] =>
  Array.isArray(value) && value.length <= max && value.every(isCard);

/** 밖에서 온 수를 확인하며 읽는다. */
export function readHulaMove(raw: unknown): HulaMove | null {
  if (!isObject(raw)) return null;
  switch (raw.type) {
    case 'draw':
    case 'take':
      return { type: raw.type };
    case 'meld':
      return isCards(raw.cards, 13) && raw.cards.length > 0 ? { type: 'meld', cards: [...raw.cards] } : null;
    case 'layoff':
      return isCard(raw.card) && typeof raw.meld === 'number' && Number.isInteger(raw.meld) && raw.meld >= 0 && raw.meld < DECK_SIZE
        ? { type: 'layoff', card: raw.card, meld: raw.meld }
        : null;
    case 'discard':
      return isCard(raw.card) ? { type: 'discard', card: raw.card } : null;
    default:
      return null;
  }
}

/** 판을 보는 자리 쪽에서 본 모습으로 바꾼다. 판이 끝나기 전까지 상대의 손패와 덱은 장 수만 남긴다. */
export function perspective(round: HulaState, seat: Seat): HulaState {
  const mine = sideOfSeat(seat);
  const theirs = other(mine);
  const turned = (side: Side): Side => (side === mine ? 'me' : 'cpu');
  const pair = <T>(value: Record<Side, T>, copy: (item: T) => T): Record<Side, T> => ({
    me: copy(value[mine]),
    cpu: copy(value[theirs]),
  });
  const over = round.phase === 'over';
  const result = round.result;
  return {
    stock: round.stock.map(() => HIDDEN),
    discard: [...round.discard],
    hands: { me: [...round.hands[mine]], cpu: over ? [...round.hands[theirs]] : round.hands[theirs].map(() => HIDDEN) },
    melds: round.melds.map((m): Meld => ({ cards: [...m.cards], owner: turned(m.owner), kind: m.kind })),
    turn: turned(round.turn),
    phase: round.phase,
    taken: round.taken,
    freshTurn: round.freshTurn,
    registered: pair(round.registered, (v) => v),
    pickups: pair(round.pickups, (v) => [...v]),
    result: result && {
      ...result,
      winner: result.winner === null ? null : turned(result.winner),
      left: pair(result.left, (v) => v),
    },
  };
}

function readStep(raw: unknown): HulaStep | null {
  const move = readHulaMove(raw);
  if (!move || !isObject(raw)) return null;
  return raw.card !== undefined && isCard(raw.card) ? { ...move, card: raw.card } : move;
}

const PHASES: readonly Phase[] = ['draw', 'play', 'over'];
const isSide = (value: unknown): value is Side => value === 'me' || value === 'cpu';

/** 서버가 보낸 판을 확인하며 읽는다. 그리는 데 쓰는 것만 확인하고, 모양이 맞지 않으면 null */
export function readHulaView(raw: unknown): HulaView | null {
  if (!isObject(raw) || !isObject(raw.round) || !Array.isArray(raw.theirs)) return null;
  const round = raw.round;
  const hands = round.hands;
  if (!isObject(hands) || !isCards(hands.me) || !Array.isArray(hands.cpu) || !hands.cpu.every(isSeen)) return null;
  if (!Array.isArray(round.stock) || !round.stock.every(isSeen) || !isCards(round.discard)) return null;
  if (!Array.isArray(round.melds) || !round.melds.every((m) => isObject(m) && isCards(m.cards) && isSide(m.owner))) return null;
  if (!isSide(round.turn) || !PHASES.includes(round.phase as Phase)) return null;
  if (round.taken !== null && !isCard(round.taken)) return null;
  if (!isObject(round.registered) || !isObject(round.pickups)) return null;
  if (round.phase === 'over' && !isObject(round.result)) return null;
  const theirs = raw.theirs.map(readStep);
  if (theirs.some((step) => step === null)) return null;
  return { round: round as unknown as HulaState, theirs: theirs as HulaStep[] };
}

/** 이 수를 둔다. 해냈으면 그 차례에 한 일(가져온 카드를 적은 것)을, 아니면 null */
function apply(round: HulaState, move: HulaMove): HulaStep | null {
  switch (move.type) {
    case 'draw':
      return drawStock(round) === null ? null : { type: 'draw' };
    case 'take': {
      const card = takeDiscard(round);
      return card === null ? null : { type: 'take', card };
    }
    case 'meld':
      return meld(round, move.cards) ? { type: 'meld', cards: [...move.cards] } : null;
    case 'layoff':
      return layOff(round, move.card, move.meld) ? { ...move } : null;
    case 'discard':
      return discard(round, move.card) ? { ...move } : null;
  }
}

export const hulaVersus: TurnGame<HulaMatch, HulaMove, HulaView> = {
  id: 'hula',
  start(random, first) {
    return { round: newRound(random, sideOfSeat(first)), turns: [[], []] };
  },
  readMove: readHulaMove,
  play(state, seat, move) {
    const round = state.round;
    if (round.phase === 'over' || round.turn !== sideOfSeat(seat)) return false;
    // 뽑기로 새 차례가 시작되면 지난 차례에 한 일을 지운다.
    const starts = round.phase === 'draw';
    const step = apply(round, move);
    if (!step) return false;
    if (starts) state.turns[seat] = [];
    state.turns[seat].push(step);
    return true;
  },
  turnOf(state) {
    return state.round.phase === 'over' ? null : seatOfSide(state.round.turn);
  },
  outcome(state) {
    const result = state.round.result;
    if (state.round.phase !== 'over' || !result) return undefined;
    return { winner: result.winner === null ? null : seatOfSide(result.winner) };
  },
  view(state, seat) {
    const foe: Seat = seat === 0 ? 1 : 0;
    return { round: perspective(state.round, seat), theirs: state.turns[foe].map((step) => ({ ...step })) };
  },
  readView: readHulaView,
};
