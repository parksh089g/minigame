import { describe, expect, it } from 'vitest';
import { SPRITES } from './sprites';

describe('스프라이트 데이터', () => {
  it.each(Object.entries(SPRITES))('%s: 줄 길이가 같고 팔레트 글자만 쓴다', (_key, rows) => {
    expect(rows.length).toBeGreaterThan(0);
    const width = rows[0].length;
    for (const row of rows) {
      expect(row).toHaveLength(width);
      expect(row).toMatch(/^[0-9a-f.]+$/);
    }
  });
});
