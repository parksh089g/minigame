/**
 * 온라인 기능(랭킹, 기기 옮기기)에서 앱과 서버가 함께 쓰는 약속.
 * 브라우저에도 서버(Cloudflare Workers)에도 기대지 않는 순수한 값과 함수만 둔다.
 * 서버는 앱이 보낸 것을 믿지 않고 여기 있는 함수로 다시 확인한다.
 */

/**
 * 랭킹이 있는 게임의 id. games/registry.ts의 목록에서 승패로 끝나는 게임(versus)을 뺀 것과 같아야 한다
 * (protocol.test.ts가 확인한다). 이어지는 성장 게임(새싹 컴퍼니)은 평판을 점수로 올린다.
 */
export const RANKED_GAMES = [
  'lightning-tap',
  'memory-cards',
  'jump-runner',
  'stack-tower',
  'color-sort',
  'gate-run',
  'pin-pull',
  'parking-out',
  'screw-sort',
  'merge-tiles',
  'tail-chase',
  'logic-tiles',
  'nemo-logic',
  'number-puzzle',
  'path-link',
  'block-fill',
  'chosung-quiz',
  'lantern-keeper',
  'sprout-company',
  'match-three',
  'box-push',
  'brick-break',
  'candy-slot',
  'garden-guard',
  'cloud-tower',
  'solitaire',
  'one-card',
] as const;

export type RankedGame = (typeof RANKED_GAMES)[number];

export function isRankedGame(value: unknown): value is RankedGame {
  return typeof value === 'string' && (RANKED_GAMES as readonly string[]).includes(value);
}

// ------------------------------------------------------------ 닉네임

export const NAME_MIN = 2;
export const NAME_MAX = 10;

/**
 * 닉네임을 다듬는다. 쓸 수 없는 닉네임이면 null.
 * 글자와 숫자, 띄어쓰기, 밑줄, 붙임표만 받고 글자 수(2~10자)를 센다. 그림 문자와 겹쳐 쓰는 기호는 받지 않는다.
 * 한글 채움 문자(U+3164 등)처럼 글자로 분류되지만 눈에 보이지 않는 것도 받지 않는다. 랭킹에 빈 줄로 보이기 때문이다.
 */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > NAME_MAX * 8) return null;
  const name = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
  const length = [...name].length;
  if (length < NAME_MIN || length > NAME_MAX) return null;
  if (!/^[\p{L}\p{N} _-]+$/u.test(name)) return null;
  if (/\p{Default_Ignorable_Code_Point}/u.test(name)) return null;
  return name;
}

// ------------------------------------------------------------ 기기 id와 점수

const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * 기기 id는 앱이 닉네임을 처음 정할 때 무작위로 만든 값이다. 사람이나 기기를 알아볼 수 있는 정보는 들어 있지 않다.
 * 이 값을 아는 쪽만 그 줄의 점수와 닉네임을 바꿀 수 있으므로, 서버는 이 값을 다른 사람에게 돌려주지 않는다.
 */
export function isDeviceId(value: unknown): value is string {
  return typeof value === 'string' && DEVICE_ID.test(value);
}

