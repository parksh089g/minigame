/**
 * 퍼즐 단계 모드: 시간 제한 없이 1단계부터 차례로 깨는 모드의 공통 규칙.
 * 단계 번호에서 늘 같은 판이 나오게 하는 난수, 어디까지 깼는지의 기록, 깼을 때의 코인을 다룬다.
 * 화면과 떨어진 순수 함수만 둔다. 게임마다 단계를 어떻게 만드는지는 그 게임의 rules.ts에 있다.
 */

/** 게임마다의 단계 수 */
export const STAGE_LEVELS = 100;
/** 단계를 처음 깼을 때 받는 코인 */
export const STAGE_COINS = 3;
/** 이 수의 배수인 단계는 고비라서 코인을 더 준다. */
export const MILESTONE_EVERY = 10;
export const MILESTONE_COINS = 15;
/** 실수할 수 있는 게임에서 한 단계에 주어지는 기회 */
export const STAGE_HEARTS = 3;

/** 게임 id → 깬 가장 높은 단계. 한 단계도 깨지 않은 게임은 들어 있지 않다. */
export type StageProgress = Readonly<Record<string, number>>;

/**
 * 문자열에서 난수 생성기를 만든다. 같은 문자열이면 언제나 같은 수들이 같은 차례로 나온다.
 * Math.random 자리에 그대로 넣어 쓴다.
 */
export function seededRandom(seed: string): () => number {
  // FNV-1a로 씨앗을 섞고 mulberry32로 이어 간다.
  let state = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    state ^= seed.charCodeAt(i);
    state = Math.imul(state, 0x01000193);
  }
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 그 게임의 그 단계를 만드는 난수. 누구에게나, 몇 번을 다시 해도 같은 판이 나온다. */
export function stageRandom(gameId: string, level: number): () => number {
  return seededRandom(`stage:${gameId}:${toLevel(level)}`);
}

/** 단계 번호를 1부터 STAGE_LEVELS까지의 정수로 맞춘다. */
export function toLevel(level: number): number {
  if (!Number.isFinite(level)) return 1;
  return Math.min(STAGE_LEVELS, Math.max(1, Math.floor(level)));
}

/**
 * 난이도가 steps칸일 때 step번째(0부터) 칸이 시작하는 단계.
 * 쉬운 칸은 짧게 지나가고 어려운 칸에 오래 머문다: 뒤의 칸일수록 그 칸의 단계가 많다.
 * 어느 기기에서나 같은 값이 나오도록 정수 계산만 쓴다.
 */
export function stepStart(step: number, steps: number): number {
  const count = Math.max(1, Math.floor(steps));
  const at = Math.min(count - 1, Math.max(0, Math.floor(step)));
  return 1 + Math.floor((STAGE_LEVELS * at * (at + count)) / (2 * count * count));
}

/**
 * 단계 번호를 그 게임의 난이도 번호(first부터 steps칸)로 바꾼다.
 * 점수 도전에서는 판마다 어려워지지만, 단계 모드는 같은 난이도의 판을 여러 개 풀고 나서 넘어가고,
 * 마지막 단계 무렵에야 가장 어려운 칸에 닿는다.
 * 칸은 판 크기 같은 굵은 설정만 정한다. 같은 칸 안에서 조금씩 어려워지게 하는 것은 게임마다 stepProgress나 pickBest로 한다.
 */
export function difficultyOf(level: number, steps: number, first = 1): number {
  const count = Math.max(1, Math.floor(steps));
  const at = toLevel(level);
  let step = 0;
  while (step + 1 < count && stepStart(step + 1, count) <= at) step += 1;
  return first + step;
}

/**
 * 그 단계가 자기 난이도 칸 안에서 얼마나 뒤쪽인지: 칸의 첫 단계가 0, 마지막 단계가 1.
 * 같은 칸 안에서도 뒤로 갈수록 조금씩 어려워지게 할 때 쓴다. 단계가 하나뿐인 칸은 0이다.
 */
