import { describe, expect, it } from 'vitest';
import { SPRITES } from '../art/sprites';
import { GAMES, getGame } from './registry';

describe('게임 목록', () => {
  it('id가 겹치지 않는다', () => {
    const ids = GAMES.map((game) => game.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('모든 게임의 아이콘이 스프라이트 목록에 있다', () => {
    for (const game of GAMES) expect(SPRITES).toHaveProperty(game.icon);
  });

  it('바로 플레이할 수 있는 게임이 하나 이상 있다', () => {
    expect(GAMES.some((game) => game.sceneKey !== null)).toBe(true);
  });

  it('코인은 음수가 되지 않고 점수가 높을수록 줄지 않는다', () => {
    for (const game of GAMES) {
      let previous = 0;
      for (let score = 0; score <= 300; score += 7) {
        const coins = game.coinsFor(score);
        expect(Number.isInteger(coins)).toBe(true);
        expect(coins).toBeGreaterThanOrEqual(previous);
        previous = coins;
      }
    }
  });

  it('id로 게임을 찾는다', () => {
    expect(getGame('lightning-tap')?.title).toBe('번개 탭');
    expect(getGame('없는-게임')).toBeUndefined();
  });
});
