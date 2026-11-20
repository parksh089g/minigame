/**
 * 새싹 컴퍼니의 규칙. 화면 없이 숫자만 다룬다.
 * 판이 끝나지 않고 이어지는 게임이라, 상태 하나(CompanyState)를 계속 고쳐 나간다.
 * 매 프레임 불리는 advance가 있어서 여기 함수들은 상태를 그 자리에서 고친다.
 */
import {
  AWAY,
  BRANCH,
  BREAK,
  BUDDIES,
  DECOR,
  DECOR_ORDER,
  DECOR_SLOTS,
  BUDDY,
  CANDIDATE_COUNT,
  CHEER_BOOST,
  CHEER_SECONDS,
  DEPARTMENT,
  DEPARTMENT_ORDER,
  DEPARTMENTS,
  EQUIPMENT,
  EQUIPMENT_ORDER,
  GUIDE_STEPS,
  FIRST_HIRES,
  HIRE_COST,
  INBOX_SLOTS,
  LEAD,
  LEVEL_SPEED,
  MAX_FLOWERS,
  OFFICE_COINS,
  OFFICES,
  OLD_HAND_TIPS,
  PERK_ORDER,
  PERKS,
  PLAY_STARS,
  PROJECT_ORDER,
  PROJECTS,
  QUEUE,
  RATING,
  RUSH,
  SKILL,
  SKILL_LEVEL,
  SPECIAL,
  SPECIAL_KINDS,
  SPECIALTY_BOOST,
  STAFF,
  STAFF_ORDER,
  TASK_KINDS,
  TIPS,
  TRAINING,
  TWIN,
  UPDATE_SCALE,
  type DecorDef,
  type DecorId,
  type DecorSlot,
  type DepartmentDef,
  type DepartmentId,
  type EffectKey,
  type EquipmentDef,
  type EquipmentId,
  type LeadLevel,
  type PerkDef,
  type PerkId,
  type ProjectDef,
  type ProjectId,
  type SkillId,
  type SpecialKind,
  type StaffDef,
  type StaffId,
  type TaskKind,
} from './data';
import {
  bumpGoals,
  createGoals,
  GOAL_BUDGET_SECONDS,
  GOALS,
  normalizeGoals,
  type GoalKind,
  type GoalLimits,
  type GoalsState,
} from './goals';

export const COMPANY_VERSION = 1;

/** 업무 카드 한 장. 일감함에 있거나 책상 위에 있다. */
export interface Task {
  kind: TaskKind;
  /** 남은 일 */
  left: number;
  /** 처음의 일. 진행 막대를 그릴 때 쓴다. */
  total: number;
  /** 급한 의뢰의 카드. 프로젝트의 카드로 세지 않는다. */
  rush?: boolean;
  /** 이 카드가 속한 프로젝트. 급한 의뢰의 카드에는 없다. 적히지 않은 카드는 먼저 시작한 게임(project)의 것이다. */
  project?: ProjectId;
  /** 특별한 카드의 종류. 보통 카드에는 없다. */
  special?: SpecialKind;
  /** 버그에 막혀서 일이 멈춘 시간이 얼마나 남았는지(초). 막히지 않았으면 없다. */
  stuck?: number;
  /** 버그 카드의 버그를 이미 잡았거나 버그가 지나갔다. */
  fixed?: boolean;
  /** 버그를 눌러서 잡았다(지나가게 둔 것이 아니다). 평가에서 정성을 더 받는다. */
  caught?: boolean;
  /** 하는 동안 응원을 한 번이라도 받았다. 평가에서 정성을 받는다. */
  cheered?: boolean;
}

/** 강화 id → 레벨. 없는 id는 0레벨이다. */
export type Levels = Partial<Record<EquipmentId, number>>;

export interface Desk {
  /** 앉은 직원. 빈 자리는 null */
  staff: StaffId | null;
  /** 교육으로 올린 레벨 */
  level: number;
  /** 이 자리의 장비 */
  gear: Levels;
  task: Task | null;
  /** 응원이 남은 시간(초) */
  cheer: number;
  /** 이 자리의 직원이 든 부서. 없으면 null */
  dept: DepartmentId | null;
  /** 기운. 1이면 가득, 0이면 바닥. 휴게실이 열린 사무실에서만 줄고 찬다. */
  energy: number;
  /** 휴게실에서 쉬는 중인가. 쉬는 동안에는 일을 맡지 않는다. */
  resting: boolean;
}

export interface ActiveProject {
  id: ProjectId;
  /** 끝낸 카드의 수 */
  done: number;
  total: number;
  /** 끝낸 카드들이 받은 정성 점수의 합. 출시할 때 평가가 된다(RATING). */
  care: number;
}

/** 들어와서 받을지 기다리는 급한 의뢰 */
export interface RushOffer {
  kinds: TaskKind[];
  /** 카드 한 장에 드는 일 */
  work: number;
  reward: number;
  /** 받지 않으면 사라지기까지 남은 시간(초) */
  left: number;
}

/** 받아서 하고 있는 급한 의뢰 */
export interface Rush {
  total: number;
  done: number;
  /** 남은 시간(초) */
  left: number;
  /** 처음에 주어진 시간(초). 남은 시간 막대를 그릴 때 쓴다. */
  seconds: number;
  reward: number;
}

export interface CompanyState {
  version: number;
  /** 회사의 돈. 소수로 쌓이고 보여 줄 때만 내린다. */
  leaves: number;
  /** 줄지 않는 점수. 사무실 단계를 연다. */
  reputation: number;
  /** OFFICES에서의 차례 */
  office: number;
  /** 사장인 친구. 회사를 세울 때 고른 캐릭터로 정해지고 바뀌지 않는다. */
  boss: StaffId;
  desks: Desk[];
  /** 회사에 하나씩 있는 장비 */
  gear: Levels;
  /** 지금 만드는 게임. 두 게임을 함께 만들 때는 먼저 시작한 것이다. */
  project: ActiveProject | null;
  /**
   * 두 번째 칸에서 함께 만드는 게임(TWIN). 먼저 시작한 게임을 출시하면 이것이 project 자리로 올라간다.
   * project가 없으면 늘 null이다.
   */
  second: ActiveProject | null;
  /** 일감함에 꺼내 놓은 카드. 급한 의뢰의 카드는 맨 앞에 놓인다. */
  inbox: Task[];
  /** 일감함에 자리가 없어서 쌓아 둔 프로젝트의 카드. 자리가 나면 차례로 꺼낸다. */
  backlog: Task[];
  offer: RushOffer | null;
  rush: Rush | null;
  /** 다음 급한 의뢰가 들어오기까지 남은 시간(초). 의뢰가 열린 사무실에서만 줄어든다. */
  rushIn: number;
  /** 프로젝트 id → 낸 횟수 (첫 출시와 업데이트를 합친 것) */
  released: Partial<Record<ProjectId, number>>;
  /** 모든 출시와 업데이트의 수 */
  releases: number;
  /** 프로젝트 id → 그 게임을 직접 해서 딴 별의 수. 딴 별은 줄지 않는다. */
  stars: Partial<Record<ProjectId, number>>;
  /** 프로젝트 id → 그 게임을 내면서 받은 가장 좋은 평가(꽃의 수) */
  flowers: Partial<Record<ProjectId, number>>;
  /** 지금까지 난 대박의 수 */
  hits: number;
  /** 지금 와 있는 지원자. 채용 화면을 처음 열 때 정하고, 뽑을 때까지 바뀌지 않는다. */
  candidates: StaffId[] | null;
  /** 팀장의 단계. 0이면 팀장이 없다. */
  lead: number;
  /** 팀장이 다음 카드를 맡기기까지 남은 시간(초) */
  leadWait: number;
  /** 오늘의 목표와 그 진행 */
  goals: GoalsState;
  /** 부서 id → 단계. 없는 id는 아직 세우지 않은 부서다. */
  departments: Partial<Record<DepartmentId, number>>;
  /** 예약해 둔 게임. 지금 것을 출시하면 맨 앞의 것부터 시작한다. */
  queue: ProjectId[];
  /** 세운 자회사의 수 */
  branches: number;
  /** 자회사가 된 회사들이 쌓았던 평판의 합. 지금 회사의 평판과 더한 것이 허브에 남는 기록이다. */
  legacy: number;
  /** 아직 쓰지 않은 열매 */
  fruit: number;
  /** 본사의 힘 id → 단계. 자회사를 세워도 남는다. */
  perks: Partial<Record<PerkId, number>>;
  /** 지금까지 가 본 가장 큰 사무실. 처음 이사할 때만 코인을 주려고 적어 둔다. */
  topOffice: number;
  /** 사 둔 꾸미기와 지금 쓰는 것. 자회사를 세워도 남는다. */
  decor: Decor;
  /** 길잡이의 지금 걸음(GUIDE_STEPS의 번호). 걸음의 수와 같으면 길잡이를 마친 것이다. */
  guide: number;
  /** 이미 본 처음 안내의 id */
  tips: string[];
  /** 마지막으로 저장한 때(ms). 닫아 둔 시간을 재는 데 쓴다. */
  savedAt: number;
}

// ───────── 처음 상태 ─────────

function emptyDesk(staff: StaffId | null = null): Desk {
  return { staff, level: 0, gear: {}, task: null, cheer: 0, dept: null, energy: 1, resting: false };
}

/** 꾸미기에서 쓰는 캐릭터 id로 사장이 될 친구를 찾는다. 모르는 id면 새싹이다. */
export function bossFor(look: string): StaffId {
  return STAFF_ORDER.find((id) => (STAFF[id] as StaffDef).look === look) ?? 'sprout';
}

export function createCompany(boss: StaffId, now = 0): CompanyState {
  const first = FIRST_HIRES.find((id) => id !== boss) ?? FIRST_HIRES[0];
  const desks = [emptyDesk(boss), emptyDesk(first)];
  while (desks.length < OFFICES[0].desks) desks.push(emptyDesk());
  return {
    version: COMPANY_VERSION,
    leaves: 0,
    reputation: 0,
    office: 0,
    boss,
    desks,
    gear: {},
    project: null,
    second: null,
    inbox: [],
    backlog: [],
    offer: null,
    rush: null,
    rushIn: RUSH.every[0],
    released: {},
    releases: 0,
    stars: {},
    flowers: {},
    hits: 0,
    candidates: null,
    lead: 0,
    leadWait: 0,
    goals: createGoals(),
    departments: {},
    queue: [],
    branches: 0,
    legacy: 0,
    fruit: 0,
    perks: {},
    topOffice: 0,
    decor: { owned: [], wall: null, floor: null, sign: null },
    guide: 0,
    tips: [],
    savedAt: now,
  };
}

// ───────── 효과와 속도 ─────────

const levelOf = (levels: Levels, id: EquipmentId): number => levels[id] ?? 0;

/** 장비의 지금 레벨. 책상 장비는 책상 번호를 줘야 한다. */
export function equipmentLevel(state: CompanyState, id: EquipmentId, desk = -1): number {
  const def: EquipmentDef = EQUIPMENT[id];
  if (def.scope === 'company') return levelOf(state.gear, id);
  const at = state.desks[desk];
  return at ? levelOf(at.gear, id) : 0;
}

function gearBonus(levels: Levels, scope: EquipmentDef['scope'], key: EffectKey): number {
  let sum = 0;
  for (const id of EQUIPMENT_ORDER) {
    const def: EquipmentDef = EQUIPMENT[id];
    if (def.scope === scope && def.effect.key === key) sum += def.effect.amount * levelOf(levels, id);
  }
  return sum;
}

/**
 * 회사 전체에 걸리는 보너스의 합. 0.3이면 +30%.
 * 회사 장비와, 직원의 성격 가운데 수익과 출시 보너스, 그리고 돕는 부서의 몫이 여기 든다.
 * 속도를 올리는 성격은 그 직원 것이라 빠진다.
 */
