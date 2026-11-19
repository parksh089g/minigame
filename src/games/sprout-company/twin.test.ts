import { describe, expect, it } from 'vitest';
import { INBOX_SLOTS, OFFICES, PROJECTS, TWIN, type ProjectId } from './data';
import {
  acceptRush,
  activeProjects,
  advance,
  assign,
  cardSlot,
  createCompany,
  hasFreeSlot,
  hire,
  hireCost,
  hirePool,
  isReady,
  moveOffice,
  normalizeCompany,
  ownerOf,
  readySlot,
  release,
  staffCount,
  startProject,
  twinOpen,
  type CompanyState,
  type Task,
} from './rules';

/** 그 사무실까지 이사하고 자리를 모두 채운 회사 */
function company(office: number): CompanyState {
  const state = createCompany('sprout');
  while (state.office < office) {
    state.reputation = OFFICES[state.office + 1].reputation;
    state.leaves = OFFICES[state.office + 1].cost;
    moveOffice(state);
  }
  for (const id of hirePool(state)) {
    if (staffCount(state) >= state.desks.length) break;
    state.candidates = [id];
    state.leaves = hireCost(state);
    hire(state, id);
  }
  state.leaves = 0;
  return state;
}

/** 일감함과 쌓아 둔 줄에서 그 게임의 카드 수 */
const waitingOf = (state: CompanyState, id: ProjectId): number =>
  [...state.inbox, ...state.backlog].filter((task) => ownerOf(state, task)?.id === id).length;

/** 그 게임의 카드를 모두 끝낸 것으로 하고 그 카드를 치운다. */
function finish(state: CompanyState, slot: number): void {
  const project = slot === 0 ? state.project : state.second;
  if (!project) throw new Error('빈 칸');
  const mine = (task: Task | null): boolean => task !== null && ownerOf(state, task) === project;
  state.inbox = state.inbox.filter((task) => !mine(task));
  state.backlog = state.backlog.filter((task) => !mine(task));
  for (const desk of state.desks) if (mine(desk.task)) desk.task = null;
  project.done = project.total;
}

