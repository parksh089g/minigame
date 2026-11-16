import { describe, expect, it } from 'vitest';
import { SPRITES } from '../art/sprites';
import { dateKeyOf } from '../core/daily';
import { createWeekly, GENRES, recordWeeklyPlay } from '../core/weekly';
import { GARDEN_GAME_ID } from './garden-guard/data';
import { LANTERN_GAME_ID } from './lantern-keeper/data';
import {
  GAMES,
  gamesInGroup,
  getGame,
  HUB_GAMES,
  HUB_GROUP_LABEL,
  HUB_GROUPS,
  hubGroupOf,
  lastPlayedGame,
  orderForHub,
  personalHubOrder,
  startingHubGroup,
  STEADY_LINE_CHARS,
  thisWeek,
  todaysChallenge,
  weeklyGames,
} from './registry';
import { COMPANY_GAME_ID } from './sprout-company/data';

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

  it('허브의 두 갈래는 게임을 빠짐없이, 겹치지 않게 나눈다', () => {
    const steady = gamesInGroup(GAMES, 'steady');
    const quick = gamesInGroup(GAMES, 'quick');
    expect(steady.length).toBeGreaterThan(0);
    expect(quick.length).toBeGreaterThan(0);
    expect(steady.length + quick.length).toBe(GAMES.length);
    expect(new Set([...steady, ...quick])).toEqual(new Set(GAMES));
    for (const group of HUB_GROUPS) expect(HUB_GROUP_LABEL[group].length).toBeGreaterThan(0);
  });

  it('꾸준히 하는 게임은 키운 것이 남는 큰 게임들과 행운 슬롯이고, 나머지는 짧게 즐기는 게임이다', () => {
    const ids = gamesInGroup(GAMES, 'steady').map((game) => game.id);
    expect([...ids].sort()).toEqual([LANTERN_GAME_ID, GARDEN_GAME_ID, COMPANY_GAME_ID, 'candy-slot'].sort());
    // 큰 게임 미션으로 나오는 게임과 판이 끝나지 않는 게임은 모두 꾸준히 하는 게임이다.
    for (const game of GAMES) {
      if (game.bigMission || game.ongoing) expect(hubGroupOf(game), game.id).toBe('steady');
    }
    expect(hubGroupOf(getGame('lightning-tap')!)).toBe('quick');
    // 둘이서 겨루는 게임과 퍼즐 단계 모드의 게임은 한 판이 짧다.
    for (const game of GAMES) {
      if (game.versus || game.stageMode) expect(hubGroupOf(game), game.id).toBe('quick');
    }
  });

  it('꾸준히 하는 게임의 소개는 허브 카드의 한 줄에 들어가는 길이다', () => {
    for (const game of gamesInGroup(GAMES, 'steady')) {
      expect(game.steady?.trim(), game.id).toBe(game.steady);
      expect(game.steady!.length, game.id).toBeGreaterThan(0);
      expect(game.steady!.length, game.id).toBeLessThanOrEqual(STEADY_LINE_CHARS);
    }
  });

  it('대표 게임은 꾸준히 하는 게임이라, 처음 여는 허브의 첫 카드가 된다', () => {
    const featured = GAMES.filter((game) => game.featured);
    expect(featured.length).toBeGreaterThan(0);
    for (const game of featured) expect(hubGroupOf(game), game.id).toBe('steady');
    expect(personalHubOrder(gamesInGroup(GAMES, 'steady'), [], () => null)[0].id).toBe(LANTERN_GAME_ID);
  });

  it('허브를 처음 열 때는 가장 최근에 한 게임이 있는 갈래를 열고, 해 본 게임이 없으면 꾸준히 하는 게임을 연다', () => {
    const games = [{ id: 'a' }, { id: 'b', steady: '소개' }, { id: 'c' }];
    const at = (times: Record<string, number>) => (id: string): number | null => times[id] ?? null;
    expect(startingHubGroup(games, at({}))).toBe('steady');
    expect(startingHubGroup(games, at({ a: 100 }))).toBe('quick');
    expect(startingHubGroup(games, at({ a: 100, b: 200 }))).toBe('steady');
    expect(startingHubGroup(games, at({ a: 100, b: 200, c: 300 }))).toBe('quick');
    // 목록에 없는 게임의 기록은 보지 않는다.
    expect(startingHubGroup(games, at({ 없는: 900, b: 1 }))).toBe('steady');
    expect(startingHubGroup(GAMES, at({ 'candy-slot': 5 }))).toBe('steady');
  });

  it('id로 게임을 찾는다', () => {
    expect(getGame('lightning-tap')?.title).toBe('번개 탭');
    expect(getGame('없는-게임')).toBeUndefined();
  });
});