export function companyBonus(state: CompanyState, key: EffectKey): number {
  let sum = gearBonus(state.gear, 'company', key);
  for (const desk of state.desks) {
    if (!desk.staff) continue;
    if (key !== 'workSpeed') {
      const trait = (STAFF[desk.staff] as StaffDef).trait;
      if (trait.key === key) sum += trait.amount;
    }
    // 돕는 부서에 든 친구는 부서의 단계만큼 회사에 보탠다.
    const effect = desk.dept ? (DEPARTMENTS[desk.dept] as DepartmentDef).effect : undefined;
    if (effect?.key === key) sum += effect.amount * departmentLevel(state, desk.dept as DepartmentId);
  }
  return sum;
}

/** 본사의 힘의 지금 단계 */
export function perkLevel(state: CompanyState, id: PerkId): number {
  return state.perks[id] ?? 0;
}

/**
 * 본사의 힘과 자회사가 주는 보너스의 합. 0.5면 +50%.
 * 장비나 성격의 보너스(companyBonus)와 더해지지 않고 따로 곱해져서, 회사를 다 키운 뒤에도 그대로 효과가 난다.
 */
export function legacyBonus(state: CompanyState, key: EffectKey): number {
  let sum = key === 'income' ? BRANCH.income * state.branches : 0;
  for (const id of PERK_ORDER) {
    const effect = (PERKS[id] as PerkDef).effect;
    if (effect?.key === key) sum += effect.amount * perkLevel(state, id);
  }
  return sum;
}

// ───────── 휴게실과 기운 ─────────

/** 휴게실이 있는 사무실인가. 없는 곳에서는 기운이 줄지도 않고 보너스도 없다. */
export function breakOpen(state: CompanyState): boolean {
  return BREAK.unlockOffice <= state.office;
}

/** 이 책상의 친구가 기운이 남아서 더 빨리 일하는가 */
export function isPeppy(state: CompanyState, index: number): boolean {
  const desk = state.desks[index];
  return breakOpen(state) && !!desk?.staff && !desk.resting && desk.energy > 0;
}

/** 가득 찬 기운이 쉬지 않고 일해서 바닥나기까지의 시간(초) */
export function staminaSeconds(state: CompanyState): number {
  return BREAK.workSeconds * (1 + companyBonus(state, 'stamina'));
}

/** 바닥난 기운을 휴게실에서 가득 채우는 데 걸리는 시간(초) */
export function restSeconds(state: CompanyState): number {
  return BREAK.restSeconds / (1 + companyBonus(state, 'rest'));
}

/** 기운이 바닥나서 지금 쉬러 가도 되는가: 급한 의뢰가 없고 휴게실에 자리가 있어야 한다. */
function canRest(state: CompanyState, desk: Desk): boolean {
  return desk.energy <= 0 && !state.rush && restingCount(state) < BREAK.seats;
}

/** 지금 휴게실에서 쉬는 친구의 수 */
export function restingCount(state: CompanyState): number {
  return state.desks.reduce((count, desk) => count + (desk.staff && desk.resting ? 1 : 0), 0);
}

// ───────── 자리와 단짝 ─────────

/** 책상이 count개일 때 한 줄에 놓는 수. 화면도 이대로 놓는다. */
export function deskColumns(count: number): number {
  return count <= 4 ? 2 : count <= 9 ? 3 : 4;
}

/** 이 친구의 단짝. 없으면 null */
export function buddyOf(id: StaffId): StaffId | null {
  for (const [a, b] of BUDDIES) {
    if (a === id) return b;
    if (b === id) return a;
  }
  return null;
}

/** 이 책상의 옆자리: 같은 줄의 바로 왼쪽과 오른쪽 책상의 번호 */
export function neighbors(state: CompanyState, index: number): number[] {
  const count = state.desks.length;
  if (!Number.isInteger(index) || index < 0 || index >= count) return [];
  const columns = deskColumns(count);
  const column = index % columns;
  const near: number[] = [];
  if (column > 0) near.push(index - 1);
  if (column < columns - 1 && index + 1 < count) near.push(index + 1);
  return near;
}

/** 이 책상의 친구가 단짝과 옆자리에 앉아 있는가 */
export function hasBuddy(state: CompanyState, index: number): boolean {
  const staff = state.desks[index]?.staff;
  const buddy = staff ? buddyOf(staff) : null;
  return buddy !== null && neighbors(state, index).some((near) => state.desks[near].staff === buddy);
}

/** 단짝이 둘 다 회사에 있는데 옆자리가 아닌 짝이 있는가 */
export function hasLonelyBuddy(state: CompanyState): boolean {
  return state.desks.some((desk, index) => {
    const buddy = desk.staff ? buddyOf(desk.staff) : null;
    return buddy !== null && !hasBuddy(state, index) && state.desks.some((other) => other.staff === buddy);
  });
}

/**
 * 두 책상의 자리를 맞바꾼다. 친구가 하던 일, 레벨, 부서, 그 자리의 컴퓨터까지 함께 옮겨 간다.
 * 한쪽이 빈 자리면 그리로 옮겨 앉는 것이 된다.
 */
export function swapDesks(state: CompanyState, a: number, b: number): boolean {
  const first = state.desks[a];
  const second = state.desks[b];
  if (!first || !second || a === b || (!first.staff && !second.staff)) return false;
  state.desks[a] = second;
  state.desks[b] = first;
  return true;
}

/** 이 책상의 친구가 기술을 쓸 만큼 교육을 받았는가 */
export function skillOpen(state: CompanyState, index: number): boolean {
  const desk = state.desks[index];
  return desk?.staff != null && desk.level >= SKILL_LEVEL;
}

/** 이 책상에 앉은 친구가 지금 쓰는 기술. 빈 자리이거나 아직 열리지 않았으면 null */
export function skillAt(state: CompanyState, index: number): SkillId | null {
  const staff = state.desks[index]?.staff;
  return staff && skillOpen(state, index) ? (STAFF[staff] as StaffDef).skill : null;
}

/** 이 책상에 앉은 친구가 그 기술을 쓰고 있는가 */
export function hasSkill(state: CompanyState, index: number, id: SkillId): boolean {
  return skillAt(state, index) === id;
}

/** 그 기술을 쓰는 친구가 회사에 있는가 */
export function companyHas(state: CompanyState, id: SkillId): boolean {
  return state.desks.some((_, index) => hasSkill(state, index, id));
}

/** 사장은 특기 없이 모든 업무를 고르게 한다. */
export function specialtyOf(state: CompanyState, staff: StaffId): TaskKind | null {
  return staff === state.boss ? null : STAFF[staff].specialty;
}

/** 이 책상의 직원이 특기가 아닌 업무를 할 때의 속도(응원은 뺀 것). 기운이 남아 있으면 그만큼 빠르다. 빈 자리는 0 */
export function baseSpeed(state: CompanyState, index: number): number {
  return plainSpeed(state, index) * (isPeppy(state, index) ? 1 + BREAK.boost : 1);
}

/** 기운을 뺀 속도 */
function plainSpeed(state: CompanyState, index: number): number {
  const desk = state.desks[index];
  if (!desk?.staff) return 0;
  const trait = (STAFF[desk.staff] as StaffDef).trait;
  const own =
    1 +
    gearBonus(desk.gear, 'desk', 'workSpeed') +
    gearBonus(state.gear, 'company', 'workSpeed') +
    (trait.key === 'workSpeed' ? trait.amount : 0) +
    (neighbors(state, index).some((at) => hasSkill(state, at, 'aura')) ? SKILL.aura.speed : 0) +
    desk.level * LEVEL_SPEED +
    (hasBuddy(state, index) ? BUDDY.speed : 0);
  return own * (1 + legacyBonus(state, 'workSpeed'));
}

/**
 * 이 책상의 직원이 이 업무를 얼마나 잘하는지의 배수. 특기면 두 배이고, 그 업무를 맡는 부서에 들었으면
 * 부서의 단계만큼 더 붙는다. 둘은 곱으로 겹친다. 빈 자리는 0
 */
export function skill(state: CompanyState, index: number, kind: TaskKind): number {
  const desk = state.desks[index];
  if (!desk?.staff) return 0;
  const special = specialtyOf(state, desk.staff) === kind ? SPECIALTY_BOOST : hasSkill(state, index, 'handy') ? SKILL.handy.boost : 1;
  const dept = desk.dept;
  const team = dept && DEPARTMENTS[dept].kind === kind ? 1 + departmentBoost(departmentLevel(state, dept)) : 1;
  return special * team;
}

/** 이 책상의 직원이 이 업무를 할 때의 속도(응원은 뺀 것). 빈 자리는 0 */
export function deskSpeed(state: CompanyState, index: number, kind: TaskKind): number {
  return baseSpeed(state, index) * skill(state, index, kind);
}

// ───────── 프로젝트 ─────────

/** 지금까지 낸 횟수. 0이면 아직 출시하지 않은 게임이다. */
export function versionOf(state: CompanyState, id: ProjectId): number {
  return state.released[id] ?? 0;
}

/** 일감함 같은 것으로 카드의 일을 아무리 줄여도 이만큼은 넘지 못한다. */
const MAX_EASE = 0.6;

/** 이 프로젝트를 지금 시작하면 카드 한 장에 드는 일 */
export function projectWork(state: CompanyState, id: ProjectId): number {
  const def: ProjectDef = PROJECTS[id];
  const ease = Math.min(MAX_EASE, companyBonus(state, 'ease'));
  return def.work * UPDATE_SCALE.work ** versionOf(state, id) * (1 - ease);
}

/** 이 프로젝트를 지금 내면 받는 잎사귀 */
export function projectBonus(state: CompanyState, id: ProjectId): number {
  const def: ProjectDef = PROJECTS[id];
  const base = def.bonus * UPDATE_SCALE.bonus ** versionOf(state, id);
  return Math.round(base * (1 + companyBonus(state, 'bonus')) * (1 + legacyBonus(state, 'bonus')));
}

/** 이 프로젝트를 지금 내면 오르는 평판 */
export function projectReputation(state: CompanyState, id: ProjectId): number {
  const def: ProjectDef = PROJECTS[id];
  const base = versionOf(state, id) === 0 ? def.reputation : Math.ceil(def.reputation * UPDATE_SCALE.reputation);
  return Math.round(base * (1 + companyBonus(state, 'reputation')) * (1 + legacyBonus(state, 'reputation')));
}

/** 이 프로젝트를 지금 내면 늘어나는 초당 수익 (회사 보너스는 뺀 것) */
export function projectIncomeGain(state: CompanyState, id: ProjectId): number {
  const def: ProjectDef = PROJECTS[id];
  return versionOf(state, id) === 0 ? def.income : def.income * UPDATE_SCALE.income;
}

/** 출시작 하나가 초마다 버는 잎사귀 (회사 보너스는 뺀 것) */
function baseIncome(id: ProjectId, version: number): number {
  if (version <= 0) return 0;
  const def: ProjectDef = PROJECTS[id];
  return def.income * (1 + UPDATE_SCALE.income * (version - 1));
}

/** 그 게임을 직접 해서 딴 별의 수 */
export function starsOf(state: CompanyState, id: ProjectId): number {
  return state.stars[id] ?? 0;
}

/**
 * 직접 해서 딴 별을 적는다. 별은 줄지 않으므로 지금보다 많은 것만 받아들인다.
 * 별이 는 게임의 id를 돌려준다.
 */
export function setStars(state: CompanyState, stars: Partial<Record<ProjectId, number>>): ProjectId[] {
  const risen: ProjectId[] = [];
  for (const id of PROJECT_ORDER) {
    const next = Math.min(PLAY_STARS.count, Math.floor(stars[id] ?? 0));
    if (next > starsOf(state, id)) {
      state.stars[id] = next;
      risen.push(id);
    }
  }
  return risen;
}

/** 수익에 걸리는 배수: 회사 보너스에 본사의 힘과 자회사의 몫을 곱한 것 */
function incomeScale(state: CompanyState): number {
  return (1 + companyBonus(state, 'income')) * (1 + legacyBonus(state, 'income'));
}

