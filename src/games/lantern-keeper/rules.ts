/**
 * 등불지기의 규칙: 성장 곡선, 적 등장, 무기 성능, 레벨업 선택지, 보상.
 * 순수 함수만 두어 화면 없이 테스트하고 숫자를 맞출 수 있게 한다.
 */
import { MAX_SCORE } from '../../online/protocol';
import {
  BOON_ORDER,
  BOON_VALUES,
  BOONS,
  ENDLESS,
  ENEMIES,
  EVOLVE_LEVEL,
  FEAST,
  FEAST_LEVELS,
  FEAST_ORDER,
  FLINT,
  GUARD,
  HERB_REGEN,
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
  type BoonId,
  type EnemyKind,
  type FeastId,
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

/**
 * 끝없는 밤에 들어선 지 seconds초가 지났을 때 더 얹히는 난이도.
 * hp는 그림자와 보스의 체력에, damage는 받는 피해에, speed는 그림자의 빠르기에 곱한다. 끝없는 밤이 아니면(0초) 모두 1이다.
 */
export function endlessScale(seconds: number): { hp: number; damage: number; speed: number } {
  const minutes = Math.max(0, Number.isFinite(seconds) ? seconds : 0) / 60;
  return {
    hp: ENDLESS.hp ** minutes,
    damage: ENDLESS.damage ** minutes,
    speed: 1 + Math.min(ENDLESS.maxSpeed, ENDLESS.speed * minutes),
  };
}

/** 끝없는 밤의 index번째(0부터) 보스. 그 스테이지의 중간 보스가 차례로 돌아가며 나온다. */
export function endlessBossKind(stage: StageId, index: number): EnemyKind {
  // 스테이지의 중간 보스 차례에서 겹치는 것을 뺀 세 가지가 돌아가며 나온다.
  const list = [...new Set(STAGES[stage].midBosses)];
  return list[Math.max(0, Math.floor(index)) % list.length];
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

/** 잔치의 밤의 이름과 난이도: "잔치의 밤 · 쉬움" */
export function feastTitle(level: FeastId): string {
  return `${FEAST.name} · ${FEAST_LEVELS[level].name}`;
}

/** 잔치의 밤의 난이도와, 점수와 불씨에 붙는 배율: "쉬움 · 점수와 불씨 ×0.6" */
export function feastNote(level: FeastId): string {
  const { name, reward } = FEAST_LEVELS[level];
  return `${name} · 점수와 불씨 ${formatTimes(reward)}`;
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
  /** 쓰러진 보통 그림자가 터질 확률(0~1). 부싯돌이 없으면 0 */
  spark: number;
}

/** 이 축복을 몇 번 받았는지. 저장된 값이 엉뚱하면 0으로 본다. */
export function boonLevel(boons: Levels<BoonId> | undefined, id: BoonId): number {
  const value = boons?.[id];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** 캐릭터의 최대 체력이 아무리 깎여도 이보다 낮아지지는 않는다. */
const MIN_MAX_HP = 40;

/** 판 안의 패시브, 판 밖의 영구 강화, 캐릭터의 고유 특성을 합친 배율 */
export function modifiers(
  passives: Levels<PassiveId>,
  meta: Levels<MetaId>,
  trait: HeroTrait = {},
  /** 끝없는 밤에서 받은 밤의 축복. 없으면 아무것도 얹지 않는다. */
  boons: Levels<BoonId> = {},
): Modifiers {
  const p = (id: PassiveId): number => passives[id] ?? 0;
  const m = (id: MetaId): number => meta[id] ?? 0;
  const b = (id: BoonId): number => boonLevel(boons, id);
  return {
    damage: (1 + 0.1 * p('wick')) * (1 + 0.05 * m('might')) * (trait.damage ?? 1) * (1 + BOON_VALUES.blaze * b('blaze')),
    cooldown: 0.93 ** p('hourglass') * (trait.cooldown ?? 1) * BOON_VALUES.haste ** b('haste'),
    speed: (1 + 0.08 * p('boots')) * (1 + 0.04 * m('swift')) * (trait.speed ?? 1),
    magnet: (1 + 0.3 * p('magnet')) * (1 + 0.15 * m('reach')),
    area: (1 + 0.1 * p('lens')) * (trait.area ?? 1) * (1 + BOON_VALUES.bloom * b('bloom')),
    xp: (1 + 0.08 * m('greed')) * (trait.xp ?? 1),
    maxHp:
      Math.max(MIN_MAX_HP, PLAYER_BASE.maxHp + 20 * p('coat') + 10 * m('vigor') + (trait.maxHp ?? 0)) +
      BOON_VALUES.bulwark * b('bulwark'),
    regen: 0.1 * m('mend') + HERB_REGEN * p('herb') + BOON_VALUES.breath * b('breath') + (trait.regen ?? 0),
    taken: (1 - 0.04 * m('armor')) * (trait.taken ?? 1) * BOON_VALUES.ward ** b('ward'),
    guard: guardSeconds(p('hood')),
    spark: sparkChance(p('flint')),
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

export interface BellStats {
  damage: number;
  cooldown: number;
  /** 종소리가 퍼지는 끝의 반지름(px) */
  radius: number;
  /** 닿은 보통 그림자가 밀려나는 거리(px) */
  push: number;
  /** 한 번에 울리는 횟수 */
  rings: number;
  /** 닿은 적의 이동 속도 배율 */
  slow: number;
}
export interface MoonStats {
  damage: number;
  cooldown: number;
  count: number;
  /** 날아가는 거리(px) */
  reach: number;
  /** 판정 반지름(px) */
  radius: number;
  /** 날아가는 빠르기(px/초) */
  speed: number;
  /** 같은 적을 다시 벨 수 있을 때까지(초). 0이면 가는 길에 한 번, 오는 길에 한 번만 벤다. */
  rehit: number;
}

export interface BeamStats {
  /** 빛줄기의 수. 둘레에 고르게 벌려 선다. */
  count: number;
  /** 한 번 훑을 때의 피해 */
  damage: number;
  /** 빛줄기의 길이(px) */
  length: number;
  /** 보이는 굵기의 절반(px). 맞는지는 빛줄기의 가운데가 지나갔는지로만 따진다. */
  width: number;
  /** 도는 빠르기(라디안/초) */
  spin: number;
}

export interface TorchStats {
  /** 한 번 휘두를 때의 피해 */
  damage: number;
  cooldown: number;
  /** 닿는 거리(px) */
  reach: number;
  /** 부채꼴의 벌어진 각(라디안) */
  arc: number;
  /** 한 번에 휘두르는 쪽의 수. 둘이면 맞은편도 벤다. */
  count: number;
  /** 벤 적을 밀어내는 거리(px). 0이면 밀지 않는다. */
  push: number;
}

export interface LampStats {
  /** 한 번에 띄우는 풍등의 수 */
  count: number;
  /** 불티를 한 번 떨굴 때의 피해 */
  damage: number;
  /** 불티를 떨구는 간격(초) */
  tick: number;
  /** 불티가 떨어지는 둘레(px) */
  radius: number;
  /** 싸움터에 머무는 시간(초) */
  duration: number;
  cooldown: number;
  /** 날아가는 빠르기(px/초) */
  speed: number;
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

export function bellStats(level: number, mods: Modifiers): BellStats {
  const evo = atLeast(level, EVOLVE_LEVEL);
  return {
    // 밀어내는 힘이 커서, 피해는 다른 무기보다 낮게 둔다. 조금만 올려도 혼자서 끝까지 버틴다.
    damage: (8 + 4 * atLeast(level, 2) + 5 * atLeast(level, 5) + 4 * evo) * mods.damage,
    cooldown: 3.2 * (level >= 4 ? 0.8 : 1) * mods.cooldown,
    radius: (46 + 8 * atLeast(level, 3) + 10 * evo) * mods.area,
    push: evo ? 24 : level >= 5 ? 20 : 14,
    rings: 1 + evo,
    slow: evo ? 0.35 : 1,
  };
}

export function moonStats(level: number, mods: Modifiers): MoonStats {
  const evo = atLeast(level, EVOLVE_LEVEL);
  return {
    damage: (11 + 5 * atLeast(level, 2) + 6 * atLeast(level, 5) + 2 * evo) * mods.damage,
    cooldown: 2 * (level >= 5 ? 0.8 : 1) * mods.cooldown,
    count: 1 + atLeast(level, 4) + evo,
    reach: 66 + 18 * atLeast(level, 3) + 6 * evo,
    radius: (7 + 3 * evo) * mods.area,
    speed: evo ? 120 : 150,
    rehit: evo ? 0.3 : 0,
  };
}

/**
 * 등대빛: 플레이어에게서 뻗은 빛줄기가 둘레를 돌며 닿는 적을 모두 훑는다.
 * 멀리까지 닿는 대신 같은 적을 한 바퀴에 줄기 수만큼만 때려서, 가까이 붙은 적을 빨리 녹이지는 못한다.
 * 재사용 시간이 줄면 그만큼 빨리 돈다.
 */
export function beamStats(level: number, mods: Modifiers): BeamStats {
  const evo = atLeast(level, EVOLVE_LEVEL);
  return {
    count: 1 + atLeast(level, 4) + evo,
    damage: (10 + 4 * atLeast(level, 2) + 6 * atLeast(level, 5) + 4 * evo) * mods.damage,
    length: (46 + 10 * atLeast(level, 3) + 14 * evo) * mods.area,
    width: 3 + 2 * evo,
    spin: (level >= 5 ? 2.8 : 2.2) / mods.cooldown,
  };
}

/**
 * 횃불: 가까운 적 쪽을 부채꼴로 휘둘러, 닿는 적을 모두 한 번씩 벤다.
 * 닿는 거리가 짧은 대신 한 번에 세게 때려서, 무리에 붙어 설수록 잘 듣는다.
 */
export function torchStats(level: number, mods: Modifiers): TorchStats {
  const evo = atLeast(level, EVOLVE_LEVEL);
  return {
    damage: (10 + 4 * atLeast(level, 2) + 6 * atLeast(level, 5) + 6 * evo) * mods.damage,
    cooldown: 1.3 * (level >= 5 ? 0.8 : 1) * mods.cooldown,
    reach: (34 + 4 * atLeast(level, 3) + 10 * evo) * mods.area,
    arc: 1.8 + 0.5 * atLeast(level, 3) + 0.5 * evo,
    count: 1 + atLeast(level, 4),
    push: evo ? 18 : 0,
  };
}

/**
 * 풍등: 그림자가 모인 곳 위로 날아가서, 머무는 동안 둘레에 불티를 거듭 떨군다.
 * 무리를 따라다니므로 플레이어가 달아나는 동안에도 뒤쪽의 무리를 줄여 준다.
 */
export function lampStats(level: number, mods: Modifiers): LampStats {
  const evo = atLeast(level, EVOLVE_LEVEL);
  return {
    count: 1 + atLeast(level, 2) + atLeast(level, 5) + evo,
    damage: (6 + 3 * atLeast(level, 3) + 3 * evo) * mods.damage,
    tick: 0.4,
    radius: (16 + 4 * atLeast(level, 5) + 6 * evo) * mods.area,
    duration: 3.5 + 1.5 * atLeast(level, 4) + 1 * evo,
    cooldown: 3.6 * mods.cooldown,
    speed: 90,
  };
}

// ---------------------------------------------------------------- 레벨업 선택지

export type Upgrade =
  | { type: 'weapon'; id: WeaponId; level: number }
  | { type: 'passive'; id: PassiveId; level: number }
  /** 밤의 축복. level은 고르면 되는, 이 축복을 받은 횟수다. */
  | { type: 'boon'; id: BoonId; level: number }
  | { type: 'heal' }
  | { type: 'embers' };

export const HEAL_AMOUNT = 30;
export const EMBER_BONUS = 5;

export interface Build {
  weapons: Levels<WeaponId>;
  passives: Levels<PassiveId>;
  /** 들 수 있는 무기의 수(weaponSlotCount). 없으면 MAX_WEAPONS */
  slots?: number;
  /** 이번 판에서 골라낸 무기와 패시브의 이름(영구 강화 "골라내기"). 레벨업 선택지에 다시 나오지 않는다. */
  banned?: readonly string[];
}

/** 잔치의 밤의 난이도인지. 보통 판(없음)이나 엉뚱한 값이면 false */
export function isFeast(value: unknown): value is FeastId {
  return typeof value === 'string' && (FEAST_ORDER as readonly string[]).includes(value);
}

/** 한 판에 들 수 있는 무기의 수. 잔치의 밤이면 더 많다. */
export function weaponSlotCount(feast: unknown): number {
  return isFeast(feast) ? FEAST.weapons : MAX_WEAPONS;
}

/** 잔치의 밤에서 점수와 불씨에 붙는 배율. 보통 판이면 1 */
export function feastReward(feast: unknown): number {
  return isFeast(feast) ? FEAST_LEVELS[feast].reward : 1;
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

/** 부싯돌이 이 레벨일 때 쓰러진 그림자가 터질 확률 */
export function sparkChance(level: number): number {
  return FLINT.chance * Math.max(0, level);
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
 * boons를 주면(끝없는 밤) 빈자리를 회복과 불씨 대신 밤의 축복이 채운다.
 */
export function upgradeOptions(build: Build, rand: Rand, count = 3, boons?: Levels<BoonId>): Upgrade[] {
  const pool = optionPool(build);
  const picked: Upgrade[] = [];
  while (picked.length < count && pool.length > 0) picked.push(takeWeighted(pool, rand));
  if (boons && picked.length < count) picked.push(...boonOptions(boons, rand, count - picked.length));
  if (picked.length < count) picked.push({ type: 'heal' });
  if (picked.length < count) picked.push({ type: 'embers' });
  return picked;
}

/** 레벨업에 나올 수 있는 것 모두: 아직 덜 올린 무기와 패시브. 칸이 찼으면 가진 것만 나오고, 골라낸 것은 빠진다. */
function optionPool(build: Build): Upgrade[] {
  const pool: Upgrade[] = [];
  const banned = build.banned ?? [];
  const full = ownedWeapons(build.weapons).length >= (build.slots ?? MAX_WEAPONS);
  for (const id of WEAPON_ORDER) {
    const level = build.weapons[id] ?? 0;
    if ((level === 0 && full) || banned.includes(id)) continue;
    if (level < MAX_LEVEL) pool.push({ type: 'weapon', id, level: level + 1 });
  }
  // 패시브도 칸이 다 차면 새 것은 나오지 않는다.
  const fullPassives = ownedPassives(build.passives).length >= MAX_PASSIVES;
  for (const id of Object.keys(PASSIVES) as PassiveId[]) {
    const level = build.passives[id] ?? 0;
    if ((level === 0 && fullPassives) || banned.includes(id)) continue;
    if (level < MAX_LEVEL) pool.push({ type: 'passive', id, level: level + 1 });
  }
  return pool;
}

/** pool에서 하나를 뽑아 꺼낸다. 가진 무기를 올리는 쪽이 조금 더 자주 나오게 해서 빌드가 흩어지지 않게 한다. */
function takeWeighted(pool: Upgrade[], rand: Rand): Upgrade {
  const weight = (u: Upgrade): number =>
    u.type === 'weapon' ? (u.level > 1 ? 3 : 2) : u.type === 'passive' ? (u.level > 1 ? 2 : 1.5) : 1;
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
  return pool.splice(index, 1)[0];
}

/** 같은 것을 올리는 선택지인지(레벨은 보지 않는다) */
export const sameUpgrade = (a: Upgrade, b: Upgrade): boolean =>
  a.type === b.type && ('id' in a ? a.id : '') === ('id' in b ? b.id : '');

/** 골라낼 수 있는 선택지인지: 무기와 패시브만 골라낸다. 회복과 불씨와 밤의 축복은 뺄 수 없다. */
export function canBanish(upgrade: Upgrade): upgrade is Upgrade & { type: 'weapon' | 'passive' } {
  return upgrade.type === 'weapon' || upgrade.type === 'passive';
}

/**
 * 골라내기: 선택지의 index번째 자리에 새것을 하나 뽑아 넣는다. 나머지 선택지는 그대로 둔다.
 * 뺀 것은 build.banned에 이미 들어 있어야 한다. 더 나올 것이 없으면 회복이나 불씨가(끝없는 밤에서는 밤의 축복이) 채운다.
 */
export function swapOption(
  offer: readonly Upgrade[],
  index: number,
  build: Build,
  rand: Rand,
  boons?: Levels<BoonId>,
): Upgrade[] {
  const rest = offer.filter((_, i) => i !== index);
  const fresh = (candidates: readonly Upgrade[]): Upgrade[] =>
    candidates.filter((candidate) => !rest.some((kept) => sameUpgrade(kept, candidate)));
  const pool = fresh(optionPool(build));
  // 더 나올 무기나 패시브가 없을 때만 채울 것을 찾는다(밤의 축복을 뽑느라 난수를 헛되이 쓰지 않는다).
  const filler = (): Upgrade[] =>
    fresh([...(boons ? boonOptions(boons, rand, BOON_ORDER.length) : []), { type: 'heal' }, { type: 'embers' }]);
  const next: Upgrade | undefined = pool.length > 0 ? takeWeighted(pool, rand) : filler()[0];
  // 채울 것이 하나도 없으면(회복과 불씨가 이미 둘 다 나와 있으면) 그 자리를 비운다.
  return next ? offer.map((upgrade, i) => (i === index ? next : upgrade)) : rest;
}

/**
 * 보물 상자가 올려 줄 것 하나: 가진 무기나 패시브 가운데 아직 끝까지 올리지 않은 것.
 * 새 것을 주거나 진화시키지는 않는다. 올릴 것이 없으면 null(상자는 대신 불씨를 준다).
 */
export function chestUpgrade(build: Build, rand: Rand): Upgrade | null {
  const pool: Upgrade[] = [];
  for (const id of WEAPON_ORDER) {
    const level = build.weapons[id] ?? 0;
    if (level > 0 && level < MAX_LEVEL) pool.push({ type: 'weapon', id, level: level + 1 });
  }
  for (const id of Object.keys(PASSIVES) as PassiveId[]) {
    const level = build.passives[id] ?? 0;
    if (level > 0 && level < MAX_LEVEL) pool.push({ type: 'passive', id, level: level + 1 });
  }
  if (pool.length === 0) return null;
  return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
}

/** 밤의 축복 선택지: 여섯 가지 가운데 겹치지 않게 count개. 어느 것이나 같은 확률로 나온다. */
export function boonOptions(boons: Levels<BoonId>, rand: Rand, count = 3): Upgrade[] {
  const pool = [...BOON_ORDER];
  const picked: Upgrade[] = [];
  while (picked.length < count && pool.length > 0) {
    const index = Math.min(pool.length - 1, Math.floor(rand() * pool.length));
    const [id] = pool.splice(index, 1);
    picked.push({ type: 'boon', id, level: boonLevel(boons, id) + 1 });
  }
  return picked;
}

/**
 * 무기 강화권으로 고를 수 있는 것: 가진 무기 가운데 아직 더 올릴 수 있는 것 전부.
 * MAX_LEVEL인 무기에 쓰면 최종 진화형(EVOLVE_LEVEL)이 된다. 진화는 이 길로만 할 수 있다.
 * 잔치의 밤에서는 여섯 장까지 되므로, 진화하는 것을 맨 위에 두고 나머지는 레벨이 높은 차례로 둔다.
 * 레벨이 같으면 도감의 차례(위쪽 칸 줄의 차례)를 따른다.
 * 올릴 무기가 없으면 회복과 불씨 가운데에서 고른다.
 */
export function ticketOptions(weapons: Levels<WeaponId>): Upgrade[] {
  const options: Array<Upgrade & { type: 'weapon' }> = [];
  for (const id of ownedWeapons(weapons)) {
    const level = weapons[id] ?? 0;
    if (level < EVOLVE_LEVEL) options.push({ type: 'weapon', id, level: level + 1 });
  }
  // sort는 같은 값끼리의 차례를 그대로 둔다.
  options.sort((a, b) => b.level - a.level);
  return options.length > 0 ? options : [{ type: 'heal' }, { type: 'embers' }];
}

export function upgradeTitle(upgrade: Upgrade): string {
  switch (upgrade.type) {
    case 'weapon':
      return weaponName(upgrade.id, upgrade.level);
    case 'passive':
      return PASSIVES[upgrade.id].name;
    case 'boon':
      return BOONS[upgrade.id].name;
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
      // 부싯돌도 그 레벨에서의 확률을 바로 적어 준다.
      if (upgrade.id === 'flint') {
        return `쓰러진 그림자가 ${Math.round(sparkChance(upgrade.level) * 100)}% 확률로 터진다`;
      }
      return PASSIVES[upgrade.id].perLevel;
    case 'boon':
      return BOONS[upgrade.id].description;
    case 'heal':
      return `체력 ${HEAL_AMOUNT} 회복`;
    case 'embers':
      return `불씨 ${EMBER_BONUS}개`;
  }
}

// ---------------------------------------------------------------- 결과와 보상

export interface RunSummary {
  /** 버틴 시간(초). 새벽까지는 마지막 보스가 나타난 때에서 멈추고, 끝없는 밤에서 버틴 시간이 그 위에 더해진다. */
  seconds: number;
  /** 그 가운데 끝없는 밤에서 버틴 시간(초). 끝없는 밤에 들어가지 않았으면 0 */
  endlessSeconds: number;
  /** 쓰러뜨린 그림자 전부. 결과 화면에 보여 준다. */
  kills: number;
  /**
   * 점수와 불씨에 세는 처치 수: 마지막 보스가 나타나기 전까지 쓰러뜨린 것과, 끝없는 밤에서 쓰러뜨린 것.
   * 마지막 보스가 나온 뒤에도 그림자는 계속 몰려오므로, 보스와 싸우는 동안의 처치까지 세면
   * 보스를 일부러 남겨 두고 끝없이 점수와 불씨를 올릴 수 있다. 끝없는 밤은 갈수록 어려워져서 그럴 수 없다.
   */
  countedKills: number;
  level: number;
  bossKills: number;
  /** 새벽을 맞았는지. 끝없는 밤에서 쓰러져도 새벽을 맞은 것은 그대로다. */
  cleared: boolean;
  /** 레벨업에서 고른 불씨 주머니 */
  bonusEmbers: number;
  /** 깊은 밤의 단계. 0이 보통 밤 */
  depth: number;
  /** 잔치의 밤이면 그 난이도. 보통 판에는 없다. */
  feast?: FeastId;
}

/**
 * 허브의 최고 기록과 랭킹에 쓰는 점수. 버틴 시간도 처치 수도 마지막 보스가 나타난 때까지만 세고,
 * 끝없는 밤으로 이어 갔으면 거기서 버틴 시간과 쓰러뜨린 수가 더해진다.
 * 깊은 밤에서는 단계의 배율이 통째로 곱해지고, 잔치의 밤이면 그 난이도의 배율(feastReward)도 곱해진다.
 * 랭킹에 올릴 수 있는 가장 큰 점수를 넘지 않는다.
 */
export function scoreFor(run: RunSummary): number {
  const base = Math.floor(run.seconds) + run.countedKills + 150 * run.bossKills + (run.cleared ? 1000 : 0);
  return Math.min(MAX_SCORE, Math.floor(base * depthRules(run.depth).score * feastReward(run.feast)));
}

/**
 * 판이 끝나고 받는 불씨. 오래 버틸수록, 많이 쓰러뜨릴수록 많다. 처치는 점수와 같은 수(countedKills)로 센다.
 * 끝없는 밤에서 버틴 시간과 쓰러뜨린 것도 같은 셈으로 더해진다.
 * lucky는 영구 강화 "불씨 복"의 단계로, 한 단계에 10%씩 더 준다. 깊은 밤에서는 단계의 배율도 곱해지고,
 * 잔치의 밤에서는 그 난이도의 배율(feastReward)도 곱해진다.
 */
export function embersFor(run: RunSummary, lucky = 0): number {
  const minutes = Math.floor(run.seconds / 60);
  const earned =
    minutes * 3 + Math.floor(run.countedKills / 40) + 8 * run.bossKills + (run.cleared ? 40 : 0) + run.bonusEmbers;
  return Math.floor(earned * depthRules(run.depth).embers * (1 + 0.1 * Math.max(0, lucky)) * feastReward(run.feast));
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

/** 아직 살 수 없는 영구 강화인지: 새벽을 한 번 맞아야 열리는 것이 있다(clears는 새벽을 맞은 횟수). */
export function metaLocked(id: MetaId, clears: number): boolean {
  return META[id].needsDawn === true && clears < 1;
}

/** 밤의 축복을 고를 때 나오는 선택지의 수. 영구 강화 "너른 축복"이 하나 늘린다. */
export function boonChoiceCount(meta: Levels<MetaId>): number {
  return 3 + Math.max(0, Math.min(META.vigil.maxLevel, Math.floor(meta.vigil ?? 0)));
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
