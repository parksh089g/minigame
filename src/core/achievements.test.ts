import { describe, expect, it } from 'vitest';
import { GAMES as REGISTERED_GAMES } from '../games/registry';
import {
  ACHIEVEMENTS,
  GROUPS,
  achievementsIn,
  claim,
  claimable,
  completedIds,
  createAchievements,
  getAchievement,
  normalizeAchievements,
  progressOf,
  statsOf,
  type AchievementSource,
  type AchievementStats,
} from './achievements';
import { CATALOG } from './shop';

const EMPTY: AchievementStats = {
  totalPlays: 0,
  gamesTried: 0,
  best: {},
  played: {},
  dailyCleared: 0,
  bestStreak: 0,
  cosmeticsOwned: 0,
  stagesCleared: 0,
  stageBest: 0,
  stageGames: 0,
};
const stats = (patch: Partial<AchievementStats>): AchievementStats => ({ ...EMPTY, ...patch });
const must = (id: string) => {
  const achievement = getAchievement(id);
  if (!achievement) throw new Error(`없는 업적: ${id}`);
  return achievement;
};

describe('업적 목록', () => {
  it('id가 겹치지 않고, 목표와 보상은 양의 정수다', () => {
    const ids = ACHIEVEMENTS.map((achievement) => achievement.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const achievement of ACHIEVEMENTS) {
      expect(Number.isInteger(achievement.goal) && achievement.goal > 0).toBe(true);
      expect(Number.isInteger(achievement.reward) && achievement.reward > 0).toBe(true);
    }
  });

  it('탭마다 업적이 있다', () => {
    // 한 화면에 다 들어가지 않는 탭은 업적 화면이 쪽으로 나눠 보여 준다.
    for (const group of GROUPS) expect(achievementsIn(group).length).toBeGreaterThan(0);
  });

  it('제목과 설명은 업적 화면 한 줄에 들어가는 길이다', () => {
    // 한글 12px, 숫자 7px, 빈칸 5px로 어림한 폭
    const width = (text: string): number =>
      [...text].reduce((sum, char) => sum + (char === ' ' ? 5 : /[0-9]/.test(char) ? 7 : 12), 0);
    for (const achievement of ACHIEVEMENTS) {
      expect(width(achievement.title)).toBeLessThanOrEqual(90);
      expect(width(achievement.description)).toBeLessThanOrEqual(133);
    }
  });

  it('아무 기록이 없으면 달성한 업적이 없다', () => {
    expect(completedIds(EMPTY)).toEqual([]);
    for (const achievement of ACHIEVEMENTS) {
      expect(progressOf(achievement, EMPTY)).toEqual({
        current: 0,
        goal: achievement.goal,
        complete: false,
      });
    }
  });

  it('점수 업적은 실제로 있는 게임을 가리킨다', () => {
    const gameIds = REGISTERED_GAMES.map((game) => game.id);
    const maxed = stats({ best: Object.fromEntries(gameIds.map((id) => [id, 100000])) });
    for (const achievement of achievementsIn('score')) {
      expect(progressOf(achievement, maxed).complete).toBe(true);
    }
  });

  it('모두 모으기의 목표는 살 수 있는 꾸미기의 수와 같다', () => {
    const paid = CATALOG.filter((item) => item.price > 0).length;
    expect(must('collect-all').goal).toBe(paid);
  });
});

describe('progressOf', () => {
  it('목표에 닿으면 달성이고, 진행은 목표를 넘지 않는다', () => {
    const tap = must('tap-80');
    expect(progressOf(tap, stats({ best: { 'lightning-tap': 79 } }))).toEqual({
      current: 79,
      goal: 80,
      complete: false,
    });
    expect(progressOf(tap, stats({ best: { 'lightning-tap': 80 } })).complete).toBe(true);
    expect(progressOf(tap, stats({ best: { 'lightning-tap': 500 } }))).toEqual({
      current: 80,
      goal: 80,
      complete: true,
    });
  });

  it('다른 게임의 점수는 세지 않는다', () => {
    expect(progressOf(must('tap-80'), stats({ best: { 'jump-runner': 999 } })).complete).toBe(false);
  });

  it('판 수 업적은 그 게임을 한 판 수만 센다', () => {
    const duel = must('duel-10');
    expect(progressOf(duel, stats({ totalPlays: 50, played: { 'lightning-tap': 50 } })).complete).toBe(false);
    expect(progressOf(duel, stats({ played: { duel: 9 } })).complete).toBe(false);
    expect(progressOf(duel, stats({ played: { duel: 10 } })).complete).toBe(true);
  });
});

