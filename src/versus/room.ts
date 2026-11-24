/**
 * 친구와 함께하는 방의 규칙: 들어오기, 수 두기, 한 판 더, 나가기. 게임마다 다른 것은 TurnGame이 맡는다.
 * 서버(worker/rooms.ts)는 이것으로 방을 돌리고, 한 폰으로 번갈아 할 때(local-match.ts)는 앱이 그대로 돌린다.
 * 브라우저에도 서버에도 기대지 않는다. 상태는 JSON으로 저장할 수 있는 값만 쓴다.
 */
import { AWAY_AFTER_MS, FORFEIT_AFTER_MS, otherSeat, type RoomGame, type RoomStatus, type RoomView, type Seat } from './protocol';

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
  /**
   * 시간이 흘렀다(서버만 부른다). 정해진 시간 안에 두지 않으면 서버가 대신 정리하는 게임이 쓴다(원카드 외치기).
   * 판이 바뀌었으면(대신 둔 수가 있으면) true. 마감 시각을 적어 두는 것처럼 보이지 않는 것만 바꿨으면 false.
   */
  tick?(state: S, now: number): boolean;
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
  /** left가 자리를 오래 비워서 판을 버린 것으로 쳤으면 true. 예전에 저장된 방에는 없다. */
  dropped?: boolean;
  /** 자리마다 마지막으로 요청이 온 시각(ms). 서버만 적는다. 한 폰으로 할 때와 예전에 저장된 방에는 없다. */
  seen?: [number, number];
  /** 자리마다, 자리를 비웠다가 다시 돌아온 시각(ms). 돌아오자마자 상대를 내보내지 않으려고 쓴다. */
  back?: [number, number];
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

/**
 * 친구가 1번 자리에 앉는다. 기다리는 방이 아니면 false. 들어오면 바로 첫 판을 나눈다.
 * now(서버만 넘긴다)가 있으면 두 사람 모두 지금 본 것으로 친다. 방을 만든 사람이 코드를 보내러 메신저에 가 있을 수 있어서,
 * 친구가 들어온 때부터 다시 잰다.
 */
export function joinRoom<S>(
  room: RoomState<S>,
  rules: TurnGame<S, unknown, unknown>,
  name: string,
  random: () => number,
  now?: number,
): boolean {
  if (room.status !== 'waiting') return false;
  room.names[1] = name;
  if (now !== undefined) {
    room.seen = [now, now];
    room.back = [0, 0];
  }
  deal(room, rules, random, random() < 0.5 ? 0 : 1);
  room.version += 1;
  return true;
}

/** 판이 바뀐 뒤: 판이 끝났으면 이긴 판 수를 세고, 방의 번호를 올린다. */
function settle<S>(room: RoomState<S>, rules: TurnGame<S, unknown, unknown>): void {
  const outcome = room.round === null ? undefined : rules.outcome(room.round);
  if (outcome) {
    room.status = 'over';
    if (outcome.winner !== null) room.wins[outcome.winner] += 1;
  }
  room.version += 1;
}

/**
 * seat가 수를 둔다. 둘 수 없으면 false. 판이 끝나면 이긴 판 수를 센다.
 * now는 서버만 넘긴다. 넘기면 수를 둔 뒤 게임의 tick으로 마감 시각을 적는다.
 */
export function playMove<S, M>(room: RoomState<S>, rules: TurnGame<S, M, unknown>, seat: Seat, move: M, now?: number): boolean {
  if (room.status !== 'playing' || room.round === null) return false;
  if (!rules.play(room.round, seat, move)) return false;
  settle(room, rules);
  if (now !== undefined) tickRoom(room, rules, now);
  return true;
}

/**
 * 시간이 흘렀다(서버가 요청을 받을 때마다 부른다). 마감이 지나 게임이 대신 둔 수가 있으면 true이고, 방의 번호가 오른다.
 */
export function tickRoom<S>(room: RoomState<S>, rules: TurnGame<S, unknown, unknown>, now: number): boolean {
  if (room.status !== 'playing' || room.round === null || !rules.tick) return false;
  if (!rules.tick(room.round, now)) return false;
  settle(room, rules);
  return true;
}

// ------------------------------------------------------------ 자리를 비운 사람

const seenOf = <S>(room: RoomState<S>, seat: Seat, now: number): number => room.seen?.[seat] ?? now;

