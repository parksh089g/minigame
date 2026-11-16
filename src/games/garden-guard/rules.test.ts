import { describe, expect, it } from 'vitest';
import { BOSS_EVERY, COMMON_KINDS, DAY, ENEMIES, FENCE_BASE, FIELD, GUN, UPGRADE_ORDER, UPGRADES } from './data';
import {
  applyRun,
  bankSeeds,
  biteScale,
  bossCount,
  buyUpgrade,
  canBuyAny,
  clampStartDay,
  clearBonus,
  coinsFor,
  createMeta,
  dayCount,
  dayWindow,
  effectLine,
  hpScale,
  isBossDay,
  kindWeight,
  levelOf,
  nextRandom,
  normalizeMeta,
  planDay,
  recordBonus,
  scoreFor,
  seedScale,
  startDays,
  statsFor,
  upgradeCost,
} from './rules';

/** 씨앗에서 늘 같은 차례로 나오는 난수 함수 */
function randomFrom(seed: number): () => number {
  let state = seed;
  return () => {
    const next = nextRandom(state);
    state = next.state;
    return next.value;
  };
}

describe('난수', () => {
  it('같은 씨앗은 같은 차례를 낸다', () => {
    const a = randomFrom(7);
    const b = randomFrom(7);
    const values = Array.from({ length: 200 }, () => a());
    expect(values).toEqual(Array.from({ length: 200 }, () => b()));
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
    expect(new Set(values).size).toBeGreaterThan(190);
  });
});

describe('날마다의 난이도', () => {
  it('첫날은 배율이 1이고 날이 갈수록 세진다', () => {
    expect(hpScale(1)).toBe(1);
    expect(biteScale(1)).toBe(1);
    expect(seedScale(1)).toBe(1);
    for (let day = 1; day < 60; day += 1) {
      expect(hpScale(day + 1)).toBeGreaterThan(hpScale(day));
      expect(biteScale(day + 1)).toBeGreaterThan(biteScale(day));
      expect(seedScale(day + 1)).toBeGreaterThan(seedScale(day));
    }
  });

  it('닷새마다 대장의 날이고, 30일째부터 대장이 는다', () => {
    expect(BOSS_EVERY).toBe(5);
    expect([1, 4, 5, 6, 10, 15].map(isBossDay)).toEqual([false, false, true, false, true, true]);
    expect(bossCount(4)).toBe(0);
    expect(bossCount(5)).toBe(1);
    expect(bossCount(25)).toBe(1);
    expect(bossCount(30)).toBe(2);
    expect(bossCount(60)).toBe(3);
  });

  it('벌레의 수와 나오는 시간은 늘다가 멈춘다', () => {
    expect(dayCount(1)).toBe(DAY.count.first);
    expect(dayWindow(1)).toBe(DAY.window.first);
    // 200일째는 대장의 날이라 그 앞날로 본다.
    expect(dayCount(199)).toBe(DAY.count.max);
    expect(dayWindow(200)).toBe(DAY.window.max);
    // 대장의 날에는 여느 벌레가 덜 나온다.
    expect(dayCount(10)).toBeLessThan(dayCount(9));
  });

  it('벌레는 정해진 날부터 섞인다', () => {
    for (const kind of COMMON_KINDS) {
      const from = ENEMIES[kind].fromDay;
      if (from > 1) expect(kindWeight(kind, from - 1), kind).toBe(0);
      expect(kindWeight(kind, from), kind).toBeGreaterThan(0);
    }
    expect(kindWeight('mole', 50)).toBe(0);
    // 첫날에는 개미만 나온다.
    expect(COMMON_KINDS.filter((kind) => kindWeight(kind, 1) > 0)).toEqual(['ant']);
  });
});

