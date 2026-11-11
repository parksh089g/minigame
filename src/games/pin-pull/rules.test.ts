import { describe, expect, it } from 'vitest';
import {
  BASE_POINTS,
  canWinWithin,
  FALLBACK_PUZZLE,
  FIRST_SECONDS,
  fitsStage,
  generatePuzzle,
  isPinned,
  MAX_PINS,
  MAX_SHAFTS,
  MAX_STACK,
  MIN_SECONDS,
  MIN_SHAFTS,
  pinsOf,
  pull,
  puzzleSeconds,
  remainingPins,
  samePin,
  samePuzzle,
  shaftShapes,
  solve,
  solveFrom,
  STAGE_POINTS,
  stagePoints,
  STAGES,
  stageSpec,
  START_HEARTS,
  startPuzzle,
  timeBonus,
  TOP_POINT_STAGE,
  winPoints,
  winShare,
  type Item,
  type Pin,
  type Puzzle,
  type PuzzleState,
} from './rules';

/** 시드가 같으면 같은 수열이 나오는 난수(mulberry32). */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ITEMS: Record<string, Item> = { T: 'treasure', L: 'lava', W: 'water' };

/**
 * 판을 짧게 적는다. 통로는 빈칸으로 나누고, 한 통로 안에서는 위의 방부터 '/'로 잇는다.
 * T는 보물, L은 용암, W는 물이고 끝에 '+M'을 붙이면 구덩이에 괴물이 있다.
 */
function puzzleOf(text: string): Puzzle {
  const words = text.split(' ');
  const monster = words[words.length - 1] === '+M';
  const shafts = (monster ? words.slice(0, -1) : words).map((word) =>
    word.split('/').map((letter) => ITEMS[letter]),
  );
  return { shafts, monster };
}

const DOOR: Pin = { kind: 'door' };
const pin = (shaft: number, level = 0): Pin => ({ kind: 'chamber', shaft, level });

/** 핀을 차례로 뽑은 뒤의 상태 */
function play(text: string, ...pins: Pin[]): PuzzleState {
  return pins.reduce((state, next) => pull(state, next).state, startPuzzle(puzzleOf(text)));
}

/** n개의 순서를 모두 늘어놓는다. */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]),
  );
}

/** 순서대로 끝까지(이기거나 질 때까지) 뽑아 본다. */
function outcomeOf(puzzle: Puzzle, order: readonly Pin[]): PuzzleState['status'] {
  let state = startPuzzle(puzzle);
  for (const next of order) {
    if (state.status !== 'playing') break;
    state = pull(state, next).state;
  }
  return state.status;
}

describe('판의 모양', () => {
  it('핀은 통로 순서, 그 안에서는 위에서 아래 순서이고 문 핀이 맨 끝이다', () => {
    expect(pinsOf(puzzleOf('T/L W'))).toEqual([pin(0, 0), pin(0, 1), pin(1, 0), DOOR]);
    expect(samePin(pin(1, 0), pin(1, 0))).toBe(true);
    expect(samePin(pin(1, 0), pin(0, 1))).toBe(false);
    expect(samePin(DOOR, DOOR)).toBe(true);
    expect(samePin(DOOR, pin(0, 0))).toBe(false);
  });

  it('처음에는 방마다 하나씩 들어 있고, 구덩이는 비었고, 용사는 옆방에 있다', () => {
    const state = startPuzzle(puzzleOf('T/L W +M'));
    expect(state.shafts[0][0]).toEqual({
      contents: { treasure: 1, lava: 0, water: 0, stone: 0 },
      pinned: true,
    });
    expect(state.shafts[0][1].contents).toMatchObject({ lava: 1, treasure: 0 });
    expect(state.shafts[1][0].contents).toMatchObject({ water: 1 });
    expect(state.pit).toEqual({ treasure: 0, lava: 0, water: 0, stone: 0 });
    expect(state).toMatchObject({ monster: true, hero: 'room', status: 'playing', lossCause: null });
    expect(remainingPins(state)).toEqual(pinsOf(puzzleOf('T/L W')));
  });

  it('같은 판인지는 방에 든 것과 괴물로 가린다', () => {
    expect(samePuzzle(puzzleOf('T/L W'), puzzleOf('T/L W'))).toBe(true);
    expect(samePuzzle(puzzleOf('T/L W'), puzzleOf('T L/W'))).toBe(false);
    expect(samePuzzle(puzzleOf('T/L W'), puzzleOf('W T/L'))).toBe(false);
    expect(samePuzzle(puzzleOf('T L'), puzzleOf('T L +M'))).toBe(false);
  });
});

