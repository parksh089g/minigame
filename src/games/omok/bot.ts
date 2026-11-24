/**
 * 오목 컴퓨터의 판단. 빈 점마다 "여기에 두면 얼마나 좋은지"를 셈해서 가장 좋은 점에 둔다.
 *
 * 셈하는 법: 점을 지나는 다섯 칸짜리 구간(네 방향마다 다섯 개)을 모두 본다.
 * - 상대 돌이 없는 구간에 내 돌이 많을수록 공격 점수가 커진다(다섯이 되면 이긴다).
 * - 내 돌이 없는 구간에 상대 돌이 많을수록 그 점을 막는 수비 점수가 커진다.
 * 양쪽이 열린 줄은 여러 구간에 걸쳐서 저절로 점수가 더 크다.
 *
 * 실력마다 다른 것:
 * - 쉬움: 막아야 할 곳을 가끔 놓치고, 좋은 점 몇 개 가운데 아무거나 고른다.
 * - 보통: 이기는 수와 막아야 하는 수는 놓치지 않고, 가장 좋은 점에 둔다.
 * - 어려움: 좋은 점 몇 개에 둬 본 뒤, 상대가 그다음에 둘 가장 좋은 수까지 따져서 고른다.
 */
import {
  CENTER,
  DIRECTIONS,
  EMPTY,
  onBoard,
  other,
  pointAt,
  POINTS,
  SIZE,
  WIN_LENGTH,
  xOf,
  yOf,
  type Level,
  type Stone,
} from './rules';

/** 상대 돌이 없는 구간에 (이 점을 두고 난 뒤) 내 돌이 n개일 때의 공격 점수 */
const ATTACK = [0, 2, 14, 150, 1_000, 1_000_000] as const;
/** 내 돌이 없는 구간에 상대 돌이 n개일 때, 그 구간의 빈 점을 막는 수비 점수 */
const DEFEND = [0, 1, 10, 300, 200_000] as const;

/** 실력마다 수비를 얼마나 무겁게 보는지 */
const DEFENSE_WEIGHT: Readonly<Record<Level, number>> = { easy: 0.6, normal: 0.9, hard: 1 };

/** 점을 지나는 다섯 칸 구간들. 판 밖으로 나가는 구간은 뺀다. 미리 만들어 둔다. */
const WINDOWS: readonly (readonly number[])[][] = buildWindows();

function buildWindows(): number[][][] {
  const all: number[][][] = [];
  for (let point = 0; point < POINTS; point += 1) {
    const x = xOf(point);
    const y = yOf(point);
    const windows: number[][] = [];
    for (const [dx, dy] of DIRECTIONS) {
      for (let start = -(WIN_LENGTH - 1); start <= 0; start += 1) {
        const cells: number[] = [];
        for (let k = 0; k < WIN_LENGTH; k += 1) {
          const cx = x + dx * (start + k);
          const cy = y + dy * (start + k);
          if (!onBoard(cx, cy)) break;
          cells.push(pointAt(cx, cy));
        }
        if (cells.length === WIN_LENGTH) windows.push(cells);
      }
    }
    all.push(windows);
  }
  return all;
}

/** 빈 점 point에 me가 둘 때의 공격 점수와 수비 점수 */
export function pointValue(board: readonly number[], point: number, me: Stone): { attack: number; defense: number } {
  const foe = other(me);
  let attack = 0;
  let defense = 0;
  for (const cells of WINDOWS[point]) {
    let mine = 0;
    let theirs = 0;
    for (const cell of cells) {
      const stone = board[cell];
      if (stone === me) mine += 1;
      else if (stone === foe) theirs += 1;
    }
    if (theirs === 0) attack += ATTACK[mine + 1];
    if (mine === 0) defense += DEFEND[theirs];
  }
  return { attack, defense };
}

/** 둘 만한 점: 이미 놓인 돌에서 두 칸 안쪽의 빈 점. 판이 비었으면 가운데 하나다. */
export function candidates(board: readonly number[]): number[] {
  const near = new Set<number>();
  let any = false;
  for (let point = 0; point < POINTS; point += 1) {
    if (board[point] === EMPTY) continue;
    any = true;
    const x = xOf(point);
    const y = yOf(point);
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const cx = x + dx;
        const cy = y + dy;
        if (onBoard(cx, cy) && board[pointAt(cx, cy)] === EMPTY) near.add(pointAt(cx, cy));
      }
    }
  }
  if (!any) return [CENTER];
  return [...near].sort((a, b) => a - b);
}

