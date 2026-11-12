import { describe, expect, it } from 'vitest';
import { RUNNER_LOOKS } from '../../art/cosmetics';
import { SPRITES } from '../../art/sprites';
import { GAMES } from '../registry';
import { runBot } from './bot';
import {
  AWAY,
  CANDIDATE_COUNT,
  CHEER_BOOST,
  CHEER_SECONDS,
  DEPARTMENT,
  DEPARTMENT_ORDER,
  DEPARTMENTS,
  EQUIPMENT,
  EQUIPMENT_ORDER,
  INBOX_SLOTS,
  LEAD,
  LEVEL_SPEED,
  OFFICES,
  PROJECT_ORDER,
  PROJECTS,
  QUEUE,
  RUSH,
  SPECIALTY_BOOST,
  STAFF,
  STAFF_ORDER,
  TASK_KINDS,
  TRAINING,
  UPDATE_SCALE,
  type ProjectDef,
  type StaffDef,
} from './data';
import {
  acceptRush,
  advance,
  assign,
  availableProjects,
  bestCardFor,
  baseSpeed,
  bossFor,
  buyEquipment,
  candidatesFor,
  cardsWaiting,
  catchUp,
  cheer,
  companyBonus,
  createCompany,
  declineRush,
  departmentBlock,
  departmentBoost,
  departmentCost,
  departmentCount,
  departmentLevel,
  departmentMembers,
  departmentSeats,
  departmentsMissing,
  dequeue,
  deskSpeed,
  enqueue,
  equipmentBlock,
  equipmentCost,
  equipmentLevel,
  formatDuration,
  formatLeaves,
  formatRate,
  hire,
  hireBlock,
  hireCost,
  hirePool,
  incomePerSecond,
  isReady,
  joinBlock,
  joinDepartment,
  leadBlock,
  leadLevel,
  leaveDepartment,
  moveBlock,
  moveOffice,
  normalizeCompany,
  projectBonus,
  projectReputation,
  projectWork,
  promoteLead,
  queueBlock,
  release,
  skill,
  specialtyOf,
  staffCount,
  startProject,
  train,
  trainBlock,
  trainCost,
  upgradeDepartment,
  type CompanyState,
} from './rules';

/** 정해진 차례로 수를 내는 난수 */
function seeded(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 2 ** 32;
  };
}

/** 하던 프로젝트를 끝까지 돌린다. 걸린 시간(초)을 돌려준다. */
function finishProject(state: CompanyState): number {
  let time = 0;
  while (!isReady(state)) {
    for (let index = 0; index < state.desks.length; index += 1) {
      const card = bestCardFor(state, index);
      if (card >= 0) assign(state, card, index);
    }
    advance(state, 0.5);
    time += 0.5;
    if (time > 100_000) throw new Error('프로젝트가 끝나지 않는다');
  }
  return time;
}

/** 사무실을 office까지 옮긴 회사. 직원은 처음의 둘뿐이다. */
function movedTo(office: number): CompanyState {
  const state = createCompany('sprout');
  while (state.office < office) {
    state.reputation = OFFICES[state.office + 1].reputation;
    state.leaves = OFFICES[state.office + 1].cost;
    moveOffice(state);
  }
  state.leaves = 0;
  return state;
}

/** 사무실을 office까지 옮기고 빈 자리를 모두 채운 회사 */
function grown(office: number): CompanyState {
  const state = movedTo(office);
  for (const id of hirePool(state)) {
    if (staffCount(state) >= state.desks.length) break;
    state.candidates = [id];
    state.leaves = hireCost(state);
    hire(state, id);
  }
  state.leaves = 0;
  return state;
}

/** 이 친구가 앉은 책상의 번호 */
const deskOf = (state: CompanyState, id: string): number => state.desks.findIndex((desk) => desk.staff === id);

describe('새싹 컴퍼니의 표', () => {
  it('출시작은 포켓 아케이드에 실제로 있는 게임이다', () => {
    for (const id of PROJECT_ORDER) {
      const game = GAMES.find((entry) => entry.id === id);
      expect(game, id).toBeDefined();
      expect(PROJECTS[id].title, id).toBe(game?.title);
      expect(PROJECTS[id].icon, id).toBe(game?.icon);
      expect(SPRITES[PROJECTS[id].icon], id).toBeDefined();
    }
  });

  it('프로젝트마다 카드가 있고, 열리는 사무실이 있다', () => {
    for (const id of PROJECT_ORDER) {
      const def = PROJECTS[id];
      expect(def.cards.length, id).toBeGreaterThan(0);
      expect(def.unlockOffice, id).toBeLessThan(OFFICES.length);
      for (const kind of def.cards) expect(TASK_KINDS, id).toContain(kind);
    }
  });

  it('사무실마다 새로 만들 프로젝트가 있고, 뒤로 갈수록 크다', () => {
    for (let office = 0; office < OFFICES.length; office += 1) {
      expect(PROJECT_ORDER.some((id) => PROJECTS[id].unlockOffice === office), String(office)).toBe(true);
      if (office === 0) continue;
      expect(OFFICES[office].desks).toBeGreaterThan(OFFICES[office - 1].desks);
      expect(OFFICES[office].reputation).toBeGreaterThan(OFFICES[office - 1].reputation);
      expect(OFFICES[office].cost).toBeGreaterThan(OFFICES[office - 1].cost);
    }
    expect(OFFICES[0]).toMatchObject({ reputation: 0, cost: 0 });
  });

  it('직원은 꾸미기의 캐릭터이거나 따로 그림이 있고, 마지막 사무실을 채울 만큼 있다', () => {
    for (const id of STAFF_ORDER) {
      const def: StaffDef = STAFF[id];
      if (def.look === null) expect(def.texture, id).toBeDefined();
      else expect(RUNNER_LOOKS[def.look], id).toBeDefined();
    }
    expect(STAFF_ORDER.length).toBeGreaterThanOrEqual(OFFICES[OFFICES.length - 1].desks);
    // 꾸미기의 캐릭터는 누구든 사장이 될 수 있다.
    for (const look of Object.keys(RUNNER_LOOKS)) expect(STAFF[bossFor(look)].look, look).toBe(look);
    expect(bossFor('no-such-look')).toBe('sprout');
  });

  it('업무마다 그것이 특기인 직원이 있다', () => {
    for (const kind of TASK_KINDS) {
      expect(STAFF_ORDER.some((id) => STAFF[id].specialty === kind), kind).toBe(true);
    }
  });

  it('화면에 나오는 글자는 글꼴에 들어 있는 한글이다', () => {
    const decoder = new TextDecoder('euc-kr');
    const known = new Set<string>();
    for (let lead = 0xb0; lead <= 0xc8; lead += 1) {
      for (let trail = 0xa1; trail <= 0xfe; trail += 1) known.add(decoder.decode(new Uint8Array([lead, trail])));
    }
    expect(known.size).toBe(2350);
    const sources = import.meta.glob<string>(['./*.ts', '!./*.test.ts'], { query: '?raw', import: 'default', eager: true });
    expect(Object.keys(sources).length).toBeGreaterThan(2);
    for (const [file, source] of Object.entries(sources)) {
      for (const letter of new Set(source.match(/[가-힣]/g) ?? [])) {
        expect(known.has(letter), `${file}: "${letter}"`).toBe(true);
      }
    }
  });
});

