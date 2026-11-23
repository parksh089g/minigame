/**
 * 원카드 화면의 글. 글꼴(주아)에 들어 있는 완성형 한글만 쓴다. text.test.ts가 확인한다.
 */
import type { Card, GameEvent, Level, Suit } from './rules';

export const ONE_CARD_GAME_ID = 'one-card';
export const ONE_CARD_SCENE = 'OneCard';

export const LEVEL_NAME: Readonly<Record<Level, string>> = { easy: '쉬움', normal: '보통', hard: '어려움' };
export const LEVEL_NOTE: Readonly<Record<Level, string>> = {
  easy: '아무 카드나 내고, 원카드를 자주 잊어요',
  normal: '좋은 카드는 아껴 두고 막을 때 써요',
  hard: '내 카드가 적으면 공격하고 없는 무늬를 노려요',
};

/** 컴퓨터의 이름. 1번부터 차례로 쓴다. */
export const BOT_NAMES = ['삐삐', '깡통', '뚝딱'] as const;

export const SUIT_NAME: Readonly<Record<Suit, string>> = { S: '스페이드', D: '다이아', H: '하트', C: '클로버' };

export const RANK_LABEL = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;

export function cardLabel(card: Card): string {
  if (card.suit === null) return card.rank === 1 ? '컬러 조커' : '흑백 조커';
  return `${SUIT_NAME[card.suit]} ${RANK_LABEL[card.rank]}`;
}

/** 특수 카드 안내. 준비 화면의 규칙 칸과 카드를 골랐을 때 알림 줄에 쓴다. */
export const SPECIAL_RULES: ReadonlyArray<readonly [label: string, text: string]> = [
  ['A', '3장 공격 (스페이드는 5장)'],
  ['2', '2장 공격'],
  ['조커', '흑백 5장, 컬러 7장 공격'],
  ['3', '같은 무늬 공격을 막아요'],
  ['7', '다음 무늬를 바꿔요'],
  ['J', '다음 사람을 건너뛰어요'],
  ['Q', '차례 방향을 바꿔요'],
  ['K', '한 장 더 내요'],
];

/** 고른 카드가 하는 일 한 줄. 평범한 카드는 빈 글이다. */
export function cardEffect(card: Card, attack: number): string {
  if (card.suit === null) return card.rank === 1 ? '7장 공격! 아무 무늬나 이어 내요' : '5장 공격! 아무 무늬나 이어 내요';
  if (attack > 0 && card.rank === 3) return '공격을 막아요';
  switch (card.rank) {
    case 1:
      return card.suit === 'S' ? '5장 공격' : '3장 공격';
    case 2:
      return '2장 공격';
    case 7:
      return '다음 무늬를 골라요';
    case 11:
      return '다음 사람을 건너뛰어요';
    case 12:
      return '차례 방향을 바꿔요';
    case 13:
      return '한 장 더 내요';
    default:
      return '';
  }
}

export const TEXT = {
  title: '원카드',
  intro: '컴퓨터와 겨루는 카드 게임이에요.\n같은 무늬나 숫자를 내고, 먼저 다 내면 이겨요.',
  level: '컴퓨터 실력',
  bots: '상대 수',
  botCount: ['1명', '2명', '3명'],
  rules: '특수 카드',
  ruleBook: '규칙',
  start: '시작!',
  record: (wins: number, plays: number) => `${plays}판 ${wins}승`,
  firstTime: '첫 판을 해 봐요',
  myTurn: '내 차례예요. 낼 카드를 눌러요',
  noCard: '낼 카드가 없어요. 카드를 받아요',
  tapAgain: '한 번 더 누르면 내요',
  cannot: '그 카드는 지금 낼 수 없어요',
  attacked: (n: number) => `${n}장 공격! 막거나 받아요`,
  pickSuit: '다음 무늬를 골라요',
  draw: '카드 받기',
  takeAttack: (n: number) => `${n}장 받기`,
  oneCard: '원카드!',
  callNow: '한 장 남았어요! 얼른 원카드를 눌러요',
  catchNow: (name: string) => `${name} 한 장 남음! 원카드를 눌러 잡아요`,
  thinking: (name: string) => `${name} 차례예요`,
  cards: (n: number) => `${n}장`,
  broke: '파산',
  me: '나',
  win: '이겼어요!',
  lose: '졌어요',
  youBroke: '카드가 너무 많아 파산했어요',
  winnerLine: (name: string) => `${name} 승리`,
  deck: (n: number) => `남은 카드 ${n}`,
  suitNow: '이번 무늬',
  anySuit: '아무거나',
  resultLevel: '컴퓨터 실력',
  resultBots: '상대 수',
  resultLeft: '내 남은 카드',
  resultWinner: '이긴 사람',
} as const;

/** 이름: 0번은 "나", 나머지는 컴퓨터 이름 */
export const nameOf = (who: number): string => (who === 0 ? TEXT.me : BOT_NAMES[who - 1]);
const defaultName = nameOf;

/** 친구와 할 때의 글 */
export const FRIEND_TEXT = {
  myTurn: (name: string) => `${name} 차례예요. 낼 카드를 눌러요`,
  waiting: (name: string) => `${name} 차례예요. 기다려요`,
  callNow: (seconds: number) => `한 장 남았어요! ${seconds}초 안에 원카드!`,
  foeCalling: (name: string) => `${name} 원카드를 외치는 중이에요`,
  missed: '원카드를 놓쳐서 한 장 받아요',
  pickSuit: (name: string) => `${name} 무늬를 고르는 중이에요`,
  winBy: (name: string) => `${name} 이겼어요!`,
  left: (a: string, an: number, b: string, bn: number) => `남은 카드  ${a} ${an}장 · ${b} ${bn}장`,
  brokeLine: (name: string) => `${name} 카드가 너무 많아 파산했어요`,
  emptyLine: (name: string) => `${name} 카드를 다 냈어요`,
} as const;

/**
 * 알림 줄에 보일 일. 화면에 따로 알리지 않는 일은 null.
 * name은 사람 번호를 이름으로 바꾼다. 친구와 할 때는 0번이 "나"(한 폰이면 1P나 2P), 1번이 친구다.
 */
export function eventLine(event: GameEvent, nameOf: (who: number) => string = defaultName): string | null {
  switch (event.k) {
    case 'suit':
      return `${nameOf(event.who)}: 무늬를 ${SUIT_NAME[event.suit]}로!`;
    case 'skip':
      return `${nameOf(event.who)} 건너뛰기!`;
    case 'reverse':
      return '차례 방향이 바뀌었어요';
    case 'again':
      return `${nameOf(event.who)} 한 장 더!`;
    case 'block':
      return `${nameOf(event.who)}: 공격을 막았어요!`;
    case 'broke':
      return `${nameOf(event.who)} 파산!`;
    case 'call':
      return `${nameOf(event.who)}: 원카드!`;
    case 'caught':
      if (event.who === 0) return `${nameOf(event.by)}: 원카드! 들켜서 한 장 받아요`;
      return event.by === 0 ? `잡았다! ${nameOf(event.who)} 한 장 받기` : `${nameOf(event.who)} 들킴! 한 장 받기`;
    case 'draw':
      return event.attack ? `${nameOf(event.who)}: 공격 ${event.count}장을 받았어요` : null;
    default:
      return null;
  }
}
