import { describe, expect, it } from 'vitest';
import {
  CONTESTS,
  dealSymbols,
  frameEvents,
  INTRO_MS,
  LOBBY_START_MS,
  lockLeft,
  matchWinner,
  MAX_ROUNDS,
  newMatch,
  newRound,
  nextContest,
  opponentOf,
  PLAYERS,
  READY_OPTION,
  REACTION_MAX_WAIT_MS,
  REACTION_MIN_WAIT_MS,
  rearmRound,
  RESULT_MS,
  shuffled,
  stepMatch,
  stepRound,
  SYMBOL_KINDS,
  SYMBOL_LOCK_MS,
  SYMBOL_MAX_READY_MS,
  SYMBOL_MIN_READY_MS,
  SYMBOL_OPTIONS,
  tieBreakOf,
  TUG_GOAL_STEPS,
  TUG_READY_MS,
  TUG_TIME_MS,
  tugTimeLeft,
  WINS_TO_TAKE_MATCH,
  type Contest,
  type Effect,
  type Match,
  type MatchEvent,
  type Outcome,
  type Player,
  type ReactionRound,
  type Round,
  type SymbolRound,
  type TugRound,
} from './rules';

/** 테스트마다 같은 순서의 수를 내는 작은 난수기. 씨앗이 1, 2, 3처럼 붙어 있어도 첫 수부터 고르게 흩어진다. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

const tick = (at: number): MatchEvent => ({ type: 'tick', at });
const touch = (player: Player, at: number, option?: number): MatchEvent =>
  option === undefined ? { type: 'touch', player, at } : { type: 'touch', player, at, option };

/** 판에 일을 차례로 넣는다. 판이 끝나면 거기서 멈추고, 그동안 나온 알림과 결과를 함께 돌려준다. */
function play(round: Round, events: readonly MatchEvent[]): { round: Round; effects: Effect[]; outcome: Outcome | null } {
  let current = round;
  const effects: Effect[] = [];
  for (const event of events) {
    const step = stepRound(current, event);
    current = step.round;
    effects.push(...step.effects);
    if (step.outcome) return { round: current, effects, outcome: step.outcome };
  }
  return { round: current, effects, outcome: null };
}

const typesOf = (effects: readonly Effect[]): string[] => effects.map((effect) => effect.type);

describe('종목 고르기', () => {
  it('처음 세 판에는 세 종목이 한 번씩 나온다', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const random = seeded(seed);
      const played: Contest[] = [];
      for (let round = 0; round < 3; round += 1) played.push(nextContest(played, random));
      expect([...played].sort()).toEqual([...CONTESTS].sort());
    }
  });

  it('같은 종목이 두 판 연달아 나오지 않는다', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const random = seeded(seed);
      const played: Contest[] = [];
      for (let round = 0; round < MAX_ROUNDS + 3; round += 1) {
        const contest = nextContest(played, random);
        expect(contest).not.toBe(played[played.length - 1]);
        played.push(contest);
      }
    }
  });

  it('첫 판과 넷째 판의 종목은 그때그때 달라진다', () => {
    const firsts = new Set<Contest>();
    const fourths = new Set<Contest>();
    for (let seed = 1; seed <= 100; seed += 1) {
      const random = seeded(seed);
      const played: Contest[] = [];
      for (let round = 0; round < 4; round += 1) played.push(nextContest(played, random));
      firsts.add(played[0]);
      fourths.add(played[3]);
    }
    expect(firsts.size).toBe(CONTESTS.length);
    expect(fourths.size).toBe(CONTESTS.length);
  });

  it('난수가 한쪽 끝 값만 내도 규칙을 지킨다', () => {
    for (const random of [() => 0, () => 0.999999]) {
      const played: Contest[] = [];
      for (let round = 0; round < MAX_ROUNDS; round += 1) played.push(nextContest(played, random));
      expect(new Set(played.slice(0, 3)).size).toBe(3);
      played.forEach((contest, index) => expect(contest).not.toBe(played[index - 1]));
    }
  });
});

