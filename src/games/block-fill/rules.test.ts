import { describe, expect, it } from 'vitest';
import { GAME_WIDTH, MAX_GAME_HEIGHT, MIN_GAME_HEIGHT } from '../../config';
import {
  anyFits,
  BOARD_LIP,
  BOARD_RIM,
  boardCoords,
  canPlace,
  cellIndex,
  CELL_POINTS,
  CELLS,
  cellsAt,
  COLOR_COUNT,
  DEAL_ATTEMPTS,
  dealTray,
  difficultyAt,
  DRAG_EDGE,
  DRAG_LIFT,
  dragCenter,
  emptyBoard,
  filledCount,
  fitsAnywhere,
  fullLines,
  GAPS,
  largestFitting,
  layoutFor,
  LINE_POINTS,
  lineCells,
  linePoints,
  linesAfter,
  MAX_CELL,
  MAX_SPAN,
  MAX_TRAY_CELL,
  MIN_CELL,
  MIN_TRAY_CELL,
  newRun,
  pickPiece,
  pieceById,
  PIECES,
  placementsOf,
  placePiece,
  RAMP_END,
  RAMP_START,
  SIDE_MARGIN,
  SIZE,
  slotAt,
  SNAP_REACH,
  SNAP_STICKY,
  snapTarget,
  STREAK_CAP,
  STREAK_POINTS,
  streakBonus,
  TRAY_REACH,
  TRAY_SIZE,
  weightOf,
  type Board,
  type Piece,
  type RunState,
} from './rules';

/** 미니게임 화면 위쪽 HUD의 높이(scenes/GameHud.ts의 HUD_HEIGHT). 그 파일은 Phaser를 끌어와서 여기서는 값만 적는다. */
const HUD_HEIGHT = 56;

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

/** 그림으로 판을 만든다. '#'은 채워진 칸(색 번호 1), '.'은 빈칸이다. */
function boardOf(picture: readonly string[]): number[] {
  expect(picture).toHaveLength(SIZE);
  return picture.flatMap((line) => {
    expect(line).toHaveLength(SIZE);
    return [...line].map((mark) => (mark === '#' ? 1 : 0));
  });
}

/** 판을 그림으로 바꾼다. 실패했을 때 읽기 쉽다. */
function pictureOf(board: Board): string[] {
  return Array.from({ length: SIZE }, (_, row) =>
    board
      .slice(row * SIZE, (row + 1) * SIZE)
      .map((color) => (color > 0 ? '#' : '.'))
      .join(''),
  );
}

function piece(id: string): Piece {
  const found = pieceById(id);
  if (!found) throw new Error(`${id}라는 블록이 없다`);
  return found;
}

/** 쟁반과 판을 정해 둔 상태를 만든다. */
function runWith(board: number[], tray: (Piece | null)[], extra: Partial<RunState> = {}): RunState {
  return { board, tray, score: 0, placed: 0, lines: 0, streak: 0, bestStreak: 0, over: false, ...extra };
}

const DOT = piece('dot-1');
const BAR2_H = piece('bar2-1');
const BAR2_V = piece('bar2-2');
const BAR3_H = piece('bar3-1');
const BAR3_V = piece('bar3-2');
const BAR4_H = piece('bar4-1');
const BAR5_H = piece('bar5-1');
const BAR5_V = piece('bar5-2');
const BOX2 = piece('box2-1');
const BOX3 = piece('box3-1');

describe('블록 목록', () => {
  it('이름이 모두 다르고, 같은 모양이 두 번 들어 있지 않다', () => {
    expect(new Set(PIECES.map((entry) => entry.id)).size).toBe(PIECES.length);
    const shapes = PIECES.map((entry) =>
      entry.cells
        .map(([col, row]) => `${col},${row}`)
        .sort()
        .join(' '),
    );
    expect(new Set(shapes).size).toBe(PIECES.length);
  });

  it('칸은 왼쪽 위에 붙어 있고 폭과 높이 안에 들어 있다', () => {
    for (const entry of PIECES) {
      const cols = entry.cells.map(([col]) => col);
      const rows = entry.cells.map(([, row]) => row);
      expect(Math.min(...cols), entry.id).toBe(0);
      expect(Math.min(...rows), entry.id).toBe(0);
      expect(Math.max(...cols), entry.id).toBe(entry.width - 1);
      expect(Math.max(...rows), entry.id).toBe(entry.height - 1);
    }
  });

  it('한 블록의 칸은 모두 변으로 이어져 있다', () => {
    for (const entry of PIECES) {
      const seen = new Set<string>([entry.cells[0].join()]);
      const queue = [entry.cells[0]];
      while (queue.length > 0) {
        const [col, row] = queue.pop()!;
        for (const [nextCol, nextRow] of [[col + 1, row], [col - 1, row], [col, row + 1], [col, row - 1]]) {
          const key = `${nextCol},${nextRow}`;
          if (seen.has(key) || !entry.cells.some(([c, r]) => c === nextCol && r === nextRow)) continue;
          seen.add(key);
          queue.push([nextCol, nextRow]);
        }
      }
      expect(seen.size, entry.id).toBe(entry.cells.length);
    }
  });

  it('한 칸부터 다섯 칸까지의 블록과, 아홉 칸짜리 큰 네모가 있다', () => {
    const sizes = new Set(PIECES.map((entry) => entry.cells.length));
    expect([...sizes].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 9]);
    expect(PIECES.filter((entry) => entry.cells.length === 9).map((entry) => entry.id)).toEqual(['box3-1']);
    expect(MAX_SPAN).toBe(5);
  });

  it('돌리거나 뒤집은 모양은 서로 다른 블록이고 같은 색을 쓴다', () => {
    const families = new Map<string, Piece[]>();
    for (const entry of PIECES) families.set(entry.family, [...(families.get(entry.family) ?? []), entry]);
    expect(families.get('bar3')).toHaveLength(2);
    expect(families.get('bend3')).toHaveLength(4);
    expect(families.get('ell4')).toHaveLength(8);
    expect(families.get('tee4')).toHaveLength(4);
    expect(families.get('zig4')).toHaveLength(4);
    expect(families.get('bend5')).toHaveLength(4);
    for (const members of families.values()) {
      expect(new Set(members.map((entry) => entry.color)).size).toBe(1);
      expect(new Set(members.map((entry) => entry.cells.length)).size).toBe(1);
    }
    // 갈래마다 색이 다르다.
    expect(new Set([...families.values()].map((members) => members[0].color)).size).toBe(families.size);
    expect(families.size).toBe(COLOR_COUNT);
    for (const entry of PIECES) {
      expect(entry.color).toBeGreaterThanOrEqual(1);
      expect(entry.color).toBeLessThanOrEqual(COLOR_COUNT);
    }
  });
});

