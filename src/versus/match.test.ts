import { describe, expect, it } from 'vitest';
import { hulaVersus, readHulaView, type HulaMatch, type HulaMove, type HulaView } from '../games/hula/versus';
import type { ApiResult } from '../online/api';
import { LocalMatch, OnlineMatch, POLL_MS, type Timers } from './match';
import type { MoveResult, RoomView } from './protocol';
import { createRoom, joinRoom, leaveRoom, playMove, roomView, type RoomState } from './room';

const half = (): number => 0.25;

describe('한 폰으로 번갈아 하기', () => {
  it('늘 둘 차례인 사람의 자리에서 보여 주고, 차례가 넘어가면 자리가 바뀐다', async () => {
    const match = new LocalMatch(hulaVersus, ['1P', '2P'], half);
    const first = match.room.seat;
    expect(match.myTurn()).toBe(true);
    expect(match.room.game?.round.turn).toBe('me');
    let changes = 0;
    match.onChange(() => (changes += 1));
    expect(await match.send({ type: 'draw' })).toBe(true);
    const card = match.room.game!.round.hands.me[0];
    expect(await match.send({ type: 'discard', card })).toBe(true);
    expect(match.room.seat).not.toBe(first);
    expect(match.room.game?.theirs).toEqual([{ type: 'draw' }, { type: 'discard', card }]);
    expect(changes).toBe(2);
    expect(await match.send({ type: 'discard', card: 0 })).toBe(false);
  });
});

/** 서버 대신 방 하나를 들고 답하는 가짜 api. 다른 자리가 둔 것처럼 방을 바꿀 수 있다. */
function fakeServer() {
  const room: RoomState<HulaMatch> = createRoom('hula', '민수');
  joinRoom(room, hulaVersus, '지원', half);
  let offline = false;
  const view = (): RoomView<HulaView> => JSON.parse(JSON.stringify(roomView(room, hulaVersus, 0, 'ABCDEF')));
  const answer = <T>(data: T): ApiResult<T> => (offline ? { ok: false, reason: 'offline' } : { ok: true, data });
  const api = {
    lookRoom: async (_code: string, _token: string, version: number) =>
      answer<RoomView<HulaView> | 'same'>(version === room.version ? 'same' : view()),
    moveRoom: async (_code: string, _token: string, version: number, move: unknown) => {
      const ok = version === room.version && playMove(room, hulaVersus, 0, move as HulaMove);
      return answer<MoveResult<HulaView>>({ ok, room: view() });
    },
    againRoom: async () => answer(view()),
    leaveRoom: async () => {
      leaveRoom(room, 0);
      return answer<true>(true);
    },
  };
  return {
    room,
    api: api as unknown as ConstructorParameters<typeof OnlineMatch<HulaView, HulaMove>>[0],
    view,
    setOffline(value: boolean) {
      offline = value;
    },
  };
}

/** 손으로 돌리는 시계 */
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

