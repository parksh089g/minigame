/**
 * 들어가 있는 온라인 방을 기기에 적어 둔다. 친구에게 코드를 보내려고 메신저로 넘어간 사이에 앱이 다시 열려도
 * 그 방으로 돌아갈 수 있게 한다. 방은 아무도 두지 않고 30분이 지나면 서버에서 사라지므로 그보다 오래된 것은 버린다.
 */
import { cleanRoomCode, isRoomGame, isSeatToken, ROOM_IDLE_MS, type RoomGame } from './protocol';

export interface SavedRoom {
  game: RoomGame;
  code: string;
  token: string;
  /** 마지막으로 적은 시각(ms) */
  at: number;
}

const KEY = 'pocket-arcade:room';

/** 적어 둔 것을 믿을 수 있는 모양으로 읽는다. 맞지 않거나 오래됐으면 null */
export function readSavedRoom(raw: unknown, now: number): SavedRoom | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const code = cleanRoomCode(value.code);
  if (!isRoomGame(value.game) || code === null || !isSeatToken(value.token)) return null;
  if (typeof value.at !== 'number' || !(now - value.at < ROOM_IDLE_MS) || value.at > now + 60_000) return null;
  return { game: value.game, code, token: value.token, at: value.at };
}

export const savedRoom = {
  /** 이 게임으로 들어가 있던 방. 없으면 null */
  get(game: RoomGame, now = Date.now()): SavedRoom | null {
    try {
      const text = localStorage.getItem(KEY);
      const saved = readSavedRoom(text ? JSON.parse(text) : null, now);
      return saved && saved.game === game ? saved : null;
    } catch {
      return null;
    }
  },
  set(game: RoomGame, code: string, token: string, now = Date.now()): void {
    try {
      localStorage.setItem(KEY, JSON.stringify({ game, code, token, at: now } satisfies SavedRoom));
    } catch {
      // 적을 곳이 없으면 앱을 다시 열었을 때 돌아가지 못할 뿐이다.
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(KEY);
    } catch {
      // 지울 수 없으면 30분 뒤에 저절로 버려진다.
    }
  },
};
