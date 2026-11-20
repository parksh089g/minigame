/**
 * 원카드의 규칙. Phaser에 기대지 않아서 테스트와 컴퓨터 상대(bot.ts)가 그대로 쓴다.
 *
 * 카드는 트럼프 52장과 조커 2장(흑백, 컬러)이다. 처음에 7장씩 나눠 가지고, 버린 더미 맨 위 카드와
 * 무늬나 숫자가 같은 카드를 한 장씩 낸다. 먼저 손의 카드를 다 내면 이긴다.
 * - A는 3장(스페이드 A는 5장), 2는 2장, 흑백 조커는 5장, 컬러 조커는 7장을 다음 사람에게 공격한다.
 *   공격을 받은 사람은 그보다 세거나 같은 공격 카드(무늬나 숫자가 같아야 한다)를 내서 더 크게 넘기거나,
 *   같은 무늬의 3으로 막거나, 쌓인 만큼 카드를 받는다. 조커 공격은 더 센 조커로만 넘길 수 있다.
 * - 7은 다음에 낼 무늬를 바꾼다. J는 다음 사람을 건너뛰고, Q는 차례 방향을 바꾸고, K는 한 번 더 낸다.
 * - 조커 다음에는(공격을 받아 넘긴 뒤에는) 아무 카드나 낼 수 있다.
 * - 낼 카드가 없거나 내기 싫으면 한 장 받고 차례를 넘긴다.
 * - 카드가 한 장 남으면 "원카드!"를 외쳐야 한다. 남이 먼저 외치면 벌로 한 장 받는다(시간은 화면이 잰다).
 * - 손의 카드가 MAX_HAND장을 넘으면 파산해서 그 판에서 빠진다.
 */

export type Suit = 'S' | 'D' | 'H' | 'C';
export const SUITS: readonly Suit[] = ['S', 'D', 'H', 'C'];

export interface Card {
  /** 한 판 안에서 카드마다 다른 번호 */
  id: number;
  /** 조커는 null */
  suit: Suit | null;
  /** 1(A)~13(K). 조커는 0이 흑백, 1이 컬러다. */
  rank: number;
}

export type Level = 'easy' | 'normal' | 'hard';
export const LEVELS: readonly Level[] = ['easy', 'normal', 'hard'];

export const START_HAND = 7;
/** 손의 카드가 이보다 많아지면 파산 */
export const MAX_HAND = 20;
/** 원카드를 외치지 못하고 들켰을 때 받는 카드 수 */
export const ONE_CARD_PENALTY = 1;
/** 컴퓨터는 1~3명 */
export const MIN_BOTS = 1;
export const MAX_BOTS = 3;

export interface Player {
  hand: Card[];
  /** 파산해서 빠졌는지 */
  out: boolean;
}

/** 방금 일어난 일. 화면이 알림 줄과 연출에 쓴다. */
export type GameEvent =
  | { k: 'play'; who: number; card: Card }
  | { k: 'draw'; who: number; count: number; attack: boolean }
  | { k: 'suit'; who: number; suit: Suit }
  | { k: 'skip'; who: number }
  | { k: 'reverse' }
  | { k: 'again'; who: number }
  | { k: 'block'; who: number }
  | { k: 'broke'; who: number }
  | { k: 'call'; who: number }
  | { k: 'caught'; who: number; by: number }
  | { k: 'win'; who: number };

