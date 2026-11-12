import { describe, expect, it } from 'vitest';
import { STAGE_HEARTS, STAGE_LEVELS, stageRandom } from '../core/stages';
import * as colorSort from './color-sort/rules';
import * as logicTiles from './logic-tiles/rules';
import * as numberPuzzle from './number-puzzle/rules';
import * as parkingOut from './parking-out/rules';
import * as pathLink from './path-link/rules';
import * as pinPullLevels from './pin-pull/levels';
import * as pinPull from './pin-pull/rules';
import { GAMES, stageGames } from './registry';
import * as screwSort from './screw-sort/rules';

/**
 * 단계 모드의 단계들을 게임이 실제로 만드는 그대로(단계 번호에서 나온 난수로) 만들어 본다.
 * 같은 단계는 언제나 같은 판이어야 하고, 어느 단계든 깰 수 있어야 한다.
 */

const ALL_LEVELS = Array.from({ length: STAGE_LEVELS }, (_, index) => index + 1);
/** 만드는 데 시간이 드는 게임은 이 단계들만 본다: 처음, 난이도가 바뀌는 언저리, 끝 */
const SAMPLE_LEVELS = [1, 2, 3, 5, 8, 13, 21, 34, 50, 67, 84, 99, STAGE_LEVELS];

describe('단계 모드를 하는 게임', () => {
  it('일곱 게임이고 모두 플레이할 수 있다', () => {
    expect(stageGames().map((game) => game.id)).toEqual([
      'color-sort',
      'pin-pull',
      'parking-out',
      'screw-sort',
      'logic-tiles',
      'number-puzzle',
      'path-link',
    ]);
    expect(stageGames().every((game) => game.sceneKey !== null && !game.versus)).toBe(true);
  });

  it('아직 플레이할 수 없는 게임은 빠진다', () => {
    const games = [
      { ...GAMES[0], id: 'ready', stageMode: true },
      { ...GAMES[0], id: 'soon', stageMode: true, sceneKey: null },
      { ...GAMES[0], id: 'arcade' },
    ];
    expect(stageGames(games).map((game) => game.id)).toEqual(['ready']);
  });
});

describe('색깔 물 나누기의 단계', () => {
  const deal = (level: number): colorSort.Stage =>
    colorSort.dealStage(colorSort.levelStage(level), stageRandom('color-sort', level));

  it('세 색에서 시작해 마지막에는 가장 많은 색이 나온다', () => {
    expect(colorSort.colorsFor(colorSort.levelStage(1))).toBe(colorSort.MIN_COLORS);
    expect(colorSort.colorsFor(colorSort.levelStage(STAGE_LEVELS))).toBe(colorSort.MAX_COLORS);
    // 가장 많은 색이 처음 나오는 난이도에서 멈춘다: 그 뒤의 난이도는 색이 더 늘지 않는다.
    const last = colorSort.levelStage(STAGE_LEVELS);
    expect(colorSort.colorsFor(last - 1)).toBeLessThan(colorSort.MAX_COLORS);
  });

  it('같은 단계는 언제나 같은 판이다', () => {
    for (const level of SAMPLE_LEVELS) expect(deal(level)).toEqual(deal(level));
    expect(deal(1).tubes).not.toEqual(deal(2).tubes);
  });

  it('어느 단계든 적어 둔 풀이대로 부으면 풀리고, 부을 수 있는 횟수는 그보다 넉넉하다', () => {
    for (const level of ALL_LEVELS) {
      const stage = deal(level);
      let tubes = stage.tubes;
      for (const move of stage.solution) {
        const poured = colorSort.pour(tubes, move.from, move.to);
        expect(poured, `${level}단계`).not.toBeNull();
        tubes = poured!.tubes;
      }
      expect(colorSort.isSolved(tubes), `${level}단계`).toBe(true);
      expect(colorSort.levelPourBudget(stage.par)).toBeGreaterThanOrEqual(stage.par + 6);
    }
  });

  it('부을 수 있는 횟수의 여유는 풀이가 길수록 커진다', () => {
    expect(colorSort.levelPourBudget(6)).toBe(12);
    expect(colorSort.levelPourBudget(12)).toBe(18);
    expect(colorSort.levelPourBudget(20)).toBe(30);
    expect(colorSort.levelPourBudget(25)).toBe(38);
    expect(colorSort.levelPourBudget(-3)).toBe(6);
  });
});

