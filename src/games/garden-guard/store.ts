/**
 * 텃밭 지키기의 저장: 씨앗과 영구 강화, 가장 멀리 지킨 날(meta), 그리고 하던 판(run).
 * 허브 세이브(core/save.ts)와 따로 기기 안에 둬서 공용 세이브 구조를 건드리지 않는다.
 *
 * 같은 기기에서 앱을 두 곳(설치한 앱과 브라우저 탭 같은)에 열어 두어도 서로 덮어쓰지 않게,
 * 저장한 때를 함께 적어 두고 화면이 다시 보일 때와 준비 화면을 열 때, 준비 화면에서 사고팔기 직전에
 * 더 새것이 있으면 읽어 온다. 읽어 온 것은 watch로 알려서, 떠 있던 준비 화면이 옛 값으로 셈하지 않게 한다.
 */
import { createStore, get, set, type UseStore } from 'idb-keyval';
import { registerSavePart } from '../../core/bundle';
import { GARDEN_GAME_ID } from './data';
import { createMeta, normalizeMeta, type GardenMeta } from './rules';
import { readRunRecord, runRecord, type SavedRun } from './saved-run';

const DB_NAME = 'pocket-arcade-garden';
const STORE_NAME = 'kv';
const KEY = 'meta';
const FALLBACK_KEY = 'pocket-arcade:garden-meta';
const RUN_KEY = 'run';
const RUN_FALLBACK_KEY = 'pocket-arcade:garden-run';

/**
 * 저장된 진행을 읽는다. 맞추다가 실패하는 값이 들어 있어도(망가진 저장) 처음 상태로 열어서,
 * 준비 화면과 내보내기, 기록 초기화가 함께 막히지 않게 한다.
 */
function readMeta(raw: unknown): GardenMeta {
  try {
    return normalizeMeta(raw);
  } catch {
    return createMeta();
  }
}

export class GardenStore {
  data: GardenMeta = createMeta();
  /** 도중에 두고 간 판. 준비 화면에서 이어 할 수 있다. */
  run: SavedRun | null = null;
  /** 지금 가진 판을 저장한(또는 다른 곳에서 읽어 온) 때. 다른 곳의 것은 이보다 새것만 받는다. */
  private runAt = 0;
  private idb: UseStore | null = null;
  private loaded: Promise<void> | null = null;
  /** 처음 읽기를 마쳤는지 */
  private ready = false;
  private writeQueue: Promise<void> = Promise.resolve();
  /** 다른 곳이 저장한 더 새것을 읽어 왔을 때 알릴 곳들 */
  private readonly watchers = new Set<() => void>();

  /**
   * 다른 곳이 저장한 더 새것을 읽어 왔을 때(refresh가 진행이나 하던 판을 바꿨을 때) listener를 부른다.
   * 돌려주는 함수를 부르면 그만 알린다.
   */
  watch(listener: () => void): () => void {
    this.watchers.add(listener);
    return () => void this.watchers.delete(listener);
  }

  /** 처음 부를 때만 실제로 읽는다. */
  load(): Promise<void> {
    this.loaded ??= this.read();
    return this.loaded;
  }

  /**
   * 기기에 저장된 것이 이 곳이 가진 것보다 새것이면 그것으로 바꾼다(다른 곳이 그사이 저장한 것).
   * 아직 읽기 전이면 처음 읽기만 한다. 더 새것을 읽어 와서 진행이나 하던 판이 바뀌었으면 true를 돌려준다.
   */
  async refresh(): Promise<boolean> {
    if (!this.ready) {
      await this.load();
      return false;
    }
    // 이 곳이 저장하던 것이 다 들어간 뒤에 읽는다.
    await this.writeQueue;
    let changed = false;
    const stored = readMeta(await this.readRaw(KEY, FALLBACK_KEY));
    if (stored.savedAt > this.data.savedAt) {
      this.data = stored;
      changed = true;
    }
    const record = readRunRecord(await this.readRaw(RUN_KEY, RUN_FALLBACK_KEY));
    if (record.savedAt > this.runAt) {
      this.run = record.run;
      this.runAt = record.savedAt;
      changed = true;
    }
    if (changed) for (const listener of [...this.watchers]) listener();
    return changed;
  }

