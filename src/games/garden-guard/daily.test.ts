import { describe, expect, it } from 'vitest';
import { rankDayOf } from '../../online/protocol';
import { shareUrl } from '../../share/link';
import { drawShop } from './allies';
import { botInput, type BotStyle, type PickStyle } from './bot';
import {
  addDailyRun,
  boardDayOf,
  createDaily,
  DAILY_OFF_RECORD,
  DAILY_RULES,
  DAILY_TEXT,
  dailyBest,
  dailyConfig,
  dailyDiscard,
  dailyHint,
  dailyInfo,
  dailyResumeInfo,
  dailyResumed,
  dailySeed,
  dailyShare,
  dailyStreak,
  dailyToday,
  dailyVerdict,
  dayIndexOf,
  dayLabel,
  friendLine,
  friendNotice,
  friendScoreOf,
  friendVerdict,
  isDailyTag,
  normalizeDaily,
  RANK_TEXT,
  rankButton,
  rankNote,
  SHARED_DAY_PASSED,
  shopSeed,
  waveSeed,
} from './daily';
import { GARDEN_GAME_ID } from './data';
import { createMeta, MAX_DAY } from './rules';
import { readRunRecord, runRecord, settleSavedRun } from './saved-run';
import { createRun, step, type RunState, type SimEvent } from './sim';

const STEP = 1 / 60;
/** 2026년 11월 19일(한국 시각) */
const TODAY = 20_776;
const kst = (text: string): Date => new Date(`${text}+09:00`);

/** 주아 글꼴에 들어 있는 한글: KS X 1001의 완성형 2,350자(EUC-KR의 첫 바이트 0xB0~0xC8, 둘째 바이트 0xA1~0xFE) */
function fontSyllables(): Set<string> {
  const decoder = new TextDecoder('euc-kr');
  const syllables = new Set<string>();
  for (let lead = 0xb0; lead <= 0xc8; lead += 1) {
    for (let trail = 0xa1; trail <= 0xfe; trail += 1) syllables.add(decoder.decode(new Uint8Array([lead, trail])));
  }
  return syllables;
}

/** 그날의 판에서 날마다 나온 벌레 떼와, 가게가 열릴 때마다 처음 놓인 카드 */
interface Seen {
  waves: string[];
  shops: string[];
  state: RunState;
}

/** 오늘의 판을 자동으로 maxSeconds까지 해 보며 날마다의 벌레 떼와 가게를 적는다. */
function playDaily(day: number, style: BotStyle, picks: PickStyle, maxSeconds: number): Seen {
  const { state, events } = createRun(dailyConfig(day));
  const seen: Seen = { waves: [], shops: [], state };
  const note = (list: readonly SimEvent[]): void => {
    for (const event of list) {
      if (event.type === 'dayStart') seen.waves.push(JSON.stringify(state.queue));
      if (event.type === 'shop') seen.shops.push(state.shop.map((card) => card.id).join(','));
    }
  };
  note(events);
  while (state.phase !== 'over' && state.t < maxSeconds) note(step(state, STEP, botInput(state, style, picks)));
  return seen;
}