/** 출시작 하나가 초마다 버는 잎사귀. 딴 별과 회사 보너스까지 넣은 것이다. 아직 내지 않은 게임은 0 */
export function gameIncome(state: CompanyState, id: ProjectId): number {
  const starred = baseIncome(id, versionOf(state, id)) * (1 + PLAY_STARS.income * starsOf(state, id));
  return starred * incomeScale(state);
}

/** 출시작이 모두 합쳐 초마다 버는 잎사귀 */
export function incomePerSecond(state: CompanyState): number {
  let sum = 0;
  for (const id of PROJECT_ORDER) sum += baseIncome(id, versionOf(state, id)) * (1 + PLAY_STARS.income * starsOf(state, id));
  return sum * incomeScale(state);
}

export function isUnlocked(state: CompanyState, id: ProjectId): boolean {
  return PROJECTS[id].unlockOffice <= state.office;
}

/**
 * 이 게임을 시작하려면 더 세워야 하는 부서의 수. 0이면 시작할 수 있다.
 * 부서는 처음 만들 때만 묻는다. 한 번 낸 게임의 업데이트는 언제든 할 수 있다.
 */
export function departmentsMissing(state: CompanyState, id: ProjectId): number {
  const need = (PROJECTS[id] as ProjectDef).departments ?? 0;
  if (need <= 0 || versionOf(state, id) > 0) return 0;
  return Math.max(0, need - departmentCount(state));
}

/** 지금 사무실에서 만들 수 있는 프로젝트 */
export function availableProjects(state: CompanyState): ProjectId[] {
  return PROJECT_ORDER.filter((id) => isUnlocked(state, id));
}

/**
 * 일감함에 자리가 있으면 쌓아 둔 카드를 차례로 꺼낸다.
 * 두 게임을 함께 만들 때는 일감함에 덜 나와 있는 게임의 카드부터 꺼내서, 두 게임의 카드가 고르게 놓인다.
 */
function refill(state: CompanyState): void {
  while (state.inbox.length < INBOX_SLOTS && state.backlog.length > 0) {
    let at = 0;
    const main = state.project;
    const second = state.second;
    if (main && second) {
      const shown = (project: ActiveProject): number =>
        state.inbox.filter((task) => ownerOf(state, task) === project).length;
      const fewer = shown(second) < shown(main) ? second : main;
      at = Math.max(0, state.backlog.findIndex((task) => ownerOf(state, task) === fewer));
    }
    state.inbox.push(state.backlog.splice(at, 1)[0]);
  }
}

// ───────── 프로젝트 칸 ─────────

/** 게임을 두 개까지 함께 만드는 사무실인가 */
export function twinOpen(state: CompanyState): boolean {
  return TWIN.unlockOffice <= state.office;
}

/** 칸 번호의 게임. 0은 먼저 시작한 게임, 1은 두 번째 칸의 게임이다. 비었으면 null */
export function projectAt(state: CompanyState, slot: number): ActiveProject | null {
  return slot === 0 ? state.project : slot === 1 ? state.second : null;
}

/** 지금 만드는 게임들. 먼저 시작한 것이 앞이다. */
export function activeProjects(state: CompanyState): ActiveProject[] {
  return [state.project, state.second].filter((project): project is ActiveProject => project !== null);
}

/** 새 게임을 바로 시작할 수 있는 빈 칸이 있는가 */
export function hasFreeSlot(state: CompanyState): boolean {
  return !state.project || (twinOpen(state) && !state.second);
}

/** 이 게임을 지금 어느 칸에서 만들고 있는가. 만들고 있지 않으면 -1 */
export function slotOf(state: CompanyState, id: ProjectId): number {
  return state.project?.id === id ? 0 : state.second?.id === id ? 1 : -1;
}

/** 이 카드가 속한 게임. 급한 의뢰의 카드이거나, 지금 만드는 게임의 카드가 아니면 null */
export function ownerOf(state: CompanyState, task: Task): ActiveProject | null {
  if (task.rush) return null;
  if (task.project === undefined) return state.project;
  return activeProjects(state).find((project) => project.id === task.project) ?? null;
}

/** 이 카드가 속한 게임의 칸 번호. 급한 의뢰의 카드이거나 지금 만드는 게임의 카드가 아니면 -1 */
export function cardSlot(state: CompanyState, task: Task): number {
  const owner = ownerOf(state, task);
  return owner === null ? -1 : owner === state.project ? 0 : 1;
}

/** 특별한 카드가 나오는 사무실인가 */
export function specialsOpen(state: CompanyState): boolean {
  return state.office >= SPECIAL.unlockOffice;
}

/** 카드 몇 장을 특별한 카드로 바꾼다. random은 0 이상 1 미만의 수를 준다. */
function sprinkle(state: CompanyState, cards: Task[], random: () => number): void {
  if (!specialsOpen(state)) return;
  for (const card of cards) {
    if (random() >= SPECIAL.chance) continue;
    card.special = SPECIAL_KINDS[Math.min(SPECIAL_KINDS.length - 1, Math.floor(random() * SPECIAL_KINDS.length))];
  }
}

/**
 * 프로젝트를 시작한다. 카드가 일감함에 놓이고, 다 놓지 못한 것은 쌓아 둔다.
 * 빈 칸이 없으면 시작하지 못한다(hasFreeSlot). 두 번째 칸이 열린 사무실에서는 하던 게임이 있어도
 * 다른 게임 하나를 함께 시작할 수 있다. 같은 게임을 두 칸에서 만들 수는 없다.
 * random을 주면 카드 몇 장이 특별한 카드로 나온다(SPECIAL). 주지 않으면 모두 보통 카드다.
 */
export function startProject(state: CompanyState, id: ProjectId, random?: () => number): boolean {
  if (!hasFreeSlot(state) || slotOf(state, id) >= 0 || !isUnlocked(state, id) || departmentsMissing(state, id) > 0) {
    return false;
  }
  const def: ProjectDef = PROJECTS[id];
  const work = projectWork(state, id);
  const cards: Task[] = def.cards.map((kind) => ({ kind, left: work, total: work, project: id }));
  if (random) sprinkle(state, cards, random);
  const project: ActiveProject = { id, done: 0, total: def.cards.length, care: 0 };
  if (!state.project) {
    state.project = project;
    state.backlog = cards;
  } else {
    state.second = project;
    // 먼저 시작한 게임의 카드가 일감함을 다 차지하고 있으면 절반만 두고 나머지는 쌓아 둔 줄의 앞으로 돌린다.
    // 그래야 새 게임의 카드도 곧바로 함께 나온다.
    const keep = Math.floor(INBOX_SLOTS / 2);
    const back: Task[] = [];
    let plain = 0;
    state.inbox = state.inbox.filter((task) => {
      if (task.rush || (plain += 1) <= keep) return true;
      back.push(task);
      return false;
    });
    state.backlog = [...back, ...state.backlog, ...cards];
  }
  refill(state);
  return true;
}

/** 아직 맡기지 않은 프로젝트의 카드 수: 일감함에 있는 것과 쌓아 둔 것 */
export function cardsWaiting(state: CompanyState): number {
  return state.inbox.length + state.backlog.length;
}

/** 그 칸(0이면 먼저 시작한 게임)의 카드를 모두 끝내서 출시만 남았는가 */
export function isReady(state: CompanyState, slot = 0): boolean {
  const project = projectAt(state, slot);
  return project !== null && project.done >= project.total;
}

/** 다 만들어서 출시만 남은 칸의 번호. 먼저 시작한 게임부터 본다. 없으면 -1 */
export function readySlot(state: CompanyState): number {
  return isReady(state, 0) ? 0 : isReady(state, 1) ? 1 : -1;
}

export interface Release {
  id: ProjectId;
  /** 이번 출시로 된 횟수. 1이면 첫 출시, 2부터는 업데이트 */
  version: number;
  /** 받은 잎사귀. 평가와 대박까지 넣은 것이다. */
  bonus: number;
  /** 오른 평판. 대박까지 넣은 것이다. */
  reputation: number;
  /** 평가로 받은 꽃의 수(1~MAX_FLOWERS) */
  flowers: number;
  /** 대박이 났는가 */
  hit: boolean;
}

// ───────── 출시 평가 ─────────

/** 이 책상의 친구가 이 업무에 맞는가: 특기나 부서가 맞거나, 무엇이든 고르게 하는 사장이다. */
export function fits(state: CompanyState, index: number, kind: TaskKind): boolean {
  const desk = state.desks[index];
  if (!desk?.staff) return false;
  return desk.staff === state.boss || skill(state, index, kind) > 1;
}

/** 이 책상이 이 카드를 지금 끝내면 받는 정성 점수 */
export function careFor(state: CompanyState, index: number, task: Task): number {
  if (task.special === 'bug' && task.fixed && !task.caught) return 0;
  return (
    (fits(state, index, task.kind) ? RATING.fit : 0) +
    (task.cheered ? RATING.cheer : 0) +
    (task.caught ? RATING.catch : 0) +
    (hasSkill(state, index, 'neat') ? SKILL.neat.care : 0)
  );
}

/** 정성 점수의 몫(0~1)이 꽃 몇 송이인가 */
export function flowersFor(share: number): number {
  return 1 + RATING.shares.filter((least) => share >= least).length;
}

/**
 * 그 칸(0이면 먼저 시작한 게임)의 게임이 여태 끝낸 카드만으로 받는 꽃의 수.
 * 남은 카드도 지금처럼 하면 이대로 평가를 받는다. 끝낸 카드가 없으면 0이다.
 */
export function flowersNow(state: CompanyState, slot = 0): number {
  const project = projectAt(state, slot);
  if (!project || project.done <= 0) return 0;
  return flowersFor(Math.min(1, project.care / (project.done * RATING.full)));
}

/** 그 게임을 내면서 받은 가장 좋은 평가. 아직 내지 않았으면 0 */
export function bestFlowers(state: CompanyState, id: ProjectId): number {
  return state.flowers[id] ?? 0;
}

/** 꽃이 이만큼일 때 출시 보너스에 곱하는 값 */
export function flowersBonus(flowers: number): number {
  return RATING.bonus[Math.min(MAX_FLOWERS, Math.max(1, Math.round(flowers))) - 1];
}

/** 그 칸의 게임을 지금의 평가대로 내면 받는 잎사귀(대박은 뺀 것). 그 칸이 비었으면 0 */
export function ratedBonus(state: CompanyState, slot = 0): number {
  const project = projectAt(state, slot);
  if (!project) return 0;
  return Math.round(projectBonus(state, project.id) * flowersBonus(flowersNow(state, slot)));
}

/** 꽃이 이만큼일 때 대박이 날 확률. 행운이 있는 친구가 회사에 있으면 더 잘 난다. */
export function hitChance(state: CompanyState, flowers: number): number {
  const base = RATING.hitChance[Math.min(MAX_FLOWERS, Math.max(1, Math.round(flowers))) - 1];
  return Math.min(1, base * (companyHas(state, 'lucky') ? SKILL.lucky.chance : 1));
}

/**
 * 그 칸(0이면 먼저 시작한 게임)의 다 만든 프로젝트를 출시한다. 아직 덜 됐으면 null.
 * 먼저 시작한 게임을 내면 두 번째 칸의 게임이 그 자리로 올라간다. 예약해 둔 게임이 있으면 빈 칸에서 바로 시작한다.
 * 카드마다 쌓인 정성으로 평가(꽃)를 받고, 꽃이 많으면 보너스가 커진다(RATING).
 * random을 주면 꽃의 수에 따라 대박이 날 수 있고, 이어서 시작하는 게임에 특별한 카드가 나온다(startProject).
 * 주지 않으면 대박도 특별한 카드도 없다.
 */
