import { describe, expect, it } from 'vitest';
import {
  applyPlayResult,
  createDefaultSave,
  getRecord,
  looksLikeSave,
  normalizeSave,
  resetProgress,
  SAVE_VERSION,
} from './save';

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
      createdAt: NOW - 5000,
      updatedAt: NOW - 1000,
    };
    expect(normalizeSave(save, NOW)).toEqual(save);
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
});
