import { describe, expect, it } from 'vitest';
import {
  CRUISE_SPEED,
  FIRST_GAP_SECONDS,
  GAP_SPREAD_SECONDS,
  GRAVITY,
  GROUP_FULL_SECONDS,
  GROUP_MAX_CHANCE,
  GROUP_UNLOCK_SECONDS,
  groupChance,
  groupParts,
  JUMP_BUFFER_SECONDS,
  JUMP_VELOCITY,
  MAX_SPEED,
  meters,
  minGapSeconds,
  newRunner,
  nextSpawn,
  OBSTACLE_BOX,
  RUNNER_BOX,
  runSpeed,
  scoreFor,
  SECOND_ACT_SECONDS,
  spanWidth,
  STAR_BOX,
  START_SPEED,
  stepRunner,
  touches,
  UNLOCK_SECONDS,
  VIEW_AHEAD,
  type GroupKind,
  type ObstacleKind,
  type Placed,
  type RunnerState,
  type Spawn,
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
const GROUPS = Object.keys(GROUP_UNLOCK_SECONDS) as GroupKind[];

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

const single = (kind: ObstacleKind): Placed[] => [{ kind, offset: 0 }];

/**
 * 점프 한 번으로 놓인 장애물들을 모두 지나갈 수 있는, 뛰기 시작하는 자리의 범위.
 * 맨 앞 장애물의 앞끝까지의 거리(px)를 조금씩 바꿔 가며 뛰어 보고, 한 번도 닿지 않는 가장 긴 구간을 돌려준다.
 * 넘을 수 없으면 null.
 */
function clearLeads(arc: number[], parts: readonly Placed[], speed: number): { from: number; to: number } | null {
  const runnerX = 0;
  let best: { from: number; to: number } | null = null;
  let from: number | null = null;
  for (let lead = 0; lead <= 260; lead += 1) {
    let hit = false;
    for (let frame = 0; frame < arc.length + 240 && !hit; frame += 1) {
      const y = frame < arc.length ? arc[frame] : 0;
      const left = lead - speed * frame * DT;
      hit = parts.some((part) => touches(runnerX, y, left + part.offset, OBSTACLE_BOX[part.kind]));
    }
    if (hit) {
      from = null;
    } else {
      from ??= lead;
      if (!best || lead - from > best.to - best.from) best = { from, to: lead };
    }
  }
  return best;
}

/** 뛰는 시점의 여유(초): 넘을 수 있는 자리의 폭을 그 속도로 달리는 시간으로 바꾼 것. 넘을 수 없으면 0. */
function clearWindow(arc: number[], parts: readonly Placed[], speed: number): number {
  const leads = clearLeads(arc, parts, speed);
  return leads ? (leads.to - leads.from + 1) / speed : 0;
}

/** 묶음이 열리는 때의 속도부터 가장 빠른 속도까지, 그 묶음이 나올 수 있는 속도들 */
function groupSpeeds(group: GroupKind): number[] {
  const speeds: number[] = [];
  for (let speed = runSpeed(GROUP_UNLOCK_SECONDS[group]); speed < MAX_SPEED; speed += 5) speeds.push(speed);
  return [...speeds, MAX_SPEED];
}

/** spawn이 어느 묶음인지. 하나짜리면 null. */
function groupOf(spawn: Spawn, t: number): GroupKind | null {
  if (spawn.obstacles.length === 1) return null;
  const found = GROUPS.find(
    (group) => JSON.stringify(groupParts(group, runSpeed(t))) === JSON.stringify(spawn.obstacles),
  );
  if (!found) throw new Error(`알 수 없는 묶음: ${JSON.stringify(spawn.obstacles)}`);
  return found;
}

describe('달리는 속도', () => {
  it('시작 속도에서 출발해 줄지 않고 빨라지다가 최고 속도에서 멈춘다', () => {
    expect(runSpeed(0)).toBe(START_SPEED);
    let previous = 0;
    for (let t = 0; t <= 200; t += 1) {
      const speed = runSpeed(t);
      expect(speed).toBeGreaterThanOrEqual(previous);
      expect(speed).toBeLessThanOrEqual(MAX_SPEED);
      previous = speed;
    }
    expect(runSpeed(200)).toBe(MAX_SPEED);
    expect(runSpeed(-5)).toBe(START_SPEED);
  });

  it('1막이 끝나도 멈추지 않고, 2막에서는 더 천천히 오른다', () => {
    expect(runSpeed(SECOND_ACT_SECONDS)).toBe(CRUISE_SPEED);
    expect(MAX_SPEED).toBeGreaterThan(CRUISE_SPEED);
    const early = runSpeed(SECOND_ACT_SECONDS) - runSpeed(SECOND_ACT_SECONDS - 10);
    const late = runSpeed(SECOND_ACT_SECONDS + 10) - runSpeed(SECOND_ACT_SECONDS);
    expect(late).toBeGreaterThan(0);
    expect(late).toBeLessThan(early);
  });

  it('가장 빠를 때에도 장애물이 화면에 나타나서 뛰어야 할 때까지 볼 시간이 있다', () => {
    for (const kind of KINDS.filter((item) => OBSTACLE_BOX[item].bottom === 0)) {
      const leads = clearLeads(fullJump, single(kind), MAX_SPEED);
      expect(leads, kind).not.toBeNull();
      if (!leads) continue;
      // 넘을 수 있는 자리의 한가운데에서 뛴다고 할 때, 장애물의 앞끝이 화면에 들어온 뒤로 지난 시간
      const middle = (leads.from + leads.to) / 2 + RUNNER_BOX.width / 2;
      expect((VIEW_AHEAD - middle) / MAX_SPEED, kind).toBeGreaterThan(0.38);
    }
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
      for (const speed of [runSpeed(UNLOCK_SECONDS[kind]), CRUISE_SPEED, MAX_SPEED]) {
        // 뛰는 시점에 0.1초 넘는 여유가 있어야 사람이 할 만하다.
        expect(clearWindow(fullJump, single(kind), speed), `${kind} @ ${speed}`).toBeGreaterThan(0.1);
      }
    }
  });

  it('낮은 가시는 살짝 뛰어도 넘을 수 있다', () => {
    expect(clearWindow(tapJump, single('spike'), START_SPEED)).toBeGreaterThan(0.08);
    expect(clearWindow(tapJump, single('spike'), MAX_SPEED)).toBeGreaterThan(0.08);
  });

  it('묶음은 나올 수 있는 모든 속도에서 끝까지 누른 점프 한 번으로 넘을 수 있다', () => {
    for (const group of GROUPS) {
      for (const speed of groupSpeeds(group)) {
        // 하나짜리보다 좁지만, 사람이 맞출 수 있는 0.2초는 남긴다.
        expect(clearWindow(fullJump, groupParts(group, speed), speed), `${group} @ ${speed}`).toBeGreaterThan(0.2);
      }
    }
  });

  it('묶음은 그 안의 장애물 하나보다 뛸 수 있는 순간이 좁다', () => {
    for (const group of GROUPS) {
      for (const speed of groupSpeeds(group)) {
        const parts = groupParts(group, speed);
        const together = clearWindow(fullJump, parts, speed);
        for (const part of parts.filter((item) => OBSTACLE_BOX[item.kind].bottom === 0)) {
          expect(together, `${group} @ ${speed}`).toBeLessThan(clearWindow(fullJump, single(part.kind), speed) - 0.03);
        }
      }
    }
  });

  it('뒤에 열리는 묶음일수록 열릴 때 뛸 수 있는 순간이 좁다', () => {
    const ordered = [...GROUPS].sort((a, b) => GROUP_UNLOCK_SECONDS[a] - GROUP_UNLOCK_SECONDS[b]);
    const windows = ordered.map((group) => {
      const speed = runSpeed(GROUP_UNLOCK_SECONDS[group]);
      return clearWindow(fullJump, groupParts(group, speed), speed);
    });
    for (let index = 1; index < windows.length; index += 1) {
      expect(windows[index], ordered[index]).toBeLessThan(windows[index - 1]);
    }
  });

  it('가시 위의 박쥐는 살짝 뛰어서는 넘을 수 없다', () => {
    for (const speed of groupSpeeds('bat-spike')) {
      expect(clearWindow(tapJump, groupParts('bat-spike', speed), speed)).toBe(0);
    }
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
    for (let t = 0; t <= 200; t += 5) {
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
      for (let i = 0; i < 400; i += 1) {
        const spawn = nextSpawn(t, random);
        if (spawn.obstacles.length === 1) seen.add(spawn.obstacles[0].kind);
      }
      const open = KINDS.filter((kind) => t >= UNLOCK_SECONDS[kind]);
      expect([...seen].sort()).toEqual([...open].sort());
    }
  });

  it('1막에서는 언제나 하나씩 나오고, 난수도 예전처럼 세 번만 쓴다', () => {
    for (const t of [0, 10, 25, SECOND_ACT_SECONDS - 0.1, SECOND_ACT_SECONDS]) {
      const random = seeded(Math.round(t * 10) + 3);
      let calls = 0;
      const counted = (): number => {
        calls += 1;
        return random();
      };
      for (let i = 0; i < 300; i += 1) {
        const spawn = nextSpawn(t, counted);
        expect(spawn.obstacles).toHaveLength(1);
        expect(spawn.obstacles[0].offset).toBe(0);
        expect(spawn.width).toBe(OBSTACLE_BOX[spawn.obstacles[0].kind].width);
      }
      expect(calls).toBe(300 * 3);
    }
  });

  it('묶음으로 나올 확률은 2막이 시작될 때 0이고, 줄지 않고 올라 정해진 값에서 멈춘다', () => {
    expect(groupChance(0)).toBe(0);
    expect(groupChance(SECOND_ACT_SECONDS)).toBe(0);
    let previous = 0;
    for (let t = SECOND_ACT_SECONDS; t <= 300; t += 1) {
      const chance = groupChance(t);
      expect(chance).toBeGreaterThanOrEqual(previous);
      expect(chance).toBeLessThanOrEqual(GROUP_MAX_CHANCE);
      previous = chance;
    }
    expect(groupChance(SECOND_ACT_SECONDS + 1)).toBeGreaterThan(0);
    expect(groupChance(GROUP_FULL_SECONDS)).toBe(GROUP_MAX_CHANCE);
    expect(groupChance(300)).toBe(GROUP_MAX_CHANCE);
    expect(GROUP_MAX_CHANCE).toBeLessThan(1);
  });

  it('2막에서는 열린 묶음만, 정해진 확률만큼 나온다', () => {
    expect(Math.min(...GROUPS.map((group) => GROUP_UNLOCK_SECONDS[group]))).toBeGreaterThanOrEqual(SECOND_ACT_SECONDS);
    for (const t of [45, 56, 71, 86, 150]) {
      const random = seeded(Math.round(t) + 5);
      const seen = new Set<GroupKind>();
      const samples = 4000;
      let grouped = 0;
      for (let i = 0; i < samples; i += 1) {
        const group = groupOf(nextSpawn(t, random), t);
        if (!group) continue;
        grouped += 1;
        seen.add(group);
      }
      const open = GROUPS.filter((group) => t >= GROUP_UNLOCK_SECONDS[group]);
      expect([...seen].sort(), `${t}초`).toEqual([...open].sort());
      expect(Math.abs(grouped / samples - groupChance(t)), `${t}초`).toBeLessThan(0.03);
    }
  });

  it('묶음의 폭은 맨 앞끝에서 맨 뒤끝까지이고, 안쪽 틈은 속도가 올라도 시간으로는 그대로다', () => {
    for (const group of GROUPS) {
      for (const speed of groupSpeeds(group)) {
        const parts = groupParts(group, speed);
        expect(parts).toHaveLength(2);
        expect(parts[0].offset).toBe(0);
        expect(spanWidth(parts)).toBe(
          Math.max(...parts.map((part) => part.offset + OBSTACLE_BOX[part.kind].width)),
        );
      }
    }
    const inner = (speed: number): number => {
      const [first, second] = groupParts('twin-pillars', speed);
      return (second.offset - OBSTACLE_BOX[first.kind].width) / speed;
    };
    expect(Math.abs(inner(MAX_SPEED) - inner(runSpeed(GROUP_UNLOCK_SECONDS['twin-pillars'])))).toBeLessThan(0.005);
    // 가시 위의 박쥐는 같은 자리에 겹쳐 놓인다.
    expect(groupParts('bat-spike', MAX_SPEED).map((part) => part.offset)).toEqual([0, 0]);
    expect(spanWidth(single('thorns'))).toBe(OBSTACLE_BOX.thorns.width);
  });

  it('간격은 그때의 속도로 정해진 시간 범위 안에 있다', () => {
    const random = seeded(7);
    for (let t = 0; t <= 150; t += 3) {
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
    for (let i = 0; i < 4000; i += 1) {
      const t = (i % 120) + 0.5;
      const spawn = nextSpawn(t, random);
      expect(spawn.width).toBe(spanWidth(spawn.obstacles));
      if (!spawn.star) {
        none += 1;
      } else if (spawn.star.along >= 0) {
        over += 1;
        // 묶음이면 그 한가운데 위에 놓인다.
        expect(spawn.star.along).toBe(spawn.width / 2);
      } else {
        between += 1;
        expect(spawn.star.along).toBe(-Math.round(spawn.gap / 2));
        // 별을 먹고 내려와서 다음 장애물까지 여유가 있어야 한다.
        const seconds = spawn.gap / runSpeed(t);
        expect(seconds / 2 - airSeconds(fullJump) / 2).toBeGreaterThan(0.25);
      }
    }
    expect(over).toBeGreaterThan(800);
    expect(between).toBeGreaterThan(40);
    expect(none).toBeGreaterThan(1200);
  });
});

describe('끝까지 달릴 수 있는지', () => {
  /** 화면이 장애물을 놓는 것과 같은 방법으로 달려 본다. 누르는 순간이 정확한 봇이 부딪히면 그 시간을, 끝까지 가면 null을 돌려준다. */
  function runPerfectly(seed: number, seconds: number): number | null {
    const random = seeded(seed);
    const runnerX = 0;
    const spawnAt = VIEW_AHEAD + 40;
    const apex = JUMP_VELOCITY / GRAVITY;
    interface Group {
      parts: { kind: ObstacleKind; x: number }[];
      jumped: boolean;
    }
    const groups: Group[] = [];
    let frontier = runnerX;
    let elapsed = 0;
    let body: RunnerState = newRunner();
    let held = false;

    const spawnAhead = (): void => {
      while (frontier < spawnAt) {
        const spawn = nextSpawn(elapsed, random);
        const gap = groups.length === 0 ? Math.round(runSpeed(0) * FIRST_GAP_SECONDS) : spawn.gap;
        const x = Math.max(frontier + gap, VIEW_AHEAD + 16);
        groups.push({ parts: spawn.obstacles.map((part) => ({ kind: part.kind, x: x + part.offset })), jumped: false });
        frontier = x + spawn.width;
      }
    };

    spawnAhead();
    while (elapsed < seconds) {
      const speed = runSpeed(elapsed);
      // 아직 지나가지 않은 맨 앞의 것을 본다. 땅에 붙은 것이 있으면 그 한가운데에서 꼭대기에 오르게 뛰고, 박쥐뿐이면 그냥 달린다.
      const next = groups.find((group) =>
        group.parts.some((part) => part.x + OBSTACLE_BOX[part.kind].width > runnerX - RUNNER_BOX.width / 2),
      );
      let pressed = false;
      if (next && !next.jumped && body.grounded) {
        const onGround = next.parts.some((part) => OBSTACLE_BOX[part.kind].bottom === 0);
        const left = Math.min(...next.parts.map((part) => part.x));
        const right = Math.max(...next.parts.map((part) => part.x + OBSTACLE_BOX[part.kind].width));
        if (!onGround) {
          next.jumped = true;
        } else if ((left + right) / 2 - runnerX <= speed * apex) {
          next.jumped = true;
          pressed = true;
          held = true;
        }
      }
      if (body.grounded && !pressed) held = false;

      elapsed += DT;
      const dx = runSpeed(elapsed) * DT;
      body = stepRunner(body, { pressed, held }, DT).state;
      frontier -= dx;
      for (const group of groups) for (const part of group.parts) part.x -= dx;
      spawnAhead();
      for (const group of groups) {
        for (const part of group.parts) {
          if (touches(runnerX, body.y, part.x, OBSTACLE_BOX[part.kind])) return elapsed;
        }
      }
      while (groups.length > 1 && groups[0].parts.every((part) => part.x + OBSTACLE_BOX[part.kind].width < -60)) {
        groups.shift();
      }
    }
    return null;
  }

  it('누르는 순간이 정확하면 2막에서도 부딪히지 않는다: 넘을 수 없는 배치는 나오지 않는다', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      expect(runPerfectly(seed, 300), `시드 ${seed}`).toBeNull();
    }
  }, 60_000);
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
