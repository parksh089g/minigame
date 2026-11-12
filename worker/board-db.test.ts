import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  CODE_LENGTH,
  RANK_SCAN,
  RANKED_GAMES,
  TOP_COUNT,
  TRANSFER_TTL_MS,
} from '../src/online/protocol';
import { BoardDb, MAX_TRANSFERS, type SqlRunner, type SqlValue } from './board-db';

/** Durable Object의 SQLite 대신 Node에 들어 있는 SQLite로 같은 SQL을 돌린다. */
function memorySql(): SqlRunner {
  const database = new DatabaseSync(':memory:');
  return {
    exec<T extends Record<string, SqlValue>>(query: string, ...bindings: SqlValue[]) {
      const rows = database.prepare(query).all(...bindings) as T[];
      return { toArray: () => rows };
    },
  };
}

const device = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const GAME = 'lantern-keeper';
const OTHER = 'stack-tower';

/** 차례대로 다른 값을 내는 가짜 무작위 */
function counterBytes(): (length: number) => Uint8Array {
  let next = 0;
  return (length) => {
    const bytes = new Uint8Array(length);
    let value = next;
    next += 1;
    for (let index = length - 1; index >= 0; index -= 1) {
      bytes[index] = value % 32;
      value = Math.floor(value / 32);
    }
    return bytes;
  };
}

