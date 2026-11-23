import { describe, expect, it } from 'vitest';
import { CHIP_ROUNDS, CHIP_START, chipCoins, chipGuess, chipRunOver, chipSkip, clampBet, payoutFor, rate10For, rateLabel, startChipRun } from './chips';
import type { Card } from './rules';

const card = (rank: number): Card => ({ rank, suit: 'spade' });

describe('하이로우 칩 걸기', () => {
  it('나오기 어려운 쪽일수록 배당이 크고, 나올 수 없는 쪽은 고를 수 없다', () => {
    const deck = [card(2), card(3), card(10), card(11), card(12), card(13)];
    const low = rate10For('low', 9, deck);
    const high = rate10For('high', 9, deck);
    expect(high).toBeGreaterThan(0);
    expect(low).toBeGreaterThanOrEqual(high);
    expect(rate10For('high', 13, deck)).toBe(0);
    expect(rate10For('low', 1, [card(5)])).toBe(0);
    // 거의 확실한 쪽도 1.1배는 준다.
    expect(rate10For('high', 1, [card(5), card(6)])).toBe(11);
    expect(rateLabel(15)).toBe('×1.5');
    expect(payoutFor(10, 15)).toBe(15);
  });

  it('맞히면 배당만큼 받고, 틀리면 건 칩을 잃고, 같으면 돌려받는다', () => {
    const run = startChipRun(Math.random, [card(2), card(13), card(4), card(4), card(9), card(7)]);
    expect(run.current.rank).toBe(7);
    const win = chipGuess(run, 'high', 20)!;
    expect(win.step.verdict).toBe('win');
    expect(run.chips).toBe(CHIP_START + payoutFor(20, win.step.rate10) - 20);
    const before = run.chips;
    const lose = chipGuess(run, 'high', 10)!;
    expect(lose.step.verdict).toBe('lose');
    expect(run.chips).toBe(before - 10);
    const tie = chipGuess(run, 'low', 10)!;
    expect(tie.step.verdict).toBe('tie');
    expect(run.chips).toBe(before - 10);
    expect(run.round).toBe(3);
  });

  it('걸 칩은 가진 칩 안으로 맞추고, 정한 수만큼 고르면 끝난다', () => {
    expect(clampBet(100, 500)).toBe(100);
    expect(clampBet(3, 10)).toBe(3);
    expect(clampBet(100, 1)).toBe(5);
    const run = startChipRun(() => 0.3);
    expect(chipSkip(run)).not.toBeNull();
    expect(run.round).toBe(0);
    for (let i = 0; i < CHIP_ROUNDS && !chipRunOver(run); i += 1) {
      const guess = rate10For('high', run.current.rank, run.deck) > 0 ? 'high' : 'low';
      expect(chipGuess(run, guess, 5)).not.toBeNull();
    }
    expect(chipRunOver(run)).toBe(true);
    expect(chipGuess(run, 'high', 5)).toBeNull();
    expect(chipCoins(130)).toBe(13);
  });
});