describe('놓을 수 있는 자리', () => {
  it('빈 판에서는 판 안이면 어디든 놓을 수 있다', () => {
    const board = emptyBoard();
    expect(canPlace(board, BOX3, 0, 0)).toBe(true);
    expect(canPlace(board, BOX3, 5, 5)).toBe(true);
    expect(canPlace(board, BAR5_H, 3, 7)).toBe(true);
    for (const entry of PIECES) {
      expect(placementsOf(board, entry), entry.id).toHaveLength(
        (SIZE - entry.width + 1) * (SIZE - entry.height + 1),
      );
    }
  });

  it('판 밖으로 나가는 자리에는 놓을 수 없다', () => {
    const board = emptyBoard();
    expect(canPlace(board, BOX3, 6, 0)).toBe(false);
    expect(canPlace(board, BOX3, 0, 6)).toBe(false);
    expect(canPlace(board, BAR5_H, 4, 0)).toBe(false);
    expect(canPlace(board, BAR5_V, 0, 4)).toBe(false);
    expect(canPlace(board, DOT, -1, 0)).toBe(false);
    expect(canPlace(board, DOT, 0, -1)).toBe(false);
    expect(canPlace(board, DOT, 8, 0)).toBe(false);
    expect(canPlace(board, DOT, 0, 8)).toBe(false);
  });

  it('칸 사이에 걸친 자리(정수가 아닌 자리)에는 놓을 수 없다', () => {
    expect(canPlace(emptyBoard(), DOT, 0.5, 0)).toBe(false);
    expect(canPlace(emptyBoard(), DOT, 0, Number.NaN)).toBe(false);
  });

  it('채워진 칸과 겹치는 자리에는 놓을 수 없다', () => {
    const board = boardOf([
      '........',
      '.#......',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
    ]);
    expect(canPlace(board, BOX2, 0, 0)).toBe(false);
    expect(canPlace(board, BOX2, 1, 1)).toBe(false);
    expect(canPlace(board, BOX2, 2, 0)).toBe(true);
    expect(canPlace(board, DOT, 1, 1)).toBe(false);
    expect(canPlace(board, DOT, 1, 0)).toBe(true);
  });

  it('블록의 빈 귀퉁이는 채워진 칸과 겹쳐도 된다', () => {
    const board = boardOf([
      '.#......',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
    ]);
    // '#.' 위에 '##'가 오는 모양: 오른쪽 위 귀퉁이가 비어 있다.
    const bend = piece('bend3-1');
    expect(bend.cells).toEqual([[0, 0], [0, 1], [1, 1]]);
    expect(canPlace(board, bend, 0, 0)).toBe(true);
    expect(canPlace(board, piece('bend3-2'), 0, 0)).toBe(false);
  });

  it('차지하는 칸 번호를 알려 준다', () => {
    expect(cellsAt(BAR3_H, 2, 1)).toEqual([10, 11, 12]);
    expect(cellsAt(BAR3_V, 7, 5)).toEqual([47, 55, 63]);
    expect(cellIndex(3, 2)).toBe(19);
  });

  it('놓을 곳이 하나라도 있는지 알려 준다', () => {
    const board = boardOf([
      '#.#.#.#.',
      '.#.#.#.#',
      '#.#.#.#.',
      '.#.#.#.#',
      '#.#.#.#.',
      '.#.#.#.#',
      '#.#.#.#.',
      '.#.#.#.#',
    ]);
    expect(fitsAnywhere(board, DOT)).toBe(true);
    for (const entry of PIECES) {
      expect(fitsAnywhere(board, entry), entry.id).toBe(entry === DOT);
      expect(placementsOf(board, entry).length > 0).toBe(entry === DOT);
    }
    expect(placementsOf(board, DOT)).toHaveLength(32);
  });
});

describe('끌어다 놓을 때 붙는 자리', () => {
  it('칸에 딱 맞게 가져가면 그 자리다', () => {
    expect(snapTarget(emptyBoard(), BOX2, 3, 4)).toEqual({ col: 3, row: 4 });
  });

  it('조금 어긋나도 가장 가까운 칸에 붙는다', () => {
    expect(snapTarget(emptyBoard(), BOX2, 3.4, 3.6)).toEqual({ col: 3, row: 4 });
    expect(snapTarget(emptyBoard(), BOX2, 2.6, 4.45)).toEqual({ col: 3, row: 4 });
  });

  it('판 가장자리 밖으로 조금 나가도 가장자리 칸에 붙는다', () => {
    expect(snapTarget(emptyBoard(), BAR3_H, -0.6, 7.5)).toEqual({ col: 0, row: 7 });
    expect(snapTarget(emptyBoard(), BAR3_H, 5.7, -0.4)).toEqual({ col: 5, row: 0 });
  });

  it('판에서 멀리 벗어나면 붙지 않는다', () => {
    expect(snapTarget(emptyBoard(), BAR3_H, -1.2, 3)).toBeNull();
    expect(snapTarget(emptyBoard(), BAR3_H, 3, 8.95)).toBeNull();
    expect(snapTarget(emptyBoard(), DOT, 3, 7 + SNAP_REACH + 0.01)).toBeNull();
    expect(snapTarget(emptyBoard(), DOT, 3, 7 + SNAP_REACH - 0.01)).toEqual({ col: 3, row: 7 });
  });

  it('가까운 칸이 막혀 있으면 닿는 거리 안의 다른 빈자리에 붙는다', () => {
    const board = boardOf([
      '........',
      '........',
      '...#....',
      '........',
      '........',
      '........',
      '........',
      '........',
    ]);
    // (3, 2)는 막혀 있다. 살짝 오른쪽으로 치우쳐 있으면 오른쪽 칸에 붙는다.
    expect(snapTarget(board, DOT, 3.3, 2)).toEqual({ col: 4, row: 2 });
    expect(snapTarget(board, DOT, 3, 2.4)).toEqual({ col: 3, row: 3 });
    // 한가운데에서는 네 이웃이 똑같이 멀다(한 칸). 닿는 거리 밖이라 붙지 않는다.
    expect(SNAP_REACH).toBeLessThan(1);
    expect(snapTarget(board, DOT, 3, 2)).toBeNull();
  });

  it('붙어 있던 자리는 옆 칸이 뚜렷이 더 가까워질 때까지 놓지 않는다', () => {
    const board = emptyBoard();
    const held = { col: 3, row: 4 };
    // 경계(3.5)를 살짝 넘어도 붙어 있던 칸에 그대로 있다.
    expect(snapTarget(board, BOX2, 3.55, 4)).toEqual({ col: 4, row: 4 });
    expect(snapTarget(board, BOX2, 3.55, 4, held)).toEqual(held);
    expect(snapTarget(board, BOX2, 3.5 + SNAP_STICKY / 2 - 0.01, 4, held)).toEqual(held);
    // 차이가 벌어지면 옆 칸으로 넘어간다.
    expect(snapTarget(board, BOX2, 3.5 + SNAP_STICKY / 2 + 0.01, 4, held)).toEqual({ col: 4, row: 4 });
    expect(snapTarget(board, BOX2, 3.9, 4, held)).toEqual({ col: 4, row: 4 });
    // 반대쪽으로 돌아올 때도 마찬가지다.
    expect(snapTarget(board, BOX2, 3.45, 4, { col: 4, row: 4 })).toEqual({ col: 4, row: 4 });
    expect(snapTarget(board, BOX2, 3.4, 4, { col: 4, row: 4 })).toEqual({ col: 3, row: 4 });
  });

  it('붙어 있던 자리가 닿지 않거나 막혔으면 따르지 않는다', () => {
    const board = emptyBoard();
    expect(snapTarget(board, DOT, 6, 6, { col: 1, row: 1 })).toEqual({ col: 6, row: 6 });
    expect(snapTarget(board, DOT, -3, 6, { col: 0, row: 6 })).toBeNull();
    board[cellIndex(3, 4)] = 1;
    expect(snapTarget(board, DOT, 3.55, 4, { col: 3, row: 4 })).toEqual({ col: 4, row: 4 });
    // 붙어 있던 자리를 넘겨받아도 돌려주는 값은 새로 만든 것이다.
    const held = { col: 5, row: 5 };
    const snap = snapTarget(emptyBoard(), DOT, 5.1, 5, held);
    expect(snap).toEqual(held);
    expect(snap).not.toBe(held);
  });

  it('놓을 수 있는 자리 가운데 가장 가까운 것을 고른다', () => {
    const random = seeded(11);
    for (let round = 0; round < 300; round += 1) {
      const board = emptyBoard().map(() => (random() < 0.35 ? 1 : 0));
      const entry = PIECES[Math.floor(random() * PIECES.length)];
      const col = random() * 9 - 1;
      const row = random() * 9 - 1;
      const snap = snapTarget(board, entry, col, row);
      const spots = placementsOf(board, entry).map((spot) => ({
        ...spot,
        distance: Math.hypot(spot.col - col, spot.row - row),
      }));
      const nearest = Math.min(Infinity, ...spots.map((spot) => spot.distance));
      if (nearest > SNAP_REACH) {
        expect(snap).toBeNull();
      } else {
        expect(snap).not.toBeNull();
        expect(Math.hypot(snap!.col - col, snap!.row - row)).toBeCloseTo(nearest, 9);
        expect(canPlace(board, entry, snap!.col, snap!.row)).toBe(true);
      }
    }
  });
});

