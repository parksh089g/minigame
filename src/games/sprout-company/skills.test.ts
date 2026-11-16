import { describe, expect, it } from 'vitest';
import {
  CHEER_BOOST,
  LEVEL_SPEED,
  MAX_FLOWERS,
  OFFICES,
  RATING,
  SKILL,
  SKILL_IDS,
  SKILL_LEVEL,
  SKILLS,
  SPECIAL,
  SPECIALTY_BOOST,
  STAFF,
  STAFF_ORDER,
  TRAINING,
  type StaffId,
} from './data';
import {
  advance,
  assign,
  bugReward,
  cardBoost,
  careFor,
  catchUp,
  cheer,
  cheerBoostAt,
  cheerReach,
  cheerSeconds,
  cheerSecondsAt,
  companyHas,
  createCompany,
  deskSpeed,
  fits,
  hasSkill,
  hitChance,
  incomePerSecond,
  isStuck,
  moveOffice,
  normalizeCompany,
  release,
  skill,
  skillAt,
  skillOpen,
  train,
  trainCost,
  tradeReward,
  type CompanyEvent,
  type CompanyState,
  type Task,
} from './rules';

/**
 * 작은 사무실(책상 넷, 두 줄에 둘씩: 0과 1이 옆자리, 2와 3이 옆자리)에 적힌 친구들을 앉힌다.
 * 모두 기술이 열리는 레벨까지 교육받은 것으로 한다. 휴게실이 없는 사무실이라 기운은 속도에 끼지 않는다.
 */
function office(staff: readonly (StaffId | null)[], level: number = SKILL_LEVEL): CompanyState {
  const state = createCompany('sprout');
  state.reputation = OFFICES[1].reputation;
  state.leaves = OFFICES[1].cost;
  moveOffice(state);
  state.desks.forEach((desk, index) => {
    desk.staff = staff[index] ?? null;
    desk.level = desk.staff ? level : 0;
  });
  state.leaves = 0;
  state.reputation = 0;
  // 급한 의뢰가 끼어들지 않게 멀리 미뤄 둔다.
  state.rushIn = 1e9;
  return state;
}

const card = (kind: Task['kind'] = 'plan', work = 100): Task => ({ kind, left: work, total: work });

/** 책상에 카드를 바로 올려놓는다. */
function give(state: CompanyState, index: number, task: Task): Task {
  state.desks[index].task = task;
  return task;
}

/** dt초를 흘리는 동안 이 책상의 카드가 줄어든 양 */
function worked(state: CompanyState, index: number, dt = 1): number {
  const task = state.desks[index].task as Task;
  const before = task.left;
  advance(state, dt, () => 0.999);
  return before - task.left;
}

/** 조금씩 시간을 흘리며 일어난 일을 모은다. */
function run(state: CompanyState, seconds: number, step = 0.25): CompanyEvent[] {
  const events: CompanyEvent[] = [];
  for (let time = 0; time < seconds; time += step) events.push(...advance(state, step, () => 0.999));
  return events;
}

/** 교육으로 오른 속도(레벨이 SKILL_LEVEL인 친구가 특기가 아닌 일을 할 때) */
const TRAINED = 1 + SKILL_LEVEL * LEVEL_SPEED;

describe('기술의 표', () => {
  it('친구마다 기술이 하나씩 있고 서로 다르다', () => {
    const skills = STAFF_ORDER.map((id) => STAFF[id].skill);
    expect(new Set(skills).size).toBe(STAFF_ORDER.length);
    expect([...skills].sort()).toEqual([...SKILL_IDS].sort());
  });

  it('이름과 설명이 직원 창의 좁은 줄에 들어갈 만큼 짧다', () => {
    for (const id of SKILL_IDS) {
      expect(SKILLS[id].name.length, id).toBeGreaterThan(1);
      expect(SKILLS[id].name.length, id).toBeLessThanOrEqual(5);
      expect(SKILLS[id].description.length, id).toBeGreaterThan(5);
      expect(SKILLS[id].description.length, id).toBeLessThanOrEqual(15);
    }
  });

  it('기술이 열리는 레벨은 교육으로 닿을 수 있다', () => {
    expect(SKILL_LEVEL).toBeGreaterThan(0);
    expect(SKILL_LEVEL).toBeLessThan(TRAINING.maxLevel);
  });
});

