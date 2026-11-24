/**
 * 친구와 함께하는 카드 게임(차례제)에서 앱과 서버가 함께 쓰는 약속: 방 코드, 자리 열쇠, 방의 모습.
 * 브라우저에도 서버에도 기대지 않는 순수한 값과 함수만 둔다. 서버는 앱이 보낸 것을 여기 있는 함수로 다시 확인한다.
 */
import { CODE_ALPHABET } from '../online/protocol';

/** 친구와 함께할 수 있는 게임의 id. versus/games.ts에 규칙이 있어야 한다(games.test.ts가 확인한다). */
export const ROOM_GAMES = ['hula', 'one-card', 'blackjack', 'high-low', 'poker', 'omok'] as const;
export type RoomGame = (typeof ROOM_GAMES)[number];

export function isRoomGame(value: unknown): value is RoomGame {
  return typeof value === 'string' && (ROOM_GAMES as readonly string[]).includes(value);
}

/** 두 사람의 자리. 0이 방을 만든 사람, 1이 코드로 들어온 사람이다. */
export type Seat = 0 | 1;
export const SEATS: readonly Seat[] = [0, 1];
export const otherSeat = (seat: Seat): Seat => (seat === 0 ? 1 : 0);

// ------------------------------------------------------------ 방 코드와 자리 열쇠

/** 방 코드의 길이. 옮기기 코드(8자)와 같은 글자들로, 친구에게 말로 불러 주기 쉽게 짧게 한다. */
export const ROOM_CODE_LENGTH = 6;

/** 무작위 바이트로 방 코드를 만든다. */
export function roomCodeFrom(bytes: Uint8Array): string {
  let code = '';
  for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
    code += CODE_ALPHABET[(bytes[index] ?? 0) % CODE_ALPHABET.length];
  }
  return code;
}

/** 사람이 친 방 코드를 다듬는다. 소문자, 띄어쓰기, 붙임표는 봐준다. 코드가 아니면 null. */
export function cleanRoomCode(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > ROOM_CODE_LENGTH * 4) return null;
  const code = raw.toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== ROOM_CODE_LENGTH) return null;
  for (const letter of code) if (!CODE_ALPHABET.includes(letter)) return null;
  return code;
}

