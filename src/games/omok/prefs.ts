/**
 * 오목의 설정(컴퓨터 실력, 내 돌)과 컴퓨터에게 이긴 판 수. 이 기기에서만 쓰는 편의라 localStorage에 둔다.
 * 읽거나 쓸 수 없는 곳(사생활 보호 창 같은)에서는 기본값으로 한다.
 */
import { LEVELS, type Level } from './rules';
import { COLOR_CHOICES, type ColorChoice } from './text';

export interface OmokPrefs {
  level: Level;
  color: ColorChoice;
  /** "번갈아"일 때 지난 판에 검은 돌을 쥐었는지 */
  lastBlack: boolean;
  plays: number;
  wins: number;
}

const KEY = 'pocket-arcade:omok';

export const DEFAULT_PREFS: OmokPrefs = { level: 'normal', color: 'black', lastBlack: false, plays: 0, wins: 0 };

const count = (value: unknown): number => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0);

export function normalizePrefs(raw: unknown): OmokPrefs {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PREFS };
  const value = raw as Record<string, unknown>;
  const level = LEVELS.includes(value.level as Level) ? (value.level as Level) : DEFAULT_PREFS.level;
  const color = COLOR_CHOICES.includes(value.color as ColorChoice) ? (value.color as ColorChoice) : DEFAULT_PREFS.color;
  const plays = count(value.plays);
  return { level, color, lastBlack: value.lastBlack === true, plays, wins: Math.min(count(value.wins), plays) };
}

/** 이번 판에 내가 검은 돌을 쥐는지. "번갈아"면 지난 판과 반대다. */
export const playsBlack = (prefs: OmokPrefs): boolean => (prefs.color === 'alternate' ? !prefs.lastBlack : prefs.color === 'black');

export function loadPrefs(): OmokPrefs {
  try {
    const text = localStorage.getItem(KEY);
    return normalizePrefs(text ? JSON.parse(text) : null);
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: OmokPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // 저장하지 못해도 판은 할 수 있다.
  }
}
