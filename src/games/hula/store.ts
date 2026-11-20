/**
 * 훌라의 전적: 난이도마다 이기고 진 판 수와 마지막으로 고른 난이도.
 * 허브 세이브(core/save.ts)와 따로 기기 안(localStorage)에 둬서 공용 세이브 구조를 건드리지 않는다.
 * 백업 파일과 기기 옮기기에는 같이 실려 간다.
 */
import { registerSavePart } from '../../core/bundle';
import { HULA_GAME_ID } from './data';
import { LEVELS, type Level } from './rules';

export interface LevelRecord {
  wins: number;
  losses: number;
}

export interface HulaRecord {
  level: Level;
  records: Record<Level, LevelRecord>;
}

const KEY = 'pocket-arcade:hula';

export function createRecord(): HulaRecord {
  return {
    level: 'normal',
    records: { easy: { wins: 0, losses: 0 }, normal: { wins: 0, losses: 0 }, hard: { wins: 0, losses: 0 } },
  };
}

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;

/** 저장된 값을 믿을 수 있는 모양으로 고친다. 맞지 않는 값은 처음 상태로 돌린다. */
export function normalizeRecord(raw: unknown): HulaRecord {
  const base = createRecord();
  if (typeof raw !== 'object' || raw === null) return base;
  const value = raw as { level?: unknown; records?: Record<string, { wins?: unknown; losses?: unknown } | undefined> };
  if (LEVELS.includes(value.level as Level)) base.level = value.level as Level;
  for (const level of LEVELS) {
    const record = value.records?.[level];
    if (record) base.records[level] = { wins: count(record.wins), losses: count(record.losses) };
  }
  return base;
}

function read(): HulaRecord {
  try {
    const text = localStorage.getItem(KEY);
    return normalizeRecord(text ? JSON.parse(text) : undefined);
  } catch {
    return createRecord();
  }
}

function write(record: HulaRecord): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    // 저장할 곳이 없으면 이번 세션 동안만 유지된다.
  }
}

export const hulaStore = {
  get data(): HulaRecord {
    return read();
  },
  set(record: HulaRecord): void {
    write(record);
  },
  /** 끝난 판을 전적에 넣는다. 비긴 판은 넣지 않는다. */
  addResult(level: Level, won: boolean | null): HulaRecord {
    const record = read();
    if (won === true) record.records[level].wins += 1;
    if (won === false) record.records[level].losses += 1;
    write(record);
    return record;
  },
};

registerSavePart(HULA_GAME_ID, {
  async read() {
    return read();
  },
  async write(raw) {
    if (raw === undefined) return;
    write(normalizeRecord(raw));
  },
});
