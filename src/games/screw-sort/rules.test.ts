import { describe, expect, it } from 'vitest';
import {
  betterCandidate,
  BOARD_COLS,
  BOARD_ROWS,
  BOX_POINTS,
  BOX_SIZE,
  boxFor,
  buildFromSpec,
  buildStage,
  canTake,
  carefulEase,
  carelessEase,
  cellAt,
  cellPosition,
  COLOR_COUNT,
  freeScrews,
  isFree,
  MAX_SCREWS,
  MIN_COLORS,
  OPEN_BOXES,
  plateRects,
  proposeFromSpec,
  proposeStage,
  replay,
  SCREW_POINTS,
  screwAt,
  solve,
  STAGE_BONUS,
  stageBonus,
  stageSpec,
  START_SCREWS,
  startStage,
  takeScrew,
  topPlateAt,
  TRAY_SIZE,
  type Bench,
  type Stage,
  type StageSpec,
  type TakeEvent,
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

/** 손으로 만든 단계. plates는 판마다 덮는 칸들(아래 판부터), screws는 [판, 칸, 색]이다. */
function stageOf(plates: number[][], screws: Array<[number, number, number]>, boxes: number[]): Stage {
  return {
    plates: plates.map((cells) => ({ cells })),
    screws: screws.map(([plate, cell, color]) => ({ plate, cell, color })),
    boxes,
    solution: [],
  };
}

/** 겹치지 않는 한 칸짜리 판마다 나사가 하나씩 박힌 단계. 모든 나사를 처음부터 풀 수 있다. */
function loose(colors: number[], boxes: number[]): Stage {
  return stageOf(
    colors.map((_, index) => [index]),
    colors.map((color, index) => [index, index, color]),
    boxes,
  );
}

interface Taken {
  bench: Bench;
  events: readonly TakeEvent[];
  closed: number;
  points: number;
}

/** 나사 하나를 풀고, 새 상태와 일어난 일을 돌려준다. 풀리지 않으면 테스트가 실패한다. */
function take(bench: Bench, screw: number): Taken {
  const step = takeScrew(bench, screw);
  if (step.outcome.kind !== 'taken') throw new Error(`${screw}번 나사가 풀리지 않았다: ${step.outcome.reason}`);
  const { events, closed, points } = step.outcome;
  return { bench: step.bench, events, closed, points };
}

/** 차례로 풀어 나간 뒤의 상태 */
function takeAll(bench: Bench, order: readonly number[]): Bench {
  return order.reduce((current, screw) => take(current, screw).bench, bench);
}

const c = cellAt;

/**
 * 가로 막대(판 0) 위에 세로 막대(판 1)가 오른쪽 끝을 덮고 있다.
 * 나사 0, 1은 아래 판의 양 끝에, 나사 2는 위 판의 아래쪽 끝에 박혀 있다. 나사 1은 위 판에 가려져 있다.
 */
const stacked = stageOf(
  [
    [c(0, 0), c(1, 0), c(2, 0)],
    [c(2, 0), c(2, 1)],
  ],
  [
    [0, c(0, 0), 0],
    [0, c(2, 0), 0],
    [1, c(2, 1), 1],
  ],
  [0, 1],
);

/**
 * 0색 판과 1색 판을 2색 나사 셋이 박힌 큰 판이 통째로 덮고 있다. 열린 상자는 0색과 1색이라서,
 * 2색 나사 셋을 모두 쟁반에 올려야 큰 판이 떨어지고 상자에 맞는 나사가 드러난다.
 */
const sandwichPlates = [
  [c(0, 0), c(1, 0), c(2, 0)],
  [c(0, 1), c(1, 1), c(2, 1)],
  [c(0, 0), c(1, 0), c(2, 0), c(0, 1), c(1, 1), c(2, 1)],
];
const sandwichScrews: Array<[number, number, number]> = [
  [0, c(0, 0), 0],
  [0, c(1, 0), 0],
  [0, c(2, 0), 0],
  [1, c(0, 1), 1],
  [1, c(1, 1), 1],
  [1, c(2, 1), 1],
  [2, c(0, 0), 2],
  [2, c(1, 1), 2],
  [2, c(2, 0), 2],
];
const sandwich = stageOf(sandwichPlates, sandwichScrews, [0, 1, 2]);

/** 위의 단계 옆에 3색 나사 셋이 박힌 판이 따로 놓여 있다. 2색(다음 상자)보다 3색을 먼저 풀면 쟁반이 넘친다. */
const trap = stageOf(
  [...sandwichPlates, [c(4, 0), c(5, 0), c(6, 0)]],
  [...sandwichScrews, [3, c(4, 0), 3], [3, c(5, 0), 3], [3, c(6, 0), 3]],
  [0, 1, 2, 3],
);

describe('칸과 판의 모양', () => {
  it('칸 번호와 열·줄은 서로 바꿀 수 있다', () => {
    for (let row = 0; row < BOARD_ROWS; row += 1) {
      for (let col = 0; col < BOARD_COLS; col += 1) {
        expect(cellPosition(cellAt(col, row))).toEqual({ col, row });
      }
    }
    expect(cellAt(BOARD_COLS - 1, BOARD_ROWS - 1)).toBe(BOARD_COLS * BOARD_ROWS - 1);
  });

  it('막대와 네모는 네모 하나로 그려진다', () => {
    const bar = plateRects({ cells: [c(1, 2), c(2, 2), c(3, 2)] });
    const post = plateRects({ cells: [c(4, 1), c(4, 2)] });
    const square = plateRects({ cells: [c(0, 0), c(1, 0), c(0, 1), c(1, 1)] });
    expect(bar).toEqual([{ col: 1, row: 2, cols: 3, rows: 1 }]);
    expect(post).toEqual([{ col: 4, row: 1, cols: 1, rows: 2 }]);
    expect(square).toEqual([{ col: 0, row: 0, cols: 2, rows: 2 }]);
  });

  it('ㄱ자는 가로 팔과 세로 팔, 두 네모로 그려진다', () => {
    const rects = plateRects({ cells: [c(2, 3), c(2, 4), c(2, 5), c(3, 5)] });
    expect(rects).toHaveLength(2);
    expect(rects).toContainEqual({ col: 2, row: 3, cols: 1, rows: 3 });
    expect(rects).toContainEqual({ col: 2, row: 5, cols: 2, rows: 1 });
  });

  it('네모들은 판의 칸을 빠짐없이 덮고 판 밖으로 나가지 않는다', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      for (const plate of proposeStage(8, seeded(seed)).stage.plates) {
        const covered = new Set<number>();
        for (const rect of plateRects(plate)) {
          for (let row = rect.row; row < rect.row + rect.rows; row += 1) {
            for (let col = rect.col; col < rect.col + rect.cols; col += 1) covered.add(cellAt(col, row));
          }
        }
        expect([...covered].sort((a, b) => a - b)).toEqual([...plate.cells].sort((a, b) => a - b));
      }
    }
  });
});

