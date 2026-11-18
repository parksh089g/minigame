/**
 * 동료 가게에 적는 글. 화면(shop.ts)과 따로 두어서 화면 없이 테스트한다.
 */
import { THEME_CSS } from '../../config';
import { ALLIES, ALLY_STARS, CELL_COUNT, GUN, type AllyAim, type AllyId } from './data';
import {
  allyDamage,
  allyInterval,
  canPlace,
  freeCells,
  mergeTarget,
  nextStar,
  owns,
  refundFor,
  starOf,
  type Ally,
} from './allies';
import type { RunState } from './sim';

/** 화면에 적는 글. 글꼴에 들어 있는 글자만 쓰는지 테스트가 확인한다. */
export const SHOP_TEXT = {
  title: '동료 가게',
  /** 가진 열매와 빈칸 */
  purse: (fruit: number, free: number) =>
    free > 0 ? `열매 ${fruit}개 · 빈칸 ${free}/${CELL_COUNT}` : `열매 ${fruit}개 · 빈칸 없음 · 밭의 동료를 눌러 내보내요`,
  /** 처음 들이는 동료 */
  fresh: '새 동료',
  /** 놓을 빈칸이 모자란 새 동료. 세 칸 동료의 카드에서도 값 옆의 열매 그림에 닿지 않게 짧게 쓴다(11차 검토 G13). */
  noRoom: '자리 없음',
  /** 이미 있는 동료를 살 때 고르는 두 단추 */
  mergeButton: (star: number) => `합치기 ★${star}`,
  mergeSame: '합치기',
  /** 끄는 동안 놓으면 짝 효과가 생기는 자리 */
  pair: '짝!',
  placeButton: '새로 놓기',
  /** 가게의 맨 위에 적는 도움말 */
  dragHint: '밭에 끌어다 놓기 · 같은 동료 위면 합치기',
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
  /** 카드의 자물쇠를 눌러 묶거나 풀었을 때 잠깐 띄운다. */
  locked: '다음에도 남게 묶었어요',
  unlocked: '묶은 것을 풀었어요',
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

// ------------------------------------------------------------ 동료 정보(꾹 누르면 뜨는 창)

/** 동료가 겨누는 벌레를 쉬운 말로. 모두 "벌레"로 끝나서 뒤에 "를"을 붙인다. */
export const AIM_TEXT: Readonly<Record<AllyAim, string>> = {
  near: '가까운 벌레',
  boss: '대장과 튼튼한 벌레',
  front: '울타리에 다가온 벌레',
  crowd: '몰려 있는 벌레',
  far: '멀리 있는 벌레',
};

/** 동료 정보 창에 적는 글 */
export const INFO_TEXT = {
  aim: (aim: AllyAim) => `${AIM_TEXT[aim]}를 겨눠요`,
  /** 동료의 솜씨(ALLIES의 pierceShell, chill, splash, reach) */
  pierceShell: '껍데기를 뚫어요',
  chill: '맞은 벌레가 느려져요',
  splash: '둘레도 쳐요',
  reach: '울타리 가까이만 닿아요',
  /** 한 발의 피해를 물총 한 발에 견주어 */
  damage: (ratio: string) => `한 발 피해: 물총의 ${ratio}배`,
  rate: (perSecond: string) => `1초에 ${perSecond}번 쏴요`,
  /** 다음 별이 되면 피해와 빠르기가 몇 배가 되는지 */
  next: (star: number, damage: string, speed: string) => `★${star} → ★${star + 1}: 피해 ×${damage} · 빠르기 ×${speed}`,
  /** 한 마리의 값과 내보내면 돌려받는 열매 */
  price: (price: number, refund: number) => `값: 열매 ${price}개 · 내보내면 ${refund}개`,
  /** 가게의 카드: 합치면 오르는 별 */
  merged: (star: number) => `합치면 ★${star}`,
  close: '닫기',
} as const;

/** 동료 정보 창의 내용. lines는 위에서부터 차례로 적는 줄이다(나중에 다른 줄을 덧붙이기 쉽게 글의 목록으로 둔다). */
export interface AllyInfo {
  id: AllyId;
  name: string;
  /** 이름 아래에 적는 별: 밭의 동료는 "★2", 가게의 카드는 "합치면 ★3"이나 "새 동료" */
  star: string;
  /** 차지하는 칸 수("2칸"). 모양은 ALLIES의 shape로 그린다. */
  cells: string;
  /** 무엇을 겨누는지 */
  aim: string;
  /** 솜씨(없으면 빈 목록) */
  specials: string[];
  /** 한 발의 피해, 1초에 쏘는 수, 다음 별이 되면 바뀌는 것(다 올렸으면 그렇다는 말), 값과 돌려받는 열매 */
  numbers: string[];
}

/** 소수 둘째 자리까지 적고 끝의 0은 뗀다(0.36, 2.1, 1.5). */
function shortNumber(value: number, digits = 2): string {
  return String(Number(value.toFixed(digits)));
}

/**
 * 동료 정보 창의 내용. copies를 주면 밭에 선 그만큼 모은 동료이고, 주지 않으면 가게의 카드다.
 * 카드는 사서 합칠 동료가 있으면 합친 뒤의 모습을, 없으면 새로 놓은 ★1의 모습을 적는다.
 * 피해와 빠르기는 시뮬레이션(sim.ts의 fireAllies)과 같은 셈(allyDamage, allyInterval)에 그 판의 능력치를 넣어서 구한다.
 * 빠른 손은 동료도 함께 빠르게 하고, 동료 거름은 동료의 피해만 키운다.
 */
export function allyInfo(state: Pick<RunState, 'allies' | 'stats'>, id: AllyId, copies?: number): AllyInfo {
  const def = ALLIES[id];
  const { stats } = state;
  let have: number;
  let star: string;
  if (copies !== undefined) {
    have = copies;
    star = `★${starOf(copies)}`;
  } else {
    const target = mergeTarget(state, id);
    have = target ? target.copies + 1 : 1;
    star = target ? INFO_TEXT.merged(starOf(have)) : owns(state, id) ? '★1' : SHOP_TEXT.fresh;
  }
  const level = starOf(have);
  const damage = (at: number): number => allyDamage(id, at, stats.damage, stats.allyPower);
  const interval = (at: number): number => allyInterval(id, at) * (stats.interval / GUN.interval);
  const specials: string[] = [];
  if (def.pierceShell) specials.push(INFO_TEXT.pierceShell);
  if (def.chill) specials.push(INFO_TEXT.chill);
  if (def.splash) specials.push(INFO_TEXT.splash);
  if (def.reach !== undefined) specials.push(INFO_TEXT.reach);
  const numbers = [INFO_TEXT.damage(shortNumber(damage(level) / stats.damage)), INFO_TEXT.rate(shortNumber(1 / interval(level), 1))];
  numbers.push(
    level < ALLY_STARS.max
      ? INFO_TEXT.next(level, shortNumber(damage(level + 1) / damage(level), 1), shortNumber(interval(level) / interval(level + 1), 1))
      : SHOP_TEXT.top(level),
  );
  numbers.push(INFO_TEXT.price(def.price, refundFor({ id, copies: have })));
  return { id, name: def.name, star, cells: SHOP_TEXT.cells(def.cells), aim: INFO_TEXT.aim(def.aim), specials, numbers };
}
