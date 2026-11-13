/**
 * 새싹 컴퍼니의 저장. 허브 세이브(core/save.ts)와 따로 기기 안에 둬서 공용 세이브 구조를 건드리지 않는다.
 * 회사는 하나뿐이고, 화면을 닫았다가 다시 열면 그대로 이어진다.
 *
 * 같은 기기에서 앱을 두 곳(설치한 앱과 브라우저 탭 같은)에 열어 두면, 회사 화면을 마지막으로 연 곳이 회사를 맡는다.
 * 다른 곳은 그동안 시간을 흘리지도 저장하지도 않고 기다리다가, 다시 보이거나 눌리면 저장된 회사를 읽어 와서 이어 맡는다.
 * 그래서 뒤에 남아 있던 낡은 회사가 새 기록을 덮지 않는다.
 */
import { createStore, get, set, type UseStore } from 'idb-keyval';
import { registerSavePart } from '../../core/bundle';
import { COMPANY_GAME_ID } from './data';
import { normalizeCompany, type CompanyState } from './rules';

const DB_NAME = 'pocket-arcade-company';
const STORE_NAME = 'kv';
const KEY = 'state';
const FALLBACK_KEY = 'pocket-arcade:company';
/** 같은 기기에 열린 다른 곳과 회사를 주고받는 통로의 이름 */
const CHANNEL_NAME = 'pocket-arcade:company';

/** 같은 기기에 열린 다른 곳과 주고받는 말 */
type Note =
  /** 회사를 저장했다. state가 null이면 처음 상태로 돌렸다는 뜻이다. */
  | { kind: 'saved'; at: number; state: CompanyState | null }
  /** 이제부터 from이 회사를 맡는다. at은 맡겠다고 한 때다. */
  | { kind: 'claim'; from: string; at: number };

