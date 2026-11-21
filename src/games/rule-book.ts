/**
 * 카드 게임의 규칙 안내서. 규칙을 모르는 사람이 처음부터 따라 읽을 수 있게, 몇 쪽에 걸쳐 그림 카드와 함께 풀어 쓴다.
 * 일시정지 화면의 "방법 보기"(how-to.ts)가 이미 아는 사람을 위한 요약이라면, 여기는 처음 하는 사람을 위한 설명이다.
 * 준비 화면의 "규칙" 버튼과 일시정지 화면의 "방법 보기 → 규칙 자세히"에서 열리고(RuleBookScene),
 * 처음 하는 게임이면 한 번 저절로 열린다. 규칙을 바꾸면 여기도 같이 고친다.
 *
 * 한 쪽에는 카드 줄(rows)을 RULE_BOOK_MAX_ROWS개까지, 글(lines)을 RULE_BOOK_MAX_LINES줄까지 쓴다.
 * 한 줄은 RULE_BOOK_LINE_CHARS자 안쪽이고, 한글은 글꼴에 들어 있는 완성형 2,350자만 쓴다. rule-book.test.ts가 확인한다.
 */
import { HULA_GAME_ID } from './hula/data';
import { GAME_ID as HIGH_LOW_ID } from './high-low/rules';
import { ONE_CARD_GAME_ID } from './one-card/text';
import { PYRAMID_GAME_ID } from './pyramid/data';
import { SOLITAIRE_GAME_ID } from './solitaire/rules';

export const RULE_BOOK_MAX_ROWS = 2;
export const RULE_BOOK_MAX_LINES = 5;
export const RULE_BOOK_LINE_CHARS = 32;
/** 한 줄에 놓는 그림의 수. 가장 좁은 카드 줄도 안내서의 폭에 들어가야 한다. */
export const RULE_BOOK_MAX_TOKENS = 7;

/**
 * 카드 줄에 놓는 그림 하나.
 * - 카드: 숫자(A, 2~10, J, Q, K) 뒤에 무늬(S 스페이드, H 하트, D 다이아, C 클로버). 예: "7H", "10S"
 * - 조커: "BJ"(흑백 조커), "CJ"(컬러 조커). 뒷면: "back"
 * - 화살표: ">". 그 밖의 짧은 글(예: "+", "=", "13", "...")은 그대로 적는다.
 * 카드 앞에 "*"를 붙이면 눈에 띄게(살짝 들어 올리고 테를 두른다), "-"를 붙이면 흐리게 그린다.
 */
export type RuleToken = string;

export interface RuleRow {
  cards: readonly RuleToken[];
  /** 줄 아래에 작게 적는 설명 */
  note?: string;
}

export interface RulePage {
  title: string;
  rows?: readonly RuleRow[];
  lines: readonly string[];
}

export type Suit = 'S' | 'H' | 'D' | 'C';

export type ParsedToken =
  | { kind: 'card'; rank: string; suit: Suit; mark: Mark }
  | { kind: 'joker'; color: boolean; mark: Mark }
  | { kind: 'back'; mark: Mark }
  | { kind: 'arrow' }
  | { kind: 'text'; text: string };

export type Mark = 'none' | 'focus' | 'dim';

const CARD_PATTERN = /^(A|[2-9]|10|J|Q|K)([SHDC])$/;

/** 그림 하나를 읽는다. 카드가 아니면 글로 친다. */
export function parseToken(token: RuleToken): ParsedToken {
  if (token === '>') return { kind: 'arrow' };
  const mark: Mark = token.startsWith('*') ? 'focus' : token.startsWith('-') && token.length > 1 ? 'dim' : 'none';
  const body = mark === 'none' ? token : token.slice(1);
  if (body === 'back') return { kind: 'back', mark };
  if (body === 'BJ' || body === 'CJ') return { kind: 'joker', color: body === 'CJ', mark };
  const card = CARD_PATTERN.exec(body);
  if (card) return { kind: 'card', rank: card[1], suit: card[2] as Suit, mark };
  return { kind: 'text', text: token };
}

