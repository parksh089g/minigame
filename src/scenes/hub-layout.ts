/**
 * 허브의 게임 목록을 놓는 자리 계산. 화면에 의존하지 않는 순수 함수들이다.
 *
 * 허브는 게임을 두 갈래로 나눠 탭으로 보여 준다(games/registry.ts의 HUB_GROUPS).
 * 짧게 즐기는 게임은 수가 많아서 작은 카드를 세 칸 격자로 놓고, 꾸준히 하는 게임은 몇 안 되고 들어가 볼 까닭(이어하기,
 * 오늘의 목표 같은)을 보여 줘야 해서 가로로 긴 카드를 한 줄에 하나씩 놓는다. 어느 쪽이든 화면에 다 들어가지 않으면 쪽으로 나눈다.
 */
import { layoutPages } from '../core/paging';

/** 탭 줄: 오늘의 도전 카드 바로 아래에 놓인다. height는 탭의 면 높이이고, 그 아래로 도톰한 두께(depth)가 더 보인다. */
export const HUB_TABS = { height: 22, depth: 3, gap: 4 } as const;

/** 카드 한 장의 면 높이와, 카드 사이의 간격(카드 아래로 비어져 나오는 두께까지 친 것) */
export interface CardSize {
  height: number;
  gap: number;
}

/** 목록 하나를 놓는 법 */
export interface HubList {
  /** 목록의 맨 위(탭 줄의 위쪽 끝에서 잰 거리) */
  top: number;
  card: CardSize;
  /** 한 쪽에 놓는 줄 수 */
  rows: number;
  /** 쪽 수. 1이면 쪽 넘김 줄을 두지 않는다. */
  pages: number;
  /** 좁은 화면이라 카드를 조금 낮춰 놓았는지 */
  compact: boolean;
}

/** 탭 줄과 목록 사이의 틈. 여느 때와, 자리가 모자라 카드를 낮춰 놓을 때 */
const BELOW_TABS = { roomy: 5, compact: 3 } as const;

/** 짧게 즐기는 게임의 격자: 한 줄에 놓는 카드 수와, 카드의 크기(여느 때와 낮춘 것) */
export const QUICK_COLUMNS = 3;
export const QUICK_CARD = {
  roomy: { height: 64, gap: 6 },
  compact: { height: 57, gap: 6 },
} as const satisfies Record<string, CardSize>;

/** 꾸준히 하는 게임의 카드: 자리가 넉넉하면 tall까지 키우고, 모자라도 least 밑으로는 낮추지 않는다. */
export const STEADY_CARD = { tall: 72, least: 48, gap: 6 } as const;

const listTop = (compact: boolean): number =>
  HUB_TABS.height + HUB_TABS.depth + (compact ? BELOW_TABS.compact : BELOW_TABS.roomy);

/**
 * 짧게 즐기는 게임 count개를 room 높이(탭 줄의 위쪽 끝부터 목록이 쓸 수 있는 아래쪽 끝까지) 안에 놓는다.
 * pager는 쪽 넘김 줄이 차지하는 높이다. 카드를 조금 낮추면 쪽 수가 줄어드는 화면(가장 짧은 화면)에서만 낮춘 카드를 쓴다.
 */
export function quickList(count: number, room: number, pager: number): HubList {
  const rows = Math.ceil(Math.max(0, count) / QUICK_COLUMNS);
  const lay = (compact: boolean): HubList => {
    const card = compact ? QUICK_CARD.compact : QUICK_CARD.roomy;
    const top = listTop(compact);
    const layout = layoutPages(rows, room - top, card.height + card.gap, pager);
    // 한 쪽에 다 들어가면 실제로 놓이는 줄 수만 센다. 목록 아래의 빈자리를 재는 데 쓴다.
    const shown = layout.pages > 1 ? layout.perPage : Math.max(1, Math.min(layout.perPage, rows));
    return { top, card, rows: shown, pages: layout.pages, compact };
  };
  const roomy = lay(false);
  if (roomy.pages <= 1) return roomy;
  const compact = lay(true);
  return compact.pages < roomy.pages ? compact : roomy;
}

/**
 * 꾸준히 하는 게임 count개를 room 높이 안에 한 줄에 하나씩 놓는다. 다 들어가면 자리가 남는 만큼 카드를 키우고(tall까지),
 * 가장 낮은 카드로도 다 들어가지 않으면 쪽으로 나눈다.
 */
export function steadyList(count: number, room: number, pager: number): HubList {
  const n = Math.max(1, Math.floor(count));
  const gap = STEADY_CARD.gap;
  const fits = (compact: boolean): number => Math.floor((room - listTop(compact)) / n) - gap;
  // 틈을 좁혀야만 다 들어가는 화면에서는 틈을 좁힌다.
  const compact = fits(false) < STEADY_CARD.least && fits(true) >= STEADY_CARD.least;
  const top = listTop(compact);
  const height = fits(compact);
  if (height >= STEADY_CARD.least) {
    return { top, card: { height: Math.min(STEADY_CARD.tall, height), gap }, rows: n, pages: 1, compact };
  }
  const layout = layoutPages(n, room - top, STEADY_CARD.least + gap, pager);
  return { top, card: { height: STEADY_CARD.least, gap }, rows: layout.perPage, pages: layout.pages, compact };
}

/** 목록이 차지하는 높이(탭 줄의 위쪽 끝에서 잰 것): 한 쪽의 카드들과, 쪽이 여럿이면 쪽 넘김 줄까지 */
export function listBottom(list: HubList, pager: number): number {
  return list.top + list.rows * (list.card.height + list.card.gap) + (list.pages > 1 ? pager : 0);
}
