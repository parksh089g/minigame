/**
 * 등불지기 한 판의 시뮬레이션. 화면(Phaser)과 떨어져 있어서 테스트에서 그대로 돌릴 수 있고,
 * 상태(RunState)가 평범한 데이터라서 그대로 저장했다가 이어서 할 수 있다.
 */
import {
  BOON_VALUES,
  BOONS,
  CHEST,
  CHILL_SLOW,
  ELITE,
  ENDLESS,
  ENEMIES,
  FEAST,
  FEAST_LEVELS,
  FLINT,
  GLIDE,
  HEROES,
  MAX_LEVEL,
  MAX_PASSIVES,
  MID_BOSS_COUNT,
  MID_BOSS_EVERY,
  PLAYER_BASE,
  POSTS,
  QUAKE,
  RUN_SECONDS,
  SPROUT,
  STAGES,
  SURGES,
  type BoonId,
  type BurstInfo,
  type EnemyKind,
  type FeastId,
  type HeroId,
  type MetaId,
  type PassiveId,
  type StageId,
  type WeaponId,
} from './data';
import {
  auraStats,
  bellStats,
  boltStats,
  boonLevel,
  boonOptions,
  chestUpgrade,
  clampDepth,
  damageScale,
  depthRules,
  EMBER_BONUS,
  emberStats,
  endlessBossKind,
  endlessScale,
  enemyHp,
  fireflyStats,
  HEAL_AMOUNT,
  isEvolved,
  lanceStats,
  maxAlive,
  midBossKind,
  midBossTier,
  minionKind,
  modifiers,
  beamStats,
  moonStats,
  oilStats,
  ownedPassives,
  ownedWeapons,
  pickSpawnKind,
  spawnPerSecond,
  speedScale,
  starStats,
  ticketOptions,
  upgradeOptions,
  isFeast,
  weaponSlotCount,
  xpToNext,
  type DepthRules,
  type Levels,
  type Modifiers,
  type Rand,
  type RunSummary,
  type Upgrade,
} from './rules';
import {
  GUST,
  gustAt,
  inPuddle,
  LEAP,
  PUDDLE_SLOW,
  shroomAt,
  VENT,
  ventAt,
  ventClock,
  ventPhase,
  ventsAround,
  type Gust,
} from './terrain';

export const RUN_STATE_VERSION = 3;

export interface Enemy {
  uid: number;
  kind: EnemyKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** 맞아서 하얗게 보이는 남은 시간(초) */
  flash: number;
  /** 느려진 남은 시간(초) */
  slow: number;
  /** 느려져 있는 동안의 이동 속도 배율 */
  slowTo: number;
  /** 반딧불에 다시 맞을 수 있을 때까지(초) */
  fireflyCd: number;
  /** 등대빛에 다시 맞을 수 있을 때까지(초). 같은 빛줄기가 지나가는 동안 거듭 맞지 않게 한다. */
  beamCd?: number;
  /** 보스의 다음 행동까지, 뛰는 적의 다음 뜀이나 착지까지, 쏘는 적의 다음 발사까지, 터지는 적이 터질 때까지(초) */
  timer: number;
  /**
   * 돌진하는 보스: 0 쫓기, 1 힘 모으기, 2 돌진.
   * 빛덩이를 쏘는 보스: 0 다음은 쏘기, 1 다음은 부하 부르기(늪의 어미만), 2 쏘려고 빛을 모으는 중.
   * 뛰는 적: 0 웅크림, 1 뛰는 중
   * 쏘는 적: 0 다가오거나 기다리는 중, 1 쏘려고 숨을 들이쉬는 중
   * 터지는 적: 0 쫓기, 1 부푸는 중
   */
  mode: number;
  /** 몇 번째 중간 보스인지(0부터). 다른 적은 0 */
  tier: number;
  vx: number;
  vy: number;
  /** 종소리에 밀려 더 물러날 거리(px). 조금씩 줄어든다. 없으면 밀리는 중이 아니다. */
  kx?: number;
  ky?: number;
  /** 부싯돌이 터져서 쓰러진 것. 다시 터지지 않는다. */
  sparked?: boolean;
  /** 잔치의 밤에서 쓰러뜨리면 무기 강화권도 주는 정예(FEAST.ticketElites) */
  ticket?: boolean;
}

/** 등불 기둥. 닿으면 불이 켜지고, 켜져 있는 동안 둘레의 그림자를 태운다. */
export interface Post {
  x: number;
  y: number;
  /** 불이 꺼질 때까지 남은 시간(초). 0이면 아직 켜지 않았다. */
  lit: number;
  /** 다음에 둘레를 태울 때까지(초) */
  tick: number;
}

/** 빛버섯을 밟고 뛰는 중인 플레이어의 길. (x0, y0)에서 (x1, y1)까지 LEAP.seconds 동안 날아간다. */
export interface Leap {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** 뛰어오른 지 몇 초인지 */
  t: number;
}

/** 도토리 같은 그림자가 쓰러진 자리에 남긴 싹 */
export interface Sprout {
  x: number;
  y: number;
  /** 자라서 그림자가 될 때까지 남은 시간(초) */
  t: number;
}

/** 숲의 고목이 퍼뜨리는 땅울림 고리. 틈 QUAKE.gaps개가 같은 간격으로 나 있다. */
export interface Quake {
  x: number;
  y: number;
  /** 지금의 반지름(px). 고리의 바깥 가장자리다. */
  r: number;
  /** 첫 틈의 가운데가 향하는 각도(라디안) */
  gap: number;
  damage: number;
  /** 퍼지기 시작할 때까지 남은 시간(초). 두 겹을 퍼뜨릴 때 두 번째 겹이 기다린다. */
  delay: number;
  /** 이미 플레이어를 다치게 했다. 한 고리에는 한 번만 다친다. */
  hit?: boolean;
}

/** 날아가는 것의 생김새. 화면에서 그림을 고를 때 쓴다. */
export type ShotLook = 'ember' | 'emberEvo' | 'lance' | 'lanceEvo';

export interface Shot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  pierce: number;
  life: number;
  /** 판정 반지름(px) */
  radius: number;
  look: ShotLook;
  /** 이미 맞힌 적. 관통할 때 같은 적을 두 번 때리지 않는다. */
  hit: number[];
}

export interface Gem {
  x: number;
  y: number;
  /** 경험치. kind가 heal이면 회복량. 자석과 불꽃 단지에서는 쓰지 않는다. */
  value: number;
  /**
   * xp는 빛 조각, heal은 회복 떡.
   * pull은 자석: 주우면 싸움터의 빛 조각이 모두 끌려온다.
   * blast는 불꽃 단지: 주우면 화면 안의 보통 그림자가 모두 쓰러지고 보스는 조금 다친다.
   * chest는 보물 상자: 정예 그림자가 떨어뜨리고, 주우면 가진 것 하나가 한 단계 오른다.
   */
  kind: 'xp' | 'heal' | 'pull' | 'blast' | 'chest';
  /** 끌려오는 중인지 */
  pulled: boolean;
}

export interface Strike {
  x: number;
  y: number;
  delay: number;
  radius: number;
  damage: number;
  evolved: boolean;
}

/** 보스가 쏜 빛덩이. 플레이어가 닿으면 다친다. */
export interface Hazard {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 남은 시간(초) */
  life: number;
  radius: number;
  damage: number;
}

/** 등잔 기름이 남긴 불길 */
export interface Fire {
  x: number;
  y: number;
  radius: number;
  /** 남은 시간(초) */
  life: number;
  /** 다음에 태울 때까지(초) */
  tick: number;
  /** 태우는 간격(초) */
  every: number;
  damage: number;
  /** 닿은 적의 이동 속도 배율 */
  slow: number;
  evolved: boolean;
}

/** 종소리: 울린 자리에서 둘레로 퍼져 나가는 고리 */
export interface Wave {
  x: number;
  y: number;
  /** 지금의 반지름(px) */
  radius: number;
  /** 이만큼 퍼지면 사라진다 */
  max: number;
  /** 울리기까지 남은 시간(초). 두 번째 종소리는 조금 뒤에 울린다. */
  delay: number;
  damage: number;
  /** 닿은 보통 그림자가 밀려나는 거리(px) */
  push: number;
  /** 닿은 적의 이동 속도 배율 */
  slow: number;
  /** 이미 닿은 적. 한 번의 종소리는 같은 적을 한 번만 때린다. */
  hit: number[];
  evolved: boolean;
}

/** 초승달: 겨눈 쪽으로 날아갔다가 플레이어에게 돌아온다 */
export interface Moon {
  x: number;
  y: number;
  /** 날아가는 쪽(길이 1) */
  dx: number;
  dy: number;
  /** 가는 길에 더 날아갈 거리(px). 다 가면 돌아선다. */
  left: number;
  /** 돌아오는 중인지 */
  back: boolean;
  speed: number;
  damage: number;
  /** 판정 반지름(px) */
  radius: number;
  /** 0이면 가는 길과 오는 길에 한 번씩만 벤다. 아니면 이 간격(초)마다 같은 적을 다시 벤다. */
  rehit: number;
  /** 다시 벨 수 있게 될 때까지 남은 시간(초). rehit이 있을 때만 쓴다. */
  sweep: number;
  /** 이미 벤 적. 돌아설 때 비운다. */
  hit: number[];
  /** 남은 시간(초). 돌아오지 못하고 떠도는 일이 없게 한다. */
  life: number;
  evolved: boolean;
}

export interface RunState {
  version: number;
  /** 지난 시간(초) */
  t: number;
  viewW: number;
  viewH: number;
  /** 이 판을 시작할 때의 영구 강화 */
  meta: Levels<MetaId>;
  hero: HeroId;
  stage: StageId;
  /** 깊은 밤의 단계. 없으면 보통 밤(0)이다. 깊은 밤이 생기기 전에 저장한 판에는 없다. */
  depth?: number;
  /** 지형을 정하는 씨앗. 같은 값이면 웅덩이가 같은 자리에 있다. */
  seed: number;
  /** 오늘의 판이면 그날(daily.ts의 dayIndexOf). 보통 판에는 없다. */
  daily?: number;
  /** 잔치의 밤(data.ts의 FEAST)이면 그 난이도. 보통 판에는 없다. */
  feast?: FeastId;
  player: {
    x: number;
    y: number;
    hp: number;
    /** 남은 무적 시간(초) */
    inv: number;
    face: 1 | -1;
    moving: boolean;
    /** 웅덩이에 빠져 느려진 상태 */
    wading: boolean;
    level: number;
    xp: number;
    /** 등갓의 빛막이 다시 생길 때까지 남은 시간(초). 0이거나 없으면 빛막이 서 있다(등갓이 있을 때). */
    guard?: number;
    /** 불구멍에 덴 뒤 다시 데지 않는 남은 시간(초). 한 번 솟는 동안 한 번만 데게 한다. */
    scorch?: number;
    /** 서릿발 같은 그림자에 닿아 발이 얼어 있는 남은 시간(초). 그동안 느리게 걷는다. */
    chilled?: number;
    /** 빛버섯을 밟고 뛰는 중이면 그 길. 뛰는 동안은 다치지 않고, 내려앉을 때까지 걷지 못한다. */
    leap?: Leap;
  };
  weapons: Levels<WeaponId>;
  passives: Levels<PassiveId>;
  enemies: Enemy[];
  shots: Shot[];
  gems: Gem[];
  strikes: Strike[];
  fires: Fire[];
  hazards: Hazard[];
  /** 퍼지고 있는 종소리와 날고 있는 초승달. 이 무기들이 생기기 전에 저장한 판에는 없어서, 이어 할 때 채운다. */
  waves: Wave[];
  moons: Moon[];
  /** 싸움터에 서 있는 등불 기둥. 기둥이 생기기 전에 저장한 판에는 없다. */
  posts?: Post[];
  /** 지금까지 나타난 등불 기둥의 수. POSTS.times의 몇 번째까지 나왔는지를 가리킨다. */
  postsSpawned?: number;
  /** 빛버섯 숲: 밟혀 납작해진 빛버섯(terrain.ts의 Shroom.key)과 다시 부푸는 시각(초) */
  squashed?: Record<string, number>;
  /** 빛버섯 숲: 쓰러진 도토리가 남긴 싹 */
  sprouts?: Sprout[];
  /** 빛버섯 숲: 퍼지고 있는 땅울림 고리 */
  quakes?: Quake[];
  /**
   * 이 판에서 만난 것: 나타난 적의 종류와, 주운 것('heal', 'pull', 'blast'), 등불 기둥('post').
   * 판이 끝나면 도감에 적힌다. 도감이 생기기 전에 저장한 판에는 없다.
   */
  seen?: string[];
  /** 지금까지 나온 정예 그림자의 수. ELITE.times의 몇 번째까지 나왔는지를 가리킨다. 정예가 생기기 전에 저장한 판에는 없다. */
  elites?: number;
  /** 이 판에서 연 보물 상자의 수 */
  chests?: number;
  cd: { ember: number; aura: number; star: number; lance: number; oil: number; bolt: number; bell: number; moon: number };
  fireflyAngle: number;
  /** 등대빛의 첫 줄기가 가리키는 쪽(라디안). 등대빛이 생기기 전에 저장한 판에는 없다. */
  beamAngle?: number;
  spawnDebt: number;
  surgeIndex: number;
  /** 지금까지 나온 중간 보스의 수 */
  midBosses: number;
  finalBoss: boolean;
  kills: number;
  /**
   * 마지막 보스가 나타난 순간까지 쓰러뜨린 수. 그 전에는 없다.
   * 점수와 불씨에는 여기까지만 센다(rules.ts의 RunSummary.countedKills).
   */
  killsBeforeBoss?: number;
  bossKills: number;
  bonusEmbers: number;
  /** 아직 고르지 않은 레벨업 횟수. 0보다 크면 시뮬레이션이 멈춘다. */
  pendingLevelUps: number;
  /** 아직 쓰지 않은 무기 강화권. 0보다 크면 시뮬레이션이 멈춘다. */
  pendingTickets: number;
  /** 쓰러졌을 때 다시 일어날 수 있는 남은 횟수 */
  revives: number;
  /** 레벨업 선택지를 다시 뽑을 수 있는 남은 횟수. 없으면 0이다. 다시 뽑기가 생기기 전에 저장한 판에는 없다. */
  rerolls?: number;
  /** 무기마다 지금까지 준 피해. 결과 화면과 일시정지 화면에서 비중으로 보여 준다. 이것이 생기기 전에 저장한 판에는 없다. */
  dealt?: Levels<WeaponId>;
  /**
   * 지금 보여 주고 있는 레벨업 선택지. 고르면 지워진다.
   * 판과 함께 저장해서, 고르다가 나갔다 들어와도 같은 선택지가 나온다(나갔다 들어오는 것으로 공짜로 다시 뽑지 못한다).
   */
  offer?: Upgrade[];
  nextUid: number;
  /**
   * 새벽을 맞았을 때 끝없는 밤으로 이어 갈 수 있는 판인지. 이 값이 없으면 새벽에서 판이 끝난다
   * (끝없는 밤이 생기기 전에 저장한 판도 그렇다).
   */
  endlessOpen?: boolean;
  /** 새벽을 맞았고, 여기서 마칠지 끝없는 밤으로 이어 갈지 아직 고르지 않았다. 고를 때까지 시뮬레이션이 멈춘다. */
  pendingDawn?: boolean;
  /**
   * 끝없는 밤: 새벽을 맞은 뒤에 이어 가기로 했을 때만 있다.
   * at은 들어선 때(초), kills는 그때까지 쓰러뜨린 수, bosses와 surges는 그 뒤로 나온 보스와 밀물의 수.
   */
  endless?: { at: number; kills: number; bosses: number; surges: number; boons?: number };
  /** 끝없는 밤에서 받은 밤의 축복. 축복마다 받은 횟수다. */
  boons?: Levels<BoonId>;
  /** 아직 고르지 않은 밤의 축복. 0보다 크면 시뮬레이션이 멈춘다. */
  pendingBoons?: number;
  /** 지금 보여 주고 있는 밤의 축복 선택지. 고르면 지워진다(레벨업의 offer와 같은 까닭으로 판과 함께 저장한다). */
  boonOffer?: Upgrade[];
  /** 새벽을 맞고 마쳤으면 cleared. 끝없는 밤에서 쓰러졌으면 dead지만 새벽을 맞은 것은 그대로다(RunSummary.cleared). */
  over: null | 'dead' | 'cleared';
}

