import { describe, expect, it } from 'vitest';
import {
  BASE_SPINS,
  CHARMS,
  charmOf,
  lineTimesOf,
  scoreSpin,
  spinsOf,
  SYMBOLS,
  upgradedOf,
  valuesOf,
  weightsOf,
  WILD,
} from './rules';
import {
  CHARM_SETS,
  newSetBonuses,
  nextTierText,
  SET_TEXT,
  setBonusesOf,
  setCheerText,
  setCount,
  setEffectsOf,
  setNoteOf,
  setOf,
  setProgressOf,
  setProgressText,
  shopSetsOf,
} from './sets';

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

const leveled = (id: string, level: number): string => {
  let next = id;
  for (let step = 0; step < level; step += 1) next = upgradedOf(next);
  return next;
};
const mustSet = (id: string) => {
  const set = CHARM_SETS.find((item) => item.id === id);
  if (!set) throw new Error(id);
  return set;
};

describe('세트의 목록', () => {
  it('네 세트 넘게 있고, 세트마다 있는 부적 셋이며, 한 부적은 많아야 한 세트에 든다', () => {
    expect(CHARM_SETS.length).toBeGreaterThanOrEqual(4);
    expect(CHARM_SETS.length).toBeLessThanOrEqual(6);
    const seen = new Set<string>();
    for (const set of CHARM_SETS) {
      expect(set.members.length, set.id).toBeGreaterThanOrEqual(2);
      for (const id of set.members) {
        expect(charmOf(id), id).toBe(CHARMS.find((charm) => charm.id === id));
        expect(seen.has(id), id).toBe(false);
        seen.add(id);
      }
      // 단계는 2장과 3장이고, 다 모으는 수를 넘지 않는다.
      expect(set.tiers.map((tier) => tier.count)).toEqual([2, 3]);
      expect(set.tiers.at(-1)?.count).toBeLessThanOrEqual(set.members.length);
    }
    expect(new Set(CHARM_SETS.map((set) => set.id)).size).toBe(CHARM_SETS.length);
    // 세트에 들지 않는 부적도 있다: 어느 세트에 붙여도 되는 것들이다.
    expect(CHARMS.some((charm) => !setOf(charm.id))).toBe(true);
  });

  it('적는 글은 짧고, 글꼴에 들어 있는 한글만 쓰며, 줄표를 쓰지 않는다', () => {
    const known = fontSyllables();
    const texts = [
      SET_TEXT.teach,
      ...CHARM_SETS.flatMap((set) => [
        set.name,
        set.tag,
        ...set.tiers.flatMap((tier) => [tier.description, nextTierText(tier)]),
        setProgressText({ set, count: set.members.length, size: set.members.length }),
        ...set.tiers.map((tier) => setCheerText({ set, tier })),
      ]),
    ];
    for (const text of texts) {
      for (const letter of text.match(/[ㄱ-ㆎ가-힣]/g) ?? []) expect(known.has(letter), `"${letter}" in "${text}"`).toBe(true);
      expect(text, text).not.toMatch(/[—–]/);
    }
    for (const set of CHARM_SETS) {
      expect(set.tag.length, set.tag).toBeLessThanOrEqual(3);
      for (const tier of set.tiers) expect(tier.description.length, tier.description).toBeLessThanOrEqual(14);
      expect(set.name).toBe(`${set.tag} 세트`);
    }
    expect(SET_TEXT.teach.length).toBeLessThanOrEqual(18);
  });
});

