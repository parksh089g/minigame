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
 * - ease: 업무 카드 한 장에 드는 일을 줄인다 (0.03이면 3% 적게)
 * - reputation: 출시로 얻는 평판
 * - away: 닫아 둔 동안 쌓이는 수익
 * - cheer: 응원이 이어지는 시간
 * - rest: 휴게실에서 기운을 채우는 빠르기
 * - stamina: 기운이 버티는 시간
 */
export const EFFECT_KEYS = ['workSpeed', 'income', 'bonus', 'ease', 'reputation', 'away', 'cheer', 'rest', 'stamina'] as const;
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
  bear: { name: '곰', look: null, texture: 'sc-staff-bear', specialty: 'test', trait: { key: 'income', amount: 0.1 } },
  rabbit: { name: '토끼', look: null, texture: 'sc-staff-rabbit', specialty: 'plan', trait: { key: 'workSpeed', amount: 0.1 } },
  frog: { name: '개구리', look: null, texture: 'sc-staff-frog', specialty: 'art', trait: { key: 'bonus', amount: 0.1 } },
  penguin: { name: '펭귄', look: null, texture: 'sc-staff-penguin', specialty: 'code', trait: { key: 'workSpeed', amount: 0.1 } },
  fox: { name: '여우', look: null, texture: 'sc-staff-fox', specialty: 'test', trait: { key: 'bonus', amount: 0.1 } },
} as const satisfies Record<string, StaffDef>;

export type StaffId = keyof typeof STAFF;
export const STAFF_ORDER = Object.keys(STAFF) as StaffId[];

/** 회사를 세울 때 사장 옆자리에 앉는 첫 직원. 사장과 같은 친구면 그다음 친구가 앉는다. */
export const FIRST_HIRES: readonly StaffId[] = ['chick', 'duck'];

/**
 * 단짝: 둘이 옆자리(같은 줄의 바로 옆 책상)에 앉으면 둘 다 일이 speed만큼 빨라진다.
 * 한 친구는 한 짝에만 든다. 자리는 직원 창의 자리 바꾸기에서 옮긴다.
 */
export const BUDDIES: readonly (readonly [StaffId, StaffId])[] = [
  ['sprout', 'drop'],
  ['duck', 'chick'],
  ['dog', 'cat'],
  ['ghost', 'bear'],
  ['rabbit', 'fox'],
  ['frog', 'penguin'],
];
export const BUDDY = { speed: 0.2 } as const;

/** 채용할 때 한 번에 보여 주는 지원자의 수 */
export const CANDIDATE_COUNT = 3;

/** 채용에 드는 잎사귀: 지금 직원이 n명일 때 base × growth^(n - 2). 사장과 첫 직원은 그냥 있다. */
export const HIRE_COST = { base: 150, growth: 4 } as const;

/** 특기인 업무를 할 때의 속도 배수 */
export const SPECIALTY_BOOST = 2;
/** 교육으로 레벨이 하나 오를 때마다 더해지는 속도 */
export const LEVEL_SPEED = 0.15;

/** 교육: 잎사귀를 들여 직원의 레벨을 올린다. n레벨에서 n+1레벨로 올리는 값은 baseCost × growth^n */
export const TRAINING = { unlockOffice: 1, maxLevel: 10, baseCost: 150, growth: 1.8 } as const;

// ───────── 팀장 ─────────

export interface LeadLevel {
  /** 이 단계로 올리는 데 드는 잎사귀 */
  cost: number;
  /** 쉬는 친구가 생긴 뒤 카드를 맡기기까지 걸리는 시간(초) */
  delay: number;
  /** true면 특기에 맞는 카드를 골라서 맡긴다. 아니면 맨 앞의 카드를 준다. */
  match: boolean;
  /** 이 단계가 되면 달라지는 것. 직원 창에 보인다. */
  description: string;
}

/**
 * 팀장을 두면 쉬는 친구에게 일감함의 카드를 알아서 맡긴다. 단계가 오를수록 빨리, 잘 맡긴다.
 * 손으로 맡기는 것이 더 빠르고 특기도 맞출 수 있어서, 낮은 단계에서는 직접 하는 보람이 남는다.
 */
export const LEAD: { unlockOffice: number; levels: readonly LeadLevel[] } = {
  unlockOffice: 1,
  levels: [
    { cost: 800, delay: 3, match: false, description: '쉬는 친구에게 카드를 알아서 맡겨요' },
    { cost: 6000, delay: 1.5, match: false, description: '카드를 두 배 빨리 맡겨요' },
    { cost: 40000, delay: 0.5, match: true, description: '특기에 맞는 카드를 바로 맡겨요' },
  ],
};

