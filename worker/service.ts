/**
 * 랭킹과 옮기기 코드의 규칙: 요청 한도를 확인한 뒤 저장소에 넣고 꺼낸다.
 * Cloudflare에 기대지 않아서 테스트에서 그대로 돌려 볼 수 있다. 실제 서버에서는 board.ts의 Durable Object가 이것을 들고 있다.
 */
import {
  rankDayOf,
  rankWeekOf,
  type RankBoard,
  type RankedGame,
  type RankSpan,
  type Standings,
  type StashResult,
  type SubmitResult,
} from '../src/online/protocol';
import { BoardDb, type Scores, type SqlRunner } from './board-db';
import { Limiter, LIMITS, type LimitKind } from './limiter';
import type { MoveResult, RoomGame, RoomTicket, RoomView } from '../src/versus/protocol';
import { RoomDb } from './rooms';

/** 요청이 너무 잦아서 받지 않았다는 답 */
export const TOO_FAST = 'slow';
export type Limited<T> = T | typeof TOO_FAST;

export type { Scores };

/** 앱이 이번 주 랭킹에 올리겠다고 보낸 것. 어느 주의 점수인지는 앱이 적어 보내고, 서버가 자기 시각의 주와 견준다. */
export interface WeekEntry {
  week: string;
  scores: Scores;
}

/** 앱이 오늘의 랭킹에 올리겠다고 보낸 것. 어느 날의 점수인지는 앱이 적어 보내고, 서버가 자기 시각의 날과 견준다. */
export interface DayEntry {
  day: number;
  scores: Scores;
}

/**
 * api.ts가 부르는 모양. 실제 서버에서는 Durable Object를 거쳐서 답이 Promise로 온다.
 * ip는 요청을 세는 데만 쓰고 저장하지 않는다.
 */
export interface BoardApi {
  board(
    ip: string,
    game: RankedGame,
    device: string | null,
    span: RankSpan,
  ): Limited<RankBoard> | Promise<Limited<RankBoard>>;
  /** 한 게임의 오늘의 랭킹. 오늘이 어느 날인지는 서버가 정해서 답에 적는다. */
  daily(ip: string, game: RankedGame, device: string | null): Limited<RankBoard> | Promise<Limited<RankBoard>>;
  standings(ip: string, device: string, span: RankSpan): Limited<Standings> | Promise<Limited<Standings>>;
  submit(
    ip: string,
    device: string,
    name: string,
    scores: Scores,
    weekly: WeekEntry | null,
    daily: DayEntry | null,
  ): Limited<SubmitResult> | Promise<Limited<SubmitResult>>;
  forget(ip: string, device: string): Limited<true> | Promise<Limited<true>>;
  stash(ip: string, bundle: string): Limited<StashResult | null> | Promise<Limited<StashResult | null>>;
  take(ip: string, code: string): Limited<string | null> | Promise<Limited<string | null>>;
  /** 친구와 하는 방을 만든다. 방이 너무 많이 열려 있으면 null */
  openRoom(ip: string, game: RoomGame, name: string, id?: string | null): Limited<RoomTicket | null> | Promise<Limited<RoomTicket | null>>;
  /** 코드로 방에 들어간다. 그런 방이 없거나 이미 찼으면 null */
  joinRoom(ip: string, code: string, name: string, id?: string | null): Limited<RoomTicket | null> | Promise<Limited<RoomTicket | null>>;
  /** 내 자리에서 본 방. 방이 없거나 열쇠가 틀리면 null */
  lookRoom(ip: string, code: string, token: string): Limited<RoomView | null> | Promise<Limited<RoomView | null>>;
  moveRoom(
    ip: string,
    code: string,
    token: string,
    version: number,
    move: unknown,
  ): Limited<MoveResult | null> | Promise<Limited<MoveResult | null>>;
  againRoom(ip: string, code: string, token: string): Limited<RoomView | null> | Promise<Limited<RoomView | null>>;
  leaveRoom(ip: string, code: string, token: string): Limited<boolean> | Promise<Limited<boolean>>;
}

/** 0 이상 1 미만의 예측할 수 없는 수. 서버가 카드를 섞을 때 쓴다. */
function secureRandom(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
}

const randomBytes = (length: number): Uint8Array => crypto.getRandomValues(new Uint8Array(length));

export class BoardService implements BoardApi {
  private readonly db: BoardDb;
  private readonly rooms: RoomDb;
  private readonly limiter = new Limiter();

