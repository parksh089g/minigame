/**
 * 동료 가게에 적는 글. 화면(shop.ts)과 따로 두어서 화면 없이 테스트한다.
 */
import { THEME_CSS } from '../../config';
import { allyOf, nextStar, starOf, type Ally } from './allies';
import type { RunState } from './sim';

/** 화면에 적는 글. 글꼴에 들어 있는 글자만 쓰는지 테스트가 확인한다. */
export const SHOP_TEXT = {
  title: '동료 가게',
  /** 가진 열매와 짧은 도움말 */
  purse: (fruit: number) => `열매 ${fruit}개 · 같은 동료를 모으면 별이 올라요`,
  /** 처음 들이는 동료 */
  fresh: '새 동료',
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

/** 카드 아래 줄의 오른쪽에 적는 말과 색: 새 동료인지, 지금 별이 몇인지, 사면 별이 오르는지 */
export function cardStatus(state: Pick<RunState, 'allies'>, id: Ally['id']): { text: string; color: string } {
  const copies = allyOf(state, id)?.copies ?? 0;
  if (copies === 0) return { text: SHOP_TEXT.fresh, color: THEME_CSS.good };
  const star = starOf(copies);
  const next = nextStar(copies);
  if (!next) return { text: SHOP_TEXT.top(star), color: THEME_CSS.sub };
  if (copies + 1 >= next.need) return { text: SHOP_TEXT.merge(star + 1), color: THEME_CSS.pinkDeep };
  return { text: SHOP_TEXT.owned(star, next.have, next.need), color: THEME_CSS.accent };
}

