import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportBundle, importBundleText, packBundle, resetParts } from '../../core/bundle';
import { createDefaultSave } from '../../core/save';
import { addDailyRun, createDaily } from './daily';
import { SLOT_DAILY_PART, SlotDailyStore, slotDailyStore } from './daily-store';

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
const TODAY = 20_773;

/** 그날 한 판을 마친 기록 */
const played = (score: number, rounds = 2, day = TODAY) => addDailyRun(createDaily(), day, { score, rounds }).record;

async function opened(): Promise<SlotDailyStore> {
  const copy = new SlotDailyStore();
  await copy.load();
  return copy;
}

describe('행운 슬롯의 오늘의 판 기록의 저장', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('처음 열면 빈 기록이다', async () => {
    expect((await opened()).data).toEqual(createDaily());
  });

  it('저장한 것을 다시 열면 그대로 있다', async () => {
    const a = await opened();
    a.set(played(120, 4), T);
    await a.flush();
    const b = await opened();
    expect(b.data).toEqual(a.data);
    expect(b.data).toEqual({ day: TODAY, best: 120, rounds: 4, tries: 1, streak: 1, savedAt: T });
  });

  it('다른 곳이 더 늦게 저장한 것은 다시 볼 때 읽어 온다', async () => {
    const a = await opened();
    const b = await opened();
    a.set(played(30), T);
    await a.flush();
    expect(b.data.best).toBe(0);
    await b.refresh();
    expect(b.data.best).toBe(30);
    // 이쪽이 더 새것이면 그대로 둔다.
    b.set(addDailyRun(b.data, TODAY, { score: 80, rounds: 3 }).record, T + 10);
    await a.refresh();
    expect(a.data).toMatchObject({ best: 80, rounds: 3, tries: 2 });
  });

  it('읽어 온 것보다 늘 뒤에 저장한 것이 된다', async () => {
    const store = await opened();
    store.set(played(10), T);
    // 시계가 뒤로 간 기기에서도 앞의 저장을 덮는다.
    store.set(played(20), T - 5000);
    expect(store.data.savedAt).toBe(T + 1);
    await store.flush();
    expect((await opened()).data.best).toBe(20);
  });

  it('읽기를 마치기 전에 저장한 것은 읽어 온 것에 덮이지 않는다', async () => {
    const a = await opened();
    a.set(played(10), T);
    await a.flush();
    const b = new SlotDailyStore();
    const loading = b.load();
    b.set(played(99), T + 10);
    await loading;
    expect(b.data.best).toBe(99);
  });

  it('망가진 저장은 빈 기록으로 읽는다', async () => {
    localStorage.setItem('pocket-arcade:slot-daily', '{"day":20773,"best":');
    expect((await opened()).data).toEqual(createDaily());
    localStorage.setItem('pocket-arcade:slot-daily', JSON.stringify({ day: TODAY, best: 'lots', tries: 2, streak: 3 }));
    expect((await opened()).data).toEqual({ day: TODAY, best: 0, rounds: 0, tries: 2, streak: 3, savedAt: 0 });
  });
});

describe('오늘의 판 기록의 백업과 초기화', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
    // 다른 게임의 저장이 다른 곳과 주고받을 통로를 열지 않게 한다.
    vi.stubGlobal('BroadcastChannel', undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('내보내는 묶음에 오늘의 판 기록이 실린다', async () => {
    await slotDailyStore.load();
    slotDailyStore.set(played(120, 4));
    const { parts } = await exportBundle();
    expect(parts[SLOT_DAILY_PART]).toMatchObject({ day: TODAY, best: 120, rounds: 4, tries: 1, streak: 1 });
  });

  it('가져온 묶음의 기록으로 바뀐다. 오늘의 판이 생기기 전의 묶음이면 지금 것을 그대로 둔다', async () => {
    await slotDailyStore.load();
    slotDailyStore.set(played(120, 4));
    const save = createDefaultSave(T);
    // 이 기록이 아예 없는 묶음
    expect(await importBundleText(JSON.stringify(packBundle(save, {}, T)))).toBe(true);
    expect(slotDailyStore.data).toMatchObject({ best: 120, rounds: 4 });
    // 다른 기기에서 옮겨 온 기록
    const other = { ...played(45, 1, TODAY - 1), streak: 6 };
    expect(await importBundleText(JSON.stringify(packBundle(save, { [SLOT_DAILY_PART]: other }, T)))).toBe(true);
    expect(slotDailyStore.data).toMatchObject({ day: TODAY - 1, best: 45, rounds: 1, streak: 6 });
    // 모양이 맞지 않으면 처음 상태로 돌린다.
    expect(await importBundleText(JSON.stringify(packBundle(save, { [SLOT_DAILY_PART]: 'broken' }, T)))).toBe(true);
    expect(slotDailyStore.data).toMatchObject({ day: 0, best: 0, tries: 0, streak: 0 });
  });

  it('기록을 초기화하면 처음 상태로 돌아간다', async () => {
    await slotDailyStore.load();
    slotDailyStore.set(played(120, 4));
    await resetParts();
    expect(slotDailyStore.data).toEqual({ ...createDaily(), savedAt: slotDailyStore.data.savedAt });
    expect(slotDailyStore.data.savedAt).toBeGreaterThan(0);
    // 다시 열어도 비어 있다.
    await slotDailyStore.flush();
    expect((await opened()).data).toMatchObject({ day: 0, tries: 0 });
  });
});
