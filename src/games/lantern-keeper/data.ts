/**
 * 등불지기의 밸런스 데이터. 숫자만 바꿔서 난이도와 성장 속도를 맞춘다.
 * 화면이나 Phaser에 의존하지 않는다.
 */

/** 씬 이름과 세이브에 쓰는 게임 id. 한 번 정하면 바꾸지 않는다. */
export const LANTERN_SCENE = 'LanternKeeper';
export const LANTERN_GAME_ID = 'lantern-keeper';

/** 한 판의 길이(초). 끝에 마지막 보스가 나온다. */
export const RUN_SECONDS = 600;
/** 중간 보스가 나오는 시각(초) */
export const MID_BOSS_AT = 300;

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
  giant: { name: '어스름 거인', hp: 900, speed: 30, damage: 18, xp: 40, radius: 15, boss: true },
  lord: { name: '밤의 왕관', hp: 3200, speed: 27, damage: 24, xp: 0, radius: 17, boss: true },
};

/** 몇 초부터 어떤 적이 얼마나 섞여 나오는지. 뒤쪽 줄일수록 나중에 열린다. */
export const SPAWN_TABLE: ReadonlyArray<{ kind: EnemyKind; from: number; weight: number }> = [
  { kind: 'shade', from: 0, weight: 10 },
  { kind: 'bat', from: 75, weight: 6 },
  { kind: 'wisp', from: 200, weight: 5 },
  { kind: 'brute', from: 160, weight: 2 },
];

/** 이 시각들에 적이 둥글게 에워싸는 "밀물"이 한 번씩 온다(초). */
export const SURGES: readonly number[] = [150, 240, 420, 510];

export type WeaponId = 'ember' | 'aura' | 'firefly' | 'star';
export type PassiveId = 'wick' | 'hourglass' | 'boots' | 'magnet' | 'coat' | 'lens';

export const MAX_LEVEL = 5;

export interface WeaponInfo {
  name: string;
  /** 레벨마다 무엇이 좋아지는지. 0번이 처음 얻을 때 설명. */
  levels: readonly string[];
}

export const WEAPONS: Readonly<Record<WeaponId, WeaponInfo>> = {
  ember: {
    name: '불씨탄',
    levels: ['가까운 적에게 불씨를 쏜다', '피해 +4', '한 발 더', '재사용 -15%', '한 발 더, 관통 1'],
  },
  aura: {
    name: '등불 고리',
    levels: ['둘레의 적을 계속 태운다', '범위 +5', '피해 +3', '범위 +5', '피해 +4, 느리게'],
  },
  firefly: {
    name: '반딧불',
    levels: ['반딧불이 둘레를 돈다', '한 마리 더', '피해 +4', '한 마리 더', '한 마리 더, 빠르게'],
  },
  star: {
    name: '별똥',
    levels: ['화면 안의 적에게 별이 떨어진다', '피해 +8', '한 개 더', '범위 +5', '한 개 더, 재사용 -20%'],
  },
};

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
