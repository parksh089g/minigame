import { describe, expect, it } from 'vitest';
import { dateKeyOfDay, dayNumber } from './daily';
import {
  claimableMissions,
  claimMission,
  createWeekly,
  currentWeekKey,
  daysLeft,
  GENRES,
  MISSION_IDS,
  missionProgress,
  missionsFor,
  normalizeWeekly,
  recordWeeklyPlay,
  weekContext,
  weekKeyOf,
  weeklyFor,
  type MissionKind,
  type WeekContext,
  type WeeklyGame,
  type WeeklyMission,
  type WeeklyState,
} from './weekly';

const GAMES: WeeklyGame[] = [
  { id: 'p1', title: '길 잇기', genre: 'puzzle', quick: true },
  { id: 'p2', title: '머지 타일', genre: 'puzzle', quick: true },
  { id: 'p3', title: '색깔 물 나누기', genre: 'puzzle', quick: true },
  { id: 'a1', title: '번개 탭', genre: 'action', quick: true },
  { id: 'a2', title: '탑 쌓기', genre: 'action', quick: true },
  { id: 'long', title: '등불지기', genre: null, quick: false },
  { id: 'duo', title: '둘이서 대결', genre: null, quick: false },
];

/** 2026년 11월 9일은 월요일이다. */
const WEEK = '2026-11-09';
const NEXT_WEEK = '2026-11-16';

/** WEEK부터 이어지는 주들의 이름 */
function weeks(count: number): string[] {
  const start = dayNumber(WEEK) ?? 0;
  return Array.from({ length: count }, (_, index) => dateKeyOfDay(start + index * 7));
}

/** 한 판씩 차례로 기록한다. */
function played(gameIds: readonly string[], weekKey: string = WEEK, from: WeeklyState = createWeekly()): WeeklyState {
  return gameIds.reduce(
    (state, gameId) => recordWeeklyPlay(state, weekKey, { gameId, coins: 0, dailyCleared: false }),
    from,
  );
}

/** 여러 주를 훑어서 그 종류의 미션을 하나 찾는다. */
function findMission(kind: MissionKind, games: readonly WeeklyGame[] = GAMES): { weekKey: string; mission: WeeklyMission } {
  for (const weekKey of weeks(12)) {
    const mission = missionsFor(weekKey, games).find((candidate) => candidate.kind === kind);
    if (mission) return { weekKey, mission };
  }
  throw new Error(`${kind} 미션이 12주 안에 나오지 않았다`);
}

describe('주의 이름', () => {
  it('그 주 월요일의 날짜다', () => {
    expect(weekKeyOf('2026-11-09')).toBe(WEEK);
    expect(weekKeyOf('2026-11-12')).toBe(WEEK);
    expect(weekKeyOf('2026-11-15')).toBe(WEEK);
    expect(weekKeyOf('2026-11-16')).toBe(NEXT_WEEK);
  });

  it('달과 해가 바뀌는 주도 월요일로 묶인다', () => {
    expect(weekKeyOf('2027-01-01')).toBe('2026-12-28');
    expect(weekKeyOf('2027-01-03')).toBe('2026-12-28');
    expect(weekKeyOf('2027-01-04')).toBe('2027-01-04');
    expect(weekKeyOf('2024-02-29')).toBe('2024-02-26');
    // 1970년 1월 1일은 목요일이다.
    expect(weekKeyOf('1970-01-01')).toBe('1969-12-29');
  });

  it('잘못된 날짜면 null이다', () => {
    expect(weekKeyOf('2026-02-30')).toBeNull();
    expect(weekKeyOf('오늘')).toBeNull();
  });

  it('남은 날 수는 오늘을 넣어서 센다', () => {
    expect(daysLeft(WEEK, '2026-11-09')).toBe(7);
    expect(daysLeft(WEEK, '2026-11-12')).toBe(4);
    expect(daysLeft(WEEK, '2026-11-15')).toBe(1);
  });

  it('시계가 그 주 밖에 있어도 남은 날 수는 1에서 7 사이다', () => {
    expect(daysLeft(NEXT_WEEK, '2026-11-12')).toBe(7);
    expect(daysLeft(WEEK, '2026-11-20')).toBe(1);
    expect(daysLeft('엉뚱한 값', '2026-11-12')).toBe(7);
  });
});