describe('번쩍 반응', () => {
  const newReaction = (at: number, random: () => number): ReactionRound =>
    newRound('reaction', at, random) as ReactionRound;

  it('신호는 정해진 범위 안의 시각에 울린다', () => {
    // 첫 난수는 동전 던지기에, 둘째 난수는 기다리는 시간에 쓰인다.
    const lowest = newReaction(1000, () => 0);
    const highest = newReaction(1000, () => 0.999999);
    expect(lowest.signalAt).toBe(1000 + REACTION_MIN_WAIT_MS);
    expect(highest.signalAt).toBeGreaterThan(1000 + REACTION_MAX_WAIT_MS - 1);
    expect(highest.signalAt).toBeLessThan(1000 + REACTION_MAX_WAIT_MS);
    for (let seed = 1; seed <= 100; seed += 1) {
      const round = newReaction(500, seeded(seed));
      expect(round.signalAt).toBeGreaterThanOrEqual(500 + REACTION_MIN_WAIT_MS);
      expect(round.signalAt).toBeLessThan(500 + REACTION_MAX_WAIT_MS);
      expect(round.signaledAt).toBeNull();
    }
  });

  it('정해진 시각이 되기 전의 틱에는 신호가 뜨지 않고, 된 뒤의 첫 틱에 한 번만 뜬다', () => {
    const round = newReaction(0, seeded(3));
    const before = play(round, [tick(round.signalAt - 1)]);
    expect(before.effects).toEqual([]);
    expect((before.round as ReactionRound).signaledAt).toBeNull();

    const after = play(round, [tick(round.signalAt - 1), tick(round.signalAt + 7), tick(round.signalAt + 24)]);
    expect(typesOf(after.effects)).toEqual(['signal']);
    expect((after.round as ReactionRound).signaledAt).toBe(round.signalAt + 7);
  });

  it('신호가 뜬 뒤에 먼저 누른 사람이 이기고, 걸린 시간이 남는다', () => {
    for (const player of PLAYERS) {
      const round = newReaction(0, seeded(5));
      const { outcome } = play(round, [tick(round.signalAt), touch(player, round.signalAt + 231)]);
      expect(outcome).toEqual({ contest: 'reaction', winner: player, reason: 'faster', reactionMs: 231 });
    }
  });

  it('신호보다 먼저 누르면 반칙이고 상대가 이긴다', () => {
    for (const player of PLAYERS) {
      const round = newReaction(0, seeded(7));
      const { outcome } = play(round, [tick(100), touch(player, 120)]);
      expect(outcome).toEqual({
        contest: 'reaction',
        winner: opponentOf(player),
        reason: 'foul',
        reactionMs: null,
      });
    }
  });

  it('정해진 시각이 지났어도 신호가 화면에 뜨기 전에 누른 것은 반칙이다', () => {
    const round = newReaction(0, seeded(9));
    const { outcome } = play(round, [tick(round.signalAt - 5), touch(0, round.signalAt + 3)]);
    expect(outcome?.reason).toBe('foul');
    expect(outcome?.winner).toBe(1);
  });

  it('같은 프레임에 둘이 눌렀으면 받은 순서와 상관없이 먼저 누른 사람이 이긴다', () => {
    const round = newReaction(0, seeded(11));
    const live = play(round, [tick(round.signalAt)]).round;
    const from = round.signalAt + 160;
    // 위쪽 사람의 터치가 먼저 도착했지만 누른 시각은 아래쪽 사람이 2ms 빠르다.
    const events = frameEvents(
      [
        { player: 1, stamp: 5003 },
        { player: 0, stamp: 5001 },
      ],
      from,
      from + 16,
      live.tieGoesTo,
    );
    const { outcome } = play(live, events);
    expect(outcome?.winner).toBe(0);
    expect(outcome?.reason).toBe('faster');
    expect(outcome?.reactionMs).toBe(160);
  });

  it('똑같은 순간에 눌렀으면 그 판에 정해 둔 한 사람만 이긴다', () => {
    for (const favoured of PLAYERS) {
      for (const arrival of [
        [0, 1],
        [1, 0],
      ] as const) {
        const round: ReactionRound = { ...newReaction(0, seeded(13)), tieGoesTo: favoured };
        const live = play(round, [tick(round.signalAt)]).round;
        const events = frameEvents(
          arrival.map((player) => ({ player, stamp: 777 })),
          round.signalAt + 200,
          round.signalAt + 216,
          live.tieGoesTo,
        );
        expect(play(live, events).outcome?.winner).toBe(favoured);
      }
    }
  });

  it('동전은 두 사람에게 고르게 떨어진다', () => {
    let lower = 0;
    const rounds = 2000;
    const random = seeded(17);
    for (let index = 0; index < rounds; index += 1) {
      if (newReaction(0, random).tieGoesTo === 0) lower += 1;
    }
    expect(lower / rounds).toBeGreaterThan(0.45);
    expect(lower / rounds).toBeLessThan(0.55);
  });

  it('똑같은 순간에 둘 다 신호보다 먼저 눌렀으면 한 사람만 반칙이 된다', () => {
    const round: ReactionRound = { ...newReaction(0, seeded(19)), tieGoesTo: 1 };
    const events = frameEvents(
      [
        { player: 0, stamp: 40 },
        { player: 1, stamp: 40 },
      ],
      100,
      116,
      round.tieGoesTo,
    );
    const { outcome } = play(round, events);
    // 먼저 센 사람(위쪽)의 반칙이라 아래쪽이 이긴다.
    expect(outcome).toMatchObject({ winner: 0, reason: 'foul' });
  });
});