describe('그날 나올 벌레', () => {
  it('정해진 수만큼, 나오는 차례대로, 판 안쪽에 놓는다', () => {
    for (const day of [1, 3, 5, 12, 30, 47]) {
      const spawns = planDay(day, randomFrom(day));
      expect(spawns).toHaveLength(dayCount(day) + bossCount(day));
      for (let index = 1; index < spawns.length; index += 1) {
        expect(spawns[index].at).toBeGreaterThanOrEqual(spawns[index - 1].at);
      }
      for (const spawn of spawns) {
        expect(spawn.at).toBeGreaterThanOrEqual(0);
        expect(spawn.at).toBeLessThanOrEqual(Math.max(dayWindow(day), 1.5 + bossCount(day) * 6));
        expect(spawn.x).toBeGreaterThanOrEqual(FIELD.margin);
        expect(spawn.x).toBeLessThanOrEqual(FIELD.width - FIELD.margin);
        if (spawn.kind !== 'mole') expect(ENEMIES[spawn.kind].fromDay).toBeLessThanOrEqual(day);
      }
      expect(spawns.filter((spawn) => spawn.kind === 'mole')).toHaveLength(bossCount(day));
    }
  });

  it('같은 난수면 같은 날이 나온다', () => {
    expect(planDay(8, randomFrom(3))).toEqual(planDay(8, randomFrom(3)));
    expect(planDay(8, randomFrom(3))).not.toEqual(planDay(8, randomFrom(4)));
  });
});

describe('강화', () => {
  it('강화가 없으면 기본 능력치다', () => {
    const stats = statsFor({});
    expect(stats.damage).toBe(GUN.damage);
    expect(stats.interval).toBe(GUN.interval);
    expect(stats.fenceMax).toBe(FENCE_BASE);
    expect(stats.helpers).toBe(0);
    expect(stats.pierce).toBe(0);
    expect(stats.streams).toBe(1);
    expect(stats.critChance).toBe(0);
    expect(stats.thorns).toBe(0);
    expect(stats.stormCooldown).toBe(0);
  });

  it('단계를 올릴 때마다 나아진다', () => {
    const better: Array<[(typeof UPGRADE_ORDER)[number], (stats: ReturnType<typeof statsFor>) => number]> = [
      ['power', (stats) => stats.damage],
      ['rapid', (stats) => -stats.interval],
      ['fence', (stats) => stats.fenceMax],
      ['mend', (stats) => stats.mend],
      ['crit', (stats) => stats.critChance],
      ['splash', (stats) => stats.splashRatio],
      ['chill', (stats) => stats.chill],
      ['thorn', (stats) => stats.thorns],
      ['harvest', (stats) => stats.seedMult],
      ['helper', (stats) => stats.helpers],
      ['pierce', (stats) => stats.pierce],
      ['fork', (stats) => stats.streams],
      ['storm', (stats) => stats.stormDamage - stats.stormCooldown],
    ];
    for (const [id, measure] of better) {
      for (let level = 0; level < UPGRADES[id].maxLevel; level += 1) {
        expect(measure(statsFor({ [id]: level + 1 })), `${id} ${level + 1}`).toBeGreaterThan(
          measure(statsFor({ [id]: level })),
        );
      }
    }
    // 해바라기 거름은 해바라기가 있어야 쓸모가 있다.
    expect(statsFor({ helper: 1, compost: 3 }).helperDamage).toBeGreaterThan(statsFor({ helper: 1 }).helperDamage);
  });

  it('단계는 0과 끝 단계 사이로 읽는다', () => {
    expect(levelOf({}, 'power')).toBe(0);
    expect(levelOf({ power: -3 }, 'power')).toBe(0);
    expect(levelOf({ power: 2.9 }, 'power')).toBe(2);
    expect(levelOf({ helper: 99 }, 'helper')).toBe(UPGRADES.helper.maxLevel);
  });

  it('값은 단계마다 오르고, 다 올리면 더 살 수 없다', () => {
    for (const id of UPGRADE_ORDER) {
      const { maxLevel, cost } = UPGRADES[id];
      expect(upgradeCost(id, 0)).toBe(cost);
      for (let level = 1; level < maxLevel; level += 1) {
        expect(upgradeCost(id, level), `${id} ${level}`).toBeGreaterThan(upgradeCost(id, level - 1) ?? Infinity);
      }
      expect(upgradeCost(id, maxLevel)).toBeNull();
    }
  });

  it('효과를 지금 값과 다음 값으로 적는다', () => {
    expect(effectLine('power', 0)).toBe('피해 20 → 21');
    expect(effectLine('fence', 0)).toBe('체력 100 → 125');
    expect(effectLine('thorn', 0)).toBe('물총의 0% → 30%');
    expect(effectLine('helper', 2)).toBe('2송이');
    for (const id of UPGRADE_ORDER) {
      const { maxLevel } = UPGRADES[id];
      expect(effectLine(id, maxLevel), id).not.toContain('→');
      for (let level = 0; level <= maxLevel; level += 1) {
        const line = effectLine(id, level);
        // 준비 화면에서 값 버튼의 왼쪽에 한 줄로 들어가야 한다.
        expect(line.length, `${id} ${level}: ${line}`).toBeLessThanOrEqual(17);
        if (level < maxLevel) {
          const [now, next] = line.split(' → ');
          expect(next, `${id} ${level}: ${line}`).toBeTruthy();
          // 올려도 적힌 값이 그대로면 사는 사람이 속는다.
          expect(now.endsWith(next), `${id} ${level}: ${line}`).toBe(false);
        }
      }
    }
  });
});

