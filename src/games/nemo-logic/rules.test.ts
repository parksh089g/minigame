import { describe, expect, it } from 'vitest';
import { GAME_WIDTH, MAX_GAME_HEIGHT, MIN_GAME_HEIGHT } from '../../config';
import { seededRandom as seeded, STAGE_HEARTS, STAGE_LEVELS } from '../../core/stages';
import { PICTURES } from './pictures';
import {
  type Board,
  BOARD_MARGIN,
  boardArea,
  boardLayout,
  CELL_POINTS,
  cellOf,
  cellsLeft,
  CLEAR_POINTS_PER_STAGE,
  clearPoints,
  clearSeconds,
  clueOf,
  colCells,
  CONTROLS_HEIGHT,
  difficultyOf,
  elapse,
  EMPTY,
  FILLED,
  FIRST_CLEAR_SECONDS,
  fitsArea,
  FLAWLESS_POINTS,
  freshBoard,
  HEADER_HEIGHT,
  HEADER_STAGES,
  isCleared,
  isColDone,
  isOver,
  isRowDone,
  isSolvable,
  levelPicture,
  levelRun,
  makePuzzle,
  MAX_CELL,
  MAX_COLS,
  MAX_ROWS,
  MAX_RUNS,
  MIN_CELL,
  MIN_CLEAR_SECONDS,
  MIRROR_CHANCE,
  mostRuns,
  newRun,
  nextStage,
  paint,
  type Puzzle,
  puzzleOf,
  rowCells,
  type RunState,
  scatter,
  solve,
  stageSpec,
  START_HEARTS,
  strokeCells,
  TIME_BANK_SECONDS,
  UNKNOWN,
} from './rules';

/** 미니게임 화면 위쪽 HUD의 높이(scenes/GameHud.ts의 HUD_HEIGHT). 그 파일은 Phaser를 끌어와서 여기서는 값만 적는다. */
const HUD_HEIGHT = 56;

/** 씨앗 번호로 만든 난수 */
const seededRandom = (seed: number): (() => number) => seeded(`nemo-logic-test-${seed}`);

/** 글자로 그린 판: #은 칠하는 칸, 점은 비워 두는 칸 */
function drawn(...rows: string[]): Puzzle {
  return puzzleOf(
    { cols: rows[0].length, rows: rows.length },
    rows.flatMap((row) => [...row].map((letter) => letter === '#')),
  );
}

/** 판의 상태를 글자로: #은 칠한 칸, x는 X로 표시한 칸, !는 틀린 칸, 점은 빈칸 */
function shown(board: Board): string[] {
  const letters = { blank: '.', filled: '#', marked: 'x', crossed: '!' } as const;
  return Array.from({ length: board.rows }, (_, row) =>
    rowCells(board, row)
      .map((cell) => letters[board.cells[cell]])
      .join(''),
  );
}

/** 작은 하트. 줄만 따져서 풀린다. */
const HEART = drawn('.#.#.', '#####', '#####', '.###.', '..#..');

function runOn(puzzle: Puzzle, stage = 1): RunState {
  return { ...newRun(seededRandom(1)), stage, board: freshBoard(puzzle) };
}

/** 칠해야 하는 칸을 왼쪽 위부터 하나씩 모두 칠한다. */
function fillAll(run: RunState): RunState {
  let now = run;
  now.board.solution.forEach((fill, cell) => {
    if (fill) now = paint(now, [cell], 'fill').run;
  });
  return now;
}

describe('줄과 숫자', () => {
  it('칸 번호는 왼쪽 위부터 가로줄을 따라 센다', () => {
    const size = { cols: 4, rows: 3 };
    expect(cellOf(size, 0)).toEqual({ col: 0, row: 0 });
    expect(cellOf(size, 6)).toEqual({ col: 2, row: 1 });
    expect(rowCells(size, 1)).toEqual([4, 5, 6, 7]);
    expect(colCells(size, 2)).toEqual([2, 6, 10]);
  });

  it('이어서 칠해진 칸의 수를 차례로 센다', () => {
    const line = (text: string): boolean[] => [...text].map((letter) => letter === '#');
    expect(clueOf(line('.....'))).toEqual([]);
    expect(clueOf(line('#####'))).toEqual([5]);
    expect(clueOf(line('##.#.'))).toEqual([2, 1]);
    expect(clueOf(line('.#.#.#'))).toEqual([1, 1, 1]);
    expect(clueOf(line('#..###'))).toEqual([1, 3]);
  });

  it('칠해야 하는 칸들에서 가로줄과 세로줄의 숫자를 만든다', () => {
    expect(HEART.rowClues).toEqual([[1, 1], [5], [5], [3], [1]]);
    expect(HEART.colClues).toEqual([[2], [4], [4], [4], [2]]);
    expect(mostRuns(HEART.rowClues)).toBe(2);
    expect(mostRuns(HEART.colClues)).toBe(1);
    // 숫자가 없는 줄뿐이어도 0을 적을 자리는 하나 둔다.
    expect(mostRuns([[], []])).toBe(1);
  });
});

