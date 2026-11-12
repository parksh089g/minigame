/**
 * 새싹 컴퍼니의 규칙. 화면 없이 숫자만 다룬다.
 * 판이 끝나지 않고 이어지는 게임이라, 상태 하나(CompanyState)를 계속 고쳐 나간다.
 * 매 프레임 불리는 advance가 있어서 여기 함수들은 상태를 그 자리에서 고친다.
 */
import {
  AWAY,
  BRANCH,
  CANDIDATE_COUNT,
  CHEER_BOOST,
  CHEER_SECONDS,
  DEPARTMENT,
  DEPARTMENT_ORDER,
  DEPARTMENTS,
  EQUIPMENT,
  EQUIPMENT_ORDER,
  FIRST_HIRES,
  HIRE_COST,
  INBOX_SLOTS,
  LEAD,
  LEVEL_SPEED,
  OFFICE_COINS,
  OFFICES,
  OLD_HAND_TIPS,
  PERK_ORDER,
  PERKS,
  PLAY_STARS,
  PROJECT_ORDER,
  PROJECTS,
  QUEUE,
  RUSH,
  SPECIALTY_BOOST,
  STAFF,
  STAFF_ORDER,
  TASK_KINDS,
  TIPS,
  TRAINING,
  UPDATE_SCALE,
  type DepartmentId,
  type EffectKey,
  type EquipmentDef,
  type EquipmentId,
  type LeadLevel,
  type PerkDef,
  type PerkId,
  type ProjectDef,
  type ProjectId,
  type StaffDef,
  type StaffId,
  type TaskKind,
} from './data';
import { bumpGoals, createGoals, normalizeGoals, type GoalsState } from './goals';

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
}

export interface ActiveProject {
  id: ProjectId;
  /** 끝낸 카드의 수 */
  done: number;
  total: number;
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
  project: ActiveProject | null;
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
  /** 이미 본 처음 안내의 id */
  tips: string[];
  /** 마지막으로 저장한 때(ms). 닫아 둔 시간을 재는 데 쓴다. */
  savedAt: number;
}

// ───────── 처음 상태 ─────────

