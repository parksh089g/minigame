/**
 * 번개 탭의 규칙과 난이도 곡선. 화면과 분리된 순수 함수라서 숫자만 바꿔 밸런스를 조정할 수 있다.
 * t는 게임 시작 후 지난 시간(초).
 */

/** 한 판 길이(초) */
export const ROUND_SECONDS = 30;

export type OrbKind = 'normal' | 'gold';

/** 구슬이 화면에 머무는 시간(초). 갈수록 짧아진다. */
export function orbLifetime(t: number, kind: OrbKind = 'normal'): number {
  const base = Math.max(0.65, 1.5 - 0.03 * t);
  return kind === 'gold' ? base * 0.8 : base;
}

/** 다음 구슬이 나오기까지의 간격(초). 갈수록 짧아진다. */
export function spawnInterval(t: number): number {
  return Math.max(0.3, 0.8 - 0.018 * t);
}

/** 동시에 떠 있을 수 있는 구슬 수. 7초마다 하나씩 늘어 최대 4개. */
export function maxOrbs(t: number): number {
  return Math.min(4, 1 + Math.floor(t / 7));
}

/** 금색 구슬이 나올 확률. 처음 4초 동안은 나오지 않는다. */
export function goldChance(t: number): number {
  return t < 4 ? 0 : 0.12;
}

/** 연속 명중 5번마다 구슬 하나당 보너스가 1점씩 붙는다(최대 +3). */
export function comboBonus(combo: number): number {
  return Math.min(3, Math.floor(Math.max(0, combo) / 5));
}

/**
 * 명중 한 번의 점수.
 * combo는 이번 명중 직전까지 이어진 연속 명중 횟수.
 */
export function pointsFor(kind: OrbKind, combo: number): number {
  return (kind === 'gold' ? 5 : 1) + comboBonus(combo);
}

/** 명중률(0~100 정수). 한 번도 누르지 않았으면 0. */
export function accuracy(hits: number, misses: number): number {
  const total = hits + misses;
  return total > 0 ? Math.round((hits / total) * 100) : 0;
}
