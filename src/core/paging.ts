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

/** 세로로 늘어놓는 것 하나의 높이와 그 사이 간격 */
export interface StackSize {
  height: number;
  gap: number;
}

/**
 * count개를 room 높이 안에 세로로 늘어놓을 때 하나의 높이와 사이 간격.
 * 넉넉하면 size 그대로이고, 모자라면 간격은 둔 채 높이를 squeeze.roomy까지 낮춰 보고,
 * 그래도 모자라면 간격을 squeeze.gap으로 좁혀 들어가는 만큼 낮춘다. 높이는 squeeze.least 밑으로 내려가지 않는다.
 * 담을 것이 많아 least가 roomy보다 크면 간격을 좁혀서라도 least를 지키고, size.height보다 크면 그만큼 키운다.
 * 그래서 room 안에 다 들어가지 않을 수도 있고, 들어갔는지는 stackHeight로 본다.
 * 예: 높이 60, 간격 8을 294 안에 놓으면 넷은 그대로, 다섯은 52와 8, 여섯은 45와 4
 */
export function fitStack(
  count: number,
  room: number,
  size: StackSize,
  squeeze: { roomy: number; gap: number; least: number },
): StackSize {
  const n = Math.max(1, Math.floor(count));
  const fit = (gap: number): number => Math.floor((room - (n - 1) * gap) / n);
  const gap = fit(size.gap) >= Math.max(squeeze.roomy, squeeze.least) ? size.gap : squeeze.gap;
  return { height: Math.max(squeeze.least, Math.min(size.height, fit(gap))), gap };
}

/** count개를 size대로 세로로 늘어놓은 전체 높이 */
export function stackHeight(count: number, size: StackSize): number {
  const n = Math.max(0, Math.floor(count));
  return n === 0 ? 0 : n * size.height + (n - 1) * size.gap;
}
