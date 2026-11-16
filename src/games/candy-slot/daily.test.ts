import { describe, expect, it } from 'vitest';
import { rankDayOf } from '../../online/protocol';
import { sharedDay, sharedScore, shareUrl } from '../../share/link';
import { getGame } from '../registry';
import { dayIndexOf as lanternDayOf } from '../lantern-keeper/daily';
import {
  addDailyRun,
  createDaily,
  DAILY_LABEL,
  dailyDayOf,
  dailyInfo,
  dailySeed,
  dailyShare,
  dailyToday,
  dailyVerdict,
  dayIndexOf,
  dayLabel,
  friendNotice,
  friendScoreOf,
  friendVerdict,
  normalizeDaily,
  SHARED_DAY_PASSED,
  SLOT_GAME_ID,
} from './daily';
import { buy, newRun, nextRound, randomOf, reroll, settleRound, spin, spinsOf, type RunState } from './rules';

/** 한국 시각으로 적은 때 */
const kst = (text: string): Date => new Date(`${text}+09:00`);

/**
 * 주아 글꼴에 들어 있는 한글: KS X 1001의 완성형 2,350자.
 * EUC-KR에서 첫 바이트 0xB0~0xC8, 둘째 바이트 0xA1~0xFE인 글자가 바로 그것이다.
 */
function fontSyllables(): Set<string> {
  const decoder = new TextDecoder('euc-kr');
  const syllables = new Set<string>();
  for (let lead = 0xb0; lead <= 0xc8; lead += 1) {
    for (let trail = 0xa1; trail <= 0xfe; trail += 1) {
      syllables.add(decoder.decode(new Uint8Array([lead, trail])));
    }
  }
  return syllables;
}

describe('행운 슬롯의 오늘의 판: 날짜', () => {
  it('한국 시각으로 0시에 하루가 넘어간다. 등불지기의 오늘의 판, 오늘의 랭킹과 같은 날이다', () => {
    const noon = kst('2026-11-16T12:00:00');
    expect(dayIndexOf(kst('2026-11-16T23:59:59'))).toBe(dayIndexOf(noon));
    expect(dayIndexOf(kst('2026-11-17T00:00:00'))).toBe(dayIndexOf(noon) + 1);
    expect(dayIndexOf(noon)).toBe(rankDayOf(noon.getTime()));
    expect(dayIndexOf(noon)).toBe(lanternDayOf(noon));
    expect(dayIndexOf(noon)).toBe(20_773);
  });

  it('기기가 어느 나라에 있든 같은 순간에는 같은 날이라, 모두가 같은 판을 한다', () => {
    // 협정 세계시로는 아직 15일 오후지만 한국은 16일 새벽이다.
    expect(dayIndexOf(new Date('2026-11-15T15:00:00Z'))).toBe(dayIndexOf(kst('2026-11-16T12:00:00')));
  });

  it('날짜를 달과 날로 적는다', () => {
    expect(dayLabel(dayIndexOf(kst('2026-11-16T09:00:00')))).toBe('11월 16일');
    expect(dayLabel(dayIndexOf(kst('2027-01-01T00:00:01')))).toBe('1월 1일');
  });
});

