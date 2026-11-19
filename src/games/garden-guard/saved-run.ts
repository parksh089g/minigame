/**
 * 하던 판의 저장. 앱이 닫히거나 판을 두고 나가도, 다음에 준비 화면에서 그 자리부터 이어 한다.
 * 판의 상태(RunState)는 평범한 데이터라 그대로 적고, 읽을 때 모양이 맞는지와 값이 판에서 나올 수 있는 범위인지 하나하나 본다.
 * 모양이 맞지 않는 저장(망가졌거나 다른 버전이 적은 것)은 버린다. 그 판은 이어 하지 못하지만,
 * 날마다 넣어 둔 씨앗과 기록은 진행(meta)에 이미 들어 있어서 잃지 않는다.
 *
 * RunState, Enemy, Shot, Spawn, Stats에 필드를 더하면 아래의 *_SHAPE에도 적어야 타입 검사를 통과한다.
 * 필드를 더했으면 RUN_VERSION도 올린다. 옛 저장에는 새 필드가 없어서 그대로는 버려지므로,
 * 빠진 값을 채워서 이어 할 수 있으면 readRunRecord에서 채운다(버전 2의 판에 유물의 값을 채우는 fillRelicFields처럼).
 */
import { cellsValid, copiesFor, openShop, placeAlly, type Ally, type ShopCard } from './allies';
import { ALLIES, ALLY_STARS, GUN, SHOP, STEP, ENEMIES, type AllyId, type EnemyKind } from './data';
import { applyRun, bankSeeds, bankShards, MAX_DAY, type GardenMeta, type Spawn, type Stats } from './rules';
import type { Enemy, Phase, RunState, Shot } from './sim';

/**
 * 3: 유물이 생겼다(판의 shards, guardLeft와 능력치의 유물 값들, 저장의 bankedShards).
 * 4: 판마다 고르는 강화 대신 동료가 생겼다(판의 allies와 동료가 선 칸, fruit, shopping, shop, rolls와 물방울의 ally, 능력치의 allyPower).
 */
export const RUN_VERSION = 4;

export interface SavedRun {
  state: RunState;
  /** 이 판에서 번 씨앗 가운데 이미 진행(meta.seeds)에 넣은 양 */
  banked: number;
  /** 이 판에서 받은 유물 조각 가운데 이미 진행(meta.shards)에 넣은 양 */
  bankedShards: number;
}

/** 기기에 적는 모양. run이 null이면 이어 할 판이 없다는 뜻이다. */
export interface RunRecord {
  version: number;
  /** 적은 때(ms). 같은 기기의 다른 곳이 더 늦게 적은 것인지 이것으로 가린다. */
  savedAt: number;
  run: SavedRun | null;
}

type Kind = 'number' | 'boolean' | 'string' | 'array' | 'object';

const STATE_SHAPE: Record<keyof RunState, Kind> = {
  rng: 'number',
  startDay: 'number',
  bestBefore: 'number',
  day: 'number',
  phase: 'string',
  dayTime: 'number',
  restLeft: 'number',
  queue: 'array',
  dayTotal: 'number',
  dayKilled: 'number',
  enemies: 'array',
  shots: 'array',
  nextId: 'number',
  stats: 'object',
  fence: 'number',
  fireIn: 'number',
  allies: 'array',
  stormIn: 'number',
  aim: 'number',
  manual: 'boolean',
  t: 'number',
  kills: 'number',
  seeds: 'number',
  lastCleared: 'number',
  fruit: 'number',
  shopping: 'boolean',
  shop: 'array',
  rolls: 'number',
  shards: 'number',
  guardLeft: 'number',
};

const ENEMY_SHAPE: Record<keyof Enemy, Kind> = {
  id: 'number',
  kind: 'string',
  x: 'number',
  y: 'number',
  homeX: 'number',
  hp: 'number',
  maxHp: 'number',
  day: 'number',
  biting: 'boolean',
  biteIn: 'number',
  clock: 'number',
  slow: 'number',
  slowLeft: 'number',
  summonIn: 'number',
  flash: 'number',
};

const SHOT_SHAPE: Record<keyof Shot, Kind> = {
  id: 'number',
  x: 'number',
  y: 'number',
  vx: 'number',
  vy: 'number',
  damage: 'number',
  crit: 'boolean',
  pierce: 'number',
  hit: 'array',
  ally: 'string',
};

