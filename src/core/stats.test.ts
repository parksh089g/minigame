import { describe, expect, it } from 'vitest';
import { GAMES } from '../games/registry';
import { createDefaultSave } from './save';
import { gameStats, STATS_TEXT, summarize, summaryLines, type StatGame, type StatSource } from './stats';

/**
 * 주아 글꼴에 들어 있는 한글: KS X 1001의 완성형 2,350자.
 * EUC-KR에서 첫 바이트 0xB0~0xC8, 둘째 바이트 0xA1~0xFE인 글자가 바로 그것이다.
 */
function fontSyllables(): Set<string> {
  const decoder = new TextDecoder('euc-kr');
  const syllables = new Set<string>();
  for (let lead = 0xb0; lead <= 0xc8; lead += 1) {
    for (let trail = 0xa1; trail <= 0xfe; trail += 1) {
      syllables.add(decoder.decode(new Uint8Array([lead, trail])));
    }
  }
  return syllables;
}

const game = (id: string, extra: Partial<StatGame> = {}): StatGame => ({
  id,
  title: `게임 ${id}`,
  icon: `icon-${id}`,
  sceneKey: id,
  ...extra,
});

const SAMPLE: StatGame[] = [
  game('a'),
  game('b'),
  game('c'),
  game('soon', { sceneKey: null }),
  game('pair', { versus: true }),
  game('d'),
];

const record = (plays: number, best: number, lastPlayedAt: number | null = plays > 0 ? 1000 : null) => ({
  plays,
  best,
  lastPlayedAt,
});

const source = (games: StatSource['games'], daily: Partial<StatSource['daily']> = {}): StatSource => ({
  games,
  daily: { totalCleared: 0, bestStreak: 0, ...daily },
});

describe('게임마다의 줄', () => {
  it('많이 한 게임이 위에 오고, 안 한 게임은 놓인 순서대로 아래에 모인다', () => {
    const stats = gameStats(SAMPLE, source({ b: record(3, 40), d: record(9, 120), pair: record(5, 0) }));
    expect(stats.map((stat) => stat.id)).toEqual(['d', 'pair', 'b', 'a', 'c']);
    expect(stats.map((stat) => stat.plays)).toEqual([9, 5, 3, 0, 0]);
  });

  it('판 수가 같으면 최근에 한 게임이 위에 온다', () => {
    const stats = gameStats(
      SAMPLE,
      source({ a: record(2, 10, 100), b: record(2, 10, 300), c: record(2, 10, 200) }),
    );
    expect(stats.slice(0, 3).map((stat) => stat.id)).toEqual(['b', 'c', 'a']);
  });

  it('아직 만들지 않은 게임은 나오지 않는다', () => {
    const stats = gameStats(SAMPLE, source({ soon: record(4, 10) }));
    expect(stats.some((stat) => stat.id === 'soon')).toBe(false);
    expect(stats).toHaveLength(5);
  });

  it('최고 점수는 점수가 있는 게임을 한 번이라도 했을 때만 있다', () => {
    const stats = gameStats(SAMPLE, source({ a: record(1, 0), pair: record(7, 0) }));
    const by = (id: string) => stats.find((stat) => stat.id === id);
    // 0점으로 끝난 판도 한 판이고, 그때의 최고 점수는 0이다.
    expect(by('a')?.best).toBe(0);
    expect(by('pair')?.best).toBeNull();
    expect(by('pair')?.versus).toBe(true);
    expect(by('b')?.best).toBeNull();
    expect(by('b')?.versus).toBe(false);
  });

  it('이어지는 성장 게임은 기록이 평판이라는 것을 알려 준다', () => {
    const stats = gameStats([game('grow', { ongoing: true }), game('a')], source({ grow: record(3, 40), a: record(1, 7) }));
    expect(stats[0]).toMatchObject({ id: 'grow', best: 40, ongoing: true });
    expect(stats[1]).toMatchObject({ id: 'a', best: 7, ongoing: false });
  });

  it('목록에 없는 게임의 기록은 버린다', () => {
    const stats = gameStats(SAMPLE, source({ gone: record(50, 999), a: record(1, 5) }));
    expect(stats.map((stat) => stat.id)).toEqual(['a', 'b', 'c', 'pair', 'd']);
  });
});

describe('요약', () => {
  it('게임마다의 줄을 합친 것과 같다', () => {
    const save = source(
      { a: record(4, 10), d: record(6, 20), pair: record(1, 0), gone: record(50, 999), soon: record(3, 1) },
      { totalCleared: 5, bestStreak: 3 },
    );
    const summary = summarize(SAMPLE, save);
    const stats = gameStats(SAMPLE, save);
    expect(summary.totalPlays).toBe(11);
    expect(summary.totalPlays).toBe(stats.reduce((sum, stat) => sum + stat.plays, 0));
    expect(summary.gamesTried).toBe(3);
    expect(summary.gamesTotal).toBe(5);
    expect(summary.mostPlayed).toEqual({ title: '게임 d', plays: 6 });
    expect(summary.dailyCleared).toBe(5);
    expect(summary.bestStreak).toBe(3);
  });

  it('한 판도 안 했으면 가장 많이 한 게임이 없다', () => {
    const summary = summarize(SAMPLE, source({}));
    expect(summary.totalPlays).toBe(0);
    expect(summary.gamesTried).toBe(0);
    expect(summary.mostPlayed).toBeNull();
    expect(summaryLines(summary)[2]).toEqual([STATS_TEXT.mostPlayed, STATS_TEXT.noPlays]);
  });

  it('이틀 넘게 이어 간 적이 있을 때만 가장 길었던 연속을 덧붙인다', () => {
    const line = (totalCleared: number, bestStreak: number): string =>
      summaryLines(summarize(SAMPLE, source({}, { totalCleared, bestStreak })))[3]?.[1] ?? '';
    expect(line(0, 0)).toBe('0번');
    expect(line(1, 1)).toBe('1번');
    expect(line(12, 7)).toBe('12번, 최고 연속 7일');
  });

  it('실제 게임 목록과 새 세이브로도 줄이 나온다', () => {
    const save = createDefaultSave(0);
    const stats = gameStats(GAMES, save);
    expect(stats).toHaveLength(GAMES.filter((item) => item.sceneKey !== null).length);
    expect(stats.every((stat) => stat.plays === 0 && stat.best === null)).toBe(true);
    // 한 판도 안 했으면 허브에 놓인 순서 그대로다.
    expect(stats.map((stat) => stat.id)).toEqual(
      GAMES.filter((item) => item.sceneKey !== null).map((item) => item.id),
    );
    expect(summarize(GAMES, save).totalPlays).toBe(0);
  });

  it('글꼴에 들어 있는 한글만 쓴다', () => {
    const known = fontSyllables();
    expect(known.size).toBe(2350);
    const lines = [
      ...Object.values(STATS_TEXT),
      ...summaryLines(summarize(SAMPLE, source({ a: record(3, 1) }, { totalCleared: 12, bestStreak: 7 }))).flat(),
    ];
    for (const line of lines) {
      for (const letter of line.match(/[ㄱ-ㆎ가-힣]/g) ?? []) {
        expect(known.has(letter), `"${letter}" in "${line}"`).toBe(true);
      }
    }
  });
});