describe('가려진 나사', () => {
  it('더 위의 판이 덮은 칸의 나사는 풀 수 없다', () => {
    const bench = startStage(stacked);
    expect(isFree(bench, 0)).toBe(true);
    expect(isFree(bench, 1)).toBe(false);
    expect(isFree(bench, 2)).toBe(true);
    expect(freeScrews(bench)).toEqual([0, 2]);
  });

  it('칸마다 맨 위에 보이는 판을 안다', () => {
    const bench = startStage(stacked);
    expect(topPlateAt(bench, c(1, 0))).toBe(0);
    expect(topPlateAt(bench, c(2, 0))).toBe(1);
    expect(topPlateAt(bench, c(2, 1))).toBe(1);
    expect(topPlateAt(bench, c(5, 5))).toBe(-1);
    expect(topPlateAt(bench, -1)).toBe(-1);
  });

  it('칸을 누르면 맨 위 판의 나사만 잡힌다', () => {
    const bench = startStage(stacked);
    expect(screwAt(bench, c(0, 0))).toBe(0);
    expect(screwAt(bench, c(2, 1))).toBe(2);
    // 가려진 나사가 있는 칸, 나사가 없는 칸, 빈 칸
    expect(screwAt(bench, c(2, 0))).toBe(-1);
    expect(screwAt(bench, c(1, 0))).toBe(-1);
    expect(screwAt(bench, c(5, 5))).toBe(-1);
  });

  it('가려진 나사를 풀려고 하면 아무 일도 일어나지 않는다', () => {
    const bench = startStage(stacked);
    const step = takeScrew(bench, 1);
    expect(step.outcome).toEqual({ kind: 'refused', reason: 'covered' });
    expect(step.bench).toBe(bench);
    expect(canTake(bench, 1)).toBe(false);
  });

  it('없는 나사나 이미 푼 나사도 풀 수 없다', () => {
    const bench = startStage(stacked);
    expect(takeScrew(bench, -1).outcome.kind).toBe('refused');
    expect(takeScrew(bench, 99).outcome.kind).toBe('refused');
    const after = take(bench, 0).bench;
    expect(isFree(after, 0)).toBe(false);
    expect(takeScrew(after, 0).outcome).toEqual({ kind: 'refused', reason: 'covered' });
  });

  it('위 판의 마지막 나사를 풀면 판이 떨어지고 아래 나사가 드러난다', () => {
    const { bench, events } = take(startStage(stacked), 2);
    expect(events).toContainEqual({ kind: 'plate', plate: 1 });
    expect(topPlateAt(bench, c(2, 0))).toBe(0);
    expect(topPlateAt(bench, c(2, 1))).toBe(-1);
    expect(isFree(bench, 1)).toBe(true);
    expect(screwAt(bench, c(2, 0))).toBe(1);
  });

  it('나사가 하나라도 남은 판은 떨어지지 않고 계속 가린다', () => {
    // 위 판에 나사가 둘: 하나는 아래 판의 나사 바로 위 칸에 박혀 있다.
    const pinned = stageOf(
      stacked.plates.map((plate) => [...plate.cells]),
      [
        [0, c(0, 0), 0],
        [0, c(2, 0), 0],
        [1, c(2, 1), 1],
        [1, c(2, 0), 1],
      ],
      [0, 1],
    );
    const start = startStage(pinned);
    expect(screwAt(start, c(2, 0))).toBe(3);

    const first = take(start, 2);
    expect(first.events.some((event) => event.kind === 'plate')).toBe(false);
    expect(isFree(first.bench, 1)).toBe(false);
    expect(topPlateAt(first.bench, c(2, 1))).toBe(1);

    const second = take(first.bench, 3);
    expect(second.events).toContainEqual({ kind: 'plate', plate: 1 });
    expect(isFree(second.bench, 1)).toBe(true);
  });

  it('아래 판의 나사를 먼저 풀어도 위 판은 그대로다', () => {
    const { bench, events } = take(startStage(stacked), 0);
    expect(events.some((event) => event.kind === 'plate')).toBe(false);
    expect(isFree(bench, 1)).toBe(false);
    expect(freeScrews(bench)).toEqual([2]);
  });
});

