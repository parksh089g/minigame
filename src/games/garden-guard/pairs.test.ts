import { describe, expect, it } from 'vitest';
import {
  allyDamage,
  allyInterval,
  findCell,
  formsPair,
  pairBonuses,
  pairLinks,
  pairReady,
  pairs,
  pairScore,
  placeAlly,
  type Ally,
} from './allies';
import { ALLY_ORDER, ENEMIES, GARDEN_CELLS, GUN, PAIRS, SUMMON, type AllyId } from './data';
import { createRun, skipShop, step, type Enemy, type RunState } from './sim';

const DT = 1 / 60;

/** 칸을 정해 세운 동료들 */
const team = (...list: Array<[AllyId, number]>): Array<Pick<Ally, 'id' | 'cell'>> => list.map(([id, cell]) => ({ id, cell }));

/** 주아 글꼴에 들어 있는 한글: KS X 1001의 완성형 2,350자 */
function fontSyllables(): Set<string> {
  const decoder = new TextDecoder('euc-kr');
  const syllables = new Set<string>();
  for (let lead = 0xb0; lead <= 0xc8; lead += 1) {
    for (let trail = 0xa1; trail <= 0xfe; trail += 1) syllables.add(decoder.decode(new Uint8Array([lead, trail])));
  }
  return syllables;
}

/** 벌레가 나오지 않고 물총도 쉬는 판에, 동료를 정한 칸에 세운다. */
function quiet(list: Array<[AllyId, number]>): RunState {
  const state = createRun({ seed: 11, startDay: 1, levels: {}, bestBefore: 0 }).state;
  skipShop(state);
  state.queue = [];
  state.dayTotal = 0;
  state.fireIn = 1e9;
  for (const [id, cell] of list) placeAlly(state, id, 1, cell);
  for (const ally of state.allies) ally.fireIn = 0;
  return state;
}

