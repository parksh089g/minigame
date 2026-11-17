/**
 * 세이브 데이터의 모양과 순수 함수들.
 * 저장소(IndexedDB)와 화면 어느 쪽에도 의존하지 않아서 단위 테스트가 쉽다.
 */

import {
  claim,
  claimable,
  completedIds,
  createAchievements,
  isClaimed,
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
import { createOnline, normalizeOnline, withoutGame, withWeekScore, type OnlineState } from '../online/profile';
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
  pickedGame,
  recordWeeklyPlay,
  unclaimedFromLastWeek,
  weeklyFor,
  type WeekContext,
  type WeeklyGame,
  type WeeklyMission,
  type WeeklyState,
} from './weekly';
import { clearLevel, normalizeStages, type StageProgress } from './stages';
import { createSlotSave, normalizeSlotSave, type SlotSave } from '../games/candy-slot/save';

export const SAVE_VERSION = 12;

/**
 * 점수 세는 법이 바뀐 게임과, 새 규칙이 들어온 세이브 버전(since). 그보다 앞선 세이브에 적힌 그 게임의 최고 점수는
 * 옛 규칙으로 낸 것이라 새 점수와 견줄 수 없어서, 읽을 때 비운다(resetOldScores). 서버의 랭킹도 함께 새로 시작한다
 * (online/protocol.ts의 SCORE_RULES).
 */
export const SCORE_RESETS: readonly { since: number; game: string }[] = [
  // 텃밭 지키기: "몇째 날까지 갔는지"에서 "이 판에서 며칠을 지켰는지"로. 가장 멀리 간 날은 텃밭의 저장에 따로 남아 있다.
  // 세이브 10(행운 슬롯의 도감이 들어온 버전)까지는 옛 규칙으로 낸 점수가 적혀 있다.
  { since: 11, game: 'garden-guard' },
];

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
  /** 행운 슬롯: 찾은 부적(도감), 도중에 두고 간 판, 행운 조각과 그것으로 연 영구 해금과 올린 유물 */
  slot: SlotSave;
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
  /**
   * 이 판의 점수를 최고 기록과 이번 주 랭킹의 기록에 넣었는지. 운이 정해져 있어서 여느 판과 견줄 수 없는 판
   * (행운 슬롯의 오늘의 판)은 false다. 그런 판도 한 판으로 세고 코인은 준다.
   */
  ranked: boolean;
  /** 점수로 얻은 코인. 오늘의 도전 보상은 daily.reward에 따로 있다. */
  coinsEarned: number;
  /** 이 게임이 오늘의 도전이고 아직 달성하기 전이었을 때만 있다. */
  daily: DailyOutcome | null;
  /** 이번 판으로 새로 달성한 업적. 보상은 업적 화면에서 받는다. */
  newAchievements: Achievement[];
  /** 이번 판으로 다 채운 주간 미션. 보상은 업적 화면의 주간 탭에서 받는다. */
  newMissions: WeeklyMission[];
  /**
   * 주가 바뀐 뒤 첫 판이라서, 이 판을 적기 전에 넣어 준 지난주 미션 보상(코인). 없으면 0.
   * 허브를 거치지 않고 판을 이어 하는 사이 주가 바뀌어도 지난주 보상이 사라지지 않게 한다.
   */
  lastWeekCoins: number;
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
    slot: createSlotSave(),
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

  const save: SaveData = {
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
    slot: normalizeSlotSave(raw.slot),
    createdAt: toTimestamp(raw.createdAt, now),
    updatedAt: toTimestamp(raw.updatedAt, now),
  };
  // 버전이 적혀 있지 않으면 어느 규칙으로 낸 점수인지 알 수 없으니 옛것으로 본다.
  return resetOldScores(save, toCount(raw.version));
}

