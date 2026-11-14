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
import { CODEX_IDS, discover, normalizeCodex } from './codex';
import {
  HERO_ORDER,
  HEROES,
  LANTERN_GAME_ID,
  MAX_DEPTH,
  META,
  META_ORDER,
  STAGE_ORDER,
  STAGES,
  WEAPON_ORDER,
  WEAPONS,
  type FeastId,
  type HeroId,
  type MetaId,
  type StageId,
  type WeaponId,
} from './data';
import {
  addDailyRun,
  addFriend,
  createDaily,
  DAILY_REWARD,
  normalizeDaily,
  normalizeFriend,
  type DailyRecord,
  type FriendScore,
} from './daily';
import { clampDepth, depthName, isFeast, isUnlocked, metaCost, metaLocked, type Levels } from './rules';
import { restoreRun, type RunState } from './sim';
import { normalizeTips, OLD_HAND_TIPS, type TipId } from './tips';

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
  /** 도감: 판에서 만난 그림자와 주운 것의 이름(codex.ts의 MET_IDS). 진화형은 stats.evolved가 가린다. */
  codex: string[];
  /** 도감에 새로 열렸는데 아직 들여다보지 않은 항목의 이름 */
  unread: string[];
  /** 이미 본 안내(tips.ts). 처음 겪는 일마다 한 번씩만 뜬다. */
  tips: TipId[];
  /** 오늘의 판(daily.ts)의 기록: 마지막으로 한 날과 그날의 최고 기록, 이어 온 날 수 */
  daily: DailyRecord;
  /** 공유받은 주소에 실려 온 친구의 오늘의 판 점수(daily.ts). 그날 동안 넘어 볼 기록으로 보인다. */
  friend: FriendScore | null;
  /** 들어온 줄 아는 캐릭터와 무기와 스테이지와 영구 강화. 업데이트로 여기 없는 것이 생기면 준비 화면이 한 번 알린다(announceNews). */
  known: string[];
  /** 새로 들어왔는데 아직 눌러 보지 않은 캐릭터. 준비 화면의 카드에 "새"가 붙는다. */
  fresh: HeroId[];
  /** 준비 화면에서 고른 잔치의 밤(data.ts의 FEAST)의 난이도. 꺼져 있으면 null이고, 열리기 전에는 늘 null이다. */
  feast: FeastId | null;
}

/** 지금 있는 캐릭터와 무기와 스테이지와 영구 강화 모두. 처음 하는 사람은 이것을 다 아는 것으로 친다(모두 처음 보므로 따로 알리지 않는다). */
const ALL_KNOWN: readonly string[] = [...HERO_ORDER, ...WEAPON_ORDER, ...STAGE_ORDER, ...META_ORDER];
/**
 * 들어온 줄 아는 것(known)이 적혀 있지 않은 예전 저장이 알던 것: 다섯 번째 캐릭터 달잡이와 열 번째 무기 등대빛이
 * 들어오기 전의 캐릭터 넷과 무기 아홉. 그 뒤로 들어온 것은 known에 없으면 알린다.
 */
const OLD_KNOWN: readonly string[] = [
  ...(['keeper', 'stargazer', 'stormer', 'ringer'] satisfies HeroId[]),
  ...(['ember', 'aura', 'firefly', 'star', 'lance', 'oil', 'bolt', 'bell', 'moon'] satisfies WeaponId[]),
];
/**
 * 스테이지도 알리게 되기 전(다섯 번째 스테이지 빛버섯 숲이 들어오기 전)의 저장이 알던 스테이지 넷.
 * 적어 둔 known에 스테이지가 하나도 없으면 이 넷을 아는 것으로 친다. 그래야 빛버섯 숲만 한 번 알린다.
 */
