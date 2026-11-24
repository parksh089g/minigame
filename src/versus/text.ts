/**
 * 친구와 하는 화면에서 쓰는 글 다듬기. 이름은 사람이 지은 것이라 받침이 있는지에 따라 조사를 고른다.
 */

/** 한글 낱자의 받침이 있는지. 한글이 아니면 null */
function hangulFinal(char: string): boolean | null {
  const code = char.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return null;
  return (code - 0xac00) % 28 !== 0;
}

/** 숫자를 읽었을 때 받침으로 끝나는 것: 영, 일, 삼, 육, 칠, 팔 */
const DIGIT_FINAL = new Set(['0', '1', '3', '6', '7', '8']);
/** 영문자를 읽었을 때 받침으로 끝나는 것: 엘, 엠, 엔, 알 */
const LETTER_FINAL = new Set(['l', 'm', 'n', 'r']);

/** 이름 끝을 읽었을 때 받침이 있는지 */
function endsWithFinal(name: string): boolean {
  const last = [...name.trim()].pop() ?? '';
  const hangul = hangulFinal(last);
  if (hangul !== null) return hangul;
  if (/\d/.test(last)) return DIGIT_FINAL.has(last);
  return LETTER_FINAL.has(last.toLowerCase());
}

/** 이름 + 이/가. 예: "민수가", "지원이", "2P가" */
export const withSubject = (name: string): string => `${name}${endsWithFinal(name) ? '이' : '가'}`;

/** 좁은 자리에 넣을 이름. 길면 끝을 줄인다. */
export function shortName(name: string, max = 6): string {
  const chars = [...name];
  return chars.length <= max ? name : `${chars.slice(0, max - 1).join('')}…`;
}

/** 이름 + 와/과. 예: "민수와", "지원과" */
export const withAnd = (name: string): string => `${name}${endsWithFinal(name) ? '과' : '와'}`;
