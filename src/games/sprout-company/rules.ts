/**
 * 새싹 컴퍼니의 규칙. 화면 없이 숫자만 다룬다.
 * 판이 끝나지 않고 이어지는 게임이라, 상태 하나(CompanyState)를 계속 고쳐 나간다.
 * 매 프레임 불리는 advance가 있어서 여기 함수들은 상태를 그 자리에서 고친다.
 */
import {
  CANDIDATE_COUNT,
  CHEER_BOOST,
  CHEER_SECONDS,
  EQUIPMENT,
  EQUIPMENT_ORDER,
  FIRST_HIRES,
  HIRE_COST,
  INBOX_SLOTS,
  LEVEL_SPEED,
  OFFICES,
  PROJECT_ORDER,
  PROJECTS,
  SPECIALTY_BOOST,
  STAFF,
  STAFF_ORDER,
  TASK_KINDS,
  UPDATE_SCALE,
  type EffectKey,
  type EquipmentDef,
  type EquipmentId,
  type ProjectDef,
  type ProjectId,
  type StaffDef,
  type StaffId,
  type TaskKind,
} from './data';

export const COMPANY_VERSION = 1;

/** 업무 카드 한 장. 일감함에 있거나 책상 위에 있다. */
export interface Task {
  kind: TaskKind;
  /** 남은 일 */
  left: number;
  /** 처음의 일. 진행 막대를 그릴 때 쓴다. */
  total: number;
}

/** 강화 id → 레벨. 없는 id는 0레벨이다. */
export type Levels = Partial<Record<EquipmentId, number>>;

export interface Desk {
  /** 앉은 직원. 빈 자리는 null */
  staff: StaffId | null;
  /** 교육으로 올린 레벨. 지금은 늘 0이다. */
  level: number;
  /** 이 자리의 장비 */
  gear: Levels;
  task: Task | null;
  /** 응원이 남은 시간(초) */
  cheer: number;
}

export interface ActiveProject {
  id: ProjectId;
  /** 끝낸 카드의 수 */
  done: number;
  total: number;
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
  inbox: Task[];
  /** 프로젝트 id → 낸 횟수 (첫 출시와 업데이트를 합친 것) */
  released: Partial<Record<ProjectId, number>>;
  /** 모든 출시와 업데이트의 수 */
  releases: number;
  /** 지금 와 있는 지원자. 채용 화면을 처음 열 때 정하고, 뽑을 때까지 바뀌지 않는다. */
  candidates: StaffId[] | null;
  savedAt: number;
}

// ───────── 처음 상태 ─────────

