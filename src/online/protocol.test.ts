import { describe, expect, it } from 'vitest';
import { dayIndexOf as slotDayOf } from '../games/candy-slot/daily';
import { dayIndexOf as lanternDayOf } from '../games/lantern-keeper/daily';
import { GAMES } from '../games/registry';
import {
  cleanCode,
  cleanName,
  cleanScore,
  CODE_ALPHABET,
  CODE_LENGTH,
  codeFrom,
  DAILY_GAMES,
  deviceIdFrom,
  formatCode,
  isDeviceId,
  hasDailyBoard,
  hasWeeklyBoard,
  isRankDay,
  isRankedGame,
  isRankSpan,
  isRankWeek,
  MAX_SCORE,
  NAME_MAX,
  RANK_SCAN,
  RANKED_GAMES,
  rankDayOf,
  rankDayStart,
  rankLabel,
  RANK_WEEK_MS,
  rankWeekOf,
  rankWeekStart,
} from './protocol';

describe('랭킹이 있는 게임', () => {
  it('허브에 있는 플레이할 수 있는 게임 가운데 점수가 있는 것과 같다', () => {
    const scored = GAMES.filter((game) => game.sceneKey !== null && !game.versus).map((game) => game.id);
    expect([...RANKED_GAMES].sort()).toEqual([...scored].sort());
  });

  it('승패로 끝나는 게임은 랭킹에 없다', () => {
    for (const game of GAMES.filter((entry) => entry.versus)) {
      expect(isRankedGame(game.id)).toBe(false);
      expect(game.dailyTargets).toEqual([]);
    }
  });

  it('이어지는 성장 게임은 평판으로 랭킹에 오르고, 오늘의 도전에는 나오지 않는다', () => {
    for (const game of GAMES.filter((entry) => entry.ongoing)) {
      expect(isRankedGame(game.id)).toBe(true);
      expect(game.dailyTargets).toEqual([]);
    }
  });

  it('목록에 없는 것은 받지 않는다', () => {
    expect(isRankedGame('lantern-keeper')).toBe(true);
    expect(isRankedGame('nope')).toBe(false);
    expect(isRankedGame(3)).toBe(false);
  });
});

describe('닉네임', () => {
  it('앞뒤 빈칸을 떼고 이어진 빈칸은 하나로 줄인다', () => {
    expect(cleanName('  등불   지기 ')).toBe('등불 지기');
    expect(cleanName('Mint_02')).toBe('Mint_02');
    expect(cleanName('a-b')).toBe('a-b');
    expect(cleanName('ㅋㅋ')).toBe('ㅋㅋ');
  });

  it('글자 수는 2자부터 10자까지다', () => {
    expect(cleanName('가')).toBeNull();
    expect(cleanName(' 가 ')).toBeNull();
    expect(cleanName('가'.repeat(NAME_MAX))).toBe('가'.repeat(NAME_MAX));
    expect(cleanName('가'.repeat(NAME_MAX + 1))).toBeNull();
  });

  it('기호, 그림 문자, 줄바꿈, 꾸밈 기호는 받지 않는다', () => {
    for (const bad of ['<b>hi</b>', '하이😀', 'á́́b', 'x;y', "o'neil", '한글​이름', '']) {
      expect(cleanName(bad), JSON.stringify(bad)).toBeNull();
    }
    // 줄바꿈과 탭은 빈칸으로 본다.
    expect(cleanName('가\n나')).toBe('가 나');
  });

  it('글자로 분류되지만 눈에 보이지 않는 채움 문자는 받지 않는다', () => {
    // 한글 채움 문자, 반각 한글 채움 문자, 첫소리 채움 문자, 가운뎃소리 채움 문자
    for (const filler of ['\u3164', '\uffa0', '\u115f', '\u1160']) {
      expect(cleanName(filler.repeat(3)), `U+${filler.codePointAt(0)?.toString(16)}`).toBeNull();
      expect(cleanName(`가${filler}나`), `U+${filler.codePointAt(0)?.toString(16)}`).toBeNull();
    }
    expect(cleanName('\u115f\u1160')).toBeNull();
  });

  it('풀어 쓴 한글은 모아서 센다', () => {
    const decomposed = '한글'.normalize('NFD');
    expect(decomposed.length).toBeGreaterThan(2);
    expect(cleanName(decomposed)).toBe('한글');
  });

  it('글자가 아니면 받지 않는다', () => {
    expect(cleanName(12)).toBeNull();
    expect(cleanName(null)).toBeNull();
    expect(cleanName('가'.repeat(500))).toBeNull();
  });
});