describe('상자', () => {
  it('처음에는 상자 둘이 열리고 그다음 상자가 미리 보기다', () => {
    const bench = startStage(loose([0, 0, 0, 1, 1, 1, 2, 2, 2], [0, 1, 2]));
    expect(OPEN_BOXES).toBe(2);
    expect(bench.open).toEqual([
      { color: 0, count: 0 },
      { color: 1, count: 0 },
    ]);
    expect(bench.nextBox).toBe(2);
    expect(bench.tray).toEqual([]);
    expect(bench.status).toBe('playing');
  });

  it('상자가 하나뿐이면 나머지 자리는 비어 있다', () => {
    const bench = startStage(loose([0, 0, 0], [0]));
    expect(bench.open).toEqual([{ color: 0, count: 0 }, null]);
    expect(bench.nextBox).toBe(1);
  });

  it('같은 색 상자에 자리가 있을 때만 그 상자를 고른다', () => {
    expect(boxFor([{ color: 0, count: 1 }, { color: 1, count: 0 }], 1)).toBe(1);
    expect(boxFor([{ color: 0, count: 1 }, { color: 1, count: 0 }], 2)).toBe(-1);
    expect(boxFor([{ color: 0, count: BOX_SIZE }, null], 0)).toBe(-1);
    expect(boxFor([null, { color: 0, count: 0 }], 0)).toBe(1);
    expect(boxFor([null, null], 0)).toBe(-1);
  });

  it('같은 색 상자가 둘이면 더 많이 찬 쪽으로 간다', () => {
    expect(boxFor([{ color: 0, count: 1 }, { color: 0, count: 2 }], 0)).toBe(1);
    expect(boxFor([{ color: 0, count: 2 }, { color: 0, count: 1 }], 0)).toBe(0);
    expect(boxFor([{ color: 0, count: 1 }, { color: 0, count: 1 }], 0)).toBe(0);

    const start = startStage(loose([0, 0, 0, 0, 0, 0], [0, 0]));
    const first = take(start, 0);
    const second = take(first.bench, 1);
    expect(first.events[0]).toEqual({ kind: 'box', screw: 0, slot: 0, place: 0 });
    expect(second.events[0]).toEqual({ kind: 'box', screw: 1, slot: 0, place: 1 });
  });

  it('푼 나사는 같은 색 상자의 다음 자리로 간다', () => {
    const start = startStage(loose([0, 0, 0, 1, 1, 1, 2, 2, 2], [0, 1, 2]));
    const first = take(start, 3);
    expect(first.events).toEqual([
      { kind: 'box', screw: 3, slot: 1, place: 0 },
      { kind: 'plate', plate: 3 },
    ]);
    expect(first.closed).toBe(0);
    expect(first.bench.open[1]).toEqual({ color: 1, count: 1 });
    expect(first.bench.tray).toEqual([]);

    const second = take(first.bench, 4);
    expect(second.events[0]).toEqual({ kind: 'box', screw: 4, slot: 1, place: 1 });
  });

  it('셋이 차면 상자가 닫히고 다음 상자가 그 자리에 들어온다', () => {
    const start = startStage(loose([0, 0, 0, 1, 1, 1, 2, 2, 2], [0, 1, 2]));
    const { bench, events, closed } = take(takeAll(start, [0, 1]), 2);
    expect(events).toEqual([
      { kind: 'box', screw: 2, slot: 0, place: 2 },
      { kind: 'plate', plate: 2 },
      { kind: 'close', slot: 0, color: 0 },
      { kind: 'open', slot: 0, color: 2 },
    ]);
    expect(closed).toBe(1);
    expect(bench.open).toEqual([
      { color: 2, count: 0 },
      { color: 1, count: 0 },
    ]);
    expect(bench.nextBox).toBe(3);
  });

  it('더 나올 상자가 없으면 닫힌 자리는 빈 채로 남는다', () => {
    const start = startStage(loose([0, 0, 0, 1, 1, 1], [0, 1]));
    const { bench, events } = take(takeAll(start, [0, 1]), 2);
    expect(events.map((event) => event.kind)).toEqual(['box', 'plate', 'close']);
    expect(bench.open).toEqual([null, { color: 1, count: 0 }]);
    expect(bench.status).toBe('playing');
  });

  it('받은 상태는 바꾸지 않는다', () => {
    const start = startStage(loose([0, 0, 0, 1, 1, 1, 2, 2, 2], [0, 1, 2]));
    const snapshot = JSON.stringify(start);
    takeAll(start, [6, 0, 1, 2]);
    expect(JSON.stringify(start)).toBe(snapshot);
  });
});

