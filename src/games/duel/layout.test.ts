import { describe, expect, it } from 'vitest';
import { GAME_WIDTH, MAX_GAME_HEIGHT, MIN_GAME_HEIGHT } from '../../config';
import {
  centerLine,
  halfLayout,
  optionAt,
  PAUSE_BUTTON,
  SCORE_PLATE,
  screenRect,
  sideOf,
  STRIP_HALF,
  toLocal,
  toScreen,
  type Rect,
} from './layout';
import { PLAYERS, READY_OPTION, SYMBOL_OPTIONS } from './rules';

/** 화면이 가질 수 있는 모든 세로 길이 */
const HEIGHTS = Array.from(
  { length: MAX_GAME_HEIGHT - MIN_GAME_HEIGHT + 1 },
  (_, index) => MIN_GAME_HEIGHT + index,
);

const bottomOf = (rect: Rect): number => rect.y + rect.height;
const rightOf = (rect: Rect): number => rect.x + rect.width;
const inside = (inner: Rect, outer: Rect): boolean =>
  inner.x >= outer.x && inner.y >= outer.y && rightOf(inner) <= rightOf(outer) && bottomOf(inner) <= bottomOf(outer);
const centerOf = (rect: Rect): { x: number; y: number } => ({
  x: rect.x + rect.width / 2,
  y: rect.y + rect.height / 2,
});

describe('반쪽의 자리', () => {
  it('판은 가운데 줄과 화면 끝 사이에 들어간다', () => {
    for (const height of HEIGHTS) {
      const { depth, panel } = halfLayout(height);
      expect(depth).toBe(Math.floor(height / 2));
      expect(panel.y).toBeGreaterThan(STRIP_HALF);
      expect(bottomOf(panel)).toBeLessThan(depth);
      expect(panel.x).toBeGreaterThanOrEqual(-GAME_WIDTH / 2);
      expect(rightOf(panel)).toBeLessThanOrEqual(GAME_WIDTH / 2);
      // 좌우가 대칭이라야 반 바퀴 돌린 위쪽 반쪽이 같은 자리에 놓인다.
      expect(panel.x).toBe(-rightOf(panel));
    }
  });

  it('그림 버튼 넷은 어느 화면에서도 44px보다 크고, 판 안에 겹치지 않게 놓인다', () => {
    for (const height of HEIGHTS) {
      const { panel, symbolButtons, target } = halfLayout(height);
      expect(symbolButtons).toHaveLength(SYMBOL_OPTIONS);
      symbolButtons.forEach((button, index) => {
        expect(button.width).toBeGreaterThanOrEqual(44);
        expect(button.height).toBeGreaterThanOrEqual(44);
        expect(inside(button, panel)).toBe(true);
        if (index > 0) expect(button.x).toBeGreaterThan(rightOf(symbolButtons[index - 1]));
        // 찾을 그림의 자리와 그 아래 한 줄 글자가 들어갈 틈이 남는다.
        expect(button.y - (target.y + target.radius)).toBeGreaterThanOrEqual(40);
      });
      expect(symbolButtons[0].x).toBe(-rightOf(symbolButtons[SYMBOL_OPTIONS - 1]));
    }
    expect(halfLayout(MAX_GAME_HEIGHT).symbolButtons[0].height).toBeGreaterThan(
      halfLayout(MIN_GAME_HEIGHT).symbolButtons[0].height,
    );
  });

  it('준비 버튼과 끝났을 때의 버튼도 넉넉한 크기로 판 안에 들어간다', () => {
    for (const height of HEIGHTS) {
      const { panel, readyButton, endButtons } = halfLayout(height);
      expect(inside(readyButton, panel)).toBe(true);
      expect(readyButton.height).toBeGreaterThanOrEqual(44);
      expect(centerOf(readyButton).x).toBe(0);
      for (const button of endButtons) {
        expect(inside(button, panel)).toBe(true);
        expect(button.height).toBeGreaterThanOrEqual(28);
      }
      expect(endButtons[1].x).toBeGreaterThan(rightOf(endButtons[0]));
      expect(endButtons[0].x).toBe(-rightOf(endButtons[1]));
    }
  });

  it('줄다리기의 골라인 너머에 남은 시간과 글자 두 줄이 들어갈 자리가 남는다', () => {
    for (const height of HEIGHTS) {
      const { panel, goal } = halfLayout(height);
      expect(goal).toBeGreaterThanOrEqual(90);
      expect(bottomOf(panel) - goal).toBeGreaterThanOrEqual(84);
    }
  });

  it('찾을 그림의 자리는 가운데 줄 바로 앞에 놓인다', () => {
    for (const height of HEIGHTS) {
      const { panel, target } = halfLayout(height);
      expect(target.x).toBe(0);
      expect(target.y - target.radius).toBeGreaterThan(panel.y);
      expect(target.y - target.radius).toBeLessThan(panel.y + 16);
    }
  });
});