describe('주차장 빼기의 단계', () => {
  const start = (level: number): parkingOut.RunState =>
    parkingOut.levelRun(level, stageRandom('parking-out', level));

  it('가장 작은 주차장에서 시작해 가장 붐비는 주차장으로 끝난다', () => {
    expect(parkingOut.levelStage(1)).toBe(1);
    expect(parkingOut.stageSpec(parkingOut.levelStage(STAGE_LEVELS))).toEqual(parkingOut.stageSpec(999));
    expect(parkingOut.stageSpec(parkingOut.levelStage(STAGE_LEVELS) - 1)).not.toEqual(parkingOut.stageSpec(999));
  });

  it('같은 단계는 언제나 같은 주차장이다', () => {
    for (const level of SAMPLE_LEVELS) expect(start(level)).toEqual(start(level));
    expect(start(1).lot).not.toEqual(start(2).lot);
  });

  it('어느 단계든 차를 모두 뺄 수 있고, 기회를 가득 안고 시작한다', () => {
    for (const level of ALL_LEVELS) {
      const run = start(level);
      const spec = parkingOut.stageSpec(parkingOut.levelStage(level));
      expect(run.lot.cars, `${level}단계`).toHaveLength(spec.cars);
      expect(parkingOut.solveOrder(run.lot), `${level}단계`).not.toBeNull();
      expect(parkingOut.chancesLeft(run)).toBe(STAGE_HEARTS);
      expect(run).toMatchObject({ score: 0, carsOut: 0, bumps: 0 });
    }
  });

  it('막힌 차를 누를 때마다 기회가 하나씩 줄고 0 아래로는 내려가지 않는다', () => {
    const run = start(1);
    expect(parkingOut.chancesLeft({ ...run, bumps: 1 })).toBe(STAGE_HEARTS - 1);
    expect(parkingOut.chancesLeft({ ...run, bumps: STAGE_HEARTS })).toBe(0);
    expect(parkingOut.chancesLeft({ ...run, bumps: STAGE_HEARTS + 4 })).toBe(0);
  });
});

describe('나사 풀기의 단계', () => {
  const build = (level: number): screwSort.Stage =>
    screwSort.buildStage(screwSort.levelStage(level), stageRandom('screw-sort', level));

  it('가장 쉬운 난이도에서 시작해 정해 둔 난이도에서 끝난다', () => {
    expect(screwSort.levelStage(1)).toBe(1);
    expect(screwSort.levelStage(STAGE_LEVELS)).toBe(screwSort.LEVEL_STEPS);
  });

  it('같은 단계는 언제나 같은 판이다', () => {
    for (const level of [1, 2, 34, STAGE_LEVELS]) expect(build(level)).toEqual(build(level));
    expect(build(1)).not.toEqual(build(2));
  });

  it('어느 단계든 적어 둔 풀이대로 풀면 쟁반이 넘치지 않고 끝난다', () => {
    for (const level of SAMPLE_LEVELS) {
      const stage = build(level);
      const spec = screwSort.stageSpec(screwSort.levelStage(level));
      expect(stage.screws, `${level}단계`).toHaveLength(spec.screws);
      const result = screwSort.replay(stage, stage.solution);
      expect(result.solved, `${level}단계`).toBe(true);
      expect(result.peakTray, `${level}단계`).toBeLessThan(screwSort.TRAY_SIZE);
    }
  }, 60_000);
});