describe('줄 지우기', () => {
  it('가득 찬 가로줄을 찾는다', () => {
    const board = boardOf([
      '........',
      '########',
      '#######.',
      '........',
      '........',
      '........',
      '........',
      '########',
    ]);
    expect(fullLines(board)).toEqual({ rows: [1, 7], cols: [] });
  });

  it('가득 찬 세로줄을 찾는다', () => {
    const board = boardOf([
      '#..#...#',
      '#..#...#',
      '#..#...#',
      '#..#...#',
      '#..#...#',
      '#..#...#',
      '#..#...#',
      '#......#',
    ]);
    expect(fullLines(board)).toEqual({ rows: [], cols: [0, 7] });
  });

  it('가로줄과 세로줄이 함께 찰 수 있다', () => {
    const board = boardOf([
      '..#.....',
      '..#.....',
      '########',
      '..#.....',
      '..#.....',
      '..#.....',
      '..#.....',
      '..#.....',
    ]);
    const lines = fullLines(board);
    expect(lines).toEqual({ rows: [2], cols: [2] });
    // 두 줄이 만나는 칸은 한 번만 센다: 8 + 8 - 1
    const cells = lineCells(lines);
    expect(cells).toHaveLength(15);
    expect(new Set(cells).size).toBe(15);
    expect(cells.filter((cell) => cell === cellIndex(2, 2))).toHaveLength(1);
  });

  it('빈 판에는 가득 찬 줄이 없다', () => {
    expect(fullLines(emptyBoard())).toEqual({ rows: [], cols: [] });
    expect(lineCells({ rows: [], cols: [] })).toEqual([]);
  });

  it('블록을 놓아 가로줄을 채우면 그 줄만 지워진다', () => {
    const board = boardOf([
      '........',
      '........',
      '........',
      '..#.....',
      '#####...',
      '.#......',
      '........',
      '........',
    ]);
    const result = placePiece(runWith(board, [BAR3_H, DOT, DOT]), 0, 5, 4, seeded(1))!;
    expect(result.lines).toEqual({ rows: [4], cols: [] });
    expect(result.cells).toEqual([37, 38, 39]);
    expect(result.cleared.map((entry) => entry.cell)).toEqual([32, 33, 34, 35, 36, 37, 38, 39]);
    expect(pictureOf(result.run.board)).toEqual([
      '........',
      '........',
      '........',
      '..#.....',
      '........',
      '.#......',
      '........',
      '........',
    ]);
  });

  it('블록을 놓아 세로줄을 채우면 그 줄만 지워진다', () => {
    const board = boardOf([
      '.....#..',
      '.....#..',
      '.....#.#',
      '.....#..',
      '....##..',
      '.....#..',
      '........',
      '........',
    ]);
    const result = placePiece(runWith(board, [DOT, BAR2_V, DOT]), 1, 5, 6, seeded(1))!;
    expect(result.lines).toEqual({ rows: [], cols: [5] });
    expect(pictureOf(result.run.board)).toEqual([
      '........',
      '........',
      '.......#',
      '........',
      '....#...',
      '........',
      '........',
      '........',
    ]);
  });

  it('한 번에 가로줄과 세로줄을 함께 지우고, 만나는 칸은 한 번만 지운다', () => {
    const board = boardOf([
      '...#....',
      '...#....',
      '...#....',
      '###.####',
      '...#....',
      '...#....',
      '...#...#',
      '...#....',
    ]);
    const result = placePiece(runWith(board, [DOT, DOT, DOT]), 2, 3, 3, seeded(1))!;
    expect(result.lines).toEqual({ rows: [3], cols: [3] });
    expect(result.cleared).toHaveLength(15);
    expect(filledCount(result.run.board)).toBe(1);
    expect(result.run.board[cellIndex(7, 6)]).toBe(1);
    expect(result.run.lines).toBe(2);
  });

  it('지워진 칸마다 지워지기 전의 색을 알려 준다', () => {
    const board = emptyBoard();
    for (let col = 0; col < 6; col += 1) board[cellIndex(col, 0)] = 1 + (col % 3);
    const result = placePiece(runWith(board, [BAR2_H, DOT, DOT]), 0, 6, 0, seeded(1))!;
    expect(result.cleared).toEqual([
      { cell: 0, color: 1 },
      { cell: 1, color: 2 },
      { cell: 2, color: 3 },
      { cell: 3, color: 1 },
      { cell: 4, color: 2 },
      { cell: 5, color: 3 },
      { cell: 6, color: BAR2_H.color },
      { cell: 7, color: BAR2_H.color },
    ]);
  });

  it('놓기 전에 지워질 줄을 미리 알려 준다', () => {
    const board = boardOf([
      '...#....',
      '...#....',
      '...#....',
      '###.####',
      '...#....',
      '...#....',
      '...#....',
      '...#....',
    ]);
    expect(linesAfter(board, DOT, 3, 3)).toEqual({ rows: [3], cols: [3] });
    expect(linesAfter(board, DOT, 0, 0)).toEqual({ rows: [], cols: [] });
    // 놓을 수 없는 자리면 지워질 줄도 없다.
    expect(linesAfter(board, DOT, 0, 3)).toEqual({ rows: [], cols: [] });
    // 미리 보기는 판을 바꾸지 않는다.
    expect(board[cellIndex(3, 3)]).toBe(0);
  });

  it('미리 알려 준 줄과 실제로 지워지는 줄이 같다', () => {
    const random = seeded(5);
    let cleared = 0;
    for (let round = 0; round < 400; round += 1) {
      const board = emptyBoard().map(() => (random() < 0.7 ? 1 : 0));
      // 이미 가득 찬 줄이 있는 판은 실제 게임에서 나오지 않는다.
      for (const cell of lineCells(fullLines(board))) board[cell] = 0;
      const entry = PIECES[Math.floor(random() * PIECES.length)];
      for (const spot of placementsOf(board, entry)) {
        const preview = linesAfter(board, entry, spot.col, spot.row);
        const result = placePiece(runWith(board, [entry, null, DOT]), 0, spot.col, spot.row, random)!;
        expect(result.lines).toEqual(preview);
        expect(fullLines(result.run.board)).toEqual({ rows: [], cols: [] });
        cleared += preview.rows.length + preview.cols.length;
      }
    }
    expect(cleared).toBeGreaterThan(50);
  });
});