describe('연타 줄다리기', () => {
  const newTug = (at = 0): TugRound => newRound('tug', at, seeded(21)) as TugRound;
  /** "시작"이 뜬 판 */
  const liveTug = (): TugRound => play(newTug(), [tick(TUG_READY_MS)]).round as TugRound;
  const pushes = (player: Player, count: number, from: number): MatchEvent[] =>
    Array.from({ length: count }, (_, index) => touch(player, from + index * 10));

  it('"시작"이 뜨기 전에 누른 것은 세지 않는다', () => {
    const round = newTug(300);
    expect(round.goAt).toBe(300 + TUG_READY_MS);
    expect(round.deadline).toBe(round.goAt + TUG_TIME_MS);
    const early = play(round, [touch(0, 400), touch(1, 500), tick(round.goAt - 1), touch(0, round.goAt + 2)]);
    expect((early.round as TugRound).position).toBe(0);
    expect(early.effects).toEqual([]);

    const started = play(round, [tick(round.goAt)]);
    expect(typesOf(started.effects)).toEqual(['go']);
    expect((started.round as TugRound).live).toBe(true);
  });

  it('누를 때마다 표시가 상대 쪽으로 한 걸음 간다', () => {
    const start = TUG_READY_MS + 50;
    const result = play(liveTug(), [
      touch(0, start),
      touch(0, start + 10),
      touch(1, start + 20),
      touch(0, start + 30),
      touch(1, start + 40),
      touch(1, start + 50),
      touch(1, start + 60),
    ]);
    expect((result.round as TugRound).position).toBe(-1);
    expect(result.outcome).toBeNull();
    expect(result.effects).toHaveLength(7);
    expect(result.effects.every((effect) => effect.type === 'push')).toBe(true);
  });

  it('상대 골라인까지 밀면 이긴다', () => {
    for (const player of PLAYERS) {
      const almost = play(liveTug(), pushes(player, TUG_GOAL_STEPS - 1, TUG_READY_MS + 10));
      expect(almost.outcome).toBeNull();
      const done = play(liveTug(), pushes(player, TUG_GOAL_STEPS, TUG_READY_MS + 10));
      expect(done.outcome).toEqual({ contest: 'tug', winner: player, reason: 'goal', reactionMs: null });
      expect((done.round as TugRound).position).toBe(player === 0 ? TUG_GOAL_STEPS : -TUG_GOAL_STEPS);
    }
  });

  it('상대가 되밀면 그만큼 더 눌러야 한다', () => {
    const events = [
      ...pushes(0, TUG_GOAL_STEPS - 1, TUG_READY_MS + 10),
      ...pushes(1, 3, TUG_READY_MS + 400),
      ...pushes(0, 3, TUG_READY_MS + 600),
    ];
    expect(play(liveTug(), events).outcome).toBeNull();
    expect(play(liveTug(), [...events, touch(0, TUG_READY_MS + 900)]).outcome?.winner).toBe(0);
  });

  it('시간이 끝나면 더 밀어 놓은 쪽이 이긴다', () => {
    const deadline = liveTug().deadline;
    for (const player of PLAYERS) {
      const result = play(liveTug(), [
        ...pushes(player, 3, TUG_READY_MS + 10),
        ...pushes(opponentOf(player), 2, TUG_READY_MS + 200),
        tick(deadline - 1),
        tick(deadline),
      ]);
      expect(result.outcome).toEqual({ contest: 'tug', winner: player, reason: 'timeout', reactionMs: null });
    }
  });

  it('시간이 끝나기 전에는 앞서 있어도 끝나지 않는다', () => {
    const round = liveTug();
    const result = play(round, [...pushes(0, 5, TUG_READY_MS + 10), tick(round.deadline - 1)]);
    expect(result.outcome).toBeNull();
    expect(tugTimeLeft(result.round as TugRound, round.deadline - 1)).toBe(1);
    expect(tugTimeLeft(newTug(), 0)).toBe(TUG_TIME_MS);
  });

  it('한가운데에서 시간이 끝나면 비기지 않고, 다음에 먼저 누르는 쪽이 이긴다', () => {
    for (const player of PLAYERS) {
      const round = liveTug();
      const tied = play(round, [
        ...pushes(0, 4, TUG_READY_MS + 10),
        ...pushes(1, 4, TUG_READY_MS + 100),
        tick(round.deadline),
        tick(round.deadline + 500),
      ]);
      expect(tied.outcome).toBeNull();
      expect((tied.round as TugRound).suddenDeath).toBe(true);
      expect(typesOf(tied.effects).filter((type) => type === 'suddenDeath')).toHaveLength(1);

      const decided = play(tied.round, [touch(player, round.deadline + 620)]);
      expect(decided.outcome).toEqual({
        contest: 'tug',
        winner: player,
        reason: 'suddenDeath',
        reactionMs: null,
      });
    }
  });

  it('시간이 끝난 뒤에 누른 것으로는 승부가 뒤집히지 않는다', () => {
    const round = liveTug();
    // 아래쪽이 한 걸음 앞선 채 시간이 지났고, 그 틱이 오기 전에 위쪽의 터치가 먼저 도착했다.
    const result = play(round, [touch(0, TUG_READY_MS + 10), touch(1, round.deadline + 4), touch(1, round.deadline + 6)]);
    expect(result.outcome).toMatchObject({ winner: 0, reason: 'timeout' });
    expect((result.round as TugRound).position).toBe(1);
  });

  it('한가운데에서 시간이 지난 뒤의 첫 터치는 틱보다 먼저 와도 이긴다', () => {
    const round = liveTug();
    const result = play(round, [touch(1, round.deadline + 3)]);
    expect(typesOf(result.effects)).toEqual(['suddenDeath', 'push']);
    expect(result.outcome).toMatchObject({ winner: 1, reason: 'suddenDeath' });
  });

  it('골라인 한 걸음 앞에서 둘이 똑같은 순간에 누르면 정해 둔 사람의 것을 먼저 센다', () => {
    for (const favoured of PLAYERS) {
      const round: TugRound = { ...liveTug(), position: TUG_GOAL_STEPS - 1, tieGoesTo: favoured };
      const events = frameEvents(
        [
          { player: 1, stamp: 90 },
          { player: 0, stamp: 90 },
        ],
        TUG_READY_MS + 100,
        TUG_READY_MS + 116,
        round.tieGoesTo,
      );
      const result = play(round, events);
      if (favoured === 0) expect(result.outcome).toMatchObject({ winner: 0, reason: 'goal' });
      else {
        // 위쪽이 먼저 되밀었으므로 아래쪽의 터치는 제자리로 돌려놓기만 한다.
        expect(result.outcome).toBeNull();
        expect((result.round as TugRound).position).toBe(TUG_GOAL_STEPS - 1);
      }
    }
  });
});