type Listener = () => void;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export class CompanyStore {
  /** 세운 회사. 아직 한 번도 열지 않았으면 null */
  data: CompanyState | null = null;
  private idb: UseStore | null = null;
  private loaded: Promise<void> | null = null;
  /** 처음 읽기를 마쳤는지 */
  private ready = false;
  private writeQueue: Promise<void> = Promise.resolve();
  /** 지금 가진 회사를 저장한(또는 다른 곳에서 받은) 때. 다른 곳에서 온 회사는 이보다 새것만 받는다. */
  private stamp = 0;
  /** 이 곳의 이름. 회사를 맡겠다고 알릴 때 쓴다. */
  private readonly id = Math.random().toString(36).slice(2);
  /** 이 곳이 마지막으로 회사를 맡겠다고 한 때 */
  private claimedAt = 0;
  /** 다른 곳이 맡겠다고 한 때 가운데 가장 늦은 때 */
  private heardAt = 0;
  /** 다른 곳이 회사를 맡아서, 이 곳이 다시 맡을 때까지 기다리는 중이면 true */
  private yielded = false;
  private channel: BroadcastChannel | null = null;
  private readonly listeners = new Set<Listener>();

  /** 처음 부를 때만 실제로 읽는다. */
  load(): Promise<void> {
    this.loaded ??= this.read();
    return this.loaded;
  }

  /**
   * 기기에 저장된 회사가 이 곳이 가진 것보다 새것이면 그것으로 바꾼다(다른 곳이 그사이 저장한 것).
   * 아직 읽기 전이면 처음 읽기만 한다. 바꿔도 onChange로 알리지는 않으므로, 부른 쪽이 data를 다시 본다.
   */
  async refresh(): Promise<void> {
    if (!this.ready) {
      await this.load();
      return;
    }
    // 이 곳이 저장하던 것이 다 들어간 뒤에 읽는다.
    await this.writeQueue;
    const raw = await this.readRaw();
    // 지워진 회사(null)는 언제 지운 것인지 알 수 없어서, 저장된 것으로는 받지 않는다. 지운 것은 통로로 바로 알린다.
    const stored = raw === undefined ? null : normalizeCompany(raw);
    if (stored && stored.savedAt > this.stamp) {
      this.data = stored;
      this.stamp = stored.savedAt;
    }
  }

  /** 이 곳이 회사를 맡고 있는지. 다른 곳이 회사 화면을 열면 false가 되고, 이 곳이 다시 맡으면(claim) true다. */
  get leading(): boolean {
    return !this.yielded;
  }

  /** 이제부터 이 곳이 회사를 맡는다고 다른 곳에 알린다. 다른 곳은 저장을 멈추고 기다린다. */
  claim(now: number = Date.now()): void {
    // 이미 들은 다른 곳의 말보다 늘 뒤가 되게 한다. 같은 때(1ms 안)에 맡겠다고 해도 이 곳이 맡도록.
    const at = Math.max(now, this.heardAt + 1);
    this.yielded = false;
    this.claimedAt = at;
    this.post({ kind: 'claim', from: this.id, at });
  }

  /** 다른 곳이 회사를 맡았거나, 다른 곳에서 저장한 회사를 받았을 때 불린다. 구독을 끊는 함수를 돌려준다. */
  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 대기 중인 저장이 끝날 때까지 기다린다. */
  flush(): Promise<void> {
    return this.writeQueue;
  }

  /** 회사를 저장한다. null이면 처음 상태로 돌린다. */
  set(next: CompanyState | null, now: number = Date.now()): void {
    if (next) next.savedAt = now;
    this.data = next;
    this.stamp = now;
    const snapshot = next ? structuredClone(next) : null;
    this.writeQueue = this.writeQueue.then(() => this.write(snapshot));
    this.post({ kind: 'saved', at: now, state: snapshot });
  }

  private async read(): Promise<void> {
    try {
      this.idb = createStore(DB_NAME, STORE_NAME);
      await get(KEY, this.idb);
    } catch {
      this.idb = null;
    }
    const stored = normalizeCompany(await this.readRaw());
    // 읽는 사이에 이 곳에서 먼저 저장했으면(가져오기 같은 것) 그것을 둔다.
    if (this.stamp === 0) {
      this.data = stored;
      this.stamp = stored?.savedAt ?? 0;
    }
    this.ready = true;
    this.openChannel();
  }

  private async readRaw(): Promise<unknown> {
    if (this.idb) {
      try {
        const value: unknown = await get(KEY, this.idb);
        if (value !== undefined) return value;
      } catch {
        // localStorage를 본다.
      }
    }
    try {
      const text = localStorage.getItem(FALLBACK_KEY);
      return text ? JSON.parse(text) : undefined;
    } catch {
      return undefined;
    }
  }

  private async write(snapshot: CompanyState | null): Promise<void> {
    if (this.idb) {
      try {
        await set(KEY, snapshot, this.idb);
        return;
      } catch {
        // localStorage로 넘어간다.
      }
    }
    try {
      localStorage.setItem(FALLBACK_KEY, JSON.stringify(snapshot));
    } catch {
      // 저장할 곳이 없으면 이번 세션 동안만 유지된다.
    }
  }

  /** 다른 곳과 회사를 주고받는 통로를 연다. 지원하지 않는 브라우저에서는 아무 일도 하지 않는다. */
  private openChannel(): void {
    if (this.channel || typeof BroadcastChannel === 'undefined') return;
    try {
      this.channel = new BroadcastChannel(CHANNEL_NAME);
      this.channel.onmessage = (event: MessageEvent<unknown>) => this.receive(event.data);
    } catch {
      this.channel = null;
    }
  }

  private post(note: Note): void {
    try {
      this.channel?.postMessage(note);
    } catch {
      // 다른 곳에 알리지 못해도 이 곳의 저장에는 영향이 없다.
    }
  }

  /**
   * 다른 곳에서 온 말을 받는다. 저장은 보낸 곳이 이미 했으므로 여기서는 다시 저장하거나 알리지 않는다.
   * 회사는 이 곳 것보다 새것만 받고, 맡겠다는 말은 이 곳이 맡겠다고 한 때보다 뒤의 것만 따른다
   * (두 곳이 거의 같이 열었을 때 둘 다 기다리지 않도록).
   */
  private receive(raw: unknown): void {
    if (!isObject(raw) || typeof raw.at !== 'number' || !this.ready) return;
    if (raw.kind === 'claim') {
      if (typeof raw.from !== 'string' || raw.from === this.id) return;
      this.heardAt = Math.max(this.heardAt, raw.at);
      // 서로의 말을 듣기 전에 같은 때에 맡겠다고 했으면, 이름으로 한 곳만 맡게 한다.
      const later = raw.at > this.claimedAt || (raw.at === this.claimedAt && raw.from > this.id);
      if (!later) return;
      this.yielded = true;
    } else if (raw.kind === 'saved') {
      if (raw.at <= this.stamp) return;
      const state = raw.state === null ? null : normalizeCompany(raw.state);
      if (raw.state !== null && state === null) return;
      this.data = state;
      this.stamp = raw.at;
    } else {
      return;
    }
    for (const listener of this.listeners) listener();
  }
}

export const companyStore = new CompanyStore();

// 백업 파일과 기기 옮기기에 회사도 같이 실려 가게 한다.
registerSavePart(COMPANY_GAME_ID, {
  async read() {
    // 다른 곳(다른 탭)에서 더 늦게 저장한 회사가 있으면 그것을 내보낸다.
    await companyStore.refresh();
    return companyStore.data;
  },
  async write(raw) {
    await companyStore.load();
    // 이 게임이 생기기 전에 내보낸 묶음에는 회사가 아예 없다. 그때는 지금 회사를 그대로 둔다.
    if (raw === undefined) return;
    // null(기록 초기화)이나 맞지 않는 값이면 회사를 처음 상태로 돌린다. 다음에 열 때 새로 세운다.
    companyStore.set(normalizeCompany(raw));
  },
});