describe('점수', () => {
  it('줄 점수는 한꺼번에 지운 줄 수만큼 곱해진다', () => {
    expect(linePoints(0)).toBe(0);
    expect(linePoints(1)).toBe(LINE_POINTS);
    expect(linePoints(2)).toBe(LINE_POINTS * 2 * 2);
    expect(linePoints(3)).toBe(LINE_POINTS * 3 * 3);
    expect(linePoints(6)).toBe(LINE_POINTS * 6 * 6);
  });

  it('연속 보너스는 두 번째부터 붙고, 정해진 횟수에서 멈춘다', () => {
    expect(streakBonus(0)).toBe(0);
    expect(streakBonus(1)).toBe(0);
    expect(streakBonus(2)).toBe(STREAK_POINTS);
    expect(streakBonus(3)).toBe(STREAK_POINTS * 2);
    expect(streakBonus(STREAK_CAP)).toBe(STREAK_POINTS * (STREAK_CAP - 1));
    expect(streakBonus(STREAK_CAP + 5)).toBe(streakBonus(STREAK_CAP));
  });

  it('블록을 놓으면 칸 수만큼 점수를 받는다', () => {
    const run = runWith(emptyBoard(), [BOX3, BAR5_H, DOT]);
    const first = placePiece(run, 0, 0, 0, seeded(1))!;
    expect(first.points).toEqual({ cells: 9 * CELL_POINTS, lines: 0, streak: 0, total: 9 });
    expect(first.run.score).toBe(9);
    const second = placePiece(first.run, 2, 7, 7, seeded(1))!;
    expect(second.points.total).toBe(1);
    expect(second.run.score).toBe(10);
  });

  it('줄을 지우면 칸 점수에 줄 점수가 더해진다', () => {
    const board = boardOf([
      '#####...',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
    ]);
    const result = placePiece(runWith(board, [BAR3_H, DOT, DOT]), 0, 5, 0, seeded(1))!;
    expect(result.points).toEqual({ cells: 3, lines: 10, streak: 0, total: 13 });
  });

  it('두 줄을 한꺼번에 지우면 한 줄씩 두 번 지운 것보다 많이 받는다', () => {
    const board = boardOf([
      '######..',
      '######..',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
    ]);
    const result = placePiece(runWith(board, [BOX2, DOT, DOT]), 0, 6, 0, seeded(1))!;
    expect(result.lines.rows).toEqual([0, 1]);
    expect(result.points).toEqual({ cells: 4, lines: 40, streak: 0, total: 44 });
    expect(result.points.lines).toBeGreaterThan(linePoints(1) * 2);
  });

  it('블록을 놓을 때마다 줄을 지우면 연속 횟수가 오르고 보너스가 붙는다', () => {
    const board = boardOf([
      '#######.',
      '#######.',
      '#######.',
      '........',
      '........',
      '........',
      '........',
      '........',
    ]);
    const rng = seeded(1);
    const first = placePiece(runWith(board, [DOT, DOT, DOT]), 0, 7, 0, rng)!;
    expect(first.run.streak).toBe(1);
    expect(first.points).toEqual({ cells: 1, lines: 10, streak: 0, total: 11 });
    const second = placePiece(first.run, 1, 7, 1, rng)!;
    expect(second.run.streak).toBe(2);
    expect(second.points).toEqual({ cells: 1, lines: 10, streak: STREAK_POINTS, total: 21 });
    const third = placePiece(second.run, 2, 7, 2, rng)!;
    expect(third.run.streak).toBe(3);
    expect(third.points).toEqual({ cells: 1, lines: 10, streak: STREAK_POINTS * 2, total: 31 });
    expect(third.run.score).toBe(11 + 21 + 31);
    expect(third.run.bestStreak).toBe(3);
    expect(third.run.lines).toBe(3);
  });

  it('줄을 지우지 못하고 놓으면 연속이 끊긴다', () => {
    const board = boardOf([
      '#######.',
      '#######.',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
    ]);
    const rng = seeded(1);
    const first = placePiece(runWith(board, [DOT, DOT, DOT]), 0, 7, 0, rng)!;
    const miss = placePiece(first.run, 1, 0, 7, rng)!;
    expect(miss.run.streak).toBe(0);
    expect(miss.points).toEqual({ cells: 1, lines: 0, streak: 0, total: 1 });
    // 끊긴 뒤에 다시 지우면 처음부터 센다. 가장 길었던 기록은 남는다.
    const again = placePiece(miss.run, 2, 7, 1, rng)!;
    expect(again.run.streak).toBe(1);
    expect(again.points.streak).toBe(0);
    expect(again.run.bestStreak).toBe(1);
  });
});