/** 그 점에 stone을 두면 다섯이 이어지는지 */
export function makesFive(board: readonly number[], point: number, stone: Stone): boolean {
  if (board[point] !== EMPTY) return false;
  const x = xOf(point);
  const y = yOf(point);
  for (const [dx, dy] of DIRECTIONS) {
    let count = 1;
    for (const sign of [1, -1]) {
      let cx = x + dx * sign;
      let cy = y + dy * sign;
      while (onBoard(cx, cy) && board[pointAt(cx, cy)] === stone) {
        count += 1;
        cx += dx * sign;
        cy += dy * sign;
      }
    }
    if (count >= WIN_LENGTH) return true;
  }
  return false;
}

interface Scored {
  point: number;
  score: number;
}

function scoreAll(board: readonly number[], points: readonly number[], me: Stone, defenseWeight: number): Scored[] {
  return points
    .map((point) => {
      const { attack, defense } = pointValue(board, point, me);
      return { point, score: attack + defense * defenseWeight };
    })
    .sort((a, b) => b.score - a.score || a.point - b.point);
}

/**
 * 컴퓨터(me)가 둘 점을 고른다. board는 바꾸지 않는다(어려움은 둬 보고 되돌린다).
 * random은 0 이상 1 미만의 수를 돌려주는 함수다.
 */
export function chooseMove(board: readonly number[], me: Stone, level: Level, random: () => number = Math.random): number {
  if (board.every((stone) => stone === EMPTY)) {
    // 첫 수: 쉬움은 가운데 둘레 아무 데나, 나머지는 가운데
    if (level === 'easy') {
      const x = 6 + Math.floor(random() * 3);
      const y = 6 + Math.floor(random() * 3);
      return pointAt(x, y);
    }
    return CENTER;
  }
  const points = candidates(board);
  const foe = other(me);

  // 1. 바로 이기는 수 (쉬움은 가끔 못 본다)
  const win = points.find((point) => makesFive(board, point, me));
  if (win !== undefined && (level !== 'easy' || random() < 0.85)) return win;
  // 2. 상대가 바로 이기는 자리를 막는다 (쉬움은 가끔 놓친다)
  const block = points.find((point) => makesFive(board, point, foe));
  if (block !== undefined && (level !== 'easy' || random() < 0.7)) return block;

  const scored = scoreAll(board, points, me, DEFENSE_WEIGHT[level]);
  if (level === 'easy') {
    // 좋은 점 다섯 개 가운데 아무거나. 그래도 절반은 가장 좋은 점에 둔다.
    if (random() < 0.5) return scored[0].point;
    const top = scored.slice(0, Math.min(5, scored.length));
    return top[Math.floor(random() * top.length)].point;
  }
  if (level === 'normal') {
    // 점수가 거의 같은 점들 가운데서는 아무거나 골라 판마다 조금씩 다르게 둔다.
    const best = scored[0].score;
    const close = scored.filter((item) => item.score >= best * 0.95);
    return close[Math.floor(random() * close.length)].point;
  }
  return lookAhead(board, scored.slice(0, 10), me);
}

/** 어려움: 좋은 점 몇 개에 둬 보고, 상대가 그다음에 둘 수 있는 가장 좋은 수를 빼서 견준다. */
function lookAhead(board: readonly number[], top: readonly Scored[], me: Stone): number {
  const foe = other(me);
  const work = board.slice();
  let bestPoint = top[0].point;
  let bestValue = -Infinity;
  for (const { point, score } of top) {
    work[point] = me;
    const replies = candidates(work);
    // 상대가 바로 이기는 자리가 남으면 이 수는 아주 나쁘다.
    let reply = 0;
    if (replies.some((q) => makesFive(work, q, foe))) reply = 5_000_000;
    else {
      for (const q of replies) {
        const { attack, defense } = pointValue(work, q, foe);
        reply = Math.max(reply, attack + defense * 0.5);
      }
    }
    work[point] = EMPTY;
    const value = score - reply * 0.7;
    if (value > bestValue) {
      bestValue = value;
      bestPoint = point;
    }
  }
  return bestPoint;
}

/** 판에서 손으로 보기 좋게 그리는 도우미(테스트용): 줄마다 . X O 로 적은 판을 읽는다. */
export function boardFrom(rows: readonly string[]): number[] {
  const board = new Array<number>(POINTS).fill(EMPTY);
  rows.forEach((row, y) => {
    [...row].forEach((char, x) => {
      if (y < SIZE && x < SIZE) board[pointAt(x, y)] = char === 'X' ? 1 : char === 'O' ? 2 : EMPTY;
    });
  });
  return board;
}
