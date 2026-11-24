/**
 * 오목의 규칙. 15 × 15 판의 줄이 만나는 점에 검은 돌과 흰 돌을 번갈아 놓고, 같은 색 다섯 개를 한 줄로 먼저 이으면 이긴다.
 * 이 앱의 규칙은 가장 널리 하는 "자유 오목"이다: 여섯 개 넘게 이어도(장목) 이긴 것으로 치고, 금지된 자리(쌍삼 같은)는 없다.
 * 검은 돌이 먼저 둔다. 판이 가득 차도 아무도 잇지 못했으면 비긴다.
 *
 * 판은 둔 자리의 목록(moves)만으로 정해진다. 점의 번호는 y * SIZE + x 이다.
 * Phaser에도 브라우저에도 기대지 않아서 서버(친구와 하기)와 테스트가 그대로 쓴다.
 */

export const SIZE = 15;
export const POINTS = SIZE * SIZE;
/** 이만큼 이으면 이긴다. */
export const WIN_LENGTH = 5;

export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;
export type Stone = typeof BLACK | typeof WHITE;

export const other = (stone: Stone): Stone => (stone === BLACK ? WHITE : BLACK);

/** 네 방향: 가로, 세로, 오른쪽 아래 대각선, 왼쪽 아래 대각선 */
export const DIRECTIONS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [1, 1],
  [-1, 1],
];

export const pointAt = (x: number, y: number): number => y * SIZE + x;
export const xOf = (point: number): number => point % SIZE;
export const yOf = (point: number): number => Math.floor(point / SIZE);
export const onBoard = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < SIZE && y < SIZE;
export const isPoint = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < POINTS;

/** 가운데 점(천원) */
export const CENTER = pointAt(7, 7);

export interface OmokState {
  /** 점마다 EMPTY, BLACK, WHITE */
  board: number[];
  /** 둔 차례대로의 자리. 짝수 번째(0, 2, …)가 검은 돌이다. */
  moves: number[];
  /** 이긴 돌. 아직이거나 비겼으면 null */
  winner: Stone | null;
  /** 이긴 줄의 점들. 아직이면 빈 목록 */
  line: number[];
  /** 판이 가득 차서 비겼으면 true */
  draw: boolean;
}

export function createGame(): OmokState {
  return { board: new Array<number>(POINTS).fill(EMPTY), moves: [], winner: null, line: [], draw: false };
}

/** 이번에 둘 돌의 색 */
export const toMove = (state: Pick<OmokState, 'moves'>): Stone => (state.moves.length % 2 === 0 ? BLACK : WHITE);

export const isOver = (state: OmokState): boolean => state.winner !== null || state.draw;

/** 그 점을 지나는 같은 색의 줄 가운데 가장 긴 것의 점들(그 점 포함). */
export function longestLine(board: readonly number[], point: number): number[] {
  const stone = board[point];
  if (stone === EMPTY) return [];
  let best: number[] = [point];
  const x = xOf(point);
  const y = yOf(point);
  for (const [dx, dy] of DIRECTIONS) {
    const line = [point];
    for (const sign of [1, -1]) {
      let cx = x + dx * sign;
      let cy = y + dy * sign;
      while (onBoard(cx, cy) && board[pointAt(cx, cy)] === stone) {
        line.push(pointAt(cx, cy));
        cx += dx * sign;
        cy += dy * sign;
      }
    }
    if (line.length > best.length) best = line;
  }
  return best.sort((a, b) => a - b);
}

/** 돌을 하나 놓는다. 판이 끝났거나 빈 점이 아니면 바꾸지 않고 false */
export function placeStone(state: OmokState, point: number): boolean {
  if (isOver(state) || !isPoint(point) || state.board[point] !== EMPTY) return false;
  const stone = toMove(state);
  state.board[point] = stone;
  state.moves.push(point);
  const line = longestLine(state.board, point);
  if (line.length >= WIN_LENGTH) {
    state.winner = stone;
    state.line = line;
  } else if (state.moves.length === POINTS) {
    state.draw = true;
  }
  return true;
}

/** 둔 자리 목록으로 판을 다시 만든다. 둘 수 없는 수가 끼어 있으면 null */
export function replay(moves: readonly number[]): OmokState | null {
  const state = createGame();
  for (const point of moves) if (!placeStone(state, point)) return null;
  return state;
}

/** 마지막 수 count개를 되돌린다(컴퓨터와 할 때의 무르기). */
export function undoMoves(state: OmokState, count: number): void {
  for (let i = 0; i < count && state.moves.length > 0; i += 1) {
    const point = state.moves.pop()!;
    state.board[point] = EMPTY;
  }
  state.winner = null;
  state.line = [];
  state.draw = false;
}

// ───────── 컴퓨터와 할 때 ─────────

export const LEVELS = ['easy', 'normal', 'hard'] as const;
export type Level = (typeof LEVELS)[number];

/** 한 판에 무를 수 있는 횟수 */
export const UNDO_LIMIT = 3;

/** 이긴 판의 기본 점수. 실력이 높을수록 크다. */
const WIN_BASE: Readonly<Record<Level, number>> = { easy: 100, normal: 200, hard: 300 };

/**
 * 컴퓨터와 한 판의 점수. 지면 0점, 비기면 기본 점수의 절반이다.
 * 이기면 기본 점수에 빨리 이긴 만큼(내 돌이 적을수록) 더하고, 무르기 한 번마다 20점을 뺀다.
 */
export function matchScore(result: 'win' | 'lose' | 'draw', level: Level, myStones: number, undos: number): number {
  if (result === 'lose') return 0;
  if (result === 'draw') return WIN_BASE[level] / 2;
  const quick = Math.max(0, 30 - myStones) * 5;
  return Math.max(10, WIN_BASE[level] + quick - undos * 20);
}
