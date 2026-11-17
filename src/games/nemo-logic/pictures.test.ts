import { describe, expect, it } from 'vitest';
import { GAME_WIDTH, MIN_GAME_HEIGHT } from '../../config';
import { STAGE_LEVELS } from '../../core/stages';
import { colorsOf, paintedOf, PICTURE_COLORS, PICTURES } from './pictures';
import {
  boardArea,
  boardLayout,
  difficultyOf,
  fitsArea,
  MAX_COLS,
  MAX_ROWS,
  MAX_RUNS,
  MIN_CELL,
  picturePuzzle,
  solve,
} from './rules';

/** 주아 글꼴에 들어 있는 한글: KS X 1001의 완성형 2,350자 (how-to.test.ts와 같은 방법) */
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

/** 미니게임 화면 위쪽 HUD의 높이(scenes/GameHud.ts의 HUD_HEIGHT). 그 파일은 Phaser를 끌어와서 여기서는 값만 적는다. */
const HUD_HEIGHT = 56;

const average = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
const areaOf = (rows: readonly string[]): number => rows.length * rows[0].length;

describe('네모 로직의 그림', () => {
  it('단계마다 하나씩 있다', () => {
    expect(PICTURES).toHaveLength(STAGE_LEVELS);
  });

  it('이름이 서로 다르고, 글꼴에 들어 있는 한글로만 적는다', () => {
    const known = fontSyllables();
    expect(known.size).toBe(2350);
    expect(new Set(PICTURES.map((picture) => picture.name)).size).toBe(PICTURES.length);
    for (const { name } of PICTURES) {
      expect(name.trim(), name).toBe(name);
      expect(name.length, name).toBeGreaterThan(0);
      expect(name.length, name).toBeLessThanOrEqual(8);
      expect(name, name).toMatch(/^[가-힣 ]+$/);
      for (const letter of name.replaceAll(' ', '')) expect(known.has(letter), `${name}: ${letter}`).toBe(true);
    }
  });

  it('줄의 길이가 모두 같고, 정해 둔 색의 글자와 점으로만 그린다', () => {
    for (const { name, rows } of PICTURES) {
      expect(rows.length, name).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.length, name).toBe(rows[0].length);
        for (const letter of row) {
          if (letter !== '.') expect(PICTURE_COLORS[letter], `${name}: ${letter}`).toBeDefined();
        }
      }
      // 칠하는 칸마다 색이 있고, 비워 두는 칸에는 없다.
      const painted = paintedOf({ name, rows });
      colorsOf({ name, rows }).forEach((color, cell) => expect(color !== null, name).toBe(painted[cell]));
    }
  });

  it('서로 다른 그림이다', () => {
    expect(new Set(PICTURES.map((picture) => picture.rows.join('/'))).size).toBe(PICTURES.length);
    // 색을 빼고 보아도(문제로는) 같은 것이 없다.
    const problems = PICTURES.map((picture) => picture.rows.map((row) => row.replace(/[^.]/g, '#')).join('/'));
    expect(new Set(problems).size).toBe(PICTURES.length);
  });

  it('가장 큰 판을 넘지 않고, 빈 줄이 없고, 한 줄의 숫자가 너무 많지 않다', () => {
    for (const picture of PICTURES) {
      const puzzle = picturePuzzle(picture);
      expect(puzzle.cols, picture.name).toBeLessThanOrEqual(MAX_COLS);
      expect(puzzle.rows, picture.name).toBeLessThanOrEqual(MAX_ROWS);
      expect(puzzle.cols, picture.name).toBeGreaterThanOrEqual(5);
      expect(puzzle.rows, picture.name).toBeGreaterThanOrEqual(5);
      for (const clue of [...puzzle.rowClues, ...puzzle.colClues]) {
        expect(clue.length, picture.name).toBeGreaterThanOrEqual(1);
        expect(clue.length, picture.name).toBeLessThanOrEqual(MAX_RUNS);
      }
    }
  });

  it('어느 그림이든 찍지 않고 한 줄씩 따져서 풀리고, 풀면 바로 그 그림이 된다', () => {
    for (const picture of PICTURES) {
      const puzzle = picturePuzzle(picture);
      const { solved, known } = solve(puzzle);
      expect(solved, picture.name).toBe(true);
      expect(
        known.map((mark) => mark === 1),
        picture.name,
      ).toEqual(paintedOf(picture));
    }
  });

  it('작은 그림부터 큰 그림으로 놓여 있고, 뒤로 갈수록 풀기 어렵다', () => {
    const areas = PICTURES.map((picture) => areaOf(picture.rows));
    for (let at = 1; at < areas.length; at += 1) {
      expect(areas[at], PICTURES[at].name).toBeGreaterThanOrEqual(areas[at - 1]);
    }
    expect(areas[0]).toBe(25);
    expect(areas.at(-1)).toBe(MAX_COLS * MAX_ROWS);

    const difficulty = PICTURES.map((picture) => difficultyOf(picturePuzzle(picture)));
    expect(difficulty.every(Number.isFinite)).toBe(true);
    // 스무 단계씩 묶어 보면 묶음마다 앞 묶음보다 어렵다.
    const chunks = [0, 20, 40, 60, 80].map((from) => average(difficulty.slice(from, from + 20)));
    for (let at = 1; at < chunks.length; at += 1) expect(chunks[at]).toBeGreaterThan(chunks[at - 1]);
  });

  it('마지막 세 장은 앞의 어느 그림보다 여러 바퀴를 따져야 풀리고, 끝으로 갈수록 깊다', () => {
    const sweeps = PICTURES.map((picture) => solve(picturePuzzle(picture)).sweeps);
    const finale = sweeps.slice(-3);
    const before = Math.max(...sweeps.slice(0, -3));
    expect(finale[0]).toBeGreaterThanOrEqual(before);
    expect(finale[1]).toBeGreaterThan(before);
    expect(finale[2]).toBeGreaterThan(finale[1]);
    // 가장 큰 판의 크기 그대로다.
    for (const picture of PICTURES.slice(-3)) expect(areaOf(picture.rows)).toBe(MAX_COLS * MAX_ROWS);
  });

  it('가장 작은 화면에도 누를 만한 크기의 칸으로 다 들어간다', () => {
    PICTURES.forEach((picture, index) => {
      const puzzle = picturePuzzle(picture);
      // 처음 두 단계는 판 위에 안내 글 자리를 둔다.
      const area = boardArea(GAME_WIDTH, MIN_GAME_HEIGHT, HUD_HEIGHT, index + 1);
      const layout = boardLayout(puzzle, area);
      expect(layout.cell, picture.name).toBeGreaterThanOrEqual(MIN_CELL);
      expect(fitsArea(puzzle, layout, area), picture.name).toBe(true);
    });
  });
});
