import { describe, expect, it } from 'vitest';
import { GAME_WIDTH } from '../../config';
import {
  applyGate,
  betterSide,
  clampToRoad,
  enemiesFor,
  enemyRatio,
  FIRST_SEGMENT_ROWS,
  GATE_POINTS,
  gateLabel,
  hitWall,
  isBoost,
  isOver,
  laneCenter,
  MAX_CROWD,
  MAX_SPEED,
  newCourse,
  newRun,
  nextSegment,
  pairMix,
  passGate,
  RATIO_FULL_SEGMENT,
  RATIO_MAX,
  RATIO_START,
  ROAD_CENTER,
  ROAD_LEFT,
  ROAD_MARGIN,
  ROAD_RIGHT,
  rowsIn,
  scrollSpeed,
  sideAt,
  START_CROWD,
  START_SPEED,
  steer,
  TARGET_MAX,
  TARGET_START,
  WALL_POINTS,
  WALL_POINTS_CAP_SEGMENT,
  WALL_POINTS_GAIN,
  wallPoints,
  wallTarget,
  type Course,
  type Gate,
  type GatePair,
  type RunState,
  type Segment,
  type Side,
} from './rules';

/** 씨앗이 같으면 언제나 같은 수열을 내는 작은 난수기(mulberry32) */
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

const add = (value: number): Gate => ({ kind: 'add', value });
const sub = (value: number): Gate => ({ kind: 'sub', value });
const mul = (value: number): Gate => ({ kind: 'mul', value });
const div = (value: number): Gate => ({ kind: 'div', value });
const other = (side: Side): Side => (side === 'left' ? 'right' : 'left');

interface Built {
  segment: Segment;
  /** 이 구간에 들어설 때의 가장 좋은 무리 수 */
  idealIn: number;
}

/** 씨앗 하나로 길을 count구간만큼 만든다. */
function buildCourse(seed: number, count: number): Built[] {
  const random = seeded(seed);
  const built: Built[] = [];
  let course: Course = newCourse();
  for (let i = 0; i < count; i += 1) {
    const next = nextSegment(course, random);
    built.push({ segment: next.segment, idealIn: course.ideal });
    course = next.course;
  }
  return built;
}

const SEEDS = 120;
const SEGMENTS = 60;
/** 여러 씨앗으로 만든 길. 생성기의 보장은 이 길들을 모두 훑어서 확인한다. */
const COURSES = Array.from({ length: SEEDS }, (_, seed) => buildCourse(seed * 7919 + 1, SEGMENTS));

function eachPair(visit: (pair: GatePair, ideal: number, segment: Segment, row: number) => void): void {
  for (const course of COURSES) {
    for (const { segment, idealIn } of course) {
      let ideal = idealIn;
      segment.pairs.forEach((pair, row) => {
        visit(pair, ideal, segment, row);
        ideal = applyGate(ideal, pair[betterSide(ideal, pair)]);
      });
    }
  }
}

/** pick이 고르는 쪽으로 한 판을 끝까지(또는 길이 끝날 때까지) 달린다. */
function playThrough(course: Built[], pick: (crowd: number, pair: GatePair) => Side): RunState {
  let run = newRun();
  for (const { segment } of course) {
    for (const pair of segment.pairs) {
      run = passGate(run, pair[pick(run.crowd, pair)]);
      if (isOver(run)) return run;
    }
    run = hitWall(run, segment.enemies, segment.index).state;
    if (isOver(run)) return run;
  }
  return run;
}

