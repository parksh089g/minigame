/**
 * 서버(worker/)와 주고받는 부분. 실패해도 예외를 던지지 않고 이유를 돌려준다.
 * 게임은 서버 없이도 돌아가야 하므로, 부르는 쪽은 실패를 "지금은 안 됨"으로만 다루면 된다.
 */
import {
  type ApiError,
  type RankBoard,
  type RankedGame,
  type RankRow,
  type RankSpan,
  type Standings,
  type StashResult,
  type SubmitRequest,
  type SubmitResult,
} from './protocol';

/** offline: 서버에 닿지 못함(인터넷 없음, 시간 초과, 서버가 없는 곳에 올린 경우). 나머지는 서버가 알려 준 이유다. */
export type ApiFailure = 'offline' | ApiError;

export type ApiResult<T> = { ok: true; data: T } | { ok: false; reason: ApiFailure };

const TIMEOUT_MS = 8000;
const ERRORS: readonly ApiError[] = ['invalid', 'notfound', 'slow', 'busy'];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** 숫자만 든 객체인지 */
const isCounts = (value: unknown): value is Record<string, number> =>
  isObject(value) && Object.values(value).every(isCount);

const isRow = (value: unknown): value is RankRow =>
  isObject(value) &&
  isCount(value.rank) &&
  typeof value.name === 'string' &&
  isCount(value.score) &&
  typeof value.mine === 'boolean';

function asBoard(value: unknown): RankBoard | null {
  if (!isObject(value) || !Array.isArray(value.top) || !value.top.every(isRow)) return null;
  const when = {
    ...(typeof value.week === 'string' ? { week: value.week } : {}),
    ...(isCount(value.day) ? { day: value.day } : {}),
  };
  const me = value.me;
  if (me === null || me === undefined) return { top: value.top, me: null, ...when };
  if (!isObject(me) || !isCount(me.rank) || !isCount(me.score) || typeof me.name !== 'string') return null;
  return { top: value.top, me: { rank: me.rank, score: me.score, name: me.name }, ...when };
}

/** 오늘의 랭킹으로 온 답인지 확인하며 읽는다. 답에는 서버가 보는 오늘이 적혀 있다. */
function asDayBoard(value: unknown): RankBoard | null {
  const board = asBoard(value);
  return board && board.day !== undefined ? board : null;
}

/**
 * 이번 주 랭킹으로 온 답인지 확인하며 읽는다.
 * 주간 랭킹이 생기기 전의 서버는 span을 모르고 전체 랭킹을 돌려주는데, 그 답에는 주가 적혀 있지 않다.
 */
function asWeekBoard(value: unknown): RankBoard | null {
  const board = asBoard(value);
  return board && board.week !== undefined ? board : null;
}

function asStandings(value: unknown): Standings | null {
  if (!isObject(value) || !isObject(value.mine)) return null;
  const standings: Standings = {};
  for (const [game, entry] of Object.entries(value.mine)) {
    if (!isObject(entry) || !isCount(entry.rank) || !isCount(entry.score)) return null;
    standings[game] = { rank: entry.rank, score: entry.score };
  }
  return standings;
}

/** 이번 주의 순위로 온 답인지 확인하며 읽는다. 옛 서버의 답(전체 순위)은 받지 않는다. */
function asWeekStandings(value: unknown): Standings | null {
  return isObject(value) && value.span === 'week' ? asStandings(value) : null;
}

function asSubmit(value: unknown): SubmitResult | null {
  if (!isObject(value) || !isCounts(value.bests) || !isCounts(value.ranks)) return null;
  return { bests: value.bests, ranks: value.ranks };
}

function asStash(value: unknown): StashResult | null {
  if (!isObject(value) || typeof value.code !== 'string' || !isCount(value.expiresAt)) return null;
  return { code: value.code, expiresAt: value.expiresAt };
}

