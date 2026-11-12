import { describe, expect, it } from 'vitest';
import {
  clearedOf,
  clearLevel,
  difficultyOf,
  isUnlocked,
  MILESTONE_COINS,
  nextLevel,
  normalizeStages,
  seededRandom,
  STAGE_COINS,
  STAGE_LEVELS,
  stageCoins,
  stepStart,
  stageRandom,
  toLevel,
  totalCleared,
} from './stages';

describe('seededRandom', () => {
  it('같은 씨앗이면 같은 수들이 같은 차례로 나온다', () => {
    const a = seededRandom('stage:color-sort:7');
    const b = seededRandom('stage:color-sort:7');
    const first = Array.from({ length: 20 }, () => a());
    expect(Array.from({ length: 20 }, () => b())).toEqual(first);
  });

  it('씨앗이 다르면 다른 수가 나온다', () => {
    const a = seededRandom('stage:color-sort:7');
    const b = seededRandom('stage:color-sort:8');
    expect(Array.from({ length: 5 }, () => a())).not.toEqual(Array.from({ length: 5 }, () => b()));
  });

  it('0 이상 1 미만의 수가 고르게 나온다', () => {
    const random = seededRandom('고르게');
    const values = Array.from({ length: 4000 }, () => random());
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(mean).toBeGreaterThan(0.47);
    expect(mean).toBeLessThan(0.53);
    // 열 칸으로 나눠도 어느 칸이 비지 않는다.
    const buckets = Array.from({ length: 10 }, () => 0);
    for (const value of values) buckets[Math.floor(value * 10)] += 1;
    for (const count of buckets) expect(count).toBeGreaterThan(300);
  });
});

describe('stageRandom', () => {
  it('게임과 단계가 같으면 같은 판이 나오고, 하나라도 다르면 달라진다', () => {
    const draw = (random: () => number): number[] => Array.from({ length: 6 }, () => random());
    expect(draw(stageRandom('logic-tiles', 12))).toEqual(draw(stageRandom('logic-tiles', 12)));
    expect(draw(stageRandom('logic-tiles', 12))).not.toEqual(draw(stageRandom('logic-tiles', 13)));
    expect(draw(stageRandom('logic-tiles', 12))).not.toEqual(draw(stageRandom('number-puzzle', 12)));
  });
});

describe('toLevel, difficultyOf', () => {
  it('단계 번호를 1부터 마지막 단계까지의 정수로 맞춘다', () => {
    expect(toLevel(0)).toBe(1);
    expect(toLevel(-3)).toBe(1);
    expect(toLevel(7.9)).toBe(7);
    expect(toLevel(STAGE_LEVELS + 50)).toBe(STAGE_LEVELS);
    expect(toLevel(Number.NaN)).toBe(1);
  });

  it('첫 단계는 가장 쉬운 칸이고 마지막 단계는 가장 어려운 칸이다', () => {
    for (const steps of [1, 2, 7, 8, 12, 18, 40]) {
      expect(difficultyOf(1, steps)).toBe(1);
      expect(difficultyOf(STAGE_LEVELS, steps)).toBe(steps);
      expect(difficultyOf(1, steps, 0)).toBe(0);
      expect(difficultyOf(STAGE_LEVELS, steps, 0)).toBe(steps - 1);
    }
  });

  it('뒤의 단계가 앞의 단계보다 쉬워지지 않고, 어느 칸도 건너뛰지 않는다', () => {
    for (const steps of [1, 2, 7, 8, 12, 18]) {
      let previous = 1;
      for (let level = 1; level <= STAGE_LEVELS; level += 1) {
        const difficulty = difficultyOf(level, steps);
        expect(difficulty - previous === 0 || difficulty - previous === 1).toBe(true);
        previous = difficulty;
      }
    }
  });

  it('쉬운 칸은 짧게 지나가고 어려운 칸에 오래 머문다', () => {
    const steps = 8;
    const lengths = Array.from({ length: steps }, (_, step) => {
      const end = step + 1 < steps ? stepStart(step + 1, steps) : STAGE_LEVELS + 1;
      return end - stepStart(step, steps);
    });
    expect(lengths.reduce((sum, length) => sum + length, 0)).toBe(STAGE_LEVELS);
    for (let step = 1; step < steps; step += 1) {
      expect(lengths[step]).toBeGreaterThanOrEqual(lengths[step - 1]);
    }
    expect(stepStart(0, steps)).toBe(1);
    // 칸이 시작하는 단계가 곧 그 난이도가 처음 나오는 단계다.
    for (let step = 0; step < steps; step += 1) {
      expect(difficultyOf(stepStart(step, steps), steps, 0)).toBe(step);
    }
  });
});