describe('길과 조종', () => {
  it('길은 화면 안에 있고 가운데 선은 화면의 가운데다', () => {
    expect(ROAD_LEFT).toBeGreaterThan(0);
    expect(ROAD_RIGHT).toBeLessThan(GAME_WIDTH);
    expect(ROAD_CENTER).toBe(GAME_WIDTH / 2);
  });

  it('무리의 중심이 있는 쪽의 관문을 지난다. 딱 가운데 선은 오른쪽이다', () => {
    expect(sideAt(ROAD_LEFT)).toBe('left');
    expect(sideAt(ROAD_CENTER - 0.1)).toBe('left');
    expect(sideAt(ROAD_CENTER)).toBe('right');
    expect(sideAt(ROAD_RIGHT)).toBe('right');
  });

  it('관문의 가운데는 길의 반쪽마다 한가운데다', () => {
    expect(laneCenter('left')).toBe((ROAD_LEFT + ROAD_CENTER) / 2);
    expect(laneCenter('right')).toBe((ROAD_CENTER + ROAD_RIGHT) / 2);
    expect(sideAt(laneCenter('left'))).toBe('left');
    expect(sideAt(laneCenter('right'))).toBe('right');
  });

  it('무리는 길 가장자리에서 여유를 두고 멈춘다', () => {
    expect(clampToRoad(-50)).toBe(ROAD_LEFT + ROAD_MARGIN);
    expect(clampToRoad(999)).toBe(ROAD_RIGHT - ROAD_MARGIN);
    expect(clampToRoad(100)).toBe(100);
    // 가장자리까지 밀어도 관문의 가운데에는 닿을 수 있다.
    expect(clampToRoad(laneCenter('left'))).toBe(laneCenter('left'));
    expect(clampToRoad(laneCenter('right'))).toBe(laneCenter('right'));
  });

  it('가려는 곳으로 부드럽게 다가가고 지나치지 않는다', () => {
    let x = laneCenter('left');
    const target = laneCenter('right');
    let previous = x;
    for (let frame = 0; frame < 60; frame += 1) {
      x = steer(x, target, 1 / 60);
      expect(x).toBeGreaterThan(previous);
      expect(x).toBeLessThanOrEqual(target);
      previous = x;
    }
    // 0.25초면 반대쪽 관문 아래에 들어가 있고, 1초면 거의 다 갔다.
    expect(sideAt(steer(laneCenter('left'), target, 0.25))).toBe('right');
    expect(target - x).toBeLessThan(0.01);
  });

  it('프레임이 느려도 같은 시간 뒤에는 같은 자리에 있다', () => {
    const once = steer(60, 180, 0.1);
    const twice = steer(steer(60, 180, 0.05), 180, 0.05);
    expect(twice).toBeCloseTo(once);
    expect(steer(60, 180, 0)).toBe(60);
  });

  it('길 밖을 가리켜도 길 안에서 멈춘다', () => {
    expect(steer(100, -500, 10)).toBeCloseTo(ROAD_LEFT + ROAD_MARGIN);
    expect(steer(100, 900, 10)).toBeCloseTo(ROAD_RIGHT - ROAD_MARGIN);
  });
});

