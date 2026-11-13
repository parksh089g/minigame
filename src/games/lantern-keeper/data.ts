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
  | 'cinder'
  | 'soot'
  | 'clinker'
  | 'slag'
  | 'smoker'
  | 'blister'
  | 'flake'
  | 'sleet'
  | 'frost'
  | 'floe'
  | 'hail'
  | 'bloat'
  | 'prowler'
  | 'lurker'
  | 'stoker'
  | 'fang'
  | 'giant'
  | 'ram'
  | 'owl'
  | 'lord'
  | 'matron'
  | 'warden'
  | 'blizzard'
  | 'cone'
  | 'leaf'
  | 'acorn'
  | 'log'
  | 'needle'
  | 'husk'
  | 'glider'
  | 'elder';

/**
 * 보스가 싸우는 방식.
 * summon 부하를 불러낸다 · charge 힘을 모았다 돌진한다 · volley 빛을 흩뿌려 쏜다
 * lord 돌진한 뒤 부하를 부른다 · matron 사방으로 쏘기와 부하 부르기를 번갈아 한다
 * warden 돌진과 부채꼴로 쏘기를 번갈아 한다
 * blizzard 사방으로 여러 겹을 엇갈려 쏘기와 부하 부르기를 번갈아 한다
 * elder 땅을 굴러 틈이 난 땅울림 고리를 퍼뜨리기와 부하 부르기를 번갈아 한다
 */
