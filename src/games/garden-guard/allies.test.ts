import { describe, expect, it } from 'vitest';
import {
  allyDamage,
  allyInterval,
  allyLabel,
  buyCard,
  allySpot,
  canBuyCard,
  canJoin,
  canPlace,
  cellAt,
  cellCorner,
  cellSpot,
  cellsValid,
  copiesFor,
  dismissAlly,
  drawShop,
  fitsAt,
  freeCells,
  fruitFor,
  heatScale,
  maxed,
  mergeAlly,
  moveAlly,
  nextStar,
  placeAlly,
  refundFor,
  reroll,
  shapeCells,
  shapeSize,
  shopPool,
  starOf,
} from './allies';
import { botShop } from './bot';
import {
  ALLIES,
  ALLY_ORDER,
  ALLY_STARS,
  CELL_COUNT,
  ENEMIES,
  FIELD,
  GARDEN_CELLS,
  SHOOTER,
  SHOP,
  SUMMON,
  TEAM_HEAT,
  type AllyId,
  type EnemyKind,
} from './data';
import { hpScale, isBossDay } from './rules';
import { cardStatus, SHOP_TEXT } from './shop-text';
import { allyTarget, createRun, skipShop, step, type Enemy, type RunState, type SimEvent } from './sim';

const DT = 1 / 60;

function shopAt(day = 1, seed = 11): RunState {
  return createRun({ seed, startDay: day, levels: {}, bestBefore: 0 }).state;
}

/** 그날 나올 벌레를 치운 빈 판. 물총은 쉬게 한다. */
function quiet(allies: Array<[AllyId, number]>, day = 1): RunState {
  const state = shopAt(day);
  skipShop(state);
  state.queue = [];
  state.dayTotal = 0;
  state.fireIn = 1e9;
  for (const [id, copies] of allies) placeAlly(state, id, copies);
  for (const ally of state.allies) ally.fireIn = 0;
  return state;
}

function put(state: RunState, kind: EnemyKind, x: number, y: number, hp = 1e6): Enemy {
  const enemy: Enemy = {
    id: state.nextId++,
    kind,
    x,
    y,
    homeX: x,
    hp,
    maxHp: hp,
    day: state.day,
    biting: false,
    biteIn: ENEMIES[kind].biteEvery,
    clock: 0,
    slow: 0,
    slowLeft: 0,
    summonIn: SUMMON.every,
    flash: 0,
  };
  state.enemies.push(enemy);
  state.dayTotal += 1;
  return enemy;
}

function run(state: RunState, seconds: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let time = 0; time < seconds && state.phase !== 'over'; time += DT) events.push(...step(state, DT));
  return events;
}

describe('별과 합치기', () => {
  it('두 마리면 ★2, 셋이면 ★3, 다섯이면 ★4, 여덟이면 ★5이고 그 위로는 오르지 않는다', () => {
    expect([0, 1, 2, 3, 4, 5, 7, 8, 16, 40].map(starOf)).toEqual([0, 1, 2, 3, 3, 4, 4, 5, 5, 5]);
    expect([1, 2, 3, 4, 5].map(copiesFor)).toEqual([1, 2, 3, 5, 8]);
    expect(nextStar(1)).toEqual({ have: 1, need: 2 });
    expect(nextStar(4)).toEqual({ have: 4, need: 5 });
    expect(nextStar(8)).toBeNull();
    expect(maxed(7)).toBe(false);
    expect(maxed(8)).toBe(true);
  });

  it('한 판에 버는 열매로 ★5까지 닿는다: 아흐레를 지키고 받는 열매로 가장 싼 동료를 ★5로 모을 수 있다 (11차 검토)', () => {
    let fruit = SHOP.purse;
    for (let day = 1; day <= 9; day += 1) fruit += fruitFor(day);
    const cheapest = Math.min(...ALLY_ORDER.map((id) => ALLIES[id].price));
    expect(copiesFor(ALLY_STARS.max) * cheapest).toBeLessThanOrEqual(fruit);
  });

  it('별이 오를수록 세고 빠르게 쏘고, 물총이 세지면 동료도 세진다', () => {
    for (const id of ALLY_ORDER) {
      for (let star = 1; star < ALLY_STARS.max; star += 1) {
        expect(allyDamage(id, star + 1, 20, 1), id).toBeGreaterThan(allyDamage(id, star, 20, 1));
        expect(allyInterval(id, star + 1), id).toBeLessThan(allyInterval(id, star));
      }
      expect(allyDamage(id, 1, 40, 1)).toBeCloseTo(allyDamage(id, 1, 20, 1) * 2);
      expect(allyDamage(id, 1, 20, 1.3)).toBeCloseTo(allyDamage(id, 1, 20, 1) * 1.3);
    }
  });

  it('같은 동료를 합치면 하나로 모이고 별이 오른 때를 알려 주며, 다 모은 뒤로는 늘지 않는다', () => {
    const state = quiet([['frog', 1], ['sunflower', 1]]);
    expect(mergeAlly(state, 'frog')?.star).toBe(2);
    expect(mergeAlly(state, 'frog')?.star).toBe(3);
    expect(mergeAlly(state, 'frog')?.star).toBe(0);
    // 없는 동료에는 합칠 수 없다.
    expect(mergeAlly(state, 'mint')).toBeNull();
    // 칸의 차례대로 선다.
    expect(state.allies.map((ally) => ally.id)).toEqual(['frog', 'sunflower']);
    const frog = state.allies[0];
    expect(frog.copies).toBe(4);
    expect(allyLabel(frog)).toBe('개구리 ★3');
    mergeAlly(state, 'frog', 40);
    expect(frog.copies).toBe(copiesFor(ALLY_STARS.max));
    expect(mergeAlly(state, 'frog')).toBeNull();
  });
});

