/**
 * 친구와 하기에서 기기에 적어 두는 것:
 * - 친구 화면에 보일 내 이름과, 상대 기기가 나를 알아보는 친구 표(protocol.ts의 cleanFriendId)
 * - 게임마다 온라인으로 이기고 진 판 수(훌라는 자기 저장소 hula/store.ts에 따로 적는다)
 * - 친구마다, 게임마다 이기고 진 판 수(친구 전적). 훌라도 여기에 같이 적는다.
 * - 마지막으로 같이 한 친구의 방(다시 하자): 방에서 나온 뒤에도 같은 방 코드로 그 친구를 다시 부를 수 있게 한다.
 *
 * 한 폰으로 번갈아 한 판은 누가 "나"인지 몰라서 세지 않는다.
 * 백업 파일과 기기 옮기기에는 이름, 친구 표, 전적이 실려 간다(다시 하자 방은 그 기기에서만 쓴다).
 */
import { registerSavePart } from '../core/bundle';
import { cleanName } from '../online/protocol';
import {
  cleanFriendId,
  cleanRoomCode,
  friendIdFrom,
  isRoomGame,
  isSeatToken,
  otherSeat,
  ROOM_IDLE_MS,
  type RoomGame,
  type RoomView,
} from './protocol';

export interface FriendRecord {
  wins: number;
  losses: number;
}

/** 친구 한 명의 전적 */
export interface FriendEntry {
  /** 친구 표가 있으면 그것, 없으면(예전 앱) "name:" 뒤에 이름 */
  key: string;
  /** 마지막으로 본 이름 */
  name: string;
  /** 마지막으로 같이 한 시각(ms) */
  at: number;
  /** 게임마다 내가 이기고 진 판 수 */
  games: Record<string, FriendRecord>;
}

interface Saved {
  name: string | null;
  id: string | null;
  records: Record<string, FriendRecord>;
  friends: Record<string, FriendEntry>;
  /** 이미 센 판(방 코드와 판 번호). 앱을 다시 열어 같은 결과를 또 보더라도 두 번 세지 않는다. */
  counted: string[];
}

/** 마지막으로 같이 한 친구의 방 */
export interface Rematch {
  game: RoomGame;
  code: string;
  token: string;
  /** 친구의 이름 */
  foe: string;
  /** 적은 시각(ms) */
  at: number;
}

const KEY = 'pocket-arcade:friends';
const REMATCH_KEY = 'pocket-arcade:rematch';
/** 친구 전적을 몇 명까지 적어 둘지. 넘으면 오래 안 한 친구부터 지운다. */
export const MAX_FRIENDS = 50;
const MAX_COUNTED = 40;

const count = (value: unknown): number => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0);
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function readRecord(raw: unknown): FriendRecord {
  const { wins, losses } = isObject(raw) ? raw : {};
  return { wins: count(wins), losses: count(losses) };
}

/** 적어 둔 것을 믿을 수 있는 모양으로 읽는다. */
export function readFriendSave(raw: unknown): Saved {
  const saved: Saved = { name: null, id: null, records: {}, friends: {}, counted: [] };
  if (!isObject(raw)) return saved;
  if (typeof raw.name === 'string') saved.name = cleanName(raw.name);
  saved.id = cleanFriendId(raw.id);
  if (isObject(raw.records)) {
    for (const [game, record] of Object.entries(raw.records)) {
      if (isObject(record)) saved.records[game] = readRecord(record);
    }
  }
  if (isObject(raw.friends)) {
    for (const [key, entry] of Object.entries(raw.friends)) {
      if (!isObject(entry) || key.length > 40) continue;
      const name = typeof entry.name === 'string' ? cleanName(entry.name) : null;
      if (name === null) continue;
      const games: Record<string, FriendRecord> = {};
      if (isObject(entry.games)) {
        for (const [game, record] of Object.entries(entry.games)) if (isRoomGame(game)) games[game] = readRecord(record);
      }
      saved.friends[key] = { key, name, at: count(entry.at), games };
    }
  }
  if (Array.isArray(raw.counted)) saved.counted = raw.counted.filter((item): item is string => typeof item === 'string').slice(-MAX_COUNTED);
  return saved;
}

/** 친구를 가리키는 열쇠: 친구 표가 있으면 그것, 없으면 이름 */
export function friendKey(id: string | null, name: string): string {
  return id ?? `name:${name}`;
}

/**
 * 끝난 판 하나를 친구 전적에 넣은 새 값. 이미 센 판(key)이면 그대로 돌려준다.
 * won이 null(비김)이면 마지막으로 같이 한 시각만 바꾼다.
 */
export function addFriendRound(
  saved: Saved,
  game: RoomGame,
  foe: { id: string | null; name: string },
  won: boolean | null,
  now: number,
): Saved {
  const key = friendKey(foe.id, foe.name);
  const entry: FriendEntry = saved.friends[key] ? { ...saved.friends[key], games: { ...saved.friends[key].games } } : { key, name: foe.name, at: now, games: {} };
  entry.name = foe.name;
  entry.at = now;
  const record = entry.games[game] ?? { wins: 0, losses: 0 };
  if (won === true) entry.games[game] = { ...record, wins: record.wins + 1 };
  else if (won === false) entry.games[game] = { ...record, losses: record.losses + 1 };
  else entry.games[game] = record;
  const friends = { ...saved.friends, [key]: entry };
  const keys = Object.keys(friends);
  if (keys.length > MAX_FRIENDS) {
    keys.sort((a, b) => friends[a].at - friends[b].at);
    for (const old of keys.slice(0, keys.length - MAX_FRIENDS)) delete friends[old];
  }
  return { ...saved, friends };
}

