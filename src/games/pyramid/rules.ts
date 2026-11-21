/**
 * 피라미드의 규칙. 화면과 분리된 순수 함수라서 숫자만 바꿔 밸런스를 잡을 수 있고 테스트하기 쉽다.
 *
 * 카드 52장 가운데 28장을 일곱 줄의 피라미드로 깔고, 남은 24장은 더미로 둔다.
 * 위에 다른 카드가 얹히지 않은(아래 줄의 두 장이 모두 치워진) 카드만 고를 수 있다.
 * 숫자의 합이 13이 되는 두 장을 골라 치운다. A는 1, J는 11, Q는 12, K는 13이라 K는 혼자 치운다.
 * 더미에서 한 장씩 넘겨 버린 카드 더미의 맨 위 카드도 짝으로 쓸 수 있다. 더미는 PASSES번까지 다시 돌린다.
 * 피라미드를 다 치우면 이기고, 더 둘 수 없으면 끝난다.
 */

/** 무늬: 스페이드, 하트, 다이아, 클로버. 하트와 다이아가 붉은 무늬다. */
export const SUITS = ['spade', 'heart', 'diamond', 'club'] as const;
export type Suit = (typeof SUITS)[number];

export interface Card {
  /** 1(A)부터 13(K)까지 */
  rank: number;
  suit: Suit;
}

export const isRed = (card: Card): boolean => card.suit === 'heart' || card.suit === 'diamond';

/** 카드에 적는 숫자 */
export function rankLabel(rank: number): string {
  if (rank === 1) return 'A';
  if (rank === 11) return 'J';
  if (rank === 12) return 'Q';
  if (rank === 13) return 'K';
  return String(rank);
}

/** 짝이 되는 합 */
export const PAIR_SUM = 13;
/** 피라미드의 줄 수. 맨 아랫줄에 이만큼 놓인다. */
export const ROWS = 7;
/** 피라미드에 까는 카드 수 */
export const PYRAMID_SIZE = (ROWS * (ROWS + 1)) / 2;
/** 더미를 넘길 수 있는 횟수. 처음 한 번을 더해 센다(3이면 두 번 다시 돌린다). */
export const PASSES = 3;

// ───────── 자리 ─────────

/** 줄(0이 꼭대기)과 칸으로 피라미드 안의 번호를 낸다. */
export function slotOf(row: number, col: number): number {
  return (row * (row + 1)) / 2 + col;
}

/** 피라미드 안의 번호를 줄과 칸으로 */
export function rowColOf(slot: number): { row: number; col: number } {
  let row = 0;
  while (slotOf(row + 1, 0) <= slot) row += 1;
  return { row, col: slot - slotOf(row, 0) };
}

/** 그 자리를 덮고 있는 아래 줄의 두 자리. 맨 아랫줄이면 빈 배열 */
export function coveredBy(slot: number): number[] {
  const { row, col } = rowColOf(slot);
  if (row >= ROWS - 1) return [];
  return [slotOf(row + 1, col), slotOf(row + 1, col + 1)];
}

// ───────── 섞기 ─────────

/** 32비트 씨앗에서 0 이상 1 미만의 수를 차례로 내는 난수(mulberry32). 같은 씨앗이면 언제나 같은 수가 나온다. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 카드 한 벌(52장)을 무늬, 숫자 순서로 */
export function fullDeck(): Card[] {
  return SUITS.flatMap((suit) => Array.from({ length: 13 }, (_, index) => ({ rank: index + 1, suit })));
}

/** 판 하나. 빈 자리는 null이다. */
export interface Board {
  /** 피라미드의 28자리. slotOf의 번호 순서 */
  pyramid: (Card | null)[];
  /** 아직 넘기지 않은 더미. 배열의 끝이 맨 위다. */
  stock: Card[];
  /** 넘겨서 버린 카드 더미. 배열의 끝이 맨 위이고, 맨 위의 카드만 쓸 수 있다. */
  waste: Card[];
  /** 지금 몇 번째로 더미를 넘기고 있는지(1부터) */
  pass: number;
}

