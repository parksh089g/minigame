import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportBundle, resetParts } from '../../core/bundle';
import { GARDEN_GAME_ID } from './data';
import { buyUpgrade, createMeta } from './rules';
import type { SavedRun } from './saved-run';
import { createRun } from './sim';
import { GardenStore, gardenStore } from './store';

/** 같은 기기에 열린 여러 곳이 함께 쓰는 저장 공간 */
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, String(value)),
  };
}

const T = 1_700_000_000_000;

/** 막 시작한 판 */
function freshRun(day = 1): SavedRun {
  return { state: createRun({ seed: 9, startDay: day, levels: {}, bestBefore: 0 }).state, banked: 0 };
}

async function opened(): Promise<GardenStore> {
  const copy = new GardenStore();
  await copy.load();
  return copy;
}

describe('텃밭의 저장', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('처음 열면 빈 텃밭이다', async () => {
    const store = await opened();
    expect(store.data).toEqual(createMeta());
  });

  it('저장한 것을 다시 열면 그대로 있다', async () => {
    const a = await opened();
    a.set(buyUpgrade({ ...createMeta(), seeds: 90, best: 6, bestEver: 6, startDay: 6 }, 'power'), T);
    await a.flush();
    const b = await opened();
    expect(b.data).toEqual(a.data);
    expect(b.data.levels.power).toBe(1);
    expect(b.data.savedAt).toBe(T);
  });

  it('다른 곳이 더 늦게 저장한 것은 다시 볼 때 읽어 온다', async () => {
    const a = await opened();
    const b = await opened();
    a.set({ ...a.data, seeds: 30 }, T);
    await a.flush();
    expect(b.data.seeds).toBe(0);
    await b.refresh();
    expect(b.data.seeds).toBe(30);
    // 이쪽이 더 새것이면 그대로 둔다.
    b.set({ ...b.data, seeds: 5 }, T + 10);
    await a.refresh();
    expect(a.data.seeds).toBe(5);
    a.set({ ...a.data, seeds: 77 }, T + 20);
    const stale = { ...b.data };
    await b.refresh();
    expect(b.data.seeds).toBe(77);
    expect(stale.seeds).toBe(5);
  });

  it('읽어 온 것보다 늘 뒤에 저장한 것이 된다', async () => {
    const store = await opened();
    store.set({ ...store.data, seeds: 1 }, T);
    // 시계가 뒤로 간 기기에서도 앞의 저장을 덮는다.
    store.set({ ...store.data, seeds: 2 }, T - 5000);
    expect(store.data.savedAt).toBe(T + 1);
    await store.flush();
    expect((await opened()).data.seeds).toBe(2);
  });

  it('하던 판을 저장하면 다시 열 때 이어 할 수 있고, 지우면 없다', async () => {
    const a = await opened();
    expect(a.run).toBeNull();
    const run = freshRun(6);
    a.setRun(run, T);
    // 저장한 뒤에 판이 움직여도 저장한 것은 그대로다.
    run.state.day = 99;
    await a.flush();
    const b = await opened();
    expect(b.run?.state.day).toBe(6);
    expect(b.run).toEqual(a.run);
    a.setRun(null, T + 5);
    await a.flush();
    expect((await opened()).run).toBeNull();
  });

  it('다른 곳이 더 늦게 저장한 판은 다시 볼 때 읽어 오고, 지운 것도 따라간다', async () => {
    const a = await opened();
    const b = await opened();
    a.setRun(freshRun(11), T);
    await a.flush();
    await b.refresh();
    expect(b.run?.state.day).toBe(11);
    b.setRun(null, T + 10);
    await a.refresh();
    expect(a.run).toBeNull();
  });

  it('망가진 판은 없는 것으로 읽고, 진행은 그대로 읽는다', async () => {
    localStorage.setItem('pocket-arcade:garden-meta', JSON.stringify({ ...createMeta(), seeds: 12, savedAt: T }));
    localStorage.setItem('pocket-arcade:garden-run', '{"version":1,"savedAt":5,"run":{"state":');
    const store = await opened();
    expect(store.run).toBeNull();
    expect(store.data.seeds).toBe(12);
  });

  it('망가진 저장은 빈 텃밭으로 읽는다', async () => {
    localStorage.setItem('pocket-arcade:garden-meta', '{"seeds":"lots","levels":7');
    expect((await opened()).data).toEqual(createMeta());
    localStorage.setItem('pocket-arcade:garden-meta', JSON.stringify({ seeds: 12, levels: { power: 2, nope: 4 } }));
    expect((await opened()).data).toMatchObject({ seeds: 12, levels: { power: 2 } });
  });
});

describe('백업과 초기화', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
    // 다른 게임의 저장이 다른 곳과 주고받을 통로를 열지 않게 한다.
    vi.stubGlobal('BroadcastChannel', undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('내보내는 묶음에 텃밭의 진행이 실린다', async () => {
    await gardenStore.load();
    gardenStore.set({ ...createMeta(), seeds: 44, best: 9, levels: { fence: 3 } });
    const { parts } = await exportBundle();
    expect(parts[GARDEN_GAME_ID]).toMatchObject({ seeds: 44, best: 9, levels: { fence: 3 } });
  });

  it('기록을 초기화하면 처음 상태로 돌아가고, 하던 판도 지운다', async () => {
    await gardenStore.load();
    gardenStore.set({ ...createMeta(), seeds: 44, best: 9, levels: { fence: 3 } });
    gardenStore.setRun(freshRun(6));
    await resetParts();
    expect(gardenStore.run).toBeNull();
    expect(gardenStore.data).toEqual({ ...createMeta(), savedAt: gardenStore.data.savedAt });
    expect(gardenStore.data.savedAt).toBeGreaterThan(0);
  });
});
