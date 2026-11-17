import { describe, expect, it } from 'vitest';
import { playCareer } from './bot';
import { createMeta } from './rules';
import { readRunRecord, RUN_VERSION, runRecord, settleSavedRun, type SavedRun } from './saved-run';
import { botInput, botShop } from './bot';
import { SHOP } from './data';
import { toVersion3 } from './legacy-run.testutil';
import { createRun, runScore, skipShop, step, type RunState } from './sim';

const STEP = 1 / 60;
const T = 1_700_000_000_000;

/** 벌레와 물방울이 판에 있는 한창인 판. 가게가 열리면 살 수 있는 것을 다 사고 다음 날로 간다(자동 플레이). */
function busyRun(seconds = 25): RunState {
  const { state } = createRun({ seed: 42, startDay: 4, levels: { power: 6, rapid: 3, helper: 1, splash: 1 }, bestBefore: 3 });
  for (let t = 0; t < seconds; t += STEP) step(state, STEP, { aim: null, storm: false, ...botShop(state) });
  return state;
}

/** 날을 막 지켜서 동료 가게가 열려 있는 판 */
function shoppingRun(): RunState {
  const { state } = createRun({ seed: 42, startDay: 4, levels: { power: 6, rapid: 3, helper: 1, splash: 1 }, bestBefore: 3 });
  skipShop(state);
  for (let t = 0; t < 120 && !state.shopping; t += STEP) step(state, STEP);
  return state;
}