const ALLY_SHAPE: Record<keyof Ally, Kind> = { id: 'string', copies: 'number', fireIn: 'number', cell: 'number' };
/** 가게의 카드. 묶임(locked)은 묶기가 생기기 전에 적은 판에는 없어서 따로 본다(isCard). */
const CARD_SHAPE: Record<Exclude<keyof ShopCard, 'locked'>, Kind> = { id: 'string', sold: 'boolean' };

const SPAWN_SHAPE: Record<keyof Spawn, Kind> = { at: 'number', kind: 'string', x: 'number' };

const STATS_SHAPE: Record<keyof Stats, Kind> = {
  damage: 'number',
  interval: 'number',
  critChance: 'number',
  pierce: 'number',
  streams: 'number',
  splashRadius: 'number',
  splashRatio: 'number',
  chill: 'number',
  chillSeconds: 'number',
  fenceMax: 'number',
  mend: 'number',
  thorns: 'number',
  seedMult: 'number',
  allyPower: 'number',
  stormCooldown: 'number',
  stormDamage: 'number',
  critMult: 'number',
  bossDamage: 'number',
  freshDamage: 'number',
  pace: 'number',
  guard: 'number',
  clearSeeds: 'number',
};

/** 이어 할 수 있는 판의 때. 끝난 판('over')은 저장하지 않는다. */
const LIVE_PHASES: readonly Phase[] = ['fight', 'rest'];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function kindOf(value: unknown): Kind | null {
  if (Array.isArray(value)) return 'array';
  if (isObject(value)) return 'object';
  if (typeof value === 'number') return Number.isFinite(value) ? 'number' : null;
  if (typeof value === 'boolean' || typeof value === 'string') return typeof value as Kind;
  return null;
}

function fits(value: unknown, shape: Record<string, Kind>): value is Record<string, unknown> {
  return isObject(value) && Object.entries(shape).every(([key, kind]) => kindOf(value[key]) === kind);
}

const isKind = (value: unknown): value is EnemyKind => typeof value === 'string' && Object.hasOwn(ENEMIES, value);
const isAlly = (value: unknown): value is AllyId => typeof value === 'string' && Object.hasOwn(ALLIES, value);
const allNumbers = (value: unknown): boolean => Array.isArray(value) && value.every((item) => kindOf(item) === 'number');

/**
 * 저장에서 읽는 값의 한도. 실제 판에서는 닿지 않을 만큼 넉넉하게 두고, 망가진 저장의 터무니없는 값만 걸러 낸다(10차 검토 G11).
 * 모양만 보고 받아들이면 물줄기 수가 수백만인 판은 한 걸음에 프레임을 넘겨 멈추고, 날이 너무 크면 벌레의 체력이 무한대가 되고,
 * 마지막으로 지킨 날이 너무 크면 점수가 터무니없이 셈해진다. 한도를 바꿀 때는 saved-run.test.ts가 실제 판의 값으로 확인한다.
 */
const LIMIT = {
  /** 판 안의 수(씨앗, 쫓아낸 벌레, 지난 시간 같은 것)의 위쪽 끝 */
  count: 1e12,
  /** 능력치의 위쪽 끝(피해, 체력, 배율 같은 것) */
  stat: 1e9,
  /** 하나씩 세는 능력치(물줄기, 해바라기, 뚫는 수)의 위쪽 끝 */
  few: 16,
  /** 물을 쏘는 간격(초)의 아래쪽 끝 */
  interval: 0.02,
  /** 판에 한꺼번에 있는 벌레, 물방울, 나올 차례를 기다리는 벌레의 수 */
  list: 4000,
  /** 동료 거름의 배율의 위쪽 끝 */
  allyPower: 100,
  /**
   * 동료 하나에 모은 수의 위쪽 끝. ★5가 열여섯 마리이던 때 적은 판도 읽도록 그때의 끝으로 두고,
   * 읽은 뒤에 지금의 ★5(copiesFor(ALLY_STARS.max))로 줄인다.
   */
  copies: 16,
} as const;

const inRange = (value: unknown, low: number, high: number): boolean =>
  typeof value === 'number' && value >= low && value <= high;