describe('normalizeStages', () => {
  it('깬 단계만 남기고 이상한 값은 버린다', () => {
    expect(
      normalizeStages({
        'color-sort': 12,
        'parking-out': 3.7,
        'logic-tiles': 0,
        'screw-sort': -2,
        'number-puzzle': '5',
        '': 4,
        far: STAGE_LEVELS + 20,
      }),
    ).toEqual({ 'color-sort': 12, 'parking-out': 3, far: STAGE_LEVELS });
  });

  it('객체가 아니면 빈 기록이다', () => {
    expect(normalizeStages(null)).toEqual({});
    expect(normalizeStages([1, 2])).toEqual({});
    expect(normalizeStages('x')).toEqual({});
  });
});

describe('단계 열기', () => {
  it('처음에는 1단계만 열려 있다', () => {
    expect(isUnlocked({}, 'color-sort', 1)).toBe(true);
    expect(isUnlocked({}, 'color-sort', 2)).toBe(false);
    expect(nextLevel({}, 'color-sort')).toBe(1);
    expect(clearedOf({}, 'color-sort')).toBe(0);
  });

  it('깬 단계와 바로 다음 단계가 열려 있다', () => {
    const progress = { 'color-sort': 4 };
    expect([1, 4, 5].every((level) => isUnlocked(progress, 'color-sort', level))).toBe(true);
    expect(isUnlocked(progress, 'color-sort', 6)).toBe(false);
    expect(isUnlocked(progress, 'parking-out', 2)).toBe(false);
    expect(nextLevel(progress, 'color-sort')).toBe(5);
  });

  it('없는 단계는 열리지 않고, 다 깨면 다음 단계가 없다', () => {
    const done = { 'color-sort': STAGE_LEVELS };
    expect(isUnlocked(done, 'color-sort', STAGE_LEVELS)).toBe(true);
    expect(isUnlocked(done, 'color-sort', STAGE_LEVELS + 1)).toBe(false);
    expect(isUnlocked(done, 'color-sort', 0)).toBe(false);
    expect(isUnlocked(done, 'color-sort', 2.5)).toBe(false);
    expect(nextLevel(done, 'color-sort')).toBeNull();
  });

  it('여러 게임에서 깬 단계를 더한다', () => {
    expect(totalCleared({ a: 3, b: 10 }, ['a', 'b', 'c'])).toBe(13);
    expect(totalCleared({ a: 3, b: 10 }, ['c'])).toBe(0);
  });
});

describe('clearLevel', () => {
  it('다음 단계를 깨면 기록이 오르고 코인을 받는다', () => {
    const before = { 'color-sort': 4 };
    const result = clearLevel(before, 'color-sort', 5);
    expect(result).toEqual({ progress: { 'color-sort': 5 }, first: true, coins: STAGE_COINS });
    expect(before).toEqual({ 'color-sort': 4 });
  });

  it('이미 깬 단계를 다시 깨면 기록도 코인도 그대로다', () => {
    const before = { 'color-sort': 4 };
    const result = clearLevel(before, 'color-sort', 2);
    expect(result).toEqual({ progress: before, first: false, coins: 0 });
  });

  it('건너뛴 단계와 없는 단계는 기록하지 않는다', () => {
    expect(clearLevel({ 'color-sort': 4 }, 'color-sort', 6)).toBeNull();
    expect(clearLevel({}, 'color-sort', 0)).toBeNull();
    expect(clearLevel({}, '', 1)).toBeNull();
  });

  it('열 단계마다 고비라서 코인을 더 받는다', () => {
    expect(stageCoins(9)).toBe(STAGE_COINS);
    expect(stageCoins(10)).toBe(MILESTONE_COINS);
    expect(stageCoins(STAGE_LEVELS)).toBe(MILESTONE_COINS);
    expect(clearLevel({ a: 9 }, 'a', 10)?.coins).toBe(MILESTONE_COINS);
  });

  it('한 게임을 끝까지 깨면 받는 코인은 정해진 합이다', () => {
    let progress = {};
    let coins = 0;
    for (let level = 1; level <= STAGE_LEVELS; level += 1) {
      const result = clearLevel(progress, 'a', level);
      if (!result) throw new Error(`${level}단계가 열리지 않았다`);
      progress = result.progress;
      coins += result.coins;
    }
    const milestones = STAGE_LEVELS / 10;
    expect(coins).toBe(milestones * MILESTONE_COINS + (STAGE_LEVELS - milestones) * STAGE_COINS);
  });
});
