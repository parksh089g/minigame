/**
 * 텃밭 지키기의 규칙: 날마다의 난이도, 강화가 바꾸는 능력치, 강화의 값, 점수와 씨앗, 판 밖 진행(순수 함수).
 * 화면도 저장소도 모른다. 숫자는 data.ts에 있다.
 */
import {
  BOSS_EVERY,
  COMMON_KINDS,
  DAY,
  ENEMIES,
  FENCE_BASE,
  FIELD,
  GUN,
  STEP,
  UPGRADE_ORDER,
  UPGRADES,
  type EnemyKind,
  type UpgradeId,
} from './data';

export type Levels = Partial<Record<UpgradeId, number>>;

export function levelOf(levels: Levels, id: UpgradeId): number {
  const level = levels[id];
  return typeof level === 'number' && level > 0 ? Math.min(Math.floor(level), UPGRADES[id].maxLevel) : 0;
}

// ------------------------------------------------------------ 난수

/** 씨앗에서 늘 같은 차례로 나오는 난수. 상태(정수 하나)를 판에 적어 두고 이어 쓴다. */
export function nextRandom(state: number): { value: number; state: number } {
  const next = (state + 0x6d2b79f5) | 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, state: next };
}

// ------------------------------------------------------------ 날마다의 난이도

/**
 * 벌레의 체력이 하루에 불어나는 배율. LATE_FROM일째 뒤로는 HP_GROWTH_LATE로 늦춘다.
 * 강화 값은 단계마다 곱으로 오르는데 한 판에 버는 씨앗은 날 수만큼만 늘어서, 뒤로 갈수록 같은 판을 되풀이해야 넘는
 * 벽이 생긴다. 자동 플레이로 재 보니 늘 1.115배면 40일째 근처에서 같은 판을 30번쯤 되풀이해야 했다.
 */
export const HP_GROWTH = 1.115;
export const HP_GROWTH_LATE = 1.075;
export const LATE_FROM = 20;

/** 그날 벌레의 체력에 곱하는 배율. 날마다 불어나서 강화 없이는 어느 날엔가 막힌다. */
export function hpScale(day: number): number {
  const d = Math.max(1, day);
  if (d <= LATE_FROM) return HP_GROWTH ** (d - 1);
  return HP_GROWTH ** (LATE_FROM - 1) * HP_GROWTH_LATE ** (d - LATE_FROM);
}

/** 그날 벌레가 울타리를 갉는 피해에 곱하는 배율 */
export function biteScale(day: number): number {
  return 1 + 0.08 * (Math.max(1, day) - 1);
}

/** 그날 받는 씨앗에 곱하는 배율. 멀리 갈수록 한 마리가 더 많이 준다. */
export function seedScale(day: number): number {
  return 1 + 0.05 * (Math.max(1, day) - 1);
}

export function isBossDay(day: number): boolean {
  return day > 0 && day % BOSS_EVERY === 0;
}

/**
 * 그날 나오는 대장의 수. 대장의 날마다 하나다.
 * 대장을 둘, 셋으로 늘리면 그날만 갑자기 두 배가 되어서 그 앞에서 오래 막혔다. 세지는 것은 체력의 배율에 맡긴다.
 */
export function bossCount(day: number): number {
  return isBossDay(day) ? 1 : 0;
}

/** 그날 나오는 여느 벌레의 수(대장과 대장이 부르는 부하 빼고) */
export function dayCount(day: number): number {
  const { first, perDay, max } = DAY.count;
  const count = Math.min(max, Math.round(first + perDay * (Math.max(1, day) - 1)));
  return isBossDay(day) ? Math.round(count * DAY.bossEscort) : count;
}

/** 그날 벌레가 다 나오기까지의 시간(초) */
export function dayWindow(day: number): number {
  const { first, perDay, max } = DAY.window;
  return Math.min(max, first + perDay * (Math.max(1, day) - 1));
}

/** 그날 그 벌레가 섞이는 비중. 아직 나오지 않는 날이면 0 */
export function kindWeight(kind: EnemyKind, day: number): number {
  const def = ENEMIES[kind];
  if (def.boss || day < def.fromDay) return 0;
  return Math.min(def.weight.max, def.weight.first + def.weight.step * (day - def.fromDay));
}

/** 판에 나올 벌레 하나: 그날이 시작되고 at초 뒤에 x 자리 위에서 나타난다. */
export interface Spawn {
  at: number;
  kind: EnemyKind;
  x: number;
}

/**
 * 그날 나올 벌레를 나오는 차례대로 정한다. random은 0 이상 1 미만의 수를 돌려주는 함수다.
 * 나오는 때는 시간을 고르게 나눈 칸 안에서 흔들어서, 몰려 나오기도 하지만 한꺼번에 다 나오지는 않는다.
 * 대장은 날이 시작되고 곧 가운데에서 나온다.
 */