/** 읽기 쉽게 세 글자씩 끊는다: ABC-DEF */
export function formatRoomCode(code: string): string {
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

/**
 * 자리 열쇠: 방에 들어간 사람만 받는 무작위 값. 이것을 아는 쪽만 그 자리로 수를 두고 자기 패를 볼 수 있다.
 * 방 코드는 친구에게 보내는 것이라 남이 알 수도 있어서, 수를 둘 때는 코드가 아니라 이 열쇠로 확인한다.
 */
const SEAT_TOKEN = /^[0-9a-f]{32}$/;

export function isSeatToken(value: unknown): value is string {
  return typeof value === 'string' && SEAT_TOKEN.test(value);
}

export function seatTokenFrom(bytes: Uint8Array): string {
  return Array.from(bytes.slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** 아무도 두지 않고 이만큼 지나면 방이 사라진다. */
export const ROOM_IDLE_MS = 30 * 60 * 1000;
/**
 * 앱은 방에 있는 동안 몇 초마다 소식을 묻는다(match.ts의 POLL_MS). 한 자리에서 이만큼 아무 요청도 없으면
 * 앱을 닫았거나 다른 앱으로 갔다고 보고, 남은 사람에게 "자리를 비웠어요"와 남은 시간을 보여 준다.
 * 내 차례일 때 묻는 간격(8초)보다 넉넉히 길게 둔다.
 */
export const AWAY_AFTER_MS = 20 * 1000;
/** 한 자리에서 이만큼 아무 요청도 없으면 그 자리가 판을 버린 것으로 친다(남은 사람이 이긴다). */
export const FORFEIT_AFTER_MS = 60 * 1000;
/** 한 수로 받는 가장 큰 크기(글자 수). 카드 몇 장을 적는 정도라 작게 둔다. */
export const MAX_MOVE_CHARS = 400;

// ------------------------------------------------------------ 방의 모습

/**
 * 방의 지금 상태.
 * waiting: 친구를 기다림, playing: 판을 하는 중, over: 판이 끝나 "한 판 더"를 기다림,
 * closed: 누군가 나갔거나 방이 사라짐(더 둘 수 없다).
 */
export type RoomStatus = 'waiting' | 'playing' | 'over' | 'closed';

/** 한 자리에서 본 방. 상대의 패처럼 이 자리가 보면 안 되는 것은 게임의 view가 이미 가렸다. */
export interface RoomView<V = unknown> {
  code: string;
  /** 이 모습을 보는 자리 */
  seat: Seat;
  status: RoomStatus;
  /** 방이 바뀔 때마다 1씩 오른다. 앱은 이것으로 새 소식이 있는지 가린다. */
  version: number;
  /** 자리마다의 이름. 아직 아무도 없는 자리는 null */
  names: [string, string | null];
  /** 자리마다 이긴 판 수 */
  wins: [number, number];
  /** 판이 끝난 뒤 "한 판 더"를 누른 자리 */
  again: [boolean, boolean];
  /** 방을 나간 자리. 아무도 안 나갔으면 null */
  left: Seat | null;
  /** left가 스스로 나간 것이 아니라 자리를 오래 비워서 판을 버린 것으로 쳤으면 true */
  dropped: boolean;
  /** 상대가 자리를 비웠으면 상대가 판을 버린 것으로 치기까지 남은 시간(ms). 상대가 있으면 null */
  away: number | null;
  /** 게임이 이 자리에 보여 주는 판. 친구를 기다리는 동안에는 null */
  game: V | null;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isSeat = (value: unknown): value is Seat => value === 0 || value === 1;
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;
const STATUSES: readonly RoomStatus[] = ['waiting', 'playing', 'over', 'closed'];

/** 서버가 보낸 방의 모습을 확인하며 읽는다. 게임의 판(game)은 그 게임의 readView가 따로 확인한다. */
export function readRoomView<V>(raw: unknown, readGame: (value: unknown) => V | null): RoomView<V> | null {
  if (!isObject(raw)) return null;
  const { code, seat, status, version, names, wins, again, left, dropped, away, game } = raw;
  if (typeof code !== 'string' || !isSeat(seat) || !STATUSES.includes(status as RoomStatus) || !isCount(version)) return null;
  if (!Array.isArray(names) || names.length !== 2 || typeof names[0] !== 'string') return null;
  if (names[1] !== null && typeof names[1] !== 'string') return null;
  if (!Array.isArray(wins) || wins.length !== 2 || !wins.every(isCount)) return null;
  if (!Array.isArray(again) || again.length !== 2 || !again.every((v) => typeof v === 'boolean')) return null;
  if (left !== null && !isSeat(left)) return null;
  // dropped와 away는 나중에 더한 것이라, 없으면(예전 서버) 비우지 않은 것으로 읽는다.
  if (dropped !== undefined && typeof dropped !== 'boolean') return null;
  if (away !== undefined && away !== null && !(typeof away === 'number' && Number.isFinite(away) && away >= 0)) return null;
  let board: V | null = null;
  if (game !== null) {
    board = readGame(game);
    if (board === null) return null;
  }
  return {
    code,
    seat,
    status: status as RoomStatus,
    version,
    names: [names[0], names[1] as string | null],
    wins: [wins[0], wins[1]],
    again: [again[0], again[1]],
    left,
    dropped: dropped === true,
    away: typeof away === 'number' ? away : null,
    game: board,
  };
}

/** 방을 만들거나 들어갔을 때의 답: 내 자리와 그 자리의 열쇠, 그리고 방의 모습 */
export interface RoomTicket<V = unknown> {
  token: string;
  room: RoomView<V>;
}

/** 수를 둔 답. 받아들이지 않았으면(차례가 아니거나 둘 수 없는 수) ok가 false이고, 그때도 지금 방의 모습이 온다. */
export interface MoveResult<V = unknown> {
  ok: boolean;
  room: RoomView<V>;
}