describe('논리 타일의 단계', () => {
  it('가장 작은 판에서 시작해 가장 큰 판으로 끝난다', () => {
    expect(logicTiles.levelStage(1)).toBe(1);
    expect(logicTiles.stageSpec(logicTiles.levelStage(STAGE_LEVELS))).toEqual(logicTiles.stageSpec(999));
    expect(logicTiles.stageSpec(logicTiles.levelStage(STAGE_LEVELS) - 1)).not.toEqual(logicTiles.stageSpec(999));
  });

  it('목숨을 가득 안고 덮인 판에서 시작한다', () => {
    for (const level of SAMPLE_LEVELS) {
      const run = logicTiles.levelRun(level);
      const spec = logicTiles.stageSpec(logicTiles.levelStage(level));
      expect(run.stage).toBe(logicTiles.levelStage(level));
      expect(run.hearts).toBe(logicTiles.START_HEARTS);
      expect(run.board).toMatchObject({ cols: spec.cols, rows: spec.rows, trapCount: spec.traps, traps: null });
      expect(run.board.tiles.every((tile) => tile === 'covered')).toBe(true);
    }
  });

  it('같은 단계에서 같은 칸을 처음 누르면 같은 판이 된다', () => {
    for (const level of [1, 21, STAGE_LEVELS]) {
      const open = (): logicTiles.RunState =>
        logicTiles.tapTile(logicTiles.levelRun(level), 0, stageRandom('logic-tiles', level)).run;
      expect(open().board).toEqual(open().board);
    }
  });

  it('어느 단계든 처음 누른 칸에서 찍지 않고 끝까지 풀 수 있다', () => {
    for (const level of SAMPLE_LEVELS) {
      const fresh = logicTiles.levelRun(level);
      const cells = fresh.board.cols * fresh.board.rows;
      // 모서리, 가운데, 가장자리를 처음 눌러 본다.
      for (const first of [0, Math.floor(cells / 2) + Math.floor(fresh.board.cols / 2), fresh.board.cols - 1]) {
        const { board } = logicTiles.tapTile(fresh, first, stageRandom('logic-tiles', level)).run;
        expect(board.traps, `${level}단계`).not.toBeNull();
        expect(board.traps!.filter(Boolean)).toHaveLength(board.trapCount);
        const { logic } = logicTiles.stageSpec(logicTiles.levelStage(level));
        expect(logicTiles.isSolvable(board, board.traps!, first, logic), `${level}단계 ${first}번 칸`).toBe(true);
      }
    }
  }, 60_000);
});

describe('숫자 퍼즐의 단계', () => {
  const start = (level: number): numberPuzzle.RunState =>
    numberPuzzle.levelRun(level, stageRandom('number-puzzle', level));

  it('가장 작은 판에서 시작해 빈칸이 가장 많은 판으로 끝난다', () => {
    expect(numberPuzzle.levelStage(1)).toBe(1);
    const last = numberPuzzle.levelStage(STAGE_LEVELS);
    expect(numberPuzzle.stageSpec(last).blanks).toBe(numberPuzzle.MAX_BLANKS);
    expect(numberPuzzle.stageSpec(last - 1).blanks).toBeLessThan(numberPuzzle.MAX_BLANKS);
  });

  it('같은 단계는 언제나 같은 판이다', () => {
    for (const level of SAMPLE_LEVELS) expect(start(level)).toEqual(start(level));
    expect(start(1).puzzle).not.toEqual(start(2).puzzle);
  });

  it('어느 단계든 찍지 않고 풀리고, 목숨을 가득 안고 시작한다', () => {
    for (const level of ALL_LEVELS) {
      const run = start(level);
      const { size, givens, solution } = run.puzzle;
      expect(size, `${level}단계`).toBe(numberPuzzle.stageSpec(numberPuzzle.levelStage(level)).size);
      const solved = numberPuzzle.solveWithSingles(givens, size);
      expect(solved.solved, `${level}단계`).toBe(true);
      expect(solved.grid).toEqual(solution);
      expect(run.grid).toEqual(givens);
      expect(run).toMatchObject({ hearts: numberPuzzle.START_HEARTS, score: 0, mistakes: 0, cellsFilled: 0 });
    }
  });
});

