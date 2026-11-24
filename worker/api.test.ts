import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { MAX_BUNDLE_CHARS, rankDayOf, rankWeekOf, TRANSFER_TTL_MS } from '../src/online/protocol';
import { handleApi } from './api';
import type { SqlRunner, SqlValue } from './board-db';
import { LIMITS } from './limiter';
import { BoardService } from './service';

function memorySql(): SqlRunner {
  const database = new DatabaseSync(':memory:');
  return {
    exec<T extends Record<string, SqlValue>>(query: string, ...bindings: SqlValue[]) {
      const rows = database.prepare(query).all(...bindings) as T[];
      return { toArray: () => rows };
    },
  };
}

const device = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** 시계를 손으로 돌릴 수 있는 서버 하나 */
function server() {
  let now = 1_800_000_000_000;
  const service = new BoardService(memorySql(), () => now);
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    ip = '10.0.0.1',
    /** 본문의 형식 표시. null이면 붙이지 않는다(글자열 본문에는 브라우저처럼 text/plain이 붙는다). */
    type: string | null = 'application/json',
  ): Promise<{ status: number; body: Record<string, unknown>; headers: Headers }> => {
    const request = new Request(`https://arcade.example${path}`, {
      method,
      headers: { 'cf-connecting-ip': ip, ...(body === undefined || type === null ? {} : { 'content-type': type }) },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const response = await handleApi(request, service);
    return {
      status: response.status,
      body: (await response.json()) as Record<string, unknown>,
      headers: response.headers,
    };
  };
  return {
    call,
    wait(ms: number) {
      now += ms;
    },
  };
}

describe('랭킹 요청', () => {
  it('점수를 올리고 랭킹에서 본다', async () => {
    const { call } = server();
    const posted = await call('POST', '/api/rank', {
      device: device(1),
      name: ' 등불  지기 ',
      scores: { 'lantern-keeper': 1200.7 },
    });
    expect(posted.status).toBe(200);
    expect(posted.body).toEqual({ bests: { 'lantern-keeper': 1200 }, ranks: { 'lantern-keeper': 1 } });

    const board = await call('GET', `/api/rank/lantern-keeper?me=${device(1)}`);
    expect(board.status).toBe(200);
    expect(board.body).toEqual({
      top: [{ rank: 1, name: '등불 지기', score: 1200, mine: true }],
      me: { rank: 1, score: 1200, name: '등불 지기' },
    });
    // 남이 보면 내 것이라는 표시가 없고, 기기 id는 어디에도 없다.
    const other = await call('GET', '/api/rank/lantern-keeper');
    expect(other.body).toEqual({ top: [{ rank: 1, name: '등불 지기', score: 1200, mine: false }], me: null });
    expect(JSON.stringify(other.body)).not.toContain(device(1));
  });

  it('답은 저장해 두지 말라고 알린다', async () => {
    const { call } = server();
    const board = await call('GET', '/api/rank/stack-tower');
    expect(board.headers.get('cache-control')).toBe('no-store');
    expect(board.headers.get('content-type')).toContain('application/json');
  });

  it('점수 없이 닉네임만 보낼 수 있다', async () => {
    const { call } = server();
    await call('POST', '/api/rank', { device: device(1), name: '옛이름', scores: { 'stack-tower': 50 } });
    const renamed = await call('POST', '/api/rank', { device: device(1), name: '새이름' });
    expect(renamed.status).toBe(200);
    const board = await call('GET', '/api/rank/stack-tower');
    expect(board.body.top).toEqual([{ rank: 1, name: '새이름', score: 50, mine: false }]);
  });

  it('기록을 지우면 랭킹에서 빠진다', async () => {
    const { call } = server();
    await call('POST', '/api/rank', { device: device(1), name: '하나', scores: { 'stack-tower': 50 } });
    expect((await call('DELETE', '/api/rank', { device: device(1) })).body).toEqual({ ok: true });
    expect((await call('GET', `/api/rank/stack-tower?me=${device(1)}`)).body).toEqual({ top: [], me: null });
  });

  it('맞지 않는 값은 받지 않는다', async () => {
    const { call } = server();
    const good = { device: device(1), name: '하나', scores: { 'stack-tower': 50 } };
    const bad: unknown[] = [
      { ...good, device: 'nope' },
      { ...good, device: undefined },
      { ...good, name: '가' },
      { ...good, name: '<script>' },
      { ...good, name: 7 },
      { ...good, scores: { 'stack-tower': 0 } },
      { ...good, scores: { 'stack-tower': 99_999_999 } },
      { ...good, scores: { 'stack-tower': '50' } },
      { ...good, scores: { 'no-such-game': 50 } },
      { ...good, scores: [50] },
      'not json',
      '[1, 2]',
      '"text"',
    ];
    for (const body of bad) {
      const answer = await call('POST', '/api/rank', body);
      expect(answer.status, JSON.stringify(body)).toBe(400);
      expect(answer.body).toEqual({ error: 'invalid' });
    }
    expect((await call('GET', '/api/rank/no-such-game')).status).toBe(400);
    expect((await call('GET', '/api/rank/stack-tower?me=nope')).status).toBe(400);
    expect((await call('DELETE', '/api/rank', { device: 'nope' })).status).toBe(400);
    // 아무것도 저장되지 않았다.
    expect((await call('GET', '/api/rank/stack-tower')).body).toEqual({ top: [], me: null });
  });

  it('본문이 JSON이라고 밝히지 않은 요청은 받지 않는다', async () => {
    // 다른 사이트의 페이지가 방문자 모르게 보낼 수 있는 요청은 이런 형식 표시뿐이다.
    const { call } = server();
    const good = { device: device(1), name: '하나', scores: { 'stack-tower': 50 } };
    const sneaky = [
      'text/plain',
      'text/plain;charset=UTF-8',
      'application/x-www-form-urlencoded',
      'multipart/form-data; boundary=x',
      null,
    ];
    for (const type of sneaky) {
      for (const [method, path, body] of [
        ['POST', '/api/rank', good],
        ['DELETE', '/api/rank', { device: device(1) }],
        ['POST', '/api/transfer', { bundle: '{}' }],
        ['POST', '/api/transfer/take', { code: 'ABCDEFGH' }],
      ] as const) {
        const answer = await call(method, path, body, '10.0.0.1', type);
        expect(answer.status, `${method} ${path} ${type}`).toBe(400);
        expect(answer.body).toEqual({ error: 'invalid' });
      }
    }
    // 아무것도 저장되지 않았다.
    expect((await call('GET', '/api/rank/stack-tower')).body).toEqual({ top: [], me: null });
    // 앱이 보내는 표시는 대소문자와 뒤에 붙은 글자 집합 표시가 달라도 받는다.
    expect((await call('POST', '/api/rank', good, '10.0.0.1', 'Application/JSON; charset=utf-8')).status).toBe(200);
  });

  it('없는 주소와 맞지 않는 방식은 404로 답한다', async () => {
    const { call } = server();
    for (const [method, path] of [
      ['GET', '/api/nothing'],
      ['GET', '/api/rank'],
      ['PUT', '/api/rank'],
      ['POST', '/api/rank/stack-tower'],
      ['GET', '/api/transfer'],
      ['GET', '/api/transfer/take'],
    ] as const) {
      const answer = await call(method, path, method === 'GET' ? undefined : {});
      expect(answer.status, `${method} ${path}`).toBe(404);
      expect(answer.body).toEqual({ error: 'notfound' });
    }
  });
});

describe('옮기기 요청', () => {
  it('세이브를 맡기고 코드로 꺼낸다. 코드는 소문자와 붙임표로 쳐도 된다', async () => {
    const { call } = server();
    const bundle = JSON.stringify({ app: 'pocket-arcade', save: { coins: 3 } });
    const stashed = await call('POST', '/api/transfer', { bundle });
    expect(stashed.status).toBe(200);
    const code = String(stashed.body.code);
    expect(code).toMatch(/^[2-9A-HJ-NP-Z]{8}$/);
    expect(stashed.body.expiresAt).toBe(1_800_000_000_000 + TRANSFER_TTL_MS);

    const typed = `${code.slice(0, 4)}-${code.slice(4)}`.toLowerCase();
    const taken = await call('POST', '/api/transfer/take', { code: typed }, '10.0.0.2');
    expect(taken.status).toBe(200);
    expect(taken.body).toEqual({ bundle });
  });

  it('시간이 지난 코드와 없는 코드는 찾을 수 없다고 답한다', async () => {
    const { call, wait } = server();
    const stashed = await call('POST', '/api/transfer', { bundle: '{}' });
    expect((await call('POST', '/api/transfer/take', { code: 'ZZZZZZZZ' })).status).toBe(404);
    wait(TRANSFER_TTL_MS);
    const late = await call('POST', '/api/transfer/take', { code: stashed.body.code });
    expect(late.status).toBe(404);
    expect(late.body).toEqual({ error: 'notfound' });
  });

  it('너무 큰 세이브와 모양이 다른 요청은 받지 않는다', async () => {
    const { call } = server();
    expect((await call('POST', '/api/transfer', { bundle: 'x'.repeat(MAX_BUNDLE_CHARS) })).status).toBe(200);
    for (const body of [{ bundle: 'x'.repeat(MAX_BUNDLE_CHARS + 1) }, { bundle: '' }, { bundle: 5 }, {}, 'nope']) {
      expect((await call('POST', '/api/transfer', body)).status).toBe(400);
    }
    for (const body of [{ code: 'ABC' }, { code: 'ABCD0EFG' }, { code: 5 }, {}]) {
      expect((await call('POST', '/api/transfer/take', body)).status).toBe(400);
    }
  });

  it('따옴표가 많아 본문이 부풀어도 한도 안의 세이브는 받는다', async () => {
    const { call } = server();
    const bundle = '"'.repeat(MAX_BUNDLE_CHARS);
    const stashed = await call('POST', '/api/transfer', { bundle });
    expect(stashed.status).toBe(200);
    expect((await call('POST', '/api/transfer/take', { code: stashed.body.code })).body).toEqual({ bundle });
  });
});

describe('요청 한도', () => {
  it('한곳에서 랭킹을 너무 자주 보면 잠깐 막고, 시간이 지나면 다시 받는다', async () => {
    const { call, wait } = server();
    const [limit, windowMs] = LIMITS.read;
    for (let n = 0; n < limit; n += 1) expect((await call('GET', '/api/rank/stack-tower')).status).toBe(200);
    const blocked = await call('GET', '/api/rank/stack-tower');
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: 'slow' });
    // 다른 곳에서 온 요청은 막지 않는다.
    expect((await call('GET', '/api/rank/stack-tower', undefined, '10.0.0.9')).status).toBe(200);
    wait(windowMs);
    expect((await call('GET', '/api/rank/stack-tower')).status).toBe(200);
  });

  it('IPv6에서는 뒤쪽 주소를 바꿔 가며 보내도 같은 곳으로 센다', async () => {
    const { call } = server();
    const [limit] = LIMITS.read;
    const from = (n: number): string => `2001:db8:12:3400::${(n + 1).toString(16)}`;
    for (let n = 0; n < limit; n += 1) {
      expect((await call('GET', '/api/rank/stack-tower', undefined, from(n))).status).toBe(200);
    }
    expect((await call('GET', '/api/rank/stack-tower', undefined, from(limit))).status).toBe(429);
    // 앞 64비트가 다른 주소는 다른 곳이다.
    expect((await call('GET', '/api/rank/stack-tower', undefined, '2001:db8:12:3401::1')).status).toBe(200);
  });

  it('한곳에서 새 이름을 마구 올리는 것은 막지만, 이미 올라 있는 기기는 점수를 고칠 수 있다', async () => {
    const { call, wait } = server();
    const [limit] = LIMITS.newcomer;
    const post = (n: number, score: number) =>
      call('POST', '/api/rank', { device: device(n), name: `선수${n}`, scores: { 'gate-run': score } });
    for (let n = 1; n <= limit; n += 1) {
      expect((await post(n, 10 + n)).status).toBe(200);
      // 점수 올리기 자체의 한도(1분)에는 걸리지 않게 시간을 띄운다.
      wait(10_000);
    }
    expect((await post(limit + 1, 999)).status).toBe(429);
    expect((await post(1, 500)).body).toEqual({ bests: { 'gate-run': 500 }, ranks: { 'gate-run': 1 } });
    const board = await call('GET', '/api/rank/gate-run');
    expect((board.body.top as unknown[]).length).toBe(limit);
  });

  it('코드를 마구 넣어 맞히지 못하게 꺼내기도 횟수를 센다', async () => {
    const { call } = server();
    const [limit] = LIMITS.take;
    for (let n = 0; n < limit; n += 1) {
      expect((await call('POST', '/api/transfer/take', { code: 'ZZZZZZZZ' })).status).toBe(404);
    }
    expect((await call('POST', '/api/transfer/take', { code: 'ZZZZZZZZ' })).status).toBe(429);
  });
});

