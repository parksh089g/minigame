import { describe, expect, it } from 'vitest';
import { buyCheapestRelic, playCareer, playRun } from './bot';
import { BOSS_EVERY, ENEMIES, FIELD, GUN, RELIC_ORDER, RELIC_STEP, RELICS, SUMMON, UPGRADE_ORDER, type EnemyKind } from './data';
import {
  bankShards,
  biteScale,
  buyRelic,
  canBuyAnyRelic,
  canBuyRelic,
  clearBonus,
  createMeta,
  META_VERSION,
  normalizeMeta,
  plowField,
  PLOW_FROM,
  relicCost,
  relicLevel,
  relicLine,
  relicsOpen,
  relicTotalCost,
  shardsFor,
  shardsUpTo,
  statsFor,
  type Levels,
  type RelicLevels,
} from './rules';
import { readRunRecord, RUN_VERSION, runRecord, settleSavedRun } from './saved-run';
import { createRun, step, type Enemy, type Input, type RunState, type SimEvent } from './sim';

const DT = 1 / 60;

/** 모든 유물을 끝까지 올린 것 */
const MAXED: RelicLevels = Object.fromEntries(RELIC_ORDER.map((id) => [id, RELICS[id].maxLevel]));

/** 그날 나올 벌레를 모두 치운 빈 판. 벌레를 손으로 놓아 보는 테스트에 쓴다. */
function emptied(relics: RelicLevels = {}, levels: Levels = {}, startDay = 1): RunState {
  const { state } = createRun({ seed: 11, startDay, levels, bestBefore: 0, relics });
  state.queue = [];
  state.dayTotal = 0;
  return state;
}

function put(state: RunState, kind: EnemyKind, x: number, y: number, hp = 1e6): Enemy {
  const enemy: Enemy = {
    id: state.nextId++,
    kind,
    x,
    y,
    homeX: x,
    hp,
    maxHp: hp,
    day: state.day,
    biting: false,
    biteIn: ENEMIES[kind].biteEvery,
    clock: 0,
    slow: 0,
    slowLeft: 0,
    summonIn: SUMMON.every,
    flash: 0,
  };
  state.enemies.push(enemy);
  state.dayTotal += 1;
  return enemy;
}

function run(state: RunState, seconds: number, input?: Input): SimEvent[] {
  const events: SimEvent[] = [];
  for (let time = 0; time < seconds && state.phase !== 'over'; time += DT) events.push(...step(state, DT, input));
  return events;
}

