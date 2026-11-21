import { describe, expect, it } from 'vitest';
import { seededRandom } from '../../core/stages';
import { dailyDeal, dayBestOf, freshDeal } from './daily';
import {
  applyMove,
  autoTarget,
  canAutoFinish,
  canStack,
  cardId,
  deal,
  drawStock,
  finalScore,
  hasUsefulMove,
  isWon,
  nextFoundationMove,
  POINTS,
  SOLITAIRE_GAME_ID,
  timeBonus,
  undoPenalty,
  type Board,
  type Card,
} from './rules';
import { solve } from './solver';

const card = (suit: Card['suit'], rank: number, up = true): Card => ({ suit, rank, up });
const empty = (): Board => ({
  stock: [],
  waste: [],
  foundations: [[], [], [], []],
  tableau: [[], [], [], [], [], [], []],
  score: 0,
  moves: 0,
  recycles: 0,
});

describe('판 나누기', () => {
  it('일곱 줄에 1장부터 7장, 더미에 24장이고 52장이 모두 다르다', () => {
    const board = deal(seededRandom('test'));
    expect(board.tableau.map((column) => column.length)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(board.stock).toHaveLength(24);
    const ids = new Set([...board.stock, ...board.tableau.flat()].map(cardId));
    expect(ids.size).toBe(52);
    for (const column of board.tableau) {
      expect(column.map((item) => item.up)).toEqual(column.map((_, index) => index === column.length - 1));
    }
  });
});

describe('놓는 규칙', () => {
  it('줄에는 하나 작고 색이 다른 카드만, 빈 줄에는 K만 놓는다', () => {
    expect(canStack(card(1, 6), card(0, 7))).toBe(true);
    expect(canStack(card(2, 6), card(1, 7))).toBe(false);
    expect(canStack(card(3, 5), card(1, 7))).toBe(false);
    expect(canStack(card(0, 13), undefined)).toBe(true);
    expect(canStack(card(0, 12), undefined)).toBe(false);
  });

  it('모음 칸에 올리면 점수가 붙고, 드러난 뒷면 카드는 뒤집히며 점수가 붙는다', () => {
    const board = empty();
    board.tableau[0] = [card(3, 9, false), card(1, 1)];
    const outcome = applyMove(board, { from: { kind: 'tab', index: 0 }, count: 1, to: { kind: 'found', index: 1 } });
    expect(outcome?.flipped).toBe(true);
    expect(outcome?.board.score).toBe(POINTS.toFoundation + POINTS.flip);
    expect(outcome?.board.tableau[0][0].up).toBe(true);
    // 받은 판은 그대로다.
    expect(board.tableau[0]).toHaveLength(2);
  });

  it('다른 무늬의 모음 칸이나 차례가 아닌 카드는 올리지 못한다', () => {
    const board = empty();
    board.tableau[0] = [card(1, 2)];
    expect(applyMove(board, { from: { kind: 'tab', index: 0 }, count: 1, to: { kind: 'found', index: 1 } })).toBeNull();
    board.tableau[0] = [card(1, 1)];
    expect(applyMove(board, { from: { kind: 'tab', index: 0 }, count: 1, to: { kind: 'found', index: 0 } })).toBeNull();
  });

  it('앞면 카드는 아래에 겹친 카드와 통째로 옮긴다', () => {
    const board = empty();
    board.tableau[0] = [card(0, 9, false), card(1, 8), card(0, 7)];
    board.tableau[1] = [card(3, 9)];
    const outcome = applyMove(board, { from: { kind: 'tab', index: 0 }, count: 2, to: { kind: 'tab', index: 1 } });
    expect(outcome?.board.tableau[1].map((item) => item.rank)).toEqual([9, 8, 7]);
    expect(outcome?.board.tableau[0]).toEqual([card(0, 9, true)]);
  });
});

describe('더미', () => {
  it('한 장씩 넘기고, 비면 다시 뒤집는다. 두 번째 뒤집기부터 점수가 깎인다', () => {
    let board = empty();
    board.stock = [card(0, 5, false), card(1, 6, false)];
    board = drawStock(board) as Board;
    expect(board.waste.map((item) => item.rank)).toEqual([6]);
    board = drawStock(drawStock(board) as Board) as Board;
    expect(board.stock.map((item) => item.rank)).toEqual([5, 6]);
    expect(board.stock.every((item) => !item.up)).toBe(true);
    expect(board.score).toBe(0);
    board = drawStock(drawStock(drawStock(board) as Board) as Board) as Board;
    expect(board.recycles).toBe(2);
    expect(board.score).toBe(POINTS.recycle);
  });

  it('더미와 버림 칸이 다 비었으면 넘길 수 없다', () => {
    expect(drawStock(empty())).toBeNull();
  });
});

describe('눌러서 옮기기', () => {
  it('한 장이면 모음 칸을 먼저, 아니면 카드가 있는 줄을 빈 줄보다 먼저 고른다', () => {
    const board = empty();
    board.foundations[1] = [card(1, 1)];
    board.tableau[0] = [card(1, 2)];
    expect(autoTarget(board, { kind: 'tab', index: 0 }, 1)).toEqual({ kind: 'found', index: 1 });
    board.tableau[2] = [card(0, 13), card(1, 12)];
    board.tableau[4] = [card(3, 12, false), card(2, 13)];
    board.tableau[0] = [card(0, 11)];
    expect(autoTarget(board, { kind: 'tab', index: 0 }, 1)).toEqual({ kind: 'tab', index: 2 });
  });

  it('줄 맨 위의 K를 다른 빈 줄로 옮기는 것처럼 아무것도 바뀌지 않는 수는 고르지 않는다', () => {
    const board = empty();
    board.tableau[0] = [card(0, 13)];
    expect(autoTarget(board, { kind: 'tab', index: 0 }, 1)).toBeNull();
    board.tableau[0] = [card(0, 4, false), card(0, 13)];
    expect(autoTarget(board, { kind: 'tab', index: 0 }, 1)).toEqual({ kind: 'tab', index: 1 });
  });
});

describe('끝내기', () => {
  it('다 앞면이고 더미가 비면 알아서 모아 이긴다', () => {
    let board = empty();
    // 무늬마다 한 줄에 K부터 A까지 쌓인 모양을 만든다.
    board.tableau = [0, 1, 2, 3].map((suit) => Array.from({ length: 13 }, (_, i) => card(suit as Card['suit'], 13 - i)));
    board.tableau.push([], [], []);
    expect(canAutoFinish(board)).toBe(true);
    for (let step = 0; step < 52; step += 1) {
      const move = nextFoundationMove(board);
      expect(move).not.toBeNull();
      board = applyMove(board, move!)!.board;
    }
    expect(isWon(board)).toBe(true);
    expect(finalScore(board, 100)).toBe(52 * POINTS.toFoundation + POINTS.win + timeBonus(100));
  });

  it('놓을 곳이 없으면 막힌 판이다', () => {
    const board = empty();
    board.tableau[0] = [card(0, 5, false), card(1, 9)];
    board.tableau[1] = [card(1, 4, false), card(0, 3)];
    expect(hasUsefulMove(board)).toBe(false);
    board.stock = [card(3, 8, false)];
    expect(hasUsefulMove(board)).toBe(true);
  });

  it('앞면 덩어리의 일부를 옮겨 모음 칸에 올릴 카드가 드러나면 막힌 판이 아니다', () => {
    const board = empty();
    board.foundations[1] = [1, 2, 3, 4].map((rank) => card(1, rank));
    board.tableau[0] = [card(0, 6), card(1, 5), card(0, 4)];
    board.tableau[1] = [card(3, 10, false), card(2, 5)];
    // 4♠을 5♦ 위로 옮기면 5♥이 드러나 모음 칸에 올라간다.
    expect(hasUsefulMove(board)).toBe(true);
  });

  it('일부를 옮겨도 드러난 카드를 쓸 데가 없으면 세지 않는다', () => {
    const board = empty();
    board.foundations[1] = [1, 2, 3].map((rank) => card(1, rank));
    board.tableau[0] = [card(0, 6), card(1, 5), card(0, 4)];
    board.tableau[1] = [card(3, 10, false), card(2, 5)];
    // 4♠을 5♥과 5♦ 사이로 오가게 하는 수뿐이다.
    expect(hasUsefulMove(board)).toBe(false);
  });

  it('시간 보너스는 15분이 지나면 없다', () => {
    expect(timeBonus(0)).toBe(900);
    expect(timeBonus(300)).toBe(600);
    expect(timeBonus(2000)).toBe(0);
  });
});

describe('되돌리기 감점', () => {
  it('되돌릴 때마다 마지막 점수에서 깎고, 0보다 작아지지 않는다', () => {
    const board = empty();
    board.score = 40;
    expect(undoPenalty(0)).toBe(0);
    expect(undoPenalty(3)).toBe(3 * POINTS.undo);
    expect(finalScore(board, 0)).toBe(40);
    expect(finalScore(board, 0, 2)).toBe(40 + 2 * POINTS.undo);
    expect(finalScore(board, 0, 100)).toBe(0);
    board.score = -30;
    expect(finalScore(board, 0, 1)).toBe(0);
  });

  it('이긴 판에도 보너스를 더한 뒤에 깎는다', () => {
    const board = empty();
    board.foundations = [0, 1, 2, 3].map((suit) => Array.from({ length: 13 }, (_, i) => card(suit as Card['suit'], i + 1)));
    board.score = 100;
    expect(finalScore(board, 900, 4)).toBe(100 + POINTS.win + 4 * POINTS.undo);
  });
});

describe('오늘의 판', () => {
  it('같은 날에는 언제나 같은 판이고, 날이 다르면 다른 판이다', () => {
    const a = dailyDeal(20_777);
    expect(dailyDeal(20_777)).toEqual(a);
    expect(dailyDeal(20_778)).not.toEqual(a);
  });

  it('날마다 끝까지 풀리는 판이 나온다', () => {
    for (let day = 20_700; day < 20_730; day += 1) expect(solve(dailyDeal(day), 4_000), String(day)).toBe('solved');
  });

  it('여느 판도 끝까지 풀리는 판이다', () => {
    for (let i = 0; i < 10; i += 1) expect(solve(freshDeal(seededRandom(`free ${i}`)), 4_000)).toBe('solved');
  });

  it('그날의 기록은 같은 날의 것만 읽는다', () => {
    const record = { key: 5, bests: { [SOLITAIRE_GAME_ID]: 420 } };
    expect(dayBestOf(record, 5)).toBe(420);
    expect(dayBestOf(record, 6)).toBe(0);
    expect(dayBestOf(null, 5)).toBe(0);
  });
});
