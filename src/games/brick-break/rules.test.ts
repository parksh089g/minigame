import { describe, expect, it } from 'vitest';
import { GAME_WIDTH } from '../../config';
import { getGame } from '../registry';
import {
  advance,
  aim,
  BALL_FULL_SECONDS,
  BALL_MAX_SPEED,
  BALL_RADIUS,
  BALL_START_SPEED,
  ballSpeed,
  bounceAngle,
  brickCount,
  brickPoints,
  CELL_HEIGHT,
  CELL_WIDTH,
  cellLeft,
  clampPaddle,
  COLS,
  CREEP_FULL_SECONDS,
  CREEP_MAX,
  CREEP_START,
  CREEP_TOP,
  creepSpeed,
  DENSITY_MAX,
  DENSITY_START,
  DROP_SPEED,
  FIELD_HEIGHT,
  FIELD_LEFT,
  FIELD_RIGHT,
  formatSeconds,
  frontY,
  GIFT_EVERY,
  GIFT_FIRST_ROW,
  GIFT_POINTS,
  hasGift,
  heldBall,
  isOver,
  LIMIT_ROWS,
  LIMIT_Y,
  makeCells,
  MAX_BALLS,
  MAX_BOUNCE_ANGLE,
  MIN_BOUNCE_ANGLE,
  MIN_ROW_BRICKS,
  MIN_VERTICAL_RATIO,
  MISS_DROP,
  newGame,
  PADDLE_HALF,
  PADDLE_HEIGHT,
  PADDLE_Y,
  rowDensity,
  SERVE_SECONDS,
  START_ROWS,
  steerPaddle,
  STREAK_CAP,
  STURDY_FROM_ROW,
  STURDY_MAX,
  sturdyChance,
  type Ball,
  type Brick,
  type BrickKind,
  type Game,
  type GameEvent,
  visibleMiddle,
  type Row,
} from './rules';

/** 시드가 같으면 같은 수열이 나오는 난수(mulberry32). */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FRAME = 1 / 60;
const CENTER = (FIELD_LEFT + FIELD_RIGHT) / 2;

function brick(kind: BrickKind): Brick {
  return { kind, hits: kind === 'sturdy' ? 2 : 1 };
}

/** 벽돌이 col들에만 놓인 줄 */
function rowWith(id: number, y: number, bricks: Partial<Record<number, BrickKind>> = {}): Row {
  return {
    id,
    y,
    cells: Array.from({ length: COLS }, (_, col) => (bricks[col] ? brick(bricks[col]) : null)),
  };
}

function ballAt(x: number, y: number, vx: number, vy: number, streak = 0): Ball {
  return { x, y, vx, vy, streak };
}

/** 공이 날아다니는 판. 맨 위에는 천장 밖에서 기다리는 빈 줄을 하나 둔다(advance가 줄을 대는 기준). */
function playing(balls: Ball[], rows: Row[] = [], more: Partial<Game> = {}): Game {
  return {
    phase: 'play',
    rows: [rowWith(100, -CELL_HEIGHT), ...rows],
    rowsMade: 101,
    balls,
    paddleX: CENTER,
    serveLeft: 0,
    drop: 0,
    elapsed: 0,
    score: 0,
    broken: 0,
    bestStreak: 0,
    misses: 0,
    ...more,
  };
}

/** seconds초 동안 판을 굴리고, 그동안 일어난 일을 모은다. until이 참이 되면 멈춘다. */
function run(
  start: Game,
  seconds: number,
  options: { target?: (game: Game) => number; until?: (game: Game, events: GameEvent[]) => boolean; random?: () => number } = {},
): { game: Game; events: GameEvent[] } {
  const random = options.random ?? seeded(1);
  const all: GameEvent[] = [];
  let game = start;
  for (let t = 0; t < seconds; t += FRAME) {
    const result = advance(game, FRAME, options.target?.(game) ?? game.paddleX, random);
    game = result.game;
    all.push(...result.events);
    if (options.until?.(game, all)) break;
  }
  return { game, events: all };
}

const kinds = (events: GameEvent[]): string[] => events.map((event) => event.kind);

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

/** 벽돌이 없다고 치고, 내려오는 공이 막대 높이에 닿을 때의 가로 위치 */
function landingX(ball: Ball): number {
  const low = FIELD_LEFT + BALL_RADIUS;
  const span = FIELD_RIGHT - BALL_RADIUS - low;
  const x = ball.x + (ball.vx * (PADDLE_Y - BALL_RADIUS - ball.y)) / ball.vy;
  const folded = (((x - low) % (2 * span)) + 2 * span) % (2 * span);
  return low + (folded > span ? 2 * span - folded : folded);
}

/**
 * 흉내 내는 사람: 내려오는 공이 떨어질 자리로 막대를 옮긴다.
 * noise는 막대의 어디로 받을지가 흔들리는 폭(막대 절반 너비의 배수, 1을 넘으면 가끔 놓친다),
 * reach는 손이 움직이는 가장 빠른 속도(px/s)다.
 */