describe('두 게임 함께 만들기', () => {
  it(`${OFFICES[TWIN.unlockOffice].name}부터 두 번째 칸이 열린다`, () => {
    const early = company(TWIN.unlockOffice - 1);
    expect(twinOpen(early)).toBe(false);
    expect(startProject(early, 'lightning-tap')).toBe(true);
    expect(hasFreeSlot(early)).toBe(false);
    expect(startProject(early, 'stack-tower')).toBe(false);
    expect(early.second).toBeNull();

    const state = company(TWIN.unlockOffice);
    expect(twinOpen(state)).toBe(true);
    expect(startProject(state, 'lightning-tap')).toBe(true);
    expect(hasFreeSlot(state)).toBe(true);
    // 같은 게임을 두 칸에서 만들 수는 없다.
    expect(startProject(state, 'lightning-tap')).toBe(false);
    expect(startProject(state, 'stack-tower')).toBe(true);
    expect(state.project?.id).toBe('lightning-tap');
    expect(state.second?.id).toBe('stack-tower');
    // 칸이 둘뿐이다.
    expect(hasFreeSlot(state)).toBe(false);
    expect(startProject(state, 'memory-cards')).toBe(false);
  });

  it('먼저 시작한 큰 게임이 일감함을 채우고 있어도 새 게임의 카드가 함께 나온다', () => {
    const state = company(TWIN.unlockOffice);
    startProject(state, 'screw-sort');
    expect(PROJECTS['screw-sort'].cards.length).toBeGreaterThan(INBOX_SLOTS);
    expect(state.inbox.every((task) => task.project === 'screw-sort')).toBe(true);
    startProject(state, 'merge-tiles');
    const shown = (id: ProjectId): number => state.inbox.filter((task) => task.project === id).length;
    expect(state.inbox).toHaveLength(INBOX_SLOTS);
    expect(shown('screw-sort')).toBe(INBOX_SLOTS / 2);
    expect(shown('merge-tiles')).toBe(INBOX_SLOTS / 2);
    // 돌려 둔 카드도 사라지지 않는다.
    expect(waitingOf(state, 'screw-sort')).toBe(PROJECTS['screw-sort'].cards.length);
    expect(waitingOf(state, 'merge-tiles')).toBe(PROJECTS['merge-tiles'].cards.length);

    // 맡기는 대로 덜 나와 있는 게임의 카드가 채워진다.
    for (let index = 0; index < 3; index += 1) {
      const card = state.inbox.findIndex((task) => task.project === 'merge-tiles');
      assign(state, card, index);
    }
    expect(shown('merge-tiles')).toBe(INBOX_SLOTS / 2);
    expect(shown('screw-sort')).toBe(INBOX_SLOTS / 2);
  });

  it('끝낸 카드는 그 카드의 게임에만 센다', () => {
    const state = company(TWIN.unlockOffice);
    startProject(state, 'lightning-tap');
    startProject(state, 'stack-tower');
    const card = state.inbox.findIndex((task) => task.project === 'stack-tower');
    expect(cardSlot(state, state.inbox[card])).toBe(1);
    assign(state, card, 0);
    const events = advance(state, 1_000, () => 0.5);
    expect(events.filter((event) => event.type === 'task')).toHaveLength(1);
    expect(state.project?.done).toBe(0);
    expect(state.second?.done).toBe(1);
    expect(state.second?.care).toBeGreaterThan(0);
  });

  it('두 번째 칸의 게임을 내면 먼저 시작한 게임은 그대로 이어진다', () => {
    const state = company(TWIN.unlockOffice);
    startProject(state, 'lightning-tap');
    startProject(state, 'stack-tower');
    assign(state, state.inbox.findIndex((task) => task.project === 'lightning-tap'), 0);
    finish(state, 1);
    expect(isReady(state, 0)).toBe(false);
    expect(readySlot(state)).toBe(1);
    expect(release(state)).toBeNull();
    const result = release(state, undefined, 1);
    expect(result?.id).toBe('stack-tower');
    expect(state.released['stack-tower']).toBe(1);
    expect(state.project?.id).toBe('lightning-tap');
    expect(state.second).toBeNull();
    expect(waitingOf(state, 'lightning-tap')).toBe(PROJECTS['lightning-tap'].cards.length - 1);
    expect(state.desks[0].task?.project).toBe('lightning-tap');
  });

  it('먼저 시작한 게임을 내면 두 번째 칸의 게임이 앞으로 오고, 하던 카드도 따라온다', () => {
    const state = company(TWIN.unlockOffice);
    startProject(state, 'lightning-tap');
    startProject(state, 'stack-tower');
    assign(state, state.inbox.findIndex((task) => task.project === 'stack-tower'), 0);
    finish(state, 0);
    expect(release(state)?.id).toBe('lightning-tap');
    expect(state.project?.id).toBe('stack-tower');
    expect(state.second).toBeNull();
    expect(hasFreeSlot(state)).toBe(true);
    expect(waitingOf(state, 'stack-tower')).toBe(PROJECTS['stack-tower'].cards.length - 1);
    // 하던 카드를 끝내면 앞으로 온 게임의 것으로 센다.
    advance(state, 1_000, () => 0.5);
    expect(state.project?.done).toBe(1);
  });

  it('급한 의뢰의 카드는 어느 게임의 것도 아니고, 출시해도 남는다', () => {
    const state = company(TWIN.unlockOffice);
    startProject(state, 'lightning-tap');
    startProject(state, 'stack-tower');
    state.rushIn = 1;
    advance(state, 1.01, () => 0);
    expect(acceptRush(state)).toBe(true);
    const rush = state.inbox.filter((task) => task.rush).length;
    expect(rush).toBeGreaterThan(0);
    expect(cardSlot(state, state.inbox[0])).toBe(-1);
    finish(state, 0);
    release(state);
    expect(state.inbox.filter((task) => task.rush)).toHaveLength(rush);
  });

  it('두 게임을 함께 만들던 회사를 저장했다가 그대로 읽는다', () => {
    const state = company(TWIN.unlockOffice);
    startProject(state, 'screw-sort', () => 0.5);
    startProject(state, 'merge-tiles', () => 0.5);
    assign(state, 0, 0);
    assign(state, 0, 1);
    advance(state, 0.5, () => 0.5);
    const copy = normalizeCompany(JSON.parse(JSON.stringify(state)));
    expect(copy).toEqual(state);
    expect(activeProjects(copy as CompanyState).map((project) => project.id)).toEqual(['screw-sort', 'merge-tiles']);
  });

  it('두 번째 칸이 없던 세이브와, 칸이 열리지 않은 사무실의 두 번째 게임도 맞게 읽는다', () => {
    const state = company(TWIN.unlockOffice);
    startProject(state, 'lightning-tap');
    // 두 번째 칸이 생기기 전의 세이브: 카드에 게임이 적혀 있지 않다.
    const old = JSON.parse(JSON.stringify(state)) as Record<string, unknown> & { inbox: Record<string, unknown>[] };
    delete old.second;
    for (const task of old.inbox) delete task.project;
    const read = normalizeCompany(old) as CompanyState;
    expect(read.project?.id).toBe('lightning-tap');
    expect(read.second).toBeNull();
    expect(read.inbox.every((task) => ownerOf(read, task) === read.project)).toBe(true);

    // 한 번 시작한 뒤에 두 번째 게임을 넣으면, 적히지 않은 카드는 먼저 시작한 게임의 것이다.
    expect(startProject(read, 'stack-tower')).toBe(true);
    expect(waitingOf(read, 'lightning-tap')).toBe(PROJECTS['lightning-tap'].cards.length);
    expect(waitingOf(read, 'stack-tower')).toBe(PROJECTS['stack-tower'].cards.length);

    // 칸이 열리지 않은 사무실이면 두 번째 게임과 그 카드를 거둔다.
    const raw = JSON.parse(JSON.stringify(read)) as Record<string, unknown>;
    raw.office = TWIN.unlockOffice - 1;
    const early = normalizeCompany(raw) as CompanyState;
    expect(early.project?.id).toBe('lightning-tap');
    expect(early.second).toBeNull();
    expect([...early.inbox, ...early.backlog].every((task) => task.project !== 'stack-tower')).toBe(true);
    expect(waitingOf(early, 'lightning-tap')).toBe(PROJECTS['lightning-tap'].cards.length);
  });
});
