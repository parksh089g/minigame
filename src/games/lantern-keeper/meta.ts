/**
 * 등불지기의 판 밖 진행: 불씨와 영구 강화.
 * 허브 세이브(core/save.ts)와 따로 기기 안에 저장해서 공용 세이브 구조를 건드리지 않는다.
 */
import { createStore, get, set, type UseStore } from 'idb-keyval';
import { registerSavePart } from '../../core/bundle';
import {
  HERO_ORDER,
  HEROES,
  LANTERN_GAME_ID,
  META,
  META_ORDER,
  STAGE_ORDER,
  STAGES,
  type HeroId,
  type MetaId,
  type StageId,
} from './data';
import { isUnlocked, metaCost, type Levels } from './rules';
import { restoreRun, type RunState } from './sim';

export const META_VERSION = 2;

export interface LanternMeta {
  version: number;
  embers: number;
  upgrades: Levels<MetaId>;
  runs: number;
  clears: number;
  bestSeconds: number;
  /** 준비 화면에서 고른 캐릭터와 스테이지. 다음에 들어와도 그대로다. */
  hero: HeroId;
  stage: StageId;
}

export function createDefaultMeta(): LanternMeta {
  return {
    version: META_VERSION,
    embers: 0,
    upgrades: {},
    runs: 0,
    clears: 0,
    bestSeconds: 0,
    hero: 'keeper',
    stage: 'meadow',
  };
}

const isHero = (value: unknown): value is HeroId => typeof value === 'string' && value in HEROES;
const isStage = (value: unknown): value is StageId => typeof value === 'string' && value in STAGES;

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

/** 저장된 값을 믿을 수 있는 모양으로 맞춘다. 모르는 항목은 버리고 빠진 항목은 기본값으로 채운다. */
export function normalizeMeta(raw: unknown): LanternMeta {
  const meta = createDefaultMeta();
  if (typeof raw !== 'object' || raw === null) return meta;
  const data = raw as Record<string, unknown>;
  meta.embers = count(data.embers);
  meta.runs = count(data.runs);
  meta.clears = count(data.clears);
  meta.bestSeconds = count(data.bestSeconds);
  const upgrades = typeof data.upgrades === 'object' && data.upgrades !== null ? data.upgrades : {};
  for (const id of META_ORDER) {
    const level = Math.min(count((upgrades as Record<string, unknown>)[id]), META[id].maxLevel);
    if (level > 0) meta.upgrades[id] = level;
  }
  // 아직 열리지 않은 것이 골라져 있으면 기본으로 돌린다.
  if (isHero(data.hero) && isUnlocked(HEROES[data.hero], meta.bestSeconds)) meta.hero = data.hero;
  if (isStage(data.stage) && isUnlocked(STAGES[data.stage], meta.bestSeconds)) meta.stage = data.stage;
  return meta;
}

/** 최고 기록이 before에서 after(초)로 늘면서 새로 열린 캐릭터와 스테이지의 이름 */
export function newUnlocks(before: number, after: number): string[] {
  const opened = (item: { unlockSeconds: number }): boolean => !isUnlocked(item, before) && isUnlocked(item, after);
  return [
    ...HERO_ORDER.filter((id) => opened(HEROES[id])).map((id) => HEROES[id].name),
    ...STAGE_ORDER.filter((id) => opened(STAGES[id])).map((id) => STAGES[id].name),
  ];
}

/** 캐릭터를 고른다. 아직 열리지 않았으면 그대로 돌려준다. */
export function chooseHero(meta: LanternMeta, id: HeroId): LanternMeta {
  if (meta.hero === id || !isUnlocked(HEROES[id], meta.bestSeconds)) return meta;
  return { ...meta, hero: id };
}

/** 스테이지를 고른다. 아직 열리지 않았으면 그대로 돌려준다. */
export function chooseStage(meta: LanternMeta, id: StageId): LanternMeta {
  if (meta.stage === id || !isUnlocked(STAGES[id], meta.bestSeconds)) return meta;
  return { ...meta, stage: id };
}

/** 불씨로 영구 강화를 한 단계 올린다. 돈이 모자라거나 최대 단계면 그대로 돌려준다. */
export function buyMeta(meta: LanternMeta, id: MetaId): LanternMeta {
  const level = meta.upgrades[id] ?? 0;
  const cost = metaCost(id, level);
  if (cost === null || meta.embers < cost) return meta;
  return { ...meta, embers: meta.embers - cost, upgrades: { ...meta.upgrades, [id]: level + 1 } };
}

/** 한 판의 결과를 반영한다. */
export function applyRun(meta: LanternMeta, embers: number, seconds: number, cleared: boolean): LanternMeta {
  return {
    ...meta,
    embers: meta.embers + Math.max(0, Math.floor(embers)),
    runs: meta.runs + 1,
    clears: meta.clears + (cleared ? 1 : 0),
    bestSeconds: Math.max(meta.bestSeconds, Math.floor(seconds)),
  };
}

const DB_NAME = 'pocket-arcade-lantern';
const STORE_NAME = 'kv';
const KEY = 'meta';
const RUN_KEY = 'run';
const FALLBACK_KEY = 'pocket-arcade:lantern-meta';
const RUN_FALLBACK_KEY = 'pocket-arcade:lantern-run';

class MetaStore {
  data: LanternMeta = createDefaultMeta();
  /** 도중에 멈춘 판. 이어서 할 수 있다. */
  run: RunState | null = null;
  private idb: UseStore | null = null;
  private loaded: Promise<void> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  /** 처음 부를 때만 실제로 읽는다. */
  load(): Promise<void> {
    this.loaded ??= this.read();
    return this.loaded;
  }

  set(next: LanternMeta): void {
    this.data = next;
    this.enqueue(KEY, FALLBACK_KEY, structuredClone(next));
  }

  /** 진행 중인 판을 저장한다. null이면 지운다. */
  setRun(run: RunState | null): void {
    this.run = run ? structuredClone(run) : null;
    this.enqueue(RUN_KEY, RUN_FALLBACK_KEY, this.run);
  }

  private async read(): Promise<void> {
    try {
      this.idb = createStore(DB_NAME, STORE_NAME);
      await get(KEY, this.idb);
    } catch {
      this.idb = null;
    }
    this.data = normalizeMeta(await this.readKey(KEY, FALLBACK_KEY));
    this.run = restoreRun(await this.readKey(RUN_KEY, RUN_FALLBACK_KEY));
  }

  private async readKey(key: string, fallbackKey: string): Promise<unknown> {
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

  private enqueue(key: string, fallbackKey: string, snapshot: unknown): void {
    this.writeQueue = this.writeQueue.then(() => this.write(key, fallbackKey, snapshot));
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

export const metaStore = new MetaStore();

// 백업 파일과 기기 옮기기에 등불지기의 진행(불씨, 영구 강화, 하던 판)도 같이 실려 가게 한다.
registerSavePart(LANTERN_GAME_ID, {
  async read(lean) {
    await metaStore.load();
    return { meta: metaStore.data, run: lean ? null : metaStore.run };
  },
  async write(raw) {
    await metaStore.load();
    const data = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
    metaStore.set(normalizeMeta(data.meta));
    metaStore.setRun(restoreRun(data.run));
  },
});
