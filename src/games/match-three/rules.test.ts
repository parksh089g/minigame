import { describe, expect, it } from 'vitest';
import { seededRandom } from '../../core/stages';
import {
  afterTurn,
  areAdjacent,
  ARCADE_KINDS,
  BURST_SECONDS,
  cellOf,
  CELLS,
  chainOf,
  clearingOf,
  COLS,
  findMoves,
  hasMatch,
  hasMove,
  isLevelCleared,
  isLevelFailed,
  isValidSwap,
  MAX_CHAIN_BONUS,
  MAX_KINDS,
  MAX_TURN_SECONDS,
  MIN_KINDS,
  neighbourOf,
  newBoard,
  PIECE_POINTS,
  playSwap,
  resolve,
  ROWS,
  runsOf,
  secondsBack,
  settle,
  shuffleBoard,
  startLevel,
  stepPoints,
  toKinds,
  type LevelPlan,
  type Piece,
  type Turn,
} from './rules';

/**
 * 글자로 그린 판을 읽는다. 줄마다 COLS글자, 숫자는 조각의 갈래이고 대문자 A~F는 그 갈래(0~5)의 폭죽,
 * '.'은 빈칸이다. 적지 않은 줄은 서로 맞지 않는 무늬(갈래 3, 4, 5)로 위에서부터 채운다.
 */
function boardOf(rows: string[]): (Piece | null)[] {
  const filler = (col: number, row: number): Piece => ({ kind: 3 + ((col + row * 2) % 3), burst: false });
  const board: (Piece | null)[] = [];
  const offset = ROWS - rows.length;
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const letter = row < offset ? '?' : rows[row - offset][col];
      if (letter === '?') board.push(filler(col, row));
      else if (letter === '.') board.push(null);
      else if (letter >= 'A' && letter <= 'F') board.push({ kind: letter.charCodeAt(0) - 65, burst: true });
      else board.push({ kind: Number(letter), burst: false });
    }
  }
  return board;
}

/** 채움 무늬만으로 된 판: 맞은 줄이 없다. */
const QUIET = boardOf([]) as Piece[];

/** 언제나 같은 갈래만 뽑는 난수 */
const always = (kind: number, kinds = MAX_KINDS) => () => (kind + 0.5) / kinds;

describe('칸', () => {
  it('붙은 칸만 이웃이다', () => {
    expect(areAdjacent(0, 1)).toBe(true);
    expect(areAdjacent(0, COLS)).toBe(true);
    expect(areAdjacent(0, COLS + 1)).toBe(false);
    // 줄의 끝과 다음 줄의 처음은 번호가 이어져도 이웃이 아니다.
    expect(areAdjacent(COLS - 1, COLS)).toBe(false);
    expect(areAdjacent(0, 0)).toBe(false);
    expect(areAdjacent(-1, 0)).toBe(false);
    expect(areAdjacent(CELLS - 1, CELLS)).toBe(false);
  });

  it('판 밖으로는 이웃이 없다', () => {
    expect(neighbourOf(0, 'left')).toBeNull();
    expect(neighbourOf(0, 'up')).toBeNull();
    expect(neighbourOf(0, 'right')).toBe(1);
    expect(neighbourOf(0, 'down')).toBe(COLS);
    expect(neighbourOf(CELLS - 1, 'right')).toBeNull();
    expect(neighbourOf(CELLS - 1, 'down')).toBeNull();
  });
});

