/**
 * 벽돌 깨기의 규칙. 화면과 분리된 순수 함수라서 숫자만 바꿔 밸런스를 조정할 수 있다.
 * 길이는 논리 픽셀, 시간은 초다. 가로는 화면 왼쪽 끝이 0이고, 세로는 판의 천장이 0이며 아래로 갈수록 커진다.
 *
 * 벽돌 줄은 천장에서 끝없이 내려온다. 막대로 공을 튕겨 벽돌을 깨서, 벽돌이 바닥 선(LIMIT_Y)에 닿지 않게 버틴다.
 * 공을 모두 놓쳐도 판이 끝나지는 않고, 그 벌로 벽돌이 몇 줄만큼 한꺼번에 내려온다.
 * 그래서 끝나는 까닭은 하나뿐이다: 벽돌이 바닥 선에 닿는 것. 내려오는 속도와 공의 속도는 버틴 시간에 따라 오른다.
 */

// ───────── 판 ─────────

export const FIELD_LEFT = 4;
export const FIELD_RIGHT = 236;
/** 한 줄에 놓이는 벽돌 칸의 수 */
export const COLS = 8;
export const CELL_WIDTH = (FIELD_RIGHT - FIELD_LEFT) / COLS;
export const CELL_HEIGHT = 14;
/** 벽돌이 여기까지 내려오면 끝난다. 줄 열여섯 개의 높이다. */
export const LIMIT_ROWS = 16;
export const LIMIT_Y = LIMIT_ROWS * CELL_HEIGHT;
/** 막대의 윗면 */
export const PADDLE_Y = 262;
export const PADDLE_HEIGHT = 8;
/** 막대 너비의 절반 */
export const PADDLE_HALF = 23;
/** 판의 아래 끝. 공이 이 아래로 떨어지면 놓친 것이다. */
export const FIELD_HEIGHT = 292;
export const BALL_RADIUS = 4;
/** 판에 한꺼번에 있을 수 있는 공의 수 */
export const MAX_BALLS = 3;

// ───────── 막대 ─────────

/** 막대가 손가락을 따라붙는 빠르기. 0.1초면 거의 다 따라온다. */
export const PADDLE_RATE = 30;

/** 막대의 가운데가 있을 수 있는 범위 안으로 x를 맞춘다. 막대가 벽을 넘지 않는다. */
export function clampPaddle(x: number): number {
  return Math.min(FIELD_RIGHT - PADDLE_HALF, Math.max(FIELD_LEFT + PADDLE_HALF, x));
}

/** dt초 뒤 막대의 가로 위치. 가려는 곳(target)에 가까워질수록 느려져서 부드럽게 멈춘다. */
export function steerPaddle(x: number, target: number, dt: number): number {
  const goal = clampPaddle(target);
  return goal + (x - goal) * Math.exp(-PADDLE_RATE * Math.max(0, dt));
}

/**
 * 막대에 맞은 공이 튀어 나가는 각도(라디안). 위쪽이 0이고 오른쪽으로 기울면 +다.
 * offset은 막대 가운데에서 맞은 자리까지의 거리를 막대 절반 너비로 나눈 것(-1~1)이다.
 * 가운데에 맞으면 곧게 오르고 끝에 맞을수록 그쪽으로 눕는다. 맞히는 자리로 공을 보낼 곳을 고르게 하려는 것이다.
 */
export const MAX_BOUNCE_ANGLE = Math.PI / 3;

export function bounceAngle(offset: number): number {
  return Math.min(1, Math.max(-1, offset)) * MAX_BOUNCE_ANGLE;
}

// ───────── 속도 ─────────

export const BALL_START_SPEED = 200;
export const BALL_MAX_SPEED = 290;
/** 이만큼 버티면 공이 BALL_MAX_SPEED에 닿는다. */
export const BALL_FULL_SECONDS = 120;

/** 공의 빠르기(px/s). elapsed는 공이 날아다닌 시간(초). */
export function ballSpeed(elapsed: number): number {
  const ratio = Math.min(1, Math.max(0, elapsed) / BALL_FULL_SECONDS);
  return BALL_START_SPEED + (BALL_MAX_SPEED - BALL_START_SPEED) * ratio;
}