/** 돌진하는 보스가 겨눈 쪽이 굳는 때: 내달리기 이만큼(초) 전 */
export const AIM_LOCK_SECONDS = 0.25;
/** 빛덩이를 쏘는 보스가 쏘기 전에 빛을 모으는 시간(초) */
export const CHARGE_SECONDS = 0.45;
/** 빛덩이를 쏘는 보스가 빛을 모으는 중일 때의 mode */
export const CHARGING = 2;
/**
 * 고개의 문지기는 돌진과 쏘기를 번갈아 해서 mode를 더 쓴다:
 * 0 쫓는다 · 1 힘을 모은다 · 2 내달린다 · WARDEN_REST 숨을 고른다 · WARDEN_CHARGING 빛을 모은다
 */
export const WARDEN_REST = 3;
export const WARDEN_CHARGING = 4;
/** 눈보라의 눈이 사방으로 여러 겹을 쏘고 있는 상태. 그 앞에 CHARGING으로 빛을 모은다. */
export const BLIZZARD_FIRING = 5;
/**
 * 눈보라의 눈이 쏘는 겹: rings겹을 gap초 간격으로, 한 겹에 count갈래.
 * 겹마다 반 칸씩 어긋나서, 앞 겹의 틈으로 피한 자리에 다음 겹이 온다.
 */
export const BLIZZARD = { rings: 3, count: 9, gap: 0.6, damage: 12 } as const;

/** angle 쪽이 땅울림 고리의 틈 안인지 */
export function inQuakeGap(quake: Quake, angle: number): boolean {
  const step = (Math.PI * 2) / QUAKE.gaps;
  // 첫 틈에서 잰 각도를 틈 사이의 간격으로 접어서, 가장 가까운 틈의 가운데에서 얼마나 떨어졌는지 본다.
  const off = (((angle - quake.gap) % step) + step) % step;
  return Math.min(off, step - off) < QUAKE.gap / 2;
}

/**
 * 땅울림 고리가 이번 걸음에 (x, y)에 있는 반지름 radius의 둥근 것을 지나갔는지. before는 걸음 전의 반지름이다.
 * 고리의 틈 안에 있으면 지나가도 닿지 않는다.
 */
export function quakeCrosses(quake: Quake, before: number, x: number, y: number, radius: number): boolean {
  const dx = x - quake.x;
  const dy = y - quake.y;
  const d = Math.hypot(dx, dy);
  if (d < before - QUAKE.band - radius || d > quake.r + radius) return false;
  return !inQuakeGap(quake, Math.atan2(dy, dx));
}

/** 돌진하는 보스가 힘을 모으는 시간(초), 내달리는 빠르기(px/초)와 시간(초) */
export function dashOf(kind: EnemyKind, tier: number): { windup: number; speed: number; seconds: number } {
  const brain = ENEMIES[kind].brain;
  if (brain === 'lord') return { windup: 0.7, speed: 125, seconds: 0.75 };
  if (brain === 'warden') return { windup: 0.65, speed: 118, seconds: 0.72 };
  return { windup: 0.6, speed: 108 + 8 * tier, seconds: 0.7 };
}

export type SimEvent =
  | { type: 'kill'; x: number; y: number; boss: boolean }
  | { type: 'hurt' }
  | { type: 'gem' }
  | { type: 'heal' }
  /** 자석을 주워 빛 조각이 모두 끌려오기 시작했다 */
  | { type: 'pull' }
  /** 불꽃 단지를 주워 화면의 그림자가 타 버렸다 */
  | { type: 'blast' }
  /** 등갓의 빛막이 피해를 막았다 */
  | { type: 'block' }
  /** 쏘는 적이 어둠 방울을 뱉었다 */
  | { type: 'spit' }
  /** 터지는 적이 가까이 와서 부풀기 시작했다 */
  | { type: 'swell' }
  /** 터지는 적이 (x, y)에서 터졌다 */
  | { type: 'burst'; x: number; y: number; radius: number }
  /** 등불 기둥이 (x, y)에 나타났다. first는 이 판의 첫 기둥인지 */
  | { type: 'post'; x: number; y: number; first: boolean }
  /** 등불 기둥에 불이 켜졌다 */
  | { type: 'light'; x: number; y: number }
  /** 등불 기둥이 다 타서 사라졌다 */
  | { type: 'dim'; x: number; y: number }
  | { type: 'levelup' }
  | { type: 'shoot' }
  | { type: 'strike'; x: number; y: number; radius: number }
  /** 번갯불이 지나간 길. points는 x, y가 번갈아 들어 있다. */
  | { type: 'bolt'; points: number[]; evolved: boolean }
  /** 화면 가까이의 불구멍에서 불길이 솟기 시작했다 */
  | { type: 'vent'; x: number; y: number }
  /** 돌풍이 일기 시작했거나(warn) 세게 불기 시작했다(blow). dirX, dirY는 바람이 부는 쪽 */
  | { type: 'gust'; phase: 'warn' | 'blow'; dirX: number; dirY: number }
  /** 서릿발 같은 그림자에 닿아 발이 얼었다 */
  | { type: 'chill' }
  /** 빛버섯을 밟고 (x, y)에서 뛰어올랐다 */
  | { type: 'leap'; x: number; y: number }
  /** 뛰었다가 (x, y)에 내려앉았다 */
  | { type: 'land'; x: number; y: number }
  /** 쓰러진 그림자가 싹을 남겼다 */
  | { type: 'plant' }
  /** (x, y)의 싹을 밟아 없앴다 */
  | { type: 'stomp'; x: number; y: number }
  /** (x, y)의 싹이 그림자로 자랐다 */
  | { type: 'sprout'; x: number; y: number }
  /** (x, y)에서 땅울림 고리가 퍼지기 시작했다 */
  | { type: 'quake'; x: number; y: number }
  /** 빛버섯을 딛고 덮치는 정예가 뛰어올랐다 */
  | { type: 'pounce' }
  /** 뛰어오른 정예가 (x, y)에 내려앉았다. radius는 다치는 둘레 */
  | { type: 'thud'; x: number; y: number; radius: number }
  /** 종소리가 울렸다 */
  | { type: 'bell'; evolved: boolean }
  /** 부싯돌: 쓰러진 그림자가 (x, y)에서 터졌다 */
  | { type: 'spark'; x: number; y: number; radius: number }
  | { type: 'boss'; kind: EnemyKind }
  /** 정예 그림자가 나타났다 */
  | { type: 'elite'; kind: EnemyKind }
  /** 보물 상자를 열었다. upgrade는 오른 것, 올릴 것이 없어 불씨를 받았으면 null */
  | { type: 'chest'; upgrade: Upgrade | null }
  | { type: 'ticket' }
  /** 끝없는 밤에서 밤의 축복을 고를 때가 됐다 */
  | { type: 'boon' }
  /** 보스가 빛덩이를 쏘려고 빛을 모으기 시작했다 */
  | { type: 'charge' }
  /** 보스가 빛덩이를 쏘았다 */
  | { type: 'volley' }
  /** 보스가 돌진하려고 멈춰서 힘을 모으기 시작했다 */
  | { type: 'windup' }
  /** 보스가 내달리기 시작했다 */
  | { type: 'dash' }
  /** 쓰러졌다가 되살림 등불로 다시 일어났다 */
  | { type: 'revive' }
  | { type: 'surge' };

export interface RunConfig {
  viewW: number;
  viewH: number;
  meta: Levels<MetaId>;
  /** 안 주면 등불지기 */
  hero?: HeroId;
  /** 안 주면 밤의 풀밭 */
  stage?: StageId;
  /** 깊은 밤의 단계. 안 주면 보통 밤(0) */
  depth?: number;
  /** 지형 씨앗. 안 주면 1 */
  seed?: number;
  /** 오늘의 판이면 그날(daily.ts의 dayIndexOf) */
  daily?: number;
  /** 새벽을 맞았을 때 끝없는 밤으로 이어 갈지 물을지. 안 주면 새벽에서 판이 끝난다. */
  endless?: boolean;
  /** 잔치의 밤의 난이도. 안 주거나 null이면 보통 판 */
  feast?: FeastId | null;
}

/** 끝없는 밤이 얹는 난이도가 없을 때의 값 */
const NO_ENDLESS = { hp: 1, damage: 1, speed: 1 } as const;

const CELL = 20;
const BUCKETS = 4096;
const EMBER_RADIUS = 3;
const FIREFLY_RADIUS = 4;
const EMBER_RANGE = 130;
const LANCE_RANGE = 170;
/** 꿰뚫는 화살은 사라질 때까지 몇이든 꿰뚫는다. */
const PIERCE_ALL = 9999;
/** 초승달이 겨누는 거리(px) */
/** 등대빛에 맞은 적이 다시 맞을 수 있을 때까지(초). 빛줄기와 나란히 움직이는 적이 거듭 맞지 않게 한다. 다음 줄기가 오기 전에는 풀린다. */
export const BEAM_REHIT = 0.3;
const MOON_RANGE = 120;
/** 초승달이 여럿일 때 벌어지는 각도(라디안) */
const MOON_SPREAD = 0.5;
/** 돌아온 초승달을 받아 드는 거리(px) */
const MOON_CATCH = 8;
/** 초승달이 날아다닐 수 있는 가장 긴 시간(초) */
const MOON_LIFE = 4;
/** 종소리가 퍼지는 빠르기(px/초)와, 두 번 울릴 때의 사이(초) */
const BELL_SPEED = 170;
const BELL_GAP = 0.3;
/** 종소리에 밀려난 그림자가 물러나는 빠르기(px/초) */
const PUSH_SPEED = 140;
/** 쪼개져 나온 그림자가 튀어 나가는 거리(px) */
const SPLIT_PUSH = 9;
const GEM_LIMIT = 220;
const GEM_PICKUP = 7;
const GEM_SPEED = 170;
const SPAWN_MARGIN = 14;
/** 쓰러진 적이 회복 떡을 떨어뜨릴 확률 */
const HEAL_DROP_CHANCE = 0.008;
const HEAL_DROP_VALUE = 15;
/** 쓰러진 적이 자석과 불꽃 단지를 떨어뜨릴 확률. 끝까지 가는 판에서 저마다 대여섯 개쯤 줍게 된다. */
const PULL_DROP_CHANCE = 0.0012;
const BLAST_DROP_CHANCE = 0.001;
/** 불꽃 단지가 보스의 체력에서 덜어 내는 몫. 보통 그림자는 그 자리에서 쓰러진다. */
const BLAST_BOSS_SHARE = 0.08;
/** 불꽃 단지가 화면 가장자리 밖으로 닿는 거리(px). 반쯤 걸친 그림자까지 태운다. */
const BLAST_MARGIN = 8;
/** 빛막이 피해를 막은 뒤의 무적 시간(초). 적에게 둘러싸였을 때 빠져나올 틈을 준다. */
const GUARD_INVULNERABLE = 0.8;
/** 뛰는 적이 한 번 뛰는 시간과 웅크리고 쉬는 시간(초) */
export const HOP_SECONDS = 0.38;
export const HOP_REST = 0.44;
/** 보스가 쏘는 빛덩이 */
const HAZARD = { speed: 56, life: 3.6, radius: 3, spread: 0.24 } as const;
/** 쏘는 적의 어둠 방울. 보스의 빛덩이보다 느리고 멀리 가지 못해서, 옆으로 걸으면 피할 수 있다. */
const SPIT = { speed: 46, life: 2.6, radius: 3 } as const;
/** 날아다니는 것이 이만큼 있으면 쏘는 적은 쉬어 간다. 화면이 방울로 뒤덮이지 않게 한다. */
const SPIT_LIMIT = 6;
/** 되살아날 때: 채워지는 체력 비율, 무적 시간(초), 둘레의 적을 밀어내는 반경과 피해 */
const REVIVE = { hp: 0.5, invulnerable: 2.5, radius: 64, damage: 40 } as const;

