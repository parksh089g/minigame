import { describe, expect, it } from 'vitest';
import {
  bestSolution,
  canPour,
  clearBonus,
  colorsFor,
  dealStage,
  EMPTY_TUBES,
  fallbackTubes,
  isComplete,
  isSolved,
  isStuck,
  legalMoves,
  MAX_COLORS,
  MIN_COLORS,
  pour,
  pourBudget,
  slackFor,
  solve,
  topRun,
  TUBE_CAPACITY,
  type Move,
  type Tubes,
} from './rules';

/** 씨앗이 같으면 같은 수가 차례로 나오는 난수 */
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

function replay(tubes: Tubes, moves: readonly Move[]): Tubes {
  let current = tubes;
  for (const move of moves) {
    const result = pour(current, move.from, move.to);
    expect(result).not.toBeNull();
    current = result!.tubes;
  }
  return current;
}

describe('병', () => {
  it('맨 위에 같은 색으로 이어진 덩어리를 센다', () => {
    expect(topRun([])).toBeNull();
    expect(topRun([1])).toEqual({ color: 1, count: 1 });
    expect(topRun([0, 2, 2])).toEqual({ color: 2, count: 2 });
    expect(topRun([2, 0, 2, 2])).toEqual({ color: 2, count: 2 });
    expect(topRun([3, 3, 3, 3])).toEqual({ color: 3, count: 4 });
  });

  it('한 색으로 가득 차야 다 된 병이다', () => {
    expect(isComplete([1, 1, 1, 1])).toBe(true);
    expect(isComplete([1, 1, 1])).toBe(false);
    expect(isComplete([1, 1, 1, 2])).toBe(false);
    expect(isComplete([])).toBe(false);
  });

  it('모든 병이 비었거나 다 되었으면 끝난 것이다', () => {
    expect(isSolved([[0, 0, 0, 0], [], [1, 1, 1, 1], []])).toBe(true);
    expect(isSolved([[0, 0, 0, 0], [1], [1, 1, 1], []])).toBe(false);
  });
});

describe('붓기', () => {
  const tubes: Tubes = [[0, 1, 1], [2, 1], [], [2, 2, 0, 0], [0, 1, 2, 2]];

  it('빈 병이나 맨 위 색이 같은 병에만 부을 수 있다', () => {
    expect(canPour(tubes, 0, 1)).toBe(true);
    expect(canPour(tubes, 0, 2)).toBe(true);
    expect(canPour(tubes, 1, 0)).toBe(true);
    expect(canPour(tubes, 0, 3)).toBe(false);
    expect(canPour(tubes, 2, 0)).toBe(false);
    expect(canPour(tubes, 0, 0)).toBe(false);
  });

  it('가득 찬 병에는 색이 같아도 부을 수 없다', () => {
    expect(canPour(tubes, 3, 4)).toBe(false);
    expect(canPour([[2], [0, 1, 2, 2]], 0, 1)).toBe(false);
  });

  it('없는 병은 고를 수 없다', () => {
    expect(canPour(tubes, -1, 0)).toBe(false);
    expect(canPour(tubes, 0, 9)).toBe(false);
    expect(pour(tubes, 0, 9)).toBeNull();
  });

  it('맨 위 덩어리가 통째로 옮겨 간다', () => {
    const result = pour(tubes, 0, 1)!;
    expect(result.moved).toBe(2);
    expect(result.color).toBe(1);
    expect(result.tubes[0]).toEqual([0]);
    expect(result.tubes[1]).toEqual([2, 1, 1, 1]);
    expect(result.completed).toBe(false);
  });

  it('자리가 모자라면 들어가는 만큼만 옮긴다', () => {
    const result = pour([[1, 1, 1], [0, 0, 1]], 0, 1)!;
    expect(result.moved).toBe(1);
    expect(result.tubes[0]).toEqual([1, 1]);
    expect(result.tubes[1]).toEqual([0, 0, 1, 1]);
  });

  it('한 색으로 가득 채우면 알려 준다', () => {
    const result = pour([[2, 0, 0], [0, 0]], 0, 1)!;
    expect(result.completed).toBe(true);
    expect(result.tubes[1]).toEqual([0, 0, 0, 0]);
  });

  it('원본은 바뀌지 않는다', () => {
    const before = JSON.stringify(tubes);
    pour(tubes, 0, 1);
    expect(JSON.stringify(tubes)).toBe(before);
  });

  it('부을 곳이 하나도 없으면 막힌 것이다', () => {
    const jammed: Tubes = [
      [0, 1, 0, 1],
      [1, 0, 1, 0],
    ];
    expect(legalMoves(jammed)).toEqual([]);
    expect(isStuck(jammed)).toBe(true);
    expect(isStuck([[0, 0, 0, 0], []])).toBe(false);
    expect(isStuck([[0, 1, 0, 1], [1, 0, 1, 0], []])).toBe(false);
  });
});

