import { describe, expect, it } from 'vitest';
import {
  addDailyRun,
  createDaily,
  DAILY_REWARD,
  dailyPlan,
  dailyShare,
  dailyToday,
  dayIndexOf,
  dayLabel,
  dayResetLabel,
  addFriend,
  friendNotice,
  friendToday,
  friendVerdict,
  BEARER_DAILY_FROM,
  GROVE_DAILY_FROM,
  MIRROR_DAILY_FROM,
  MOONER_DAILY_FROM,
  normalizeDaily,
  normalizeFriend,
  TUNDRA_DAILY_FROM,
  withRo,
} from './daily';
import { rankDayOf } from '../../online/protocol';
import { HERO_ORDER, HEROES, STAGE_ORDER, STAGES, WEAPON_ORDER, WEAPONS } from './data';
import { sharedDay, sharedScore, shareUrl } from '../../share/link';

describe('오늘의 판: 날짜', () => {
  /** 한국 시각으로 적은 때 */
  const kst = (text: string): Date => new Date(`${text}+09:00`);

  it('한국 시각으로 0시에 하루가 넘어간다. 오늘의 랭킹의 날과 같다', () => {
    const noon = kst('2026-11-12T12:00:00');
    expect(dayIndexOf(kst('2026-11-12T23:59:59'))).toBe(dayIndexOf(noon));
    expect(dayIndexOf(kst('2026-11-13T00:00:00'))).toBe(dayIndexOf(noon) + 1);
    // 달과 해가 넘어가도 하루씩 는다.
    expect(dayIndexOf(kst('2027-01-01T00:00:01'))).toBe(dayIndexOf(kst('2026-12-31T23:00:00')) + 1);
    expect(dayIndexOf(noon)).toBe(rankDayOf(noon.getTime()));
  });

  it('기기가 어느 나라에 있든 같은 순간에는 같은 날이라, 모두가 같은 판을 한다', () => {
    // 협정 세계시로는 아직 11일 오후지만 한국은 12일 새벽이다.
    expect(dayIndexOf(new Date('2026-11-11T15:00:00Z'))).toBe(dayIndexOf(kst('2026-11-12T12:00:00')));
  });

  it('새 날이 시작되는 때를 이 기기의 시각으로 적는다', () => {
    const day = dayIndexOf(kst('2026-11-12T12:00:00'));
    const reset = kst('2026-11-13T00:00:00');
    expect(dayResetLabel(day)).toBe(`${reset.getHours()}시${reset.getMinutes() > 0 ? ` ${reset.getMinutes()}분` : ''}`);
    expect(dayResetLabel(day)).toMatch(/^\d{1,2}시( \d{1,2}분)?$/);
  });

  it('날짜를 달과 날로 적는다', () => {
    expect(dayLabel(dayIndexOf(kst('2026-11-12T09:00:00')))).toBe('11월 12일');
    expect(dayLabel(dayIndexOf(kst('2027-01-01T00:00:01')))).toBe('1월 1일');
  });
});

