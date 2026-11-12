import { describe, expect, it } from 'vitest';
import {
  addDailyRun,
  createDaily,
  DAILY_REWARD,
  dailyPlan,
  dailyToday,
  dayIndexOf,
  dayLabel,
  normalizeDaily,
  withRo,
} from './daily';
import { HERO_ORDER, STAGE_ORDER, WEAPON_ORDER, WEAPONS } from './data';

describe('오늘의 판: 날짜', () => {
  it('기기의 시간대에서 자정에 하루가 넘어간다', () => {
    const late = new Date(2026, 10, 12, 23, 59, 59);
    const next = new Date(2026, 10, 13, 0, 0, 0);
    const noon = new Date(2026, 10, 12, 12, 0, 0);
    expect(dayIndexOf(late)).toBe(dayIndexOf(noon));
    expect(dayIndexOf(next)).toBe(dayIndexOf(noon) + 1);
    // 달과 해가 넘어가도 하루씩 는다.
    expect(dayIndexOf(new Date(2027, 0, 1, 0, 0, 1))).toBe(dayIndexOf(new Date(2026, 11, 31, 23, 0, 0)) + 1);
  });

  it('날짜를 달과 날로 적는다', () => {
    expect(dayLabel(dayIndexOf(new Date(2026, 10, 12, 9, 0, 0)))).toBe('11월 12일');
    expect(dayLabel(dayIndexOf(new Date(2027, 0, 1, 0, 0, 1)))).toBe('1월 1일');
  });
});

describe('오늘의 판: 조건', () => {
  it('같은 날이면 누구에게나 같고, 날이 바뀌면 캐릭터와 스테이지가 모두 바뀐다', () => {
    for (let day = 20_000; day < 20_060; day += 1) {
      const plan = dailyPlan(day);
      expect(dailyPlan(day)).toEqual(plan);
      expect(HERO_ORDER).toContain(plan.hero);
      expect(STAGE_ORDER).toContain(plan.stage);
      expect(Number.isInteger(plan.seed)).toBe(true);
      expect(plan.seed).toBeGreaterThanOrEqual(0);
      const next = dailyPlan(day + 1);
      expect(next.hero).not.toBe(plan.hero);
      expect(next.stage).not.toBe(plan.stage);
      expect(next.seed).not.toBe(plan.seed);
    }
  });

  it('캐릭터와 스테이지의 모든 짝이 차례로 한 번씩 나온다', () => {
    const cycle = HERO_ORDER.length * STAGE_ORDER.length;
    const pairs = new Set<string>();
    for (let day = 20_000; day < 20_000 + cycle; day += 1) {
      const plan = dailyPlan(day);
      pairs.add(`${plan.hero}/${plan.stage}`);
    }
    expect(pairs.size).toBe(cycle);
  });

  it('엉뚱한 날짜가 와도 조건은 나온다', () => {
    expect(dailyPlan(-5).day).toBe(0);
    expect(dailyPlan(20_000.7).day).toBe(20_000);
  });
});

describe('오늘의 판: 기록', () => {
  const today = 20_769;
  const run = (score: number, seconds = 100, cleared = false) => ({ score, seconds, cleared });

  it('그날 처음 마친 판에만 보너스가 붙고, 가장 좋은 기록이 남는다', () => {
    const first = addDailyRun(createDaily(), today, run(500, 120));
    expect(first.first).toBe(true);
    expect(first.improved).toBe(true);
    expect(first.record).toEqual({ day: today, best: 500, seconds: 120, cleared: false, tries: 1, streak: 1 });

    const worse = addDailyRun(first.record, today, run(300, 400));
    expect(worse.first).toBe(false);
    expect(worse.improved).toBe(false);
    expect(worse.record).toMatchObject({ best: 500, seconds: 120, tries: 2, streak: 1 });

    const better = addDailyRun(worse.record, today, run(900, 600, true));
    expect(better.first).toBe(false);
    expect(better.improved).toBe(true);
    expect(better.record).toEqual({ day: today, best: 900, seconds: 600, cleared: true, tries: 3, streak: 1 });
    // 새벽을 한 번 맞았으면 그 뒤의 판이 못해도 남는다.
    expect(addDailyRun(better.record, today, run(10)).record.cleared).toBe(true);
    expect(DAILY_REWARD).toBeGreaterThan(0);
  });

  it('날마다 이어서 하면 이어 온 날 수가 늘고, 하루라도 거르면 처음부터다', () => {
    let record = addDailyRun(createDaily(), today, run(100)).record;
    record = addDailyRun(record, today + 1, run(50)).record;
    expect(record).toMatchObject({ day: today + 1, best: 50, tries: 1, streak: 2 });
    record = addDailyRun(record, today + 2, run(70)).record;
    expect(record.streak).toBe(3);
    // 같은 날 여러 번 해도 하루만 는다.
    record = addDailyRun(record, today + 2, run(80)).record;
    expect(record.streak).toBe(3);
    // 하루를 거르면 다시 1일째다.
    record = addDailyRun(record, today + 4, run(10)).record;
    expect(record).toMatchObject({ day: today + 4, streak: 1, tries: 1, best: 10 });
  });

  it('오늘 아직 하지 않았으면 오늘의 기록은 비어 있고, 어제 했으면 이어 온 날 수는 보인다', () => {
    const record = addDailyRun(addDailyRun(createDaily(), today - 1, run(100)).record, today, run(200)).record;
    expect(dailyToday(record, today)).toBe(record);
    expect(dailyToday(record, today + 1)).toEqual({ day: today + 1, best: 0, seconds: 0, cleared: false, tries: 0, streak: 2 });
    expect(dailyToday(record, today + 2).streak).toBe(0);
    // 기기의 시계가 뒤로 가도 망가지지 않는다.
    expect(dailyToday(record, today - 3)).toMatchObject({ tries: 0, streak: 0 });
    expect(addDailyRun(record, today - 3, run(5)).record).toMatchObject({ day: today - 3, streak: 1, tries: 1 });
  });

  it('저장된 값이 엉뚱하면 빈 기록으로 돌린다', () => {
    expect(normalizeDaily(undefined)).toEqual(createDaily());
    expect(normalizeDaily('x')).toEqual(createDaily());
    expect(normalizeDaily({ day: today, tries: 0, best: 99 })).toEqual(createDaily());
    expect(normalizeDaily({ day: today, best: 12.7, seconds: -3, cleared: 'yes', tries: 2, streak: 0 })).toEqual({
      day: today,
      best: 12,
      seconds: 0,
      cleared: false,
      tries: 2,
      streak: 1,
    });
    const record = addDailyRun(createDaily(), today, run(321, 77, true)).record;
    expect(normalizeDaily(JSON.parse(JSON.stringify(record)))).toEqual(record);
  });
});

describe('오늘의 판: 글', () => {
  it('무기 이름에 알맞은 조사를 붙인다', () => {
    expect(withRo('종소리')).toBe('종소리로');
    expect(withRo('불씨탄')).toBe('불씨탄으로');
    expect(withRo('별')).toBe('별로');
    expect(withRo('abc')).toBe('abc로');
    for (const id of WEAPON_ORDER) expect(withRo(WEAPONS[id].name)).toMatch(/(으로|로)$/);
  });
});