/** 공이 옆으로 누워도 세로 빠르기는 전체의 이만큼은 남긴다. 공이 좌우 벽 사이만 오가며 시간을 끌지 않는다. */
export const MIN_VERTICAL_RATIO = 0.3;

/** 벽돌이 내려오는 속도(px/s): 처음에는 한 줄에 10초쯤, CREEP_FULL_SECONDS 뒤에는 3초쯤 걸린다. */
export const CREEP_START = 1.6;
export const CREEP_MAX = 5;
export const CREEP_FULL_SECONDS = 120;
/** CREEP_MAX에 닿은 뒤로도 초마다 이만큼씩 더 빨라진다. 아무리 잘 받아도 판이 끝나게 한다. */
export const LATE_CREEP_GAIN = 0.03;
/** 아무리 오래 버텨도 이보다 빨리 내려오지는 않는다. 한 줄에 1.4초다. */
export const CREEP_TOP = 10;

export function creepSpeed(elapsed: number): number {
  const at = Math.max(0, elapsed);
  if (at <= CREEP_FULL_SECONDS) {
    return CREEP_START + ((CREEP_MAX - CREEP_START) * at) / CREEP_FULL_SECONDS;
  }
  return Math.min(CREEP_TOP, CREEP_MAX + LATE_CREEP_GAIN * (at - CREEP_FULL_SECONDS));
}

/** 공을 모두 놓쳤을 때 벽돌이 한꺼번에 내려오는 거리(줄 두 개)와 그 빠르기(px/s) */
export const MISS_DROP = CELL_HEIGHT * 2;
export const DROP_SPEED = 56;
/** 새 공이 막대 위에 놓였다가 저절로 떠나기까지의 시간(초) */
export const SERVE_SECONDS = 0.9;

// ───────── 벽돌 ─────────

/** plain: 한 번에 깨진다, sturdy: 두 번 맞아야 깨진다, gift: 깨면 공이 하나 더 나온다 */
export type BrickKind = 'plain' | 'sturdy' | 'gift';

export interface Brick {
  kind: BrickKind;
  /** 깨지기까지 더 맞아야 하는 횟수 */
  hits: number;
}

export interface Row {
  /** 줄마다 다른 번호. 0부터 만들어진 차례대로 붙는다. 화면이 줄을 알아보고 색을 정하는 데 쓴다. */
  id: number;
  /** 줄의 윗변 높이. 천장 위에서 들어오는 동안에는 0보다 작다. */
  y: number;
  /** 왼쪽부터 COLS칸. 빈칸은 null이다. */
  cells: ReadonlyArray<Brick | null>;
}

/** 처음에 판에 놓여 있는 줄의 수 */
export const START_ROWS = 7;

/** 한 줄에서 벽돌이 차 있는 칸의 비율: 처음에는 듬성듬성하고 줄이 거듭될수록 빽빽해진다. */
export const DENSITY_START = 0.6;
export const DENSITY_MAX = 0.9;
/** 이 줄째에 DENSITY_MAX에 닿는다. */
export const DENSITY_FULL_ROW = 40;

export function rowDensity(index: number): number {
  const ratio = Math.min(1, Math.max(0, index) / DENSITY_FULL_ROW);
  return DENSITY_START + (DENSITY_MAX - DENSITY_START) * ratio;
}

/** 단단한 벽돌은 이 줄부터 섞이기 시작해서, STURDY_FULL_ROW째 줄에 STURDY_MAX의 비율에 닿는다. */
export const STURDY_FROM_ROW = 8;
export const STURDY_FULL_ROW = 48;
export const STURDY_MAX = 0.4;

export function sturdyChance(index: number): number {
  if (index < STURDY_FROM_ROW) return 0;
  const ratio = Math.min(1, (index - STURDY_FROM_ROW) / (STURDY_FULL_ROW - STURDY_FROM_ROW));
  return STURDY_MAX * ratio;
}

