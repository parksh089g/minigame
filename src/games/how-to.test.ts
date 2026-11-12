import { describe, expect, it } from 'vitest';
import { HOW_TO, HOW_TO_LINE_CHARS, HOW_TO_MAX_LINES, howToFor, STAGE_HOW_TO } from './how-to';
import { LANTERN_GAME_ID } from './lantern-keeper/data';
import { GAMES, stageGames } from './registry';
import { COMPANY_GAME_ID } from './sprout-company/data';

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

/** 방법을 따로 적지 않는 게임. 등불지기와 새싹 컴퍼니는 제 화면에서 따로 안내한다. */
const WITHOUT_HOW_TO = new Set<string>([LANTERN_GAME_ID, COMPANY_GAME_ID]);

/** 점수 도전의 방법과 단계 모드의 방법을 한데 모은 것 */
const ALL_LINES: Array<[string, readonly string[]]> = [
  ...Object.entries(HOW_TO),
  ...Object.entries(STAGE_HOW_TO).map(([id, lines]): [string, readonly string[]] => [`단계 ${id}`, lines]),
];

describe('게임 방법', () => {
  const playable = GAMES.filter((game) => game.sceneKey !== null);

  it('단계 모드가 있는 게임마다 단계 모드의 방법이 따로 적혀 있다', () => {
    expect(Object.keys(STAGE_HOW_TO).sort()).toEqual(stageGames().map((game) => game.id).sort());
    for (const game of stageGames()) {
      expect(howToFor(game.id, true), game.id).toBe(STAGE_HOW_TO[game.id]);
      expect(howToFor(game.id), game.id).toBe(HOW_TO[game.id]);
      // 단계 모드는 시간을 재지 않는다: 시간이 깎이거나 다 된다는 말이 없어야 한다.
      for (const line of STAGE_HOW_TO[game.id]) expect(line, game.id).not.toMatch(/시간이|초가/);
    }
  });

  it('단계 모드의 방법이 따로 없는 게임은 여느 때의 방법을 준다', () => {
    expect(howToFor('lightning-tap', true)).toBe(HOW_TO['lightning-tap']);
    expect(howToFor('no-such-game', true)).toBeNull();
  });

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
    for (const [id, lines] of ALL_LINES) {
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
    for (const [id, lines] of ALL_LINES) {
      for (const line of lines) {
        for (const letter of line.match(/[ㄱ-ㆎ가-힣]/g) ?? []) {
          expect(known.has(letter), `${id}: "${letter}" in "${line}"`).toBe(true);
        }
      }
    }
  });
});
