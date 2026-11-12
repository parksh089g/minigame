import { describe, expect, it } from 'vitest';
import { RUNNER_LOOKS } from '../../art/cosmetics';
import { SPRITES } from '../../art/sprites';
import { GAMES } from '../registry';
import { runBot } from './bot';
import {
  CANDIDATE_COUNT,
  CHEER_BOOST,
  CHEER_SECONDS,
  EQUIPMENT,
  EQUIPMENT_ORDER,
  INBOX_SLOTS,
  OFFICES,
  PROJECT_ORDER,
  PROJECTS,
  SPECIALTY_BOOST,
  STAFF,
  STAFF_ORDER,
  TASK_KINDS,
  UPDATE_SCALE,
  type StaffDef,
} from './data';
import {
  advance,
  assign,
  availableProjects,
  bestCardFor,
  bossFor,
  buyEquipment,
  candidatesFor,
  cheer,
  companyBonus,
  createCompany,
  deskSpeed,
  equipmentBlock,
  equipmentCost,
  equipmentLevel,
  formatLeaves,
  formatRate,
  hire,
  hireBlock,
  hireCost,
  hirePool,
  incomePerSecond,
  isReady,
  moveBlock,
  moveOffice,
  normalizeCompany,
  projectBonus,
  projectReputation,
  projectWork,
  release,
  specialtyOf,
  staffCount,
  startProject,
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

  it('프로젝트의 카드는 일감함에 다 들어간다', () => {
    for (const id of PROJECT_ORDER) {
      const def = PROJECTS[id];
      expect(def.cards.length, id).toBeGreaterThan(0);
      expect(def.cards.length, id).toBeLessThanOrEqual(INBOX_SLOTS);
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
    expect(advance(state, work / 2 + 0.01)).toEqual([{ desk: 0, kind: 'plan' }]);
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
    state.reputation = 1000;
    moveOffice(state);
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
    });
    expect(state).not.toBeNull();
    if (!state) return;
    expect(state.leaves).toBe(0);
    expect(state.reputation).toBe(40);
    expect(state.office).toBe(OFFICES.length - 1);
    expect(state.desks).toHaveLength(OFFICES[state.office].desks);
    // 사장이 빠져 있으면 빈 자리에 앉힌다. 같은 친구는 한 번만 앉는다.
    expect(state.desks.map((desk) => desk.staff)).toEqual(['duck', 'sprout', null, null, null, null]);
    expect(state.desks[0].gear).toEqual({ computer: EQUIPMENT.computer.maxLevel });
    expect(state.desks[0].cheer).toBe(CHEER_SECONDS);
    expect(state.gear).toEqual({ coffee: 2 });
    expect(state.released).toEqual({ 'lightning-tap': 2 });
    expect(state.releases).toBe(2);
    // 하던 프로젝트는 남은 카드를 세어서 맞춘다: 책상에 하나, 일감함에 하나가 남았다.
    expect(state.inbox).toHaveLength(1);
    expect(state.project).toEqual({ id: 'lightning-tap', total: 4, done: 2 });
    expect(state.candidates).toEqual(['cat']);
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
  // 사람은 자동 플레이보다 느리다. 보통으로 하는 사람이 십 분쯤에 작은 사무실, 한 시간쯤에 한 층 사무실에 닿도록 맞춘다.
  const play = (cheerGap: number, reaction: number) => {
    const state = createCompany('sprout');
    const report = runBot(state, 90 * 60, { cheerGap, reaction, random: seeded(7) });
    return { state, report };
  };

  it('부지런히 하면 몇 분 만에 작은 사무실로, 삼사십 분쯤에 한 층 사무실로 간다', () => {
    const { report } = play(6, 1.5);
    expect(report.officeAt[1]).toBeGreaterThan(3 * 60);
    expect(report.officeAt[1]).toBeLessThan(10 * 60);
    expect(report.officeAt[2]).toBeGreaterThan(25 * 60);
    expect(report.officeAt[2]).toBeLessThan(50 * 60);
  });

  it('응원하지 않고 느긋하게 해도 한 시간 안에 한 층 사무실에 닿는다', () => {
    const { report } = play(Infinity, 3);
    expect(report.officeAt[1]).toBeLessThan(15 * 60);
    expect(report.officeAt[2]).toBeLessThan(60 * 60);
  });

  it('한 층 사무실의 게임도 모두 내 보고, 프로젝트 하나가 너무 오래 걸리지 않는다', () => {
    const { state, report } = play(6, 1.5);
    expect(report.allReleasedAt).not.toBeNull();
    expect(report.slowest).toBeLessThan(8 * 60);
    expect(staffCount(state)).toBe(OFFICES[OFFICES.length - 1].desks);
  });
});
