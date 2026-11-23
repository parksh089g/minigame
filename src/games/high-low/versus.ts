/**
 * 친구와 함께하는 하이로우: 공용 방 규칙(versus/room.ts)에 칩 걸기 하이로우를 끼우는 부분.
 * Phaser에 기대지 않아서 서버도 그대로 쓴다.
 *
 * 두 사람이 같은 순서로 섞인 카드 묶음으로 칩 걸기 한 판(chips.ts)을 차례로 한다. 먼저 하는 사람이 다 하면
 * 다음 사람이 같은 카드로 한다. 남은 칩이 더 많은 사람이 이기고, 같으면 비긴다.
 * 뒤에 하는 사람이 앞사람의 카드를 미리 보면 안 되므로, 자기 판을 마치기 전에는 상대가 본 카드를 가린다(칩과 맞힌 수만 보인다).
 * 남은 카드 묶음은 순서 없이(정렬해서) 보낸다. 배당과 확률을 셈하는 데는 무슨 카드가 남았는지만 있으면 된다.
 */
import type { Seat } from '../../versus/protocol';
import type { TurnGame } from '../../versus/room';
import { seededRandom, seedFrom } from '../../versus/seeded';
import { CHIP_ROUNDS, CHIP_SKIPS, chipGuess, chipRunOver, chipSkip, startChipRun, type ChipRun, type ChipStep } from './chips';
import { newDeck, SUITS, type Card, type Guess } from './rules';

export type HighLowMove = { type: 'guess'; guess: Guess; bet: number } | { type: 'skip' };

export interface HighLowMatch {
  runs: [ChipRun, ChipRun];
  /** 먼저 하는 자리 */
  first: Seat;
  seed: number;
  moves: number;
}

/** 상대의 판. 내가 판을 마치기 전에는 상대가 본 카드(history, current)를 비워 보낸다. */
export interface FoeRun {
  chips: number;
  round: number;
  wins: number;
  losses: number;
  ties: number;
  bestStreak: number;
  done: boolean;
  /** 카드를 보여 줄 수 있으면 상대의 기록, 아니면 빈 목록 */
  history: ChipStep[];
}

export interface HighLowView {
  /** 내 판. deck은 순서 없이 정렬한 남은 카드다. */
  mine: ChipRun;
  foe: FoeRun;
  first: Seat;
  moves: number;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isInt = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
const isGuess = (value: unknown): value is Guess => value === 'high' || value === 'low';

export function readHighLowMove(raw: unknown): HighLowMove | null {
  if (!isObject(raw)) return null;
  if (raw.type === 'skip') return { type: 'skip' };
  if (raw.type === 'guess' && isGuess(raw.guess) && isInt(raw.bet, 0, 1_000_000)) return { type: 'guess', guess: raw.guess, bet: raw.bet };
  return null;
}

export function startHighLow(random: () => number, first: Seat): HighLowMatch {
  const state = { seed: seedFrom(random) };
  const deck = newDeck(seededRandom(state));
  return { runs: [startChipRun(Math.random, deck), startChipRun(Math.random, deck)], first, seed: state.seed, moves: 0 };
}

export function highLowTurn(state: HighLowMatch): Seat | null {
  const second: Seat = state.first === 0 ? 1 : 0;
  if (!chipRunOver(state.runs[state.first])) return state.first;
  if (!chipRunOver(state.runs[second])) return second;
  return null;
}

const SUIT_ORDER = (card: Card): number => card.rank * 4 + SUITS.indexOf(card.suit);
const copyStep = (step: ChipStep): ChipStep => ({ ...step, card: { ...step.card } });

export function highLowView(state: HighLowMatch, seat: Seat): HighLowView {
  const mine = state.runs[seat];
  const theirs = state.runs[seat === 0 ? 1 : 0];
  const showFoe = chipRunOver(mine);
  return {
    mine: {
      ...mine,
      current: { ...mine.current },
      deck: [...mine.deck].sort((a, b) => SUIT_ORDER(a) - SUIT_ORDER(b)),
      history: mine.history.map(copyStep),
    },
    foe: {
      chips: theirs.chips,
      round: theirs.round,
      wins: theirs.wins,
      losses: theirs.losses,
      ties: theirs.ties,
      bestStreak: theirs.bestStreak,
      done: chipRunOver(theirs),
      history: showFoe ? theirs.history.map(copyStep) : [],
    },
    first: state.first,
    moves: state.moves,
  };
}

function isCard(raw: unknown): raw is Card {
  return isObject(raw) && SUITS.includes(raw.suit as Card['suit']) && isInt(raw.rank, 1, 13);
}

const VERDICTS = ['win', 'tie', 'lose', 'skip'];

function isStep(raw: unknown): raw is ChipStep {
  if (!isObject(raw) || !isCard(raw.card) || !VERDICTS.includes(raw.verdict as string)) return false;
  if (raw.guess !== null && !isGuess(raw.guess)) return false;
  return isInt(raw.bet, 0, 10_000_000) && isInt(raw.rate10, 0, 1000) && isInt(raw.net, -10_000_000, 100_000_000);
}

const isSteps = (value: unknown): value is ChipStep[] =>
  Array.isArray(value) && value.length <= CHIP_ROUNDS + CHIP_SKIPS + 2 && value.every(isStep);
const isCount = (value: unknown): value is number => isInt(value, 0, 100_000_000);

export function readHighLowView(raw: unknown): HighLowView | null {
  if (!isObject(raw) || !isObject(raw.mine) || !isObject(raw.foe) || !isInt(raw.first, 0, 1) || !isCount(raw.moves)) return null;
  const mine = raw.mine;
  if (!isCard(mine.current) || !Array.isArray(mine.deck) || mine.deck.length > 52 || !mine.deck.every(isCard)) return null;
  for (const key of ['chips', 'bet', 'round', 'skips', 'streak', 'bestStreak', 'wins', 'losses', 'ties', 'peak'] as const) {
    if (!isCount(mine[key])) return null;
  }
  if (!isSteps(mine.history)) return null;
  const foe = raw.foe;
  for (const key of ['chips', 'round', 'wins', 'losses', 'ties', 'bestStreak'] as const) {
    if (!isCount(foe[key])) return null;
  }
  if (typeof foe.done !== 'boolean' || !isSteps(foe.history)) return null;
  return { mine: mine as unknown as ChipRun, foe: foe as unknown as FoeRun, first: raw.first as Seat, moves: raw.moves };
}

export const highLowVersus: TurnGame<HighLowMatch, HighLowMove, HighLowView> = {
  id: 'high-low',
  start: startHighLow,
  readMove: readHighLowMove,
  play(state, seat, move) {
    if (highLowTurn(state) !== seat) return false;
    const run = state.runs[seat];
    const random = seededRandom(state);
    const ok = move.type === 'skip' ? chipSkip(run, random) !== null : chipGuess(run, move.guess, move.bet, random) !== null;
    if (ok) state.moves += 1;
    return ok;
  },
  turnOf: highLowTurn,
  outcome(state) {
    if (highLowTurn(state) !== null) return undefined;
    const [a, b] = [state.runs[0].chips, state.runs[1].chips];
    return { winner: a === b ? null : a > b ? 0 : 1 };
  },
  view: highLowView,
  readView: readHighLowView,
};

