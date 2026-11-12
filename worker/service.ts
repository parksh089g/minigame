/**
 * 랭킹과 옮기기 코드의 규칙: 요청 한도를 확인한 뒤 저장소에 넣고 꺼낸다.
 * Cloudflare에 기대지 않아서 테스트에서 그대로 돌려 볼 수 있다. 실제 서버에서는 board.ts의 Durable Object가 이것을 들고 있다.
 */
import {
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

/** 요청이 너무 잦아서 받지 않았다는 답 */
export const TOO_FAST = 'slow';
export type Limited<T> = T | typeof TOO_FAST;

export type { Scores };

/** 앱이 이번 주 랭킹에 올리겠다고 보낸 것. 어느 주의 점수인지는 앱이 적어 보내고, 서버가 자기 시각의 주와 견준다. */
export interface WeekEntry {
  week: string;
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
  standings(ip: string, device: string, span: RankSpan): Limited<Standings> | Promise<Limited<Standings>>;
  submit(
    ip: string,
    device: string,
    name: string,
    scores: Scores,
    weekly: WeekEntry | null,
  ): Limited<SubmitResult> | Promise<Limited<SubmitResult>>;
  forget(ip: string, device: string): Limited<true> | Promise<Limited<true>>;
  stash(ip: string, bundle: string): Limited<StashResult | null> | Promise<Limited<StashResult | null>>;
  take(ip: string, code: string): Limited<string | null> | Promise<Limited<string | null>>;
}

export class BoardService implements BoardApi {
  private readonly db: BoardDb;
  private readonly limiter = new Limiter();

  constructor(
    sql: SqlRunner,
    private readonly now: () => number = Date.now,
  ) {
    this.db = new BoardDb(sql);
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
  ): Limited<SubmitResult> {
    if (!this.allow('submit', ip)) return TOO_FAST;
    // 처음 보는 기기는 따로 센다. 이미 올라 있는 기기가 점수를 고치는 것은 막지 않는다.
    if (!this.db.known(device) && !this.allow('newcomer', ip)) return TOO_FAST;
    const now = this.now();
    // 이번 주의 점수만 받는다. 앱의 시계가 틀렸거나 주가 바뀐 뒤에 온 지난 주의 점수는 버린다.
    const thisWeek = weekly && weekly.week === rankWeekOf(now) ? weekly : null;
    return this.db.submit(device, name, scores, now, thisWeek);
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
}
