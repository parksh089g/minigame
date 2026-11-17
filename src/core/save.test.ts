import { describe, expect, it } from 'vitest';
import type { DailyChallenge } from './daily';
import {
  applyPlayResult,
  applyStageClear,
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
  settleLastWeek,
  SAVE_VERSION,
  SCORE_RESETS,
  toggleFavorite,
} from './save';
import { createCosmetics } from './shop';
import { MILESTONE_COINS, STAGE_COINS } from './stages';
import { createWeekly, MISSION_RULES, missionsFor, pickedGame, type WeekContext, type WeeklyGame } from './weekly';
import { newRun, spin } from '../games/candy-slot/rules';
import { packRun, RUN_VERSION, withFound, withRun } from '../games/candy-slot/save';

const NOW = 1_700_000_000_000;

/** 한 번 돌린 행운 슬롯의 판 */
function slotRun() {
  const result = spin(newRun(), () => 0);
  if (!result) throw new Error('돌릴 수 없는 판');
  return result.run;
}

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
      settings: { sound: false, music: false, vibration: true, colorAssist: true },
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
        week: { key: '2026-11-09', bests: { 'lightning-tap': 70 }, sent: { 'lightning-tap': 55 } },
        day: { key: 20767, bests: { 'lantern-keeper': 700 }, sent: {} },
      },
      volume: { sound: 1, music: 3 },
      favorites: ['stack-tower', 'lightning-tap'],
      weekly: {
        weekKey: '2026-11-09',
        plays: { 'lightning-tap': 2 },
        coins: 14,
        dailyClears: 1,
        claimed: ['easy'],
      },
      stages: { 'color-sort': 12, 'number-puzzle': 1 },
      slot: { found: ['piggy', 'wide'], run: packRun(slotRun()) },
      createdAt: NOW - 5000,
      updatedAt: NOW - 1000,
    };
    expect(save.slot.run).not.toBeNull();
    expect(normalizeSave(save, NOW)).toEqual(save);
  });

  it('행운 슬롯의 도감과 이어 하기가 생기기 전의 세이브는 빈 도감과 판 없음으로 읽는다', () => {
    const old = normalizeSave(
      { version: 9, coins: 3, games: { 'candy-slot': { best: 120, plays: 2, lastPlayedAt: NOW } }, stages: { 'color-sort': 4 } },
      NOW,
    );
    expect(old.version).toBe(SAVE_VERSION);
    expect(old.slot).toEqual({ found: [], run: null });
    expect(old.coins).toBe(3);
    expect(old.games['candy-slot'].best).toBe(120);
    expect(old.stages).toEqual({ 'color-sort': 4 });
    expect(createDefaultSave(NOW).slot).toEqual({ found: [], run: null });
  });

  it('행운 슬롯의 하던 판이 깨졌으면 그 판만 버리고 도감과 나머지는 살린다', () => {
    const run = { version: RUN_VERSION, run: { ...slotRun(), charms: ['no-such-charm'] } };
    const save = normalizeSave({ version: SAVE_VERSION, coins: 9, games: {}, slot: { found: ['piggy', 'gone'], run } }, NOW);
    expect(save.slot).toEqual({ found: ['piggy'], run: null });
    expect(save.coins).toBe(9);
    expect(normalizeSave({ version: SAVE_VERSION, games: {}, slot: 'broken' }, NOW).slot).toEqual({ found: [], run: null });
  });

  it('단계 모드가 생기기 전의 세이브는 깬 단계가 없는 채로 읽는다', () => {
    const old = normalizeSave({ version: 8, coins: 3, games: { g: { best: 5, plays: 2, lastPlayedAt: NOW } } }, NOW);
    expect(old.version).toBe(SAVE_VERSION);
    expect(old.stages).toEqual({});
    expect(old.coins).toBe(3);
    expect(old.games.g.best).toBe(5);
  });

  it('깬 단계의 기록이 이상하면 그 게임만 버린다', () => {
    const save = normalizeSave({ stages: { 'color-sort': 7, 'parking-out': -1, 'logic-tiles': 'x' } }, NOW);
    expect(save.stages).toEqual({ 'color-sort': 7 });
    expect(normalizeSave({ stages: [3, 4] }, NOW).stages).toEqual({});
  });

  it('주간 미션이 생기기 전의 세이브는 주간 기록이 빈 채로 읽는다', () => {
    const old = normalizeSave({ version: 6, coins: 3, games: { g: { best: 5, plays: 2, lastPlayedAt: NOW } } }, NOW);
    expect(old.weekly).toEqual(createWeekly());
    expect(old.coins).toBe(3);
    expect(old.version).toBe(SAVE_VERSION);
  });

  it('색 구분 도우미는 처음에 꺼져 있고, 켠 것은 그대로 읽힌다', () => {
    expect(createDefaultSave(NOW).settings.colorAssist).toBe(false);
    const on = normalizeSave({ version: SAVE_VERSION, games: {}, settings: { colorAssist: true } }, NOW);
    expect(on.settings).toEqual({ sound: true, music: true, vibration: true, colorAssist: true });
    const broken = normalizeSave({ version: SAVE_VERSION, games: {}, settings: { colorAssist: 'on' } }, NOW);
    expect(broken.settings.colorAssist).toBe(false);
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

  it('소리 크기 조절이 생기기 전의 세이브는 보통 크기로 읽는다', () => {
    const old = { version: 7, coins: 3, settings: { sound: false, music: true, vibration: true } };
    const save = normalizeSave(old, NOW);
    expect(save.volume).toEqual({ sound: 2, music: 2 });
    expect(save.settings.sound).toBe(false);
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
    expect(normalizeSave(old, NOW).online).toEqual({
      id: null,
      name: null,
      sentName: null,
      sent: {},
      week: null,
      day: null,
    });
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
    // 이 세이브보다 뒤에 생긴 설정: 배경 음악은 켠 채로, 색 구분 도우미는 꺼진 채로 읽는다
    expect(save.settings).toEqual({ ...old.settings, music: true, colorAssist: false });
    expect(save.daily).toEqual({ lastClearedOn: null, streak: 0, bestStreak: 0, totalCleared: 0, recent: [] });
  });

  it('배경 음악 설정이 생기기 전의 세이브는 음악을 켠 채로 읽고, 끈 것은 그대로 둔다', () => {
    const old = { version: 5, coins: 1, settings: { sound: false, vibration: true }, games: {} };
    expect(normalizeSave(old, NOW).settings).toEqual({
      sound: false,
      music: true,
      vibration: true,
      colorAssist: false,
    });
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
    expect(save.settings).toEqual({ sound: true, music: true, vibration: true, colorAssist: false });
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

  it('랭킹이 있는 게임의 점수는 이번 주 랭킹에 올릴 기록으로도 적는다', () => {
    // NOW는 한국 시각으로 2023년 11월 15일 수요일이다. 그 주의 월요일은 13일.
    let save = applyPlayResult(createDefaultSave(NOW), 'lightning-tap', 42, 4, NOW).save;
    expect(save.online.week).toEqual({ key: '2023-11-13', bests: { 'lightning-tap': 42 }, sent: {} });
    save = applyPlayResult(save, 'lightning-tap', 30, 4, NOW + 1000).save;
    save = applyPlayResult(save, 'not-ranked', 99, 4, NOW + 2000).save;
    expect(save.online.week?.bests).toEqual({ 'lightning-tap': 42 });
    // 다음 주에는 최고 기록보다 낮은 점수여도 그 주의 기록이 된다.
    const week = 7 * 24 * 60 * 60 * 1000;
    const next = applyPlayResult(save, 'lightning-tap', 10, 4, NOW + week);
    expect(next.isNewBest).toBe(false);
    expect(next.save.online.week).toEqual({ key: '2023-11-20', bests: { 'lightning-tap': 10 }, sent: {} });
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

  it('기록에 넣지 않는 판(ranked가 false)은 한 판으로 세고 코인은 주되, 최고 기록과 이번 주 랭킹의 기록은 그대로 둔다', () => {
    // 행운 슬롯의 오늘의 판처럼 운이 정해져 있어서 여느 판과 견줄 수 없는 판이다(10차 검토 S10).
    const first = applyPlayResult(createDefaultSave(NOW), 'candy-slot', 300, 6, NOW).save;
    expect(first.online.week?.bests).toEqual({ 'candy-slot': 300 });
    const daily = applyPlayResult(first, 'candy-slot', 6000, 120, NOW + 10, null, null, false);
    expect(daily.ranked).toBe(false);
    expect(daily.isNewBest).toBe(false);
    expect(daily.best).toBe(300);
    expect(daily.previousBest).toBe(300);
    expect(daily.coinsEarned).toBe(120);
    expect(daily.save.coins).toBe(126);
    expect(daily.save.games['candy-slot']).toEqual({ best: 300, plays: 2, lastPlayedAt: NOW + 10 });
    expect(daily.save.online).toEqual(first.online);
    // 여느 판은 그대로 기록한다.
    const normal = applyPlayResult(daily.save, 'candy-slot', 400, 8, NOW + 20);
    expect(normal.ranked).toBe(true);
    expect(normal.isNewBest).toBe(true);
    expect(normal.save.online.week?.bests).toEqual({ 'candy-slot': 400 });
  });

  it('기록에 넣지 않는 판도 오늘의 도전은 따진다', () => {
    const challenge: DailyChallenge = { dateKey: '2023-11-15', gameId: 'candy-slot', target: 100, reward: 25 };
    const result = applyPlayResult(createDefaultSave(NOW), 'candy-slot', 150, 3, NOW, challenge, null, false);
    expect(result.daily?.cleared).toBe(true);
    expect(result.best).toBe(0);
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
    save.settings.colorAssist = true;
    save = applyPlayResult(save, 'g', 10, 7, NOW).save;
    const reset = resetProgress(save, NOW + 100);
    expect(reset.coins).toBe(0);
    expect(reset.games).toEqual({});
    expect(reset.settings).toEqual({ sound: false, music: true, vibration: true, colorAssist: true });
  });

  it('소리 크기는 설정이라 남긴다', () => {
    const save = createDefaultSave(NOW);
    save.volume = { sound: 3, music: 1 };
    const reset = resetProgress(save, NOW + 100);
    expect(reset.volume).toEqual({ sound: 3, music: 1 });
    expect(reset.volume).not.toBe(save.volume);
  });

  it('닉네임은 남긴다(온라인 랭킹의 기록은 랭킹 화면에서 따로 뺀다)', () => {
    const save = createDefaultSave(NOW);
    save.online = {
      id: '01112131-4151-6171-8191-a1b1c1d1e1f1',
      name: '등불지기',
      sentName: '등불지기',
      sent: { 'lightning-tap': 80 },
      week: { key: '2026-11-09', bests: { 'lightning-tap': 60 }, sent: { 'lightning-tap': 60 } },
      day: null,
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

  it('행운 슬롯의 도감과 하던 판도 지운다', () => {
    const save = createDefaultSave(NOW);
    save.slot = withRun(withFound(save.slot, 'piggy'), slotRun());
    expect(save.slot.found).toEqual(['piggy']);
    expect(save.slot.run).not.toBeNull();
    expect(resetProgress(save, NOW + 100).slot).toEqual({ found: [], run: null });
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
    expect(first.save.weekly).toEqual({
      weekKey: WEEK,
      plays: { p1: 1 },
      coins: 2,
      dailyClears: 0,
      claimed: [],
      rules: MISSION_RULES,
    });
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
    // 새 주는 "이번 주의 게임" 미션이 나오는 주라서, 뽑힌 게임이 기록에 함께 적힌다.
    const pick = pickedGame(next);
    expect(pick).not.toBeNull();
    expect(played.save.weekly).toEqual({
      weekKey: NEXT_WEEK,
      plays: { a1: 1 },
      coins: 3,
      dailyClears: 0,
      claimed: [],
      pick,
      rules: MISSION_RULES,
    });
  });

  it('주가 바뀌면 지난주에 받지 않은 보상을 넣어 주고, 두 번 주지 않는다', () => {
    const done = playDifferent(easy.goal).save;
    const settled = settleLastWeek(done, NEXT_WEEK, GAMES, NOW + 500);
    expect(settled.missions.map((mission) => mission.id)).toContain('easy');
    expect(settled.coins).toBe(settled.missions.reduce((sum, mission) => sum + mission.reward, 0));
    expect(settled.save.coins).toBe(done.coins + settled.coins);
    expect(settled.save.weekly).toEqual({ ...createWeekly(), weekKey: NEXT_WEEK });
    expect(settled.save.updatedAt).toBe(NOW + 500);
    // 원본은 그대로이고, 한 번 더 불러도 더 주지 않는다.
    expect(done.weekly.weekKey).toBe(WEEK);
    const again = settleLastWeek(settled.save, NEXT_WEEK, GAMES, NOW + 900);
    expect(again.coins).toBe(0);
    expect(again.save).toBe(settled.save);
  });

  it('허브를 거치지 않고 주가 바뀌어도, 새 주의 첫 판이 지난주에 받지 않은 보상을 먼저 넣어 준다', () => {
    const done = playDifferent(easy.goal).save;
    const owed = settleLastWeek(done, NEXT_WEEK, GAMES).coins;
    expect(owed).toBeGreaterThan(0);
    const played = applyPlayResult(done, 'a1', 10, 3, NOW + 100, null, { ...next, games: GAMES });
    expect(played.lastWeekCoins).toBe(owed);
    expect(played.save.coins).toBe(done.coins + owed + 3);
    // 이 판은 새 주의 첫 판으로 센다.
    expect(played.save.weekly.weekKey).toBe(NEXT_WEEK);
    expect(played.save.weekly.plays).toEqual({ a1: 1 });
    expect(played.save.weekly.coins).toBe(3);
    // 다음 판에서도, 허브에서 다시 따져도 두 번 주지 않는다.
    const again = applyPlayResult(played.save, 'a1', 10, 3, NOW + 200, null, { ...next, games: GAMES });
    expect(again.lastWeekCoins).toBe(0);
    expect(again.save.coins).toBe(played.save.coins + 3);
    expect(settleLastWeek(played.save, NEXT_WEEK, GAMES).coins).toBe(0);
  });

  it('같은 주의 판이거나 게임 목록을 모르면 지난주 보상을 따지지 않는다', () => {
    const done = playDifferent(easy.goal).save;
    const same = applyPlayResult(done, 'a1', 10, 3, NOW + 100, null, { ...week, games: GAMES });
    expect(same.lastWeekCoins).toBe(0);
    expect(same.save.coins).toBe(done.coins + 3);
    // 게임 목록이 없으면 예전처럼 새 주로 넘어가기만 한다.
    expect(applyPlayResult(done, 'a1', 10, 3, NOW + 100, null, next).lastWeekCoins).toBe(0);
  });

  it('주가 바뀐 뒤 처음 깬 단계도 지난주 보상을 먼저 넣어 준다', () => {
    const done = playDifferent(easy.goal).save;
    const owed = settleLastWeek(done, NEXT_WEEK, GAMES).coins;
    const cleared = applyStageClear(done, 'p1', 1, NOW + 100, { ...next, games: GAMES });
    expect(cleared?.lastWeekCoins).toBe(owed);
    expect(cleared?.save.coins).toBe(done.coins + owed + STAGE_COINS);
    expect(cleared?.save.weekly.weekKey).toBe(NEXT_WEEK);
  });

  it('같은 주이거나, 이미 받았거나, 덜 채웠으면 넣어 줄 것이 없다', () => {
    const done = playDifferent(easy.goal).save;
    expect(settleLastWeek(done, WEEK, GAMES).save).toBe(done);
    const claimed = claimWeeklyMission(done, week, 'easy', NOW);
    if (!claimed.ok) throw new Error('보상 받기 실패');
    const rest = settleLastWeek(claimed.save, NEXT_WEEK, GAMES);
    expect(rest.missions.map((mission) => mission.id)).not.toContain('easy');
    const short = playDifferent(easy.goal - 1).save;
    expect(settleLastWeek(short, NEXT_WEEK, GAMES).missions.map((mission) => mission.id)).not.toContain('easy');
    // 기록이 없는 세이브
    const fresh = createDefaultSave(NOW);
    expect(settleLastWeek(fresh, NEXT_WEEK, GAMES).save).toBe(fresh);
  });

  it('이번 주의 게임을 적어 두어, 주 중간에 게임이 늘어도 채우던 미션이 바뀌지 않는다', () => {
    const pick = pickedGame(next) ?? '';
    const played = applyPlayResult(createDefaultSave(NOW), pick, 10, 3, NOW, null, next).save;
    // 목록 맨 앞에 게임이 하나 늘어난 버전
    const grown: WeeklyGame[] = [{ id: 'new', title: '새 게임', genre: 'puzzle', quick: true }, ...GAMES];
    const moved = missionsFor(NEXT_WEEK, grown).find((mission) => mission.kind === 'game');
    const kept = missionsFor(NEXT_WEEK, grown, played.weekly.pick).find((mission) => mission.kind === 'game');
    expect(moved?.counts).not.toEqual([pick]);
    expect(kept?.counts).toEqual([pick]);
    // 내보냈다 가져와도 남는다.
    expect(normalizeSave(JSON.parse(JSON.stringify(played))).weekly.pick).toBe(pick);
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

describe('단계 모드', () => {
  it('다음 단계를 깨면 기록이 오르고 코인을 받는다', () => {
    const result = applyStageClear(createDefaultSave(NOW), 'color-sort', 1, NOW + 5);
    expect(result).not.toBeNull();
    expect(result?.first).toBe(true);
    expect(result?.level).toBe(1);
    expect(result?.coinsEarned).toBe(STAGE_COINS);
    expect(result?.save.stages).toEqual({ 'color-sort': 1 });
    expect(result?.save.coins).toBe(STAGE_COINS);
    expect(result?.save.updatedAt).toBe(NOW + 5);
  });

  it('열 단계째는 코인을 더 받는다', () => {
    const save = { ...createDefaultSave(NOW), stages: { 'color-sort': 9 } };
    expect(applyStageClear(save, 'color-sort', 10, NOW)?.coinsEarned).toBe(MILESTONE_COINS);
  });

  it('이미 깬 단계를 다시 깨면 코인은 없고 기록도 그대로다', () => {
    const save = { ...createDefaultSave(NOW), coins: 20, stages: { 'color-sort': 5 } };
    const result = applyStageClear(save, 'color-sort', 3, NOW);
    expect(result?.first).toBe(false);
    expect(result?.coinsEarned).toBe(0);
    expect(result?.save.coins).toBe(20);
    expect(result?.save.stages).toEqual({ 'color-sort': 5 });
  });

  it('아직 열리지 않은 단계는 기록하지 않는다', () => {
    const save = createDefaultSave(NOW);
    expect(applyStageClear(save, 'color-sort', 2, NOW)).toBeNull();
    expect(applyStageClear(save, 'color-sort', 0, NOW)).toBeNull();
  });

  it('한 판 한 것으로 세지만 최고 점수는 건드리지 않는다', () => {
    const played = applyPlayResult(createDefaultSave(NOW), 'color-sort', 240, 4, NOW).save;
    const result = applyStageClear(played, 'color-sort', 1, NOW + 10);
    expect(getRecord(result!.save, 'color-sort')).toEqual({ best: 240, plays: 2, lastPlayedAt: NOW + 10 });
  });

  it('처음 깬 단계로 달성한 업적을 알린다: 첫 판과 첫 단계', () => {
    const result = applyStageClear(createDefaultSave(NOW), 'color-sort', 1, NOW);
    expect(result?.newAchievements.map((achievement) => achievement.id).sort()).toEqual(['play-first', 'stage-first']);
  });

  it('깬 단계가 쌓여서 달성한 업적도 알리고, 이미 달성한 것은 다시 알리지 않는다', () => {
    const save = {
      ...createDefaultSave(NOW),
      games: { 'color-sort': { best: 0, plays: 29, lastPlayedAt: NOW } },
      stages: { 'color-sort': 29 },
    };
    const result = applyStageClear(save, 'color-sort', 30, NOW);
    expect(result?.newAchievements.map((achievement) => achievement.id).sort()).toEqual(['play-30', 'stage-30']);
    const again = applyStageClear(result!.save, 'color-sort', 30, NOW);
    expect(again?.newAchievements).toEqual([]);
  });

  it('세 번째 게임에서 첫 단계를 깨면 여러 게임의 업적을 달성한다', () => {
    const save = {
      ...createDefaultSave(NOW),
      games: {
        'color-sort': { best: 0, plays: 2, lastPlayedAt: NOW },
        'parking-out': { best: 0, plays: 1, lastPlayedAt: NOW },
      },
      stages: { 'color-sort': 2, 'parking-out': 1 },
    };
    const ids = applyStageClear(save, 'pin-pull', 1, NOW)?.newAchievements.map((achievement) => achievement.id);
    expect(ids).toContain('stage-variety');
  });

  it('다른 게임의 단계 기록은 그대로 둔다', () => {
    const save = { ...createDefaultSave(NOW), stages: { 'parking-out': 4 } };
    expect(applyStageClear(save, 'color-sort', 1, NOW)?.save.stages).toEqual({ 'parking-out': 4, 'color-sort': 1 });
  });

  it('원본 세이브를 바꾸지 않는다', () => {
    const original = createDefaultSave(NOW);
    applyStageClear(original, 'color-sort', 1, NOW + 5);
    expect(original).toEqual(createDefaultSave(NOW));
  });

  it('깬 단계와 받은 코인이 주간 미션에 더해진다', () => {
    const games: WeeklyGame[] = [
      { id: 'color-sort', title: '색깔 물 나누기', genre: 'puzzle', quick: true },
      { id: 'lightning-tap', title: '번개 탭', genre: 'action', quick: true },
      { id: 'stack-tower', title: '탑 쌓기', genre: 'action', quick: true },
    ];
    const weekKey = '2026-11-09';
    const week: WeekContext = { weekKey, missions: missionsFor(weekKey, games) };
    const result = applyStageClear(createDefaultSave(NOW), 'color-sort', 1, NOW, week);
    expect(result?.save.weekly.weekKey).toBe(weekKey);
    expect(result?.save.weekly.plays).toEqual({ 'color-sort': 1 });
    expect(result?.save.weekly.coins).toBe(STAGE_COINS);
  });

  it('진행을 지우면 깬 단계도 지워진다', () => {
    const cleared = applyStageClear(createDefaultSave(NOW), 'color-sort', 1, NOW)!.save;
    expect(resetProgress(cleared, NOW + 1).stages).toEqual({});
  });
});

describe('점수 세는 법이 바뀐 게임의 옛 기록', () => {
  const GARDEN = 'garden-guard';
  const ID = '01112131-4151-6171-8191-a1b1c1d1e1f1';
  const WEEK = '2026-11-16';
  /** 텃밭 지키기의 점수가 "몇째 날까지 갔는지"였던 때의 세이브 */
  const old = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    version: 9,
    coins: 100,
    games: {
      [GARDEN]: { best: 5000, plays: 12, lastPlayedAt: NOW - 1000 },
      'stack-tower': { best: 40, plays: 3, lastPlayedAt: NOW - 2000 },
    },
    ...extra,
  });

  it('텃밭 지키기의 새 규칙은 세이브 11부터다', () => {
    expect(SCORE_RESETS).toEqual([{ since: 11, game: GARDEN }]);
    expect(SAVE_VERSION).toBeGreaterThanOrEqual(11);
  });

  it('세이브 10(행운 슬롯의 도감이 들어온 버전)에 적힌 점수도 옛 규칙으로 낸 것이라 비운다', () => {
    const save = normalizeSave({ ...old(), version: 10 }, NOW);
    expect(save.games[GARDEN]).toEqual({ best: 0, plays: 12, lastPlayedAt: NOW - 1000 });
    expect(save.achievements.claimed).toEqual(['garden-1000', 'garden-3000']);
    expect(save.coins).toBe(170);
  });

  it('옛 세이브를 읽으면 그 게임의 최고 점수만 비운다. 판 수와 마지막으로 한 때, 다른 게임의 기록은 그대로다', () => {
    const save = normalizeSave(old(), NOW);
    expect(save.version).toBe(SAVE_VERSION);
    expect(save.games[GARDEN]).toEqual({ best: 0, plays: 12, lastPlayedAt: NOW - 1000 });
    expect(save.games['stack-tower']).toEqual({ best: 40, plays: 3, lastPlayedAt: NOW - 2000 });
  });

  it('새 규칙으로 저장한 세이브의 기록은 건드리지 않는다', () => {
    const raw = { ...old(), version: 11, achievements: { claimed: [] } };
    const save = normalizeSave(raw, NOW);
    expect(save.games[GARDEN].best).toBe(5000);
    expect(save.coins).toBe(100);
    expect(save.achievements.claimed).toEqual([]);
    // 한 번 고친 세이브를 다시 읽어도 달라지지 않는다.
    const once = normalizeSave(old(), NOW);
    expect(normalizeSave(JSON.parse(JSON.stringify(once)), NOW)).toEqual(once);
  });

  it('옛 점수로 이뤄 놓고 받지 않은 업적은 보상을 넣어 주고 받은 것으로 적는다', () => {
    // 1000점 업적(20코인)은 이미 받았고, 3000점 업적(50코인)은 이루기만 했다.
    const save = normalizeSave(old({ achievements: { claimed: ['garden-1000'] } }), NOW);
    expect(save.coins).toBe(150);
    expect(save.achievements.claimed).toEqual(['garden-1000', 'garden-3000']);
    // 다른 게임의 기록으로 이룬 업적은 그대로 받을 수 있는 채로 남는다(여기서 대신 받지 않는다).
    const tower = normalizeSave(
      old({ games: { [GARDEN]: { best: 1200, plays: 2, lastPlayedAt: NOW }, 'stack-tower': { best: 9999, plays: 3, lastPlayedAt: NOW } } }),
      NOW,
    );
    expect(tower.achievements.claimed).toEqual(['garden-1000']);
    expect(tower.coins).toBe(120);
    expect(tower.games['stack-tower'].best).toBe(9999);
  });

  it('이미 받은 업적에 새 점수로 다시 닿아도 새로 이룬 것으로 알리지 않는다', () => {
    const save = normalizeSave(old({ achievements: { claimed: ['garden-1000'] } }), NOW);
    const result = applyPlayResult(save, GARDEN, 1200, 12, NOW);
    expect(result.best).toBe(1200);
    expect(result.isNewBest).toBe(true);
    expect(result.newAchievements.map((achievement) => achievement.id)).not.toContain('garden-1000');
    expect(result.save.achievements.claimed).toEqual(['garden-1000', 'garden-3000']);
  });

  it('서버에 올렸다는 표시와 이번 주에 낸 옛 점수도 지워서, 새 점수가 처음부터 올라가게 한다', () => {
    const online = {
      id: ID,
      name: '등불지기',
      sentName: '등불지기',
      sent: { [GARDEN]: 5000, 'stack-tower': 40 },
      week: { key: WEEK, bests: { [GARDEN]: 5000, 'stack-tower': 40 }, sent: { [GARDEN]: 5000 } },
    };
    const save = normalizeSave(old({ online }), NOW);
    expect(save.online.sent).toEqual({ 'stack-tower': 40 });
    expect(save.online.week).toEqual({ key: WEEK, bests: { 'stack-tower': 40 }, sent: {} });
    expect(save.online.name).toBe('등불지기');
  });

  it('그 게임을 해 본 적이 없는 옛 세이브는 버전만 오른다', () => {
    const raw = { version: 9, coins: 7, games: { 'stack-tower': { best: 40, plays: 3, lastPlayedAt: NOW } } };
    const save = normalizeSave(raw, NOW);
    expect(save.coins).toBe(7);
    expect(save.games).toEqual({ 'stack-tower': { best: 40, plays: 3, lastPlayedAt: NOW } });
    expect(save.achievements.claimed).toEqual([]);
  });
});