export const RULE_BOOK: Readonly<Record<string, readonly RulePage[]>> = {
  [SOLITAIRE_GAME_ID]: [
    {
      title: '무엇을 하나요?',
      rows: [{ cards: ['AS', '2S', '3S', '...', 'QS', 'KS'], note: '무늬마다 A부터 K까지 차례로' }],
      lines: [
        '카드를 무늬별로 A, 2, 3 … K 차례로 모아요',
        '맨 위 네 칸이 모으는 자리예요',
        '네 칸을 모두 K까지 채우면 이겨요',
      ],
    },
    {
      title: '판의 생김새',
      rows: [{ cards: ['back', 'back', '8D'], note: '줄마다 맨 아래 한 장만 앞면' }],
      lines: [
        '아래에는 카드 일곱 줄이 깔려 있어요',
        '뒷면 카드는 위의 카드를 치워야 뒤집혀요',
        '왼쪽 위 더미를 누르면 한 장씩 넘겨요',
        '넘긴 카드의 맨 위 한 장을 쓸 수 있어요',
        '더미가 떨어지면 눌러서 다시 넘겨요',
      ],
    },
    {
      title: '줄에 겹치기',
      rows: [
        { cards: ['9S', '8H', '7C', '6D'], note: '하나씩 작게, 빨강과 검정을 번갈아' },
        { cards: ['9S', '-8C'], note: '같은 색은 겹칠 수 없어요' },
      ],
      lines: [
        '줄에는 하나 작고 색이 다른 카드를 놓아요',
        '겹친 카드는 묶음째로 옮길 수 있어요',
      ],
    },
    {
      title: '빈 줄에는 K만',
      rows: [{ cards: ['*KH', 'QS', 'JD'], note: 'K로 시작하는 묶음도 옮길 수 있어요' }],
      lines: [
        '줄이 비면 K만 놓을 수 있어요',
        'K를 빈 줄로 옮기면 밑의 카드가 열려요',
        '뒷면 카드가 많은 줄부터 여는 게 요령이에요',
      ],
    },
    {
      title: '누르기와 점수',
      lines: [
        '카드를 누르면 알맞은 곳으로 저절로 가요',
        '끌어서 원하는 곳에 놓아도 돼요',
        '위 칸에 올리면 10점, 뒷면을 열면 5점',
        '다 모으면 300점에 빨리 끝낸 만큼 더 받아요',
        '더미를 두 번째부터 다시 넘기면 20점 깎여요',
      ],
    },
  ],
  [PYRAMID_GAME_ID]: [
    {
      title: '무엇을 하나요?',
      rows: [{ cards: ['6H', '+', '7S', '=', '13'], note: '두 장을 더해 13이면 치워져요' }],
      lines: [
        '합이 13이 되는 두 장을 차례로 눌러 치워요',
        '피라미드의 카드 28장을 다 치우면 이겨요',
      ],
    },
    {
      title: '카드의 숫자',
      rows: [
        { cards: ['AC', 'JD', 'QS', 'KH'], note: 'A는 1, J는 11, Q는 12, K는 13' },
        { cards: ['*KS'], note: 'K는 혼자서 13이라 한 번만 눌러요' },
      ],
      lines: ['짝: A와 Q, 2와 J, 3과 10', '4와 9, 5와 8, 6과 7'],
    },
    {
      title: '고를 수 있는 카드',
      lines: [
        '카드 위에 다른 카드가 얹혀 있으면 못 골라요',
        '아래 줄의 두 장이 다 치워져야 드러나요',
        '그래서 맨 아랫줄부터 짝을 찾아요',
        '막히면 힌트를 눌러 보세요',
      ],
    },
    {
      title: '더미 넘기기',
      rows: [{ cards: ['back', '>', '*9S'], note: '넘긴 카드도 짝으로 쓸 수 있어요' }],
      lines: [
        '짝이 없으면 더미를 눌러 한 장 넘겨요',
        '넘긴 카드 맨 위 한 장을 피라미드와 맞춰요',
        '더미는 세 바퀴까지 넘길 수 있어요',
        '더 둘 곳이 없으면 판이 끝나요',
      ],
    },
    {
      title: '점수',
      lines: [
        '피라미드 카드는 한 장에 10점, 넘긴 카드는 5점',
        '더미를 넘기지 않고 이어 치우면 덤이 붙어요',
        '다 치우면 150점에 남은 돌리기마다 50점',
        '빨리 다 치울수록 점수가 더 붙어요',
      ],
    },
  ],
  [HULA_GAME_ID]: [
    {
      title: '무엇을 하나요?',
      lines: [
        '컴퓨터와 카드를 7장씩 나눠 갖고 번갈아 해요',
        '손의 카드를 묶음으로 탁자에 내려놓아요',
        '손의 카드를 먼저 다 비우면 이겨요',
      ],
    },
    {
      title: '묶음 두 가지',
      rows: [
        { cards: ['7S', '7H', '7D'], note: '같은 숫자 3~4장' },
        { cards: ['4H', '5H', '6H'], note: '같은 무늬로 이어진 숫자 3장 이상' },
      ],
      lines: ['A는 가장 낮은 카드로만 써요(Q, K, A는 안 돼요)'],
    },
    {
      title: '7과 붙이기',
      rows: [
        { cards: ['*7C'], note: '7은 한 장만 내도 돼요' },
        { cards: ['4H', '5H', '6H', '+', '*7H'], note: '탁자의 묶음에 이어 붙이기' },
      ],
      lines: [
        '탁자의 묶음에 맞는 카드를 한 장씩 붙여요',
        '상대의 묶음에도 붙일 수 있어요',
      ],
    },
    {
      title: '내 차례에 할 일',
      lines: [
        '1. 덱이나 버린 카드에서 한 장 가져와요',
        '2. 묶음을 내거나 붙여요(안 해도 돼요)',
        '3. 한 장을 버리면 상대 차례예요',
        '버린 카드는 바로 낼 수 있을 때만 가져와요',
        '가져온 카드는 버리기 전에 꼭 내야 해요',
      ],
    },
    {
      title: '이기면 받는 점수',
      lines: [
        '상대 손에 남은 숫자의 합이 내 점수예요',
        '한 번도 안 내다가 한꺼번에 다 내면 훌라! 두 배',
        '상대가 하나도 못 냈으면 박! 또 두 배',
        '덱이 떨어지면 남은 숫자 합이 적은 쪽이 이겨요',
        '어려운 상대일수록 점수를 몇 배 더 받아요',
      ],
    },
  ],
  [ONE_CARD_GAME_ID]: [
    {
      title: '무엇을 하나요?',
      rows: [
        { cards: ['5H', '>', '*9H'], note: '무늬가 같거나' },
        { cards: ['5H', '>', '*5S'], note: '숫자가 같으면 낼 수 있어요' },
      ],
      lines: [
        '맨 위 카드와 무늬나 숫자가 같은 카드를 내요',
        '손의 카드를 먼저 다 내면 이겨요',
      ],
    },
    {
      title: '카드 내기와 받기',
      lines: [
        '카드를 한 번 누르면 고르고, 또 누르면 내요',
        '낼 카드가 없으면 카드 받기를 눌러요',
        '한 장 받으면 차례가 넘어가요',
        '손의 카드가 20장을 넘으면 파산해서 져요',
      ],
    },
    {
      title: '공격 카드',
      rows: [{ cards: ['AS', '2H', 'BJ', 'CJ'], note: 'A 3장(스페이드 A 5장), 2 2장, 조커 5장, 7장' }],
      lines: [
        '공격을 받으면 그만큼 카드를 받아요',
        '같은 무늬나 숫자의 더 센 공격으로 넘겨요',
        '같은 무늬의 3을 내면 공격을 막아요',
        '조커 공격은 더 센 조커로만 넘길 수 있어요',
      ],
    },
    {
      title: '기술 카드',
      rows: [{ cards: ['7D', 'JC', 'QS', 'KH'] }],
      lines: [
        '7: 다음에 낼 무늬를 바꿔요',
        'J: 다음 사람을 건너뛰어요',
        'Q: 차례 방향을 거꾸로 바꿔요',
        'K: 한 장을 더 내요',
        '조커 다음에는 아무 카드나 낼 수 있어요',
      ],
    },
    {
      title: '원카드!',
      rows: [{ cards: ['*9C'], note: '한 장 남으면 외쳐요' }],
      lines: [
        '카드가 한 장 남으면 원카드! 버튼을 눌러요',
        '남이 먼저 누르면 벌로 한 장 받아요',
        '컴퓨터가 한 장 남았을 때 먼저 눌러도 돼요',
      ],
    },
    {
      title: '이기면 받는 점수',
      lines: [
        '실력에 따라 100, 200, 300점을 받아요',
        '컴퓨터에 남은 카드 한 장마다 10점 더',
        '상대가 많을수록 점수가 더 붙어요',
        '지면 0점이에요',
      ],
    },
  ],
  [HIGH_LOW_ID]: [
    {
      title: '무엇을 하나요?',
      rows: [{ cards: ['7S', '>', 'back'], note: '다음 카드는 7보다 높을까, 낮을까?' }],
      lines: [
        '놓인 카드를 보고 다음 카드를 맞혀요',
        '높다나 낮다를 누르면 다음 카드가 뒤집혀요',
      ],
    },
    {
      title: '카드의 높낮이',
      rows: [{ cards: ['AH', '2C', '...', '10D', 'JS', 'QH', 'KC'], note: 'A가 가장 낮고 K가 가장 높아요' }],
      lines: [
        '무늬는 따지지 않아요',
        '같은 숫자가 나오면 비겨서 그대로예요',
      ],
    },
    {
      title: '점수',
      lines: [
        '맞히기 어려운 쪽을 맞힐수록 점수가 커요',
        '버튼에 받을 점수와 맞힐 확률이 나와요',
        '5번 이어 맞힐 때마다 1점씩 더 붙어요',
      ],
    },
    {
      title: '하트와 넘기기',
      lines: [
        '틀리면 하트를 잃고, 셋 다 잃으면 끝나요',
        '넘기기로 맞히지 않고 카드를 바꿀 수 있어요',
        '넘기기는 한 판에 두 번이에요',
        '나온 카드는 다시 안 나오니 기억해 두세요',
      ],
    },
  ],
};

