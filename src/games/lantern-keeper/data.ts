/**
 * 등불지기의 밸런스 데이터. 숫자만 바꿔서 난이도와 성장 속도를 맞춘다.
 * 화면이나 Phaser에 의존하지 않는다.
 */

/** 씬 이름과 세이브에 쓰는 게임 id. 한 번 정하면 바꾸지 않는다. */
export const LANTERN_SCENE = 'LanternKeeper';
export const LANTERN_GAME_ID = 'lantern-keeper';

/** 한 판의 길이(초). 끝에 마지막 보스가 나온다. */
export const RUN_SECONDS = 600;
/** 중간 보스가 나오는 간격(초). 2분, 4분, 6분, 8분에 나오고 10분에는 마지막 보스가 나온다. */
export const MID_BOSS_EVERY = 120;
/** 한 판에 나오는 중간 보스의 수 */
export const MID_BOSS_COUNT = Math.ceil(RUN_SECONDS / MID_BOSS_EVERY) - 1;

export const PLAYER_BASE = {
  maxHp: 100,
  /** px/초 */
  speed: 62,
  /** 빛 조각을 끌어당기는 반경(px) */
  magnet: 22,
  /** 맞은 뒤 무적 시간(초) */
  invulnerable: 0.5,
  /** 판정 반지름(px) */
  radius: 5,
} as const;

export type EnemyKind =
  | 'shade'
  | 'bat'
  | 'brute'
  | 'wisp'
  | 'glare'
  | 'puff'
  | 'drip'
  | 'moth'
  | 'toad'
  | 'stump'
  | 'squirt'
  | 'spore'
  | 'giant'
  | 'ram'
  | 'owl'
  | 'lord'
  | 'matron';

/**
 * 보스가 싸우는 방식.
 * summon 부하를 불러낸다 · charge 힘을 모았다 돌진한다 · volley 빛을 흩뿌려 쏜다
 * lord 돌진한 뒤 부하를 부른다 · matron 사방으로 쏘기와 부하 부르기를 번갈아 한다
 */
export type BossBrain = 'summon' | 'charge' | 'volley' | 'lord' | 'matron';

/** 멀찍이 멈춰 서서 어둠 방울을 쏘는 적의 숫자 */
export interface ShootInfo {
  /** 이 거리(px) 안에 들어오면 더 다가오지 않고 쏜다 */
  range: number;
  /** 쏘고 나서 다음에 쏘기까지(초) */
  every: number;
  /** 쏘기 전에 멈춰서 숨을 들이쉬는 시간(초). 이 동안 예고가 보인다. */
  windup: number;
  /** 어둠 방울에 맞았을 때의 피해 */
  damage: number;
}

/** 가까이 와서 부풀었다가 터지는 적의 숫자 */
export interface BurstInfo {
  /** 이 거리(px) 안에 들어오면 멈춰서 부풀기 시작한다 */
  trigger: number;
  /** 부풀기 시작해서 터지기까지(초). 이 동안 터질 둘레가 바닥에 보인다. */
  fuse: number;
  /** 터지는 둘레의 반지름(px) */
  radius: number;
  /** 둘레 안에 있던 플레이어가 받는 피해 */
  damage: number;
  /** 둘레 안에 있던 다른 그림자가 받는 피해. 무리 속에서 터뜨리면 이득이다. */
  splash: number;
}

export interface EnemyInfo {
  name: string;
  hp: number;
  /** px/초 */
  speed: number;
  /** 닿았을 때 주는 피해 */
  damage: number;
  /** 떨어뜨리는 빛 조각 값 */
  xp: number;
  /** 판정 반지름(px) */
  radius: number;
  /** 폴짝폴짝 뛰어서, 멈췄다가 한 번에 다가온다 */
  hops?: boolean;
  shoots?: ShootInfo;
  bursts?: BurstInfo;
  boss?: boolean;
  brain?: BossBrain;
}

