import { describe, expect, it } from 'vitest';
import { seededRandom, STAGE_LEVELS } from '../../core/stages';
import {
  DEVICE_NOTE_LEVELS,
  devicesOf,
  HINT_LEVELS,
  LEVEL_CODES,
  LEVEL_COUNT,
  LEVEL_MAX_PINS,
  levelDeviceNote,
  levelPuzzle,
  levelShowsHints,
  levelShowsMonsterNote,
  MONSTER_NOTE_LEVELS,
  parsePuzzle,
  pinCount,
  puzzleCode,
  puzzleKind,
} from './levels';
import {
  MAX_SHAFTS,
  MAX_STACK,
  MIN_SHAFTS,
  movesOf,
  pinsOf,
  pull,
  samePin,
  solve,
  startPuzzle,
  winShare,
  type Item,
  type Pin,
  type Puzzle,
  type PuzzleState,
} from './rules';

// ───────── 표를 만드는 방법 ─────────

/** 판에 넣는 장치: 없음, 사슬로 묶인 핀, 열쇠와 자물쇠, 둘 다 */
type Kit = 'plain' | 'chain' | 'lock' | 'both';

/** 한 구간 안에서 핀 수마다 고르는 판 */
interface Part {
  kit: Kit;
  /** 핀의 수(문 핀 포함) */
  pins: number;
  /** 통로 하나에 위아래로 놓이는 방의 최대 수. 3이면 3층으로 쌓인 통로가 꼭 있는 판만 고른다. */
  maxStack: number;
  /** 꼭 뽑아야 하는 횟수: 가장 적은 것과 가장 많은 것 */
  pulls: readonly [number, number];
  /** 고르는 판의 수 */
  count: number;
  /** 아무렇게나 뽑아 이길 확률이 이보다 높은 판은 고르지 않는다. 적지 않으면 MAX_WIN_SHARE다. */
  maxShare?: number;
  /** 바로 지는 핀만 피해서 뽑아 이길 확률이 이보다 높은 판은 고르지 않는다. 적지 않으면 따지지 않는다. */
  maxCareful?: number;
  /**
   * 조건에 맞는 판을 쉬운 것부터 늘어놓았을 때 고르는 범위(0~1). [0.5, 1]이면 어려운 쪽 절반에서만 고른다.
   * 적지 않으면 처음부터 끝까지 고르게 고른다.
   */
  band?: readonly [number, number];
}

/** 같은 것을 익히는 구간. 차례대로 이어 붙이면 단계 순서가 된다. 구간 안에서는 덜 뽑는 판, 쉬운 판부터 놓는다. */
interface Chapter {
  name: string;
  /** 뽑는 법을 익히는 구간이면 true. 어려운 정도보다 핀 수를 앞세워, 핀이 적은 판부터 놓는다. */
  teaching?: boolean;
  parts: readonly Part[];
}

/**
 * 구간이 바뀔 때마다 새로 궁리할 것이 나온다: 네 번 뽑기, 3층으로 쌓인 통로, 사슬로 묶인 핀, 열쇠와 자물쇠,
 * 그리고 그 모두가 섞인 판. 한 구간이 길지 않아서 같은 요령으로 풀리는 판이 오래 이어지지 않는다.
 * 새 장치가 처음 나오는 자리에는 짧게 끝나는 판을 몇 개 두어 쓰는 법을 익히게 하고, 그 뒤로는 앞 구간보다 길게 뽑는다.
 * 핀이 많은 쪽에는 maxShare와 maxCareful을 두어, 앞에서 본 판에 상관없는 방만 더한 싱거운 판이 다시 나오지 않게 한다.
 */