export type BossBrain = 'summon' | 'charge' | 'volley' | 'lord' | 'matron' | 'warden' | 'blizzard' | 'elder';

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
  /**
   * 싸움터에 한꺼번에 있을 수 있는 수. 멀리 서서 버티는 적이라 잘 쓰러지지 않아서,
   * 정해 두지 않으면 판이 길어질수록 쌓인다. 이만큼 있으면 그 자리에는 스테이지의 가장 흔한 적이 대신 나온다.
   */
  limit: number;
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
  /** 쓰러지면 이 적 여럿으로 쪼개진다 */
  splits?: { into: EnemyKind; count: number };
  shoots?: ShootInfo;
  bursts?: BurstInfo;
  /** 닿으면 플레이어의 발이 이만큼(초) 얼어 느려진다(CHILL_SLOW). 빛막이 막아 줬을 때는 얼지 않는다. */
  chills?: number;
  /**
   * 쓰러진 자리에 싹을 남긴다. 싹은 이만큼(초) 뒤에 그 스테이지의 가장 흔한 그림자로 자라고,
   * 그 전에 플레이어가 밟으면 사라진다(SPROUT).
   */
  sprouts?: number;
  /** 빛버섯을 딛고 높이 뛰어, 뛸 때 플레이어가 있던 자리를 덮친다(GLIDE). 빛버섯 숲의 정예다. */
  springs?: boolean;
  /** 정예 그림자: 가끔 하나씩 나오는 크고 센 그림자. 쓰러지면 보물 상자를 떨어뜨린다(ELITE). */
  elite?: boolean;
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
    shoots: { range: 84, every: 5, windup: 0.7, damage: 4, limit: 4 },
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
    shoots: { range: 90, every: 5.2, windup: 0.7, damage: 4, limit: 4 },
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
  // 잿빛 고개
  cinder: { name: '재방울', hp: 7, speed: 22, damage: 5, xp: 1, radius: 6 },
  soot: { name: '검댕 날개', hp: 5, speed: 42, damage: 4, xp: 1, radius: 5 },
  clinker: { name: '숯덩이', hp: 20, speed: 26, damage: 8, xp: 2, radius: 7, splits: { into: 'cinder', count: 2 } },
  slag: { name: '굳은 쇳물', hp: 56, speed: 14, damage: 13, xp: 5, radius: 9 },
  smoker: {
    name: '연기 눈',
    hp: 11,
    speed: 22,
    damage: 5,
    xp: 2,
    radius: 6,
    shoots: { range: 88, every: 5, windup: 0.7, damage: 4, limit: 4 },
  },
  blister: {
    name: '끓는 방울',
    hp: 28,
    speed: 32,
    damage: 6,
    xp: 3,
    radius: 6,
    bursts: { trigger: 25, fuse: 0.95, radius: 32, damage: 12, splash: 42 },
  },
  // 바람 설원
  flake: { name: '눈방울', hp: 7, speed: 22, damage: 5, xp: 1, radius: 6 },
  sleet: { name: '서리나비', hp: 5, speed: 42, damage: 4, xp: 1, radius: 5 },
  frost: { name: '서릿발', hp: 17, speed: 28, damage: 7, xp: 2, radius: 6, chills: 1.5 },
  floe: { name: '얼음 바위', hp: 58, speed: 14, damage: 13, xp: 5, radius: 9 },
  hail: {
    name: '우박 눈',
    hp: 11,
    speed: 22,
    damage: 5,
    xp: 2,
    radius: 6,
    shoots: { range: 88, every: 5.1, windup: 0.7, damage: 4, limit: 4 },
  },
  bloat: {
    name: '부푼 눈꽃',
    hp: 28,
    speed: 31,
    damage: 6,
    xp: 3,
    radius: 6,
    bursts: { trigger: 25, fuse: 0.95, radius: 33, damage: 12, splash: 43 },
  },
  // 빛버섯 숲
  cone: { name: '솔방울', hp: 7, speed: 23, damage: 5, xp: 1, radius: 6 },
  leaf: { name: '가랑잎', hp: 5, speed: 44, damage: 4, xp: 1, radius: 5 },
  acorn: { name: '도토리', hp: 18, speed: 27, damage: 8, xp: 2, radius: 6, sprouts: 4 },
  log: { name: '통나무', hp: 60, speed: 14, damage: 13, xp: 5, radius: 9 },
  needle: {
    name: '솔잎 눈',
    hp: 11,
    speed: 22,
    damage: 5,
    xp: 2,
    radius: 6,
    shoots: { range: 88, every: 5, windup: 0.7, damage: 4, limit: 4 },
  },
  husk: {
    name: '부푼 꽈리',
    hp: 28,
    speed: 32,
    damage: 6,
    xp: 3,
    radius: 6,
    bursts: { trigger: 25, fuse: 0.95, radius: 33, damage: 12, splash: 43 },
  },
  // 정예 그림자: 스테이지마다 하나. 체력은 다른 그림자처럼 시간이 갈수록 불어난다.
  prowler: { name: '밤 사냥꾼', hp: 150, speed: 30, damage: 14, xp: 12, radius: 11, elite: true },
  lurker: { name: '늪 도사리', hp: 140, speed: 62, damage: 14, xp: 12, radius: 11, hops: true, elite: true },
  stoker: { name: '불티 대장', hp: 175, speed: 25, damage: 16, xp: 12, radius: 12, elite: true },
  fang: { name: '서리 송곳니', hp: 150, speed: 29, damage: 14, xp: 12, radius: 11, elite: true, chills: 1.5 },
  glider: { name: '숲 날다람쥐', hp: 150, speed: 31, damage: 14, xp: 12, radius: 11, elite: true, springs: true },
  // 중간 보스의 체력은 MID_BOSS_TIERS가 정한다. 여기 적힌 값은 첫 번째 것과 같다.
  giant: { name: '어스름 거인', hp: 320, speed: 30, damage: 18, xp: 30, radius: 15, boss: true, brain: 'summon' },
  ram: { name: '뿔그림자', hp: 320, speed: 26, damage: 20, xp: 30, radius: 14, boss: true, brain: 'charge' },
  owl: { name: '안개 올빼미', hp: 320, speed: 22, damage: 16, xp: 30, radius: 14, boss: true, brain: 'volley' },
  // 마지막 보스
  lord: { name: '밤의 왕관', hp: 4000, speed: 27, damage: 24, xp: 0, radius: 17, boss: true, brain: 'lord' },
  matron: { name: '늪의 어미', hp: 4000, speed: 23, damage: 22, xp: 0, radius: 17, boss: true, brain: 'matron' },
  warden: { name: '고개의 문지기', hp: 4000, speed: 25, damage: 23, xp: 0, radius: 17, boss: true, brain: 'warden' },
  blizzard: { name: '눈보라의 눈', hp: 4000, speed: 24, damage: 22, xp: 0, radius: 17, boss: true, brain: 'blizzard' },
  elder: { name: '숲의 고목', hp: 4000, speed: 22, damage: 23, xp: 0, radius: 17, boss: true, brain: 'elder' },
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