export const ENEMIES: Readonly<Record<EnemyKind, EnemyInfo>> = {
  // 밤의 풀밭
  shade: { name: '그림자 방울', hp: 6, speed: 22, damage: 5, xp: 1, radius: 6 },
  bat: { name: '밤박쥐', hp: 5, speed: 40, damage: 4, xp: 1, radius: 5 },
  wisp: { name: '도깨비불', hp: 14, speed: 30, damage: 8, xp: 2, radius: 5 },
  brute: { name: '돌그림자', hp: 45, speed: 15, damage: 12, xp: 4, radius: 8 },
  glare: {
    name: '눈총 그림자',
    hp: 10,
    speed: 24,
    damage: 5,
    xp: 2,
    radius: 6,
    shoots: { range: 84, every: 5, windup: 0.7, damage: 4 },
  },
  puff: {
    name: '부푼 그림자',
    hp: 26,
    speed: 34,
    damage: 6,
    xp: 3,
    radius: 6,
    bursts: { trigger: 24, fuse: 0.9, radius: 30, damage: 12, splash: 40 },
  },
  // 안개 늪
  drip: { name: '늪방울', hp: 7, speed: 21, damage: 5, xp: 1, radius: 6 },
  moth: { name: '안개나방', hp: 4, speed: 44, damage: 4, xp: 1, radius: 5 },
  toad: { name: '늪두꺼비', hp: 18, speed: 58, damage: 9, xp: 2, radius: 6, hops: true },
  stump: { name: '이끼 등걸', hp: 60, speed: 13, damage: 14, xp: 5, radius: 9 },
  squirt: {
    name: '물총 봉오리',
    hp: 12,
    speed: 20,
    damage: 5,
    xp: 2,
    radius: 6,
    shoots: { range: 90, every: 5.2, windup: 0.7, damage: 4 },
  },
  spore: {
    name: '포자 주머니',
    hp: 30,
    speed: 30,
    damage: 6,
    xp: 3,
    radius: 7,
    bursts: { trigger: 26, fuse: 1, radius: 34, damage: 13, splash: 45 },
  },
  // 중간 보스의 체력은 MID_BOSS_TIERS가 정한다. 여기 적힌 값은 첫 번째 것과 같다.
  giant: { name: '어스름 거인', hp: 320, speed: 30, damage: 18, xp: 30, radius: 15, boss: true, brain: 'summon' },
  ram: { name: '뿔그림자', hp: 320, speed: 26, damage: 20, xp: 30, radius: 14, boss: true, brain: 'charge' },
  owl: { name: '안개 올빼미', hp: 320, speed: 22, damage: 16, xp: 30, radius: 14, boss: true, brain: 'volley' },
  // 마지막 보스
  lord: { name: '밤의 왕관', hp: 4000, speed: 27, damage: 24, xp: 0, radius: 17, boss: true, brain: 'lord' },
  matron: { name: '늪의 어미', hp: 4000, speed: 23, damage: 22, xp: 0, radius: 17, boss: true, brain: 'matron' },
};

export interface SpawnRow {
  kind: EnemyKind;
  /** 이 시각(초)부터 나온다 */
  from: number;
  /** 섞이는 비율 */
  weight: number;
}

/**
 * 중간 보스는 나올 때마다 강해진다. 0번이 2분에 나오는 첫 번째.
 * hp는 체력, summon은 부하를 부르는 보스가 한 번에 불러내는 수.
 */
export const MID_BOSS_TIERS: ReadonlyArray<{ hp: number; summon: number }> = [
  { hp: 320, summon: 4 },
  { hp: 700, summon: 5 },
  { hp: 1500, summon: 6 },
  { hp: 2400, summon: 8 },
];

export type StageId = 'meadow' | 'marsh';

export interface StageInfo {
  name: string;
  /** 준비 화면에 보이는 한 줄 */
  blurb: string;
  /** 몇 초부터 어떤 적이 얼마나 섞여 나오는지 */
  spawns: readonly SpawnRow[];
  /** 밀물 때 에워싸는 적. 앞의 두 번과 뒤의 두 번 */
  surge: readonly [EnemyKind, EnemyKind];
  /** 보스가 불러내는 부하. 앞의 두 번과 뒤의 두 번 */
  minions: readonly [EnemyKind, EnemyKind];
  /** 2분, 4분, 6분, 8분에 차례로 나오는 중간 보스 */
  midBosses: readonly EnemyKind[];
  finalBoss: EnemyKind;
  /** 발이 빠져 느려지는 웅덩이가 있는 곳 */
  puddles: boolean;
  /** 최고 기록이 이만큼(초) 되면 열린다. 0이면 처음부터 열려 있다. */
  unlockSeconds: number;
}

