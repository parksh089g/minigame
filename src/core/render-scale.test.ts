import { describe, expect, it } from 'vitest';
import { pickRenderScale } from './render-scale';

describe('렌더 배율 고르기', () => {
  it('화면 화소에 모자라지 않는 가장 작은 정수 배율을 고른다', () => {
    // 가로 480px, 배율 1인 모니터: 딱 2배
    expect(pickRenderScale(480, 240, 1)).toBe(2);
    // 가로 360px, 배율 2인 휴대폰: 720 / 240 = 3배
    expect(pickRenderScale(360, 240, 2)).toBe(3);
  });

  it('너무 작거나 크게 고르지 않는다', () => {
    expect(pickRenderScale(240, 240, 1)).toBe(2);
    expect(pickRenderScale(430, 240, 3)).toBe(3);
  });

  it('크기를 알 수 없으면 가장 작은 배율로 시작한다', () => {
    expect(pickRenderScale(Number.NaN, 240, 1)).toBe(2);
    expect(pickRenderScale(360, 240, Number.POSITIVE_INFINITY)).toBe(2);
  });
});