describe('랭킹', () => {
  it('아무도 없으면 비어 있다', () => {
    const db = new BoardDb(memorySql());
    expect(db.board(GAME, null)).toEqual({ top: [], me: null });
    expect(db.board(GAME, device(1))).toEqual({ top: [], me: null });
    expect(db.known(device(1))).toBe(false);
  });

  it('점수가 높은 순으로, 같으면 먼저 낸 순으로 늘어놓는다', () => {
    const db = new BoardDb(memorySql());
    db.submit(device(1), '하나', { [GAME]: 500 }, 1000);
    db.submit(device(2), '둘', { [GAME]: 900 }, 2000);
    db.submit(device(3), '셋', { [GAME]: 500 }, 3000);
    const board = db.board(GAME, device(3));
    expect(board.top.map((row) => [row.rank, row.name, row.score, row.mine])).toEqual([
      [1, '둘', 900, false],
      [2, '하나', 500, false],
      [3, '셋', 500, true],
    ]);
    expect(board.me).toEqual({ rank: 3, score: 500, name: '셋' });
  });

  it('올린 뒤의 최고 점수와 순위를 알려 준다', () => {
    const db = new BoardDb(memorySql());
    db.submit(device(1), '하나', { [GAME]: 500 }, 1000);
    const result = db.submit(device(2), '둘', { [GAME]: 300, [OTHER]: 70 }, 2000);
    expect(result).toEqual({ bests: { [GAME]: 300, [OTHER]: 70 }, ranks: { [GAME]: 2, [OTHER]: 1 } });
  });

  it('더 낮은 점수를 올려도 최고 점수와 순서는 그대로다', () => {
    const db = new BoardDb(memorySql());
    db.submit(device(1), '하나', { [GAME]: 500 }, 1000);
    db.submit(device(2), '둘', { [GAME]: 500 }, 2000);
    // 먼저 낸 쪽이 낮은 점수를 다시 올려도 "먼저 낸" 자리를 잃지 않는다.
    const result = db.submit(device(1), '하나', { [GAME]: 100 }, 9000);
    expect(result.bests[GAME]).toBe(500);
    expect(result.ranks[GAME]).toBe(1);
  });

  it('더 높은 점수를 올리면 바뀌고, 같은 점수의 다른 사람보다는 뒤에 선다', () => {
    const db = new BoardDb(memorySql());
    db.submit(device(1), '하나', { [GAME]: 500 }, 1000);
    db.submit(device(2), '둘', { [GAME]: 700 }, 2000);
    const result = db.submit(device(1), '하나', { [GAME]: 700 }, 3000);
    expect(result).toEqual({ bests: { [GAME]: 700 }, ranks: { [GAME]: 2 } });
    expect(db.submit(device(1), '하나', { [GAME]: 701 }, 4000).ranks[GAME]).toBe(1);
  });

  it('닉네임을 바꾸면 그 기기가 올라 있는 모든 게임에서 바뀐다', () => {
    const db = new BoardDb(memorySql());
    db.submit(device(1), '옛이름', { [GAME]: 500, [OTHER]: 60 }, 1000);
    db.submit(device(2), '남', { [OTHER]: 80 }, 1500);
    // 점수 없이 닉네임만 보내도 되고, 한 게임의 점수와 같이 보내도 된다.
    db.submit(device(1), '새이름', { [GAME]: 400 }, 2000);
    expect(db.board(GAME, null).top.map((row) => row.name)).toEqual(['새이름']);
    expect(db.board(OTHER, null).top.map((row) => row.name)).toEqual(['남', '새이름']);
    db.submit(device(1), '또바꿈', {}, 3000);
    expect(db.board(OTHER, device(1)).me).toEqual({ rank: 2, score: 60, name: '또바꿈' });
  });

  it('게임마다 랭킹이 따로다', () => {
    const db = new BoardDb(memorySql());
    db.submit(device(1), '하나', { [GAME]: 500 }, 1000);
    expect(db.board(OTHER, device(1))).toEqual({ top: [], me: null });
    expect(db.has(GAME, device(1))).toBe(true);
    expect(db.has(OTHER, device(1))).toBe(false);
    expect(db.known(device(1))).toBe(true);
  });

  it('위에서부터 정해진 줄 수만 보여 주고, 그 아래에 있는 내 순위는 따로 알려 준다', () => {
    const db = new BoardDb(memorySql());
    const players = TOP_COUNT + 12;
    for (let n = 1; n <= players; n += 1) db.submit(device(n), `선수${n}`, { [GAME]: 1000 - n }, n);
    const board = db.board(GAME, device(players));
    expect(board.top).toHaveLength(TOP_COUNT);
    expect(board.top.every((row) => !row.mine)).toBe(true);
    expect(board.top[0]).toEqual({ rank: 1, name: '선수1', score: 999, mine: false });
    expect(board.me).toEqual({ rank: players, score: 1000 - players, name: `선수${players}` });
  });

  it('아주 아래쪽 순위는 끝까지 세지 않는다', () => {
    const db = new BoardDb(memorySql());
    const players = RANK_SCAN + 20;
    for (let n = 1; n <= players; n += 1) db.submit(device(n), `선수${n}`, { [GAME]: 5000 - n }, n);
    expect(db.board(GAME, device(RANK_SCAN)).me?.rank).toBe(RANK_SCAN);
    expect(db.board(GAME, device(players)).me?.rank).toBe(RANK_SCAN + 1);
  });

  it('기록을 지우면 모든 게임의 랭킹에서 빠진다', () => {
    const db = new BoardDb(memorySql());
    db.submit(device(1), '하나', { [GAME]: 500, [OTHER]: 60 }, 1000);
    db.submit(device(2), '둘', { [GAME]: 300 }, 2000);
    db.forget(device(1));
    expect(db.known(device(1))).toBe(false);
    expect(db.board(GAME, device(1))).toEqual({
      top: [{ rank: 1, name: '둘', score: 300, mine: false }],
      me: null,
    });
    expect(db.board(OTHER, null).top).toEqual([]);
  });

  it('기기 id는 랭킹에 실려 나가지 않는다', () => {
    const db = new BoardDb(memorySql());
    for (const game of RANKED_GAMES) db.submit(device(7), '일곱', { [game]: 10 }, 1000);
    for (const game of RANKED_GAMES) {
      expect(JSON.stringify(db.board(game, null))).not.toContain(device(7));
    }
  });

  it('같은 저장소를 다시 열어도 기록이 남아 있다', () => {
    const sql = memorySql();
    new BoardDb(sql).submit(device(1), '하나', { [GAME]: 500 }, 1000);
    expect(new BoardDb(sql).board(GAME, device(1)).me?.score).toBe(500);
  });
});

