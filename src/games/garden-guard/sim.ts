/**
 * 텃밭 지키기 한 판의 시뮬레이션. 화면 없이 돌아가고, 상태는 평범한 데이터다.
 * 씬은 입력(겨눈 자리, 물벼락)을 넘기고 step이 돌려준 일(SimEvent)을 그리기만 한다.
 * 자동 플레이(bot.ts)와 테스트도 같은 step을 돌려서, 화면에서 하는 판과 숫자가 같다.
 */
import { applyBoon, drawOffer, heatScale } from './boons';
import {
  CHARGE,
  DIG,
  ENEMIES,
  FIELD,
  DAY,
  GUN,
  HELPER_INTERVAL,
  HELPER_SPOTS,
  HOP,
  SHOOTER,
  STORM,
  SUMMON,
  WEAVE,
  type BoonId,
  type EnemyKind,
} from './data';
import {
  biteScale,
  clearBonus,
  hpScale,
  isBossDay,
  nextRandom,
  planDay,
  recordBonus,
  scoreFor,
  seedScale,
  statsFor,
  type Levels,
  type Spawn,
  type Stats,
} from './rules';

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  /** 흔들며 나는 벌레가 가운데로 삼는 x */
  homeX: number;
  hp: number;
  maxHp: number;
  /** 나타난 날. 갉는 피해와 주는 씨앗이 이 날을 따른다. */
  day: number;
  /** 울타리에 닿아 갉고 있는지 */
  biting: boolean;
  /** 다음에 갉을 때까지 남은 시간(초) */
  biteIn: number;
  /** 걸음새의 시계(초): 흔들림의 박자, 뛰기와 쉬기의 박자 */
  clock: number;
  /** 찬물에 젖어 느려진 정도(0~1)와 남은 시간(초) */
  slow: number;
  slowLeft: number;
  /** 대장이 다음에 솜씨를 부릴 때까지 남은 시간(초): 두더지는 부하를 부르고, 장수풍뎅이는 돌진을 마친다. */
  summonIn: number;
  /** 방금 맞아서 번쩍이는 남은 시간(초). 화면이 읽는다. */
  flash: number;
}

export interface Shot {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  crit: boolean;
  /** 더 뚫고 지나갈 수 있는 벌레 수 */
  pierce: number;
  /** 이미 맞힌 벌레. 같은 벌레를 두 번 맞히지 않는다. */
  hit: number[];
  /** 해바라기가 쏜 것인지. 물보라와 찬물은 물총의 물방울에만 붙는다. */
  helper: boolean;
}

export type Phase = 'fight' | 'rest' | 'over';

export interface RunState {
  /** 난수의 상태 */
  rng: number;
  startDay: number;
  /** 이 판을 시작하기 전까지 가장 멀리 지킨 날. 이 날을 넘으면 새 기록 씨앗을 받는다. */
  bestBefore: number;
  day: number;
  phase: Phase;
  /** 그날이 시작되고 흐른 시간(초) */
  dayTime: number;
  /** 다음 날이 시작될 때까지 남은 쉬는 시간(초) */
  restLeft: number;
  /** 그날 아직 나오지 않은 벌레. 나오는 차례대로다. */
  queue: Spawn[];
  /** 그날 나오는 벌레의 수(대장이 부른 부하까지)와 그 가운데 쫓아낸 수 */
  dayTotal: number;
  dayKilled: number;
  enemies: Enemy[];
  shots: Shot[];
  nextId: number;
  stats: Stats;
  fence: number;
  /** 물총과 해바라기가 다음에 쏠 때까지 남은 시간(초) */
  fireIn: number;
  helperIn: number[];
  /** 물벼락을 다시 쓸 때까지 남은 시간(초) */
  stormIn: number;
  /** 물총이 겨누는 각도(라디안. 위쪽이 -π/2)와, 직접 겨누고 있는지 */
  aim: number;
  manual: boolean;
  /** 판이 시작되고 흐른 시간(초) */
  t: number;
  kills: number;
  /** 이 판에서 번 씨앗. 소수까지 쌓고, 넣을 때 내림한다. */
  seeds: number;
  /** 이 판에서 마지막으로 지킨 날. 하루도 못 지켰으면 0 */
  lastCleared: number;
  /** 이 판에서 고른 강화. 고른 차례대로다. */
  boons: BoonId[];
  /** 지금 내놓은 강화. 비어 있지 않으면 하나를 고를 때까지 다음 날이 시작되지 않는다. */
  offer: BoonId[];
}

