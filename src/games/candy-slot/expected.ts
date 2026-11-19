/**
 * 행운 슬롯에서 한 라운드에 받을 금화의 기댓값. 가게에서 부적을 사거나 강화하면 상금이 평균으로 얼마나 바뀌는지
 * 미리 보여 줄 때 쓴다. 화면과 분리된 순수 함수이고, 난수를 쓰지 않아서 같은 부적이면 언제나 같은 값이 나온다.
 *
 * 규칙(rules.ts)의 rollGrid와 scoreSpin을 그대로 따른다:
 * - 테두리의 여덟 칸은 weightsOf로 따로따로 뽑고, 가운데 칸은 centerWildOf의 확률로 7이 되며 아니면 같은 무게로 뽑는다.
 * - 여덟 줄마다 lineSymbol로 맞았는지 보고, 맞으면 그림의 상금(valuesOf)에 줄의 갈래의 곱(lineTimesOf)을 곱해 더한다.
 * - 여덟 줄이 다 맞으면 JACKPOT_TIMES, 맞은 줄의 수에 따라 왕관과 쌍둥이 줄의 곱, 마지막 스핀이면 막판 한 방,
 *   꽝 다음이면 오뚝이의 곱이 붙는다(한 줄이라도 맞았을 때만). 꽝이면 MISS_COIN과 위로 금화를 받는다.
 * 사람이 고르는 열 잠그기는 넣지 않는다(잠그지 않고 돌린다고 친다).
 *
 * 9칸을 다 펼치면 6^9(약 천만) 가지라 가게를 열 때마다 셈하기에는 느리다. 그래서 이렇게 줄인다:
 * 1. 가운데 칸과 네 귀퉁이를 정하면 두 대각선이 정해지고, 남은 네 변의 칸은 위아래 한 쌍(1, 7번 칸: 윗줄, 아랫줄,
 *    가운데 세로줄)과 좌우 한 쌍(3, 5번 칸: 왼줄, 오른줄, 가운데 가로줄)으로 나뉘어 서로 상관이 없다.
 *    그래서 쌍마다 36가지를 따로 펼친 뒤, 맞은 줄의 수로 둘을 합친다.
 * 2. 테두리의 칸들은 모두 같은 무게로 뽑으므로 판을 돌리거나 뒤집어도 확률이 같다. 줄을 세 무리(테두리의 네 줄,
 *    가운데를 지나는 가로·세로 두 줄, 대각선 두 줄)로 묶어 무리마다 더해 두면, 네 귀퉁이는 돌리고 뒤집어 같아지는
 *    것끼리 하나만(1296가지 대신 231가지) 셈하면 된다.
 * 3. 무리마다 "어느 그림으로 몇 줄 맞았는지"를 맞은 줄의 수별로 모아 두면, 상금과 줄의 곱은 마지막에 곱하기만 하면 된다.
 *    그래서 펼치는 셈은 그림의 무게나 가운데 7이 바뀔 때만 다시 하고(그것도 기억해 둔다), 상금·줄·재주 부적은 거의 공짜다.
 */
import {
  centerWildOf,
  CHARMS,
  charmOf,
  JACKPOT_TIMES,
  LINES,
  lineTimesOf,
  MISS_COIN,
  spinsOf,
  SYMBOLS,
  valuesOf,
  weightsOf,
  WILD,
  type CharmEffect,
  type LineKind,
} from './rules';

const KINDS = SYMBOLS.length;
const ALL_LINES = LINES.length;

/**
 * 부적에서 셈한 값 대신(또는 그 위에) 쓸 것. 라운드마다 붙는 변화나 부적 세트의 덤처럼, 부적 밖에서 그림의 무게나
 * 상금, 줄의 곱, 스핀의 수를 바꾸는 것이 생기면 여기로 넣는다. 적지 않은 것은 부적에서 셈한다.
 */
export interface ExpectContext {
  /** 그림마다의 무게(weightsOf 대신) */
  weights?: readonly number[];
  /** 그림마다의 상금(valuesOf 대신) */
  values?: readonly number[];
  /** 줄의 갈래마다의 곱(lineTimesOf 대신) */
  lineTimes?: Readonly<Record<LineKind, number>>;
  /** 가운데 칸이 7로 나올 확률(centerWildOf 대신) */
  centerWild?: number;
  /** 라운드의 스핀 수(spinsOf 대신) */
  spins?: number;
  /** 한 줄이라도 맞은 스핀의 상금에 맞은 줄의 수(1~8)에 따라 더 곱하는 값. 없으면 1이다. */
  linesTimes?: (lines: number) => number;
  /** 꽝일 때 더 받는 금화(부적의 위로 금화에 더한다) */
  consolation?: number;
}

