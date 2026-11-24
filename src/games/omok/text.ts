/**
 * 오목 화면의 글. 글꼴(주아)에 들어 있는 완성형 한글만 쓴다. text.test.ts가 확인한다.
 */
import type { Level } from './rules';

export const OMOK_GAME_ID = 'omok';
export const OMOK_SCENE = 'Omok';

export const LEVEL_NAME: Readonly<Record<Level, string>> = { easy: '쉬움', normal: '보통', hard: '어려움' };
export const LEVEL_NOTE: Readonly<Record<Level, string>> = {
  easy: '아무 데나 두고, 막을 곳을 가끔 놓쳐요',
  normal: '넷과 열린 셋은 꼭 막아요',
  hard: '상대의 다음 수까지 따져서 둬요',
};

/** 준비 화면에서 고르는 내 돌 */
export const COLOR_CHOICES = ['black', 'white', 'alternate'] as const;
export type ColorChoice = (typeof COLOR_CHOICES)[number];
export const COLOR_NAME: Readonly<Record<ColorChoice, string>> = { black: '흑 · 먼저', white: '백 · 나중', alternate: '번갈아' };

/** 준비 화면의 규칙 칸 */
export const RULE_LINES: readonly string[] = [
  '다섯 개 이상 이으면 이겨요',
  '여섯 개 넘게 이어도 이겨요',
  '금지된 자리(쌍삼)는 없어요',
  '검은 돌이 먼저 둬요',
  '무르기는 한 판에 세 번까지',
  '판이 가득 차면 비겨요',
];

export const TEXT = {
  title: '오목',
  intro: '검은 돌과 흰 돌을 번갈아 놓아\n다섯 개를 한 줄로 먼저 이으면 이겨요',
  ruleBook: '규칙',
  firstTime: '처음이에요',
  record: (wins: number, plays: number) => `${plays}판 ${wins}승`,
  level: '컴퓨터 실력',
  color: '내 돌',
  rules: '규칙',
  start: '컴퓨터와 시작',
  place: '여기에 두기',
  undo: (left: number) => `무르기 ${left}`,
  me: '나',
  bot: '컴퓨터',
  black: '흑',
  white: '백',
  myTurn: '내 차례예요. 둘 점을 눌러요',
  tapAgain: '한 번 더 누르거나 두기를 눌러요',
  thinking: '컴퓨터가 생각하는 중이에요',
  taken: '이미 돌이 있는 점이에요',
  undone: '한 수를 물렀어요',
  win: '이겼어요!',
  lose: '졌어요',
  draw: '비겼어요',
  fiveLine: (name: string) => `${name} 다섯 개를 먼저 이었어요`,
  fullBoard: '판이 가득 차서 비겼어요',
  resultLevel: '실력',
  resultStone: '내 돌',
  resultMoves: '둔 수',
  resultUndo: '무르기',
  moves: (count: number) => `${count}수`,
  times: (count: number) => `${count}번`,
} as const;

/** 친구와 할 때의 글 */
export const FRIEND_TEXT = {
  myTurn: (name: string) => `${name} 차례예요. 둘 점을 눌러요`,
  waiting: (name: string) => `${name} 차례예요. 기다려요`,
  winBy: (name: string) => `${name} 이겼어요!`,
  stones: (black: string, white: string) => `흑 ${black} · 백 ${white}`,
  nextColors: '다음 판은 흑백을 바꿔서 둬요',
} as const;