describe('유물의 값', () => {
  it('유물마다 이름과 설명이 있고, 목록에 한 번씩 놓인다', () => {
    expect(new Set(RELIC_ORDER).size).toBe(RELIC_ORDER.length);
    expect([...RELIC_ORDER].sort()).toEqual(Object.keys(RELICS).sort());
    expect(Object.keys(RELIC_STEP).sort()).toEqual(Object.keys(RELICS).sort());
    for (const id of RELIC_ORDER) {
      expect(RELICS[id].name.length, id).toBeGreaterThan(0);
      expect(RELICS[id].name.length, id).toBeLessThanOrEqual(7);
      // 설명 칸에 한 줄로 들어가야 한다.
      expect(RELICS[id].blurb.length, id).toBeLessThanOrEqual(24);
      expect(RELICS[id].maxLevel, id).toBeGreaterThanOrEqual(5);
      expect(RELICS[id].maxLevel, id).toBeLessThanOrEqual(10);
    }
  });

  it('유물이 없으면 능력치가 전과 같고, 유물은 영구 강화가 건드리는 값을 바꾸지 않는다', () => {
    const levels: Levels = Object.fromEntries(UPGRADE_ORDER.map((id) => [id, 3]));
    const plain = statsFor(levels, 1);
    expect(plain).toMatchObject({ critMult: GUN.critMult, bossDamage: 1, freshDamage: 1, pace: 1, guard: 0, clearSeeds: 1 });
    expect(statsFor(levels, 1, {})).toEqual(plain);
    const relicKeys = ['critMult', 'bossDamage', 'freshDamage', 'pace', 'guard', 'clearSeeds'] as const;
    const withRelics = statsFor(levels, 1, MAXED);
    for (const key of Object.keys(plain) as (keyof typeof plain)[]) {
      if (relicKeys.includes(key as (typeof relicKeys)[number])) expect(withRelics[key], key).not.toBe(plain[key]);
      else expect(withRelics[key], key).toBe(plain[key]);
    }
  });

  it('유물마다 제 값 하나만, 단계마다 조금씩 바꾼다', () => {
    const only = (id: (typeof RELIC_ORDER)[number], level: number) => statsFor({}, 0, { [id]: level });
    expect(only('claw', 4).bossDamage).toBeCloseTo(1.06);
    expect(only('dew', 4).freshDamage).toBeCloseTo(1.12);
    expect(only('clover', 4).critMult).toBeCloseTo(GUN.critMult * 1.06);
    expect(only('scarecrow', 4).pace).toBeCloseTo(0.96);
    expect(only('bell', 4).guard).toBe(4);
    expect(only('calendar', 4).clearSeeds).toBeCloseTo(1.2);
    // 끝까지 올려도 작은 덤이다: 배율은 많아야 1.5배이고, 벌레의 걸음은 5%만 느려진다.
    const maxed = statsFor({}, 0, MAXED);
    expect(maxed.bossDamage).toBeCloseTo(1.15);
    expect(maxed.freshDamage).toBeCloseTo(1.3);
    expect(maxed.critMult / GUN.critMult).toBeCloseTo(1.15);
    expect(maxed.pace).toBeCloseTo(0.95);
    expect(maxed.guard).toBe(5);
    expect(maxed.clearSeeds).toBeCloseTo(1.5);
    // 최대 단계를 넘겨 적힌 값은 최대 단계로 친다.
    expect(statsFor({}, 0, { claw: 99, bell: 99 })).toMatchObject({ bossDamage: maxed.bossDamage, guard: 5 });
    expect(relicLevel({ claw: -2 }, 'claw')).toBe(0);
  });

  it('목록의 한 줄에 지금 값과 다음 값을 적는다', () => {
    expect(relicLine('claw', 0)).toBe('대장 피해 +0% → +1.5%');
    expect(relicLine('claw', 9)).toBe('대장 피해 +13.5% → +15%');
    expect(relicLine('claw', 10)).toBe('대장 피해 +15%');
    expect(relicLine('dew', 2)).toBe('첫 피해 +6% → +9%');
    expect(relicLine('clover', 3)).toBe('큰 피해 +4.5% → +6%');
    expect(relicLine('scarecrow', 0)).toBe('벌레 걸음 그대로 → -1%');
    expect(relicLine('scarecrow', 5)).toBe('벌레 걸음 -5%');
    expect(relicLine('bell', 0)).toBe('날마다 없음 → 1번 막음');
    expect(relicLine('bell', 4)).toBe('날마다 4번 막음 → 5번 막음');
    expect(relicLine('calendar', 9)).toBe('지킨 날 씨앗 +45% → +50%');
    // 값 단추 왼쪽에 들어가는 길이다(가장 긴 줄이 글자 18자 안쪽).
    for (const id of RELIC_ORDER) {
      for (let level = 0; level <= RELICS[id].maxLevel; level += 1) {
        expect(relicLine(id, level).length, `${id} ${level}`).toBeLessThanOrEqual(22);
      }
    }
  });
});