export function planDay(day: number, random: () => number): Spawn[] {
  const count = dayCount(day);
  const window = dayWindow(day);
  const weights = COMMON_KINDS.map((kind) => kindWeight(kind, day));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const spawns: Spawn[] = [];
  for (let index = 0; index < count; index += 1) {
    let roll = random() * total;
    let kind: EnemyKind = COMMON_KINDS[0];
    for (let pick = 0; pick < COMMON_KINDS.length; pick += 1) {
      roll -= weights[pick];
      if (roll < 0) {
        kind = COMMON_KINDS[pick];
        break;
      }
    }
    spawns.push({
      at: ((index + random()) / count) * window,
      kind,
      x: FIELD.margin + random() * (FIELD.width - FIELD.margin * 2),
    });
  }
  const bosses = bossCount(day);
  for (let index = 0; index < bosses; index += 1) {
    spawns.push({ at: 1.5 + index * 6, kind: 'mole', x: (FIELD.width * (index + 1)) / (bosses + 1) });
  }
  return spawns.sort((a, b) => a.at - b.at);
}

// ------------------------------------------------------------ 능력치

/** 강화를 반영한 한 판의 능력치 */
export interface Stats {
  damage: number;
  /** 쏘는 간격(초). 직접 겨누는 동안에는 GUN.manualRate가 더 곱해진다. */
  interval: number;
  critChance: number;
  /** 물방울 하나가 뚫고 지나가는 벌레 수(0이면 처음 맞은 벌레에서 사라진다) */
  pierce: number;
  /** 한 번에 쏘는 물방울 수(1이면 한 줄기) */
  streams: number;
  /** 물보라가 튀는 반지름과 피해 비율. 없으면 둘 다 0 */
  splashRadius: number;
  splashRatio: number;
  /** 찬물이 느리게 하는 정도(0~1)와 시간(초) */
  chill: number;
  chillSeconds: number;
  fenceMax: number;
  /** 날이 바뀔 때 울타리를 고치는 비율(0~1) */
  mend: number;
  /** 울타리를 갉은 벌레가 받는 피해 */
  thorns: number;
  /** 받는 씨앗에 곱하는 배율 */
  seedMult: number;
  helpers: number;
  helperDamage: number;
  /** 물벼락을 다시 쓸 때까지의 시간(초). 아직 배우지 않았으면 0 */
  stormCooldown: number;
  stormDamage: number;
}

export function statsFor(levels: Levels): Stats {
  const level = (id: UpgradeId): number => levelOf(levels, id);
  const damage = Math.round(GUN.damage * STEP.power ** level('power'));
  const splash = level('splash');
  const chill = level('chill');
  const storm = level('storm');
  return {
    damage,
    interval: GUN.interval * STEP.rapid ** level('rapid'),
    critChance: STEP.crit * level('crit'),
    pierce: level('pierce'),
    streams: 1 + level('fork'),
    splashRadius: splash > 0 ? STEP.splash.radius + STEP.splash.radiusStep * splash : 0,
    splashRatio: splash > 0 ? STEP.splash.ratio + STEP.splash.ratioStep * splash : 0,
    chill: chill > 0 ? STEP.chill.slow + STEP.chill.slowStep * chill : 0,
    chillSeconds: chill > 0 ? STEP.chill.seconds : 0,
    fenceMax: FENCE_BASE + STEP.fence * level('fence'),
    mend: STEP.mend.base + STEP.mend.step * level('mend'),
    thorns: damage * STEP.thorn * level('thorn'),
    seedMult: 1 + STEP.harvest * level('harvest'),
    helpers: level('helper'),
    helperDamage: damage * (STEP.compost.base + STEP.compost.step * level('compost')),
    stormCooldown: storm > 0 ? STEP.storm.cooldown - STEP.storm.cooldownStep * (storm - 1) : 0,
    stormDamage: storm > 0 ? damage * (STEP.storm.damage + STEP.storm.damageStep * (storm - 1)) : 0,
  };
}

const percent = (ratio: number): string => `${Math.round(ratio * 100)}%`;
const tenth = (value: number): string => (Math.round(value * 10) / 10).toFixed(1);