describe('난이도', () => {
  it('속도는 처음 속도에서 시작해 구간마다 빨라지고 상한에서 멈춘다', () => {
    expect(scrollSpeed(0)).toBe(START_SPEED);
    expect(scrollSpeed(-3)).toBe(START_SPEED);
    for (let segment = 1; segment <= 60; segment += 1) {
      expect(scrollSpeed(segment)).toBeGreaterThanOrEqual(scrollSpeed(segment - 1));
    }
    expect(scrollSpeed(5)).toBeGreaterThan(scrollSpeed(4));
    expect(scrollSpeed(1000)).toBe(MAX_SPEED);
  });

  it('적의 비율은 구간마다 오르고 상한에서 멈춘다', () => {
    expect(enemyRatio(0)).toBe(RATIO_START);
    expect(enemyRatio(-2)).toBe(RATIO_START);
    for (let segment = 1; segment <= RATIO_FULL_SEGMENT; segment += 1) {
      expect(enemyRatio(segment)).toBeGreaterThan(enemyRatio(segment - 1));
    }
    expect(enemyRatio(RATIO_FULL_SEGMENT)).toBeCloseTo(RATIO_MAX);
    expect(enemyRatio(500)).toBeCloseTo(RATIO_MAX);
    expect(RATIO_MAX).toBeLessThan(1);
  });

  it('적은 가장 좋은 무리에 비율을 곱한 수이고, 언제나 그보다 적다', () => {
    expect(enemiesFor(20, 0)).toBe(Math.round(20 * RATIO_START));
    expect(enemiesFor(100, 500)).toBe(Math.round(100 * RATIO_MAX));
    for (let ideal = 2; ideal <= 400; ideal += 1) {
      for (const segment of [0, 7, 19, 30, 90]) {
        const enemies = enemiesFor(ideal, segment);
        expect(enemies).toBeGreaterThanOrEqual(1);
        expect(enemies).toBeLessThan(ideal);
      }
    }
    // 반올림하면 다 잡아먹힐 만큼 적은 무리라도 한 마리는 남긴다.
    expect(enemiesFor(3, 500)).toBe(2);
    expect(enemiesFor(2, 500)).toBe(1);
  });

  it('적 앞에서 바라는 무리 크기는 구간마다 커지다가 상한에서 멈춘다', () => {
    expect(wallTarget(0)).toBe(TARGET_START);
    for (let segment = 1; segment <= 60; segment += 1) {
      expect(wallTarget(segment)).toBeGreaterThanOrEqual(wallTarget(segment - 1));
    }
    expect(wallTarget(1000)).toBe(TARGET_MAX);
    expect(TARGET_MAX).toBeLessThan(MAX_CROWD / 2);
  });

  it('첫 구간은 뻔한 쌍뿐이고, 갈수록 셈이 필요한 쌍과 둘 다 나쁜 쌍이 늘어난다', () => {
    expect(pairMix(0)).toEqual({ clear: 1, arith: 0, evil: 0 });
    for (let segment = 0; segment <= 60; segment += 1) {
      const mix = pairMix(segment);
      expect(mix.clear + mix.arith + mix.evil).toBeCloseTo(1);
      expect(mix.clear).toBeGreaterThan(0);
      if (segment === 0) continue;
      const before = pairMix(segment - 1);
      expect(mix.arith).toBeGreaterThanOrEqual(before.arith);
      expect(mix.evil).toBeGreaterThanOrEqual(before.evil);
    }
    expect(pairMix(30).arith).toBeGreaterThan(pairMix(3).arith);
    expect(pairMix(30).evil).toBeGreaterThan(0);
    expect(pairMix(1000)).toEqual(pairMix(60));
  });

  it('첫 구간은 관문 줄이 둘이고, 그 뒤로는 둘 아니면 셋이다', () => {
    expect(rowsIn(0, 0)).toBe(FIRST_SEGMENT_ROWS);
    expect(rowsIn(0, 0.99)).toBe(FIRST_SEGMENT_ROWS);
    expect(rowsIn(4, 0)).toBe(2);
    expect(rowsIn(4, 0.49)).toBe(2);
    expect(rowsIn(4, 0.5)).toBe(3);
    expect(rowsIn(4, 0.99)).toBe(3);
  });
});

