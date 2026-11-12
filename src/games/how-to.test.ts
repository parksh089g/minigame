import { describe, expect, it } from 'vitest';
import { HOW_TO, HOW_TO_LINE_CHARS, HOW_TO_MAX_LINES, howToFor } from './how-to';
import { LANTERN_GAME_ID } from './lantern-keeper/data';
import { GAMES } from './registry';

/**
 * 주아 글꼴에 들어 있는 한글: KS X 1001의 완성형 2,350자.
 * EUC-KR에서 첫 바이트 0xB0~0xC8, 둘째 바이트 0xA1~0xFE인 글자가 바로 그것이다.
 */
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

/** 방법을 따로 적지 않는 게임. 등불지기는 제 화면에서 따로 안내한다. */
const WITHOUT_HOW_TO = new Set([LANTERN_GAME_ID]);

describe('게임 방법', () => {
  const playable = GAMES.filter((game) => game.sceneKey !== null);

  it('할 수 있는 게임마다 방법이 적혀 있다', () => {
    for (const game of playable) {
      if (WITHOUT_HOW_TO.has(game.id)) continue;
      expect(howToFor(game.id), game.id).not.toBeNull();
    }
  });

  it('없는 게임의 방법은 적혀 있지 않다', () => {
    const ids = new Set(GAMES.map((game) => game.id));
    for (const id of Object.keys(HOW_TO)) expect(ids.has(id), id).toBe(true);
    expect(howToFor('no-such-game')).toBeNull();
    expect(howToFor(LANTERN_GAME_ID)).toBeNull();
  });

  it('가장 짧은 화면에 들어가는 길이다', () => {
    for (const [id, lines] of Object.entries(HOW_TO)) {
      expect(lines.length, id).toBeGreaterThanOrEqual(3);
      expect(lines.length, id).toBeLessThanOrEqual(HOW_TO_MAX_LINES);
      for (const line of lines) {
        expect(line.length, `${id}: ${line}`).toBeLessThanOrEqual(HOW_TO_LINE_CHARS);
        expect(line.trim(), `${id}: ${line}`).toBe(line);
      }
    }
  });

  it('글꼴에 들어 있는 한글만 쓴다', () => {
    const known = fontSyllables();
    expect(known.size).toBe(2350);
    // 완성형에 없는 글자를 실제로 걸러 내는지도 본다.
    expect(known.has('똠')).toBe(false);
    for (const [id, lines] of Object.entries(HOW_TO)) {
      for (const line of lines) {
        for (const letter of line.match(/[ㄱ-ㆎ가-힣]/g) ?? []) {
          expect(known.has(letter), `${id}: "${letter}" in "${line}"`).toBe(true);
        }
      }
    }
  });
});
