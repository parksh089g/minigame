/**
 * 등불지기의 규칙: 성장 곡선, 적 등장, 무기 성능, 레벨업 선택지, 보상.
 * 순수 함수만 두어 화면 없이 테스트하고 숫자를 맞출 수 있게 한다.
 */
import {
  ENEMIES,
  MAX_LEVEL,
  META,
  PASSIVES,
  PLAYER_BASE,
  RUN_SECONDS,
  SPAWN_TABLE,
  WEAPONS,
  type EnemyKind,
  type MetaId,
  type PassiveId,
  type WeaponId,
} from './data';

export type Rand = () => number;

/** 같은 씨앗이면 같은 수열을 내는 난수. 테스트와 재현에 쓴다. */
export function seededRandom(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- 성장

/** level에서 다음 레벨까지 필요한 경험치 */
export function xpToNext(level: number): number {
  const n = Math.max(0, level - 1);
  return Math.round(5 + 5 * n + 0.45 * n * n);
}

// ---------------------------------------------------------------- 적 등장

/** 1초에 나오는 적의 수. 시간이 갈수록 늘다가 상한에서 멈춘다. */
export function spawnPerSecond(t: number): number {
  return Math.min(16, 0.8 + t / 40 + (t / 160) ** 2);
}

/** 화면에 동시에 있을 수 있는 적의 수 */
export function maxAlive(t: number): number {
  return Math.min(280, 40 + Math.floor(t / 2.2));
}

/** 시간이 지날수록 적 체력이 늘어난다. 보스에는 쓰지 않는다. */
export function hpScale(t: number): number {
  return 1 + (t / 150) ** 1.6;
}

/** 지금 나올 수 있는 적 가운데 하나를 가중치에 따라 고른다. */
export function pickSpawnKind(t: number, rand: Rand): EnemyKind {
  const open = SPAWN_TABLE.filter((row) => t >= row.from);
  const total = open.reduce((sum, row) => sum + row.weight, 0);
  let roll = rand() * total;
  for (const row of open) {
    roll -= row.weight;
    if (roll < 0) return row.kind;
  }
  return open[open.length - 1].kind;
}

/** 시간이 지날수록 적이 조금씩 빨라진다. */
export function speedScale(t: number): number {
  return 1 + 0.25 * Math.min(1, t / RUN_SECONDS);
}

export function enemyHp(kind: EnemyKind, t: number): number {
  const info = ENEMIES[kind];
  return Math.round(info.boss ? info.hp : info.hp * hpScale(t));
}

// ---------------------------------------------------------------- 능력치

export type Levels<K extends string> = Partial<Record<K, number>>;

export interface Modifiers {
  damage: number;
  cooldown: number;
  speed: number;
  magnet: number;
  area: number;
  xp: number;
  maxHp: number;
}

/** 판 안의 패시브와 판 밖의 영구 강화를 합친 배율 */
export function modifiers(passives: Levels<PassiveId>, meta: Levels<MetaId>): Modifiers {
  const p = (id: PassiveId): number => passives[id] ?? 0;
  const m = (id: MetaId): number => meta[id] ?? 0;
  return {
    damage: (1 + 0.1 * p('wick')) * (1 + 0.05 * m('might')),
    cooldown: 0.93 ** p('hourglass'),
    speed: (1 + 0.08 * p('boots')) * (1 + 0.04 * m('swift')),
    magnet: (1 + 0.3 * p('magnet')) * (1 + 0.15 * m('reach')),
    area: 1 + 0.1 * p('lens'),
    xp: 1 + 0.08 * m('greed'),
    maxHp: PLAYER_BASE.maxHp + 20 * p('coat') + 10 * m('vigor'),
  };
}

export interface EmberStats {
  damage: number;
  cooldown: number;
  count: number;
  pierce: number;
  speed: number;
}
export interface AuraStats {
  radius: number;
  /** 한 번 태울 때의 피해 */
  damage: number;
  /** 태우는 간격(초) */
  tick: number;
  /** 닿은 적의 이동 속도 배율 */
  slow: number;
}
export interface FireflyStats {
  count: number;
  damage: number;
  orbit: number;
  /** 라디안/초 */
  spin: number;
  /** 같은 적을 다시 때리기까지(초) */
  rehit: number;
}
export interface StarStats {
  damage: number;
  cooldown: number;
  count: number;
  radius: number;
}

const atLeast = (level: number, n: number): number => (level >= n ? 1 : 0);

export function emberStats(level: number, mods: Modifiers): EmberStats {
  return {
    damage: (10 + 4 * atLeast(level, 2)) * mods.damage,
    cooldown: 0.75 * (level >= 4 ? 0.85 : 1) * mods.cooldown,
    count: 1 + atLeast(level, 3) + atLeast(level, 5),
    pierce: atLeast(level, 5),
    speed: 170,
  };
}

export function auraStats(level: number, mods: Modifiers): AuraStats {
  return {
    radius: (24 + 5 * atLeast(level, 2) + 5 * atLeast(level, 4)) * mods.area,
    damage: (4 + 3 * atLeast(level, 3) + 4 * atLeast(level, 5)) * mods.damage,
    tick: 0.45 * mods.cooldown,
    slow: level >= 5 ? 0.6 : 1,
  };
}

export function fireflyStats(level: number, mods: Modifiers): FireflyStats {
  return {
    count: 1 + atLeast(level, 2) + atLeast(level, 4) + atLeast(level, 5),
    damage: (7 + 4 * atLeast(level, 3)) * mods.damage,
    orbit: 30 * mods.area,
    spin: level >= 5 ? 4.2 : 3,
    rehit: 0.5,
  };
}

export function starStats(level: number, mods: Modifiers): StarStats {
  return {
    damage: (20 + 8 * atLeast(level, 2)) * mods.damage,
    cooldown: 2.4 * (level >= 5 ? 0.8 : 1) * mods.cooldown,
    count: 1 + atLeast(level, 3) + atLeast(level, 5),
    radius: (16 + 5 * atLeast(level, 4)) * mods.area,
  };
}

// ---------------------------------------------------------------- 레벨업 선택지

export type Upgrade =
  | { type: 'weapon'; id: WeaponId; level: number }
  | { type: 'passive'; id: PassiveId; level: number }
  | { type: 'heal' }
  | { type: 'embers' };

export const HEAL_AMOUNT = 30;
export const EMBER_BONUS = 5;

export interface Build {
  weapons: Levels<WeaponId>;
  passives: Levels<PassiveId>;
}

/**
 * 레벨업 때 보여 줄 선택지. 아직 덜 올린 무기와 패시브 가운데에서 겹치지 않게 count개 고른다.
 * 모두 최대 레벨이면 회복과 불씨를 준다.
 * upgrade.level은 고르면 올라갈 레벨(처음 얻는 것이면 1).
 */
export function upgradeOptions(build: Build, rand: Rand, count = 3): Upgrade[] {
  const pool: Upgrade[] = [];
  for (const id of Object.keys(WEAPONS) as WeaponId[]) {
    const level = build.weapons[id] ?? 0;
    if (level < MAX_LEVEL) pool.push({ type: 'weapon', id, level: level + 1 });
  }
  for (const id of Object.keys(PASSIVES) as PassiveId[]) {
    const level = build.passives[id] ?? 0;
    if (level < MAX_LEVEL) pool.push({ type: 'passive', id, level: level + 1 });
  }

  // 가진 무기를 올리는 쪽이 조금 더 자주 나오게 해서 빌드가 흩어지지 않게 한다.
  const weight = (u: Upgrade): number =>
    u.type === 'weapon' ? (u.level > 1 ? 3 : 2) : u.type === 'passive' ? (u.level > 1 ? 2 : 1.5) : 1;

  const picked: Upgrade[] = [];
  while (picked.length < count && pool.length > 0) {
    const total = pool.reduce((sum, u) => sum + weight(u), 0);
    let roll = rand() * total;
    let index = pool.length - 1;
    for (let i = 0; i < pool.length; i += 1) {
      roll -= weight(pool[i]);
      if (roll < 0) {
        index = i;
        break;
      }
    }
    picked.push(pool[index]);
    pool.splice(index, 1);
  }
  if (picked.length < count) picked.push({ type: 'heal' });
  if (picked.length < count) picked.push({ type: 'embers' });
  return picked;
}

export function upgradeTitle(upgrade: Upgrade): string {
  switch (upgrade.type) {
    case 'weapon':
      return WEAPONS[upgrade.id].name;
    case 'passive':
      return PASSIVES[upgrade.id].name;
    case 'heal':
      return '따뜻한 차';
    case 'embers':
      return '불씨 주머니';
  }
}

export function upgradeDescription(upgrade: Upgrade): string {
  switch (upgrade.type) {
    case 'weapon':
      return WEAPONS[upgrade.id].levels[upgrade.level - 1];
    case 'passive':
      return PASSIVES[upgrade.id].perLevel;
    case 'heal':
      return `체력 ${HEAL_AMOUNT} 회복`;
    case 'embers':
      return `불씨 ${EMBER_BONUS}개`;
  }
}

// ---------------------------------------------------------------- 결과와 보상

export interface RunSummary {
  seconds: number;
  kills: number;
  level: number;
  bossKills: number;
  cleared: boolean;
  /** 레벨업에서 고른 불씨 주머니 */
  bonusEmbers: number;
}

/** 허브의 최고 기록에 쓰는 점수 */
export function scoreFor(run: RunSummary): number {
  return Math.floor(run.seconds) + run.kills + 250 * run.bossKills + (run.cleared ? 1000 : 0);
}

/** 판이 끝나고 받는 불씨. 오래 버틸수록, 많이 쓰러뜨릴수록 많다. */
export function embersFor(run: RunSummary): number {
  const minutes = Math.floor(Math.min(run.seconds, RUN_SECONDS) / 60);
  return (
    minutes * 3 + Math.floor(run.kills / 40) + 15 * run.bossKills + (run.cleared ? 40 : 0) + run.bonusEmbers
  );
}

/** 허브 코인. 다른 미니게임과 비슷한 정도가 되게 점수에서 조금만 준다. */
export function coinsFor(score: number): number {
  return Math.floor(score / 60);
}

/** level단계에서 다음 단계로 올리는 값. 최대 단계면 null. */
export function metaCost(id: MetaId, level: number): number | null {
  const info = META[id];
  if (level >= info.maxLevel) return null;
  return info.baseCost * (level + 1);
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
