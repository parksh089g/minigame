import { describe, expect, it } from 'vitest';
import type { DailyChallenge } from './daily';
import {
  applyPlayResult,
  buyCosmetic,
  claimAchievement,
  claimWeeklyMission,
  createDefaultSave,
  equipCosmetic,
  getRecord,
  isFavorite,
  looksLikeSave,
  MAX_FAVORITES,
  MIN_COINS_PER_PLAY,
  normalizeSave,
  resetProgress,
  SAVE_VERSION,
  toggleFavorite,
} from './save';
import { createCosmetics } from './shop';
import { createWeekly, missionsFor, type WeekContext, type WeeklyGame } from './weekly';

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
      settings: { sound: false, music: false, vibration: true },
      games: { 'lightning-tap': { best: 80, plays: 4, lastPlayedAt: NOW - 1000 } },
      daily: {
        lastClearedOn: '2026-11-11',
        streak: 3,
        bestStreak: 4,
        totalCleared: 8,
        recent: ['2026-11-06', '2026-11-09', '2026-11-10', '2026-11-11'],
      },
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
      online: {
        id: '01112131-4151-6171-8191-a1b1c1d1e1f1',
        name: '등불지기',
        sentName: '등불지기',
        sent: { 'lightning-tap': 80 },
      },
      favorites: ['stack-tower', 'lightning-tap'],
      weekly: {
        weekKey: '2026-11-09',
        plays: { 'lightning-tap': 2 },
        coins: 14,
        dailyClears: 1,
        claimed: ['easy'],
      },
      createdAt: NOW - 5000,
      updatedAt: NOW - 1000,
    };
    expect(normalizeSave(save, NOW)).toEqual(save);
  });

  it('주간 미션이 생기기 전의 세이브는 주간 기록이 빈 채로 읽는다', () => {
    const old = normalizeSave({ version: 6, coins: 3, games: { g: { best: 5, plays: 2, lastPlayedAt: NOW } } }, NOW);
    expect(old.weekly).toEqual(createWeekly());
    expect(old.coins).toBe(3);
    expect(old.version).toBe(SAVE_VERSION);
  });

  it('깨진 주간 기록은 버리고 나머지는 살린다', () => {
    const save = normalizeSave({ version: SAVE_VERSION, coins: 9, games: {}, weekly: { weekKey: '엉뚱한 값' } }, NOW);
    expect(save.weekly).toEqual(createWeekly());
    expect(save.coins).toBe(9);
  });

  it('즐겨찾기가 생기기 전의 세이브는 즐겨찾기가 빈 채로 읽는다', () => {
    const old = { version: 5, coins: 3, games: { g: { best: 9, plays: 2, lastPlayedAt: NOW } } };
    const save = normalizeSave(old, NOW);
    expect(save.favorites).toEqual([]);
    expect(save.games.g.best).toBe(9);
  });

  it('즐겨찾기는 문자열만 남기고 겹치는 것을 뺀다', () => {
    const raw = { version: SAVE_VERSION, games: {}, favorites: ['a', 7, 'b', '', null, 'a'] };
    expect(normalizeSave(raw, NOW).favorites).toEqual(['a', 'b']);
    expect(normalizeSave({ version: SAVE_VERSION, games: {}, favorites: 'a' }, NOW).favorites).toEqual([]);
    const many = Array.from({ length: MAX_FAVORITES + 10 }, (_, index) => `game-${index}`);
    expect(
      normalizeSave({ version: SAVE_VERSION, games: {}, favorites: many }, NOW).favorites,
    ).toHaveLength(MAX_FAVORITES);
  });

  it('온라인 기능이 생기기 전의 세이브는 랭킹에 참여하지 않은 상태로 읽는다', () => {
    const old = {
      version: 4,
      coins: 3,
      settings: { sound: true, vibration: true },
      games: { 'lightning-tap': { best: 80, plays: 4, lastPlayedAt: NOW - 1000 } },
      createdAt: NOW - 5000,
      updatedAt: NOW - 1000,
    };
    expect(normalizeSave(old, NOW).online).toEqual({ id: null, name: null, sentName: null, sent: {} });
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
    // 최근에 달성한 날은 이 세이브보다 뒤에 생겼으므로, 이어지고 있는 연속으로 채운다
    expect(save.daily).toEqual({ ...old.daily, bestStreak: 2, recent: ['2026-11-10', '2026-11-11'] });
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
    // 배경 음악 설정은 이 세이브보다 뒤에 생겼으므로 켠 채로 읽는다
    expect(save.settings).toEqual({ ...old.settings, music: true });
    expect(save.daily).toEqual({ lastClearedOn: null, streak: 0, bestStreak: 0, totalCleared: 0, recent: [] });
  });

  it('배경 음악 설정이 생기기 전의 세이브는 음악을 켠 채로 읽고, 끈 것은 그대로 둔다', () => {
    const old = { version: 5, coins: 1, settings: { sound: false, vibration: true }, games: {} };
    expect(normalizeSave(old, NOW).settings).toEqual({ sound: false, music: true, vibration: true });
    const off = { ...old, settings: { sound: true, music: false, vibration: true } };
    expect(normalizeSave(off, NOW).settings.music).toBe(false);
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
    expect(save.settings).toEqual({ sound: true, music: true, vibration: true });
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

  it('점수를 냈으면 받을 코인이 없어도 한 판에 적어도 1코인을 준다', () => {
    const result = applyPlayResult(createDefaultSave(NOW), 'g', 7, 0, NOW);
    expect(MIN_COINS_PER_PLAY).toBe(1);
    expect(result.coinsEarned).toBe(1);
    expect(result.save.coins).toBe(1);
  });

  it('0점이면 코인을 주지 않는다', () => {
    const result = applyPlayResult(createDefaultSave(NOW), 'g', 0, 0, NOW);
    expect(result.coinsEarned).toBe(0);
    expect(result.save.coins).toBe(0);
  });

  it('점수로 얻은 코인이 더 많으면 그대로 준다', () => {
    expect(applyPlayResult(createDefaultSave(NOW), 'g', 90, 9, NOW).coinsEarned).toBe(9);
    expect(applyPlayResult(createDefaultSave(NOW), 'g', 12, 1, NOW).coinsEarned).toBe(1);
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
      recent: ['2026-11-11'],
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
    const first = applyPlayResult(createDefaultSave(NOW), 'g', 150, 6, NOW, challenge).save;
    expect(first.coins).toBe(6 + 25);
    const again = applyPlayResult(first, 'g', 300, 6, NOW + 10, challenge);
    expect(again.daily).toBeNull();
    expect(again.save.coins).toBe(6 + 25 + 6);
    expect(again.save.daily).toEqual(first.daily);
  });

  it('다음 날에도 달성하면 연속 보너스가 붙는다', () => {
    const first = applyPlayResult(createDefaultSave(NOW), 'g', 150, 6, NOW, challenge).save;
    const second = applyPlayResult(first, 'g', 120, 6, NOW + 10, nextDay);
    expect(second.daily).toEqual({ cleared: true, reward: 15 + 5, streak: 2, shortBy: 0 });
    expect(second.save.coins).toBe(6 + 25 + 6 + 20);
    expect(second.save.daily).toEqual({
      lastClearedOn: '2026-11-12',
      streak: 2,
      bestStreak: 2,
      totalCleared: 2,
      recent: ['2026-11-11', '2026-11-12'],
    });
  });

  it('기기 시계를 달성한 날보다 앞으로 되돌려도 보상을 다시 받지 못한다', () => {
    const cleared = applyPlayResult(createDefaultSave(NOW), 'g', 150, 6, NOW, nextDay).save;
    // 하루 전 날짜의 도전을 다시 넘긴다.
    const rolledBack = applyPlayResult(cleared, 'g', 300, 6, NOW + 10, challenge);
    expect(rolledBack.daily).toBeNull();
    expect(rolledBack.save.coins).toBe(cleared.coins + 6);
    expect(rolledBack.save.daily).toEqual(cleared.daily);
    // 목표에 못 미친 판도 "모자란 점수" 안내 없이 지나간다.
    expect(applyPlayResult(cleared, 'g', 1, 0, NOW + 10, challenge).daily).toBeNull();
  });
});