describe('텃밭의 칸', () => {
  it('밭은 물총의 양옆에 네 칸씩 세 줄이고, 칸끼리 겹치지 않고 물총 자리를 비운다', () => {
    expect(CELL_COUNT).toBe(24);
    const corners = Array.from({ length: CELL_COUNT }, (_, cell) => cellCorner(cell));
    for (let a = 0; a < CELL_COUNT; a += 1) {
      const corner = corners[a];
      expect(corner.x).toBeGreaterThanOrEqual(0);
      expect(corner.x + GARDEN_CELLS.cell).toBeLessThanOrEqual(FIELD.width);
      expect(corner.y).toBeGreaterThanOrEqual(FIELD.depth);
      // 물총 둘레(좌우 18)는 비어 있다.
      expect(corner.x + GARDEN_CELLS.cell <= SHOOTER.x - 18 || corner.x >= SHOOTER.x + 18).toBe(true);
      for (let b = a + 1; b < CELL_COUNT; b += 1) {
        const other = corners[b];
        const apart =
          corner.x + GARDEN_CELLS.cell <= other.x ||
          other.x + GARDEN_CELLS.cell <= corner.x ||
          corner.y + GARDEN_CELLS.cell <= other.y ||
          other.y + GARDEN_CELLS.cell <= corner.y;
        expect(apart, `${a}, ${b}`).toBe(true);
      }
    }
    expect(cellAt(13)).toEqual({ col: 5, row: 1 });
  });

  it('동료마다 모양이 있고(세로, 가로, ㄴ자, 네모), 칸을 많이 차지할수록 한 마리가 세다', () => {
    for (const id of ALLY_ORDER) expect(ALLIES[id].shape.length, id).toBe(ALLIES[id].cells);
    const three = ALLY_ORDER.filter((id) => ALLIES[id].cells === 3).map((id) => shapeSize(id));
    // 세 칸짜리는 세로, 가로, ㄴ자가 하나씩이다.
    expect(three).toEqual(expect.arrayContaining([{ width: 1, height: 3 }, { width: 3, height: 1 }, { width: 2, height: 2 }]));
    const power = (id: AllyId): number => allyDamage(id, 1, 20, 1) / ALLIES[id].interval;
    const sizes = new Set(ALLY_ORDER.map((id) => ALLIES[id].cells));
    expect([...sizes].sort()).toEqual([1, 2, 3, 4]);
    expect(shapeSize('toad')).toEqual({ width: 2, height: 2 });
    const by = (cells: number): AllyId[] => ALLY_ORDER.filter((id) => ALLIES[id].cells === cells);
    const most = (ids: AllyId[]): number => Math.max(...ids.map(power));
    expect(most(by(2))).toBeGreaterThan(most(by(1)));
    expect(most(by(3))).toBeGreaterThan(most(by(2)));
    expect(most(by(4))).toBeGreaterThan(most(by(3)));
    // 큰 동료는 값도 더 비싸다.
    for (const big of by(3)) for (const small of by(1)) expect(ALLIES[big].price).toBeGreaterThan(ALLIES[small].price);
    for (const big of by(4)) for (const small of by(3)) expect(ALLIES[big].price).toBeGreaterThan(ALLIES[small].price);
  });

  it('뒤에 나오는 사마귀와 두꺼비는 고슴도치보다 열매와 칸 하나에 드는 힘이 조금 낫다', () => {
    const power = (id: AllyId): number => allyDamage(id, 1, 20, 1) / ALLIES[id].interval;
    const perFruit = (id: AllyId): number => power(id) / ALLIES[id].price;
    const perCell = (id: AllyId): number => power(id) / ALLIES[id].cells;
    for (const id of ['mantis', 'toad'] as const) {
      expect(ALLIES[id].fromDay, id).toBeGreaterThan(ALLIES.hedgehog.fromDay);
      // 조금 낫지만 많이 낫지는 않다(3할 안쪽).
      expect(perFruit(id) / perFruit('hedgehog'), id).toBeGreaterThan(1);
      expect(perFruit(id) / perFruit('hedgehog'), id).toBeLessThan(1.3);
      expect(perCell(id) / perCell('hedgehog'), id).toBeGreaterThan(1);
      expect(perCell(id) / perCell('hedgehog'), id).toBeLessThan(1.3);
    }
    // 두꺼비는 한 마리로는 가장 세다.
    for (const id of ALLY_ORDER) if (id !== 'toad') expect(power('toad'), id).toBeGreaterThan(power(id));
  });

  it('모양은 밭 안에서 한쪽에만 서고, 물총을 넘어 양쪽에 걸치지 않는다', () => {
    expect(shapeCells('cactus', 3)).toEqual([3, 11, 19]);
    expect(shapeCells('cactus', 8)).toBeNull();
    expect(shapeCells('pumpkin', 1)).toEqual([1, 2, 3]);
    expect(shapeCells('pumpkin', 2)).toBeNull();
    expect(shapeCells('pumpkin', 5)).toEqual([5, 6, 7]);
    expect(shapeCells('hedgehog', 0)).toEqual([0, 8, 9]);
    expect(shapeCells('hedgehog', 3)).toBeNull();
    expect(shapeCells('frog', 7)).toBeNull();
    // 네모난 네 칸은 위의 두 줄에서만 서고(맨 아래 줄에서는 아래로 넘친다), 한쪽 안에서만 선다.
    expect(shapeCells('toad', 0)).toEqual([0, 1, 8, 9]);
    expect(shapeCells('toad', 10)).toEqual([10, 11, 18, 19]);
    expect(shapeCells('toad', 12)).toEqual([12, 13, 20, 21]);
    expect(shapeCells('toad', 3)).toBeNull();
    expect(shapeCells('toad', 7)).toBeNull();
    expect(shapeCells('toad', 16)).toBeNull();
    expect(shapeCells('toad', 22)).toBeNull();
    expect(shapeCells('mantis', 6)).toEqual([6, 14, 22]);
    expect(shapeCells('mantis', 14)).toBeNull();
    expect(shapeCells('can', 16)).toBeNull();
    expect(shapeCells('sunflower', -1)).toBeNull();
    expect(shapeCells('sunflower', 24)).toBeNull();
    expect(shapeCells('sunflower', 1.5)).toBeNull();
    // 동료는 모양을 감싼 네모의 한가운데에 선다.
    expect(cellSpot(3, 'cactus').x).toBeCloseTo(cellSpot(11, 'sunflower').x);
    expect(cellSpot(3, 'cactus').y).toBeCloseTo(cellSpot(11, 'sunflower').y);
  });

  it('누르기만 하면 물총에 가까운 빈칸부터 서고, 끌어다 놓으면 놓은 칸에 선다', () => {
    const state = quiet([]);
    expect(placeAlly(state, 'sunflower')?.cell).toBe(3);
    expect(placeAlly(state, 'sunflower')?.cell).toBe(4);
    expect(placeAlly(state, 'sunflower')?.cell).toBe(11);
    // 놓은 칸이 비어 있으면 그 칸에, 겹치면 놓지 않는다.
    expect(placeAlly(state, 'cactus', 1, 0)?.cell).toBe(0);
    expect(placeAlly(state, 'hedgehog', 1, 2)).toBeNull();
    expect(placeAlly(state, 'pumpkin', 1, 5)?.cell).toBe(5);
    expect(cellsValid(state.allies)).toBe(true);
    expect(state.allies.map((ally) => ally.cell)).toEqual([0, 3, 4, 5, 11]);
    expect(freeCells(state.allies)).toBe(CELL_COUNT - 9);
  });

  it('두꺼비(2 × 2)는 물총에 가까운 네모난 빈자리에 서고, 자리가 없으면 서지 못한다', () => {
    const state = quiet([]);
    // 물총 바로 옆 두 줄(왼쪽 2·3·10·11)이 가장 가깝다.
    expect(placeAlly(state, 'toad')?.cell).toBe(2);
    // 다음은 오른쪽 4·5·12·13
    expect(placeAlly(state, 'toad')?.cell).toBe(4);
    expect(state.allies.map((ally) => shapeCells(ally.id, ally.cell))).toEqual([
      [2, 3, 10, 11],
      [4, 5, 12, 13],
    ]);
    // 사마귀(세로 3칸)는 두꺼비 둘을 피해 세 줄이 다 빈 곳에 선다.
    expect(placeAlly(state, 'mantis')?.cell).toBe(1);
    // 물뿌리개(세로 2칸)로 위의 두 줄을 채우면, 맨 아래 줄만 남은 곳에는 네모가 들어가지 않는다.
    const low = quiet([]);
    for (const cell of [0, 1, 2, 3, 4, 5, 6, 7]) placeAlly(low, 'can', 1, cell);
    expect(freeCells(low.allies)).toBe(8);
    expect(canPlace(low, 'toad')).toBe(false);
    expect(placeAlly(low, 'toad', 1, 16)).toBeNull();
    expect(canPlace(low, 'pumpkin')).toBe(true);
    expect(cellsValid(state.allies)).toBe(true);
  });

  it('빈칸이 모자라거나 모양이 들어갈 자리가 없으면 새로 놓을 수 없다', () => {
    const state = quiet([]);
    // 세로 세 칸짜리로 밭을 채우고 맨 오른쪽 줄 하나만 비운다.
    for (const cell of [0, 1, 2, 3, 4, 5, 6]) placeAlly(state, 'cactus', 1, cell);
    expect(freeCells(state.allies)).toBe(3);
    expect(canPlace(state, 'cactus')).toBe(true);
    expect(canPlace(state, 'pumpkin')).toBe(false);
    expect(canPlace(state, 'frog')).toBe(false);
    expect(canPlace(state, 'can')).toBe(true);
    placeAlly(state, 'cactus');
    expect(freeCells(state.allies)).toBe(0);
    expect(canPlace(state, 'sunflower')).toBe(false);
  });

  it('칸이 겹치거나 밭 밖으로 나간 자리는 틀린 자리다', () => {
    expect(cellsValid([{ id: 'frog', cell: 3 }])).toBe(false);
    expect(cellsValid([{ id: 'cactus', cell: 9 }])).toBe(false);
    expect(cellsValid([{ id: 'sunflower', cell: -1 }])).toBe(false);
    expect(cellsValid([{ id: 'sunflower', cell: 1.5 }])).toBe(false);
    expect(
      cellsValid([
        { id: 'hedgehog', cell: 0 },
        { id: 'sunflower', cell: 9 },
      ]),
    ).toBe(false);
    expect(
      cellsValid([
        { id: 'hedgehog', cell: 0 },
        { id: 'sunflower', cell: 1 },
        { id: 'frog', cell: 2 },
        { id: 'cactus', cell: 4 },
      ]),
    ).toBe(true);
  });

  it('가게가 열려 있으면 밭의 동료를 다른 칸으로 옮기고, 같은 동료끼리 합친다', () => {
    const state = shopAt(30);
    placeAlly(state, 'frog', 1, 0);
    placeAlly(state, 'frog', 4, 16);
    placeAlly(state, 'sunflower', 1, 3);
    // 자기 칸과 겹쳐도 옮길 수 있다(한 칸 오른쪽으로).
    expect(fitsAt(state.allies, 'frog', 1, 0)).toBe(true);
    const moved = step(state, DT, { aim: null, storm: false, move: { ally: 0, cell: 1 } });
    expect(moved).toContainEqual({ type: 'move', id: 'frog', ...allySpot({ id: 'frog', cell: 1 }) });
    expect(state.allies.map((ally) => [ally.id, ally.cell])).toEqual([
      ['frog', 1],
      ['sunflower', 3],
      ['frog', 16],
    ]);
    // 다른 동료와 겹치거나 밭 밖으로 나가면 옮기지 않는다.
    expect(moveAlly(state, 0, 2)).toBeNull();
    expect(moveAlly(state, 0, 7)).toBeNull();
    // 같은 동료끼리 합치면 하나가 되고 칸이 빈다. 1 + 4마리면 ★4
    expect(canJoin(state, 0, 1)).toBe(false);
    const joined = step(state, DT, { aim: null, storm: false, join: { from: 0, to: 2 } });
    expect(joined).toContainEqual({ type: 'join', id: 'frog', star: 4, ...allySpot({ id: 'frog', cell: 16 }) });
    expect(state.allies.map((ally) => [ally.id, ally.cell, ally.copies])).toEqual([
      ['sunflower', 3, 1],
      ['frog', 16, 5],
    ]);
    // 다 모은 수를 넘게는 합치지 않는다.
    placeAlly(state, 'frog', 4, 0);
    expect(canJoin(state, 0, 2)).toBe(false);
    // 가게가 닫혀 있으면 옮기지도 합치지도 않는다.
    skipShop(state);
    expect(moveAlly(state, 1, 5)).toBeNull();
  });

  it('가게에서 동료를 내보내면 칸이 비고 산 값의 절반을 돌려받는다', () => {
    const state = shopAt(30);
    state.fruit = 0;
    placeAlly(state, 'cactus', 3);
    placeAlly(state, 'mint');
    expect(refundFor({ id: 'cactus', copies: 3 })).toBe(Math.floor((ALLIES.cactus.price * 3) / 2));
    const index = state.allies.findIndex((ally) => ally.id === 'cactus');
    const spot = allySpot(state.allies[index]);
    const events = step(state, DT, { aim: null, storm: false, dismiss: index });
    expect(events).toContainEqual({ type: 'dismiss', id: 'cactus', refund: refundFor({ id: 'cactus', copies: 3 }), ...spot });
    expect(state.allies.map((ally) => ally.id)).toEqual(['mint']);
    expect(state.fruit).toBe(refundFor({ id: 'cactus', copies: 3 }));
    expect(freeCells(state.allies)).toBe(CELL_COUNT - 1);
    // 가게가 닫혀 있으면 내보낼 수 없다.
    skipShop(state);
    expect(dismissAlly(state, 0)).toBeNull();
    expect(state.allies).toHaveLength(1);
  });
});

