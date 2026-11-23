/** 하이로우 칩 걸기의 기기 기록: 가장 많이 남긴 칩. 하트 모드의 최고 점수(공용 기록)와 따로 둔다. */
const KEY = 'pocket-arcade:high-low-chips';

export interface ChipRecord {
  best: number;
  plays: number;
}

const count = (value: unknown): number => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0);

export function readChipRecord(raw: unknown): ChipRecord {
  if (typeof raw !== 'object' || raw === null) return { best: 0, plays: 0 };
  const value = raw as { best?: unknown; plays?: unknown };
  return { best: count(value.best), plays: count(value.plays) };
}

export const chipRecord = {
  get(): ChipRecord {
    try {
      const text = localStorage.getItem(KEY);
      return readChipRecord(text ? JSON.parse(text) : null);
    } catch {
      return { best: 0, plays: 0 };
    }
  },
  /** 한 판을 마쳤다. 최고 기록을 넘었으면 true */
  add(chips: number): boolean {
    const record = chipRecord.get();
    const beat = chips > record.best;
    try {
      localStorage.setItem(KEY, JSON.stringify({ best: Math.max(record.best, chips), plays: record.plays + 1 }));
    } catch {
      // 적을 곳이 없으면 기록이 남지 않을 뿐이다.
    }
    return beat;
  },
};
