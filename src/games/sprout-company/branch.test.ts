import { describe, expect, it } from 'vitest';
import { runBot } from './bot';
import { BRANCH, OFFICE_COINS, OFFICES, PERK_ORDER, PERKS, PROJECTS, TIP_IDS, type PerkDef, type PerkId } from './data';
import { createGoals } from './goals';
import {
  baseSpeed,
  buyPerk,
  createCompany,
  foundBlock,
  foundBranch,
  fruitFor,
  gameIncome,
  incomePerSecond,
  legacyBonus,
  moveCoins,
  moveOffice,
  normalizeCompany,
  perkBlock,
  perkCost,
  perkLevel,
  projectBonus,
  projectReputation,
  seedLeaves,
  totalReputation,
  type CompanyState,
} from './rules';
import { markTip, nextTip } from './tips';

const LAST = OFFICES.length - 1;

/** 정해진 차례로 수를 내는 난수 */
function seeded(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 2 ** 32;
  };
}

/** 가장 큰 사무실까지 옮긴 회사. 직원은 처음의 둘뿐이다. */
function atTop(): CompanyState {
  const state = createCompany('sprout');
  while (state.office < LAST) {
    state.reputation = OFFICES[state.office + 1].reputation;
    state.leaves = OFFICES[state.office + 1].cost;
    moveOffice(state);
  }
  state.leaves = 0;
  return state;
}

/** 자회사를 세울 수 있을 만큼 큰 회사 */
function ripe(reputation: number = BRANCH.reputation): CompanyState {
  const state = atTop();
  state.reputation = reputation;
  return state;
}

/** 살 수 있는 본사의 힘을 싼 것부터 모두 산다. */
function shop(state: CompanyState): void {
  for (let guard = 0; guard < 200; guard += 1) {
    const open = PERK_ORDER.filter((id) => perkBlock(state, id) === null);
    if (open.length === 0) return;
    open.sort((a, b) => perkCost(a, perkLevel(state, a)) - perkCost(b, perkLevel(state, b)));
    buyPerk(state, open[0]);
  }
}

describe('자회사의 표', () => {
  it('본사의 힘은 효과나 종잣돈 가운데 하나를 준다', () => {
    for (const id of PERK_ORDER) {
      const def: PerkDef = PERKS[id];
      expect(def.maxLevel, id).toBeGreaterThan(0);
      expect(def.baseCost, id).toBeGreaterThan(0);
      expect(def.effect !== undefined || def.seed !== undefined, id).toBe(true);
      if (def.effect) expect(def.effect.amount, id).toBeGreaterThan(0);
      if (def.seed) {
        expect(def.seed, id).toHaveLength(def.maxLevel);
        // 단계가 오를수록 더 많이 들고 시작한다.
        for (let level = 1; level < def.seed.length; level += 1) expect(def.seed[level], id).toBeGreaterThan(def.seed[level - 1]);
      }
      // 자회사 창의 한 줄에 들어가는 길이
      expect(def.name.length, id).toBeLessThanOrEqual(6);
      expect(def.description.length, id).toBeLessThanOrEqual(18);
    }
  });

  it('자회사를 세울 만한 평판이면 열매를 적어도 하나는 받는다', () => {
    expect(fruitFor(BRANCH.reputation)).toBeGreaterThanOrEqual(1);
    expect(BRANCH.reputation).toBeGreaterThan(OFFICES[LAST].reputation);
  });
});