/** 공이 든 벽돌은 이만큼의 줄마다 하나씩 나온다. 첫 번째는 GIFT_FIRST_ROW째 줄이다. */
export const GIFT_EVERY = 6;
export const GIFT_FIRST_ROW = 3;

export function hasGift(index: number): boolean {
  return index >= GIFT_FIRST_ROW && (index - GIFT_FIRST_ROW) % GIFT_EVERY === 0;
}

/** 줄에 벽돌이 적어도 이만큼은 있다. */
export const MIN_ROW_BRICKS = 3;
/** 좌우가 같은 모양으로 나오는 줄의 비율. 판이 가지런해 보인다. */
const MIRROR_CHANCE = 0.6;

function brickOf(kind: BrickKind): Brick {
  return { kind, hits: kind === 'sturdy' ? 2 : 1 };
}

/**
 * index번째 줄(0부터)의 벽돌들. 줄이 거듭될수록 빽빽해지고 단단한 벽돌이 섞인다.
 * 어느 칸이 차는지는 random이 정하고, 좌우가 같은 모양으로 나올 때가 많다.
 */
export function makeCells(index: number, random: () => number): Array<Brick | null> {
  const density = rowDensity(index);
  const filled = Array.from({ length: COLS }, () => random() < density);
  if (random() < MIRROR_CHANCE) {
    for (let col = 0; col < COLS / 2; col += 1) filled[COLS - 1 - col] = filled[col];
  }
  // 너무 빈 줄은 빈칸을 골라 채운다.
  while (filled.filter(Boolean).length < MIN_ROW_BRICKS) {
    const empty = filled.flatMap((full, col) => (full ? [] : [col]));
    filled[empty[Math.floor(random() * empty.length)]] = true;
  }

  const sturdy = sturdyChance(index);
  const cells = filled.map((full) => (full ? brickOf(random() < sturdy ? 'sturdy' : 'plain') : null));
  if (hasGift(index)) {
    const taken = cells.flatMap((cell, col) => (cell ? [col] : []));
    cells[taken[Math.floor(random() * taken.length)]] = brickOf('gift');
  }
  return cells;
}

/** 칸 col의 왼쪽 변 */
export function cellLeft(col: number): number {
  return FIELD_LEFT + col * CELL_WIDTH;
}

// ───────── 점수 ─────────

/**
 * 공 하나가 막대에 닿지 않고 이어서 깬 n번째 벽돌의 점수. 이어 갈수록 하나씩 커지고 STREAK_CAP에서 멈춘다.
 * 공을 벽돌 사이나 위쪽으로 보내 오래 튀게 할수록 점수가 커진다.
 */
export const STREAK_CAP = 5;

export function brickPoints(streak: number): number {
  return Math.min(STREAK_CAP, Math.max(1, Math.floor(streak)));
}

/** 공이 이미 MAX_BALLS개일 때 공이 든 벽돌을 깨면 공 대신 받는 점수 */
export const GIFT_POINTS = 5;

// ───────── 한 판 ─────────

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 막대에 마지막으로 닿은 뒤 이 공이 깬 벽돌의 수 */
  streak: number;
}

/** serve: 새 공이 막대 위에 놓여 떠나기를 기다리는 중, play: 공이 날아다니는 중, over: 벽돌이 바닥 선에 닿아 끝남 */
export type Phase = 'serve' | 'play' | 'over';

export interface Game {
  phase: Phase;
  /** 판에 있는 줄. 맨 앞이 가장 나중에 들어온(가장 위의) 줄이다. */
  rows: readonly Row[];
  /** 지금까지 만든 줄의 수. 다음 줄의 번호다. */
  rowsMade: number;
  /** 날아다니는 공. serve 동안에는 비어 있고, 막대 위에 놓인 공은 heldBall()이 알려 준다. */
  balls: readonly Ball[];
  /** 막대 가운데의 가로 위치 */
  paddleX: number;
  /** serve일 때 공이 떠나기까지 남은 시간(초) */
  serveLeft: number;
  /** 공을 놓친 벌로 벽돌이 더 내려와야 하는 거리 */
  drop: number;
  /** 공이 날아다닌 시간(초). 속도를 정한다. */
  elapsed: number;
  score: number;
  /** 깬 벽돌의 수 */
  broken: number;
  /** 공 하나가 막대에 닿지 않고 이어서 깬 가장 많은 수 */
  bestStreak: number;
  /** 공을 모두 놓친 횟수 */
  misses: number;
}