describe('맞은 줄 찾기', () => {
  it('채움 무늬에는 맞은 줄이 없다', () => {
    expect(runsOf(QUIET)).toEqual([]);
    expect(hasMatch(QUIET)).toBe(false);
  });

  it('가로로 셋이 나란하면 맞은 줄이다', () => {
    const board = boardOf(['000????']);
    const runs = runsOf(board);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toEqual({ cells: [49, 50, 51], kind: 0, horizontal: true });
  });

  it('세로로 넷이 나란하면 한 줄로 찾는다', () => {
    const board = boardOf(['1??????', '1??????', '1??????', '1??????']);
    const runs = runsOf(board);
    expect(runs).toHaveLength(1);
    expect(runs[0].horizontal).toBe(false);
    expect(runs[0].cells).toEqual([28, 35, 42, 49]);
  });

  it('둘만 나란하거나 빈칸이 끼면 맞은 줄이 아니다', () => {
    expect(runsOf(boardOf(['00?????']))).toEqual([]);
    expect(runsOf(boardOf(['0.0????']))).toEqual([]);
    expect(runsOf(boardOf(['...????']))).toEqual([]);
  });

  it('줄의 끝에서 다음 줄로 이어지지 않는다', () => {
    const board = boardOf(['?????00', '0??????']);
    expect(runsOf(board)).toEqual([]);
  });
});

describe('맞바꾸기', () => {
  // 가운데 칸을 아래로 내리면 0이 가로로 셋 맞는다.
  const board = boardOf(['?0?????', '0?0????']) as Piece[];

  it('맞는 줄이 생기는 자리만 바꿀 수 있다', () => {
    expect(isValidSwap(board, cellOf(1, 6), cellOf(1, 7))).toBe(true);
    expect(isValidSwap(board, cellOf(1, 7), cellOf(1, 6))).toBe(true);
    expect(isValidSwap(board, cellOf(5, 6), cellOf(5, 7))).toBe(false);
  });

  it('붙어 있지 않으면 바꿀 수 없다', () => {
    expect(isValidSwap(board, cellOf(1, 6), cellOf(1, 6))).toBe(false);
    expect(isValidSwap(board, cellOf(1, 5), cellOf(1, 7))).toBe(false);
  });

  it('할 수 있는 맞바꾸기를 찾는다', () => {
    const moves = findMoves(board);
    expect(moves).toContainEqual({ a: cellOf(1, 6), b: cellOf(1, 7) });
    for (const move of moves) expect(isValidSwap(board, move.a, move.b)).toBe(true);
    expect(hasMove(board)).toBe(true);
  });

  it('채움 무늬에는 할 수 있는 맞바꾸기가 없다', () => {
    expect(findMoves(QUIET)).toEqual([]);
    expect(hasMove(QUIET)).toBe(false);
  });

  it('바꿀 수 없는 자리에 두면 null이고 판은 그대로다', () => {
    const before = JSON.stringify(board);
    expect(playSwap(board, cellOf(5, 6), cellOf(5, 7), MAX_KINDS, always(3))).toBeNull();
    expect(JSON.stringify(board)).toBe(before);
  });

  it('둔 뒤에도 받은 판은 바뀌지 않는다', () => {
    const before = JSON.stringify(board);
    const turn = playSwap(board, cellOf(1, 6), cellOf(1, 7), MAX_KINDS, seededRandom('x'));
    expect(turn).not.toBeNull();
    expect(JSON.stringify(board)).toBe(before);
  });
});

describe('새 판', () => {
  it('맞아 있는 줄이 없고 할 수 있는 맞바꾸기가 있다', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      for (const kinds of [MIN_KINDS, MAX_KINDS]) {
        const board = newBoard(kinds, seededRandom(`board${seed}`));
        expect(board).toHaveLength(CELLS);
        expect(hasMatch(board)).toBe(false);
        expect(hasMove(board)).toBe(true);
        for (const piece of board) {
          expect(piece.kind).toBeGreaterThanOrEqual(0);
          expect(piece.kind).toBeLessThan(kinds);
          expect(piece.burst).toBe(false);
        }
      }
    }
  });

  it('같은 난수면 같은 판이다', () => {
    expect(newBoard(6, seededRandom('same'))).toEqual(newBoard(6, seededRandom('same')));
  });

  it('난수가 한쪽 끝만 내도 맞은 줄 없이 채운다', () => {
    expect(hasMatch(newBoard(6, () => 0))).toBe(false);
    expect(hasMatch(newBoard(6, () => 0.999999))).toBe(false);
  });

  it('조각의 가짓수는 정해진 범위로 맞춘다', () => {
    expect(toKinds(1)).toBe(MIN_KINDS);
    expect(toKinds(99)).toBe(MAX_KINDS);
    expect(toKinds(5.9)).toBe(5);
    expect(toKinds(Number.NaN)).toBe(MAX_KINDS);
  });
});