describe('난이도', () => {
  it('처음 몇 개는 가장 쉽고, 그 뒤로 고르게 올라 끝에서 멈춘다', () => {
    expect(difficultyAt(0)).toBe(0);
    expect(difficultyAt(RAMP_START)).toBe(0);
    expect(difficultyAt((RAMP_START + RAMP_END) / 2)).toBeCloseTo(0.5, 9);
    expect(difficultyAt(RAMP_END)).toBe(1);
    expect(difficultyAt(RAMP_END * 10)).toBe(1);
    let previous = -1;
    for (let placed = 0; placed <= RAMP_END + 20; placed += 1) {
      const difficulty = difficultyAt(placed);
      expect(difficulty).toBeGreaterThanOrEqual(previous);
      expect(difficulty).toBeGreaterThanOrEqual(0);
      expect(difficulty).toBeLessThanOrEqual(1);
      previous = difficulty;
    }
  });

  it('모든 블록은 언제나 나올 수 있다', () => {
    for (const placed of [0, RAMP_START, 40, RAMP_END, 500]) {
      for (const entry of PIECES) expect(weightOf(entry, placed), entry.id).toBeGreaterThan(0);
    }
  });

  it('무게는 시작할 때의 값에서 끝의 값으로 옮겨 간다', () => {
    for (const entry of PIECES) {
      expect(weightOf(entry, 0)).toBeCloseTo(entry.early, 9);
      expect(weightOf(entry, RAMP_END)).toBeCloseTo(entry.late, 9);
      const middle = weightOf(entry, (RAMP_START + RAMP_END) / 2);
      expect(middle).toBeCloseTo((entry.early + entry.late) / 2, 9);
    }
  });

  /** 뽑힐 확률로 따진, 블록 하나의 평균 칸 수 */
  const meanCells = (placed: number): number => {
    const total = PIECES.reduce((sum, entry) => sum + weightOf(entry, placed), 0);
    return PIECES.reduce((sum, entry) => sum + weightOf(entry, placed) * entry.cells.length, 0) / total;
  };
  /** 주어진 갈래들이 뽑힐 확률 */
  const share = (placed: number, families: readonly string[]): number => {
    const total = PIECES.reduce((sum, entry) => sum + weightOf(entry, placed), 0);
    return (
      PIECES.filter((entry) => families.includes(entry.family)).reduce(
        (sum, entry) => sum + weightOf(entry, placed),
        0,
      ) / total
    );
  };

  it('놓은 블록이 늘수록 큰 블록이 자주 나온다', () => {
    let previous = 0;
    for (let placed = 0; placed <= RAMP_END; placed += 10) {
      const mean = meanCells(placed);
      expect(mean).toBeGreaterThanOrEqual(previous);
      previous = mean;
    }
    expect(meanCells(0)).toBeLessThan(3.6);
    expect(meanCells(RAMP_END)).toBeGreaterThan(4.5);
  });

  it('작은 블록은 줄고, 크고 까다로운 블록은 는다', () => {
    const small = ['dot', 'bar2', 'bar3', 'bend3'];
    const awkward = ['zig4', 'bar5', 'bend5', 'box3'];
    expect(share(0, small)).toBeGreaterThan(0.4);
    expect(share(RAMP_END, small)).toBeLessThan(0.15);
    expect(share(0, awkward)).toBeLessThan(0.16);
    expect(share(RAMP_END, awkward)).toBeGreaterThan(0.45);
    // 아홉 칸짜리 네모는 처음에는 거의 안 나오다가 끝에서는 흔해진다.
    expect(share(0, ['box3'])).toBeLessThan(0.02);
    expect(share(RAMP_END, ['box3'])).toBeGreaterThan(0.1);
  });

  it('뽑힌 블록의 비율이 무게를 따른다', () => {
    const random = seeded(3);
    for (const placed of [0, RAMP_END]) {
      const counts = new Map<string, number>();
      const rounds = 20000;
      for (let round = 0; round < rounds; round += 1) {
        const family = pickPiece(placed, random).family;
        counts.set(family, (counts.get(family) ?? 0) + 1);
      }
      for (const family of new Set(PIECES.map((entry) => entry.family))) {
        expect((counts.get(family) ?? 0) / rounds, `${family} @${placed}`).toBeCloseTo(
          share(placed, [family]),
          1,
        );
      }
    }
  });

  it('난수가 끝 값에 가까워도 블록을 돌려준다', () => {
    expect(pickPiece(0, () => 0)).toBe(PIECES[0]);
    expect(pickPiece(0, () => 0.9999999999)).toBe(PIECES[PIECES.length - 1]);
    expect(PIECES).toContain(pickPiece(50, () => 1));
  });
});

describe('나눠 주기', () => {
  it('세 개를 준다', () => {
    const tray = dealTray(emptyBoard(), 0, seeded(1));
    expect(tray).toHaveLength(TRAY_SIZE);
    for (const entry of tray) expect(PIECES).toContain(entry);
  });

  it('같은 시드면 같은 블록이 나온다', () => {
    const ids = (seed: number) => dealTray(emptyBoard(), 30, seeded(seed)).map((entry) => entry.id);
    expect(ids(42)).toEqual(ids(42));
    const variety = new Set<string>();
    for (let seed = 0; seed < 30; seed += 1) variety.add(ids(seed).join());
    expect(variety.size).toBeGreaterThan(20);
  });

  it('빈칸이 있는 판이면 셋 가운데 하나는 반드시 놓을 수 있다', () => {
    const random = seeded(9);
    for (let round = 0; round < 1500; round += 1) {
      // 빽빽한 판일수록 놓을 수 있는 블록이 드물다.
      const density = 0.5 + random() * 0.45;
      const board = emptyBoard().map(() => (random() < density ? 1 : 0));
      for (const cell of lineCells(fullLines(board))) board[cell] = 0;
      if (filledCount(board) === CELLS) continue;
      const tray = dealTray(board, Math.floor(random() * 200), random);
      expect(tray.some((entry) => fitsAnywhere(board, entry)), pictureOf(board).join('\n')).toBe(true);
    }
  });

  it('한 칸짜리만 들어가는 판에서는 한 칸짜리가 나온다', () => {
    const board = boardOf([
      '#.#.#.#.',
      '.#.#.#.#',
      '#.#.#.#.',
      '.#.#.#.#',
      '#.#.#.#.',
      '.#.#.#.#',
      '#.#.#.#.',
      '.#.#.#.#',
    ]);
    for (let seed = 0; seed < 50; seed += 1) {
      const tray = dealTray(board, RAMP_END, seeded(seed));
      expect(tray).toContain(DOT);
    }
  });

  it('여러 번 다시 뽑아도 안 되면 첫 자리를 놓을 수 있는 가장 큰 블록으로 바꾼다', () => {
    // 가로로 두 칸짜리 틈 하나만 남은 판
    const board = emptyBoard().map(() => 1);
    board[cellIndex(3, 4)] = 0;
    board[cellIndex(4, 4)] = 0;
    board[cellIndex(0, 0)] = 0;
    expect(largestFitting(board)).toBe(BAR2_H);

    // 언제나 마지막 블록(아홉 칸짜리 네모)만 뽑히는 난수
    let calls = 0;
    const stubborn = (): number => {
      calls += 1;
      return 0.9999999;
    };
    const tray = dealTray(board, 0, stubborn);
    expect(calls).toBe(DEAL_ATTEMPTS * TRAY_SIZE);
    expect(tray.map((entry) => entry.id)).toEqual(['bar2-1', 'box3-1', 'box3-1']);
    expect(fitsAnywhere(board, tray[0])).toBe(true);
  });

  it('놓을 수 있는 블록이 처음부터 뽑히면 다시 뽑지 않는다', () => {
    let calls = 0;
    const counting = (): number => {
      calls += 1;
      return 0.5;
    };
    dealTray(emptyBoard(), 0, counting);
    expect(calls).toBe(TRAY_SIZE);
  });

  it('놓을 수 있는 가장 큰 블록을 찾는다', () => {
    expect(largestFitting(emptyBoard())).toBe(BOX3);
    const full = emptyBoard().map(() => 1);
    expect(largestFitting(full)).toBeNull();
    full[10] = 0;
    expect(largestFitting(full)).toBe(DOT);
    // 꽉 찬 판에서도 세 개를 돌려준다(실제 게임에서는 가득 찬 줄이 지워지므로 나오지 않는 판이다).
    expect(dealTray(emptyBoard().map(() => 1), 0, seeded(1))).toHaveLength(TRAY_SIZE);
  });
});

