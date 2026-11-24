import { describe, expect, it } from 'vitest';
import { hulaVersus, readHulaView, type HulaMatch, type HulaMove, type HulaView } from '../games/hula/versus';
import type { ApiResult } from '../online/api';
import { addFriendRound, friendsOf, readFriendSave, readRematch, roundKey } from './friend-store';
import { OnlineMatch, POLL_MS, type Timers } from './match';
import { cleanFriendId, friendIdFrom, readRoomView, type RoomView } from './protocol';
import { RematchWatch, rematchState } from './rematch';
import { askAgain, canReopen, createRoom, foeAwayLeft, joinRoom, leaveRoom, roomView, type RoomState } from './room';
import { withAnd } from './text';

const half = (): number => 0.25;
const ID_A = '0123456789abcdef';
const ID_B = 'fedcba9876543210';

function playedRoom(): RoomState<HulaMatch> {
  const room = createRoom<HulaMatch>('hula', '민수', ID_A);
  joinRoom(room, hulaVersus, '지원', half, 1_000, ID_B);
  return room;
}

function manualTimers() {
  let pending: { callback: () => void; ms: number } | null = null;
  const timers: Timers = {
    set: (callback, ms) => (pending = { callback, ms }),
    clear: () => (pending = null),
  };
  return {
    timers,
    get next() {
      return pending?.ms ?? null;
    },
    async fire() {
      const job = pending;
      pending = null;
      job?.callback();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

describe('친구 표', () => {
  it('16자리 16진수만 받고, 방의 모습에 자리마다 실린다', () => {
    expect(friendIdFrom(new Uint8Array(8).fill(171))).toBe('ab'.repeat(8));
    expect(cleanFriendId(ID_A)).toBe(ID_A);
    expect(cleanFriendId('ABCDEF0123456789')).toBeNull();
    expect(cleanFriendId(42)).toBeNull();
    const room = playedRoom();
    const view = roomView(room, hulaVersus, 0, 'ABCDEF');
    expect(view.ids).toEqual([ID_A, ID_B]);
    expect(readRoomView(JSON.parse(JSON.stringify(view)), readHulaView)?.ids).toEqual([ID_A, ID_B]);
    // 예전 서버는 ids를 보내지 않는다.
    const { ids: _ids, ...old } = JSON.parse(JSON.stringify(view)) as RoomView<unknown>;
    expect(readRoomView(old, readHulaView)?.ids).toEqual([null, null]);
  });
});

describe('닫힌 방 다시 열기', () => {
  it('둘이 한 판이라도 한 방은 누가 나가도 "다시 하자"로 되살아나고, 상대가 한 판 더를 누르면 새 판이 시작된다', () => {
    const room = playedRoom();
    room.status = 'over';
    room.wins = [1, 0];
    leaveRoom(room, 1);
    expect(room.status).toBe('closed');
    expect(canReopen(room)).toBe(true);
    // 나갔던 사람이 먼저 다시 하자고 한다. 오래 지났어도 상대를 곧바로 자리를 비운 것으로 보지 않는다.
    const now = 1_000 + 10 * 60 * 1000;
    expect(askAgain(room, hulaVersus, 1, half, now)).toBe(true);
    expect(room.status).toBe('over');
    expect(room.left).toBeNull();
    expect(room.again).toEqual([false, true]);
    expect(foeAwayLeft(room, 1, now)).toBeNull();
    expect(room.wins).toEqual([1, 0]);
    // 앱은 끝나지 않았을 수도 있는 지난 판 대신 "다시 하자" 화면을 보여 준다.
    expect(roomView(room, hulaVersus, 0, 'X').rematch).toBe(true);
    expect(askAgain(room, hulaVersus, 0, half, now)).toBe(true);
    expect(room.status).toBe('playing');
    expect(roomView(room, hulaVersus, 0, 'X').rematch).toBe(false);
  });

  it('친구가 들어오기 전에 닫은 방은 다시 열 수 없다', () => {
    const room = createRoom<HulaMatch>('hula', '민수');
    leaveRoom(room, 0);
    expect(canReopen(room)).toBe(false);
    expect(askAgain(room, hulaVersus, 0, half)).toBe(false);
    expect(room.status).toBe('closed');
  });
});

describe('친구 전적', () => {
  const now = 1_800_000_000_000;
  it('친구 표로 친구를 가리고, 이름이 바뀌어도 같은 친구로 센다', () => {
    let saved = readFriendSave(null);
    saved = addFriendRound(saved, 'poker', { id: ID_B, name: '지원' }, true, now);
    saved = addFriendRound(saved, 'poker', { id: ID_B, name: '지원이' }, false, now + 1);
    saved = addFriendRound(saved, 'poker', { id: null, name: '민수' }, true, now + 2);
    saved = addFriendRound(saved, 'hula', { id: ID_B, name: '지원이' }, null, now + 3);
    const poker = friendsOf(saved, 'poker');
    expect(poker.map((friend) => [friend.name, friend.games.poker])).toEqual([
      ['지원이', { wins: 1, losses: 1 }],
      ['민수', { wins: 1, losses: 0 }],
    ]);
    // 비긴 판은 수에 넣지 않지만 같이 한 친구로는 보인다.
    expect(friendsOf(saved, 'hula')[0].games.hula).toEqual({ wins: 0, losses: 0 });
    // 적어 둔 것을 다시 읽어도 같다. 이상한 값은 버린다.
    const again = readFriendSave(JSON.parse(JSON.stringify({ ...saved, friends: { ...saved.friends, bad: { name: 3 } } })));
    expect(again.friends).toEqual(saved.friends);
  });

  it('같은 판은 방 코드와 승부가 난 판 수로 가려서 두 번 세지 않는다', () => {
    expect(roundKey({ code: 'ABCDEF', wins: [2, 1] })).toBe('ABCDEF#3');
    expect(roundKey({ code: 'ABCDEF', wins: [2, 1] }, 1)).toBe('ABCDEF#4');
  });

  it('다시 하자 방은 30분이 안 된 것만 읽는다', () => {
    const token = 'ab'.repeat(16);
    const raw = { game: 'poker', code: 'ABCDEF', token, foe: '지원', at: now - 1000 };
    expect(readRematch(raw, now)).toEqual(raw);
    expect(readRematch({ ...raw, at: now - 31 * 60 * 1000 }, now)).toBeNull();
    expect(readRematch({ ...raw, foe: '' }, now)).toBeNull();
  });

  it('받침에 따라 와/과를 고른다', () => {
    expect(withAnd('민수')).toBe('민수와');
    expect(withAnd('지원')).toBe('지원과');
  });
});

/** 방 하나를 들고 두 자리 모두에 답하는 가짜 서버 */
function fakeRoomServer(room: RoomState<HulaMatch>) {
  const view = (seat: 0 | 1): RoomView<HulaView> => JSON.parse(JSON.stringify(roomView(room, hulaVersus, seat, 'ABCDEF')));
  const seatOf = (token: string): 0 | 1 => (token === 'a'.repeat(32) ? 0 : 1);
  const api = {
    lookRoom: async (_code: string, token: string, version: number): Promise<ApiResult<RoomView<HulaView> | 'same'>> => {
      const seat = seatOf(token);
      // 실제 서버처럼, 번호가 같고 상대가 자리에 있으면 'same'만 보낸다.
      return { ok: true, data: version === room.version ? 'same' : view(seat) };
    },
    againRoom: async (_code: string, token: string): Promise<ApiResult<RoomView<HulaView>>> => {
      askAgain(room, hulaVersus, seatOf(token), half, 0);
      return { ok: true, data: view(seatOf(token)) };
    },
    moveRoom: async () => ({ ok: false, reason: 'offline' }) as const,
    leaveRoom: async () => ({ ok: true, data: true }) as const,
  };
  return { api: api as unknown as ConstructorParameters<typeof OnlineMatch<HulaView, HulaMove>>[0], view };
}

describe('다시 하자 기다리기', () => {
  it('닫힌 방에 남아 있으면 천천히 계속 묻다가, 친구가 다시 하자고 하면 알린다', async () => {
    const room = playedRoom();
    room.status = 'over';
    leaveRoom(room, 1);
    const server = fakeRoomServer(room);
    const clock = manualTimers();
    const match = new OnlineMatch(server.api, 'a'.repeat(32), server.view(0), readHulaView, () => false, clock.timers);
    expect(match.reopenable).toBe(true);
    expect(clock.next).toBe(POLL_MS.over);
    let changes = 0;
    match.onChange(() => (changes += 1));
    await clock.fire();
    expect(changes).toBe(0);
    askAgain(room, hulaVersus, 1, half, 0);
    await clock.fire();
    expect(changes).toBe(1);
    expect(match.room.status).toBe('over');
    expect(match.room.again).toEqual([false, true]);
    await match.again();
    expect(match.room.status).toBe('playing');
    match.stop();
  });

  it('친구 고르기 화면에서 마지막 방을 들여다보고 친구가 먼저 부르면 알린다', async () => {
    const room = playedRoom();
    room.status = 'over';
    leaveRoom(room, 0);
    const server = fakeRoomServer(room);
    const clock = manualTimers();
    const seen: string[] = [];
    const saved = { game: 'hula' as const, code: 'ABCDEF', token: 'a'.repeat(32), foe: '지원', at: 0 };
    const watch = new RematchWatch<HulaView>(server.api, saved, readHulaView, (state) => seen.push(state), clock.timers);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(watch.state).toBe('ready');
    askAgain(room, hulaVersus, 1, half, 0);
    await clock.fire();
    expect(seen).toEqual(['invited']);
    const result = await watch.accept();
    expect(result.ok && result.data.status).toBe('playing');
    watch.stop();
  });

  it('방의 모습에서 다시 하자의 상태를 읽는다', () => {
    const room = playedRoom();
    room.status = 'over';
    leaveRoom(room, 1);
    expect(rematchState(roomView(room, hulaVersus, 0, 'X'))).toBe('ready');
    askAgain(room, hulaVersus, 0, half);
    expect(rematchState(roomView(room, hulaVersus, 0, 'X'))).toBe('asked');
    expect(rematchState(roomView(room, hulaVersus, 1, 'X'))).toBe('invited');
  });
});

describe('자리를 비웠던 친구가 돌아오면', () => {
  it('서버가 "그대로"만 보내도 띠를 내린다', async () => {
    const room = playedRoom();
    room.round!.round.turn = 'me';
    const clock = manualTimers();
    let first = true;
    const api = {
      lookRoom: async () => {
        // 처음에는 친구가 자리를 비웠다며 남은 시간을 싣고, 그다음에는 번호가 같아 'same'만 온다.
        if (first) {
          first = false;
          return { ok: true, data: { ...JSON.parse(JSON.stringify(roomView(room, hulaVersus, 0, 'ABCDEF'))), away: 30_000 } };
        }
        return { ok: true, data: 'same' };
      },
    };
    const match = new OnlineMatch(api as never, 'a'.repeat(32), JSON.parse(JSON.stringify(roomView(room, hulaVersus, 0, 'ABCDEF'))), readHulaView, () => true, clock.timers);
    match.room.version -= 1; // 처음 물을 때 새 방으로 받게 한다.
    await clock.fire();
    expect(match.awayUntil).not.toBeNull();
    let changes = 0;
    match.onChange(() => (changes += 1));
    await clock.fire();
    expect(match.awayUntil).toBeNull();
    expect(match.room.away).toBeNull();
    expect(changes).toBe(1);
    match.stop();
  });
});
