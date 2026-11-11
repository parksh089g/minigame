import { describe, expect, it } from 'vitest';
import { META } from './data';
import { applyRun, buyMeta, createDefaultMeta, normalizeMeta } from './meta';
import { metaCost } from './rules';

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
