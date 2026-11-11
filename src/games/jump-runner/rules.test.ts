import { describe, expect, it } from 'vitest';
import {
  FIRST_GAP_SECONDS,
  GAP_SPREAD_SECONDS,
  JUMP_BUFFER_SECONDS,
  MAX_SPEED,
  meters,
  minGapSeconds,
  newRunner,
  nextSpawn,
  OBSTACLE_BOX,
  RUNNER_BOX,
  runSpeed,
  scoreFor,
  STAR_BOX,
  START_SPEED,
  stepRunner,
  touches,
  UNLOCK_SECONDS,
  type ObstacleKind,
  type RunnerState,
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

const DT = 1 / 120;
const KINDS = Object.keys(OBSTACLE_BOX) as ObstacleKind[];

/** 한 번 뛰어서 착지할 때까지의 높이를 프레임마다 기록한다. holdSeconds 동안 누르고 있는다. */
function jumpArc(holdSeconds: number): number[] {
  let state: RunnerState = newRunner();
  const heights: number[] = [];
  for (let frame = 0; frame < 400; frame += 1) {
    const time = frame * DT;
    const step = stepRunner(state, { pressed: frame === 0, held: time < holdSeconds }, DT);
    state = step.state;
    heights.push(state.y);
    if (step.event === 'land') return heights;
  }
  throw new Error('착지하지 않았습니다.');
}

const fullJump = jumpArc(Infinity);
const tapJump = jumpArc(0);
const peak = (arc: number[]): number => Math.max(...arc);
const airSeconds = (arc: number[]): number => arc.length * DT;

/**
 * 점프 한 번으로 상자를 지나갈 수 있는지. 뛰는 시점을 조금씩 바꿔 가며
 * 한 번도 닿지 않는 경우가 있으면 지나갈 수 있는 것이다. 여유(초)도 돌려준다.
 */
function clearWindow(arc: number[], kind: ObstacleKind, speed: number): number {
  const box = OBSTACLE_BOX[kind];
  const runnerX = 0;
  let clearStarts = 0;
  // 장애물 앞끝까지의 거리를 바꿔 가며 뛴다.
  for (let lead = 0; lead <= 200; lead += 1) {
    let hit = false;
    for (let frame = 0; frame < arc.length + 240 && !hit; frame += 1) {
      const y = frame < arc.length ? arc[frame] : 0;
      const boxLeft = lead - speed * frame * DT;
      hit = touches(runnerX, y, boxLeft, box);
    }
    if (!hit) clearStarts += 1;
  }
  // 뛰기 시작할 수 있는 거리의 폭(px)을 시간으로 바꾼다.
  return clearStarts / speed;
}

describe('달리는 속도', () => {
  it('시작 속도에서 출발해 줄지 않고 빨라지다가 최고 속도에서 멈춘다', () => {
    expect(runSpeed(0)).toBe(START_SPEED);
    let previous = 0;
    for (let t = 0; t <= 120; t += 1) {
      const speed = runSpeed(t);
      expect(speed).toBeGreaterThanOrEqual(previous);
      expect(speed).toBeLessThanOrEqual(MAX_SPEED);
      previous = speed;
    }
    expect(runSpeed(120)).toBe(MAX_SPEED);
    expect(runSpeed(-5)).toBe(START_SPEED);
  });
});

describe('점프', () => {
  it('땅에서는 누르기 전까지 가만히 있는다', () => {
    const { state, event } = stepRunner(newRunner(), { pressed: false, held: false }, DT);
    expect(state).toEqual(newRunner());
    expect(event).toBeNull();
  });

  it('누르면 뛰어올랐다가 정확히 땅으로 돌아온다', () => {
    const first = stepRunner(newRunner(), { pressed: true, held: true }, DT);
    expect(first.event).toBe('jump');
    expect(first.state.grounded).toBe(false);
    expect(first.state.y).toBeGreaterThan(0);
    expect(fullJump.at(-1)).toBe(0);
    expect(Math.min(...fullJump)).toBe(0);
  });

  it('끝까지 누르면 살짝 눌렀을 때보다 높이, 오래 뛴다', () => {
    expect(peak(fullJump)).toBeGreaterThan(75);
    expect(peak(fullJump)).toBeLessThan(85);
    expect(peak(tapJump)).toBeGreaterThan(40);
    expect(peak(tapJump)).toBeLessThan(peak(fullJump) - 20);
    expect(airSeconds(tapJump)).toBeLessThan(airSeconds(fullJump) - 0.1);
  });

  it('공중에서는 다시 뛸 수 없다', () => {
    let state = stepRunner(newRunner(), { pressed: true, held: true }, DT).state;
    for (let frame = 0; frame < 20; frame += 1) {
      state = stepRunner(state, { pressed: false, held: true }, DT).state;
    }
    const rising = state.vy;
    // 공중에서 누른 것은 곧 사라질 만큼만 기억된다.
    const again = stepRunner(state, { pressed: true, held: true }, DT);
    expect(again.event).toBeNull();
    expect(again.state.vy).toBeLessThan(rising);
  });

  it('착지 직전에 누르면 착지하자마자 다시 뛴다', () => {
    const framesBefore = Math.floor((JUMP_BUFFER_SECONDS * 0.8) / DT);
    let state: RunnerState = newRunner();
    const events: string[] = [];
    for (let frame = 0; frame < fullJump.length + 3; frame += 1) {
      const pressed = frame === 0 || frame === fullJump.length - 1 - framesBefore;
      const step = stepRunner(state, { pressed, held: true }, DT);
      state = step.state;
      if (step.event) events.push(step.event);
    }
    expect(events).toEqual(['jump', 'land', 'jump']);
  });

  it('너무 일찍 누른 것은 잊는다', () => {
    const framesBefore = Math.ceil((JUMP_BUFFER_SECONDS * 2) / DT);
    let state: RunnerState = newRunner();
    const events: string[] = [];
    for (let frame = 0; frame < fullJump.length + 3; frame += 1) {
      const pressed = frame === 0 || frame === fullJump.length - 1 - framesBefore;
      const step = stepRunner(state, { pressed, held: true }, DT);
      state = step.state;
      if (step.event) events.push(step.event);
    }
    expect(events).toEqual(['jump', 'land']);
  });

  it('프레임이 달라도 점프 높이가 크게 달라지지 않는다', () => {
    const peakAt = (dt: number): number => {
      let state: RunnerState = newRunner();
      let top = 0;
      for (let frame = 0; frame < 400; frame += 1) {
        const step = stepRunner(state, { pressed: frame === 0, held: true }, dt);
        state = step.state;
        top = Math.max(top, state.y);
        if (step.event === 'land') break;
      }
      return top;
    };
    expect(Math.abs(peakAt(1 / 30) - peakAt(1 / 120))).toBeLessThan(8);
  });
});

describe('부딪힘 판정', () => {
  const half = RUNNER_BOX.width / 2;

  it('땅의 장애물은 닿으면 부딪히고, 충분히 높이 있으면 지나간다', () => {
    const box = OBSTACLE_BOX.spike;
    expect(touches(0, 0, -5, box)).toBe(true);
    expect(touches(0, box.height, -5, box)).toBe(false);
    expect(touches(0, box.height - 1, -5, box)).toBe(true);
  });

  it('옆으로 떨어져 있으면 닿지 않는다', () => {
    const box = OBSTACLE_BOX.pillar;
    expect(touches(0, 0, half, box)).toBe(false);
    expect(touches(0, 0, half - 1, box)).toBe(true);
    expect(touches(0, 0, -half - box.width, box)).toBe(false);
    expect(touches(0, 0, -half - box.width + 1, box)).toBe(true);
  });

  it('박쥐는 땅에서 달리면 아래로 지나가고, 어설프게 뛰면 부딪힌다', () => {
    const box = OBSTACLE_BOX.bat;
    expect(touches(0, 0, -5, box)).toBe(false);
    expect(touches(0, 20, -5, box)).toBe(true);
    expect(touches(0, box.bottom + box.height, -5, box)).toBe(false);
  });
});

describe('넘을 수 있는 난이도인지', () => {
  it('모든 장애물은 처음 나올 때의 속도와 최고 속도에서 끝까지 누른 점프로 넘을 수 있다', () => {
    for (const kind of KINDS) {
      for (const speed of [runSpeed(UNLOCK_SECONDS[kind]), MAX_SPEED]) {
        // 뛰는 시점에 0.1초 넘는 여유가 있어야 사람이 할 만하다.
        expect(clearWindow(fullJump, kind, speed), `${kind} @ ${speed}`).toBeGreaterThan(0.1);
      }
    }
  });

  it('낮은 가시는 살짝 뛰어도 넘을 수 있다', () => {
    expect(clearWindow(tapJump, 'spike', START_SPEED)).toBeGreaterThan(0.08);
    expect(clearWindow(tapJump, 'spike', MAX_SPEED)).toBeGreaterThan(0.08);
  });

  it('박쥐는 뛰지 않으면 지나가고, 살짝 뛰면 넘을 수 없다', () => {
    const box = OBSTACLE_BOX.bat;
    expect(box.bottom).toBeGreaterThan(RUNNER_BOX.height);
    expect(peak(tapJump)).toBeLessThan(box.bottom + box.height + 6);
  });

  it('별은 끝까지 누른 점프의 꼭대기에 걸려서, 높이 뛰면 넘어가 버리지 않는다', () => {
    const top = STAR_BOX.bottom + STAR_BOX.height;
    expect(peak(fullJump)).toBeLessThan(top);
    expect(peak(fullJump) + RUNNER_BOX.height).toBeGreaterThan(STAR_BOX.bottom + 10);
    // 땅에서는 닿지 않는다.
    expect(touches(0, 0, -STAR_BOX.width / 2, STAR_BOX)).toBe(false);
  });

  it('장애물 사이에는 착지한 뒤 다시 뛸 시간이 있다', () => {
    for (let t = 0; t <= 120; t += 5) {
      expect(minGapSeconds(t)).toBeGreaterThan(airSeconds(fullJump) + 0.15);
    }
    expect(FIRST_GAP_SECONDS).toBeGreaterThan(minGapSeconds(0));
  });
});

describe('장애물 배치', () => {
  it('아직 열리지 않은 장애물은 나오지 않고, 열린 것은 모두 나온다', () => {
    for (const t of [0, 4.9, 5, 11.9, 12, 19.9, 20, 60]) {
      const random = seeded(Math.round(t * 10) + 1);
      const seen = new Set<ObstacleKind>();
      for (let i = 0; i < 400; i += 1) seen.add(nextSpawn(t, random).kind);
      const open = KINDS.filter((kind) => t >= UNLOCK_SECONDS[kind]);
      expect([...seen].sort()).toEqual([...open].sort());
    }
  });

  it('간격은 그때의 속도로 정해진 시간 범위 안에 있다', () => {
    const random = seeded(7);
    for (let t = 0; t <= 90; t += 3) {
      for (let i = 0; i < 50; i += 1) {
        const { gap } = nextSpawn(t, random);
        const seconds = gap / runSpeed(t);
        expect(seconds).toBeGreaterThanOrEqual(minGapSeconds(t) - 0.01);
        expect(seconds).toBeLessThanOrEqual(minGapSeconds(t) + GAP_SPREAD_SECONDS + 0.01);
      }
    }
  });

  it('별은 장애물 위나 넉넉한 빈 곳 한가운데에만 놓인다', () => {
    const random = seeded(11);
    let over = 0;
    let between = 0;
    let none = 0;
    for (let i = 0; i < 2000; i += 1) {
      const t = (i % 60) + 0.5;
      const spawn = nextSpawn(t, random);
      if (!spawn.star) {
        none += 1;
      } else if (spawn.star.along >= 0) {
        over += 1;
        expect(spawn.star.along).toBe(OBSTACLE_BOX[spawn.kind].width / 2);
      } else {
        between += 1;
        expect(spawn.star.along).toBe(-Math.round(spawn.gap / 2));
        // 별을 먹고 내려와서 다음 장애물까지 여유가 있어야 한다.
        const seconds = spawn.gap / runSpeed(t);
        expect(seconds / 2 - airSeconds(fullJump) / 2).toBeGreaterThan(0.25);
      }
    }
    expect(over).toBeGreaterThan(400);
    expect(between).toBeGreaterThan(20);
    expect(none).toBeGreaterThan(600);
  });
});

describe('점수', () => {
  it('1m에 1점, 별 하나에 10점', () => {
    expect(meters(0)).toBe(0);
    expect(meters(19.9)).toBe(0);
    expect(meters(20)).toBe(1);
    expect(scoreFor(2000, 0)).toBe(100);
    expect(scoreFor(2000, 3)).toBe(130);
    expect(scoreFor(-10, -1)).toBe(0);
  });
});