describe('점수와 씨앗', () => {
  it('지킨 날마다 100점이고, 무너진 날은 쫓아낸 만큼 더한다', () => {
    expect(scoreFor(0, 0, 7)).toBe(0);
    expect(scoreFor(0, 3, 6)).toBe(50);
    expect(scoreFor(4, 0, 10)).toBe(400);
    expect(scoreFor(4, 5, 10)).toBe(450);
    // 다 쫓아냈어도 그날을 넘긴 것은 아니니 100점을 채우지는 않는다.
    expect(scoreFor(4, 10, 10)).toBe(499);
    expect(scoreFor(4, 0, 0)).toBe(400);
  });

  it('코인은 지킨 날 하나에 하나씩, 한 판에 30개까지다', () => {
    expect(coinsFor(0)).toBe(0);
    expect(coinsFor(99)).toBe(0);
    expect(coinsFor(450)).toBe(4);
    expect(coinsFor(2999)).toBe(29);
    expect(coinsFor(9900)).toBe(30);
  });

  it('날을 넘기면 씨앗을 받고, 처음 넘긴 대장의 날은 세 배를 더 받는다', () => {
    expect(clearBonus(1)).toBe(3);
    expect(clearBonus(9)).toBeGreaterThan(clearBonus(8));
    expect(recordBonus(4)).toBe(clearBonus(4));
    expect(recordBonus(5)).toBe(clearBonus(5) * 3);
  });
});