describe('동료 가게', () => {
  it('판의 첫날 앞에 열매를 쥐고 가게를 열고, 날을 지킬 때마다 열매를 받고 다시 연다', () => {
    const state = shopAt();
    expect(state.shopping).toBe(true);
    expect(state.fruit).toBe(SHOP.purse);
    expect(state.shop).toHaveLength(SHOP.cards);
    skipShop(state);
    expect(state.shopping).toBe(false);
    state.queue = [];
    state.dayTotal = 0;
    const clear = run(state, 0.2).find((event) => event.type === 'dayClear');
    expect(clear).toMatchObject({ day: 1, fruit: fruitFor(1) });
    expect(state.fruit).toBe(SHOP.purse + fruitFor(1));
    expect(state.shopping).toBe(true);
    expect(state.shop).toHaveLength(SHOP.cards);
    expect(fruitFor(5)).toBe(SHOP.income + SHOP.boss);
    expect(isBossDay(5)).toBe(true);
  });

  it('처음 보는 동료는 빈칸에 새로 놓고, 이미 있는 동료는 합치거나 새로 놓는다', () => {
    const state = shopAt(30);
    state.fruit = 30;
    state.shop = [
      { id: 'frog', sold: false },
      { id: 'frog', sold: false },
      { id: 'frog', sold: false },
    ];
    // 없는 동료에는 합칠 수 없다.
    expect(canBuyCard(state, 0, 'merge')).toBe(false);
    expect(buyCard(state, 0, 'place')).toMatchObject({ id: 'frog', mode: 'place', star: 1 });
    expect(state.fruit).toBe(30 - ALLIES.frog.price);
    expect(state.shop[0].sold).toBe(true);
    expect(canBuyCard(state, 0, 'place')).toBe(false);
    // 합치면 칸은 그대로이고 별이 오른다.
    const free = freeCells(state.allies);
    expect(buyCard(state, 1, 'merge')).toMatchObject({ mode: 'merge', star: 2 });
    expect(freeCells(state.allies)).toBe(free);
    expect(state.allies).toHaveLength(1);
    // 새로 놓으면 칸을 더 쓰고 한 마리가 더 선다.
    expect(buyCard(state, 2, 'place')).toMatchObject({ mode: 'place', star: 1 });
    expect(freeCells(state.allies)).toBe(free - ALLIES.frog.cells);
    expect(state.allies.map((ally) => ally.copies)).toEqual([2, 1]);
    // 열매가 모자라거나 없는 자리는 아무 일도 없다.
    state.shop = [{ id: 'sunflower', sold: false }];
    state.fruit = 0;
    expect(buyCard(state, 0, 'place')).toBeNull();
    state.fruit = 20;
    expect(buyCard(state, 9, 'place')).toBeNull();
  });

  it('빈칸이 모자라면 새로 놓을 수 없지만 합칠 수는 있다', () => {
    const state = shopAt(30);
    state.fruit = 30;
    for (let cell = 0; cell < 8; cell += 1) placeAlly(state, 'cactus', 1, cell);
    expect(freeCells(state.allies)).toBe(0);
    state.shop = [
      { id: 'cactus', sold: false },
      { id: 'frog', sold: false },
    ];
    expect(canBuyCard(state, 0, 'place')).toBe(false);
    expect(canBuyCard(state, 0, 'merge')).toBe(true);
    expect(canBuyCard(state, 1, 'place')).toBe(false);
    expect(canBuyCard(state, 1, 'merge')).toBe(false);
    expect(cardStatus(state, 'frog').text).toBe(SHOP_TEXT.noRoom);
  });

  it('시뮬레이션에 넘긴 사기, 내보내기, 다시 뽑기, 닫기를 알려 준다', () => {
    const state = shopAt(30);
    state.fruit = 30;
    const id = state.shop[1].id;
    const events = step(state, DT, { aim: null, storm: false, buy: { card: 1, mode: 'place' } });
    const placed = state.allies.find((ally) => ally.id === id);
    expect(placed).toBeDefined();
    expect(events).toContainEqual({ type: 'buy', id, star: 1, mode: 'place', ...allySpot(placed!) });
    const before = state.shop.map((card) => card.id);
    const rolled = step(state, DT, { aim: null, storm: false, reroll: true });
    expect(rolled).toContainEqual({ type: 'reroll' });
    expect(state.fruit).toBe(30 - ALLIES[before[1]].price - SHOP.reroll);
    expect(state.shop.every((card) => !card.sold)).toBe(true);
    expect(state.rolls).toBe(1);
    const started = step(state, DT, { aim: null, storm: false, ready: true });
    expect(started).toContainEqual({ type: 'dayStart', day: 30, boss: true });
    expect(state.shopping).toBe(false);
    expect(state.shop).toEqual([]);
    // 닫힌 가게에서는 살 수 없다.
    const fruit = state.fruit;
    step(state, DT, { aim: null, storm: false, buy: { card: 0, mode: 'place' }, reroll: true });
    expect(state.fruit).toBe(fruit);
  });

  it('날이 갈수록 새 동료가 가게에 나온다', () => {
    const pool = (day: number): AllyId[] => shopPool({ day });
    expect(pool(1)).toEqual(['sunflower', 'frog']);
    for (const id of ALLY_ORDER) {
      expect(pool(ALLIES[id].fromDay)).toContain(id);
      if (ALLIES[id].fromDay > 1) expect(pool(ALLIES[id].fromDay - 1)).not.toContain(id);
    }
    expect(pool(99)).toEqual([...ALLY_ORDER]);
    // 24일째 고슴도치 뒤로도 30일째에 사마귀, 40일째에 두꺼비가 새로 나온다.
    expect(pool(29)).not.toContain('mantis');
    expect(pool(30)).toContain('mantis');
    expect(pool(39)).not.toContain('toad');
    expect(pool(40).slice(-2)).toEqual(['mantis', 'toad']);
    // 나오는 날 차례대로 놓여 있다.
    const days = ALLY_ORDER.map((id) => ALLIES[id].fromDay);
    expect(days).toEqual([...days].sort((a, b) => a - b));
    expect(drawShop(shopAt(1))).toHaveLength(SHOP.cards);
  });

  it('같은 판은 같은 카드를 놓고, 카드를 뽑는 것이 벌레가 나오는 차례를 바꾸지 않는다', () => {
    const a = shopAt(12, 5);
    const b = shopAt(12, 5);
    expect(a.shop).toEqual(b.shop);
    const rng = a.rng;
    b.fruit = 10;
    reroll(b);
    reroll(b);
    expect(b.rng).toBe(rng);
    skipShop(a);
    skipShop(b);
    expect(b.queue).toEqual(a.queue);
    // 다시 뽑으면 다른 카드가 나오기도 한다.
    const seen = new Set<string>();
    const c = shopAt(30, 8);
    c.fruit = 100;
    for (let roll = 0; roll < 20; roll += 1) {
      seen.add(c.shop.map((card) => card.id).join(','));
      reroll(c);
    }
    expect(seen.size).toBeGreaterThan(5);
  });

  it('동료를 들일 수 있었던 날만큼 벌레도 세지고, 정한 날 수에서 멈춘다', () => {
    expect(heatScale(0)).toBe(1);
    expect(heatScale(3)).toBeCloseTo(TEAM_HEAT.heat ** 3);
    expect(heatScale(TEAM_HEAT.days + 5)).toBeCloseTo(heatScale(TEAM_HEAT.days));
    // 판의 셋째 날의 개미는 판의 첫날에 나온 같은 날의 개미보다 세다.
    const fresh = quiet([], 8);
    const later = quiet([], 6);
    later.queue = [{ at: 0, kind: 'ant', x: 100 }];
    fresh.queue = [{ at: 0, kind: 'ant', x: 100 }];
    later.lastCleared = 7;
    later.day = 8;
    run(fresh, DT * 2);
    run(later, DT * 2);
    expect(fresh.enemies[0].maxHp).toBeCloseTo(ENEMIES.ant.hp * hpScale(8));
    expect(later.enemies[0].maxHp).toBeCloseTo(fresh.enemies[0].maxHp * heatScale(2));
  });

  it('카드에 새 동료인지, 지금 별과 모은 수, 합치면 별이 오르는지 적는다', () => {
    const state = quiet([['frog', 1], ['mint', 3], ['can', 8]]);
    expect(cardStatus(state, 'sunflower').text).toBe(SHOP_TEXT.fresh);
    expect(cardStatus(state, 'frog').text).toBe('사면 ★2!');
    expect(cardStatus(state, 'mint').text).toBe('★3 · 3/5');
    expect(cardStatus(state, 'can').text).toBe('★5 다 모았어요');
    // 같은 동료가 여럿이면 가장 많이 모은 것에 합친다.
    placeAlly(state, 'mint');
    expect(cardStatus(state, 'mint').text).toBe('★3 · 3/5');
  });

  it('자동 플레이는 사면 별이 오르는 동료를 먼저 합치고, 빈칸이 있으면 값진 동료를 새로 놓고, 칸이 차면 합치고, 살 것이 없으면 가게를 닫는다', () => {
    const state = shopAt(30, 3);
    state.fruit = 100;
    state.shop = [
      { id: 'mint', sold: false },
      { id: 'cactus', sold: false },
      { id: 'can', sold: false },
    ];
    expect(botShop(state)).toEqual({ buy: { card: 1, mode: 'place' } });
    expect(botShop(state, 'first')).toEqual({ buy: { card: 0, mode: 'place' } });
    placeAlly(state, 'mint', 1, 0);
    // 박하가 하나 있으면 박하 카드를 사서 합친다(★2로 오른다).
    expect(botShop(state)).toEqual({ buy: { card: 0, mode: 'merge' } });
    placeAlly(state, 'can', 1, 8);
    for (let cell = 1; cell < 8; cell += 1) placeAlly(state, 'cactus', 1, cell);
    expect(freeCells(state.allies)).toBe(0);
    expect(botShop(state)).toEqual({ buy: { card: 0, mode: 'merge' } });
    state.fruit = 0;
    expect(botShop(state)).toEqual({ ready: true });
    skipShop(state);
    expect(botShop(state)).toEqual({});
  });
});

