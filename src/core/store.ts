/**
 * 세이브 데이터를 메모리에 들고 있다가 기기 안(IndexedDB)에 저장하는 저장소.
 * IndexedDB를 쓸 수 없는 환경에서는 localStorage로 물러난다.
 * 같은 기기에서 탭을 여러 개 열어 두면, 한 탭이 저장한 세이브를 다른 탭도 받아서 서로 덮어쓰지 않는다.
 */
import { createStore, get, set, type UseStore } from 'idb-keyval';
import type { DailyChallenge } from './daily';
import {
  applyPlayResult,
  buyCosmetic,
  claimAchievement,
  equipCosmetic,
  createDefaultSave,
  looksLikeSave,
  normalizeSave,
  resetProgress,
  type BuyResult,
  type ClaimAchievementResult,
  type PlayResult,
  type SaveData,
} from './save';

const DB_NAME = 'pocket-arcade';
const STORE_NAME = 'kv';
const SAVE_KEY = 'save';
const FALLBACK_KEY = 'pocket-arcade:save';
/** 탭끼리 세이브를 주고받는 통로의 이름 */
const CHANNEL_NAME = 'pocket-arcade:save';

type Listener = () => void;

class SaveStore {
  data: SaveData = createDefaultSave();

  private idb: UseStore | null = null;
  private readonly listeners = new Set<Listener>();
  private writeQueue: Promise<void> = Promise.resolve();
  private channel: BroadcastChannel | null = null;
  /** 이번에 앱을 켠 뒤로 저장 공간 보호를 요청했는지 */
  private persistenceRequested = false;

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
    this.openChannel();
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
    // 한 판이라도 했으면 지켜야 할 기록이 생긴 것이다.
    // 홈 화면에 설치하지 않고 브라우저로만 쓰는 경우에도 세이브를 지우지 말아 달라고 요청한다.
    if (!this.persistenceRequested) {
      this.persistenceRequested = true;
      void this.requestPersistence();
    }
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

  /** 달성한 업적의 보상을 받는다. */
  claimAchievement(achievementId: string): ClaimAchievementResult {
    const result = claimAchievement(this.data, achievementId);
    if (result.ok) {
      this.data = result.save;
      this.commit();
    }
    return result;
  }

  /**
   * 다른 곳에서 온 세이브(가져온 파일, 다른 기기에서 옮겨 온 것)로 바꾼다. 형식이 맞지 않으면 false.
   * 등불지기처럼 따로 저장되는 것까지 함께 옮기려면 core/bundle.ts를 쓴다.
   */
  importData(raw: unknown): boolean {
    if (!looksLikeSave(raw)) return false;
    this.data = normalizeSave(raw);
    // 예전에 내보낸 것이라도 지금 불러왔으니, 다른 탭이 가진 것보다 새것으로 친다.
    this.data.updatedAt = Date.now();
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
    try {
      this.channel?.postMessage(snapshot);
    } catch {
      // 다른 탭에 알리지 못해도 이 탭의 저장에는 영향이 없다.
    }
  }

  /** 다른 탭과 세이브를 주고받는 통로를 연다. 지원하지 않는 브라우저에서는 아무 일도 하지 않는다. */
  private openChannel(): void {
    if (this.channel || typeof BroadcastChannel === 'undefined') return;
    try {
      this.channel = new BroadcastChannel(CHANNEL_NAME);
      this.channel.onmessage = (event: MessageEvent<unknown>) => this.receive(event.data);
    } catch {
      this.channel = null;
    }
  }

  /**
   * 다른 탭이 저장한 세이브를 받아들인다. 저장은 보낸 탭이 이미 했으므로,
   * 여기서는 다시 저장하거나 방송하지 않는다(탭끼리 끝없이 주고받지 않도록).
   * 두 탭이 거의 동시에 저장했을 때 서로 엇갈리지 않게, 이 탭 것보다 오래된 세이브는 버린다.
   */
  private receive(raw: unknown): void {
    if (!looksLikeSave(raw)) return;
    const incoming = normalizeSave(raw);
    if (incoming.updatedAt < this.data.updatedAt) return;
    this.data = incoming;
    for (const listener of this.listeners) listener();
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