describe('회사 세우기', () => {
  it('옥탑방에서 사장과 첫 직원 둘이 시작한다', () => {
    const state = createCompany('sprout');
    expect(state.office).toBe(0);
    expect(state.desks.map((desk) => desk.staff)).toEqual(['sprout', 'chick']);
    expect(state.leaves).toBe(0);
    expect(state.project).toBeNull();
    expect(incomePerSecond(state)).toBe(0);
  });

  it('첫 직원이 사장과 같은 친구면 다른 친구가 앉는다', () => {
    expect(createCompany('chick').desks.map((desk) => desk.staff)).toEqual(['chick', 'duck']);
  });

  it('사장은 특기가 없고, 직원은 특기인 업무를 두 배로 한다', () => {
    const state = createCompany('sprout');
    expect(specialtyOf(state, 'sprout')).toBeNull();
    expect(specialtyOf(state, 'chick')).toBe('test');
    for (const kind of TASK_KINDS) expect(deskSpeed(state, 0, kind)).toBe(1);
    expect(deskSpeed(state, 1, 'test')).toBe(SPECIALTY_BOOST);
    expect(deskSpeed(state, 1, 'code')).toBe(1);
    expect(deskSpeed(state, 5, 'code')).toBe(0);
  });
});

describe('프로젝트', () => {
  it('시작하면 카드가 일감함에 놓이고, 하던 것이 있으면 또 시작하지 못한다', () => {
    const state = createCompany('sprout');
    expect(startProject(state, 'lightning-tap')).toBe(true);
    expect(state.inbox.map((task) => task.kind)).toEqual(PROJECTS['lightning-tap'].cards);
    expect(state.project).toEqual({ id: 'lightning-tap', done: 0, total: 4 });
    expect(startProject(state, 'stack-tower')).toBe(false);
  });

  it('아직 열리지 않은 프로젝트는 시작하지 못한다', () => {
    const state = createCompany('sprout');
    expect(availableProjects(state)).toEqual(['lightning-tap', 'stack-tower']);
    expect(startProject(state, 'color-sort')).toBe(false);
    expect(state.project).toBeNull();
  });

  it('카드는 일 없는 직원에게만 맡길 수 있다', () => {
    const state = createCompany('sprout');
    startProject(state, 'lightning-tap');
    expect(assign(state, 0, 0)).toBe(true);
    expect(state.desks[0].task?.kind).toBe('plan');
    expect(state.inbox).toHaveLength(3);
    expect(assign(state, 0, 0)).toBe(false);
    expect(assign(state, 9, 1)).toBe(false);
    expect(assign(state, 0, 7)).toBe(false);
    expect(state.inbox).toHaveLength(3);
  });

  it('맡기기 좋은 카드는 특기에 맞는 것이다', () => {
    const state = createCompany('sprout');
    expect(bestCardFor(state, 1)).toBe(-1);
    startProject(state, 'lightning-tap');
    expect(bestCardFor(state, 0)).toBe(0);
    expect(state.inbox[bestCardFor(state, 1)].kind).toBe('test');
  });

  it('일은 속도만큼 줄고, 끝나면 책상이 비고 카드가 하나 끝난다', () => {
    const state = createCompany('sprout');
    startProject(state, 'lightning-tap');
    const work = projectWork(state, 'lightning-tap');
    assign(state, 0, 0);
    expect(advance(state, work / 2)).toHaveLength(0);
    expect(state.desks[0].task?.left).toBeCloseTo(work / 2);
    expect(advance(state, work / 2 + 0.01)).toEqual([{ type: 'task', desk: 0, kind: 'plan', rush: false }]);
    expect(state.desks[0].task).toBeNull();
    expect(state.project?.done).toBe(1);
    expect(isReady(state)).toBe(false);
  });

  it('응원하면 잠깐 빨라지고, 일하지 않는 책상은 응원하지 못한다', () => {
    const state = createCompany('sprout');
    startProject(state, 'lightning-tap');
    expect(cheer(state, 0)).toBe(false);
    assign(state, 0, 0);
    const before = state.desks[0].task?.left ?? 0;
    expect(cheer(state, 0)).toBe(true);
    advance(state, 1);
    expect(before - (state.desks[0].task?.left ?? 0)).toBeCloseTo(CHEER_BOOST);
    // 응원이 끝난 뒤의 시간은 보통 속도로 센다.
    advance(state, CHEER_SECONDS);
    expect(before - (state.desks[0].task?.left ?? 0)).toBeCloseTo(CHEER_SECONDS * CHEER_BOOST + 1);
    expect(state.desks[0].cheer).toBe(0);
  });

  it('카드를 다 끝내면 출시할 수 있고, 보너스와 평판과 초당 수익이 생긴다', () => {
    const state = createCompany('sprout');
    expect(release(state)).toBeNull();
    startProject(state, 'lightning-tap');
    expect(release(state)).toBeNull();
    finishProject(state);
    const bonus = projectBonus(state, 'lightning-tap');
    const leaves = state.leaves;
    const result = release(state);
    expect(result).toEqual({ id: 'lightning-tap', version: 1, bonus, reputation: PROJECTS['lightning-tap'].reputation });
    expect(state.leaves).toBeCloseTo(leaves + bonus);
    expect(state.reputation).toBe(PROJECTS['lightning-tap'].reputation);
    expect(state.project).toBeNull();
    expect(state.releases).toBe(1);
    expect(incomePerSecond(state)).toBeGreaterThan(0);
    const rate = incomePerSecond(state);
    advance(state, 10);
    expect(state.leaves).toBeCloseTo(leaves + bonus + rate * 10);
  });

  it('다시 만들면 업데이트가 되어 일은 늘고 수익이 더 붙는다', () => {
    const state = createCompany('sprout');
    startProject(state, 'lightning-tap');
    const first = finishProject(state);
    release(state);
    const rate = incomePerSecond(state);
    expect(projectWork(state, 'lightning-tap')).toBeCloseTo(PROJECTS['lightning-tap'].work * UPDATE_SCALE.work);
    expect(projectReputation(state, 'lightning-tap')).toBeLessThan(PROJECTS['lightning-tap'].reputation);
    startProject(state, 'lightning-tap');
    expect(finishProject(state)).toBeGreaterThan(first);
    expect(release(state)?.version).toBe(2);
    expect(incomePerSecond(state)).toBeGreaterThan(rate);
    expect(state.released['lightning-tap']).toBe(2);
  });
});

describe('장비', () => {
  it('컴퓨터는 그 자리만 빠르게 한다', () => {
    const state = createCompany('sprout');
    state.leaves = 1000;
    const cost = equipmentCost('computer', 0);
    expect(buyEquipment(state, 'computer', 0)).toBe(true);
    expect(state.leaves).toBe(1000 - cost);
    expect(equipmentLevel(state, 'computer', 0)).toBe(1);
    expect(equipmentLevel(state, 'computer', 1)).toBe(0);
    expect(deskSpeed(state, 0, 'code')).toBeCloseTo(1 + EQUIPMENT.computer.effect.amount);
    expect(deskSpeed(state, 1, 'code')).toBe(1);
    expect(equipmentCost('computer', 1)).toBeGreaterThan(cost);
  });

  it('커피 머신은 작은 사무실부터 살 수 있고 모두를 빠르게 한다', () => {
    const state = createCompany('sprout');
    state.leaves = 100_000;
    state.reputation = 1000;
    expect(equipmentBlock(state, 'coffee')).toBe('locked');
    expect(buyEquipment(state, 'coffee')).toBe(false);
    moveOffice(state);
    expect(buyEquipment(state, 'coffee')).toBe(true);
    expect(companyBonus(state, 'workSpeed')).toBeCloseTo(EQUIPMENT.coffee.effect.amount);
    expect(deskSpeed(state, 0, 'code')).toBeCloseTo(1 + EQUIPMENT.coffee.effect.amount);
    expect(deskSpeed(state, 1, 'test')).toBeCloseTo(SPECIALTY_BOOST * (1 + EQUIPMENT.coffee.effect.amount));
  });

  it('모자라거나, 빈 자리이거나, 끝까지 올렸으면 사지 못한다', () => {
    const state = createCompany('sprout');
    expect(equipmentBlock(state, 'computer', 0)).toBe('poor');
    state.leaves = Number.MAX_SAFE_INTEGER;
    state.reputation = Number.MAX_SAFE_INTEGER;
    while (moveOffice(state)) {
      // 장비가 모두 열리는 마지막 사무실까지 간다.
    }
    expect(equipmentBlock(state, 'computer', 3)).toBe('empty');
    for (const id of EQUIPMENT_ORDER) {
      for (let level = 0; level < EQUIPMENT[id].maxLevel; level += 1) expect(buyEquipment(state, id, 0), id).toBe(true);
      expect(equipmentBlock(state, id, 0), id).toBe('max');
      expect(buyEquipment(state, id, 0), id).toBe(false);
    }
  });
});

