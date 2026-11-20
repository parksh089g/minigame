/**
 * 피라미드의 오늘의 판 기록(daily.ts의 PyramidDaily)을 기기 안에 둔다.
 * 허브 세이브(core/save.ts)와 따로 둬서 공용 세이브 구조를 건드리지 않는다.
 *
 * 같은 기기에서 앱을 두 곳(설치한 앱과 브라우저 탭 같은)에 열어 두어도 서로 덮어쓰지 않게,
 * 저장한 때를 함께 적어 두고 화면이 다시 보일 때와 게임을 열 때 더 새것이 있으면 읽어 온다.
 */
import { createStore, get, set, type UseStore } from 'idb-keyval';
import { registerSavePart } from '../../core/bundle';
import { createDaily, normalizeDaily, type PyramidDaily } from './daily';

const DB_NAME = 'pocket-arcade-pyramid-daily';
const STORE_NAME = 'kv';
const KEY = 'daily';
const FALLBACK_KEY = 'pocket-arcade:pyramid-daily';
/** 백업 묶음(core/bundle.ts)에 실리는 이름. 한 번 정하면 바꾸지 않는다. */
export const PYRAMID_DAILY_PART = 'pyramid-daily';

export class PyramidDailyStore {
  data: PyramidDaily = createDaily();
  private idb: UseStore | null = null;
  private loaded: Promise<void> | null = null;
  /** 처음 읽기를 마쳤는지 */
  private ready = false;
  private writeQueue: Promise<void> = Promise.resolve();

  /** 처음 부를 때만 실제로 읽는다. */
  load(): Promise<void> {
    this.loaded ??= this.read();
    return this.loaded;
  }

  /**
   * 기기에 저장된 것이 이 곳이 가진 것보다 새것이면 그것으로 바꾼다(다른 곳이 그사이 저장한 것).
   * 아직 읽기 전이면 처음 읽기만 한다.
   */
  async refresh(): Promise<void> {
    if (!this.ready) {
      await this.load();
      return;
    }
    // 이 곳이 저장하던 것이 다 들어간 뒤에 읽는다.
    await this.writeQueue;
    const stored = normalizeDaily(await this.readRaw());
    if (stored.savedAt > this.data.savedAt) this.data = stored;
  }

  /** 대기 중인 저장이 끝날 때까지 기다린다. */
  flush(): Promise<void> {
    return this.writeQueue;
  }

  set(next: PyramidDaily, now: number = Date.now()): void {
    // 다른 곳에서 읽어 온 것보다 늘 뒤가 되게 한다.
    this.data = { ...next, savedAt: Math.max(now, this.data.savedAt + 1) };
    const snapshot = structuredClone(this.data);
    this.writeQueue = this.writeQueue.then(() => this.write(snapshot));
  }

  private async read(): Promise<void> {
    try {
      this.idb = createStore(DB_NAME, STORE_NAME);
      await get(KEY, this.idb);
    } catch {
      this.idb = null;
    }
    const stored = normalizeDaily(await this.readRaw());
    // 읽는 사이에 이 곳에서 먼저 저장했으면(막 끝난 판, 가져오기) 그것을 둔다.
    if (this.data.savedAt === 0) this.data = stored;
    this.ready = true;
    // 뒤에서 잠들어 있다가 다시 보이면, 그사이 다른 곳이 저장한 것을 읽어 온다.
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) void this.refresh();
      });
    }
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

  private async write(snapshot: PyramidDaily): Promise<void> {
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
}

export const pyramidDailyStore = new PyramidDailyStore();

// 백업 파일과 기기 옮기기에 오늘의 판 기록(그날의 최고 기록과 이어 온 날 수)도 같이 실려 가게 한다.
registerSavePart(PYRAMID_DAILY_PART, {
  async read() {
    // 다른 곳(다른 탭)에서 더 늦게 저장한 것이 있으면 그것을 내보낸다.
    await pyramidDailyStore.refresh();
    return pyramidDailyStore.data;
  },
  async write(raw) {
    await pyramidDailyStore.load();
    // 오늘의 판이 생기기 전에 내보낸 묶음에는 이 기록이 아예 없다. 그때는 지금 것을 그대로 둔다.
    if (raw === undefined) return;
    // null(기록 초기화)이나 맞지 않는 값이면 처음 상태로 돌린다.
    pyramidDailyStore.set(normalizeDaily(raw));
  },
});