describe('같은 그림 찾기', () => {
  const newSymbol = (seed = 31): SymbolRound => newRound('symbol', 0, seeded(seed)) as SymbolRound;
  const revealedRound = (seed = 31): SymbolRound => {
    const round = newSymbol(seed);
    return play(round, [tick(round.revealAt)]).round as SymbolRound;
  };
  const rightOption = (round: SymbolRound, player: Player): number => round.options[player].indexOf(round.target);
  const wrongOption = (round: SymbolRound, player: Player): number =>
    round.options[player].findIndex((symbol) => symbol !== round.target);

  it('두 사람이 같은 그림 네 개를 서로 다른 순서로 받고, 찾을 그림은 그 안에 있다', () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const { target, options } = dealSymbols(seeded(seed));
      for (const player of PLAYERS) {
        expect(options[player]).toHaveLength(SYMBOL_OPTIONS);
        expect(new Set(options[player]).size).toBe(SYMBOL_OPTIONS);
        expect(options[player]).toContain(target);
        for (const symbol of options[player]) {
          expect(symbol).toBeGreaterThanOrEqual(0);
          expect(symbol).toBeLessThan(SYMBOL_KINDS);
        }
      }
      expect([...options[0]].sort()).toEqual([...options[1]].sort());
      expect(options[0]).not.toEqual(options[1]);
    }
  });

  it('난수가 늘 같은 값만 내도 두 사람의 순서는 다르다', () => {
    for (const random of [() => 0, () => 0.5, () => 0.999999]) {
      const { target, options } = dealSymbols(random);
      expect(options[0]).not.toEqual(options[1]);
      expect([...options[0]].sort()).toEqual([...options[1]].sort());
      expect(options[0]).toContain(target);
    }
  });

  it('찾을 그림과 빠지는 그림이 판마다 달라진다', () => {
    const targets = new Set<number>();
    const missing = new Set<number>();
    for (let seed = 1; seed <= 200; seed += 1) {
      const { target, options } = dealSymbols(seeded(seed));
      targets.add(target);
      for (let kind = 0; kind < SYMBOL_KINDS; kind += 1) {
        if (!options[0].includes(kind)) missing.add(kind);
      }
    }
    expect(targets.size).toBe(SYMBOL_KINDS);
    expect(missing.size).toBe(SYMBOL_KINDS);
  });

  it('섞어도 들어 있는 것은 그대로다', () => {
    const items = [1, 2, 3, 4, 5, 6];
    const result = shuffled(items, seeded(41));
    expect([...result].sort()).toEqual(items);
    expect(items).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('그림은 "준비" 박자 뒤에 나타나고, 그 전에는 눌러도 아무 일이 없다', () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const round = newSymbol(seed);
      expect(round.revealAt).toBeGreaterThanOrEqual(SYMBOL_MIN_READY_MS);
      expect(round.revealAt).toBeLessThan(SYMBOL_MAX_READY_MS);
    }
    const round = newSymbol();
    const early = play(round, [touch(0, 10, rightOption(round, 0)), touch(1, 20, wrongOption(round, 1)), tick(round.revealAt - 1)]);
    expect(early.outcome).toBeNull();
    expect(early.effects).toEqual([]);
    expect(early.round).toBe(round);

    const shown = play(round, [tick(round.revealAt), tick(round.revealAt + 16)]);
    expect(typesOf(shown.effects)).toEqual(['reveal']);
  });

  it('같은 그림을 먼저 누른 사람이 이긴다', () => {
    for (const player of PLAYERS) {
      const round = revealedRound();
      const { outcome } = play(round, [touch(player, round.revealAt + 400, rightOption(round, player))]);
      expect(outcome).toEqual({ contest: 'symbol', winner: player, reason: 'match', reactionMs: null });
    }
  });

  it('버튼이 아닌 곳을 누른 것은 세지 않는다', () => {
    const round = revealedRound();
    const result = play(round, [touch(0, round.revealAt + 100), touch(1, round.revealAt + 120, 9)]);
    expect(result.outcome).toBeNull();
    expect(result.round).toBe(round);
  });

  it('틀린 그림을 누르면 그 사람만 1초쯤 쉰다', () => {
    const round = revealedRound();
    const at = round.revealAt + 300;
    const option = wrongOption(round, 0);
    const result = play(round, [touch(0, at, option)]);
    expect(result.outcome).toBeNull();
    expect(result.effects).toEqual([{ type: 'wrong', player: 0, option }]);

    const locked = result.round as SymbolRound;
    expect(SYMBOL_LOCK_MS).toBeGreaterThanOrEqual(800);
    expect(SYMBOL_LOCK_MS).toBeLessThanOrEqual(1200);
    expect(lockLeft(locked, 0, at)).toBe(SYMBOL_LOCK_MS);
    expect(lockLeft(locked, 0, at + 400)).toBe(SYMBOL_LOCK_MS - 400);
    expect(lockLeft(locked, 0, at + SYMBOL_LOCK_MS)).toBe(0);
    expect(lockLeft(locked, 1, at)).toBe(0);
  });

  it('쉬는 동안에 누른 것은 맞는 그림이어도 세지 않는다', () => {
    const round = revealedRound();
    const at = round.revealAt + 300;
    const locked = play(round, [touch(0, at, wrongOption(round, 0))]).round as SymbolRound;

    const during = play(locked, [
      touch(0, at + 200, rightOption(round, 0)),
      touch(0, at + SYMBOL_LOCK_MS - 1, rightOption(round, 0)),
    ]);
    expect(during.outcome).toBeNull();
    expect(during.round).toBe(locked);

    // 쉬는 동안에 또 틀린 그림을 눌러도 쉬는 시간이 늘어나지 않는다.
    const again = play(locked, [touch(0, at + 500, wrongOption(round, 0))]);
    expect(again.effects).toEqual([]);
    expect(lockLeft(again.round as SymbolRound, 0, at + 500)).toBe(SYMBOL_LOCK_MS - 500);
  });

  it('쉬는 것이 끝나면 다시 누를 수 있고, 그동안 상대는 그대로 누를 수 있다', () => {
    const round = revealedRound();
    const at = round.revealAt + 300;
    const locked = play(round, [touch(0, at, wrongOption(round, 0))]).round as SymbolRound;

    const back = play(locked, [touch(0, at + SYMBOL_LOCK_MS, rightOption(round, 0))]);
    expect(back.outcome).toMatchObject({ winner: 0, reason: 'match' });

    const other = play(locked, [touch(1, at + 100, rightOption(round, 1))]);
    expect(other.outcome).toMatchObject({ winner: 1, reason: 'match' });
  });

  it('둘이 똑같은 순간에 맞는 그림을 누르면 한 사람만 이긴다', () => {
    for (const favoured of PLAYERS) {
      const round: SymbolRound = { ...revealedRound(), tieGoesTo: favoured };
      const events = frameEvents(
        [
          { player: 0, stamp: 12, option: rightOption(round, 0) },
          { player: 1, stamp: 12, option: rightOption(round, 1) },
        ],
        round.revealAt + 500,
        round.revealAt + 516,
        round.tieGoesTo,
      );
      expect(play(round, events).outcome?.winner).toBe(favoured);
    }
  });
});