describe('핀 뽑기', () => {
  it('방의 핀을 뽑으면 든 것이 구덩이로 떨어진다', () => {
    const start = startPuzzle(puzzleOf('T L'));
    const result = pull(start, pin(1));
    expect(result).toMatchObject({ pulled: true, cooled: 0, slain: false });
    expect(result.fall).toEqual({
      contents: { treasure: 0, lava: 1, water: 0, stone: 0 },
      to: { kind: 'pit' },
    });
    expect(result.state.pit).toMatchObject({ lava: 1 });
    expect(result.state.shafts[1][0]).toEqual({
      contents: { treasure: 0, lava: 0, water: 0, stone: 0 },
      pinned: false,
    });
    expect(isPinned(result.state, pin(1))).toBe(false);
    expect(result.state.status).toBe('playing');
    // 받은 상태는 그대로다.
    expect(start.pit.lava).toBe(0);
    expect(start.shafts[1][0].pinned).toBe(true);
  });

  it('아래 방의 핀이 꽂혀 있으면 그 방에 떨어져 함께 담긴다', () => {
    const result = pull(startPuzzle(puzzleOf('W/W T')), pin(0, 0));
    expect(result.fall?.to).toEqual({ kind: 'chamber', shaft: 0, level: 1 });
    expect(result.state.shafts[0][1]).toEqual({
      contents: { treasure: 0, lava: 0, water: 2, stone: 0 },
      pinned: true,
    });
    expect(result.state.pit.water).toBe(0);
    // 아래 핀을 마저 뽑으면 모인 것이 한꺼번에 구덩이로 간다.
    const next = pull(result.state, pin(0, 1));
    expect(next.fall?.contents.water).toBe(2);
    expect(next.state.pit.water).toBe(2);
  });

  it('아래 방의 핀이 이미 뽑혔으면 곧장 구덩이로 떨어진다', () => {
    const state = play('W/L T', pin(0, 1));
    expect(state.pit.lava).toBe(1);
    const result = pull(state, pin(0, 0));
    expect(result.fall?.to).toEqual({ kind: 'pit' });
    expect(result.cooled).toBe(1);
    expect(result.state.pit).toEqual({ treasure: 0, lava: 0, water: 0, stone: 1 });
  });

  it('용암과 물은 방에서 만나도 하나씩 짝지어 돌이 된다', () => {
    for (const text of ['W/L T', 'L/W T']) {
      const result = pull(startPuzzle(puzzleOf(text)), pin(0, 0));
      expect(result.cooled).toBe(1);
      expect(result.state.shafts[0][1].contents).toEqual({ treasure: 0, lava: 0, water: 0, stone: 1 });
      expect(result.state.status).toBe('playing');
    }
  });

  it('짝이 맞지 않으면 남은 쪽은 그대로 남는다', () => {
    const lavaLeft = play('L/L W T', pin(0, 0), pin(0, 1), pin(1));
    expect(lavaLeft.pit).toEqual({ treasure: 0, lava: 1, water: 0, stone: 1 });
    const waterLeft = play('W/W L T', pin(0, 0), pin(0, 1), pin(1));
    expect(waterLeft.pit).toEqual({ treasure: 0, lava: 0, water: 1, stone: 1 });
  });

  it('용암이 보물에 닿으면 보물이 타고 판을 진다', () => {
    // 방에서: 보물이 용암 위로, 용암이 보물 위로
    for (const text of ['T/L W', 'L/T W']) {
      const result = pull(startPuzzle(puzzleOf(text)), pin(0, 0));
      expect(result.state).toMatchObject({ status: 'lost', lossCause: 'burnt' });
      expect(result.state.shafts[0][1].contents).toMatchObject({ treasure: 0, lava: 1 });
    }
    // 구덩이에서: 어느 쪽이 먼저 떨어지든
    expect(play('T L', pin(0), pin(1))).toMatchObject({ status: 'lost', lossCause: 'burnt' });
    expect(play('T L', pin(1), pin(0))).toMatchObject({ status: 'lost', lossCause: 'burnt' });
  });

  it('물이 먼저 용암을 식히므로, 물과 함께 있는 보물은 용암 한 덩이에 타지 않는다', () => {
    const cooled = play('T W L', pin(1), pin(0), pin(2));
    expect(cooled.status).toBe('playing');
    expect(cooled.pit).toEqual({ treasure: 1, lava: 0, water: 0, stone: 1 });
    // 용암이 물보다 많으면 남은 용암에 탄다.
    const burnt = play('T W L/L', pin(1), pin(0), pin(2, 0), pin(2, 1));
    expect(burnt).toMatchObject({ status: 'lost', lossCause: 'burnt' });
  });

  it('용암은 괴물을 없애고 그대로 남는다', () => {
    const result = pull(startPuzzle(puzzleOf('L T W +M')), pin(0));
    expect(result.slain).toBe(true);
    expect(result.state.monster).toBe(false);
    expect(result.state.pit.lava).toBe(1);
    expect(result.state.status).toBe('playing');
  });

  it('구덩이에 물이 고여 있으면 용암이 먼저 식어서 괴물이 살아남는다', () => {
    const state = play('L T W +M', pin(2));
    const result = pull(state, pin(0));
    expect(result).toMatchObject({ cooled: 1, slain: false });
    expect(result.state.monster).toBe(true);
    expect(result.state.pit).toMatchObject({ lava: 0, water: 0, stone: 1 });
  });

  it('물은 보물에게도 괴물에게도 아무 일을 하지 않는다', () => {
    const state = play('W T L +M', pin(0), pin(1));
    expect(state).toMatchObject({ monster: true, status: 'playing' });
    expect(state.pit).toMatchObject({ treasure: 1, water: 1 });
    const chamber = pull(startPuzzle(puzzleOf('W/T L')), pin(0, 0)).state;
    expect(chamber.status).toBe('playing');
    expect(chamber.shafts[0][1].contents).toMatchObject({ treasure: 1, water: 1 });
  });

  it('문 핀을 뽑으면 용사가 구덩이로 간다: 용암이나 괴물이 있으면 진다', () => {
    expect(play('L T', pin(0), DOOR)).toMatchObject({ hero: 'pit', status: 'lost', lossCause: 'lava' });
    expect(play('L T +M', DOOR)).toMatchObject({ hero: 'pit', status: 'lost', lossCause: 'monster' });
    // 보물이 있어도 괴물이 살아 있으면 진다.
    expect(play('L T +M', pin(1), DOOR)).toMatchObject({ status: 'lost', lossCause: 'monster' });
  });

  it('구덩이에 보물이 있고 위험한 것이 없으면 이긴다', () => {
    expect(play('T L', pin(0), DOOR)).toMatchObject({ hero: 'pit', status: 'won', lossCause: null });
    // 물이나 돌은 있어도 된다.
    expect(play('T W/L', pin(1, 0), pin(1, 1), pin(0), DOOR).status).toBe('won');
    expect(play('T W', pin(1), pin(0), DOOR).status).toBe('won');
  });

  it('빈 구덩이에서는 기다리다가, 보물이 오면 이기고 용암이 오면 진다', () => {
    const waiting = play('T L W', DOOR);
    expect(waiting).toMatchObject({ hero: 'pit', status: 'playing' });
    expect(isPinned(waiting, DOOR)).toBe(false);

    expect(pull(waiting, pin(0)).state.status).toBe('won');
    expect(pull(waiting, pin(1)).state).toMatchObject({ status: 'lost', lossCause: 'lava' });
    // 물은 해롭지 않고, 고인 물은 뒤에 오는 용암을 식혀 준다.
    const wet = pull(waiting, pin(2)).state;
    expect(wet.status).toBe('playing');
    expect(pull(wet, pin(1)).state.status).toBe('playing');
  });

  it('이미 뽑은 핀이나 끝난 판에서는 아무 일도 일어나지 않는다', () => {
    const state = play('T L', pin(1));
    const again = pull(state, pin(1));
    expect(again).toEqual({ state, pulled: false, fall: null, cooled: 0, slain: false });
    expect(again.state).toBe(state);

    const won = play('T L', pin(0), DOOR);
    expect(pull(won, pin(1)).pulled).toBe(false);
    expect(pull(won, pin(1)).state).toBe(won);
    // 없는 핀도 마찬가지다.
    expect(pull(state, pin(5)).pulled).toBe(false);
  });

  it('남은 핀은 뽑을 때마다 하나씩 줄어든다', () => {
    let state = startPuzzle(puzzleOf('W/L T W'));
    const order = [pin(2), pin(0, 1), pin(0, 0), pin(1)];
    order.forEach((next, index) => {
      expect(remainingPins(state)).toHaveLength(5 - index);
      state = pull(state, next).state;
      expect(remainingPins(state).some((left) => samePin(left, next))).toBe(false);
    });
    expect(remainingPins(state)).toEqual([DOOR]);
  });
});

