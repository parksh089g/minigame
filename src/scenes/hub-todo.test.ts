import { describe, expect, it } from 'vitest';
import { createWeekly, type WeekContext, type WeeklyMission, type WeeklyState } from '../core/weekly';
import { LANTERN_GAME_ID } from '../games/lantern-keeper/data';
import { AWAY, COMPANY_GAME_ID } from '../games/sprout-company/data';
import { createGoals } from '../games/sprout-company/goals';
import { createCompany } from '../games/sprout-company/rules';
import { companyTodo, lanternTodo, weeklyTodo } from './hub-todo';

describe('등불지기의 오늘 할 일', () => {
  it('멈춰 둔 판이 있으면 지난 시간과 함께 이어 하라고 한다', () => {
    // 이어 할 판은 준비 화면의 첫 쪽에 있으므로, 누르면 여느 때처럼 연다.
    expect(lanternTodo({ t: 452.7 }, false, true)).toEqual({ text: '이어하기 7:32' });
    // 오늘의 판을 했어도, 처음 하는 사람이어도 멈춘 판이 먼저다.
    expect(lanternTodo({ t: 5 }, true, false)).toEqual({ text: '이어하기 0:05' });
  });

  it('해 본 사람에게만 오늘의 판을 아직 안 했다고 알리고, 누르면 오늘의 판 쪽을 연다', () => {
    expect(lanternTodo(null, false, true)).toEqual({ text: '오늘의 판 아직', start: { page: 'daily' } });
    expect(lanternTodo(null, true, true)).toBeNull();
    expect(lanternTodo(null, false, false)).toBeNull();
  });
});

describe('새싹 컴퍼니의 오늘 할 일', () => {
  const NOW = Date.UTC(2026, 10, 13, 3, 0, 0);
  const TODAY = '2026-11-13';
  const GOALS = { panel: 'goals' };

  /** 오늘의 목표가 이미 정해진 회사. 방금 저장했다. */
  const company = (): ReturnType<typeof createCompany> => {
    const state = createCompany('sprout', NOW - 60_000);
    state.goals = createGoals(TODAY, state.office);
    return state;
  };

  it('세운 회사가 없으면 할 일도 없다', () => {
    expect(companyTodo(null, NOW, TODAY)).toBeNull();
  });

  it('닫아 둔 동안의 수익이 다 찼으면 그것부터 알리고, 누르면 여느 때처럼 연다', () => {
    const state = company();
    state.savedAt = NOW - AWAY.maxSeconds * 1000;
    expect(companyTodo(state, NOW, TODAY)).toEqual({ text: '수익 가득' });
    state.savedAt += 1000;
    expect(companyTodo(state, NOW, TODAY)?.text).not.toBe('수익 가득');
  });

  it('날이 바뀌었으면 새 목표가 기다리고, 누르면 목표 창을 연다', () => {
    const state = company();
    expect(companyTodo(state, NOW, '2026-11-14')).toEqual({ text: '새 목표', start: GOALS });
  });

  it('오늘의 목표를 몇 개 채웠는지 보여 주고, 다 받았으면 할 일이 없다', () => {
    const state = company();
    const goals = state.goals;
    const count = goals.list.length;
    expect(count).toBeGreaterThan(0);
    expect(companyTodo(state, NOW, TODAY)).toEqual({ text: `목표 0/${count}`, start: GOALS });
    goals.progress[0] = goals.list[0].target;
    expect(companyTodo(state, NOW, TODAY)?.text).toBe(`목표 1/${count}`);
    goals.list.forEach((goal, index) => {
      goals.progress[index] = goal.target;
    });
    // 다 채웠어도 받지 않은 보상이 있으면 아직 할 일이다.
    expect(companyTodo(state, NOW, TODAY)?.text).toBe(`목표 ${count}/${count}`);
    goals.claimed = goals.list.map(() => true);
    expect(companyTodo(state, NOW, TODAY)).toBeNull();
  });
});

describe('큰 게임 주간 미션', () => {
  const WEEK = '2026-11-16';
  const big = (gameId: string, goal: number): WeeklyMission => ({
    id: 'normal',
    kind: 'big',
    title: '큰 게임',
    description: '이번 주의 큰 게임이에요',
    goal,
    reward: 55,
    counts: [gameId],
  });
  const week = (...missions: WeeklyMission[]): WeekContext => ({ weekKey: WEEK, missions });
  const weekly = (plays: Record<string, number>, weekKey: string = WEEK): WeeklyState => ({
    ...createWeekly(),
    weekKey,
    plays,
  });

  it('그 게임의 큰 게임 미션이 남았으면 얼마나 했는지 보인다', () => {
    expect(weeklyTodo(LANTERN_GAME_ID, week(big(LANTERN_GAME_ID, 3)), weekly({ [LANTERN_GAME_ID]: 1 }))).toEqual({
      text: '주간 1/3판',
    });
    // 회사는 출시 한 번이 한 판이다.
    expect(weeklyTodo(COMPANY_GAME_ID, week(big(COMPANY_GAME_ID, 7)), weekly({ [COMPANY_GAME_ID]: 2 }))).toEqual({
      text: '주간 출시 2/7',
    });
  });

  it('다 채웠거나, 다른 게임의 미션이거나, 큰 게임 미션이 없는 주면 없다', () => {
    expect(weeklyTodo(LANTERN_GAME_ID, week(big(LANTERN_GAME_ID, 3)), weekly({ [LANTERN_GAME_ID]: 3 }))).toBeNull();
    expect(weeklyTodo(LANTERN_GAME_ID, week(big(COMPANY_GAME_ID, 7)), weekly({}))).toBeNull();
    expect(weeklyTodo(LANTERN_GAME_ID, week(), weekly({}))).toBeNull();
    expect(weeklyTodo(LANTERN_GAME_ID, null, weekly({}))).toBeNull();
  });

  it('기록이 지난주의 것이면 이번 주는 처음부터 센다', () => {
    const lastWeek = weekly({ [LANTERN_GAME_ID]: 5 }, '2026-11-09');
    expect(weeklyTodo(LANTERN_GAME_ID, week(big(LANTERN_GAME_ID, 3)), lastWeek)).toEqual({ text: '주간 0/3판' });
  });
});
