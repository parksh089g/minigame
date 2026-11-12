import { describe, expect, it } from 'vitest';
import { runBot } from './bot';
import { BRANCH, GUIDE_STEPS, OFFICES } from './data';
import { advanceGuide, GUIDE_TIPS, guideStep, guideView, skipGuide } from './guide';
import {
  advance,
  assign,
  buyEquipment,
  cheer,
  createCompany,
  foundBranch,
  hire,
  hireCost,
  hirePool,
  isReady,
  moveOffice,
  normalizeCompany,
  release,
  skill,
  startProject,
  type CompanyState,
} from './rules';

const fixed = (): number => 0.5;

/** 하던 일을 모두 끝낸다. */
function finishTasks(state: CompanyState): void {
  for (let guard = 0; guard < 2000 && state.desks.some((desk) => desk.task); guard += 1) advance(state, 1, fixed);
}

/** 첫 게임을 내고 길잡이를 그 뒤까지 넘긴 회사 */
function released(): CompanyState {
  const state = createCompany('sprout');
  state.rushIn = 1e9;
  startProject(state, 'lightning-tap');
  while (!isReady(state)) {
    state.desks.forEach((desk, index) => {
      if (desk.staff && !desk.task && state.inbox.length > 0) assign(state, 0, index);
    });
    finishTasks(state);
  }
  release(state);
  advanceGuide(state);
  return state;
}

