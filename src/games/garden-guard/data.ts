/**
 * 텃밭 지키기의 이름과 숫자: 벌레, 영구 강화, 판의 크기.
 * 밸런스는 여기와 rules.ts만 고치면 된다. 화면(씬)과 시뮬레이션(sim.ts)은 여기 값을 읽기만 한다.
 */

export const GARDEN_GAME_ID = 'garden-guard';
export const GARDEN_SCENE = 'GardenGuard';

/**
 * 판의 크기(시뮬레이션 좌표). 가로는 화면의 논리 폭과 같고, 세로는 화면 길이와 상관없이 늘 같다.
 * 화면이 길든 짧든 벌레가 울타리까지 오는 시간이 같아야 기기마다 난이도가 달라지지 않는다.
 * 벌레는 y = 0 위에서 나타나 아래로 내려오고, 울타리는 y = FIELD.depth에 있다.
 */
export const FIELD = {
  width: 240,
  depth: 320,
  /** 벌레가 나타나는 좌우 여백 */
  margin: 16,
  /** 벌레가 나타나는 높이(화면 위쪽 밖) */
  spawnY: -12,
} as const;

/** 물총을 쏘는 자리. 울타리 아래 한가운데다. */
export const SHOOTER = { x: FIELD.width / 2, y: FIELD.depth + 38 } as const;

// ------------------------------------------------------------ 벌레

export type EnemyKind =
  | 'ant'
  | 'ladybug'
  | 'snail'
  | 'bee'
  | 'hopper'
  | 'beetle'
  | 'mosquito'
  | 'digger'
  | 'mole'
  | 'rhino';

/**
 * 벌레가 다가오는 방식. walk는 곧장 걷고, weave는 좌우로 흔들며 날고, hop은 쉬었다가 폴짝 뛰고,
 * dig는 판의 가운데쯤에서 땅속으로 들어가 숨어서 지나간다(DIG).
 */
export type Gait = 'walk' | 'weave' | 'hop' | 'dig';

export interface EnemyDef {
  name: string;
  /** 첫날의 체력. 날이 갈수록 rules.ts의 hpScale만큼 곱해진다. */
  hp: number;
  /** 한 초에 내려오는 거리 */
  speed: number;
  /** 울타리를 한 번 갉을 때의 피해. 날이 갈수록 biteScale만큼 곱해진다. */
  bite: number;
  /** 갉는 간격(초) */
  biteEvery: number;
  radius: number;
  /** 쫓아내면 받는 씨앗. 날이 갈수록 seedScale만큼 곱해진다. */
  seeds: number;
  gait: Gait;
  /** 치명타가 아닌 피해를 이만큼만 받는다(풍뎅이의 껍데기). 없으면 1 */
  shell?: number;
  /** 이 날부터 섞여 나온다. */
  fromDay: number;
  /** 섞이는 비중: 나오기 시작한 날의 값(first)에서 하루에 step씩 늘어 max까지 */
  weight: { first: number; step: number; max: number };
  /** 한 번 뽑히면 이만큼이 한 무리로 붙어서 나온다(모기). 그날 나올 벌레 수에서 그만큼을 쓴다. */
  swarm?: number;
  boss?: boolean;
  /** 대장의 솜씨: summon은 부하를 부르고(SUMMON), charge는 웅크렸다가 돌진한다(CHARGE). */
  skill?: 'summon' | 'charge';
}

