import { describe, expect, it } from 'vitest';
import {
  bumpGoals,
  claimGoal,
  createGoals,
  GOAL_BUDGET_SECONDS,
  GOAL_COUNT,
  GOAL_KINDS,
  GOAL_REWARD,
  GOALS,
  goalsFor,
  goalText,
  hasGoalToClaim,
  isGoalDone,
  normalizeGoals,
  RELEASE_COINS_PER_DAY,
  rollGoals,
  takeReleaseCoin,
  type GoalDef,
} from './goals';
import { EQUIPMENT, EQUIPMENT_ORDER, OFFICES, RUSH, TRAINING } from './data';
import {
  acceptRush,
  advance,
  assign,
  buyEquipment,
  cheer,
  createCompany,
  moveOffice,
  normalizeCompany,
  equipmentCost,
  goalLimits,
  incomePerSecond,
  release,
  startProject,
  train,
  type CompanyState,
} from './rules';

const DAY = '2026-11-12';

/** 2026년 한 해의 날짜 */
function days(): string[] {
  const list: string[] = [];
  for (let month = 1; month <= 12; month += 1) {
    for (let day = 1; day <= 28; day += 1) list.push(`2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }
  return list;
}

describe('오늘의 목표 정하기', () => {
  it('날마다 서로 다른 목표 셋이 나오고, 같은 날이면 언제나 같다', () => {
    for (const day of days()) {
      const goals = goalsFor(day, OFFICES.length - 1);
      expect(goals).toHaveLength(GOAL_COUNT);
      expect(new Set(goals.map((goal) => goal.kind)).size).toBe(GOAL_COUNT);
      for (const goal of goals) expect((GOALS[goal.kind] as GoalDef).targets).toContain(goal.target);
      expect(goalsFor(day, OFFICES.length - 1)).toEqual(goals);
    }
  });

  it('한 해 동안 모든 목표가 한 번은 나오고, 날마다 같은 조합은 아니다', () => {
    const seen = new Set<string>();
    const combos = new Set<string>();
    for (const day of days()) {
      const goals = goalsFor(day, OFFICES.length - 1);
      for (const goal of goals) seen.add(goal.kind);
      combos.add(goals.map((goal) => goal.kind).sort().join(','));
    }
    expect([...seen].sort()).toEqual([...GOAL_KINDS].sort());
    expect(combos.size).toBeGreaterThan(5);
  });

  it('옥탑방에서는 아직 할 수 없는 일이 목표로 나오지 않는다', () => {
    expect(GOALS.train.unlockOffice).toBe(TRAINING.unlockOffice);
    expect(GOALS.rush.unlockOffice).toBe(RUSH.unlockOffice);
    for (const day of days()) {
      const kinds = goalsFor(day, 0).map((goal) => goal.kind);
      expect(kinds).toHaveLength(GOAL_COUNT);
      expect(kinds).not.toContain('train');
      expect(kinds).not.toContain('rush');
    }
  });

  it('가장 작은 목표도 못 채우는 일은 나오지 않고, 그래도 셋이 나온다', () => {
    const small = (kind: 'train' | 'upgrade'): number => Math.min(...GOALS[kind].targets);
    for (const day of days()) {
      const kinds = goalsFor(day, OFFICES.length - 1, { train: small('train') - 1, upgrade: 0 }).map((goal) => goal.kind);
      expect(kinds).toHaveLength(GOAL_COUNT);
      expect(kinds).not.toContain('train');
      expect(kinds).not.toContain('upgrade');
    }
    const rolled = rollGoals(createGoals(DAY, 1), '2026-11-13', OFFICES.length - 1, { train: 0 });
    expect(rolled.list.map((goal) => goal.kind)).not.toContain('train');
  });

  it('한도가 뽑힌 목표보다 작으면 한도 안의 가장 큰 목표로 낮춘다', () => {
    const targets = GOALS.upgrade.targets;
    let lowered = 0;
    for (const day of days()) {
      const free = goalsFor(day, OFFICES.length - 1);
      const tight = goalsFor(day, OFFICES.length - 1, { upgrade: targets[1] });
      // 다른 목표와 어떤 일이 나오는지는 그대로이고, 장비 목표만 한도를 넘지 않는다.
      expect(tight.map((goal) => goal.kind)).toEqual(free.map((goal) => goal.kind));
      tight.forEach((goal, index) => {
        if (goal.kind !== 'upgrade') expect(goal).toEqual(free[index]);
        else {
          expect(goal.target).toBe(Math.min(free[index].target, targets[1]));
          if (goal.target !== free[index].target) lowered += 1;
        }
      });
    }
    expect(lowered).toBeGreaterThan(0);
  });

  it('목표를 한 줄로 적는다', () => {
    expect(goalText({ kind: 'release', target: 3 })).toBe('게임 3번 출시하기');
    for (const kind of GOAL_KINDS) expect(goalText({ kind, target: 2 })).toContain('2');
  });
});

describe('오늘의 목표 채우기', () => {
  it('한 일만큼 차고, 목표를 넘겨서는 세지 않는다', () => {
    const goals = createGoals(DAY, 0);
    const [first] = goals.list;
    bumpGoals(goals, first.kind, first.target - 1);
    expect(isGoalDone(goals, 0)).toBe(false);
    expect(hasGoalToClaim(goals)).toBe(false);
    bumpGoals(goals, first.kind, 100);
    expect(goals.progress[0]).toBe(first.target);
    expect(isGoalDone(goals, 0)).toBe(true);
    expect(hasGoalToClaim(goals)).toBe(true);
    expect(goals.progress.slice(1)).toEqual([0, 0]);
  });

  it('채운 목표의 코인을 한 번만 받는다', () => {
    const goals = createGoals(DAY, 0);
    expect(claimGoal(goals, 0)).toBe(0);
    bumpGoals(goals, goals.list[0].kind, 100);
    expect(claimGoal(goals, 0)).toBe(GOAL_REWARD);
    expect(claimGoal(goals, 0)).toBe(0);
    expect(claimGoal(goals, 9)).toBe(0);
    expect(hasGoalToClaim(goals)).toBe(false);
  });

  it('날이 바뀌면 새 목표가 되고, 같은 날에는 이사를 해도 그대로다', () => {
    const goals = createGoals(DAY, 0);
    bumpGoals(goals, goals.list[0].kind, 1);
    expect(rollGoals(goals, DAY, 3)).toBe(goals);
    const next = rollGoals(goals, '2026-11-13', 3);
    expect(next.day).toBe('2026-11-13');
    expect(next.progress).toEqual([0, 0, 0]);
    expect(next.claimed).toEqual([false, false, false]);
    expect(next.releaseCoins).toBe(0);
  });

  it('출시로 받는 코인은 하루 상한까지만 나온다', () => {
    const goals = createGoals(DAY, 0);
    let coins = 0;
    for (let index = 0; index < RELEASE_COINS_PER_DAY + 10; index += 1) coins += takeReleaseCoin(goals);
    expect(coins).toBe(RELEASE_COINS_PER_DAY);
    expect(takeReleaseCoin(rollGoals(goals, '2026-11-13', 0))).toBe(1);
  });
});

describe('오늘 채울 수 있는 만큼', () => {
  const most = (kind: 'train' | 'upgrade'): number => Math.max(...GOALS[kind].targets);
  const full = { train: most('train'), upgrade: most('upgrade') };
  /** 게임 하나를 내서 잎사귀를 버는 새 회사 */
  const earning = (): CompanyState => {
    const state = createCompany('sprout');
    state.released['lightning-tap'] = 1;
    return state;
  };

  it('새 회사는 아직 버는 것이 없어서 값을 따지지 않는다', () => {
    const state = createCompany('sprout');
    expect(incomePerSecond(state)).toBe(0);
    expect(goalLimits(state)).toEqual(full);
  });

  it('교육은 남은 단계만큼만 센다', () => {
    const state = createCompany('sprout');
    for (const desk of state.desks) desk.level = TRAINING.maxLevel;
    expect(goalLimits(state).train).toBe(0);
    state.desks[0].level = TRAINING.maxLevel - (most('train') - 1);
    expect(goalLimits(state).train).toBe(most('train') - 1);
    state.desks[0].level = TRAINING.maxLevel - most('train');
    expect(goalLimits(state).train).toBe(most('train'));
  });

  it('장비는 남은 단계만큼만 센다', () => {
    const state = createCompany('sprout');
    const fill = (): void => {
      for (const id of EQUIPMENT_ORDER) {
        if (EQUIPMENT[id].scope === 'company') state.gear[id] = EQUIPMENT[id].maxLevel;
        else for (const desk of state.desks) desk.gear[id] = EQUIPMENT[id].maxLevel;
      }
    };
    fill();
    expect(goalLimits(state).upgrade).toBe(0);
    state.desks[0].gear.computer = EQUIPMENT.computer.maxLevel - 2;
    expect(goalLimits(state).upgrade).toBe(2);
    // 아직 열리지 않은 장비는 세지 않는다. 옥탑방에서는 컴퓨터와 화분뿐이다.
    fill();
    state.gear.coffee = 0;
    expect(EQUIPMENT.coffee.unlockOffice).toBeGreaterThan(state.office);
    expect(goalLimits(state).upgrade).toBe(0);
  });

  it('버는 회사는 가진 잎사귀와 반 시간 동안 버는 잎사귀로 살 수 있는 만큼만 센다', () => {
    const state = earning();
    // 남은 장비는 컴퓨터 하나뿐이고, 그 값을 한 단계씩 맞춰 본다.
    for (const id of EQUIPMENT_ORDER) if (EQUIPMENT[id].scope === 'company') state.gear[id] = EQUIPMENT[id].maxLevel;
    for (const desk of state.desks) desk.gear.computer = EQUIPMENT.computer.maxLevel;
    const level = EQUIPMENT.computer.maxLevel - 3;
    state.desks[0].gear.computer = level;
    // 회사 장비가 수익도 올리므로 장비를 다 놓은 뒤에 잰다.
    const income = incomePerSecond(state);
    expect(income).toBeGreaterThan(0);
    const costs = [0, 1, 2].map((step) => equipmentCost('computer', level + step));
    const budget = (leaves: number): void => {
      state.leaves = leaves - income * GOAL_BUDGET_SECONDS;
    };
    budget(costs[0] - 1);
    expect(goalLimits(state).upgrade).toBe(0);
    budget(costs[0] + costs[1]);
    expect(goalLimits(state).upgrade).toBe(2);
    budget(costs[0] + costs[1] + costs[2]);
    expect(goalLimits(state).upgrade).toBe(3);
  });

  it('값이 너무 오른 장비만 남은 큰 회사에는 장비 목표가 나오지 않는다', () => {
    const state = earning();
    for (const id of EQUIPMENT_ORDER) if (EQUIPMENT[id].scope === 'company') state.gear[id] = EQUIPMENT[id].maxLevel;
    for (const desk of state.desks) desk.gear.computer = EQUIPMENT.computer.maxLevel - 1;
    state.leaves = 0;
    expect(goalLimits(state).upgrade).toBe(0);
    for (const day of days()) {
      expect(goalsFor(day, state.office, goalLimits(state)).map((goal) => goal.kind)).not.toContain('upgrade');
    }
  });
});

describe('회사에서 한 일이 목표에 세어진다', () => {
  /** 작은 사무실로 옮기고, 여섯 가지 목표를 모두 건 회사 */
  const company = (): CompanyState => {
    const state = createCompany('sprout');
    state.reputation = OFFICES[1].reputation;
    state.leaves = OFFICES[1].cost;
    moveOffice(state);
    state.leaves = 1_000_000;
    state.goals = {
      day: DAY,
      list: GOAL_KINDS.map((kind) => ({ kind, target: 99 })),
      progress: GOAL_KINDS.map(() => 0),
      claimed: GOAL_KINDS.map(() => false),
      releaseCoins: 0,
    };
    return state;
  };
  const progress = (state: CompanyState, kind: (typeof GOAL_KINDS)[number]): number =>
    state.goals.progress[GOAL_KINDS.indexOf(kind)];

  it('응원, 장비, 교육', () => {
    const state = company();
    startProject(state, 'lightning-tap');
    assign(state, 0, 0);
    cheer(state, 0);
    cheer(state, 1);
    expect(progress(state, 'cheer')).toBe(1);
    buyEquipment(state, 'computer', 0);
    buyEquipment(state, 'coffee');
    expect(progress(state, 'upgrade')).toBe(2);
    train(state, 0);
    expect(progress(state, 'train')).toBe(1);
  });

  it('끝낸 업무와 출시', () => {
    const state = company();
    startProject(state, 'lightning-tap');
    const cards = state.project!.total;
    for (let time = 0; time < 2000 && state.project!.done < cards; time += 1) {
      for (let index = 0; index < state.desks.length; index += 1) if (state.inbox.length > 0) assign(state, 0, index);
      advance(state, 1, () => 0.5);
    }
    expect(progress(state, 'task')).toBe(cards);
    expect(release(state)).not.toBeNull();
    expect(progress(state, 'release')).toBe(1);
  });

  it('성공한 급한 의뢰', () => {
    const state = company();
    const random = (): number => 0.5;
    advance(state, state.rushIn + 0.01, random);
    expect(acceptRush(state)).toBe(true);
    for (let time = 0; time < RUSH.seconds && state.rush; time += 0.5) {
      for (let index = 0; index < state.desks.length; index += 1) if (state.inbox.length > 0) assign(state, 0, index);
      advance(state, 0.5, random);
    }
    expect(state.rush).toBeNull();
    expect(progress(state, 'rush')).toBe(1);
  });
});

describe('목표의 세이브 읽기', () => {
  it('저장한 것을 그대로 다시 읽는다', () => {
    const goals = createGoals(DAY, 2);
    bumpGoals(goals, goals.list[0].kind, 100);
    claimGoal(goals, 0);
    takeReleaseCoin(goals);
    expect(normalizeGoals(JSON.parse(JSON.stringify(goals)))).toEqual(goals);
  });

  it('없거나 이상한 값은 빈 목표가 되어 다음에 새로 정해진다', () => {
    for (const raw of [undefined, null, 3, {}, { day: 'today', list: [] }, { day: DAY, list: 'x' }, { day: DAY, list: [] }]) {
      expect(normalizeGoals(raw)).toEqual(createGoals());
    }
    expect(rollGoals(normalizeGoals(null), DAY, 0).list).toHaveLength(GOAL_COUNT);
  });

  it('모르는 목표와 넘치는 값은 버리거나 자른다', () => {
    const read = normalizeGoals({
      day: DAY,
      list: [{ kind: 'release', target: 3 }, { kind: 'dance', target: 3 }, { kind: 'cheer', target: 7 }, { kind: 'task', target: 10 }],
      progress: [99, 1, 1, -5],
      claimed: [true, true, true, true],
      releaseCoins: 9999,
    });
    expect(read.list).toEqual([{ kind: 'release', target: 3 }]);
    expect(read.progress).toEqual([3]);
    expect(read.claimed).toEqual([true]);
    expect(read.releaseCoins).toBe(RELEASE_COINS_PER_DAY);
  });

  it('회사의 세이브에 함께 실린다', () => {
    const state = createCompany('sprout');
    state.goals = createGoals(DAY, 0);
    bumpGoals(state.goals, state.goals.list[0].kind, 1);
    const read = normalizeCompany(JSON.parse(JSON.stringify(state)))!;
    expect(read.goals).toEqual(state.goals);
    // 목표가 생기기 전의 세이브는 빈 목표로 읽는다.
    const old = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    delete old.goals;
    expect(normalizeCompany(old)!.goals).toEqual(createGoals());
  });
});