describe('관문', () => {
  it('더하고 빼고 곱하고 나눈다', () => {
    expect(applyGate(5, add(8))).toBe(13);
    expect(applyGate(13, sub(5))).toBe(8);
    expect(applyGate(8, mul(2))).toBe(16);
    expect(applyGate(16, div(2))).toBe(8);
    expect(applyGate(16, mul(3))).toBe(48);
  });

  it('무리는 0 아래로 내려가지 않고 상한을 넘지 않는다', () => {
    expect(applyGate(3, sub(5))).toBe(0);
    expect(applyGate(3, sub(3))).toBe(0);
    expect(applyGate(MAX_CROWD - 2, add(50))).toBe(MAX_CROWD);
    expect(applyGate(600, mul(2))).toBe(MAX_CROWD);
    expect(applyGate(0, mul(3))).toBe(0);
  });

  it('나누기는 올림이라서 나누기만으로는 사라지지 않는다', () => {
    expect(applyGate(7, div(2))).toBe(4);
    expect(applyGate(7, div(3))).toBe(3);
    expect(applyGate(1, div(2))).toBe(1);
    expect(applyGate(1, div(3))).toBe(1);
  });

  it('무리가 많을수록 어떤 관문을 지나도 적어지지 않는다', () => {
    // 이 성질 덕분에 줄마다 더 좋은 쪽만 고른 것이 곧 낼 수 있는 가장 큰 무리다.
    for (const gate of [add(7), sub(7), mul(2), mul(3), div(2), div(3)]) {
      for (let crowd = 1; crowd <= 400; crowd += 1) {
        expect(applyGate(crowd, gate)).toBeGreaterThanOrEqual(applyGate(crowd - 1, gate));
      }
    }
  });

  it('관문에 적는 글자', () => {
    expect(gateLabel(add(8))).toBe('+8');
    expect(gateLabel(sub(5))).toBe('-5');
    expect(gateLabel(mul(2))).toBe('x2');
    expect(gateLabel(div(2))).toBe('÷2');
  });

  it('더하기와 곱하기는 좋은 관문, 빼기와 나누기는 나쁜 관문이다', () => {
    expect(isBoost(add(1))).toBe(true);
    expect(isBoost(mul(2))).toBe(true);
    expect(isBoost(sub(1))).toBe(false);
    expect(isBoost(div(2))).toBe(false);
  });

  it('어느 쪽이 나은지는 지금 무리 수에 달려 있다', () => {
    const pair: GatePair = { left: add(12), right: mul(2) };
    expect(betterSide(5, pair)).toBe('left');
    expect(betterSide(20, pair)).toBe('right');
    // 결과가 같으면 왼쪽으로 친다.
    expect(betterSide(12, pair)).toBe('left');

    const evil: GatePair = { left: sub(5), right: div(2) };
    expect(betterSide(30, evil)).toBe('left');
    expect(betterSide(8, evil)).toBe('right');
  });
});