export const ENEMIES: Readonly<Record<EnemyKind, EnemyDef>> = {
  ant: {
    name: '개미',
    hp: 20,
    speed: 26,
    bite: 5,
    biteEvery: 1,
    radius: 8,
    seeds: 1,
    gait: 'walk',
    fromDay: 1,
    weight: { first: 10, step: 0, max: 10 },
  },
  ladybug: {
    name: '무당벌레',
    hp: 14,
    speed: 46,
    bite: 3,
    biteEvery: 0.8,
    radius: 7.5,
    seeds: 1,
    gait: 'walk',
    fromDay: 2,
    weight: { first: 3, step: 1, max: 7 },
  },
  snail: {
    name: '달팽이',
    hp: 96,
    speed: 13,
    bite: 10,
    biteEvery: 1.4,
    radius: 10,
    seeds: 2,
    gait: 'walk',
    fromDay: 3,
    weight: { first: 1.5, step: 0.5, max: 4 },
  },
  bee: {
    name: '꿀벌',
    hp: 18,
    speed: 34,
    bite: 5,
    biteEvery: 1,
    radius: 7.5,
    seeds: 1,
    gait: 'weave',
    fromDay: 4,
    weight: { first: 2, step: 1, max: 5 },
  },
  hopper: {
    name: '메뚜기',
    hp: 26,
    speed: 40,
    bite: 6,
    biteEvery: 1,
    radius: 8,
    seeds: 2,
    gait: 'hop',
    fromDay: 6,
    weight: { first: 2, step: 1, max: 5 },
  },
  beetle: {
    name: '풍뎅이',
    hp: 60,
    speed: 20,
    bite: 8,
    biteEvery: 1.2,
    radius: 9.5,
    seeds: 2,
    gait: 'walk',
    shell: 0.5,
    fromDay: 8,
    weight: { first: 1.5, step: 0.5, max: 5 },
  },
  mosquito: {
    name: '모기',
    hp: 9,
    speed: 40,
    bite: 3,
    biteEvery: 0.7,
    radius: 6,
    seeds: 1,
    gait: 'walk',
    swarm: 4,
    fromDay: 14,
    weight: { first: 1.2, step: 0.15, max: 2.4 },
  },
  digger: {
    name: '땅강아지',
    hp: 64,
    speed: 25,
    bite: 9,
    biteEvery: 1.1,
    radius: 9,
    seeds: 3,
    gait: 'dig',
    fromDay: 24,
    weight: { first: 1.5, step: 0.3, max: 4 },
  },
  mole: {
    name: '대장 두더지',
    hp: 700,
    speed: 9,
    bite: 24,
    biteEvery: 1.6,
    radius: 18,
    seeds: 10,
    gait: 'walk',
    fromDay: 5,
    weight: { first: 0, step: 0, max: 0 },
    boss: true,
    skill: 'summon',
  },
  rhino: {
    name: '대장 장수풍뎅이',
    hp: 840,
    speed: 5.5,
    bite: 24,
    biteEvery: 1.6,
    radius: 18,
    seeds: 12,
    gait: 'walk',
    fromDay: 10,
    weight: { first: 0, step: 0, max: 0 },
    boss: true,
    skill: 'charge',
  },
};

/** 여느 날에 섞여 나오는 벌레(대장 빼고)를 나오기 시작하는 날 순서로 */
export const COMMON_KINDS: readonly EnemyKind[] = [
  'ant',
  'ladybug',
  'snail',
  'bee',
  'hopper',
  'beetle',
  'mosquito',
  'digger',
];

/** 꿀벌이 좌우로 흔들리는 폭(한쪽)과 한 번 오가는 시간(초) */
export const WEAVE = { reach: 34, period: 2.4 } as const;
/** 메뚜기가 쉬는 시간과 뛰는 시간(초). 뛰는 동안에만 움직인다. */
export const HOP = { rest: 0.85, leap: 0.25 } as const;

/** 모기 떼가 나올 때 한 마리씩 벌어지는 거리(x)와 나오는 때의 어긋남(초) */
export const SWARM = { spread: 11, stagger: 0.12 } as const;
/**
 * 땅강아지가 땅속에 숨어 지나가는 높이(시뮬레이션 y). 이 사이에서는 물방울도 물벼락도 닿지 않고,
 * 물총과 해바라기도 겨누지 않는다. 울타리(FIELD.depth)에 닿기 전에 다시 나온다.
 */
export const DIG = { from: 70, to: 225 } as const;

/** 대장이 나오는 날의 간격. 이 날을 지키면 그다음 날부터 시작할 수 있다. */
export const BOSS_EVERY = 5;
/** 대장의 날마다 차례로 나오는 대장: 5일째 두더지, 10일째 장수풍뎅이, 15일째 두더지, ... */
export const BOSS_ROTATION: readonly EnemyKind[] = ['mole', 'rhino'];
/** 대장 두더지가 부하를 부르는 간격(초)과 한 번에 부르는 수 */
export const SUMMON = { every: 7, count: 2, kind: 'ant' as EnemyKind } as const;
/**
 * 대장 장수풍뎅이의 돌진. every초마다 windup초 동안 멈춰 웅크렸다가 rush초 동안 speed배로 내달린다.
 * 찬물과 물벼락에 젖어 느려지면 이 박자도 같이 느려진다.
 */