describe('풀이', () => {
  it('한 줄씩 따져서 끝까지 풀면 바로 그 그림이 나온다', () => {
    const { solved, known, sweeps, firstSweep } = solve(HEART);
    expect(solved).toBe(true);
    expect(known.map((mark) => mark === FILLED)).toEqual(HEART.solution);
    expect(known.every((mark) => mark === FILLED || mark === EMPTY)).toBe(true);
    expect(sweeps).toBeGreaterThanOrEqual(1);
    expect(firstSweep).toBeGreaterThan(0);
    expect(isSolvable(HEART)).toBe(true);
  });

  it('답이 둘인 판은 풀리지 않은 채로 돌아온다', () => {
    // 비스듬히 놓인 두 칸: 숫자가 같은 그림이 둘이다.
    const swap = drawn('#.', '.#');
    const { solved, known } = solve(swap);
    expect(solved).toBe(false);
    expect(known.every((mark) => mark === UNKNOWN)).toBe(true);
    expect(isSolvable(swap)).toBe(false);
    expect(difficultyOf(swap)).toBe(Number.POSITIVE_INFINITY);
  });

  it('숫자가 서로 맞지 않는 판도 풀리지 않는다', () => {
    const broken: Puzzle = { ...drawn('##', '##'), colClues: [[1], [2]] };
    expect(solve(broken).solved).toBe(false);
  });

  it('꽉 찬 줄과 빈 줄은 바로 안다', () => {
    const { solved, sweeps } = solve(drawn('###', '...', '###'));
    expect(solved).toBe(true);
    expect(sweeps).toBe(1);
  });

  it('여러 바퀴를 돌아야 풀리는 판이 더 어렵다', () => {
    const easy = drawn('#####', '#####', '#####', '#####', '#####');
    expect(difficultyOf(HEART)).toBeGreaterThan(difficultyOf(easy));
    // 같은 풀이라도 판이 크면 더 어렵다.
    const wide = drawn('########', '########', '########', '########', '########');
    expect(difficultyOf(wide)).toBeGreaterThan(difficultyOf(easy));
  });
});

