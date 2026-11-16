import { describe, expect, it } from 'vitest';
import { seededRandom, STAGE_LEVELS } from '../../core/stages';
import {
  HINT_LEVELS,
  LEVEL_CODES,
  LEVEL_COUNT,
  LEVEL_MAX_PINS,
  levelPuzzle,
  levelShowsHints,
  levelShowsMonsterNote,
  MONSTER_NOTE_LEVELS,
  parsePuzzle,
  pinCount,
  puzzleCode,
  puzzleKind,
} from './levels';
import { MAX_SHAFTS, MAX_STACK, MIN_SHAFTS, solve, winShare, type Item, type Puzzle } from './rules';

// ───────── 표를 만드는 방법 ─────────

/** 한 구간 안에서 핀 수마다 고르는 판 */
interface Part {
  /** 핀의 수(문 핀 포함) */
  pins: number;
  /** 고르는 판의 수 */
  count: number;
  /** 아무렇게나 뽑아 이길 확률이 이보다 높은 판은 고르지 않는다. 적지 않으면 MAX_WIN_SHARE다. */
  maxShare?: number;
}

/** 꼭 뽑아야 하는 핀의 수가 같은 판을 모은 구간. 차례대로 이어 붙이면 단계 순서가 된다. */
interface Chapter {
  /** 꼭 뽑아야 하는 핀의 수: 가장 적은 것과 가장 많은 것 */
  pulls: readonly [number, number];
  /** 통로 하나에 위아래로 놓이는 방의 최대 수 */
  maxStack: number;
  parts: readonly Part[];
}

/**
 * 꼭 뽑아야 하는 핀의 수가 뒤로 갈수록 늘게 구간을 놓는다. 핀 수를 앞세우면 핀이 늘 때마다 두 번에 끝나는
 * 쉬운 판으로 돌아가서, 뒤쪽 단계가 앞쪽보다 쉬워진다.
 * 구간 안에서는 핀 수에 상관없이 쉬운 판부터 놓는다. 핀이 많은 쪽에는 maxShare를 두어, 앞에서 본 판에
 * 상관없는 방만 더한 싱거운 판이 다시 나오지 않게 한다. 그래서 쉬운 판으로 돌아가는 곳은 구간이 바뀌어
 * 더 길게 뽑아야 하는 판이 처음 나오는 자리뿐이다.
 */
const CHAPTERS: readonly Chapter[] = [
  // 1~8단계: 두세 번에 끝나는 판. 핀을 뽑는 법을 익힌다.
  {
    pulls: [2, 3],
    maxStack: 2,
    parts: [
      { pins: 3, count: 1 },
      { pins: 4, count: 3 },
      { pins: 5, count: 4 },
    ],
  },
  // 9~50단계: 네 번을 뽑아야 하는 판. 용암을 물로 식히거나 괴물을 용암으로 없애야 한다.
  {
    pulls: [4, 4],
    maxStack: 2,
    parts: [
      { pins: 4, count: 6 },
      { pins: 5, count: 14, maxShare: 0.17 },
      { pins: 6, count: 22, maxShare: 0.12 },
    ],
  },
  // 51~64단계: 3층으로 쌓인 통로가 나온다. 다섯 번을 뽑아야 한다.
  {
    pulls: [5, 5],
    maxStack: 3,
    parts: [
      { pins: 6, count: 4 },
      { pins: 7, count: 10, maxShare: 0.2 },
    ],
  },
  // 65~96단계: 여섯 번을 뽑아야 한다. 용암을 두 번 식히거나, 괴물을 없애고도 용암을 한 번 더 치워야 한다.
  {
    pulls: [6, 6],
    maxStack: 3,
    parts: [
      { pins: 7, count: 12 },
      { pins: 8, count: 14, maxShare: 0.1 },
      { pins: 9, count: 6, maxShare: 0.05 },
    ],
  },
  // 97~100단계: 일곱 번, 여덟 번을 뽑아야 한다.
  { pulls: [7, 8], maxStack: 3, parts: [{ pins: 9, count: 4 }] },
];

/** 아무렇게나 뽑아 이길 확률이 이보다 높은 판은 싱거워서 쓰지 않는다. */
const MAX_WIN_SHARE = 0.34;
/** 어려운 정도를 매길 때 괴물이 있는 판에 더하는 값. 로그로 매기므로, 이길 확률이 e의 이 제곱 배만큼 낮은 것으로 치는 셈이다. */
const MONSTER_SCORE = 0.2;

interface Candidate {
  puzzle: Puzzle;
  kind: string;
  /** 꼭 뽑아야 하는 핀의 수 */
  pulls: number;
  /** 아무렇게나 뽑아 이길 확률 */
  share: number;
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
  return shapes;
}

