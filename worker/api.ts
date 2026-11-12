/**
 * /api/ 로 온 요청을 읽고 답을 만든다. 앱이 보낸 값은 믿지 않고 모두 다시 확인한다.
 * 저장하는 쪽(BoardApi)만 밖에서 받으므로 Cloudflare 없이 테스트할 수 있다.
 */
import {
  cleanCode,
  cleanName,
  cleanScore,
  isDeviceId,
  isRankedGame,
  MAX_BUNDLE_CHARS,
  RANKED_GAMES,
  type ApiError,
} from '../src/online/protocol';
import { TOO_FAST, type BoardApi, type Scores } from './service';

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

/** 저장소가 답하지 않을 때의 답. 앱은 이것을 "지금은 안 됨"으로 받아들인다. */
export const busy = (): Response => fail('busy');

export async function handleApi(request: Request, board: BoardApi): Promise<Response> {
  const url = new URL(request.url);
  // 요청을 세는 데만 쓰고 저장하지 않는다.
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;

  // GET /api/rank/<게임>?me=<기기 id>
  const rank = /^\/api\/rank\/([a-z-]+)$/.exec(path);
  if (rank && method === 'GET') {
    const game = rank[1];
    const me = url.searchParams.get('me');
    if (!isRankedGame(game) || (me !== null && !isDeviceId(me))) return fail('invalid');
    const result = await board.board(ip, game, me);
    return result === TOO_FAST ? fail('slow') : json(result);
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
    if (name === null || scores === null) return fail('invalid');
    const result = await board.submit(ip, body.device, name, scores);
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

  return fail('notfound');
}
