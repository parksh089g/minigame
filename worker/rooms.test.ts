import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { OneCardMatch, OneCardView } from '../src/games/one-card/versus';
import type { RoomState } from '../src/versus/room';
import type { SqlRunner, SqlValue } from './board-db';
import { RoomDb } from './rooms';

function memorySql(): SqlRunner {
  const database = new DatabaseSync(':memory:');
  return {
    exec<T extends Record<string, SqlValue>>(query: string, ...bindings: SqlValue[]) {
      const rows = database.prepare(query).all(...bindings) as T[];
      return { toArray: () => rows };
    },
  };
}

let counter = 0;
const bytes = (length: number): Uint8Array => Uint8Array.from({ length }, (_, index) => (index * 7 + counter++) % 256);
const random = (): number => 0.25;

describe('원카드 방: 원카드 외치기 마감', () => {
  it('외칠 사람이 앱을 내려 두어도, 기다리는 친구가 물을 때 마감이 지났으면 서버가 대신 한 장을 준다', () => {
    const sql = memorySql();
    const rooms = new RoomDb(sql);
    let now = 1_800_000_000_000;
    const host = rooms.create('one-card', '민수', now, bytes)!;
    const code = host.room.code;
    const guest = rooms.join(code, '지원', now, bytes, random)!;
    const tokens = { 0: host.token, 1: guest.token } as const;

    // 둘 차례인 사람의 손을 두 장으로 줄여, 한 장을 내면 원카드를 외쳐야 하게 만든다.
    const row = sql.exec<{ state: string }>('SELECT state FROM rooms WHERE code = ?', code).toArray()[0];
    const room = JSON.parse(row.state) as RoomState<OneCardMatch>;
    const game = room.round!.game;
    const seat = game.turn as 0 | 1;
    const top = game.discard[game.discard.length - 1];
    const same = game.deck.find((card) => card.suit === top.suit && card.rank >= 4 && card.rank <= 6)!;
    game.deck = game.deck.filter((card) => card !== same);
    game.players[seat].hand = [same, game.players[seat].hand[0]];
    sql.exec('UPDATE rooms SET state = ? WHERE code = ?', JSON.stringify(room), code);

    const played = rooms.move(code, tokens[seat], room.version, { type: 'play', card: same.id }, now)!;
    expect(played.ok).toBe(true);
    expect((played.room.game as OneCardView).game.oneCard).toBe(0);

    // 외칠 사람은 아무것도 보내지 않는다(앱을 내려 둠). 기다리는 친구는 2초마다 묻는다.
    const other = seat === 0 ? 1 : 0;
    now += 2000;
    const waiting = rooms.look(code, tokens[other], now)!;
    expect((waiting.game as OneCardView).game.oneCard).toBe(1);
    now += 3000;
    const after = rooms.look(code, tokens[other], now)!;
    expect(after.version).toBe(played.room.version + 1);
    const view = (after.game as OneCardView).game;
    expect(view.oneCard).toBeNull();
    expect(view.players[1].hand).toHaveLength(2);
    expect(view.turn).toBe(0);

    // 돌아와서 늦게 누른 "원카드!"는 받지 않는다.
    const late = rooms.move(code, tokens[seat], played.room.version, { type: 'call' }, now + 1000)!;
    expect(late.ok).toBe(false);
  });
});

describe('친구 표와 다시 하자', () => {
  it('친구 표를 자리마다 싣고, 나간 뒤에도 같은 코드로 다시 열어 새 판을 시작한다', () => {
    const sql = memorySql();
    const rooms = new RoomDb(sql);
    let now = 1_800_000_000_000;
    const host = rooms.create('high-low', '민수', now, bytes, '0123456789abcdef')!;
    const code = host.room.code;
    const guest = rooms.join(code, '지원', now, bytes, random, 'fedcba9876543210')!;
    expect(guest.room.ids).toEqual(['0123456789abcdef', 'fedcba9876543210']);

    // 친구가 나가서 방이 닫힌다. 몇 분 뒤 친구가 친구 고르기 화면에서 같은 방으로 다시 하자고 한다.
    rooms.leave(code, guest.token, now);
    expect(rooms.look(code, host.token, now)!.status).toBe('closed');
    now += 5 * 60 * 1000;
    const asked = rooms.again(code, guest.token, now, random)!;
    expect(asked.status).toBe('over');
    expect(asked.again).toEqual([false, true]);
    // 오래 안 왔던 나도 곧바로 자리를 비운 것으로 치지 않는다.
    expect(asked.away).toBeNull();
    const started = rooms.again(code, host.token, now + 1000, random)!;
    expect(started.status).toBe('playing');
    expect(started.left).toBeNull();
  });
});