describe('유물 조각', () => {
  it('대장의 날에만 받고, 뒤쪽 날의 대장일수록 더 받는다', () => {
    expect(shardsFor(1)).toBe(0);
    expect(shardsFor(4)).toBe(0);
    expect(shardsFor(5)).toBe(1);
    expect(shardsFor(20)).toBe(1);
    expect(shardsFor(24)).toBe(0);
    expect(shardsFor(25)).toBe(2);
    expect(shardsFor(45)).toBe(2);
    expect(shardsFor(50)).toBe(3);
    expect(shardsFor(75)).toBe(4);
    expect(shardsUpTo(0)).toBe(0);
    expect(shardsUpTo(4)).toBe(0);
    expect(shardsUpTo(5)).toBe(1);
    // 5, 10, 15, 20일째에 하나씩, 25, 30, 35, 40일째에 둘씩
    expect(shardsUpTo(42)).toBe(12);
  });

  it('값은 단계마다 조금씩 오르고, 다 올리면 더 살 수 없다', () => {
    expect(relicCost('claw', 0)).toBe(1);
    expect(relicCost('claw', 9)).toBe(10);
    expect(relicCost('claw', 10)).toBeNull();
    expect(relicCost('bell', 0)).toBe(2);
    expect(relicCost('bell', 4)).toBe(10);
    expect(relicCost('bell', 5)).toBeNull();
    expect(relicTotalCost('claw')).toBe(55);
    expect(relicTotalCost('scarecrow')).toBe(30);
    // 모두 끝까지 올리려면 대장을 백 번 넘게 물리쳐야 한다. 오래 할수록 조금씩 오르는 것이다.
    const all = RELIC_ORDER.reduce((sum, id) => sum + relicTotalCost(id), 0);
    expect(all).toBe(280);
    expect(all).toBeGreaterThan(20 * shardsFor(50));
  });

  it('조각으로 유물을 한 단계씩 올린다', () => {
    const meta = { ...createMeta(), shards: 3 };
    expect(canBuyRelic(meta, 'claw')).toBe(true);
    expect(canBuyAnyRelic(meta)).toBe(true);
    const once = buyRelic(meta, 'claw');
    expect(once).toMatchObject({ shards: 2, relics: { claw: 1 } });
    const twice = buyRelic(once, 'claw');
    expect(twice).toMatchObject({ shards: 0, relics: { claw: 2 } });
    // 조각이 모자라면 그대로다.
    expect(buyRelic(twice, 'claw')).toBe(twice);
    expect(canBuyAnyRelic(twice)).toBe(false);
    // 다 올린 유물은 조각이 남아도 더 올리지 않는다.
    const full = { ...createMeta(), shards: 99, relics: { bell: RELICS.bell.maxLevel } };
    expect(canBuyRelic(full, 'bell')).toBe(false);
    expect(buyRelic(full, 'bell')).toBe(full);
    // 받은 조각을 넣는다. 0이나 이상한 값은 넣지 않는다.
    expect(bankShards(meta, 2).shards).toBe(5);
    expect(bankShards(meta, 0)).toBe(meta);
    expect(bankShards(meta, -3)).toBe(meta);
    expect(bankShards(meta, Number.NaN)).toBe(meta);
  });

  it('가장 싼 유물부터 사면 조각을 남기지 않고 고르게 올린다', () => {
    const bought = buyCheapestRelic({ ...createMeta(), shards: 20 });
    expect(bought.shards).toBeLessThan(2);
    expect(RELIC_ORDER.filter((id) => relicLevel(bought.relics, id) > 0).length).toBeGreaterThanOrEqual(4);
  });
});

describe('유물의 저장', () => {
  it('유물과 조각을 읽고, 이상한 값은 버린다', () => {
    const meta = normalizeMeta({
      version: META_VERSION,
      best: 12,
      shards: 7.9,
      relics: { claw: 3, bell: 40, dew: -1, unknown: 2, clover: Number.NaN },
    });
    expect(meta.shards).toBe(7);
    expect(meta.relics).toEqual({ claw: 3, bell: RELICS.bell.maxLevel });
    expect(normalizeMeta(meta)).toEqual(meta);
    expect(normalizeMeta({ version: META_VERSION, shards: 'many', relics: 'none' })).toMatchObject({ shards: 0, relics: {} });
  });

  it('유물이 생기기 전의 저장은 그동안 물리친 대장만큼의 조각을 받고 시작한다', () => {
    const old = normalizeMeta({ version: 3, best: 12, bestEver: 42, fields: 1, runs: 80 });
    expect(old).toMatchObject({ version: META_VERSION, shards: shardsUpTo(42), relics: {} });
    // 한 번 맞춘 것을 다시 읽어도 또 받지 않는다.
    expect(normalizeMeta({ ...old, shards: 1 }).shards).toBe(1);
    // 대장을 물리친 적이 없으면 받을 것이 없다.
    expect(normalizeMeta({ version: 3, best: 4, bestEver: 4 }).shards).toBe(0);
    // 옛 저장에 조각이 적혀 있었을 리 없으니, 적혀 있어도 믿지 않는다.
    expect(normalizeMeta({ version: 2, best: 5, shards: 999 }).shards).toBe(1);
  });

  it('새 밭을 일궈도 유물과 조각은 남는다', () => {
    const meta = { ...createMeta(), best: PLOW_FROM, bestEver: PLOW_FROM, seeds: 500, levels: { power: 9 }, shards: 4, relics: { claw: 2, bell: 1 } };
    const plowed = plowField(meta);
    expect(plowed).toMatchObject({ fields: 1, seeds: 0, levels: {}, best: 0, shards: 4, relics: { claw: 2, bell: 1 } });
  });

  it('대장을 물리친 적이 있거나 유물이 있으면 준비 화면에 유물 버튼이 보인다', () => {
    expect(relicsOpen(createMeta())).toBe(false);
    expect(relicsOpen({ ...createMeta(), best: BOSS_EVERY - 1, bestEver: BOSS_EVERY - 1 })).toBe(false);
    expect(relicsOpen({ ...createMeta(), bestEver: BOSS_EVERY })).toBe(true);
    expect(relicsOpen({ ...createMeta(), shards: 1 })).toBe(true);
    expect(relicsOpen({ ...createMeta(), relics: { dew: 1 } })).toBe(true);
  });
});