export function createRun(config: RunConfig): RunState {
  const hero = config.hero ?? 'keeper';
  const mods = modifiers({}, config.meta, HEROES[hero].trait);
  // "밝은 출발"을 샀으면 그만큼 레벨이 오른 채로 시작해서, 첫 걸음을 떼기 전에 강화를 고른다.
  const headstart = Math.max(0, Math.floor(config.meta.headstart ?? 0));
  return {
    version: RUN_STATE_VERSION,
    t: 0,
    viewW: config.viewW,
    viewH: config.viewH,
    meta: { ...config.meta },
    hero,
    stage: config.stage ?? 'meadow',
    depth: clampDepth(config.depth),
    seed: config.seed ?? 1,
    ...(config.daily !== undefined ? { daily: config.daily } : {}),
    ...(config.endless ? { endlessOpen: true } : {}),
    ...(isFeast(config.feast) ? { feast: config.feast } : {}),
    player: {
      x: 0,
      y: 0,
      hp: mods.maxHp,
      inv: 0,
      face: 1,
      moving: false,
      wading: false,
      level: 1 + headstart,
      xp: 0,
    },
    weapons: { [HEROES[hero].weapon]: 1 },
    passives: {},
    enemies: [],
    shots: [],
    gems: [],
    strikes: [],
    fires: [],
    hazards: [],
    waves: [],
    moons: [],
    posts: [],
    postsSpawned: 0,
    seen: [],
    elites: 0,
    chests: 0,
    cd: { ember: 0.6, aura: 0, star: 1, lance: 0.8, oil: 0.5, bolt: 0.7, bell: 0.9, moon: 0.7 },
    fireflyAngle: 0,
    spawnDebt: 0,
    surgeIndex: 0,
    midBosses: 0,
    finalBoss: false,
    kills: 0,
    bossKills: 0,
    bonusEmbers: 0,
    pendingLevelUps: headstart,
    pendingTickets: 0,
    revives: config.meta.second ? 1 : 0,
    rerolls: Math.max(0, Math.floor(config.meta.reroll ?? 0)),
    dealt: {},
    nextUid: 1,
    over: null,
  };
}

/** 새벽을 맞은 판인지: 마칠지 이어 갈지 고르는 중이거나 끝없는 밤으로 이어 간 판. 버리면 새벽을 맞은 기록이 사라진다. */
export function runDawned(run: RunState | null | undefined): boolean {
  return Boolean(run && (run.pendingDawn === true || run.endless !== undefined));
}

/** 저장해 둔 판이 이어서 할 수 있는 모양인지 대강 확인한다. */
export function looksLikeRun(raw: unknown): raw is RunState {
  if (typeof raw !== 'object' || raw === null) return false;
  const run = raw as Partial<RunState>;
  return (
    run.version === RUN_STATE_VERSION &&
    typeof run.t === 'number' &&
    run.over === null &&
    typeof run.player === 'object' &&
    run.player !== null &&
    typeof run.hero === 'string' &&
    run.hero in HEROES &&
    typeof run.stage === 'string' &&
    run.stage in STAGES &&
    Array.isArray(run.enemies) &&
    Array.isArray(run.gems) &&
    Array.isArray(run.shots) &&
    Array.isArray(run.strikes) &&
    Array.isArray(run.fires) &&
    Array.isArray(run.hazards)
  );
}

/**
 * 저장해 둔 판을 이어서 할 수 있는 상태로 되돌린다. 쓸 수 없으면 null.
 * 캐릭터와 스테이지가 생기기 전(버전 2)에 저장한 판은 등불지기, 밤의 풀밭으로 이어 준다.
 */
export function restoreRun(raw: unknown): RunState | null {
  if (looksLikeRun(raw)) return raw;
  if (typeof raw !== 'object' || raw === null) return null;
  const old = raw as Record<string, unknown>;
  if (old.version !== 2 || typeof old.player !== 'object' || old.player === null) return null;
  const upgraded = {
    ...old,
    version: RUN_STATE_VERSION,
    hero: 'keeper',
    stage: 'meadow',
    seed: 1,
    hazards: [],
    revives: 0,
    player: { ...old.player, wading: false },
  };
  return looksLikeRun(upgraded) ? upgraded : null;
}

export class Sim {
  /** step()을 부를 때마다 비워지고 그 사이에 일어난 일이 쌓인다. */
  readonly events: SimEvent[] = [];
  mods: Modifiers;
  /** 이 판의 깊은 밤 규칙 */
  readonly depth: DepthRules;
  /** 끝없는 밤이 지금 얹는 난이도. 걸음마다 새로 셈한다. */
  private late: { hp: number; damage: number; speed: number } = NO_ENDLESS;

  private readonly heads = new Int32Array(BUCKETS);
  private next = new Int32Array(512);

  constructor(
    readonly state: RunState,
    private readonly rand: Rand,
  ) {
    this.mods = this.computeMods();
    this.depth = depthRules(state.depth ?? 0);
    // 무기별 피해량은 없어도 되는 항목이다. 예전 저장이나 엉뚱한 값이면 비워서 시작한다.
    const dealt: unknown = state.dealt;
    if (typeof dealt !== 'object' || dealt === null || Array.isArray(dealt)) state.dealt = {};
    // 등불 기둥이 생기기 전에 저장한 판: 이미 지난 시각의 기둥이 한꺼번에 나타나지 않게, 지난 것은 나온 것으로 친다.
    if (!Array.isArray(state.posts)) state.posts = [];
    if (typeof state.postsSpawned !== 'number') {
      state.postsSpawned = POSTS.times.filter((time) => time <= state.t).length;
    }
    // 정예 그림자가 생기기 전에 저장한 판: 이미 지난 시각의 것은 나온 셈 치고, 남은 것만 나오게 한다.
    if (typeof state.elites !== 'number') {
      state.elites = ELITE.times.filter((time) => time <= state.t).length;
    }
    // 종소리와 초승달이 생기기 전에 저장한 판: 빈 채로 채워서 이어 간다.
    if (!Array.isArray(state.waves)) state.waves = [];
    if (!Array.isArray(state.moons)) state.moons = [];
    if (typeof state.cd.bell !== 'number') state.cd.bell = 0.9;
    if (typeof state.cd.moon !== 'number') state.cd.moon = 0.7;
    // 도감이 생기기 전에 저장한 판: 지금 싸움터에 있는 것부터 만난 것으로 적는다.
    if (!Array.isArray(state.seen)) {
      state.seen = [];
      for (const e of state.enemies) this.note(e.kind);
      if (state.posts.length > 0) this.note('post');
    }
  }

  /** 이 판에서 만난 것으로 적어 둔다. */
  private note(id: string): void {
    const seen = (this.state.seen ??= []);
    if (!seen.includes(id)) seen.push(id);
  }

  private computeMods(): Modifiers {
    const s = this.state;
    const mods = modifiers(s.passives, s.meta, HEROES[s.hero].trait, s.boons);
    // 잔치의 밤은 무기 칸이 많은 만큼 빨리 자란다. 얼마나 빨리 자라는지는 난이도에 따른다.
    if (isFeast(s.feast)) mods.xp *= FEAST_LEVELS[s.feast].xp;
    return mods;
  }

  /** 이 판에 들 수 있는 무기의 수 */
  get slots(): number {
    return weaponSlotCount(this.state.feast);
  }

  get maxHp(): number {
    return this.mods.maxHp;
  }

  get magnetRadius(): number {
    return PLAYER_BASE.magnet * this.mods.magnet;
  }

  /** 난이도를 정하는 시각. 마지막 보스가 나온 뒤에는 더 어려워지지 않는다(끝없는 밤의 난이도는 late가 따로 얹는다). */
  private get clock(): number {
    return Math.min(this.state.t, RUN_SECONDS);
  }

  /** 받는 피해에 곱하는 값: 깊은 밤의 것에 끝없는 밤의 것을 곱한다. */
  private get harm(): number {
    return this.depth.damage * this.late.damage;
  }

  /** 새벽을 맞은 판인지. 마칠지 고르는 중이거나 끝없는 밤으로 이어 간 판도 그렇다. */
  get dawned(): boolean {
    const s = this.state;
    return s.over === 'cleared' || s.pendingDawn === true || s.endless !== undefined;
  }

  /** 끝없는 밤에서 버틴 시간(초). 끝없는 밤이 아니면 0 */
  get endlessSeconds(): number {
    const s = this.state;
    return s.endless ? Math.max(0, s.t - s.endless.at) : 0;
  }

  /**
   * 새벽을 맞은 판을 그 자리에서 마친다. 끝없는 밤이었으면 지금까지 버틴 것으로 끝난다.
   * 하던 판을 두고 새 판을 시작할 때 쓴다. 새벽을 맞지 않은 판에는 아무 일도 하지 않는다.
   */
  settle(): void {
    const s = this.state;
    if (s.over || !this.dawned) return;
    s.pendingDawn = false;
    s.over = 'cleared';
  }

  /**
   * 새벽에서 고른 것을 적용한다. goOn이면 끝없는 밤으로 이어 가고, 아니면 여기서 판을 마친다.
   * 고를 것이 없을 때는 아무 일도 하지 않는다.
   */
  chooseDawn(goOn: boolean): void {
    const s = this.state;
    if (!s.pendingDawn) return;
    s.pendingDawn = false;
    if (goOn) {
      // 들어서는 자리에서 밤의 축복을 하나 고른다.
      s.endless = { at: s.t, kills: s.kills, bosses: 0, surges: 0, boons: 1 };
      s.pendingBoons = 1;
    } else {
      s.over = 'cleared';
    }
  }

  /** 아직 고르지 않은 밤의 축복의 수 */
  get pendingBoons(): number {
    return Math.max(0, this.state.pendingBoons ?? 0);
  }

  /** 밤의 축복 선택지. 한 번 뽑으면 고를 때까지 같은 것이 나온다. */
  boonChoices(): Upgrade[] {
    const s = this.state;
    const fits =
      Array.isArray(s.boonOffer) &&
      s.boonOffer.length > 0 &&
      s.boonOffer.every((u) => u.type === 'boon' && u.id in BOONS && u.level === boonLevel(s.boons, u.id) + 1);
    if (!fits) s.boonOffer = boonOptions(s.boons ?? {}, this.rand);
    return s.boonOffer as Upgrade[];
  }

  /** 고른 밤의 축복을 반영한다. */
  takeBoon(upgrade: Upgrade): void {
    const s = this.state;
    if (this.pendingBoons > 0) s.pendingBoons = this.pendingBoons - 1;
    this.grant(upgrade);
  }

  /** 레벨업 선택지. 한 번 뽑으면 고르거나 다시 뽑을 때까지 같은 것이 나온다. */
  options(): Upgrade[] {
    const s = this.state;
    if (!Array.isArray(s.offer) || !this.fits(s.offer)) s.offer = this.draw();
    return s.offer;
  }

  private draw(): Upgrade[] {
    const s = this.state;
    // 끝없는 밤에서는 더 올릴 것이 없는 자리를 밤의 축복이 채운다.
    return upgradeOptions(
      { weapons: s.weapons, passives: s.passives, slots: this.slots },
      this.rand,
      3,
      s.endless ? (s.boons ?? {}) : undefined,
    );
  }

  /** 뽑아 둔 선택지가 지금 가진 것과 맞는지. 그사이에 강화권을 썼거나 저장된 값이 엉뚱하면 맞지 않는다. */
  private fits(offer: readonly Upgrade[]): boolean {
    const s = this.state;
    if (offer.length === 0) return false;
    const full = ownedWeapons(s.weapons).length >= this.slots;
    const fullPassives = ownedPassives(s.passives).length >= MAX_PASSIVES;
    return offer.every((upgrade) => {
      if (upgrade.type === 'weapon') {
        const level = s.weapons[upgrade.id] ?? 0;
        return upgrade.level === level + 1 && upgrade.level <= MAX_LEVEL && (level > 0 || !full);
      }
      if (upgrade.type === 'passive') {
        const level = s.passives[upgrade.id] ?? 0;
        return upgrade.level === level + 1 && upgrade.level <= MAX_LEVEL && (level > 0 || !fullPassives);
      }
      if (upgrade.type === 'boon') {
        return s.endless !== undefined && upgrade.id in BOONS && upgrade.level === boonLevel(s.boons, upgrade.id) + 1;
      }
      return upgrade.type === 'heal' || upgrade.type === 'embers';
    });
  }

  /** 레벨업 선택지를 다시 뽑을 수 있는 남은 횟수 */
  get rerolls(): number {
    return Math.max(0, this.state.rerolls ?? 0);
  }

  /** 다시 뽑기를 한 번 써서 레벨업 선택지를 새로 뽑는다. 남은 횟수가 없으면 null */
  reroll(): Upgrade[] | null {
    if (this.rerolls <= 0) return null;
    this.state.rerolls = this.rerolls - 1;
    this.state.offer = this.draw();
    return this.state.offer;
  }

  /** 레벨업에서 고른 강화를 반영한다. */
  applyUpgrade(upgrade: Upgrade): void {
    const s = this.state;
    if (s.pendingLevelUps > 0) s.pendingLevelUps -= 1;
    delete s.offer;
    this.grant(upgrade);
  }

  /** 무기 강화권으로 고를 수 있는 것. 끝없는 밤에서 더 올릴 무기가 없으면 밤의 축복을 고른다. */
  ticketChoices(): Upgrade[] {
    const options = ticketOptions(this.state.weapons);
    if (this.state.endless && options.every((upgrade) => upgrade.type !== 'weapon')) return this.boonChoices();
    return options;
  }

  /** 무기 강화권을 한 장 써서 고른 것을 반영한다. */
  useTicket(upgrade: Upgrade): void {
    const s = this.state;
    if (s.pendingTickets > 0) s.pendingTickets -= 1;
    this.grant(upgrade);
  }

  private grant(upgrade: Upgrade): void {
    const s = this.state;
    switch (upgrade.type) {
      case 'weapon':
        s.weapons[upgrade.id] = upgrade.level;
        break;
      case 'passive':
        s.passives[upgrade.id] = upgrade.level;
        break;
      case 'boon':
        s.boons = { ...s.boons, [upgrade.id]: boonLevel(s.boons, upgrade.id) + 1 };
        // 받은 것이 달라졌으니 뽑아 둔 축복 선택지는 버린다.
        delete s.boonOffer;
        break;
      case 'heal':
        s.player.hp += HEAL_AMOUNT;
        break;
      case 'embers':
        s.bonusEmbers += EMBER_BONUS;
        break;
    }
    this.mods = this.computeMods();
    // 외투는 늘어난 만큼 바로 채워 준다.
    if (upgrade.type === 'passive' && upgrade.id === 'coat') s.player.hp += 20;
    if (upgrade.type === 'boon' && upgrade.id === 'bulwark') s.player.hp += BOON_VALUES.bulwark;
    s.player.hp = Math.min(s.player.hp, this.mods.maxHp);
  }

  summary(): RunSummary {
    const s = this.state;
    const endlessSeconds = this.endlessSeconds;
    return {
      seconds: Math.min(s.t, RUN_SECONDS) + endlessSeconds,
      endlessSeconds,
      kills: s.kills,
      countedKills: (s.killsBeforeBoss ?? s.endless?.kills ?? s.kills) + (s.endless ? s.kills - s.endless.kills : 0),
      level: s.player.level,
      bossKills: s.bossKills,
      cleared: this.dawned,
      bonusEmbers: s.bonusEmbers,
      depth: clampDepth(s.depth),
      ...(isFeast(s.feast) ? { feast: s.feast } : {}),
    };
  }