// ───────── 처음 안내 ─────────

/**
 * 처음 겪는 일마다 한 번씩 뜨는 한 줄 안내. 언제 뜨는지는 tips.ts에 있다.
 * 적힌 차례가 띄우는 차례다.
 */
export const TIPS = {
  income: '출시한 게임은 초마다 잎사귀를 벌어요',
  gear: '장비 버튼에서 컴퓨터를 올리면 일이 빨라져요',
  update: '이미 낸 게임을 다시 만들면 업데이트가 돼요',
  move: '평판이 찼어요. 잎사귀를 모아 이사해요',
  hire: '빈 자리를 누르면 새 친구를 뽑을 수 있어요',
  goals: '목표 버튼에서 오늘의 목표를 볼 수 있어요',
  play: '수익을 누르면 낸 게임을 할 수 있어요',
  train: '직원 창에서 교육하면 그 친구가 빨라져요',
  lead: '팀장을 두면 카드를 알아서 맡겨 줘요',
  buddy: '단짝을 옆자리에 앉히면 더 빨라져요',
  energy: '기운이 남은 친구는 일이 더 빨라요',
  rush: '급한 의뢰를 제때 끝내면 잎사귀를 받아요',
  backlog: '큰 게임은 맡기는 대로 다음 카드가 나와요',
  dept: '사무실 버튼에서 부서를 세울 수 있어요',
  queue: '게임을 예약하면 저절로 이어서 만들어요',
  branch: '사무실 버튼에서 자회사를 세울 수 있어요',
  fruit: '자회사 창에서 열매로 본사의 힘을 올려요',
} as const;

export type TipId = keyof typeof TIPS;
export const TIP_IDS = Object.keys(TIPS) as TipId[];

/** 이 안내들이 생기기 전부터 하던 사람에게는 띄우지 않는 것: 그때도 있던 일에 대한 안내 */
export const OLD_HAND_TIPS: readonly TipId[] = ['income', 'gear', 'update', 'move', 'hire'];

// ───────── 부서 ─────────

export interface DepartmentDef {
  name: string;
  /** 이 부서가 맡는 업무. 부서원은 이 업무를 더 빨리 한다. 돕는 부서는 맡는 업무가 없어서 null이다. */
  kind: TaskKind | null;
  /**
   * 돕는 부서가 회사에 주는 효과. 부서원 한 명이 부서의 단계마다 amount만큼 올린다.
   * 부서원이 넷이고 5단계면 amount의 스무 배다. 일하는 부서에는 없다.
   */
  effect?: Effect;
}

/**
 * 부서는 두 가지다. 줄을 더하면 부서가 늘어난다.
 * - 일하는 부서(kind가 있음): 직원을 묶어 한 가지 업무를 더 잘하게 한다.
 * - 돕는 부서(effect가 있음): 부서원의 수만큼 회사 전체의 수익이나 평판을 올린다.
 *   부서원은 하던 대로 카드를 맡아 일하지만, 한 사람은 한 부서에만 들 수 있어서 일하는 부서의 덤은 받지 못한다.
 */
export const DEPARTMENTS = {
  plan: { name: '기획부', kind: 'plan' },
  art: { name: '그림부', kind: 'art' },
  code: { name: '개발부', kind: 'code' },
  test: { name: '검사부', kind: 'test' },
  music: { name: '음악부', kind: null, effect: { key: 'income', amount: 0.06 } },
  pr: { name: '홍보부', kind: null, effect: { key: 'reputation', amount: 0.04 } },
  service: { name: '고객 응대부', kind: null, effect: { key: 'away', amount: 0.04 } },
} as const satisfies Record<string, DepartmentDef>;

export type DepartmentId = keyof typeof DEPARTMENTS;
export const DEPARTMENT_ORDER = Object.keys(DEPARTMENTS) as DepartmentId[];

/**
 * 부서를 세우고 키우는 규칙. 0단계는 아직 세우지 않은 것이다.
 * n단계에서 n+1단계로 올리는 값은 baseCost × growth^n이고, seats[n - 1]이 n단계의 자리 수다.
 * 일하는 부서의 부서원은 그 부서의 업무를 단계마다 boost만큼 더 빨리 한다. 특기와는 곱으로 겹친다.
 * 직원은 한 부서에만 들 수 있다.
 */