export interface RunConfig {
  seed: number;
  startDay: number;
  levels: Levels;
  bestBefore: number;
  /** 일군 새 밭의 수(rules.ts의 GardenMeta.fields). 물총 피해와 받는 씨앗을 늘린다. 없으면 0 */
  fields?: number;
}

export interface Input {
  /** 누르고 있는 자리(시뮬레이션 좌표). 누르고 있지 않으면 null이고 물총이 알아서 겨눈다. */
  aim: { x: number; y: number } | null;
  /** 물벼락 버튼을 눌렀는지 */
  storm: boolean;
  /** 내놓은 강화 가운데 고른 것의 자리(0부터). 고르지 않았으면 적지 않는다. */
  pick?: number;
}

export const NO_INPUT: Input = { aim: null, storm: false };

export type SimEvent =
  | { type: 'dayStart'; day: number; boss: boolean }
  | { type: 'dayClear'; day: number; seeds: number; record: boolean; mended: number }
  | { type: 'spawn'; kind: EnemyKind; x: number }
  | { type: 'fire'; helper: boolean }
  | { type: 'hit'; x: number; y: number; crit: boolean; shell: boolean }
  | { type: 'kill'; x: number; y: number; kind: EnemyKind; seeds: number }
  | { type: 'bite'; x: number; damage: number }
  | { type: 'storm' }
  | { type: 'offer'; choices: BoonId[] }
  | { type: 'boon'; id: BoonId }
  | { type: 'over' };

/** 한 프레임에 한꺼번에 살아 있을 수 있는 벌레 수. 대장이 부하를 끝없이 불러도 넘지 않는다. */
const MAX_ENEMIES = 90;

function roll(state: RunState): number {
  const next = nextRandom(state.rng);
  state.rng = next.state;
  return next.value;
}

function beginDay(state: RunState, day: number, events: SimEvent[]): void {
  state.day = day;
  state.phase = 'fight';
  state.dayTime = 0;
  state.queue = planDay(day, () => roll(state));
  state.dayTotal = state.queue.length;
  state.dayKilled = 0;
  events.push({ type: 'dayStart', day, boss: isBossDay(day) });
}

export function createRun(config: RunConfig): { state: RunState; events: SimEvent[] } {
  const stats = statsFor(config.levels, config.fields ?? 0);
  const state: RunState = {
    rng: config.seed | 0,
    startDay: config.startDay,
    bestBefore: config.bestBefore,
    day: config.startDay,
    phase: 'fight',
    dayTime: 0,
    restLeft: 0,
    queue: [],
    dayTotal: 0,
    dayKilled: 0,
    enemies: [],
    shots: [],
    nextId: 1,
    stats,
    fence: stats.fenceMax,
    fireIn: 0.4,
    helperIn: Array.from({ length: stats.helpers }, (_, index) => 0.5 + index * 0.45),
    stormIn: stats.stormCooldown > 0 ? stats.stormCooldown * 0.4 : 0,
    aim: -Math.PI / 2,
    manual: false,
    t: 0,
    kills: 0,
    seeds: 0,
    lastCleared: 0,
    boons: [],
    offer: [],
  };
  const events: SimEvent[] = [];
  beginDay(state, config.startDay, events);
  return { state, events };
}

/** 지금까지의 점수 */
export function runScore(state: RunState): number {
  return scoreFor(state.lastCleared, state.dayKilled, state.dayTotal);
}

/** 물벼락을 쓸 수 있는지 */
export function stormReady(state: RunState): boolean {
  return state.stats.stormCooldown > 0 && state.stormIn <= 0 && state.phase === 'fight';
}

