/**
 * 캔버스 배율을 고르고 기억한다. Phaser에 기대지 않는 순수한 부분이라 따로 둔다.
 * 쓰는 쪽은 core/hidpi.ts를 통해 가져온다.
 */

let scale = 1;

/** 논리 픽셀 하나가 캔버스 픽셀 몇 개인지. main.ts가 게임을 만들기 전에 정한다. */
export function renderScale(): number {
  return scale;
}

export function setRenderScale(value: number): void {
  scale = value;
}

/**
 * 캔버스를 논리 크기의 몇 배까지 키울지.
 * 3배면 가로 720px로, 화소가 촘촘한 휴대폰에서도 충분히 또렷하다.
 * 더 키우면 칠할 화소가 배율의 제곱으로 늘어 느린 기기에서 프레임이 떨어진다.
 */
const SCALE_RANGE = { min: 2, max: 3 } as const;

/** 화면에 보이는 폭과 기기 배율에 맞는 정수 배율을 고른다. */
export function pickRenderScale(displayWidth: number, logicalWidth: number, devicePixelRatio: number): number {
  const wanted = Math.ceil((displayWidth * devicePixelRatio) / logicalWidth - 0.05);
  if (!Number.isFinite(wanted)) return SCALE_RANGE.min;
  return Math.min(SCALE_RANGE.max, Math.max(SCALE_RANGE.min, wanted));
}
