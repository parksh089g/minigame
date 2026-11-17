/**
 * 동료와 동료 가게의 규칙. 판 안에서 열매로 동료를 사고, 같은 동료를 또 사면 합쳐져서 별이 오른다.
 * 화면이 없는 규칙이라서 시뮬레이션(sim.ts)과 자동 플레이(bot.ts)가 함께 쓴다.
 */
import { ALLIES, ALLY_ORDER, ALLY_STARS, SHOP, TEAM_HEAT, type AllyId } from './data';
import { isBossDay, nextRandom } from './rules';
import type { RunState } from './sim';

/** 판에 선 동료 하나. 같은 동료는 하나로 합쳐서 모은 수(copies)만 센다. */
export interface Ally {
  id: AllyId;
  /** 지금까지 사서 합친 수. 별은 이것으로 정해진다(starOf). */
  copies: number;
  /** 다음에 쏠 때까지 남은 시간(초) */
  fireIn: number;
}

/** 가게의 카드 한 장. 산 카드는 sold가 되어 그 자리에 남는다. */
export interface ShopCard {
  id: AllyId;
  sold: boolean;
}

/** 별 하나를 더 올리는 데 드는 수: ★1은 1, ★2는 2, ★3은 4, ★4는 8, ★5는 16마리 */
export function copiesFor(star: number): number {
  return 2 ** (Math.max(1, Math.min(ALLY_STARS.max, Math.floor(star))) - 1);
}

/** 모은 수에 따른 별(1~ALLY_STARS.max). 하나도 없으면 0 */
export function starOf(copies: number): number {
  if (copies < 1) return 0;
  return Math.min(ALLY_STARS.max, Math.floor(Math.log2(copies)) + 1);
}

/** 다음 별까지의 진행: 지금 별에서 모은 수와, 다음 별에 필요한 수. 다 올렸으면 null */
export function nextStar(copies: number): { have: number; need: number } | null {
  const star = starOf(copies);
  if (star >= ALLY_STARS.max) return null;
  return { have: copies, need: copiesFor(star + 1) };
}

/** 다 올려서 더 살 수 없는지 */
export function maxed(copies: number): boolean {
  return copies >= copiesFor(ALLY_STARS.max);
}

/** 그 별의 동료가 쏘는 간격(초) */
export function allyInterval(id: AllyId, star: number): number {
  return ALLIES[id].interval * ALLY_STARS.interval ** (Math.max(1, star) - 1);
}

/** 그 별의 동료가 한 발에 주는 피해. 물총 한 발의 피해(damage)와 동료 거름(power)을 따른다. */
export function allyDamage(id: AllyId, star: number, damage: number, power: number): number {
  return damage * power * ALLIES[id].damage * ALLY_STARS.damage ** (Math.max(1, star) - 1);
}

/** 판에 선 그 동료. 없으면 undefined */
export function allyOf(state: Pick<RunState, 'allies'>, id: AllyId): Ally | undefined {
  return state.allies.find((ally) => ally.id === id);
}

/**
 * 동료를 하나 더한다. 이미 있으면 합쳐서 모은 수를 늘린다. 별이 올랐으면 그 별을, 아니면 0을 돌려준다.
 * 새로 선 동료는 조금 기다렸다가 쏘기 시작한다.
 */
export function addAlly(state: Pick<RunState, 'allies'>, id: AllyId, copies = 1): number {
  const ally = allyOf(state, id);
  if (!ally) {
    state.allies.push({ id, copies, fireIn: 0.5 });
    // 자리의 차례대로 늘어놓는다.
    state.allies.sort((a, b) => ALLY_ORDER.indexOf(a.id) - ALLY_ORDER.indexOf(b.id));
    return starOf(copies);
  }
  const before = starOf(ally.copies);
  ally.copies = Math.min(copiesFor(ALLY_STARS.max), ally.copies + copies);
  const after = starOf(ally.copies);
  return after > before ? after : 0;
}