export type StageId = 'meadow' | 'marsh' | 'ridge' | 'tundra' | 'grove';

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
  /** 가끔 하나씩 나오는 정예 그림자 */
  elite: EnemyKind;
  finalBoss: EnemyKind;
  /** 발이 빠져 느려지는 웅덩이가 있는 곳 */
  puddles: boolean;
  /** 때맞춰 불길이 솟는 불구멍이 있는 곳. 그 위에 있으면 플레이어도 그림자도 덴다. */
  vents: boolean;
  /** 가끔 돌풍이 부는 곳. 부는 동안 플레이어와 그림자가 바람 부는 쪽으로 밀린다(terrain.ts의 GUST). */
  gusts: boolean;
  /** 빛버섯이 돋은 곳. 밟으면 플레이어가 걷던 쪽으로 높이 뛴다(terrain.ts의 LEAP). */
  shrooms: boolean;
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
    elite: 'prowler',
    finalBoss: 'lord',
    puddles: false,
    vents: false,
    gusts: false,
    shrooms: false,
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
    elite: 'lurker',
    finalBoss: 'matron',
    puddles: true,
    vents: false,
    gusts: false,
    shrooms: false,
    unlockSeconds: 240,
  },
  ridge: {
    name: '잿빛 고개',
    blurb: '불구멍이 달아오르면 비키자. 그림자도 함께 탄다',
    spawns: [
      { kind: 'cinder', from: 0, weight: 10 },
      { kind: 'soot', from: 60, weight: 6 },
      { kind: 'clinker', from: 110, weight: 4 },
      { kind: 'slag', from: 170, weight: 2 },
      { kind: 'smoker', from: 125, weight: 1 },
      { kind: 'blister', from: 270, weight: 1.2 },
    ],
    surge: ['soot', 'clinker'],
    minions: ['soot', 'cinder'],
    midBosses: ['ram', 'owl', 'giant', 'ram'],
    elite: 'stoker',
    finalBoss: 'warden',
    puddles: false,
    vents: true,
    gusts: false,
    shrooms: false,
    unlockSeconds: 420,
  },
  tundra: {
    name: '바람 설원',
    blurb: '돌풍이 그림자를 실어 온다. 바람 부는 쪽을 비워 두자',
    spawns: [
      { kind: 'flake', from: 0, weight: 10 },
      { kind: 'sleet', from: 60, weight: 6 },
      { kind: 'frost', from: 115, weight: 4.5 },
      { kind: 'floe', from: 170, weight: 2 },
      { kind: 'hail', from: 125, weight: 1 },
      { kind: 'bloat', from: 270, weight: 1.2 },
    ],
    surge: ['sleet', 'frost'],
    minions: ['sleet', 'flake'],
    midBosses: ['giant', 'owl', 'ram', 'giant'],
    elite: 'fang',
    finalBoss: 'blizzard',
    puddles: false,
    vents: false,
    gusts: true,
    shrooms: false,
    unlockSeconds: 540,
  },
  grove: {
    name: '빛버섯 숲',
    blurb: '빛버섯을 밟으면 껑충 뛴다. 싹은 자라기 전에 밟자',
    spawns: [
      { kind: 'cone', from: 0, weight: 10 },
      { kind: 'leaf', from: 55, weight: 6 },
      { kind: 'acorn', from: 110, weight: 4.5 },
      { kind: 'log', from: 165, weight: 2 },
      { kind: 'needle', from: 120, weight: 1 },
      { kind: 'husk', from: 260, weight: 1.2 },
    ],
    surge: ['leaf', 'acorn'],
    minions: ['leaf', 'cone'],
    midBosses: ['ram', 'giant', 'owl', 'ram'],
    elite: 'glider',
    finalBoss: 'elder',
    puddles: false,
    vents: false,
    gusts: false,
    shrooms: true,
    unlockSeconds: 600,
  },
};

export const STAGE_ORDER: readonly StageId[] = ['meadow', 'marsh', 'ridge', 'tundra', 'grove'];

