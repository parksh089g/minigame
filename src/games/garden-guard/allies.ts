/**
 * 동료와 동료 가게의 규칙. 판 안에서 열매로 동료를 사서 텃밭의 칸에 세운다. 동료마다 차지하는 칸이 다르고,
 * 같은 동료를 또 사면 합쳐서 별을 올리거나(칸은 그대로) 빈칸에 하나 더 놓는다.
 * 화면이 없는 규칙이라서 시뮬레이션(sim.ts)과 자동 플레이(bot.ts)가 함께 쓴다.
 */
import { ALLIES, ALLY_ORDER, ALLY_STARS, CELL_COUNT, GARDEN_CELLS, SHOP, TEAM_HEAT, type AllyId } from './data';
import { isBossDay, nextRandom } from './rules';
import type { RunState } from './sim';

/** 텃밭에 선 동료 하나. 같은 동료를 합치면 하나가 되어 모은 수(copies)만 늘고, 새로 놓으면 따로 선다. */
export interface Ally {
  id: AllyId;
  /** 지금까지 사서 합친 수. 별은 이것으로 정해진다(starOf). */
  copies: number;
  /** 다음에 쏠 때까지 남은 시간(초) */
  fireIn: number;
  /** 차지한 칸 가운데 첫 칸(0부터, GARDEN_CELLS). 차지한 칸 수는 ALLIES의 cells다. */
  cell: number;
}

/** 가게의 카드 한 장. 산 카드는 sold가 되어 그 자리에 남는다. */
export interface ShopCard {
  id: AllyId;
  sold: boolean;
}

/** 이미 있는 동료를 살 때 고르는 것: 합쳐서 별을 올리거나(merge), 빈칸에 하나 더 놓거나(place) */
export type BuyMode = 'merge' | 'place';

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

/** 다 올려서 더 합칠 수 없는지 */
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

// ------------------------------------------------------------ 텃밭의 칸

/** 그 칸이 물총의 오른쪽인지 */
function rightSide(cell: number): boolean {
  return cell >= GARDEN_CELLS.half;
}

/** 첫 칸이 cell이고 cells칸을 차지한 동료가 서는 자리(시뮬레이션 좌표). 차지한 칸들의 한가운데다. */
export function cellSpot(cell: number, cells: number): { x: number; y: number } {
  const side = rightSide(cell);
  const left = side ? GARDEN_CELLS.right : GARDEN_CELLS.left;
  const index = side ? cell - GARDEN_CELLS.half : cell;
  return { x: left + (index + cells / 2) * GARDEN_CELLS.cell, y: GARDEN_CELLS.y };
}

/** 동료가 서는 자리(시뮬레이션 좌표) */
export function allySpot(ally: Pick<Ally, 'id' | 'cell'>): { x: number; y: number } {
  return cellSpot(ally.cell, ALLIES[ally.id].cells);
}

/** 그 칸들(첫 칸 cell부터 cells칸)이 한쪽 안에 들어가는지 */
export function fitsSide(cell: number, cells: number): boolean {
  if (!Number.isInteger(cell) || cell < 0 || cells < 1) return false;
  const end = cell + cells - 1;
  return end < CELL_COUNT && rightSide(cell) === rightSide(end);
}

/** 칸마다 서 있는 동료의 차례(state.allies의 자리). 빈칸은 -1 */
export function cellMap(allies: readonly Pick<Ally, 'id' | 'cell'>[]): number[] {
  const map = new Array<number>(CELL_COUNT).fill(-1);
  allies.forEach((ally, index) => {
    for (let at = 0; at < ALLIES[ally.id].cells; at += 1) {
      if (ally.cell + at < CELL_COUNT) map[ally.cell + at] = index;
    }
  });
  return map;
}

/** 동료들이 칸을 겹치지 않고 한쪽 안에 제대로 서 있는지(저장된 판을 읽을 때 본다) */
export function cellsValid(allies: readonly Pick<Ally, 'id' | 'cell'>[]): boolean {
  const used = new Array<boolean>(CELL_COUNT).fill(false);
  for (const ally of allies) {
    const cells = ALLIES[ally.id].cells;
    if (!fitsSide(ally.cell, cells)) return false;
    for (let at = 0; at < cells; at += 1) {
      if (used[ally.cell + at]) return false;
      used[ally.cell + at] = true;
    }
  }
  return true;
}

/** 빈칸의 수 */
export function freeCells(allies: readonly Pick<Ally, 'id'>[]): number {
  return CELL_COUNT - allies.reduce((sum, ally) => sum + ALLIES[ally.id].cells, 0);
}

