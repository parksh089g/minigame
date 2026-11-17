import { describe, expect, it } from 'vitest';
import {
  baseOf,
  buy,
  buyBlock,
  CHARMS,
  charmOf,
  discard,
  drawOffers,
  hitChance,
  isUpgraded,
  newRun,
  nextSpinTimes,
  oddsOf,
  ownsCharm,
  REFUND_RATE,
  refundOf,
  REROLL_COST,
  spinsOf,
  upgrade,
  upgradeBlock,
  upgradeCostOf,
  upgradedOf,
  valuesOf,
  type RunState,
} from './rules';

function shopping(coin: number, charms: string[], offers: (string | null)[] = [null, null, null]): RunState {
  return { ...newRun(), phase: 'shop', spinsLeft: 0, coin, charms, shop: { offers, rerollCost: REROLL_COST } };
}

describe('부적 강화', () => {
  it('강화한 부적의 id는 원래 id에 표시가 붙은 것이고, 같은 부적으로 친다', () => {
    expect(upgradedOf('twins')).toBe('twins+');
    expect(upgradedOf('twins+')).toBe('twins+');
    expect(baseOf('twins+')).toBe('twins');
    expect(baseOf('twins')).toBe('twins');
    expect(isUpgraded('twins+')).toBe(true);
    expect(isUpgraded('twins')).toBe(false);
    expect(ownsCharm(['twins+'], 'twins')).toBe(true);
    expect(ownsCharm(['twins'], 'twins+')).toBe(true);
    expect(ownsCharm(['crown'], 'twins')).toBe(false);
  });

  it('부적마다 강화한 것이 있고, 이름과 갈래와 값은 그대로이며 효과는 같은 종류다', () => {
    for (const charm of CHARMS) {
      const strong = charmOf(upgradedOf(charm.id));
      expect(strong, charm.id).toBeDefined();
      if (!strong) continue;
      expect(strong.name).toBe(charm.name);
      expect(strong.kind).toBe(charm.kind);
      expect(strong.price).toBe(charm.price);
      expect(strong.description).toBe(charm.upgrade.description);
      expect(Object.keys(strong.effect), charm.id).toEqual(Object.keys(charm.effect));
      expect(strong.description, charm.id).not.toBe(charm.description);
    }
    expect(charmOf('no-such-charm+')).toBeUndefined();
    expect(charmOf('twins++')).toBeUndefined();
  });

  it('강화하면 확률, 상금, 스핀 수가 강화한 효과대로 바뀐다', () => {
    const cherry = 0;
    expect(oddsOf(['more-cherry+'])[cherry]).toBeGreaterThan(oddsOf(['more-cherry'])[cherry]);
    expect(valuesOf(['gold-cherry+'])[cherry]).toBeGreaterThan(valuesOf(['gold-cherry'])[cherry]);
    expect(spinsOf(['extra+'])).toBeGreaterThan(spinsOf(['extra']));
  });

  it('가게에서 금화를 내고 한 번만 강화한다', () => {
    const cost = upgradeCostOf('wide');
    expect(cost).toBeGreaterThan(0);
    expect(upgradeCostOf('wide+')).toBe(cost);
    const run = shopping(cost + 2, ['piggy', 'wide']);
    expect(upgradeBlock(run, 1)).toBeNull();
    const next = upgrade(run, 1);
    expect(next.charms).toEqual(['piggy', 'wide+']);
    expect(next.coin).toBe(2);
    // 강화로는 점수가 바뀌지 않는다.
    expect(next.earned).toBe(run.earned);
    // 한 번 강화한 부적은 다시 강화할 수 없다.
    expect(upgradeBlock(next, 1)).toBe('done');
    expect(upgrade(next, 1)).toBe(next);
  });

  it('금화가 모자라거나, 가게가 아니거나, 빈 자리면 강화할 수 없다', () => {
    const poor = shopping(upgradeCostOf('wide') - 1, ['wide']);
    expect(upgradeBlock(poor, 0)).toBe('coin');
    expect(upgrade(poor, 0)).toBe(poor);
    expect(upgradeBlock(poor, 3)).toBe('none');
    const spinning: RunState = { ...newRun(), coin: 99, charms: ['wide'] };
    expect(upgradeBlock(spinning, 0)).toBe('closed');
    expect(upgrade(spinning, 0)).toBe(spinning);
  });

  it('강화한 부적은 가게에 다시 나오지 않고, 다시 살 수도 없다', () => {
    const owned = ['twins+', 'piggy'];
    let n = 0;
    const random = (): number => ((n += 1) * 0.618) % 1;
    for (let round = 0; round < 200; round += 1) {
      for (const id of drawOffers(owned, random)) {
        expect(isUpgraded(id)).toBe(false);
        expect(id).not.toBe('twins');
        expect(id).not.toBe('piggy');
      }
    }
    const run = shopping(99, ['twins+'], ['twins', 'wide', null]);
    expect(buyBlock(run, 0)).toBe('sold');
    expect(buy(run, 0)).toBe(run);
    expect(buy(run, 1).charms).toEqual(['twins+', 'wide']);
  });
});