/**
 * 한 번 돌렸을 때 맞은 줄의 수(0~8)별로 모은 것. 그림의 무게와 가운데 7의 확률에만 달려 있다.
 * groups[n][g * KINDS + s]는 "맞은 줄이 n개이고, 무리 g의 줄들 가운데 그림 s로 맞은 줄의 수"의 기댓값이다
 * (n개가 아닌 판에서는 0으로 친다). 무리: 0 테두리의 네 줄, 1 가운데를 지나는 가로·세로 줄, 2 대각선 두 줄.
 */
interface LineTable {
  /** 맞은 줄이 n개일 확률 */
  chance: Float64Array;
  groups: Float64Array[];
}

const GROUPS = 3;
const RIM = 0;
const MID = 1;
const DIAG = 2;

/** a, b, c 세 칸이 맞은 그림(lineSymbol과 같다). 안 맞으면 -1. [a * 36 + b * 6 + c] */
const MATCH: Int8Array = (() => {
  const table = new Int8Array(KINDS * KINDS * KINDS);
  for (let a = 0; a < KINDS; a += 1) {
    for (let b = 0; b < KINDS; b += 1) {
      for (let c = 0; c < KINDS; c += 1) {
        let symbol = -1;
        let miss = false;
        for (const here of [a, b, c]) {
          if (here === WILD) continue;
          if (symbol !== -1 && symbol !== here) miss = true;
          symbol = here;
        }
        table[(a * KINDS + b) * KINDS + c] = miss ? -1 : symbol === -1 ? WILD : symbol;
      }
    }
  }
  return table;
})();

/**
 * 네 귀퉁이(왼쪽 위, 오른쪽 위, 오른쪽 아래, 왼쪽 아래 차례)를 돌리고 뒤집어 같아지는 것끼리 묶은 대표와 그 수.
 * 무게와 상관없이 한 번만 만든다.
 */
const CORNERS: ReadonlyArray<{ corners: readonly [number, number, number, number]; count: number }> = (() => {
  const seen = new Map<number, { corners: [number, number, number, number]; count: number }>();
  const code = (list: readonly number[]): number => ((list[0] * KINDS + list[1]) * KINDS + list[2]) * KINDS + list[3];
  for (let index = 0; index < KINDS ** 4; index += 1) {
    const ring = [Math.floor(index / KINDS ** 3), Math.floor(index / KINDS ** 2) % KINDS, Math.floor(index / KINDS) % KINDS, index % KINDS];
    let best = Infinity;
    for (let turn = 0; turn < 4; turn += 1) {
      const turned = ring.map((_, at) => ring[(at + turn) % 4]);
      best = Math.min(best, code(turned), code([...turned].reverse()));
    }
    const group = seen.get(best);
    if (group) group.count += 1;
    else seen.set(best, { corners: ring as [number, number, number, number], count: 1 });
  }
  return [...seen.values()];
})();

/** 한 쌍이 맡는 줄은 테두리와 가운데를 지나는 줄뿐이라(대각선은 없다), 쌍의 줄은 앞의 두 무리만 적는다. */
const PAIR_WIDTH = 2 * KINDS;

/** 한 쌍의 칸을 펼친 것: 이 쌍이 맡은 세 줄 가운데 맞은 줄의 수(0~3)별 확률과, 무리·그림별로 맞은 줄의 수 */
interface PairSums {
  chance: Float64Array;
  /** [n * PAIR_WIDTH + g * KINDS + s] (g는 RIM이나 MID) */
  lines: Float64Array;
}

function newPair(): PairSums {
  return { chance: new Float64Array(4), lines: new Float64Array(4 * PAIR_WIDTH) };
}

/**
 * 가운데 칸을 사이에 둔 두 칸(first, second)을 펼친다. 이 쌍은 테두리의 두 줄(first가 든 줄: sideA ─ first ─ sideB,
 * second가 든 줄: sideC ─ second ─ sideD)과 가운데를 지나는 한 줄(first ─ center ─ second)을 맡는다.
 */
