import { describe, expect, it } from 'vitest';
import { seededRandom } from '../../core/stages';
import {
  advance,
  boardLayout,
  boxAt,
  canUndo,
  carveRoom,
  cellAt,
  cellOf,
  centerOf,
  claimClear,
  clearPoints,
  clearSeconds,
  deadCells,
  DIRECTIONS,
  elapse,
  fallbackPuzzle,
  finalScore,
  formatPuzzle,
  generateNear,
  generatePuzzle,
  hasMoved,
  isOver,
  isSolved,
  MAX_CELL,
  MAX_HISTORY,
  MAX_INNER_COLS,
  MAX_INNER_ROWS,
  MIN_CLEAR_SECONDS,
  minPushes,
  NEAT_POINTS,
  neighbour,
  newBoard,
  newRun,
  nextStage,
  parsePuzzle,
  pendingPoints,
  placedCount,
  placeTargets,
  PLACED_POINTS,
  pullBack,
  puzzleRun,
  restart,
  routeTo,
  STAGE_PLANS,
  stageBoxes,
  stageLines,
  stagePuzzle,
  START_SECONDS,
  step,
  stuckBoxes,
  undo,
  type Board,
  type Direction,
  type Puzzle,
  type RunState,
} from './rules';

/** 글자로 적은 판을 읽는다. 읽을 수 없으면 테스트가 잘못된 것이다. */
function puzzleOf(code: string, par = 0): Puzzle {
  const puzzle = parsePuzzle(code, par);
  if (!puzzle) throw new Error(`읽을 수 없는 판: ${code}`);
  return puzzle;
}

/** 안쪽의 (col, row) 칸(왼쪽 위가 (0, 0))의 칸 번호 */
function at(puzzle: Puzzle, col: number, row: number): number {
  return (row + 1) * puzzle.cols + col + 1;
}

/** 방향들을 차례로 걷는다. */
function walk(board: Board, moves: readonly Direction[]): Board {
  return moves.reduce((now, direction) => step(now, direction).board, board);
}

/** 방향들을 차례로 걸으며 되돌릴 것을 적어 둔다. */
function play(run: RunState, moves: readonly Direction[]): RunState {
  return moves.reduce((now, direction) => advance(now, direction).run, run);
}

describe('판을 글자로 적기', () => {
  it('안쪽만 적고, 읽으면 벽 둘레가 한 겹 둘린다', () => {
    const puzzle = puzzleOf('#..o/.b../p...', 3);
    expect(puzzle.cols).toBe(6);
    expect(puzzle.rows).toBe(5);
    expect(puzzle.par).toBe(3);
    expect(puzzle.walls.filter((wall) => !wall)).toHaveLength(11);
    for (let col = 0; col < puzzle.cols; col += 1) {
      expect(puzzle.walls[col]).toBe(true);
      expect(puzzle.walls[(puzzle.rows - 1) * puzzle.cols + col]).toBe(true);
    }
    expect(puzzle.walls[at(puzzle, 0, 0)]).toBe(true);
    expect(puzzle.targets).toEqual([at(puzzle, 3, 0)]);
    expect(puzzle.boxes).toEqual([at(puzzle, 1, 1)]);
    expect(puzzle.player).toBe(at(puzzle, 0, 2));
  });

  it('별 자리에 놓인 상자와 별 자리에 선 캐릭터도 적는다', () => {
    const puzzle = puzzleOf('PB/b.');
    expect(puzzle.targets).toEqual([at(puzzle, 0, 0), at(puzzle, 1, 0)]);
    expect(puzzle.boxes).toEqual([at(puzzle, 1, 0), at(puzzle, 0, 1)]);
    expect(puzzle.player).toBe(at(puzzle, 0, 0));
  });

  it('적은 것을 읽어서 다시 적으면 그대로다', () => {
    for (const code of ['#..o/.b../p...', 'PB./b..', 'p.b.o', '.o./.b./.p.']) {
      expect(formatPuzzle(puzzleOf(code))).toBe(code);
    }
  });

  it('판이 될 수 없는 것은 읽지 않는다', () => {
    expect(parsePuzzle('p.b', 1)).toBeNull(); // 별 자리가 없다
    expect(parsePuzzle('p.o', 1)).toBeNull(); // 상자가 없다
    expect(parsePuzzle('pbbo', 1)).toBeNull(); // 상자와 별 자리의 수가 다르다
    expect(parsePuzzle('.b.o', 1)).toBeNull(); // 캐릭터가 없다
    expect(parsePuzzle('pb.o/p...', 1)).toBeNull(); // 캐릭터가 둘이다
    expect(parsePuzzle('pb.o/...', 1)).toBeNull(); // 줄의 길이가 다르다
    expect(parsePuzzle('pb.o/..x.', 1)).toBeNull(); // 모르는 글자
    expect(parsePuzzle('', 1)).toBeNull();
    expect(parsePuzzle('pb.o', -1)).toBeNull();
    expect(parsePuzzle('pb.o', 1.5)).toBeNull();
    expect(parsePuzzle(`pbo${'.'.repeat(MAX_INNER_COLS)}`, 1)).toBeNull(); // 너무 넓다
    expect(parsePuzzle(['pbo', ...Array<string>(MAX_INNER_ROWS).fill('...')].join('/'), 1)).toBeNull(); // 너무 길다
  });
});