export type GameEvent =
  /** 공이 벽이나 천장에 튀었다 */
  | { kind: 'wall'; x: number; y: number }
  /** 공이 막대에 튀었다. offset은 맞은 자리(-1~1) */
  | { kind: 'paddle'; x: number; offset: number }
  /** 단단한 벽돌이 맞아서 금이 갔다 */
  | { kind: 'crack'; row: number; col: number; x: number; y: number }
  /** 벽돌이 깨졌다. x, y는 벽돌의 한가운데, streak는 그 공이 이어서 깬 수 */
  | { kind: 'break'; row: number; col: number; x: number; y: number; brick: BrickKind; points: number; streak: number }
  /** 공이 든 벽돌에서 공이 나왔다(extra가 false면 공이 가득 차서 점수로 받았다) */
  | { kind: 'gift'; x: number; y: number; extra: boolean; points: number }
  /** 공 하나가 아래로 떨어졌다. last면 남은 공이 없어서 벽돌이 내려온다 */
  | { kind: 'lost'; x: number; last: boolean }
  /** 막대 위의 공이 떠났다 */
  | { kind: 'serve' }
  /** 벽돌이 바닥 선에 닿았다 */
  | { kind: 'over' };

function rowAt(id: number, y: number, random: () => number): Row {
  return { id, y, cells: makeCells(id, random) };
}

/** 새 판: 줄 START_ROWS개가 놓여 있고, 그 위에 다음 줄이 천장 밖에서 기다린다. 공은 막대 위에 있다. */
export function newGame(random: () => number): Game {
  const rows: Row[] = [];
  for (let index = 0; index <= START_ROWS; index += 1) {
    // 먼저 만든 줄이 가장 아래에 놓인다.
    rows.unshift(rowAt(index, (START_ROWS - 1 - index) * CELL_HEIGHT, random));
  }
  return {
    phase: 'serve',
    rows,
    rowsMade: START_ROWS + 1,
    balls: [],
    paddleX: (FIELD_LEFT + FIELD_RIGHT) / 2,
    serveLeft: 0,
    drop: 0,
    elapsed: 0,
    score: 0,
    broken: 0,
    bestStreak: 0,
    misses: 0,
  };
}

export function isOver(game: Game): boolean {
  return game.phase === 'over';
}

/** 막대 위에 놓인 공의 자리. serve가 아니면 null. */
export function heldBall(game: Game): { x: number; y: number } | null {
  if (game.phase !== 'serve') return null;
  return { x: game.paddleX, y: PADDLE_Y - BALL_RADIUS };
}

/** 가장 아래에 있는 벽돌의 아랫변. 벽돌이 하나도 없으면 0. 이 값이 LIMIT_Y에 닿으면 끝난다. */
export function frontY(game: Pick<Game, 'rows'>): number {
  let front = 0;
  for (const row of game.rows) {
    if (row.cells.some((cell) => cell !== null)) front = Math.max(front, row.y + CELL_HEIGHT);
  }
  return front;
}

/** 판에 남은 벽돌의 수 */
export function brickCount(game: Pick<Game, 'rows'>): number {
  return game.rows.reduce((sum, row) => sum + row.cells.filter((cell) => cell !== null).length, 0);
}

/**
 * 아직 출발하지 않은 판에서 막대만 옮긴다. 첫 조작을 기다리는 동안 쓴다.
 * 공은 막대 위에 놓인 채 따라가고, 벽돌도 시계도 움직이지 않는다.
 */
export function aim(game: Game, dt: number, targetX: number): Game {
  if (game.phase === 'over') return game;
  return { ...game, paddleX: steerPaddle(game.paddleX, targetX, dt) };
}