function fillPair(
  pair: PairSums,
  odds: Float64Array,
  sideA: number,
  sideB: number,
  sideC: number,
  sideD: number,
  center: number,
): void {
  pair.chance.fill(0);
  pair.lines.fill(0);
  for (let first = 0; first < KINDS; first += 1) {
    const near = MATCH[(sideA * KINDS + first) * KINDS + sideB];
    for (let second = 0; second < KINDS; second += 1) {
      const chance = odds[first] * odds[second];
      const far = MATCH[(sideC * KINDS + second) * KINDS + sideD];
      const mid = MATCH[(first * KINDS + center) * KINDS + second];
      const hits = (near >= 0 ? 1 : 0) + (far >= 0 ? 1 : 0) + (mid >= 0 ? 1 : 0);
      pair.chance[hits] += chance;
      const at = hits * PAIR_WIDTH;
      if (near >= 0) pair.lines[at + RIM * KINDS + near] += chance;
      if (far >= 0) pair.lines[at + RIM * KINDS + far] += chance;
      if (mid >= 0) pair.lines[at + MID * KINDS + mid] += chance;
    }
  }
}

function buildTable(weights: readonly number[], centerWild: number): LineTable {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const odds = Float64Array.from(weights, (weight) => weight / total);
  const middle = Float64Array.from(odds, (chance, symbol) => (1 - centerWild) * chance + (symbol === WILD ? centerWild : 0));
  const chance = new Float64Array(ALL_LINES + 1);
  const groups = Array.from({ length: ALL_LINES + 1 }, () => new Float64Array(GROUPS * KINDS));
  const across = newPair();
  const down = newPair();

  for (let center = 0; center < KINDS; center += 1) {
    if (middle[center] <= 0) continue;
    for (const { corners, count } of CORNERS) {
      // 칸 번호: 0 왼쪽 위, 2 오른쪽 위, 8 오른쪽 아래, 6 왼쪽 아래
      const [c0, c2, c8, c6] = corners;
      const weight = count * middle[center] * odds[c0] * odds[c2] * odds[c8] * odds[c6];
      const slash = MATCH[(c0 * KINDS + center) * KINDS + c8];
      const back = MATCH[(c2 * KINDS + center) * KINDS + c6];
      const diagHits = (slash >= 0 ? 1 : 0) + (back >= 0 ? 1 : 0);
      // 1번 칸(윗줄)과 7번 칸(아랫줄), 3번 칸(왼줄)과 5번 칸(오른줄)
      fillPair(across, odds, c0, c2, c6, c8, center);
      fillPair(down, odds, c0, c6, c2, c8, center);
      for (let a = 0; a < 4; a += 1) {
        const chanceA = across.chance[a];
        if (chanceA === 0) continue;
        for (let b = 0; b < 4; b += 1) {
          const chanceB = down.chance[b];
          if (chanceB === 0) continue;
          const hits = a + b + diagHits;
          const both = weight * chanceA * chanceB;
          chance[hits] += both;
          const sums = groups[hits];
          if (slash >= 0) sums[DIAG * KINDS + slash] += both;
          if (back >= 0) sums[DIAG * KINDS + back] += both;
          const fromA = weight * chanceB;
          const fromB = weight * chanceA;
          const rowA = a * PAIR_WIDTH;
          const rowB = b * PAIR_WIDTH;
          for (let at = 0; at < PAIR_WIDTH; at += 1) {
            sums[at] += fromA * across.lines[rowA + at] + fromB * down.lines[rowB + at];
          }
        }
      }
    }
  }
  return { chance, groups };
}

/** 셈해 둔 표. 그림의 무게와 가운데 7의 확률로 찾는다. 가게에 나오는 조합은 많지 않아서 넘치면 다 비운다. */
const TABLES = new Map<string, LineTable>();
const TABLES_MAX = 64;

function tableOf(weights: readonly number[], centerWild: number): LineTable {
  const key = `${weights.join(',')}|${centerWild}`;
  let table = TABLES.get(key);
  if (!table) {
    if (TABLES.size >= TABLES_MAX) TABLES.clear();
    table = buildTable(weights, centerWild);
    TABLES.set(key, table);
  }
  return table;
}

function effectsOf(charms: readonly string[]): CharmEffect[] {
  return charms.flatMap((id) => {
    const charm = charmOf(id);
    return charm ? [charm.effect] : [];
  });
}

/** 한 스핀의 기댓값을 셈하는 데 드는 것들. 스핀마다 다른 것(마지막인지, 꽝 다음인지)은 곱으로 따로 둔다. */
export interface SpinExpect {
  /** 한 줄도 맞지 않을 확률 */
  miss: number;
  /** 한 줄이라도 맞은 판의 상금의 기댓값(잭팟과 맞은 줄의 수에 따른 곱까지, 막판 한 방과 오뚝이는 빼고) */
  win: number;
  /** 꽝일 때 받는 금화 */
  consolation: number;
  /** 마지막 스핀과 꽝 다음 스핀에 곱하는 값(막판 한 방, 오뚝이) */
  lastTimes: number;
  reboundTimes: number;
  /** 라운드의 스핀 수 */
  spins: number;
}

