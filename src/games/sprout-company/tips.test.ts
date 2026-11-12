import { describe, expect, it } from 'vitest';
import { OFFICES, OLD_HAND_TIPS, TIP_IDS, TIPS } from './data';
import { createGoals } from './goals';
import { advance, createCompany, moveOffice, normalizeCompany, type CompanyState } from './rules';
import { markTip, nextTip } from './tips';

/** 뜨는 안내를 본 것으로 적어 가며 차례로 모은다. */
function drain(state: CompanyState): string[] {
  const shown: string[] = [];
  for (let id = nextTip(state); id !== null; id = nextTip(state)) {
    markTip(state, id);
    shown.push(id);
  }
  return shown;
}

describe('처음 안내', () => {
  it('글은 한 줄에 들어가는 길이다', () => {
    for (const id of TIP_IDS) {
      expect(TIPS[id].length, id).toBeGreaterThan(5);
      expect(TIPS[id].length, id).toBeLessThanOrEqual(24);
    }
  });

  it('갓 세운 회사에는 아무 안내도 뜨지 않는다', () => {
    expect(nextTip(createCompany('sprout'))).toBeNull();
  });

  it('첫 출시 뒤에 수익을 알려 주고, 한 번 본 안내는 다시 뜨지 않는다', () => {
    const state = createCompany('sprout');
    state.releases = 1;
    expect(nextTip(state)).toBe('income');
    markTip(state, 'income');
    markTip(state, 'income');
    expect(state.tips).toEqual(['income']);
    expect(nextTip(state)).toBeNull();
  });

  it('그 일이 처음 생길 때 그 안내가 뜬다', () => {
    const state = createCompany('sprout');
    state.releases = 1;
    state.leaves = 1_000;
    expect(drain(state)).toEqual(['income', 'gear']);

    state.reputation = OFFICES[1].reputation;
    state.leaves = 0;
    expect(drain(state)).toEqual(['move']);

    state.leaves = OFFICES[1].cost;
    moveOffice(state);
    state.leaves = 0;
    expect(drain(state)).toEqual(['hire']);

    state.releases = 3;
    state.goals = createGoals('2026-11-12', 1);
    expect(drain(state)).toEqual(['update', 'goals']);

    state.leaves = 1_000_000;
    expect(drain(state)).toEqual(['train', 'lead']);

    advance(state, state.rushIn + 0.01, () => 0.5);
    expect(drain(state)).toEqual(['rush']);

    state.backlog = [{ kind: 'plan', left: 1, total: 1 }];
    expect(drain(state)).toEqual(['backlog']);
    expect([...state.tips].sort()).toEqual([...TIP_IDS].sort());
  });

  it('본 안내는 세이브에 남고, 모르는 id는 버린다', () => {
    const state = createCompany('sprout');
    state.tips = ['income', 'rush'];
    expect(normalizeCompany(JSON.parse(JSON.stringify(state)))!.tips).toEqual(['income', 'rush']);
    const raw = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    raw.tips = ['income', 'income', 'dance', 7];
    expect(normalizeCompany(raw)!.tips).toEqual(['income']);
  });

  it('안내가 생기기 전부터 하던 회사에는 그때도 있던 일을 다시 알려 주지 않는다', () => {
    const state = createCompany('sprout');
    state.releases = 5;
    const raw = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    delete raw.tips;
    expect(normalizeCompany(raw)!.tips).toEqual([...OLD_HAND_TIPS]);
    // 아직 아무것도 내지 않은 회사는 처음부터 안내를 본다.
    raw.releases = 0;
    expect(normalizeCompany(raw)!.tips).toEqual([]);
  });
});
