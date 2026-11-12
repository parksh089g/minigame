import { describe, expect, it } from 'vitest';
import { AWAY, DEPARTMENT, DEPARTMENT_ORDER, DEPARTMENTS, EFFECT_KEYS, OFFICES, type DepartmentDef, type DepartmentId } from './data';
import {
  awayRate,
  companyBonus,
  createCompany,
  departmentCost,
  departmentCount,
  departmentLevel,
  departmentMembers,
  departmentSeats,
  departmentsMissing,
  hire,
  hireCost,
  hirePool,
  incomePerSecond,
  isSupport,
  joinDepartment,
  leaveDepartment,
  moveOffice,
  normalizeCompany,
  projectReputation,
  skill,
  specialtyOf,
  staffCount,
  supportBonus,
  supportShare,
  upgradeDepartment,
  type CompanyState,
} from './rules';

const LAST = OFFICES.length - 1;
const def = (id: DepartmentId): DepartmentDef => DEPARTMENTS[id];
const SUPPORT = DEPARTMENT_ORDER.filter((id) => isSupport(id));

/** 사옥까지 옮기고 빈 자리를 모두 채운 회사 */
function grown(): CompanyState {
  const state = createCompany('sprout');
  while (state.office < LAST) {
    state.reputation = OFFICES[state.office + 1].reputation;
    state.leaves = OFFICES[state.office + 1].cost;
    moveOffice(state);
  }
  for (const id of hirePool(state)) {
    if (staffCount(state) >= state.desks.length) break;
    state.candidates = [id];
    state.leaves = hireCost(state);
    hire(state, id);
  }
  state.leaves = 0;
  state.releases = 1;
  state.released = { 'lightning-tap': 1 };
  return state;
}

/** 부서를 level단계까지 올린다. */
function raise(state: CompanyState, id: DepartmentId, level: number): void {
  while (departmentLevel(state, id) < level) {
    state.leaves = departmentCost(departmentLevel(state, id));
    expect(upgradeDepartment(state, id)).toBe(true);
  }
}

