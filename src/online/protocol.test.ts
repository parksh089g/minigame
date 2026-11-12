import { describe, expect, it } from 'vitest';
import { GAMES } from '../games/registry';
import {
  cleanCode,
  cleanName,
  cleanScore,
  CODE_ALPHABET,
  CODE_LENGTH,
  codeFrom,
  deviceIdFrom,
  formatCode,
  isDeviceId,
  isRankedGame,
  MAX_SCORE,
  NAME_MAX,
  RANK_SCAN,
  RANKED_GAMES,
  rankLabel,
} from './protocol';

describe('랭킹이 있는 게임', () => {
  it('허브에 있는 플레이할 수 있는 게임 가운데 점수가 있는 것과 같다', () => {
    const scored = GAMES.filter((game) => game.sceneKey !== null && !game.versus).map((game) => game.id);
    expect([...RANKED_GAMES].sort()).toEqual([...scored].sort());
  });

  it('승패로 끝나는 게임은 랭킹에 없다', () => {
    for (const game of GAMES.filter((entry) => entry.versus)) {
      expect(isRankedGame(game.id)).toBe(false);
      expect(game.dailyTargets).toEqual([]);
    }
  });

  it('목록에 없는 것은 받지 않는다', () => {
    expect(isRankedGame('lantern-keeper')).toBe(true);
    expect(isRankedGame('nope')).toBe(false);
    expect(isRankedGame(3)).toBe(false);
  });
});

describe('닉네임', () => {
  it('앞뒤 빈칸을 떼고 이어진 빈칸은 하나로 줄인다', () => {
    expect(cleanName('  등불   지기 ')).toBe('등불 지기');
    expect(cleanName('Mint_02')).toBe('Mint_02');
    expect(cleanName('a-b')).toBe('a-b');
    expect(cleanName('ㅋㅋ')).toBe('ㅋㅋ');
  });

  it('글자 수는 2자부터 10자까지다', () => {
    expect(cleanName('가')).toBeNull();
    expect(cleanName(' 가 ')).toBeNull();
    expect(cleanName('가'.repeat(NAME_MAX))).toBe('가'.repeat(NAME_MAX));
    expect(cleanName('가'.repeat(NAME_MAX + 1))).toBeNull();
  });

  it('기호, 그림 문자, 줄바꿈, 꾸밈 기호는 받지 않는다', () => {
    for (const bad of ['<b>hi</b>', '하이😀', 'á́́b', 'x;y', "o'neil", '한글​이름', '']) {
      expect(cleanName(bad), JSON.stringify(bad)).toBeNull();
    }
    // 줄바꿈과 탭은 빈칸으로 본다.
    expect(cleanName('가\n나')).toBe('가 나');
  });

  it('글자로 분류되지만 눈에 보이지 않는 채움 문자는 받지 않는다', () => {
    // 한글 채움 문자, 반각 한글 채움 문자, 첫소리 채움 문자, 가운뎃소리 채움 문자
    for (const filler of ['\u3164', '\uffa0', '\u115f', '\u1160']) {
      expect(cleanName(filler.repeat(3)), `U+${filler.codePointAt(0)?.toString(16)}`).toBeNull();
      expect(cleanName(`가${filler}나`), `U+${filler.codePointAt(0)?.toString(16)}`).toBeNull();
    }
    expect(cleanName('\u115f\u1160')).toBeNull();
  });

  it('풀어 쓴 한글은 모아서 센다', () => {
    const decomposed = '한글'.normalize('NFD');
    expect(decomposed.length).toBeGreaterThan(2);
    expect(cleanName(decomposed)).toBe('한글');
  });

  it('글자가 아니면 받지 않는다', () => {
    expect(cleanName(12)).toBeNull();
    expect(cleanName(null)).toBeNull();
    expect(cleanName('가'.repeat(500))).toBeNull();
  });
});

describe('기기 id와 점수', () => {
  it('무작위 바이트로 만든 id는 형식에 맞는다', () => {
    const id = deviceIdFrom(Uint8Array.from({ length: 16 }, (_, index) => index * 16 + 1));
    expect(id).toBe('01112131-4151-6171-8191-a1b1c1d1e1f1');
    expect(isDeviceId(id)).toBe(true);
  });

  it('형식이 다른 것은 id로 보지 않는다', () => {
    expect(isDeviceId('01112131-4151-6171-8191-A1B1C1D1E1F1')).toBe(false);
    expect(isDeviceId('01112131415161718191a1b1c1d1e1f1')).toBe(false);
    expect(isDeviceId("x' OR 1=1 --")).toBe(false);
    expect(isDeviceId(undefined)).toBe(false);
  });

  it('점수는 1 이상의 정수만 받는다', () => {
    expect(cleanScore(12.9)).toBe(12);
    expect(cleanScore(MAX_SCORE)).toBe(MAX_SCORE);
    for (const bad of [0, -5, 0.5, MAX_SCORE + 1, Number.NaN, Number.POSITIVE_INFINITY, '12', null]) {
      expect(cleanScore(bad), String(bad)).toBeNull();
    }
  });

  it('세는 범위 밖의 순위는 "밖"이라고 적는다', () => {
    expect(rankLabel(1)).toBe('1위');
    expect(rankLabel(RANK_SCAN)).toBe(`${RANK_SCAN}위`);
    expect(rankLabel(RANK_SCAN + 1)).toBe(`${RANK_SCAN}위 밖`);
  });
});

describe('옮기기 코드', () => {
  it('헷갈리는 글자가 없는 32자로 만든다', () => {
    expect(CODE_ALPHABET).toHaveLength(32);
    expect(new Set(CODE_ALPHABET).size).toBe(32);
    for (const confusing of '01IO') expect(CODE_ALPHABET).not.toContain(confusing);
    const code = codeFrom(Uint8Array.from([0, 31, 32, 63, 255, 7, 8, 9]));
    expect(code).toHaveLength(CODE_LENGTH);
    expect(code).toBe('2Z2ZZ9AB');
    expect(cleanCode(code)).toBe(code);
  });

  it('소문자, 빈칸, 붙임표를 봐준다', () => {
    expect(cleanCode('abcd-efgh')).toBe('ABCDEFGH');
    expect(cleanCode(' abcd efgh ')).toBe('ABCDEFGH');
    expect(formatCode('ABCDEFGH')).toBe('ABCD-EFGH');
  });

  it('길이가 다르거나 쓰지 않는 글자가 있으면 코드가 아니다', () => {
    for (const bad of ['ABCDEFG', 'ABCDEFGHJ', 'ABCD0EFG', 'ABCDIEFG', '가나다라마바사아', '', 'A'.repeat(100)]) {
      expect(cleanCode(bad), bad).toBeNull();
    }
    expect(cleanCode(12345678)).toBeNull();
  });
});
