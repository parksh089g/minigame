import { describe, expect, it } from 'vitest';
import { normalizePrefs } from './prefs';
import { fullDeck, LEVELS, type GameEvent } from './rules';
import { BOT_NAMES, cardEffect, cardLabel, eventLine, LEVEL_NAME, LEVEL_NOTE, SPECIAL_RULES, SUIT_NAME, TEXT } from './text';

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

function stringsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'function') {
    const out = (value as (...args: unknown[]) => unknown)(3, 7);
    return typeof out === 'string' ? [out] : [];
  }
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringsIn);
  return [];
}

function everyLine(): string[] {
  const lines = [...stringsIn(TEXT), ...stringsIn(LEVEL_NAME), ...stringsIn(LEVEL_NOTE), ...stringsIn(SUIT_NAME), ...BOT_NAMES];
  for (const [label, text] of SPECIAL_RULES) lines.push(label, text);
  for (const card of fullDeck()) lines.push(cardLabel(card), cardEffect(card, 0), cardEffect(card, 3));
  const events: GameEvent[] = [
    { k: 'suit', who: 1, suit: 'H' },
    { k: 'skip', who: 0 },
    { k: 'reverse' },
    { k: 'again', who: 2 },
    { k: 'block', who: 3 },
    { k: 'broke', who: 1 },
    { k: 'call', who: 1 },
    { k: 'caught', who: 0, by: 1 },
    { k: 'caught', who: 1, by: 0 },
    { k: 'caught', who: 1, by: 2 },
    { k: 'draw', who: 0, count: 5, attack: true },
  ];
  for (const event of events) lines.push(eventLine(event) ?? '');
  return lines;
}

describe('원카드 화면의 글', () => {
  it('글꼴에 들어 있는 한글만 쓴다', () => {
    const known = fontSyllables();
    for (const line of everyLine()) {
      for (const char of line) {
        if (/[가-힣]/.test(char)) expect(known.has(char), `${line}: ${char}`).toBe(true);
      }
    }
  });

  it('난이도마다 이름과 설명이 있다', () => {
    for (const level of LEVELS) {
      expect(LEVEL_NAME[level].length).toBeGreaterThan(0);
      expect(LEVEL_NOTE[level].length).toBeLessThanOrEqual(26);
    }
  });
});

describe('설정', () => {
  it('이상한 값은 기본값으로 고친다', () => {
    expect(normalizePrefs(null)).toEqual({ level: 'normal', bots: 1, plays: 0, wins: 0 });
    expect(normalizePrefs({ level: 'super', bots: 9, plays: 3, wins: 8 })).toEqual({ level: 'normal', bots: 1, plays: 3, wins: 3 });
    expect(normalizePrefs({ level: 'hard', bots: 3, plays: 10, wins: 4 })).toEqual({ level: 'hard', bots: 3, plays: 10, wins: 4 });
  });
});
