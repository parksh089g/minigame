import { describe, expect, it } from 'vitest';
import {
  BASE_POINTS,
  canPull,
  canWinWithin,
  EXTRA_PULL_POINTS,
  EXTRA_PULL_SECONDS,
  FALLBACK_PUZZLE,
  FIRST_SECONDS,
  fitsStage,
  generatePuzzle,
  isLocked,
  isPinned,
  MAX_PINS,
  MAX_SHAFTS,
  MAX_STACK,
  MIN_SECONDS,
  MIN_SHAFTS,
  movesOf,
  partnerOf,
  pinsOf,
  PLAIN_PULLS,
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
  stageShapes,
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

const ITEMS: Record<string, Item> = { T: 'treasure', L: 'lava', W: 'water', K: 'key' };

/**
 * 판을 짧게 적는다. 통로는 빈칸으로 나누고, 한 통로 안에서는 위의 방부터 '/'로 잇는다.
 * T는 보물, L은 용암, W는 물, K는 열쇠이고 끝에 '+M'을 붙이면 구덩이에 괴물이 있다.
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

/** 순서대로 끝까지(이기거나 질 때까지) 뽑아 본다. pulls는 끝날 때까지 뽑은 핀의 수다. */
function playOut(puzzle: Puzzle, order: readonly Pin[]): { status: PuzzleState['status']; pulls: number } {
  let state = startPuzzle(puzzle);
  let pulls = 0;
  for (const next of order) {
    if (state.status !== 'playing') break;
    state = pull(state, next).state;
    pulls += 1;
  }
  return { status: state.status, pulls };
}

function outcomeOf(puzzle: Puzzle, order: readonly Pin[]): PuzzleState['status'] {
  return playOut(puzzle, order).status;
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
      contents: { treasure: 1, lava: 0, water: 0, stone: 0, key: 0 },
      pinned: true,
    });
    expect(state.shafts[0][1].contents).toMatchObject({ lava: 1, treasure: 0 });
    expect(state.shafts[1][0].contents).toMatchObject({ water: 1 });
    expect(state.pit).toEqual({ treasure: 0, lava: 0, water: 0, stone: 0, key: 0 });
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
    expect(result.pins).toEqual([pin(1)]);
    expect(result.falls).toEqual([
      { shaft: 1, level: 0, contents: { treasure: 0, lava: 1, water: 0, stone: 0, key: 0 }, to: { kind: 'pit' } },
    ]);
    expect(result.landings).toEqual([{ to: { kind: 'pit' }, cooled: 0, burnt: false, melted: false }]);
    expect(result.state.pit).toMatchObject({ lava: 1 });
    expect(result.state.shafts[1][0]).toEqual({
      contents: { treasure: 0, lava: 0, water: 0, stone: 0, key: 0 },
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
    expect(result.falls[0]?.to).toEqual({ kind: 'chamber', shaft: 0, level: 1 });
    expect(result.state.shafts[0][1]).toEqual({
      contents: { treasure: 0, lava: 0, water: 2, stone: 0, key: 0 },
      pinned: true,
    });
    expect(result.state.pit.water).toBe(0);
    // 아래 핀을 마저 뽑으면 모인 것이 한꺼번에 구덩이로 간다.
    const next = pull(result.state, pin(0, 1));
    expect(next.falls[0]?.contents.water).toBe(2);
    expect(next.state.pit.water).toBe(2);
  });

  it('아래 방의 핀이 이미 뽑혔으면 곧장 구덩이로 떨어진다', () => {
    const state = play('W/L T', pin(0, 1));
    expect(state.pit.lava).toBe(1);
    const result = pull(state, pin(0, 0));
    expect(result.falls[0]?.to).toEqual({ kind: 'pit' });
    expect(result.cooled).toBe(1);
    expect(result.state.pit).toEqual({ treasure: 0, lava: 0, water: 0, stone: 1, key: 0 });
  });

  it('용암과 물은 방에서 만나도 하나씩 짝지어 돌이 된다', () => {
    for (const text of ['W/L T', 'L/W T']) {
      const result = pull(startPuzzle(puzzleOf(text)), pin(0, 0));
      expect(result.cooled).toBe(1);
      expect(result.state.shafts[0][1].contents).toEqual({ treasure: 0, lava: 0, water: 0, stone: 1, key: 0 });
      expect(result.state.status).toBe('playing');
    }
  });

  it('짝이 맞지 않으면 남은 쪽은 그대로 남는다', () => {
    const lavaLeft = play('L/L W T', pin(0, 0), pin(0, 1), pin(1));
    expect(lavaLeft.pit).toEqual({ treasure: 0, lava: 1, water: 0, stone: 1, key: 0 });
    const waterLeft = play('W/W L T', pin(0, 0), pin(0, 1), pin(1));
    expect(waterLeft.pit).toEqual({ treasure: 0, lava: 0, water: 1, stone: 1, key: 0 });
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
    expect(cooled.pit).toEqual({ treasure: 1, lava: 0, water: 0, stone: 1, key: 0 });
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
    expect(result.state.pit).toMatchObject({ lava: 0, water: 0, stone: 1, key: 0 });
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
    expect(again).toEqual({
      state,
      pulled: false,
      pins: [],
      falls: [],
      landings: [],
      cooled: 0,
      slain: false,
      unlocked: false,
    });
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
    expect(solution.chance).toBeCloseTo(2 / 6);
    expect(winShare(solution)).toBe(solution.chance);
    expect(solution.shortest).toHaveLength(2);
  });

  it('순서를 하나하나 늘어놓고 센 것과 같다', () => {
    for (const text of [
      'T L',
      'W T/L',
      'L/T L W',
      'T W/L +M',
      'L L/W W T +M',
      'T/L L W L/W',
      // 3층으로 쌓인 통로가 있는 판: 핀 6개, 8개(순서는 4만 가지)
      'T/L/L W W +M',
      'L/W/T L W',
      'L/L/W T/L/W W +M',
      'T/L/L W W/W/L',
    ]) {
      const puzzle = puzzleOf(text);
      const orders = permutations(pinsOf(puzzle));
      const ends = orders.map((order) => playOut(puzzle, order));
      const wins = ends.filter((end) => end.status === 'won');
      const losses = ends.filter((end) => end.status === 'lost');
      const solution = solve(puzzle);
      // 아무 핀이나 고르기를 되풀이하는 것은 순서 하나를 고르게 뽑는 것과 같아서, 확률이 이기는 순서의 비율과 같다.
      expect(solution.chance, text).toBeCloseTo(wins.length / orders.length, 10);
      // 핀을 다 뽑으면 반드시 이기거나 진 것으로 끝난다.
      expect(wins.length + losses.length, text).toBe(orders.length);
      // 가장 짧은 순서도 같다. 그런 순서가 여럿이면 핀 순서로 가장 앞선 것을 낸다.
      const fewest = Math.min(...wins.map((end) => end.pulls));
      const first = orders.findIndex((_, index) => ends[index].status === 'won' && ends[index].pulls === fewest);
      expect(solution.shortest, text).toEqual(first < 0 ? null : orders[first].slice(0, fewest));
    }
  });

  it('지지 않은 상태는 뽑힌 핀과 괴물의 생사만으로 정해진다: 풀이가 순서를 다 늘어놓지 않아도 되는 까닭', () => {
    for (const text of ['T L W +M', 'L/W/T L W +M', 'T/L/L W W/W/L', 'L/L/W T/L/W W +M', 'W/L T/L/W L/W L +M']) {
      const puzzle = puzzleOf(text);
      const pins = pinsOf(puzzle);
      const seen = new Map<string, PuzzleState>();
      let met = 0;
      const walk = (state: PuzzleState, pulled: number): void => {
        if (state.status === 'lost') return;
        const key = `${pulled}/${state.monster}`;
        const before = seen.get(key);
        if (before) {
          // 다른 차례로 같은 핀들을 뽑아 왔다. 방과 구덩이에 든 것까지 모두 같아야 한다.
          expect(state, `${text} ${key}`).toEqual(before);
          met += 1;
          return;
        }
        seen.set(key, state);
        // 이긴 판은 거기서 끝난다. 더 뽑아도 상태가 바뀌지 않는다.
        if (state.status !== 'playing') return;
        pins.forEach((pin, index) => {
          if (isPinned(state, pin)) walk(pull(state, pin).state, pulled | (1 << index));
        });
      };
      walk(startPuzzle(puzzle), 0);
      expect(met, text).toBeGreaterThan(0);
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
    expect(hopeless.chance).toBe(0);
    expect(hopeless.shortest).toBeNull();
    const safe = solve(puzzleOf('T W'));
    expect(safe.chance).toBe(1);
  });

  it('3층으로 쌓인 통로가 있으면 여섯 번, 여덟 번을 뽑아야 하는 판이 나온다', () => {
    // 보물 밑의 용암 둘을 구덩이로 내려보내 괴물을 없애고, 물 둘로 식힌 다음에야 보물을 내릴 수 있다.
    expect(solve(puzzleOf('T/L/L W W +M')).shortest).toHaveLength(6);
    expect(play('T/L/L W W +M', pin(0, 0)).lossCause).toBe('burnt');
    // 괴물이 없어도 용암 둘을 치워야 해서 여섯 번이다. 2층까지만 쌓으면 네 번을 넘지 않는다.
    expect(solve(puzzleOf('T/L/L W W')).shortest).toHaveLength(6);
    expect(solve(puzzleOf('T/L L W W')).shortest).toHaveLength(4);
    // 방이 일곱 개인 판에서 핀 여덟 개를 모두 뽑아야 하는 것도 있다.
    expect(solve(puzzleOf('L/L/W T/L/W W +M')).shortest).toHaveLength(8);
    expect(solve(puzzleOf('T/L/L W W/W/L')).shortest).toHaveLength(8);
  });

  it('이미 끝난 상태에서는 더 따질 것이 없다', () => {
    // 이긴 상태는 남은 핀을 어떻게 뽑든 이긴 것이고, 진 상태는 이길 길이 없다.
    expect(solveFrom(play('T L', pin(0), DOOR))).toEqual({ chance: 1, shortest: [] });
    expect(solveFrom(play('T L', pin(1), DOOR))).toEqual({ chance: 0, shortest: null });
    expect(solveFrom(play('T L W W', pin(0), DOOR))).toEqual({ chance: 1, shortest: [] });
  });

  it('몇 번 안에 이길 수 있는지는 가장 짧은 풀이의 길이와 맞아떨어진다', () => {
    for (const text of [
      'T L',
      'T W',
      'W T/L',
      'T/W L',
      'T W +M',
      'T W/L +M',
      'L/L T W/L +M',
      'T/L/L W W +M',
      'L/L/W T/L/W W +M',
      'T/L/L W W/W/L',
    ]) {
      const start = startPuzzle(puzzleOf(text));
      const { shortest } = solve(puzzleOf(text));
      for (let limit = 0; limit <= 9; limit += 1) {
        expect(canWinWithin(start, limit), `${text} ${limit}번`).toBe(shortest !== null && shortest.length <= limit);
      }
    }
    // 이미 이긴 상태는 더 뽑지 않아도 이긴 것이고, 진 상태는 몇 번을 뽑아도 못 이긴다.
    expect(canWinWithin(play('T L', pin(0), DOOR), 0)).toBe(true);
    expect(canWinWithin(play('T L', pin(1), DOOR), 9)).toBe(false);
    // 도중의 상태에서는 남은 횟수만 센다.
    expect(canWinWithin(play('T L W +M', pin(1)), 2)).toBe(false);
    expect(canWinWithin(play('T L W +M', pin(1)), 3)).toBe(true);
  });

  it('도중의 상태에서도 풀어 볼 수 있다', () => {
    // 물을 먼저 흘려 버리면 괴물을 없앨 용암이 식어 버려서 이길 길이 없다.
    const wasted = play('T L W +M', pin(2), pin(1));
    expect(wasted.status).toBe('playing');
    expect(solveFrom(wasted).chance).toBe(0);
    // 용암으로 괴물을 없앤 뒤에는 물, 보물, 문 차례가 남는다.
    const onTrack = solveFrom(play('T L W +M', pin(1)));
    expect(onTrack.chance).toBeCloseTo(2 / 6);
    expect(onTrack.shortest?.[0]).toEqual(pin(2));
  });
});