describe('한 프레임에 들어온 터치', () => {
  it('터치가 없으면 틱 하나만 낸다', () => {
    expect(frameEvents([], 100, 116, null)).toEqual([{ type: 'tick', at: 116 }]);
  });

  it('맨 먼저 누른 것을 앞 프레임의 시각에 놓고 나머지는 벌어진 만큼 뒤에 놓는다', () => {
    const events = frameEvents(
      [
        { player: 0, stamp: 9004, option: 2 },
        { player: 1, stamp: 9000 },
        { player: 0, stamp: 9011 },
      ],
      200,
      216,
      null,
    );
    expect(events).toEqual([
      { type: 'touch', player: 1, at: 200 },
      { type: 'touch', player: 0, at: 204, option: 2 },
      { type: 'touch', player: 0, at: 211 },
      { type: 'tick', at: 216 },
    ]);
  });

  it('터치가 프레임 길이보다 넓게 퍼져 있어도 이번 프레임의 시각을 넘지 않고 순서는 그대로다', () => {
    const events = frameEvents(
      [
        { player: 0, stamp: 1000 },
        { player: 1, stamp: 1150 },
        { player: 0, stamp: 1300 },
      ],
      500,
      600,
      null,
    );
    expect(events.map((event) => event.at)).toEqual([500, 550, 600, 600]);
    expect(events.map((event) => event.type)).toEqual(['touch', 'touch', 'touch', 'tick']);
  });

  it('누른 시각이 같으면 정해 둔 사람의 것이 먼저 오고, 같은 사람의 것은 받은 순서대로다', () => {
    const touches = [
      { player: 0 as Player, stamp: 50, option: 0 },
      { player: 1 as Player, stamp: 50, option: 1 },
      { player: 0 as Player, stamp: 50, option: 2 },
    ];
    const options = (tieGoesTo: Player | null): (number | undefined)[] =>
      frameEvents(touches, 0, 16, tieGoesTo)
        .filter((event) => event.type === 'touch')
        .map((event) => (event.type === 'touch' ? event.option : undefined));
    expect(options(0)).toEqual([0, 2, 1]);
    expect(options(1)).toEqual([1, 0, 2]);
    expect(options(null)).toEqual([0, 1, 2]);
  });
});