const CHAPTERS: readonly Chapter[] = [
  {
    name: '1~8단계: 두세 번에 끝나는 판. 핀을 뽑는 법을 익힌다.',
    teaching: true,
    parts: [
      { kit: 'plain', pins: 3, maxStack: 2, pulls: [2, 3], count: 1 },
      { kit: 'plain', pins: 4, maxStack: 2, pulls: [2, 3], count: 3 },
      { kit: 'plain', pins: 5, maxStack: 2, pulls: [2, 3], count: 4 },
    ],
  },
  {
    name: '9~20단계: 네 번을 뽑아야 하는 판. 용암을 물로 식히거나 괴물을 용암으로 없애야 한다.',
    parts: [
      { kit: 'plain', pins: 4, maxStack: 2, pulls: [4, 4], count: 3 },
      { kit: 'plain', pins: 5, maxStack: 2, pulls: [4, 4], count: 4, maxShare: 0.17 },
      { kit: 'plain', pins: 6, maxStack: 2, pulls: [4, 4], count: 5, maxShare: 0.12 },
    ],
  },
  {
    name: '21~32단계: 3층으로 쌓인 통로가 나온다. 다섯 번, 여섯 번을 뽑아야 한다.',
    parts: [
      { kit: 'plain', pins: 6, maxStack: 3, pulls: [5, 5], count: 2 },
      { kit: 'plain', pins: 7, maxStack: 3, pulls: [5, 6], count: 5, maxShare: 0.2 },
      { kit: 'plain', pins: 8, maxStack: 3, pulls: [6, 6], count: 5, maxShare: 0.1 },
    ],
  },
  {
    name: '33~48단계: 사슬로 묶인 핀이 나온다. 하나를 뽑으면 둘이 함께 뽑힌다.',
    parts: [
      { kit: 'chain', pins: 5, maxStack: 2, pulls: [3, 4], count: 3 },
      { kit: 'chain', pins: 6, maxStack: 2, pulls: [4, 5], count: 3, maxCareful: 0.5 },
      { kit: 'chain', pins: 7, maxStack: 3, pulls: [5, 6], count: 5, maxCareful: 0.4, band: [0, 0.8] },
      { kit: 'chain', pins: 8, maxStack: 3, pulls: [5, 7], count: 5, maxCareful: 0.3, band: [0, 0.8] },
    ],
  },
  {
    name: '49~72단계: 열쇠와 자물쇠가 나온다. 열쇠가 구덩이에 닿아야 자물쇠가 달린 핀을 뽑을 수 있다.',
    parts: [
      { kit: 'lock', pins: 5, maxStack: 2, pulls: [3, 5], count: 3 },
      { kit: 'lock', pins: 6, maxStack: 2, pulls: [5, 6], count: 5, maxCareful: 0.4, band: [0, 0.8] },
      { kit: 'lock', pins: 7, maxStack: 3, pulls: [5, 7], count: 6, maxCareful: 0.4, band: [0, 0.8] },
      { kit: 'lock', pins: 8, maxStack: 3, pulls: [6, 7], count: 6, maxCareful: 0.3, band: [0, 0.8] },
      { kit: 'lock', pins: 9, maxStack: 3, pulls: [7, 7], count: 4, maxCareful: 0.3, band: [0, 0.8] },
    ],
  },
  {
    name: '73~100단계: 사슬과 자물쇠가 한 판에 나오고, 핀이 가장 많다. 일곱 번에서 아홉 번을 뽑아야 한다.',
    parts: [
      { kit: 'both', pins: 8, maxStack: 3, pulls: [6, 7], count: 8, maxCareful: 0.3, band: [0.3, 1] },
      { kit: 'both', pins: 9, maxStack: 3, pulls: [6, 8], count: 10, maxCareful: 0.25, band: [0.3, 1] },
      { kit: 'plain', pins: 9, maxStack: 3, pulls: [7, 8], count: 3, maxCareful: 0.25 },
      { kit: 'lock', pins: 9, maxStack: 3, pulls: [8, 9], count: 7, maxCareful: 0.5 },
    ],
  },
];

/** 아무렇게나 뽑아 이길 확률이 이보다 높은 판은 싱거워서 쓰지 않는다. */
const MAX_WIN_SHARE = 0.34;
/** 어려운 정도를 매길 때 괴물이 있는 판에 더하는 값. 로그로 매기므로, 이길 확률이 e의 이 제곱 배만큼 낮은 것으로 치는 셈이다. */
const MONSTER_SCORE = 0.2;
/** 어려운 정도를 매길 때 꼭 뽑아야 하는 한 번마다 더하는 값 */
const PULL_SCORE = 0.8;
/** 어려운 정도를 매길 때 아무렇게나 뽑아 이길 확률을 치는 무게. 바로 지는 핀만 피해서 이길 확률은 1로 친다. */
const SHARE_SCORE = 0.3;
/** 장치가 든 판은 모두 늘어놓기에 너무 많아서, 핀 수마다 이만큼을 아무렇게나 만들어 보고 그 가운데서 고른다. */
const SAMPLES = 3000;
/** 판을 만들 때 자물쇠를 다는 핀의 최대 수 */
const MAX_LOCKS = 2;

interface Candidate {
  puzzle: Puzzle;
  kind: string;
  /** 자물쇠와 사슬을 뗀 이름. 장치만 다르게 단 판이 또 나오지 않게 하는 데 쓴다. */
  base: string;
  /** 꼭 뽑아야 하는 횟수 */
  pulls: number;
  /** 아무렇게나 뽑아 이길 확률 */
  share: number;
  /** 바로 지는 핀만 피해서 뽑아 이길 확률 */
  careful: number;
  /** 클수록 어렵다 */
  score: number;
}