export function release(state: CompanyState, random?: () => number, slot = 0): Release | null {
  const project = projectAt(state, slot);
  if (!project || !isReady(state, slot)) return null;
  const id = project.id;
  const flowers = flowersNow(state, slot);
  const chance = hitChance(state, flowers);
  const hit = random !== undefined && chance > 0 && random() < chance;
  const bonus = ratedBonus(state, slot) * (hit ? RATING.hit.bonus : 1);
  const reputation = projectReputation(state, id) * (hit ? RATING.hit.reputation : 1);
  const version = versionOf(state, id) + 1;
  state.leaves += bonus;
  state.reputation += reputation;
  state.released[id] = version;
  state.releases += 1;
  state.flowers[id] = Math.max(bestFlowers(state, id), flowers);
  if (hit) state.hits += 1;
  bumpGoals(state.goals, 'release');
  // 급한 의뢰의 카드와 함께 만드는 다른 게임의 카드는 남는다.
  const other = slot === 0 ? state.second : state.project;
  const keep = (task: Task): boolean => task.rush === true || (other !== null && ownerOf(state, task) === other);
  state.inbox = state.inbox.filter(keep);
  state.backlog = state.backlog.filter(keep);
  for (const task of [...state.inbox, ...state.backlog]) if (!task.rush && other) task.project = other.id;
  state.project = other;
  state.second = null;
  refill(state);
  startQueued(state, random);
  return { id, version, bonus, reputation, flowers, hit };
}

// ───────── 예약 줄 ─────────

/** 예약할 수 없는 까닭. idle은 만드는 게임이 없어서 예약할 것 없이 바로 시작하면 되는 때다. */
export type QueueBlock = 'locked' | 'idle' | 'full' | 'office' | 'department';

export function queueBlock(state: CompanyState, id: ProjectId): QueueBlock | null {
  if (QUEUE.unlockOffice > state.office) return 'locked';
  if (!isUnlocked(state, id)) return 'office';
  if (departmentsMissing(state, id) > 0) return 'department';
  if (hasFreeSlot(state)) return 'idle';
  if (state.queue.length >= QUEUE.slots) return 'full';
  return null;
}

/** 지금 만드는 게임 다음에 만들 게임을 예약한다. 같은 게임을 여러 번 예약해도 된다. */
export function enqueue(state: CompanyState, id: ProjectId): boolean {
  if (queueBlock(state, id) !== null) return false;
  state.queue.push(id);
  return true;
}

/** 예약 줄의 index번째를 뺀다. */
export function dequeue(state: CompanyState, index: number): boolean {
  if (!Number.isInteger(index) || index < 0 || index >= state.queue.length) return false;
  state.queue.splice(index, 1);
  return true;
}

/**
 * 빈 칸이 있으면 예약 줄의 맨 앞부터 시작한다. 시작할 수 없게 된 것은 건너뛴다.
 * 지금 만드는 게임과 같은 게임은 함께 만들 수 없어서, 그 칸이 빌 때까지 예약 줄에 남겨 둔다.
 */
function startQueued(state: CompanyState, random?: () => number): void {
  while (state.queue.length > 0 && hasFreeSlot(state)) {
    const at = state.queue.findIndex((id) => slotOf(state, id) < 0);
    if (at < 0) return;
    const [id] = state.queue.splice(at, 1);
    startProject(state, id, random);
  }
}

/** 예약이 있고 다 만든 게임이 있으면 저절로 출시한다. 출시한 것들의 결과를 돌려준다. */
function releaseQueued(state: CompanyState, random?: () => number): Release[] {
  const released: Release[] = [];
  for (let slot = readySlot(state); slot >= 0 && state.queue.length > 0; slot = readySlot(state)) {
    const result = release(state, random, slot);
    if (!result) break;
    released.push(result);
  }
  return released;
}

// ───────── 일 시키기 ─────────

/** 일감함의 카드를 책상에 맡긴다. 빈 자리이거나 이미 일하는 중이면 맡기지 못한다. */
export function assign(state: CompanyState, card: number, index: number): boolean {
  const desk = state.desks[index];
  const task = state.inbox[card];
  if (!desk?.staff || desk.task || desk.resting || !task) return false;
  state.inbox.splice(card, 1);
  desk.task = task;
  // 재빠른 친구는 카드를 받는 순간 얼마쯤을 해 둔다.
  if (hasSkill(state, index, 'dash')) task.left = Math.min(task.left, task.total * (1 - SKILL.dash.share));
  refill(state);
  return true;
}

/** 이 책상에 맡기기 좋은 카드의 번호: 가장 잘하는 업무의 카드, 다 같으면 맨 앞. 일감함이 비었거나 쉬는 중이면 -1 */
export function bestCardFor(state: CompanyState, index: number): number {
  const desk = state.desks[index];
  if (!desk?.staff || desk.resting || state.inbox.length === 0) return -1;
  let best = 0;
  let bestSkill = 0;
  state.inbox.forEach((task, card) => {
    const fit = skill(state, index, task.kind);
    if (fit > bestSkill) {
      best = card;
      bestSkill = fit;
    }
  });
  return best;
}

/** 이 책상의 카드가 버그에 막혀 있는가 */
export function isStuck(state: CompanyState, index: number): boolean {
  return (state.desks[index]?.task?.stuck ?? 0) > 0;
}

/** 버그를 잡으면 받는 잎사귀 */
export function bugReward(state: CompanyState): number {
  const least = SPECIAL.bug.minReward * 4 ** state.office;
  return Math.round(Math.max(least, incomePerSecond(state) * SPECIAL.bug.rewardSeconds));
}

/** 이 책상에 나온 버그를 잡는다. 일이 다시 나아가고 잎사귀를 받는다. 받은 잎사귀를 돌려주고, 버그가 없으면 0이다. */
export function squash(state: CompanyState, index: number): number {
  const task = state.desks[index]?.task;
  if (!task || !isStuck(state, index)) return 0;
  delete task.stuck;
  task.fixed = true;
  task.caught = true;
  const reward = bugReward(state);
  state.leaves += reward;
  return reward;
}

/** 옆자리에서 일하고 있는 친구의 수. 버그에 막힌 친구는 세지 않는다. */
export function busyNeighbors(state: CompanyState, index: number): number {
  return neighbors(state, index).filter((at) => state.desks[at].task !== null && !isStuck(state, at)).length;
}

/** 이 책상이 이 카드를 할 때 협업으로 붙는 배수. 협업 카드가 아니면 1 */
export function pairBoost(state: CompanyState, index: number, task: Task): number {
  return task.special === 'pair' ? 1 + SPECIAL.pair.boost * busyNeighbors(state, index) : 1;
}

/**
 * 이 책상이 이 카드를 할 때, 업무의 종류와 상관없이 그 카드라서 붙는 배수:
 * 협업 카드의 덤, 협동하는 친구가 옆자리 덕에 받는 덤, 해결사가 급한 의뢰에서 내는 힘을 곱한 것이다.
 */
export function cardBoost(state: CompanyState, index: number, task: Task): number {
  let boost = pairBoost(state, index, task);
  if (hasSkill(state, index, 'team')) boost *= 1 + SKILL.team.boost * busyNeighbors(state, index);
  if (task.rush && hasSkill(state, index, 'fixer')) {
    // 무슨 업무든 적어도 정해진 배수만큼은 한다. 특기라서 이미 빠른 만큼은 빼고 곱한다.
    boost *= Math.max(1, SKILL.fixer.boost / skill(state, index, task.kind));
  }
  return boost;
}

/** 응원 한 번이 이어지는 시간(초) */
export function cheerSeconds(state: CompanyState): number {
  return CHEER_SECONDS * (1 + companyBonus(state, 'cheer'));
}

/** 이 책상의 친구가 받는 응원이 이어지는 시간(초). 집중하는 친구는 더 오래간다. */
export function cheerSecondsAt(state: CompanyState, index: number): number {
  return cheerSeconds(state) * (hasSkill(state, index, 'focus') ? SKILL.focus.seconds : 1);
}

/** 이 책상의 친구가 응원받는 동안 빨라지는 배수 */
export function cheerBoostAt(state: CompanyState, index: number): number {
  return hasSkill(state, index, 'peppy') ? SKILL.peppy.boost : CHEER_BOOST;
}

/** 이 책상을 응원하면 함께 응원받는 옆자리들: 응원단장의 옆자리에서 일하고 있는 친구 */
export function cheerReach(state: CompanyState, index: number): number[] {
  if (!hasSkill(state, index, 'leader')) return [];
  return neighbors(state, index).filter((at) => state.desks[at].task !== null);
}

/** 책상 하나가 times번의 응원만큼 응원을 받는다. 남은 응원이 더 길면 그대로 둔다. */
function giveCheer(state: CompanyState, index: number, times = 1): void {
  const desk = state.desks[index];
  if (!desk.task) return;
  desk.cheer = Math.max(desk.cheer, cheerSecondsAt(state, index) * times);
  desk.task.cheered = true;
}

/** 일하는 책상을 응원한다. 잠깐 빨라진다. 응원단장을 응원하면 일하는 옆자리 친구도 함께 받는다. */
export function cheer(state: CompanyState, index: number): boolean {
  const desk = state.desks[index];
  if (!desk?.task) return false;
  giveCheer(state, index);
  for (const at of cheerReach(state, index)) giveCheer(state, at);
  bumpGoals(state.goals, 'cheer');
  return true;
}

/** 장사꾼이 카드 하나를 끝낼 때 받는 잎사귀 */
export function tradeReward(state: CompanyState): number {
  const least = SKILL.trader.least * 4 ** state.office;
  return Math.round(Math.max(least, incomePerSecond(state) * SKILL.trader.seconds));
}

/** 시간이 흐르는 동안 일어난 일 */
export type CompanyEvent =
  /**
   * 업무 하나가 끝났다. care는 그 카드가 받은 정성 점수(급한 의뢰의 카드는 0)이고,
   * ready는 이 카드로 그 게임의 카드를 모두 끝냈다는 뜻이다.
   */
  | { type: 'task'; desk: number; kind: TaskKind; rush: boolean; care: number; ready: boolean }
  /** 아이디어 카드를 끝내서 일하는 친구 모두가 응원을 받았다. */
  | { type: 'idea'; desk: number }
  /** 버그가 나와서 그 자리의 일이 멈췄다. */
  | { type: 'bug'; desk: number }
  /** 잡지 않은 버그가 저절로 사라졌다. */
  | { type: 'bugGone'; desk: number }
  /** 버그 사냥을 하는 친구가 제 자리의 버그를 스스로 잡았다. */
  | { type: 'bugCaught'; desk: number; reward: number }
  /** 장사꾼이 카드를 끝내면서 잎사귀를 받았다. */
  | { type: 'trade'; desk: number; reward: number }
  | { type: 'release'; release: Release }
  | { type: 'rushOffer' }
  | { type: 'rushWon'; reward: number }
  | { type: 'rushLost' };

const NOTHING: readonly CompanyEvent[] = [];

/**
 * 시간을 dt초 흘린다. 출시작이 잎사귀를 벌고, 책상마다 일이 줄어든다.
 * 그동안 일어난 일(끝난 업무, 급한 의뢰, 예약으로 저절로 된 출시)을 돌려준다. 끝난 자리는 비고,
 * 다음 카드를 맡길 때까지 쉰다(팀장이 있으면 팀장이 맡긴다).
 * random은 0 이상 1 미만의 수를 주고, 급한 의뢰를 정할 때 쓴다.
 */
export function advance(state: CompanyState, dt: number, random: () => number = Math.random): readonly CompanyEvent[] {
  if (!(dt > 0)) return NOTHING;
  state.leaves += incomePerSecond(state) * dt;
  const events = work(state, dt, random);
  for (const released of releaseQueued(state, random)) events.push({ type: 'release', release: released });
  tickRush(state, dt, random, events);
  return events;
}

