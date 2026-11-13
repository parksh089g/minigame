import { describe, expect, it } from 'vitest';
import { AWAY } from '../games/sprout-company/data';
import { createGoals } from '../games/sprout-company/goals';
import { createCompany } from '../games/sprout-company/rules';
import { companyTodo, lanternTodo } from './hub-todo';

describe('등불지기의 오늘 할 일', () => {
  it('멈춰 둔 판이 있으면 지난 시간과 함께 이어 하라고 한다', () => {
    expect(lanternTodo({ t: 452.7 }, false, true)).toBe('이어하기 7:32');
    // 오늘의 판을 했어도, 처음 하는 사람이어도 멈춘 판이 먼저다.
    expect(lanternTodo({ t: 5 }, true, false)).toBe('이어하기 0:05');
  });

  it('해 본 사람에게만 오늘의 판을 아직 안 했다고 알린다', () => {
    expect(lanternTodo(null, false, true)).toBe('오늘의 판 아직');
    expect(lanternTodo(null, true, true)).toBeNull();
    expect(lanternTodo(null, false, false)).toBeNull();
  });
});

describe('새싹 컴퍼니의 오늘 할 일', () => {
  const NOW = Date.UTC(2026, 10, 13, 3, 0, 0);
  const TODAY = '2026-11-13';

  /** 오늘의 목표가 이미 정해진 회사. 방금 저장했다. */
  const company = (): ReturnType<typeof createCompany> => {
    const state = createCompany('sprout', NOW - 60_000);
    state.goals = createGoals(TODAY, state.office);
    return state;
  };

  it('세운 회사가 없으면 할 일도 없다', () => {
    expect(companyTodo(null, NOW, TODAY)).toBeNull();
  });

  it('닫아 둔 동안의 수익이 다 찼으면 그것부터 알린다', () => {
    const state = company();
    state.savedAt = NOW - AWAY.maxSeconds * 1000;
    expect(companyTodo(state, NOW, TODAY)).toBe('수익 가득');
    state.savedAt += 1000;
    expect(companyTodo(state, NOW, TODAY)).not.toBe('수익 가득');
  });

  it('날이 바뀌었으면 새 목표가 기다린다', () => {
    const state = company();
    expect(companyTodo(state, NOW, '2026-11-14')).toBe('새 목표');
  });

  it('오늘의 목표를 몇 개 채웠는지 보여 주고, 다 받았으면 할 일이 없다', () => {
    const state = company();
    const goals = state.goals;
    const count = goals.list.length;
    expect(count).toBeGreaterThan(0);
    expect(companyTodo(state, NOW, TODAY)).toBe(`목표 0/${count}`);
    goals.progress[0] = goals.list[0].target;
    expect(companyTodo(state, NOW, TODAY)).toBe(`목표 1/${count}`);
    goals.list.forEach((goal, index) => {
      goals.progress[index] = goal.target;
    });
    // 다 채웠어도 받지 않은 보상이 있으면 아직 할 일이다.
    expect(companyTodo(state, NOW, TODAY)).toBe(`목표 ${count}/${count}`);
    goals.claimed = goals.list.map(() => true);
    expect(companyTodo(state, NOW, TODAY)).toBeNull();
  });
});