function asBundle(value: unknown): string | null {
  return isObject(value) && typeof value.bundle === 'string' ? value.bundle : null;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** 서버를 부르는 함수 묶음을 만든다. 테스트에서는 fetch를 바꿔 끼운다. */
export function createApi(
  fetcher: Fetch = (input, init) => fetch(input, init),
  isOnline: () => boolean = () => navigator.onLine !== false,
) {
  async function call<T>(
    path: string,
    read: (value: unknown) => T | null,
    method = 'GET',
    body?: unknown,
  ): Promise<ApiResult<T>> {
    if (!isOnline()) return { ok: false, reason: 'offline' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetcher(path, {
        method,
        signal: controller.signal,
        cache: 'no-store',
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const parsed: unknown = await response.json();
      if (!response.ok) {
        const error = isObject(parsed) ? parsed.error : undefined;
        const known = ERRORS.find((candidate) => candidate === error);
        // 서버가 없는 곳(정적 호스팅)에서는 404가 우리 형식이 아니다. 닿지 못한 것으로 친다.
        return { ok: false, reason: known ?? 'offline' };
      }
      const data = read(parsed);
      return data === null ? { ok: false, reason: 'offline' } : { ok: true, data };
    } catch {
      return { ok: false, reason: 'offline' };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    /** 한 게임의 랭킹. me를 주면 그 기기의 순위도 같이 온다. span이 week면 이번 주의 랭킹이다. */
    board: (game: RankedGame, me: string | null, span: RankSpan = 'all'): Promise<ApiResult<RankBoard>> => {
      const query = [me ? `me=${encodeURIComponent(me)}` : '', span === 'week' ? 'span=week' : ''].filter(Boolean);
      const path = `/api/rank/${game}${query.length > 0 ? `?${query.join('&')}` : ''}`;
      return call(path, span === 'week' ? asWeekBoard : asBoard);
    },
    /** 한 게임의 오늘의 랭킹: 그날의 판에서 낸 점수만 겨룬다. me를 주면 그 기기의 순위도 같이 온다. */
    daily: (game: RankedGame, me: string | null): Promise<ApiResult<RankBoard>> =>
      call(`/api/daily/${game}${me ? `?me=${encodeURIComponent(me)}` : ''}`, asDayBoard),
    /** 이 기기가 올라 있는 모든 게임의 순위를 한 번에 받는다. span이 week면 이번 주의 순위다. */
    standings: (me: string, span: RankSpan = 'all'): Promise<ApiResult<Standings>> =>
      span === 'week'
        ? call(`/api/rank?me=${encodeURIComponent(me)}&span=week`, asWeekStandings)
        : call(`/api/rank?me=${encodeURIComponent(me)}`, asStandings),
    /** 최고 점수와 닉네임을 올린다. */
    submit: (request: SubmitRequest): Promise<ApiResult<SubmitResult>> =>
      call('/api/rank', asSubmit, 'POST', request),
    /** 이 기기의 기록을 모든 랭킹에서 지운다. */
    forget: (device: string): Promise<ApiResult<true>> =>
      call('/api/rank', (value) => (isObject(value) ? true : null), 'DELETE', { device }),
    /** 세이브를 맡기고 옮기기 코드를 받는다. */
    stash: (bundle: string): Promise<ApiResult<StashResult>> =>
      call('/api/transfer', asStash, 'POST', { bundle }),
    /** 옮기기 코드로 맡겨 둔 세이브를 받는다. */
    take: (code: string): Promise<ApiResult<string>> =>
      call('/api/transfer/take', asBundle, 'POST', { code }),
  };
}

export type Api = ReturnType<typeof createApi>;

export const api: Api = createApi();

/** 실패한 이유를 사람에게 보여 줄 문구로 바꾼다. */
export function failureText(reason: ApiFailure): string {
  switch (reason) {
    case 'offline':
      return '서버에 닿지 못했어요. 인터넷 연결을 확인해 주세요.';
    case 'slow':
      return '요청이 너무 잦아요. 잠시 뒤에 다시 해 주세요.';
    case 'busy':
      return '지금은 서버가 쉬고 있어요. 나중에 다시 해 주세요.';
    case 'notfound':
      return '찾을 수 없어요.';
    case 'invalid':
      return '보낸 값이 맞지 않아요.';
  }
}