describe('자회사 세우기', () => {
  it('가장 큰 사무실에서 평판을 채워야 세울 수 있다', () => {
    const small = createCompany('sprout');
    small.reputation = BRANCH.reputation * 2;
    expect(foundBlock(small)).toBe('office');
    expect(foundBranch(small)).toBeNull();

    const state = ripe(BRANCH.reputation - 1);
    expect(foundBlock(state)).toBe('reputation');
    expect(foundBranch(state)).toBeNull();
    state.reputation = BRANCH.reputation;
    expect(foundBlock(state)).toBeNull();
  });

  it('평판만큼 열매를 받는다', () => {
    expect(fruitFor(0)).toBe(0);
    expect(fruitFor(BRANCH.perFruit - 1)).toBe(0);
    expect(fruitFor(BRANCH.perFruit)).toBe(1);
    expect(fruitFor(BRANCH.perFruit * 7 + 5)).toBe(7);

    const state = ripe(BRANCH.perFruit * 7 + 5);
    state.fruit = 2;
    expect(foundBranch(state)).toEqual({ fruit: 7, branches: 1, seed: 0 });
    expect(state.fruit).toBe(9);
    expect(state.branches).toBe(1);
  });

  it('세우면 옥탑방에서 새 회사를 처음부터 다시 시작한다', () => {
    const state = ripe();
    state.leaves = 5_000_000;
    state.gear = { coffee: 3 };
    state.desks[0].gear = { computer: 4 };
    state.desks[0].level = 3;
    state.desks[2].staff = 'cat';
    state.lead = 2;
    state.departments = { plan: 2 };
    state.desks[2].dept = 'plan';
    state.released = { 'lightning-tap': 3, 'stack-tower': 1 };
    state.project = { id: 'lightning-tap', done: 1, total: 4, care: 0 };
    state.inbox = [{ kind: 'plan', left: 3, total: 10 }];
    state.backlog = [{ kind: 'art', left: 3, total: 10 }];
    state.queue = ['stack-tower'];
    state.candidates = ['dog'];

    expect(foundBranch(state)).not.toBeNull();
    const fresh = createCompany('sprout');
    expect(state.office).toBe(0);
    expect(state.leaves).toBe(0);
    expect(state.reputation).toBe(0);
    expect(state.desks).toEqual(fresh.desks);
    expect(state.gear).toEqual({});
    expect(state.lead).toBe(0);
    expect(state.departments).toEqual({});
    expect(state.released).toEqual({});
    expect(state.project).toBeNull();
    expect(state.inbox).toEqual([]);
    expect(state.backlog).toEqual([]);
    expect(state.queue).toEqual([]);
    expect(state.candidates).toBeNull();
    expect(incomePerSecond(state)).toBe(0);
    // 한 번 세운 뒤에는 다시 키워야 또 세울 수 있다.
    expect(foundBlock(state)).toBe('office');
  });

  it('열매의 힘, 딴 별, 평판 기록, 오늘의 목표, 본 안내는 남는다', () => {
    const state = ripe(BRANCH.reputation + 123);
    state.boss = 'duck';
    state.perks = { hands: 2 };
    state.stars = { 'lightning-tap': 3 };
    state.releases = 77;
    state.goals = createGoals('2026-11-12', LAST);
    state.goals.progress[0] = 1;
    state.goals.releaseCoins = 4;
    state.tips = ['income', 'gear'];
    state.savedAt = 555;
    const goals = structuredClone(state.goals);
    const before = totalReputation(state);

    foundBranch(state);
    expect(state.boss).toBe('duck');
    expect(state.perks).toEqual({ hands: 2 });
    expect(state.stars).toEqual({ 'lightning-tap': 3 });
    expect(state.releases).toBe(77);
    expect(state.goals).toEqual(goals);
    expect(state.tips).toEqual(['income', 'gear']);
    expect(state.savedAt).toBe(555);
    expect(state.topOffice).toBe(LAST);
    // 허브에 남는 기록은 줄지 않는다.
    expect(state.legacy).toBe(BRANCH.reputation + 123);
    expect(totalReputation(state)).toBe(before);
    state.reputation = 40;
    expect(totalReputation(state)).toBe(before + 40);
  });

  it('자회사 한 곳마다 출시작의 수익이 는다', () => {
    const state = createCompany('sprout');
    state.released = { 'lightning-tap': 1 };
    const plain = incomePerSecond(state);
    state.branches = 3;
    expect(legacyBonus(state, 'income')).toBeCloseTo(BRANCH.income * 3);
    expect(incomePerSecond(state)).toBeCloseTo(plain * (1 + BRANCH.income * 3));
    expect(gameIncome(state, 'lightning-tap')).toBeCloseTo(incomePerSecond(state));
    // 수익 말고 다른 것은 자회사의 수만으로는 늘지 않는다.
    expect(legacyBonus(state, 'workSpeed')).toBe(0);
  });

  it('가 본 사무실로 다시 이사할 때는 코인을 받지 않는다', () => {
    const state = createCompany('sprout');
    expect(moveCoins(state)).toBe(OFFICE_COINS[1]);
    state.reputation = OFFICES[1].reputation;
    state.leaves = OFFICES[1].cost;
    moveOffice(state);
    expect(state.topOffice).toBe(1);
    expect(moveCoins(state)).toBe(OFFICE_COINS[2]);

    const again = ripe();
    expect(moveCoins(again)).toBe(0);
    foundBranch(again);
    for (let office = 1; office <= LAST; office += 1) {
      expect(moveCoins(again), `${office}`).toBe(0);
      again.reputation = OFFICES[office].reputation;
      again.leaves = OFFICES[office].cost;
      expect(moveOffice(again)).toBe(true);
    }
    expect(again.topOffice).toBe(LAST);
  });
});