export interface GameState {
  /** 0번이 사람, 나머지가 컴퓨터 */
  players: Player[];
  /** 뽑을 더미. 맨 끝이 맨 위다. */
  deck: Card[];
  /** 버린 더미. 맨 끝이 맨 위다. */
  discard: Card[];
  /** 지금 맞춰야 하는 무늬. 조커 다음이면 null(아무것이나) */
  suit: Suit | null;
  turn: number;
  dir: 1 | -1;
  /** 쌓인 공격. 다음 사람이 받거나 넘겨야 할 카드 수 */
  attack: number;
  /** 7을 내고 무늬를 고르는 중이면 true. 고를 때까지 차례가 넘어가지 않는다. */
  choosingSuit: boolean;
  /** 카드가 한 장 남아 "원카드!"를 기다리는 사람. 없으면 null */
  oneCard: number | null;
  /** 이긴 사람. 끝나지 않았으면 null */
  winner: number | null;
  /**
   * 사람마다 없다고 드러난 무늬: 그 무늬를 맞춰야 할 때 카드를 받고 넘긴 적이 있으면 적는다.
   * 그 무늬를 내면 지운다. 어려움 컴퓨터가 쓴다.
   */
  voids: Suit[][];
  /** 난수 상태 */
  seed: number;
  events: GameEvent[];
}

// ───────── 난수 ─────────

