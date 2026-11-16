import { describe, expect, it } from 'vitest';
import { MAX_SCORE } from '../../online/protocol';
import {
  BASE_SPINS,
  buy,
  buyBlock,
  CELL_MAX,
  CELL_MIN,
  CELLS,
  CENTER,
  centerWildOf,
  charmOf,
  CHARMS,
  clearedRounds,
  discard,
  drawOffers,
  drawSymbol,
  JACKPOT_TIMES,
  layoutFor,
  lineOdds,
  LINES,
  lineSymbol,
  lineTimesOf,
  MACHINE_FRAME,
  MIN_WEIGHT,
  MISS_COIN,
  newRun,
  nextRound,
  oddsOf,
  OFFERS,
  reroll,
  REROLL_COST,
  REROLL_STEP,
  rollGrid,
  savingsFor,
  SAVINGS_PER,
  scoreOf,
  scoreSpin,
  settleRound,
  SHOP_HEAD,
  SHOP_ROW,
  SIZE,
  SLOTS,
  spin,
  spinsOf,
  START_COIN,
  SYMBOLS,
  targetOf,
  valuesOf,
  weightsOf,
  WILD,
  type Box,
  type RunState,
  type SpinContext,
} from './rules';

/** 테스트마다 같은 순서의 수를 내는 작은 난수기 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const [CHERRY, CLOVER, BELL, HORSESHOE, DIAMOND] = [0, 1, 2, 3, 4];
const PLAIN: SpinContext = { last: false, afterMiss: false };

/** 한 줄도 맞지 않는 판 */
const MISS_GRID = [CHERRY, CLOVER, BELL, CLOVER, BELL, CHERRY, HORSESHOE, CHERRY, CLOVER];

/** 주아 글꼴에 들어 있는 한글: KS X 1001의 완성형 2,350자 */
function fontSyllables(): Set<string> {
  const decoder = new TextDecoder('euc-kr');
  const syllables = new Set<string>();
  for (let lead = 0xb0; lead <= 0xc8; lead += 1) {
    for (let trail = 0xa1; trail <= 0xfe; trail += 1) {
      syllables.add(decoder.decode(new Uint8Array([lead, trail])));
    }
  }
  return syllables;
}

describe('그림', () => {
  it('흔한 그림일수록 상금이 적다', () => {
    for (let symbol = 1; symbol < SYMBOLS.length; symbol += 1) {
      expect(SYMBOLS[symbol].weight).toBeLessThan(SYMBOLS[symbol - 1].weight);
      expect(SYMBOLS[symbol].value).toBeGreaterThan(SYMBOLS[symbol - 1].value);
    }
    expect(SYMBOLS[WILD].key).toBe('seven');
  });

  it('부적이 없을 때의 무게는 모두 더해 100이라, 무게가 그대로 퍼센트다', () => {
    expect(weightsOf([]).reduce((sum, weight) => sum + weight, 0)).toBe(100);
    expect(oddsOf([])).toEqual(SYMBOLS.map((symbol) => symbol.weight / 100));
  });
});

describe('줄', () => {
  it('가로 셋, 세로 셋, 대각선 둘이다', () => {
    expect(LINES).toHaveLength(8);
    expect(LINES.filter((line) => line.kind === 'row')).toHaveLength(SIZE);
    expect(LINES.filter((line) => line.kind === 'col')).toHaveLength(SIZE);
    expect(LINES.filter((line) => line.kind === 'diag')).toHaveLength(2);
    // 가운데는 네 줄, 모서리는 세 줄, 변은 두 줄에 든다.
    const uses = new Array<number>(CELLS).fill(0);
    for (const line of LINES) for (const cell of line.cells) uses[cell] += 1;
    expect(uses).toEqual([3, 2, 3, 2, 4, 2, 3, 2, 3]);
  });

  it('같은 그림 셋이면 맞고, 하나라도 다르면 맞지 않는다', () => {
    const grid = [BELL, BELL, BELL, CHERRY, CLOVER, HORSESHOE, DIAMOND, CHERRY, CLOVER];
    expect(lineSymbol(grid, LINES[0])).toBe(BELL);
    expect(lineSymbol(grid, LINES[1])).toBeNull();
    expect(lineSymbol(grid, LINES[3])).toBeNull();
  });

  it('7은 다른 그림으로 쳐 주고, 셋이 다 7이면 7로 맞는다', () => {
    expect(lineSymbol([HORSESHOE, WILD, HORSESHOE, 0, 0, 0, 0, 0, 0], LINES[0])).toBe(HORSESHOE);
    expect(lineSymbol([WILD, WILD, DIAMOND, 0, 0, 0, 0, 0, 0], LINES[0])).toBe(DIAMOND);
    expect(lineSymbol([WILD, HORSESHOE, DIAMOND, 0, 0, 0, 0, 0, 0], LINES[0])).toBeNull();
    expect(lineSymbol([WILD, WILD, WILD, 0, 0, 0, 0, 0, 0], LINES[0])).toBe(WILD);
  });
});

