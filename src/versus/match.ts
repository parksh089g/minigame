/**
 * 친구와의 판을 이어 주는 쪽. 화면(게임 씬)은 어느 쪽이든 같은 모양(Match)으로 다룬다.
 *
 * - LocalMatch: 한 폰으로 번갈아 한다. 방의 규칙(room.ts)을 앱 안에서 그대로 돌리고, 인터넷이 없어도 된다.
 *   화면에는 지금 둘 차례인 사람의 자리에서 본 판을 보여 준다. 차례가 바뀌면 화면이 패를 가리고 폰을 넘기게 한다.
 * - OnlineMatch: 방 코드로 들어온 친구와 각자의 폰으로 한다. 판은 서버가 들고 있고, 기다리는 동안 몇 초마다 소식을 묻는다.
 *
 * Phaser에 기대지 않아서 테스트에서 그대로 돌려 볼 수 있다.
 */
import type { Api, ApiFailure } from '../online/api';
import { otherSeat, type RoomView, type Seat } from './protocol';
import { askAgain, createRoom, joinRoom, leaveRoom, playMove, roomView, type RoomState, type TurnGame } from './room';

export interface Match<V, M> {
  readonly kind: 'local' | 'online';
  /** 지금 화면에 보여 줄 방. 한 폰으로 할 때는 둘 차례인 사람의 자리에서 본 것이다. */
  readonly room: RoomView<V>;
  /** 서버에 닿지 못하고 있으면 그 이유. 한 폰으로 할 때는 늘 null */
  readonly trouble: ApiFailure | null;
  /** 상대가 자리를 비웠으면, 상대가 판을 버린 것으로 칠 때(이 폰의 시계, ms). 상대가 있으면 null */
  readonly awayUntil: number | null;
  /** 지금 보는 자리가 둘 차례인지 */
  myTurn(): boolean;
  /** 수를 둔다. 받아들였으면 true */
  send(move: M): Promise<boolean>;
  /** 판이 끝난 뒤 "한 판 더". 온라인에서 누가 나가 닫힌 방이면 같은 방을 다시 열어 상대를 부른다. */
  again(): Promise<void>;
  /** 방을 나간다. 그 뒤로는 아무 소식도 오지 않는다. */
  leave(): void;
  /** 방이 바뀌거나 서버에 닿지 못하게 되면 부른다. */
  onChange(listener: () => void): void;
  /** 소식 묻기를 멈춘다(씬을 떠날 때). 방은 나가지 않는다. */
  stop(): void;
}

/** 한 폰으로 번갈아 하기 */
export class LocalMatch<S, M, V> implements Match<V, M> {
  readonly kind = 'local';
  readonly trouble = null;
  readonly awayUntil = null;
  private readonly state: RoomState<S>;
  private seat: Seat = 0;
  private listeners: Array<() => void> = [];

  constructor(
    private readonly rules: TurnGame<S, M, V>,
    names: readonly [string, string],
    private readonly random: () => number = Math.random,
  ) {
    this.state = createRoom<S>(rules.id, names[0]);
    joinRoom(this.state, rules, names[1], random);
    this.follow();
  }

  /** 판을 하는 동안에는 둘 차례인 사람의 자리에서 본다. 판이 끝나면 마지막에 둔 사람의 자리에 머문다. */
  private follow(): void {
    const turn = this.state.round === null ? null : this.rules.turnOf(this.state.round);
    if (turn !== null) this.seat = turn;
  }

  get room(): RoomView<V> {
    return roomView(this.state, this.rules, this.seat, '');
  }

  myTurn(): boolean {
    return this.state.status === 'playing' && this.state.round !== null && this.rules.turnOf(this.state.round) === this.seat;
  }

  async send(move: M): Promise<boolean> {
    const ok = playMove(this.state, this.rules, this.seat, move);
    if (ok) {
      this.follow();
      this.notify();
    }
    return ok;
  }

  /** 한 폰이라 한 사람이 누르면 둘 다 누른 것으로 친다. */
  async again(): Promise<void> {
    askAgain(this.state, this.rules, this.seat, this.random);
    askAgain(this.state, this.rules, otherSeat(this.seat), this.random);
    this.follow();
    this.notify();
  }