/** 그 단계에서 강화가 주는 값을 짧게 적는다(앞에 붙는 말과 값). 값이 없는 단계는 "없음"이다. */
function effectParts(id: UpgradeId, level: number): readonly [label: string, value: string] {
  const stats = statsFor({ [id]: level });
  const none = level <= 0;
  switch (id) {
    case 'power':
      return ['피해', `${stats.damage}`];
    case 'rapid':
      return ['1초에', `${tenth(1 / stats.interval)}발`];
    case 'fence':
      return ['체력', `${stats.fenceMax}`];
    case 'mend':
      return ['고침', percent(stats.mend)];
    case 'crit':
      return ['확률', percent(stats.critChance)];
    case 'splash':
      return ['둘레', none ? '없음' : percent(stats.splashRatio)];
    case 'chill':
      return ['느리게', none ? '없음' : percent(stats.chill)];
    case 'thorn':
      return ['물총의', percent(STEP.thorn * level)];
    case 'harvest':
      return ['씨앗', percent(stats.seedMult)];
    case 'helper':
      return ['', `${stats.helpers}송이`];
    case 'compost':
      return ['피해의', percent(STEP.compost.base + STEP.compost.step * level)];
    case 'pierce':
      return ['', none ? '없음' : `${stats.pierce}마리 뚫음`];
    case 'fork':
      return ['', `${stats.streams}갈래`];
    case 'storm':
      return ['', none ? '없음' : `${stats.stormCooldown}초마다`];
  }
}

/**
 * 준비 화면의 목록에서 이름 아래에 적는 한 줄: 지금 값과 한 단계 올렸을 때의 값("피해 20 → 21").
 * 다 올린 강화는 지금 값만 적는다.
 */
export function effectLine(id: UpgradeId, level: number): string {
  const [label, now] = effectParts(id, level);
  const head = label ? `${label} ` : '';
  if (level >= UPGRADES[id].maxLevel) return `${head}${now}`;
  return `${head}${now} → ${effectParts(id, level + 1)[1]}`;
}

// ------------------------------------------------------------ 강화의 값

/** 지금 level 단계인 강화를 한 단계 올리는 값. 다 올렸으면 null */
export function upgradeCost(id: UpgradeId, level: number): number | null {
  const def = UPGRADES[id];
  if (level >= def.maxLevel) return null;
  return Math.round(def.cost * def.growth ** level);
}

// ------------------------------------------------------------ 점수

/**
 * 한 판의 점수. 지킨 날마다 100점이고, 무너진 날에 쫓아낸 만큼(0~99점)을 더한다.
 * lastCleared는 이 판에서 마지막으로 지킨 날(몇째 날인지)이고, 하루도 못 지켰으면 0이다.
 * 뒤쪽 날부터 시작한 판도 그날을 지켜 내야 그날의 점수를 받는다.
 */
export function scoreFor(lastCleared: number, dayKilled: number, dayTotal: number): number {
  const partial = dayTotal > 0 ? Math.min(99, Math.floor((dayKilled / dayTotal) * 100)) : 0;
  return Math.max(0, lastCleared) * 100 + partial;
}

/** 허브 카드의 기록 줄. 점수에서 지킨 날을 꺼내 "최고 9일째"로 적고, 하루도 못 지켰으면 점수를 적는다. */
export function recordLabel(best: number): string {
  const days = Math.floor(Math.max(0, best) / 100);
  return days > 0 ? `최고 ${days}일째` : `최고 ${Math.max(0, Math.floor(best))}`;
}

/** 점수에 따라 주는 허브 코인. 지킨 날 하나에 하나씩, 한 판에 30개까지 */
export function coinsFor(score: number): number {
  return Math.min(30, Math.floor(score / 100));
}

/** 그날을 지켰을 때 받는 씨앗 */
export function clearBonus(day: number): number {
  return 2 + day;
}

/** 지금까지 가장 멀리 지킨 날을 넘어섰을 때 한 번 더 받는 씨앗. 대장의 날이면 세 배다. */
export function recordBonus(day: number): number {
  return clearBonus(day) * (isBossDay(day) ? 3 : 1);
}

// ------------------------------------------------------------ 판 밖 진행

/** 2: 새 출발점이 열리면 시작하는 날을 저절로 그리로 옮긴다. 1의 저장은 읽을 때 가장 늦은 출발점으로 맞춘다. */
export const META_VERSION = 2;

export interface GardenMeta {
  version: number;
  /** 가진 씨앗 */
  seeds: number;
  levels: Levels;
  /** 가장 멀리 지킨 날. 하루도 못 지켰으면 0 */
  best: number;
  /** 마친 판 수 */
  runs: number;
  /** 쫓아낸 벌레 수 */
  kills: number;
  /** 준비 화면에서 고른 시작하는 날 */
  startDay: number;
  /** 저장한 때(ms). 같은 기기의 다른 곳이 더 늦게 저장한 것을 가리는 데 쓴다. */
  savedAt: number;
}

