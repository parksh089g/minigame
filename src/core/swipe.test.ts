import { describe, expect, it } from 'vitest';
import { SWIPE_MIN_DISTANCE, swipeDirection } from './swipe';

describe('네 방향 밀기 판정', () => {
  it('충분히 움직이면 움직인 쪽을 돌려준다', () => {
    expect(swipeDirection(-40, 0)).toBe('left');
    expect(swipeDirection(40, 0)).toBe('right');
    expect(swipeDirection(0, -40)).toBe('up');
    expect(swipeDirection(0, 40)).toBe('down');
  });

  it('너무 짧게 움직인 것은 밀기가 아니다', () => {
    expect(swipeDirection(0, 0)).toBeNull();
    expect(swipeDirection(SWIPE_MIN_DISTANCE - 1, 0)).toBeNull();
    expect(swipeDirection(0, -(SWIPE_MIN_DISTANCE - 1))).toBeNull();
    expect(swipeDirection(SWIPE_MIN_DISTANCE, 0)).toBe('right');
  });

  it('비스듬히 밀면 더 많이 움직인 쪽을 고른다', () => {
    expect(swipeDirection(30, 20)).toBe('right');
    expect(swipeDirection(-20, 30)).toBe('down');
    expect(swipeDirection(-30, -29)).toBe('left');
  });

  it('가로와 세로가 똑같으면 가로로 친다', () => {
    expect(swipeDirection(25, 25)).toBe('right');
    expect(swipeDirection(-25, 25)).toBe('left');
  });

  it('기준 거리를 바꿔 줄 수 있다', () => {
    expect(swipeDirection(10, 0, 8)).toBe('right');
    expect(swipeDirection(10, 0, 12)).toBeNull();
  });
});
