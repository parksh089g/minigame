import { describe, expect, it } from 'vitest';
import { HERO_ORDER, HEROES, META, META_ORDER, STAGE_ORDER, STAGES } from './data';
import {
  applyRun,
  buyMeta,
  chooseHero,
  chooseStage,
  createDefaultMeta,
  newUnlocks,
  normalizeMeta,
} from './meta';
import { embersFor, isUnlocked, metaCost, type RunSummary } from './rules';

describe('영구 강화 사기', () => {
  it('불씨가 충분하면 한 단계 오르고 값만큼 줄어든다', () => {
    const cost = metaCost('vigor', 0)!;
    const meta = { ...createDefaultMeta(), embers: cost + 3 };
    const next = buyMeta(meta, 'vigor');
    expect(next.upgrades.vigor).toBe(1);
    expect(next.embers).toBe(3);
    expect(meta.upgrades.vigor).toBeUndefined();
  });

  it('불씨가 모자라거나 최대 단계면 그대로다', () => {
    const poor = { ...createDefaultMeta(), embers: metaCost('might', 0)! - 1 };
    expect(buyMeta(poor, 'might')).toBe(poor);
    const maxed = { ...createDefaultMeta(), embers: 9999, upgrades: { reach: META.reach.maxLevel } };
    expect(buyMeta(maxed, 'reach')).toBe(maxed);
  });
});

describe('판 결과 반영', () => {
  it('불씨와 횟수, 최고 기록이 쌓인다', () => {
    let meta = createDefaultMeta();
    meta = applyRun(meta, 20, 185.7, false);
    meta = applyRun(meta, 60, 600, true);
    meta = applyRun(meta, 5, 90, false);
    expect(meta).toMatchObject({ embers: 85, runs: 3, clears: 1, bestSeconds: 600 });
  });
});

describe('저장된 값 읽기', () => {
  it('없거나 망가진 값은 기본값이 된다', () => {
    expect(normalizeMeta(undefined)).toEqual(createDefaultMeta());
    expect(normalizeMeta('x')).toEqual(createDefaultMeta());
    expect(normalizeMeta({ embers: -5, upgrades: 3 })).toEqual(createDefaultMeta());
  });

  it('모르는 강화는 버리고 단계는 최대를 넘지 않는다', () => {
    const meta = normalizeMeta({
      embers: 12.9,
      runs: 4,
      upgrades: { vigor: 99, swift: 2, unknown: 3, might: 'a' },
    });
    expect(meta.embers).toBe(12);
    expect(meta.runs).toBe(4);
    expect(meta.upgrades).toEqual({ vigor: META.vigor.maxLevel, swift: 2 });
  });
});

describe('캐릭터와 스테이지 고르기', () => {
  it('오래 버틴 기록이 있어야 열린다', () => {
    const fresh = createDefaultMeta();
    expect(fresh).toMatchObject({ hero: 'keeper', stage: 'meadow' });
    expect(chooseHero(fresh, 'stargazer')).toBe(fresh);
    expect(chooseStage(fresh, 'marsh')).toBe(fresh);

    const seasoned = { ...fresh, bestSeconds: HEROES.stargazer.unlockSeconds };
    expect(chooseHero(seasoned, 'stargazer').hero).toBe('stargazer');
    expect(chooseHero(seasoned, 'stormer')).toBe(seasoned);

    const veteran = { ...fresh, bestSeconds: 600 };
    expect(chooseHero(veteran, 'stormer').hero).toBe('stormer');
    expect(chooseStage(veteran, 'marsh').stage).toBe('marsh');
    // 이미 고른 것을 다시 고르면 그대로다.
    expect(chooseHero(veteran, 'keeper')).toBe(veteran);
  });

  it('한 판을 끝까지 버티면 모두 열린다', () => {
    for (const id of HERO_ORDER) expect(isUnlocked(HEROES[id], 600)).toBe(true);
    for (const id of STAGE_ORDER) expect(isUnlocked(STAGES[id], 600)).toBe(true);
    // 뒤에 있는 것일수록 늦게 열린다.
    const heroTimes = HERO_ORDER.map((id) => HEROES[id].unlockSeconds);
    expect([...heroTimes].sort((a, b) => a - b)).toEqual(heroTimes);
  });

  it('기록이 늘면서 새로 열린 것만 알려 준다', () => {
    expect(newUnlocks(0, 100)).toEqual([]);
    expect(newUnlocks(0, 130)).toEqual([HEROES.stargazer.name]);
    expect(newUnlocks(130, 250)).toEqual([STAGES.marsh.name]);
    expect(newUnlocks(130, 130)).toEqual([]);
    expect(newUnlocks(0, 600)).toEqual([HEROES.stargazer.name, HEROES.stormer.name, STAGES.marsh.name]);
    expect(newUnlocks(600, 600)).toEqual([]);
  });

  it('저장된 선택은 열려 있을 때만 되살린다', () => {
    expect(normalizeMeta({ bestSeconds: 600, hero: 'stormer', stage: 'marsh' })).toMatchObject({
      hero: 'stormer',
      stage: 'marsh',
    });
    expect(normalizeMeta({ bestSeconds: 10, hero: 'stormer', stage: 'marsh' })).toMatchObject({
      hero: 'keeper',
      stage: 'meadow',
    });
    expect(normalizeMeta({ bestSeconds: 600, hero: 'nobody', stage: 7 })).toMatchObject({
      hero: 'keeper',
      stage: 'meadow',
    });
  });

  it('예전에 저장한 값은 불씨와 강화를 그대로 두고 기본 선택을 채운다', () => {
    const old = { version: 1, embers: 40, upgrades: { vigor: 2 }, runs: 3, clears: 0, bestSeconds: 200 };
    expect(normalizeMeta(old)).toEqual({ ...createDefaultMeta(), ...old, version: createDefaultMeta().version });
  });
});

describe('늘어난 영구 강화', () => {
  it('여덟 가지이고 모두 살 수 있는 값이 있다', () => {
    expect(META_ORDER).toHaveLength(8);
    for (const id of META_ORDER) {
      expect(metaCost(id, 0)).toBeGreaterThan(0);
      expect(metaCost(id, META[id].maxLevel)).toBeNull();
    }
  });

  it('불씨 복은 한 판에서 얻는 불씨를 늘린다', () => {
    const run: RunSummary = { seconds: 400, kills: 500, level: 14, cleared: false, bonusEmbers: 0, bossKills: 2 };
    const plain = embersFor(run);
    expect(embersFor(run, 0)).toBe(plain);
    expect(embersFor(run, 3)).toBe(Math.floor(plain * 1.3));
    expect(embersFor(run, 1)).toBeGreaterThan(plain);
  });
});
