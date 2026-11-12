/**
 * 랭킹과 옮기기 코드를 SQLite에 넣고 꺼내는 부분.
 * SQL을 실행해 주는 것만 밖에서 받으므로, Cloudflare 없이도(테스트에서는 Node의 SQLite로) 돌려 볼 수 있다.
 */
import {
  CODE_LENGTH,
  codeFrom,
  RANK_SCAN,
  RANKED_GAMES,
  TOP_COUNT,
  TRANSFER_TTL_MS,
  type RankBoard,
  type RankedGame,
  type Standings,
  type StashResult,
  type SubmitResult,
} from '../src/online/protocol';

export type SqlValue = string | number | null;

/** Durable Object의 `ctx.storage.sql`에서 여기서 쓰는 부분만 적은 것 */
export interface SqlRunner {
  exec<T extends Record<string, SqlValue>>(query: string, ...bindings: SqlValue[]): { toArray(): T[] };
}

/** 한꺼번에 살아 있을 수 있는 옮기기 코드의 수. 넘으면 새로 만들지 않는다. */
export const MAX_TRANSFERS = 300;

const SCHEMA = [
  // 게임마다 기기 하나에 한 줄: 그 기기의 최고 점수와 닉네임
  `CREATE TABLE IF NOT EXISTS scores (
     game TEXT NOT NULL,
     device TEXT NOT NULL,
     name TEXT NOT NULL,
     score INTEGER NOT NULL,
     at INTEGER NOT NULL,
     PRIMARY KEY (game, device)
   ) WITHOUT ROWID`,
  // 순위는 점수가 높은 순, 같으면 먼저 낸 순
  `CREATE INDEX IF NOT EXISTS scores_rank ON scores (game, score DESC, at ASC)`,
  // 다른 기기로 옮기려고 잠깐 맡겨 둔 세이브
  `CREATE TABLE IF NOT EXISTS transfers (
     code TEXT NOT NULL PRIMARY KEY,
     bundle TEXT NOT NULL,
     expires INTEGER NOT NULL
   ) WITHOUT ROWID`,
] as const;

export class BoardDb {
  constructor(private readonly sql: SqlRunner) {
    for (const statement of SCHEMA) sql.exec(statement);
  }

  /** 이 기기가 이 게임의 랭킹에 이미 올라 있는지 */
  has(game: RankedGame, device: string): boolean {
    return this.own(game, device) !== null;
  }

  /** 이 기기가 어느 게임에든 올라 있는지 */
  known(device: string): boolean {
    return RANKED_GAMES.some((game) => this.has(game, device));
  }

  private own(game: RankedGame, device: string): { name: string; score: number; at: number } | null {
    const rows = this.sql
      .exec<{ name: string; score: number; at: number }>(
        'SELECT name, score, at FROM scores WHERE game = ? AND device = ?',
        game,
        device,
      )
      .toArray();
    return rows[0] ?? null;
  }

  /** 점수와 낸 시각으로 순위를 센다. RANK_SCAN까지만 세고, 그 밖이면 RANK_SCAN + 1을 돌려준다. */
  private rankOf(game: RankedGame, score: number, at: number): number {
    const rows = this.sql
      .exec<{ ahead: number }>(
        `SELECT COUNT(*) AS ahead FROM (
           SELECT 1 FROM scores
           WHERE game = ? AND score >= ? AND (score > ? OR at < ?)
           LIMIT ?
         )`,
        game,
        score,
        score,
        at,
        RANK_SCAN,
      )
      .toArray();
    return (rows[0]?.ahead ?? 0) + 1;
  }

  /** 한 게임의 랭킹: 위에서부터 TOP_COUNT줄과, 물어본 기기의 순위 */
  board(game: RankedGame, device: string | null): RankBoard {
    const rows = this.sql
      .exec<{ name: string; score: number; device: string }>(
        'SELECT name, score, device FROM scores WHERE game = ? ORDER BY score DESC, at ASC LIMIT ?',
        game,
        TOP_COUNT,
      )
      .toArray();
    const top = rows.map((row, index) => ({
      rank: index + 1,
      name: row.name,
      score: row.score,
      mine: device !== null && row.device === device,
    }));

    let me: RankBoard['me'] = null;
    if (device !== null) {
      const shown = top.find((row) => row.mine);
      if (shown) {
        me = { rank: shown.rank, score: shown.score, name: shown.name };
      } else {
        const own = this.own(game, device);
        if (own) me = { rank: this.rankOf(game, own.score, own.at), score: own.score, name: own.name };
      }
    }
    return { top, me };
  }

