import { describe, expect, it } from 'vitest';
import { playCareer, playRun } from './bot';
import { GUN, STEP, UPGRADES } from './data';
import {
  applyRun,
  canPlow,
  createMeta,
  effectLine,
  FIELD_BONUS,
  fieldDamage,
  fieldSeeds,
  META_VERSION,
  normalizeMeta,
  plowField,
  PLOW_FROM,
  raiseBest,
  statsFor,
  type GardenMeta,
} from './rules';
import { createRun } from './sim';

/** 지금 밭에서 day일째까지 지켜 낸, 씨앗과 강화가 있는 저장 */
function grown(day: number, extra: Partial<GardenMeta> = {}): GardenMeta {
  return { ...raiseBest(createMeta(), day), seeds: 4321, levels: { power: 12, fence: 9, harvest: 3 }, runs: 40, kills: 9000, ...extra };
}

describe('새 밭 일구기', () => {
  it(`지금 밭에서 ${PLOW_FROM}일째까지 지켜야 일굴 수 있다`, () => {
    expect(canPlow(grown(PLOW_FROM - 1))).toBe(false);
    expect(canPlow(grown(PLOW_FROM))).toBe(true);
    const early = grown(PLOW_FROM - 1);
    expect(plowField(early)).toBe(early);
  });

  it('씨앗, 강화, 지금 밭의 기록과 출발점을 내려놓고, 판 수와 벌레 수와 모든 밭의 기록은 남긴다', () => {
    const before = grown(57);
    expect(before.startDay).toBe(56);
    const after = plowField(before);
    expect(after).toEqual({
      ...before,
      seeds: 0,
      levels: {},
      best: 0,
      startDay: 1,
      fields: 1,
      bestEver: 57,
    });
    // 다음 밭에서 덜 갔어도 모든 밭의 기록은 줄지 않고, 넘으면 오른다.
    const second = applyRun(after, 30, 100);
    expect(second.best).toBe(30);
    expect(second.bestEver).toBe(57);
    expect(applyRun(second, 60, 100).bestEver).toBe(60);
    // 다시 PLOW_FROM일째까지 가면 또 일굴 수 있고, 밭이 쌓인다.
    expect(plowField(applyRun(after, PLOW_FROM, 0)).fields).toBe(2);
  });

  it('처음 밭은 그대로이고, 밭마다 물총 피해와 받는 씨앗이 늘어난다', () => {
    expect(fieldDamage(0)).toBe(1);
    expect(fieldSeeds(0)).toBe(1);
    expect(statsFor({ power: 5, harvest: 2 }, 0)).toEqual(statsFor({ power: 5, harvest: 2 }));
    const base = statsFor({ power: 5, harvest: 2, helper: 2, thorn: 1, storm: 1 });
    for (const fields of [1, 2, 3]) {
      const boosted = statsFor({ power: 5, harvest: 2, helper: 2, thorn: 1, storm: 1 }, fields);
      expect(boosted.damage).toBe(Math.round(GUN.damage * STEP.power ** 5 * (1 + FIELD_BONUS.damage * fields)));
      expect(boosted.seedMult).toBeCloseTo(base.seedMult * (1 + FIELD_BONUS.seeds * fields));
      // 물총 피해를 따르는 것들(가시, 물벼락, 그리고 동료의 피해)도 같이 는다.
      expect(boosted.thorns).toBeGreaterThan(base.thorns);
      expect(boosted.stormDamage).toBeGreaterThan(base.stormDamage);
      // 나머지는 그대로다.
      expect({ ...boosted, damage: 0, seedMult: 0, thorns: 0, stormDamage: 0 }).toEqual({
        ...base,
        damage: 0,
        seedMult: 0,
        thorns: 0,
        stormDamage: 0,
      });
    }
    // 판은 일군 밭의 수를 받아서 그 능력치로 시작한다.
    const { state } = createRun({ seed: 1, startDay: 1, levels: {}, bestBefore: 0, fields: 2 });
    expect(state.stats).toEqual(statsFor({}, 2));
    expect(createRun({ seed: 1, startDay: 1, levels: {}, bestBefore: 0 }).state.stats).toEqual(statsFor({}));
  });

  it('준비 화면의 효과 줄도 늘어난 피해와 씨앗으로 적는다', () => {
    expect(effectLine('power', 0, 1)).toBe(`피해 ${statsFor({}, 1).damage} → ${statsFor({ power: 1 }, 1).damage}`);
    expect(effectLine('power', 0)).toBe(`피해 ${statsFor({}).damage} → ${statsFor({ power: 1 }).damage}`);
    expect(effectLine('harvest', UPGRADES.harvest.maxLevel, 1)).toMatch(/^씨앗 \d+%$/);
  });

  it(`버전 2의 저장은 처음 밭으로 읽고, 일군 밭은 저장했다 읽어도 그대로다`, () => {
    const old = normalizeMeta({ version: 2, seeds: 10, best: 63, startDay: 61, levels: { power: 3 } });
    expect(old.version).toBe(META_VERSION);
    expect(old.fields).toBe(0);
    expect(old.bestEver).toBe(63);
    const plowed = plowField(old);
    expect(normalizeMeta(JSON.parse(JSON.stringify(plowed)))).toEqual(plowed);
    expect(normalizeMeta({ ...plowed, fields: -2, bestEver: 'x' })).toEqual({ ...plowed, fields: 0, bestEver: 0 });
  });
});

describe('새 밭 일구기의 밸런스', () => {
  /** PLOW_FROM일째까지 판을 거듭한다. 걸린 판 수와 그때의 진행을 돌려준다. */
  function climb(meta: GardenMeta, seed: number): { runs: number; meta: GardenMeta } {
    let next = meta;
    for (let run = 1; run <= 60; run += 1) {
      next = playCareer(next, 1, 'active', seed * 100 + run).meta;
      if (canPlow(next)) return { runs: run, meta: next };
    }
    throw new Error(`seed ${seed}: 60판 안에 ${PLOW_FROM}일째까지 가지 못했다 (최고 ${next.best}일째)`);
  }

  it('새 밭에서는 같은 날까지 다시 오르는 데 판이 덜 들고, 같은 강화로 더 멀리 간다', () => {
    for (const seed of [3, 5]) {
      const first = climb(createMeta(), seed);
      const second = climb(plowField(first.meta), seed + 50);
      // 자동 플레이로 재 보면 처음 밭은 20판 남짓, 새 밭은 그 2/3쯤에 다시 올라간다.
      expect(second.runs, `seed ${seed}: ${first.runs} → ${second.runs}`).toBeLessThan(first.runs);
      expect(second.runs).toBeGreaterThanOrEqual(5);
    }
    // 같은 강화라면 밭이 늘수록 더 멀리 지킨다.
    const levels = { power: 14, rapid: 6, fence: 10, mend: 4, crit: 4, splash: 3 } as const;
    const reach = (fields: number): number =>
      [1, 2, 3].reduce(
        (sum, seed) => sum + playRun({ seed, startDay: 21, levels, bestBefore: 99, fields }, 'active').lastCleared,
        0,
      );
    expect(reach(1)).toBeGreaterThan(reach(0));
    expect(reach(2)).toBeGreaterThan(reach(1));
  }, 120_000);
});