function botPlay(seed: number, bot: { noise: number; reach: number }, maxSeconds = 900): Game {
  const random = seeded(seed);
  const wobble = seeded(seed * 7 + 1);
  let game = newGame(random);
  let finger = game.paddleX;
  let target = finger;
  let offset = 0;
  let falling = false;
  for (let t = 0; t < maxSeconds && !isOver(game); t += FRAME) {
    const down = game.balls.filter((ball) => ball.vy > 0).sort((a, b) => b.y - a.y)[0];
    if (down) {
      if (!falling) offset = (wobble() * 2 - 1) * bot.noise * PADDLE_HALF;
      target = landingX(down) + offset;
    } else if (game.balls[0]) {
      target = game.balls[0].x;
    }
    falling = down !== undefined;
    const step = bot.reach * FRAME;
    finger += Math.max(-step, Math.min(step, target - finger));
    game = advance(game, FRAME, finger, random).game;
  }
  return game;
}

const SEEDS = Array.from({ length: 12 }, (_, index) => index + 1);
const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

describe('벽돌 깨기: 판의 크기', () => {
  it('판은 화면 안에 있고 칸 여덟 개가 벽 사이를 꼭 채운다', () => {
    expect(FIELD_LEFT).toBeGreaterThan(0);
    expect(FIELD_RIGHT).toBeLessThan(GAME_WIDTH);
    expect(cellLeft(0)).toBe(FIELD_LEFT);
    expect(cellLeft(COLS)).toBeCloseTo(FIELD_RIGHT);
    expect(CELL_WIDTH * COLS).toBeCloseTo(FIELD_RIGHT - FIELD_LEFT);
  });

  it('바닥 선, 막대, 판의 아래 끝이 차례로 놓인다', () => {
    expect(LIMIT_Y).toBe(LIMIT_ROWS * CELL_HEIGHT);
    // 바닥 선 바로 위의 벽돌과 막대 사이로 공이 넉넉히 지나간다.
    expect(PADDLE_Y - LIMIT_Y).toBeGreaterThan(BALL_RADIUS * 6);
    expect(FIELD_HEIGHT).toBeGreaterThan(PADDLE_Y + PADDLE_HEIGHT);
    // 가장 짧은 화면(400)에서도 HUD(56) 아래에 판이 다 들어가고 손가락 둘 자리가 남는다.
    expect(FIELD_HEIGHT).toBeLessThanOrEqual(400 - 56 - 44);
  });
});

describe('벽돌 깨기: 막대', () => {
  it('막대는 벽을 넘지 않는다', () => {
    expect(clampPaddle(-50)).toBe(FIELD_LEFT + PADDLE_HALF);
    expect(clampPaddle(999)).toBe(FIELD_RIGHT - PADDLE_HALF);
    expect(clampPaddle(CENTER)).toBe(CENTER);
  });

  it('손가락 쪽으로 다가가고, 지나치지 않는다', () => {
    const after = steerPaddle(100, 160, FRAME);
    expect(after).toBeGreaterThan(100);
    expect(after).toBeLessThan(160);
    expect(steerPaddle(100, 160, 1)).toBeCloseTo(160, 3);
    expect(steerPaddle(100, 160, 0)).toBe(100);
    // 0.1초면 거의 다 따라온다.
    expect(Math.abs(steerPaddle(100, 160, 0.1) - 160)).toBeLessThan(4);
  });

  it('끝에 맞을수록 그쪽으로 눕고, 가운데에 맞아도 곧게 오르지는 않는다', () => {
    expect(bounceAngle(1)).toBe(MAX_BOUNCE_ANGLE);
    expect(bounceAngle(-1)).toBe(-MAX_BOUNCE_ANGLE);
    expect(bounceAngle(5)).toBe(MAX_BOUNCE_ANGLE);
    expect(bounceAngle(0.5)).toBeGreaterThan(bounceAngle(0.2));
    expect(bounceAngle(0.2)).toBeGreaterThan(bounceAngle(0.01));
    // 가운데 가까이에 맞아도 MIN_BOUNCE_ANGLE(10도쯤)만큼은 기운다. 곧게 오르내리며 한 열만 깨지 않는다.
    expect(MIN_BOUNCE_ANGLE).toBeGreaterThan(0.15);
    expect(bounceAngle(0.01)).toBeGreaterThanOrEqual(MIN_BOUNCE_ANGLE);
    expect(bounceAngle(-0.01)).toBeLessThanOrEqual(-MIN_BOUNCE_ANGLE);
    // 한가운데에 맞으면 오던 쪽으로 계속 간다. 곧게 내려온 공은 오른쪽으로 간다.
    expect(bounceAngle(0, 80)).toBe(MIN_BOUNCE_ANGLE);
    expect(bounceAngle(0, -80)).toBe(-MIN_BOUNCE_ANGLE);
    expect(bounceAngle(0)).toBe(MIN_BOUNCE_ANGLE);
    // 가장 누운 공도 세로 빠르기가 MIN_VERTICAL_RATIO보다 넉넉히 남는다.
    expect(Math.cos(MAX_BOUNCE_ANGLE)).toBeGreaterThan(MIN_VERTICAL_RATIO);
  });
});