describe('판 만들기', () => {
  it('5×5에서 시작해 가장 큰 판까지 커지고, 그 뒤로는 그대로다', () => {
    expect(stageSpec(1)).toMatchObject({ cols: 5, rows: 5 });
    let last = stageSpec(1);
    for (let stage = 2; stage <= 12; stage += 1) {
      const spec = stageSpec(stage);
      expect(spec.cols * spec.rows).toBeGreaterThanOrEqual(last.cols * last.rows);
      expect(spec.density).toBeLessThanOrEqual(last.density + 0.021);
      expect(spec.cols).toBeLessThanOrEqual(MAX_COLS);
      expect(spec.rows).toBeLessThanOrEqual(MAX_ROWS);
      last = spec;
    }
    expect(stageSpec(40)).toMatchObject({ cols: MAX_COLS, rows: MAX_ROWS });
    expect(stageSpec(0)).toEqual(stageSpec(1));
  });

  it('좌우가 같은 무늬가 정해 둔 비율쯤 나온다', () => {
    const random = seededRandom(7);
    const spec = stageSpec(5);
    const isMirrored = (filled: readonly boolean[]): boolean =>
      filled.every((fill, cell) => {
        const { col, row } = cellOf(spec, cell);
        return fill === filled[row * spec.cols + (spec.cols - 1 - col)];
      });
    const boards = Array.from({ length: 200 }, () => scatter(spec, random));
    const mirrored = boards.filter(isMirrored).length / boards.length;
    expect(mirrored).toBeGreaterThan(MIRROR_CHANCE - 0.15);
    expect(mirrored).toBeLessThan(MIRROR_CHANCE + 0.15);
  });

  it('어느 판이든 찍지 않고 풀리고, 빈 줄이 없고, 한 줄의 숫자가 너무 많지 않다', () => {
    for (let stage = 1; stage <= 9; stage += 1) {
      const spec = stageSpec(stage);
      for (let seed = 1; seed <= 30; seed += 1) {
        const puzzle = makePuzzle(spec, seededRandom(stage * 1000 + seed));
        expect(puzzle.cols).toBe(spec.cols);
        expect(puzzle.rows).toBe(spec.rows);
        expect(isSolvable(puzzle), `${stage}판 씨앗 ${seed}`).toBe(true);
        for (const clue of [...puzzle.rowClues, ...puzzle.colClues]) {
          expect(clue.length).toBeGreaterThanOrEqual(1);
          expect(clue.length).toBeLessThanOrEqual(MAX_RUNS);
        }
      }
    }
  });

  it('같은 난수에서는 같은 판이 나온다', () => {
    const spec = stageSpec(6);
    expect(makePuzzle(spec, seededRandom(42))).toEqual(makePuzzle(spec, seededRandom(42)));
    expect(makePuzzle(spec, seededRandom(42)).solution).not.toEqual(makePuzzle(spec, seededRandom(43)).solution);
  });

  it('풀리는 판이 끝내 나오지 않으면 막히는 칸을 칠해서 풀리게 만든다', () => {
    // 언제나 같은 수만 주는 난수: 바둑판 무늬처럼 한쪽으로 쏠린 판만 나온다.
    for (const stuck of [0, 0.3, 0.59, 0.61, 0.99]) {
      const puzzle = makePuzzle(stageSpec(7), () => stuck);
      expect(isSolvable(puzzle), `난수 ${stuck}`).toBe(true);
    }
    // 칸을 번갈아 칠하는 난수: 답이 여럿인 무늬가 나오기 쉽다.
    let turn = 0;
    const alternating = (): number => {
      turn += 1;
      return turn % 2 === 0 ? 0.1 : 0.9;
    };
    expect(isSolvable(makePuzzle(stageSpec(3), alternating))).toBe(true);
  });
});

describe('칸의 상태', () => {
  it('새 판은 모두 빈칸이고, 칠할 칸이 없는 줄에는 처음부터 X가 있다', () => {
    expect(shown(freshBoard(HEART))).toEqual(['.....', '.....', '.....', '.....', '.....']);
    expect(shown(freshBoard(drawn('##.', '...', '#..')))).toEqual(['..x', 'xxx', '..x']);
    expect(freshBoard(HEART).picture).toBeNull();
  });

  it('남은 칸과 다 칠한 줄을 안다', () => {
    const board = freshBoard(HEART);
    expect(cellsLeft(board)).toBe(16);
    expect(isCleared(board)).toBe(false);
    expect(isRowDone(board, 0)).toBe(false);

    const run = paint(runOn(HEART), [1, 3], 'fill').run;
    expect(cellsLeft(run.board)).toBe(14);
    expect(isRowDone(run.board, 0)).toBe(true);
    expect(isColDone(run.board, 1)).toBe(false);
  });
});

describe('한 번에 칠하는 칸들', () => {
  const size = { cols: 5, rows: 5 };

  it('누르기만 하면 그 칸 하나다', () => {
    expect(strokeCells(size, 7, 7)).toEqual([7]);
  });

  it('끌면 처음 칸부터 한 줄로 이어진다', () => {
    expect(strokeCells(size, 5, 8)).toEqual([5, 6, 7, 8]);
    expect(strokeCells(size, 8, 5)).toEqual([8, 7, 6, 5]);
    expect(strokeCells(size, 2, 22)).toEqual([2, 7, 12, 17, 22]);
    expect(strokeCells(size, 22, 12)).toEqual([22, 17, 12]);
  });

  it('비스듬히 끌면 더 멀리 간 쪽의 줄만 따라간다', () => {
    // (0,0)에서 (3,1)로: 가로로 더 멀리 갔으니 첫 가로줄을 따라간다.
    expect(strokeCells(size, 0, 8)).toEqual([0, 1, 2, 3]);
    // (0,0)에서 (1,3)으로: 세로줄을 따라간다.
    expect(strokeCells(size, 0, 16)).toEqual([0, 5, 10, 15]);
    // 똑같이 갔으면 가로줄이다.
    expect(strokeCells(size, 0, 12)).toEqual([0, 1, 2]);
  });
});

