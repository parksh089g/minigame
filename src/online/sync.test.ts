import { describe, expect, it } from 'vitest';
import { createDefaultSave, type SaveData } from '../core/save';
import type { ApiResult } from './api';
import { withDayScore, withWeekScore } from './profile';
import { rankDayOf, rankWeekOf, type SubmitRequest, type SubmitResult } from './protocol';
import { ScoreSync } from './sync';

const ID = '01112131-4151-6171-8191-a1b1c1d1e1f1';

/** 한국 시각으로 2026년 11월 12일 목요일 15시. 이 주의 이름은 2026-11-09다. */
const THURSDAY = Date.parse('2026-11-12T15:00:00+09:00');
const WEEK = '2026-11-09';
const DAY = 24 * 60 * 60 * 1000;

type Answer = ApiResult<SubmitResult>;

/** 가짜 세이브와 가짜 서버. 서버의 답은 부를 때마다 하나씩 꺼내 쓰고, 직접 풀어 줄 때까지 기다리게 할 수도 있다. */
function setup(answers: Array<Answer | 'wait'>) {
  let save: SaveData = createDefaultSave(1000);
  let now = THURSDAY;
  const requests: SubmitRequest[] = [];
  const waiting: Array<(answer: Answer) => void> = [];
  const sync = new ScoreSync({
    read: () => save,
    write: (mutate) => {
      const next = structuredClone(save);
      mutate(next);
      save = next;
    },
    submit: (request) => {
      requests.push(request);
      const answer = answers.shift() ?? { ok: false, reason: 'offline' };
      if (answer !== 'wait') return Promise.resolve(answer);
      return new Promise<Answer>((resolve) => waiting.push(resolve));
    },
    now: () => now,
  });
  return {
    sync,
    requests,
    get save() {
      return save;
    },
    edit(mutate: (save: SaveData) => void) {
      mutate(save);
    },
    join(name = '등불지기') {
      save.online = { id: ID, name, sentName: null, sent: {}, week: null, day: null };
    },
    best(game: string, best: number) {
      save.games[game] = { best, plays: 1, lastPlayedAt: 1000 };
    },
    release(answer: Answer) {
      waiting.shift()?.(answer);
    },
    /** 이번 주(now가 속한 주)에 낸 점수를 적는다 */
    weekBest(game: string, score: number) {
      save.online = withWeekScore(save.online, game, score, rankWeekOf(now));
    },
    /** 오늘(now가 속한 날)의 판에서 낸 점수를 적는다 */
    dayBest(game: string, score: number) {
      save.online = withDayScore(save.online, game, score, rankDayOf(now));
    },
    wait(ms: number) {
      now += ms;
    },
  };
}

const ok = (bests: Record<string, number>, ranks: Record<string, number>): Answer => ({
  ok: true,
  data: { bests, ranks },
});

