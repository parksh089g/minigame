/**
 * 등불지기의 판 밖 진행: 불씨와 영구 강화.
 * 허브 세이브(core/save.ts)와 따로 기기 안에 저장해서 공용 세이브 구조를 건드리지 않는다.
 */
import { createStore, get, set, type UseStore } from 'idb-keyval';
import { registerSavePart } from '../../core/bundle';
import {
  addRun,
  CHALLENGES,
  createStats,
  getChallenge,
  isDone,
  normalizeStats,
  type LanternStats,
  type RunFeats,
} from './challenges';
import {
  HERO_ORDER,
  HEROES,
  LANTERN_GAME_ID,
  MAX_DEPTH,
  META,
  META_ORDER,
  STAGE_ORDER,
  STAGES,
  type HeroId,
  type MetaId,
  type StageId,
} from './data';
import { clampDepth, depthName, isUnlocked, metaCost, type Levels } from './rules';
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
  /**
   * 스테이지마다 열려 있는 깊은 밤의 가장 깊은 단계. 적혀 있지 않으면 0(보통 밤만 열림)이다.
   * 그 스테이지를 d단계로 완주하면 d+1단계가 열린다.
   */
  depths: Partial<Record<StageId, number>>;
  /** 준비 화면에서 고른 깊은 밤의 단계. 고른 스테이지에서 열린 단계를 넘지 않는다. */
  depth: number;
  /** 도전 과제를 재는 누적 기록 */
  stats: LanternStats;
  /** 보상을 받은 도전 과제의 id */
  claimed: string[];
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
    depths: {},
    depth: 0,
    stats: createStats(),
    claimed: [],
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
  const depths = typeof data.depths === 'object' && data.depths !== null ? data.depths : {};
  for (const id of STAGE_ORDER) {
    const open = clampDepth((depths as Record<string, unknown>)[id]);
    if (open > 0) meta.depths[id] = open;
  }
  // 깊은 밤이 생기기 전에 완주해 둔 저장이면(어느 스테이지였는지는 남아 있지 않다) 첫 스테이지의 깊은 밤 1을 열어 준다.
  // 지금은 완주하면 반드시 한 단계가 열리므로, 완주 기록이 있는데 열린 단계가 없는 것은 예전 저장뿐이다.
  if (meta.clears > 0 && STAGE_ORDER.every((id) => !meta.depths[id])) meta.depths[STAGE_ORDER[0]] = 1;
  meta.depth = Math.min(clampDepth(data.depth), openDepth(meta, meta.stage));
  meta.stats = normalizeStats(data.stats);
  // 완주한 기록은 있는데 가장 깊은 단계가 비어 있으면(도전 과제가 생기기 전의 저장) 보통 밤은 완주한 것으로 본다.
  if (meta.clears > 0 && meta.stats.deepest === 0) meta.stats.deepest = 1;
  const claimed = Array.isArray(data.claimed) ? data.claimed : [];
  meta.claimed = CHALLENGES.map((challenge) => challenge.id).filter((id) => claimed.includes(id));
  return meta;
}

/** 그 스테이지에서 열려 있는 깊은 밤의 가장 깊은 단계 */
export function openDepth(meta: LanternMeta, stage: StageId): number {
  return clampDepth(meta.depths[stage]);
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

/** 스테이지를 고른다. 아직 열리지 않았으면 그대로 돌려준다. 고른 단계가 새 스테이지에서 열리지 않았으면 열린 데까지 낮춘다. */
export function chooseStage(meta: LanternMeta, id: StageId): LanternMeta {
  if (meta.stage === id || !isUnlocked(STAGES[id], meta.bestSeconds)) return meta;
  return { ...meta, stage: id, depth: Math.min(meta.depth, openDepth(meta, id)) };
}

/** 깊은 밤의 단계를 고른다. 고른 스테이지에서 열린 단계를 벗어나면 그대로 돌려준다. */
export function chooseDepth(meta: LanternMeta, depth: number): LanternMeta {
  if (!Number.isInteger(depth) || depth < 0 || depth > openDepth(meta, meta.stage) || depth === meta.depth) return meta;
  return { ...meta, depth };
}

/** 이번 완주로 새로 열린 깊은 밤의 이름("밤의 풀밭 깊은 밤 1"). 열린 것이 없으면 null */
export function newDepth(before: LanternMeta, after: LanternMeta, stage: StageId): string | null {
  const opened = openDepth(after, stage);
  return opened > openDepth(before, stage) ? `${STAGES[stage].name} ${depthName(opened)}` : null;
}

/** 불씨로 영구 강화를 한 단계 올린다. 돈이 모자라거나 최대 단계면 그대로 돌려준다. */
export function buyMeta(meta: LanternMeta, id: MetaId): LanternMeta {
  const level = meta.upgrades[id] ?? 0;
  const cost = metaCost(id, level);
  if (cost === null || meta.embers < cost) return meta;
  return { ...meta, embers: meta.embers - cost, upgrades: { ...meta.upgrades, [id]: level + 1 } };
}

/** 한 판이 어떻게 끝났는지: 누가 어디서 무엇을 해냈는지(RunFeats)와 받은 불씨, 버틴 시간 */
export interface RunResult extends RunFeats {
  embers: number;
  seconds: number;
}

/** 한 판의 결과를 반영한다. 완주했으면 그 스테이지의 다음 깊은 밤이 열리고, 도전 과제의 기록이 쌓인다. */
export function applyRun(meta: LanternMeta, result: RunResult): LanternMeta {
  const depths = { ...meta.depths };
  if (result.cleared) {
    const next = Math.min(MAX_DEPTH, clampDepth(result.depth) + 1);
    if (next > openDepth(meta, result.stage)) depths[result.stage] = next;
  }
  return {
    ...meta,
    embers: meta.embers + Math.max(0, Math.floor(result.embers)),
    runs: meta.runs + 1,
    clears: meta.clears + (result.cleared ? 1 : 0),
    bestSeconds: Math.max(meta.bestSeconds, Math.floor(result.seconds)),
    depths,
    stats: addRun(meta.stats, result),
  };
}

/** 이룬 도전 과제의 보상을 받는다. 이루지 못했거나 이미 받았으면 그대로 돌려준다. */
export function claimChallenge(meta: LanternMeta, id: string): LanternMeta {
  const challenge = getChallenge(id);
  if (!challenge || meta.claimed.includes(id) || !isDone(challenge, meta)) return meta;
  return { ...meta, embers: meta.embers + challenge.reward, claimed: [...meta.claimed, id] };
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
