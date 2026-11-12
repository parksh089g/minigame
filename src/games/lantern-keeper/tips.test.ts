import { describe, expect, it } from 'vitest';
import { ENEMIES, MID_BOSS_COUNT, STAGE_ORDER, STAGES, SURGES } from './data';
import { applyRun, createDefaultMeta, learnTip, normalizeMeta } from './meta';
import { seededRandom } from './rules';
import { createRun, Sim, type Enemy, type SimEvent } from './sim';
import { normalizeTips, OLD_HAND_TIPS, TIP_IDS, tipFor, TIPS } from './tips';

describe('처음 겪는 일의 안내', () => {
  it('안내는 화면 아래 한 줄에 들어가는 길이다', () => {
    for (const id of TIP_IDS) {
      // 글자 하나가 10px 남짓이고 화면 폭이 240px이다. 띄어쓰기는 좁으므로 세지 않는다.
      expect(TIPS[id].replace(/\s/g, '').length).toBeLessThanOrEqual(19);
    }
  });

  it('일어난 일마다 알맞은 안내를 고른다', () => {
    const cases: Array<[SimEvent, string | null]> = [
      [{ type: 'gem' }, 'gem'],
      [{ type: 'spit' }, 'shooter'],
      [{ type: 'swell' }, 'burster'],
      [{ type: 'post', x: 0, y: 0, first: true }, 'post'],
      [{ type: 'post', x: 0, y: 0, first: false }, 'post'],
      [{ type: 'surge' }, 'surge'],
      [{ type: 'heal' }, 'heal'],
      [{ type: 'pull' }, 'pull'],
      [{ type: 'blast' }, 'blast'],
      [{ type: 'block' }, 'guard'],
      [{ type: 'hurt' }, null],
      [{ type: 'levelup' }, null],
      [{ type: 'burst', x: 0, y: 0, radius: 30 }, null],
    ];
    for (const [event, tip] of cases) expect(tipFor(event)).toBe(tip);
  });

  it('강화권 안내는 중간 보스가 나올 때만 뜬다', () => {
    for (const stage of STAGE_ORDER) {
      for (const kind of STAGES[stage].midBosses) expect(tipFor({ type: 'boss', kind })).toBe('boss');
      expect(tipFor({ type: 'boss', kind: STAGES[stage].finalBoss })).toBeNull();
    }
  });

  it('모든 안내는 그것을 부르는 일이 있다', () => {
    const events: SimEvent[] = [
      { type: 'gem' },
      { type: 'spit' },
      { type: 'swell' },
      { type: 'post', x: 0, y: 0, first: true },
      { type: 'boss', kind: 'giant' },
      { type: 'surge' },
      { type: 'heal' },
      { type: 'pull' },
      { type: 'blast' },
      { type: 'block' },
    ];
    expect(events.map(tipFor).sort()).toEqual([...TIP_IDS].sort());
  });
});

describe('본 안내를 적어 두기', () => {
  it('처음 하는 사람은 본 안내가 없고, 본 안내는 한 번만 적힌다', () => {
    const meta = createDefaultMeta();
    expect(meta.tips).toEqual([]);
    const once = learnTip(meta, 'post');
    expect(once.tips).toEqual(['post']);
    expect(learnTip(once, 'post')).toBe(once);
    // 판이 끝나도 그대로 남는다.
    const after = applyRun(once, {
      embers: 0,
      seconds: 30,
      cleared: false,
      hero: 'keeper',
      stage: 'meadow',
      depth: 0,
      kills: 0,
      bossKills: 0,
      level: 1,
      evolved: [],
    });
    expect(after.tips).toEqual(['post']);
  });

  it('안내가 생기기 전부터 하던 사람에게는 그때도 있던 일을 다시 알려 주지 않는다', () => {
    const veteran = normalizeMeta({ runs: 12, bestSeconds: 400 });
    expect(veteran.tips).toEqual(OLD_HAND_TIPS);
    // 새로 생긴 것들은 한 번씩 알려 준다.
    for (const id of ['shooter', 'burster', 'post', 'pull', 'blast', 'guard'] as const) {
      expect(veteran.tips).not.toContain(id);
    }
    // 한 판도 하지 않은 저장은 처음 하는 사람과 같다.
    expect(normalizeMeta({ runs: 0 }).tips).toEqual([]);
  });

  it('저장된 기록은 그대로 읽히고, 모르는 이름은 버린다', () => {
    expect(normalizeMeta({ runs: 3, tips: ['post', 'nope', 'gem'] }).tips).toEqual(['gem', 'post']);
    // 아무것도 보지 않았다고 적혀 있으면 그대로 둔다(예전 저장으로 치지 않는다).
    expect(normalizeMeta({ runs: 3, tips: [] }).tips).toEqual([]);
    expect(normalizeTips('x')).toEqual([]);
    const meta = learnTip(learnTip(createDefaultMeta(), 'blast'), 'gem');
    expect(normalizeMeta(JSON.parse(JSON.stringify(meta))).tips).toEqual(['gem', 'blast']);
  });
});

describe('부풀기 시작했다는 알림', () => {
  const foe = (kind: Enemy['kind'], x: number): Enemy => ({
    uid: 9000 + x,
    kind,
    x,
    y: 0,
    hp: 9999,
    maxHp: 9999,
    flash: 0,
    slow: 0,
    slowTo: 1,
    fireflyCd: 0,
    timer: 99,
    mode: 0,
    tier: 0,
    vx: 0,
    vy: 0,
  });

  it('터지는 적은 가까이 와서 부풀기 시작할 때 한 번 알리고, 터질 때 또 알린다', () => {
    const sim = new Sim(createRun({ viewW: 240, viewH: 520, meta: {} }), seededRandom(1));
    sim.state.weapons = {};
    sim.state.spawnDebt = -1e6;
    sim.state.surgeIndex = SURGES.length;
    sim.state.midBosses = MID_BOSS_COUNT;
    sim.state.finalBoss = true;
    sim.state.enemies.push(foe('puff', 60));
    const seen: string[] = [];
    for (let i = 0; i < 60 * 6; i += 1) {
      sim.step(1 / 60, 0, 0);
      for (const event of sim.events) if (event.type === 'swell' || event.type === 'burst') seen.push(event.type);
    }
    expect(seen).toEqual(['swell', 'burst']);
    expect(ENEMIES.puff.bursts).toBeDefined();
  });
});