describe('뗄 때 돌려받는 금화', () => {
  it('치른 값의 정해진 몫을 돌려받고, 강화한 값도 같이 친다', () => {
    for (const charm of CHARMS) {
      expect(refundOf(charm.id)).toBe(Math.floor(charm.price * REFUND_RATE));
      expect(refundOf(upgradedOf(charm.id))).toBe(Math.floor((charm.price + upgradeCostOf(charm.id)) * REFUND_RATE));
      // 사서 바로 떼거나, 강화해서 바로 떼어도 남는 것이 없다.
      expect(refundOf(charm.id)).toBeLessThan(charm.price);
      expect(refundOf(upgradedOf(charm.id))).toBeLessThan(charm.price + upgradeCostOf(charm.id));
    }
    expect(refundOf('no-such-charm')).toBe(0);
  });

  it('떼면 그만큼 금화가 늘고 점수는 그대로다', () => {
    const run = shopping(5, ['twins', 'wide+']);
    const freed = discard(run, 1);
    expect(freed.charms).toEqual(['twins']);
    expect(freed.coin).toBe(5 + refundOf('wide+'));
    expect(freed.earned).toBe(run.earned);
  });
});

describe('다음 스핀에 걸린 곱', () => {
  const spinning = (over: Partial<RunState>): RunState => ({ ...newRun(), ...over });

  it('걸린 것이 없으면 1이다', () => {
    expect(nextSpinTimes(newRun())).toBe(1);
    expect(nextSpinTimes(spinning({ charms: ['finale', 'rebound'], spinsLeft: 3, afterMiss: false }))).toBe(1);
    expect(nextSpinTimes(spinning({ afterMiss: true, spinsLeft: 1 }))).toBe(1);
  });

  it('마지막 스핀에는 막판 한 방이, 꽝 다음에는 오뚝이가 걸리고, 둘이 겹치면 곱해진다', () => {
    const last = charmOf('finale')!.effect.lastTimes!;
    const rebound = charmOf('rebound')!.effect.reboundTimes!;
    const charms = ['finale', 'rebound'];
    expect(nextSpinTimes(spinning({ charms, spinsLeft: 1 }))).toBe(last);
    expect(nextSpinTimes(spinning({ charms, spinsLeft: 3, afterMiss: true }))).toBe(rebound);
    expect(nextSpinTimes(spinning({ charms, spinsLeft: 1, afterMiss: true }))).toBe(last * rebound);
  });

  it('돌릴 수 없는 때에는 1이다', () => {
    const charms = ['finale'];
    expect(nextSpinTimes(spinning({ charms, spinsLeft: 0 }))).toBe(1);
    expect(nextSpinTimes(spinning({ charms, spinsLeft: 1, phase: 'shop' }))).toBe(1);
  });
});

describe('줄이 맞을 확률', () => {
  it('부적이 없을 때의 값은 그림마다 맞을 확률을 더한 것이고, 0과 1 사이다', () => {
    const base = hitChance([]);
    expect(base).toBeGreaterThan(0);
    expect(base).toBeLessThan(1);
  });

  it('한 그림을 늘리면 오르고, 강화하면 더 오른다', () => {
    expect(hitChance(['more-cherry'])).toBeGreaterThan(hitChance([]));
    expect(hitChance(['more-cherry+'])).toBeGreaterThan(hitChance(['more-cherry']));
    expect(hitChance(['more-seven'])).toBeGreaterThan(hitChance([]));
  });

  it('상금이나 줄의 부적은 확률을 바꾸지 않는다', () => {
    expect(hitChance(['gold-cherry', 'wide', 'twins'])).toBe(hitChance([]));
  });
});