/** 방 count개를 통로에 나눠 담는 방법. 통로의 순서는 따지지 않으므로 큰 통로부터 적은 것만 낸다. */
function shapesOf(count: number, maxStack: number): number[][] {
  const shapes: number[][] = [];
  const extend = (shape: number[], left: number, largest: number): void => {
    if (left === 0) {
      if (shape.length >= MIN_SHAFTS) shapes.push(shape);
      return;
    }
    if (shape.length === MAX_SHAFTS) return;
    for (let size = Math.min(left, largest); size >= 1; size -= 1) extend([...shape, size], left - size, size);
  };
  extend([], count, maxStack);
  // 3층까지 쌓는 구간은 3층 통로가 있는 모양만 쓴다.
  return maxStack < MAX_STACK ? shapes : shapes.filter((shape) => shape.includes(MAX_STACK));
}

/** 어느 핀이 꽂혀 있는지, 용사가 어디 있는지, 괴물이 살아 있는지. 지지 않은 상태는 이것으로 정해진다. */
function standing(state: PuzzleState): string {
  const pinned = state.shafts.map((chambers) => chambers.map((chamber) => (chamber.pinned ? 1 : 0)).join('')).join('/');
  return `${pinned} ${state.hero} ${state.monster}`;
}

/**
 * 바로 지는 핀만 피해서 아무거나 뽑는 사람이 이길 확률. 한 수 앞은 보지만 그 뒤는 따지지 않는 사람이다.
 * 이 값이 낮은 판은, 당장은 아무 일도 없지만 나중에 길이 막히는 수가 많은 판이다.
 */
function carefulShare(puzzle: Puzzle): number {
  const known = new Map<string, number>();
  const visit = (state: PuzzleState): number => {
    const key = standing(state);
    const before = known.get(key);
    if (before !== undefined) return before;
    let total = 0;
    let safe = 0;
    for (const pin of movesOf(state)) {
      const next = pull(state, pin).state;
      if (next.status === 'lost') continue;
      safe += 1;
      total += next.status === 'won' ? 1 : visit(next);
    }
    const found = safe > 0 ? total / safe : 0;
    known.set(key, found);
    return found;
  };
  return visit(startPuzzle(puzzle));
}

/** banned에 든 핀을 한 번도 누르지 않고 이길 수 있는지 */
function winsWithout(puzzle: Puzzle, banned: readonly Pin[]): boolean {
  const seen = new Set<string>();
  const waiting = [startPuzzle(puzzle)];
  for (let state = waiting.pop(); state; state = waiting.pop()) {
    const key = standing(state);
    if (seen.has(key)) continue;
    seen.add(key);
    for (const pin of movesOf(state)) {
      if (banned.some((each) => samePin(each, pin))) continue;
      const next = pull(state, pin).state;
      if (next.status === 'won') return true;
      if (next.status === 'playing') waiting.push(next);
    }
  }
  return false;
}

/**
 * 판을 풀어 보고 표에 올릴 만하면 어려운 정도를 매겨 돌려준다. 풀 수 없거나, 질 수 없거나, 싱거우면 null.
 * 장치가 든 판은 그 장치를 꼭 써야 풀리는 것만 고른다: 자물쇠가 달린 핀이나 사슬로 묶인 핀을 건드리지 않고
 * 풀리는 판은 장치가 있으나 마나다.
 */
function candidateOf(puzzle: Puzzle): Candidate | null {
  const solution = solve(puzzle);
  if (!solution.shortest || solution.chance === 1) return null;
  const share = winShare(solution);
  if (share > MAX_WIN_SHARE) return null;
  if (puzzle.locks && winsWithout(puzzle, puzzle.locks)) return null;
  if (puzzle.links && winsWithout(puzzle, puzzle.links.flat())) return null;
  const pulls = solution.shortest.length;
  const careful = carefulShare(puzzle);
  const score = PULL_SCORE * pulls - Math.log(careful) - SHARE_SCORE * Math.log(share) + (puzzle.monster ? MONSTER_SCORE : 0);
  const base = puzzleKind({ shafts: puzzle.shafts, monster: puzzle.monster });
  return { puzzle, kind: puzzleKind(puzzle), base, pulls, share, careful, score };
}

/** 장치가 없는 판: 핀이 pins개이고 maxStack층까지 쌓은 판을 모두 */
function plainCandidates(pins: number, maxStack: number): Candidate[] {
  const count = pins - 1;
  const found = new Map<string, Candidate | null>();
  for (const shape of shapesOf(count, maxStack)) {
    for (let treasureAt = 0; treasureAt < count; treasureAt += 1) {
      for (let mask = 0; mask < 1 << (count - 1); mask += 1) {
        let index = 0;
        let bit = 0;
        const shafts = shape.map((size) =>
          Array.from({ length: size }, (): Item => {
            const item: Item = index === treasureAt ? 'treasure' : (mask >> bit++) & 1 ? 'lava' : 'water';
            index += 1;
            return item;
          }),
        );
        for (const monster of [false, true]) {
          const puzzle: Puzzle = { shafts, monster };
          const kind = puzzleKind(puzzle);
          if (found.has(kind)) continue;
          found.set(kind, candidateOf(puzzle));
        }
      }
    }
  }
  return [...found.values()].filter((candidate): candidate is Candidate => candidate !== null);
}