/** 한 번에 공을 옮기는 가장 긴 거리. 공의 반지름보다 짧아서 벽돌이나 막대를 건너뛰지 않는다. */
const MAX_STEP = 2;
/** 막대를 떠나는 공이 기우는 각도의 범위(라디안). 곧게 오르지는 않는다. */
const SERVE_ANGLE = { min: 0.18, max: 0.5 } as const;

/** 움직이는 동안만 쓰는, 고쳐 쓸 수 있는 판 */
interface Draft extends Omit<Game, 'rows' | 'balls'> {
  rows: Array<{ id: number; y: number; cells: Array<Brick | null> }>;
  balls: Ball[];
}

function draftOf(game: Game): Draft {
  return {
    ...game,
    rows: game.rows.map((row) => ({ id: row.id, y: row.y, cells: row.cells.map((cell) => (cell ? { ...cell } : null)) })),
    balls: game.balls.map((ball) => ({ ...ball })),
  };
}

/** 공의 빠르기를 speed로 맞추고, 너무 옆으로 누웠으면 세로 빠르기를 채워 준다. */
function setSpeed(ball: Ball, speed: number): void {
  const length = Math.hypot(ball.vx, ball.vy) || 1;
  let vx = (ball.vx / length) * speed;
  let vy = (ball.vy / length) * speed;
  const floor = speed * MIN_VERTICAL_RATIO;
  if (Math.abs(vy) < floor) {
    vy = (vy > 0 ? 1 : -1) * floor;
    vx = (vx < 0 ? -1 : 1) * Math.sqrt(speed * speed - floor * floor);
  }
  ball.vx = vx;
  ball.vy = vy;
}

/** 공과 겹친 벽돌 가운데 가장 깊이 겹친 것 */
interface Touch {
  row: Draft['rows'][number];
  col: number;
  /** 벽돌에서 공의 중심에 가장 가까운 점에서 중심까지 */
  dx: number;
  dy: number;
  distance: number;
}

function touchedBrick(game: Draft, ball: Ball): Touch | null {
  let best: Touch | null = null;
  const firstCol = Math.max(0, Math.floor((ball.x - BALL_RADIUS - FIELD_LEFT) / CELL_WIDTH));
  const lastCol = Math.min(COLS - 1, Math.floor((ball.x + BALL_RADIUS - FIELD_LEFT) / CELL_WIDTH));
  for (const row of game.rows) {
    if (ball.y + BALL_RADIUS <= row.y || ball.y - BALL_RADIUS >= row.y + CELL_HEIGHT) continue;
    for (let col = firstCol; col <= lastCol; col += 1) {
      if (!row.cells[col]) continue;
      const left = cellLeft(col);
      const nearX = Math.min(left + CELL_WIDTH, Math.max(left, ball.x));
      const nearY = Math.min(row.y + CELL_HEIGHT, Math.max(row.y, ball.y));
      const dx = ball.x - nearX;
      const dy = ball.y - nearY;
      const distance = Math.hypot(dx, dy);
      if (distance >= BALL_RADIUS) continue;
      if (!best || distance < best.distance) best = { row, col, dx, dy, distance };
    }
  }
  return best;
}

/** 벽돌에 닿은 공을 튕기고 벽돌 밖으로 밀어낸다. */
function bounceOff(ball: Ball, touch: Touch): void {
  const { dx, dy, distance } = touch;
  if (distance === 0) {
    // 공의 중심이 벽돌 안에 있다(벽돌이 내려오며 공을 덮은 때). 가까운 위아래 변으로 내보낸다.
    const below = ball.y - touch.row.y > CELL_HEIGHT / 2;
    ball.y = below ? touch.row.y + CELL_HEIGHT + BALL_RADIUS : touch.row.y - BALL_RADIUS;
    ball.vy = (below ? 1 : -1) * Math.abs(ball.vy);
    return;
  }
  // 닿은 쪽의 축만 뒤집는다. 이미 멀어지고 있는 축은 그대로 둔다.
  if (Math.abs(dx) > Math.abs(dy)) {
    if (ball.vx * dx < 0) ball.vx = -ball.vx;
    else if (ball.vy * dy < 0) ball.vy = -ball.vy;
  } else if (ball.vy * dy < 0) ball.vy = -ball.vy;
  else if (ball.vx * dx < 0) ball.vx = -ball.vx;
  const push = BALL_RADIUS / distance;
  ball.x += dx * (push - 1);
  ball.y += dy * (push - 1);
}

