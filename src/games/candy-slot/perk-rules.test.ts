import { describe, expect, it } from 'vitest';
import {
  buyBlock,
  canHold,
  CHARMS,
  firstRerollCost,
  HOLDS_PER_ROUND,
  holdsOf,
  layoutFor,
  newRun,
  nextRound,
  PERK_IDS,
  PERK_PURSE,
  reroll,
  REROLL_COST,
  REROLL_STEP,
  settleRound,
  SLOTS,
  SLOTS_MAX,
  slotsOf,
  spin,
  START_COIN,
  targetOf,
  type PerkId,
  type RunState,
} from './rules';

const ALL: readonly PerkId[] = PERK_IDS;
const steady = (): number => 0.37;

describe('영구 해금이 판에서 하는 일', () => {
  it('해금이 없으면 여느 판 그대로다', () => {
    const run = newRun();
    expect(run.perks).toEqual([]);
    expect(run.coin).toBe(START_COIN);
    expect(run.holdsLeft).toBe(HOLDS_PER_ROUND);
    expect(slotsOf(run)).toBe(SLOTS);
    expect(holdsOf(run)).toBe(HOLDS_PER_ROUND);
    expect(firstRerollCost(run)).toBe(REROLL_COST);
  });

  it('켜 둔 해금은 판에 적히고, 모르는 것과 겹친 것은 빠진다', () => {
    const run = newRun(null, ['slot', 'purse', 'slot', 'nope' as PerkId]);
    expect(run.perks).toEqual(['purse', 'slot']);
  });

  it('정해진 운의 판(오늘의 판)에는 해금이 듣지 않는다', () => {
    const run = newRun('candy-slot:daily:1', ALL);
    expect(run.perks).toEqual([]);
    expect(run.coin).toBe(START_COIN);
    expect(run.holdsLeft).toBe(HOLDS_PER_ROUND);
    expect(slotsOf(run)).toBe(SLOTS);
  });

  it('두둑한 시작: 금화를 더 들고 시작하고, 점수에는 들지 않는다', () => {
    const run = newRun(null, ['purse']);
    expect(run.coin).toBe(START_COIN + PERK_PURSE);
    expect(run.earned).toBe(0);
  });

  it('잠그기 한 번 더: 라운드마다 두 번 잠글 수 있다', () => {
    let run = newRun(null, ['hold']);
    expect(run.holdsLeft).toBe(HOLDS_PER_ROUND + 1);
    run = spin(run, steady)!.run;
    run = spin(run, steady, 0)!.run;
    expect(run.holdsLeft).toBe(HOLDS_PER_ROUND);
    expect(canHold(run)).toBe(true);
    run = spin(run, steady, 1)!.run;
    expect(run.holdsLeft).toBe(0);
    expect(canHold(run)).toBe(false);
    // 다음 라운드에는 다시 채워진다.
    const shop: RunState = { ...run, phase: 'shop', spinsLeft: 0, shop: { offers: [], rerollCost: REROLL_COST } };
    expect(nextRound(shop).holdsLeft).toBe(HOLDS_PER_ROUND + 1);
  });

  it('첫 다시 뽑기 공짜: 가게마다 첫 번은 공짜이고, 그다음은 여느 값부터 오른다', () => {
    const done: RunState = { ...newRun(null, ['reroll']), spinsLeft: 0, coin: targetOf(1) };
    const settled = settleRound(done, steady);
    expect(settled?.cleared).toBe(true);
    let run = settled!.run;
    expect(run.shop?.rerollCost).toBe(0);
    const coin = run.coin;
    run = reroll(run, steady);
    expect(run.coin).toBe(coin);
    expect(run.shop?.rerollCost).toBe(REROLL_COST);
    run = { ...run, coin: REROLL_COST };
    run = reroll(run, steady);
    expect(run.coin).toBe(0);
    expect(run.shop?.rerollCost).toBe(REROLL_COST + REROLL_STEP);
  });

  it('여섯째 자리: 한 장을 더 붙일 수 있다', () => {
    const five = CHARMS.slice(0, SLOTS).map((charm) => charm.id);
    const offer = CHARMS[SLOTS].id;
    const shop = (perks: PerkId[], charms: string[]): RunState => ({
      ...newRun(null, perks),
      phase: 'shop',
      spinsLeft: 0,
      coin: 99,
      charms,
      shop: { offers: [offer, null, null], rerollCost: REROLL_COST },
    });
    expect(buyBlock(shop([], five), 0)).toBe('full');
    expect(slotsOf(shop(['slot'], five))).toBe(SLOTS_MAX);
    expect(buyBlock(shop(['slot'], five), 0)).toBeNull();
    expect(buyBlock(shop(['slot'], [...five, CHARMS[SLOTS + 1].id]), 0)).toBe('full');
  });

  it('자리가 여섯이어도 부적 줄이 화면 안에 들어간다', () => {
    for (const height of [400 - 38, 426 - 38, 520 - 38]) {
      const area = { x: 0, y: 38, width: 240, height };
      const five = layoutFor(area);
      const six = layoutFor(area, SLOTS_MAX);
      expect(five.slots).toHaveLength(SLOTS);
      expect(six.slots).toHaveLength(SLOTS_MAX);
      expect(six.slots[0].x).toBeGreaterThanOrEqual(0);
      expect(six.slots[SLOTS_MAX - 1].x + six.slotSize).toBeLessThanOrEqual(240);
      // 자리의 수는 부적 줄만 바꾼다.
      expect({ ...six, slots: [] }).toEqual({ ...five, slots: [] });
    }
  });
});