describe('쟁반', () => {
  it('맞는 상자가 없는 나사는 쟁반에서 기다린다', () => {
    const start = startStage(loose([0, 0, 0, 1, 1, 1, 2, 2, 2], [0, 1, 2]));
    const first = take(start, 6);
    expect(first.events).toEqual([
      { kind: 'tray', screw: 6, place: 0 },
      { kind: 'plate', plate: 6 },
    ]);
    expect(first.bench.tray).toEqual([6]);
    const second = take(first.bench, 8);
    expect(second.events[0]).toEqual({ kind: 'tray', screw: 8, place: 1 });
    expect(second.bench.tray).toEqual([6, 8]);
  });

  it('새 상자가 들어오면 쟁반에서 그 색을 기다리던 나사가 곧바로 옮겨 간다', () => {
    const start = startStage(loose([0, 0, 0, 1, 1, 1, 2, 2, 2], [0, 1, 2]));
    const { bench, events } = take(takeAll(start, [6, 0, 1]), 2);
    expect(events.slice(2)).toEqual([
      { kind: 'close', slot: 0, color: 0 },
      { kind: 'open', slot: 0, color: 2 },
      { kind: 'fromTray', screw: 6, from: 0, slot: 0, place: 0 },
    ]);
    expect(bench.tray).toEqual([]);
    expect(bench.open[0]).toEqual({ color: 2, count: 1 });
  });

  it('쟁반에서는 들어온 순서대로 옮겨 가고, 다른 색은 남는다', () => {
    const start = startStage(loose([3, 2, 3, 2, 0, 0, 0, 1, 1, 1, 2, 3], [0, 1, 2, 3]));
    const { bench, events } = take(takeAll(start, [0, 1, 2, 3, 4, 5]), 6);
    // from은 옮기기 직전의 자리다: 1번 나사가 빠지면 3번 나사는 한 칸 당겨져 있다.
    expect(events.filter((event) => event.kind === 'fromTray')).toEqual([
      { kind: 'fromTray', screw: 1, from: 1, slot: 0, place: 0 },
      { kind: 'fromTray', screw: 3, from: 2, slot: 0, place: 1 },
    ]);
    expect(bench.tray).toEqual([0, 2]);
    expect(bench.open[0]).toEqual({ color: 2, count: 2 });
  });

  it('옮겨 간 나사로 상자가 또 차면 이어서 닫힌다', () => {
    const start = startStage(loose([2, 2, 2, 2, 2, 0, 0, 0, 1, 1, 1, 2], [0, 1, 2, 2]));
    const full = takeAll(start, [0, 1, 2, 3, 4, 5, 6]);
    expect(full.tray).toEqual([0, 1, 2, 3, 4]);

    const { bench, events, closed, points } = take(full, 7);
    expect(events).toEqual([
      { kind: 'box', screw: 7, slot: 0, place: 2 },
      { kind: 'plate', plate: 7 },
      { kind: 'close', slot: 0, color: 0 },
      { kind: 'open', slot: 0, color: 2 },
      { kind: 'fromTray', screw: 0, from: 0, slot: 0, place: 0 },
      { kind: 'fromTray', screw: 1, from: 0, slot: 0, place: 1 },
      { kind: 'fromTray', screw: 2, from: 0, slot: 0, place: 2 },
      { kind: 'close', slot: 0, color: 2 },
      { kind: 'open', slot: 0, color: 2 },
      { kind: 'fromTray', screw: 3, from: 0, slot: 0, place: 0 },
      { kind: 'fromTray', screw: 4, from: 0, slot: 0, place: 1 },
    ]);
    expect(closed).toBe(2);
    expect(points).toBe(SCREW_POINTS + 2 * BOX_POINTS);
    expect(bench.tray).toEqual([]);
    expect(bench.open[0]).toEqual({ color: 2, count: 2 });
    expect(bench.nextBox).toBe(4);
  });
});

