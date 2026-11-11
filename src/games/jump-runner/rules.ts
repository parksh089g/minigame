/**
 * 점프 러너의 규칙. 화면과 분리된 순수 함수라서 숫자만 바꿔 밸런스를 조정할 수 있다.
 * 길이는 논리 픽셀, 시간은 초다. 높이는 땅에서 위로 잰다(땅이 0, 위가 +).
 */

// ───────── 속도 ─────────

export const START_SPEED = 130;
export const MAX_SPEED = 230;
/** 1초마다 빨라지는 정도(px/s) */
const SPEED_GAIN = 2.5;

/** 달리는 속도(px/s). t는 달리기 시작한 뒤 지난 시간. 40초쯤에 가장 빨라진다. */
export function runSpeed(t: number): number {
  return Math.min(MAX_SPEED, START_SPEED + SPEED_GAIN * Math.max(0, t));
}

// ───────── 점프 ─────────

export const GRAVITY = 1700;
/** 뛰어오르는 순간의 속도. 끝까지 누르면 약 80px 높이, 0.6초 동안 떠 있는다. */
export const JUMP_VELOCITY = 520;
/** 일찍 손을 떼면 올라가는 속도를 이 값으로 줄여 낮게 뛴다. */
export const JUMP_CUT_VELOCITY = 190;
/** 아무리 짧게 눌러도 이 시간만큼은 끝까지 누른 것처럼 올라간다. 살짝 건드려도 쓸 만한 높이가 나온다. */
export const MIN_JUMP_SECONDS = 0.09;
/** 착지하기 직전에 눌러도 착지하자마자 뛴다. 누른 입력을 기억해 두는 시간. */
export const JUMP_BUFFER_SECONDS = 0.12;

export interface RunnerState {
  /** 발이 땅에서 떨어진 높이. 땅에 있으면 0. */
  y: number;
  /** 세로 속도. 올라갈 때 +. */
  vy: number;
  grounded: boolean;
  /** 이번 점프를 시작한 뒤 지난 시간 */
  airTime: number;
  /** 기억해 둔 점프 입력이 유효한 남은 시간 */
  buffer: number;
}

export interface RunnerInput {
  /** 이번 프레임에 새로 눌렀는지 */
  pressed: boolean;
  /** 지금 누르고 있는지 */
  held: boolean;
}

export type RunnerEvent = 'jump' | 'land' | null;

export function newRunner(): RunnerState {
  return { y: 0, vy: 0, grounded: true, airTime: 0, buffer: 0 };
}

/** 한 프레임만큼 달리는 캐릭터를 움직인다. 받은 상태는 바꾸지 않고 새 상태를 돌려준다. */
export function stepRunner(
  state: RunnerState,
  input: RunnerInput,
  dt: number,
): { state: RunnerState; event: RunnerEvent } {
  let { y, vy, grounded, airTime } = state;
  let buffer = input.pressed ? JUMP_BUFFER_SECONDS : Math.max(0, state.buffer - dt);
  let event: RunnerEvent = null;

  if (grounded && buffer > 0) {
    vy = JUMP_VELOCITY;
    grounded = false;
    airTime = 0;
    buffer = 0;
    event = 'jump';
  }

  if (!grounded) {
    airTime += dt;
    if (!input.held && airTime >= MIN_JUMP_SECONDS && vy > JUMP_CUT_VELOCITY) {
      vy = JUMP_CUT_VELOCITY;
    }
    vy -= GRAVITY * dt;
    y += vy * dt;
    if (y <= 0) {
      y = 0;
      vy = 0;
      grounded = true;
      airTime = 0;
      event ??= 'land';
    }
  }

  return { state: { y, vy, grounded, airTime, buffer }, event };
}

// ───────── 장애물 ─────────

/** spike: 낮은 가시, pillar: 높은 기둥, thorns: 긴 가시밭, bat: 머리 위를 나는 박쥐 */
export type ObstacleKind = 'spike' | 'pillar' | 'thorns' | 'bat';

export interface Box {
  width: number;
  height: number;
  /** 아랫면의 높이. 땅에 붙어 있으면 0. */
  bottom: number;
}

/** 부딪힘을 판정하는 상자. 그림보다 조금 작아서 스치는 정도는 봐준다. */
export const OBSTACLE_BOX: Readonly<Record<ObstacleKind, Box>> = {
  spike: { width: 20, height: 12, bottom: 0 },
  pillar: { width: 14, height: 36, bottom: 0 },
  thorns: { width: 44, height: 12, bottom: 0 },
  // 땅에서 달리면 아래로 지나가고, 어설프게 뛰면 부딪힌다. 끝까지 뛰면 넘을 수도 있다.
  bat: { width: 20, height: 12, bottom: 40 },
};

export const RUNNER_BOX = { width: 14, height: 22 } as const;

