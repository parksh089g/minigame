import { describe, expect, it } from 'vitest';
import { seededRandom, STAGE_LEVELS } from '../../core/stages';
import { GUIDED_LEVELS, LEVEL_CODES, levelPuzzle, levelRun, parseLevel } from './levels';
import { GAME_WIDTH } from '../../config';
import {
  boardLayout,
  formatPuzzle,
  generatePuzzle,
  isSolved,
  MAX_INNER_COLS,
  MAX_INNER_ROWS,
  minPushes,
  placedCount,
  type Made,
  type PuzzlePlan,
} from './rules';

/**
 * 단계 모드의 표를 만드는 기준. 상자 수마다 한 묶음이고, 묶음 안에서는 단계가 오를수록
 * 풀이에서 상자를 한 줄로 미는 토막(lines)이 많은 판을 고른다.
 */
interface LevelClass {
  /** 이 묶음의 단계 수 */
  levels: number;
  /** 노리는 토막의 수: [묶음의 첫 단계, 마지막 단계] */
  lines: readonly [number, number];
  plan: PuzzlePlan;
}

const CLASSES: readonly LevelClass[] = [
  { levels: 3, lines: [1, 3], plan: { innerCols: 4, innerRows: 4, pieces: [1, 4], boxes: 1, par: [1, 99], limit: 20_000, clean: true } },
  { levels: 15, lines: [3, 10], plan: { innerCols: 5, innerRows: 5, pieces: [3, 7], boxes: 2, par: [3, 99], limit: 50_000, clean: true } },
  { levels: 27, lines: [6, 17], plan: { innerCols: 6, innerRows: 6, pieces: [5, 11], boxes: 3, par: [5, 99], limit: 100_000 } },
  { levels: 33, lines: [10, 24], plan: { innerCols: 6, innerRows: 7, pieces: [6, 13], boxes: 4, par: [8, 99], limit: 300_000 } },
  { levels: 22, lines: [14, 28], plan: { innerCols: 6, innerRows: 7, pieces: [6, 13], boxes: 5, par: [10, 99], limit: 500_000 } },
];

/** 묶음마다 만들어 보는 판의 수 */
const POOL = 4000;

/** 너무 좁은 방은 고르지 않는다: 안쪽이 가로세로 세 칸은 되어야 하고, 상자 하나에 바닥이 네 칸은 있어야 한다. */
function isRoomy(made: Made): boolean {
  const { cols, rows, walls, boxes } = made.puzzle;
  const floor = walls.filter((wall) => !wall).length;
  return cols - 2 >= 3 && rows - 2 >= 3 && floor >= 4 + boxes.length * 4;
}

/**
 * 표를 처음부터 다시 만든다. 묶음마다 판을 POOL개 만들고, 단계마다 노리는 토막의 수에 가장 가까운 판을 고른다.
 * 똑같이 가까우면 먼저 만든 판을 쓴다(방의 크기와 생김새가 고루 섞인다).
 * 한 번 고른 판과 똑같이 생긴 판은 다시 고르지 않는다.
 */
function pickLevels(): string[] {
  const table: string[] = [];
  const used = new Set<string>();
  for (const group of CLASSES) {
    const random = seededRandom(`box-push:levels:${group.plan.boxes}`);
    const pool: Made[] = [];
    for (let made = 0; made < POOL; made += 1) pool.push(generatePuzzle(group.plan, random));
    const roomy = pool.filter(isRoomy);
    for (let turn = 0; turn < group.levels; turn += 1) {
      const [from, to] = group.lines;
      const wanted = group.levels > 1 ? from + ((to - from) * turn) / (group.levels - 1) : from;
      let best: Made | null = null;
      for (const made of roomy) {
        if (used.has(formatPuzzle(made.puzzle))) continue;
        if (best === null || Math.abs(made.lines - wanted) < Math.abs(best.lines - wanted)) best = made;
      }
      if (!best) throw new Error('고를 판이 모자란다');
      used.add(formatPuzzle(best.puzzle));
      table.push(`${best.puzzle.par} ${formatPuzzle(best.puzzle)}`);
    }
  }
  return table;
}

describe.skipIf(!process.env.BAKE)('상자 밀기의 단계 표 만들기', () => {
  it('적어 둔 표가 지금의 기준으로 만든 표와 같다', () => {
    const table = pickLevels();
    if (table.join('\n') !== LEVEL_CODES.join('\n')) {
      console.log(`새 표:\n${table.map((entry) => `  '${entry}',`).join('\n')}`);
    }
    expect(table).toEqual([...LEVEL_CODES]);
  }, 1_800_000);
});

