import { describe, expect, it } from 'vitest';
import { playOut } from './bot';
import { addDailyRun, boardDayOf, createDaily, dailySeed, normalizeDaily, recordOn } from './daily';
import {
  availableMoves,
  canClear,
  clearPoints,
  clearSpots,
  coveredBy,
  deal,
  drawCard,
  finishBonus,
  isFree,
  isStuck,
  PASSES,
  PYRAMID_SIZE,
  rankLabel,
  rowColOf,
  slotCenter,
  slotOf,
  type Board,
  type Card,
} from './rules';
import { PYRAMID_TEXT, RANK_TEXT } from './text';

const card = (rank: number, suit: Card['suit'] = 'spade'): Card => ({ rank, suit });

/** 피라미드를 거의 비운 판: 맨 아랫줄의 두 자리에만 카드를 남긴다. */
function nearlyEmpty(left: Card, right: Card, stock: Card[] = [], waste: Card[] = []): Board {
  const pyramid: (Card | null)[] = Array.from({ length: PYRAMID_SIZE }, () => null);
  pyramid[slotOf(6, 0)] = left;
  pyramid[slotOf(6, 1)] = right;
  return { pyramid, stock, waste, pass: 1 };
}

describe('자리', () => {
  it('일곱 줄에 28장이 놓이고 번호와 줄, 칸이 서로 맞는다', () => {
    expect(PYRAMID_SIZE).toBe(28);
    for (let slot = 0; slot < PYRAMID_SIZE; slot += 1) {
      const { row, col } = rowColOf(slot);
      expect(col).toBeLessThanOrEqual(row);
      expect(slotOf(row, col)).toBe(slot);
    }
  });

  it('카드는 아래 줄의 두 장에 덮이고, 맨 아랫줄은 덮이지 않는다', () => {
    expect(coveredBy(0)).toEqual([1, 2]);
    expect(coveredBy(slotOf(5, 5))).toEqual([slotOf(6, 5), slotOf(6, 6)]);
    expect(coveredBy(slotOf(6, 3))).toEqual([]);
  });

  it('처음 깐 판에서는 맨 아랫줄의 일곱 장만 고를 수 있다', () => {
    const board = deal(1);
    const free = Array.from({ length: PYRAMID_SIZE }, (_, slot) => slot).filter((slot) => isFree(board, slot));
    expect(free).toEqual(Array.from({ length: 7 }, (_, col) => slotOf(6, col)));
  });

  it('카드가 서로 겹치지 않게 옆으로 늘어서고, 아래 줄은 윗줄의 사이에 놓인다', () => {
    const metrics = { width: 28, height: 38, gap: 4, step: 18 };
    const a = slotCenter(slotOf(6, 0), 120, 40, metrics);
    const b = slotCenter(slotOf(6, 1), 120, 40, metrics);
    const above = slotCenter(slotOf(5, 0), 120, 40, metrics);
    expect(b.x - a.x).toBe(32);
    expect(above.x).toBe((a.x + b.x) / 2);
    expect(a.y - above.y).toBe(18);
    // 맨 아랫줄이 240 폭 안에 들어간다.
    expect(a.x - 14).toBeGreaterThanOrEqual(0);
    expect(slotCenter(slotOf(6, 6), 120, 40, metrics).x + 14).toBeLessThanOrEqual(240);
  });
});

describe('섞기', () => {
  it('같은 씨앗이면 같은 판이고, 한 벌 52장이 한 장씩 다 들어 있다', () => {
    const a = deal(42);
    const b = deal(42);
    expect(a).toEqual(b);
    expect(deal(43)).not.toEqual(a);
    const all = [...(a.pyramid as Card[]), ...a.stock];
    expect(all).toHaveLength(52);
    expect(new Set(all.map((item) => `${item.suit}${item.rank}`)).size).toBe(52);
    expect(a.stock).toHaveLength(24);
  });
});