describe('풀이', () => {
  it('보물 하나와 용암 하나: 여섯 순서 가운데 둘만 이긴다', () => {
    const solution = solve(puzzleOf('T L'));
    expect(solution.orders).toBe(6);
    expect(solution.winning).toBe(2);
    expect(winShare(solution)).toBeCloseTo(1 / 3);
    expect(solution.shortest).toHaveLength(2);
  });

  it('순서를 하나하나 늘어놓고 센 것과 같다', () => {
    for (const text of ['T L', 'W T/L', 'L/T L W', 'T W/L +M', 'L L/W W T +M', 'T/L L W L/W']) {
      const puzzle = puzzleOf(text);
      const orders = permutations(pinsOf(puzzle));
      const wins = orders.filter((order) => outcomeOf(puzzle, order) === 'won').length;
      const losses = orders.filter((order) => outcomeOf(puzzle, order) === 'lost').length;
      const solution = solve(puzzle);
      expect(solution.orders).toBe(orders.length);
      expect(solution.winning).toBe(wins);
      // 핀을 다 뽑으면 반드시 이기거나 진 것으로 끝난다.
      expect(wins + losses).toBe(orders.length);
    }
  });

  it('가장 짧은 풀이는 실제로 이기고, 그보다 짧게는 이길 수 없다', () => {
    for (const text of ['T L', 'W T/L', 'T W/L +M', 'L/L T W/L +M']) {
      const puzzle = puzzleOf(text);
      const { shortest } = solve(puzzle);
      expect(shortest).not.toBeNull();
      if (!shortest) continue;
      expect(outcomeOf(puzzle, shortest)).toBe('won');
      const shorter = permutations(pinsOf(puzzle)).filter(
        (order) => outcomeOf(puzzle, order.slice(0, shortest.length - 1)) === 'won',
      );
      expect(shorter).toHaveLength(0);
    }
  });

  it('용암을 식혀야 하는 판은 네 번을 뽑아야 한다', () => {
    // 보물 아래의 용암을 먼저 내려보내고, 물로 식히고, 보물을 내리고, 문을 연다.
    expect(solve(puzzleOf('W T/L')).shortest).toHaveLength(4);
    // 괴물은 용암으로 없애고, 남은 용암을 물로 식힌다.
    expect(solve(puzzleOf('T L W +M')).shortest).toHaveLength(4);
    expect(winShare(solve(puzzleOf('T L W +M')))).toBeCloseTo(2 / 24);
  });

  it('이길 수 없는 판과 질 수 없는 판을 가려낸다', () => {
    const hopeless = solve(puzzleOf('T W +M'));
    expect(hopeless.winning).toBe(0);
    expect(hopeless.shortest).toBeNull();
    const safe = solve(puzzleOf('T W'));
    expect(safe.winning).toBe(safe.orders);
  });

  it('몇 번 안에 이길 수 있는지는 가장 짧은 풀이의 길이와 맞아떨어진다', () => {
    for (const text of ['T L', 'T W', 'W T/L', 'T/W L', 'T W +M', 'T W/L +M', 'L/L T W/L +M']) {
      const start = startPuzzle(puzzleOf(text));
      const { shortest } = solve(puzzleOf(text));
      for (let limit = 0; limit <= 6; limit += 1) {
        expect(canWinWithin(start, limit)).toBe(shortest !== null && shortest.length <= limit);
      }
    }
    // 이미 이긴 상태는 더 뽑지 않아도 이긴 것이고, 진 상태는 몇 번을 뽑아도 못 이긴다.
    expect(canWinWithin(play('T L', pin(0), DOOR), 0)).toBe(true);
    expect(canWinWithin(play('T L', pin(1), DOOR), 9)).toBe(false);
  });

  it('도중의 상태에서도 풀어 볼 수 있다', () => {
    // 물을 먼저 흘려 버리면 괴물을 없앨 용암이 식어 버려서 이길 길이 없다.
    const wasted = play('T L W +M', pin(2), pin(1));
    expect(wasted.status).toBe('playing');
    expect(solveFrom(wasted).winning).toBe(0);
    // 용암으로 괴물을 없앤 뒤에는 물, 보물, 문 차례가 남는다.
    const onTrack = solveFrom(play('T L W +M', pin(1)));
    expect(onTrack.orders).toBe(6);
    expect(onTrack.winning).toBe(2);
    expect(onTrack.shortest?.[0]).toEqual(pin(2));
  });
});