/**
 * 별이 떠 있는 높이(중심)와 크기. 끝까지 눌러 뛴 점프의 꼭대기에 닿는 높이라서
 * 높이 뛰면 반드시 지나가고, 살짝 뛰면 꼭대기에서만 겨우 닿는다.
 */
export const STAR_HEIGHT = 72;
export const STAR_SIZE = 16;

/** 별을 먹었는지 판정하는 상자. touches()에는 별의 중심에서 반 폭을 뺀 왼쪽 끝을 넘긴다. */
export const STAR_BOX: Box = {
  width: STAR_SIZE,
  height: STAR_SIZE,
  bottom: STAR_HEIGHT - STAR_SIZE / 2,
};

/**
 * 캐릭터가 상자에 닿았는지.
 * runnerX는 캐릭터의 가로 중심, runnerY는 발의 높이, boxLeft는 상자의 왼쪽 끝.
 */
export function touches(runnerX: number, runnerY: number, boxLeft: number, box: Box): boolean {
  const half = RUNNER_BOX.width / 2;
  return (
    runnerX + half > boxLeft &&
    runnerX - half < boxLeft + box.width &&
    runnerY < box.bottom + box.height &&
    runnerY + RUNNER_BOX.height > box.bottom
  );
}

// ───────── 장애물 배치 ─────────

/** 이 시간이 지나야 나오는 장애물. 쉬운 것부터 차례로 배운다. */
export const UNLOCK_SECONDS: Readonly<Record<ObstacleKind, number>> = {
  spike: 0,
  pillar: 5,
  bat: 12,
  thorns: 20,
};

const KIND_WEIGHT: ReadonlyArray<readonly [ObstacleKind, number]> = [
  ['spike', 3],
  ['pillar', 3],
  ['bat', 2],
  ['thorns', 2],
];

/** 장애물 사이의 가장 짧은 간격(초). 처음에는 넉넉하고 갈수록 줄어든다. */
export function minGapSeconds(t: number): number {
  return Math.max(0.8, 1.15 - 0.012 * Math.max(0, t));
}

/** 가장 짧은 간격에 무작위로 더해지는 최대 시간(초) */
export const GAP_SPREAD_SECONDS = 0.55;
/** 첫 장애물이 나오기까지 달리는 시간(초) */
export const FIRST_GAP_SECONDS = 1.8;
/** 빈 곳에 별을 놓으려면 간격이 이만큼은 되어야 한다(초). 별을 먹고도 다음 장애물을 넘을 수 있어야 한다. */
const GAP_STAR_MIN_SECONDS = 1.25;

export interface StarSpot {
  /** 장애물의 앞끝에서 별의 중심까지의 가로 거리. 음수면 장애물 앞의 빈 곳. */
  along: number;
}

export interface Spawn {
  kind: ObstacleKind;
  /** 앞 장애물의 뒤끝에서 이 장애물의 앞끝까지의 거리(px) */
  gap: number;
  star: StarSpot | null;
}

/**
 * 다음 장애물을 정한다. t는 지금까지 달린 시간이고,
 * random은 0 이상 1 미만의 수를 돌려주는 함수(Math.random과 같은 모양).
 */
export function nextSpawn(t: number, random: () => number): Spawn {
  const kind = pickKind(t, random());
  const seconds = minGapSeconds(t) + random() * GAP_SPREAD_SECONDS;
  const gap = Math.round(runSpeed(t) * seconds);
  const box = OBSTACLE_BOX[kind];

  const roll = random();
  let star: StarSpot | null = null;
  if (roll < 0.35) {
    // 장애물 바로 위. 높이 뛰어넘으면 따라온다. 박쥐 위의 별은 박쥐를 넘어야 닿는다.
    star = { along: box.width / 2 };
  } else if (roll < 0.55 && seconds >= GAP_STAR_MIN_SECONDS) {
    // 장애물 앞의 빈 곳. 한 번 더 뛰어야 닿는다.
    star = { along: -Math.round(gap / 2) };
  }
  return { kind, gap, star };
}

function pickKind(t: number, roll: number): ObstacleKind {
  const open = KIND_WEIGHT.filter(([kind]) => t >= UNLOCK_SECONDS[kind]);
  const total = open.reduce((sum, [, weight]) => sum + weight, 0);
  let left = roll * total;
  for (const [kind, weight] of open) {
    left -= weight;
    if (left < 0) return kind;
  }
  return open[open.length - 1][0];
}

// ───────── 점수 ─────────

export const PIXELS_PER_METER = 20;
export const STAR_POINTS = 10;

/** 달린 거리(px)를 미터로 */
export function meters(distance: number): number {
  return Math.floor(Math.max(0, distance) / PIXELS_PER_METER);
}

/** 점수: 달린 거리 1m에 1점, 별 하나에 10점 */
export function scoreFor(distance: number, stars: number): number {
  return meters(distance) + STAR_POINTS * Math.max(0, stars);
}