describe('부적의 목록', () => {
  it('id가 겹치지 않고, 값과 이름이 있다', () => {
    const ids = CHARMS.map((charm) => charm.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const charm of CHARMS) {
      expect(charmOf(charm.id)).toBe(charm);
      expect(Number.isInteger(charm.price), charm.id).toBe(true);
      expect(charm.price, charm.id).toBeGreaterThan(0);
      expect(Object.keys(charm.effect), charm.id).toHaveLength(1);
    }
    expect(charmOf('no-such-charm')).toBeUndefined();
  });

  it('처음 가진 금화와 첫 라운드의 평균 벌이로 첫 가게에서 한 장은 살 수 있다', () => {
    const cheapest = Math.min(...CHARMS.map((charm) => charm.price));
    expect(cheapest).toBeLessThanOrEqual(START_COIN + 2 * BASE_SPINS - targetOf(1));
  });

  it('이름과 설명은 가게의 카드에 들어가는 길이이고, 글꼴에 들어 있는 한글만 쓴다', () => {
    const known = fontSyllables();
    expect(known.size).toBe(2350);
    const texts = [
      ...CHARMS.flatMap((charm) => [charm.name, charm.description]),
      ...SYMBOLS.map((symbol) => symbol.name),
    ];
    for (const text of texts) {
      for (const letter of text.match(/[ㄱ-ㆎ가-힣]/g) ?? []) {
        expect(known.has(letter), `"${letter}" in "${text}"`).toBe(true);
      }
    }
    for (const charm of CHARMS) {
      expect(charm.name.length, charm.name).toBeLessThanOrEqual(7);
      expect(charm.description.length, charm.description).toBeLessThanOrEqual(16);
    }
  });

  it('그림을 가리키는 부적은 있는 그림을 가리킨다', () => {
    for (const charm of CHARMS) {
      const symbol = charm.effect.weight?.[0] ?? charm.effect.value?.[0];
      if (symbol === undefined) continue;
      expect(SYMBOLS[symbol], charm.id).toBeDefined();
      // 설명에 그 그림의 이름이 들어 있다.
      expect(charm.description, charm.id).toContain(SYMBOLS[symbol].name);
    }
  });
});

