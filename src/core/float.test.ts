import { describe, expect, it } from 'vitest';
import { FLOAT_MARGIN, FLOAT_PAD, floatCenter } from './float';

describe('떠오르는 글의 자리', () => {
  const LEFT = 0;
  const RIGHT = 240;

  it('안쪽에서 띄운 글은 그 자리에 뜬다', () => {
    expect(floatCenter(120, 60, LEFT, RIGHT)).toBe(120);
    expect(floatCenter(70, 40, LEFT, RIGHT)).toBe(70);
  });

  it('짧은 글은 가장자리에서 정해 둔 만큼만 떨어진다', () => {
    expect(floatCenter(3, 16, LEFT, RIGHT)).toBe(FLOAT_MARGIN);
    expect(floatCenter(239, 16, LEFT, RIGHT)).toBe(RIGHT - FLOAT_MARGIN);
  });

  it('긴 글은 양 끝이 밖으로 나가지 않을 만큼 안쪽으로 당겨진다', () => {
    // 새싹 컴퍼니의 사옥에서 맨 왼쪽과 맨 오른쪽 자리의 버그를 잡았을 때: 너비 80의 글이 x 36과 204에서 뜬다.
    for (const [x, width] of [
      [36, 80],
      [204, 80],
      [36, 120],
      [0, 200],
    ]) {
      const center = floatCenter(x, width, LEFT, RIGHT);
      expect(center - width / 2, `x ${x}, 너비 ${width}`).toBeGreaterThanOrEqual(LEFT + FLOAT_PAD);
      expect(center + width / 2, `x ${x}, 너비 ${width}`).toBeLessThanOrEqual(RIGHT - FLOAT_PAD);
    }
    expect(floatCenter(36, 80, LEFT, RIGHT)).toBe(42);
    expect(floatCenter(204, 80, LEFT, RIGHT)).toBe(198);
  });

  it('칸보다 넓은 글은 가운데에 둔다', () => {
    expect(floatCenter(10, 300, LEFT, RIGHT)).toBe(120);
    expect(floatCenter(230, 240, LEFT, RIGHT)).toBe(120);
  });

  it('왼쪽이 0이 아닌 칸에서도 그 칸 안에 둔다', () => {
    const center = floatCenter(12, 60, 10, 110);
    expect(center - 30).toBeGreaterThanOrEqual(10 + FLOAT_PAD);
    expect(floatCenter(108, 60, 10, 110) + 30).toBeLessThanOrEqual(110 - FLOAT_PAD);
  });
});
