/**
 * 하던 판의 저장. 앱이 닫히거나 판을 두고 나가도, 다음에 준비 화면에서 그 자리부터 이어 한다.
 * 판의 상태(RunState)는 평범한 데이터라 그대로 적고, 읽을 때 모양이 맞는지 하나하나 본다.
 * 모양이 맞지 않는 저장(망가졌거나 다른 버전이 적은 것)은 버린다. 그 판은 이어 하지 못하지만,
 * 날마다 넣어 둔 씨앗과 기록은 진행(meta)에 이미 들어 있어서 잃지 않는다.
 *
 * RunState, Enemy, Shot, Spawn, Stats에 필드를 더하면 아래의 *_SHAPE에도 적어야 타입 검사를 통과한다.
 * 필드를 더했으면 RUN_VERSION도 올린다. 옛 저장에는 새 필드가 없어서 어차피 버려지지만, 숫자로 남겨 두면 알아보기 쉽다.
 */
import { ENEMIES, type EnemyKind } from './data';
import { applyRun, bankSeeds, type GardenMeta, type Spawn, type Stats } from './rules';
import type { Enemy, Phase, RunState, Shot } from './sim';

export const RUN_VERSION = 1;

export interface SavedRun {
  state: RunState;
  /** 이 판에서 번 씨앗 가운데 이미 진행(meta.seeds)에 넣은 양 */
  banked: number;
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
  helperIn: 'array',
  stormIn: 'number',
  aim: 'number',
  manual: 'boolean',
  t: 'number',
  kills: 'number',
  seeds: 'number',
  lastCleared: 'number',
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
  helper: 'boolean',
};

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
  helpers: 'number',
  helperDamage: 'number',
  stormCooldown: 'number',
  stormDamage: 'number',
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
const allNumbers = (value: unknown): boolean => Array.isArray(value) && value.every((item) => kindOf(item) === 'number');

function isRunState(value: unknown): value is RunState {
  if (!fits(value, STATE_SHAPE)) return false;
  if (!LIVE_PHASES.includes(value.phase as Phase) || !fits(value.stats, STATS_SHAPE)) return false;
  if (!allNumbers(value.helperIn)) return false;
  const queue = value.queue as unknown[];
  const enemies = value.enemies as unknown[];
  const shots = value.shots as unknown[];
  return (
    queue.every((spawn) => fits(spawn, SPAWN_SHAPE) && isKind(spawn.kind)) &&
    enemies.every((enemy) => fits(enemy, ENEMY_SHAPE) && isKind(enemy.kind)) &&
    shots.every((shot) => fits(shot, SHOT_SHAPE) && allNumbers(shot.hit))
  );
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
  const run = raw.run;
  if (raw.version !== RUN_VERSION || !isObject(run) || !isRunState(run.state)) return { savedAt, run: null };
  const banked = kindOf(run.banked) === 'number' ? Math.max(0, Math.floor(run.banked as number)) : 0;
  return { savedAt, run: { state: run.state, banked } };
}

/**
 * 이어 하지 않기로 한 판을 마친다. 아직 넣지 않은 씨앗을 넣고 판 수와 쫓아낸 벌레를 더한다.
 * 가장 멀리 지킨 날은 날을 넘길 때마다 이미 넣었다.
 */
export function settleSavedRun(meta: GardenMeta, saved: SavedRun): GardenMeta {
  const { state } = saved;
  return applyRun(bankSeeds(meta, Math.floor(state.seeds) - saved.banked), state.lastCleared, state.kills);
}
