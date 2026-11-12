import { describe, expect, it } from 'vitest';
import { AWAY, BUDDIES, BUDDY, CHEER_SECONDS, EQUIPMENT, OFFICES, STAFF, STAFF_ORDER, type StaffId } from './data';
import {
  awayRate,
  baseSpeed,
  buddyOf,
  catchUp,
  cheer,
  cheerSeconds,
  createCompany,
  deskColumns,
  hasBuddy,
  hasLonelyBuddy,
  hire,
  hireCost,
  hirePool,
  incomePerSecond,
  moveOffice,
  neighbors,
  normalizeCompany,
  projectBonus,
  staffCount,
  startProject,
  swapDesks,
  assign,
  type CompanyState,
} from './rules';

/** 사무실을 office까지 옮기고 빈 자리를 모두 채운 회사 */
function grown(office: number): CompanyState {
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

const deskOf = (state: CompanyState, id: StaffId): number => state.desks.findIndex((desk) => desk.staff === id);

describe('단짝의 표', () => {
  it('짝은 서로 다른 두 친구이고, 한 친구는 한 짝에만 든다', () => {
    const seen = new Set<StaffId>();
    for (const [a, b] of BUDDIES) {
      expect(a in STAFF && b in STAFF).toBe(true);
      expect(a).not.toBe(b);
      expect(seen.has(a) || seen.has(b)).toBe(false);
      seen.add(a);
      seen.add(b);
    }
    // 모든 친구에게 단짝이 있다.
    expect([...seen].sort()).toEqual([...STAFF_ORDER].sort());
    expect(BUDDY.speed).toBeGreaterThan(0);
  });

  it('단짝은 서로를 가리킨다', () => {
    for (const id of STAFF_ORDER) {
      const buddy = buddyOf(id);
      expect(buddy).not.toBeNull();
      expect(buddyOf(buddy as StaffId)).toBe(id);
    }
  });
});

describe('옆자리', () => {
  it('책상이 늘면 한 줄에 더 많이 놓는다', () => {
    expect(OFFICES.map((office) => deskColumns(office.desks))).toEqual([2, 2, 3, 3, 4]);
  });

  it('같은 줄의 바로 옆 책상만 옆자리다', () => {
    const state = grown(2); // 책상 6개, 한 줄에 셋
    expect(neighbors(state, 0)).toEqual([1]);
    expect(neighbors(state, 1)).toEqual([0, 2]);
    expect(neighbors(state, 2)).toEqual([1]);
    // 줄이 바뀌면 번호가 이어져도 옆자리가 아니다.
    expect(neighbors(state, 3)).toEqual([4]);
    expect(neighbors(state, 5)).toEqual([4]);
    expect(neighbors(state, 6)).toEqual([]);
    expect(neighbors(state, -1)).toEqual([]);
  });
});

describe('단짝', () => {
  it('단짝과 옆자리에 앉으면 둘 다 빨라진다', () => {
    const state = grown(1); // 새싹이(사장), 병아리, 그리고 둘
    const drop = deskOf(state, 'drop');
    expect(drop).toBeGreaterThanOrEqual(2);
    expect(hasBuddy(state, 0)).toBe(false);
    expect(hasLonelyBuddy(state)).toBe(true);
    const before = [baseSpeed(state, 0), baseSpeed(state, drop)];

    // 물방울을 사장 옆자리로 옮긴다.
    expect(swapDesks(state, 1, drop)).toBe(true);
    expect(state.desks[1].staff).toBe('drop');
    expect(hasBuddy(state, 0)).toBe(true);
    expect(hasBuddy(state, 1)).toBe(true);
    expect(baseSpeed(state, 0)).toBeCloseTo(before[0] + BUDDY.speed);
    expect(baseSpeed(state, 1)).toBeCloseTo(before[1] + BUDDY.speed);
  });

  it('줄이 다르면 번호가 이어져도 단짝 보너스가 없다', () => {
    const state = grown(1); // 책상 4개, 한 줄에 둘
    swapDesks(state, 2, deskOf(state, 'drop'));
    expect(state.desks[2].staff).toBe('drop');
    swapDesks(state, 1, 0); // 사장이 둘째 자리로 간다.
    expect(state.desks[1].staff).toBe('sprout');
    expect(hasBuddy(state, 1)).toBe(false);
    expect(hasBuddy(state, 2)).toBe(false);
  });

  it('단짝이 회사에 없으면 외로운 짝으로 세지 않는다', () => {
    const state = createCompany('sprout');
    expect(hasLonelyBuddy(state)).toBe(false);
    state.desks[1].staff = 'drop';
    expect(hasBuddy(state, 0)).toBe(true);
    expect(hasLonelyBuddy(state)).toBe(false);
  });
});

describe('자리 바꾸기', () => {
  it('하던 일, 레벨, 부서, 컴퓨터까지 함께 옮겨 간다', () => {
    const state = grown(1);
    state.desks[1].level = 3;
    state.desks[1].gear = { computer: 4 };
    startProject(state, 'lightning-tap');
    assign(state, 0, 1);
    const moving = state.desks[1];
    const other = state.desks[3];

    expect(swapDesks(state, 1, 3)).toBe(true);
    expect(state.desks[3]).toBe(moving);
    expect(state.desks[1]).toBe(other);
    expect(state.desks[3].task).not.toBeNull();
    expect(state.desks[3].gear).toEqual({ computer: 4 });
    expect(staffCount(state)).toBe(4);
  });

  it('빈 자리로 옮겨 앉을 수 있고, 빈 자리끼리나 없는 자리와는 바꾸지 못한다', () => {
    const state = createCompany('sprout');
    state.reputation = OFFICES[1].reputation;
    state.leaves = OFFICES[1].cost;
    moveOffice(state);
    expect(swapDesks(state, 1, 3)).toBe(true);
    expect(state.desks.map((desk) => desk.staff)).toEqual(['sprout', null, null, 'chick']);
    expect(swapDesks(state, 1, 2)).toBe(false);
    expect(swapDesks(state, 0, 0)).toBe(false);
    expect(swapDesks(state, 0, 9)).toBe(false);
    expect(swapDesks(state, -1, 0)).toBe(false);
  });

  it('바꾼 자리는 세이브에 그대로 남는다', () => {
    const state = grown(2);
    swapDesks(state, 1, 4);
    swapDesks(state, 0, 2);
    expect(normalizeCompany(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });
});

describe('새 장비', () => {
  it('화분은 응원을 오래가게 한다', () => {
    const state = createCompany('sprout');
    expect(cheerSeconds(state)).toBe(CHEER_SECONDS);
    state.gear = { plant: 2 };
    expect(cheerSeconds(state)).toBeCloseTo(CHEER_SECONDS * (1 + EQUIPMENT.plant.effect.amount * 2));
    startProject(state, 'lightning-tap');
    assign(state, 0, 0);
    cheer(state, 0);
    expect(state.desks[0].cheer).toBeCloseTo(cheerSeconds(state));
    // 세이브를 읽을 때도 늘어난 시간까지 받아들인다.
    expect(normalizeCompany(JSON.parse(JSON.stringify(state)))?.desks[0].cheer).toBeCloseTo(cheerSeconds(state));
  });

  it('편한 의자는 모두의 일 속도를, 복합기는 출시 보너스를 올린다', () => {
    // 오리와 병아리는 출시 보너스를 올리는 성격이 아니라서 복합기의 몫만 보인다.
    const state = createCompany('duck');
    const speed = baseSpeed(state, 1);
    const bonus = projectBonus(state, 'gate-run');
    state.gear = { chair: 3, printer: 2 };
    expect(baseSpeed(state, 1)).toBeCloseTo(speed + EQUIPMENT.chair.effect.amount * 3);
    expect(projectBonus(state, 'gate-run')).toBe(Math.round(bonus * (1 + EQUIPMENT.printer.effect.amount * 2)));
  });

  it('회의실은 닫아 둔 동안의 수익을 늘린다', () => {
    const plain = createCompany('sprout');
    plain.released = { 'lightning-tap': 1 };
    const roomy = createCompany('sprout');
    roomy.released = { 'lightning-tap': 1 };
    roomy.gear = { meeting: 5 };
    expect(awayRate(plain)).toBe(AWAY.rate);
    expect(awayRate(roomy)).toBeCloseTo(AWAY.rate * (1 + EQUIPMENT.meeting.effect.amount * 5));
    const hour = 3600;
    expect(catchUp(plain, hour)?.leaves).toBeCloseTo(incomePerSecond(plain) * hour * AWAY.rate);
    expect(catchUp(roomy, hour)?.leaves).toBeCloseTo(incomePerSecond(roomy) * hour * awayRate(roomy));
    // 아무리 올려도 열어 둔 때보다 많이 벌지는 않는다.
    roomy.gear = { meeting: EQUIPMENT.meeting.maxLevel };
    expect(awayRate(roomy)).toBeLessThanOrEqual(1);
  });
});
