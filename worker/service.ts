/**
 * 랭킹과 옮기기 코드의 규칙: 요청 한도를 확인한 뒤 저장소에 넣고 꺼낸다.
 * Cloudflare에 기대지 않아서 테스트에서 그대로 돌려 볼 수 있다. 실제 서버에서는 board.ts의 Durable Object가 이것을 들고 있다.
 */
import type { RankBoard, RankedGame, Standings, StashResult, SubmitResult } from '../src/online/protocol';
import { BoardDb, type SqlRunner } from './board-db';
import { Limiter, LIMITS, type LimitKind } from './limiter';

/** 요청이 너무 잦아서 받지 않았다는 답 */
export const TOO_FAST = 'slow';
export type Limited<T> = T | typeof TOO_FAST;

export type Scores = Partial<Record<RankedGame, number>>;

/**
 * api.ts가 부르는 모양. 실제 서버에서는 Durable Object를 거쳐서 답이 Promise로 온다.
 * ip는 요청을 세는 데만 쓰고 저장하지 않는다.
 */
export interface BoardApi {
  board(ip: string, game: RankedGame, device: string | null): Limited<RankBoard> | Promise<Limited<RankBoard>>;
  standings(ip: string, device: string): Limited<Standings> | Promise<Limited<Standings>>;
  submit(
    ip: string,
    device: string,
    name: string,
    scores: Scores,
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

  board(ip: string, game: RankedGame, device: string | null): Limited<RankBoard> {
    if (!this.allow('read', ip)) return TOO_FAST;
    return this.db.board(game, device);
  }

  /** 한 기기의 모든 게임 순위. 랭킹 보기와 같은 한도로 센다. */
  standings(ip: string, device: string): Limited<Standings> {
    if (!this.allow('read', ip)) return TOO_FAST;
    return this.db.standings(device);
  }

  submit(ip: string, device: string, name: string, scores: Scores): Limited<SubmitResult> {
    if (!this.allow('submit', ip)) return TOO_FAST;
    // 처음 보는 기기는 따로 센다. 이미 올라 있는 기기가 점수를 고치는 것은 막지 않는다.
    if (!this.db.known(device) && !this.allow('newcomer', ip)) return TOO_FAST;
    return this.db.submit(device, name, scores, this.now());
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
