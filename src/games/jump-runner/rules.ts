/**
 * 점프 러너의 규칙. 화면과 분리된 순수 함수라서 숫자만 바꿔 밸런스를 조정할 수 있다.
 * 길이는 논리 픽셀, 시간은 초다. 높이는 땅에서 위로 잰다(땅이 0, 위가 +).
 */

// ───────── 속도 ─────────

export const START_SPEED = 130;
/** 1막이 끝날 때의 속도. 여기까지는 빠르게 오른다. */
export const CRUISE_SPEED = 230;
/**
 * 가장 빠른 속도. 화면이 좁아서(너비 240) 이보다 빠르면 장애물이 나타나서 뛰어야 할 때까지
 * 0.4초가 안 되어, 보고 누르는 게임이 아니게 된다.
 */
export const MAX_SPEED = 280;
/** 1초마다 빨라지는 정도(px/s): 1막과 2막 */
const SPEED_GAIN = 2.5;
const LATE_SPEED_GAIN = 1;
/**
 * 2막이 시작되는 때(초). 1막에서 올릴 것(속도, 간격, 장애물 종류)이 모두 끝까지 오른 때다.
 * 2막에서는 속도가 천천히 더 오르고 장애물이 둘씩 붙어 나와서, 오래 달릴수록 계속 어려워진다.
 */
export const SECOND_ACT_SECONDS = (CRUISE_SPEED - START_SPEED) / SPEED_GAIN;

/** 달리는 속도(px/s). t는 달리기 시작한 뒤 지난 시간. 40초까지 빠르게, 그 뒤로 90초까지 천천히 오른다. */
export function runSpeed(t: number): number {
  const time = Math.max(0, t);
  if (time <= SECOND_ACT_SECONDS) return START_SPEED + SPEED_GAIN * time;
  return Math.min(MAX_SPEED, CRUISE_SPEED + LATE_SPEED_GAIN * (time - SECOND_ACT_SECONDS));
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
 * 달리는 캐릭터의 가운데에서 화면 오른쪽 끝까지의 거리(px). 장애물을 미리 볼 수 있는 거리라서,
 * 속도와 함께 "보고 누를 시간"을 정한다.
 */
export const VIEW_AHEAD = 188;

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

// ───────── 묶음(2막) ─────────

/** 둘이 붙어 나오는 장애물. 끝까지 누른 점프 한 번으로 넘지만, 뛸 수 있는 순간이 하나일 때의 절반쯤이다. */
export type GroupKind = 'twin-spikes' | 'spike-pillar' | 'bat-spike' | 'twin-pillars';

/** 이 시간이 지나야 나오는 묶음. 뛸 수 있는 순간이 넉넉한 것부터 차례로 열린다. */
export const GROUP_UNLOCK_SECONDS: Readonly<Record<GroupKind, number>> = {
  'twin-spikes': 40,
  'spike-pillar': 55,
  'bat-spike': 70,
  'twin-pillars': 85,
};

/**
 * 묶음의 모양: 앞뒤로 놓이는 두 장애물과 그 사이의 틈(초).
 * 틈을 거리가 아니라 시간으로 정해서, 속도가 올라 한 번에 넘는 거리가 늘어도 묶음이 쉬워지지 않는다.
 * 틈이 null이면 뒤의 것이 앞의 것 바로 위에 뜬다(가시 위의 박쥐: 높이 뛰어야만 넘는다).
 */
const GROUP_SHAPE: Readonly<
  Record<GroupKind, { parts: readonly [ObstacleKind, ObstacleKind]; innerSeconds: number | null }>
> = {
  'twin-spikes': { parts: ['spike', 'spike'], innerSeconds: 0.07 },
  'spike-pillar': { parts: ['spike', 'pillar'], innerSeconds: 0.06 },
  'bat-spike': { parts: ['spike', 'bat'], innerSeconds: null },
  'twin-pillars': { parts: ['pillar', 'pillar'], innerSeconds: 0.085 },
};

/** 묶음으로 나올 확률이 가장 높을 때의 값과, 거기에 이르는 때(초). 2막이 시작될 때는 0이다. */
export const GROUP_MAX_CHANCE = 0.5;
export const GROUP_FULL_SECONDS = 110;

/** 다음 장애물이 묶음으로 나올 확률(0~GROUP_MAX_CHANCE). 1막에서는 0이다. */
export function groupChance(t: number): number {
  const progress = (t - SECOND_ACT_SECONDS) / (GROUP_FULL_SECONDS - SECOND_ACT_SECONDS);
  return GROUP_MAX_CHANCE * Math.min(1, Math.max(0, progress));
}

/** 한꺼번에 놓이는 장애물 하나 */
export interface Placed {
  kind: ObstacleKind;
  /** 맨 앞 장애물의 앞끝에서 이 장애물의 앞끝까지의 거리(px) */
  offset: number;
}

/** 그 속도로 달릴 때 묶음을 이루는 장애물들. 앞에 놓이는 것부터다. */
export function groupParts(group: GroupKind, speed: number): Placed[] {
  const { parts, innerSeconds } = GROUP_SHAPE[group];
  const [first, second] = parts;
  const offset = innerSeconds === null ? 0 : OBSTACLE_BOX[first].width + Math.round(innerSeconds * speed);
  return [
    { kind: first, offset: 0 },
    { kind: second, offset },
  ];
}

/** 놓인 장애물들의 맨 앞끝에서 맨 뒤끝까지(px) */
export function spanWidth(parts: readonly Placed[]): number {
  return Math.max(0, ...parts.map((part) => part.offset + OBSTACLE_BOX[part.kind].width));
}

export interface Spawn {
  /** 함께 놓이는 장애물. 1막에서는 언제나 하나이고, 2막에서는 둘이 붙어 나오기도 한다. */
  obstacles: readonly Placed[];
  /** 맨 앞 장애물의 앞끝에서 맨 뒤 장애물의 뒤끝까지(px) */
  width: number;
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
  const speed = runSpeed(t);
  const gap = Math.round(speed * seconds);
  const roll = random();

  const group = pickGroup(t, random);
  const obstacles: Placed[] = group ? groupParts(group, speed) : [{ kind, offset: 0 }];
  const width = spanWidth(obstacles);

  let star: StarSpot | null = null;
  if (roll < 0.35) {
    // 장애물(묶음이면 그 한가운데) 바로 위. 높이 뛰어넘으면 따라온다. 박쥐 위의 별은 박쥐를 넘어야 닿는다.
    star = { along: width / 2 };
  } else if (roll < 0.55 && seconds >= GAP_STAR_MIN_SECONDS) {
    // 장애물 앞의 빈 곳. 한 번 더 뛰어야 닿는다.
    star = { along: -Math.round(gap / 2) };
  }
  return { obstacles, width, gap, star };
}

/** 이번 장애물을 묶음으로 낼지, 낸다면 어느 묶음인지. 1막에서는 난수를 쓰지 않고 null을 돌려준다. */
function pickGroup(t: number, random: () => number): GroupKind | null {
  const chance = groupChance(t);
  if (chance <= 0 || random() >= chance) return null;
  const open = GROUP_KINDS.filter((group) => t >= GROUP_UNLOCK_SECONDS[group]);
  if (open.length === 0) return null;
  return open[Math.min(open.length - 1, Math.floor(random() * open.length))];
}

const GROUP_KINDS = Object.keys(GROUP_UNLOCK_SECONDS) as GroupKind[];

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
