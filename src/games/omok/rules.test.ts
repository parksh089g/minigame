import { describe, expect, it } from 'vitest';
import { boardFrom, chooseMove, makesFive } from './bot';
import { normalizePrefs, playsBlack } from './prefs';
import {
  BLACK,
  CENTER,
  createGame,
  isOver,
  LEVELS,
  matchScore,
  placeStone,
  pointAt,
  POINTS,
  replay,
  toMove,
  undoMoves,
  WHITE,
  type Level,
  type Stone,
} from './rules';
import { COLOR_NAME, FRIEND_TEXT, LEVEL_NAME, LEVEL_NOTE, RULE_LINES, TEXT } from './text';

/** 흑과 백을 번갈아 두는 판: 흑은 black에, 백은 white에 차례로 둔다. */
function play(black: number[], white: number[]) {
  const state = createGame();
  for (let i = 0; i < Math.max(black.length, white.length); i += 1) {
    if (i < black.length) expect(placeStone(state, black[i])).toBe(true);
    if (i < white.length) expect(placeStone(state, white[i])).toBe(true);
  }
  return state;
}

function seeded(seed = 11): () => number {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

describe('오목 규칙', () => {
  it('흑이 먼저 두고 번갈아 둔다', () => {
    const state = createGame();
    expect(toMove(state)).toBe(BLACK);
    placeStone(state, CENTER);
    expect(toMove(state)).toBe(WHITE);
    expect(state.board[CENTER]).toBe(BLACK);
  });

  it('이미 돌이 있는 점이나 판 밖에는 둘 수 없다', () => {
    const state = createGame();
    placeStone(state, CENTER);
    expect(placeStone(state, CENTER)).toBe(false);
    expect(placeStone(state, -1)).toBe(false);
    expect(placeStone(state, POINTS)).toBe(false);
    expect(placeStone(state, 1.5)).toBe(false);
    expect(state.moves).toEqual([CENTER]);
  });

  it('가로, 세로, 두 대각선으로 다섯을 이으면 이긴다', () => {
    const lines: Array<(i: number) => number> = [
      (i) => pointAt(2 + i, 5),
      (i) => pointAt(5, 2 + i),
      (i) => pointAt(2 + i, 2 + i),
      (i) => pointAt(10 - i, 2 + i),
    ];
    for (const at of lines) {
      const black = [0, 1, 2, 3, 4].map(at);
      const white = [0, 1, 2, 3].map((i) => pointAt(i, 14));
      const state = play(black, white);
      expect(state.winner).toBe(BLACK);
      expect(state.line.sort((a, b) => a - b)).toEqual(black.slice().sort((a, b) => a - b));
      expect(placeStone(state, pointAt(14, 0))).toBe(false);
    }
  });

  it('넷으로는 이기지 않고, 여섯 넘게 이어도 이긴다(자유 오목)', () => {
    const four = play([0, 1, 2, 3].map((i) => pointAt(i, 0)), [0, 1, 2, 3].map((i) => pointAt(i, 5)));
    expect(four.winner).toBeNull();
    // 흑: 0,1,2 _ 4,5 를 두고 3을 채우면 여섯이 이어진다.
    const black = [0, 1, 2, 4, 5, 3].map((i) => pointAt(i, 0));
    const white = [0, 1, 2, 4, 6].map((i) => pointAt(i, 9));
    const six = play(black, white);
    expect(six.winner).toBe(BLACK);
    expect(six.line).toHaveLength(6);
  });

  it('판이 가득 찰 때까지 아무도 잇지 못하면 비긴다', () => {
    // 두 칸씩 흑백을 바꾸고 줄마다 한 칸씩 어긋나게 칠하면 어느 쪽으로도 다섯이 이어지지 않는다(흑 113, 백 112).
    const black: number[] = [];
    const white: number[] = [];
    for (let y = 0; y < 15; y += 1) {
      for (let x = 0; x < 15; x += 1) ((Math.floor(x / 2) + y) % 2 === 0 ? black : white).push(pointAt(x, y));
    }
    expect([black.length, white.length]).toEqual([113, 112]);
    const state = play(black, white);
    expect(state.winner).toBeNull();
    expect(state.moves).toHaveLength(POINTS);
    expect(state.draw).toBe(true);
    expect(isOver(state)).toBe(true);
    expect(placeStone(state, 0)).toBe(false);
  });

  it('둔 자리 목록으로 판을 다시 만들고, 둘 수 없는 목록은 거른다', () => {
    const state = play([CENTER, pointAt(8, 8)], [pointAt(0, 0)]);
    expect(replay(state.moves)?.board).toEqual(state.board);
    expect(replay([CENTER, CENTER])).toBeNull();
  });

  it('무르기는 마지막 수를 되돌리고 끝난 판도 다시 열어 준다', () => {
    const state = play([0, 1, 2, 3, 4].map((i) => pointAt(i, 0)), [0, 1, 2, 3].map((i) => pointAt(i, 3)));
    expect(state.winner).toBe(BLACK);
    undoMoves(state, 2);
    expect(state.winner).toBeNull();
    expect(state.line).toEqual([]);
    expect(state.moves).toHaveLength(7);
    expect(state.board[pointAt(4, 0)]).toBe(0);
    expect(state.board[pointAt(3, 3)]).toBe(0);
    expect(toMove(state)).toBe(WHITE);
  });

  it('점수: 이기면 실력이 높을수록, 빨리 이길수록 크고, 무르기를 쓰면 줄어든다', () => {
    expect(matchScore('lose', 'hard', 10, 0)).toBe(0);
    expect(matchScore('win', 'hard', 10, 0)).toBeGreaterThan(matchScore('win', 'normal', 10, 0));
    expect(matchScore('win', 'normal', 10, 0)).toBeGreaterThan(matchScore('win', 'easy', 10, 0));
    expect(matchScore('win', 'normal', 6, 0)).toBeGreaterThan(matchScore('win', 'normal', 20, 0));
    expect(matchScore('win', 'normal', 10, 2)).toBeLessThan(matchScore('win', 'normal', 10, 0));
    expect(matchScore('draw', 'normal', 50, 0)).toBe(100);
  });
});

describe('오목 컴퓨터', () => {
  it('빈 판에서는 가운데에 둔다(쉬움은 가운데 둘레)', () => {
    const empty = createGame().board;
    expect(chooseMove(empty, BLACK, 'normal')).toBe(CENTER);
    expect(chooseMove(empty, BLACK, 'hard')).toBe(CENTER);
    for (let i = 0; i < 10; i += 1) {
      const point = chooseMove(empty, BLACK, 'easy', seeded(i + 1));
      expect(Math.abs((point % 15) - 7)).toBeLessThanOrEqual(1);
      expect(Math.abs(Math.floor(point / 15) - 7)).toBeLessThanOrEqual(1);
    }
  });

  it('다섯을 만들 수 있으면 둔다', () => {
    const board = boardFrom(['', '', '', '', '', '...XXXX', '...OOO', '', '', '', '', '', '', '', '']);
    for (const level of ['normal', 'hard'] as const) {
      const point = chooseMove(board, BLACK, level);
      expect(makesFive(board, point, BLACK), level).toBe(true);
    }
  });

  it('상대의 넷은 막는다', () => {
    const board = boardFrom(['', '', '', '', '', '..OXXXX', '..O', '..O', '', '', '', '', '', '', '']);
    for (const level of ['normal', 'hard'] as const) expect(chooseMove(board, WHITE, level), level).toBe(pointAt(7, 5));
  });

  it('양쪽이 열린 상대의 셋은 끝을 막는다', () => {
    const board = boardFrom(['', '', '', '', '', '', '.....XXX', '......O', '', '', '', '', '', '', '']);
    for (const level of ['normal', 'hard'] as const) {
      const point = chooseMove(board, WHITE, level);
      expect([pointAt(4, 6), pointAt(8, 6), pointAt(3, 6), pointAt(9, 6)], level).toContain(point);
    }
  });

  it('내 넷이 열려 있으면 막기보다 이긴다', () => {
    const board = boardFrom(['', '', '', '', '.OOOO', '', '', '..XXXX', '', '', '', '', '', '', '']);
    expect(makesFive(board, chooseMove(board, WHITE, 'hard'), WHITE)).toBe(true);
  });

  it('컴퓨터끼리 두면 언제나 둘 수 있는 점을 고르고 판이 끝난다', () => {
    const levels: Level[] = [...LEVELS];
    for (const [a, b] of [
      ['easy', 'hard'],
      ['normal', 'normal'],
      ['hard', 'easy'],
    ] as const) {
      const random = seeded(a.length * 7 + b.length);
      const state = createGame();
      while (!isOver(state)) {
        const stone: Stone = toMove(state);
        const point = chooseMove(state.board, stone, stone === BLACK ? a : b, random);
        expect(placeStone(state, point)).toBe(true);
      }
      expect(levels).toContain(a);
    }
  });

  it('어려움은 쉬움을 대체로 이긴다', () => {
    let hardWins = 0;
    for (let game = 0; game < 10; game += 1) {
      const random = seeded(100 + game);
      const state = createGame();
      const hardIs: Stone = game % 2 === 0 ? BLACK : WHITE;
      while (!isOver(state)) {
        const stone = toMove(state);
        placeStone(state, chooseMove(state.board, stone, stone === hardIs ? 'hard' : 'easy', random));
      }
      if (state.winner === hardIs) hardWins += 1;
    }
    expect(hardWins).toBeGreaterThanOrEqual(8);
  });
});

describe('오목 설정과 글', () => {
  it('설정을 믿을 수 있는 모양으로 읽고, 번갈아는 지난 판과 반대 돌을 쥔다', () => {
    expect(normalizePrefs(null)).toMatchObject({ level: 'normal', color: 'black' });
    expect(normalizePrefs({ level: 'x', color: 'y', plays: 3, wins: 9 })).toMatchObject({ level: 'normal', color: 'black', plays: 3, wins: 3 });
    expect(playsBlack(normalizePrefs({ color: 'alternate', lastBlack: true }))).toBe(false);
    expect(playsBlack(normalizePrefs({ color: 'alternate', lastBlack: false }))).toBe(true);
    expect(playsBlack(normalizePrefs({ color: 'white' }))).toBe(false);
  });

  it('글은 글꼴에 있는 한글만 쓴다', () => {
    const decoder = new TextDecoder('euc-kr');
    const font = new Set<string>();
    for (let lead = 0xb0; lead <= 0xc8; lead += 1) {
      for (let trail = 0xa1; trail <= 0xfe; trail += 1) font.add(decoder.decode(new Uint8Array([lead, trail])));
    }
    const strings = (value: unknown): string[] => {
      if (typeof value === 'string') return [value];
      if (typeof value === 'function') {
        const out = (value as (...args: unknown[]) => unknown)('민수', '지원');
        return typeof out === 'string' ? [out] : [];
      }
      if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
      return [];
    };
    const lines = [TEXT, FRIEND_TEXT, LEVEL_NAME, LEVEL_NOTE, COLOR_NAME, RULE_LINES].flatMap(strings);
    for (const line of lines) {
      for (const char of line) if (/[가-힣]/.test(char)) expect(font.has(char), `${line}: ${char}`).toBe(true);
    }
  });
});