describe('걷고 밀기', () => {
  const puzzle = puzzleOf('p.b.o/..#.o/.bbo.');

  it('빈 바닥으로는 한 칸 걷는다', () => {
    const result = step(newBoard(puzzle), 'right');
    expect(result.moved).toBe(true);
    expect(result.pushed).toBe(-1);
    expect(result.board.player).toBe(at(puzzle, 1, 0));
    expect(result.board.pushes).toBe(0);
    expect(result.board.boxes).toBe(puzzle.boxes);
  });

  it('벽으로는 가지 못하고 판은 그대로다', () => {
    const board = newBoard(puzzle);
    for (const direction of ['up', 'left'] as const) {
      const result = step(board, direction);
      expect(result.moved).toBe(false);
      expect(result.board).toBe(board);
    }
    // 안쪽의 벽
    const beside = walk(board, ['right', 'down']);
    expect(step(beside, 'right').moved).toBe(false);
  });

  it('걸어가는 쪽의 상자를 한 칸 민다', () => {
    const board = walk(newBoard(puzzle), ['right']);
    const result = step(board, 'right');
    expect(result.moved).toBe(true);
    expect(result.pushed).toBe(boxAt(board, at(puzzle, 2, 0)));
    expect(result.board.player).toBe(at(puzzle, 2, 0));
    expect(result.board.boxes[result.pushed]).toBe(at(puzzle, 3, 0));
    expect(result.board.pushes).toBe(1);
    // 받은 판은 바꾸지 않는다.
    expect(board.boxes).toEqual(puzzle.boxes);
  });

  it('같은 번호는 밀린 뒤에도 같은 상자다', () => {
    const board = walk(newBoard(puzzle), ['right', 'right', 'right']);
    expect(board.boxes[0]).toBe(at(puzzle, 4, 0));
    expect(board.boxes.slice(1)).toEqual(puzzle.boxes.slice(1));
    expect(board.pushes).toBe(2);
  });

  it('상자 너머가 벽이면 밀 수 없다', () => {
    const board = walk(newBoard(puzzle), ['right', 'right', 'right']);
    const result = step(board, 'right');
    expect(result.moved).toBe(false);
    expect(result.board).toBe(board);
  });

  it('상자 둘을 한꺼번에 밀 수 없다', () => {
    const board = walk(newBoard(puzzle), ['down', 'down']);
    expect(board.player).toBe(at(puzzle, 0, 2));
    const result = step(board, 'right');
    expect(result.moved).toBe(false);
    expect(result.pushed).toBe(-1);
  });

  it('상자가 모두 별 자리에 놓이면 판을 깬다', () => {
    const small = puzzleOf('pb.o/.bo.');
    let board = newBoard(small);
    expect(placedCount(board)).toBe(0);
    expect(isSolved(board)).toBe(false);
    board = walk(board, ['right', 'right']);
    expect(placedCount(board)).toBe(1);
    expect(isSolved(board)).toBe(false);
    board = walk(board, ['left', 'left', 'down', 'right']);
    expect(placedCount(board)).toBe(2);
    expect(isSolved(board)).toBe(true);
    expect(board.pushes).toBe(3);
  });

  it('이웃 칸은 판 밖으로 나가지 않는다', () => {
    expect(neighbour(puzzle, 0, 'up')).toBe(-1);
    expect(neighbour(puzzle, 0, 'left')).toBe(-1);
    expect(neighbour(puzzle, 0, 'right')).toBe(1);
    expect(neighbour(puzzle, 0, 'down')).toBe(puzzle.cols);
    expect(neighbour(puzzle, puzzle.cols * puzzle.rows - 1, 'right')).toBe(-1);
    expect(neighbour(puzzle, puzzle.cols * puzzle.rows - 1, 'down')).toBe(-1);
    expect(cellOf(puzzle.cols, at(puzzle, 3, 1))).toEqual({ col: 4, row: 2 });
  });
});

