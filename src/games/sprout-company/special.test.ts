import { describe, expect, it } from 'vitest';
import { runBot } from './bot';
import { CHEER_SECONDS, OFFICES, PROJECTS, RUSH, SPECIAL, SPECIAL_KINDS, SPECIALS, type SpecialKind } from './data';
import {
  acceptRush,
  advance,
  assign,
  bugReward,
  busyNeighbors,
  catchUp,
  cheerSeconds,
  createCompany,
  enqueue,
  hire,
  hireCost,
  hirePool,
  incomePerSecond,
  isReady,
  isStuck,
  moveOffice,
  neighbors,
  normalizeCompany,
  pairBoost,
  release,
  specialsOpen,
  squash,
  staffCount,
  startProject,
  type CompanyEvent,
  type CompanyState,
  type Task,
} from './rules';

/** office 단계까지 옮기고 빈 자리를 모두 채운 회사 */
function company(office: number): CompanyState {
  const state = createCompany('sprout');
  while (state.office < office) {
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
  // 급한 의뢰가 끼어들지 않게 멀리 미뤄 둔다.
  state.rushIn = 1e9;
  return state;
}

/** 적힌 수를 차례로 주고, 다 쓰면 1에 가까운 수만 준다(특별한 카드가 되지 않는 수). */
function sequence(values: readonly number[]): () => number {
  let at = 0;
  return () => values[at++] ?? 0.999;
}

function seeded(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

const card = (special: SpecialKind | undefined, work = 100): Task => {
  const task: Task = { kind: 'plan', left: work, total: work };
  if (special) task.special = special;
  return task;
};

/** 책상에 카드를 바로 올려놓는다. */
function give(state: CompanyState, index: number, task: Task): Task {
  state.desks[index].task = task;
  return task;
}

/** 조금씩 시간을 흘리며 일어난 일을 모은다. */
function run(state: CompanyState, seconds: number, step = 0.25): CompanyEvent[] {
  const events: CompanyEvent[] = [];
  for (let time = 0; time < seconds; time += step) events.push(...advance(state, step, () => 0.999));
  return events;
}

const specialsIn = (state: CompanyState): (SpecialKind | undefined)[] =>
  [...state.inbox, ...state.backlog].map((task) => task.special);

describe('특별한 카드가 나올 때', () => {
  it('이름과 설명이 있다', () => {
    for (const kind of SPECIAL_KINDS) {
      expect(SPECIALS[kind].name.length).toBeGreaterThan(1);
      expect(SPECIALS[kind].description.length).toBeGreaterThan(5);
      expect(SPECIALS[kind].description.length).toBeLessThanOrEqual(24);
    }
  });

  it('옥탑방에서는 나오지 않는다', () => {
    const state = createCompany('sprout');
    expect(specialsOpen(state)).toBe(false);
    startProject(state, 'lightning-tap', () => 0);
    expect(specialsIn(state)).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('정하는 수를 주지 않으면 모두 보통 카드다', () => {
    const state = company(1);
    expect(specialsOpen(state)).toBe(true);
    startProject(state, 'memory-cards');
    expect(specialsIn(state).every((special) => special === undefined)).toBe(true);
  });

  it('카드마다 확률로 정하고, 종류는 셋 가운데 하나다', () => {
    const state = company(1);
    // 첫째 수가 확률보다 작으면 특별한 카드가 되고, 그다음 수로 종류를 고른다.
    const under = SPECIAL.chance - 0.01;
    startProject(state, 'memory-cards', sequence([under, 0, 0.999, under, 0.5, under, 0.999, SPECIAL.chance]));
    expect(specialsIn(state)).toEqual(['idea', undefined, 'bug', 'pair', undefined]);
    // 업무의 종류와 일의 양은 그대로다.
    expect([...state.inbox, ...state.backlog].map((task) => task.kind)).toEqual(PROJECTS['memory-cards'].cards);
    expect(new Set([...state.inbox, ...state.backlog].map((task) => task.total)).size).toBe(1);
  });

  it('여러 번 만들면 확률만큼 나오고 세 가지가 고루 섞인다', () => {
    const state = company(1);
    const random = seeded(3);
    const count: Record<string, number> = { idea: 0, bug: 0, pair: 0, plain: 0 };
    for (let round = 0; round < 400; round += 1) {
      startProject(state, 'gate-run', random);
      for (const special of specialsIn(state)) count[special ?? 'plain'] += 1;
      state.project = null;
      state.inbox = [];
      state.backlog = [];
    }
    const total = 400 * PROJECTS['gate-run'].cards.length;
    const special = total - count.plain;
    expect(special / total).toBeGreaterThan(SPECIAL.chance - 0.03);
    expect(special / total).toBeLessThan(SPECIAL.chance + 0.03);
    for (const kind of SPECIAL_KINDS) expect(count[kind] / special).toBeGreaterThan(0.25);
  });

  it('예약으로 이어서 시작하는 게임에도 나온다', () => {
    const state = company(OFFICES.length - 1);
    startProject(state, 'lightning-tap');
    startProject(state, 'jump-runner');
    expect(enqueue(state, 'stack-tower')).toBe(true);
    state.project!.done = state.project!.total;
    state.inbox = [];
    state.backlog = [];
    const events = advance(state, 0.1, () => 0);
    expect(events.some((event) => event.type === 'release')).toBe(true);
    expect(state.second?.id).toBe('stack-tower');
    const tower = (task: Task | null): boolean => task?.project === 'stack-tower';
    const cards = [...state.inbox, ...state.backlog, ...state.desks.map((desk) => desk.task)].filter(tower);
    expect(cards.some((task) => task?.special === 'idea')).toBe(true);
    // 손으로 출시할 때도 같다.
    enqueue(state, 'lightning-tap');
    state.project!.done = state.project!.total;
    for (const desk of state.desks) desk.task = null;
    state.inbox = [];
    state.backlog = [];
    expect(release(state, () => 0)).not.toBeNull();
    expect(state.second?.id).toBe('lightning-tap');
    expect(state.inbox.length).toBeGreaterThan(0);
    expect(state.inbox.every((task) => task.special === 'idea')).toBe(true);
  });

  it('급한 의뢰의 카드는 특별한 카드가 아니다', () => {
    const state = company(1);
    advance(state, (state.rushIn = 1) + 0.01, () => 0);
    expect(state.offer).not.toBeNull();
    acceptRush(state);
    expect(state.inbox.length).toBeGreaterThanOrEqual(RUSH.cards[0]);
    expect(state.inbox.every((task) => task.rush && task.special === undefined)).toBe(true);
  });
});

describe('아이디어 카드', () => {
  it('끝내면 그때 일하고 있는 친구 모두가 응원을 받는다', () => {
    const state = company(1);
    give(state, 0, card('idea', 0.1));
    give(state, 1, card(undefined, 1e6));
    give(state, 2, card(undefined, 1e6));
    const dt = 0.5;
    const events = advance(state, dt, () => 0.999);
    expect(events.map((event) => event.type)).toEqual(['task', 'idea']);
    const seconds = cheerSeconds(state) * SPECIAL.idea.cheer;
    expect(seconds).toBe(CHEER_SECONDS * SPECIAL.idea.cheer);
    // 뒤에 앉은 친구들은 응원을 받은 그 틱부터 응원받으며 일한다.
    expect(state.desks[1].cheer).toBeCloseTo(seconds - dt, 5);
    expect(state.desks[2].cheer).toBeCloseTo(seconds - dt, 5);
    // 끝낸 자리와 쉬는 자리는 받지 않는다.
    expect(state.desks[0].cheer).toBe(0);
    expect(state.desks[3].cheer).toBe(0);
  });

  it('이미 더 길게 응원받는 친구의 응원은 줄이지 않는다', () => {
    const state = company(1);
    give(state, 1, card('idea', 1));
    give(state, 0, card(undefined, 1e6));
    state.desks[0].cheer = 100;
    advance(state, 1, () => 0.999);
    expect(state.desks[0].cheer).toBe(99);
  });

  it('보통 카드를 끝낼 때는 아무도 응원을 받지 않는다', () => {
    const state = company(1);
    give(state, 0, card(undefined, 1));
    give(state, 1, card(undefined, 1e6));
    expect(advance(state, 2, () => 0.999).map((event) => event.type)).toEqual(['task']);
    expect(state.desks[1].cheer).toBe(0);
  });
});

describe('버그 카드', () => {
  it('정해진 만큼 하면 버그가 나와서 일이 멈추고, 두면 얼마 뒤에 저절로 사라진다', () => {
    const state = company(1);
    const task = give(state, 0, card('bug', 1e4));
    const events: CompanyEvent[] = [];
    for (let guard = 0; guard < 100_000 && !isStuck(state, 0); guard += 1) events.push(...advance(state, 0.25, () => 0.999));
    expect(events.map((event) => event.type)).toEqual(['bug']);
    expect(task.left).toBeCloseTo(task.total * (1 - SPECIAL.bug.at), 5);
    expect(task.stuck).toBe(SPECIAL.bug.wait);

    // 멈춘 동안에는 일이 나아가지 않는다.
    const waiting = run(state, SPECIAL.bug.wait - 0.5);
    expect(waiting).toEqual([]);
    expect(task.left).toBeCloseTo(task.total * (1 - SPECIAL.bug.at), 5);
    expect(isStuck(state, 0)).toBe(true);

    expect(run(state, 0.5).map((event) => event.type)).toEqual(['bugGone']);
    expect(isStuck(state, 0)).toBe(false);
    expect(task.fixed).toBe(true);
    // 그 뒤로는 다시 나아가고, 같은 카드에서 버그가 또 나오지는 않는다.
    const before = task.left;
    expect(run(state, 5)).toEqual([]);
    expect(task.left).toBeLessThan(before);
  });

  it('그 자리를 눌러 잡으면 바로 다시 일하고 잎사귀를 받는다', () => {
    const state = company(1);
    state.released = { 'lightning-tap': 1 };
    const task = give(state, 0, card('bug', 10));
    for (let guard = 0; guard < 1000 && !isStuck(state, 0); guard += 1) advance(state, 0.25, () => 0.999);
    const leaves = state.leaves;
    const reward = bugReward(state);
    expect(squash(state, 0)).toBe(reward);
    expect(state.leaves).toBe(leaves + reward);
    expect(isStuck(state, 0)).toBe(false);
    expect(task.fixed).toBe(true);
    // 한 번 잡은 버그는 다시 잡을 수 없다.
    expect(squash(state, 0)).toBe(0);
    const events = run(state, 60);
    expect(events.map((event) => event.type)).toEqual(['task']);
  });

  it('버그가 없는 자리를 눌러서는 아무것도 받지 못한다', () => {
    const state = company(1);
    give(state, 0, card('bug', 1e4));
    give(state, 1, card(undefined, 1e4));
    const leaves = state.leaves;
    expect(squash(state, 0)).toBe(0);
    expect(squash(state, 1)).toBe(0);
    expect(squash(state, 2)).toBe(0);
    expect(squash(state, 99)).toBe(0);
    expect(state.leaves).toBe(leaves);
  });

  it('잡으면 받는 잎사귀는 수익을 따라 크고, 사무실마다 정해진 만큼은 받는다', () => {
    const small = company(1);
    expect(incomePerSecond(small)).toBe(0);
    expect(bugReward(small)).toBe(SPECIAL.bug.minReward * 4);
    expect(bugReward(company(2))).toBe(SPECIAL.bug.minReward * 16);
    small.released = { 'gate-run': 30 };
    expect(bugReward(small)).toBe(Math.round(incomePerSecond(small) * SPECIAL.bug.rewardSeconds));
    expect(bugReward(small)).toBeGreaterThan(SPECIAL.bug.minReward * 4);
  });

  it('막힌 동안에는 기운이 줄지 않는다', () => {
    const state = company(2);
    const task = give(state, 0, card('bug', 1e4));
    for (let guard = 0; guard < 100_000 && !isStuck(state, 0); guard += 1) advance(state, 0.25, () => 0.999);
    const energy = state.desks[0].energy;
    run(state, 2);
    expect(task.stuck).toBeLessThan(SPECIAL.bug.wait);
    expect(state.desks[0].energy).toBe(energy);
  });

  it('닫아 둔 동안에는 버그가 저절로 지나가서 일이 끝까지 간다', () => {
    const state = company(1);
    startProject(state, 'lightning-tap');
    for (const task of state.inbox) task.special = 'bug';
    const cards = state.inbox.length;
    state.inbox.slice().forEach((_, index) => assign(state, 0, index));
    const away = catchUp(state, 3600);
    // 끝낸 업무만 세고, 버그가 나오고 사라진 것은 세지 않는다.
    expect(away?.tasks).toBe(cards);
    expect(isReady(state)).toBe(true);
  });
});

describe('협업 카드', () => {
  /** 가운데 자리가 있는 한 층 사무실에서, 가운데 자리의 양옆을 일하게 하거나 쉬게 하고 dt초 동안 한 일을 잰다. */
  function worked(special: SpecialKind | undefined, busy: number, stuck = false): number {
    const state = company(2);
    const middle = 1;
    expect(neighbors(state, middle)).toEqual([0, 2]);
    const task = give(state, middle, card(special, 1e6));
    neighbors(state, middle)
      .slice(0, busy)
      .forEach((at) => {
        const other = give(state, at, card(undefined, 1e6));
        if (stuck) other.stuck = SPECIAL.bug.wait;
      });
    expect(busyNeighbors(state, middle)).toBe(stuck ? 0 : busy);
    expect(pairBoost(state, middle, task)).toBe(special === 'pair' && !stuck ? 1 + SPECIAL.pair.boost * busy : 1);
    advance(state, 1, () => 0.999);
    return task.total - task.left;
  }

  it('옆자리 친구가 일하는 수만큼 빨라진다', () => {
    const alone = worked('pair', 0);
    expect(alone).toBeGreaterThan(0);
    expect(worked('pair', 1) / alone).toBeCloseTo(1 + SPECIAL.pair.boost, 5);
    expect(worked('pair', 2) / alone).toBeCloseTo(1 + SPECIAL.pair.boost * 2, 5);
  });

  it('혼자 하면 보통 카드와 같고, 보통 카드는 옆자리와 상관없다', () => {
    expect(worked('pair', 0)).toBeCloseTo(worked(undefined, 0), 5);
    expect(worked(undefined, 2)).toBeCloseTo(worked(undefined, 0), 5);
  });

  it('버그에 막힌 옆자리는 세지 않는다', () => {
    expect(worked('pair', 2, true)).toBeCloseTo(worked('pair', 0), 5);
  });

  it('줄의 끝자리는 옆자리가 하나뿐이다', () => {
    const state = company(1);
    expect(neighbors(state, 0)).toEqual([1]);
    give(state, 1, card(undefined, 1e6));
    give(state, 2, card(undefined, 1e6));
    expect(pairBoost(state, 0, card('pair'))).toBe(1 + SPECIAL.pair.boost);
  });
});

describe('특별한 카드의 저장', () => {
  it('일감함과 책상의 카드를 그대로 다시 읽는다', () => {
    const state = company(1);
    startProject(state, 'memory-cards', () => 0);
    for (const index of [0, 1, 2]) assign(state, 0, index);
    Object.assign(state.desks[1].task!, { left: 5, special: 'bug', stuck: 3 });
    Object.assign(state.desks[2].task!, { left: 2, special: 'bug', fixed: true });
    expect(state.inbox.map((task) => task.special)).toEqual(['idea', 'idea']);
    const loaded = normalizeCompany(JSON.parse(JSON.stringify(state)))!;
    expect(loaded.inbox).toEqual(state.inbox);
    expect(loaded.desks.map((desk) => desk.task)).toEqual(state.desks.map((desk) => desk.task));
    expect(isStuck(loaded, 1)).toBe(true);
  });

  it('이상한 값은 버린다', () => {
    const state = company(1);
    state.project = { id: 'memory-cards', done: 0, total: 5, care: 0 };
    const raw = JSON.parse(JSON.stringify(state)) as { inbox: unknown[] };
    raw.inbox = [
      { kind: 'plan', left: 5, total: 10, special: 'dance' },
      { kind: 'plan', left: 5, total: 10, special: 'bug', stuck: 999 },
      { kind: 'plan', left: 5, total: 10, special: 'bug', stuck: -4 },
      { kind: 'plan', left: 5, total: 10, special: 'idea', stuck: 3 },
      { kind: 'plan', left: 5, total: 10, special: 'bug', stuck: 3, fixed: true },
    ];
    expect(normalizeCompany(raw)!.inbox).toEqual([
      { kind: 'plan', left: 5, total: 10 },
      { kind: 'plan', left: 5, total: 10, special: 'bug', stuck: SPECIAL.bug.wait },
      { kind: 'plan', left: 5, total: 10, special: 'bug' },
      { kind: 'plan', left: 5, total: 10, special: 'idea' },
      { kind: 'plan', left: 5, total: 10, special: 'bug', fixed: true },
    ]);
  });
});

describe('자동 플레이', () => {
  it('부지런한 사람은 버그를 잡아서, 지나가게 두는 사람보다 버그 카드를 빨리 끝낸다', () => {
    const until = (cheerGap: number): number => {
      const state = company(1);
      state.project = { id: 'memory-cards', done: 0, total: 1, care: 0 };
      state.inbox = [card('bug', 400)];
      // 자동 플레이는 부를 때마다 누르기까지의 시간을 새로 세므로, 그 시간보다 길게 끊어서 부른다.
      for (let time = 0; time < 600; time += 2) {
        runBot(state, 2, { cheerGap, reaction: 1, random: () => 0.999 });
        if (state.releases > 0) return time;
      }
      return Infinity;
    };
    expect(until(1e6)).toBeLessThan(until(Infinity));
  });
});