export const CHARGE = { every: 6, windup: 0.9, rush: 1.1, speed: 5 } as const;

// ------------------------------------------------------------ 하루

export const DAY = {
  /** 하루에 나오는 벌레 수: first + perDay × (날 - 1), 많아도 max */
  count: { first: 7, perDay: 1.5, max: 46 },
  /** 벌레가 다 나오기까지의 시간(초): first + perDay × (날 - 1), 길어도 max */
  window: { first: 10, perDay: 0.4, max: 22 },
  /** 대장이 나오는 날에는 여느 벌레를 이만큼만 내보낸다. */
  bossEscort: 0.6,
  /** 날을 지킨 뒤 다음 날이 시작되기까지 쉬는 시간(초) */
  rest: 2.2,
  /** 강화를 고른 뒤에는 쉬는 시간이 이만큼만 남는다(초). 고르느라 이미 쉬었다. */
  afterPick: 1,
  /** 판에 벌레가 하나도 없으면 다음 벌레가 이 시간(초) 안에 나오도록 당긴다. 쉬운 날이 빨리 지나간다. */
  hurry: 0.35,
} as const;

// ------------------------------------------------------------ 물총

export const GUN = {
  /** 강화 없이 한 발의 피해 */
  damage: 20,
  /** 강화 없이 쏘는 간격(초) */
  interval: 0.5,
  /** 물방울이 한 초에 날아가는 거리 */
  shotSpeed: 380,
  shotRadius: 4,
  /** 화면을 누르고 직접 겨누는 동안에는 쏘는 간격이 이만큼으로 줄어든다. */
  manualRate: 0.75,
  /** 치명타의 피해 배율 */
  critMult: 2.5,
  /** 갈래 물총의 곁가지 물방울이 벌어지는 각도(라디안)와 피해 비율 */
  forkAngle: 0.15,
  forkDamage: 0.7,
  /** 겨눌 수 있는 가장 낮은 각도(수평에서 이만큼 위, 라디안). 옆으로 눕혀 쏘지 못하게 한다. */
  minLift: 0.16,
} as const;

/** 물벼락: 판의 벌레를 한꺼번에 적신다. 느려지는 정도와 시간(초) */
export const STORM = { slow: 0.5, slowSeconds: 3 } as const;

// ------------------------------------------------------------ 영구 강화

export type UpgradeId =
  | 'power'
  | 'rapid'
  | 'fence'
  | 'mend'
  | 'crit'
  | 'splash'
  | 'chill'
  | 'thorn'
  | 'harvest'
  | 'helper'
  | 'compost'
  | 'pierce'
  | 'fork'
  | 'storm';

export interface UpgradeDef {
  name: string;
  /** 무엇을 하는지 한 줄. 준비 화면에서 그 강화를 고르면 목록 아래에 보인다. */
  blurb: string;
  maxLevel: number;
  /** 첫 단계의 값과, 한 단계마다 곱해지는 배율 */
  cost: number;
  growth: number;
  /** 이 강화가 있어야 쓸모가 있다. 그것이 없으면 살 수 없다(해바라기 없이는 거름이 아무 일도 하지 않는다). */
  needs?: UpgradeId;
}

export const UPGRADES: Readonly<Record<UpgradeId, UpgradeDef>> = {
  power: { name: '센 물줄기', blurb: '물방울 하나의 피해가 커져요', maxLevel: 99, cost: 12, growth: 1.15 },
  rapid: { name: '빠른 손', blurb: '물총과 동료가 더 빨리 쏴요', maxLevel: 12, cost: 20, growth: 1.6 },
  fence: { name: '튼튼한 울타리', blurb: '울타리가 더 오래 버텨요', maxLevel: 60, cost: 10, growth: 1.2 },
  mend: { name: '울타리 손보기', blurb: '날이 바뀔 때 울타리를 더 많이 고쳐요', maxLevel: 8, cost: 20, growth: 1.7 },
  crit: { name: '콕 찌르기', blurb: '가끔 크게 맞혀요. 풍뎅이 껍데기도 뚫어요', maxLevel: 10, cost: 25, growth: 1.7 },
  splash: { name: '물보라', blurb: '맞은 자리 둘레의 벌레도 함께 젖어요', maxLevel: 6, cost: 50, growth: 2 },
  chill: { name: '찬물', blurb: '맞은 벌레가 잠깐 느려져요', maxLevel: 5, cost: 40, growth: 2 },
  thorn: { name: '가시 울타리', blurb: '울타리를 갉는 벌레가 가시에 찔려요', maxLevel: 10, cost: 20, growth: 1.6 },
  harvest: { name: '풍년', blurb: '씨앗을 더 많이 받아요', maxLevel: 10, cost: 30, growth: 1.7 },
  helper: { name: '해바라기 모종', blurb: '판을 해바라기와 함께 시작해요', maxLevel: 2, cost: 150, growth: 10 },
  compost: { name: '동료 거름', blurb: '모든 동료의 피해가 커져요', maxLevel: 6, cost: 80, growth: 2 },
  pierce: { name: '뚫는 물줄기', blurb: '물방울이 벌레를 뚫고 뒤의 벌레도 맞혀요', maxLevel: 3, cost: 300, growth: 6 },
  fork: { name: '갈래 물총', blurb: '물방울을 여러 갈래로 한꺼번에 쏴요', maxLevel: 3, cost: 500, growth: 6 },
  storm: { name: '물벼락', blurb: '버튼을 누르면 판의 벌레를 모두 적셔요', maxLevel: 5, cost: 100, growth: 2.2 },
};

