/**
 * 둘이서 대결의 규칙. 화면과 분리된 순수 함수라서 Phaser 없이 테스트하고 숫자만 바꿔 손볼 수 있다.
 *
 * 한 경기는 짧은 판 여러 개로 이루어지고, 먼저 WINS_TO_TAKE_MATCH판을 이긴 쪽이 경기를 이긴다.
 * 판마다 세 종목(번쩍 반응, 연타 줄다리기, 같은 그림 찾기) 가운데 하나로 겨룬다.
 *
 * 경기는 일어난 일을 하나씩 받아 다음 상태로 넘어가는 작은 상태 기계다(stepMatch). 일에는 모두 시각(at)이 붙는다.
 * - tick: 화면이 한 번 그려졌다. 신호가 뜨고, 그림이 나타나고, 제한 시간이 끝나는 것은 여기서만 일어난다.
 * - touch: 누군가 자기 쪽 화면을 눌렀다. 누른 것이 버튼이면 option에 그 번호가 들어 있다.
 * - resume: 일시정지에서 돌아왔다. 하던 판을 공평하게 다시 준비시킨다.
 * 시각은 씬의 시계(ms)다. 일시정지한 동안에는 흐르지 않고, 실제 시계(Date.now)와는 상관이 없다.
 * 무작위가 필요한 곳은 random(0 이상 1 미만의 수를 돌려주는 함수)을 받아서 쓴다.
 * 받은 상태는 바꾸지 않고 언제나 새 상태를 돌려준다.
 */

// ───────── 두 사람 ─────────

/** 0은 화면 아래쪽에 앉은 사람, 1은 위쪽에 앉은 사람이다. */
export type Player = 0 | 1;
export const PLAYERS: readonly Player[] = [0, 1];

export function opponentOf(player: Player): Player {
  return player === 0 ? 1 : 0;
}

/** 두 사람 몫의 값 한 쌍. [아래쪽 사람, 위쪽 사람] 순서다. */
export type Pair<T> = readonly [T, T];

function withPair<T>(pair: Pair<T>, player: Player, value: T): Pair<T> {
  return player === 0 ? [value, pair[1]] : [pair[0], value];
}

// ───────── 무작위 ─────────

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
}

function between(min: number, max: number, random: () => number): number {
  return min + (max - min) * random();
}

/** 순서를 섞은 새 배열을 돌려준다. */
export function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.min(index, Math.floor(random() * (index + 1)));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

// ───────── 종목 고르기 ─────────

export const CONTESTS = ['reaction', 'tug', 'symbol'] as const;
export type Contest = (typeof CONTESTS)[number];

/** 이만큼 먼저 이기면 경기를 이긴다. */
export const WINS_TO_TAKE_MATCH = 3;
/** 한 경기가 가장 길어질 때의 판 수 (2 대 2에서 마지막 판) */
export const MAX_ROUNDS = WINS_TO_TAKE_MATCH * 2 - 1;

/**
 * 다음 판의 종목을 고른다. played는 지금까지 한 종목을 차례대로 적은 것이다.
 * 처음 세 판에는 세 종목이 한 번씩 나오고, 그 뒤로는 바로 앞 판과 다른 종목이 나온다.
 * 그래서 같은 종목이 두 판 연달아 나오는 일은 없다.
 */
export function nextContest(played: readonly Contest[], random: () => number): Contest {
  const fresh = CONTESTS.filter((contest) => !played.includes(contest));
  if (fresh.length > 0) return pick(fresh, random);
  const last = played[played.length - 1];
  return pick(
    CONTESTS.filter((contest) => contest !== last),
    random,
  );
}

// ───────── 시간과 숫자 ─────────

/** 두 사람이 모두 준비한 뒤 첫 판의 안내가 뜨기까지(ms) */
export const LOBBY_START_MS = 800;
/** 종목 이름과 하는 법을 보여 주는 시간(ms). 이동안은 눌러도 아무 일이 없다. */
export const INTRO_MS = 2400;
/** 판이 끝난 뒤 누가 이겼는지 보여 주는 시간(ms) */
export const RESULT_MS = 2200;

/** 번쩍 반응: "기다려요"가 뜬 뒤 신호가 울리기까지(ms). 이 사이의 무작위 시각에 울린다. */
export const REACTION_MIN_WAIT_MS = 1500;
export const REACTION_MAX_WAIT_MS = 4000;

