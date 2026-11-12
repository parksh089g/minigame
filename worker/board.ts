/**
 * 랭킹과 옮기기 코드를 맡는 Durable Object. 앱 전체에 하나만 둔다.
 * 저장은 이 객체에 딸린 SQLite에 한다. 요청을 세는 값은 메모리에만 있고 주소(IP)는 저장하지 않는다.
 * 규칙은 service.ts에 있고, 여기서는 그것을 Cloudflare에 얹기만 한다.
 */
import { DurableObject } from 'cloudflare:workers';
import type {
  RankBoard,
  RankedGame,
  RankSpan,
  Standings,
  StashResult,
  SubmitResult,
} from '../src/online/protocol';
import { BoardService, type BoardApi, type DayEntry, type Limited, type Scores, type WeekEntry } from './service';

/** 이 객체는 다른 자원을 쓰지 않는다. */
type NoBindings = Record<string, never>;

export class ArcadeBoard extends DurableObject<NoBindings> implements BoardApi {
  private readonly service: BoardService;

  constructor(ctx: DurableObjectState, env: NoBindings) {
    super(ctx, env);
    this.service = new BoardService(ctx.storage.sql);
  }

  board(ip: string, game: RankedGame, device: string | null, span: RankSpan): Limited<RankBoard> {
    return this.service.board(ip, game, device, span);
  }

  daily(ip: string, game: RankedGame, device: string | null): Limited<RankBoard> {
    return this.service.daily(ip, game, device);
  }

  standings(ip: string, device: string, span: RankSpan): Limited<Standings> {
    return this.service.standings(ip, device, span);
  }

  submit(
    ip: string,
    device: string,
    name: string,
    scores: Scores,
    weekly: WeekEntry | null,
    daily: DayEntry | null,
  ): Limited<SubmitResult> {
    return this.service.submit(ip, device, name, scores, weekly, daily);
  }

  forget(ip: string, device: string): Limited<true> {
    return this.service.forget(ip, device);
  }

  stash(ip: string, bundle: string): Limited<StashResult | null> {
    return this.service.stash(ip, bundle);
  }

  take(ip: string, code: string): Limited<string | null> {
    return this.service.take(ip, code);
  }
}
