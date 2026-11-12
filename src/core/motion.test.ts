import { describe, expect, it } from 'vitest';
import { CALM_FLASH, flashAlpha, REDUCED_MOTION_QUERY, shakeIntensity, wantsReducedMotion } from './motion';

describe('움직임 줄이기', () => {
  it('기기의 설정을 물어본다', () => {
    const asked: string[] = [];
    const ask = (matches: boolean) => (query: string) => {
      asked.push(query);
      return { matches };
    };
    expect(wantsReducedMotion(ask(true))).toBe(true);
    expect(wantsReducedMotion(ask(false))).toBe(false);
    expect(asked).toEqual([REDUCED_MOTION_QUERY, REDUCED_MOTION_QUERY]);
  });

  it('물어볼 수 없거나 묻다가 탈이 나면 줄이지 않는다', () => {
    expect(wantsReducedMotion(undefined)).toBe(false);
    expect(
      wantsReducedMotion(() => {
        throw new Error('지원하지 않음');
      }),
    ).toBe(false);
  });

  it('줄이면 화면을 흔들지 않고, 아니면 받은 세기 그대로다', () => {
    expect(shakeIntensity(true, 0.02)).toBe(0);
    expect(shakeIntensity(false, 0.02)).toBe(0.02);
    const both = { x: 0.01, y: 0.03 };
    expect(shakeIntensity(false, both)).toBe(both);
    expect(shakeIntensity(true, both)).toBe(0);
  });

  it('줄이면 번쩍임을 흐리게 하고, 원래 더 흐린 번쩍임은 그대로 둔다', () => {
    expect(flashAlpha(false, 1)).toBe(1);
    expect(flashAlpha(true, 1)).toBe(CALM_FLASH);
    expect(flashAlpha(true, 0.1)).toBe(0.1);
    expect(CALM_FLASH).toBeGreaterThan(0);
    expect(CALM_FLASH).toBeLessThan(0.5);
  });
});