/** 책상의 일만 dt초 진행한다. 잎사귀는 벌지 않는다. */
function work(state: CompanyState, dt: number, random: () => number): CompanyEvent[] {
  const done: CompanyEvent[] = [];
  const open = breakOpen(state);
  const stamina = open ? staminaSeconds(state) : 0;
  const rest = open ? restSeconds(state) : 0;
  for (let index = 0; index < state.desks.length; index += 1) {
    const desk = state.desks[index];
    if (desk.resting) {
      // 휴게실에서 쉬는 중: 기운이 가득 차면 자리로 돌아온다.
      desk.energy = open ? Math.min(1, desk.energy + dt / rest) : 1;
      if (desk.energy >= 1 || !desk.staff) desk.resting = false;
      continue;
    }
    const task = desk.task;
    if (!task) {
      desk.cheer = 0;
      if (open && desk.staff) {
        // 기운이 바닥났으면 쉬러 가고, 아니면 자리에서 기다리며 천천히 채운다.
        if (canRest(state, desk)) desk.resting = true;
        else desk.energy = Math.min(1, desk.energy + (dt * BREAK.idle) / rest);
      }
      continue;
    }
    if (task.stuck !== undefined) {
      // 버그에 막힌 동안에는 일도 기운도 그대로다. 잡지 않고 두면 얼마 뒤에 저절로 사라진다.
      task.stuck -= dt;
      if (task.stuck <= 0) {
        delete task.stuck;
        task.fixed = true;
        done.push({ type: 'bugGone', desk: index });
      }
      continue;
    }
    const speed = plainSpeed(state, index) * skill(state, index, task.kind) * cardBoost(state, index, task);
    const lift = cheerBoostAt(state, index);
    // 응원과 기운은 남은 동안만 빠르다. 한 번에 긴 시간을 흘려도 끝난 뒤는 보통 속도로 센다.
    const cheered = Math.min(desk.cheer, dt);
    const peppy = open ? Math.min(desk.energy * stamina, dt) : 0;
    const both = Math.min(cheered, peppy);
    const pep = 1 + BREAK.boost;
    task.left -=
      speed *
      (both * lift * pep + (cheered - both) * lift + (peppy - both) * pep + (dt - Math.max(cheered, peppy)));
    desk.cheer = Math.max(0, desk.cheer - dt);
    if (open) desk.energy = Math.max(0, desk.energy - dt / stamina);
    if (task.special === 'bug' && !task.fixed) {
      // 버그 카드는 정해진 만큼 하면 버그가 나와서 멈춘다.
      const mark = task.total * (1 - SPECIAL.bug.at);
      if (task.left <= mark && hasSkill(state, index, 'hunter')) {
        // 버그 사냥을 하는 친구는 멈추지 않고 그 자리에서 잡는다.
        task.fixed = true;
        task.caught = true;
        const reward = bugReward(state);
        state.leaves += reward;
        done.push({ type: 'bugCaught', desk: index, reward });
      } else if (task.left <= mark) {
        task.left = mark;
        task.stuck = SPECIAL.bug.wait;
        done.push({ type: 'bug', desk: index });
        continue;
      }
    }
    if (task.left <= 0) {
      desk.task = null;
      desk.cheer = 0;
      const owner = ownerOf(state, task);
      const care = owner ? careFor(state, index, task) : 0;
      if (owner) {
        owner.done = Math.min(owner.total, owner.done + 1);
        owner.care += care;
      }
      const ready = owner !== null && owner.done >= owner.total;
      done.push({ type: 'task', desk: index, kind: task.kind, rush: task.rush === true, care, ready });
      bumpGoals(state.goals, 'task');
      if (task.special === 'idea') {
        // 아이디어가 번뜩이면 그때 일하고 있는 친구 모두가 응원을 받는다.
        state.desks.forEach((_, at) => giveCheer(state, at, SPECIAL.idea.cheer));
        done.push({ type: 'idea', desk: index });
      }
      if (hasSkill(state, index, 'trader')) {
        const reward = tradeReward(state);
        state.leaves += reward;
        done.push({ type: 'trade', desk: index, reward });
      }
      if (task.rush) {
        const rush = state.rush;
        if (rush && (rush.done += 1) >= rush.total) {
          state.leaves += rush.reward;
          done.push({ type: 'rushWon', reward: rush.reward });
          bumpGoals(state.goals, 'rush');
          state.rush = null;
          state.rushIn = nextRushIn(random);
        }
      }
      // 기운이 바닥난 채로 일을 마쳤으면 다음 일을 받기 전에 쉬러 간다.
      if (open && canRest(state, desk)) desk.resting = true;
    }
  }
  leadAssign(state, dt);
  return done;
}

// ───────── 교육 ─────────

export function trainCost(level: number): number {
  return Math.round(TRAINING.baseCost * TRAINING.growth ** level);
}

/** 이 책상의 직원을 교육할 수 없는 까닭. 할 수 있으면 null */
export function trainBlock(state: CompanyState, index: number): BuyBlock | null {
  if (TRAINING.unlockOffice > state.office) return 'locked';
  const desk = state.desks[index];
  if (!desk?.staff) return 'empty';
  if (desk.level >= TRAINING.maxLevel) return 'max';
  if (state.leaves < trainCost(desk.level)) return 'poor';
  return null;
}

/** 이 책상의 직원을 교육해서 레벨을 하나 올린다. */
export function train(state: CompanyState, index: number): boolean {
  if (trainBlock(state, index) !== null) return false;
  const desk = state.desks[index];
  state.leaves -= trainCost(desk.level);
  desk.level += 1;
  bumpGoals(state.goals, 'train');
  return true;
}

/**
 * 교육과 장비 목표를 오늘 몇 번까지 채울 수 있는지(새 목표를 정할 때 쓴다. goals.ts의 goalsFor).
 * 남은 단계가 모자라거나, 값이 너무 올라서 가진 잎사귀와 GOAL_BUDGET_SECONDS 동안 버는 잎사귀로는
 * 몇 번 못 사는 날이 있다. 싼 것부터 사 나간다고 보고 센다. 가장 큰 목표의 수까지만 센다.
 * 아직 버는 것이 없으면(첫 출시 전) 얼마나 벌지 알 수 없으니 값은 따지지 않는다.
 */
export function goalLimits(state: CompanyState): GoalLimits {
  const most = (kind: GoalKind): number => Math.max(...GOALS[kind].targets);
  const income = incomePerSecond(state);
  const budget = income > 0 ? state.leaves + income * GOAL_BUDGET_SECONDS : Number.POSITIVE_INFINITY;

  // 사람마다, 장비마다 다음 단계부터의 값. 단계가 오를수록 비싸진다.
  const lessons: number[][] = [];
  for (const desk of state.desks) {
    if (!desk.staff) continue;
    lessons.push(costsFrom(desk.level, TRAINING.maxLevel, most('train'), trainCost));
  }
  const upgrades: number[][] = [];
  for (const id of EQUIPMENT_ORDER) {
    const def: EquipmentDef = EQUIPMENT[id];
    if (def.unlockOffice > state.office) continue;
    const cost = (level: number): number => equipmentCost(id, level);
    if (def.scope === 'company') {
      upgrades.push(costsFrom(equipmentLevel(state, id), def.maxLevel, most('upgrade'), cost));
      continue;
    }
    state.desks.forEach((desk, index) => {
      if (desk.staff) upgrades.push(costsFrom(equipmentLevel(state, id, index), def.maxLevel, most('upgrade'), cost));
    });
  }
  return {
    train: affordable(lessons, budget, most('train')),
    upgrade: affordable(upgrades, budget, most('upgrade')),
  };
}

/** level부터 max 전까지 한 단계씩 올리는 값. 많아야 count개까지만 적는다. */
function costsFrom(level: number, max: number, count: number, cost: (level: number) => number): number[] {
  const costs: number[] = [];
  for (let next = level; next < max && costs.length < count; next += 1) costs.push(cost(next));
  return costs;
}

/** 줄마다 앞에서부터 사야 하는 값들에서, budget으로 싼 것부터 몇 번 살 수 있는지. 많아야 limit번까지 센다. */
function affordable(chains: readonly (readonly number[])[], budget: number, limit: number): number {
  const next = chains.map(() => 0);
  let left = budget;
  let count = 0;
  while (count < limit) {
    let best = -1;
    for (let index = 0; index < chains.length; index += 1) {
      const cost = chains[index][next[index]];
      if (cost !== undefined && (best < 0 || cost < chains[best][next[best]])) best = index;
    }
    if (best < 0 || chains[best][next[best]] > left) break;
    left -= chains[best][next[best]];
    next[best] += 1;
    count += 1;
  }
  return count;
}

// ───────── 급한 의뢰 ─────────

function nextRushIn(random: () => number): number {
  const [from, to] = RUSH.every;
  return from + (to - from) * random();
}

/** 지금 회사에 맞는 급한 의뢰를 하나 만든다. */
function makeOffer(state: CompanyState, random: () => number): RushOffer {
  const staff = staffCount(state);
  const count = Math.max(RUSH.cards[0], Math.min(RUSH.cards[1], Math.floor(staff / 2)));
  const kinds: TaskKind[] = [];
  for (let index = 0; index < count; index += 1) {
    kinds.push(TASK_KINDS[Math.min(TASK_KINDS.length - 1, Math.floor(random() * TASK_KINDS.length))]);
  }
  // 특기가 아닌 직원이 응원 없이 하면 시간이 빠듯하게 드는 만큼의 일을 준다.
  let speed = 0;
  for (let index = 0; index < state.desks.length; index += 1) speed += plainSpeed(state, index);
  const work = RUSH.effort * RUSH.seconds * (speed / Math.max(1, staff));
  const reward = Math.round(Math.max(RUSH.minReward * 4 ** state.office, incomePerSecond(state) * RUSH.rewardSeconds));
  return { kinds, work, reward, left: RUSH.offerSeconds };
}

/** 들어온 의뢰를 받는다. 카드가 일감함 맨 앞에 놓이고 시간이 흐르기 시작한다. */
export function acceptRush(state: CompanyState): boolean {
  const offer = state.offer;
  if (!offer || state.rush) return false;
  const cards: Task[] = offer.kinds.map((kind) => ({ kind, left: offer.work, total: offer.work, rush: true }));
  state.inbox.unshift(...cards);
  // 급한 일이 오면 쉬던 친구들도 채운 만큼만 가지고 자리로 돌아온다.
  for (const desk of state.desks) desk.resting = false;
  state.rush = { total: cards.length, done: 0, left: RUSH.seconds, seconds: RUSH.seconds, reward: offer.reward };
  state.offer = null;
  return true;
}

/** 들어온 의뢰를 받지 않고 보낸다. */
export function declineRush(state: CompanyState, random: () => number = Math.random): boolean {
  if (!state.offer) return false;
  state.offer = null;
  state.rushIn = nextRushIn(random);
  return true;
}

/** 하던 의뢰를 거둔다. 남은 카드는 일감함에서도 책상에서도 사라진다. */
function dropRush(state: CompanyState, random: () => number): void {
  state.inbox = state.inbox.filter((task) => !task.rush);
  for (const desk of state.desks) {
    if (desk.task?.rush) {
      desk.task = null;
      desk.cheer = 0;
    }
  }
  state.rush = null;
  state.rushIn = nextRushIn(random);
  refill(state);
}

function tickRush(state: CompanyState, dt: number, random: () => number, events: CompanyEvent[]): void {
  if (RUSH.unlockOffice > state.office) return;
  if (state.rush) {
    state.rush.left -= dt;
    if (state.rush.left <= 0) {
      dropRush(state, random);
      events.push({ type: 'rushLost' });
    }
    return;
  }
  if (state.offer) {
    state.offer.left -= dt;
    if (state.offer.left <= 0) declineRush(state, random);
    return;
  }
  state.rushIn -= dt;
  if (state.rushIn <= 0) {
    state.rushIn = 0;
    state.offer = makeOffer(state, random);
    events.push({ type: 'rushOffer' });
  }
}

// ───────── 팀장 ─────────

/** 지금 팀장의 솜씨. 팀장이 없으면 null */
export function leadLevel(state: CompanyState): LeadLevel | null {
  return state.lead > 0 ? (LEAD.levels[Math.min(state.lead, LEAD.levels.length) - 1] ?? null) : null;
}

export type LeadBlock = 'locked' | 'max' | 'poor';

/** 팀장을 한 단계 올릴 수 없는 까닭. 올릴 수 있으면 null */
export function leadBlock(state: CompanyState): LeadBlock | null {
  if (LEAD.unlockOffice > state.office) return 'locked';
  const next = LEAD.levels[state.lead];
  if (!next) return 'max';
  if (state.leaves < next.cost) return 'poor';
  return null;
}

