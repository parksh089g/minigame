import { describe, expect, it } from 'vitest';
import type { DailyChallenge } from './daily';
import {
  applyPlayResult,
  buyCosmetic,
  claimAchievement,
  createDefaultSave,
  equipCosmetic,
  getRecord,
  looksLikeSave,
  normalizeSave,
  resetProgress,
  SAVE_VERSION,
} from './save';
import { createCosmetics } from './shop';

const NOW = 1_700_000_000_000;

describe('normalizeSave', () => {
  it('세이브가 없으면 기본값을 만든다', () => {
    expect(normalizeSave(undefined, NOW)).toEqual(createDefaultSave(NOW));
    expect(normalizeSave(null, NOW)).toEqual(createDefaultSave(NOW));
    expect(normalizeSave('깨진 값', NOW)).toEqual(createDefaultSave(NOW));
  });

  it('올바른 세이브는 그대로 유지한다', () => {
    const save = {
      version: SAVE_VERSION,
      coins: 12,
      settings: { sound: false, vibration: true },
      games: { 'lightning-tap': { best: 80, plays: 4, lastPlayedAt: NOW - 1000 } },
      daily: { lastClearedOn: '2026-11-11', streak: 3, bestStreak: 4, totalCleared: 8 },
      cosmetics: {
        owned: ['runner-drop'],
        equipped: {
          backdrop: 'backdrop-night',
          runner: 'runner-drop',
          cardBack: 'cardback-blue',
          orb: 'orb-blue',
        },
      },
      achievements: { claimed: ['play-first'] },
      createdAt: NOW - 5000,
      updatedAt: NOW - 1000,
    };
    expect(normalizeSave(save, NOW)).toEqual(save);
  });

  it('꾸미기가 생기기 전의 세이브는 기본 꾸미기로 읽는다', () => {
    const old = {
      version: 2,
      coins: 55,
      settings: { sound: true, vibration: true },
      games: {},
      daily: { lastClearedOn: '2026-11-11', streak: 2, totalCleared: 2 },
      createdAt: NOW - 5000,
      updatedAt: NOW - 1000,
    };
    const save = normalizeSave(old, NOW);
    expect(save.coins).toBe(55);
    expect(save.daily).toEqual({ ...old.daily, bestStreak: 2 });
    expect(save.cosmetics).toEqual(createCosmetics());
  });

  it('오늘의 도전이 생기기 전의 세이브도 기록을 잃지 않고 읽는다', () => {
    const old = {
      version: 1,
      coins: 30,
      settings: { sound: true, vibration: false },
      games: { 'memory-cards': { best: 200, plays: 2, lastPlayedAt: NOW - 1000 } },
      createdAt: NOW - 5000,
      updatedAt: NOW - 1000,
    };
    const save = normalizeSave(old, NOW);
    expect(save.version).toBe(SAVE_VERSION);
    expect(save.coins).toBe(30);
    expect(save.games).toEqual(old.games);
    expect(save.settings).toEqual(old.settings);
    expect(save.daily).toEqual({ lastClearedOn: null, streak: 0, bestStreak: 0, totalCleared: 0 });
  });

  it('빠지거나 잘못된 항목을 기본값으로 채운다', () => {
    const save = normalizeSave(
      {
        coins: -5,
        settings: { sound: 'yes' },
        games: {
          a: { best: 10.9, plays: '3' },
          b: 'not a record',
        },
      },
      NOW,
    );
    expect(save.coins).toBe(0);
    expect(save.settings).toEqual({ sound: true, vibration: true });
    expect(save.games).toEqual({ a: { best: 10, plays: 0, lastPlayedAt: null } });
    expect(save.createdAt).toBe(NOW);
    expect(save.version).toBe(SAVE_VERSION);
  });

  it('NaN이나 Infinity 같은 숫자를 받아들이지 않는다', () => {
    const save = normalizeSave({ coins: Number.NaN, games: { a: { best: Infinity } } }, NOW);
    expect(save.coins).toBe(0);
    expect(save.games.a.best).toBe(0);
  });
});

