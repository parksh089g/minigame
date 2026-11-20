import { describe, expect, it } from 'vitest';
import { CARD_TYPE_ROWS, FOES, HERO, ITEM_ROWS, NODE_ROWS, STATUS_ROWS, TREASURE_ROWS, UPGRADE_ROWS, type Rows } from './sprites';

const groups: Record<string, Readonly<Record<string, Rows>>> = {
  hero: { hero: HERO },
  foe: FOES,
  status: STATUS_ROWS,
  node: NODE_ROWS,
  treasure: TREASURE_ROWS,
  upgrade: UPGRADE_ROWS,
  type: CARD_TYPE_ROWS,
  item: ITEM_ROWS,
};

describe('픽셀 그림', () => {
  it('줄마다 길이가 같고, 팔레트 글자만 쓰고, 정해진 칸 안에 들어간다', () => {
    for (const [group, all] of Object.entries(groups)) {
      const limit = group === 'foe' || group === 'hero' ? 16 : 9;
      for (const [id, rows] of Object.entries(all)) {
        const width = rows[0].length;
        for (const row of rows) {
          expect(row.length, `${group}.${id}: ${row}`).toBe(width);
          expect(row, `${group}.${id}`).toMatch(/^[0-9a-f.]+$/);
        }
        expect(width, `${group}.${id}`).toBeLessThanOrEqual(limit);
        expect(rows.length, `${group}.${id}`).toBeLessThanOrEqual(limit);
      }
    }
  });
});
