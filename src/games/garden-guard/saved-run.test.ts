import { describe, expect, it } from 'vitest';
import { createMeta } from './rules';
import { readRunRecord, RUN_VERSION, runRecord, settleSavedRun, type SavedRun } from './saved-run';
import { createRun, step, type RunState } from './sim';

const STEP = 1 / 60;
const T = 1_700_000_000_000;

/** 벌레와 물방울이 판에 있는 한창인 판. 날을 지키면 내놓는 강화는 맨 앞의 것을 고른다. */
function busyRun(seconds = 25): RunState {
  const { state } = createRun({ seed: 42, startDay: 4, levels: { power: 6, rapid: 3, helper: 1, splash: 1 }, bestBefore: 3 });
  for (let t = 0; t < seconds; t += STEP) step(state, STEP, { aim: null, storm: false, pick: 0 });
  return state;
}

/** 날을 막 지켜서 강화 셋을 내놓고 고르기를 기다리는 판 */
function waitingRun(): RunState {
  const { state } = createRun({ seed: 42, startDay: 4, levels: { power: 6, rapid: 3, helper: 1, splash: 1 }, bestBefore: 3 });
  for (let t = 0; t < 120 && state.offer.length === 0; t += STEP) step(state, STEP);
  return state;
}

/** 기기에 적었다가 읽은 것처럼 JSON을 한 번 거친다. */
const throughDisk = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe('하던 판의 저장', () => {
  it('한창인 판을 적었다가 읽으면 그대로다', () => {
    const state = busyRun();
    expect(state.enemies.length).toBeGreaterThan(0);
    expect(state.shots.length).toBeGreaterThan(0);
    const saved: SavedRun = { state, banked: 7 };
    expect(readRunRecord(throughDisk(runRecord(saved, T)))).toEqual({ savedAt: T, run: saved });
  });

  it('읽은 판을 이어 하면 멈추지 않고 한 판과 똑같이 흘러간다', () => {
    const original = busyRun();
    const restored = readRunRecord(throughDisk(runRecord({ state: original, banked: 0 }, T))).run!.state;
    for (let t = 0; t < 30; t += STEP) {
      step(original, STEP, { aim: { x: 40, y: 60 }, storm: true, pick: 1 });
      step(restored, STEP, { aim: { x: 40, y: 60 }, storm: true, pick: 1 });
    }
    expect(restored).toEqual(original);
    expect(original.t).toBeGreaterThan(40);
    expect(original.boons.length).toBeGreaterThan(0);
  });

  it('강화를 고르기를 기다리던 판은 읽어도 같은 셋을 내놓고, 고른 강화도 그대로다', () => {
    const state = waitingRun();
    expect(state.offer).toHaveLength(3);
    const restored = readRunRecord(throughDisk(runRecord({ state, banked: 0 }, T))).run!.state;
    expect(restored.offer).toEqual(state.offer);
    step(restored, STEP, { aim: null, storm: false, pick: 2 });
    expect(restored.boons).toEqual([state.offer[2]]);
    expect(readRunRecord(throughDisk(runRecord({ state: restored, banked: 0 }, T))).run!.state.boons).toEqual(restored.boons);
  });

  it('이어 할 판이 없다고 적은 것은 없는 것으로 읽는다', () => {
    expect(readRunRecord(throughDisk(runRecord(null, T)))).toEqual({ savedAt: T, run: null });
    expect(readRunRecord(undefined)).toEqual({ savedAt: 0, run: null });
  });

  it('망가졌거나 다른 버전이 적은 판은 버리고, 적은 때는 남긴다', () => {
    const good = throughDisk(runRecord({ state: busyRun(5), banked: 3 }, T)) as {
      version: number;
      run: { state: Record<string, unknown>; banked: number };
    };
    const broken = (change: (record: typeof good) => void): unknown => {
      const copy = structuredClone(good);
      change(copy);
      return copy;
    };
    const cases = [
      broken((record) => (record.version = RUN_VERSION + 1)),
      broken((record) => delete record.run.state.fence),
      broken((record) => (record.run.state.day = 'seven')),
      broken((record) => (record.run.state.phase = 'over')),
      broken((record) => ((record.run.state.stats as Record<string, unknown>).damage = null)),
      broken((record) => ((record.run.state.queue as { kind: string }[])[0].kind = 'dragon')),
      broken((record) => (record.run.state.helperIn = ['soon'])),
      broken((record) => (record.run.state.boons = ['jet', 'wings'])),
      broken((record) => (record.run.state.offer = [3])),
      broken((record) => delete record.run.state.offer),
      broken((record) => (record.run.state = [] as unknown as Record<string, unknown>)),
    ];
    for (const raw of cases) expect(readRunRecord(raw)).toEqual({ savedAt: T, run: null });
    // 넣어 둔 씨앗의 양만 이상하면 판은 살리고 0으로 친다.
    expect(readRunRecord(broken((record) => (record.run.banked = -4))).run?.banked).toBe(0);
  });

  it('이어 하지 않기로 한 판은 남은 씨앗을 넣고 판 수와 벌레 수를 더한다', () => {
    const state = { ...busyRun(5), seeds: 130.6, kills: 40, lastCleared: 6 };
    const meta = { ...createMeta(), seeds: 90, best: 6, runs: 2, kills: 100, startDay: 6 };
    const settled = settleSavedRun(meta, { state, banked: 100 });
    expect(settled).toMatchObject({ seeds: 120, runs: 3, kills: 140, best: 6, startDay: 6 });
  });
});