describe('직원과 사무실', () => {
  it('평판과 잎사귀가 차야 이사할 수 있고, 이사하면 자리가 늘어난다', () => {
    const state = createCompany('sprout');
    expect(moveBlock(state)).toBe('reputation');
    state.reputation = OFFICES[1].reputation;
    expect(moveBlock(state)).toBe('poor');
    state.leaves = OFFICES[1].cost;
    expect(moveOffice(state)).toBe(true);
    expect(state.office).toBe(1);
    expect(state.leaves).toBe(0);
    expect(state.desks).toHaveLength(OFFICES[1].desks);
    expect(staffCount(state)).toBe(2);
    expect(availableProjects(state).length).toBeGreaterThan(2);
  });

  it('마지막 사무실에서는 더 이사하지 못한다', () => {
    const state = createCompany('sprout');
    state.reputation = Number.MAX_SAFE_INTEGER;
    state.leaves = Number.MAX_SAFE_INTEGER;
    while (moveOffice(state)) {
      // 끝까지 간다.
    }
    expect(state.office).toBe(OFFICES.length - 1);
    expect(moveBlock(state)).toBe('last');
  });

  it('자리가 없으면 뽑지 못하고, 뽑을수록 값이 오른다', () => {
    const state = createCompany('sprout');
    state.leaves = 1_000_000;
    state.reputation = 1000;
    const [first] = candidatesFor(state, seeded(1));
    expect(hireBlock(state, first)).toBe('full');
    expect(hire(state, first)).toBe(-1);
    moveOffice(state);
    const cost = hireCost(state);
    expect(hire(state, first)).toBe(2);
    expect(state.desks[2].staff).toBe(first);
    expect(state.leaves).toBe(1_000_000 - OFFICES[1].cost - cost);
    expect(hireCost(state)).toBeGreaterThan(cost);
    expect(hireBlock(state, first)).toBe('gone');
  });

  it('지원자는 회사에 없는 친구 셋이고, 뽑기 전에는 바뀌지 않는다', () => {
    const state = createCompany('sprout');
    const random = seeded(3);
    const candidates = candidatesFor(state, random);
    expect(candidates).toHaveLength(CANDIDATE_COUNT);
    expect(new Set(candidates).size).toBe(CANDIDATE_COUNT);
    for (const id of candidates) expect(hirePool(state)).toContain(id);
    expect(candidatesFor(state, random)).toBe(candidates);
    state.leaves = 1_000_000;
    state.reputation = 1000;
    moveOffice(state);
    hire(state, candidates[0]);
    expect(state.candidates).toBeNull();
    expect(candidatesFor(state, random)).not.toContain(candidates[0]);
  });

  it('직원의 성격이 수익과 출시 보너스를 올린다', () => {
    const state = createCompany('drop');
    // 물방울 사장과 병아리: 병아리의 성격이 수익을 올린다.
    expect(companyBonus(state, 'income')).toBeCloseTo(STAFF.chick.trait.amount);
    expect(companyBonus(state, 'bonus')).toBe(0);
    // 물방울의 성격은 제 속도만 올린다.
    expect(deskSpeed(state, 0, 'code')).toBeCloseTo(1 + STAFF.drop.trait.amount);
    expect(companyBonus(state, 'workSpeed')).toBe(0);
  });
});

/** 작은 사무실로 옮기고 잎사귀를 넉넉히 준 회사 */
function smallOffice(): CompanyState {
  const state = createCompany('sprout');
  state.reputation = OFFICES[1].reputation;
  state.leaves = OFFICES[1].cost;
  moveOffice(state);
  state.leaves = 1_000_000;
  return state;
}

describe('팀장', () => {
  it('작은 사무실부터 둘 수 있고, 단계마다 값이 오르고 빨라진다', () => {
    const state = createCompany('sprout');
    state.leaves = 1_000_000;
    expect(leadBlock(state)).toBe('locked');
    expect(promoteLead(state)).toBe(false);
    expect(leadLevel(state)).toBeNull();

    const moved = smallOffice();
    for (let level = 0; level < LEAD.levels.length; level += 1) {
      const leaves = moved.leaves;
      expect(promoteLead(moved)).toBe(true);
      expect(moved.leaves).toBe(leaves - LEAD.levels[level].cost);
      expect(leadLevel(moved)).toBe(LEAD.levels[level]);
      if (level > 0) {
        expect(LEAD.levels[level].cost).toBeGreaterThan(LEAD.levels[level - 1].cost);
        expect(LEAD.levels[level].delay).toBeLessThan(LEAD.levels[level - 1].delay);
      }
    }
    expect(leadBlock(moved)).toBe('max');
    expect(promoteLead(moved)).toBe(false);
    moved.leaves = 0;
    moved.lead = 0;
    expect(leadBlock(moved)).toBe('poor');
  });

  it('팀장이 없으면 카드는 일감함에 그대로 남는다', () => {
    const state = smallOffice();
    startProject(state, 'lightning-tap');
    advance(state, 30);
    expect(state.inbox).toHaveLength(4);
    expect(state.desks.every((desk) => desk.task === null)).toBe(true);
  });

  it('팀장은 쉬는 친구에게 정해진 시간마다 맨 앞의 카드를 한 장씩 맡긴다', () => {
    const state = smallOffice();
    promoteLead(state);
    startProject(state, 'lightning-tap');
    const delay = LEAD.levels[0].delay;
    advance(state, delay - 0.5);
    expect(state.inbox).toHaveLength(4);
    advance(state, 0.6);
    expect(state.inbox).toHaveLength(3);
    expect(state.desks[0].task?.kind).toBe('plan');
    // 다음 카드는 다시 그만큼 기다린 뒤에 맡긴다.
    advance(state, 0.2);
    expect(state.desks[1].task).toBeNull();
    advance(state, delay);
    expect(state.desks[1].task?.kind).toBe('art');
  });

  it('맡겨만 두어도 프로젝트가 끝까지 간다', () => {
    const state = smallOffice();
    promoteLead(state);
    startProject(state, 'stack-tower');
    for (let time = 0; time < 600 && !isReady(state); time += 0.25) advance(state, 0.25);
    expect(isReady(state)).toBe(true);
    expect(state.inbox).toHaveLength(0);
  });

  it('가장 높은 단계는 특기에 맞는 카드를 골라 준다', () => {
    const state = smallOffice();
    while (promoteLead(state)) {
      // 끝까지 올린다.
    }
    startProject(state, 'lightning-tap');
    // 사장은 일하는 중이고, 검사가 특기인 병아리만 쉬고 있다.
    assign(state, 0, 0);
    advance(state, LEAD.levels[LEAD.levels.length - 1].delay + 0.1);
    expect(state.desks[1].task?.kind).toBe('test');
  });
});

