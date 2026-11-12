import { describe, expect, it } from 'vitest';
import { tabRows, TABS_PER_ROW } from './tabs';

describe('tabRows', () => {
  it('한도 안이면 한 줄에 모두 놓는다', () => {
    expect(tabRows(1)).toEqual({ rows: 1, perRow: 1 });
    expect(tabRows(3)).toEqual({ rows: 1, perRow: 3 });
    expect(tabRows(TABS_PER_ROW)).toEqual({ rows: 1, perRow: TABS_PER_ROW });
  });

  it('한도를 넘으면 줄을 늘리고 줄마다 고르게 나눈다', () => {
    expect(tabRows(6)).toEqual({ rows: 2, perRow: 3 });
    expect(tabRows(7)).toEqual({ rows: 2, perRow: 4 });
    expect(tabRows(8)).toEqual({ rows: 2, perRow: 4 });
    expect(tabRows(10)).toEqual({ rows: 2, perRow: 5 });
    expect(tabRows(11)).toEqual({ rows: 3, perRow: 4 });
  });

  it('어떤 수여도 한 줄의 탭은 한도를 넘지 않고, 모든 탭이 들어갈 자리가 있다', () => {
    for (let count = 1; count <= 40; count += 1) {
      const { rows, perRow } = tabRows(count);
      expect(perRow).toBeLessThanOrEqual(TABS_PER_ROW);
      expect(rows * perRow).toBeGreaterThanOrEqual(count);
      // 줄을 하나 줄이면 다 들어가지 않는다.
      expect((rows - 1) * TABS_PER_ROW).toBeLessThan(count);
    }
  });

  it('0이나 잘못된 수가 와도 한 줄 한 칸으로 답한다', () => {
    expect(tabRows(0)).toEqual({ rows: 1, perRow: 1 });
    expect(tabRows(-3)).toEqual({ rows: 1, perRow: 1 });
    expect(tabRows(4, 0)).toEqual({ rows: 4, perRow: 1 });
  });
});