describe('모든 게임의 내 순위 요청', () => {
  it('내가 올라 있는 게임의 순위와 점수를 한 번에 받는다', async () => {
    const { call } = server();
    await call('POST', '/api/rank', { device: device(1), name: '하나', scores: { 'stack-tower': 70, 'merge-tiles': 300 } });
    const second = await call('POST', '/api/rank', { device: device(2), name: '두리', scores: { 'stack-tower': 90 } });
    expect(second.status).toBe(200);

    const mine = await call('GET', `/api/rank?me=${device(1)}`);
    expect(mine.status).toBe(200);
    expect(mine.body).toEqual({
      mine: { 'stack-tower': { rank: 2, score: 70 }, 'merge-tiles': { rank: 1, score: 300 } },
    });
    expect(mine.headers.get('cache-control')).toBe('no-store');
    // 닉네임이나 다른 사람의 기록은 들어 있지 않다.
    expect(JSON.stringify(mine.body)).not.toContain('하나');
    expect(JSON.stringify(mine.body)).not.toContain(device(2));

    const nobody = await call('GET', `/api/rank?me=${device(9)}`);
    expect(nobody.status).toBe(200);
    expect(nobody.body).toEqual({ mine: {} });
  });

  it('기기 id의 모양이 틀리면 받지 않고, 적지 않았으면 없는 주소로 답한다', async () => {
    const { call } = server();
    expect((await call('GET', '/api/rank?me=someone')).status).toBe(400);
    expect((await call('GET', '/api/rank?me=')).status).toBe(400);
    expect((await call('GET', `/api/rank?me=${device(1)}x`)).status).toBe(400);
    expect((await call('GET', '/api/rank')).status).toBe(404);
  });

  it('랭킹 보기와 같은 한도로 센다', async () => {
    const { call, wait } = server();
    const [limit, windowMs] = LIMITS.read;
    for (let n = 0; n < limit; n += 1) {
      expect((await call('GET', `/api/rank?me=${device(1)}`)).status).toBe(200);
    }
    const blocked = await call('GET', `/api/rank?me=${device(1)}`);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: 'slow' });
    // 한 게임의 랭킹 보기도 같이 막힌다.
    expect((await call('GET', '/api/rank/stack-tower')).status).toBe(429);
    // 다른 곳에서 온 요청은 막히지 않는다.
    expect((await call('GET', `/api/rank?me=${device(1)}`, undefined, '10.0.0.2')).status).toBe(200);
    wait(windowMs);
    expect((await call('GET', `/api/rank?me=${device(1)}`)).status).toBe(200);
  });
});