describe('옮기기 코드', () => {
  it('맡긴 세이브를 코드로 꺼낸다. 시간 안에는 여러 번 꺼낼 수 있다', () => {
    const db = new BoardDb(memorySql());
    const stashed = db.stash('{"save":1}', 1000, counterBytes());
    expect(stashed?.code).toHaveLength(CODE_LENGTH);
    expect(stashed?.expiresAt).toBe(1000 + TRANSFER_TTL_MS);
    const code = stashed?.code ?? '';
    expect(db.take(code, 2000)).toBe('{"save":1}');
    expect(db.take(code, 3000)).toBe('{"save":1}');
  });

  it('시간이 지나면 꺼낼 수 없다', () => {
    const db = new BoardDb(memorySql());
    const code = db.stash('{"save":1}', 1000, counterBytes())?.code ?? '';
    expect(db.take(code, 1000 + TRANSFER_TTL_MS - 1)).toBe('{"save":1}');
    expect(db.take(code, 1000 + TRANSFER_TTL_MS)).toBeNull();
  });

  it('없는 코드는 꺼낼 수 없다', () => {
    const db = new BoardDb(memorySql());
    db.stash('{"save":1}', 1000, counterBytes());
    expect(db.take('ZZZZZZZZ', 2000)).toBeNull();
  });

  it('코드가 겹치면 다른 코드를 다시 뽑는다', () => {
    const db = new BoardDb(memorySql());
    // 처음 두 번은 같은 값을 내는 가짜 무작위
    const values = [5, 5, 6];
    const bytes = (length: number): Uint8Array => new Uint8Array(length).fill(values.shift() ?? 9);
    const first = db.stash('A', 1000, bytes);
    const second = db.stash('B', 1000, bytes);
    expect(first?.code).not.toBe(second?.code);
    expect(db.take(first?.code ?? '', 2000)).toBe('A');
    expect(db.take(second?.code ?? '', 2000)).toBe('B');
  });

  it('살아 있는 코드가 너무 많으면 더 받지 않고, 시간이 지난 것이 치워지면 다시 받는다', () => {
    const db = new BoardDb(memorySql());
    const bytes = counterBytes();
    for (let n = 0; n < MAX_TRANSFERS; n += 1) expect(db.stash('x', 1000, bytes)).not.toBeNull();
    expect(db.stash('x', 2000, bytes)).toBeNull();
    expect(db.stash('x', 1000 + TRANSFER_TTL_MS, bytes)).not.toBeNull();
  });
});

describe('모든 게임의 내 순위', () => {
  it('올라 있는 게임마다 순위와 점수를 알려 준다', () => {
    const db = new BoardDb(memorySql());
    db.submit(device(1), '하나', { [GAME]: 500, [OTHER]: 70 }, 1000);
    db.submit(device(2), '둘', { [GAME]: 900 }, 2000);
    db.submit(device(3), '셋', { [GAME]: 500, [OTHER]: 90 }, 3000);

    expect(db.standings(device(1))).toEqual({ [GAME]: { rank: 2, score: 500 }, [OTHER]: { rank: 2, score: 70 } });
    expect(db.standings(device(2))).toEqual({ [GAME]: { rank: 1, score: 900 } });
    // 점수가 같으면 먼저 낸 쪽이 앞이다. 랭킹 화면이 알려 주는 순위와 같아야 한다.
    expect(db.standings(device(3))).toEqual({ [GAME]: { rank: 3, score: 500 }, [OTHER]: { rank: 1, score: 90 } });
    for (const n of [1, 2, 3]) {
      for (const [game, mine] of Object.entries(db.standings(device(n)))) {
        expect(db.board(game as (typeof RANKED_GAMES)[number], device(n)).me?.rank).toBe(mine.rank);
      }
    }
  });

  it('어디에도 올라 있지 않으면 비어 있고, 기록을 지우면 다시 비어 있다', () => {
    const db = new BoardDb(memorySql());
    expect(db.standings(device(1))).toEqual({});
    db.submit(device(1), '하나', { [GAME]: 500 }, 1000);
    expect(Object.keys(db.standings(device(1)))).toEqual([GAME]);
    db.forget(device(1));
    expect(db.standings(device(1))).toEqual({});
  });

  it('순위는 RANK_SCAN까지만 세고, 그 밖이면 RANK_SCAN + 1이다', () => {
    const db = new BoardDb(memorySql());
    for (let n = 1; n <= RANK_SCAN + 5; n += 1) db.submit(device(n), `이름${n}`, { [GAME]: 10_000 - n }, n);
    expect(db.standings(device(RANK_SCAN))[GAME].rank).toBe(RANK_SCAN);
    expect(db.standings(device(RANK_SCAN + 5))[GAME].rank).toBe(RANK_SCAN + 1);
  });
});
