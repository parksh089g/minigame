/**
 * 상자 밀기의 규칙. 화면과 분리된 순수 함수라서 숫자만 바꿔 밸런스를 조정할 수 있다.
 * 판은 cols × rows 격자이고, 칸은 번호 하나로 적는다: row * cols + col, 왼쪽 위가 0번이다.
 * 칸은 벽이거나 바닥이고, 바닥 몇 칸에는 상자를 놓을 자리(별 자리)가 있다. 맨 바깥 둘레는 언제나 벽이다.
 * 캐릭터는 위아래와 옆으로 한 칸씩 걷고, 걸어가는 쪽에 상자가 있으면 그 상자를 한 칸 민다.
 * 상자는 한 번에 하나만 밀 수 있고 당길 수는 없다. 상자가 모두 별 자리에 놓이면 판을 깬다.
 * 무작위가 필요한 곳은 random(0 이상 1 미만의 수를 돌려주는 함수)을 받아서 쓴다.
 */
import type { SwipeDirection } from '../../core/swipe';

// ───────── 칸과 방향 ─────────

export type Direction = SwipeDirection;

/** 방향의 차례. 판을 만들 때와 풀 때는 이 차례의 번호(0~3)로 방향을 적는다. 맞은편은 번호에 2를 더한 것이다. */
export const DIRECTIONS: readonly Direction[] = ['up', 'right', 'down', 'left'];

const DCOL = [0, 1, 0, -1] as const;
const DROW = [-1, 0, 1, 0] as const;

/** 칸 번호를 (col, row)로 바꾼다. */
export function cellOf(cols: number, cell: number): { col: number; row: number } {
  return { col: cell % cols, row: Math.floor(cell / cols) };
}

// ───────── 문제 ─────────

export interface Puzzle {
  cols: number;
  rows: number;
  /** 칸마다 벽인지 */
  walls: readonly boolean[];
  /** 상자를 놓을 자리(별 자리)의 칸. 작은 번호부터 적는다. */
  targets: readonly number[];
  /** 처음에 상자가 놓인 칸. 작은 번호부터 적고, 수는 별 자리와 같다. */
  boxes: readonly number[];
  /** 처음에 캐릭터가 서 있는 칸 */
  player: number;
  /** 가장 적게 밀어서 깨는 횟수 */
  par: number;
}

/** 판에서 direction 쪽으로 한 칸 옆의 칸. 판 밖이면 -1이다. */
export function neighbour(puzzle: Pick<Puzzle, 'cols' | 'rows'>, cell: number, direction: Direction): number {
  const way = DIRECTIONS.indexOf(direction);
  const col = (cell % puzzle.cols) + DCOL[way];
  const row = Math.floor(cell / puzzle.cols) + DROW[way];
  if (col < 0 || row < 0 || col >= puzzle.cols || row >= puzzle.rows) return -1;
  return row * puzzle.cols + col;
}

// ───────── 판을 글자로 적기 ─────────

/**
 * 판을 짧게 적은 것에 쓰는 글자. 맨 바깥의 벽 둘레는 적지 않고 안쪽만 적으며, 줄은 '/'로 나눈다.
 * 예: "#..o/.b../p..." 은 안쪽이 4 × 3칸인 판이다.
 */
const LETTER = {
  wall: '#',
  floor: '.',
  target: 'o',
  box: 'b',
  boxOnTarget: 'B',
  player: 'p',
  playerOnTarget: 'P',
} as const;

/** 한 판의 가장 큰 안쪽 크기. 이보다 크면 휴대폰 화면에서 칸이 너무 작아진다. */
export const MAX_INNER_COLS = 6;
export const MAX_INNER_ROWS = 7;

/**
 * 짧게 적은 판을 읽는다. par는 그 판을 가장 적게 밀어서 깨는 횟수로, 적은 쪽이 미리 풀어 보고 알려 준다.
 * 읽을 수 없거나 판이 될 수 없으면 null: 줄의 길이가 모두 같고, 캐릭터는 하나, 상자는 하나 이상이고 별 자리와 수가 같아야 한다.
 */
