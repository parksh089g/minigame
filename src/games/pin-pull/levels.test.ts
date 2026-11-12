import { describe, expect, it } from 'vitest';
import { seededRandom, STAGE_LEVELS } from '../../core/stages';
import {
  HINT_MAX_PINS,
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

/** 핀 수마다 고르는 판의 수. 모두 더하면 단계 수다. */
const QUOTA: Readonly<Record<number, number>> = { 3: 1, 4: 9, 5: 16, 6: 22, 7: 26, 8: 26 };
/** 아무렇게나 뽑아 이길 확률이 이보다 높은 판은 싱거워서 쓰지 않는다. */
const MAX_WIN_SHARE = 0.34;

interface Candidate {
  puzzle: Puzzle;
  kind: string;
  /** 클수록 어렵다 */
  score: number;
}

/** 방 count개를 통로에 나눠 담는 방법. 통로의 순서는 따지지 않으므로 큰 통로부터 적은 것만 낸다. */
function shapesOf(count: number): number[][] {
  const shapes: number[][] = [];
  for (let stacked = 0; stacked * MAX_STACK <= count; stacked += 1) {
    const single = count - stacked * MAX_STACK;
    const shafts = stacked + single;
    if (shafts < MIN_SHAFTS || shafts > MAX_SHAFTS) continue;
    shapes.push([...Array<number>(stacked).fill(MAX_STACK), ...Array<number>(single).fill(1)]);
  }
  return shapes;
}

/** 핀이 pins개인 판 가운데 풀 수 있고 질 수도 있고 싱겁지 않은 것을 모두, 쉬운 것부터 */
function candidatesOf(pins: number): Candidate[] {
  const count = pins - 1;
  const found = new Map<string, Candidate>();
  for (const shape of shapesOf(count)) {
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
          const solution = solve(puzzle);
          if (!solution.shortest || solution.winning === solution.orders) continue;
          const share = winShare(solution);
          if (share > MAX_WIN_SHARE) continue;
          const score = -Math.log(share) + 0.3 * (solution.shortest.length - 2) + (monster ? 0.2 : 0);
          found.set(kind, { puzzle, kind, score });
        }
      }
    }
  }
  // 점수가 같으면 이름 순서로 놓아서, 언제 만들어도 같은 표가 나오게 한다.
  return [...found.values()].sort((a, b) => a.score - b.score || (a.kind < b.kind ? -1 : 1));
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

/** 핀 수마다 쉬운 것부터 어려운 것까지 고르게 QUOTA만큼 골라 단계 순서로 늘어놓는다. */
function pickLevels(): string[] {
  const codes: string[] = [];
  for (const [pins, quota] of Object.entries(QUOTA)) {
    const pool = candidatesOf(Number(pins));
    for (let turn = 0; turn < quota; turn += 1) {
      const at = quota === 1 ? 0 : Math.round((turn * (pool.length - 1)) / (quota - 1));
      codes.push(puzzleCode(arranged(pool[at])));
    }
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

  it('핀이 적은 판에서 시작해 가장 많은 판으로 끝나고, 도중에 줄지 않는다', () => {
    const pins = levels.map((level) => pinCount(levelPuzzle(level)));
    expect(pins[0]).toBe(3);
    expect(pins[pins.length - 1]).toBe(LEVEL_MAX_PINS);
    for (let index = 1; index < pins.length; index += 1) {
      expect(pins[index]).toBeGreaterThanOrEqual(pins[index - 1]);
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
  });

  it('읽을 수 없는 것은 null이다', () => {
    expect(parsePuzzle('')).toBeNull();
    expect(parsePuzzle('t')).toBeNull();
    expect(parsePuzzle('t/x')).toBeNull();
    expect(parsePuzzle('l/w')).toBeNull();
    expect(parsePuzzle('t/t')).toBeNull();
    expect(parsePuzzle('tlw/w')).toBeNull();
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

  it('처음의 도움말은 핀이 가장 적은 단계에서만 보인다', () => {
    expect(levelShowsHints(1)).toBe(true);
    expect(levelShowsHints(STAGE_LEVELS)).toBe(false);
    for (const level of levels) {
      expect(levelShowsHints(level)).toBe(pinCount(levelPuzzle(level)) <= HINT_MAX_PINS);
    }
  });

  it('괴물을 물리치는 법은 괴물이 나오는 처음 몇 단계에서만 알려 준다', () => {
    const noted = levels.filter((level) => levelShowsMonsterNote(level));
    const monsters = levels.filter((level) => levelPuzzle(level).monster);
    expect(noted).toEqual(monsters.slice(0, MONSTER_NOTE_LEVELS));
    expect(noted).toHaveLength(MONSTER_NOTE_LEVELS);
  });
});