describe('눌러서 걸어가기', () => {
  const puzzle = puzzleOf('p.#../.b#.o/.....');

  it('상자와 벽을 돌아가는 가장 짧은 길을 찾는다', () => {
    const board = newBoard(puzzle);
    expect(routeTo(board, at(puzzle, 1, 0))).toEqual(['right']);
    const route = routeTo(board, at(puzzle, 3, 0));
    expect(route).toHaveLength(7);
    const arrived = walk(board, route as Direction[]);
    expect(arrived.player).toBe(at(puzzle, 3, 0));
    // 가는 길에 상자를 밀지 않는다.
    expect(arrived.pushes).toBe(0);
    expect(arrived.boxes).toEqual(board.boxes);
  });

  it('서 있는 칸이면 걸을 것이 없다', () => {
    expect(routeTo(newBoard(puzzle), puzzle.player)).toEqual([]);
  });

  it('벽, 상자, 판 밖, 막힌 곳으로는 길이 없다', () => {
    const board = newBoard(puzzle);
    expect(routeTo(board, at(puzzle, 2, 0))).toBeNull();
    expect(routeTo(board, at(puzzle, 1, 1))).toBeNull();
    expect(routeTo(board, 0)).toBeNull();
    expect(routeTo(board, -1)).toBeNull();
    expect(routeTo(board, 999)).toBeNull();
    // 상자가 하나뿐인 통로를 막고 있으면 그 너머로는 갈 수 없다.
    const sealed = newBoard(puzzleOf('p.b.o'));
    expect(routeTo(sealed, at(sealed.puzzle, 3, 0))).toBeNull();
  });
});

describe('더 갈 곳이 없는 칸', () => {
  it('별 자리가 아닌 구석과, 별 자리가 없는 벽을 따라 난 줄은 막힌 칸이다', () => {
    const puzzle = puzzleOf('..../.bp./..../...o');
    const dead = deadCells(puzzle);
    const deadAt = (col: number, row: number): boolean => dead[at(puzzle, col, row)];
    // 구석
    expect(deadAt(0, 0)).toBe(true);
    expect(deadAt(3, 0)).toBe(true);
    expect(deadAt(0, 3)).toBe(true);
    // 별 자리가 있는 구석은 막힌 칸이 아니다.
    expect(deadAt(3, 3)).toBe(false);
    // 별 자리가 없는 위쪽과 왼쪽 벽을 따라 난 줄
    expect(deadAt(1, 0)).toBe(true);
    expect(deadAt(0, 2)).toBe(true);
    // 별 자리로 이어지는 아래쪽과 오른쪽 벽을 따라 난 줄, 그리고 한가운데
    expect(deadAt(1, 3)).toBe(false);
    expect(deadAt(3, 1)).toBe(false);
    expect(deadAt(1, 1)).toBe(false);
    expect(deadAt(2, 2)).toBe(false);
    // 벽은 치지 않는다.
    expect(dead[0]).toBe(false);
  });

  it('막힌 칸에 들어간 상자를 알려 준다', () => {
    const puzzle = puzzleOf('..../.bp./..../...o');
    const dead = deadCells(puzzle);
    const board = newBoard(puzzle);
    expect(stuckBoxes(board, dead)).toEqual([]);
    // 상자를 왼쪽 벽에 붙인다.
    const pushed = walk(board, ['left']);
    expect(pushed.boxes[0]).toBe(at(puzzle, 0, 1));
    expect(stuckBoxes(pushed, dead)).toEqual([0]);
    // 그런 판은 정말로 풀 수 없다.
    expect(minPushes({ ...puzzle, boxes: pushed.boxes, player: pushed.player })).toBeNull();
  });
});

