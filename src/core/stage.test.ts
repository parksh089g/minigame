import { describe, expect, it } from 'vitest';
import { placeToast, uiScale } from './stage';

describe('uiScale', () => {
  it('휴대폰 폭에서는 키우지도 줄이지도 않는다', () => {
    expect(uiScale(320)).toBe(1);
    expect(uiScale(360)).toBe(1);
    expect(uiScale(390)).toBe(1);
  });

  it('캔버스가 넓게 보일수록 커지되 두 배를 넘지 않는다', () => {
    expect(uiScale(430)).toBe(1.1);
    expect(uiScale(614)).toBe(1.57);
    expect(uiScale(2000)).toBe(2);
  });

  it('잴 수 없는 폭이면 1이다', () => {
    expect(uiScale(0)).toBe(1);
    expect(uiScale(Number.NaN)).toBe(1);
  });
});

describe('placeToast', () => {
  const tablet = { left: 77, top: 0, width: 614, height: 1024 };

  it('아래쪽에 놓을 때는 캔버스의 아래쪽 끝을 기준으로 한다', () => {
    const phone = placeToast({ left: 0, top: 20, width: 320, height: 500 }, 568, null);
    expect(phone).toEqual({ centerX: 160, centerY: null, bottom: 48 + 28, scale: 1, maxWidth: 296 });

    const place = placeToast(tablet, 1024, null);
    expect(place.centerX).toBe(384);
    expect(place.bottom).toBeCloseTo(28 * 1.57);
  });

  it('높이를 정해 주면 게임 화면의 그 자리에 가운데를 맞춘다', () => {
    const place = placeToast(tablet, 1024, 54);
    expect(place.bottom).toBeNull();
    expect(place.centerY).toBeCloseTo((54 * 614) / 240);
  });

  it('키운 뒤에도 캔버스 밖으로 나가지 않는 폭을 준다', () => {
    const place = placeToast(tablet, 1024, null);
    expect(place.maxWidth * place.scale).toBeLessThanOrEqual(614 - 24 + 0.001);
  });
});