describe('주간 랭킹 요청', () => {
  /** 시험 서버의 시계(2027년 1월 15일 금요일)가 속한 주 */
  const WEEK = '2027-01-11';
  const DAY = 24 * 60 * 60 * 1000;

  it('이번 주의 점수를 같이 올리고, 이번 주 랭킹에서 본다', async () => {
    const { call } = server();
    const posted = await call('POST', '/api/rank', {
      device: device(1),
      name: '등불지기',
      scores: { 'lantern-keeper': 1200 },
      weekly: { week: WEEK, scores: { 'lantern-keeper': 800 } },
    });
    expect(posted.status).toBe(200);
    expect(posted.body).toEqual({ bests: { 'lantern-keeper': 1200 }, ranks: { 'lantern-keeper': 1 } });

    const week = await call('GET', `/api/rank/lantern-keeper?me=${device(1)}&span=week`);
    expect(week.status).toBe(200);
    expect(week.body).toEqual({
      top: [{ rank: 1, name: '등불지기', score: 800, mine: true }],
      me: { rank: 1, score: 800, name: '등불지기' },
      week: WEEK,
    });
    const all = await call('GET', '/api/rank/lantern-keeper?span=all');
    expect(all.body).toEqual({ top: [{ rank: 1, name: '등불지기', score: 1200, mine: false }], me: null });
  });

  it('서버의 이번 주와 다른 주의 점수는 버린다. 요청은 받아들인다', async () => {
    const { call } = server();
    const posted = await call('POST', '/api/rank', {
      device: device(1),
      name: '등불지기',
      scores: { 'stack-tower': 30 },
      weekly: { week: '2027-01-04', scores: { 'stack-tower': 30 } },
    });
    expect(posted.status).toBe(200);
    expect((await call('GET', '/api/rank/stack-tower?span=week')).body).toEqual({ top: [], me: null, week: WEEK });
    expect((await call('GET', '/api/rank/stack-tower')).body.top).toHaveLength(1);
  });

  it('월요일 0시(한국 시각)에 새 주가 시작된다', async () => {
    const { call, wait } = server();
    const submit = (week: string) =>
      call('POST', '/api/rank', {
        device: device(1),
        name: '등불지기',
        scores: {},
        weekly: { week, scores: { 'stack-tower': 30 } },
      });
    await submit(WEEK);
    // 금요일 17시(한국 시각)에서 사흘 뒤는 월요일 17시다.
    wait(3 * DAY);
    const next = await call('GET', `/api/rank/stack-tower?me=${device(1)}&span=week`);
    expect(next.body).toEqual({ top: [], me: null, week: '2027-01-18' });
    // 지난 주의 이름으로 늦게 온 점수는 새 주에 들어가지 않는다.
    await submit(WEEK);
    expect((await call('GET', '/api/rank/stack-tower?span=week')).body.top).toEqual([]);
    await submit('2027-01-18');
    expect((await call('GET', '/api/rank/stack-tower?span=week')).body.top).toHaveLength(1);
  });

  it('주간 랭킹을 모르는 옛 앱처럼 보내지 않아도 된다', async () => {
    const { call } = server();
    const posted = await call('POST', '/api/rank', {
      device: device(1),
      name: '등불지기',
      scores: { 'stack-tower': 30 },
    });
    expect(posted.status).toBe(200);
    expect((await call('GET', '/api/rank/stack-tower?span=week')).body.top).toEqual([]);
  });

  it('이번 주의 내 순위를 한 번에 받는다', async () => {
    const { call } = server();
    await call('POST', '/api/rank', {
      device: device(1),
      name: '등불지기',
      scores: { 'stack-tower': 90 },
      weekly: { week: WEEK, scores: { 'stack-tower': 30 } },
    });
    const mine = await call('GET', `/api/rank?me=${device(1)}&span=week`);
    expect(mine.status).toBe(200);
    expect(mine.body).toEqual({ mine: { 'stack-tower': { rank: 1, score: 30 } }, span: 'week' });
    const all = await call('GET', `/api/rank?me=${device(1)}`);
    expect(all.body).toEqual({ mine: { 'stack-tower': { rank: 1, score: 90 } } });
  });

  it('점수가 계속 쌓이는 게임(새싹 컴퍼니)은 주간 랭킹에 올리지 않는다. 요청은 받아들인다', async () => {
    const { call } = server();
    const posted = await call('POST', '/api/rank', {
      device: device(1),
      name: '등불지기',
      scores: { 'sprout-company': 400 },
      weekly: { week: WEEK, scores: { 'sprout-company': 400, 'stack-tower': 30 } },
    });
    expect(posted.status).toBe(200);
    expect((await call('GET', '/api/rank/sprout-company?span=week')).body.top).toEqual([]);
    expect((await call('GET', '/api/rank/sprout-company')).body.top).toHaveLength(1);
    expect((await call('GET', '/api/rank/stack-tower?span=week')).body.top).toHaveLength(1);
  });

  it('맞지 않는 값은 받지 않는다', async () => {
    const { call } = server();
    const base = { device: device(1), name: '등불지기', scores: {} };
    for (const weekly of [
      'x',
      [],
      { scores: { 'stack-tower': 3 } },
      { week: '이번 주', scores: {} },
      { week: WEEK, scores: { nope: 3 } },
      { week: WEEK, scores: { 'stack-tower': -1 } },
      { week: WEEK, scores: 'x' },
    ]) {
      expect((await call('POST', '/api/rank', { ...base, weekly })).status).toBe(400);
    }
    expect((await call('GET', '/api/rank/stack-tower?span=month')).status).toBe(400);
    expect((await call('GET', `/api/rank?me=${device(1)}&span=month`)).status).toBe(400);
  });

  it('기록을 지우면 주간 랭킹에서도 빠진다', async () => {
    const { call } = server();
    await call('POST', '/api/rank', {
      device: device(1),
      name: '등불지기',
      scores: { 'stack-tower': 90 },
      weekly: { week: WEEK, scores: { 'stack-tower': 30 } },
    });
    expect((await call('DELETE', '/api/rank', { device: device(1) })).status).toBe(200);
    expect((await call('GET', '/api/rank/stack-tower?span=week')).body.top).toEqual([]);
  });
});