  /**
   * dt초만큼 진행한다. moveX, moveY는 길이가 1 이하인 이동 방향.
   * 레벨업이나 강화권, 새벽의 선택을 기다리는 중이거나 판이 끝났으면 아무 일도 하지 않는다.
   */
  step(dt: number, moveX: number, moveY: number): void {
    this.events.length = 0;
    const s = this.state;
    if (s.over || s.pendingDawn || this.pendingBoons > 0 || s.pendingLevelUps > 0 || s.pendingTickets > 0) return;

    s.t += dt;
    this.late = s.endless ? endlessScale(s.t - s.endless.at) : NO_ENDLESS;
    this.movePlayer(dt, moveX, moveY);
    this.spawn(dt);
    this.buildGrid();
    this.moveEnemies(dt);
    if (s.over) return;
    this.moveHazards(dt);
    if (s.over) return;
    this.moveQuakes(dt);
    if (s.over) return;
    this.fireWeapons(dt);
    this.moveShots(dt);
    this.spreadWaves(dt);
    this.moveMoons(dt);
    this.landStrikes(dt);
    this.burnFires(dt);
    this.tendPosts(dt);
    this.flareVents(dt);
    if (s.over) return;
    this.tellGusts(dt);
    this.reap();
    this.tendSprouts(dt);
    this.moveGems(dt);
  }

  // ------------------------------------------------------------ 플레이어

  /** 세상 좌표 (x, y)가 발이 빠지는 웅덩이인지. 웅덩이가 없는 스테이지에서는 늘 아니다. */
  isMire(x: number, y: number): boolean {
    const s = this.state;
    return STAGES[s.stage].puddles && inPuddle(x, y, s.seed);
  }

  /**
   * 세상 좌표 (x, y)가 달아올랐거나 불길이 솟고 있는 불구멍 위인지. 불구멍이 없는 스테이지에서는 늘 아니다.
   * 달아오른 곳도 곧 솟으므로 함께 알려 준다.
   */
  isScorching(x: number, y: number): boolean {
    const s = this.state;
    if (!STAGES[s.stage].vents) return false;
    const vent = ventAt(x, y, s.seed);
    return vent !== null && ventPhase(vent, s.t) !== 'idle';
  }

  /** 지금의 돌풍. 돌풍이 없는 스테이지에서는 null */
  get gust(): Gust | null {
    const s = this.state;
    return STAGES[s.stage].gusts ? gustAt(s.t, s.seed) : null;
  }

  /** 돌풍이 일기 시작할 때와 세게 불기 시작할 때를 알린다. 미는 일은 플레이어와 적이 움직일 때 한다. */
  private tellGusts(dt: number): void {
    const gust = this.gust;
    if (!gust || gust.phase === 'calm' || gust.since >= dt) return;
    this.events.push({ type: 'gust', phase: gust.phase, dirX: gust.dirX, dirY: gust.dirY });
  }

  /** 불구멍: 불길이 솟는 동안 그 위의 플레이어와 그림자가 덴다. */
  private flareVents(dt: number): void {
    const s = this.state;
    if (!STAGES[s.stage].vents) return;
    const p = s.player;
    // 화면 가까이에서 막 솟기 시작한 불구멍을 알린다.
    for (const vent of ventsAround(p.x, p.y, s.viewW / 2 + 20, s.viewH / 2 + 20, s.seed)) {
      const since = ventClock(vent, s.t) - VENT.warm;
      if (since >= 0 && since < dt) this.events.push({ type: 'vent', x: vent.x, y: vent.y });
    }
    const under = ventAt(p.x, p.y, s.seed);
    if ((p.scorch ?? 0) > 0) p.scorch = (p.scorch ?? 0) - dt;
    // 한 번 솟는 동안에는 한 번만 덴다. 빛막이가 막아 줬을 때도 마찬가지다.
    if (under && this.exposed && !((p.scorch ?? 0) > 0) && ventPhase(under, s.t) === 'erupt') {
      p.scorch = VENT.erupt;
      if (this.hurt(Math.round(VENT.damage * this.harm))) return;
    }
    // 그림자는 tick마다 덴다.
    if (Math.floor(s.t / VENT.tick) === Math.floor((s.t - dt) / VENT.tick)) return;
    for (const e of s.enemies) {
      if (e.hp <= 0) continue;
      const vent = ventAt(e.x, e.y, s.seed);
      if (!vent || ventPhase(vent, s.t) !== 'erupt') continue;
      const info = ENEMIES[e.kind];
      // 끝없는 밤에서 불어난 체력은 치지 않는다. 그러지 않으면 불구멍만으로 끝없이 버틸 수 있다.
      const share = info.elite ? ELITE.vent : VENT.share;
      this.damage(e, info.boss ? VENT.boss : Math.max(VENT.floor, (e.maxHp * share) / this.late.hp), null);
    }
  }

  private movePlayer(dt: number, moveX: number, moveY: number): void {
    const p = this.state.player;
    const length = Math.hypot(moveX, moveY);
    p.moving = length > 0.05;
    p.wading = this.isMire(p.x, p.y);
    if ((p.chilled ?? 0) > 0) p.chilled = Math.max(0, (p.chilled ?? 0) - dt);
    if (p.leap) {
      // 빛버섯을 밟고 뛰는 중: 정해진 길로 날아가고, 걷는 것은 내려앉을 때까지 미룬다.
      this.flyLeap(dt);
    } else {
      // 돌풍이 부는 동안에는 가만히 있어도 바람 부는 쪽으로 밀린다.
      const gust = this.gust;
      if (gust && gust.phase === 'blow') {
        p.x += gust.dirX * GUST.player * gust.force * dt;
        p.y += gust.dirY * GUST.player * gust.force * dt;
      }
      if (p.moving) {
        const slow = (p.wading ? PUDDLE_SLOW : 1) * ((p.chilled ?? 0) > 0 ? CHILL_SLOW : 1);
        const speed = PLAYER_BASE.speed * this.mods.speed * slow;
        const scale = (speed * dt) / Math.max(1, length);
        p.x += moveX * scale;
        p.y += moveY * scale;
        if (Math.abs(moveX) > 0.15) p.face = moveX > 0 ? 1 : -1;
      }
      this.bounce(p.moving ? moveX : 0, p.moving ? moveY : 0);
    }
    if (p.inv > 0) p.inv -= dt;
    if (this.mods.regen > 0) p.hp = Math.min(this.mods.maxHp, p.hp + this.mods.regen * dt);
    if (this.mods.guard > 0 && (p.guard ?? 0) > 0) p.guard = Math.max(0, (p.guard ?? 0) - dt);
  }

  /** 등갓의 빛막이 지금 서 있는지 */
  get guardReady(): boolean {
    return this.mods.guard > 0 && !((this.state.player.guard ?? 0) > 0);
  }

  /** 지금 다칠 수 있는지: 맞은 뒤의 무적 시간이 아니고, 빛버섯을 밟고 공중에 떠 있지도 않다. */
  private get exposed(): boolean {
    const p = this.state.player;
    return p.inv <= 0 && !p.leap;
  }

  /** key의 빛버섯이 부풀어 있어서 밟으면 뛸 수 있는지 */
  shroomReady(key: string): boolean {
    const until = this.state.squashed?.[key];
    return until === undefined || until <= this.state.t;
  }

  /** key의 빛버섯을 납작하게 한다. 다시 부푼 버섯은 지워서 판에 저장되는 것이 쌓이지 않게 한다. */
  private squash(key: string): void {
    const s = this.state;
    const squashed = (s.squashed ??= {});
    for (const other of Object.keys(squashed)) if (squashed[other] <= s.t) delete squashed[other];
    squashed[key] = s.t + LEAP.rest;
  }

  /**
   * 부푼 빛버섯 위에 있으면 뛰어오른다. (dirX, dirY) 쪽으로 뛰고,
   * 그 쪽이 없으면(서 있었으면) 버섯 가운데에서 먼 쪽으로 뛴다.
   */
  private bounce(dirX: number, dirY: number): void {
    const s = this.state;
    if (!STAGES[s.stage].shrooms) return;
    const p = s.player;
    const shroom = shroomAt(p.x, p.y, s.seed);
    if (!shroom || !this.shroomReady(shroom.key)) return;
    let length = Math.hypot(dirX, dirY);
    if (length < 0.05) {
      dirX = p.x - shroom.x;
      dirY = p.y - shroom.y;
      length = Math.hypot(dirX, dirY);
      if (length < 0.01) {
        dirX = p.face;
        dirY = 0;
        length = 1;
      }
    }
    this.squash(shroom.key);
    const reach = LEAP.distance / length;
    p.leap = { x0: p.x, y0: p.y, x1: p.x + dirX * reach, y1: p.y + dirY * reach, t: 0 };
    if (Math.abs(dirX / length) > 0.15) p.face = dirX > 0 ? 1 : -1;
    this.events.push({ type: 'leap', x: p.x, y: p.y });
  }

  /** 뛰는 중인 플레이어를 날린다. 내려앉으면 둘레의 그림자를 밀쳐 내고, 또 빛버섯 위면 같은 쪽으로 다시 뛴다. */
  private flyLeap(dt: number): void {
    const s = this.state;
    const p = s.player;
    const leap = p.leap;
    if (!leap) return;
    leap.t += dt;
    // 걸음을 더해 가며 생기는 아주 작은 오차로 한 걸음 늦게 내려앉지 않게 한다.
    const progress = Math.min(1, (leap.t + 1e-6) / LEAP.seconds);
    // 처음에는 빠르게 솟고 내려앉을 때 느려진다.
    const eased = 1 - (1 - progress) * (1 - progress);
    p.x = leap.x0 + (leap.x1 - leap.x0) * eased;
    p.y = leap.y0 + (leap.y1 - leap.y0) * eased;
    p.moving = true;
    if (progress < 1) return;
    delete p.leap;
    this.events.push({ type: 'land', x: p.x, y: p.y });
    for (const e of s.enemies) {
      const info = ENEMIES[e.kind];
      // 보스와 공중에 뜬 정예는 밀리지 않는다.
      if (e.hp <= 0 || info.boss || (info.springs && e.mode === 1)) continue;
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      const reach = LEAP.landRadius + info.radius;
      const d2 = dx * dx + dy * dy;
      if (d2 >= reach * reach) continue;
      const d = Math.sqrt(d2) || 1;
      e.kx = (e.kx ?? 0) + (dx / d) * LEAP.landPush;
      e.ky = (e.ky ?? 0) + (dy / d) * LEAP.landPush;
    }
    this.bounce(leap.x1 - leap.x0, leap.y1 - leap.y0);
  }

  /** 빛막이 다시 생기기까지 얼마나 찼는지(0~1). 서 있으면 1, 등갓이 없으면 0 */
  get guardCharge(): number {
    if (this.mods.guard <= 0) return 0;
    return 1 - Math.min(1, Math.max(0, this.state.player.guard ?? 0) / this.mods.guard);
  }

  /**
   * 플레이어가 다친다. 체력이 다하면 되살림 등불이 남아 있을 때는 다시 일어나고, 없으면 판이 끝난다.
   * 판이 끝났으면 true.
   */
  private hurt(amount: number): boolean {
    const s = this.state;
    const p = s.player;
    // 마지막 보스가 쓰러진 바로 그 순간에는 더 다치지 않는다. 새벽이 먼저다.
    if (s.pendingDawn) return false;
    // 등갓의 빛막이 서 있으면 이번 피해는 막고, 빛막은 다시 생길 때까지 사라진다.
    if (this.guardReady) {
      p.guard = this.mods.guard;
      p.inv = GUARD_INVULNERABLE;
      this.events.push({ type: 'block' });
      return false;
    }
    p.hp -= amount * this.mods.taken;
    p.inv = PLAYER_BASE.invulnerable;
    this.events.push({ type: 'hurt' });
    if (p.hp > 0) return false;
    if (s.revives > 0) {
      s.revives -= 1;
      p.hp = Math.round(this.mods.maxHp * REVIVE.hp);
      p.inv = REVIVE.invulnerable;
      // 일어나면서 둘레의 적을 밀쳐 내 숨 돌릴 틈을 만든다.
      for (const e of s.enemies) {
        if (e.hp <= 0) continue;
        const reach = REVIVE.radius + ENEMIES[e.kind].radius;
        if ((e.x - p.x) ** 2 + (e.y - p.y) ** 2 < reach * reach) this.damage(e, REVIVE.damage, null);
      }
      s.hazards.length = 0;
      if (s.quakes) s.quakes.length = 0;
      this.events.push({ type: 'revive' });
      return false;
    }
    p.hp = 0;
    s.over = 'dead';
    return true;
  }

  // ------------------------------------------------------------ 적 등장

  private makeEnemy(kind: EnemyKind, x: number, y: number): Enemy {
    const s = this.state;
    const hp = Math.round(
      enemyHp(kind, this.clock) * (ENEMIES[kind].boss ? this.depth.bossHp : this.depth.hp) * this.late.hp,
    );
    const enemy: Enemy = {
      uid: s.nextUid,
      kind,
      x,
      y,
      hp,
      maxHp: hp,
      flash: 0,
      slow: 0,
      slowTo: 1,
      fireflyCd: 0,
      // 보스는 나타나고 조금 뒤에 첫 행동을 한다. 뛰는 적은 저마다 다른 박자로 뛴다.
      // 쏘는 적은 다가온 뒤에 조금 있다가 쏘되, 여럿이 한꺼번에 쏘지 않게 번호에 따라 어긋나게 한다.
      timer: ENEMIES[kind].boss
        ? kind === 'giant'
          ? 5
          : 3
        : ENEMIES[kind].hops
          ? this.rand() * HOP_REST
          : ENEMIES[kind].shoots
            ? 1 + (s.nextUid % 5) * 0.35
            : ENEMIES[kind].springs
              ? GLIDE.rest / 2
              : 0,
      mode: 0,
      tier: 0,
      vx: 0,
      vy: 0,
    };
    s.nextUid += 1;
    this.note(kind);
    s.enemies.push(enemy);
    return enemy;
  }