/** 기기에 적었다가 읽은 것처럼 JSON을 한 번 거친다. */
const throughDisk = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe('하던 판의 저장', () => {
  it('한창인 판을 적었다가 읽으면 그대로다', () => {
    const state = busyRun();
    expect(state.enemies.length).toBeGreaterThan(0);
    expect(state.shots.length).toBeGreaterThan(0);
    const saved: SavedRun = { state, banked: 7, bankedShards: 0 };
    expect(readRunRecord(throughDisk(runRecord(saved, T)))).toEqual({ savedAt: T, run: saved });
  });

  it('읽은 판을 이어 하면 멈추지 않고 한 판과 똑같이 흘러간다', () => {
    const original = busyRun();
    const restored = readRunRecord(throughDisk(runRecord({ state: original, banked: 0, bankedShards: 0 }, T))).run!.state;
    for (let t = 0; t < 30; t += STEP) {
      step(original, STEP, { aim: { x: 40, y: 60 }, storm: true, ...botShop(original) });
      step(restored, STEP, { aim: { x: 40, y: 60 }, storm: true, ...botShop(restored) });
    }
    expect(restored).toEqual(original);
    expect(original.t).toBeGreaterThan(40);
    expect(original.allies.length).toBeGreaterThan(0);
  });

  it('가게가 열려 있던 판은 읽어도 같은 카드와 열매가 있고, 산 동료도 그대로다', () => {
    const state = shoppingRun();
    expect(state.shop).toHaveLength(SHOP.cards);
    const restored = readRunRecord(throughDisk(runRecord({ state, banked: 0, bankedShards: 0 }, T))).run!.state;
    expect(restored.shop).toEqual(state.shop);
    expect(restored.fruit).toBe(state.fruit);
    step(restored, STEP, { aim: null, storm: false, buy: 2 });
    expect(restored.shop[2].sold).toBe(true);
    const again = readRunRecord(throughDisk(runRecord({ state: restored, banked: 0, bankedShards: 0 }, T))).run!.state;
    expect(again.allies).toEqual(restored.allies);
    expect(again.shop).toEqual(restored.shop);
    expect(again.fruit).toBe(restored.fruit);
  });

  it('동료가 생기기 전(버전 3)에 적은 판은 해바라기를 동료로 옮기고, 고르던 강화 대신 가게를 열어 이어 한다', () => {
    const { state } = createRun({ seed: 42, startDay: 4, levels: { power: 6, rapid: 3 }, bestBefore: 3 });
    skipShop(state);
    for (let t = 0; t < 8; t += STEP) step(state, STEP);
    expect(state.phase).toBe('fight');
    const old = (state3: Record<string, unknown>) => ({ version: 3, savedAt: T, run: { state: state3, banked: 4, bankedShards: 0 } });
    // 해바라기 둘과 거름 2단계를 가진 판
    const read = readRunRecord(old(toVersion3(state, { helpers: 2, compost: 2, boons: ['jet', 'bloom'] }))).run!;
    expect(read.banked).toBe(4);
    expect(read.state.allies).toEqual([{ id: 'sunflower', copies: 2, fireIn: 0.3 }]);
    expect(read.state.stats.allyPower).toBeCloseTo(1.3);
    expect(read.state.fruit).toBe(SHOP.purse);
    expect(read.state.shopping).toBe(false);
    // 물방울과 벌레, 지킨 날은 그대로다.
    expect(read.state.shots).toEqual(state.shots);
    expect(read.state.enemies).toEqual(state.enemies);
    expect(read.state.day).toBe(state.day);
    // 이어 하면 멈추지 않고 흘러간다.
    for (let t = 0; t < 30 && read.state.phase !== 'over'; t += STEP) step(read.state, STEP, botInput(read.state, 'active'));
    expect(read.state.t).toBeGreaterThan(state.t + 20);
    // 날을 지키고 강화를 고르기를 기다리던 판은 가게를 열어 둔다.
    const waiting = shoppingRun();
    const choosing = readRunRecord(old(toVersion3({ ...waiting, shopping: false, shop: [] }, { offer: ['jet', 'quick', 'sack'] }))).run!;
    expect(choosing.state.shopping).toBe(true);
    expect(choosing.state.shop).toHaveLength(SHOP.cards);
    step(choosing.state, STEP, { aim: null, storm: false, ready: true });
    expect(choosing.state.shopping).toBe(false);
  });

  it('이어 할 판이 없다고 적은 것은 없는 것으로 읽는다', () => {
    expect(readRunRecord(throughDisk(runRecord(null, T)))).toEqual({ savedAt: T, run: null });
    expect(readRunRecord(undefined)).toEqual({ savedAt: 0, run: null });
  });

  it('망가졌거나 다른 버전이 적은 판은 버리고, 적은 때는 남긴다', () => {
    const good = throughDisk(runRecord({ state: busyRun(5), banked: 3, bankedShards: 0 }, T)) as {
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
      broken((record) => (record.run.state.allies = [{ id: 'dragon', copies: 1, fireIn: 0 }])),
      broken((record) => (record.run.state.allies = [{ id: 'frog', copies: 1, fireIn: 0 }, { id: 'frog', copies: 1, fireIn: 0 }])),
      broken((record) => (record.run.state.shop = [{ id: 'frog', sold: 'yes' }])),
      broken((record) => delete record.run.state.fruit),
      broken((record) => (record.run.state = [] as unknown as Record<string, unknown>)),
    ];
    for (const raw of cases) expect(readRunRecord(raw)).toEqual({ savedAt: T, run: null });
    // 넣어 둔 씨앗의 양만 이상하면 판은 살리고 0으로 친다.
    expect(readRunRecord(broken((record) => (record.run.banked = -4))).run?.banked).toBe(0);
  });

  it('이어 하지 않기로 한 판은 남은 씨앗을 넣고 판 수와 벌레 수를 더한다', () => {
    const state = { ...busyRun(5), seeds: 130.6, kills: 40, lastCleared: 6 };
    const meta = { ...createMeta(), seeds: 90, best: 6, runs: 2, kills: 100, startDay: 6 };
    const settled = settleSavedRun(meta, { state, banked: 100, bankedShards: 0 });
    expect(settled).toMatchObject({ seeds: 120, runs: 3, kills: 140, best: 6, startDay: 6 });
  });
});

