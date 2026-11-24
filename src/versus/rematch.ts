/**
 * 다시 하자: 방에서 나온 뒤에도, 마지막으로 같이 한 친구를 같은 방 코드로 다시 부른다.
 *
 * 방은 누가 나가면 닫히지만 서버에는 30분 동안 남아 있다. 둘 중 누구든 "다시 하자"(againRoom)를 누르면 그 방이
 * 판이 끝난 방으로 돌아가고, 상대가 "한 판 더"를 누르면 새 판이 시작된다. 그래서 친구 고르기 화면에 있는 동안
 * 이것이 몇 초마다 그 방을 들여다보고, 친구가 먼저 다시 하자고 했으면 알린다.
 *
 * Phaser에 기대지 않아서 테스트에서 그대로 돌려 볼 수 있다.
 */
import type { Api, ApiResult } from '../online/api';
import { POLL_MS, type Timers } from './match';
import { otherSeat, type RoomView } from './protocol';
import type { Rematch } from './friend-store';

/**
 * ready: 방이 닫힌 채 그대로다(누르면 친구를 부른다).
 * invited: 친구가 먼저 다시 하자고 했다(누르면 바로 시작한다).
 * asked: 내가 이미 다시 하자고 해 두었다(누르면 그 방으로 들어가 기다린다).
 * gone: 방이 사라졌다(30분이 지났다).
 */
export type RematchState = 'ready' | 'invited' | 'asked' | 'gone';

/** 방의 모습에서 다시 하자의 상태를 읽는다. */
export function rematchState(room: RoomView<unknown>): RematchState {
  if (room.status === 'playing') return 'invited';
  if (room.status === 'over') return room.again[otherSeat(room.seat)] && !room.again[room.seat] ? 'invited' : 'asked';
  if (room.status === 'closed' && room.names[1] !== null && room.game !== null) return 'ready';
  return 'gone';
}

const browserTimers: Timers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class RematchWatch<V> {
  state: RematchState = 'ready';
  private timer: unknown = null;
  private stopped = false;

  constructor(
    private readonly api: Pick<Api, 'lookRoom' | 'againRoom'>,
    readonly saved: Rematch,
    private readonly readGame: (value: unknown) => V | null,
    private readonly onChange: (state: RematchState) => void,
    private readonly timers: Timers = browserTimers,
  ) {
    void this.poll();
  }

  /** 방을 한 번 들여다본다. */
  async poll(): Promise<void> {
    if (this.stopped) return;
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
    const result = await this.api.lookRoom(this.saved.code, this.saved.token, 0, this.readGame);
    if (this.stopped) return;
    let next = this.state;
    if (result.ok && result.data !== 'same') next = rematchState(result.data);
    else if (!result.ok && (result.reason === 'notfound' || result.reason === 'invalid')) next = 'gone';
    if (next !== this.state) {
      this.state = next;
      this.onChange(next);
    }
    if (next !== 'gone') this.timer = this.timers.set(() => void this.poll(), POLL_MS.over);
  }

  /** 다시 하자를 누른다. 친구가 먼저 불렀으면 바로 새 판이 시작된다. 답으로 온 방에 들어가면 된다. */
  async accept(): Promise<ApiResult<RoomView<V>>> {
    return this.api.againRoom(this.saved.code, this.saved.token, this.readGame);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
  }
}
