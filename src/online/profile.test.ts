import { describe, expect, it } from 'vitest';
import {
  createOnline,
  dayBestOf,
  isJoined,
  isWaitingToSend,
  isWaitingToSendDay,
  normalizeOnline,
  pendingSubmit,
  isWaitingToSendWeek,
  weekBestOf,
  withDayScore,
  withName,
  withoutName,
  withSent,
  withWeekScore,
  type OnlineState,
} from './profile';

const ID = '01112131-4151-6171-8191-a1b1c1d1e1f1';
const OTHER_ID = '99999999-4151-6171-8191-a1b1c1d1e1f1';
/** 랭킹 주의 이름(그 주 월요일의 날짜) */
const WEEK = '2026-11-09';
const NEXT_WEEK = '2026-11-16';

const joined = (extra: Partial<OnlineState> = {}): OnlineState => ({
  id: ID,
  name: '등불지기',
  sentName: '등불지기',
  sent: {},
  week: null,
  day: null,
  ...extra,
});

describe('저장된 값 읽기', () => {
  it('값이 없거나 깨졌으면 참여하지 않은 상태다', () => {
    for (const raw of [undefined, null, 'x', 3, {}, { id: 'nope', name: '이름' }]) {
      expect(normalizeOnline(raw)).toEqual(createOnline());
    }
  });

  it('올바른 값은 그대로 읽는다', () => {
    const state = joined({ sent: { 'lantern-keeper': 1200, 'stack-tower': 90 } });
    expect(normalizeOnline(state)).toEqual(state);
    expect(normalizeOnline(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });

  it('닉네임이 쓸 수 없는 값이면 닉네임 없이 읽는다', () => {
    expect(normalizeOnline({ id: ID, name: '<b>', sentName: '<b>', sent: { 'stack-tower': 5 } })).toEqual({
      id: ID,
      name: null,
      sentName: null,
      sent: {},
      week: null,
      day: null,
    });
  });

  it('모르는 게임과 이상한 점수는 버린다', () => {
    const raw = { ...joined(), sent: { 'stack-tower': 90, nope: 5, 'gate-run': -3, 'pin-pull': 'x' } };
    expect(normalizeOnline(raw).sent).toEqual({ 'stack-tower': 90 });
  });
});

describe('참여와 닉네임', () => {
  it('닉네임을 처음 정하면 새 id로 참여한다', () => {
    const state = withName(createOnline(), '등불지기', ID);
    expect(isJoined(state)).toBe(true);
    expect(state).toEqual({ id: ID, name: '등불지기', sentName: null, sent: {}, week: null, day: null });
  });

  it('닉네임을 바꿔도 id와 올린 기록 표시는 그대로다', () => {
    const state = withName(joined({ sent: { 'stack-tower': 90 } }), '새이름', OTHER_ID);
    expect(state).toEqual({
      id: ID,
      name: '새이름',
      sentName: '등불지기',
      sent: { 'stack-tower': 90 },
      week: null,
      day: null,
    });
  });

  it('랭킹에서 빠지면 처음 상태로 돌아간다', () => {
    const state = joined({ sent: { 'stack-tower': 90 } });
    expect(withoutName(state)).toEqual(createOnline());
    expect(isJoined(withoutName(state))).toBe(false);
  });

  it('랭킹에서 빠져도 이번 주에 낸 점수는 남는다. 다시 참여하면 새 id로 다시 올라간다', () => {
    const week = { key: WEEK, bests: { 'stack-tower': 90 }, sent: { 'stack-tower': 90 } };
    const left = withoutName(joined({ week }));
    expect(left.week).toEqual({ key: WEEK, bests: { 'stack-tower': 90 }, sent: {} });
    const back = withName(left, '새이름', OTHER_ID);
    expect(pendingSubmit(back, {}, WEEK)?.weekly).toEqual({ week: WEEK, scores: { 'stack-tower': 90 } });
  });
});

describe('보낼 것 고르기', () => {
  const games = {
    'lantern-keeper': { best: 1200 },
    'stack-tower': { best: 90 },
    'gate-run': { best: 0 },
    'not-a-game': { best: 500 },
  };

  it('참여하지 않았으면 아무것도 보내지 않는다', () => {
    expect(pendingSubmit(createOnline(), games)).toBeNull();
    expect(pendingSubmit({ id: ID, name: null, sentName: null, sent: {}, week: null, day: null }, games)).toBeNull();
  });

  it('아직 올리지 않은 최고 점수를 모두 보낸다. 0점과 모르는 게임은 빼고', () => {
    expect(pendingSubmit(joined(), games)).toEqual({
      device: ID,
      name: '등불지기',
      scores: { 'lantern-keeper': 1200, 'stack-tower': 90 },
    });
  });

  it('이미 올라가 있는 점수보다 높아진 것만 보낸다', () => {
    const state = joined({ sent: { 'lantern-keeper': 1200, 'stack-tower': 60 } });
    expect(pendingSubmit(state, games)?.scores).toEqual({ 'stack-tower': 90 });
  });

  it('모두 올라가 있으면 보낼 것이 없다', () => {
    const state = joined({ sent: { 'lantern-keeper': 1200, 'stack-tower': 90 } });
    expect(pendingSubmit(state, games)).toBeNull();
    // 서버에 더 높은 점수가 있어도(이 기기의 기록을 지운 뒤) 보낼 것은 없다.
    expect(pendingSubmit(joined({ sent: { 'lantern-keeper': 5000, 'stack-tower': 90 } }), games)).toBeNull();
  });

  it('닉네임만 바뀌었으면 점수 없이 닉네임을 보낸다', () => {
    const state = joined({ name: '새이름', sent: { 'lantern-keeper': 1200, 'stack-tower': 90 } });
    expect(pendingSubmit(state, games)).toEqual({ device: ID, name: '새이름', scores: {} });
  });

  it('기록이 하나도 없어도 처음 정한 닉네임은 보낸다', () => {
    expect(pendingSubmit(joined({ sentName: null }), {})).toEqual({ device: ID, name: '등불지기', scores: {} });
  });
});

describe('아직 올라가지 않은 게임', () => {
  const games = { 'stack-tower': { best: 90 }, 'jump-runner': { best: 0 } };

  it('서버에 올라가 있는 것보다 높은 기록이 있는 게임만 해당한다', () => {
    expect(isWaitingToSend(joined(), games, 'stack-tower')).toBe(true);
    expect(isWaitingToSend(joined({ sent: { 'stack-tower': 60 } }), games, 'stack-tower')).toBe(true);
    expect(isWaitingToSend(joined({ sent: { 'stack-tower': 90 } }), games, 'stack-tower')).toBe(false);
    // 기록이 없는 게임은 올릴 것이 없다.
    expect(isWaitingToSend(joined(), games, 'jump-runner')).toBe(false);
    expect(isWaitingToSend(joined(), games, 'color-sort')).toBe(false);
  });

  it('닉네임만 올라가지 않았을 때는 어느 게임도 해당하지 않는다', () => {
    const state = joined({ sentName: null, sent: { 'stack-tower': 90 } });
    expect(isWaitingToSend(state, games, 'stack-tower')).toBe(false);
  });

  it('랭킹에 참여하지 않았으면 해당하지 않는다', () => {
    expect(isWaitingToSend(createOnline(), games, 'stack-tower')).toBe(false);
  });
});

describe('올린 것 적어 두기', () => {
  const request = { device: ID, name: '등불지기', scores: { 'stack-tower': 90 } };

  it('서버에 남은 점수와 보낸 닉네임을 적는다', () => {
    const state = withSent(joined({ sentName: null }), request, { 'stack-tower': 90 });
    expect(state.sentName).toBe('등불지기');
    expect(state.sent).toEqual({ 'stack-tower': 90 });
    expect(pendingSubmit(state, { 'stack-tower': { best: 90 } })).toBeNull();
  });

  it('서버에 더 높은 점수가 남아 있었으면 그 점수를 적는다', () => {
    expect(withSent(joined(), request, { 'stack-tower': 150 }).sent).toEqual({ 'stack-tower': 150 });
  });

  it('보내는 사이에 닉네임을 또 바꿨으면 다음에 다시 보내게 된다', () => {
    const renamed = joined({ name: '또바꿈', sentName: null });
    const state = withSent(renamed, request, { 'stack-tower': 90 });
    expect(state.sentName).toBe('등불지기');
    expect(pendingSubmit(state, { 'stack-tower': { best: 90 } })).toEqual({
      device: ID,
      name: '또바꿈',
      scores: {},
    });
  });

  it('보내는 사이에 랭킹에서 빠졌거나 다른 세이브를 불러왔으면 적지 않는다', () => {
    expect(withSent(createOnline(), request, { 'stack-tower': 90 })).toEqual(createOnline());
    const other = joined({ id: OTHER_ID });
    expect(withSent(other, request, { 'stack-tower': 90 })).toBe(other);
  });

  it('서버가 이상한 값을 돌려줘도 망가지지 않는다', () => {
    const state = withSent(joined(), request, { nope: 5, 'stack-tower': -1 });
    expect(state.sent).toEqual({});
  });
});

describe('이번 주에 낸 점수', () => {
  it('랭킹이 있는 게임의 점수를 그 주의 기록으로 적는다. 닉네임이 없어도 적는다', () => {
    const state = withWeekScore(createOnline(), 'stack-tower', 40, WEEK);
    expect(state.week).toEqual({ key: WEEK, bests: { 'stack-tower': 40 }, sent: {} });
    expect(weekBestOf(state, 'stack-tower', WEEK)).toBe(40);
    expect(weekBestOf(state, 'stack-tower', NEXT_WEEK)).toBe(0);
    expect(isJoined(state)).toBe(false);
  });

  it('같은 주에는 더 높은 점수만 남긴다', () => {
    let state = withWeekScore(joined(), 'stack-tower', 40, WEEK);
    const same = withWeekScore(state, 'stack-tower', 30, WEEK);
    expect(same).toBe(state);
    state = withWeekScore(state, 'stack-tower', 55, WEEK);
    state = withWeekScore(state, 'gate-run', 12, WEEK);
    expect(state.week?.bests).toEqual({ 'stack-tower': 55, 'gate-run': 12 });
  });

  it('주가 바뀌면 지난 주의 것은 버리고 새로 적는다', () => {
    const before = joined({ week: { key: WEEK, bests: { 'stack-tower': 90 }, sent: { 'stack-tower': 90 } } });
    const after = withWeekScore(before, 'stack-tower', 10, NEXT_WEEK);
    expect(after.week).toEqual({ key: NEXT_WEEK, bests: { 'stack-tower': 10 }, sent: {} });
  });

  it('랭킹이 없는 게임과 0점은 적지 않는다', () => {
    const state = joined();
    expect(withWeekScore(state, 'not-a-game', 50, WEEK)).toBe(state);
    // 평판이 계속 쌓이는 새싹 컴퍼니는 전체 랭킹에만 오른다.
    expect(withWeekScore(state, 'sprout-company', 50, WEEK)).toBe(state);
    expect(withWeekScore(state, 'stack-tower', 0, WEEK)).toBe(state);
    expect(withWeekScore(state, 'stack-tower', Number.NaN, WEEK)).toBe(state);
  });

  it('아직 올리지 않은 이번 주의 점수를 최고 점수와 함께 보낸다', () => {
    const state = joined({
      sent: { 'stack-tower': 90 },
      week: { key: WEEK, bests: { 'stack-tower': 55, 'gate-run': 12 }, sent: { 'gate-run': 12 } },
    });
    const games = { 'stack-tower': { best: 90 }, 'gate-run': { best: 30 } };
    expect(pendingSubmit(state, games, WEEK)).toEqual({
      device: ID,
      name: '등불지기',
      scores: { 'gate-run': 30 },
      weekly: { week: WEEK, scores: { 'stack-tower': 55 } },
    });
    expect(isWaitingToSendWeek(state, 'stack-tower', WEEK)).toBe(true);
    expect(isWaitingToSendWeek(state, 'gate-run', WEEK)).toBe(false);
  });

  it('최고 점수는 그대로여도 이번 주의 점수가 있으면 보낸다', () => {
    const state = joined({
      sent: { 'stack-tower': 90 },
      week: { key: WEEK, bests: { 'stack-tower': 55 }, sent: {} },
    });
    expect(pendingSubmit(state, { 'stack-tower': { best: 90 } }, WEEK)).toEqual({
      device: ID,
      name: '등불지기',
      scores: {},
      weekly: { week: WEEK, scores: { 'stack-tower': 55 } },
    });
  });

  it('적어 둔 것이 지난 주의 것이면 보내지 않는다', () => {
    const state = joined({ week: { key: WEEK, bests: { 'stack-tower': 55 }, sent: {} } });
    expect(pendingSubmit(state, {}, NEXT_WEEK)).toBeNull();
    expect(isWaitingToSendWeek(state, 'stack-tower', NEXT_WEEK)).toBe(false);
    // 주를 알려 주지 않으면(옛 방식) 이번 주의 점수는 따지지 않는다.
    expect(pendingSubmit(state, {})).toBeNull();
  });

  it('참여하지 않았으면 이번 주의 점수가 있어도 보내지 않는다', () => {
    const state = withWeekScore(createOnline(), 'stack-tower', 40, WEEK);
    expect(pendingSubmit(state, {}, WEEK)).toBeNull();
    expect(isWaitingToSendWeek(state, 'stack-tower', WEEK)).toBe(false);
  });

  it('서버가 답하면 보낸 것으로 적어서 다시 보내지 않는다', () => {
    const state = joined({ week: { key: WEEK, bests: { 'stack-tower': 55 }, sent: {} } });
    const request = pendingSubmit(state, {}, WEEK);
    expect(request).not.toBeNull();
    if (!request) return;
    const after = withSent(state, request, {});
    expect(after.week?.sent).toEqual({ 'stack-tower': 55 });
    expect(pendingSubmit(after, {}, WEEK)).toBeNull();
  });

  it('보내는 사이에 주가 바뀌었으면 새 주의 기록은 건드리지 않는다', () => {
    const state = joined({ week: { key: WEEK, bests: { 'stack-tower': 55 }, sent: {} } });
    const request = pendingSubmit(state, {}, WEEK);
    if (!request) throw new Error('보낼 것이 있어야 한다');
    const moved = withWeekScore(state, 'stack-tower', 20, NEXT_WEEK);
    const after = withSent(moved, request, {});
    expect(after.week).toEqual({ key: NEXT_WEEK, bests: { 'stack-tower': 20 }, sent: {} });
  });

  it('저장된 이번 주의 기록을 읽는다. 이상한 값은 버린다', () => {
    const week = {
      key: WEEK,
      bests: { 'stack-tower': 55, nope: 3, 'gate-run': -1, 'sprout-company': 900 },
      sent: { 'stack-tower': 40 },
    };
    expect(normalizeOnline({ ...joined(), week }).week).toEqual({
      key: WEEK,
      bests: { 'stack-tower': 55 },
      sent: { 'stack-tower': 40 },
    });
    expect(normalizeOnline({ ...joined(), week: { key: '이번 주', bests: {} } }).week).toBeNull();
    expect(normalizeOnline({ ...joined(), week: 'x' }).week).toBeNull();
  });

  it('닉네임이 없는 세이브에서는 이번 주의 점수만 읽고, 올렸다는 표시는 버린다', () => {
    const week = { key: WEEK, bests: { 'stack-tower': 55 }, sent: { 'stack-tower': 55 } };
    expect(normalizeOnline({ week })).toEqual({
      ...createOnline(),
      week: { key: WEEK, bests: { 'stack-tower': 55 }, sent: {} },
    });
  });
});

describe('오늘의 판에서 낸 점수', () => {
  /** 랭킹의 날(한국 시각으로 며칠째인지) */
  const DAY = 20_770;
  const GAME = 'lantern-keeper';

  it('오늘의 판 점수를 그날의 기록으로 적는다. 닉네임이 없어도 적는다', () => {
    const state = withDayScore(createOnline(), GAME, 700, DAY);
    expect(state.day).toEqual({ key: DAY, bests: { [GAME]: 700 }, sent: {} });
    expect(dayBestOf(state, GAME, DAY)).toBe(700);
    expect(dayBestOf(state, GAME, DAY + 1)).toBe(0);
    expect(isJoined(state)).toBe(false);
  });

  it('같은 날에는 더 높은 점수만 남기고, 날이 바뀌면 지난 날의 것은 버린다', () => {
    let state = withDayScore(joined(), GAME, 700, DAY);
    expect(withDayScore(state, GAME, 300, DAY)).toBe(state);
    state = withDayScore(state, GAME, 950, DAY);
    expect(state.day?.bests).toEqual({ [GAME]: 950 });
    const sent = { ...state, day: { key: DAY, bests: { [GAME]: 950 }, sent: { [GAME]: 950 } } };
    expect(withDayScore(sent, GAME, 100, DAY + 1).day).toEqual({ key: DAY + 1, bests: { [GAME]: 100 }, sent: {} });
  });

  it('오늘의 판이 없는 게임과 0점, 이상한 날은 적지 않는다', () => {
    const state = joined();
    expect(withDayScore(state, 'stack-tower', 50, DAY)).toBe(state);
    expect(withDayScore(state, 'not-a-game', 50, DAY)).toBe(state);
    expect(withDayScore(state, GAME, 0, DAY)).toBe(state);
    expect(withDayScore(state, GAME, 50, 1.5)).toBe(state);
  });

  it('아직 올리지 않은 오늘의 점수를 최고 점수, 이번 주의 점수와 함께 보낸다', () => {
    const state = joined({
      week: { key: WEEK, bests: { 'stack-tower': 55 }, sent: {} },
      day: { key: DAY, bests: { [GAME]: 700 }, sent: {} },
    });
    expect(pendingSubmit(state, { 'stack-tower': { best: 90 } }, WEEK, DAY)).toEqual({
      device: ID,
      name: '등불지기',
      scores: { 'stack-tower': 90 },
      weekly: { week: WEEK, scores: { 'stack-tower': 55 } },
      daily: { day: DAY, scores: { [GAME]: 700 } },
    });
    expect(isWaitingToSendDay(state, GAME, DAY)).toBe(true);
  });

  it('다른 것은 그대로여도 오늘의 점수가 있으면 보낸다', () => {
    const state = joined({ day: { key: DAY, bests: { [GAME]: 700 }, sent: { [GAME]: 400 } } });
    expect(pendingSubmit(state, {}, WEEK, DAY)).toEqual({
      device: ID,
      name: '등불지기',
      scores: {},
      daily: { day: DAY, scores: { [GAME]: 700 } },
    });
  });

  it('적어 둔 것이 지난 날의 것이거나 참여하지 않았으면 보내지 않는다', () => {
    const state = joined({ day: { key: DAY, bests: { [GAME]: 700 }, sent: {} } });
    expect(pendingSubmit(state, {}, WEEK, DAY + 1)).toBeNull();
    expect(isWaitingToSendDay(state, GAME, DAY + 1)).toBe(false);
    // 날을 알려 주지 않으면(옛 방식) 오늘의 점수는 따지지 않는다.
    expect(pendingSubmit(state, {}, WEEK)).toBeNull();
    const guest = withDayScore(createOnline(), GAME, 700, DAY);
    expect(pendingSubmit(guest, {}, WEEK, DAY)).toBeNull();
    expect(isWaitingToSendDay(guest, GAME, DAY)).toBe(false);
  });

  it('서버가 답하면 보낸 것으로 적어서 다시 보내지 않는다', () => {
    const state = joined({ day: { key: DAY, bests: { [GAME]: 700 }, sent: {} } });
    const request = pendingSubmit(state, {}, WEEK, DAY);
    if (!request) throw new Error('보낼 것이 있어야 한다');
    const after = withSent(state, request, {});
    expect(after.day?.sent).toEqual({ [GAME]: 700 });
    expect(pendingSubmit(after, {}, WEEK, DAY)).toBeNull();
    // 보내는 사이에 날이 바뀌었으면 새 날의 기록은 건드리지 않는다.
    const moved = withDayScore(state, GAME, 200, DAY + 1);
    expect(withSent(moved, request, {}).day).toEqual({ key: DAY + 1, bests: { [GAME]: 200 }, sent: {} });
  });

  it('랭킹에서 빠져도 오늘 낸 점수는 남는다. 다시 참여하면 다시 올라간다', () => {
    const state = joined({ day: { key: DAY, bests: { [GAME]: 700 }, sent: { [GAME]: 700 } } });
    const left = withoutName(state);
    expect(left.day).toEqual({ key: DAY, bests: { [GAME]: 700 }, sent: {} });
    const back = withName(left, '새이름', OTHER_ID);
    expect(pendingSubmit(back, {}, WEEK, DAY)?.daily).toEqual({ day: DAY, scores: { [GAME]: 700 } });
  });

  it('저장된 오늘의 기록을 읽는다. 이상한 값은 버린다', () => {
    const day = { key: DAY, bests: { [GAME]: 700, nope: 3, 'stack-tower': 40 }, sent: { [GAME]: 400 } };
    expect(normalizeOnline({ ...joined(), day }).day).toEqual({
      key: DAY,
      bests: { [GAME]: 700 },
      sent: { [GAME]: 400 },
    });
    expect(normalizeOnline({ ...joined(), day: { key: '오늘', bests: {} } }).day).toBeNull();
    expect(normalizeOnline({ ...joined(), day: 'x' }).day).toBeNull();
    // 닉네임이 없는 세이브에서는 점수만 읽고, 올렸다는 표시는 버린다.
    expect(normalizeOnline({ day }).day).toEqual({ key: DAY, bests: { [GAME]: 700 }, sent: {} });
    // 오늘의 랭킹이 생기기 전의 세이브에는 이 값이 없다.
    expect(normalizeOnline({ ...joined() }).day).toBeNull();
  });
});