describe('단계', () => {
  it('1단계보다 아래는 1단계로, 마지막 단계보다 위는 마지막 단계로 본다', () => {
    expect(stageSpec(1)).toBe(STAGES[0]);
    expect(stageSpec(0)).toBe(STAGES[0]);
    expect(stageSpec(-3)).toBe(STAGES[0]);
    expect(stageSpec(STAGES.length)).toBe(STAGES[STAGES.length - 1]);
    expect(stageSpec(999)).toBe(STAGES[STAGES.length - 1]);
  });

  it('방의 핀 두 개에서 시작해 여섯 개(문 핀 포함)까지 늘고, 줄어들지 않는다', () => {
    expect(STAGES[0]).toMatchObject({ pins: 3, stacked: false, monsterChance: 0 });
    expect(STAGES[STAGES.length - 1].pins).toBe(MAX_PINS);
    for (let index = 1; index < STAGES.length; index += 1) {
      expect(STAGES[index].pins).toBeGreaterThanOrEqual(STAGES[index - 1].pins);
    }
  });

  it('단계가 오를수록 조건이 느슨해지지 않는다', () => {
    for (let index = 1; index < STAGES.length; index += 1) {
      expect(STAGES[index].maxWinShare).toBeLessThanOrEqual(STAGES[index - 1].maxWinShare);
      expect(STAGES[index].minPulls).toBeGreaterThanOrEqual(STAGES[index - 1].minPulls);
    }
    // 괴물과 위아래로 놓인 방은 첫 단계가 아니라 뒤에 나온다.
    expect(STAGES.findIndex((spec) => spec.stacked)).toBeGreaterThan(0);
    expect(STAGES.findIndex((spec) => spec.monsterChance > 0)).toBeGreaterThan(
      STAGES.findIndex((spec) => spec.stacked),
    );
  });

  it('방을 통로에 나누는 방법은 통로 2~4개, 통로마다 방 1~2개를 지킨다', () => {
    expect(shaftShapes(2, false)).toEqual([[1, 1]]);
    expect(shaftShapes(3, true)).toEqual([
      [1, 1, 1],
      [1, 2],
      [2, 1],
    ]);
    expect(shaftShapes(5, false)).toEqual([]);
    for (const stacked of [false, true]) {
      for (let count = 2; count <= MAX_PINS - 1; count += 1) {
        for (const shape of shaftShapes(count, stacked)) {
          expect(shape.length).toBeGreaterThanOrEqual(MIN_SHAFTS);
          expect(shape.length).toBeLessThanOrEqual(MAX_SHAFTS);
          expect(shape.reduce((sum, size) => sum + size, 0)).toBe(count);
          for (const size of shape) {
            expect(size).toBeGreaterThanOrEqual(1);
            expect(size).toBeLessThanOrEqual(stacked ? MAX_STACK : 1);
          }
        }
      }
    }
  });

  it('모든 단계에 만들 수 있는 모양이 있다', () => {
    for (const spec of STAGES) {
      expect(spec.pins).toBeLessThanOrEqual(MAX_PINS);
      expect(shaftShapes(spec.pins - 1, spec.stacked).length).toBeGreaterThan(0);
    }
  });
});

