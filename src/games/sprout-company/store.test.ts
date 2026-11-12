import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STAFF_ORDER } from './data';
import { createCompany } from './rules';
import { CompanyStore } from './store';

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

const BOSS = STAFF_ORDER[0];
const T = 1_700_000_000_000;

async function opened(): Promise<CompanyStore> {
  const copy = new CompanyStore();
  await copy.load();
  return copy;
}

describe('새싹 컴퍼니를 두 곳에서 열었을 때', () => {
  beforeEach(() => {
    FakeChannel.open.clear();
    vi.stubGlobal('BroadcastChannel', FakeChannel);
    vi.stubGlobal('localStorage', memoryStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('나중에 맡은 곳이 회사를 맡고, 먼저 연 곳은 기다린다', async () => {
    const a = await opened();
    const b = await opened();
    const heard = vi.fn();
    a.onChange(heard);
    a.claim(T);
    expect(a.leading).toBe(true);
    b.claim(T + 1);
    expect(b.leading).toBe(true);
    expect(a.leading).toBe(false);
    expect(heard).toHaveBeenCalledTimes(1);
    // 먼저 한 말이 늦게 닿아도 나중에 맡은 곳이 그대로 맡는다.
    a.claim(T + 2);
    expect(b.leading).toBe(false);
    expect(a.leading).toBe(true);
  });

  it('두 곳이 같은 때에 맡겠다고 해도 한 곳만 맡는다', async () => {
    // 앞의 말을 들은 뒤에 같은 때에 맡겠다고 하면, 나중에 말한 곳이 맡는다.
    const a = await opened();
    const b = await opened();
    a.claim(T);
    b.claim(T);
    expect([a.leading, b.leading]).toEqual([false, true]);

    // 서로의 말을 듣기 전에(통로가 늦게 전해) 같은 때에 맡겠다고 해도 둘 다 기다리지는 않는다.
    for (let round = 0; round < 20; round += 1) {
      FakeChannel.open.clear();
      const delayed: (() => void)[] = [];
      const send = FakeChannel.prototype.postMessage;
      const spy = vi.spyOn(FakeChannel.prototype, 'postMessage').mockImplementation(function (this: FakeChannel, data) {
        delayed.push(() => send.call(this, data));
      });
      const c = await opened();
      const d = await opened();
      c.claim(T);
      d.claim(T);
      spy.mockRestore();
      for (const deliver of delayed) deliver();
      expect([c.leading, d.leading].filter(Boolean)).toHaveLength(1);
    }
  });

  it('한 곳이 저장하면 다른 곳이 새 회사를 받고, 낡은 것은 받지 않는다', async () => {
    const a = await opened();
    const b = await opened();
    const company = createCompany(BOSS);
    company.reputation = 500;
    b.set(company, T + 10);
    expect(a.data?.reputation).toBe(500);
    expect(a.data?.savedAt).toBe(T + 10);
    // 받은 것은 따로 든 사본이다.
    expect(a.data).not.toBe(company);

    const older = createCompany(BOSS);
    older.reputation = 1;
    b.set(older, T + 5);
    expect(a.data?.reputation).toBe(500);
  });

  it('기록을 지우면(null) 다른 곳도 회사를 비운다', async () => {
    const a = await opened();
    const b = await opened();
    b.set(createCompany(BOSS), T);
    expect(a.data).not.toBeNull();
    b.set(null, T + 1);
    expect(a.data).toBeNull();
  });

  it('통로로 듣지 못했어도 다시 읽으면 저장된 새 회사로 바뀐다', async () => {
    const a = await opened();
    const old = createCompany(BOSS);
    old.reputation = 10;
    a.set(old, T);
    await a.flush();
    // 다른 곳이 통로 없이(예: 잠들어 있던 사이에) 저장했다.
    vi.stubGlobal('BroadcastChannel', undefined);
    const b = new CompanyStore();
    await b.load();
    expect(b.data?.reputation).toBe(10);
    const fresh = structuredClone(b.data);
    if (!fresh) throw new Error('회사가 없다');
    fresh.reputation = 900;
    b.set(fresh, T + 50);
    await b.flush();
    expect(a.data?.reputation).toBe(10);
    await a.refresh();
    expect(a.data?.reputation).toBe(900);
    // 저장된 것이 더 낡았으면 그대로 둔다.
    const mine = a.data;
    if (!mine) throw new Error('회사가 없다');
    mine.reputation = 950;
    a.set(mine, T + 60);
    await a.refresh();
    expect(a.data?.reputation).toBe(950);
  });

  it('지워진 회사는 저장된 것을 다시 읽어서는 받지 않는다(언제 지운 것인지 몰라서)', async () => {
    const a = await opened();
    a.set(createCompany(BOSS), T);
    await a.flush();
    localStorage.setItem('pocket-arcade:company', 'null');
    await a.refresh();
    expect(a.data).not.toBeNull();
  });
});