describe('꾸미기 사기와 끼우기', () => {
  const rich = (): ReturnType<typeof createDefaultSave> => ({ ...createDefaultSave(NOW), coins: 120 });

  it('사면 코인이 줄고 바로 끼워진다', () => {
    const save = rich();
    const result = buyCosmetic(save, 'backdrop-forest', NOW + 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.item.name).toBe('민트 숲');
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

describe('즐겨찾기', () => {
  it('넣고 빼기를 번갈아 하고, 원본 세이브는 바꾸지 않는다', () => {
    const save = createDefaultSave(NOW);
    const added = toggleFavorite(save, 'stack-tower', NOW + 10);
    expect(added.favorites).toEqual(['stack-tower']);
    expect(added.updatedAt).toBe(NOW + 10);
    expect(isFavorite(added, 'stack-tower')).toBe(true);
    expect(save.favorites).toEqual([]);

    const more = toggleFavorite(added, 'merge-tiles', NOW + 20);
    expect(more.favorites).toEqual(['stack-tower', 'merge-tiles']);

    const removed = toggleFavorite(more, 'stack-tower', NOW + 30);
    expect(removed.favorites).toEqual(['merge-tiles']);
    expect(isFavorite(removed, 'stack-tower')).toBe(false);
  });

  it('자리가 다 찼으면 더 넣지 않고 받은 세이브를 그대로 돌려준다', () => {
    const save = createDefaultSave(NOW);
    save.favorites = Array.from({ length: MAX_FAVORITES }, (_, index) => `game-${index}`);
    expect(toggleFavorite(save, 'one-more', NOW)).toBe(save);
    expect(toggleFavorite(save, '', NOW)).toBe(save);
    // 이미 들어 있는 것은 자리가 차 있어도 뺄 수 있다.
    expect(toggleFavorite(save, 'game-0', NOW).favorites).toHaveLength(MAX_FAVORITES - 1);
  });
});

describe('resetProgress', () => {
  it('즐겨찾기는 설정처럼 남긴다', () => {
    const save = toggleFavorite(createDefaultSave(NOW), 'stack-tower', NOW);
    expect(resetProgress(save, NOW + 100).favorites).toEqual(['stack-tower']);
  });

  it('기록과 코인은 지우고 설정은 남긴다', () => {
    let save = createDefaultSave(NOW);
    save.settings.sound = false;
    save = applyPlayResult(save, 'g', 10, 7, NOW).save;
    const reset = resetProgress(save, NOW + 100);
    expect(reset.coins).toBe(0);
    expect(reset.games).toEqual({});
    expect(reset.settings).toEqual({ sound: false, music: true, vibration: true });
  });

  it('닉네임은 남긴다(온라인 랭킹의 기록은 랭킹 화면에서 따로 뺀다)', () => {
    const save = createDefaultSave(NOW);
    save.online = {
      id: '01112131-4151-6171-8191-a1b1c1d1e1f1',
      name: '등불지기',
      sentName: '등불지기',
      sent: { 'lightning-tap': 80 },
    };
    const reset = resetProgress(save, NOW + 100);
    expect(reset.online).toEqual(save.online);
    expect(reset.online).not.toBe(save.online);
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
      recent: [],
    });
  });
});

describe('주간 미션', () => {
  const GAMES: WeeklyGame[] = [
    { id: 'p1', title: '길 잇기', genre: 'puzzle', quick: true },
    { id: 'p2', title: '머지 타일', genre: 'puzzle', quick: true },
    { id: 'a1', title: '번개 탭', genre: 'action', quick: true },
    { id: 'a2', title: '탑 쌓기', genre: 'action', quick: true },
    { id: 'duo', title: '둘이서 대결', genre: null, quick: false },
  ];
  /** 2026-11-09는 월요일이고, 이 주의 쉬운 미션은 "서로 다른 게임 몇 가지"다. */
  const WEEK = '2026-11-09';
  const NEXT_WEEK = '2026-11-16';
  const week: WeekContext = { weekKey: WEEK, missions: missionsFor(WEEK, GAMES) };
  const next: WeekContext = { weekKey: NEXT_WEEK, missions: missionsFor(NEXT_WEEK, GAMES) };
  const easy = week.missions[0];

  /** 서로 다른 게임을 한 판씩 count번 한다. */
  function playDifferent(count: number, from = createDefaultSave(NOW)) {
    let save = from;
    let last = applyPlayResult(save, GAMES[0].id, 0, 0, NOW, null, null);
    for (let index = 0; index < count; index += 1) {
      last = applyPlayResult(save, GAMES[index].id, 10, 2, NOW + index, null, week);
      save = last.save;
    }
    return last;
  }

  it('이 주의 쉬운 미션은 가짓수 미션이다(아래 테스트들이 기대는 것)', () => {
    expect(easy.kind).toBe('variety');
    expect(easy.goal).toBeLessThanOrEqual(GAMES.length);
  });

  it('주를 넘기지 않으면 주간 기록을 건드리지 않는다', () => {
    const result = applyPlayResult(createDefaultSave(NOW), 'p1', 10, 2, NOW);
    expect(result.save.weekly).toEqual(createWeekly());
    expect(result.newMissions).toEqual([]);
  });

  it('한 판마다 판 수와 얻은 코인을 주간 기록에 더한다', () => {
    const first = applyPlayResult(createDefaultSave(NOW), 'p1', 10, 2, NOW, null, week);
    expect(first.save.weekly).toEqual({ weekKey: WEEK, plays: { p1: 1 }, coins: 2, dailyClears: 0, claimed: [] });
    const second = applyPlayResult(first.save, 'p1', 30, 4, NOW + 1, null, week);
    expect(second.save.weekly.plays).toEqual({ p1: 2 });
    expect(second.save.weekly.coins).toBe(6);
    // 원본은 그대로다.
    expect(first.save.weekly.plays).toEqual({ p1: 1 });
  });

  it('점수를 냈을 때 채워 주는 코인도 주간 기록에 들어간다', () => {
    const result = applyPlayResult(createDefaultSave(NOW), 'p1', 5, 0, NOW, null, week);
    expect(result.coinsEarned).toBe(MIN_COINS_PER_PLAY);
    expect(result.save.weekly.coins).toBe(MIN_COINS_PER_PLAY);
  });

  it('오늘의 도전을 달성하면 그 보상과 달성 횟수도 주간 기록에 들어간다', () => {
    const challenge: DailyChallenge = { dateKey: '2026-11-11', gameId: 'p1', target: 5, reward: 15 };
    const cleared = applyPlayResult(createDefaultSave(NOW), 'p1', 10, 2, NOW, challenge, week);
    expect(cleared.save.weekly.dailyClears).toBe(1);
    expect(cleared.save.weekly.coins).toBe(2 + 15);
    // 같은 날 다시 해도 도전은 한 번만 센다.
    const again = applyPlayResult(cleared.save, 'p1', 10, 2, NOW + 1, challenge, week);
    expect(again.save.weekly.dailyClears).toBe(1);
    expect(again.save.weekly.coins).toBe(2 + 15 + 2);
  });

  it('이 판으로 다 채운 미션만 새로 달성한 것으로 알린다', () => {
    const before = playDifferent(easy.goal - 1);
    expect(before.newMissions).toEqual([]);
    const done = playDifferent(easy.goal);
    expect(done.newMissions.map((mission) => mission.id)).toEqual(['easy']);
    // 이미 다 채운 뒤의 판은 다시 알리지 않는다.
    const after = applyPlayResult(done.save, 'p1', 10, 2, NOW + 50, null, week);
    expect(after.newMissions).toEqual([]);
  });

  it('보상을 받으면 코인이 늘고, 한 번만 받을 수 있다', () => {
    const done = playDifferent(easy.goal).save;
    const claimed = claimWeeklyMission(done, week, 'easy', NOW + 100);
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;
    expect(claimed.mission).toBe(easy);
    expect(claimed.save.coins).toBe(done.coins + easy.reward);
    expect(claimed.save.weekly.claimed).toEqual(['easy']);
    expect(claimed.save.updatedAt).toBe(NOW + 100);
    // 받은 보상은 "게임으로 얻은 코인"에 넣지 않는다.
    expect(claimed.save.weekly.coins).toBe(done.weekly.coins);
    // 원본은 그대로다.
    expect(done.weekly.claimed).toEqual([]);

    expect(claimWeeklyMission(claimed.save, week, 'easy', NOW + 200)).toEqual({ ok: false, reason: 'claimed' });
  });

  it('덜 채운 미션은 받을 수 없다', () => {
    const save = playDifferent(easy.goal - 1).save;
    expect(claimWeeklyMission(save, week, 'easy', NOW)).toEqual({ ok: false, reason: 'incomplete' });
    expect(claimWeeklyMission(save, week, 'bonus', NOW)).toEqual({ ok: false, reason: 'unknown' });
  });

  it('주가 바뀌면 처음부터 다시 세고, 지난주에 채운 미션은 받을 수 없다', () => {
    const done = playDifferent(easy.goal).save;
    expect(claimWeeklyMission(done, next, 'easy', NOW)).toEqual({ ok: false, reason: 'incomplete' });
    const played = applyPlayResult(done, 'a1', 10, 3, NOW + 100, null, next);
    expect(played.save.weekly).toEqual({ weekKey: NEXT_WEEK, plays: { a1: 1 }, coins: 3, dailyClears: 0, claimed: [] });
  });

  it('기기 시계를 되돌려 앞선 주를 넘기면 주간 기록은 그대로이고, 판은 평소처럼 기록된다', () => {
    const later = applyPlayResult(createDefaultSave(NOW), 'p1', 10, 2, NOW, null, next).save;
    const result = applyPlayResult(later, 'p2', 10, 2, NOW + 1, null, week);
    expect(result.save.weekly).toBe(later.weekly);
    expect(result.newMissions).toEqual([]);
    expect(getRecord(result.save, 'p2').plays).toBe(1);
    expect(result.save.coins).toBe(4);
  });

  it('기록을 지우면 주간 기록도 지운다', () => {
    const done = playDifferent(easy.goal).save;
    expect(resetProgress(done, NOW + 100).weekly).toEqual(createWeekly());
  });
});