describe('한 판', () => {
  it('빈 판과 블록 세 개로 시작한다', () => {
    const run = newRun(seeded(1));
    expect(run.board).toEqual(emptyBoard());
    expect(run.tray).toHaveLength(TRAY_SIZE);
    expect(run.tray.every((entry) => entry !== null)).toBe(true);
    expect(run).toMatchObject({ score: 0, placed: 0, lines: 0, streak: 0, bestStreak: 0, over: false });
  });

  it('놓은 블록은 판에 그 색으로 남고 쟁반에서 빠진다', () => {
    const run = runWith(emptyBoard(), [BAR4_H, BOX2, DOT]);
    const result = placePiece(run, 0, 2, 3, seeded(1))!;
    expect(result.piece).toBe(BAR4_H);
    expect(result.cells).toEqual([26, 27, 28, 29]);
    for (const cell of result.cells) expect(result.run.board[cell]).toBe(BAR4_H.color);
    expect(filledCount(result.run.board)).toBe(4);
    expect(result.run.tray).toEqual([null, BOX2, DOT]);
    expect(result.run.placed).toBe(1);
    expect(result.dealt).toBe(false);
  });

  it('놓을 수 없는 자리, 빈 쟁반 자리, 없는 자리는 받아들이지 않는다', () => {
    const board = emptyBoard();
    board[0] = 1;
    const run = runWith(board, [BOX2, null, DOT]);
    expect(placePiece(run, 0, 0, 0, seeded(1))).toBeNull();
    expect(placePiece(run, 0, 7, 7, seeded(1))).toBeNull();
    expect(placePiece(run, 1, 3, 3, seeded(1))).toBeNull();
    expect(placePiece(run, 5, 3, 3, seeded(1))).toBeNull();
    expect(placePiece(run, 0, 1.5, 3, seeded(1))).toBeNull();
    expect(placePiece(run, 0, 3, 3, seeded(1))).not.toBeNull();
  });

  it('원본 상태는 바꾸지 않는다', () => {
    const run = runWith(emptyBoard(), [BAR4_H, BOX2, DOT]);
    const copy = JSON.stringify(run);
    placePiece(run, 0, 2, 3, seeded(1));
    placePiece(run, 2, 0, 0, seeded(1));
    expect(JSON.stringify(run)).toBe(copy);
  });

  it('세 개를 다 놓으면 새로 세 개를 받는다', () => {
    const rng = seeded(4);
    let run = runWith(emptyBoard(), [DOT, DOT, DOT]);
    const first = placePiece(run, 1, 0, 0, rng)!;
    expect(first.dealt).toBe(false);
    run = first.run;
    const second = placePiece(run, 0, 2, 0, rng)!;
    expect(second.dealt).toBe(false);
    expect(second.run.tray).toEqual([null, null, DOT]);
    const third = placePiece(second.run, 2, 4, 0, rng)!;
    expect(third.dealt).toBe(true);
    expect(third.run.tray.every((entry) => entry !== null)).toBe(true);
    expect(third.run.placed).toBe(3);
  });

  it('새로 받는 블록은 줄을 지운 뒤의 판에 맞춰 뽑는다', () => {
    // 마지막 블록으로 줄을 지우면 판이 비어서, 어떤 블록이 나와도 놓을 수 있다.
    const board = boardOf([
      '#######.',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
    ]);
    let calls = 0;
    const counting = (): number => {
      calls += 1;
      return 0.9999999;
    };
    const result = placePiece(runWith(board, [null, DOT, null]), 1, 7, 0, counting)!;
    expect(result.dealt).toBe(true);
    expect(filledCount(result.run.board)).toBe(0);
    expect(calls).toBe(TRAY_SIZE);
    expect(result.run.over).toBe(false);
  });

  it('쟁반에 남은 블록을 놓을 곳이 없으면 끝난다', () => {
    const board = boardOf([
      '##.##.##',
      '##.##.##',
      '........',
      '##.##.##',
      '##.##.##',
      '........',
      '##.##.##',
      '##.##.##',
    ]);
    // 한 칸짜리를 놓고 나면 남은 큰 네모 둘은 들어갈 곳이 없다.
    const result = placePiece(runWith(board, [DOT, BOX3, BOX2]), 0, 2, 2, seeded(1))!;
    expect(result.run.over).toBe(true);
    expect(anyFits(result.run.board, result.run.tray)).toBe(false);
    // 끝난 판에는 더 놓을 수 없다.
    expect(placePiece(result.run, 1, 0, 0, seeded(1))).toBeNull();
  });

  it('남은 블록 가운데 하나라도 놓을 수 있으면 끝나지 않는다', () => {
    const board = boardOf([
      '##.##.##',
      '##.##.##',
      '........',
      '##.##.##',
      '##.##.##',
      '........',
      '##.##.##',
      '##.##.##',
    ]);
    const result = placePiece(runWith(board, [DOT, BOX3, BAR5_H]), 0, 2, 0, seeded(1))!;
    expect(fitsAnywhere(result.run.board, BOX3)).toBe(false);
    expect(fitsAnywhere(result.run.board, BAR5_H)).toBe(true);
    expect(result.run.over).toBe(false);
  });

  it('줄을 지워서 자리가 생기면 끝나지 않는다', () => {
    const board = boardOf([
      '#######.',
      '#######.',
      '#######.',
      '#.#.#.#.',
      '.#.#.#.#',
      '#.#.#.#.',
      '.#.#.#.#',
      '#.#.#.#.',
    ]);
    // 세로 막대 셋을 놓으면 위의 세 줄이 지워져서 큰 네모가 들어갈 자리가 생긴다.
    expect(fitsAnywhere(board, BOX3)).toBe(false);
    const result = placePiece(runWith(board, [BAR3_V, BOX3, null]), 0, 7, 0, seeded(1))!;
    expect(result.lines.rows).toEqual([0, 1, 2]);
    expect(result.run.over).toBe(false);
    expect(fitsAnywhere(result.run.board, BOX3)).toBe(true);
  });

  it('새 블록을 받은 직후에도 놓을 곳이 있는지 확인한다', () => {
    expect(anyFits(emptyBoard(), [null, null, null])).toBe(false);
    expect(anyFits(emptyBoard(), [null, BOX3, null])).toBe(true);
    const full = emptyBoard().map(() => 1);
    expect(anyFits(full, [DOT, BOX2, BOX3])).toBe(false);
    // 흩어진 한 칸짜리 틈만 남은 판에는 두 칸짜리가 들어가지 않는다.
    const holes = boardOf([
      '#######.',
      '.#######',
      '#.######',
      '##.#####',
      '###.####',
      '####.###',
      '#####.##',
      '######.#',
    ]);
    expect(anyFits(holes, [BAR2_H, BAR2_V, null])).toBe(false);
    expect(anyFits(holes, [BAR2_H, BAR2_V, DOT])).toBe(true);
  });

  it('끝까지 두어도 상태가 어긋나지 않고, 언젠가는 끝난다', () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const rng = seeded(seed);
      const choose = seeded(seed + 1000);
      let run = newRun(rng);
      let score = 0;
      let filled = 0;
      let guard = 0;
      while (!run.over) {
        guard += 1;
        expect(guard).toBeLessThan(3000);
        // 놓을 수 있는 자리 가운데 줄을 가장 많이 지우는 곳, 같으면 아무 데나 고른다.
        const moves = run.tray.flatMap((entry, slot) =>
          entry ? placementsOf(run.board, entry).map((spot) => ({ slot, ...spot, entry })) : [],
        );
        expect(moves.length).toBeGreaterThan(0);
        const scored = moves.map((move) => {
          const lines = linesAfter(run.board, move.entry, move.col, move.row);
          return { move, value: lines.rows.length + lines.cols.length + choose() * 0.5 };
        });
        const { move } = scored.reduce((best, entry) => (entry.value > best.value ? entry : best));
        const result = placePiece(run, move.slot, move.col, move.row, rng)!;
        expect(result).not.toBeNull();

        score += result.points.total;
        filled += result.cells.length - result.cleared.length;
        expect(result.run.score).toBe(score);
        expect(filledCount(result.run.board)).toBe(filled);
        expect(fullLines(result.run.board)).toEqual({ rows: [], cols: [] });
        expect(result.run.placed).toBe(run.placed + 1);
        expect(result.run.bestStreak).toBeGreaterThanOrEqual(result.run.streak);
        expect(result.run.over).toBe(!anyFits(result.run.board, result.run.tray));
        // 새로 받은 직후에는 반드시 하나는 놓을 수 있다.
        if (result.dealt) expect(result.run.over).toBe(false);
        run = result.run;
      }
      expect(run.placed).toBeGreaterThan(3);
    }
  });
});

