/**
 * 구름 탑 모험의 저장: 구름 조각과 영구 강화, 가장 높이 오른 층, 그리고 하던 판.
 * 허브 세이브(core/save.ts)와 따로 기기 안에 둬서 공용 세이브 구조를 건드리지 않는다.
 *
 * 같은 기기에서 앱을 두 곳(설치한 앱과 브라우저 탭 같은)에 열어 두어도 서로 덮어쓰지 않게,
 * 저장한 때를 함께 적어 두고 화면이 다시 보일 때와 준비 화면을 열 때 더 새것이 있으면 읽어 온다.
 */
import { createStore, get, set, type UseStore } from 'idb-keyval';
import { registerSavePart } from '../../core/bundle';
import { TOWER_GAME_ID } from './data';
import { createMeta, normalizeMeta, type TowerMeta } from './run';

const DB_NAME = 'pocket-arcade-tower';
const STORE_NAME = 'kv';
const KEY = 'meta';
const FALLBACK_KEY = 'pocket-arcade:tower-meta';

export class TowerStore {
  data: TowerMeta = createMeta();
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
    const stored = normalizeMeta(await this.readRaw());
    if (stored.savedAt > this.data.savedAt) this.data = stored;
  }

  /** 대기 중인 저장이 끝날 때까지 기다린다. */
  flush(): Promise<void> {
    return this.writeQueue;
  }

  set(next: TowerMeta, now: number = Date.now()): void {
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
    const stored = normalizeMeta(await this.readRaw());
    // 읽는 사이에 이 곳에서 먼저 저장했으면(가져오기 같은 것) 그것을 둔다.
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

  private async write(snapshot: TowerMeta): Promise<void> {
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

export const towerStore = new TowerStore();

// 백업 파일과 기기 옮기기에 구름 탑의 진행(조각과 영구 강화, 하던 판)도 같이 실려 가게 한다.
registerSavePart(TOWER_GAME_ID, {
  async read() {
    // 다른 곳(다른 탭)에서 더 늦게 저장한 것이 있으면 그것을 내보낸다.
    await towerStore.refresh();
    return towerStore.data;
  },
  async write(raw) {
    await towerStore.load();
    // 이 게임이 생기기 전에 내보낸 묶음에는 구름 탑이 아예 없다. 그때는 지금 것을 그대로 둔다.
    if (raw === undefined) return;
    // null(기록 초기화)이나 맞지 않는 값이면 처음 상태로 돌린다.
    towerStore.set(normalizeMeta(raw));
  },
});