/** 준비 화면부터 첫 판의 안내가 끝날 때까지 진행한 경기 */
function startedMatch(random: () => number): { match: Match; at: number } {
  let match = newMatch();
  match = stepMatch(match, touch(0, 100, READY_OPTION), random).match;
  match = stepMatch(match, touch(1, 200, READY_OPTION), random).match;
  match = stepMatch(match, tick(200 + LOBBY_START_MS), random).match;
  const at = 200 + LOBBY_START_MS + INTRO_MS;
  match = stepMatch(match, tick(at), random).match;
  return { match, at };
}

/**
 * 하고 있는 판을 winner가 이기게 만드는 일들을 넣는다. 판이 끝난 직후의 경기와 그때의 시각을 돌려준다.
 */
function winRound(match: Match, winner: Player, from: number, random: () => number): { match: Match; at: number; effects: Effect[] } {
  if (match.phase.kind !== 'play') throw new Error('판을 하는 중이 아니다');
  const round = match.phase.round;
  const events: MatchEvent[] = [];
  let at = from;
  if (round.contest === 'reaction') {
    at = round.signalAt + 20;
    events.push(tick(at), touch(winner, at + 250));
    at += 250;
  } else if (round.contest === 'tug') {
    at = round.goAt + 16;
    events.push(tick(at));
    for (let push = 0; push < TUG_GOAL_STEPS; push += 1) {
      at += 60;
      events.push(touch(winner, at));
    }
  } else {
    at = round.revealAt + 16;
    events.push(tick(at), touch(winner, at + 500, round.options[winner].indexOf(round.target)));
    at += 500;
  }
  let current = match;
  const effects: Effect[] = [];
  for (const event of events) {
    const step = stepMatch(current, event, random);
    current = step.match;
    effects.push(...step.effects);
  }
  return { match: current, at, effects };
}