describe('판에서의 유물', () => {
  it('대장의 날을 지키면 유물 조각을 받고, 여느 날에는 받지 않는다', () => {
    const state = emptied({}, {}, 4);
    const fourth = run(state, 0.1).find((event) => event.type === 'dayClear');
    expect(fourth).toMatchObject({ day: 4, shards: 0 });
    expect(state.shards).toBe(0);
    // 강화를 고르고 5일째(대장의 날)로 넘어가서, 나올 벌레를 치워 그날을 지킨다.
    step(state, DT, { aim: null, storm: false, pick: 0 });
    for (let time = 0; time < 5 && state.day < 5; time += DT) step(state, DT);
    expect(state.day).toBe(5);
    state.queue = [];
    state.enemies = [];
    const fifth = run(state, 0.1).find((event) => event.type === 'dayClear');
    expect(fifth).toMatchObject({ day: 5, shards: 1 });
    expect(state.shards).toBe(1);
    // 뒤쪽 날의 대장은 더 준다.
    const late = emptied({}, {}, 50);
    expect(run(late, 0.1).find((event) => event.type === 'dayClear')).toMatchObject({ day: 50, shards: 3 });
    expect(late.shards).toBe(3);
  });

  it('두더지 발톱은 대장에게 주는 피해만 키운다', () => {
    const hit = (kind: EnemyKind, relics: RelicLevels): number => {
      const state = emptied(relics);
      const enemy = put(state, kind, FIELD.width / 2, 200);
      // 첫 물방울의 덤(아침 이슬)이 섞이지 않게 이미 다친 벌레로 둔다.
      enemy.hp -= 1;
      const before = enemy.hp;
      for (let time = 0; time < 3 && enemy.hp === before; time += DT) step(state, DT);
      return before - enemy.hp;
    };
    expect(hit('mole', { claw: 10 }) / hit('mole', {})).toBeCloseTo(1.15);
    expect(hit('rhino', { claw: 10 }) / hit('rhino', {})).toBeCloseTo(1.15);
    expect(hit('ant', { claw: 10 })).toBeCloseTo(hit('ant', {}));
  });

  it('아침 이슬은 아직 안 다친 벌레가 맞는 첫 피해만 키운다', () => {
    const hits = (relics: RelicLevels): number[] => {
      const state = emptied(relics);
      const enemy = put(state, 'snail', FIELD.width / 2, 200);
      const dealt: number[] = [];
      let hp = enemy.hp;
      for (let time = 0; time < 6 && dealt.length < 3; time += DT) {
        step(state, DT);
        if (enemy.hp !== hp) dealt.push(hp - enemy.hp);
        hp = enemy.hp;
      }
      return dealt;
    };
    const plain = hits({});
    const dewy = hits({ dew: 10 });
    expect(dewy[0] / plain[0]).toBeCloseTo(1.3);
    expect(dewy[1]).toBeCloseTo(plain[1]);
    expect(dewy[2]).toBeCloseTo(plain[2]);
  });

  it('네잎클로버는 크게 맞혔을 때의 피해만 키운다', () => {
    const shots = (relics: RelicLevels): { crit: number; normal: number } => {
      // 치명타 확률 40%로 여러 발을 쏴서 치명타와 보통 물방울의 피해를 하나씩 본다.
      const state = emptied(relics, { crit: 10 });
      put(state, 'snail', FIELD.width / 2, 40);
      let crit = 0;
      let normal = 0;
      for (let time = 0; time < 20 && (crit === 0 || normal === 0); time += DT) {
        step(state, DT);
        for (const shot of state.shots) {
          if (shot.crit) crit = shot.damage;
          else normal = shot.damage;
        }
      }
      return { crit, normal };
    };
    const plain = shots({});
    const lucky = shots({ clover: 10 });
    expect(plain.crit / plain.normal).toBeCloseTo(GUN.critMult);
    expect(lucky.crit / lucky.normal).toBeCloseTo(GUN.critMult * 1.15);
    expect(lucky.normal).toBe(plain.normal);
  });

  it('허수아비는 벌레의 걸음을 조금 늦춘다', () => {
    const walked = (kind: EnemyKind, relics: RelicLevels): number => {
      const state = emptied(relics);
      const enemy = put(state, kind, 40, 20);
      run(state, 3);
      return enemy.y - 20;
    };
    for (const kind of ['ant', 'bee', 'hopper', 'mole'] as const) {
      expect(walked(kind, { scarecrow: 5 }) / walked(kind, {}), kind).toBeCloseTo(0.95, 2);
    }
  });

  it('울타리 방울은 날마다 처음 몇 번의 갉기를 막고, 날이 바뀌면 다시 막는다', () => {
    const state = emptied({ bell: 3 }, { thorn: 1 });
    expect(state.guardLeft).toBe(3);
    const ant = put(state, 'ant', 60, FIELD.depth - ENEMIES.ant.radius);
    const fence = state.fence;
    const events = run(state, ENEMIES.ant.biteEvery * 5 + 0.2);
    // 처음 세 번은 막고, 그 뒤로는 그대로 깎인다.
    expect(events.filter((event) => event.type === 'guard')).toHaveLength(3);
    const bites = events.filter((event) => event.type === 'bite');
    expect(bites.length).toBeGreaterThanOrEqual(2);
    expect(fence - state.fence).toBeCloseTo(bites.length * ENEMIES.ant.bite * biteScale(1));
    expect(state.guardLeft).toBe(0);
    // 막은 갉기에도 가시 울타리는 그대로 찌른다.
    expect(ant.maxHp - ant.hp).toBeGreaterThan(statsFor({ thorn: 1 }).thorns * 4.5);
    // 다음 날이 시작되면 다시 찬다.
    state.enemies = [];
    for (let time = 0; time < 10 && state.day === 1; time += DT) step(state, DT, { aim: null, storm: false, pick: 0 });
    expect(state.day).toBe(2);
    expect(state.guardLeft).toBe(3);
    // 유물이 없으면 처음부터 깎인다.
    const plain = emptied();
    put(plain, 'ant', 60, FIELD.depth - ENEMIES.ant.radius);
    expect(run(plain, ENEMIES.ant.biteEvery + 0.2).some((event) => event.type === 'guard')).toBe(false);
    expect(plain.fence).toBeLessThan(plain.stats.fenceMax);
  });

  it('오래된 달력은 날을 지킬 때 받는 씨앗만 늘리고, 새 기록의 덤은 그대로다', () => {
    const cleared = (relics: RelicLevels, bestBefore: number): number => {
      const { state } = createRun({ seed: 11, startDay: 3, levels: {}, bestBefore, relics });
      state.queue = [];
      const event = run(state, 0.1).find((found) => found.type === 'dayClear');
      return event?.type === 'dayClear' ? event.seeds : Number.NaN;
    };
    // 이미 지켜 본 날: 지킨 몫이 1.5배
    expect(cleared({ calendar: 10 }, 9) / cleared({}, 9)).toBeCloseTo(1.5);
    // 새 기록의 덤은 늘지 않는다.
    expect(cleared({ calendar: 10 }, 0) - cleared({}, 0)).toBeCloseTo(clearBonus(3) * 0.5);
  });

  it('모두 끝까지 올려도 판이 크게 달라지지는 않는다', () => {
    // 열두 판을 하며 강화를 산 사람이 26일째에서 시작하는 판을 유물 없이, 그리고 유물을 모두 끝까지 올리고 해 본다.
    // 자동 플레이로 여덟 판씩 재면 유물 없이 38.8일째, 모두 올리고 42.0일째까지 간다(서른 판 뒤에는 59.0일째와 62.1일째).
    const meta = playCareer(createMeta(), 12, 'active', 3).meta;
    expect(meta.best).toBeGreaterThan(30);
    const kept = (relics: RelicLevels): number[] =>
      [77, 154, 231, 308].map(
        (seed) => playRun({ seed, startDay: 26, levels: meta.levels, bestBefore: meta.best, relics }, 'active').lastCleared,
      );
    const plain = kept({});
    const maxed = kept(MAXED);
    const mean = (days: number[]): number => days.reduce((sum, day) => sum + day, 0) / days.length;
    expect(mean(plain)).toBeGreaterThan(30);
    // 도움은 되지만(더 못 가지는 않는다) 며칠 더 가는 정도다.
    expect(mean(maxed)).toBeGreaterThan(mean(plain));
    expect(mean(maxed) - mean(plain)).toBeLessThanOrEqual(6);
  });
});

