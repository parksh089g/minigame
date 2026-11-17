import { describe, expect, it } from 'vitest';
import { wholePercents } from './percent';
import { CHARMS, oddsOf } from './rules';

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

describe('더해서 100이 되는 퍼센트', () => {
  it('따로 반올림하면 101이 되는 몫도 100으로 맞춘다', () => {
    // 따로 반올림하면 17 + 17 + 17 + 17 + 17 + 17 = 102
    expect(wholePercents([1, 1, 1, 1, 1, 1])).toEqual([17, 17, 17, 17, 16, 16]);
    expect(wholePercents([1, 1, 1])).toEqual([34, 33, 33]);
  });

  it('딱 떨어지는 몫은 그대로다', () => {
    expect(wholePercents([1, 1, 2])).toEqual([25, 25, 50]);
    expect(wholePercents([0.3, 0.2, 0.5])).toEqual([30, 20, 50]);
  });

  it('잘려 나간 소수가 큰 것부터 올린다', () => {
    // 49.5, 30.3, 20.2 → 내림 49, 30, 20 (합 99) → 소수가 가장 큰 첫째가 오른다
    expect(wholePercents([49.5, 30.3, 20.2])).toEqual([50, 30, 20]);
  });

  it('몫이 없으면 모두 0이다', () => {
    expect(wholePercents([0, 0])).toEqual([0, 0]);
    expect(wholePercents([])).toEqual([]);
  });

  it('부적을 하나 붙이든 다섯을 붙이든 확률 줄의 합은 100이다', () => {
    expect(sum(wholePercents(oddsOf([])))).toBe(100);
    for (const charm of CHARMS) {
      expect(sum(wholePercents(oddsOf([charm.id]))), charm.name).toBe(100);
    }
    const ids = CHARMS.map((charm) => charm.id);
    for (let start = 0; start + 5 <= ids.length; start += 1) {
      const picked = ids.slice(start, start + 5);
      expect(sum(wholePercents(oddsOf(picked))), picked.join(',')).toBe(100);
    }
  });
});