describe('벽돌 깨기: 속도', () => {
  it('공은 버틸수록 빨라지다가 멈춘다', () => {
    expect(ballSpeed(0)).toBe(BALL_START_SPEED);
    expect(ballSpeed(BALL_FULL_SECONDS)).toBe(BALL_MAX_SPEED);
    expect(ballSpeed(BALL_FULL_SECONDS * 3)).toBe(BALL_MAX_SPEED);
    expect(ballSpeed(-5)).toBe(BALL_START_SPEED);
    for (let t = 0; t < BALL_FULL_SECONDS; t += 10) expect(ballSpeed(t + 10)).toBeGreaterThan(ballSpeed(t));
  });

  it('벽돌은 버틸수록 빨리 내려오고, CREEP_MAX를 지나서도 조금씩 더 빨라지다가 멈춘다', () => {
    expect(creepSpeed(0)).toBe(CREEP_START);
    expect(creepSpeed(CREEP_FULL_SECONDS)).toBeCloseTo(CREEP_MAX);
    for (let t = 0; t < CREEP_FULL_SECONDS + 100; t += 10) {
      expect(creepSpeed(t + 10)).toBeGreaterThan(creepSpeed(t));
    }
    expect(creepSpeed(100_000)).toBe(CREEP_TOP);
    // 처음에는 한 줄이 내려오는 데 8초가 넘게 걸린다.
    expect(CELL_HEIGHT / creepSpeed(0)).toBeGreaterThan(8);
  });
});

describe('벽돌 깨기: 줄 만들기', () => {
  it('줄이 거듭될수록 빽빽해지고 단단한 벽돌이 늘어난다', () => {
    expect(rowDensity(0)).toBe(DENSITY_START);
    expect(rowDensity(1000)).toBe(DENSITY_MAX);
    expect(rowDensity(20)).toBeGreaterThan(rowDensity(5));
    expect(sturdyChance(0)).toBe(0);
    expect(sturdyChance(STURDY_FROM_ROW - 1)).toBe(0);
    expect(sturdyChance(STURDY_FROM_ROW + 10)).toBeGreaterThan(0);
    expect(sturdyChance(1000)).toBe(STURDY_MAX);
  });

  it('공이 든 벽돌은 정해진 줄마다 하나씩 나온다', () => {
    expect(hasGift(0)).toBe(false);
    expect(hasGift(GIFT_FIRST_ROW)).toBe(true);
    expect(hasGift(GIFT_FIRST_ROW + 1)).toBe(false);
    expect(hasGift(GIFT_FIRST_ROW + GIFT_EVERY)).toBe(true);
    // 처음 판에 놓인 줄 가운데 하나에 들어 있어서, 첫 판부터 볼 수 있다.
    expect(GIFT_FIRST_ROW).toBeLessThan(START_ROWS);
  });

  it('어느 줄이든 칸 수가 맞고, 벽돌이 너무 적지 않고, 종류에 맞게 맞아야 깨진다', () => {
    const random = seeded(7);
    let sturdy = 0;
    for (let index = 0; index < 300; index += 1) {
      const cells = makeCells(index, random);
      const bricks = cells.filter((cell): cell is Brick => cell !== null);
      expect(cells).toHaveLength(COLS);
      expect(bricks.length).toBeGreaterThanOrEqual(MIN_ROW_BRICKS);
      expect(bricks.filter((cell) => cell.kind === 'gift')).toHaveLength(hasGift(index) ? 1 : 0);
      for (const cell of bricks) expect(cell.hits).toBe(cell.kind === 'sturdy' ? 2 : 1);
      if (index < STURDY_FROM_ROW) expect(bricks.some((cell) => cell.kind === 'sturdy')).toBe(false);
      sturdy += bricks.filter((cell) => cell.kind === 'sturdy').length;
    }
    expect(sturdy).toBeGreaterThan(100);
  });

  it('같은 난수에서는 같은 줄이 나온다', () => {
    expect(makeCells(12, seeded(3))).toEqual(makeCells(12, seeded(3)));
  });
});

describe('벽돌 깨기: 점수', () => {
  it('이어서 깰수록 하나씩 커지고 STREAK_CAP에서 멈춘다', () => {
    expect(brickPoints(1)).toBe(1);
    expect(brickPoints(2)).toBe(2);
    expect(brickPoints(STREAK_CAP)).toBe(STREAK_CAP);
    expect(brickPoints(STREAK_CAP + 10)).toBe(STREAK_CAP);
    expect(brickPoints(0)).toBe(1);
  });
});