describe('본사의 힘', () => {
  it('단계가 오를수록 열매가 더 들고, 끝 단계에서 멈춘다', () => {
    const state = createCompany('sprout');
    expect(perkBlock(state, 'hands')).toBe('poor');
    expect(buyPerk(state, 'hands')).toBe(false);

    state.fruit = 1_000;
    let spent = 0;
    for (let level = 0; level < PERKS.hands.maxLevel; level += 1) {
      expect(perkCost('hands', level)).toBe(PERKS.hands.baseCost * (level + 1));
      spent += perkCost('hands', level);
      expect(buyPerk(state, 'hands')).toBe(true);
    }
    expect(perkLevel(state, 'hands')).toBe(PERKS.hands.maxLevel);
    expect(state.fruit).toBe(1_000 - spent);
    expect(perkBlock(state, 'hands')).toBe('max');
    expect(buyPerk(state, 'hands')).toBe(false);
  });

  it('일 속도, 수익, 출시 보너스, 평판을 장비와 따로 곱해서 올린다', () => {
    const state = createCompany('sprout');
    state.released = { 'lightning-tap': 1 };
    state.desks[0].gear = { computer: 4 };
    const before = {
      speed: baseSpeed(state, 0),
      income: incomePerSecond(state),
      bonus: projectBonus(state, 'gate-run'),
      reputation: projectReputation(state, 'screw-sort'),
    };
    state.perks = { hands: 2, fans: 3, party: 1, word: 4 };
    expect(baseSpeed(state, 0)).toBeCloseTo(before.speed * (1 + PERKS.hands.effect.amount * 2));
    expect(incomePerSecond(state)).toBeCloseTo(before.income * (1 + PERKS.fans.effect.amount * 3));
    expect(projectBonus(state, 'gate-run')).toBe(Math.round(before.bonus * (1 + PERKS.party.effect.amount)));
    expect(projectReputation(state, 'screw-sort')).toBe(Math.round(before.reputation * (1 + PERKS.word.effect.amount * 4)));
    // 빈 자리는 여전히 일하지 않는다.
    expect(baseSpeed(state, state.desks.length)).toBe(0);
  });

  it('종잣돈은 올린 그 자리에서 한 번 받고, 새 회사를 시작할 때마다 다시 받는다', () => {
    const state = ripe();
    state.fruit = 3;
    expect(seedLeaves(state)).toBe(0);
    buyPerk(state, 'seed');
    expect(state.leaves).toBe(PERKS.seed.seed[0]);
    buyPerk(state, 'seed');
    expect(state.leaves).toBe(PERKS.seed.seed[0] + PERKS.seed.seed[1]);
    expect(seedLeaves(state)).toBe(PERKS.seed.seed[1]);

    const founded = foundBranch(state);
    expect(founded?.seed).toBe(PERKS.seed.seed[1]);
    expect(state.leaves).toBe(PERKS.seed.seed[1]);
  });

  it('모든 힘을 끝까지 올리는 데 드는 열매는 자회사를 여러 번 세워야 모인다', () => {
    const all = PERK_ORDER.reduce((sum, id: PerkId) => {
      let cost = 0;
      for (let level = 0; level < (PERKS[id] as PerkDef).maxLevel; level += 1) cost += perkCost(id, level);
      return sum + cost;
    }, 0);
    expect(all).toBeGreaterThan(fruitFor(BRANCH.reputation) * 20);
  });
});