/** 단계 묶음의 첫 단계 번호들: [상자 수, 첫 단계, 마지막 단계] */
function classRanges(): [boxes: number, first: number, last: number][] {
  let next = 1;
  return CLASSES.map((group) => {
    const first = next;
    next += group.levels;
    return [group.plan.boxes, first, next - 1];
  });
}

describe('상자 밀기의 단계 표', () => {
  const puzzles = LEVEL_CODES.map((entry) => parseLevel(entry));

  it('100단계가 모두 적혀 있고 읽을 수 있다', () => {
    expect(LEVEL_CODES).toHaveLength(STAGE_LEVELS);
    expect(CLASSES.reduce((sum, group) => sum + group.levels, 0)).toBe(STAGE_LEVELS);
    for (const puzzle of puzzles) expect(puzzle).not.toBeNull();
  });

  it('잘못 적은 것은 읽지 않는다', () => {
    expect(parseLevel('x')).toBeNull();
    expect(parseLevel('pbo')).toBeNull();
    expect(parseLevel('1 pb.')).toBeNull();
    expect(parseLevel('1 pbo')).not.toBeNull();
  });

  it('같은 판이 두 번 나오지 않는다', () => {
    const codes = puzzles.map((puzzle) => formatPuzzle(puzzle!));
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('모든 판이 화면에 들어가는 크기다', () => {
    // 가장 짧은 화면(높이 400)에서 판이 쓰는 자리
    const area = { x: 0, y: 0, width: GAME_WIDTH, height: 230 };
    for (const puzzle of puzzles) {
      expect(puzzle!.cols - 2).toBeLessThanOrEqual(MAX_INNER_COLS);
      expect(puzzle!.rows - 2).toBeLessThanOrEqual(MAX_INNER_ROWS);
      expect(boardLayout(puzzle!, area).cell).toBeGreaterThanOrEqual(28);
    }
  });

  it('단계가 오를수록 상자가 는다', () => {
    for (const [boxes, first, last] of classRanges()) {
      for (let level = first; level <= last; level += 1) {
        expect(levelPuzzle(level).boxes, `${level}단계`).toHaveLength(boxes);
      }
    }
    expect(levelPuzzle(1).boxes).toHaveLength(1);
    expect(levelPuzzle(STAGE_LEVELS).boxes).toHaveLength(5);
  });

  it('모든 판을 풀 수 있고, 적어 둔 횟수가 가장 적게 미는 횟수다', () => {
    LEVEL_CODES.forEach((_, index) => {
      const puzzle = levelPuzzle(index + 1);
      expect(minPushes(puzzle), `${index + 1}단계`).toBe(puzzle.par);
    });
  }, 120_000);

  it('처음부터 다 놓여 있는 판은 없고, 상자가 둘 이하인 판은 별 자리가 모두 비어 있다', () => {
    const [, , lastSmall] = classRanges()[1];
    LEVEL_CODES.forEach((_, index) => {
      const run = levelRun(index + 1);
      expect(isSolved(run.board), `${index + 1}단계`).toBe(false);
      if (index + 1 <= lastSmall) expect(placedCount(run.board), `${index + 1}단계`).toBe(0);
    });
  });

  it('처음 몇 단계는 상자가 하나이고 몇 번만 밀면 된다', () => {
    for (let level = 1; level <= GUIDED_LEVELS; level += 1) {
      const puzzle = levelPuzzle(level);
      expect(puzzle.boxes).toHaveLength(1);
      expect(puzzle.par).toBeLessThanOrEqual(4);
    }
  });

  it('뒤로 갈수록 밀 일이 많아진다', () => {
    const average = (from: number, to: number): number => {
      let sum = 0;
      for (let level = from; level <= to; level += 1) sum += levelPuzzle(level).par;
      return sum / (to - from + 1);
    };
    expect(average(11, 20)).toBeGreaterThan(average(1, 10));
    expect(average(41, 50)).toBeGreaterThan(average(11, 20));
    expect(average(91, 100)).toBeGreaterThan(average(41, 50));
  });

  it('단계 번호가 범위를 벗어나면 가까운 단계의 판을 쓴다', () => {
    expect(formatPuzzle(levelPuzzle(0))).toBe(formatPuzzle(levelPuzzle(1)));
    expect(formatPuzzle(levelPuzzle(STAGE_LEVELS + 5))).toBe(formatPuzzle(levelPuzzle(STAGE_LEVELS)));
  });

  it('단계를 열면 그 단계의 판이 처음 모습으로 놓인다', () => {
    const run = levelRun(7);
    expect(run.board.pushes).toBe(0);
    expect(run.history).toHaveLength(0);
    expect(formatPuzzle(run.board.puzzle)).toBe(formatPuzzle(levelPuzzle(7)));
  });
});