describe('닫아 둔 동안', () => {
  const released = (): CompanyState => {
    const state = createCompany('sprout');
    startProject(state, 'lightning-tap');
    finishProject(state);
    release(state);
    return state;
  };

  it('잠깐 비운 것은 세지 않는다', () => {
    const state = released();
    const leaves = state.leaves;
    expect(catchUp(state, AWAY.minSeconds - 1)).toBeNull();
    expect(catchUp(state, -500)).toBeNull();
    expect(catchUp(state, Number.NaN)).toBeNull();
    expect(state.leaves).toBe(leaves);
  });

  it('출시작이 평소의 일부만큼 번다', () => {
    const state = released();
    const leaves = state.leaves;
    const rate = incomePerSecond(state);
    const away = catchUp(state, 600);
    expect(away).toMatchObject({ seconds: 600, tasks: 0, capped: false });
    expect(away?.leaves).toBeCloseTo(rate * 600 * AWAY.rate);
    expect(state.leaves).toBeCloseTo(leaves + rate * 600 * AWAY.rate);
  });

  it('아무리 오래 비워도 정해진 시간까지만 쌓인다', () => {
    const state = released();
    const away = catchUp(state, AWAY.maxSeconds * 10);
    expect(away?.seconds).toBe(AWAY.maxSeconds);
    expect(away?.capped).toBe(true);
    expect(away?.leaves).toBeCloseTo(incomePerSecond(state) * AWAY.maxSeconds * AWAY.rate);
  });

  it('맡겨 둔 업무는 그동안 끝나지만, 일감함의 카드는 팀장이 없으면 그대로다', () => {
    const state = createCompany('sprout');
    startProject(state, 'lightning-tap');
    assign(state, 0, 0);
    assign(state, 0, 1);
    const away = catchUp(state, 3600);
    expect(away?.tasks).toBe(2);
    expect(state.project?.done).toBe(2);
    expect(state.inbox).toHaveLength(2);
    expect(state.desks.every((desk) => desk.task === null)).toBe(true);
    // 번 것이 없어도 끝난 일은 알려 준다.
    expect(away?.leaves).toBe(0);
  });

  it('팀장이 있으면 남은 카드도 맡겨서 출시만 남는다', () => {
    const state = smallOffice();
    promoteLead(state);
    startProject(state, 'memory-cards');
    const away = catchUp(state, 3600);
    expect(away?.tasks).toBe(PROJECTS['memory-cards'].cards.length);
    expect(isReady(state)).toBe(true);
    // 출시는 돌아와서 직접 한다.
    expect(state.releases).toBe(0);
  });

  it('시간을 짧게 적는다', () => {
    expect(formatDuration(45)).toBe('45초');
    expect(formatDuration(60)).toBe('1분');
    expect(formatDuration(59 * 60 + 59)).toBe('59분');
    expect(formatDuration(3600)).toBe('1시간');
    expect(formatDuration(2 * 3600 + 5 * 60 + 30)).toBe('2시간 5분');
  });
});

describe('큰 게임', () => {
  it('카드가 많으면 일감함에 보이는 만큼만 놓이고, 맡기는 대로 나머지가 나온다', () => {
    const state = grown(4);
    state.departments = { plan: 1 };
    const id = 'logic-tiles';
    const cards = PROJECTS[id].cards.length;
    expect(cards).toBeGreaterThan(INBOX_SLOTS);
    expect(startProject(state, id)).toBe(true);
    expect(state.inbox).toHaveLength(INBOX_SLOTS);
    expect(state.backlog).toHaveLength(cards - INBOX_SLOTS);
    expect(cardsWaiting(state)).toBe(cards);
    expect(state.project?.total).toBe(cards);

    expect(assign(state, 0, 0)).toBe(true);
    expect(state.inbox).toHaveLength(INBOX_SLOTS);
    expect(cardsWaiting(state)).toBe(cards - 1);
  });

  it('쌓아 둔 카드까지 모두 끝내야 출시할 수 있다', () => {
    const state = grown(3);
    startProject(state, 'screw-sort');
    expect(release(state)).toBeNull();
    finishProject(state);
    expect(cardsWaiting(state)).toBe(0);
    expect(release(state)?.id).toBe('screw-sort');
    expect(state.backlog).toEqual([]);
  });

  it('뒤의 사무실일수록 자리가 많고, 열리는 게임의 카드도 많다', () => {
    const most = (office: number) =>
      Math.max(...PROJECT_ORDER.filter((id) => PROJECTS[id].unlockOffice === office).map((id) => PROJECTS[id].cards.length));
    for (let office = 1; office < OFFICES.length; office += 1) {
      expect(most(office), String(office)).toBeGreaterThan(most(office - 1));
    }
    expect(grown(OFFICES.length - 1).desks.every((desk) => desk.staff !== null)).toBe(true);
  });
});

describe('교육', () => {
  it('작은 사무실부터 할 수 있고, 레벨마다 빨라지고 값이 오른다', () => {
    const state = createCompany('sprout');
    state.leaves = 1_000_000;
    expect(trainBlock(state, 0)).toBe('locked');
    expect(train(state, 0)).toBe(false);

    const moved = smallOffice();
    const before = baseSpeed(moved, 1);
    const leaves = moved.leaves;
    expect(train(moved, 1)).toBe(true);
    expect(moved.desks[1].level).toBe(1);
    expect(moved.leaves).toBe(leaves - trainCost(0));
    expect(baseSpeed(moved, 1)).toBeCloseTo(before + LEVEL_SPEED);
    expect(baseSpeed(moved, 0)).toBeCloseTo(1);
    expect(trainCost(1)).toBeGreaterThan(trainCost(0));
  });

  it('빈 자리이거나, 모자라거나, 끝까지 올렸으면 하지 못한다', () => {
    const state = smallOffice();
    expect(trainBlock(state, 3)).toBe('empty');
    state.leaves = trainCost(0) - 1;
    expect(trainBlock(state, 0)).toBe('poor');
    state.leaves = Number.MAX_SAFE_INTEGER;
    while (train(state, 0)) {
      // 끝까지 올린다.
    }
    expect(state.desks[0].level).toBe(TRAINING.maxLevel);
    expect(trainBlock(state, 0)).toBe('max');
  });
});

describe('회사 장비', () => {
  it('일감함은 카드 한 장에 드는 일을 줄이고, 아무리 올려도 다 없애지는 못한다', () => {
    const state = smallOffice();
    const before = projectWork(state, 'lightning-tap');
    expect(buyEquipment(state, 'tray')).toBe(true);
    expect(projectWork(state, 'lightning-tap')).toBeCloseTo(before * (1 - EQUIPMENT.tray.effect.amount));
    state.gear.tray = 1000;
    expect(projectWork(state, 'lightning-tap')).toBeGreaterThan(0);
  });

  it('인터넷은 출시 때 오르는 평판을, 서버는 초당 수익을 올린다', () => {
    const state = smallOffice();
    state.released['color-sort'] = 1;
    const reputation = projectReputation(state, 'parking-out');
    const income = incomePerSecond(state);
    expect(equipmentBlock(state, 'internet')).toBe('locked');
    expect(equipmentBlock(state, 'server')).toBe('locked');
    state.gear.internet = 5;
    state.gear.server = 3;
    expect(projectReputation(state, 'parking-out')).toBe(
      Math.round(PROJECTS['parking-out'].reputation * (1 + 5 * EQUIPMENT.internet.effect.amount)),
    );
    expect(projectReputation(state, 'parking-out')).toBeGreaterThan(reputation);
    expect(incomePerSecond(state)).toBeCloseTo(income + PROJECTS['color-sort'].income * 3 * EQUIPMENT.server.effect.amount);
  });
});

