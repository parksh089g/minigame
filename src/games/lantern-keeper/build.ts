/**
 * 지금 빌드(든 무기와 패시브)를 화면에 보여 주기 좋게 정리한다.
 * 일시정지 화면의 "지금 빌드"와 결과 화면의 "무기별 피해"가 함께 쓴다.
 * 화면이나 Phaser에 의존하지 않는다.
 */
import { BOON_ORDER, BOONS, PASSIVES, WEAPONS, type BoonId, type PassiveId, type WeaponId } from './data';
import { upgradeIcon, type IconId } from './icons';
import { boonLevel, isEvolved, type Levels } from './rules';

export interface WeaponRow {
  id: WeaponId;
  icon: IconId;
  /** 진화한 무기는 진화형의 이름 */
  name: string;
  level: number;
  evolved: boolean;
  /** 이 무기가 준 피해가 무기 전체의 피해에서 차지하는 몫(0~1). 아직 아무도 때리지 않았으면 모두 0 */
  share: number;
}

export interface PassiveRow {
  id: PassiveId;
  icon: IconId;
  name: string;
  level: number;
}

/** levels에 처음 들어온 순서, 곧 얻은 순서대로 */
function owned<K extends string>(levels: Levels<K>): Array<[K, number]> {
  return (Object.keys(levels) as K[])
    .map((id): [K, number] => [id, levels[id] ?? 0])
    .filter(([, level]) => level > 0);
}

/** 저장된 값이 엉뚱해도(음수, 숫자가 아닌 것) 0으로 본다. */
function amount(dealt: Levels<WeaponId> | undefined, id: WeaponId): number {
  const value = dealt?.[id];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/** 지금 든 무기를 얻은 순서대로. dealt는 무기마다 준 피해(sim의 state.dealt)다. */
export function weaponRows(weapons: Levels<WeaponId>, dealt?: Levels<WeaponId>): WeaponRow[] {
  const mine = owned(weapons);
  const total = mine.reduce((sum, [id]) => sum + amount(dealt, id), 0);
  return mine.map(([id, level]) => {
    const evolved = isEvolved(level);
    return {
      id,
      icon: upgradeIcon({ type: 'weapon', id, level }),
      name: evolved ? WEAPONS[id].evolved.name : WEAPONS[id].name,
      level,
      evolved,
      share: total > 0 ? amount(dealt, id) / total : 0,
    };
  });
}

/** 지금 가진 패시브를 얻은 순서대로 */
export function passiveRows(passives: Levels<PassiveId>): PassiveRow[] {
  return owned(passives).map(([id, level]) => ({ id, icon: id, name: PASSIVES[id].name, level }));
}

export interface BoonRow {
  id: BoonId;
  icon: IconId;
  name: string;
  /** 받은 횟수 */
  level: number;
}

/** 끝없는 밤에서 받은 밤의 축복을 정해진 차례로. 받은 것이 없으면 비어 있다. */
export function boonRows(boons: Levels<BoonId> | undefined): BoonRow[] {
  return BOON_ORDER.map((id) => ({ id, icon: id, name: BOONS[id].name, level: boonLevel(boons, id) })).filter(
    (row) => row.level > 0,
  );
}

/** 레벨을 적는 말. 진화한 무기는 레벨 대신 "진화"라고 적는다. */
export function levelLabel(row: { level: number; evolved?: boolean }): string {
  return row.evolved ? '진화' : `Lv ${row.level}`;
}

/** 몫을 백분율로. 0.416 → "42%" */
export function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/**
 * 결과 화면에 보여 줄 무기별 피해: 많이 준 순서대로. 같으면 먼저 얻은 무기가 앞이다.
 * 아무 무기도 피해를 주지 못했으면(시작하자마자 끝난 판, 이 기록이 생기기 전에 저장한 판) 비어 있다.
 */
export function damageRanking(weapons: Levels<WeaponId>, dealt?: Levels<WeaponId>): WeaponRow[] {
  const rows = weaponRows(weapons, dealt);
  if (rows.every((row) => row.share === 0)) return [];
  // sort는 순서가 같은 것끼리의 차례를 지킨다.
  return rows.sort((a, b) => b.share - a.share);
}