describe('행운 슬롯의 오늘의 판: 씨앗', () => {
  const day = 20_773;

  it('게임 id와 날로 정해진다. 날이 다르면 씨앗도 다르다', () => {
    expect(getGame(SLOT_GAME_ID)?.title).toBe('행운 슬롯');
    expect(dailySeed(day)).toBe('candy-slot:daily:20773');
    expect(dailySeed(day)).toBe(dailySeed(day));
    expect(dailySeed(day + 1)).not.toBe(dailySeed(day));
    expect(dailySeed(day + 0.9)).toBe(dailySeed(day));
  });

  it('씨앗에서 그 날을 다시 읽는다. 여느 판이나 다른 씨앗이면 null이다', () => {
    expect(dailyDayOf(dailySeed(day))).toBe(day);
    expect(dailyDayOf(newRun(dailySeed(day)).seed)).toBe(day);
    expect(dailyDayOf(newRun().seed)).toBeNull();
    expect(dailyDayOf(null)).toBeNull();
    expect(dailyDayOf('test')).toBeNull();
    expect(dailyDayOf('candy-slot:daily:')).toBeNull();
    expect(dailyDayOf('candy-slot:daily:12x')).toBeNull();
    expect(dailyDayOf('candy-slot:daily:1234567')).toBeNull();
    expect(dailyDayOf('lantern-keeper:daily:20773')).toBeNull();
  });

  /**
   * 그날의 씨앗으로 한 판을 끝까지 한다. 가게에서는 pick번째 부적을 살 수 있으면 사고, rerolls번 다시 뽑는다.
   * 스핀마다 나온 판과 가게마다 나온 부적을 차례대로 적어서 돌려준다. 밖에서 준 운(fallback)은 쓰이지 않아야 한다.
   */
  function play(seed: string, pick: number, rerolls: number): { grids: number[][]; offers: string[][]; run: RunState } {
    const never = (): number => {
      throw new Error('오늘의 판은 밖에서 준 운을 쓰지 않는다');
    };
    const grids: number[][] = [];
    const offers: string[][] = [];
    let run = newRun(seed);
    while (run.phase !== 'over' && run.round <= 30) {
      while (run.spinsLeft > 0) {
        const result = spin(run, randomOf(run, 'spin', never));
        if (!result) throw new Error('돌릴 수 있어야 한다');
        grids.push(result.outcome.grid);
        run = result.run;
      }
      const settled = settleRound(run, randomOf(run, 'shop', never));
      if (!settled) throw new Error('라운드를 맺을 수 있어야 한다');
      run = settled.run;
      if (run.phase !== 'shop') break;
      offers.push(run.shop?.offers.map((id) => id ?? '') ?? []);
      for (let i = 0; i < rerolls; i += 1) {
        run = reroll(run, randomOf(run, 'shop', never));
        offers.push(run.shop?.offers.map((id) => id ?? '') ?? []);
      }
      run = nextRound(buy(run, pick));
    }
    return { grids, offers, run };
  }

  it('같은 날에는 누가 몇 번을 해도 같은 판과 같은 가게가 같은 차례로 나온다', () => {
    const a = play(dailySeed(day), 0, 0);
    const b = play(dailySeed(day), 0, 0);
    expect(a.grids.length).toBeGreaterThanOrEqual(spinsOf([]));
    expect(b.grids).toEqual(a.grids);
    expect(b.offers).toEqual(a.offers);
    expect(b.run).toEqual(a.run);
  });

  it('무엇을 사든 첫 라운드의 스핀과 첫 가게는 같다. 날이 다르면 다른 판이 나온다', () => {
    // 첫 라운드에는 붙인 부적이 없어서 그림이 나올 확률도 같다.
    const firstRound = spinsOf([]);
    const a = play(dailySeed(day), 0, 0);
    const b = play(dailySeed(day), 2, 1);
    expect(b.grids.slice(0, firstRound)).toEqual(a.grids.slice(0, firstRound));
    expect(b.offers[0]).toEqual(a.offers[0]);
    const other = play(dailySeed(day + 1), 0, 0);
    expect(other.grids.slice(0, firstRound)).not.toEqual(a.grids.slice(0, firstRound));
  });
});

