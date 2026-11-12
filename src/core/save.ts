/**
 * 세이브 데이터의 모양과 순수 함수들.
 * 저장소(IndexedDB)와 화면 어느 쪽에도 의존하지 않아서 단위 테스트가 쉽다.
 */

import {
  claim,
  completedIds,
  createAchievements,
  normalizeAchievements,
  statsOf,
  getAchievement,
  type Achievement,
  type AchievementsState,
} from './achievements';
import {
  clearDaily,
  createDailyState,
  isCleared,
  normalizeDaily,
  streakBonus,
  type DailyChallenge,
  type DailyState,
} from './daily';
import { createOnline, normalizeOnline, withWeekScore, type OnlineState } from '../online/profile';
import { rankWeekOf } from '../online/protocol';
import { createVolume, normalizeVolume, type VolumeState } from './volume';
import {
  createCosmetics,
  equip,
  normalizeCosmetics,
  purchase,
  type CosmeticItem,
  type CosmeticsState,
} from './shop';
import {
  claimMission,
  createWeekly,
  missionProgress,
  normalizeWeekly,
  recordWeeklyPlay,
  weeklyFor,
  type WeekContext,
  type WeeklyMission,
  type WeeklyState,
} from './weekly';
import { clearLevel, normalizeStages, type StageProgress } from './stages';

export const SAVE_VERSION = 9;

/** 점수를 냈으면 한 판에 적어도 이만큼은 코인을 준다. 처음 하는 사람이 빈손으로 끝나지 않게 한다. */
export const MIN_COINS_PER_PLAY = 1;

export interface GameRecord {
  /** 최고 점수 */
  best: number;
  /** 플레이 횟수 */
  plays: number;
  /** 마지막으로 플레이한 시각(ms). 한 번도 안 했으면 null */
  lastPlayedAt: number | null;
}

export interface Settings {
  /** 효과음 */
  sound: boolean;
  /** 배경 음악. 음악이 있는 게임에서만 쓰인다. */
  music: boolean;
  vibration: boolean;
  /** 색 구분 도우미: 색으로 푸는 게임에서 색마다 다른 무늬를 크고 또렷하게 보여 준다. */
  colorAssist: boolean;
}

export interface SaveData {
  version: number;
  coins: number;
  settings: Settings;
  /** 게임 id → 기록 */
  games: Record<string, GameRecord>;
  /** 오늘의 도전 달성 기록 */
  daily: DailyState;
  /** 상점에서 산 꾸미기와 지금 쓰는 꾸미기 */
  cosmetics: CosmeticsState;
  /** 보상을 받은 업적. 달성 여부는 위의 기록들에서 계산한다. */
  achievements: AchievementsState;
  /** 온라인 랭킹에서 쓰는 닉네임과, 서버에 어디까지 올렸는지. 닉네임을 정하기 전에는 비어 있다. */
  online: OnlineState;
  /** 효과음과 배경 음악의 크기. 켜고 끄는 것은 settings에 있다. */
  volume: VolumeState;
  /** 허브에서 별을 눌러 즐겨찾기에 넣은 게임의 id. 허브 목록의 앞쪽에 놓인다. */
  favorites: string[];
  /** 주간 미션: 이번 주에 한 판 수와 얻은 코인, 보상을 받은 미션. 주가 바뀌면 처음부터 다시 센다. */
  weekly: WeeklyState;
  /** 퍼즐 단계 모드: 게임마다 깬 가장 높은 단계 */
  stages: StageProgress;
  createdAt: number;
  updatedAt: number;
}

/** 이번 판이 오늘의 도전에 어떻게 닿았는지 */
export interface DailyOutcome {
  /** 이번 판으로 달성했는지 */
  cleared: boolean;
  /** 달성해서 받은 코인(기본 보상 + 연속 보너스). 달성하지 못했으면 0 */
  reward: number;
  /** 달성한 뒤의 연속 일수. 달성하지 못했으면 0 */
  streak: number;
  /** 목표까지 모자란 점수. 달성했으면 0 */
  shortBy: number;
}