describe('경기', () => {
  it('두 사람이 모두 "준비"를 눌러야 시작한다', () => {
    const random = seeded(51);
    let match = newMatch();
    expect(match.phase).toEqual({ kind: 'lobby', ready: [false, false], startAt: null });

    // 버튼이 아닌 곳을 누른 것과 시간이 흐르는 것으로는 시작하지 않는다.
    match = stepMatch(match, touch(0, 50), random).match;
    match = stepMatch(match, touch(1, 60, 3), random).match;
    match = stepMatch(match, tick(5000), random).match;
    expect(match.phase).toEqual({ kind: 'lobby', ready: [false, false], startAt: null });

    const first = stepMatch(match, touch(1, 6000, READY_OPTION), random);
    expect(first.effects).toEqual([{ type: 'ready', player: 1 }]);
    expect(first.match.phase).toEqual({ kind: 'lobby', ready: [false, true], startAt: null });

    // 같은 사람이 또 눌러도 달라지지 않는다.
    const again = stepMatch(first.match, touch(1, 6100, READY_OPTION), random);
    expect(again.effects).toEqual([]);
    expect(stepMatch(again.match, tick(9000), random).match.phase.kind).toBe('lobby');

    const second = stepMatch(again.match, touch(0, 9500, READY_OPTION), random);
    expect(typesOf(second.effects)).toEqual(['ready', 'allReady']);
    expect(second.match.phase).toEqual({ kind: 'lobby', ready: [true, true], startAt: 9500 + LOBBY_START_MS });

    const waiting = stepMatch(second.match, tick(9500 + LOBBY_START_MS - 1), random);
    expect(waiting.match.phase.kind).toBe('lobby');
    const intro = stepMatch(waiting.match, tick(9500 + LOBBY_START_MS), random);
    expect(intro.match.phase.kind).toBe('intro');
    expect(intro.effects).toEqual([
      { type: 'intro', contest: intro.match.played[0], roundNumber: 1 },
    ]);
  });

  it('안내가 보이는 동안에는 눌러도 아무 일이 없고, 끝나면 판이 시작된다', () => {
    const random = seeded(53);
    let match = newMatch();
    match = stepMatch(match, touch(0, 0, READY_OPTION), random).match;
    match = stepMatch(match, touch(1, 0, READY_OPTION), random).match;
    match = stepMatch(match, tick(LOBBY_START_MS), random).match;
    const intro = match;
    expect(tieBreakOf(intro)).toBeNull();

    match = stepMatch(match, touch(0, LOBBY_START_MS + 300), random).match;
    match = stepMatch(match, touch(1, LOBBY_START_MS + 400, 0), random).match;
    match = stepMatch(match, tick(LOBBY_START_MS + INTRO_MS - 1), random).match;
    expect(match).toBe(intro);

    const started = stepMatch(match, tick(LOBBY_START_MS + INTRO_MS), random);
    expect(started.match.phase.kind).toBe('play');
    expect(started.effects).toEqual([{ type: 'armed', contest: intro.played[0], again: false }]);
    expect(tieBreakOf(started.match)).not.toBeNull();
  });

  it('판이 끝나면 이긴 판 수가 오르고, 결과를 보여 준 뒤 다른 종목의 안내로 넘어간다', () => {
    const random = seeded(55);
    const { match: playing, at: start } = startedMatch(random);
    const won = winRound(playing, 1, start, random);
    expect(won.match.wins).toEqual([0, 1]);
    expect(won.match.phase.kind).toBe('result');
    expect(typesOf(won.effects)).toContain('roundWon');
    expect(typesOf(won.effects)).not.toContain('matchWon');

    // 결과를 보여 주는 동안에 누른 것은 아무 일도 하지 않는다.
    const ignored = stepMatch(won.match, touch(0, won.at + 100, 0), random);
    expect(ignored.match).toBe(won.match);
    const waiting = stepMatch(won.match, tick(won.at + RESULT_MS - 1), random);
    expect(waiting.match.phase.kind).toBe('result');

    const next = stepMatch(won.match, tick(won.at + RESULT_MS), random);
    expect(next.match.phase.kind).toBe('intro');
    expect(next.match.played).toHaveLength(2);
    expect(next.match.played[1]).not.toBe(next.match.played[0]);
    expect(next.effects).toEqual([{ type: 'intro', contest: next.match.played[1], roundNumber: 2 }]);
  });

  it('먼저 세 판을 이긴 사람이 경기를 이긴다', () => {
    for (const winner of PLAYERS) {
      const random = seeded(57 + winner);
      let { match, at } = startedMatch(random);
      for (let round = 1; round <= WINS_TO_TAKE_MATCH; round += 1) {
        const won = winRound(match, winner, at, random);
        match = won.match;
        at = won.at;
        if (round < WINS_TO_TAKE_MATCH) {
          expect(matchWinner(match)).toBeNull();
          expect(typesOf(won.effects)).not.toContain('matchWon');
          at += RESULT_MS;
          match = stepMatch(match, tick(at), random).match;
          at += INTRO_MS;
          match = stepMatch(match, tick(at), random).match;
        } else {
          expect(typesOf(won.effects).slice(-2)).toEqual(['roundWon', 'matchWon']);
        }
      }
      expect(matchWinner(match)).toBe(winner);
      expect(match.wins[winner]).toBe(WINS_TO_TAKE_MATCH);
      expect(match.wins[opponentOf(winner)]).toBe(0);
      expect(match.played).toHaveLength(3);
    }
  });

  it('2 대 2까지 가면 다섯째 판에서 끝난다', () => {
    const random = seeded(61);
    let { match, at } = startedMatch(random);
    const winners: Player[] = [0, 1, 1, 0, 1];
    winners.forEach((winner, index) => {
      const won = winRound(match, winner, at, random);
      match = won.match;
      at = won.at;
      if (index < winners.length - 1) {
        expect(match.phase.kind).toBe('result');
        at += RESULT_MS;
        match = stepMatch(match, tick(at), random).match;
        at += INTRO_MS;
        match = stepMatch(match, tick(at), random).match;
      }
    });
    expect(match.wins).toEqual([2, 3]);
    expect(match.phase.kind).toBe('over');
    expect(matchWinner(match)).toBe(1);
    expect(match.played).toHaveLength(MAX_ROUNDS);
    match.played.forEach((contest, index) => expect(contest).not.toBe(match.played[index - 1]));
  });

  it('경기가 끝난 뒤에는 어떤 일이 와도 달라지지 않는다', () => {
    const random = seeded(63);
    let { match, at } = startedMatch(random);
    for (let round = 0; round < WINS_TO_TAKE_MATCH; round += 1) {
      const won = winRound(match, 0, at, random);
      match = won.match;
      at = won.at;
      if (match.phase.kind === 'result') {
        at += RESULT_MS;
        match = stepMatch(match, tick(at), random).match;
        at += INTRO_MS;
        match = stepMatch(match, tick(at), random).match;
      }
    }
    const over = match;
    for (const event of [tick(at + 99999), touch(1, at + 10, 0), touch(0, at + 20), { type: 'resume', at } as MatchEvent]) {
      const step = stepMatch(over, event, random);
      expect(step.match).toBe(over);
      expect(step.effects).toEqual([]);
    }
  });

  it('반칙으로 끝난 판도 상대의 한 판으로 센다', () => {
    const random = seeded(65);
    let { match, at } = startedMatch(random);
    // 번쩍 반응이 나올 때까지 판을 넘긴다.
    while (match.phase.kind === 'play' && match.phase.round.contest !== 'reaction') {
      const won = winRound(match, 0, at, random);
      at = won.at + RESULT_MS;
      match = stepMatch(won.match, tick(at), random).match;
      at += INTRO_MS;
      match = stepMatch(match, tick(at), random).match;
    }
    const before = match.wins;
    const step = stepMatch(match, touch(0, at + 100), random);
    expect(step.match.wins).toEqual([before[0], before[1] + 1]);
    const outcome = step.effects.find((effect) => effect.type === 'roundWon');
    expect(outcome).toMatchObject({ outcome: { winner: 1, reason: 'foul' } });
  });

  it('아무렇게나 누르는 두 사람이 붙어도 언제나 한 사람이 세 판을 이기며 끝난다', () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const random = seeded(seed * 97);
      let match = newMatch();
      let at = 0;
      let roundsWon = 0;
      for (let frame = 0; frame < 20000 && match.phase.kind !== 'over'; frame += 1) {
        const from = at;
        at += 16;
        // 프레임마다 가끔 누른다. 버튼 번호도 아무것이나 고른다.
        const touches = PLAYERS.filter(() => random() < 0.12).map((player) => ({
          player,
          stamp: Math.floor(random() * 3),
          option: Math.floor(random() * SYMBOL_OPTIONS),
        }));
        for (const event of frameEvents(touches, from, at, tieBreakOf(match))) {
          const step = stepMatch(match, event, random);
          match = step.match;
          for (const effect of step.effects) {
            if (effect.type === 'roundWon') roundsWon += 1;
          }
        }
      }
      expect(match.phase.kind).toBe('over');
      const winner = matchWinner(match) as Player;
      expect(match.wins[winner]).toBe(WINS_TO_TAKE_MATCH);
      expect(match.wins[opponentOf(winner)]).toBeLessThan(WINS_TO_TAKE_MATCH);
      expect(match.wins[0] + match.wins[1]).toBe(roundsWon);
      expect(match.played).toHaveLength(roundsWon);
      expect(roundsWon).toBeLessThanOrEqual(MAX_ROUNDS);
    }
  });
});

