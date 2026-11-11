/** 진동 피드백. 지원하지 않는 기기(iOS Safari 등)에서는 조용히 아무 일도 하지 않는다. */
import { store } from './store';

export function canVibrate(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

export function vibrate(pattern: number | number[]): void {
  if (!store.data.settings.vibration || !canVibrate()) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // 권한이나 기기 사정으로 실패해도 게임에는 영향이 없다.
  }
}