describe('오늘의 판: 조건', () => {
  it('같은 날이면 누구에게나 같고, 날이 바뀌면 캐릭터와 스테이지가 모두 바뀐다', () => {
    // 바람 설원이 섞이기 전의 날과 그 뒤의 날, 달잡이가 섞인 뒤의 날을 모두 지나간다.
    for (let day = TUNDRA_DAILY_FROM - 30; day < TUNDRA_DAILY_FROM + 60; day += 1) {
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
    for (let day = BEARER_DAILY_FROM; day < BEARER_DAILY_FROM + cycle; day += 1) {
      const plan = dailyPlan(day);
      pairs.add(`${plan.hero}/${plan.stage}`);
    }
    expect(pairs.size).toBe(cycle);
  });

  it('횃불잡이는 정해진 날부터 섞이고, 그 전의 날은 캐릭터 다섯이 돌던 차례 그대로다', () => {
    // 2026년 11월 26일(한국 시각)이 그날이다. 빛버섯 숲은 그 사흘 앞(11월 23일)부터 섞인다.
    expect(dayLabel(GROVE_DAILY_FROM)).toBe('11월 23일');
    expect(dayLabel(BEARER_DAILY_FROM)).toBe('11월 26일');
    const before = Array.from({ length: 400 }, (_, i) => dailyPlan(BEARER_DAILY_FROM - 1 - i));
    expect(before.some((plan) => plan.hero === 'bearer')).toBe(false);
    // 빛버섯 숲이 섞인 뒤부터 횃불잡이가 섞이기 전까지의 사흘은 먼저 정해 둔 차례 그대로다.
    expect([0, 1, 2].map((i) => dailyPlan(GROVE_DAILY_FROM + i))).toMatchObject([
      { hero: 'keeper', stage: 'marsh' },
      { hero: 'stargazer', stage: 'ridge' },
      { hero: 'stormer', stage: 'tundra' },
    ]);
    expect(dailyPlan(BEARER_DAILY_FROM)).toMatchObject({ hero: 'bearer', stage: 'grove' });
    const after = Array.from({ length: 30 }, (_, i) => dailyPlan(BEARER_DAILY_FROM + i));
    expect(after.filter((plan) => plan.hero === 'bearer')).toHaveLength(5);
    expect(new Set(after.filter((plan) => plan.hero === 'bearer').map((plan) => plan.stage)).size).toBe(5);
  });

  it('바람 설원은 정해진 날부터 섞이고, 그 전의 날은 예전 차례 그대로다', () => {
    // 2026년 11월 16일(한국 시각)이 그날이다.
    expect(dayLabel(TUNDRA_DAILY_FROM)).toBe('11월 16일');
    const before = Array.from({ length: 400 }, (_, i) => dailyPlan(TUNDRA_DAILY_FROM - 1 - i));
    expect(before.some((plan) => plan.stage === 'tundra')).toBe(false);
    for (const plan of before) expect(plan.stage).toBe(STAGE_ORDER[plan.day % 3]);
    // 이미 지난 날의 조건은 바뀌지 않았다.
    expect(dailyPlan(20_769)).toMatchObject({ hero: HERO_ORDER[20_769 % 4], stage: 'meadow' });
    expect(dailyPlan(20_770)).toMatchObject({ hero: HERO_ORDER[20_770 % 4], stage: 'marsh' });
    const after = Array.from({ length: 16 }, (_, i) => dailyPlan(TUNDRA_DAILY_FROM + i));
    expect(after.filter((plan) => plan.stage === 'tundra')).toHaveLength(4);
  });

  it('달잡이는 정해진 날부터 섞이고, 그 전의 날은 캐릭터 넷이 돌던 차례 그대로다', () => {
    // 2026년 11월 20일(한국 시각)이 그날이다.
    expect(dayLabel(MOONER_DAILY_FROM)).toBe('11월 20일');
    expect(MOONER_DAILY_FROM).toBeGreaterThan(TUNDRA_DAILY_FROM);
    const before = Array.from({ length: 400 }, (_, i) => dailyPlan(MOONER_DAILY_FROM - 1 - i));
    expect(before.some((plan) => plan.hero === 'mooner')).toBe(false);
    for (const plan of before) expect(plan.hero).toBe(HERO_ORDER[plan.day % 4]);
    // 바람 설원이 섞인 뒤부터 달잡이가 섞이기 전까지의 나흘은 먼저 정해 둔 차례 그대로다.
    expect([0, 1, 2, 3].map((i) => dailyPlan(TUNDRA_DAILY_FROM + i).stage)).toEqual(['ridge', 'tundra', 'meadow', 'ridge']);
    // 달잡이가 섞인 뒤부터 횃불잡이가 섞이기 전까지는 캐릭터 다섯이 하루에 한 칸씩 돈다.
    const after = Array.from({ length: BEARER_DAILY_FROM - MOONER_DAILY_FROM }, (_, i) => dailyPlan(MOONER_DAILY_FROM + i));
    for (const plan of after) expect(plan.hero).toBe(HERO_ORDER[plan.day % 5]);
    expect(after.some((plan) => plan.hero === 'mooner')).toBe(true);
  });

  it('손거울이 나오기 시작하는 날은 그날의 캐릭터와 스테이지를 바꾸지 않는다', () => {
    // 2026년 11월 17일(한국 시각)이 그날이다. 그 전의 판에서 손거울을 빼는 것은 sim.ts가 한다.
    expect(dayLabel(MIRROR_DAILY_FROM)).toBe('11월 17일');
    expect(MIRROR_DAILY_FROM).toBe(TUNDRA_DAILY_FROM + 1);
    expect(dailyPlan(MIRROR_DAILY_FROM)).toMatchObject({ hero: HERO_ORDER[MIRROR_DAILY_FROM % 4], stage: 'tundra' });
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

describe('오늘의 판: 결과 공유', () => {
  // 2026년 11월 13일
  const day = 20_770;

  it('카드에 날짜와 이어 온 날 수, 그날의 캐릭터와 스테이지를 적는다', () => {
    const plan = dailyPlan(day);
    const share = dailyShare(day, 1234, 3);
    expect(share.note).toBe('11월 13일 오늘의 판 · 3일째');
    expect(share.detail).toBe(`${HEROES[plan.hero].name} · ${STAGES[plan.stage].name}`);
    expect(share.text).toContain('11월 13일 오늘의 판');
    expect(share.text).toContain('1234점');
    expect(share.text).toContain('등불지기');
  });

  it('이어 온 날이 없으면 날 수를 적지 않는다', () => {
    expect(dailyShare(day, 10, 0).note).toBe('11월 13일 오늘의 판');
    expect(dailyShare(day, 10, 1).note).toBe('11월 13일 오늘의 판 · 1일째');
  });

  it('주소는 그날을 가리킨다', () => {
    const share = dailyShare(day, 10, 1);
    expect(share.day).toBe(day);
    const url = new URL(shareUrl('https://example.com/', 'lantern-keeper', share.day));
    expect(sharedDay(url.search)).toBe(day);
  });

  it('주소에 그 판의 점수도 실어서, 받은 사람이 넘어 볼 기록으로 꺼낼 수 있다', () => {
    const share = dailyShare(day, 1234, 3);
    expect(share.score).toBe(1234);
    const url = new URL(shareUrl('https://example.com/', 'lantern-keeper', share.day, share.score));
    expect(sharedDay(url.search)).toBe(day);
    expect(sharedScore(url.search)).toBe(1234);
  });
});

describe('오늘의 판: 친구 기록', () => {
  const day = 20_770;

  it('그날 받은 것만 보이고, 날이 바뀌면 사라진다', () => {
    const friend = { day, score: 333 };
    expect(friendToday(friend, day)).toBe(333);
    expect(friendToday(friend, day + 1)).toBeNull();
    expect(friendToday(null, day)).toBeNull();
  });

  it('같은 날에 여럿을 받으면 가장 높은 것을 두고, 다른 날의 것은 바꾼다', () => {
    const first = addFriend(null, day, 333);
    expect(first).toEqual({ day, score: 333 });
    expect(addFriend(first, day, 100)).toBe(first);
    expect(addFriend(first, day, 400)).toEqual({ day, score: 400 });
    expect(addFriend(first, day + 1, 50)).toEqual({ day: day + 1, score: 50 });
  });

  it('저장된 값이 모양이 아니면 버린다', () => {
    expect(normalizeFriend({ day, score: 333.7 })).toEqual({ day, score: 333 });
    for (const bad of [undefined, 'x', { day }, { day, score: -1 }, { day: 'a', score: 3 }, { day, score: 1_000_000 }]) {
      expect(normalizeFriend(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('결과 화면에는 넘었는지, 얼마나 남았는지 적는다', () => {
    expect(friendVerdict(333, 400)).toBe('333점을 넘었어요!');
    expect(friendVerdict(333, 333)).toBe('333점과 같아요');
    expect(friendVerdict(333, 290)).toBe('333점까지 43점');
    expect(friendNotice(333)).toBe('친구 기록 333점을 넘어 보세요');
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