describe('화면 좌표와 그 사람이 보는 좌표', () => {
  it('아래쪽 사람에게는 화면을 옮긴 것이고, 위쪽 사람에게는 반 바퀴 돌린 것이다', () => {
    const height = 400;
    expect(centerLine(height)).toBe(200);
    expect(toLocal(0, 120, 200, height)).toEqual({ x: 0, y: 0 });
    expect(toLocal(0, 150, 260, height)).toEqual({ x: 30, y: 60 });
    expect(toLocal(1, 150, 140, height)).toEqual({ x: -30, y: 60 });
    expect(toLocal(1, 90, 30, height)).toEqual({ x: 30, y: 170 });
  });

  it('두 변환은 서로 되돌린다', () => {
    for (const height of [400, 427, 488, 520, 560]) {
      for (const player of PLAYERS) {
        for (const [x, y] of [
          [0, 0],
          [-100, 30],
          [57.5, 180.25],
        ]) {
          const screen = toScreen(player, x, y, height);
          expect(toLocal(player, screen.x, screen.y, height)).toEqual({ x, y });
        }
      }
    }
  });

  it('위쪽 사람의 네모는 화면 한가운데를 중심으로 반 바퀴 돌아간 자리에 놓인다', () => {
    for (const height of [400, 427, 560]) {
      const mid = centerLine(height);
      const layout = halfLayout(height);
      for (const rect of [layout.readyButton, ...layout.symbolButtons, ...layout.endButtons]) {
        const lower = screenRect(0, rect, height);
        const upper = screenRect(1, rect, height);
        expect(upper.width).toBe(lower.width);
        expect(upper.height).toBe(lower.height);
        expect(upper.x + upper.width).toBe(GAME_WIDTH - lower.x);
        expect(upper.y + upper.height).toBe(2 * mid - lower.y);
        expect(lower.y).toBeGreaterThan(mid);
        expect(upper.y + upper.height).toBeLessThan(mid);
        expect(upper.y).toBeGreaterThanOrEqual(0);
        expect(lower.y + lower.height).toBeLessThanOrEqual(height);
      }
    }
  });
});

describe('누가 눌렀는지', () => {
  it('가운데 줄 아래는 아래쪽 사람, 위는 위쪽 사람의 것이다', () => {
    for (const height of [400, 427, 560]) {
      const mid = centerLine(height);
      expect(sideOf(120, mid + STRIP_HALF, height)).toBe(0);
      expect(sideOf(120, height - 1, height)).toBe(0);
      expect(sideOf(120, mid - STRIP_HALF, height)).toBe(1);
      expect(sideOf(120, 0, height)).toBe(1);
    }
  });

  it('가운데 줄을 누른 것은 누구의 것도 아니다', () => {
    const height = 520;
    const mid = centerLine(height);
    for (const offset of [0, 5, -5, STRIP_HALF - 1, -(STRIP_HALF - 1)]) {
      expect(sideOf(120, mid + offset, height)).toBeNull();
    }
  });

  it('일시정지 버튼과 그 둘레를 누른 것은 누구의 것도 아니다', () => {
    const height = 400;
    const mid = centerLine(height);
    const reach = PAUSE_BUTTON.size / 2 + PAUSE_BUTTON.hitPadding;
    const edge = PAUSE_BUTTON.x + PAUSE_BUTTON.size + PAUSE_BUTTON.hitPadding;
    expect(reach).toBeGreaterThan(STRIP_HALF);
    expect(sideOf(edge, mid + reach, height)).toBeNull();
    expect(sideOf(2, mid - reach, height)).toBeNull();
    // 같은 높이라도 버튼에서 벗어난 곳은 그 사람의 것이다.
    expect(sideOf(edge + 10, mid + reach, height)).toBe(0);
    expect(sideOf(edge + 10, mid - reach, height)).toBe(1);
    // 점수 표시 칸은 가운데 줄 안에 들어 있어서 따로 막을 필요가 없다.
    expect(SCORE_PLATE.height / 2).toBeLessThanOrEqual(STRIP_HALF);
  });
});