describe('풀어 보기', () => {
  it('가장 적게 미는 횟수를 찾는다', () => {
    expect(minPushes(puzzleOf('pb.o'))).toBe(2);
    expect(minPushes(puzzleOf('pb.o/.bo.'))).toBe(3);
    // 상자를 아래에서 위로 밀어야 해서 돌아가야 하지만, 미는 것은 한 번이다.
    expect(minPushes(puzzleOf('.o./.b./p..'))).toBe(1);
  });

  it('이미 다 놓여 있으면 0이다', () => {
    expect(minPushes(puzzleOf('pB.'))).toBe(0);
  });

  it('풀 수 없는 판은 null이다', () => {
    expect(minPushes(puzzleOf('bp.o'))).toBeNull(); // 구석에 박힌 상자
    expect(minPushes(puzzleOf('p.b#o'))).toBeNull(); // 벽 너머의 별 자리
    expect(minPushes(puzzleOf('pbbo.o'))).toBeNull(); // 상자 둘은 한꺼번에 밀 수 없다
  });

  it('놓인 상자를 도로 빼내야 하는 판도 푼다', () => {
    // 놓인 상자가 다른 상자의 길을 막고 있다. 놓인 상자를 옆의 별 자리로 밀어 주고, 빈 자리에 다른 상자를 올린다.
    expect(minPushes(puzzleOf('pBo/.b./...'))).toBe(2);
  });

  it('살펴볼 한도를 넘으면 null이다', () => {
    expect(minPushes(puzzleOf('p..../.b.b./...../o...o'), 3)).toBeNull();
  });

  it('정해 둔 판은 상자의 수만큼 밀면 풀린다', () => {
    for (const boxes of [1, 2, 3, 6]) {
      const puzzle = fallbackPuzzle(boxes);
      expect(puzzle.boxes).toHaveLength(boxes);
      expect(puzzle.par).toBe(boxes);
      expect(minPushes(puzzle)).toBe(boxes);
    }
    expect(fallbackPuzzle(0).boxes).toHaveLength(1);
    expect(fallbackPuzzle(99).boxes).toHaveLength(6);
  });
});

describe('거꾸로 끌어당겨서 처음 모습 찾기', () => {
  const room = puzzleOf('...../.#.../..b.o/p.b.o');
  const starts = pullBack(room.cols, room.rows, room.walls, room.targets, 50_000);

  it('찾은 모습은 모두 적힌 횟수만큼 밀어야 풀린다', () => {
    const found = starts.filter((start) => start !== undefined);
    expect(found.length).toBeGreaterThan(3);
    for (const start of found) {
      expect(start.boxes).toHaveLength(room.targets.length);
      expect(start.standing.length).toBeGreaterThan(0);
      expect(start.lines).toBeGreaterThanOrEqual(room.targets.length);
      expect(start.lines).toBeLessThanOrEqual(start.par);
      // 캐릭터가 설 수 있는 칸 어디에 서도 같은 횟수다.
      for (const player of [start.standing[0], start.standing[start.standing.length - 1]]) {
        const puzzle: Puzzle = { ...room, boxes: [...start.boxes].sort((a, b) => a - b), player, par: start.par };
        expect(minPushes(puzzle), formatPuzzle(puzzle)).toBe(start.par);
      }
    }
  });

  it('n번째에는 n번 밀어야 풀리는 모습이 온다', () => {
    starts.forEach((start, par) => {
      if (start) expect(start.par).toBe(par);
    });
    // 한 번도 끌어당기지 않은 모습과 상자가 다 움직이지 않은 모습은 치지 않는다.
    expect(starts[0]).toBeUndefined();
    expect(starts[1]).toBeUndefined();
  });

  it('캐릭터가 서는 칸은 상자와 벽이 아니다', () => {
    for (const start of starts) {
      if (!start) continue;
      for (const cell of start.standing) {
        expect(room.walls[cell]).toBe(false);
        expect(start.boxes).not.toContain(cell);
      }
    }
  });

  it('clean을 주면 처음부터 별 자리에 놓인 상자가 없는 모습만 준다', () => {
    const clean = pullBack(room.cols, room.rows, room.walls, room.targets, 50_000, true);
    expect(clean.some((start) => start !== undefined)).toBe(true);
    for (const start of clean) {
      if (!start) continue;
      for (const box of start.boxes) expect(room.targets).not.toContain(box);
    }
  });

  it('한도가 작아도 찾은 것의 횟수는 정확하다', () => {
    const few = pullBack(room.cols, room.rows, room.walls, room.targets, 20);
    const count = (list: readonly unknown[]): number => list.filter((start) => start !== undefined).length;
    expect(count(few)).toBeGreaterThan(0);
    expect(count(few)).toBeLessThan(count(starts));
    for (const start of few) {
      if (!start) continue;
      const puzzle: Puzzle = { ...room, boxes: [...start.boxes].sort((a, b) => a - b), player: start.standing[0], par: start.par };
      expect(minPushes(puzzle)).toBe(start.par);
    }
  });

  it('상자가 너무 많거나 없으면 찾지 않는다', () => {
    expect(pullBack(room.cols, room.rows, room.walls, [], 100)).toEqual([]);
  });
});

