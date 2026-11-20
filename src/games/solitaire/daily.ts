/**
 * 솔리테어의 오늘의 판: 날마다 누구에게나 같은 카드 배치가 나오는 한 판. 꼭 풀리는 판으로 고른다(solver.ts).
 * 몇 번이든 다시 할 수 있고, 그날의 가장 좋은 점수가 오늘의 랭킹에 오른다.
 * 날은 등불지기, 행운 슬롯, 텃밭 지키기의 오늘의 판과 같다(online/protocol.ts의 rankDayOf): 한국 시각으로 0시에 넘어간다.
 *
 * 같은 판을 알고 다시 할수록 점수가 오르는 판이라 여느 판과 같은 최고 기록과 전체 랭킹에는 넣지 않는다(씬의 offRecordNote).
 * 한 판으로는 세고 코인도 준다.
 * 화면과 저장소에 기대지 않는 순수한 값과 함수만 둔다.
 */
import { seededRandom } from '../../core/stages';
import { rankDayOf, rankDayStart } from '../../online/protocol';
import { SOLITAIRE_GAME_ID, type Board } from './rules';
import { pickSolvableDeal } from './solver';

const DAY_MS = 86_400_000;

/** 그 시각이 며칠째인지(한국 시각, 1970년 1월 1일이 0) */
export function dayIndexOf(date: Date): number {
  return rankDayOf(date.getTime());
}

/** 날을 "11월 20일" 꼴로 */
export function dayLabel(day: number): string {
  const date = new Date(day * DAY_MS);
  return `${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일`;
}

/** 그날이 끝나고 새 판이 시작되는 때를 이 기기의 시각으로 적는다. 한국에서는 "0시"다. */
export function dayResetLabel(day: number): string {
  const reset = new Date(rankDayStart(day + 1));
  const minutes = reset.getMinutes();
  return `${reset.getHours()}시${minutes > 0 ? ` ${minutes}분` : ''}`;
}

/** 그날의 판. 게임 id와 날로만 정해지므로 같은 날에는 누구에게나 같다. */
export function dailyDeal(day: number): Board {
  return pickSolvableDeal(`${SOLITAIRE_GAME_ID}:daily:${Math.max(0, Math.floor(day))}`, seededRandom);
}

/** 여느 판. random으로 씨앗을 정하고, 꼭 풀리는 판을 고른다. */
export function freshDeal(random: () => number = Math.random): Board {
  return pickSolvableDeal(`${SOLITAIRE_GAME_ID}:free:${Math.floor(random() * 0x7fffffff)}`, seededRandom);
}

/** 세이브에 적어 둔 그날의 판 기록(online.day)에서 이 게임의 점수. 다른 날의 것이면 0. */
export function dayBestOf(record: { key: number; bests: Record<string, number> } | null, day: number): number {
  return record && record.key === day ? (record.bests[SOLITAIRE_GAME_ID] ?? 0) : 0;
}

export const DAILY_TEXT = {
  name: '오늘의 판',
  offToday: '오늘의 판 기록은 오늘의 랭킹에만 남아요',
  offPast: '날이 바뀌어 지난 판은 기록하지 않아요',
} as const;