describe('행운 슬롯의 오늘의 판: 기록', () => {
  const today = 20_773;
  const run = (score: number, rounds = 1) => ({ score, rounds });

  it('몇 번을 다시 해도 그날의 가장 좋은 기록이 남는다', () => {
    const first = addDailyRun(createDaily(), today, run(40, 2));
    expect(first.first).toBe(true);
    expect(first.improved).toBe(true);
    expect(first.record).toEqual({ day: today, best: 40, rounds: 2, tries: 1, streak: 1, savedAt: 0 });

    const worse = addDailyRun(first.record, today, run(25, 3));
    expect(worse.first).toBe(false);
    expect(worse.improved).toBe(false);
    expect(worse.record).toMatchObject({ best: 40, rounds: 2, tries: 2, streak: 1 });

    // 점수가 같으면 새 기록이 아니다.
    const same = addDailyRun(worse.record, today, run(40, 5));
    expect(same.improved).toBe(false);
    expect(same.record).toMatchObject({ best: 40, rounds: 2, tries: 3 });

    const better = addDailyRun(same.record, today, run(130, 6));
    expect(better.first).toBe(false);
    expect(better.improved).toBe(true);
    expect(better.record).toEqual({ day: today, best: 130, rounds: 6, tries: 4, streak: 1, savedAt: 0 });
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
    const record = addDailyRun(addDailyRun(createDaily(), today - 1, run(100)).record, today, run(200, 4)).record;
    expect(dailyToday(record, today)).toBe(record);
    expect(dailyToday(record, today + 1)).toEqual({ ...createDaily(), day: today + 1, streak: 2 });
    expect(dailyToday(record, today + 2).streak).toBe(0);
    // 기기의 시계가 뒤로 가도 망가지지 않는다.
    expect(dailyToday(record, today - 3)).toMatchObject({ tries: 0, streak: 0 });
    expect(addDailyRun(record, today - 3, run(5)).record).toMatchObject({ day: today - 3, streak: 1, tries: 1 });
  });

  it('저장한 때는 날이 바뀌어도, 기록을 보태도 그대로 따라간다', () => {
    const saved = { ...addDailyRun(createDaily(), today, run(30)).record, savedAt: 777 };
    expect(dailyToday(saved, today + 1).savedAt).toBe(777);
    expect(addDailyRun(saved, today, run(60)).record.savedAt).toBe(777);
    expect(addDailyRun(saved, today + 1, run(60)).record.savedAt).toBe(777);
  });

  it('저장된 값이 엉뚱하면 빈 기록으로 돌린다', () => {
    expect(normalizeDaily(undefined)).toEqual(createDaily());
    expect(normalizeDaily(null)).toEqual(createDaily());
    expect(normalizeDaily('x')).toEqual(createDaily());
    expect(normalizeDaily({ day: today, tries: 0, best: 99 })).toEqual(createDaily());
    // 빈 기록이어도 저장한 때는 남긴다(기록을 초기화한 것이 다른 곳의 옛 기록보다 새것으로 남게).
    expect(normalizeDaily({ day: 0, savedAt: 55 })).toEqual({ ...createDaily(), savedAt: 55 });
    expect(normalizeDaily({ day: today, best: 12.7, rounds: -3, tries: 2, streak: 0, savedAt: 'now' })).toEqual({
      day: today,
      best: 12,
      rounds: 0,
      tries: 2,
      streak: 1,
      savedAt: 0,
    });
    const record = { ...addDailyRun(createDaily(), today, run(321, 7)).record, savedAt: 1_700_000_000_000 };
    expect(normalizeDaily(JSON.parse(JSON.stringify(record)))).toEqual(record);
  });
});

