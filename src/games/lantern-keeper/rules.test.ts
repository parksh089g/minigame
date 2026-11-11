import { describe, expect, it } from 'vitest';
import {
  ENEMIES,
  EVOLVE_LEVEL,
  MAX_LEVEL,
  MAX_WEAPONS,
  META,
  META_ORDER,
  MID_BOSS_COUNT,
  MID_BOSS_EVERY,
  MID_BOSS_TIERS,
  PASSIVES,
  RUN_SECONDS,
  SPAWN_TABLE,
  SURGES,
  WEAPON_ORDER,
  WEAPONS,
  type PassiveId,
  type WeaponId,
} from './data';
import {
  auraStats,
  boltStats,
  coinsFor,
  damageScale,
  embersFor,
  emberStats,
  enemyHp,
  fireflyStats,
  formatClock,
  hpScale,
  isEvolved,
  lanceStats,
  maxAlive,
  metaCost,
  midBossTier,
  modifiers,
  oilStats,
  ownedWeapons,
  pickSpawnKind,
  scoreFor,
  seededRandom,
  spawnPerSecond,
  speedScale,
  starStats,
  ticketOptions,
  upgradeDescription,
  upgradeOptions,
  upgradeTitle,
  weaponName,
  xpToNext,
  type Build,
  type RunSummary,
} from './rules';

const base = modifiers({}, {});
const run = (over: Partial<RunSummary> = {}): RunSummary => ({
  seconds: 0,
  kills: 0,
  level: 1,
  bossKills: 0,
  cleared: false,
  bonusEmbers: 0,
  ...over,
});

describe('데이터', () => {
  it('무기와 패시브의 레벨 설명이 빠짐없이 있다', () => {
    for (const weapon of Object.values(WEAPONS)) {
      expect(weapon.levels).toHaveLength(MAX_LEVEL);
      expect(weapon.evolved.name).not.toBe('');
      expect(weapon.evolved.name).not.toBe(weapon.name);
      expect(weapon.evolved.description).not.toBe('');
    }
    for (const passive of Object.values(PASSIVES)) expect(passive.perLevel).not.toBe('');
  });

  it('무기는 일곱 가지이고, 늘어놓는 순서에 빠진 것이 없다', () => {
    expect(WEAPON_ORDER).toHaveLength(7);
    expect([...WEAPON_ORDER].sort()).toEqual(Object.keys(WEAPONS).sort());
    expect(MAX_WEAPONS).toBeLessThan(WEAPON_ORDER.length);
  });

  it('중간 보스는 나올 때마다 강해지고, 표에 빠진 차례가 없다', () => {
    expect(MID_BOSS_TIERS).toHaveLength(MID_BOSS_COUNT);
    for (let n = 1; n < MID_BOSS_COUNT; n += 1) {
      expect(midBossTier(n).hp).toBeGreaterThan(midBossTier(n - 1).hp);
      expect(midBossTier(n).summon).toBeGreaterThanOrEqual(midBossTier(n - 1).summon);
    }
    expect(midBossTier(99)).toBe(midBossTier(MID_BOSS_COUNT - 1));
    expect(ENEMIES.giant.hp).toBe(midBossTier(0).hp);
    expect(ENEMIES.lord.hp).toBeGreaterThan(midBossTier(MID_BOSS_COUNT - 1).hp);
  });

  it('등장표와 밀물 시각이 한 판 안에 있고, 처음부터 나오는 적이 있다', () => {
    expect(SPAWN_TABLE.some((row) => row.from === 0)).toBe(true);
    for (const row of SPAWN_TABLE) {
      expect(row.from).toBeLessThan(RUN_SECONDS);
      expect(ENEMIES[row.kind].boss).toBeFalsy();
    }
    expect([...SURGES].sort((a, b) => a - b)).toEqual([...SURGES]);
    expect(SURGES[SURGES.length - 1]).toBeLessThan(RUN_SECONDS);
  });

  it('영구 강화 목록과 순서가 맞는다', () => {
    expect([...META_ORDER].sort()).toEqual(Object.keys(META).sort());
  });
});