describe('기록 올리기', () => {
  it('닉네임을 정하기 전에는 서버를 부르지 않는다', async () => {
    const t = setup([]);
    t.best('stack-tower', 90);
    expect(await t.sync.run()).toEqual({ status: 'off' });
    expect(t.requests).toHaveLength(0);
  });

  it('올린 뒤에는 올린 것을 적어 두고 순위를 기억한다', async () => {
    const t = setup([ok({ 'stack-tower': 90 }, { 'stack-tower': 4 })]);
    t.join();
    t.best('stack-tower', 90);
    expect(await t.sync.run()).toEqual({ status: 'sent', ranks: { 'stack-tower': 4 } });
    expect(t.requests).toEqual([{ device: ID, name: '등불지기', scores: { 'stack-tower': 90 } }]);
    expect(t.save.online.sent).toEqual({ 'stack-tower': 90 });
    expect(t.save.online.sentName).toBe('등불지기');
    expect(t.sync.rankOf('stack-tower')).toBe(4);
    expect(t.sync.rankOf('gate-run')).toBeNull();
  });

  it('다 올렸으면 다시 부르지 않는다', async () => {
    const t = setup([ok({ 'stack-tower': 90 }, { 'stack-tower': 4 })]);
    t.join();
    t.best('stack-tower', 90);
    await t.sync.run();
    expect(await t.sync.run()).toEqual({ status: 'idle' });
    expect(t.requests).toHaveLength(1);
  });

  it('실패하면 아무것도 적지 않아서, 다음에 같은 것을 다시 보낸다', async () => {
    const t = setup([{ ok: false, reason: 'offline' }, ok({ 'stack-tower': 90 }, { 'stack-tower': 1 })]);
    t.join();
    t.best('stack-tower', 90);
    expect(await t.sync.run()).toEqual({ status: 'failed', reason: 'offline' });
    expect(t.save.online.sent).toEqual({});
    expect(t.sync.rankOf('stack-tower')).toBeNull();
    expect(await t.sync.run()).toEqual({ status: 'sent', ranks: { 'stack-tower': 1 } });
    expect(t.requests[1]).toEqual(t.requests[0]);
  });

  it('보내는 중에 또 부르면 같은 결과를 같이 기다린다', async () => {
    const t = setup(['wait']);
    t.join();
    t.best('stack-tower', 90);
    const first = t.sync.run();
    const second = t.sync.run();
    await Promise.resolve();
    t.release(ok({ 'stack-tower': 90 }, { 'stack-tower': 2 }));
    expect(await first).toEqual(await second);
    expect(t.requests).toHaveLength(1);
  });

  it('보내는 중에 더 높은 기록이 생기면 그 기록은 다음에 올라간다', async () => {
    const t = setup(['wait', ok({ 'stack-tower': 120 }, { 'stack-tower': 1 })]);
    t.join();
    t.best('stack-tower', 90);
    const running = t.sync.run();
    await Promise.resolve();
    t.best('stack-tower', 120);
    t.release(ok({ 'stack-tower': 90 }, { 'stack-tower': 2 }));
    await running;
    expect(t.save.online.sent).toEqual({ 'stack-tower': 90 });
    expect(await t.sync.run()).toEqual({ status: 'sent', ranks: { 'stack-tower': 1 } });
    expect(t.requests[1].scores).toEqual({ 'stack-tower': 120 });
  });

  it('보내는 중에 랭킹에서 빠지면 답이 와도 적지 않는다', async () => {
    const t = setup(['wait']);
    t.join();
    t.best('stack-tower', 90);
    const running = t.sync.run();
    await Promise.resolve();
    t.edit((save) => {
      save.online = { id: null, name: null, sentName: null, sent: {}, week: null, day: null };
    });
    t.release(ok({ 'stack-tower': 90 }, { 'stack-tower': 2 }));
    await running;
    expect(t.save.online).toEqual({ id: null, name: null, sentName: null, sent: {}, week: null, day: null });
    expect(t.sync.rankOf('stack-tower')).toBeNull();
  });

  it('직접 알게 된 순위를 적고 잊을 수 있다', () => {
    const t = setup([]);
    t.sync.noteRank('gate-run', 7);
    expect(t.sync.rankOf('gate-run')).toBe(7);
    t.sync.noteRank('gate-run', null);
    expect(t.sync.rankOf('gate-run')).toBeNull();
    t.sync.noteRank('gate-run', 3);
    t.sync.forgetRanks();
    expect(t.sync.rankOf('gate-run')).toBeNull();
  });
});