/** 한 게임을 같이 한 친구들을 최근 순으로 */
export function friendsOf(saved: Saved, game: RoomGame): FriendEntry[] {
  return Object.values(saved.friends)
    .filter((entry) => entry.games[game] !== undefined)
    .sort((a, b) => b.at - a.at);
}

/** 적어 둔 다시 하자 방을 믿을 수 있는 모양으로 읽는다. 맞지 않거나 오래됐으면 null */
export function readRematch(raw: unknown, now: number): Rematch | null {
  if (!isObject(raw)) return null;
  const code = cleanRoomCode(raw.code);
  const foe = typeof raw.foe === 'string' ? cleanName(raw.foe) : null;
  if (!isRoomGame(raw.game) || code === null || !isSeatToken(raw.token) || foe === null) return null;
  if (typeof raw.at !== 'number' || !(now - raw.at < ROOM_IDLE_MS) || raw.at > now + 60_000) return null;
  return { game: raw.game, code, token: raw.token, foe, at: raw.at };
}

function read(): Saved {
  try {
    const text = localStorage.getItem(KEY);
    return readFriendSave(text ? JSON.parse(text) : null);
  } catch {
    return readFriendSave(null);
  }
}

function write(saved: Saved): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // 적을 곳이 없으면 이름을 다음에 다시 물을 뿐이다.
  }
}

/**
 * 방의 판 하나를 가리키는 이름: 방 코드와 그때까지 승부가 난 판 수. 같은 판의 결과를 다시 보거나(앱을 다시 열었을 때,
 * 닫힌 방을 다시 열었을 때) 판을 하다 나가 방이 닫힌 것을 알게 되어도 같은 이름이 나와서 두 번 세지 않는다.
 * ahead는 서버가 아직 세지 않은 판(판을 하다 내가 나가는 때)을 미리 셀 때 1이다.
 */
export const roundKey = (room: Pick<RoomView<unknown>, 'code' | 'wins'>, ahead = 0): string => `${room.code}#${room.wins[0] + room.wins[1] + ahead}`;

export const friendStore = {
  name(): string | null {
    return read().name;
  },
  setName(name: string): void {
    write({ ...read(), name });
  },
  /** 이 기기의 친구 표. 처음 부르면 뽑아서 적어 둔다. */
  id(): string {
    const saved = read();
    if (saved.id) return saved.id;
    const id = friendIdFrom(crypto.getRandomValues(new Uint8Array(8)));
    write({ ...saved, id });
    return id;
  },
  record(game: string): FriendRecord {
    return read().records[game] ?? { wins: 0, losses: 0 };
  },
  /** 온라인 판 하나의 결과(게임마다 합친 것). 비긴 판(null)은 세지 않는다. */
  addResult(game: string, won: boolean | null): void {
    if (won === null) return;
    const saved = read();
    const record = saved.records[game] ?? { wins: 0, losses: 0 };
    saved.records[game] = won ? { ...record, wins: record.wins + 1 } : { ...record, losses: record.losses + 1 };
    write(saved);
  },
  /**
   * 온라인 방의 판 하나가 끝났다: 그 친구의 전적에 넣는다. key(roundKey)로 이미 센 판이면 세지 않고 false.
   * 게임마다 합친 전적은 부르는 쪽이 이것이 true일 때만 따로 넣는다(훌라는 자기 저장소에).
   */
  addFriendResult(game: RoomGame, room: RoomView<unknown>, won: boolean | null, key = roundKey(room), now = Date.now()): boolean {
    const saved = read();
    if (saved.counted.includes(key)) return false;
    const foe = otherSeat(room.seat);
    const name = room.names[foe];
    const next = name ? addFriendRound(saved, game, { id: room.ids[foe], name }, won, now) : saved;
    next.counted = [...saved.counted, key].slice(-MAX_COUNTED);
    write(next);
    return true;
  },
  /** 이 방의 상대와의 이 게임 전적. 처음 만난 친구면 0승 0패 */
  versus(game: RoomGame, room: RoomView<unknown>): FriendRecord {
    const foe = otherSeat(room.seat);
    const name = room.names[foe];
    if (!name) return { wins: 0, losses: 0 };
    return read().friends[friendKey(room.ids[foe], name)]?.games[game] ?? { wins: 0, losses: 0 };
  },
  /** 이 게임을 같이 한 친구들(최근 순) */
  friends(game: RoomGame): FriendEntry[] {
    return friendsOf(read(), game);
  },
  /** 마지막으로 같이 한 친구의 방. 이 게임의 것이 아니거나 오래됐으면 null */
  rematch(game: RoomGame, now = Date.now()): Rematch | null {
    try {
      const text = localStorage.getItem(REMATCH_KEY);
      const saved = readRematch(text ? JSON.parse(text) : null, now);
      return saved && saved.game === game ? saved : null;
    } catch {
      return null;
    }
  },
  setRematch(game: RoomGame, code: string, token: string, foe: string, now = Date.now()): void {
    try {
      localStorage.setItem(REMATCH_KEY, JSON.stringify({ game, code, token, foe, at: now } satisfies Rematch));
    } catch {
      // 적을 곳이 없으면 다시 하자를 보이지 못할 뿐이다.
    }
  },
  clearRematch(): void {
    try {
      localStorage.removeItem(REMATCH_KEY);
    } catch {
      // 지울 수 없으면 30분 뒤에 저절로 버려진다.
    }
  },
};

/** "3승 2패" */
export const recordText = (record: FriendRecord): string => `${record.wins}승 ${record.losses}패`;

registerSavePart('friends', {
  async read() {
    const { name, id, records, friends } = read();
    return { name, id, records, friends };
  },
  async write(raw) {
    if (raw === undefined) return;
    write({ ...readFriendSave(raw), counted: read().counted });
  },
});
