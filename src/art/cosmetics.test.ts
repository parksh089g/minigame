import { describe, expect, it } from 'vitest';
import { PALETTE } from '../config';
import { itemsIn } from '../core/shop';
import { BACKDROP_LOOKS, CARD_BACK_LOOKS, ORB_LOOKS, RUNNER_LOOKS } from './cosmetics';

const isColor = (index: number): boolean =>
  Number.isInteger(index) && index >= 0 && index < PALETTE.length;

describe('꾸미기 생김새', () => {
  it('상점의 모든 꾸미기에 생김새가 있고, 남는 생김새는 없다', () => {
    const ids = (slot: Parameters<typeof itemsIn>[0]): string[] =>
      itemsIn(slot)
        .map((item) => item.id)
        .sort();
    expect(Object.keys(BACKDROP_LOOKS).sort()).toEqual(ids('backdrop'));
    expect(Object.keys(RUNNER_LOOKS).sort()).toEqual(ids('runner'));
    expect(Object.keys(CARD_BACK_LOOKS).sort()).toEqual(ids('cardBack'));
    expect(Object.keys(ORB_LOOKS).sort()).toEqual(ids('orb'));
  });

  it('배경 무늬는 타일 안에만 그리고, 바탕은 가장 어두운 색이다', () => {
    for (const look of Object.values(BACKDROP_LOOKS)) {
      expect(look.base).toBe(0);
      for (const [x, y, width, height, color] of look.marks) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(width).toBeGreaterThan(0);
        expect(height).toBeGreaterThan(0);
        expect(x + width).toBeLessThanOrEqual(look.size);
        expect(y + height).toBeLessThanOrEqual(look.size);
        expect(isColor(color)).toBe(true);
      }
    }
  });

  it('캐릭터에는 장애물과 같은 붉은색을 쓰지 않는다', () => {
    for (const look of Object.values(RUNNER_LOOKS)) {
      for (const color of [look.light, look.shade, look.dark]) {
        expect(isColor(color)).toBe(true);
        expect([1, 2]).not.toContain(color);
      }
    }
  });

  it('구슬에는 금색 구슬과 헷갈리는 노란색과 주황색을 쓰지 않는다', () => {
    for (const look of Object.values(ORB_LOOKS)) {
      const colors = [...look.rings.map(([, color]) => color), look.ring, ...look.sparks];
      for (const color of colors) {
        expect(isColor(color)).toBe(true);
        expect([3, 4]).not.toContain(color);
      }
      // 반지름은 바깥에서 안쪽으로 줄어든다.
      for (let i = 1; i < look.rings.length; i += 1) {
        expect(look.rings[i][0]).toBeLessThan(look.rings[i - 1][0]);
      }
    }
  });

  it('카드 뒷면은 테두리와 바탕이 다른 색이다', () => {
    for (const look of Object.values(CARD_BACK_LOOKS)) {
      expect(isColor(look.border) && isColor(look.fill) && isColor(look.mark)).toBe(true);
      expect(look.fill).not.toBe(look.border);
      expect(look.mark).not.toBe(look.fill);
    }
  });
});