const OLD_STAGES: readonly StageId[] = ['meadow', 'marsh', 'ridge', 'tundra'];
/**
 * 영구 강화도 알리게 되기 전(새벽을 맞아야 열리는 다섯 가지가 들어오기 전)의 저장이 알던 영구 강화 열한 가지.
 * 적어 둔 known에 영구 강화가 하나도 없으면 이 열한 가지를 아는 것으로 친다. 그래야 새로 들어온 것만 한 번 알린다.
 */
const OLD_UPGRADES: readonly MetaId[] = [
  'vigor',
  'swift',
  'might',
  'greed',
  'reach',
  'mend',
  'lucky',
  'second',
  'armor',
  'reroll',
  'headstart',
];

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
    codex: [],
    unread: [],
    tips: [],
    daily: createDaily(),
    friend: null,
    known: [...ALL_KNOWN],
    fresh: [],
    feast: null,
  };
}

const isHero = (value: unknown): value is HeroId => typeof value === 'string' && value in HEROES;
const isStage = (value: unknown): value is StageId => typeof value === 'string' && value in STAGES;
const isUpgrade = (value: unknown): value is MetaId => typeof value === 'string' && value in META;

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
  // 도감이 생기기 전의 저장에는 만난 기록이 없다. 비운 채로 시작하고, 판을 하는 대로 채워진다.
  Object.assign(meta, normalizeCodex(data.codex, data.unread));
  // 안내가 생기기 전부터 하던 사람에게는 그때도 있던 일을 새삼 알려 주지 않는다.
  meta.tips = Array.isArray(data.tips) ? normalizeTips(data.tips) : meta.runs > 0 ? [...OLD_HAND_TIPS] : [];
  meta.daily = normalizeDaily(data.daily);
  meta.friend = normalizeFriend(data.friend);
  // 들어온 줄 아는 것이 적혀 있지 않으면, 처음 하는 사람은 지금 것을 모두 아는 것으로 치고
  // 그 전부터 하던 사람은 달잡이와 등대빛이 들어오기 전의 것만 아는 것으로 친다. 그래야 두 가지를 한 번 알린다.
  // 스테이지가 하나도 적혀 있지 않으면 빛버섯 숲이 들어오기 전의 넷을, 영구 강화가 하나도 적혀 있지 않으면
  // 새벽을 맞아야 열리는 다섯 가지가 들어오기 전의 열한 가지를 아는 것으로 친다.
  const saved: unknown[] = Array.isArray(data.known) ? data.known : meta.runs > 0 ? [...OLD_KNOWN] : [...ALL_KNOWN];
  const staged = saved.some(isStage) ? saved : [...saved, ...OLD_STAGES];
  const known = staged.some(isUpgrade) ? staged : [...staged, ...OLD_UPGRADES];
  meta.known = ALL_KNOWN.filter((id) => known.includes(id));
  const fresh = Array.isArray(data.fresh) ? data.fresh : [];
  meta.fresh = HERO_ORDER.filter((id) => fresh.includes(id));
  meta.feast = isFeast(data.feast) && feastOpen(meta) ? data.feast : null;
  return meta;
}

/** 잔치의 밤을 켤 수 있는지: 새벽을 한 번이라도 맞았으면 열린다. */
export function feastOpen(meta: Pick<LanternMeta, 'clears'>): boolean {
  return meta.clears > 0;
}