/** 준비 화면의 목록에 놓이는 차례. 싸고 알기 쉬운 것이 앞이다. */
export const UPGRADE_ORDER: readonly UpgradeId[] = [
  'power',
  'fence',
  'rapid',
  'mend',
  'crit',
  'thorn',
  'harvest',
  'chill',
  'splash',
  'helper',
  'compost',
  'storm',
  'pierce',
  'fork',
];

/** 강화가 한 단계마다 바꾸는 값. rules.ts의 statsFor가 읽는다. */
export const STEP = {
  /** 센 물줄기: 피해 × */
  power: 1.05,
  /** 빠른 손: 쏘는 간격 × */
  rapid: 0.94,
  /** 튼튼한 울타리: 체력 + */
  fence: 25,
  /** 울타리 손보기: 날이 바뀔 때 고치는 비율 + (처음에는 base) */
  mend: { base: 0.05, step: 0.04 },
  /** 콕 찌르기: 치명타 확률 + */
  crit: 0.04,
  /** 물보라: 튀는 반지름(first + step × 단계)과 피해 비율(first + step × 단계) */
  splash: { radius: 16, radiusStep: 3, ratio: 0.25, ratioStep: 0.07 },
  /** 찬물: 느려지는 정도(first + step × 단계)와 시간(초) */
  chill: { slow: 0.12, slowStep: 0.06, seconds: 1.4 },
  /** 가시 울타리: 갉을 때마다 물방울 피해의 이만큼을 되돌려 준다. */
  thorn: 0.3,
  /** 풍년: 받는 씨앗 + */
  harvest: 0.08,
  /** 동료 거름: 동료의 피해 + */
  compost: 0.15,
  /** 물벼락: 다시 쓸 때까지의 시간(초)과 물방울 피해의 몇 배를 주는지 */
  storm: { cooldown: 38, cooldownStep: 3, damage: 4, damageStep: 1.5 },
} as const;

/** 강화 없이 시작하는 울타리의 체력 */
export const FENCE_BASE = 100;

// ------------------------------------------------------------ 동료

/**
 * 동료: 판 안에서 열리는 동료 가게(allies.ts)에서 열매로 사서 울타리 아래에 세운다. 판이 끝나면 떠난다.
 * 같은 동료를 또 사면 합쳐져서 별이 오른다(ALLY_STARS). 동료의 피해는 물총 한 발의 피해(Stats.damage)에 비율을 곱해서,
 * 영구 강화와 새 밭으로 물총이 세지는 만큼 동료도 같이 세진다. 값은 여기만 고치면 된다.
 */
export type AllyId = 'sunflower' | 'frog' | 'mint' | 'can' | 'sparrow' | 'cactus';

/**
 * 동료가 겨누는 벌레. near는 제게 가까운 것, boss는 체력이 가장 많은 것(대장이 먼저), front는 울타리에 가장 가까운 것,
 * crowd는 둘레에 벌레가 가장 많이 몰린 것, far는 판 위쪽에서 가장 먼 것이다.
 */
export type AllyAim = 'near' | 'boss' | 'front' | 'crowd' | 'far';