/** 모양이 맞는 판의 값이 판에서 나올 수 있는 범위에 드는지 */
function valuesFit(state: Record<string, unknown>): boolean {
  const stats = state.stats as Record<string, number>;
  const statsFit =
    Object.values(stats).every((value) => inRange(value, 0, LIMIT.stat)) &&
    inRange(stats.streams, 1, LIMIT.few) &&
    inRange(stats.allyPower, 0, LIMIT.allyPower) &&
    inRange(stats.pierce, 0, LIMIT.few) &&
    stats.interval >= LIMIT.interval;
  if (!statsFit) return false;
  const day = state.day as number;
  const counts = ['t', 'kills', 'seeds', 'shards', 'nextId', 'fruit', 'rolls'].every((key) => inRange(state[key], 0, LIMIT.count));
  return (
    counts &&
    inRange(day, 1, MAX_DAY) &&
    inRange(state.startDay, 1, day) &&
    inRange(state.bestBefore, 0, MAX_DAY) &&
    inRange(state.lastCleared, 0, day) &&
    inRange(state.fence, 0, stats.fenceMax) &&
    inRange(state.dayTotal, 0, LIMIT.list) &&
    inRange(state.dayKilled, 0, state.dayTotal as number) &&
    (state.queue as unknown[]).length <= LIMIT.list &&
    (state.enemies as unknown[]).length <= LIMIT.list &&
    (state.shots as unknown[]).length <= LIMIT.list &&
    (state.allies as Array<Record<string, number>>).every((ally) => inRange(ally.copies, 1, LIMIT.copies)) &&
    (state.shop as unknown[]).length <= SHOP.cards &&
    // 가게는 날을 지키고 쉬는 동안(판의 첫날 앞도)에만 열린다.
    (!state.shopping || state.phase === 'rest') &&
    (state.shots as Array<{ hit: unknown[] }>).every((shot) => shot.hit.length <= LIMIT.list) &&
    (state.enemies as Array<Record<string, number>>).every(
      (enemy) => inRange(enemy.day, 1, MAX_DAY) && inRange(enemy.hp, -LIMIT.count, LIMIT.count) && inRange(enemy.maxHp, 0, LIMIT.count),
    )
  );
}

function isRunState(value: unknown): value is RunState {
  if (!fits(value, STATE_SHAPE)) return false;
  if (!LIVE_PHASES.includes(value.phase as Phase) || !fits(value.stats, STATS_SHAPE)) return false;
  const allies = value.allies as unknown[];
  // 같은 동료가 여럿 설 수 있지만, 칸을 겹치거나 한쪽 끝을 넘어서 설 수는 없다.
  if (!allies.every((ally) => fits(ally, ALLY_SHAPE) && isAlly(ally.id))) return false;
  if (!cellsValid(allies as Ally[])) return false;
  const isCard = (card: unknown): boolean =>
    fits(card, CARD_SHAPE) && isAlly(card.id) && (card.locked === undefined || typeof card.locked === 'boolean');
  if (!(value.shop as unknown[]).every(isCard)) return false;
  const queue = value.queue as unknown[];
  const enemies = value.enemies as unknown[];
  const shots = value.shots as unknown[];
  return (
    queue.every((spawn) => fits(spawn, SPAWN_SHAPE) && isKind(spawn.kind)) &&
    enemies.every((enemy) => fits(enemy, ENEMY_SHAPE) && isKind(enemy.kind)) &&
    shots.every((shot) => fits(shot, SHOT_SHAPE) && allNumbers(shot.hit) && (shot.ally === '' || isAlly(shot.ally))) &&
    valuesFit(value)
  );
}

/**
 * 유물이 생기기 전(버전 2)에 적은 판에 유물의 값을 채운다: 유물이 없는 판이고, 받은 조각도 없다.
 * 그 판은 유물 없이 시작했으니 끝까지 유물 없이 간다. 모양이 맞는지는 채운 뒤에 본다.
 */
function fillRelicFields(run: Record<string, unknown>): Record<string, unknown> {
  const state = run.state;
  if (!isObject(state) || !isObject(state.stats)) return run;
  return {
    ...run,
    bankedShards: 0,
    state: {
      ...state,
      shards: 0,
      guardLeft: 0,
      stats: { ...state.stats, critMult: GUN.critMult, bossDamage: 1, freshDamage: 1, pace: 1, guard: 0, clearSeeds: 1 },
    },
  };
}

/**
 * 동료가 생기기 전(버전 3까지)에 적은 판을 동료가 있는 판으로 바꾼다. 그 판에서 고른 강화는 능력치에 이미 들어 있으니 그대로 두고,
 * 해바라기(영구 강화)는 같은 수의 해바라기 동료로, 해바라기 거름은 동료 거름의 배율로 옮긴다.
 * 강화를 고르던 중에 둔 판은 고르는 창 대신 동료 가게를 연다(가게의 카드는 readRunRecord가 모양을 본 뒤에 뽑는다).
 * 열매는 판을 시작할 때만큼 쥐여 준다.
 */