describe('벽돌 깨기: 새 판', () => {
  it('줄 START_ROWS개가 천장부터 놓여 있고, 그 위에 다음 줄이 기다린다', () => {
    const game = newGame(seeded(1));
    expect(game.rows).toHaveLength(START_ROWS + 1);
    expect(game.rows[0].y).toBe(-CELL_HEIGHT);
    expect(game.rows.map((row) => row.y)).toEqual(
      Array.from({ length: START_ROWS + 1 }, (_, index) => (index - 1) * CELL_HEIGHT),
    );
    // 먼저 만든 줄이 아래에 있다.
    expect(game.rows.map((row) => row.id)).toEqual(
      Array.from({ length: START_ROWS + 1 }, (_, index) => START_ROWS - index),
    );
    expect(game.rowsMade).toBe(START_ROWS + 1);
    expect(frontY(game)).toBe(START_ROWS * CELL_HEIGHT);
    expect(brickCount(game)).toBeGreaterThanOrEqual((START_ROWS + 1) * MIN_ROW_BRICKS);
  });

  it('공은 막대 위에 놓여 있고 점수는 0이다', () => {
    const game = newGame(seeded(1));
    expect(game.phase).toBe('serve');
    expect(game.balls).toEqual([]);
    expect(heldBall(game)).toEqual({ x: game.paddleX, y: PADDLE_Y - BALL_RADIUS });
    expect(game.score).toBe(0);
    expect(isOver(game)).toBe(false);
  });

  it('출발하기 전에는 막대만 움직이고 공이 따라간다', () => {
    const game = newGame(seeded(1));
    const moved = aim(game, 0.5, 60);
    expect(moved.paddleX).toBeCloseTo(60, 2);
    expect(heldBall(moved)?.x).toBe(moved.paddleX);
    expect(moved.rows).toBe(game.rows);
    expect(moved.elapsed).toBe(0);
    expect(moved.phase).toBe('serve');
  });
});

describe('벽돌 깨기: 공이 떠날 때', () => {
  it('첫 걸음에 공이 막대에서 위로 떠난다. 곧게 오르지는 않는다', () => {
    for (const seed of SEEDS) {
      const { game, events } = advance(newGame(seeded(seed)), FRAME, CENTER, seeded(seed));
      expect(kinds(events)).toEqual(['serve']);
      expect(game.phase).toBe('play');
      expect(heldBall(game)).toBeNull();
      const [ball] = game.balls;
      expect(ball.vy).toBeLessThan(0);
      expect(Math.abs(ball.vx)).toBeGreaterThan(20);
      expect(Math.hypot(ball.vx, ball.vy)).toBeCloseTo(BALL_START_SPEED);
    }
  });
});

describe('벽돌 깨기: 공의 움직임', () => {
  it('벽과 천장에 튀어 판 안에 머문다', () => {
    let game = playing([ballAt(CENTER, 100, -180, -90)]);
    let walls = 0;
    for (let t = 0; t < 1.2; t += FRAME) {
      const result = advance(game, FRAME, CENTER, seeded(1));
      game = result.game;
      walls += result.events.filter((event) => event.kind === 'wall').length;
      const [ball] = game.balls;
      expect(ball.x).toBeGreaterThanOrEqual(FIELD_LEFT + BALL_RADIUS);
      expect(ball.x).toBeLessThanOrEqual(FIELD_RIGHT - BALL_RADIUS);
      expect(ball.y).toBeGreaterThanOrEqual(BALL_RADIUS);
    }
    expect(walls).toBeGreaterThanOrEqual(2);
  });

  it('빠르기는 버틴 시간에 맞춰지고, 옆으로 누운 공도 세로로 움직인다', () => {
    const { game } = advance(playing([ballAt(CENTER, 120, 300, 1)], [], { elapsed: 60 }), FRAME, CENTER, seeded(1));
    const [ball] = game.balls;
    const speed = ballSpeed(game.elapsed);
    expect(Math.hypot(ball.vx, ball.vy)).toBeCloseTo(speed);
    expect(Math.abs(ball.vy)).toBeGreaterThanOrEqual(speed * MIN_VERTICAL_RATIO - 1e-6);
    expect(ball.vx).toBeGreaterThan(0);
  });

  it('막대의 가운데에 맞아도 조금 기울어 오르고, 오른쪽 끝에 맞으면 오른쪽으로 크게 튄다', () => {
    const drop = (x: number): { ball: Ball; events: GameEvent[] } => {
      const start = playing([ballAt(x, PADDLE_Y - 20, 0, 200, 3)]);
      const { game, events } = run(start, 1, { until: (_, all) => kinds(all).includes('paddle') });
      return { ball: game.balls[0], events };
    };
    const middle = drop(CENTER);
    expect(middle.ball.vy).toBeLessThan(0);
    expect(Math.atan2(middle.ball.vx, -middle.ball.vy)).toBeCloseTo(MIN_BOUNCE_ANGLE);
    expect(middle.ball.streak).toBe(0);
    expect(middle.events.at(-1)).toMatchObject({ kind: 'paddle', offset: 0 });

    const right = drop(CENTER + PADDLE_HALF - 2);
    expect(right.ball.vx).toBeGreaterThan(100);
    expect(right.ball.vy).toBeLessThan(0);
    const left = drop(CENTER - PADDLE_HALF + 2);
    expect(left.ball.vx).toBeCloseTo(-right.ball.vx);
  });

  it('막대를 벗어난 공은 떨어져서 사라진다', () => {
    const start = playing([ballAt(CENTER + PADDLE_HALF + BALL_RADIUS + 3, PADDLE_Y - 20, 0, 200)]);
    const { game, events } = run(start, 1, { until: (_, all) => kinds(all).includes('lost') });
    expect(kinds(events)).toEqual(['lost']);
    expect(game.balls).toEqual([]);
  });
});