describe('방 만들기', () => {
  it('둘레는 벽이고, 바닥은 한 덩어리로 이어져 있고, 바닥에 딱 맞게 줄어 있다', () => {
    const random = seededRandom('방');
    for (let made = 0; made < 200; made += 1) {
      const room = carveRoom(6, 7, 3 + (made % 10), random);
      expect(room.walls).toHaveLength(room.cols * room.rows);
      expect(room.cols).toBeLessThanOrEqual(8);
      expect(room.rows).toBeLessThanOrEqual(9);
      const floor: number[] = [];
      room.walls.forEach((wall, cell) => {
        const { col, row } = cellOf(room.cols, cell);
        const edge = col === 0 || row === 0 || col === room.cols - 1 || row === room.rows - 1;
        if (edge) expect(wall).toBe(true);
        if (!wall) floor.push(cell);
      });
      if (floor.length === 0) continue;
      // 한 덩어리
      const seen = new Set([floor[0]]);
      const queue = [floor[0]];
      for (const cell of queue) {
        for (const next of [cell - room.cols, cell + 1, cell + room.cols, cell - 1]) {
          if (room.walls[next] || seen.has(next)) continue;
          seen.add(next);
          queue.push(next);
        }
      }
      expect(seen.size).toBe(floor.length);
      // 안쪽의 맨 바깥 줄마다 바닥이 하나는 있다.
      const cols = floor.map((cell) => cell % room.cols);
      const rows = floor.map((cell) => Math.floor(cell / room.cols));
      expect(Math.min(...cols)).toBe(1);
      expect(Math.max(...cols)).toBe(room.cols - 2);
      expect(Math.min(...rows)).toBe(1);
      expect(Math.max(...rows)).toBe(room.rows - 2);
    }
  });

  it('벽 조각을 놓지 않으면 빈 방이다', () => {
    const room = carveRoom(4, 3, 0, Math.random);
    expect(room.cols).toBe(6);
    expect(room.rows).toBe(5);
    expect(room.walls.filter((wall) => !wall)).toHaveLength(12);
  });

  it('별 자리는 바닥에서 겹치지 않게 고르고, 바닥이 모자라면 고르지 않는다', () => {
    const random = seededRandom('별');
    const room = carveRoom(5, 5, 4, random);
    for (let made = 0; made < 50; made += 1) {
      const targets = placeTargets(room, 3, random);
      expect(targets).toHaveLength(3);
      expect(new Set(targets).size).toBe(3);
      expect(targets).toEqual([...targets].sort((a, b) => a - b));
      for (const cell of targets) expect(room.walls[cell]).toBe(false);
    }
    expect(placeTargets(carveRoom(2, 2, 0, random), 2, random)).toEqual([]);
  });
});

describe('문제 만들기', () => {
  it('점수 도전의 어느 판이든 풀리고, 가장 적게 미는 횟수가 맞고, 그 모양을 지킨다', () => {
    for (const [index, plan] of STAGE_PLANS.entries()) {
      const random = seededRandom(`문제 ${index}`);
      for (let made = 0; made < 25; made += 1) {
        const { puzzle, lines } = generatePuzzle(plan.puzzle, random);
        const label = `${index}번 모양: ${formatPuzzle(puzzle)}`;
        expect(puzzle.boxes, label).toHaveLength(plan.puzzle.boxes);
        expect(puzzle.targets, label).toHaveLength(plan.puzzle.boxes);
        expect(puzzle.cols - 2, label).toBeLessThanOrEqual(plan.puzzle.innerCols);
        expect(puzzle.rows - 2, label).toBeLessThanOrEqual(plan.puzzle.innerRows);
        expect(puzzle.par, label).toBeGreaterThanOrEqual(plan.puzzle.par[0]);
        expect(puzzle.par, label).toBeLessThanOrEqual(plan.puzzle.par[1]);
        expect(lines, label).toBeLessThanOrEqual(puzzle.par);
        expect(minPushes(puzzle), label).toBe(puzzle.par);
        expect(puzzle.walls[puzzle.player], label).toBe(false);
        expect(puzzle.boxes, label).not.toContain(puzzle.player);
        expect(isSolved(newBoard(puzzle)), label).toBe(false);
        // 정해 둔 판으로 물러나지 않고 방을 새로 지었다.
        expect(formatPuzzle(puzzle), label).not.toBe(formatPuzzle(fallbackPuzzle(plan.puzzle.boxes)));
        if (plan.puzzle.clean) {
          for (const box of puzzle.boxes) expect(puzzle.targets, label).not.toContain(box);
        }
      }
    }
  });

  it('같은 난수면 같은 문제가 나온다', () => {
    const plan = STAGE_PLANS[2].puzzle;
    expect(generatePuzzle(plan, seededRandom('같은 씨앗'))).toEqual(generatePuzzle(plan, seededRandom('같은 씨앗')));
    expect(generatePuzzle(plan, seededRandom('같은 씨앗'))).not.toEqual(generatePuzzle(plan, seededRandom('다른 씨앗')));
  });

  it('난수가 무엇을 내놓든 끝나고, 못 만들면 정해 둔 판을 준다', () => {
    const plan = STAGE_PLANS[1].puzzle;
    for (const value of [0, 0.5, 0.999999]) {
      const { puzzle } = generatePuzzle(plan, () => value);
      expect(minPushes(puzzle)).toBe(puzzle.par);
    }
    // 방이 너무 좁아서 상자 여섯을 놓을 수 없다.
    const cramped = generatePuzzle({ ...plan, innerCols: 2, innerRows: 2, boxes: 6 }, Math.random);
    expect(formatPuzzle(cramped.puzzle)).toBe(formatPuzzle(fallbackPuzzle(6)));
    expect(cramped.lines).toBe(6);
  });

  it('여러 개를 만들어 보고 노리는 어려움에 가장 가까운 것을 고른다', () => {
    const plan = STAGE_PLANS[3].puzzle;
    const spread = (count: number, lines: number): number => {
      const random = seededRandom('고르기');
      let total = 0;
      for (let made = 0; made < 30; made += 1) total += Math.abs(generateNear(plan, lines, count, random).lines - lines);
      return total / 30;
    };
    expect(spread(6, 8)).toBeLessThan(spread(1, 8));
  });
});

