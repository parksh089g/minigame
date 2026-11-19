import { describe, expect, it } from 'vitest';
import { seededRandom } from '../../core/stages';
import { affectsPrize, expectedRound, expectedSpin, PRIZE_PREVIEW_IDS, spinExpect } from './expected';
import {
  CELLS,
  centerWildOf,
  CHARMS,
  CENTER,
  HOLDS_PER_ROUND,
  lineSymbol,
  LINES,
  newRun,
  oddsOf,
  rollGrid,
  scoreSpin,
  spin,
  spinsOf,
  upgradedOf,
  type RunState,
} from './rules';

/** 평균과 그 표준 오차 */
function meanOf(samples: Float64Array): { mean: number; error: number } {
  let sum = 0;
  for (const value of samples) sum += value;
  const mean = sum / samples.length;
  let square = 0;
  for (const value of samples) square += (value - mean) ** 2;
  return { mean, error: Math.sqrt(square / (samples.length - 1) / samples.length) };
}

/** 규칙(rollGrid와 scoreSpin)으로 그 자리의 스핀을 count번 돌려 받은 금화들 */
function simulateSpins(
  charms: readonly string[],
  count: number,
  seed: string,
  spot: { last: boolean; afterMiss: boolean } = { last: false, afterMiss: false },
): Float64Array {
  const random = seededRandom(seed);
  const samples = new Float64Array(count);
  for (let index = 0; index < count; index += 1) samples[index] = scoreSpin(rollGrid(charms, random), charms, spot).total;
  return samples;
}

/** 규칙의 spin으로(잠그지 않고) 한 라운드를 다 돌려 받은 금화들. 라운드마다 꽝 다음인지는 새로 시작한다. */
function simulateRounds(charms: readonly string[], count: number, seed: string): Float64Array {
  const random = seededRandom(seed);
  const samples = new Float64Array(count);
  const start: RunState = { ...newRun(), charms: [...charms], spinsLeft: spinsOf(charms), holdsLeft: HOLDS_PER_ROUND };
  for (let index = 0; index < count; index += 1) {
    let run = start;
    let earned = 0;
    for (let step = spin(run, random); step; step = spin(run, random)) {
      earned += step.outcome.total;
      run = step.run;
    }
    samples[index] = earned;
  }
  return samples;
}

/** 아홉 칸을 모두 펼쳐 셈한 한 스핀의 기댓값. 규칙의 lineSymbol과 LINES로 줄을 보고, 줄의 수와 상금을 따로 모아 둔다. */
function bruteTable(charms: readonly string[]): { chance: number[]; base: number[][] } {
  const odds = oddsOf(charms);
  const wild = centerWildOf(charms);
  const middle = odds.map((chance, symbol) => (1 - wild) * chance + (symbol === 5 ? wild : 0));
  // chance[n]: n줄 맞을 확률, base[n][line * 6 + symbol]: n줄 맞은 판에서 그 줄이 그 그림으로 맞을 확률
  const chance = new Array<number>(LINES.length + 1).fill(0);
  const base = Array.from({ length: LINES.length + 1 }, () => new Array<number>(LINES.length * 6).fill(0));
  const grid = new Array<number>(CELLS).fill(0);
  const hits: number[] = [];
  for (let code = 0; code < 6 ** CELLS; code += 1) {
    let rest = code;
    let weight = 1;
    for (let cell = 0; cell < CELLS; cell += 1) {
      const symbol = rest % 6;
      rest = (rest - symbol) / 6;
      grid[cell] = symbol;
      weight *= cell === CENTER ? middle[symbol] : odds[symbol];
    }
    hits.length = 0;
    for (let index = 0; index < LINES.length; index += 1) {
      const symbol = lineSymbol(grid, LINES[index]);
      if (symbol !== null) hits.push(index * 6 + symbol);
    }
    chance[hits.length] += weight;
    for (const hit of hits) base[hits.length][hit] += weight;
  }
  return { chance, base };
}

/** 펼쳐 셈한 표로, 그 부적들의 한 스핀의 기댓값을 scoreSpin과 같은 셈으로 낸다(같은 무게를 쓰는 부적끼리 표를 나눠 쓴다). */
function bruteSpin(table: { chance: number[]; base: number[][] }, charms: readonly string[]): number {
  // 줄과 그림을 하나씩 맞춘 판을 scoreSpin에 넣어 그 줄의 상금을 얻는다.
  const lineAmount = (line: number, symbol: number): number => {
    const grid = Array.from({ length: CELLS }, (_, cell): number => ((cell + line) % 2 === 0 ? 0 : 1));
    for (const cell of LINES[line].cells) grid[cell] = symbol;
    const outcome = scoreSpin(grid, charms, { last: false, afterMiss: false });
    return outcome.wins.find((win) => win.line === line)?.amount ?? 0;
  };
  // 맞은 줄의 수에 따른 곱: 그만큼의 줄이 맞은 판을 몰라도, 상금 1인 줄이 n개 맞았다고 치고 곱만 얻는다.
  const parts = spinExpect(charms);
  let sum = table.chance[0] * parts.consolation;
  for (let hits = 1; hits <= LINES.length; hits += 1) {
    let base = 0;
    table.base[hits].forEach((weight, at) => {
      if (weight > 0) base += weight * lineAmount(Math.floor(at / 6), at % 6);
    });
    if (base > 0) sum += base * comboTimes(charms, hits);
  }
  return sum;
}

