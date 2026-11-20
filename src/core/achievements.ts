/**
 * 업적: 오래 두고 노릴 목표. 달성하면 업적 화면에서 눌러서 코인을 받는다.
 * 진행도는 세이브에 이미 있는 기록(판 수, 최고 점수, 깬 단계, 오늘의 도전, 꾸미기, 행운 슬롯의 도감)에서 그때그때 계산하고,
 * 세이브에는 보상을 받은 업적만 남긴다. 그래서 업적이 생기기 전에 쌓은 기록도 그대로 인정된다.
 * 저장소와 화면 어느 쪽에도 의존하지 않는 순수 함수들이다.
 */
import { CHARMS } from '../games/candy-slot/rules';
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
  /** 게임 id → 그 게임을 한 판 수. 점수가 없는 게임(둘이서 대결)의 업적이 본다. */
  played: Record<string, number>;
  /** 오늘의 도전을 달성한 횟수 */
  dailyCleared: number;
  /** 오늘의 도전을 가장 길게 이어 간 일수 */
  bestStreak: number;
  /** 코인으로 산 꾸미기의 수 */
  cosmeticsOwned: number;
  /** 퍼즐 단계 모드에서 깬 단계를 모든 게임에 걸쳐 더한 수 */
  stagesCleared: number;
  /** 한 게임에서 가장 멀리 깬 단계 */
  stageBest: number;
  /** 단계를 하나라도 깬 게임의 수 */
  stageGames: number;
  /** 행운 슬롯의 도감에 모은(한 번이라도 붙여 본) 부적의 수 */
  slotCharms: number;
}

/** statsOf가 읽는 세이브의 부분. save.ts를 끌어오지 않으려고 필요한 모양만 적는다. */
export interface AchievementSource {
  games: Record<string, { best: number; plays: number }>;
  daily: { totalCleared: number; bestStreak: number };
  cosmetics: { owned: readonly string[] };
  /** 게임 id → 깬 가장 높은 단계 */
  stages: Readonly<Record<string, number>>;
  /** 행운 슬롯에서 찾은 부적의 id */
  slot: { found: readonly string[] };
}

