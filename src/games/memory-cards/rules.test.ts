import { describe, expect, it } from 'vitest';
import { CARD_SYMBOLS } from '../../art/sprites';
import { GAME_WIDTH, MIN_GAME_HEIGHT } from '../../config';
import {
  boardSize,
  buildDeck,
  cardCenters,
  clearBonus,
  matchPoints,
  pairCount,
  previewMs,
  LARGEST_BOARD_INDEX,
  MIN_PREVIEW_MS,
  PREVIEW_CUT_MS,
  streakBonus,
} from './rules';

/** 시드가 같으면 같은 수열이 나오는 난수(mulberry32). */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const boards = [0, 1, 2, 3, 10].map((index) => boardSize(index));

describe('판 크기', () => {
  it('카드 수는 항상 짝수이고 판이 갈수록 줄지 않는다', () => {
    let previous = 0;
    for (const size of boards) {
      const cards = size.cols * size.rows;
      expect(cards % 2).toBe(0);
      expect(cards).toBeGreaterThanOrEqual(previous);
      previous = cards;
    }
  });

  it('첫 판은 6쌍, 둘째 판은 8쌍, 그 뒤로는 10쌍', () => {
    expect(boards.map(pairCount)).toEqual([6, 8, 10, 10, 10]);
  });

  it('가장 큰 판도 그림 종류 안에서 만들 수 있다', () => {
    for (const size of boards) expect(pairCount(size)).toBeLessThanOrEqual(CARD_SYMBOLS.length);
  });

  it('카드가 많을수록 미리 보는 시간이 길다', () => {
    expect(previewMs(8)).toBeGreaterThan(previewMs(6));
    expect(previewMs(10)).toBeGreaterThan(previewMs(8));
    expect(previewMs(10)).toBeLessThanOrEqual(2500);
    // 판이 더 커지지 않는 셋째 판까지는 그대로이고, 그 뒤로는 판마다 줄어들다가 바닥에서 멈춘다.
    expect(previewMs(10, 0)).toBe(previewMs(10));
    expect(previewMs(10, LARGEST_BOARD_INDEX)).toBe(previewMs(10));
    expect(previewMs(10, LARGEST_BOARD_INDEX + 1)).toBe(previewMs(10) - PREVIEW_CUT_MS);
    for (let board = LARGEST_BOARD_INDEX + 1; board < 12; board += 1) {
      expect(previewMs(10, board)).toBeLessThanOrEqual(previewMs(10, board - 1));
      expect(previewMs(10, board)).toBeGreaterThanOrEqual(MIN_PREVIEW_MS);
    }
    expect(previewMs(10, 50)).toBe(MIN_PREVIEW_MS);
    // 가장 큰 판이 처음 나오는 판이 boardSize가 말하는 그 판이다.
    expect(boardSize(LARGEST_BOARD_INDEX)).toEqual(boardSize(LARGEST_BOARD_INDEX + 5));
    expect(boardSize(LARGEST_BOARD_INDEX - 1)).not.toEqual(boardSize(LARGEST_BOARD_INDEX));
  });
});

describe('카드 더미', () => {
  it('고른 그림이 정확히 두 장씩 들어 있다', () => {
    for (const pairs of [6, 8, 10]) {
      for (let seed = 1; seed <= 20; seed += 1) {
        const deck = buildDeck(pairs, CARD_SYMBOLS.length, seeded(seed));
        expect(deck).toHaveLength(pairs * 2);
        const counts = new Map<number, number>();
        for (const symbol of deck) {
          expect(symbol).toBeGreaterThanOrEqual(0);
          expect(symbol).toBeLessThan(CARD_SYMBOLS.length);
          counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
        }
        expect(counts.size).toBe(pairs);
        for (const count of counts.values()) expect(count).toBe(2);
      }
    }
  });

  it('시드가 같으면 같은 더미, 다르면 다른 더미가 나온다', () => {
    expect(buildDeck(8, 10, seeded(7))).toEqual(buildDeck(8, 10, seeded(7)));
    expect(buildDeck(8, 10, seeded(7))).not.toEqual(buildDeck(8, 10, seeded(8)));
  });

  it('섞인다: 같은 그림이 항상 붙어 있지는 않다', () => {
    const deck = buildDeck(10, 10, seeded(3));
    const adjacentPairs = deck.filter((symbol, index) => index % 2 === 0 && deck[index + 1] === symbol);
    expect(adjacentPairs.length).toBeLessThan(10);
  });

  it('만들 수 없는 더미는 거절한다', () => {
    expect(() => buildDeck(11, 10, Math.random)).toThrow();
    expect(() => buildDeck(0, 10, Math.random)).toThrow();
    expect(() => buildDeck(2.5, 10, Math.random)).toThrow();
  });
});

describe('점수', () => {
  it('연속으로 맞힐수록 점수가 늘다가 +20에서 멈춘다', () => {
    expect(matchPoints(0)).toBe(10);
    expect(matchPoints(1)).toBe(15);
    expect(matchPoints(4)).toBe(30);
    expect(matchPoints(50)).toBe(30);
    for (let streak = 1; streak <= 12; streak += 1) {
      expect(matchPoints(streak)).toBeGreaterThanOrEqual(matchPoints(streak - 1));
    }
  });

  it('잘못된 값이 들어와도 보너스가 음수가 되지 않는다', () => {
    expect(streakBonus(-3)).toBe(0);
  });

  it('큰 판을 깰수록 보너스가 크다', () => {
    expect(clearBonus(6)).toBe(30);
    expect(clearBonus(10)).toBeGreaterThan(clearBonus(8));
  });
});

describe('카드 배치', () => {
  const card = { width: 48, height: 56, gap: 8 };
  // 가장 작은 화면에서 HUD 아래에 남는 영역
  const area = { x: 12, y: 60, width: GAME_WIDTH - 24, height: MIN_GAME_HEIGHT - 60 - 8 };

  it.each(boards)('$cols×$rows 판이 가장 작은 화면에도 겹치지 않고 들어간다', (size) => {
    const centers = cardCenters(size, area, card);
    expect(centers).toHaveLength(size.cols * size.rows);

    for (const center of centers) {
      expect(Number.isInteger(center.x)).toBe(true);
      expect(Number.isInteger(center.y)).toBe(true);
      expect(center.x - card.width / 2).toBeGreaterThanOrEqual(area.x);
      expect(center.x + card.width / 2).toBeLessThanOrEqual(area.x + area.width);
      expect(center.y - card.height / 2).toBeGreaterThanOrEqual(area.y);
      expect(center.y + card.height / 2).toBeLessThanOrEqual(area.y + area.height);
    }

    for (let i = 0; i < centers.length; i += 1) {
      for (let j = i + 1; j < centers.length; j += 1) {
        const apartX = Math.abs(centers[i].x - centers[j].x) >= card.width + card.gap;
        const apartY = Math.abs(centers[i].y - centers[j].y) >= card.height + card.gap;
        expect(apartX || apartY).toBe(true);
      }
    }
  });

  it('판은 영역의 가운데에 놓인다', () => {
    const centers = cardCenters({ cols: 4, rows: 4 }, area, card);
    const xs = centers.map((center) => center.x);
    const middle = (Math.min(...xs) + Math.max(...xs)) / 2;
    expect(Math.abs(middle - (area.x + area.width / 2))).toBeLessThanOrEqual(1);
  });
});
