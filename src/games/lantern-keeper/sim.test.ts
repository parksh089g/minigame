import { describe, expect, it } from 'vitest';
import { playRun } from './bot';
import { ENEMIES, MID_BOSS_AT, RUN_SECONDS, SURGES } from './data';
import { maxAlive, seededRandom, xpToNext, type Upgrade } from './rules';
import { createRun, looksLikeRun, Sim, type Enemy, type RunState, type SimEvent } from './sim';

const config = { viewW: 240, viewH: 520, meta: {} };
const STEP = 1 / 60;

function newSim(seed = 1, state: RunState = createRun(config)): Sim {
  return new Sim(state, seededRandom(seed));
}

function enemy(kind: Enemy['kind'], x: number, y: number, hp = ENEMIES[kind].hp): Enemy {
  return { uid: 9000 + x, kind, x, y, hp, maxHp: hp, flash: 0, slow: 0, fireflyCd: 0, timer: 99, mode: 0, vx: 0, vy: 0 };
}

/** seconds초 동안 돌리면서 일어난 일을 모은다. 레벨업은 첫 선택지로 넘긴다. */
function advance(sim: Sim, seconds: number, moveX = 0, moveY = 0): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < Math.round(seconds / STEP); i += 1) {
    while (sim.state.pendingLevelUps > 0) sim.applyUpgrade(sim.options()[0]);
    sim.step(STEP, moveX, moveY);
    events.push(...sim.events);
  }
  return events;
}

describe('한 판의 시작', () => {
  it('불씨탄 하나만 들고 가득 찬 체력으로 시작한다', () => {
    const state = createRun({ ...config, meta: { vigor: 2 } });
    expect(state.weapons).toEqual({ ember: 1 });
    expect(state.player.hp).toBe(120);
    expect(state.player.level).toBe(1);
    expect(looksLikeRun(state)).toBe(true);
  });

  it('이동 속도는 방향의 길이와 상관없이 같다', () => {
    const straight = newSim();
    const diagonal = newSim();
    advance(straight, 1, 1, 0);
    advance(diagonal, 1, 5, 5);
    const d = diagonal.state.player;
    expect(straight.state.player.x).toBeCloseTo(62, 0);
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(62, 0);
  });
});

describe('적', () => {
  it('화면 밖에서 나타나 플레이어에게 다가온다', () => {
    const sim = newSim();
    advance(sim, 1.5);
    const first = sim.state.enemies[0];
    expect(first).toBeDefined();
    const before = Math.hypot(first.x, first.y);
    expect(Math.max(Math.abs(first.x) - 120, Math.abs(first.y) - 260)).toBeGreaterThan(-30);
    advance(sim, 1);
    expect(Math.hypot(first.x, first.y)).toBeLessThan(before);
  });

  it('닿으면 피해를 주고, 잠깐 동안은 다시 피해를 주지 않는다', () => {
    const sim = newSim();
    sim.state.weapons = {};
    sim.state.enemies.push(enemy('brute', 2, 0, 9999), enemy('brute', -2, 0, 9999));
    sim.step(STEP, 0, 0);
    expect(sim.events).toContainEqual({ type: 'hurt' });
    expect(sim.state.player.hp).toBe(100 - ENEMIES.brute.damage);
    advance(sim, 0.3);
    expect(sim.state.player.hp).toBe(100 - ENEMIES.brute.damage);
    advance(sim, 0.4);
    expect(sim.state.player.hp).toBe(100 - ENEMIES.brute.damage * 2);
  });

  it('체력이 다하면 판이 끝나고 더 진행되지 않는다', () => {
    const sim = newSim();
    sim.state.weapons = {};
    sim.state.player.hp = 1;
    sim.state.enemies.push(enemy('shade', 1, 0, 9999));
    sim.step(STEP, 0, 0);
    expect(sim.state.over).toBe('dead');
    expect(sim.summary().cleared).toBe(false);
    const t = sim.state.t;
    sim.step(STEP, 1, 0);
    expect(sim.state.t).toBe(t);
  });

  it('겹쳐 있던 적들이 서로 밀려난다', () => {
    const sim = newSim();
    sim.state.weapons = {};
    sim.state.enemies.push(enemy('shade', 200, 200), enemy('shade', 201, 200));
    const [a, b] = sim.state.enemies;
    for (let i = 0; i < 30; i += 1) sim.step(STEP, 0, 0);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(6);
  });

  it('멀리 떼어 놓은 적은 화면 가장자리로 돌아온다', () => {
    const sim = newSim();
    sim.state.weapons = {};
    sim.state.enemies.push(enemy('shade', 5000, 0));
    sim.step(STEP, 0, 0);
    const moved = sim.state.enemies[0];
    expect(Math.abs(moved.x)).toBeLessThan(200);
    expect(Math.abs(moved.y)).toBeLessThan(340);
  });
});