/** 서릿발 같은 그림자에 닿아 발이 얼어 있는 동안의 이동 속도 배율 */
export const CHILL_SLOW = 0.6;

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

/**
 * 정예 그림자. 정해진 시각마다 스테이지의 정예(STAGES의 elite)가 하나씩 화면 가장자리에서 걸어온다.
 * 보스는 아니어서 밀리고 느려지지만, 체력의 몫으로 깎는 것(등불 기둥, 불구멍, 불꽃 단지)에는 훨씬 덜 다친다.
 * 쓰러지면 보물 상자를 떨어뜨린다. 새벽 뒤의 끝없는 밤에는 나오지 않는다.
 */
export const ELITE = {
  /** 나오는 시각(초). 밀물이 지나가고 30초 뒤, 다음 중간 보스가 오기 30초 전이다. */
  times: [90, 210, 330, 450, 570],
  /** 켜진 등불 기둥이 한 번 태울 때 잃는 체력의 몫. 빛 속에 열 초쯤 붙잡아 두면 쓰러진다. */
  burn: 0.04,
  /** 터진 불구멍에 한 번 델 때 잃는 체력의 몫 */
  vent: 0.03,
  /** 불꽃 단지에 잃는 체력의 몫 */
  blast: 0.5,
} as const;

/** 도토리 같은 그림자가 쓰러진 자리에 남기는 싹(EnemyInfo.sprouts) */
export const SPROUT = {
  /** 밟았다고 보는 거리: 플레이어의 판정 반지름에 이만큼 더한다(px) */
  reach: 5,
  /** 싸움터에 한꺼번에 있을 수 있는 싹의 수. 넘치면 가장 오래된 싹이 시든다. */
  limit: 30,
} as const;

/** 빛버섯을 딛고 덮치는 정예(EnemyInfo.springs) */
export const GLIDE = {
  /** 공중에 떠 있는 시간(초). 이 동안 내려앉을 자리가 바닥에 보인다. */
  seconds: 0.8,
  /** 내려앉은 뒤 다시 뛸 수 있을 때까지(초) */
  rest: 4,
  /** 한 번에 뛰는 가장 먼 거리(px). 플레이어가 이보다 멀면 그쪽으로 이만큼만 뛴다. */
  reach: 140,
  /** 이만큼(px) 안에 부푼 빛버섯이 있고 거기서 플레이어가 닿는 거리면, 플레이어 대신 그 버섯 쪽으로 간다. */
  seek: 90,
  /** 내려앉을 때 다치는 둘레(px)와 피해. 피해는 예고가 있는 공격이라 깊은 밤의 단계만 따른다. */
  radius: 22,
  damage: 16,
} as const;

/**
 * 숲의 고목이 땅을 굴러 퍼뜨리는 땅울림 고리. 고리에는 틈이 나 있어서 틈으로 지나가거나,
 * 빛버섯을 밟고 뛰어 공중에 있는 동안 고리가 지나가게 하면 다치지 않는다.
 */
export const QUAKE = {
  /** 땅을 구르기 전에 멈춰서 힘을 모으는 시간(초) */
  windup: 0.9,
  /** 고리가 퍼지는 빠르기(px/초)와 사라지는 반지름(px) */
  speed: 72,
  reach: 180,
  /** 고리의 두께(px) */
  band: 8,
  /** 틈의 수와 틈 하나의 폭(라디안) */
  gaps: 3,
  gap: 0.75,
  damage: 16,
  /** 체력이 이 몫 아래로 내려가면 고리를 두 겹씩 퍼뜨린다. 두 번째 겹의 틈은 첫 겹의 틈 사이에 난다. */
  rage: 0.5,
  /** 두 겹을 퍼뜨릴 때 겹 사이의 시간(초) */
  echo: 0.7,
  /** 고리를 퍼뜨린 뒤 부하를 부르기까지, 부하를 부른 뒤 다시 힘을 모으기까지 쫓는 시간(초). 뒤의 것은 windup만큼 짧다. */
  rest: 3.2,
} as const;

/**
 * 보물 상자. 주우면 가진 무기나 패시브 가운데 하나가 한 단계 오른다(진화는 시키지 않는다).
 * 더 올릴 것이 없으면 불씨를 준다.
 */
