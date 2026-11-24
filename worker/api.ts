/**
 * /api/ 로 온 요청을 읽고 답을 만든다. 앱이 보낸 값은 믿지 않고 모두 다시 확인한다.
 * 저장하는 쪽(BoardApi)만 밖에서 받으므로 Cloudflare 없이 테스트할 수 있다.
 */
import {
  cleanCode,
  cleanName,
  cleanScore,
  followsRules,
  hasDailyBoard,
  hasWeeklyBoard,
  isDeviceId,
  isRankDay,
  isRankedGame,
  isRankSpan,
  isRankWeek,
  MAX_BUNDLE_CHARS,
  RANKED_GAMES,
  type ApiError,
  type RankSpan,
} from '../src/online/protocol';
import { cleanRoomCode, isRoomGame, isSeatToken, MAX_MOVE_CHARS } from '../src/versus/protocol';
import { placeOf } from './limiter';
import { TOO_FAST, type BoardApi, type DayEntry, type Scores, type WeekEntry } from './service';

/**
 * 요청 본문으로 받는 가장 큰 크기(글자 수).
 * 세이브 묶음은 본문 안에 글자열로 한 번 더 싸여 오므로(따옴표마다 글자가 하나씩 늘어난다) 두 배까지 본다.
 */
const MAX_BODY_CHARS = MAX_BUNDLE_CHARS * 2 + 2000;

const STATUS: Record<ApiError, number> = { invalid: 400, notfound: 404, slow: 429, busy: 503 };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

const fail = (error: ApiError): Response => json({ error }, STATUS[error]);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * 본문이 JSON이라고 밝힌 요청인지.
 * 다른 사이트의 페이지는 이 표시를 붙인 요청을 방문자 모르게 보낼 수 없다. 브라우저가 서버에 먼저 허락을 묻는데, 이 서버는 허락하지 않는다.
 * 그래서 남의 페이지에 심은 코드가 방문자들의 주소로 옮기기 코드 자리를 채우거나 요청 한도를 피해 가는 일을 막아 준다.
 */
const sentAsJson = (request: Request): boolean =>
  (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() === 'application/json';

/** 본문을 JSON 객체로 읽는다. JSON이라고 밝히지 않았거나, 너무 크거나, 객체가 아니면 null. */
async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  if (!sentAsJson(request)) return null;
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_CHARS * 4) return null;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_CHARS) return null;
    const parsed: unknown = JSON.parse(text);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** 앱이 보낸 점수 묶음에서 쓸 수 있는 것만 고른다. 하나라도 이상하면 null. */
function readScores(raw: unknown): Scores | null {
  if (!isObject(raw)) return null;
  const entries = Object.entries(raw);
  if (entries.length > RANKED_GAMES.length) return null;
  const scores: Scores = {};
  for (const [game, value] of entries) {
    const score = cleanScore(value);
    if (!isRankedGame(game) || score === null) return null;
    scores[game] = score;
  }
  return scores;
}

/**
 * 점수 세는 법이 바뀐 게임의 점수 가운데 지금 규칙으로 냈다고 밝히지 않은 것을 뺀다(protocol.ts의 SCORE_RULES).
 * 아직 업데이트하지 않은 앱이 옛 규칙으로 낸 점수다. 그 게임의 점수만 흘려보내고 나머지는 그대로 받는다.
 */
function dropOutdated(scores: Scores, rules: unknown): void {
  for (const game of RANKED_GAMES) if (!followsRules(game, rules)) delete scores[game];
}

/**
 * 이번 주 랭킹에 올릴 것을 읽는다. 보내지 않았으면 null, 보냈는데 이상하면 'invalid'.
 * 주간 랭킹이 생기기 전의 앱은 이것을 보내지 않는다.
 */
function readWeekly(raw: unknown): WeekEntry | null | 'invalid' {
  if (raw === undefined || raw === null) return null;
  if (!isObject(raw) || !isRankWeek(raw.week)) return 'invalid';
  const scores = readScores(raw.scores ?? {});
  if (scores === null) return 'invalid';
  // 주간 랭킹이 없는 게임(점수가 계속 쌓이는 게임)의 점수는 받지 않고 흘려보낸다.
  for (const game of RANKED_GAMES) if (!hasWeeklyBoard(game)) delete scores[game];
  return { week: raw.week, scores };
}

