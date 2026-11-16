/**
 * 탑 쌓기의 규칙. 화면과 분리된 순수 함수라서 숫자만 바꿔 밸런스를 조정할 수 있다.
 * 길이는 논리 픽셀, 시간은 초다. 가로 위치는 화면 왼쪽 끝이 0이고, 블록의 자리는 왼쪽 가장자리로 적는다.
 */

/** 블록이 오가는 판의 폭. 화면의 가로 길이와 같다. */
export const FIELD_WIDTH = 240;
export const BLOCK_HEIGHT = 14;
/** 맨 아래 받침과 첫 블록의 폭 */
export const START_WIDTH = 96;
/** 어긋난 폭이 이 안쪽이면 딱 맞은 것으로 쳐서 블록이 줄어들지 않는다. */
export const PERFECT_TOLERANCE = 3;
/** 이만큼 연속으로 딱 맞히면 그때부터는 맞힐 때마다 블록이 다시 넓어진다. */
export const GROW_STREAK = 3;
/** 한 번에 넓어지는 폭. 양쪽으로 반씩 늘어나고, 처음 폭보다 넓어지지는 않는다. */
export const GROW_WIDTH = 6;

// ───────── 움직이는 블록 ─────────

export const START_SPEED = 130;
export const MAX_SPEED = 300;
/** 한 층 쌓을 때마다 빨라지는 정도(px/s). 43층쯤에 MAX_SPEED에 닿는다. */
const SPEED_GAIN = 4;
/** MAX_SPEED에 닿은 뒤로도 층마다 조금씩 더 빨라진다. 높이 쌓은 판이 한 난이도에 머물지 않게 한다. */
export const LATE_SPEED_GAIN = 1;
/** 아무리 높이 쌓아도 이보다 빨라지지는 않는다. */
export const TOP_SPEED = 360;
/** 속도가 층마다 위아래로 흔들리는 비율. 같은 박자로만 눌러서는 맞지 않게 한다. */
export const SPEED_JITTER = 0.1;
/** 이 층부터 속도가 흔들린다. 처음 몇 층은 박자를 익히는 구간이다. */
export const JITTER_FROM_FLOOR = 5;
/** MAX_SPEED에 닿은 뒤로는 흔들림도 층마다 이만큼씩 커져서 TOP_JITTER까지 간다. */
export const LATE_JITTER_GAIN = 0.0025;
export const TOP_JITTER = 0.2;

/** 속도가 MAX_SPEED에 닿는 층 */
export const MAX_SPEED_FLOOR = Math.ceil((MAX_SPEED - START_SPEED) / SPEED_GAIN);

/** 흔들림을 뺀 속도(px/s). floors는 지금까지 쌓은 층 수. */
export function baseSpeed(floors: number): number {
  const at = Math.max(0, floors);
  if (at <= MAX_SPEED_FLOOR) return Math.min(MAX_SPEED, START_SPEED + SPEED_GAIN * at);
  return Math.min(TOP_SPEED, MAX_SPEED + LATE_SPEED_GAIN * (at - MAX_SPEED_FLOOR));
}

/** 그 층에서 속도가 흔들리는 비율. 처음 몇 층은 0이고, 높이 쌓을수록 커진다. */
export function speedJitter(floors: number): number {
  if (floors < JITTER_FROM_FLOOR) return 0;
  return Math.min(TOP_JITTER, SPEED_JITTER + LATE_JITTER_GAIN * Math.max(0, floors - MAX_SPEED_FLOOR));
}

/** 다음 블록이 움직이는 속도(px/s). roll은 0 이상 1 미만의 수(Math.random()의 결과). */
export function moverSpeed(floors: number, roll: number): number {
  const jitter = speedJitter(floors);
  return baseSpeed(floors) * (1 - jitter + 2 * jitter * roll);
}

/** 블록이 오가는 범위(왼쪽 가장자리 기준). 양 끝에서는 블록의 절반이 화면 밖으로 나간다. */
export function moverRange(width: number): { min: number; max: number } {
  return { min: -Math.floor(width / 2), max: FIELD_WIDTH - Math.ceil(width / 2) };
}

/**
 * 움직이기 시작한 지 t초 뒤 블록의 왼쪽 가장자리.
 * 한쪽 끝에서 출발해 반대쪽 끝에 닿으면 되돌아오기를 되풀이한다.
 */