function emptyDesk(staff: StaffId | null = null): Desk {
  return { staff, level: 0, gear: {}, task: null, cheer: 0 };
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
    released: {},
    releases: 0,
    candidates: null,
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

/** 사장은 특기 없이 모든 업무를 고르게 한다. */
export function specialtyOf(state: CompanyState, staff: StaffId): TaskKind | null {
  return staff === state.boss ? null : STAFF[staff].specialty;
}

/** 이 책상의 직원이 이 업무를 할 때의 속도(응원은 뺀 것). 빈 자리는 0 */
export function deskSpeed(state: CompanyState, index: number, kind: TaskKind): number {
  const desk = state.desks[index];
  if (!desk?.staff) return 0;
  const trait = (STAFF[desk.staff] as StaffDef).trait;
  const bonus =
    gearBonus(desk.gear, 'desk', 'workSpeed') +
    gearBonus(state.gear, 'company', 'workSpeed') +
    (trait.key === 'workSpeed' ? trait.amount : 0) +
    desk.level * LEVEL_SPEED;
  const boost = specialtyOf(state, desk.staff) === kind ? SPECIALTY_BOOST : 1;
  return boost * (1 + bonus);
}

// ───────── 프로젝트 ─────────

/** 지금까지 낸 횟수. 0이면 아직 출시하지 않은 게임이다. */
export function versionOf(state: CompanyState, id: ProjectId): number {
  return state.released[id] ?? 0;
}

/** 이 프로젝트를 지금 시작하면 카드 한 장에 드는 일 */
export function projectWork(state: CompanyState, id: ProjectId): number {
  const def: ProjectDef = PROJECTS[id];
  return def.work * UPDATE_SCALE.work ** versionOf(state, id);
}

/** 이 프로젝트를 지금 내면 받는 잎사귀 */
export function projectBonus(state: CompanyState, id: ProjectId): number {
  const def: ProjectDef = PROJECTS[id];
  const base = def.bonus * UPDATE_SCALE.bonus ** versionOf(state, id);
  return Math.round(base * (1 + companyBonus(state, 'bonus')));
}

/** 이 프로젝트를 지금 내면 오르는 평판 */
export function projectReputation(state: CompanyState, id: ProjectId): number {
  const def: ProjectDef = PROJECTS[id];
  return versionOf(state, id) === 0 ? def.reputation : Math.ceil(def.reputation * UPDATE_SCALE.reputation);
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

/** 출시작이 모두 합쳐 초마다 버는 잎사귀 */
export function incomePerSecond(state: CompanyState): number {
  let sum = 0;
  for (const id of PROJECT_ORDER) sum += baseIncome(id, versionOf(state, id));
  return sum * (1 + companyBonus(state, 'income'));
}

export function isUnlocked(state: CompanyState, id: ProjectId): boolean {
  return PROJECTS[id].unlockOffice <= state.office;
}

/** 지금 사무실에서 만들 수 있는 프로젝트 */
export function availableProjects(state: CompanyState): ProjectId[] {
  return PROJECT_ORDER.filter((id) => isUnlocked(state, id));
}

/** 프로젝트를 시작한다. 카드가 일감함에 놓인다. 하던 프로젝트가 있으면 시작하지 못한다. */
export function startProject(state: CompanyState, id: ProjectId): boolean {
  if (state.project || !isUnlocked(state, id)) return false;
  const def: ProjectDef = PROJECTS[id];
  const work = projectWork(state, id);
  const cards = def.cards.slice(0, INBOX_SLOTS);
  state.inbox = cards.map((kind) => ({ kind, left: work, total: work }));
  state.project = { id, done: 0, total: cards.length };
  return true;
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

/** 다 만든 프로젝트를 출시한다. 아직 덜 됐으면 null */
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
  state.project = null;
  state.inbox = [];
  return { id, version, bonus, reputation };
}

// ───────── 일 시키기 ─────────

/** 일감함의 카드를 책상에 맡긴다. 빈 자리이거나 이미 일하는 중이면 맡기지 못한다. */
export function assign(state: CompanyState, card: number, index: number): boolean {
  const desk = state.desks[index];
  const task = state.inbox[card];
  if (!desk?.staff || desk.task || !task) return false;
  state.inbox.splice(card, 1);
  desk.task = task;
  return true;
}

/** 이 책상에 맡기기 좋은 카드의 번호: 특기에 맞는 것이 있으면 그것, 없으면 맨 앞. 일감함이 비었으면 -1 */
export function bestCardFor(state: CompanyState, index: number): number {
  const staff = state.desks[index]?.staff;
  if (!staff || state.inbox.length === 0) return -1;
  const specialty = specialtyOf(state, staff);
  const match = state.inbox.findIndex((task) => task.kind === specialty);
  return match >= 0 ? match : 0;
}

/** 일하는 책상을 응원한다. 잠깐 빨라진다. */
export function cheer(state: CompanyState, index: number): boolean {
  const desk = state.desks[index];
  if (!desk?.task) return false;
  desk.cheer = CHEER_SECONDS;
  return true;
}

export interface TaskDone {
  desk: number;
  kind: TaskKind;
}

const NOTHING: readonly TaskDone[] = [];

/**
 * 시간을 dt초 흘린다. 출시작이 잎사귀를 벌고, 책상마다 일이 줄어든다.
 * 이번에 끝난 업무를 돌려준다. 끝난 자리는 비고, 다음 카드를 맡길 때까지 쉰다.
 */
export function advance(state: CompanyState, dt: number): readonly TaskDone[] {
  if (!(dt > 0)) return NOTHING;
  state.leaves += incomePerSecond(state) * dt;
  let done: TaskDone[] | null = null;
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
      if (state.project) state.project.done = Math.min(state.project.total, state.project.done + 1);
      (done ??= []).push({ desk: index, kind: task.kind });
    }
  }
  return done ?? NOTHING;
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
  return index;
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

/** 다음 사무실로 이사한다. 책상 자리가 늘어난다. */
export function moveOffice(state: CompanyState): boolean {
  if (moveBlock(state) !== null) return false;
  const next = OFFICES[state.office + 1];
  state.leaves -= next.cost;
  state.office += 1;
  while (state.desks.length < next.desks) state.desks.push(emptyDesk());
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
  return left > 0 ? { kind: raw.kind, left, total } : null;
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
  state.gear = normalizeLevels(raw.gear, 'company');

  // 책상: 같은 친구가 두 번 나오면 뒤의 것은 빈 자리로 둔다. 사장은 어디든 한 자리에 꼭 있다.
  const seats = OFFICES[state.office].desks;
  const seen = new Set<StaffId>();
  const desks: Desk[] = [];
  for (const entry of Array.isArray(raw.desks) ? raw.desks.slice(0, seats) : []) {
    const desk = emptyDesk();
    if (isObject(entry)) {
      if (isStaffId(entry.staff) && !seen.has(entry.staff)) {
        desk.staff = entry.staff;
        seen.add(entry.staff);
      }
      if (desk.staff) {
        desk.level = toCount(entry.level);
        desk.gear = normalizeLevels(entry.gear, 'desk');
        desk.task = normalizeTask(entry.task);
        desk.cheer = desk.task ? toNumber(entry.cheer, 0, CHEER_SECONDS) : 0;
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
  const total = PROJECT_ORDER.reduce((sum, id) => sum + versionOf(state, id), 0);
  state.releases = Math.max(total, toCount(raw.releases));

  // 하던 프로젝트: 남은 카드를 다시 세어서 맞춘다. 표에서 사라진 프로젝트면 일을 거두고 고르기부터 다시 한다.
  const inbox = (Array.isArray(raw.inbox) ? raw.inbox : [])
    .map(normalizeTask)
    .filter((task): task is Task => task !== null)
    .slice(0, INBOX_SLOTS);
  if (isObject(raw.project) && isProjectId(raw.project.id)) {
    const working = desks.filter((desk) => desk.task !== null).length;
    const cards = Math.min(PROJECTS[raw.project.id].cards.length, INBOX_SLOTS);
    const left = Math.min(cards, inbox.length + working);
    state.project = { id: raw.project.id, total: cards, done: cards - left };
    state.inbox = inbox.slice(0, Math.max(0, left - working));
  } else {
    for (const desk of desks) {
      desk.task = null;
      desk.cheer = 0;
    }
  }

  if (Array.isArray(raw.candidates)) {
    const pool = hirePool(state);
    const candidates = raw.candidates.filter(isStaffId).filter((id) => pool.includes(id));
    state.candidates = candidates.length > 0 ? [...new Set(candidates)].slice(0, CANDIDATE_COUNT) : null;
  }
  return state;
}
