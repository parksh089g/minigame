import { describe, expect, it } from 'vitest';
import {
  accuracy,
  comboBonus,
  goldChance,
  maxOrbs,
  orbLifetime,
  pointsFor,
  ROUND_SECONDS,
  spawnInterval,
} from './rules';

const seconds = Array.from({ length: ROUND_SECONDS + 1 }, (_, t) => t);

describe('난이도 곡선', () => {
  it('시간이 갈수록 어려워지기만 한다', () => {
    for (const t of seconds.slice(1)) {
      expect(orbLifetime(t)).toBeLessThanOrEqual(orbLifetime(t - 1));
      expect(spawnInterval(t)).toBeLessThanOrEqual(spawnInterval(t - 1));
      expect(maxOrbs(t)).toBeGreaterThanOrEqual(maxOrbs(t - 1));
    }
  });

  it('끝까지 사람이 반응할 수 있는 범위에 머문다', () => {
    for (const t of seconds) {
      expect(orbLifetime(t)).toBeGreaterThanOrEqual(0.65);
      expect(orbLifetime(t, 'gold')).toBeGreaterThanOrEqual(0.5);
      expect(spawnInterval(t)).toBeGreaterThanOrEqual(0.3);
      expect(maxOrbs(t)).toBeGreaterThanOrEqual(1);
      expect(maxOrbs(t)).toBeLessThanOrEqual(4);
    }
  });

  it('금색 구슬은 처음 4초 동안 나오지 않고 일반 구슬보다 빨리 사라진다', () => {
    expect(goldChance(0)).toBe(0);
    expect(goldChance(3.9)).toBe(0);
    expect(goldChance(4)).toBeGreaterThan(0);
    expect(orbLifetime(10, 'gold')).toBeLessThan(orbLifetime(10, 'normal'));
  });
});

describe('점수', () => {
  it('콤보 5번마다 보너스가 1점씩 붙고 3점에서 멈춘다', () => {
    expect(comboBonus(0)).toBe(0);
    expect(comboBonus(4)).toBe(0);
    expect(comboBonus(5)).toBe(1);
    expect(comboBonus(10)).toBe(2);
    expect(comboBonus(15)).toBe(3);
    expect(comboBonus(100)).toBe(3);
    expect(comboBonus(-1)).toBe(0);
  });

  it('일반 구슬은 1점, 금색 구슬은 5점에 보너스를 더한다', () => {
    expect(pointsFor('normal', 0)).toBe(1);
    expect(pointsFor('gold', 0)).toBe(5);
    expect(pointsFor('normal', 7)).toBe(2);
    expect(pointsFor('gold', 20)).toBe(8);
  });

  it('정확도는 누른 횟수 가운데 명중한 비율이다', () => {
    expect(accuracy(0, 0)).toBe(0);
    expect(accuracy(10, 0)).toBe(100);
    expect(accuracy(3, 1)).toBe(75);
    expect(accuracy(1, 2)).toBe(33);
  });
});
