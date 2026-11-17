import { describe, expect, it } from 'vitest';
import { createDefaultSave, type SaveData } from '../../core/save';
import { failureText, type ApiResult } from '../../online/api';
import { dayBestOf, isWaitingToSendDay, withDayScore } from '../../online/profile';
import {
  hasDailyBoard,
  rankDayOf,
  rankDayStart,
  RANK_SCAN,
  TOP_COUNT,
  type RankBoard,
  type SubmitRequest,
  type SubmitResult,
} from '../../online/protocol';
import { ScoreSync } from '../../online/sync';
import { dailySeed, dayIndexOf, SLOT_GAME_ID } from './daily';
import {
  boardDayOf,
  RANK_BOX,
  RANK_TEXT,
  rankDate,
  rankLayout,
  rankListNote,
  rankMine,
  rankNote,
  rankPages,
  rankResetLabel,
  type RankState,
} from './rank';
import { newRun } from './rules';

/** 한국 시각으로 적은 때(ms) */
const kst = (text: string): number => Date.parse(`${text}+09:00`);

const NOON = kst('2026-11-17T12:00:00');
const TODAY = rankDayOf(NOON);
const DAY_MS = 24 * 60 * 60 * 1000;

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

const board = (top: RankBoard['top'], me: RankBoard['me'] = null): RankState => ({
  kind: 'ready',
  board: { top, me, day: TODAY },
});

describe('행운 슬롯의 오늘의 판 랭킹: 어느 날의 랭킹에 올리는가', () => {
  it('이 게임에는 오늘의 랭킹이 있다', () => {
    expect(hasDailyBoard(SLOT_GAME_ID)).toBe(true);
  });

  it('오늘의 판을 오늘 마쳤으면 그 판의 날에 올린다. 그 날은 서버가 보는 랭킹의 날과 같다', () => {
    const seed = dailySeed(dayIndexOf(new Date(NOON)));
    expect(boardDayOf(seed, NOON)).toBe(TODAY);
    // 실제 판의 씨앗에서도 같다.
    expect(boardDayOf(newRun(seed).seed, NOON)).toBe(TODAY);
    // 하루의 처음과 끝에서도 같은 날이다.
    expect(boardDayOf(seed, kst('2026-11-17T00:00:00'))).toBe(TODAY);
    expect(boardDayOf(seed, kst('2026-11-17T23:59:59'))).toBe(TODAY);
    expect(rankDayStart(TODAY)).toBe(kst('2026-11-17T00:00:00'));
  });

  it('여느 판은 올리지 않는다', () => {
    expect(boardDayOf(null, NOON)).toBeNull();
    expect(boardDayOf(newRun().seed, NOON)).toBeNull();
    for (const seed of ['', 'candy-slot', 'candy-slot:daily:', 'candy-slot:daily:x', 'lantern-keeper:daily:20774']) {
      expect(boardDayOf(seed, NOON), seed).toBeNull();
    }
    // 날이 될 수 없는 값이 적힌 씨앗도 올리지 않는다.
    expect(boardDayOf(dailySeed(0), DAY_MS / 2)).toBeNull();
  });

  it('날이 넘어간 뒤에 끝낸 어제의 판은 오늘의 랭킹에 올리지 않는다', () => {
    const yesterday = dailySeed(TODAY - 1);
    expect(boardDayOf(yesterday, kst('2026-11-16T23:59:59'))).toBe(TODAY - 1);
    expect(boardDayOf(yesterday, kst('2026-11-17T00:00:00'))).toBeNull();
    expect(boardDayOf(yesterday, NOON)).toBeNull();
    // 기기가 어느 나라에 있든 같다: 협정 세계시로 16일 15시는 한국의 17일 0시다.
    expect(boardDayOf(yesterday, Date.parse('2026-11-16T14:59:59Z'))).toBe(TODAY - 1);
    expect(boardDayOf(yesterday, Date.parse('2026-11-16T15:00:00Z'))).toBeNull();
    // 내일의 씨앗(있을 수 없는 판)도 올리지 않는다.
    expect(boardDayOf(dailySeed(TODAY + 1), NOON)).toBeNull();
  });
});

