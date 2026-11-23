import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GAMES } from './registry';
import {
  hasSeenRuleBook,
  markRuleBookSeen,
  parseToken,
  RULE_BOOK,
  RULE_BOOK_LINE_CHARS,
  RULE_BOOK_MAX_LINES,
  RULE_BOOK_MAX_ROWS,
  RULE_BOOK_MAX_TOKENS,
  ruleBookFor,
  shouldOfferRuleBook,
} from './rule-book';

/** 주아 글꼴에 들어 있는 한글: KS X 1001의 완성형 2,350자(how-to.test.ts와 같은 셈). */
function fontSyllables(): Set<string> {
  const decoder = new TextDecoder('euc-kr');
  const syllables = new Set<string>();
  for (let lead = 0xb0; lead <= 0xc8; lead += 1) {
    for (let trail = 0xa1; trail <= 0xfe; trail += 1) syllables.add(decoder.decode(new Uint8Array([lead, trail])));
  }
  return syllables;
}

/** 안내서가 있어야 하는 카드 게임 */
const CARD_GAMES = ['solitaire', 'pyramid', 'hula', 'one-card', 'high-low', 'blackjack'];

describe('규칙 안내서', () => {
  it('카드 게임마다 안내서가 있고, 없는 게임의 안내서는 없다', () => {
    const ids = new Set(GAMES.map((game) => game.id));
    for (const id of CARD_GAMES) expect(ruleBookFor(id), id).not.toBeNull();
    for (const id of Object.keys(RULE_BOOK)) expect(ids.has(id), id).toBe(true);
    expect(ruleBookFor('lightning-tap')).toBeNull();
  });

  it('가장 짧은 화면에 들어가는 분량이다', () => {
    for (const [id, pages] of Object.entries(RULE_BOOK)) {
      expect(pages.length, id).toBeGreaterThanOrEqual(3);
      expect(pages.length, id).toBeLessThanOrEqual(6);
      for (const page of pages) {
        const where = `${id}: ${page.title}`;
        expect(page.lines.length, where).toBeGreaterThanOrEqual(1);
        expect(page.lines.length, where).toBeLessThanOrEqual(RULE_BOOK_MAX_LINES);
        expect(page.rows?.length ?? 0, where).toBeLessThanOrEqual(RULE_BOOK_MAX_ROWS);
        // 카드 줄이 둘이면 글이 길어질 자리가 모자라다.
        if ((page.rows?.length ?? 0) >= 2) expect(page.lines.length, where).toBeLessThanOrEqual(3);
        expect(page.title.length, where).toBeLessThanOrEqual(12);
        for (const line of [...page.lines, ...(page.rows ?? []).flatMap((row) => (row.note ? [row.note] : []))]) {
          expect(line.length, `${where}: ${line}`).toBeLessThanOrEqual(RULE_BOOK_LINE_CHARS);
          expect(line.trim(), `${where}: ${line}`).toBe(line);
        }
        for (const row of page.rows ?? []) expect(row.cards.length, where).toBeLessThanOrEqual(RULE_BOOK_MAX_TOKENS);
      }
    }
  });

  it('카드 줄의 그림은 카드, 조커, 뒷면, 화살표, 짧은 글 가운데 하나다', () => {
    for (const [id, pages] of Object.entries(RULE_BOOK)) {
      for (const page of pages) {
        for (const row of page.rows ?? []) {
          for (const token of row.cards) {
            const parsed = parseToken(token);
            // 카드로 읽히지 않은 것은 짧은 기호나 숫자여야 한다(카드를 잘못 적은 것을 잡는다).
            if (parsed.kind === 'text') expect(token, `${id}: ${token}`).toMatch(/^(\+|=|\.\.\.|\d{1,2})$/);
          }
        }
      }
    }
  });

  it('그림 글을 읽는다', () => {
    expect(parseToken('10S')).toEqual({ kind: 'card', rank: '10', suit: 'S', mark: 'none' });
    expect(parseToken('*KH')).toEqual({ kind: 'card', rank: 'K', suit: 'H', mark: 'focus' });
    expect(parseToken('-8C')).toEqual({ kind: 'card', rank: '8', suit: 'C', mark: 'dim' });
    expect(parseToken('CJ')).toEqual({ kind: 'joker', color: true, mark: 'none' });
    expect(parseToken('back')).toEqual({ kind: 'back', mark: 'none' });
    expect(parseToken('>')).toEqual({ kind: 'arrow' });
    expect(parseToken('13')).toEqual({ kind: 'text', text: '13' });
    expect(parseToken('-')).toEqual({ kind: 'text', text: '-' });
  });

  it('글꼴에 들어 있는 한글만 쓴다', () => {
    const known = fontSyllables();
    for (const [id, pages] of Object.entries(RULE_BOOK)) {
      for (const page of pages) {
        const texts = [page.title, ...page.lines, ...(page.rows ?? []).flatMap((row) => (row.note ? [row.note] : []))];
        for (const text of texts) {
          for (const letter of text.match(/[ㄱ-ㆎ가-힣]/g) ?? []) {
            expect(known.has(letter), `${id}: "${letter}" in "${text}"`).toBe(true);
          }
        }
      }
    }
  });
});

describe('처음 하는 게임에 안내서 띄우기', () => {
  const memory = new Map<string, string>();

  beforeEach(() => {
    memory.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => void memory.set(key, value),
      removeItem: (key: string) => void memory.delete(key),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('한 판도 안 했고 아직 안 본 카드 게임에만 띄운다', () => {
    expect(shouldOfferRuleBook('hula', 0)).toBe(true);
    expect(shouldOfferRuleBook('hula', 3)).toBe(false);
    expect(shouldOfferRuleBook('lightning-tap', 0)).toBe(false);
  });

  it('한 번 보면 다시 띄우지 않고, 다른 게임은 따로 센다', () => {
    markRuleBookSeen('hula');
    markRuleBookSeen('hula');
    expect(hasSeenRuleBook('hula')).toBe(true);
    expect(shouldOfferRuleBook('hula', 0)).toBe(false);
    expect(shouldOfferRuleBook('one-card', 0)).toBe(true);
    expect(JSON.parse(memory.get('pocket-arcade:rule-book-seen')!)).toEqual(['hula']);
  });

  it('저장소를 쓸 수 없거나 망가져 있어도 멈추지 않는다', () => {
    memory.set('pocket-arcade:rule-book-seen', '{망가짐');
    expect(hasSeenRuleBook('hula')).toBe(false);
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('막힘');
      },
      setItem: () => {
        throw new Error('막힘');
      },
    });
    expect(() => markRuleBookSeen('hula')).not.toThrow();
    expect(shouldOfferRuleBook('hula', 0)).toBe(true);
  });
});
