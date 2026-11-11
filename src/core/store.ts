/**
 * 세이브 데이터를 메모리에 들고 있다가 기기 안(IndexedDB)에 저장하는 저장소.
 * IndexedDB를 쓸 수 없는 환경에서는 localStorage로 물러난다.
 */
import { createStore, get, set, type UseStore } from 'idb-keyval';
import type { DailyChallenge } from './daily';
import {
  applyPlayResult,
  buyCosmetic,
  equipCosmetic,
  createDefaultSave,
  looksLikeSave,
  normalizeSave,
  resetProgress,
  type BuyResult,
  type PlayResult,
  type SaveData,
} from './save';

const DB_NAME = 'pocket-arcade';
const STORE_NAME = 'kv';
const SAVE_KEY = 'save';
const FALLBACK_KEY = 'pocket-arcade:save';

type Listener = () => void;

class SaveStore {
  data: SaveData = createDefaultSave();

  private idb: UseStore | null = null;
  private readonly listeners = new Set<Listener>();
  private writeQueue: Promise<void> = Promise.resolve();

  /** 앱을 시작할 때 한 번 부른다. 실패해도 기본 세이브로 계속 진행한다. */
  async load(): Promise<void> {
    let raw: unknown;
    try {
      this.idb = createStore(DB_NAME, STORE_NAME);
      raw = await get(SAVE_KEY, this.idb);
    } catch {
      this.idb = null;
    }
    if (raw === undefined) raw = this.readFallback();
    this.data = normalizeSave(raw);
  }

  /** 데이터가 바뀔 때마다 불린다. 구독을 끊는 함수를 돌려준다. */
  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 세이브를 고치고 저장한다. */
  update(mutate: (data: SaveData) => void): void {
    mutate(this.data);
    this.data.updatedAt = Date.now();
    this.commit();
  }

  /** 한 판의 결과(점수, 얻은 코인)를 기록한다. challenge를 주면 오늘의 도전 달성도 함께 따진다. */
  recordPlay(
    gameId: string,
    score: number,
    coins: number,
    challenge: DailyChallenge | null = null,
  ): PlayResult {
    const result = applyPlayResult(this.data, gameId, score, coins, Date.now(), challenge);
    this.data = result.save;
    this.commit();
    return result;
  }

  /** 코인으로 꾸미기를 사서 바로 끼운다. */
  buyCosmetic(itemId: string): BuyResult {
    const result = buyCosmetic(this.data, itemId);
    if (result.ok) {
      this.data = result.save;
      this.commit();
    }
    return result;
  }

  /** 가진 꾸미기로 바꿔 끼운다. 바뀌었으면 true. */
  equipCosmetic(itemId: string): boolean {
    const next = equipCosmetic(this.data, itemId);
    if (next === this.data) return false;
    this.data = next;
    this.commit();
    return true;
  }

  exportJson(): string {
    return JSON.stringify(this.data, null, 2);
  }

  /** 내보낸 파일의 내용을 불러온다. 형식이 맞지 않으면 false. */
  importJson(text: string): boolean {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return false;
    }
    if (!looksLikeSave(parsed)) return false;
    this.data = normalizeSave(parsed);
    this.commit();
    return true;
  }

  resetProgress(): void {
    this.data = resetProgress(this.data);
    this.commit();
  }

  /** 브라우저가 저장 공간을 임의로 비우지 않도록 요청한다. 지원하지 않으면 null. */
  async requestPersistence(): Promise<boolean | null> {
    try {
      if (!navigator.storage?.persist) return null;
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    } catch {
      return null;
    }
  }

  async isPersisted(): Promise<boolean | null> {
    try {
      if (!navigator.storage?.persisted) return null;
      return await navigator.storage.persisted();
    } catch {
      return null;
    }
  }

  /** 대기 중인 저장이 끝날 때까지 기다린다. */
  flush(): Promise<void> {
    return this.writeQueue;
  }

  private commit(): void {
    for (const listener of this.listeners) listener();
    const snapshot = structuredClone(this.data);
    this.writeQueue = this.writeQueue.then(() => this.write(snapshot));
  }

  private async write(snapshot: SaveData): Promise<void> {
    if (this.idb) {
      try {
        await set(SAVE_KEY, snapshot, this.idb);
        return;
      } catch {
        // 아래 localStorage 저장으로 넘어간다.
      }
    }
    try {
      localStorage.setItem(FALLBACK_KEY, JSON.stringify(snapshot));
    } catch {
      // 저장할 곳이 없으면 이번 세션 동안만 메모리에 유지된다.
    }
  }

  private readFallback(): unknown {
    try {
      const text = localStorage.getItem(FALLBACK_KEY);
      return text ? JSON.parse(text) : undefined;
    } catch {
      return undefined;
    }
  }
}

export const store = new SaveStore();
