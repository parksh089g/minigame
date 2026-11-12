import { describe, expect, it } from 'vitest';
import { playRun } from './bot';
import {
  ENEMIES,
  EVOLVE_LEVEL,
  HERO_ORDER,
  HEROES,
  MAX_DEPTH,
  MAX_LEVEL,
  MAX_WEAPONS,
  META,
  META_ORDER,
  MID_BOSS_COUNT,
  MID_BOSS_EVERY,
  MID_BOSS_TIERS,
  RUN_SECONDS,
  STAGE_ORDER,
  STAGES,
  SURGES,
  type EnemyKind,
} from './data';
import {
  depthRules,
  embersFor,
  maxAlive,
  midBossKind,
  scoreFor,
  seededRandom,
  speedScale,
  xpToNext,
  type Upgrade,
} from './rules';
import {
  AIM_LOCK_SECONDS,
  CHARGE_SECONDS,
  CHARGING,
  createRun,
  dashOf,
  HOP_REST,
  HOP_SECONDS,
  looksLikeRun,
  restoreRun,
  RUN_STATE_VERSION,
  Sim,
  type Enemy,
  type RunState,
  type SimEvent,
} from './sim';
import { inPuddle, PUDDLE_SLOW, puddleInCell } from './terrain';

const config = { viewW: 240, viewH: 520, meta: {} };
const STEP = 1 / 60;
/** 기본 캐릭터(등불지기)의 최대 체력 */
const BASE_HP = 100 + (HEROES.keeper.trait.maxHp ?? 0);

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

/** 적이 저절로 나오지 않고 무기도 없는 판. 한 가지 동작만 떼어 볼 때 쓴다. */
function quietSim(seed = 1, extra: Partial<Parameters<typeof createRun>[0]> = {}): Sim {
  const sim = newSim(seed, createRun({ ...config, ...extra }));
  sim.state.weapons = {};
  sim.state.spawnDebt = -1e6;
  sim.state.surgeIndex = SURGES.length;
  sim.state.midBosses = MID_BOSS_COUNT;
  sim.state.finalBoss = true;
  return sim;
}

