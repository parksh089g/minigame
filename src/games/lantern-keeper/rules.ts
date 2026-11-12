/**
 * 등불지기의 규칙: 성장 곡선, 적 등장, 무기 성능, 레벨업 선택지, 보상.
 * 순수 함수만 두어 화면 없이 테스트하고 숫자를 맞출 수 있게 한다.
 */
import {
  ENEMIES,
  EVOLVE_LEVEL,
  GUARD,
  MAX_DEPTH,
  MAX_LEVEL,
  MAX_PASSIVES,
  MAX_WEAPONS,
  META,
  MID_BOSS_TIERS,
  PASSIVES,
  PLAYER_BASE,
  RUN_SECONDS,
  STAGES,
  WEAPON_ORDER,
  WEAPONS,
  type EnemyKind,
  type HeroTrait,
  type MetaId,
  type PassiveId,
  type StageId,
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

/** 시간이 지날수록 적 체력이 늘어난다. 무기가 진화하는 후반에는 더 가파르게 는다. 보스에는 쓰지 않는다. */
export function hpScale(t: number): number {
  return 1 + (t / 150) ** 1.6 + (t / 330) ** 3.2;
}

/** 3분이 지나면 적이 닿았을 때 주는 피해가 조금씩 늘어난다. 보스에는 쓰지 않는다. */
export function damageScale(t: number): number {
  return 1 + 0.6 * Math.min(1, Math.max(0, t - 180) / (RUN_SECONDS - 180));
}

/** 그 스테이지에서 지금 나올 수 있는 적 가운데 하나를 가중치에 따라 고른다. */
export function pickSpawnKind(t: number, rand: Rand, stage: StageId = 'meadow'): EnemyKind {
  const open = STAGES[stage].spawns.filter((row) => t >= row.from);
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

/** index번째(0부터) 중간 보스의 세기. 표보다 뒤의 것은 마지막 줄을 쓴다. */
export function midBossTier(index: number): (typeof MID_BOSS_TIERS)[number] {
  return MID_BOSS_TIERS[Math.max(0, Math.min(index, MID_BOSS_TIERS.length - 1))];
}

/** 그 스테이지에서 index번째(0부터)로 나오는 중간 보스 */
export function midBossKind(stage: StageId, index: number): EnemyKind {
  const list = STAGES[stage].midBosses;
  return list[Math.max(0, Math.min(index, list.length - 1))];
}

/** 보스가 불러내는 부하. 앞의 두 번과 뒤의 두 번이 다르다. */
export function minionKind(stage: StageId, tier: number): EnemyKind {
  return STAGES[stage].minions[tier >= 2 ? 1 : 0];
}

/** 최고 기록(초)으로 열리는 캐릭터나 스테이지가 열렸는지 */
export function isUnlocked(item: { unlockSeconds: number }, bestSeconds: number): boolean {
  return bestSeconds >= item.unlockSeconds;
}

// ---------------------------------------------------------------- 깊은 밤

/** 깊은 밤 한 단계의 규칙. 모두 보통 밤(0단계)에 곱하는 배율이다. */
export interface DepthRules {
  /** 보통 적의 체력 */
  hp: number;
  /** 보스의 체력 */
  bossHp: number;
  /** 적과 보스가 닿았을 때, 보스의 빛덩이에 맞았을 때의 피해 */
  damage: number;
  /** 보통 적의 이동 속도 */
  speed: number;
  /** 1초에 나오는 적의 수 */
  spawn: number;
  /** 점수 */
  score: number;
  /** 판이 끝나고 받는 불씨 */
  embers: number;
}

/** 깊은 밤의 단계로 쓸 수 있는 값(0 ~ MAX_DEPTH의 정수)으로 맞춘다. 엉뚱한 값은 0이 된다. */
export function clampDepth(depth: unknown): number {
  if (typeof depth !== 'number' || !Number.isFinite(depth)) return 0;
  return Math.max(0, Math.min(MAX_DEPTH, Math.floor(depth)));
}

/**
 * 깊은 밤 depth단계의 규칙. 0단계는 모두 1이다.
 * 단계가 오를수록 그림자가 튼튼해지고 아파지고 많아지며, 그만큼 점수와 불씨가 더 붙는다.
 * 속도는 조금만 올린다. 가장 빠른 적도 걸어서 따돌릴 수 있어야 피하는 재미가 남는다.
 */
export function depthRules(depth: number): DepthRules {
  const d = clampDepth(depth);
  return {
    hp: 1 + 0.3 * d,
    bossHp: 1 + 0.35 * d,
    damage: 1 + 0.15 * d,
    speed: 1 + 0.015 * d,
    spawn: 1 + 0.05 * d,
    score: 1 + 0.5 * d,
    embers: 1 + 0.25 * d,
  };
}

/** 깊은 밤의 단계 이름. 0단계는 "보통 밤" */
export function depthName(depth: number): string {
  const d = clampDepth(depth);
  return d === 0 ? '보통 밤' : `깊은 밤 ${d}`;
}

/** 배율을 "×1.5"처럼 적는다. */
export function formatTimes(value: number): string {
  return `×${Number(value.toFixed(2))}`;
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
  /** 1초에 저절로 차는 체력 */
  regen: number;
  /** 받는 피해에 곱하는 값. 1이면 그대로 */
  taken: number;
  /** 피해를 한 번 막는 빛막이 다시 생기는 데 걸리는 시간(초). 0이면 빛막이 없다. */
  guard: number;
}

/** 캐릭터의 최대 체력이 아무리 깎여도 이보다 낮아지지는 않는다. */
const MIN_MAX_HP = 40;

/** 판 안의 패시브, 판 밖의 영구 강화, 캐릭터의 고유 특성을 합친 배율 */
export function modifiers(passives: Levels<PassiveId>, meta: Levels<MetaId>, trait: HeroTrait = {}): Modifiers {
  const p = (id: PassiveId): number => passives[id] ?? 0;
  const m = (id: MetaId): number => meta[id] ?? 0;
  return {
    damage: (1 + 0.1 * p('wick')) * (1 + 0.05 * m('might')),
    cooldown: 0.93 ** p('hourglass') * (trait.cooldown ?? 1),
    speed: (1 + 0.08 * p('boots')) * (1 + 0.04 * m('swift')) * (trait.speed ?? 1),
    magnet: (1 + 0.3 * p('magnet')) * (1 + 0.15 * m('reach')),
    area: (1 + 0.1 * p('lens')) * (trait.area ?? 1),
    xp: (1 + 0.08 * m('greed')) * (trait.xp ?? 1),
    maxHp: Math.max(MIN_MAX_HP, PLAYER_BASE.maxHp + 20 * p('coat') + 10 * m('vigor') + (trait.maxHp ?? 0)),
    regen: 0.1 * m('mend'),
    taken: 1 - 0.04 * m('armor'),
    guard: guardSeconds(p('hood')),
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
export interface LanceStats {
  damage: number;
  cooldown: number;
  count: number;
  /** 화살의 굵기(판정 반지름) */
  radius: number;
  speed: number;
  /** 날아가는 시간(초) */
  life: number;
}
export interface OilStats {
  /** 한 번 태울 때의 피해 */
  damage: number;
  /** 불길을 새로 남기는 간격(초) */
  cooldown: number;
  radius: number;
  /** 불길이 남아 있는 시간(초) */
  duration: number;
  /** 태우는 간격(초) */
  tick: number;
  /** 닿은 적의 이동 속도 배율 */
  slow: number;
}
export interface BoltStats {
  damage: number;
  cooldown: number;
  /** 한 줄기가 때리는 적의 수 */
  jumps: number;
  /** 한 번에 치는 줄기 수 */
  chains: number;
  /** 첫 번째 적까지 닿는 거리 */
  reach: number;
  /** 다음 적으로 튀는 거리 */
  hop: number;
}

const atLeast = (level: number, n: number): number => (level >= n ? 1 : 0);

/** 이 레벨이면 최종 진화형인지 */
export const isEvolved = (level: number): boolean => level >= EVOLVE_LEVEL;

export function emberStats(level: number, mods: Modifiers): EmberStats {
  const evo = atLeast(level, EVOLVE_LEVEL);
  return {
    damage: (10 + 4 * atLeast(level, 2) + 6 * evo) * mods.damage,
    cooldown: 0.75 * (level >= 4 ? 0.85 : 1) * (evo ? 0.85 : 1) * mods.cooldown,
    count: 1 + atLeast(level, 3) + atLeast(level, 5) + evo,
    pierce: atLeast(level, 5) + 2 * evo,
    speed: evo ? 190 : 170,
  };
}

export function auraStats(level: number, mods: Modifiers): AuraStats {
  const evo = atLeast(level, EVOLVE_LEVEL);
  return {
    radius: (24 + 5 * atLeast(level, 2) + 5 * atLeast(level, 4) + 10 * evo) * mods.area,
    damage: (4 + 3 * atLeast(level, 3) + 4 * atLeast(level, 5) + 6 * evo) * mods.damage,
    tick: (evo ? 0.38 : 0.45) * mods.cooldown,
    slow: evo ? 0.45 : level >= 5 ? 0.6 : 1,
  };
}

export function fireflyStats(level: number, mods: Modifiers): FireflyStats {
  const evo = atLeast(level, EVOLVE_LEVEL);
  return {
    count: 1 + atLeast(level, 2) + atLeast(level, 4) + atLeast(level, 5) + 2 * evo,
    damage: (7 + 4 * atLeast(level, 3) + 5 * evo) * mods.damage,
    orbit: (evo ? 38 : 30) * mods.area,
    spin: evo ? 4.6 : level >= 5 ? 4.2 : 3,
    rehit: evo ? 0.35 : 0.5,
  };
}

export function starStats(level: number, mods: Modifiers): StarStats {
  const evo = atLeast(level, EVOLVE_LEVEL);
  return {
    damage: (20 + 8 * atLeast(level, 2) + 6 * evo) * mods.damage,
    cooldown: 2.4 * (level >= 5 ? 0.8 : 1) * (evo ? 0.7 : 1) * mods.cooldown,
    count: 1 + atLeast(level, 3) + atLeast(level, 5) + 2 * evo,
    radius: (16 + 5 * atLeast(level, 4) + 4 * evo) * mods.area,
  };
}

export function lanceStats(level: number, mods: Modifiers): LanceStats {
  const evo = atLeast(level, EVOLVE_LEVEL);
  return {
    damage: (14 + 6 * atLeast(level, 2) + 8 * atLeast(level, 5) + 12 * evo) * mods.damage,
    cooldown: 1.6 * (level >= 3 ? 0.8 : 1) * mods.cooldown,
    count: 1 + atLeast(level, 4) + evo,
    radius: (4 + atLeast(level, 5) + 2 * evo) * mods.area,
    speed: 210,
    life: 0.8,
  };
}

export function oilStats(level: number, mods: Modifiers): OilStats {
  const evo = atLeast(level, EVOLVE_LEVEL);
  return {
    damage: (5 + 3 * atLeast(level, 3) + 4 * atLeast(level, 5) + 5 * evo) * mods.damage,
    cooldown: 2.4 * (level >= 5 ? 0.8 : 1) * mods.cooldown,
    radius: (16 + 4 * atLeast(level, 2) + 8 * evo) * mods.area,
    duration: 3 + 1.5 * atLeast(level, 4) + 1.5 * evo,
    tick: 0.4,
    slow: evo ? 0.6 : 1,
  };
}

export function boltStats(level: number, mods: Modifiers): BoltStats {
  const evo = atLeast(level, EVOLVE_LEVEL);
  return {
    damage: (9 + 4 * atLeast(level, 2) + 5 * atLeast(level, 5) + 6 * evo) * mods.damage,
    cooldown: 1.5 * (level >= 4 ? 0.8 : 1) * mods.cooldown,
    jumps: 3 + 2 * atLeast(level, 3) + 2 * atLeast(level, 5) + 3 * evo,
    chains: 1 + evo,
    reach: 110,
    hop: (46 + 10 * evo) * mods.area,
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

/** 무기를 level까지 올렸을 때의 이름. 진화하면 이름이 바뀐다. */
export function weaponName(id: WeaponId, level: number): string {
  return isEvolved(level) ? WEAPONS[id].evolved.name : WEAPONS[id].name;
}

/** 지금 들고 있는 무기를 정해진 순서로 */
export function ownedWeapons(weapons: Levels<WeaponId>): WeaponId[] {
  return WEAPON_ORDER.filter((id) => (weapons[id] ?? 0) > 0);
}

/** 등갓의 빛막이 깨진 뒤 다시 생기는 데 걸리는 시간(초). 등갓이 없으면(0레벨) 0 */
export function guardSeconds(level: number): number {
  return level > 0 ? GUARD.seconds - GUARD.perLevel * (level - 1) : 0;
}

/** 지금 가진 패시브 */
export function ownedPassives(passives: Levels<PassiveId>): PassiveId[] {
  return (Object.keys(PASSIVES) as PassiveId[]).filter((id) => (passives[id] ?? 0) > 0);
}

/**
 * 레벨업 때 보여 줄 선택지. 아직 덜 올린 무기와 패시브 가운데에서 겹치지 않게 count개 고른다.
 * 무기 칸이 다 찼으면 새 무기는 나오지 않는다. 모두 최대 레벨이면 회복과 불씨를 준다.
 * 레벨업으로는 MAX_LEVEL까지만 올릴 수 있다. 그다음 단계인 진화는 무기 강화권으로만 한다.
 * upgrade.level은 고르면 올라갈 레벨(처음 얻는 것이면 1).
 */
export function upgradeOptions(build: Build, rand: Rand, count = 3): Upgrade[] {
  const pool: Upgrade[] = [];
  const full = ownedWeapons(build.weapons).length >= MAX_WEAPONS;
  for (const id of WEAPON_ORDER) {
    const level = build.weapons[id] ?? 0;
    if (level === 0 && full) continue;
    if (level < MAX_LEVEL) pool.push({ type: 'weapon', id, level: level + 1 });
  }
  // 패시브도 칸이 다 차면 새 것은 나오지 않는다.
  const fullPassives = ownedPassives(build.passives).length >= MAX_PASSIVES;
  for (const id of Object.keys(PASSIVES) as PassiveId[]) {
    const level = build.passives[id] ?? 0;
    if (level === 0 && fullPassives) continue;
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

/**
 * 무기 강화권으로 고를 수 있는 것: 가진 무기 가운데 아직 더 올릴 수 있는 것 전부.
 * MAX_LEVEL인 무기에 쓰면 최종 진화형(EVOLVE_LEVEL)이 된다. 진화는 이 길로만 할 수 있다.
 * 올릴 무기가 없으면 회복과 불씨 가운데에서 고른다.
 */
export function ticketOptions(weapons: Levels<WeaponId>): Upgrade[] {
  const options: Upgrade[] = [];
  for (const id of ownedWeapons(weapons)) {
    const level = weapons[id] ?? 0;
    if (level < EVOLVE_LEVEL) options.push({ type: 'weapon', id, level: level + 1 });
  }
  return options.length > 0 ? options : [{ type: 'heal' }, { type: 'embers' }];
}

export function upgradeTitle(upgrade: Upgrade): string {
  switch (upgrade.type) {
    case 'weapon':
      return weaponName(upgrade.id, upgrade.level);
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
      return isEvolved(upgrade.level)
        ? WEAPONS[upgrade.id].evolved.description
        : WEAPONS[upgrade.id].levels[upgrade.level - 1];
    case 'passive':
      // 등갓은 레벨마다 달라지는 것이 "몇 초마다"라서, 그 숫자를 바로 적어 준다.
      if (upgrade.id === 'hood') return `${guardSeconds(upgrade.level)}초마다 피해를 한 번 막는 빛막`;
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
  /** 쓰러뜨린 그림자 전부. 결과 화면에 보여 준다. */
  kills: number;
  /**
   * 점수와 불씨에 세는 처치 수: 마지막 보스가 나타나기 전까지 쓰러뜨린 것.
   * 마지막 보스가 나온 뒤에도 그림자는 계속 몰려오므로, 그 뒤의 처치까지 세면
   * 보스를 일부러 남겨 두고 끝없이 점수와 불씨를 올릴 수 있다.
   */
  countedKills: number;
  level: number;
  bossKills: number;
  cleared: boolean;
  /** 레벨업에서 고른 불씨 주머니 */
  bonusEmbers: number;
  /** 깊은 밤의 단계. 0이 보통 밤 */
  depth: number;
}

/**
 * 허브의 최고 기록과 랭킹에 쓰는 점수. 버틴 시간도 처치 수도 마지막 보스가 나타난 때까지만 센다.
 * 깊은 밤에서는 단계의 배율이 통째로 곱해진다.
 */
export function scoreFor(run: RunSummary): number {
  const base = Math.floor(run.seconds) + run.countedKills + 150 * run.bossKills + (run.cleared ? 1000 : 0);
  return Math.floor(base * depthRules(run.depth).score);
}

/**
 * 판이 끝나고 받는 불씨. 오래 버틸수록, 많이 쓰러뜨릴수록 많다. 처치는 점수와 같은 수(countedKills)로 센다.
 * lucky는 영구 강화 "불씨 복"의 단계로, 한 단계에 10%씩 더 준다. 깊은 밤에서는 단계의 배율도 곱해진다.
 */
export function embersFor(run: RunSummary, lucky = 0): number {
  const minutes = Math.floor(Math.min(run.seconds, RUN_SECONDS) / 60);
  const earned =
    minutes * 3 + Math.floor(run.countedKills / 40) + 8 * run.bossKills + (run.cleared ? 40 : 0) + run.bonusEmbers;
  return Math.floor(earned * depthRules(run.depth).embers * (1 + 0.1 * Math.max(0, lucky)));
}

/** 한 판에 받을 수 있는 허브 코인의 상한. 보통 밤을 완주했을 때 받는 만큼이다. */
export const COIN_CAP = 150;

/**
 * 허브 코인. 다른 미니게임과 비슷한 정도가 되게 점수에서 조금만 준다.
 * 깊은 밤에서는 점수에 배율이 붙지만 코인은 상한에서 멈춰서, 허브의 꾸미기 값이 흔들리지 않는다.
 */
export function coinsFor(score: number): number {
  return Math.min(COIN_CAP, Math.floor(score / 60));
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