export const STAGES: Readonly<Record<StageId, StageInfo>> = {
  meadow: {
    name: '밤의 풀밭',
    blurb: '탁 트인 들판. 사방에서 그림자가 몰려온다',
    spawns: [
      { kind: 'shade', from: 0, weight: 10 },
      { kind: 'bat', from: 75, weight: 6 },
      { kind: 'wisp', from: 200, weight: 5 },
      { kind: 'brute', from: 160, weight: 2 },
      { kind: 'glare', from: 130, weight: 1 },
      { kind: 'puff', from: 280, weight: 1.2 },
    ],
    surge: ['shade', 'wisp'],
    minions: ['bat', 'wisp'],
    midBosses: ['giant', 'ram', 'owl', 'giant'],
    finalBoss: 'lord',
    puddles: false,
    unlockSeconds: 0,
  },
  marsh: {
    name: '안개 늪',
    blurb: '웅덩이에 빠지면 느려진다. 뛰어드는 두꺼비 조심',
    spawns: [
      { kind: 'drip', from: 0, weight: 10 },
      { kind: 'moth', from: 60, weight: 6 },
      { kind: 'toad', from: 120, weight: 5 },
      { kind: 'stump', from: 170, weight: 2 },
      { kind: 'squirt', from: 120, weight: 1 },
      { kind: 'spore', from: 270, weight: 1.2 },
    ],
    surge: ['moth', 'toad'],
    minions: ['moth', 'toad'],
    midBosses: ['owl', 'giant', 'ram', 'owl'],
    finalBoss: 'matron',
    puddles: true,
    unlockSeconds: 240,
  },
};

export const STAGE_ORDER: readonly StageId[] = ['meadow', 'marsh'];

/**
 * 깊은 밤의 가장 깊은 단계. 0은 보통 밤이고, 한 스테이지를 완주할 때마다 그 스테이지의 다음 단계가 열린다.
 * 단계마다 얼마나 어려워지고 점수와 불씨가 얼마나 붙는지는 rules.ts의 depthRules가 정한다.
 */
export const MAX_DEPTH = 8;

/**
 * 등불 기둥. 정해진 시각마다 플레이어 가까이에 하나씩 나타나고, 닿으면 불이 켜져서 한동안 둘레의 그림자를 태운다.
 * 켜지 않은 기둥은 그 자리에 남아 있어서, 밀물이나 보스가 올 때까지 아껴 둘 수 있다.
 */
export const POSTS = {
  /** 나타나는 시각(초). 첫 번째는 일찍 나와서 쓰는 법을 알려 주고, 나머지는 밀물이 오기 30초 전에 나온다. */
  times: [50, 150, 270, 390, 510],
  /** 플레이어에게서 이만큼(px) 떨어진 곳에 나타난다. 화면 안에 보이는 거리다. */
  near: 70,
  far: 100,
  /** 이 거리(px) 안으로 다가가면 불이 켜진다 */
  touch: 10,
  /** 빛이 닿는 둘레의 반지름(px) */
  radius: 46,
  /** 켜져 있는 시간(초). 다 타면 기둥이 사라진다. */
  seconds: 12,
  /** 빛이 그림자를 태우는 간격(초) */
  tick: 0.4,
  /** 한 번 태울 때 보통 그림자가 잃는 체력의 몫. 빛 속에서 2초 남짓 버티면 쓰러진다. */
  burn: 0.18,
  /** 한 번 태울 때 보스가 잃는 체력의 몫. 끝까지 빛 속에 있어도 열에 하나쯤만 잃는다. */
  bossBurn: 0.003,
  /** 빛 속에서 보통 그림자가 느려지는 배율. 걸어오는 그림자는 가운데에 닿기 전에 거의 다 탄다. */
  slow: 0.5,
  /** 켜지 않은 기둥은 이만큼까지만 남는다. 넘치면 가장 오래된 것이 사라진다. */
  keep: 3,
} as const;

/** 이 시각들에 적이 둥글게 에워싸는 "밀물"이 한 번씩 온다(초). 중간 보스와 겹치지 않게 그 사이에 둔다. */
export const SURGES: readonly number[] = [180, 300, 420, 540];

export type WeaponId = 'ember' | 'aura' | 'firefly' | 'star' | 'lance' | 'oil' | 'bolt';
export type PassiveId = 'wick' | 'hourglass' | 'boots' | 'magnet' | 'coat' | 'lens' | 'hood';

/** 레벨업으로 올릴 수 있는 무기와 패시브의 최대 레벨 */
export const MAX_LEVEL = 5;
/**
 * 무기가 이 레벨이 되면 이름과 모습이 바뀌는 최종 진화형이 된다.
 * MAX_LEVEL인 무기에 무기 강화권을 써야만 올라간다.
 */
