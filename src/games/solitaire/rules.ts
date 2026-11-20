/**
 * 솔리테어(클론다이크)의 규칙. 화면과 저장소에 기대지 않는 순수한 값과 함수만 둔다.
 *
 * - 카드 52장을 일곱 줄에 1장부터 7장까지 나눠 놓고, 줄마다 맨 아래 한 장만 앞면이다. 나머지 24장은 더미다.
 * - 더미를 누르면 한 장씩 넘겨 버림 칸에 놓는다. 더미가 비면 버림 칸을 다시 뒤집어 더미로 만든다(몇 번이든).
 * - 줄에는 숫자가 하나 작고 색(빨강, 검정)이 다른 카드를 겹쳐 놓는다. 빈 줄에는 K만 놓는다.
 *   앞면인 카드는 그 아래에 겹친 카드와 함께 통째로 옮길 수 있다.
 * - 모음 칸은 무늬마다 하나이고, A부터 K까지 차례로 쌓는다. 네 칸이 다 차면 이긴다.
 *
 * 점수(윈도 솔리테어의 셈을 줄여 썼다): 모음 칸에 올리면 +10, 모음 칸에서 내리면 -15, 뒷면 카드를 뒤집으면 +5,
 * 버림 칸에서 줄로 옮기면 +5, 더미를 두 번째부터 다시 뒤집을 때마다 -20. 이기면 판 보너스와 빨리 끝낸 만큼의 보너스가 붙는다.
 */

export const SOLITAIRE_GAME_ID = 'solitaire';
export const SOLITAIRE_SCENE = 'Solitaire';

/** 0 스페이드, 1 하트, 2 다이아몬드, 3 클로버. 모음 칸도 이 차례다. */
export type Suit = 0 | 1 | 2 | 3;
export const SUITS: readonly Suit[] = [0, 1, 2, 3];
export const COLUMNS = 7;

export interface Card {
  suit: Suit;
  /** 1(A)부터 13(K)까지 */
  rank: number;
  up: boolean;
}

export interface Board {
  /** 맨 뒤가 맨 위 */
  stock: Card[];
  waste: Card[];
  /** 무늬마다 하나(Suit 차례) */
  foundations: Card[][];
  tableau: Card[][];
  score: number;
  /** 카드를 옮기거나 더미를 넘긴 횟수 */
  moves: number;
  /** 더미를 다시 뒤집은 횟수 */
  recycles: number;
}

export type Pile =
  | { kind: 'stock' }
  | { kind: 'waste' }
  | { kind: 'found'; index: number }
  | { kind: 'tab'; index: number };

export interface Move {
  from: Pile;
  /** 줄에서 옮길 때 몇 장을 함께 옮기는지. 다른 곳에서는 언제나 1이다. */
  count: number;
  to: Pile;
}

export const POINTS = {
  toFoundation: 10,
  fromFoundation: -15,
  flip: 5,
  wasteToTableau: 5,
  /** 더미를 두 번째부터 다시 뒤집을 때 */
  recycle: -20,
  /** 이기면 붙는 판 보너스 */
  win: 300,
} as const;

/** 이긴 판의 시간 보너스: 15분 안에 끝내면 남은 초마다 1점. */
export const TIME_BONUS_SECONDS = 900;

export function timeBonus(seconds: number): number {
  return Math.max(0, Math.floor(TIME_BONUS_SECONDS - Math.max(0, seconds)));
}

export const isRed = (suit: Suit): boolean => suit === 1 || suit === 2;

/** 카드마다 하나뿐인 번호(0~51). 화면이 카드 그림을 붙들어 둘 때 쓴다. */
export const cardId = (card: Card): number => card.suit * 13 + card.rank - 1;

export const RANK_LABEL = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;

// ───────── 판 만들기 ─────────

/** 52장을 random으로 섞는다(피셔-예이츠). */
export function shuffledDeck(random: () => number): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (let rank = 1; rank <= 13; rank += 1) deck.push({ suit, rank, up: false });
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function deal(random: () => number): Board {
  const deck = shuffledDeck(random);
  const tableau: Card[][] = [];
  for (let column = 0; column < COLUMNS; column += 1) {
    const cards = deck.splice(0, column + 1);
    cards[cards.length - 1].up = true;
    tableau.push(cards);
  }
  return { stock: deck, waste: [], foundations: [[], [], [], []], tableau, score: 0, moves: 0, recycles: 0 };
}

export function cloneBoard(board: Board): Board {
  const copy = (cards: Card[]): Card[] => cards.map((card) => ({ ...card }));
  return {
    stock: copy(board.stock),
    waste: copy(board.waste),
    foundations: board.foundations.map(copy),
    tableau: board.tableau.map(copy),
    score: board.score,
    moves: board.moves,
    recycles: board.recycles,
  };
}