describe('확률', () => {
  it('듬뿍 부적은 그 그림의 확률을 올리고 나머지를 내린다', () => {
    const before = oddsOf([]);
    const after = oddsOf(['more-horseshoe']);
    expect(after[HORSESHOE]).toBeGreaterThan(before[HORSESHOE]);
    for (const symbol of [CHERRY, CLOVER, BELL, DIAMOND, WILD]) expect(after[symbol]).toBeLessThan(before[symbol]);
    expect(after.reduce((sum, chance) => sum + chance, 0)).toBeCloseTo(1, 10);
  });

  it('덜기 부적은 그 그림의 확률을 내리고 나머지를 올린다', () => {
    const before = oddsOf([]);
    const after = oddsOf(['less-cherry']);
    expect(after[CHERRY]).toBeLessThan(before[CHERRY]);
    for (const symbol of [CLOVER, BELL, HORSESHOE, DIAMOND, WILD]) expect(after[symbol]).toBeGreaterThan(before[symbol]);
  });

  it('어떤 부적을 붙여도 그림의 무게는 바닥 밑으로 내려가지 않는다', () => {
    const all = CHARMS.map((charm) => charm.id);
    for (const weight of weightsOf(all)) expect(weight).toBeGreaterThanOrEqual(MIN_WEIGHT);
    for (const charm of CHARMS) {
      for (const weight of weightsOf([charm.id])) expect(weight, charm.id).toBeGreaterThanOrEqual(MIN_WEIGHT);
    }
  });

  it('무게대로 그림을 뽑는다', () => {
    const weights = weightsOf([]);
    // 0에 가까우면 첫 그림, 1에 가까우면 마지막 그림이다.
    expect(drawSymbol(weights, () => 0)).toBe(CHERRY);
    expect(drawSymbol(weights, () => 0.2999)).toBe(CHERRY);
    expect(drawSymbol(weights, () => 0.3)).toBe(CLOVER);
    expect(drawSymbol(weights, () => 0.9499)).toBe(DIAMOND);
    expect(drawSymbol(weights, () => 0.95)).toBe(WILD);
    expect(drawSymbol(weights, () => 0.999999)).toBe(WILD);

    const random = seeded(7);
    const counts = new Array<number>(SYMBOLS.length).fill(0);
    const draws = 20_000;
    for (let n = 0; n < draws; n += 1) counts[drawSymbol(weights, random)] += 1;
    counts.forEach((count, symbol) => expect(count / draws).toBeCloseTo(weights[symbol] / 100, 1));
  });

  it('한 줄이 맞을 확률은 세 칸을 모두 따져 본 것과 같다', () => {
    for (const charms of [[], ['more-diamond'], ['less-cherry', 'more-seven'], ['more-cherry', 'less-clover']]) {
      const odds = oddsOf(charms);
      const exact = new Array<number>(SYMBOLS.length).fill(0);
      for (let a = 0; a < odds.length; a += 1) {
        for (let b = 0; b < odds.length; b += 1) {
          for (let c = 0; c < odds.length; c += 1) {
            const symbol = lineSymbol([a, b, c, 0, 0, 0, 0, 0, 0], LINES[0]);
            if (symbol !== null) exact[symbol] += odds[a] * odds[b] * odds[c];
          }
        }
      }
      lineOdds(charms).forEach((chance, symbol) => expect(chance).toBeCloseTo(exact[symbol], 12));
    }
  });

  it('아홉 칸을 모두 채워 뽑는다', () => {
    const random = seeded(3);
    for (let n = 0; n < 50; n += 1) {
      const grid = rollGrid([], random);
      expect(grid).toHaveLength(CELLS);
      for (const symbol of grid) expect(SYMBOLS[symbol]).toBeDefined();
    }
  });

  it('가운데 7은 가운데 칸만, 정해진 확률로 7로 바꾼다', () => {
    expect(centerWildOf([])).toBe(0);
    expect(centerWildOf(['middle'])).toBe(0.25);
    // 가운데 칸에서만 수를 하나 더 뽑아 따진다: 0.1은 걸리고(7), 0.1로 뽑는 다른 칸은 체리다.
    const lucky = rollGrid(['middle'], () => 0.1);
    expect(lucky[CENTER]).toBe(WILD);
    expect(lucky.filter((_, cell) => cell !== CENTER)).toEqual(new Array<number>(CELLS - 1).fill(CHERRY));
    // 0.5는 걸리지 않아서 가운데도 여느 칸처럼 뽑는다.
    const plain = rollGrid(['middle'], () => 0.5);
    expect(plain[CENTER]).toBe(plain[0]);

    const random = seeded(11);
    let wild = 0;
    const rolls = 8_000;
    for (let n = 0; n < rolls; n += 1) if (rollGrid(['middle'], random)[CENTER] === WILD) wild += 1;
    const expected = 0.25 + 0.75 * oddsOf(['middle'])[WILD];
    expect(wild / rolls).toBeCloseTo(expected, 1);
  });
});

