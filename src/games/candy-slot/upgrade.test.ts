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
  isMaxed,
  isUpgraded,
  levelOf,
  MIN_WEIGHT,
  newRun,
  nextSpinTimes,
  oddsOf,
  ownsCharm,
  paidFor,
  REFUND_RATE,
  refundOf,
  REROLL_COST,
  spinsOf,
  SYMBOLS,
  upgrade,
  upgradeBlock,
  UPGRADE_MAX,
  UPGRADE_RATES,
  upgradeCostOf,
  upgradedOf,
  valuesOf,
  weightsOf,
  type RunState,
} from './rules';

function shopping(coin: number, charms: string[], offers: (string | null)[] = [null, null, null]): RunState {
  return { ...newRun(), phase: 'shop', spinsLeft: 0, coin, charms, shop: { offers, rerollCost: REROLL_COST } };
}

describe('부적 강화', () => {
  it('강화한 부적의 id는 원래 id에 표시가 붙은 것이고, 같은 부적으로 친다', () => {
    expect(upgradedOf('twins')).toBe('twins+');
    expect(upgradedOf('twins+')).toBe('twins++');
    expect(upgradedOf('twins++')).toBe('twins+++');
    // 끝까지 강화한 것은 그대로다.
    expect(upgradedOf('twins+++')).toBe('twins+++');
    expect(baseOf('twins+')).toBe('twins');
    expect(baseOf('twins+++')).toBe('twins');
    expect(baseOf('twins')).toBe('twins');
    expect([levelOf('twins'), levelOf('twins+'), levelOf('twins++'), levelOf('twins+++')]).toEqual([0, 1, 2, 3]);
    expect(isUpgraded('twins+')).toBe(true);
    expect(isUpgraded('twins++')).toBe(true);
    expect(isUpgraded('twins')).toBe(false);
    expect([isMaxed('twins'), isMaxed('twins++'), isMaxed('twins+++')]).toEqual([false, false, true]);
    expect(ownsCharm(['twins+'], 'twins')).toBe(true);
    expect(ownsCharm(['twins'], 'twins+')).toBe(true);
    expect(ownsCharm(['twins+++'], 'twins')).toBe(true);
    expect(ownsCharm(['crown'], 'twins')).toBe(false);
  });

  it('부적마다 단계마다 강화한 것이 있고, 이름과 갈래와 값은 그대로이며 효과는 같은 종류다', () => {
    expect(UPGRADE_MAX).toBe(3);
    for (const charm of CHARMS) {
      expect(charm.upgrades.length, charm.id).toBe(UPGRADE_MAX);
      const seen = [charm.description];
      let id = charm.id;
      for (const step of charm.upgrades) {
        id = upgradedOf(id);
        const strong = charmOf(id);
        expect(strong, id).toBeDefined();
        if (!strong) continue;
        expect(strong.id).toBe(id);
        expect(strong.name).toBe(charm.name);
        expect(strong.kind).toBe(charm.kind);
        expect(strong.price).toBe(charm.price);
        expect(strong.description).toBe(step.description);
        expect(strong.effect).toEqual(step.effect);
        expect(Object.keys(strong.effect), id).toEqual(Object.keys(charm.effect));
        // 단계마다 설명이 다르다.
        expect(seen, id).not.toContain(strong.description);
        seen.push(strong.description);
      }
      expect(levelOf(id)).toBe(UPGRADE_MAX);
    }
    expect(charmOf('no-such-charm+')).toBeUndefined();
    expect(charmOf('twins+++')).toBeDefined();
    expect(charmOf('twins++++')).toBeUndefined();
  });

  it('강화한 효과는 같은 그림과 같은 줄에 듣고, 단계가 오를 때마다 앞 단계보다 세다', () => {
    for (const charm of CHARMS) {
      const steps = [charm.effect, ...charm.upgrades.map((step) => step.effect)];
      for (let level = 1; level < steps.length; level += 1) {
        const plain = steps[level - 1];
        const strong = steps[level];
        const label = `${charm.id} ${level}단계`;
        // [가리키는 것(그림이나 줄의 갈래, 줄의 수), 세기]로 견준다.
        const pairs: Array<[readonly [unknown, number] | undefined, readonly [unknown, number] | undefined]> = [
          [plain.weight, strong.weight],
          [plain.value, strong.value],
          [plain.lineTimes, strong.lineTimes],
          [plain.combo, strong.combo],
          [plain.comboExact, strong.comboExact],
        ];
        for (const [before, after] of pairs) {
          if (!before || !after) continue;
          expect(after[0], label).toBe(before[0]);
          expect(Math.sign(after[1]), label).toBe(Math.sign(before[1]));
          expect(Math.abs(after[1]), label).toBeGreaterThan(Math.abs(before[1]));
        }
        const amounts: Array<[number | undefined, number | undefined]> = [
          [plain.spins, strong.spins],
          [plain.consolation, strong.consolation],
          [plain.lastTimes, strong.lastTimes],
          [plain.reboundTimes, strong.reboundTimes],
          [plain.centerWild, strong.centerWild],
          [plain.savingsCap, strong.savingsCap],
        ];
        for (const [before, after] of amounts) {
          if (before === undefined || after === undefined) continue;
          expect(after, label).toBeGreaterThan(before);
        }
      }
    }
  });

  it('덜기 부적은 끝까지 강화해도 그림의 무게가 바닥 밑으로 내려가지 않고, 단계마다 실제로 덜 나온다', () => {
    for (const charm of CHARMS) {
      if (!charm.effect.weight || charm.effect.weight[1] >= 0) continue;
      const symbol = charm.effect.weight[0];
      let id = charm.id;
      let before = weightsOf([id])[symbol];
      for (let level = 1; level <= UPGRADE_MAX; level += 1) {
        id = upgradedOf(id);
        const after = weightsOf([id])[symbol];
        expect(after, id).toBeLessThan(before);
        expect(after, id).toBeGreaterThanOrEqual(MIN_WEIGHT);
        // 깎는 만큼이 그대로 듣는다(바닥에 걸려 버려지는 몫이 없다).
        expect(after, id).toBe(SYMBOLS[symbol].weight + charmOf(id)!.effect.weight![1]);
        before = after;
      }
    }
  });

  it('설명에 적힌 수는 효과의 수와 같다(강화한 설명도)', () => {
    const counts: Record<number, string> = { 2: '두', 3: '세', 4: '네', 5: '다섯', 6: '여섯', 7: '일곱', 8: '여덟', 9: '아홉', 10: '열' };
    const times = (value: number): string => `${counts[value]} 배`;
    const lineWord = { row: '가로줄', col: '세로줄', diag: '대각선' } as const;
    for (const charm of CHARMS) {
      for (const { description, effect } of [charm, ...charm.upgrades]) {
        const label = `${charm.id}: ${description}`;
        if (effect.value) expect(description, label).toContain(`+${effect.value[1]}`);
        // 곱하는 값은 모두 정수다. 금화가 반 개가 되는 일이 없다.
        for (const value of [effect.lineTimes?.[1], effect.combo?.[1], effect.comboExact?.[1], effect.lastTimes, effect.reboundTimes]) {
          if (value !== undefined) expect(Number.isInteger(value), label).toBe(true);
        }
        if (effect.lineTimes) {
          expect(description, label).toContain(lineWord[effect.lineTimes[0]]);
          expect(description.endsWith(times(effect.lineTimes[1])), label).toBe(true);
        }
        if (effect.combo) {
          expect(description, label).toContain(`${counts[effect.combo[0]]} 줄 이상`);
          expect(description.endsWith(times(effect.combo[1])), label).toBe(true);
        }
        if (effect.comboExact) {
          expect(description, label).toContain(`딱 ${counts[effect.comboExact[0]]} 줄`);
          expect(description.endsWith(times(effect.comboExact[1])), label).toBe(true);
        }
        if (effect.lastTimes !== undefined) expect(description.endsWith(times(effect.lastTimes)), label).toBe(true);
        if (effect.reboundTimes !== undefined) expect(description.endsWith(times(effect.reboundTimes)), label).toBe(true);
        if (effect.spins !== undefined) expect(description, label).toContain(`${counts[effect.spins]} 번`);
        if (effect.consolation !== undefined) expect(description, label).toContain(`${effect.consolation}개`);
        if (effect.savingsCap !== undefined) expect(description, label).toContain(`${effect.savingsCap}까지`);
        if (effect.centerWild !== undefined) {
          // "셋에 한 번"은 셋에 하나쯤(0.3~0.4), "셋에 두 번"은 셋에 둘쯤(0.6~0.7)이다. "언제나"는 꼭 1이다.
          if (description.includes('언제나')) expect(effect.centerWild, label).toBe(1);
          const said = (
            [
              ['둘에 한 번', 1 / 2],
              ['셋에 한 번', 1 / 3],
              ['셋에 두 번', 2 / 3],
              ['넷에 한 번', 1 / 4],
              ['넷에 세 번', 3 / 4],
              ['거의 늘', 0.85],
              ['언제나', 1],
            ] as const
          ).find(([words]) => description.includes(words));
          expect(said, label).toBeDefined();
          expect(Math.abs(said![1] - effect.centerWild), label).toBeLessThan(0.05);
        }
      }
    }
  });

  it('강화하면 확률, 상금, 스핀 수가 강화한 효과대로 바뀐다', () => {
    const cherry = 0;
    expect(oddsOf(['more-cherry+'])[cherry]).toBeGreaterThan(oddsOf(['more-cherry'])[cherry]);
    expect(valuesOf(['gold-cherry+'])[cherry]).toBeGreaterThan(valuesOf(['gold-cherry'])[cherry]);
    expect(spinsOf(['extra+'])).toBeGreaterThan(spinsOf(['extra']));
    expect(oddsOf(['more-cherry+++'])[cherry]).toBeGreaterThan(oddsOf(['more-cherry++'])[cherry]);
    expect(oddsOf(['more-cherry++'])[cherry]).toBeGreaterThan(oddsOf(['more-cherry+'])[cherry]);
    expect(valuesOf(['gold-cherry+++'])[cherry]).toBeGreaterThan(valuesOf(['gold-cherry++'])[cherry]);
    expect(spinsOf(['extra+++'])).toBeGreaterThan(spinsOf(['extra++']));
  });

  it('가게에서 금화를 내고 한 단계씩, 세 단계까지 강화한다', () => {
    const costs = [upgradeCostOf('wide'), upgradeCostOf('wide+'), upgradeCostOf('wide++')];
    expect(costs[0]).toBeGreaterThan(0);
    let run = shopping(costs[0] + costs[1] + costs[2] + 2, ['piggy', 'wide']);
    const earned = run.earned;
    for (const [index, id] of ['wide+', 'wide++', 'wide+++'].entries()) {
      expect(upgradeBlock(run, 1)).toBeNull();
      const coin = run.coin;
      run = upgrade(run, 1);
      expect(run.charms).toEqual(['piggy', id]);
      expect(run.coin).toBe(coin - costs[index]);
    }
    expect(run.coin).toBe(2);
    // 강화로는 점수가 바뀌지 않는다.
    expect(run.earned).toBe(earned);
    // 끝까지 강화한 부적은 더 강화할 수 없다.
    expect(upgradeBlock(run, 1)).toBe('done');
    expect(upgrade(run, 1)).toBe(run);
    expect(upgradeCostOf('wide+++')).toBe(0);
  });

  it('강화하는 값은 단계마다 부적 값의 정해진 배수이고, 단계가 오를수록 훨씬 비싸다', () => {
    expect(UPGRADE_RATES.length).toBe(UPGRADE_MAX);
    for (const charm of CHARMS) {
      let id = charm.id;
      let last = charm.price;
      let paid = charm.price;
      for (let level = 0; level < UPGRADE_MAX; level += 1) {
        const cost = upgradeCostOf(id);
        expect(cost, id).toBe(Math.ceil(charm.price * UPGRADE_RATES[level]));
        // 한 단계 위는 앞 단계의 곱절을 넘는다.
        expect(cost, id).toBeGreaterThanOrEqual(last * 2);
        last = cost;
        paid += cost;
        id = upgradedOf(id);
        expect(paidFor(id), id).toBe(paid);
      }
      expect(upgradeCostOf(id), id).toBe(0);
    }
    expect(upgradeCostOf('no-such-charm')).toBe(0);
    expect(upgradeCostOf('twins++++')).toBe(0);
    expect(paidFor('no-such-charm')).toBe(0);
  });

  it('한 단계만 올린 부적도, 금화가 모자라면 다음 단계로 올릴 수 없다', () => {
    const run = shopping(upgradeCostOf('wide+') - 1, ['wide+']);
    expect(upgradeBlock(run, 0)).toBe('coin');
    expect(upgrade(run, 0)).toBe(run);
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
    const owned = ['twins++', 'piggy'];
    let n = 0;
    const random = (): number => ((n += 1) * 0.618) % 1;
    for (let round = 0; round < 200; round += 1) {
      for (const id of drawOffers(owned, random)) {
        expect(isUpgraded(id)).toBe(false);
        expect(id).not.toBe('twins');
        expect(id).not.toBe('piggy');
      }
    }
    const run = shopping(99, ['twins+++'], ['twins', 'wide', null]);
    expect(buyBlock(run, 0)).toBe('sold');
    expect(buy(run, 0)).toBe(run);
    expect(buy(run, 1).charms).toEqual(['twins+++', 'wide']);
  });
});

describe('뗄 때 돌려받는 금화', () => {
  it('치른 값의 정해진 몫을 돌려받고, 강화한 단계마다의 값도 같이 친다', () => {
    for (const charm of CHARMS) {
      expect(refundOf(charm.id)).toBe(Math.floor(charm.price * REFUND_RATE));
      // 사서 바로 떼어도 남는 것이 없다.
      expect(refundOf(charm.id)).toBeLessThan(charm.price);
      let id = charm.id;
      let paid = charm.price;
      for (let level = 0; level < UPGRADE_MAX; level += 1) {
        paid += upgradeCostOf(id);
        id = upgradedOf(id);
        expect(refundOf(id), id).toBe(Math.floor(paid * REFUND_RATE));
        // 강화해서 바로 떼어도 남는 것이 없다.
        expect(refundOf(id), id).toBeLessThan(paid);
      }
    }
    expect(refundOf('no-such-charm')).toBe(0);
    expect(refundOf('twins++++')).toBe(0);
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
