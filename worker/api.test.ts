import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { MAX_BUNDLE_CHARS, TRANSFER_TTL_MS } from '../src/online/protocol';
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
