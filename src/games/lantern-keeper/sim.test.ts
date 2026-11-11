import { describe, expect, it } from 'vitest';
import { playRun } from './bot';
import { ENEMIES, EVOLVE_LEVEL, MAX_LEVEL, MID_BOSS_COUNT, MID_BOSS_EVERY, MID_BOSS_TIERS, RUN_SECONDS, SURGES } from './data';
import { maxAlive, seededRandom, xpToNext, type Upgrade } from './rules';
import { createRun, looksLikeRun, Sim, type Enemy, type RunState, type SimEvent } from './sim';

const config = { viewW: 240, viewH: 520, meta: {} };
const STEP = 1 / 60;

function newSim(seed = 1, state: RunState = createRun(config)): Sim {
  return new Sim(state, seededRandom(seed));
}

function enemy(kind: Enemy['kind'], x: number, y: number, hp = ENEMIES[kind].hp): Enemy {
  return {
    uid: 9000 + x * 7 + y,
    kind,
    x,
    y,
    hp,
    maxHp: hp,
    flash: 0,
    slow: 0,
    slowTo: 1,
    fireflyCd: 0,
    timer: 99,
    mode: 0,
    tier: 0,
    vx: 0,
    vy: 0,
  };
}

/** seconds초 동안 돌리면서 일어난 일을 모은다. 레벨업과 강화권은 첫 선택지로 넘긴다. */
function advance(sim: Sim, seconds: number, moveX = 0, moveY = 0): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < Math.round(seconds / STEP); i += 1) {
    while (sim.state.pendingTickets > 0) sim.useTicket(sim.ticketChoices()[0]);
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

  it('후반에는 같은 적이 더 아프게 때린다', () => {
    const hit = (t: number): number => {
      const sim = newSim();
      sim.state.t = t;
      sim.state.weapons = {};
      sim.state.surgeIndex = SURGES.length;
      sim.state.midBosses = MID_BOSS_COUNT;
      sim.state.finalBoss = true;
      sim.state.enemies.push(enemy('brute', 2, 0, 9999));
      sim.step(STEP, 0, 0);
      return 100 - sim.state.player.hp;
    };
    expect(hit(0)).toBe(ENEMIES.brute.damage);
    expect(hit(RUN_SECONDS)).toBeGreaterThan(ENEMIES.brute.damage);
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

  it('빛화살은 가장 튼튼한 적을 겨누고 그 사이의 적을 모두 꿰뚫는다', () => {
    const sim = newSim();
    sim.state.weapons = { lance: 1 };
    sim.state.cd.lance = 0;
    sim.state.spawnDebt = -100;
    sim.state.enemies.push(
      enemy('brute', 40, 0, 300),
      enemy('brute', 70, 0, 300),
      enemy('brute', 100, 0, 900),
      enemy('brute', 0, 60, 300),
    );
    advance(sim, 0.7);
    const [first, second, toughest, aside] = sim.state.enemies;
    expect(first.hp).toBeLessThan(300);
    expect(second.hp).toBeLessThan(300);
    expect(toughest.hp).toBeLessThan(900);
    expect(aside.hp).toBe(300);
  });

  it('등잔 기름은 서 있던 자리에 불길을 남기고, 그 위의 적만 태운다', () => {
    const sim = newSim();
    sim.state.weapons = { oil: 1 };
    sim.state.cd.oil = 0;
    sim.state.spawnDebt = -100;
    sim.state.enemies.push(enemy('brute', 10, 0, 500), enemy('brute', 90, 0, 500));
    sim.state.player.hp = 1e9;
    sim.step(STEP, 0, 0);
    expect(sim.state.fires).toHaveLength(1);
    const [near, far] = sim.state.enemies;
    expect(near.hp).toBeLessThan(500);
    expect(far.hp).toBe(500);

    // 걸어서 떠나도 불길은 제자리에 남는다.
    const fire = sim.state.fires[0];
    advance(sim, 1, 1, 0);
    expect(sim.state.fires[0]).toBe(fire);
    expect(fire.x).toBe(0);
    expect(sim.state.player.x).toBeGreaterThan(50);
  });

  it('제자리에 서 있어도 불길이 겹쳐 쌓이지 않고, 시간이 지나면 꺼진다', () => {
    const sim = newSim();
    sim.state.weapons = { oil: 1 };
    sim.state.cd.oil = 0;
    sim.state.spawnDebt = -1000;
    advance(sim, 8);
    expect(sim.state.fires).toHaveLength(1);
    sim.state.weapons = {};
    advance(sim, 4);
    expect(sim.state.fires).toHaveLength(0);
  });

  it('번갯불은 가까이 모인 적들을 차례로 치고, 멀리 떨어진 적에게는 튀지 않는다', () => {
    const sim = newSim();
    sim.state.weapons = { bolt: 1 };
    sim.state.cd.bolt = 0;
    sim.state.spawnDebt = -100;
    sim.state.enemies.push(
      enemy('brute', 50, 0, 500),
      enemy('brute', 80, 0, 500),
      enemy('brute', 110, 0, 500),
      enemy('brute', 140, 0, 500),
      enemy('brute', 0, -200, 500),
    );
    sim.step(STEP, 0, 0);
    const bolt = sim.events.find((e) => e.type === 'bolt');
    // 플레이어에서 시작해 세 마리를 친다: 점 네 개
    expect(bolt).toMatchObject({ type: 'bolt', evolved: false });
    expect(bolt?.type === 'bolt' && bolt.points.length).toBe(8);
    expect(sim.state.enemies.map((e) => e.hp < 500)).toEqual([true, true, true, false, false]);
  });

  it('진화한 무기는 다른 모습으로 나간다', () => {
    const sim = newSim();
    sim.state.weapons = { ember: EVOLVE_LEVEL, lance: EVOLVE_LEVEL };
    sim.state.cd.ember = 0;
    sim.state.cd.lance = 0;
    sim.state.spawnDebt = -100;
    sim.state.enemies.push(enemy('brute', 60, 0, 5000));
    sim.step(STEP, 0, 0);
    const looks = sim.state.shots.map((shot) => shot.look);
    expect(looks.filter((look) => look === 'emberEvo')).toHaveLength(4);
    expect(looks.filter((look) => look === 'lanceEvo')).toHaveLength(3);
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
  it('2분마다 중간 보스가 점점 강해져서 나오고, 10분에는 마지막 보스가 나온다', () => {
    const state = createRun(config);
    state.surgeIndex = SURGES.length;
    const sim = newSim(1, state);
    sim.state.weapons = {};
    sim.state.player.hp = 1e9;
    expect(MID_BOSS_COUNT).toBe(4);

    for (let n = 0; n < MID_BOSS_COUNT; n += 1) {
      sim.state.t = (n + 1) * MID_BOSS_EVERY - 0.01;
      sim.step(STEP, 0, 0);
      expect(sim.events).toContainEqual({ type: 'boss', kind: 'giant' });
      sim.step(STEP, 0, 0);
      const giants = sim.state.enemies.filter((e) => e.kind === 'giant');
      expect(giants).toHaveLength(n + 1);
      expect(giants[n]).toMatchObject({ tier: n, hp: MID_BOSS_TIERS[n].hp, maxHp: MID_BOSS_TIERS[n].hp });
    }

    sim.state.t = RUN_SECONDS - 0.01;
    sim.step(STEP, 0, 0);
    expect(sim.events).toContainEqual({ type: 'boss', kind: 'lord' });
    // 마지막 보스와 함께 중간 보스가 또 나오지는 않는다.
    sim.step(STEP, 0, 0);
    expect(sim.state.enemies.filter((e) => e.kind === 'giant')).toHaveLength(MID_BOSS_COUNT);
    expect(sim.state.enemies.filter((e) => e.kind === 'lord')).toHaveLength(1);
  });

  it('중간 보스를 잡으면 무기 강화권을 받고, 고를 때까지 멈춘다', () => {
    const sim = newSim();
    sim.state.weapons = { ember: 2, aura: 1 };
    sim.state.spawnDebt = -100;
    sim.state.enemies.push(enemy('giant', 30, 0, 1));
    const events: SimEvent[] = [];
    for (let i = 0; i < 120 && sim.state.pendingTickets === 0; i += 1) {
      sim.step(STEP, 0, 0);
      events.push(...sim.events);
    }
    expect(events).toContainEqual({ type: 'ticket' });
    expect(sim.state.pendingTickets).toBe(1);
    expect(sim.state.bossKills).toBe(1);

    const t = sim.state.t;
    sim.step(STEP, 1, 0);
    expect(sim.state.t).toBe(t);

    // 가진 무기만, 한 레벨씩 올릴 수 있다.
    const choices = sim.ticketChoices();
    expect(choices).toEqual([
      { type: 'weapon', id: 'ember', level: 3 },
      { type: 'weapon', id: 'aura', level: 2 },
    ]);
    sim.useTicket(choices[1]);
    expect(sim.state.weapons).toEqual({ ember: 2, aura: 2 });
    expect(sim.state.pendingTickets).toBe(0);
    sim.step(STEP, 1, 0);
    expect(sim.state.t).toBeGreaterThan(t);
  });

  it('5레벨 무기에 강화권을 쓰면 진화하고, 다 진화했으면 회복이나 불씨를 받는다', () => {
    const sim = newSim();
    sim.state.weapons = { ember: MAX_LEVEL };
    sim.state.pendingTickets = 2;
    sim.useTicket(sim.ticketChoices()[0]);
    expect(sim.state.weapons.ember).toBe(EVOLVE_LEVEL);
    expect(sim.ticketChoices().map((u) => u.type)).toEqual(['heal', 'embers']);
    sim.useTicket(sim.ticketChoices()[1]);
    expect(sim.state.pendingTickets).toBe(0);
    expect(sim.summary().bonusEmbers).toBeGreaterThan(0);
  });

  it('마지막 보스를 쓰러뜨리면 완주다', () => {
    const sim = newSim();
    sim.state.t = RUN_SECONDS + 5;
    sim.state.midBosses = MID_BOSS_COUNT;
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
    expect(looksLikeRun({ version: 2 })).toBe(false);
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