export const CHEST = {
  /** 올릴 것이 없을 때 주는 불씨 */
  embers: 10,
} as const;

/**
 * 끝없는 밤: 새벽을 맞은 뒤에도 쓰러질 때까지 이어 가는 판. 새벽까지의 난이도 위에 아래 값이 더 얹힌다.
 * 그림자가 분마다 곱으로 튼튼해져서, 아무리 센 빌드도 언젠가는 밀린다.
 */
export const ENDLESS = {
  /** 1분마다 그림자와 보스의 체력에 곱해지는 값 */
  hp: 1.6,
  /** 1분마다 받는 피해에 곱해지는 값. 체력처럼 곱으로 자라서, 막는 쪽 축복만 쌓아서는 끝까지 버틸 수 없다. */
  damage: 1.25,
  /** 1분마다 그림자의 빠르기에 더해지는 비율과 그 상한. 오래 끌면 걸어서는 따돌릴 수 없게 된다. */
  speed: 0.04,
  maxSpeed: 0.6,
  /** 보스가 나오는 간격(초). 중간 보스 세 가지가 차례로 돌아가며 나온다. */
  bossEvery: 90,
  /** 밀물의 간격(초)과, 한 번에 에워싸는 수. 첫 밀물은 간격의 절반이 지났을 때 온다. */
  surgeEvery: 60,
  surgeCount: 42,
  /** 밤의 축복을 하나 고르는 간격(초). 끝없는 밤에 들어설 때 한 번, 그 뒤로 이 간격마다 한 번씩 고른다. */
  boonEvery: 60,
} as const;

/**
 * 밤의 축복: 끝없는 밤에서만 받는 강화. 같은 것을 몇 번이든 겹쳐 받을 수 있다.
 * 그림자가 세지는 간격(1분)마다 셋 가운데 하나를 고르고, 끝없는 밤에서는 레벨업과 무기 강화권의 빈자리도 축복이 채운다.
 * 겹칠수록 세지지만 그림자가 곱으로 자라는 것을 따라잡지는 못한다. 무엇을 고르느냐에 따라 버티는 길이가 달라진다.
 */
export type BoonId = 'blaze' | 'haste' | 'bulwark' | 'ward' | 'bloom' | 'breath';

export interface BoonInfo {
  name: string;
  description: string;
}

/** 축복 하나가 올려 주는 양. 설명의 숫자와 맞춘다. */
export const BOON_VALUES = {
  /** 주는 피해에 더해지는 비율 */
  blaze: 0.2,
  /** 공격 간격에 곱해지는 값 */
  haste: 0.9,
  /** 늘어나는 최대 체력. 받는 자리에서 그만큼 찬다. */
  bulwark: 20,
  /** 받는 피해에 곱해지는 값 */
  ward: 0.9,
  /** 공격 범위에 더해지는 비율 */
  bloom: 0.1,
  /** 1초에 차는 체력 */
  breath: 0.5,
} as const;

export const BOONS: Record<BoonId, BoonInfo> = {
  blaze: { name: '타오르는 심지', description: '주는 피해 +20%' },
  haste: { name: '잰 손놀림', description: '공격 간격 -10%' },
  bulwark: { name: '두꺼운 솜옷', description: '최대 체력 +20, 그만큼 회복' },
  ward: { name: '밤의 갑옷', description: '받는 피해 -10%' },
  bloom: { name: '넓은 빛', description: '공격 범위 +10%' },
  breath: { name: '깊은 숨', description: '1초에 체력 0.5씩 회복' },
};

export const BOON_ORDER: readonly BoonId[] = ['blaze', 'haste', 'bulwark', 'ward', 'bloom', 'breath'];

export type WeaponId =
  | 'ember'
  | 'aura'
  | 'firefly'
  | 'star'
  | 'lance'
  | 'oil'
  | 'bolt'
  | 'bell'
  | 'moon'
  | 'beam'
  | 'torch'
  | 'lamp';
export type PassiveId = 'wick' | 'hourglass' | 'boots' | 'magnet' | 'coat' | 'lens' | 'hood' | 'herb' | 'flint';

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