describe('단계', () => {
  it('색은 3색에서 시작해 조금씩 늘고 상한을 넘지 않는다', () => {
    expect(colorsFor(0)).toBe(MIN_COLORS);
    for (let stage = 1; stage < 40; stage += 1) {
      expect(colorsFor(stage)).toBeGreaterThanOrEqual(colorsFor(stage - 1));
      expect(colorsFor(stage) - colorsFor(stage - 1)).toBeLessThanOrEqual(1);
      expect(colorsFor(stage)).toBeLessThanOrEqual(MAX_COLORS);
    }
    expect(colorsFor(39)).toBe(MAX_COLORS);
  });

  it('여유는 줄어들기만 하고 바닥이 있다', () => {
    for (let stage = 1; stage < 40; stage += 1) {
      expect(slackFor(stage)).toBeLessThanOrEqual(slackFor(stage - 1));
      expect(slackFor(stage)).toBeGreaterThanOrEqual(2);
    }
    expect(pourBudget(10, 0)).toBe(10 + slackFor(0));
  });

  it('단계를 깬 보너스는 갈수록 커진다', () => {
    for (let stage = 1; stage < 20; stage += 1) {
      expect(clearBonus(stage)).toBeGreaterThan(clearBonus(stage - 1));
    }
  });
});

describe('풀이 찾기', () => {
  it('찾은 풀이대로 부으면 다 나뉜다', () => {
    const tubes: Tubes = [[0, 1, 0, 1], [1, 0, 1, 0], [], []];
    const moves = solve(tubes, seeded(1));
    expect(moves).not.toBeNull();
    expect(isSolved(replay(tubes, moves!))).toBe(true);
  });

  it('풀 수 없는 배치는 null', () => {
    const jammed: Tubes = [
      [0, 1, 0, 1],
      [1, 0, 1, 0],
    ];
    expect(solve(jammed, seeded(1))).toBeNull();
    expect(bestSolution(jammed, seeded(1))).toBeNull();
  });

  it('이미 다 나뉜 배치의 풀이는 빈 목록', () => {
    expect(solve([[0, 0, 0, 0], []], seeded(1))).toEqual([]);
  });

  it('쉬운 예비 배치는 색 수가 몇이든 풀린다', () => {
    for (let colors = MIN_COLORS; colors <= MAX_COLORS; colors += 1) {
      const tubes = fallbackTubes(colors);
      const moves = bestSolution(tubes, seeded(colors));
      expect(moves).not.toBeNull();
      expect(isSolved(replay(tubes, moves!))).toBe(true);
    }
  });
});

describe('단계 만들기', () => {
  it('색마다 네 칸씩이고 빈 병이 둘이다', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      for (const stage of [0, 1, 3, 5, 8]) {
        const dealt = dealStage(stage, seeded(seed * 31 + stage));
        expect(dealt.colors).toBe(colorsFor(stage));
        expect(dealt.tubes).toHaveLength(dealt.colors + EMPTY_TUBES);
        const counts = new Map<number, number>();
        for (const tube of dealt.tubes) {
          expect(tube.length).toBeLessThanOrEqual(TUBE_CAPACITY);
          for (const color of tube) counts.set(color, (counts.get(color) ?? 0) + 1);
        }
        expect(counts.size).toBe(dealt.colors);
        for (const count of counts.values()) expect(count).toBe(TUBE_CAPACITY);
        expect(dealt.tubes.filter((tube) => tube.length === 0)).toHaveLength(EMPTY_TUBES);
      }
    }
  });

  it('언제나 풀 수 있고, 적어 둔 횟수 안에 풀린다', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      for (const stage of [0, 2, 4, 6, 9]) {
        const dealt = dealStage(stage, seeded(seed * 17 + stage));
        expect(isSolved(dealt.tubes)).toBe(false);
        expect(dealt.par).toBe(dealt.solution.length);
        expect(dealt.par).toBeGreaterThan(0);
        expect(isSolved(replay(dealt.tubes, dealt.solution))).toBe(true);
        expect(pourBudget(dealt.par, stage)).toBeGreaterThan(dealt.par);
      }
    }
  });

  it('처음부터 다 된 병은 없다', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const dealt = dealStage(0, seeded(seed));
      expect(dealt.tubes.some(isComplete)).toBe(false);
    }
  });

  it('씨앗이 같으면 같은 단계가 나온다', () => {
    const a = dealStage(4, seeded(99));
    const b = dealStage(4, seeded(99));
    expect(a).toEqual(b);
  });
});
