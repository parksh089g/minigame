/**
 * 통계 화면에 보여 줄 것을 세이브에서 뽑는다. 화면에 의존하지 않는 순수 함수들이다.
 * 세이브에는 게임마다 최고 점수, 판 수, 마지막으로 한 때만 있어서 그것으로 낼 수 있는 것만 보여 준다.
 */

/** 통계가 읽는 게임 목록의 부분. registry.ts를 끌어오지 않으려고 필요한 모양만 적는다. */
export interface StatGame {
  id: string;
  title: string;
  icon: string;
  /** null이면 아직 만들지 않은 게임이라 통계에 나오지 않는다. */
  sceneKey: string | null;
  /** 승패로 끝나서 점수가 없는 게임 */
  versus?: boolean;
  /** 판이 끝나지 않고 이어져서, 점수 대신 평판이 쌓이는 게임 */
  ongoing?: boolean;
}

/** 통계가 읽는 세이브의 부분 */
export interface StatSource {
  games: Record<string, { best: number; plays: number; lastPlayedAt: number | null }>;
  daily: { totalCleared: number; bestStreak: number };
}

export interface GameStat {
  id: string;
  title: string;
  icon: string;
  plays: number;
  /** 최고 점수. 점수가 없는 게임이거나 한 번도 안 했으면 null */
  best: number | null;
  versus: boolean;
  /** true면 best는 최고 점수가 아니라 지금까지 쌓은 평판이다. */
  ongoing: boolean;
}

export interface StatSummary {
  /** 모든 게임을 합친 판 수 */
  totalPlays: number;
  /** 한 번이라도 해 본 게임 수 */
  gamesTried: number;
  /** 할 수 있는 게임 수 */
  gamesTotal: number;
  /** 가장 많이 한 게임. 아직 한 판도 안 했으면 null */
  mostPlayed: { title: string; plays: number } | null;
  /** 오늘의 도전을 달성한 횟수 */
  dailyCleared: number;
  /** 오늘의 도전을 가장 길게 이어 간 일수 */
  bestStreak: number;
}

/**
 * 게임마다 한 줄씩. 많이 한 게임이 위에 오고, 판 수가 같으면 최근에 한 게임이 위에 온다.
 * 한 번도 안 한 게임은 허브에 놓인 순서대로 맨 아래에 모인다.
 */
export function gameStats(games: readonly StatGame[], save: StatSource): GameStat[] {
  return games
    .filter((game) => game.sceneKey !== null)
    .map((game, index) => {
      const record = save.games[game.id];
      const plays = record?.plays ?? 0;
      const versus = game.versus === true;
      return {
        index,
        lastPlayedAt: record?.lastPlayedAt ?? 0,
        stat: {
          id: game.id,
          title: game.title,
          icon: game.icon,
          plays,
          best: versus || plays === 0 ? null : (record?.best ?? 0),
          versus,
          ongoing: game.ongoing === true,
        } satisfies GameStat,
      };
    })
    .sort(
      (a, b) => b.stat.plays - a.stat.plays || b.lastPlayedAt - a.lastPlayedAt || a.index - b.index,
    )
    .map((entry) => entry.stat);
}

/** 맨 위에 보여 줄 요약. 여기의 숫자는 게임마다의 줄을 합친 것과 같다. */
export function summarize(games: readonly StatGame[], save: StatSource): StatSummary {
  const stats = gameStats(games, save);
  const top = stats[0];
  return {
    totalPlays: stats.reduce((sum, stat) => sum + stat.plays, 0),
    gamesTried: stats.filter((stat) => stat.plays > 0).length,
    gamesTotal: stats.length,
    mostPlayed: top && top.plays > 0 ? { title: top.title, plays: top.plays } : null,
    dailyCleared: save.daily.totalCleared,
    bestStreak: save.daily.bestStreak,
  };
}

/** 통계 화면에 쓰는 글. 한글은 글꼴에 들어 있는 완성형 2,350자만 쓴다. stats.test.ts가 확인한다. */
export const STATS_TEXT = {
  title: '통계',
  totalPlays: '플레이한 판',
  gamesTried: '해 본 게임',
  mostPlayed: '가장 많이 한 게임',
  noPlays: '아직 없어요',
  daily: '오늘의 도전 달성',
  recent: '도전 최근 7일',
  columnGame: '게임',
  columnPlays: '판 수',
  columnBest: '최고 점수',
  versus: '둘이서',
  reputation: '평판',
  none: '-',
} as const;

/** 요약 카드의 줄들: [이름, 값] */
export function summaryLines(summary: StatSummary): Array<[string, string]> {
  return [
    [STATS_TEXT.totalPlays, `${summary.totalPlays}판`],
    [STATS_TEXT.gamesTried, `${summary.gamesTried}/${summary.gamesTotal}`],
    [STATS_TEXT.mostPlayed, summary.mostPlayed?.title ?? STATS_TEXT.noPlays],
    [
      STATS_TEXT.daily,
      // 이틀 넘게 이어 간 적이 있을 때만 가장 길었던 연속을 덧붙인다.
      summary.bestStreak > 1
        ? `${summary.dailyCleared}번, 최고 연속 ${summary.bestStreak}일`
        : `${summary.dailyCleared}번`,
    ],
  ];
}