/**
 * 잔치의 밤: 새벽을 한 번 맞으면 준비 화면에서 고를 수 있는 판의 규칙. 무기를 여섯 가지까지 든다.
 * 칸만 늘리면 레벨업이 모자라 무기마다 레벨이 얕아지므로 경험치를 더 주고(얼마나 더 주는지가 난이도다),
 * 강화권이 중간 보스 넷에게서만 나오면 여섯을 다 진화시키기 어려우므로 정예 둘도 강화권을 준다.
 * 쉬운 단계일수록 끝없는 밤에서 오래 버티기 쉬워서 점수와 불씨에 작은 배율이 붙는다(랭킹과 불씨 모으기가 이 판으로 쏠리지 않게).
 * 오늘의 판은 누구나 같은 조건이어야 해서 늘 보통 판이다.
 */
export const FEAST = {
  name: '잔치의 밤',
  /** 들 수 있는 무기의 수 */
  weapons: 6,
  /** 쓰러뜨리면 보물 상자와 함께 무기 강화권도 주는 정예 그림자: ELITE.times의 몇 번째인지(0부터) */
  ticketElites: [2, 4] as readonly number[],
} as const;

/** 잔치의 밤의 난이도 */
export type FeastId = 'easy' | 'normal' | 'hard';

export interface FeastLevel {
  name: string;
  /** 얻는 경험치의 배율 */
  xp: number;
  /** 점수와, 판이 끝나고 받는 불씨에 붙는 배율 */
  reward: number;
}

/** 고르는 창에 늘어서는 차례 */
export const FEAST_ORDER: readonly FeastId[] = ['easy', 'normal', 'hard'];

/**
 * 영구 강화를 다 올린 자동 플레이로 잰 값(16판씩): 보통 판은 새벽까지 열에 다섯쯤 버틴다.
 * 어려움은 보통 판과 비슷하고, 보통은 조금 쉽고, 쉬움은 거의 늘 새벽을 맞는다.
 * 배율은 어느 난이도든 끝없는 밤의 최고 점수가 보통 판보다 낮고, 가운데 점수와 불씨는 보통 판과 비슷하게 맞췄다.
 */
export const FEAST_LEVELS: Readonly<Record<FeastId, FeastLevel>> = {
  easy: { name: '쉬움', xp: 2, reward: 0.6 },
  normal: { name: '보통', xp: 1.5, reward: 0.8 },
  hard: { name: '어려움', xp: 1.2, reward: 0.9 },
};

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
  bell: {
    name: '종소리',
    levels: ['종소리가 둘레로 퍼져 적을 밀어낸다', '피해 +4', '범위 +8', '재사용 -20%', '피해 +5, 더 멀리 밀어낸다'],
    evolved: { name: '새벽 종', description: '두 번 울리고, 닿은 적이 한동안 굼떠진다' },
  },
  moon: {
    name: '초승달',
    levels: ['가까운 적 쪽으로 날아갔다 돌아오며 두 번 벤다', '피해 +5', '더 멀리 날아간다', '한 개 더', '피해 +6, 재사용 -20%'],
    evolved: { name: '보름달', description: '크고 묵직한 달 셋이 지나는 길을 거듭 벤다' },
  },
  beam: {
    name: '등대빛',
    levels: ['긴 빛줄기가 둘레를 훑으며 돈다', '피해 +4', '더 멀리 닿는다', '한 줄기 더', '피해 +6, 더 빨리 돈다'],
    evolved: { name: '천 리 등대', description: '굵은 빛줄기 셋이 훨씬 멀리까지 훑는다' },
  },
  torch: {
    name: '횃불',
    levels: ['가까운 적 쪽을 부채꼴로 휘둘러 벤다', '피해 +4', '더 넓게 휘두른다', '맞은편도 벤다', '피해 +6, 재사용 -20%'],
    evolved: { name: '봉화', description: '앞뒤를 크고 넓게 휘둘러, 벤 그림자를 밀쳐 낸다' },
  },
  lamp: {
    name: '풍등',
    levels: ['그림자가 모인 곳 위로 날아가 불티를 떨군다', '하나 더', '피해 +3', '더 오래 머문다', '하나 더, 범위 +4'],
    evolved: { name: '풍등 축제', description: '크고 오래 타는 풍등 넷이 무리를 따라다닌다' },
  },
};