/** 핀이 pins개이고 maxStack층까지 쌓은 판 가운데 풀 수 있고 질 수도 있고 싱겁지 않은 것을 모두 */
function candidatesOf(pins: number, maxStack: number): Candidate[] {
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
          found.set(kind, null);
          const solution = solve(puzzle);
          if (!solution.shortest || solution.winning === solution.orders) continue;
          const share = winShare(solution);
          if (share > MAX_WIN_SHARE) continue;
          const pulls = solution.shortest.length;
          const score = -Math.log(share) + 0.3 * (pulls - 2) + (monster ? MONSTER_SCORE : 0);
          found.set(kind, { puzzle, kind, pulls, share, score });
        }
      }
    }
  }
  return [...found.values()].filter((candidate): candidate is Candidate => candidate !== null);
}

/** 통로의 순서를 섞는다. 같은 판은 언제나 같은 순서로 섞인다. */
function arranged(candidate: Candidate): Puzzle {
  const random = seededRandom(`pin-pull:arrange:${candidate.kind}`);
  const shafts = [...candidate.puzzle.shafts];
  for (let last = shafts.length - 1; last > 0; last -= 1) {
    const pick = Math.floor(random() * (last + 1));
    [shafts[last], shafts[pick]] = [shafts[pick], shafts[last]];
  }
  return { shafts, monster: candidate.puzzle.monster };
}

/** 덜 뽑는 판부터, 뽑는 수가 같으면 쉬운 판부터. 점수까지 같으면 이름 순서라서 언제 만들어도 같은 표가 나온다. */
function easierFirst(a: Candidate, b: Candidate): number {
  return a.pulls - b.pulls || a.score - b.score || (a.kind < b.kind ? -1 : 1);
}

/**
 * 구간마다 핀 수별로 조건에 맞는 판을 쉬운 것부터 어려운 것까지 고르게 count개씩 고르고,
 * 그렇게 고른 판을 다시 쉬운 것부터 놓아 단계 순서로 늘어놓는다.
 */
function pickLevels(): string[] {
  const pools = new Map<string, Candidate[]>();
  const codes: string[] = [];
  for (const chapter of CHAPTERS) {
    const picked: Candidate[] = [];
    for (const part of chapter.parts) {
      const key = `${part.pins}/${chapter.maxStack}`;
      const all = pools.get(key) ?? candidatesOf(part.pins, chapter.maxStack);
      pools.set(key, all);
      const pool = all
        .filter(({ pulls }) => pulls >= chapter.pulls[0] && pulls <= chapter.pulls[1])
        .filter(({ share }) => share <= (part.maxShare ?? MAX_WIN_SHARE))
        .sort(easierFirst);
      if (pool.length < part.count) throw new Error(`판이 모자란다: 핀 ${part.pins}개에 ${pool.length}개`);
      for (let turn = 0; turn < part.count; turn += 1) {
        const at = part.count === 1 ? 0 : Math.round((turn * (pool.length - 1)) / (part.count - 1));
        picked.push(pool[at]);
      }
    }
    for (const candidate of picked.sort(easierFirst)) codes.push(puzzleCode(arranged(candidate)));
  }
  return codes;
}

// ───────── 표 ─────────

