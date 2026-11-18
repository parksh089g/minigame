import { describe, expect, it } from 'vitest';
import { buyCard, canReroll, closedShop, drawShop, keptCard, reroll, toggleLock } from './allies';
import { SHOP } from './data';
import { readRunRecord, runRecord } from './saved-run';
import { createRun, skipShop, step, type RunState, type SimEvent } from './sim';

const DT = 1 / 60;
const T = 1_700_000_000_000;

function shopAt(day = 30, seed = 11): RunState {
  const { state } = createRun({ seed, startDay: day, levels: { power: 30 }, bestBefore: 0 });
  state.fruit = 30;
  return state;
}

/** 가게를 닫고 그날의 벌레를 치운 뒤, 날을 지켜 가게가 다시 열릴 때까지 돌린다. */
function nextShop(state: RunState): SimEvent[] {
  const events = step(state, DT, { aim: null, storm: false, ready: true });
  state.queue = [];
  state.enemies = [];
  state.dayTotal = state.dayKilled;
  for (let t = 0; t < 30 && !state.shopping; t += DT) events.push(...step(state, DT));
  return events;
}

const throughDisk = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe('카드 묶어 두기', () => {
  it('가게가 열려 있으면 사지 않은 카드를 열매 없이 묶고 풀며, 산 카드와 닫힌 가게의 카드는 묶지 못한다', () => {
    const state = shopAt();
    expect(state.shop.some((card) => card.locked)).toBe(false);
    expect(toggleLock(state, 1)).toBe(true);
    expect(state.shop[1].locked).toBe(true);
    expect(state.fruit).toBe(30);
    expect(toggleLock(state, 1)).toBe(false);
    expect(state.shop[1].locked).toBe(false);
    expect(toggleLock(state, 9)).toBeNull();
    buyCard(state, 0, 'place');
    expect(state.shop[0].sold).toBe(true);
    expect(toggleLock(state, 0)).toBeNull();
    skipShop(state);
    expect(toggleLock(state, 1)).toBeNull();
  });

  it('시뮬레이션에 넘긴 묶기는 한 번 바꾸고 알려 준다', () => {
    const state = shopAt();
    expect(step(state, DT, { aim: null, storm: false, lock: 2 })).toContainEqual({ type: 'lock', card: 2, locked: true });
    expect(state.shop[2].locked).toBe(true);
    expect(step(state, DT, { aim: null, storm: false, lock: 2 })).toContainEqual({ type: 'lock', card: 2, locked: false });
    expect(step(state, DT, { aim: null, storm: false, lock: 7 }).some((event) => event.type === 'lock')).toBe(false);
  });

  it('다시 뽑으면 묶어 둔 카드는 그 자리에 묶인 채 남고, 다른 자리는 묶지 않았을 때와 같은 카드가 나온다', () => {
    const state = shopAt();
    const twin = shopAt();
    const kept = state.shop[1];
    // 한 걸음에 묶기와 다시 뽑기를 함께 눌러도 묶은 카드가 남는다.
    step(state, DT, { aim: null, storm: false, lock: 1, reroll: true });
    step(twin, DT, { aim: null, storm: false, reroll: true });
    expect(state.shop[1]).toEqual({ ...kept, locked: true });
    expect([state.shop[0], state.shop[2]]).toEqual([twin.shop[0], twin.shop[2]]);
    expect(state.fruit).toBe(twin.fruit);
    expect(state.rng).toBe(twin.rng);
    // 여러 번 뽑아도 그대로다.
    reroll(state);
    expect(state.shop[1]).toEqual({ ...kept, locked: true });
  });

  it('다음 날 가게가 다시 열려도 묶어 둔 카드가 그 자리에 남고, 벌레가 나오는 차례는 그대로다', () => {
    const state = shopAt(1);
    const twin = shopAt(1);
    const kept = state.shop[0];
    toggleLock(state, 0);
    nextShop(state);
    nextShop(twin);
    expect(state.lastCleared).toBe(1);
    expect(state.shopping).toBe(true);
    expect(state.shop[0]).toEqual({ ...kept, locked: true });
    expect(state.shop.slice(1)).toEqual(twin.shop.slice(1));
    expect(state.rng).toBe(twin.rng);
    expect(state.queue).toEqual(twin.queue);
  });

  it('산 카드는 묶어 두었어도 남지 않고, 묶은 카드가 없으면 닫힌 가게는 비어 있다', () => {
    const state = shopAt();
    const twin = shopAt();
    toggleLock(state, 0);
    buyCard(state, 0, 'place');
    expect(keptCard(state.shop[0])).toBe(false);
    expect(closedShop(state.shop)).toEqual([]);
    reroll(state);
    twin.fruit = state.fruit + SHOP.reroll;
    reroll(twin);
    expect(state.shop[0]).toEqual(twin.shop[0]);
    expect(state.shop.every((card) => !card.locked)).toBe(true);
    step(state, DT, { aim: null, storm: false, ready: true });
    expect(state.shop).toEqual([]);
  });

  it('카드를 모두 묶으면 다시 뽑아도 바뀔 것이 없으니 뽑지 않는다', () => {
    const state = shopAt();
    expect(canReroll(state)).toBe(true);
    for (let index = 0; index < SHOP.cards; index += 1) toggleLock(state, index);
    expect(canReroll(state)).toBe(false);
    expect(reroll(state)).toBe(false);
    expect(state.fruit).toBe(30);
    toggleLock(state, 0);
    expect(canReroll(state)).toBe(true);
  });

  it('묶어 둔 카드는 저장했다가 읽어도 묶여 있고(가게가 열려 있을 때도, 날을 지키는 동안에도), 묶기 전에 적은 카드는 묶지 않은 것이다', () => {
    const state = shopAt(1);
    toggleLock(state, 2);
    const open = readRunRecord(throughDisk(runRecord({ state, banked: 0, bankedShards: 0 }, T))).run!.state;
    expect(open.shop).toEqual(state.shop);
    expect(open.shop[2].locked).toBe(true);
    // 날을 지키는 동안의 판도 묶어 둔 카드를 지니고, 다음 날 가게에 그 카드가 남는다.
    step(open, DT, { aim: null, storm: false, ready: true });
    expect(open.shopping).toBe(false);
    const fighting = readRunRecord(throughDisk(runRecord({ state: open, banked: 0, bankedShards: 0 }, T))).run!.state;
    expect(fighting.shop).toEqual(open.shop);
    nextShop(fighting);
    expect(fighting.shop[2]).toEqual(state.shop[2]);

    // 묶기가 생기기 전에 적은 카드(locked가 없다)도 읽고, 묶지 않은 것으로 다시 뽑힌다.
    const old = shopAt();
    old.shop = old.shop.map(({ id, sold }) => ({ id, sold }));
    const read = readRunRecord(throughDisk(runRecord({ state: old, banked: 0, bankedShards: 0 }, T))).run!.state;
    expect(read.shop).toEqual(old.shop);
    expect(read.shop.some(keptCard)).toBe(false);
    reroll(read);
    expect(read.shop).toEqual(drawShop(read));
    // 묶임이 참이나 거짓이 아닌 저장은 망가진 것이다.
    const broken = throughDisk(runRecord({ state: old, banked: 0, bankedShards: 0 }, T)) as {
      run: { state: { shop: Array<Record<string, unknown>> } };
    };
    broken.run.state.shop[0].locked = 'yes';
    expect(readRunRecord(broken).run).toBeNull();
  });
});
