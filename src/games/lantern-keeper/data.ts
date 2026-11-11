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

export type EnemyKind = 'shade' | 'bat' | 'brute' | 'wisp' | 'giant' | 'lord';

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
  boss?: boolean;
}

export const ENEMIES: Readonly<Record<EnemyKind, EnemyInfo>> = {
  shade: { name: '그림자 방울', hp: 6, speed: 22, damage: 5, xp: 1, radius: 6 },
  bat: { name: '밤박쥐', hp: 5, speed: 40, damage: 4, xp: 1, radius: 5 },
  wisp: { name: '도깨비불', hp: 14, speed: 30, damage: 8, xp: 2, radius: 5 },
  brute: { name: '돌그림자', hp: 45, speed: 15, damage: 12, xp: 4, radius: 8 },
  // 중간 보스의 체력은 MID_BOSS_TIERS가 정한다. 여기 적힌 값은 첫 번째 것과 같다.
  giant: { name: '어스름 거인', hp: 320, speed: 30, damage: 18, xp: 30, radius: 15, boss: true },
  lord: { name: '밤의 왕관', hp: 4000, speed: 27, damage: 24, xp: 0, radius: 17, boss: true },
};

/** 몇 초부터 어떤 적이 얼마나 섞여 나오는지. 뒤쪽 줄일수록 나중에 열린다. */
export const SPAWN_TABLE: ReadonlyArray<{ kind: EnemyKind; from: number; weight: number }> = [
  { kind: 'shade', from: 0, weight: 10 },
  { kind: 'bat', from: 75, weight: 6 },
  { kind: 'wisp', from: 200, weight: 5 },
  { kind: 'brute', from: 160, weight: 2 },
];

/**
 * 중간 보스는 나올 때마다 강해진다. 0번이 2분에 나오는 첫 번째.
 * hp는 체력, summon은 한 번에 불러내는 부하의 수, minion은 그 부하의 종류.
 */
export const MID_BOSS_TIERS: ReadonlyArray<{ hp: number; summon: number; minion: EnemyKind }> = [
  { hp: 320, summon: 4, minion: 'bat' },
  { hp: 700, summon: 5, minion: 'bat' },
  { hp: 1500, summon: 6, minion: 'wisp' },
  { hp: 2400, summon: 8, minion: 'wisp' },
];

/** 이 시각들에 적이 둥글게 에워싸는 "밀물"이 한 번씩 온다(초). 중간 보스와 겹치지 않게 그 사이에 둔다. */
export const SURGES: readonly number[] = [180, 300, 420, 540];

export type WeaponId = 'ember' | 'aura' | 'firefly' | 'star' | 'lance' | 'oil' | 'bolt';
export type PassiveId = 'wick' | 'hourglass' | 'boots' | 'magnet' | 'coat' | 'lens';

/** 레벨업으로 올릴 수 있는 무기와 패시브의 최대 레벨 */
export const MAX_LEVEL = 5;
/**
 * 무기가 이 레벨이 되면 이름과 모습이 바뀌는 최종 진화형이 된다.
 * MAX_LEVEL인 무기에 무기 강화권을 써야만 올라간다.
 */
export const EVOLVE_LEVEL = MAX_LEVEL + 1;
/** 한 판에 들 수 있는 무기의 수 */
export const MAX_WEAPONS = 4;

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
};

/** 판 밖에서 불씨로 올리는 영구 강화 */
export type MetaId = 'vigor' | 'swift' | 'might' | 'greed' | 'reach';

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
};

export const META_ORDER: readonly MetaId[] = ['vigor', 'swift', 'might', 'greed', 'reach'];