export function stepProgress(level: number, steps: number): number {
  const count = Math.max(1, Math.floor(steps));
  const at = toLevel(level);
  const step = difficultyOf(at, count, 0);
  const from = stepStart(step, count);
  const to = step + 1 < count ? stepStart(step + 1, count) - 1 : STAGE_LEVELS;
  return to > from ? (at - from) / (to - from) : 0;
}

/** 첫 단계가 0, 마지막 단계가 1인, 100단계 전체에서의 자리 */
export function levelProgress(level: number): number {
  return (toLevel(level) - 1) / (STAGE_LEVELS - 1);
}

/**
 * 판을 count개 만들어 보고 점수가 가장 높은 것을 고른다. 점수가 같으면 먼저 만든 것을 쓴다.
 * 난이도 칸의 설정(판 크기 같은 것)은 몇 단계에 한 번씩만 바뀌므로, 그 사이의 단계들은
 * 여러 판 가운데 그 단계에 맞는 어려움의 판을 골라서 조금씩 어려워지게 한다.
 * make와 score가 같은 난수를 이어 쓰면 같은 단계에서는 언제나 같은 판이 골라진다.
 */
export function pickBest<T>(count: number, make: () => T, score: (item: T) => number): T {
  let best = make();
  let top = score(best);
  for (let made = 1; made < Math.floor(count); made += 1) {
    const item = make();
    const points = score(item);
    if (points > top) {
      best = item;
      top = points;
    }
  }
  return best;
}

/** 저장소에서 읽은 값을 안전한 기록으로 바꾼다. */
export function normalizeStages(raw: unknown): StageProgress {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const progress: Record<string, number> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || id.length === 0) continue;
    const cleared = Math.min(STAGE_LEVELS, Math.floor(value));
    if (cleared >= 1) progress[id] = cleared;
  }
  return progress;
}

/** 그 게임에서 깬 가장 높은 단계. 아직 없으면 0 */
export function clearedOf(progress: StageProgress, gameId: string): number {
  return progress[gameId] ?? 0;
}

/** 여러 게임에서 깬 단계를 모두 더한다. */
export function totalCleared(progress: StageProgress, gameIds: readonly string[]): number {
  return gameIds.reduce((sum, id) => sum + clearedOf(progress, id), 0);
}

/** 다음에 깰 단계. 끝까지 다 깼으면 null */
export function nextLevel(progress: StageProgress, gameId: string): number | null {
  const cleared = clearedOf(progress, gameId);
  return cleared >= STAGE_LEVELS ? null : cleared + 1;
}

/** 그 단계를 할 수 있는지: 이미 깬 단계와 바로 다음 단계만 열려 있다. */
export function isUnlocked(progress: StageProgress, gameId: string, level: number): boolean {
  if (!Number.isInteger(level) || level < 1 || level > STAGE_LEVELS) return false;
  return level <= clearedOf(progress, gameId) + 1;
}

/** 그 단계를 처음 깼을 때 받는 코인 */
export function stageCoins(level: number): number {
  return toLevel(level) % MILESTONE_EVERY === 0 ? MILESTONE_COINS : STAGE_COINS;
}

export interface StageClear {
  progress: StageProgress;
  /** 이 단계를 처음 깼는지. 이미 깬 단계를 다시 깨면 false */
  first: boolean;
  /** 받는 코인. 처음 깼을 때만 있다. */
  coins: number;
}

/**
 * 단계를 깬 것을 기록한다. 원본은 바꾸지 않는다.
 * 아직 열리지 않은 단계(건너뛴 단계)는 기록하지 않고 null을 돌려준다.
 */
export function clearLevel(progress: StageProgress, gameId: string, level: number): StageClear | null {
  if (gameId.length === 0 || !isUnlocked(progress, gameId, level)) return null;
  const first = level > clearedOf(progress, gameId);
  if (!first) return { progress, first, coins: 0 };
  return { progress: { ...progress, [gameId]: level }, first, coins: stageCoins(level) };
}