describe('한 번 돌린 결과', () => {
  it('맞은 줄마다 그 그림의 상금을 받는다', () => {
    const grid = [BELL, BELL, BELL, CHERRY, CLOVER, HORSESHOE, DIAMOND, CHERRY, CLOVER];
    const outcome = scoreSpin(grid, [], PLAIN);
    expect(outcome.wins).toEqual([{ line: 0, symbol: BELL, amount: 5 }]);
    expect(outcome.total).toBe(5);
    expect(outcome.boosts).toEqual([]);
    expect(outcome.consolation).toBe(0);
    expect(outcome.jackpot).toBe(false);
    expect(outcome.grid).toEqual(grid);
  });

  it('꽝이면 위로 금화만 받고, 위로 금화 부적이 있으면 더 받는다', () => {
    expect(scoreSpin(MISS_GRID, [], PLAIN).wins).toEqual([]);
    expect(scoreSpin(MISS_GRID, [], PLAIN).total).toBe(MISS_COIN);
    expect(scoreSpin(MISS_GRID, ['comfort'], PLAIN).total).toBe(MISS_COIN + 2);
    expect(scoreSpin(MISS_GRID, ['comfort'], PLAIN).consolation).toBe(MISS_COIN + 2);
    // 꽝에는 곱하는 부적이 듣지 않는다.
    expect(scoreSpin(MISS_GRID, ['comfort', 'finale', 'rebound'], { last: true, afterMiss: true }).total).toBe(
      MISS_COIN + 2,
    );
  });

  it('황금 부적은 그 그림의 상금만 올린다', () => {
    expect(valuesOf(['gold-bell'])).toEqual([2, 3, 11, 8, 12, 20]);
    const grid = [BELL, BELL, BELL, CHERRY, CLOVER, HORSESHOE, DIAMOND, CHERRY, CLOVER];
    expect(scoreSpin(grid, ['gold-bell'], PLAIN).total).toBe(11);
    expect(scoreSpin(grid, ['gold-horseshoe'], PLAIN).total).toBe(5);
  });

  it('줄 부적은 그 갈래의 줄에만 곱한다', () => {
    expect(lineTimesOf([])).toEqual({ row: 1, col: 1, diag: 1 });
    expect(lineTimesOf(['wide', 'slant'])).toEqual({ row: 2, col: 1, diag: 3 });
    // 왼쪽 세로줄과 내리 대각선이 말굽으로 맞는다.
    const grid = [HORSESHOE, CLOVER, BELL, HORSESHOE, HORSESHOE, CHERRY, HORSESHOE, CHERRY, HORSESHOE];
    expect(scoreSpin(grid, [], PLAIN).wins.map((win) => LINES[win.line].kind)).toEqual(['col', 'diag']);
    expect(scoreSpin(grid, [], PLAIN).total).toBe(16);
    expect(scoreSpin(grid, ['tall'], PLAIN).total).toBe(16 + 8);
    expect(scoreSpin(grid, ['slant'], PLAIN).total).toBe(8 + 24);
    expect(scoreSpin(grid, ['wide'], PLAIN).total).toBe(16);
  });

  it('쌍둥이 줄은 두 줄부터, 왕관은 세 줄부터 듣고, 둘은 겹친다', () => {
    const one = [BELL, BELL, BELL, CHERRY, CLOVER, HORSESHOE, DIAMOND, CHERRY, CLOVER];
    const two = [HORSESHOE, CLOVER, BELL, HORSESHOE, HORSESHOE, CHERRY, HORSESHOE, CHERRY, HORSESHOE];
    // 가로 세 줄이 체리, 클로버, 종으로 맞는다.
    const three = [CHERRY, CHERRY, CHERRY, CLOVER, CLOVER, CLOVER, BELL, BELL, BELL];
    expect(scoreSpin(three, [], PLAIN).wins).toHaveLength(3);
    expect(scoreSpin(three, [], PLAIN).total).toBe(10);

    expect(scoreSpin(one, ['twins', 'crown'], PLAIN).total).toBe(5);
    expect(scoreSpin(two, ['twins'], PLAIN).total).toBe(32);
    expect(scoreSpin(two, ['twins'], PLAIN).boosts).toEqual([{ kind: 'combo', times: 2 }]);
    expect(scoreSpin(two, ['crown'], PLAIN).total).toBe(16);
    expect(scoreSpin(three, ['crown'], PLAIN).total).toBe(20);
    expect(scoreSpin(three, ['twins', 'crown'], PLAIN).total).toBe(40);
    expect(scoreSpin(three, ['twins', 'crown'], PLAIN).boosts).toEqual([{ kind: 'combo', times: 4 }]);
  });

  it('막판 한 방은 마지막 스핀에만, 오뚝이는 꽝 다음 스핀에만 듣는다', () => {
    const grid = [BELL, BELL, BELL, CHERRY, CLOVER, HORSESHOE, DIAMOND, CHERRY, CLOVER];
    expect(scoreSpin(grid, ['finale'], PLAIN).total).toBe(5);
    expect(scoreSpin(grid, ['finale'], { last: true, afterMiss: false }).total).toBe(15);
    expect(scoreSpin(grid, ['rebound'], PLAIN).total).toBe(5);
    expect(scoreSpin(grid, ['rebound'], { last: false, afterMiss: true }).total).toBe(10);
    const both = scoreSpin(grid, ['finale', 'rebound'], { last: true, afterMiss: true });
    expect(both.total).toBe(30);
    expect(both.boosts).toEqual([
      { kind: 'last', times: 3 },
      { kind: 'rebound', times: 2 },
    ]);
    // 부적이 없으면 마지막 스핀이어도 그대로다.
    expect(scoreSpin(grid, [], { last: true, afterMiss: true }).boosts).toEqual([]);
  });

  it('아홉 칸이 모두 맞으면 여덟 줄의 상금에 한 번 더 곱한다', () => {
    const grid = [DIAMOND, WILD, DIAMOND, DIAMOND, DIAMOND, WILD, DIAMOND, DIAMOND, DIAMOND];
    const outcome = scoreSpin(grid, [], PLAIN);
    expect(outcome.jackpot).toBe(true);
    expect(outcome.wins).toHaveLength(LINES.length);
    expect(outcome.base).toBe(12 * 8);
    expect(outcome.total).toBe(12 * 8 * JACKPOT_TIMES);
    expect(outcome.boosts).toEqual([{ kind: 'jackpot', times: JACKPOT_TIMES }]);
  });

  it('상금은 언제나 0 이상의 정수다', () => {
    const random = seeded(21);
    const all = CHARMS.map((charm) => charm.id);
    for (let n = 0; n < 300; n += 1) {
      const charms = all.filter(() => random() < 0.25);
      const outcome = scoreSpin(rollGrid(charms, random), charms, {
        last: random() < 0.2,
        afterMiss: random() < 0.5,
      });
      expect(Number.isInteger(outcome.total)).toBe(true);
      expect(outcome.total).toBeGreaterThanOrEqual(outcome.wins.length === 0 ? MISS_COIN : outcome.base);
    }
  });
});

