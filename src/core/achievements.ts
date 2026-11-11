/**
 * 업적: 오래 두고 노릴 목표. 달성하면 업적 화면에서 눌러서 코인을 받는다.
 * 진행도는 세이브에 이미 있는 기록(판 수, 최고 점수, 오늘의 도전, 꾸미기)에서 그때그때 계산하고,
 * 세이브에는 보상을 받은 업적만 남긴다. 그래서 업적이 생기기 전에 쌓은 기록도 그대로 인정된다.
 * 저장소와 화면 어느 쪽에도 의존하지 않는 순수 함수들이다.
 */
import { CATALOG } from './shop';

/** 업적 화면의 탭 */
export const GROUPS = ['play', 'score', 'daily', 'collect'] as const;
export type AchievementGroup = (typeof GROUPS)[number];

export const GROUP_LABEL: Record<AchievementGroup, string> = {
  play: '플레이',
  score: '점수',
  daily: '도전',
  collect: '수집',
};

/** 업적이 보는 숫자들. 모두 줄어들지 않는 값이라 한 번 달성한 업적은 달성한 채로 남는다. */
export interface AchievementStats {
  /** 모든 게임을 합친 판 수 */
  totalPlays: number;
  /** 한 번이라도 해 본 게임의 수 */
  gamesTried: number;
  /** 게임 id → 최고 점수 */
  best: Record<string, number>;
  /** 오늘의 도전을 달성한 횟수 */
  dailyCleared: number;
  /** 오늘의 도전을 가장 길게 이어 간 일수 */
  bestStreak: number;
  /** 코인으로 산 꾸미기의 수 */
  cosmeticsOwned: number;
}

/** statsOf가 읽는 세이브의 부분. save.ts를 끌어오지 않으려고 필요한 모양만 적는다. */
export interface AchievementSource {
  games: Record<string, { best: number; plays: number }>;
  daily: { totalCleared: number; bestStreak: number };
  cosmetics: { owned: readonly string[] };
}

export function statsOf(save: AchievementSource): AchievementStats {
  const records = Object.entries(save.games);
  const best: Record<string, number> = {};
  for (const [id, record] of records) best[id] = record.best;
  return {
    totalPlays: records.reduce((sum, [, record]) => sum + record.plays, 0),
    gamesTried: records.filter(([, record]) => record.plays > 0).length,
    best,
    dailyCleared: save.daily.totalCleared,
    bestStreak: save.daily.bestStreak,
    cosmeticsOwned: save.cosmetics.owned.length,
  };
}

export interface Achievement {
  /** 세이브에 쓰이는 고유 id. 한 번 정하면 바꾸지 않는다. */
  id: string;
  group: AchievementGroup;
  /** 한글 7자 안팎 */
  title: string;
  /** 무엇을 하면 되는지. 업적 화면 한 줄에 들어가도록 한글 11자 안팎 */
  description: string;
  /** 이 값 이상이면 달성 */
  goal: number;
  /** 보상 코인 */
  reward: number;
  /** 지금까지의 진행 */
  measure: (stats: AchievementStats) => number;
}

const plays = (stats: AchievementStats): number => stats.totalPlays;
const bestOf =
  (gameId: string) =>
  (stats: AchievementStats): number =>
    stats.best[gameId] ?? 0;
const owned = (stats: AchievementStats): number => stats.cosmeticsOwned;

/** 살 수 있는 꾸미기의 수. 꾸미기가 늘면 "모두 모으기"의 목표도 따라 늘어난다. */
const PAID_COSMETICS = CATALOG.filter((item) => item.price > 0).length;