describe('끝나는 규칙', () => {
  /** 0색, 1색 판을 2색 나사 여섯 개가 박힌 큰 판이 통째로 덮고 있다. 열린 상자는 0색과 1색이다. */
  const buried = stageOf(
    [
      [c(0, 0), c(1, 0), c(2, 0)],
      [c(0, 1), c(1, 1), c(2, 1)],
      [c(0, 0), c(1, 0), c(2, 0), c(0, 1), c(1, 1), c(2, 1)],
    ],
    [
      [0, c(0, 0), 0],
      [0, c(1, 0), 0],
      [0, c(2, 0), 0],
      [1, c(0, 1), 1],
      [1, c(1, 1), 1],
      [1, c(2, 1), 1],
      [2, c(0, 0), 2],
      [2, c(1, 0), 2],
      [2, c(2, 0), 2],
      [2, c(0, 1), 2],
      [2, c(1, 1), 2],
      [2, c(2, 1), 2],
    ],
    [0, 1, 2, 2],
  );

  it('쟁반에 한 자리라도 남아 있으면 끝나지 않는다', () => {
    const bench = takeAll(startStage(buried), [6, 7, 8, 9]);
    expect(bench.tray).toHaveLength(TRAY_SIZE - 1);
    expect(bench.status).toBe('playing');
    expect(canTake(bench, 10)).toBe(true);
  });

  it('쟁반이 가득 찼고 풀 수 있는 나사 가운데 상자로 갈 것이 없으면 끝난다', () => {
    const { bench } = take(takeAll(startStage(buried), [6, 7, 8, 9]), 10);
    expect(bench.tray).toHaveLength(TRAY_SIZE);
    expect(freeScrews(bench)).toEqual([11]);
    expect(bench.status).toBe('stuck');
  });

  it('끝난 뒤에는 어떤 나사도 풀리지 않는다', () => {
    const bench = takeAll(startStage(buried), [6, 7, 8, 9, 10]);
    expect(canTake(bench, 11)).toBe(false);
    const step = takeScrew(bench, 11);
    expect(step.outcome.kind).toBe('refused');
    expect(step.bench).toBe(bench);
  });

  it('쟁반이 가득 차도 상자로 갈 나사가 보이면 끝나지 않는다', () => {
    const start = startStage(loose([2, 2, 2, 2, 2, 0, 0, 0, 1, 1, 1, 2], [0, 1, 2, 2]));
    const bench = takeAll(start, [0, 1, 2, 3, 4]);
    expect(bench.tray).toHaveLength(TRAY_SIZE);
    expect(bench.status).toBe('playing');
  });

  it('쟁반이 가득 찬 동안에는 상자가 없는 나사가 풀리지 않는다', () => {
    const start = startStage(loose([2, 2, 2, 2, 2, 0, 0, 0, 1, 1, 1, 2], [0, 1, 2, 2]));
    const bench = takeAll(start, [0, 1, 2, 3, 4]);
    expect(canTake(bench, 11)).toBe(false);
    const step = takeScrew(bench, 11);
    expect(step.outcome).toEqual({ kind: 'refused', reason: 'trayFull' });
    expect(step.bench).toBe(bench);
    // 상자로 가는 나사는 풀린다.
    expect(canTake(bench, 5)).toBe(true);
    expect(take(bench, 5).events[0]).toEqual({ kind: 'box', screw: 5, slot: 0, place: 0 });
  });

  it('가득 찬 쟁반으로 버티다가 상자에 넣을 나사가 떨어지면 그때 끝난다', () => {
    const start = startStage(loose([2, 2, 2, 2, 2, 0, 2], [0, 1]));
    const full = takeAll(start, [0, 1, 2, 3, 4]);
    expect(full.status).toBe('playing');
    const { bench } = take(full, 5);
    expect(bench.tray).toHaveLength(TRAY_SIZE);
    expect(bench.status).toBe('stuck');
  });

  it('상자가 닫히며 쟁반이 비워지면 다시 아무 나사나 풀 수 있다', () => {
    const start = startStage(loose([2, 2, 2, 2, 2, 0, 0, 0, 1, 1, 1, 2], [0, 1, 2, 2]));
    const bench = takeAll(start, [0, 1, 2, 3, 4, 5, 6, 7]);
    expect(bench.tray).toEqual([]);
    expect(bench.status).toBe('playing');
    expect(canTake(bench, 11)).toBe(true);
  });

  it('나사를 모두 풀면 단계를 깬 것이다', () => {
    const start = startStage(loose([2, 2, 2, 2, 2, 0, 0, 0, 1, 1, 1, 2], [0, 1, 2, 2]));
    const bench = takeAll(start, [0, 1, 2, 3, 4, 5, 6, 7, 11, 8, 9, 10]);
    expect(bench.status).toBe('cleared');
    expect(bench.tray).toEqual([]);
    expect(bench.open).toEqual([null, null]);
    expect(takeScrew(bench, 0).outcome.kind).toBe('refused');
  });

  it('나사가 없는 단계는 처음부터 깬 것이다', () => {
    expect(startStage(stageOf([], [], [])).status).toBe('cleared');
  });
});