/**
 * 오늘의 랭킹에 올릴 것을 읽는다. 보내지 않았으면 null, 보냈는데 이상하면 'invalid'.
 * 오늘의 랭킹이 생기기 전의 앱은 이것을 보내지 않는다.
 */
function readDaily(raw: unknown): DayEntry | null | 'invalid' {
  if (raw === undefined || raw === null) return null;
  if (!isObject(raw) || !isRankDay(raw.day)) return 'invalid';
  const scores = readScores(raw.scores ?? {});
  if (scores === null) return 'invalid';
  // 오늘의 랭킹이 없는 게임의 점수는 받지 않고 흘려보낸다.
  for (const game of RANKED_GAMES) if (!hasDailyBoard(game)) delete scores[game];
  return { day: raw.day, scores };
}

/** 주소에 적힌 랭킹의 범위. 적지 않았으면 전체 랭킹이고, 모르는 값이면 null. */
function readSpan(url: URL): RankSpan | null {
  const span = url.searchParams.get('span') ?? 'all';
  return isRankSpan(span) ? span : null;
}

/** 저장소가 답하지 않을 때의 답. 앱은 이것을 "지금은 안 됨"으로 받아들인다. */
export const busy = (): Response => fail('busy');

export async function handleApi(request: Request, board: BoardApi): Promise<Response> {
  const url = new URL(request.url);
  // 요청을 세는 데만 쓰고 저장하지 않는다. IPv6 주소는 앞 64비트로 묶어 센다.
  const ip = placeOf(request.headers.get('cf-connecting-ip'));
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;

  // GET /api/rank/<게임>?me=<기기 id>&span=<all|week>
  const rank = /^\/api\/rank\/([a-z-]+)$/.exec(path);
  if (rank && method === 'GET') {
    const game = rank[1];
    const me = url.searchParams.get('me');
    const span = readSpan(url);
    if (!isRankedGame(game) || (me !== null && !isDeviceId(me)) || span === null) return fail('invalid');
    const result = await board.board(ip, game, me, span);
    return result === TOO_FAST ? fail('slow') : json(result);
  }

  // GET /api/daily/<게임>?me=<기기 id>: 오늘의 랭킹. 오늘의 랭킹이 없는 게임이면 받지 않는다.
  const today = /^\/api\/daily\/([a-z-]+)$/.exec(path);
  if (today && method === 'GET') {
    const game = today[1];
    const me = url.searchParams.get('me');
    if (!hasDailyBoard(game) || (me !== null && !isDeviceId(me))) return fail('invalid');
    const result = await board.daily(ip, game, me);
    return result === TOO_FAST ? fail('slow') : json(result);
  }

  // GET /api/rank?me=<기기 id>&span=<all|week>: 그 기기가 올라 있는 모든 게임의 순위. 누구의 것인지 적지 않은 요청은 받지 않는다.
  const whose = url.searchParams.get('me');
  if (path === '/api/rank' && method === 'GET' && whose !== null) {
    const span = readSpan(url);
    if (!isDeviceId(whose) || span === null) return fail('invalid');
    const result = await board.standings(ip, whose, span);
    // 이번 주의 순위에는 서버가 보는 주를 같이 적는다. 주간 랭킹을 모르는 옛 서버의 답과 가려 준다.
    return result === TOO_FAST ? fail('slow') : json(span === 'week' ? { mine: result, span } : { mine: result });
  }

  if (path === '/api/rank' && (method === 'POST' || method === 'DELETE')) {
    const body = await readBody(request);
    if (!body || !isDeviceId(body.device)) return fail('invalid');
    if (method === 'DELETE') {
      const result = await board.forget(ip, body.device);
      return result === TOO_FAST ? fail('slow') : json({ ok: true });
    }
    const name = cleanName(body.name);
    const scores = readScores(body.scores ?? {});
    const weekly = readWeekly(body.weekly);
    const daily = readDaily(body.daily);
    if (name === null || scores === null || weekly === 'invalid' || daily === 'invalid') return fail('invalid');
    for (const group of [scores, weekly?.scores, daily?.scores]) if (group) dropOutdated(group, body.rules);
    const result = await board.submit(ip, body.device, name, scores, weekly, daily);
    return result === TOO_FAST ? fail('slow') : json(result);
  }

  if (path === '/api/transfer' && method === 'POST') {
    const body = await readBody(request);
    const bundle = body?.bundle;
    if (typeof bundle !== 'string' || bundle.length === 0 || bundle.length > MAX_BUNDLE_CHARS) {
      return fail('invalid');
    }
    const result = await board.stash(ip, bundle);
    if (result === TOO_FAST) return fail('slow');
    return result ? json(result) : fail('busy');
  }

  if (path === '/api/transfer/take' && method === 'POST') {
    const body = await readBody(request);
    const code = cleanCode(body?.code);
    if (code === null) return fail('invalid');
    const result = await board.take(ip, code);
    if (result === TOO_FAST) return fail('slow');
    return result === null ? fail('notfound') : json({ bundle: result });
  }

  if (path.startsWith('/api/room') && method === 'POST') return handleRoom(path, request, board, ip);

  return fail('notfound');
}

