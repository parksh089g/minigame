import { describe, expect, it } from 'vitest';
import {
  addAlly,
  allyDamage,
  allyInterval,
  allyLabel,
  buyCard,
  canBuyCard,
  copiesFor,
  drawShop,
  fruitFor,
  heatScale,
  maxed,
  nextStar,
  reroll,
  shopPool,
  starOf,
} from './allies';
import { botShop } from './bot';
import { ALLIES, ALLY_ORDER, ALLY_SPOTS, ALLY_STARS, ENEMIES, FIELD, SHOP, SUMMON, TEAM_HEAT, type AllyId, type EnemyKind } from './data';
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
  for (const [id, copies] of allies) addAlly(state, id, copies);
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

  it('같은 동료를 또 들이면 하나로 합쳐지고, 별이 오른 때를 알려 준다', () => {
    const state = quiet([]);
    expect(addAlly(state, 'frog')).toBe(1);
    expect(addAlly(state, 'sunflower')).toBe(1);
    expect(addAlly(state, 'frog')).toBe(2);
    expect(addAlly(state, 'frog')).toBe(0);
    expect(addAlly(state, 'frog')).toBe(3);
    // 자리의 차례대로 선다.
    expect(state.allies.map((ally) => ally.id)).toEqual(['sunflower', 'frog']);
    expect(state.allies[1].copies).toBe(4);
    expect(allyLabel(state.allies[1])).toBe('개구리 ★3');
    // 다 모은 뒤로는 늘지 않는다.
    addAlly(state, 'frog', 40);
    expect(state.allies[1].copies).toBe(copiesFor(ALLY_STARS.max));
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

  it('카드를 사면 열매를 내고 그 동료가 바로 서며, 산 카드는 다시 살 수 없다', () => {
    const state = shopAt(30);
    state.fruit = 20;
    const id = state.shop[0].id;
    expect(canBuyCard(state, 0)).toBe(true);
    expect(buyCard(state, 0)).toBe(1);
    expect(state.fruit).toBe(20 - ALLIES[id].price);
    expect(state.allies.map((ally) => ally.id)).toContain(id);
    expect(state.shop[0].sold).toBe(true);
    expect(canBuyCard(state, 0)).toBe(false);
    expect(buyCard(state, 0)).toBeNull();
    // 열매가 모자라면 살 수 없다.
    state.fruit = 0;
    expect(buyCard(state, 1)).toBeNull();
    // 없는 자리는 아무 일도 없다.
    state.fruit = 20;
    expect(buyCard(state, 9)).toBeNull();
  });

  it('시뮬레이션에 넘긴 사기, 다시 뽑기, 닫기를 알려 준다', () => {
    const state = shopAt(30);
    state.fruit = 30;
    const events = step(state, DT, { aim: null, storm: false, buy: 1 });
    expect(events).toContainEqual({ type: 'buy', id: state.shop[1].id, star: 1 });
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
    step(state, DT, { aim: null, storm: false, buy: 0, reroll: true });
    expect(state.fruit).toBe(fruit);
  });

  it('날이 갈수록 새 동료가 가게에 나오고, 다 모은 동료는 나오지 않는다', () => {
    const pool = (day: number): AllyId[] => shopPool({ day, allies: [] });
    expect(pool(1)).toEqual(['sunflower', 'frog']);
    for (const id of ALLY_ORDER) {
      expect(pool(ALLIES[id].fromDay)).toContain(id);
      if (ALLIES[id].fromDay > 1) expect(pool(ALLIES[id].fromDay - 1)).not.toContain(id);
    }
    expect(pool(99)).toEqual([...ALLY_ORDER]);
    expect(shopPool({ day: 1, allies: [{ id: 'frog', copies: 16, fireIn: 0 }] })).toEqual(['sunflower']);
    // 모두 다 모았으면 가게에 놓을 것이 없고 다시 뽑을 수도 없다.
    const full = shopAt(1);
    full.allies = [
      { id: 'sunflower', copies: 16, fireIn: 0 },
      { id: 'frog', copies: 16, fireIn: 0 },
    ];
    full.fruit = 10;
    expect(drawShop(full)).toEqual([]);
    expect(reroll(full)).toBe(false);
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

  it('카드에 새 동료인지, 지금 별과 모은 수, 사면 별이 오르는지 적는다', () => {
    const state = quiet([['frog', 1], ['mint', 2], ['can', 16]]);
    expect(cardStatus(state, 'sunflower').text).toBe(SHOP_TEXT.fresh);
    expect(cardStatus(state, 'frog').text).toBe('사면 ★2!');
    expect(cardStatus(state, 'mint').text).toBe('★2 · 2/4');
    expect(cardStatus(state, 'can').text).toBe('★5 다 모았어요');
  });

  it('자동 플레이는 이미 있는 동료를 먼저 사서 합치고, 살 것이 없으면 가게를 닫는다', () => {
    const state = shopAt(30, 3);
    state.fruit = 100;
    state.shop = [
      { id: 'frog', sold: false },
      { id: 'mint', sold: false },
      { id: 'can', sold: false },
    ];
    addAlly(state, 'mint');
    expect(botShop(state)).toEqual({ buy: 1 });
    expect(botShop(state, 'first')).toEqual({ buy: 0 });
    state.fruit = 0;
    expect(botShop(state)).toEqual({ ready: true });
    skipShop(state);
    expect(botShop(state)).toEqual({});
  });
});

describe('동료마다의 솜씨', () => {
  it('해바라기는 제게 가까운 벌레를, 개구리는 대장과 튼튼한 벌레를, 참새는 먼 벌레를 겨눈다', () => {
    const state = quiet([]);
    const near = put(state, 'ant', ALLY_SPOTS.sunflower.x, 250, 10);
    const far = put(state, 'ant', 200, 20, 10);
    const tough = put(state, 'snail', 120, 120, 500);
    expect(allyTarget(state, 'sunflower')).toBe(near);
    expect(allyTarget(state, 'frog')).toBe(tough);
    expect(allyTarget(state, 'sparrow')).toBe(far);
    const boss = put(state, 'mole', 60, 60, 100);
    expect(allyTarget(state, 'frog')).toBe(boss);
    // 판 밖(위)에 있는 벌레와 땅속에 숨은 벌레는 겨누지 않는다.
    const hidden = quiet([]);
    put(hidden, 'ant', 100, -5);
    put(hidden, 'digger', 100, 150);
    expect(allyTarget(hidden, 'sparrow')).toBeNull();
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

  it('동료마다 이름과 설명, 서는 자리가 있고 자리가 겹치지 않는다', () => {
    expect([...ALLY_ORDER].sort()).toEqual(Object.keys(ALLIES).sort());
    const spots = ALLY_ORDER.map((id) => ALLY_SPOTS[id].x);
    expect(new Set(spots).size).toBe(spots.length);
    for (const id of ALLY_ORDER) {
      expect(ALLIES[id].name.length, id).toBeLessThanOrEqual(5);
      expect(ALLIES[id].blurb.length, id).toBeLessThanOrEqual(17);
      expect(ALLIES[id].price, id).toBeGreaterThan(0);
    }
  });
});