describe('이번 주의 미션', () => {
  it('쉬운 것부터 세 개가 나온다', () => {
    const missions = missionsFor(WEEK, GAMES);
    expect(missions.map((mission) => mission.id)).toEqual([...MISSION_IDS]);
    const [easy, normal, hard] = missions;
    expect(easy.reward).toBeLessThan(normal.reward);
    expect(normal.reward).toBeLessThan(hard.reward);
    for (const mission of missions) {
      expect(mission.goal).toBeGreaterThan(0);
      expect(mission.title.length).toBeGreaterThan(0);
      expect(mission.description.length).toBeGreaterThan(0);
    }
  });

  it('같은 주에는 언제나 같은 미션이다', () => {
    expect(missionsFor(WEEK, GAMES)).toEqual(missionsFor(WEEK, GAMES));
  });

  it('잇닿은 두 주에 같은 종류의 쉬운 미션과 보통 미션이 거듭 나오지 않는다', () => {
    const list = weeks(26).map((weekKey) => missionsFor(weekKey, GAMES));
    for (let index = 1; index < list.length; index += 1) {
      expect(list[index][0].kind).not.toBe(list[index - 1][0].kind);
      expect(list[index][1].title).not.toBe(list[index - 1][1].title);
    }
  });

  it('열두 주 안에 모든 종류의 미션이 나온다', () => {
    const kinds = new Set(weeks(12).flatMap((weekKey) => missionsFor(weekKey, GAMES).map((mission) => mission.kind)));
    expect([...kinds].sort()).toEqual(['coins', 'daily', 'game', 'genre', 'plays', 'variety']);
  });

  it('갈래 미션은 그 갈래의 게임만 세고, 설명에 그 갈래의 게임 두 개를 예로 든다', () => {
    for (const weekKey of weeks(12)) {
      for (const mission of missionsFor(weekKey, GAMES)) {
        if (mission.kind !== 'genre') continue;
        const genre = GENRES.find((candidate) =>
          GAMES.filter((game) => game.genre === candidate).every((game) => mission.counts?.includes(game.id)),
        );
        expect(genre, mission.title).toBeDefined();
        const members = GAMES.filter((game) => game.genre === genre);
        expect(mission.counts).toEqual(members.map((game) => game.id));
        const named = members.filter((game) => mission.description.includes(game.title));
        expect(named.length, mission.description).toBe(2);
      }
    }
  });

  it('이번 주의 게임은 한 판이 짧은 게임 가운데에서 나온다', () => {
    for (const weekKey of weeks(30)) {
      for (const mission of missionsFor(weekKey, GAMES)) {
        if (mission.kind !== 'game') continue;
        expect(mission.counts).toHaveLength(1);
        const game = GAMES.find((candidate) => candidate.id === mission.counts?.[0]);
        expect(game?.quick, mission.title).toBe(true);
        expect(mission.title).toContain(game?.title);
      }
    }
  });

  it('낼 수 없는 미션은 건너뛴다', () => {
    // 갈래가 있는 게임도, 한 판이 짧은 게임도 없으면 판 수와 가짓수로만 채운다.
    const bare: WeeklyGame[] = [{ id: 'duo', title: '둘이서 대결', genre: null, quick: false }];
    for (const weekKey of weeks(6)) {
      const [easy, normal] = missionsFor(weekKey, bare);
      expect(['plays', 'variety']).toContain(normal.kind);
      expect(normal.kind).not.toBe(easy.kind);
    }
    // 순발력 게임이 없으면 순발력 미션은 나오지 않는다.
    const puzzlesOnly = GAMES.filter((game) => game.genre !== 'action');
    for (const weekKey of weeks(12)) {
      for (const mission of missionsFor(weekKey, puzzlesOnly)) {
        expect(mission.title).not.toContain('순발력');
      }
    }
  });

  it('월요일이 아닌 날짜나 잘못된 날짜로는 미션이 나오지 않는다', () => {
    expect(missionsFor('2026-11-12', GAMES)).toEqual([]);
    expect(missionsFor('엉뚱한 값', GAMES)).toEqual([]);
  });
});

