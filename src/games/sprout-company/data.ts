/**
 * 새싹 컴퍼니의 내용: 업무, 직원, 장비, 사무실, 프로젝트.
 * 내용을 늘릴 때는 여기 표에 한 줄을 더하면 된다. 계산(rules.ts)과 화면은 표를 읽어서 움직인다.
 * 세이브에는 여기 적힌 id와 레벨만 남으므로, id는 한 번 정하면 바꾸지 않는다.
 */
import type { SpriteKey } from '../../art/sprites';

export const COMPANY_GAME_ID = 'sprout-company';
export const COMPANY_SCENE = 'SproutCompany';

// ───────── 업무 ─────────

/** 게임 하나를 만드는 데 드는 네 가지 일. 카드의 색과 모양이 이것으로 정해진다. */
export const TASK_KINDS = ['plan', 'art', 'code', 'test'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const TASKS: Readonly<Record<TaskKind, { name: string }>> = {
  plan: { name: '기획' },
  art: { name: '그림' },
  code: { name: '코딩' },
  test: { name: '검사' },
};

// ───────── 효과 ─────────

/**
 * 강화가 올려 주는 것. 장비와 직원의 성격이 모두 이 꼴로 적혀 있어서,
 * 새 장비나 새 직원을 넣을 때 계산 코드를 고치지 않아도 된다.
 * - workSpeed: 일하는 속도 (장비가 책상 것이면 그 자리만, 회사 것이면 모두. 직원의 성격이면 그 직원만)
 * - income: 출시작이 초마다 버는 잎사귀
 * - bonus: 출시할 때 한 번 받는 잎사귀
 */
export const EFFECT_KEYS = ['workSpeed', 'income', 'bonus'] as const;
export type EffectKey = (typeof EFFECT_KEYS)[number];

/** amount는 한 레벨(또는 한 사람)마다 더해지는 비율이다. 0.1이면 10%. */
export interface Effect {
  key: EffectKey;
  amount: number;
}

// ───────── 직원 ─────────

export interface StaffDef {
  name: string;
  /** 꾸미기의 캐릭터 id(art/cosmetics.ts의 RUNNER_LOOKS). 없으면 texture를 쓴다. */
  look: string | null;
  /** look이 없는 친구의 그림 */
  texture?: string;
  /** 이 업무는 두 배 빠르게 끝낸다. */
  specialty: TaskKind;
  /** 타고난 성격. 작은 보너스 하나 */
  trait: Effect;
}

export const STAFF = {
  sprout: { name: '새싹이', look: 'runner-sprout', specialty: 'plan', trait: { key: 'bonus', amount: 0.1 } },
  drop: { name: '물방울', look: 'runner-drop', specialty: 'art', trait: { key: 'workSpeed', amount: 0.1 } },
  duck: { name: '오리', look: 'runner-duck', specialty: 'code', trait: { key: 'workSpeed', amount: 0.1 } },
  chick: { name: '병아리', look: 'runner-chick', specialty: 'test', trait: { key: 'income', amount: 0.1 } },
  dog: { name: '강아지', look: 'runner-dog', specialty: 'plan', trait: { key: 'bonus', amount: 0.1 } },
  ghost: { name: '꼬마 유령', look: 'runner-ghost', specialty: 'code', trait: { key: 'income', amount: 0.1 } },
  cat: { name: '고양이', look: null, texture: 'card-cat', specialty: 'art', trait: { key: 'workSpeed', amount: 0.1 } },
} as const satisfies Record<string, StaffDef>;

export type StaffId = keyof typeof STAFF;
export const STAFF_ORDER = Object.keys(STAFF) as StaffId[];

/** 회사를 세울 때 사장 옆자리에 앉는 첫 직원. 사장과 같은 친구면 그다음 친구가 앉는다. */
export const FIRST_HIRES: readonly StaffId[] = ['chick', 'duck'];

/** 채용할 때 한 번에 보여 주는 지원자의 수 */
export const CANDIDATE_COUNT = 3;

/** 채용에 드는 잎사귀: 지금 직원이 n명일 때 base × growth^(n - 2). 사장과 첫 직원은 그냥 있다. */
export const HIRE_COST = { base: 150, growth: 4 } as const;

/** 특기인 업무를 할 때의 속도 배수 */
export const SPECIALTY_BOOST = 2;
/** 교육으로 레벨이 하나 오를 때마다 더해지는 속도. 교육은 다음 단계에서 넣는다. */
export const LEVEL_SPEED = 0.1;

// ───────── 응원 ─────────

/** 일하는 책상을 누르면 이만큼(초) 동안 그 자리가 CHEER_BOOST배로 빨라진다. 다시 누르면 처음부터 다시 센다. */
export const CHEER_SECONDS = 4;
export const CHEER_BOOST = 2;

// ───────── 장비 ─────────

export interface EquipmentDef {
  name: string;
  /** 한 줄 설명. 장비 화면에 보인다. */
  description: string;
  /** desk면 책상마다 따로 올리고, company면 회사에 하나다. */
  scope: 'desk' | 'company';
  maxLevel: number;
  /** n레벨에서 n+1레벨로 올리는 값: baseCost × growth^n */
  baseCost: number;
  growth: number;
  effect: Effect;
  /** 이 사무실 단계(0부터)부터 살 수 있다. */
  unlockOffice: number;
}

export const EQUIPMENT = {
  computer: {
    name: '컴퓨터',
    description: '그 자리의 일 속도 +25%',
    scope: 'desk',
    maxLevel: 20,
    baseCost: 30,
    growth: 1.6,
    effect: { key: 'workSpeed', amount: 0.25 },
    unlockOffice: 0,
  },
  coffee: {
    name: '커피 머신',
    description: '모든 직원의 일 속도 +8%',
    scope: 'company',
    maxLevel: 15,
    baseCost: 200,
    growth: 1.8,
    effect: { key: 'workSpeed', amount: 0.08 },
    unlockOffice: 1,
  },
} as const satisfies Record<string, EquipmentDef>;

export type EquipmentId = keyof typeof EQUIPMENT;
export const EQUIPMENT_ORDER = Object.keys(EQUIPMENT) as EquipmentId[];

// ───────── 사무실 ─────────

export interface OfficeDef {
  name: string;
  /** 이사 오려면 필요한 평판 */
  reputation: number;
  /** 이사에 드는 잎사귀 */
  cost: number;
  /** 책상 자리. 직원은 사장까지 쳐서 이만큼 둘 수 있다. */
  desks: number;
}

/** 작은 곳부터 큰 곳 순서. 뒤에 줄을 더하면 단계가 늘어난다. */
export const OFFICES: readonly OfficeDef[] = [
  { name: '옥탑방', reputation: 0, cost: 0, desks: 2 },
  { name: '작은 사무실', reputation: 30, cost: 250, desks: 4 },
  { name: '한 층 사무실', reputation: 200, cost: 15000, desks: 6 },
];

/** 일감함에 한 번에 쌓아 둘 수 있는 카드의 수. 프로젝트의 카드 수는 이것을 넘지 못한다. */
export const INBOX_SLOTS = 8;

// ───────── 프로젝트 ─────────

export interface ProjectDef {
  /** 출시작의 이름. 포켓 아케이드의 실제 게임 이름을 쓴다. */
  title: string;
  icon: SpriteKey;
  /** 필요한 업무 카드. 적힌 차례대로 일감함에 놓인다. */
  cards: readonly TaskKind[];
  /** 카드 한 장에 드는 일의 양. 속도 1인 직원이 이만큼의 초를 들인다. */
  work: number;
  /** 출시할 때 한 번 받는 잎사귀 */
  bonus: number;
  /** 출시한 뒤로 초마다 버는 잎사귀 */
  income: number;
  /** 처음 출시할 때 오르는 평판 */
  reputation: number;
  /** 이 사무실 단계(0부터)부터 만들 수 있다. */
  unlockOffice: number;
}

export const PROJECTS = {
  'lightning-tap': {
    title: '번개 탭',
    icon: 'icon-bolt',
    cards: ['plan', 'art', 'code', 'test'],
    work: 10,
    bonus: 18,
    income: 0.2,
    reputation: 5,
    unlockOffice: 0,
  },
  'stack-tower': {
    title: '탑 쌓기',
    icon: 'icon-tower',
    cards: ['plan', 'art', 'code', 'code'],
    work: 12,
    bonus: 24,
    income: 0.25,
    reputation: 5,
    unlockOffice: 0,
  },
  'memory-cards': {
    title: '기억 카드',
    icon: 'icon-cards',
    cards: ['plan', 'art', 'art', 'code', 'test'],
    work: 45,
    bonus: 110,
    income: 0.6,
    reputation: 10,
    unlockOffice: 1,
  },
  'jump-runner': {
    title: '점프 러너',
    icon: 'icon-runner',
    cards: ['plan', 'art', 'art', 'code', 'code', 'test'],
    work: 55,
    bonus: 200,
    income: 1.1,
    reputation: 14,
    unlockOffice: 1,
  },
  'gate-run': {
    title: '관문 달리기',
    icon: 'icon-gate',
    cards: ['plan', 'art', 'code', 'code', 'test', 'test'],
    work: 65,
    bonus: 320,
    income: 1.8,
    reputation: 18,
    unlockOffice: 1,
  },
  'color-sort': {
    title: '색깔 물 나누기',
    icon: 'icon-flask',
    cards: ['plan', 'plan', 'art', 'art', 'code', 'code', 'test', 'test'],
    work: 180,
    bonus: 700,
    income: 4,
    reputation: 30,
    unlockOffice: 2,
  },
  'pin-pull': {
    title: '핀 뽑기',
    icon: 'icon-pin',
    cards: ['plan', 'art', 'art', 'code', 'code', 'code', 'test', 'test'],
    work: 220,
    bonus: 1100,
    income: 6,
    reputation: 40,
    unlockOffice: 2,
  },
  'parking-out': {
    title: '주차장 빼기',
    icon: 'icon-car',
    cards: ['plan', 'plan', 'art', 'art', 'code', 'code', 'code', 'test'],
    work: 260,
    bonus: 1700,
    income: 9,
    reputation: 50,
    unlockOffice: 2,
  },
} as const satisfies Record<string, ProjectDef>;

export type ProjectId = keyof typeof PROJECTS;
export const PROJECT_ORDER = Object.keys(PROJECTS) as ProjectId[];

/**
 * 이미 출시한 게임을 다시 만들면 "업데이트"가 된다. 지금까지 낸 횟수가 n일 때:
 * 일의 양은 work^n배, 출시 보너스는 bonus^n배가 되고, 초당 수익은 처음 값의 income만큼 더 붙는다.
 * 평판은 처음 값의 reputation배(올림)만 오른다.
 */
export const UPDATE_SCALE = { work: 1.3, bonus: 1.2, income: 0.4, reputation: 0.4 } as const;
