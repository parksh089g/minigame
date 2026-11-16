import { describe, expect, it } from 'vitest';
import { seededRandom } from '../../core/stages';
import {
  afterTurn,
  areAdjacent,
  ARCADE_KINDS,
  BURST_MATCH,
  BURST_SECONDS,
  cellOf,
  CELLS,
  chainOf,
  clearingOf,
  clockRuns,
  colOf,
  COLS,
  findMoves,
  hasMatch,
  hasMove,
  isLevelCleared,
  isLevelFailed,
  isValidSwap,
  MAX_CHAIN_BONUS,
  MAX_KINDS,
  MATCH,
  MAX_TURN_SECONDS,
  MIN_KINDS,
  neighbourOf,
  newBoard,
  PIECE_POINTS,
  playSwap,
  RAINBOW_MATCH,
  RAINBOW_SECONDS,
  resolve,
  rowOf,
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
 * 소문자 a~f는 그 갈래의 무지개, '.'은 빈칸이다. 적지 않은 줄과 '?'는 서로 맞지 않는 무늬(갈래 3, 4, 5)로 채운다.
 */
function boardOf(rows: string[]): (Piece | null)[] {
  const filler = (col: number, row: number): Piece => ({ kind: 3 + ((col + row * 2) % 3), power: null });
  const board: (Piece | null)[] = [];
  const offset = ROWS - rows.length;
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const letter = row < offset ? '?' : rows[row - offset][col];
      if (letter === '?') board.push(filler(col, row));
      else if (letter === '.') board.push(null);
      else if (letter >= 'A' && letter <= 'F') board.push({ kind: letter.charCodeAt(0) - 65, power: 'burst' });
      else if (letter >= 'a' && letter <= 'f') board.push({ kind: letter.charCodeAt(0) - 97, power: 'rainbow' });
      else board.push({ kind: Number(letter), power: null });
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
          expect(piece.power).toBeNull();
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

  it('셋이 맞으면 그 셋만 사라지고 특수 조각은 생기지 않는다', () => {
    const clearing = clearingOf(boardOf(['000????']));
    expect(clearing).toEqual({ matched: [49, 50, 51], blasted: [], detonated: [], swept: [], made: [] });
  });

  it('넷이 맞으면 방금 옮긴 칸에 폭죽이 생긴다', () => {
    const board = boardOf(['0000???']);
    expect(clearingOf(board, [51])?.made).toEqual([{ cell: 51, kind: 0, power: 'burst' }]);
    expect(clearingOf(board, [99, 50])?.made).toEqual([{ cell: 50, kind: 0, power: 'burst' }]);
  });

  it('옮긴 칸이 없으면 묶음의 가운데 칸에 생긴다', () => {
    expect(clearingOf(boardOf(['0000???']))?.made).toEqual([{ cell: 51, kind: 0, power: 'burst' }]);
    expect(clearingOf(boardOf(['00000??']))?.made).toEqual([{ cell: 51, kind: 0, power: 'rainbow' }]);
  });

  it('넷은 폭죽이고 다섯부터는 무지개다', () => {
    expect(BURST_MATCH).toBe(MATCH + 1);
    expect(RAINBOW_MATCH).toBe(BURST_MATCH + 1);
    for (let length = MATCH; length <= COLS; length += 1) {
      const made = clearingOf(boardOf(['0'.repeat(length).padEnd(COLS, '?')]))?.made ?? [];
      const powers = made.map((special) => special.power);
      if (length < BURST_MATCH) expect(powers, `${length}개`).toEqual([]);
      else expect(powers, `${length}개`).toEqual([length >= RAINBOW_MATCH ? 'rainbow' : 'burst']);
    }
  });

  it('다섯을 맞추면 방금 옮긴 칸에 무지개가 생긴다', () => {
    const board = boardOf(['00000??']);
    expect(clearingOf(board, [49])?.made).toEqual([{ cell: 49, kind: 0, power: 'rainbow' }]);
    expect(clearingOf(board, [99, 53])?.made).toEqual([{ cell: 53, kind: 0, power: 'rainbow' }]);
  });

  it('가로줄과 세로줄이 만나 다섯이 되면 만나는 칸에 무지개가 생긴다', () => {
    // 한 줄로는 셋씩이지만 붙어 있는 같은 조각이 다섯이다.
    const corner = clearingOf(boardOf(['1??????', '1??????', '111????']));
    expect(corner?.matched).toEqual([35, 42, 49, 50, 51]);
    expect(corner?.made).toEqual([{ cell: 49, kind: 1, power: 'rainbow' }]);
    const cross = clearingOf(boardOf(['?1?????', '?1?????', '111????']));
    expect(cross?.matched).toEqual([36, 43, 49, 50, 51]);
    expect(cross?.made).toEqual([{ cell: 50, kind: 1, power: 'rainbow' }]);
  });

  it('떨어져 있는 두 줄은 따로 센다: 셋씩이면 특수 조각이 없다', () => {
    const clearing = clearingOf(boardOf(['000?111']));
    expect(clearing?.matched).toHaveLength(6);
    expect(clearing?.made).toEqual([]);
  });

  it('붙어 있어도 다른 조각의 줄과는 묶이지 않는다', () => {
    // 0 셋과 1 셋이 나란히 놓여 여섯이 한꺼번에 사라져도 묶음은 셋씩이다.
    const clearing = clearingOf(boardOf(['000111?']));
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

  it('맞은 줄에 무지개가 있으면 판에 있는 같은 조각이 모두 함께 사라진다', () => {
    const board = boardOf(['0?????0', '???0???', '0a0?0??']);
    expect(clearingOf(board)).toEqual({
      matched: [49, 50, 51],
      // 다른 갈래의 조각은 하나도 건드리지 않는다.
      blasted: [35, 41, 45, 53],
      detonated: [],
      swept: [{ cell: 50, kind: 0 }],
      made: [],
    });
  });

  it('맞지 않은 무지개는 같은 조각이 사라져도 가만히 있는다', () => {
    // 위의 무지개(갈래 1)는 맞은 줄에도, 터진 무지개(갈래 0)가 지우는 조각에도 들지 않는다.
    const clearing = clearingOf(boardOf(['b?????1', '???????', '0a0????']));
    expect(clearing?.swept).toEqual([{ cell: 50, kind: 0 }]);
    expect(clearing?.blasted).toEqual([]);
    // 맞은 줄에 없는 무지개는 같은 갈래의 줄이 사라져도 터지지 않는다.
    const idle = clearingOf(boardOf(['a??????', '???????', '?000???']));
    expect(idle?.swept).toEqual([]);
    expect(idle?.blasted).toEqual([]);
  });

  it('무지개가 지운 폭죽은 이어서 터진다', () => {
    const board = boardOf(['?????A?', '???????', '0a0????']);
    const clearing = clearingOf(board);
    expect(clearing?.swept).toEqual([{ cell: 50, kind: 0 }]);
    expect(clearing?.detonated).toEqual([cellOf(5, 5)]);
    // 폭죽이 있던 가로줄(일곱)과 세로줄(여덟)이 한 칸에서 만난다.
    expect(clearing?.blasted).toHaveLength(COLS + ROWS - 1);
    for (const cell of clearing?.blasted ?? []) expect(colOf(cell) === 5 || rowOf(cell) === 5).toBe(true);
  });

  it('폭죽에 휩쓸린 무지개도 이어서 터진다', () => {
    const board = boardOf(['??1???1', '???????', '0A0???b']);
    const clearing = clearingOf(board);
    expect(clearing?.detonated).toEqual([50]);
    expect(clearing?.swept).toEqual([{ cell: 55, kind: 1 }]);
    // 폭죽의 가로줄과 세로줄 밖에 있던 갈래 1의 조각 둘도 사라진다.
    expect(clearing?.blasted).toContain(cellOf(2, 5));
    expect(clearing?.blasted).toContain(cellOf(6, 5));
    expect((clearing?.matched.length ?? 0) + (clearing?.blasted.length ?? 0)).toBe(COLS + ROWS - 1 + 2);
  });

  it('같은 갈래의 무지개가 둘이면 둘 다 터지고, 조각은 한 번씩만 센다', () => {
    const clearing = clearingOf(boardOf(['a?????0', '???????', '0a0????']));
    expect(clearing?.swept).toEqual([
      { cell: cellOf(0, 5), kind: 0 },
      { cell: 50, kind: 0 },
    ]);
    expect(clearing?.blasted).toEqual([cellOf(0, 5), cellOf(6, 5)]);
  });

  it('사라지는 특수 조각은 모두 제 일을 하고, 남는 특수 조각은 아무 일도 하지 않는다', () => {
    let checked = 0;
    for (let seed = 0; seed < 200; seed += 1) {
      const random = seededRandom(`specials${seed}`);
      const board = Array.from({ length: CELLS }, (): Piece => {
        const roll = random();
        return { kind: Math.floor(random() * 4), power: roll < 0.1 ? 'burst' : roll < 0.2 ? 'rainbow' : null };
      });
      const clearing = clearingOf(board);
      if (!clearing) continue;
      checked += 1;
      const gone = new Set([...clearing.matched, ...clearing.blasted]);
      expect(gone.size).toBe(clearing.matched.length + clearing.blasted.length);
      const bursts = new Set(clearing.detonated);
      const rainbows = new Set(clearing.swept.map((rainbow) => rainbow.cell));
      expect(rainbows.size).toBe(clearing.swept.length);
      board.forEach((piece, cell) => {
        expect(bursts.has(cell), `${seed}번 판 ${cell}번 칸`).toBe(gone.has(cell) && piece.power === 'burst');
        expect(rainbows.has(cell), `${seed}번 판 ${cell}번 칸`).toBe(gone.has(cell) && piece.power === 'rainbow');
      });
      for (const cell of bursts) {
        for (let col = 0; col < COLS; col += 1) expect(gone.has(cellOf(col, rowOf(cell)))).toBe(true);
        for (let row = 0; row < ROWS; row += 1) expect(gone.has(cellOf(colOf(cell), row))).toBe(true);
      }
      for (const rainbow of clearing.swept) {
        expect(board[rainbow.cell].kind).toBe(rainbow.kind);
        board.forEach((piece, cell) => {
          if (piece.kind === rainbow.kind) expect(gone.has(cell)).toBe(true);
        });
      }
      // 사라지는 칸은 맞은 칸이거나, 터진 폭죽의 줄이거나, 터진 무지개의 갈래다. 까닭 없이 사라지는 칸은 없다.
      for (const cell of clearing.blasted) {
        const byBurst = [...bursts].some((burst) => colOf(burst) === colOf(cell) || rowOf(burst) === rowOf(cell));
        const byRainbow = clearing.swept.some((rainbow) => rainbow.kind === board[cell].kind);
        expect(byBurst || byRainbow, `${seed}번 판 ${cell}번 칸`).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(150);
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
      expect(spawn.piece).toEqual({ kind: 2, power: null });
      expect(spawn.above).toBe(1);
    }
  });

  it('한 세로줄에 빈칸이 여럿이면 그만큼 내려오고 그만큼 들어온다', () => {
    const board = boardOf(['.??????', '2??????', '.??????', '.??????']);
    const settled = settle(board, MAX_KINDS, always(4));
    expect(settled.board[cellOf(0, 7)]).toEqual({ kind: 2, power: null });
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
    expect(turn.steps[0].made).toEqual([{ cell: cellOf(2, 7), kind: 0, power: 'burst' }]);
    expect(turn.made).toBeGreaterThanOrEqual(1);
    // 폭죽은 사라진 것으로 세지 않는다: 넷이 맞았지만 넷 모두 사라진 조각으로 센다(그 자리에 새 폭죽이 놓인다).
    expect(turn.steps[0].matched).toHaveLength(4);
    expect(turn.steps[0].board[cellOf(2, 7)]).toEqual({ kind: 0, power: 'burst' });
  });

  it('폭죽을 터뜨리면 줄째 사라지고 터진 수를 센다', () => {
    const board = boardOf(['0A0????']);
    const turn = resolve(board, MAX_KINDS, seededRandom('burst'));
    expect(turn.bursts).toBeGreaterThanOrEqual(1);
    expect(turn.steps[0].detonated).toEqual([50]);
    expect(turn.steps[0].points).toBe((COLS + ROWS - 1) * PIECE_POINTS);
  });

  it('다섯을 맞추면 옮긴 자리에 폭죽 대신 무지개가 남는다', () => {
    const board = boardOf(['??0????', '00?00??']) as Piece[];
    let index = 0;
    const turn = playSwap(board, cellOf(2, 6), cellOf(2, 7), MAX_KINDS, () => ((index++ % 3) + 0.5) / MAX_KINDS) as Turn;
    expect(turn.steps[0].made).toEqual([{ cell: cellOf(2, 7), kind: 0, power: 'rainbow' }]);
    expect(turn.steps[0].matched).toHaveLength(5);
    expect(turn.steps[0].board[cellOf(2, 7)]).toEqual({ kind: 0, power: 'rainbow' });
    expect(turn.made).toBeGreaterThanOrEqual(1);
    // 만들기만 해서는 터진 것으로 세지 않는다.
    expect(turn.steps[0].swept).toEqual([]);
    expect(turn.steps[0].detonated).toEqual([]);
  });

  it('무지개를 터뜨리면 같은 조각이 모두 사라지고 터진 수를 센다', () => {
    const board = boardOf(['0?????0', '???0???', '0a0?0??']);
    const turn = resolve(board, MAX_KINDS, seededRandom('rainbow'));
    expect(turn.rainbows).toBeGreaterThanOrEqual(1);
    expect(turn.steps[0].swept).toEqual([{ cell: 50, kind: 0 }]);
    // 맞은 셋과 휩쓸린 넷: 휩쓸린 조각도 맞은 조각과 같은 점수다.
    expect(turn.steps[0].points).toBe(7 * PIECE_POINTS);
    expect(turn.cleared[0]).toBeGreaterThanOrEqual(7);
    expect(turn.bursts + turn.rainbows).toBe(
      turn.steps.reduce((sum, step) => sum + step.detonated.length + step.swept.length, 0),
    );
  });

  it('무지개가 터지는 걸음에서 새로 생긴 특수 조각은 휩쓸리지 않고 남는다', () => {
    // 무지개를 낀 다섯이 맞는다: 옛 무지개가 갈래 0을 모두 지우고, 그 자리에 새 무지개가 놓인다.
    const board = boardOf(['0??????', '???????', '0a000??']);
    const turn = resolve(board, MAX_KINDS, seededRandom('again'));
    expect(turn.steps[0].swept).toEqual([{ cell: 50, kind: 0 }]);
    expect(turn.steps[0].made).toEqual([{ cell: 51, kind: 0, power: 'rainbow' }]);
    expect(turn.steps[0].blasted).toEqual([cellOf(0, 5)]);
    // 맨 아래 줄의 조각은 떨어지지 않으므로 새 무지개는 제자리에 있다.
    expect(turn.steps[0].board[51]).toEqual({ kind: 0, power: 'rainbow' });
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
    const marked = board.map((piece, cell): Piece =>
      cell === 10 ? { ...piece, power: 'burst' } : cell === 30 ? { ...piece, power: 'rainbow' } : piece,
    );
    const shuffle = shuffleBoard(marked, seededRandom('s'));
    expect(shuffle).not.toBeNull();
    if (!shuffle) return;
    expect([...shuffle.from].sort((a, b) => a - b)).toEqual(Array.from({ length: CELLS }, (_, cell) => cell));
    shuffle.board.forEach((piece, cell) => expect(piece).toBe(marked[shuffle.from[cell]]));
    expect(hasMatch(shuffle.board)).toBe(false);
    expect(hasMove(shuffle.board)).toBe(true);
    expect(shuffle.board.filter((piece) => piece.power === 'burst')).toHaveLength(1);
    expect(shuffle.board.filter((piece) => piece.power === 'rainbow')).toHaveLength(1);
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
    const same = Array.from({ length: CELLS }, (): Piece => ({ kind: 0, power: null }));
    expect(shuffleBoard(same, seededRandom('same'))).toBeNull();
  });
});

describe('점수 도전의 시간', () => {
  const turnWith = (bursts: number, rainbows = 0): Turn => ({
    steps: [],
    board: QUIET,
    points: 0,
    cleared: [],
    bursts,
    rainbows,
    made: 0,
    shuffle: null,
  });

  it('폭죽을 터뜨린 만큼 시간을 돌려받고, 한 차례에 받는 시간에는 끝이 있다', () => {
    expect(secondsBack(turnWith(0))).toBe(0);
    expect(secondsBack(turnWith(1))).toBe(BURST_SECONDS);
    expect(secondsBack(turnWith(50))).toBe(MAX_TURN_SECONDS);
  });

  it('무지개를 터뜨려도 시간을 돌려받고, 폭죽과 합쳐서 같은 끝을 넘지 않는다', () => {
    expect(secondsBack(turnWith(0, 1))).toBe(RAINBOW_SECONDS);
    expect(secondsBack(turnWith(1, 1))).toBe(BURST_SECONDS + RAINBOW_SECONDS);
    expect(secondsBack(turnWith(0, 50))).toBe(MAX_TURN_SECONDS);
    expect(secondsBack(turnWith(2, 2))).toBe(MAX_TURN_SECONDS);
  });

  it('점수 도전은 조각이 가장 많은 판이다', () => {
    expect(ARCADE_KINDS).toBe(MAX_KINDS);
  });

  it('시계는 맞은 조각이 사라지고 떨어지는 동안에만 선다', () => {
    expect(clockRuns('idle')).toBe(true);
    expect(clockRuns('busy')).toBe(false);
    expect(clockRuns('over')).toBe(false);
  });

  it('맞지 않는 바꾸기가 되돌아오는 동안에도 시계는 흐른다', () => {
    // 여기서 시계가 서면 맞지 않는 자리를 이어서 건드리는 것으로 시간을 쓰지 않고 다음 자리를 찾을 수 있다.
    expect(clockRuns('bounce')).toBe(true);
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
    rainbows: 0,
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