/** 순서를 섞는다. 정렬에 기대지 않아서 어디서 돌려도 같은 난수에는 같은 순서가 나온다. */
function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const mixed = [...items];
  for (let last = mixed.length - 1; last > 0; last -= 1) {
    const pick = Math.floor(random() * (last + 1));
    [mixed[last], mixed[pick]] = [mixed[pick], mixed[last]];
  }
  return mixed;
}

/** 장치가 든 판 하나를 아무렇게나 만든다. 풀리는지는 따지지 않는다. */
function randomDevicePuzzle(kit: Kit, pins: number, maxStack: number, random: () => number): Puzzle {
  const count = pins - 1;
  const shapes = shapesOf(count, maxStack);
  const shape = shapes[Math.floor(random() * shapes.length)];
  const withKey = kit === 'lock' || kit === 'both';
  const items: Item[] = Array.from({ length: count }, () => (random() < 0.5 ? 'lava' : 'water'));
  const spots = shuffled([...items.keys()], random);
  items[spots[0]] = 'treasure';
  if (withKey) items[spots[1]] = 'key';
  let index = 0;
  const shafts = shape.map((size) => items.slice(index, (index += size)));
  const plain: Puzzle = { shafts, monster: random() < 0.6 };

  const all = pinsOf(plain);
  let locks: Pin[] = [];
  if (withKey) {
    // 열쇠가 든 방과 그 아래의 핀에는 자물쇠를 달지 않는다.
    const open = all.filter(
      (pin) => pin.kind === 'door' || !shafts[pin.shaft].slice(0, pin.level + 1).includes('key'),
    );
    locks = shuffled(open, random).slice(0, 1 + Math.floor(random() * MAX_LOCKS));
    // 적는 순서(통로 순서, 문 핀이 끝)로 맞춰 두어야 적었다 읽은 판과 같다.
    locks = all.filter((pin) => locks.some((each) => samePin(each, pin)));
  }
  let links: [Pin, Pin][] = [];
  if (kit === 'chain' || kit === 'both') {
    const free = all.filter((pin) => pin.kind === 'chamber' && !locks.some((each) => samePin(each, pin)));
    const picked = shuffled(free, random).slice(0, 2);
    const pair = all.filter((pin) => picked.some((each) => samePin(each, pin)));
    if (pair.length === 2) links = [[pair[0], pair[1]]];
  }
  return { ...plain, ...(locks.length > 0 ? { locks } : {}), ...(links.length > 0 ? { links } : {}) };
}

/** 장치가 든 판: 아무렇게나 SAMPLES개를 만들어 본 것 가운데 표에 올릴 만한 것. 언제 만들어도 같은 판들이 나온다. */
function deviceCandidates(kit: Kit, pins: number, maxStack: number): Candidate[] {
  const random = seededRandom(`pin-pull:levels:${kit}:${pins}:${maxStack}`);
  const found = new Map<string, Candidate | null>();
  for (let turn = 0; turn < SAMPLES; turn += 1) {
    const puzzle = randomDevicePuzzle(kit, pins, maxStack, random);
    const kind = puzzleKind(puzzle);
    if (found.has(kind)) continue;
    const wanted = (kit === 'chain' || puzzle.locks !== undefined) && (kit === 'lock' || puzzle.links !== undefined);
    found.set(kind, wanted ? candidateOf(puzzle) : null);
  }
  return [...found.values()].filter((candidate): candidate is Candidate => candidate !== null);
}

