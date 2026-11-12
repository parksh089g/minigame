/**
 * 움직임 줄이기: 기기의 "동작 줄이기"(iOS), "애니메이션 삭제"(안드로이드) 설정을 켠 사람에게는
 * 화면 흔들림을 없애고 번쩍임을 약하게 한다. 멀미나 어지럼을 느끼는 사람을 위한 설정이다.
 * 여기에는 브라우저와 Phaser에 기대지 않는 셈만 둔다. 실제로 화면 효과에 거는 것은 motion-guard.ts다.
 */

/** 브라우저에 물어보는 조건 */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** 움직임을 줄일 때 번쩍임에 곱하는 값. 완전히 없애지 않고 흐리게 남겨서, 맞았다는 신호는 알아볼 수 있게 한다. */
export const CALM_FLASH = 0.3;

/** matchMedia가 돌려주는 것에서 여기서 쓰는 부분 */
export interface MediaAnswer {
  matches: boolean;
}

/**
 * 기기가 움직임을 줄여 달라고 하는지. 물어볼 수 없는 환경(아주 옛 브라우저)에서는 줄이지 않는다.
 * 설정은 앱을 쓰는 중에도 바뀔 수 있으므로 부를 때마다 새로 묻는다.
 */
export function wantsReducedMotion(ask: ((query: string) => MediaAnswer) | undefined): boolean {
  if (!ask) return false;
  try {
    return ask(REDUCED_MOTION_QUERY).matches === true;
  } catch {
    return false;
  }
}

/** 화면을 흔드는 세기. 움직임을 줄이면 흔들지 않는다(효과가 끝났다는 신호는 그대로 가도록 0으로 돌린다). */
export function shakeIntensity<T>(reduced: boolean, intensity: T): T | 0 {
  return reduced ? 0 : intensity;
}

/** 화면을 번쩍이는 세기(0~1). full은 그 효과의 원래 세기다. */
export function flashAlpha(reduced: boolean, full: number): number {
  return reduced ? Math.min(full, CALM_FLASH) : full;
}