describe('행운 슬롯의 오늘의 판 랭킹: 서버에 올리기', () => {
  const ID = '01112131-4151-6171-8191-a1b1c1d1e1f1';

  /** 가짜 세이브와 가짜 서버. 씬이 판을 마칠 때 하는 것처럼 오늘의 판의 점수를 적고 올린다. */
  function setup(answers: Array<ApiResult<SubmitResult>> = []) {
    let save: SaveData = createDefaultSave(1000);
    let now = NOON;
    const requests: SubmitRequest[] = [];
    const sync = new ScoreSync({
      read: () => save,
      write: (mutate) => {
        const next = structuredClone(save);
        mutate(next);
        save = next;
      },
      submit: (request) => {
        requests.push(request);
        return Promise.resolve(answers.shift() ?? { ok: true, data: { bests: {}, ranks: {} } });
      },
      now: () => now,
    });
    return {
      sync,
      requests,
      get save() {
        return save;
      },
      join() {
        save.online = { ...save.online, id: ID, name: '행운이', sentName: '행운이' };
      },
      /** 그 씨앗의 판을 지금 마쳤다 */
      finish(seed: string | null, score: number) {
        const day = boardDayOf(seed, now);
        if (day !== null) save.online = withDayScore(save.online, SLOT_GAME_ID, score, day);
      },
      at(time: number) {
        now = time;
      },
    };
  }

  it('오늘의 판을 마치면 그 점수가 그날의 랭킹으로 간다. 같은 날에는 더 높은 점수만 다시 보낸다', async () => {
    const t = setup();
    t.join();
    t.finish(dailySeed(TODAY), 120);
    expect((await t.sync.run()).status).toBe('sent');
    expect(t.requests[0].daily).toEqual({ day: TODAY, scores: { [SLOT_GAME_ID]: 120 } });
    // 더 낮은 점수로 다시 마친 판은 보낼 것이 없다.
    t.finish(dailySeed(TODAY), 90);
    expect(await t.sync.run()).toEqual({ status: 'idle' });
    t.finish(dailySeed(TODAY), 150);
    await t.sync.run();
    expect(t.requests).toHaveLength(2);
    expect(t.requests[1].daily).toEqual({ day: TODAY, scores: { [SLOT_GAME_ID]: 150 } });
    expect(dayBestOf(t.save.online, SLOT_GAME_ID, TODAY)).toBe(150);
  });

  it('여느 판과 0점으로 끝난 판은 오늘의 랭킹으로 가지 않는다', async () => {
    const t = setup();
    t.join();
    t.finish(null, 500);
    t.finish(dailySeed(TODAY), 0);
    expect(t.save.online.day).toBeNull();
    expect(await t.sync.run()).toEqual({ status: 'idle' });
    expect(t.requests).toEqual([]);
  });

  it('올리지 못한 채로 날이 바뀌면 어제의 판의 점수는 오늘의 랭킹으로 가지 않는다', async () => {
    const t = setup([{ ok: false, reason: 'offline' }]);
    t.join();
    t.at(kst('2026-11-17T23:59:00'));
    t.finish(dailySeed(TODAY), 120);
    expect((await t.sync.run()).status).toBe('failed');
    expect(isWaitingToSendDay(t.save.online, SLOT_GAME_ID, TODAY)).toBe(true);
    t.at(kst('2026-11-18T00:01:00'));
    expect(await t.sync.run()).toEqual({ status: 'idle' });
    expect(t.requests).toHaveLength(1);
    // 날이 넘어간 뒤에 끝낸 어제의 판도 마찬가지다.
    t.finish(dailySeed(TODAY), 300);
    expect(await t.sync.run()).toEqual({ status: 'idle' });
    // 새 날의 판은 새 날의 랭킹으로 간다.
    t.finish(dailySeed(TODAY + 1), 40);
    await t.sync.run();
    expect(t.requests[1].daily).toEqual({ day: TODAY + 1, scores: { [SLOT_GAME_ID]: 40 } });
  });

  it('닉네임을 정하기 전에 마친 오늘의 판도 적어 두었다가, 참여할 때 올린다', async () => {
    const t = setup();
    t.finish(dailySeed(TODAY), 120);
    expect(await t.sync.run()).toEqual({ status: 'off' });
    expect(t.requests).toEqual([]);
    t.join();
    await t.sync.run();
    expect(t.requests[0].daily).toEqual({ day: TODAY, scores: { [SLOT_GAME_ID]: 120 } });
  });
});