describe('가장 최근에 한 게임', () => {
  const played: Record<string, number> = { a: 100, c: 300, d: 300 };
  const at = (id: string): number | null => played[id] ?? null;

  it('마지막으로 한 때가 가장 가까운 게임을 고른다', () => {
    expect(lastPlayedGame(['a', 'b', 'c'], at)).toBe('c');
    expect(lastPlayedGame(['a', 'b'], at)).toBe('a');
  });

  it('같은 때에 한 것이 여럿이면 먼저 적힌 것을 고른다', () => {
    expect(lastPlayedGame(['d', 'c'], at)).toBe('d');
    expect(lastPlayedGame(['c', 'd'], at)).toBe('c');
  });

  it('해 본 게임이 없으면 null이다', () => {
    expect(lastPlayedGame(['b', 'x'], at)).toBeNull();
    expect(lastPlayedGame([], at)).toBeNull();
  });
});

describe('주간 미션', () => {
  it('갈래마다 플레이할 수 있는 게임이 세 개 이상 있다', () => {
    for (const genre of GENRES) {
      const members = weeklyGames().filter((game) => game.genre === genre);
      expect(members.length, genre).toBeGreaterThanOrEqual(3);
    }
  });

  it('갈래 미션의 설명에 예로 들 만큼 이름이 짧은 게임이 갈래마다 두 개 이상 있다', () => {
    for (const genre of GENRES) {
      const short = weeklyGames().filter((game) => game.genre === genre && game.title.length <= 5);
      expect(short.length, genre).toBeGreaterThanOrEqual(2);
    }
  });

  it('둘이서 하는 게임과 오늘의 도전에 나오지 않는 게임은 "이 게임 몇 판" 미션으로 내지 않는다', () => {
    const quick = new Set(weeklyGames().filter((game) => game.quick).map((game) => game.id));
    expect(quick.size).toBeGreaterThan(0);
    for (const game of GAMES) {
      if (game.versus || game.dailyTargets.length === 0) expect(quick.has(game.id), game.id).toBe(false);
    }
  });

  it('아직 플레이할 수 없는 게임은 미션에 들어가지 않는다', () => {
    const games = weeklyGames([
      { ...GAMES[0], id: 'ready' },
      { ...GAMES[0], id: 'soon', sceneKey: null },
    ]);
    expect(games.map((game) => game.id)).toEqual(['ready']);
  });

  it('이번 주의 미션은 세 개이고, 한 주 동안 바뀌지 않는다', () => {
    // 2026년 11월 9일은 월요일이다.
    const monday = thisWeek(createWeekly(), new Date(2026, 10, 9, 0, 1));
    const sunday = thisWeek(createWeekly(), new Date(2026, 10, 15, 23, 59));
    expect(monday?.weekKey).toBe('2026-11-09');
    expect(monday?.missions).toHaveLength(3);
    expect(sunday).toEqual(monday);
    expect(thisWeek(createWeekly(), new Date(2026, 10, 16, 0, 1))?.weekKey).toBe('2026-11-16');
  });

  it('미션이 세는 게임은 모두 목록에 있는 플레이할 수 있는 게임이다', () => {
    for (let week = 0; week < 26; week += 1) {
      const context = thisWeek(createWeekly(), new Date(2026, 10, 9 + week * 7, 12));
      for (const mission of context?.missions ?? []) {
        for (const id of mission.counts ?? []) expect(getGame(id)?.sceneKey, id).not.toBeNull();
      }
    }
  });

  it('세 큰 게임은 "이번 주의 게임" 대신 큰 게임 미션으로 열두 주 안에 한 번씩 나온다', () => {
    const bigGames = [COMPANY_GAME_ID, GARDEN_GAME_ID, LANTERN_GAME_ID].sort();
    const big = weeklyGames().filter((game) => game.big);
    expect(big.map((game) => game.id).sort()).toEqual(bigGames);
    for (const game of big) expect(game.quick, game.id).toBe(false);
    const counted = new Set<string>();
    for (let week = 0; week < 12; week += 1) {
      const context = thisWeek(createWeekly(), new Date(2026, 10, 16 + week * 7, 12));
      for (const mission of context?.missions ?? []) {
        if (mission.kind === 'big') counted.add(mission.counts?.[0] ?? '');
      }
    }
    expect([...counted].sort()).toEqual(bigGames);
  });

  it('미션의 글은 업적 화면의 한 줄에 들어가는 길이다', () => {
    for (let week = 0; week < 52; week += 1) {
      const context = thisWeek(createWeekly(), new Date(2026, 10, 9 + week * 7, 12));
      for (const mission of context?.missions ?? []) {
        expect(mission.title.length, mission.title).toBeLessThanOrEqual(12);
        // 가장 긴 설명은 다섯 글자 이름 두 개를 예로 든 "논리 타일, 머지 타일 같은 게임"이다.
        expect(mission.description.length, mission.description).toBeLessThanOrEqual(18);
      }
    }
  });

  it('기기 시계가 뒤로 돌아가 있으면 기록이 있는 주를 따른다', () => {
    const later = recordWeeklyPlay(createWeekly(), '2026-11-16', {
      gameId: GAMES[0].id,
      coins: 0,
      dailyCleared: false,
    });
    expect(thisWeek(later, new Date(2026, 10, 12, 12))?.weekKey).toBe('2026-11-16');
  });
});