describe('열쇠와 자물쇠', () => {
  const locked = (text: string, ...locks: Pin[]): Puzzle => ({ ...puzzleOf(text), locks });

  it('자물쇠가 달린 핀은 열쇠가 구덩이에 닿기 전에는 뽑히지 않는다', () => {
    const start = startPuzzle(locked('T K W', pin(0)));
    expect(isLocked(start, pin(0))).toBe(true);
    expect(isLocked(start, pin(1))).toBe(false);
    expect(canPull(start, pin(0))).toBe(false);
    expect(movesOf(start)).toEqual([pin(1), pin(2), DOOR]);
    // 꽂혀 있기는 하다.
    expect(remainingPins(start)).toEqual([pin(0), pin(1), pin(2), DOOR]);
    const refused = pull(start, pin(0));
    expect(refused.pulled).toBe(false);
    expect(refused.state).toBe(start);

    const opened = pull(start, pin(1));
    expect(opened).toMatchObject({ pulled: true, unlocked: true });
    expect(opened.state.locks).toEqual([]);
    // 열쇠는 자물쇠를 풀고 사라진다.
    expect(opened.state.pit.key).toBe(0);
    expect(canPull(opened.state, pin(0))).toBe(true);
    expect(pull(opened.state, pin(0)).state.pit.treasure).toBe(1);
  });

  it('열쇠가 아래 방에 얹혀 있는 동안에는 풀리지 않는다', () => {
    const start = startPuzzle(locked('T K/W', pin(0)));
    const resting = pull(start, pin(1, 0));
    expect(resting.unlocked).toBe(false);
    expect(resting.state.shafts[1][1].contents).toMatchObject({ key: 1, water: 1 });
    expect(canPull(resting.state, pin(0))).toBe(false);
    const opened = pull(resting.state, pin(1, 1));
    expect(opened.unlocked).toBe(true);
    expect(opened.state.pit).toMatchObject({ key: 0, water: 1 });
    expect(canPull(opened.state, pin(0))).toBe(true);
  });

  it('문 핀에도 자물쇠가 달릴 수 있다', () => {
    const start = startPuzzle(locked('T K', DOOR));
    expect(canPull(start, DOOR)).toBe(false);
    expect(pull(start, DOOR).pulled).toBe(false);
    const state = [pin(0), pin(1), DOOR].reduce((now, next) => pull(now, next).state, start);
    expect(state.status).toBe('won');
  });

  it('용암이 열쇠에 닿으면 열쇠가 녹고 판을 진다', () => {
    // 용암이 고인 구덩이에 열쇠가 떨어진다.
    const sunk = pull(play('T K L', pin(2)), pin(1));
    expect(sunk.state).toMatchObject({ status: 'lost', lossCause: 'melted' });
    expect(sunk.landings).toEqual([{ to: { kind: 'pit' }, cooled: 0, burnt: false, melted: true }]);
    expect(sunk.unlocked).toBe(false);
    // 방에 든 열쇠 위로 용암이 떨어진다.
    expect(play('T L/K', pin(1, 0))).toMatchObject({ status: 'lost', lossCause: 'melted' });
    // 보물과 열쇠가 함께 있다가 용암에 닿으면 보물이 탄 것으로 친다.
    const both = pull(play('T/K L', pin(0, 0), pin(1)), pin(0, 1));
    expect(both.state).toMatchObject({ status: 'lost', lossCause: 'burnt' });
    expect(both.landings).toEqual([{ to: { kind: 'pit' }, cooled: 0, burnt: true, melted: true }]);
  });

  it('물과 함께 떨어진 열쇠는 용암 한 덩이에 녹지 않는다', () => {
    const state = play('T K/W L', pin(2), pin(1, 0));
    const landed = pull(state, pin(1, 1));
    expect(landed).toMatchObject({ cooled: 1, unlocked: true });
    expect(landed.state.status).toBe('playing');
    expect(landed.state.pit).toMatchObject({ lava: 0, water: 0, stone: 1, key: 0 });
  });

  it('풀이는 자물쇠를 지킨다: 잠긴 핀은 열쇠 다음에야 나온다', () => {
    const puzzle = locked('T K W', pin(0));
    const { shortest, chance } = solve(puzzle);
    expect(shortest).toEqual([pin(1), pin(0), DOOR]);
    // 열쇠, 물, 문 가운데 처음에 무엇을 뽑든 지지는 않는다.
    expect(chance).toBe(1);
    // 자물쇠가 없으면 두 번이면 되던 판이다.
    expect(solve(puzzleOf('T K W')).shortest).toHaveLength(2);
  });

  it('열쇠가 내려올 길이 없어서 더 뽑을 핀이 없어지면 이길 수 없는 것으로 친다', () => {
    const stuck = solve(locked('T K', pin(0), pin(1)));
    expect(stuck).toEqual({ chance: 0, shortest: null });
    expect(canWinWithin(startPuzzle(locked('T K', pin(0), pin(1))), 9)).toBe(false);
  });
});

