/**
 * 새싹 컴퍼니의 저장. 허브 세이브(core/save.ts)와 따로 기기 안에 둬서 공용 세이브 구조를 건드리지 않는다.
 * 회사는 하나뿐이고, 화면을 닫았다가 다시 열면 그대로 이어진다.
 */
import { createStore, get, set, type UseStore } from 'idb-keyval';
import { registerSavePart } from '../../core/bundle';
import { COMPANY_GAME_ID } from './data';
import { normalizeCompany, type CompanyState } from './rules';

const DB_NAME = 'pocket-arcade-company';
const STORE_NAME = 'kv';
const KEY = 'state';
const FALLBACK_KEY = 'pocket-arcade:company';

class CompanyStore {
  /** 세운 회사. 아직 한 번도 열지 않았으면 null */
  data: CompanyState | null = null;
  private idb: UseStore | null = null;
  private loaded: Promise<void> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  /** 처음 부를 때만 실제로 읽는다. */
  load(): Promise<void> {
    this.loaded ??= this.read();
    return this.loaded;
  }

  /** 회사를 저장한다. null이면 처음 상태로 돌린다. */
  set(next: CompanyState | null, now: number = Date.now()): void {
    if (next) next.savedAt = now;
    this.data = next;
    const snapshot = next ? structuredClone(next) : null;
    this.writeQueue = this.writeQueue.then(() => this.write(snapshot));
  }

  private async read(): Promise<void> {
    try {
      this.idb = createStore(DB_NAME, STORE_NAME);
      await get(KEY, this.idb);
    } catch {
      this.idb = null;
    }
    this.data = normalizeCompany(await this.readRaw());
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
}

export const companyStore = new CompanyStore();

// 백업 파일과 기기 옮기기에 회사도 같이 실려 가게 한다.
registerSavePart(COMPANY_GAME_ID, {
  async read() {
    await companyStore.load();
    return companyStore.data;
  },
  async write(raw) {
    await companyStore.load();
    // 이 게임이 생기기 전에 내보낸 묶음에는 회사가 아예 없다. 그때는 지금 회사를 그대로 둔다.
    if (raw === undefined) return;
    companyStore.set(normalizeCompany(raw));
  },
});
