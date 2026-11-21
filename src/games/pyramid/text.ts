/**
 * 피라미드의 화면에 적는 글. 한글은 글꼴에 들어 있는 완성형 2,350자만 쓴다(rules.test.ts가 확인한다).
 */
import { dayResetLabel } from './daily';

export const PYRAMID_TEXT = {
  title: '피라미드',
  tagline: '합이 13인 두 장을 골라 치워요',
  rule: 'A는 1, J는 11, Q는 12, K는 혼자 치워요',
  daily: '오늘의 판',
  dailyNote: '모두 같은 카드로 겨뤄요',
  dailyNew: '새 판',
  dailyBest: (best: number) => `최고 ${best}`,
  free: '자유 판',
  freeNote: '매번 새로 섞은 카드예요',
  rank: '오늘의 랭킹',
  rankNote: '오늘의 판 점수로 겨뤄요',
  rankMine: (rank: number) => `내 순위 ${rank}위`,
  back: '나가기',
  ruleBook: '규칙',
  stockLeft: (count: number) => `더미 ${count}장`,
  passesLeft: (count: number) => `다시 돌리기 ${count}번`,
  noPasses: '다시 돌릴 수 없어요',
  recycle: '다시',
  stockEmpty: '끝',
  hint: '힌트',
  hintDraw: '더미를 넘겨 보세요',
  hintNone: '더 둘 곳이 없어요',
  finish: '끝내기',
  start: '맨 아랫줄부터 짝을 찾아요',
  cleared: '다 치웠어요!',
  stuck: '더 둘 곳이 없어요',
  chain: (count: number) => `연속 ${count}`,
  statCleared: '치운 카드',
  statLeft: '남은 피라미드',
  statChain: '최대 연속',
  statTime: '걸린 시간',
  statDaily: '오늘의 판',
  dailyRecord: (best: number) => `오늘 최고 ${best}점`,
  dailyNewBest: '오늘 최고 기록!',
  offRecordToday: '오늘의 판은 오늘의 랭킹에 올라가요',
  offRecordPast: '날이 바뀌어 기록하지 않았어요',
  quitDaily: '그만두면 이 판의 점수는 남지 않아요',
} as const;

/** 초를 "1분 05초" 꼴로 */
export function timeLabel(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return minutes > 0 ? `${minutes}분 ${String(rest).padStart(2, '0')}초` : `${rest}초`;
}

/** 오늘의 랭킹 창(rank-view.ts)에 적는 글 */
export const RANK_TEXT = {
  title: '오늘의 랭킹',
  loading: '랭킹을 불러오는 중...',
  retry: '다시 불러오기',
  empty: '오늘은 아직 아무도 없어요.\n첫 번째로 이름을 올려 보세요!',
  guest: '닉네임을 정하면 오늘의 판 점수가\n랭킹에 올라가요.',
  join: '닉네임 정하고 참여하기',
  rename: '닉네임 바꾸기',
  none: '오늘의 판을 마치면 올라가요',
  close: '닫기',
  note: (day: number) => `같은 카드로 겨뤄요 · ${dayResetLabel(day)}에 새로 시작`,
} as const;