export function parsePuzzle(code: string, par: number): Puzzle | null {
  const lines = code.split('/');
  const innerCols = lines[0].length;
  if (innerCols < 1 || innerCols > MAX_INNER_COLS || lines.length > MAX_INNER_ROWS) return null;
  if (lines.some((line) => line.length !== innerCols || !/^[#.obBpP]+$/.test(line))) return null;

  const cols = innerCols + 2;
  const rows = lines.length + 2;
  const walls = Array<boolean>(cols * rows).fill(true);
  const targets: number[] = [];
  const boxes: number[] = [];
  const players: number[] = [];
  lines.forEach((line, innerRow) => {
    [...line].forEach((letter, innerCol) => {
      const cell = (innerRow + 1) * cols + innerCol + 1;
      if (letter === LETTER.wall) return;
      walls[cell] = false;
      if (letter === LETTER.target || letter === LETTER.boxOnTarget || letter === LETTER.playerOnTarget) {
        targets.push(cell);
      }
      if (letter === LETTER.box || letter === LETTER.boxOnTarget) boxes.push(cell);
      if (letter === LETTER.player || letter === LETTER.playerOnTarget) players.push(cell);
    });
  });
  if (players.length !== 1 || boxes.length === 0 || boxes.length !== targets.length) return null;
  if (!Number.isInteger(par) || par < 0) return null;
  return { cols, rows, walls, targets, boxes, player: players[0], par };
}

/** 판을 짧게 적는다. parsePuzzle이 읽는 것과 같은 글자다. */
export function formatPuzzle(puzzle: Puzzle): string {
  const lines: string[] = [];
  for (let row = 1; row < puzzle.rows - 1; row += 1) {
    let line = '';
    for (let col = 1; col < puzzle.cols - 1; col += 1) {
      const cell = row * puzzle.cols + col;
      const target = puzzle.targets.includes(cell);
      if (puzzle.walls[cell]) line += LETTER.wall;
      else if (puzzle.boxes.includes(cell)) line += target ? LETTER.boxOnTarget : LETTER.box;
      else if (puzzle.player === cell) line += target ? LETTER.playerOnTarget : LETTER.player;
      else line += target ? LETTER.target : LETTER.floor;
    }
    lines.push(line);
  }
  return lines.join('/');
}

// ───────── 밀고 걷기 ─────────

export interface Board {
  puzzle: Puzzle;
  /** 상자마다 지금 놓인 칸. 차례는 puzzle.boxes와 같아서, 같은 번호는 언제나 같은 상자다. */
  boxes: readonly number[];
  player: number;
  /** 지금까지 민 횟수. 되돌리면 그만큼 줄어든다. */
  pushes: number;
}

export function newBoard(puzzle: Puzzle): Board {
  return { puzzle, boxes: puzzle.boxes, player: puzzle.player, pushes: 0 };
}

/** 그 칸에 놓인 상자의 번호. 없으면 -1이다. */
export function boxAt(board: Board, cell: number): number {
  return board.boxes.indexOf(cell);
}

export function isTarget(puzzle: Puzzle, cell: number): boolean {
  return puzzle.targets.includes(cell);
}

/** 별 자리에 놓인 상자의 수 */
export function placedCount(board: Board): number {
  return board.boxes.filter((cell) => isTarget(board.puzzle, cell)).length;
}

/** 판을 깼는지: 상자가 모두 별 자리에 놓였다. */
export function isSolved(board: Board): boolean {
  return placedCount(board) === board.boxes.length;
}

export interface Step {
  board: Board;
  /** 캐릭터가 한 칸 움직였는지 */
  moved: boolean;
  /** 이번에 민 상자의 번호. 밀지 않았으면 -1이다. */
  pushed: number;
}

/**
 * direction 쪽으로 한 칸 걷는다. 그쪽에 상자가 있으면 민다.
 * 벽에 막혔거나, 상자 너머가 벽이나 다른 상자라서 밀 수 없으면 아무것도 바뀌지 않는다(받은 판을 그대로 돌려준다).
 */
export function step(board: Board, direction: Direction): Step {
  const { puzzle } = board;
  const stay: Step = { board, moved: false, pushed: -1 };
  const to = neighbour(puzzle, board.player, direction);
  if (to < 0 || puzzle.walls[to]) return stay;
  const box = boxAt(board, to);
  if (box < 0) return { board: { ...board, player: to }, moved: true, pushed: -1 };

  const beyond = neighbour(puzzle, to, direction);
  if (beyond < 0 || puzzle.walls[beyond] || boxAt(board, beyond) >= 0) return stay;
  const boxes = board.boxes.map((cell, index) => (index === box ? beyond : cell));
  return { board: { ...board, boxes, player: to, pushes: board.pushes + 1 }, moved: true, pushed: box };
}

/**
 * 캐릭터가 상자를 밀지 않고 cell 칸까지 걸어가는 가장 짧은 길. 차례로 걸을 방향들이다.
 * 이미 그 칸에 있으면 빈 배열이고, 벽이나 상자에 막혀 갈 수 없으면 null이다.
 */
export function routeTo(board: Board, cell: number): Direction[] | null {
  const { puzzle } = board;
  const size = puzzle.cols * puzzle.rows;
  if (!(cell >= 0 && cell < size) || puzzle.walls[cell] || boxAt(board, cell) >= 0) return null;
  // 어느 칸에서 어느 방향으로 걸어서 왔는지 적는다. -1은 아직 가 보지 않은 칸이다.
  const cameBy = Array<number>(size).fill(-1);
  const queue = [board.player];
  cameBy[board.player] = 4;
  for (let head = 0; head < queue.length && cameBy[cell] < 0; head += 1) {
    const from = queue[head];
    DIRECTIONS.forEach((direction, way) => {
      const to = neighbour(puzzle, from, direction);
      if (to < 0 || cameBy[to] >= 0 || puzzle.walls[to] || boxAt(board, to) >= 0) return;
      cameBy[to] = way;
      queue.push(to);
    });
  }
  if (cameBy[cell] < 0) return null;
  const route: Direction[] = [];
  for (let at = cell; at !== board.player; ) {
    const way = cameBy[at];
    route.unshift(DIRECTIONS[way]);
    at = neighbour(puzzle, at, DIRECTIONS[(way + 2) % 4]);
  }
  return route;
}

/**
 * 상자가 한 번 들어가면 어떤 별 자리로도 갈 수 없는 칸들(구석이나, 별 자리가 없는 벽을 따라 난 줄).
 * 다른 상자가 없다고 치고 따지므로, 여기 든 칸은 틀림없이 막힌 칸이지만 막힌 모습을 모두 잡아내지는 못한다.
 */
export function deadCells(puzzle: Puzzle): boolean[] {
  const size = puzzle.cols * puzzle.rows;
  const open = (cell: number): boolean => cell >= 0 && !puzzle.walls[cell];
  // 별 자리에서 거꾸로, 상자를 끌어당겨서 올 수 있는 칸을 넓혀 간다.
  const alive = Array<boolean>(size).fill(false);
  const queue = [...puzzle.targets];
  for (const cell of queue) alive[cell] = true;
  for (let head = 0; head < queue.length; head += 1) {
    const at = queue[head];
    for (const direction of DIRECTIONS) {
      // 상자가 from에서 at으로 밀려 왔다면, 미는 캐릭터는 from의 한 칸 뒤에 서 있었다.
      const from = neighbour(puzzle, at, direction);
      if (!open(from) || alive[from]) continue;
      if (!open(neighbour(puzzle, from, direction))) continue;
      alive[from] = true;
      queue.push(from);
    }
  }
  return alive.map((reachable, cell) => !puzzle.walls[cell] && !reachable);
}

/** 막힌 칸(deadCells)에 들어가 버린 상자의 번호들. 이런 상자가 있으면 되돌리지 않고는 판을 깰 수 없다. */
export function stuckBoxes(board: Board, dead: readonly boolean[]): number[] {
  const stuck: number[] = [];
  board.boxes.forEach((cell, index) => {
    if (dead[cell]) stuck.push(index);
  });
  return stuck;
}

/**
 * 별 자리 밖에서 얼어붙은 상자의 번호들: 가로로도 세로로도 다시는 밀 수 없는 상자다. 이런 상자가 있으면 되돌리지 않고는 판을 깰 수 없다.
 * 한 줄로 밀려면 상자의 양옆이 모두 비어야 하므로(한쪽에 캐릭터가 서고 다른 쪽으로 간다), 한쪽 옆이 벽이면 그 줄로는 못 민다.
 * 양옆이 모두 막힌 칸이어도 그 줄로 밀면 끝이므로 못 미는 것으로 친다. 옆에 다른 상자가 붙어 있으면 그 상자도 얼어붙었는지 따진다.
 * 상자 둘이 서로를 막은 모습처럼, 상자 하나만 보는 deadCells가 못 잡는 것을 잡는다. 그래도 모두 잡지는 못한다(isLost가 나머지를 찾는다).
 */
export function frozenBoxes(board: Board, dead: readonly boolean[]): number[] {
  const { puzzle } = board;
  const isWall = (cell: number): boolean => cell < 0 || puzzle.walls[cell];
  // 따지는 중인 상자들. 옆 상자를 따지는 동안에는 벽으로 친다(서로를 끝없이 따지지 않게).
  const holding = new Set<number>();
  const frozen = (cell: number): boolean => {
    holding.add(cell);
    const blocked = (one: Direction, other: Direction): boolean => {
      const a = neighbour(puzzle, cell, one);
      const b = neighbour(puzzle, cell, other);
      if (isWall(a) || isWall(b) || holding.has(a) || holding.has(b)) return true;
      if (dead[a] && dead[b]) return true;
      return (boxAt(board, a) >= 0 && frozen(a)) || (boxAt(board, b) >= 0 && frozen(b));
    };
    const result = blocked('left', 'right') && blocked('up', 'down');
    holding.delete(cell);
    return result;
  };
  const stuck: number[] = [];
  board.boxes.forEach((cell, index) => {
    if (!isTarget(puzzle, cell) && frozen(cell)) stuck.push(index);
  });
  return stuck;
}

// ───────── 판을 만들고 푸는 데 쓰는 바닥 지도 ─────────

/**
 * 바닥 칸의 가장 많은 수. 상자가 놓인 모습을 수 하나로 적으려면(바닥 칸마다 2의 거듭제곱 하나)
 * 이보다 많을 수 없다.
 */
export const MAX_FLOOR = 46;
/** 한 판에 놓는 상자의 가장 많은 수 */
export const MAX_BOXES = 6;

/** 벽을 뺀 바닥 칸에만 0부터 번호를 다시 매긴 지도. 판을 만들고 푸는 동안에는 이 번호(바닥 번호)를 쓴다. */
interface Floor {
  /** 바닥 번호 → 판의 칸 번호 */
  cells: number[];
  /** 판의 칸 번호 → 바닥 번호. 벽은 -1이다. */
  indexOf: number[];
  /** 바닥 번호 × 4 + 방향 번호 → 그쪽 이웃의 바닥 번호. 벽이면 -1이다. */
  next: Int8Array;
}

function floorOf(cols: number, rows: number, walls: readonly boolean[]): Floor {
  const cells: number[] = [];
  const indexOf = Array<number>(cols * rows).fill(-1);
  for (let cell = 0; cell < cols * rows; cell += 1) {
    if (walls[cell]) continue;
    indexOf[cell] = cells.length;
    cells.push(cell);
  }
  const next = new Int8Array(cells.length * 4).fill(-1);
  cells.forEach((cell, index) => {
    const col = cell % cols;
    const row = (cell - col) / cols;
    for (let way = 0; way < 4; way += 1) {
      const toCol = col + DCOL[way];
      const toRow = row + DROW[way];
      if (toCol < 0 || toRow < 0 || toCol >= cols || toRow >= rows) continue;
      next[index * 4 + way] = indexOf[toRow * cols + toCol];
    }
  });
  return { cells, indexOf, next };
}

/** 2의 거듭제곱. 2^32를 넘는 것도 쓰므로 비트 연산 대신 표로 둔다. */
const POWER = Array.from({ length: MAX_FLOOR + 1 }, (_, index) => 2 ** index);

/**
 * 캐릭터가 걸어서 닿는 칸을 넓혀 가는 도구. 상자가 놓인 칸(blocked)은 지나지 못한다.
 * reach(from)은 닿는 칸들에 표시를 남기고, 그 가운데 가장 작은 바닥 번호를 돌려준다.
 * 같은 구역 안이라면 어디에 서 있든 할 수 있는 일이 같으므로, 이 가장 작은 번호를 캐릭터의 자리로 적어서
 * 같은 모습을 한 번만 따진다.
 */
class Reach {
  private readonly mark: Uint32Array;
  private readonly stack: Uint8Array;
  private stamp = 0;

  /** blocked: 상자가 놓인 바닥 칸은 1. 여러 도구가 같은 배열을 함께 볼 수 있다. */
  constructor(
    private readonly floor: Floor,
    readonly blocked: Uint8Array = new Uint8Array(floor.cells.length),
  ) {
    const count = floor.cells.length;
    this.mark = new Uint32Array(count);
    this.stack = new Uint8Array(count);
  }

  reach(from: number): number {
    const { next } = this.floor;
    this.stamp += 1;
    const stamp = this.stamp;
    let lowest = from;
    let top = 0;
    this.stack[top] = from;
    top += 1;
    this.mark[from] = stamp;
    while (top > 0) {
      top -= 1;
      const at = this.stack[top];
      if (at < lowest) lowest = at;
      for (let way = 0; way < 4; way += 1) {
        const to = next[at * 4 + way];
        if (to < 0 || this.mark[to] === stamp || this.blocked[to] === 1) continue;
        this.mark[to] = stamp;
        this.stack[top] = to;
        top += 1;
      }
    }
    return lowest;
  }

  /** 가장 최근의 reach가 그 칸에 닿았는지 */
  reached(index: number): boolean {
    return this.mark[index] === this.stamp;
  }
}

// ───────── 거꾸로 끌어당겨서 처음 모습 찾기 ─────────

/** 거꾸로 찾은 처음 모습 하나 */
export interface Start {
  /** 상자가 놓인 칸(판의 칸 번호). 차례는 별 자리의 차례와 같다: n번째 상자는 n번째 별 자리에서 끌려 나왔다. */
  boxes: number[];
  /** 캐릭터가 설 수 있는 칸들(판의 칸 번호). 이 가운데 어디에 서도 같은 문제다. */
  standing: number[];
  /** 이 모습에서 가장 적게 밀어서 깨는 횟수 */
  par: number;
  /**
   * 그 풀이에서 상자를 한 줄로 죽 미는 토막의 수. 같은 횟수를 밀어도 토막이 많을수록
   * 이 상자 저 상자를 번갈아 이리저리 밀어야 해서 어렵다.
   */
  lines: number;
}

/**
 * 상자가 모두 별 자리에 놓인 모습에서 시작해, 상자를 거꾸로 끌어당기면서 나올 수 있는 모습을 가까운 것부터 찾는다.
 * 끌어당기기는 밀기를 뒤집은 것이라서, n번 끌어당겨 처음 나온 모습은 딱 n번 밀어야 깨지는 문제다.
 * 그래서 여기서 나온 모습은 모두 풀 수 있고, 가장 적게 미는 횟수도 정확히 안다.
 * 돌려주는 배열의 n번째는 n번 밀어야 깨지는 모습 가운데 하나(없으면 undefined)다:
 * 모든 상자가 한 번은 움직여야 하는 모습만 치고, 그 가운데 미는 토막이 가장 많은 것을 고른다.
 * clean이 true이면 처음부터 별 자리에 놓인 상자가 하나도 없는 모습만 친다(놓인 상자를 도로 빼내야 하는 판은 처음 하는 사람에게 헷갈린다).
 * limit은 살펴보는 모습의 수의 한도다. 한도에 닿으면 거기까지 찾은 것만 돌려준다(찾은 것의 횟수는 그래도 정확하다).
 */
export function pullBack(
  cols: number,
  rows: number,
  walls: readonly boolean[],
  targets: readonly number[],
  limit: number,
  clean = false,
): (Start | undefined)[] {
  const floor = floorOf(cols, rows, walls);
  const count = targets.length;
  if (floor.cells.length > MAX_FLOOR || count < 1 || count > MAX_BOXES) return [];
  const { next } = floor;
  // 지금 모습에서 캐릭터가 닿는 칸(reach)과, 한 번 끌어당긴 뒤에 닿는 칸(after)을 따로 따진다.
  const reach = new Reach(floor);
  const after = new Reach(floor, reach.blocked);
  const everyBox = 2 ** count - 1;

  // 찾은 모습들. 번호 하나가 모습 하나이고, 찾은 차례대로 쌓인다.
  const boxesOf = new Uint8Array((limit + 1) * count);
  const playerOf = new Uint8Array(limit + 1);
  const parOf = new Uint16Array(limit + 1);
  const linesOf = new Uint16Array(limit + 1);
  /** 지금까지 한 번이라도 끌어당긴 상자들(상자 번호마다 비트 하나) */
  const movedOf = new Uint8Array(limit + 1);
  /** 마지막으로 끌어당긴 상자의 번호 × 4 + 방향 번호. 아직 없으면 255 */
  const lastOf = new Uint8Array(limit + 1).fill(255);
  const seen = new Set<number>();
  let found = 0;

  const add = (key: number, player: number): number => {
    seen.add(key);
    playerOf[found] = player;
    found += 1;
    return found - 1;
  };

  // 다 놓인 모습: 캐릭터가 어느 구역에 있느냐에 따라 서로 다른 모습이다.
  let solvedMask = 0;
  targets.forEach((cell) => {
    const index = floor.indexOf[cell];
    reach.blocked[index] = 1;
    solvedMask += POWER[index];
  });
  for (let index = 0; index < floor.cells.length && found < limit; index += 1) {
    if (reach.blocked[index] === 1) continue;
    const lowest = reach.reach(index);
    const key = solvedMask * 64 + lowest;
    if (seen.has(key)) continue;
    const state = add(key, lowest);
    targets.forEach((cell, box) => {
      boxesOf[state * count + box] = floor.indexOf[cell];
    });
  }
  targets.forEach((cell) => {
    reach.blocked[floor.indexOf[cell]] = 0;
  });

  const spotAt = floor.cells.map((cell) => targets.includes(cell));
  /** 그 모습에 별 자리에 놓인 상자가 하나도 없는지 */
  const isClean = (state: number): boolean => {
    for (let box = 0; box < count; box += 1) {
      if (spotAt[boxesOf[state * count + box]]) return false;
    }
    return true;
  };

  /** 횟수마다 고른 모습의 번호 */
  const best: number[] = [];
  for (let state = 0; state < found; state += 1) {
    const base = state * count;
    const par = parOf[state];
    if (
      movedOf[state] === everyBox &&
      (best[par] === undefined || linesOf[state] > linesOf[best[par]]) &&
      (!clean || isClean(state))
    ) {
      best[par] = state;
    }
    if (found >= limit) continue;

    let mask = 0;
    for (let box = 0; box < count; box += 1) {
      const at = boxesOf[base + box];
      reach.blocked[at] = 1;
      mask += POWER[at];
    }
    reach.reach(playerOf[state]);
    for (let box = 0; box < count && found < limit; box += 1) {
      const at = boxesOf[base + box];
      for (let way = 0; way < 4 && found < limit; way += 1) {
        // 캐릭터가 상자의 way 쪽 옆(stand)에 서서 한 칸 더 물러나며(back) 상자를 끌어온다.
        const stand = next[at * 4 + way];
        if (stand < 0 || !reach.reached(stand)) continue;
        const back = next[stand * 4 + way];
        if (back < 0 || reach.blocked[back] === 1) continue;

        reach.blocked[at] = 0;
        reach.blocked[stand] = 1;
        const lowest = after.reach(back);
        reach.blocked[stand] = 0;
        reach.blocked[at] = 1;
        const key = (mask - POWER[at] + POWER[stand]) * 64 + lowest;
        if (seen.has(key)) continue;

        const made = add(key, lowest);
        boxesOf.copyWithin(made * count, base, base + count);
        boxesOf[made * count + box] = stand;
        parOf[made] = par + 1;
        movedOf[made] = movedOf[state] | (1 << box);
        lastOf[made] = box * 4 + way;
        linesOf[made] = linesOf[state] + (lastOf[state] === box * 4 + way ? 0 : 1);
      }
    }
    for (let box = 0; box < count; box += 1) reach.blocked[boxesOf[base + box]] = 0;
  }

  return Array.from({ length: best.length }, (_, par) => {
    const state = best[par];
    if (state === undefined) return undefined;
    const boxes = Array.from({ length: count }, (_, box) => boxesOf[state * count + box]);
    for (const at of boxes) reach.blocked[at] = 1;
    reach.reach(playerOf[state]);
    const standing = floor.cells.filter((_, index) => reach.reached(index));
    for (const at of boxes) reach.blocked[at] = 0;
    return { boxes: boxes.map((at) => floor.cells[at]), standing, par, lines: linesOf[state] };
  });
}

// ───────── 풀어 보기 ─────────

/** 풀어 볼 때 살펴보는 모습의 수의 한도 */
export const SOLVE_LIMIT = 600_000;

/**
 * 판을 실제로 풀어 보고, 가장 적게 밀어서 깨는 횟수를 돌려준다. 풀 수 없으면 null이다.
 * 처음 모습에서 밀 수 있는 것을 모두 밀어 보며 가까운 모습부터 넓혀 간다.
 * 판을 만들 때(pullBack)와는 반대 방향으로 따지므로, 만든 판이 정말 풀리고 횟수가 맞는지 확인하는 데 쓴다.
 * limit개의 모습을 살펴보고도 답이 안 나오면 null을 돌려준다.
 */
export function minPushes(puzzle: Puzzle, limit = SOLVE_LIMIT): number | null {
  const found = searchPushes(puzzle, limit);
  return typeof found === 'number' ? found : null;
}

/** 지금 모습이 깰 수 없는 판인지 끝까지 찾아볼 때 살펴보는 모습의 수의 한도. 미는 순간이 끊기지 않을 만큼만 찾는다. */
export const LOST_LIMIT = 1000;

/**
 * 지금 모습에서 아무리 밀어도 판을 깰 수 없는지. 갈 수 있는 모습을 limit개 안에서 끝까지 다 살펴봤는데 깨는 모습이 없을 때만 true다.
 * 깰 수 없게 된 판은 갈 수 있는 모습이 적어서 금방 바닥나고, 풀리는 판은 한도에 닿아서 false가 된다(잘못 알리는 일은 없다).
 */
export function isLost(board: Board, limit = LOST_LIMIT): boolean {
  return searchPushes({ ...board.puzzle, boxes: board.boxes, player: board.player }, limit) === 'none';
}

/**
 * minPushes의 속. 가장 적게 미는 횟수를 돌려주고, 풀 수 없다는 것을 끝까지 살펴서 알았으면 'none',
 * 한도에 닿아서(또는 판이 너무 커서) 모르면 'unknown'이다.
 */
function searchPushes(puzzle: Puzzle, limit: number): number | 'none' | 'unknown' {
  const floor = floorOf(puzzle.cols, puzzle.rows, puzzle.walls);
  const count = puzzle.boxes.length;
  if (floor.cells.length > MAX_FLOOR || count > MAX_BOXES) return 'unknown';
  const { next } = floor;
  const reach = new Reach(floor);
  const after = new Reach(floor, reach.blocked);
  const dead = deadCells(puzzle);
  const deadAt = floor.cells.map((cell) => dead[cell]);
  let goal = 0;
  for (const cell of puzzle.targets) goal += POWER[floor.indexOf[cell]];

  const boxesOf = new Uint8Array((limit + 1) * count);
  const playerOf = new Uint8Array(limit + 1);
  const maskOf = new Float64Array(limit + 1);
  const pushesOf = new Uint16Array(limit + 1);
  const seen = new Set<number>();

  let mask = 0;
  puzzle.boxes.forEach((cell, box) => {
    const at = floor.indexOf[cell];
    boxesOf[box] = at;
    reach.blocked[at] = 1;
    mask += POWER[at];
  });
  if (mask === goal) return 0;
  playerOf[0] = reach.reach(floor.indexOf[puzzle.player]);
  maskOf[0] = mask;
  seen.add(mask * 64 + playerOf[0]);
  for (let box = 0; box < count; box += 1) reach.blocked[boxesOf[box]] = 0;
  let found = 1;

  for (let state = 0; state < found; state += 1) {
    const base = state * count;
    for (let box = 0; box < count; box += 1) reach.blocked[boxesOf[base + box]] = 1;
    reach.reach(playerOf[state]);
    for (let box = 0; box < count; box += 1) {
      const at = boxesOf[base + box];
      for (let way = 0; way < 4; way += 1) {
        // 캐릭터가 상자의 맞은편 옆(stand)에 서서 way 쪽으로 민다.
        const stand = next[at * 4 + ((way + 2) % 4)];
        if (stand < 0 || !reach.reached(stand)) continue;
        const to = next[at * 4 + way];
        if (to < 0 || reach.blocked[to] === 1 || deadAt[to]) continue;

        const made = maskOf[state] - POWER[at] + POWER[to];
        if (made === goal) return pushesOf[state] + 1;
        reach.blocked[at] = 0;
        reach.blocked[to] = 1;
        const lowest = after.reach(at);
        reach.blocked[to] = 0;
        reach.blocked[at] = 1;
        const key = made * 64 + lowest;
        if (seen.has(key)) continue;
        if (found >= limit) return 'unknown';

        seen.add(key);
        boxesOf.copyWithin(found * count, base, base + count);
        boxesOf[found * count + box] = to;
        playerOf[found] = lowest;
        maskOf[found] = made;
        pushesOf[found] = pushesOf[state] + 1;
        found += 1;
      }
    }
    for (let box = 0; box < count; box += 1) reach.blocked[boxesOf[base + box]] = 0;
  }
  return 'none';
}

// ───────── 방 만들기 ─────────

/** 방 하나: 벽으로 둘러싸인 바닥 */
export interface Room {
  cols: number;
  rows: number;
  walls: boolean[];
}

/** 안쪽에 놓는 벽 조각의 모양들: 한 칸, 두 칸(가로와 세로), 세 칸(꺾인 것 넷). (col, row)의 차이로 적는다. */
const WALL_PIECES: readonly (readonly (readonly [number, number])[])[] = [
  [[0, 0]],
  [
    [0, 0],
    [1, 0],
  ],
  [
    [0, 0],
    [0, 1],
  ],
  [
    [0, 0],
    [1, 0],
    [0, 1],
  ],
  [
    [0, 0],
    [1, 0],
    [1, 1],
  ],
  [
    [0, 0],
    [0, 1],
    [1, 1],
  ],
  [
    [1, 0],
    [0, 1],
    [1, 1],
  ],
];

/** list에서 하나를 고른다. */
function pick<T>(list: readonly T[], random: () => number): T {
  return list[Math.min(list.length - 1, Math.floor(random() * list.length))];
}

/** 0부터 below - 1까지의 정수 하나 */
function below(count: number, random: () => number): number {
  return Math.min(count - 1, Math.floor(random() * count));
}

/**
 * 안쪽이 innerCols × innerRows칸인 방을 만든다. 빈 방에 벽 조각을 pieces개 흩어 놓은 다음,
 * 서로 이어진 바닥 가운데 가장 넓은 덩어리만 남기고, 그 덩어리에 딱 맞게 둘레를 줄인다.
 * 그래서 돌려주는 방은 바랐던 것보다 작을 수 있다.
 */
export function carveRoom(innerCols: number, innerRows: number, pieces: number, random: () => number): Room {
  const cols = innerCols + 2;
  const rows = innerRows + 2;
  const walls = Array.from({ length: cols * rows }, (_, cell) => {
    const col = cell % cols;
    const row = Math.floor(cell / cols);
    return col === 0 || row === 0 || col === cols - 1 || row === rows - 1;
  });
  for (let placed = 0; placed < pieces; placed += 1) {
    const piece = pick(WALL_PIECES, random);
    const col = 1 + below(innerCols, random);
    const row = 1 + below(innerRows, random);
    for (const [dc, dr] of piece) {
      if (col + dc <= innerCols && row + dr <= innerRows) walls[(row + dr) * cols + col + dc] = true;
    }
  }

  // 이어진 바닥 덩어리 가운데 가장 넓은 것만 남긴다.
  const group = Array<number>(cols * rows).fill(-1);
  const sizes: number[] = [];
  for (let cell = 0; cell < cols * rows; cell += 1) {
    if (walls[cell] || group[cell] >= 0) continue;
    const id = sizes.length;
    const queue = [cell];
    group[cell] = id;
    for (let head = 0; head < queue.length; head += 1) {
      for (const step of [-cols, 1, cols, -1]) {
        const to = queue[head] + step;
        if (walls[to] || group[to] >= 0) continue;
        group[to] = id;
        queue.push(to);
      }
    }
    sizes.push(queue.length);
  }
  const widest = sizes.indexOf(Math.max(0, ...sizes));
  const kept = walls.map((_, cell) => group[cell] === widest && widest >= 0);

  // 남은 바닥에 딱 맞게 줄이고, 둘레에 벽을 한 겹 두른다.
  let left = cols;
  let right = -1;
  let top = rows;
  let bottom = -1;
  kept.forEach((floor, cell) => {
    if (!floor) return;
    const col = cell % cols;
    const row = Math.floor(cell / cols);
    left = Math.min(left, col);
    right = Math.max(right, col);
    top = Math.min(top, row);
    bottom = Math.max(bottom, row);
  });
  if (right < left) return { cols: 3, rows: 3, walls: Array<boolean>(9).fill(true) };
  const trimmedCols = right - left + 3;
  const trimmedRows = bottom - top + 3;
  const trimmed = Array<boolean>(trimmedCols * trimmedRows).fill(true);
  kept.forEach((floor, cell) => {
    if (!floor) return;
    const col = (cell % cols) - left + 1;
    const row = Math.floor(cell / cols) - top + 1;
    trimmed[row * trimmedCols + col] = false;
  });
  return { cols: trimmedCols, rows: trimmedRows, walls: trimmed };
}

/**
 * 방의 바닥에서 별 자리를 count개 고른다. 반은 흩어 놓고, 반은 서로 붙여서 모아 놓는다:
 * 모아 놓은 자리는 안쪽부터 채워야 해서 어느 상자를 먼저 넣을지를 따지게 된다.
 * 바닥이 모자라면 빈 배열이다.
 */
export function placeTargets(room: Room, count: number, random: () => number): number[] {
  const floor: number[] = [];
  room.walls.forEach((wall, cell) => {
    if (!wall) floor.push(cell);
  });
  // 상자와 캐릭터가 움직일 틈이 있어야 한다.
  if (floor.length < count * 2 + 2) return [];
  const chosen = [pick(floor, random)];
  const gathered = random() < 0.5;
  while (chosen.length < count) {
    const beside = gathered
      ? chosen
          .flatMap((cell) => [cell - room.cols, cell + 1, cell + room.cols, cell - 1])
          .filter((cell) => !room.walls[cell] && !chosen.includes(cell))
      : [];
    const pool = beside.length > 0 ? beside : floor.filter((cell) => !chosen.includes(cell));
    chosen.push(pick(pool, random));
  }
  return chosen.sort((a, b) => a - b);
}

// ───────── 문제 만들기 ─────────

/** 만들 문제의 모양 */
export interface PuzzlePlan {
  /** 벽 둘레를 뺀 안쪽의 가장 큰 크기 */
  innerCols: number;
  innerRows: number;
  /** 안쪽에 흩어 놓는 벽 조각의 수: [가장 적을 때, 가장 많을 때] */
  pieces: readonly [number, number];
  boxes: number;
  /** 가장 적게 미는 횟수가 이 범위에 드는 문제만 낸다: [가장 적을 때, 가장 많을 때] */
  par: readonly [number, number];
  /** 방 하나에서 거꾸로 살펴보는 모습의 수의 한도(pullBack의 limit) */
  limit: number;
  /** true면 처음부터 별 자리에 놓인 상자가 없는 문제만 낸다. 쉬운 판에 쓴다. */
  clean?: boolean;
}

/** 한 문제를 만들 때 방을 새로 지어 보는 횟수. 이 안에 못 만들면 정해 둔 판을 쓴다. */
export const MAX_GENERATE_ATTEMPTS = 60;

/**
 * 방을 지어 볼 수 없을 때 쓰는 정해진 판: 줄마다 상자 하나를 오른쪽으로 한 칸만 밀면 된다.
 * 재미는 덜해도 틀림없이 풀린다.
 */
export function fallbackPuzzle(boxes: number): Puzzle {
  const count = Math.min(MAX_BOXES, Math.max(1, Math.floor(boxes)));
  const lines = ['p...', ...Array.from({ length: count }, () => '.bo.')];
  return parsePuzzle(lines.join('/'), count) as Puzzle;
}

/** 만든 문제와, 그것이 얼마나 까다로운지 */
export interface Made {
  puzzle: Puzzle;
  /** 풀이에서 상자를 한 줄로 죽 미는 토막의 수(Start.lines) */
  lines: number;
}

/**
 * plan에 맞는 문제를 하나 만든다. 방을 짓고 별 자리를 고른 다음, 다 놓인 모습에서 거꾸로 끌어당겨
 * 가장 멀리 나온 모습(횟수가 par 범위 안에서 가장 큰 것)을 처음 모습으로 삼는다.
 * 그래서 만든 문제는 반드시 풀리고, 가장 적게 미는 횟수(par)도 정확하다.
 * 방은 MAX_GENERATE_ATTEMPTS번까지만 지어 보고, 그래도 안 되면 정해 둔 판을 쓴다.
 * 그래서 random이 무엇을 내놓든 언제나 끝난다.
 */
export function generatePuzzle(plan: PuzzlePlan, random: () => number): Made {
  const [fewest, most] = plan.pieces;
  const [easiest, hardest] = plan.par;
  for (let attempt = 0; attempt < MAX_GENERATE_ATTEMPTS; attempt += 1) {
    const room = carveRoom(plan.innerCols, plan.innerRows, fewest + below(most - fewest + 1, random), random);
    const targets = placeTargets(room, plan.boxes, random);
    if (targets.length === 0) continue;
    const starts = pullBack(room.cols, room.rows, room.walls, targets, plan.limit, plan.clean === true);
    let start: Start | undefined;
    for (let par = Math.min(hardest, starts.length - 1); par >= easiest && !start; par -= 1) start = starts[par];
    if (!start) continue;
    return {
      puzzle: {
        cols: room.cols,
        rows: room.rows,
        walls: room.walls,
        targets,
        boxes: [...start.boxes].sort((a, b) => a - b),
        player: pick(start.standing, random),
        par: start.par,
      },
      lines: start.lines,
    };
  }
  return { puzzle: fallbackPuzzle(plan.boxes), lines: plan.boxes };
}

/** 판을 count개 만들어 보고, 미는 토막의 수가 lines에 가장 가까운 것을 고른다. 똑같이 가까우면 먼저 만든 것을 쓴다. */
export function generateNear(plan: PuzzlePlan, lines: number, count: number, random: () => number): Made {
  let best = generatePuzzle(plan, random);
  for (let made = 1; made < count; made += 1) {
    const next = generatePuzzle(plan, random);
    if (Math.abs(next.lines - lines) < Math.abs(best.lines - lines)) best = next;
  }
  return best;
}

// ───────── 화면 배치 ─────────

/** 한 칸의 가장 큰 크기(px). 작은 판에서 칸이 지나치게 커지지 않게 한다. */
export const MAX_CELL = 38;
/** 판 둘레에 비워 두는 여백(px). 판의 테두리와 그림자가 들어간다. */
export const BOARD_MARGIN = 10;

export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BoardLayout {
  /** 한 칸의 크기(px) */
  cell: number;
  /** 안쪽 왼쪽 위 칸(판의 (1, 1) 칸)의 왼쪽 위 모서리. 맨 바깥의 벽 둘레는 칸으로 그리지 않고 테두리로 그린다. */
  left: number;
  top: number;
}

/** 주어진 자리에서 여백을 뺀 곳에 들어가는 가장 큰 칸 크기를 구하고, 판의 안쪽을 그 자리 한가운데에 놓는다. */
export function boardLayout(puzzle: Pick<Puzzle, 'cols' | 'rows'>, area: Area): BoardLayout {
  const innerCols = puzzle.cols - 2;
  const innerRows = puzzle.rows - 2;
  const cell = Math.min(
    MAX_CELL,
    Math.floor((area.width - BOARD_MARGIN * 2) / innerCols),
    Math.floor((area.height - BOARD_MARGIN * 2) / innerRows),
  );
  return {
    cell,
    left: Math.round(area.x + (area.width - innerCols * cell) / 2),
    top: Math.round(area.y + (area.height - innerRows * cell) / 2),
  };
}

/** (x, y)에 놓인 칸의 번호. 판의 안쪽을 벗어났으면 null이다. */
export function cellAt(
  puzzle: Pick<Puzzle, 'cols' | 'rows'>,
  layout: BoardLayout,
  x: number,
  y: number,
): number | null {
  const col = Math.floor((x - layout.left) / layout.cell) + 1;
  const row = Math.floor((y - layout.top) / layout.cell) + 1;
  if (col < 1 || row < 1 || col > puzzle.cols - 2 || row > puzzle.rows - 2) return null;
  return row * puzzle.cols + col;
}

/** 칸의 가운데 자리(px) */
export function centerOf(
  puzzle: Pick<Puzzle, 'cols'>,
  layout: BoardLayout,
  cell: number,
): { x: number; y: number } {
  const { col, row } = cellOf(puzzle.cols, cell);
  return { x: layout.left + (col - 0.5) * layout.cell, y: layout.top + (row - 0.5) * layout.cell };
}

// ───────── 판의 차례 ─────────

/** 점수 도전에서 차례로 나오는 판의 모양: 몇 판 동안 나오는지, 깼을 때의 점수, 깼을 때 돌려받는 시간(초) */
export interface StagePlan {
  puzzle: PuzzlePlan;
  /** 노리는 미는 토막의 수: [그 모양의 첫 판, 마지막 판]. 사이의 판은 고르게 올라간다. */
  lines: readonly [number, number];
  boards: number;
  points: number;
  seconds: number;
}

/**
 * 뒤로 갈수록 방이 넓어지고 상자가 늘고 이리저리 밀 일이 많아진다. 마지막 모양은 끝날 때까지 나온다.
 * 방 하나에서 살펴보는 모습의 한도는 넉넉하다: 이 크기의 방은 나올 수 있는 모습이 수천 가지를 넘지 않는다.
 */
export const STAGE_PLANS: readonly StagePlan[] = [
  {
    puzzle: { innerCols: 4, innerRows: 4, pieces: [1, 3], boxes: 1, par: [2, 6], limit: 4000, clean: true },
    lines: [2, 2],
    boards: 1,
    points: 10,
    seconds: 8,
  },
  {
    puzzle: { innerCols: 4, innerRows: 5, pieces: [2, 5], boxes: 2, par: [3, 12], limit: 8000, clean: true },
    lines: [3, 4],
    boards: 2,
    points: 20,
    seconds: 12,
  },
  {
    puzzle: { innerCols: 5, innerRows: 5, pieces: [3, 7], boxes: 2, par: [5, 16], limit: 12000, clean: true },
    lines: [5, 7],
    boards: 3,
    points: 35,
    seconds: 16,
  },
  {
    puzzle: { innerCols: 5, innerRows: 6, pieces: [4, 9], boxes: 3, par: [7, 24], limit: 30000 },
    lines: [6, 8],
    boards: 3,
    points: 50,
    seconds: 22,
  },
  {
    puzzle: { innerCols: 6, innerRows: 6, pieces: [5, 11], boxes: 3, par: [10, 40], limit: 40000 },
    lines: [9, 12],
    boards: Number.POSITIVE_INFINITY,
    points: 70,
    seconds: 26,
  },
];

/** 한 판을 낼 때 만들어 보는 문제의 수. 이 가운데 그 판이 노리는 어려움에 가장 가까운 것을 낸다. */
export const STAGE_PUZZLES = 6;
/** 마지막 모양의 판이 거듭되어도 노리는 토막의 수가 이 판 수에 걸쳐서만 올라간다. */
const LAST_PLAN_RAMP = 4;

/** stage번째 판(1부터)의 계획과, 그 모양의 판으로는 몇 번째인지(0부터) */
function planFor(stage: number): { plan: StagePlan; turn: number } {
  let turn = Math.max(1, Math.floor(stage)) - 1;
  for (const plan of STAGE_PLANS) {
    if (turn < plan.boards) return { plan, turn };
    turn -= plan.boards;
  }
  return { plan: STAGE_PLANS[STAGE_PLANS.length - 1], turn };
}

/** stage번째 판에 놓이는 상자의 수 */
export function stageBoxes(stage: number): number {
  return planFor(stage).plan.puzzle.boxes;
}

/** stage번째 판이 노리는 미는 토막의 수 */
export function stageLines(stage: number): number {
  const { plan, turn } = planFor(stage);
  const span = Number.isFinite(plan.boards) ? plan.boards - 1 : LAST_PLAN_RAMP;
  const [from, to] = plan.lines;
  return span <= 0 ? from : Math.round(from + ((to - from) * Math.min(turn, span)) / span);
}

/** stage번째 판의 문제를 만든다. */
export function stagePuzzle(stage: number, random: () => number): Puzzle {
  return generateNear(planFor(stage).plan.puzzle, stageLines(stage), STAGE_PUZZLES, random).puzzle;
}

// ───────── 시간과 점수 ─────────

/** 처음에 주어지는 시간(초). 판을 깨서 돌려받아도 이보다 많아지지는 않는다. */
export const START_SECONDS = 90;
/** 가장 어려운 모양의 판이 거듭될 때마다 돌려받는 시간이 줄어드는 양(초) */
export const LATE_SECONDS_STEP = 2;
/** 아무리 뒤의 판이라도 이만큼은 돌려받는다(초) */
export const MIN_CLEAR_SECONDS = 8;
/** 가장 적게 미는 횟수로 판을 깼을 때 더 받는 점수 */
export const NEAT_POINTS = 10;
/** 끝났을 때 풀던 판에서 별 자리에 놓아 둔 상자 하나마다 주는 점수 */
export const PLACED_POINTS = 3;
/** 되돌릴 수 있는 횟수의 한도. 이보다 오래된 것은 잊는다. */
export const MAX_HISTORY = 400;

/** stage번째 판을 깼을 때의 점수. 뒤의 판일수록 많다. */
export function clearPoints(stage: number): number {
  return planFor(stage).plan.points;
}

/**
 * stage번째 판을 깼을 때 돌려받는 시간(초). 어려운 판일수록 많이 돌려받지만,
 * 가장 어려운 모양의 판은 거듭될수록 조금씩 줄어서 아무리 잘 풀어도 한 판은 언젠가 끝난다.
 */
export function clearSeconds(stage: number): number {
  const { plan, turn } = planFor(stage);
  const late = Number.isFinite(plan.boards) ? 0 : turn * LATE_SECONDS_STEP;
  return Math.max(MIN_CLEAR_SECONDS, plan.seconds - late);
}

// ───────── 한 판의 진행 ─────────

export interface RunState {
  /** 지금 판의 번호. 1부터 센다. */
  stage: number;
  board: Board;
  /** 밀기 전의 모습들. 되돌리기가 맨 뒤의 것부터 꺼내 쓴다. 걷기만 한 것은 적지 않는다. */
  history: readonly Board[];
  /** 남은 시간(초) */
  timeLeft: number;
  /** 깬 판으로 얻은 점수. 풀던 판에 놓아 둔 상자의 점수는 finalScore가 더한다. */
  score: number;
  boardsCleared: number;
  /** 가장 적게 미는 횟수로 깬 판의 수 */
  neatClears: number;
  /** 깬 판들에서 별 자리에 놓은 상자의 수 */
  boxesPlaced: number;
}

export interface ClearReward {
  points: number;
  /** 돌려받은 시간(초). 시간이 이미 가득하면 0일 수 있다. */
  seconds: number;
  /** 가장 적게 미는 횟수로 깼는지 */
  neat: boolean;
}

function runOf(puzzle: Puzzle): RunState {
  return {
    stage: 1,
    board: newBoard(puzzle),
    history: [],
    timeLeft: START_SECONDS,
    score: 0,
    boardsCleared: 0,
    neatClears: 0,
    boxesPlaced: 0,
  };
}

export function newRun(random: () => number): RunState {
  return runOf(stagePuzzle(1, random));
}

/** 정해 둔 문제 하나로 하는 판. 단계 모드가 쓴다: 시간은 흐르지 않고(elapse를 부르지 않는다), 그 판을 깨면 끝난다. */
export function puzzleRun(puzzle: Puzzle): RunState {
  return runOf(puzzle);
}

/** 시간이 흐른다. 0 아래로는 내려가지 않는다. */
export function elapse(run: RunState, seconds: number): RunState {
  return { ...run, timeLeft: Math.max(0, run.timeLeft - Math.max(0, seconds)) };
}

/** 시간이 다 되어 끝났는지 */
export function isOver(run: RunState): boolean {
  return run.timeLeft <= 0;
}

/**
 * direction 쪽으로 한 칸 걷거나 민다. 밀었으면 밀기 전의 모습을 적어 두어서 되돌릴 수 있다.
 * 막혀서 움직이지 못했으면 받은 상태를 그대로 돌려준다.
 */
export function advance(run: RunState, direction: Direction): { run: RunState; step: Step } {
  const result = step(run.board, direction);
  if (!result.moved) return { run, step: result };
  const history = result.pushed >= 0 ? [...run.history, run.board].slice(-MAX_HISTORY) : run.history;
  return { run: { ...run, board: result.board, history }, step: result };
}

/** 되돌릴 것이 있는지 */
export function canUndo(run: RunState): boolean {
  return run.history.length > 0;
}

/** 마지막으로 민 것을 되돌린다: 그 상자를 밀기 바로 전의 모습으로 돌아간다. 되돌릴 것이 없으면 그대로다. */
export function undo(run: RunState): RunState {
  if (run.history.length === 0) return run;
  return { ...run, board: run.history[run.history.length - 1], history: run.history.slice(0, -1) };
}

/**
 * 지금 판이 처음 모습과 달라졌는지. 상자를 민 적이 있거나 캐릭터가 자리를 떴다.
 * 되돌리기가 기억하는 것보다 많이 밀었으면 끝까지 되돌려도 처음 모습이 아닐 수 있어서, 민 횟수와 상자의 자리도 본다.
 */
export function hasMoved(run: RunState): boolean {
  const { board } = run;
  return (
    run.history.length > 0 ||
    board.pushes > 0 ||
    board.player !== board.puzzle.player ||
    board.boxes.some((cell, box) => cell !== board.puzzle.boxes[box])
  );
}

/** 지금 판을 처음 모습으로 되돌린다. 민 횟수도 0으로 돌아간다. */
export function restart(run: RunState): RunState {
  return { ...run, board: newBoard(run.board.puzzle), history: [] };
}

/**
 * 지금 판을 깼으면 점수와 시간을 받는다. 아직 못 깼거나 이미 끝났으면 reward가 null이고 상태는 그대로다.
 * 다음 판은 nextStage가 깐다.
 */
export function claimClear(run: RunState): { run: RunState; reward: ClearReward | null } {
  if (isOver(run) || !isSolved(run.board)) return { run, reward: null };
  const neat = run.board.pushes <= run.board.puzzle.par;
  const timeLeft = Math.min(START_SECONDS, run.timeLeft + clearSeconds(run.stage));
  const reward: ClearReward = {
    points: clearPoints(run.stage) + (neat ? NEAT_POINTS : 0),
    seconds: timeLeft - run.timeLeft,
    neat,
  };
  return {
    run: {
      ...run,
      timeLeft,
      score: run.score + reward.points,
      boardsCleared: run.boardsCleared + 1,
      neatClears: run.neatClears + (neat ? 1 : 0),
      boxesPlaced: run.boxesPlaced + run.board.boxes.length,
    },
    reward,
  };
}

/** 다음 판으로 넘어간다. 판을 깬 뒤에 부른다. */
export function nextStage(run: RunState, random: () => number): RunState {
  const stage = run.stage + 1;
  return { ...run, stage, board: newBoard(stagePuzzle(stage, random)), history: [] };
}

/** 풀던 판에서 별 자리에 놓아 둔 상자로 받는 점수. 이미 깬 판이면 그 판의 점수에 들어 있으므로 0이다. */
export function pendingPoints(run: RunState): number {
  return isSolved(run.board) ? 0 : placedCount(run.board) * PLACED_POINTS;
}

/** 끝났을 때의 점수: 깬 판의 점수에, 풀던 판에서 놓아 둔 상자의 점수를 더한다. */
export function finalScore(run: RunState): number {
  return run.score + pendingPoints(run);
}