  /** 화면 바로 밖, 플레이어를 둘러싼 네모 테두리 위의 한 점 */
  private edgePoint(): [number, number] {
    const s = this.state;
    const halfW = s.viewW / 2 + SPAWN_MARGIN;
    const halfH = s.viewH / 2 + SPAWN_MARGIN;
    const along = this.rand() * 2 - 1;
    const horizontal = this.rand() * (halfW + halfH) < halfW;
    const sign = this.rand() < 0.5 ? -1 : 1;
    return horizontal
      ? [s.player.x + along * halfW, s.player.y + sign * halfH]
      : [s.player.x + sign * halfW, s.player.y + along * halfH];
  }

  private spawn(dt: number): void {
    const s = this.state;
    const t = this.clock;

    s.spawnDebt += spawnPerSecond(t) * this.depth.spawn * dt;
    const limit = maxAlive(t);
    while (s.spawnDebt >= 1) {
      if (s.enemies.length >= limit) {
        s.spawnDebt = Math.min(s.spawnDebt, 1);
        break;
      }
      s.spawnDebt -= 1;
      const [x, y] = this.edgePoint();
      const kind = pickSpawnKind(t, this.rand, s.stage);
      this.makeEnemy(this.crowded(kind) ? STAGES[s.stage].spawns[0].kind : kind, x, y);
    }

    // 밀물: 화면 가장자리를 따라 둥글게 에워싼다.
    if (s.surgeIndex < SURGES.length && s.t >= SURGES[s.surgeIndex]) {
      s.surgeIndex += 1;
      this.surge(STAGES[s.stage].surge[s.surgeIndex >= 3 ? 1 : 0], 18 + 6 * s.surgeIndex);
    }

    if (s.endless) {
      // 끝없는 밤: 밀물과 보스가 정해진 간격으로 끝없이 온다. 체력은 그때의 난이도(late)를 따른다.
      const since = s.t - s.endless.at;
      // 그림자가 세지는 간격마다 밤의 축복을 하나씩 받는다. 들어설 때 받은 것까지 센다.
      if ((s.endless.boons ?? 0) < Math.floor(since / ENDLESS.boonEvery) + 1) {
        s.endless.boons = (s.endless.boons ?? 0) + 1;
        s.pendingBoons = this.pendingBoons + 1;
        this.events.push({ type: 'boon' });
      }
      if (since >= (s.endless.surges + 0.5) * ENDLESS.surgeEvery) {
        s.endless.surges += 1;
        this.surge(STAGES[s.stage].surge[1], ENDLESS.surgeCount);
      }
      if (since >= (s.endless.bosses + 1) * ENDLESS.bossEvery) {
        const boss = this.spawnBoss(endlessBossKind(s.stage, s.endless.bosses));
        boss.tier = MID_BOSS_COUNT - 1;
        boss.hp = Math.round(midBossTier(boss.tier).hp * this.depth.bossHp * this.late.hp);
        boss.maxHp = boss.hp;
        s.endless.bosses += 1;
      }
    }

    // 정예 그림자: 정해진 시각마다 하나씩 가장자리에서 걸어온다. 끝없는 밤에는 나오지 않는다.
    const elites = s.elites ?? 0;
    if (!s.endless && elites < ELITE.times.length && s.t >= ELITE.times[elites]) {
      s.elites = elites + 1;
      const [x, y] = this.edgePoint();
      const kind = STAGES[s.stage].elite;
      const elite = this.makeEnemy(kind, x, y);
      // 잔치의 밤에서는 몇몇 정예가 무기 강화권도 지니고 온다.
      if (isFeast(s.feast) && FEAST.ticketElites.includes(elites)) elite.ticket = true;
      this.events.push({ type: 'elite', kind });
    }

    // 중간 보스: 정해진 간격마다 하나씩, 나올 때마다 더 강하게
    if (s.midBosses < MID_BOSS_COUNT && s.t >= (s.midBosses + 1) * MID_BOSS_EVERY) {
      const boss = this.spawnBoss(midBossKind(s.stage, s.midBosses));
      boss.tier = s.midBosses;
      boss.hp = Math.round(midBossTier(boss.tier).hp * this.depth.bossHp);
      boss.maxHp = boss.hp;
      s.midBosses += 1;
    }
    if (!s.finalBoss && s.t >= RUN_SECONDS) {
      s.finalBoss = true;
      // 이 뒤의 처치는 점수와 불씨에 세지 않는다. 보스를 남겨 두고 버텨도 얻는 것이 없다.
      s.killsBeforeBoss = s.kills;
      // 마지막 보스는 가장 센 중간 보스와 같은 단계로 부하를 부른다.
      this.spawnBoss(STAGES[s.stage].finalBoss).tier = MID_BOSS_COUNT - 1;
    }
  }

  /** 밀물: kind count마리가 화면 가장자리를 따라 둥글게 에워싼다. */
  private surge(kind: EnemyKind, count: number): void {
    const s = this.state;
    const rx = s.viewW / 2 + SPAWN_MARGIN;
    const ry = s.viewH / 2 + SPAWN_MARGIN;
    const offset = this.rand() * Math.PI * 2;
    for (let i = 0; i < count; i += 1) {
      const angle = offset + (i / count) * Math.PI * 2;
      this.makeEnemy(kind, s.player.x + Math.cos(angle) * rx, s.player.y + Math.sin(angle) * ry);
    }
    this.events.push({ type: 'surge' });
  }

  /** 쏘는 적이 싸움터에 이미 정해진 수만큼 있는지. 그렇다면 더 내보내지 않는다. */
  private crowded(kind: EnemyKind): boolean {
    const limit = ENEMIES[kind].shoots?.limit;
    if (limit === undefined) return false;
    let alive = 0;
    for (const e of this.state.enemies) {
      if (e.hp > 0 && e.kind === kind) alive += 1;
    }
    return alive >= limit;
  }

  private spawnBoss(kind: EnemyKind): Enemy {
    const s = this.state;
    // 보스는 위쪽에서 내려온다.
    const boss = this.makeEnemy(kind, s.player.x, s.player.y - s.viewH / 2 - 24);
    this.events.push({ type: 'boss', kind });
    return boss;
  }

  // ------------------------------------------------------------ 격자

  private bucket(x: number, y: number): number {
    return (Math.floor(x / CELL) & 63) | ((Math.floor(y / CELL) & 63) << 6);
  }

  private buildGrid(): void {
    const enemies = this.state.enemies;
    if (this.next.length < enemies.length) {
      this.next = new Int32Array(Math.max(enemies.length, this.next.length * 2));
    }
    this.heads.fill(-1);
    for (let i = 0; i < enemies.length; i += 1) {
      const b = this.bucket(enemies[i].x, enemies[i].y);
      this.next[i] = this.heads[b];
      this.heads[b] = i;
    }
  }

  // ------------------------------------------------------------ 적 이동

  private moveEnemies(dt: number): void {
    const s = this.state;
    const p = s.player;
    const enemies = s.enemies;
    // buildGrid 뒤에 생긴 적은 격자에 없으므로 그때의 수까지만 이웃으로 본다.
    const gridCount = enemies.length;
    const recycle = Math.max(s.viewW, s.viewH) * 0.5 + 90;
    const fast = speedScale(this.clock) * this.depth.speed * this.late.speed;
    const hard = damageScale(this.clock) * this.harm;
    // 돌풍: 보통 그림자는 플레이어보다 세게 밀린다. 크고 무거운 것은 덜 밀리고 보스는 밀리지 않는다.
    const gust = this.gust;
    const wind = gust && gust.phase === 'blow' ? GUST.enemy * gust.force * dt : 0;
    const windX = gust ? gust.dirX * wind : 0;
    const windY = gust ? gust.dirY * wind : 0;

    for (let i = 0; i < gridCount; i += 1) {
      const e = enemies[i];
      if (e.hp <= 0) continue;
      const info = ENEMIES[e.kind];
      if (e.flash > 0) e.flash -= dt;
      if (e.slow > 0) e.slow -= dt;
      if (e.fireflyCd > 0) e.fireflyCd -= dt;
      if (e.beamCd && e.beamCd > 0) e.beamCd -= dt;
      // 종소리에 밀려나는 중이면 남은 거리를 조금씩 물러난다.
      if (e.kx || e.ky) {
        const kx = e.kx ?? 0;
        const ky = e.ky ?? 0;
        const left = Math.hypot(kx, ky);
        const move = Math.min(left, PUSH_SPEED * dt);
        e.x += (kx / left) * move;
        e.y += (ky / left) * move;
        const rest = left - move < 0.01 ? 0 : (left - move) / left;
        e.kx = kx * rest;
        e.ky = ky * rest;
      }

      if (wind > 0 && !info.boss) {
        const share = info.radius >= GUST.heavyRadius ? GUST.heavy : 1;
        e.x += windX * share;
        e.y += windY * share;
      }

      let dx = p.x - e.x;
      let dy = p.y - e.y;
      let distance = Math.hypot(dx, dy) || 0.001;

      // 너무 멀어진 적은 화면 가장자리로 다시 데려온다.
      if (!info.boss && distance > recycle) {
        [e.x, e.y] = this.edgePoint();
        dx = p.x - e.x;
        dy = p.y - e.y;
        distance = Math.hypot(dx, dy) || 0.001;
      }

      let speed = info.speed * (info.boss ? 1 : fast) * (e.slow > 0 ? e.slowTo : 1);
      let dirX = dx / distance;
      let dirY = dy / distance;

      if (info.boss) {
        // 보스가 화면 밖으로 멀리 떨어지면 서둘러 따라온다.
        if (distance > recycle) speed *= 4;
        e.timer -= dt;
        const brain = info.brain ?? 'summon';
        if (brain === 'summon') {
          if (e.timer <= 0) {
            e.timer = 7;
            this.summon(e, minionKind(s.stage, e.tier), midBossTier(e.tier).summon, 26);
          }
        } else if (brain === 'volley') {
          // 쏘기 전에 멈춰서 빛을 모은다(2). 그 틈에 비켜설 채비를 할 수 있다.
          if (e.mode === CHARGING) {
            speed = 0;
            if (e.timer <= 0) {
              e.mode = 0;
              e.timer = 2.9 - 0.2 * e.tier - CHARGE_SECONDS;
              // 플레이어 쪽으로 부채꼴로 쏜다. 뒤에 나오는 것일수록 갈래가 많다.
              this.volley(e, Math.atan2(dy, dx), e.tier >= 2 ? 5 : 3, HAZARD.spread, 9 + 2 * e.tier);
            }
          } else if (e.timer <= 0) {
            e.mode = CHARGING;
            e.timer = CHARGE_SECONDS;
            this.events.push({ type: 'charge' });
          }
        } else if (brain === 'matron') {
          // 사방으로 쏘기와 부하 부르기를 번갈아 한다. 쏘기 전에는 빛을 모은다(2).
          if (e.mode === CHARGING) {
            speed = 0;
            if (e.timer <= 0) {
              e.mode = 1;
              e.timer = 3.4;
              this.volley(e, this.rand() * Math.PI * 2, 12, (Math.PI * 2) / 12, 14);
            }
          } else if (e.timer <= 0) {
            if (e.mode === 0) {
              e.mode = CHARGING;
              e.timer = CHARGE_SECONDS;
              this.events.push({ type: 'charge' });
            } else {
              e.mode = 0;
              e.timer = 3.4 - CHARGE_SECONDS;
              this.summon(e, minionKind(s.stage, e.tier), 5, 30);
            }
          }
        } else if (brain === 'blizzard') {
          // 눈보라의 눈: 빛을 모았다가(2) 사방으로 여러 겹을 엇갈려 쏘고, 쫓다가 부하를 부른다.
          // 쏘는 동안 vx는 남은 겹의 수, vy는 다음 겹이 향하는 각도다.
          if (e.mode === CHARGING) {
            speed = 0;
            if (e.timer <= 0) {
              e.mode = BLIZZARD_FIRING;
              e.vx = BLIZZARD.rings;
              e.vy = this.rand() * Math.PI * 2;
            }
          } else if (e.mode === BLIZZARD_FIRING) {
            speed = 0;
            if (e.timer <= 0) {
              const gap = (Math.PI * 2) / BLIZZARD.count;
              this.volley(e, e.vy, BLIZZARD.count, gap, BLIZZARD.damage);
              e.vy += gap / 2;
              e.vx -= 1;
              if (e.vx > 0) e.timer = BLIZZARD.gap;
              else {
                e.mode = 1;
                e.timer = 3.2;
              }
            }
          } else if (e.timer <= 0) {
            if (e.mode === 0) {
              e.mode = CHARGING;
              e.timer = CHARGE_SECONDS;
              this.events.push({ type: 'charge' });
            } else {
              e.mode = 0;
              e.timer = 3.2 - CHARGE_SECONDS;
              this.summon(e, minionKind(s.stage, e.tier), 5, 30);
            }
          }
        } else if (brain === 'elder') {
          // 숲의 고목: 쫓다가(0) 멈춰서 힘을 모으고(CHARGING) 땅을 굴러 고리를 퍼뜨린다. 그다음 쫓다가(1) 부하를 부른다.
          if (e.mode === CHARGING) {
            speed = 0;
            if (e.timer <= 0) {
              e.mode = 1;
              e.timer = QUAKE.rest;
              this.quake(e);
            }
          } else if (e.timer <= 0) {
            if (e.mode === 0) {
              e.mode = CHARGING;
              e.timer = QUAKE.windup;
              this.events.push({ type: 'charge' });
            } else {
              e.mode = 0;
              e.timer = QUAKE.rest - QUAKE.windup;
              this.summon(e, minionKind(s.stage, e.tier), 5, 30);
            }
          }
        } else if (brain === 'warden' && e.mode >= WARDEN_REST) {
          // 고개의 문지기: 내달린 다음에는 숨을 고르고(3) 빛을 모아(4) 부채꼴로 쏜다.
          if (e.mode === WARDEN_CHARGING) {
            speed = 0;
            if (e.timer <= 0) {
              e.mode = 0;
              e.timer = 2.4;
              this.volley(e, Math.atan2(dy, dx), 7, HAZARD.spread, 13);
            }
          } else if (e.timer <= 0) {
            e.mode = WARDEN_CHARGING;
            e.timer = CHARGE_SECONDS;
            this.events.push({ type: 'charge' });
          }
        } else if (e.mode === 0) {
          // 돌진하는 보스: 쫓다가(0) 멈춰서 힘을 모으고(1) 겨눈 쪽으로 내달린다(2).
          if (e.timer <= 0) {
            e.mode = 1;
            e.timer = dashOf(e.kind, e.tier).windup;
            e.vx = dirX;
            e.vy = dirY;
            this.events.push({ type: 'windup' });
          }
        } else if (e.mode === 1) {
          speed = 0;
          e.flash = 0.05;
          // 겨누는 쪽은 플레이어를 따라오다가 끝자락에 굳는다. 그 뒤에 옆으로 비키면 피할 수 있다.
          if (e.timer > AIM_LOCK_SECONDS) {
            e.vx = dirX;
            e.vy = dirY;
          }
          if (e.timer <= 0) {
            e.mode = 2;
            e.timer = dashOf(e.kind, e.tier).seconds;
            this.events.push({ type: 'dash' });
          }
        } else {
          speed = dashOf(e.kind, e.tier).speed;
          dirX = e.vx;
          dirY = e.vy;
          if (e.timer <= 0) {
            e.mode = 0;
            if (brain === 'lord') {
              e.timer = 4.2;
              this.summon(e, minionKind(s.stage, e.tier), 6, 30);
            } else if (brain === 'warden') {
              e.mode = WARDEN_REST;
              e.timer = 1.5;
            } else {
              e.timer = 3.2 - 0.3 * e.tier;
            }
          }
        }
      } else if (info.hops) {
        // 웅크렸다가(0) 그때 본 쪽으로 한 번에 뛴다(1).
        e.timer -= dt;
        if (e.mode === 0) {
          speed = 0;
          if (e.timer <= 0) {
            e.mode = 1;
            e.timer = HOP_SECONDS;
            e.vx = dirX;
            e.vy = dirY;
          }
        } else {
          dirX = e.vx;
          dirY = e.vy;
          if (e.timer <= 0) {
            e.mode = 0;
            e.timer = HOP_REST;
          }
        }
      } else if (info.shoots) {
        // 닿는 거리까지만 다가와서(0) 멈춰 숨을 들이쉬고(1), 그때 플레이어가 있는 쪽으로 어둠 방울을 뱉는다.
        const shot = info.shoots;
        if (e.mode === 1) {
          speed = 0;
          e.timer -= dt;
          if (e.timer <= 0) {
            e.mode = 0;
            e.timer = shot.every;
            s.hazards.push({
              x: e.x,
              y: e.y,
              vx: dirX * SPIT.speed,
              vy: dirY * SPIT.speed,
              life: SPIT.life,
              radius: SPIT.radius,
              // 예고가 있는 공격은 보스의 것처럼 시간이 지나도 세지지 않고, 깊은 밤의 단계만 따른다.
              damage: Math.round(shot.damage * this.harm),
            });
            this.events.push({ type: 'spit' });
          }
        } else {
          if (e.timer > 0) e.timer -= dt;
          if (distance < shot.range) {
            speed = 0;
            if (e.timer <= 0 && s.hazards.length < SPIT_LIMIT) {
              e.mode = 1;
              e.timer = shot.windup;
            }
          }
        }
      } else if (info.bursts) {
        // 가까이 오면(0) 멈춰서 부풀다가(1) 터진다. 부푸는 동안 쓰러뜨리거나 둘레 밖으로 나가면 다치지 않는다.
        const burst = info.bursts;
        if (e.mode === 1) {
          speed = 0;
          e.timer -= dt;
          if (e.timer <= 0) {
            if (this.burst(e, burst)) return;
            continue;
          }
        } else if (distance < burst.trigger) {
          e.mode = 1;
          e.timer = burst.fuse;
          this.events.push({ type: 'swell' });
        }
      } else if (info.springs) {
        // 빛버섯을 디디면 뛸 때 플레이어가 있던 쪽으로 높이 뛰어 덮친다(1). 뛰는 동안 vx, vy는 날아가는 빠르기다.
        if (e.timer > 0) e.timer -= dt;
        if (e.mode === 1) {
          e.x += e.vx * dt;
          e.y += e.vy * dt;
          if (e.timer <= 0) {
            e.mode = 0;
            e.timer = GLIDE.rest;
            if (this.thud(e)) return;
          }
          // 공중에서는 다른 그림자와 밀치지 않고 플레이어에 닿지도 않는다.
          continue;
        }
        if (e.timer <= 0 && STAGES[s.stage].shrooms) {
          const shroom = shroomAt(e.x, e.y, s.seed);
          if (shroom && this.shroomReady(shroom.key)) {
            this.squash(shroom.key);
            const reach = Math.min(distance, GLIDE.reach);
            e.mode = 1;
            e.timer = GLIDE.seconds;
            e.vx = (dirX * reach) / GLIDE.seconds;
            e.vy = (dirY * reach) / GLIDE.seconds;
            this.events.push({ type: 'pounce' });
            continue;
          }
        }
      }

      e.x += dirX * speed * dt;
      e.y += dirY * speed * dt;

      // 서로 겹치지 않게 조금씩 밀어낸다. 보스는 밀리지 않는다.
      if (!info.boss) {
        const cx = Math.floor(e.x / CELL);
        const cy = Math.floor(e.y / CELL);
        for (let oy = -1; oy <= 1; oy += 1) {
          for (let ox = -1; ox <= 1; ox += 1) {
            let j = this.heads[((cx + ox) & 63) | (((cy + oy) & 63) << 6)];
            while (j !== -1) {
              const other = enemies[j];
              if (j !== i && other.hp > 0) {
                const sx = e.x - other.x;
                const sy = e.y - other.y;
                const gap = (info.radius + ENEMIES[other.kind].radius) * 0.85;
                const d2 = sx * sx + sy * sy;
                if (d2 < gap * gap && d2 > 0.0001) {
                  const d = Math.sqrt(d2);
                  const push = ((gap - d) / d) * 0.35;
                  e.x += sx * push;
                  e.y += sy * push;
                }
              }
              j = this.next[j];
            }
          }
        }
      }

      // 플레이어에 닿으면 피해를 준다.
      const reach = info.radius + PLAYER_BASE.radius;
      const px = p.x - e.x;
      const py = p.y - e.y;
      if (this.exposed && px * px + py * py < reach * reach) {
        const guarded = this.guardReady;
        if (this.hurt(Math.round(info.damage * (info.boss ? this.harm : hard)))) return;
        // 서릿발: 닿으면 발이 얼어 잠깐 느려진다. 빛막이 막아 줬으면 얼지 않는다.
        if (info.chills && !guarded && !s.pendingDawn) {
          p.chilled = Math.max(p.chilled ?? 0, info.chills);
          this.events.push({ type: 'chill' });
        }
      }
    }
  }