/** n줄이 맞은 스핀에 붙는 곱(잭팟, 왕관, 쌍둥이 줄). 꼭 n줄이 맞는 판을 찾아 scoreSpin의 boosts에서 읽는다. */
function comboTimes(charms: readonly string[], hits: number): number {
  // 체리, 클로버, 7만으로 칠한 판들 가운데에서 찾는다.
  const paints = [0, 1, 5];
  for (let code = 0; code < 3 ** CELLS; code += 1) {
    let rest = code;
    const grid = Array.from({ length: CELLS }, () => {
      const paint = paints[rest % 3];
      rest = Math.floor(rest / 3);
      return paint;
    });
    if (LINES.filter((line) => lineSymbol(grid, line) !== null).length !== hits) continue;
    const outcome = scoreSpin(grid, charms, { last: false, afterMiss: false });
    return outcome.boosts.reduce((product, boost) => product * boost.times, 1);
  }
  throw new Error(`${hits}줄이 맞는 판이 없다`);
}

describe('한 스핀의 기댓값', () => {
  it('아홉 칸을 모두 펼쳐 셈한 값과 같다(같은 무게를 쓰는 여러 부적 조합)', () => {
    const plain = bruteTable([]);
    const sets = [
      [],
      ['gold-cherry', 'wide', 'crown'],
      ['gold-diamond+++', 'slant++', 'twins+', 'comfort'],
      ['tall', 'gold-bell', 'twins', 'crown+', 'gold-horseshoe'],
      ['comfort+++', 'finale', 'rebound', 'extra'],
    ];
    for (const charms of sets) expect(Math.abs(expectedSpin(charms) / bruteSpin(plain, charms) - 1), charms.join(',')).toBeLessThan(1e-9);
  }, 120_000);

  it('그림의 무게나 가운데 7이 바뀌어도 펼쳐 셈한 값과 같다', () => {
    const charms = ['more-seven+', 'less-cherry', 'middle', 'wide', 'crown'];
    expect(Math.abs(expectedSpin(charms) / bruteSpin(bruteTable(charms), charms) - 1)).toBeLessThan(1e-9);
  }, 120_000);

  it('규칙으로 오래 돌린 평균과 오차 안에서 같다', () => {
    const sets = [
      [],
      ['more-cherry', 'gold-cherry'],
      ['more-seven', 'middle', 'crown'],
      ['less-clover+', 'slant', 'twins++', 'comfort'],
      ['middle+++', 'tall+', 'gold-diamond'],
    ];
    for (const charms of sets) {
      const { mean, error } = meanOf(simulateSpins(charms, 120_000, `spin:${charms.join(',')}`));
      const expected = expectedSpin(charms);
      expect(Math.abs(mean - expected), `${charms.join(',')}: ${mean} ± ${error} / ${expected}`).toBeLessThan(4.5 * error);
      // 오차가 기댓값의 몇 퍼센트 안쪽이라 이 견줌이 뜻이 있다.
      expect(error / expected).toBeLessThan(0.03);
    }
  }, 120_000);

  it('마지막 스핀과 꽝 다음 스핀의 곱도 규칙과 같다', () => {
    const charms = ['finale', 'rebound+', 'gold-bell'];
    for (const spot of [
      { last: true, afterMiss: false },
      { last: false, afterMiss: true },
      { last: true, afterMiss: true },
    ]) {
      const { mean, error } = meanOf(simulateSpins(charms, 100_000, `spot:${spot.last}:${spot.afterMiss}`, spot));
      const expected = expectedSpin(charms, spot);
      expect(Math.abs(mean - expected), `${JSON.stringify(spot)}: ${mean} ± ${error} / ${expected}`).toBeLessThan(4.5 * error);
    }
    expect(expectedSpin(charms, { last: true })).toBeGreaterThan(expectedSpin(charms));
  }, 120_000);
});