/** 무작위 16바이트로 기기 id를 만든다. */
export function deviceIdFrom(bytes: Uint8Array): string {
  const hex = Array.from(bytes.slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** 랭킹에 올릴 수 있는 가장 큰 점수. 터무니없는 값을 걸러 내는 용도일 뿐, 속임수를 막아 주지는 못한다. */
export const MAX_SCORE = 999_999;

/** 랭킹에 올릴 수 있는 점수(1 이상의 정수)로 다듬는다. 올릴 수 없으면 null. */
export function cleanScore(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  const score = Math.floor(raw);
  return score >= 1 && score <= MAX_SCORE ? score : null;
}

// ------------------------------------------------------------ 랭킹

/** 랭킹 화면에 보여 주는 줄 수 */
export const TOP_COUNT = 30;
/** 내 순위는 여기까지만 센다. 그 밖이면 "500위 밖"으로 보여 준다. */
export const RANK_SCAN = 500;

export interface RankRow {
  rank: number;
  name: string;
  score: number;
  /** 물어본 기기의 줄인지 */
  mine: boolean;
}

export interface RankBoard {
  top: RankRow[];
  /** 물어본 기기의 기록. 없으면 null. rank가 RANK_SCAN보다 크면 그 밖이라는 뜻이다. */
  me: { rank: number; score: number; name: string } | null;
  /** 이번 주 랭킹일 때만 온다: 서버가 보는 이번 주(rankWeekOf). 전체 랭킹에는 없다. */
  week?: string;
  /** 오늘의 랭킹일 때만 온다: 서버가 보는 오늘(rankDayOf) */
  day?: number;
}

/**
 * 주간 랭킹이 없는 게임. 점수가 판마다 새로 나지 않고 계속 쌓이는 게임(새싹 컴퍼니의 평판)은
 * 이번 주에 낸 기록을 따로 가릴 수 없어서, 주간 랭킹에 올리면 오래 한 사람이 늘 위에 선다.
 * games/registry.ts에서 ongoing인 게임과 같아야 한다(protocol.test.ts가 확인한다).
 */
const NO_WEEKLY_BOARD: readonly string[] = ['sprout-company'] satisfies readonly RankedGame[];

/** 이 게임에 주간 랭킹이 있는지. 랭킹이 없는 게임이면 false다. */
export function hasWeeklyBoard(game: unknown): game is RankedGame {
  return isRankedGame(game) && !NO_WEEKLY_BOARD.includes(game);
}

/** 랭킹의 범위. all은 지금까지의 최고 기록, week는 이번 주에 낸 기록만 겨룬다. */
export const RANK_SPANS = ['all', 'week'] as const;
export type RankSpan = (typeof RANK_SPANS)[number];

export function isRankSpan(value: unknown): value is RankSpan {
  return typeof value === 'string' && (RANK_SPANS as readonly string[]).includes(value);
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** 주간 랭킹은 한국 시각(UTC+9)으로 월요일 0시에 새로 시작한다. */
const RANK_ZONE_MS = 9 * 60 * 60 * 1000;

/**
 * 그 시각이 속한 랭킹 주가 시작된 때(ms): 한국 시각으로 그 주 월요일 0시.
 * 일주일(7일)을 더하면 다음 주가 시작되는 때다. 한국에는 서머타임이 없어서 한 주는 늘 7일이다.
 */
export function rankWeekStart(now: number): number {
  const day = Math.floor((now + RANK_ZONE_MS) / DAY_MS);
  // 1970년 1월 1일은 목요일이다. 월요일에서 며칠 지났는지를 빼면 그 주의 월요일이 된다.
  const monday = day - ((((day + 3) % 7) + 7) % 7);
  return monday * DAY_MS - RANK_ZONE_MS;
}

/** 랭킹 주 하나의 길이(ms) */
export const RANK_WEEK_MS = 7 * DAY_MS;

/**
 * 그 시각이 속한 랭킹 주의 이름: 그 주 월요일의 날짜(YYYY-MM-DD, 한국 시각).
 * 어느 주인지는 서버가 정한다. 앱도 같은 함수로 셈해서 보내지만, 서버의 주와 다르면 서버는 받지 않는다.
 * 주간 미션(core/weekly.ts)의 주는 기기의 시각을 따르므로 나라에 따라 몇 시간 어긋날 수 있다.
 */
export function rankWeekOf(now: number): string {
  return new Date(rankWeekStart(now) + RANK_ZONE_MS).toISOString().slice(0, 10);
}

const RANK_WEEK = /^\d{4}-\d{2}-\d{2}$/;

/** 랭킹 주의 이름처럼 생겼는지. 실제로 있는 주인지는 서버의 지금 주와 견주어 가린다. */
export function isRankWeek(value: unknown): value is string {
  return typeof value === 'string' && RANK_WEEK.test(value);
}

/**
 * 그 시각이 며칠째인지(한국 시각, 1970년 1월 1일이 0). 한국 시각으로 0시에 하루가 넘어간다.
 * 오늘의 랭킹은 이 날마다 새로 시작한다. 주간 랭킹처럼 어느 날인지는 서버가 정하고,
 * 앱도 같은 함수로 셈해서 보내지만 서버의 날과 다르면 서버는 받지 않는다.
 */
export function rankDayOf(now: number): number {
  return Math.floor((now + RANK_ZONE_MS) / DAY_MS);
}

/** 그 날(rankDayOf)이 시작된 때(ms): 한국 시각으로 그날 0시. 하루를 더하면 다음 날이 시작되는 때다. */
export function rankDayStart(day: number): number {
  return day * DAY_MS - RANK_ZONE_MS;
}

/** 랭킹의 날처럼 생겼는지(0보다 큰 정수). 실제로 오늘인지는 서버의 오늘과 견주어 가린다. */
export function isRankDay(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 1_000_000;
}

/**
 * 오늘의 랭킹이 있는 게임: 날마다 누구나 같은 조건으로 겨루는 판(등불지기, 행운 슬롯, 텃밭 지키기, 솔리테어의 오늘의 판)이 있는 게임이다.
 * 그 판에서 낸 점수만 올라가고, 날이 바뀌면 비운다. 게임마다 그날의 판을 정하는 날(각 게임 daily.ts의 dayIndexOf)은
 * rankDayOf와 같아야 한다. 다르면 그날의 판이 아닌 판의 점수가 그날의 랭킹에 섞인다.
 */
const DAILY_BOARD: readonly string[] = ['lantern-keeper', 'candy-slot', 'garden-guard', 'solitaire'] satisfies readonly RankedGame[];

/** 이 게임에 오늘의 랭킹이 있는지. 랭킹이 없는 게임이면 false다. */
export function hasDailyBoard(game: unknown): game is RankedGame {
  return isRankedGame(game) && DAILY_BOARD.includes(game);
}

/** 오늘의 랭킹이 있는 게임들. RANKED_GAMES의 차례 그대로다. */
export const DAILY_GAMES: readonly RankedGame[] = RANKED_GAMES.filter(hasDailyBoard);

/**
 * 한 기기가 올라 있는 게임마다의 순위와 점수(게임 id → 기록). 올라 있지 않은 게임은 들어 있지 않다.
 * rank가 RANK_SCAN보다 크면 그 밖이라는 뜻이다.
 */
export type Standings = Record<string, { rank: number; score: number }>;

/** 한 주 동안 낸 점수 묶음 */
export interface WeekScores {
  /** 이 점수를 낸 주(rankWeekOf) */
  week: string;
  /** 게임 id → 그 주에 낸 가장 높은 점수 */
  scores: Record<string, number>;
}

/** 하루 동안 오늘의 판에서 낸 점수 묶음 */
export interface DayScores {
  /** 이 점수를 낸 날(rankDayOf) */
  day: number;
  /** 게임 id → 그날의 판에서 낸 가장 높은 점수 */
  scores: Record<string, number>;
}

/**
 * 점수 세는 법이 바뀐 게임과, 지금 규칙의 번호(처음 규칙이 1이다).
 * 규칙이 바뀌면 옛 점수와 새 점수를 한 랭킹에서 견줄 수 없다. 그래서 서버는 번호가 오르면 그 게임의 랭킹을 한 번 비우고
 * (worker/board-db.ts), 앱은 그 게임의 점수를 올릴 때 번호를 같이 보낸다(SubmitRequest.rules). 번호가 맞지 않는 점수,
 * 곧 아직 업데이트하지 않은 앱이 옛 규칙으로 낸 점수는 서버가 받지 않는다. 앱의 세이브에 남은 옛 최고 점수는
 * core/save.ts의 SCORE_RESETS가 비운다.
 *
 * - 텃밭 지키기 2: "몇째 날까지 갔는지"가 아니라 "이 판에서 며칠을 지켰는지"를 센다.
 */
export const SCORE_RULES: Readonly<Partial<Record<RankedGame, number>>> = { 'garden-guard': 2 };

/** 점수 묶음에 든 게임 가운데 규칙이 바뀐 게임의 규칙 번호. 그런 게임이 없으면 undefined(아무것도 보내지 않는다). */
export function rulesFor(
  ...scores: ReadonlyArray<Readonly<Record<string, number>> | undefined>
): Record<string, number> | undefined {
  const rules: Record<string, number> = {};
  for (const group of scores) {
    for (const game of Object.keys(group ?? {})) {
      const rule = isRankedGame(game) ? SCORE_RULES[game] : undefined;
      if (rule !== undefined) rules[game] = rule;
    }
  }
  return Object.keys(rules).length > 0 ? rules : undefined;
}

/** 앱이 보낸 규칙 번호(SubmitRequest.rules)로 볼 때, 이 게임의 점수가 지금 규칙으로 낸 것인지 */
export function followsRules(game: RankedGame, rules: unknown): boolean {
  const rule = SCORE_RULES[game];
  if (rule === undefined) return true;
  return typeof rules === 'object' && rules !== null && (rules as Record<string, unknown>)[game] === rule;
}

export interface SubmitRequest {
  device: string;
  name: string;
  /** 게임 id → 그 기기의 최고 점수 */
  scores: Record<string, number>;
  /** 이번 주 랭킹에 올릴 점수. 올릴 것이 없으면 보내지 않는다. 서버의 이번 주와 다른 주의 것은 서버가 버린다. */
  weekly?: WeekScores;
  /** 오늘의 랭킹에 올릴 점수. 올릴 것이 없으면 보내지 않는다. 서버의 오늘과 다른 날의 것은 서버가 버린다. */
  daily?: DayScores;
  /**
   * 게임 id → 이 점수들을 낸 규칙의 번호(SCORE_RULES). 규칙이 바뀐 게임의 점수를 올릴 때만 보낸다.
   * 번호가 없거나 서버의 것과 다르면 서버는 그 게임의 점수만 받지 않는다.
   */
  rules?: Record<string, number>;
}

export interface SubmitResult {
  /** 게임 id → 서버에 남은 최고 점수 */
  bests: Record<string, number>;
  /** 게임 id → 지금 순위 */
  ranks: Record<string, number>;
}

export function rankLabel(rank: number): string {
  return rank > RANK_SCAN ? `${RANK_SCAN}위 밖` : `${rank}위`;
}

// ------------------------------------------------------------ 기기 옮기기

/** 헷갈리는 글자(0, O, 1, I)를 뺀 32자 */
export const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const CODE_LENGTH = 8;
/** 옮기기 코드가 살아 있는 시간 */
export const TRANSFER_TTL_MS = 15 * 60 * 1000;
/** 한 번에 맡길 수 있는 세이브의 크기(글자 수) */
export const MAX_BUNDLE_CHARS = 200_000;

/** 무작위 바이트로 옮기기 코드를 만든다. 32자라 한 바이트에서 고르게 뽑힌다. */
export function codeFrom(bytes: Uint8Array): string {
  let code = '';
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    code += CODE_ALPHABET[(bytes[index] ?? 0) % CODE_ALPHABET.length];
  }
  return code;
}

/** 사람이 친 코드를 다듬는다. 소문자, 띄어쓰기, 붙임표는 봐준다. 코드가 아니면 null. */
export function cleanCode(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > CODE_LENGTH * 4) return null;
  const code = raw.toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== CODE_LENGTH) return null;
  for (const letter of code) if (!CODE_ALPHABET.includes(letter)) return null;
  return code;
}

/** 읽기 쉽게 네 글자씩 끊는다: ABCD-EFGH */
export function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export interface StashResult {
  code: string;
  /** 코드가 사라지는 시각(ms) */
  expiresAt: number;
}

// ------------------------------------------------------------ 오류

/**
 * 서버가 돌려주는 오류.
 * invalid: 보낸 값이 맞지 않음, notfound: 그런 코드가 없음(또는 시간이 지남),
 * slow: 너무 자주 요청함, busy: 서버가 지금 처리할 수 없음(무료 한도를 다 썼을 때도 이렇게 답한다).
 */
export type ApiError = 'invalid' | 'notfound' | 'slow' | 'busy';
