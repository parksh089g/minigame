import { describe, expect, it } from 'vitest';
import {
  CHARMS,
  cleanRelics,
  discard,
  interestFor,
  newRun,
  REFUND_RATE,
  refundOf,
  RELIC_IDS,
  RELIC_MAX,
  RELIC_STEP,
  relicLevel,
  REROLL_COST,
  settleRound,
  targetFor,
  targetOf,
  upgrade,
  upgradeCostOf,
  upgradedOf,
  type RelicLevels,
  type RunState,
} from './rules';

const steady = (): number => 0.37;
const FULL: RelicLevels = Object.fromEntries(RELIC_IDS.map((id) => [id, RELIC_MAX]));
const withRelics = (relics: RelicLevels): Pick<RunState, 'relics'> => ({ relics });

describe('유물이 판에서 하는 일', () => {
  it('유물이 없으면 여느 판 그대로다', () => {
    const run = newRun();
    expect(run.relics).toEqual({});
    for (let round = 1; round <= 16; round += 1) expect(targetFor(run, round)).toBe(targetOf(round));
    expect(interestFor(500, run)).toBe(0);
    for (const charm of CHARMS) {
      expect(upgradeCostOf(charm.id, run)).toBe(upgradeCostOf(charm.id));
      expect(refundOf(charm.id, run)).toBe(refundOf(charm.id));
      expect(refundOf(upgradedOf(charm.id), run)).toBe(refundOf(upgradedOf(charm.id)));
    }
  });

  it('단계는 0에서 RELIC_MAX까지의 정수로만 본다', () => {
    expect(relicLevel(withRelics({ scale: 3 }), 'scale')).toBe(3);
    expect(relicLevel(withRelics({ scale: 3 }), 'jar')).toBe(0);
    expect(relicLevel(withRelics({ scale: 99 }), 'scale')).toBe(RELIC_MAX);
    expect(relicLevel(withRelics({ scale: -2 }), 'scale')).toBe(0);
    expect(relicLevel(withRelics({ scale: 2.9 }), 'scale')).toBe(2);
    expect(relicLevel(withRelics({ scale: Number.NaN }), 'scale')).toBe(0);
    expect(relicLevel(undefined, 'scale')).toBe(0);
    expect(cleanRelics({ scale: 0, seal: 4, jar: 50, nope: 3 } as RelicLevels)).toEqual({ seal: 4, jar: RELIC_MAX });
  });

  it('판을 시작할 때의 단계가 판에 적히고, 정해진 운의 판(오늘의 판)에는 듣지 않는다', () => {
    expect(newRun(null, [], { scale: 2, hammer: 0 }).relics).toEqual({ scale: 2 });
    const daily = newRun('candy-slot:daily:1', [], FULL);
    expect(daily.relics).toEqual({});
    expect(targetFor(daily, 8)).toBe(targetOf(8));
  });

  it('낡은 저울: 목표가 단계마다 조금씩 낮아지고, 다 올려도 스무 번에 한 번쯤만큼만 낮다', () => {
    for (let round = 1; round <= 16; round += 1) {
      let last = targetOf(round);
      for (let level = 1; level <= RELIC_MAX; level += 1) {
        const target = targetFor(withRelics({ scale: level }), round);
        expect(target).toBeLessThanOrEqual(last);
        expect(target).toBeGreaterThanOrEqual(1);
        last = target;
      }
      const cut = (RELIC_STEP.scale * RELIC_MAX) / 1000;
      expect(last).toBe(Math.ceil(targetOf(round) * (1 - cut)));
      expect(last).toBeGreaterThanOrEqual(targetOf(round) * 0.9);
    }
    // 큰 목표에서는 한 단계가 눈에 보인다.
    expect(targetFor(withRelics({ scale: 1 }), 12)).toBeLessThan(targetOf(12));
  });

  it('낡은 저울로 낮아진 목표만큼만 내고 라운드를 넘긴다', () => {
    const relics = { scale: RELIC_MAX };
    const target = targetFor(withRelics(relics), 8);
    expect(target).toBeLessThan(targetOf(8));
    const done: RunState = { ...newRun(null, [], relics), round: 8, spinsLeft: 0, coin: target };
    const settled = settleRound(done, steady);
    expect(settled?.cleared).toBe(true);
    expect(settled?.paid).toBe(target);
    expect(settled?.run.coin).toBe(0);
    // 유물이 없으면 같은 금화로는 넘기지 못한다.
    expect(settleRound({ ...done, relics: {} }, steady)?.cleared).toBe(false);
  });

  it('금화 항아리: 라운드를 넘길 때 남은 금화의 얼마쯤을 덤으로 받고, 점수에도 든다', () => {
    const relics = { jar: RELIC_MAX };
    expect(interestFor(0, withRelics(relics))).toBe(0);
    expect(interestFor(-5, withRelics(relics))).toBe(0);
    expect(interestFor(100, withRelics({ jar: 1 }))).toBe(Math.floor((100 * RELIC_STEP.jar) / 1000));
    expect(interestFor(200, withRelics(relics))).toBe(Math.floor((200 * RELIC_STEP.jar * RELIC_MAX) / 1000));
    // 다 올려도 남은 금화의 열에 하나를 넘지 않는다.
    expect(interestFor(1000, withRelics(relics))).toBeLessThanOrEqual(100);

    const done: RunState = { ...newRun(null, [], relics), spinsLeft: 0, coin: targetOf(1) + 200, earned: 300 };
    const settled = settleRound(done, steady)!;
    const interest = interestFor(200, withRelics(relics));
    expect(interest).toBeGreaterThan(0);
    expect(settled.interest).toBe(interest);
    expect(settled.savings).toBe(0);
    expect(settled.run.coin).toBe(200 + interest);
    expect(settled.run.earned).toBe(300 + interest);
  });

  it('대장장이 망치: 강화하는 값이 단계마다 조금씩 싸지고, 공짜가 되지는 않는다', () => {
    for (const charm of CHARMS) {
      let last = upgradeCostOf(charm.id);
      for (let level = 1; level <= RELIC_MAX; level += 1) {
        const cost = upgradeCostOf(charm.id, withRelics({ hammer: level }));
        expect(cost).toBeLessThanOrEqual(last);
        expect(cost).toBeGreaterThanOrEqual(1);
        last = cost;
      }
      expect(last).toBeGreaterThanOrEqual(upgradeCostOf(charm.id) * 0.7);
    }
    const relics = { hammer: RELIC_MAX };
    const cost = upgradeCostOf('finale', withRelics(relics));
    expect(cost).toBeLessThan(upgradeCostOf('finale'));
    const shop: RunState = {
      ...newRun(null, [], relics),
      phase: 'shop',
      spinsLeft: 0,
      coin: cost,
      charms: ['finale'],
      shop: { offers: [], rerollCost: REROLL_COST },
    };
    const next = upgrade(shop, 0);
    expect(next.charms).toEqual(['finale+']);
    expect(next.coin).toBe(0);
  });

  it('상인의 도장: 뗄 때 돌려받는 몫이 단계마다 조금씩 늘고, 그래도 치른 값보다는 적다', () => {
    for (const relics of [{ seal: RELIC_MAX }, FULL]) {
      const run = withRelics(relics);
      for (const charm of CHARMS) {
        const strong = upgradedOf(charm.id);
        expect(refundOf(charm.id, run)).toBeGreaterThanOrEqual(refundOf(charm.id));
        expect(refundOf(charm.id, run)).toBeLessThan(charm.price);
        expect(refundOf(strong, run)).toBeLessThan(charm.price + upgradeCostOf(charm.id, run));
      }
    }
    const percent = Math.round(REFUND_RATE * 100) + RELIC_STEP.seal * RELIC_MAX;
    expect(percent).toBeLessThan(100);
    expect(refundOf('twins', withRelics({ seal: RELIC_MAX }))).toBe(
      Math.floor((CHARMS.find((charm) => charm.id === 'twins')!.price * percent) / 100),
    );

    const relics = { seal: RELIC_MAX };
    const shop: RunState = {
      ...newRun(null, [], relics),
      phase: 'shop',
      spinsLeft: 0,
      coin: 5,
      charms: ['twins'],
      shop: { offers: [], rerollCost: REROLL_COST },
    };
    expect(discard(shop, 0).coin).toBe(5 + refundOf('twins', shop));
    expect(refundOf('twins', shop)).toBeGreaterThan(refundOf('twins'));
  });
});