describe('난이도 곡선', () => {
  it('시간이 갈수록 어려워지기만 한다', () => {
    for (let t = 10; t <= RUN_SECONDS; t += 10) {
      expect(spawnPerSecond(t)).toBeGreaterThanOrEqual(spawnPerSecond(t - 10));
      expect(maxAlive(t)).toBeGreaterThanOrEqual(maxAlive(t - 10));
      expect(hpScale(t)).toBeGreaterThan(hpScale(t - 10));
      expect(damageScale(t)).toBeGreaterThanOrEqual(damageScale(t - 10));
      expect(speedScale(t)).toBeGreaterThanOrEqual(speedScale(t - 10));
    }
  });

  it('처음에는 불씨탄 한 발에 그림자 방울이 쓰러진다', () => {
    expect(emberStats(1, base).damage).toBeGreaterThanOrEqual(enemyHp('shade', 0));
  });

  it('적의 피해는 처음 3분 동안 그대로이고 끝에서도 두 배를 넘지 않는다', () => {
    expect(damageScale(0)).toBe(1);
    expect(damageScale(180)).toBe(1);
    expect(damageScale(RUN_SECONDS)).toBeGreaterThan(1.3);
    expect(damageScale(RUN_SECONDS * 2)).toBeLessThan(2);
  });

  it('밀물은 중간 보스가 나오는 시각과 겹치지 않는다', () => {
    for (const at of SURGES) expect(at % MID_BOSS_EVERY).not.toBe(0);
  });

  it('적은 끝까지 플레이어보다 느리다', () => {
    const playerSpeed = 62;
    for (const row of SPAWN_TABLE) {
      expect(ENEMIES[row.kind].speed * speedScale(RUN_SECONDS)).toBeLessThan(playerSpeed);
    }
  });

  it('보스의 체력은 시간에 따라 바뀌지 않는다', () => {
    expect(enemyHp('giant', 0)).toBe(enemyHp('giant', RUN_SECONDS));
    expect(enemyHp('shade', RUN_SECONDS)).toBeGreaterThan(enemyHp('shade', 0));
  });

  it('아직 열리지 않은 적은 나오지 않는다', () => {
    const rand = seededRandom(7);
    for (let i = 0; i < 200; i += 1) expect(pickSpawnKind(0, rand)).toBe('shade');
    const late = new Set<string>();
    for (let i = 0; i < 400; i += 1) late.add(pickSpawnKind(RUN_SECONDS, rand));
    expect(late.size).toBe(SPAWN_TABLE.length);
  });
});

