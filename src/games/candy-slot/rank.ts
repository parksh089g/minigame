/**
 * 행운 슬롯의 오늘의 판 랭킹: 그날의 판에서 낸 점수를 다른 사람과 견준다.
 * 서버와 주고받는 길은 등불지기의 오늘의 랭킹과 같다(online/online.ts의 noteDayScore, syncScores, loadDayBoard).
 * 여기에는 화면과 통신에 기대지 않는 것만 둔다: 어느 날의 랭킹에 올릴지, 창에 적는 글, 창의 자리.
 * 창을 그리는 일은 rank-view.ts가 맡는다.
 */
import { layoutPages, type PageLayout } from '../../core/paging';
import { failureText, type ApiFailure } from '../../online/api';
import { isRankDay, rankDayOf, rankDayStart, rankLabel, type RankBoard } from '../../online/protocol';
import { dailyDayOf, dayLabel } from './daily';

/**
 * 끝난 판의 점수를 올릴 오늘의 랭킹의 날. 올리지 않는 판이면 null이다.
 * 오늘의 판(씨앗에 날이 적힌 판)이고 그 날이 지금(now)의 랭킹 날과 같을 때만 올린다. 여느 판이나,
 * 날이 넘어간 뒤에 끝낸 어제의 판은 올리지 않는다: 오늘의 랭킹은 오늘의 운으로 낸 점수끼리만 겨룬다.
 * 기기의 시계가 틀려서 다른 날의 판을 했으면 여기서는 걸러지지 않지만, 그 점수에는 그 판의 날이 적혀 가고
 * 서버가 자기 시각의 오늘과 다른 날의 것을 버린다(worker/service.ts).
 */
export function boardDayOf(seed: string | null, now: number): number | null {
  const day = dailyDayOf(seed);
  return day !== null && isRankDay(day) && day === rankDayOf(now) ? day : null;
}

// ───────── 글 ─────────

/** 랭킹 버튼과 창에 적는 글 */
export const RANK_TEXT = {
  /** 시작 화면의 버튼 */
  button: '랭킹',
  title: '오늘의 판 랭킹',
  loading: '랭킹을 불러오는 중...',
  retry: '다시 불러오기',
  empty: '오늘은 아직 아무도 없어요.\n첫 번째로 이름을 올려 보세요!',
  /** 닉네임을 정하지 않았을 때 내 기록 칸에 적는 글과 그 아래의 버튼 */
  guest: '닉네임을 정하면 오늘의 판 기록이\n랭킹에 올라가요.',
  join: '닉네임 정하고 참여하기',
  rename: '닉네임 바꾸기',
  /** 닉네임은 있지만 오늘의 랭킹에 내 기록이 없을 때 */
  none: '오늘의 판을 마치면 올라가요',
  /** 내 기록을 올리지 못했을 때: 요청이 잦아서 서버가 잠깐 받지 않을 때와 그 밖의 까닭 */
  slow: '기록은 잠시 뒤에 올라가요',
  unsent: '기록을 아직 올리지 못했어요',
  prev: '이전',
  next: '다음',
  close: '닫기',
} as const;

/** 창의 머리글 오른쪽에 적는 날짜: "11월 17일" */
export function rankDate(day: number): string {
  return dayLabel(day);
}

/**
 * 그날(day)이 끝나고 새 날의 판과 랭킹이 시작되는 때를 이 기기의 시각으로 적는다. 한국에서는 "0시"다.
 * 다른 나라에서는 다른 시각으로 보인다(날은 어디서나 한국 시각으로 바뀐다).
 */
export function rankResetLabel(day: number): string {
  const reset = new Date(rankDayStart(day + 1));
  const minutes = reset.getMinutes();
  return `${reset.getHours()}시${minutes > 0 ? ` ${minutes}분` : ''}`;
}

/** 목록 위의 한 줄: 무엇으로 겨루는 랭킹이고 언제 새로 시작하는지 */
export function rankNote(day: number): string {
  return `같은 운으로 겨뤄요 · ${rankResetLabel(day)}에 새로 시작`;
}

/** 창이 보여 주고 있는 것: 불러오는 중, 불러오지 못함, 불러온 랭킹 */
export type RankState =
  | { kind: 'loading' }
  | { kind: 'failed'; reason: ApiFailure }
  | { kind: 'ready'; board: RankBoard };