describe('급한 의뢰', () => {
  /** 의뢰가 들어올 때까지 시간을 흘린다. */
  const untilOffer = (state: CompanyState, random: () => number) => {
    const events = [...advance(state, state.rushIn + 0.01, random)];
    expect(events).toContainEqual({ type: 'rushOffer' });
    return state.offer!;
  };

  it('옥탑방에는 들어오지 않고, 작은 사무실부터 가끔 들어온다', () => {
    const first = createCompany('sprout');
    advance(first, RUSH.every[1] * 3, seeded(1));
    expect(first.offer).toBeNull();

    const state = smallOffice();
    expect(state.rushIn).toBeGreaterThanOrEqual(RUSH.every[0]);
    const offer = untilOffer(state, seeded(1));
    expect(offer.kinds.length).toBeGreaterThanOrEqual(RUSH.cards[0]);
    expect(offer.kinds.length).toBeLessThanOrEqual(RUSH.cards[1]);
    for (const kind of offer.kinds) expect(TASK_KINDS).toContain(kind);
    expect(offer.reward).toBeGreaterThanOrEqual(RUSH.minReward);
    expect(offer.left).toBe(RUSH.offerSeconds);
  });

  it('받지 않고 두면 지나가고, 다음 의뢰를 기다린다', () => {
    const state = smallOffice();
    const random = seeded(2);
    untilOffer(state, random);
    advance(state, RUSH.offerSeconds + 0.01, random);
    expect(state.offer).toBeNull();
    expect(state.rush).toBeNull();
    expect(state.rushIn).toBeGreaterThanOrEqual(RUSH.every[0]);
    expect(state.rushIn).toBeLessThanOrEqual(RUSH.every[1]);

    untilOffer(state, random);
    expect(declineRush(state, random)).toBe(true);
    expect(state.offer).toBeNull();
    expect(declineRush(state, random)).toBe(false);
  });

  it('받으면 카드가 일감함 맨 앞에 놓이고, 시간 안에 끝내면 잎사귀를 받는다', () => {
    const state = smallOffice();
    const random = seeded(3);
    startProject(state, 'lightning-tap');
    const offer = untilOffer(state, random);
    const count = offer.kinds.length;
    expect(acceptRush(state)).toBe(true);
    expect(acceptRush(state)).toBe(false);
    expect(state.inbox.slice(0, count).every((task) => task.rush)).toBe(true);
    expect(state.inbox.slice(count).some((task) => task.rush)).toBe(false);
    expect(state.rush).toMatchObject({ total: count, done: 0, left: RUSH.seconds, reward: offer.reward });

    const leaves = state.leaves;
    const done = state.project!.done;
    const events: unknown[] = [];
    for (let time = 0; time < RUSH.seconds && state.rush; time += 0.5) {
      for (let index = 0; index < state.desks.length; index += 1) {
        const card = state.inbox.findIndex((task) => task.rush);
        if (card >= 0) assign(state, card, index);
      }
      events.push(...advance(state, 0.5, random));
    }
    expect(events).toContainEqual({ type: 'rushWon', reward: offer.reward });
    expect(state.rush).toBeNull();
    expect(state.leaves).toBeGreaterThanOrEqual(leaves + offer.reward);
    // 의뢰의 카드는 프로젝트의 카드로 세지 않는다.
    expect(state.project!.done).toBe(done);
    expect(state.rushIn).toBeGreaterThanOrEqual(RUSH.every[0]);
  });

  it('시간이 다 되면 남은 카드가 사라지고 아무것도 받지 못한다', () => {
    const state = smallOffice();
    const random = seeded(4);
    startProject(state, 'lightning-tap');
    untilOffer(state, random);
    acceptRush(state);
    assign(state, 0, 0);
    expect(state.desks[0].task?.rush).toBe(true);
    const leaves = state.leaves;
    state.desks[0].task!.left = 1_000_000;
    const events = advance(state, RUSH.seconds + 0.01, random);
    expect(events).toContainEqual({ type: 'rushLost' });
    expect(state.rush).toBeNull();
    expect(state.leaves).toBe(leaves);
    expect(state.desks[0].task).toBeNull();
    expect(state.inbox.some((task) => task.rush)).toBe(false);
    expect(state.inbox).toHaveLength(PROJECTS['lightning-tap'].cards.length);
  });

  it('의뢰를 하던 중에 출시해도 의뢰의 카드는 남는다', () => {
    const state = smallOffice();
    const random = seeded(5);
    startProject(state, 'lightning-tap');
    finishProject(state);
    const offer = untilOffer(state, random);
    acceptRush(state);
    expect(release(state)).not.toBeNull();
    expect(state.inbox).toHaveLength(offer.kinds.length);
    expect(state.inbox.every((task) => task.rush)).toBe(true);
  });

  it('자리를 비우면 하던 의뢰도, 들어와 있던 의뢰도 놓친다', () => {
    const state = smallOffice();
    const random = seeded(6);
    untilOffer(state, random);
    acceptRush(state);
    assign(state, 0, 0);
    catchUp(state, AWAY.minSeconds);
    expect(state.rush).toBeNull();
    expect(state.inbox).toEqual([]);
    expect(state.desks[0].task).toBeNull();

    untilOffer(state, random);
    catchUp(state, AWAY.minSeconds);
    expect(state.offer).toBeNull();
  });

  it('세이브에 하던 의뢰가 그대로 남고, 의뢰 없이 남은 의뢰 카드는 버린다', () => {
    const state = smallOffice();
    const random = seeded(7);
    untilOffer(state, random);
    acceptRush(state);
    assign(state, 0, 0);
    const saved = JSON.parse(JSON.stringify(state)) as CompanyState;
    expect(normalizeCompany(saved)).toEqual(state);

    const broken = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    delete broken.rush;
    const fixed = normalizeCompany(broken)!;
    expect(fixed.rush).toBeNull();
    expect(fixed.inbox.some((task) => task.rush)).toBe(false);
    expect(fixed.desks[0].task).toBeNull();
  });
});