describe('텃밭 지키기의 오늘의 판: 날과 씨앗', () => {
  it('한국 시각으로 0시에 하루가 넘어간다. 오늘의 랭킹과 같은 날이다', () => {
    const midnight = kst('2026-11-19T00:00:00');
    expect(dayIndexOf(new Date(midnight.getTime() - 1))).toBe(TODAY - 1);
    expect(dayIndexOf(midnight)).toBe(TODAY);
    expect(dayIndexOf(midnight)).toBe(rankDayOf(midnight.getTime()));
    expect(dayLabel(TODAY)).toBe('11월 19일');
  });

  it('그날의 씨앗과 갈래는 날로만 정해지고, 날이나 갈래가 다르면 다르다', () => {
    expect(dailySeed(TODAY)).toBe(dailySeed(TODAY));
    expect(dailySeed(TODAY)).not.toBe(dailySeed(TODAY + 1));
    expect(waveSeed(TODAY, 3)).toBe(waveSeed(TODAY, 3));
    expect(new Set([waveSeed(TODAY, 1), waveSeed(TODAY, 2), waveSeed(TODAY + 1, 1), shopSeed(TODAY, 1, 0)]).size).toBe(4);
    expect(shopSeed(TODAY, 2, 0)).not.toBe(shopSeed(TODAY, 2, 1));
  });

  it('1일째부터, 영구 강화와 새 밭과 유물 없이 시작하고 판에 그날의 표가 붙는다', () => {
    const config = dailyConfig(TODAY);
    expect(config).toEqual({ seed: dailySeed(TODAY), startDay: 1, levels: {}, bestBefore: MAX_DAY, fields: 0, relics: {}, daily: TODAY });
    const { state } = createRun(config);
    expect(state.daily).toEqual({ day: TODAY, draws: 0 });
    expect(state.allies).toEqual([]);
    expect(state.day).toBe(1);
    // 여느 판에는 표가 없다.
    expect(createRun({ seed: 1, startDay: 1, levels: {}, bestBefore: 0 }).state.daily).toBeUndefined();
  });

  it('어떻게 하든 같은 날에는 같은 벌레 떼와 같은 가게가 나온다', () => {
    const keen = playDaily(TODAY, 'active', 'keen', 600);
    const lazy = playDaily(TODAY, 'idle', 'first', 600);
    const again = playDaily(TODAY, 'active', 'keen', 600);
    // 둘 다 며칠은 지킨다. 그동안 물을 쏜 수도, 산 동료도, 다시 뽑은 횟수도 다르다.
    const days = Math.min(keen.waves.length, lazy.waves.length);
    expect(days).toBeGreaterThanOrEqual(3);
    expect(keen.state.kills).not.toBe(lazy.state.kills);
    expect(keen.waves.slice(0, days)).toEqual(lazy.waves.slice(0, days));
    const shops = Math.min(keen.shops.length, lazy.shops.length);
    expect(keen.shops.slice(0, shops)).toEqual(lazy.shops.slice(0, shops));
    // 같게 하면 끝까지 똑같다.
    expect(again.state).toEqual(keen.state);
    // 다른 날은 다른 벌레 떼다.
    expect(playDaily(TODAY + 1, 'idle', 'first', 60).waves[0]).not.toBe(keen.waves[0]);
  });

  it('가게의 카드는 그날과 그 가게에서 몇 번째로 뽑는지로만 정해진다', () => {
    const a = createRun(dailyConfig(TODAY)).state;
    const b = createRun(dailyConfig(TODAY)).state;
    // 앞에서 굴린 난수와 다시 뽑은 횟수가 달라도
    b.rng = 12345;
    b.rolls = 7;
    expect(drawShop(b)).toEqual(drawShop(a));
    b.daily = { day: TODAY, draws: 1 };
    expect(drawShop(b)).not.toEqual(drawShop(a));
  });

  it('오늘의 판의 점수만 오늘의 랭킹에 올린다. 날이 넘어간 판과 여느 판은 올리지 않는다', () => {
    const now = kst('2026-11-19T12:00:00').getTime();
    expect(boardDayOf({ day: TODAY, draws: 0 }, now)).toBe(TODAY);
    expect(boardDayOf({ day: TODAY - 1, draws: 0 }, now)).toBeNull();
    expect(boardDayOf(undefined, now)).toBeNull();
  });
});

describe('텃밭 지키기의 오늘의 판: 저장', () => {
  it('하던 오늘의 판은 표와 함께 적고 읽는다. 표가 없는 판(오늘의 판이 생기기 전의 판)도 그대로 읽는다', () => {
    const { state } = createRun(dailyConfig(TODAY));
    for (let t = 0; t < 20; t += STEP) step(state, STEP, botInput(state, 'active'));
    const saved = { state, banked: 0, bankedShards: 0 };
    const read = readRunRecord(JSON.parse(JSON.stringify(runRecord(saved, 1))));
    expect(read.run?.state.daily).toEqual(state.daily);
    expect(read.run).toEqual(saved);
    const plain = createRun({ seed: 3, startDay: 1, levels: {}, bestBefore: 0 }).state;
    expect(readRunRecord(JSON.parse(JSON.stringify(runRecord({ state: plain, banked: 0, bankedShards: 0 }, 1)))).run?.state).toEqual(plain);
  });

  it('표의 모양이 맞지 않는 판은 버린다', () => {
    expect(isDailyTag({ day: TODAY, draws: 0 })).toBe(true);
    for (const tag of [null, 3, { day: 'x', draws: 0 }, { day: TODAY }, { day: TODAY, draws: -1 }, { day: 0, draws: 0 }]) {
      expect(isDailyTag(tag)).toBe(false);
      const state = { ...createRun(dailyConfig(TODAY)).state, daily: tag };
      expect(readRunRecord(JSON.parse(JSON.stringify(runRecord({ state: state as RunState, banked: 0, bankedShards: 0 }, 1)))).run).toBeNull();
    }
  });

  it('두고 간 오늘의 판을 마쳐도 이 밭의 기록과 출발점은 그대로다', () => {
    const state = { ...createRun(dailyConfig(TODAY)).state, seeds: 40, kills: 30, lastCleared: 12, day: 13 };
    const meta = { ...createMeta(), seeds: 5, best: 3, runs: 2, kills: 10 };
    expect(settleSavedRun(meta, { state, banked: 0, bankedShards: 0 })).toMatchObject({ seeds: 45, runs: 3, kills: 40, best: 3, startDay: 1 });
  });
});