/** 팀장을 두거나 한 단계 올린다. */
export function promoteLead(state: CompanyState): boolean {
  if (leadBlock(state) !== null) return false;
  state.leaves -= LEAD.levels[state.lead].cost;
  state.lead += 1;
  state.leadWait = LEAD.levels[state.lead - 1].delay;
  return true;
}

/**
 * 팀장이 쉬는 친구에게 카드를 맡긴다. 쉬는 친구와 카드가 함께 있는 동안에만 시간이 가고,
 * 정해진 시간이 지날 때마다 한 장씩 맡긴다. 맡긴 책상의 번호를 돌려주고, 맡기지 않았으면 -1이다.
 */
function leadAssign(state: CompanyState, dt: number): number {
  const level = leadLevel(state);
  if (!level) return -1;
  const idle: number[] = [];
  for (let index = 0; index < state.desks.length; index += 1) {
    const desk = state.desks[index];
    if (desk.staff && !desk.task && !desk.resting) idle.push(index);
  }
  if (idle.length === 0 || state.inbox.length === 0) {
    state.leadWait = level.delay;
    return -1;
  }
  state.leadWait = Math.min(state.leadWait, level.delay) - dt;
  if (state.leadWait > 0) return -1;
  state.leadWait = level.delay;

  let desk = idle[0];
  let card = 0;
  if (level.match) {
    // 그 업무를 가장 잘하는 친구와 카드의 짝부터 맡긴다. 특기도 부서도 맞는 짝이 없으면 맨 앞끼리 맡긴다.
    let bestSkill = 1;
    for (const index of idle) {
      const match = bestCardFor(state, index);
      const fit = skill(state, index, state.inbox[match].kind);
      if (fit > bestSkill) {
        desk = index;
        card = match;
        bestSkill = fit;
      }
    }
  }
  return assign(state, card, desk) ? desk : -1;
}

// ───────── 닫아 둔 동안 ─────────

export interface Away {
  /** 센 시간(초). 가장 긴 시간을 넘으면 거기서 잘린다. */
  seconds: number;
  /** 그동안 번 잎사귀 */
  leaves: number;
  /** 그동안 끝난 업무의 수 */
  tasks: number;
  /** 가장 긴 시간을 넘겨서 잘렸는가 */
  capped: boolean;
  /** 그동안 예약 줄 덕분에 저절로 된 출시 */
  releases: Release[];
}

/** 닫아 둔 동안 출시작이 버는 몫. 열어 둔 때를 1로 친다. */
export function awayRate(state: CompanyState): number {
  return AWAY.rate * (1 + companyBonus(state, 'away'));
}

/**
 * 닫아 둔 seconds초를 한꺼번에 흘린다. 출시작은 평소의 일부만 벌고, 맡겨 둔 업무는 그대로 진행된다
 * (팀장이 있으면 남은 카드도 맡기고, 예약해 둔 게임이 있으면 다 만든 게임을 출시하고 이어서 만든다).
 * 너무 짧게 비웠으면 아무 일도 하지 않고 null을 돌려준다.
 */
export function catchUp(state: CompanyState, seconds: number): Away | null {
  if (!(seconds >= AWAY.minSeconds)) return null;
  const counted = Math.min(seconds, AWAY.maxSeconds);
  // 급한 의뢰는 자리를 비우면 놓친다. 들어와 있던 의뢰도 그냥 지나간다.
  const fixed = (): number => 0.5;
  if (state.rush) dropRush(state, fixed);
  if (state.offer) declineRush(state, fixed);
  const leaves = incomePerSecond(state) * counted * awayRate(state);
  state.leaves += leaves;
  let tasks = 0;
  const releases: Release[] = [];
  const releaseDone = (): void => {
    releases.push(...releaseQueued(state));
  };
  for (let time = 0; time < counted; time += 1) {
    releaseDone();
    const working = state.desks.some((desk) => desk.task !== null);
    if (!working && (state.lead === 0 || state.inbox.length === 0)) break;
    tasks += work(state, 1, fixed).filter((event) => event.type === 'task').length;
  }
  releaseDone();
  return { seconds: counted, leaves, tasks, capped: seconds > AWAY.maxSeconds, releases };
}

/** passOpen의 결과 */
export interface Passed {
  /** 그동안 번 잎사귀. 출시 보너스와 의뢰의 보상까지 넣은 것이다. */
  leaves: number;
  /** 그동안 예약 줄 덕분에 저절로 된 출시 */
  releases: Release[];
}

/**
 * 회사를 열어 둔 채 아무것도 누르지 않고 seconds초를 보낸 것처럼 1초씩 흘린다.
 * 회사에서 보낸 게임을 하고 돌아왔을 때 그 시간을 셈하는 데 쓴다(data.ts의 PLAY_TRIP).
 * 닫아 둔 동안(catchUp)과 달리 출시작이 평소만큼 벌고, 급한 의뢰도 열어 둔 때처럼 오고 간다.
 */
export function passOpen(state: CompanyState, seconds: number, random: () => number = Math.random): Passed {
  const before = state.leaves;
  const releases: Release[] = [];
  for (let time = 0; time < seconds; time += 1) {
    for (const event of advance(state, Math.min(1, seconds - time), random)) {
      if (event.type === 'release') releases.push(event.release);
    }
  }
  return { leaves: state.leaves - before, releases };
}

