import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buyMeta, createDefaultMeta, MetaStore, type StoreChange } from './meta';
import { META_ORDER } from './data';
import { createRun } from './sim';

/** 같은 기기에 열린 여러 곳을 흉내 낸다. 보낸 곳을 뺀, 이름이 같은 통로에 바로 전한다. */
class FakeChannel {
  static open = new Set<FakeChannel>();
  onmessage: ((event: { data: unknown }) => void) | null = null;
  constructor(readonly name: string) {
    FakeChannel.open.add(this);
  }
  postMessage(data: unknown): void {
    const copy = structuredClone(data);
    for (const other of FakeChannel.open) {
      if (other !== this && other.name === this.name) other.onmessage?.({ data: copy });
    }
  }
  close(): void {
    FakeChannel.open.delete(this);
  }
}

/** 여러 곳이 함께 쓰는 기기 안의 저장 공간 */
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
const VIEW = { viewW: 240, viewH: 400, meta: {} };

async function opened(): Promise<MetaStore> {
  const copy = new MetaStore();
  await copy.load();
  return copy;
}

/** 통로 없이 연 곳. 뒤에서 잠들어 있어서 다른 곳의 말을 듣지 못하는 곳을 흉내 낸다. */
async function openedDeaf(): Promise<MetaStore> {
  vi.stubGlobal('BroadcastChannel', undefined);
  const copy = await opened();
  vi.stubGlobal('BroadcastChannel', FakeChannel);
  return copy;
}

describe('등불지기를 두 곳에서 열었을 때', () => {
  beforeEach(() => {
    FakeChannel.open.clear();
    vi.stubGlobal('BroadcastChannel', FakeChannel);
    vi.stubGlobal('localStorage', memoryStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('한 곳이 저장하면 다른 곳이 새 진행을 받고, 낡은 것은 받지 않는다', async () => {
    const a = await opened();
    const b = await opened();
    const heard: StoreChange[] = [];
    a.onChange((change) => heard.push(change));
    b.set({ ...b.data, embers: 500 }, T + 10);
    expect(a.data.embers).toBe(500);
    expect(heard).toEqual([{ meta: true, run: false }]);
    // 받은 것은 따로 든 사본이다.
    expect(a.data).not.toBe(b.data);

    // 늦게 닿은 낡은 말은 받지 않는다.
    const late = new FakeChannel('pocket-arcade:lantern');
    late.postMessage({ kind: 'meta', at: T + 5, meta: { ...createDefaultMeta(), embers: 1 } });
    expect(a.data.embers).toBe(500);
    expect(heard).toHaveLength(1);
  });

  it('한 곳에서 얻은 불씨와 다른 곳에서 산 강화가 둘 다 남는다', async () => {
    const a = await opened();
    const b = await opened();
    // a에서 판을 마쳐 불씨를 얻고, 그 뒤에 b에서 강화를 산다.
    a.set({ ...a.data, embers: 400, runs: 1 }, T);
    const id = META_ORDER[0];
    const bought = buyMeta(b.data, id);
    expect(bought).not.toBe(b.data);
    b.set(bought, T + 1);
    for (const store of [a, b]) {
      expect(store.data.runs).toBe(1);
      expect(store.data.upgrades[id]).toBe(1);
      expect(store.data.embers).toBe(bought.embers);
    }
    // 기기에 남은 것도 같다.
    await a.flush();
    await b.flush();
    const later = await opened();
    expect(later.data).toEqual(b.data);
  });

  it('같은 때에 저장해도 나중에 저장한 것이 새것이다', async () => {
    const a = await opened();
    const b = await opened();
    a.set({ ...a.data, embers: 10 }, T);
    b.set({ ...b.data, embers: b.data.embers + 5 }, T);
    expect(a.data.embers).toBe(15);
    expect(b.data.embers).toBe(15);
  });

  it('통로로 듣지 못했어도 다시 읽으면 저장된 새 진행으로 바뀐다', async () => {
    const a = await openedDeaf();
    a.set({ ...a.data, embers: 10 }, T);
    await a.flush();
    const b = await opened();
    expect(b.data.embers).toBe(10);
    b.set({ ...b.data, embers: 900 }, T + 50);
    await b.flush();
    expect(a.data.embers).toBe(10);

    const heard: StoreChange[] = [];
    a.onChange((change) => heard.push(change));
    await a.refresh();
    expect(a.data.embers).toBe(900);
    expect(heard).toEqual([{ meta: true, run: false }]);

    // 저장된 것이 이 곳 것보다 새것이 아니면 그대로 둔다.
    a.set({ ...a.data, embers: 950 }, T + 60);
    await a.refresh();
    expect(a.data.embers).toBe(950);
    expect(heard).toHaveLength(1);
  });

  it('하던 판도 저장한 곳의 것으로 맞추고, 지우면 다른 곳에서도 지워진다', async () => {
    const a = await opened();
    const b = await opened();
    const heard: StoreChange[] = [];
    a.onChange((change) => heard.push(change));
    const run = createRun({ ...VIEW, seed: 77 });
    run.t = 123;
    b.setRun(run, T);
    expect(a.run?.seed).toBe(77);
    expect(a.run?.t).toBe(123);
    expect(heard).toEqual([{ meta: false, run: true }]);
    // 판만 바뀌고 진행은 그대로다.
    expect(a.data).toEqual(createDefaultMeta());

    b.setRun(null, T + 1);
    expect(a.run).toBeNull();
    expect(heard).toHaveLength(2);
  });

  it('듣지 못한 판도 다시 읽으면 따라온다', async () => {
    const a = await openedDeaf();
    a.setRun(createRun({ ...VIEW, seed: 5 }), T);
    await a.flush();
    const b = await opened();
    expect(b.run?.seed).toBe(5);
    b.setRun(null, T + 10);
    await b.flush();
    expect(a.run).not.toBeNull();
    await a.refresh();
    expect(a.run).toBeNull();
  });

  it('처음 상태로 돌리면 다른 곳도 처음 상태가 된다', async () => {
    const a = await opened();
    const b = await opened();
    a.set({ ...a.data, embers: 321, runs: 9 }, T);
    a.setRun(createRun({ ...VIEW }), T);
    expect(b.data.runs).toBe(9);
    b.set(createDefaultMeta(), T + 1);
    b.setRun(null, T + 1);
    expect(a.data).toEqual(createDefaultMeta());
    expect(a.run).toBeNull();
  });

  it('저장한 때가 적혀 있지 않은 예전 저장도 그대로 읽는다', async () => {
    localStorage.setItem('pocket-arcade:lantern-meta', JSON.stringify({ ...createDefaultMeta(), embers: 77 }));
    const a = await opened();
    expect(a.data.embers).toBe(77);
    // 다시 읽어도 바뀐 것이 없다.
    const heard = vi.fn();
    a.onChange(heard);
    await a.refresh();
    expect(heard).not.toHaveBeenCalled();
    expect(a.data.embers).toBe(77);
  });

  it('통로가 없는 브라우저에서도 저장과 읽기는 된다', async () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    const a = await opened();
    a.set({ ...a.data, embers: 42 }, T);
    await a.flush();
    const b = await opened();
    expect(b.data.embers).toBe(42);
  });
});
