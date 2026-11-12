/**
 * 온라인 기능에서 "나"를 나타내는 값: 닉네임, 무작위 id, 서버에 어디까지 올렸는지.
 * 세이브(core/save.ts)에 들어가서 내보내기와 기기 옮기기를 따라다닌다. 화면에도 통신에도 기대지 않는다.
 */
import { cleanName, cleanScore, isDeviceId, isRankedGame, RANKED_GAMES, type SubmitRequest } from './protocol';

export interface OnlineState {
  /** 랭킹에서 이 세이브의 줄을 가리키는 무작위 id. 닉네임을 처음 정할 때 만든다. */
  id: string | null;
  /** 닉네임. 정하지 않았으면 null이고, 그동안에는 서버에 아무것도 보내지 않는다. */
  name: string | null;
  /** 서버에 마지막으로 올라간 닉네임 */
  sentName: string | null;
  /** 게임 id → 서버에 올라가 있는 최고 점수 */
  sent: Record<string, number>;
}

export function createOnline(): OnlineState {
  return { id: null, name: null, sentName: null, sent: {} };
}

/** 저장소나 가져온 파일에서 읽은 값을 믿을 수 있는 모양으로 맞춘다. */
export function normalizeOnline(raw: unknown): OnlineState {
  const state = createOnline();
  if (typeof raw !== 'object' || raw === null) return state;
  const data = raw as Record<string, unknown>;
  if (!isDeviceId(data.id)) return state;
  state.id = data.id;
  state.name = cleanName(data.name);
  if (state.name === null) return state;
  state.sentName = cleanName(data.sentName);
  if (typeof data.sent === 'object' && data.sent !== null) {
    for (const [game, value] of Object.entries(data.sent as Record<string, unknown>)) {
      const score = cleanScore(value);
      if (isRankedGame(game) && score !== null) state.sent[game] = score;
    }
  }
  return state;
}

/** 랭킹에 참여하고 있는지(닉네임을 정했는지) */
export function isJoined(state: OnlineState): state is OnlineState & { id: string; name: string } {
  return state.id !== null && state.name !== null;
}

/**
 * 닉네임을 정하거나 바꾼다. id가 아직 없으면 newId를 쓴다.
 * name은 cleanName()을 통과한 값이어야 한다.
 */
export function withName(state: OnlineState, name: string, newId: string): OnlineState {
  return { ...state, id: state.id ?? newId, name };
}

/** 랭킹에서 빠진다. 닉네임과 올린 기록 표시를 지운다. 다시 참여하면 새 id로 시작한다. */
export function withoutName(): OnlineState {
  return createOnline();
}

/** 게임 id → 최고 점수 */
export type Bests = Readonly<Record<string, { best: number } | undefined>>;

/**
 * 서버에 보내야 할 것. 보낼 것이 없거나 랭킹에 참여하지 않았으면 null.
 * 서버에 올라가 있는 것보다 높아진 최고 점수와, 바뀐 닉네임을 보낸다.
 */
export function pendingSubmit(state: OnlineState, games: Bests): SubmitRequest | null {
  if (!isJoined(state)) return null;
  const scores: Record<string, number> = {};
  for (const game of RANKED_GAMES) {
    const best = cleanScore(games[game]?.best ?? 0);
    if (best !== null && best > (state.sent[game] ?? 0)) scores[game] = best;
  }
  if (Object.keys(scores).length === 0 && state.sentName === state.name) return null;
  return { device: state.id, name: state.name, scores };
}

/** 이 게임의 최고 점수가 서버에 아직 올라가지 않았는지. 랭킹에 참여하지 않았으면 false다. */
export function isWaitingToSend(state: OnlineState, games: Bests, game: string): boolean {
  return pendingSubmit(state, games)?.scores[game] !== undefined;
}

/**
 * 서버가 받았다고 답한 것을 적어 둔다. request는 그때 보낸 것, bests는 서버에 남은 최고 점수다.
 * 보내는 사이에 닉네임이나 기록이 또 바뀌었을 수 있으므로, 지금 값이 아니라 보낸 값을 적는다.
 */
export function withSent(
  state: OnlineState,
  request: SubmitRequest,
  bests: Readonly<Record<string, number>>,
): OnlineState {
  // 보내는 사이에 랭킹에서 빠졌거나 다른 세이브를 불러왔으면 적지 않는다.
  if (state.id !== request.device) return state;
  const sent = { ...state.sent };
  for (const [game, value] of Object.entries(bests)) {
    const score = cleanScore(value);
    if (isRankedGame(game) && score !== null) sent[game] = Math.max(sent[game] ?? 0, score);
  }
  return { ...state, sentName: request.name, sent };
}