describe('부서', () => {
  const LAST = OFFICES.length - 1;

  it('부서의 표가 맞게 적혀 있다', () => {
    expect(DEPARTMENT.seats).toHaveLength(DEPARTMENT.maxLevel);
    for (let level = 1; level < DEPARTMENT.seats.length; level += 1) {
      expect(DEPARTMENT.seats[level]).toBeGreaterThanOrEqual(DEPARTMENT.seats[level - 1]);
    }
    // 업무마다 그것을 맡는 부서가 하나씩 있다. 나머지는 맡는 업무 없이 회사를 돕는 부서다.
    const kinds = DEPARTMENT_ORDER.map((id) => DEPARTMENTS[id].kind).filter((kind) => kind !== null);
    expect([...kinds].sort()).toEqual([...TASK_KINDS].sort());
    for (const id of PROJECT_ORDER) {
      const def: ProjectDef = PROJECTS[id];
      if (def.departments === undefined) continue;
      expect(def.departments, id).toBeGreaterThan(0);
      expect(def.departments, id).toBeLessThanOrEqual(DEPARTMENT_ORDER.length);
      expect(def.unlockOffice, id).toBeGreaterThanOrEqual(DEPARTMENT.unlockOffice);
    }
    expect(QUEUE.slots).toBeGreaterThan(0);
    expect(DEPARTMENT.unlockOffice).toBeLessThanOrEqual(LAST);
    expect(QUEUE.unlockOffice).toBeLessThanOrEqual(LAST);
  });

  it('사옥부터 세울 수 있고, 단계마다 값이 오른다', () => {
    const early = grown(DEPARTMENT.unlockOffice - 1);
    early.leaves = 1e12;
    expect(departmentBlock(early, 'art')).toBe('locked');
    expect(upgradeDepartment(early, 'art')).toBe(false);

    const state = grown(DEPARTMENT.unlockOffice);
    expect(departmentBlock(state, 'art')).toBe('poor');
    expect(departmentCount(state)).toBe(0);
    for (let level = 0; level < DEPARTMENT.maxLevel; level += 1) {
      const cost = departmentCost(level);
      if (level > 0) expect(cost).toBeGreaterThan(departmentCost(level - 1));
      state.leaves = cost;
      expect(upgradeDepartment(state, 'art')).toBe(true);
      expect(state.leaves).toBe(0);
      expect(departmentLevel(state, 'art')).toBe(level + 1);
    }
    state.leaves = 1e12;
    expect(departmentBlock(state, 'art')).toBe('max');
    expect(upgradeDepartment(state, 'art')).toBe(false);
    expect(departmentCount(state)).toBe(1);
  });

  it('세우면 특기가 맞는 친구가 자리만큼 알아서 든다', () => {
    const state = grown(LAST);
    const artists = state.desks.filter((desk) => desk.staff && specialtyOf(state, desk.staff) === 'art').length;
    expect(artists).toBeGreaterThanOrEqual(3);
    state.leaves = 1e12;
    upgradeDepartment(state, 'art');
    expect(departmentSeats(1)).toBe(DEPARTMENT.seats[0]);
    expect(departmentMembers(state, 'art')).toHaveLength(DEPARTMENT.seats[0]);
    for (const index of departmentMembers(state, 'art')) {
      expect(specialtyOf(state, state.desks[index].staff as never)).toBe('art');
    }
    // 단계가 올라 자리가 늘면 남은 친구가 마저 든다. 특기가 다른 친구는 저절로 들지 않는다.
    while (departmentLevel(state, 'art') < DEPARTMENT.maxLevel) upgradeDepartment(state, 'art');
    expect(departmentMembers(state, 'art')).toHaveLength(Math.min(artists, departmentSeats(DEPARTMENT.maxLevel)));
    expect(departmentMembers(state, 'code')).toEqual([]);
  });

  it('새로 뽑은 친구는 특기에 맞는 부서에 자리가 있으면 바로 든다', () => {
    const state = movedTo(LAST);
    state.leaves = 1e12;
    upgradeDepartment(state, 'art');
    expect(departmentMembers(state, 'art')).toEqual([]);
    state.candidates = ['drop', 'duck'];
    const seat = hire(state, 'drop');
    expect(state.desks[seat].dept).toBe('art');
    state.candidates = ['duck'];
    expect(state.desks[hire(state, 'duck')].dept).toBeNull();
  });

  it('부서원은 그 부서의 업무를 더 빨리 하고, 특기와는 곱으로 겹친다', () => {
    const state = grown(LAST);
    const drop = deskOf(state, 'drop');
    const duck = deskOf(state, 'duck');
    expect(skill(state, drop, 'art')).toBe(SPECIALTY_BOOST);
    expect(skill(state, duck, 'art')).toBe(1);
    expect(skill(state, 99, 'art')).toBe(0);

    state.departments = { art: 2 };
    state.desks[drop].dept = 'art';
    state.desks[duck].dept = 'art';
    const team = 1 + departmentBoost(2);
    expect(departmentBoost(2)).toBeCloseTo(DEPARTMENT.boost * 2);
    expect(skill(state, drop, 'art')).toBeCloseTo(SPECIALTY_BOOST * team);
    // 특기가 아닌 친구도 부서에 들면 그 업무가 빨라진다. 다른 업무는 그대로다.
    expect(skill(state, duck, 'art')).toBeCloseTo(team);
    expect(skill(state, duck, 'code')).toBe(SPECIALTY_BOOST);
    expect(skill(state, drop, 'plan')).toBe(1);
    expect(deskSpeed(state, drop, 'art')).toBeCloseTo(baseSpeed(state, drop) * SPECIALTY_BOOST * team);

    // 부서의 단계가 오르면 더 빨라진다.
    const before = deskSpeed(state, drop, 'art');
    state.departments = { art: 3 };
    expect(deskSpeed(state, drop, 'art')).toBeGreaterThan(before);
  });

  it('직원을 넣고, 빼고, 다른 부서로 옮긴다. 한 사람은 한 부서에만 든다', () => {
    const state = grown(LAST);
    const duck = deskOf(state, 'duck');
    expect(joinBlock(state, duck, 'art')).toBe('closed');
    expect(joinDepartment(state, duck, 'art')).toBe(false);
    expect(joinBlock(state, 99, 'art')).toBe('empty');

    state.departments = { art: 1, code: 1 };
    expect(joinDepartment(state, duck, 'art')).toBe(true);
    expect(joinBlock(state, duck, 'art')).toBe('member');
    expect(joinDepartment(state, duck, 'code')).toBe(true);
    expect(state.desks[duck].dept).toBe('code');
    expect(departmentMembers(state, 'art')).toEqual([]);

    // 자리가 다 차면 더 넣지 못한다.
    const others = state.desks.map((_, index) => index).filter((index) => index !== duck);
    for (let seat = 0; seat < departmentSeats(1); seat += 1) expect(joinDepartment(state, others[seat], 'art')).toBe(true);
    expect(joinBlock(state, others[departmentSeats(1)], 'art')).toBe('full');

    expect(leaveDepartment(state, duck)).toBe(true);
    expect(leaveDepartment(state, duck)).toBe(false);
    expect(state.desks[duck].dept).toBeNull();
  });

  it('맡길 카드를 고를 때 부서도 본다', () => {
    const state = grown(LAST);
    const duck = deskOf(state, 'duck');
    state.departments = { art: 5 };
    state.desks[duck].dept = 'art';
    const card = (kind: 'plan' | 'art' | 'code') => ({ kind, left: 10, total: 10 });
    // 코딩이 특기지만, 높은 단계의 그림부에 들어 있으면 그림 카드를 더 빨리 한다.
    state.inbox = [card('plan'), card('code'), card('art')];
    expect(skill(state, duck, 'art')).toBeGreaterThan(skill(state, duck, 'code'));
    expect(bestCardFor(state, duck)).toBe(2);
    state.inbox = [card('plan'), card('code')];
    expect(bestCardFor(state, duck)).toBe(1);
    state.inbox = [card('plan'), card('plan')];
    expect(bestCardFor(state, duck)).toBe(0);

    // 가장 잘 맡기는 팀장은 가장 잘하는 짝부터 맡긴다.
    state.lead = LEAD.levels.length;
    state.leadWait = 0;
    state.inbox = [card('plan'), card('art')];
    for (const desk of state.desks) if (desk.staff && desk.staff !== 'duck') desk.task = card('code');
    advance(state, 0.01, () => 0.5);
    expect(state.desks[duck].task?.kind).toBe('art');
  });

  it('가장 큰 게임들은 부서를 세워야 처음 만들 수 있다. 한 번 낸 뒤의 업데이트는 그냥 된다', () => {
    const state = grown(LAST);
    expect(departmentsMissing(state, 'screw-sort')).toBe(0);
    expect(departmentsMissing(state, 'logic-tiles')).toBe(1);
    expect(departmentsMissing(state, 'lantern-keeper')).toBe(3);
    expect(startProject(state, 'logic-tiles')).toBe(false);
    expect(state.project).toBeNull();

    state.departments = { test: 1 };
    expect(departmentsMissing(state, 'logic-tiles')).toBe(0);
    expect(departmentsMissing(state, 'chosung-quiz')).toBe(1);
    expect(startProject(state, 'chosung-quiz')).toBe(false);
    expect(startProject(state, 'logic-tiles')).toBe(true);

    // 부서가 생기기 전에 이미 낸 게임은 부서가 없어도 다시 만들 수 있다.
    const old = grown(LAST);
    old.released['lantern-keeper'] = 1;
    expect(departmentsMissing(old, 'lantern-keeper')).toBe(0);
    expect(startProject(old, 'lantern-keeper')).toBe(true);
  });
});