describe('풀어 보기', () => {
  it('맞는 순서로 풀면 깨고, 쟁반에 가장 많이 쌓였던 수를 알려 준다', () => {
    const stage = loose([0, 0, 0, 1, 1, 1, 2, 2, 2], [0, 1, 2]);
    expect(replay(stage, [0, 1, 2, 3, 4, 5, 6, 7, 8])).toEqual({ solved: true, peakTray: 0, taken: 9 });
    expect(replay(stage, [6, 7, 0, 1, 2, 8, 3, 4, 5])).toEqual({ solved: true, peakTray: 2, taken: 9 });
  });

  it('가려진 나사를 만나면 거기서 멈춘다', () => {
    expect(replay(stacked, [0, 1, 2])).toEqual({ solved: false, peakTray: 0, taken: 1 });
    expect(replay(stacked, [2, 1, 0]).solved).toBe(true);
  });

  it('다 풀지 않으면 깬 것이 아니다', () => {
    expect(replay(stacked, [2, 1])).toEqual({ solved: false, peakTray: 0, taken: 2 });
  });

  it('쟁반이 넘치는 순서는 중간에 멈춘다', () => {
    const stage = loose([2, 2, 2, 2, 2, 2, 0, 0, 0, 1, 1, 1], [0, 1, 2, 2]);
    const result = replay(stage, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(result).toEqual({ solved: false, peakTray: TRAY_SIZE, taken: TRAY_SIZE });
  });
});

describe('풀이 찾기', () => {
  it('쟁반 한도 안에서 깨는 순서를 찾는다', () => {
    const stage = loose([2, 2, 2, 0, 0, 0, 1, 1, 1], [0, 1, 2]);
    const found = solve(stage, 0);
    expect(found).not.toBeNull();
    expect(replay(stage, found ?? [])).toEqual({ solved: true, peakTray: 0, taken: 9 });
  });

  it('가려진 순서를 지켜서 푼다', () => {
    const found = solve(stacked, 0);
    expect(found).toHaveLength(3);
    expect(replay(stacked, found ?? []).solved).toBe(true);
  });

  it('쟁반 한도 안에서 풀 수 없으면 null이다', () => {
    // 2색 나사 셋을 쟁반에 올려야만 풀리는 단계
    expect(solve(sandwich, 2)).toBeNull();
    const found = solve(sandwich, 3);
    expect(found).not.toBeNull();
    expect(replay(sandwich, found ?? [])).toEqual({ solved: true, peakTray: 3, taken: 9 });
  });

  it('살펴볼 수 있는 상태 수가 모자라면 포기한다', () => {
    const stage = loose([2, 2, 2, 0, 0, 0, 1, 1, 1], [0, 1, 2]);
    expect(solve(stage, TRAY_SIZE, 3)).toBeNull();
    expect(solve(stage, TRAY_SIZE, 100)).not.toBeNull();
  });
});

describe('점수', () => {
  it('나사 하나마다 점수를 받고, 상자를 닫으면 더 받는다', () => {
    const start = startStage(loose([0, 0, 0, 1, 1, 1], [0, 1]));
    const first = take(start, 0);
    expect(first.points).toBe(SCREW_POINTS);
    const third = take(takeAll(first.bench, [1]), 2);
    expect(third.points).toBe(SCREW_POINTS + BOX_POINTS);
    // 쟁반으로 간 나사도 푼 것이다.
    expect(take(startStage(loose([2, 0, 0, 0, 1, 1, 1, 2, 2], [0, 1, 2])), 0).points).toBe(SCREW_POINTS);
  });

  it('단계 보너스는 뒤 단계일수록 크다', () => {
    expect(stageBonus(1)).toBe(STAGE_BONUS);
    for (let stage = 1; stage < 30; stage += 1) {
      expect(stageBonus(stage + 1)).toBeGreaterThan(stageBonus(stage));
      expect(Number.isInteger(stageBonus(stage))).toBe(true);
    }
    expect(stageBonus(0)).toBe(STAGE_BONUS);
    expect(stageBonus(2.9)).toBe(stageBonus(2));
  });

  it('단계 하나를 깨면 나사 수와 상자 수만큼 받는다', () => {
    for (const level of [1, 5, 9]) {
      const stage = buildStage(level, seeded(level));
      let bench = startStage(stage);
      let points = 0;
      for (const screw of stage.solution) {
        const step = take(bench, screw);
        bench = step.bench;
        points += step.points;
      }
      expect(points).toBe(stage.screws.length * SCREW_POINTS + stage.boxes.length * BOX_POINTS);
    }
  });
});

describe('난이도', () => {
  const specs = Array.from({ length: 40 }, (_, index) => stageSpec(index + 1));

  it('첫 단계는 나사 아홉 개와 세 가지 색으로 시작한다', () => {
    expect(specs[0].screws).toBe(START_SCREWS);
    expect(specs[0].colors).toBe(MIN_COLORS);
    expect(stageSpec(0)).toEqual(specs[0]);
    expect(stageSpec(-3)).toEqual(specs[0]);
    expect(stageSpec(1.7)).toEqual(specs[0]);
  });

  it('나사 수는 언제나 셋의 배수이고 상한까지 늘어난다', () => {
    for (const spec of specs) {
      expect(spec.screws % BOX_SIZE).toBe(0);
      expect(spec.screws).toBeLessThanOrEqual(MAX_SCREWS);
      expect(spec.colors).toBeLessThanOrEqual(COLOR_COUNT);
      // 색마다 상자가 하나는 있어야 한다.
      expect(spec.colors).toBeLessThanOrEqual(spec.screws / BOX_SIZE);
    }
    expect(specs[specs.length - 1].screws).toBe(MAX_SCREWS);
    expect(specs[specs.length - 1].colors).toBe(COLOR_COUNT);
  });

  it('뒤 단계로 갈수록 어느 값도 쉬워지지 않는다', () => {
    const harder: Array<keyof StageSpec> = [
      'screws',
      'colors',
      'cols',
      'rows',
      'cover',
      'hideLimit',
      'stack',
      'mixTries',
      'mixReach',
      'trayBudget',
    ];
    const easier: Array<keyof StageSpec> = ['carefulFloor', 'carelessTarget'];
    for (let index = 1; index < specs.length; index += 1) {
      for (const key of harder) expect(specs[index][key]).toBeGreaterThanOrEqual(specs[index - 1][key]);
      for (const key of easier) expect(specs[index][key]).toBeLessThanOrEqual(specs[index - 1][key]);
    }
    expect(specs[9].screws).toBeGreaterThan(specs[0].screws);
    expect(specs[9].cover).toBeGreaterThan(specs[0].cover);
    expect(specs[9].mixTries).toBeGreaterThan(specs[0].mixTries);
    expect(specs[9].carelessTarget).toBeLessThan(specs[0].carelessTarget);
  });

  it('값들이 정해진 범위를 벗어나지 않는다', () => {
    for (const spec of specs) {
      expect(spec.cols).toBeLessThanOrEqual(BOARD_COLS);
      expect(spec.rows).toBeLessThanOrEqual(BOARD_ROWS);
      expect(spec.cover).toBeGreaterThan(0);
      expect(spec.cover).toBeLessThanOrEqual(1);
      // 찾아 둔 풀이는 쟁반에 언제나 한 자리 이상을 남긴다.
      expect(spec.trayBudget).toBeGreaterThanOrEqual(1);
      expect(spec.trayBudget).toBeLessThanOrEqual(TRAY_SIZE - 1);
      expect(spec.carefulFloor).toBeGreaterThan(0);
      expect(spec.carefulFloor).toBeLessThanOrEqual(1);
      expect(spec.carelessTarget).toBeGreaterThanOrEqual(0);
      expect(spec.carelessTarget).toBeLessThanOrEqual(1);
    }
  });
});

/** 만든 단계가 지켜야 할 것들을 한꺼번에 확인한다. */
function expectSound(stage: Stage, spec: StageSpec): void {
  const { plates, screws, boxes, solution } = stage;

  // 나사 수와 색: 색마다 셋의 배수이고, 그 색의 상자 수와 맞는다.
  expect(screws).toHaveLength(spec.screws);
  expect(boxes).toHaveLength(spec.screws / BOX_SIZE);
  const perColor = new Map<number, number>();
  for (const screw of screws) perColor.set(screw.color, (perColor.get(screw.color) ?? 0) + 1);
  expect(perColor.size).toBeLessThanOrEqual(spec.colors);
  for (const [color, count] of perColor) {
    expect(color).toBeGreaterThanOrEqual(0);
    expect(color).toBeLessThan(COLOR_COUNT);
    expect(count).toBe(BOX_SIZE * boxes.filter((box) => box === color).length);
  }

  // 판: 정해진 범위 안에 놓이고, 한 칸에 너무 많이 쌓이지 않는다.
  const left = Math.floor((BOARD_COLS - spec.cols) / 2);
  const up = Math.floor((BOARD_ROWS - spec.rows) / 2);
  const stack = new Map<number, number>();
  for (const plate of plates) {
    expect(new Set(plate.cells).size).toBe(plate.cells.length);
    for (const cell of plate.cells) {
      const { col, row } = cellPosition(cell);
      expect(col).toBeGreaterThanOrEqual(left);
      expect(col).toBeLessThan(left + spec.cols);
      expect(row).toBeGreaterThanOrEqual(up);
      expect(row).toBeLessThan(up + spec.rows);
      stack.set(cell, (stack.get(cell) ?? 0) + 1);
    }
  }
  expect(Math.max(...stack.values())).toBeLessThanOrEqual(spec.stack);

  // 나사: 제 판의 칸에 박혀 있고, 한 판의 같은 칸에 둘이 박히지 않으며, 판마다 둘 이상이다.
  const spots = new Set<string>();
  const perPlate = plates.map(() => 0);
  for (const screw of screws) {
    expect(plates[screw.plate].cells).toContain(screw.cell);
    spots.add(`${screw.plate}:${screw.cell}`);
    perPlate[screw.plate] += 1;
  }
  expect(spots.size).toBe(screws.length);
  expect(Math.min(...perPlate)).toBeGreaterThanOrEqual(2);

  // 처음부터 모든 판이 조금은 보이고, 풀 수 있는 나사들은 서로 다른 칸에 있다.
  const start = startStage(stage);
  const showing = new Set<number>();
  for (let cell = 0; cell < BOARD_COLS * BOARD_ROWS; cell += 1) showing.add(topPlateAt(start, cell));
  for (let plate = 0; plate < plates.length; plate += 1) expect(showing).toContain(plate);
  const free = freeScrews(start);
  expect(free.length).toBeGreaterThan(0);
  expect(new Set(free.map((screw) => screws[screw].cell)).size).toBe(free.length);

  // 찾아 둔 풀이: 모든 나사를 한 번씩 풀고, 쟁반 예산을 넘지 않으며, 끝나면 쟁반과 상자가 모두 비어 있다.
  expect([...solution].sort((a, b) => a - b)).toEqual(screws.map((_, id) => id));
  const result = replay(stage, solution);
  expect(result.solved).toBe(true);
  expect(result.peakTray).toBeLessThanOrEqual(spec.trayBudget);
  expect(result.peakTray).toBeLessThan(TRAY_SIZE);
  const end = takeAll(start, solution);
  expect(end.tray).toEqual([]);
  expect(end.open).toEqual([null, null]);
  expect(end.nextBox).toBe(boxes.length);
}

describe('단계 만들기', () => {
  it('어느 단계의 어느 후보든 쟁반 예산 안에서 반드시 풀린다', () => {
    for (let level = 1; level <= 16; level += 1) {
      for (let seed = 1; seed <= 25; seed += 1) {
        expectSound(proposeStage(level, seeded(seed * 101 + level)).stage, stageSpec(level));
      }
    }
  }, 60_000);

  it('골라서 내는 단계도 반드시 풀린다', () => {
    for (const level of [1, 2, 3, 4, 6, 8, 11, 20]) {
      for (let seed = 1; seed <= 6; seed += 1) {
        expectSound(buildStage(level, seeded(seed * 7 + level)), stageSpec(level));
      }
    }
  }, 60_000);

  it('시드가 같으면 같은 단계가 나온다', () => {
    expect(buildStage(5, seeded(42))).toEqual(buildStage(5, seeded(42)));
    expect(buildStage(5, seeded(42))).not.toEqual(buildStage(5, seeded(43)));
  });

  it('첫 단계는 작업대 아래 두 줄을 비워 둔다', () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const stage = buildStage(1, seeded(seed));
      for (const plate of stage.plates) {
        for (const cell of plate.cells) expect(cellPosition(cell).row).toBeLessThan(BOARD_ROWS - 2);
      }
    }
  });

  it('뒤 단계일수록 판이 많고 가려진 나사가 많다', () => {
    const survey = (level: number): { plates: number; hidden: number } => {
      let plates = 0;
      let hidden = 0;
      for (let seed = 1; seed <= 12; seed += 1) {
        const stage = proposeStage(level, seeded(seed * 13 + level)).stage;
        plates += stage.plates.length;
        hidden += stage.screws.length - freeScrews(startStage(stage)).length;
      }
      return { plates, hidden };
    };
    const early = survey(1);
    const middle = survey(4);
    const late = survey(8);
    expect(middle.plates).toBeGreaterThan(early.plates);
    expect(late.plates).toBeGreaterThan(middle.plates);
    expect(middle.hidden).toBeGreaterThan(early.hidden);
    expect(late.hidden).toBeGreaterThan(middle.hidden);
  });

  it('뒤 단계일수록 덤벙대며 풀어서는 깨기 어렵다', () => {
    const ease = (level: number): number => {
      let sum = 0;
      for (let seed = 1; seed <= 8; seed += 1) {
        sum += carelessEase(buildStage(level, seeded(seed * 19 + level)), seeded(seed), 12);
      }
      return sum / 8;
    };
    const early = ease(1);
    const late = ease(9);
    expect(early).toBeGreaterThan(0.9);
    expect(late).toBeLessThan(early - 0.2);
  }, 60_000);

  it('꼼꼼하게 풀면 뒤 단계도 덤벙댈 때보다 잘 깬다', () => {
    let careful = 0;
    let careless = 0;
    for (let seed = 1; seed <= 8; seed += 1) {
      const stage = buildStage(9, seeded(seed * 23));
      careful += carefulEase(stage, seeded(seed), 12);
      careless += carelessEase(stage, seeded(seed), 12);
    }
    expect(careful).toBeGreaterThan(careless);
  }, 60_000);
});

