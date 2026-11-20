/**
 * 원카드의 설정(컴퓨터 실력, 상대 수)과 이긴 판 수. 이 기기에서만 쓰는 편의라 localStorage에 둔다.
 * 읽거나 쓸 수 없는 곳(사생활 보호 창 같은)에서는 기본값으로 한다.
 */
import { LEVELS, MAX_BOTS, MIN_BOTS, type Level } from './rules';

export interface OneCardPrefs {
  level: Level;
  bots: number;
  plays: number;
  wins: number;
}

const KEY = 'pocket-arcade:one-card';

export const DEFAULT_PREFS: OneCardPrefs = { level: 'normal', bots: 1, plays: 0, wins: 0 };

const count = (value: unknown): number => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0);

export function normalizePrefs(raw: unknown): OneCardPrefs {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PREFS };
  const value = raw as Record<string, unknown>;
  const level = LEVELS.includes(value.level as Level) ? (value.level as Level) : DEFAULT_PREFS.level;
  const bots = typeof value.bots === 'number' && value.bots >= MIN_BOTS && value.bots <= MAX_BOTS ? Math.floor(value.bots) : DEFAULT_PREFS.bots;
  const plays = count(value.plays);
  return { level, bots, plays, wins: Math.min(count(value.wins), plays) };
}

export function loadPrefs(): OneCardPrefs {
  try {
    const text = localStorage.getItem(KEY);
    return normalizePrefs(text ? JSON.parse(text) : null);
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: OneCardPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // 저장하지 못해도 판은 할 수 있다.
  }
}
