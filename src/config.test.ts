import { describe, expect, it } from 'vitest';
import {
  computeGameHeight,
  GAME_WIDTH,
  MAX_GAME_HEIGHT,
  MIN_GAME_HEIGHT,
  PALETTE,
} from './config';

describe('computeGameHeight', () => {
  it('세로로 긴 휴대폰에서는 화면 비율을 그대로 따른다', () => {
    expect(computeGameHeight(412, 839)).toBe(Math.round((GAME_WIDTH * 839) / 412));
    expect(computeGameHeight(360, 640)).toBe(427);
  });

  it('가로로 넓은 화면에서는 최소 높이를 쓴다', () => {
    expect(computeGameHeight(1280, 720)).toBe(MIN_GAME_HEIGHT);
  });

  it('아주 긴 화면에서는 최대 높이로 제한한다', () => {
    expect(computeGameHeight(300, 2000)).toBe(MAX_GAME_HEIGHT);
  });

  it('크기를 알 수 없으면 최소 높이를 쓴다', () => {
    expect(computeGameHeight(0, 0)).toBe(MIN_GAME_HEIGHT);
    expect(computeGameHeight(Number.NaN, 500)).toBe(MIN_GAME_HEIGHT);
  });
});

describe('PALETTE', () => {
  it('16색이고 모두 #rrggbb 형식이다', () => {
    expect(PALETTE).toHaveLength(16);
    for (const color of PALETTE) expect(color).toMatch(/^#[0-9a-f]{6}$/);
  });
});