describe('예약 줄', () => {
  const LAST = OFFICES.length - 1;
  /** 예약한 게임이 모두 시작될 때까지 돌린다. 그동안 저절로 된 출시의 id를 돌려준다. */
  const drainQueue = (state: CompanyState): string[] => {
    const released: string[] = [];
    for (let time = 0; state.queue.length > 0; time += 0.5) {
      for (let index = 0; index < state.desks.length; index += 1) {
        const card = bestCardFor(state, index);
        if (card >= 0) assign(state, card, index);
      }
      for (const event of advance(state, 0.5, () => 0.5)) {
        if (event.type === 'release') released.push(event.release.id);
      }
      if (time > 100_000) throw new Error('예약이 줄지 않는다');
    }
    return released;
  };

  it('사옥에서, 만드는 게임이 있을 때, 자리가 남아 있어야 예약할 수 있다', () => {
    const early = grown(QUEUE.unlockOffice - 1);
    startProject(early, 'lightning-tap');
    expect(queueBlock(early, 'stack-tower')).toBe('locked');
    expect(enqueue(early, 'stack-tower')).toBe(false);

    const state = grown(LAST);
    expect(queueBlock(state, 'stack-tower')).toBe('idle');
    expect(enqueue(state, 'stack-tower')).toBe(false);
    startProject(state, 'lightning-tap');
    expect(queueBlock(state, 'lantern-keeper')).toBe('department');
    for (let slot = 0; slot < QUEUE.slots; slot += 1) expect(enqueue(state, 'stack-tower')).toBe(true);
    expect(queueBlock(state, 'stack-tower')).toBe('full');
    expect(enqueue(state, 'memory-cards')).toBe(false);
    expect(state.queue).toHaveLength(QUEUE.slots);
  });

  it('예약한 것을 뺄 수 있다', () => {
    const state = grown(LAST);
    startProject(state, 'lightning-tap');
    enqueue(state, 'stack-tower');
    enqueue(state, 'memory-cards');
    expect(dequeue(state, 5)).toBe(false);
    expect(dequeue(state, -1)).toBe(false);
    expect(dequeue(state, 0)).toBe(true);
    expect(state.queue).toEqual(['memory-cards']);
  });

  it('예약이 있으면 다 만든 게임을 저절로 출시하고 다음 게임을 시작한다', () => {
    const state = grown(LAST);
    startProject(state, 'lightning-tap');
    enqueue(state, 'stack-tower');
    enqueue(state, 'lightning-tap');
    expect(drainQueue(state)).toEqual(['lightning-tap', 'stack-tower']);
    expect(state.releases).toBe(2);
    expect(state.released).toEqual({ 'lightning-tap': 1, 'stack-tower': 1 });
    // 같은 게임을 다시 예약한 것은 업데이트로 시작한다.
    expect(state.project?.id).toBe('lightning-tap');
    expect(state.inbox[0].total).toBeCloseTo(projectWork(state, 'lightning-tap'));
    expect(state.leaves).toBeGreaterThan(0);

    // 예약이 비면 마지막 게임은 직접 출시할 때까지 기다린다.
    finishProject(state);
    advance(state, 5, () => 0.5);
    expect(isReady(state)).toBe(true);
    expect(state.releases).toBe(2);
    expect(release(state)?.version).toBe(2);
  });

  it('직접 출시해도 예약한 게임이 바로 시작된다', () => {
    const state = grown(LAST);
    startProject(state, 'lightning-tap');
    enqueue(state, 'stack-tower');
    state.inbox = [];
    state.backlog = [];
    if (state.project) state.project.done = state.project.total;
    expect(release(state)?.id).toBe('lightning-tap');
    expect(state.project?.id).toBe('stack-tower');
    expect(state.queue).toEqual([]);
    expect(cardsWaiting(state)).toBe(PROJECTS['stack-tower'].cards.length);
  });

  it('팀장이 있으면 닫아 둔 동안에도 예약한 게임을 이어서 만들고 출시한다', () => {
    const state = grown(LAST);
    state.lead = LEAD.levels.length;
    startProject(state, 'lightning-tap');
    enqueue(state, 'stack-tower');
    enqueue(state, 'memory-cards');
    const away = catchUp(state, 3600);
    expect(away?.releases.map((entry) => entry.id)).toEqual(['lightning-tap', 'stack-tower']);
    expect(state.releases).toBe(2);
    // 마지막 게임은 다 만들어 두고, 돌아온 사람이 출시한다.
    expect(state.project?.id).toBe('memory-cards');
    expect(isReady(state)).toBe(true);
    expect(state.queue).toEqual([]);
  });

  it('예약이 없으면 닫아 둔 동안 출시하지 않는다', () => {
    const state = grown(LAST);
    state.lead = LEAD.levels.length;
    startProject(state, 'lightning-tap');
    const away = catchUp(state, 3600);
    expect(away?.releases).toEqual([]);
    expect(isReady(state)).toBe(true);
  });

  it('부서와 예약을 저장했다가 그대로 읽는다', () => {
    const state = grown(LAST);
    state.leaves = 1e12;
    upgradeDepartment(state, 'art');
    upgradeDepartment(state, 'art');
    upgradeDepartment(state, 'code');
    joinDepartment(state, 0, 'code');
    startProject(state, 'logic-tiles');
    enqueue(state, 'stack-tower');
    enqueue(state, 'logic-tiles');
    const copy = normalizeCompany(JSON.parse(JSON.stringify(state)));
    expect(copy).toEqual(state);
    expect(copy?.queue).toEqual(['stack-tower', 'logic-tiles']);
    expect(departmentMembers(copy as CompanyState, 'art')).toHaveLength(departmentSeats(2));
  });

  it('맞지 않는 부서와 예약은 버린다', () => {
    const state = grown(LAST);
    const raw = JSON.parse(JSON.stringify(state)) as Record<string, unknown> & { desks: { dept: unknown }[] };
    raw.departments = { art: 99, dance: 3, code: -2 };
    // 세우지 않은 부서와 모르는 부서, 자리를 넘는 사람은 뺀다.
    raw.desks.forEach((desk, index) => {
      desk.dept = index < 6 ? 'art' : index < 8 ? 'code' : 'dance';
    });
    raw.queue = ['stack-tower', 'no-such-game', 'lantern-keeper'];
    const read = normalizeCompany(raw) as CompanyState;
    expect(read.departments).toEqual({ art: DEPARTMENT.maxLevel });
    expect(departmentMembers(read, 'art')).toHaveLength(departmentSeats(DEPARTMENT.maxLevel));
    expect(read.desks.filter((desk) => desk.dept !== null && desk.dept !== 'art')).toEqual([]);
    // 만드는 게임이 없으면 예약도 없다.
    expect(read.queue).toEqual([]);

    raw.project = { id: 'lightning-tap', done: 0, total: 4 };
    raw.inbox = [{ kind: 'plan', left: 5, total: 10 }];
    const making = normalizeCompany(raw) as CompanyState;
    // 부서가 모자라 시작할 수 없는 게임과 모르는 게임은 뺀다.
    expect(making.queue).toEqual(['stack-tower']);

    // 부서와 예약이 열리기 전의 사무실에서는 둘 다 없다.
    raw.office = DEPARTMENT.unlockOffice - 1;
    const early = normalizeCompany(raw) as CompanyState;
    expect(early.departments).toEqual({});
    expect(early.desks.every((desk) => desk.dept === null)).toBe(true);
    expect(early.queue).toEqual([]);
  });

  it('부서가 생기기 전의 세이브도 그대로 읽는다', () => {
    const state = grown(LAST);
    const raw = JSON.parse(JSON.stringify(state)) as Record<string, unknown> & { desks: Record<string, unknown>[] };
    delete raw.departments;
    delete raw.queue;
    for (const desk of raw.desks) delete desk.dept;
    expect(normalizeCompany(raw)).toEqual(state);
  });
});

describe('숫자 적기', () => {
  it('큰 수는 만과 억으로 줄여 내림한다', () => {
    expect(formatLeaves(0)).toBe('0');
    expect(formatLeaves(12.9)).toBe('12');
    expect(formatLeaves(9999)).toBe('9999');
    expect(formatLeaves(12_999)).toBe('1.2만');
    expect(formatLeaves(1_234_567)).toBe('123만');
    expect(formatLeaves(250_000_000)).toBe('2.5억');
    expect(formatRate(0)).toBe('0');
    expect(formatRate(0.26)).toBe('0.2');
    expect(formatRate(12.7)).toBe('12');
  });
});

