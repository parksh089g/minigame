/**
 * 가게의 "꾹 누르면 자세히" 말풍선을 언제까지 띄우는지(rules.ts)와 그 글을 본다.
 * 화면에 실제로 뜨고 걷히는 것은 e2e/garden-hold-hint.e2e.ts가 본다.
 */
import { describe, expect, it } from 'vitest';
import { HOW_TO } from '../how-to';
import { GARDEN_GAME_ID } from './data';
import { countHoldHint, createMeta, HOLD_HINT_SHOPS, learnHoldHint, normalizeMeta, plowField, showsHoldHint } from './rules';
import { SHOP_TEXT } from './shop-text';

/** 주아 글꼴에 들어 있는 한글: KS X 1001의 완성형 2,350자(how-to.test.ts와 같은 셈) */
function fontSyllables(): Set<string> {
  const decoder = new TextDecoder('euc-kr');
  const syllables = new Set<string>();
  for (let lead = 0xb0; lead <= 0xc8; lead += 1) {
    for (let trail = 0xa1; trail <= 0xfe; trail += 1) syllables.add(decoder.decode(new Uint8Array([lead, trail])));
  }
  return syllables;
}

describe('꾹 누르기 안내', () => {
  it('처음에는 띄우고, 띄운 가게가 HOLD_HINT_SHOPS가 되면 그만 띄운다', () => {
    let meta = createMeta();
    for (let shop = 0; shop < HOLD_HINT_SHOPS; shop += 1) {
      expect(showsHoldHint(meta), `${shop + 1}번째 가게`).toBe(true);
      meta = countHoldHint(meta);
    }
    expect(showsHoldHint(meta)).toBe(false);
    // 다 띄운 뒤에는 세지 않고 그대로 돌려준다(저장하지 않아도 된다).
    expect(countHoldHint(meta)).toBe(meta);
  });

  it('꾹 눌러 보면 바로 그만 띄우고, 이미 그렇다면 그대로 돌려준다', () => {
    const learned = learnHoldHint(countHoldHint(createMeta()));
    expect(showsHoldHint(learned)).toBe(false);
    expect(learnHoldHint(learned)).toBe(learned);
  });

  it('저장을 읽을 때: 이 항목이 없는 옛 저장은 처음부터 띄우고, 망가지거나 너무 큰 값은 맞춘다', () => {
    expect(normalizeMeta({ version: 4, runs: 12 }).holdHint).toBe(0);
    expect(normalizeMeta({ version: 4, holdHint: 'x' }).holdHint).toBe(0);
    expect(normalizeMeta({ version: 4, holdHint: 1 }).holdHint).toBe(1);
    expect(normalizeMeta({ version: 4, holdHint: 1e9 }).holdHint).toBe(HOLD_HINT_SHOPS);
    expect(showsHoldHint(normalizeMeta(learnHoldHint(createMeta())))).toBe(false);
  });

  it('새 밭을 일궈도 다시 띄우지 않는다', () => {
    const meta = { ...learnHoldHint(createMeta()), best: 50 };
    expect(showsHoldHint(plowField(meta))).toBe(false);
  });

  it('말풍선의 글은 짧고 글꼴에 있는 글자만 쓰며, 게임 방법에도 꾹 누르기가 적혀 있다', () => {
    const known = fontSyllables();
    // 글씨 10에서 한글 한 자는 10px 안쪽이다. 좌우 여백과 커지는 몫을 빼도 240 폭에 들어간다.
    expect(SHOP_TEXT.holdHint.length).toBeLessThanOrEqual(22);
    for (const char of SHOP_TEXT.holdHint) {
      if (/[가-힣]/.test(char)) expect(known.has(char), char).toBe(true);
    }
    expect(HOW_TO[GARDEN_GAME_ID].some((line) => line.includes('꾹 누르면'))).toBe(true);
  });
});