describe('단계 업적', () => {
  it('깬 단계를 모두 더한 수로 달성한다', () => {
    expect(progressOf(must('stage-first'), stats({ stagesCleared: 1 })).complete).toBe(true);
    expect(progressOf(must('stage-30'), stats({ stagesCleared: 29 })).complete).toBe(false);
    expect(progressOf(must('stage-30'), stats({ stagesCleared: 30 })).complete).toBe(true);
    expect(progressOf(must('stage-100'), stats({ stagesCleared: 100 })).complete).toBe(true);
    expect(progressOf(must('stage-300'), stats({ stagesCleared: 299 }))).toEqual({
      current: 299,
      goal: 300,
      complete: false,
    });
  });

  it('한 게임을 깊이 판 것과 여러 게임을 해 본 것은 따로 센다', () => {
    // 여러 게임에서 조금씩 깨서 합이 커도, 한 게임에서 멀리 간 것은 아니다.
    const wide = stats({ stagesCleared: 120, stageBest: 30, stageGames: 4 });
    expect(progressOf(must('stage-game-50'), wide).complete).toBe(false);
    expect(progressOf(must('stage-variety'), wide).complete).toBe(true);
    const deep = stats({ stagesCleared: 100, stageBest: 100, stageGames: 1 });
    expect(progressOf(must('stage-game-50'), deep).complete).toBe(true);
    expect(progressOf(must('stage-game-100'), deep).complete).toBe(true);
    expect(progressOf(must('stage-variety'), deep).complete).toBe(false);
  });

  it('판 수나 점수만으로는 달성되지 않는다', () => {
    const busy = stats({ totalPlays: 500, gamesTried: 10, best: { 'color-sort': 9999 } });
    for (const achievement of ACHIEVEMENTS.filter((item) => item.id.startsWith('stage-'))) {
      expect(progressOf(achievement, busy).complete, achievement.id).toBe(false);
    }
  });
});

describe('statsOf', () => {
  const source: AchievementSource = {
    games: {
      'lightning-tap': { best: 90, plays: 4 },
      'memory-cards': { best: 0, plays: 0 },
      'jump-runner': { best: 160, plays: 2 },
    },
    daily: { totalCleared: 5, bestStreak: 3 },
    cosmetics: { owned: ['runner-drop', 'orb-green'] },
    stages: { 'color-sort': 12, 'pin-pull': 3 },
  };

  it('세이브에서 업적이 보는 숫자를 뽑는다', () => {
    expect(statsOf(source)).toEqual({
      totalPlays: 6,
      gamesTried: 2,
      best: { 'lightning-tap': 90, 'memory-cards': 0, 'jump-runner': 160 },
      played: { 'lightning-tap': 4, 'memory-cards': 0, 'jump-runner': 2 },
      dailyCleared: 5,
      bestStreak: 3,
      cosmeticsOwned: 2,
      stagesCleared: 15,
      stageBest: 12,
      stageGames: 2,
    });
  });

  it('깬 단계가 없으면 단계의 숫자는 모두 0이다', () => {
    expect(statsOf({ ...source, stages: {} })).toMatchObject({ stagesCleared: 0, stageBest: 0, stageGames: 0 });
  });

  it('그 숫자로 달성한 업적이 정해진다', () => {
    expect(completedIds(statsOf(source)).sort()).toEqual(
      ['play-first', 'stage-first', 'tap-80', 'runner-150', 'daily-1', 'daily-streak-3', 'collect-1'].sort(),
    );
  });
});

describe('claim', () => {
  const done = stats({ totalPlays: 1 });

  it('달성한 업적의 보상을 한 번만 받는다', () => {
    const state = createAchievements();
    expect(claimable(state, done).map((achievement) => achievement.id)).toEqual(['play-first']);

    const result = claim(state, done, 'play-first');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.achievement.reward).toBe(5);
    expect(result.state.claimed).toEqual(['play-first']);
    // 원본은 그대로다.
    expect(state.claimed).toEqual([]);

    expect(claimable(result.state, done)).toEqual([]);
    expect(claim(result.state, done, 'play-first')).toEqual({ ok: false, reason: 'claimed' });
  });

  it('달성하지 못한 업적과 없는 업적은 받을 수 없다', () => {
    expect(claim(createAchievements(), done, 'play-30')).toEqual({ ok: false, reason: 'incomplete' });
    expect(claim(createAchievements(), done, 'nope')).toEqual({ ok: false, reason: 'unknown' });
  });
});

describe('normalizeAchievements', () => {
  it('없거나 이상한 값은 처음 상태가 된다', () => {
    expect(normalizeAchievements(undefined)).toEqual({ claimed: [] });
    expect(normalizeAchievements({ claimed: 'x' })).toEqual({ claimed: [] });
  });

  it('모르는 id와 겹친 id는 버린다', () => {
    expect(
      normalizeAchievements({ claimed: ['play-first', 'gone', 'play-first', 3, 'tap-80'] }),
    ).toEqual({ claimed: ['play-first', 'tap-80'] });
  });
});