  /**
   * 부풀던 적이 터진다. 둘레 안의 플레이어가 다치고, 둘레 안의 다른 그림자도 함께 다친다.
   * 터진 적은 여느 적처럼 쓰러진 것으로 친다. 판이 끝났으면 true.
   * 피해는 쏘는 적의 방울처럼 시간이 지나도 세지지 않고, 깊은 밤의 단계만 따른다.
   */
  private burst(source: Enemy, burst: BurstInfo): boolean {
    const s = this.state;
    const p = s.player;
    source.hp = 0;
    this.events.push({ type: 'burst', x: source.x, y: source.y, radius: burst.radius });
    for (const other of s.enemies) {
      if (other === source || other.hp <= 0) continue;
      const reach = burst.radius + ENEMIES[other.kind].radius;
      if ((other.x - source.x) ** 2 + (other.y - source.y) ** 2 < reach * reach) this.damage(other, burst.splash, null);
    }
    const reach = burst.radius + PLAYER_BASE.radius;
    if (this.exposed && (p.x - source.x) ** 2 + (p.y - source.y) ** 2 < reach * reach) {
      return this.hurt(Math.round(burst.damage * this.harm));
    }
    return false;
  }

  /** 보스가 angle 쪽을 가운데로 count갈래의 빛덩이를 쏜다. gap은 갈래 사이의 각도. */
  private volley(source: Enemy, angle: number, count: number, gap: number, damage: number): void {
    const hazards = this.state.hazards;
    const first = angle - (gap * (count - 1)) / 2;
    for (let i = 0; i < count; i += 1) {
      const a = first + gap * i;
      hazards.push({
        x: source.x,
        y: source.y,
        vx: Math.cos(a) * HAZARD.speed,
        vy: Math.sin(a) * HAZARD.speed,
        life: HAZARD.life,
        radius: HAZARD.radius,
        damage: Math.round(damage * this.harm),
      });
    }
    this.events.push({ type: 'volley' });
  }

  private moveHazards(dt: number): void {
    const s = this.state;
    const p = s.player;
    let kept = 0;
    for (const hazard of s.hazards) {
      hazard.life -= dt;
      if (hazard.life <= 0) continue;
      hazard.x += hazard.vx * dt;
      hazard.y += hazard.vy * dt;
      const reach = hazard.radius + PLAYER_BASE.radius;
      if (this.exposed && (hazard.x - p.x) ** 2 + (hazard.y - p.y) ** 2 < reach * reach) {
        if (this.hurt(hazard.damage)) return;
        // 되살아나면 hurt가 빛덩이를 모두 치운다.
        if (s.hazards.length === 0) return;
        continue;
      }
      s.hazards[kept] = hazard;
      kept += 1;
    }
    s.hazards.length = kept;
  }

  /** 뛰어오른 정예가 내려앉는다. 둘레 안의 플레이어가 다친다. 판이 끝났으면 true */
  private thud(e: Enemy): boolean {
    const p = this.state.player;
    this.events.push({ type: 'thud', x: e.x, y: e.y, radius: GLIDE.radius });
    const reach = GLIDE.radius + PLAYER_BASE.radius;
    if (!this.exposed || (p.x - e.x) ** 2 + (p.y - e.y) ** 2 >= reach * reach) return false;
    return this.hurt(Math.round(GLIDE.damage * this.harm));
  }

  /** 숲의 고목이 땅을 굴러 틈이 난 고리를 퍼뜨린다. 체력이 많이 줄었으면 틈이 어긋난 두 번째 겹이 뒤따른다. */
  private quake(source: Enemy): void {
    const quakes = (this.state.quakes ??= []);
    const gap = this.rand() * Math.PI * 2;
    const damage = Math.round(QUAKE.damage * this.harm);
    const r = ENEMIES[source.kind].radius;
    quakes.push({ x: source.x, y: source.y, r, gap, damage, delay: 0 });
    if (source.hp < source.maxHp * QUAKE.rage) {
      quakes.push({ x: source.x, y: source.y, r, gap: gap + Math.PI / QUAKE.gaps, damage, delay: QUAKE.echo });
    }
    this.events.push({ type: 'quake', x: source.x, y: source.y });
  }

  /** 땅울림 고리를 넓힌다. 고리가 지나갈 때 틈에 있지 않고 땅에 서 있던 플레이어는 다친다. */
  private moveQuakes(dt: number): void {
    const s = this.state;
    const quakes = s.quakes;
    if (!quakes || quakes.length === 0) return;
    const p = s.player;
    let kept = 0;
    for (const quake of quakes) {
      if (quake.delay > 0) {
        quake.delay -= dt;
        if (quake.delay <= 0) this.events.push({ type: 'quake', x: quake.x, y: quake.y });
        quakes[kept] = quake;
        kept += 1;
        continue;
      }
      const before = quake.r;
      quake.r += QUAKE.speed * dt;
      if (quake.r - QUAKE.band > QUAKE.reach) continue;
      if (!quake.hit && this.exposed && quakeCrosses(quake, before, p.x, p.y, PLAYER_BASE.radius)) {
        quake.hit = true;
        if (this.hurt(quake.damage)) return;
        // 되살아나면 hurt가 고리를 모두 치운다.
        if (quakes.length === 0) return;
      }
      quakes[kept] = quake;
      kept += 1;
    }
    quakes.length = kept;
  }

  /** 쓰러진 자리에 싹을 남긴다. 싹이 너무 많으면 가장 오래된 것이 시든다. */
  private plant(x: number, y: number, seconds: number): void {
    const sprouts = (this.state.sprouts ??= []);
    if (sprouts.length >= SPROUT.limit) sprouts.shift();
    sprouts.push({ x, y, t: seconds });
    this.events.push({ type: 'plant' });
  }

  /** 싹: 플레이어가 밟으면 사라지고, 다 자라면 그 스테이지의 가장 흔한 그림자가 된다. */
  private tendSprouts(dt: number): void {
    const s = this.state;
    const sprouts = s.sprouts;
    if (!sprouts || sprouts.length === 0) return;
    const p = s.player;
    const reach = PLAYER_BASE.radius + SPROUT.reach;
    const limit = maxAlive(this.clock);
    const kind = STAGES[s.stage].spawns[0].kind;
    let kept = 0;
    for (const sprout of sprouts) {
      // 공중에 떠 있을 때는 밟지 못한다.
      if (!p.leap && (sprout.x - p.x) ** 2 + (sprout.y - p.y) ** 2 < reach * reach) {
        this.events.push({ type: 'stomp', x: sprout.x, y: sprout.y });
        continue;
      }
      sprout.t -= dt;
      // 다 자랐어도 싸움터가 붐비면 자리가 날 때까지 기다린다.
      if (sprout.t <= 0 && s.enemies.length < limit) {
        this.makeEnemy(kind, sprout.x, sprout.y);
        this.events.push({ type: 'sprout', x: sprout.x, y: sprout.y });
        continue;
      }
      sprouts[kept] = sprout;
      kept += 1;
    }
    sprouts.length = kept;
  }

  private summon(source: Enemy, kind: EnemyKind, count: number, radius: number): void {
    const offset = this.rand() * Math.PI * 2;
    for (let i = 0; i < count; i += 1) {
      const angle = offset + (i / count) * Math.PI * 2;
      this.makeEnemy(kind, source.x + Math.cos(angle) * radius, source.y + Math.sin(angle) * radius);
    }
  }

  // ------------------------------------------------------------ 무기

  /**
   * 적에게 피해를 준다. by는 그 피해를 준 무기로, 무기별 피해량(state.dealt)에 쌓인다.
   * 남은 체력보다 많이 준 피해는 세지 않아서, 약한 적을 한 방에 잡는 무기가 부풀려지지 않는다.
   */
  private damage(enemy: Enemy, amount: number, by: WeaponId | null, flash = 0.09): void {
    if (by) {
      const dealt = (this.state.dealt ??= {});
      dealt[by] = (dealt[by] ?? 0) + Math.min(amount, Math.max(0, enemy.hp));
    }
    enemy.hp -= amount;
    enemy.flash = flash;
  }

  /** 잠깐 느리게 한다. 이미 더 느려져 있으면 그 배율을 지킨다. */
  private chill(enemy: Enemy, factor: number): void {
    if (factor >= 1) return;
    enemy.slowTo = enemy.slow > 0 ? Math.min(enemy.slowTo, factor) : factor;
    enemy.slow = 0.7;
  }

