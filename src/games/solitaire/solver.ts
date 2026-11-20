/**
 * 판이 끝까지 풀리는지 찾아보는 작은 풀이기. 오늘의 판을 꼭 풀리는 판으로 고를 때 쓴다.
 *
 * 깊이 우선으로 수를 두어 보며, 한 번 본 판은 다시 보지 않는다. 사람이 흔히 두는 수만 둔다:
 * 모음 칸에 올리기, 뒷면 카드를 드러내거나 줄을 비우는 옮기기, 버림 칸의 카드를 줄에 놓기, 더미 넘기기.
 * 그래서 "풀린다"고 답하면 정말 풀리는 판이고(찾은 수를 그대로 두면 이긴다), "모른다"는 못 풀었다는 뜻일 뿐이다.
 * 정해진 수만큼만 찾아보고 멈춰서 폰에서도 금방 끝난다.
 */
import {
  applyMove,
  canFound,
  COLUMNS,
  deal,
  drawStock,
  isLegal,
  isRed,
  isWon,
  type Board,
  type Card,
  type Move,
  type Pile,
} from './rules';

const code = (card: Card): string => String.fromCharCode(65 + card.suit * 13 + card.rank - 1 + (card.up ? 0 : 52));

function keyOf(board: Board): string {
  const columns = board.tableau.map((column) => column.map(code).join('')).sort();
  const found = board.foundations.map((pile) => pile.length).join(',');
  return `${board.stock.map(code).join('')}|${board.waste.map(code).join('')}|${found}|${columns.join('/')}`;
}

/** 다른 수를 막지 않아서 언제 두어도 되는 모음 칸 올리기: 그 카드를 받쳐 줄 반대 색 카드가 이미 다 올라갔을 때 */
function safeToFound(board: Board, card: Card): boolean {
  if (!canFound(board, card)) return false;
  if (card.rank <= 2) return true;
  const red = isRed(card.suit);
  return board.foundations.every((pile, suit) => isRed(suit as Card['suit']) === red || pile.length >= card.rank - 1);
}

function candidateMoves(board: Board): Move[] {
  const moves: Move[] = [];
  const waste: Pile = { kind: 'waste' };
  const wasteTop = board.waste[board.waste.length - 1];
  // 모음 칸
  board.tableau.forEach((column, index) => {
    const card = column[column.length - 1];
    if (card && canFound(board, card)) moves.push({ from: { kind: 'tab', index }, count: 1, to: { kind: 'found', index: card.suit } });
  });
  if (wasteTop && canFound(board, wasteTop)) moves.push({ from: waste, count: 1, to: { kind: 'found', index: wasteTop.suit } });
  // 줄끼리: 앞면 덩어리를 통째로 옮겨 뒷면을 드러내거나 줄을 비운다.
  for (let index = 0; index < COLUMNS; index += 1) {
    const column = board.tableau[index];
    const firstUp = column.findIndex((card) => card.up);
    if (firstUp < 0) continue;
    if (firstUp === 0 && column[0].rank === 13) continue;
    const count = column.length - firstUp;
    for (let target = 0; target < COLUMNS; target += 1) {
      const move: Move = { from: { kind: 'tab', index }, count, to: { kind: 'tab', index: target } };
      if (target !== index && isLegal(board, move)) moves.push(move);
    }
  }
  // 버림 칸에서 줄로
  if (wasteTop) {
    for (let target = 0; target < COLUMNS; target += 1) {
      const move: Move = { from: waste, count: 1, to: { kind: 'tab', index: target } };
      if (isLegal(board, move)) moves.push(move);
    }
  }
  return moves;
}

/** 확실한 모음 칸 올리기를 할 수 있는 만큼 한다. */
function settle(board: Board): Board {
  let current = board;
  for (;;) {
    let moved = false;
    const sources: Pile[] = [{ kind: 'waste' }, ...board.tableau.map((_, index): Pile => ({ kind: 'tab', index }))];
    for (const from of sources) {
      const cards = from.kind === 'waste' ? current.waste : current.tableau[(from as { index: number }).index];
      const card = cards[cards.length - 1];
      if (!card || !card.up || !safeToFound(current, card)) continue;
      const outcome = applyMove(current, { from, count: 1, to: { kind: 'found', index: card.suit } });
      if (outcome) {
        current = outcome.board;
        moved = true;
      }
    }
    if (!moved) return current;
  }
}

export type SolveResult = 'solved' | 'unknown';

/** 판이 풀리는지 찾아본다. budget은 살펴볼 판의 수다. */
export function solve(start: Board, budget = 30_000): SolveResult {
  const seen = new Set<string>();
  const stack: Board[] = [settle(start)];
  let visited = 0;
  while (stack.length > 0) {
    const board = stack.pop() as Board;
    if (isWon(board)) return 'solved';
    const key = keyOf(board);
    if (seen.has(key)) continue;
    seen.add(key);
    visited += 1;
    if (visited > budget) return 'unknown';
    // 스택이라 나중에 넣은 것을 먼저 본다. 더미 넘기기를 맨 먼저 넣어 가장 나중에 보게 한다.
    const drawn = drawStock(board);
    if (drawn) stack.push(settle(drawn));
    const moves = candidateMoves(board);
    for (let i = moves.length - 1; i >= 0; i -= 1) {
      const outcome = applyMove(board, moves[i]);
      if (outcome) stack.push(settle(outcome.board));
    }
  }
  return 'unknown';
}

/** 한 판을 고를 때 풀어 볼 판의 수와, 판 하나마다 살펴볼 수. 대개 첫째나 둘째 판에서 1ms 안에 풀린다. */
const PICK_TRIES = 24;
const PICK_BUDGET = 4_000;

/**
 * 씨앗 글(seed)에서 꼭 풀리는 판을 하나 고른다. seed:0, seed:1, … 차례로 섞어 보고 처음 풀리는 판을 쓴다.
 * 같은 씨앗이면 언제나 같은 판이다. 정해진 만큼 해 봐도 못 찾으면 마지막에 섞은 판을 쓴다.
 */
export function pickSolvableDeal(seed: string, makeRandom: (seed: string) => () => number): Board {
  let board = deal(makeRandom(`${seed}:0`));
  for (let attempt = 0; attempt < PICK_TRIES; attempt += 1) {
    board = deal(makeRandom(`${seed}:${attempt}`));
    if (solve(board, PICK_BUDGET) === 'solved') return board;
  }
  return board;
}
