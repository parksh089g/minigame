import { describe, expect, it } from 'vitest';
import { damageRanking, levelLabel, passiveRows, percent, weaponRows } from './build';
import { EVOLVE_LEVEL, MAX_LEVEL, WEAPONS } from './data';
import { seededRandom } from './rules';
import { createRun, Sim } from './sim';

describe('지금 빌드', () => {
  it('무기는 얻은 순서대로, 진화한 무기는 진화형의 이름과 아이콘으로 보인다', () => {
    const rows = weaponRows({ bolt: 2, ember: EVOLVE_LEVEL, aura: MAX_LEVEL });
    expect(rows.map((row) => row.id)).toEqual(['bolt', 'ember', 'aura']);
    expect(rows[1]).toMatchObject({ icon: 'emberEvo', name: WEAPONS.ember.evolved.name, evolved: true });
    expect(rows[2]).toMatchObject({ icon: 'aura', name: WEAPONS.aura.name, evolved: false, level: MAX_LEVEL });
    expect(levelLabel(rows[0])).toBe('Lv 2');
    expect(levelLabel(rows[1])).toBe('진화');
  });

  it('패시브도 얻은 순서대로, 0레벨은 뺀다', () => {
    expect(passiveRows({ lens: 1, coat: 0, wick: 3 })).toEqual([
      { id: 'lens', icon: 'lens', name: '유리 렌즈', level: 1 },
      { id: 'wick', icon: 'wick', name: '굵은 심지', level: 3 },
    ]);
    expect(levelLabel({ level: 3 })).toBe('Lv 3');
  });

  it('피해의 몫은 든 무기끼리 나눈다', () => {
    const rows = weaponRows({ ember: 3, star: 1, bolt: 1 }, { ember: 600, star: 300, bolt: 100 });
    expect(rows.map((row) => row.share)).toEqual([0.6, 0.3, 0.1]);
    expect(rows.map((row) => percent(row.share))).toEqual(['60%', '30%', '10%']);
    // 아직 아무도 때리지 않았거나 기록이 없으면 모두 0이다.
    expect(weaponRows({ ember: 1 }).map((row) => row.share)).toEqual([0]);
    expect(weaponRows({ ember: 1, star: 1 }, {}).map((row) => row.share)).toEqual([0, 0]);
  });

  it('엉뚱한 값과 들고 있지 않은 무기의 기록은 세지 않는다', () => {
    const dealt = { ember: 100, star: -50, bolt: Number.NaN, lance: 900 };
    const rows = weaponRows({ ember: 1, star: 1, bolt: 1 }, dealt);
    expect(rows.map((row) => row.share)).toEqual([1, 0, 0]);
  });

  it('결과 화면에는 많이 준 순서대로, 같으면 먼저 얻은 순서대로 늘어놓는다', () => {
    const ranking = damageRanking({ ember: 3, star: 1, bolt: 1, aura: 1 }, { ember: 100, star: 500, bolt: 100 });
    expect(ranking.map((row) => row.id)).toEqual(['star', 'ember', 'bolt', 'aura']);
    expect(damageRanking({ ember: 1 })).toEqual([]);
    expect(damageRanking({ ember: 1, star: 2 }, { ember: 0 })).toEqual([]);
  });
});

describe('무기별 피해 기록', () => {
  it('판을 하는 동안 든 무기마다 준 피해가 쌓이고, 준 피해는 적이 잃은 체력을 넘지 않는다', () => {
    const state = createRun({ viewW: 240, viewH: 400, meta: {}, seed: 7 });
    const sim = new Sim(state, seededRandom(7));
    expect(state.dealt).toEqual({});
    let lost = 0;
    for (let i = 0; i < 30 * 40 && !state.over; i += 1) {
      while (state.pendingLevelUps > 0) sim.applyUpgrade(sim.options()[0]);
      const before = new Map(state.enemies.map((e) => [e.uid, e.hp]));
      sim.step(1 / 30, 0, 0);
      // 이번 걸음에 살아남은 적이 잃은 체력만 더해도, 기록된 피해가 그보다 적을 수는 없다.
      for (const e of state.enemies) {
        const hp = before.get(e.uid);
        if (hp !== undefined && e.hp < hp) lost += hp - Math.max(0, e.hp);
      }
    }
    const dealt = state.dealt ?? {};
    const total = Object.values(dealt).reduce((sum, value) => sum + (value ?? 0), 0);
    expect(dealt.ember ?? 0).toBeGreaterThan(0);
    expect(total).toBeGreaterThanOrEqual(lost - 1e-6);
    // 들고 있는 무기만 기록된다.
    for (const id of Object.keys(dealt)) expect(state.weapons).toHaveProperty(id);
    expect(damageRanking(state.weapons, dealt).length).toBeGreaterThan(0);
  });

  it('이 기록이 없거나 엉뚱한 예전 저장도 그대로 이어서 할 수 있다', () => {
    const state = createRun({ viewW: 240, viewH: 400, meta: {}, seed: 3 });
    delete state.dealt;
    const sim = new Sim(structuredClone(state), seededRandom(3));
    expect(sim.state.dealt).toEqual({});
    const junk = { ...structuredClone(state), dealt: 'x' as unknown as undefined };
    const other = new Sim(junk, seededRandom(3));
    for (let i = 0; i < 300; i += 1) other.step(1 / 30, 0, 0);
    expect(typeof other.state.dealt).toBe('object');
  });
});