describe('오늘의 랭킹 요청', () => {
  /** 시험 서버의 시계(2027년 1월 15일 17시, 한국 시각)가 속한 날 */
  const TODAY = rankDayOf(1_800_000_000_000);
  const HOUR = 60 * 60 * 1000;
  const submit = (
    call: ReturnType<typeof server>['call'],
    n: number,
    name: string,
    score: number,
    day = TODAY,
  ) =>
    call('POST', '/api/rank', {
      device: device(n),
      name,
      scores: {},
      daily: { day, scores: { 'lantern-keeper': score } },
    });

  it('오늘의 판 점수를 올리고, 오늘의 랭킹에서 본다. 다른 랭킹에는 들어가지 않는다', async () => {
    const { call } = server();
    const posted = await call('POST', '/api/rank', {
      device: device(1),
      name: '등불지기',
      scores: { 'lantern-keeper': 1200 },
      daily: { day: TODAY, scores: { 'lantern-keeper': 700 } },
    });
    expect(posted.status).toBe(200);
    expect(posted.body).toEqual({ bests: { 'lantern-keeper': 1200 }, ranks: { 'lantern-keeper': 1 } });
    await submit(call, 2, '종지기', 900);

    const today = await call('GET', `/api/daily/lantern-keeper?me=${device(1)}`);
    expect(today.status).toBe(200);
    expect(today.body).toEqual({
      top: [
        { rank: 1, name: '종지기', score: 900, mine: false },
        { rank: 2, name: '등불지기', score: 700, mine: true },
      ],
      me: { rank: 2, score: 700, name: '등불지기' },
      day: TODAY,
    });
    // 누구인지 밝히지 않고도 볼 수 있다.
    expect((await call('GET', '/api/daily/lantern-keeper')).body.me).toBeNull();
    // 오늘의 판에서만 낸 점수는 전체 랭킹과 이번 주 랭킹에 올라가지 않는다.
    expect((await call('GET', '/api/rank/lantern-keeper')).body.top).toHaveLength(1);
    expect((await call('GET', '/api/rank/lantern-keeper?span=week')).body.top).toEqual([]);
  });

  it('같은 날에는 더 높은 점수만 남고, 닉네임을 바꾸면 그날의 줄도 바뀐다', async () => {
    const { call } = server();
    await submit(call, 1, '등불지기', 700);
    await submit(call, 1, '등불지기', 300);
    expect((await call('GET', '/api/daily/lantern-keeper')).body.top).toEqual([
      { rank: 1, name: '등불지기', score: 700, mine: false },
    ]);
    await submit(call, 1, '새이름', 950);
    expect((await call('GET', '/api/daily/lantern-keeper')).body.top).toEqual([
      { rank: 1, name: '새이름', score: 950, mine: false },
    ]);
  });

  it('서버의 오늘과 다른 날의 점수는 버린다. 요청은 받아들인다', async () => {
    const { call } = server();
    for (const day of [TODAY - 1, TODAY + 1]) {
      expect((await submit(call, 1, '등불지기', 700, day)).status).toBe(200);
    }
    expect((await call('GET', '/api/daily/lantern-keeper')).body).toEqual({ top: [], me: null, day: TODAY });
  });

  it('0시(한국 시각)에 새 날이 시작되고, 지난 날의 기록은 보이지 않는다', async () => {
    const { call, wait } = server();
    await submit(call, 1, '등불지기', 700);
    // 17시에서 여섯 시간 뒤는 아직 같은 날 23시다.
    wait(6 * HOUR);
    expect((await call('GET', '/api/daily/lantern-keeper')).body.top).toHaveLength(1);
    wait(2 * HOUR);
    expect((await call('GET', `/api/daily/lantern-keeper?me=${device(1)}`)).body).toEqual({
      top: [],
      me: null,
      day: TODAY + 1,
    });
    // 어제의 날로 늦게 온 점수는 새 날에 들어가지 않는다.
    await submit(call, 1, '등불지기', 700);
    expect((await call('GET', '/api/daily/lantern-keeper')).body.top).toEqual([]);
    await submit(call, 2, '종지기', 400, TODAY + 1);
    expect((await call('GET', '/api/daily/lantern-keeper')).body.top).toHaveLength(1);
  });

  it('오늘의 랭킹을 모르는 옛 앱처럼 보내지 않아도 된다', async () => {
    const { call } = server();
    const posted = await call('POST', '/api/rank', {
      device: device(1),
      name: '등불지기',
      scores: { 'lantern-keeper': 30 },
    });
    expect(posted.status).toBe(200);
    expect((await call('GET', '/api/daily/lantern-keeper')).body.top).toEqual([]);
  });

  it('오늘의 판이 없는 게임의 점수는 올리지 않는다. 요청은 받아들인다', async () => {
    const { call } = server();
    const posted = await call('POST', '/api/rank', {
      device: device(1),
      name: '등불지기',
      scores: {},
      daily: { day: TODAY, scores: { 'stack-tower': 30, 'lantern-keeper': 500 } },
    });
    expect(posted.status).toBe(200);
    expect((await call('GET', '/api/daily/lantern-keeper')).body.top).toHaveLength(1);
    // 오늘의 랭킹이 없는 게임은 물어볼 수도 없다.
    expect((await call('GET', '/api/daily/stack-tower')).status).toBe(400);
    expect((await call('GET', '/api/daily/nope')).status).toBe(400);
  });

  it('맞지 않는 값은 받지 않는다', async () => {
    const { call } = server();
    const base = { device: device(1), name: '등불지기', scores: {} };
    for (const daily of [
      'x',
      [],
      { scores: { 'lantern-keeper': 3 } },
      { day: '오늘', scores: {} },
      { day: 1.5, scores: {} },
      { day: -3, scores: {} },
      { day: TODAY, scores: { nope: 3 } },
      { day: TODAY, scores: { 'lantern-keeper': -1 } },
      { day: TODAY, scores: 'x' },
    ]) {
      expect((await call('POST', '/api/rank', { ...base, daily })).status).toBe(400);
    }
    expect((await call('GET', '/api/daily/lantern-keeper?me=nope')).status).toBe(400);
    expect((await call('POST', '/api/daily/lantern-keeper', {})).status).toBe(404);
  });

  it('행운 슬롯의 오늘의 판 점수도 받는다. 게임마다 랭킹이 따로이고, 서버의 오늘과 다른 날의 점수는 버린다', async () => {
    const { call, wait } = server();
    const slot = (n: number, name: string, score: number, day: number) =>
      call('POST', '/api/rank', {
        device: device(n),
        name,
        scores: { 'candy-slot': score },
        daily: { day, scores: { 'candy-slot': score } },
      });
    expect((await slot(1, '행운이', 240, TODAY)).body).toEqual({
      bests: { 'candy-slot': 240 },
      ranks: { 'candy-slot': 1 },
    });
    await slot(2, '클로버', 310, TODAY);
    await submit(call, 3, '등불지기', 700);
    expect((await call('GET', `/api/daily/candy-slot?me=${device(1)}`)).body).toEqual({
      top: [
        { rank: 1, name: '클로버', score: 310, mine: false },
        { rank: 2, name: '행운이', score: 240, mine: true },
      ],
      me: { rank: 2, score: 240, name: '행운이' },
      day: TODAY,
    });
    // 등불지기의 오늘의 랭킹과는 섞이지 않는다.
    expect((await call('GET', '/api/daily/lantern-keeper')).body.top).toEqual([
      { rank: 1, name: '등불지기', score: 700, mine: false },
    ]);
    // 어제의 판이나 내일의 판(기기의 시계가 틀린 경우)의 점수는 오늘의 랭킹에 들어가지 않는다. 최고 기록은 그대로 받는다.
    for (const day of [TODAY - 1, TODAY + 1]) {
      const posted = await slot(4, '늦은이', 999, day);
      expect(posted.status).toBe(200);
      expect(posted.body.bests).toEqual({ 'candy-slot': 999 });
    }
    expect((await call('GET', `/api/daily/candy-slot?me=${device(4)}`)).body).toMatchObject({ me: null });
    expect((await call('GET', '/api/daily/candy-slot')).body.top).toHaveLength(2);
    // 한국 시각으로 0시가 지나면 새 날의 빈 랭킹이다. 어제의 날로 늦게 온 점수는 새 날에 들어가지 않는다.
    wait(8 * HOUR);
    expect((await call('GET', `/api/daily/candy-slot?me=${device(1)}`)).body).toEqual({
      top: [],
      me: null,
      day: TODAY + 1,
    });
    await slot(1, '행운이', 500, TODAY);
    expect((await call('GET', '/api/daily/candy-slot')).body.top).toEqual([]);
    await slot(1, '행운이', 120, TODAY + 1);
    expect((await call('GET', '/api/daily/candy-slot')).body.top).toEqual([
      { rank: 1, name: '행운이', score: 120, mine: false },
    ]);
  });

  it('기록을 지우면 오늘의 랭킹에서도 빠진다', async () => {
    const { call } = server();
    await submit(call, 1, '등불지기', 700);
    expect((await call('DELETE', '/api/rank', { device: device(1) })).status).toBe(200);
    expect((await call('GET', '/api/daily/lantern-keeper')).body.top).toEqual([]);
  });

  it('랭킹 보기와 같은 한도로 센다', async () => {
    const { call } = server();
    const [limit] = LIMITS.read;
    for (let i = 0; i < limit; i += 1) {
      expect((await call('GET', '/api/daily/lantern-keeper')).status).toBe(200);
    }
    expect((await call('GET', '/api/daily/lantern-keeper')).status).toBe(429);
  });
});

