import { describe, expect, it } from 'vitest';
import { SPRITES } from '../art/sprites';
import { dateKeyOf } from '../core/daily';
import { GAMES, getGame, HUB_GAMES, orderForHub, todaysChallenge } from './registry';

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

  it('플레이할 수 있는 게임은 오늘의 도전 목표가 세 단계이고 갈수록 높다', () => {
    for (const game of GAMES.filter((item) => item.sceneKey !== null)) {
      expect(game.dailyTargets).toHaveLength(3);
      expect(game.dailyTargets[0]).toBeGreaterThan(0);
      expect(game.dailyTargets[1]).toBeGreaterThan(game.dailyTargets[0]);
      expect(game.dailyTargets[2]).toBeGreaterThan(game.dailyTargets[1]);
    }
  });

  it('오늘의 도전은 플레이할 수 있는 게임 가운데 하나를 그 게임의 목표로 낸다', () => {
    const seen = new Set<string>();
    for (let day = 1; day <= 30; day += 1) {
      const date = new Date(2026, 10, day, 12);
      const challenge = todaysChallenge(date);
      expect(challenge).not.toBeNull();
      const game = getGame(challenge!.gameId);
      expect(game?.sceneKey).not.toBeNull();
      expect(game?.dailyTargets).toContain(challenge!.target);
      expect(challenge!.dateKey).toBe(dateKeyOf(date));
      seen.add(challenge!.gameId);
    }
    expect(seen.size).toBe(GAMES.filter((item) => item.sceneKey !== null).length);
  });

  it('허브에는 대표 게임이 먼저 오고 나머지는 적힌 순서대로 온다', () => {
    const games = [
      { id: 'a' },
      { id: 'b', featured: true },
      { id: 'c' },
      { id: 'd', featured: true },
    ];
    expect(orderForHub(games).map((game) => game.id)).toEqual(['b', 'd', 'a', 'c']);
    expect(orderForHub([{ id: 'a' }, { id: 'b' }]).map((game) => game.id)).toEqual(['a', 'b']);
  });

  it('허브 목록은 게임 목록과 같은 게임들이다', () => {
    expect(HUB_GAMES).toHaveLength(GAMES.length);
    expect(new Set(HUB_GAMES)).toEqual(new Set(GAMES));
  });

  it('id로 게임을 찾는다', () => {
    expect(getGame('lightning-tap')?.title).toBe('번개 탭');
    expect(getGame('없는-게임')).toBeUndefined();
  });
});