describe('행운 슬롯의 오늘의 판 랭킹: 글', () => {
  it('머리글에는 날짜를, 그 아래에는 언제 새로 시작하는지를 적는다', () => {
    expect(rankDate(TODAY)).toBe('11월 17일');
    const reset = new Date(rankDayStart(TODAY + 1));
    const label = `${reset.getHours()}시${reset.getMinutes() > 0 ? ` ${reset.getMinutes()}분` : ''}`;
    expect(rankResetLabel(TODAY)).toBe(label);
    expect(rankResetLabel(TODAY)).toMatch(/^\d{1,2}시( \d{1,2}분)?$/);
    expect(rankNote(TODAY)).toBe(`같은 운으로 겨뤄요 · ${label}에 새로 시작`);
  });

  it('목록 자리에는 불러오는 중인지, 왜 불러오지 못했는지, 아직 아무도 없는지를 적는다', () => {
    expect(rankListNote({ kind: 'loading' })).toBe(RANK_TEXT.loading);
    expect(rankListNote({ kind: 'failed', reason: 'offline' })).toBe(failureText('offline'));
    expect(rankListNote({ kind: 'failed', reason: 'slow' })).toBe(failureText('slow'));
    expect(rankListNote(board([]))).toBe(RANK_TEXT.empty);
    expect(rankListNote(board([{ rank: 1, name: '행운이', score: 120, mine: false }]))).toBeNull();
  });

  it('내 기록 칸에는 순위와 점수를, 올리지 못했으면 그 사정을 적는다', () => {
    const top = [{ rank: 1, name: '클로버', score: 310, mine: false }];
    const mine = { rank: 2, score: 240, name: '행운이' };
    expect(rankMine(board(top, mine), null)).toEqual({ text: '2위 · 240점', strong: true });
    expect(rankMine(board(top, { ...mine, rank: RANK_SCAN + 1 }), null).text).toBe(`${RANK_SCAN}위 밖 · 240점`);
    expect(rankMine(board(top), null)).toEqual({ text: RANK_TEXT.none, strong: false });
    // 새 기록을 올리지 못했으면 올라가 있는 옛 순위 대신 그 사정을 알린다.
    expect(rankMine(board(top, mine), 'offline')).toEqual({ text: RANK_TEXT.unsent, strong: false });
    expect(rankMine(board(top, mine), 'slow')).toEqual({ text: RANK_TEXT.slow, strong: false });
    // 랭킹을 불러오기 전에는 적을 것이 없다.
    expect(rankMine({ kind: 'loading' }, null).text).toBe('');
    expect(rankMine({ kind: 'failed', reason: 'offline' }, 'offline').text).toBe('');
  });

  it('화면에 적는 글은 글꼴에 있는 글자만 쓴다', () => {
    const common = fontSyllables();
    const mine = { rank: 2, score: 240, name: '행운이' };
    const texts = [
      ...Object.values(RANK_TEXT),
      rankDate(TODAY),
      rankNote(TODAY),
      rankMine(board([], mine), null).text,
      rankMine(board([], { ...mine, rank: RANK_SCAN + 1 }), null).text,
      ...(['offline', 'slow', 'busy', 'notfound', 'invalid'] as const).map(failureText),
    ];
    for (const text of texts) {
      for (const char of text) {
        if (char >= '가' && char <= '힣') expect(common.has(char), `"${text}"의 ${char}`).toBe(true);
        // 화살표 같은 기호는 글꼴에 없다. 가운뎃점은 이 게임의 다른 글에서도 쓴다.
        else expect(char, `"${text}"의 ${char}`).toMatch(/[\x20-\x7e\n·]/);
      }
    }
  });
});

describe('행운 슬롯의 오늘의 판 랭킹: 창의 자리', () => {
  /** 논리 화면의 높이: 폭 240에 맞춘 320x568, 390x844 화면과 그보다 짧고 긴 화면 */
  const HEIGHTS = [360, 426, 519, 640];

  it('창은 화면 안에 들고, 안에 든 것은 위에서 아래로 겹치지 않게 놓인다', () => {
    for (const height of HEIGHTS) {
      const layout = rankLayout(height);
      expect(layout.top, `${height}`).toBeGreaterThanOrEqual(2);
      expect(layout.top + layout.height, `${height}`).toBeLessThanOrEqual(height - 2);
      expect(layout.listTop).toBeGreaterThanOrEqual(layout.top + RANK_BOX.head + RANK_BOX.note);
      expect(layout.statusTop).toBeGreaterThanOrEqual(layout.listTop + layout.listHeight + RANK_BOX.inset);
      expect(layout.nameTop).toBeGreaterThanOrEqual(layout.statusTop + RANK_BOX.status);
      expect(layout.closeTop).toBeGreaterThanOrEqual(layout.nameTop + RANK_BOX.name);
      expect(layout.closeTop + RANK_BOX.close + RANK_BOX.bottom).toBe(layout.top + layout.height);
    }
  });

  it('화면이 길면 한 쪽에 줄을 더 놓고, 가장 작은 화면에서도 열 줄은 넘게 놓는다', () => {
    const rows = (height: number): number => rankPages(TOP_COUNT, rankLayout(height).listHeight).perPage;
    expect(rows(426)).toBeGreaterThanOrEqual(10);
    expect(rows(519)).toBeGreaterThan(rows(426));
    expect(rows(640)).toBe(RANK_BOX.maxRows);
    expect(rows(360)).toBeGreaterThanOrEqual(RANK_BOX.minRows);
  });

  it('줄이 다 들어가면 한 쪽이고, 넘치면 쪽을 넘기는 줄의 자리를 비우고 나눈다', () => {
    const { listHeight } = rankLayout(426);
    const whole = Math.floor(listHeight / RANK_BOX.row);
    expect(rankPages(0, listHeight).pages).toBe(1);
    expect(rankPages(whole, listHeight)).toEqual({ perPage: whole, pages: 1 });
    const paged = rankPages(TOP_COUNT, listHeight);
    expect(paged.perPage * RANK_BOX.row + RANK_BOX.pager).toBeLessThanOrEqual(listHeight);
    expect(paged.pages).toBe(Math.ceil(TOP_COUNT / paged.perPage));
  });
});