/** 씨앗으로 카드를 섞어 판을 깐다. 같은 씨앗이면 누구에게나 같은 판이다. */
export function deal(seed: number): Board {
  const random = seededRandom(seed);
  const deck = fullDeck();
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return {
    pyramid: deck.slice(0, PYRAMID_SIZE),
    stock: deck.slice(PYRAMID_SIZE).reverse(),
    waste: [],
    pass: 1,
  };
}

// ───────── 고르기 ─────────

/** 고를 수 있는 카드의 자리: 피라미드의 한 자리이거나, 버린 카드 더미의 맨 위 */
export type Spot = { kind: 'pyramid'; slot: number } | { kind: 'waste' };

export const sameSpot = (a: Spot, b: Spot): boolean =>
  a.kind === b.kind && (a.kind === 'waste' || (b.kind === 'pyramid' && a.slot === b.slot));

/** 그 자리의 카드가 위에 아무것도 얹히지 않아 고를 수 있는지 */
export function isFree(board: Board, slot: number): boolean {
  if (board.pyramid[slot] === null) return false;
  return coveredBy(slot).every((below) => board.pyramid[below] === null);
}

/** 그 자리에 놓인 카드. 고를 수 없는 자리면 null */
export function cardAt(board: Board, spot: Spot): Card | null {
  if (spot.kind === 'waste') return board.waste.at(-1) ?? null;
  return isFree(board, spot.slot) ? board.pyramid[spot.slot] : null;
}

/** 지금 고를 수 있는 자리 모두. 피라미드 자리가 앞에 오고 버린 카드가 맨 뒤다. */
export function freeSpots(board: Board): Spot[] {
  const spots: Spot[] = [];
  for (let slot = 0; slot < PYRAMID_SIZE; slot += 1) if (isFree(board, slot)) spots.push({ kind: 'pyramid', slot });
  if (board.waste.length > 0) spots.push({ kind: 'waste' });
  return spots;
}

/** 한 번에 치울 수 있는 것: K 한 장이거나 합이 13인 두 장 */
export type Move = readonly [Spot] | readonly [Spot, Spot];

/** 그 카드들을 한 번에 치울 수 있는지 */
export function canClear(cards: readonly Card[]): boolean {
  if (cards.length === 1) return cards[0].rank === PAIR_SUM;
  if (cards.length === 2) return cards[0].rank + cards[1].rank === PAIR_SUM;
  return false;
}

/** 지금 할 수 있는 치우기 모두. K부터, 그 다음은 피라미드 위쪽부터 */
export function availableMoves(board: Board): Move[] {
  const spots = freeSpots(board);
  const cards = spots.map((spot) => cardAt(board, spot) as Card);
  const moves: Move[] = [];
  spots.forEach((spot, index) => {
    if (canClear([cards[index]])) moves.push([spot]);
  });
  for (let a = 0; a < spots.length; a += 1) {
    for (let b = a + 1; b < spots.length; b += 1) {
      if (canClear([cards[a], cards[b]])) moves.push([spots[a], spots[b]]);
    }
  }
  return moves;
}

/**
 * 그 자리들의 카드를 치운다. 치울 수 없으면 판을 그대로 두고 false를 돌려준다.
 * 같은 자리를 두 번 주거나 고를 수 없는 카드가 끼어 있으면 치울 수 없다.
 */
export function clearSpots(board: Board, spots: readonly Spot[]): boolean {
  if (spots.length === 2 && sameSpot(spots[0], spots[1])) return false;
  const cards = spots.map((spot) => cardAt(board, spot));
  if (cards.some((card) => card === null) || !canClear(cards as Card[])) return false;
  for (const spot of spots) {
    if (spot.kind === 'waste') board.waste.pop();
    else board.pyramid[spot.slot] = null;
  }
  return true;
}

/** 더미를 눌렀을 때 일어난 일 */
export type DrawOutcome = 'drew' | 'recycled' | 'none';

/**
 * 더미에서 한 장을 넘긴다. 더미가 비었으면 남은 횟수가 있을 때 버린 카드를 뒤집어 다시 더미로 만든다.
 * 다시 돌릴 수 없으면 아무 일도 없다.
 */
