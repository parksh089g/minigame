import { describe, expect, it } from 'vitest';
import { dailySeed, freeSeed } from './daily';
import { deal, PYRAMID_SIZE, seededRandom, slotOf, type Board, type Card } from './rules';
import { pickWinnableSeed, solve } from './solver';

const card = (rank: number, suit: Card['suit'] = 'spade'): Card => ({ rank, suit });
const emptyBoard = (): Board => ({ pyramid: Array.from({ length: PYRAMID_SIZE }, () => null), stock: [], waste: [], pass: 1 });

describe('풀이기', () => {
  it('짝이 있으면 풀리고, 없으면 모른다고 한다', () => {
    const board = emptyBoard();
    board.pyramid[slotOf(6, 3)] = card(12);
    expect(solve(board)).toBe('unknown');
    board.stock = [card(1, 'heart')];
    expect(solve(board)).toBe('solved');
  });

  it('덮인 카드와 덮은 카드는 짝이 되지 못한다', () => {
    const board = emptyBoard();
    board.pyramid[slotOf(5, 0)] = card(5);
    board.pyramid[slotOf(6, 0)] = card(8);
    expect(solve(board)).toBe('unknown');
    // 더미에 짝이 있으면 차례로 치울 수 있다.
    board.stock = [card(8, 'heart'), card(5, 'heart')];
    expect(solve(board)).toBe('solved');
  });

  it('받은 판을 바꾸지 않는다', () => {
    const board = deal(7);
    const copy = structuredClone(board);
    solve(board, 500);
    expect(board).toEqual(copy);
  });

  it('같은 씨앗 목록이면 언제나 같은 씨앗을, 처음으로 풀리는 것으로 고른다', () => {
    const seedOf = (attempt: number): number => 1000 + attempt;
    const picked = pickWinnableSeed(seedOf);
    expect(pickWinnableSeed(seedOf)).toBe(picked);
    expect(solve(deal(picked), 1_500)).toBe('solved');
    for (let seed = 1000; seed < picked; seed += 1) expect(solve(deal(seed), 1_500)).toBe('unknown');
  });
});

describe('끝까지 치울 수 있는 판 고르기', () => {
  it('오늘의 판은 날마다 같고, 끝까지 치울 수 있다', () => {
    for (let day = 20_700; day < 20_730; day += 1) {
      const seed = dailySeed(day);
      expect(dailySeed(day)).toBe(seed);
      expect(solve(deal(seed), 1_500), String(day)).toBe('solved');
    }
  });

  it('여느 판도 끝까지 치울 수 있다', () => {
    for (let i = 0; i < 10; i += 1) expect(solve(deal(freeSeed(seededRandom(i + 1))), 1_500)).toBe('solved');
  });

  it('폰에서도 금방 고른다(한 판에 평균 50ms 안쪽)', () => {
    dailySeed(19_999); // 처음 한 번은 JIT가 덥혀지지 않아 느리다.
    const days = 40;
    const start = performance.now();
    for (let day = 21_000; day < 21_000 + days; day += 1) dailySeed(day);
    expect((performance.now() - start) / days).toBeLessThan(50);
  });
});