/** 잔치의 밤을 그 난이도로 켜거나, null이면 끈다. 바뀌는 것이 없거나 아직 열리지 않았으면 그대로 돌려준다. */
export function chooseFeast(meta: LanternMeta, level: FeastId | null): LanternMeta {
  const next = isFeast(level) ? level : null;
  if (meta.feast === next || (next !== null && !feastOpen(meta))) return meta;
  return { ...meta, feast: next };
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

/** 불씨로 영구 강화를 한 단계 올린다. 돈이 모자라거나 최대 단계이거나 아직 잠겨 있으면 그대로 돌려준다. */
export function buyMeta(meta: LanternMeta, id: MetaId): LanternMeta {
  const level = meta.upgrades[id] ?? 0;
  const cost = metaCost(id, level);
  if (cost === null || meta.embers < cost || metaLocked(id, meta.clears)) return meta;
  return { ...meta, embers: meta.embers - cost, upgrades: { ...meta.upgrades, [id]: level + 1 } };
}

/** 한 판이 어떻게 끝났는지: 누가 어디서 무엇을 해냈는지(RunFeats)와 받은 불씨, 버틴 시간 */
export interface RunResult extends RunFeats {
  embers: number;
  seconds: number;
  /** 그 판에서 만난 것(sim.ts의 state.seen). 도감에 적힌다. */
  seen?: readonly string[];
  /** 오늘의 판이었으면 그날과 그 판의 점수. 그날의 기록에 남고, 그날 처음이면 불씨가 더 붙는다. */
  daily?: { day: number; score: number };
}

/** 한 판의 결과를 반영한다. 완주했으면 그 스테이지의 다음 깊은 밤이 열리고, 도전 과제의 기록이 쌓인다. */
export function applyRun(meta: LanternMeta, result: RunResult): LanternMeta {
  const depths = { ...meta.depths };
  if (result.cleared) {
    const next = Math.min(MAX_DEPTH, clampDepth(result.depth) + 1);
    if (next > openDepth(meta, result.stage)) depths[result.stage] = next;
  }
  const daily = result.daily
    ? addDailyRun(meta.daily, result.daily.day, {
        score: result.daily.score,
        seconds: result.seconds,
        cleared: result.cleared,
      })
    : null;
  return {
    ...meta,
    embers: meta.embers + Math.max(0, Math.floor(result.embers)) + (daily?.first ? DAILY_REWARD : 0),
    runs: meta.runs + 1,
    clears: meta.clears + (result.cleared ? 1 : 0),
    bestSeconds: Math.max(meta.bestSeconds, Math.floor(result.seconds)),
    depths,
    stats: addRun(meta.stats, { ...result, dailyFirst: daily?.first ?? false }),
    ...discover(meta, result.seen ?? [], result.evolved),
    daily: daily ? daily.record : meta.daily,
  };
}

/** 도감에서 그 항목들을 들여다봤다고 적는다. 새로 열렸다는 표시가 사라진다. */
export function readEntries(meta: LanternMeta, ids: readonly string[]): LanternMeta {
  const unread = meta.unread.filter((id) => !ids.includes(id));
  return unread.length === meta.unread.length ? meta : { ...meta, unread };
}

/** 업데이트로 새로 들어왔는데 아직 알리지 않은 캐릭터와 무기와 스테이지와 영구 강화 */
export interface News {
  heroes: HeroId[];
  weapons: WeaponId[];
  stages: StageId[];
  upgrades: MetaId[];
}

export function unknownNews(meta: LanternMeta): News {
  return {
    heroes: HERO_ORDER.filter((id) => !meta.known.includes(id)),
    weapons: WEAPON_ORDER.filter((id) => !meta.known.includes(id)),
    stages: STAGE_ORDER.filter((id) => !meta.known.includes(id)),
    upgrades: META_ORDER.filter((id) => !meta.known.includes(id)),
  };
}

export const hasNews = (news: News): boolean =>
  news.heroes.length > 0 || news.weapons.length > 0 || news.stages.length > 0 || news.upgrades.length > 0;

/**
 * 새로 들어온 것을 알리는 한 줄. 예: "새 캐릭터 달잡이 · 새 무기 등대빛 · 새 스테이지 빛버섯 숲 · 새 영구 강화 5가지".
 * 영구 강화는 여럿이 한꺼번에 들어오면 이름을 늘어놓지 않고 몇 가지인지만 적는다(준비 화면의 한 줄에 다 들어가지 않는다).
 */
export function newsLine(news: News): string {
  const parts: string[] = [];
  if (news.heroes.length > 0) parts.push(`새 캐릭터 ${news.heroes.map((id) => HEROES[id].name).join(', ')}`);
  if (news.weapons.length > 0) parts.push(`새 무기 ${news.weapons.map((id) => WEAPONS[id].name).join(', ')}`);
  if (news.stages.length > 0) parts.push(`새 스테이지 ${news.stages.map((id) => STAGES[id].name).join(', ')}`);
  if (news.upgrades.length === 1) parts.push(`새 영구 강화 ${META[news.upgrades[0]].name}`);
  else if (news.upgrades.length > 1) parts.push(`새 영구 강화 ${news.upgrades.length}가지`);
  return parts.join(' · ');
}

/**
 * 새로 들어온 것을 알렸다고 적는다. 새 캐릭터는 눌러 볼 때까지 카드에 "새"가 붙고(fresh),
 * 새 무기는 도감에서 새로 열린 항목처럼 들여다볼 때까지 점이 붙는다(unread). 스테이지와 영구 강화는 한 줄로만 알린다.
 * 알릴 것이 없으면 그대로 돌려준다.
 */
export function announceNews(meta: LanternMeta): LanternMeta {
  const news = unknownNews(meta);
  if (!hasNews(news)) return meta;
  const weapons: readonly string[] = news.weapons;
  return {
    ...meta,
    known: [...ALL_KNOWN],
    fresh: HERO_ORDER.filter((id) => meta.fresh.includes(id) || news.heroes.includes(id)),
    unread: CODEX_IDS.filter((id) => meta.unread.includes(id) || weapons.includes(id)),
  };
}

/** 캐릭터 카드를 눌러 봤다고 적는다. 그 카드의 "새"가 사라진다. 붙어 있지 않았으면 그대로 돌려준다. */
export function meetHero(meta: LanternMeta, id: HeroId): LanternMeta {
  return meta.fresh.includes(id) ? { ...meta, fresh: meta.fresh.filter((hero) => hero !== id) } : meta;
}

/** 공유받은 주소에 실려 온 친구의 그날 점수를 적는다. 그날 받은 것보다 높지 않으면 그대로 돌려준다. */
export function meetFriend(meta: LanternMeta, day: number, score: number): LanternMeta {
  const friend = addFriend(meta.friend, day, score);
  return friend === meta.friend ? meta : { ...meta, friend };
}

/** 그 안내를 봤다고 적는다. 이미 봤으면 그대로 돌려준다. */
export function learnTip(meta: LanternMeta, id: TipId): LanternMeta {
  return meta.tips.includes(id) ? meta : { ...meta, tips: [...meta.tips, id] };
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
/** 진행과 판을 저장한 때. 다른 곳이 그사이 더 새것을 저장했는지 이것으로 가린다. */
const META_AT_KEY = 'meta-at';
const RUN_AT_KEY = 'run-at';
const META_AT_FALLBACK_KEY = 'pocket-arcade:lantern-meta-at';
const RUN_AT_FALLBACK_KEY = 'pocket-arcade:lantern-run-at';
/** 같은 기기에 열린 다른 곳과 진행을 주고받는 통로의 이름 */
const CHANNEL_NAME = 'pocket-arcade:lantern';

/** 같은 기기에 열린 다른 곳과 주고받는 말. 저장은 보낸 곳이 이미 했다. */
type Note =
  /** 판 밖 진행(불씨, 강화, 기록)을 저장했다. */
  | { kind: 'meta'; at: number; meta: LanternMeta }
  /** 하던 판을 저장했다. run이 null이면 지웠다는 뜻이다. */
  | { kind: 'run'; at: number; run: RunState | null };

/** 다른 곳에서 바뀐 것. 판 밖 진행인지, 하던 판인지 */
export interface StoreChange {
  meta: boolean;
  run: boolean;
}

type Listener = (change: StoreChange) => void;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toStamp = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);

/**
 * 같은 기기에서 앱을 두 곳(설치한 앱과 브라우저 탭 같은)에 열어 두어도 서로의 진행을 덮어쓰지 않게 한다.
 * 저장할 때마다 다른 곳에 바로 알려서 모두 같은 진행을 들고 있게 하고, 듣지 못했을 때(뒤에서 잠들어 있던 곳)를 위해
 * 저장한 때를 함께 적어 두었다가 화면이 다시 보일 때와 준비 화면을 열 때 더 새것이 있으면 읽어 온다.
 */
export class MetaStore {
  data: LanternMeta = createDefaultMeta();
  /** 도중에 멈춘 판. 이어서 할 수 있다. */
  run: RunState | null = null;
  private idb: UseStore | null = null;
  private loaded: Promise<void> | null = null;
  /** 처음 읽기를 마쳤는지 */
  private ready = false;
  private writeQueue: Promise<void> = Promise.resolve();
  /** 지금 가진 진행과 판을 저장한(또는 다른 곳에서 받은) 때. 다른 곳의 것은 이보다 새것만 받는다. */
  private metaAt = 0;
  private runAt = 0;
  private channel: BroadcastChannel | null = null;
  private readonly listeners = new Set<Listener>();

  /** 처음 부를 때만 실제로 읽는다. */
  load(): Promise<void> {
    this.loaded ??= this.read();
    return this.loaded;
  }

  /**
   * 기기에 저장된 것이 이 곳이 가진 것보다 새것이면 그것으로 바꾼다(다른 곳이 그사이 저장한 것).
   * 아직 읽기 전이면 처음 읽기만 한다. 바뀐 것이 있으면 onChange로도 알린다.
   */
  async refresh(): Promise<void> {
    if (!this.ready) {
      await this.load();
      return;
    }
    // 이 곳이 저장하던 것이 다 들어간 뒤에 읽는다.
    await this.writeQueue;
    const change: StoreChange = { meta: false, run: false };
    const metaAt = toStamp(await this.readKey(META_AT_KEY, META_AT_FALLBACK_KEY));
    if (metaAt > this.metaAt) {
      const raw = await this.readKey(KEY, FALLBACK_KEY);
      // 읽는 사이에 이 곳에서 저장했으면 그것을 둔다.
      if (metaAt > this.metaAt) {
        this.data = normalizeMeta(raw);
        this.metaAt = metaAt;
        change.meta = true;
      }
    }
    const runAt = toStamp(await this.readKey(RUN_AT_KEY, RUN_AT_FALLBACK_KEY));
    if (runAt > this.runAt) {
      const raw = await this.readKey(RUN_KEY, RUN_FALLBACK_KEY);
      if (runAt > this.runAt) {
        this.run = restoreRun(raw);
        this.runAt = runAt;
        change.run = true;
      }
    }
    if (change.meta || change.run) this.emit(change);
  }

  /** 다른 곳에서 저장한 진행이나 판을 받았을 때 불린다. 구독을 끊는 함수를 돌려준다. */
  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 대기 중인 저장이 끝날 때까지 기다린다. */
  flush(): Promise<void> {
    return this.writeQueue;
  }

  set(next: LanternMeta, now: number = Date.now()): void {
    this.data = next;
    // 다른 곳에서 받은 것보다 늘 뒤가 되게 한다. 같은 때(1ms 안)에 저장해도 이 저장이 새것이도록.
    const at = Math.max(now, this.metaAt + 1);
    this.metaAt = at;
    const snapshot = structuredClone(next);
    // 진행을 먼저, 저장한 때를 나중에 적는다. 다른 곳이 때를 먼저 읽으므로 새 때와 낡은 진행을 함께 읽는 일이 없다.
    this.enqueue(KEY, FALLBACK_KEY, snapshot);
    this.enqueue(META_AT_KEY, META_AT_FALLBACK_KEY, at);
    this.post({ kind: 'meta', at, meta: snapshot });
  }

  /** 진행 중인 판을 저장한다. null이면 지운다. */
  setRun(run: RunState | null, now: number = Date.now()): void {
    this.run = run ? structuredClone(run) : null;
    const at = Math.max(now, this.runAt + 1);
    this.runAt = at;
    this.enqueue(RUN_KEY, RUN_FALLBACK_KEY, this.run);
    this.enqueue(RUN_AT_KEY, RUN_AT_FALLBACK_KEY, at);
    this.post({ kind: 'run', at, run: this.run });
  }

  private async read(): Promise<void> {
    // 읽는 사이에 다른 곳이 저장한 것도 놓치지 않게 통로부터 연다.
    this.openChannel();
    try {
      this.idb = createStore(DB_NAME, STORE_NAME);
      await get(KEY, this.idb);
    } catch {
      this.idb = null;
    }
    // 읽는 사이에 다른 곳에서 더 새것을 받았으면 그것을 둔다. 때가 적혀 있지 않은 예전 저장은 0으로 친다.
    const metaAt = toStamp(await this.readKey(META_AT_KEY, META_AT_FALLBACK_KEY));
    const meta = normalizeMeta(await this.readKey(KEY, FALLBACK_KEY));
    if (this.metaAt === 0 || metaAt > this.metaAt) {
      this.data = meta;
      this.metaAt = metaAt;
    }
    const runAt = toStamp(await this.readKey(RUN_AT_KEY, RUN_AT_FALLBACK_KEY));
    const run = restoreRun(await this.readKey(RUN_KEY, RUN_FALLBACK_KEY));
    if (this.runAt === 0 || runAt > this.runAt) {
      this.run = run;
      this.runAt = runAt;
    }
    this.ready = true;
    // 뒤에서 잠들어 있다가 다시 보이면, 그사이 다른 곳이 저장한 것을 읽어 온다.
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) void this.refresh();
      });
    }
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

  /** 다른 곳과 진행을 주고받는 통로를 연다. 지원하지 않는 브라우저에서는 아무 일도 하지 않는다. */
  private openChannel(): void {
    if (this.channel || typeof BroadcastChannel === 'undefined') return;
    try {
      this.channel = new BroadcastChannel(CHANNEL_NAME);
      this.channel.onmessage = (event: MessageEvent<unknown>) => this.receive(event.data);
      // 브라우저 밖(테스트)에서는 열어 둔 통로가 프로세스를 붙잡지 않게 한다.
      (this.channel as { unref?: () => void }).unref?.();
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

  /** 다른 곳에서 온 말을 받는다. 이 곳 것보다 새것만 받고, 저장은 보낸 곳이 이미 했으므로 다시 저장하지 않는다. */
  private receive(raw: unknown): void {
    if (!isObject(raw) || typeof raw.at !== 'number') return;
    if (raw.kind === 'meta') {
      if (raw.at <= this.metaAt) return;
      this.data = normalizeMeta(raw.meta);
      this.metaAt = raw.at;
      this.emit({ meta: true, run: false });
    } else if (raw.kind === 'run') {
      if (raw.at <= this.runAt) return;
      this.run = restoreRun(raw.run);
      this.runAt = raw.at;
      this.emit({ meta: false, run: true });
    }
  }

  private emit(change: StoreChange): void {
    for (const listener of this.listeners) listener(change);
  }
}

export const metaStore = new MetaStore();

// 백업 파일과 기기 옮기기에 등불지기의 진행(불씨, 영구 강화, 하던 판)도 같이 실려 가게 한다.
registerSavePart(LANTERN_GAME_ID, {
  async read(lean) {
    // 다른 곳(다른 탭)에서 더 늦게 저장한 것이 있으면 그것을 내보낸다.
    await metaStore.refresh();
    return { meta: metaStore.data, run: lean ? null : metaStore.run };
  },
  async write(raw) {
    await metaStore.load();
    const data = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
    metaStore.set(normalizeMeta(data.meta));
    metaStore.setRun(restoreRun(data.run));
  },
});
