/**
 * 온라인 기능에서 "나"를 나타내는 값: 닉네임, 무작위 id, 서버에 어디까지 올렸는지.
 * 세이브(core/save.ts)에 들어가서 내보내기와 기기 옮기기를 따라다닌다. 화면에도 통신에도 기대지 않는다.
 */
import {
  cleanName,
  cleanScore,
  hasDailyBoard,
  hasWeeklyBoard,
  isDeviceId,
  isRankDay,
  isRankedGame,
  isRankWeek,
  RANKED_GAMES,
  type SubmitRequest,
} from './protocol';

/**
 * 이번 주 랭킹에 올릴 기록. 주가 바뀌면 통째로 새로 시작한다.
 * 닉네임을 정하기 전에 낸 점수도 적어 둔다. 주중에 참여해도 그 주에 낸 기록이 같이 올라간다.
 */
export interface WeekBests {
  /** 이 기록이 속한 주(protocol.ts의 rankWeekOf) */
  key: string;
  /** 게임 id → 이 주에 낸 가장 높은 점수 */
  bests: Record<string, number>;
  /** 게임 id → 그중 서버에 올린 점수. 서버가 받지 않은 것(주가 이미 바뀐 경우)도 다시 보내지 않게 여기에 적는다. */
  sent: Record<string, number>;
}

/**
 * 오늘의 랭킹에 올릴 기록: 그날의 판(등불지기의 오늘의 판)에서 낸 점수. 날이 바뀌면 통째로 새로 시작한다.
 * 이번 주의 기록처럼, 닉네임을 정하기 전에 낸 점수도 적어 둔다.
 */
export interface DayBests {
  /** 이 기록이 속한 날(protocol.ts의 rankDayOf) */
  key: number;
  /** 게임 id → 그날의 판에서 낸 가장 높은 점수 */
  bests: Record<string, number>;
  /** 게임 id → 그중 서버에 올린 점수. 서버가 받지 않은 것(날이 이미 바뀐 경우)도 다시 보내지 않게 여기에 적는다. */
  sent: Record<string, number>;
}

export interface OnlineState {
  /** 랭킹에서 이 세이브의 줄을 가리키는 무작위 id. 닉네임을 처음 정할 때 만든다. */
  id: string | null;
  /** 닉네임. 정하지 않았으면 null이고, 그동안에는 서버에 아무것도 보내지 않는다. */
  name: string | null;
  /** 서버에 마지막으로 올라간 닉네임 */
  sentName: string | null;
  /** 게임 id → 서버에 올라가 있는 최고 점수 */
  sent: Record<string, number>;
  /** 이번 주 랭킹에 올릴 기록. 주간 랭킹이 생긴 뒤로 랭킹이 있는 게임을 한 판도 하지 않았으면 null. */
  week: WeekBests | null;
  /** 오늘의 랭킹에 올릴 기록. 오늘의 랭킹이 생긴 뒤로 오늘의 판을 한 판도 하지 않았으면 null. */
  day: DayBests | null;
}

export function createOnline(): OnlineState {
  return { id: null, name: null, sentName: null, sent: {}, week: null, day: null };
}

/** 게임 id → 점수로 된 묶음에서 랭킹에 올릴 수 있는 것만 고른다. */
function readScores(raw: unknown): Record<string, number> {
  const scores: Record<string, number> = {};
  if (typeof raw !== 'object' || raw === null) return scores;
  for (const [game, value] of Object.entries(raw as Record<string, unknown>)) {
    const score = cleanScore(value);
    if (isRankedGame(game) && score !== null) scores[game] = score;
  }
  return scores;
}

/** 주간 랭킹이 있는 게임의 점수만 남긴다. */
function readWeekScores(raw: unknown): Record<string, number> {
  return Object.fromEntries(Object.entries(readScores(raw)).filter(([game]) => hasWeeklyBoard(game)));
}

/** joined가 아니면(닉네임이 없으면) 올린 것이 있을 수 없으므로 sent는 비운다. */
function normalizeWeek(raw: unknown, joined: boolean): WeekBests | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const data = raw as Record<string, unknown>;
  if (!isRankWeek(data.key)) return null;
  return { key: data.key, bests: readWeekScores(data.bests), sent: joined ? readWeekScores(data.sent) : {} };
}