  /** 대기 중인 저장이 끝날 때까지 기다린다. */
  flush(): Promise<void> {
    return this.writeQueue;
  }

  set(next: GardenMeta, now: number = Date.now()): void {
    // 다른 곳에서 읽어 온 것보다 늘 뒤가 되게 한다.
    this.data = { ...next, savedAt: Math.max(now, this.data.savedAt + 1) };
    const snapshot = structuredClone(this.data);
    this.writeQueue = this.writeQueue.then(() => this.write(KEY, FALLBACK_KEY, snapshot));
  }

  /** 하던 판을 저장한다. null이면 지운다(판이 끝났거나 이어 하지 않기로 했다). */
  setRun(run: SavedRun | null, now: number = Date.now()): void {
    this.run = run ? structuredClone(run) : null;
    this.runAt = Math.max(now, this.runAt + 1);
    const record = runRecord(this.run, this.runAt);
    this.writeQueue = this.writeQueue.then(() => this.write(RUN_KEY, RUN_FALLBACK_KEY, record));
  }

  private async read(): Promise<void> {
    try {
      this.idb = createStore(DB_NAME, STORE_NAME);
      await get(KEY, this.idb);
    } catch {
      this.idb = null;
    }
    const stored = readMeta(await this.readRaw(KEY, FALLBACK_KEY));
    // 읽는 사이에 이 곳에서 먼저 저장했으면(가져오기 같은 것) 그것을 둔다.
    if (this.data.savedAt === 0) this.data = stored;
    const record = readRunRecord(await this.readRaw(RUN_KEY, RUN_FALLBACK_KEY));
    if (this.runAt === 0) {
      this.run = record.run;
      this.runAt = record.savedAt;
    }
    this.ready = true;
    // 뒤에서 잠들어 있다가 다시 보이면, 그사이 다른 곳이 저장한 것을 읽어 온다.
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) void this.refresh();
      });
    }
  }

  private async readRaw(key: string, fallbackKey: string): Promise<unknown> {
    if (this.idb) {
      try {
        const value: unknown = await get(key, this.idb);
        if (value !== undefined) return value;
      } catch {
        // localStorage를 본다.
      }
    }
    try {
      const text = localStorage.getItem(fallbackKey);
      return text ? JSON.parse(text) : undefined;
    } catch {
      return undefined;
    }
  }

  private async write(key: string, fallbackKey: string, snapshot: unknown): Promise<void> {
    if (this.idb) {
      try {
        await set(key, snapshot, this.idb);
        return;
      } catch {
        // localStorage로 넘어간다.
      }
    }
    try {
      localStorage.setItem(fallbackKey, JSON.stringify(snapshot));
    } catch {
      // 저장할 곳이 없으면 이번 세션 동안만 유지된다.
    }
  }
}

export const gardenStore = new GardenStore();

// 백업 파일과 기기 옮기기에 텃밭의 진행(씨앗과 영구 강화)도 같이 실려 가게 한다. 하던 판은 싣지 않는다.
registerSavePart(GARDEN_GAME_ID, {
  async read() {
    // 다른 곳(다른 탭)에서 더 늦게 저장한 것이 있으면 그것을 내보낸다.
    await gardenStore.refresh();
    return gardenStore.data;
  },
  async write(raw) {
    await gardenStore.load();
    // 이 게임이 생기기 전에 내보낸 묶음에는 텃밭이 아예 없다. 그때는 지금 것을 그대로 둔다.
    if (raw === undefined) return;
    // null(기록 초기화)이나 맞지 않는 값이면 처음 상태로 돌린다.
    gardenStore.set(readMeta(raw));
    // 하던 판은 바뀐 진행과 맞지 않으니(넣어 둔 씨앗, 판을 시작할 때의 강화) 버린다.
    gardenStore.setRun(null);
  },
});