describe('길 만들기', () => {
  it('씨앗이 같으면 같은 길이 나오고, 받은 상태는 바꾸지 않는다', () => {
    expect(buildCourse(42, 30)).toEqual(buildCourse(42, 30));
    expect(buildCourse(42, 30)).not.toEqual(buildCourse(43, 30));

    const course = newCourse();
    const { segment, course: next } = nextSegment(course, seeded(7));
    expect(course).toEqual({ segment: 0, ideal: START_CROWD });
    expect(segment.index).toBe(0);
    expect(next.segment).toBe(1);
    expect(next.ideal).toBe(segment.idealAtWall - segment.enemies);
  });

  it('구간마다 관문 줄이 두세 개이고 번호가 차례로 붙는다', () => {
    const counts = new Set<number>();
    for (const course of COURSES) {
      course.forEach(({ segment }, index) => {
        expect(segment.index).toBe(index);
        expect(segment.pairs.length).toBe(rowsIn(index, segment.pairs.length === 2 ? 0 : 0.9));
        if (index > 0) counts.add(segment.pairs.length);
      });
      expect(course[0].segment.pairs).toHaveLength(FIRST_SEGMENT_ROWS);
    }
    expect([...counts].sort()).toEqual([2, 3]);
  });

  it('관문의 수는 모두 1 이상의 정수이고 글자는 네 자를 넘지 않는다', () => {
    eachPair((pair) => {
      for (const gate of [pair.left, pair.right]) {
        expect(Number.isInteger(gate.value)).toBe(true);
        expect(gate.value).toBeGreaterThanOrEqual(1);
        expect(gateLabel(gate).length).toBeLessThanOrEqual(4);
        if (gate.kind === 'mul' || gate.kind === 'div') expect([2, 3]).toContain(gate.value);
      }
    });
  });

  it('한 줄에 똑같은 관문이 둘 놓이지 않고, 가장 좋은 무리에게는 한쪽이 분명히 낫다', () => {
    eachPair((pair, ideal) => {
      expect(pair.left).not.toEqual(pair.right);
      expect(applyGate(ideal, pair.left)).not.toBe(applyGate(ideal, pair.right));
    });
  });

  it('가장 좋은 무리는 나쁜 쪽을 골라도 그 자리에서 사라지지는 않는다', () => {
    eachPair((pair, ideal) => {
      expect(applyGate(ideal, pair.left)).toBeGreaterThanOrEqual(1);
      expect(applyGate(ideal, pair.right)).toBeGreaterThanOrEqual(1);
    });
  });

  it('더 좋은 쪽만 고르면 몇 구간을 가든 반드시 살아남는다', () => {
    for (const course of COURSES) {
      let run = newRun();
      for (const { segment, idealIn } of course) {
        expect(run.crowd).toBe(idealIn);
        for (const pair of segment.pairs) {
          run = passGate(run, pair[betterSide(run.crowd, pair)]);
          expect(isOver(run)).toBe(false);
        }
        expect(run.crowd).toBe(segment.idealAtWall);
        const hit = hitWall(run, segment.enemies, segment.index);
        expect(hit.clash.broken).toBe(true);
        run = hit.state;
        expect(run.crowd).toBeGreaterThanOrEqual(1);
      }
      expect(run.walls).toBe(SEGMENTS);
    }
  });

  it('적의 수는 가장 좋은 무리에 그 구간의 비율을 곱한 것이다', () => {
    for (const course of COURSES) {
      for (const { segment } of course) {
        expect(segment.enemies).toBe(enemiesFor(segment.idealAtWall, segment.index));
        expect(segment.enemies).toBeLessThan(segment.idealAtWall);
        // 적 앞에 선 무리는 반올림 때문에 다 잡아먹힐 만큼 적지는 않다.
        expect(segment.idealAtWall).toBeGreaterThanOrEqual(4);
        expect(segment.enemies).toBe(Math.round(segment.idealAtWall * enemyRatio(segment.index)));
      }
    }
  });

  it('구간 안에서 어떻게 골라도 더 좋은 쪽만 고른 것보다 많아지지 않는다', () => {
    for (const course of COURSES.slice(0, 60)) {
      for (const { segment, idealIn } of course) {
        const rows = segment.pairs.length;
        let most = 0;
        for (let mask = 0; mask < 2 ** rows; mask += 1) {
          let crowd = idealIn;
          segment.pairs.forEach((pair, row) => {
            crowd = applyGate(crowd, (mask >> row) & 1 ? pair.right : pair.left);
          });
          most = Math.max(most, crowd);
        }
        expect(most).toBe(segment.idealAtWall);
      }
    }
  });

  it('아무렇게나 고르는 무리는 가장 좋은 무리를 한 번도 앞지르지 못한다', () => {
    COURSES.slice(0, 60).forEach((course, index) => {
      const coin = seeded(index + 99);
      let run = newRun();
      for (const { segment } of course) {
        for (const pair of segment.pairs) run = passGate(run, coin() < 0.5 ? pair.left : pair.right);
        expect(run.crowd).toBeLessThanOrEqual(segment.idealAtWall);
        run = hitWall(run, segment.enemies, segment.index).state;
        if (isOver(run)) break;
      }
    });
  });

  it('가장 좋은 무리도 세 자리 안의 읽기 쉬운 수에 머문다', () => {
    let largest = 0;
    for (const course of COURSES) {
      for (const { segment } of course) largest = Math.max(largest, segment.idealAtWall);
    }
    // 상한에 닿아 잘리는 일 없이 넉넉히 아래에 있다.
    expect(largest).toBeLessThan(MAX_CROWD / 2);
    expect(largest).toBeGreaterThan(TARGET_MAX);
  });

  it('무리가 이미 크면 곱하기를 내지 않는다', () => {
    eachPair((pair, ideal) => {
      if (ideal < TARGET_MAX) return;
      expect(pair.left.kind).not.toBe('mul');
      expect(pair.right.kind).not.toBe('mul');
    });
  });

  it('첫 구간은 좋은 관문과 나쁜 관문이 한 줄에 하나씩이다', () => {
    for (const course of COURSES) {
      for (const pair of course[0].segment.pairs) {
        expect(isBoost(pair.left)).not.toBe(isBoost(pair.right));
      }
    }
  });

  it('뻔한 쌍, 셈이 필요한 쌍, 둘 다 나쁜 쌍이 모두 나오고 좌우는 고르게 섞인다', () => {
    let arith = 0;
    let evil = 0;
    let clear = 0;
    let total = 0;
    let bestOnLeft = 0;
    eachPair((pair, ideal) => {
      total += 1;
      if (betterSide(ideal, pair) === 'left') bestOnLeft += 1;
      const kinds = [pair.left.kind, pair.right.kind].sort().join('/');
      if (kinds === 'add/mul') arith += 1;
      else if (!isBoost(pair.left) && !isBoost(pair.right)) evil += 1;
      else if (isBoost(pair.left) !== isBoost(pair.right)) clear += 1;
    });
    expect(arith / total).toBeGreaterThan(0.2);
    expect(clear / total).toBeGreaterThan(0.1);
    expect(evil / total).toBeGreaterThan(0.02);
    expect(evil / total).toBeLessThan(0.15);
    expect(bestOnLeft / total).toBeGreaterThan(0.45);
    expect(bestOnLeft / total).toBeLessThan(0.55);
  });

  it('둘 다 나쁜 쌍은 한 구간에 한 번까지만 나온다', () => {
    for (const course of COURSES) {
      for (const { segment } of course) {
        const evil = segment.pairs.filter((pair) => !isBoost(pair.left) && !isBoost(pair.right));
        expect(evil.length).toBeLessThanOrEqual(1);
      }
    }
  });

  it('셈이 필요한 쌍은 뒤로 갈수록 자주 나온다', () => {
    const share = (from: number, to: number): number => {
      let arith = 0;
      let total = 0;
      for (const course of COURSES) {
        for (const { segment } of course.slice(from, to)) {
          for (const pair of segment.pairs) {
            total += 1;
            if ([pair.left.kind, pair.right.kind].sort().join('/') === 'add/mul') arith += 1;
          }
        }
      }
      return arith / total;
    };
    expect(share(0, 1)).toBe(0);
    expect(share(5, 10)).toBeGreaterThan(share(1, 5));
    expect(share(15, 25)).toBeGreaterThan(share(5, 10));
    expect(share(40, 60)).toBeGreaterThan(share(15, 25));
  });
});