export function statsOf(save: AchievementSource): AchievementStats {
  const records = Object.entries(save.games);
  const best: Record<string, number> = {};
  const played: Record<string, number> = {};
  for (const [id, record] of records) {
    best[id] = record.best;
    played[id] = record.plays;
  }
  const cleared = Object.values(save.stages).filter((level) => level > 0);
  return {
    totalPlays: records.reduce((sum, [, record]) => sum + record.plays, 0),
    gamesTried: records.filter(([, record]) => record.plays > 0).length,
    best,
    played,
    dailyCleared: save.daily.totalCleared,
    bestStreak: save.daily.bestStreak,
    cosmeticsOwned: save.cosmetics.owned.length,
    stagesCleared: cleared.reduce((sum, level) => sum + level, 0),
    stageBest: cleared.reduce((best, level) => Math.max(best, level), 0),
    stageGames: cleared.length,
    slotCharms: save.slot.found.length,
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
const playedOf =
  (gameId: string) =>
  (stats: AchievementStats): number =>
    stats.played[gameId] ?? 0;
const owned = (stats: AchievementStats): number => stats.cosmeticsOwned;
const stages = (stats: AchievementStats): number => stats.stagesCleared;
const stageBest = (stats: AchievementStats): number => stats.stageBest;
const slotCharms = (stats: AchievementStats): number => stats.slotCharms;

/** 살 수 있는 꾸미기의 수. 꾸미기가 늘면 "모두 모으기"의 목표도 따라 늘어난다. */
const PAID_COSMETICS = CATALOG.filter((item) => item.price > 0).length;
/** 행운 슬롯의 부적의 수. 부적이 늘면 "모두 찾기"의 목표도 따라 늘어난다. */
const SLOT_CHARMS = CHARMS.length;

export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: 'play-first', group: 'play', title: '첫걸음', description: '아무 게임이나 한 판', goal: 1, reward: 5, measure: plays },
  { id: 'play-variety', group: 'play', title: '골고루 맛보기', description: '게임 세 가지 해 보기', goal: 3, reward: 15, measure: (stats) => stats.gamesTried },
  { id: 'play-30', group: 'play', title: '단골손님', description: '모두 합쳐 30판', goal: 30, reward: 30, measure: plays },
  { id: 'play-100', group: 'play', title: '백전노장', description: '모두 합쳐 100판', goal: 100, reward: 80, measure: plays },
  { id: 'duel-10', group: 'play', title: '단짝 승부', description: '둘이서 대결 열 판', goal: 10, reward: 30, measure: playedOf('duel') },
  // 새싹 컴퍼니는 출시 한 번이 한 판이고, 평판이 최고 기록으로 남는다.
  { id: 'company-release-1', group: 'play', title: '첫 출시', description: '새싹 컴퍼니 첫 출시', goal: 1, reward: 10, measure: playedOf('sprout-company') },
  { id: 'company-release-30', group: 'play', title: '부지런한 회사', description: '새싹 컴퍼니 출시 30번', goal: 30, reward: 40, measure: playedOf('sprout-company') },
  // 퍼즐 단계 모드. 깬 단계는 줄어들지 않으므로 한 번 달성하면 그대로 남는다.
  { id: 'stage-first', group: 'play', title: '첫 단계', description: '퍼즐 단계 하나 깨기', goal: 1, reward: 5, measure: stages },
  { id: 'stage-variety', group: 'play', title: '단계 맛보기', description: '세 게임에서 단계 깨기', goal: 3, reward: 15, measure: (stats) => stats.stageGames },
  { id: 'stage-30', group: 'play', title: '차근차근', description: '모두 합쳐 30단계 깨기', goal: 30, reward: 30, measure: stages },
  { id: 'stage-100', group: 'play', title: '단계 수집가', description: '모두 합쳐 100단계 깨기', goal: 100, reward: 60, measure: stages },
  { id: 'stage-300', group: 'play', title: '퍼즐 박사', description: '모두 합쳐 300단계 깨기', goal: 300, reward: 120, measure: stages },
  { id: 'stage-game-50', group: 'play', title: '한 우물 파기', description: '한 게임 50단계 깨기', goal: 50, reward: 50, measure: stageBest },
  { id: 'stage-game-100', group: 'play', title: '끝까지 간 사람', description: '한 게임 100단계 깨기', goal: 100, reward: 150, measure: stageBest },

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
  { id: 'pin-250', group: 'score', title: '보물 사냥꾼', description: '핀 뽑기 250점 이상', goal: 250, reward: 20, measure: bestOf('pin-pull') },
  { id: 'pin-500', group: 'score', title: '핀의 달인', description: '핀 뽑기 500점 이상', goal: 500, reward: 50, measure: bestOf('pin-pull') },
  { id: 'parking-400', group: 'score', title: '주차 도우미', description: '주차장 빼기 400점 이상', goal: 400, reward: 20, measure: bestOf('parking-out') },
  { id: 'parking-800', group: 'score', title: '주차의 달인', description: '주차장 빼기 800점 이상', goal: 800, reward: 50, measure: bestOf('parking-out') },
  { id: 'screw-700', group: 'score', title: '꼼꼼한 손', description: '나사 풀기 700점 이상', goal: 700, reward: 20, measure: bestOf('screw-sort') },
  { id: 'screw-1400', group: 'score', title: '나사의 달인', description: '나사 풀기 1400점 이상', goal: 1400, reward: 50, measure: bestOf('screw-sort') },
  { id: 'merge-500', group: 'score', title: '쓱쓱 합치기', description: '머지 타일 500점 이상', goal: 500, reward: 20, measure: bestOf('merge-tiles') },
  { id: 'merge-1000', group: 'score', title: '머지의 달인', description: '머지 타일 1000점 이상', goal: 1000, reward: 50, measure: bestOf('merge-tiles') },
  { id: 'tail-300', group: 'score', title: '쑥쑥 애벌레', description: '꼬리 잡기 300점 이상', goal: 300, reward: 20, measure: bestOf('tail-chase') },
  { id: 'tail-450', group: 'score', title: '꼬리의 달인', description: '꼬리 잡기 450점 이상', goal: 450, reward: 50, measure: bestOf('tail-chase') },
  { id: 'logic-400', group: 'score', title: '조심조심', description: '논리 타일 400점 이상', goal: 400, reward: 20, measure: bestOf('logic-tiles') },
  { id: 'logic-800', group: 'score', title: '논리의 달인', description: '논리 타일 800점 이상', goal: 800, reward: 50, measure: bestOf('logic-tiles') },
  { id: 'nemo-150', group: 'score', title: '쓱쓱 색칠', description: '네모 로직 150점 이상', goal: 150, reward: 20, measure: bestOf('nemo-logic') },
  { id: 'nemo-300', group: 'score', title: '네모의 달인', description: '네모 로직 300점 이상', goal: 300, reward: 50, measure: bestOf('nemo-logic') },
  { id: 'number-350', group: 'score', title: '숫자 탐정', description: '숫자 퍼즐 350점 이상', goal: 350, reward: 20, measure: bestOf('number-puzzle') },
  { id: 'number-700', group: 'score', title: '숫자의 달인', description: '숫자 퍼즐 700점 이상', goal: 700, reward: 50, measure: bestOf('number-puzzle') },
  { id: 'path-200', group: 'score', title: '술술 잇기', description: '길 잇기 200점 이상', goal: 200, reward: 20, measure: bestOf('path-link') },
  { id: 'path-600', group: 'score', title: '길의 달인', description: '길 잇기 600점 이상', goal: 600, reward: 50, measure: bestOf('path-link') },
  { id: 'block-800', group: 'score', title: '빈틈없이', description: '블록 800점 이상', goal: 800, reward: 20, measure: bestOf('block-fill') },
  { id: 'block-1600', group: 'score', title: '블록의 달인', description: '블록 1600점 이상', goal: 1600, reward: 50, measure: bestOf('block-fill') },
  { id: 'match-3000', group: 'score', title: '착착 맞추기', description: '맞추기 3000점 이상', goal: 3000, reward: 20, measure: bestOf('match-three') },
  { id: 'match-6000', group: 'score', title: '맞추기의 달인', description: '맞추기 6000점 이상', goal: 6000, reward: 50, measure: bestOf('match-three') },
  { id: 'box-150', group: 'score', title: '영차영차', description: '상자 밀기 150점 이상', goal: 150, reward: 20, measure: bestOf('box-push') },
  { id: 'box-350', group: 'score', title: '상자의 달인', description: '상자 밀기 350점 이상', goal: 350, reward: 50, measure: bestOf('box-push') },
  { id: 'chosung-500', group: 'score', title: '낱말 박사', description: '초성 퀴즈 500점 이상', goal: 500, reward: 20, measure: bestOf('chosung-quiz') },
  { id: 'chosung-1000', group: 'score', title: '초성의 달인', description: '초성 퀴즈 1000점 이상', goal: 1000, reward: 50, measure: bestOf('chosung-quiz') },
  { id: 'brick-300', group: 'score', title: '와르르 벽돌', description: '벽돌 깨기 300점 이상', goal: 300, reward: 20, measure: bestOf('brick-break') },
  { id: 'brick-450', group: 'score', title: '벽돌의 달인', description: '벽돌 깨기 450점 이상', goal: 450, reward: 50, measure: bestOf('brick-break') },
  { id: 'slot-500', group: 'score', title: '행운의 손', description: '행운 슬롯 500점 이상', goal: 500, reward: 20, measure: bestOf('candy-slot') },
  { id: 'slot-1500', group: 'score', title: '금화 부자', description: '행운 슬롯 1500점 이상', goal: 1500, reward: 50, measure: bestOf('candy-slot') },
  { id: 'garden-1000', group: 'score', title: '든든한 울타리', description: '텃밭 1000점 이상', goal: 1000, reward: 20, measure: bestOf('garden-guard') },
  { id: 'garden-3000', group: 'score', title: '텃밭의 달인', description: '텃밭 3000점 이상', goal: 3000, reward: 50, measure: bestOf('garden-guard') },
  { id: 'solitaire-500', group: 'score', title: '카드 정리', description: '솔리테어 500점 이상', goal: 500, reward: 20, measure: bestOf('solitaire') },
  { id: 'solitaire-1100', group: 'score', title: '빠른 손 딜러', description: '솔리테어 1100점 이상', goal: 1100, reward: 50, measure: bestOf('solitaire') },
  { id: 'lantern-3000', group: 'score', title: '꺼지지 않는 불', description: '등불지기 3000점 이상', goal: 3000, reward: 20, measure: bestOf('lantern-keeper') },
  { id: 'lantern-8000', group: 'score', title: '새벽을 본 등불', description: '등불지기 8000점 이상', goal: 8000, reward: 50, measure: bestOf('lantern-keeper') },
  { id: 'company-200', group: 'score', title: '소문난 회사', description: '새싹 컴퍼니 평판 200', goal: 200, reward: 20, measure: bestOf('sprout-company') },
  { id: 'company-1000', group: 'score', title: '이름난 회사', description: '새싹 컴퍼니 평판 1000', goal: 1000, reward: 50, measure: bestOf('sprout-company') },
  { id: 'company-5000', group: 'score', title: '사옥의 주인', description: '새싹 컴퍼니 평판 5000', goal: 5000, reward: 80, measure: bestOf('sprout-company') },

  { id: 'daily-1', group: 'daily', title: '오늘도 도전', description: '오늘의 도전 한 번 달성', goal: 1, reward: 10, measure: (stats) => stats.dailyCleared },
  { id: 'daily-streak-3', group: 'daily', title: '사흘 연속', description: '도전 3일 연속 달성', goal: 3, reward: 30, measure: (stats) => stats.bestStreak },
  { id: 'daily-streak-7', group: 'daily', title: '일주일 개근', description: '도전 7일 연속 달성', goal: 7, reward: 80, measure: (stats) => stats.bestStreak },
  { id: 'daily-10', group: 'daily', title: '도전 열 번', description: '오늘의 도전 10번 달성', goal: 10, reward: 50, measure: (stats) => stats.dailyCleared },

  { id: 'collect-1', group: 'collect', title: '첫 꾸미기', description: '꾸미기 하나 사기', goal: 1, reward: 10, measure: owned },
  { id: 'collect-4', group: 'collect', title: '멋쟁이', description: '꾸미기 네 개 모으기', goal: 4, reward: 30, measure: owned },
  { id: 'collect-all', group: 'collect', title: '수집왕', description: '꾸미기 모두 모으기', goal: PAID_COSMETICS, reward: 100, measure: owned },
  // 행운 슬롯의 부적 도감. 한 번이라도 붙여 본 부적을 센다.
  { id: 'slot-charms-12', group: 'collect', title: '부적 수집가', description: '슬롯 부적 12가지 찾기', goal: 12, reward: 20, measure: slotCharms },
  { id: 'slot-charms-all', group: 'collect', title: '부적 박사', description: '슬롯 부적 모두 찾기', goal: SLOT_CHARMS, reward: 50, measure: slotCharms },
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