  private fireWeapons(dt: number): void {
    const s = this.state;
    const p = s.player;
    const enemies = s.enemies;
    const w = s.weapons;

    if (w.ember) {
      s.cd.ember -= dt;
      if (s.cd.ember <= 0) {
        let target: Enemy | null = null;
        let best = EMBER_RANGE * EMBER_RANGE;
        for (const e of enemies) {
          if (e.hp <= 0) continue;
          const d2 = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
          if (d2 < best) {
            best = d2;
            target = e;
          }
        }
        if (target) {
          const stats = emberStats(w.ember, this.mods);
          const base = Math.atan2(target.y - p.y, target.x - p.x);
          const look: ShotLook = isEvolved(w.ember) ? 'emberEvo' : 'ember';
          for (let i = 0; i < stats.count; i += 1) {
            const angle = base + (i - (stats.count - 1) / 2) * 0.22;
            s.shots.push({
              x: p.x,
              y: p.y,
              vx: Math.cos(angle) * stats.speed,
              vy: Math.sin(angle) * stats.speed,
              damage: stats.damage,
              pierce: stats.pierce,
              life: 1,
              radius: EMBER_RADIUS,
              look,
              hit: [],
            });
          }
          s.cd.ember = stats.cooldown;
          this.events.push({ type: 'shoot' });
        } else {
          s.cd.ember = 0.1;
        }
      }
    }

    if (w.aura) {
      s.cd.aura -= dt;
      if (s.cd.aura <= 0) {
        const stats = auraStats(w.aura, this.mods);
        s.cd.aura = stats.tick;
        for (const e of enemies) {
          if (e.hp <= 0) continue;
          const reach = stats.radius + ENEMIES[e.kind].radius;
          if ((e.x - p.x) ** 2 + (e.y - p.y) ** 2 < reach * reach) {
            // 고리 안의 적이 한꺼번에 번쩍여 화면을 가리지 않게 짧게만 깜빡인다.
            this.damage(e, stats.damage, 'aura', 0.04);
            this.chill(e, stats.slow);
          }
        }
      }
    }

    if (w.firefly) {
      const stats = fireflyStats(w.firefly, this.mods);
      s.fireflyAngle = (s.fireflyAngle + stats.spin * dt) % (Math.PI * 2);
      for (let k = 0; k < stats.count; k += 1) {
        const angle = s.fireflyAngle + (k / stats.count) * Math.PI * 2;
        const fx = p.x + Math.cos(angle) * stats.orbit;
        const fy = p.y + Math.sin(angle) * stats.orbit;
        for (const e of enemies) {
          if (e.hp <= 0 || e.fireflyCd > 0) continue;
          const reach = FIREFLY_RADIUS + ENEMIES[e.kind].radius;
          if ((e.x - fx) ** 2 + (e.y - fy) ** 2 < reach * reach) {
            this.damage(e, stats.damage, 'firefly');
            e.fireflyCd = stats.rehit;
          }
        }
      }
    }

    if (w.beam) {
      const stats = beamStats(w.beam, this.mods);
      const full = Math.PI * 2;
      const sweep = stats.spin * dt;
      const turn = ((s.beamAngle ?? 0) + sweep) % full;
      s.beamAngle = turn;
      const gap = full / stats.count;
      for (const e of enemies) {
        if (e.hp <= 0 || (e.beamCd ?? 0) > 0) continue;
        const dx = e.x - p.x;
        const dy = e.y - p.y;
        const radius = ENEMIES[e.kind].radius;
        const reach = stats.length + radius;
        const d2 = dx * dx + dy * dy;
        if (d2 > reach * reach) continue;
        // 이번 걸음에 어느 빛줄기든 이 적이 있는 쪽을 지나갔으면 맞는다.
        // 굵기로 재면 바짝 붙은 적은 한 번 지나가는 동안 거듭 맞으므로, 빛줄기의 가운데가 지나간 때만 센다.
        // 플레이어를 덮고 선 적은 어느 쪽에 있는지가 걸음마다 뒤집히므로, 한쪽(0)에 있는 것으로 친다.
        const bearing = d2 < radius * radius ? 0 : Math.atan2(dy, dx);
        const behind = (((turn - bearing) % gap) + gap) % gap;
        if (behind > sweep + 1e-9) continue;
        this.damage(e, stats.damage, 'beam');
        e.beamCd = BEAM_REHIT;
      }
    }

    if (w.star) {
      s.cd.star -= dt;
      if (s.cd.star <= 0) {
        const stats = starStats(w.star, this.mods);
        const halfW = s.viewW / 2 - 6;
        const halfH = s.viewH / 2 - 6;
        const seen = enemies.filter(
          (e) => e.hp > 0 && Math.abs(e.x - p.x) < halfW && Math.abs(e.y - p.y) < halfH,
        );
        if (seen.length === 0) {
          s.cd.star = 0.2;
        } else {
          for (let i = 0; i < stats.count; i += 1) {
            const target = seen[Math.floor(this.rand() * seen.length)];
            s.strikes.push({
              x: target.x,
              y: target.y,
              delay: 0.35 + i * 0.12,
              radius: stats.radius,
              damage: stats.damage,
              evolved: isEvolved(w.star),
            });
          }
          s.cd.star = stats.cooldown;
        }
      }
    }

    if (w.lance) {
      s.cd.lance -= dt;
      if (s.cd.lance <= 0) {
        // 닿는 거리 안에서 체력이 가장 많은 적을 겨눈다. 그 사이에 있는 적은 모두 꿰뚫는다.
        let target: Enemy | null = null;
        for (const e of enemies) {
          if (e.hp <= 0 || (e.x - p.x) ** 2 + (e.y - p.y) ** 2 > LANCE_RANGE * LANCE_RANGE) continue;
          if (!target || e.hp > target.hp) target = e;
        }
        if (target) {
          const stats = lanceStats(w.lance, this.mods);
          const base = Math.atan2(target.y - p.y, target.x - p.x);
          const look: ShotLook = isEvolved(w.lance) ? 'lanceEvo' : 'lance';
          for (let i = 0; i < stats.count; i += 1) {
            const angle = base + (i - (stats.count - 1) / 2) * 0.2;
            s.shots.push({
              x: p.x,
              y: p.y,
              vx: Math.cos(angle) * stats.speed,
              vy: Math.sin(angle) * stats.speed,
              damage: stats.damage,
              pierce: PIERCE_ALL,
              life: stats.life,
              radius: stats.radius,
              look,
              hit: [],
            });
          }
          s.cd.lance = stats.cooldown;
          this.events.push({ type: 'shoot' });
        } else {
          s.cd.lance = 0.15;
        }
      }
    }

    if (w.oil) {
      s.cd.oil -= dt;
      if (s.cd.oil <= 0) {
        const stats = oilStats(w.oil, this.mods);
        s.cd.oil = stats.cooldown;
        // 서 있던 자리에 이미 불길이 있으면 겹쳐 쌓지 않고 그 불길을 다시 살린다.
        const here = s.fires.find((fire) => (fire.x - p.x) ** 2 + (fire.y - p.y) ** 2 < (fire.radius * 0.5) ** 2);
        if (here) {
          here.life = stats.duration;
          here.radius = stats.radius;
          here.damage = stats.damage;
          here.slow = stats.slow;
          here.evolved = isEvolved(w.oil);
        } else {
          s.fires.push({
            x: p.x,
            y: p.y,
            radius: stats.radius,
            life: stats.duration,
            tick: 0,
            every: stats.tick,
            damage: stats.damage,
            slow: stats.slow,
            evolved: isEvolved(w.oil),
          });
        }
      }
    }

    if (w.bolt) {
      s.cd.bolt -= dt;
      if (s.cd.bolt <= 0) {
        const stats = boltStats(w.bolt, this.mods);
        const struck: Enemy[] = [];
        for (let chain = 0; chain < stats.chains; chain += 1) {
          // 플레이어에게서 가장 가까운 적을 치고, 거기서 가까운 다음 적으로 튄다.
          const points = [p.x, p.y];
          let fromX = p.x;
          let fromY = p.y;
          let range = stats.reach;
          for (let jump = 0; jump < stats.jumps; jump += 1) {
            let target: Enemy | null = null;
            let best = range * range;
            for (const e of enemies) {
              if (e.hp <= 0 || struck.includes(e)) continue;
              const d2 = (e.x - fromX) ** 2 + (e.y - fromY) ** 2;
              if (d2 < best) {
                best = d2;
                target = e;
              }
            }
            if (!target) break;
            struck.push(target);
            this.damage(target, stats.damage, 'bolt');
            points.push(target.x, target.y);
            fromX = target.x;
            fromY = target.y;
            range = stats.hop;
          }
          if (points.length > 2) this.events.push({ type: 'bolt', points, evolved: isEvolved(w.bolt) });
        }
        s.cd.bolt = struck.length > 0 ? stats.cooldown : 0.15;
      }
    }

    if (w.bell) {
      s.cd.bell -= dt;
      if (s.cd.bell <= 0) {
        const stats = bellStats(w.bell, this.mods);
        // 둘레에 아무도 없으면 울리지 않고 기다린다.
        const reach = stats.radius + 10;
        const near = enemies.some((e) => e.hp > 0 && (e.x - p.x) ** 2 + (e.y - p.y) ** 2 < reach * reach);
        if (!near) {
          s.cd.bell = 0.2;
        } else {
          const evolved = isEvolved(w.bell);
          for (let i = 0; i < stats.rings; i += 1) {
            s.waves.push({
              x: p.x,
              y: p.y,
              radius: 0,
              max: stats.radius,
              delay: i * BELL_GAP,
              damage: stats.damage,
              push: stats.push,
              slow: stats.slow,
              hit: [],
              evolved,
            });
          }
          s.cd.bell = stats.cooldown;
          this.events.push({ type: 'bell', evolved });
        }
      }
    }

    if (w.moon) {
      s.cd.moon -= dt;
      if (s.cd.moon <= 0) {
        let target: Enemy | null = null;
        let best = MOON_RANGE * MOON_RANGE;
        for (const e of enemies) {
          if (e.hp <= 0) continue;
          const d2 = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
          if (d2 < best) {
            best = d2;
            target = e;
          }
        }
        if (target) {
          const stats = moonStats(w.moon, this.mods);
          const base = Math.atan2(target.y - p.y, target.x - p.x);
          for (let i = 0; i < stats.count; i += 1) {
            const angle = base + (i - (stats.count - 1) / 2) * MOON_SPREAD;
            s.moons.push({
              x: p.x,
              y: p.y,
              dx: Math.cos(angle),
              dy: Math.sin(angle),
              left: stats.reach,
              back: false,
              speed: stats.speed,
              damage: stats.damage,
              radius: stats.radius,
              rehit: stats.rehit,
              sweep: stats.rehit,
              hit: [],
              life: MOON_LIFE,
              evolved: isEvolved(w.moon),
            });
          }
          s.cd.moon = stats.cooldown;
          this.events.push({ type: 'shoot' });
        } else {
          s.cd.moon = 0.15;
        }
      }
    }
  }

  /** 종소리가 퍼지면서, 고리가 닿은 적을 한 번씩 때리고 바깥으로 밀어낸다. */
  private spreadWaves(dt: number): void {
    const s = this.state;
    let kept = 0;
    for (const wave of s.waves) {
      if (wave.delay > 0) {
        wave.delay -= dt;
        s.waves[kept] = wave;
        kept += 1;
        continue;
      }
      wave.radius = Math.min(wave.max, wave.radius + BELL_SPEED * dt);
      for (const e of s.enemies) {
        if (e.hp <= 0 || wave.hit.includes(e.uid)) continue;
        const info = ENEMIES[e.kind];
        const dx = e.x - wave.x;
        const dy = e.y - wave.y;
        const distance = Math.hypot(dx, dy);
        if (distance > wave.radius + info.radius) continue;
        wave.hit.push(e.uid);
        this.damage(e, wave.damage, 'bell');
        this.chill(e, wave.slow);
        // 보스는 밀리지 않는다. 끝없는 밤에서 세진 그림자는 그만큼 덜 밀린다.
        if (!info.boss) {
          const push = wave.push / this.late.damage;
          const scale = distance > 0.001 ? push / distance : 0;
          e.kx = (e.kx ?? 0) + (distance > 0.001 ? dx * scale : push);
          e.ky = (e.ky ?? 0) + dy * scale;
        }
      }
      if (wave.radius < wave.max) {
        s.waves[kept] = wave;
        kept += 1;
      }
    }
    s.waves.length = kept;
  }

  /** 초승달이 날아갔다가 돌아온다. 가는 길에 한 번, 오는 길에 한 번 벤다. */
  private moveMoons(dt: number): void {
    const s = this.state;
    const p = s.player;
    let kept = 0;
    for (const moon of s.moons) {
      moon.life -= dt;
      let alive = moon.life > 0;
      if (!moon.back) {
        // 끝에 가까울수록 느려졌다가 돌아선다.
        const ease = Math.max(0.35, Math.min(1, moon.left / 24));
        const move = Math.min(moon.left, moon.speed * ease * dt);
        moon.x += moon.dx * move;
        moon.y += moon.dy * move;
        moon.left -= move;
        if (moon.left <= 0.01) {
          moon.back = true;
          moon.hit.length = 0;
        }
      } else {
        const dx = p.x - moon.x;
        const dy = p.y - moon.y;
        const distance = Math.hypot(dx, dy);
        if (distance < MOON_CATCH) {
          alive = false;
        } else {
          // 돌아올 때는 조금 더 빨라서, 달아나는 플레이어도 따라잡는다.
          const move = Math.min(distance, moon.speed * 1.25 * dt);
          moon.x += (dx / distance) * move;
          moon.y += (dy / distance) * move;
        }
      }
      if (alive && moon.rehit > 0) {
        moon.sweep -= dt;
        if (moon.sweep <= 0) {
          moon.sweep = moon.rehit;
          moon.hit.length = 0;
        }
      }
      if (alive) {
        for (const e of s.enemies) {
          if (e.hp <= 0 || moon.hit.includes(e.uid)) continue;
          const reach = moon.radius + ENEMIES[e.kind].radius;
          if ((e.x - moon.x) ** 2 + (e.y - moon.y) ** 2 >= reach * reach) continue;
          moon.hit.push(e.uid);
          this.damage(e, moon.damage, 'moon');
        }
        s.moons[kept] = moon;
        kept += 1;
      }
    }
    s.moons.length = kept;
  }