describe('세이브 읽기', () => {
  it('저장한 것을 그대로 다시 읽는다', () => {
    const state = createCompany('duck', 123);
    runBot(state, 20 * 60, { cheerGap: 6, reaction: 1.5, random: seeded(5) });
    candidatesFor(state, seeded(9));
    const copy = normalizeCompany(JSON.parse(JSON.stringify(state)));
    expect(copy).toEqual(state);
  });

  it('맞지 않는 값은 null이다', () => {
    expect(normalizeCompany(null)).toBeNull();
    expect(normalizeCompany('회사')).toBeNull();
    expect(normalizeCompany({})).toBeNull();
    expect(normalizeCompany({ boss: 'nobody' })).toBeNull();
  });

  it('이상한 값과 모르는 id는 버리고 나머지를 살린다', () => {
    const state = normalizeCompany({
      boss: 'sprout',
      leaves: -5,
      reputation: 40.7,
      office: 99,
      desks: [
        { staff: 'duck', gear: { computer: 999, laser: 3 }, task: { kind: 'code', left: 5, total: 10 }, cheer: 100 },
        { staff: 'duck' },
        { staff: 'nobody', gear: { computer: 2 } },
        'desk',
      ],
      gear: { coffee: 2, computer: 5 },
      project: { id: 'lightning-tap', done: 0, total: 4 },
      inbox: [{ kind: 'plan', left: 3, total: 10 }, { kind: 'dance', left: 3, total: 10 }, null],
      released: { 'lightning-tap': 2, 'no-such-game': 9 },
      releases: 1,
      candidates: ['duck', 'cat', 'cat', 'nobody'],
      lead: 99,
      leadWait: 500,
    });
    expect(state).not.toBeNull();
    if (!state) return;
    expect(state.leaves).toBe(0);
    expect(state.reputation).toBe(40);
    expect(state.office).toBe(OFFICES.length - 1);
    expect(state.desks).toHaveLength(OFFICES[state.office].desks);
    // 사장이 빠져 있으면 빈 자리에 앉힌다. 같은 친구는 한 번만 앉는다.
    expect(state.desks.map((desk) => desk.staff)).toEqual(['duck', 'sprout', ...state.desks.slice(2).map(() => null)]);
    expect(state.desks[0].gear).toEqual({ computer: EQUIPMENT.computer.maxLevel });
    expect(state.desks[0].cheer).toBe(CHEER_SECONDS);
    expect(state.gear).toEqual({ coffee: 2 });
    expect(state.released).toEqual({ 'lightning-tap': 2 });
    expect(state.releases).toBe(2);
    // 하던 프로젝트는 남은 카드를 세어서 맞춘다: 책상에 하나, 일감함에 하나가 남았다.
    expect(state.inbox).toHaveLength(1);
    expect(state.project).toEqual({ id: 'lightning-tap', total: 4, done: 2 });
    expect(state.candidates).toEqual(['cat']);
    expect(state.lead).toBe(LEAD.levels.length);
    expect(state.leadWait).toBe(LEAD.levels[LEAD.levels.length - 1].delay);
  });

  it('팀장이 생기기 전의 세이브와, 팀장을 둘 수 없는 사무실의 세이브는 팀장이 없다', () => {
    expect(normalizeCompany({ boss: 'sprout' })).toMatchObject({ lead: 0, leadWait: 0 });
    expect(normalizeCompany({ boss: 'sprout', office: 0, lead: 2, leadWait: 1 })).toMatchObject({ lead: 0, leadWait: 0 });
  });

  it('프로젝트가 사라졌으면 일을 거두고 다시 고르게 한다', () => {
    const state = normalizeCompany({
      boss: 'sprout',
      desks: [{ staff: 'sprout', task: { kind: 'code', left: 5, total: 10 } }, { staff: 'chick' }],
      project: { id: 'no-such-game', done: 0, total: 4 },
      inbox: [{ kind: 'plan', left: 3, total: 10 }],
    });
    expect(state?.project).toBeNull();
    expect(state?.inbox).toEqual([]);
    expect(state?.desks[0].task).toBeNull();
  });
});

describe('진행 속도', () => {
  // 사람은 자동 플레이보다 느리다. 보통으로 하는 사람이 오륙 분쯤에 작은 사무실, 사십 분쯤에 한 층 사무실,
  // 두세 시간쯤에 두 층 사무실, 일곱 시간쯤에 사옥에 닿도록 맞춘다.
  const play = (cheerGap: number, reaction: number, minutes: number, extra: { thrift?: number; eager?: boolean } = {}) => {
    const state = createCompany('sprout');
    const report = runBot(state, minutes * 60, { cheerGap, reaction, random: seeded(7), ...extra });
    return { state, report };
  };
  const MINUTE = 60;
  const HOUR = 3600;

  it('부지런히 하면 몇 분 만에 작은 사무실로, 삼십 분쯤에 한 층 사무실로 간다', () => {
    const { report } = play(6, 1.5, 60);
    expect(report.officeAt[1]).toBeGreaterThan(3 * MINUTE);
    expect(report.officeAt[1]).toBeLessThan(8 * MINUTE);
    expect(report.officeAt[2]).toBeGreaterThan(20 * MINUTE);
    expect(report.officeAt[2]).toBeLessThan(40 * MINUTE);
  });

  it('응원하지 않고 느긋하게 해도 한 시간 안에 한 층 사무실에 닿는다', () => {
    const { report } = play(Infinity, 3, 90);
    expect(report.officeAt[1]).toBeLessThan(10 * MINUTE);
    expect(report.officeAt[2]).toBeLessThan(50 * MINUTE);
  });

  it('두 층 사무실은 두 시간쯤에, 사옥은 대여섯 시간쯤에 닿고 하루 안에 자리를 모두 채운다', () => {
    const { state, report } = play(6, 1.5, 16 * 60);
    expect(report.officeAt[3]).toBeGreaterThan(1.5 * HOUR);
    expect(report.officeAt[3]).toBeLessThan(3 * HOUR);
    expect(report.officeAt[4]).toBeGreaterThan(4 * HOUR);
    expect(report.officeAt[4]).toBeLessThan(7 * HOUR);
    // 한 사무실에서 보내는 시간은 앞의 사무실보다 길어지되, 가장 긴 곳도 네 시간을 넘기지 않는다.
    const stays = [1, 2, 3, 4].map((office) => report.officeAt[office] - report.officeAt[office - 1]);
    for (let index = 1; index < stays.length; index += 1) expect(stays[index]).toBeGreaterThan(stays[index - 1]);
    expect(Math.max(...stays)).toBeLessThan(4 * HOUR);
    expect(report.allReleasedAt).not.toBeNull();
    expect(staffCount(state)).toBe(OFFICES[OFFICES.length - 1].desks);
    // 가장 큰 게임까지 내려면 부서를 셋은 세워야 한다.
    expect(departmentCount(state)).toBeGreaterThanOrEqual(3);
  }, 60_000);

  it('느긋하게 해도 사옥까지 간다', () => {
    const { report } = play(Infinity, 3, 10 * 60);
    expect(report.officeAt[3]).toBeLessThan(3.5 * HOUR);
    expect(report.officeAt[4]).toBeLessThan(8.5 * HOUR);
  }, 60_000);

  it('이사할 잎사귀를 아껴 모으든 장비를 사 가며 모으든 사옥에 닿는 때가 크게 벌어지지 않는다', () => {
    const spender = play(6, 1.5, 8 * 60).report;
    const saver = play(6, 1.5, 8 * 60, { thrift: 0.02 }).report;
    expect(saver.officeAt[4]).toBeLessThan(spender.officeAt[4]);
    expect(saver.officeAt[4]).toBeGreaterThan(spender.officeAt[4] * 0.65);
  }, 60_000);
});
