/**
 * 탭을 몇 줄로 나눠 놓을지 정한다. 화면과 저장소 어느 쪽에도 의존하지 않는 순수 함수다.
 * 탭이 한 줄에 너무 많이 들어가면 하나하나가 좁아져서 누르기 어렵다. 그래서 한 줄에 놓는 수에 한도를 두고,
 * 넘치면 줄을 늘려 고르게 나눈다.
 */

/** 한 줄에 놓는 탭의 가장 많은 수 */
export const TABS_PER_ROW = 5;

export interface TabRows {
  /** 줄 수 */
  rows: number;
  /** 한 줄에 놓는 탭의 수. 마지막 줄은 이보다 적을 수 있다. */
  perRow: number;
}

/** 탭 count개를 놓을 줄 수와 한 줄의 탭 수. 줄마다 고르게 나눠서 마지막 줄만 휑하지 않게 한다. */
export function tabRows(count: number, maxPerRow: number = TABS_PER_ROW): TabRows {
  const total = Math.max(1, Math.floor(count));
  const limit = Math.max(1, Math.floor(maxPerRow));
  const rows = Math.ceil(total / limit);
  return { rows, perRow: Math.ceil(total / rows) };
}
