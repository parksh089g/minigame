/**
 * 떠오르는 글(GameHud의 floatText)이 놓일 자리.
 * 화면 가장자리에서 띄워도 글의 양 끝이 화면 밖으로 나가지 않게 가운데를 안쪽으로 당긴다.
 */

/** 글의 가운데가 가장자리에서 떨어져 있어야 하는 가장 짧은 거리. 짧은 글은 이만큼만 떨어지면 된다. */
export const FLOAT_MARGIN = 20;
/** 글의 끝과 가장자리 사이에 두는 틈 */
export const FLOAT_PAD = 2;

/**
 * 가운데를 x에 두려는 너비 width의 글이 [left, right] 안에 다 들어오도록 당긴 x.
 * 글이 그 폭보다 넓어서 다 들어올 수 없으면 가운데에 둔다.
 */
export function floatCenter(x: number, width: number, left: number, right: number): number {
  const half = Math.max(FLOAT_MARGIN, width / 2 + FLOAT_PAD);
  if (left + half >= right - half) return (left + right) / 2;
  return Math.min(right - half, Math.max(left + half, x));
}