describe('칠하기', () => {
  it('맞는 칸을 칠하면 칸마다 점수를 얻는다', () => {
    const start = runOn(HEART);
    const { run, outcome } = paint(start, [5, 6, 7], 'fill');
    expect(outcome).toMatchObject({ kind: 'filled', filled: [5, 6, 7], points: 3 * CELL_POINTS, missed: null });
    expect(run.score).toBe(3 * CELL_POINTS);
    expect(run.cellsFilled).toBe(3);
    expect(run.hearts).toBe(START_HEARTS);
    expect(shown(run.board)[1]).toBe('###..');
    // 받은 상태는 바뀌지 않는다.
    expect(shown(start.board)[1]).toBe('.....');
    expect(start.score).toBe(0);
  });

  it('칠하면 안 되는 칸을 만나면 하트를 잃고 거기서 멈춘다', () => {
    // 맨 아래 줄을 왼쪽부터: 빈칸이어야 하는 첫 칸에서 바로 멈춘다.
    const first = paint(runOn(HEART), [20, 21, 22], 'fill');
    expect(first.outcome).toMatchObject({ kind: 'filled', filled: [], points: 0, missed: 20 });
    expect(first.run.hearts).toBe(START_HEARTS - 1);
    expect(first.run.mistakes).toBe(1);
    expect(first.run.flawless).toBe(false);
    expect(shown(first.run.board)[4]).toBe('!....');

    // 맞는 칸을 지나다가 틀린 칸을 만나면 그 앞까지는 칠해진다.
    const later = paint(runOn(HEART), [17, 18, 19], 'fill');
    expect(later.outcome).toMatchObject({ filled: [17, 18], missed: 19 });
    expect(shown(later.run.board)[3]).toBe('..##!');
    expect(later.run.score).toBe(2 * CELL_POINTS);
  });

  it('틀린 칸과 이미 칠한 칸은 다시 칠해지지 않는다', () => {
    const missed = paint(runOn(HEART), [0], 'fill').run;
    const again = paint(missed, [0], 'fill');
    expect(again.outcome).toEqual({ kind: 'none' });
    expect(again.run).toBe(missed);

    const filled = paint(runOn(HEART), [1], 'fill').run;
    expect(paint(filled, [1], 'fill').outcome).toEqual({ kind: 'none' });
    // 지나가는 길에 있으면 건너뛰고 나머지를 칠한다.
    const across = paint(paint(runOn(HEART), [6], 'fill').run, [5, 6, 7], 'fill');
    expect(across.outcome).toMatchObject({ filled: [5, 7], missed: null });
  });

  it('X로 표시해 둔 칸은 칠해지지 않아서 실수를 막아 준다', () => {
    const marked = paint(runOn(HEART), [0], 'mark').run;
    const { run, outcome } = paint(marked, [0, 1, 2], 'fill');
    // 0번은 건너뛰고, 1번은 칠하고, 2번은 빈칸이어야 해서 틀린다.
    expect(outcome).toMatchObject({ filled: [1], missed: 2 });
    expect(shown(run.board)[0]).toBe('x#!..');

    // 표시한 칸만 지나가면 아무 일도 없다.
    expect(paint(marked, [0], 'fill').outcome).toEqual({ kind: 'none' });
    expect(paint(marked, [0], 'fill').run.hearts).toBe(START_HEARTS);
  });

  it('줄을 다 칠하면 그 줄에 남은 빈칸에 저절로 X가 표시된다', () => {
    const { run, outcome } = paint(runOn(HEART), [1, 3], 'fill');
    expect(outcome).toMatchObject({ rowsDone: [0], colsDone: [], autoMarked: [0, 2, 4] });
    expect(shown(run.board)[0]).toBe('x#x#x');

    // 세로줄도 마찬가지다: 가운데 세로줄은 위의 한 칸만 비어 있다.
    const column = paint(runOn(HEART), [7, 12, 17, 22], 'fill');
    // 맨 아래 가로줄도 그 한 칸으로 다 칠해져서 남은 칸에 X가 표시된다.
    expect(column.outcome).toMatchObject({ rowsDone: [4], colsDone: [2], autoMarked: [20, 21, 23, 24, 2] });
    expect(shown(column.run.board)[4]).toBe('xx#xx');
  });

  it('이미 틀려서 드러난 칸은 X로 덮지 않는다', () => {
    const missed = paint(runOn(HEART), [0], 'fill').run;
    const { run } = paint(missed, [1, 3], 'fill');
    expect(shown(run.board)[0]).toBe('!#x#x');
  });

  it('하트를 다 잃으면 끝나고, 더는 칠할 수 없다', () => {
    let run = runOn(HEART);
    for (const cell of [0, 2, 4]) run = paint(run, [cell], 'fill').run;
    expect(run.hearts).toBe(0);
    expect(isOver(run)).toBe(true);
    expect(paint(run, [1], 'fill').outcome).toEqual({ kind: 'none' });
    expect(paint(run, [1], 'mark').outcome).toEqual({ kind: 'none' });
  });
});