describe('세트를 세기', () => {
  it('붙인 부적 가운데 세트에 드는 것을 세고, 강화한 부적도 원래 부적으로 센다', () => {
    const cherry = mustSet('cherry');
    expect(setCount([], cherry)).toBe(0);
    expect(setCount(['more-cherry', 'wide'], cherry)).toBe(1);
    expect(setCount(['more-cherry+', 'gold-cherry+++', 'wide'], cherry)).toBe(2);
    expect(setCount([leveled('more-cherry', 2), 'gold-cherry', leveled('twins', 3)], cherry)).toBe(3);
    expect(setOf('twins++')?.id).toBe('cherry');
    expect(setOf('wide')).toBeUndefined();
    expect(setOf('no-such-charm')).toBeUndefined();
  });

  it('모은 정도: 한 장이라도 붙인 세트만, 듣는 단계와 다음 단계까지', () => {
    expect(setProgressOf(['wide', 'crown'])).toEqual([]);
    const progress = setProgressOf(['more-cherry+', 'gold-cherry', 'more-seven']);
    expect(progress.map((item) => [item.set.id, item.count, item.size])).toEqual([
      ['cherry', 2, 3],
      ['seven', 1, 3],
    ]);
    expect(progress[0].active).toBe(mustSet('cherry').tiers[0]);
    expect(progress[0].next).toBe(mustSet('cherry').tiers[1]);
    expect(progress[1].active).toBeNull();
    expect(setProgressText(progress[0])).toBe('체리 세트 2/3');
  });

  it('덤은 세트마다 닿은 가장 높은 단계 하나만 듣는다', () => {
    const cherry = mustSet('cherry');
    expect(setBonusesOf(['more-cherry'])).toEqual([]);
    expect(setBonusesOf(['more-cherry', 'gold-cherry'])).toEqual([{ set: cherry, tier: cherry.tiers[0] }]);
    expect(setBonusesOf(['more-cherry', 'gold-cherry++', 'twins'])).toEqual([{ set: cherry, tier: cherry.tiers[1] }]);
    expect(setEffectsOf(['more-cherry', 'gold-cherry', 'twins'])).toEqual([cherry.tiers[1].effect]);
    // 두 세트를 함께 모으면 둘 다 듣는다.
    const both = setBonusesOf(['more-clover', 'gold-clover', 'more-bell', 'gold-bell']);
    expect(both.map((bonus) => bonus.set.id)).toEqual(['clover', 'bell']);
  });

  it('새로 든 덤: 새 세트이거나 윗단계로 오른 것만', () => {
    expect(newSetBonuses([], ['more-cherry'])).toEqual([]);
    expect(newSetBonuses(['more-cherry'], ['more-cherry', 'gold-cherry']).map((bonus) => bonus.tier.count)).toEqual([2]);
    expect(newSetBonuses(['more-cherry', 'gold-cherry'], ['more-cherry', 'gold-cherry', 'twins']).map((b) => b.tier.count)).toEqual([3]);
    // 강화해도 모은 수는 그대로라 새로 드는 덤은 없다.
    expect(newSetBonuses(['more-cherry', 'gold-cherry'], ['more-cherry+', 'gold-cherry'])).toEqual([]);
    // 떼서 줄어든 것은 새로 든 것이 아니다.
    expect(newSetBonuses(['more-cherry', 'gold-cherry', 'twins'], ['more-cherry', 'gold-cherry'])).toEqual([]);
  });

  it('설명 창의 한 줄: 듣는 덤이 있으면 그것을, 없으면 다음 단계를 적는다', () => {
    expect(setNoteOf(['wide'], 'wide')).toBeNull();
    expect(setNoteOf(['more-cherry'], 'more-cherry')).toMatchObject({ progress: '체리 세트 1/3', bonus: '2장이면 체리 상금 +1', active: false });
    expect(setNoteOf(['more-cherry', 'gold-cherry+'], 'gold-cherry+')).toMatchObject({ progress: '체리 세트 2/3', bonus: '체리 상금 +1', active: true });
  });

  it('가게의 세트 줄: 많이 모은 세트부터, 같으면 가게에 나온 부적이 드는 세트부터', () => {
    const order = (charms: string[], offers: (string | null)[]): string[] => shopSetsOf(charms, offers).map((item) => item.set.id);
    expect(order(['wide'], ['twins', null, 'crown'])).toEqual([]);
    expect(order(['more-seven', 'more-cherry', 'gold-diamond', 'more-diamond'], [null, null, null])).toEqual(['diamond', 'cherry', 'seven']);
    expect(order(['more-seven', 'more-cherry', 'gold-diamond', 'more-diamond'], ['slant', null, null])).toEqual(['diamond', 'seven', 'cherry']);
  });
});