export const DEPARTMENT = {
  unlockOffice: 4,
  maxLevel: 5,
  baseCost: 3_000_000,
  growth: 3,
  seats: [2, 3, 3, 4, 4],
  boost: 0.3,
} as const;

// ───────── 예약 줄 ─────────

/**
 * 만드는 게임이 있는 동안 다음에 만들 게임을 예약해 둔다.
 * 예약이 있으면 다 만든 게임을 저절로 출시하고 맨 앞의 예약을 시작한다. 닫아 둔 동안에도 이어진다.
 */
export const QUEUE = { unlockOffice: 4, slots: 3 } as const;

// ───────── 사무실을 옮길 때의 코인 ─────────

/** 그 사무실로 처음 이사하면 한 번 받는 허브의 코인. 자회사를 세운 뒤에 다시 지나갈 때는 받지 않는다. */
export const OFFICE_COINS: readonly number[] = [0, 10, 20, 40, 80];

// ───────── 닫아 둔 동안 ─────────

/**
 * 앱을 닫아 둔 동안에도 출시작이 잎사귀를 번다. 다만 열어 둔 때의 rate배만, maxSeconds까지만 쌓인다.
 * minSeconds보다 짧게 비운 것은 세지 않는다. 맡겨 둔 업무는 그동안에도 진행된다.
 */
export const AWAY = { minSeconds: 60, maxSeconds: 4 * 3600, rate: 0.25 } as const;

// ───────── 응원 ─────────

/** 일하는 책상을 누르면 이만큼(초) 동안 그 자리가 CHEER_BOOST배로 빨라진다. 다시 누르면 처음부터 다시 센다. */
export const CHEER_SECONDS = 4;
export const CHEER_BOOST = 2;

// ───────── 휴게실과 기운 ─────────

/**
 * 한 층 사무실부터 휴게실이 생기고, 친구마다 기운이 생긴다.
 * - 기운이 남아 있는 동안에는 일이 boost만큼 빠르다. 바닥나도 느려지지는 않고 보통 빠르기로 돌아갈 뿐이다.
 * - 기운은 일하는 동안 줄어서, 쉬지 않고 workSeconds초를 일하면 바닥난다.
 * - 기운이 바닥난 친구는 하던 일을 마치면 휴게실에 가서 restSeconds초 동안 쉬고 가득 채워 온다.
 *   휴게실 자리는 seats개라서 한꺼번에 여럿이 자리를 비우지는 않고, 급한 의뢰가 있는 동안에는 쉬러 가지 않는다.
 * - 일이 없어 자리에서 기다리는 동안에도 쉴 때의 idle배 빠르기로 천천히 찬다.
 */
export const BREAK = { unlockOffice: 2, boost: 0.25, workSeconds: 240, restSeconds: 40, seats: 3, idle: 0.25 } as const;

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
  tray: {
    name: '일감함',
    description: '카드 한 장에 드는 일 -3%',
    scope: 'company',
    maxLevel: 15,
    baseCost: 500,
    growth: 1.9,
    effect: { key: 'ease', amount: 0.03 },
    unlockOffice: 1,
  },
  internet: {
    name: '인터넷',
    description: '출시로 얻는 평판 +4%',
    scope: 'company',
    maxLevel: 10,
    baseCost: 4000,
    growth: 2.2,
    effect: { key: 'reputation', amount: 0.04 },
    unlockOffice: 2,
  },
  server: {
    name: '서버',
    description: '출시작이 버는 수익 +10%',
    scope: 'company',
    maxLevel: 20,
    baseCost: 60000,
    growth: 1.8,
    effect: { key: 'income', amount: 0.1 },
    unlockOffice: 3,
  },
  plant: {
    name: '화분',
    description: '응원이 25% 더 오래가요',
    scope: 'company',
    maxLevel: 4,
    baseCost: 80,
    growth: 4,
    effect: { key: 'cheer', amount: 0.25 },
    unlockOffice: 0,
  },
  chair: {
    name: '편한 의자',
    description: '모든 직원의 일 속도 +6%',
    scope: 'company',
    maxLevel: 10,
    baseCost: 6000,
    growth: 2.2,
    effect: { key: 'workSpeed', amount: 0.06 },
    unlockOffice: 2,
  },
  printer: {
    name: '복합기',
    description: '출시할 때 받는 잎사귀 +10%',
    scope: 'company',
    maxLevel: 10,
    baseCost: 9000,
    growth: 2.2,
    effect: { key: 'bonus', amount: 0.1 },
    unlockOffice: 2,
  },
  meeting: {
    name: '회의실',
    description: '닫아 둔 동안의 수익 +20%',
    scope: 'company',
    maxLevel: 10,
    baseCost: 120000,
    growth: 2.4,
    effect: { key: 'away', amount: 0.2 },
    unlockOffice: 3,
  },
  sofa: {
    name: '소파',
    description: '휴게실에서 25% 더 빨리 쉬어요',
    scope: 'company',
    maxLevel: 8,
    baseCost: 5000,
    growth: 2.2,
    effect: { key: 'rest', amount: 0.25 },
    unlockOffice: 2,
  },
  snack: {
    name: '간식',
    description: '기운이 20% 더 오래가요',
    scope: 'company',
    maxLevel: 10,
    baseCost: 4000,
    growth: 2.2,
    effect: { key: 'stamina', amount: 0.2 },
    unlockOffice: 2,
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
  { name: '한 층 사무실', reputation: 200, cost: 10000, desks: 6 },
  { name: '두 층 사무실', reputation: 1000, cost: 150000, desks: 9 },
  { name: '사옥', reputation: 5000, cost: 6000000, desks: 12 },
];

