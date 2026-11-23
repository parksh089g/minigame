/**
 * 상태 안에 넣어 두는 난수. 친구와의 판은 서버에 JSON으로 저장되고 수를 둘 때 난수를 따로 받지 않으므로,
 * 판을 나눈 뒤에 섞을 일이 있는 게임(블랙잭의 슈, 하이로우의 카드 묶음)은 seed를 판 안에 들고 다닌다.
 * seed는 앞으로 나올 카드를 알려 주므로 화면에 보내는 판(view)에서는 늘 지운다.
 */

/** 상태 안의 seed를 굴려 0 이상 1 미만의 수를 낸다(mulberry32). */
export function nextSeeded(state: { seed: number }): number {
  state.seed = (state.seed + 0x6d2b79f5) | 0;
  let t = state.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** 상태의 seed로 도는 난수 함수 */
export const seededRandom = (state: { seed: number }): (() => number) => () => nextSeeded(state);

/** 판을 시작할 때 쓸 seed를 바깥 난수에서 뽑는다. */
export const seedFrom = (random: () => number): number => Math.floor(random() * 0x7fffffff) | 0;