describe('화면 배치', () => {
  const puzzle = puzzleOf(Array.from({ length: MAX_INNER_ROWS }, () => '.'.repeat(MAX_INNER_COLS)).join('/').replace('.', 'p').replace('.', 'b').replace('.', 'o'));
  /** 가장 짧은 화면(높이 400)에서 판이 들어가는 자리 */
  const area = { x: 0, y: 98, width: 240, height: 230 };

  it('가장 큰 판도 가장 짧은 화면에 들어가고, 칸이 손가락으로 가릴 만큼 작지 않다', () => {
    const layout = boardLayout(puzzle, area);
    expect(layout.cell).toBeGreaterThanOrEqual(28);
    expect(layout.left).toBeGreaterThanOrEqual(area.x);
    expect(layout.top).toBeGreaterThanOrEqual(area.y);
    expect(layout.left + MAX_INNER_COLS * layout.cell).toBeLessThanOrEqual(area.x + area.width);
    expect(layout.top + MAX_INNER_ROWS * layout.cell).toBeLessThanOrEqual(area.y + area.height);
  });

  it('작은 판은 칸이 지나치게 커지지 않고 한가운데에 놓인다', () => {
    const small = puzzleOf('pbo/.../...');
    const layout = boardLayout(small, { x: 0, y: 100, width: 240, height: 400 });
    expect(layout.cell).toBe(MAX_CELL);
    expect(layout.left).toBe(Math.round((240 - 3 * MAX_CELL) / 2));
    expect(layout.top).toBe(Math.round(100 + (400 - 3 * MAX_CELL) / 2));
  });

  it('칸의 가운데를 누르면 그 칸이고, 안쪽을 벗어나면 null이다', () => {
    const layout = boardLayout(puzzle, area);
    for (const cell of [at(puzzle, 0, 0), at(puzzle, 3, 2), at(puzzle, MAX_INNER_COLS - 1, MAX_INNER_ROWS - 1)]) {
      const center = centerOf(puzzle, layout, cell);
      expect(cellAt(puzzle, layout, center.x, center.y)).toBe(cell);
    }
    expect(cellAt(puzzle, layout, layout.left - 1, layout.top + 5)).toBeNull();
    expect(cellAt(puzzle, layout, layout.left + 5, layout.top - 1)).toBeNull();
    expect(cellAt(puzzle, layout, layout.left + MAX_INNER_COLS * layout.cell, layout.top + 5)).toBeNull();
    expect(cellAt(puzzle, layout, layout.left + 5, layout.top + MAX_INNER_ROWS * layout.cell)).toBeNull();
  });
});