export const EVOLVE_LEVEL = MAX_LEVEL + 1;
/** 한 판에 들 수 있는 무기의 수 */
export const MAX_WEAPONS = 4;
/** 한 판에 가질 수 있는 패시브의 가짓수. 패시브가 이보다 많아서, 무엇을 뺄지 골라야 한다. */
export const MAX_PASSIVES = 6;

export interface WeaponInfo {
  name: string;
  /** 레벨마다 무엇이 좋아지는지. 0번이 처음 얻을 때 설명. MAX_LEVEL개. */
  levels: readonly string[];
  /** 최종 진화형 */
  evolved: { name: string; description: string };
}

export const WEAPONS: Readonly<Record<WeaponId, WeaponInfo>> = {
  ember: {
    name: '불씨탄',
    levels: ['가까운 적에게 불씨를 쏜다', '피해 +4', '한 발 더', '재사용 -15%', '한 발 더, 관통 1'],
    evolved: { name: '불새 깃', description: '네 발씩 쏘고 여러 적을 꿰뚫는다' },
  },
  aura: {
    name: '등불 고리',
    levels: ['둘레의 적을 계속 태운다', '범위 +5', '피해 +3', '범위 +5', '피해 +4, 느리게'],
    evolved: { name: '한낮 고리', description: '더 넓고 뜨겁게, 적이 크게 느려진다' },
  },
  firefly: {
    name: '반딧불',
    levels: ['반딧불이 둘레를 돈다', '한 마리 더', '피해 +4', '한 마리 더', '한 마리 더, 빠르게'],
    evolved: { name: '반딧불 은하', description: '여섯 마리가 더 넓게, 더 자주 때린다' },
  },
  star: {
    name: '별똥',
    levels: ['화면 안의 적에게 별이 떨어진다', '피해 +8', '한 개 더', '범위 +5', '한 개 더, 재사용 -20%'],
    evolved: { name: '유성우', description: '다섯 개씩 더 자주 떨어진다' },
  },
  lance: {
    name: '빛화살',
    levels: ['튼튼한 적을 겨눠 모두 꿰뚫는다', '피해 +6', '재사용 -20%', '한 발 더', '피해 +8, 굵게'],
    evolved: { name: '새벽 창', description: '굵은 창이 세 갈래로 나간다' },
  },
  oil: {
    name: '등잔 기름',
    levels: ['서 있던 자리에 불길을 남긴다', '범위 +4', '피해 +3', '더 오래 탄다', '피해 +4, 재사용 -20%'],
    evolved: { name: '들불', description: '넓고 오래 타며 적을 느리게 한다' },
  },
  bolt: {
    name: '번갯불',
    levels: ['적에서 적으로 튀는 번개', '피해 +4', '두 번 더 튄다', '재사용 -20%', '피해 +5, 두 번 더'],
    evolved: { name: '뇌우', description: '두 줄기가 훨씬 멀리 튄다' },
  },
};

/** 선택지와 화면에 늘어놓는 순서 */
export const WEAPON_ORDER: readonly WeaponId[] = ['ember', 'aura', 'firefly', 'star', 'lance', 'oil', 'bolt'];

export interface PassiveInfo {
  name: string;
  /** 레벨 하나당 설명 */
  perLevel: string;
}

export const PASSIVES: Readonly<Record<PassiveId, PassiveInfo>> = {
  wick: { name: '굵은 심지', perLevel: '모든 피해 +10%' },
  hourglass: { name: '모래시계', perLevel: '재사용 시간 -7%' },
  boots: { name: '가벼운 장화', perLevel: '이동 속도 +8%' },
  magnet: { name: '자석 돌', perLevel: '빛 조각 줍는 거리 +30%' },
  coat: { name: '두꺼운 외투', perLevel: '최대 체력 +20, 회복' },
  lens: { name: '유리 렌즈', perLevel: '공격 범위 +10%' },
  // 선택 카드에는 이 글 대신 그 레벨에서 몇 초마다 다시 생기는지를 적는다(rules.ts의 upgradeDescription).
  hood: { name: '등갓', perLevel: '피해를 한 번 막는 빛막, 다시 생기는 시간 -3초' },
};

/** 등갓의 빛막이 다시 생기는 데 걸리는 시간(초): 1레벨의 값과 레벨마다 줄어드는 값 */
export const GUARD = { seconds: 24, perLevel: 3 } as const;

export type HeroId = 'keeper' | 'stargazer' | 'stormer';