describe('looksLikeSave', () => {
  it('버전과 게임 기록이 있어야 세이브로 본다', () => {
    expect(looksLikeSave(createDefaultSave(NOW))).toBe(true);
    expect(looksLikeSave({ version: 1 })).toBe(false);
    expect(looksLikeSave({ games: {} })).toBe(false);
    expect(looksLikeSave([1, 2, 3])).toBe(false);
    expect(looksLikeSave(null)).toBe(false);
  });
});

describe('applyPlayResult', () => {
  it('첫 판은 신기록이고 횟수와 코인이 오른다', () => {
    const result = applyPlayResult(createDefaultSave(NOW), 'lightning-tap', 42, 4, NOW + 1);
    expect(result.isNewBest).toBe(true);
    expect(result.previousBest).toBe(0);
    expect(result.best).toBe(42);
    expect(result.coinsEarned).toBe(4);
    expect(result.save.coins).toBe(4);
    expect(result.save.games['lightning-tap']).toEqual({ best: 42, plays: 1, lastPlayedAt: NOW + 1 });
    expect(result.save.updatedAt).toBe(NOW + 1);
  });

  it('최고 기록보다 낮은 점수는 기록을 바꾸지 않는다', () => {
    const first = applyPlayResult(createDefaultSave(NOW), 'g', 50, 5, NOW).save;
    const second = applyPlayResult(first, 'g', 30, 3, NOW + 10);
    expect(second.isNewBest).toBe(false);
    expect(second.best).toBe(50);
    expect(second.save.games.g.plays).toBe(2);
    expect(second.save.coins).toBe(8);
  });

  it('같은 점수는 신기록이 아니다', () => {
    const first = applyPlayResult(createDefaultSave(NOW), 'g', 50, 0, NOW).save;
    expect(applyPlayResult(first, 'g', 50, 0, NOW).isNewBest).toBe(false);
  });

  it('0점은 신기록으로 치지 않는다', () => {
    expect(applyPlayResult(createDefaultSave(NOW), 'g', 0, 0, NOW).isNewBest).toBe(false);
  });

  it('원본 세이브를 바꾸지 않는다', () => {
    const original = createDefaultSave(NOW);
    const snapshot = structuredClone(original);
    applyPlayResult(original, 'g', 10, 1, NOW + 5);
    expect(original).toEqual(snapshot);
  });

  it('게임마다 기록을 따로 둔다', () => {
    let save = createDefaultSave(NOW);
    save = applyPlayResult(save, 'a', 10, 0, NOW).save;
    save = applyPlayResult(save, 'b', 99, 0, NOW).save;
    expect(getRecord(save, 'a').best).toBe(10);
    expect(getRecord(save, 'b').best).toBe(99);
    expect(getRecord(save, 'c')).toEqual({ best: 0, plays: 0, lastPlayedAt: null });
  });
});

