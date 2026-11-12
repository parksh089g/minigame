import { describe, expect, it } from 'vitest';
import { roundedPath } from './card';

/** 불린 순서를 적어 두는 가짜 캔버스 */
function fake(withRoundRect: boolean) {
  const calls: Array<[string, ...number[]]> = [];
  const note =
    (name: string) =>
    (...args: number[]): void => {
      calls.push([name, ...args]);
    };
  const context = {
    moveTo: note('moveTo'),
    lineTo: note('lineTo'),
    arcTo: note('arcTo'),
    closePath: note('closePath'),
    ...(withRoundRect ? { roundRect: note('roundRect') } : {}),
  };
  return { calls, context };
}

describe('roundedPath', () => {
  it('캔버스에 roundRect가 있으면 그것을 쓴다', () => {
    const { calls, context } = fake(true);
    roundedPath(context as never, 10, 20, 100, 40, 8);
    expect(calls).toEqual([['roundRect', 10, 20, 100, 40, 8]]);
  });

  it('없으면(iOS 15 이하) 모서리 네 개를 호로 이어 직접 그린다', () => {
    const { calls, context } = fake(false);
    roundedPath(context as never, 10, 20, 100, 40, 8);
    expect(calls.map(([name]) => name)).toEqual([
      'moveTo',
      'lineTo',
      'arcTo',
      'lineTo',
      'arcTo',
      'lineTo',
      'arcTo',
      'lineTo',
      'arcTo',
      'closePath',
    ]);
    expect(calls[0]).toEqual(['moveTo', 18, 20]);
    // 오른쪽 위 모서리
    expect(calls[2]).toEqual(['arcTo', 110, 20, 110, 28, 8]);
    // 왼쪽 위 모서리로 돌아온다.
    expect(calls[8]).toEqual(['arcTo', 10, 20, 18, 20, 8]);
  });

  it('반지름이 너무 크면 사각형의 절반으로 줄인다', () => {
    const { calls, context } = fake(false);
    roundedPath(context as never, 0, 0, 100, 40, 999);
    expect(calls[0]).toEqual(['moveTo', 20, 0]);
    expect(calls[2]).toEqual(['arcTo', 100, 0, 100, 20, 20]);
  });
});