/**
 * cells칸을 차지할 동료를 놓을 첫 칸. 물총에 가까운 쪽부터 찾고, 같은 거리면 왼쪽이 먼저다.
 * 이어진 빈칸이 없으면 null
 */
function findCell(allies: readonly Pick<Ally, 'id' | 'cell'>[], cells: number): number | null {
  const map = cellMap(allies);
  const starts: Array<{ cell: number; gap: number }> = [];
  for (let cell = 0; cell + cells <= CELL_COUNT; cell += 1) {
    if (!fitsSide(cell, cells)) continue;
    const gap = rightSide(cell) ? cell - GARDEN_CELLS.half : GARDEN_CELLS.half - (cell + cells);
    starts.push({ cell, gap });
  }
  starts.sort((a, b) => a.gap - b.gap || a.cell - b.cell);
  for (const { cell } of starts) {
    let free = true;
    for (let at = 0; at < cells; at += 1) if (map[cell + at] !== -1) free = false;
    if (free) return cell;
  }
  return null;
}

/**
 * 동료들을 다시 늘어놓아 cells칸이 이어진 빈자리를 만든다. 칸 수는 남는데 이쪽저쪽에 흩어져 있을 때 쓴다.
 * 한쪽에 설 동료를 나누는 모든 가짓수 가운데 쪽을 옮기는 동료가 가장 적은 것을 고르고,
 * 각 쪽은 물총 옆부터 원래 차례대로 붙여 세운다. 새로 놓을 자리는 바깥 끝에 남는다.
 * 그렇게 해도 자리가 없으면 아무것도 바꾸지 않고 null을, 있으면 새 동료의 첫 칸을 돌려준다.
 */
function repack(allies: Ally[], cells: number): number | null {
  const size = (index: number): number => (index < allies.length ? ALLIES[allies[index].id].cells : cells);
  const count = allies.length + 1;
  let best: { mask: number; moved: number } | null = null;
  for (let mask = 0; mask < 1 << count; mask += 1) {
    let leftCells = 0;
    let rightCells = 0;
    let moved = 0;
    for (let index = 0; index < count; index += 1) {
      const right = (mask >> index) & 1;
      if (right) rightCells += size(index);
      else leftCells += size(index);
      if (index < allies.length && rightSide(allies[index].cell) !== (right === 1)) moved += 1;
    }
    if (leftCells > GARDEN_CELLS.half || rightCells > GARDEN_CELLS.half) continue;
    if (!best || moved < best.moved) best = { mask, moved };
  }
  if (!best) return null;
  // 왼쪽은 물총 옆(3번 칸)부터 바깥으로, 오른쪽은 물총 옆(4번 칸)부터 바깥으로 붙여 세운다.
  const inner = (index: number): number =>
    rightSide(allies[index].cell) ? allies[index].cell - GARDEN_CELLS.half : GARDEN_CELLS.half - allies[index].cell;
  let leftEdge = GARDEN_CELLS.half;
  let rightEdge = GARDEN_CELLS.half;
  const order = allies.map((_, index) => index).sort((a, b) => inner(a) - inner(b));
  for (const index of order) {
    const cellsOf = size(index);
    if ((best.mask >> index) & 1) {
      allies[index].cell = rightEdge;
      rightEdge += cellsOf;
    } else {
      leftEdge -= cellsOf;
      allies[index].cell = leftEdge;
    }
  }
  return (best.mask >> allies.length) & 1 ? rightEdge : leftEdge - cells;
}

/** 칸의 차례대로 동료를 늘어놓는다. 쏘는 차례와 그리는 차례가 늘 같게 한다. */
function sortByCell(allies: Ally[]): void {
  allies.sort((a, b) => a.cell - b.cell);
}

/** 그 동료를 새로 놓을 빈칸이 있는지(흩어진 빈칸은 다시 늘어놓아 모은다) */
export function canPlace(state: Pick<RunState, 'allies'>, id: AllyId): boolean {
  const cells = ALLIES[id].cells;
  if (freeCells(state.allies) < cells) return false;
  if (findCell(state.allies, cells) !== null) return true;
  // 다시 늘어놓아 볼 뿐 바꾸지는 않는다.
  return repack(state.allies.map((ally) => ({ ...ally })), cells) !== null;
}

/**
 * 동료를 빈칸에 새로 놓는다. 새로 선 동료는 조금 기다렸다가 쏘기 시작한다. 놓았으면 그 동료를, 자리가 없으면 null
 */
export function placeAlly(state: Pick<RunState, 'allies'>, id: AllyId, copies = 1): Ally | null {
  if (!canPlace(state, id)) return null;
  const cells = ALLIES[id].cells;
  const cell = findCell(state.allies, cells) ?? repack(state.allies, cells);
  if (cell === null) return null;
  const ally: Ally = { id, copies: Math.min(copiesFor(ALLY_STARS.max), copies), fireIn: 0.5, cell };
  state.allies.push(ally);
  sortByCell(state.allies);
  return ally;
}