/**
 * seat에서 요청이 왔다. 자리를 비웠다가(AWAY_AFTER_MS 넘게 요청이 없다가) 돌아왔으면 돌아온 시각도 적는다.
 * 저장할 만큼 바뀌었으면 true(몇 초마다 오는 요청마다 저장하지 않으려고, 조금 바뀐 것은 넘긴다).
 */
export function markSeen<S>(room: RoomState<S>, seat: Seat, now: number): boolean {
  if (!room.seen) room.seen = [now, now];
  if (!room.back) room.back = [0, 0];
  const last = room.seen[seat];
  const returned = now - last >= AWAY_AFTER_MS;
  if (returned) room.back[seat] = now;
  if (!returned && now - last < SEEN_SAVE_MS) return false;
  room.seen[seat] = now;
  return true;
}

/** 이만큼 바뀌기 전에는 본 시각을 저장하지 않는다. 자리를 비웠는지 가리는 데는 몇 초 차이가 상관없다. */
const SEEN_SAVE_MS = 3000;

/**
 * seat가 볼 때, 상대가 자리를 비웠으면 상대가 판을 버린 것으로 치기까지 남은 시간(ms). 상대가 있으면 null.
 * 판을 하는 중이거나 끝나고 "한 판 더"를 기다릴 때만 센다.
 * 나도 자리를 비웠다가 막 돌아왔으면, 상대에게도 돌아올 틈을 준다(둘 다 비웠는데 먼저 온 쪽이 바로 이기지 않게).
 */
export function foeAwayLeft<S>(room: RoomState<S>, seat: Seat, now: number): number | null {
  if (room.status !== 'playing' && room.status !== 'over') return null;
  if (!room.seen) return null;
  const foe = otherSeat(seat);
  const seen = seenOf(room, foe, now);
  if (now - seen < AWAY_AFTER_MS) return null;
  const myBack = room.back?.[seat] ?? 0;
  const deadline = Math.max(seen + FORFEIT_AFTER_MS, myBack + FORFEIT_AFTER_MS - AWAY_AFTER_MS);
  return Math.max(0, deadline - now);
}

/** seat가 판을 버린 것으로 치고 방을 닫는다. 판을 하는 중이었으면 남은 사람이 이긴다. */
function forfeit<S>(room: RoomState<S>, seat: Seat, dropped: boolean): void {
  if (room.status === 'playing') room.wins[otherSeat(seat)] += 1;
  room.status = 'closed';
  room.left = seat;
  room.dropped = dropped;
  room.version += 1;
}

/** seat가 볼 때 상대가 너무 오래 자리를 비웠으면 상대가 판을 버린 것으로 치고 방을 닫는다. 닫았으면 true */
export function dropAwayFoe<S>(room: RoomState<S>, seat: Seat, now: number): boolean {
  if (foeAwayLeft(room, seat, now) !== 0) return false;
  forfeit(room, otherSeat(seat), true);
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
 * 다만 상대가 자리를 비운 사이에(now를 넘길 때, 서버만) 기다리다 지쳐 나가는 것이면, 나간 사람이 아니라
 * 자리를 비운 상대가 판을 버린 것으로 친다. 이미 닫힌 방이면 아무것도 바꾸지 않는다.
 */
export function leaveRoom<S>(room: RoomState<S>, seat: Seat, now?: number): void {
  if (room.status === 'closed') return;
  if (now !== undefined && foeAwayLeft(room, seat, now) !== null) forfeit(room, otherSeat(seat), true);
  else forfeit(room, seat, false);
}

/** seat가 볼 방의 모습. now는 서버만 넘긴다(상대가 자리를 비웠는지 알린다). */
export function roomView<S, V>(room: RoomState<S>, rules: TurnGame<S, unknown, V>, seat: Seat, code: string, now?: number): RoomView<V> {
  return {
    code,
    seat,
    status: room.status,
    version: room.version,
    names: [room.names[0], room.names[1]],
    wins: [room.wins[0], room.wins[1]],
    again: [room.again[0], room.again[1]],
    left: room.left,
    dropped: room.dropped === true,
    away: now === undefined ? null : foeAwayLeft(room, seat, now),
    game: room.round === null ? null : rules.view(room.round, seat),
  };
}
