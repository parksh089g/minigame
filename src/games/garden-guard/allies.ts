/**
 * 동료와 동료 가게의 규칙. 판 안에서 열매로 동료를 사서 텃밭의 칸에 세운다. 동료마다 차지하는 칸이 다르고,
 * 같은 동료를 또 사면 합쳐서 별을 올리거나(칸은 그대로) 빈칸에 하나 더 놓는다.
 * 화면이 없는 규칙이라서 시뮬레이션(sim.ts)과 자동 플레이(bot.ts)가 함께 쓴다.
 */
import { ALLIES, ALLY_ORDER, ALLY_STARS, CELL_COUNT, GARDEN_CELLS, PAIRS, SHOOTER, SHOP, TEAM_HEAT, type AllyId } from './data';
import { shopSeed } from './daily';
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
  /**
   * 묶어 둔 카드인지. 묶어 둔 카드는 다시 뽑아도, 다음 날 가게가 다시 열려도 그 자리에 남는다.
   * 묶기 전에 적은 판의 카드에는 없어서 적지 않으면 묶지 않은 것이다.
   */
  locked?: boolean;
}

/** 이미 있는 동료를 살 때 고르는 것: 합쳐서 별을 올리거나(merge), 빈칸에 하나 더 놓거나(place) */
export type BuyMode = 'merge' | 'place';

/** 그 별이 되는 데 모아야 하는 수(ALLY_STARS.copies): ★1은 1, ★2는 2, ★3은 3, ★4는 5, ★5는 8마리 */
export function copiesFor(star: number): number {
  return ALLY_STARS.copies[Math.max(1, Math.min(ALLY_STARS.max, Math.floor(star))) - 1];
}

