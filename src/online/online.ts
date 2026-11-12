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
  RANKED_GAMES,
  type RankBoard,
  type RankSpan,
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

/** 봐 둔 랭킹. 범위(전체, 이번 주)와 게임마다 하나씩이다. */
const boards = new Map<string, { at: number; me: string | null; board: RankBoard }>();
/** 범위마다, 모든 게임의 내 순위를 마지막으로 받아 온 때와 그때의 기기 id */
const standingsSeen = new Map<RankSpan, { at: number; me: string }>();
/** 게임 id → 마지막으로 알게 된 이번 주의 내 순위. 전체 랭킹의 순위는 scoreSync가 들고 있다. */
const weekRanks = new Map<string, number>();

/** 봐 둔 랭킹과 순위가 낡았을 때 버린다. 다음에 볼 때 새로 불러온다. */
function forgetBoards(): void {
  boards.clear();
  standingsSeen.clear();
}

/** 닉네임을 지웠거나 다른 세이브를 불러왔을 때, 알고 있던 내 순위를 모두 잊는다. */
function forgetRanks(): void {
  scoreSync.forgetRanks();
  weekRanks.clear();
}

/** 마지막으로 알게 된 내 순위. 모르면 null. */
export function knownRank(gameId: string, span: RankSpan = 'all'): number | null {
  return span === 'week' ? (weekRanks.get(gameId) ?? null) : scoreSync.rankOf(gameId);
}

function noteRank(gameId: string, span: RankSpan, rank: number | null): void {
  if (span === 'all') scoreSync.noteRank(gameId, rank);
  else if (rank === null) weekRanks.delete(gameId);
  else weekRanks.set(gameId, rank);
}

/** 한 게임의 랭킹을 불러온다. 내 순위를 알게 되면 적어 둔다. span이 week면 이번 주의 랭킹이다. */
export async function loadBoard(
  gameId: string,
  span: RankSpan = 'all',
  now: number = Date.now(),
): Promise<ApiResult<RankBoard>> {
  if (!isRankedGame(gameId)) return { ok: false, reason: 'invalid' };
  const online = store.data.online;
  const me = isJoined(online) ? online.id : null;
  const key = `${span}:${gameId}`;
  const cached = boards.get(key);
  if (cached && cached.me === me && now - cached.at < BOARD_FRESH_MS) {
    return { ok: true, data: cached.board };
  }
  const result = await api.board(gameId, me, span);
  if (result.ok) {
    boards.set(key, { at: now, me, board: result.data });
    if (me !== null && store.data.online.id === me) noteRank(gameId, span, result.data.me?.rank ?? null);
  }
  return result;
}

/**
 * 모든 게임의 내 순위를 한 번에 불러와 적어 둔다. 적어 둔 순위는 knownRank()로 읽는다.
 * 랭킹에 참여하지 않았으면 아무것도 묻지 않고, 방금 불러왔으면 다시 묻지 않는다.
 * 순위를 새로 받아 왔을 때만 true를 돌려준다.
 */
export async function loadStandings(span: RankSpan = 'all', now: number = Date.now()): Promise<boolean> {
  const online = store.data.online;
  if (!isJoined(online)) return false;
  const me = online.id;
  const seen = standingsSeen.get(span);
  if (seen && seen.me === me && now - seen.at < BOARD_FRESH_MS) return false;
  const result = await api.standings(me, span);
  // 기다리는 사이에 랭킹에서 빠졌거나 다른 세이브를 불러왔으면 버린다.
  if (!result.ok || store.data.online.id !== me) return false;
  standingsSeen.set(span, { at: now, me });
  for (const game of RANKED_GAMES) noteRank(game, span, result.data[game]?.rank ?? null);
  return true;
}

/** 올릴 기록이 있으면 올린다. 올렸으면 봐 둔 랭킹은 낡았으니 버린다. */
export async function syncScores(): Promise<SyncOutcome> {
  const outcome = await scoreSync.run();
  if (outcome.status === 'sent') forgetBoards();
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
  forgetBoards();
}

/** 랭킹에서 내 기록을 지우고 닉네임도 지운다. 서버에서 지우지 못했으면 아무것도 바꾸지 않는다. */
export async function leaveRanking(): Promise<ApiResult<true>> {
  const online = store.data.online;
  if (!isJoined(online)) return { ok: true, data: true };
  const result = await api.forget(online.id);
  if (!result.ok) return result;
  store.update((save) => {
    if (save.online.id === online.id) save.online = withoutName(save.online);
  });
  forgetBoards();
  forgetRanks();
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
  forgetBoards();
  forgetRanks();
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