/**
 * 친구와 하는 방(POST /api/room/...). 방의 코드와 자리 열쇠를 본문으로 받는다.
 * 주소에 열쇠를 적지 않는 것은, 주소는 기록에 남기 쉬워서다.
 */
async function handleRoom(path: string, request: Request, board: BoardApi, ip: string): Promise<Response> {
  const body = await readBody(request);
  if (!body) return fail('invalid');
  const answer = <T>(result: T | typeof TOO_FAST | null, wrap: (value: T) => unknown = (value) => value): Response => {
    if (result === TOO_FAST) return fail('slow');
    return result === null ? fail('notfound') : json(wrap(result));
  };

  // 방 만들기: { game, name }
  if (path === '/api/room') {
    const name = cleanName(body.name);
    if (!isRoomGame(body.game) || name === null) return fail('invalid');
    const result = await board.openRoom(ip, body.game, name);
    // 방이 너무 많이 열려 있으면 만들지 않는다. 앱은 "지금은 안 됨"으로 받는다.
    if (result === null) return fail('busy');
    return answer(result);
  }

  // 코드로 들어가기: { code, name }
  if (path === '/api/room/join') {
    const code = cleanRoomCode(body.code);
    const name = cleanName(body.name);
    if (code === null || name === null) return fail('invalid');
    return answer(await board.joinRoom(ip, code, name));
  }

  // 나머지는 모두 { code, token }으로 내 자리를 밝힌다.
  const code = cleanRoomCode(body.code);
  const token = body.token;
  if (code === null || !isSeatToken(token)) return fail('invalid');

  if (path === '/api/room/look') {
    const result = await board.lookRoom(ip, code, token);
    // 앱이 이미 본 번호와 같으면 방의 모습을 다시 싣지 않는다. 기다리는 동안 2초마다 묻기 때문이다.
    // 다만 상대가 자리를 비웠으면 남은 시간이 바뀌므로 그대로 싣는다.
    if (result !== null && result !== TOO_FAST && result.version === body.version && result.away === null) {
      return json({ same: true, version: result.version });
    }
    return answer(result, (room) => ({ room }));
  }
  if (path === '/api/room/move') {
    const version = body.version;
    if (typeof version !== 'number' || !Number.isInteger(version)) return fail('invalid');
    if (JSON.stringify(body.move ?? null).length > MAX_MOVE_CHARS) return fail('invalid');
    return answer(await board.moveRoom(ip, code, token, version, body.move));
  }
  if (path === '/api/room/again') return answer(await board.againRoom(ip, code, token), (room) => ({ room }));
  if (path === '/api/room/leave') {
    const result = await board.leaveRoom(ip, code, token);
    return answer(result === false ? null : result, () => ({ ok: true }));
  }
  return fail('notfound');
}