describe('사라질 것 셈하기', () => {
  it('맞은 줄이 없으면 null이다', () => {
    expect(clearingOf(QUIET)).toBeNull();
  });

  it('셋이 맞으면 그 셋만 사라지고 폭죽은 생기지 않는다', () => {
    const clearing = clearingOf(boardOf(['000????']));
    expect(clearing).toEqual({ matched: [49, 50, 51], blasted: [], detonated: [], made: [] });
  });

  it('넷이 맞으면 방금 옮긴 칸에 폭죽이 생긴다', () => {
    const board = boardOf(['0000???']);
    expect(clearingOf(board, [51])?.made).toEqual([{ cell: 51, kind: 0 }]);
    expect(clearingOf(board, [99, 50])?.made).toEqual([{ cell: 50, kind: 0 }]);
  });

  it('옮긴 칸이 없으면 묶음의 가운데 칸에 폭죽이 생긴다', () => {
    expect(clearingOf(boardOf(['0000???']))?.made).toEqual([{ cell: 51, kind: 0 }]);
    expect(clearingOf(boardOf(['00000??']))?.made).toEqual([{ cell: 51, kind: 0 }]);
  });

  it('가로줄과 세로줄이 만나면 만나는 칸에 폭죽이 생긴다', () => {
    const board = boardOf(['1??????', '1??????', '111????']);
    const clearing = clearingOf(board);
    expect(clearing?.matched).toEqual([35, 42, 49, 50, 51]);
    expect(clearing?.made).toEqual([{ cell: 49, kind: 1 }]);
  });

  it('떨어져 있는 두 줄은 따로 센다: 셋씩이면 폭죽이 없다', () => {
    const clearing = clearingOf(boardOf(['000?111']));
    expect(clearing?.matched).toHaveLength(6);
    expect(clearing?.made).toEqual([]);
  });

  it('맞은 줄에 폭죽이 있으면 그 가로줄과 세로줄이 함께 사라진다', () => {
    const board = boardOf(['0A0????']);
    const clearing = clearingOf(board);
    expect(clearing?.matched).toEqual([49, 50, 51]);
    expect(clearing?.detonated).toEqual([50]);
    // 가로줄의 나머지 넷과 세로줄의 나머지 일곱
    expect(clearing?.blasted).toHaveLength(COLS - 3 + ROWS - 1);
    for (const cell of clearing?.blasted ?? []) {
      expect(cell % COLS === 1 || Math.floor(cell / COLS) === ROWS - 1).toBe(true);
    }
  });

  it('폭죽에 휩쓸린 폭죽도 이어서 터진다', () => {
    const board = boardOf(['??????E', '0A0????']);
    // 아래 줄의 폭죽이 가로줄을 쓸지만 위의 폭죽(6번 세로줄, 한 줄 위)은 닿지 않는다.
    expect(clearingOf(board)?.detonated).toEqual([50]);
    const chained = boardOf(['0A0???E']);
    const clearing = clearingOf(chained);
    expect(clearing?.detonated).toEqual([50, 55]);
    // 두 세로줄과 가로줄 하나
    expect((clearing?.matched.length ?? 0) + (clearing?.blasted.length ?? 0)).toBe(COLS + (ROWS - 1) * 2);
  });
});

