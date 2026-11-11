import { describe, expect, it } from 'vitest';
import { GAME_WIDTH, MAX_GAME_HEIGHT, MIN_GAME_HEIGHT } from '../../config';
import {
  BOARD_MARGIN,
  boardLayout,
  cellOf,
  chordTargets,
  CLEAR_POINTS_PER_STAGE,
  clearPoints,
  clearSeconds,
  CONTROLS_HEIGHT,
  countsOf,
  deduce,
  elapse,
  emptyBoard,
  FIRST_CLEAR_SECONDS,
  FLAWLESS_POINTS,
  isCleared,
  isOver,
  isSolvable,
  layTraps,
  markTile,
  MAX_CELL,
  MAX_COLS,
  MAX_ROWS,
  MIN_CELL,
  MIN_CLEAR_SECONDS,
  neighboursOf,
  newRun,
  nextStage,
  openTiles,
  scatterTraps,
  stageSpec,
  START_HEARTS,
  tapTile,
  TILE_POINTS,
  TIME_BANK_SECONDS,
  toggleMark,
  trapsLeft,
  withTraps,
  type Board,
  type RunState,
  type StageSpec,
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

/** 그림으로 판을 만든다. '*'는 함정, '.'은 안전한 칸이다. 모든 칸이 덮여 있다. */
function boardOf(picture: readonly string[]): Board {
  const size = { cols: picture[0].length, rows: picture.length };
  const traps = picture.flatMap((line) => [...line].map((mark) => mark === '*'));
  return withTraps(emptyBoard(size, 0), traps);
}

/** 판에 놓인 함정의 칸 번호들 */
const trapCells = (board: Board): number[] =>
  (board.traps ?? []).flatMap((isTrap, cell) => (isTrap ? [cell] : []));

/** 손으로 만든 판으로 시작하는 진행 상태 */
const runWith = (board: Board, extra: Partial<RunState> = {}): RunState => ({
  ...newRun(),
  board,
  ...extra,
});

/**
 * 추론(deduce)이 알려 주는 안전한 칸만 눌러서 지금 판을 끝까지 연다. 찍지 않는다.
 * 판을 깬 직후의 상태를 돌려주고, 추론이 막히면 null이다.
 */
function playBoard(start: RunState, first: number, random: () => number): RunState | null {
  const stage = start.stage;
  let run = tapTile(start, first, random).run;
  while (run.boardsCleared === start.boardsCleared) {
    const { safe } = deduce(run.board, stageSpec(stage).logic);
    if (safe.length === 0) return null;
    for (const cell of safe) run = tapTile(run, cell, random).run;
  }
  return run;
}

/**
 * 본보기 판(5×4). 왼쪽 위에 함정 하나, 오른쪽 아래에 함정 하나.
 *   * 1 . . .
 *   1 1 . . .
 *   . . . 1 1
 *   . . . 1 *
 */
const SAMPLE = boardOf(['*....', '.....', '.....', '....*']);

describe('칸과 둘레', () => {
  it('칸 번호는 왼쪽 위부터 가로로 센다', () => {
    const size = { cols: 5, rows: 4 };
    expect(cellOf(size, 0)).toEqual({ col: 0, row: 0 });
    expect(cellOf(size, 4)).toEqual({ col: 4, row: 0 });
    expect(cellOf(size, 5)).toEqual({ col: 0, row: 1 });
    expect(cellOf(size, 19)).toEqual({ col: 4, row: 3 });
  });

  it('둘레는 여덟 칸이고, 가장자리와 모서리에서는 판 안의 칸만 센다', () => {
    const size = { cols: 5, rows: 4 };
    expect(neighboursOf(size, 6)).toEqual([0, 1, 2, 5, 7, 10, 11, 12]);
    expect(neighboursOf(size, 0)).toEqual([1, 5, 6]);
    expect(neighboursOf(size, 4)).toEqual([3, 8, 9]);
    expect(neighboursOf(size, 19)).toEqual([13, 14, 18]);
    expect(neighboursOf(size, 2)).toEqual([1, 3, 6, 7, 8]);
    // 왼쪽 끝과 오른쪽 끝은 이웃이 아니다.
    expect(neighboursOf(size, 5)).not.toContain(4);
    expect(neighboursOf(size, 9)).not.toContain(10);
  });

  it('칸마다 둘레의 함정 수를 센다', () => {
    expect(SAMPLE.counts).toEqual([0, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 1, 0]);
    const crowded = boardOf(['***', '*.*', '***']);
    expect(crowded.counts[4]).toBe(8);
    expect(countsOf({ cols: 2, rows: 1 }, [false, false])).toEqual([0, 0]);
  });
});

describe('판', () => {
  it('새 판은 모두 덮여 있고 함정이 아직 놓이지 않았다', () => {
    const board = emptyBoard({ cols: 6, rows: 7 }, 7);
    expect(board.tiles).toHaveLength(42);
    expect(board.tiles.every((tile) => tile === 'covered')).toBe(true);
    expect(board.traps).toBeNull();
    expect(trapsLeft(board)).toBe(7);
    expect(isCleared(board)).toBe(false);
    // 함정이 놓이기 전에는 열 수 없다.
    expect(openTiles(board, [0]).opened).toEqual([]);
  });

  it('숫자가 있는 칸은 그 칸만 열린다', () => {
    const { board, opened, tripped } = openTiles(SAMPLE, [1]);
    expect(opened).toEqual([1]);
    expect(tripped).toEqual([]);
    expect(board.tiles[1]).toBe('open');
    expect(board.tiles.filter((tile) => tile === 'open')).toHaveLength(1);
    // 원본은 그대로다.
    expect(SAMPLE.tiles[1]).toBe('covered');
  });

  it('둘레에 함정이 없는 칸을 열면 숫자가 나올 때까지 퍼져서 열린다', () => {
    const { board, opened } = openTiles(SAMPLE, [2]);
    // 함정 두 칸만 빼고 모두 열린다.
    expect(opened).toHaveLength(18);
    expect(opened[0]).toBe(2);
    expect(new Set(opened).size).toBe(18);
    expect(board.tiles[0]).toBe('covered');
    expect(board.tiles[19]).toBe('covered');
    expect(isCleared(board)).toBe(true);
  });

  it('퍼져서 열릴 때 숫자 칸 너머로는 넘어가지 않는다', () => {
    // 가운데 세로줄의 숫자가 벽이 되어 오른쪽은 열리지 않는다.
    const walled = boardOf(['..*..', '.....', '..*..']);
    const { opened } = openTiles(walled, [0]);
    expect([...opened].sort((a, b) => a - b)).toEqual([0, 1, 5, 6, 10, 11]);
  });

  it('깃발을 꽂은 칸은 퍼져서 열릴 때도 열리지 않는다', () => {
    const marked = toggleMark(SAMPLE, 7);
    const { board, opened } = openTiles(marked, [2]);
    expect(opened).not.toContain(7);
    expect(board.tiles[7]).toBe('marked');
    expect(isCleared(board)).toBe(false);
    // 깃발이 꽂힌 칸을 직접 열려고 해도 열리지 않는다.
    expect(openTiles(marked, [7]).opened).toEqual([]);
  });

  it('함정을 열면 밟은 것으로 드러나고 둘레는 열리지 않는다', () => {
    const { board, opened, tripped } = openTiles(SAMPLE, [0]);
    expect(opened).toEqual([]);
    expect(tripped).toEqual([0]);
    expect(board.tiles[0]).toBe('tripped');
    // 이미 열렸거나 드러난 칸은 다시 열리지 않는다.
    expect(openTiles(board, [0]).tripped).toEqual([]);
  });

  it('깃발은 덮인 칸에만 꽂고, 다시 누르면 뽑힌다', () => {
    const marked = toggleMark(SAMPLE, 0);
    expect(marked.tiles[0]).toBe('marked');
    expect(toggleMark(marked, 0).tiles[0]).toBe('covered');
    const opened = openTiles(SAMPLE, [1]).board;
    expect(toggleMark(opened, 1)).toBe(opened);
    const tripped = openTiles(SAMPLE, [0]).board;
    expect(toggleMark(tripped, 0)).toBe(tripped);
  });

  it('남은 함정 수는 깃발과 밟은 함정을 뺀 수이고 0 아래로 내려가지 않는다', () => {
    expect(trapsLeft(SAMPLE)).toBe(2);
    expect(trapsLeft(toggleMark(SAMPLE, 0))).toBe(1);
    // 틀린 자리에 꽂아도 수는 줄어든다. 맞는지는 알려 주지 않는다.
    expect(trapsLeft(toggleMark(SAMPLE, 7))).toBe(1);
    expect(trapsLeft(openTiles(SAMPLE, [19]).board)).toBe(1);
    const overMarked = [0, 7, 8].reduce(toggleMark, SAMPLE);
    expect(trapsLeft(overMarked)).toBe(0);
  });

  it('안전한 칸을 모두 열면 깬 것이다. 깃발은 따지지 않는다', () => {
    const board = openTiles(SAMPLE, [2]).board;
    expect(isCleared(board)).toBe(true);
    expect(isCleared(openTiles(SAMPLE, [1]).board)).toBe(false);
    // 함정을 밟았어도 나머지를 다 열면 깬 것이다.
    expect(isCleared(openTiles(board, [0]).board)).toBe(true);
  });
});

describe('숫자 눌러 둘레 열기', () => {
  /**
   *   * 2 * . .
   *   1 2 1 . .      가운데 2(1번 칸)의 둘레: 0, 2, 5, 6, 7
   */
  const board = openTiles(boardOf(['*.*..', '.....']), [1, 5]).board;

  it('둘레의 깃발 수가 숫자와 같으면 나머지 덮인 둘레 칸을 돌려준다', () => {
    const flagged = [0, 2].reduce(toggleMark, board);
    expect(chordTargets(flagged, 1)).toEqual([6, 7]);
  });

  it('깃발 수가 모자라거나 넘치면 열지 않는다', () => {
    expect(chordTargets(board, 1)).toEqual([]);
    expect(chordTargets(toggleMark(board, 0), 1)).toEqual([]);
    expect(chordTargets([0, 2, 6].reduce(toggleMark, board), 1)).toEqual([]);
  });

  it('밟아서 드러난 함정도 깃발로 센다', () => {
    const tripped = openTiles(board, [0]).board;
    expect(chordTargets(toggleMark(tripped, 2), 1)).toEqual([6, 7]);
  });

  it('덮인 칸이나 둘레에 함정이 없는 칸은 눌러도 열 것이 없다', () => {
    expect(chordTargets(board, 6)).toEqual([]);
    const wide = openTiles(boardOf(['*....', '.....']), [3]).board;
    expect(wide.counts[3]).toBe(0);
    expect(chordTargets(wide, 3)).toEqual([]);
  });
});

describe('풀이', () => {
  /**
   *   * . .      왼쪽 위에 함정 하나. 아래 두 줄을 열면
   *   1 1 .      숫자 1 셋이 모두 0번 칸만 가리킨다.
   *   . . .
   */
  it('남은 함정 수가 모르는 칸의 수와 같으면 모두 함정이다', () => {
    const board = openTiles(boardOf(['*..', '...', '...']), [8, 1]).board;
    expect(deduce(board, 'counting')).toEqual({ safe: [], traps: [0] });
  });

  it('둘레의 함정을 다 찾은 숫자의 나머지 둘레는 안전하다', () => {
    // 가운데 1(4번 칸)의 함정은 밟아서 드러난 0번 칸이므로, 나머지 둘레는 모두 안전하다.
    const board = openTiles(boardOf(['*..', '...', '...']), [4, 0]).board;
    const { safe, traps } = deduce(board, 'counting');
    expect(traps).toEqual([]);
    expect(safe).toEqual([1, 2, 3, 5, 6, 7, 8]);
  });

  /**
   *   . * * .      아래 두 줄을 열면 가운데 줄에 1 2 2 1이 보인다.
   *   1 2 2 1      왼쪽 1은 {0,1}에 하나, 그 옆 2는 {0,1,2}에 둘이라고 말하므로
   *   . . . .      남는 2번 칸이 함정이다. 숫자 하나만 봐서는 알 수 없다.
   */
  const pattern = openTiles(boardOf(['.**.', '....', '....']), [8]).board;

  it('두 숫자를 견주면 남는 칸의 함정 수를 안다', () => {
    expect(deduce(pattern, 'counting')).toEqual({ safe: [], traps: [] });
    // 1번과 2번이 함정이라는 것을 알고 나면 양 끝이 안전하다는 것도 이어서 안다.
    expect(deduce(pattern, 'subset')).toEqual({ safe: [0, 3], traps: [1, 2] });
  });

  it('추론은 플레이어의 깃발을 믿지 않고, 열린 숫자만 본다', () => {
    const wrong = toggleMark(pattern, 0);
    expect(deduce(wrong, 'subset')).toEqual({ safe: [0, 3], traps: [1, 2] });
    // 아무것도 열지 않았으면 알 수 있는 것이 없다.
    expect(deduce(boardOf(['.**.', '....', '....']))).toEqual({ safe: [], traps: [] });
  });

  it('추론만으로 다 열 수 있는 판인지 가려낸다', () => {
    const size = { cols: 4, rows: 3 };
    const traps = pattern.traps ?? [];
    expect(isSolvable(size, traps, 8, 'subset')).toBe(true);
    expect(isSolvable(size, traps, 8, 'counting')).toBe(false);
    // 함정이 없으면 첫 칸에서 다 열린다.
    expect(isSolvable(size, traps.map(() => false), 0, 'counting')).toBe(true);
  });

  /**
   *   . . 1 ?      오른쪽 끝 두 칸 가운데 하나가 함정인데,
   *   . . 1 ?      보이는 숫자는 "둘 중 하나"라고만 말한다. 찍어야 하는 판이다.
   */
  it('둘 중 하나를 찍어야 하는 판은 풀 수 없는 판이다', () => {
    const size = { cols: 4, rows: 2 };
    const traps = [false, false, false, true, false, false, false, false];
    expect(isSolvable(size, traps, 0, 'subset')).toBe(false);
    const board = openTiles(withTraps(emptyBoard(size, 1), traps), [0]).board;
    expect(deduce(board)).toEqual({ safe: [], traps: [] });
  });

  it('함정에 갇혀 숫자가 닿지 않는 칸이 있으면 풀 수 없는 판이다', () => {
    // 오른쪽 위 모서리(3번 칸)는 함정 셋에 둘러싸여 어떤 숫자도 가리키지 않는다.
    const walled = boardOf(['..*.', '..**', '....', '....']);
    expect(isSolvable(walled, walled.traps ?? [], 12)).toBe(false);
  });
});

describe('판마다의 크기', () => {
  it('6×6에 함정 5개로 시작해 8×10까지 커진다', () => {
    expect(stageSpec(1)).toMatchObject({ cols: 6, rows: 6, traps: 5 });
    expect(stageSpec(99)).toMatchObject({ cols: MAX_COLS, rows: MAX_ROWS });
    expect(MAX_COLS).toBe(8);
    expect(MAX_ROWS).toBe(10);
    expect(stageSpec(0)).toEqual(stageSpec(1));
    expect(stageSpec(2.9)).toEqual(stageSpec(2));
  });

  it('뒤의 판일수록 칸이 줄지 않고, 함정이 늘고, 함정의 비율도 줄지 않는다', () => {
    const share = (spec: StageSpec): number => spec.traps / (spec.cols * spec.rows);
    let last = 1;
    while (stageSpec(last + 1) !== stageSpec(last)) last += 1;
    for (let stage = 2; stage <= last; stage += 1) {
      const before = stageSpec(stage - 1);
      const spec = stageSpec(stage);
      expect(spec.cols).toBeGreaterThanOrEqual(before.cols);
      expect(spec.rows).toBeGreaterThanOrEqual(before.rows);
      expect(spec.traps).toBeGreaterThan(before.traps);
      expect(share(spec)).toBeGreaterThanOrEqual(share(before) - 0.01);
    }
    expect(share(stageSpec(last))).toBeGreaterThan(share(stageSpec(1)));
    // 가장 빽빽한 판도 함정이 넷에 하나를 넘지 않는다.
    expect(share(stageSpec(last))).toBeLessThanOrEqual(0.25);
    expect(stageSpec(last + 5)).toBe(stageSpec(last));
  });

  it('처음에는 숫자 하나만 보고 푸는 판만 나오고, 뒤에서 두 숫자를 견주는 판이 나온다', () => {
    expect(stageSpec(1).logic).toBe('counting');
    expect(stageSpec(99).logic).toBe('subset');
    let seenSubset = false;
    for (let stage = 1; stage <= 12; stage += 1) {
      if (stageSpec(stage).logic === 'subset') seenSubset = true;
      else expect(seenSubset).toBe(false);
    }
  });
});

describe('함정 놓기', () => {
  it('정한 수만큼 뿌리고, 처음 누른 칸과 그 둘레는 비워 둔다', () => {
    const size = { cols: 8, rows: 10 };
    const random = seeded(3);
    for (let first = 0; first < 80; first += 1) {
      const traps = scatterTraps(size, 18, first, random);
      expect(traps).toHaveLength(80);
      expect(traps.filter(Boolean)).toHaveLength(18);
      expect(traps[first]).toBe(false);
      expect(neighboursOf(size, first).some((cell) => traps[cell])).toBe(false);
    }
  });

  it('놓을 자리보다 많이 달라고 하면 자리만큼만 놓는다', () => {
    // 3×3의 가운데를 누르면 놓을 자리가 없다.
    expect(scatterTraps({ cols: 3, rows: 3 }, 4, 4, seeded(1)).filter(Boolean)).toHaveLength(0);
    // 4×3의 왼쪽 위를 누르면 그 칸과 둘레 셋을 뺀 여덟 칸이 남는다.
    expect(scatterTraps({ cols: 4, rows: 3 }, 50, 0, seeded(1)).filter(Boolean)).toHaveLength(8);
    expect(scatterTraps({ cols: 4, rows: 3 }, -2, 0, seeded(1)).filter(Boolean)).toHaveLength(0);
  });

  it('시드가 같으면 같은 자리에 놓인다', () => {
    const spec = stageSpec(5);
    expect(layTraps(spec, 20, seeded(42))).toEqual(layTraps(spec, 20, seeded(42)));
    expect(layTraps(spec, 20, seeded(42))).not.toEqual(layTraps(spec, 20, seeded(43)));
  });

  it('어느 칸을 처음 눌러도 그 판의 함정 수대로 놓이고, 찍지 않고 풀 수 있다', () => {
    for (let stage = 1; stage <= 9; stage += 1) {
      const spec = stageSpec(stage);
      const cells = spec.cols * spec.rows;
      for (let seed = 1; seed <= 3; seed += 1) {
        const random = seeded(stage * 100 + seed);
        for (let first = 0; first < cells; first += 1) {
          const traps = layTraps(spec, first, random);
          expect(traps.filter(Boolean)).toHaveLength(spec.traps);
          expect(traps[first]).toBe(false);
          expect(neighboursOf(spec, first).some((cell) => traps[cell])).toBe(false);
          expect(isSolvable(spec, traps, first, spec.logic)).toBe(true);
        }
      }
    }
  });

  it('처음 두 판은 숫자 하나만 보고 세어도 풀린다', () => {
    for (const stage of [1, 2]) {
      const spec = stageSpec(stage);
      const random = seeded(stage);
      for (let round = 0; round < 150; round += 1) {
        const first = Math.floor(random() * spec.cols * spec.rows);
        expect(isSolvable(spec, layTraps(spec, first, random), first, 'counting')).toBe(true);
      }
    }
  });

  it('추론으로 풀리는 배치가 나오지 않으면 막히는 함정을 치워서라도 풀리는 판을 낸다', () => {
    // 칸의 절반을 함정으로 채우라는 억지 주문. 이렇게 빽빽하면 뿌려서는 풀리는 판이 나오지 않는다.
    const crowded: StageSpec = { cols: 8, rows: 10, traps: 40, logic: 'subset' };
    for (const first of [0, 35, 79]) {
      const traps = layTraps(crowded, first, seeded(first + 1));
      const count = traps.filter(Boolean).length;
      expect(count).toBeLessThan(crowded.traps);
      expect(count).toBeGreaterThan(0);
      expect(traps[first]).toBe(false);
      expect(neighboursOf(crowded, first).some((cell) => traps[cell])).toBe(false);
      expect(isSolvable(crowded, traps, first, 'subset')).toBe(true);
    }
  });

  it('어떻게 놓아도 찍어야 하는 판이라면 함정을 다 치운다', () => {
    // 4×2의 왼쪽 끝을 누르면 함정 하나가 어디에 놓이든 둘 중 하나를 찍어야 한다.
    const cramped: StageSpec = { cols: 4, rows: 2, traps: 1, logic: 'subset' };
    const traps = layTraps(cramped, 0, seeded(9));
    expect(traps.filter(Boolean)).toHaveLength(0);
    expect(isSolvable(cramped, traps, 0, 'subset')).toBe(true);
  });

  it('고장 난 random을 받아도 끝나고, 풀 수 있는 판을 낸다', () => {
    for (const value of [0, 0.5, 0.999999, 1]) {
      for (const stage of [1, 4, 8]) {
        const spec = stageSpec(stage);
        const traps = layTraps(spec, 0, () => value);
        expect(traps).toHaveLength(spec.cols * spec.rows);
        expect(traps[0]).toBe(false);
        expect(isSolvable(spec, traps, 0, spec.logic)).toBe(true);
      }
    }
  });
});

describe('화면 배치', () => {
  /** 화면 높이에서 HUD(56px)와 아래 단추 줄을 뺀, 판이 놓일 자리 */
  const areaFor = (height: number) => ({
    x: 0,
    y: 56,
    width: GAME_WIDTH,
    height: height - 56 - CONTROLS_HEIGHT,
  });

  it('가장 큰 판도 가장 작은 화면에 한 칸 26px 넘게 들어간다', () => {
    const smallest = areaFor(MIN_GAME_HEIGHT);
    const size = { cols: MAX_COLS, rows: MAX_ROWS };
    const { cell, left, top } = boardLayout(size, smallest);
    expect(cell).toBeGreaterThanOrEqual(MIN_CELL);
    expect(MIN_CELL).toBeGreaterThanOrEqual(26);
    expect(left - BOARD_MARGIN.x).toBeGreaterThanOrEqual(0);
    expect(left + size.cols * cell + BOARD_MARGIN.x).toBeLessThanOrEqual(GAME_WIDTH);
    expect(top - BOARD_MARGIN.y).toBeGreaterThanOrEqual(smallest.y);
    expect(top + size.rows * cell + BOARD_MARGIN.y).toBeLessThanOrEqual(smallest.y + smallest.height);
  });

  it('어느 판이든 어느 화면에서든 칸 크기가 범위 안이고 판이 자리 안에 놓인다', () => {
    for (const height of [MIN_GAME_HEIGHT, 480, MAX_GAME_HEIGHT]) {
      const area = areaFor(height);
      for (let stage = 1; stage <= 9; stage += 1) {
        const spec = stageSpec(stage);
        const { cell, left, top } = boardLayout(spec, area);
        expect(cell).toBeGreaterThanOrEqual(MIN_CELL);
        expect(cell).toBeLessThanOrEqual(MAX_CELL);
        expect(Number.isInteger(cell) && Number.isInteger(left) && Number.isInteger(top)).toBe(true);
        expect(left).toBeGreaterThanOrEqual(BOARD_MARGIN.x);
        expect(left + spec.cols * cell).toBeLessThanOrEqual(GAME_WIDTH - BOARD_MARGIN.x);
        expect(top).toBeGreaterThanOrEqual(area.y + BOARD_MARGIN.y);
        expect(top + spec.rows * cell).toBeLessThanOrEqual(area.y + area.height - BOARD_MARGIN.y);
      }
    }
  });

  it('판은 주어진 자리의 한가운데에 놓인다', () => {
    const area = { x: 0, y: 100, width: 240, height: 300 };
    const { cell, left, top } = boardLayout({ cols: 6, rows: 6 }, area);
    expect(cell).toBe(MAX_CELL);
    expect(left).toBe((240 - 6 * MAX_CELL) / 2);
    expect(top).toBe(100 + (300 - 6 * MAX_CELL) / 2);
  });
});

describe('목숨과 시간', () => {
  it('뒤의 판일수록 돌려받는 시간이 줄다가 바닥에서 멈춘다', () => {
    expect(clearSeconds(1)).toBe(FIRST_CLEAR_SECONDS);
    for (let stage = 2; stage <= 30; stage += 1) {
      expect(clearSeconds(stage)).toBeLessThanOrEqual(clearSeconds(stage - 1));
      expect(clearSeconds(stage)).toBeGreaterThanOrEqual(MIN_CLEAR_SECONDS);
    }
    expect(clearSeconds(30)).toBe(MIN_CLEAR_SECONDS);
    expect(clearSeconds(0)).toBe(clearSeconds(1));
    // 가장 많이 돌려받아도 처음에 주어진 시간보다는 적다.
    expect(FIRST_CLEAR_SECONDS).toBeLessThan(TIME_BANK_SECONDS);
    expect(MIN_CLEAR_SECONDS).toBeGreaterThan(0);
  });

  it('시간은 흐른 만큼 줄고 0에서 멈춘다', () => {
    const run = runWith(SAMPLE, { timeLeft: 1 });
    expect(elapse(run, 0.25).timeLeft).toBeCloseTo(0.75);
    expect(isOver(elapse(run, 0.25))).toBe(false);
    expect(elapse(run, 5).timeLeft).toBe(0);
    expect(isOver(elapse(run, 5))).toBe(true);
    expect(elapse(run, -3).timeLeft).toBe(1);
    // 원본은 그대로다.
    expect(run.timeLeft).toBe(1);
  });

  it('목숨이 다하면 시간이 남아도 끝난다', () => {
    expect(isOver(runWith(SAMPLE))).toBe(false);
    expect(isOver(runWith(SAMPLE, { hearts: 0 }))).toBe(true);
  });
});

describe('점수', () => {
  it('뒤의 판을 깰수록 보너스가 크다', () => {
    expect(clearPoints(1, false)).toBe(CLEAR_POINTS_PER_STAGE);
    for (let stage = 2; stage <= 20; stage += 1) {
      expect(clearPoints(stage, false)).toBeGreaterThan(clearPoints(stage - 1, false));
    }
    expect(clearPoints(0, false)).toBe(clearPoints(1, false));
  });

  it('함정을 밟지 않고 깨면 조금 더 받는다', () => {
    for (const stage of [1, 4, 9]) {
      expect(clearPoints(stage, true)).toBe(clearPoints(stage, false) + FLAWLESS_POINTS);
    }
    // 덤은 판을 하나 더 깬 것보다는 작다.
    expect(FLAWLESS_POINTS).toBeLessThan(CLEAR_POINTS_PER_STAGE);
  });
});

describe('진행', () => {
  it('새 판은 첫 단계의 덮인 판, 목숨 셋, 가득 찬 시간으로 시작한다', () => {
    const run = newRun();
    expect(run).toMatchObject({
      stage: 1,
      hearts: START_HEARTS,
      timeLeft: TIME_BANK_SECONDS,
      score: 0,
      boardsCleared: 0,
      tilesOpened: 0,
      trapsTripped: 0,
      flawless: true,
    });
    expect(START_HEARTS).toBe(3);
    expect(run.board).toMatchObject({ cols: 6, rows: 6, trapCount: 5, traps: null });
  });

  it('판의 첫 칸은 어디를 눌러도 안전하고, 그 칸과 둘레가 한꺼번에 열린다', () => {
    const cells = stageSpec(1).cols * stageSpec(1).rows;
    for (let first = 0; first < cells; first += 1) {
      const { run, outcome } = tapTile(newRun(), first, seeded(first));
      if (outcome.kind !== 'opened') throw new Error('첫 칸이 열리지 않았다');
      expect(outcome.first).toBe(true);
      expect(outcome.tripped).toEqual([]);
      expect(run.hearts).toBe(START_HEARTS);
      expect(run.board.counts[first]).toBe(0);
      for (const cell of [first, ...neighboursOf(run.board, first)]) {
        expect(run.board.tiles[cell]).toBe('open');
      }
      expect(trapCells(run.board)).toHaveLength(stageSpec(1).traps);
    }
  });

  it('연 칸마다 점수를 받는다. 퍼져서 열린 칸도 하나하나 센다', () => {
    const { run, outcome } = tapTile(newRun(), 14, seeded(8));
    if (outcome.kind !== 'opened') throw new Error('열리지 않았다');
    expect(outcome.opened.length).toBeGreaterThanOrEqual(9);
    expect(outcome.points).toBe(outcome.opened.length * TILE_POINTS);
    expect(run.score).toBe(outcome.points);
    expect(run.tilesOpened).toBe(outcome.opened.length);
    expect(run.board.tiles.filter((tile) => tile === 'open')).toHaveLength(outcome.opened.length);
  });

  it('깃발이 꽂힌 칸은 눌러도 열리지 않는다', () => {
    const marked = markTile(runWith(SAMPLE), 1);
    expect(marked.board.tiles[1]).toBe('marked');
    const { run, outcome } = tapTile(marked, 1, seeded(1));
    expect(outcome).toEqual({ kind: 'none' });
    expect(run).toBe(marked);
    // 깃발을 뽑으면 다시 열 수 있다.
    expect(tapTile(markTile(marked, 1), 1, seeded(1)).outcome.kind).toBe('opened');
    // 열린 칸에는 깃발을 꽂을 수 없다.
    const opened = tapTile(runWith(SAMPLE), 1, seeded(1)).run;
    expect(markTile(opened, 1)).toBe(opened);
  });

  it('함정을 밟으면 목숨이 하나 줄고, 그 함정은 드러나서 표시된 것으로 센다', () => {
    const { run, outcome } = tapTile(runWith(SAMPLE), 0, seeded(1));
    if (outcome.kind !== 'opened') throw new Error('열리지 않았다');
    expect(outcome.tripped).toEqual([0]);
    expect(outcome.opened).toEqual([]);
    expect(outcome.points).toBe(0);
    expect(outcome.first).toBe(false);
    expect(run.hearts).toBe(START_HEARTS - 1);
    expect(run.trapsTripped).toBe(1);
    expect(run.flawless).toBe(false);
    expect(run.score).toBe(0);
    expect(run.board.tiles[0]).toBe('tripped');
    expect(trapsLeft(run.board)).toBe(1);
    // 놀이는 이어진다.
    expect(isOver(run)).toBe(false);
    expect(tapTile(run, 1, seeded(1)).outcome.kind).toBe('opened');
  });

  it('마지막 목숨을 잃으면 끝나고, 그 뒤로는 눌러도 아무 일이 없다', () => {
    const last = runWith(SAMPLE, { hearts: 1 });
    const { run } = tapTile(last, 19, seeded(1));
    expect(run.hearts).toBe(0);
    expect(isOver(run)).toBe(true);
    expect(tapTile(run, 1, seeded(1))).toEqual({ run, outcome: { kind: 'none' } });
    expect(markTile(run, 1)).toBe(run);
    // 시간이 다 된 뒤에도 마찬가지다.
    const late = runWith(SAMPLE, { timeLeft: 0 });
    expect(tapTile(late, 1, seeded(1)).outcome).toEqual({ kind: 'none' });
    expect(markTile(late, 1)).toBe(late);
  });

  /**
   *   * 2 * . .
   *   1 2 1 . .
   */
  const strip = boardOf(['*.*..', '.....']);

  it('깃발을 맞게 꽂은 숫자를 누르면 나머지 둘레가 한꺼번에 열린다', () => {
    let run = tapTile(runWith(strip), 1, seeded(1)).run;
    expect(tapTile(run, 1, seeded(1)).outcome).toEqual({ kind: 'none' });
    run = markTile(markTile(run, 0), 2);
    const { run: after, outcome } = tapTile(run, 1, seeded(1));
    if (outcome.kind !== 'opened') throw new Error('열리지 않았다');
    expect(outcome.chord).toBe(true);
    expect(outcome.tripped).toEqual([]);
    expect([...outcome.opened].sort((a, b) => a - b)).toEqual([5, 6, 7]);
    expect(after.score).toBe(run.score + 3 * TILE_POINTS);
    expect(after.hearts).toBe(START_HEARTS);
  });

  it('깃발을 틀리게 꽂은 숫자를 누르면 함정을 밟는다', () => {
    let run = tapTile(runWith(strip), 1, seeded(1)).run;
    // 2번 칸(함정) 대신 안전한 6번 칸에 꽂았다.
    run = markTile(markTile(run, 0), 6);
    const { run: after, outcome } = tapTile(run, 1, seeded(1));
    if (outcome.kind !== 'opened') throw new Error('열리지 않았다');
    expect(outcome.tripped).toEqual([2]);
    expect([...outcome.opened].sort((a, b) => a - b)).toEqual([5, 7]);
    expect(after.hearts).toBe(START_HEARTS - 1);
    expect(after.board.tiles[6]).toBe('marked');
  });

  it('안전한 칸을 다 열면 판을 깬다: 보너스와 시간을 받고 남은 함정에 깃발이 꽂힌다', () => {
    const start = runWith(SAMPLE, { stage: 3, timeLeft: 20 });
    const { run, outcome } = tapTile(start, 2, seeded(1));
    if (outcome.kind !== 'opened') throw new Error('열리지 않았다');
    expect(outcome.cleared).toEqual({
      points: clearPoints(3, true),
      flawless: true,
      seconds: clearSeconds(3),
    });
    expect(run.score).toBe(18 * TILE_POINTS + clearPoints(3, true));
    expect(run.timeLeft).toBe(20 + clearSeconds(3));
    expect(run.boardsCleared).toBe(1);
    expect(run.board.tiles[0]).toBe('marked');
    expect(run.board.tiles[19]).toBe('marked');
    expect(trapsLeft(run.board)).toBe(0);
  });

  it('함정을 밟은 판은 깨도 덤 점수가 없다', () => {
    const tripped = tapTile(runWith(SAMPLE), 0, seeded(1)).run;
    const { run, outcome } = tapTile(tripped, 2, seeded(1));
    if (outcome.kind !== 'opened') throw new Error('열리지 않았다');
    expect(outcome.cleared).toMatchObject({ points: clearPoints(1, false), flawless: false });
    expect(run.score).toBe(18 * TILE_POINTS + clearPoints(1, false));
    // 밟아서 드러난 함정은 깃발로 바뀌지 않는다.
    expect(run.board.tiles[0]).toBe('tripped');
  });

  it('돌려받아도 시간은 처음에 주어진 것보다 많아지지 않는다', () => {
    const start = runWith(SAMPLE, { timeLeft: TIME_BANK_SECONDS - 4 });
    const { run, outcome } = tapTile(start, 2, seeded(1));
    if (outcome.kind !== 'opened') throw new Error('열리지 않았다');
    expect(run.timeLeft).toBe(TIME_BANK_SECONDS);
    expect(outcome.cleared?.seconds).toBe(4);
  });

  it('마지막 목숨을 잃으면서 판을 다 열면 깬 것으로 치지 않는다', () => {
    let run = tapTile(runWith(strip, { hearts: 1 }), 1, seeded(1)).run;
    run = [3, 4, 8, 9].reduce((state, cell) => tapTile(state, cell, seeded(1)).run, run);
    // 남은 안전한 칸은 5, 6, 7이다. 0번 대신 6번에 깃발을 꽂고 숫자를 눌러 0번 함정을 밟는다.
    run = markTile(markTile(run, 2), 6);
    run = tapTile(run, 1, seeded(1)).run;
    expect(run.hearts).toBe(0);
    expect(run.boardsCleared).toBe(0);
    expect(isOver(run)).toBe(true);
  });

  it('다음 판으로 넘어가면 더 큰 덮인 판이 깔리고, 점수와 목숨과 시간은 이어진다', () => {
    const cleared = tapTile(tapTile(runWith(SAMPLE), 0, seeded(1)).run, 2, seeded(1)).run;
    const next = nextStage(cleared);
    expect(next.stage).toBe(2);
    const { cols, rows, traps } = stageSpec(2);
    expect(next.board).toMatchObject({ cols, rows, trapCount: traps, traps: null });
    expect(next.board.tiles.every((tile) => tile === 'covered')).toBe(true);
    expect(next.flawless).toBe(true);
    expect(next).toMatchObject({
      score: cleared.score,
      hearts: cleared.hearts,
      timeLeft: cleared.timeLeft,
      boardsCleared: 1,
      trapsTripped: 1,
    });
  });

  it('추론이 알려 주는 칸만 눌러서 열 판을 내리 깬다. 한 번도 찍지 않는다', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const random = seeded(seed);
      let run = newRun();
      for (let stage = 1; stage <= 10; stage += 1) {
        const cells = run.board.cols * run.board.rows;
        const cleared = playBoard(run, Math.floor(random() * cells), random);
        if (!cleared) throw new Error(`시드 ${seed}의 ${stage}번째 판에서 추론이 막혔다`);
        expect(cleared.boardsCleared).toBe(stage);
        expect(cleared.trapsTripped).toBe(0);
        expect(cleared.hearts).toBe(START_HEARTS);
        expect(isCleared(cleared.board)).toBe(true);
        // 시간이 모자라 끝나지 않게 채워 두고 다음 판으로 간다.
        run = nextStage({ ...cleared, timeLeft: TIME_BANK_SECONDS });
      }
      // 연 칸의 점수에 판마다의 보너스와 덤을 더한 것이 총점이다.
      let bonus = 0;
      for (let stage = 1; stage <= 10; stage += 1) bonus += clearPoints(stage, true);
      expect(run.score).toBe(run.tilesOpened * TILE_POINTS + bonus);
    }
  });
});