describe('자회사와 세이브', () => {
  it('저장한 것을 그대로 다시 읽는다', () => {
    const state = ripe(BRANCH.reputation * 2);
    foundBranch(state);
    shop(state);
    runBot(state, 10 * 60, { cheerGap: 6, reaction: 1.5, random: seeded(5) });
    expect(normalizeCompany(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });

  it('자회사가 생기기 전의 세이브는 자회사도 열매도 없고, 지금 사무실까지 가 본 것으로 친다', () => {
    const old = normalizeCompany({ boss: 'sprout', office: 2, reputation: 300 });
    expect(old).toMatchObject({ branches: 0, legacy: 0, fruit: 0, perks: {}, topOffice: 2 });
    expect(moveCoins(old!)).toBe(OFFICE_COINS[3]);
  });

  it('이상한 값과 모르는 힘은 버린다', () => {
    const state = normalizeCompany({
      boss: 'sprout',
      branches: 2.9,
      legacy: -5,
      fruit: 'many',
      perks: { hands: 999, seed: 2.5, luck: 4, fans: -1 },
      topOffice: 99,
    });
    expect(state).toMatchObject({ branches: 2, legacy: 0, fruit: 0, topOffice: LAST });
    expect(state?.perks).toEqual({ hands: PERKS.hands.maxLevel, seed: 2 });
    // 자회사를 세운 적이 있으면 가장 큰 사무실까지 가 본 것이다.
    expect(normalizeCompany({ boss: 'sprout', branches: 1 })?.topOffice).toBe(LAST);
  });
});

describe('자회사 안내', () => {
  it('세울 수 있게 되면 한 번, 열매를 쓸 수 있게 되면 한 번 알려 준다', () => {
    const state = ripe(BRANCH.reputation - 1);
    state.tips = TIP_IDS.filter((id) => id !== 'branch' && id !== 'fruit');
    expect(nextTip(state)).toBeNull();
    state.reputation = BRANCH.reputation;
    expect(nextTip(state)).toBe('branch');
    markTip(state, 'branch');
    expect(nextTip(state)).toBeNull();

    foundBranch(state);
    expect(nextTip(state)).toBe('fruit');
    markTip(state, 'fruit');
    expect(nextTip(state)).toBeNull();
  });
});

describe('자회사를 세운 뒤의 진행 속도', () => {
  const HOUR = 3600;
  // 사옥에서는 아직 못 낸 게임에 필요한 부서부터 세운다. 사람도 큰 게임을 내려고 그렇게 한다.
  const options = () => ({ cheerGap: 6, reaction: 1.5, random: seeded(7), eager: true });

  /** 자회사를 세울 수 있을 때까지 자동으로 플레이한다. 걸린 시간(초)과 사옥에 닿은 때를 돌려준다. */
  function untilRipe(state: CompanyState, limit: number): { top: number; ripe: number } {
    const step = HOUR / 2;
    let top = -1;
    for (let time = 0; time < limit; time += step) {
      const report = runBot(state, step, options());
      if (top < 0 && report.officeAt[LAST] !== undefined) top = time + report.officeAt[LAST];
      if (foundBlock(state) === null) return { top, ripe: time + step };
    }
    return { top, ripe: -1 };
  }

  it('첫 회사는 예닐곱 시간을 넘겨야 자회사가 되고, 둘째와 셋째 회사는 갈수록 빨리 큰다', () => {
    const state = createCompany('sprout');
    const first = untilRipe(state, 24 * HOUR);
    expect(first.ripe).toBeGreaterThan(6 * HOUR);
    expect(first.ripe).toBeLessThan(10 * HOUR);
    // 사옥에 와서 자회사를 세우기까지도 한 시간은 넘게 걸린다.
    expect(first.ripe - first.top).toBeGreaterThan(HOUR);
    // 세울 수 있게 되자마자 세우면 열매는 대여섯 개다.
    const founded = foundBranch(state);
    expect(founded?.fruit).toBeGreaterThanOrEqual(fruitFor(BRANCH.reputation));
    expect(founded?.fruit).toBeLessThanOrEqual(fruitFor(BRANCH.reputation) + 2);
    shop(state);

    const second = untilRipe(state, 24 * HOUR);
    expect(second.top).toBeGreaterThan(0);
    expect(second.top).toBeLessThan(first.top * 0.8);
    expect(second.ripe).toBeLessThan(first.ripe * 0.8);
    // 그래도 몇 시간은 걸려서, 다시 키우는 재미가 남는다.
    expect(second.ripe).toBeGreaterThan(3 * HOUR);
    foundBranch(state);
    shop(state);

    const third = untilRipe(state, 24 * HOUR);
    expect(third.ripe).toBeLessThanOrEqual(second.ripe);
    expect(state.branches).toBe(2);
    // 등불지기까지 다시 낼 수 있다.
    expect(PROJECTS['lantern-keeper'].unlockOffice).toBeLessThanOrEqual(state.office);
  }, 120_000);
});