describe('성장', () => {
  it('다음 레벨까지 필요한 경험치는 계속 늘어난다', () => {
    expect(xpToNext(1)).toBe(5);
    for (let level = 2; level <= 60; level += 1) {
      expect(xpToNext(level)).toBeGreaterThan(xpToNext(level - 1));
    }
  });

  it('무기는 레벨이 오를수록 약해지지 않는다', () => {
    for (let level = 2; level <= EVOLVE_LEVEL; level += 1) {
      const [e0, e1] = [emberStats(level - 1, base), emberStats(level, base)];
      expect((e1.damage * e1.count) / e1.cooldown).toBeGreaterThanOrEqual((e0.damage * e0.count) / e0.cooldown);
      const [a0, a1] = [auraStats(level - 1, base), auraStats(level, base)];
      expect(a1.damage * a1.radius).toBeGreaterThanOrEqual(a0.damage * a0.radius);
      const [f0, f1] = [fireflyStats(level - 1, base), fireflyStats(level, base)];
      expect(f1.damage * f1.count).toBeGreaterThanOrEqual(f0.damage * f0.count);
      const [s0, s1] = [starStats(level - 1, base), starStats(level, base)];
      expect((s1.damage * s1.count) / s1.cooldown).toBeGreaterThanOrEqual((s0.damage * s0.count) / s0.cooldown);
      const [l0, l1] = [lanceStats(level - 1, base), lanceStats(level, base)];
      expect((l1.damage * l1.count) / l1.cooldown).toBeGreaterThanOrEqual((l0.damage * l0.count) / l0.cooldown);
      const [o0, o1] = [oilStats(level - 1, base), oilStats(level, base)];
      expect((o1.damage * o1.radius * o1.duration) / o1.cooldown).toBeGreaterThanOrEqual(
        (o0.damage * o0.radius * o0.duration) / o0.cooldown,
      );
      const [b0, b1] = [boltStats(level - 1, base), boltStats(level, base)];
      expect((b1.damage * b1.jumps * b1.chains) / b1.cooldown).toBeGreaterThanOrEqual(
        (b0.damage * b0.jumps * b0.chains) / b0.cooldown,
      );
    }
  });

  it('진화하면 한 단계 오른 것보다 눈에 띄게 강해진다', () => {
    const power = (level: number): number[] => {
      const e = emberStats(level, base);
      const a = auraStats(level, base);
      const f = fireflyStats(level, base);
      const s = starStats(level, base);
      const l = lanceStats(level, base);
      const o = oilStats(level, base);
      const b = boltStats(level, base);
      return [
        (e.damage * e.count * (1 + e.pierce)) / e.cooldown,
        (a.damage * a.radius ** 2) / a.tick,
        (f.damage * f.count) / f.rehit,
        (s.damage * s.count * s.radius ** 2) / s.cooldown,
        (l.damage * l.count * l.radius) / l.cooldown,
        (o.damage * o.radius ** 2 * o.duration) / o.cooldown,
        (b.damage * b.jumps * b.chains) / b.cooldown,
      ];
    };
    const before = power(MAX_LEVEL);
    const after = power(EVOLVE_LEVEL);
    expect(isEvolved(MAX_LEVEL)).toBe(false);
    expect(isEvolved(EVOLVE_LEVEL)).toBe(true);
    after.forEach((value, i) => expect(value / before[i]).toBeGreaterThan(1.5));
  });

  it('패시브와 영구 강화가 능력치에 곱해진다', () => {
    const strong = modifiers({ wick: 2, hourglass: 1, coat: 1 }, { might: 2, vigor: 3 });
    expect(strong.damage).toBeCloseTo(1.2 * 1.1);
    expect(strong.cooldown).toBeCloseTo(0.93);
    expect(strong.maxHp).toBe(base.maxHp + 20 + 30);
    expect(emberStats(1, strong).damage).toBeGreaterThan(emberStats(1, base).damage);
  });
});