describe('벽돌 깨기: 벽돌을 맞혔을 때', () => {
  /** 칸 3의 벽돌 바로 아래에서 곧게 올라가는 공 */
  const below = (streak = 0): Ball => ballAt(cellLeft(3) + CELL_WIDTH / 2, 70, 0, -200, streak);

  it('보통 벽돌은 한 번에 깨지고, 공은 아래로 튄다', () => {
    const start = playing([below()], [rowWith(1, 28, { 3: 'plain', 4: 'plain' })]);
    const { game, events } = run(start, 1, { until: (_, all) => all.length > 0 });
    expect(events).toMatchObject([
      { kind: 'break', row: 1, col: 3, x: cellLeft(3) + CELL_WIDTH / 2, brick: 'plain', points: 1, streak: 1 },
    ]);
    // 벽돌의 한가운데를 알려 준다. 그사이 벽돌이 조금 내려왔다.
    const [broke] = events as Array<Extract<GameEvent, { kind: 'break' }>>;
    expect(broke.y).toBeGreaterThan(28 + CELL_HEIGHT / 2);
    expect(broke.y).toBeLessThan(28 + CELL_HEIGHT / 2 + 1);
    expect(game.rows.find((row) => row.id === 1)?.cells[3]).toBeNull();
    expect(game.rows.find((row) => row.id === 1)?.cells[4]).not.toBeNull();
    expect(game.balls[0].vy).toBeGreaterThan(0);
    expect(game.balls[0].y).toBeGreaterThanOrEqual(28 + CELL_HEIGHT + BALL_RADIUS - 1e-6);
    expect(game).toMatchObject({ score: 1, broken: 1, bestStreak: 1 });
  });

  it('옆에서 맞으면 가로로 튄다', () => {
    const ball = ballAt(cellLeft(3) - 12, 28 + CELL_HEIGHT / 2, 200, -70);
    const start = playing([ball], [rowWith(1, 28, { 3: 'plain' })]);
    const { game, events } = run(start, 1, { until: (_, all) => all.length > 0 });
    expect(kinds(events)).toEqual(['break']);
    expect(game.balls[0].vx).toBeLessThan(0);
    expect(game.balls[0].vy).toBeLessThan(0);
  });

  it('단단한 벽돌은 금이 간 뒤에 한 번 더 맞아야 깨진다', () => {
    const start = playing([below()], [rowWith(1, 28, { 3: 'sturdy' })]);
    const first = run(start, 1, { until: (_, all) => all.length > 0 });
    expect(kinds(first.events)).toEqual(['crack']);
    expect(first.game.rows.find((row) => row.id === 1)?.cells[3]).toEqual({ kind: 'sturdy', hits: 1 });
    expect(first.game.score).toBe(0);
    expect(first.game.balls[0].streak).toBe(0);

    const again = { ...first.game, balls: [below()] };
    const second = run(again, 1, { until: (_, all) => all.length > 0 });
    expect(second.events).toMatchObject([{ kind: 'break', brick: 'sturdy', points: 1 }]);
    expect(second.game.score).toBe(1);
  });

  it('막대에 닿지 않고 이어서 깨면 점수가 커지고, 막대에 닿으면 처음으로 돌아간다', () => {
    const start = playing([below(2)], [rowWith(1, 28, { 3: 'plain' })]);
    const { game, events } = run(start, 1, { until: (_, all) => all.length > 0 });
    expect(events).toMatchObject([{ kind: 'break', points: 3, streak: 3 }]);
    expect(game.score).toBe(3);
    expect(game.bestStreak).toBe(3);

    // 깬 공이 막대에 내려와 닿으면 이어 온 수가 0이 된다.
    const after = run(game, 2, { until: (_, all) => kinds(all).includes('paddle') });
    expect(after.game.balls[0].streak).toBe(0);
    expect(after.game.bestStreak).toBe(3);
  });

  it('공이 든 벽돌을 깨면 공이 하나 더 생겨서 위로 떠난다', () => {
    const ball = ballAt(cellLeft(3) + CELL_WIDTH / 2 - 6, 70, 60, -190);
    const start = playing([ball], [rowWith(1, 28, { 3: 'gift' })]);
    const { game, events } = run(start, 1, { until: (_, all) => all.length > 0 });
    expect(events).toMatchObject([
      { kind: 'break', brick: 'gift', points: 1 },
      { kind: 'gift', extra: true, points: 0 },
    ]);
    expect(game.balls).toHaveLength(2);
    const [hitter, extra] = game.balls;
    expect(hitter.vy).toBeGreaterThan(0);
    expect(extra.vy).toBeLessThan(0);
    expect(Math.sign(extra.vx)).toBe(-Math.sign(hitter.vx));
    expect(extra.streak).toBe(0);
    expect(game.score).toBe(1);
  });

  it('공이 이미 가득하면 공 대신 점수를 받는다', () => {
    const others = Array.from({ length: MAX_BALLS - 1 }, (_, index) => ballAt(30 + index * 20, 200, 30, -200));
    const start = playing([below(), ...others], [rowWith(1, 28, { 3: 'gift' })]);
    const { game, events } = run(start, 1, { until: (_, all) => kinds(all).includes('gift') });
    expect(events.filter((event) => event.kind === 'gift')).toMatchObject([
      { kind: 'gift', x: cellLeft(3) + CELL_WIDTH / 2, extra: false, points: GIFT_POINTS },
    ]);
    expect(game.balls).toHaveLength(MAX_BALLS);
    expect(game.score).toBe(1 + GIFT_POINTS);
  });

  it('천장에서 들어오는 중인 벽돌도 깨지고, 깨진 자리와 새 공은 판 안(보이는 부분)에 있다', () => {
    // 줄의 4px만 판 안에 들어와 있다.
    const ball = ballAt(cellLeft(3) + CELL_WIDTH / 2 - 6, 40, 60, -190);
    const start = playing([ball], [], { rows: [rowWith(1, 4 - CELL_HEIGHT, { 3: 'gift' })] });
    const { game, events } = run(start, 1, { until: (_, all) => all.length > 0 && kinds(all).includes('break') });
    const broke = events.find((event) => event.kind === 'break');
    expect(broke).toMatchObject({ kind: 'break', row: 1, col: 3, brick: 'gift' });
    const at = broke as Extract<GameEvent, { kind: 'break' }>;
    expect(at.y).toBeGreaterThan(0);
    expect(at.y).toBeLessThan(5);
    expect(events.find((event) => event.kind === 'gift')).toMatchObject({ extra: true, y: at.y });
    const extra = game.balls[1];
    expect(extra.y).toBeGreaterThanOrEqual(BALL_RADIUS);
    expect(extra.vy).toBeLessThan(0);
  });

  it('판 안에 보이는 부분의 한가운데: 다 들어온 줄은 벽돌의 한가운데, 들어오는 줄은 보이는 만큼의 한가운데', () => {
    expect(visibleMiddle(28)).toBe(28 + CELL_HEIGHT / 2);
    expect(visibleMiddle(0)).toBe(CELL_HEIGHT / 2);
    expect(visibleMiddle(-10)).toBe(2);
    expect(visibleMiddle(-CELL_HEIGHT)).toBe(0);
  });

  it('다 깨진 줄은 치우고, 맨 위에서 기다리는 줄은 남긴다', () => {
    const start = playing([below()], [rowWith(1, 28, { 3: 'plain' })]);
    const { game } = run(start, 1, { until: (_, all) => all.length > 0 });
    expect(game.rows.map((row) => row.id)).toEqual([100]);
  });
});