export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: 'play-first', group: 'play', title: '첫걸음', description: '아무 게임이나 한 판', goal: 1, reward: 5, measure: plays },
  { id: 'play-variety', group: 'play', title: '골고루 맛보기', description: '게임 세 가지 해 보기', goal: 3, reward: 15, measure: (stats) => stats.gamesTried },
  { id: 'play-30', group: 'play', title: '단골손님', description: '모두 합쳐 30판', goal: 30, reward: 30, measure: plays },
  { id: 'play-100', group: 'play', title: '백전노장', description: '모두 합쳐 100판', goal: 100, reward: 80, measure: plays },

  { id: 'tap-80', group: 'score', title: '번개 손가락', description: '번개 탭 80점 이상', goal: 80, reward: 20, measure: bestOf('lightning-tap') },
  { id: 'tap-140', group: 'score', title: '번개의 달인', description: '번개 탭 140점 이상', goal: 140, reward: 50, measure: bestOf('lightning-tap') },
  { id: 'memory-150', group: 'score', title: '기억력 좋네', description: '기억 카드 150점 이상', goal: 150, reward: 20, measure: bestOf('memory-cards') },
  { id: 'memory-260', group: 'score', title: '기억의 달인', description: '기억 카드 260점 이상', goal: 260, reward: 50, measure: bestOf('memory-cards') },
  { id: 'runner-150', group: 'score', title: '달리기 선수', description: '점프 러너 150점 이상', goal: 150, reward: 20, measure: bestOf('jump-runner') },
  { id: 'runner-300', group: 'score', title: '바람의 발', description: '점프 러너 300점 이상', goal: 300, reward: 50, measure: bestOf('jump-runner') },
  { id: 'tower-130', group: 'score', title: '차곡차곡', description: '탑 쌓기 130점 이상', goal: 130, reward: 20, measure: bestOf('stack-tower') },
  { id: 'tower-220', group: 'score', title: '하늘에 닿은 탑', description: '탑 쌓기 220점 이상', goal: 220, reward: 50, measure: bestOf('stack-tower') },
  { id: 'sort-250', group: 'score', title: '깔끔한 정리', description: '물 나누기 250점 이상', goal: 250, reward: 20, measure: bestOf('color-sort') },
  { id: 'sort-420', group: 'score', title: '색의 달인', description: '물 나누기 420점 이상', goal: 420, reward: 50, measure: bestOf('color-sort') },
  { id: 'gate-200', group: 'score', title: '눈치 빠른 무리', description: '관문 달리기 200점 이상', goal: 200, reward: 20, measure: bestOf('gate-run') },
  { id: 'gate-400', group: 'score', title: '관문의 달인', description: '관문 달리기 400점 이상', goal: 400, reward: 50, measure: bestOf('gate-run') },

  { id: 'daily-1', group: 'daily', title: '오늘도 도전', description: '오늘의 도전 한 번 달성', goal: 1, reward: 10, measure: (stats) => stats.dailyCleared },
  { id: 'daily-streak-3', group: 'daily', title: '사흘 연속', description: '도전 3일 연속 달성', goal: 3, reward: 30, measure: (stats) => stats.bestStreak },
  { id: 'daily-streak-7', group: 'daily', title: '일주일 개근', description: '도전 7일 연속 달성', goal: 7, reward: 80, measure: (stats) => stats.bestStreak },
  { id: 'daily-10', group: 'daily', title: '도전 열 번', description: '오늘의 도전 10번 달성', goal: 10, reward: 50, measure: (stats) => stats.dailyCleared },

  { id: 'collect-1', group: 'collect', title: '첫 꾸미기', description: '꾸미기 하나 사기', goal: 1, reward: 10, measure: owned },
  { id: 'collect-4', group: 'collect', title: '멋쟁이', description: '꾸미기 네 개 모으기', goal: 4, reward: 30, measure: owned },
  { id: 'collect-all', group: 'collect', title: '수집왕', description: '꾸미기 모두 모으기', goal: PAID_COSMETICS, reward: 100, measure: owned },
];

export function getAchievement(id: string): Achievement | undefined {
  return ACHIEVEMENTS.find((achievement) => achievement.id === id);
}

export function achievementsIn(group: AchievementGroup): Achievement[] {
  return ACHIEVEMENTS.filter((achievement) => achievement.group === group);
}

export interface AchievementProgress {
  /** 목표를 넘지 않게 자른 진행 */
  current: number;
  goal: number;
  complete: boolean;
}

export function progressOf(achievement: Achievement, stats: AchievementStats): AchievementProgress {
  const raw = achievement.measure(stats);
  const value = Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
  return {
    current: Math.min(value, achievement.goal),
    goal: achievement.goal,
    complete: value >= achievement.goal,
  };
}

/** 달성한 업적의 id. 보상을 받았는지는 따지지 않는다. */
export function completedIds(stats: AchievementStats): string[] {
  return ACHIEVEMENTS.filter((achievement) => progressOf(achievement, stats).complete).map(
    (achievement) => achievement.id,
  );
}

/** 세이브에 남기는 업적 상태 */
export interface AchievementsState {
  /** 보상을 받은 업적의 id */
  claimed: string[];
}

export function createAchievements(): AchievementsState {
  return { claimed: [] };
}

/** 저장소에서 읽은 값을 안전한 AchievementsState로 바꾼다. 모르는 id와 겹친 id는 버린다. */
export function normalizeAchievements(raw: unknown): AchievementsState {
  const state = createAchievements();
  if (typeof raw !== 'object' || raw === null) return state;
  const claimed = (raw as Record<string, unknown>).claimed;
  if (!Array.isArray(claimed)) return state;
  for (const id of claimed) {
    if (typeof id === 'string' && getAchievement(id) && !state.claimed.includes(id)) {
      state.claimed.push(id);
    }
  }
  return state;
}

export function isClaimed(state: AchievementsState, id: string): boolean {
  return state.claimed.includes(id);
}

/** 달성했지만 아직 보상을 받지 않은 업적 */
export function claimable(state: AchievementsState, stats: AchievementStats): Achievement[] {
  return ACHIEVEMENTS.filter(
    (achievement) =>
      !isClaimed(state, achievement.id) && progressOf(achievement, stats).complete,
  );
}

export type ClaimResult =
  | { ok: true; state: AchievementsState; achievement: Achievement }
  | { ok: false; reason: 'unknown' | 'incomplete' | 'claimed' };

/** 달성한 업적의 보상을 받은 것으로 기록한다. 보상 코인은 achievement.reward이다. 원본은 바꾸지 않는다. */
export function claim(state: AchievementsState, stats: AchievementStats, id: string): ClaimResult {
  const achievement = getAchievement(id);
  if (!achievement) return { ok: false, reason: 'unknown' };
  if (isClaimed(state, id)) return { ok: false, reason: 'claimed' };
  if (!progressOf(achievement, stats).complete) return { ok: false, reason: 'incomplete' };
  return { ok: true, state: { claimed: [...state.claimed, id] }, achievement };
}