describe('일시정지에서 돌아왔을 때', () => {
  it('번쩍 반응은 신호를 거두고 기다리는 시간을 새로 뽑는다', () => {
    const round = newRound('reaction', 0, seeded(71)) as ReactionRound;
    const live = play(round, [tick(round.signalAt)]).round as ReactionRound;
    expect(live.signaledAt).not.toBeNull();

    const at = round.signalAt + 90;
    const again = rearmRound(live, at, seeded(73)) as ReactionRound;
    expect(again.signaledAt).toBeNull();
    expect(again.signalAt).toBeGreaterThanOrEqual(at + REACTION_MIN_WAIT_MS);
    expect(again.signalAt).toBeLessThan(at + REACTION_MAX_WAIT_MS);
    // 돌아오자마자 누르면 반칙이다.
    expect(play(again, [touch(0, at + 10)]).outcome).toMatchObject({ winner: 1, reason: 'foul' });
  });

  it('연타 줄다리기는 표시의 자리와 남은 시간을 그대로 두고 "준비"부터 다시 한다', () => {
    const round = newRound('tug', 0, seeded(75)) as TugRound;
    const start = round.goAt + 16;
    const pushed = play(round, [tick(start), touch(0, start + 100), touch(0, start + 200), touch(1, start + 300)])
      .round as TugRound;
    const at = round.goAt + 4000;
    const again = rearmRound(pushed, at, seeded(77)) as TugRound;
    expect(again.position).toBe(1);
    expect(again.live).toBe(false);
    expect(again.goAt).toBe(at + TUG_READY_MS);
    expect(again.deadline - again.goAt).toBe(TUG_TIME_MS - 4000);

    // "시작"이 다시 뜨기 전에 누른 것은 세지 않는다.
    const early = play(again, [touch(1, at + 100), touch(1, at + 200)]);
    expect((early.round as TugRound).position).toBe(1);
  });

  it('연타 줄다리기를 시작하기 전에 멈췄으면 제한 시간이 줄지 않는다', () => {
    const round = newRound('tug', 0, seeded(79)) as TugRound;
    const again = rearmRound(round, 300, seeded(81)) as TugRound;
    expect(again.deadline - again.goAt).toBe(TUG_TIME_MS);
  });

  it('같은 그림 찾기는 그림을 새로 나눠 주고 쉬던 것도 푼다', () => {
    const round = newRound('symbol', 0, seeded(83)) as SymbolRound;
    const shown = play(round, [tick(round.revealAt)]).round as SymbolRound;
    const wrong = shown.options[1].findIndex((symbol) => symbol !== shown.target);
    const locked = play(shown, [touch(1, round.revealAt + 50, wrong)]).round as SymbolRound;
    expect(lockLeft(locked, 1, round.revealAt + 60)).toBeGreaterThan(0);

    const at = round.revealAt + 60;
    const again = rearmRound(locked, at, seeded(85)) as SymbolRound;
    expect(again.revealed).toBe(false);
    expect(again.revealAt).toBeGreaterThanOrEqual(at + SYMBOL_MIN_READY_MS);
    expect(lockLeft(again, 1, at)).toBe(0);
    expect(again.options[0]).toContain(again.target);
    expect(again.options[0]).not.toEqual(again.options[1]);
    expect(again.tieGoesTo).toBe(locked.tieGoesTo);
  });

  it('경기에서는 하던 판만 다시 준비시키고, 다른 때에는 아무것도 바꾸지 않는다', () => {
    const random = seeded(87);
    const lobby = newMatch();
    expect(stepMatch(lobby, { type: 'resume', at: 10 }, random).match).toBe(lobby);

    const { match, at } = startedMatch(random);
    const resumed = stepMatch(match, { type: 'resume', at: at + 500 }, random);
    expect(resumed.match.phase.kind).toBe('play');
    expect(resumed.match.wins).toEqual(match.wins);
    expect(resumed.match.played).toEqual(match.played);
    expect(resumed.effects).toEqual([{ type: 'armed', contest: match.played[0], again: true }]);

    const won = winRound(resumed.match, 0, at + 500, random);
    const result = won.match;
    expect(result.phase.kind).toBe('result');
    expect(stepMatch(result, { type: 'resume', at: won.at + 5 }, random).match).toBe(result);
  });
});