function spawnEnemy(state: RunState, kind: EnemyKind, x: number, y: number, events: SimEvent[]): void {
  const def = ENEMIES[kind];
  const hp = def.hp * hpScale(state.day) * heatScale(state.day - state.startDay);
  const reach = def.gait === 'weave' ? WEAVE.reach : 0;
  const homeX = Math.min(FIELD.width - def.radius - reach, Math.max(def.radius + reach, x));
  state.enemies.push({
    id: state.nextId++,
    kind,
    x: homeX,
    y,
    homeX,
    hp,
    maxHp: hp,
    day: state.day,
    biting: false,
    biteIn: def.biteEvery * 0.6,
    // 흔들림과 뛰기의 박자가 벌레마다 어긋나게 한다.
    clock: roll(state) * (def.gait === 'weave' ? WEAVE.period : HOP.rest),
    slow: 0,
    slowLeft: 0,
    summonIn: def.skill === 'charge' ? CHARGE.every : SUMMON.every,
    flash: 0,
  });
  events.push({ type: 'spawn', kind, x: homeX });
}

/** 땅강아지가 땅속에 숨어 있는지. 숨은 동안에는 물방울도 물벼락도 닿지 않고, 아무도 겨누지 않는다. */
export function isBuried(enemy: Enemy): boolean {
  return ENEMIES[enemy.kind].gait === 'dig' && enemy.y > DIG.from && enemy.y < DIG.to;
}

/**
 * 장수풍뎅이가 돌진의 어느 때에 있는지. summonIn이 거꾸로 세는 박자에서 끝의 rush초는 내달리고,
 * 그 앞의 windup초는 멈춰서 웅크린다. 돌진하지 않는 벌레와 울타리를 갉고 있는 벌레는 늘 walk다.
 */
export function chargePhase(enemy: Enemy): 'walk' | 'windup' | 'rush' {
  if (ENEMIES[enemy.kind].skill !== 'charge' || enemy.biting) return 'walk';
  if (enemy.summonIn <= CHARGE.rush) return 'rush';
  if (enemy.summonIn <= CHARGE.rush + CHARGE.windup) return 'windup';
  return 'walk';
}

/** 걸음새가 바꾸는 빠르기의 배율(돌진하면 빨라지고 웅크리면 멈춘다) */
function gaitPace(enemy: Enemy): number {
  const phase = chargePhase(enemy);
  return phase === 'rush' ? CHARGE.speed : phase === 'windup' ? 0 : 1;
}

/** 벌레가 지금 한 초에 내려오는 거리(느려진 것까지 셈해서). 뛰는 벌레는 평균으로 친다. */
function paceOf(enemy: Enemy): number {
  if (enemy.biting) return 0;
  const slow = enemy.slowLeft > 0 ? 1 - enemy.slow : 1;
  return ENEMIES[enemy.kind].speed * slow * gaitPace(enemy);
}

function moveEnemy(state: RunState, enemy: Enemy, dt: number, events: SimEvent[]): void {
  const def = ENEMIES[enemy.kind];
  if (enemy.flash > 0) enemy.flash = Math.max(0, enemy.flash - dt);
  if (enemy.slowLeft > 0) enemy.slowLeft -= dt;
  const slow = enemy.slowLeft > 0 ? 1 - enemy.slow : 1;
  const stopY = FIELD.depth - def.radius;

  if (!enemy.biting) {
    enemy.clock += dt * slow;
    let step = def.speed * slow * gaitPace(enemy) * dt;
    if (def.gait === 'hop') {
      // 쉬는 동안에는 서 있다가, 뛰는 짧은 동안에 한 박자의 거리를 한꺼번에 간다.
      const beat = HOP.rest + HOP.leap;
      const leaping = enemy.clock % beat >= HOP.rest;
      step = leaping ? (def.speed * beat * slow * dt) / HOP.leap : 0;
    } else if (def.gait === 'weave') {
      const swing = Math.sin((enemy.clock / WEAVE.period) * Math.PI * 2) * WEAVE.reach;
      enemy.x = Math.min(FIELD.width - def.radius, Math.max(def.radius, enemy.homeX + swing));
    }
    enemy.y += step;
    if (enemy.y >= stopY) {
      enemy.y = stopY;
      enemy.biting = true;
    }
  } else {
    enemy.biteIn -= dt;
    if (enemy.biteIn <= 0) {
      enemy.biteIn += def.biteEvery;
      const damage = def.bite * biteScale(enemy.day);
      state.fence = Math.max(0, state.fence - damage);
      events.push({ type: 'bite', x: enemy.x, damage });
      if (state.stats.thorns > 0) hurt(enemy, state.stats.thorns, false);
    }
  }

  if (def.skill === 'charge') {
    // 젖어서 느려지면 웅크리고 내달리는 박자도 같이 느려진다.
    enemy.summonIn -= dt * slow;
    if (enemy.summonIn <= 0) enemy.summonIn += CHARGE.every;
  } else if (def.skill === 'summon') {
    enemy.summonIn -= dt;
    if (enemy.summonIn <= 0) {
      enemy.summonIn += SUMMON.every;
      for (let index = 0; index < SUMMON.count && state.enemies.length < MAX_ENEMIES; index += 1) {
        const side = index % 2 === 0 ? -1 : 1;
        spawnEnemy(state, SUMMON.kind, enemy.x + side * (def.radius + 10), Math.min(enemy.y, stopY - 6), events);
        state.dayTotal += 1;
      }
    }
  }
}