describe('벽돌 깨기: 벽돌이 내려온다', () => {
  it('공이 나는 동안 천천히 내려오고, 맨 위 줄이 다 들어오면 그 위에 새 줄이 붙는다', () => {
    const start = playing([ballAt(CENTER, 200, 0, -200)], [rowWith(1, 0, { 0: 'plain' })]);
    // 공이 벽돌에 닿지 않게 가운데에서 위아래로만 오가게 한다.
    const { game } = run(start, 3, { target: () => CENTER });
    const lowest = game.rows.find((row) => row.id === 1);
    expect(lowest?.y).toBeGreaterThan(creepSpeed(0) * 2.9);
    expect(lowest?.y).toBeLessThan(creepSpeed(3) * 3.1);
    // 줄 사이에 틈이 없다.
    for (let index = 1; index < game.rows.length; index += 1) {
      if (game.rows[index].id === 1) continue;
      expect(game.rows[index].y - game.rows[index - 1].y).toBeCloseTo(CELL_HEIGHT);
    }
    expect(game.rows[0].y).toBeLessThan(0);
    expect(game.rows[0].y).toBeGreaterThanOrEqual(-CELL_HEIGHT);
  });

  it('새 줄의 번호는 만든 차례대로 붙는다', () => {
    const { game } = run(newGame(seeded(2)), 40, { target: (now) => now.balls[0]?.x ?? now.paddleX, random: seeded(2) });
    const ids = game.rows.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Math.max(...ids)).toBe(game.rowsMade - 1);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    expect(game.rowsMade).toBeGreaterThan(START_ROWS + 3);
  });

  it('공이 막대 위에서 기다리는 동안에는 내려오지 않는다', () => {
    const waiting: Game = { ...newGame(seeded(1)), serveLeft: SERVE_SECONDS };
    const { game } = advance(waiting, SERVE_SECONDS / 2, CENTER, seeded(1));
    expect(game.rows.map((row) => row.y)).toEqual(waiting.rows.map((row) => row.y));
    expect(game.elapsed).toBe(0);
    expect(game.phase).toBe('serve');
  });
});