describe('X로 표시하기', () => {
  it('빈칸에서 시작하면 지나간 빈칸을 모두 표시한다', () => {
    const start = paint(runOn(HEART), [6], 'fill').run;
    const { run, outcome } = paint(start, [5, 6, 7], 'mark');
    // 칠한 칸은 그대로 두고 빈칸만 표시한다. 맞는 칸에 표시해도 하트는 줄지 않는다.
    expect(outcome).toEqual({ kind: 'marked', marked: [5, 7], unmarked: [] });
    expect(shown(run.board)[1]).toBe('x#x..');
    expect(run.hearts).toBe(START_HEARTS);
    expect(run.score).toBe(start.score);
  });

  it('표시된 칸에서 시작하면 지나간 표시를 모두 지운다', () => {
    const marked = paint(runOn(HEART), [0, 1, 2], 'mark').run;
    const { run, outcome } = paint(marked, [1, 2, 3], 'mark');
    // 3번은 빈칸이지만 지우는 중이라 그대로 둔다.
    expect(outcome).toEqual({ kind: 'marked', marked: [], unmarked: [1, 2] });
    expect(shown(run.board)[0]).toBe('x....');
  });

  it('칠한 칸과 틀린 칸만 지나가면 아무 일도 없다', () => {
    let run = paint(runOn(HEART), [1], 'fill').run;
    run = paint(run, [0], 'fill').run;
    expect(paint(run, [0, 1], 'mark').outcome).toEqual({ kind: 'none' });
  });

  it('표시만으로는 판을 깨지 못한다', () => {
    const run = paint(runOn(HEART), [0, 2, 4], 'mark').run;
    expect(isCleared(run.board)).toBe(false);
    expect(cellsLeft(run.board)).toBe(16);
  });
});