export interface AllyDef {
  name: string;
  /** 무엇을 하는지 한 줄. 가게의 카드에 적는다. */
  blurb: string;
  /** 이 날부터 가게에 나온다. 날이 갈수록 새 동료가 나온다. */
  fromDay: number;
  /** 가게에서 한 마리의 값(열매) */
  price: number;
  /** ★1이 쏘는 간격(초) */
  interval: number;
  /** ★1의 한 발 피해: 물총 한 발의 피해에 곱하는 비율 */
  damage: number;
  aim: AllyAim;
  /** 쏜 것이 날아가는 빠르기 */
  shotSpeed: number;
  /** 맞은 벌레를 느리게 하는 정도(0~1)와 시간(초). 대장은 반만 느려진다. */
  chill?: { slow: number; seconds: number };
  /** 맞은 자리 둘레(반지름)의 벌레도 이 비율의 피해를 받는다. */
  splash?: { radius: number; ratio: number };
  /** 울타리에서 이만큼 안으로 들어온 벌레만 겨눈다(선인장의 가시가 닿는 거리). */
  reach?: number;
  /** 껍데기를 뚫는지(풍뎅이에게도 다 들어간다) */
  pierceShell?: boolean;
}

export const ALLIES: Readonly<Record<AllyId, AllyDef>> = {
  sunflower: {
    name: '해바라기',
    blurb: '가까운 벌레에게 씨를 쏴요',
    fromDay: 1,
    price: 3,
    interval: 0.9,
    damage: 0.36,
    aim: 'near',
    shotSpeed: 380,
  },
  frog: {
    name: '개구리',
    blurb: '튼튼한 벌레를 혀로 세게 쳐요',
    fromDay: 1,
    price: 4,
    interval: 2.2,
    damage: 1.6,
    aim: 'boss',
    shotSpeed: 560,
    pierceShell: true,
  },
  mint: {
    name: '박하',
    blurb: '찬 잎을 날려 벌레를 늦춰요',
    fromDay: 4,
    price: 4,
    interval: 1.1,
    damage: 0.22,
    aim: 'front',
    shotSpeed: 330,
    chill: { slow: 0.35, seconds: 1.6 },
  },
  can: {
    name: '물뿌리개',
    blurb: '몰린 벌레에게 물을 뿌려요',
    fromDay: 8,
    price: 5,
    interval: 1.7,
    damage: 0.4,
    aim: 'crowd',
    shotSpeed: 300,
    splash: { radius: 30, ratio: 1 },
  },
  sparrow: {
    name: '참새',
    blurb: '멀리 있는 벌레부터 쪼아요',
    fromDay: 12,
    price: 5,
    interval: 0.5,
    damage: 0.24,
    aim: 'far',
    shotSpeed: 460,
  },
  cactus: {
    name: '선인장',
    blurb: '울타리에 붙은 벌레를 찔러요',
    fromDay: 16,
    price: 4,
    interval: 0.6,
    damage: 0.75,
    aim: 'front',
    shotSpeed: 420,
    reach: 60,
    pierceShell: true,
  },
};

/** 가게에 나오는 차례이자 울타리 아래에 서는 자리의 차례 */
export const ALLY_ORDER: readonly AllyId[] = ['sunflower', 'frog', 'mint', 'can', 'sparrow', 'cactus'];

/**
 * 동료가 서는 자리(시뮬레이션 좌표). ALLY_ORDER의 차례대로 물총의 왼쪽에 셋, 오른쪽에 셋이 선다.
 * 물벼락 버튼은 이 줄 아래 오른쪽 끝에 놓인다.
 */
export const ALLY_SPOTS: Readonly<Record<AllyId, { x: number; y: number }>> = {
  sunflower: { x: 84, y: FIELD.depth + 26 },
  frog: { x: 156, y: FIELD.depth + 26 },
  mint: { x: 52, y: FIELD.depth + 26 },
  can: { x: 188, y: FIELD.depth + 26 },
  sparrow: { x: 20, y: FIELD.depth + 26 },
  cactus: { x: 220, y: FIELD.depth + 26 },
};

/**
 * 같은 동료를 모은 수에 따른 별. 두 마리가 모이면 ★2, 넷이면 ★3, 여덟이면 ★4, 열여섯이면 ★5다.
 * 별이 하나 오를 때마다 피해는 damage배, 쏘는 간격은 interval배가 된다.
 */
export const ALLY_STARS = { max: 5, damage: 1.75, interval: 0.9 } as const;

