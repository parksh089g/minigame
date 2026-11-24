/**
 * 친구와 함께하는 방을 SQLite에 넣고 꺼낸다. 방의 규칙은 src/versus/room.ts에 있고, 여기서는 저장과 열쇠 확인만 한다.
 * 판은 서버가 들고 있고 각자에게는 자기 자리에서 보이는 것만 보낸다. 그래서 요청을 꾸며도 상대의 패를 볼 수 없고,
 * 차례가 아닐 때 두거나 규칙에 없는 수를 두는 것도 서버가 받지 않는다.
 * SQL을 실행해 주는 것만 밖에서 받으므로 테스트에서는 Node의 SQLite로 돌린다.
 */
import { TURN_GAMES } from '../src/versus/games';
import {
  ROOM_IDLE_MS,
  roomCodeFrom,
  seatTokenFrom,
  type MoveResult,
  type RoomGame,
  type RoomTicket,
  type RoomView,
  type Seat,
} from '../src/versus/protocol';
import {
  askAgain,
  createRoom,
  dropAwayFoe,
  joinRoom,
  leaveRoom,
  markSeen,
  playMove,
  roomView,
  tickRoom,
  type RoomState,
} from '../src/versus/room';
import type { SqlRunner } from './board-db';

/** 한꺼번에 열려 있을 수 있는 방의 수. 넘으면 새로 만들지 않는다. */
export const MAX_ROOMS = 500;

const SCHEMA = [
  // 방 하나에 한 줄. state는 versus/room.ts의 RoomState를 JSON으로 적은 것이고, tokens는 자리마다의 열쇠다(쉼표로 이음).
  `CREATE TABLE IF NOT EXISTS rooms (
     code TEXT NOT NULL PRIMARY KEY,
     state TEXT NOT NULL,
     tokens TEXT NOT NULL,
     expires INTEGER NOT NULL
   ) WITHOUT ROWID`,
] as const;

/** 무작위 바이트를 채워 주는 함수. 코드와 열쇠는 예측할 수 없어야 한다. */
export type RandomBytes = (length: number) => Uint8Array;

interface Row {
  room: RoomState;
  tokens: [string, string | null];
}

export class RoomDb {
  constructor(private readonly sql: SqlRunner) {
    for (const statement of SCHEMA) sql.exec(statement);
  }

  private load(code: string, now: number): Row | null {
    const rows = this.sql
      .exec<{ state: string; tokens: string }>('SELECT state, tokens FROM rooms WHERE code = ? AND expires > ?', code, now)
      .toArray();
    const row = rows[0];
    if (!row) return null;
    try {
      const [first, second] = row.tokens.split(',');
      return { room: JSON.parse(row.state) as RoomState, tokens: [first, second || null] };
    } catch {
      return null;
    }
  }

  /** 방이 바뀐 것은 아니고 누가 언제 왔는지(마감 시각 같은 보이지 않는 것)만 적는다. 방이 사라지는 시각은 그대로 둔다. */
  private touch(code: string, row: Row): void {
    this.sql.exec('UPDATE rooms SET state = ? WHERE code = ?', JSON.stringify(row.room), code);
  }

  /**
   * seat에서 요청이 왔다: 본 시각을 적고, 시간이 지나 정리할 것을 정리한다.
   * 마감이 지나 게임이 대신 둔 수(원카드를 외치지 못함)가 있거나, 상대가 너무 오래 자리를 비워 판을 버린 것으로 쳤으면
   * 방이 바뀐 것이니 저장한다. 그 밖에는 본 시각만 가끔 적는다.
   */
  private arrive(code: string, row: Row, seat: Seat, now: number): void {
    const before = row.room.version;
    const seen = markSeen(row.room, seat, now);
    const rules = TURN_GAMES[row.room.game];
    const quiet = JSON.stringify(row.room.round);
    tickRoom(row.room, rules, now);
    dropAwayFoe(row.room, seat, now);
    if (row.room.version !== before) this.save(code, row, now);
    else if (seen || JSON.stringify(row.room.round) !== quiet) this.touch(code, row);
  }

  private save(code: string, row: Row, now: number): void {
    this.sql.exec(
      'UPDATE rooms SET state = ?, tokens = ?, expires = ? WHERE code = ?',
      JSON.stringify(row.room),
      row.tokens.filter((token) => token !== null).join(','),
      now + ROOM_IDLE_MS,
      code,
    );
  }

  /** 열쇠로 자리를 찾는다. 이 방의 열쇠가 아니면 null */
  private seatOf(row: Row, token: string): Seat | null {
    if (row.tokens[0] === token) return 0;
    if (row.tokens[1] === token) return 1;
    return null;
  }

