import { describe, expect, it } from 'vitest';
import { FIELD, GUN, SHOOTER } from './data';
import { aimDots, layoutField, toScreenY, toSim } from './layout';
import { clampAim } from './sim';

/** 작은 화면(320x568)과 큰 화면(390x844)의 판. 화면 폭은 늘 240이라 세로만 다르다. */
const SHORT = layoutField(426, 46);
const TALL = layoutField(519, 46);

describe('판이 놓이는 자리', () => {
  it('울타리 위는 화면 길이에 맞춰 늘이고, 울타리 아래는 그대로 둔다', () => {
    for (const layout of [SHORT, TALL]) {
      expect(toScreenY(layout, 0)).toBeCloseTo(layout.top);
      expect(toScreenY(layout, FIELD.depth)).toBeCloseTo(layout.fenceY);
      expect(toScreenY(layout, SHOOTER.y)).toBeCloseTo(layout.fenceY + (SHOOTER.y - FIELD.depth));
    }
    expect(TALL.scaleY).toBeGreaterThan(1);
    expect(SHORT.scaleY).toBeLessThan(1);
  });

  it('화면의 점을 시뮬레이션으로 바꿨다가 되돌리면 그 자리다', () => {
    for (const layout of [SHORT, TALL]) {
      for (const y of [-12, 0, 100, FIELD.depth, FIELD.depth + 20, SHOOTER.y]) {
        expect(toSim(layout, 30, toScreenY(layout, y))).toEqual({ x: 30, y: expect.closeTo(y) });
      }
    }
  });
});

describe('직접 겨눌 때의 점선', () => {
  /** 화면의 점이 물방울의 길(물총에서 aim 쪽으로 곧게 뻗은 줄)에서 떨어진 거리(시뮬레이션 길이) */
  const offPath = (layout: typeof SHORT, aim: number, dot: { x: number; y: number }): number => {
    const point = toSim(layout, dot.x, dot.y);
    return Math.abs((point.x - SHOOTER.x) * Math.sin(aim) - (point.y - SHOOTER.y) * Math.cos(aim));
  };
  /** 화면의 한 점을 눌렀을 때 물총이 겨누는 쪽 */
  const aimAt = (layout: typeof SHORT, x: number, y: number): number => {
    const point = toSim(layout, x, y);
    return clampAim(Math.atan2(point.y - SHOOTER.y, point.x - SHOOTER.x));
  };

  it('어느 쪽을 겨눠도 점은 모두 물방울이 날아가는 길 위에 있다', () => {
    for (const layout of [SHORT, TALL]) {
      for (const aim of [-Math.PI / 2, -1, -2.4, -GUN.minLift, -Math.PI + GUN.minLift, aimAt(layout, 4, layout.fenceY)]) {
        const dots = aimDots(layout, aim, 26, 150, 12);
        expect(dots.length).toBe(11);
        for (const dot of dots) expect(offPath(layout, aim, dot)).toBeLessThan(1e-6);
      }
    }
  });

  it('점 사이는 화면에서 고르고, 울타리에서 꺾이는 곳만 조금 짧다', () => {
    for (const layout of [SHORT, TALL]) {
      const dots = aimDots(layout, -0.5, 26, 150, 12);
      const gaps = dots.slice(1).map((dot, index) => Math.hypot(dot.x - dots[index].x, dot.y - dots[index].y));
      expect(gaps.filter((gap) => Math.abs(gap - 12) < 1e-6).length).toBeGreaterThanOrEqual(gaps.length - 1);
      for (const gap of gaps) {
        expect(gap).toBeGreaterThan(11);
        expect(gap).toBeLessThanOrEqual(12 + 1e-6);
      }
    }
  });

  it('누른 자리가 겨눌 수 있는 쪽이면 점선이 그 자리를 지난다', () => {
    for (const layout of [SHORT, TALL]) {
      // 판의 왼쪽 위와, 울타리 바로 위의 오른쪽 끝
      for (const [x, y] of [
        [40, layout.top + 60],
        [236, layout.fenceY - 30],
      ]) {
        const aim = aimAt(layout, x, y);
        expect(offPath(layout, aim, { x, y })).toBeLessThan(1e-6);
        // 곧게만 그은 줄(물총에서 화면의 한 방향으로)은 큰 화면에서 이 자리를 여러 픽셀 비껴간다.
        const dots = aimDots(layout, aim, 26, 400, 1);
        const nearest = Math.min(...dots.map((dot) => Math.hypot(dot.x - x, dot.y - y)));
        expect(nearest).toBeLessThan(1);
      }
    }
  });
});