/** 부적과 context로 한 스핀의 기댓값을 셈하는 데 드는 것들을 모은다. */
export function spinExpect(charms: readonly string[], context: ExpectContext = {}): SpinExpect {
  const effects = effectsOf(charms);
  const values = context.values ?? valuesOf(charms);
  const times = context.lineTimes ?? lineTimesOf(charms);
  const table = tableOf(context.weights ?? weightsOf(charms), context.centerWild ?? centerWildOf(charms));
  // 무리마다 한 줄의 곱. 테두리와 가운데를 지나는 줄은 가로와 세로가 반씩이다(판을 돌려도 확률이 같으므로).
  const groupTimes = [(times.row + times.col) / 2, (times.row + times.col) / 2, times.diag];
  let win = 0;
  for (let hits = 1; hits <= ALL_LINES; hits += 1) {
    const sums = table.groups[hits];
    let base = 0;
    for (let group = 0; group < GROUPS; group += 1) {
      for (let symbol = 0; symbol < KINDS; symbol += 1) base += sums[group * KINDS + symbol] * values[symbol] * groupTimes[group];
    }
    const combo = effects.reduce(
      (product, effect) =>
        product *
        (effect.combo && hits >= effect.combo[0] ? effect.combo[1] : 1) *
        (effect.comboExact && hits === effect.comboExact[0] ? effect.comboExact[1] : 1),
      1,
    );
    const jackpot = hits === ALL_LINES ? JACKPOT_TIMES : 1;
    win += base * combo * jackpot * (context.linesTimes?.(hits) ?? 1);
  }
  return {
    miss: table.chance[0],
    win,
    consolation: effects.reduce((sum, effect) => sum + (effect.consolation ?? 0), MISS_COIN + (context.consolation ?? 0)),
    lastTimes: effects.reduce((product, effect) => product * (effect.lastTimes ?? 1), 1),
    reboundTimes: effects.reduce((product, effect) => product * (effect.reboundTimes ?? 1), 1),
    spins: context.spins ?? spinsOf(charms),
  };
}

/** 한 스핀에서 받는 금화의 기댓값. last는 라운드의 마지막 스핀인지, afterMiss는 바로 앞 스핀이 꽝이었는지다. */
export function expectedSpin(
  charms: readonly string[],
  spot: { last?: boolean; afterMiss?: boolean } = {},
  context: ExpectContext = {},
): number {
  const parts = spinExpect(charms, context);
  const times = (spot.last ? parts.lastTimes : 1) * (spot.afterMiss ? parts.reboundTimes : 1);
  return parts.win * times + parts.miss * parts.consolation;
}

/**
 * 한 라운드(spinsOf번 돌리기)에 받는 금화의 기댓값. 스핀마다 판은 따로 뽑으므로, 둘째 스핀부터는 바로 앞이 꽝일
 * 확률이 언제나 miss다. 마지막 스핀에는 막판 한 방의 곱이 붙는다.
 */
export function expectedRound(charms: readonly string[], context: ExpectContext = {}): number {
  const parts = spinExpect(charms, context);
  let sum = 0;
  for (let index = 0; index < parts.spins; index += 1) {
    const last = index === parts.spins - 1 ? parts.lastTimes : 1;
    const rebound = index === 0 ? 1 : 1 - parts.miss + parts.miss * parts.reboundTimes;
    sum += parts.win * last * rebound + parts.miss * parts.consolation;
  }
  return sum;
}

/**
 * 부적이 한 라운드의 상금으로 셈해지는지. 저금통처럼 라운드를 넘길 때의 일만 하는 부적은 상금의 기댓값으로
 * 적을 수 없어서 false다. 없는 부적도 false다.
 */
export function affectsPrize(id: string): boolean {
  const charm = charmOf(id);
  if (!charm) return false;
  const { savingsCap: _savings, ...rest } = charm.effect;
  return Object.values(rest).some((value) => value !== undefined);
}

/** 가게에 나오는 부적 가운데 상금의 미리 보기가 붙는 것의 id */
export const PRIZE_PREVIEW_IDS: readonly string[] = CHARMS.filter((charm) => affectsPrize(charm.id)).map((charm) => charm.id);