describe('라운드', () => {
  it('목표는 정수이고 라운드마다 오른다', () => {
    let previous = 0;
    for (let round = 1; round <= 30; round += 1) {
      const target = targetOf(round);
      expect(Number.isInteger(target)).toBe(true);
      expect(target).toBeGreaterThan(previous);
      previous = target;
    }
    expect(targetOf(0)).toBe(targetOf(1));
    // 적어 둔 것 뒤로는 한 배 반씩 오른다.
    expect(targetOf(13)).toBe(Math.floor((targetOf(12) * 3) / 2));
    expect(targetOf(14)).toBe(Math.floor((targetOf(13) * 3) / 2));
  });

  it('덤 스핀은 라운드마다 한 번을 더 준다', () => {
    expect(spinsOf([])).toBe(BASE_SPINS);
    expect(spinsOf(['extra'])).toBe(BASE_SPINS + 1);
  });

  it('저금통은 남은 금화 다섯 개마다 하나를 한도까지 준다', () => {
    expect(savingsFor(100, [])).toBe(0);
    expect(savingsFor(SAVINGS_PER - 1, ['piggy'])).toBe(0);
    expect(savingsFor(SAVINGS_PER, ['piggy'])).toBe(1);
    expect(savingsFor(23, ['piggy'])).toBe(4);
    expect(savingsFor(1000, ['piggy'])).toBe(8);
    expect(savingsFor(-5, ['piggy'])).toBe(0);
  });
});

/** 스핀을 다 쓰고 금화를 coin개 가진 run */
function spent(coin: number, extra: Partial<RunState> = {}): RunState {
  return { ...newRun(), spinsLeft: 0, coin, ...extra };
}

describe('한 판', () => {
  it('첫 라운드에서 시작한다', () => {
    const run = newRun();
    expect(run).toMatchObject({
      phase: 'spin',
      round: 1,
      spinsLeft: BASE_SPINS,
      coin: START_COIN,
      earned: 0,
      charms: [],
      shop: null,
    });
    expect(clearedRounds(run)).toBe(0);
    expect(scoreOf(run)).toBe(0);
  });

  it('돌리면 스핀이 줄고 받은 금화가 쌓인다', () => {
    const random = seeded(5);
    let run = newRun();
    let earned = 0;
    let best = 0;
    for (let n = 0; n < BASE_SPINS; n += 1) {
      const result = spin(run, random);
      expect(result).not.toBeNull();
      earned += result!.outcome.total;
      best = Math.max(best, result!.outcome.total);
      run = result!.run;
      expect(run.spinsLeft).toBe(BASE_SPINS - n - 1);
      expect(run.coin).toBe(START_COIN + earned);
      expect(run.earned).toBe(earned);
      expect(run.afterMiss).toBe(result!.outcome.wins.length === 0);
    }
    expect(run.bestSpin).toBe(best);
    // 스핀을 다 쓰면 더 돌릴 수 없다.
    expect(spin(run, random)).toBeNull();
  });

  it('마지막 스핀과 꽝 다음 스핀을 알아서 따진다', () => {
    // 0.31은 언제나 클로버라 아홉 칸이 다 맞는다.
    const allDrops = (): number => 0.31;
    const last = spin({ ...newRun(), spinsLeft: 1, charms: ['finale'] }, allDrops)!;
    expect(last.outcome.boosts).toContainEqual({ kind: 'last', times: 3 });
    const early = spin({ ...newRun(), spinsLeft: 2, charms: ['finale'] }, allDrops)!;
    expect(early.outcome.boosts).not.toContainEqual({ kind: 'last', times: 3 });
    const rebound = spin({ ...newRun(), afterMiss: true, charms: ['rebound'] }, allDrops)!;
    expect(rebound.outcome.boosts).toContainEqual({ kind: 'rebound', times: 2 });
    expect(rebound.run.afterMiss).toBe(false);
  });

  it('스핀이 남았으면 라운드를 맺지 않는다', () => {
    expect(settleRound(newRun(), Math.random)).toBeNull();
  });

  it('목표를 채웠으면 목표만큼 내고 가게가 열린다', () => {
    const settled = settleRound(spent(targetOf(1) + 7), seeded(1))!;
    expect(settled.cleared).toBe(true);
    expect(settled.paid).toBe(targetOf(1));
    expect(settled.savings).toBe(0);
    expect(settled.run.phase).toBe('shop');
    expect(settled.run.coin).toBe(7);
    expect(settled.run.shop?.offers).toHaveLength(OFFERS);
    expect(settled.run.shop?.rerollCost).toBe(REROLL_COST);
    expect(clearedRounds(settled.run)).toBe(1);
    // 딱 맞게 가졌어도 넘어간다.
    expect(settleRound(spent(targetOf(1)), seeded(1))!.cleared).toBe(true);
  });

  it('저금통의 덤은 내고 남은 금화에 붙고 점수에도 든다', () => {
    const settled = settleRound(spent(targetOf(1) + 12, { charms: ['piggy'], earned: 40 }), seeded(1))!;
    expect(settled.savings).toBe(2);
    expect(settled.run.coin).toBe(14);
    expect(settled.run.earned).toBe(42);
  });

  it('목표에 모자라면 판이 끝난다', () => {
    const settled = settleRound(spent(targetOf(1) - 1, { earned: 9 }), seeded(1))!;
    expect(settled.cleared).toBe(false);
    expect(settled.paid).toBe(0);
    expect(settled.run.phase).toBe('over');
    expect(settled.run.shop).toBeNull();
    expect(settled.run.coin).toBe(targetOf(1) - 1);
    expect(scoreOf(settled.run)).toBe(9);
    expect(clearedRounds(settled.run)).toBe(0);
    // 끝난 판은 더 돌리지도 맺지도 못한다.
    expect(spin(settled.run, Math.random)).toBeNull();
    expect(settleRound(settled.run, Math.random)).toBeNull();
  });
});