/** 벌레에게 피해를 준다. 껍데기가 있는 벌레는 치명타가 아니면 덜 받는다. 껍데기에 막혔으면 true */
function hurt(enemy: Enemy, amount: number, crit: boolean): boolean {
  const shell = ENEMIES[enemy.kind].shell;
  const blocked = shell !== undefined && !crit;
  enemy.hp -= blocked ? amount * shell : amount;
  enemy.flash = 0.12;
  return blocked;
}

/** 각도를 겨눌 수 있는 범위(위쪽 반원에서 양옆을 조금 뺀 것) 안으로 맞춘다. */
export function clampAim(angle: number): number {
  // 아래쪽을 가리키면 가까운 옆으로 눕힌다.
  const up = angle > 0 ? (angle > Math.PI / 2 ? -Math.PI : 0) : angle;
  return Math.min(-GUN.minLift, Math.max(-Math.PI + GUN.minLift, up));
}

/**
 * from 자리에서 쏠 때 겨눌 벌레와 겨눌 자리. 울타리에 가장 가까운(가장 아래의) 벌레를 고르고,
 * 물방울이 날아가는 동안 벌레가 내려올 만큼 앞을 겨눈다. 판 안에 들어온 벌레가 없으면 null
 */
export function autoAim(state: RunState, from: { x: number; y: number }, nearest = false): { x: number; y: number } | null {
  let target: Enemy | null = null;
  let best = Infinity;
  for (const enemy of state.enemies) {
    if (enemy.y < 0 || enemy.hp <= 0 || isBuried(enemy)) continue;
    // 물총은 울타리에 가까운 것부터, 해바라기는 제게 가까운 것부터 쏜다.
    const value = nearest ? Math.hypot(enemy.x - from.x, enemy.y - from.y) : -enemy.y;
    if (value < best) {
      best = value;
      target = enemy;
    }
  }
  if (!target) return null;
  const time = Math.hypot(target.x - from.x, target.y - from.y) / GUN.shotSpeed;
  const stopY = FIELD.depth - ENEMIES[target.kind].radius;
  return { x: target.x, y: Math.min(stopY, target.y + paceOf(target) * time) };
}

function addShot(
  state: RunState,
  from: { x: number; y: number },
  angle: number,
  damage: number,
  crit: boolean,
  helper: boolean,
): void {
  state.shots.push({
    id: state.nextId++,
    x: from.x,
    y: from.y,
    vx: Math.cos(angle) * GUN.shotSpeed,
    vy: Math.sin(angle) * GUN.shotSpeed,
    damage,
    crit,
    pierce: helper ? 0 : state.stats.pierce,
    hit: [],
    helper,
  });
}

