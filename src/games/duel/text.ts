/**
 * 둘이서 대결의 화면에 나오는 글. 두 사람의 반쪽에 똑같이 적히므로 한곳에 모아 둔다.
 * Phaser에 기대지 않아서, 글꼴에 없는 글자가 섞이지 않았는지 테스트로 확인할 수 있다.
 */
import type { Contest, Outcome } from './rules';

export const TEXT = {
  lobby: {
    title: '둘이서 대결',
    rule: '세 판을 먼저 이기면 승리!',
    press: '준비되면 아래 버튼을 눌러요',
    waiting: '상대를 기다리고 있어요',
    starting: '곧 시작해요',
    ready: '준비',
    readyDone: '준비 완료!',
  },
  /** 종목마다 안내 화면에 적는 이름, 한 줄 설명, 덧붙이는 말 */
  contests: {
    reaction: { name: '번쩍 반응', how: '"지금!"이 뜨면 먼저 눌러요', note: '미리 누르면 반칙이에요' },
    tug: { name: '연타 줄다리기', how: '마구 눌러서 상대 쪽으로 밀어요', note: '끝까지 밀면 이겨요' },
    symbol: { name: '같은 그림 찾기', how: '가운데와 같은 그림을 눌러요', note: '틀리면 잠깐 쉬어요' },
  } satisfies Record<Contest, { name: string; how: string; note: string }>,
  reaction: {
    wait: '기다려요...',
    how: '"지금!"이 뜨면 바로 눌러요',
    again: '다시 기다려요',
    go: '지금!',
  },
  tug: {
    ready: '준비...',
    live: '마구 눌러요!',
    note: '끝까지 밀면 이겨요',
    again: '이어서 해요',
    sudden: '먼저 누르면 승리!',
    suddenNote: '한가운데에서 시간이 끝났어요',
  },
  symbol: {
    ready: '준비...',
    again: '그림을 새로 내요',
    unknown: '?',
    how: '같은 그림을 눌러요',
    locked: '틀렸어요! 잠깐 쉬어요',
  },
  result: { won: '이겼어요!', lost: '졌어요', foul: '반칙!' },
  over: { won: '승리!', lost: '아쉬워요', again: '다시 하기', leave: '나가기' },
} as const;

/** 안내 화면에서 종목 이름 위에 적는 판 번호 */
export function roundLabel(roundNumber: number): string {
  return `${roundNumber}판`;
}

/** 판이 끝났을 때 이긴 쪽과 진 쪽에 적는 한 줄 */
export function reasonLine(outcome: Outcome, won: boolean): string {
  switch (outcome.reason) {
    case 'faster': {
      const seconds = ((outcome.reactionMs ?? 0) / 1000).toFixed(2);
      return won ? `${seconds}초 만에 눌렀어요` : '한발 늦었어요';
    }
    case 'foul':
      return won ? '상대가 신호보다 먼저 눌렀어요' : '신호보다 먼저 눌렀어요';
    case 'goal':
      return won ? '끝까지 밀었어요' : '끝까지 밀렸어요';
    case 'timeout':
      return won ? '시간이 끝났을 때 더 밀었어요' : '시간이 끝났을 때 밀려 있었어요';
    case 'suddenDeath':
      return won ? '마지막에 먼저 눌렀어요' : '마지막에 한발 늦었어요';
    case 'match':
      return won ? '같은 그림을 먼저 찾았어요' : '한발 늦었어요';
  }
}

/** 숫자 뒤에 붙는 "로"와 "으로"를 고른다. 받침이 있고 그 받침이 ㄹ이 아닌 숫자(0, 3, 6) 뒤에는 "으로"다. */
function toward(count: number): string {
  return [0, 3, 6].includes(Math.abs(count) % 10) ? '으로' : '로';
}

/** 경기가 끝났을 때의 한 줄. mine과 theirs는 그 사람과 상대가 이긴 판 수다. */
export function scoreLine(mine: number, theirs: number, won: boolean): string {
  return `${mine} 대 ${theirs}${toward(theirs)} ${won ? '이겼어요' : '졌어요'}`;
}

export function coinLine(coins: number): string {
  return `코인 +${coins}`;
}
