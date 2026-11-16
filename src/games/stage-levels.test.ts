import { describe, expect, it } from 'vitest';
import { seededRandom, STAGE_HEARTS, STAGE_LEVELS, stageRandom } from '../core/stages';
import * as colorSort from './color-sort/rules';
import * as logicTiles from './logic-tiles/rules';
import * as matchThree from './match-three/rules';
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
/** 앞쪽 열 단계와 뒤쪽 열 단계: 뒤로 갈수록 어려워지는지 견줄 때 쓴다. */
const FIRST_TEN = ALL_LEVELS.slice(0, 10);
const LAST_TEN = ALL_LEVELS.slice(-10);
/** 마지막 난이도 칸의 앞쪽과 뒤쪽: 설정이 같은 단계들 안에서도 어려워지는지 견줄 때 쓴다. */
const average = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;

describe('단계 모드를 하는 게임', () => {
  it('아홉 게임이고 모두 플레이할 수 있다', () => {
    expect(stageGames().map((game) => game.id)).toEqual([
      'color-sort',
      'pin-pull',
      'parking-out',
      'screw-sort',
      'logic-tiles',
      'number-puzzle',
      'path-link',
      'match-three',
      'box-push',
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
    colorSort.dealLevel(level, stageRandom('color-sort', level));

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
  }, 60_000);

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
      expect(colorSort.colorsFor(colorSort.levelStage(level)), `${level}단계`).toBe(stage.colors);
      expect(colorSort.levelPourBudget(stage.par, level)).toBeGreaterThanOrEqual(stage.par + 4);
    }
  }, 60_000);

  it('부을 수 있는 횟수의 여유는 풀이가 길수록 커지고, 단계가 오를수록 줄어든다', () => {
    expect(colorSort.levelPourBudget(6, 1)).toBe(12);
    expect(colorSort.levelPourBudget(12, 1)).toBe(18);
    expect(colorSort.levelPourBudget(20, 1)).toBe(30);
    expect(colorSort.levelPourBudget(25, 1)).toBe(38);
    expect(colorSort.levelPourBudget(-3, 1)).toBe(6);
    expect(colorSort.levelPourBudget(6, STAGE_LEVELS)).toBe(10);
    expect(colorSort.levelPourBudget(12, STAGE_LEVELS)).toBe(16);
    expect(colorSort.levelPourBudget(20, STAGE_LEVELS)).toBe(25);
    expect(colorSort.levelPourBudget(24, STAGE_LEVELS)).toBe(30);
    for (const level of ALL_LEVELS.slice(1)) {
      expect(colorSort.levelPourBudget(20, level)).toBeLessThanOrEqual(colorSort.levelPourBudget(20, level - 1));
      expect(colorSort.levelEase(level)).toBeLessThan(colorSort.levelEase(level - 1));
    }
  });

  it('대충 부어서 풀리는 비율은 풀린 판에서 1이고, 한 번도 못 붓는 판에서 0이다', () => {
    const done = [[0, 0, 0, 0], [1, 1, 1, 1], [], []];
    expect(colorSort.carelessEase(done, 5, seededRandom('ease'))).toBe(1);
    const open = colorSort.fallbackTubes(3);
    expect(colorSort.carelessEase(open, 0, seededRandom('ease'))).toBe(0);
    const ease = colorSort.carelessEase(open, 30, seededRandom('ease'));
    expect(ease).toBeGreaterThan(0);
    expect(ease).toBeLessThanOrEqual(1);
    expect(colorSort.carelessEase(open, 30, seededRandom('ease'))).toBe(ease);
  });

  it('뒤로 갈수록 대충 부어서는 풀기 어렵다: 색 수가 같은 단계들 안에서도 그렇다', () => {
    const ease = (level: number): number => {
      const stage = deal(level);
      return colorSort.carelessEase(stage.tubes, colorSort.levelPourBudget(stage.par, level), seededRandom(`ease:${level}`), 200);
    };
    const first = average(FIRST_TEN.map(ease));
    const last = average(LAST_TEN.map(ease));
    expect(first).toBeGreaterThan(0.9);
    expect(last).toBeLessThan(0.4);
    // 51~82단계는 모두 여섯 색이다. 그 앞쪽 열 단계보다 뒤쪽 열 단계가 어렵다.
    expect(new Set(ALL_LEVELS.slice(50, 82).map((level) => deal(level).colors))).toEqual(new Set([6]));
    expect(average(ALL_LEVELS.slice(72, 82).map(ease))).toBeLessThan(average(ALL_LEVELS.slice(50, 60).map(ease)) - 0.05);
  }, 60_000);
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

  it('흘끗 보고 비울 수 있는 비율과 빼는 순서의 깊이를 잰다', () => {
    const empty: parkingOut.Lot = { cols: 5, rows: 5, cars: [] };
    expect(parkingOut.lotDepth(empty)).toBe(0);
    expect(parkingOut.glanceEase(empty, seededRandom('glance'))).toBe(1);
    // 뒤차가 한 칸 띄우고 앞차에 막혀 있다: 막은 차가 바로 보이므로 흘끗 봐도 틀리지 않는다.
    const near: parkingOut.Lot = {
      cols: 5,
      rows: 5,
      cars: [
        { id: 0, col: 2, row: 2, length: 1, facing: 'right' },
        { id: 1, col: 4, row: 2, length: 1, facing: 'right' },
      ],
    };
    expect(parkingOut.lotDepth(near)).toBe(2);
    expect(parkingOut.glanceEase(near, seededRandom('glance'))).toBe(1);
    // 세 칸 띄우고 막혀 있으면 막은 차가 보이지 않아서, 뒤차를 먼저 눌러 기회를 잃기도 한다.
    const far: parkingOut.Lot = { ...near, cars: [{ ...near.cars[0], col: 0 }, near.cars[1]] };
    expect(parkingOut.lotDepth(far)).toBe(2);
    const farEase = parkingOut.glanceEase(far, seededRandom('glance'), 400);
    expect(farEase).toBeGreaterThan(0.7);
    expect(farEase).toBeLessThan(1);
    // 서로 마주 보고 막은 두 차는 뺄 수 없다.
    const stuck: parkingOut.Lot = { ...near, cars: [near.cars[0], { ...near.cars[1], facing: 'left' }] };
    expect(parkingOut.lotDepth(stuck)).toBe(Infinity);
    for (const level of SAMPLE_LEVELS) {
      const { lot } = start(level);
      const depth = parkingOut.lotDepth(lot);
      expect(depth, `${level}단계`).toBeGreaterThanOrEqual(1);
      expect(depth, `${level}단계`).toBeLessThanOrEqual(lot.cars.length);
      const ease = parkingOut.glanceEase(lot, seededRandom(`glance:${level}`));
      expect(ease).toBeGreaterThanOrEqual(0);
      expect(ease).toBeLessThanOrEqual(1);
      expect(parkingOut.glanceEase(lot, seededRandom(`glance:${level}`))).toBe(ease);
    }
  });

  it('뒤로 갈수록 흘끗 봐서는 비우기 어렵다: 차의 수가 같은 단계들 안에서도 그렇다', () => {
    const ease = (level: number): number =>
      parkingOut.glanceEase(start(level).lot, seededRandom(`glance:${level}`), 200);
    for (const level of ALL_LEVELS.slice(1)) {
      expect(parkingOut.levelEase(level)).toBeLessThan(parkingOut.levelEase(level - 1));
    }
    expect(average(FIRST_TEN.map(ease))).toBeGreaterThan(0.7);
    expect(average(LAST_TEN.map(ease))).toBeLessThan(0.1);
    // 80~100단계는 모두 가장 붐비는 주차장이다. 그 안에서도 앞쪽보다 뒤쪽이 깊다.
    expect(new Set(ALL_LEVELS.slice(79).map((level) => start(level).lot.cars.length)).size).toBe(1);
    const depth = (level: number): number => parkingOut.lotDepth(start(level).lot);
    expect(average(LAST_TEN.map(depth))).toBeGreaterThanOrEqual(average(ALL_LEVELS.slice(79, 89).map(depth)));
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
      expect(run.board).toMatchObject({
        cols: spec.cols,
        rows: spec.rows,
        trapCount: logicTiles.levelTraps(level),
        traps: null,
      });
      expect(run.board.tiles.every((tile) => tile === 'covered')).toBe(true);
    }
  });

  it('함정은 단계가 오를수록 줄지 않고, 같은 크기의 판 안에서도 늘어난다', () => {
    expect(logicTiles.levelTraps(1)).toBe(logicTiles.stageSpec(1).traps);
    expect(logicTiles.levelTraps(STAGE_LEVELS)).toBe(logicTiles.LAST_LEVEL_TRAPS);
    for (const level of ALL_LEVELS.slice(1)) {
      const traps = logicTiles.levelTraps(level);
      expect(traps, `${level}단계`).toBeGreaterThanOrEqual(logicTiles.levelTraps(level - 1));
      // 그 칸의 함정 수에서 시작해 다음 칸의 함정 수는 넘지 않는다.
      const stage = logicTiles.levelStage(level);
      expect(traps).toBeGreaterThanOrEqual(logicTiles.stageSpec(stage).traps);
      if (stage < logicTiles.LEVEL_STEPS) expect(traps).toBeLessThan(logicTiles.stageSpec(stage + 1).traps);
    }
    // 마지막 칸(83~100단계)은 판의 크기가 같지만 함정이 더 늘어난다.
    expect(logicTiles.levelStage(83)).toBe(logicTiles.LEVEL_STEPS);
    expect(logicTiles.levelTraps(STAGE_LEVELS)).toBeGreaterThan(logicTiles.levelTraps(83));
    // 점수 도전의 판은 그대로다.
    expect(logicTiles.newRun().board.trapCount).toBe(logicTiles.stageSpec(1).traps);
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

  it('길이 돌아가는 정도를 잰다: 곧은 길뿐이면 0이다', () => {
    expect(pathLink.detourShare(pathLink.puzzleFrom(5, pathLink.fallbackPartition(5)))).toBe(0);
    // 5칸짜리 길이 ㄷ자로 돌아가면 두 점은 한 칸 떨어져 있어도 길은 네 칸을 간다.
    const bent = pathLink.puzzleFrom(2, [[0, 1, 3, 2]]);
    expect(pathLink.detourShare(bent)).toBe((3 - 1) / 4);
  });

  it('뒤로 갈수록 길이 더 돌아간다: 판 크기와 쌍의 수가 같은 단계들 안에서도 그렇다', () => {
    const detour = (level: number): number => pathLink.detourShare(start(level).board.puzzle);
    for (const level of ALL_LEVELS.slice(1)) {
      expect(pathLink.levelDetour(level)).toBeGreaterThan(pathLink.levelDetour(level - 1));
    }
    expect(average(LAST_TEN.map(detour))).toBeGreaterThan(average(FIRST_TEN.map(detour)) + 0.2);
    // 84~100단계는 판 크기와 쌍의 수가 같다. 그 안에서도 앞쪽보다 뒤쪽이 더 돌아간다.
    expect(new Set(ALL_LEVELS.slice(83).map((level) => pathLink.levelPlan(level))).size).toBe(1);
    expect(average(ALL_LEVELS.slice(92).map(detour))).toBeGreaterThan(average(ALL_LEVELS.slice(83, 91).map(detour)));
  }, 60_000);

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

describe('세 개 맞추기의 단계', () => {
  it('난이도 칸의 첫 단계는 그 칸의 횟수로 시작하고 마지막 단계는 가장 빠듯한 횟수가 된다', () => {
    expect(matchThree.levelMoves(1)).toBe(matchThree.LEVEL_SPECS[0].moves);
    expect(matchThree.levelMoves(STAGE_LEVELS)).toBe(matchThree.LEVEL_SPECS[matchThree.LEVEL_SPECS.length - 1].tight);
    // 마지막 칸(86~100단계)은 목표가 같지만 횟수가 줄어든다.
    expect(matchThree.levelStage(86)).toBe(matchThree.LEVEL_STEPS);
    expect(matchThree.levelMoves(86)).toBeGreaterThan(matchThree.levelMoves(STAGE_LEVELS));
  });

  it('조각이 적고 목표가 하나인 판에서 시작해, 조각이 가장 많고 목표가 셋인 판으로 끝난다', () => {
    const first = matchThree.levelSpec(1);
    const last = matchThree.levelSpec(STAGE_LEVELS);
    expect(first).toEqual(matchThree.LEVEL_SPECS[0]);
    expect(last).toEqual(matchThree.LEVEL_SPECS[matchThree.LEVEL_SPECS.length - 1]);
    expect(first.kinds).toBe(matchThree.MIN_KINDS);
    expect(first.goals).toBe(1);
    expect(last.kinds).toBe(matchThree.MAX_KINDS);
    expect(last.goals).toBe(3);
    for (const [index, spec] of matchThree.LEVEL_SPECS.entries()) {
      expect(spec.goals).toBeLessThanOrEqual(spec.kinds);
      expect(spec.tight).toBeGreaterThan(0);
      // 같은 칸 안에서는 횟수가 줄어든다.
      expect(spec.tight).toBeLessThan(spec.moves);
      if (index === 0) continue;
      // 조각의 갈래와 한 번에 모아야 하는 양(횟수 하나에 모을 조각)은 줄지 않는다.
      const before = matchThree.LEVEL_SPECS[index - 1];
      expect(spec.kinds).toBeGreaterThanOrEqual(before.kinds);
      if (spec.kinds === before.kinds) {
        expect((spec.goals * spec.count) / spec.moves).toBeGreaterThanOrEqual(
          (before.goals * before.count) / before.moves,
        );
      }
    }
  });

  it('같은 단계는 언제나 같은 판이고, 새로 들어오는 조각도 같은 차례로 나온다', () => {
    for (const level of SAMPLE_LEVELS) {
      const plan = matchThree.levelPlan(level);
      expect(matchThree.levelPlan(level)).toEqual(plan);
      const one = matchThree.refillRandom(plan.seed);
      const other = matchThree.refillRandom(plan.seed);
      for (let index = 0; index < 20; index += 1) expect(one()).toBe(other());
    }
    expect(matchThree.levelPlan(1).board).not.toEqual(matchThree.levelPlan(2).board);
  });

  it('어느 단계든 그 난이도의 조각과 횟수와 목표를 지키고, 처음 판은 바로 둘 수 있다', () => {
    for (const level of ALL_LEVELS) {
      const plan = matchThree.levelPlan(level);
      const spec = matchThree.levelSpec(level);
      expect(plan.level).toBe(level);
      expect(plan.kinds, `${level}단계`).toBe(spec.kinds);
      expect(plan.moves, `${level}단계`).toBe(matchThree.levelMoves(level));
      expect(plan.moves).toBeLessThanOrEqual(spec.moves);
      expect(plan.moves).toBeGreaterThanOrEqual(spec.tight);
      // 같은 칸 안에서는 뒤로 갈수록 횟수가 줄기만 한다.
      if (level > 1 && matchThree.levelStage(level - 1) === matchThree.levelStage(level)) {
        expect(plan.moves).toBeLessThanOrEqual(matchThree.levelMoves(level - 1));
      }
      expect(plan.goals, `${level}단계`).toHaveLength(spec.goals);
      expect(new Set(plan.goals.map((goal) => goal.kind)).size, `${level}단계`).toBe(spec.goals);
      for (const goal of plan.goals) {
        expect(goal.kind).toBeGreaterThanOrEqual(0);
        expect(goal.kind).toBeLessThan(spec.kinds);
        expect(goal.count).toBe(spec.count);
      }
      expect(plan.board).toHaveLength(matchThree.CELLS);
      expect(plan.board.every((piece) => piece.kind < spec.kinds && piece.power === null), `${level}단계`).toBe(true);
      expect(matchThree.hasMatch(plan.board), `${level}단계`).toBe(false);
      expect(matchThree.hasMove(plan.board), `${level}단계`).toBe(true);
    }
  }, 60_000);

  it('어느 단계든 풀이꾼이 횟수를 남기고 깬다', () => {
    for (const level of ALL_LEVELS) {
      const left = matchThree.solveLevel(matchThree.levelPlan(level));
      expect(left, `${level}단계`).not.toBeNull();
      expect(left ?? 0, `${level}단계`).toBeGreaterThanOrEqual(matchThree.SOLVER_MARGIN);
    }
  }, 60_000);

  it('풀이꾼이 고른 자리를 그대로 따라 두면 깬다', () => {
    for (const level of SAMPLE_LEVELS) {
      const plan = matchThree.levelPlan(level);
      const random = matchThree.refillRandom(plan.seed);
      let run = matchThree.startLevel(plan);
      while (!matchThree.isLevelCleared(run) && run.movesLeft > 0) {
        const move = matchThree.solverMove(run);
        if (!move) break;
        const turn = matchThree.playSwap(run.board, move.a, move.b, plan.kinds, random);
        if (!turn) break;
        run = matchThree.afterTurn(run, turn);
      }
      expect(matchThree.isLevelCleared(run), `${level}단계`).toBe(true);
      expect(matchThree.isLevelFailed(run), `${level}단계`).toBe(false);
    }
  });

  it('아무 자리나 맨 먼저 보이는 대로 두면 못 깨는 단계가 있다', () => {
    // 횟수가 넉넉하기만 하면 단계가 아니다: 뒤쪽 단계는 목표를 보고 두어야 깬다.
    const failed = ALL_LEVELS.filter((level) => {
      const plan = matchThree.levelPlan(level);
      const random = matchThree.refillRandom(plan.seed);
      let run = matchThree.startLevel(plan);
      while (!matchThree.isLevelCleared(run) && run.movesLeft > 0) {
        const [move] = matchThree.findMoves(run.board);
        const turn = matchThree.playSwap(run.board, move.a, move.b, plan.kinds, random);
        if (!turn) break;
        run = matchThree.afterTurn(run, turn);
      }
      return !matchThree.isLevelCleared(run);
    });
    expect(failed.length, `못 깬 단계: ${failed.join(', ')}`).toBeGreaterThan(10);
  }, 60_000);

  it('범위를 벗어난 단계 번호는 처음이나 끝의 단계로 맞춘다', () => {
    expect(matchThree.levelPlan(0)).toEqual(matchThree.levelPlan(1));
    expect(matchThree.levelPlan(STAGE_LEVELS + 5)).toEqual(matchThree.levelPlan(STAGE_LEVELS));
    expect(matchThree.levelPlan(2.9)).toEqual(matchThree.levelPlan(2));
    expect(matchThree.levelPlan(Number.NaN)).toEqual(matchThree.levelPlan(1));
  });
});