  leave(): void {
    leaveRoom(this.state, this.seat);
    this.listeners = [];
  }

  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  stop(): void {
    this.listeners = [];
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

/** 소식을 묻는 간격(ms) */
export const POLL_MS = {
  /** 친구가 들어오기를, 또는 친구가 두기를 기다릴 때 */
  waiting: 2000,
  /** 내 차례일 때. 친구가 나갔는지, 자리를 비웠는지 본다. 내가 묻는 것으로 서버가 내가 아직 있는 줄 안다. */
  mine: 4000,
  /** 판이 끝나고 "한 판 더"를 기다릴 때. 닫힌 방에서 상대가 "다시 하자"를 누르는지 볼 때도 */
  over: 2500,
  /** 서버에 닿지 못했을 때 다시 묻기까지 */
  retry: 4000,
} as const;

export interface Timers {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
  /** 지금 시각(ms). 없으면 Date.now() */
  now?(): number;
}

const browserTimers: Timers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** 방 코드로 들어온 친구와 각자의 폰으로 하기 */
export class OnlineMatch<V, M> implements Match<V, M> {
  readonly kind = 'online';
  trouble: ApiFailure | null = null;
  awayUntil: number | null = null;
  private current: RoomView<V>;
  private listeners: Array<() => void> = [];
  private timer: unknown = null;
  private stopped = false;
  /** 보낸 수의 답을 기다리는 중이면 true. 그동안 온 소식은 묵은 것일 수 있어서 받지 않는다. */
  private sending = false;
  /** 서버에서 방이 사라졌다(시간이 지났다). 그 뒤로는 묻지 않는다. */
  private gone = false;

  constructor(
    private readonly api: Pick<Api, 'lookRoom' | 'moveRoom' | 'againRoom' | 'leaveRoom'>,
    readonly token: string,
    room: RoomView<V>,
    private readonly readGame: (value: unknown) => V | null,
    /** 이 방에서 보는 자리가 둘 차례인지 판에서 읽는다. */
    private readonly isMyTurn: (room: RoomView<V>) => boolean,
    private readonly timers: Timers = browserTimers,
  ) {
    this.current = room;
    this.awayUntil = this.awayFrom(room);
    this.schedule();
  }

  /** 서버가 알려 준 남은 시간을 이 폰의 시계로 바꾼다. */
  private awayFrom(room: RoomView<V>): number | null {
    return room.away === null || room.status === 'closed' ? null : (this.timers.now?.() ?? Date.now()) + room.away;
  }

  get room(): RoomView<V> {
    return this.current;
  }

  get code(): string {
    return this.current.code;
  }

  /**
   * 닫힌 방을 "다시 하자"로 되살릴 수 있는지. 둘이 한 판이라도 했고 방이 아직 서버에 있으면 된다.
   * 그동안은 상대가 먼저 다시 하자고 하는지 천천히 계속 묻는다.
   */
  get reopenable(): boolean {
    return this.current.status === 'closed' && !this.gone && this.current.names[1] !== null && this.current.game !== null;
  }

  myTurn(): boolean {
    return this.current.status === 'playing' && this.isMyTurn(this.current);
  }

  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  /** 새로 받은 방을 쓴다. 번호가 거꾸로 가는 묵은 답은 버린다. */
  private take(room: RoomView<V>): void {
    if (room.version < this.current.version) return;
    const awayUntil = this.awayFrom(room);
    const changed = room.version !== this.current.version || this.trouble !== null || (awayUntil === null) !== (this.awayUntil === null);
    this.current = room;
    this.awayUntil = awayUntil;
    this.trouble = null;
    if (changed) this.notify();
  }

  /** 서버에 닿지 못했다. 방이 사라졌으면(notfound) 닫힌 방으로 보고 더 묻지 않는다. */
  private fail(reason: ApiFailure): void {
    if (reason === 'notfound' || reason === 'invalid') {
      this.gone = true;
      this.current = { ...this.current, status: 'closed', version: this.current.version + 1 };
      this.awayUntil = null;
      this.trouble = null;
      this.notify();
      return;
    }
    const changed = this.trouble !== reason;
    this.trouble = reason;
    if (changed) this.notify();
  }

  private schedule(): void {
    if (this.stopped) return;
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
    if (this.current.status === 'closed' && !this.reopenable) return;
    const ms =
      this.trouble !== null
        ? POLL_MS.retry
        : this.awayUntil !== null
          ? POLL_MS.waiting
          : this.current.status === 'over' || this.current.status === 'closed'
          ? POLL_MS.over
          : this.myTurn()
            ? POLL_MS.mine
            : POLL_MS.waiting;
    this.timer = this.timers.set(() => void this.poll(), ms);
  }

  /** 소식을 한 번 묻는다. 화면이 다시 보일 때처럼 바로 묻고 싶을 때도 부른다. */
  async poll(): Promise<void> {
    if (this.stopped || (this.current.status === 'closed' && !this.reopenable)) return;
    if (this.sending) return this.schedule();
    const asked = this.current.version;
    const result = await this.api.lookRoom(this.current.code, this.token, asked, this.readGame);
    if (this.stopped) return;
    // 묻는 사이에 내가 수를 둬서 방이 바뀌었으면 이 답은 묵은 것이다.
    if (!this.sending && this.current.version === asked) {
      if (!result.ok) this.fail(result.reason);
      // 'same'은 서버가 상대가 자리에 있다고 볼 때만 온다(자리를 비웠으면 남은 시간을 실어 보낸다).
      // 그러니 자리를 비웠던 상대가 돌아온 것이다: 띠를 내린다.
      else if (result.data === 'same') this.take({ ...this.current, away: null });
      else this.take(result.data);
    }
    this.schedule();
  }

  async send(move: M): Promise<boolean> {
    if (this.sending || this.stopped || !this.myTurn()) return false;
    this.sending = true;
    try {
      const result = await this.api.moveRoom(this.current.code, this.token, this.current.version, move, this.readGame);
      if (this.stopped) return false;
      if (!result.ok) {
        this.fail(result.reason);
        return false;
      }
      this.take(result.data.room);
      if (!result.data.ok) this.notify();
      return result.data.ok;
    } finally {
      this.sending = false;
      this.schedule();
    }
  }

  async again(): Promise<void> {
    if (this.stopped || (this.current.status !== 'over' && !this.reopenable)) return;
    const result = await this.api.againRoom(this.current.code, this.token, this.readGame);
    if (this.stopped) return;
    if (result.ok) this.take(result.data);
    else this.fail(result.reason);
    this.schedule();
  }

  leave(): void {
    if (!this.stopped && this.current.status !== 'closed') void this.api.leaveRoom(this.current.code, this.token);
    this.stop();
  }

  stop(): void {
    this.stopped = true;
    this.listeners = [];
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
  }
}

/** 상대의 자리 */
export const foeSeat = (room: RoomView<unknown>): Seat => otherSeat(room.seat);