describe('판을 깸', () => {
  it('칠해야 하는 칸을 모두 칠하면 깨고, 보너스와 시간을 받는다', () => {
    const start = elapse(runOn(HEART, 3), 50);
    let run = start;
    const cells = HEART.solution.flatMap((fill, cell) => (fill ? [cell] : []));
    for (const cell of cells.slice(0, -1)) run = paint(run, [cell], 'fill').run;
    expect(isCleared(run.board)).toBe(false);

    const last = paint(run, [cells.at(-1) ?? 0], 'fill');
    expect(isCleared(last.run.board)).toBe(true);
    expect(last.outcome).toMatchObject({
      kind: 'filled',
      cleared: { points: clearPoints(3, true), flawless: true, seconds: clearSeconds(3) },
    });
    expect(last.run.score).toBe(16 * CELL_POINTS + clearPoints(3, true));
    expect(last.run.timeLeft).toBe(50 + clearSeconds(3));
    expect(last.run.boardsCleared).toBe(1);
    // 깬 판에는 더 칠할 수 없다.
    expect(paint(last.run, [0], 'fill').outcome).toEqual({ kind: 'none' });
  });

  it('마지막 칸을 칠한 뒤로 지나간 칸은 보지 않는다', () => {
    // 맨 아래 가운데 칸만 남기고 다 칠한 뒤, 그 칸에서 옆의 빈칸으로 끌어도 틀리지 않는다.
    let run = runOn(HEART);
    HEART.solution.forEach((fill, cell) => {
      if (fill && cell !== 22) run = paint(run, [cell], 'fill').run;
    });
    const { run: done, outcome } = paint(run, [22, 23, 24], 'fill');
    expect(outcome).toMatchObject({ filled: [22], missed: null });
    expect(done.hearts).toBe(START_HEARTS);
    expect(isCleared(done.board)).toBe(true);
  });

  it('틀린 적이 있으면 덤 점수가 빠진다', () => {
    const missed = paint(runOn(HEART, 2), [0], 'fill').run;
    const done = fillAll(missed);
    expect(isCleared(done.board)).toBe(true);
    expect(done.score).toBe(16 * CELL_POINTS + clearPoints(2, false));
    expect(clearPoints(2, true) - clearPoints(2, false)).toBe(FLAWLESS_POINTS);
    expect(clearPoints(4, false)).toBe(4 * CLEAR_POINTS_PER_STAGE);
  });

  it('돌려받는 시간은 판이 갈수록 줄다가 멈추고, 가득 찬 시간을 넘지 않는다', () => {
    expect(clearSeconds(1)).toBe(FIRST_CLEAR_SECONDS);
    for (let stage = 2; stage <= 30; stage += 1) {
      expect(clearSeconds(stage)).toBeLessThanOrEqual(clearSeconds(stage - 1));
      expect(clearSeconds(stage)).toBeGreaterThanOrEqual(MIN_CLEAR_SECONDS);
    }
    expect(clearSeconds(30)).toBe(MIN_CLEAR_SECONDS);

    const full = fillAll(elapse(runOn(HEART), 10));
    expect(full.timeLeft).toBe(TIME_BANK_SECONDS);
  });

  it('다음 판은 더 크거나 같고, 점수와 하트는 이어지며, 덤 점수는 다시 노릴 수 있다', () => {
    const random = seededRandom(11);
    const first = newRun(random);
    const done = fillAll(paint(first, [first.board.solution.indexOf(false)], 'fill').run);
    expect(done.flawless).toBe(false);
    expect(isCleared(done.board)).toBe(true);

    const next = nextStage(done, random);
    expect(next.stage).toBe(2);
    expect(next.score).toBe(done.score);
    expect(next.hearts).toBe(done.hearts);
    expect(next.flawless).toBe(true);
    expect(next.board.cells.every((cell) => cell === 'blank')).toBe(true);
    expect(isSolvable(next.board)).toBe(true);
  });
});

describe('시간', () => {
  it('시간이 다 되면 끝난다', () => {
    const run = newRun(seededRandom(3));
    expect(run.timeLeft).toBe(TIME_BANK_SECONDS);
    expect(isOver(run)).toBe(false);
    expect(elapse(run, 30).timeLeft).toBe(TIME_BANK_SECONDS - 30);
    expect(elapse(run, -5).timeLeft).toBe(TIME_BANK_SECONDS);
    const out = elapse(run, TIME_BANK_SECONDS + 1);
    expect(out.timeLeft).toBe(0);
    expect(isOver(out)).toBe(true);
  });
});

describe('단계 모드', () => {
  it('단계마다 정해 둔 그림을 그린다', () => {
    expect(levelPicture(1)).toBe(PICTURES[0]);
    expect(levelPicture(37)).toBe(PICTURES[36]);
    expect(levelPicture(STAGE_LEVELS)).toBe(PICTURES[STAGE_LEVELS - 1]);
    // 범위를 벗어난 번호는 처음이나 끝의 단계로 맞춘다.
    expect(levelPicture(0)).toBe(PICTURES[0]);
    expect(levelPicture(STAGE_LEVELS + 5)).toBe(PICTURES[STAGE_LEVELS - 1]);
  });

  it('빈 판과 가득 찬 하트로 시작하고, 그림을 안고 있다', () => {
    const run = levelRun(12);
    expect(run.stage).toBe(12);
    expect(run.hearts).toBe(START_HEARTS);
    expect(START_HEARTS).toBe(STAGE_HEARTS);
    expect(run.board.picture).toBe(PICTURES[11]);
    expect(run.board.cells.every((cell) => cell === 'blank')).toBe(true);
    expect(run.board.rows).toBe(PICTURES[11].rows.length);
    expect(run.board.cols).toBe(PICTURES[11].rows[0].length);
  });

  it('그림대로 다 칠하면 깬다', () => {
    const done = fillAll(levelRun(64));
    expect(isCleared(done.board)).toBe(true);
    expect(done.hearts).toBe(START_HEARTS);
    expect(done.mistakes).toBe(0);
  });
});