describe('지금 따질 주', () => {
  it('기록이 없으면 오늘이 속한 주다', () => {
    expect(currentWeekKey(createWeekly(), '2026-11-12')).toBe(WEEK);
  });

  it('주가 바뀌면 새 주로 넘어간다', () => {
    expect(currentWeekKey(played(['p1']), '2026-11-16')).toBe(NEXT_WEEK);
  });

  it('기기 시계를 되돌려도 기록이 있는 주에서 뒤로 가지 않는다', () => {
    const state = played(['p1'], NEXT_WEEK);
    expect(currentWeekKey(state, '2026-11-12')).toBe(NEXT_WEEK);
    expect(weekContext(state, '2026-11-12', GAMES)?.weekKey).toBe(NEXT_WEEK);
  });

  it('잘못된 날짜면 null이다', () => {
    expect(currentWeekKey(createWeekly(), '2026-13-01')).toBeNull();
    expect(weekContext(createWeekly(), '2026-13-01', GAMES)).toBeNull();
  });

  it('그 주의 미션을 함께 돌려준다', () => {
    const week = weekContext(createWeekly(), '2026-11-12', GAMES);
    expect(week).toEqual({ weekKey: WEEK, missions: missionsFor(WEEK, GAMES) });
  });
});

describe('한 주의 기록', () => {
  it('한 판마다 그 게임의 판 수와 얻은 코인, 달성한 도전을 센다', () => {
    let state = recordWeeklyPlay(createWeekly(), WEEK, { gameId: 'p1', coins: 7, dailyCleared: false });
    state = recordWeeklyPlay(state, WEEK, { gameId: 'p1', coins: 30, dailyCleared: true });
    state = recordWeeklyPlay(state, WEEK, { gameId: 'a1', coins: 0, dailyCleared: false });
    expect(state).toEqual({
      weekKey: WEEK,
      plays: { p1: 2, a1: 1 },
      coins: 37,
      dailyClears: 1,
      claimed: [],
    });
  });

  it('원본은 바꾸지 않는다', () => {
    const before = played(['p1']);
    const copy = structuredClone(before);
    recordWeeklyPlay(before, WEEK, { gameId: 'p1', coins: 5, dailyCleared: true });
    expect(before).toEqual(copy);
  });

  it('주가 바뀌면 처음부터 다시 센다', () => {
    const last = { ...played(['p1', 'p1', 'a1']), coins: 50, claimed: ['easy' as const] };
    const next = recordWeeklyPlay(last, NEXT_WEEK, { gameId: 'p2', coins: 3, dailyCleared: false });
    expect(next).toEqual({ weekKey: NEXT_WEEK, plays: { p2: 1 }, coins: 3, dailyClears: 0, claimed: [] });
  });

  it('기록보다 앞선 주로는 세지 않는다', () => {
    const state = played(['p1'], NEXT_WEEK);
    expect(weeklyFor(state, WEEK)).toBeNull();
    expect(recordWeeklyPlay(state, WEEK, { gameId: 'p1', coins: 9, dailyCleared: true })).toBe(state);
  });

  it('weeklyFor는 같은 주면 그대로, 새 주면 빈 기록을 준다', () => {
    const state = played(['p1']);
    expect(weeklyFor(state, WEEK)).toBe(state);
    expect(weeklyFor(state, NEXT_WEEK)).toEqual({ ...createWeekly(), weekKey: NEXT_WEEK });
    expect(weeklyFor(createWeekly(), WEEK)).toEqual({ ...createWeekly(), weekKey: WEEK });
  });
});