describe('사슬로 묶인 핀', () => {
  const linked = (text: string, one: Pin, other: Pin): Puzzle => ({ ...puzzleOf(text), links: [[one, other]] });

  it('하나를 뽑으면 짝도 함께 뽑히고, 든 것이 한꺼번에 떨어져 함께 섞인다', () => {
    const start = startPuzzle(linked('T L W +M', pin(1), pin(2)));
    expect(partnerOf(start.links, pin(1))).toEqual(pin(2));
    expect(partnerOf(start.links, pin(2))).toEqual(pin(1));
    expect(partnerOf(start.links, pin(0))).toBeNull();
    // 둘 중 무엇을 눌러도 같으므로 둘 수 있는 수에는 앞선 것만 나온다.
    expect(movesOf(start)).toEqual([pin(0), pin(1), DOOR]);

    const result = pull(start, pin(2));
    expect(result.pins).toEqual([pin(2), pin(1)]);
    expect(result.falls).toHaveLength(2);
    expect(result.landings).toEqual([{ to: { kind: 'pit' }, cooled: 1, burnt: false, melted: false }]);
    // 용암과 물이 한꺼번에 닿아 바로 식으므로 괴물은 살아남는다. 따로 뽑았다면 용암이 먼저 괴물을 없앴을 것이다.
    expect(result).toMatchObject({ cooled: 1, slain: false });
    expect(result.state.pit).toMatchObject({ lava: 0, water: 0, stone: 1 });
    expect(remainingPins(result.state)).toEqual([pin(0), DOOR]);
    expect(pull(start, pin(1)).state).toEqual(result.state);
    expect(play('T L W +M', pin(1), pin(2)).monster).toBe(false);
  });

  it('위아래로 묶인 핀은 둘 다 그 아래 칸으로 떨어진다', () => {
    const result = pull(startPuzzle(linked('W/L/T W', pin(0, 0), pin(0, 1))), pin(0, 1));
    expect(result.falls.map((fall) => fall.to)).toEqual([
      { kind: 'chamber', shaft: 0, level: 2 },
      { kind: 'chamber', shaft: 0, level: 2 },
    ]);
    // 물이 함께 내려와서 보물이 타지 않는다.
    expect(result.landings).toEqual([{ to: { kind: 'chamber', shaft: 0, level: 2 }, cooled: 1, burnt: false, melted: false }]);
    expect(result.state.status).toBe('playing');
    expect(result.state.shafts[0][2].contents).toMatchObject({ treasure: 1, stone: 1, lava: 0 });
    // 묶이지 않았다면 용암만 먼저 내려와 보물이 탄다.
    expect(play('W/L/T W', pin(0, 1)).lossCause).toBe('burnt');
  });

  it('서로 다른 칸에 닿으면 칸마다 따로 섞인다', () => {
    const result = pull(startPuzzle(linked('W/L T L', pin(0, 0), pin(2))), pin(0, 0));
    expect(result.landings).toEqual([
      { to: { kind: 'chamber', shaft: 0, level: 1 }, cooled: 1, burnt: false, melted: false },
      { to: { kind: 'pit' }, cooled: 0, burnt: false, melted: false },
    ]);
    expect(result.cooled).toBe(1);
    expect(result.state.pit.lava).toBe(1);
    expect(result.state.shafts[0][1].contents).toMatchObject({ stone: 1, lava: 0, water: 0 });
    // 방에서 보물이 타면, 구덩이에서 아무 일이 없었어도 진 판이다.
    const burnt = pull(startPuzzle(linked('L/T W W', pin(0, 0), pin(1))), pin(1));
    expect(burnt.state).toMatchObject({ status: 'lost', lossCause: 'burnt' });
    expect(burnt.landings.map((landing) => landing.burnt)).toEqual([true, false]);
  });

  it('짝에 자물쇠가 잠겨 있으면 함께 묶인 핀도 뽑히지 않는다', () => {
    const puzzle: Puzzle = { ...puzzleOf('T L W K'), links: [[pin(1), pin(2)]], locks: [pin(2)] };
    const start = startPuzzle(puzzle);
    expect(canPull(start, pin(1))).toBe(false);
    expect(pull(start, pin(1)).pulled).toBe(false);
    expect(canPull(pull(start, pin(3)).state, pin(1))).toBe(true);
  });

  it('같은 판인지 가릴 때 자물쇠와 사슬도 본다', () => {
    const plain = puzzleOf('T L W K');
    const one: Puzzle = { ...plain, links: [[pin(1), pin(2)]], locks: [pin(0), DOOR] };
    const same: Puzzle = { ...plain, links: [[pin(2), pin(1)]], locks: [DOOR, pin(0)] };
    expect(samePuzzle(one, same)).toBe(true);
    expect(samePuzzle(one, plain)).toBe(false);
    expect(samePuzzle(one, { ...one, locks: [pin(0)] })).toBe(false);
    expect(samePuzzle(one, { ...one, links: [[pin(1), pin(3)]] })).toBe(false);
  });
});

