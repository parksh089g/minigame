import { describe, expect, it } from 'vitest';
import { PLAYERS, WINS_TO_TAKE_MATCH, type Outcome, type WinReason } from './rules';
import { coinLine, reasonLine, roundLabel, scoreLine, TEXT } from './text';

/**
 * 주아 글꼴에 들어 있는 한글: KS X 1001의 완성형 2,350자.
 * EUC-KR에서 첫 바이트 0xB0~0xC8, 둘째 바이트 0xA1~0xFE인 글자가 바로 그것이다.
 */
function fontSyllables(): Set<string> {
  const decoder = new TextDecoder('euc-kr');
  const syllables = new Set<string>();
  for (let lead = 0xb0; lead <= 0xc8; lead += 1) {
    for (let trail = 0xa1; trail <= 0xfe; trail += 1) {
      syllables.add(decoder.decode(new Uint8Array([lead, trail])));
    }
  }
  return syllables;
}

/** 묶음 안의 모든 글을 꺼낸다. */
function stringsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringsIn);
  return [];
}

const REASONS: WinReason[] = ['faster', 'foul', 'goal', 'timeout', 'suddenDeath', 'match'];
const outcomeOf = (reason: WinReason): Outcome => ({
  contest: reason === 'match' ? 'symbol' : reason === 'faster' || reason === 'foul' ? 'reaction' : 'tug',
  winner: 0,
  reason,
  reactionMs: reason === 'faster' ? 234 : null,
});

/** 화면에 나올 수 있는 모든 글 */
function everyLine(): string[] {
  const lines = stringsIn(TEXT);
  for (let round = 1; round <= WINS_TO_TAKE_MATCH * 2 - 1; round += 1) lines.push(roundLabel(round));
  for (const reason of REASONS) {
    for (const won of [true, false]) lines.push(reasonLine(outcomeOf(reason), won));
  }
  for (let losses = 0; losses < WINS_TO_TAKE_MATCH; losses += 1) {
    lines.push(scoreLine(WINS_TO_TAKE_MATCH, losses, true), scoreLine(losses, WINS_TO_TAKE_MATCH, false));
  }
  lines.push(coinLine(3));
  return lines;
}

describe('화면에 나오는 글', () => {
  it('글꼴에 들어 있는 한글만 쓴다', () => {
    const known = fontSyllables();
    expect(known.size).toBe(2350);
    expect(known.has('가')).toBe(true);
    expect(known.has('힝')).toBe(true);
    // 완성형에 없는 글자를 실제로 걸러 내는지도 본다.
    expect(known.has('똠')).toBe(false);

    const lines = everyLine();
    expect(lines.length).toBeGreaterThan(40);
    for (const line of lines) {
      for (const letter of line) {
        if (letter >= '가' && letter <= '힣') expect(known.has(letter), `${line}의 ${letter}`).toBe(true);
      }
    }
  });

  it('긴 줄, 화살표, 줄표를 쓰지 않는다', () => {
    for (const line of everyLine()) {
      expect(line).not.toMatch(/[—–→←↑↓]/);
      expect(line.trim()).toBe(line);
      expect(line.length).toBeLessThanOrEqual(18);
    }
  });

  it('종목마다 이름과 한 줄 설명이 있다', () => {
    for (const contest of ['reaction', 'tug', 'symbol'] as const) {
      const text = TEXT.contests[contest];
      expect(text.name.length).toBeGreaterThan(0);
      expect(text.how.length).toBeGreaterThan(0);
      expect(text.note.length).toBeGreaterThan(0);
    }
  });
});

describe('판이 끝났을 때의 한 줄', () => {
  it('이긴 쪽과 진 쪽에 서로 다른 말을 적는다', () => {
    for (const reason of REASONS) {
      const outcome = outcomeOf(reason);
      expect(reasonLine(outcome, true)).not.toBe(reasonLine(outcome, false));
    }
  });

  it('번쩍 반응을 이긴 쪽에는 걸린 시간을 초로 적는다', () => {
    expect(reasonLine(outcomeOf('faster'), true)).toBe('0.23초 만에 눌렀어요');
    expect(reasonLine({ ...outcomeOf('faster'), reactionMs: 1500 }, true)).toBe('1.50초 만에 눌렀어요');
  });

  it('반칙은 누가 먼저 눌렀는지 두 사람 모두 알 수 있게 적는다', () => {
    for (const winner of PLAYERS) {
      const outcome: Outcome = { ...outcomeOf('foul'), winner };
      expect(reasonLine(outcome, true)).toBe('상대가 신호보다 먼저 눌렀어요');
      expect(reasonLine(outcome, false)).toBe('신호보다 먼저 눌렀어요');
    }
  });
});

describe('경기가 끝났을 때의 한 줄', () => {
  it('자기가 이긴 판 수를 앞에 적고, 숫자의 받침에 맞는 조사를 붙인다', () => {
    expect(scoreLine(3, 0, true)).toBe('3 대 0으로 이겼어요');
    expect(scoreLine(3, 1, true)).toBe('3 대 1로 이겼어요');
    expect(scoreLine(3, 2, true)).toBe('3 대 2로 이겼어요');
    expect(scoreLine(0, 3, false)).toBe('0 대 3으로 졌어요');
    expect(scoreLine(2, 3, false)).toBe('2 대 3으로 졌어요');
  });

  it('받은 코인과 판 번호를 적는다', () => {
    expect(coinLine(3)).toBe('코인 +3');
    expect(roundLabel(4)).toBe('4판');
  });
});
