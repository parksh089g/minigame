/**
 * 등불지기의 도전 과제: 여러 판에 걸쳐 이루는 목표. 이루면 준비 화면에서 불씨를 받는다.
 * 허브의 업적(core/achievements.ts)과는 따로다. 허브 업적은 코인을 주고, 여기는 등불지기 안에서 쓰는 불씨를 준다.
 * 화면에 의존하지 않는 순수한 값과 함수만 둔다.
 */
import { HERO_ORDER, MAX_DEPTH, STAGE_ORDER, WEAPON_ORDER, type HeroId, type StageId, type WeaponId } from './data';

/** 도전 과제를 재는 데 쓰는 누적 기록. 한 판이 끝날 때마다 쌓인다(meta.ts의 applyRun). */
export interface LanternStats {
  /** 쓰러뜨린 그림자의 합. 점수와 같이 마지막 보스가 나타나기 전까지만 센다. */
  kills: number;
  /** 쓰러뜨린 보스의 합 */
  bossKills: number;
  /** 한 판에서 오른 가장 높은 레벨 */
  bestLevel: number;
  /** 한 판에서 진화시킨 무기 수의 최고 기록 */
  bestEvolved: number;
  /** 완주한 가장 깊은 밤의 단계 + 1. 완주한 적이 없으면 0, 보통 밤만 완주했으면 1 */
  deepest: number;
  /** 한 번이라도 진화시켜 본 무기 */
  evolved: WeaponId[];
  /** 완주해 본 캐릭터 */
  heroes: HeroId[];
  /** 완주해 본 스테이지 */
  stages: StageId[];
  /** 오늘의 판을 한 날 수 */
  dailyDays: number;
  /** 끝없는 밤에서 가장 오래 버틴 시간(초) */
  bestEndless: number;
  /** 지금까지 연 보물 상자 */
  chests: number;
}

export function createStats(): LanternStats {
  return { kills: 0, bossKills: 0, bestLevel: 0, bestEvolved: 0, deepest: 0, evolved: [], heroes: [], stages: [], dailyDays: 0, bestEndless: 0, chests: 0 };
}

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

/** 저장된 값 가운데 order에 있는 것만, order의 차례로, 겹치지 않게 추린다. */
function known<T extends string>(raw: unknown, order: readonly T[]): T[] {
  return Array.isArray(raw) ? order.filter((id) => raw.includes(id)) : [];
}

/** 저장된 기록을 믿을 수 있는 모양으로 맞춘다. */
export function normalizeStats(raw: unknown): LanternStats {
  const stats = createStats();
  if (typeof raw !== 'object' || raw === null) return stats;
  const data = raw as Record<string, unknown>;
  stats.kills = count(data.kills);
  stats.bossKills = count(data.bossKills);
  stats.bestLevel = count(data.bestLevel);
  stats.bestEvolved = Math.min(count(data.bestEvolved), WEAPON_ORDER.length);
  stats.deepest = Math.min(count(data.deepest), MAX_DEPTH + 1);
  stats.evolved = known(data.evolved, WEAPON_ORDER);
  stats.heroes = known(data.heroes, HERO_ORDER);
  stats.stages = known(data.stages, STAGE_ORDER);
  stats.dailyDays = count(data.dailyDays);
  stats.bestEndless = count(data.bestEndless);
  stats.chests = count(data.chests);
  return stats;
}

/** 한 판이 도전 과제의 기록에 보태는 것 */
export interface RunFeats {
  cleared: boolean;
  hero: HeroId;
  stage: StageId;
  depth: number;
  /** 점수에 센 처치 수 */
  kills: number;
  bossKills: number;
  level: number;
  /** 판이 끝났을 때 진화해 있던 무기 */
  evolved: readonly WeaponId[];
  /** 그날 처음 마친 오늘의 판인지 */
  dailyFirst?: boolean;
  /** 끝없는 밤에서 버틴 시간(초). 끝없는 밤에 들어가지 않았으면 0이거나 없다. */
  endlessSeconds?: number;
  /** 이 판에서 연 보물 상자의 수 */
  chests?: number;
}

const withItem = <T extends string>(list: readonly T[], item: T, order: readonly T[]): T[] =>
  order.filter((id) => id === item || list.includes(id));

/** 한 판의 결과를 누적 기록에 보탠다. */
export function addRun(stats: LanternStats, run: RunFeats): LanternStats {
  const evolved = WEAPON_ORDER.filter((id) => stats.evolved.includes(id) || run.evolved.includes(id));
  return {
    kills: stats.kills + count(run.kills),
    bossKills: stats.bossKills + count(run.bossKills),
    bestLevel: Math.max(stats.bestLevel, count(run.level)),
    bestEvolved: Math.max(stats.bestEvolved, new Set(run.evolved).size),
    deepest: run.cleared ? Math.max(stats.deepest, Math.min(MAX_DEPTH, count(run.depth)) + 1) : stats.deepest,
    evolved,
    heroes: run.cleared ? withItem(stats.heroes, run.hero, HERO_ORDER) : stats.heroes,
    stages: run.cleared ? withItem(stats.stages, run.stage, STAGE_ORDER) : stats.stages,
    dailyDays: stats.dailyDays + (run.dailyFirst ? 1 : 0),
    bestEndless: Math.max(stats.bestEndless, count(run.endlessSeconds)),
    chests: stats.chests + count(run.chests),
  };
}

/** 도전 과제가 보는 것: 완주한 횟수와 누적 기록 */
export interface ChallengeSource {
  clears: number;
  stats: LanternStats;
}

