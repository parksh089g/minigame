import { describe, expect, it } from 'vitest';
import { itemsIn } from '../core/shop';
import {
  BACKDROP_LOOKS,
  CARD_BACK_LOOKS,
  GOLD_ORB,
  OBSTACLE_COLORS,
  ORB_LOOKS,
  RUNNER_LOOKS,
} from './cosmetics';

const HEX = /^#[0-9a-f]{6}$/;

/** 0(검정)~1(흰색)의 상대 휘도 */
function luminance(hex: string): number {
  const channel = (index: number): number => {
    const value = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

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

  it('배경 무늬는 타일 안에만 그리고, 바탕과 무늬 모두 글자가 읽힐 만큼 밝다', () => {
    for (const look of Object.values(BACKDROP_LOOKS)) {
      expect(look.base).toMatch(HEX);
      expect(luminance(look.base)).toBeGreaterThan(0.85);
      for (const [, x, y, size, color] of look.marks) {
        expect(size).toBeGreaterThan(0);
        expect(x - size).toBeGreaterThanOrEqual(0);
        expect(y - size).toBeGreaterThanOrEqual(0);
        expect(x + size).toBeLessThanOrEqual(look.size);
        expect(y + size).toBeLessThanOrEqual(look.size);
        expect(color).toMatch(HEX);
        expect(luminance(color)).toBeGreaterThan(0.7);
      }
    }
  });

  it('캐릭터에는 장애물과 같은 산호색을 쓰지 않는다', () => {
    for (const look of Object.values(RUNNER_LOOKS)) {
      expect(look.body).toMatch(HEX);
      expect(OBSTACLE_COLORS).not.toContain(look.body);
    }
  });

  it('구슬에는 금색 구슬과 헷갈리는 색을 쓰지 않는다', () => {
    const gold = [GOLD_ORB.base, GOLD_ORB.shade];
    for (const look of Object.values(ORB_LOOKS)) {
      for (const color of [look.base, look.shade, look.light]) expect(color).toMatch(HEX);
      expect(gold).not.toContain(look.base);
      expect(look.ring).not.toBe(GOLD_ORB.ring);
      expect(look.motif).not.toBe('sparkle');
      expect(look.sparks.length).toBeGreaterThan(0);
    }
  });

  it('카드 뒷면은 면, 두께, 무늬의 색이 서로 다르다', () => {
    for (const look of Object.values(CARD_BACK_LOOKS)) {
      for (const color of [look.face, look.lip, look.mark]) expect(color).toMatch(HEX);
      expect(look.lip).not.toBe(look.face);
      expect(look.mark).not.toBe(look.face);
    }
  });
});