function fireGun(state: RunState, input: Input, dt: number, events: SimEvent[]): void {
  const { stats } = state;
  const auto = input.aim ? null : autoAim(state, SHOOTER);
  const point = input.aim ?? auto;
  state.manual = input.aim !== null;
  if (point) state.aim = clampAim(Math.atan2(point.y - SHOOTER.y, point.x - SHOOTER.x));
  state.fireIn -= dt;
  // 겨눌 것이 없으면 쏘지 않고 기다린다. 직접 겨누는 동안에는 벌레가 없어도 쏜다.
  if (!point) {
    state.fireIn = Math.max(state.fireIn, 0);
    return;
  }
  if (state.fireIn > 0) return;
  state.fireIn += stats.interval * (state.manual ? GUN.manualRate : 1);
  if (state.fireIn < 0) state.fireIn = 0;
  const crit = stats.critChance > 0 && roll(state) < stats.critChance;
  for (let stream = 0; stream < stats.streams; stream += 1) {
    // 가운데 줄기 하나에, 곁가지가 좌우로 번갈아 벌어진다.
    const order = Math.ceil(stream / 2) * (stream % 2 === 0 ? 1 : -1);
    const side = stream > 0;
    const damage = stats.damage * (side ? GUN.forkDamage : 1) * (crit ? GUN.critMult : 1);
    addShot(state, SHOOTER, state.aim + order * GUN.forkAngle, damage, crit, false);
  }
  events.push({ type: 'fire', helper: false });
}

function fireHelpers(state: RunState, dt: number, events: SimEvent[]): void {
  for (let index = 0; index < state.helperIn.length; index += 1) {
    state.helperIn[index] -= dt;
    if (state.helperIn[index] > 0) continue;
    const spot = HELPER_SPOTS[index];
    const point = autoAim(state, spot, true);
    if (!point) {
      state.helperIn[index] = 0;
      continue;
    }
    state.helperIn[index] += HELPER_INTERVAL;
    addShot(state, spot, clampAim(Math.atan2(point.y - spot.y, point.x - spot.x)), state.stats.helperDamage, false, true);
    events.push({ type: 'fire', helper: true });
  }
}

function castStorm(state: RunState, events: SimEvent[]): void {
  state.stormIn = state.stats.stormCooldown;
  for (const enemy of state.enemies) {
    if (enemy.y < -ENEMIES[enemy.kind].radius || isBuried(enemy)) continue;
    hurt(enemy, state.stats.stormDamage, true);
    // 대장은 덩치가 커서 반만 느려진다.
    const slow = ENEMIES[enemy.kind].boss ? STORM.slow / 2 : STORM.slow;
    if (enemy.slowLeft <= 0 || slow >= enemy.slow) enemy.slow = slow;
    enemy.slowLeft = Math.max(enemy.slowLeft, STORM.slowSeconds);
  }
  events.push({ type: 'storm' });
}

function moveShots(state: RunState, dt: number, events: SimEvent[]): void {
  const { stats } = state;
  const kept: Shot[] = [];
  for (const shot of state.shots) {
    shot.x += shot.vx * dt;
    shot.y += shot.vy * dt;
    let spent = false;
    for (const enemy of state.enemies) {
      if (enemy.hp <= 0 || shot.hit.includes(enemy.id) || isBuried(enemy)) continue;
      const reach = ENEMIES[enemy.kind].radius + GUN.shotRadius;
      if (Math.hypot(enemy.x - shot.x, enemy.y - shot.y) > reach) continue;
      const shell = hurt(enemy, shot.damage, shot.crit);
      events.push({ type: 'hit', x: shot.x, y: shot.y, crit: shot.crit, shell });
      if (!shot.helper) {
        if (stats.chill > 0) {
          const slow = ENEMIES[enemy.kind].boss ? stats.chill / 2 : stats.chill;
          if (enemy.slowLeft <= 0 || slow >= enemy.slow) enemy.slow = slow;
          enemy.slowLeft = Math.max(enemy.slowLeft, stats.chillSeconds);
        }
        if (stats.splashRadius > 0) {
          for (const other of state.enemies) {
            if (other === enemy || other.hp <= 0 || isBuried(other)) continue;
            const span = stats.splashRadius + ENEMIES[other.kind].radius;
            if (Math.hypot(other.x - shot.x, other.y - shot.y) <= span) hurt(other, shot.damage * stats.splashRatio, false);
          }
        }
      }
      shot.hit.push(enemy.id);
      if (shot.pierce <= 0) {
        spent = true;
        break;
      }
      shot.pierce -= 1;
    }
    const outside = shot.y < -24 || shot.x < -12 || shot.x > FIELD.width + 12 || shot.y > SHOOTER.y + 8;
    if (!spent && !outside) kept.push(shot);
  }
  state.shots = kept;
}