/** 일감함에 한 번에 꺼내 놓는 카드의 수. 카드가 이보다 많은 프로젝트는 남은 것을 쌓아 두었다가 자리가 나면 꺼낸다. */
export const INBOX_SLOTS = 8;

/** 카드가 많은 프로젝트의 카드 목록을 만든다. 기획, 그림, 코딩, 검사 차례로 놓인다. */
function mix(plan: number, art: number, code: number, test: number): TaskKind[] {
  return [
    ...Array<TaskKind>(plan).fill('plan'),
    ...Array<TaskKind>(art).fill('art'),
    ...Array<TaskKind>(code).fill('code'),
    ...Array<TaskKind>(test).fill('test'),
  ];
}

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
  /** 처음 만들 때 세워 둬야 하는 부서의 수. 한 번 낸 뒤의 업데이트에는 묻지 않는다. */
  departments?: number;
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
    reputation: 60,
    unlockOffice: 2,
  },
  'pin-pull': {
    title: '핀 뽑기',
    icon: 'icon-pin',
    cards: ['plan', 'art', 'art', 'code', 'code', 'code', 'test', 'test'],
    work: 220,
    bonus: 1100,
    income: 6,
    reputation: 80,
    unlockOffice: 2,
  },
  'parking-out': {
    title: '주차장 빼기',
    icon: 'icon-car',
    cards: ['plan', 'plan', 'art', 'art', 'code', 'code', 'code', 'test'],
    work: 260,
    bonus: 1700,
    income: 9,
    reputation: 100,
    unlockOffice: 2,
  },
  'screw-sort': {
    title: '나사 풀기',
    icon: 'icon-screw',
    cards: mix(3, 4, 5, 4),
    work: 1500,
    bonus: 30000,
    income: 40,
    reputation: 400,
    unlockOffice: 3,
  },
  'merge-tiles': {
    title: '머지 타일',
    icon: 'icon-merge',
    cards: mix(4, 5, 4, 3),
    work: 1800,
    bonus: 45000,
    income: 55,
    reputation: 500,
    unlockOffice: 3,
  },
  'tail-chase': {
    title: '꼬리 잡기',
    icon: 'icon-tail',
    cards: mix(3, 5, 5, 3),
    work: 2200,
    bonus: 60000,
    income: 75,
    reputation: 600,
    unlockOffice: 3,
  },
  'logic-tiles': {
    title: '논리 타일',
    icon: 'icon-logic',
    cards: mix(8, 7, 9, 8),
    work: 3200,
    bonus: 600000,
    income: 260,
    reputation: 1500,
    unlockOffice: 4,
    departments: 1,
  },
  'chosung-quiz': {
    title: '초성 퀴즈',
    icon: 'icon-chosung',
    cards: mix(9, 8, 8, 7),
    work: 3800,
    bonus: 850000,
    income: 340,
    reputation: 2000,
    unlockOffice: 4,
    departments: 2,
  },
  'lantern-keeper': {
    title: '등불지기',
    icon: 'icon-lantern',
    cards: mix(7, 10, 9, 6),
    work: 4500,
    bonus: 1200000,
    income: 450,
    reputation: 2500,
    unlockOffice: 4,
    departments: 3,
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

// ───────── 미니게임과 잇기 ─────────

/**
 * 출시작은 포켓 아케이드의 실제 게임이다. 그 게임을 직접 해서 최고 기록을 올리면 별을 따고,
 * 별 하나마다 그 출시작이 버는 수익이 income만큼 는다. 별은 세 개까지다.
 * 별을 따는 점수는 그 게임의 오늘의 도전 목표 세 단계를 그대로 쓰고(link.ts),
 * 오늘의 도전에 나오지 않는 게임은 여기 targets에 따로 적는다.
 */
export const PLAY_STARS: { count: number; income: number; targets: Partial<Record<ProjectId, readonly number[]>> } = {
  count: 3,
  income: 0.2,
  targets: {
    'lantern-keeper': [1000, 3000, 8000],
  },
};

// ───────── 사옥 꾸미기 ─────────

/** 꾸미는 곳: 벽지, 바닥, 그리고 위쪽에 적힌 사무실 이름의 간판 */
export const DECOR_SLOTS = ['wall', 'floor', 'sign'] as const;
export type DecorSlot = (typeof DECOR_SLOTS)[number];
export const DECOR_SLOT_NAMES: Readonly<Record<DecorSlot, string>> = { wall: '벽지', floor: '바닥', sign: '간판' };

/** 무늬. plain은 한 가지 색이고, 나머지는 color 위에 mark 색으로 그린다. */
export type DecorPattern = 'plain' | 'stripe' | 'dot' | 'grid' | 'check' | 'cloud' | 'plank' | 'tuft';

export interface DecorDef {
  slot: DecorSlot;
  name: string;
  /** 허브의 코인으로 치르는 값. 한 번 사면 자회사를 세워도 남는다. */
  cost: number;
  color: number;
  mark: number;
  pattern: DecorPattern;
}

/**
 * 회사를 꾸미는 것들. 회사의 수치에는 아무 영향이 없고 모습만 바꾼다.
 * 고르지 않은 곳은 사무실마다 정해진 색을 쓰고, 간판은 없다.
 */
export const DECOR = {
  'wall-peach': { slot: 'wall', name: '복숭아 벽지', cost: 60, color: 0xffe1d2, mark: 0xffe1d2, pattern: 'plain' },
  'wall-stripe': { slot: 'wall', name: '줄무늬 벽지', cost: 100, color: 0xe2f6ee, mark: 0xc9ecdc, pattern: 'stripe' },
  'wall-dot': { slot: 'wall', name: '물방울 벽지', cost: 100, color: 0xfff3d6, mark: 0xffd98a, pattern: 'dot' },
  'wall-check': { slot: 'wall', name: '체크 벽지', cost: 150, color: 0xe9e3ff, mark: 0xd3c8f7, pattern: 'grid' },
  'wall-cloud': { slot: 'wall', name: '구름 벽지', cost: 200, color: 0xd3eaff, mark: 0xffffff, pattern: 'cloud' },
  'floor-carpet': { slot: 'floor', name: '분홍 양탄자', cost: 60, color: 0xf7c4d2, mark: 0xf7c4d2, pattern: 'plain' },
  'floor-wood': { slot: 'floor', name: '나무 바닥', cost: 100, color: 0xe9c391, mark: 0xd6a970, pattern: 'plank' },
  'floor-tile': { slot: 'floor', name: '하늘 타일', cost: 100, color: 0xe3f2ff, mark: 0xc7e0f4, pattern: 'grid' },
  'floor-check': { slot: 'floor', name: '바둑판 바닥', cost: 150, color: 0xf4ecf0, mark: 0xdccbd5, pattern: 'check' },
  'floor-grass': { slot: 'floor', name: '잔디 바닥', cost: 200, color: 0xbfe6a8, mark: 0x9ccf84, pattern: 'tuft' },
  'sign-wood': { slot: 'sign', name: '나무 간판', cost: 60, color: 0xf0cfa5, mark: 0xd6a970, pattern: 'plain' },
  'sign-mint': { slot: 'sign', name: '민트 간판', cost: 100, color: 0xbdebd9, mark: 0x7fd3ae, pattern: 'plain' },
  'sign-pink': { slot: 'sign', name: '분홍 간판', cost: 100, color: 0xffd3dd, mark: 0xe97f99, pattern: 'plain' },
  'sign-sky': { slot: 'sign', name: '하늘 간판', cost: 150, color: 0xcfe6fb, mark: 0x8fbfe8, pattern: 'plain' },
  'sign-gold': { slot: 'sign', name: '금빛 간판', cost: 200, color: 0xffe08a, mark: 0xe0a020, pattern: 'plain' },
} as const satisfies Record<string, DecorDef>;

export type DecorId = keyof typeof DECOR;
export const DECOR_ORDER = Object.keys(DECOR) as DecorId[];

// ───────── 자회사 ─────────

/**
 * 가장 큰 사무실에서 평판을 쌓으면 자회사를 세울 수 있다. 지금 회사는 자회사가 되어 남고,
 * 옥탑방에서 새 회사를 처음부터 다시 키운다. 대신 두 가지가 영영 남는다.
 * - 열매: 세울 때 그 회사의 평판 perFruit마다 하나씩 받는다. 본사의 힘(PERKS)을 올리는 데 쓴다.
 * - 자회사의 몫: 자회사 한 곳마다 출시작이 버는 수익이 income만큼 는다.
 * coins는 자회사를 세울 때마다 받는 허브의 코인이다.
 */
export const BRANCH = { reputation: 20_000, perFruit: 4_000, income: 0.2, coins: 30 } as const;

export interface PerkDef {
  name: string;
  /** 한 줄 설명. 자회사 창에 보인다. */
  description: string;
  maxLevel: number;
  /** n단계에서 n+1단계로 올리는 데 드는 열매: baseCost × (n + 1) */
  baseCost: number;
  /** 단계마다 더해지는 효과. 장비나 성격과 따로 곱해진다. */
  effect?: Effect;
  /** 새 회사를 시작할 때 들고 가는 잎사귀. seed[n - 1]이 n단계의 값이다. 올린 그 자리에서도 한 번 받는다. */
  seed?: readonly number[];
}

/**
 * 본사의 힘. 열매로 올리고, 자회사를 세워 새 회사를 시작해도 그대로 남는다.
 * 줄을 더하면 힘이 늘어난다.
 */
export const PERKS = {
  hands: {
    name: '익숙한 손',
    description: '모든 직원의 일 속도 +30%',
    maxLevel: 10,
    baseCost: 1,
    effect: { key: 'workSpeed', amount: 0.3 },
  },
  fans: {
    name: '단골 손님',
    description: '출시작이 버는 수익 +30%',
    maxLevel: 10,
    baseCost: 1,
    effect: { key: 'income', amount: 0.3 },
  },
  party: {
    name: '출시 잔치',
    description: '출시할 때 받는 잎사귀 +30%',
    maxLevel: 10,
    baseCost: 1,
    effect: { key: 'bonus', amount: 0.3 },
  },
  word: {
    name: '입소문',
    description: '출시로 얻는 평판 +10%',
    maxLevel: 10,
    baseCost: 1,
    effect: { key: 'reputation', amount: 0.1 },
  },
  seed: {
    name: '종잣돈',
    description: '잎사귀를 들고 새 회사를 시작',
    maxLevel: 5,
    baseCost: 1,
    seed: [2_000, 20_000, 200_000, 1_500_000, 10_000_000],
  },
} as const satisfies Record<string, PerkDef>;

export type PerkId = keyof typeof PERKS;
export const PERK_ORDER = Object.keys(PERKS) as PerkId[];

// ───────── 급한 의뢰 ─────────

/**
 * 가끔 급한 의뢰가 들어온다. 받으면 카드 몇 장이 일감함 맨 앞에 놓이고, 시간 안에 모두 끝내면 잎사귀를 크게 받는다.
 * 시간이 다 되면 남은 카드는 사라지고 아무것도 받지 못한다. 받지 않고 두면 그냥 지나간다.
 */
export const RUSH = {
  unlockOffice: 1,
  /** 다음 의뢰가 들어오기까지의 시간(초). 이 사이에서 정해진다. */
  every: [240, 420],
  /** 의뢰를 받을지 정할 수 있는 시간(초) */
  offerSeconds: 25,
  /** 받은 뒤 끝내야 하는 시간(초) */
  seconds: 60,
  /** 카드의 수. 직원 수의 절반을 이 사이로 맞춘다. */
  cards: [2, 4],
  /** 특기가 아닌 직원이 응원 없이 하면 시간의 이만큼이 걸리는 양의 일을 준다. */
  effort: 0.8,
  /** 보상: 이만큼의 시간(초) 동안 출시작이 버는 잎사귀 */
  rewardSeconds: 180,
  /** 보상의 가장 작은 값. 사무실 단계가 오를 때마다 네 배가 된다. */
  minReward: 80,
} as const;
