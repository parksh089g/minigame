import { describe, expect, it } from 'vitest';
import {
  allyDamage,
  allyInterval,
  allyLabel,
  buyCard,
  allySpot,
  canBuyCard,
  canPlace,
  cellSpot,
  cellsValid,
  copiesFor,
  dismissAlly,
  drawShop,
  freeCells,
  fruitFor,
  heatScale,
  maxed,
  mergeAlly,
  nextStar,
  placeAlly,
  refundFor,
  reroll,
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
  it('두 마리면 ★2, 넷이면 ★3, 여덟이면 ★4, 열여섯이면 ★5이고 그 위로는 오르지 않는다', () => {
    expect([0, 1, 2, 3, 4, 7, 8, 15, 16, 40].map(starOf)).toEqual([0, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
    expect([1, 2, 3, 4, 5].map(copiesFor)).toEqual([1, 2, 4, 8, 16]);
    expect(nextStar(1)).toEqual({ have: 1, need: 2 });
    expect(nextStar(5)).toEqual({ have: 5, need: 8 });
    expect(nextStar(16)).toBeNull();
    expect(maxed(15)).toBe(false);
    expect(maxed(16)).toBe(true);
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
    expect(mergeAlly(state, 'frog')).toBe(2);
    expect(mergeAlly(state, 'frog')).toBe(0);
    expect(mergeAlly(state, 'frog')).toBe(3);
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
  it('칸은 물총의 양옆에 넷씩이고, 칸끼리 겹치지 않고 물총 자리를 비운다', () => {
    expect(CELL_COUNT).toBe(8);
    const xs = Array.from({ length: CELL_COUNT }, (_, cell) => cellSpot(cell, 1).x);
    for (let cell = 1; cell < CELL_COUNT; cell += 1) expect(xs[cell] - xs[cell - 1]).toBeGreaterThanOrEqual(GARDEN_CELLS.cell);
    for (const x of xs) {
      expect(x - GARDEN_CELLS.cell / 2).toBeGreaterThanOrEqual(0);
      expect(x + GARDEN_CELLS.cell / 2).toBeLessThanOrEqual(FIELD.width);
      // 물총 둘레(좌우 16)는 비어 있다.
      expect(Math.abs(x - SHOOTER.x)).toBeGreaterThan(16 + GARDEN_CELLS.cell / 2);
    }
    // 동료는 차지한 칸들의 한가운데에 선다.
    expect(cellSpot(1, 3).x).toBeCloseTo(cellSpot(2, 1).x);
  });

  it('동료마다 차지하는 칸이 다르고, 칸을 많이 차지할수록 한 마리가 세다', () => {
    const power = (id: AllyId): number => allyDamage(id, 1, 20, 1) / ALLIES[id].interval;
    const sizes = new Set(ALLY_ORDER.map((id) => ALLIES[id].cells));
    expect([...sizes].sort()).toEqual([1, 2, 3]);
    const by = (cells: number): AllyId[] => ALLY_ORDER.filter((id) => ALLIES[id].cells === cells);
    const most = (ids: AllyId[]): number => Math.max(...ids.map(power));
    expect(most(by(2))).toBeGreaterThan(most(by(1)));
    expect(most(by(3))).toBeGreaterThan(most(by(2)));
    // 큰 동료는 값도 더 비싸다.
    for (const big of by(3)) for (const small of by(1)) expect(ALLIES[big].price).toBeGreaterThan(ALLIES[small].price);
  });

  it('새 동료는 물총에 가까운 빈칸부터 서고, 한쪽 끝을 넘어 서지 않는다', () => {
    const state = quiet([]);
    expect(placeAlly(state, 'sunflower')?.cell).toBe(3);
    expect(placeAlly(state, 'sunflower')?.cell).toBe(4);
    expect(placeAlly(state, 'frog')?.cell).toBe(1);
    expect(placeAlly(state, 'cactus')?.cell).toBe(5);
    expect(freeCells(state.allies)).toBe(1);
    expect(cellsValid(state.allies)).toBe(true);
    // 칸의 차례대로 늘어선다.
    expect(state.allies.map((ally) => ally.cell)).toEqual([1, 3, 4, 5]);
    expect(canPlace(state, 'frog')).toBe(false);
    expect(placeAlly(state, 'frog')).toBeNull();
    expect(placeAlly(state, 'mint')?.cell).toBe(0);
    expect(freeCells(state.allies)).toBe(0);
    expect(canPlace(state, 'sunflower')).toBe(false);
  });

  it('빈칸이 흩어져 있으면 동료를 다시 늘어놓아 자리를 만들고, 그래도 안 되면 놓지 않는다', () => {
    const state = quiet([]);
    state.allies = [
      { id: 'sunflower', copies: 1, fireIn: 0, cell: 1 },
      { id: 'mint', copies: 1, fireIn: 0, cell: 3 },
      { id: 'cactus', copies: 1, fireIn: 0, cell: 4 },
    ];
    // 빈칸은 0, 2, 7번으로 셋이지만 이어진 두 칸은 없다.
    expect(canPlace(state, 'frog')).toBe(true);
    const frog = placeAlly(state, 'frog');
    expect(frog?.cell).toBe(0);
    expect(cellsValid(state.allies)).toBe(true);
    expect(state.allies.map((ally) => [ally.id, ally.cell])).toEqual([
      ['frog', 0],
      ['sunflower', 2],
      ['mint', 3],
      ['cactus', 4],
    ]);

    // 3칸 둘이 양쪽에 서면 남은 두 칸(0번, 7번)에 2칸 동료는 어떻게 해도 서지 못한다.
    const stuck = quiet([]);
    stuck.allies = [
      { id: 'cactus', copies: 1, fireIn: 0, cell: 1 },
      { id: 'cactus', copies: 1, fireIn: 0, cell: 4 },
    ];
    const before = JSON.stringify(stuck.allies);
    expect(canPlace(stuck, 'frog')).toBe(false);
    expect(placeAlly(stuck, 'frog')).toBeNull();
    expect(JSON.stringify(stuck.allies)).toBe(before);
    expect(placeAlly(stuck, 'sunflower')?.cell).toBe(0);
  });

  it('칸이 겹치거나 한쪽 끝을 넘은 자리는 틀린 자리다', () => {
    expect(cellsValid([{ id: 'frog', cell: 3 }])).toBe(false);
    expect(cellsValid([{ id: 'cactus', cell: 6 }])).toBe(false);
    expect(cellsValid([{ id: 'sunflower', cell: -1 }])).toBe(false);
    expect(cellsValid([{ id: 'sunflower', cell: 1.5 }])).toBe(false);
    expect(
      cellsValid([
        { id: 'frog', cell: 0 },
        { id: 'mint', cell: 1 },
      ]),
    ).toBe(false);
    expect(
      cellsValid([
        { id: 'frog', cell: 0 },
        { id: 'frog', cell: 2 },
        { id: 'cactus', cell: 5 },
      ]),
    ).toBe(true);
  });

  it('가게에서 동료를 내보내면 칸이 비고 산 값의 절반을 돌려받는다', () => {
    const state = shopAt(30);
    state.fruit = 0;
    placeAlly(state, 'cactus', 3);
    placeAlly(state, 'mint');
    expect(refundFor({ id: 'cactus', copies: 3 })).toBe(Math.floor((ALLIES.cactus.price * 3) / 2));
    const index = state.allies.findIndex((ally) => ally.id === 'cactus');
    const events = step(state, DT, { aim: null, storm: false, dismiss: index });
    expect(events).toContainEqual({ type: 'dismiss', id: 'cactus', refund: refundFor({ id: 'cactus', copies: 3 }), x: expect.any(Number) });
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
    placeAlly(state, 'cactus');
    placeAlly(state, 'cactus');
    placeAlly(state, 'sunflower');
    placeAlly(state, 'sunflower');
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
    expect(events).toContainEqual({ type: 'buy', id, star: 1, mode: 'place', x: allySpot(placed!).x });
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
    const state = quiet([['frog', 1], ['mint', 2], ['can', 16]]);
    expect(cardStatus(state, 'sunflower').text).toBe(SHOP_TEXT.fresh);
    expect(cardStatus(state, 'frog').text).toBe('사면 ★2!');
    expect(cardStatus(state, 'mint').text).toBe('★2 · 2/4');
    expect(cardStatus(state, 'can').text).toBe('★5 다 모았어요');
    // 같은 동료가 여럿이면 가장 많이 모은 것에 합친다.
    placeAlly(state, 'mint');
    expect(cardStatus(state, 'mint').text).toBe('★2 · 2/4');
  });

  it('자동 플레이는 빈칸이 있으면 값진 동료를 새로 놓고, 칸이 차면 합치고, 살 것이 없으면 가게를 닫는다', () => {
    const state = shopAt(30, 3);
    state.fruit = 100;
    state.shop = [
      { id: 'mint', sold: false },
      { id: 'cactus', sold: false },
      { id: 'can', sold: false },
    ];
    expect(botShop(state)).toEqual({ buy: { card: 1, mode: 'place' } });
    expect(botShop(state, 'first')).toEqual({ buy: { card: 0, mode: 'place' } });
    placeAlly(state, 'mint');
    placeAlly(state, 'cactus');
    placeAlly(state, 'cactus');
    placeAlly(state, 'sunflower');
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
      expect(ALLIES[id].cells, id).toBeLessThanOrEqual(GARDEN_CELLS.half);
      expect(ALLIES[id].name.length, id).toBeLessThanOrEqual(5);
      expect(ALLIES[id].blurb.length, id).toBeLessThanOrEqual(17);
      expect(ALLIES[id].price, id).toBeGreaterThan(0);
    }
  });
});
