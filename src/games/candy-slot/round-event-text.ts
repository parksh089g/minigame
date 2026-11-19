/**
 * 라운드 이벤트와 대장 라운드의 글: 이벤트의 이름, 한 줄 설명, 화면의 표에 적는 말, 대장의 상을 고르는 창의 글.
 * 설명의 수(두 배, 25% 같은 것)는 규칙(round-events.ts)의 수에서 만들어서, 규칙의 수를 고쳐도 글이 맞는다.
 * 이름은 HUD의 "라운드" 아래 좁은 자리에 "다음"을 붙여서도 들어가게 다섯 글자 안쪽으로 짓는다.
 */
import { timesText } from './perks';
import { eventInfoOf, ruleOf, type RoundEvent, type RoundEventId, type RoundRule } from './round-events';
import { SYMBOLS } from './rules';

/** "두 배"처럼 곱을 세는 말 */
const TIMES_WORDS = ['한', '두', '세', '네', '다섯'];
function timesWord(times: number): string {
  const word = TIMES_WORDS[times - 1];
  return word ? `${word} 배` : `${times}배`;
}

interface EventText {
  /** 이름. 그림을 고르는 이벤트는 고른 그림의 이름을 받는다. */
  name: (symbol: string) => string;
  /** 한 줄 설명 */
  line: (rule: RoundRule, symbol: string) => string;
}

const TEXT: Readonly<Record<RoundEventId, EventText>> = {
  gold: {
    name: (symbol) => `${symbol} 잔치`,
    line: (rule, symbol) => `${symbol} 상금이 ${timesWord(rule.valueTimes?.[1] ?? 1)}예요`,
  },
  lucky: { name: (symbol) => `${symbol} 풍년`, line: (_, symbol) => `${symbol} 그림이 자주 나와요` },
  bonus: { name: () => '넉넉한 날', line: (rule) => `이번 라운드는 ${timesText(rule.spins ?? 0)} 더 돌려요` },
  center: { name: () => '가운데 행운', line: () => '가운데 칸이 둘에 한 번 7이에요' },
  holds: { name: () => '자물쇠 풀림', line: (rule) => `열을 ${timesText(rule.holds ?? 0)} 더 잠글 수 있어요` },
  short: {
    name: () => '짧은 라운드',
    line: (rule) => `${timesText(-(rule.spins ?? 0))} 덜 돌리고 목표가 ${100 - (rule.targetRate ?? 100)}% 낮아요`,
  },
  'no-diag': { name: () => '대각선 휴일', line: () => '대각선은 맞아도 금화가 없어요' },
  'no-miss': { name: () => '빈손의 날', line: () => '꽝이면 위로 금화가 없어요' },
  heavy: { name: () => '무거운 목표', line: (rule) => `목표가 ${(rule.targetRate ?? 100) - 100}% 높아요` },
  lock: { name: () => '잠금 도깨비', line: () => '이번 라운드는 열을 잠글 수 없어요' },
  greed: { name: () => '욕심 너구리', line: (rule) => `목표가 ${(rule.targetRate ?? 100) - 100}% 높아요` },
  thief: { name: () => '7 도둑 까치', line: () => '7이 하나도 안 나와요' },
  slow: { name: () => '느림보 거북', line: (rule) => `${timesText(-(rule.spins ?? 0))} 덜 돌려요` },
};

function symbolName(event: RoundEvent): string {
  return SYMBOLS[event.symbol ?? 0]?.name ?? '';
}

/** 이벤트의 이름: "체리 잔치", "대각선 휴일", "잠금 도깨비" */
export function eventName(event: RoundEvent): string {
  return TEXT[event.id].name(symbolName(event));
}

/** 이벤트가 하는 일을 적은 한 줄: "체리 상금이 두 배예요" */
export function eventLine(event: RoundEvent): string {
  return TEXT[event.id].line(ruleOf(event), symbolName(event));
}

/** 대장인지 */
export function isBoss(event: RoundEvent): boolean {
  return eventInfoOf(event.id)?.boss ?? false;
}

/**
 * HUD의 "라운드" 아래 표에 적는 말. 돌리는 동안은 이름(대장이면 "대장"을 붙인다), 가게에서는 다음 라운드의 것이라
 * "다음"을 붙인다.
 */
export function eventTag(event: RoundEvent, ahead: boolean): string {
  if (ahead) return `다음 ${eventName(event)}`;
  return isBoss(event) ? `대장 ${eventName(event)}` : eventName(event);
}

/** 라운드를 시작할 때 띄우는 알림의 첫 줄. 대장 라운드는 대장이 나왔다고 알린다. */
export function eventHeadline(event: RoundEvent): string {
  return isBoss(event) ? `대장 등장! ${eventName(event)}` : eventName(event);
}

/** 대장의 상을 고르는 창의 글 */
export const REWARD_TEXT = {
  title: '대장 보상',
  guide: '한 장을 공짜로 붙여요',
  free: '공짜',
  /** 자리가 없을 때 창의 맨 아래에 적는 안내 */
  full: '자리가 없으면 부적을 눌러 떼요',
  /** 부적 대신 조각을 받는 버튼 */
  pieces: (count: number): string => `대신 조각 ${count}개 받기`,
  /** 조각을 골랐을 때 띄우는 알림 */
  took: (count: number): string => `판이 끝나면 조각 ${count}개를 더 받아요`,
} as const;