describe('치우기', () => {
  it('K는 혼자, 나머지는 합이 13인 두 장을 치운다', () => {
    expect(canClear([card(13)])).toBe(true);
    expect(canClear([card(12)])).toBe(false);
    expect(canClear([card(1), card(12)])).toBe(true);
    expect(canClear([card(6), card(7)])).toBe(true);
    expect(canClear([card(6), card(6)])).toBe(false);
    expect(rankLabel(1)).toBe('A');
    expect(rankLabel(10)).toBe('10');
    expect(rankLabel(12)).toBe('Q');
  });

  it('치우면 그 자리가 비고, 위의 카드가 드러난다', () => {
    const board = nearlyEmpty(card(5), card(8));
    board.pyramid[slotOf(5, 0)] = card(13);
    expect(isFree(board, slotOf(5, 0))).toBe(false);
    expect(
      clearSpots(board, [
        { kind: 'pyramid', slot: slotOf(6, 0) },
        { kind: 'pyramid', slot: slotOf(6, 1) },
      ]),
    ).toBe(true);
    expect(isFree(board, slotOf(5, 0))).toBe(true);
    expect(clearSpots(board, [{ kind: 'pyramid', slot: slotOf(5, 0) }])).toBe(true);
    expect(board.pyramid.every((item) => item === null)).toBe(true);
  });

  it('합이 맞지 않거나 덮인 카드, 같은 자리 두 번은 치우지 않고 판을 그대로 둔다', () => {
    const board = nearlyEmpty(card(5), card(9));
    const before = structuredClone(board);
    expect(clearSpots(board, [{ kind: 'pyramid', slot: slotOf(6, 0) }, { kind: 'pyramid', slot: slotOf(6, 1) }])).toBe(false);
    expect(clearSpots(board, [{ kind: 'pyramid', slot: slotOf(5, 0) }])).toBe(false);
    const kings = nearlyEmpty(card(13), card(13));
    expect(clearSpots(kings, [{ kind: 'pyramid', slot: slotOf(6, 0) }, { kind: 'pyramid', slot: slotOf(6, 0) }])).toBe(false);
    expect(board).toEqual(before);
  });

  it('버린 카드 더미의 맨 위 카드와도 짝을 맞춘다', () => {
    const board = nearlyEmpty(card(4), card(2), [], [card(1), card(9)]);
    expect(availableMoves(board)).toEqual([[{ kind: 'pyramid', slot: slotOf(6, 0) }, { kind: 'waste' }]]);
    expect(clearSpots(board, [{ kind: 'pyramid', slot: slotOf(6, 0) }, { kind: 'waste' }])).toBe(true);
    expect(board.waste).toEqual([card(1)]);
  });
});

describe('더미', () => {
  it('한 장씩 넘기고, 다 넘기면 정해진 횟수까지 다시 돌린다', () => {
    const board = nearlyEmpty(card(5), card(9), [card(2), card(3)]);
    expect(drawCard(board)).toBe('drew');
    expect(board.waste.at(-1)).toEqual(card(3));
    expect(drawCard(board)).toBe('drew');
    for (let pass = 2; pass <= PASSES; pass += 1) {
      expect(drawCard(board)).toBe('recycled');
      expect(board.pass).toBe(pass);
      // 다시 돌리면 처음 넘기던 차례 그대로 나온다.
      expect(board.stock.at(-1)).toEqual(card(3));
      drawCard(board);
      drawCard(board);
    }
    expect(drawCard(board)).toBe('none');
    expect(isStuck(board)).toBe(true);
  });

  it('넘길 카드나 짝이 남아 있으면 막힌 것이 아니다', () => {
    expect(isStuck(nearlyEmpty(card(5), card(9), [card(2)]))).toBe(false);
    expect(isStuck(nearlyEmpty(card(5), card(8)))).toBe(false);
    expect(isStuck(nearlyEmpty(card(5), card(9), [], [card(2)]))).toBe(false);
  });
});