/** 목록 자리에 랭킹 대신 적을 글. 보여 줄 줄이 있으면 null이다. */
export function rankListNote(state: RankState): string | null {
  if (state.kind === 'loading') return RANK_TEXT.loading;
  if (state.kind === 'failed') return failureText(state.reason);
  return state.board.top.length === 0 ? RANK_TEXT.empty : null;
}

/**
 * 닉네임을 정한 사람의 내 기록 칸에 적을 글. strong이면 순위와 점수라서 크게 적는다.
 * unsent는 오늘의 판에서 낸 기록을 서버에 올리지 못한 까닭이고, 다 올라가 있으면 null이다.
 * 순위는 올라가 있는 기록의 것이라, 새 기록을 올리지 못했으면 순위 대신 그 사정을 알린다.
 * 랭킹을 불러오기 전에는 적을 것이 없다(빈 글).
 */
export function rankMine(state: RankState, unsent: ApiFailure | null): { text: string; strong: boolean } {
  if (state.kind !== 'ready') return { text: '', strong: false };
  if (unsent !== null) return { text: unsent === 'slow' ? RANK_TEXT.slow : RANK_TEXT.unsent, strong: false };
  const me = state.board.me;
  if (me) return { text: `${rankLabel(me.rank)} · ${me.score}점`, strong: true };
  return { text: RANK_TEXT.none, strong: false };
}

// ───────── 창의 자리 ─────────

/**
 * 랭킹 창의 치수: 창의 폭, 머리글과 그 아래 한 줄의 높이, 랭킹 한 줄의 높이, 쪽을 넘기는 줄의 높이,
 * 내 기록 칸과 닉네임 버튼과 닫기 버튼의 높이, 그 사이의 틈, 목록 칸의 안쪽 여백, 창의 아래쪽 여백,
 * 화면의 위아래에 남기는 틈, 한 쪽에 놓는 줄 수의 범위
 */
export const RANK_BOX = {
  width: 224,
  head: 30,
  note: 16,
  row: 17,
  pager: 26,
  status: 32,
  name: 28,
  close: 32,
  gap: 6,
  inset: 4,
  bottom: 10,
  margin: 12,
  minRows: 4,
  maxRows: 15,
} as const;

export interface RankLayout {
  /** 창의 위쪽 끝과 높이 */
  top: number;
  height: number;
  /** 랭킹 줄이 놓이는 자리의 위쪽 끝과 높이. 쪽을 넘기는 줄의 자리까지 든다. */
  listTop: number;
  listHeight: number;
  /** 내 기록 칸, 닉네임 버튼, 닫기 버튼의 위쪽 끝 */
  statusTop: number;
  nameTop: number;
  closeTop: number;
}

/**
 * 화면 높이에 맞춰 창을 놓는다. 화면이 길면 한 쪽에 줄을 더 놓되 maxRows줄까지만 놓고, 창은 화면 한가운데에 둔다.
 * 화면이 아주 짧아도 minRows줄은 놓는다(그때는 위아래 틈이 줄어든다).
 */
export function rankLayout(screenHeight: number): RankLayout {
  const { head, note, row, pager, status, name, close, gap, inset, bottom, margin, minRows, maxRows } = RANK_BOX;
  const fixed = head + note + inset * 2 + gap + status + gap + name + gap + close + bottom;
  const room = Math.floor((screenHeight - margin * 2 - fixed - pager) / row);
  const rows = Math.min(maxRows, Math.max(minRows, room));
  const listHeight = rows * row + pager;
  const height = fixed + listHeight;
  const top = Math.max(2, Math.round((screenHeight - height) / 2));
  const listTop = top + head + note + inset;
  const statusTop = listTop + listHeight + inset + gap;
  const nameTop = statusTop + status + gap;
  return { top, height, listTop, listHeight, statusTop, nameTop, closeTop: nameTop + name + gap };
}

/** 랭킹 count줄을 목록 자리에 어떻게 나눠 놓을지. 다 들어가지 않으면 쪽을 넘기는 줄의 자리를 비우고 나눈다. */
export function rankPages(count: number, listHeight: number): PageLayout {
  return layoutPages(count, listHeight, RANK_BOX.row, RANK_BOX.pager);
}