describe('벽돌 깨기: 공을 놓쳤을 때', () => {
  const falling = (): Ball => ballAt(30, PADDLE_Y + 10, 0, 220);

  it('다른 공이 남아 있으면 벌이 없다', () => {
    const start = playing([falling(), ballAt(CENTER, 100, 0, -200)]);
    const { game, events } = run(start, 0.3, { until: (_, all) => kinds(all).includes('lost') });
    expect(events).toEqual([{ kind: 'lost', x: 30, last: false }]);
    expect(game.balls).toHaveLength(1);
    expect(game).toMatchObject({ phase: 'play', misses: 0, drop: 0 });
  });

  it('마지막 공을 놓치면 벽돌이 두 줄만큼 빠르게 내려온 뒤에 새 공이 떠난다', () => {
    const start = playing([falling()], [rowWith(1, 28, { 0: 'plain' })]);
    const lost = run(start, 0.3, { until: (_, all) => kinds(all).includes('lost') });
    expect(lost.events).toEqual([{ kind: 'lost', x: 30, last: true }]);
    expect(lost.game).toMatchObject({ phase: 'serve', misses: 1, drop: MISS_DROP, serveLeft: SERVE_SECONDS });
    expect(heldBall(lost.game)).not.toBeNull();
    const before = lost.game.rows.find((row) => row.id === 1)!.y;

    // 내려오는 동안에는 공이 떠나지 않는다.
    const dropSeconds = MISS_DROP / DROP_SPEED;
    const dropping = run(lost.game, dropSeconds * 0.5);
    expect(dropping.game.phase).toBe('serve');
    expect(dropping.game.serveLeft).toBe(SERVE_SECONDS);
    expect(dropping.game.rows.find((row) => row.id === 1)!.y).toBeGreaterThan(before + MISS_DROP * 0.4);

    const served = run(lost.game, dropSeconds + SERVE_SECONDS + 0.2, { until: (now) => now.phase === 'play' });
    expect(kinds(served.events)).toEqual(['serve']);
    expect(served.game.rows.find((row) => row.id === 1)!.y).toBeCloseTo(before + MISS_DROP, 1);
    expect(served.game.drop).toBe(0);
    expect(served.game.balls).toHaveLength(1);
    expect(served.game.balls[0].y).toBeLessThanOrEqual(PADDLE_Y - BALL_RADIUS);
  });

  it('공을 놓쳐도 점수와 깬 벽돌의 수는 그대로다', () => {
    const start = playing([falling()], [], { score: 42, broken: 30, bestStreak: 6 });
    const { game } = run(start, 0.3, { until: (now) => now.phase === 'serve' });
    expect(game).toMatchObject({ score: 42, broken: 30, bestStreak: 6 });
  });
});

describe('벽돌 깨기: 끝', () => {
  it('벽돌이 바닥 선에 닿으면 끝난다', () => {
    const start = playing([ballAt(CENTER, 240, 0, -200)], [rowWith(1, LIMIT_Y - CELL_HEIGHT - 0.5, { 0: 'plain' })]);
    expect(frontY(start)).toBeLessThan(LIMIT_Y);
    const { game, events } = run(start, 3, { until: (now) => isOver(now) });
    expect(isOver(game)).toBe(true);
    expect(events.at(-1)).toEqual({ kind: 'over' });
    expect(frontY(game)).toBeGreaterThanOrEqual(LIMIT_Y);
  });

  it('공을 놓쳐서 내려온 벽돌이 선에 닿아도 끝난다', () => {
    const start = playing([ballAt(30, PADDLE_Y + 10, 0, 220)], [rowWith(1, LIMIT_Y - CELL_HEIGHT * 2, { 5: 'plain' })]);
    const { game, events } = run(start, 3, { until: (now) => isOver(now) });
    expect(kinds(events)).toEqual(['lost', 'over']);
    expect(game.misses).toBe(1);
  });

  it('끝난 판은 더 움직이지 않는다', () => {
    const over: Game = { ...newGame(seeded(1)), phase: 'over' };
    expect(advance(over, FRAME, 10, seeded(1))).toEqual({ game: over, events: [] });
    expect(aim(over, FRAME, 10)).toBe(over);
    expect(heldBall(over)).toBeNull();
  });

  it('빈 줄만 있으면 내려온 것으로 치지 않는다', () => {
    expect(frontY({ rows: [rowWith(1, 100)] })).toBe(0);
    expect(brickCount({ rows: [rowWith(1, 100), rowWith(2, 114, { 2: 'plain', 5: 'sturdy' })] })).toBe(2);
  });
});

