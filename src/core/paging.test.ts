import { describe, expect, it } from 'vitest';
import { balancedRows, clampPage, layoutPages, pagedCapacity, pageOfIndex, pageSlice } from './paging';

describe('layoutPages', () => {
  it('모두 들어가면 한 쪽이고 쪽 넘김 줄의 자리를 빼지 않는다', () => {
    // 64짜리 카드가 248 안에 3개 들어간다.
    expect(layoutPages(3, 248, 64, 30)).toEqual({ perPage: 3, pages: 1 });
    expect(layoutPages(1, 248, 64, 30)).toEqual({ perPage: 3, pages: 1 });
    expect(layoutPages(0, 248, 64, 30)).toEqual({ perPage: 3, pages: 1 });
  });

  it('넘치면 쪽 넘김 줄의 자리를 비우고 나눈다', () => {
    expect(layoutPages(4, 248, 64, 30)).toEqual({ perPage: 3, pages: 2 });
    expect(layoutPages(7, 248, 64, 30)).toEqual({ perPage: 3, pages: 3 });
    // 쪽 넘김 줄 때문에 한 쪽에 들어가는 수가 줄어드는 경우
    expect(layoutPages(8, 300, 48, 30)).toEqual({ perPage: 5, pages: 2 });
    expect(layoutPages(6, 300, 48, 30)).toEqual({ perPage: 6, pages: 1 });
  });

  it('화면이 길면 더 많이 들어간다', () => {
    expect(layoutPages(4, 368, 64, 30)).toEqual({ perPage: 5, pages: 1 });
    expect(layoutPages(8, 420, 48, 30)).toEqual({ perPage: 8, pages: 1 });
  });

  it('자리가 아무리 좁아도 한 쪽에 하나는 놓는다', () => {
    expect(layoutPages(3, 10, 64, 30)).toEqual({ perPage: 1, pages: 3 });
    expect(pagedCapacity(10, 64, 30)).toBe(1);
  });

  it('모든 항목이 어느 한 쪽에 꼭 한 번씩 놓인다', () => {
    const items = Array.from({ length: 11 }, (_, index) => index);
    for (const available of [60, 130, 248, 300, 800]) {
      const { perPage, pages } = layoutPages(items.length, available, 64, 30);
      const seen: number[] = [];
      for (let page = 0; page < pages; page += 1) {
        const slice = pageSlice(items, page, perPage);
        expect(slice.length).toBeGreaterThan(0);
        expect(slice.length).toBeLessThanOrEqual(perPage);
        seen.push(...slice);
      }
      expect(seen).toEqual(items);
    }
  });
});

describe('쪽 번호', () => {
  it('범위를 벗어난 쪽은 처음이나 끝으로 맞춘다', () => {
    expect(clampPage(-1, 3)).toBe(0);
    expect(clampPage(1, 3)).toBe(1);
    expect(clampPage(5, 3)).toBe(2);
    expect(clampPage(2, 0)).toBe(0);
    expect(clampPage(Number.NaN, 3)).toBe(0);
  });

  it('항목이 놓이는 쪽을 찾는다', () => {
    expect(pageOfIndex(0, 3)).toBe(0);
    expect(pageOfIndex(2, 3)).toBe(0);
    expect(pageOfIndex(3, 3)).toBe(1);
    expect(pageOfIndex(7, 5)).toBe(1);
  });

  it('쪽에 놓이는 항목을 잘라 낸다', () => {
    expect(pageSlice(['a', 'b', 'c', 'd'], 0, 3)).toEqual(['a', 'b', 'c']);
    expect(pageSlice(['a', 'b', 'c', 'd'], 1, 3)).toEqual(['d']);
    expect(pageSlice(['a', 'b', 'c', 'd'], 2, 3)).toEqual([]);
  });
});

describe('balancedRows', () => {
  it('한 줄에 들어가면 한 줄, 넘치면 가장 적은 줄에 고르게 나눈다', () => {
    expect(balancedRows(4, 4)).toEqual([4]);
    expect(balancedRows(1, 4)).toEqual([1]);
    expect(balancedRows(5, 4)).toEqual([3, 2]);
    expect(balancedRows(6, 4)).toEqual([3, 3]);
    expect(balancedRows(7, 4)).toEqual([4, 3]);
    expect(balancedRows(9, 4)).toEqual([3, 3, 3]);
  });

  it('없거나 엉뚱한 값은 빈 줄이고, 한 줄의 개수는 적어도 하나다', () => {
    expect(balancedRows(0, 4)).toEqual([]);
    expect(balancedRows(-3, 4)).toEqual([]);
    expect(balancedRows(3, 0)).toEqual([1, 1, 1]);
  });
});