describe('한 판의 시작', () => {
  it('불씨탄 하나만 들고 가득 찬 체력으로 시작한다', () => {
    const state = createRun({ ...config, meta: { vigor: 2 } });
    expect(state.weapons).toEqual({ ember: 1 });
    expect(state.player.hp).toBe(BASE_HP + 20);
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
      return BASE_HP - sim.state.player.hp;
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
    expect(sim.state.player.hp).toBe(BASE_HP - ENEMIES.brute.damage);
    advance(sim, 0.3);
    expect(sim.state.player.hp).toBe(BASE_HP - ENEMIES.brute.damage);
    advance(sim, 0.4);
    expect(sim.state.player.hp).toBe(BASE_HP - ENEMIES.brute.damage * 2);
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
    expect(sim.maxHp).toBe(BASE_HP + 20);
    expect(sim.state.player.hp).toBe(70);
    expect(sim.summary().bonusEmbers).toBeGreaterThan(0);
    sim.applyUpgrade({ type: 'heal' });
    expect(sim.state.player.hp).toBe(100);
  });

  it('회복 떡을 주우면 체력이 최대를 넘지 않게 찬다', () => {
    const sim = newSim();
    sim.state.spawnDebt = -100;
    sim.state.player.hp = BASE_HP - 5;
    sim.state.gems.push({ x: 3, y: 0, value: 15, kind: 'heal', pulled: false });
    sim.step(STEP, 0, 0);
    expect(sim.events).toContainEqual({ type: 'heal' });
    expect(sim.state.player.hp).toBe(BASE_HP);
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

    const bosses = (): Enemy[] => sim.state.enemies.filter((e) => ENEMIES[e.kind].boss);
    for (let n = 0; n < MID_BOSS_COUNT; n += 1) {
      sim.state.t = (n + 1) * MID_BOSS_EVERY - 0.01;
      sim.step(STEP, 0, 0);
      // 어떤 보스가 나올지는 스테이지가 정한다.
      const kind = midBossKind('meadow', n);
      expect(sim.events).toContainEqual({ type: 'boss', kind });
      expect(bosses()).toHaveLength(n + 1);
      expect(bosses()[n]).toMatchObject({ kind, tier: n, hp: MID_BOSS_TIERS[n].hp, maxHp: MID_BOSS_TIERS[n].hp });
      // 다음 보스를 기다리는 동안 앞의 보스가 부하를 부르거나 움직이지 않게 재워 둔다.
      for (const boss of bosses()) boss.timer = 1e9;
    }

    sim.state.t = RUN_SECONDS - 0.01;
    sim.step(STEP, 0, 0);
    expect(sim.events).toContainEqual({ type: 'boss', kind: 'lord' });
    // 마지막 보스와 함께 중간 보스가 또 나오지는 않는다.
    sim.step(STEP, 0, 0);
    expect(bosses()).toHaveLength(MID_BOSS_COUNT + 1);
    expect(sim.state.enemies.filter((e) => e.kind === 'lord')).toHaveLength(1);
  });

  it('중간 보스는 한 가지가 아니고, 스테이지마다 차례가 다르다', () => {
    for (const id of STAGE_ORDER) {
      const kinds = Array.from({ length: MID_BOSS_COUNT }, (_, n) => midBossKind(id, n));
      expect(STAGES[id].midBosses).toHaveLength(MID_BOSS_COUNT);
      expect(new Set(kinds).size).toBeGreaterThanOrEqual(3);
      for (const kind of kinds) {
        expect(ENEMIES[kind].boss).toBe(true);
        expect(ENEMIES[kind].brain).toBeDefined();
      }
      expect(ENEMIES[STAGES[id].finalBoss].hp).toBeGreaterThan(MID_BOSS_TIERS[MID_BOSS_COUNT - 1].hp);
    }
    expect(STAGES.meadow.midBosses).not.toEqual(STAGES.marsh.midBosses);
    expect(STAGES.meadow.finalBoss).not.toBe(STAGES.marsh.finalBoss);
  });

  it('뿔그림자는 멈춰서 힘을 모았다가 그때 본 쪽으로 내달린다', () => {
    const sim = quietSim();
    sim.state.player.hp = 1e9;
    const ram = enemy('ram', 0, -90, 9999);
    ram.timer = 0.01;
    sim.state.enemies.push(ram);
    sim.step(STEP, 0, 0);
    expect(ram.mode).toBe(1);
    expect(sim.events).toContainEqual({ type: 'windup' });
    const still = ram.y;
    advance(sim, 0.3);
    expect(ram.y).toBe(still);
    expect(advance(sim, 0.35)).toContainEqual({ type: 'dash' });
    expect(ram.mode).toBe(2);
    // 내달리는 동안에는 플레이어보다 빠르다.
    const before = ram.y;
    advance(sim, 0.5);
    expect((ram.y - before) / 0.5).toBeGreaterThan(62);
    advance(sim, 0.4);
    expect(ram.mode).toBe(0);
  });

  it('돌진하는 보스가 겨눈 쪽은 끝자락에 굳어서, 그 뒤에 옆으로 비키면 맞지 않는다', () => {
    for (const kind of ['ram', 'lord'] as const) {
      const sim = quietSim();
      const p = sim.state.player;
      const boss = enemy(kind, 0, -90, 99999);
      boss.timer = 0.01;
      sim.state.enemies.push(boss);
      sim.step(STEP, 0, 0);
      const dash = dashOf(kind, boss.tier);
      // 겨누는 동안에는 플레이어를 따라온다.
      p.x = 40;
      advance(sim, dash.windup - AIM_LOCK_SECONDS - 0.1);
      expect(boss.mode).toBe(1);
      expect(boss.vx).toBeGreaterThan(0.3);
      // 굳기 직전에 선 자리가 겨눈 자리가 된다.
      p.x = 0;
      advance(sim, 0.08);
      expect(boss.vx).toBeCloseTo(0, 5);
      expect(boss.vy).toBeCloseTo(1, 5);
      // 굳은 뒤에 옆으로 비킨다. 보스는 겨눈 쪽으로만 달려서 닿지 않는다.
      advance(sim, 0.06);
      expect(boss.timer).toBeLessThan(AIM_LOCK_SECONDS);
      p.x = 40;
      const events = advance(sim, AIM_LOCK_SECONDS + dash.seconds - 0.1);
      expect(events).toContainEqual({ type: 'dash' });
      expect(boss.vx).toBeCloseTo(0, 5);
      expect(Math.abs(boss.x)).toBeLessThan(1);
      expect(boss.y).toBeGreaterThan(-20);
      expect(events).not.toContainEqual({ type: 'hurt' });
      expect(p.hp).toBe(BASE_HP);
      // 내달리는 길이는 화면에 그리는 예고선의 길이와 같다.
      expect(dash.speed * dash.seconds).toBeGreaterThan(70);
    }
  });

  it('안개 올빼미는 빛을 모았다가 플레이어 쪽으로 빛덩이를 부채꼴로 쏘고, 맞으면 다친다', () => {
    const sim = quietSim();
    const owl = enemy('owl', 0, -80, 9999);
    owl.timer = 0.01;
    sim.state.enemies.push(owl);
    sim.step(STEP, 0, 0);
    // 바로 쏘지 않고 먼저 멈춰서 빛을 모은다.
    expect(sim.events).toContainEqual({ type: 'charge' });
    expect(owl.mode).toBe(CHARGING);
    expect(sim.state.hazards).toHaveLength(0);
    const still = owl.y;
    const quiet = advance(sim, CHARGE_SECONDS - 0.05);
    expect(quiet).not.toContainEqual({ type: 'volley' });
    expect(owl.y).toBe(still);
    expect(advance(sim, 0.1)).toContainEqual({ type: 'volley' });
    expect(owl.mode).toBe(0);
    expect(sim.state.hazards).toHaveLength(3);
    // 가운데 것은 플레이어를 똑바로 향한다.
    const middle = sim.state.hazards[1];
    expect(middle.vx).toBeCloseTo(0, 5);
    expect(middle.vy).toBeGreaterThan(0);

    owl.timer = 1e9;
    owl.y = -400;
    const events = advance(sim, 1.6);
    expect(events).toContainEqual({ type: 'hurt' });
    expect(sim.state.player.hp).toBe(BASE_HP - middle.damage);
    // 빗나간 것은 얼마 뒤 사라진다.
    advance(sim, 3);
    expect(sim.state.hazards).toHaveLength(0);

    // 뒤에 나오는 올빼미는 갈래가 더 많다.
    owl.tier = 3;
    owl.timer = 0.01;
    advance(sim, CHARGE_SECONDS + 0.05);
    expect(sim.state.hazards).toHaveLength(5);
  });

  it('스테이지마다 제 마지막 보스를 쓰러뜨려야 새벽이 온다', () => {
    for (const id of STAGE_ORDER) {
      const sim = quietSim(1, { stage: id });
      sim.state.weapons = { ember: 1 };
      sim.state.enemies.push(enemy(STAGES[id].finalBoss, 30, 0, 1));
      const events = advance(sim, 2);
      expect(sim.state.over).toBe('cleared');
      expect(events).not.toContainEqual({ type: 'ticket' });
    }
    // 다른 스테이지의 마지막 보스를 잡는 것으로는 끝나지 않는다.
    const sim = quietSim(1, { stage: 'marsh' });
    sim.state.weapons = { ember: 1 };
    sim.state.enemies.push(enemy(STAGES.meadow.finalBoss, 30, 0, 1));
    advance(sim, 2);
    expect(sim.state.over).toBeNull();
  });

  it('늪의 어미는 사방으로 쏘기와 부하 부르기를 번갈아 한다', () => {
    const sim = quietSim();
    sim.state.stage = 'marsh';
    sim.state.player.hp = 1e9;
    const matron = enemy('matron', 0, -200, 99999);
    matron.timer = 0.01;
    matron.tier = MID_BOSS_COUNT - 1;
    sim.state.enemies.push(matron);
    // 쏘기 전에는 빛을 모은다.
    sim.step(STEP, 0, 0);
    expect(sim.events).toContainEqual({ type: 'charge' });
    expect(sim.state.hazards).toHaveLength(0);
    expect(advance(sim, CHARGE_SECONDS + 0.05)).toContainEqual({ type: 'volley' });
    expect(sim.state.hazards).toHaveLength(12);
    // 부하는 모으는 틈 없이 바로 부른다.
    matron.timer = 0.01;
    sim.step(STEP, 0, 0);
    expect(sim.events).not.toContainEqual({ type: 'charge' });
    const minions = sim.state.enemies.filter((e) => e !== matron);
    expect(minions).toHaveLength(5);
    for (const minion of minions) expect(STAGES.marsh.minions).toContain(minion.kind);
    // 그다음은 다시 쏘기
    matron.timer = 0.01;
    sim.step(STEP, 0, 0);
    expect(sim.events).toContainEqual({ type: 'charge' });
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

  it('마지막 보스가 나타난 뒤에 쓰러뜨린 그림자는 점수와 불씨에 세지 않는다', () => {
    const state = createRun(config);
    state.t = RUN_SECONDS - 0.01;
    state.midBosses = MID_BOSS_COUNT;
    state.surgeIndex = SURGES.length;
    state.kills = 500;
    const sim = newSim(1, state);
    sim.step(STEP, 0, 0);
    expect(sim.state.finalBoss).toBe(true);
    const atBoss = sim.summary();
    expect(atBoss).toMatchObject({ kills: 500, countedKills: 500 });

    // 보스는 멀리 두고 둘레의 그림자만 쓰러뜨린다.
    for (let i = 0; i < 6; i += 1) sim.state.enemies.push(enemy('shade', 14 + i * 6, 10, 1));
    advance(sim, 2);
    const later = sim.summary();
    expect(sim.state.over).toBeNull();
    expect(later.kills).toBeGreaterThan(500);
    expect(later.countedKills).toBe(500);
    expect(later.bossKills).toBe(0);
    expect(scoreFor(later)).toBe(scoreFor(atBoss));
    expect(embersFor(later)).toBe(embersFor(atBoss));
  });

  it('마지막 보스가 나타나기 전에는 쓰러뜨린 것을 모두 센다', () => {
    const sim = newSim();
    sim.state.enemies.push(enemy('shade', 30, 0, 1));
    advance(sim, 1.5);
    const summary = sim.summary();
    expect(summary.kills).toBeGreaterThan(0);
    expect(summary.countedKills).toBe(summary.kills);
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

describe('캐릭터', () => {
  it('저마다 시작 무기와 타고난 특성이 다르다', () => {
    const starts = HERO_ORDER.map((id) => Object.keys(createRun({ ...config, hero: id }).weapons)[0]);
    expect(new Set(starts).size).toBe(HERO_ORDER.length);
    for (const id of HERO_ORDER) {
      const state = createRun({ ...config, hero: id });
      expect(state.hero).toBe(id);
      expect(state.weapons).toEqual({ [HEROES[id].weapon]: 1 });
      expect(state.player.hp).toBe(100 + (HEROES[id].trait.maxHp ?? 0));
    }
    // 처음부터 쓸 수 있는 캐릭터와 스테이지가 하나씩은 있다.
    expect(HEROES[HERO_ORDER[0]].unlockSeconds).toBe(0);
    expect(STAGES[STAGE_ORDER[0]].unlockSeconds).toBe(0);
  });

  it('번개잡이는 등불지기보다 빨리 걷는다', () => {
    const walk = (hero: 'keeper' | 'stormer'): number => {
      const sim = quietSim(1, { hero });
      advance(sim, 1, 1, 0);
      return sim.state.player.x;
    };
    expect(walk('stormer')).toBeCloseTo(walk('keeper') * (HEROES.stormer.trait.speed ?? 1), 1);
  });

  it('별지기는 같은 빛 조각으로 경험치를 더 얻는다', () => {
    const gain = (hero: 'keeper' | 'stargazer'): number => {
      const sim = quietSim(1, { hero });
      sim.state.gems.push({ x: 2, y: 0, value: 10, kind: 'xp', pulled: false });
      sim.step(STEP, 0, 0);
      return sim.state.player.xp + (sim.state.player.level - 1) * 1000;
    };
    expect(gain('stargazer')).toBeGreaterThan(gain('keeper'));
  });
});

describe('안개 늪', () => {
  it('늪에서는 늪의 적만 나온다', () => {
    const sim = newSim(4, createRun({ ...config, stage: 'marsh' }));
    sim.state.weapons = {};
    sim.state.player.hp = 1e9;
    sim.state.midBosses = MID_BOSS_COUNT;
    sim.state.finalBoss = true;
    sim.state.t = 200;
    advance(sim, 6);
    const allowed = new Set<EnemyKind>(STAGES.marsh.spawns.map((row) => row.kind));
    expect(sim.state.enemies.length).toBeGreaterThan(10);
    for (const e of sim.state.enemies) expect(allowed.has(e.kind)).toBe(true);
  });

  it('웅덩이는 씨앗이 같으면 늘 같은 자리에 있고, 출발 지점에는 없다', () => {
    expect(puddleInCell(0, 0, 7)).toBeNull();
    let found = 0;
    for (let cx = -6; cx <= 6; cx += 1) {
      for (let cy = -6; cy <= 6; cy += 1) {
        const puddle = puddleInCell(cx, cy, 7);
        expect(puddleInCell(cx, cy, 7)).toEqual(puddle);
        if (!puddle) continue;
        found += 1;
        expect(inPuddle(puddle.x, puddle.y, 7)).toBe(true);
        expect(inPuddle(puddle.x + puddle.rx + 1, puddle.y, 7)).toBe(false);
      }
    }
    // 절반쯤의 칸에 웅덩이가 있다.
    expect(found).toBeGreaterThan(169 * 0.4);
    expect(found).toBeLessThan(169 * 0.8);
    expect(inPuddle(0, 0, 7)).toBe(false);
  });

  it('웅덩이에 빠지면 느려지고, 풀밭에는 웅덩이가 없다', () => {
    const seed = 7;
    let spot: { x: number; y: number } | null = null;
    for (let cx = 1; cx < 9 && !spot; cx += 1) spot = puddleInCell(cx, 0, seed);
    expect(spot).not.toBeNull();
    const walk = (stage: 'meadow' | 'marsh'): number => {
      const sim = quietSim(1, { stage, seed });
      sim.state.player.x = spot!.x;
      sim.state.player.y = spot!.y;
      sim.step(STEP, 1, 0);
      expect(sim.state.player.wading).toBe(stage === 'marsh');
      return sim.state.player.x - spot!.x;
    };
    expect(walk('marsh')).toBeCloseTo(walk('meadow') * PUDDLE_SLOW, 5);
  });

  it('늪두꺼비는 웅크렸다가 한 번에 뛰고, 길게 보면 플레이어보다 느리다', () => {
    const sim = quietSim();
    sim.state.stage = 'marsh';
    sim.state.player.hp = 1e9;
    const toad = enemy('toad', 0, -120, 9999);
    toad.timer = 0.2;
    sim.state.enemies.push(toad);
    advance(sim, 0.15);
    expect(toad.y).toBe(-120);
    advance(sim, 0.1);
    expect(toad.mode).toBe(1);
    advance(sim, HOP_SECONDS);
    expect(toad.y).toBeGreaterThan(-120 + ENEMIES.toad.speed * HOP_SECONDS * 0.8);
    expect(toad.mode).toBe(0);

    const pace = (ENEMIES.toad.speed * speedScale(RUN_SECONDS) * HOP_SECONDS) / (HOP_SECONDS + HOP_REST);
    expect(pace).toBeLessThan(62);
  });
});

describe('깊은 밤', () => {
  it('단계가 깊으면 같은 적이 더 튼튼하게 나온다', () => {
    const firstEnemyHp = (depth: number): number => {
      const sim = newSim(1, createRun({ ...config, depth }));
      sim.state.weapons = {};
      while (sim.state.enemies.length === 0) sim.step(STEP, 0, 0);
      return sim.state.enemies[0].maxHp;
    };
    expect(firstEnemyHp(0)).toBe(ENEMIES.shade.hp);
    expect(firstEnemyHp(3)).toBe(Math.round(ENEMIES.shade.hp * depthRules(3).hp));
  });

  it('단계가 깊으면 적도 보스도 빛덩이도 더 아프게 때린다', () => {
    const hit = (depth: number, kind: Enemy['kind']): number => {
      const sim = quietSim(1, { depth });
      sim.state.enemies.push(enemy(kind, 2, 0, 9999));
      sim.step(STEP, 0, 0);
      return BASE_HP - sim.state.player.hp;
    };
    expect(hit(0, 'brute')).toBe(ENEMIES.brute.damage);
    expect(hit(4, 'brute')).toBe(Math.round(ENEMIES.brute.damage * depthRules(4).damage));
    expect(hit(0, 'giant')).toBe(ENEMIES.giant.damage);
    expect(hit(4, 'giant')).toBe(Math.round(ENEMIES.giant.damage * depthRules(4).damage));

    const volley = (depth: number): number => {
      const sim = quietSim(1, { depth });
      const owl = enemy('owl', 0, -80, 9999);
      owl.timer = 0.01;
      sim.state.enemies.push(owl);
      advance(sim, CHARGE_SECONDS + 0.1);
      return sim.state.hazards[0].damage;
    };
    expect(volley(4)).toBe(Math.round(volley(0) * depthRules(4).damage));
  });

  it('단계가 깊으면 중간 보스와 마지막 보스의 체력이 늘어난다', () => {
    const bossHp = (depth: number, t: number): number => {
      const state = createRun({ ...config, depth });
      state.surgeIndex = SURGES.length;
      state.t = t - 0.01;
      state.midBosses = t >= RUN_SECONDS ? MID_BOSS_COUNT : 0;
      const sim = newSim(1, state);
      sim.state.weapons = {};
      sim.step(STEP, 0, 0);
      const boss = sim.state.enemies.find((e) => ENEMIES[e.kind].boss);
      return boss ? boss.maxHp : 0;
    };
    expect(bossHp(0, MID_BOSS_EVERY)).toBe(MID_BOSS_TIERS[0].hp);
    expect(bossHp(2, MID_BOSS_EVERY)).toBe(Math.round(MID_BOSS_TIERS[0].hp * depthRules(2).bossHp));
    expect(bossHp(0, RUN_SECONDS)).toBe(ENEMIES.lord.hp);
    expect(bossHp(2, RUN_SECONDS)).toBe(Math.round(ENEMIES.lord.hp * depthRules(2).bossHp));
  });

  it('판의 요약에 단계가 실리고, 단계 없이 저장된 예전 판은 보통 밤으로 이어진다', () => {
    expect(newSim(1, createRun({ ...config, depth: 3 })).summary().depth).toBe(3);
    expect(newSim(1, createRun({ ...config, depth: 99 })).summary().depth).toBe(MAX_DEPTH);
    const old = JSON.parse(JSON.stringify(createRun(config))) as RunState;
    delete old.depth;
    expect(looksLikeRun(old)).toBe(true);
    const sim = newSim(1, old);
    expect(sim.summary().depth).toBe(0);
    expect(sim.depth).toEqual(depthRules(0));
  });

  it('영구 강화를 다 올려도 가장 깊은 밤에서는 보통 밤보다 훨씬 일찍 쓰러진다', () => {
    const upgrades = Object.fromEntries(META_ORDER.map((id) => [id, META[id].maxLevel]));
    const survived = (depth: number): number =>
      [1, 2].reduce((sum, seed) => sum + playRun(seed, 'kite', { ...config, meta: upgrades, depth }).seconds, 0);
    expect(survived(MAX_DEPTH)).toBeLessThan(survived(0) * 0.8);
  }, 30000);
});

describe('영구 강화', () => {
  it('따뜻한 품은 체력을 천천히 채운다', () => {
    const sim = quietSim(1, { meta: { mend: 3 } });
    sim.state.player.hp = 50;
    advance(sim, 10);
    expect(sim.state.player.hp).toBeCloseTo(53, 1);
    sim.state.player.hp = sim.maxHp - 0.01;
    advance(sim, 5);
    expect(sim.state.player.hp).toBe(sim.maxHp);
  });

  it('되살림 등불이 있으면 쓰러져도 한 번은 다시 일어난다', () => {
    const sim = quietSim(1, { meta: { second: 1 } });
    expect(sim.state.revives).toBe(1);
    sim.state.player.hp = 1;
    sim.state.enemies.push(enemy('brute', 2, 0, 30), enemy('brute', 200, 0, 30));
    sim.state.hazards.push({ x: 90, y: 0, vx: 0, vy: 0, life: 9, radius: 3, damage: 5 });
    sim.step(STEP, 0, 0);
    expect(sim.events).toContainEqual({ type: 'revive' });
    expect(sim.state.over).toBeNull();
    expect(sim.state.revives).toBe(0);
    expect(sim.state.player.hp).toBe(Math.round(sim.maxHp * 0.5));
    // 둘레의 적은 밀려나 쓰러지고, 먼 적은 그대로다. 날아오던 빛덩이도 사라진다.
    expect(sim.state.enemies).toHaveLength(1);
    expect(sim.state.enemies[0].x).toBeGreaterThan(190);
    expect(sim.state.hazards).toHaveLength(0);

    // 두 번째에는 판이 끝난다.
    sim.state.player.hp = 1;
    sim.state.player.inv = 0;
    sim.state.enemies.push(enemy('brute', 2, 0, 9999));
    sim.step(STEP, 0, 0);
    expect(sim.state.over).toBe('dead');
  });

  it('질긴 가죽은 받는 피해를 줄인다', () => {
    const hit = (armor: number): number => {
      const sim = quietSim(1, { meta: { armor } });
      sim.state.enemies.push(enemy('brute', 2, 0, 9999));
      sim.step(STEP, 0, 0);
      return BASE_HP - sim.state.player.hp;
    };
    expect(hit(0)).toBe(ENEMIES.brute.damage);
    expect(hit(5)).toBeCloseTo(ENEMIES.brute.damage * 0.8, 5);
  });

  it('다시 뽑기는 산 만큼만 쓸 수 있고, 쓰면 선택지가 새로 나온다', () => {
    const none = newSim();
    expect(none.rerolls).toBe(0);
    expect(none.reroll()).toBeNull();

    const sim = newSim(1, createRun({ ...config, meta: { reroll: 2 } }));
    expect(sim.rerolls).toBe(2);
    // 고르기 전에는 몇 번을 물어도 같은 선택지가 나온다. 나갔다 들어와도(저장했다 되돌려도) 그대로다.
    const first = sim.options();
    expect(sim.options()).toEqual(first);
    const resumed = newSim(99, JSON.parse(JSON.stringify(sim.state)) as RunState);
    expect(resumed.options()).toEqual(first);

    const second = sim.reroll();
    expect(second).toHaveLength(3);
    expect(sim.options()).toEqual(second);
    expect(sim.reroll()).toHaveLength(3);
    expect(sim.rerolls).toBe(0);
    expect(sim.reroll()).toBeNull();
    // 고르고 나면 다음 레벨업에는 새로 뽑는다.
    sim.applyUpgrade(sim.options()[0]);
    expect(sim.state.offer).toBeUndefined();
    // 다시 뽑기가 생기기 전에 저장한 판에는 횟수가 없다.
    const old = JSON.parse(JSON.stringify(createRun(config))) as RunState;
    delete old.rerolls;
    expect(newSim(1, old).rerolls).toBe(0);
  });

  it('밝은 출발은 시작하자마자 강화를 그만큼 고르게 한다', () => {
    const sim = newSim(1, createRun({ ...config, meta: { headstart: 2 } }));
    expect(sim.state.player.level).toBe(3);
    expect(sim.state.pendingLevelUps).toBe(2);
    // 고르기 전에는 진행되지 않는다.
    sim.step(STEP, 0, 0);
    expect(sim.state.t).toBe(0);
    sim.applyUpgrade(sim.options()[0]);
    sim.applyUpgrade(sim.options()[0]);
    sim.step(STEP, 0, 0);
    expect(sim.state.t).toBeGreaterThan(0);
  });

  it('되살림 등불이 없으면 그대로 끝난다', () => {
    const sim = quietSim();
    sim.state.player.hp = 1;
    sim.state.enemies.push(enemy('brute', 2, 0, 9999));
    sim.step(STEP, 0, 0);
    expect(sim.state.over).toBe('dead');
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

  it('캐릭터와 스테이지가 없던 예전 저장은 기본값을 채워 이어한다', () => {
    const old = JSON.parse(JSON.stringify(createRun(config))) as Record<string, unknown>;
    old.version = 2;
    delete old.hero;
    delete old.stage;
    delete old.seed;
    delete old.hazards;
    delete old.revives;
    delete (old.player as Record<string, unknown>).wading;
    expect(looksLikeRun(old)).toBe(false);

    const restored = restoreRun(old);
    expect(restored).toMatchObject({ version: RUN_STATE_VERSION, hero: 'keeper', stage: 'meadow', hazards: [], revives: 0 });
    expect(restored && looksLikeRun(restored)).toBe(true);
    // 되살린 판은 그대로 돌아간다.
    const sim = newSim(3, restored as RunState);
    advance(sim, 2, 1, 0);
    expect(sim.state.t).toBeCloseTo(2, 1);

    expect(restoreRun(createRun(config))).not.toBeNull();
    expect(restoreRun(null)).toBeNull();
    expect(restoreRun({ version: 1 })).toBeNull();
    expect(restoreRun({ ...old, over: 'dead' })).toBeNull();
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

  it('어느 캐릭터로 어느 스테이지에 가도 피하면서 싸우면 2분 30초는 버틴다', () => {
    for (const stage of STAGE_ORDER) {
      for (const hero of HERO_ORDER) {
        const result = playRun(2, 'kite', { ...config, hero, stage, seed: 2 }, 150);
        expect(result.over, `${hero} @ ${stage}`).toBeNull();
        expect(result.level, `${hero} @ ${stage}`).toBeGreaterThan(4);
      }
    }
  });

  it('피하면서 싸우면 서 있을 때보다 훨씬 오래 버틴다', () => {
    const result = playRun(2, 'kite', config, 240);
    expect(result.seconds).toBeGreaterThan(150);
    expect(result.level).toBeGreaterThan(5);
  });

  it('영구 강화를 다 올리면 중간 보스를 모두 잡고, 받은 강화권으로 무기가 진화한다', () => {
    const result = playRun(1, 'kite', { ...config, meta: { vigor: 5, swift: 5, might: 5, greed: 5, reach: 3 } }, 600);
    expect(result.bossKills).toBeGreaterThanOrEqual(MID_BOSS_COUNT);
    const levels = Object.values(result.weapons);
    expect(levels.length).toBeLessThanOrEqual(MAX_WEAPONS);
    expect(levels.filter((level) => level === EVOLVE_LEVEL).length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...levels)).toBe(EVOLVE_LEVEL);
  }, 20000);

  it('적의 수가 상한을 크게 넘지 않는다', () => {
    const result = playRun(4, 'kite', { ...config, meta: { vigor: 5, might: 5, swift: 5 } }, 400);
    expect(result.peakEnemies).toBeLessThanOrEqual(maxAlive(RUN_SECONDS) + 80);
  });
});