/** 연타 줄다리기: 가운데에서 상대 골라인까지의 걸음 수. 한 번 누르면 한 걸음이다. */
export const TUG_GOAL_STEPS = 12;
/** 연타 줄다리기: "준비"가 뜬 뒤 누르기가 세어지기 시작할 때까지(ms) */
export const TUG_READY_MS = 900;
/** 연타 줄다리기: 제한 시간(ms). 이때까지 골라인을 넘지 못하면 더 밀어 놓은 쪽이 이긴다. */
export const TUG_TIME_MS = 10000;

/** 같은 그림 찾기: 그림의 가짓수와 한 사람에게 주는 버튼 수. 그림은 art.ts에 가짓수만큼 그려 두어야 한다. */
export const SYMBOL_KINDS = 5;
export const SYMBOL_OPTIONS = 4;
/** 같은 그림 찾기: "준비"가 뜬 뒤 그림이 나타나기까지(ms). 박자를 외우지 못하게 조금씩 달라진다. */
export const SYMBOL_MIN_READY_MS = 800;
export const SYMBOL_MAX_READY_MS = 1600;
/** 같은 그림 찾기: 틀린 그림을 누르면 이만큼 쉰다(ms). */
export const SYMBOL_LOCK_MS = 1000;

/** 준비 화면에서 "준비" 버튼의 번호 */
export const READY_OPTION = 0;

// ───────── 한 판의 상태 ─────────

interface RoundBase {
  /** 두 사람이 똑같은 순간에 눌렀을 때 먼저 누른 것으로 쳐 줄 사람. 판마다 동전을 던져 정한다. */
  tieGoesTo: Player;
}

/** 번쩍 반응: 신호가 뜬 뒤에 먼저 누르면 이기고, 신호보다 먼저 누르면 반칙으로 진다. */
export interface ReactionRound extends RoundBase {
  contest: 'reaction';
  /** 신호가 울리기로 정해진 시각 */
  signalAt: number;
  /** 신호가 화면에 뜬 시각. 아직 뜨지 않았으면 null이다. */
  signaledAt: number | null;
}

/** 연타 줄다리기: 누를 때마다 표시가 상대 쪽으로 한 걸음 간다. */
export interface TugRound extends RoundBase {
  contest: 'tug';
  /** 누르기가 세어지기 시작하는 시각 */
  goAt: number;
  /** "시작"이 화면에 떴는지. 그 전에 누른 것은 세지 않는다. */
  live: boolean;
  /** 제한 시간이 끝나는 시각 */
  deadline: number;
  /**
   * 표시의 자리. 가운데가 0이고, 아래쪽 사람이 누르면 1 늘고 위쪽 사람이 누르면 1 준다.
   * TUG_GOAL_STEPS에 닿으면 아래쪽 사람이, -TUG_GOAL_STEPS에 닿으면 위쪽 사람이 이긴다.
   */
  position: number;
  /** 한가운데에서 시간이 끝나, 다음에 먼저 누르는 쪽이 이기는 상태인지 */
  suddenDeath: boolean;
}

/** 같은 그림 찾기: 가운데에 나온 그림과 같은 그림의 버튼을 먼저 누르면 이긴다. */
export interface SymbolRound extends RoundBase {
  contest: 'symbol';
  /** 그림이 나타나기로 정해진 시각 */
  revealAt: number;
  /** 그림이 화면에 나타났는지. 그 전에는 누를 버튼이 없다. */
  revealed: boolean;
  /** 찾아야 하는 그림의 번호 (0부터 SYMBOL_KINDS - 1까지) */
  target: number;
  /** 사람마다 받은 버튼의 그림 번호. 그 사람이 보는 왼쪽부터 차례대로다. 두 사람이 같은 그림들을 다른 순서로 받는다. */
  options: Pair<readonly number[]>;
  /** 틀려서 쉬는 것이 끝나는 시각. 쉬고 있지 않으면 지난 시각이다. */
  lockedUntil: Pair<number>;
}

export type Round = ReactionRound | TugRound | SymbolRound;

/** 판이 어떻게 끝났는지 */
export type WinReason =
  /** 번쩍 반응: 신호가 뜬 뒤에 먼저 눌렀다 */
  | 'faster'
  /** 번쩍 반응: 진 사람이 신호보다 먼저 눌렀다 */
  | 'foul'
  /** 연타 줄다리기: 상대 골라인까지 밀었다 */
  | 'goal'
  /** 연타 줄다리기: 시간이 끝났을 때 더 밀어 놓았다 */
  | 'timeout'
  /** 연타 줄다리기: 한가운데에서 시간이 끝난 뒤에 먼저 눌렀다 */
  | 'suddenDeath'
  /** 같은 그림 찾기: 같은 그림을 먼저 눌렀다 */
  | 'match';