describe('떨어지기', () => {
  it('빈칸 위의 조각이 내려오고 위에서 새 조각이 들어온다', () => {
    const board = boardOf(['...????']);
    const settled = settle(board, MAX_KINDS, always(2));
    expect(settled.board.every((piece) => piece !== null)).toBe(true);
    // 세 세로줄에서 일곱 칸씩 내려온다.
    expect(settled.drops).toHaveLength(3 * (ROWS - 1));
    for (const drop of settled.drops) expect(drop.to - drop.from).toBe(COLS);
    expect(settled.spawns.map((spawn) => spawn.cell)).toEqual([0, 1, 2]);
    for (const spawn of settled.spawns) {
      expect(spawn.piece).toEqual({ kind: 2, burst: false });
      expect(spawn.above).toBe(1);
    }
  });

  it('한 세로줄에 빈칸이 여럿이면 그만큼 내려오고 그만큼 들어온다', () => {
    const board = boardOf(['.??????', '2??????', '.??????', '.??????']);
    const settled = settle(board, MAX_KINDS, always(4));
    expect(settled.board[cellOf(0, 7)]).toEqual({ kind: 2, burst: false });
    expect(settled.spawns.map((spawn) => spawn.cell)).toEqual([cellOf(0, 2), cellOf(0, 1), cellOf(0, 0)]);
    for (const spawn of settled.spawns) expect(spawn.above).toBe(3);
    expect(settled.drops).toContainEqual({ from: cellOf(0, 5), to: cellOf(0, 7) });
  });

  it('빈칸이 없으면 아무것도 움직이지 않는다', () => {
    const settled = settle(QUIET, MAX_KINDS, always(0));
    expect(settled.drops).toEqual([]);
    expect(settled.spawns).toEqual([]);
    expect(settled.board).toEqual(QUIET);
  });
});