describe('자리 잡기', () => {
  const heights: number[] = [];
  for (let height = MIN_GAME_HEIGHT; height <= MAX_GAME_HEIGHT; height += 1) heights.push(height);
  const areaFor = (height: number) => ({ x: 0, y: HUD_HEIGHT, width: GAME_WIDTH, height: height - HUD_HEIGHT });

  it('모든 화면 높이에서 판이 HUD 아래, 좌우 여백 안에 들어간다', () => {
    for (const height of heights) {
      const layout = layoutFor(areaFor(height));
      expect(layout.cell, `${height}`).toBe(MAX_CELL);
      expect(layout.top - BOARD_RIM).toBeGreaterThanOrEqual(HUD_HEIGHT + GAPS.top);
      expect(layout.left - BOARD_RIM).toBeGreaterThanOrEqual(SIDE_MARGIN);
      expect(layout.left + layout.cell * SIZE + BOARD_RIM).toBeLessThanOrEqual(GAME_WIDTH - SIDE_MARGIN);
      // 판은 가로로 한가운데에 놓인다.
      expect(layout.left * 2 + layout.cell * SIZE).toBe(GAME_WIDTH);
    }
  });

  it('모든 화면 높이에서 쟁반이 판 아래, 화면 안에 들어가고 서로 겹치지 않는다', () => {
    for (const height of heights) {
      const layout = layoutFor(areaFor(height));
      const boardBottom = layout.top + layout.cell * SIZE + BOARD_RIM + BOARD_LIP;
      expect(layout.tray.y, `${height}`).toBeGreaterThanOrEqual(boardBottom + GAPS.middle);
      expect(layout.tray.y + layout.tray.height + BOARD_LIP).toBeLessThanOrEqual(height - GAPS.bottom + BOARD_LIP);
      expect(layout.tray.y + layout.tray.height + BOARD_LIP).toBeLessThanOrEqual(height);
      expect(layout.tray.x).toBe(SIDE_MARGIN);
      expect(layout.tray.x + layout.tray.width).toBe(GAME_WIDTH - SIDE_MARGIN);
      expect(layout.tray.height).toBe(layout.slotHeight);
    }
  });

  it('가장 긴 블록도 쟁반의 제자리 안에 들어가고, 옆자리 블록과 닿지 않는다', () => {
    for (const height of heights) {
      const layout = layoutFor(areaFor(height));
      expect(layout.trayCell).toBeGreaterThanOrEqual(MIN_TRAY_CELL);
      expect(layout.trayCell).toBeLessThanOrEqual(MAX_TRAY_CELL);
      const span = MAX_SPAN * layout.trayCell;
      expect(span).toBeLessThan(layout.slotWidth);
      expect(span).toBeLessThan(layout.slotHeight);
      expect(layout.slots).toHaveLength(TRAY_SIZE);
      layout.slots.forEach((slot, index) => {
        expect(slot.y).toBe(Math.round(layout.tray.y + layout.tray.height / 2));
        expect(slot.x - span / 2).toBeGreaterThan(layout.tray.x + 2);
        expect(slot.x + span / 2).toBeLessThan(layout.tray.x + layout.tray.width - 2);
        if (index > 0) expect(slot.x - layout.slots[index - 1].x).toBe(layout.slotWidth);
      });
      // 누르는 자리는 손가락으로 집기에 넉넉하다.
      expect(layout.slotWidth).toBeGreaterThanOrEqual(48);
      expect(layout.slotHeight).toBeGreaterThanOrEqual(48);
    }
  });

  it('화면이 길수록 판과 쟁반 사이와 쟁반이 넓어지고, 남는 높이는 위아래로 나뉜다', () => {
    const short = layoutFor(areaFor(MIN_GAME_HEIGHT));
    const tall = layoutFor(areaFor(MAX_GAME_HEIGHT));
    const gapOf = (layout: typeof short): number =>
      layout.tray.y - (layout.top + layout.cell * SIZE + BOARD_RIM + BOARD_LIP);
    expect(gapOf(tall)).toBeGreaterThan(gapOf(short));
    expect(tall.slotHeight).toBeGreaterThan(short.slotHeight);
    const above = tall.top - BOARD_RIM - HUD_HEIGHT;
    const below = MAX_GAME_HEIGHT - (tall.tray.y + tall.tray.height + BOARD_LIP);
    expect(above).toBeGreaterThan(40);
    expect(below).toBeGreaterThan(40);
    expect(Math.abs(above - below)).toBeLessThan(30);
  });

  it('높이가 아주 모자라면 쟁반의 블록을 먼저 줄이고 그다음에 판의 칸을 줄인다', () => {
    const squeezed = layoutFor({ x: 0, y: HUD_HEIGHT, width: GAME_WIDTH, height: 322 });
    expect(squeezed.cell).toBe(MAX_CELL);
    expect(squeezed.trayCell).toBeLessThan(MAX_TRAY_CELL);
    const tiny = layoutFor({ x: 0, y: HUD_HEIGHT, width: GAME_WIDTH, height: 290 });
    expect(tiny.trayCell).toBe(MIN_TRAY_CELL);
    expect(tiny.cell).toBeLessThan(MAX_CELL);
    expect(tiny.cell).toBeGreaterThanOrEqual(MIN_CELL);
    expect(tiny.tray.y + tiny.tray.height + BOARD_LIP).toBeLessThanOrEqual(HUD_HEIGHT + 290);
    expect(tiny.tray.y).toBeGreaterThan(tiny.top + tiny.cell * SIZE + BOARD_RIM + BOARD_LIP);
  });

  it('쟁반을 누르면 그 자리의 번호를 알려 준다', () => {
    for (const height of [MIN_GAME_HEIGHT, 488, MAX_GAME_HEIGHT]) {
      const layout = layoutFor(areaFor(height));
      layout.slots.forEach((slot, index) => {
        expect(slotAt(layout, slot.x, slot.y)).toBe(index);
        expect(slotAt(layout, slot.x - layout.slotWidth / 2 + 1, layout.tray.y)).toBe(index);
        expect(slotAt(layout, slot.x + layout.slotWidth / 2 - 1, layout.tray.y + layout.tray.height)).toBe(index);
      });
      // 받침의 좌우 가장자리와 화면 끝을 눌러도 가장 가까운 자리가 집힌다.
      expect(slotAt(layout, 0, layout.slots[0].y)).toBe(0);
      expect(slotAt(layout, GAME_WIDTH, layout.slots[0].y)).toBe(TRAY_SIZE - 1);
      // 받침 위아래로 조금 벗어난 곳까지는 받아 주고, 판 위는 쟁반이 아니다.
      expect(slotAt(layout, 120, layout.tray.y - TRAY_REACH)).toBe(1);
      expect(slotAt(layout, 120, layout.tray.y - TRAY_REACH - 1)).toBe(-1);
      expect(slotAt(layout, 120, layout.tray.y + layout.tray.height + TRAY_REACH + 1)).toBe(-1);
      expect(slotAt(layout, 120, layout.top + 50)).toBe(-1);
      // 쟁반을 누르는 자리는 판의 테두리와 겹치지 않는다.
      expect(layout.tray.y - TRAY_REACH).toBeGreaterThanOrEqual(layout.top + layout.cell * SIZE + BOARD_RIM + BOARD_LIP);
    }
  });

  it('끄는 블록은 손가락 위에 그려진다', () => {
    const layout = layoutFor(areaFor(MIN_GAME_HEIGHT));
    for (const entry of PIECES) {
      const center = dragCenter(entry, layout.cell, 100, 300, GAME_WIDTH);
      expect(center.x).toBe(100);
      // 블록의 아래 끝이 손가락보다 DRAG_LIFT만큼 위다.
      expect(center.y + (entry.height * layout.cell) / 2).toBe(300 - DRAG_LIFT);
    }
    expect(DRAG_LIFT).toBeGreaterThanOrEqual(40);
    expect(DRAG_LIFT).toBeLessThanOrEqual(50);
  });

  it('화면 가장자리에서 집은 긴 블록은 화면 안으로 당겨진다', () => {
    const layout = layoutFor(areaFor(MIN_GAME_HEIGHT));
    for (const entry of PIECES) {
      const half = (entry.width * layout.cell) / 2;
      for (const slot of layout.slots) {
        const center = dragCenter(entry, layout.cell, slot.x, slot.y, GAME_WIDTH);
        expect(center.x - half, entry.id).toBeGreaterThanOrEqual(DRAG_EDGE);
        expect(center.x + half, entry.id).toBeLessThanOrEqual(GAME_WIDTH - DRAG_EDGE);
      }
      expect(dragCenter(entry, layout.cell, -50, 300, GAME_WIDTH).x).toBe(half + DRAG_EDGE);
      expect(dragCenter(entry, layout.cell, 500, 300, GAME_WIDTH).x).toBe(GAME_WIDTH - half - DRAG_EDGE);
    }
    // 가로로 다섯 칸짜리를 왼쪽 자리에서 집으면 손가락보다 오른쪽으로 밀려 그려진다.
    expect(dragCenter(BAR5_H, layout.cell, layout.slots[0].x, 300, GAME_WIDTH).x).toBeGreaterThan(layout.slots[0].x);
    expect(dragCenter(DOT, layout.cell, layout.slots[0].x, 300, GAME_WIDTH).x).toBe(layout.slots[0].x);
  });

  it('손가락을 알맞은 곳에 두면 블록이 원하는 칸에 놓인다', () => {
    for (const height of [MIN_GAME_HEIGHT, 427, 520, MAX_GAME_HEIGHT]) {
      const layout = layoutFor(areaFor(height));
      for (const entry of PIECES) {
        for (const spot of placementsOf(emptyBoard(), entry)) {
          const fingerX = layout.left + (spot.col + entry.width / 2) * layout.cell;
          const fingerY = layout.top + (spot.row + entry.height) * layout.cell + DRAG_LIFT;
          // 맨 아랫줄에 놓을 때도 손가락은 화면 안에 있다.
          expect(fingerY).toBeLessThan(height);
          // 화면 안으로 당기는 것이 판 위의 자리를 건드리지 않는다.
          const center = dragCenter(entry, layout.cell, fingerX, fingerY, GAME_WIDTH);
          expect(center.x).toBe(fingerX);
          const at = boardCoords(layout, entry, center.x, center.y);
          expect(at.col).toBeCloseTo(spot.col, 9);
          expect(at.row).toBeCloseTo(spot.row, 9);
          expect(snapTarget(emptyBoard(), entry, at.col, at.row)).toEqual(spot);
        }
      }
    }
  });

});
