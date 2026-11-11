import { describe, expect, it } from 'vitest';
import { createDefaultSave, type SaveData } from '../core/save';
import type { ApiResult } from './api';
import type { SubmitRequest, SubmitResult } from './protocol';
import { ScoreSync } from './sync';

const ID = '01112131-4151-6171-8191-a1b1c1d1e1f1';

type Answer = ApiResult<SubmitResult>;

/** 가짜 세이브와 가짜 서버. 서버의 답은 부를 때마다 하나씩 꺼내 쓰고, 직접 풀어 줄 때까지 기다리게 할 수도 있다. */
function setup(answers: Array<Answer | 'wait'>) {
  let save: SaveData = createDefaultSave(1000);
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
      save.online = { id: ID, name, sentName: null, sent: {} };
    },
    best(game: string, best: number) {
      save.games[game] = { best, plays: 1, lastPlayedAt: 1000 };
    },
    release(answer: Answer) {
      waiting.shift()?.(answer);
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
      save.online = { id: null, name: null, sentName: null, sent: {} };
    });
    t.release(ok({ 'stack-tower': 90 }, { 'stack-tower': 2 }));
    await running;
    expect(t.save.online).toEqual({ id: null, name: null, sentName: null, sent: {} });
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