// ───────── 놓을 수 있는지 ─────────

const top = <T>(cards: readonly T[]): T | undefined => cards[cards.length - 1];

/** 그 카드를 줄의 맨 아래 카드(onto, 빈 줄이면 undefined) 위에 놓을 수 있는지 */
export function canStack(card: Card, onto: Card | undefined): boolean {
  if (!onto) return card.rank === 13;
  return onto.up && isRed(onto.suit) !== isRed(card.suit) && onto.rank === card.rank + 1;
}

/** 그 카드를 제 무늬의 모음 칸에 올릴 수 있는지 */
export function canFound(board: Board, card: Card): boolean {
  const pile = board.foundations[card.suit];
  return (top(pile)?.rank ?? 0) + 1 === card.rank;
}

/** 그 자리에서 맨 위(줄이면 count장)를 집을 때 집히는 카드들. 집을 수 없으면 null. */
export function pickUp(board: Board, from: Pile, count: number): Card[] | null {
  if (count < 1) return null;
  if (from.kind === 'stock') return null;
  if (from.kind === 'waste') return count === 1 && board.waste.length > 0 ? [board.waste[board.waste.length - 1]] : null;
  if (from.kind === 'found') {
    const pile = board.foundations[from.index];
    return count === 1 && pile && pile.length > 0 ? [pile[pile.length - 1]] : null;
  }
  const column = board.tableau[from.index];
  if (!column || count > column.length) return null;
  const cards = column.slice(column.length - count);
  return cards[0].up ? cards : null;
}

export function samePile(a: Pile, b: Pile): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'stock' || a.kind === 'waste') return true;
  return a.index === (b as { index: number }).index;
}

export function isLegal(board: Board, move: Move): boolean {
  if (samePile(move.from, move.to)) return false;
  const cards = pickUp(board, move.from, move.count);
  if (!cards) return false;
  const lead = cards[0];
  if (move.to.kind === 'found') {
    return cards.length === 1 && move.to.index === lead.suit && canFound(board, lead);
  }
  if (move.to.kind === 'tab') {
    const column = board.tableau[move.to.index];
    return column !== undefined && canStack(lead, top(column));
  }
  return false;
}

// ───────── 옮기기 ─────────

function pileCards(board: Board, pile: Pile): Card[] {
  if (pile.kind === 'stock') return board.stock;
  if (pile.kind === 'waste') return board.waste;
  if (pile.kind === 'found') return board.foundations[pile.index];
  return board.tableau[pile.index];
}

/** 옮긴 뒤 드러난 줄의 맨 아래 카드가 뒷면이면 뒤집는다. 뒤집었으면 true. */
function flipExposed(board: Board, column: number): boolean {
  const card = top(board.tableau[column]);
  if (!card || card.up) return false;
  card.up = true;
  board.score += POINTS.flip;
  return true;
}

export interface MoveOutcome {
  board: Board;
  /** 옮긴 뒤 뒷면에서 뒤집힌 카드가 있었는지 */
  flipped: boolean;
}

/** 옮긴 새 판을 돌려준다. 놓을 수 없으면 null. 받은 판은 바꾸지 않는다. */
export function applyMove(board: Board, move: Move): MoveOutcome | null {
  if (!isLegal(board, move)) return null;
  const next = cloneBoard(board);
  const source = pileCards(next, move.from);
  const cards = source.splice(source.length - move.count, move.count);
  pileCards(next, move.to).push(...cards);
  if (move.to.kind === 'found') next.score += POINTS.toFoundation;
  if (move.from.kind === 'found') next.score += POINTS.fromFoundation;
  if (move.from.kind === 'waste' && move.to.kind === 'tab') next.score += POINTS.wasteToTableau;
  next.moves += 1;
  const flipped = move.from.kind === 'tab' ? flipExposed(next, move.from.index) : false;
  return { board: next, flipped };
}

/** 더미를 누른다: 한 장을 넘기거나, 더미가 비었으면 버림 칸을 다시 뒤집는다. 둘 다 비었으면 null. */
export function drawStock(board: Board): Board | null {
  if (board.stock.length === 0 && board.waste.length === 0) return null;
  const next = cloneBoard(board);
  if (next.stock.length > 0) {
    const card = next.stock.pop() as Card;
    card.up = true;
    next.waste.push(card);
  } else {
    next.stock = next.waste.reverse().map((card) => ({ ...card, up: false }));
    next.waste = [];
    next.recycles += 1;
    if (next.recycles > 1) next.score += POINTS.recycle;
  }
  next.moves += 1;
  return next;
}

// ───────── 알아서 옮기기 ─────────

