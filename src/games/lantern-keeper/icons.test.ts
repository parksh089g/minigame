import { describe, expect, it } from 'vitest';
import { BOON_ORDER, EVOLVE_LEVEL, MAX_LEVEL, PASSIVES, WEAPON_ORDER, type PassiveId } from './data';
import { ICON_IDS, ICON_SIZE, ICONS, iconKey, passiveSlots, upgradeIcon, weaponSlots, withOutline } from './icons';

describe('강화 아이콘', () => {
  it('모든 아이콘은 같은 크기이고 팔레트 글자만 쓴다', () => {
    for (const id of ICON_IDS) {
      const rows = ICONS[id];
      expect(rows, id).toHaveLength(ICON_SIZE);
      for (const row of rows) expect(row, id).toMatch(new RegExp(`^[0-9a-f.]{${ICON_SIZE}}$`));
      // 빈 그림이 아니어야 한다.
      expect(rows.some((row) => /[0-9a-f]/.test(row)), id).toBe(true);
    }
  });

  it('무기는 보통 모습과 진화한 모습이 따로 있다', () => {
    for (const id of WEAPON_ORDER) {
      const base = upgradeIcon({ type: 'weapon', id, level: 1 });
      const top = upgradeIcon({ type: 'weapon', id, level: MAX_LEVEL });
      const evolved = upgradeIcon({ type: 'weapon', id, level: EVOLVE_LEVEL });
      expect(base).toBe(id);
      expect(top).toBe(id);
      expect(evolved).toBe(`${id}Evo`);
      expect(ICONS[evolved].join('')).not.toBe(ICONS[base].join(''));
    }
  });

  it('고를 수 있는 것마다 아이콘이 있다', () => {
    for (const id of Object.keys(PASSIVES) as PassiveId[]) {
      expect(ICONS[upgradeIcon({ type: 'passive', id, level: 1 })]).toBeDefined();
    }
    for (const id of BOON_ORDER) {
      expect(ICONS[upgradeIcon({ type: 'boon', id, level: 1 })]).toBeDefined();
    }
    expect(ICONS[upgradeIcon({ type: 'heal' })]).toBeDefined();
    expect(ICONS[upgradeIcon({ type: 'embers' })]).toBeDefined();
  });

  it('서로 같은 그림이 없고 텍스처 이름도 겹치지 않는다', () => {
    expect(new Set(ICON_IDS.map((id) => ICONS[id].join(''))).size).toBe(ICON_IDS.length);
    expect(new Set(ICON_IDS.map(iconKey)).size).toBe(ICON_IDS.length);
  });
});

describe('HUD에 늘어놓는 칸', () => {
  it('무기는 얻은 순서대로, 진화한 것은 진화한 모습으로 보인다', () => {
    expect(weaponSlots({ bolt: 2, ember: EVOLVE_LEVEL, aura: MAX_LEVEL })).toEqual([
      { icon: 'bolt', level: 2, evolved: false },
      { icon: 'emberEvo', level: EVOLVE_LEVEL, evolved: true },
      { icon: 'aura', level: MAX_LEVEL, evolved: false },
    ]);
  });

  it('패시브도 얻은 순서대로 보이고 진화는 없다', () => {
    expect(passiveSlots({ lens: 1, wick: MAX_LEVEL })).toEqual([
      { icon: 'lens', level: 1, evolved: false },
      { icon: 'wick', level: MAX_LEVEL, evolved: false },
    ]);
  });

  it('아직 없는 것은 칸을 차지하지 않는다', () => {
    expect(weaponSlots({})).toEqual([]);
    expect(weaponSlots({ ember: 0, star: 1 })).toEqual([{ icon: 'star', level: 1, evolved: false }]);
    expect(passiveSlots({ coat: 0 })).toEqual([]);
  });

  it('저장했다 불러와도 순서가 그대로다', () => {
    const weapons = { oil: 3, ember: 1, lance: 2 };
    const loaded = JSON.parse(JSON.stringify(weapons)) as typeof weapons;
    expect(weaponSlots(loaded)).toEqual(weaponSlots(weapons));
    expect(weaponSlots(structuredClone(weapons)).map((slot) => slot.icon)).toEqual(['oil', 'ember', 'lance']);
  });
});

describe('withOutline', () => {
  it('사방으로 한 픽셀씩 커지고 맞닿은 빈 칸만 테두리가 된다', () => {
    expect(withOutline(['4.', '..'])).toEqual(['.0..', '040.', '.0..', '....']);
  });

  it('원래 색은 그대로 두고 안쪽 구멍도 두른다', () => {
    expect(withOutline(['444', '4.4', '444'])).toEqual(['.000.', '04440', '04040', '04440', '.000.']);
  });

  it('빈 그림은 빈 채로 둔다', () => {
    expect(withOutline(['..', '..'])).toEqual(['....', '....', '....', '....']);
    expect(withOutline([])).toEqual(['..', '..']);
  });
});
