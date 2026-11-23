/**
 * 하이로우의 칩 걸기 모드. 화면과 분리된 순수 함수라서 테스트와 친구와 하기(versus.ts, 서버)가 그대로 쓴다.
 *
 * - 놀이 칩 CHIP_START개로 시작해서, 카드마다 칩을 걸고 다음 카드가 높을지 낮을지 고른다.
 * - 맞히면 건 칩에 배당을 곱한 만큼 돌려받는다. 배당은 그쪽이 나올 가능성이 낮을수록 크다.
 * - 같은 숫자가 나오면 건 칩을 그대로 돌려받는다. 틀리면 건 칩을 잃는다.
 * - CHIP_ROUNDS번 고르거나 칩을 다 잃으면 끝나고, 남은 칩이 점수다. 넘기기는 고른 수로 세지 않는다.
 * - 칩은 이 게임 안에서만 쓰이고 앱의 코인과는 따로다. 끝나면 남은 칩에 따라 코인을 받는다(코인을 잃지는 않는다).
 */
import { countOutcomes, judge, newDeck, type Card, type Guess, type Verdict } from './rules';

export const CHIP_START = 100;
/** 한 판에 고르는 수 */
export const CHIP_ROUNDS = 12;
export const CHIP_SKIPS = 2;
/** 칩 버튼으로 더하는 단위 */
export const CHIP_STEPS: readonly number[] = [5, 10, 25, 50];
/** 가장 적게 거는 칩. 남은 칩이 이보다 적으면 남은 칩을 모두 건다. */
export const CHIP_MIN_BET = 5;
export const CHIP_DEFAULT_BET = 10;
/** 배당의 범위(10을 곱한 정수). 1.1배 ~ 12배 */
const MIN_RATE10 = 11;
const MAX_RATE10 = 120;
/** 배당을 정할 때 덜어 내는 몫(딜러의 몫). 1이면 공평하다. */
const HOUSE = 0.95;

export interface ChipStep {
  /** 고를 때 펼쳐져 있던 카드 */
  card: Card;
  /** 넘겼으면 null */
  guess: Guess | null;
  bet: number;
  /** 배당(10을 곱한 정수) */
  rate10: number;
  /** 넘겼으면 'skip' */
  verdict: Verdict | 'skip';
  /** 이 카드로 늘거나 준 칩 */
  net: number;
}

export interface ChipRun {
  current: Card;
  /** 남은 카드. 맨 끝이 다음 카드다. */
  deck: Card[];
  chips: number;
  /** 다음에 걸 칩 */
  bet: number;
  /** 고른 수(넘기기는 세지 않는다) */
  round: number;
  skips: number;
  streak: number;
  bestStreak: number;
  wins: number;
  losses: number;
  ties: number;
  peak: number;
  history: ChipStep[];
}

/** 칩 걸기 한 판을 시작한다. deck을 주면(친구와 같은 순서로 할 때) 그 순서를 쓴다. 맨 끝이 첫 카드다. */
export function startChipRun(random: () => number = Math.random, deck?: readonly Card[]): ChipRun {
  const cards = deck ? deck.map((card) => ({ ...card })) : newDeck(random);
  const current = cards.pop() as Card;
  return {
    current,
    deck: cards,
    chips: CHIP_START,
    bet: CHIP_DEFAULT_BET,
    round: 0,
    skips: CHIP_SKIPS,
    streak: 0,
    bestStreak: 0,
    wins: 0,
    losses: 0,
    ties: 0,
    peak: CHIP_START,
    history: [],
  };
}

/** 이 칩으로 걸 수 있는 가장 적은 칩 */
export const chipMinBet = (chips: number): number => Math.min(CHIP_MIN_BET, Math.max(0, chips));

/** 걸 칩을 걸 수 있는 범위로 맞춘다. */
export function clampBet(chips: number, amount: number): number {
  return Math.max(chipMinBet(chips), Math.min(chips, Math.floor(amount)));
}

/**
 * 그쪽을 맞혔을 때의 배당(10을 곱한 정수). 나올 가능성의 역수에서 딜러 몫을 덜고 0.1배 단위로 내린다.
 * 나올 수 없는 쪽이면 0이고 고를 수 없다.
 */
export function rate10For(guess: Guess, current: number, deck: readonly Card[]): number {
  if (deck.length === 0) return 0;
  const count = countOutcomes(current, deck)[guess];
  if (count === 0) return 0;
  const raw = Math.floor(((HOUSE * deck.length) / count) * 10 + 1e-9);
  return Math.max(MIN_RATE10, Math.min(MAX_RATE10, raw));
}

/** 배당을 적는 글: "×1.5" */
export function rateLabel(rate10: number): string {
  return `×${(rate10 / 10).toFixed(1)}`;
}

/** 맞혔을 때 돌려받는 칩(건 칩 포함) */
export const payoutFor = (bet: number, rate10: number): number => Math.floor((bet * rate10) / 10);

export function chipRunOver(run: ChipRun): boolean {
  return run.round >= CHIP_ROUNDS || run.chips <= 0;
}

/** 다음 카드를 뽑는다. 묶음이 비면 새로 섞는다(한 판에 쓰는 카드는 묶음보다 적어서 여느 때는 일어나지 않는다). */
function draw(run: ChipRun, random: () => number): Card {
  if (run.deck.length === 0) run.deck = newDeck(random);
  const card = run.deck.pop() as Card;
  if (run.deck.length === 0) run.deck = newDeck(random);
  return card;
}

export interface ChipOutcome {
  step: ChipStep;
  /** 뒤집힌 카드 */
  next: Card;
  over: boolean;
}

/** 칩을 걸고 고른다. 상태를 바꾸고 결과를 돌려준다. 고를 수 없으면 null. */
export function chipGuess(run: ChipRun, guess: Guess, amount: number, random: () => number = Math.random): ChipOutcome | null {
  if (chipRunOver(run)) return null;
  const rate10 = rate10For(guess, run.current.rank, run.deck);
  if (rate10 === 0) return null;
  const bet = clampBet(run.chips, amount);
  if (bet <= 0) return null;
  const card = run.current;
  const next = draw(run, random);
  const verdict = judge(guess, card.rank, next.rank);
  let net = 0;
  if (verdict === 'win') {
    net = payoutFor(bet, rate10) - bet;
    run.wins += 1;
    run.streak += 1;
    run.bestStreak = Math.max(run.bestStreak, run.streak);
  } else if (verdict === 'tie') {
    run.ties += 1;
  } else {
    net = -bet;
    run.losses += 1;
    run.streak = 0;
  }
  run.chips += net;
  run.peak = Math.max(run.peak, run.chips);
  run.round += 1;
  run.current = next;
  run.bet = clampBet(run.chips, bet);
  const step: ChipStep = { card, guess, bet, rate10, verdict, net };
  run.history.push(step);
  return { step, next, over: chipRunOver(run) };
}

/** 넘기기: 걸지 않고 지금 카드를 다음 카드로 바꾼다. 넘기기를 다 썼으면 null. */
export function chipSkip(run: ChipRun, random: () => number = Math.random): Card | null {
  if (run.skips <= 0 || chipRunOver(run)) return null;
  run.skips -= 1;
  const card = run.current;
  run.current = draw(run, random);
  run.history.push({ card, guess: null, bet: 0, rate10: 0, verdict: 'skip', net: 0 });
  return run.current;
}

/** 판이 끝나고 받는 코인. 블랙잭처럼 남은 칩 10개마다 1코인 */
export function chipCoins(chips: number): number {
  return Math.floor(Math.max(0, chips) / 10);
}
