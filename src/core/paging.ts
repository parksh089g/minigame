/**
 * 한 화면에 다 들어가지 않는 목록을 쪽으로 나누는 계산. 허브의 게임 카드와 업적 목록이 같이 쓴다.
 * 화면에 의존하지 않는 순수 함수들이다.
 */

export interface PageLayout {
  /** 한 쪽에 놓는 개수 */
  perPage: number;
  /** 쪽 수. 다 들어가면 1이고, 이때는 쪽 넘김 줄을 두지 않는다. */
  pages: number;
}

const fit = (space: number, itemSize: number): number =>
  itemSize > 0 ? Math.max(1, Math.floor(space / itemSize)) : 1;

/** 쪽을 나눠야 할 때 한 쪽에 들어가는 개수. 쪽 넘김 줄이 차지하는 자리(pagerSize)를 빼고 센다. */
export function pagedCapacity(available: number, itemSize: number, pagerSize: number): number {
  return fit(available - pagerSize, itemSize);
}

/**
 * total개를 available 높이 안에 어떻게 나눠 놓을지 정한다. itemSize는 하나가 차지하는 높이(간격 포함).
 * 모두 들어가면 한 쪽이고, 넘치면 쪽 넘김 줄의 자리를 비운 뒤 들어가는 만큼씩 나눈다.
 */
export function layoutPages(
  total: number,
  available: number,
  itemSize: number,
  pagerSize: number,
): PageLayout {
  const count = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  const whole = fit(available, itemSize);
  if (count <= whole) return { perPage: whole, pages: 1 };
  const perPage = pagedCapacity(available, itemSize, pagerSize);
  return { perPage, pages: Math.ceil(count / perPage) };
}

/** 쪽 번호를 0부터 (pages - 1)까지의 정수로 맞춘다. */
export function clampPage(page: number, pages: number): number {
  const last = Math.max(0, Math.floor(pages) - 1);
  if (!Number.isFinite(page)) return 0;
  return Math.min(last, Math.max(0, Math.floor(page)));
}

/** page쪽에 놓이는 항목들 */
export function pageSlice<T>(items: readonly T[], page: number, perPage: number): T[] {
  const size = Math.max(1, Math.floor(perPage));
  const start = Math.max(0, Math.floor(page)) * size;
  return items.slice(start, start + size);
}

/** index번째 항목이 놓이는 쪽 */
export function pageOfIndex(index: number, perPage: number): number {
  return Math.max(0, Math.floor(index / Math.max(1, Math.floor(perPage))));
}

/**
 * count개를 한 줄에 perRow개까지 놓을 때 줄마다 몇 개씩 놓을지. 줄 수는 가장 적게, 줄마다의 개수는 고르게 나눈다.
 * 예: 4개씩이면 6개는 [3, 3], 5개는 [3, 2], 4개는 [4]
 */
export function balancedRows(count: number, perRow: number): number[] {
  const n = Math.max(0, Math.floor(count));
  if (n === 0) return [];
  const rows = Math.ceil(n / Math.max(1, Math.floor(perRow)));
  const base = Math.floor(n / rows);
  const extra = n % rows;
  return Array.from({ length: rows }, (_, index) => base + (index < extra ? 1 : 0));
}