describe('오늘의 도전과 한 판의 결과', () => {
  const challenge: DailyChallenge = { dateKey: '2026-11-11', gameId: 'g', target: 100, reward: 25 };
  const nextDay: DailyChallenge = { dateKey: '2026-11-12', gameId: 'g', target: 100, reward: 15 };

  it('도전을 넘기지 않으면 달성 여부를 따지지 않는다', () => {
    const result = applyPlayResult(createDefaultSave(NOW), 'g', 500, 5, NOW);
    expect(result.daily).toBeNull();
    expect(result.save.daily.totalCleared).toBe(0);
  });

  it('목표 점수 이상이면 달성하고 보상을 받는다', () => {
    const result = applyPlayResult(createDefaultSave(NOW), 'g', 100, 5, NOW, challenge);
    expect(result.daily).toEqual({ cleared: true, reward: 25, streak: 1, shortBy: 0 });
    expect(result.coinsEarned).toBe(5);
    expect(result.save.coins).toBe(30);
    expect(result.save.daily).toEqual({
      lastClearedOn: '2026-11-11',
      streak: 1,
      bestStreak: 1,
      totalCleared: 1,
    });
  });

  it('목표에 못 미치면 모자란 점수를 알려 주고 보상은 없다', () => {
    const result = applyPlayResult(createDefaultSave(NOW), 'g', 77, 3, NOW, challenge);
    expect(result.daily).toEqual({ cleared: false, reward: 0, streak: 0, shortBy: 23 });
    expect(result.save.coins).toBe(3);
    expect(result.save.daily.lastClearedOn).toBeNull();
  });

  it('다른 게임을 한 판은 도전과 상관없다', () => {
    const result = applyPlayResult(createDefaultSave(NOW), 'other', 999, 9, NOW, challenge);
    expect(result.daily).toBeNull();
    expect(result.save.coins).toBe(9);
    expect(result.save.daily.totalCleared).toBe(0);
  });

  it('같은 날 다시 넘겨도 보상은 한 번만 받는다', () => {
    const first = applyPlayResult(createDefaultSave(NOW), 'g', 150, 0, NOW, challenge).save;
    const again = applyPlayResult(first, 'g', 300, 0, NOW + 10, challenge);
    expect(again.daily).toBeNull();
    expect(again.save.coins).toBe(25);
    expect(again.save.daily).toEqual(first.daily);
  });

  it('다음 날에도 달성하면 연속 보너스가 붙는다', () => {
    const first = applyPlayResult(createDefaultSave(NOW), 'g', 150, 0, NOW, challenge).save;
    const second = applyPlayResult(first, 'g', 120, 0, NOW + 10, nextDay);
    expect(second.daily).toEqual({ cleared: true, reward: 15 + 5, streak: 2, shortBy: 0 });
    expect(second.save.coins).toBe(25 + 20);
    expect(second.save.daily).toEqual({
      lastClearedOn: '2026-11-12',
      streak: 2,
      bestStreak: 2,
      totalCleared: 2,
    });
  });
});

describe('꾸미기 사기와 끼우기', () => {
  const rich = (): ReturnType<typeof createDefaultSave> => ({ ...createDefaultSave(NOW), coins: 120 });

  it('사면 코인이 줄고 바로 끼워진다', () => {
    const save = rich();
    const result = buyCosmetic(save, 'backdrop-forest', NOW + 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.item.name).toBe('숲속');
    expect(result.save.coins).toBe(80);
    expect(result.save.cosmetics.owned).toEqual(['backdrop-forest']);
    expect(result.save.cosmetics.equipped.backdrop).toBe('backdrop-forest');
    expect(result.save.updatedAt).toBe(NOW + 10);
    // 원본은 그대로다.
    expect(save.coins).toBe(120);
    expect(save.cosmetics).toEqual(createCosmetics());
  });

  it('코인이 모자라면 사지 못한다', () => {
    expect(buyCosmetic(rich(), 'orb-moon', NOW)).toEqual({ ok: false, reason: 'coins', shortBy: 60 });
  });

  it('가진 것으로 바꿔 끼우고, 바뀌는 것이 없으면 같은 세이브를 돌려준다', () => {
    const bought = buyCosmetic(rich(), 'backdrop-forest', NOW);
    if (!bought.ok) throw new Error('구매 실패');
    const back = equipCosmetic(bought.save, 'backdrop-night', NOW + 20);
    expect(back.cosmetics.equipped.backdrop).toBe('backdrop-night');
    expect(back.cosmetics.owned).toEqual(['backdrop-forest']);
    expect(back.coins).toBe(80);
    expect(equipCosmetic(back, 'backdrop-night', NOW + 30)).toBe(back);
    expect(equipCosmetic(back, 'backdrop-galaxy', NOW + 30)).toBe(back);
  });
});

