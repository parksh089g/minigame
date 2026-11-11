import { describe, expect, it } from 'vitest';
import type { SwipeDirection } from '../../core/swipe';
import {
  BONUS_FROM_LEVEL,
  BONUS_SECONDS,
  bonusSeconds,
  canMove,
  CELLS,
  emptyBoard,
  emptyCells,
  FOUR_CHANCE,
  linesFor,
  maxLevel,
  mergePoints,
  playTurn,
  SIZE,
  slide,
  spawnTile,
  START_TILES,
  startBoard,
  tileValue,
} from './rules';

/** 테스트마다 같은 순서의 수를 내는 작은 난수기 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** 줄 단위로 적은 판을 한 줄짜리 배열로 편다. 읽기 쉽게 타일에 적힌 숫자로 쓴다. */
function boardOf(rows: number[][]): number[] {
  return rows.flat().map((value) => (value === 0 ? 0 : Math.log2(value)));
}

function valuesOf(board: readonly number[]): number[][] {
  const rows: number[][] = [];
  for (let row = 0; row < SIZE; row += 1) {
    rows.push(board.slice(row * SIZE, row * SIZE + SIZE).map(tileValue));
  }
  return rows;
}

const DIRECTIONS: SwipeDirection[] = ['left', 'right', 'up', 'down'];

describe('판', () => {
  it('빈 판은 모든 칸이 0이다', () => {
    const board = emptyBoard();
    expect(board).toHaveLength(CELLS);
    expect(emptyCells(board)).toHaveLength(CELLS);
    expect(maxLevel(board)).toBe(0);
  });

  it('단계를 타일의 숫자로 바꾼다', () => {
    expect([0, 1, 2, 3, 10, 11].map(tileValue)).toEqual([0, 2, 4, 8, 1024, 2048]);
  });

  it('미는 쪽 벽에서부터 칸을 센다', () => {
    expect(linesFor('left')[0]).toEqual([0, 1, 2, 3]);
    expect(linesFor('right')[0]).toEqual([3, 2, 1, 0]);
    expect(linesFor('up')[1]).toEqual([1, 5, 9, 13]);
    expect(linesFor('down')[1]).toEqual([13, 9, 5, 1]);
    for (const direction of DIRECTIONS) {
      expect(linesFor(direction).flat().sort((a, b) => a - b)).toEqual([...Array(CELLS).keys()]);
    }
  });
});