describe('무기', () => {
  it('불씨탄이 가장 가까운 적을 쓰러뜨리고 빛 조각을 남긴다', () => {
    const sim = newSim();
    sim.state.spawnDebt = -100;
    sim.state.enemies.push(enemy('shade', 60, 0), enemy('shade', 0, 110));
    const events = advance(sim, 1.2);
    expect(events.some((e) => e.type === 'shoot')).toBe(true);
    expect(events).toContainEqual({ type: 'kill', x: expect.any(Number), y: expect.any(Number), boss: false });
    expect(sim.state.kills).toBe(1);
    expect(sim.state.enemies).toHaveLength(1);
    expect(sim.state.enemies[0].y).toBeGreaterThan(50);
    expect(sim.state.gems).toHaveLength(1);
  });

  it('등불 고리는 둘레 안의 적만 태운다', () => {
    const sim = newSim();
    sim.state.weapons = { aura: 1 };
    sim.state.spawnDebt = -100;
    sim.state.enemies.push(enemy('brute', 20, 0, 500), enemy('brute', 80, 0, 500));
    sim.step(STEP, 0, 0);
    const [near, far] = sim.state.enemies;
    expect(near.hp).toBeLessThan(500);
    expect(far.hp).toBe(500);
  });

  it('반딧불은 같은 적을 쉬지 않고 때리지는 않는다', () => {
    const sim = newSim();
    sim.state.weapons = { firefly: 1 };
    sim.state.spawnDebt = -100;
    sim.state.enemies.push(enemy('giant', 30, 0, 5000));
    const boss = sim.state.enemies[0];
    boss.timer = 99;
    sim.step(STEP, 0, 0);
    const afterFirst = boss.hp;
    expect(afterFirst).toBeLessThan(5000);
    sim.step(STEP, 0, 0);
    expect(boss.hp).toBe(afterFirst);
  });

  it('별똥은 잠깐 뒤에 떨어져 둘레의 적을 함께 때린다', () => {
    const sim = newSim();
    sim.state.weapons = { star: 1 };
    sim.state.cd.star = 0;
    sim.state.spawnDebt = -100;
    sim.state.enemies.push(enemy('brute', 60, 60, 500), enemy('brute', 64, 60, 500));
    sim.step(STEP, 0, 0);
    expect(sim.state.strikes).toHaveLength(1);
    expect(sim.state.enemies.every((e) => e.hp === 500)).toBe(true);
    const events = advance(sim, 0.6);
    expect(events.some((e) => e.type === 'strike')).toBe(true);
    expect(sim.state.enemies.every((e) => e.hp < 500)).toBe(true);
  });
});

describe('빛 조각과 레벨업', () => {
  it('가까운 조각은 끌려와 경험치가 되고, 레벨이 오르면 고를 때까지 멈춘다', () => {
    const sim = newSim();
    sim.state.spawnDebt = -100;
    sim.state.gems.push(
      { x: 10, y: 0, value: xpToNext(1), kind: 'xp', pulled: false },
      { x: 300, y: 0, value: 1, kind: 'xp', pulled: false },
    );
    const events: SimEvent[] = [];
    for (let i = 0; i < 30 && sim.state.pendingLevelUps === 0; i += 1) {
      sim.step(STEP, 0, 0);
      events.push(...sim.events);
    }
    expect(events).toContainEqual({ type: 'levelup' });
    expect(sim.state.player.level).toBe(2);
    expect(sim.state.pendingLevelUps).toBe(1);
    expect(sim.state.gems).toHaveLength(1);

    const t = sim.state.t;
    sim.step(STEP, 1, 0);
    expect(sim.state.t).toBe(t);

    const options = sim.options();
    expect(options).toHaveLength(3);
    sim.applyUpgrade(options[0]);
    expect(sim.state.pendingLevelUps).toBe(0);
    sim.step(STEP, 1, 0);
    expect(sim.state.t).toBeGreaterThan(t);
  });

  it('고른 강화가 바로 반영된다', () => {
    const sim = newSim();
    const picks: Upgrade[] = [
      { type: 'weapon', id: 'aura', level: 1 },
      { type: 'passive', id: 'coat', level: 1 },
      { type: 'embers' },
    ];
    sim.state.player.hp = 50;
    for (const pick of picks) sim.applyUpgrade(pick);
    expect(sim.state.weapons.aura).toBe(1);
    expect(sim.maxHp).toBe(120);
    expect(sim.state.player.hp).toBe(70);
    expect(sim.summary().bonusEmbers).toBeGreaterThan(0);
    sim.applyUpgrade({ type: 'heal' });
    expect(sim.state.player.hp).toBe(100);
  });

  it('회복 떡을 주우면 체력이 최대를 넘지 않게 찬다', () => {
    const sim = newSim();
    sim.state.spawnDebt = -100;
    sim.state.player.hp = 95;
    sim.state.gems.push({ x: 3, y: 0, value: 15, kind: 'heal', pulled: false });
    sim.step(STEP, 0, 0);
    expect(sim.events).toContainEqual({ type: 'heal' });
    expect(sim.state.player.hp).toBe(100);
  });
});

