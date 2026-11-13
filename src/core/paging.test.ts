import { describe, expect, it } from 'vitest';
import { balancedRows, clampPage, fitStack, layoutPages, pagedCapacity, pageOfIndex, pageSlice, stackHeight } from './paging';

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

describe('fitStack', () => {
  const size = { height: 60, gap: 8 };
  const squeeze = { roomy: 50, gap: 4, least: 44 };

  it('넉넉하면 늘 쓰는 크기 그대로다', () => {
    expect(fitStack(4, 294, size, squeeze)).toEqual(size);
    expect(fitStack(1, 294, size, squeeze)).toEqual(size);
    expect(fitStack(6, 400, size, squeeze)).toEqual(size);
  });

  it('모자라면 간격은 둔 채 낮추고, 그래도 모자라면 간격까지 좁힌다', () => {
    // 등불지기 강화권 창: 가장 작은 화면(논리 높이 426)에서 카드가 놓일 높이는 294다.
    expect(fitStack(5, 294, size, squeeze)).toEqual({ height: 52, gap: 8 });
    expect(fitStack(6, 294, size, squeeze)).toEqual({ height: 45, gap: 4 });
    // 흔한 화면(논리 높이 519)에서는 387
    expect(fitStack(6, 387, size, squeeze)).toEqual({ height: 57, gap: 8 });
  });

  it('줄인 크기는 언제나 room 안에 들어가고, 너무 짧으면 가장 낮은 높이에서 멈춘다', () => {
    for (let count = 1; count <= 8; count += 1) {
      for (let room = 200; room <= 520; room += 1) {
        const { height, gap } = fitStack(count, room, size, squeeze);
        expect(height).toBeLessThanOrEqual(size.height);
        expect(height).toBeGreaterThanOrEqual(squeeze.least);
        if (height > squeeze.least) expect(stackHeight(count, { height, gap })).toBeLessThanOrEqual(room);
      }
    }
    expect(fitStack(6, 100, size, squeeze)).toEqual({ height: 44, gap: 4 });
  });

  it('담을 것이 많아 least가 roomy보다 크면, 간격을 좁혀서라도 least를 지킨다', () => {
    // 다섯이 간격 8로는 52까지만 되는데 53은 되어야 하면 간격을 4로 좁혀 55
    expect(fitStack(5, 294, size, { ...squeeze, least: 53 })).toEqual({ height: 55, gap: 4 });
    // 간격을 좁혀도 모자라면 least에서 멈추고, 다 들어가지 않는다.
    const tight = fitStack(6, 294, size, { ...squeeze, least: 53 });
    expect(tight).toEqual({ height: 53, gap: 4 });
    expect(stackHeight(6, tight)).toBeGreaterThan(294);
  });

  it('least가 늘 쓰는 높이보다 크면 그만큼 키운다', () => {
    expect(fitStack(3, 400, size, { ...squeeze, least: 70 })).toEqual({ height: 70, gap: 8 });
  });
});

describe('stackHeight', () => {
  it('높이를 모두 더하고 사이 간격은 하나 적게 더한다', () => {
    expect(stackHeight(6, { height: 45, gap: 4 })).toBe(290);
    expect(stackHeight(1, { height: 60, gap: 8 })).toBe(60);
    expect(stackHeight(0, { height: 60, gap: 8 })).toBe(0);
  });
});
