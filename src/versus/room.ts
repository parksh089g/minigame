/**
 * 친구와 함께하는 방의 규칙: 들어오기, 수 두기, 한 판 더, 나가기. 게임마다 다른 것은 TurnGame이 맡는다.
 * 서버(worker/rooms.ts)는 이것으로 방을 돌리고, 한 폰으로 번갈아 할 때(local-match.ts)는 앱이 그대로 돌린다.
 * 브라우저에도 서버에도 기대지 않는다. 상태는 JSON으로 저장할 수 있는 값만 쓴다.
 */
import { otherSeat, type RoomGame, type RoomStatus, type RoomView, type Seat } from './protocol';

/**
 * 두 사람이 차례대로 두는 게임 하나의 규칙. 상태(S)는 JSON으로 저장할 수 있는 값이어야 한다.
 * 자리(Seat)마다 볼 수 있는 것이 다르므로 화면에는 view가 그 자리에 맞게 가린 것(V)만 내보낸다.
 */
export interface TurnGame<S, M, V> {
  readonly id: RoomGame;
  /** 새 판을 나눈다. first가 먼저 둔다. */
  start(random: () => number, first: Seat): S;
  /** 밖에서 온 수를 확인하며 읽는다. 모양이 맞지 않으면 null */
  readMove(raw: unknown): M | null;
  /** seat가 move를 둔다. 차례가 아니거나 둘 수 없는 수면 상태를 바꾸지 않고 false */
  play(state: S, seat: Seat, move: M): boolean;
  /** 지금 둘 차례인 자리. 판이 끝났으면 null */
  turnOf(state: S): Seat | null;
  /** 판이 끝났으면 이긴 자리(비겼으면 null)를 담아 돌려주고, 아직이면 undefined */
  outcome(state: S): { winner: Seat | null } | undefined;
  /** seat가 볼 수 있는 판. 상대의 패와 덱처럼 그 자리가 몰라야 하는 것은 가린다. */
  view(state: S, seat: Seat): V;
  /** 서버가 보낸 판(view의 결과)을 확인하며 읽는다. */
  readView(raw: unknown): V | null;
}

/** 게임마다 상태와 수의 모양이 달라서, 여러 게임을 한 목록에 둘 때 쓰는 모양 */
export type AnyTurnGame = TurnGame<any, any, any>;

/** 방 하나의 상태. 서버에는 이것이 JSON으로 저장된다. */
export interface RoomState<S = unknown> {
  game: RoomGame;
  status: RoomStatus;
  names: [string, string | null];
  wins: [number, number];
  again: [boolean, boolean];
  left: Seat | null;
  /** 지난 판에 먼저 둔 자리. 다음 판은 번갈아 상대가 먼저 둔다. */
  first: Seat;
  round: S | null;
  version: number;
}

/** 방을 만든다. 만든 사람은 0번 자리에 앉아 친구를 기다린다. */
export function createRoom<S>(game: RoomGame, name: string): RoomState<S> {
  return {
    game,
    status: 'waiting',
    names: [name, null],
    wins: [0, 0],
    again: [false, false],
    left: null,
    first: 1,
    round: null,
    version: 1,
  };
}

/** 첫 판은 무작위로, 그다음부터는 번갈아 먼저 둔다. */
function deal<S>(room: RoomState<S>, rules: TurnGame<S, unknown, unknown>, random: () => number, first: Seat): void {
  room.first = first;
  room.round = rules.start(random, first);
  room.status = 'playing';
  room.again = [false, false];
}

/** 친구가 1번 자리에 앉는다. 기다리는 방이 아니면 false. 들어오면 바로 첫 판을 나눈다. */
export function joinRoom<S>(room: RoomState<S>, rules: TurnGame<S, unknown, unknown>, name: string, random: () => number): boolean {
  if (room.status !== 'waiting') return false;
  room.names[1] = name;
  deal(room, rules, random, random() < 0.5 ? 0 : 1);
  room.version += 1;
  return true;
}

/** seat가 수를 둔다. 둘 수 없으면 false. 판이 끝나면 이긴 판 수를 센다. */
export function playMove<S, M>(room: RoomState<S>, rules: TurnGame<S, M, unknown>, seat: Seat, move: M): boolean {
  if (room.status !== 'playing' || room.round === null) return false;
  if (!rules.play(room.round, seat, move)) return false;
  const outcome = rules.outcome(room.round);
  if (outcome) {
    room.status = 'over';
    if (outcome.winner !== null) room.wins[outcome.winner] += 1;
  }
  room.version += 1;
  return true;
}

/** 판이 끝난 뒤 seat가 "한 판 더"를 누른다. 둘 다 눌렀으면 새 판을 나눈다. 받아들이지 않았으면 false. */
export function askAgain<S>(room: RoomState<S>, rules: TurnGame<S, unknown, unknown>, seat: Seat, random: () => number): boolean {
  if (room.status !== 'over') return false;
  if (room.again[seat]) return true;
  room.again[seat] = true;
  if (room.again[0] && room.again[1]) deal(room, rules, random, otherSeat(room.first));
  room.version += 1;
  return true;
}

/**
 * seat가 방을 나간다. 판을 하는 중이었으면 남은 사람이 이긴 것으로 센다.
 * 이미 닫힌 방이면 아무것도 바꾸지 않는다.
 */
export function leaveRoom<S>(room: RoomState<S>, seat: Seat): void {
  if (room.status === 'closed') return;
  if (room.status === 'playing') room.wins[otherSeat(seat)] += 1;
  room.status = 'closed';
  room.left = seat;
  room.version += 1;
}

/** seat가 볼 방의 모습 */
export function roomView<S, V>(room: RoomState<S>, rules: TurnGame<S, unknown, V>, seat: Seat, code: string): RoomView<V> {
  return {
    code,
    seat,
    status: room.status,
    version: room.version,
    names: [room.names[0], room.names[1]],
    wins: [room.wins[0], room.wins[1]],
    again: [room.again[0], room.again[1]],
    left: room.left,
    game: room.round === null ? null : rules.view(room.round, seat),
  };
}