/** 모은 수에 따른 별(1~ALLY_STARS.max). 하나도 없으면 0 */
export function starOf(copies: number): number {
  let star = 0;
  for (let next = 1; next <= ALLY_STARS.max && copies >= copiesFor(next); next += 1) star = next;
  return star;
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

/** 한 줄의 칸 수(왼쪽과 오른쪽을 합친 것) */
const ROW = GARDEN_CELLS.cols * 2;

/** 칸의 가로 자리(0~7)와 줄(0부터) */
export function cellAt(cell: number): { col: number; row: number } {
  return { col: cell % ROW, row: Math.floor(cell / ROW) };
}

/** 그 가로 자리가 물총의 오른쪽인지 */
function rightSide(col: number): boolean {
  return col >= GARDEN_CELLS.cols;
}

/** 칸 하나의 왼쪽 위 끝(시뮬레이션 좌표). 울타리 아래는 화면에서도 같은 크기다. */
export function cellCorner(cell: number): { x: number; y: number } {
  const { col, row } = cellAt(cell);
  const side = rightSide(col);
  const left = side ? GARDEN_CELLS.right : GARDEN_CELLS.left;
  return { x: left + (side ? col - GARDEN_CELLS.cols : col) * GARDEN_CELLS.cell, y: GARDEN_CELLS.top + row * GARDEN_CELLS.cell };
}

/** 그 동료의 모양이 차지하는 가로 칸 수와 세로 칸 수 */
export function shapeSize(id: AllyId): { width: number; height: number } {
  const shape = ALLIES[id].shape;
  return { width: Math.max(...shape.map(([x]) => x)) + 1, height: Math.max(...shape.map(([, y]) => y)) + 1 };
}

/**
 * 첫 칸이 cell인 그 동료가 차지하는 칸들. 밭 밖으로 나가거나 물총을 넘어 양쪽에 걸치면 null
 */
export function shapeCells(id: AllyId, cell: number): number[] | null {
  if (!Number.isInteger(cell) || cell < 0 || cell >= CELL_COUNT) return null;
  const { col, row } = cellAt(cell);
  const cells: number[] = [];
  for (const [dx, dy] of ALLIES[id].shape) {
    const x = col + dx;
    const y = row + dy;
    if (x >= ROW || y >= GARDEN_CELLS.rows || rightSide(x) !== rightSide(col)) return null;
    cells.push(y * ROW + x);
  }
  return cells;
}

/** 첫 칸이 cell인 그 동료가 서는 자리(시뮬레이션 좌표). 모양을 감싼 네모의 한가운데다. */
export function cellSpot(cell: number, id: AllyId): { x: number; y: number } {
  const corner = cellCorner(cell);
  const { width, height } = shapeSize(id);
  return { x: corner.x + (width * GARDEN_CELLS.cell) / 2, y: corner.y + (height * GARDEN_CELLS.cell) / 2 };
}

/** 동료가 서는 자리(시뮬레이션 좌표) */
export function allySpot(ally: Pick<Ally, 'id' | 'cell'>): { x: number; y: number } {
  return cellSpot(ally.cell, ally.id);
}

/** 칸마다 서 있는 동료의 차례(state.allies의 자리). 빈칸은 -1 */
export function cellMap(allies: readonly Pick<Ally, 'id' | 'cell'>[]): number[] {
  const map = new Array<number>(CELL_COUNT).fill(-1);
  allies.forEach((ally, index) => {
    for (const cell of shapeCells(ally.id, ally.cell) ?? []) map[cell] = index;
  });
  return map;
}

/** 동료들이 칸을 겹치지 않고 밭 안에 제대로 서 있는지(저장된 판을 읽을 때 본다) */
export function cellsValid(allies: readonly Pick<Ally, 'id' | 'cell'>[]): boolean {
  const used = new Array<boolean>(CELL_COUNT).fill(false);
  for (const ally of allies) {
    const cells = shapeCells(ally.id, ally.cell);
    if (!cells) return false;
    for (const cell of cells) {
      if (used[cell]) return false;
      used[cell] = true;
    }
  }
  return true;
}

/** 빈칸의 수 */
export function freeCells(allies: readonly Pick<Ally, 'id'>[]): number {
  return CELL_COUNT - allies.reduce((sum, ally) => sum + ALLIES[ally.id].cells, 0);
}

/** 그 동료를 첫 칸 cell에 놓을 수 있는지. ignore(state.allies의 차례)인 동료가 선 칸은 빈 것으로 친다(옮길 때). */
export function fitsAt(allies: readonly Pick<Ally, 'id' | 'cell'>[], id: AllyId, cell: number, ignore = -1): boolean {
  const cells = shapeCells(id, cell);
  if (!cells) return false;
  const map = cellMap(allies);
  return cells.every((at) => map[at] === -1 || map[at] === ignore);
}

// ------------------------------------------------------------ 짝 효과(PAIRS)

/** 짝 효과로 받는 덤: 피해 + damage, 빠르기 + rate(0.1이면 10%). 덤이 없으면 둘 다 0 */
export interface PairBonus {
  damage: number;
  rate: number;
}

/** 짝이 된 두 동료(state.allies의 차례, a < b)와, 화면이 하트를 그릴 자리(시뮬레이션 좌표, 둘이 맞닿은 변 위) */
export interface PairLink {
  a: number;
  b: number;
  x: number;
  y: number;
}

/** 덤을 한 번만 받게 셀 때 쓰는 동료의 차례 */
const PAIR_ORDER: Readonly<Record<AllyId, number>> = Object.fromEntries(ALLY_ORDER.map((id, index) => [id, index])) as Record<
  AllyId,
  number
>;

/** owner의 짝 효과가 partner를 짝으로 삼는지 */
function pairsWith(owner: AllyId, partner: AllyId): boolean {
  const partners = PAIRS[owner].with;
  return partners === 'any' || partners.includes(partner);
}

/** 두 동료가 붙으면 짝이 되는지(어느 쪽의 짝 효과든 하나라도 맞으면) */
export function pairs(a: AllyId, b: AllyId): boolean {
  return pairsWith(a, b) || pairsWith(b, a);
}

/** 그 칸과 변이 맞닿은 칸들. 물총을 사이에 둔 왼쪽 끝과 오른쪽 끝은 맞닿지 않는다. */
function sideNeighbours(cell: number): number[] {
  const { col, row } = cellAt(cell);
  const inSide = col % GARDEN_CELLS.cols;
  const near: number[] = [];
  if (inSide > 0) near.push(cell - 1);
  if (inSide < GARDEN_CELLS.cols - 1) near.push(cell + 1);
  if (row > 0) near.push(cell - ROW);
  if (row < GARDEN_CELLS.rows - 1) near.push(cell + ROW);
  return near;
}

/** 맞닿은 두 동료(a < b)와 맞닿은 변들([a의 칸, b의 칸]). 칸의 차례대로 찾아서 늘 같은 차례다. */
function touching(allies: readonly Pick<Ally, 'id' | 'cell'>[]): Array<{ a: number; b: number; edges: Array<[number, number]> }> {
  const map = cellMap(allies);
  const found = new Map<number, { a: number; b: number; edges: Array<[number, number]> }>();
  for (let cell = 0; cell < CELL_COUNT; cell += 1) {
    const a = map[cell];
    if (a === -1) continue;
    for (const next of sideNeighbours(cell)) {
      const b = map[next];
      if (b <= a) continue;
      const key = a * CELL_COUNT + b;
      let pair = found.get(key);
      if (!pair) {
        pair = { a, b, edges: [] };
        found.set(key, pair);
      }
      pair.edges.push([cell, next]);
    }
  }
  return [...found.values()];
}

/**
 * 짝이 된 동료들과 하트를 그릴 자리. 옆으로 맞닿았으면 맞닿은 변들 가운데 가운데 것의 한가운데다.
 * 위아래로만 맞닿았으면 변의 한가운데가 위 동료의 발밑(별 글자가 적히는 줄)에 걸리므로, 맞닿은 변의 끝 가운데
 * 위 동료의 별 글자에서 가장 먼 곳이다(같으면 오른쪽 끝).
 */
export function pairLinks(allies: readonly Pick<Ally, 'id' | 'cell'>[]): PairLink[] {
  const links: PairLink[] = [];
  const size = GARDEN_CELLS.cell;
  const map = cellMap(allies);
  for (const { a, b, edges } of touching(allies)) {
    if (!pairs(allies[a].id, allies[b].id)) continue;
    const across = edges.filter(([from, to]) => Math.abs(to - from) === 1);
    if (across.length > 0) {
      const [from, to] = across[Math.floor((across.length - 1) / 2)];
      const corner = cellCorner(Math.min(from, to));
      links.push({ a, b, x: corner.x + size, y: corner.y + size / 2 });
      continue;
    }
    let best: { x: number; y: number; away: number } | null = null;
    for (const [from, to] of [...edges].reverse()) {
      const upper = Math.min(from, to);
      const corner = cellCorner(upper);
      const star = allySpot(allies[map[upper]]).x;
      for (const x of [corner.x + size, corner.x]) {
        const away = Math.abs(x - star);
        if (!best || away > best.away + 1e-9) best = { x, y: corner.y + size, away };
      }
    }
    if (best) links.push({ a, b, x: best.x, y: best.y });
  }
  return links;
}

/**
 * 동료마다(state.allies의 차례대로) 짝 효과로 받는 덤. 같은 동료의 같은 덤은 짝이 여럿이어도 한 번만 받는다.
 * 시뮬레이션은 동료가 쏠 때 이 덤을 읽는다. 동료의 칸으로만 정해지는 값이다.
 */
export function pairBonuses(allies: readonly Pick<Ally, 'id' | 'cell'>[]): PairBonus[] {
  const bonus = allies.map(() => ({ damage: 0, rate: 0 }));
  const taken = allies.map(() => 0);
  const give = (to: number, owner: AllyId, part: number): void => {
    const bit = 1 << (PAIR_ORDER[owner] * 2 + part);
    if (taken[to] & bit) return;
    taken[to] |= bit;
    bonus[to].damage += PAIRS[owner].damage ?? 0;
    bonus[to].rate += PAIRS[owner].rate ?? 0;
  };
  for (const { a, b } of touching(allies)) {
    for (const [owner, partner] of [
      [a, b],
      [b, a],
    ]) {
      const id = allies[owner].id;
      if (!pairsWith(id, allies[partner].id)) continue;
      const gives = PAIRS[id].gives;
      if (gives !== 'other') give(owner, id, 0);
      if (gives !== 'self') give(partner, id, 1);
    }
  }
  return bonus;
}

/**
 * 그 동료를 첫 칸 cell에 놓으면 생기는 짝: 2는 이 동료의 짝 효과가 맞는 자리, 1은 곁의 동료의 짝 효과만 맞는 자리
 * (해바라기 곁처럼), 0은 짝이 없는 자리다. ignore(state.allies의 차례)인 동료는 없는 것으로 친다(옮길 때).
 */
export function pairScore(allies: readonly Pick<Ally, 'id' | 'cell'>[], id: AllyId, cell: number, ignore = -1): number {
  const cells = shapeCells(id, cell);
  if (!cells) return 0;
  const map = cellMap(allies);
  let score = 0;
  for (const at of cells) {
    for (const next of sideNeighbours(at)) {
      const other = map[next];
      if (other === -1 || other === ignore || cells.includes(next)) continue;
      if (pairsWith(id, allies[other].id)) return 2;
      if (pairsWith(allies[other].id, id)) score = 1;
    }
  }
  return score;
}

/** 그 동료를 첫 칸 cell에 놓으면 짝이 생기는지(끄는 동안 "짝!"을 띄운다) */
export function formsPair(allies: readonly Pick<Ally, 'id' | 'cell'>[], id: AllyId, cell: number, ignore = -1): boolean {
  return pairScore(allies, id, cell, ignore) > 0;
}

/**
 * 그 동료를 저절로 놓을 첫 칸. 제 짝 효과가 맞는 자리가 먼저이고, 다음은 곁의 동료의 짝 효과라도 맞는 자리,
 * 그 가운데 물총에 가까운 자리, 같은 거리면 번호가 작은 칸이 먼저다. 자리가 없으면 null
 * (가게에서 카드를 누르기만 했을 때와 자동 플레이가 쓴다. 끌어다 놓으면 놓은 자리에 선다.)
 */
export function findCell(allies: readonly Pick<Ally, 'id' | 'cell'>[], id: AllyId): number | null {
  let best: { cell: number; distance: number; score: number } | null = null;
  for (let cell = 0; cell < CELL_COUNT; cell += 1) {
    if (!fitsAt(allies, id, cell)) continue;
    const spot = cellSpot(cell, id);
    const distance = Math.hypot(spot.x - SHOOTER.x, spot.y - SHOOTER.y);
    const score = pairScore(allies, id, cell);
    if (!best || score > best.score || (score === best.score && distance < best.distance - 1e-9)) best = { cell, distance, score };
  }
  return best ? best.cell : null;
}

/** 가게의 카드를 누르기만 해도 제 짝 효과가 맞는 자리에 서는지(카드에 설명 대신 그 짝 효과를 적는다) */
export function pairReady(allies: readonly Pick<Ally, 'id' | 'cell'>[], id: AllyId): boolean {
  const cell = findCell(allies, id);
  return cell !== null && pairScore(allies, id, cell) === 2;
}

/** 칸의 차례대로 동료를 늘어놓는다. 쏘는 차례와 그리는 차례가 늘 같게 한다. */
function sortByCell(allies: Ally[]): void {
  allies.sort((a, b) => a.cell - b.cell);
}

/** 그 동료를 새로 놓을 자리가 있는지 */
export function canPlace(state: Pick<RunState, 'allies'>, id: AllyId): boolean {
  return findCell(state.allies, id) !== null;
}

/**
 * 동료를 빈칸에 새로 놓는다. cell을 주면 그 칸(첫 칸)에, 주지 않으면 물총에 가까운 빈자리에 놓는다.
 * 새로 선 동료는 조금 기다렸다가 쏘기 시작한다. 놓았으면 그 동료를, 자리가 없으면 null
 */
export function placeAlly(state: Pick<RunState, 'allies'>, id: AllyId, copies = 1, cell?: number): Ally | null {
  const at = cell ?? findCell(state.allies, id);
  if (at === null || !fitsAt(state.allies, id, at)) return null;
  const ally: Ally = { id, copies: Math.min(copiesFor(ALLY_STARS.max), copies), fireIn: 0.5, cell: at };
  state.allies.push(ally);
  sortByCell(state.allies);
  return ally;
}

/** 가게가 열려 있을 때 그 동료(state.allies의 차례)를 다른 칸으로 옮긴다. 옮겼으면 그 동료, 못 옮겼으면 null */
export function moveAlly(state: RunState, index: number, cell: number): Ally | null {
  const ally = state.allies[index];
  if (!state.shopping || !ally || ally.cell === cell || !fitsAt(state.allies, ally.id, cell, index)) return null;
  ally.cell = cell;
  sortByCell(state.allies);
  return ally;
}

/** 같은 동료 둘을 하나로 합칠 수 있는지(from을 to에 합친다). 합친 수가 다 모은 수를 넘으면 안 된다. */
export function canJoin(state: RunState, from: number, to: number): boolean {
  const a = state.allies[from];
  const b = state.allies[to];
  return state.shopping && !!a && !!b && from !== to && a.id === b.id && a.copies + b.copies <= copiesFor(ALLY_STARS.max);
}

/** 가게가 열려 있을 때 밭의 같은 동료 둘을 합친다(from이 to에 합쳐져 칸이 빈다). 합친 동료와 오른 별(오르지 않았으면 0), 못 합쳤으면 null */
export function joinAllies(state: RunState, from: number, to: number): { ally: Ally; star: number } | null {
  if (!canJoin(state, from, to)) return null;
  const target = state.allies[to];
  const before = starOf(target.copies);
  target.copies += state.allies[from].copies;
  state.allies.splice(from, 1);
  const after = starOf(target.copies);
  return { ally: target, star: after > before ? after : 0 };
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

/**
 * 같은 동료에 합친다. target(state.allies의 차례)을 주면 그 동료에, 주지 않으면 mergeTarget에 합친다.
 * 합친 동료와 오른 별(오르지 않았으면 0)을, 합칠 수 없으면 null을 돌려준다.
 */
export function mergeAlly(
  state: Pick<RunState, 'allies'>,
  id: AllyId,
  copies = 1,
  target?: number,
): { ally: Ally; star: number } | null {
  const ally = target === undefined ? mergeTarget(state, id) : state.allies[target];
  if (!ally || ally.id !== id || maxed(ally.copies)) return null;
  const before = starOf(ally.copies);
  ally.copies = Math.min(copiesFor(ALLY_STARS.max), ally.copies + copies);
  const after = starOf(ally.copies);
  return { ally, star: after > before ? after : 0 };
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
  // 오늘의 판은 그날과 그 가게에서 몇 번째로 뽑는지로만 정해서, 앞에서 어떻게 했든 같은 가게에는 같은 카드가 나온다.
  let seed = state.daily
    ? shopSeed(state.daily.day, state.day, state.daily.draws)
    : (state.rng ^ Math.imul(state.day + 1, 0x9e3779b1) ^ Math.imul(state.rolls + 1, 0x85ebca6b)) | 0;
  const cards: ShopCard[] = [];
  for (let index = 0; index < SHOP.cards; index += 1) {
    const next = nextRandom(seed);
    seed = next.state;
    cards.push({ id: pool[Math.floor(next.value * pool.length)], sold: false });
  }
  return cards;
}

/** 다음에 가게를 다시 그릴 때 그 자리에 남는 카드인지: 묶어 두었고 아직 사지 않은 카드 */
export function keptCard(card: ShopCard | undefined): boolean {
  return !!card && !!card.locked && !card.sold;
}

/**
 * 새로 뽑은 카드(drawn) 가운데 묶어 둔 카드(previous의 같은 자리)가 있던 자리는 묶어 둔 카드로 남긴다.
 * 남은 자리만 새 카드가 된다. 뽑는 난수는 그대로라서 묶지 않은 자리에는 묶지 않았을 때와 같은 카드가 나온다.
 */
export function keepLocked(previous: readonly ShopCard[], drawn: ShopCard[]): ShopCard[] {
  return drawn.map((card, index) => (keptCard(previous[index]) ? previous[index] : card));
}

/** 가게를 연다. 판의 첫날 앞과, 날을 지킬 때마다 연다. 전날 묶어 둔 카드는 그 자리에 그대로 있다. */
export function openShop(state: RunState): void {
  state.shopping = true;
  if (state.daily) state.daily.draws = 0;
  state.shop = keepLocked(state.shop, drawShop(state));
}

/**
 * 가게를 닫을 때 남길 카드. 묶어 둔 카드가 있으면 다음에 열 때 그 자리에 놓도록 카드 줄을 그대로 두고, 없으면 비운다.
 * (닫힌 가게의 카드는 살 수 없고, 다음에 열 때 묶어 둔 카드만 쓴다.)
 */
export function closedShop(shop: readonly ShopCard[]): ShopCard[] {
  return shop.some(keptCard) ? [...shop] : [];
}

/** 가게가 열려 있을 때 사지 않은 카드를 묶거나 푼다. 묶는 데에는 열매가 들지 않는다. 바뀐 묶임(묶었으면 true), 못 바꿨으면 null */
export function toggleLock(state: RunState, index: number): boolean | null {
  const card = state.shop[index];
  if (!state.shopping || !card || card.sold) return null;
  const locked = !card.locked;
  state.shop = state.shop.map((other, at) => (at === index ? { ...other, locked } : other));
  return locked;
}

/**
 * 카드를 어디에 사는지. 새로 놓을 때 cell은 첫 칸(끌어다 놓은 자리)이고, 합칠 때 ally는 합칠 동료(state.allies의 차례)다.
 * 주지 않으면 물총에 가까운 빈자리에 놓거나 가장 많이 모은 동료에 합친다.
 */
export interface BuyAt {
  cell?: number;
  ally?: number;
}

/** 그 카드를 그 방법(합치기, 새로 놓기)으로 지금 살 수 있는지 */
export function canBuyCard(state: RunState, index: number, mode: BuyMode, at: BuyAt = {}): boolean {
  const card = state.shop[index];
  if (!state.shopping || !card || card.sold || state.fruit < ALLIES[card.id].price) return false;
  if (mode === 'merge') {
    if (at.ally === undefined) return mergeTarget(state, card.id) !== undefined;
    const ally = state.allies[at.ally];
    return !!ally && ally.id === card.id && !maxed(ally.copies);
  }
  return at.cell === undefined ? canPlace(state, card.id) : fitsAt(state.allies, card.id, at.cell);
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
export function buyCard(state: RunState, index: number, mode: BuyMode, at: BuyAt = {}): Bought | null {
  if (!canBuyCard(state, index, mode, at)) return null;
  const card = state.shop[index];
  let ally: Ally | null;
  let star: number;
  if (mode === 'merge') {
    const merged = mergeAlly(state, card.id, 1, at.ally);
    ally = merged?.ally ?? null;
    star = merged?.star ?? 0;
  } else {
    ally = placeAlly(state, card.id, 1, at.cell);
    star = 1;
  }
  if (!ally) return null;
  state.fruit -= ALLIES[card.id].price;
  state.shop = state.shop.map((other, at) => (at === index ? { ...other, sold: true } : other));
  return { id: card.id, mode, star, ally };
}

/** 카드를 다시 뽑을 수 있는지. 카드를 모두 묶어 두었으면 바뀔 것이 없으니 뽑지 않는다. */
export function canReroll(state: RunState): boolean {
  return (
    state.shopping &&
    state.fruit >= SHOP.reroll &&
    shopPool(state).length > 0 &&
    (state.shop.length < SHOP.cards || !state.shop.every(keptCard))
  );
}

/** 열매를 내고 카드를 다시 뽑는다. 묶어 둔 카드는 그 자리에 남는다. 뽑았으면 true */
export function reroll(state: RunState): boolean {
  if (!canReroll(state)) return false;
  state.fruit -= SHOP.reroll;
  state.rolls += 1;
  if (state.daily) state.daily.draws += 1;
  state.shop = keepLocked(state.shop, drawShop(state));
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