export interface Outcome {
  contest: Contest;
  winner: Player;
  reason: WinReason;
  /** 번쩍 반응에서 신호가 뜬 뒤 누르기까지 걸린 시간(ms). 다른 경우에는 null이다. */
  reactionMs: number | null;
}

// ───────── 일어난 일과 알릴 일 ─────────

export type MatchEvent =
  | { type: 'tick'; at: number }
  | { type: 'touch'; player: Player; at: number; option?: number }
  | { type: 'resume'; at: number };

/** 상태가 넘어가면서 생긴 일. 씬이 소리와 움직임으로 알린다. */
export type Effect =
  | { type: 'ready'; player: Player }
  | { type: 'allReady' }
  | { type: 'intro'; contest: Contest; roundNumber: number }
  /** 판이 시작되어 "기다려요"나 "준비"가 뜬다. 일시정지에서 돌아와 다시 준비할 때도 나온다. */
  | { type: 'armed'; contest: Contest; again: boolean }
  /** 번쩍 반응의 신호 */
  | { type: 'signal' }
  /** 연타 줄다리기의 시작 */
  | { type: 'go' }
  /** 같은 그림 찾기의 그림이 나타남 */
  | { type: 'reveal' }
  /** 연타 줄다리기에서 한 번 밀었다. position은 밀고 난 뒤의 표시 자리다. */
  | { type: 'push'; player: Player; position: number }
  | { type: 'suddenDeath' }
  | { type: 'wrong'; player: Player; option: number }
  | { type: 'roundWon'; outcome: Outcome }
  | { type: 'matchWon'; outcome: Outcome };

// ───────── 판 만들기 ─────────

export interface SymbolDeal {
  target: number;
  options: Pair<readonly number[]>;
}

function sameOrder(a: readonly number[], b: readonly number[]): boolean {
  return a.every((value, index) => value === b[index]);
}

/**
 * 같은 그림 찾기의 그림을 나눠 준다. 두 사람이 같은 그림 SYMBOL_OPTIONS개를 서로 다른 순서로 받고,
 * 찾아야 하는 그림은 그 가운데 하나다.
 */
export function dealSymbols(random: () => number): SymbolDeal {
  const kinds = Array.from({ length: SYMBOL_KINDS }, (_, kind) => kind);
  const set = shuffled(kinds, random).slice(0, SYMBOL_OPTIONS);
  const target = pick(set, random);
  const first = shuffled(set, random);
  let second = shuffled(set, random);
  for (let attempt = 0; attempt < 8 && sameOrder(first, second); attempt += 1) {
    second = shuffled(set, random);
  }
  // 몇 번을 섞어도 같은 순서만 나오면 한 칸씩 밀어서라도 다르게 만든다.
  if (sameOrder(first, second)) second = [...first.slice(1), first[0]];
  return { target, options: [first, second] };
}

/** at 시각에 시작하는 새 판을 만든다. */
export function newRound(contest: Contest, at: number, random: () => number): Round {
  const tieGoesTo: Player = random() < 0.5 ? 0 : 1;
  if (contest === 'reaction') {
    return {
      contest,
      tieGoesTo,
      signalAt: at + between(REACTION_MIN_WAIT_MS, REACTION_MAX_WAIT_MS, random),
      signaledAt: null,
    };
  }
  if (contest === 'tug') {
    const goAt = at + TUG_READY_MS;
    return {
      contest,
      tieGoesTo,
      goAt,
      live: false,
      deadline: goAt + TUG_TIME_MS,
      position: 0,
      suddenDeath: false,
    };
  }
  return {
    contest,
    tieGoesTo,
    revealAt: at + between(SYMBOL_MIN_READY_MS, SYMBOL_MAX_READY_MS, random),
    revealed: false,
    ...dealSymbols(random),
    lockedUntil: [0, 0],
  };
}

/**
 * 일시정지에서 돌아왔을 때 하던 판을 다시 준비시킨다. 멈춘 동안 화면을 보고 있던 쪽이 덕을 보지 않게 한다.
 * - 번쩍 반응: 신호를 거두고 기다리는 시간을 새로 뽑는다.
 * - 연타 줄다리기: 표시의 자리와 남은 시간은 그대로 두고 "준비"부터 다시 한다.
 * - 같은 그림 찾기: 그림을 새로 나눠 주고 쉬던 것도 푼다.
 */