describe('벽돌 깨기: 판을 고치지 않는다', () => {
  it('advance와 aim은 받은 판을 그대로 두고 새 판을 돌려준다', () => {
    const random = seeded(4);
    let game = deepFreeze(newGame(random));
    for (let step = 0; step < 600; step += 1) {
      const next = advance(game, FRAME, game.balls[0]?.x ?? CENTER, random).game;
      expect(next).not.toBe(game);
      game = deepFreeze(next);
    }
    expect(game.broken).toBeGreaterThan(0);
    expect(() => aim(game, FRAME, 50)).not.toThrow();
  });

  it('시간이 흐르지 않으면 아무 일도 일어나지 않는다', () => {
    const game = newGame(seeded(1));
    expect(advance(game, 0, CENTER, seeded(1))).toEqual({ game, events: [] });
  });
});

describe('벽돌 깨기: 한 판을 해 보면', () => {
  it('공은 언제나 판 안에 있고, 벽돌 속에 들어가지 않고, 정해진 빠르기로 난다', () => {
    for (const seed of SEEDS.slice(0, 4)) {
      const random = seeded(seed);
      let game = newGame(random);
      for (let t = 0; t < 200 && !isOver(game); t += FRAME) {
        const down = game.balls.find((ball) => ball.vy > 0);
        game = advance(game, FRAME, down ? landingX(down) : CENTER, random).game;
        expect(game.balls.length).toBeLessThanOrEqual(MAX_BALLS);
        const speed = ballSpeed(game.elapsed);
        for (const ball of game.balls) {
          expect(ball.x).toBeGreaterThanOrEqual(FIELD_LEFT + BALL_RADIUS - 1e-6);
          expect(ball.x).toBeLessThanOrEqual(FIELD_RIGHT - BALL_RADIUS + 1e-6);
          expect(ball.y).toBeGreaterThanOrEqual(BALL_RADIUS - 1e-6);
          expect(Math.hypot(ball.vx, ball.vy)).toBeCloseTo(speed, 3);
          expect(Math.abs(ball.vy)).toBeGreaterThanOrEqual(speed * MIN_VERTICAL_RATIO - 1e-6);
          const row = game.rows.find((item) => ball.y > item.y && ball.y < item.y + CELL_HEIGHT);
          const col = Math.floor((ball.x - FIELD_LEFT) / CELL_WIDTH);
          expect(row?.cells[col] ?? null, `시드 ${seed}, ${t.toFixed(2)}초`).toBeNull();
        }
      }
    }
  });

  it('공을 한 번도 놓치지 않아도 판은 끝난다', () => {
    for (const seed of SEEDS) {
      const game = botPlay(seed, { noise: 0.7, reach: 2000 });
      expect(isOver(game), `시드 ${seed}`).toBe(true);
      expect(game.elapsed).toBeLessThan(360);
    }
  });

  it('막대를 가만히 두면 금방 끝난다', () => {
    for (const seed of SEEDS) {
      const game = botPlay(seed, { noise: 0, reach: 0 }, 120);
      expect(isOver(game), `시드 ${seed}`).toBe(true);
      expect(game.misses).toBeGreaterThanOrEqual(3);
    }
  });

  it('잘 받는 사람은 한 판에 1분 넘게 버티고, 서툰 사람도 오늘의 도전의 쉬운 목표 근처까지는 간다', () => {
    const targets = getGame('brick-break')!.dailyTargets;
    const skilled = SEEDS.map((seed) => botPlay(seed, { noise: 0.7, reach: 2000 }));
    expect(median(skilled.map((game) => game.elapsed))).toBeGreaterThan(60);
    // 가장 어려운 목표는 잘하는 사람이 보통 넘는 점수이고, 넘지 못하는 판도 있다.
    expect(median(skilled.map((game) => game.score))).toBeGreaterThan(targets[2]);
    expect(Math.min(...skilled.map((game) => game.score))).toBeLessThan(targets[2] * 1.2);

    const clumsy = SEEDS.map((seed) => botPlay(seed, { noise: 1.5, reach: 250 }));
    expect(median(clumsy.map((game) => game.elapsed))).toBeGreaterThan(20);
    expect(median(clumsy.map((game) => game.score))).toBeGreaterThan(targets[0] * 0.6);
    expect(median(clumsy.map((game) => game.score))).toBeLessThan(targets[1]);
  });
});

describe('벽돌 깨기: 버틴 시간 적기', () => {
  it('1분이 안 되면 초만, 넘으면 분과 초를 적는다', () => {
    expect(formatSeconds(0)).toBe('0초');
    expect(formatSeconds(45.9)).toBe('45초');
    expect(formatSeconds(65)).toBe('1분 5초');
    expect(formatSeconds(120)).toBe('2분 0초');
    expect(formatSeconds(-3)).toBe('0초');
  });
});