export function moverLeft(width: number, speed: number, t: number, fromLeft: boolean): number {
  const { min, max } = moverRange(width);
  const span = max - min;
  const travelled = (Math.max(0, t) * speed) % (span * 2);
  const along = travelled <= span ? travelled : span * 2 - travelled;
  return fromLeft ? min + along : max - along;
}

// ───────── 탑 ─────────

export interface Slab {
  left: number;
  width: number;
}

export interface TowerState {
  /** 탑의 맨 위 블록. 다음 블록의 폭도 이와 같다. */
  top: Slab;
  /** 쌓은 층 수. 받침은 세지 않는다. */
  floors: number;
  /** 지금 이어지고 있는 딱 맞춤 횟수 */
  streak: number;
  bestStreak: number;
  /** 딱 맞힌 횟수 */
  perfects: number;
  score: number;
}

export type DropOutcome =
  /** 딱 맞음. grew는 블록이 넓어졌는지. */
  | { kind: 'perfect'; placed: Slab; grew: boolean; points: number }
  /** 걸친 만큼만 남고, 삐져나온 조각(cut)은 떨어진다. */
  | { kind: 'trim'; placed: Slab; cut: Slab; points: number }
  /** 하나도 걸치지 않아서 끝. */
  | { kind: 'miss' };

export function newTower(): TowerState {
  return {
    top: { left: (FIELD_WIDTH - START_WIDTH) / 2, width: START_WIDTH },
    floors: 0,
    streak: 0,
    bestStreak: 0,
    perfects: 0,
    score: 0,
  };
}

// ───────── 점수 ─────────

export const FLOOR_POINTS = 5;
export const PERFECT_POINTS = 3;
/** 딱 맞춤이 이어질 때 더 붙는 점수의 상한 */
export const MAX_STREAK_BONUS = 3;

/**
 * 한 층의 점수. 딱 맞히면 보너스가 붙고, 이어서 맞힐수록 1점씩 더 붙는다(최대 +3).
 * streak은 이번 것까지 센 연속 딱 맞춤 횟수.
 */
export function pointsFor(perfect: boolean, streak: number): number {
  if (!perfect) return FLOOR_POINTS;
  return FLOOR_POINTS + PERFECT_POINTS + Math.min(MAX_STREAK_BONUS, Math.max(0, streak - 1));
}

/**
 * 움직이는 블록을 moverX(왼쪽 가장자리)에서 내려놓는다.
 * 받은 상태는 바꾸지 않고 새 상태를 돌려준다. 빗나가면 상태는 그대로다.
 */
export function drop(state: TowerState, moverX: number): { state: TowerState; outcome: DropOutcome } {
  const { top } = state;
  const left = Math.round(moverX);
  const offset = left - top.left;
  const miss = Math.abs(offset);

  if (miss <= PERFECT_TOLERANCE) {
    const streak = state.streak + 1;
    const placed = streak >= GROW_STREAK ? widen(top) : { ...top };
    const points = pointsFor(true, streak);
    return {
      state: {
        top: placed,
        floors: state.floors + 1,
        streak,
        bestStreak: Math.max(state.bestStreak, streak),
        perfects: state.perfects + 1,
        score: state.score + points,
      },
      outcome: { kind: 'perfect', placed, grew: placed.width > top.width, points },
    };
  }

  const overlap = top.width - miss;
  if (overlap <= 0) return { state, outcome: { kind: 'miss' } };

  const placed: Slab = { left: Math.max(left, top.left), width: overlap };
  // 오른쪽으로 어긋났으면 오른쪽 끝이, 왼쪽으로 어긋났으면 왼쪽 끝이 잘려 나간다.
  const cut: Slab =
    offset > 0 ? { left: top.left + top.width, width: miss } : { left, width: miss };
  const points = pointsFor(false, 0);
  return {
    state: {
      ...state,
      top: placed,
      floors: state.floors + 1,
      streak: 0,
      score: state.score + points,
    },
    outcome: { kind: 'trim', placed, cut, points },
  };
}

/** 블록을 양쪽으로 넓힌다. 처음 폭을 넘지 않고 판 밖으로도 나가지 않는다. */
function widen(slab: Slab): Slab {
  const width = Math.min(START_WIDTH, slab.width + GROW_WIDTH);
  const left = slab.left - Math.floor((width - slab.width) / 2);
  return { left: Math.min(Math.max(0, left), FIELD_WIDTH - width), width };
}