describe('기술이 열리는 때', () => {
  it('교육으로 정해진 레벨이 되어야 쓰고, 빈 자리에는 기술이 없다', () => {
    const state = office(['sprout', 'chick', null, null], 0);
    expect(skillAt(state, 0)).toBeNull();
    expect(skillOpen(state, 0)).toBe(false);
    expect(companyHas(state, 'leader')).toBe(false);
    for (let level = 0; level < SKILL_LEVEL; level += 1) {
      expect(skillAt(state, 0)).toBeNull();
      state.leaves = trainCost(level);
      expect(train(state, 0)).toBe(true);
    }
    expect(skillOpen(state, 0)).toBe(true);
    expect(skillAt(state, 0)).toBe('leader');
    expect(hasSkill(state, 0, 'leader')).toBe(true);
    expect(companyHas(state, 'leader')).toBe(true);
    // 옆자리의 병아리는 아직 교육받지 않았다.
    expect(skillAt(state, 1)).toBeNull();
    expect(skillAt(state, 2)).toBeNull();
    expect(skillOpen(state, 2)).toBe(false);
    expect(skillAt(state, 99)).toBeNull();
  });

  it('사장이 된 친구도 제 기술을 쓴다', () => {
    const state = createCompany('duck');
    expect(state.desks[0].staff).toBe('duck');
    state.desks[0].level = SKILL_LEVEL;
    expect(skillAt(state, 0)).toBe('hunter');
  });

  it('레벨은 세이브에 남으므로 기술도 다시 열 때 그대로다', () => {
    const state = office(['sprout', 'chick', 'drop', null]);
    const loaded = normalizeCompany(JSON.parse(JSON.stringify(state))) as CompanyState;
    expect(skillAt(loaded, 0)).toBe('leader');
    expect(skillAt(loaded, 1)).toBe('peppy');
    expect(skillAt(loaded, 2)).toBe('neat');
  });
});

describe('응원에 붙는 기술', () => {
  it('응원단장(새싹이)을 응원하면 일하는 옆자리 친구도 응원받는다', () => {
    const state = office(['sprout', 'rabbit', 'bear', 'frog']);
    give(state, 0, card());
    // 옆자리가 쉬고 있으면 번질 곳이 없다.
    expect(cheerReach(state, 0)).toEqual([]);
    const near = give(state, 1, card());
    const far = give(state, 2, card());
    expect(cheerReach(state, 0)).toEqual([1]);
    expect(cheer(state, 0)).toBe(true);
    expect(state.desks[0].cheer).toBe(cheerSeconds(state));
    expect(state.desks[1].cheer).toBe(cheerSeconds(state));
    expect(near.cheered).toBe(true);
    // 다른 줄의 친구에게는 번지지 않는다.
    expect(state.desks[2].cheer).toBe(0);
    expect(far.cheered).toBeUndefined();
    // 옆자리를 응원해도 응원단장에게 거꾸로 번지지는 않는다.
    state.desks[0].cheer = 0;
    cheer(state, 1);
    expect(state.desks[0].cheer).toBe(0);
    expect(cheerReach(state, 1)).toEqual([]);
  });

  it('레벨이 모자란 응원단장의 응원은 번지지 않는다', () => {
    const state = office(['sprout', 'rabbit', null, null], SKILL_LEVEL - 1);
    give(state, 0, card());
    give(state, 1, card());
    cheer(state, 0);
    expect(state.desks[1].cheer).toBe(0);
  });

  it('신바람(병아리)은 응원받는 동안 세 배로 한다', () => {
    const state = office(['bear', 'chick', null, null]);
    expect(cheerBoostAt(state, 0)).toBe(CHEER_BOOST);
    expect(cheerBoostAt(state, 1)).toBe(SKILL.peppy.boost);
    give(state, 0, card('plan'));
    give(state, 1, card('plan'));
    const plain = worked(state, 1);
    expect(plain).toBeCloseTo(TRAINED);
    cheer(state, 0);
    cheer(state, 1);
    expect(worked(state, 1)).toBeCloseTo(plain * SKILL.peppy.boost);
    // 다른 친구는 보통 응원만큼만 빨라진다.
    cheer(state, 0);
    expect(worked(state, 0)).toBeCloseTo(TRAINED * CHEER_BOOST);
  });

  it('집중(고양이)은 응원이 두 배 오래가고, 아이디어로 받는 응원도 그렇다', () => {
    const state = office(['cat', 'bear', 'rabbit', null]);
    expect(cheerSecondsAt(state, 0)).toBe(cheerSeconds(state) * SKILL.focus.seconds);
    expect(cheerSecondsAt(state, 1)).toBe(cheerSeconds(state));
    give(state, 0, card());
    give(state, 1, card());
    cheer(state, 0);
    cheer(state, 1);
    expect(state.desks[0].cheer).toBe(cheerSeconds(state) * SKILL.focus.seconds);
    expect(state.desks[1].cheer).toBe(cheerSeconds(state));

    // 아이디어 카드가 끝나면 고양이는 남들의 두 배 동안 응원받는다.
    state.project = { id: 'memory-cards', done: 0, total: 5, care: 0 };
    give(state, 2, { kind: 'plan', left: 0.1, total: 100, special: 'idea' });
    const dt = 0.5;
    advance(state, dt, () => 0.999);
    const idea = cheerSeconds(state) * SPECIAL.idea.cheer;
    expect(state.desks[1].cheer).toBeCloseTo(idea);
    expect(state.desks[0].cheer).toBeCloseTo(idea * SKILL.focus.seconds);
  });

  it('이미 더 길게 남은 응원은 다시 눌러도 줄지 않는다', () => {
    const state = office(['bear', 'rabbit', null, null]);
    give(state, 0, card());
    state.desks[0].cheer = cheerSeconds(state) * SPECIAL.idea.cheer;
    cheer(state, 0);
    expect(state.desks[0].cheer).toBe(cheerSeconds(state) * SPECIAL.idea.cheer);
  });
});