describe('점수', () => {
  it('이어서 치울수록 덤이 붙고, 덤에는 끝이 있다', () => {
    expect(clearPoints(2, 0, 1)).toBe(20);
    expect(clearPoints(1, 1, 1)).toBe(15);
    expect(clearPoints(2, 0, 3)).toBe(24);
    expect(clearPoints(2, 0, 50)).toBe(30);
  });

  it('다 치우면 깬 덤과 남은 돌리기, 빨리 깬 만큼 더 받는다', () => {
    const board = nearlyEmpty(card(5), card(8));
    expect(finishBonus(board, 10)).toBe(0);
    clearSpots(board, [{ kind: 'pyramid', slot: slotOf(6, 0) }, { kind: 'pyramid', slot: slotOf(6, 1) }]);
    expect(finishBonus(board, 60)).toBe(150 + 2 * 50 + 120);
    expect(finishBonus({ ...board, pass: 3 }, 500)).toBe(150);
  });

  it('자동 플레이는 어느 판이든 끝까지 가고, 점수가 오늘의 도전 목표와 맞는 만큼 나온다', () => {
    const results = Array.from({ length: 300 }, (_, seed) => playOut(seed + 1));
    for (const result of results) expect(result.cleared || isStuck(result.board)).toBe(true);
    const scores = results.map((result) => result.score).sort((a, b) => a - b);
    const median = scores[Math.floor(scores.length / 2)];
    const wins = results.filter((result) => result.cleared).length;
    // 생각 없이 두어도 절반은 넘게 피라미드를 치우지만, 다 치우는 판은 드물다.
    expect(median).toBeGreaterThan(80);
    expect(median).toBeLessThan(400);
    expect(wins).toBeGreaterThan(0);
    expect(wins).toBeLessThan(results.length / 2);
  });
});

describe('오늘의 판', () => {
  it('씨앗은 날로만 정해진다', () => {
    expect(dailySeed(20_000)).toBe(dailySeed(20_000));
    expect(dailySeed(20_001)).not.toBe(dailySeed(20_000));
  });

  it('그날의 판만 그날의 랭킹에 오른다', () => {
    const now = Date.UTC(2026, 10, 20, 3);
    const today = Math.floor((now + 9 * 3_600_000) / 86_400_000);
    expect(boardDayOf(today, now)).toBe(today);
    expect(boardDayOf(today - 1, now)).toBeNull();
    expect(boardDayOf(null, now)).toBeNull();
  });

  it('그날의 가장 좋은 점수와 판 수를 쌓고, 날이 바뀌면 새로 센다', () => {
    let record = createDaily();
    record = addDailyRun(record, 100, 120, false).record;
    const second = addDailyRun(record, 100, 90, true);
    expect(second.newBest).toBe(false);
    expect(second.record).toMatchObject({ day: 100, best: 120, plays: 2, cleared: true });
    const next = addDailyRun(second.record, 101, 30, false);
    expect(next.newBest).toBe(true);
    expect(next.record).toMatchObject({ day: 101, best: 30, plays: 1, cleared: false });
    expect(recordOn(next.record, 102).plays).toBe(0);
  });

  it('맞지 않는 저장 값은 처음 상태로 읽는다', () => {
    expect(normalizeDaily(null)).toEqual(createDaily());
    expect(normalizeDaily({ day: -1, best: 3, plays: 1 })).toEqual(createDaily());
    expect(normalizeDaily({ day: 5, best: 3, plays: 1, cleared: true, savedAt: 9 })).toEqual({
      day: 5,
      best: 3,
      plays: 1,
      cleared: true,
      savedAt: 9,
    });
  });
});

/** 주아 글꼴에 들어 있는 한글: KS X 1001의 완성형 2,350자 */
function fontSyllables(): Set<string> {
  const decoder = new TextDecoder('euc-kr');
  const syllables = new Set<string>();
  for (let lead = 0xb0; lead <= 0xc8; lead += 1) {
    for (let trail = 0xa1; trail <= 0xfe; trail += 1) syllables.add(decoder.decode(new Uint8Array([lead, trail])));
  }
  return syllables;
}

describe('글', () => {
  it('화면에 보이는 글은 글꼴에 들어 있는 한글만 쓴다', () => {
    const syllables = fontSyllables();
    const texts = [...Object.values(PYRAMID_TEXT), ...Object.values(RANK_TEXT)].map((value) =>
      typeof value === 'function' ? value(3) : value,
    );
    const missing = new Set<string>();
    for (const text of texts) {
      for (const char of text) if (/\p{Script=Hangul}/u.test(char) && !syllables.has(char)) missing.add(char);
    }
    expect([...missing]).toEqual([]);
  });
});