describe('후보 고르기', () => {
  it('깰 확률의 어림값은 0과 1 사이다', () => {
    for (let seed = 1; seed <= 6; seed += 1) {
      const stage = proposeStage(7, seeded(seed)).stage;
      for (const ease of [carefulEase(stage, seeded(seed)), carelessEase(stage, seeded(seed))]) {
        expect(ease).toBeGreaterThanOrEqual(0);
        expect(ease).toBeLessThanOrEqual(1);
      }
    }
  });

  it('함정이 없는 단계는 어떻게 풀어도 깬다', () => {
    const stage = loose([0, 0, 0, 1, 1, 1], [0, 1]);
    expect(carefulEase(stage, seeded(1))).toBe(1);
    expect(carelessEase(stage, seeded(1))).toBe(1);
  });

  it('꼼꼼한 사람은 곧 나올 상자의 색부터 풀어서 덤벙대는 사람보다 잘 깬다', () => {
    // 2색부터 풀면 반드시 깨지만, 보이는 대로 아무거나 풀면 절반쯤은 쟁반이 먼저 가득 찬다.
    expect(carefulEase(trap, seeded(5), 40)).toBe(1);
    const careless = carelessEase(trap, seeded(5), 40);
    expect(careless).toBeGreaterThan(0.2);
    expect(careless).toBeLessThan(0.8);
  });

  it('더 잘 맞는 후보를 고르고, 비기면 먼저 것을 둔다', () => {
    const stage = loose([0, 0, 0], [0]);
    const good = { stage, fit: -0.1 };
    const bad = { stage, fit: -0.6 };
    const tie = { stage, fit: -0.1 };
    expect(betterCandidate(null, bad)).toBe(bad);
    expect(betterCandidate(bad, good)).toBe(good);
    expect(betterCandidate(good, bad)).toBe(good);
    expect(betterCandidate(good, tie)).toBe(good);
  });

  it('후보의 맞음새는 0을 넘지 않는다', () => {
    for (let level = 1; level <= 12; level += 1) {
      const candidate = proposeStage(level, seeded(level * 3));
      expect(candidate.fit).toBeLessThanOrEqual(0);
      expect(candidate.fit).toBeGreaterThanOrEqual(-3);
    }
  });

  it('후보를 하나만 만들면 그 후보가 그대로 나온다', () => {
    const spec = stageSpec(6);
    expect(buildFromSpec(spec, seeded(9), 1)).toEqual(proposeFromSpec(spec, seeded(9)).stage);
  });
});