describe('장치가 든 판의 풀이', () => {
  const puzzles: Puzzle[] = [
    { ...puzzleOf('T K W'), locks: [pin(0)] },
    { ...puzzleOf('T/L K/W L W +M'), locks: [pin(0, 1), DOOR] },
    { ...puzzleOf('W/L T L W +M'), links: [[pin(0, 0), pin(2)]] },
    { ...puzzleOf('L/W T/L K W +M'), locks: [pin(1, 1)], links: [[pin(0, 0), pin(3)]] },
    { ...puzzleOf('L/W/L L K L/W/T +M'), locks: [pin(1), pin(3, 1)], links: [[pin(0, 2), pin(3, 2)]] },
  ];

  /** 둘 수 있는 수를 하나하나 따라가며 센 것: 아무거나 골라 이길 확률과 가장 짧게 이기는 횟수 */
  function bruteForce(state: PuzzleState): { chance: number; fewest: number } {
    if (state.status === 'won') return { chance: 1, fewest: 0 };
    if (state.status === 'lost') return { chance: 0, fewest: Infinity };
    const moves = movesOf(state);
    if (moves.length === 0) return { chance: 0, fewest: Infinity };
    const ends = moves.map((move) => bruteForce(pull(state, move).state));
    return {
      chance: ends.reduce((sum, end) => sum + end.chance, 0) / moves.length,
      fewest: 1 + Math.min(...ends.map((end) => end.fewest)),
    };
  }

  it('하나하나 따라가며 센 것과 같다', () => {
    for (const puzzle of puzzles) {
      const label = JSON.stringify(puzzle);
      const brute = bruteForce(startPuzzle(puzzle));
      const solution = solve(puzzle);
      expect(solution.chance, label).toBeCloseTo(brute.chance, 10);
      expect(solution.shortest?.length ?? Infinity, label).toBe(brute.fewest);
      for (let limit = 0; limit <= 9; limit += 1) {
        expect(canWinWithin(startPuzzle(puzzle), limit), `${label} ${limit}번`).toBe(brute.fewest <= limit);
      }
    }
  });

  it('풀이대로 누르면 이기고, 잠긴 핀을 누르는 일은 없다', () => {
    for (const puzzle of puzzles) {
      const { shortest } = solve(puzzle);
      expect(shortest, JSON.stringify(puzzle)).not.toBeNull();
      let state = startPuzzle(puzzle);
      for (const next of shortest ?? []) {
        const result = pull(state, next);
        expect(result.pulled).toBe(true);
        state = result.state;
      }
      expect(state.status).toBe('won');
    }
  });

  it('지지 않은 상태는 여전히 뽑힌 핀과 괴물의 생사만으로 정해진다', () => {
    for (const puzzle of puzzles) {
      const seen = new Map<string, string>();
      const walk = (state: PuzzleState): void => {
        if (state.status !== 'playing') return;
        const key = `${remainingPins(state).map((each) => JSON.stringify(each)).join()}|${state.monster}`;
        const whole = JSON.stringify(state);
        const before = seen.get(key);
        if (before !== undefined) {
          expect(whole).toBe(before);
          return;
        }
        seen.set(key, whole);
        for (const move of movesOf(state)) walk(pull(state, move).state);
      };
      walk(startPuzzle(puzzle));
      expect(seen.size).toBeGreaterThan(1);
    }
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

  it('방의 핀 두 개에서 시작해 핀 여덟 개(문 핀 포함)까지 늘고, 줄어들지 않는다', () => {
    expect(STAGES[0]).toMatchObject({ pins: 3, maxStack: 1, monsterChance: 0 });
    expect(STAGES[STAGES.length - 1].pins).toBe(MAX_PINS);
    for (let index = 1; index < STAGES.length; index += 1) {
      expect(STAGES[index].pins).toBeGreaterThanOrEqual(STAGES[index - 1].pins);
    }
  });

  it('단계가 오를수록 조건이 느슨해지지 않는다', () => {
    for (let index = 1; index < STAGES.length; index += 1) {
      expect(STAGES[index].maxWinShare).toBeLessThanOrEqual(STAGES[index - 1].maxWinShare);
      expect(STAGES[index].minPulls).toBeGreaterThanOrEqual(STAGES[index - 1].minPulls);
      expect(STAGES[index].maxStack).toBeGreaterThanOrEqual(STAGES[index - 1].maxStack);
    }
    // 위아래로 놓인 방, 괴물, 3층으로 쌓인 통로는 첫 단계가 아니라 이 차례로 뒤에 나온다.
    const firstStacked = STAGES.findIndex((spec) => spec.maxStack > 1);
    const firstMonster = STAGES.findIndex((spec) => spec.monsterChance > 0);
    const firstTall = STAGES.findIndex((spec) => spec.maxStack === MAX_STACK);
    expect(firstStacked).toBeGreaterThan(0);
    expect(firstMonster).toBeGreaterThan(firstStacked);
    expect(firstTall).toBeGreaterThan(firstMonster);
    // 네 번 넘게 뽑아야 하는 판은 3층 통로가 있어야 나오므로, 그런 단계는 모두 3층까지 쌓는다.
    for (const spec of STAGES) {
      if (spec.minPulls > PLAIN_PULLS) expect(spec.maxStack).toBe(MAX_STACK);
    }
  });

  it('방을 통로에 나누는 방법은 통로 2~4개, 통로마다 정한 층수까지를 지킨다', () => {
    expect(shaftShapes(2, 1)).toEqual([[1, 1]]);
    expect(shaftShapes(3, 2)).toEqual([
      [1, 1, 1],
      [1, 2],
      [2, 1],
    ]);
    // 방 셋을 한 통로에 다 쌓으면 통로가 하나뿐이라서, 3층까지 쌓게 해도 나눌 방법은 같다.
    expect(shaftShapes(3, 3)).toEqual(shaftShapes(3, 2));
    expect(shaftShapes(4, 3)).toEqual([
      [1, 1, 1, 1],
      [1, 1, 2],
      [1, 2, 1],
      [1, 3],
      [2, 1, 1],
      [2, 2],
      [3, 1],
    ]);
    expect(shaftShapes(5, 1)).toEqual([]);
    // 정한 것보다 높이 쌓으라고 해도 MAX_STACK을 넘지 않는다.
    expect(shaftShapes(6, 9)).toEqual(shaftShapes(6, MAX_STACK));
    for (let maxStack = 1; maxStack <= MAX_STACK; maxStack += 1) {
      for (let count = 2; count <= MAX_PINS - 1; count += 1) {
        for (const shape of shaftShapes(count, maxStack)) {
          expect(shape.length).toBeGreaterThanOrEqual(MIN_SHAFTS);
          expect(shape.length).toBeLessThanOrEqual(MAX_SHAFTS);
          expect(shape.reduce((sum, size) => sum + size, 0)).toBe(count);
          for (const size of shape) {
            expect(size).toBeGreaterThanOrEqual(1);
            expect(size).toBeLessThanOrEqual(maxStack);
          }
        }
      }
    }
  });

  it('모든 단계에 만들 수 있는 모양이 있고, 3층까지 쌓는 단계는 3층 통로가 있는 모양만 쓴다', () => {
    for (const spec of STAGES) {
      expect(spec.pins).toBeLessThanOrEqual(MAX_PINS);
      const shapes = stageShapes(spec);
      expect(shapes.length).toBeGreaterThan(0);
      if (spec.maxStack < MAX_STACK) {
        expect(shapes).toEqual(shaftShapes(spec.pins - 1, spec.maxStack));
      } else {
        for (const shape of shapes) expect(Math.max(...shape)).toBe(MAX_STACK);
        expect(shapes.length).toBeLessThan(shaftShapes(spec.pins - 1, spec.maxStack).length);
      }
    }
  });
});

describe('판 만들기', () => {
  const SEEDS = 150;
  // 표가 끝난 뒤의 단계도 몇 개 본다: 마지막 줄을 그대로 쓴다.
  const stages = Array.from({ length: STAGES.length + 2 }, (_, index) => index + 1);
  /** 그 단계에서 만들어 볼 판의 수. 3층까지 쌓는 단계는 판 하나를 만드는 데 훨씬 오래 걸려서 덜 만든다. */
  const seedsOf = (stage: number, most: number): number =>
    stageSpec(stage).maxStack === MAX_STACK ? Math.ceil(most / 3) : most;
  /** 판을 많이 만들어 보는 테스트의 제한 시간(ms). 느린 기계에서도 넉넉하다. */
  const SLOW = 20_000;

  it('어느 단계의 어느 시드에서도 이길 수 있고 질 수도 있는, 조건에 맞는 판이 나온다', () => {
    for (const stage of stages) {
      const spec = stageSpec(stage);
      for (let seed = 1; seed <= seedsOf(stage, SEEDS); seed += 1) {
        const puzzle = generatePuzzle(stage, seeded(stage * 10007 + seed));
        const solution = solve(puzzle);
        expect(solution.chance).toBeGreaterThan(0);
        expect(solution.chance).toBeLessThan(1);
        expect(fitsStage(spec, solution)).toBe(true);

        // 겉모양도 조건대로다.
        const chambers = puzzle.shafts.flat();
        expect(pinsOf(puzzle)).toHaveLength(spec.pins);
        expect(puzzle.shafts.length).toBeGreaterThanOrEqual(MIN_SHAFTS);
        expect(puzzle.shafts.length).toBeLessThanOrEqual(MAX_SHAFTS);
        expect(chambers.filter((item) => item === 'treasure')).toHaveLength(1);
        for (const shaft of puzzle.shafts) {
          expect(shaft.length).toBeGreaterThanOrEqual(1);
          expect(shaft.length).toBeLessThanOrEqual(spec.maxStack);
        }
        if (spec.maxStack === MAX_STACK) {
          expect(Math.max(...puzzle.shafts.map((shaft) => shaft.length))).toBe(MAX_STACK);
        }
        if (spec.monsterChance === 0) expect(puzzle.monster).toBe(false);
        if (spec.monsterChance === 1) expect(puzzle.monster).toBe(true);
      }
    }
  }, SLOW);

  it('풀이가 알려 준 순서대로 뽑으면 실제로 보물을 얻는다', () => {
    for (const stage of stages) {
      for (let seed = 1; seed <= seedsOf(stage, 60); seed += 1) {
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
    for (const stage of [1, 3, 5, 7, 8, STAGES.length]) {
      expect(generatePuzzle(stage, seeded(42))).toEqual(generatePuzzle(stage, seeded(42)));
    }
    // 시드가 다르면 여러 가지 판이 나온다. 3층까지 쌓는 마지막 단계도 그렇다.
    for (const stage of [7, STAGES.length]) {
      const variety = new Set(
        Array.from({ length: 40 }, (_, seed) => JSON.stringify(generatePuzzle(stage, seeded(seed + 1)))),
      );
      expect(variety.size, `${stage}단계`).toBeGreaterThan(20);
    }
  });

  it('3층까지 쌓는 단계에는 괴물이 없는 판도 섞여 나오고, 그런 판도 여섯 번을 뽑아야 한다', () => {
    STAGES.forEach((spec, index) => {
      if (spec.maxStack < MAX_STACK) return;
      let calm = 0;
      for (let seed = 1; seed <= 60; seed += 1) {
        const puzzle = generatePuzzle(index + 1, seeded(index * 4001 + seed));
        if (puzzle.monster) continue;
        calm += 1;
        expect(solve(puzzle).shortest?.length).toBeGreaterThanOrEqual(spec.minPulls);
      }
      expect(calm, `${index + 1}단계`).toBeGreaterThan(0);
    });
  });

  it('단계가 오를수록 아무렇게나 뽑아서 이길 확률이 낮아진다', () => {
    const averages = STAGES.map((_, index) => {
      const seeds = seedsOf(index + 1, SEEDS);
      let total = 0;
      for (let seed = 1; seed <= seeds; seed += 1) {
        total += winShare(solve(generatePuzzle(index + 1, seeded(index * 30011 + seed))));
      }
      return total / seeds;
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
      const runs = seedsOf(index + 1, 300);
      for (let seed = 1; seed <= runs; seed += 1) {
        if (generatePuzzle(index + 1, seeded(index * 50021 + seed)).monster) monsters += 1;
      }
      expect(monsters / runs, `${index + 1}단계`).toBeGreaterThanOrEqual(spec.monsterChance - 0.08);
      expect(monsters / runs, `${index + 1}단계`).toBeLessThanOrEqual(spec.monsterChance + 0.08);
    });
  }, SLOW);

  it('피할 판을 주면 그것과 다른 판이 나온다', () => {
    for (const stage of [1, 2, 4, 7, STAGES.length]) {
      for (let seed = 1; seed <= seedsOf(stage, 60); seed += 1) {
        const first = generatePuzzle(stage, seeded(seed));
        const second = generatePuzzle(stage, seeded(seed), first);
        expect(samePuzzle(first, second)).toBe(false);
        expect(fitsStage(stageSpec(stage), solve(second))).toBe(true);
      }
    }
  });

  it('끝내 못 만들었을 때 내는 판도 이길 수 있고 질 수도 있다', () => {
    const solution = solve(FALLBACK_PUZZLE);
    expect(solution.chance).toBeGreaterThan(0);
    expect(solution.chance).toBeLessThan(1);
    // 난수가 한 값만 내놓아서 맞는 판이 영영 나오지 않아도 멈추고 이 판을 낸다.
    expect(generatePuzzle(4, () => 0)).toBe(FALLBACK_PUZZLE);
  });
});

describe('시간과 점수', () => {
  /** 그 단계의 판이 PLAIN_PULLS보다 더 뽑아야 하는 횟수 */
  const extraPulls = (stage: number): number => Math.max(0, stageSpec(stage).minPulls - PLAIN_PULLS);
  /** 더 뽑아야 하는 만큼 얹어 준 시간을 뺀 것 */
  const plainSeconds = (stage: number): number => puzzleSeconds(stage) - EXTRA_PULL_SECONDS * extraPulls(stage);

  it('목숨은 세 개로 시작한다', () => {
    expect(START_HEARTS).toBe(3);
  });

  it('제한 시간은 15초에서 시작하고, 더 뽑아야 해서 얹어 준 시간을 빼면 단계마다 줄어든다', () => {
    expect(puzzleSeconds(1)).toBe(FIRST_SECONDS);
    expect(puzzleSeconds(0)).toBe(FIRST_SECONDS);
    for (let stage = 2; stage <= 60; stage += 1) {
      expect(plainSeconds(stage)).toBeLessThan(plainSeconds(stage - 1));
    }
  });

  it('줄어드는 폭은 갈수록 작아지고, 가장 짧은 시간 아래로는 내려가지 않는다', () => {
    for (let stage = 3; stage <= 60; stage += 1) {
      const step = plainSeconds(stage - 1) - plainSeconds(stage);
      const before = plainSeconds(stage - 2) - plainSeconds(stage - 1);
      expect(step).toBeLessThan(before);
      expect(step).toBeLessThan(1);
    }
    expect(plainSeconds(500)).toBeGreaterThanOrEqual(MIN_SECONDS);
    expect(plainSeconds(500)).toBeCloseTo(MIN_SECONDS, 3);
  });

  it('네 번보다 더 뽑아야 하는 단계는 더 뽑는 한 번마다 시간을 얹어 받는다', () => {
    expect(EXTRA_PULL_SECONDS).toBe(MIN_SECONDS / PLAIN_PULLS);
    const tall = STAGES.findIndex((spec) => spec.minPulls > PLAIN_PULLS) + 1;
    expect(tall).toBeGreaterThan(1);
    expect(extraPulls(tall - 1)).toBe(0);
    expect(plainSeconds(tall - 1)).toBe(puzzleSeconds(tall - 1));
    // 길게 풀어야 하는 판이 처음 나오는 단계는 바로 앞 단계보다 시간이 길다.
    expect(puzzleSeconds(tall)).toBeGreaterThan(puzzleSeconds(tall - 1));
    expect(puzzleSeconds(tall) - plainSeconds(tall)).toBeCloseTo(EXTRA_PULL_SECONDS * extraPulls(tall));
    // 단계가 아무리 올라도 뽑아야 하는 횟수만큼의 가장 짧은 시간은 남는다.
    expect(puzzleSeconds(500)).toBeCloseTo(MIN_SECONDS + EXTRA_PULL_SECONDS * extraPulls(500), 3);
  });

  it('한 번 뽑는 데 쓸 수 있는 시간은 단계마다 줄어든다: 얹어 준 시간이 판을 쉽게 만들지 않는다', () => {
    const perPull = (stage: number): number => puzzleSeconds(stage) / (PLAIN_PULLS + extraPulls(stage));
    for (let stage = 2; stage <= 60; stage += 1) {
      expect(perPull(stage), `${stage}단계`).toBeLessThan(perPull(stage - 1));
    }
    expect(perPull(500)).toBeCloseTo(MIN_SECONDS / PLAIN_PULLS, 3);
  });

  it('7단계에 11초 남짓, 여섯 번을 뽑는 8단계에 13초 남짓, 16단계에 11초쯤이다', () => {
    expect(puzzleSeconds(7)).toBeGreaterThan(11);
    expect(puzzleSeconds(7)).toBeLessThan(12);
    expect(puzzleSeconds(8)).toBeGreaterThan(13);
    expect(puzzleSeconds(8)).toBeLessThan(14);
    expect(puzzleSeconds(16)).toBeGreaterThan(10.4);
    expect(puzzleSeconds(16)).toBeLessThan(11.4);
  });

  it('기본 점수는 단계마다 늘다가 정해진 단계부터는 그대로다', () => {
    expect(stagePoints(1)).toBe(BASE_POINTS);
    expect(stagePoints(0)).toBe(BASE_POINTS);
    expect(stagePoints(2)).toBe(BASE_POINTS + STAGE_POINTS);
    for (let stage = 2; stage <= TOP_POINT_STAGE; stage += 1) {
      // 더 뽑아야 하는 판이 나오기 시작하는 단계에서는 그만큼 한꺼번에 더 는다.
      const longer = extraPulls(stage) - extraPulls(stage - 1);
      expect(stagePoints(stage) - stagePoints(stage - 1)).toBe(STAGE_POINTS + EXTRA_PULL_POINTS * longer);
    }
    expect(stagePoints(TOP_POINT_STAGE + 1)).toBe(stagePoints(TOP_POINT_STAGE));
    expect(stagePoints(999)).toBe(stagePoints(TOP_POINT_STAGE));
  });

  it('여섯 번을 뽑아야 하는 단계는 네 번을 뽑는 단계보다 기본 점수를 더 받는다', () => {
    const tall = STAGES.findIndex((spec) => spec.minPulls > PLAIN_PULLS) + 1;
    expect(stagePoints(tall)).toBe(
      BASE_POINTS + STAGE_POINTS * (tall - 1) + EXTRA_PULL_POINTS * (stageSpec(tall).minPulls - PLAIN_PULLS),
    );
    expect(stagePoints(tall) - stagePoints(tall - 1)).toBeGreaterThan(STAGE_POINTS);
    // 조건이 더 바뀌지 않는 단계에 이르기 전에 표가 끝나야, 그 뒤의 점수가 그대로라는 말이 맞다.
    expect(STAGES.length).toBeLessThanOrEqual(TOP_POINT_STAGE);
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
    expect(winPoints(9, 4)).toBeGreaterThan(winPoints(7, 4));
  });
});
