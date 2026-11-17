import { describe, expect, it } from 'vitest';
import { MAX_SCORE } from '../../online/protocol';
import {
  BASE_SPINS,
  type Box,
  buy,
  buyBlock,
  canHold,
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
  hitChance,
  HOLDS_PER_ROUND,
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
  PERK_IDS,
  randomOf,
  refundOf,
  RELIC_IDS,
  RELIC_MAX,
  type RelicLevels,
  reroll,
  REROLL_COST,
  REROLL_STEP,
  rollGrid,
  type RunState,
  SAVINGS_PER,
  savingsFor,
  scoreOf,
  scoreSpin,
  settleRound,
  SHOP_HEAD,
  SHOP_ROW,
  SIZE,
  SLOTS,
  spin,
  type SpinContext,
  spinsOf,
  START_COIN,
  SYMBOLS,
  targetFor,
  targetOf,
  upgrade,
  upgradeCostOf,
  upgradedOf,
  valuesOf,
  weightsOf,
  WILD,
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
      ...CHARMS.flatMap((charm) => [charm.name, charm.description, charm.upgrade.description]),
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
      expect(charm.upgrade.description.length, charm.upgrade.description).toBeLessThanOrEqual(16);
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

  it('듬뿍의 설명은 다른 그림이 줄어든다고 알린다: 서로 다른 듬뿍을 겹치면 줄이 덜 맞기도 한다', () => {
    const more = CHARMS.filter((charm) => (charm.effect.weight?.[1] ?? 0) > 0);
    expect(more).toHaveLength(SYMBOLS.length);
    for (const charm of more) {
      const symbol = charm.effect.weight![0];
      expect(charm.description).toBe(`${SYMBOLS[symbol].name} 늘고 다른 그림 줄어요`);
      expect(charm.upgrade.description).toBe(`${SYMBOLS[symbol].name} 더 늘고 나머지 줄어요`);
      // 설명대로다: 강화하든 아니든 그 그림만 늘고 다른 그림은 모두 준다.
      for (const id of [charm.id, upgradedOf(charm.id)]) {
        const before = oddsOf([]);
        const after = oddsOf([id]);
        SYMBOLS.forEach((_, other) => {
          if (other === symbol) expect(after[other], id).toBeGreaterThan(before[other]);
          else expect(after[other], id).toBeLessThan(before[other]);
        });
      }
    }
    // 그래서 서로 다른 듬뿍을 둘 붙이면, 하나만 붙였을 때보다 줄이 덜 맞는 짝이 절반을 넘는다.
    let pairs = 0;
    let worse = 0;
    for (let a = 0; a < more.length; a += 1) {
      for (let b = a + 1; b < more.length; b += 1) {
        pairs += 1;
        const both = hitChance([more[a].id, more[b].id]);
        if (both < Math.max(hitChance([more[a].id]), hitChance([more[b].id]))) worse += 1;
      }
    }
    expect(pairs).toBe(15);
    expect(worse).toBeGreaterThan(pairs / 2);
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
    const chance = charmOf('middle')!.effect.centerWild!;
    expect(centerWildOf([])).toBe(0);
    expect(centerWildOf(['middle'])).toBe(chance);
    expect(chance).toBeGreaterThan(0.1);
    expect(chance).toBeLessThan(0.5);
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
    const expected = chance + (1 - chance) * oddsOf(['middle'])[WILD];
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
    expect(scoreSpin(MISS_GRID, ['comfort'], PLAIN).total).toBe(MISS_COIN + 4);
    expect(scoreSpin(MISS_GRID, ['comfort'], PLAIN).consolation).toBe(MISS_COIN + 4);
    // 꽝에는 곱하는 부적이 듣지 않는다.
    expect(scoreSpin(MISS_GRID, ['comfort', 'finale', 'rebound'], { last: true, afterMiss: true }).total).toBe(
      MISS_COIN + 4,
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

  it('쌍둥이 줄은 딱 두 줄일 때만, 왕관은 세 줄부터 듣고, 둘은 한 스핀에 함께 듣지 않는다', () => {
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
    // 세 줄이 맞으면 쌍둥이 줄은 듣지 않는다. 그래서 둘을 함께 붙여도 곱이 겹치지 않고, 두 줄과 세 줄 이상을 나눠 맡는다.
    expect(scoreSpin(three, ['twins'], PLAIN).total).toBe(10);
    expect(scoreSpin(three, ['twins'], PLAIN).boosts).toEqual([]);
    expect(scoreSpin(two, ['twins', 'crown'], PLAIN).total).toBe(32);
    expect(scoreSpin(three, ['twins', 'crown'], PLAIN).total).toBe(20);
    expect(scoreSpin(three, ['twins', 'crown'], PLAIN).boosts).toEqual([{ kind: 'combo', times: 2 }]);
    // 강화하면 곱이 커질 뿐, 듣는 줄의 수는 그대로다.
    expect(scoreSpin(two, ['twins+'], PLAIN).total).toBe(64);
    expect(scoreSpin(three, ['twins+'], PLAIN).total).toBe(10);
    expect(scoreSpin(one, ['twins+', 'crown+'], PLAIN).total).toBe(5);
  });

  it('강화한 줄 부적과 재주는 곱이 한 배나 두 배 커진다', () => {
    const one = [BELL, BELL, BELL, CHERRY, CLOVER, HORSESHOE, DIAMOND, CHERRY, CLOVER];
    const three = [CHERRY, CHERRY, CHERRY, CLOVER, CLOVER, CLOVER, BELL, BELL, BELL];
    expect(lineTimesOf(['wide+'])).toEqual({ row: 3, col: 1, diag: 1 });
    expect(scoreSpin(one, ['wide+'], PLAIN).wins).toEqual([{ line: 0, symbol: BELL, amount: 15 }]);
    expect(scoreSpin(three, ['wide+'], PLAIN).total).toBe(6 + 9 + 15);
    expect(lineTimesOf(['tall+', 'slant+'])).toEqual({ row: 1, col: 3, diag: 4 });
    // 왕관을 강화하면 세 배: 10개가 30개.
    expect(scoreSpin(three, ['crown+'], PLAIN).total).toBe(30);
    expect(scoreSpin(three, ['crown+'], PLAIN).boosts).toEqual([{ kind: 'combo', times: 3 }]);
    // 오뚝이를 강화하면 네 배, 막판 한 방을 강화하면 다섯 배다.
    expect(scoreSpin(one, ['rebound+'], { last: false, afterMiss: true }).total).toBe(20);
    expect(scoreSpin(one, ['finale+'], { last: true, afterMiss: false }).total).toBe(25);
  });

  it('막판 한 방은 마지막 스핀에만, 오뚝이는 꽝 다음 스핀에만 듣는다', () => {
    const grid = [BELL, BELL, BELL, CHERRY, CLOVER, HORSESHOE, DIAMOND, CHERRY, CLOVER];
    expect(scoreSpin(grid, ['finale'], PLAIN).total).toBe(5);
    expect(scoreSpin(grid, ['finale'], { last: true, afterMiss: false }).total).toBe(15);
    expect(scoreSpin(grid, ['rebound'], PLAIN).total).toBe(5);
    expect(scoreSpin(grid, ['rebound'], { last: false, afterMiss: true }).total).toBe(15);
    const both = scoreSpin(grid, ['finale', 'rebound'], { last: true, afterMiss: true });
    expect(both.total).toBe(45);
    expect(both.boosts).toEqual([
      { kind: 'last', times: 3 },
      { kind: 'rebound', times: 3 },
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
    // 강화한 부적도 섞는다.
    const all = CHARMS.map((charm) => charm.id);
    for (let n = 0; n < 600; n += 1) {
      const charms = all.filter(() => random() < 0.25).map((id) => (random() < 0.5 ? `${id}+` : id));
      const outcome = scoreSpin(rollGrid(charms, random), charms, {
        last: random() < 0.2,
        afterMiss: random() < 0.5,
      });
      expect(Number.isInteger(outcome.total)).toBe(true);
      expect(outcome.total).toBeGreaterThanOrEqual(outcome.wins.length === 0 ? MISS_COIN : outcome.base);
      for (const win of outcome.wins) expect(Number.isInteger(win.amount)).toBe(true);
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

  it('덤 스핀은 라운드마다 세 번을 더 준다', () => {
    expect(spinsOf([])).toBe(BASE_SPINS);
    expect(spinsOf(['extra'])).toBe(BASE_SPINS + 3);
  });

  it('저금통은 남은 금화 세 개마다 하나를 한도까지 준다', () => {
    expect(SAVINGS_PER).toBe(3);
    expect(savingsFor(100, [])).toBe(0);
    // 설명에는 몇 개마다 받는지와 한도가 함께 적혀 있다.
    const piggy = charmOf('piggy')!;
    expect(piggy.description).toContain(`${SAVINGS_PER}개마다`);
    expect(piggy.description).toContain(`${piggy.effect.savingsCap}까지`);
    expect(savingsFor(SAVINGS_PER * 1000, ['piggy'])).toBe(piggy.effect.savingsCap);
    expect(savingsFor(SAVINGS_PER - 1, ['piggy'])).toBe(0);
    expect(savingsFor(SAVINGS_PER, ['piggy'])).toBe(1);
    expect(savingsFor(23, ['piggy'])).toBe(7);
    expect(savingsFor(1000, ['piggy'])).toBe(20);
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
    expect(rebound.outcome.boosts).toContainEqual({ kind: 'rebound', times: 3 });
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
    expect(settled.savings).toBe(4);
    expect(settled.run.coin).toBe(16);
    expect(settled.run.earned).toBe(44);
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

describe('열 잠그기', () => {
  it('라운드의 첫 스핀 전에는 잠글 수 없고, 한 번 돌리면 잠글 수 있다', () => {
    const run = newRun();
    expect(canHold(run)).toBe(false);
    expect(run.holdsLeft).toBe(HOLDS_PER_ROUND);
    const after = spin(run, seeded(3))!.run;
    expect(after.lastGrid).toHaveLength(CELLS);
    expect(canHold(after)).toBe(true);
  });

  it('잠근 열의 세 칸은 그대로 있고, 나머지는 잠그지 않았을 때와 똑같이 나온다', () => {
    const first = spin(newRun(), seeded(3))!.run;
    const last = first.lastGrid!;
    for (let col = 0; col < SIZE; col += 1) {
      const free = spin(first, seeded(9))!;
      const held = spin(first, seeded(9), col)!;
      held.outcome.grid.forEach((symbol, cell) => {
        expect(symbol, `열 ${col}, 칸 ${cell}`).toBe(cell % SIZE === col ? last[cell] : free.outcome.grid[cell]);
      });
      expect(held.run.holdsLeft).toBe(HOLDS_PER_ROUND - 1);
      expect(free.run.holdsLeft).toBe(HOLDS_PER_ROUND);
    }
  });

  it('한 라운드에 정해진 횟수만 잠글 수 있고, 다 쓰면 잠그라고 해도 그냥 돌린다', () => {
    let run = spin(newRun(), seeded(3))!.run;
    for (let used = 0; used < HOLDS_PER_ROUND; used += 1) run = spin(run, seeded(4 + used), 0)!.run;
    expect(run.holdsLeft).toBe(0);
    expect(canHold(run)).toBe(false);
    const free = spin(run, seeded(11))!;
    const asked = spin(run, seeded(11), 1)!;
    expect(asked.outcome.grid).toEqual(free.outcome.grid);
  });

  it('없는 열을 주면 잠그지 않는다', () => {
    const run = spin(newRun(), seeded(3))!.run;
    for (const col of [-1, SIZE, 0.5]) {
      const result = spin(run, seeded(9), col)!;
      expect(result.outcome.grid).toEqual(spin(run, seeded(9))!.outcome.grid);
      expect(result.run.holdsLeft).toBe(HOLDS_PER_ROUND);
    }
  });

  it('라운드가 바뀌면 잠그기 횟수가 돌아오고, 앞 라운드의 판은 잊는다', () => {
    const used: RunState = { ...newRun(), phase: 'shop', spinsLeft: 0, holdsLeft: 0, lastGrid: Array(CELLS).fill(0), shop: { offers: [], rerollCost: REROLL_COST } };
    const next = nextRound(used);
    expect(next.holdsLeft).toBe(HOLDS_PER_ROUND);
    expect(next.lastGrid).toBeNull();
    expect(canHold(next)).toBe(false);
  });
});

describe('정해진 운', () => {
  it('여느 판은 받은 운을 그대로 쓴다', () => {
    const fallback = (): number => 0.5;
    expect(randomOf(newRun(), 'spin', fallback)).toBe(fallback);
    expect(randomOf(newRun(), 'shop', fallback)).toBe(fallback);
  });

  /** 정해진 운으로 스핀만 count번 돌린 판들 */
  const spun = (seed: string, count: number): number[][] => {
    let run = newRun(seed);
    const grids: number[][] = [];
    for (let index = 0; index < count; index += 1) {
      const result = spin(run, randomOf(run, 'spin', Math.random))!;
      grids.push([...result.outcome.grid]);
      run = result.run;
    }
    return grids;
  };

  it('같은 씨앗이면 같은 차례에 같은 판이 나오고, 씨앗이 다르면 달라진다', () => {
    expect(spun('오늘', BASE_SPINS)).toEqual(spun('오늘', BASE_SPINS));
    expect(spun('오늘', BASE_SPINS)).not.toEqual(spun('내일', BASE_SPINS));
    // 스핀마다 운이 새로 정해져서, 같은 판만 되풀이되지 않는다.
    const grids = spun('오늘', BASE_SPINS);
    expect(new Set(grids.map((grid) => grid.join(''))).size).toBeGreaterThan(1);
  });

  it('가게에서 다시 뽑아도 다음 스핀의 운은 그대로다', () => {
    const settled = (rerolls: number): RunState => {
      let run: RunState = { ...newRun('오늘'), spinsLeft: 0, coin: 999 };
      run = settleRound(run, randomOf(run, 'shop', Math.random))!.run;
      for (let index = 0; index < rerolls; index += 1) run = reroll(run, randomOf(run, 'shop', Math.random));
      return nextRound(run);
    };
    const plain = settled(0);
    const rerolled = settled(3);
    expect(rerolled.drawCount).toBe(plain.drawCount + 3);
    const grid = (run: RunState): readonly number[] => spin(run, randomOf(run, 'spin', Math.random))!.outcome.grid;
    expect(grid(rerolled)).toEqual(grid(plain));
  });

  it('가게에 나오는 부적도 씨앗과 뽑은 차례로 정해지고, 다시 뽑으면 다른 차례의 운을 쓴다', () => {
    const open = (): RunState => {
      const run: RunState = { ...newRun('오늘'), spinsLeft: 0, coin: 999 };
      return settleRound(run, randomOf(run, 'shop', Math.random))!.run;
    };
    expect(open().shop?.offers).toEqual(open().shop?.offers);
    const once = reroll(open(), randomOf(open(), 'shop', Math.random));
    expect(once.shop?.offers).toEqual(reroll(open(), randomOf(open(), 'shop', Math.random)).shop?.offers);
    expect(once.drawCount).toBe(2);
  });

  it('판의 상태만 있으면 이어서 같은 운이 나온다(저장했다가 이어 하는 판)', () => {
    let run = newRun('오늘');
    for (let index = 0; index < 3; index += 1) run = spin(run, randomOf(run, 'spin', Math.random))!.run;
    const restored = JSON.parse(JSON.stringify(run)) as RunState;
    expect(restored).toEqual(run);
    expect(spin(restored, randomOf(restored, 'spin', Math.random))!.outcome.grid).toEqual(
      spin(run, randomOf(run, 'spin', Math.random))!.outcome.grid,
    );
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
    // 자리도 없고 금화도 모자라면 금화부터 알린다. 자리부터 알리면 부적을 떼고 나서야 살 수 없는 줄 알게 된다.
    const fullAndPoor = { ...full, coin: charmOf('wide')!.price - 1 };
    expect(buyBlock(fullAndPoor, 0)).toBe('coin');
    expect(buy(fullAndPoor, 0)).toBe(fullAndPoor);
    // 한 장을 떼면 살 수 있다.
    const freed = discard(full, 2);
    expect(freed.charms).toEqual(['twins', 'crown', 'extra', 'comfort']);
    // 뗀 부적의 값은 얼마쯤 돌려받는다(upgrade.test.ts).
    expect(freed.coin).toBe(99 + refundOf('piggy'));
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
    expect(next).toMatchObject({ phase: 'spin', round: 4, spinsLeft: BASE_SPINS + 3, coin: 4, shop: null });
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
// 숫자를 고칠 때는 이 아래의 테스트가 말하는 뜻(얼마나 가는지, 죽은 부적이 없는지)을 지키게 맞춘다.

/**
 * 셈하지 않는 사람이 잠글 열. 맞은 세로줄이 있으면 그 가운데 가장 비싼 것을 잠그고,
 * 없으면 아끼다가 스핀이 두 번 남았을 때부터 7이 가장 많이 든 열을 잠근다. 잠글 것이 없으면 null.
 * 막판 한 방을 붙였으면 마지막 스핀에 쓰려고 아낀다.
 */
function holdFor(run: RunState): number | null {
  const grid = run.lastGrid;
  if (!canHold(run) || !grid) return null;
  const saving = run.charms.some((id) => charmOf(id)?.effect.lastTimes !== undefined);
  if (saving && run.spinsLeft > 1) return null;
  let best: number | null = null;
  let bestWorth = 0;
  for (let column = 0; column < SIZE; column += 1) {
    const line = LINES[SIZE + column];
    const made = lineSymbol(grid, line);
    const sevens = line.cells.filter((cell) => grid[cell] === WILD).length;
    const worth = (made === null ? 0 : 10 + SYMBOLS[made].value) + sevens * 4;
    if (worth > bestWorth) {
      best = column;
      bestWorth = worth;
    }
  }
  if (bestWorth >= 10) return best;
  return run.spinsLeft <= 2 && bestWorth >= 4 ? best : null;
}

/** 스핀이 남은 동안 돌린다(열도 잠근다). */
function spinOut(run: RunState, random: () => number): RunState {
  let next = run;
  while (next.spinsLeft > 0) next = spin(next, random, holdFor(next))!.run;
  return next;
}

/** 붙인 부적으로 라운드 하나에서 버는 금화의 평균 */
function averageRound(charms: readonly string[], rounds: number, random: () => number): number {
  let total = 0;
  for (let n = 0; n < rounds; n += 1) {
    total += spinOut({ ...newRun(), charms: [...charms], spinsLeft: spinsOf(charms) }, random).earned;
  }
  return total / rounds;
}

/** 가게에서 shop이 고른 대로 사면서 판이 끝날 때까지 한다. */
function playRun(random: () => number, shop: (run: RunState) => RunState, start: RunState = newRun()): RunState {
  let run = start;
  for (let guard = 0; guard < 200; guard += 1) {
    const settled = settleRound(spinOut(run, random), random)!;
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

/** 여러 판을 해서 넘긴 라운드의 수를 작은 것부터 늘어놓는다. start를 주면 판마다 그 판에서 시작한다(해금이나 유물을 켠 판). */
function roundsOf(
  runs: number,
  seed: number,
  shop: (run: RunState) => RunState,
  start: () => RunState = newRun,
): number[] {
  return runsOf(runs, seed, shop, start)
    .map((run) => clearedRounds(run))
    .sort((a, b) => a - b);
}

/** 여러 판을 끝까지 한다. */
function runsOf(runs: number, seed: number, shop: (run: RunState) => RunState, start: () => RunState = newRun): RunState[] {
  const random = seeded(seed);
  const done: RunState[] = [];
  for (let n = 0; n < runs; n += 1) done.push(playRun(random, shop, start()));
  return done;
}

const middleOf = (sorted: readonly number[]): number => sorted[Math.floor(sorted.length / 2)];

/**
 * 부적마다 잘 맞는 자리: 이 부적들에 붙였을 때 제 몫을 한다.
 * 듬뿍과 황금은 같은 그림끼리 짝이고, 나머지는 여기 적은 조합이 제자리다. 부적을 더하면 여기에도 적어야 한다.
 */
const HOMES: Readonly<Record<string, readonly string[]>> = {
  'more-cherry': ['gold-cherry'],
  'more-clover': ['gold-clover'],
  'more-bell': ['gold-bell'],
  'more-horseshoe': ['gold-horseshoe'],
  'more-diamond': ['gold-diamond'],
  'gold-cherry': ['more-cherry'],
  'gold-clover': ['more-clover'],
  'gold-bell': ['more-bell'],
  'gold-horseshoe': ['more-horseshoe'],
  'gold-diamond': ['more-diamond'],
  'more-seven': ['middle', 'slant'],
  middle: ['more-seven', 'slant'],
  'less-cherry': ['more-bell', 'gold-bell'],
  'less-clover': ['more-bell', 'gold-bell'],
  wide: [],
  tall: [],
  slant: ['more-seven', 'middle'],
  extra: [],
  piggy: [],
  comfort: [],
  twins: ['more-cherry', 'gold-cherry'],
  crown: ['more-cherry', 'gold-cherry', 'twins'],
  finale: ['more-diamond', 'gold-diamond'],
  rebound: ['more-diamond', 'gold-diamond'],
};

/**
 * 살 수 있는 것을 보이는 대로 사고, 남는 금화로는 붙여 둔 것을 앞에서부터 강화하는 사람.
 * 다음 라운드의 목표를 낼 금화는 남겨 둔다(그것까지 털어 강화하면 강화하지 않느니만 못하다).
 */
function buyAndUpgradeAnything(run: RunState): RunState {
  let next = buyAnything(run);
  const keep = targetFor(next, next.round + 1);
  for (let slot = 0; slot < next.charms.length; slot += 1) {
    if (next.coin - upgradeCostOf(next.charms[slot], next) >= keep) next = upgrade(next, slot);
  }
  return next;
}

/** 조합의 부적을 모두 강화한 것 */
const allUpgraded = (charms: readonly string[]): string[] => charms.map((id) => upgradedOf(id));

/**
 * 자동 플레이로 찾은, 끝까지 들고 가는 센 조합들(강화하기 전의 것). 쌍둥이 줄이 든 것과 들지 않은 것을 따로 적는다.
 * 부적의 숫자를 고쳐서 센 조합이 바뀌면 여기도 고친다.
 */
const STRONG_WITHOUT_TWINS: readonly (readonly string[])[] = [
  ['more-diamond', 'gold-diamond', 'slant', 'finale', 'rebound'],
  ['more-cherry', 'gold-cherry', 'less-clover', 'crown', 'finale'],
  ['more-cherry', 'gold-cherry', 'slant', 'crown', 'finale'],
  ['more-clover', 'gold-clover', 'less-cherry', 'crown', 'finale'],
  ['more-horseshoe', 'gold-horseshoe', 'slant', 'finale', 'rebound'],
  ['more-diamond', 'gold-diamond', 'slant', 'extra', 'rebound'],
  ['more-bell', 'gold-bell', 'less-cherry', 'less-clover', 'crown'],
  ['more-horseshoe', 'gold-horseshoe', 'less-cherry', 'less-clover', 'crown'],
];
const STRONG_WITH_TWINS: readonly (readonly string[])[] = [
  ['more-diamond', 'gold-diamond', 'wide', 'twins', 'rebound'],
  ['more-horseshoe', 'gold-horseshoe', 'twins', 'finale', 'rebound'],
  ['more-diamond', 'gold-diamond', 'extra', 'twins', 'rebound'],
];

describe('밸런스', () => {
  it('부적 없이도 첫 라운드는 거의 언제나 넘긴다', () => {
    const rounds = roundsOf(2_000, 101, (state) => state);
    expect(rounds.filter((cleared) => cleared === 0).length / rounds.length).toBeLessThan(0.02);
  });

  it('부적을 하나도 사지 않으면 열을 잠가도 너덧 라운드에서 끝난다', () => {
    const rounds = roundsOf(1_000, 102, (state) => state);
    const median = rounds[Math.floor(rounds.length / 2)];
    expect(median).toBeGreaterThanOrEqual(4);
    expect(median).toBeLessThanOrEqual(6);
    expect(rounds[rounds.length - 1]).toBeLessThanOrEqual(8);
  });

  it('보이는 대로 사기만 해도 사지 않는 것보다 멀리 가지만, 고르지 않으면 열 라운드를 넘기기 어렵다', () => {
    const none = roundsOf(1_000, 103, (state) => state);
    const any = roundsOf(1_000, 103, buyAnything);
    const median = any[Math.floor(any.length / 2)];
    expect(median).toBeGreaterThan(none[Math.floor(none.length / 2)]);
    expect(median).toBeGreaterThanOrEqual(6);
    expect(median).toBeLessThanOrEqual(8);
    expect(any[Math.floor(any.length * 0.9)]).toBeLessThanOrEqual(11);
  }, 60_000);

  it('고르지 않고 남는 금화로 강화까지 닥치는 대로 해도 판은 거의 그대로다', () => {
    const any = roundsOf(1_000, 108, buyAnything);
    const both = roundsOf(1_000, 108, buyAndUpgradeAnything);
    const median = both[Math.floor(both.length / 2)];
    expect(median).toBeGreaterThanOrEqual(any[Math.floor(any.length / 2)] - 1);
    expect(median).toBeLessThanOrEqual(any[Math.floor(any.length / 2)] + 1);
    expect(both[Math.floor(both.length * 0.9)]).toBeLessThanOrEqual(11);
  }, 60_000);

  it('부적마다 값어치가 있다: 혼자 붙여도 평균 벌이가 줄지 않는다', () => {
    const base = averageRound([], 4_000, seeded(104));
    for (const charm of CHARMS) {
      // 저금통은 벌이가 아니라 남은 금화에 듣는다.
      if (charm.effect.savingsCap !== undefined) continue;
      expect(averageRound([charm.id], 4_000, seeded(104)), charm.id).toBeGreaterThan(base);
    }
  }, 60_000);

  it('죽은 부적이 없다: 어느 부적이든 제자리에 붙이면 벌이가 넷에 하나는 는다', () => {
    const rounds = 3_000;
    for (const charm of CHARMS) {
      const home = HOMES[charm.id];
      expect(home, charm.id).toBeDefined();
      if (charm.effect.savingsCap !== undefined) {
        // 저금통은 남긴 금화의 넷에 하나를 넘게 얹어 준다(한도 안에서).
        expect(savingsFor(30, [charm.id]) / 30, charm.id).toBeGreaterThan(0.25);
        continue;
      }
      const without = averageRound(home, rounds, seeded(106));
      const withIt = averageRound([...home, charm.id], rounds, seeded(106));
      expect(withIt / without, charm.id).toBeGreaterThan(1.25);
    }
  }, 60_000);

  it('강화하는 값은 가운데 라운드에 남는 금화로 치를 만한 크기다', () => {
    const costs = CHARMS.map((charm) => upgradeCostOf(charm.id));
    for (const charm of CHARMS) {
      // 새 부적보다 열 배는 넘게 비싸다: 자리가 남았을 때는 새 부적을 사는 쪽이 싸다.
      expect(upgradeCostOf(charm.id), charm.id).toBeGreaterThanOrEqual(charm.price * 10);
    }
    // 첫 서너 라운드에는 엄두를 내기 어렵다: 가장 싼 강화도 다섯째 라운드의 목표보다 비싸다.
    expect(Math.min(...costs)).toBeGreaterThan(targetOf(5));
    // 가운데 라운드에는 손이 닿는다: 가장 비싼 강화도 아홉째 라운드의 목표보다 싸다.
    expect(Math.max(...costs)).toBeLessThan(targetOf(9));
    // 다섯 장을 다 강화하려면 여러 라운드에 걸쳐 모아야 한다.
    for (const charms of [...STRONG_WITHOUT_TWINS, ...STRONG_WITH_TWINS]) {
      const all = charms.reduce((sum, id) => sum + upgradeCostOf(id), 0);
      expect(all, charms.join(' ')).toBeGreaterThan(targetOf(9));
      expect(all, charms.join(' ')).toBeLessThan(targetOf(12));
    }
  });

  it('강화는 제 몫을 하지만 꼭 해야 하는 강화는 없고, 같은 금화로는 새 부적이 더 번다', () => {
    const rounds = 4_000;
    for (const charm of CHARMS) {
      const home = HOMES[charm.id];
      const strong = upgradedOf(charm.id);
      if (charm.effect.savingsCap !== undefined) {
        expect(savingsFor(1000, [strong]), charm.id).toBeGreaterThan(savingsFor(1000, [charm.id]));
        continue;
      }
      const without = averageRound(home, rounds, seeded(109));
      const withIt = averageRound([...home, charm.id], rounds, seeded(109));
      const withStrong = averageRound([...home, strong], rounds, seeded(109));
      // 강화하면 벌이가 스물에 하나는 넘게 늘지만 한 배 반까지는 늘지 않는다.
      expect(withStrong / withIt, charm.id).toBeGreaterThan(1.05);
      expect(withStrong / withIt, charm.id).toBeLessThan(1.5);
      // 금화 한 개마다 느는 벌이는 새로 붙일 때가 강화할 때보다 크다.
      expect((withStrong - withIt) / upgradeCostOf(charm.id), charm.id).toBeLessThan((withIt - without) / charm.price);
    }
  }, 60_000);

  it('쌍둥이 줄은 여러 길 가운데 하나다: 없이도 센 조합이 여럿이고, 넣은 조합도 뒤지지 않는다', () => {
    const average = (charms: readonly string[]): number => averageRound(allUpgraded(charms), 6_000, seeded(107));
    const withTwins = Math.max(...STRONG_WITH_TWINS.map(average));
    const without = STRONG_WITHOUT_TWINS.map(average);
    // 쌍둥이 줄 없이도 그만큼 버는 조합이 셋은 넘는다.
    expect(without.filter((earned) => earned > withTwins * 0.9).length).toBeGreaterThanOrEqual(3);
    // 쌍둥이 줄을 넣은 조합이 가장 센 조합보다 한참 처지지도, 한참 앞서지도 않는다.
    expect(withTwins / Math.max(...without)).toBeGreaterThan(0.85);
    expect(withTwins / Math.max(...without)).toBeLessThan(1.15);
    // 쌍둥이 줄과 왕관은 맡는 줄의 수가 달라서, 함께 붙여도 곱이 겹쳐 터지지 않는다.
    const cherry = ['more-cherry', 'gold-cherry', 'less-clover'];
    const both = average([...cherry, 'twins', 'crown']) / average(cherry);
    const each = (average([...cherry, 'twins']) / average(cherry)) * (average([...cherry, 'crown']) / average(cherry));
    expect(both).toBeLessThan(each);
  }, 60_000);

  it('다섯 장을 다 강화하면 벌이가 두 배를 넘지만 다섯 배까지는 아니다', () => {
    for (const charms of [...STRONG_WITHOUT_TWINS, ...STRONG_WITH_TWINS]) {
      const plain = averageRound(charms, 4_000, seeded(110));
      const strong = averageRound(allUpgraded(charms), 4_000, seeded(110));
      expect(strong / plain, charms.join(' ')).toBeGreaterThan(2);
      expect(strong / plain, charms.join(' ')).toBeLessThan(5);
    }
  }, 60_000);

  it('영구 해금을 다 켜도 판이 두어 라운드 더 갈 뿐이다', () => {
    const perked = (): RunState => newRun(null, PERK_IDS);
    // 사지 않는 사람: 두둑한 시작과 잠그기 한 번 더만 듣는다.
    const none = roundsOf(1_000, 111, (state) => state);
    const noneWith = roundsOf(1_000, 111, (state) => state, perked);
    expect(middleOf(noneWith)).toBeGreaterThanOrEqual(middleOf(none));
    expect(middleOf(noneWith)).toBeLessThanOrEqual(middleOf(none) + 1);
    // 닥치는 대로 사고 강화하는 사람: 여섯째 자리까지 듣는다.
    const any = roundsOf(1_000, 112, buyAndUpgradeAnything);
    const anyWith = roundsOf(1_000, 112, buyAndUpgradeAnything, perked);
    expect(middleOf(anyWith)).toBeGreaterThanOrEqual(middleOf(any));
    expect(middleOf(anyWith)).toBeLessThanOrEqual(middleOf(any) + 2);
  }, 60_000);

  it('유물을 다 올려도 판은 거의 그대로다: 한 라운드를 넘게 더 가지 않고, 점수는 조금만 는다', () => {
    const full: RelicLevels = Object.fromEntries(RELIC_IDS.map((id) => [id, RELIC_MAX]));
    const score = (runs: readonly RunState[]): number => runs.reduce((sum, run) => sum + scoreOf(run), 0) / runs.length;
    const rounds = (runs: readonly RunState[]): number[] => runs.map((run) => clearedRounds(run)).sort((a, b) => a - b);
    const plain = runsOf(1_500, 113, buyAndUpgradeAnything);
    const blessed = runsOf(1_500, 113, buyAndUpgradeAnything, () => newRun(null, [], full));
    expect(middleOf(rounds(blessed))).toBeGreaterThanOrEqual(middleOf(rounds(plain)));
    expect(middleOf(rounds(blessed))).toBeLessThanOrEqual(middleOf(rounds(plain)) + 1);
    // 도움은 되지만(0은 아니다) 판을 바꿀 만큼은 아니다.
    expect(score(blessed) / score(plain)).toBeGreaterThan(1);
    expect(score(blessed) / score(plain)).toBeLessThan(1.3);
  }, 60_000);

  it('가장 센 조합으로도 판은 끝나고, 점수는 랭킹이 받는 범위 안이다', () => {
    // 자동 플레이로 찾은 가장 센 조합들을 처음부터 모두 강화해서 거저 붙여 준다.
    const random = seeded(105);
    let far = 0;
    let top = 0;
    for (const plain of [...STRONG_WITHOUT_TWINS, ...STRONG_WITH_TWINS]) {
      const charms = allUpgraded(plain);
      for (let n = 0; n < 120; n += 1) {
        const run = playRun(random, (state) => state, { ...newRun(), charms: [...charms], spinsLeft: spinsOf(charms) });
        far = Math.max(far, clearedRounds(run));
        top = Math.max(top, scoreOf(run));
        expect(run.phase, charms.join(' ')).toBe('over');
        expect(clearedRounds(run), charms.join(' ')).toBeLessThanOrEqual(20);
        expect(scoreOf(run)).toBeLessThan(MAX_SCORE / 10);
      }
    }
  }, 60_000);
});