describe('핀 뽑기의 단계', () => {
  // 판은 그 자리에서 만들지 않고 적어 둔 표에서 꺼낸다. 표의 내용은 pin-pull/levels.test.ts가 살핀다.
  it('단계마다 정해진 판이 있고, 기회는 다른 게임과 같이 세 번이다', () => {
    expect(pinPullLevels.LEVEL_CODES).toHaveLength(STAGE_LEVELS);
    expect(pinPull.START_HEARTS).toBe(STAGE_HEARTS);
    for (const level of SAMPLE_LEVELS) {
      expect(pinPullLevels.levelPuzzle(level)).toEqual(pinPullLevels.levelPuzzle(level));
    }
    expect(pinPullLevels.levelPuzzle(1)).not.toEqual(pinPullLevels.levelPuzzle(2));
  });
});

describe('길 잇기의 단계', () => {
  const start = (level: number): pathLink.RunState => pathLink.levelRun(level, stageRandom('path-link', level));

  it('가장 작은 판에서 시작해 가장 큰 판으로 끝나고, 쌍은 모양의 가짓수를 넘지 않는다', () => {
    expect(pathLink.levelPlan(1)).toEqual(pathLink.LEVEL_PLANS[0]);
    expect(pathLink.levelPlan(STAGE_LEVELS)).toEqual(pathLink.LEVEL_PLANS[pathLink.LEVEL_PLANS.length - 1]);
    for (const [index, plan] of pathLink.LEVEL_PLANS.entries()) {
      const [fewest, most] = pathLink.pairRange(plan.size);
      expect(plan.pairs).toBeGreaterThanOrEqual(fewest);
      expect(plan.pairs).toBeLessThanOrEqual(Math.min(most, 8));
      if (index === 0) continue;
      // 판이 커지거나, 같은 크기에서 쌍이 줄어든다.
      const before = pathLink.LEVEL_PLANS[index - 1];
      expect(plan.size > before.size || (plan.size === before.size && plan.pairs < before.pairs)).toBe(true);
    }
  });

  it('같은 단계는 언제나 같은 판이다', () => {
    for (const level of SAMPLE_LEVELS) expect(start(level)).toEqual(start(level));
    expect(start(1).board.puzzle.dots).not.toEqual(start(2).board.puzzle.dots);
  });

  it('어느 단계든 정해 둔 판이 아니라 새로 만든 판이고, 그 난이도의 크기와 쌍의 수를 지킨다', () => {
    for (const level of ALL_LEVELS) {
      const { puzzle } = start(level).board;
      const plan = pathLink.levelPlan(level);
      expect(puzzle.size, `${level}단계`).toBe(plan.size);
      expect(puzzle.dots, `${level}단계`).toHaveLength(plan.pairs);
      expect(puzzle.solution, `${level}단계`).not.toEqual(pathLink.fallbackPartition(plan.size));
    }
  }, 60_000);

  it('어느 단계든 적어 둔 풀이대로 그으면 풀린다', () => {
    for (const level of ALL_LEVELS) {
      const run = start(level);
      let board = run.board;
      board.puzzle.solution.forEach((path, pair) => {
        board = pathLink.startStroke(board, path[0])?.board ?? board;
        for (const cell of path.slice(1)) board = pathLink.dragTo(board, pair, cell).board;
        board = pathLink.endStroke(board, pair);
      });
      expect(pathLink.isSolved(board), `${level}단계`).toBe(true);
      expect(run).toMatchObject({ timeLeft: pathLink.START_SECONDS, score: 0, boardsCleared: 0 });
    }
  }, 60_000);
});