describe('옆자리에 붙는 기술', () => {
  it('다정함(강아지)은 옆자리 친구를 빠르게 하고, 저와 다른 줄은 그대로다', () => {
    const state = office(['dog', 'bear', 'rabbit', 'frog']);
    expect(deskSpeed(state, 1, 'plan')).toBeCloseTo(TRAINED + SKILL.aura.speed);
    expect(deskSpeed(state, 0, 'art')).toBeCloseTo(TRAINED);
    // 토끼는 속도를 올리는 성격이 있어서 그만큼만 빠르다.
    expect(deskSpeed(state, 2, 'art')).toBeCloseTo(TRAINED + STAFF.rabbit.trait.amount);
    // 강아지가 아직 레벨이 모자라면 옆자리도 그대로다.
    state.desks[0].level = SKILL_LEVEL - 1;
    expect(deskSpeed(state, 1, 'plan')).toBeCloseTo(TRAINED);
  });

  it('협동(펭귄)은 일하고 있는 옆자리가 있으면 빨라진다', () => {
    const state = office(['penguin', 'bear', null, null]);
    const task = give(state, 0, card('plan'));
    expect(cardBoost(state, 0, task)).toBe(1);
    const alone = worked(state, 0);
    give(state, 1, card('plan'));
    expect(cardBoost(state, 0, task)).toBeCloseTo(1 + SKILL.team.boost);
    expect(worked(state, 0)).toBeCloseTo(alone * (1 + SKILL.team.boost));
    // 협업 카드의 덤과는 곱으로 겹친다.
    task.special = 'pair';
    expect(cardBoost(state, 0, task)).toBeCloseTo((1 + SKILL.team.boost) * (1 + SPECIAL.pair.boost));
    // 곰은 협동하지 않는다.
    expect(cardBoost(state, 1, state.desks[1].task as Task)).toBe(1);
  });
});

