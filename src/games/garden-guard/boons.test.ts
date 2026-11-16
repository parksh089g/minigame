import { describe, expect, it } from 'vitest';
import { applyBoon, boonCount, canOffer, drawOffer, heatScale, picksLeft } from './boons';
import { botPick } from './bot';
import {
  BOON_CHOICES,
  BOON_HEAT,
  BOON_ORDER,
  BOON_PICKS,
  BOON_STEP,
  BOONS,
  DAY,
  ENEMIES,
  SHOOTER,
  UPGRADES,
  type BoonId,
} from './data';
import { hpScale, type Levels } from './rules';
import { createRun, step, type Input, type RunState, type SimEvent } from './sim';

const DT = 1 / 60;
const pick = (index: number): Input => ({ aim: null, storm: false, pick: index });

function start(levels: Levels = {}, startDay = 1, seed = 11): RunState {
  return createRun({ seed, startDay, levels, bestBefore: 0 }).state;
}

/** 벌레 한 마리만 남겨서 곧 날을 지키게 될 판 */
function nearlyCleared(levels: Levels = {}, startDay = 1): RunState {
  const state = start(levels, startDay);
  state.queue = [];
  state.dayTotal = 1;
  state.enemies = [];
  const ant = ENEMIES.ant;
  state.enemies.push({
    id: state.nextId++,
    kind: 'ant',
    x: SHOOTER.x,
    y: 250,
    homeX: SHOOTER.x,
    hp: 1,
    maxHp: 1,
    day: state.day,
    biting: false,
    biteIn: ant.biteEvery,
    clock: 0,
    slow: 0,
    slowLeft: 0,
    summonIn: 99,
    flash: 0,
  });
  return state;
}

function run(state: RunState, seconds: number, input?: Input): SimEvent[] {
  const events: SimEvent[] = [];
  for (let time = 0; time < seconds && state.phase !== 'over'; time += DT) events.push(...step(state, DT, input));
  return events;
}

/** 날을 지켜서 강화를 내놓은 판 */
function offering(levels: Levels = {}, startDay = 1): RunState {
  const state = nearlyCleared(levels, startDay);
  run(state, 2);
  expect(state.phase).toBe('rest');
  return state;
}