describe('행운 슬롯의 오늘의 판: 글', () => {
  const today = 20_773;

  it('시작 화면에는 오늘의 최고 기록을, 아직 안 했으면 무엇을 하는 판인지 적는다', () => {
    expect(dailyInfo(createDaily(), today)).toBe('누구나 같은 운으로 하는 판이에요');
    const played = addDailyRun(createDaily(), today, { score: 120, rounds: 4 }).record;
    expect(dailyInfo(played, today)).toBe('오늘 최고 120점 · 넘긴 라운드 4번');
    // 다음 날에는 어제의 기록 대신 이어 온 날 수를 보인다. 하루를 거르면 처음의 글로 돌아간다.
    expect(dailyInfo(played, today + 1)).toBe('이어 온 날 1일 · 오늘 하면 하루 더');
    expect(dailyInfo(played, today + 2)).toBe('누구나 같은 운으로 하는 판이에요');
  });

  it('결과 화면에는 오늘 처음인지, 오늘의 최고 기록을 새로 썼는지, 아니면 오늘의 최고 기록을 적는다', () => {
    const first = addDailyRun(createDaily(), today, { score: 40, rounds: 2 });
    expect(dailyVerdict(first)).toBe('1일째 · 오늘의 첫 기록');
    const next = addDailyRun(first.record, today + 1, { score: 10, rounds: 1 });
    expect(dailyVerdict(next)).toBe('2일째 · 오늘의 첫 기록');
    const worse = addDailyRun(first.record, today, { score: 25, rounds: 1 });
    expect(dailyVerdict(worse)).toBe('오늘 최고 40점');
    const better = addDailyRun(worse.record, today, { score: 90, rounds: 5 });
    expect(dailyVerdict(better)).toBe('오늘의 최고 기록!');
  });

  it('화면에 적는 글은 글꼴에 있는 글자만 쓴다', () => {
    const common = fontSyllables();
    const played = addDailyRun(createDaily(), today, { score: 120, rounds: 4 });
    const texts = [
      dailyInfo(createDaily(), today),
      dailyInfo(played.record, today),
      dailyInfo(played.record, today + 1),
      dailyVerdict(played),
      dailyVerdict(addDailyRun(played.record, today, { score: 1, rounds: 0 })),
      dailyVerdict(addDailyRun(played.record, today, { score: 999, rounds: 9 })),
      SHARED_DAY_PASSED,
      friendNotice(120),
      friendVerdict(120, 130),
      friendVerdict(120, 120),
      friendVerdict(120, 20),
      ...Object.values(DAILY_LABEL),
      ...Object.values(dailyShare(today, { score: 120, rounds: 4 }, 3)).filter((value) => typeof value === 'string'),
    ];
    for (const text of texts) {
      for (const char of text) {
        if (char >= '가' && char <= '힣') expect(common.has(char), `"${text}"의 ${char}`).toBe(true);
      }
    }
  });
});

describe('행운 슬롯의 오늘의 판: 결과 공유', () => {
  const day = 20_773;

  it('카드에 날짜와 이어 온 날 수, 넘긴 라운드를 적는다', () => {
    const share = dailyShare(day, { score: 333, rounds: 4 }, 3);
    expect(share.note).toBe('11월 16일 오늘의 판 · 3일째');
    expect(share.detail).toBe('넘긴 라운드 4번');
    expect(share.invite).toBe('같은 판 도전하기');
    expect(share.text).toContain('[행운 슬롯]');
    expect(share.text).toContain('11월 16일 오늘의 판');
    expect(share.text).toContain('333점');
    expect(dailyShare(day, { score: 10, rounds: 0 }, 0).note).toBe('11월 16일 오늘의 판');
  });

  it('주소에는 그날과 점수가 실려서, 받은 사람이 같은 판을 열고 넘어 볼 기록을 본다', () => {
    const share = dailyShare(day, { score: 333, rounds: 4 }, 1);
    const url = new URL(shareUrl('https://example.com/', SLOT_GAME_ID, share.day, share.score));
    expect(url.searchParams.get('game')).toBe('candy-slot');
    expect(sharedDay(url.search)).toBe(day);
    expect(sharedScore(url.search)).toBe(333);
    expect(friendScoreOf(sharedDay(url.search), sharedScore(url.search), day)).toBe(333);
  });

  it('친구의 점수는 오늘의 것만 견준다. 지난 날의 것이나 점수의 모양이 아닌 것은 버린다', () => {
    expect(friendScoreOf(day, 120, day)).toBe(120);
    expect(friendScoreOf(day - 1, 120, day)).toBeNull();
    expect(friendScoreOf(undefined, 120, day)).toBeNull();
    expect(friendScoreOf(day, undefined, day)).toBeNull();
    expect(friendScoreOf(day, 0, day)).toBeNull();
    expect(friendScoreOf(day, 1_000_000, day)).toBeNull();
    expect(friendScoreOf(day, '120', day)).toBeNull();
    expect(SHARED_DAY_PASSED).toContain('오늘의 판');
  });

  it('친구 기록과 견준 결과를 한 줄로 적는다', () => {
    expect(friendNotice(120)).toBe('친구 기록 120점을 넘어 보세요');
    expect(friendVerdict(120, 130)).toBe('120점을 넘었어요!');
    expect(friendVerdict(120, 120)).toBe('120점과 같아요');
    expect(friendVerdict(120, 90)).toBe('120점까지 30점');
  });
});
