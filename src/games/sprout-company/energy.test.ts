import { describe, expect, it } from 'vitest';
import { BREAK, EQUIPMENT, OFFICES, type TaskKind } from './data';
import {
  acceptRush,
  advance,
  assign,
  baseSpeed,
  bestCardFor,
  breakOpen,
  createCompany,
  isPeppy,
  moveOffice,
  normalizeCompany,
  restSeconds,
  restingCount,
  staminaSeconds,
  type CompanyState,
  type Task,
} from './rules';

const fixed = (): number => 0.5;

/** 사무실을 office까지 옮긴 회사. 사장 혼자 있다. */
function at(office: number): CompanyState {
  const state = createCompany('duck');
  while (state.office < office) {
    state.reputation = OFFICES[state.office + 1].reputation;
    state.leaves = OFFICES[state.office + 1].cost;
    moveOffice(state);
  }
  state.leaves = 0;
  // 급한 의뢰가 끼어들지 않게 멀리 미뤄 둔다.
  state.rushIn = 1e9;
  return state;
}

const card = (left: number, kind: TaskKind = 'plan'): Task => ({ kind, left, total: left });

describe('휴게실과 기운', () => {
  it('휴게실이 없는 사무실에서는 기운이 줄지도 않고 덤도 없다', () => {
    const state = at(BREAK.unlockOffice - 1);
    expect(breakOpen(state)).toBe(false);
    expect(isPeppy(state, 0)).toBe(false);
    const speed = baseSpeed(state, 0);
    state.inbox = [card(1e9)];
    assign(state, 0, 0);
    advance(state, 600, fixed);
    expect(state.desks[0].energy).toBe(1);
    expect(state.desks[0].resting).toBe(false);
    expect(baseSpeed(state, 0)).toBe(speed);
  });

  it('기운이 남은 친구는 더 빨리 일하고, 바닥나면 보통 빠르기로 돌아온다', () => {
    const state = at(BREAK.unlockOffice);
    expect(isPeppy(state, 0)).toBe(true);
    const peppy = baseSpeed(state, 0);
    state.desks[0].energy = 0;
    expect(isPeppy(state, 0)).toBe(false);
    const plain = baseSpeed(state, 0);
    expect(peppy).toBeCloseTo(plain * (1 + BREAK.boost), 9);
    // 바닥나도 휴게실이 없던 때보다 느려지지는 않는다.
    const before = at(BREAK.unlockOffice - 1);
    expect(plain).toBeCloseTo(baseSpeed(before, 0), 9);
  });

  it('일하는 동안 기운이 줄어서 정해진 시간 뒤에 바닥난다', () => {
    const state = at(BREAK.unlockOffice);
    state.inbox = [card(1e9)];
    assign(state, 0, 0);
    advance(state, staminaSeconds(state) / 2, fixed);
    expect(state.desks[0].energy).toBeCloseTo(0.5, 6);
    advance(state, staminaSeconds(state), fixed);
    expect(state.desks[0].energy).toBe(0);
    // 하던 일은 끝까지 한다.
    expect(state.desks[0].resting).toBe(false);
    expect(state.desks[0].task).not.toBeNull();
  });

  it('한 번에 긴 시간을 흘려도 기운이 남은 동안만 빠르게 센다', () => {
    const whole = at(BREAK.unlockOffice);
    const split = at(BREAK.unlockOffice);
    for (const state of [whole, split]) {
      state.desks[0].energy = 0.1;
      state.inbox = [card(1e9)];
      assign(state, 0, 0);
    }
    const seconds = staminaSeconds(whole) * 0.1 + 30;
    advance(whole, seconds, fixed);
    for (let time = 0; time < seconds - 1e-9; time += 0.5) advance(split, Math.min(0.5, seconds - time), fixed);
    expect(whole.desks[0].task!.left).toBeCloseTo(split.desks[0].task!.left, 4);
  });

  it('기운이 바닥난 친구는 일을 마치면 쉬러 가고, 가득 채워서 돌아온다', () => {
    const state = at(BREAK.unlockOffice);
    state.desks[0].energy = 0;
    state.inbox = [card(0.001), card(5)];
    assign(state, 0, 0);
    advance(state, 0.1, fixed);
    const desk = state.desks[0];
    expect(desk.task).toBeNull();
    expect(desk.resting).toBe(true);
    expect(restingCount(state)).toBe(1);
    // 쉬는 동안에는 일을 맡지 않는다.
    expect(bestCardFor(state, 0)).toBe(-1);
    expect(assign(state, 0, 0)).toBe(false);
    advance(state, restSeconds(state) / 2, fixed);
    expect(desk.resting).toBe(true);
    expect(desk.energy).toBeGreaterThan(0.4);
    advance(state, restSeconds(state) / 2 + 0.2, fixed);
    expect(desk.resting).toBe(false);
    expect(desk.energy).toBe(1);
    expect(assign(state, 0, 0)).toBe(true);
  });

  it('기운이 남아 있으면 일이 없어도 쉬러 가지 않고 자리에서 천천히 채운다', () => {
    const state = at(BREAK.unlockOffice);
    state.desks[0].energy = 0.5;
    advance(state, 10, fixed);
    expect(state.desks[0].resting).toBe(false);
    expect(state.desks[0].energy).toBeCloseTo(0.5 + (10 * BREAK.idle) / restSeconds(state), 6);
  });

  it('휴게실 자리만큼만 한꺼번에 쉰다', () => {
    const state = at(OFFICES.length - 1);
    for (const desk of state.desks) {
      desk.staff = 'duck';
      desk.energy = 0;
    }
    expect(state.desks.length).toBeGreaterThan(BREAK.seats);
    advance(state, 0.1, fixed);
    expect(restingCount(state)).toBe(BREAK.seats);
    // 자리가 나면 다음 친구가 간다. 기다리는 동안 조금 찬 친구는 가지 않고 일한다.
    advance(state, restSeconds(state) + 0.2, fixed);
    expect(restingCount(state)).toBe(0);
    expect(state.desks.every((desk) => desk.energy > 0)).toBe(true);
  });

  it('급한 의뢰를 받으면 쉬던 친구도 돌아오고, 끝날 때까지 쉬러 가지 않는다', () => {
    const state = at(BREAK.unlockOffice);
    state.desks[0].energy = 0;
    advance(state, 0.1, fixed);
    expect(state.desks[0].resting).toBe(true);
    advance(state, restSeconds(state) / 4, fixed);
    state.offer = { kinds: ['plan'], work: 1e9, reward: 10, left: 10 };
    expect(acceptRush(state)).toBe(true);
    expect(state.desks[0].resting).toBe(false);
    expect(state.desks[0].energy).toBeGreaterThan(0.2);
    state.desks[0].energy = 0;
    advance(state, 1, fixed);
    expect(state.desks[0].resting).toBe(false);
  });

  it('소파는 쉬는 시간을 줄이고, 간식은 기운을 오래가게 한다', () => {
    const state = at(BREAK.unlockOffice);
    expect(restSeconds(state)).toBe(BREAK.restSeconds);
    expect(staminaSeconds(state)).toBe(BREAK.workSeconds);
    state.gear.sofa = 2;
    state.gear.snack = 3;
    expect(restSeconds(state)).toBeCloseTo(BREAK.restSeconds / (1 + EQUIPMENT.sofa.effect.amount * 2), 9);
    expect(staminaSeconds(state)).toBeCloseTo(BREAK.workSeconds * (1 + EQUIPMENT.snack.effect.amount * 3), 9);
    expect(EQUIPMENT.sofa.unlockOffice).toBe(BREAK.unlockOffice);
    expect(EQUIPMENT.snack.unlockOffice).toBe(BREAK.unlockOffice);
  });

  it('기운과 쉬는 중인지는 세이브에 남고, 예전 세이브는 가득 찬 것으로 읽는다', () => {
    const state = at(BREAK.unlockOffice);
    state.desks[0].energy = 0.25;
    state.desks[0].resting = true;
    const loaded = normalizeCompany(JSON.parse(JSON.stringify(state)))!;
    expect(loaded.desks[0].energy).toBe(0.25);
    expect(loaded.desks[0].resting).toBe(true);

    const raw = JSON.parse(JSON.stringify(state)) as { desks: Record<string, unknown>[] };
    for (const desk of raw.desks) {
      delete desk.energy;
      delete desk.resting;
    }
    const old = normalizeCompany(raw)!;
    expect(old.desks[0].energy).toBe(1);
    expect(old.desks[0].resting).toBe(false);

    // 값이 이상하면 고쳐 읽는다.
    raw.desks[0].energy = 7;
    raw.desks[0].resting = true;
    const odd = normalizeCompany(raw)!;
    expect(odd.desks[0].energy).toBe(1);
    expect(odd.desks[0].resting).toBe(false);
  });
});
