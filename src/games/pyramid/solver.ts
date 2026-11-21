/**
 * 피라미드 판이 끝까지 치워지는지 찾아보는 작은 풀이기. 오늘의 판을 꼭 깰 수 있는 판으로 고를 때 쓴다.
 *
 * 깊이 우선으로 수를 두어 보며, 한 번 본 판은 다시 보지 않는다. 피라미드의 카드를 많이 치우는 수부터 보고
 * 더미 넘기기는 맨 나중에 본다. "풀린다"고 답하면 정말 깰 수 있는 판이고, "모른다"는 못 찾았다는 뜻일 뿐이다.
 * 정해진 수만큼만 찾아보고 멈춰서 폰에서도 금방 끝난다.
 */
import { availableMoves, clearSpots, deal, drawCard, isCleared, PYRAMID_SIZE, type Board, type Card, type Move } from './rules';

const SUIT_INDEX: Record<Card['suit'], number> = { spade: 0, heart: 1, diamond: 2, club: 3 };
/** 카드마다 다른 글자 하나 */
const code = (card: Card): string => String.fromCharCode(65 + card.rank * 4 + SUIT_INDEX[card.suit]);

function keyOf(board: Board): string {
  let mask = '';
  for (let slot = 0; slot < PYRAMID_SIZE; slot += 1) mask += board.pyramid[slot] === null ? '0' : '1';
  return `${mask}|${board.stock.map(code).join('')}|${board.waste.map(code).join('')}|${board.pass}`;
}

function cloneBoard(board: Board): Board {
  return { pyramid: board.pyramid.slice(), stock: board.stock.slice(), waste: board.waste.slice(), pass: board.pass };
}

const pyramidCount = (move: Move): number => move.filter((spot) => spot.kind === 'pyramid').length;

export type SolveResult = 'solved' | 'unknown';

/** 판이 끝까지 치워지는지 찾아본다. budget은 살펴볼 판의 수다. 받은 판은 바꾸지 않는다. */
export function solve(start: Board, budget = 20_000): SolveResult {
  const seen = new Set<string>();
  const stack: Board[] = [cloneBoard(start)];
  let visited = 0;
  while (stack.length > 0) {
    const board = stack.pop() as Board;
    if (isCleared(board)) return 'solved';
    const key = keyOf(board);
    if (seen.has(key)) continue;
    seen.add(key);
    visited += 1;
    if (visited > budget) return 'unknown';
    // 스택이라 나중에 넣은 것을 먼저 본다. 더미 넘기기를 맨 먼저 넣어 가장 나중에 보게 한다.
    const drawn = cloneBoard(board);
    if (drawCard(drawn) !== 'none') stack.push(drawn);
    // 피라미드의 카드를 많이 치우는 수를 먼저 본다(같으면 원래 차례대로).
    const moves = availableMoves(board)
      .map((move, index) => ({ move, index }))
      .sort((a, b) => pyramidCount(a.move) - pyramidCount(b.move) || b.index - a.index);
    for (const { move } of moves) {
      const next = cloneBoard(board);
      if (clearSpots(next, move)) stack.push(next);
    }
  }
  return 'unknown';
}

/** 한 판을 고를 때 풀어 볼 판의 수와, 판 하나마다 살펴볼 수 */
const PICK_TRIES = 20;
const PICK_BUDGET = 1_500;

/**
 * 꼭 깰 수 있는 판의 씨앗을 고른다. seedOf(0), seedOf(1), … 차례로 깔아 보고 처음 풀리는 판의 씨앗을 쓴다.
 * 같은 seedOf면 언제나 같은 씨앗이다. 정해진 만큼 해 봐도 못 찾으면 마지막에 해 본 씨앗을 쓴다.
 */
export function pickWinnableSeed(seedOf: (attempt: number) => number): number {
  let seed = seedOf(0);
  for (let attempt = 0; attempt < PICK_TRIES; attempt += 1) {
    seed = seedOf(attempt);
    if (solve(deal(seed), PICK_BUDGET) === 'solved') return seed;
  }
  return seed;
}
