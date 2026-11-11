import { describe, expect, it } from 'vitest';
import {
  CATALOG,
  SLOTS,
  SLOT_INFO,
  createCosmetics,
  defaultItem,
  equip,
  getItem,
  isEquipped,
  isOwned,
  itemsIn,
  normalizeCosmetics,
  purchase,
} from './shop';

describe('꾸미기 목록', () => {
  it('id가 겹치지 않는다', () => {
    const ids = CATALOG.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('자리마다 무료 기본이 맨 앞에 하나 있고, 나머지는 가격이 오르는 순서다', () => {
    for (const slot of SLOTS) {
      const items = itemsIn(slot);
      expect(items.length).toBeGreaterThanOrEqual(2);
      expect(items[0].price).toBe(0);
      expect(defaultItem(slot)).toBe(items[0]);
      for (let i = 1; i < items.length; i += 1) {
        expect(items[i].price).toBeGreaterThan(items[i - 1].price);
      }
      expect(SLOT_INFO[slot].label.length).toBeGreaterThan(0);
    }
  });

  it('가격은 음이 아닌 정수다', () => {
    for (const item of CATALOG) {
      expect(Number.isInteger(item.price)).toBe(true);
      expect(item.price).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('처음 상태', () => {
  it('기본 꾸미기를 쓰고, 산 것은 없다', () => {
    const state = createCosmetics();
    expect(state.owned).toEqual([]);
    for (const slot of SLOTS) {
      expect(state.equipped[slot]).toBe(defaultItem(slot).id);
      expect(isOwned(state, defaultItem(slot).id)).toBe(true);
      expect(isEquipped(state, defaultItem(slot).id)).toBe(true);
    }
    expect(isOwned(state, 'runner-ghost')).toBe(false);
    expect(isOwned(state, 'no-such-item')).toBe(false);
  });
});

describe('purchase', () => {
  it('코인이 충분하면 사고, 바로 끼운다', () => {
    const state = createCosmetics();
    const result = purchase(50, state, 'runner-drop');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.coins).toBe(10);
    expect(result.cosmetics.owned).toEqual(['runner-drop']);
    expect(result.cosmetics.equipped.runner).toBe('runner-drop');
    expect(result.cosmetics.equipped.backdrop).toBe('backdrop-night');
    // 원본은 그대로다.
    expect(state.owned).toEqual([]);
    expect(state.equipped.runner).toBe('runner-sprout');
  });

  it('가격과 꼭 같은 코인으로도 살 수 있다', () => {
    const price = getItem('orb-moon')!.price;
    const result = purchase(price, createCosmetics(), 'orb-moon');
    expect(result.ok && result.coins).toBe(0);
  });

  it('코인이 모자라면 얼마나 모자란지 알려 주고 아무것도 바꾸지 않는다', () => {
    const result = purchase(30, createCosmetics(), 'backdrop-sunset');
    expect(result).toEqual({ ok: false, reason: 'coins', shortBy: 70 });
  });

  it('이미 가진 것과 무료인 것은 살 수 없다', () => {
    const bought = purchase(100, createCosmetics(), 'cardback-green');
    expect(bought.ok).toBe(true);
    if (!bought.ok) return;
    expect(purchase(100, bought.cosmetics, 'cardback-green')).toEqual({ ok: false, reason: 'owned' });
    expect(purchase(100, createCosmetics(), 'cardback-blue')).toEqual({ ok: false, reason: 'owned' });
  });

  it('없는 것은 살 수 없다', () => {
    expect(purchase(999, createCosmetics(), 'nope')).toEqual({ ok: false, reason: 'unknown' });
  });
});

describe('equip', () => {
  it('가진 것으로 바꿔 끼운다', () => {
    const bought = purchase(100, createCosmetics(), 'orb-green');
    if (!bought.ok) throw new Error('구매 실패');
    const back = equip(bought.cosmetics, 'orb-blue');
    expect(back.equipped.orb).toBe('orb-blue');
    expect(back.owned).toEqual(['orb-green']);
    expect(equip(back, 'orb-green').equipped.orb).toBe('orb-green');
  });

  it('가지지 않은 것, 없는 것, 이미 쓰는 것은 그대로 둔다', () => {
    const state = createCosmetics();
    expect(equip(state, 'orb-moon')).toBe(state);
    expect(equip(state, 'nope')).toBe(state);
    expect(equip(state, 'orb-blue')).toBe(state);
  });
});

describe('normalizeCosmetics', () => {
  it('없거나 이상한 값은 처음 상태가 된다', () => {
    expect(normalizeCosmetics(undefined)).toEqual(createCosmetics());
    expect(normalizeCosmetics('x')).toEqual(createCosmetics());
    expect(normalizeCosmetics({ owned: 'x', equipped: 3 })).toEqual(createCosmetics());
  });

  it('올바른 값은 그대로 둔다', () => {
    const state = {
      owned: ['runner-ghost', 'backdrop-forest'],
      equipped: {
        backdrop: 'backdrop-forest',
        runner: 'runner-ghost',
        cardBack: 'cardback-blue',
        orb: 'orb-blue',
      },
    };
    expect(normalizeCosmetics(structuredClone(state))).toEqual(state);
  });

  it('모르는 id, 겹친 id, 무료 id는 owned에서 뺀다', () => {
    const state = normalizeCosmetics({
      owned: ['runner-ghost', 'runner-ghost', 'gone-item', 'orb-blue', 7],
      equipped: {},
    });
    expect(state.owned).toEqual(['runner-ghost']);
  });

  it('가지지 않은 것이나 다른 자리의 것을 쓰고 있으면 기본으로 되돌린다', () => {
    const state = normalizeCosmetics({
      owned: ['orb-green'],
      equipped: { backdrop: 'backdrop-galaxy', runner: 'orb-green', cardBack: 5, orb: 'orb-green' },
    });
    expect(state.equipped).toEqual({
      backdrop: 'backdrop-night',
      runner: 'runner-sprout',
      cardBack: 'cardback-blue',
      orb: 'orb-green',
    });
  });
});
