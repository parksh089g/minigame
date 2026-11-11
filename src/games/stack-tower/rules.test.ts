import { describe, expect, it } from 'vitest';
import { GAME_WIDTH } from '../../config';
import {
  baseSpeed,
  drop,
  FIELD_WIDTH,
  FLOOR_POINTS,
  GROW_STREAK,
  GROW_WIDTH,
  JITTER_FROM_FLOOR,
  MAX_SPEED,
  MAX_STREAK_BONUS,
  moverLeft,
  moverRange,
  moverSpeed,
  newTower,
  PERFECT_POINTS,
  PERFECT_TOLERANCE,
  pointsFor,
  SPEED_JITTER,
  START_SPEED,
  START_WIDTH,
  type TowerState,
} from './rules';

/** 맨 위 블록만 바꾼 탑 */
const towerWith = (left: number, width: number, extra: Partial<TowerState> = {}): TowerState => ({
  ...newTower(),
  top: { left, width },
  ...extra,
});

describe('속도', () => {
  it('처음 속도에서 시작해 층마다 빨라지고 상한에서 멈춘다', () => {
    expect(baseSpeed(0)).toBe(START_SPEED);
    expect(baseSpeed(10)).toBeGreaterThan(baseSpeed(9));
    expect(baseSpeed(1000)).toBe(MAX_SPEED);
    expect(baseSpeed(-5)).toBe(START_SPEED);
  });

  it('처음 몇 층은 흔들림 없이 같은 속도다', () => {
    for (let floors = 0; floors < JITTER_FROM_FLOOR; floors += 1) {
      expect(moverSpeed(floors, 0)).toBe(baseSpeed(floors));
      expect(moverSpeed(floors, 0.999)).toBe(baseSpeed(floors));
    }
  });

  it('그 뒤로는 정해진 폭 안에서만 흔들린다', () => {
    const floors = JITTER_FROM_FLOOR + 3;
    const base = baseSpeed(floors);
    expect(moverSpeed(floors, 0)).toBeCloseTo(base * (1 - SPEED_JITTER));
    expect(moverSpeed(floors, 0.5)).toBeCloseTo(base);
    expect(moverSpeed(floors, 0.999)).toBeLessThan(base * (1 + SPEED_JITTER));
    expect(moverSpeed(floors, 0.999)).toBeGreaterThan(base);
  });
});

describe('움직이는 블록', () => {
  it('판의 폭은 화면의 가로 길이와 같다', () => {
    expect(FIELD_WIDTH).toBe(GAME_WIDTH);
  });

  it('양 끝에서 블록의 절반까지만 화면 밖으로 나간다', () => {
    expect(moverRange(96)).toEqual({ min: -48, max: FIELD_WIDTH - 48 });
    expect(moverRange(9)).toEqual({ min: -4, max: FIELD_WIDTH - 5 });
  });

  it('한쪽 끝에서 출발해 반대쪽 끝에서 되돌아온다', () => {
    const width = 60;
    const { min, max } = moverRange(width);
    const span = max - min;
    const speed = 120;
    expect(moverLeft(width, speed, 0, true)).toBe(min);
    expect(moverLeft(width, speed, 0, false)).toBe(max);
    expect(moverLeft(width, speed, span / speed, true)).toBeCloseTo(max);
    expect(moverLeft(width, speed, (span * 1.5) / speed, true)).toBeCloseTo(min + span / 2);
    expect(moverLeft(width, speed, (span * 2) / speed, true)).toBeCloseTo(min);
    expect(moverLeft(width, speed, (span * 0.25) / speed, false)).toBeCloseTo(max - span / 4);
  });

  it('언제나 범위 안에 있고, 탑이 어디에 있든 그 위를 지나간다', () => {
    for (const width of [3, 20, 61, 96]) {
      const { min, max } = moverRange(width);
      // 탑은 화면 안에만 있으므로 블록이 0과 (판의 폭 - 블록 폭)을 모두 지나면 된다.
      expect(min).toBeLessThanOrEqual(0);
      expect(max).toBeGreaterThanOrEqual(FIELD_WIDTH - width);
      for (let t = 0; t < 12; t += 0.137) {
        const left = moverLeft(width, 210, t, true);
        expect(left).toBeGreaterThanOrEqual(min);
        expect(left).toBeLessThanOrEqual(max);
      }
    }
  });
});

