/**
 * 친구와 하기에서 기기에 적어 두는 것: 친구 화면에 보일 내 이름과, 게임마다 온라인으로 이기고 진 판 수.
 * 훌라는 자기 저장소(hula/store.ts)에 따로 적는다. 여기는 그 뒤에 친구와 하기가 붙은 게임들이 함께 쓴다.
 */
import { cleanName } from '../online/protocol';

export interface FriendRecord {
  wins: number;
  losses: number;
}

interface Saved {
  name: string | null;
  records: Record<string, FriendRecord>;
}

const KEY = 'pocket-arcade:friends';

const count = (value: unknown): number => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0);

/** 적어 둔 것을 믿을 수 있는 모양으로 읽는다. */
export function readFriendSave(raw: unknown): Saved {
  const saved: Saved = { name: null, records: {} };
  if (typeof raw !== 'object' || raw === null) return saved;
  const value = raw as { name?: unknown; records?: unknown };
  if (typeof value.name === 'string') saved.name = cleanName(value.name);
  if (typeof value.records === 'object' && value.records !== null) {
    for (const [game, record] of Object.entries(value.records as Record<string, unknown>)) {
      if (typeof record !== 'object' || record === null) continue;
      const { wins, losses } = record as { wins?: unknown; losses?: unknown };
      saved.records[game] = { wins: count(wins), losses: count(losses) };
    }
  }
  return saved;
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

export const friendStore = {
  name(): string | null {
    return read().name;
  },
  setName(name: string): void {
    write({ ...read(), name });
  },
  record(game: string): FriendRecord {
    return read().records[game] ?? { wins: 0, losses: 0 };
  },
  /** 온라인 판 하나의 결과. 비긴 판(null)은 세지 않는다. */
  addResult(game: string, won: boolean | null): void {
    if (won === null) return;
    const saved = read();
    const record = saved.records[game] ?? { wins: 0, losses: 0 };
    saved.records[game] = won ? { ...record, wins: record.wins + 1 } : { ...record, losses: record.losses + 1 };
    write(saved);
  },
};