describe('업적', () => {
  it('한 판을 끝내면 그 판으로 새로 달성한 업적을 알려 준다', () => {
    const first = applyPlayResult(createDefaultSave(NOW), 'lightning-tap', 85, 8, NOW);
    expect(first.newAchievements.map((achievement) => achievement.id).sort()).toEqual([
      'play-first',
      'tap-80',
    ]);
    // 이미 달성한 업적은 다시 알리지 않는다.
    const second = applyPlayResult(first.save, 'lightning-tap', 90, 9, NOW + 10);
    expect(second.newAchievements).toEqual([]);
    // 달성만으로는 코인이 늘지 않는다. 보상은 받아야 들어온다.
    expect(second.save.coins).toBe(17);
    expect(second.save.achievements.claimed).toEqual([]);
  });

  it('업적이 생기기 전에 쌓은 기록도 달성으로 인정하되, 새로 달성한 것으로 알리지는 않는다', () => {
    const old = normalizeSave(
      {
        version: 3,
        coins: 10,
        games: { 'jump-runner': { best: 320, plays: 40, lastPlayedAt: NOW - 1000 } },
      },
      NOW,
    );
    const claimed = claimAchievement(old, 'runner-300', NOW + 5);
    expect(claimed.ok && claimed.save.coins).toBe(60);
    const result = applyPlayResult(old, 'jump-runner', 10, 0, NOW + 10);
    expect(result.newAchievements).toEqual([]);
  });

  it('보상은 한 번만 받고, 달성하지 못한 업적은 받을 수 없다', () => {
    const played = applyPlayResult(createDefaultSave(NOW), 'memory-cards', 20, 1, NOW).save;
    const claimed = claimAchievement(played, 'play-first', NOW + 10);
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;
    expect(claimed.achievement.title).toBe('첫걸음');
    expect(claimed.save.coins).toBe(1 + 5);
    expect(claimed.save.achievements.claimed).toEqual(['play-first']);
    expect(claimed.save.updatedAt).toBe(NOW + 10);
    // 원본은 그대로다.
    expect(played.coins).toBe(1);

    expect(claimAchievement(claimed.save, 'play-first', NOW + 20)).toEqual({
      ok: false,
      reason: 'claimed',
    });
    expect(claimAchievement(played, 'play-30', NOW + 20)).toEqual({
      ok: false,
      reason: 'incomplete',
    });
  });

  it('오늘의 도전을 달성한 판은 도전 업적도 함께 알린다', () => {
    const challenge: DailyChallenge = { dateKey: '2026-11-11', gameId: 'g', target: 5, reward: 15 };
    const result = applyPlayResult(createDefaultSave(NOW), 'g', 10, 0, NOW, challenge);
    expect(result.newAchievements.map((achievement) => achievement.id)).toContain('daily-1');
  });
});

describe('resetProgress', () => {
  it('기록과 코인은 지우고 설정은 남긴다', () => {
    let save = createDefaultSave(NOW);
    save.settings.sound = false;
    save = applyPlayResult(save, 'g', 10, 7, NOW).save;
    const reset = resetProgress(save, NOW + 100);
    expect(reset.coins).toBe(0);
    expect(reset.games).toEqual({});
    expect(reset.settings).toEqual({ sound: false, vibration: true });
  });

  it('산 꾸미기도 지우고 기본으로 되돌린다', () => {
    const bought = buyCosmetic({ ...createDefaultSave(NOW), coins: 200 }, 'runner-ghost', NOW);
    if (!bought.ok) throw new Error('구매 실패');
    expect(resetProgress(bought.save, NOW + 100).cosmetics).toEqual(createCosmetics());
  });

  it('받은 업적 보상 기록도 지운다', () => {
    const played = applyPlayResult(createDefaultSave(NOW), 'g', 10, 0, NOW).save;
    const claimed = claimAchievement(played, 'play-first', NOW);
    if (!claimed.ok) throw new Error('보상 받기 실패');
    expect(resetProgress(claimed.save, NOW + 100).achievements).toEqual({ claimed: [] });
  });

  it('오늘의 도전 기록도 지운다', () => {
    const challenge: DailyChallenge = { dateKey: '2026-11-11', gameId: 'g', target: 1, reward: 15 };
    const save = applyPlayResult(createDefaultSave(NOW), 'g', 10, 0, NOW, challenge).save;
    expect(resetProgress(save, NOW + 100).daily).toEqual({
      lastClearedOn: null,
      streak: 0,
      bestStreak: 0,
      totalCleared: 0,
    });
  });
});
