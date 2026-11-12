import { describe, expect, it } from 'vitest';
import {
  activeStreak,
  challengeFor,
  clearDaily,
  createDailyState,
  DAILY_REWARDS,
  dateKeyOf,
  dateKeyOfDay,
  dayNumber,
  isCleared,
  normalizeDaily,
  RECENT_SHOWN,
  recentDays,
  streakBonus,
  type DailyGame,
  type DailyState,
} from './daily';

const GAMES: DailyGame[] = [
  { id: 'a', targets: [10, 20, 30] },
  { id: 'b', targets: [100, 200, 300] },
  { id: 'c', targets: [5, 6, 7] },
];

/** 2026-11-20까지 사흘을 이어서 달성했을 때의 recent */
const RUN_TO_20 = ['2026-11-18', '2026-11-19', '2026-11-20'];

/** 2026-11-01부터 이어지는 날짜들 */
function days(count: number): string[] {
  return Array.from({ length: count }, (_, index) => dateKeyOf(new Date(2026, 10, 1 + index)));
}

describe('날짜', () => {
  it('현지 날짜를 YYYY-MM-DD로 만든다', () => {
    expect(dateKeyOf(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(dateKeyOf(new Date(2026, 11, 31, 0, 0))).toBe('2026-12-31');
  });

  it('하루가 지나면 1씩 늘어난다(달과 해가 바뀌어도)', () => {
    expect(dayNumber('2026-11-12')! - dayNumber('2026-11-11')!).toBe(1);
    expect(dayNumber('2026-12-01')! - dayNumber('2026-11-30')!).toBe(1);
    expect(dayNumber('2027-01-01')! - dayNumber('2026-12-31')!).toBe(1);
    expect(dayNumber('2028-03-01')! - dayNumber('2028-02-28')!).toBe(2);
  });

  it('형식이 틀리거나 없는 날짜는 받아들이지 않는다', () => {
    for (const bad of ['', '2026-1-5', '2026/01/05', '2026-02-30', '2026-13-01', 'today']) {
      expect(dayNumber(bad), bad).toBeNull();
    }
  });

  it('날짜 수를 다시 날짜로 되돌릴 수 있다', () => {
    expect(dateKeyOfDay(0)).toBe('1970-01-01');
    expect(dateKeyOfDay(-3)).toBe('1969-12-29');
    for (const key of ['2026-01-05', '2026-11-12', '2026-12-31', '2028-02-29', '2031-03-01']) {
      expect(dateKeyOfDay(dayNumber(key)!), key).toBe(key);
    }
  });
});

describe('그 날의 도전', () => {
  it('같은 날짜에는 언제나 같은 도전이 나온다', () => {
    expect(challengeFor('2026-11-11', GAMES)).toEqual(challengeFor('2026-11-11', GAMES));
  });

  it('게임은 날마다 차례로 돌아가서 며칠 안에 모두 나온다', () => {
    const picked = days(GAMES.length).map((day) => challengeFor(day, GAMES)!.gameId);
    expect([...picked].sort()).toEqual(['a', 'b', 'c']);
    // 다음 주기에도 같은 순서로 돈다.
    const next = days(GAMES.length * 2).slice(GAMES.length).map((day) => challengeFor(day, GAMES)!.gameId);
    expect(next).toEqual(picked);
  });

  it('목표는 그 게임의 목표 가운데 하나이고, 보상은 그 단계에 맞는다', () => {
    const seen = new Set<number>();
    for (const day of days(120)) {
      const challenge = challengeFor(day, GAMES)!;
      const game = GAMES.find((item) => item.id === challenge.gameId)!;
      const tier = game.targets.indexOf(challenge.target);
      expect(tier).toBeGreaterThanOrEqual(0);
      expect(challenge.reward).toBe(DAILY_REWARDS[tier]);
      expect(challenge.dateKey).toBe(day);
      seen.add(tier);
    }
    // 넉 달이면 모든 단계가 한 번씩은 나온다.
    expect(seen.size).toBe(3);
  });

  it('목표가 보상 단계보다 많으면 가장 큰 보상에서 멈춘다', () => {
    const many: DailyGame[] = [{ id: 'x', targets: [1, 2, 3, 4, 5, 6] }];
    for (const day of days(60)) {
      expect(DAILY_REWARDS).toContain(challengeFor(day, many)!.reward);
    }
  });

  it('날짜가 잘못됐거나 쓸 게임이 없으면 도전이 없다', () => {
    expect(challengeFor('2026-02-30', GAMES)).toBeNull();
    expect(challengeFor('2026-11-11', [])).toBeNull();
    expect(challengeFor('2026-11-11', [{ id: 'empty', targets: [] }])).toBeNull();
  });
});

describe('연속 달성', () => {
  it('처음 달성하면 1일, 다음 날 또 달성하면 2일이 된다', () => {
    let state = createDailyState();
    expect(isCleared(state, '2026-11-11')).toBe(false);
    expect(activeStreak(state, '2026-11-11')).toBe(0);

    state = clearDaily(state, '2026-11-11');
    expect(state).toEqual({
      lastClearedOn: '2026-11-11',
      streak: 1,
      bestStreak: 1,
      totalCleared: 1,
      recent: ['2026-11-11'],
    });
    expect(isCleared(state, '2026-11-11')).toBe(true);

    state = clearDaily(state, '2026-11-12');
    expect(state).toEqual({
      lastClearedOn: '2026-11-12',
      streak: 2,
      bestStreak: 2,
      totalCleared: 2,
      recent: ['2026-11-11', '2026-11-12'],
    });
  });

  it('같은 날 두 번 달성해도 한 번만 센다', () => {
    const once = clearDaily(createDailyState(), '2026-11-11');
    expect(clearDaily(once, '2026-11-11')).toBe(once);
  });

  it('다음 날까지는 연속이 살아 있고, 하루를 건너뛰면 끊긴다', () => {
    const recent = ['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11'];
    const state = { lastClearedOn: '2026-11-11', streak: 4, bestStreak: 6, totalCleared: 9, recent };
    expect(activeStreak(state, '2026-11-11')).toBe(4);
    expect(activeStreak(state, '2026-11-12')).toBe(4);
    expect(activeStreak(state, '2026-11-13')).toBe(0);
    // 연속은 끊겨도 가장 길었던 기록은 남는다.
    expect(clearDaily(state, '2026-11-13')).toEqual({
      lastClearedOn: '2026-11-13',
      streak: 1,
      bestStreak: 6,
      totalCleared: 10,
      // 연속은 끊겼어도 앞서 달성한 날들은 남아 있다.
      recent: [...recent, '2026-11-13'],
    });
  });

  it('가장 긴 연속 기록은 지금의 연속이 넘어설 때만 늘어난다', () => {
    let state: DailyState = {
      lastClearedOn: '2026-11-11',
      streak: 2,
      bestStreak: 3,
      totalCleared: 9,
      recent: ['2026-11-10', '2026-11-11'],
    };
    state = clearDaily(state, '2026-11-12');
    expect([state.streak, state.bestStreak]).toEqual([3, 3]);
    state = clearDaily(state, '2026-11-13');
    expect([state.streak, state.bestStreak]).toEqual([4, 4]);
  });

  it('기기 시계를 마지막 달성일보다 앞으로 되돌리면 이미 달성한 것으로 친다', () => {
    const state = { lastClearedOn: '2026-11-20', streak: 3, bestStreak: 3, totalCleared: 3, recent: RUN_TO_20 };
    for (const earlier of ['2026-11-19', '2026-11-11', '2025-12-31']) {
      expect(isCleared(state, earlier)).toBe(true);
      // 다시 달성해도 기록이 바뀌지 않으니 보상도 연속도 늘지 않는다.
      expect(clearDaily(state, earlier)).toBe(state);
      expect(activeStreak(state, earlier)).toBe(3);
    }
  });

  it('시계를 되돌렸다가 제자리로 돌려놓으면 원래대로 이어진다', () => {
    const state = { lastClearedOn: '2026-11-20', streak: 3, bestStreak: 3, totalCleared: 3, recent: RUN_TO_20 };
    expect(clearDaily(state, '2026-11-19')).toBe(state);
    expect(isCleared(state, '2026-11-21')).toBe(false);
    expect(clearDaily(state, '2026-11-21')).toEqual({
      lastClearedOn: '2026-11-21',
      streak: 4,
      bestStreak: 4,
      totalCleared: 4,
      recent: [...RUN_TO_20, '2026-11-21'],
    });
  });

  it('달성한 적이 없거나 날짜가 잘못됐으면 달성한 것으로 치지 않는다', () => {
    expect(isCleared(createDailyState(), '2026-11-11')).toBe(false);
    const state = { lastClearedOn: '2026-11-20', streak: 3, bestStreak: 3, totalCleared: 3, recent: RUN_TO_20 };
    expect(isCleared(state, '어제')).toBe(false);
    expect(isCleared(state, '2026-02-30')).toBe(false);
  });

  it('연속 보너스는 이틀째부터 5개씩 늘어 25개에서 멈춘다', () => {
    expect([0, 1, 2, 3, 6, 7, 100].map(streakBonus)).toEqual([0, 0, 5, 10, 25, 25, 25]);
  });
});

describe('normalizeDaily', () => {
  it('없거나 깨진 값은 처음 상태로 만든다', () => {
    for (const raw of [undefined, null, 'x', 3, {}, { lastClearedOn: '2026-02-30', streak: 5 }]) {
      expect(normalizeDaily(raw)).toEqual(createDailyState());
    }
  });

  it('올바른 값은 그대로 두고, 숫자는 정리한다', () => {
    const good = {
      lastClearedOn: '2026-11-11',
      streak: 3,
      bestStreak: 5,
      totalCleared: 7,
      recent: ['2026-11-05', '2026-11-09', '2026-11-10', '2026-11-11'],
    };
    expect(normalizeDaily(good)).toEqual(good);
    expect(normalizeDaily({ lastClearedOn: '2026-11-11', streak: -2, totalCleared: 'many' })).toEqual({
      lastClearedOn: '2026-11-11',
      streak: 1,
      bestStreak: 1,
      totalCleared: 1,
      recent: ['2026-11-11'],
    });
  });

  it('가장 긴 연속 기록이 없던 예전 값은 지금의 연속으로 채운다', () => {
    expect(normalizeDaily({ lastClearedOn: '2026-11-11', streak: 4, totalCleared: 6 })).toEqual({
      lastClearedOn: '2026-11-11',
      streak: 4,
      bestStreak: 4,
      totalCleared: 6,
      recent: ['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11'],
    });
    // 지금의 연속보다 짧게 적혀 있으면 바로잡는다.
    expect(
      normalizeDaily({ lastClearedOn: '2026-11-11', streak: 4, bestStreak: 2, totalCleared: 6 }).bestStreak,
    ).toBe(4);
  });
});

describe('최근에 달성한 날', () => {
  it('recent가 없던 예전 세이브는 지금 이어지는 연속으로 채운다', () => {
    const state = normalizeDaily({ lastClearedOn: '2026-11-11', streak: 3, bestStreak: 3, totalCleared: 9 });
    expect(state.recent).toEqual(['2026-11-09', '2026-11-10', '2026-11-11']);
    // 아주 긴 연속이어도 남겨 두는 날 수는 정해져 있다.
    const long = normalizeDaily({ lastClearedOn: '2026-11-11', streak: 40, totalCleared: 40 });
    expect(long.recent).toHaveLength(14);
    expect(long.recent[0]).toBe('2026-10-29');
    expect(long.recent.at(-1)).toBe('2026-11-11');
  });

  it('깨진 값, 겹친 날, 너무 오래된 날, 마지막 달성일보다 뒤의 날은 버린다', () => {
    const state = normalizeDaily({
      lastClearedOn: '2026-11-11',
      streak: 1,
      totalCleared: 5,
      recent: ['2026-11-09', '2026-11-09', 7, '어제', '2026-02-30', '2026-10-01', '2026-11-12', '2026-11-07'],
    });
    expect(state.recent).toEqual(['2026-11-07', '2026-11-09', '2026-11-11']);
    expect(normalizeDaily({ lastClearedOn: '2026-11-11', streak: 1, recent: 'x' }).recent).toEqual(['2026-11-11']);
  });

  it('달성할 때마다 그날이 더해지고, 연속이 끊긴 앞쪽의 날도 남는다', () => {
    let state = createDailyState();
    for (const day of ['2026-11-03', '2026-11-04', '2026-11-06', '2026-11-07', '2026-11-08']) {
      state = clearDaily(state, day);
    }
    expect(state.streak).toBe(3);
    expect(state.recent).toEqual(['2026-11-03', '2026-11-04', '2026-11-06', '2026-11-07', '2026-11-08']);
    // 두 주가 지나면 오래된 날부터 빠진다.
    state = clearDaily(state, '2026-11-18');
    expect(state.recent).toEqual(['2026-11-06', '2026-11-07', '2026-11-08', '2026-11-18']);
    // 세이브를 거쳐도 그대로다.
    expect(normalizeDaily(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });

  it('오늘까지 이레를 오래된 날부터 돌려주고, 달성한 날과 오늘을 표시한다', () => {
    let state = createDailyState();
    for (const day of ['2026-11-03', '2026-11-04', '2026-11-06', '2026-11-08']) state = clearDaily(state, day);

    const week = recentDays(state, '2026-11-09');
    expect(week).toHaveLength(RECENT_SHOWN);
    expect(week.map((day) => day.dateKey)).toEqual([
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
      '2026-11-09',
    ]);
    expect(week.map((day) => day.cleared)).toEqual([true, true, false, true, false, true, false]);
    expect(week.map((day) => day.today)).toEqual([false, false, false, false, false, false, true]);

    // 오늘 달성하면 오늘 칸도 채워진다.
    expect(recentDays(clearDaily(state, '2026-11-09'), '2026-11-09').at(-1)).toEqual({
      dateKey: '2026-11-09',
      cleared: true,
      today: true,
    });
  });

  it('한 번도 달성하지 않았으면 모두 비어 있고, 날짜가 잘못됐으면 빈 배열이다', () => {
    expect(recentDays(createDailyState(), '2026-11-09').some((day) => day.cleared)).toBe(false);
    expect(recentDays(createDailyState(), '어제')).toEqual([]);
  });

  it('시계를 되돌린 날에는 오늘 칸을 카드와 같이 달성한 것으로 보여 준다', () => {
    const state = clearDaily(createDailyState(), '2026-11-20');
    const week = recentDays(state, '2026-11-15');
    expect(week.at(-1)).toEqual({ dateKey: '2026-11-15', cleared: true, today: true });
    expect(week.slice(0, -1).some((day) => day.cleared)).toBe(false);
  });
});