describe('보스와 끝', () => {
  it('5분에 중간 보스가, 10분에 마지막 보스가 한 번씩 나온다', () => {
    const state = createRun(config);
    state.t = MID_BOSS_AT - 0.01;
    state.surgeIndex = SURGES.length;
    const sim = newSim(1, state);
    sim.state.player.hp = 1e9;
    sim.step(STEP, 0, 0);
    expect(sim.events).toContainEqual({ type: 'boss', kind: 'giant' });
    sim.step(STEP, 0, 0);
    expect(sim.state.enemies.filter((e) => e.kind === 'giant')).toHaveLength(1);

    sim.state.t = RUN_SECONDS - 0.01;
    sim.step(STEP, 0, 0);
    expect(sim.events).toContainEqual({ type: 'boss', kind: 'lord' });
  });

  it('마지막 보스를 쓰러뜨리면 완주다', () => {
    const sim = newSim();
    sim.state.t = RUN_SECONDS + 5;
    sim.state.midBoss = true;
    sim.state.finalBoss = true;
    sim.state.surgeIndex = SURGES.length;
    sim.state.enemies.push(enemy('lord', 40, 0, 1));
    advance(sim, 1.5);
    expect(sim.state.over).toBe('cleared');
    expect(sim.summary()).toMatchObject({ cleared: true, bossKills: 1, seconds: RUN_SECONDS });
  });

  it('밀물이 오면 적이 한꺼번에 둘러싼다', () => {
    const state = createRun(config);
    state.t = SURGES[0] - 0.01;
    const sim = newSim(1, state);
    const before = sim.state.enemies.length;
    sim.step(STEP, 0, 0);
    expect(sim.events).toContainEqual({ type: 'surge' });
    expect(sim.state.enemies.length - before).toBeGreaterThanOrEqual(20);
  });
});

describe('저장과 이어하기', () => {
  it('상태를 글자로 바꿨다가 되돌려도 그대로 이어진다', () => {
    const sim = newSim(5);
    advance(sim, 40, 0.6, 0.2);
    const copy = JSON.parse(JSON.stringify(sim.state)) as RunState;
    expect(looksLikeRun(copy)).toBe(true);
    expect(copy).toEqual(sim.state);

    const resumed = newSim(11, copy);
    advance(resumed, 5, -1, 0);
    expect(resumed.state.t).toBeCloseTo(45, 1);
    expect(resumed.state.kills).toBeGreaterThanOrEqual(sim.state.kills);
  });

  it('끝난 판이나 엉뚱한 값은 이어하지 않는다', () => {
    expect(looksLikeRun(null)).toBe(false);
    expect(looksLikeRun({ version: 1 })).toBe(false);
    expect(looksLikeRun({ ...createRun(config), version: 0 })).toBe(false);
    expect(looksLikeRun({ ...createRun(config), over: 'dead' })).toBe(false);
  });
});

describe('자동 플레이로 본 밸런스', () => {
  it('가만히 서 있으면 4분을 버티지 못한다', () => {
    for (const seed of [1, 2, 3]) {
      const result = playRun(seed, 'still', config);
      expect(result.over).toBe('dead');
      expect(result.seconds).toBeLessThan(240);
    }
  });

  it('피하면서 싸우면 서 있을 때보다 훨씬 오래 버틴다', () => {
    const result = playRun(2, 'kite', config, 240);
    expect(result.seconds).toBeGreaterThan(150);
    expect(result.level).toBeGreaterThan(5);
  });

  it('적의 수가 상한을 크게 넘지 않는다', () => {
    const result = playRun(4, 'kite', { ...config, meta: { vigor: 5, might: 5, swift: 5 } }, 400);
    expect(result.peakEnemies).toBeLessThanOrEqual(maxAlive(RUN_SECONDS) + 80);
  });
});
