/**
 * 세이브 데이터의 모양과 순수 함수들.
 * 저장소(IndexedDB)와 화면 어느 쪽에도 의존하지 않아서 단위 테스트가 쉽다.
 */

import {
  clearDaily,
  createDailyState,
  isCleared,
  normalizeDaily,
  streakBonus,
  type DailyChallenge,
  type DailyState,
} from './daily';
import {
  createCosmetics,
  equip,
  normalizeCosmetics,
  purchase,
  type CosmeticItem,
  type CosmeticsState,
} from './shop';

export const SAVE_VERSION = 3;

export interface GameRecord {
  /** 최고 점수 */
  best: number;
  /** 플레이 횟수 */
  plays: number;
  /** 마지막으로 플레이한 시각(ms). 한 번도 안 했으면 null */
  lastPlayedAt: number | null;
}

export interface Settings {
  sound: boolean;
  vibration: boolean;
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
}

export function createDefaultSave(now: number = Date.now()): SaveData {
  return {
    version: SAVE_VERSION,
    coins: 0,
    settings: { sound: true, vibration: true },
    games: {},
    daily: createDailyState(),
    cosmetics: createCosmetics(),
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
      vibration: toBool(settings.vibration, base.settings.vibration),
    },
    games,
    daily: normalizeDaily(raw.daily),
    cosmetics: normalizeCosmetics(raw.cosmetics),
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
 * challenge에 오늘의 도전을 넘기면, 이 판으로 달성했는지도 함께 따져 보상을 더한다.
 */
export function applyPlayResult(
  save: SaveData,
  gameId: string,
  rawScore: number,
  rawCoins: number,
  now: number = Date.now(),
  challenge: DailyChallenge | null = null,
): PlayResult {
  const score = toCount(rawScore);
  const coinsEarned = toCount(rawCoins);
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

  return {
    save: {
      ...save,
      coins: save.coins + coinsEarned + (daily?.reward ?? 0),
      games: {
        ...save.games,
        [gameId]: { best, plays: previous.plays + 1, lastPlayedAt: now },
      },
      daily: dailyState,
      updatedAt: now,
    },
    score,
    best,
    previousBest: previous.best,
    isNewBest,
    coinsEarned,
    daily,
  };
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

/** 기록, 코인, 산 꾸미기를 지우고 설정은 남긴다. */
export function resetProgress(save: SaveData, now: number = Date.now()): SaveData {
  return { ...createDefaultSave(now), settings: { ...save.settings } };
}