describe('카드에 붙는 기술', () => {
  it('재빠름(토끼)은 카드를 받는 순간 얼마쯤을 해 둔다', () => {
    const state = office(['rabbit', 'bear', null, null]);
    state.inbox = [card('art', 100), card('art', 100)];
    expect(assign(state, 0, 0)).toBe(true);
    expect(state.desks[0].task?.left).toBeCloseTo(100 * (1 - SKILL.dash.share));
    expect(state.desks[0].task?.total).toBe(100);
    expect(assign(state, 0, 1)).toBe(true);
    expect(state.desks[1].task?.left).toBe(100);
  });

  it('재빠름은 레벨이 모자라면 쓰지 못한다', () => {
    const state = office(['rabbit', null, null, null], SKILL_LEVEL - 1);
    state.inbox = [card('art', 100)];
    assign(state, 0, 0);
    expect(state.desks[0].task?.left).toBe(100);
  });

  it('만능(개구리)은 특기가 아닌 업무도 잘하고, 평가에서 맞는 친구로 친다', () => {
    const state = office(['frog', 'bear', null, null]);
    expect(STAFF.frog.specialty).toBe('art');
    expect(skill(state, 0, 'art')).toBe(SPECIALTY_BOOST);
    for (const kind of ['plan', 'code', 'test'] as const) {
      expect(skill(state, 0, kind)).toBe(SKILL.handy.boost);
      expect(fits(state, 0, kind)).toBe(true);
    }
    // 곰은 특기인 검사만 맞는다.
    expect(skill(state, 1, 'plan')).toBe(1);
    expect(fits(state, 1, 'plan')).toBe(false);
    // 레벨이 모자라면 개구리도 특기만 맞는다.
    state.desks[0].level = 0;
    expect(skill(state, 0, 'plan')).toBe(1);
    expect(fits(state, 0, 'plan')).toBe(false);
  });

  it('해결사(곰)는 급한 의뢰의 카드를 무슨 업무든 세 배로 한다', () => {
    const state = office(['bear', 'rabbit', null, null]);
    state.rush = { total: 3, done: 0, left: 1000, seconds: 1000, reward: 10 };
    const urgent = give(state, 0, { ...card('plan'), rush: true });
    expect(cardBoost(state, 0, urgent)).toBe(SKILL.fixer.boost);
    expect(worked(state, 0)).toBeCloseTo(TRAINED * SKILL.fixer.boost);
    // 특기인 검사 의뢰도 세 배다(특기의 두 배에 더 곱하지 않는다).
    const own = give(state, 0, { ...card('test'), rush: true });
    expect(cardBoost(state, 0, own) * skill(state, 0, 'test')).toBeCloseTo(SKILL.fixer.boost);
    // 프로젝트의 카드는 그대로다.
    expect(cardBoost(state, 0, give(state, 0, card('plan')))).toBe(1);
    // 다른 친구는 급한 의뢰라고 빨라지지 않는다.
    expect(cardBoost(state, 1, give(state, 1, { ...card('art'), rush: true }))).toBe(1);
  });

  it('꼼꼼함(물방울)이 끝낸 카드는 정성을 더 받는다', () => {
    const state = office(['drop', 'bear', null, null]);
    const mine = card('art');
    expect(careFor(state, 0, mine)).toBe(RATING.fit + SKILL.neat.care);
    mine.cheered = true;
    expect(careFor(state, 0, mine)).toBe(RATING.fit + RATING.cheer + SKILL.neat.care);
    expect(careFor(state, 1, card('test'))).toBe(RATING.fit);
    // 끝낼 때 그 점수가 프로젝트에 쌓인다.
    state.project = { id: 'memory-cards', done: 0, total: 5, care: 0 };
    give(state, 0, { kind: 'art', left: 0.1, total: 100 });
    const events = advance(state, 0.5, () => 0.999);
    expect(events[0]).toMatchObject({ type: 'task', care: RATING.fit + SKILL.neat.care });
    expect(state.project.care).toBe(RATING.fit + SKILL.neat.care);
  });

  it('버그 사냥(오리)은 버그가 나와도 멈추지 않고 스스로 잡는다', () => {
    const state = office(['duck', 'bear', null, null]);
    state.project = { id: 'memory-cards', done: 0, total: 5, care: 0 };
    const bug = give(state, 0, { kind: 'code', left: 100, total: 100, special: 'bug' });
    const reward = bugReward(state);
    const events = run(state, 200);
    const caught = events.filter((event) => event.type === 'bugCaught');
    expect(caught).toEqual([{ type: 'bugCaught', desk: 0, reward }]);
    expect(events.some((event) => event.type === 'bug' || event.type === 'bugGone')).toBe(false);
    expect(bug.fixed).toBe(true);
    expect(bug.caught).toBe(true);
    expect(state.leaves).toBeCloseTo(reward);
    // 잡은 버그라서 정성도 더 받는다.
    expect(events.find((event) => event.type === 'task')).toMatchObject({ care: RATING.fit + RATING.catch });

    // 다른 친구의 버그는 멈춘다.
    give(state, 1, { kind: 'test', left: 100, total: 100, special: 'bug' });
    let stuck = false;
    for (let time = 0; time < 60 && !stuck; time += 0.25) {
      advance(state, 0.25, () => 0.999);
      stuck = isStuck(state, 1);
    }
    expect(stuck).toBe(true);
  });

  it('버그 사냥은 닫아 둔 동안에도 버그를 잡는다', () => {
    const state = office(['duck', null, null, null]);
    state.project = { id: 'memory-cards', done: 0, total: 5, care: 0 };
    const bug = give(state, 0, { kind: 'code', left: 100, total: 100, special: 'bug' });
    catchUp(state, 3600);
    expect(bug.caught).toBe(true);
    expect(state.desks[0].task).toBeNull();
    expect(state.leaves).toBeGreaterThanOrEqual(bugReward(state));
  });

  it('장사꾼(여우)은 카드를 끝낼 때마다 잎사귀를 받는다', () => {
    const state = office(['fox', 'bear', null, null]);
    const least = SKILL.trader.least * 4 ** state.office;
    expect(tradeReward(state)).toBe(least);
    state.project = { id: 'memory-cards', done: 0, total: 5, care: 0 };
    give(state, 0, { kind: 'test', left: 0.1, total: 100 });
    give(state, 1, { kind: 'test', left: 0.1, total: 100 });
    const events = advance(state, 0.5, () => 0.999);
    expect(events.filter((event) => event.type === 'trade')).toEqual([{ type: 'trade', desk: 0, reward: least }]);
    expect(state.leaves).toBeCloseTo(least);
    // 수익이 크면 그 몇 초만큼을 받는다.
    state.released = { 'lightning-tap': 200 };
    expect(incomePerSecond(state) * SKILL.trader.seconds).toBeGreaterThan(least);
    expect(tradeReward(state)).toBe(Math.round(incomePerSecond(state) * SKILL.trader.seconds));
  });
});