  /** 이 기기가 올라 있는 모든 게임에서의 순위와 점수. 어디에도 올라 있지 않으면 비어 있다. */
  standings(device: string): Standings {
    const standings: Standings = {};
    for (const game of RANKED_GAMES) {
      const own = this.own(game, device);
      if (own) standings[game] = { rank: this.rankOf(game, own.score, own.at), score: own.score };
    }
    return standings;
  }

  /**
   * 기기의 최고 점수를 올린다. 이미 있는 점수보다 낮으면 점수는 그대로 두고 닉네임만 맞춘다.
   * 닉네임은 이 기기가 올라 있는 모든 게임에서 같이 바뀐다.
   */
  submit(device: string, name: string, scores: Partial<Record<RankedGame, number>>, now: number): SubmitResult {
    const result: SubmitResult = { bests: {}, ranks: {} };
    for (const game of RANKED_GAMES) {
      const score = scores[game];
      if (score === undefined) {
        this.sql.exec(
          'UPDATE scores SET name = ? WHERE game = ? AND device = ? AND name <> ?',
          name,
          game,
          device,
          name,
        );
        continue;
      }
      // 달라지는 것이 없으면 아무것도 쓰지 않는다(하루에 쓸 수 있는 줄 수에 한도가 있다).
      this.sql.exec(
        `INSERT INTO scores (game, device, name, score, at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (game, device) DO UPDATE SET
           name = excluded.name,
           score = MAX(scores.score, excluded.score),
           at = CASE WHEN excluded.score > scores.score THEN excluded.at ELSE scores.at END
         WHERE excluded.score > scores.score OR excluded.name <> scores.name`,
        game,
        device,
        name,
        score,
        now,
      );
      const own = this.own(game, device);
      if (!own) continue;
      result.bests[game] = own.score;
      result.ranks[game] = this.rankOf(game, own.score, own.at);
    }
    return result;
  }

  /** 이 기기의 기록을 모든 랭킹에서 지운다. */
  forget(device: string): void {
    for (const game of RANKED_GAMES) {
      this.sql.exec('DELETE FROM scores WHERE game = ? AND device = ?', game, device);
    }
  }

  /**
   * 세이브를 맡기고 코드를 받는다. 맡길 자리가 없으면 null.
   * randomBytes는 무작위 바이트를 채워 주는 함수다(코드를 예측할 수 없어야 한다).
   */
  stash(bundle: string, now: number, randomBytes: (length: number) => Uint8Array): StashResult | null {
    this.sql.exec('DELETE FROM transfers WHERE expires <= ?', now);
    const active = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM transfers').toArray()[0]?.n ?? 0;
    if (active >= MAX_TRANSFERS) return null;

    const expiresAt = now + TRANSFER_TTL_MS;
    // 코드가 겹칠 일은 거의 없지만, 겹치면 다시 뽑는다.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = codeFrom(randomBytes(CODE_LENGTH));
      const taken = this.sql.exec<{ code: string }>('SELECT code FROM transfers WHERE code = ?', code).toArray();
      if (taken.length > 0) continue;
      this.sql.exec('INSERT INTO transfers (code, bundle, expires) VALUES (?, ?, ?)', code, bundle, expiresAt);
      return { code, expiresAt };
    }
    return null;
  }

  /**
   * 코드로 맡겨 둔 세이브를 꺼낸다. 없거나 시간이 지났으면 null.
   * 받는 쪽에서 불러오다 끊겨도 다시 해 볼 수 있게, 꺼내도 지우지 않고 시간이 지나면 사라지게 둔다.
   */
  take(code: string, now: number): string | null {
    const rows = this.sql
      .exec<{ bundle: string }>('SELECT bundle FROM transfers WHERE code = ? AND expires > ?', code, now)
      .toArray();
    return rows[0]?.bundle ?? null;
  }
}