describe('동료마다의 솜씨', () => {
  it('해바라기는 제게 가까운 벌레를, 개구리는 대장과 튼튼한 벌레를, 참새는 먼 벌레를 겨눈다', () => {
    const state = quiet([]);
    const sunflower = { id: 'sunflower' as const, cell: 0 };
    const near = put(state, 'ant', allySpot(sunflower).x, 250, 10);
    const other = put(state, 'ant', 230, 250, 10);
    const far = put(state, 'ant', 200, 20, 10);
    const tough = put(state, 'snail', 120, 120, 500);
    expect(allyTarget(state, sunflower)).toBe(near);
    // 같은 해바라기라도 선 칸에 따라 가까운 벌레가 다르다.
    expect(allyTarget(state, { id: 'sunflower', cell: 7 })).toBe(other);
    expect(allyTarget(state, { id: 'frog', cell: 4 })).toBe(tough);
    expect(allyTarget(state, { id: 'sparrow', cell: 0 })).toBe(far);
    const boss = put(state, 'mole', 60, 60, 100);
    expect(allyTarget(state, { id: 'frog', cell: 4 })).toBe(boss);
    // 판 밖(위)에 있는 벌레와 땅속에 숨은 벌레는 겨누지 않는다.
    const hidden = quiet([]);
    put(hidden, 'ant', 100, -5);
    put(hidden, 'digger', 100, 150);
    expect(allyTarget(hidden, { id: 'sparrow', cell: 0 })).toBeNull();
  });

  it('선인장은 울타리 가까이 온 벌레만 찌르고, 껍데기도 뚫는다', () => {
    const state = quiet([['cactus', 1]]);
    const away = put(state, 'beetle', 100, FIELD.depth - (ALLIES.cactus.reach ?? 0) - 60);
    run(state, 1.5);
    expect(away.hp).toBe(away.maxHp);
    const close = put(state, 'beetle', 200, FIELD.depth - 20);
    run(state, 1.5);
    expect(close.maxHp - close.hp).toBeGreaterThan(0);
    const hits = (close.maxHp - close.hp) / allyDamage('cactus', 1, state.stats.damage, 1);
    // 풍뎅이의 껍데기에 막히지 않아서 한 번에 다 들어간다.
    expect(hits).toBeCloseTo(Math.round(hits), 5);
  });

  it('박하는 맞은 벌레를 늦추고(대장은 반만), 물뿌리개는 둘레의 벌레도 적신다', () => {
    const state = quiet([['mint', 1]]);
    const ant = put(state, 'ant', 60, 200);
    run(state, 1);
    expect(ant.slowLeft).toBeGreaterThan(0);
    expect(ant.slow).toBeCloseTo(ALLIES.mint.chill?.slow ?? 0);
    const bossy = quiet([['mint', 1]]);
    const mole = put(bossy, 'mole', 60, 200);
    run(bossy, 1);
    expect(mole.slow).toBeCloseTo((ALLIES.mint.chill?.slow ?? 0) / 2);

    const wet = quiet([['can', 1]]);
    const a = put(wet, 'ant', 150, 200);
    const b = put(wet, 'ant', 165, 205);
    const lone = put(wet, 'ant', 30, 60);
    run(wet, 1);
    // 몰린 둘을 겨눠서 둘 다 젖고, 떨어진 하나는 그대로다.
    expect(a.hp).toBeLessThan(a.maxHp);
    expect(b.hp).toBeLessThan(b.maxHp);
    expect(lone.hp).toBe(lone.maxHp);
  });

  it('사마귀는 대장과 튼튼한 벌레를 베고 껍데기도 뚫으며, 두꺼비는 울타리에 가까운 벌레를 쳐서 늦춘다', () => {
    const state = quiet([]);
    const tough = put(state, 'snail', 60, 120, 500);
    put(state, 'ant', 200, 300, 10);
    expect(allyTarget(state, { id: 'mantis', cell: 0 })).toBe(tough);
    const front = put(state, 'ant', 150, 310, 10);
    expect(allyTarget(state, { id: 'toad', cell: 4 })).toBe(front);

    const shell = quiet([['mantis', 1]]);
    const beetle = put(shell, 'beetle', 100, 200);
    run(shell, 1.5);
    const hits = (beetle.maxHp - beetle.hp) / allyDamage('mantis', 1, shell.stats.damage, 1);
    expect(hits).toBeGreaterThanOrEqual(1);
    expect(hits).toBeCloseTo(Math.round(hits), 5);

    const slow = quiet([['toad', 1]]);
    const ant = put(slow, 'ant', 100, 250);
    run(slow, 1);
    expect(ant.hp).toBeLessThan(ant.maxHp);
    expect(ant.slowLeft).toBeGreaterThan(0);
    expect(ant.slow).toBeCloseTo(ALLIES.toad.chill?.slow ?? 0);
  });

  it('겨눌 벌레가 없으면 쏘지 않고 기다렸다가, 벌레가 오면 바로 쏜다', () => {
    const state = quiet([['sunflower', 1], ['frog', 1]]);
    const idle = run(state, 1);
    expect(idle.some((event) => event.type === 'fire')).toBe(false);
    put(state, 'snail', 90, 250);
    const events = run(state, 0.1);
    expect(events.filter((event) => event.type === 'fire').map((event) => (event.type === 'fire' ? event.ally : null))).toEqual([
      'sunflower',
      'frog',
    ]);
  });

  it('동료마다 이름과 설명, 값, 차지하는 칸이 있다', () => {
    expect([...ALLY_ORDER].sort()).toEqual(Object.keys(ALLIES).sort());
    for (const id of ALLY_ORDER) {
      expect(ALLIES[id].cells, id).toBeGreaterThanOrEqual(1);
      expect(ALLIES[id].cells, id).toBeLessThanOrEqual(4);
      expect(ALLIES[id].name.length, id).toBeLessThanOrEqual(5);
      expect(ALLIES[id].blurb.length, id).toBeLessThanOrEqual(17);
      expect(ALLIES[id].price, id).toBeGreaterThan(0);
    }
  });
});