/** 캐릭터마다 다른 능력. 더하는 값(maxHp)과 곱하는 값(나머지)이 있다. */
export interface HeroTrait {
  /** 최대 체력에 더한다 */
  maxHp?: number;
  speed?: number;
  cooldown?: number;
  area?: number;
  xp?: number;
}

export interface HeroInfo {
  name: string;
  /** 어떤 캐릭터인지 한 줄 */
  blurb: string;
  /** 고유 특성에서 좋은 점을 숫자로 */
  perk: string;
  /** 그 대신 치르는 값. 없으면 비운다. */
  flaw?: string;
  /** 처음 들고 나오는 무기 */
  weapon: WeaponId;
  trait: HeroTrait;
  /** 최고 기록이 이만큼(초) 되면 열린다. 0이면 처음부터 열려 있다. */
  unlockSeconds: number;
}

export const HEROES: Readonly<Record<HeroId, HeroInfo>> = {
  keeper: {
    name: '등불지기',
    blurb: '튼튼해서 처음 하기 좋다',
    perk: '최대 체력 +20',
    weapon: 'ember',
    trait: { maxHp: 20 },
    unlockSeconds: 0,
  },
  stargazer: {
    name: '별지기',
    blurb: '넓게 때리고 빨리 자란다',
    perk: '범위 +20% · 경험치 +10%',
    flaw: '최대 체력 -15',
    weapon: 'star',
    trait: { area: 1.2, xp: 1.1, maxHp: -15 },
    unlockSeconds: 120,
  },
  stormer: {
    name: '번개잡이',
    blurb: '발이 빠르고 손이 잦다',
    perk: '이동 +12% · 재사용 -10%',
    flaw: '최대 체력 -25',
    weapon: 'bolt',
    trait: { speed: 1.12, cooldown: 0.9, maxHp: -25 },
    unlockSeconds: 360,
  },
};

export const HERO_ORDER: readonly HeroId[] = ['keeper', 'stargazer', 'stormer'];

/** 판 밖에서 불씨로 올리는 영구 강화 */
export type MetaId =
  | 'vigor'
  | 'swift'
  | 'might'
  | 'greed'
  | 'reach'
  | 'mend'
  | 'lucky'
  | 'second'
  | 'armor'
  | 'reroll'
  | 'headstart';

export interface MetaInfo {
  name: string;
  perLevel: string;
  maxLevel: number;
  /** 첫 단계 가격. 단계가 오를 때마다 이만큼씩 비싸진다. */
  baseCost: number;
}

export const META: Readonly<Record<MetaId, MetaInfo>> = {
  vigor: { name: '튼튼한 몸', perLevel: '최대 체력 +10', maxLevel: 5, baseCost: 12 },
  swift: { name: '날랜 걸음', perLevel: '이동 속도 +4%', maxLevel: 5, baseCost: 12 },
  might: { name: '뜨거운 불꽃', perLevel: '모든 피해 +5%', maxLevel: 5, baseCost: 16 },
  greed: { name: '빛 모으기', perLevel: '얻는 경험치 +8%', maxLevel: 5, baseCost: 14 },
  reach: { name: '긴 손', perLevel: '줍는 거리 +15%', maxLevel: 3, baseCost: 10 },
  mend: { name: '따뜻한 품', perLevel: '10초마다 체력 +1', maxLevel: 3, baseCost: 14 },
  lucky: { name: '불씨 복', perLevel: '얻는 불씨 +10%', maxLevel: 3, baseCost: 18 },
  second: { name: '되살림 등불', perLevel: '쓰러져도 한 번 일어난다', maxLevel: 1, baseCost: 60 },
  // 깊은 밤을 내려가는 데 쓰는 것들. 값이 비싸서 완주한 뒤에 모으게 된다.
  armor: { name: '질긴 가죽', perLevel: '받는 피해 -4%', maxLevel: 5, baseCost: 20 },
  reroll: { name: '다시 뽑기', perLevel: '레벨업 선택지 다시 뽑기 +1번', maxLevel: 3, baseCost: 40 },
  headstart: { name: '밝은 출발', perLevel: '시작할 때 강화 하나 더 고르기', maxLevel: 2, baseCost: 50 },
};

export const META_ORDER: readonly MetaId[] = [
  'vigor',
  'swift',
  'might',
  'greed',
  'reach',
  'mend',
  'lucky',
  'second',
  'armor',
  'reroll',
  'headstart',
];