/** 죽지 않는 달팽이를 그 자리에 둔다. */
function snail(state: RunState, x: number, y: number): Enemy {
  const enemy: Enemy = {
    id: state.nextId++,
    kind: 'snail',
    x,
    y,
    homeX: x,
    hp: 1e6,
    maxHp: 1e6,
    day: state.day,
    biting: false,
    biteIn: ENEMIES.snail.biteEvery,
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

describe('짝 효과', () => {
  it('동료마다 짝 효과가 하나씩 있고, 덤은 작으며, 카드에 들어갈 만큼 짧고 글꼴에 있는 글자만 쓴다', () => {
    const known = fontSyllables();
    expect(Object.keys(PAIRS).sort()).toEqual([...ALLY_ORDER].sort());
    for (const id of ALLY_ORDER) {
      const def = PAIRS[id];
      const bonus = (def.damage ?? 0) + (def.rate ?? 0);
      expect(bonus, id).toBeGreaterThanOrEqual(0.1);
      expect(bonus, id).toBeLessThanOrEqual(0.25);
      if (def.with !== 'any') for (const partner of def.with) expect(ALLY_ORDER, id).toContain(partner);
      // 카드의 설명 자리(열매 그림 앞)에 들어가는 길이
      expect(def.line.length, id).toBeLessThanOrEqual(19);
      // 적힌 덤이 실제 덤과 같다.
      expect(def.line, id).toContain(`${Math.round(bonus * 100)}%`);
      for (const letter of def.line.match(/[ㄱ-ㆎ가-힣]/g) ?? []) expect(known.has(letter), `${id}: ${letter}`).toBe(true);
    }
  });

  it('칸의 변이 맞닿아야 짝이고, 물총을 사이에 둔 두 쪽은 맞닿지 않는다', () => {
    // 해바라기(3)와 박하(2)는 옆으로 맞닿는다.
    expect(pairLinks(team(['sunflower', 3], ['mint', 2])).map(({ a, b }) => [a, b])).toEqual([[0, 1]]);
    // 해바라기(3)와 박하(4)는 물총을 사이에 두었다. 대각선(3과 10)도 맞닿지 않는다.
    expect(pairLinks(team(['sunflower', 3], ['mint', 4]))).toEqual([]);
    expect(pairLinks(team(['sunflower', 3], ['mint', 10]))).toEqual([]);
    // 맞닿아도 서로 짝 효과가 없으면 짝이 아니다(참새와 개구리).
    expect(pairs('sparrow', 'frog')).toBe(false);
    expect(pairLinks(team(['sparrow', 3], ['frog', 1]))).toEqual([]);
    // 하트는 옆으로 맞닿으면 변의 한가운데, 위아래면 변의 오른쪽 끝에 그린다.
    const [side] = pairLinks(team(['sunflower', 2], ['mint', 3]));
    expect(side.x).toBeCloseTo(GARDEN_CELLS.left + 3 * GARDEN_CELLS.cell);
    expect(side.y).toBeCloseTo(GARDEN_CELLS.top + GARDEN_CELLS.cell / 2);
    const [stacked] = pairLinks(team(['sunflower', 3], ['mint', 11]));
    expect(stacked.x).toBeCloseTo(GARDEN_CELLS.left + 4 * GARDEN_CELLS.cell);
    expect(stacked.y).toBeCloseTo(GARDEN_CELLS.top + GARDEN_CELLS.cell);
    // 가로 두 칸인 개구리 둘이 위아래로 붙으면, 위 개구리의 별 글자(두 칸의 한가운데)를 비켜 변의 오른쪽 끝에 그린다.
    const [frogs] = pairLinks(team(['frog', 0], ['frog', 8]));
    expect(frogs.x).toBeCloseTo(GARDEN_CELLS.left + 2 * GARDEN_CELLS.cell);
    expect(frogs.y).toBeCloseTo(GARDEN_CELLS.top + GARDEN_CELLS.cell);
  });

  it('덤은 짝 효과가 정한 쪽이 받고, 같은 동료의 같은 덤은 한 번만 받는다', () => {
    // 해바라기는 붙은 동료를 빠르게 한다. 해바라기 둘에 붙어도 한 번만이다.
    const frog = pairBonuses(team(['frog', 1], ['sunflower', 3], ['sunflower', 9]));
    expect(frog[0]).toEqual({ damage: 0, rate: PAIRS.sunflower.rate });
    expect(frog[1]).toEqual({ damage: 0, rate: 0 });
    expect(frog[2]).toEqual({ damage: 0, rate: 0 });
    // 개구리끼리 붙으면 둘 다 세진다.
    const frogs = pairBonuses(team(['frog', 0], ['frog', 8]));
    expect(frogs.map((bonus) => bonus.damage)).toEqual([PAIRS.frog.damage, PAIRS.frog.damage]);
    // 물뿌리개와 박하: 물뿌리개는 제 짝 효과(둘 다)와 박하의 짝 효과(붙은 동료)를 함께 받는다.
    const wet = pairBonuses(team(['can', 0], ['mint', 1]));
    expect(wet[0].damage).toBeCloseTo((PAIRS.can.damage ?? 0) + (PAIRS.mint.damage ?? 0));
    expect(wet[1].damage).toBeCloseTo(PAIRS.can.damage ?? 0);
    // 두꺼비와 개구리는 둘 다 세진다.
    const pond = pairBonuses(team(['toad', 0], ['frog', 2]));
    expect(pond.map((bonus) => bonus.damage)).toEqual([PAIRS.toad.damage, PAIRS.toad.damage]);
    // 짝이 없으면 덤도 없다.
    expect(pairBonuses(team(['sparrow', 0], ['frog', 1]))).toEqual([
      { damage: 0, rate: 0 },
      { damage: 0, rate: 0 },
    ]);
  });

  it('누르기만 하면 제 짝 효과가 맞는 자리, 짝이 생기는 자리, 물총에 가까운 자리의 차례로 고른다', () => {
    // 참새는 해바라기 곁을 찾는다: 물총에 더 가까운 3번 칸보다 해바라기(0) 옆의 1번 칸이 먼저다.
    const garden = team(['sunflower', 0]);
    expect(findCell(garden, 'sparrow')).toBe(1);
    expect(formsPair(garden, 'sparrow', 1)).toBe(true);
    expect(formsPair(garden, 'sparrow', 3)).toBe(false);
    expect(pairReady(garden, 'sparrow')).toBe(true);
    // 선인장은 해바라기 곁에서도 덤(빨리)을 받지만, 제 짝(고슴도치)의 곁이 있으면 그쪽이 먼저다.
    // 카드에는 제 짝 효과가 맞는 자리가 있을 때만 짝 효과를 적는다.
    expect(pairScore(garden, 'cactus', 1)).toBe(1);
    expect(pairReady(garden, 'cactus')).toBe(false);
    const spiny = team(['sunflower', 0], ['hedgehog', 6]);
    expect(findCell(spiny, 'cactus')).toBe(5);
    expect(pairScore(spiny, 'cactus', 5)).toBe(2);
    expect(pairReady(spiny, 'cactus')).toBe(true);
    // 짝이 될 동료가 없으면 예전처럼 물총에 가까운 빈칸이다.
    expect(findCell(team(['frog', 0]), 'sparrow')).toBe(3);
    expect(pairReady(team(['frog', 0]), 'sparrow')).toBe(false);
    // 옮길 때는 옮기는 동료 자신과는 짝이 되지 않는다.
    expect(formsPair(team(['sunflower', 0]), 'sunflower', 1, 0)).toBe(false);
    // 늘 같은 자리를 고른다.
    const busy = team(['frog', 2], ['mint', 11], ['can', 4]);
    for (const id of ALLY_ORDER) expect(findCell(busy, id), id).toBe(findCell(busy, id));
  });

  it('판에서 짝이 된 동료는 더 세게, 더 자주 쏜다', () => {
    // 개구리 둘이 위아래로 붙었다. 한 발의 피해가 짝 효과만큼 크다.
    const state = quiet([
      ['frog', 0],
      ['frog', 8],
    ]);
    const target = snail(state, 40, 200);
    step(state, DT);
    const one = allyDamage('frog', 1, state.stats.damage, state.stats.allyPower) * (1 + (PAIRS.frog.damage ?? 0));
    for (let time = 0; time < 1; time += DT) step(state, DT);
    expect((target.maxHp - target.hp) / one).toBeCloseTo(2, 5);

    // 해바라기 곁의 참새는 쏘는 간격이 짧다.
    const sunny = quiet([
      ['sunflower', 0],
      ['sparrow', 1],
    ]);
    snail(sunny, 40, 200);
    step(sunny, DT);
    const sparrow = sunny.allies.find((ally) => ally.id === 'sparrow');
    const interval = allyInterval('sparrow', 1) * (sunny.stats.interval / GUN.interval);
    expect((sparrow?.fireIn ?? 0) + DT).toBeCloseTo(
      interval / (1 + (PAIRS.sparrow.rate ?? 0) + (PAIRS.sunflower.rate ?? 0)),
      5,
    );
  });
});