export function drawCard(board: Board): DrawOutcome {
  const card = board.stock.pop();
  if (card) {
    board.waste.push(card);
    return 'drew';
  }
  if (!canRecycle(board)) return 'none';
  board.stock = board.waste.reverse();
  board.waste = [];
  board.pass += 1;
  return 'recycled';
}

/** 더미가 비었을 때 버린 카드를 다시 더미로 돌릴 수 있는지 */
export function canRecycle(board: Board): boolean {
  return board.stock.length === 0 && board.waste.length > 0 && board.pass < PASSES;
}

/** 피라미드를 다 치웠는지 */
export function isCleared(board: Board): boolean {
  return board.pyramid.every((card) => card === null);
}

/** 남은 피라미드 카드 수 */
export function pyramidLeft(board: Board): number {
  return board.pyramid.filter((card) => card !== null).length;
}

/** 더 둘 수가 없는지: 치울 짝이 없고, 넘길 카드도 다시 돌릴 횟수도 없다. */
export function isStuck(board: Board): boolean {
  if (isCleared(board)) return false;
  if (board.stock.length > 0 || canRecycle(board)) return false;
  return availableMoves(board).length === 0;
}

// ───────── 점수 ─────────

/** 피라미드의 카드 한 장을 치우면 */
export const PYRAMID_POINTS = 10;
/** 버린 카드 더미의 카드 한 장을 치우면 */
export const WASTE_POINTS = 5;
/** 더미를 넘기지 않고 이어서 치울 때 한 번마다 붙는 덤. 몇 번 이었는지에 곱한다. */
export const CHAIN_STEP = 2;
/** 이어 치우기 덤의 가장 큰 값 */
export const CHAIN_MAX = 10;
/** 피라미드를 다 치우면 */
export const CLEAR_BONUS = 150;
/** 다 치웠을 때 남은 더미 돌리기 한 번마다 */
export const PASS_BONUS = 50;
/** 다 치웠을 때 이 초보다 빨리 깬 만큼 1초에 1점 */
export const TIME_BONUS_SECONDS = 180;

/**
 * 한 번 치웠을 때의 점수. chain은 더미를 넘기지 않고 이어서 치운 횟수(이번 것까지, 1부터).
 * cards는 이번에 치운 카드가 피라미드에서 몇 장, 버린 더미에서 몇 장인지.
 */
export function clearPoints(fromPyramid: number, fromWaste: number, chain: number): number {
  const chainBonus = Math.min(CHAIN_MAX, CHAIN_STEP * Math.max(0, chain - 1));
  return fromPyramid * PYRAMID_POINTS + fromWaste * WASTE_POINTS + chainBonus;
}

/** 피라미드를 다 치웠을 때 더 받는 점수: 깬 덤, 남은 돌리기, 빨리 깬 만큼 */
export function finishBonus(board: Board, seconds: number): number {
  if (!isCleared(board)) return 0;
  const passesLeft = Math.max(0, PASSES - board.pass);
  const quick = Math.max(0, Math.floor(TIME_BONUS_SECONDS - seconds));
  return CLEAR_BONUS + passesLeft * PASS_BONUS + quick;
}

// ───────── 자리 셈 ─────────

export interface CardMetrics {
  width: number;
  height: number;
  /** 옆 카드와의 간격 */
  gap: number;
  /** 한 줄 아래로 내려가는 만큼. 카드 높이보다 작아서 아래 줄이 윗줄의 아래쪽을 덮는다. */
  step: number;
}

/** 피라미드의 한 자리의 카드 중심. top은 꼭대기 카드의 위쪽 끝, centerX는 화면 가운데 */
export function slotCenter(slot: number, centerX: number, top: number, card: CardMetrics): { x: number; y: number } {
  const { row, col } = rowColOf(slot);
  const pitch = card.width + card.gap;
  const left = centerX - (row * pitch) / 2;
  return { x: Math.round(left + col * pitch), y: Math.round(top + row * card.step + card.height / 2) };
}
