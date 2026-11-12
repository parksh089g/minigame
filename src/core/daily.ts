/**
 * 오늘의 도전: 날짜마다 하나씩 정해지는 목표와 연속 달성 기록.
 * 도전은 날짜만으로 정해지므로 인터넷이 없어도 되고, 같은 날에는 어느 기기에서나 같은 도전이 나온다.
 * 저장소와 화면 어느 쪽에도 의존하지 않는 순수 함수들이다.
 */

/** 도전에 쓸 수 있는 게임. targets는 쉬운 것부터 어려운 것 순서의 목표 점수. */
export interface DailyGame {
  id: string;
  targets: readonly number[];
}

export interface DailyChallenge {
  /** 이 도전의 날짜(YYYY-MM-DD, 기기의 현지 날짜) */
  dateKey: string;
  gameId: string;
  /** 한 판에 이 점수 이상을 내면 달성 */
  target: number;
  /** 달성하면 받는 코인. 연속 보너스는 따로 붙는다. */
  reward: number;
}

/** 세이브에 남기는 달성 기록 */
export interface DailyState {
  /** 마지막으로 달성한 날짜. 한 번도 없으면 null */
  lastClearedOn: string | null;
  /** lastClearedOn까지 하루도 빠지지 않고 이어진 일수 */
  streak: number;
  /** 지금까지 가장 길게 이어 간 일수. 연속이 끊겨도 줄지 않는다(업적에 쓴다). */
  bestStreak: number;
  /** 지금까지 달성한 횟수 */
  totalCleared: number;
}

/** 목표가 어려울수록 보상이 크다. 목표 단계(쉬움부터)에 맞춰 쓴다. */
export const DAILY_REWARDS = [15, 25, 40] as const;
/** 연속으로 달성한 날마다 더해지는 보너스와 그 상한 */
const STREAK_STEP = 5;
const STREAK_BONUS_MAX = 25;

const DAY_MS = 86_400_000;
const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 기기의 현지 날짜를 YYYY-MM-DD로. 자정에 날짜가 바뀐다. */
export function dateKeyOf(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * 날짜를 하루에 1씩 늘어나는 수로 바꾼다. 날짜끼리의 간격을 셀 때 쓴다.
 * 형식이 틀리거나 없는 날짜(2월 30일 등)면 null.
 */
export function dayNumber(dateKey: string): number | null {
  const match = DATE_KEY.exec(dateKey);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const time = Date.UTC(year, month - 1, day);
  const check = new Date(time);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return null;
  }
  return Math.round(time / DAY_MS);
}

/** dayNumber의 반대: 하루에 1씩 늘어나는 수를 YYYY-MM-DD로 바꾼다. */
export function dateKeyOfDay(day: number): string {
  const date = new Date(day * DAY_MS);
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dayOfMonth = String(date.getUTCDate()).padStart(2, '0');
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${month}-${dayOfMonth}`;
}

/** 문자열에서 0 이상 1 미만의 수를 만든다. 같은 문자열이면 언제나 같은 수가 나온다. */
export function seededUnit(text: string): number {
  // FNV-1a로 섞은 뒤 mulberry32를 한 번 돌린다.
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  let t = (hash + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * 그 날짜의 도전을 정한다. 게임은 날마다 차례로 돌아가고, 목표 단계는 날짜에서 뽑는다.
 * 날짜가 잘못됐거나 쓸 수 있는 게임이 없으면 null.
 */
export function challengeFor(dateKey: string, games: readonly DailyGame[]): DailyChallenge | null {
  const day = dayNumber(dateKey);
  const usable = games.filter((game) => game.targets.length > 0);
  if (day === null || usable.length === 0) return null;

  const game = usable[((day % usable.length) + usable.length) % usable.length];
  const tier = Math.floor(seededUnit(dateKey) * game.targets.length);
  return {
    dateKey,
    gameId: game.id,
    target: game.targets[tier],
    reward: DAILY_REWARDS[Math.min(tier, DAILY_REWARDS.length - 1)],
  };
}

export function createDailyState(): DailyState {
  return { lastClearedOn: null, streak: 0, bestStreak: 0, totalCleared: 0 };
}

/** 저장소에서 읽은 값을 안전한 DailyState로 바꾼다. */
export function normalizeDaily(raw: unknown): DailyState {
  if (typeof raw !== 'object' || raw === null) return createDailyState();
  const value = raw as Record<string, unknown>;
  const count = (input: unknown): number =>
    typeof input === 'number' && Number.isFinite(input) ? Math.max(0, Math.floor(input)) : 0;

  const lastClearedOn =
    typeof value.lastClearedOn === 'string' && dayNumber(value.lastClearedOn) !== null
      ? value.lastClearedOn
      : null;
  if (lastClearedOn === null) return createDailyState();
  // 달성한 날이 있으면 연속 일수와 횟수는 적어도 1이고, 가장 긴 연속은 지금의 연속보다 짧을 수 없다.
  const streak = Math.max(1, count(value.streak));
  return {
    lastClearedOn,
    streak,
    bestStreak: Math.max(streak, count(value.bestStreak)),
    totalCleared: Math.max(1, count(value.totalCleared)),
  };
}

/**
 * 그 날짜의 도전을 이미 달성했는지.
 * 마지막으로 달성한 날보다 이른 날짜도 달성한 것으로 친다.
 * 기기 시계를 되돌려 같은 보상을 다시 받지 못하게 하려는 것이다.
 */
export function isCleared(state: DailyState, dateKey: string): boolean {
  if (state.lastClearedOn === null) return false;
  if (state.lastClearedOn === dateKey) return true;
  const today = dayNumber(dateKey);
  const last = dayNumber(state.lastClearedOn);
  return today !== null && last !== null && today < last;
}

/**
 * 그 날짜 기준으로 아직 이어지고 있는 연속 일수.
 * 어제나 오늘 달성했으면 이어지는 중이고, 하루라도 건너뛰었으면 0이다.
 * 시계가 마지막 달성일보다 앞으로 돌아가 있을 때는 그날을 이미 달성한 것으로 치므로 연속도 그대로다.
 */
export function activeStreak(state: DailyState, dateKey: string): number {
  const today = dayNumber(dateKey);
  const last = state.lastClearedOn === null ? null : dayNumber(state.lastClearedOn);
  if (today === null || last === null) return 0;
  return today - last <= 1 ? state.streak : 0;
}

/**
 * 그 날짜의 도전을 달성한 것으로 기록한 새 상태를 돌려준다.
 * 이미 달성했거나 마지막 달성일보다 이른 날짜면 그대로다.
 */
export function clearDaily(state: DailyState, dateKey: string): DailyState {
  if (isCleared(state, dateKey) || dayNumber(dateKey) === null) return state;
  const streak = activeStreak(state, dateKey) + 1;
  return {
    lastClearedOn: dateKey,
    streak,
    bestStreak: Math.max(state.bestStreak, streak),
    totalCleared: state.totalCleared + 1,
  };
}

/** 연속 달성 보너스 코인. 이틀째부터 하루에 5개씩 늘어 25개까지. */
export function streakBonus(streak: number): number {
  return Math.min(STREAK_BONUS_MAX, STREAK_STEP * Math.max(0, Math.floor(streak) - 1));
}