export function createMeta(): GardenMeta {
  return { version: META_VERSION, seeds: 0, levels: {}, best: 0, runs: 0, kills: 0, startDay: 1, savedAt: 0 };
}

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

/**
 * 시작할 수 있는 날들. 첫날과, 물리친 대장의 다음 날들이다(6일째, 11일째, ...).
 * best는 가장 멀리 지킨 날이다.
 */
export function startDays(best: number): number[] {
  const days = [1];
  for (let boss = BOSS_EVERY; boss <= best; boss += BOSS_EVERY) days.push(boss + 1);
  return days;
}

/** 고른 시작 날이 열려 있지 않으면 열린 날 가운데 그보다 앞선 가장 늦은 날로 맞춘다. */
export function clampStartDay(day: number, best: number): number {
  const days = startDays(best);
  let picked = days[0];
  for (const open of days) if (open <= day) picked = open;
  return picked;
}

/** 저장된 값을 믿을 수 있는 모양으로 맞춘다. 모르는 항목은 버리고 빠진 항목은 기본값으로 채운다. */
export function normalizeMeta(raw: unknown): GardenMeta {
  const meta = createMeta();
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return meta;
  const data = raw as Record<string, unknown>;
  meta.seeds = count(data.seeds);
  meta.best = count(data.best);
  meta.runs = count(data.runs);
  meta.kills = count(data.kills);
  meta.savedAt = count(data.savedAt);
  const levels = typeof data.levels === 'object' && data.levels !== null ? (data.levels as Record<string, unknown>) : {};
  for (const id of UPGRADE_ORDER) {
    const level = Math.min(count(levels[id]), UPGRADES[id].maxLevel);
    if (level > 0) meta.levels[id] = level;
  }
  // 버전 1에서는 출발점이 열려도 시작하는 날이 그대로여서, 고르지 않은 사람은 늘 1일째부터 했다. 가장 늦은 출발점으로 옮긴다.
  const fromV1 = count(data.version) < 2;
  meta.startDay = fromV1 ? latestStart(meta.best) : clampStartDay(count(data.startDay) || 1, meta.best);
  return meta;
}

/** 지금 시작할 수 있는 가장 늦은 날 */
export function latestStart(best: number): number {
  const days = startDays(best);
  return days[days.length - 1];
}

/**
 * 가장 멀리 지킨 날을 올린다. 그래서 새 출발점(물리친 대장의 다음 날)이 열렸으면 시작하는 날도 그리로 옮긴다.
 * 더 앞에서 하고 싶은 사람은 준비 화면에서 다시 고르면 된다. 올라가지 않았으면 그대로 돌려준다.
 */
export function raiseBest(meta: GardenMeta, day: number): GardenMeta {
  const cleared = count(day);
  if (cleared <= meta.best) return meta;
  const opened = latestStart(cleared) > latestStart(meta.best);
  return { ...meta, best: cleared, startDay: opened ? latestStart(cleared) : meta.startDay };
}

/** 앞의 저장(before)과 견주어 새 출발점이 열렸으면 그 날을, 아니면 null을 준다. */
export function openedStart(before: GardenMeta, after: GardenMeta): number | null {
  const day = latestStart(after.best);
  return day > latestStart(before.best) ? day : null;
}

/** 강화를 한 단계 산다. 씨앗이 모자라거나 다 올렸으면 그대로 돌려준다. */
export function buyUpgrade(meta: GardenMeta, id: UpgradeId): GardenMeta {
  const level = levelOf(meta.levels, id);
  const cost = upgradeCost(id, level);
  if (cost === null || meta.seeds < cost) return meta;
  return { ...meta, seeds: meta.seeds - cost, levels: { ...meta.levels, [id]: level + 1 } };
}

/** 지금 살 수 있는 강화가 하나라도 있는지 */
export function canBuyAny(meta: GardenMeta): boolean {
  return UPGRADE_ORDER.some((id) => {
    const cost = upgradeCost(id, levelOf(meta.levels, id));
    return cost !== null && meta.seeds >= cost;
  });
}

/** 판에서 번 씨앗을 넣는다. 판이 끝나기 전에도(날을 넘길 때마다) 넣어 둘 수 있다. */
export function bankSeeds(meta: GardenMeta, seeds: number): GardenMeta {
  const gained = count(seeds);
  return gained > 0 ? { ...meta, seeds: meta.seeds + gained } : meta;
}

/** 한 판을 마친 기록을 넣는다. lastCleared는 그 판에서 마지막으로 지킨 날(없으면 0)이다. */
export function applyRun(meta: GardenMeta, lastCleared: number, kills: number): GardenMeta {
  return raiseBest({ ...meta, runs: meta.runs + 1, kills: meta.kills + count(kills) }, lastCleared);
}