describe('한 라운드의 기댓값', () => {
  it('규칙의 spin으로 라운드를 오래 돌린 평균과 오차 안에서 같다', () => {
    const sets = [
      [],
      ['extra'],
      ['extra+++', 'finale', 'rebound'],
      ['rebound++', 'less-cherry', 'comfort'],
      ['finale+', 'more-seven', 'twins'],
    ];
    for (const charms of sets) {
      const { mean, error } = meanOf(simulateRounds(charms, 30_000, `round:${charms.join(',')}`));
      const expected = expectedRound(charms);
      expect(Math.abs(mean - expected), `${charms.join(',')}: ${mean} ± ${error} / ${expected}`).toBeLessThan(4.5 * error);
    }
  }, 120_000);

  it('덤 스핀이 없고 곱도 없으면 한 스핀의 기댓값에 스핀의 수를 곱한 것이다', () => {
    for (const charms of [[], ['wide', 'gold-bell'], ['more-seven', 'crown']]) {
      expect(expectedRound(charms)).toBeCloseTo(expectedSpin(charms) * spinsOf(charms), 10);
    }
    expect(expectedRound(['extra'])).toBeCloseTo(expectedSpin(['extra']) * spinsOf(['extra']), 10);
    expect(expectedRound(['extra'])).toBeGreaterThan(expectedRound([]));
  });
});

describe('같은 값을 빨리', () => {
  it('언제 몇 번을 셈해도 똑같은 값이 나온다', () => {
    const sets = CHARMS.map((charm) => [charm.id, 'more-cherry']);
    const first = sets.map((charms) => expectedRound(charms));
    // 기억해 둔 표가 넘쳐 비워진 뒤에 다시 셈해도 같다.
    for (let step = 0; step < 80; step += 1) expectedSpin([], {}, { weights: [30 + step, 25, 19, 13, 8, 5] });
    expect(sets.map((charms) => expectedRound(charms))).toEqual(first);
  });

  it('가게를 한 번 열 때의 셈(붙인 부적과 처음 보는 확률 부적 세 장)이 50ms보다 훨씬 빠르다', () => {
    // 아직 셈한 적 없는 무게가 되도록 강화한 확률 부적을 섞는다.
    const owned = ['more-bell++', 'less-clover+', 'slant'];
    const offers = ['more-cherry++', 'more-diamond+', 'middle++'];
    const start = performance.now();
    const values = [expectedRound(owned), ...offers.map((id) => expectedRound([...owned, id]))];
    const spent = performance.now() - start;
    expect(values.every((value) => value > 0)).toBe(true);
    expect(spent).toBeLessThan(50);
  });
});

describe('셈에 넣는 것들', () => {
  it('저금통만 상금으로 셈할 수 없고, 나머지 부적은 모두 셈한다', () => {
    expect(CHARMS.filter((charm) => !affectsPrize(charm.id)).map((charm) => charm.id)).toEqual(['piggy']);
    expect(PRIZE_PREVIEW_IDS).toHaveLength(CHARMS.length - 1);
    expect(affectsPrize('piggy+++')).toBe(false);
    expect(affectsPrize('no-such-charm')).toBe(false);
    expect(expectedRound(['piggy+'])).toBe(expectedRound([]));
  });

  it('부적마다 강화하면 기댓값이 오르거나(덜기·듬뿍은 짝에 따라) 바뀐다', () => {
    for (const charm of CHARMS) {
      if (!affectsPrize(charm.id)) continue;
      expect(expectedRound([upgradedOf(charm.id)]), charm.id).not.toBe(expectedRound([charm.id]));
      if (charm.kind !== 'odds') expect(expectedRound([upgradedOf(charm.id)]), charm.id).toBeGreaterThan(expectedRound([charm.id]));
    }
  });

  it('context로 준 값이 부적에서 셈한 값을 대신한다', () => {
    // 7 듬뿍과 가운데 7은 7 세트의 두 장이라 세트의 덤(7의 무게 +2)까지 들어서 7의 무게는 13이다.
    const charms = ['more-seven', 'gold-bell', 'tall', 'middle'];
    const parts = spinExpect(charms);
    expect(expectedSpin([], {}, { weights: [30, 25, 19, 13, 8, 13], values: [2, 3, 11, 8, 12, 20], lineTimes: { row: 1, col: 2, diag: 1 }, centerWild: 0.35 })).toBeCloseTo(
      expectedSpin(charms),
      10,
    );
    // 맞은 줄의 수에 따른 곱을 모든 줄에 두 배로 주면 맞은 판의 몫이 두 배가 된다.
    const doubled = spinExpect(charms, { linesTimes: () => 2 });
    expect(doubled.win).toBeCloseTo(parts.win * 2, 10);
    expect(spinExpect(charms, { spins: 9 }).spins).toBe(9);
    expect(expectedRound(charms, { spins: 9 })).toBeCloseTo(expectedSpin(charms) * 9, 10);
    expect(spinExpect(charms, { consolation: 3 }).consolation).toBe(parts.consolation + 3);
  });
});