function emptyDesk(staff: StaffId | null = null): Desk {
  return { staff, level: 0, gear: {}, task: null, cheer: 0, dept: null };
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
    inbox: [],
    backlog: [],
    offer: null,
    rush: null,
    rushIn: RUSH.every[0],
    released: {},
    releases: 0,
    stars: {},
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
 * 회사 장비와, 직원의 성격 가운데 수익과 출시 보너스가 여기 든다. 속도를 올리는 성격은 그 직원 것이라 빠진다.
 */
export function companyBonus(state: CompanyState, key: EffectKey): number {
  let sum = gearBonus(state.gear, 'company', key);
  if (key !== 'workSpeed') {
    for (const desk of state.desks) {
      if (!desk.staff) continue;
      const trait = (STAFF[desk.staff] as StaffDef).trait;
      if (trait.key === key) sum += trait.amount;
    }
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

/** 사장은 특기 없이 모든 업무를 고르게 한다. */
export function specialtyOf(state: CompanyState, staff: StaffId): TaskKind | null {
  return staff === state.boss ? null : STAFF[staff].specialty;
}

/** 이 책상의 직원이 특기가 아닌 업무를 할 때의 속도(응원은 뺀 것). 빈 자리는 0 */
export function baseSpeed(state: CompanyState, index: number): number {
  const desk = state.desks[index];
  if (!desk?.staff) return 0;
  const trait = (STAFF[desk.staff] as StaffDef).trait;
  const own =
    1 +
    gearBonus(desk.gear, 'desk', 'workSpeed') +
    gearBonus(state.gear, 'company', 'workSpeed') +
    (trait.key === 'workSpeed' ? trait.amount : 0) +
    desk.level * LEVEL_SPEED;
  return own * (1 + legacyBonus(state, 'workSpeed'));
}

/**
 * 이 책상의 직원이 이 업무를 얼마나 잘하는지의 배수. 특기면 두 배이고, 그 업무를 맡는 부서에 들었으면
 * 부서의 단계만큼 더 붙는다. 둘은 곱으로 겹친다. 빈 자리는 0
 */
export function skill(state: CompanyState, index: number, kind: TaskKind): number {
  const desk = state.desks[index];
  if (!desk?.staff) return 0;
  const special = specialtyOf(state, desk.staff) === kind ? SPECIALTY_BOOST : 1;
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

/** 일감함에 자리가 있으면 쌓아 둔 카드를 차례로 꺼낸다. */
function refill(state: CompanyState): void {
  while (state.inbox.length < INBOX_SLOTS && state.backlog.length > 0) {
    state.inbox.push(state.backlog.shift() as Task);
  }
}

/**
 * 프로젝트를 시작한다. 카드가 일감함에 놓이고, 다 놓지 못한 것은 쌓아 둔다.
 * 하던 프로젝트가 있으면 시작하지 못한다.
 */
export function startProject(state: CompanyState, id: ProjectId): boolean {
  if (state.project || !isUnlocked(state, id) || departmentsMissing(state, id) > 0) return false;
  const def: ProjectDef = PROJECTS[id];
  const work = projectWork(state, id);
  state.backlog = def.cards.map((kind) => ({ kind, left: work, total: work }));
  state.project = { id, done: 0, total: def.cards.length };
  refill(state);
  return true;
}

/** 아직 맡기지 않은 프로젝트의 카드 수: 일감함에 있는 것과 쌓아 둔 것 */
export function cardsWaiting(state: CompanyState): number {
  return state.inbox.length + state.backlog.length;
}

/** 프로젝트의 카드를 모두 끝내서 출시만 남았는가 */
export function isReady(state: CompanyState): boolean {
  return state.project !== null && state.project.done >= state.project.total;
}

export interface Release {
  id: ProjectId;
  /** 이번 출시로 된 횟수. 1이면 첫 출시, 2부터는 업데이트 */
  version: number;
  bonus: number;
  reputation: number;
}

/** 다 만든 프로젝트를 출시한다. 아직 덜 됐으면 null. 예약해 둔 게임이 있으면 맨 앞의 것을 바로 시작한다. */
export function release(state: CompanyState): Release | null {
  if (!state.project || !isReady(state)) return null;
  const id = state.project.id;
  const bonus = projectBonus(state, id);
  const reputation = projectReputation(state, id);
  const version = versionOf(state, id) + 1;
  state.leaves += bonus;
  state.reputation += reputation;
  state.released[id] = version;
  state.releases += 1;
  bumpGoals(state.goals, 'release');
  state.project = null;
  // 급한 의뢰의 카드는 프로젝트와 상관없이 남는다.
  state.inbox = state.inbox.filter((task) => task.rush);
  state.backlog = [];
  startQueued(state);
  return { id, version, bonus, reputation };
}

// ───────── 예약 줄 ─────────

/** 예약할 수 없는 까닭. idle은 만드는 게임이 없어서 예약할 것 없이 바로 시작하면 되는 때다. */
export type QueueBlock = 'locked' | 'idle' | 'full' | 'office' | 'department';

export function queueBlock(state: CompanyState, id: ProjectId): QueueBlock | null {
  if (QUEUE.unlockOffice > state.office) return 'locked';
  if (!isUnlocked(state, id)) return 'office';
  if (departmentsMissing(state, id) > 0) return 'department';
  if (!state.project) return 'idle';
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

/** 만드는 게임이 없으면 예약 줄의 맨 앞부터 시작한다. 시작할 수 없게 된 것은 건너뛴다. */
function startQueued(state: CompanyState): void {
  while (!state.project && state.queue.length > 0) {
    startProject(state, state.queue.shift() as ProjectId);
  }
}

/** 예약이 있고 지금 게임을 다 만들었으면 저절로 출시한다. 출시했으면 그 결과를 돌려준다. */
function releaseQueued(state: CompanyState): Release | null {
  return state.queue.length > 0 && isReady(state) ? release(state) : null;
}

// ───────── 일 시키기 ─────────

/** 일감함의 카드를 책상에 맡긴다. 빈 자리이거나 이미 일하는 중이면 맡기지 못한다. */
export function assign(state: CompanyState, card: number, index: number): boolean {
  const desk = state.desks[index];
  const task = state.inbox[card];
  if (!desk?.staff || desk.task || !task) return false;
  state.inbox.splice(card, 1);
  desk.task = task;
  refill(state);
  return true;
}

/** 이 책상에 맡기기 좋은 카드의 번호: 가장 잘하는 업무의 카드, 다 같으면 맨 앞. 일감함이 비었으면 -1 */
export function bestCardFor(state: CompanyState, index: number): number {
  if (!state.desks[index]?.staff || state.inbox.length === 0) return -1;
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

/** 일하는 책상을 응원한다. 잠깐 빨라진다. */
export function cheer(state: CompanyState, index: number): boolean {
  const desk = state.desks[index];
  if (!desk?.task) return false;
  desk.cheer = CHEER_SECONDS;
  bumpGoals(state.goals, 'cheer');
  return true;
}

/** 시간이 흐르는 동안 일어난 일 */
export type CompanyEvent =
  | { type: 'task'; desk: number; kind: TaskKind; rush: boolean }
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
  const released = releaseQueued(state);
  if (released) events.push({ type: 'release', release: released });
  tickRush(state, dt, random, events);
  return events;
}

/** 책상의 일만 dt초 진행한다. 잎사귀는 벌지 않는다. */
function work(state: CompanyState, dt: number, random: () => number): CompanyEvent[] {
  const done: CompanyEvent[] = [];
  for (let index = 0; index < state.desks.length; index += 1) {
    const desk = state.desks[index];
    const task = desk.task;
    if (!task) {
      desk.cheer = 0;
      continue;
    }
    const speed = deskSpeed(state, index, task.kind);
    // 응원이 남은 동안만 빠르다. 한 번에 긴 시간을 흘려도 응원이 끝난 뒤는 보통 속도로 센다.
    const cheered = Math.min(desk.cheer, dt);
    task.left -= speed * (cheered * CHEER_BOOST + (dt - cheered));
    desk.cheer = Math.max(0, desk.cheer - dt);
    if (task.left <= 0) {
      desk.task = null;
      desk.cheer = 0;
      done.push({ type: 'task', desk: index, kind: task.kind, rush: task.rush === true });
      bumpGoals(state.goals, 'task');
      if (task.rush) {
        const rush = state.rush;
        if (rush && (rush.done += 1) >= rush.total) {
          state.leaves += rush.reward;
          done.push({ type: 'rushWon', reward: rush.reward });
          bumpGoals(state.goals, 'rush');
          state.rush = null;
          state.rushIn = nextRushIn(random);
        }
      } else if (state.project) {
        state.project.done = Math.min(state.project.total, state.project.done + 1);
      }
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
  for (let index = 0; index < state.desks.length; index += 1) speed += baseSpeed(state, index);
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
    if (desk.staff && !desk.task) idle.push(index);
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
  const leaves = incomePerSecond(state) * counted * AWAY.rate;
  state.leaves += leaves;
  let tasks = 0;
  const releases: Release[] = [];
  const releaseDone = (): void => {
    const released = releaseQueued(state);
    if (released) releases.push(released);
  };
  for (let time = 0; time < counted; time += 1) {
    releaseDone();
    const working = state.desks.some((desk) => desk.task !== null);
    if (!working && (state.lead === 0 || state.inbox.length === 0)) break;
    tasks += work(state, 1, fixed).length;
  }
  releaseDone();
  return { seconds: counted, leaves, tasks, capped: seconds > AWAY.maxSeconds, releases };
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

/** 그 단계의 부서가 부서원에게 주는 속도. 0.6이면 그 부서의 업무를 60% 더 빨리 한다. */
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

/** 빈 자리를, 아직 부서가 없고 특기가 이 부서의 업무인 친구로 채운다. */
function fillDepartment(state: CompanyState, id: DepartmentId): void {
  let free = departmentSeats(departmentLevel(state, id)) - departmentMembers(state, id).length;
  for (const desk of state.desks) {
    if (free <= 0) return;
    if (!desk.staff || desk.dept !== null || specialtyOf(state, desk.staff) !== DEPARTMENTS[id].kind) continue;
    desk.dept = id;
    free -= 1;
  }
}

/** 부서를 세우거나 한 단계 올린다. 새로 난 자리에는 특기가 맞는 친구가 알아서 든다. */
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
  if (raw.rush === true) task.rush = true;
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
        desk.cheer = desk.task ? toNumber(entry.cheer, 0, CHEER_SECONDS) : 0;
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
  }
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
  const urgent = inbox.filter((task) => task.rush);
  const plain = inbox.filter((task) => !task.rush);
  if (isObject(raw.project) && isProjectId(raw.project.id)) {
    const working = desks.filter((desk) => desk.task !== null && !desk.task.rush).length;
    const cards = PROJECTS[raw.project.id].cards.length;
    const waiting = [...plain, ...backlog];
    const left = Math.min(cards, waiting.length + working);
    const kept = waiting.slice(0, Math.max(0, left - working));
    state.project = { id: raw.project.id, total: cards, done: cards - left };
    state.inbox = [...urgent, ...kept.slice(0, plain.length)];
    state.backlog = kept.slice(plain.length);
    refill(state);
  } else {
    for (const desk of desks) {
      if (desk.task && !desk.task.rush) {
        desk.task = null;
        desk.cheer = 0;
      }
    }
    state.inbox = urgent;
  }
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
  return state;
}