describe('판 만들기', () => {
  const SEEDS = 150;
  const stages = Array.from({ length: STAGES.length + 3 }, (_, index) => index + 1);

  it('어느 단계의 어느 시드에서도 이길 수 있고 질 수도 있는, 조건에 맞는 판이 나온다', () => {
    for (const stage of stages) {
      const spec = stageSpec(stage);
      for (let seed = 1; seed <= SEEDS; seed += 1) {
        const puzzle = generatePuzzle(stage, seeded(stage * 10007 + seed));
        const solution = solve(puzzle);
        expect(solution.winning).toBeGreaterThan(0);
        expect(solution.winning).toBeLessThan(solution.orders);
        expect(fitsStage(spec, solution)).toBe(true);

        // 겉모양도 조건대로다.
        const chambers = puzzle.shafts.flat();
        expect(pinsOf(puzzle)).toHaveLength(spec.pins);
        expect(puzzle.shafts.length).toBeGreaterThanOrEqual(MIN_SHAFTS);
        expect(puzzle.shafts.length).toBeLessThanOrEqual(MAX_SHAFTS);
        expect(chambers.filter((item) => item === 'treasure')).toHaveLength(1);
        for (const shaft of puzzle.shafts) {
          expect(shaft.length).toBeGreaterThanOrEqual(1);
          expect(shaft.length).toBeLessThanOrEqual(spec.stacked ? MAX_STACK : 1);
        }
        if (spec.monsterChance === 0) expect(puzzle.monster).toBe(false);
        if (spec.monsterChance === 1) expect(puzzle.monster).toBe(true);
      }
    }
  });

  it('풀이가 알려 준 순서대로 뽑으면 실제로 보물을 얻는다', () => {
    for (const stage of stages) {
      for (let seed = 1; seed <= 60; seed += 1) {
        const puzzle = generatePuzzle(stage, seeded(stage * 7919 + seed));
        const { shortest } = solve(puzzle);
        expect(shortest).not.toBeNull();
        if (!shortest) continue;
        expect(shortest.length).toBeGreaterThanOrEqual(stageSpec(stage).minPulls);
        expect(outcomeOf(puzzle, shortest)).toBe('won');
      }
    }
  });

  it('시드가 같으면 같은 판이 나온다', () => {
    for (const stage of [1, 3, 5, 7]) {
      expect(generatePuzzle(stage, seeded(42))).toEqual(generatePuzzle(stage, seeded(42)));
    }
    const variety = new Set(
      Array.from({ length: 40 }, (_, seed) => JSON.stringify(generatePuzzle(7, seeded(seed + 1)))),
    );
    expect(variety.size).toBeGreaterThan(20);
  });

  it('단계가 오를수록 아무렇게나 뽑아서 이길 확률이 낮아진다', () => {
    const averages = STAGES.map((_, index) => {
      let total = 0;
      for (let seed = 1; seed <= SEEDS; seed += 1) {
        total += winShare(solve(generatePuzzle(index + 1, seeded(index * 30011 + seed))));
      }
      return total / SEEDS;
    });
    for (let index = 1; index < averages.length; index += 1) {
      // 표본으로 잰 값이라 아주 작은 오차는 봐준다.
      expect(averages[index]).toBeLessThanOrEqual(averages[index - 1] + 0.005);
    }
    expect(averages[0]).toBeCloseTo(1 / 3);
    expect(averages[averages.length - 1]).toBeLessThan(0.05);
  });

  it('괴물은 정해 둔 확률만큼 나온다', () => {
    STAGES.forEach((spec, index) => {
      let monsters = 0;
      const runs = 300;
      for (let seed = 1; seed <= runs; seed += 1) {
        if (generatePuzzle(index + 1, seeded(index * 50021 + seed)).monster) monsters += 1;
      }
      expect(monsters / runs).toBeGreaterThanOrEqual(spec.monsterChance - 0.08);
      expect(monsters / runs).toBeLessThanOrEqual(spec.monsterChance + 0.08);
    });
  });

  it('피할 판을 주면 그것과 다른 판이 나온다', () => {
    for (const stage of [1, 2, 4, 7]) {
      for (let seed = 1; seed <= 60; seed += 1) {
        const first = generatePuzzle(stage, seeded(seed));
        const second = generatePuzzle(stage, seeded(seed), first);
        expect(samePuzzle(first, second)).toBe(false);
        expect(fitsStage(stageSpec(stage), solve(second))).toBe(true);
      }
    }
  });

  it('끝내 못 만들었을 때 내는 판도 이길 수 있고 질 수도 있다', () => {
    const solution = solve(FALLBACK_PUZZLE);
    expect(solution.winning).toBeGreaterThan(0);
    expect(solution.winning).toBeLessThan(solution.orders);
    // 난수가 한 값만 내놓아서 맞는 판이 영영 나오지 않아도 멈추고 이 판을 낸다.
    expect(generatePuzzle(4, () => 0)).toBe(FALLBACK_PUZZLE);
  });
});

