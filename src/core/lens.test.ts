import { describe, expect, it } from 'vitest';
import { LENS, lensSpot } from './lens';

const half = LENS.size / 2;

describe('lensSpot', () => {
  it('보통은 칸의 바로 위에 놓고 꼬리가 칸을 가리킨다', () => {
    const spot = lensSpot({ x: 120, y: 300, size: 28 }, 60, 240);
    expect(spot.x).toBe(120);
    expect(spot.y + half).toBe(300 - 14 - LENS.gap);
    expect(spot.tailX).toBe(120);
  });

  it('가장자리의 칸에서도 화면 밖으로 나가지 않는다', () => {
    for (const x of [0, 6, 14, 226, 234, 240]) {
      const spot = lensSpot({ x, y: 300, size: 28 }, 60, 240);
      expect(spot.x - half).toBeGreaterThanOrEqual(LENS.margin);
      expect(spot.x + half).toBeLessThanOrEqual(240 - LENS.margin);
      // 꼬리는 말풍선의 둥근 모서리 안쪽에 붙어 있다.
      expect(Math.abs((spot.tailX ?? 0) - spot.x)).toBeLessThanOrEqual(half - LENS.radius);
    }
  });

  it('위에 자리가 없으면 화면 가운데 쪽 옆으로 비켜 놓는다', () => {
    const left = lensSpot({ x: 30, y: 80, size: 28 }, 60, 240);
    expect(left.tailX).toBeNull();
    expect(left.x - half).toBeGreaterThan(30 + 14);
    expect(left.y - half).toBeGreaterThanOrEqual(60);

    const right = lensSpot({ x: 210, y: 80, size: 28 }, 60, 240);
    expect(right.x + half).toBeLessThan(210 - 14);
    expect(right.y - half).toBeGreaterThanOrEqual(60);
  });
});
