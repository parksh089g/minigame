import { describe, expect, it } from 'vitest';
import { MAX_SCORE } from '../../online/protocol';
import {
  BOON_ORDER,
  BOON_VALUES,
  BOONS,
  ENDLESS,
  ENEMIES,
  EVOLVE_LEVEL,
  FEAST,
  FEAST_LEVELS,
  FEAST_ORDER,
  HEROES,
  MAX_DEPTH,
  GUARD,
  MAX_LEVEL,
  MAX_PASSIVES,
  MAX_WEAPONS,
  META,
  META_ORDER,
  MID_BOSS_COUNT,
  MID_BOSS_EVERY,
  MID_BOSS_TIERS,
  PASSIVES,
  PLAYER_BASE,
  RUN_SECONDS,
  STAGE_ORDER,
  STAGES,
  SURGES,
  WEAPON_ORDER,
  WEAPONS,
  type PassiveId,
  type WeaponId,
} from './data';
import {
  auraStats,
  bellStats,
  boltStats,
  boonLevel,
  boonOptions,
  chestUpgrade,
  clampDepth,
  COIN_CAP,
  coinsFor,
  damageScale,
  depthName,
  depthRules,
  embersFor,
  endlessBossKind,
  endlessScale,
  emberStats,
  enemyHp,
  fireflyStats,
  formatClock,
  formatTimes,
  hpScale,
  isEvolved,
  lanceStats,
  maxAlive,
  metaCost,
  midBossTier,
  modifiers,
  moonStats,
  beamStats,
  torchStats,
  lampStats,
  oilStats,
  ownedPassives,
  ownedWeapons,
  pickSpawnKind,
  scoreFor,
  seededRandom,
  sparkChance,
  spawnPerSecond,
  speedScale,
  starStats,
  ticketOptions,
  upgradeDescription,
  upgradeOptions,
  upgradeTitle,
  weaponName,
  weaponSlotCount,
  feastNote,
  feastReward,
  feastTitle,
  xpToNext,
  type Build,
  type RunSummary,
} from './rules';

const base = modifiers({}, {});
const run = (over: Partial<RunSummary> = {}): RunSummary => ({
  seconds: 0,
  endlessSeconds: 0,
  kills: 0,
  // 따로 주지 않으면 쓰러뜨린 것을 모두 센다.
  countedKills: over.kills ?? 0,
  level: 1,
  bossKills: 0,
  cleared: false,
  bonusEmbers: 0,
  depth: 0,
  ...over,
});

