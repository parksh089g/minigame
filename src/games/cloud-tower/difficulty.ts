/**
 * 구름 탑 모험의 난이도. 꼭대기까지 오르면 다음 난이도가 열리고, 난이도마다 판을 어렵게 하는 규칙이 하나씩 더해진다.
 * 난이도 3이면 1, 2, 3의 규칙이 모두 걸린다. 0은 처음 그대로의 판이다.
 * 규칙은 이 파일에 모아 두고, run.ts는 판을 열 때와 싸움, 가게, 대장을 넘을 때 여기 함수를 한 번씩 부른다.
 */
import type { Battle } from './battle';
import type { RunState } from './run';

export interface DifficultyRule {
  /** 화면에 보이는 한 줄 */
  text: string;
}

/** 난이도 1부터 차례로 더해지는 규칙 */
export const DIFFICULTY_RULES: readonly DifficultyRule[] = [
  { text: '보통 적의 체력이 10% 늘어요' },
  { text: '처음 별사탕이 절반이에요' },
  { text: '강한 적이 힘 1을 갖고 나와요' },
  { text: '쉼터에서 10% 덜 회복해요' },
  { text: '가게 값이 20% 비싸요' },
  { text: '대장의 체력이 15% 늘어요' },
  { text: '대장을 넘어도 잃은 체력의 절반만 차요' },
  { text: '모든 적이 힘 1을 더 갖고 나와요' },
];

export const MAX_DIFFICULTY = DIFFICULTY_RULES.length;

/** 꼭대기에 오르면 난이도마다 더 받는 구름 조각 */
export const DIFFICULTY_SHARDS = 5;

export const DIFFICULTY_TEXT = {
  name: (level: number): string => (level > 0 ? `난이도 ${level}` : '보통'),
  /** 준비 화면에서 고른 난이도의 설명 */
  blurb: (level: number): string =>
    level > 0
      ? `${DIFFICULTY_RULES[level - 1].text}${level > 1 ? `\n앞 난이도의 규칙 ${level - 1}개도 함께` : ''}`
      : '규칙이 더해지지 않은 처음 판이에요',
  hint: '꼭대기에 오르면 다음 난이도가 열려요',
  bonus: (level: number): string => `꼭대기 조각 +${level * DIFFICULTY_SHARDS}`,
} as const;

/** 저장에서 읽은 값을 0부터 MAX_DIFFICULTY 사이의 정수로 */
export const clampDifficulty = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(MAX_DIFFICULTY, Math.floor(value))) : 0;

/** 판의 난이도. 난이도가 생기기 전에 저장한 판은 0이다. */
export const difficultyOf = (run: RunState): number => clampDifficulty(run.difficulty);

/** 그 난이도에서 n번째 규칙(1부터)이 걸리는지 */
export const hasRule = (run: RunState, n: number): boolean => difficultyOf(run) >= n;

/** 판을 열 때: 처음 별사탕과 쉼터 회복 */
export function applyDifficultyStart(run: RunState): void {
  if (hasRule(run, 2)) run.gold = Math.floor(run.gold / 2);
  if (hasRule(run, 4)) run.restPercent = Math.max(10, run.restPercent - 10);
}

/** 싸움을 연 뒤: 적의 체력과 힘 */
export function applyDifficultyBattle(run: RunState, battle: Battle): void {
  let hpRate = 1;
  if (battle.kind === 'fight' && hasRule(run, 1)) hpRate = 1.1;
  if (battle.kind === 'boss' && hasRule(run, 6)) hpRate = 1.15;
  let strength = 0;
  if (battle.kind === 'elite' && hasRule(run, 3)) strength += 1;
  if (hasRule(run, 8)) strength += 1;
  for (const foe of battle.foes) {
    if (hpRate !== 1) {
      foe.maxHp = Math.round(foe.maxHp * hpRate);
      foe.hp = foe.maxHp;
    }
    if (strength > 0) foe.st.strength = (foe.st.strength ?? 0) + strength;
  }
}

/** 가게의 값 */
export function difficultyPrice(run: RunState, price: number): number {
  return hasRule(run, 5) ? Math.round(price * 1.2) : price;
}

/** 대장을 넘은 뒤의 체력 */
export function hpAfterBoss(run: RunState): number {
  if (!hasRule(run, 7)) return run.maxHp;
  return run.hp + Math.ceil((run.maxHp - run.hp) / 2);
}