export interface PlayResult {
  save: SaveData;
  score: number;
  best: number;
  previousBest: number;
  isNewBest: boolean;
  /** 점수로 얻은 코인. 오늘의 도전 보상은 daily.reward에 따로 있다. */
  coinsEarned: number;
  /** 이 게임이 오늘의 도전이고 아직 달성하기 전이었을 때만 있다. */
  daily: DailyOutcome | null;
  /** 이번 판으로 새로 달성한 업적. 보상은 업적 화면에서 받는다. */
  newAchievements: Achievement[];
  /** 이번 판으로 다 채운 주간 미션. 보상은 업적 화면의 주간 탭에서 받는다. */
  newMissions: WeeklyMission[];
}

export function createDefaultSave(now: number = Date.now()): SaveData {
  return {
    version: SAVE_VERSION,
    coins: 0,
    settings: { sound: true, music: true, vibration: true, colorAssist: false },
    games: {},
    daily: createDailyState(),
    cosmetics: createCosmetics(),
    achievements: createAchievements(),
    online: createOnline(),
    volume: createVolume(),
    favorites: [],
    weekly: createWeekly(),
    stages: {},
    createdAt: now,
    updatedAt: now,
  };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** 음이 아닌 정수로 정리한다. 숫자가 아니면 fallback을 쓴다. */
const toCount = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;

const toBool = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

const toTimestamp = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;

/** 즐겨찾기에 둘 수 있는 가장 많은 개수. 깨진 세이브가 끝없이 커지지 않게 막는 값이다. */
export const MAX_FAVORITES = 64;

/** 즐겨찾기 목록을 정리한다: 문자열만 남기고, 겹치는 것을 빼고, 너무 길면 자른다. */
function normalizeFavorites(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const ids = raw.filter((id): id is string => typeof id === 'string' && id.length > 0);
  return [...new Set(ids)].slice(0, MAX_FAVORITES);
}

/**
 * 저장소나 가져오기 파일에서 읽은 값을 안전한 SaveData로 바꾼다.
 * 빠졌거나 잘못된 항목은 기본값으로 채우므로, 버전이 달라도 깨지지 않는다.
 */
export function normalizeSave(raw: unknown, now: number = Date.now()): SaveData {
  const base = createDefaultSave(now);
  if (!isObject(raw)) return base;

  const settings = isObject(raw.settings) ? raw.settings : {};
  const games: Record<string, GameRecord> = {};
  if (isObject(raw.games)) {
    for (const [id, value] of Object.entries(raw.games)) {
      if (!isObject(value)) continue;
      games[id] = {
        best: toCount(value.best),
        plays: toCount(value.plays),
        lastPlayedAt:
          typeof value.lastPlayedAt === 'number' && Number.isFinite(value.lastPlayedAt)
            ? value.lastPlayedAt
            : null,
      };
    }
  }

  return {
    version: SAVE_VERSION,
    coins: toCount(raw.coins),
    settings: {
      sound: toBool(settings.sound, base.settings.sound),
      music: toBool(settings.music, base.settings.music),
      vibration: toBool(settings.vibration, base.settings.vibration),
      colorAssist: toBool(settings.colorAssist, base.settings.colorAssist),
    },
    games,
    daily: normalizeDaily(raw.daily),
    cosmetics: normalizeCosmetics(raw.cosmetics),
    achievements: normalizeAchievements(raw.achievements),
    online: normalizeOnline(raw.online),
    volume: normalizeVolume(raw.volume),
    favorites: normalizeFavorites(raw.favorites),
    weekly: normalizeWeekly(raw.weekly),
    stages: normalizeStages(raw.stages),
    createdAt: toTimestamp(raw.createdAt, now),
    updatedAt: toTimestamp(raw.updatedAt, now),
  };
}

/** 가져오기 파일이 이 앱의 세이브처럼 보이는지 확인한다. */
export function looksLikeSave(raw: unknown): boolean {
  return isObject(raw) && typeof raw.version === 'number' && isObject(raw.games);
}

export function getRecord(save: SaveData, gameId: string): GameRecord {
  return save.games[gameId] ?? { best: 0, plays: 0, lastPlayedAt: null };
}

/**
 * 한 판의 결과를 반영한 새 세이브를 돌려준다. 원본은 바꾸지 않는다.
 * 1점이라도 냈으면 코인을 적어도 MIN_COINS_PER_PLAY개 준다. 0점이면 받은 코인 수 그대로다.
 * challenge에 오늘의 도전을 넘기면, 이 판으로 달성했는지도 함께 따져 보상을 더한다.
 * 이미 달성한 날이거나 기기 시계가 마지막 달성일보다 앞으로 돌아가 있으면 도전은 따지지 않는다.
 * week에 이번 주의 미션을 넘기면, 이 판을 주간 기록에 더하고 이 판으로 다 채운 미션을 알려 준다.
 */
export function applyPlayResult(
  save: SaveData,
  gameId: string,
  rawScore: number,
  rawCoins: number,
  now: number = Date.now(),
  challenge: DailyChallenge | null = null,
  week: WeekContext | null = null,
): PlayResult {
  const score = toCount(rawScore);
  const coinsEarned =
    score > 0 ? Math.max(MIN_COINS_PER_PLAY, toCount(rawCoins)) : toCount(rawCoins);
  const previous = getRecord(save, gameId);
  const isNewBest = score > previous.best;
  const best = Math.max(previous.best, score);

  let daily: DailyOutcome | null = null;
  let dailyState = save.daily;
  if (challenge && challenge.gameId === gameId && !isCleared(save.daily, challenge.dateKey)) {
    if (score >= challenge.target) {
      dailyState = clearDaily(save.daily, challenge.dateKey);
      daily = {
        cleared: true,
        reward: challenge.reward + streakBonus(dailyState.streak),
        streak: dailyState.streak,
        shortBy: 0,
      };
    } else {
      daily = { cleared: false, reward: 0, streak: 0, shortBy: challenge.target - score };
    }
  }

  // 주간 미션은 보상을 뺀, 이 판에서 얻은 것만 센다. 넘겨받은 주가 기록보다 앞선 주이면 건드리지 않는다.
  let weekly = save.weekly;
  let newMissions: WeeklyMission[] = [];
  const weekBefore = week ? weeklyFor(save.weekly, week.weekKey) : null;
  if (week && weekBefore) {
    const weekAfter = recordWeeklyPlay(weekBefore, week.weekKey, {
      gameId,
      coins: coinsEarned + (daily?.reward ?? 0),
      dailyCleared: daily?.cleared === true,
    });
    weekly = weekAfter;
    newMissions = week.missions.filter(
      (mission) =>
        !missionProgress(mission, weekBefore).complete && missionProgress(mission, weekAfter).complete,
    );
  }

  const next: SaveData = {
    ...save,
    coins: save.coins + coinsEarned + (daily?.reward ?? 0),
    games: {
      ...save.games,
      [gameId]: { best, plays: previous.plays + 1, lastPlayedAt: now },
    },
    daily: dailyState,
    weekly,
    // 이번 주 랭킹에 올릴 기록. 닉네임을 정하기 전이어도 적어 둔다.
    online: withWeekScore(save.online, gameId, score, rankWeekOf(now)),
    updatedAt: now,
  };

  // 이번 판 전에는 달성하지 못했던 업적만 "새로 달성"으로 알린다.
  const before = new Set(completedIds(statsOf(save)));
  const newAchievements = completedIds(statsOf(next))
    .filter((id) => !before.has(id))
    .map((id) => getAchievement(id))
    .filter((achievement): achievement is Achievement => achievement !== undefined);

  return {
    save: next,
    score,
    best,
    previousBest: previous.best,
    isNewBest,
    coinsEarned,
    daily,
    newAchievements,
    newMissions,
  };
}

export interface StageClearResult {
  save: SaveData;
  level: number;
  /** 이 단계를 처음 깼는지 */
  first: boolean;
  /** 처음 깨서 받은 코인. 다시 깬 단계면 0 */
  coinsEarned: number;
  newAchievements: Achievement[];
  newMissions: WeeklyMission[];
}

/**
 * 단계 모드에서 한 단계를 깬 것을 반영한 새 세이브를 돌려준다. 원본은 바꾸지 않는다.
 * 그 게임을 한 판 한 것으로도 세므로(점수는 없다) 주간 미션과 업적의 판 수에 들어간다.
 * 아직 열리지 않은 단계면 null.
 */
export function applyStageClear(
  save: SaveData,
  gameId: string,
  level: number,
  now: number = Date.now(),
  week: WeekContext | null = null,
): StageClearResult | null {
  const cleared = clearLevel(save.stages, gameId, level);
  if (!cleared) return null;
  const play = applyPlayResult(save, gameId, 0, cleared.coins, now, null, week);
  return {
    save: { ...play.save, stages: cleared.progress },
    level,
    first: cleared.first,
    coinsEarned: play.coinsEarned,
    newAchievements: play.newAchievements,
    newMissions: play.newMissions,
  };
}

/** 그 게임이 즐겨찾기에 들어 있는지 */
export function isFavorite(save: SaveData, gameId: string): boolean {
  return save.favorites.includes(gameId);
}

/**
 * 즐겨찾기에 넣거나(없을 때) 뺀(있을 때) 새 세이브를 돌려준다. 원본은 바꾸지 않는다.
 * 더 넣을 자리가 없으면 받은 세이브 그대로다.
 */
export function toggleFavorite(save: SaveData, gameId: string, now: number = Date.now()): SaveData {
  if (isFavorite(save, gameId)) {
    return { ...save, favorites: save.favorites.filter((id) => id !== gameId), updatedAt: now };
  }
  if (gameId.length === 0 || save.favorites.length >= MAX_FAVORITES) return save;
  return { ...save, favorites: [...save.favorites, gameId], updatedAt: now };
}

export type BuyResult =
  | { ok: true; save: SaveData; item: CosmeticItem }
  | { ok: false; reason: 'unknown' | 'owned' }
  | { ok: false; reason: 'coins'; shortBy: number };

/** 코인으로 꾸미기를 사서 바로 끼운 새 세이브를 돌려준다. 살 수 없으면 이유를 알려 준다. */
export function buyCosmetic(save: SaveData, itemId: string, now: number = Date.now()): BuyResult {
  const result = purchase(save.coins, save.cosmetics, itemId);
  if (!result.ok) return result;
  return {
    ok: true,
    save: { ...save, coins: result.coins, cosmetics: result.cosmetics, updatedAt: now },
    item: result.item,
  };
}

/** 가진 꾸미기를 끼운 새 세이브를 돌려준다. 바뀌는 것이 없으면 받은 세이브 그대로다. */
export function equipCosmetic(save: SaveData, itemId: string, now: number = Date.now()): SaveData {
  const cosmetics = equip(save.cosmetics, itemId);
  return cosmetics === save.cosmetics ? save : { ...save, cosmetics, updatedAt: now };
}

export type ClaimAchievementResult =
  | { ok: true; save: SaveData; achievement: Achievement }
  | { ok: false; reason: 'unknown' | 'incomplete' | 'claimed' };

/** 달성한 업적의 보상 코인을 받은 새 세이브를 돌려준다. 받을 수 없으면 이유를 알려 준다. */
export function claimAchievement(
  save: SaveData,
  achievementId: string,
  now: number = Date.now(),
): ClaimAchievementResult {
  const result = claim(save.achievements, statsOf(save), achievementId);
  if (!result.ok) return result;
  return {
    ok: true,
    save: {
      ...save,
      coins: save.coins + result.achievement.reward,
      achievements: result.state,
      updatedAt: now,
    },
    achievement: result.achievement,
  };
}

export type ClaimMissionSaveResult =
  | { ok: true; save: SaveData; mission: WeeklyMission }
  | { ok: false; reason: 'unknown' | 'incomplete' | 'claimed' };

/** 다 채운 주간 미션의 보상 코인을 받은 새 세이브를 돌려준다. 받을 수 없으면 이유를 알려 준다. */
export function claimWeeklyMission(
  save: SaveData,
  week: WeekContext,
  missionId: string,
  now: number = Date.now(),
): ClaimMissionSaveResult {
  const result = claimMission(save.weekly, week, missionId);
  if (!result.ok) return result;
  return {
    ok: true,
    save: {
      ...save,
      coins: save.coins + result.mission.reward,
      weekly: result.state,
      updatedAt: now,
    },
    mission: result.mission,
  };
}

/**
 * 기록, 코인, 산 꾸미기, 받은 업적 보상을 지우고 설정과 닉네임은 남긴다.
 * 이 기기 안의 기록만 지운다. 온라인 랭킹에 올라간 기록은 랭킹 화면에서 따로 뺀다.
 */
export function resetProgress(save: SaveData, now: number = Date.now()): SaveData {
  return {
    ...createDefaultSave(now),
    settings: { ...save.settings },
    // 서버에 올라간 기록은 그대로이므로, 무엇을 올렸는지도(이번 주의 기록까지) 그대로 둔다.
    online: structuredClone(save.online),
    // 소리 크기도 설정이라 남긴다.
    volume: { ...save.volume },
    // 즐겨찾기는 기록이 아니라 취향이라 설정처럼 남긴다.
    favorites: [...save.favorites],
  };
}