describe('미션의 진행', () => {
  it('아무 게임이나: 모든 게임의 판 수를 더한다', () => {
    const { weekKey, mission } = findMission('plays');
    const state = played(['p1', 'a1', 'long', 'duo'], weekKey);
    expect(missionProgress(mission, state)).toEqual({ current: 4, goal: mission.goal, complete: false });
  });

  it('서로 다른 게임: 같은 게임을 여러 판 해도 한 가지로 센다', () => {
    const { weekKey, mission } = findMission('variety');
    const state = played(['p1', 'p1', 'p1', 'a1'], weekKey);
    expect(missionProgress(mission, state).current).toBe(2);
  });

  it('갈래: 그 갈래의 게임만 센다', () => {
    const { weekKey, mission } = findMission('genre');
    const inGenre = mission.counts?.[0] ?? '';
    const outside = GAMES.find((game) => !mission.counts?.includes(game.id))?.id ?? '';
    const state = played([inGenre, inGenre, outside, 'long'], weekKey);
    expect(missionProgress(mission, state).current).toBe(2);
  });

  it('이번 주의 게임: 그 게임만 센다', () => {
    const { weekKey, mission } = findMission('game');
    const target = mission.counts?.[0] ?? '';
    const other = GAMES.find((game) => game.id !== target)?.id ?? '';
    const state = played([target, other, other], weekKey);
    expect(missionProgress(mission, state).current).toBe(1);
  });

  it('코인: 이번 주에 게임으로 얻은 코인을 센다', () => {
    const { weekKey, mission } = findMission('coins');
    const state = recordWeeklyPlay(createWeekly(), weekKey, { gameId: 'p1', coins: 12, dailyCleared: false });
    expect(missionProgress(mission, state).current).toBe(12);
  });

  it('오늘의 도전: 이번 주에 달성한 횟수를 센다', () => {
    const { weekKey, mission } = findMission('daily');
    let state = recordWeeklyPlay(createWeekly(), weekKey, { gameId: 'p1', coins: 0, dailyCleared: true });
    state = recordWeeklyPlay(state, weekKey, { gameId: 'p1', coins: 0, dailyCleared: false });
    expect(missionProgress(mission, state).current).toBe(1);
  });

  it('목표를 넘으면 달성이고, 진행은 목표에서 멈춘다', () => {
    const { weekKey, mission } = findMission('plays');
    const state = played(Array.from({ length: mission.goal + 3 }, () => 'p1'), weekKey);
    expect(missionProgress(mission, state)).toEqual({ current: mission.goal, goal: mission.goal, complete: true });
  });
});