describe('점수 세는 법이 바뀐 게임의 점수', () => {
  /** server()의 시계가 가리키는 주 */
  const NOW_WEEK = rankWeekOf(1_800_000_000_000);

  it('지금 규칙으로 냈다고 밝힌 점수만 받는다. 업데이트하지 않은 앱이 보낸 옛 점수는 그 게임 것만 흘려보낸다', async () => {
    const { call } = server();
    // 옛 앱: 텃밭 지키기의 점수를 규칙 번호 없이 보낸다. 요청은 받아들이고 다른 게임의 점수는 올린다.
    const old = await call('POST', '/api/rank', {
      device: device(1),
      name: '옛앱',
      scores: { 'garden-guard': 5000, 'stack-tower': 40 },
      weekly: { week: NOW_WEEK, scores: { 'garden-guard': 5000, 'stack-tower': 40 } },
    });
    expect(old.status).toBe(200);
    expect(old.body).toEqual({ bests: { 'stack-tower': 40 }, ranks: { 'stack-tower': 1 } });
    expect((await call('GET', '/api/rank/garden-guard')).body.top).toEqual([]);
    expect((await call('GET', '/api/rank/garden-guard?span=week')).body.top).toEqual([]);
    expect((await call('GET', '/api/rank/stack-tower?span=week')).body.top).toHaveLength(1);

    // 새 앱: 규칙 번호를 같이 보낸다.
    const fresh = await call('POST', '/api/rank', {
      device: device(2),
      name: '새앱',
      scores: { 'garden-guard': 900 },
      weekly: { week: NOW_WEEK, scores: { 'garden-guard': 900 } },
      rules: { 'garden-guard': 2 },
    });
    expect(fresh.status).toBe(200);
    expect(fresh.body).toEqual({ bests: { 'garden-guard': 900 }, ranks: { 'garden-guard': 1 } });
    expect((await call('GET', '/api/rank/garden-guard')).body.top).toEqual([
      { rank: 1, name: '새앱', score: 900, mine: false },
    ]);
    expect((await call('GET', '/api/rank/garden-guard?span=week')).body.top).toHaveLength(1);
  });

  it('번호가 다르거나 모양이 이상해도 요청은 받아들이고 그 게임의 점수만 받지 않는다', async () => {
    const { call } = server();
    for (const rules of [{ 'garden-guard': 1 }, { 'garden-guard': '2' }, 'x', 7, null, ['garden-guard']]) {
      const posted = await call('POST', '/api/rank', {
        device: device(3),
        name: '이름',
        scores: { 'garden-guard': 5000 },
        rules,
      });
      expect(posted.status).toBe(200);
      expect(posted.body).toEqual({ bests: {}, ranks: {} });
    }
    expect((await call('GET', '/api/rank/garden-guard')).body.top).toEqual([]);
  });
});