describe('하던 판의 저장에 적힌 값의 범위 (10차 검토 G11)', () => {
  /** 한창인 판을 적은 것을 고쳐서 읽어 본다. */
  const readWith = (change: (state: Record<string, any>) => void): SavedRun | null => {
    const record = throughDisk(runRecord({ state: busyRun(), banked: 0, bankedShards: 0 }, T)) as {
      run: { state: Record<string, any> };
    };
    change(record.run.state);
    return readRunRecord(record).run;
  };

  it('판에서 나올 수 없는 값이 적힌 판은 버린다', () => {
    expect(readWith(() => undefined)).not.toBeNull();
    const broken: Array<[string, (state: Record<string, any>) => void]> = [
      ['물줄기 200만 갈래', (state) => (state.stats.streams = 2e6)],
      ['물줄기 0갈래', (state) => (state.stats.streams = 0)],
      ['쏘는 간격 0', (state) => (state.stats.interval = 0)],
      ['음수 피해', (state) => (state.stats.damage = -5)],
      ['너무 큰 피해', (state) => (state.stats.damage = 1e300)],
      ['너무 큰 날', (state) => (state.day = 1e6)],
      ['0일째', (state) => (state.day = 0)],
      ['오늘보다 늦은 시작 날', (state) => (state.startDay = state.day + 1)],
      ['오늘보다 늦은 지킨 날', (state) => (state.lastCleared = 1e9)],
      ['음수 울타리', (state) => (state.fence = -1)],
      ['가득보다 높은 울타리', (state) => (state.fence = state.stats.fenceMax + 1)],
      ['넘치는 씨앗', (state) => (state.seeds = 1e15)],
      ['나온 것보다 많이 쫓아냄', (state) => (state.dayKilled = state.dayTotal + 1)],
      ['너무 많은 물방울', (state) => (state.shots = Array.from({ length: 5000 }, () => state.shots[0]))],
      ['넷을 놓은 가게', (state) => (state.shop = Array.from({ length: 4 }, () => ({ id: 'frog', sold: false })))],
      ['열매 1경 개', (state) => (state.fruit = 1e16)],
      ['동료 백 마리를 합친 것', (state) => (state.allies = [{ id: 'frog', copies: 100, fireIn: 0 }])],
      ['싸우는 중에 열린 가게', (state) => ((state.phase = 'fight'), (state.shopping = true))],
      ['너무 큰 날의 벌레', (state) => (state.enemies[0].day = 1e6)],
    ];
    for (const [label, change] of broken) expect(readWith(change), label).toBeNull();
  });

  it('강화를 다 올린 사람의 뒤쪽 날 판도 저장했다가 그대로 읽는다', () => {
    // 자동 플레이로 20판을 해서 키운 진행으로, 가장 멀리 간 날 근처에서 한 판을 하며 10초마다 적었다가 읽어 본다.
    const { meta } = playCareer(createMeta(), 20, 'active', 3, 4, 'keen', true);
    const { state } = createRun({
      seed: 77,
      startDay: Math.max(1, meta.best - 9),
      levels: meta.levels,
      bestBefore: meta.best,
      fields: meta.fields,
      relics: meta.relics,
    });
    let checked = 0;
    // 판이 끝났는지는 step이 바꾸므로 그때마다 새로 본다.
    const live = (): boolean => state.phase !== 'over';
    for (let t = 0; live() && t < 900; t += STEP) {
      step(state, STEP, botInput(state, 'active'));
      if (live() && Math.round(state.t * 60) % 600 === 0) {
        const saved = readRunRecord(throughDisk(runRecord({ state, banked: 0, bankedShards: 0 }, T))).run;
        expect(saved?.state, `${Math.round(state.t)}초의 판`).toEqual(state);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(10);
    expect(runScore(state)).toBeGreaterThan(0);
  }, 60_000);
});