describe('보상 받기', () => {
  const week: WeekContext = { weekKey: WEEK, missions: missionsFor(WEEK, GAMES) };
  const easy = week.missions[0];
  /** 쉬운 미션을 다 채운 기록: 서로 다른 게임을 목표만큼, 판 수도 목표만큼 */
  const done = played(
    Array.from({ length: easy.goal }, (_, index) => GAMES[index % GAMES.length].id),
  );

  it('다 채운 미션만 받을 수 있는 것으로 나온다', () => {
    expect(missionProgress(easy, done).complete).toBe(true);
    expect(claimableMissions(createWeekly(), week)).toEqual([]);
    expect(claimableMissions(done, week).map((mission) => mission.id)).toContain('easy');
  });

  it('받으면 받은 것으로 남고, 원본은 바꾸지 않는다', () => {
    const result = claimMission(done, week, 'easy');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mission).toBe(easy);
    expect(result.state.claimed).toEqual(['easy']);
    expect(result.state.plays).toEqual(done.plays);
    expect(done.claimed).toEqual([]);
    expect(claimableMissions(result.state, week).map((mission) => mission.id)).not.toContain('easy');
  });

  it('한 번만 받을 수 있다', () => {
    const result = claimMission(done, week, 'easy');
    if (!result.ok) throw new Error('보상 받기 실패');
    expect(claimMission(result.state, week, 'easy')).toEqual({ ok: false, reason: 'claimed' });
  });

  it('덜 채운 미션과 없는 미션은 받을 수 없다', () => {
    expect(claimMission(createWeekly(), week, 'easy')).toEqual({ ok: false, reason: 'incomplete' });
    expect(claimMission(done, week, 'bonus')).toEqual({ ok: false, reason: 'unknown' });
  });

  it('지난주에 채운 미션은 새 주에 받을 수 없다', () => {
    const next: WeekContext = { weekKey: NEXT_WEEK, missions: missionsFor(NEXT_WEEK, GAMES) };
    expect(claimableMissions(done, next)).toEqual([]);
    expect(claimMission(done, next, 'easy')).toEqual({ ok: false, reason: 'incomplete' });
  });

  it('기록보다 앞선 주의 미션은 받을 수 없다', () => {
    const later = played(['p1'], NEXT_WEEK);
    expect(claimableMissions(later, week)).toEqual([]);
    expect(claimMission(later, week, 'easy')).toEqual({ ok: false, reason: 'unknown' });
  });

  it('새 주로 넘어가면 받은 표시도 지워진다', () => {
    const claimed = claimMission(done, week, 'easy');
    if (!claimed.ok) throw new Error('보상 받기 실패');
    const next = recordWeeklyPlay(claimed.state, NEXT_WEEK, { gameId: 'p1', coins: 0, dailyCleared: false });
    expect(next.claimed).toEqual([]);
  });
});

describe('normalizeWeekly', () => {
  it('없거나 깨진 값이면 빈 기록이다', () => {
    expect(normalizeWeekly(undefined)).toEqual(createWeekly());
    expect(normalizeWeekly('깨진 값')).toEqual(createWeekly());
    expect(normalizeWeekly({})).toEqual(createWeekly());
  });

  it('올바른 기록은 그대로 둔다', () => {
    const state: WeeklyState = {
      weekKey: WEEK,
      plays: { p1: 3, a1: 1 },
      coins: 42,
      dailyClears: 2,
      claimed: ['easy', 'hard'],
    };
    expect(normalizeWeekly(state)).toEqual(state);
  });

  it('주의 이름이 월요일이 아니거나 날짜가 아니면 통째로 버린다', () => {
    expect(normalizeWeekly({ weekKey: '2026-11-12', plays: { p1: 3 }, coins: 9 })).toEqual(createWeekly());
    expect(normalizeWeekly({ weekKey: '2026-02-30', plays: { p1: 3 } })).toEqual(createWeekly());
    expect(normalizeWeekly({ weekKey: 7, plays: { p1: 3 } })).toEqual(createWeekly());
  });

  it('잘못된 숫자와 모르는 미션, 겹친 미션은 버린다', () => {
    const raw = {
      weekKey: WEEK,
      plays: { p1: 2.9, bad: -3, text: '많이', zero: 0, '': 4 },
      coins: -5,
      dailyClears: Number.NaN,
      claimed: ['easy', 'easy', 'bonus', 3, 'normal'],
    };
    expect(normalizeWeekly(raw)).toEqual({
      weekKey: WEEK,
      plays: { p1: 2 },
      coins: 0,
      dailyClears: 0,
      claimed: ['easy', 'normal'],
    });
  });

  it('plays와 claimed의 모양이 틀려도 깨지지 않는다', () => {
    expect(normalizeWeekly({ weekKey: WEEK, plays: ['p1'], claimed: 'easy' })).toEqual({
      ...createWeekly(),
      weekKey: WEEK,
    });
  });
});