describe('이번 주 기록 올리기', () => {
  it('이번 주에 낸 점수를 최고 점수와 함께 올리고, 올린 것을 적어 둔다', async () => {
    const t = setup([ok({ 'stack-tower': 90 }, { 'stack-tower': 4 })]);
    t.join();
    t.best('stack-tower', 90);
    t.weekBest('stack-tower', 55);
    expect((await t.sync.run()).status).toBe('sent');
    expect(t.requests).toEqual([
      {
        device: ID,
        name: '등불지기',
        scores: { 'stack-tower': 90 },
        weekly: { week: WEEK, scores: { 'stack-tower': 55 } },
      },
    ]);
    expect(t.save.online.week).toEqual({ key: WEEK, bests: { 'stack-tower': 55 }, sent: { 'stack-tower': 55 } });
    expect(await t.sync.run()).toEqual({ status: 'idle' });
  });

  it('최고 기록은 그대로여도 이번 주 기록이 오르면 올린다', async () => {
    const t = setup([ok({ 'stack-tower': 90 }, { 'stack-tower': 4 }), ok({}, {})]);
    t.join();
    t.best('stack-tower', 90);
    await t.sync.run();
    t.weekBest('stack-tower', 60);
    expect((await t.sync.run()).status).toBe('sent');
    expect(t.requests[1]).toEqual({
      device: ID,
      name: '등불지기',
      scores: {},
      weekly: { week: WEEK, scores: { 'stack-tower': 60 } },
    });
  });

  it('올리지 못한 채로 주가 바뀌면 지난 주의 점수는 보내지 않는다', async () => {
    const t = setup([{ ok: false, reason: 'offline' }, ok({ 'stack-tower': 90 }, { 'stack-tower': 4 })]);
    t.join();
    t.best('stack-tower', 90);
    t.weekBest('stack-tower', 55);
    expect((await t.sync.run()).status).toBe('failed');
    t.wait(7 * DAY);
    expect((await t.sync.run()).status).toBe('sent');
    expect(t.requests[1]).toEqual({ device: ID, name: '등불지기', scores: { 'stack-tower': 90 } });
  });

  it('닉네임을 정하기 전에 낸 이번 주의 점수는 참여할 때 같이 올라간다', async () => {
    const t = setup([ok({ 'stack-tower': 90 }, { 'stack-tower': 1 })]);
    t.best('stack-tower', 90);
    t.weekBest('stack-tower', 55);
    expect(await t.sync.run()).toEqual({ status: 'off' });
    t.edit((save) => {
      save.online = { ...save.online, id: ID, name: '등불지기' };
    });
    await t.sync.run();
    expect(t.requests[0].weekly).toEqual({ week: WEEK, scores: { 'stack-tower': 55 } });
  });
});

describe('오늘의 판 기록 올리기', () => {
  const TODAY = rankDayOf(THURSDAY);
  const GAME = 'lantern-keeper';

  it('오늘의 판에서 낸 점수를 다른 기록과 함께 올리고, 올린 것을 적어 둔다', async () => {
    const t = setup([ok({ [GAME]: 1200 }, { [GAME]: 4 })]);
    t.join();
    t.best(GAME, 1200);
    t.weekBest(GAME, 1200);
    t.dayBest(GAME, 700);
    expect((await t.sync.run()).status).toBe('sent');
    expect(t.requests).toEqual([
      {
        device: ID,
        name: '등불지기',
        scores: { [GAME]: 1200 },
        weekly: { week: WEEK, scores: { [GAME]: 1200 } },
        daily: { day: TODAY, scores: { [GAME]: 700 } },
      },
    ]);
    expect(t.save.online.day).toEqual({ key: TODAY, bests: { [GAME]: 700 }, sent: { [GAME]: 700 } });
    expect(await t.sync.run()).toEqual({ status: 'idle' });
  });

  it('오늘의 기록만 올라도 올린다', async () => {
    const t = setup([ok({}, {}), ok({}, {})]);
    t.join();
    await t.sync.run();
    t.dayBest(GAME, 700);
    expect((await t.sync.run()).status).toBe('sent');
    expect(t.requests[1]).toEqual({
      device: ID,
      name: '등불지기',
      scores: {},
      daily: { day: TODAY, scores: { [GAME]: 700 } },
    });
  });

  it('올리지 못한 채로 날이 바뀌면 어제의 점수는 보내지 않는다', async () => {
    const t = setup([{ ok: false, reason: 'offline' }, ok({}, {})]);
    t.join();
    t.edit((save) => {
      save.online = { ...save.online, sentName: '등불지기' };
    });
    t.dayBest(GAME, 700);
    expect((await t.sync.run()).status).toBe('failed');
    t.wait(DAY);
    expect(await t.sync.run()).toEqual({ status: 'idle' });
    expect(t.requests).toHaveLength(1);
  });

  it('닉네임을 정하기 전에 낸 오늘의 점수는 참여할 때 같이 올라간다', async () => {
    const t = setup([ok({}, {})]);
    t.dayBest(GAME, 700);
    expect(await t.sync.run()).toEqual({ status: 'off' });
    t.edit((save) => {
      save.online = { ...save.online, id: ID, name: '등불지기' };
    });
    await t.sync.run();
    expect(t.requests[0].daily).toEqual({ day: TODAY, scores: { [GAME]: 700 } });
  });
});