describe('한 차례', () => {
  it('맞은 줄이 없으면 아무 일도 없다', () => {
    const turn = resolve(QUIET, MAX_KINDS, always(0));
    expect(turn.steps).toEqual([]);
    expect(turn.points).toBe(0);
    expect(turn.shuffle).toBeNull();
    expect(turn.board).toEqual(QUIET);
  });

  it('셋을 맞추면 조각 셋의 점수를 받는다', () => {
    const board = boardOf(['?0?????', '0?0????']) as Piece[];
    // 새 조각이 판과 맞지 않게, 채움 무늬에 없는 갈래를 번갈아 낸다.
    let index = 0;
    const turn = playSwap(board, cellOf(1, 6), cellOf(1, 7), MAX_KINDS, () => ((index++ % 3) + 0.5) / MAX_KINDS) as Turn;
    expect(turn.steps[0].matched).toEqual([49, 50, 51]);
    expect(turn.steps[0].points).toBe(3 * PIECE_POINTS);
    expect(turn.cleared[0]).toBeGreaterThanOrEqual(3);
    expect(turn.points).toBe(turn.steps.reduce((sum, step) => sum + step.points, 0));
  });

  it('떨어진 조각이 또 맞으면 연쇄가 이어지고 점수가 곱해진다', () => {
    // 아래 줄의 0 셋이 사라지면 그 위의 1 셋이 내려와 나란해진다.
    const board = boardOf(['1??????', '?1?????', '??1????', '000????']);
    let index = 0;
    const turn = resolve(board, MAX_KINDS, () => ((index++ % 2 === 0 ? 2 : 0) + 0.5) / MAX_KINDS);
    expect(chainOf(turn)).toBeGreaterThanOrEqual(1);
    expect(turn.steps[0].chain).toBe(1);
    turn.steps.forEach((step, at) => {
      expect(step.chain).toBe(at + 1);
      expect(step.points).toBe(stepPoints(step.matched.length + step.blasted.length, step.chain));
    });
  });

  it('연쇄의 점수는 정해진 배수까지만 곱해진다', () => {
    expect(stepPoints(3, 1)).toBe(3 * PIECE_POINTS);
    expect(stepPoints(3, 2)).toBe(6 * PIECE_POINTS);
    expect(stepPoints(3, MAX_CHAIN_BONUS + 5)).toBe(3 * PIECE_POINTS * MAX_CHAIN_BONUS);
    expect(stepPoints(0, 3)).toBe(0);
    expect(stepPoints(-2, 0)).toBe(0);
  });

  it('넷을 맞추면 옮긴 자리에 폭죽이 남는다', () => {
    const board = boardOf(['??0????', '00?0???']) as Piece[];
    let index = 0;
    const turn = playSwap(board, cellOf(2, 6), cellOf(2, 7), MAX_KINDS, () => ((index++ % 3) + 0.5) / MAX_KINDS) as Turn;
    expect(turn.steps[0].made).toEqual([{ cell: cellOf(2, 7), kind: 0 }]);
    expect(turn.made).toBeGreaterThanOrEqual(1);
    // 폭죽은 사라진 것으로 세지 않는다: 넷이 맞았지만 넷 모두 사라진 조각으로 센다(그 자리에 새 폭죽이 놓인다).
    expect(turn.steps[0].matched).toHaveLength(4);
    expect(turn.steps[0].board[cellOf(2, 7)]).toEqual({ kind: 0, burst: true });
  });

  it('폭죽을 터뜨리면 줄째 사라지고 터진 수를 센다', () => {
    const board = boardOf(['0A0????']);
    const turn = resolve(board, MAX_KINDS, seededRandom('burst'));
    expect(turn.bursts).toBeGreaterThanOrEqual(1);
    expect(turn.steps[0].detonated).toEqual([50]);
    expect(turn.steps[0].points).toBe((COLS + ROWS - 1) * PIECE_POINTS);
  });

  it('끝난 판에는 맞은 줄이 없고 할 수 있는 맞바꾸기가 있다', () => {
    for (let seed = 0; seed < 60; seed += 1) {
      const random = seededRandom(`turn${seed}`);
      let board = newBoard(seed % 2 === 0 ? 5 : 6, random);
      for (let move = 0; move < 12; move += 1) {
        const [first] = findMoves(board);
        const turn = playSwap(board, first.a, first.b, seed % 2 === 0 ? 5 : 6, random) as Turn;
        expect(turn.steps.length).toBeGreaterThan(0);
        board = turn.board;
        expect(board).toHaveLength(CELLS);
        expect(hasMatch(board)).toBe(false);
        expect(hasMove(board)).toBe(true);
        // 사라진 조각의 수와 점수가 걸음마다의 합과 같다.
        const gone = turn.steps.reduce((sum, step) => sum + step.matched.length + step.blasted.length, 0);
        expect(turn.cleared.reduce((sum, count) => sum + count, 0)).toBe(gone);
      }
    }
  });

  it('같은 난수로 같은 자리에 두면 같은 결과다', () => {
    const board = newBoard(6, seededRandom('replay'));
    const [move] = findMoves(board);
    const one = playSwap(board, move.a, move.b, 6, seededRandom('refill'));
    const other = playSwap(board, move.a, move.b, 6, seededRandom('refill'));
    expect(one).toEqual(other);
  });
});

describe('섞기', () => {
  it('조각은 그대로이고 자리만 바뀌며, 맞은 줄이 없고 할 수 있는 맞바꾸기가 있다', () => {
    const board = newBoard(6, seededRandom('shuffle'));
    const marked = board.map((piece, cell) => (cell === 10 ? { ...piece, burst: true } : piece));
    const shuffle = shuffleBoard(marked, seededRandom('s'));
    expect(shuffle).not.toBeNull();
    if (!shuffle) return;
    expect([...shuffle.from].sort((a, b) => a - b)).toEqual(Array.from({ length: CELLS }, (_, cell) => cell));
    shuffle.board.forEach((piece, cell) => expect(piece).toBe(marked[shuffle.from[cell]]));
    expect(hasMatch(shuffle.board)).toBe(false);
    expect(hasMove(shuffle.board)).toBe(true);
    expect(shuffle.board.filter((piece) => piece.burst)).toHaveLength(1);
  });

  it('할 수 있는 것이 없는 판으로 끝나면 그 차례에 섞는다', () => {
    // 아래 줄 셋이 사라지고, 새로 들어오는 조각이 채움 무늬와 같으면 할 수 있는 것이 없을 수 있다.
    // 어떤 난수에서든 끝난 판은 둘 수 있는 판이어야 한다.
    const board = boardOf(['000????']);
    for (let seed = 0; seed < 40; seed += 1) {
      const turn = resolve(board, MAX_KINDS, seededRandom(`dead${seed}`));
      expect(hasMatch(turn.board)).toBe(false);
      expect(hasMove(turn.board)).toBe(true);
      if (turn.shuffle) {
        expect(turn.board).toEqual(turn.shuffle.board);
        const last = turn.steps[turn.steps.length - 1].board;
        turn.shuffle.board.forEach((piece, cell) => expect(piece).toEqual(last[turn.shuffle?.from[cell] ?? 0]));
      }
    }
  });

  it('한 갈래뿐이라 섞어도 소용없으면 null이다', () => {
    const same = Array.from({ length: CELLS }, (): Piece => ({ kind: 0, burst: false }));
    expect(shuffleBoard(same, seededRandom('same'))).toBeNull();
  });
});