  private moveShots(dt: number): void {
    const s = this.state;
    const enemies = s.enemies;
    let kept = 0;
    for (const shot of s.shots) {
      shot.x += shot.vx * dt;
      shot.y += shot.vy * dt;
      shot.life -= dt;
      let alive = shot.life > 0;

      const cx = Math.floor(shot.x / CELL);
      const cy = Math.floor(shot.y / CELL);
      for (let oy = -1; alive && oy <= 1; oy += 1) {
        for (let ox = -1; alive && ox <= 1; ox += 1) {
          let j = this.heads[((cx + ox) & 63) | (((cy + oy) & 63) << 6)];
          while (j !== -1) {
            const e = enemies[j];
            j = this.next[j];
            if (e.hp <= 0 || shot.hit.includes(e.uid)) continue;
            const reach = shot.radius + ENEMIES[e.kind].radius;
            const dx = e.x - shot.x;
            const dy = e.y - shot.y;
            if (dx * dx + dy * dy >= reach * reach) continue;
            this.damage(e, shot.damage, shot.look === 'ember' || shot.look === 'emberEvo' ? 'ember' : 'lance');
            // 맞은 적은 살짝 밀려난다.
            if (!ENEMIES[e.kind].boss) {
              const speed = Math.hypot(shot.vx, shot.vy) || 1;
              e.x += (shot.vx / speed) * 2;
              e.y += (shot.vy / speed) * 2;
            }
            shot.hit.push(e.uid);
            shot.pierce -= 1;
            if (shot.pierce < 0) {
              alive = false;
              break;
            }
          }
        }
      }
      if (alive) {
        s.shots[kept] = shot;
        kept += 1;
      }
    }
    s.shots.length = kept;
  }

  private landStrikes(dt: number): void {
    const s = this.state;
    let kept = 0;
    for (const strike of s.strikes) {
      strike.delay -= dt;
      if (strike.delay > 0) {
        s.strikes[kept] = strike;
        kept += 1;
        continue;
      }
      for (const e of s.enemies) {
        if (e.hp <= 0) continue;
        const reach = strike.radius + ENEMIES[e.kind].radius;
        if ((e.x - strike.x) ** 2 + (e.y - strike.y) ** 2 < reach * reach) {
          this.damage(e, strike.damage, 'star');
        }
      }
      this.events.push({ type: 'strike', x: strike.x, y: strike.y, radius: strike.radius });
    }
    s.strikes.length = kept;
  }

  private burnFires(dt: number): void {
    const s = this.state;
    let kept = 0;
    for (const fire of s.fires) {
      fire.life -= dt;
      fire.tick -= dt;
      if (fire.tick <= 0) {
        fire.tick += fire.every;
        for (const e of s.enemies) {
          if (e.hp <= 0) continue;
          const reach = fire.radius + ENEMIES[e.kind].radius;
          if ((e.x - fire.x) ** 2 + (e.y - fire.y) ** 2 < reach * reach) {
            this.damage(e, fire.damage, 'oil', 0.04);
            this.chill(e, fire.slow);
          }
        }
      }
      if (fire.life > 0) {
        s.fires[kept] = fire;
        kept += 1;
      }
    }
    s.fires.length = kept;
  }

  // ------------------------------------------------------------ 등불 기둥

  /** 때가 되면 등불 기둥을 세우고, 플레이어가 닿은 기둥을 켜고, 켜진 기둥의 둘레를 태운다. */
  private tendPosts(dt: number): void {
    const s = this.state;
    const p = s.player;
    const posts = (s.posts ??= []);
    let spawned = s.postsSpawned ?? 0;
    while (spawned < POSTS.times.length && s.t >= POSTS.times[spawned]) {
      const angle = this.rand() * Math.PI * 2;
      const distance = POSTS.near + this.rand() * (POSTS.far - POSTS.near);
      // 켜지 않은 기둥이 너무 쌓이지 않게, 가장 오래된 것부터 치운다.
      if (posts.filter((post) => post.lit <= 0).length >= POSTS.keep) {
        posts.splice(
          posts.findIndex((post) => post.lit <= 0),
          1,
        );
      }
      const post: Post = { x: p.x + Math.cos(angle) * distance, y: p.y + Math.sin(angle) * distance, lit: 0, tick: 0 };
      posts.push(post);
      spawned += 1;
      this.note('post');
      this.events.push({ type: 'post', x: post.x, y: post.y, first: spawned === 1 });
    }
    s.postsSpawned = spawned;

    const touch = POSTS.touch + PLAYER_BASE.radius;
    let kept = 0;
    for (const post of posts) {
      if (post.lit <= 0) {
        if ((p.x - post.x) ** 2 + (p.y - post.y) ** 2 < touch * touch) {
          post.lit = POSTS.seconds;
          post.tick = 0;
          this.events.push({ type: 'light', x: post.x, y: post.y });
        }
      } else {
        post.lit -= dt;
        if (post.lit <= 0) {
          this.events.push({ type: 'dim', x: post.x, y: post.y });
          continue;
        }
        post.tick -= dt;
        if (post.tick <= 0) {
          post.tick += POSTS.tick;
          this.scorch(post);
        }
      }
      posts[kept] = post;
      kept += 1;
    }
    posts.length = kept;
  }

  /** 켜진 기둥의 빛이 둘레 안의 그림자를 한 번 태운다. 체력의 몫으로 깎아서 언제 켜도 쓸모가 같다. */
  private scorch(post: Post): void {
    for (const e of this.state.enemies) {
      if (e.hp <= 0) continue;
      const info = ENEMIES[e.kind];
      const reach = POSTS.radius + info.radius;
      if ((e.x - post.x) ** 2 + (e.y - post.y) ** 2 >= reach * reach) continue;
      const burn = info.boss ? POSTS.bossBurn : info.elite ? ELITE.burn : POSTS.burn;
      this.damage(e, Math.max(1, e.maxHp * burn), null);
      if (!info.boss) this.chill(e, POSTS.slow);
    }
  }

  // ------------------------------------------------------------ 정리와 보상

  /** 쓰러진 적을 치우고 빛 조각을 떨어뜨린다. 부싯돌이 터져서 더 쓰러진 적도 이 자리에서 마저 치운다. */
  private reap(): void {
    const s = this.state;
    const sparks = this.sweep();
    if (sparks.length === 0) return;
    // 부싯돌: 쓰러진 자리가 터져서 둘레의 그림자가 다친다. 이렇게 쓰러진 그림자는 다시 터지지 않는다.
    const radius = FLINT.radius * this.mods.area;
    for (let i = 0; i < sparks.length; i += 3) {
      const x = sparks[i];
      const y = sparks[i + 1];
      // 튼튼한 그림자일수록 세게 터진다.
      const damage = (FLINT.damage + FLINT.share * sparks[i + 2]) * this.mods.damage;
      for (const e of s.enemies) {
        if (e.hp <= 0) continue;
        const reach = radius + ENEMIES[e.kind].radius;
        if ((e.x - x) ** 2 + (e.y - y) ** 2 >= reach * reach) continue;
        this.damage(e, damage, null);
        if (e.hp <= 0) e.sparked = true;
      }
      this.events.push({ type: 'spark', x, y, radius });
    }
    this.sweep();
  }

  /**
   * 체력이 다한 적을 치우고 빛 조각을 떨어뜨린다. 순서를 지켜 줄여서 그리는 순서가 흔들리지 않게 한다.
   * 부싯돌로 터질 자리를 x, y, 그 그림자의 최대 체력이 차례로 든 배열로 돌려준다.
   */
  private sweep(): number[] {
    const s = this.state;
    let kept = 0;
    const sparks: number[] = [];
    /** 쪼개질 자리와 종류. 줄이는 중인 목록에 바로 넣지 않고 다 치운 뒤에 내보낸다. */
    const pieces: Array<{ kind: EnemyKind; x: number; y: number; count: number }> = [];
    for (const e of s.enemies) {
      if (e.hp > 0) {
        s.enemies[kept] = e;
        kept += 1;
        continue;
      }
      const info = ENEMIES[e.kind];
      s.kills += 1;
      this.events.push({ type: 'kill', x: e.x, y: e.y, boss: Boolean(info.boss) });
      if (info.xp > 0) this.dropGem(e.x, e.y, info.xp, 'xp');
      if (info.splits) pieces.push({ kind: info.splits.into, x: e.x, y: e.y, count: info.splits.count });
      if (info.sprouts) this.plant(e.x, e.y, info.sprouts);
      if (info.boss) {
        s.bossKills += 1;
        this.dropGem(e.x + 8, e.y, HEAL_DROP_VALUE * 2, 'heal');
        if (e.kind === STAGES[s.stage].finalBoss && !s.endless) {
          // 새벽. 끝없는 밤으로 이어 갈 수 있는 판이면 마칠지 이어 갈지 고를 때까지 멈춘다.
          if (s.endlessOpen) s.pendingDawn = true;
          else s.over = 'cleared';
        } else {
          // 중간 보스를 잡으면 무기 강화권을 한 장 받는다.
          s.pendingTickets += 1;
          this.events.push({ type: 'ticket' });
        }
      } else if (info.elite) {
        // 정예는 보물 상자를 떨어뜨린다. 강화권을 지닌 정예(잔치의 밤)는 쓰러지는 자리에서 강화권도 준다.
        this.dropGem(e.x, e.y, 0, 'chest');
        if (e.ticket) {
          s.pendingTickets += 1;
          this.events.push({ type: 'ticket' });
        }
      } else {
        // 난수는 한 번만 뽑아서 무엇을 떨어뜨릴지 정한다.
        const roll = this.rand();
        if (roll < HEAL_DROP_CHANCE) this.dropGem(e.x, e.y, HEAL_DROP_VALUE, 'heal');
        else if (roll < HEAL_DROP_CHANCE + PULL_DROP_CHANCE) this.dropGem(e.x, e.y, 0, 'pull');
        else if (roll < HEAL_DROP_CHANCE + PULL_DROP_CHANCE + BLAST_DROP_CHANCE) this.dropGem(e.x, e.y, 0, 'blast');
        // 부싯돌이 있을 때만 난수를 더 뽑는다. 없는 판의 흐름은 달라지지 않는다.
        if (this.mods.spark > 0 && !e.sparked && this.rand() < this.mods.spark) sparks.push(e.x, e.y, e.maxHp);
      }
    }
    s.enemies.length = kept;
    // 쪼개지는 적: 쓰러진 자리에서 작은 것들이 양옆으로 튀어 나온다. 싸움터가 넘치면 쪼개지지 않는다.
    if (pieces.length > 0 && !s.over) {
      const room = Math.round(maxAlive(this.clock) * 1.25);
      for (const piece of pieces) {
        for (let i = 0; i < piece.count && s.enemies.length < room; i += 1) {
          const angle = (i / piece.count) * Math.PI * 2 + piece.x * 0.37;
          const born = this.makeEnemy(piece.kind, piece.x + Math.cos(angle) * 4, piece.y + Math.sin(angle) * 4);
          born.kx = Math.cos(angle) * SPLIT_PUSH;
          born.ky = Math.sin(angle) * SPLIT_PUSH;
        }
      }
    }
    return sparks;
  }

  private dropGem(x: number, y: number, value: number, kind: Gem['kind']): void {
    const gems = this.state.gems;
    // 조각이 너무 많으면 가장 오래된 조각을 거두어 새 조각에 합친다. 값이 싸움터 가까이에 남는다.
    if (kind === 'xp' && gems.length >= GEM_LIMIT) {
      const oldest = gems.findIndex((gem) => gem.kind === 'xp' && !gem.pulled);
      if (oldest >= 0) {
        value += gems[oldest].value;
        gems.splice(oldest, 1);
      }
    }
    gems.push({ x, y, value, kind, pulled: false });
  }

  private moveGems(dt: number): void {
    const s = this.state;
    const p = s.player;
    const magnet = this.magnetRadius;
    let kept = 0;
    for (const gem of s.gems) {
      const dx = p.x - gem.x;
      const dy = p.y - gem.y;
      const distance = Math.hypot(dx, dy);
      if (!gem.pulled && distance < magnet) gem.pulled = true;
      if (gem.pulled) {
        if (distance < GEM_PICKUP) {
          this.collect(gem);
          continue;
        }
        const move = Math.min(distance, GEM_SPEED * dt);
        gem.x += (dx / distance) * move;
        gem.y += (dy / distance) * move;
      }
      s.gems[kept] = gem;
      kept += 1;
    }
    s.gems.length = kept;
  }

  private collect(gem: Gem): void {
    const s = this.state;
    const p = s.player;
    if (gem.kind !== 'xp') this.note(gem.kind);
    if (gem.kind === 'heal') {
      p.hp = Math.min(this.mods.maxHp, p.hp + gem.value);
      this.events.push({ type: 'heal' });
      return;
    }
    if (gem.kind === 'pull') {
      // 싸움터의 빛 조각이 어디에 있든 모두 끌려온다. 회복 떡과 다른 것은 그 자리에 남는다.
      for (const other of s.gems) if (other.kind === 'xp') other.pulled = true;
      this.events.push({ type: 'pull' });
      return;
    }
    if (gem.kind === 'blast') {
      // 화면에 보이는 곳까지만 닿는다. 쓰러진 그림자는 다음 걸음에 치워지며 빛 조각을 떨어뜨린다.
      const reachX = s.viewW / 2 + BLAST_MARGIN;
      const reachY = s.viewH / 2 + BLAST_MARGIN;
      for (const e of s.enemies) {
        if (e.hp <= 0 || Math.abs(e.x - p.x) > reachX || Math.abs(e.y - p.y) > reachY) continue;
        const info = ENEMIES[e.kind];
        this.damage(e, info.boss ? e.maxHp * BLAST_BOSS_SHARE : info.elite ? e.maxHp * ELITE.blast : e.hp, null);
      }
      this.events.push({ type: 'blast' });
      return;
    }
    if (gem.kind === 'chest') {
      // 가진 것 가운데 하나가 한 단계 오른다. 더 올릴 것이 없으면 불씨를 받는다.
      const upgrade = chestUpgrade({ weapons: s.weapons, passives: s.passives }, this.rand);
      if (upgrade) this.grant(upgrade);
      else s.bonusEmbers += CHEST.embers;
      s.chests = (s.chests ?? 0) + 1;
      this.events.push({ type: 'chest', upgrade });
      return;
    }
    p.xp += gem.value * this.mods.xp;
    this.events.push({ type: 'gem' });
    while (p.xp >= xpToNext(p.level)) {
      p.xp -= xpToNext(p.level);
      p.level += 1;
      s.pendingLevelUps += 1;
      this.events.push({ type: 'levelup' });
    }
  }
}
