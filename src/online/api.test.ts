import { describe, expect, it } from 'vitest';
import { createApi, failureText, type ApiFailure } from './api';

interface Call {
  path: string;
  method: string;
  body: unknown;
}

function fakeServer(respond: (call: Call) => { status: number; body: string } | Error) {
  const calls: Call[] = [];
  const api = createApi(
    (path, init) => {
      const call = {
        path,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      };
      calls.push(call);
      const answer = respond(call);
      if (answer instanceof Error) return Promise.reject(answer);
      return Promise.resolve(new Response(answer.body, { status: answer.status }));
    },
    () => true,
  );
  return { api, calls };
}

const json = (body: unknown, status = 200) => ({ status, body: JSON.stringify(body) });
const ID = '01112131-4151-6171-8191-a1b1c1d1e1f1';

describe('서버 부르기', () => {
  it('랭킹을 받아 온다. 내 id는 주소에 실어 보낸다', async () => {
    const board = { top: [{ rank: 1, name: '하나', score: 5, mine: true }], me: { rank: 1, score: 5, name: '하나' } };
    const { api, calls } = fakeServer(() => json(board));
    expect(await api.board('stack-tower', ID)).toEqual({ ok: true, data: board });
    expect(calls[0]).toEqual({ path: `/api/rank/stack-tower?me=${ID}`, method: 'GET', body: undefined });
    await api.board('stack-tower', null);
    expect(calls[1].path).toBe('/api/rank/stack-tower');
  });

  it('이번 주 랭킹은 범위를 주소에 적어 받아 온다. 주가 적혀 있지 않은 답은 쓰지 않는다', async () => {
    const board = { top: [{ rank: 1, name: '하나', score: 5, mine: true }], me: { rank: 1, score: 5, name: '하나' } };
    const { api, calls } = fakeServer(() => json({ ...board, week: '2026-11-09' }));
    expect(await api.board('stack-tower', ID, 'week')).toEqual({
      ok: true,
      data: { ...board, week: '2026-11-09' },
    });
    expect(calls[0].path).toBe(`/api/rank/stack-tower?me=${ID}&span=week`);
    await api.board('stack-tower', null, 'week');
    expect(calls[1].path).toBe('/api/rank/stack-tower?span=week');
    await api.board('stack-tower', ID, 'all');
    expect(calls[2].path).toBe(`/api/rank/stack-tower?me=${ID}`);
    // 주간 랭킹을 모르는 예전 서버는 범위를 못 알아듣고 전체 랭킹을 돌려준다. 그것을 이번 주 랭킹으로 보여 주면 안 된다.
    const old = fakeServer(() => json(board));
    expect(await old.api.board('stack-tower', ID, 'week')).toEqual({ ok: false, reason: 'offline' });
  });

  it('이번 주의 내 순위도 범위를 적어 받아 온다', async () => {
    const mine = { 'stack-tower': { rank: 2, score: 70 } };
    const { api, calls } = fakeServer(() => json({ mine, span: 'week' }));
    expect(await api.standings(ID, 'week')).toEqual({ ok: true, data: mine });
    expect(calls[0].path).toBe(`/api/rank?me=${ID}&span=week`);
    const old = fakeServer(() => json({ mine }));
    expect(await old.api.standings(ID, 'week')).toEqual({ ok: false, reason: 'offline' });
  });

  it('모든 게임의 내 순위를 한 번에 받아 온다', async () => {
    const mine = { 'stack-tower': { rank: 2, score: 70 }, 'merge-tiles': { rank: 501, score: 4 } };
    const { api, calls } = fakeServer(() => json({ mine }));
    expect(await api.standings(ID)).toEqual({ ok: true, data: mine });
    expect(calls[0]).toEqual({ path: `/api/rank?me=${ID}`, method: 'GET', body: undefined });

    const empty = fakeServer(() => json({ mine: {} }));
    expect(await empty.api.standings(ID)).toEqual({ ok: true, data: {} });
    // 이 응답을 모르는 예전 서버는 "찾을 수 없음"으로 답한다.
    const old = fakeServer(() => json({ error: 'notfound' }, 404));
    expect(await old.api.standings(ID)).toEqual({ ok: false, reason: 'notfound' });
    // 모양이 틀린 답은 쓰지 않는다.
    for (const body of [{}, { mine: null }, { mine: { 'stack-tower': { rank: 'x', score: 1 } } }, { mine: { a: 3 } }]) {
      const broken = fakeServer(() => json(body));
      expect(await broken.api.standings(ID)).toEqual({ ok: false, reason: 'offline' });
    }
  });

  it('점수 올리기, 기록 지우기, 세이브 맡기기와 꺼내기를 알맞은 곳으로 보낸다', async () => {
    const { api, calls } = fakeServer((call) => {
      if (call.method === 'DELETE') return json({ ok: true });
      if (call.path === '/api/rank') return json({ bests: { 'stack-tower': 9 }, ranks: { 'stack-tower': 2 } });
      if (call.path === '/api/transfer') return json({ code: 'ABCDEFGH', expiresAt: 5 });
      return json({ bundle: '{}' });
    });
    const request = { device: ID, name: '하나', scores: { 'stack-tower': 9 } };
    expect(await api.submit(request)).toEqual({
      ok: true,
      data: { bests: { 'stack-tower': 9 }, ranks: { 'stack-tower': 2 } },
    });
    expect(await api.forget(ID)).toEqual({ ok: true, data: true });
    expect(await api.stash('{"a":1}')).toEqual({ ok: true, data: { code: 'ABCDEFGH', expiresAt: 5 } });
    expect(await api.take('ABCDEFGH')).toEqual({ ok: true, data: '{}' });
    expect(calls.map((call) => [call.method, call.path, call.body])).toEqual([
      ['POST', '/api/rank', request],
      ['DELETE', '/api/rank', { device: ID }],
      ['POST', '/api/transfer', { bundle: '{"a":1}' }],
      ['POST', '/api/transfer/take', { code: 'ABCDEFGH' }],
    ]);
  });

  it('서버가 알려 준 이유를 그대로 돌려준다', async () => {
    for (const [status, reason] of [
      [400, 'invalid'],
      [404, 'notfound'],
      [429, 'slow'],
      [503, 'busy'],
    ] as const) {
      const { api } = fakeServer(() => json({ error: reason }, status));
      expect(await api.take('ABCDEFGH')).toEqual({ ok: false, reason });
    }
  });

  it('닿지 못했거나 알 수 없는 답이면 오프라인으로 친다', async () => {
    const cases = [
      () => new TypeError('Failed to fetch'),
      // 서버 코드 없이 파일만 올린 곳에서는 HTML로 된 404가 온다.
      () => ({ status: 404, body: '<!doctype html><title>Not found</title>' }),
      () => ({ status: 200, body: '<!doctype html>' }),
      () => json({ unexpected: true }),
      () => json({ error: 'something-new' }, 500),
      () => json({ top: [{ rank: 'x' }], me: null }),
    ];
    for (const respond of cases) {
      const { api } = fakeServer(respond);
      expect(await api.board('stack-tower', null)).toEqual({ ok: false, reason: 'offline' });
    }
  });

  it('인터넷이 끊겨 있으면 부르지도 않는다', async () => {
    let called = 0;
    const api = createApi(
      () => {
        called += 1;
        return Promise.resolve(new Response('{}'));
      },
      () => false,
    );
    expect(await api.submit({ device: ID, name: '하나', scores: {} })).toEqual({ ok: false, reason: 'offline' });
    expect(called).toBe(0);
  });

  it('실패한 이유마다 보여 줄 문구가 있다', () => {
    const reasons: ApiFailure[] = ['offline', 'invalid', 'notfound', 'slow', 'busy'];
    const texts = reasons.map(failureText);
    expect(new Set(texts).size).toBe(reasons.length);
    for (const text of texts) expect(text.length).toBeGreaterThan(5);
  });
});