describe('레벨업 선택지', () => {
  const fresh: Build = { weapons: { ember: 1 }, passives: {} };

  it('서로 다른 세 가지를 내고, 고르면 한 단계씩만 오른다', () => {
    const rand = seededRandom(3);
    for (let i = 0; i < 100; i += 1) {
      const options = upgradeOptions(fresh, rand);
      expect(options).toHaveLength(3);
      expect(new Set(options.map((u) => `${u.type}:${'id' in u ? u.id : ''}`)).size).toBe(3);
      for (const option of options) {
        if (option.type === 'weapon') expect(option.level).toBe((fresh.weapons[option.id] ?? 0) + 1);
        if (option.type === 'passive') expect(option.level).toBe(1);
        expect(upgradeTitle(option)).not.toBe('');
        expect(upgradeDescription(option)).not.toBe('');
      }
    }
  });

  it('다 올린 것은 나오지 않고, 모두 채우면 회복과 불씨를 준다', () => {
    const full: Build = { weapons: {}, passives: {} };
    for (const id of WEAPON_ORDER.slice(0, MAX_WEAPONS)) full.weapons[id] = MAX_LEVEL;
    for (const id of Object.keys(PASSIVES) as PassiveId[]) full.passives[id] = MAX_LEVEL;
    expect(upgradeOptions(full, seededRandom(1)).map((u) => u.type)).toEqual(['heal', 'embers']);

    full.weapons.star = MAX_LEVEL - 1;
    const options = upgradeOptions(full, seededRandom(1));
    expect(options[0]).toEqual({ type: 'weapon', id: 'star', level: MAX_LEVEL });
    expect(options.map((u) => u.type)).toEqual(['weapon', 'heal', 'embers']);
  });

  it('무기 칸이 다 차면 새 무기는 나오지 않는다', () => {
    const rand = seededRandom(9);
    const packed: Build = { weapons: { ember: 1, aura: 1, lance: 1, bolt: 1 }, passives: {} };
    expect(ownedWeapons(packed.weapons)).toHaveLength(MAX_WEAPONS);
    for (let i = 0; i < 200; i += 1) {
      for (const option of upgradeOptions(packed, rand)) {
        if (option.type === 'weapon') expect(packed.weapons[option.id]).toBe(1);
      }
    }
    // 칸이 남아 있으면 아직 없는 무기도 나온다.
    const roomy: Build = { weapons: { ember: 1 }, passives: {} };
    const seen = new Set<WeaponId>();
    for (let i = 0; i < 300; i += 1) {
      for (const option of upgradeOptions(roomy, rand)) if (option.type === 'weapon') seen.add(option.id);
    }
    expect(seen.size).toBe(WEAPON_ORDER.length);
  });

  it('레벨업으로는 진화하지 못하고, 5레벨 무기에 강화권을 써야 진화한다', () => {
    const build: Build = { weapons: { star: MAX_LEVEL }, passives: {} };
    const rand = seededRandom(4);
    for (let i = 0; i < 200; i += 1) {
      for (const option of upgradeOptions(build, rand)) {
        if (option.type === 'weapon') expect(option.id).not.toBe('star');
      }
    }
    const [evolve] = ticketOptions(build.weapons);
    expect(evolve).toEqual({ type: 'weapon', id: 'star', level: EVOLVE_LEVEL });
    expect(upgradeTitle(evolve)).toBe(WEAPONS.star.evolved.name);
    expect(upgradeDescription(evolve)).toBe(WEAPONS.star.evolved.description);
    expect(weaponName('star', MAX_LEVEL)).toBe(WEAPONS.star.name);
    expect(weaponName('star', EVOLVE_LEVEL)).toBe(WEAPONS.star.evolved.name);
  });

  it('무기 강화권은 가진 무기 가운데 덜 올린 것을 모두 보여 준다', () => {
    expect(ticketOptions({ ember: 3, bolt: MAX_LEVEL, aura: EVOLVE_LEVEL })).toEqual([
      { type: 'weapon', id: 'ember', level: 4 },
      { type: 'weapon', id: 'bolt', level: EVOLVE_LEVEL },
    ]);
    expect(ticketOptions({ ember: EVOLVE_LEVEL })).toEqual([{ type: 'heal' }, { type: 'embers' }]);
  });
});

describe('결과와 보상', () => {
  it('오래 버티고 많이 쓰러뜨릴수록 점수와 불씨가 늘어난다', () => {
    const short = run({ seconds: 90, kills: 80 });
    const long = run({ seconds: 320, kills: 900, bossKills: 1 });
    const clear = run({ seconds: 600, kills: 5000, bossKills: 2, cleared: true });
    expect(scoreFor(long)).toBeGreaterThan(scoreFor(short));
    expect(scoreFor(clear)).toBeGreaterThan(scoreFor(long));
    expect(embersFor(long)).toBeGreaterThan(embersFor(short));
    expect(embersFor(clear)).toBeGreaterThan(embersFor(long));
    expect(embersFor(run({ bonusEmbers: 10 }))).toBe(10);
  });

  it('첫 판을 2분쯤 버티면 가장 싼 영구 강화를 하나 살 수 있다', () => {
    const cheapest = Math.min(...META_ORDER.map((id) => metaCost(id, 0) ?? Infinity));
    expect(embersFor(run({ seconds: 150, kills: 250 }))).toBeGreaterThanOrEqual(cheapest);
  });

  it('영구 강화는 단계가 오를수록 비싸지고 최대 단계에서 멈춘다', () => {
    for (const id of META_ORDER) {
      for (let level = 1; level < META[id].maxLevel; level += 1) {
        expect(metaCost(id, level)!).toBeGreaterThan(metaCost(id, level - 1)!);
      }
      expect(metaCost(id, META[id].maxLevel)).toBeNull();
    }
  });

  it('코인은 정수이고 점수가 높을수록 줄지 않는다', () => {
    expect(coinsFor(0)).toBe(0);
    expect(coinsFor(599)).toBe(9);
    expect(coinsFor(6000)).toBe(100);
  });

  it('시간을 분:초로 적는다', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65.9)).toBe('1:05');
    expect(formatClock(600)).toBe('10:00');
  });
});