function sweep(state: RunState, events: SimEvent[]): void {
  if (!state.enemies.some((enemy) => enemy.hp <= 0)) return;
  const alive: Enemy[] = [];
  for (const enemy of state.enemies) {
    if (enemy.hp > 0) {
      alive.push(enemy);
      continue;
    }
    const seeds = ENEMIES[enemy.kind].seeds * seedScale(enemy.day) * state.stats.seedMult;
    state.kills += 1;
    state.dayKilled += 1;
    state.seeds += seeds;
    events.push({ type: 'kill', x: enemy.x, y: enemy.y, kind: enemy.kind, seeds });
  }
  state.enemies = alive;
}

/** 판을 dt초만큼 나아가게 하고, 그동안 일어난 일을 돌려준다. */
export function step(state: RunState, dt: number, input: Input = NO_INPUT): SimEvent[] {
  const events: SimEvent[] = [];
  if (state.phase === 'over') return events;
  state.t += dt;

  if (state.offer.length > 0 && input.pick !== undefined) {
    const id = state.offer[input.pick];
    if (id !== undefined) {
      applyBoon(state, id);
      state.offer = [];
      state.restLeft = Math.min(state.restLeft, DAY.afterPick);
      events.push({ type: 'boon', id });
    }
  }

  if (state.phase === 'rest') {
    // 내놓은 강화를 고를 때까지는 다음 날이 시작되지 않는다. 날아가던 물방울은 그대로 움직인다.
    if (state.offer.length === 0) {
      state.restLeft -= dt;
      if (state.restLeft <= 0) beginDay(state, state.day + 1, events);
    }
  } else {
    state.dayTime += dt;
    // 판이 비어 있으면 다음 벌레를 당겨서, 금방 쫓아내는 날은 금방 지나가게 한다.
    if (state.enemies.length === 0 && state.queue.length > 0 && state.queue[0].at - state.dayTime > DAY.hurry) {
      state.dayTime = state.queue[0].at - DAY.hurry;
    }
    while (state.queue.length > 0 && state.queue[0].at <= state.dayTime) {
      const spawn = state.queue.shift() as Spawn;
      spawnEnemy(state, spawn.kind, spawn.x, FIELD.spawnY, events);
    }
  }

  // 부르는 부하가 목록 끝에 붙으므로, 이번 프레임에 있던 벌레까지만 움직인다.
  const present = state.enemies.length;
  for (let index = 0; index < present; index += 1) moveEnemy(state, state.enemies[index], dt, events);

  if (state.stormIn > 0) state.stormIn -= dt;
  if (input.storm && stormReady(state)) castStorm(state, events);
  fireGun(state, input, dt, events);
  fireHelpers(state, dt, events);
  moveShots(state, dt, events);
  sweep(state, events);

  if (state.fence <= 0) {
    state.phase = 'over';
    events.push({ type: 'over' });
    return events;
  }
  if (state.phase === 'fight' && state.queue.length === 0 && state.enemies.length === 0) {
    const record = state.day > state.bestBefore;
    const seeds = (clearBonus(state.day) + (record ? recordBonus(state.day) : 0)) * state.stats.seedMult;
    const before = state.fence;
    state.fence = Math.min(state.stats.fenceMax, state.fence + state.stats.fenceMax * state.stats.mend);
    state.seeds += seeds;
    state.lastCleared = state.day;
    state.phase = 'rest';
    state.restLeft = DAY.rest;
    events.push({ type: 'dayClear', day: state.day, seeds, record, mended: state.fence - before });
    state.offer = drawOffer(state);
    if (state.offer.length > 0) events.push({ type: 'offer', choices: [...state.offer] });
  }
  return events;
}
