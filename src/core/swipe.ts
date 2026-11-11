/**
 * 네 방향 밀기 판정. 화면과 Phaser에 의존하지 않는 순수 함수라서
 * 손가락을 떼었을 때든 움직이는 도중이든 같은 기준으로 쓸 수 있다.
 */
export type SwipeDirection = 'left' | 'right' | 'up' | 'down';

/** 이 거리(논리 픽셀)보다 짧게 움직인 것은 밀기로 치지 않는다. 손가락이 살짝 떨린 것과 구별한다. */
export const SWIPE_MIN_DISTANCE = 16;

/**
 * 손가락이 움직인 거리 (dx, dy)를 네 방향 가운데 하나로 바꾼다. 화면 좌표라서 아래쪽이 +y다.
 * 너무 짧게 움직였으면 null이다. 비스듬히 밀면 더 많이 움직인 쪽을 고르고, 똑같으면 가로로 친다.
 */
export function swipeDirection(
  dx: number,
  dy: number,
  minDistance = SWIPE_MIN_DISTANCE,
): SwipeDirection | null {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < minDistance) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'up' : 'down';
}