describe('기기 id와 점수', () => {
  it('무작위 바이트로 만든 id는 형식에 맞는다', () => {
    const id = deviceIdFrom(Uint8Array.from({ length: 16 }, (_, index) => index * 16 + 1));
    expect(id).toBe('01112131-4151-6171-8191-a1b1c1d1e1f1');
    expect(isDeviceId(id)).toBe(true);
  });

  it('형식이 다른 것은 id로 보지 않는다', () => {
    expect(isDeviceId('01112131-4151-6171-8191-A1B1C1D1E1F1')).toBe(false);
    expect(isDeviceId('01112131415161718191a1b1c1d1e1f1')).toBe(false);
    expect(isDeviceId("x' OR 1=1 --")).toBe(false);
    expect(isDeviceId(undefined)).toBe(false);
  });

  it('점수는 1 이상의 정수만 받는다', () => {
    expect(cleanScore(12.9)).toBe(12);
    expect(cleanScore(MAX_SCORE)).toBe(MAX_SCORE);
    for (const bad of [0, -5, 0.5, MAX_SCORE + 1, Number.NaN, Number.POSITIVE_INFINITY, '12', null]) {
      expect(cleanScore(bad), String(bad)).toBeNull();
    }
  });

  it('세는 범위 밖의 순위는 "밖"이라고 적는다', () => {
    expect(rankLabel(1)).toBe('1위');
    expect(rankLabel(RANK_SCAN)).toBe(`${RANK_SCAN}위`);
    expect(rankLabel(RANK_SCAN + 1)).toBe(`${RANK_SCAN}위 밖`);
  });
});

describe('옮기기 코드', () => {
  it('헷갈리는 글자가 없는 32자로 만든다', () => {
    expect(CODE_ALPHABET).toHaveLength(32);
    expect(new Set(CODE_ALPHABET).size).toBe(32);
    for (const confusing of '01IO') expect(CODE_ALPHABET).not.toContain(confusing);
    const code = codeFrom(Uint8Array.from([0, 31, 32, 63, 255, 7, 8, 9]));
    expect(code).toHaveLength(CODE_LENGTH);
    expect(code).toBe('2Z2ZZ9AB');
    expect(cleanCode(code)).toBe(code);
  });

  it('소문자, 빈칸, 붙임표를 봐준다', () => {
    expect(cleanCode('abcd-efgh')).toBe('ABCDEFGH');
    expect(cleanCode(' abcd efgh ')).toBe('ABCDEFGH');
    expect(formatCode('ABCDEFGH')).toBe('ABCD-EFGH');
  });

  it('길이가 다르거나 쓰지 않는 글자가 있으면 코드가 아니다', () => {
    for (const bad of ['ABCDEFG', 'ABCDEFGHJ', 'ABCD0EFG', 'ABCDIEFG', '가나다라마바사아', '', 'A'.repeat(100)]) {
      expect(cleanCode(bad), bad).toBeNull();
    }
    expect(cleanCode(12345678)).toBeNull();
  });
});

describe('랭킹 주', () => {
  /** 한국 시각으로 적은 때를 ms로 바꾼다 */
  const kst = (text: string): number => Date.parse(`${text}+09:00`);

  it('그 주 월요일의 날짜(한국 시각)가 주의 이름이다', () => {
    expect(rankWeekOf(kst('2026-11-12T15:00:00'))).toBe('2026-11-09');
    expect(rankWeekOf(kst('2026-11-09T00:00:00'))).toBe('2026-11-09');
    expect(rankWeekOf(kst('2026-11-15T23:59:59'))).toBe('2026-11-09');
  });

  it('월요일 0시(한국 시각)에 새 주가 시작된다', () => {
    expect(rankWeekOf(kst('2026-11-16T00:00:00') - 1)).toBe('2026-11-09');
    expect(rankWeekOf(kst('2026-11-16T00:00:00'))).toBe('2026-11-16');
  });

  it('기기가 어느 나라에 있든 같은 순간에는 같은 주다', () => {
    // 협정 세계시로는 아직 일요일 오후지만 한국은 월요일 새벽이다.
    expect(rankWeekOf(Date.parse('2026-11-15T15:00:00Z'))).toBe('2026-11-16');
    expect(rankWeekOf(Date.parse('2026-11-15T14:59:59Z'))).toBe('2026-11-09');
  });

  it('달과 해가 바뀌는 주도 월요일의 날짜로 적는다', () => {
    expect(rankWeekOf(kst('2027-01-01T12:00:00'))).toBe('2026-12-28');
    expect(rankWeekOf(kst('2026-03-01T12:00:00'))).toBe('2026-02-23');
  });

  it('일주일 내내 같은 이름이고, 이름은 시간 순서대로 늘어선다', () => {
    const start = kst('2026-11-09T00:00:00');
    const day = 24 * 60 * 60 * 1000;
    for (let offset = 0; offset < 7; offset += 1) expect(rankWeekOf(start + offset * day)).toBe('2026-11-09');
    const weeks = Array.from({ length: 60 }, (_, index) => rankWeekOf(start + index * 7 * day));
    expect([...weeks].sort()).toEqual(weeks);
    expect(new Set(weeks).size).toBe(60);
    for (const week of weeks) {
      expect(isRankWeek(week)).toBe(true);
      expect(new Date(`${week}T00:00:00Z`).getUTCDay()).toBe(1);
    }
  });

  it('주가 시작된 때는 한국 시각으로 월요일 0시다', () => {
    const start = kst('2026-11-09T00:00:00');
    expect(rankWeekStart(kst('2026-11-12T15:00:00'))).toBe(start);
    expect(rankWeekStart(start)).toBe(start);
    expect(rankWeekStart(start - 1)).toBe(start - RANK_WEEK_MS);
    expect(rankWeekStart(start + RANK_WEEK_MS)).toBe(start + RANK_WEEK_MS);
  });

  it('점수가 계속 쌓이는 게임(이어지는 성장 게임)에만 주간 랭킹이 없다', () => {
    for (const game of GAMES.filter((entry) => isRankedGame(entry.id))) {
      expect(hasWeeklyBoard(game.id), game.id).toBe(game.ongoing !== true);
    }
    expect(hasWeeklyBoard('stack-tower')).toBe(true);
    expect(hasWeeklyBoard('sprout-company')).toBe(false);
    expect(hasWeeklyBoard('nope')).toBe(false);
    expect(hasWeeklyBoard(undefined)).toBe(false);
  });

  it('주의 이름과 범위의 모양을 가린다', () => {
    expect(isRankWeek('2026-11-09')).toBe(true);
    for (const value of ['2026-11-9', '20261109', '이번 주', '', 3, null, undefined]) {
      expect(isRankWeek(value)).toBe(false);
    }
    expect(isRankSpan('all')).toBe(true);
    expect(isRankSpan('week')).toBe(true);
    expect(isRankSpan('month')).toBe(false);
    expect(isRankSpan(null)).toBe(false);
  });
});

