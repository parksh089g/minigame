/**
 * 피라미드의 오늘의 판: 날마다 누구에게나 같은 순서로 섞인 카드가 깔리는 한 판. 끝까지 치울 수 있는 판으로 고른다(solver.ts).
 * 몇 번이든 다시 할 수 있고, 그날의 가장 좋은 점수가 남고 오늘의 랭킹에 오른다.
 * 날은 다른 게임의 오늘의 판, 오늘의 랭킹과 같다(online/protocol.ts의 rankDayOf):
 * 기기가 어느 나라에 있든 한국 시각으로 0시에 하루가 넘어간다.
 *
 * 카드 순서를 알고 다시 할수록 점수가 오르는 판이라, 여느 판과 같은 최고 기록과 전체 랭킹에는 넣지 않는다(씬의 offRecordNote).
 * 한 판으로는 세고 코인도 준다. 이 게임은 오늘의 랭킹이 있는 게임의 목록(protocol.ts의 DAILY_BOARD)에 들어 있다.
 *
 * 화면과 저장소에 의존하지 않는 순수한 값과 함수만 둔다. 기록의 저장은 daily-store.ts가 맡는다.
 */
import { isRankDay, MAX_SCORE, rankDayOf, rankDayStart } from '../../online/protocol';
import { PYRAMID_GAME_ID } from './data';
import { pickWinnableSeed } from './solver';

const DAY_MS = 86_400_000;

/** 그 시각이 며칠째인지(한국 시각, 1970년 1월 1일이 0) */
export function dayIndexOf(date: Date): number {
  return rankDayOf(date.getTime());
}

/** 날짜를 "11월 20일" 꼴로 */
export function dayLabel(day: number): string {
  const date = new Date(day * DAY_MS);
  return `${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일`;
}

/**
 * 그날(day)이 끝나고 새 날의 판과 랭킹이 시작되는 때를 이 기기의 시각으로 적는다. 한국에서는 "0시"다.
 */
export function dayResetLabel(day: number): string {
  const reset = new Date(rankDayStart(day + 1));
  const minutes = reset.getMinutes();
  return `${reset.getHours()}시${minutes > 0 ? ` ${minutes}분` : ''}`;
}

/** 글을 32비트 씨앗으로 바꾼다(FNV-1a). 같은 글이면 언제나 같은 씨앗이다. */
function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * 그날의 판의 씨앗(rules.ts의 deal에 넘긴다). 게임 id와 날로만 정해지므로 같은 날에는 누구에게나 같다.
 * "게임:daily:날:0", "…:1", … 차례로 깔아 보고 처음으로 끝까지 치워지는 판을 고른다(solver.ts).
 */
export function dailySeed(day: number): number {
  const base = `${PYRAMID_GAME_ID}:daily:${Math.max(0, Math.floor(day))}`;
  return pickWinnableSeed((attempt) => hashSeed(`${base}:${attempt}`));
}

/** 여느 판의 씨앗. random으로 씨앗 글을 정하고, 오늘의 판처럼 끝까지 치워지는 판을 고른다. */
export function freeSeed(random: () => number = Math.random): number {
  const base = `${PYRAMID_GAME_ID}:free:${Math.floor(random() * 0x7fffffff)}`;
  return pickWinnableSeed((attempt) => hashSeed(`${base}:${attempt}`));
}

/**
 * 끝난 판의 점수를 올릴 오늘의 랭킹의 날. 올리지 않는 판이면 null이다.
 * 오늘의 판이고 그 날이 지금(now)의 랭킹 날과 같을 때만 올린다. 날이 넘어간 뒤에 끝낸 어제의 판은 올리지 않는다.
 */
export function boardDayOf(day: number | null, now: number): number | null {
  return day !== null && isRankDay(day) && day === rankDayOf(now) ? day : null;
}

// ───────── 기록 ─────────

/** 기기에 남기는 오늘의 판 기록 */
export interface PyramidDaily {
  /** 기록이 있는 날(dayIndexOf). 아직 한 판도 안 했으면 0 */
  day: number;
  /** 그날의 가장 좋은 점수 */
  best: number;
  /** 그날 한 판 수 */
  plays: number;
  /** 그날 피라미드를 다 치운 적이 있는지 */
  cleared: boolean;
  /** 저장한 때(ms). 같은 기기의 다른 창과 더 새것을 가리는 데 쓴다. */
  savedAt: number;
}

export function createDaily(): PyramidDaily {
  return { day: 0, best: 0, plays: 0, cleared: false, savedAt: 0 };
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_SCORE;

/** 저장된 값을 읽는다. 맞지 않는 값은 처음 상태로 돌린다. */
export function normalizeDaily(raw: unknown): PyramidDaily {
  if (typeof raw !== 'object' || raw === null) return createDaily();
  const value = raw as Record<string, unknown>;
  if (!isCount(value.day) || !isCount(value.best) || !isCount(value.plays)) return createDaily();
  const savedAt = typeof value.savedAt === 'number' && Number.isFinite(value.savedAt) ? value.savedAt : 0;
  return { day: value.day, best: value.best, plays: value.plays, cleared: value.cleared === true, savedAt };
}

/** 그날(day)의 기록. 다른 날의 기록이면 빈 기록이다. */
export function recordOn(record: PyramidDaily, day: number): PyramidDaily {
  return record.day === day ? record : { ...createDaily(), day, savedAt: record.savedAt };
}

/** 오늘의 판 한 판을 보탠다. 새 최고 기록인지도 돌려준다. */
export function addDailyRun(
  record: PyramidDaily,
  day: number,
  score: number,
  cleared: boolean,
): { record: PyramidDaily; newBest: boolean } {
  const today = recordOn(record, day);
  const newBest = today.plays === 0 || score > today.best;
  return {
    record: {
      ...today,
      best: Math.max(today.best, score),
      plays: today.plays + 1,
      cleared: today.cleared || cleared,
    },
    newBest,
  };
}