/** 공 하나를 seconds초만큼 옮긴다. 떨어져서 판을 벗어났으면 false. */
function moveBall(game: Draft, ball: Ball, seconds: number, events: GameEvent[]): boolean {
  const steps = Math.max(1, Math.ceil((Math.hypot(ball.vx, ball.vy) * seconds) / MAX_STEP));
  const h = seconds / steps;
  for (let step = 0; step < steps; step += 1) {
    ball.x += ball.vx * h;
    ball.y += ball.vy * h;

    let bumped = false;
    if (ball.x < FIELD_LEFT + BALL_RADIUS) {
      ball.x = FIELD_LEFT + BALL_RADIUS;
      ball.vx = Math.abs(ball.vx);
      bumped = true;
    } else if (ball.x > FIELD_RIGHT - BALL_RADIUS) {
      ball.x = FIELD_RIGHT - BALL_RADIUS;
      ball.vx = -Math.abs(ball.vx);
      bumped = true;
    }
    if (ball.y < BALL_RADIUS) {
      ball.y = BALL_RADIUS;
      ball.vy = Math.abs(ball.vy);
      bumped = true;
    }
    if (bumped) events.push({ kind: 'wall', x: ball.x, y: ball.y });

    // 막대: 내려오던 공이 윗면에 닿았을 때만 튄다. 이미 막대 옆을 지나 내려간 공은 받지 못한다.
    if (
      ball.vy > 0 &&
      ball.y + BALL_RADIUS >= PADDLE_Y &&
      ball.y <= PADDLE_Y + PADDLE_HEIGHT / 2 &&
      Math.abs(ball.x - game.paddleX) <= PADDLE_HALF + BALL_RADIUS
    ) {
      const offset = Math.min(1, Math.max(-1, (ball.x - game.paddleX) / PADDLE_HALF));
      const speed = Math.hypot(ball.vx, ball.vy);
      const angle = bounceAngle(offset);
      ball.vx = Math.sin(angle) * speed;
      ball.vy = -Math.cos(angle) * speed;
      ball.y = PADDLE_Y - BALL_RADIUS;
      ball.streak = 0;
      events.push({ kind: 'paddle', x: ball.x, offset });
      continue;
    }

    const touch = touchedBrick(game, ball);
    if (touch) {
      bounceOff(ball, touch);
      hitBrick(game, ball, touch, events);
    }

    if (ball.y - BALL_RADIUS > FIELD_HEIGHT) return false;
  }
  return true;
}

/** 공에 맞은 벽돌을 한 번 깎는다. 다 깎였으면 깨지고 점수가 붙는다. */
function hitBrick(game: Draft, ball: Ball, touch: Touch, events: GameEvent[]): void {
  const brick = touch.row.cells[touch.col];
  if (!brick) return;
  const x = cellLeft(touch.col) + CELL_WIDTH / 2;
  const y = touch.row.y + CELL_HEIGHT / 2;
  brick.hits -= 1;
  if (brick.hits > 0) {
    events.push({ kind: 'crack', row: touch.row.id, col: touch.col, x, y });
    return;
  }

  touch.row.cells[touch.col] = null;
  ball.streak += 1;
  const points = brickPoints(ball.streak);
  game.score += points;
  game.broken += 1;
  game.bestStreak = Math.max(game.bestStreak, ball.streak);
  events.push({ kind: 'break', row: touch.row.id, col: touch.col, x, y, brick: brick.kind, points, streak: ball.streak });

  if (brick.kind !== 'gift') return;
  if (game.balls.length >= MAX_BALLS) {
    game.score += GIFT_POINTS;
    events.push({ kind: 'gift', x, y, extra: false, points: GIFT_POINTS });
    return;
  }
  // 새 공은 맞힌 공과 반대쪽으로, 위를 향해 떠난다. 두 공이 한꺼번에 떨어져서 하나를 놓치는 일을 줄인다.
  game.balls.push({ x, y, vx: -ball.vx, vy: -Math.abs(ball.vy), streak: 0 });
  events.push({ kind: 'gift', x, y, extra: true, points: 0 });
}