  private view(row: Row, seat: Seat, code: string, now: number): RoomView {
    return roomView(row.room, TURN_GAMES[row.room.game], seat, code, now);
  }

  /** 방을 만들고 0번 자리에 앉는다. 방이 너무 많이 열려 있으면 null */
  create(game: RoomGame, name: string, now: number, randomBytes: RandomBytes, id: string | null = null): RoomTicket | null {
    this.sql.exec('DELETE FROM rooms WHERE expires <= ?', now);
    const open = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM rooms').toArray()[0]?.n ?? 0;
    if (open >= MAX_ROOMS) return null;
    const room = createRoom(game, name, id);
    markSeen(room, 0, now);
    const token = seatTokenFrom(randomBytes(16));
    // 코드가 겹칠 일은 거의 없지만, 겹치면 다시 뽑는다.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = roomCodeFrom(randomBytes(6));
      const taken = this.sql.exec<{ code: string }>('SELECT code FROM rooms WHERE code = ?', code).toArray();
      if (taken.length > 0) continue;
      this.sql.exec(
        'INSERT INTO rooms (code, state, tokens, expires) VALUES (?, ?, ?, ?)',
        code,
        JSON.stringify(room),
        token,
        now + ROOM_IDLE_MS,
      );
      return { token, room: roomView(room, TURN_GAMES[game], 0, code, now) };
    }
    return null;
  }

  /** 코드로 기다리는 방에 들어가 1번 자리에 앉는다. 그런 방이 없거나 이미 둘이 찼으면 null */
  join(code: string, name: string, now: number, randomBytes: RandomBytes, random: () => number, id: string | null = null): RoomTicket | null {
    const row = this.load(code, now);
    if (!row || row.tokens[1] !== null) return null;
    if (!joinRoom(row.room, TURN_GAMES[row.room.game], name, random, now, id)) return null;
    const token = seatTokenFrom(randomBytes(16));
    row.tokens[1] = token;
    this.save(code, row, now);
    return { token, room: this.view(row, 1, code, now) };
  }

  /** 내 자리에서 본 방. 방이 없거나(시간이 지났거나) 열쇠가 맞지 않으면 null */
  look(code: string, token: string, now: number): RoomView | null {
    const row = this.load(code, now);
    const seat = row && this.seatOf(row, token);
    if (!row || seat === null) return null;
    this.arrive(code, row, seat, now);
    return this.view(row, seat, code, now);
  }

  /**
   * 수를 둔다. version은 앱이 마지막으로 본 방의 번호다. 그사이 방이 바뀌었으면(같은 수를 두 번 보냈거나 늦게 온 수)
   * 두지 않는다. 방이 없거나 열쇠가 맞지 않으면 null
   */
  move(code: string, token: string, version: number, raw: unknown, now: number): MoveResult | null {
    const row = this.load(code, now);
    const seat = row && this.seatOf(row, token);
    if (!row || seat === null) return null;
    // 마감이 지나 정리된 것이 있으면 방의 번호가 올라서, 그 전에 본 판에 둔 수는 받지 않는다.
    this.arrive(code, row, seat, now);
    const rules = TURN_GAMES[row.room.game];
    const move = rules.readMove(raw);
    const ok = move !== null && row.room.version === version && playMove(row.room, rules, seat, move, now);
    if (ok) this.save(code, row, now);
    return { ok, room: this.view(row, seat, code, now) };
  }

  /** 판이 끝난 뒤 "한 판 더"를 누른다. 둘 다 누르면 새 판이 시작된다. 누가 나가서 닫힌 방이면 다시 연다(room.ts의 askAgain). */
  again(code: string, token: string, now: number, random: () => number): RoomView | null {
    const row = this.load(code, now);
    const seat = row && this.seatOf(row, token);
    if (!row || seat === null) return null;
    this.arrive(code, row, seat, now);
    if (askAgain(row.room, TURN_GAMES[row.room.game], seat, random, now)) this.save(code, row, now);
    return this.view(row, seat, code, now);
  }

  /**
   * 방을 나간다. 남은 사람은 "친구가 나갔어요"를 보게 된다. 방은 시간이 지나면 지워진다.
   * 상대가 자리를 비운 사이에 나가는 것이면 자리를 비운 상대가 판을 버린 것으로 친다.
   */
  leave(code: string, token: string, now: number): boolean {
    const row = this.load(code, now);
    const seat = row && this.seatOf(row, token);
    if (!row || seat === null) return false;
    this.arrive(code, row, seat, now);
    leaveRoom(row.room, seat, now);
    this.save(code, row, now);
    return true;
  }
}