describe('점수', () => {
  it('한 층에 기본 점수, 딱 맞히면 보너스, 이어서 맞히면 조금씩 더', () => {
    expect(pointsFor(false, 0)).toBe(FLOOR_POINTS);
    expect(pointsFor(true, 1)).toBe(FLOOR_POINTS + PERFECT_POINTS);
    expect(pointsFor(true, 2)).toBe(FLOOR_POINTS + PERFECT_POINTS + 1);
    expect(pointsFor(true, 50)).toBe(FLOOR_POINTS + PERFECT_POINTS + MAX_STREAK_BONUS);
  });
});

describe('drop', () => {
  it('처음 탑은 받침이 가운데에 있고 아무것도 쌓이지 않았다', () => {
    const tower = newTower();
    expect(tower.top).toEqual({ left: (FIELD_WIDTH - START_WIDTH) / 2, width: START_WIDTH });
    expect(tower).toMatchObject({ floors: 0, streak: 0, bestStreak: 0, perfects: 0, score: 0 });
  });

  it('허용 폭 안으로 어긋나면 딱 맞은 것으로 치고 줄어들지 않는다', () => {
    for (const offset of [-PERFECT_TOLERANCE, -1, 0, 2, PERFECT_TOLERANCE]) {
      const tower = towerWith(80, 50);
      const { state, outcome } = drop(tower, 80 + offset);
      expect(outcome).toEqual({
        kind: 'perfect',
        placed: { left: 80, width: 50 },
        grew: false,
        points: pointsFor(true, 1),
      });
      expect(state).toMatchObject({ floors: 1, streak: 1, bestStreak: 1, perfects: 1 });
      expect(state.score).toBe(pointsFor(true, 1));
      // 원본은 그대로다.
      expect(tower).toMatchObject({ floors: 0, streak: 0, score: 0 });
    }
  });

  it('오른쪽으로 어긋나면 걸친 만큼만 남고 오른쪽 조각이 떨어진다', () => {
    const { state, outcome } = drop(towerWith(80, 50, { streak: 2, bestStreak: 2 }), 92);
    expect(outcome).toEqual({
      kind: 'trim',
      placed: { left: 92, width: 38 },
      cut: { left: 130, width: 12 },
      points: FLOOR_POINTS,
    });
    expect(state.top).toEqual({ left: 92, width: 38 });
    // 연속은 끊기지만 가장 긴 기록은 남는다.
    expect(state).toMatchObject({ floors: 1, streak: 0, bestStreak: 2, perfects: 0, score: FLOOR_POINTS });
  });

  it('왼쪽으로 어긋나면 왼쪽 조각이 떨어진다', () => {
    const { state, outcome } = drop(towerWith(80, 50), 70);
    expect(outcome).toEqual({
      kind: 'trim',
      placed: { left: 80, width: 40 },
      cut: { left: 70, width: 10 },
      points: FLOOR_POINTS,
    });
    expect(state.top).toEqual({ left: 80, width: 40 });
  });

  it('남은 조각과 떨어진 조각을 합치면 내려놓은 블록과 같다', () => {
    for (const moverX of [41, 60, 76, 84, 99, 125]) {
      const tower = towerWith(80, 50);
      const { outcome } = drop(tower, moverX);
      expect(outcome.kind).toBe('trim');
      if (outcome.kind !== 'trim') continue;
      expect(outcome.placed.width + outcome.cut.width).toBe(50);
      const left = Math.min(outcome.placed.left, outcome.cut.left);
      const right = Math.max(
        outcome.placed.left + outcome.placed.width,
        outcome.cut.left + outcome.cut.width,
      );
      expect([left, right]).toEqual([moverX, moverX + 50]);
      // 남은 조각은 아래 블록을 벗어나지 않는다.
      expect(outcome.placed.left).toBeGreaterThanOrEqual(80);
      expect(outcome.placed.left + outcome.placed.width).toBeLessThanOrEqual(130);
    }
  });

  it('하나도 걸치지 않으면 빗나간 것이고 상태는 그대로다', () => {
    const tower = towerWith(80, 50, { floors: 7, score: 40 });
    for (const moverX of [30, 20, 130, 160]) {
      const { state, outcome } = drop(tower, moverX);
      expect(outcome).toEqual({ kind: 'miss' });
      expect(state).toBe(tower);
    }
  });

  it('소수점 자리는 가까운 픽셀로 맞춰서 블록이 언제나 정수 폭이다', () => {
    const { outcome } = drop(towerWith(80, 50), 90.6);
    expect(outcome).toMatchObject({ kind: 'trim', placed: { left: 91, width: 39 } });
    expect(drop(towerWith(80, 50), 83.4).outcome.kind).toBe('perfect');
    expect(drop(towerWith(80, 50), 83.6).outcome.kind).toBe('trim');
  });

  it('연속으로 딱 맞히면 점수가 오르고, 정해진 횟수부터는 블록이 다시 넓어진다', () => {
    let tower = towerWith(100, 40);
    const widths: number[] = [];
    const points: number[] = [];
    for (let i = 0; i < GROW_STREAK + 2; i += 1) {
      const result = drop(tower, tower.top.left);
      expect(result.outcome.kind).toBe('perfect');
      if (result.outcome.kind !== 'perfect') return;
      expect(result.outcome.grew).toBe(i + 1 >= GROW_STREAK);
      tower = result.state;
      widths.push(tower.top.width);
      points.push(result.outcome.points);
    }
    expect(widths).toEqual([40, 40, 40 + GROW_WIDTH, 40 + GROW_WIDTH * 2, 40 + GROW_WIDTH * 3]);
    expect(points).toEqual([8, 9, 10, 11, 11]);
    // 양쪽으로 고르게 늘어나서 가운데는 그대로다.
    expect(tower.top.left + tower.top.width / 2).toBe(120);
    expect(tower).toMatchObject({ streak: GROW_STREAK + 2, bestStreak: GROW_STREAK + 2 });
  });

  it('처음 폭보다 넓어지지 않고 판 밖으로도 나가지 않는다', () => {
    const full = drop(towerWith(72, START_WIDTH, { streak: GROW_STREAK }), 72);
    expect(full.outcome).toMatchObject({ kind: 'perfect', grew: false });
    expect(full.state.top).toEqual({ left: 72, width: START_WIDTH });

    const nearly = drop(towerWith(72, START_WIDTH - 2, { streak: GROW_STREAK }), 72);
    expect(nearly.state.top).toEqual({ left: 71, width: START_WIDTH });

    const atLeftEdge = drop(towerWith(0, 30, { streak: GROW_STREAK }), 1);
    expect(atLeftEdge.state.top).toEqual({ left: 0, width: 30 + GROW_WIDTH });
    const atRightEdge = drop(towerWith(FIELD_WIDTH - 30, 30, { streak: GROW_STREAK }), FIELD_WIDTH - 30);
    expect(atRightEdge.state.top).toEqual({ left: FIELD_WIDTH - 36, width: 36 });
  });

  it('아주 좁은 블록도 허용 폭 안이면 딱 맞은 것으로 친다', () => {
    const { state, outcome } = drop(towerWith(100, 2), 103);
    expect(outcome.kind).toBe('perfect');
    expect(state.top).toEqual({ left: 100, width: 2 });
    expect(drop(towerWith(100, 2), 104).outcome).toEqual({ kind: 'miss' });
  });

  it('한 판을 끝까지 쌓으면 점수는 층마다 받은 점수의 합이다', () => {
    let tower = newTower();
    let total = 0;
    // 번갈아 딱 맞히고 5px씩 어긋나게 놓는다.
    for (let i = 0; i < 12; i += 1) {
      const result = drop(tower, tower.top.left + (i % 2 === 0 ? 0 : 5));
      if (result.outcome.kind === 'miss') break;
      total += result.outcome.points;
      tower = result.state;
    }
    expect(tower.floors).toBe(12);
    expect(tower.perfects).toBe(6);
    expect(tower.score).toBe(total);
    expect(tower.top.width).toBe(START_WIDTH - 6 * 5);
  });
});