function fillAllyFields(run: Record<string, unknown>): Record<string, unknown> {
  const state = run.state;
  if (!isObject(state) || !isObject(state.stats)) return run;
  const { helpers, helperDamage, ...stats } = state.stats;
  const { helperIn, boons: _boons, offer, ...rest } = state;
  const count = typeof helpers === 'number' ? Math.max(0, Math.min(ALLY_STARS.max, Math.floor(helpers))) : 0;
  const waits = Array.isArray(helperIn) ? helperIn : [];
  const team: Pick<RunState, 'allies'> = { allies: [] };
  const sunflower = count > 0 ? placeAlly(team, 'sunflower', count) : null;
  if (sunflower) sunflower.fireIn = typeof waits[0] === 'number' ? Math.max(0, waits[0]) : 0.5;
  const allies = team.allies;
  // 거름의 단계를 해바라기 씨의 피해 비율에서 거꾸로 셈한다(예전에는 물총 피해의 0.4 + 단계마다 0.15였다).
  const ratio = typeof helperDamage === 'number' && typeof stats.damage === 'number' && stats.damage > 0 ? helperDamage / stats.damage : 0.4;
  const compost = Math.max(0, Math.round((ratio - 0.4) / 0.15));
  const shots = Array.isArray(state.shots)
    ? state.shots.map((shot) => {
        if (!isObject(shot)) return shot;
        const { helper, ...others } = shot;
        return { ...others, ally: helper === true ? 'sunflower' : '' };
      })
    : state.shots;
  return {
    ...run,
    state: {
      ...rest,
      shots,
      allies,
      fruit: SHOP.purse,
      shopping: Array.isArray(offer) && offer.length > 0 && state.phase === 'rest',
      shop: [],
      rolls: 0,
      stats: { ...stats, allyPower: 1 + STEP.compost * compost },
    },
  };
}

/** 기기에 적을 모양으로 바꾼다. */
export function runRecord(run: SavedRun | null, savedAt: number): RunRecord {
  return { version: RUN_VERSION, savedAt, run };
}

/**
 * 기기에서 읽은 것을 이어 할 판으로 바꾼다. 적은 때는 모양이 맞지 않아도 읽어서,
 * 망가진 저장이 다른 곳의 더 새 저장을 가리지 않게 한다.
 */
export function readRunRecord(raw: unknown): { savedAt: number; run: SavedRun | null } {
  if (!isObject(raw)) return { savedAt: 0, run: null };
  const savedAt = kindOf(raw.savedAt) === 'number' && (raw.savedAt as number) > 0 ? (raw.savedAt as number) : 0;
  const known = raw.version === RUN_VERSION || raw.version === 3 || raw.version === 2;
  const relics = raw.version === 2 && isObject(raw.run) ? fillRelicFields(raw.run) : raw.run;
  const run = raw.version !== RUN_VERSION && isObject(relics) ? fillAllyFields(relics) : relics;
  if (!known || !isObject(run) || !isRunState(run.state)) return { savedAt, run: null };
  // 옛 판에서 강화를 고르던 중이었으면, 그 자리에 가게의 카드를 놓는다.
  if (run.state.shopping && run.state.shop.length === 0) openShop(run.state);
  // ★5에 모으는 수가 줄기 전(열여섯 마리)에 적은 판은 지금의 ★5로 줄인다.
  for (const ally of run.state.allies) ally.copies = Math.min(Math.floor(ally.copies), copiesFor(ALLY_STARS.max));
  const whole = (value: unknown): number => (kindOf(value) === 'number' ? Math.max(0, Math.floor(value as number)) : 0);
  return { savedAt, run: { state: run.state, banked: whole(run.banked), bankedShards: whole(run.bankedShards) } };
}

/**
 * 이어 하지 않기로 한 판을 마친다. 아직 넣지 않은 씨앗과 유물 조각을 넣고 판 수와 쫓아낸 벌레를 더한다.
 * 가장 멀리 지킨 날은 날을 넘길 때마다 이미 넣었다.
 */
export function settleSavedRun(meta: GardenMeta, saved: SavedRun): GardenMeta {
  const { state } = saved;
  const banked = bankShards(bankSeeds(meta, Math.floor(state.seeds) - saved.banked), state.shards - saved.bankedShards);
  return applyRun(banked, state.lastCleared, state.kills);
}