/**
 * dt초 뒤의 판과 그동안 일어난 일. targetX는 막대가 가려는 곳(손가락의 가로 위치)이다.
 * 받은 판은 고치지 않고 새 판을 돌려준다. 끝난 판은 그대로 돌려준다.
 */
export function advance(
  before: Game,
  dt: number,
  targetX: number,
  random: () => number,
): { game: Game; events: GameEvent[] } {
  if (before.phase === 'over' || !(dt > 0)) return { game: before, events: [] };
  const game = draftOf(before);
  const events: GameEvent[] = [];
  game.paddleX = steerPaddle(game.paddleX, targetX, dt);

  // 벽돌이 내려온다: 공을 놓친 벌이 남아 있으면 그것부터 빠르게, 아니면 공이 나는 동안 천천히.
  let fall = 0;
  if (game.drop > 0) {
    fall = Math.min(game.drop, DROP_SPEED * dt);
    game.drop -= fall;
  } else if (game.phase === 'play') {
    fall = creepSpeed(game.elapsed) * dt;
  }
  if (fall > 0) {
    for (const row of game.rows) row.y += fall;
    // 맨 위 줄이 천장 안으로 다 들어오면 그 위에 다음 줄을 댄다.
    while (game.rows[0].y >= 0) {
      const made = rowAt(game.rowsMade, game.rows[0].y - CELL_HEIGHT, random);
      game.rows.unshift({ ...made, cells: [...made.cells] });
      game.rowsMade += 1;
    }
  }

  if (frontY(game) >= LIMIT_Y) {
    game.phase = 'over';
    events.push({ kind: 'over' });
    return { game, events };
  }

  if (game.phase === 'serve') {
    if (game.drop <= 0) {
      game.serveLeft -= dt;
      if (game.serveLeft <= 0) {
        const tilt = SERVE_ANGLE.min + (SERVE_ANGLE.max - SERVE_ANGLE.min) * random();
        const angle = random() < 0.5 ? -tilt : tilt;
        const speed = ballSpeed(game.elapsed);
        game.balls.push({
          x: game.paddleX,
          y: PADDLE_Y - BALL_RADIUS,
          vx: Math.sin(angle) * speed,
          vy: -Math.cos(angle) * speed,
          streak: 0,
        });
        game.phase = 'play';
        game.serveLeft = 0;
        events.push({ kind: 'serve' });
      }
    }
    return { game, events };
  }

  game.elapsed += dt;
  const speed = ballSpeed(game.elapsed);
  // 도는 동안 새 공이 생길 수 있으므로(공이 든 벽돌) 지금 있는 공만 옮긴다.
  const flying = [...game.balls];
  for (const ball of flying) {
    setSpeed(ball, speed);
    if (moveBall(game, ball, dt, events)) {
      setSpeed(ball, speed);
      continue;
    }
    game.balls.splice(game.balls.indexOf(ball), 1);
    events.push({ kind: 'lost', x: ball.x, last: game.balls.length === 0 });
  }
  // 다 깨져서 빈 줄은 치운다. 맨 위 줄은 다음 줄을 대는 기준이라 남긴다.
  game.rows = game.rows.filter((row, index) => index === 0 || row.cells.some((cell) => cell !== null));

  if (game.balls.length === 0) {
    game.misses += 1;
    game.drop += MISS_DROP;
    game.phase = 'serve';
    game.serveLeft = SERVE_SECONDS;
  }
  return { game, events };
}

/** 버틴 시간을 "45초", "1분 5초"처럼 적는다. */
export function formatSeconds(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  if (whole < 60) return `${whole}초`;
  return `${Math.floor(whole / 60)}분 ${whole % 60}초`;
}
