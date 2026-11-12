import { describe, expect, it } from 'vitest';
import { Limiter, LIMITS, placeOf } from './limiter';

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

describe('요청을 세는 곳', () => {
  it('IPv4 주소는 그대로 쓴다', () => {
    expect(placeOf('203.0.113.7')).toBe('203.0.113.7');
    expect(placeOf(' 203.0.113.7 ')).toBe('203.0.113.7');
  });

  it('IPv6 주소는 앞 64비트가 같으면 같은 곳으로 센다', () => {
    const home = placeOf('2001:db8:12:3400:1111:2222:3333:4444');
    expect(home).toBe('2001:db8:12:3400::/64');
    expect(placeOf('2001:db8:12:3400::1')).toBe(home);
    expect(placeOf('2001:0DB8:0012:3400:ffff:ffff:ffff:ffff')).toBe(home);
    // 앞 64비트가 다르면 다른 곳이다.
    expect(placeOf('2001:db8:12:3401::1')).not.toBe(home);
  });

  it('줄여 쓴 IPv6 주소도 펴서 읽는다', () => {
    expect(placeOf('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(placeOf('2001:db8:0:0:0:0:0:1')).toBe('2001:db8:0:0::/64');
    expect(placeOf('::1')).toBe('0:0:0:0::/64');
    expect(placeOf('fe80::')).toBe('fe80:0:0:0::/64');
    expect(placeOf('1:2:3:4:5:6:7::')).toBe('1:2:3:4::/64');
  });

  it('IPv4 주소를 품은 모양은 한데 묶지 않는다', () => {
    expect(placeOf('::ffff:203.0.113.7')).toBe('::ffff:203.0.113.7');
    expect(placeOf('::ffff:203.0.113.8')).not.toBe(placeOf('::ffff:203.0.113.7'));
  });

  it('주소가 없으면 한 이름으로 세고, 읽을 수 없는 주소는 받은 대로 쓴다', () => {
    expect(placeOf(null)).toBe('unknown');
    expect(placeOf('')).toBe('unknown');
    const odd = ['1::2::3', '1:2:3', '1:2:3:4:5:6:7:8:9', 'zzzz::1', '12345::1', '1:2:3:4:5:6:7:8::', 'fe80::1%eth0'];
    for (const address of odd) expect(placeOf(address), address).toBe(address);
  });
});