/** 그날 가게에 나올 수 있는 동료. 그날까지 나온 동료 가운데 다 올리지 않은 것이다. */
export function shopPool(state: Pick<RunState, 'allies' | 'day'>): AllyId[] {
  return ALLY_ORDER.filter((id) => ALLIES[id].fromDay <= state.day && !maxed(allyOf(state, id)?.copies ?? 0));
}

/**
 * 가게에 놓을 카드를 뽑는다. 같은 동료가 두 장 이상 나올 수도 있다(합치기 좋은 판).
 * 판의 난수(state.rng)에서 갈라 낸 난수를 쓰고 판의 난수는 건드리지 않아서, 벌레가 나오는 차례는 그대로다.
 */
export function drawShop(state: RunState): ShopCard[] {
  const pool = shopPool(state);
  if (pool.length === 0) return [];
  let seed = (state.rng ^ Math.imul(state.day + 1, 0x9e3779b1) ^ Math.imul(state.rolls + 1, 0x85ebca6b)) | 0;
  const cards: ShopCard[] = [];
  for (let index = 0; index < SHOP.cards; index += 1) {
    const next = nextRandom(seed);
    seed = next.state;
    cards.push({ id: pool[Math.floor(next.value * pool.length)], sold: false });
  }
  return cards;
}

/** 가게를 연다. 판의 첫날 앞과, 날을 지킬 때마다 연다. */
export function openShop(state: RunState): void {
  state.shopping = true;
  state.shop = drawShop(state);
}

/** 그 카드를 지금 살 수 있는지 */
export function canBuyCard(state: RunState, index: number): boolean {
  const card = state.shop[index];
  if (!state.shopping || !card || card.sold) return false;
  return state.fruit >= ALLIES[card.id].price && !maxed(allyOf(state, card.id)?.copies ?? 0);
}

/** 카드를 산다. 산 동료는 바로 울타리 아래에 선다(있으면 합쳐진다). 별이 올랐으면 그 별, 아니면 0. 사지 못했으면 null */
export function buyCard(state: RunState, index: number): number | null {
  if (!canBuyCard(state, index)) return null;
  const card = state.shop[index];
  state.fruit -= ALLIES[card.id].price;
  state.shop = state.shop.map((other, at) => (at === index ? { ...other, sold: true } : other));
  return addAlly(state, card.id);
}

/** 카드를 다시 뽑을 수 있는지 */
export function canReroll(state: RunState): boolean {
  return state.shopping && state.fruit >= SHOP.reroll && shopPool(state).length > 0;
}

/** 열매를 내고 카드를 다시 뽑는다. 뽑았으면 true */
export function reroll(state: RunState): boolean {
  if (!canReroll(state)) return false;
  state.fruit -= SHOP.reroll;
  state.rolls += 1;
  state.shop = drawShop(state);
  return true;
}

/** 그날을 지켰을 때 받는 열매 */
export function fruitFor(day: number): number {
  return SHOP.income + (isBossDay(day) ? SHOP.boss : 0);
}

/**
 * 그 판에서 지킨 날 수에 따라 벌레의 체력에 곱하는 값. 동료를 들일 수 있었던 날만큼 오르고 TEAM_HEAT.days에서 멈춘다.
 * cleared는 그 판에서 이미 지킨 날 수(판의 첫날이면 0)다.
 */
export function heatScale(cleared: number): number {
  return TEAM_HEAT.heat ** Math.min(TEAM_HEAT.days, Math.max(0, Math.floor(cleared)));
}

/** 판의 동료를 별과 함께 짧게 적는다("해바라기 ★2"). 일시정지 화면과 테스트가 쓴다. */
export function allyLabel(ally: Pick<Ally, 'id' | 'copies'>): string {
  return `${ALLIES[ally.id].name} ★${starOf(ally.copies)}`;
}