describe('화면 배치', () => {
  const areaFor = (height: number, stage = 9) => boardArea(GAME_WIDTH, height, HUD_HEIGHT, stage);

  it('판이 놓일 자리는 HUD 아래부터 단추 줄 위까지이고, 처음 판들은 안내 글만큼 내려온다', () => {
    expect(areaFor(MIN_GAME_HEIGHT)).toEqual({
      x: 0,
      y: HUD_HEIGHT,
      width: GAME_WIDTH,
      height: MIN_GAME_HEIGHT - HUD_HEIGHT - CONTROLS_HEIGHT,
    });
    const first = areaFor(MIN_GAME_HEIGHT, HEADER_STAGES);
    expect(first.y).toBe(HUD_HEIGHT + HEADER_HEIGHT);
    expect(first.y + first.height).toBe(MIN_GAME_HEIGHT - CONTROLS_HEIGHT);
    expect(areaFor(MIN_GAME_HEIGHT, HEADER_STAGES + 1).y).toBe(HUD_HEIGHT);
  });

  it('점수 도전의 어느 판이든 가장 작은 화면부터 가장 큰 화면까지 다 들어간다', () => {
    for (let stage = 1; stage <= 9; stage += 1) {
      for (let seed = 1; seed <= 20; seed += 1) {
        const puzzle = makePuzzle(stageSpec(stage), seededRandom(stage * 77 + seed));
        for (const height of [MIN_GAME_HEIGHT, 480, MAX_GAME_HEIGHT]) {
          const area = areaFor(height, stage);
          const layout = boardLayout(puzzle, area);
          expect(layout.cell).toBeGreaterThanOrEqual(MIN_CELL);
          expect(layout.cell).toBeLessThanOrEqual(MAX_CELL);
          expect(fitsArea(puzzle, layout, area), `${stage}판 씨앗 ${seed} 높이 ${height}`).toBe(true);
        }
      }
    }
  });

  it('숫자 자리와 판을 한 덩어리로 가운데에 놓고, 좌표는 정수다', () => {
    const area = areaFor(MAX_GAME_HEIGHT);
    const layout = boardLayout(HEART, area);
    expect(layout.cell).toBe(MAX_CELL);
    expect(Number.isInteger(layout.left)).toBe(true);
    expect(Number.isInteger(layout.top)).toBe(true);
    const leftGap = layout.left - layout.clueWidth - area.x;
    const rightGap = area.x + area.width - (layout.left + HEART.cols * layout.cell);
    expect(Math.abs(leftGap - rightGap)).toBeLessThanOrEqual(1);
    const topGap = layout.top - layout.clueHeight - area.y;
    const bottomGap = area.y + area.height - (layout.top + HEART.rows * layout.cell);
    expect(Math.abs(topGap - bottomGap)).toBeLessThanOrEqual(1);
    expect(leftGap).toBeGreaterThanOrEqual(BOARD_MARGIN.x);
  });

  it('숫자가 많이 적히는 판은 숫자 자리가 넓어져서 칸이 작아진다', () => {
    const plain = drawn('########', '########', '########', '########', '########', '########', '########', '########');
    const busy = drawn('#.#.#.##', '########', '#.#.#.##', '########', '#.#.#.##', '########', '#.#.#.##', '########');
    const area = areaFor(MIN_GAME_HEIGHT);
    expect(boardLayout(busy, area).clueWidth).toBeGreaterThan(boardLayout(plain, area).clueWidth);
    expect(boardLayout(busy, area).cell).toBeLessThanOrEqual(boardLayout(plain, area).cell);
  });

  it('큰 판에서는 숫자의 글자도 작아진다', () => {
    const big = makePuzzle(stageSpec(9), seededRandom(5));
    expect(boardLayout(big, areaFor(MIN_GAME_HEIGHT)).clueSize).toBeLessThan(
      boardLayout(HEART, areaFor(MAX_GAME_HEIGHT)).clueSize,
    );
  });
});