/** 시간을 짧게 적는다: 45초, 12분, 2시간 5분 */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  if (total < 60) return `${total}초`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}분`;
  const rest = minutes % 60;
  return rest > 0 ? `${Math.floor(minutes / 60)}시간 ${rest}분` : `${Math.floor(minutes / 60)}시간`;
}

// ───────── 장비 ─────────

export function equipmentCost(id: EquipmentId, level: number): number {
  const def: EquipmentDef = EQUIPMENT[id];
  return Math.round(def.baseCost * def.growth ** level);
}

export type BuyBlock = 'locked' | 'max' | 'poor' | 'empty';

/** 장비를 한 레벨 올릴 수 없는 까닭. 올릴 수 있으면 null */
export function equipmentBlock(state: CompanyState, id: EquipmentId, desk = -1): BuyBlock | null {
  const def: EquipmentDef = EQUIPMENT[id];
  if (def.unlockOffice > state.office) return 'locked';
  if (def.scope === 'desk' && !state.desks[desk]?.staff) return 'empty';
  const level = equipmentLevel(state, id, desk);
  if (level >= def.maxLevel) return 'max';
  if (state.leaves < equipmentCost(id, level)) return 'poor';
  return null;
}

export function buyEquipment(state: CompanyState, id: EquipmentId, desk = -1): boolean {
  if (equipmentBlock(state, id, desk) !== null) return false;
  const def: EquipmentDef = EQUIPMENT[id];
  const level = equipmentLevel(state, id, desk);
  state.leaves -= equipmentCost(id, level);
  const levels = def.scope === 'company' ? state.gear : state.desks[desk].gear;
  levels[id] = level + 1;
  bumpGoals(state.goals, 'upgrade');
  return true;
}

// ───────── 직원 ─────────

export function staffCount(state: CompanyState): number {
  return state.desks.reduce((count, desk) => count + (desk.staff ? 1 : 0), 0);
}

/** 아직 회사에 없는 친구들 */
export function hirePool(state: CompanyState): StaffId[] {
  const taken = new Set(state.desks.map((desk) => desk.staff));
  return STAFF_ORDER.filter((id) => !taken.has(id));
}

/** 다음 한 사람을 뽑는 데 드는 잎사귀 */
export function hireCost(state: CompanyState): number {
  return Math.round(HIRE_COST.base * HIRE_COST.growth ** Math.max(0, staffCount(state) - 2));
}

export function hasFreeDesk(state: CompanyState): boolean {
  return state.desks.some((desk) => desk.staff === null);
}

/**
 * 지금 와 있는 지원자. 없으면 새로 정한다. random은 0 이상 1 미만의 수를 준다.
 * 이미 뽑힌 친구가 섞여 있으면(세이브를 옮긴 뒤 같은 때) 다시 정한다.
 */
export function candidatesFor(state: CompanyState, random: () => number = Math.random): StaffId[] {
  const pool = hirePool(state);
  const current = state.candidates;
  if (current && current.length > 0 && current.every((id) => pool.includes(id))) return current;
  const picked: StaffId[] = [];
  while (picked.length < CANDIDATE_COUNT && pool.length > 0) {
    const at = Math.min(pool.length - 1, Math.floor(random() * pool.length));
    picked.push(...pool.splice(at, 1));
  }
  state.candidates = picked;
  return picked;
}

export type HireBlock = 'full' | 'poor' | 'gone';

export function hireBlock(state: CompanyState, id: StaffId): HireBlock | null {
  if (!hirePool(state).includes(id)) return 'gone';
  if (!hasFreeDesk(state)) return 'full';
  if (state.leaves < hireCost(state)) return 'poor';
  return null;
}

/** 지원자를 뽑아 빈 자리에 앉힌다. 앉은 책상의 번호를 돌려준다. 못 뽑으면 -1 */
export function hire(state: CompanyState, id: StaffId): number {
  if (hireBlock(state, id) !== null) return -1;
  state.leaves -= hireCost(state);
  const index = state.desks.findIndex((desk) => desk.staff === null);
  state.desks[index].staff = id;
  state.candidates = null;
  // 특기에 맞는 부서에 자리가 있으면 바로 든다.
  for (const dept of DEPARTMENT_ORDER) fillDepartment(state, dept);
  return index;
}

// ───────── 부서 ─────────

/** 부서의 단계. 0이면 아직 세우지 않았다. */
export function departmentLevel(state: CompanyState, id: DepartmentId): number {
  return state.departments[id] ?? 0;
}

/** 세워 둔 부서의 수 */
export function departmentCount(state: CompanyState): number {
  return DEPARTMENT_ORDER.reduce((count, id) => count + (departmentLevel(state, id) > 0 ? 1 : 0), 0);
}

/** 돕는 부서인가: 맡는 업무가 없고, 부서원의 수만큼 회사 전체를 돕는다. */
export function isSupport(id: DepartmentId): boolean {
  return (DEPARTMENTS[id] as DepartmentDef).effect !== undefined;
}

/** 돕는 부서의 부서원 한 명이 그 단계에서 회사에 보태는 몫. 일하는 부서는 0 */
export function supportShare(id: DepartmentId, level: number): number {
  return ((DEPARTMENTS[id] as DepartmentDef).effect?.amount ?? 0) * Math.max(0, level);
}

/** 돕는 부서가 지금 회사에 보태는 몫: 한 명의 몫 × 부서원의 수 */
export function supportBonus(state: CompanyState, id: DepartmentId): number {
  return supportShare(id, departmentLevel(state, id)) * departmentMembers(state, id).length;
}

/** 일하는 부서의 그 단계가 부서원에게 주는 속도. 0.6이면 그 부서의 업무를 60% 더 빨리 한다. */
export function departmentBoost(level: number): number {
  return DEPARTMENT.boost * Math.max(0, level);
}

/** 그 단계의 부서에 들 수 있는 사람의 수 */
export function departmentSeats(level: number): number {
  return level <= 0 ? 0 : DEPARTMENT.seats[Math.min(level, DEPARTMENT.seats.length) - 1];
}

/** 이 부서에 든 직원이 앉은 책상의 번호 */
export function departmentMembers(state: CompanyState, id: DepartmentId): number[] {
  const members: number[] = [];
  state.desks.forEach((desk, index) => {
    if (desk.staff && desk.dept === id) members.push(index);
  });
  return members;
}

/** n단계에서 n+1단계로 올리는 값. 0단계에서 올리는 것이 부서를 세우는 것이다. */
export function departmentCost(level: number): number {
  return Math.round(DEPARTMENT.baseCost * DEPARTMENT.growth ** level);
}

/** 부서를 세우거나 한 단계 올릴 수 없는 까닭. 할 수 있으면 null */
export function departmentBlock(state: CompanyState, id: DepartmentId): LeadBlock | null {
  if (DEPARTMENT.unlockOffice > state.office) return 'locked';
  const level = departmentLevel(state, id);
  if (level >= DEPARTMENT.maxLevel) return 'max';
  if (state.leaves < departmentCost(level)) return 'poor';
  return null;
}

/**
 * 빈 자리를 아직 부서가 없는 친구로 채운다.
 * 일하는 부서에는 특기가 그 업무인 친구만 든다. 돕는 부서에는 누구나 들되, 특기가 없는 사장이 먼저 든다.
 */
function fillDepartment(state: CompanyState, id: DepartmentId): void {
  let free = departmentSeats(departmentLevel(state, id)) - departmentMembers(state, id).length;
  const kind = (DEPARTMENTS[id] as DepartmentDef).kind;
  const take = (fits: (staff: StaffId) => boolean): void => {
    for (const desk of state.desks) {
      if (free <= 0) return;
      if (!desk.staff || desk.dept !== null || !fits(desk.staff)) continue;
      desk.dept = id;
      free -= 1;
    }
  };
  if (kind !== null) {
    take((staff) => specialtyOf(state, staff) === kind);
    return;
  }
  take((staff) => specialtyOf(state, staff) === null);
  take(() => true);
}

/** 부서를 세우거나 한 단계 올린다. 새로 난 자리에는 아직 부서가 없는 친구가 알아서 든다(fillDepartment). */
export function upgradeDepartment(state: CompanyState, id: DepartmentId): boolean {
  if (departmentBlock(state, id) !== null) return false;
  const level = departmentLevel(state, id);
  state.leaves -= departmentCost(level);
  state.departments[id] = level + 1;
  fillDepartment(state, id);
  return true;
}

/** 부서에 넣을 수 없는 까닭: 빈 책상, 아직 세우지 않은 부서, 이미 든 부서, 자리가 다 찬 부서 */
export type JoinBlock = 'empty' | 'closed' | 'member' | 'full';

export function joinBlock(state: CompanyState, index: number, id: DepartmentId): JoinBlock | null {
  const desk = state.desks[index];
  if (!desk?.staff) return 'empty';
  const level = departmentLevel(state, id);
  if (level <= 0) return 'closed';
  if (desk.dept === id) return 'member';
  if (departmentMembers(state, id).length >= departmentSeats(level)) return 'full';
  return null;
}

/** 이 책상의 직원을 부서에 넣는다. 다른 부서에 있었으면 옮겨 온다. */
export function joinDepartment(state: CompanyState, index: number, id: DepartmentId): boolean {
  if (joinBlock(state, index, id) !== null) return false;
  state.desks[index].dept = id;
  return true;
}

/** 이 책상의 직원을 부서에서 뺀다. */
export function leaveDepartment(state: CompanyState, index: number): boolean {
  const desk = state.desks[index];
  if (!desk?.dept) return false;
  desk.dept = null;
  return true;
}

// ───────── 사무실 ─────────

export type MoveBlock = 'last' | 'reputation' | 'poor';

export function moveBlock(state: CompanyState): MoveBlock | null {
  const next = OFFICES[state.office + 1];
  if (!next) return 'last';
  if (state.reputation < next.reputation) return 'reputation';
  if (state.leaves < next.cost) return 'poor';
  return null;
}

/** 지금 다음 사무실로 이사하면 받는 허브의 코인. 전에 가 본 곳이면 0 */
export function moveCoins(state: CompanyState): number {
  const next = state.office + 1;
  return next > state.topOffice ? (OFFICE_COINS[next] ?? 0) : 0;
}

/** 다음 사무실로 이사한다. 책상 자리가 늘어난다. */
export function moveOffice(state: CompanyState): boolean {
  if (moveBlock(state) !== null) return false;
  const next = OFFICES[state.office + 1];
  state.leaves -= next.cost;
  state.office += 1;
  state.topOffice = Math.max(state.topOffice, state.office);
  while (state.desks.length < next.desks) state.desks.push(emptyDesk());
  return true;
}

// ───────── 자회사 ─────────

/** 허브에 남는 기록: 자회사들이 쌓았던 평판에 지금 회사의 평판을 더한 것. 자회사를 세워도 줄지 않는다. */
export function totalReputation(state: CompanyState): number {
  return state.legacy + state.reputation;
}

/** 평판이 이만큼인 회사를 자회사로 세우면 받는 열매 */
export function fruitFor(reputation: number): number {
  return Math.max(0, Math.floor(reputation / BRANCH.perFruit));
}

/** 자회사를 세울 수 없는 까닭: 아직 가장 큰 사무실이 아니거나, 평판이 모자란다. */
export type FoundBlock = 'office' | 'reputation';

export function foundBlock(state: CompanyState): FoundBlock | null {
  if (state.office < OFFICES.length - 1) return 'office';
  if (state.reputation < BRANCH.reputation) return 'reputation';
  return null;
}

/** 본사의 힘 '종잣돈'으로 새 회사가 들고 시작하는 잎사귀 */
export function seedLeaves(state: CompanyState): number {
  let sum = 0;
  for (const id of PERK_ORDER) {
    const seed = (PERKS[id] as PerkDef).seed;
    const level = perkLevel(state, id);
    if (seed && level > 0) sum += seed[Math.min(level, seed.length) - 1];
  }
  return sum;
}

export interface Founding {
  /** 이번에 받은 열매 */
  fruit: number;
  /** 세우고 난 뒤의 자회사 수 */
  branches: number;
  /** 새 회사가 들고 시작하는 잎사귀 */
  seed: number;
}

/**
 * 지금 회사를 자회사로 세우고, 옥탑방에서 새 회사를 시작한다.
 * 잎사귀, 직원, 장비, 사무실, 부서, 낸 게임이 처음으로 돌아간다. 열매와 본사의 힘, 직접 해서 딴 별,
 * 지금까지의 평판 기록, 오늘의 목표, 본 안내는 그대로 남는다.
 */
export function foundBranch(state: CompanyState): Founding | null {
  if (foundBlock(state) !== null) return null;
  const fruit = fruitFor(state.reputation);
  const fresh = createCompany(state.boss, state.savedAt);
  const kept: Partial<CompanyState> = {
    branches: state.branches + 1,
    legacy: state.legacy + state.reputation,
    fruit: state.fruit + fruit,
    perks: state.perks,
    topOffice: state.topOffice,
    decor: state.decor,
    // 자회사를 세울 만큼 키운 사람에게는 길잡이를 다시 띄우지 않는다.
    guide: GUIDE_STEPS.length,
    stars: state.stars,
    releases: state.releases,
    goals: state.goals,
    tips: state.tips,
  };
  Object.assign(state, fresh, kept);
  const seed = seedLeaves(state);
  state.leaves = seed;
  return { fruit, branches: state.branches, seed };
}

// ───────── 사옥 꾸미기 ─────────

/** 사 둔 꾸미기(owned)와 곳마다 지금 쓰는 것. 쓰는 것이 없으면 null */
export interface Decor extends Record<DecorSlot, DecorId | null> {
  owned: DecorId[];
}

/** 이 곳에 지금 쓰는 꾸미기. 기본 모습이면 null */
export function decorOf(state: CompanyState, slot: DecorSlot): DecorDef | null {
  const id = state.decor[slot];
  return id ? DECOR[id] : null;
}

/** 이 꾸미기를 살 수 없는 까닭. coins는 가진 허브의 코인이다. 살 수 있으면 null */
export function decorBlock(state: CompanyState, id: DecorId, coins: number): 'owned' | 'poor' | null {
  if (state.decor.owned.includes(id)) return 'owned';
  if (!(coins >= DECOR[id].cost)) return 'poor';
  return null;
}

/** 꾸미기를 사서 바로 쓴다. 치를 코인을 돌려주고, 못 샀으면 0이다. 코인을 빼는 일은 부른 쪽이 한다. */
export function buyDecor(state: CompanyState, id: DecorId, coins: number): number {
  if (decorBlock(state, id, coins) !== null) return 0;
  const def: DecorDef = DECOR[id];
  state.decor.owned.push(id);
  state.decor[def.slot] = id;
  return def.cost;
}

/** 사 둔 꾸미기로 바꾼다. id가 null이면 기본 모습으로 돌린다. */
export function useDecor(state: CompanyState, slot: DecorSlot, id: DecorId | null): boolean {
  if (id !== null && (!state.decor.owned.includes(id) || (DECOR[id] as DecorDef).slot !== slot)) return false;
  if (state.decor[slot] === id) return false;
  state.decor[slot] = id;
  return true;
}

function normalizeDecor(raw: unknown): Decor {
  const decor: Decor = { owned: [], wall: null, floor: null, sign: null };
  if (!isObject(raw)) return decor;
  if (Array.isArray(raw.owned)) {
    // 산 차례를 그대로 둔다.
    for (const entry of raw.owned as unknown[]) {
      const id = DECOR_ORDER.find((known) => known === entry);
      if (id && !decor.owned.includes(id)) decor.owned.push(id);
    }
  }
  for (const slot of DECOR_SLOTS) {
    const id = decor.owned.find((owned) => owned === raw[slot]);
    if (id && (DECOR[id] as DecorDef).slot === slot) decor[slot] = id;
  }
  return decor;
}

/** n단계에서 n+1단계로 올리는 데 드는 열매 */
export function perkCost(id: PerkId, level: number): number {
  return (PERKS[id] as PerkDef).baseCost * (level + 1);
}

/** 본사의 힘을 한 단계 올릴 수 없는 까닭. 올릴 수 있으면 null */
export function perkBlock(state: CompanyState, id: PerkId): 'max' | 'poor' | null {
  const level = perkLevel(state, id);
  if (level >= (PERKS[id] as PerkDef).maxLevel) return 'max';
  if (state.fruit < perkCost(id, level)) return 'poor';
  return null;
}

/** 열매를 써서 본사의 힘을 한 단계 올린다. 종잣돈은 올린 그 자리에서도 한 번 받는다. */
export function buyPerk(state: CompanyState, id: PerkId): boolean {
  if (perkBlock(state, id) !== null) return false;
  const def: PerkDef = PERKS[id];
  const level = perkLevel(state, id);
  state.fruit -= perkCost(id, level);
  state.perks[id] = level + 1;
  if (def.seed) state.leaves += def.seed[Math.min(level + 1, def.seed.length) - 1];
  return true;
}

// ───────── 숫자 보여 주기 ─────────

/** 잎사귀를 짧게 적는다: 1234, 1.2만, 3.4억 */
export function formatLeaves(value: number): string {
  const amount = Math.max(0, Math.floor(value));
  if (amount < 10_000) return String(amount);
  const [unit, name] = amount < 100_000_000 ? [10_000, '만'] : [100_000_000, '억'];
  const scaled = amount / unit;
  // 내림으로 적어서, 값을 치를 수 있다고 보이는데 모자라는 일이 없게 한다.
  return scaled < 100 ? `${(Math.floor(scaled * 10) / 10).toFixed(1)}${name}` : `${Math.floor(scaled)}${name}`;
}

/** 초당 수익을 적는다. 작을 때는 소수 한 자리까지 */
export function formatRate(value: number): string {
  if (value <= 0) return '0';
  return value < 10 ? (Math.floor(value * 10) / 10).toFixed(1) : formatLeaves(value);
}

// ───────── 세이브 읽기 ─────────

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toNumber = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;

const toCount = (value: unknown, max = Number.MAX_SAFE_INTEGER): number => Math.floor(toNumber(value, 0, max));

const isStaffId = (value: unknown): value is StaffId => typeof value === 'string' && value in STAFF;
const isProjectId = (value: unknown): value is ProjectId => typeof value === 'string' && value in PROJECTS;
const isTaskKind = (value: unknown): value is TaskKind => (TASK_KINDS as readonly unknown[]).includes(value);
const isSpecialKind = (value: unknown): value is SpecialKind => (SPECIAL_KINDS as readonly unknown[]).includes(value);
const isDepartmentId = (value: unknown): value is DepartmentId => typeof value === 'string' && value in DEPARTMENTS;

function normalizeLevels(raw: unknown, scope: EquipmentDef['scope']): Levels {
  const levels: Levels = {};
  if (!isObject(raw)) return levels;
  for (const id of EQUIPMENT_ORDER) {
    const def: EquipmentDef = EQUIPMENT[id];
    if (def.scope !== scope) continue;
    const level = toCount(raw[id], def.maxLevel);
    if (level > 0) levels[id] = level;
  }
  return levels;
}

function normalizeTask(raw: unknown): Task | null {
  if (!isObject(raw) || !isTaskKind(raw.kind)) return null;
  const total = toNumber(raw.total);
  if (total <= 0) return null;
  const left = toNumber(raw.left, 0, total);
  if (left <= 0) return null;
  const task: Task = { kind: raw.kind, left, total };
  if (raw.cheered === true) task.cheered = true;
  if (raw.rush === true) task.rush = true;
  else if (isProjectId(raw.project)) task.project = raw.project;
  if (!task.rush && isSpecialKind(raw.special)) {
    task.special = raw.special;
    if (raw.fixed === true) task.fixed = true;
    if (task.special === 'bug' && task.fixed && raw.caught === true) task.caught = true;
    const stuck = toNumber(raw.stuck, 0, SPECIAL.bug.wait);
    if (task.special === 'bug' && !task.fixed && stuck > 0) task.stuck = stuck;
  }
  return task;
}

function normalizeTasks(raw: unknown): Task[] {
  return (Array.isArray(raw) ? raw : []).map(normalizeTask).filter((task): task is Task => task !== null);
}

/**
 * 저장된 값을 지금 구조에 맞춰 읽는다. 모르는 id와 이상한 값은 버리고, 맞지 않으면 null을 돌려준다.
 * 표에서 빠진 내용이 세이브에 남아 있어도 나머지는 그대로 이어서 할 수 있게 한다.
 */
export function normalizeCompany(raw: unknown): CompanyState | null {
  if (!isObject(raw) || !isStaffId(raw.boss)) return null;
  const state = createCompany(raw.boss, toNumber(raw.savedAt));
  state.leaves = toNumber(raw.leaves);
  state.reputation = toCount(raw.reputation);
  state.office = toCount(raw.office, OFFICES.length - 1);
  state.branches = toCount(raw.branches);
  state.legacy = toCount(raw.legacy);
  state.fruit = toCount(raw.fruit);
  if (isObject(raw.perks)) {
    for (const id of PERK_ORDER) {
      const level = toCount(raw.perks[id], (PERKS[id] as PerkDef).maxLevel);
      if (level > 0) state.perks[id] = level;
    }
  }
  // 자회사를 세운 적이 있으면 가장 큰 사무실까지 가 본 것이다.
  const reached = state.branches > 0 ? OFFICES.length - 1 : state.office;
  state.topOffice = Math.max(reached, toCount(raw.topOffice, OFFICES.length - 1));
  state.decor = normalizeDecor(raw.decor);
  state.gear = normalizeLevels(raw.gear, 'company');
  if (DEPARTMENT.unlockOffice <= state.office && isObject(raw.departments)) {
    for (const id of DEPARTMENT_ORDER) {
      const level = toCount(raw.departments[id], DEPARTMENT.maxLevel);
      if (level > 0) state.departments[id] = level;
    }
  }

  // 책상: 같은 친구가 두 번 나오면 뒤의 것은 빈 자리로 둔다. 사장은 어디든 한 자리에 꼭 있다.
  // 부서는 세워 둔 곳에 자리가 남아 있을 때만 그대로 둔다.
  const seats = OFFICES[state.office].desks;
  const seen = new Set<StaffId>();
  const members: Partial<Record<DepartmentId, number>> = {};
  const desks: Desk[] = [];
  for (const entry of Array.isArray(raw.desks) ? raw.desks.slice(0, seats) : []) {
    const desk = emptyDesk();
    if (isObject(entry)) {
      if (isStaffId(entry.staff) && !seen.has(entry.staff)) {
        desk.staff = entry.staff;
        seen.add(entry.staff);
      }
      if (desk.staff) {
        desk.level = toCount(entry.level, TRAINING.maxLevel);
        desk.gear = normalizeLevels(entry.gear, 'desk');
        desk.task = normalizeTask(entry.task);
        // 응원은 아이디어 카드로 받을 수 있는 만큼까지(집중하는 친구는 그 배까지) 읽는다.
        const longest = cheerSeconds(state) * SPECIAL.idea.cheer * ((STAFF[desk.staff] as StaffDef).skill === 'focus' ? SKILL.focus.seconds : 1);
        desk.cheer = desk.task ? toNumber(entry.cheer, 0, longest) : 0;
        // 기운이 생기기 전의 세이브는 가득 찬 것으로 읽는다.
        desk.energy = typeof entry.energy === 'number' ? toNumber(entry.energy, 0, 1) : 1;
        desk.resting = entry.resting === true && !desk.task && desk.energy < 1 && breakOpen(state);
        if (isDepartmentId(entry.dept)) {
          const count = members[entry.dept] ?? 0;
          if (count < departmentSeats(departmentLevel(state, entry.dept))) {
            desk.dept = entry.dept;
            members[entry.dept] = count + 1;
          }
        }
      }
    }
    desks.push(desk);
  }
  while (desks.length < seats) desks.push(emptyDesk());
  if (!seen.has(state.boss)) {
    const free = desks.find((desk) => desk.staff === null) ?? desks[0];
    Object.assign(free, emptyDesk(state.boss));
  }
  state.desks = desks;

  for (const id of PROJECT_ORDER) {
    const version = isObject(raw.released) ? toCount(raw.released[id]) : 0;
    if (version > 0) state.released[id] = version;
  }
  for (const id of PROJECT_ORDER) {
    const stars = isObject(raw.stars) ? toCount(raw.stars[id], PLAY_STARS.count) : 0;
    if (stars > 0) state.stars[id] = stars;
    const flowers = isObject(raw.flowers) ? toCount(raw.flowers[id], MAX_FLOWERS) : 0;
    if (flowers > 0 && versionOf(state, id) > 0) state.flowers[id] = flowers;
  }
  state.hits = toCount(raw.hits);
  const total = PROJECT_ORDER.reduce((sum, id) => sum + versionOf(state, id), 0);
  state.releases = Math.max(total, toCount(raw.releases));

  let inbox = normalizeTasks(raw.inbox);
  const backlog = normalizeTasks(raw.backlog).filter((task) => !task.rush);

  // 급한 의뢰: 하던 것은 남은 카드가 있을 때만 잇는다. 아니면 그 카드들을 치운다.
  const rushOpen = RUSH.unlockOffice <= state.office;
  const rushCards = inbox.filter((task) => task.rush).length + desks.filter((desk) => desk.task?.rush).length;
  if (rushOpen && isObject(raw.rush) && rushCards > 0 && toNumber(raw.rush.left) > 0) {
    const total = Math.max(rushCards, toCount(raw.rush.total, RUSH.cards[1]));
    state.rush = {
      total,
      done: total - rushCards,
      left: toNumber(raw.rush.left, 0, RUSH.seconds),
      seconds: RUSH.seconds,
      reward: toCount(raw.rush.reward),
    };
  } else {
    inbox = inbox.filter((task) => !task.rush);
    for (const desk of desks) {
      if (desk.task?.rush) {
        desk.task = null;
        desk.cheer = 0;
      }
    }
  }
  if (rushOpen && !state.rush && isObject(raw.offer) && Array.isArray(raw.offer.kinds)) {
    const kinds = raw.offer.kinds.filter(isTaskKind).slice(0, RUSH.cards[1]);
    const work = toNumber(raw.offer.work);
    const left = toNumber(raw.offer.left, 0, RUSH.offerSeconds);
    if (kinds.length > 0 && work > 0 && left > 0) {
      state.offer = { kinds, work, reward: toCount(raw.offer.reward), left };
    }
  }
  if (typeof raw.rushIn === 'number') state.rushIn = toNumber(raw.rushIn, 0, RUSH.every[1]);

  // 하던 프로젝트: 남은 카드를 다시 세어서 맞춘다. 표에서 사라진 프로젝트면 일을 거두고 고르기부터 다시 한다.
  // 두 번째 칸의 게임은 그 칸이 열린 사무실에서만 잇는다. 칸이 적히지 않은 카드는 먼저 시작한 게임의 것이다.
  const urgent = inbox.filter((task) => task.rush);
  const plain = inbox.filter((task) => !task.rush);
  const first = isObject(raw.project) && isProjectId(raw.project.id) ? raw.project : null;
  const second =
    first && twinOpen(state) && isObject(raw.second) && isProjectId(raw.second.id) && raw.second.id !== first.id
      ? raw.second
      : null;
  const deskTasks = desks.map((desk) => desk.task).filter((task): task is Task => task !== null && !task.rush);
  const tagOf = (task: Task): unknown => task.project ?? first?.id;
  const kept = new Set<Task>();
  const running = [first, second]
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .map((entry): ActiveProject => {
      const id = entry.id as ProjectId;
      const working = deskTasks.filter((task) => tagOf(task) === id).length;
      const cards = PROJECTS[id].cards.length;
      const waiting = [...plain, ...backlog].filter((task) => tagOf(task) === id);
      const left = Math.min(cards, waiting.length + working);
      for (const task of waiting.slice(0, Math.max(0, left - working))) kept.add(task);
      const done = cards - left;
      // 정성은 끝낸 카드가 받을 수 있는 만큼까지만 읽는다. 평가가 생기기 전의 세이브는 카드마다 맞는 친구가 한 것으로 친다.
      const most = done * (RATING.full + RATING.catch);
      const care = typeof entry.care === 'number' ? toNumber(entry.care, 0, most) : done * RATING.fit;
      return { id, total: cards, done, care };
    });
  state.project = running[0] ?? null;
  state.second = running[1] ?? null;
  for (const desk of desks) {
    const task = desk.task;
    if (task && !task.rush && !running.some((project) => project.id === tagOf(task))) {
      desk.task = null;
      desk.cheer = 0;
    }
  }
  state.inbox = [...urgent, ...plain.filter((task) => kept.has(task))];
  state.backlog = backlog.filter((task) => kept.has(task));
  refill(state);
  // 예약은 만드는 게임이 있을 때만 남는다.
  if (state.project && QUEUE.unlockOffice <= state.office && Array.isArray(raw.queue)) {
    state.queue = raw.queue
      .filter(isProjectId)
      .filter((id) => isUnlocked(state, id) && departmentsMissing(state, id) === 0)
      .slice(0, QUEUE.slots);
  }

  state.lead = LEAD.unlockOffice <= state.office ? toCount(raw.lead, LEAD.levels.length) : 0;
  state.leadWait = toNumber(raw.leadWait, 0, leadLevel(state)?.delay ?? 0);

  if (Array.isArray(raw.candidates)) {
    const pool = hirePool(state);
    const candidates = raw.candidates.filter(isStaffId).filter((id) => pool.includes(id));
    state.candidates = candidates.length > 0 ? [...new Set(candidates)].slice(0, CANDIDATE_COUNT) : null;
  }

  state.goals = normalizeGoals(raw.goals);
  // 안내가 생기기 전부터 하던 회사에는, 그때도 있던 일에 대한 안내를 띄우지 않는다.
  if (Array.isArray(raw.tips)) {
    state.tips = [...new Set(raw.tips.filter((id): id is string => typeof id === 'string' && id in TIPS))];
  } else if (state.releases > 0) {
    state.tips = [...OLD_HAND_TIPS];
  }
  // 길잡이가 생기기 전부터 하던 회사에는 길잡이를 띄우지 않는다. 아직 아무것도 내지 않았으면 처음부터 본다.
  if (typeof raw.guide === 'number') state.guide = toCount(raw.guide, GUIDE_STEPS.length);
  else state.guide = state.releases > 0 || state.office > 0 ? GUIDE_STEPS.length : 0;
  return state;
}
