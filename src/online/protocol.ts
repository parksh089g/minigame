/**
 * 온라인 기능(랭킹, 기기 옮기기)에서 앱과 서버가 함께 쓰는 약속.
 * 브라우저에도 서버(Cloudflare Workers)에도 기대지 않는 순수한 값과 함수만 둔다.
 * 서버는 앱이 보낸 것을 믿지 않고 여기 있는 함수로 다시 확인한다.
 */

/** 랭킹이 있는 게임의 id. games/registry.ts의 목록과 같아야 한다(protocol.test.ts가 확인한다). */
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
  'lantern-keeper',
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
 */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > NAME_MAX * 8) return null;
  const name = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
  const length = [...name].length;
  if (length < NAME_MIN || length > NAME_MAX) return null;
  if (!/^[\p{L}\p{N} _-]+$/u.test(name)) return null;
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
}

export interface SubmitRequest {
  device: string;
  name: string;
  /** 게임 id → 그 기기의 최고 점수 */
  scores: Record<string, number>;
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
