import { describe, expect, it } from 'vitest';
import {
  APP_BUILD,
  buildCodeOf,
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

describe('buildCodeOf', () => {
  it('빌드한 파일 주소에서 해시를 꺼낸다', () => {
    expect(buildCodeOf('https://example.com/assets/index-CHpDxKHg.js')).toBe('CHpDxKHg');
    expect(buildCodeOf('/sub/assets/index-B5FDlC3d.js?v=1#x')).toBe('B5FDlC3d');
    // 해시에는 붙임표와 밑줄도 들어갈 수 있다.
    expect(buildCodeOf('/assets/index-a_b-cdEf.js')).toBe('a_b-cdEf');
  });

  it('해시가 없는 주소(개발 서버, 테스트)에서는 빈 글자열이다', () => {
    expect(buildCodeOf('http://localhost:5173/src/config.ts')).toBe('');
    expect(buildCodeOf('file:///home/user/src/config.ts')).toBe('');
    expect(buildCodeOf('/assets/index.js')).toBe('');
    expect(APP_BUILD).toBe('');
  });
});

describe('PALETTE', () => {
  it('16색이고 모두 #rrggbb 형식이다', () => {
    expect(PALETTE).toHaveLength(16);
    for (const color of PALETTE) expect(color).toMatch(/^#[0-9a-f]{6}$/);
  });
});