describe('점수 도전의 시간', () => {
  const turnWith = (bursts: number): Turn => ({
    steps: [],
    board: QUIET,
    points: 0,
    cleared: [],
    bursts,
    made: 0,
    shuffle: null,
  });

  it('폭죽을 터뜨린 만큼 시간을 돌려받고, 한 차례에 받는 시간에는 끝이 있다', () => {
    expect(secondsBack(turnWith(0))).toBe(0);
    expect(secondsBack(turnWith(1))).toBe(BURST_SECONDS);
    expect(secondsBack(turnWith(50))).toBe(MAX_TURN_SECONDS);
  });

  it('점수 도전은 조각이 가장 많은 판이다', () => {
    expect(ARCADE_KINDS).toBe(MAX_KINDS);
  });
});

describe('단계의 진행', () => {
  const plan: LevelPlan = {
    level: 1,
    kinds: 5,
    moves: 2,
    goals: [
      { kind: 0, count: 3 },
      { kind: 1, count: 4 },
    ],
    board: QUIET,
    seed: 'test',
  };
  const turnOf = (cleared: number[]): Turn => ({
    steps: [],
    board: QUIET,
    points: 0,
    cleared,
    bursts: 0,
    made: 0,
    shuffle: null,
  });

  it('처음에는 아무것도 모으지 않았고 횟수가 그대로다', () => {
    const run = startLevel(plan);
    expect(run.movesLeft).toBe(2);
    expect(isLevelCleared(run)).toBe(false);
    expect(isLevelFailed(run)).toBe(false);
  });

  it('둘 때마다 횟수가 줄고 사라진 조각이 모인다', () => {
    const run = afterTurn(startLevel(plan), turnOf([3, 1, 5, 0, 0, 0]));
    expect(run.movesLeft).toBe(1);
    expect(run.collected.slice(0, 3)).toEqual([3, 1, 5]);
    expect(isLevelCleared(run)).toBe(false);
    expect(isLevelFailed(run)).toBe(false);
  });

  it('목표를 모두 채우면 깬 것이다: 마지막 횟수에 채워도 깬 것이다', () => {
    let run = afterTurn(startLevel(plan), turnOf([3, 1, 0, 0, 0, 0]));
    run = afterTurn(run, turnOf([0, 3, 0, 0, 0, 0]));
    expect(run.movesLeft).toBe(0);
    expect(isLevelCleared(run)).toBe(true);
    expect(isLevelFailed(run)).toBe(false);
  });

  it('횟수를 다 쓰고도 못 채우면 실패다', () => {
    let run = afterTurn(startLevel(plan), turnOf([3, 1, 0, 0, 0, 0]));
    run = afterTurn(run, turnOf([0, 2, 0, 0, 0, 0]));
    expect(isLevelCleared(run)).toBe(false);
    expect(isLevelFailed(run)).toBe(true);
  });
});