describe('친구와 하는 방', () => {
  type Room = {
    code: string;
    seat: number;
    status: string;
    version: number;
    names: [string, string | null];
    wins: [number, number];
    game: { round: { turn: string; phase: string; hands: { me: number[]; cpu: number[] }; stock: number[] }; theirs: unknown[] } | null;
  };
  type Ticket = { token: string; room: Room };

  async function pair(call: ReturnType<typeof server>['call']) {
    const opened = await call('POST', '/api/room', { game: 'hula', name: '민수' });
    expect(opened.status).toBe(200);
    const host = opened.body as unknown as Ticket;
    const joined = await call('POST', '/api/room/join', { code: host.room.code.toLowerCase(), name: '지원' }, '10.0.0.2');
    expect(joined.status).toBe(200);
    const guest = joined.body as unknown as Ticket;
    return { code: host.room.code, host: host.token, guest: guest.token, hostRoom: host.room, guestRoom: guest.room };
  }

  it('방을 만들면 코드와 열쇠를 주고 친구를 기다린다', async () => {
    const { call } = server();
    const opened = await call('POST', '/api/room', { game: 'hula', name: '민수' });
    const ticket = opened.body as unknown as Ticket;
    expect(ticket.room.code).toMatch(/^[2-9A-HJ-NP-Z]{6}$/);
    expect(ticket.token).toMatch(/^[0-9a-f]{32}$/);
    expect(ticket.room).toMatchObject({ seat: 0, status: 'waiting', names: ['민수', null], game: null });
    expect((await call('POST', '/api/room', { game: 'chess', name: '민수' })).status).toBe(400);
    expect((await call('POST', '/api/room', { game: 'hula', name: 'x' })).status).toBe(400);
  });

  it('친구가 들어오면 판이 시작되고, 둘 다 자기 패만 본다', async () => {
    const { call } = server();
    const { code, host, guestRoom } = await pair(call);
    expect(guestRoom).toMatchObject({ seat: 1, status: 'playing', names: ['민수', '지원'] });
    const look = await call('POST', '/api/room/look', { code, token: host });
    const hostRoom = (look.body as { room: Room }).room;
    expect(hostRoom.seat).toBe(0);
    expect(hostRoom.game!.round.hands.cpu.every((card) => card === -1)).toBe(true);
    expect(guestRoom.game!.round.hands.cpu.every((card) => card === -1)).toBe(true);
    expect(hostRoom.game!.round.stock.every((card) => card === -1)).toBe(true);
    for (const card of hostRoom.game!.round.hands.me) expect(guestRoom.game!.round.hands.me).not.toContain(card);
    // 이미 둘이 찬 방에는 더 들어갈 수 없다.
    expect((await call('POST', '/api/room/join', { code, name: '셋째' }, '10.0.0.3')).status).toBe(404);
  });

  it('이미 본 번호로 물으면 방을 다시 싣지 않는다', async () => {
    const { call } = server();
    const { code, host, guestRoom } = await pair(call);
    const same = await call('POST', '/api/room/look', { code, token: host, version: guestRoom.version });
    expect(same.body).toEqual({ same: true, version: guestRoom.version });
  });

  it('차례인 자리만, 마지막으로 본 번호로만 둘 수 있다', async () => {
    const { call } = server();
    const { code, host, guest, guestRoom } = await pair(call);
    const hostTurn = guestRoom.game!.round.turn === 'cpu';
    const [mover, waiter] = hostTurn ? [host, guest] : [guest, host];
    const version = guestRoom.version;
    const wrong = await call('POST', '/api/room/move', { code, token: waiter, version, move: { type: 'draw' } });
    expect(wrong.status).toBe(200);
    expect((wrong.body as { ok: boolean }).ok).toBe(false);
    const stale = await call('POST', '/api/room/move', { code, token: mover, version: version - 1, move: { type: 'draw' } });
    expect((stale.body as { ok: boolean }).ok).toBe(false);
    const drew = await call('POST', '/api/room/move', { code, token: mover, version, move: { type: 'draw' } });
    expect(drew.body).toMatchObject({ ok: true, room: { version: version + 1 } });
    const again = await call('POST', '/api/room/move', { code, token: mover, version, move: { type: 'draw' } });
    expect((again.body as { ok: boolean }).ok).toBe(false);
    // 상대는 뽑은 것만 알고 무슨 카드인지는 모른다.
    const seen = await call('POST', '/api/room/look', { code, token: waiter });
    expect((seen.body as { room: Room }).room.game!.theirs).toEqual([{ type: 'draw' }]);
  });

  it('열쇠가 틀리면 방을 보여 주지 않는다', async () => {
    const { call } = server();
    const { code } = await pair(call);
    expect((await call('POST', '/api/room/look', { code, token: 'f'.repeat(32) })).status).toBe(404);
    expect((await call('POST', '/api/room/look', { code, token: 'nope' })).status).toBe(400);
    expect((await call('POST', '/api/room/look', { code: 'ZZZZZZ', token: 'f'.repeat(32) })).status).toBe(404);
  });

  it('나가면 친구에게 방이 닫혔다고 보이고, 판을 하던 중이면 친구가 이긴 것으로 친다', async () => {
    const { call } = server();
    const { code, host, guest } = await pair(call);
    expect((await call('POST', '/api/room/leave', { code, token: guest })).body).toEqual({ ok: true });
    const seen = (await call('POST', '/api/room/look', { code, token: host })).body as { room: Room & { left: number } };
    expect(seen.room).toMatchObject({ status: 'closed', left: 1, wins: [1, 0] });
  });

  it('친구가 앱을 닫으면 남은 사람에게 남은 시간을 보여 주고, 1분이 지나면 친구가 판을 버린 것으로 친다', async () => {
    const { call, wait } = server();
    const { code, host } = await pair(call);
    type Seen = { room: Room & { left: number | null; dropped: boolean; away: number | null } };
    const look = async (version?: number) => (await call('POST', '/api/room/look', { code, token: host, version })).body as Seen & { same?: true };
    // 앱을 잠깐 내려 둔 정도(20초 안)는 자리를 비운 것으로 보지 않는다.
    wait(15_000);
    expect((await look()).room.away).toBeNull();
    wait(10_000);
    const first = await look(0);
    expect(first.room).toMatchObject({ status: 'playing', left: null });
    expect(first.room.away).toBe(35_000);
    // 남은 시간이 바뀌므로 같은 번호로 물어도 방을 싣는다.
    const counting = await look(first.room.version);
    expect(counting.same).toBeUndefined();
    expect(counting.room.away).toBe(35_000);
    for (let i = 0; i < 17; i += 1) {
      wait(2_000);
      await look(first.room.version);
    }
    wait(2_000);
    const closed = await look(first.room.version);
    expect(closed.room).toMatchObject({ status: 'closed', left: 1, dropped: true, away: null, wins: [1, 0] });
  });

  it('친구가 시간 안에 돌아오면 판이 이어진다', async () => {
    const { call, wait } = server();
    const { code, host, guest } = await pair(call);
    for (let i = 0; i < 10; i += 1) {
      wait(4_000);
      await call('POST', '/api/room/look', { code, token: host });
    }
    const hostLook = (await call('POST', '/api/room/look', { code, token: host })).body as { room: Room & { away: number | null } };
    expect(hostLook.room.away).toBe(20_000);
    await call('POST', '/api/room/look', { code, token: guest });
    const back = (await call('POST', '/api/room/look', { code, token: host })).body as { room: Room & { away: number | null; status: string } };
    expect(back.room).toMatchObject({ status: 'playing', away: null });
  });

  it('친구가 자리를 비운 사이에 기다리다 나가면, 나간 사람이 아니라 자리를 비운 친구가 진다', async () => {
    const { call, wait } = server();
    const { code, host, guest } = await pair(call);
    for (let i = 0; i < 12; i += 1) {
      wait(2_000);
      await call('POST', '/api/room/look', { code, token: host });
    }
    expect((await call('POST', '/api/room/leave', { code, token: host })).body).toEqual({ ok: true });
    const seen = (await call('POST', '/api/room/look', { code, token: guest })).body as { room: Room & { left: number; dropped: boolean } };
    expect(seen.room).toMatchObject({ status: 'closed', left: 1, dropped: true, wins: [1, 0] });
  });

  it('둘 다 자리를 비웠다가 먼저 돌아온 사람이 바로 이기지는 않는다', async () => {
    const { call, wait } = server();
    const { code, host, guest } = await pair(call);
    wait(5 * 60 * 1000);
    const first = (await call('POST', '/api/room/look', { code, token: host })).body as { room: Room & { away: number | null } };
    expect(first.room).toMatchObject({ status: 'playing', away: 40_000 });
    wait(30_000);
    await call('POST', '/api/room/look', { code, token: guest });
    const after = (await call('POST', '/api/room/look', { code, token: host })).body as { room: Room & { away: number | null } };
    expect(after.room).toMatchObject({ status: 'playing', away: null });
  });

  it('30분 동안 아무도 두지 않으면 방이 사라진다', async () => {
    const { call, wait } = server();
    const { code, host } = await pair(call);
    wait(29 * 60 * 1000);
    expect((await call('POST', '/api/room/look', { code, token: host })).status).toBe(200);
    wait(2 * 60 * 1000);
    expect((await call('POST', '/api/room/look', { code, token: host })).status).toBe(404);
  });

  it('방을 너무 자주 만들면 잠깐 막는다', async () => {
    const { call } = server();
    const [limit] = LIMITS.roomOpen;
    for (let i = 0; i < limit; i += 1) expect((await call('POST', '/api/room', { game: 'hula', name: '민수' })).status).toBe(200);
    expect((await call('POST', '/api/room', { game: 'hula', name: '민수' })).status).toBe(429);
  });
});