describe('랭킹 날', () => {
  const kst = (text: string): number => Date.parse(`${text}+09:00`);

  it('0시(한국 시각)에 새 날이 시작된다', () => {
    const noon = rankDayOf(kst('2026-11-12T12:00:00'));
    expect(rankDayOf(kst('2026-11-12T00:00:00'))).toBe(noon);
    expect(rankDayOf(kst('2026-11-12T23:59:59'))).toBe(noon);
    expect(rankDayOf(kst('2026-11-13T00:00:00'))).toBe(noon + 1);
    expect(rankDayOf(kst('2026-11-12T00:00:00') - 1)).toBe(noon - 1);
    // 달과 해가 넘어가도 하루씩 는다.
    expect(rankDayOf(kst('2027-01-01T00:00:01'))).toBe(rankDayOf(kst('2026-12-31T23:00:00')) + 1);
  });

  it('기기가 어느 나라에 있든 같은 순간에는 같은 날이다', () => {
    // 협정 세계시로는 아직 11일 오후지만 한국은 12일 새벽이다.
    expect(rankDayOf(Date.parse('2026-11-11T15:00:00Z'))).toBe(rankDayOf(kst('2026-11-12T12:00:00')));
    expect(rankDayOf(Date.parse('2026-11-11T14:59:59Z'))).toBe(rankDayOf(kst('2026-11-11T12:00:00')));
  });

  it('그날이 시작된 때는 한국 시각으로 0시다', () => {
    const day = rankDayOf(kst('2026-11-12T12:00:00'));
    expect(rankDayStart(day)).toBe(kst('2026-11-12T00:00:00'));
    expect(rankDayOf(rankDayStart(day))).toBe(day);
    expect(rankDayOf(rankDayStart(day + 1) - 1)).toBe(day);
  });

  it('날의 모양을 가린다', () => {
    expect(isRankDay(rankDayOf(kst('2026-11-12T12:00:00')))).toBe(true);
    for (const value of [0, -3, 1.5, Number.NaN, 5_000_000, '20770', null, undefined]) {
      expect(isRankDay(value)).toBe(false);
    }
  });

  it('오늘의 랭킹은 오늘의 판이 있는 게임(등불지기, 행운 슬롯)에만 있다', () => {
    expect(DAILY_GAMES).toEqual(['lantern-keeper', 'candy-slot']);
    expect(hasDailyBoard('lantern-keeper')).toBe(true);
    expect(hasDailyBoard('candy-slot')).toBe(true);
    expect(hasDailyBoard('stack-tower')).toBe(false);
    expect(hasDailyBoard('nope')).toBe(false);
    expect(hasDailyBoard(undefined)).toBe(false);
  });

  it('오늘의 판이 있는 게임은 랭킹과 같은 순간에 날이 넘어간다. 그날의 판의 점수가 다른 날의 랭킹에 섞이지 않는다', () => {
    const gameDays: Record<string, (date: Date) => number> = {
      'lantern-keeper': lanternDayOf,
      'candy-slot': slotDayOf,
    };
    expect(Object.keys(gameDays).sort()).toEqual([...DAILY_GAMES].sort());
    const midnight = kst('2026-11-17T00:00:00');
    for (const game of DAILY_GAMES) {
      for (const at of [midnight - 1, midnight, midnight + 1, kst('2026-12-31T23:59:59'), kst('2027-01-01T00:00:00')]) {
        expect(gameDays[game](new Date(at)), `${game} ${new Date(at).toISOString()}`).toBe(rankDayOf(at));
      }
    }
  });
});