describe('한 판', () => {
  it('처음에는 적은 무리로 시작한다', () => {
    expect(newRun()).toEqual({
      crowd: START_CROWD,
      score: 0,
      gates: 0,
      walls: 0,
      maxCrowd: START_CROWD,
    });
    expect(isOver(newRun())).toBe(false);
  });

  it('관문을 지나면 무리가 바뀌고 점수가 붙는다', () => {
    const run = newRun();
    const grown = passGate(run, add(8));
    expect(grown).toEqual({
      crowd: START_CROWD + 8,
      score: GATE_POINTS,
      gates: 1,
      walls: 0,
      maxCrowd: START_CROWD + 8,
    });
    // 원본은 그대로다.
    expect(run).toEqual(newRun());

    const shrunk = passGate(grown, sub(10));
    expect(shrunk).toMatchObject({ crowd: 3, gates: 2, score: GATE_POINTS * 2 });
    // 가장 많았던 수는 줄어든 뒤에도 남는다.
    expect(shrunk.maxCrowd).toBe(START_CROWD + 8);
  });

  it('관문에서 무리가 바닥나면 끝이고 점수는 붙지 않는다', () => {
    const run = passGate(newRun(), add(3));
    const gone = passGate(run, sub(20));
    expect(gone.crowd).toBe(0);
    expect(isOver(gone)).toBe(true);
    expect(gone.score).toBe(run.score);
    expect(gone.gates).toBe(run.gates);
  });

  it('적과 부딪히면 적의 수만큼 줄고, 남으면 뚫은 것이다', () => {
    const run: RunState = { crowd: 30, score: 7, gates: 4, walls: 2, maxCrowd: 30 };
    const { state, clash } = hitWall(run, 12, 2);
    expect(clash).toEqual({ lost: 12, broken: true, points: wallPoints(2) });
    expect(state).toEqual({
      crowd: 18,
      score: 7 + wallPoints(2),
      gates: 4,
      walls: 3,
      maxCrowd: 30,
    });
    expect(run.crowd).toBe(30);
  });

  it('적과 수가 같거나 적이 더 많으면 무리가 바닥나서 끝난다', () => {
    const run: RunState = { crowd: 12, score: 7, gates: 4, walls: 2, maxCrowd: 30 };
    for (const enemies of [12, 13, 500]) {
      const { state, clash } = hitWall(run, enemies, 2);
      expect(clash).toEqual({ lost: 12, broken: false, points: 0 });
      expect(state).toMatchObject({ crowd: 0, score: 7, walls: 2 });
      expect(isOver(state)).toBe(true);
    }
  });

  it('뒤 구간의 적일수록 점수가 많고, 정해진 구간부터는 더 오르지 않는다', () => {
    expect(wallPoints(0)).toBe(WALL_POINTS);
    expect(wallPoints(-4)).toBe(WALL_POINTS);
    expect(wallPoints(3)).toBe(WALL_POINTS + 3 * WALL_POINTS_GAIN);
    for (let segment = 1; segment <= WALL_POINTS_CAP_SEGMENT; segment += 1) {
      expect(wallPoints(segment)).toBeGreaterThan(wallPoints(segment - 1));
    }
    expect(wallPoints(WALL_POINTS_CAP_SEGMENT + 40)).toBe(wallPoints(WALL_POINTS_CAP_SEGMENT));
    // 적 한 무리가 관문 한 줄보다 훨씬 값지다.
    expect(WALL_POINTS).toBeGreaterThan(GATE_POINTS * 3);
  });

  it('점수는 지나간 관문과 뚫은 적의 점수를 더한 것이다', () => {
    const course = COURSES[0].slice(0, 12);
    const run = playThrough(course, betterSide);
    const rows = course.reduce((sum, { segment }) => sum + segment.pairs.length, 0);
    const walls = course.reduce((sum, { segment }) => sum + wallPoints(segment.index), 0);
    expect(run.gates).toBe(rows);
    expect(run.walls).toBe(12);
    expect(run.score).toBe(rows * GATE_POINTS + walls);
    expect(Number.isInteger(run.score)).toBe(true);
    expect(run.maxCrowd).toBe(Math.max(...course.map(({ segment }) => segment.idealAtWall)));
  });

  it('나쁜 쪽만 고르면 첫 적을 넘지 못한다', () => {
    for (const course of COURSES) {
      const run = playThrough(course, (crowd, pair) => other(betterSide(crowd, pair)));
      expect(isOver(run)).toBe(true);
      expect(run.walls).toBe(0);
      expect(run.score).toBeLessThanOrEqual(FIRST_SEGMENT_ROWS * GATE_POINTS);
    }
  });

  it('첫 구간에서 한 번 잘못 고른 것만으로는 끝나지 않는다', () => {
    for (const course of COURSES) {
      for (let slip = 0; slip < FIRST_SEGMENT_ROWS; slip += 1) {
        let row = 0;
        const run = playThrough(course.slice(0, 1), (crowd, pair) => {
          const best = betterSide(crowd, pair);
          row += 1;
          return row - 1 === slip ? other(best) : best;
        });
        expect(isOver(run)).toBe(false);
      }
    }
  });

  it('아무렇게나 고르면 오래가지 못하고, 잘못 고른 것이 쌓일수록 일찍 끝난다', () => {
    /** 줄마다 slip의 확률로 나쁜 쪽을 고를 때 뚫은 적의 평균 */
    const averageWalls = (slip: number): number => {
      let walls = 0;
      COURSES.forEach((course, index) => {
        const mind = seeded(index * 31 + 5);
        const run = playThrough(course, (crowd, pair) => {
          const best = betterSide(crowd, pair);
          return mind() < slip ? other(best) : best;
        });
        walls += run.walls;
      });
      return walls / COURSES.length;
    };
    const coinFlip = averageWalls(0.5);
    const sloppy = averageWalls(0.15);
    const careful = averageWalls(0.03);
    expect(coinFlip).toBeLessThan(4);
    expect(sloppy).toBeGreaterThan(coinFlip);
    expect(careful).toBeGreaterThan(sloppy + 3);
    expect(careful).toBeLessThan(SEGMENTS);
  });
});
