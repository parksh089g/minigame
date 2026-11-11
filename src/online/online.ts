/**
 * 앱에서 온라인 기능을 쓸 때 거치는 곳: 점수 올리기, 랭킹 불러오기, 닉네임, 기기 옮기기.
 * 모두 실패해도 되는 일이다. 인터넷이 없으면 게임은 그대로 하고, 올리지 못한 기록은 다음에 올라간다.
 */
import { exportBundleText, importBundleText } from '../core/bundle';
import { store } from '../core/store';
import { api, type ApiFailure, type ApiResult } from './api';
import { isJoined, withName, withoutName } from './profile';
import {
  cleanCode,
  deviceIdFrom,
  isRankedGame,
  MAX_BUNDLE_CHARS,
  type RankBoard,
  type StashResult,
} from './protocol';
import { ScoreSync, type SyncOutcome } from './sync';

export const scoreSync = new ScoreSync({
  read: () => store.data,
  write: (mutate) => store.update(mutate),
  submit: (request) => api.submit(request),
});

// ------------------------------------------------------------ 랭킹

/** 방금 본 랭킹을 이만큼(ms)은 다시 묻지 않는다. 게임을 넘겨 보다 돌아올 때 요청을 아낀다. */
const BOARD_FRESH_MS = 20 * 1000;

const boards = new Map<string, { at: number; me: string | null; board: RankBoard }>();

/** 한 게임의 랭킹을 불러온다. 내 순위를 알게 되면 적어 둔다. */
export async function loadBoard(gameId: string, now: number = Date.now()): Promise<ApiResult<RankBoard>> {
  if (!isRankedGame(gameId)) return { ok: false, reason: 'invalid' };
  const online = store.data.online;
  const me = isJoined(online) ? online.id : null;
  const cached = boards.get(gameId);
  if (cached && cached.me === me && now - cached.at < BOARD_FRESH_MS) {
    return { ok: true, data: cached.board };
  }
  const result = await api.board(gameId, me);
  if (result.ok) {
    boards.set(gameId, { at: now, me, board: result.data });
    if (me !== null && store.data.online.id === me) scoreSync.noteRank(gameId, result.data.me?.rank ?? null);
  }
  return result;
}

/** 올릴 기록이 있으면 올린다. 올렸으면 봐 둔 랭킹은 낡았으니 버린다. */
export async function syncScores(): Promise<SyncOutcome> {
  const outcome = await scoreSync.run();
  if (outcome.status === 'sent') boards.clear();
  return outcome;
}

// ------------------------------------------------------------ 닉네임

function newDeviceId(): string {
  return deviceIdFrom(crypto.getRandomValues(new Uint8Array(16)));
}

/** 닉네임을 정하거나 바꾼다. name은 cleanName()을 통과한 값이어야 한다. 서버에는 다음 syncScores()에서 올라간다. */
export function setNickname(name: string): void {
  store.update((save) => {
    save.online = withName(save.online, name, newDeviceId());
  });
  boards.clear();
}

/** 랭킹에서 내 기록을 지우고 닉네임도 지운다. 서버에서 지우지 못했으면 아무것도 바꾸지 않는다. */
export async function leaveRanking(): Promise<ApiResult<true>> {
  const online = store.data.online;
  if (!isJoined(online)) return { ok: true, data: true };
  const result = await api.forget(online.id);
  if (!result.ok) return result;
  store.update((save) => {
    if (save.online.id === online.id) save.online = withoutName();
  });
  boards.clear();
  scoreSync.forgetRanks();
  return result;
}

// ------------------------------------------------------------ 기기 옮기기

/** 이 기기의 기록을 서버에 잠깐 맡기고 옮기기 코드를 받는다. */
export async function createTransferCode(): Promise<ApiResult<StashResult>> {
  const text = await exportBundleText(MAX_BUNDLE_CHARS);
  if (text === null) return { ok: false, reason: 'invalid' };
  return api.stash(text);
}

export type TransferFailure = ApiFailure | 'unreadable';

/** 옮기기 코드로 다른 기기의 기록을 받아 이 기기의 기록을 바꾼다. */
export async function useTransferCode(
  rawCode: string,
): Promise<{ ok: true } | { ok: false; reason: TransferFailure }> {
  const code = cleanCode(rawCode);
  if (code === null) return { ok: false, reason: 'invalid' };
  const result = await api.take(code);
  if (!result.ok) return result;
  if (!(await importBundleText(result.data))) return { ok: false, reason: 'unreadable' };
  afterImport();
  return { ok: true };
}

/** 다른 세이브를 불러온 뒤에 부른다. 닉네임과 기록이 바뀌었을 수 있다. */
export function afterImport(): void {
  boards.clear();
  scoreSync.forgetRanks();
  void syncScores();
}

// ------------------------------------------------------------ 시작

/** 앱을 켠 뒤 한숨 돌리고 올리지 못한 기록을 올린다(ms). */
const START_DELAY_MS = 4000;

/** 앱을 시작할 때 한 번 부른다. 올리지 못한 기록이 있으면 올리고, 인터넷이 다시 연결되면 또 올려 본다. */
export function initOnline(): void {
  window.setTimeout(() => void syncScores(), START_DELAY_MS);
  window.addEventListener('online', () => void syncScores());
}
