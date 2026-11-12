import { describe, expect, it } from 'vitest';
import { SPRITES } from '../art/sprites';
import { dateKeyOf } from '../core/daily';
import { GAMES, getGame, HUB_GAMES, orderForHub, personalHubOrder, todaysChallenge } from './registry';

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

  it('오늘의 도전에 나오는 게임은 목표가 세 단계이고 갈수록 높다', () => {
    // 목표를 비워 둔 게임은 오늘의 도전에서 빠진다.
    for (const game of GAMES.filter((item) => item.dailyTargets.length > 0)) {
      expect(game.sceneKey).not.toBeNull();
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
    expect(seen.size).toBe(
      GAMES.filter((item) => item.sceneKey !== null && item.dailyTargets.length > 0).length,
    );
  });

  it('허브에는 대표 게임이 먼저 오고 나머지는 적힌 순서대로 온다', () => {
    type Entry = { id: string; featured?: boolean };
    const games: Entry[] = [
      { id: 'a' },
      { id: 'b', featured: true },
      { id: 'c' },
      { id: 'd', featured: true },
    ];
    const plain: Entry[] = [{ id: 'a' }, { id: 'b' }];
    expect(orderForHub(games).map((game) => game.id)).toEqual(['b', 'd', 'a', 'c']);
    expect(orderForHub(plain).map((game) => game.id)).toEqual(['a', 'b']);
  });

  it('사람마다의 허브 순서는 대표 게임, 즐겨찾기, 최근에 한 게임, 안 해 본 게임 차례다', () => {
    type Entry = { id: string; featured?: boolean };
    const games: Entry[] = [
      { id: 'a' },
      { id: 'b' },
      { id: 'c', featured: true },
      { id: 'd' },
      { id: 'e' },
      { id: 'f' },
    ];
    const times: Record<string, number> = { a: 100, d: 300, e: 200, f: 50 };
    const lastPlayedAt = (id: string): number | null => times[id] ?? null;
    // f와 a는 즐겨찾기라 넣은 순서와 상관없이 적힌 순서(a, f)로 앞에 온다.
    const order = personalHubOrder(games, ['f', 'a', '없는-게임'], lastPlayedAt);
    expect(order.map((game) => game.id)).toEqual(['c', 'a', 'f', 'd', 'e', 'b']);
  });

  it('즐겨찾기도 기록도 없으면 사람마다의 허브 순서는 기본 순서와 같다', () => {
    const none = (): null => null;
    expect(personalHubOrder(GAMES, [], none)).toEqual([...HUB_GAMES]);
  });

  it('같은 때에 한 게임들은 적힌 순서를 지키고, 대표 게임은 즐겨찾기에 넣어도 한 번만 나온다', () => {
    type Entry = { id: string; featured?: boolean };
    const games: Entry[] = [{ id: 'a' }, { id: 'b', featured: true }, { id: 'c' }, { id: 'd' }];
    const order = personalHubOrder(games, ['b'], () => 500);
    expect(order.map((game) => game.id)).toEqual(['b', 'a', 'c', 'd']);
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
