import { describe, expect, it } from 'vitest';
import { Limiter, LIMITS } from './limiter';

describe('요청 한도', () => {
  it('정해진 횟수까지만 지나가고, 구간이 지나면 다시 지나간다', () => {
    const limiter = new Limiter();
    for (let n = 0; n < 3; n += 1) expect(limiter.allow('a', 3, 1000, 100 + n)).toBe(true);
    expect(limiter.allow('a', 3, 1000, 500)).toBe(false);
    expect(limiter.allow('a', 3, 1000, 1099)).toBe(false);
    expect(limiter.allow('a', 3, 1000, 1100)).toBe(true);
  });

  it('곳마다 따로 센다', () => {
    const limiter = new Limiter();
    expect(limiter.allow('a', 1, 1000, 0)).toBe(true);
    expect(limiter.allow('a', 1, 1000, 1)).toBe(false);
    expect(limiter.allow('b', 1, 1000, 1)).toBe(true);
  });

  it('오래된 기록은 치워서 끝없이 쌓이지 않는다', () => {
    const limiter = new Limiter();
    const hour = 60 * 60 * 1000;
    for (let n = 0; n < 5000; n += 1) limiter.allow(`ip-${n}`, 5, 1000, n * 10);
    expect(limiter.size).toBeLessThanOrEqual(2000);
    // 한참 뒤에는 예전 기록이 모두 치워진다.
    for (let n = 0; n < 2100; n += 1) limiter.allow(`late-${n}`, 5, 1000, 10 * hour + n);
    expect(limiter.size).toBeLessThanOrEqual(2000);
  });

  it('한도는 모두 1번 이상이고 구간은 한 시간을 넘지 않는다', () => {
    for (const [kind, [limit, windowMs]] of Object.entries(LIMITS)) {
      expect(limit, kind).toBeGreaterThanOrEqual(1);
      expect(windowMs, kind).toBeGreaterThan(0);
      expect(windowMs, kind).toBeLessThanOrEqual(60 * 60 * 1000);
    }
  });
});