/** 그 게임의 규칙 안내서. 없으면 null */
export function ruleBookFor(gameId: string): readonly RulePage[] | null {
  const pages = RULE_BOOK[gameId];
  return pages && pages.length > 0 ? pages : null;
}

/** 안내서를 본 게임을 이 기기에 적어 두는 자리. 이 기기에서만 쓰는 편의라 localStorage에 둔다. */
const SEEN_KEY = 'pocket-arcade:rule-book-seen';

function readSeen(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/** 이 게임의 안내서를 본 적이 있는지 */
export function hasSeenRuleBook(gameId: string): boolean {
  return readSeen().includes(gameId);
}

/** 이 게임의 안내서를 본 것으로 적는다. 적지 못해도(사생활 보호 창) 그냥 넘어간다. */
export function markRuleBookSeen(gameId: string): void {
  const seen = readSeen();
  if (seen.includes(gameId)) return;
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen, gameId]));
  } catch {
    // 적지 못하면 다음에 처음 열 때 한 번 더 저절로 열린다.
  }
}

/**
 * 판을 열 때 안내서를 저절로 보여 줄지: 안내서가 있고, 그 게임을 한 판도 하지 않았고, 아직 보지 않았을 때.
 * 이미 해 본 사람(이 기능이 생기기 전부터 하던 사람)에게는 띄우지 않는다.
 */
export function shouldOfferRuleBook(gameId: string, plays: number): boolean {
  return ruleBookFor(gameId) !== null && plays === 0 && !hasSeenRuleBook(gameId);
}