describe('돕는 부서', () => {
  it('돕는 부서는 맡는 업무가 없고, 회사 전체에 걸리는 효과를 하나씩 가진다', () => {
    expect(SUPPORT).toEqual(['music', 'pr', 'service']);
    const keys = new Set<string>();
    for (const id of DEPARTMENT_ORDER) {
      // 부서는 일하는 부서이거나 돕는 부서, 둘 중 하나다.
      expect(def(id).kind === null, id).toBe(isSupport(id));
      const effect = def(id).effect;
      if (!effect) continue;
      expect(EFFECT_KEYS).toContain(effect.key);
      expect(effect.key).not.toBe('workSpeed');
      expect(effect.amount).toBeGreaterThan(0);
      expect(keys.has(effect.key)).toBe(false);
      keys.add(effect.key);
    }
    // 닫아 둔 동안의 수익은 장비와 부서를 다 올려도 열어 둔 때를 넘지 않는다.
    const most = def('service').effect!.amount * DEPARTMENT.maxLevel * departmentSeats(DEPARTMENT.maxLevel);
    expect(AWAY.rate * (1 + 0.2 * 10 + most)).toBeLessThan(1);
  });

  it('세우면 아직 부서가 없는 친구가 들고, 특기가 없는 사장이 먼저 든다', () => {
    const state = grown();
    raise(state, 'music', 1);
    const members = departmentMembers(state, 'music');
    expect(members).toHaveLength(departmentSeats(1));
    expect(members).toContain(0);
    expect(specialtyOf(state, state.desks[0].staff!)).toBeNull();
    // 이미 다른 부서에 든 친구는 데려오지 않는다.
    raise(state, 'plan', 1);
    const planners = departmentMembers(state, 'plan');
    raise(state, 'pr', 1);
    expect(departmentMembers(state, 'plan')).toEqual(planners);
    expect(departmentMembers(state, 'music')).toEqual(members);
    for (const index of departmentMembers(state, 'pr')) expect(members.includes(index) || planners.includes(index)).toBe(false);
  });

  it('부서원 한 명이 단계마다 정해진 몫을 회사에 보탠다', () => {
    const state = grown();
    for (const desk of state.desks) desk.dept = null;
    const before = companyBonus(state, 'income');
    raise(state, 'music', 2);
    const amount = def('music').effect!.amount;
    expect(supportShare('music', 2)).toBeCloseTo(amount * 2, 9);
    const count = departmentMembers(state, 'music').length;
    expect(count).toBe(departmentSeats(2));
    expect(supportBonus(state, 'music')).toBeCloseTo(amount * 2 * count, 9);
    expect(companyBonus(state, 'income')).toBeCloseTo(before + amount * 2 * count, 9);
    // 한 명을 빼면 그만큼 준다.
    leaveDepartment(state, departmentMembers(state, 'music')[0]);
    expect(companyBonus(state, 'income')).toBeCloseTo(before + amount * 2 * (count - 1), 9);
    // 일하는 부서에는 이런 몫이 없다.
    expect(supportShare('plan', 3)).toBe(0);
    raise(state, 'plan', 1);
    expect(supportBonus(state, 'plan')).toBe(0);
  });

  it('음악부는 수익을, 홍보부는 출시 평판을, 고객 응대부는 닫아 둔 동안의 수익을 올린다', () => {
    const plain = grown();
    for (const desk of plain.desks) desk.dept = null;
    const state = grown();
    for (const desk of state.desks) desk.dept = null;
    for (const id of SUPPORT) raise(state, id, 1);
    state.leaves = 0;
    const seats = departmentSeats(1);
    const ratio = (key: 'income' | 'reputation' | 'away', id: DepartmentId): number =>
      (1 + companyBonus(plain, key) + def(id).effect!.amount * seats) / (1 + companyBonus(plain, key));
    expect(incomePerSecond(state) / incomePerSecond(plain)).toBeCloseTo(ratio('income', 'music'), 6);
    expect(awayRate(state) / awayRate(plain)).toBeCloseTo(ratio('away', 'service'), 6);
    expect(projectReputation(state, 'merge-tiles')).toBeGreaterThan(projectReputation(plain, 'merge-tiles'));
  });

  it('돕는 부서의 부서원은 일하는 부서의 덤을 받지 못한다', () => {
    const state = grown();
    for (const desk of state.desks) desk.dept = null;
    raise(state, 'plan', 3);
    const index = departmentMembers(state, 'plan')[0];
    const inPlan = skill(state, index, 'plan');
    raise(state, 'music', 1);
    // 자리가 다 찼으면 한 명을 빼고 옮긴다.
    leaveDepartment(state, departmentMembers(state, 'music')[0]);
    expect(joinDepartment(state, index, 'music')).toBe(true);
    expect(state.desks[index].dept).toBe('music');
    expect(skill(state, index, 'plan')).toBeLessThan(inPlan);
    expect(departmentMembers(state, 'plan')).not.toContain(index);
  });

  it('돕는 부서도 세운 부서로 세고, 세이브에 남는다', () => {
    const state = grown();
    for (const desk of state.desks) desk.dept = null;
    expect(departmentsMissing(state, 'chosung-quiz')).toBeGreaterThan(0);
    const need = departmentsMissing(state, 'chosung-quiz');
    raise(state, 'pr', 2);
    expect(departmentCount(state)).toBe(1);
    expect(departmentsMissing(state, 'chosung-quiz')).toBe(need - 1);
    const copy = normalizeCompany(JSON.parse(JSON.stringify(state)))!;
    expect(copy.departments).toEqual({ pr: 2 });
    expect(departmentMembers(copy, 'pr')).toEqual(departmentMembers(state, 'pr'));
    expect(companyBonus(copy, 'reputation')).toBeCloseTo(companyBonus(state, 'reputation'), 9);
  });
});