describe('판의 차례', () => {
  it('뒤로 갈수록 상자가 늘고, 이리저리 밀 일이 많아지고, 점수가 커진다', () => {
    for (let stage = 2; stage <= 20; stage += 1) {
      expect(stageBoxes(stage)).toBeGreaterThanOrEqual(stageBoxes(stage - 1));
      expect(clearPoints(stage)).toBeGreaterThanOrEqual(clearPoints(stage - 1));
      // 상자가 하나 느는 판은 조금 쉬운 데서 다시 시작한다. 상자 수가 같은 동안에는 내려가지 않는다.
      if (stageBoxes(stage) === stageBoxes(stage - 1)) {
        expect(stageLines(stage)).toBeGreaterThanOrEqual(stageLines(stage - 1));
      }
    }
    expect(stageBoxes(1)).toBe(1);
    expect(stageBoxes(20)).toBe(3);
    expect(stageLines(20)).toBe(STAGE_PLANS[STAGE_PLANS.length - 1].lines[1]);
    expect(clearPoints(20)).toBeGreaterThan(clearPoints(1));
  });

  it('노리는 토막의 수는 그 모양의 범위 안이다', () => {
    let stage = 1;
    for (const plan of STAGE_PLANS) {
      const boards = Number.isFinite(plan.boards) ? plan.boards : 8;
      for (let turn = 0; turn < boards; turn += 1) {
        expect(stageLines(stage)).toBeGreaterThanOrEqual(plan.lines[0]);
        expect(stageLines(stage)).toBeLessThanOrEqual(plan.lines[1]);
        stage += 1;
      }
    }
  });

  it('돌려받는 시간은 어려운 판일수록 많다가, 가장 어려운 모양이 거듭되면 줄어든다', () => {
    const first = STAGE_PLANS.slice(0, -1).reduce((sum, plan) => sum + plan.boards, 0) + 1;
    expect(clearSeconds(first)).toBe(STAGE_PLANS[STAGE_PLANS.length - 1].seconds);
    expect(clearSeconds(first + 1)).toBeLessThan(clearSeconds(first));
    expect(clearSeconds(first + 100)).toBe(MIN_CLEAR_SECONDS);
    for (let stage = 1; stage <= first + 30; stage += 1) {
      expect(clearSeconds(stage)).toBeGreaterThanOrEqual(MIN_CLEAR_SECONDS);
      expect(clearSeconds(stage)).toBeLessThanOrEqual(START_SECONDS);
    }
  });

  it('판마다 그 차례의 상자 수로 문제가 나온다', () => {
    const random = seededRandom('차례');
    for (const stage of [1, 2, 4, 7, 10, 14]) {
      const puzzle = stagePuzzle(stage, random);
      expect(puzzle.boxes).toHaveLength(stageBoxes(stage));
      expect(minPushes(puzzle)).toBe(puzzle.par);
    }
  });
});