describe('텃밭 지키기의 오늘의 판: 기록', () => {
  it('그날의 가장 높은 점수와 그 판에서 지킨 날이 남고, 날마다 이어 온 날 수가 는다', () => {
    const first = addDailyRun(createDaily(), TODAY, { score: 320, kept: 3 });
    expect(first).toMatchObject({ first: true, improved: true, record: { day: TODAY, best: 320, kept: 3, tries: 1, streak: 1 } });
    const worse = addDailyRun(first.record, TODAY, { score: 120, kept: 1 });
    expect(worse).toMatchObject({ first: false, improved: false, record: { best: 320, kept: 3, tries: 2, streak: 1 } });
    const next = addDailyRun(worse.record, TODAY + 1, { score: 50, kept: 0 });
    expect(next.record).toMatchObject({ day: TODAY + 1, best: 50, tries: 1, streak: 2 });
    // 하루를 거르면 처음부터 센다.
    expect(addDailyRun(next.record, TODAY + 3, { score: 10, kept: 0 }).record.streak).toBe(1);
    expect(dailyToday(next.record, TODAY + 2)).toMatchObject({ tries: 0, streak: 2 });
  });

  it('저장된 기록이 망가졌으면 빈 기록으로 읽는다', () => {
    expect(normalizeDaily('x')).toEqual(createDaily());
    expect(normalizeDaily({ day: TODAY, best: 'lots', tries: 2, streak: 0, savedAt: 9 })).toEqual({
      day: TODAY,
      best: 0,
      kept: 0,
      tries: 2,
      streak: 1,
      savedAt: 9,
    });
  });

  it('공유하면 그날과 점수가 주소에 실리고, 받은 사람에게 오늘의 것만 친구 기록으로 보인다', () => {
    const share = dailyShare(TODAY, { score: 720, kept: 7 }, 3);
    expect(share).toMatchObject({ note: '11월 19일 오늘의 판 · 3일째', detail: '지킨 날 7일', day: TODAY, score: 720 });
    expect(shareUrl('https://example.com/', GARDEN_GAME_ID, share.day, share.score)).toBe(
      `https://example.com/?game=garden-guard&day=${TODAY}&score=720`,
    );
    expect(friendScoreOf(TODAY, 720, TODAY)).toBe(720);
    expect(friendScoreOf(TODAY - 1, 720, TODAY)).toBeNull();
    expect(friendScoreOf(TODAY, 0, TODAY)).toBeNull();
    expect(friendVerdict(720, 800)).toBe('720점을 넘었어요!');
    expect(friendVerdict(720, 700)).toBe('720점까지 20점');
  });

  it('화면에 적는 글은 글꼴에 있는 글자만 쓴다', () => {
    const font = fontSyllables();
    const played = addDailyRun(createDaily(), TODAY, { score: 320, kept: 3 });
    const texts = [
      ...Object.values(DAILY_TEXT),
      ...DAILY_RULES,
      ...Object.values(DAILY_OFF_RECORD),
      ...Object.values(RANK_TEXT),
      dailyDiscard(4),
      dailyInfo(createDaily(), TODAY),
      dailyInfo(played.record, TODAY),
      dailyInfo(played.record, TODAY + 1),
      dailyBest(played.record, TODAY),
      dailyBest(createDaily(), TODAY),
      dailyStreak(played.record, TODAY),
      dailyStreak(played.record, TODAY + 1),
      dailyStreak(createDaily(), TODAY),
      dailyHint(played.record, TODAY),
      dailyHint(createDaily(), TODAY),
      dailyVerdict(played),
      dailyVerdict(addDailyRun(played.record, TODAY, { score: 999, kept: 9 })),
      dailyVerdict(addDailyRun(played.record, TODAY, { score: 1, kept: 0 })),
      dailyResumeInfo(4),
      dailyResumed(4),
      dailyShare(TODAY, { score: 1, kept: 1 }, 2).note,
      dailyShare(TODAY, { score: 1, kept: 1 }, 2).detail ?? '',
      dailyShare(TODAY, { score: 1, kept: 1 }, 2).text,
      SHARED_DAY_PASSED,
      friendNotice(120),
      friendLine(120, 130),
      friendVerdict(120, 120),
      rankButton(3),
      rankNote(TODAY),
    ];
    for (const text of texts) {
      for (const char of text) {
        if (/[가-힣]/.test(char)) expect(font.has(char), `${text}의 ${char}`).toBe(true);
        else expect(char, text).toMatch(/[\x20-\x7e\n·]/);
      }
    }
  });
});