describe('깊은 밤의 규칙', () => {
  it('보통 밤은 아무것도 바꾸지 않는다', () => {
    for (const value of Object.values(depthRules(0))) expect(value).toBe(1);
  });

  it('단계가 오를수록 더 어렵고, 점수와 불씨가 더 붙는다', () => {
    for (let depth = 1; depth <= MAX_DEPTH; depth += 1) {
      const before = depthRules(depth - 1);
      const after = depthRules(depth);
      for (const key of Object.keys(after) as Array<keyof typeof after>) {
        expect(after[key]).toBeGreaterThan(before[key]);
      }
    }
  });

  it('가장 깊은 밤에서도 가장 빠른 적은 맨몸의 플레이어보다 느리다', () => {
    const fastest = Math.max(...Object.values(ENEMIES).filter((info) => !info.boss && !info.hops).map((info) => info.speed));
    expect(fastest * speedScale(RUN_SECONDS) * depthRules(MAX_DEPTH).speed).toBeLessThan(PLAYER_BASE.speed);
  });

  it('단계는 0부터 가장 깊은 단계까지의 정수로 맞춘다', () => {
    expect(clampDepth(undefined)).toBe(0);
    expect(clampDepth('3')).toBe(0);
    expect(clampDepth(Number.NaN)).toBe(0);
    expect(clampDepth(-2)).toBe(0);
    expect(clampDepth(2.9)).toBe(2);
    expect(clampDepth(999)).toBe(MAX_DEPTH);
  });

  it('이름과 배율을 사람이 읽는 글로 적는다', () => {
    expect(depthName(0)).toBe('보통 밤');
    expect(depthName(3)).toBe('깊은 밤 3');
    expect(formatTimes(1.5)).toBe('×1.5');
    expect(formatTimes(2)).toBe('×2');
    expect(formatTimes(1.25)).toBe('×1.25');
  });
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

  it('무기는 열두 가지이고, 늘어놓는 순서에 빠진 것이 없다', () => {
    expect(WEAPON_ORDER).toHaveLength(12);
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
    for (const id of STAGE_ORDER) {
      const { spawns } = STAGES[id];
      expect(spawns.some((row) => row.from === 0)).toBe(true);
      for (const row of spawns) {
        expect(row.from).toBeLessThan(RUN_SECONDS);
        expect(ENEMIES[row.kind].boss).toBeFalsy();
      }
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
    for (const id of STAGE_ORDER) {
      for (const row of STAGES[id].spawns) {
        // 뛰는 적은 뛰는 순간에만 빠르고, 쉬는 시간까지 치면 느리다. 그쪽은 sim 테스트에서 본다.
        if (ENEMIES[row.kind].hops) continue;
        expect(ENEMIES[row.kind].speed * speedScale(RUN_SECONDS)).toBeLessThan(playerSpeed);
      }
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
    expect(late.size).toBe(STAGES.meadow.spawns.length);
    // 스테이지마다 제 적만 나온다.
    const marsh = new Set<string>();
    for (let i = 0; i < 400; i += 1) marsh.add(pickSpawnKind(RUN_SECONDS, rand, 'marsh'));
    expect([...marsh].sort()).toEqual(STAGES.marsh.spawns.map((row) => row.kind).sort());
    for (const kind of marsh) expect(late.has(kind)).toBe(false);
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
      const [r0, r1] = [bellStats(level - 1, base), bellStats(level, base)];
      expect((r1.damage * r1.radius * r1.rings) / r1.cooldown).toBeGreaterThanOrEqual(
        (r0.damage * r0.radius * r0.rings) / r0.cooldown,
      );
      expect(r1.push).toBeGreaterThanOrEqual(r0.push);
      const [m0, m1] = [moonStats(level - 1, base), moonStats(level, base)];
      expect((m1.damage * m1.count * m1.reach) / m1.cooldown).toBeGreaterThanOrEqual(
        (m0.damage * m0.count * m0.reach) / m0.cooldown,
      );
      const [h0, h1] = [beamStats(level - 1, base), beamStats(level, base)];
      expect(h1.damage * h1.count * h1.length * h1.spin).toBeGreaterThanOrEqual(h0.damage * h0.count * h0.length * h0.spin);
      expect(h1.length).toBeGreaterThanOrEqual(h0.length);
      const [t0, t1] = [torchStats(level - 1, base), torchStats(level, base)];
      expect((t1.damage * t1.count * t1.reach * t1.arc) / t1.cooldown).toBeGreaterThanOrEqual(
        (t0.damage * t0.count * t0.reach * t0.arc) / t0.cooldown,
      );
      expect(t1.push).toBeGreaterThanOrEqual(t0.push);
      const [p0, p1] = [lampStats(level - 1, base), lampStats(level, base)];
      expect((p1.damage * p1.count * p1.radius * p1.duration) / (p1.tick * p1.cooldown)).toBeGreaterThanOrEqual(
        (p0.damage * p0.count * p0.radius * p0.duration) / (p0.tick * p0.cooldown),
      );
    }
  });

  it('횃불은 4레벨부터 맞은편도 베고, 진화하면 벤 그림자를 밀쳐 낸다', () => {
    expect([1, 3, 4, MAX_LEVEL, EVOLVE_LEVEL].map((level) => torchStats(level, base).count)).toEqual([1, 1, 2, 2, 2]);
    expect(torchStats(MAX_LEVEL, base).push).toBe(0);
    expect(torchStats(EVOLVE_LEVEL, base).push).toBeGreaterThan(0);
    // 3레벨에 부채꼴이 넓어지고, 범위 강화로 닿는 거리가 는다.
    expect(torchStats(3, base).arc).toBeGreaterThan(torchStats(2, base).arc);
    expect(torchStats(1, modifiers({ lens: 2 }, {})).reach).toBeCloseTo(torchStats(1, base).reach * 1.2);
  });

  it('풍등은 하나에서 셋으로 늘고, 진화하면 넷이 더 크고 오래 머문다', () => {
    expect([1, 2, 4, MAX_LEVEL, EVOLVE_LEVEL].map((level) => lampStats(level, base).count)).toEqual([1, 2, 2, 3, 4]);
    expect(lampStats(4, base).duration).toBeGreaterThan(lampStats(3, base).duration);
    expect(lampStats(EVOLVE_LEVEL, base).radius).toBeGreaterThan(lampStats(MAX_LEVEL, base).radius);
    expect(lampStats(1, modifiers({ hourglass: 1 }, {})).cooldown).toBeCloseTo(lampStats(1, base).cooldown * 0.93);
  });

  it('등대빛은 범위 강화로 길어지고, 재사용이 줄면 빨리 돈다', () => {
    const plain = beamStats(1, base);
    expect(beamStats(1, modifiers({ lens: 2 }, {})).length).toBeCloseTo(plain.length * 1.2);
    expect(beamStats(1, modifiers({ hourglass: 1 }, {})).spin).toBeCloseTo(plain.spin / 0.93);
    expect(beamStats(1, modifiers({ wick: 1 }, {})).damage).toBeCloseTo(plain.damage * 1.1);
    // 한 줄기에서 둘, 진화하면 셋
    expect([1, 3, 4, MAX_LEVEL, EVOLVE_LEVEL].map((level) => beamStats(level, base).count)).toEqual([1, 1, 2, 2, 3]);
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
      const r = bellStats(level, base);
      const m = moonStats(level, base);
      const h = beamStats(level, base);
      const t = torchStats(level, base);
      const p = lampStats(level, base);
      // 초승달은 가는 길과 오는 길에 한 번씩, 보름달은 나는 동안 rehit초마다 벤다.
      const cuts = m.rehit > 0 ? (2 * m.reach) / m.speed / m.rehit : 2;
      return [
        (e.damage * e.count * (1 + e.pierce)) / e.cooldown,
        (a.damage * a.radius ** 2) / a.tick,
        (f.damage * f.count) / f.rehit,
        (s.damage * s.count * s.radius ** 2) / s.cooldown,
        (l.damage * l.count * l.radius) / l.cooldown,
        (o.damage * o.radius ** 2 * o.duration) / o.cooldown,
        (b.damage * b.jumps * b.chains) / b.cooldown,
        (r.damage * r.radius ** 2 * r.rings) / r.cooldown,
        (m.damage * m.count * cuts) / m.cooldown,
        h.damage * h.count * h.length ** 2 * h.spin,
        (t.damage * t.count * t.reach ** 2 * t.arc) / t.cooldown,
        (p.damage * p.count * p.radius ** 2 * p.duration) / (p.tick * p.cooldown),
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

  it('약초 주머니는 올릴수록 빨리 낫고, 영구 강화의 회복과 더해진다', () => {
    expect(base.regen).toBe(0);
    expect(modifiers({ herb: 1 }, {}).regen).toBeCloseTo(0.2);
    expect(modifiers({ herb: MAX_LEVEL }, {}).regen).toBeCloseTo(1);
    expect(modifiers({ herb: 2 }, { mend: 3 }).regen).toBeCloseTo(0.4 + 0.3);
  });

  it('횃불잡이는 처음부터 상처가 아물고, 약초 주머니와 영구 강화의 회복이 그 위에 더해진다', () => {
    const trait = HEROES.bearer.trait;
    expect(modifiers({}, {}, trait).regen).toBeCloseTo(0.4);
    expect(modifiers({ herb: 1 }, { mend: 1 }, trait).regen).toBeCloseTo(0.4 + 0.2 + 0.1);
    expect(modifiers({}, {}, trait).maxHp).toBe(base.maxHp + 10);
    expect(modifiers({}, {}, trait).xp).toBeCloseTo(0.9);
    // 다른 캐릭터는 저절로 아물지 않는다.
    expect(modifiers({}, {}, HEROES.ringer.trait).regen).toBe(0);
  });

  it('부싯돌은 올릴수록 자주 터지지만, 다 올려도 절반을 넘지 않는다', () => {
    expect(base.spark).toBe(0);
    expect(sparkChance(0)).toBe(0);
    for (let level = 1; level <= MAX_LEVEL; level += 1) {
      expect(modifiers({ flint: level }, {}).spark).toBeCloseTo(sparkChance(level));
      expect(sparkChance(level)).toBeGreaterThan(sparkChance(level - 1));
    }
    expect(sparkChance(MAX_LEVEL)).toBeLessThan(0.5);
    // 선택 카드에는 그 레벨에서 터질 확률이 적힌다.
    expect(upgradeDescription({ type: 'passive', id: 'flint', level: 3 })).toContain('21%');
  });

  it('등갓은 올릴수록 빛막이 빨리 다시 생기고, 없으면 빛막도 없다', () => {
    expect(base.guard).toBe(0);
    expect(modifiers({ hood: 1 }, {}).guard).toBe(GUARD.seconds);
    const waits = Array.from({ length: MAX_LEVEL }, (_, i) => modifiers({ hood: i + 1 }, {}).guard);
    for (let i = 1; i < waits.length; i += 1) expect(waits[i]).toBeLessThan(waits[i - 1]);
    // 다 올려도 맞을 때마다 막아 주지는 않는다.
    expect(waits[MAX_LEVEL - 1]).toBeGreaterThanOrEqual(10);
    // 선택 카드에는 그 레벨에서 몇 초마다 막아 주는지가 적힌다.
    expect(upgradeDescription({ type: 'passive', id: 'hood', level: 1 })).toContain(`${GUARD.seconds}초`);
    expect(upgradeDescription({ type: 'passive', id: 'hood', level: 3 })).toContain(`${waits[2]}초`);
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
    // 패시브는 칸 수만큼만 들 수 있으므로, 그만큼 다 올리면 남은 하나는 나오지 않는다.
    for (const id of (Object.keys(PASSIVES) as PassiveId[]).slice(0, MAX_PASSIVES)) full.passives[id] = MAX_LEVEL;
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

  it('잔치의 밤에서는 무기 여섯 칸이 찰 때까지 새 무기가 나온다', () => {
    expect(weaponSlotCount(undefined)).toBe(MAX_WEAPONS);
    expect(weaponSlotCount(null)).toBe(MAX_WEAPONS);
    expect(weaponSlotCount(true)).toBe(MAX_WEAPONS);
    expect(weaponSlotCount('wild')).toBe(MAX_WEAPONS);
    for (const level of FEAST_ORDER) expect(weaponSlotCount(level)).toBe(FEAST.weapons);
    expect(FEAST.weapons).toBeGreaterThan(MAX_WEAPONS);
    const rand = seededRandom(13);
    // 넷을 든 채로도 새 무기가 나온다.
    const four: Build = { weapons: { ember: 1, aura: 1, lance: 1, bolt: 1 }, passives: {}, slots: FEAST.weapons };
    const fresh = new Set<WeaponId>();
    for (let i = 0; i < 300; i += 1) {
      for (const option of upgradeOptions(four, rand)) if (option.type === 'weapon' && !four.weapons[option.id]) fresh.add(option.id);
    }
    expect(fresh.size).toBe(WEAPON_ORDER.length - 4);
    // 여섯이 차면 더는 나오지 않는다.
    const six: Build = { ...four, weapons: { ...four.weapons, star: 1, moon: 1 } };
    expect(ownedWeapons(six.weapons)).toHaveLength(FEAST.weapons);
    for (let i = 0; i < 200; i += 1) {
      for (const option of upgradeOptions(six, rand)) {
        if (option.type === 'weapon') expect(six.weapons[option.id]).toBe(1);
      }
    }
  });

  it('패시브 칸이 다 차면 새 패시브는 나오지 않고, 든 것만 더 올릴 수 있다', () => {
    const all = Object.keys(PASSIVES) as PassiveId[];
    expect(all.length).toBeGreaterThan(MAX_PASSIVES);
    const rand = seededRandom(5);
    const packed: Build = { weapons: { ember: 1 }, passives: {} };
    for (const id of all.slice(0, MAX_PASSIVES)) packed.passives[id] = 1;
    expect(ownedPassives(packed.passives)).toHaveLength(MAX_PASSIVES);
    for (let i = 0; i < 200; i += 1) {
      for (const option of upgradeOptions(packed, rand)) {
        if (option.type === 'passive') expect(packed.passives[option.id]).toBe(1);
      }
    }
    // 칸이 남아 있으면 어느 패시브든 나온다.
    const seen = new Set<PassiveId>();
    for (let i = 0; i < 400; i += 1) {
      for (const option of upgradeOptions({ weapons: { ember: 1 }, passives: {} }, rand)) {
        if (option.type === 'passive') seen.add(option.id);
      }
    }
    expect(seen.size).toBe(all.length);
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

  it('마지막 보스가 나온 뒤에 쓰러뜨린 것은 점수와 불씨를 올리지 않는다', () => {
    const clear = run({ seconds: 600, kills: 6300, bossKills: 5, cleared: true });
    // 보스를 남겨 두고 오래 버텨서 처치 수만 늘린 판
    const stalled = run({ seconds: 600, kills: 21000, countedKills: 6300, bossKills: 5, cleared: true });
    expect(scoreFor(stalled)).toBe(scoreFor(clear));
    expect(embersFor(stalled)).toBe(embersFor(clear));
    expect(embersFor(stalled, 3)).toBe(embersFor(clear, 3));
  });

  it('끝없는 밤에서 버틴 시간과 쓰러뜨린 것도 점수와 불씨에 든다', () => {
    const dawn = run({ seconds: 600, kills: 6000, bossKills: 5, cleared: true });
    const endless = run({ seconds: 900, endlessSeconds: 300, kills: 9000, bossKills: 8, cleared: true });
    expect(scoreFor(endless) - scoreFor(dawn)).toBe(300 + 3000 + 150 * 3);
    // 불씨는 버틴 5분(15)과 쓰러뜨린 3000(75), 보스 셋(24)만큼 는다.
    expect(embersFor(endless) - embersFor(dawn)).toBe(15 + 75 + 24);
  });

  it('잔치의 밤의 점수와 불씨에는 난이도의 배율이 붙는다', () => {
    const plain = run({ seconds: 900, endlessSeconds: 300, kills: 9000, bossKills: 8, cleared: true, depth: 2 });
    const earned = 15 * 3 + Math.floor(9000 / 40) + 8 * 8 + 40;
    for (const level of FEAST_ORDER) {
      const feast: RunSummary = { ...plain, feast: level };
      const { reward } = FEAST_LEVELS[level];
      expect(feastReward(level)).toBe(reward);
      expect(scoreFor(feast)).toBe(Math.floor((900 + 9000 + 150 * 8 + 1000) * depthRules(2).score * reward));
      expect(embersFor(feast, 2)).toBe(Math.floor(earned * depthRules(2).embers * 1.2 * reward));
    }
    // 보통 판이나 엉뚱한 값에는 배율이 붙지 않는다.
    expect(feastReward(undefined)).toBe(1);
    expect(feastReward('wild')).toBe(1);
    expect(scoreFor({ ...plain, feast: undefined })).toBe(scoreFor(plain));
    expect(embersFor({ ...plain, feast: undefined })).toBe(embersFor(plain));
  });

  it('잔치의 밤은 쉬울수록 경험치를 많이 주고, 점수와 불씨의 배율은 작다', () => {
    const levels = FEAST_ORDER.map((level) => FEAST_LEVELS[level]);
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i].xp).toBeLessThan(levels[i - 1].xp);
      expect(levels[i].reward).toBeGreaterThan(levels[i - 1].reward);
    }
    for (const level of levels) {
      // 무기 칸이 늘어난 만큼 어느 난이도든 경험치를 더 주고, 어느 난이도든 보통 판보다 점수를 더 주지는 않는다.
      expect(level.xp).toBeGreaterThan(1);
      expect(level.reward).toBeGreaterThan(0);
      expect(level.reward).toBeLessThan(1);
    }
  });

  it('잔치의 밤의 이름과 한 줄 설명', () => {
    expect(feastTitle('easy')).toBe(`${FEAST.name} · 쉬움`);
    expect(feastNote('easy')).toBe(`쉬움 · 점수와 불씨 ${formatTimes(FEAST_LEVELS.easy.reward)}`);
    for (const level of FEAST_ORDER) expect(feastNote(level)).toContain(FEAST_LEVELS[level].name);
  });

  it('점수는 랭킹이 받는 가장 큰 값을 넘지 않는다', () => {
    const huge = run({ seconds: 9000, kills: 5e6, bossKills: 90, cleared: true, depth: MAX_DEPTH });
    expect(scoreFor(huge)).toBe(MAX_SCORE);
  });

  it('끝없는 밤의 그림자는 1분마다 세진다', () => {
    expect(endlessScale(0)).toEqual({ hp: 1, damage: 1, speed: 1 });
    expect(endlessScale(-5)).toEqual({ hp: 1, damage: 1, speed: 1 });
    const one = endlessScale(60);
    expect(one.hp).toBeCloseTo(ENDLESS.hp);
    expect(one.damage).toBeCloseTo(ENDLESS.damage);
    expect(one.speed).toBeCloseTo(1 + ENDLESS.speed);
    const five = endlessScale(300);
    expect(five.hp).toBeCloseTo(ENDLESS.hp ** 5);
    expect(five.hp).toBeGreaterThan(one.hp);
    // 받는 피해도 곱으로 자란다.
    expect(five.damage).toBeCloseTo(ENDLESS.damage ** 5);
    // 빠르기는 끝없이 오르지 않는다.
    expect(endlessScale(6000).speed).toBeCloseTo(1 + ENDLESS.maxSpeed);
    for (const id of STAGE_ORDER) {
      expect(STAGES[id].midBosses).toContain(endlessBossKind(id, 7));
    }
  });

  it('밤의 축복은 받은 횟수만큼 겹친다', () => {
    const none = modifiers({}, {});
    expect(modifiers({}, {}, {}, {})).toEqual(none);
    const once = modifiers({}, {}, {}, { blaze: 1, haste: 1, bulwark: 1, ward: 1, bloom: 1, breath: 1 });
    expect(once.damage).toBeCloseTo(none.damage * (1 + BOON_VALUES.blaze));
    expect(once.cooldown).toBeCloseTo(none.cooldown * BOON_VALUES.haste);
    expect(once.maxHp).toBe(none.maxHp + BOON_VALUES.bulwark);
    expect(once.taken).toBeCloseTo(none.taken * BOON_VALUES.ward);
    expect(once.area).toBeCloseTo(none.area * (1 + BOON_VALUES.bloom));
    expect(once.regen).toBeCloseTo(none.regen + BOON_VALUES.breath);
    const thrice = modifiers({ wick: 2 }, { might: 3 }, {}, { blaze: 3, ward: 3 });
    expect(thrice.damage).toBeCloseTo(modifiers({ wick: 2 }, { might: 3 }).damage * (1 + 3 * BOON_VALUES.blaze));
    expect(thrice.taken).toBeCloseTo(BOON_VALUES.ward ** 3);
    // 엉뚱한 값은 받지 않은 것으로 본다.
    expect(boonLevel({ blaze: -2 }, 'blaze')).toBe(0);
    expect(boonLevel({ blaze: Number.NaN }, 'blaze')).toBe(0);
    expect(boonLevel(undefined, 'ward')).toBe(0);
    expect(boonLevel({ ward: 2.9 }, 'ward')).toBe(2);
  });

  it('보물 상자는 가진 것 가운데 아직 올릴 수 있는 것만 올린다', () => {
    const rand = seededRandom(9);
    const build = { weapons: { ember: 2, star: MAX_LEVEL, lance: EVOLVE_LEVEL }, passives: { wick: 4, coat: MAX_LEVEL } };
    const seen = new Set<string>();
    for (let i = 0; i < 60; i += 1) {
      const upgrade = chestUpgrade(build, rand);
      if (!upgrade || (upgrade.type !== 'weapon' && upgrade.type !== 'passive')) throw new Error('올릴 것이 나오지 않았다');
      seen.add(`${upgrade.id}${upgrade.level}`);
    }
    // 새 무기나 패시브, 다 올린 것, 진화는 나오지 않는다.
    expect([...seen].sort()).toEqual(['ember3', 'wick5']);
    expect(chestUpgrade({ weapons: { ember: MAX_LEVEL }, passives: {} }, rand)).toBeNull();
    expect(chestUpgrade({ weapons: {}, passives: {} }, rand)).toBeNull();
    // 난수가 끝 값이어도 목록 밖을 가리키지 않는다.
    expect(chestUpgrade(build, () => 0.999999)).toEqual({ type: 'passive', id: 'wick', level: 5 });
    expect(chestUpgrade(build, () => 0)).toEqual({ type: 'weapon', id: 'ember', level: 3 });
  });

  it('밤의 축복 선택지는 겹치지 않고, 설명의 숫자가 실제 값과 맞는다', () => {
    const rand = seededRandom(5);
    for (let i = 0; i < 30; i += 1) {
      const options = boonOptions({ blaze: 2 }, rand);
      expect(options).toHaveLength(3);
      const ids = options.map((u) => (u.type === 'boon' ? u.id : ''));
      expect(new Set(ids).size).toBe(3);
      for (const upgrade of options) {
        if (upgrade.type !== 'boon') throw new Error('축복이 아닌 것이 나왔다');
        expect(upgrade.level).toBe(upgrade.id === 'blaze' ? 3 : 1);
        expect(upgradeTitle(upgrade)).toBe(BOONS[upgrade.id].name);
        expect(upgradeDescription(upgrade)).toBe(BOONS[upgrade.id].description);
      }
    }
    expect(boonOptions({}, rand, 99)).toHaveLength(BOON_ORDER.length);
    expect(BOONS.blaze.description).toContain(`${Math.round(BOON_VALUES.blaze * 100)}%`);
    expect(BOONS.haste.description).toContain(`${Math.round((1 - BOON_VALUES.haste) * 100)}%`);
    expect(BOONS.bulwark.description).toContain(`+${BOON_VALUES.bulwark}`);
    expect(BOONS.ward.description).toContain(`${Math.round((1 - BOON_VALUES.ward) * 100)}%`);
    expect(BOONS.bloom.description).toContain(`${Math.round(BOON_VALUES.bloom * 100)}%`);
    expect(BOONS.breath.description).toContain(String(BOON_VALUES.breath));
  });

  it('깊은 밤에서는 단계의 배율만큼 점수와 불씨가 붙는다', () => {
    const plain = run({ seconds: 600, kills: 6000, bossKills: 5, cleared: true });
    const deep = run({ seconds: 600, kills: 6000, bossKills: 5, cleared: true, depth: 2 });
    expect(scoreFor(deep)).toBe(Math.floor(scoreFor(plain) * depthRules(2).score));
    expect(embersFor(deep)).toBe(Math.floor(embersFor(plain) * depthRules(2).embers));
    expect(scoreFor(run({ seconds: 600, kills: 6000, depth: 99 }))).toBe(scoreFor(run({ seconds: 600, kills: 6000, depth: MAX_DEPTH })));
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
    // 깊은 밤에서 점수가 크게 불어도 코인은 상한에서 멈춘다.
    expect(coinsFor(8999)).toBe(149);
    expect(coinsFor(9000)).toBe(COIN_CAP);
    expect(coinsFor(60000)).toBe(COIN_CAP);
  });

  it('시간을 분:초로 적는다', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65.9)).toBe('1:05');
    expect(formatClock(600)).toBe('10:00');
  });
});