/** 통로의 순서를 섞는다. 같은 판은 언제나 같은 순서로 섞인다. 자물쇠와 사슬은 제 통로를 따라간다. */
function arranged(candidate: Candidate): string {
  const random = seededRandom(`pin-pull:arrange:${candidate.kind}`);
  const [, body, marks] = /^([^#!]*)(.*)$/.exec(puzzleCode(candidate.puzzle)) ?? [];
  return `${shuffled(body.split('/'), random).join('/')}${marks}`;
}

/** 쉬운 판부터. 점수가 같으면 이름 순서라서 언제 만들어도 같은 표가 나온다. */
function easierFirst(a: Candidate, b: Candidate): number {
  return a.score - b.score || (a.kind < b.kind ? -1 : 1);
}

interface Picked {
  chapter: number;
  candidate: Candidate;
  code: string;
}

/**
 * 구간마다 핀 수별로 조건에 맞는 판을 쉬운 것부터 어려운 것까지 고르게 count개씩 고르고,
 * 그렇게 고른 판을 다시 쉬운 것부터 놓아 단계 순서로 늘어놓는다.
 * 장치만 다르게 단 같은 판은 한 번만 쓴다.
 */
function pickLevels(): Picked[] {
  const pools = new Map<string, Candidate[]>();
  const used = new Set<string>();
  const levels: Picked[] = [];
  for (const [chapter, { parts, teaching }] of CHAPTERS.entries()) {
    const picked: Candidate[] = [];
    for (const part of parts) {
      const key = `${part.kit}/${part.pins}/${part.maxStack}`;
      const all =
        pools.get(key) ??
        (part.kit === 'plain'
          ? plainCandidates(part.pins, part.maxStack)
          : deviceCandidates(part.kit, part.pins, part.maxStack));
      pools.set(key, all);
      const pool = all
        .filter(({ pulls }) => pulls >= part.pulls[0] && pulls <= part.pulls[1])
        .filter(({ share }) => share <= (part.maxShare ?? MAX_WIN_SHARE))
        .filter(({ careful }) => careful <= (part.maxCareful ?? 1))
        .filter(({ base }) => !used.has(base))
        .sort(easierFirst);
      if (pool.length < part.count) throw new Error(`판이 모자란다: ${key}에 ${pool.length}개`);
      const [from, to] = part.band ?? [0, 1];
      const first = Math.round(from * (pool.length - 1));
      const last = Math.round(to * (pool.length - 1));
      for (let turn = 0; turn < part.count; turn += 1) {
        const at = part.count === 1 ? first : Math.round(first + (turn * (last - first)) / (part.count - 1));
        // 바로 그 자리의 판이 이미 쓴 판과 겉모양이 같으면 가까운 다음 판을 고른다.
        const order = [...pool.slice(at), ...pool.slice(0, at).reverse()];
        const next = order.find(({ base }) => !used.has(base));
        if (!next) throw new Error(`판이 모자란다: ${key}`);
        used.add(next.base);
        picked.push(next);
      }
    }
    const inOrder = teaching
      ? picked.sort((a, b) => pinCount(a.puzzle) - pinCount(b.puzzle) || easierFirst(a, b))
      : picked.sort(easierFirst);
    for (const candidate of inOrder) levels.push({ chapter, candidate, code: arranged(candidate) });
  }
  return levels;
}

// ───────── 표 ─────────

describe('핀 뽑기의 단계 표', () => {
  const levels = Array.from({ length: STAGE_LEVELS }, (_, index) => index + 1);
  /** 구간마다 첫 단계와 마지막 단계 */
  const spans = CHAPTERS.reduce<Array<readonly [number, number]>>((found, chapter) => {
    const first = (found[found.length - 1]?.[1] ?? 0) + 1;
    return [...found, [first, first + chapter.parts.reduce((sum, part) => sum + part.count, 0) - 1] as const];
  }, []);
  const kitOf = (puzzle: Puzzle): Kit =>
    puzzle.locks ? (puzzle.links ? 'both' : 'lock') : puzzle.links ? 'chain' : 'plain';
  const tallestOf = (puzzle: Puzzle): number => Math.max(...puzzle.shafts.map((shaft) => shaft.length));

  it('고르는 방법대로 만든 표와 같다', () => {
    // 달라졌다면 고르는 기준이 바뀐 것이다. 여기 찍힌 표를 levels.ts에 옮겨 적는다.
    const picked = pickLevels().map(({ code }) => code);
    expect(JSON.stringify(LEVEL_CODES), `새 표:\n${JSON.stringify(picked)}`).toBe(JSON.stringify(picked));
  }, 120_000);

  it('단계 수만큼 있고 모두 읽을 수 있다', () => {
    expect(LEVEL_CODES).toHaveLength(LEVEL_COUNT);
    expect(LEVEL_COUNT).toBe(STAGE_LEVELS);
    for (const code of LEVEL_CODES) {
      const puzzle = parsePuzzle(code);
      expect(puzzle, code).not.toBeNull();
      if (puzzle) expect(puzzleCode(puzzle)).toBe(code);
    }
  });

  it('서로 다른 판이다: 통로의 순서만 다르거나 장치만 다르게 단 판도 없다', () => {
    const kinds = levels.map((level) => puzzleKind(levelPuzzle(level)));
    expect(new Set(kinds).size).toBe(STAGE_LEVELS);
    const bases = levels.map((level) => {
      const { shafts, monster } = levelPuzzle(level);
      return puzzleKind({ shafts, monster });
    });
    expect(new Set(bases).size).toBe(STAGE_LEVELS);
  });

  it('어느 단계든 깰 수 있고, 아무렇게나 뽑으면 질 수 있다', () => {
    for (const level of levels) {
      const puzzle = levelPuzzle(level);
      const solution = solve(puzzle);
      expect(solution.shortest, `${level}단계`).not.toBeNull();
      expect(solution.chance, `${level}단계`).toBeLessThan(1);
      expect(winShare(solution), `${level}단계`).toBeLessThanOrEqual(MAX_WIN_SHARE);
      // 풀이대로 누르면 정말로 깨진다. 자물쇠가 잠긴 핀을 누르는 일도 없다.
      let state = startPuzzle(puzzle);
      for (const pin of solution.shortest ?? []) {
        const result = pull(state, pin);
        expect(result.pulled, `${level}단계`).toBe(true);
        state = result.state;
      }
      expect(state.status, `${level}단계`).toBe('won');
    }
  }, 60_000);

  it('장치가 든 판은 그 장치를 써야만 풀린다', () => {
    for (const level of levels) {
      const puzzle = levelPuzzle(level);
      if (puzzle.locks) expect(winsWithout(puzzle, puzzle.locks), `${level}단계의 자물쇠`).toBe(false);
      if (puzzle.links) expect(winsWithout(puzzle, puzzle.links.flat()), `${level}단계의 사슬`).toBe(false);
    }
  });

  it('구간마다 정해 둔 장치만 나온다: 사슬, 자물쇠, 둘 다의 차례로 처음 나온다', () => {
    CHAPTERS.forEach((chapter, index) => {
      const kits = new Set(chapter.parts.map((part) => part.kit));
      for (let level = spans[index][0]; level <= spans[index][1]; level += 1) {
        expect(kits.has(kitOf(levelPuzzle(level))), `${level}단계`).toBe(true);
      }
    });
    const firstOf = (kit: Kit): number => levels.find((level) => kitOf(levelPuzzle(level)) === kit) ?? 0;
    expect(firstOf('plain')).toBe(1);
    expect(firstOf('chain')).toBe(spans[3][0]);
    expect(firstOf('lock')).toBe(spans[4][0]);
    expect(firstOf('both')).toBeGreaterThanOrEqual(spans[5][0]);
    expect(firstOf('chain')).toBeLessThan(firstOf('lock'));
    // 새 장치가 처음 나오는 판은 짧게 끝난다. 쓰는 법을 익히는 판이다.
    for (const kit of ['chain', 'lock'] as const) {
      expect(solve(levelPuzzle(firstOf(kit))).shortest?.length, kit).toBeLessThanOrEqual(3);
    }
  });

  it('구간 안에서는 뒤로 갈수록 어렵다', () => {
    const scores = levels.map((level) => candidateOf(levelPuzzle(level))?.score ?? NaN);
    CHAPTERS.forEach((chapter, index) => {
      // 익히는 구간은 핀이 적은 판부터 놓으므로 따지지 않는다.
      if (chapter.teaching) return;
      for (let level = spans[index][0] + 1; level <= spans[index][1]; level += 1) {
        expect(scores[level - 1], `${level}단계`).toBeGreaterThanOrEqual(scores[level - 2]);
      }
    });
  }, 60_000);

  it('꼭 뽑아야 하는 횟수는 두 번에서 시작해 구간마다 늘고, 마지막 구간에서는 아홉 번까지 간다', () => {
    const pulls = levels.map((level) => solve(levelPuzzle(level)).shortest?.length ?? 0);
    expect(pulls[0]).toBe(2);
    // 두세 번에 끝나는 익히는 판은 처음 구간과, 새 장치가 처음 나오는 자리에만 있다.
    const short = levels.filter((level) => pulls[level - 1] < 4);
    for (const level of short) {
      const intro = spans.some(([first], index) => index >= 3 && level >= first && level < first + 4);
      expect(level <= HINT_LEVELS || intro, `${level}단계`).toBe(true);
    }
    const average = spans.map(([first, last]) => {
      const part = pulls.slice(first - 1, last);
      return part.reduce((sum, count) => sum + count, 0) / part.length;
    });
    for (let index = 1; index < average.length; index += 1) {
      // 사슬이 처음 나오는 구간은 익히는 판이 섞여서 앞 구간보다 조금 짧을 수 있다.
      if (index === 3) continue;
      expect(average[index], CHAPTERS[index].name).toBeGreaterThan(average[index - 1]);
    }
    expect(average[average.length - 1]).toBeGreaterThan(average[3] + 1);
    const [first, last] = spans[spans.length - 1];
    expect(Math.min(...pulls.slice(first - 1, last))).toBeGreaterThanOrEqual(6);
    expect(Math.max(...pulls)).toBe(9);
    expect(Math.max(...pulls.slice(first - 1, last))).toBe(9);
  });

  it('핀이 가장 적은 판에서 시작하고, 마지막 구간에는 핀이 가장 많은 판이 나온다', () => {
    const pins = levels.map((level) => pinCount(levelPuzzle(level)));
    expect(pins[0]).toBe(3);
    expect(Math.min(...pins)).toBe(3);
    expect(pins[pins.length - 1]).toBe(LEVEL_MAX_PINS);
    expect(Math.max(...pins)).toBe(LEVEL_MAX_PINS);
  });

  it('3층으로 쌓인 통로는 21단계부터 나온다', () => {
    const firstTall = levels.find((level) => tallestOf(levelPuzzle(level)) === MAX_STACK);
    expect(firstTall).toBe(21);
    expect(firstTall).toBe(spans[2][0]);
    // 3층까지 쌓기로 한 자리에서는 판마다 3층 통로가 있다.
    for (const level of levels) {
      const tall = tallestOf(levelPuzzle(level)) === MAX_STACK;
      const index = spans.findIndex(([first, last]) => level >= first && level <= last);
      const stacks = new Set(CHAPTERS[index].parts.map((part) => part.maxStack));
      if (stacks.size === 1) expect(tall, `${level}단계`).toBe(stacks.has(MAX_STACK));
    }
    expect(tallestOf(levelPuzzle(STAGE_LEVELS))).toBe(MAX_STACK);
  });

  it('구간에서 고르는 판의 수를 모두 더하면 단계 수이고, 처음의 도움말은 첫 구간에서만 보인다', () => {
    const parts = CHAPTERS.flatMap((chapter) => chapter.parts);
    expect(parts.reduce((sum, part) => sum + part.count, 0)).toBe(STAGE_LEVELS);
    expect(spans[spans.length - 1][1]).toBe(STAGE_LEVELS);
    expect(Math.max(...parts.map((part) => part.pins))).toBe(LEVEL_MAX_PINS);
    expect(CHAPTERS[0].teaching).toBe(true);
    expect(spans[0][1]).toBe(HINT_LEVELS);
    // 같은 요령으로 푸는 구간이 서른 단계를 넘지 않는다.
    for (const [first, last] of spans) expect(last - first + 1).toBeLessThanOrEqual(30);
  });

  it('화면에 들어가는 모양이다', () => {
    for (const level of levels) {
      const { shafts, locks, links } = levelPuzzle(level);
      expect(shafts.length).toBeGreaterThanOrEqual(MIN_SHAFTS);
      expect(shafts.length).toBeLessThanOrEqual(MAX_SHAFTS);
      for (const shaft of shafts) expect(shaft.length).toBeLessThanOrEqual(MAX_STACK);
      expect((locks ?? []).length).toBeLessThanOrEqual(MAX_LOCKS);
      expect((links ?? []).length).toBeLessThanOrEqual(1);
    }
  });

  it('첫 단계에는 괴물이 없다', () => {
    expect(levelPuzzle(1).monster).toBe(false);
    expect(levelPuzzle(2).monster).toBe(false);
  });

  it('범위를 벗어난 단계 번호는 처음이나 끝의 판으로 맞춘다', () => {
    expect(levelPuzzle(0)).toEqual(levelPuzzle(1));
    expect(levelPuzzle(STAGE_LEVELS + 5)).toEqual(levelPuzzle(STAGE_LEVELS));
    expect(levelPuzzle(2.9)).toEqual(levelPuzzle(2));
  });
});

describe('판을 적고 읽기', () => {
  it('적은 것을 읽으면 같은 판이 된다', () => {
    const puzzle: Puzzle = { shafts: [['treasure', 'lava'], ['water'], ['lava']], monster: true };
    expect(puzzleCode(puzzle)).toBe('tl/w/l!');
    expect(parsePuzzle('tl/w/l!')).toEqual(puzzle);
    // 통로 하나에 방을 세 개까지 쌓을 수 있다.
    expect(parsePuzzle('tll/w')).toEqual({ shafts: [['treasure', 'lava', 'lava'], ['water']], monster: false });
  });

  it('읽을 수 없는 것은 null이다', () => {
    expect(parsePuzzle('')).toBeNull();
    expect(parsePuzzle('t')).toBeNull();
    expect(parsePuzzle('t/x')).toBeNull();
    expect(parsePuzzle('l/w')).toBeNull();
    expect(parsePuzzle('t/t')).toBeNull();
    expect(parsePuzzle('tlwl/w')).toBeNull();
    expect(parsePuzzle('t/l/w/l/w')).toBeNull();
  });

  it('자물쇠는 대문자와 #로, 사슬은 *로 적는다', () => {
    const puzzle = parsePuzzle('tL/k*w/l*#!');
    expect(puzzle).toEqual({
      shafts: [['treasure', 'lava'], ['key', 'water'], ['lava']],
      monster: true,
      locks: [{ kind: 'chamber', shaft: 0, level: 1 }, { kind: 'door' }],
      links: [
        [
          { kind: 'chamber', shaft: 1, level: 0 },
          { kind: 'chamber', shaft: 2, level: 0 },
        ],
      ],
    });
    if (puzzle) expect(puzzleCode(puzzle)).toBe('tL/k*w/l*#!');
    // 장치가 없는 판에는 자물쇠와 사슬을 적지 않는다.
    expect(parsePuzzle('tl/w')).toEqual({ shafts: [['treasure', 'lava'], ['water']], monster: false });
    expect(devicesOf(parsePuzzle('tl/w') as Puzzle)).toEqual([]);
    expect(devicesOf(puzzle as Puzzle)).toEqual(['chain', 'lock']);
    expect(devicesOf(parsePuzzle('t*/l*/w') as Puzzle)).toEqual(['chain']);
    expect(devicesOf(parsePuzzle('T/k/w') as Puzzle)).toEqual(['lock']);
  });

  it('판이 될 수 없는 장치는 읽지 않는다', () => {
    // 자물쇠가 있는데 열쇠가 없거나, 자물쇠가 없는데 열쇠가 있거나, 열쇠가 둘이다.
    expect(parsePuzzle('T/l/w')).toBeNull();
    expect(parsePuzzle('t/k/w')).toBeNull();
    expect(parsePuzzle('T/k/k')).toBeNull();
    expect(parsePuzzle('t/l/w#')).toBeNull();
    // 열쇠가 든 방과 그 아래의 핀에 자물쇠가 달리면 열쇠가 내려올 길이 없다.
    expect(parsePuzzle('t/K/w')).toBeNull();
    expect(parsePuzzle('t/kW/l')).toBeNull();
    expect(parsePuzzle('t/Wk/l')).not.toBeNull();
    // 사슬은 한 쌍뿐이고, 자물쇠가 달린 핀은 묶지 않는다.
    expect(parsePuzzle('t*/l/w')).toBeNull();
    expect(parsePuzzle('t*/l*/w*')).toBeNull();
    expect(parsePuzzle('T*/k/w*')).toBeNull();
    // 표시의 자리가 틀렸다.
    expect(parsePuzzle('t/l/w!#')).toBeNull();
    expect(parsePuzzle('*t/l/w')).toBeNull();
    expect(parsePuzzle('t/l**/w')).toBeNull();
  });

  it('통로의 순서만 다른 판은 같은 이름이다', () => {
    const one = parsePuzzle('tl/w/l');
    const other = parsePuzzle('l/w/tl');
    const different = parsePuzzle('lt/w/l');
    expect(one && other && puzzleKind(one) === puzzleKind(other)).toBe(true);
    expect(one && different && puzzleKind(one) === puzzleKind(different)).toBe(false);
    // 장치가 다르면 다른 판이다.
    const chained = parsePuzzle('l*/w/tl*');
    const moved = parsePuzzle('tl*/l*/w');
    const elsewhere = parsePuzzle('l/w*/tl*');
    expect(chained && moved && puzzleKind(chained) === puzzleKind(moved)).toBe(true);
    expect(chained && elsewhere && puzzleKind(chained) === puzzleKind(elsewhere)).toBe(false);
    expect(one && chained && puzzleKind(one) === puzzleKind(chained)).toBe(false);
  });
});

describe('도움말', () => {
  const levels = Array.from({ length: STAGE_LEVELS }, (_, index) => index + 1);

  it('처음의 도움말은 두세 번에 끝나는 처음 단계에서만 보인다', () => {
    expect(levelShowsHints(1)).toBe(true);
    expect(levelShowsHints(0)).toBe(true);
    expect(levelShowsHints(STAGE_LEVELS)).toBe(false);
    for (const level of levels) {
      expect(levelShowsHints(level)).toBe(level <= HINT_LEVELS);
      // 도움말이 보이는 단계에는 괴물이 없어서, 괴물을 물리치는 법과 겹쳐 뜨지 않는다.
      if (levelShowsHints(level)) expect(levelShowsMonsterNote(level)).toBe(false);
    }
  });

  it('새 장치를 쓰는 법은 그 장치가 나오는 처음 몇 단계에서만 알려 준다', () => {
    for (const device of ['chain', 'lock'] as const) {
      const noted = levels.filter((level) => levelDeviceNote(level) === device);
      const having = levels.filter((level) => devicesOf(levelPuzzle(level)).includes(device));
      expect(noted, device).toEqual(having.slice(0, DEVICE_NOTE_LEVELS));
      // 처음의 도움말이나 괴물을 물리치는 법과 겹쳐 뜨지 않는다.
      for (const level of noted) {
        expect(levelShowsHints(level)).toBe(false);
        expect(levelShowsMonsterNote(level)).toBe(false);
      }
    }
    expect(levelDeviceNote(1)).toBeNull();
    expect(levelDeviceNote(0)).toBeNull();
    expect(levelDeviceNote(STAGE_LEVELS)).toBeNull();
  });

  it('괴물을 물리치는 법은 괴물이 나오는 처음 몇 단계에서만 알려 준다', () => {
    const noted = levels.filter((level) => levelShowsMonsterNote(level));
    const monsters = levels.filter((level) => levelPuzzle(level).monster);
    expect(noted).toEqual(monsters.slice(0, MONSTER_NOTE_LEVELS));
    expect(noted).toHaveLength(MONSTER_NOTE_LEVELS);
  });
});