describe('행운', () => {
  it('행운(꼬마 유령)이 회사에 있으면 대박이 더 잘 난다', () => {
    const without = office(['bear', 'rabbit', null, null]);
    const lucky = office(['ghost', 'rabbit', null, null]);
    for (let flowers = 1; flowers <= MAX_FLOWERS; flowers += 1) {
      expect(hitChance(without, flowers)).toBe(RATING.hitChance[flowers - 1]);
      expect(hitChance(lucky, flowers)).toBeCloseTo(RATING.hitChance[flowers - 1] * SKILL.lucky.chance);
      expect(hitChance(lucky, flowers)).toBeLessThanOrEqual(1);
    }
    // 레벨이 모자라면 그대로다.
    lucky.desks[0].level = SKILL_LEVEL - 1;
    expect(hitChance(lucky, MAX_FLOWERS)).toBe(RATING.hitChance[MAX_FLOWERS - 1]);
  });

  it('보통 확률로는 나지 않을 수에서도 행운이 있으면 대박이 난다', () => {
    const make = (staff: StaffId): CompanyState => {
      const state = office([staff, null, null, null]);
      state.project = { id: 'lightning-tap', done: 4, total: 4, care: 4 * RATING.full };
      return state;
    };
    // 보통 확률과 행운의 확률 사이의 수
    const between = RATING.hitChance[MAX_FLOWERS - 1] * (1 + SKILL.lucky.chance) * 0.5;
    expect(release(make('bear'), () => between)?.hit).toBe(false);
    expect(release(make('ghost'), () => between)?.hit).toBe(true);
  });
});