describe('시간과 점수', () => {
  it('목숨은 세 개로 시작한다', () => {
    expect(START_HEARTS).toBe(3);
  });

  it('제한 시간은 15초에서 시작해 단계마다 줄어든다', () => {
    expect(puzzleSeconds(1)).toBe(FIRST_SECONDS);
    expect(puzzleSeconds(0)).toBe(FIRST_SECONDS);
    for (let stage = 2; stage <= 60; stage += 1) {
      expect(puzzleSeconds(stage)).toBeLessThan(puzzleSeconds(stage - 1));
    }
  });

  it('줄어드는 폭은 갈수록 작아지고, 가장 짧은 시간 아래로는 내려가지 않는다', () => {
    for (let stage = 3; stage <= 60; stage += 1) {
      const step = puzzleSeconds(stage - 1) - puzzleSeconds(stage);
      const before = puzzleSeconds(stage - 2) - puzzleSeconds(stage - 1);
      expect(step).toBeLessThan(before);
      expect(step).toBeLessThan(1);
    }
    expect(puzzleSeconds(500)).toBeGreaterThanOrEqual(MIN_SECONDS);
    expect(puzzleSeconds(500)).toBeCloseTo(MIN_SECONDS, 3);
  });

  it('10단계에 10초쯤, 16단계에 8초 남짓이다', () => {
    expect(puzzleSeconds(10)).toBeGreaterThan(9.5);
    expect(puzzleSeconds(10)).toBeLessThan(10.8);
    expect(puzzleSeconds(16)).toBeGreaterThan(7.8);
    expect(puzzleSeconds(16)).toBeLessThan(8.8);
  });

  it('기본 점수는 단계마다 늘다가 정해진 단계부터는 그대로다', () => {
    expect(stagePoints(1)).toBe(BASE_POINTS);
    expect(stagePoints(0)).toBe(BASE_POINTS);
    expect(stagePoints(2)).toBe(BASE_POINTS + STAGE_POINTS);
    for (let stage = 2; stage <= TOP_POINT_STAGE; stage += 1) {
      expect(stagePoints(stage) - stagePoints(stage - 1)).toBe(STAGE_POINTS);
    }
    expect(stagePoints(TOP_POINT_STAGE + 1)).toBe(stagePoints(TOP_POINT_STAGE));
    expect(stagePoints(999)).toBe(stagePoints(TOP_POINT_STAGE));
  });

  it('남긴 시간은 1초에 1점이고 소수점 아래는 버린다', () => {
    expect(timeBonus(0)).toBe(0);
    expect(timeBonus(0.99)).toBe(0);
    expect(timeBonus(7.2)).toBe(7);
    expect(timeBonus(15)).toBe(15);
    expect(timeBonus(-1)).toBe(0);
  });

  it('판을 깬 점수는 기본 점수와 시간 보너스의 합이고 언제나 0 이상의 정수다', () => {
    expect(winPoints(1, 12.7)).toBe(BASE_POINTS + 12);
    expect(winPoints(5, 0)).toBe(stagePoints(5));
    for (let stage = 1; stage <= 40; stage += 1) {
      for (const left of [0, 0.4, 3.3, puzzleSeconds(stage)]) {
        const points = winPoints(stage, left);
        expect(Number.isInteger(points)).toBe(true);
        expect(points).toBeGreaterThanOrEqual(BASE_POINTS);
      }
    }
    // 빨리 풀수록, 단계가 높을수록 많이 받는다.
    expect(winPoints(3, 9)).toBeGreaterThan(winPoints(3, 2));
    expect(winPoints(6, 4)).toBeGreaterThan(winPoints(2, 4));
  });
});