/** 동료 가게 */
export const SHOP = {
  /** 한 번에 내놓는 카드 수 */
  cards: 3,
  /** 판을 시작할 때 가진 열매 */
  purse: 4,
  /** 날을 지킬 때 받는 열매. 대장의 날에는 boss를 더 받는다. */
  income: 4,
  boss: 3,
  /** 다시 뽑는 값(열매) */
  reroll: 1,
} as const;

/**
 * 동료를 들일수록 벌레도 세진다: 그 판에서 지킨 날마다(많아야 heatDays번) 벌레의 체력에 heat를 곱한다.
 * 동료가 늘어 판이 세지는 만큼 벌레도 따라 세져서, 영구 강화의 값어치가 줄지 않는다.
 * 판을 앞쪽 날에서 시작해 동료를 미리 모아도, 벌레도 같이 세져 있어서 득이 없다.
 */
export const TEAM_HEAT = { heat: 1.08, days: 8 } as const;

// ------------------------------------------------------------ 유물

/**
 * 유물: 대장의 날을 지킬 때 받는 유물 조각으로 강화한다. 한 번 올린 단계는 줄지 않고, 새 밭을 일궈도 남는다.
 * 영구 강화(UPGRADES)가 건드리지 않는 값만 조금씩 바꿔서, 다 올려도 판이 크게 달라지지는 않는다.
 * 값은 RELIC_STEP에 있고 rules.ts의 statsFor가 읽는다.
 */
export type RelicId = 'claw' | 'dew' | 'clover' | 'scarecrow' | 'bell' | 'calendar';

export interface RelicDef {
  name: string;
  /** 무엇을 하는지 한 줄. 유물 화면에서 그 유물을 고르면 목록 아래에 보인다. */
  blurb: string;
  maxLevel: number;
  /** 첫 단계의 값(유물 조각). 한 단계마다 이만큼씩 더 든다(2면 2, 4, 6, ...). */
  cost: number;
}

export const RELICS: Readonly<Record<RelicId, RelicDef>> = {
  claw: { name: '두더지 발톱', blurb: '대장에게 주는 피해가 커져요', maxLevel: 10, cost: 1 },
  dew: { name: '아침 이슬', blurb: '아직 안 맞은 벌레에게 주는 피해가 커져요', maxLevel: 10, cost: 1 },
  clover: { name: '네잎클로버', blurb: '크게 맞혔을 때의 피해가 커져요', maxLevel: 10, cost: 1 },
  scarecrow: { name: '허수아비', blurb: '벌레가 겁을 먹고 조금 천천히 와요', maxLevel: 5, cost: 2 },
  bell: { name: '울타리 방울', blurb: '날마다 처음 몇 번의 갉기를 막아 줘요', maxLevel: 5, cost: 2 },
  calendar: { name: '오래된 달력', blurb: '날을 지킬 때 받는 씨앗이 늘어요', maxLevel: 10, cost: 1 },
};

/** 유물 화면의 목록에 놓이는 차례 */
export const RELIC_ORDER: readonly RelicId[] = ['claw', 'dew', 'clover', 'scarecrow', 'bell', 'calendar'];

/** 유물이 한 단계마다 바꾸는 값. rules.ts의 statsFor가 읽는다. */
export const RELIC_STEP = {
  /** 두더지 발톱: 대장에게 주는 피해 + */
  claw: 0.015,
  /** 아침 이슬: 아직 안 다친(체력이 가득한) 벌레에게 주는 피해 + */
  dew: 0.03,
  /** 네잎클로버: 치명타의 피해 배율(GUN.critMult)을 이만큼씩 더 키운다. */
  clover: 0.015,
  /** 허수아비: 벌레가 다가오는 빠르기 - */
  scarecrow: 0.01,
  /** 울타리 방울: 날마다 울타리가 그냥 막아 내는 갉기의 수 + */
  bell: 1,
  /** 오래된 달력: 날을 지켰을 때 받는 씨앗 + */
  calendar: 0.05,
} as const;

/**
 * 대장의 날을 지켰을 때 받는 유물 조각: first개에, 날이 every일 깊어질 때마다 하나씩 더.
 * 뒤쪽 날의 대장일수록 더 줘서, 쉬운 앞쪽 대장만 되풀이해 잡는 것보다 갈 수 있는 데까지 가는 쪽이 낫다.
 */
export const SHARDS = { first: 1, every: 25 } as const;