export interface Challenge {
  /** 세이브에 쓰는 id. 한 번 정하면 바꾸지 않는다. */
  id: string;
  /** 한글 8자 안팎 */
  title: string;
  /** 무엇을 하면 되는지. 목록 한 줄에 들어가도록 한글 14자 안팎 */
  description: string;
  /** 이 값 이상이면 달성 */
  goal: number;
  /** 보상 불씨 */
  reward: number;
  /** 지금까지의 진행 */
  measure: (source: ChallengeSource) => number;
}

/** 깊은 밤 depth단계를 완주했으면 1 */
const clearedDepth =
  (depth: number) =>
  (source: ChallengeSource): number =>
    source.stats.deepest > depth ? 1 : 0;

/** 쉬운 것부터 어려운 것의 차례. 준비 화면에 이 차례로 보인다. */
export const CHALLENGES: readonly Challenge[] = [
  { id: 'evolve-1', title: '첫 진화', description: '무기 하나를 진화시키기', goal: 1, reward: 20, measure: (s) => s.stats.evolved.length },
  { id: 'dawn-1', title: '첫 새벽', description: '끝까지 버텨 새벽 맞기', goal: 1, reward: 30, measure: (s) => s.clears },
  { id: 'kills-10k', title: '그림자 청소', description: '그림자 1만 마리 쓰러뜨리기', goal: 10_000, reward: 50, measure: (s) => s.stats.kills },
  { id: 'level-40', title: '눈부신 성장', description: '한 판에 레벨 40 되기', goal: 40, reward: 50, measure: (s) => s.stats.bestLevel },
  { id: 'marsh-dawn', title: '늪의 새벽', description: '안개 늪에서 새벽 맞기', goal: 1, reward: 60, measure: (s) => (s.stats.stages.includes('marsh') ? 1 : 0) },
  { id: 'ridge-dawn', title: '고개의 새벽', description: '잿빛 고개에서 새벽 맞기', goal: 1, reward: 80, measure: (s) => (s.stats.stages.includes('ridge') ? 1 : 0) },
  { id: 'boss-25', title: '보스 사냥꾼', description: '보스 25마리 쓰러뜨리기', goal: 25, reward: 60, measure: (s) => s.stats.bossKills },
  { id: 'evolve-3', title: '세 갈래 빛', description: '한 판에 무기 셋 진화시키기', goal: 3, reward: 80, measure: (s) => s.stats.bestEvolved },
  { id: 'deep-1', title: '더 깊은 곳으로', description: '깊은 밤 1에서 새벽 맞기', goal: 1, reward: 80, measure: clearedDepth(1) },
  { id: 'chests-25', title: '보물 사냥꾼', description: '보물 상자 25개 열기', goal: 25, reward: 80, measure: (s) => s.stats.chests },
  { id: 'dawn-10', title: '새벽 단골', description: '새벽을 열 번 맞기', goal: 10, reward: 80, measure: (s) => s.clears },
  { id: 'heroes-all', title: '모두의 새벽', description: '세 캐릭터로 새벽 맞기', goal: 3, reward: 100, measure: (s) => s.stats.heroes.length },
  { id: 'heroes-every', title: '넷의 새벽', description: '네 캐릭터 모두로 새벽 맞기', goal: HERO_ORDER.length, reward: 120, measure: (s) => s.stats.heroes.length },
  { id: 'daily-7', title: '일곱 밤의 약속', description: '오늘의 판을 일곱 날 하기', goal: 7, reward: 100, measure: (s) => s.stats.dailyDays },
  { id: 'endless-3', title: '밤을 넘어서', description: '끝없는 밤에서 3분 버티기', goal: 3, reward: 120, measure: (s) => s.stats.bestEndless / 60 },
  { id: 'evolve-all', title: '무기 수집가', description: '무기 아홉 가지 모두 진화', goal: WEAPON_ORDER.length, reward: 150, measure: (s) => s.stats.evolved.length },
  { id: 'deep-3', title: '칠흑 속의 등불', description: '깊은 밤 3에서 새벽 맞기', goal: 1, reward: 150, measure: clearedDepth(3) },
  { id: 'kills-100k', title: '밤을 쓸어 낸 자', description: '그림자 10만 마리 쓰러뜨리기', goal: 100_000, reward: 200, measure: (s) => s.stats.kills },
  { id: 'endless-6', title: '새벽을 미룬 자', description: '끝없는 밤에서 6분 버티기', goal: 6, reward: 250, measure: (s) => s.stats.bestEndless / 60 },
  { id: 'deep-5', title: '밤의 끝자락', description: '깊은 밤 5에서 새벽 맞기', goal: 1, reward: 300, measure: clearedDepth(5) },
  { id: 'deep-max', title: '가장 깊은 밤', description: `깊은 밤 ${MAX_DEPTH}에서 새벽 맞기`, goal: 1, reward: 600, measure: clearedDepth(MAX_DEPTH) },
];

export function getChallenge(id: string): Challenge | undefined {
  return CHALLENGES.find((challenge) => challenge.id === id);
}

/** 진행을 0부터 목표까지의 정수로 */
export function progressOf(challenge: Challenge, source: ChallengeSource): number {
  const value = challenge.measure(source);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(challenge.goal, Math.floor(value)));
}

export function isDone(challenge: Challenge, source: ChallengeSource): boolean {
  return progressOf(challenge, source) >= challenge.goal;
}

/** 이루었지만 아직 보상을 받지 않은 도전 과제 */
export function claimable(source: ChallengeSource, claimed: readonly string[]): Challenge[] {
  return CHALLENGES.filter((challenge) => !claimed.includes(challenge.id) && isDone(challenge, source));
}

/** before에서는 이루지 못했다가 after에서 이룬 도전 과제 */
export function newlyDone(before: ChallengeSource, after: ChallengeSource): Challenge[] {
  return CHALLENGES.filter((challenge) => !isDone(challenge, before) && isDone(challenge, after));
}
