/**
 * 텃밭 지키기의 규칙: 날마다의 난이도, 강화가 바꾸는 능력치, 강화의 값, 점수와 씨앗, 판 밖 진행(순수 함수).
 * 화면도 저장소도 모른다. 숫자는 data.ts에 있다.
 */
import {
  BOSS_EVERY,
  BOSS_ROTATION,
  COMMON_KINDS,
  DAY,
  ENEMIES,
  FENCE_BASE,
  FIELD,
  GUN,
  RELIC_ORDER,
  RELIC_STEP,
  RELICS,
  SHARDS,
  STEP,
  SWARM,
  UPGRADE_ORDER,
  UPGRADES,
  type EnemyKind,
  type RelicId,
  type UpgradeId,
} from './data';

export type Levels = Partial<Record<UpgradeId, number>>;

export function levelOf(levels: Levels, id: UpgradeId): number {
  const level = levels[id];
  return typeof level === 'number' && level > 0 ? Math.min(Math.floor(level), UPGRADES[id].maxLevel) : 0;
}

/** 유물마다의 단계 */
export type RelicLevels = Partial<Record<RelicId, number>>;

export function relicLevel(relics: RelicLevels, id: RelicId): number {
  const level = relics[id];
  return typeof level === 'number' && level > 0 ? Math.min(Math.floor(level), RELICS[id].maxLevel) : 0;
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

/** 그날 나오는 대장. 대장의 날마다 BOSS_ROTATION을 차례로 돈다(5일째 두더지, 10일째 장수풍뎅이, ...). 대장의 날이 아니면 null */
export function bossKind(day: number): EnemyKind | null {
  if (!isBossDay(day)) return null;
  return BOSS_ROTATION[(day / BOSS_EVERY - 1) % BOSS_ROTATION.length];
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
 * 떼로 오는 벌레(모기)는 한 번 뽑히면 그 수만큼의 칸을 쓰고, 한자리에 붙어서 거의 한꺼번에 나온다.
 * 그래서 그날 나오는 벌레의 수는 떼가 섞여도 dayCount와 같다. 대장은 날이 시작되고 곧 가운데에서 나온다.
 */
export function planDay(day: number, random: () => number): Spawn[] {
  const count = dayCount(day);
  const window = dayWindow(day);
  const weights = COMMON_KINDS.map((kind) => kindWeight(kind, day));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const spawns: Spawn[] = [];
  let index = 0;
  while (index < count) {
    let roll = random() * total;
    let kind: EnemyKind = COMMON_KINDS[0];
    for (let pick = 0; pick < COMMON_KINDS.length; pick += 1) {
      roll -= weights[pick];
      if (roll < 0) {
        kind = COMMON_KINDS[pick];
        break;
      }
    }
    const at = ((index + random()) / count) * window;
    const x = FIELD.margin + random() * (FIELD.width - FIELD.margin * 2);
    const group = Math.min(ENEMIES[kind].swarm ?? 1, count - index);
    for (let member = 0; member < group; member += 1) {
      // 가운데에서 좌우로 번갈아 벌어지게 놓되, 판 안쪽을 벗어나지 않게 한다.
      const offset = Math.ceil(member / 2) * (member % 2 === 0 ? 1 : -1) * SWARM.spread;
      spawns.push({
        at: Math.min(window, at + member * SWARM.stagger),
        kind,
        x: Math.min(FIELD.width - FIELD.margin, Math.max(FIELD.margin, x + offset)),
      });
    }
    index += group;
  }
  const boss = bossKind(day);
  const bosses = bossCount(day);
  for (let index = 0; boss && index < bosses; index += 1) {
    spawns.push({ at: 1.5 + index * 6, kind: boss, x: (FIELD.width * (index + 1)) / (bosses + 1) });
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
  /** 동료의 피해에 곱하는 배율(동료 거름) */
  allyPower: number;
  /** 물벼락을 다시 쓸 때까지의 시간(초). 아직 배우지 않았으면 0 */
  stormCooldown: number;
  stormDamage: number;
  // 아래는 유물이 바꾸는 값이다. 유물이 없으면 아무것도 바꾸지 않는 값(배율은 1, 막는 수는 0)이다.
  /** 치명타의 피해 배율 */
  critMult: number;
  /** 대장에게 주는 피해에 곱하는 배율 */
  bossDamage: number;
  /** 아직 안 다친(체력이 가득한) 벌레에게 주는 피해에 곱하는 배율 */
  freshDamage: number;
  /** 벌레가 다가오는 빠르기에 곱하는 배율 */
  pace: number;
  /** 날마다 울타리가 그냥 막아 내는 갉기의 수 */
  guard: number;
  /** 날을 지켰을 때 받는 씨앗에 곱하는 배율 */
  clearSeeds: number;
}

/**
 * 강화를 반영한 능력치. fields는 지금까지 일군 새 밭의 수로, 물총 피해와 받는 씨앗을 늘린다(처음 밭이면 0).
 * relics는 유물마다의 단계다. 유물은 영구 강화가 건드리지 않는 값만 바꾼다.
 */
export function statsFor(levels: Levels, fields = 0, relics: RelicLevels = {}): Stats {
  const level = (id: UpgradeId): number => levelOf(levels, id);
  const relic = (id: RelicId): number => relicLevel(relics, id);
  const damage = Math.round(GUN.damage * STEP.power ** level('power') * fieldDamage(fields));
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
    seedMult: (1 + STEP.harvest * level('harvest')) * fieldSeeds(fields),
    allyPower: 1 + STEP.compost * level('compost'),
    stormCooldown: storm > 0 ? STEP.storm.cooldown - STEP.storm.cooldownStep * (storm - 1) : 0,
    stormDamage: storm > 0 ? damage * (STEP.storm.damage + STEP.storm.damageStep * (storm - 1)) : 0,
    critMult: GUN.critMult * (1 + RELIC_STEP.clover * relic('clover')),
    bossDamage: 1 + RELIC_STEP.claw * relic('claw'),
    freshDamage: 1 + RELIC_STEP.dew * relic('dew'),
    pace: 1 - RELIC_STEP.scarecrow * relic('scarecrow'),
    guard: RELIC_STEP.bell * relic('bell'),
    clearSeeds: 1 + RELIC_STEP.calendar * relic('calendar'),
  };
}

const percent = (ratio: number): string => `${Math.round(ratio * 100)}%`;
const tenth = (value: number): string => (Math.round(value * 10) / 10).toFixed(1);

/** 그 단계에서 강화가 주는 값을 짧게 적는다(앞에 붙는 말과 값). 값이 없는 단계는 "없음"이다. */
function effectParts(id: UpgradeId, level: number, fields: number): readonly [label: string, value: string] {
  const stats = statsFor({ [id]: level }, fields);
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
      return ['', none ? '없음' : `해바라기 ★${level}`];
    case 'compost':
      return ['동료 피해', percent(stats.allyPower)];
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
 * 다 올린 강화는 지금 값만 적는다. fields(일군 새 밭의 수)가 늘린 피해와 씨앗도 넣어서 적는다.
 */
export function effectLine(id: UpgradeId, level: number, fields = 0): string {
  const [label, now] = effectParts(id, level, fields);
  const head = label ? `${label} ` : '';
  if (level >= UPGRADES[id].maxLevel) return `${head}${now}`;
  return `${head}${now} → ${effectParts(id, level + 1, fields)[1]}`;
}

// ------------------------------------------------------------ 강화의 값

/** 지금 level 단계인 강화를 한 단계 올리는 값. 다 올렸으면 null */
export function upgradeCost(id: UpgradeId, level: number): number | null {
  const def = UPGRADES[id];
  if (level >= def.maxLevel) return null;
  return Math.round(def.cost * def.growth ** level);
}

/**
 * 값 버튼에 적는 씨앗의 수. 여섯 자리까지는 그대로 적고, 그보다 크면 버튼에 들어가게 만과 억으로 줄인다.
 * 줄일 때는 올려서 적는다: 적힌 만큼 모으면 반드시 살 수 있다.
 */
export function costLabel(cost: number): string {
  if (cost < 1_000_000) return String(cost);
  const man = Math.ceil(cost / 10_000);
  if (man < 10_000) return `${man}만`;
  const tenths = Math.ceil(cost / 10_000_000);
  return tenths < 1_000 ? `${tenths / 10}억` : `${Math.ceil(tenths / 10)}억`;
}

/**
 * 이 강화를 사려면 먼저 있어야 하는데 아직 없는 강화. 없으면(살 수 있으면) null.
 * 지금은 그런 강화가 없지만, 앞으로 생길 때를 위해 남겨 둔다.
 */
export function neededFor(levels: Levels, id: UpgradeId): UpgradeId | null {
  const needs = UPGRADES[id].needs;
  return needs !== undefined && levelOf(levels, needs) === 0 ? needs : null;
}

/** 먼저 있어야 하는 강화가 없을 때 준비 화면에서 효과 대신 적는 말("해바라기가 있어야 해요") */
export function needLine(needs: UpgradeId): string {
  const name = UPGRADES[needs].name;
  // 받침이 없는 글자로 끝나면 "가", 있으면 "이"
  const open = (name.charCodeAt(name.length - 1) - 0xac00) % 28 === 0;
  return `${name}${open ? '가' : '이'} 있어야 해요`;
}

// ------------------------------------------------------------ 점수

/**
 * 이 판에서 지킨 날의 수. startDay는 판을 시작한 날이고, lastCleared는 이 판에서 마지막으로 지킨 날(몇째 날인지)이며
 * 하루도 못 지켰으면 0이다. 31일째에서 시작해 33일째까지 지켰으면 사흘이다.
 */
export function daysKept(startDay: number, lastCleared: number): number {
  return lastCleared >= startDay ? lastCleared - Math.max(1, startDay) + 1 : 0;
}

/**
 * 한 판의 점수. 이 판에서 지킨 날마다 100점이고, 무너진 날에 쫓아낸 만큼(0~99점)을 더한다.
 * 몇째 날까지 갔는지가 아니라 이 판에서 며칠을 지켰는지를 센다. 뒤쪽 날에서 시작해 하루만 지킨 판은 100점이다.
 * kept는 daysKept()의 값이다.
 */
export function scoreFor(kept: number, dayKilled: number, dayTotal: number): number {
  const partial = dayTotal > 0 ? Math.min(99, Math.floor((dayKilled / dayTotal) * 100)) : 0;
  return Math.max(0, kept) * 100 + partial;
}

/** 허브 카드의 기록 줄. 점수에서 지킨 날 수를 꺼내 "한 판에 9일"로 적고, 하루도 못 지켰으면 점수를 적는다. */
export function recordLabel(best: number): string {
  const days = Math.floor(Math.max(0, best) / 100);
  return days > 0 ? `한 판에 ${days}일` : `최고 ${Math.max(0, Math.floor(best))}`;
}

/** 점수에 따라 주는 허브 코인. 이 판에서 지킨 날 하나에 하나씩, 한 판에 30개까지 */
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

/**
 * 2: 새 출발점이 열리면 시작하는 날을 저절로 그리로 옮긴다. 1의 저장은 읽을 때 가장 늦은 출발점으로 맞춘다.
 * 3: 새 밭 일구기(fields, bestEver)가 생겼다. 2까지의 저장은 아직 새 밭을 일구지 않은 처음 밭이다.
 * 4: 유물(shards, relics)이 생겼다. 3까지의 저장은 그동안 물리친 대장만큼의 유물 조각을 받고 시작한다.
 */
export const META_VERSION = 4;
/**
 * 저장에서 읽는 "가장 멀리 지킨 날"의 위쪽 한도. 실제 판에서는 닿지 않는 날이다(강화를 다 올려도 70일째 근처에서 막힌다).
 * 시작할 수 있는 날을 이 날까지 세어 올라가므로, 터무니없이 큰 값이 적힌 망가진 저장이 준비 화면을 멈추지 않게 자른다.
 */
export const MAX_DAY = 9_999;

export interface GardenMeta {
  version: number;
  /** 가진 씨앗 */
  seeds: number;
  levels: Levels;
  /** 지금 밭에서 가장 멀리 지킨 날. 하루도 못 지켰으면 0. 새 밭을 일구면 0으로 돌아간다. */
  best: number;
  /** 마친 판 수 */
  runs: number;
  /** 쫓아낸 벌레 수 */
  kills: number;
  /** 준비 화면에서 고른 시작하는 날 */
  startDay: number;
  /** 지금까지 일군 새 밭의 수. 처음 밭이면 0이다. 하나마다 물총 피해와 받는 씨앗이 늘고, 줄지 않는다. */
  fields: number;
  /** 모든 밭을 통틀어 가장 멀리 지킨 날. 새 밭을 일궈도 남는다. */
  bestEver: number;
  /** 가진 유물 조각. 새 밭을 일궈도 남는다. */
  shards: number;
  /** 유물마다의 단계. 새 밭을 일궈도 남는다. */
  relics: RelicLevels;
  /**
   * 가게에 "꾹 누르면 자세히" 안내를 띄운 가게 수. HOLD_HINT_SHOPS가 되면(또는 꾹 눌러 본 적이 있으면 바로 그 값이 된다) 더 띄우지 않는다.
   * 이 항목이 생기기 전의 저장에는 없으므로 없어도 된다.
   */
  holdHint?: number;
  /** 저장한 때(ms). 같은 기기의 다른 곳이 더 늦게 저장한 것을 가리는 데 쓴다. */
  savedAt: number;
}

export function createMeta(): GardenMeta {
  return {
    version: META_VERSION,
    seeds: 0,
    levels: {},
    best: 0,
    runs: 0,
    kills: 0,
    startDay: 1,
    fields: 0,
    bestEver: 0,
    shards: 0,
    relics: {},
    holdHint: 0,
    savedAt: 0,
  };
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
  meta.best = Math.min(count(data.best), MAX_DAY);
  meta.runs = count(data.runs);
  meta.kills = count(data.kills);
  meta.savedAt = count(data.savedAt);
  meta.fields = count(data.fields);
  meta.holdHint = Math.min(count(data.holdHint), HOLD_HINT_SHOPS);
  // 버전 2까지는 밭이 하나뿐이어서 지금 밭의 기록이 곧 모든 밭의 기록이다.
  meta.bestEver = Math.max(Math.min(count(data.bestEver), MAX_DAY), meta.best);
  const levels = typeof data.levels === 'object' && data.levels !== null ? (data.levels as Record<string, unknown>) : {};
  for (const id of UPGRADE_ORDER) {
    const level = Math.min(count(levels[id]), UPGRADES[id].maxLevel);
    if (level > 0) meta.levels[id] = level;
  }
  const relics = typeof data.relics === 'object' && data.relics !== null ? (data.relics as Record<string, unknown>) : {};
  for (const id of RELIC_ORDER) {
    const level = Math.min(count(relics[id]), RELICS[id].maxLevel);
    if (level > 0) meta.relics[id] = level;
  }
  // 버전 3까지는 유물이 없었다. 그동안 물리친 대장(모든 밭을 통틀어 가장 멀리 지킨 날까지)의 몫을 한 번씩 쳐서 준다.
  meta.shards = count(data.version) < 4 ? shardsUpTo(meta.bestEver) : count(data.shards);
  // 버전 1에서는 출발점이 열려도 시작하는 날이 그대로여서, 고르지 않은 사람은 늘 1일째부터 했다. 가장 늦은 출발점으로 옮긴다.
  const fromV1 = count(data.version) < 2;
  meta.startDay = fromV1 ? latestStart(meta.best) : clampStartDay(count(data.startDay) || 1, meta.best);
  return meta;
}

/** "꾹 누르면 자세히" 안내를 띄우는 가게의 수. 그동안 한 번도 꾹 누르지 않았어도 그 뒤로는 띄우지 않는다. */
export const HOLD_HINT_SHOPS = 3;

/** 이번 가게에 "꾹 누르면 자세히" 안내를 띄우는지 */
export function showsHoldHint(meta: GardenMeta): boolean {
  return (meta.holdHint ?? 0) < HOLD_HINT_SHOPS;
}

/** 안내를 띄운 가게를 하나 센다. 이미 다 띄웠으면 그대로 돌려준다. */
export function countHoldHint(meta: GardenMeta): GardenMeta {
  return showsHoldHint(meta) ? { ...meta, holdHint: (meta.holdHint ?? 0) + 1 } : meta;
}

/** 꾹 눌러 정보 창을 열어 보았으니 안내를 더 띄우지 않는다. 이미 그렇다면 그대로 돌려준다. */
export function learnHoldHint(meta: GardenMeta): GardenMeta {
  return showsHoldHint(meta) ? { ...meta, holdHint: HOLD_HINT_SHOPS } : meta;
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
  return {
    ...meta,
    best: cleared,
    bestEver: Math.max(meta.bestEver, cleared),
    startDay: opened ? latestStart(cleared) : meta.startDay,
  };
}

/** 앞의 저장(before)과 견주어 새 출발점이 열렸으면 그 날을, 아니면 null을 준다. */
export function openedStart(before: GardenMeta, after: GardenMeta): number | null {
  const day = latestStart(after.best);
  return day > latestStart(before.best) ? day : null;
}

/** 지금 이 강화를 한 단계 살 수 있는지: 다 올리지 않았고, 씨앗이 넉넉하고, 먼저 있어야 하는 강화가 있다. */
export function canBuy(meta: GardenMeta, id: UpgradeId): boolean {
  const cost = upgradeCost(id, levelOf(meta.levels, id));
  return cost !== null && meta.seeds >= cost && neededFor(meta.levels, id) === null;
}

/** 강화를 한 단계 산다. 살 수 없으면(씨앗이 모자라거나, 다 올렸거나, 먼저 있어야 하는 강화가 없으면) 그대로 돌려준다. */
export function buyUpgrade(meta: GardenMeta, id: UpgradeId): GardenMeta {
  if (!canBuy(meta, id)) return meta;
  const level = levelOf(meta.levels, id);
  const cost = upgradeCost(id, level) ?? 0;
  return { ...meta, seeds: meta.seeds - cost, levels: { ...meta.levels, [id]: level + 1 } };
}

/** 지금 살 수 있는 강화가 하나라도 있는지 */
export function canBuyAny(meta: GardenMeta): boolean {
  return UPGRADE_ORDER.some((id) => canBuy(meta, id));
}

/** 판에서 번 씨앗을 넣는다. 판이 끝나기 전에도(날을 넘길 때마다) 넣어 둘 수 있다. */
export function bankSeeds(meta: GardenMeta, seeds: number): GardenMeta {
  const gained = count(seeds);
  return gained > 0 ? { ...meta, seeds: meta.seeds + gained } : meta;
}

/** 한 판을 마친 기록을 넣는다. lastCleared는 그 판에서 마지막으로 지킨 날(없으면 0)이다. */
export function applyRun(meta: GardenMeta, lastCleared: number, kills: number): GardenMeta {
  return raiseBest(countRun(meta, kills), lastCleared);
}

/**
 * 판 수와 쫓아낸 벌레만 더한다. 가장 멀리 지킨 날은 올리지 않는다.
 * 오늘의 판(daily.ts)은 강화 없이 1일째부터 하는 따로 겨루는 판이라, 지킨 날이 이 밭의 기록과 출발점에 들지 않는다.
 */
export function countRun(meta: GardenMeta, kills: number): GardenMeta {
  return { ...meta, runs: meta.runs + 1, kills: meta.kills + count(kills) };
}

// ------------------------------------------------------------ 새 밭 일구기

/**
 * 새 밭을 일굴 수 있게 되는 날. 지금 밭에서 이 날까지 지켜 냈으면 일굴 수 있다.
 * 자동 플레이로 재 보면 처음 밭은 70일째 근처부터 크게 느려진다. 그 한참 앞에서 열어서 고를 틈을 준다.
 */
export const PLOW_FROM = 50;

/** 일군 밭 하나마다 물총 피해와 받는 씨앗에 더하는 비율. 밭이 쌓이면 더해서 늘린다(둘이면 +60%). */
export const FIELD_BONUS = { damage: 0.3, seeds: 0.3 } as const;

/** 일군 밭의 수가 물총 피해에 곱하는 배율 */
export function fieldDamage(fields: number): number {
  return 1 + FIELD_BONUS.damage * count(fields);
}

/** 일군 밭의 수가 받는 씨앗에 곱하는 배율 */
export function fieldSeeds(fields: number): number {
  return 1 + FIELD_BONUS.seeds * count(fields);
}

/** 새 밭을 일굴 수 있는지 */
export function canPlow(meta: GardenMeta): boolean {
  return meta.best >= PLOW_FROM;
}

/**
 * 새 밭을 일군다. 씨앗, 강화, 지금 밭의 기록과 열린 출발점을 내려놓고 1일째부터 다시 시작하는 대신,
 * 일군 밭이 하나 늘어서 물총 피해와 받는 씨앗이 영원히 늘어난다. 판 수, 벌레 수, 모든 밭의 기록, 유물과 유물 조각은 남는다.
 * 아직 일굴 수 없으면 그대로 돌려준다.
 */
export function plowField(meta: GardenMeta): GardenMeta {
  if (!canPlow(meta)) return meta;
  return {
    ...meta,
    seeds: 0,
    levels: {},
    best: 0,
    startDay: 1,
    fields: meta.fields + 1,
    bestEver: Math.max(meta.bestEver, meta.best),
  };
}

// ------------------------------------------------------------ 유물

/** 그날을 지켰을 때 받는 유물 조각. 대장의 날에만 받고, 뒤쪽 날일수록 더 받는다. */
export function shardsFor(day: number): number {
  return isBossDay(day) ? SHARDS.first + Math.floor(day / SHARDS.every) : 0;
}

/** 1일째부터 그 날까지의 대장을 한 번씩 물리쳤을 때 받는 유물 조각 */
export function shardsUpTo(day: number): number {
  let total = 0;
  for (let boss = BOSS_EVERY; boss <= Math.min(day, MAX_DAY); boss += BOSS_EVERY) total += shardsFor(boss);
  return total;
}

/** 지금 level 단계인 유물을 한 단계 올리는 값(유물 조각). 다 올렸으면 null */
export function relicCost(id: RelicId, level: number): number | null {
  const def = RELICS[id];
  return level >= def.maxLevel ? null : def.cost * (level + 1);
}

/** 유물을 처음부터 끝까지 올리는 데 드는 유물 조각 */
export function relicTotalCost(id: RelicId): number {
  let total = 0;
  for (let level = 0; level < RELICS[id].maxLevel; level += 1) total += relicCost(id, level) ?? 0;
  return total;
}

/** 덤을 "+4.5%"처럼 적는다. 소수는 첫째 자리까지만, 필요할 때만 적는다. */
const signed = (ratio: number): string => `${ratio < 0 ? '-' : '+'}${Math.round(Math.abs(ratio) * 1000) / 10}%`;

/** 그 단계에서 유물이 주는 값을 짧게 적는다(앞에 붙는 말과 값). */
function relicParts(id: RelicId, level: number): readonly [label: string, value: string] {
  switch (id) {
    case 'claw':
      return ['대장 피해', signed(RELIC_STEP.claw * level)];
    case 'dew':
      return ['첫 피해', signed(RELIC_STEP.dew * level)];
    case 'clover':
      return ['큰 피해', signed(RELIC_STEP.clover * level)];
    case 'scarecrow':
      return ['벌레 걸음', level > 0 ? signed(-RELIC_STEP.scarecrow * level) : '그대로'];
    case 'bell':
      return ['날마다', level > 0 ? `${RELIC_STEP.bell * level}번 막음` : '없음'];
    case 'calendar':
      return ['지킨 날 씨앗', signed(RELIC_STEP.calendar * level)];
  }
}

/**
 * 유물 화면의 목록에서 이름 아래에 적는 한 줄: 지금 값과 한 단계 올렸을 때의 값("대장 피해 +2% → +4%").
 * 다 올린 유물은 지금 값만 적는다.
 */
export function relicLine(id: RelicId, level: number): string {
  const [label, now] = relicParts(id, level);
  if (level >= RELICS[id].maxLevel) return `${label} ${now}`;
  return `${label} ${now} → ${relicParts(id, level + 1)[1]}`;
}

/** 지금 이 유물을 한 단계 올릴 수 있는지: 다 올리지 않았고, 유물 조각이 넉넉하다. */
export function canBuyRelic(meta: GardenMeta, id: RelicId): boolean {
  const cost = relicCost(id, relicLevel(meta.relics, id));
  return cost !== null && meta.shards >= cost;
}

/** 유물을 한 단계 올린다. 올릴 수 없으면(조각이 모자라거나 다 올렸으면) 그대로 돌려준다. */
export function buyRelic(meta: GardenMeta, id: RelicId): GardenMeta {
  if (!canBuyRelic(meta, id)) return meta;
  const level = relicLevel(meta.relics, id);
  const cost = relicCost(id, level) ?? 0;
  return { ...meta, shards: meta.shards - cost, relics: { ...meta.relics, [id]: level + 1 } };
}

/** 지금 올릴 수 있는 유물이 하나라도 있는지 */
export function canBuyAnyRelic(meta: GardenMeta): boolean {
  return RELIC_ORDER.some((id) => canBuyRelic(meta, id));
}

/** 판에서 받은 유물 조각을 넣는다. */
export function bankShards(meta: GardenMeta, shards: number): GardenMeta {
  const gained = count(shards);
  return gained > 0 ? { ...meta, shards: meta.shards + gained } : meta;
}

/**
 * 준비 화면에 유물로 가는 단추를 보일지. 대장을 한 번이라도 물리쳤거나(조각을 받았거나) 유물이 있으면 보인다.
 * 처음 하는 사람의 준비 화면에는 아직 쓸 일이 없는 단추를 두지 않는다.
 */
export function relicsOpen(meta: GardenMeta): boolean {
  return meta.shards > 0 || meta.bestEver >= BOSS_EVERY || RELIC_ORDER.some((id) => relicLevel(meta.relics, id) > 0);
}