describe('온라인으로 하기', () => {
  it('친구가 두는 동안에는 자주 묻고, 내 차례에는 가끔만 묻는다', async () => {
    const server = fakeServer();
    const clock = manualTimers();
    const match = new OnlineMatch(server.api, 'a'.repeat(32), server.view(), readHulaView, (room) => room.game?.round.turn === 'me', clock.timers);
    const mine = hulaVersus.turnOf(server.room.round!) === 0;
    expect(clock.next).toBe(mine ? POLL_MS.mine : POLL_MS.waiting);
    match.stop();
  });

  it('친구가 두면 바뀐 방을 받아 알리고, 그대로면 알리지 않는다', async () => {
    const server = fakeServer();
    // 1번 자리(친구)가 먼저 두게 맞춘다.
    server.room.round!.round.turn = 'cpu';
    const clock = manualTimers();
    const match = new OnlineMatch(server.api, 'a'.repeat(32), server.view(), readHulaView, (room) => room.game?.round.turn === 'me', clock.timers);
    let changes = 0;
    match.onChange(() => (changes += 1));
    await clock.fire();
    expect(changes).toBe(0);
    playMove(server.room, hulaVersus, 1, { type: 'draw' });
    await clock.fire();
    expect(changes).toBe(1);
    expect(match.room.game?.theirs).toEqual([{ type: 'draw' }]);
    match.stop();
  });

  it('서버에 닿지 못하면 알리고 다시 묻고, 닿으면 다시 알린다', async () => {
    const server = fakeServer();
    server.room.round!.round.turn = 'cpu';
    const clock = manualTimers();
    const match = new OnlineMatch(server.api, 'a'.repeat(32), server.view(), readHulaView, () => false, clock.timers);
    server.setOffline(true);
    await clock.fire();
    expect(match.trouble).toBe('offline');
    expect(clock.next).toBe(POLL_MS.retry);
    server.setOffline(false);
    await clock.fire();
    expect(match.trouble).toBeNull();
    match.stop();
  });

  it('내 차례에 둔 수는 서버의 답으로 방을 바꾸고, 차례가 아니면 보내지도 않는다', async () => {
    const server = fakeServer();
    server.room.round!.round.turn = 'me';
    server.room.round!.round.phase = 'draw';
    const clock = manualTimers();
    const match = new OnlineMatch(server.api, 'a'.repeat(32), server.view(), readHulaView, (room) => room.game?.round.turn === 'me', clock.timers);
    expect(await match.send({ type: 'draw' })).toBe(true);
    expect(match.room.game?.round.phase).toBe('play');
    const card = match.room.game!.round.hands.me[0];
    expect(await match.send({ type: 'discard', card })).toBe(true);
    expect(match.myTurn()).toBe(false);
    expect(await match.send({ type: 'draw' })).toBe(false);
    match.stop();
  });

  it('방이 사라지면 닫힌 방으로 보고 더 묻지 않는다', async () => {
    const server = fakeServer();
    const clock = manualTimers();
    const api = { ...server.api, lookRoom: async () => ({ ok: false, reason: 'notfound' }) as const };
    const match = new OnlineMatch(api as typeof server.api, 'a'.repeat(32), server.view(), readHulaView, () => false, clock.timers);
    await clock.fire();
    expect(match.room.status).toBe('closed');
    expect(clock.next).toBeNull();
  });

  it('친구가 자리를 비우면 남은 시간을 이 폰의 시계로 알리고 자주 묻고, 친구가 돌아오면 다시 알린다', async () => {
    const server = fakeServer();
    server.room.round!.round.turn = 'me';
    const clock = manualTimers();
    let now = 5_000;
    const timers = { ...clock.timers, now: () => now };
    let away: number | null = null;
    const api = {
      ...server.api,
      lookRoom: async () => ({ ok: true, data: { ...server.view(), away } }) as const,
    };
    const match = new OnlineMatch(api as typeof server.api, 'a'.repeat(32), server.view(), readHulaView, (room) => room.game?.round.turn === 'me', timers);
    let changes = 0;
    match.onChange(() => (changes += 1));
    expect(match.awayUntil).toBeNull();
    expect(clock.next).toBe(POLL_MS.mine);
    away = 30_000;
    await clock.fire();
    expect(changes).toBe(1);
    expect(match.awayUntil).toBe(35_000);
    expect(clock.next).toBe(POLL_MS.waiting);
    // 남은 시간만 줄어든 것은 다시 알리지 않는다(띠가 스스로 센다).
    now = 7_000;
    away = 28_000;
    await clock.fire();
    expect(changes).toBe(1);
    away = null;
    await clock.fire();
    expect(changes).toBe(2);
    expect(match.awayUntil).toBeNull();
    match.stop();
  });

  it('한 폰으로 할 때는 자리를 비우는 일이 없다', () => {
    expect(new LocalMatch(hulaVersus, ['1P', '2P'], half).awayUntil).toBeNull();
  });
});