describe('하던 판의 유물', () => {
  const T = 1_700_000_000_000;
  const throughDisk = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

  it('유물이 있는 판을 적었다가 읽으면 그대로다', () => {
    const { state } = createRun({ seed: 42, startDay: 4, levels: { power: 6 }, bestBefore: 3, relics: MAXED });
    run(state, 12);
    const saved = { state: { ...state, shards: 2 }, banked: 5, bankedShards: 1 };
    expect(readRunRecord(throughDisk(runRecord(saved, T)))).toEqual({ savedAt: T, run: saved });
    // 넣어 둔 조각의 양만 이상하면 판은 살리고 0으로 친다.
    const odd = throughDisk(runRecord(saved, T)) as { run: { bankedShards: unknown } };
    odd.run.bankedShards = 'two';
    expect(readRunRecord(odd).run?.bankedShards).toBe(0);
  });

  it('유물이 생기기 전에 적은 판은 유물 없는 판으로 채워서 이어 한다', () => {
    const { state } = createRun({ seed: 42, startDay: 4, levels: { power: 6, rapid: 3 }, bestBefore: 3 });
    run(state, 12);
    // 버전 2의 판: 유물의 값들이 아직 없다.
    const old = throughDisk(runRecord({ state, banked: 9, bankedShards: 0 }, T)) as {
      version: number;
      run: { state: Record<string, unknown>; bankedShards?: number };
    };
    old.version = 2;
    delete old.run.bankedShards;
    delete old.run.state.shards;
    delete old.run.state.guardLeft;
    const stats = old.run.state.stats as Record<string, unknown>;
    for (const key of ['critMult', 'bossDamage', 'freshDamage', 'pace', 'guard', 'clearSeeds']) delete stats[key];
    const read = readRunRecord(old);
    expect(read.run).toEqual({ state, banked: 9, bankedShards: 0 });
    // 이어 하면 유물 없이 시작한 판과 똑같이 흘러간다.
    const restored = read.run!.state;
    for (let time = 0; time < 20; time += DT) {
      step(state, DT, { aim: null, storm: false, pick: 0 });
      step(restored, DT, { aim: null, storm: false, pick: 0 });
    }
    expect(restored).toEqual(state);
    // 그보다 옛 버전이거나 다른 데가 망가진 판은 채우지 않고 버린다.
    expect(readRunRecord({ ...old, version: 1 }).run).toBeNull();
    expect(readRunRecord({ ...old, version: RUN_VERSION + 1 }).run).toBeNull();
    const broken = structuredClone(old);
    delete broken.run.state.fence;
    expect(readRunRecord(broken).run).toBeNull();
  });

  it('이어 하지 않기로 한 판은 아직 넣지 않은 조각도 넣는다', () => {
    const { state } = createRun({ seed: 42, startDay: 4, levels: {}, bestBefore: 3 });
    const meta = { ...createMeta(), shards: 4, best: 6, startDay: 6 };
    expect(settleSavedRun(meta, { state: { ...state, shards: 3 }, banked: 0, bankedShards: 1 }).shards).toBe(6);
    expect(settleSavedRun(meta, { state: { ...state, shards: 3 }, banked: 0, bankedShards: 3 }).shards).toBe(4);
  });
});