/** 선택지와 화면에 늘어놓는 순서 */
export const WEAPON_ORDER: readonly WeaponId[] = [
  'ember',
  'aura',
  'firefly',
  'star',
  'lance',
  'oil',
  'bolt',
  'bell',
  'moon',
  'beam',
  'torch',
  'lamp',
];

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
  herb: { name: '약초 주머니', perLevel: '1초마다 체력 +0.2' },
  // 선택 카드에는 이 글 대신 그 레벨에서의 확률을 적는다(rules.ts의 upgradeDescription).
  flint: { name: '부싯돌', perLevel: '쓰러진 그림자가 터질 확률 +7%' },
};

/** 약초 주머니가 레벨 하나당 1초에 채워 주는 체력 */
export const HERB_REGEN = 0.2;

/**
 * 부싯돌: 쓰러진 보통 그림자가 가끔 터져서 둘레의 그림자를 다치게 한다.
 * 그렇게 터져서 쓰러진 그림자는 다시 터지지 않는다(끝없이 이어지지 않게).
 */
export const FLINT = {
  /** 레벨 하나당 터질 확률 */
  chance: 0.07,
  /** 터지는 둘레의 반지름(px). 공격 범위 강화가 붙는다. */
  radius: 20,
  /** 둘레 안의 그림자가 받는 피해: 이만큼에 쓰러진 그림자의 최대 체력의 share배를 더한다. 피해 강화가 붙는다. */
  damage: 8,
  /** 튼튼한 그림자일수록 세게 터져서, 뒤로 갈수록 약해지지 않는다. */
  share: 0.4,
} as const;

/** 등갓의 빛막이 다시 생기는 데 걸리는 시간(초): 1레벨의 값과 레벨마다 줄어드는 값 */
export const GUARD = { seconds: 24, perLevel: 3 } as const;

export type HeroId = 'keeper' | 'stargazer' | 'stormer' | 'ringer' | 'mooner' | 'bearer';

/** 캐릭터마다 다른 능력. 더하는 값(maxHp)과 곱하는 값(나머지)이 있다. */
export interface HeroTrait {
  /** 최대 체력에 더한다 */
  maxHp?: number;
  speed?: number;
  cooldown?: number;
  area?: number;
  xp?: number;
  /** 주는 피해에 곱한다 */
  damage?: number;
  /** 받는 피해에 곱한다 */
  taken?: number;
  /** 1초마다 차는 체력에 더한다 */
  regen?: number;
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
    perk: '이동 +12% · 재사용 -15%',
    flaw: '최대 체력 -20',
    weapon: 'bolt',
    trait: { speed: 1.12, cooldown: 0.85, maxHp: -20 },
    unlockSeconds: 360,
  },
  ringer: {
    name: '종지기',
    blurb: '느리지만 좀처럼 쓰러지지 않는다',
    perk: '최대 체력 +30 · 받는 피해 -10%',
    flaw: '이동 -10% · 재사용 +5%',
    weapon: 'bell',
    trait: { maxHp: 30, taken: 0.9, speed: 0.9, cooldown: 1.05 },
    unlockSeconds: 480,
  },
  mooner: {
    name: '달잡이',
    blurb: '세게 베지만 한 대가 아프다',
    perk: '피해 +15%',
    flaw: '받는 피해 +15%',
    weapon: 'moon',
    trait: { damage: 1.15, taken: 1.15 },
    // 새벽을 한 번 맞으면 열린다.
    unlockSeconds: RUN_SECONDS,
  },
  bearer: {
    name: '횃불잡이',
    blurb: '가까이 베고 상처가 금방 아문다',
    perk: '초당 체력 +0.4 · 최대 체력 +10',
    flaw: '경험치 -10%',
    weapon: 'torch',
    trait: { regen: 0.4, maxHp: 10, xp: 0.9 },
    // 캐릭터는 고르는 줄의 차례대로 열린다. 달잡이처럼 새벽을 한 번 맞으면 열린다.
    unlockSeconds: RUN_SECONDS,
  },
};

export const HERO_ORDER: readonly HeroId[] = ['keeper', 'stargazer', 'stormer', 'ringer', 'mooner', 'bearer'];

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