describe('핀 뽑기의 단계 표', () => {
  const levels = Array.from({ length: STAGE_LEVELS }, (_, index) => index + 1);

  it('고르는 방법대로 만든 표와 같다', () => {
    // 달라졌다면 고르는 기준이 바뀐 것이다. 여기 찍힌 표를 levels.ts에 옮겨 적는다.
    const picked = pickLevels();
    expect(JSON.stringify(LEVEL_CODES), `새 표:\n${JSON.stringify(picked)}`).toBe(JSON.stringify(picked));
  }, 60_000);

  it('단계 수만큼 있고 모두 읽을 수 있다', () => {
    expect(LEVEL_CODES).toHaveLength(LEVEL_COUNT);
    expect(LEVEL_COUNT).toBe(STAGE_LEVELS);
    for (const code of LEVEL_CODES) {
      const puzzle = parsePuzzle(code);
      expect(puzzle, code).not.toBeNull();
      if (puzzle) expect(puzzleCode(puzzle)).toBe(code);
    }
  });

  it('서로 다른 판이다: 통로의 순서만 다른 판도 없다', () => {
    const kinds = levels.map((level) => puzzleKind(levelPuzzle(level)));
    expect(new Set(kinds).size).toBe(STAGE_LEVELS);
  });

  it('어느 단계든 깰 수 있고, 아무렇게나 뽑으면 질 수 있다', () => {
    for (const level of levels) {
      const solution = solve(levelPuzzle(level));
      expect(solution.shortest, `${level}단계`).not.toBeNull();
      expect(solution.winning, `${level}단계`).toBeLessThan(solution.orders);
      expect(winShare(solution), `${level}단계`).toBeLessThanOrEqual(MAX_WIN_SHARE);
    }
  }, 60_000);

  it('꼭 뽑아야 하는 핀의 수는 두 번에서 시작해 일곱 번 이상으로 끝나고, 도중에 줄지 않는다', () => {
    const pulls = levels.map((level) => solve(levelPuzzle(level)).shortest?.length ?? 0);
    expect(pulls[0]).toBe(2);
    expect(pulls[pulls.length - 1]).toBeGreaterThanOrEqual(7);
    for (let index = 1; index < pulls.length; index += 1) {
      expect(pulls[index], `${index + 1}단계`).toBeGreaterThanOrEqual(pulls[index - 1]);
    }
    // 두세 번에 끝나는 판은 처음의 익히는 단계에만 있다.
    expect(pulls.filter((count) => count < 4)).toHaveLength(HINT_LEVELS);
  });

  it('핀이 가장 적은 판에서 시작해 가장 많은 판으로 끝난다', () => {
    const pins = levels.map((level) => pinCount(levelPuzzle(level)));
    expect(pins[0]).toBe(3);
    expect(Math.min(...pins)).toBe(3);
    expect(pins[pins.length - 1]).toBe(LEVEL_MAX_PINS);
    expect(Math.max(...pins)).toBe(LEVEL_MAX_PINS);
  });

  it('3층으로 쌓인 통로는 51단계부터 나오고, 그 뒤로는 판마다 있다', () => {
    const tallest = levels.map((level) => Math.max(...levelPuzzle(level).shafts.map((shaft) => shaft.length)));
    const firstTall = tallest.findIndex((floors) => floors === MAX_STACK) + 1;
    expect(firstTall).toBe(51);
    const flat = CHAPTERS.filter((chapter) => chapter.maxStack < MAX_STACK).flatMap((chapter) => chapter.parts);
    expect(firstTall).toBe(1 + flat.reduce((sum, part) => sum + part.count, 0));
    for (const level of levels) {
      if (level < firstTall) expect(tallest[level - 1], `${level}단계`).toBeLessThan(MAX_STACK);
      else expect(tallest[level - 1], `${level}단계`).toBe(MAX_STACK);
    }
  });

  it('구간에서 고르는 판의 수를 모두 더하면 단계 수이고, 구간은 더 길게 뽑는 차례로 놓여 있다', () => {
    const parts = CHAPTERS.flatMap((chapter) => chapter.parts);
    expect(parts.reduce((sum, part) => sum + part.count, 0)).toBe(STAGE_LEVELS);
    expect(Math.max(...parts.map((part) => part.pins))).toBe(LEVEL_MAX_PINS);
    for (let index = 1; index < CHAPTERS.length; index += 1) {
      expect(CHAPTERS[index].pulls[0]).toBeGreaterThan(CHAPTERS[index - 1].pulls[1]);
      expect(CHAPTERS[index].maxStack).toBeGreaterThanOrEqual(CHAPTERS[index - 1].maxStack);
    }
    // 처음의 도움말은 첫 구간에서만 보인다.
    expect(CHAPTERS[0].parts.reduce((sum, part) => sum + part.count, 0)).toBe(HINT_LEVELS);
  });

  it('더 길게 뽑아야 하는 판이 처음 나오는 자리 말고는, 아무렇게나 뽑아 이길 확률이 뒤로 갈수록 낮아진다', () => {
    const solved = levels.map((level) => solve(levelPuzzle(level)));
    for (let index = 1; index < solved.length; index += 1) {
      if (solved[index].shortest?.length !== solved[index - 1].shortest?.length) continue;
      // 괴물이 있는 판을 조금 더 어렵게 치므로, 그만큼은 확률이 높아도 뒤에 올 수 있다.
      const most = winShare(solved[index - 1]) * Math.exp(MONSTER_SCORE) + 1e-9;
      expect(winShare(solved[index]), `${index + 1}단계`).toBeLessThanOrEqual(most);
    }
  });

  it('화면에 들어가는 모양이다', () => {
    for (const level of levels) {
      const { shafts } = levelPuzzle(level);
      expect(shafts.length).toBeGreaterThanOrEqual(MIN_SHAFTS);
      expect(shafts.length).toBeLessThanOrEqual(MAX_SHAFTS);
      for (const shaft of shafts) expect(shaft.length).toBeLessThanOrEqual(MAX_STACK);
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

  it('통로의 순서만 다른 판은 같은 이름이다', () => {
    const one = parsePuzzle('tl/w/l');
    const other = parsePuzzle('l/w/tl');
    const different = parsePuzzle('lt/w/l');
    expect(one && other && puzzleKind(one) === puzzleKind(other)).toBe(true);
    expect(one && different && puzzleKind(one) === puzzleKind(different)).toBe(false);
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

  it('괴물을 물리치는 법은 괴물이 나오는 처음 몇 단계에서만 알려 준다', () => {
    const noted = levels.filter((level) => levelShowsMonsterNote(level));
    const monsters = levels.filter((level) => levelPuzzle(level).monster);
    expect(noted).toEqual(monsters.slice(0, MONSTER_NOTE_LEVELS));
    expect(noted).toHaveLength(MONSTER_NOTE_LEVELS);
  });
});