export function rearmRound(round: Round, at: number, random: () => number): Round {
  if (round.contest === 'reaction') {
    return {
      ...round,
      signalAt: at + between(REACTION_MIN_WAIT_MS, REACTION_MAX_WAIT_MS, random),
      signaledAt: null,
    };
  }
  if (round.contest === 'tug') {
    const remaining = round.live ? Math.max(0, round.deadline - at) : TUG_TIME_MS;
    const goAt = at + TUG_READY_MS;
    return { ...round, goAt, live: false, deadline: goAt + remaining };
  }
  return {
    ...round,
    revealAt: at + between(SYMBOL_MIN_READY_MS, SYMBOL_MAX_READY_MS, random),
    revealed: false,
    ...dealSymbols(random),
    lockedUntil: [0, 0],
  };
}

// ───────── 한 판의 진행 ─────────

export interface RoundStep {
  round: Round;
  effects: Effect[];
  /** 이번 일로 판이 끝났으면 그 결과 */
  outcome: Outcome | null;
}

const unchanged = (round: Round): RoundStep => ({ round, effects: [], outcome: null });

function stepReaction(round: ReactionRound, event: MatchEvent): RoundStep {
  if (event.type === 'tick') {
    if (round.signaledAt !== null || event.at < round.signalAt) return unchanged(round);
    return { round: { ...round, signaledAt: event.at }, effects: [{ type: 'signal' }], outcome: null };
  }
  if (event.type !== 'touch') return unchanged(round);
  // 신호가 화면에 뜨기 전에 누른 것은, 정해진 시각이 막 지났더라도 보고 누른 것이 아니므로 반칙이다.
  if (round.signaledAt === null) {
    const outcome: Outcome = {
      contest: 'reaction',
      winner: opponentOf(event.player),
      reason: 'foul',
      reactionMs: null,
    };
    return { round, effects: [], outcome };
  }
  const outcome: Outcome = {
    contest: 'reaction',
    winner: event.player,
    reason: 'faster',
    reactionMs: Math.max(0, event.at - round.signaledAt),
  };
  return { round, effects: [], outcome };
}

const tugOutcome = (winner: Player, reason: WinReason): Outcome => ({
  contest: 'tug',
  winner,
  reason,
  reactionMs: null,
});

/** 제한 시간이 끝났을 때: 더 밀어 놓은 쪽이 이기고, 한가운데면 먼저 누르는 쪽이 이기는 상태로 넘어간다. */
function tugTimeUp(round: TugRound): RoundStep & { round: TugRound } {
  if (round.position !== 0) {
    return { round, effects: [], outcome: tugOutcome(round.position > 0 ? 0 : 1, 'timeout') };
  }
  return { round: { ...round, suddenDeath: true }, effects: [{ type: 'suddenDeath' }], outcome: null };
}

function stepTug(round: TugRound, event: MatchEvent): RoundStep {
  if (event.type === 'tick') {
    if (!round.live) {
      if (event.at < round.goAt) return unchanged(round);
      return { round: { ...round, live: true }, effects: [{ type: 'go' }], outcome: null };
    }
    if (round.suddenDeath || event.at < round.deadline) return unchanged(round);
    return tugTimeUp(round);
  }
  if (event.type !== 'touch' || !round.live) return unchanged(round);

  // 제한 시간이 지난 뒤에 누른 것은 시간이 끝난 것을 먼저 따지고 나서 센다.
  let current = round;
  const effects: Effect[] = [];
  if (!current.suddenDeath && event.at >= current.deadline) {
    const timeUp = tugTimeUp(current);
    if (timeUp.outcome) return timeUp;
    current = timeUp.round;
    effects.push(...timeUp.effects);
  }

  const position = current.position + (event.player === 0 ? 1 : -1);
  const pushed: TugRound = { ...current, position };
  effects.push({ type: 'push', player: event.player, position });
  if (current.suddenDeath) {
    return { round: pushed, effects, outcome: tugOutcome(event.player, 'suddenDeath') };
  }
  if (Math.abs(position) >= TUG_GOAL_STEPS) {
    return { round: pushed, effects, outcome: tugOutcome(event.player, 'goal') };
  }
  return { round: pushed, effects, outcome: null };
}

