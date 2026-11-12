import { describe, expect, it } from 'vitest';
import { BRANCH, DECOR, DECOR_ORDER, DECOR_SLOT_NAMES, DECOR_SLOTS, OFFICES, type DecorDef, type DecorId } from './data';
import { buyDecor, createCompany, decorBlock, decorOf, foundBranch, incomePerSecond, normalizeCompany, useDecor } from './rules';

const def = (id: DecorId): DecorDef => DECOR[id];

describe('사옥 꾸미기', () => {
  it('곳마다 고를 것이 있고, 값은 모두 코인으로 치른다', () => {
    for (const slot of DECOR_SLOTS) {
      expect(DECOR_SLOT_NAMES[slot].length).toBeGreaterThan(0);
      expect(DECOR_ORDER.filter((id) => def(id).slot === slot).length).toBeGreaterThanOrEqual(3);
    }
    const names = new Set<string>();
    for (const id of DECOR_ORDER) {
      expect(id.startsWith(`${def(id).slot}-`)).toBe(true);
      expect(Number.isInteger(def(id).cost) && def(id).cost > 0).toBe(true);
      expect(names.has(def(id).name)).toBe(false);
      names.add(def(id).name);
    }
  });

  it('처음에는 아무것도 없고 기본 모습이다', () => {
    const state = createCompany('sprout');
    expect(state.decor).toEqual({ owned: [], wall: null, floor: null, sign: null });
    for (const slot of DECOR_SLOTS) expect(decorOf(state, slot)).toBeNull();
  });

  it('코인이 모자라면 못 사고, 사면 그 값을 돌려주며 바로 쓴다', () => {
    const state = createCompany('sprout');
    const cost = DECOR['wall-dot'].cost;
    expect(decorBlock(state, 'wall-dot', cost - 1)).toBe('poor');
    expect(buyDecor(state, 'wall-dot', cost - 1)).toBe(0);
    expect(state.decor.owned).toEqual([]);

    expect(decorBlock(state, 'wall-dot', cost)).toBeNull();
    expect(buyDecor(state, 'wall-dot', cost)).toBe(cost);
    expect(state.decor.owned).toEqual(['wall-dot']);
    expect(decorOf(state, 'wall')).toBe(DECOR['wall-dot']);
    // 한 번 산 것은 다시 사지 않는다.
    expect(decorBlock(state, 'wall-dot', 9999)).toBe('owned');
    expect(buyDecor(state, 'wall-dot', 9999)).toBe(0);
    expect(state.decor.owned).toEqual(['wall-dot']);
  });

  it('사 둔 것끼리 바꿔 쓰고, 기본 모습으로도 돌린다', () => {
    const state = createCompany('sprout');
    buyDecor(state, 'wall-dot', 9999);
    buyDecor(state, 'wall-cloud', 9999);
    expect(state.decor.wall).toBe('wall-cloud');
    expect(useDecor(state, 'wall', 'wall-dot')).toBe(true);
    expect(state.decor.wall).toBe('wall-dot');
    // 이미 쓰는 것, 사지 않은 것, 다른 곳의 것은 바뀌지 않는다.
    expect(useDecor(state, 'wall', 'wall-dot')).toBe(false);
    expect(useDecor(state, 'wall', 'wall-stripe')).toBe(false);
    buyDecor(state, 'floor-wood', 9999);
    expect(useDecor(state, 'wall', 'floor-wood')).toBe(false);
    expect(state.decor.wall).toBe('wall-dot');
    expect(useDecor(state, 'wall', null)).toBe(true);
    expect(decorOf(state, 'wall')).toBeNull();
    expect(state.decor.owned).toEqual(['wall-dot', 'wall-cloud', 'floor-wood']);
  });

  it('꾸미기는 회사의 수치를 바꾸지 않는다', () => {
    const plain = createCompany('sprout');
    const fancy = createCompany('sprout');
    for (const state of [plain, fancy]) state.releases = 1;
    for (const id of DECOR_ORDER) buyDecor(fancy, id, 9999);
    expect(incomePerSecond(fancy)).toBe(incomePerSecond(plain));
    expect(fancy.leaves).toBe(plain.leaves);
  });

  it('세이브에 남고, 모르는 것과 맞지 않는 것은 버린다', () => {
    const state = createCompany('sprout');
    buyDecor(state, 'sign-gold', 9999);
    buyDecor(state, 'floor-grass', 9999);
    expect(normalizeCompany(JSON.parse(JSON.stringify(state)))!.decor).toEqual(state.decor);

    const raw = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    raw.decor = { owned: ['sign-gold', 'sign-gold', 'wall-moon', 7], wall: 'wall-dot', floor: 'sign-gold', sign: 'sign-gold' };
    expect(normalizeCompany(raw)!.decor).toEqual({ owned: ['sign-gold'], wall: null, floor: null, sign: 'sign-gold' });
    // 꾸미기가 생기기 전의 세이브는 기본 모습이다.
    delete raw.decor;
    expect(normalizeCompany(raw)!.decor).toEqual({ owned: [], wall: null, floor: null, sign: null });
  });

  it('자회사를 세워도 사 둔 꾸미기는 남는다', () => {
    const state = createCompany('sprout');
    buyDecor(state, 'wall-stripe', 9999);
    buyDecor(state, 'sign-wood', 9999);
    state.office = OFFICES.length - 1;
    state.reputation = BRANCH.reputation;
    expect(foundBranch(state)).not.toBeNull();
    expect(state.office).toBe(0);
    expect(state.decor).toEqual({ owned: ['wall-stripe', 'sign-wood'], wall: 'wall-stripe', floor: null, sign: 'sign-wood' });
  });
});