/**
 * version 버전의 세이브에서, 그 뒤로 점수 세는 법이 바뀐 게임의 최고 점수를 비운다. 판 수와 마지막으로 한 때는 남긴다.
 * 서버에 올렸다는 표시와 이번 주에 낸 점수도 지워서, 옛 점수는 다시 올라가지 않고 새 규칙으로 낸 점수가 처음부터 올라가게 한다.
 * 옛 점수로 이미 이뤄 놓고 보상을 받지 않은 업적은 보상을 넣어 주고 받은 것으로 적는다. 업적은 줄지 않는 기록에서 셈하는데
 * 여기서만 기록이 줄기 때문이다. 이미 보상을 받은 업적은 받은 채로 남는다.
 */
export function resetOldScores(save: SaveData, version: number): SaveData {
  let next = save;
  for (const { since, game } of SCORE_RESETS) {
    if (version >= since) continue;
    const record = next.games[game];
    const cleared: SaveData = {
      ...next,
      games: record ? { ...next.games, [game]: { ...record, best: 0 } } : next.games,
      online: withoutGame(next.online, game),
    };
    const still = new Set(claimable(cleared.achievements, statsOf(cleared)).map((achievement) => achievement.id));
    const lost = claimable(next.achievements, statsOf(next)).filter((achievement) => !still.has(achievement.id));
    next = {
      ...cleared,
      coins: cleared.coins + lost.reduce((sum, achievement) => sum + achievement.reward, 0),
      achievements: { claimed: [...cleared.achievements.claimed, ...lost.map((achievement) => achievement.id)] },
    };
  }
  return next;
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
 * week에 게임 목록까지 있고 주가 바뀐 뒤 첫 판이면, 지난주에 받지 않은 미션 보상을 먼저 넣어 준다.
 * ranked가 false면 점수를 최고 기록과 이번 주 랭킹의 기록에 넣지 않는다(여느 판과 견줄 수 없는 판).
 * 그래도 한 판으로 세고, 코인과 오늘의 도전, 주간 미션은 여느 판처럼 따진다.
 */
export function applyPlayResult(
  save: SaveData,
  gameId: string,
  rawScore: number,
  rawCoins: number,
  now: number = Date.now(),
  challenge: DailyChallenge | null = null,
  week: WeekContext | null = null,
  ranked = true,
): PlayResult {
  // 주가 바뀐 뒤 첫 판이면 지난주에 다 채우고도 받지 않은 미션 보상부터 넣어 준다.
  // 허브는 열릴 때 넣어 주지만, 허브를 거치지 않고 판을 이어 하는 사이 주가 바뀌면
  // 아래에서 주간 기록이 새 주의 것으로 바뀌면서 그 보상이 사라진다.
  const settled = week?.games ? settleLastWeek(save, week.weekKey, week.games, now) : null;
  const base = settled ? settled.save : save;
  const score = toCount(rawScore);
  const coinsEarned =
    score > 0 ? Math.max(MIN_COINS_PER_PLAY, toCount(rawCoins)) : toCount(rawCoins);
  const previous = getRecord(base, gameId);
  const isNewBest = ranked && score > previous.best;
  const best = ranked ? Math.max(previous.best, score) : previous.best;

  let daily: DailyOutcome | null = null;
  let dailyState = base.daily;
  if (challenge && challenge.gameId === gameId && !isCleared(base.daily, challenge.dateKey)) {
    if (score >= challenge.target) {
      dailyState = clearDaily(base.daily, challenge.dateKey);
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
  let weekly = base.weekly;
  let newMissions: WeeklyMission[] = [];
  const weekBefore = week ? weeklyFor(base.weekly, week.weekKey) : null;
  if (week && weekBefore) {
    const weekAfter = recordWeeklyPlay(
      weekBefore,
      week.weekKey,
      {
        gameId,
        coins: coinsEarned + (daily?.reward ?? 0),
        dailyCleared: daily?.cleared === true,
      },
      // 주 중간에 게임 목록이 바뀌어도 "이번 주의 게임"이 그대로이도록 기록에 적어 둔다.
      pickedGame(week),
    );
    weekly = weekAfter;
    newMissions = week.missions.filter(
      (mission) =>
        !missionProgress(mission, weekBefore).complete && missionProgress(mission, weekAfter).complete,
    );
  }

  const next: SaveData = {
    ...base,
    coins: base.coins + coinsEarned + (daily?.reward ?? 0),
    games: {
      ...base.games,
      [gameId]: { best, plays: previous.plays + 1, lastPlayedAt: now },
    },
    daily: dailyState,
    weekly,
    // 이번 주 랭킹에 올릴 기록. 닉네임을 정하기 전이어도 적어 둔다.
    online: ranked ? withWeekScore(base.online, gameId, score, rankWeekOf(now)) : base.online,
    updatedAt: now,
  };

  // 이번 판 전에는 달성하지 못했던 업적만 "새로 달성"으로 알린다.
  const newAchievements = newlyAchieved(save, next);

  return {
    save: next,
    score,
    best,
    previousBest: previous.best,
    isNewBest,
    ranked,
    coinsEarned,
    daily,
    newAchievements,
    newMissions,
    lastWeekCoins: settled?.coins ?? 0,
  };
}

/** before에서는 달성하지 못했는데 after에서는 달성한 업적 */
function newlyAchieved(before: SaveData, after: SaveData): Achievement[] {
  const had = new Set(completedIds(statsOf(before)));
  return completedIds(statsOf(after))
    // 점수 세는 법이 바뀌어 기록을 비운 게임에서는 이미 보상을 받은 업적에 다시 닿을 수 있다. 그것은 새로 이룬 것이 아니다.
    .filter((id) => !had.has(id) && !isClaimed(after.achievements, id))
    .map((id) => getAchievement(id))
    .filter((achievement): achievement is Achievement => achievement !== undefined);
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
  /** 주가 바뀐 뒤 첫 판이라 먼저 넣어 준 지난주 미션 보상(PlayResult.lastWeekCoins). 없으면 0 */
  lastWeekCoins: number;
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
  const next: SaveData = { ...play.save, stages: cleared.progress };
  return {
    save: next,
    level,
    first: cleared.first,
    coinsEarned: play.coinsEarned,
    // 판 수로 달성한 업적에 더해, 깬 단계로 달성한 업적까지 함께 알린다.
    newAchievements: newlyAchieved(save, next),
    newMissions: play.newMissions,
    lastWeekCoins: play.lastWeekCoins,
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

export interface WeekSettlement {
  save: SaveData;
  /** 보상을 넣어 준 지난주의 미션 */
  missions: WeeklyMission[];
  /** 넣어 준 코인의 합 */
  coins: number;
}

/**
 * 주가 바뀌었을 때, 지난주에 다 채우고도 받지 않은 미션의 보상을 넣어 준 새 세이브를 돌려준다.
 * 넣어 준 뒤에는 주간 기록을 새 주(weekKey)의 빈 기록으로 바꿔서 두 번 주지 않는다.
 * 넣어 줄 것이 없으면 받은 세이브 그대로다.
 */
export function settleLastWeek(
  save: SaveData,
  weekKey: string,
  games: readonly WeeklyGame[],
  now: number = Date.now(),
): WeekSettlement {
  const missions = unclaimedFromLastWeek(save.weekly, weekKey, games);
  if (missions.length === 0) return { save, missions, coins: 0 };
  const coins = missions.reduce((sum, mission) => sum + mission.reward, 0);
  return {
    save: {
      ...save,
      coins: save.coins + coins,
      weekly: { ...createWeekly(), weekKey },
      updatedAt: now,
    },
    missions,
    coins,
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
 * 기록, 코인, 산 꾸미기, 받은 업적 보상, 행운 슬롯의 도감과 하던 판, 조각과 영구 해금과 유물을 지우고 설정과 닉네임은 남긴다.
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
