import { describe, expect, it } from 'vitest';
import {
  createOnline,
  isJoined,
  normalizeOnline,
  pendingSubmit,
  withName,
  withoutName,
  withSent,
  type OnlineState,
} from './profile';

const ID = '01112131-4151-6171-8191-a1b1c1d1e1f1';
const OTHER_ID = '99999999-4151-6171-8191-a1b1c1d1e1f1';

const joined = (extra: Partial<OnlineState> = {}): OnlineState => ({
  id: ID,
  name: '등불지기',
  sentName: '등불지기',
  sent: {},
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
    expect(state).toEqual({ id: ID, name: '등불지기', sentName: null, sent: {} });
  });

  it('닉네임을 바꿔도 id와 올린 기록 표시는 그대로다', () => {
    const state = withName(joined({ sent: { 'stack-tower': 90 } }), '새이름', OTHER_ID);
    expect(state).toEqual({ id: ID, name: '새이름', sentName: '등불지기', sent: { 'stack-tower': 90 } });
  });

  it('랭킹에서 빠지면 처음 상태로 돌아간다', () => {
    expect(withoutName()).toEqual(createOnline());
    expect(isJoined(withoutName())).toBe(false);
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
    expect(pendingSubmit({ id: ID, name: null, sentName: null, sent: {} }, games)).toBeNull();
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