describe('판 밖 진행', () => {
  it('대장을 넘길 때마다 그다음 날에서 시작할 수 있다', () => {
    expect(startDays(0)).toEqual([1]);
    expect(startDays(4)).toEqual([1]);
    expect(startDays(5)).toEqual([1, 6]);
    expect(startDays(13)).toEqual([1, 6, 11]);
    expect(clampStartDay(6, 4)).toBe(1);
    expect(clampStartDay(6, 5)).toBe(6);
    expect(clampStartDay(9, 12)).toBe(6);
    expect(clampStartDay(99, 12)).toBe(11);
    expect(clampStartDay(0, 12)).toBe(1);
  });

  it('씨앗이 되면 강화를 사고, 모자라면 그대로다', () => {
    const poor = { ...createMeta(), seeds: UPGRADES.power.cost - 1 };
    expect(buyUpgrade(poor, 'power')).toBe(poor);
    expect(canBuyAny(poor)).toBe(true); // 더 싼 울타리는 살 수 있다.
    expect(canBuyAny({ ...createMeta(), seeds: 5 })).toBe(false);

    const rich = { ...createMeta(), seeds: 100 };
    const bought = buyUpgrade(rich, 'power');
    expect(bought.levels.power).toBe(1);
    expect(bought.seeds).toBe(100 - UPGRADES.power.cost);
    expect(rich.levels).toEqual({});

    const full = { ...createMeta(), seeds: 1e9, levels: { helper: UPGRADES.helper.maxLevel } };
    expect(buyUpgrade(full, 'helper')).toBe(full);
  });

  it('번 씨앗과 판의 기록을 쌓는다', () => {
    const meta = createMeta();
    expect(bankSeeds(meta, 0)).toBe(meta);
    expect(bankSeeds(meta, -5)).toBe(meta);
    expect(bankSeeds(meta, 12.9).seeds).toBe(12);
    const after = applyRun({ ...meta, best: 7, runs: 2, kills: 40 }, 4, 31);
    expect(after).toMatchObject({ best: 7, runs: 3, kills: 71 });
    expect(applyRun(after, 9, 0).best).toBe(9);
  });

  it('저장된 값이 이상해도 쓸 수 있는 모양으로 맞춘다', () => {
    expect(normalizeMeta(undefined)).toEqual(createMeta());
    expect(normalizeMeta(null)).toEqual(createMeta());
    expect(normalizeMeta('x')).toEqual(createMeta());
    expect(normalizeMeta([1, 2])).toEqual(createMeta());
    const meta = normalizeMeta({
      seeds: 120.7,
      best: 12,
      runs: -3,
      kills: 'many',
      startDay: 11,
      savedAt: 55,
      levels: { power: 7, helper: 40, fork: -1, unknown: 3, crit: Number.NaN },
      extra: true,
    });
    expect(meta).toEqual({
      ...createMeta(),
      seeds: 120,
      best: 12,
      startDay: 11,
      savedAt: 55,
      levels: { power: 7, helper: UPGRADES.helper.maxLevel },
    });
    // 열리지 않은 날을 골라 둔 저장은 열린 날로 돌린다.
    expect(normalizeMeta({ best: 3, startDay: 11 }).startDay).toBe(1);
    // 한 번 맞춘 것은 다시 맞춰도 그대로다.
    expect(normalizeMeta(meta)).toEqual(meta);
  });
});

describe('화면에 나오는 글', () => {
  it('글꼴에 들어 있는 한글만 쓴다', () => {
    // 주아 글꼴의 한글은 KS X 1001의 완성형 2,350자다(EUC-KR의 첫 바이트 0xB0~0xC8, 둘째 바이트 0xA1~0xFE).
    const decoder = new TextDecoder('euc-kr');
    const known = new Set<string>();
    for (let lead = 0xb0; lead <= 0xc8; lead += 1) {
      for (let trail = 0xa1; trail <= 0xfe; trail += 1) known.add(decoder.decode(new Uint8Array([lead, trail])));
    }
    expect(known.size).toBe(2350);
    // 글이 여러 파일에 흩어져 있어서, 이 폴더의 소스를 통째로 본다(주석까지 보지만 그만큼 놓치는 것이 없다).
    const sources = import.meta.glob<string>(['./*.ts', '!./*.test.ts'], { query: '?raw', import: 'default', eager: true });
    expect(Object.keys(sources).length).toBeGreaterThan(6);
    for (const [file, source] of Object.entries(sources)) {
      for (const letter of new Set(source.match(/[가-힣]/g) ?? [])) {
        expect(known.has(letter), `${file}: "${letter}"`).toBe(true);
      }
    }
  });

  it('강화마다 이름과 설명이 있다', () => {
    expect(new Set(UPGRADE_ORDER).size).toBe(UPGRADE_ORDER.length);
    expect([...UPGRADE_ORDER].sort()).toEqual(Object.keys(UPGRADES).sort());
    for (const id of UPGRADE_ORDER) {
      expect(UPGRADES[id].name.length, id).toBeGreaterThan(0);
      expect(UPGRADES[id].name.length, id).toBeLessThanOrEqual(7);
      // 설명 칸에 한 줄로 들어가야 한다.
      expect(UPGRADES[id].blurb.length, id).toBeLessThanOrEqual(24);
    }
  });
});