describe('판마다 고르는 강화', () => {
  it('날을 지키면 서로 다른 강화 셋을 내놓고, 고를 때까지 다음 날이 오지 않는다', () => {
    const state = nearlyCleared();
    const events = run(state, 2);
    const offer = events.find((event) => event.type === 'offer');
    expect(offer?.type === 'offer' && offer.choices).toEqual(state.offer);
    expect(state.offer).toHaveLength(BOON_CHOICES);
    expect(new Set(state.offer).size).toBe(BOON_CHOICES);
    for (const id of state.offer) expect(BOON_ORDER).toContain(id);
    // 한참 기다려도 그날에 머문다. 시간은 흐른다(날아가던 물방울이 멈추지 않는다).
    const before = state.t;
    run(state, DAY.rest * 5);
    expect(state.day).toBe(1);
    expect(state.phase).toBe('rest');
    expect(state.t).toBeGreaterThan(before);
    expect(state.offer).toHaveLength(BOON_CHOICES);
  });

  it('고르면 그 강화가 붙고, 조금 쉰 뒤 다음 날이 온다', () => {
    const state = offering();
    const chosen = state.offer[1];
    const events = step(state, DT, pick(1));
    expect(events).toContainEqual({ type: 'boon', id: chosen });
    expect(state.boons).toEqual([chosen]);
    expect(state.offer).toEqual([]);
    expect(state.restLeft).toBeLessThanOrEqual(DAY.afterPick);
    expect(state.day).toBe(1);
    const later = run(state, DAY.afterPick + 0.1);
    expect(later).toContainEqual({ type: 'dayStart', day: 2, boss: false });
  });

  it('없는 자리를 고르면 아무 일도 없다', () => {
    const state = offering();
    const offer = [...state.offer];
    expect(step(state, DT, pick(7))).toEqual([]);
    expect(step(state, DT, pick(-1))).toEqual([]);
    expect(state.offer).toEqual(offer);
    expect(state.boons).toEqual([]);
    // 내놓은 것이 없을 때 고르는 것도 그렇다.
    const fresh = start();
    step(fresh, DT, pick(0));
    expect(fresh.boons).toEqual([]);
  });

  it('같은 판은 같은 강화를 내놓고, 뽑는 것이 벌레가 나오는 차례를 바꾸지 않는다', () => {
    const a = offering();
    const b = offering();
    expect(a.offer).toEqual(b.offer);
    const rng = a.rng;
    expect(drawOffer(a)).toEqual(a.offer);
    expect(a.rng).toBe(rng);
    // 날이 다르면 다른 것을 뽑기도 한다.
    const offers = new Set<string>();
    for (let day = 1; day <= 12; day += 1) offers.add(drawOffer({ ...a, day }).join());
    expect(offers.size).toBeGreaterThan(4);
  });

  it(`한 판에 ${BOON_PICKS}번까지만 고른다`, () => {
    const state = start({}, 1, 4);
    state.stats = { ...state.stats, damage: 1e6, fenceMax: 1e6 };
    state.fence = 1e6;
    let offers = 0;
    for (let time = 0; time < 900 && state.day <= BOON_PICKS + 2; time += DT) {
      for (const event of step(state, DT, pick(0))) if (event.type === 'offer') offers += 1;
    }
    expect(state.day).toBeGreaterThan(BOON_PICKS + 2);
    expect(offers).toBe(BOON_PICKS);
    expect(state.boons).toHaveLength(BOON_PICKS);
    expect(picksLeft(state)).toBe(0);
    expect(drawOffer(state)).toEqual([]);
  });

  it('다 고른 강화와 붙을 데가 없는 강화는 내놓지 않는다', () => {
    const state = start();
    // 해바라기와 물벼락이 없으면 그것을 키우는 강화는 나오지 않는다.
    expect(canOffer(state, 'bloom')).toBe(false);
    expect(canOffer(state, 'cloud')).toBe(false);
    const equipped = start({ helper: 1, storm: 1 });
    expect(canOffer(equipped, 'bloom')).toBe(true);
    expect(canOffer(equipped, 'cloud')).toBe(true);
    // 급한 수리는 울타리가 깎였을 때만 나온다.
    expect(canOffer(state, 'patch')).toBe(false);
    state.fence = state.stats.fenceMax * (BOON_STEP.patch.below - 0.01);
    expect(canOffer(state, 'patch')).toBe(true);
    // 다 고른 것은 빠진다.
    expect(canOffer(state, 'lance')).toBe(true);
    state.boons = ['lance'];
    expect(canOffer(state, 'lance')).toBe(false);
    for (let day = 1; day <= 40; day += 1) {
      const offer = drawOffer({ ...state, day });
      expect(offer).not.toContain('lance');
      expect(offer).not.toContain('bloom');
      expect(offer).not.toContain('cloud');
    }
  });

  it('무게가 큰 강화가 더 자주 나오고, 나올 수 있는 것은 모두 나온다', () => {
    const state = start({ helper: 1, storm: 1 });
    state.fence = state.stats.fenceMax * 0.5;
    const seen = new Map<BoonId, number>();
    for (let seed = 1; seed <= 400; seed += 1) {
      for (const id of drawOffer({ ...state, rng: seed * 7919 })) seen.set(id, (seen.get(id) ?? 0) + 1);
    }
    for (const id of BOON_ORDER) expect(seen.get(id) ?? 0, id).toBeGreaterThan(0);
    expect(seen.get('jet')!).toBeGreaterThan(seen.get('lance')! * 1.5);
  });

  it('강화마다 적힌 대로 판의 능력치가 바뀐다', () => {
    const levels: Levels = { helper: 1, storm: 1, splash: 1, chill: 1, thorn: 1 };
    const after = (id: BoonId, change?: (state: RunState) => void): { before: RunState; state: RunState } => {
      const state = start(levels);
      change?.(state);
      const before = structuredClone(state);
      applyBoon(state, id);
      expect(state.boons).toEqual([id]);
      return { before, state };
    };
    let result = after('jet');
    expect(result.state.stats.damage).toBeCloseTo(result.before.stats.damage * 1.12, 5);
    result = after('quick');
    expect(result.before.stats.interval / result.state.stats.interval).toBeCloseTo(1.1, 5);
    result = after('needle');
    expect(result.state.stats.critChance).toBeCloseTo(result.before.stats.critChance + 0.08, 5);
    result = after('lance');
    expect(result.state.stats.pierce).toBe(result.before.stats.pierce + 1);
    result = after('spray');
    expect(result.state.stats.splashRadius).toBeGreaterThan(result.before.stats.splashRadius);
    expect(result.state.stats.splashRatio).toBeGreaterThan(result.before.stats.splashRatio);
    result = after('frost');
    expect(result.state.stats.chill).toBeGreaterThan(result.before.stats.chill);
    result = after('plank');
    expect(result.state.stats.fenceMax).toBe(Math.round(result.before.stats.fenceMax * 1.2));
    expect(result.state.fence - result.before.fence).toBe(result.state.stats.fenceMax - result.before.stats.fenceMax);
    result = after('patch', (state) => (state.fence = state.stats.fenceMax * 0.2));
    expect(result.state.fence).toBeCloseTo(result.state.stats.fenceMax * 0.7, 5);
    result = after('patch', (state) => (state.fence = state.stats.fenceMax * 0.7));
    expect(result.state.fence).toBe(result.state.stats.fenceMax);
    result = after('bramble');
    expect(result.state.stats.thorns).toBeGreaterThan(result.before.stats.thorns);
    result = after('bloom');
    expect(result.state.stats.helperDamage).toBeCloseTo(result.before.stats.helperDamage * 1.3, 5);
    result = after('cloud', (state) => (state.stormIn = 20));
    expect(result.state.stats.stormCooldown).toBeCloseTo(result.before.stats.stormCooldown * 0.75, 5);
    expect(result.state.stormIn).toBeCloseTo(15, 5);
    result = after('sack');
    expect(result.state.stats.seedMult).toBeCloseTo(result.before.stats.seedMult * 1.25, 5);
  });

  it('물보라와 찬물이 없던 판에서는 그 강화가 처음 것을 준다', () => {
    const state = start();
    expect(state.stats.splashRadius).toBe(0);
    applyBoon(state, 'spray');
    expect(state.stats.splashRadius).toBe(BOON_STEP.spray.radius);
    expect(state.stats.splashRatio).toBe(BOON_STEP.spray.ratio);
    applyBoon(state, 'frost');
    expect(state.stats.chill).toBe(BOON_STEP.frost.slow);
    expect(state.stats.chillSeconds).toBe(BOON_STEP.frost.seconds);
    for (let times = 0; times < 20; times += 1) applyBoon(state, 'frost');
    expect(state.stats.chill).toBe(BOON_STEP.frost.max);
    expect(boonCount(state.boons, 'frost')).toBe(21);
  });

  it('고른 만큼 벌레도 세진다: 그 판에서 지킨 날마다 체력이 더 붙고, 고를 수 있는 횟수에서 멈춘다', () => {
    expect(heatScale(0)).toBe(1);
    expect(heatScale(3)).toBeCloseTo(BOON_HEAT ** 3, 9);
    expect(heatScale(BOON_PICKS + 5)).toBeCloseTo(BOON_HEAT ** BOON_PICKS, 9);
    // 6일째에서 시작한 판의 8일째(이틀을 지켰다)에 나온 벌레
    const state = start({}, 6);
    state.stats = { ...state.stats, damage: 1e6 };
    for (let time = 0; time < 300 && state.day < 8; time += DT) step(state, DT, pick(0));
    expect(state.day).toBe(8);
    state.stats = { ...state.stats, damage: 0 };
    state.shots = [];
    for (let time = 0; time < 30 && state.enemies.length === 0; time += DT) step(state, DT);
    const bug = state.enemies[0];
    expect(bug.maxHp).toBeCloseTo(ENEMIES[bug.kind].hp * hpScale(8) * BOON_HEAT ** 2, 5);
    // 같은 8일째라도 그날에서 시작한 판은 그대로다.
    const fresh = start({}, 8);
    for (let time = 0; time < 30 && fresh.enemies.length === 0; time += DT) step(fresh, DT);
    expect(fresh.enemies[0].maxHp).toBeCloseTo(ENEMIES[fresh.enemies[0].kind].hp * hpScale(8), 5);
  });

  it('자동 플레이는 울타리가 많이 깎였으면 고치고, 아니면 물총이 세지는 것부터 고른다', () => {
    const state = start();
    expect(botPick(state)).toBeUndefined();
    state.offer = ['sack', 'patch', 'jet'];
    expect(botPick(state)).toBe(2);
    state.fence = state.stats.fenceMax * 0.3;
    expect(botPick(state)).toBe(1);
    expect(botPick(state, 'first')).toBe(0);
  });

  it('강화마다 이름과 설명, 빌려 쓸 그림이 있다', () => {
    expect([...BOON_ORDER].sort()).toEqual(Object.keys(BOONS).sort());
    expect(new Set(BOON_ORDER.map((id) => BOONS[id].icon)).size).toBe(BOON_ORDER.length);
    for (const id of BOON_ORDER) {
      const boon = BOONS[id];
      expect(boon.name.length, id).toBeGreaterThan(0);
      expect(boon.name.length, id).toBeLessThanOrEqual(7);
      // 고르는 카드에 한 줄로 들어가야 한다.
      expect(boon.blurb.length, id).toBeLessThanOrEqual(18);
      expect(UPGRADES).toHaveProperty(boon.icon);
      expect(boon.max, id).toBeGreaterThanOrEqual(1);
      expect(boon.weight, id).toBeGreaterThan(0);
    }
    // 늘 나올 수 있는 강화만으로도 고를 수 있는 횟수를 채우고 남는다.
    const always = BOON_ORDER.filter((id) => !['patch', 'bloom', 'cloud'].includes(id));
    expect(always.reduce((sum, id) => sum + BOONS[id].max, 0)).toBeGreaterThanOrEqual(BOON_PICKS + BOON_CHOICES);
  });
});