  constructor(
    sql: SqlRunner,
    private readonly now: () => number = Date.now,
    private readonly random: () => number = secureRandom,
  ) {
    this.db = new BoardDb(sql);
    this.rooms = new RoomDb(sql);
  }

  private allow(kind: LimitKind, ip: string): boolean {
    const [limit, windowMs] = LIMITS[kind];
    return this.limiter.allow(`${kind}:${ip}`, limit, windowMs, this.now());
  }

  /** 서버의 시각으로 본 이번 주. span이 week가 아니면 null(전체 랭킹)이다. */
  private weekFor(span: RankSpan): string | null {
    return span === 'week' ? rankWeekOf(this.now()) : null;
  }

  board(ip: string, game: RankedGame, device: string | null, span: RankSpan = 'all'): Limited<RankBoard> {
    if (!this.allow('read', ip)) return TOO_FAST;
    return this.db.board(game, device, this.weekFor(span));
  }

  /** 서버의 시각으로 본 오늘의 랭킹. 랭킹 보기와 같은 한도로 센다. */
  daily(ip: string, game: RankedGame, device: string | null): Limited<RankBoard> {
    if (!this.allow('read', ip)) return TOO_FAST;
    return this.db.dayBoard(game, device, rankDayOf(this.now()));
  }

  /** 한 기기의 모든 게임 순위. 랭킹 보기와 같은 한도로 센다. */
  standings(ip: string, device: string, span: RankSpan = 'all'): Limited<Standings> {
    if (!this.allow('read', ip)) return TOO_FAST;
    return this.db.standings(device, this.weekFor(span));
  }

  submit(
    ip: string,
    device: string,
    name: string,
    scores: Scores,
    weekly: WeekEntry | null = null,
    daily: DayEntry | null = null,
  ): Limited<SubmitResult> {
    if (!this.allow('submit', ip)) return TOO_FAST;
    // 처음 보는 기기는 따로 센다. 이미 올라 있는 기기가 점수를 고치는 것은 막지 않는다.
    if (!this.db.known(device) && !this.allow('newcomer', ip)) return TOO_FAST;
    const now = this.now();
    // 이번 주의 점수만 받는다. 앱의 시계가 틀렸거나 주가 바뀐 뒤에 온 지난 주의 점수는 버린다.
    const thisWeek = weekly && weekly.week === rankWeekOf(now) ? weekly : null;
    // 오늘의 점수도 마찬가지로, 서버가 보는 오늘의 것만 받는다.
    const today = daily && daily.day === rankDayOf(now) ? daily : null;
    return this.db.submit(device, name, scores, now, thisWeek, today);
  }

  forget(ip: string, device: string): Limited<true> {
    if (!this.allow('submit', ip)) return TOO_FAST;
    this.db.forget(device);
    return true;
  }

  stash(ip: string, bundle: string): Limited<StashResult | null> {
    if (!this.allow('stash', ip)) return TOO_FAST;
    return this.db.stash(bundle, this.now(), (length) => crypto.getRandomValues(new Uint8Array(length)));
  }

  take(ip: string, code: string): Limited<string | null> {
    if (!this.allow('take', ip)) return TOO_FAST;
    return this.db.take(code, this.now());
  }

  openRoom(ip: string, game: RoomGame, name: string, id: string | null = null): Limited<RoomTicket | null> {
    if (!this.allow('roomOpen', ip)) return TOO_FAST;
    return this.rooms.create(game, name, this.now(), randomBytes, id);
  }

  joinRoom(ip: string, code: string, name: string, id: string | null = null): Limited<RoomTicket | null> {
    if (!this.allow('roomJoin', ip)) return TOO_FAST;
    return this.rooms.join(code, name, this.now(), randomBytes, this.random, id);
  }

  lookRoom(ip: string, code: string, token: string): Limited<RoomView | null> {
    if (!this.allow('room', ip)) return TOO_FAST;
    return this.rooms.look(code, token, this.now());
  }

  moveRoom(ip: string, code: string, token: string, version: number, move: unknown): Limited<MoveResult | null> {
    if (!this.allow('room', ip)) return TOO_FAST;
    return this.rooms.move(code, token, version, move, this.now());
  }

  againRoom(ip: string, code: string, token: string): Limited<RoomView | null> {
    if (!this.allow('room', ip)) return TOO_FAST;
    return this.rooms.again(code, token, this.now(), this.random);
  }

  leaveRoom(ip: string, code: string, token: string): Limited<boolean> {
    if (!this.allow('room', ip)) return TOO_FAST;
    return this.rooms.leave(code, token, this.now());
  }
}