describe('세트의 덤이 하는 일', () => {
  const plainValues = SYMBOLS.map((symbol) => symbol.value);

  it('그림 세트: 두 장이면 그 그림의 상금이 오르고, 세 장이면 더 오르며 강화해도 덤은 같다', () => {
    for (const set of CHARM_SETS) {
      if (set.id === 'seven') continue;
      const symbol = SYMBOLS.findIndex((item) => item.key === set.id);
      expect(symbol, set.id).toBeGreaterThanOrEqual(0);
      const [two, three] = set.tiers.map((tier) => tier.effect.value?.[1] ?? 0);
      expect(two, set.id).toBeGreaterThan(0);
      expect(three, set.id).toBeGreaterThan(two);
      // 세트에 드는 부적 하나하나의 효과에 덤을 더한 값이다.
      const own = (charms: string[]): number => charms.reduce((sum, id) => sum + (charmOf(id)?.effect.value?.[0] === symbol ? charmOf(id)?.effect.value?.[1] ?? 0 : 0), 0);
      const pair = set.members.slice(0, 2);
      expect(valuesOf(pair)[symbol], set.id).toBe(plainValues[symbol] + own(pair) + two);
      const all = [...set.members];
      expect(valuesOf(all)[symbol], set.id).toBe(plainValues[symbol] + own(all) + three);
      const upgraded = all.map((id) => leveled(id, 2));
      expect(valuesOf(upgraded)[symbol] - plainValues[symbol] - own(upgraded), set.id).toBe(three);
      // 다른 그림의 상금은 그대로다.
      for (let other = 0; other < SYMBOLS.length; other += 1) {
        if (other !== symbol) expect(valuesOf(all)[other], `${set.id} ${other}`).toBe(plainValues[other]);
      }
    }
  });

  it('세트의 덤은 실제로 받는 금화에 든다', () => {
    const cherryLine = [0, 0, 0, 1, 2, 3, 2, 3, 1];
    const context = { last: false, afterMiss: false };
    const pair = ['more-cherry', 'gold-cherry'];
    const bonus = mustSet('cherry').tiers[0].effect.value?.[1] ?? 0;
    expect(scoreSpin(cherryLine, pair, context).total).toBe(scoreSpin(cherryLine, ['gold-cherry'], context).total + bonus);
  });

  it('7 세트: 두 장이면 7이 더 나오고, 세 장이면 7이 더 나오고 라운드마다 한 번 더 돌린다', () => {
    const seven = mustSet('seven');
    const pair = seven.members.slice(0, 2);
    const ownWeight = (charms: readonly string[]): number =>
      charms.reduce((sum, id) => sum + (charmOf(id)?.effect.weight?.[0] === WILD ? charmOf(id)?.effect.weight?.[1] ?? 0 : 0), 0);
    expect(weightsOf(pair)[WILD]).toBe(SYMBOLS[WILD].weight + ownWeight(pair) + (seven.tiers[0].effect.weight?.[1] ?? 0));
    expect(spinsOf(pair)).toBe(BASE_SPINS);
    const all = [...seven.members];
    expect(weightsOf(all)[WILD]).toBe(SYMBOLS[WILD].weight + ownWeight(all) + (seven.tiers[1].effect.weight?.[1] ?? 0));
    expect(spinsOf(all)).toBe(BASE_SPINS + 1);
    // 줄의 곱은 부적(대각선 세 배)의 것 그대로다.
    expect(lineTimesOf(all)).toEqual(lineTimesOf(['slant']));
  });
});
