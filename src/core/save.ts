/**
 * 세이브 데이터의 모양과 순수 함수들.
 * 저장소(IndexedDB)와 화면 어느 쪽에도 의존하지 않아서 단위 테스트가 쉽다.
 */

export const SAVE_VERSION = 1;

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
  createdAt: number;
  updatedAt: number;
}

export interface PlayResult {
  save: SaveData;
  score: number;
  best: number;
  previousBest: number;
  isNewBest: boolean;
  coinsEarned: number;
}

export function createDefaultSave(now: number = Date.now()): SaveData {
  return {
    version: SAVE_VERSION,
    coins: 0,
    settings: { sound: true, vibration: true },
    games: {},
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

/** 한 판의 결과를 반영한 새 세이브를 돌려준다. 원본은 바꾸지 않는다. */
export function applyPlayResult(
  save: SaveData,
  gameId: string,
  rawScore: number,
  rawCoins: number,
  now: number = Date.now(),
): PlayResult {
  const score = toCount(rawScore);
  const coinsEarned = toCount(rawCoins);
  const previous = getRecord(save, gameId);
  const isNewBest = score > previous.best;
  const best = Math.max(previous.best, score);

  return {
    save: {
      ...save,
      coins: save.coins + coinsEarned,
      games: {
        ...save.games,
        [gameId]: { best, plays: previous.plays + 1, lastPlayedAt: now },
      },
      updatedAt: now,
    },
    score,
    best,
    previousBest: previous.best,
    isNewBest,
    coinsEarned,
  };
}

/** 기록과 코인을 지우고 설정은 남긴다. */
export function resetProgress(save: SaveData, now: number = Date.now()): SaveData {
  return { ...createDefaultSave(now), settings: { ...save.settings } };
}
