import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * 주아 글꼴에 들어 있는 한글: KS X 1001의 완성형 2,350자.
 * EUC-KR에서 첫 바이트 0xB0~0xC8, 둘째 바이트 0xA1~0xFE인 글자가 바로 그것이다.
 */
function fontSyllables(): Set<string> {
  const decoder = new TextDecoder('euc-kr');
  const syllables = new Set<string>();
  for (let lead = 0xb0; lead <= 0xc8; lead += 1) {
    for (let trail = 0xa1; trail <= 0xfe; trail += 1) syllables.add(decoder.decode(new Uint8Array([lead, trail])));
  }
  return syllables;
}

/** 친구와 하기를 붙이며 화면에 새로 적은 글이 있는 파일들 */
const FILES = [
  'src/versus/friends-kit.ts',
  'src/games/one-card/OneCardScene.ts',
  'src/games/one-card/text.ts',
  'src/games/blackjack/BlackjackScene.ts',
  'src/games/high-low/HighLowScene.ts',
];

describe('친구와 하기 화면의 글', () => {
  it('글꼴에 있는 한글만 쓴다(주석은 빼고 본다)', () => {
    const font = fontSyllables();
    for (const file of FILES) {
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      const strings = code.match(/(['`])(?:\\.|(?!\1)[^\\])*\1/g) ?? [];
      const missing = new Set<string>();
      for (const text of strings) for (const char of text) if (/[가-힣]/.test(char) && !font.has(char)) missing.add(char);
      expect([...missing], file).toEqual([]);
    }
  });
});
