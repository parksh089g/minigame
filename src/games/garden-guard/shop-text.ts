/**
 * 동료 가게에 적는 글. 화면(shop.ts)과 따로 두어서 화면 없이 테스트한다.
 */
import { THEME_CSS } from '../../config';
import { ALLY_STARS, CELL_COUNT } from './data';
import { canPlace, freeCells, mergeTarget, nextStar, owns, starOf, type Ally } from './allies';
import type { RunState } from './sim';

/** 화면에 적는 글. 글꼴에 들어 있는 글자만 쓰는지 테스트가 확인한다. */
export const SHOP_TEXT = {
  title: '동료 가게',
  /** 가진 열매와 빈칸 */
  purse: (fruit: number, free: number) =>
    free > 0 ? `열매 ${fruit}개 · 빈칸 ${free}/${CELL_COUNT}` : `열매 ${fruit}개 · 빈칸 없음 · 밭의 동료를 눌러 내보내요`,
  /** 처음 들이는 동료 */
  fresh: '새 동료',
  /** 놓을 빈칸이 모자란 새 동료 */
  noRoom: '빈칸이 모자라요',
  /** 이미 있는 동료를 살 때 고르는 두 단추 */
  mergeButton: (star: number) => `합치기 ★${star}`,
  mergeSame: '합치기',
  placeButton: '새로 놓기',
  /** 고른 동료를 내보내는 단추 */
  dismiss: '내보내기',
  /** 동료가 차지하는 칸 */
  cells: (cells: number) => `${cells}칸`,
  /** 이미 있는 동료: 지금 별과 다음 별까지 모은 수 */
  owned: (star: number, have: number, need: number) => `★${star} · ${have}/${need}`,
  /** 사면 별이 오르는 동료 */
  merge: (star: number) => `사면 ★${star}!`,
  top: (star: number) => `★${star} 다 모았어요`,
  sold: '데려왔어요',
  reroll: '다시 뽑기',
  /** 판의 첫날 앞에서 가게를 닫는 단추 */
  start: (day: number) => `${day}일째 시작`,
  next: '다음 날',
  pauseTitle: '함께하는 동료',
} as const;

/**
 * 카드의 이름 옆에 적는 말과 색: 새 동료인지(놓을 빈칸이 있는지), 지금 별이 몇인지, 합치면 별이 오르는지.
 * 같은 동료가 여럿이면 합칠 동료(mergeTarget)를 본다.
 */
export function cardStatus(state: Pick<RunState, 'allies'>, id: Ally['id']): { text: string; color: string } {
  if (!owns(state, id)) {
    return canPlace(state, id) ? { text: SHOP_TEXT.fresh, color: THEME_CSS.good } : { text: SHOP_TEXT.noRoom, color: THEME_CSS.faint };
  }
  const target = mergeTarget(state, id);
  if (!target) return { text: SHOP_TEXT.top(ALLY_STARS.max), color: THEME_CSS.sub };
  const star = starOf(target.copies);
  const next = nextStar(target.copies);
  if (next && target.copies + 1 >= next.need) return { text: SHOP_TEXT.merge(star + 1), color: THEME_CSS.pinkDeep };
  return { text: next ? SHOP_TEXT.owned(star, next.have, next.need) : SHOP_TEXT.top(star), color: THEME_CSS.accent };
}

/** 합치기 단추에 적는 별: 합친 뒤의 별. 합칠 동료가 없으면 null */
export function mergedStar(state: Pick<RunState, 'allies'>, id: Ally['id']): number | null {
  const target = mergeTarget(state, id);
  return target ? starOf(target.copies + 1) : null;
}

/** 가게의 맨 위 줄 */
export function purseLine(state: Pick<RunState, 'allies' | 'fruit'>): string {
  return SHOP_TEXT.purse(state.fruit, freeCells(state.allies));
}