function stepSymbol(round: SymbolRound, event: MatchEvent): RoundStep {
  if (event.type === 'tick') {
    if (round.revealed || event.at < round.revealAt) return unchanged(round);
    return { round: { ...round, revealed: true }, effects: [{ type: 'reveal' }], outcome: null };
  }
  if (event.type !== 'touch' || !round.revealed || event.option === undefined) return unchanged(round);
  const { player, option, at } = event;
  const symbol = round.options[player][option];
  // 버튼이 아닌 곳을 눌렀거나 틀려서 쉬는 동안에 누른 것은 없던 일로 한다.
  if (symbol === undefined || at < round.lockedUntil[player]) return unchanged(round);
  if (symbol === round.target) {
    return {
      round,
      effects: [],
      outcome: { contest: 'symbol', winner: player, reason: 'match', reactionMs: null },
    };
  }
  return {
    round: { ...round, lockedUntil: withPair(round.lockedUntil, player, at + SYMBOL_LOCK_MS) },
    effects: [{ type: 'wrong', player, option }],
    outcome: null,
  };
}

/** 한 판에 일 하나를 적용한다. resume은 stepMatch가 rearmRound로 따로 다룬다. */
export function stepRound(round: Round, event: MatchEvent): RoundStep {
  if (round.contest === 'reaction') return stepReaction(round, event);
  if (round.contest === 'tug') return stepTug(round, event);
  return stepSymbol(round, event);
}

/** 연타 줄다리기의 남은 시간(ms). 시작 전에는 제한 시간 그대로다. */
export function tugTimeLeft(round: TugRound, at: number): number {
  if (!round.live) return round.deadline - round.goAt;
  return Math.max(0, round.deadline - at);
}

/** 같은 그림 찾기에서 그 사람이 앞으로 쉬어야 하는 시간(ms). 쉬고 있지 않으면 0이다. */
export function lockLeft(round: SymbolRound, player: Player, at: number): number {
  return Math.max(0, round.lockedUntil[player] - at);
}

// ───────── 경기 ─────────

export type Phase =
  /** 두 사람이 저마다 "준비"를 누르기를 기다린다. 둘 다 누르면 startAt에 첫 판의 안내로 넘어간다. */
  | { kind: 'lobby'; ready: Pair<boolean>; startAt: number | null }
  /** 종목 이름과 하는 법을 보여 준다. */
  | { kind: 'intro'; contest: Contest; until: number }
  | { kind: 'play'; round: Round }
  /** 판이 끝나 누가 이겼는지 보여 준다. */
  | { kind: 'result'; outcome: Outcome; until: number }
  /** 경기가 끝났다. outcome은 마지막 판의 결과다. */
  | { kind: 'over'; winner: Player; outcome: Outcome };

export interface Match {
  /** 사람마다 이긴 판 수 */
  wins: Pair<number>;
  /** 지금까지 나온 종목. 하고 있는 판의 종목까지 들어 있다. */
  played: readonly Contest[];
  phase: Phase;
}

export interface MatchStep {
  match: Match;
  effects: Effect[];
}

export function newMatch(): Match {
  return { wins: [0, 0], played: [], phase: { kind: 'lobby', ready: [false, false], startAt: null } };
}

/** 경기를 이긴 사람. 아직 끝나지 않았으면 null이다. */
export function matchWinner(match: Match): Player | null {
  return match.phase.kind === 'over' ? match.phase.winner : null;
}

/** 지금 하는 판에서 똑같은 순간에 누른 것을 누구 것부터 셀지. 판을 하는 중이 아니면 null이다. */
export function tieBreakOf(match: Match): Player | null {
  return match.phase.kind === 'play' ? match.phase.round.tieGoesTo : null;
}

const same = (match: Match): MatchStep => ({ match, effects: [] });

function beginIntro(match: Match, at: number, random: () => number): MatchStep {
  const contest = nextContest(match.played, random);
  const played = [...match.played, contest];
  return {
    match: { ...match, played, phase: { kind: 'intro', contest, until: at + INTRO_MS } },
    effects: [{ type: 'intro', contest, roundNumber: played.length }],
  };
}