/** 상태 안의 seed를 굴려 0 이상 1 미만의 수를 낸다(mulberry32). */
export function nextRandom(state: { seed: number }): number {
  state.seed = (state.seed + 0x6d2b79f5) | 0;
  let t = state.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function shuffle<T>(state: { seed: number }, items: T[]): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(nextRandom(state) * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

// ───────── 카드 ─────────

export function fullDeck(): Card[] {
  const cards: Card[] = [];
  let id = 0;
  for (const suit of SUITS) {
    for (let rank = 1; rank <= 13; rank += 1) cards.push({ id: id++, suit, rank });
  }
  cards.push({ id: id++, suit: null, rank: 0 }, { id: id++, suit: null, rank: 1 });
  return cards;
}

export const isJoker = (card: Card): boolean => card.suit === null;
export const isRed = (card: Card): boolean => card.suit === 'D' || card.suit === 'H' || (card.suit === null && card.rank === 1);

/** 공격 카드면 그 세기(넘기는 카드 수), 아니면 0 */
export function attackPower(card: Card): number {
  if (card.suit === null) return card.rank === 1 ? 7 : 5;
  if (card.rank === 1) return card.suit === 'S' ? 5 : 3;
  if (card.rank === 2) return 2;
  return 0;
}

/** 처음 뒤집는 카드로 쓰지 않는 특수 카드인지 */
export function isSpecial(card: Card): boolean {
  return isJoker(card) || [1, 2, 7, 11, 12, 13].includes(card.rank);
}

export const topCard = (state: GameState): Card => state.discard[state.discard.length - 1];

// ───────── 판 만들기 ─────────

export function createGame(bots: number, seed: number): GameState {
  const count = Math.max(MIN_BOTS, Math.min(MAX_BOTS, bots)) + 1;
  const state: GameState = {
    players: Array.from({ length: count }, () => ({ hand: [], out: false })),
    deck: fullDeck(),
    discard: [],
    suit: null,
    turn: 0,
    dir: 1,
    attack: 0,
    choosingSuit: false,
    oneCard: null,
    winner: null,
    voids: Array.from({ length: count }, () => []),
    seed: seed | 0,
    events: [],
  };
  shuffle(state, state.deck);
  for (let round = 0; round < START_HAND; round += 1) {
    for (const player of state.players) player.hand.push(state.deck.pop()!);
  }
  // 특수 카드가 아닌 것이 나올 때까지 뒤집는다. 특수 카드는 더미 맨 아래로 넣는다.
  let first = state.deck.pop()!;
  while (isSpecial(first)) {
    state.deck.unshift(first);
    first = state.deck.pop()!;
  }
  state.discard.push(first);
  state.suit = first.suit;
  for (const player of state.players) sortHand(player.hand);
  // 첫 차례는 사람부터.
  return state;
}

/** 손의 카드를 무늬, 숫자 차례로 놓는다. 조커는 맨 끝이다. */
export function sortHand(hand: Card[]): void {
  const order = (card: Card): number => (card.suit === null ? 100 + card.rank : SUITS.indexOf(card.suit) * 20 + card.rank);
  hand.sort((a, b) => order(a) - order(b));
}

export const activePlayers = (state: GameState): number[] =>
  state.players.map((_, index) => index).filter((index) => !state.players[index].out);

/** from 다음으로 차례가 갈 사람(빠진 사람은 건너뛴다) */
export function nextPlayer(state: GameState, from: number, steps = 1): number {
  let index = from;
  const n = state.players.length;
  for (let step = 0; step < steps; step += 1) {
    do {
      index = (index + state.dir + n) % n;
    } while (state.players[index].out && index !== from);
  }
  return index;
}

// ───────── 낼 수 있는지 ─────────

export function canPlay(state: GameState, card: Card): boolean {
  if (state.winner !== null || state.choosingSuit) return false;
  const top = topCard(state);
  if (state.attack > 0) {
    if (isJoker(card)) return !isJoker(top) || attackPower(card) >= attackPower(top);
    if (isJoker(top)) return false;
    // 같은 무늬의 3으로 막는다.
    if (card.rank === 3) return card.suit === top.suit;
    const power = attackPower(card);
    if (power === 0 || power < attackPower(top)) return false;
    return card.suit === top.suit || card.rank === top.rank;
  }
  if (isJoker(card) || state.suit === null) return true;
  return card.suit === state.suit || (!isJoker(top) && card.rank === top.rank);
}

export function playableCards(state: GameState, who: number): Card[] {
  return state.players[who].hand.filter((card) => canPlay(state, card));
}

// ───────── 하기 ─────────

function endIfWon(state: GameState, who: number): boolean {
  if (state.players[who].hand.length > 0) return false;
  state.winner = who;
  state.oneCard = null;
  state.events.push({ k: 'win', who });
  return true;
}

/** 빠지지 않은 사람이 하나만 남았으면 그 사람이 이긴다. */
function endIfAlone(state: GameState): boolean {
  const left = activePlayers(state);
  if (left.length !== 1) return false;
  state.winner = left[0];
  state.oneCard = null;
  state.events.push({ k: 'win', who: left[0] });
  return true;
}

/** who가 카드를 낸다. 낼 수 없는 카드면 false를 돌려주고 아무것도 바꾸지 않는다. */
export function playCard(state: GameState, who: number, cardId: number): boolean {
  if (state.winner !== null || state.turn !== who || state.choosingSuit) return false;
  const hand = state.players[who].hand;
  const index = hand.findIndex((card) => card.id === cardId);
  if (index < 0) return false;
  const card = hand[index];
  if (!canPlay(state, card)) return false;
  const blocking = state.attack > 0 && card.rank === 3 && !isJoker(card);
  hand.splice(index, 1);
  state.discard.push(card);
  state.suit = card.suit;
  if (card.suit) state.voids[who] = state.voids[who].filter((suit) => suit !== card.suit);
  state.events.push({ k: 'play', who, card });
  // 앞선 사람이 원카드를 외칠 틈은 다음 사람이 내면 끝난다.
  state.oneCard = hand.length === 1 ? who : null;
  if (endIfWon(state, who)) return true;

  if (blocking) {
    state.attack = 0;
    state.events.push({ k: 'block', who });
  } else {
    state.attack += attackPower(card);
  }
  if (!isJoker(card) && card.rank === 7 && !blocking) {
    state.choosingSuit = true;
    return true;
  }
  if (!isJoker(card) && card.rank === 13) {
    state.events.push({ k: 'again', who });
    return true;
  }
  if (!isJoker(card) && card.rank === 11) {
    const skipped = nextPlayer(state, who);
    state.events.push({ k: 'skip', who: skipped });
    state.turn = nextPlayer(state, who, 2);
    return true;
  }
  if (!isJoker(card) && card.rank === 12) {
    state.dir = state.dir === 1 ? -1 : 1;
    state.events.push({ k: 'reverse' });
  }
  state.turn = nextPlayer(state, who);
  return true;
}

/** 7을 낸 사람이 다음 무늬를 고른다. */
export function chooseSuit(state: GameState, suit: Suit): boolean {
  if (!state.choosingSuit) return false;
  state.choosingSuit = false;
  state.suit = suit;
  state.events.push({ k: 'suit', who: state.turn, suit });
  state.turn = nextPlayer(state, state.turn);
  return true;
}

/** 버린 더미(맨 위 한 장은 남기고)를 섞어 뽑을 더미로 만든다. */
function refill(state: GameState): void {
  if (state.discard.length <= 1) return;
  const top = state.discard.pop()!;
  state.deck = state.discard;
  state.discard = [top];
  shuffle(state, state.deck);
}

/** who에게 카드를 count장 준다. 파산하면 빠진다. 실제로 준 수를 돌려준다. */
export function giveCards(state: GameState, who: number, count: number): number {
  const player = state.players[who];
  let given = 0;
  for (let i = 0; i < count; i += 1) {
    if (state.deck.length === 0) refill(state);
    const card = state.deck.pop();
    if (!card) break;
    player.hand.push(card);
    given += 1;
  }
  sortHand(player.hand);
  if (state.oneCard === who && player.hand.length > 1) state.oneCard = null;
  if (player.hand.length > MAX_HAND) {
    player.out = true;
    // 파산한 사람의 카드는 뽑을 더미 아래로 돌아간다.
    state.deck.unshift(...player.hand);
    player.hand = [];
    state.events.push({ k: 'broke', who });
    if (state.turn === who && !endIfAlone(state)) state.turn = nextPlayer(state, who);
    else endIfAlone(state);
  }
  return given;
}

/** 차례인 사람이 카드를 받고 차례를 넘긴다. 공격을 받고 있으면 쌓인 만큼 받는다. */
export function drawTurn(state: GameState, who: number): boolean {
  if (state.winner !== null || state.turn !== who || state.choosingSuit) return false;
  const attacked = state.attack > 0;
  const count = attacked ? state.attack : 1;
  state.attack = 0;
  if (!attacked && state.suit && !state.voids[who].includes(state.suit) && playableCards(state, who).length === 0) {
    state.voids[who].push(state.suit);
  }
  // 앞선 사람이 원카드를 외칠 틈은 다음 사람이 움직이면 끝난다.
  if (state.oneCard !== who) state.oneCard = null;
  const given = giveCards(state, who, count);
  state.events.push({ k: 'draw', who, count: given, attack: attacked });
  if (state.winner === null && !state.players[who].out) state.turn = nextPlayer(state, who);
  return true;
}

/** 카드가 한 장 남은 사람이 스스로 "원카드!"를 외쳤다. */
export function callOneCard(state: GameState, who: number): boolean {
  if (state.oneCard !== who) return false;
  state.oneCard = null;
  state.events.push({ k: 'call', who });
  return true;
}

/** by가 먼저 "원카드!"를 외쳐서, 외치지 못한 사람이 벌로 카드를 받는다. */
export function catchOneCard(state: GameState, by: number): boolean {
  const who = state.oneCard;
  if (who === null || who === by) return false;
  state.oneCard = null;
  state.events.push({ k: 'caught', who, by });
  giveCards(state, who, ONE_CARD_PENALTY);
  return true;
}

/** 아무도 외치지 않고 틈이 지나갔다. */
export function closeOneCard(state: GameState): void {
  state.oneCard = null;
}

/** 쌓인 이벤트를 꺼내고 비운다. */
export function takeEvents(state: GameState): GameEvent[] {
  const events = state.events;
  state.events = [];
  return events;
}

// ───────── 점수 ─────────

const LEVEL_BASE: Readonly<Record<Level, number>> = { easy: 100, normal: 200, hard: 300 };

/**
 * 한 판의 점수. 지면 0점이다. 이기면 난이도에 따른 기본 점수에, 상대가 손에 남긴 카드 한 장마다 10점,
 * 상대가 한 명 늘 때마다 50점을 더한다.
 */
export function matchScore(state: GameState, level: Level): number {
  if (state.winner !== 0) return 0;
  const left = state.players.slice(1).reduce((sum, player) => sum + (player.out ? MAX_HAND : player.hand.length), 0);
  return LEVEL_BASE[level] + left * 10 + (state.players.length - 2) * 50;
}