describe('한 판의 진행', () => {
  const puzzle = puzzleOf('pb.o/.bo.', 3);
  const solution: Direction[] = ['right', 'right', 'left', 'left', 'down', 'right'];

  it('처음에는 시간이 가득하고 점수가 없다', () => {
    const run = newRun(seededRandom('처음'));
    expect(run).toMatchObject({ stage: 1, timeLeft: START_SECONDS, score: 0, boardsCleared: 0, neatClears: 0 });
    expect(run.history).toEqual([]);
    expect(run.board.puzzle.boxes).toHaveLength(stageBoxes(1));
    expect(run.board.pushes).toBe(0);
    expect(hasMoved(run)).toBe(false);
    expect(canUndo(run)).toBe(false);
  });

  it('밀었을 때만 되돌릴 것이 쌓인다', () => {
    let run = puzzleRun(puzzle);
    run = play(run, ['down']);
    expect(run.history).toHaveLength(0);
    expect(hasMoved(run)).toBe(true);
    run = play(run, ['up', 'right']);
    expect(run.history).toHaveLength(1);
    expect(run.board.pushes).toBe(1);
    // 막혀서 움직이지 못한 것은 상태를 바꾸지 않는다.
    const blocked = advance(run, 'up');
    expect(blocked.step.moved).toBe(false);
    expect(blocked.run).toBe(run);
  });

  it('되돌리면 마지막으로 밀기 바로 전의 모습으로 돌아간다', () => {
    const start = puzzleRun(puzzle);
    const once = play(start, ['right']);
    const twice = play(once, ['right']);
    // 밀고 나서 걸어 다닌 것도 함께 되돌아간다.
    const wandered = play(twice, ['left', 'left']);
    expect(wandered.board.player).toBe(start.board.player);
    const back = undo(wandered);
    expect(back.board).toBe(once.board);
    expect(back.board.pushes).toBe(1);
    expect(back.history).toHaveLength(1);
    const again = undo(back);
    expect(again.board).toBe(start.board);
    expect(canUndo(again)).toBe(false);
    expect(undo(again)).toBe(again);
  });

  it('처음부터 다시 하면 처음 모습이고 되돌릴 것이 없다', () => {
    const run = restart(play(puzzleRun(puzzle), ['right', 'right']));
    expect(run.board.boxes).toEqual(puzzle.boxes);
    expect(run.board.player).toBe(puzzle.player);
    expect(run.board.pushes).toBe(0);
    expect(run.history).toEqual([]);
    expect(hasMoved(run)).toBe(false);
  });

  it('되돌릴 것은 한도까지만 기억한다', () => {
    // 상자를 좌우로 오가며 한없이 민다.
    const wide = puzzleOf('....../pb...o/......', 4);
    let run = puzzleRun(wide);
    const lap: Direction[] = ['right', 'right', 'right', 'up', 'right', 'right', 'down', 'left', 'left', 'left', 'up', 'left', 'left', 'down'];
    for (let turn = 0; turn < 80; turn += 1) run = play(run, lap);
    expect(run.board.pushes).toBeGreaterThan(MAX_HISTORY);
    expect(run.history).toHaveLength(MAX_HISTORY);
  });

  it('시간이 흐르고, 다 되면 끝난다', () => {
    const run = puzzleRun(puzzle);
    expect(elapse(run, 10).timeLeft).toBe(START_SECONDS - 10);
    expect(elapse(run, -5).timeLeft).toBe(START_SECONDS);
    expect(isOver(elapse(run, START_SECONDS - 0.1))).toBe(false);
    const over = elapse(run, START_SECONDS + 5);
    expect(over.timeLeft).toBe(0);
    expect(isOver(over)).toBe(true);
  });

  it('판을 깨면 점수와 시간을 받고, 가장 적게 밀었으면 점수가 더 붙는다', () => {
    const solved = play(elapse(puzzleRun(puzzle), 40), solution);
    expect(isSolved(solved.board)).toBe(true);
    const { run, reward } = claimClear(solved);
    expect(reward).toEqual({ points: clearPoints(1) + NEAT_POINTS, seconds: clearSeconds(1), neat: true });
    expect(run.score).toBe(clearPoints(1) + NEAT_POINTS);
    expect(run.timeLeft).toBe(START_SECONDS - 40 + clearSeconds(1));
    expect(run).toMatchObject({ boardsCleared: 1, neatClears: 1, boxesPlaced: 2 });
  });

  it('더 많이 밀어서 깨면 덤이 없다', () => {
    // 첫 상자를 한 칸 밀었다가 되돌리지 않고, 다른 길로 돌아가 한 번 더 민다.
    const long = puzzleOf('pb.o/.bo.', 2);
    const { run, reward } = claimClear(play(puzzleRun(long), solution));
    expect(reward).toMatchObject({ points: clearPoints(1), neat: false });
    expect(run.neatClears).toBe(0);
  });

  it('돌려받아도 처음의 시간을 넘지 않는다', () => {
    const { run, reward } = claimClear(play(elapse(puzzleRun(puzzle), 2), solution));
    expect(run.timeLeft).toBe(START_SECONDS);
    expect(reward?.seconds).toBe(2);
  });

  it('못 깼거나 이미 끝났으면 받는 것이 없다', () => {
    const unsolved = play(puzzleRun(puzzle), ['right']);
    expect(claimClear(unsolved)).toEqual({ run: unsolved, reward: null });
    const late = elapse(play(puzzleRun(puzzle), solution), START_SECONDS);
    expect(claimClear(late)).toEqual({ run: late, reward: null });
  });

  it('다음 판으로 넘어가면 새 문제가 깔리고 되돌릴 것이 비워진다', () => {
    const cleared = claimClear(play(puzzleRun(puzzle), solution)).run;
    const next = nextStage(cleared, seededRandom('다음'));
    expect(next.stage).toBe(2);
    expect(next.history).toEqual([]);
    expect(next.board.pushes).toBe(0);
    expect(next.board.puzzle.boxes).toHaveLength(stageBoxes(2));
    expect(next.score).toBe(cleared.score);
    expect(next.timeLeft).toBe(cleared.timeLeft);
  });

  it('끝났을 때 풀던 판에 놓아 둔 상자도 점수가 된다', () => {
    const half = play(puzzleRun(puzzle), ['right', 'right']);
    expect(pendingPoints(half)).toBe(PLACED_POINTS);
    expect(finalScore({ ...half, score: 100 })).toBe(100 + PLACED_POINTS);
    // 깬 판은 이미 점수를 받았으므로 더 받지 않는다.
    const cleared = claimClear(play(puzzleRun(puzzle), solution)).run;
    expect(pendingPoints(cleared)).toBe(0);
    expect(finalScore(cleared)).toBe(cleared.score);
  });

  it('방향은 넷이고 맞은편끼리 두 칸 떨어져 있다', () => {
    expect(DIRECTIONS).toEqual(['up', 'right', 'down', 'left']);
  });
});