/** 오늘의 랭킹이 있는 게임의 점수만 남긴다. */
function readDayScores(raw: unknown): Record<string, number> {
  return Object.fromEntries(Object.entries(readScores(raw)).filter(([game]) => hasDailyBoard(game)));
}

function normalizeDay(raw: unknown, joined: boolean): DayBests | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const data = raw as Record<string, unknown>;
  if (!isRankDay(data.key)) return null;
  return { key: data.key, bests: readDayScores(data.bests), sent: joined ? readDayScores(data.sent) : {} };
}

/** 저장소나 가져온 파일에서 읽은 값을 믿을 수 있는 모양으로 맞춘다. */
export function normalizeOnline(raw: unknown): OnlineState {
  const state = createOnline();
  if (typeof raw !== 'object' || raw === null) return state;
  const data = raw as Record<string, unknown>;
  const name = isDeviceId(data.id) ? cleanName(data.name) : null;
  state.week = normalizeWeek(data.week, name !== null);
  state.day = normalizeDay(data.day, name !== null);
  if (!isDeviceId(data.id)) return state;
  state.id = data.id;
  state.name = name;
  if (state.name === null) return state;
  state.sentName = cleanName(data.sentName);
  state.sent = readScores(data.sent);
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

/**
 * 랭킹에서 빠진다. 닉네임과 올린 기록 표시를 지운다. 다시 참여하면 새 id로 시작한다.
 * 이번 주와 오늘 낸 점수는 남겨 둔다. 최고 기록처럼, 다시 참여하면 새 id로 다시 올라간다.
 */
export function withoutName(state: OnlineState): OnlineState {
  return {
    ...createOnline(),
    week: state.week ? { ...state.week, sent: {} } : null,
    day: state.day ? { ...state.day, sent: {} } : null,
  };
}

/**
 * 방금 끝난 판의 점수를 이번 주(week)의 기록에 적는다. 적어 둔 것이 다른 주의 것이면 버리고 새로 시작한다.
 * 랭킹이 없는 게임, 주간 랭킹이 없는 게임(점수가 계속 쌓이는 새싹 컴퍼니), 올릴 수 없는 점수(0점)는 적지 않는다.
 */
export function withWeekScore(state: OnlineState, game: string, rawScore: number, week: string): OnlineState {
  const score = cleanScore(rawScore);
  if (!hasWeeklyBoard(game) || score === null) return state;
  const current = state.week?.key === week ? state.week : { key: week, bests: {}, sent: {} };
  if (score <= (current.bests[game] ?? 0) && current === state.week) return state;
  return {
    ...state,
    week: { ...current, bests: { ...current.bests, [game]: Math.max(score, current.bests[game] ?? 0) } },
  };
}

/**
 * 방금 끝난 오늘의 판의 점수를 그날(day)의 기록에 적는다. 적어 둔 것이 다른 날의 것이면 버리고 새로 시작한다.
 * 오늘의 랭킹이 없는 게임과 올릴 수 없는 점수(0점)는 적지 않는다.
 */
export function withDayScore(state: OnlineState, game: string, rawScore: number, day: number): OnlineState {
  const score = cleanScore(rawScore);
  if (!hasDailyBoard(game) || score === null || !isRankDay(day)) return state;
  const current = state.day?.key === day ? state.day : { key: day, bests: {}, sent: {} };
  if (score <= (current.bests[game] ?? 0) && current === state.day) return state;
  return {
    ...state,
    day: { ...current, bests: { ...current.bests, [game]: Math.max(score, current.bests[game] ?? 0) } },
  };
}

/** 게임 id → 최고 점수 */
export type Bests = Readonly<Record<string, { best: number } | undefined>>;

/** 이번 주(week)에 낸 점수 가운데 아직 올리지 않은 것. 적어 둔 것이 다른 주의 것이면 비어 있다. */
function pendingWeek(state: OnlineState, week: string | null): Record<string, number> {
  const scores: Record<string, number> = {};
  if (week === null || state.week?.key !== week) return scores;
  for (const game of RANKED_GAMES) {
    const best = state.week.bests[game] ?? 0;
    if (best > (state.week.sent[game] ?? 0)) scores[game] = best;
  }
  return scores;
}

/** 오늘(day)의 판에서 낸 점수 가운데 아직 올리지 않은 것. 적어 둔 것이 다른 날의 것이면 비어 있다. */
function pendingDay(state: OnlineState, day: number | null): Record<string, number> {
  const scores: Record<string, number> = {};
  if (day === null || state.day?.key !== day) return scores;
  for (const game of RANKED_GAMES) {
    const best = state.day.bests[game] ?? 0;
    if (best > (state.day.sent[game] ?? 0)) scores[game] = best;
  }
  return scores;
}

/**
 * 서버에 보내야 할 것. 보낼 것이 없거나 랭킹에 참여하지 않았으면 null.
 * 서버에 올라가 있는 것보다 높아진 최고 점수와, 바뀐 닉네임을 보낸다.
 * week(지금의 랭킹 주)를 주면 그 주에 낸 점수 가운데 올리지 않은 것도 같이 보낸다.
 * day(지금의 랭킹 날)를 주면 그날의 판에서 낸 점수 가운데 올리지 않은 것도 같이 보낸다.
 */
export function pendingSubmit(
  state: OnlineState,
  games: Bests,
  week: string | null = null,
  day: number | null = null,
): SubmitRequest | null {
  if (!isJoined(state)) return null;
  const scores: Record<string, number> = {};
  for (const game of RANKED_GAMES) {
    const best = cleanScore(games[game]?.best ?? 0);
    if (best !== null && best > (state.sent[game] ?? 0)) scores[game] = best;
  }
  const weekScores = pendingWeek(state, week);
  const hasWeek = week !== null && Object.keys(weekScores).length > 0;
  const dayScores = pendingDay(state, day);
  const hasDay = day !== null && Object.keys(dayScores).length > 0;
  if (Object.keys(scores).length === 0 && !hasWeek && !hasDay && state.sentName === state.name) return null;
  const request: SubmitRequest = { device: state.id, name: state.name, scores };
  if (hasWeek) request.weekly = { week, scores: weekScores };
  if (hasDay) request.daily = { day, scores: dayScores };
  return request;
}

/** 이 게임의 최고 점수가 서버에 아직 올라가지 않았는지. 랭킹에 참여하지 않았으면 false다. */
export function isWaitingToSend(state: OnlineState, games: Bests, game: string): boolean {
  return pendingSubmit(state, games)?.scores[game] !== undefined;
}

/** 이 게임에서 이번 주(week)에 낸 점수가 서버에 아직 올라가지 않았는지. 랭킹에 참여하지 않았으면 false다. */
export function isWaitingToSendWeek(state: OnlineState, game: string, week: string): boolean {
  return isJoined(state) && pendingWeek(state, week)[game] !== undefined;
}

/** 이 게임의 오늘(day)의 판 점수가 서버에 아직 올라가지 않았는지. 랭킹에 참여하지 않았으면 false다. */
export function isWaitingToSendDay(state: OnlineState, game: string, day: number): boolean {
  return isJoined(state) && pendingDay(state, day)[game] !== undefined;
}

/** 이 게임의 오늘(day)의 판에서 낸 가장 높은 점수. 없으면 0. */
export function dayBestOf(state: OnlineState, game: string, day: number): number {
  return state.day?.key === day ? (state.day.bests[game] ?? 0) : 0;
}

/** 이 게임에서 이번 주(week)에 낸 가장 높은 점수. 없으면 0. */
export function weekBestOf(state: OnlineState, game: string, week: string): number {
  return state.week?.key === week ? (state.week.bests[game] ?? 0) : 0;
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
  // 이번 주의 점수는 서버가 받았든(이번 주) 버렸든(주가 이미 바뀜) 다시 보낼 까닭이 없으니 보낸 것으로 적는다.
  let week = state.week;
  if (week && request.weekly && week.key === request.weekly.week) {
    const weekSent = { ...week.sent };
    for (const [game, score] of Object.entries(request.weekly.scores)) {
      weekSent[game] = Math.max(weekSent[game] ?? 0, score);
    }
    week = { ...week, sent: weekSent };
  }
  // 오늘의 점수도 마찬가지다.
  let day = state.day;
  if (day && request.daily && day.key === request.daily.day) {
    const daySent = { ...day.sent };
    for (const [game, score] of Object.entries(request.daily.scores)) {
      daySent[game] = Math.max(daySent[game] ?? 0, score);
    }
    day = { ...day, sent: daySent };
  }
  return { ...state, sentName: request.name, sent, week, day };
}