/** 같은 동료를 합칠 대상. 아직 다 올리지 않은 것 가운데 가장 많이 모은 것이다. 없으면 undefined */
export function mergeTarget(state: Pick<RunState, 'allies'>, id: AllyId): Ally | undefined {
  let target: Ally | undefined;
  for (const ally of state.allies) {
    if (ally.id !== id || maxed(ally.copies)) continue;
    if (!target || ally.copies > target.copies) target = ally;
  }
  return target;
}

/** 그 동료가 텃밭에 있는지 */
export function owns(state: Pick<RunState, 'allies'>, id: AllyId): boolean {
  return state.allies.some((ally) => ally.id === id);
}

/** 판에 선 그 동료 가운데 가장 많이 모은 것. 없으면 undefined */
export function allyOf(state: Pick<RunState, 'allies'>, id: AllyId): Ally | undefined {
  let found: Ally | undefined;
  for (const ally of state.allies) if (ally.id === id && (!found || ally.copies > found.copies)) found = ally;
  return found;
}

/** 같은 동료에 합친다. 별이 올랐으면 그 별을, 아니면 0을, 합칠 대상이 없으면 null을 돌려준다. */
export function mergeAlly(state: Pick<RunState, 'allies'>, id: AllyId, copies = 1): number | null {
  const ally = mergeTarget(state, id);
  if (!ally) return null;
  const before = starOf(ally.copies);
  ally.copies = Math.min(copiesFor(ALLY_STARS.max), ally.copies + copies);
  const after = starOf(ally.copies);
  return after > before ? after : 0;
}

/** 내보내면 돌려받는 열매: 모은 수만큼의 값의 절반(내림) */
export function refundFor(ally: Pick<Ally, 'id' | 'copies'>): number {
  return Math.floor((ALLIES[ally.id].price * ally.copies) / 2);
}

/** 가게가 열려 있을 때 그 자리(state.allies의 차례)의 동료를 내보낸다. 돌려받은 열매를, 못 내보냈으면 null */
export function dismissAlly(state: RunState, index: number): number | null {
  if (!state.shopping) return null;
  const ally = state.allies[index];
  if (!ally) return null;
  const refund = refundFor(ally);
  state.allies.splice(index, 1);
  state.fruit += refund;
  return refund;
}

// ------------------------------------------------------------ 가게

/** 그날 가게에 나올 수 있는 동료. 그날까지 나온 동료다. */
export function shopPool(state: Pick<RunState, 'day'>): AllyId[] {
  return ALLY_ORDER.filter((id) => ALLIES[id].fromDay <= state.day);
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

/** 그 카드를 그 방법(합치기, 새로 놓기)으로 지금 살 수 있는지 */
export function canBuyCard(state: RunState, index: number, mode: BuyMode): boolean {
  const card = state.shop[index];
  if (!state.shopping || !card || card.sold || state.fruit < ALLIES[card.id].price) return false;
  return mode === 'merge' ? mergeTarget(state, card.id) !== undefined : canPlace(state, card.id);
}

/** 그 카드를 어떻게든 살 수 있는지(합치거나 새로 놓거나) */
export function canBuyAny(state: RunState, index: number): boolean {
  return canBuyCard(state, index, 'merge') || canBuyCard(state, index, 'place');
}

/** 산 결과. star는 합쳐서 오른 별(오르지 않았으면 0)이거나 새로 놓은 동료의 별(1)이다. ally는 합친(새로 놓은) 동료다. */
export interface Bought {
  id: AllyId;
  mode: BuyMode;
  star: number;
  ally: Ally;
}

/** 카드를 산다. 합치면 칸은 그대로 별이 오르고, 새로 놓으면 빈칸에 하나 더 선다. 사지 못했으면 null */
export function buyCard(state: RunState, index: number, mode: BuyMode): Bought | null {
  if (!canBuyCard(state, index, mode)) return null;
  const card = state.shop[index];
  let ally: Ally | null | undefined;
  let star: number | null;
  if (mode === 'merge') {
    ally = mergeTarget(state, card.id);
    star = mergeAlly(state, card.id);
  } else {
    ally = placeAlly(state, card.id);
    star = ally ? 1 : null;
  }
  if (!ally || star === null) return null;
  state.fruit -= ALLIES[card.id].price;
  state.shop = state.shop.map((other, at) => (at === index ? { ...other, sold: true } : other));
  return { id: card.id, mode, star, ally };
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