/**
 * 카드를 눌렀을 때 옮길 곳. 한 장이면 모음 칸을 먼저 보고, 아니면 다른 줄을 본다.
 * 줄은 누른 줄의 오른쪽부터 차례로 돌며, 카드가 있는 줄을 빈 줄보다 먼저 고른다.
 * 줄 맨 위의 K를 통째로 다른 빈 줄로 옮기는 것처럼 아무것도 바뀌지 않는 수는 고르지 않는다.
 */
export function autoTarget(board: Board, from: Pile, count: number): Pile | null {
  const cards = pickUp(board, from, count);
  if (!cards) return null;
  if (cards.length === 1 && from.kind !== 'found') {
    const to: Pile = { kind: 'found', index: cards[0].suit };
    if (isLegal(board, { from, count, to })) return to;
  }
  const start = from.kind === 'tab' ? from.index + 1 : 0;
  const wholeColumn = from.kind === 'tab' && board.tableau[from.index].length === count;
  let empty: Pile | null = null;
  for (let step = 0; step < COLUMNS; step += 1) {
    const index = (start + step) % COLUMNS;
    const to: Pile = { kind: 'tab', index };
    if (!isLegal(board, { from, count, to })) continue;
    if (board.tableau[index].length > 0) return to;
    if (!wholeColumn) empty ??= to;
  }
  return empty;
}

export function isWon(board: Board): boolean {
  return board.foundations.every((pile) => pile.length === 13);
}

/** 더미와 버림 칸이 비고 줄의 카드가 다 앞면이면, 남은 것은 차례로 모음 칸에 올리기만 하면 된다. */
export function canAutoFinish(board: Board): boolean {
  return (
    !isWon(board) &&
    board.stock.length === 0 &&
    board.waste.length === 0 &&
    board.tableau.every((column) => column.every((card) => card.up))
  );
}

/** 모음 칸에 올릴 수 있는 카드 가운데 숫자가 가장 작은 것 하나를 올리는 수. 없으면 null. */
export function nextFoundationMove(board: Board): Move | null {
  let best: Move | null = null;
  let bestRank = 99;
  const consider = (from: Pile, card: Card | undefined): void => {
    if (!card || !card.up || card.rank >= bestRank || !canFound(board, card)) return;
    best = { from, count: 1, to: { kind: 'found', index: card.suit } };
    bestRank = card.rank;
  };
  consider({ kind: 'waste' }, top(board.waste));
  board.tableau.forEach((column, index) => consider({ kind: 'tab', index }, top(column)));
  return best;
}

/**
 * 판을 바꾸는 쓸모 있는 수가 남아 있는지. 없으면 막힌 판이다.
 * 쓸모 있는 수: 모음 칸에 올리기, 뒷면 카드를 드러내거나 줄을 비우는 옮기기, 버림 칸의 카드를 줄에 놓기,
 * 그리고 더미와 버림 칸에 아직 어딘가 놓을 수 있는 카드가 있으면 더미를 넘기는 것.
 * 줄끼리 같은 높이의 카드를 오가게 하는 수처럼 판이 나아지지 않는 수는 세지 않는다.
 */
export function hasUsefulMove(board: Board): boolean {
  const placeable = (card: Card): boolean =>
    canFound(board, card) || board.tableau.some((column) => canStack(card, top(column)));
  if (board.waste.length > 0 && placeable(board.waste[board.waste.length - 1])) return true;
  for (let index = 0; index < COLUMNS; index += 1) {
    const column = board.tableau[index];
    if (column.length === 0) continue;
    if (canFound(board, column[column.length - 1])) return true;
    const firstUp = column.findIndex((card) => card.up);
    if (firstUp < 0) continue;
    const count = column.length - firstUp;
    const revealsOrEmpties = firstUp > 0 || column[firstUp].rank !== 13;
    if (!revealsOrEmpties) continue;
    for (let target = 0; target < COLUMNS; target += 1) {
      if (target === index) continue;
      if (isLegal(board, { from: { kind: 'tab', index }, count, to: { kind: 'tab', index: target } })) return true;
    }
  }
  return [...board.stock, ...board.waste].some(placeable);
}

/** 이긴 판의 마지막 점수: 쌓인 점수에 판 보너스와 시간 보너스를 더한다. */
export function finalScore(board: Board, seconds: number): number {
  const base = Math.max(0, board.score);
  return isWon(board) ? base + POINTS.win + timeBonus(seconds) : base;
}

/** 모음 칸에 올린 카드 수 */
export function foundCount(board: Board): number {
  return board.foundations.reduce((sum, pile) => sum + pile.length, 0);
}

/** 코인: 점수 25점마다 1개 */
export function coinsFor(score: number): number {
  return Math.floor(score / 25);
}