describe('눌린 버튼 찾기', () => {
  it('두 사람 모두 자기 화면의 그림 버튼 한가운데를 누르면 그 번호가 나온다', () => {
    for (const height of [400, 427, 488, 520, 560]) {
      const layout = halfLayout(height);
      for (const player of PLAYERS) {
        layout.symbolButtons.forEach((rect, index) => {
          const spot = centerOf(screenRect(player, rect, height));
          expect(sideOf(spot.x, spot.y, height)).toBe(player);
          const local = toLocal(player, spot.x, spot.y, height);
          expect(optionAt(layout, 'symbols', local.x, local.y)).toBe(index);
        });
      }
    }
  });

  it('위쪽 사람의 첫 버튼은 화면에서는 오른쪽 위에 있다', () => {
    const height = 400;
    const first = screenRect(1, halfLayout(height).symbolButtons[0], height);
    const last = screenRect(1, halfLayout(height).symbolButtons[SYMBOL_OPTIONS - 1], height);
    expect(first.x).toBeGreaterThan(last.x);
    expect(first.y + first.height).toBeLessThan(centerLine(height));
  });

  it('버튼 사이의 틈을 눌러도 어느 한 버튼으로만 센다', () => {
    const layout = halfLayout(400);
    const [first, second] = layout.symbolButtons;
    const y = centerOf(first).y;
    const gapMiddle = (rightOf(first) + second.x) / 2;
    expect(optionAt(layout, 'symbols', gapMiddle - 0.5, y)).toBe(0);
    expect(optionAt(layout, 'symbols', gapMiddle + 0.5, y)).toBe(1);
    for (let x = first.x; x < rightOf(layout.symbolButtons[SYMBOL_OPTIONS - 1]); x += 0.5) {
      expect(optionAt(layout, 'symbols', x, y)).not.toBeUndefined();
    }
  });

  it('버튼에서 벗어난 곳은 버튼으로 세지 않는다', () => {
    const layout = halfLayout(400);
    const button = layout.symbolButtons[1];
    expect(optionAt(layout, 'symbols', centerOf(button).x, button.y - 20)).toBeUndefined();
    expect(optionAt(layout, 'symbols', 0, layout.target.y)).toBeUndefined();
    expect(optionAt(layout, 'symbols', layout.symbolButtons[0].x - 8, centerOf(button).y)).toBeUndefined();
  });

  it('준비 버튼은 준비 화면에서만, 그림 버튼은 그림이 나온 뒤에만 눌린다', () => {
    const layout = halfLayout(520);
    const ready = centerOf(layout.readyButton);
    const symbol = centerOf(layout.symbolButtons[2]);
    expect(optionAt(layout, 'ready', ready.x, ready.y)).toBe(READY_OPTION);
    expect(optionAt(layout, 'ready', ready.x, layout.readyButton.y - 30)).toBeUndefined();
    expect(optionAt(layout, 'none', ready.x, ready.y)).toBeUndefined();
    expect(optionAt(layout, 'none', symbol.x, symbol.y)).toBeUndefined();
    expect(optionAt(layout, 'symbols', symbol.x, symbol.y)).toBe(2);
  });
});