/** 금화를 coin개 가지고 offers를 파는 가게에 있는 run */
function shopping(coin: number, offers: (string | null)[], charms: string[] = []): RunState {
  return { ...newRun(), phase: 'shop', spinsLeft: 0, coin, charms, shop: { offers, rerollCost: REROLL_COST } };
}

describe('가게', () => {
  it('서로 다른 부적 세 장이 나오고, 붙여 둔 부적은 나오지 않는다', () => {
    const random = seeded(9);
    const seen = new Set<string>();
    const owned = ['twins', 'piggy', 'more-diamond'];
    for (let n = 0; n < 400; n += 1) {
      const offers = drawOffers(owned, random);
      expect(offers).toHaveLength(OFFERS);
      expect(new Set(offers).size).toBe(OFFERS);
      for (const id of offers) {
        expect(charmOf(id)).toBeDefined();
        expect(owned).not.toContain(id);
        seen.add(id);
      }
    }
    // 나머지 부적은 모두 나올 수 있다.
    expect(seen.size).toBe(CHARMS.length - owned.length);
  });

  it('사면 값을 치르고 붙이고, 그 자리는 비워진다', () => {
    const run = shopping(10, ['comfort', 'wide', 'crown']);
    expect(buyBlock(run, 0)).toBeNull();
    const bought = buy(run, 0);
    expect(bought.coin).toBe(10 - charmOf('comfort')!.price);
    expect(bought.charms).toEqual(['comfort']);
    expect(bought.shop?.offers).toEqual([null, 'wide', 'crown']);
    // 사는 것으로는 점수가 바뀌지 않는다.
    expect(bought.earned).toBe(run.earned);
    // 팔린 자리는 다시 살 수 없다.
    expect(buyBlock(bought, 0)).toBe('sold');
    expect(buy(bought, 0)).toBe(bought);
  });

  it('금화가 모자라거나 자리가 없으면 살 수 없다', () => {
    const poor = shopping(charmOf('wide')!.price - 1, ['wide', null, null]);
    expect(buyBlock(poor, 0)).toBe('coin');
    expect(buy(poor, 0)).toBe(poor);

    const full = shopping(99, ['wide', null, null], ['twins', 'crown', 'piggy', 'extra', 'comfort']);
    expect(full.charms).toHaveLength(SLOTS);
    expect(buyBlock(full, 0)).toBe('full');
    expect(buy(full, 0)).toBe(full);
    // 한 장을 떼면 살 수 있다.
    const freed = discard(full, 2);
    expect(freed.charms).toEqual(['twins', 'crown', 'extra', 'comfort']);
    expect(freed.coin).toBe(99);
    expect(buy(freed, 0).charms).toEqual(['twins', 'crown', 'extra', 'comfort', 'wide']);

    expect(buyBlock(shopping(99, ['wide', null, null]), 7)).toBe('sold');
    expect(buyBlock(newRun(), 0)).toBe('closed');
  });

  it('다시 뽑으면 값을 치르고, 다음 값이 오른다', () => {
    const run = shopping(10, ['comfort', null, null], ['wide']);
    const again = reroll(run, seeded(4));
    expect(again.coin).toBe(10 - REROLL_COST);
    expect(again.shop?.rerollCost).toBe(REROLL_COST + REROLL_STEP);
    expect(again.shop?.offers).toHaveLength(OFFERS);
    expect(again.shop?.offers).not.toContain('wide');
    expect(again.shop?.offers).not.toContain(null);
    // 금화가 모자라면 그대로다.
    const poor = shopping(REROLL_COST - 1, ['comfort', null, null]);
    expect(reroll(poor, seeded(4))).toBe(poor);
    expect(reroll(newRun(), seeded(4)).shop).toBeNull();
  });

  it('부적은 가게에서만 뗄 수 있다', () => {
    const playing = { ...newRun(), charms: ['wide'] };
    expect(discard(playing, 0)).toBe(playing);
    const run = shopping(0, [null, null, null], ['wide', 'tall']);
    expect(discard(run, 5)).toBe(run);
    expect(discard(run, -1)).toBe(run);
    expect(discard(run, 0).charms).toEqual(['tall']);
  });

  it('가게를 닫으면 다음 라운드가 스핀을 채워 시작된다', () => {
    const run = { ...shopping(4, [null, 'wide', null], ['extra']), round: 3, afterMiss: true };
    const next = nextRound(run);
    expect(next).toMatchObject({ phase: 'spin', round: 4, spinsLeft: BASE_SPINS + 1, coin: 4, shop: null });
    expect(next.afterMiss).toBe(false);
    expect(clearedRounds(next)).toBe(3);
    expect(nextRound(next)).toBe(next);
  });
});