describe('길잡이', () => {
  it('새 회사는 게임 고르기부터 짚는다', () => {
    const state = createCompany('sprout');
    expect(state.guide).toBe(0);
    expect(guideStep(state)).toBe('pick');
    expect(advanceGuide(state)).toEqual([]);
    expect(guideView(state)).toMatchObject({ step: 'pick', target: { kind: 'pick' } });
  });

  it('카드를 맡길 때는 쉬는 친구를, 그 카드를 잘하는 친구부터 짚는다', () => {
    const state = createCompany('sprout');
    startProject(state, 'lightning-tap');
    expect(advanceGuide(state)).toEqual(['pick']);
    expect(guideStep(state)).toBe('assign');
    for (let card = 0; card < state.inbox.length; card += 1) {
      const view = guideView(state, card);
      expect(view?.target.kind).toBe('desk');
      const index = (view?.target as { index: number }).index;
      const best = Math.max(...state.desks.map((_, at) => skill(state, at, state.inbox[card].kind)));
      expect(skill(state, index, state.inbox[card].kind)).toBe(best);
    }
  });

  it('맡기면 응원을, 응원하면 남은 카드를, 다 만들면 출시를 짚는다', () => {
    const state = createCompany('sprout');
    startProject(state, 'lightning-tap');
    advanceGuide(state);
    assign(state, 0, 0);
    expect(advanceGuide(state)).toEqual(['assign']);
    expect(guideView(state)).toMatchObject({ step: 'cheer', target: { kind: 'desk', index: 0 } });
    cheer(state, 0);
    expect(advanceGuide(state)).toEqual(['cheer']);
    // 쉬는 친구가 있으면 그 친구를, 다 맡겼으면 일하는 친구를 짚는다.
    expect(guideView(state)).toMatchObject({ step: 'finish', target: { kind: 'desk', index: 1 } });
    assign(state, 0, 1);
    expect(guideView(state)?.target).toMatchObject({ kind: 'desk' });
    expect(guideView(state)?.title).toBe('곧 다 만들어요');
    while (!isReady(state)) {
      finishTasks(state);
      state.desks.forEach((desk, index) => {
        if (desk.staff && !desk.task && state.inbox.length > 0) assign(state, 0, index);
      });
    }
    expect(advanceGuide(state)).toEqual(['finish']);
    expect(guideView(state)).toMatchObject({ step: 'release', target: { kind: 'release' } });
    release(state);
    expect(advanceGuide(state)).toEqual(['release']);
    expect(guideStep(state)).toBe('gear');
  });

  it('응원하기 전에 일이 끝나면 다음 카드를 맡기라고 짚는다', () => {
    const state = createCompany('sprout');
    startProject(state, 'lightning-tap');
    assign(state, 0, 0);
    advanceGuide(state);
    finishTasks(state);
    expect(guideStep(state)).toBe('cheer');
    expect(guideView(state)?.title).toBe('카드는 해야 할 일이에요');
    expect(guideView(state)?.target.kind).toBe('desk');
  });

  it('첫 게임을 내면 장비를, 사고 나면 평판 모으기와 이사, 새 친구 뽑기를 차례로 짚는다', () => {
    const state = released();
    expect(guideStep(state)).toBe('gear');
    // 길잡이가 말해 주기 전에는 그 일의 처음 안내를 본 것으로 치지 않는다.
    expect(state.tips).toEqual([]);
    state.leaves = 1000;
    expect(guideView(state)).toMatchObject({ target: { kind: 'button', panel: 'gear' } });
    buyEquipment(state, 'computer', 0);
    expect(advanceGuide(state)).toEqual(['gear']);
    expect(state.tips).toEqual(['income', 'gear']);

    expect(guideView(state)).toMatchObject({ step: 'grow', target: { kind: 'pick' } });
    startProject(state, 'lightning-tap');
    // 게임을 만드는 동안에는 짚을 곳이 없다.
    expect(guideView(state)).toBeNull();
    state.project = null;
    state.inbox = [];
    state.reputation = OFFICES[1].reputation;
    expect(advanceGuide(state)).toEqual(['grow']);

    state.leaves = 0;
    expect(guideView(state)).toMatchObject({ step: 'move', target: { kind: 'pick' } });
    state.leaves = OFFICES[1].cost;
    expect(guideView(state)).toMatchObject({ step: 'move', target: { kind: 'button', panel: 'office' } });
    moveOffice(state);
    expect(advanceGuide(state)).toEqual(['move']);

    const empty = state.desks.findIndex((desk) => desk.staff === null);
    expect(guideView(state)).toMatchObject({ step: 'hire', target: { kind: 'desk', index: empty } });
    const id = hirePool(state)[0];
    state.candidates = [id];
    state.leaves = hireCost(state);
    hire(state, id);
    expect(advanceGuide(state)).toEqual(['hire']);
    expect(guideStep(state)).toBeNull();
    expect(guideView(state)).toBeNull();
    expect(state.guide).toBe(GUIDE_STEPS.length);
    for (const tips of Object.values(GUIDE_TIPS)) for (const tip of tips ?? []) expect(state.tips).toContain(tip);
  });

  it('그만 보기로 하면 끝나고, 처음 안내는 그대로 남는다', () => {
    const state = createCompany('sprout');
    skipGuide(state);
    expect(guideStep(state)).toBeNull();
    expect(guideView(state)).toBeNull();
    expect(advanceGuide(state)).toEqual([]);
    expect(state.tips).toEqual([]);
  });

  it('보통으로 하다 보면 길잡이를 끝까지 지난다', () => {
    const state = createCompany('sprout');
    let seed = 7;
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const seen: string[] = [];
    for (let minute = 0; minute < 40 && guideStep(state); minute += 1) {
      runBot(state, 60, { cheerGap: 6, reaction: 1.5, random });
      seen.push(...advanceGuide(state));
    }
    expect(seen).toEqual([...GUIDE_STEPS]);
    expect(guideStep(state)).toBeNull();
  });

  it('걸음은 세이브에 남고, 길잡이가 생기기 전부터 하던 회사에는 띄우지 않는다', () => {
    const state = released();
    const copy = normalizeCompany(JSON.parse(JSON.stringify(state)))!;
    expect(copy.guide).toBe(state.guide);
    expect(guideStep(copy)).toBe('gear');

    const raw = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    delete raw.guide;
    expect(guideStep(normalizeCompany(raw)!)).toBeNull();
    // 아직 아무것도 내지 않은 회사는 처음부터 본다.
    const fresh = JSON.parse(JSON.stringify(createCompany('sprout'))) as Record<string, unknown>;
    delete fresh.guide;
    expect(guideStep(normalizeCompany(fresh)!)).toBe('pick');
    // 이상한 값은 고쳐 읽는다.
    raw.guide = 99;
    expect(normalizeCompany(raw)!.guide).toBe(GUIDE_STEPS.length);
    raw.guide = -3;
    expect(normalizeCompany(raw)!.guide).toBe(0);
  });

  it('자회사를 세운 뒤의 새 회사에는 길잡이를 다시 띄우지 않는다', () => {
    const state = createCompany('sprout');
    state.office = OFFICES.length - 1;
    state.reputation = BRANCH.reputation;
    state.guide = 3;
    expect(foundBranch(state)).not.toBeNull();
    expect(state.releases).toBe(0);
    expect(guideStep(state)).toBeNull();
  });
});
