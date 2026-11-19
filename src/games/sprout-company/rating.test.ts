import { describe, expect, it } from 'vitest';
import { runBot } from './bot';
import { MAX_FLOWERS, OFFICES, PROJECTS, RATING, type ProjectId, type TaskKind } from './data';
import {
  advance,
  assign,
  bestFlowers,
  careFor,
  catchUp,
  cheer,
  createCompany,
  enqueue,
  fits,
  flowersBonus,
  flowersFor,
  flowersNow,
  hire,
  hireCost,
  hirePool,
  isReady,
  isStuck,
  joinDepartment,
  moveOffice,
  normalizeCompany,
  projectBonus,
  projectReputation,
  ratedBonus,
  release,
  squash,
  staffCount,
  startProject,
  upgradeDepartment,
  type CompanyEvent,
  type CompanyState,
  type Release,
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
  state.reputation = 0;
  // 급한 의뢰가 끼어들지 않게 멀리 미뤄 둔다.
  state.rushIn = 1e9;
  return state;
}

function seeded(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

type TaskDone = Extract<CompanyEvent, { type: 'task' }>;

/** 그 업무의 카드를 그 책상에 맡겨서 끝낸다. cheered면 한 번 응원한다. 끝났다는 사건을 돌려준다. */
function doCard(state: CompanyState, kind: TaskKind, desk: number, cheered = false): TaskDone {
  const card = state.inbox.findIndex((task) => task.kind === kind && !task.rush);
  if (!assign(state, card, desk)) throw new Error(`${kind} 카드를 ${desk}번 자리에 맡기지 못했다`);
  if (cheered) cheer(state, desk);
  for (let guard = 0; guard < 100_000; guard += 1) {
    const done = advance(state, 0.5, () => 0.999).find((event): event is TaskDone => event.type === 'task' && event.desk === desk);
    if (done) return done;
  }
  throw new Error('카드가 끝나지 않는다');
}

/** 프로젝트를 시작해서 사장(0번 자리)이 모든 카드를 한다. cheered에 적힌 수만큼의 카드는 응원한다. */
function makeByBoss(state: CompanyState, id: ProjectId, cheered: number): void {
  startProject(state, id);
  PROJECTS[id].cards.forEach((kind, index) => doCard(state, kind, 0, index < cheered));
}

describe('평가의 표', () => {
  it('꽃의 수마다 값이 하나씩 있고, 꽃이 많을수록 좋다', () => {
    expect(RATING.shares).toHaveLength(MAX_FLOWERS - 1);
    expect(RATING.bonus).toHaveLength(MAX_FLOWERS);
    expect(RATING.hitChance).toHaveLength(MAX_FLOWERS);
    for (let index = 1; index < MAX_FLOWERS; index += 1) {
      expect(RATING.bonus[index]).toBeGreaterThanOrEqual(RATING.bonus[index - 1]);
      expect(RATING.hitChance[index]).toBeGreaterThanOrEqual(RATING.hitChance[index - 1]);
    }
    for (let index = 1; index < RATING.shares.length; index += 1) {
      expect(RATING.shares[index]).toBeGreaterThan(RATING.shares[index - 1]);
    }
    expect(RATING.bonus[MAX_FLOWERS - 1]).toBeGreaterThan(1);
    expect(RATING.hitChance[MAX_FLOWERS - 1]).toBeGreaterThan(0);
    expect(RATING.hitChance[MAX_FLOWERS - 1]).toBeLessThan(0.5);
  });

  it('응원하지 않고 맞는 친구에게 맡기기만 해도 보너스는 줄지 않는다', () => {
    // 맞는 친구가 했다는 점수만으로 받는 꽃까지는 보너스가 그대로다.
    const idle = flowersFor(RATING.fit / RATING.full);
    for (let flowers = 1; flowers <= idle; flowers += 1) {
      expect(flowersBonus(flowers)).toBe(1);
      expect(RATING.hitChance[flowers - 1]).toBe(0);
    }
    expect(flowersBonus(idle + 1)).toBeGreaterThan(1);
  });

  it('정성의 몫이 문턱을 넘을 때마다 꽃이 한 송이씩 는다', () => {
    expect(flowersFor(0)).toBe(1);
    expect(flowersFor(RATING.shares[0] - 0.01)).toBe(1);
    RATING.shares.forEach((share, index) => {
      expect(flowersFor(share)).toBe(index + 2);
      expect(flowersFor(share - 0.001)).toBe(index + 1);
    });
    expect(flowersFor(1)).toBe(MAX_FLOWERS);
  });
});

describe('카드가 받는 정성', () => {
  it('사장은 무엇에나 맞고, 다른 친구는 특기와 부서가 맞는 업무에만 맞는다', () => {
    const state = company(OFFICES.length - 1);
    for (const kind of ['plan', 'art', 'code', 'test'] as const) expect(fits(state, 0, kind)).toBe(true);
    // 1번 자리는 검사가 특기인 병아리다.
    expect(state.desks[1].staff).toBe('chick');
    expect(fits(state, 1, 'test')).toBe(true);
    expect(fits(state, 1, 'art')).toBe(false);
    // 그림부에 들면 그림도 맞는다.
    state.leaves = 1e12;
    expect(upgradeDepartment(state, 'art')).toBe(true);
    for (let index = 0; index < state.desks.length; index += 1) if (state.desks[index].dept === 'art') state.desks[index].dept = null;
    expect(joinDepartment(state, 1, 'art')).toBe(true);
    expect(fits(state, 1, 'art')).toBe(true);
    expect(fits(state, 1, 'code')).toBe(false);
    // 빈 자리는 맞지 않는다.
    state.desks[2].staff = null;
    expect(fits(state, 2, 'plan')).toBe(false);
  });

  it('맞는 친구가 하면 한 점, 응원을 받으면 한 점을 받는다', () => {
    const state = createCompany('sprout');
    startProject(state, 'lightning-tap');
    // 사장이 응원 없이, 병아리가 특기가 아닌 그림을 응원 없이
    expect(doCard(state, 'plan', 0).care).toBe(RATING.fit);
    expect(doCard(state, 'art', 1).care).toBe(0);
    expect(state.project?.care).toBe(RATING.fit);
    // 병아리가 특기가 아닌 코딩을 응원받으며, 특기인 검사를 응원받으며
    expect(doCard(state, 'code', 1, true).care).toBe(RATING.cheer);
    expect(doCard(state, 'test', 1, true).care).toBe(RATING.fit + RATING.cheer);
    expect(state.project?.care).toBe(RATING.fit * 2 + RATING.cheer * 2);
    expect(isReady(state)).toBe(true);
  });

  it('응원은 하는 동안 한 번만 받아도 되고, 다음 카드로 넘어가지 않는다', () => {
    const state = createCompany('sprout');
    startProject(state, 'lightning-tap');
    assign(state, 0, 0);
    expect(state.desks[0].task?.cheered).toBeUndefined();
    cheer(state, 0);
    expect(state.desks[0].task?.cheered).toBe(true);
    // 응원이 끝난 뒤에 카드를 마쳐도 받은 것으로 친다.
    let done: CompanyEvent[] = [];
    for (let guard = 0; guard < 10_000 && done.length === 0; guard += 1) done = [...advance(state, 0.5, () => 0.999)];
    expect(done[0]).toMatchObject({ type: 'task', care: RATING.fit + RATING.cheer });
    assign(state, 0, 0);
    expect(state.desks[0].task?.cheered).toBeUndefined();
  });

  it('아이디어 카드를 끝내면 그때 일하던 카드들이 모두 응원을 받은 것이 된다', () => {
    const state = company(1);
    const work = 100;
    state.project = { id: 'memory-cards', done: 0, total: 5, care: 0 };
    state.desks[0].task = { kind: 'plan', left: 0.1, total: work, special: 'idea' };
    state.desks[1].task = { kind: 'art', left: work, total: work };
    state.desks[2].task = { kind: 'code', left: work, total: work };
    advance(state, 0.5, () => 0.999);
    expect(state.desks[0].task).toBeNull();
    expect(state.desks[1].task?.cheered).toBe(true);
    expect(state.desks[2].task?.cheered).toBe(true);
  });

  it('버그를 잡으면 한 점을 더 받고, 놓치면 그 카드는 점수가 없다', () => {
    const state = company(1);
    const bug = (): Task => ({ kind: 'plan', left: 100, total: 100, special: 'bug' });
    // 잡은 버그
    state.project = { id: 'memory-cards', done: 0, total: 5, care: 0 };
    state.desks[0].task = bug();
    let events: CompanyEvent[] = [];
    for (let guard = 0; guard < 10_000 && !isStuck(state, 0); guard += 1) advance(state, 0.5, () => 0.999);
    expect(squash(state, 0)).toBeGreaterThan(0);
    expect(state.desks[0].task?.caught).toBe(true);
    for (let guard = 0; guard < 10_000 && state.desks[0].task; guard += 1) events = [...advance(state, 0.5, () => 0.999)];
    expect(events[0]).toMatchObject({ type: 'task', care: RATING.fit + RATING.catch });
    expect(state.project.care).toBe(RATING.fit + RATING.catch);

    // 놓친 버그: 응원했어도 점수가 없다.
    const missed = bug();
    state.desks[0].task = missed;
    cheer(state, 0);
    for (let guard = 0; guard < 10_000 && !isStuck(state, 0); guard += 1) advance(state, 0.5, () => 0.999);
    for (let guard = 0; guard < 10_000 && isStuck(state, 0); guard += 1) advance(state, 0.5, () => 0.999);
    expect(missed.fixed).toBe(true);
    expect(missed.caught).toBeUndefined();
    expect(careFor(state, 0, missed)).toBe(0);
    for (let guard = 0; guard < 10_000 && state.desks[0].task; guard += 1) events = [...advance(state, 0.5, () => 0.999)];
    expect(events[0]).toMatchObject({ type: 'task', care: 0 });
    expect(state.project.care).toBe(RATING.fit + RATING.catch);
    expect(state.project.done).toBe(2);
  });

  it('급한 의뢰의 카드는 평가에 들어가지 않는다', () => {
    const state = company(1);
    state.project = { id: 'memory-cards', done: 0, total: 5, care: 0 };
    state.rush = { total: 2, done: 0, left: 100, seconds: 100, reward: 10 };
    state.desks[0].task = { kind: 'plan', left: 0.1, total: 10, rush: true };
    cheer(state, 0);
    const events = advance(state, 0.5, () => 0.999);
    expect(events[0]).toMatchObject({ type: 'task', rush: true, care: 0 });
    expect(state.project).toMatchObject({ done: 0, care: 0 });
  });
});

describe('출시 평가', () => {
  it('끝낸 카드가 없으면 꽃이 없고, 끝낸 카드들의 정성으로 지금의 꽃을 센다', () => {
    const state = createCompany('sprout');
    expect(flowersNow(state)).toBe(0);
    startProject(state, 'lightning-tap');
    expect(flowersNow(state)).toBe(0);
    doCard(state, 'plan', 0, true);
    expect(flowersNow(state)).toBe(MAX_FLOWERS);
    // 맞지 않는 친구가 응원 없이 하면 평균이 반으로 준다.
    doCard(state, 'art', 1);
    expect(flowersNow(state)).toBe(flowersFor(0.5));
  });

  it('모든 카드를 맞는 친구가 응원받으며 하면 꽃 다섯 송이에 보너스가 커진다', () => {
    const state = createCompany('sprout');
    makeByBoss(state, 'lightning-tap', 4);
    const plain = projectBonus(state, 'lightning-tap');
    const reputation = projectReputation(state, 'lightning-tap');
    expect(flowersNow(state)).toBe(MAX_FLOWERS);
    expect(ratedBonus(state)).toBe(Math.round(plain * RATING.bonus[MAX_FLOWERS - 1]));
    const result = release(state) as Release;
    expect(result).toEqual({
      id: 'lightning-tap',
      version: 1,
      bonus: Math.round(plain * RATING.bonus[MAX_FLOWERS - 1]),
      reputation,
      flowers: MAX_FLOWERS,
      hit: false,
    });
    expect(state.leaves).toBeCloseTo(result.bonus);
    expect(state.reputation).toBe(reputation);
    expect(bestFlowers(state, 'lightning-tap')).toBe(MAX_FLOWERS);
  });

  it('응원하지 않으면 꽃 세 송이에 보너스는 그대로다', () => {
    const state = createCompany('sprout');
    makeByBoss(state, 'lightning-tap', 0);
    const plain = projectBonus(state, 'lightning-tap');
    expect(ratedBonus(state)).toBe(plain);
    expect(release(state)).toMatchObject({ bonus: plain, flowers: flowersFor(RATING.fit / RATING.full), hit: false });
  });

  it('버그를 잡은 점수는 다른 카드에서 모자란 점수를 채우지만, 가득 찬 것보다 더 받지는 못한다', () => {
    const state = createCompany('sprout');
    startProject(state, 'lightning-tap');
    const project = state.project as NonNullable<CompanyState['project']>;
    project.done = project.total;
    project.care = project.total * RATING.full + 3;
    state.inbox = [];
    expect(flowersNow(state)).toBe(MAX_FLOWERS);
    expect(release(state)?.flowers).toBe(MAX_FLOWERS);
  });

  it('가장 좋았던 평가가 남고, 나중에 못 받아도 줄지 않는다', () => {
    const state = createCompany('sprout');
    expect(bestFlowers(state, 'lightning-tap')).toBe(0);
    makeByBoss(state, 'lightning-tap', 4);
    release(state);
    makeByBoss(state, 'lightning-tap', 0);
    expect(release(state)?.flowers).toBeLessThan(MAX_FLOWERS);
    expect(bestFlowers(state, 'lightning-tap')).toBe(MAX_FLOWERS);
    expect(bestFlowers(state, 'stack-tower')).toBe(0);
  });
});

describe('대박', () => {
  it('꽃이 많을 때 확률로 나고, 보너스와 평판이 몇 배가 된다', () => {
    const state = createCompany('sprout');
    makeByBoss(state, 'lightning-tap', 4);
    const bonus = ratedBonus(state);
    const reputation = projectReputation(state, 'lightning-tap');
    const chance = RATING.hitChance[MAX_FLOWERS - 1];
    const result = release(state, () => chance - 0.001) as Release;
    expect(result.hit).toBe(true);
    expect(result.bonus).toBe(bonus * RATING.hit.bonus);
    expect(result.reputation).toBe(reputation * RATING.hit.reputation);
    expect(state.leaves).toBeCloseTo(result.bonus);
    expect(state.reputation).toBe(result.reputation);
    expect(state.hits).toBe(1);
  });

  it('확률을 넘는 수가 나오면 나지 않는다', () => {
    const state = createCompany('sprout');
    makeByBoss(state, 'lightning-tap', 4);
    const result = release(state, () => RATING.hitChance[MAX_FLOWERS - 1]) as Release;
    expect(result.hit).toBe(false);
    expect(state.hits).toBe(0);
  });

  it('꽃이 적으면 나지 않고, 수도 뽑지 않는다', () => {
    const state = createCompany('sprout');
    makeByBoss(state, 'lightning-tap', 0);
    let drawn = 0;
    const result = release(state, () => {
      drawn += 1;
      return 0;
    }) as Release;
    expect(result.hit).toBe(false);
    expect(drawn).toBe(0);
  });

  it('여러 번 내면 확률만큼 난다', () => {
    const state = createCompany('sprout');
    const random = seeded(11);
    let hits = 0;
    const rounds = 2000;
    for (let round = 0; round < rounds; round += 1) {
      startProject(state, 'lightning-tap');
      const project = state.project as NonNullable<CompanyState['project']>;
      project.done = project.total;
      project.care = project.total * RATING.full;
      state.inbox = [];
      if (release(state, random)?.hit) hits += 1;
    }
    const chance = RATING.hitChance[MAX_FLOWERS - 1];
    expect(hits / rounds).toBeGreaterThan(chance * 0.7);
    expect(hits / rounds).toBeLessThan(chance * 1.3);
    expect(state.hits).toBe(hits);
  });

  it('닫아 둔 동안 저절로 된 출시에는 대박이 없다', () => {
    const state = company(OFFICES.length - 1);
    state.lead = 3;
    startProject(state, 'lightning-tap');
    startProject(state, 'stack-tower');
    for (let index = 0; index < 3; index += 1) expect(enqueue(state, 'lightning-tap')).toBe(true);
    const away = catchUp(state, 6 * 3600);
    expect(away?.releases.length).toBeGreaterThan(0);
    for (const result of away?.releases ?? []) {
      expect(result.hit).toBe(false);
      expect(result.flowers).toBeLessThanOrEqual(flowersFor(RATING.fit / RATING.full));
    }
    expect(state.hits).toBe(0);
  });
});

describe('평가와 세이브', () => {
  it('정성과 응원받은 카드, 잡은 버그, 가장 좋은 평가, 대박의 수가 남는다', () => {
    const state = company(1);
    makeByBoss(state, 'lightning-tap', 4);
    release(state, () => 0);
    startProject(state, 'memory-cards');
    doCard(state, PROJECTS['memory-cards'].cards[0], 0, true);
    assign(state, 0, 0);
    cheer(state, 0);
    assign(state, 0, 1);
    const bug = state.desks[1].task as Task;
    bug.special = 'bug';
    bug.fixed = true;
    bug.caught = true;

    const loaded = normalizeCompany(JSON.parse(JSON.stringify(state))) as CompanyState;
    expect(loaded.project).toEqual(state.project);
    expect(loaded.project?.care).toBe(RATING.fit + RATING.cheer);
    expect(loaded.desks[0].task?.cheered).toBe(true);
    expect(loaded.desks[1].task).toMatchObject({ special: 'bug', fixed: true, caught: true });
    expect(loaded.flowers).toEqual({ 'lightning-tap': MAX_FLOWERS });
    expect(loaded.hits).toBe(1);
  });

  it('이상한 값은 버리거나 받을 수 있는 만큼으로 맞춘다', () => {
    const state = company(1);
    makeByBoss(state, 'lightning-tap', 0);
    release(state);
    startProject(state, 'memory-cards');
    doCard(state, PROJECTS['memory-cards'].cards[0], 0);
    const raw = JSON.parse(JSON.stringify(state));
    raw.project.care = 999;
    raw.flowers = { 'lightning-tap': 99, 'stack-tower': 4, nothing: 3 };
    raw.hits = -5;
    raw.inbox[0].caught = true;
    const loaded = normalizeCompany(raw) as CompanyState;
    // 끝낸 카드 한 장이 받을 수 있는 만큼까지만 읽는다.
    expect(loaded.project?.care).toBe(RATING.full + RATING.catch);
    // 내지 않은 게임과 모르는 게임의 평가는 버린다.
    expect(loaded.flowers).toEqual({ 'lightning-tap': MAX_FLOWERS });
    expect(loaded.hits).toBe(0);
    expect(loaded.inbox[0].caught).toBeUndefined();

    raw.project.care = 'many';
    delete raw.flowers;
    const again = normalizeCompany(raw) as CompanyState;
    expect(again.project?.care).toBe(RATING.fit);
    expect(again.flowers).toEqual({});
  });
});

describe('자동 플레이와 평가', () => {
  it('부지런히 응원하면 느긋하게 둘 때보다 평가가 좋고, 대박도 난다', () => {
    const play = (cheerGap: number, reaction: number): CompanyState => {
      const state = createCompany('sprout');
      runBot(state, 40 * 60, { cheerGap, reaction, random: seeded(5) });
      return state;
    };
    const busy = play(6, 1.5);
    const lazy = play(Infinity, 3);
    const best = (state: CompanyState): number => Math.max(...Object.values(state.flowers));
    expect(best(busy)).toBe(MAX_FLOWERS);
    expect(best(lazy)).toBeLessThanOrEqual(flowersFor(RATING.fit / RATING.full));
    expect(busy.hits).toBeGreaterThan(0);
    expect(lazy.hits).toBe(0);
  });
});