describe('화면의 자리', () => {
  /** 게임 화면의 높이(HUD 포함)마다, HUD(56) 아래의 자리 */
  const areaOf = (height: number): Box => ({ x: 0, y: 56, width: 240, height: height - 56 });
  const bottom = (box: Box): number => box.y + box.height;

  it('가장 짧은 화면부터 가장 긴 화면까지, 모든 줄이 겹치지 않고 화면 안에 들어간다', () => {
    for (let height = 400; height <= 560; height += 4) {
      const area = areaOf(height);
      const layout = layoutFor(area);
      const slotsBox: Box = {
        x: layout.slots[0].x,
        y: layout.slots[0].y,
        width: layout.slots[SLOTS - 1].x + layout.slotSize - layout.slots[0].x,
        height: layout.slotSize,
      };
      const rows = [layout.goal, layout.machine, slotsBox, layout.odds.box, layout.button];
      expect(rows[0].y, `${height}`).toBeGreaterThanOrEqual(area.y);
      for (let index = 1; index < rows.length; index += 1) {
        expect(rows[index].y, `${height}: ${index}번째 줄`).toBeGreaterThanOrEqual(bottom(rows[index - 1]) + 4);
      }
      expect(bottom(layout.button), `${height}`).toBeLessThanOrEqual(height - 4);
      for (const row of rows) {
        expect(row.x, `${height}`).toBeGreaterThanOrEqual(0);
        expect(row.x + row.width, `${height}`).toBeLessThanOrEqual(240);
      }
    }
  });

  it('칸은 정해진 크기 안에서 화면이 길수록 커지고, 기계의 몸통 안에 놓인다', () => {
    let previous = 0;
    for (let height = 400; height <= 560; height += 4) {
      const layout = layoutFor(areaOf(height));
      expect(layout.cell).toBeGreaterThanOrEqual(CELL_MIN);
      expect(layout.cell).toBeLessThanOrEqual(CELL_MAX);
      expect(layout.cell).toBeGreaterThanOrEqual(previous);
      previous = layout.cell;
      expect(layout.gridLeft).toBe(layout.machine.x + MACHINE_FRAME);
      expect(layout.gridTop).toBe(layout.machine.y + MACHINE_FRAME);
      expect(layout.machine.width).toBe(layout.cell * SIZE + MACHINE_FRAME * 2);
    }
    expect(layoutFor(areaOf(560)).cell).toBe(CELL_MAX);
  });

  it('가게의 창은 목표와 부적 줄 사이에 놓이고 부적 세 줄이 들어간다', () => {
    for (let height = 400; height <= 560; height += 4) {
      const layout = layoutFor(areaOf(height));
      expect(layout.shop.y).toBeGreaterThanOrEqual(bottom(layout.goal));
      expect(bottom(layout.shop)).toBeLessThan(layout.slots[0].y);
      expect(layout.shop.height).toBeGreaterThanOrEqual(SHOP_HEAD + OFFERS * SHOP_ROW);
    }
  });

  it('확률 줄의 칸은 그림마다 하나씩 카드 안에 나란히 놓인다', () => {
    const { odds } = layoutFor(areaOf(480));
    expect(odds.cells).toHaveLength(SYMBOLS.length);
    expect(odds.cells[0]).toBeGreaterThanOrEqual(odds.box.x);
    expect(odds.cells[SYMBOLS.length - 1] + odds.cellWidth).toBeLessThanOrEqual(odds.box.x + odds.box.width);
    for (let index = 1; index < odds.cells.length; index += 1) {
      expect(odds.cells[index] - odds.cells[index - 1]).toBe(odds.cellWidth);
    }
  });
});