describe('밀기', () => {
  it('타일이 벽까지 미끄러진다', () => {
    const board = boardOf([
      [0, 2, 0, 4],
      [0, 0, 0, 0],
      [8, 0, 0, 0],
      [0, 0, 0, 16],
    ]);
    expect(valuesOf(slide(board, 'left').board)).toEqual([
      [2, 4, 0, 0],
      [0, 0, 0, 0],
      [8, 0, 0, 0],
      [16, 0, 0, 0],
    ]);
    expect(valuesOf(slide(board, 'down').board)).toEqual([
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 4],
      [8, 2, 0, 16],
    ]);
  });

  it('같은 타일끼리 만나면 하나로 합쳐진다', () => {
    const board = boardOf([
      [2, 2, 0, 0],
      [4, 0, 0, 4],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    const result = slide(board, 'right');
    expect(valuesOf(result.board)).toEqual([
      [0, 0, 0, 4],
      [0, 0, 0, 8],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    expect(result.merges).toEqual([
      { cell: 3, level: 2 },
      { cell: 7, level: 3 },
    ]);
    expect(result.points).toBe(mergePoints(2) + mergePoints(3));
  });

  it('한 번 밀 때 한 타일은 한 번만 합쳐진다', () => {
    const row = (values: number[]) => boardOf([values, [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
    expect(valuesOf(slide(row([2, 2, 2, 2]), 'left').board)[0]).toEqual([4, 4, 0, 0]);
    expect(valuesOf(slide(row([4, 2, 2, 0]), 'left').board)[0]).toEqual([4, 4, 0, 0]);
    expect(valuesOf(slide(row([2, 2, 4, 0]), 'left').board)[0]).toEqual([4, 4, 0, 0]);
    // 셋이 나란하면 벽 쪽 둘이 먼저 합쳐진다.
    expect(valuesOf(slide(row([2, 2, 2, 0]), 'left').board)[0]).toEqual([4, 2, 0, 0]);
    expect(valuesOf(slide(row([2, 2, 2, 0]), 'right').board)[0]).toEqual([0, 0, 2, 4]);
  });

  it('모든 타일이 어디로 갔는지 알려 준다', () => {
    const board = boardOf([
      [2, 0, 2, 4],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    const result = slide(board, 'left');
    expect(result.moves).toEqual([
      { from: 0, to: 0, level: 1, absorbed: false },
      { from: 2, to: 0, level: 1, absorbed: true },
      { from: 3, to: 1, level: 2, absorbed: false },
    ]);
    expect(result.moved).toBe(true);
  });

  it('아무것도 움직이지 않으면 헛민 것이다', () => {
    const board = boardOf([
      [2, 4, 0, 0],
      [8, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    const result = slide(board, 'left');
    expect(result.moved).toBe(false);
    expect(result.board).toEqual(board);
    expect(result.points).toBe(0);
    expect(slide(board, 'up').moved).toBe(false);
    expect(slide(board, 'right').moved).toBe(true);
  });

  it('원본 판은 바꾸지 않는다', () => {
    const board = boardOf([
      [2, 2, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    const copy = [...board];
    slide(board, 'right');
    spawnTile(board, seeded(1));
    playTurn(board, 'right', seeded(1));
    expect(board).toEqual(copy);
  });

  it('밀어도 타일에 적힌 숫자의 합은 그대로다', () => {
    const random = seeded(7);
    for (let round = 0; round < 200; round += 1) {
      const board = emptyBoard().map(() => (random() < 0.6 ? 1 + Math.floor(random() * 4) : 0));
      const sum = (cells: readonly number[]) => cells.reduce((total, level) => total + tileValue(level), 0);
      for (const direction of DIRECTIONS) {
        const result = slide(board, direction);
        expect(sum(result.board)).toBe(sum(board));
        expect(result.moves).toHaveLength(board.filter((level) => level > 0).length);
      }
    }
  });
});

describe('막힌 판', () => {
  it('빈칸이 있으면 밀 수 있다', () => {
    expect(canMove(boardOf([[2, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]))).toBe(true);
  });

  it('꽉 찼어도 이웃한 같은 타일이 있으면 밀 수 있다', () => {
    const board = boardOf([
      [2, 4, 2, 4],
      [4, 2, 4, 2],
      [2, 4, 2, 4],
      [4, 2, 4, 4],
    ]);
    expect(canMove(board)).toBe(true);
  });

  it('꽉 차고 이웃이 모두 다르면 막힌 것이다', () => {
    const board = boardOf([
      [2, 4, 2, 4],
      [4, 2, 4, 2],
      [2, 4, 2, 4],
      [4, 2, 4, 2],
    ]);
    expect(canMove(board)).toBe(false);
    expect(playTurn(board, 'left', seeded(3)).alive).toBe(false);
  });
});

describe('새 타일', () => {
  it('처음 판에는 타일이 정해진 수만큼 놓인다', () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const board = startBoard(seeded(seed));
      expect(board.filter((level) => level > 0)).toHaveLength(START_TILES);
      expect(maxLevel(board)).toBeLessThanOrEqual(2);
    }
  });

  it('빈칸에만 나오고, 2나 4만 나온다', () => {
    const random = seeded(11);
    for (let round = 0; round < 300; round += 1) {
      const board = emptyBoard().map(() => (random() < 0.7 ? 3 : 0));
      const spawn = spawnTile(board, random);
      if (emptyCells(board).length === 0) {
        expect(spawn).toBeNull();
        continue;
      }
      expect(board[spawn!.cell]).toBe(0);
      expect([1, 2]).toContain(spawn!.level);
      expect(spawn!.board[spawn!.cell]).toBe(spawn!.level);
    }
  });

  it('4는 가끔만 나온다', () => {
    const random = seeded(5);
    let fours = 0;
    const rounds = 4000;
    for (let round = 0; round < rounds; round += 1) {
      if (spawnTile(emptyBoard(), random)!.level === 2) fours += 1;
    }
    expect(fours / rounds).toBeGreaterThan(FOUR_CHANCE - 0.03);
    expect(fours / rounds).toBeLessThan(FOUR_CHANCE + 0.03);
  });

  it('난수가 1에 아주 가까워도 칸 밖을 고르지 않는다', () => {
    const spawn = spawnTile(emptyBoard(), () => 0.9999999999);
    expect(spawn!.cell).toBe(CELLS - 1);
  });
});

describe('점수와 시간', () => {
  it('합쳐 만든 타일이 클수록 점수가 두 배씩 오른다', () => {
    expect([1, 2, 3, 4, 5, 11].map(mergePoints)).toEqual([0, 1, 2, 4, 8, 512]);
  });

  it('32부터는 처음 만든 기록 타일마다 시간을 더 준다', () => {
    expect(bonusSeconds(3, 4)).toBe(0);
    expect(bonusSeconds(BONUS_FROM_LEVEL - 1, BONUS_FROM_LEVEL)).toBe(BONUS_SECONDS);
    expect(bonusSeconds(6, 7)).toBe(BONUS_SECONDS);
    expect(bonusSeconds(6, 6)).toBe(0);
    expect(bonusSeconds(2, BONUS_FROM_LEVEL + 1)).toBe(BONUS_SECONDS * 2);
  });

  it('같은 크기의 타일을 다시 만들어도 시간은 더 받지 않는다', () => {
    const board = boardOf([
      [32, 16, 16, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    const turn = playTurn(board, 'left', seeded(2));
    expect(maxLevel(turn.slide.board)).toBe(5);
    expect(turn.bonus).toBe(0);
  });
});

describe('한 수', () => {
  it('판이 바뀌면 새 타일이 하나 나온다', () => {
    const board = boardOf([
      [2, 2, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    const turn = playTurn(board, 'left', seeded(9));
    expect(turn.spawn).not.toBeNull();
    expect(turn.board.filter((level) => level > 0)).toHaveLength(2);
    expect(turn.slide.points).toBe(1);
    expect(turn.alive).toBe(true);
  });

  it('헛밀면 판도 그대로고 새 타일도 없다', () => {
    const board = boardOf([
      [2, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    const turn = playTurn(board, 'left', seeded(9));
    expect(turn.spawn).toBeNull();
    expect(turn.board).toEqual(board);
  });

  it('16을 둘 합쳐 32를 처음 만들면 시간을 받는다', () => {
    const board = boardOf([
      [16, 16, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    expect(playTurn(board, 'left', seeded(4)).bonus).toBe(BONUS_SECONDS);
  });

  it('아무렇게나 밀어도 언젠가는 판이 막혀서 끝난다', () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const random = seeded(seed);
      let board = startBoard(random);
      let turns = 0;
      let alive = true;
      while (alive && turns < 5000) {
        const direction = DIRECTIONS[Math.floor(random() * DIRECTIONS.length)];
        const turn = playTurn(board, direction, random);
        board = turn.board;
        alive = turn.alive;
        turns += 1;
      }
      expect(alive).toBe(false);
      expect(emptyCells(board)).toHaveLength(0);
    }
  });
});