/** 경기에 일 하나를 적용한다. */
export function stepMatch(match: Match, event: MatchEvent, random: () => number): MatchStep {
  const phase = match.phase;

  if (phase.kind === 'lobby') {
    if (event.type === 'tick') {
      if (phase.startAt === null || event.at < phase.startAt) return same(match);
      return beginIntro(match, event.at, random);
    }
    if (event.type !== 'touch' || event.option !== READY_OPTION || phase.ready[event.player]) {
      return same(match);
    }
    const ready = withPair(phase.ready, event.player, true);
    const all = ready[0] && ready[1];
    const effects: Effect[] = [{ type: 'ready', player: event.player }];
    if (all) effects.push({ type: 'allReady' });
    return {
      match: {
        ...match,
        phase: { kind: 'lobby', ready, startAt: all ? event.at + LOBBY_START_MS : null },
      },
      effects,
    };
  }

  if (phase.kind === 'intro') {
    if (event.type !== 'tick' || event.at < phase.until) return same(match);
    const round = newRound(phase.contest, event.at, random);
    return {
      match: { ...match, phase: { kind: 'play', round } },
      effects: [{ type: 'armed', contest: phase.contest, again: false }],
    };
  }

  if (phase.kind === 'play') {
    if (event.type === 'resume') {
      const round = rearmRound(phase.round, event.at, random);
      return {
        match: { ...match, phase: { kind: 'play', round } },
        effects: [{ type: 'armed', contest: round.contest, again: true }],
      };
    }
    const { round, effects, outcome } = stepRound(phase.round, event);
    if (!outcome) {
      return round === phase.round && effects.length === 0
        ? same(match)
        : { match: { ...match, phase: { kind: 'play', round } }, effects };
    }
    const wins = withPair(match.wins, outcome.winner, match.wins[outcome.winner] + 1);
    effects.push({ type: 'roundWon', outcome });
    if (wins[outcome.winner] >= WINS_TO_TAKE_MATCH) {
      effects.push({ type: 'matchWon', outcome });
      return {
        match: { ...match, wins, phase: { kind: 'over', winner: outcome.winner, outcome } },
        effects,
      };
    }
    return {
      match: { ...match, wins, phase: { kind: 'result', outcome, until: event.at + RESULT_MS } },
      effects,
    };
  }

  if (phase.kind === 'result') {
    if (event.type !== 'tick' || event.at < phase.until) return same(match);
    return beginIntro(match, event.at, random);
  }

  return same(match);
}

// ───────── 한 프레임에 들어온 터치 ─────────

/** 씬이 받은 터치 하나. stamp는 브라우저가 알려 준 누른 시각(ms)이다. */
export interface RawTouch {
  player: Player;
  stamp: number;
  option?: number;
}

/**
 * 한 프레임 동안 쌓인 터치를 경기에 넣을 일로 바꾼다. 터치를 누른 순서대로 놓고 맨 끝에 tick을 붙인다.
 *
 * - 터치는 앞 프레임(from)과 이번 프레임(to) 사이에 일어난 것이다. 맨 먼저 누른 것을 from에 놓고,
 *   나머지는 실제로 벌어진 시간만큼 뒤에 놓는다. 그래서 받은 순서와 상관없이 먼저 누른 쪽이 먼저 세어진다.
 * - 두 사람의 누른 시각이 똑같으면 tieGoesTo의 것을 먼저 센다. 브라우저가 알려 주는 순서는
 *   한쪽에 치우칠 수 있어서 쓰지 않는다. tieGoesTo가 null이면 받은 순서 그대로 둔다.
 * - 화면이 버벅여 터치가 프레임 길이보다 넓게 퍼져 있으면 그 비율대로 좁혀서 to를 넘지 않게 한다.
 */
export function frameEvents(
  touches: readonly RawTouch[],
  from: number,
  to: number,
  tieGoesTo: Player | null,
): MatchEvent[] {
  const tick: MatchEvent = { type: 'tick', at: to };
  if (touches.length === 0) return [tick];

  const first = touches.reduce((earliest, touch) => Math.min(earliest, touch.stamp), Infinity);
  const last = touches.reduce((latest, touch) => Math.max(latest, touch.stamp), -Infinity);
  const room = Math.max(0, to - from);
  const squeeze = last - first > room ? room / (last - first) : 1;

  const placed = touches.map((touch, order) => ({
    order,
    event: {
      type: 'touch' as const,
      player: touch.player,
      at: from + (touch.stamp - first) * squeeze,
      ...(touch.option === undefined ? {} : { option: touch.option }),
    },
  }));
  placed.sort((a, b) => {
    if (a.event.at !== b.event.at) return a.event.at - b.event.at;
    if (tieGoesTo !== null && a.event.player !== b.event.player) {
      return a.event.player === tieGoesTo ? -1 : 1;
    }
    return a.order - b.order;
  });
  return [...placed.map((entry) => entry.event), tick];
}