// ───────── 자동 플레이로 보는 밸런스 ─────────

/** 붙인 부적으로 라운드 하나에서 버는 금화의 평균 */
function averageRound(charms: readonly string[], rounds: number, random: () => number): number {
  let total = 0;
  for (let n = 0; n < rounds; n += 1) {
    let afterMiss = false;
    for (let left = spinsOf(charms); left > 0; left -= 1) {
      const outcome = scoreSpin(rollGrid(charms, random), charms, { last: left === 1, afterMiss });
      afterMiss = outcome.wins.length === 0;
      total += outcome.total;
    }
  }
  return total / rounds;
}

/** 가게에서 pick이 고른 대로 사면서 판이 끝날 때까지 한다. */
function playRun(random: () => number, shop: (run: RunState) => RunState): RunState {
  let run = newRun();
  for (let guard = 0; guard < 200; guard += 1) {
    while (run.spinsLeft > 0) run = spin(run, random)!.run;
    const settled = settleRound(run, random)!;
    run = settled.run;
    if (!settled.cleared) return run;
    run = nextRound(shop(run));
  }
  throw new Error('판이 끝나지 않는다');
}

/** 살 수 있는 것을 보이는 대로 사는 사람 */
function buyAnything(run: RunState): RunState {
  let next = run;
  for (let offer = 0; offer < OFFERS; offer += 1) next = buy(next, offer);
  return next;
}

describe('밸런스', () => {
  it('부적 없이도 첫 라운드는 거의 언제나 넘긴다', () => {
    const random = seeded(101);
    let failed = 0;
    const runs = 2_000;
    for (let n = 0; n < runs; n += 1) {
      const run = playRun(random, (state) => state);
      if (clearedRounds(run) === 0) failed += 1;
    }
    expect(failed / runs).toBeLessThan(0.02);
  });

  it('부적을 하나도 사지 않으면 오래 가지 못한다', () => {
    const random = seeded(102);
    const rounds: number[] = [];
    for (let n = 0; n < 1_000; n += 1) rounds.push(clearedRounds(playRun(random, (state) => state)));
    rounds.sort((a, b) => a - b);
    expect(rounds[Math.floor(rounds.length / 2)]).toBeGreaterThanOrEqual(3);
    expect(rounds[rounds.length - 1]).toBeLessThanOrEqual(9);
  });

  it('보이는 대로 사기만 해도 사지 않는 것보다 멀리 간다', () => {
    const median = (shop: (run: RunState) => RunState, seed: number): number => {
      const random = seeded(seed);
      const rounds: number[] = [];
      for (let n = 0; n < 1_000; n += 1) rounds.push(clearedRounds(playRun(random, shop)));
      rounds.sort((a, b) => a - b);
      return rounds[Math.floor(rounds.length / 2)];
    };
    expect(median(buyAnything, 103)).toBeGreaterThan(median((state) => state, 103));
  });

  it('부적마다 값어치가 있다: 붙이면 평균 벌이가 줄지 않는다', () => {
    const base = averageRound([], 4_000, seeded(104));
    for (const charm of CHARMS) {
      // 저금통은 벌이가 아니라 남은 금화에 듣는다.
      if (charm.effect.savingsCap !== undefined) continue;
      expect(averageRound([charm.id], 4_000, seeded(104)), charm.id).toBeGreaterThan(base);
    }
  });

  it('가장 센 조합으로도 판은 끝나고, 점수는 랭킹이 받는 범위 안이다', () => {
    // 자동 플레이로 찾은 가장 센 조합들을 처음부터 거저 붙여 준다.
    const strongest = [
      ['more-cherry', 'less-clover', 'gold-cherry', 'twins', 'crown'],
      ['more-clover', 'less-cherry', 'gold-clover', 'twins', 'crown'],
      ['more-bell', 'less-cherry', 'less-clover', 'gold-bell', 'twins'],
      ['more-diamond', 'less-cherry', 'less-clover', 'gold-diamond', 'twins'],
    ];
    const random = seeded(105);
    for (const charms of strongest) {
      for (let n = 0; n < 150; n += 1) {
        let run: RunState = { ...newRun(), charms: [...charms], spinsLeft: spinsOf(charms) };
        let over = false;
        for (let guard = 0; guard < 40 && !over; guard += 1) {
          while (run.spinsLeft > 0) run = spin(run, random)!.run;
          const settled = settleRound(run, random)!;
          run = settled.cleared ? nextRound(settled.run) : settled.run;
          over = !settled.cleared;
        }
        expect(over, charms.join(' ')).toBe(true);
        expect(clearedRounds(run), charms.join(' ')).toBeLessThanOrEqual(20);
        expect(scoreOf(run)).toBeLessThan(MAX_SCORE / 10);
      }
    }
  });
});
