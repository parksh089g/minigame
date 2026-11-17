import { describe, expect, it } from 'vitest';
import {
  addFound,
  COLLECTION_SIZE,
  COLLECTION_TEXT,
  collectionEntries,
  collectionLabel,
  entryText,
  foundCount,
  isFound,
  normalizeFound,
} from './collection';
import { CHARMS } from './rules';

/** 주아 글꼴에 들어 있는 한글: KS X 1001의 완성형 2,350자 */
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

describe('찾은 부적', () => {
  it('도감에는 모든 부적이 실린다', () => {
    expect(COLLECTION_SIZE).toBe(CHARMS.length);
    expect(collectionEntries([]).map((entry) => entry.charm.id)).toEqual(CHARMS.map((charm) => charm.id));
  });

  it('처음 찾은 부적만 목록에 더한다', () => {
    const one = addFound([], 'wide');
    expect(one).toEqual(['wide']);
    const two = addFound(one, 'piggy');
    expect(two).toEqual(['wide', 'piggy']);
    // 원본은 그대로다.
    expect(one).toEqual(['wide']);
  });

  it('이미 찾았거나 없는 부적이면 받은 목록 그대로다', () => {
    const found = ['wide'];
    expect(addFound(found, 'wide')).toBe(found);
    expect(addFound(found, 'no-such-charm')).toBe(found);
    expect(addFound(found, '')).toBe(found);
  });

  it('찾았는지와 몇 개를 찾았는지 알려 준다', () => {
    const found = ['wide', 'piggy'];
    expect(isFound(found, 'piggy')).toBe(true);
    expect(isFound(found, 'tall')).toBe(false);
    expect(foundCount(found)).toBe(2);
    expect(foundCount([])).toBe(0);
    // 겹쳐 적힌 것과 없는 부적은 세지 않는다.
    expect(foundCount(['wide', 'wide', 'gone'])).toBe(1);
  });

  it('모두 찾으면 수가 도감의 크기와 같다', () => {
    let found: readonly string[] = [];
    for (const charm of CHARMS) found = addFound(found, charm.id);
    expect(foundCount(found)).toBe(COLLECTION_SIZE);
    expect(collectionEntries(found).every((entry) => entry.found)).toBe(true);
  });

  it('버튼에는 찾은 수와 모든 부적의 수를 적는다', () => {
    expect(collectionLabel([])).toBe(`도감 0/${CHARMS.length}`);
    expect(collectionLabel(['wide', 'piggy', 'tall'])).toBe(`도감 3/${CHARMS.length}`);
  });
});

describe('normalizeFound', () => {
  it('목록이 아니면 빈 도감이다', () => {
    expect(normalizeFound(undefined)).toEqual([]);
    expect(normalizeFound(null)).toEqual([]);
    expect(normalizeFound('wide')).toEqual([]);
    expect(normalizeFound({ wide: true })).toEqual([]);
  });

  it('있는 부적만 남기고 겹친 것을 빼며, 찾은 차례는 그대로 둔다', () => {
    expect(normalizeFound(['piggy', 7, 'wide', null, 'gone', 'piggy', ''])).toEqual(['piggy', 'wide']);
  });

  it('맞는 목록은 그대로다', () => {
    const all = CHARMS.map((charm) => charm.id).reverse();
    expect(normalizeFound(all)).toEqual(all);
  });
});

describe('도감의 칸', () => {
  it('찾은 부적은 이름과 설명을 보여 준다', () => {
    const entries = collectionEntries(['piggy']);
    const piggy = entries.find((entry) => entry.charm.id === 'piggy');
    if (!piggy) throw new Error('저금통이 없다');
    expect(piggy.found).toBe(true);
    expect(entryText(piggy)).toEqual({ name: piggy.charm.name, description: piggy.charm.description });
  });

  it('찾지 못한 부적은 이름도 설명도 알려 주지 않는다', () => {
    for (const entry of collectionEntries(['piggy'])) {
      if (entry.found) continue;
      const text = entryText(entry);
      expect(text.name).toBe(COLLECTION_TEXT.unknownName);
      expect(text.description).toBe(COLLECTION_TEXT.unknownDescription);
      expect(text.name).not.toContain(entry.charm.name);
      expect(text.description).not.toContain(entry.charm.description);
    }
  });

  it('도감에 적는 글은 글꼴에 들어 있는 한글만 쓴다', () => {
    const known = fontSyllables();
    expect(known.size).toBe(2350);
    for (const text of [...Object.values(COLLECTION_TEXT), collectionLabel([])]) {
      for (const letter of text.match(/[ㄱ-ㆎ가-힣]/g) ?? []) {
        expect(known.has(letter), `"${letter}" in "${text}"`).toBe(true);
      }
    }
  });
});
