import { describe, expect, it } from 'vitest';
import { playRun, steer } from './bot';
import {
  BOON_ORDER,
  BOON_VALUES,
  CHEST,
  CHILL_SLOW,
  ELITE,
  ENDLESS,
  ENEMIES,
  EVOLVE_LEVEL,
  FEAST,
  FEAST_LEVELS,
  FEAST_ORDER,
  FLINT,
  GLIDE,
  GUARD,
  HERO_ORDER,
  HEROES,
  MAX_DEPTH,
  MAX_LEVEL,
  MAX_PASSIVES,
  MAX_WEAPONS,
  PASSIVES,
  META,
  META_ORDER,
  MID_BOSS_COUNT,
  MID_BOSS_EVERY,
  MID_BOSS_TIERS,
  PLAYER_BASE,
  POSTS,
  QUAKE,
  RUN_SECONDS,
  SPROUT,
  STAGE_ORDER,
  STAGES,
  SURGES,
  WEAPON_ORDER,
  type EnemyKind,
  type FeastId,
  type PassiveId,
} from './data';
import {
  beamStats,
  bellStats,
  depthRules,
  embersFor,
  endlessBossKind,
  maxAlive,
  midBossKind,
  modifiers,
  moonStats,
  scoreFor,
  seededRandom,
  speedScale,
  xpToNext,
  type Upgrade,
} from './rules';
import {
  AIM_LOCK_SECONDS,
  BEAM_REHIT,
  BLIZZARD,
  BLIZZARD_FIRING,
  CHARGE_SECONDS,
  CHARGING,
  createRun,
  dashOf,
  HOP_REST,
  HOP_SECONDS,
  inQuakeGap,
  looksLikeRun,
  restoreRun,
  RUN_STATE_VERSION,
  runDawned,
  Sim,
  WARDEN_CHARGING,
  WARDEN_REST,
  quakeCrosses,
  type Enemy,
  type Quake,
  type RunState,
  type SimEvent,
} from './sim';
import { dailyPlan } from './daily';
import {
  GUST,
  gustAt,
  gustDirection,
  inPuddle,
  LEAP,
  PUDDLE_SLOW,
  puddleInCell,
  shroomAt,
  shroomInCell,
  type Shroom,
  VENT,
  ventAt,
  ventClock,
  ventInCell,
  ventPhase,
  type Vent,
} from './terrain';

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

/** seconds초 동안 돌리면서 일어난 일을 모은다. 레벨업과 강화권, 밤의 축복은 첫 선택지로 넘긴다. */
function advance(sim: Sim, seconds: number, moveX = 0, moveY = 0): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < Math.round(seconds / STEP); i += 1) {
    while (sim.pendingBoons > 0) sim.takeBoon(sim.boonChoices()[0]);
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
  sim.state.elites = ELITE.times.length;
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

  it('종소리는 둘레의 적을 한 번씩 때리고 바깥으로 밀어내며, 멀리 있는 적에게는 닿지 않는다', () => {
    const ring = (weapons: RunState['weapons']): Sim => {
      const sim = quietSim();
      sim.state.weapons = weapons;
      sim.state.cd.bell = 0;
      sim.state.enemies.push(enemy('brute', 30, 0, 500), enemy('brute', 200, 0, 500));
      return sim;
    };
    const sim = ring({ bell: 1 });
    const events = advance(sim, 0.6);
    expect(events.filter((e) => e.type === 'bell')).toEqual([{ type: 'bell', evolved: false }]);
    const [near, far] = sim.state.enemies;
    expect(near.hp).toBe(500 - bellStats(1, modifiers({}, {})).damage);
    expect(far.hp).toBe(500);
    // 다 퍼진 고리는 사라진다.
    expect(sim.state.waves).toHaveLength(0);
    // 종이 없을 때보다 밀려난 만큼 멀리 있다.
    const calm = ring({});
    advance(calm, 0.6);
    expect(near.x - calm.state.enemies[0].x).toBeGreaterThan(10);
    expect(far.x).toBeCloseTo(calm.state.enemies[1].x, 5);
  });

  it('종소리는 둘레에 아무도 없으면 울리지 않고, 보스는 밀려나지 않는다', () => {
    const sim = quietSim();
    sim.state.weapons = { bell: 1 };
    sim.state.cd.bell = 0;
    sim.state.enemies.push(enemy('brute', 200, 0, 500));
    expect(advance(sim, 1).some((e) => e.type === 'bell')).toBe(false);
    expect(sim.state.waves).toHaveLength(0);

    const boss = enemy('giant', 30, 0, 5000);
    sim.state.enemies = [boss];
    advance(sim, 0.6);
    expect(boss.hp).toBeLessThan(5000);
    expect(boss.kx ?? 0).toBe(0);
    expect(boss.ky ?? 0).toBe(0);
  });

  it('새벽 종은 두 번 울리고, 닿은 적이 굼떠진다', () => {
    const sim = quietSim();
    sim.state.weapons = { bell: EVOLVE_LEVEL };
    sim.state.cd.bell = 0;
    const foe = enemy('brute', 30, 0, 5000);
    sim.state.enemies.push(foe);
    sim.step(STEP, 0, 0);
    expect(sim.events).toContainEqual({ type: 'bell', evolved: true });
    expect(sim.state.waves).toHaveLength(2);
    advance(sim, 0.2);
    const once = 5000 - foe.hp;
    expect(once).toBeGreaterThan(0);
    expect(foe.slow).toBeGreaterThan(0);
    expect(foe.slowTo).toBeLessThan(1);
    advance(sim, 0.7);
    expect(5000 - foe.hp).toBeCloseTo(once * 2);
  });

  it('초승달은 가까운 적 쪽으로 날아갔다 돌아오며 가는 길과 오는 길에 한 번씩 벤다', () => {
    const sim = quietSim();
    sim.state.weapons = { moon: 1 };
    sim.state.cd.moon = 0;
    const foe = enemy('brute', 40, 0, 500);
    sim.state.enemies.push(foe, enemy('brute', 0, 300, 500));
    sim.step(STEP, 0, 0);
    expect(sim.state.moons).toHaveLength(1);
    expect(sim.state.moons[0]).toMatchObject({ dx: 1, dy: 0, back: false, evolved: false });
    // 적을 지나쳐 더 멀리까지 날아간다.
    let farthest = 0;
    let turnedAt = 0;
    for (let i = 0; i < 120 && sim.state.moons.length > 0; i += 1) {
      sim.step(STEP, 0, 0);
      const moon = sim.state.moons[0];
      if (moon) farthest = Math.max(farthest, moon.x);
      if (moon?.back && turnedAt === 0) turnedAt = 500 - foe.hp;
    }
    expect(farthest).toBeGreaterThan(60);
    // 돌아서기 전에 한 번, 돌아오면서 한 번
    const cut = moonStats(1, modifiers({}, {})).damage;
    expect(turnedAt).toBe(cut);
    expect(foe.hp).toBe(500 - cut * 2);
    // 손에 돌아오면 사라지고, 멀리 있는 적은 겨누지 않는다.
    expect(sim.state.moons).toHaveLength(0);
    expect(sim.state.enemies[1].hp).toBe(500);
  });

  it('초승달은 플레이어가 움직여도 따라와서 돌아오고, 겨눌 적이 없으면 던지지 않는다', () => {
    const sim = quietSim();
    sim.state.weapons = { moon: 1 };
    sim.state.cd.moon = 0;
    advance(sim, 0.5);
    expect(sim.state.moons).toHaveLength(0);
    sim.state.enemies.push(enemy('brute', 40, 0, 500));
    sim.step(STEP, 0, 0);
    expect(sim.state.moons).toHaveLength(1);
    // 던진 쪽의 반대로 달아나도 따라잡는다.
    sim.state.cd.moon = 99;
    advance(sim, 3.5, -1, 0);
    expect(sim.state.moons).toHaveLength(0);
  });

  it('보름달은 셋이 날아가고, 지나는 동안 같은 적을 거듭 벤다', () => {
    const sim = quietSim();
    sim.state.weapons = { moon: EVOLVE_LEVEL };
    sim.state.cd.moon = 0;
    const foe = enemy('brute', 40, 0, 5000);
    sim.state.enemies.push(foe);
    sim.step(STEP, 0, 0);
    expect(sim.state.moons).toHaveLength(3);
    expect(sim.state.moons.every((moon) => moon.evolved && moon.rehit > 0)).toBe(true);
    const each = sim.state.moons[0].damage;
    sim.state.cd.moon = 99;
    advance(sim, 3);
    expect(sim.state.moons).toHaveLength(0);
    // 가운데 달 하나만으로도 두 번보다 많이 벤다.
    expect(5000 - foe.hp).toBeGreaterThan(each * 2);
  });

  it('등대빛은 둘레를 돌며 빛줄기에 닿은 적을 한 바퀴에 한 번씩 훑는다', () => {
    const sim = quietSim();
    sim.state.weapons = { beam: 1 };
    sim.state.player.hp = 1e9;
    const stats = beamStats(1, modifiers({}, {}));
    const lap = (Math.PI * 2) / stats.spin;
    // 빛줄기는 오른쪽을 가리키며 시작한다. 가까운 적은 바로 맞고, 닿지 않는 곳의 적은 맞지 않는다.
    const near = enemy('brute', 30, 0, 5000);
    const far = enemy('brute', 0, 300, 5000);
    sim.state.enemies.push(near, far);
    sim.step(STEP, 0, 0);
    expect(5000 - near.hp).toBe(stats.damage);
    // 지나가는 동안 거듭 맞지 않고, 한 바퀴를 돌아와야 다시 맞는다.
    advance(sim, lap * 0.8);
    expect(5000 - near.hp).toBe(stats.damage);
    advance(sim, lap * 0.4);
    expect(5000 - near.hp).toBe(stats.damage * 2);
    expect(far.hp).toBe(5000);
    expect(sim.state.dealt?.beam).toBe(stats.damage * 2);
    expect(BEAM_REHIT).toBeLessThan(lap / 3);
  });

  it('등대빛은 4레벨에 맞은편에도 한 줄기가 서고, 진화하면 셋이 더 멀리까지 훑는다', () => {
    const hits = (level: number, distance: number): number => {
      const sim = quietSim();
      sim.state.weapons = { beam: level };
      sim.state.player.hp = 1e9;
      const stats = beamStats(level, modifiers({}, {}));
      // 제자리에 묶어 둔 적 하나를 한 바퀴 동안 몇 번 훑는지 센다.
      const foe = { ...enemy('brute', 0, distance, 1e6), slow: 1e9, slowTo: 0.0001 };
      sim.state.enemies.push(foe);
      advance(sim, (Math.PI * 2) / stats.spin - STEP);
      return Math.round((1e6 - foe.hp) / stats.damage);
    };
    expect(hits(1, 30)).toBe(1);
    expect(hits(4, 30)).toBe(2);
    expect(hits(EVOLVE_LEVEL, 30)).toBe(3);
    // 보통 등대빛이 닿지 않는 곳도 진화하면 닿는다.
    const reach = beamStats(MAX_LEVEL, modifiers({}, {})).length + ENEMIES.brute.radius + 4;
    expect(hits(MAX_LEVEL, reach)).toBe(0);
    expect(hits(EVOLVE_LEVEL, reach)).toBe(3);
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

describe('드물게 떨어지는 것', () => {
  /** 쓰러진 적이 무엇을 떨어뜨릴지 정하는 난수를 roll로 고정한 조용한 판 */
  const dropWith = (roll: number): string[] => {
    const sim = new Sim(quietSim().state, () => roll);
    sim.state.enemies.push(enemy('shade', 100, 0, 0));
    sim.step(STEP, 0, 0);
    return sim.state.gems.map((gem) => gem.kind);
  };

  it('그림자는 아주 가끔 회복 떡이나 자석이나 불꽃 단지를 떨어뜨린다', () => {
    expect(dropWith(0.001)).toEqual(['xp', 'heal']);
    expect(dropWith(0.0085)).toEqual(['xp', 'pull']);
    expect(dropWith(0.0095)).toEqual(['xp', 'blast']);
    expect(dropWith(0.5)).toEqual(['xp']);

    // 셋을 다 합쳐도 백에 하나를 조금 넘는 정도라서, 떨어지면 반가운 일이 된다.
    const sim = quietSim(4);
    const kills = 20000;
    const seen: Record<string, number> = {};
    for (let i = 0; i < kills; i += 1) {
      sim.state.enemies.push(enemy('shade', 9000, 0, 0));
      sim.state.gems.length = 0;
      sim.step(STEP, 0, 0);
      for (const gem of sim.state.gems) seen[gem.kind] = (seen[gem.kind] ?? 0) + 1;
    }
    expect(seen.pull).toBeGreaterThan(5);
    expect(seen.blast).toBeGreaterThan(5);
    expect(seen.pull + seen.blast).toBeLessThan(kills * 0.005);
    expect(seen.heal).toBeGreaterThan(seen.pull);
  });

  it('자석을 주우면 멀리 있는 빛 조각까지 모두 끌려온다', () => {
    const sim = quietSim();
    sim.state.gems.push(
      { x: 3, y: 0, value: 0, kind: 'pull', pulled: false },
      { x: 600, y: 0, value: 1, kind: 'xp', pulled: false },
      { x: -500, y: 400, value: 1, kind: 'xp', pulled: false },
      { x: 300, y: 0, value: 15, kind: 'heal', pulled: false },
    );
    sim.step(STEP, 0, 0);
    expect(sim.events).toContainEqual({ type: 'pull' });
    // 빛 조각만 끌려오고, 회복 떡은 필요할 때 주우러 갈 수 있게 그 자리에 남는다.
    expect(sim.state.gems.map((gem) => [gem.kind, gem.pulled])).toEqual([
      ['xp', true],
      ['xp', true],
      ['heal', false],
    ]);
    const before = sim.state.player.xp;
    advance(sim, 6);
    expect(sim.state.gems.map((gem) => gem.kind)).toEqual(['heal']);
    expect(sim.state.player.xp + (sim.state.player.level - 1) * 100).toBeGreaterThan(before);
  });

  it('불꽃 단지를 주우면 화면 안의 그림자가 모두 쓰러지고, 보스는 조금만 다친다', () => {
    const sim = quietSim();
    const near = enemy('brute', 100, 200, 500);
    const edge = enemy('wisp', -115, -250, 30);
    const far = enemy('brute', 400, 0, 500);
    const boss = enemy('giant', 60, 0, 1000);
    sim.state.enemies.push(near, edge, far, boss);
    sim.state.gems.push({ x: 3, y: 0, value: 0, kind: 'blast', pulled: false });
    sim.step(STEP, 0, 0);
    expect(sim.events).toContainEqual({ type: 'blast' });
    expect(near.hp).toBeLessThanOrEqual(0);
    expect(edge.hp).toBeLessThanOrEqual(0);
    expect(far.hp).toBe(500);
    expect(boss.hp).toBeGreaterThan(800);
    expect(boss.hp).toBeLessThan(1000);

    // 쓰러진 그림자는 다음 걸음에 치워지면서 쓰러뜨린 수에 들어가고 빛 조각을 남긴다.
    const kills = sim.state.kills;
    sim.step(STEP, 0, 0);
    expect(sim.state.kills).toBe(kills + 2);
    expect(sim.state.enemies).toHaveLength(2);
    expect(sim.state.gems.filter((gem) => gem.kind === 'xp').length).toBe(2);
    // 무기가 한 일이 아니므로 무기별 피해에는 들어가지 않는다.
    expect(sim.state.dealt).toEqual({});
  });
});

describe('등갓', () => {
  const guarded = (): Sim => {
    const sim = quietSim();
    sim.applyUpgrade({ type: 'passive', id: 'hood', level: 1 });
    return sim;
  };

  it('빛막이 피해를 한 번 막고, 다시 생길 때까지는 그대로 맞는다', () => {
    const sim = guarded();
    expect(sim.guardReady).toBe(true);
    expect(sim.guardCharge).toBe(1);
    sim.state.enemies.push(enemy('brute', 2, 0, 9999));
    sim.step(STEP, 0, 0);
    expect(sim.events).toContainEqual({ type: 'block' });
    expect(sim.events).not.toContainEqual({ type: 'hurt' });
    expect(sim.state.player.hp).toBe(BASE_HP);
    expect(sim.guardReady).toBe(false);
    expect(sim.guardCharge).toBeLessThan(0.01);

    // 막은 뒤에도 잠깐은 무적이지만, 빛막이 없는 동안에는 다시 닿으면 다친다.
    const events = advance(sim, 2);
    expect(events).toContainEqual({ type: 'hurt' });
    expect(events).not.toContainEqual({ type: 'block' });
    expect(sim.state.player.hp).toBeLessThan(BASE_HP);
  });

  it('빛막은 시간이 지나면 다시 생긴다', () => {
    const sim = guarded();
    sim.state.enemies.push(enemy('brute', 2, 0, 9999));
    sim.step(STEP, 0, 0);
    sim.state.enemies.length = 0;
    advance(sim, GUARD.seconds / 2);
    expect(sim.guardReady).toBe(false);
    expect(sim.guardCharge).toBeCloseTo(0.5, 1);
    advance(sim, GUARD.seconds / 2 + 0.1);
    expect(sim.guardReady).toBe(true);

    const hp = sim.state.player.hp;
    sim.state.enemies.push(enemy('brute', 2, 0, 9999));
    sim.step(STEP, 0, 0);
    expect(sim.events).toContainEqual({ type: 'block' });
    expect(sim.state.player.hp).toBe(hp);
  });

  it('등갓이 없으면 빛막도 없고, 등갓이 생기기 전에 저장한 판도 그대로 이어진다', () => {
    const plain = quietSim();
    expect(plain.guardReady).toBe(false);
    expect(plain.guardCharge).toBe(0);
    plain.state.enemies.push(enemy('brute', 2, 0, 9999));
    plain.step(STEP, 0, 0);
    expect(plain.events).toContainEqual({ type: 'hurt' });

    const old = JSON.parse(JSON.stringify(createRun(config))) as RunState;
    delete old.player.guard;
    const sim = newSim(1, old);
    expect(sim.guardReady).toBe(false);
    sim.applyUpgrade({ type: 'passive', id: 'hood', level: 1 });
    expect(sim.guardReady).toBe(true);
    // 깨진 빛막도 저장했다가 이어하면 남은 시간이 그대로다.
    sim.state.player.guard = 7;
    const resumed = newSim(2, JSON.parse(JSON.stringify(sim.state)) as RunState);
    expect(resumed.guardReady).toBe(false);
    expect(resumed.state.player.guard).toBe(7);
  });

  it('패시브 칸이 다 찬 뒤에는 저장돼 있던 선택지에 새 패시브가 있어도 다시 뽑는다', () => {
    const sim = newSim();
    const all = Object.keys(PASSIVES) as PassiveId[];
    for (const id of all.slice(0, MAX_PASSIVES)) sim.state.passives[id] = 1;
    const extra = all[MAX_PASSIVES];
    sim.state.offer = [{ type: 'passive', id: extra, level: 1 }];
    const options = sim.options();
    expect(options.some((option) => option.type === 'passive' && option.id === extra)).toBe(false);
    // 든 패시브를 올리는 선택지는 그대로 둔다.
    const kept: Upgrade[] = [{ type: 'passive', id: all[0], level: 2 }];
    sim.state.offer = kept;
    expect(sim.options()).toEqual(kept);
  });
});

describe('약초 주머니와 부싯돌', () => {
  it('약초 주머니는 체력을 천천히 채우고, 최대 체력을 넘기지 않는다', () => {
    const sim = quietSim();
    sim.applyUpgrade({ type: 'passive', id: 'herb', level: 1 });
    sim.applyUpgrade({ type: 'passive', id: 'herb', level: 2 });
    sim.state.player.hp = 50;
    advance(sim, 10);
    expect(sim.state.player.hp).toBeCloseTo(54, 1);
    sim.state.player.hp = sim.maxHp - 0.01;
    advance(sim, 5);
    expect(sim.state.player.hp).toBe(sim.maxHp);
  });

  /** 난수가 늘 0이라 부싯돌이 반드시 터지는 판 */
  const sparky = (level: number): Sim => {
    const state = createRun(config);
    const sim = new Sim(state, () => 0);
    state.weapons = {};
    state.spawnDebt = -1e6;
    state.surgeIndex = SURGES.length;
    state.midBosses = MID_BOSS_COUNT;
    state.finalBoss = true;
    for (let i = 1; i <= level; i += 1) sim.applyUpgrade({ type: 'passive', id: 'flint', level: i });
    return sim;
  };

  it('부싯돌이 있으면 쓰러진 그림자가 터져서 둘레의 그림자가 다친다', () => {
    const sim = sparky(1);
    const near = enemy('brute', 110, 0, 500);
    const far = enemy('brute', 160, 0, 500);
    const fallen = enemy('shade', 100, 0, 0);
    fallen.maxHp = 20;
    sim.state.enemies.push(fallen, near, far);
    sim.step(STEP, 0, 0);
    expect(sim.events).toContainEqual({ type: 'spark', x: 100, y: 0, radius: expect.any(Number) });
    expect(near.hp).toBe(500 - (FLINT.damage + FLINT.share * 20));
    expect(far.hp).toBe(500);
    expect(sim.state.kills).toBe(1);
  });

  it('튼튼한 그림자일수록 세게 터진다', () => {
    const lost = (maxHp: number): number => {
      const sim = sparky(1);
      const near = enemy('brute', 110, 0, 5000);
      const fallen = enemy('brute', 100, 0, 0);
      fallen.maxHp = maxHp;
      sim.state.enemies.push(fallen, near);
      sim.step(STEP, 0, 0);
      return 5000 - near.hp;
    };
    expect(lost(200)).toBeGreaterThan(lost(20) * 3);
  });

  it('부싯돌로 쓰러진 그림자는 다시 터지지 않고, 그 자리에서 바로 치워진다', () => {
    const sim = sparky(MAX_LEVEL);
    // 한 줄로 늘어선 약한 그림자: 연달아 터진다면 끝까지 다 쓰러진다.
    sim.state.enemies.push(
      enemy('shade', 100, 0, 0),
      enemy('shade', 115, 0, 1),
      enemy('shade', 130, 0, 1),
      enemy('shade', 145, 0, 1),
    );
    sim.step(STEP, 0, 0);
    expect(sim.events.filter((e) => e.type === 'spark')).toHaveLength(1);
    expect(sim.state.kills).toBe(2);
    expect(sim.state.enemies.map((e) => e.hp)).toEqual([1, 1]);
  });

  it('부싯돌이 없으면 터지지 않고, 난수도 더 뽑지 않는다', () => {
    let calls = 0;
    const state = createRun(config);
    const sim = new Sim(state, () => {
      calls += 1;
      return 0.5;
    });
    state.weapons = {};
    state.spawnDebt = -1e6;
    state.surgeIndex = SURGES.length;
    state.midBosses = MID_BOSS_COUNT;
    state.finalBoss = true;
    sim.step(STEP, 0, 0);
    const before = calls;
    state.enemies.push(enemy('shade', 100, 0, 0), enemy('brute', 110, 0, 500));
    sim.step(STEP, 0, 0);
    expect(sim.events.some((e) => e.type === 'spark')).toBe(false);
    expect(state.enemies[0].hp).toBe(500);
    // 무엇을 떨어뜨릴지 정하는 한 번뿐이다.
    expect(calls - before).toBe(1);
  });
});

describe('쫓아오기만 하지 않는 적', () => {
  const distanceTo = (sim: Sim, e: Enemy): number => Math.hypot(e.x - sim.state.player.x, e.y - sim.state.player.y);
  /** type인 일이 일어날 때까지 돌린다. limit초 안에 일어나지 않으면 false */
  const until = (sim: Sim, type: SimEvent['type'], limit = 12, moveX = 0, moveY = 0): boolean => {
    for (let i = 0; i < limit / STEP; i += 1) {
      sim.step(STEP, moveX, moveY);
      if (sim.events.some((event) => event.type === type)) return true;
    }
    return false;
  };

  it('눈총 그림자는 멀찍이 멈춰 서서 숨을 들이쉬었다가 어둠 방울을 쏜다', () => {
    const sim = quietSim();
    const foe = enemy('glare', 160, 0, 9999);
    foe.timer = 0;
    sim.state.enemies.push(foe);
    const shot = ENEMIES.glare.shoots!;
    expect(until(sim, 'spit')).toBe(true);
    // 닿는 거리까지만 다가오고, 더 붙지 않는다.
    expect(distanceTo(sim, foe)).toBeGreaterThan(shot.range - 4);
    expect(distanceTo(sim, foe)).toBeLessThanOrEqual(shot.range);
    // 방울은 플레이어 쪽으로, 걷는 것보다 느리게 날아온다.
    expect(sim.state.hazards).toHaveLength(1);
    const [orb] = sim.state.hazards;
    expect(orb.vx).toBeLessThan(0);
    expect(orb.vy).toBeCloseTo(0, 5);
    expect(Math.hypot(orb.vx, orb.vy)).toBeLessThan(PLAYER_BASE.speed);
    // 가만히 서 있으면 맞는다.
    expect(until(sim, 'hurt', 3)).toBe(true);
    expect(sim.state.player.hp).toBe(BASE_HP - shot.damage);
  });

  it('쏜 뒤에 옆으로 비키면 방울에 맞지 않는다', () => {
    const sim = quietSim();
    const foe = enemy('glare', 120, 0, 9999);
    foe.timer = 0;
    sim.state.enemies.push(foe);
    expect(until(sim, 'spit')).toBe(true);
    expect(advance(sim, 2.4, 0, 1)).not.toContainEqual({ type: 'hurt' });
    expect(sim.state.player.hp).toBe(BASE_HP);
  });

  it('숨을 들이쉬는 동안에는 멈춰 있고, 그 틈에 쓰러뜨리면 쏘지 못한다', () => {
    const sim = quietSim();
    const foe = enemy('glare', 60, 0, 9999);
    foe.timer = 0;
    sim.state.enemies.push(foe);
    sim.step(STEP, 0, 0);
    expect(foe.mode).toBe(1);
    const at = foe.x;
    advance(sim, ENEMIES.glare.shoots!.windup / 2);
    expect(foe.x).toBe(at);
    expect(sim.state.hazards).toHaveLength(0);
    foe.hp = 0;
    expect(advance(sim, 2)).not.toContainEqual({ type: 'spit' });
  });

  it('날아다니는 것이 많으면 쏘는 적은 쉬어 간다', () => {
    const sim = quietSim();
    for (let i = 0; i < 6; i += 1) {
      sim.state.hazards.push({ x: 5000, y: i * 20, vx: 0, vy: 0, life: 99, radius: 3, damage: 1 });
    }
    for (let i = 0; i < 6; i += 1) {
      const foe = enemy('squirt', 70, i * 14 - 35, 9999);
      foe.timer = 0;
      sim.state.enemies.push(foe);
    }
    expect(advance(sim, 3)).not.toContainEqual({ type: 'spit' });
    sim.state.hazards.length = 0;
    expect(until(sim, 'spit', 3)).toBe(true);
  });

  it('쏘는 적은 싸움터에 정해진 수까지만 있고, 그만큼 있으면 더 나오지 않는다', () => {
    /** 4분부터 1분 동안 적이 저절로 나오게 두고, 그동안 가장 많았던 눈총 그림자의 수를 센다 */
    const mostShooters = (placed: number): number => {
      const sim = quietSim(7);
      sim.state.t = 240;
      sim.state.spawnDebt = 0;
      sim.state.player.hp = 1e9;
      for (let i = 0; i < placed; i += 1) sim.state.enemies.push(enemy('glare', 200, i * 30 - 45, 9999));
      let most = 0;
      for (let i = 0; i < 60 / STEP; i += 1) {
        sim.step(STEP, 0, 0);
        most = Math.max(most, sim.state.enemies.filter((e) => e.kind === 'glare').length);
      }
      // 다른 적은 평소처럼 나온다.
      expect(sim.state.enemies.length).toBeGreaterThan(100);
      return most;
    };
    const limit = ENEMIES.glare.shoots!.limit;
    // 비어 있으면 나오되, 쓰러뜨리지 않고 두어도 정해진 수를 넘지 않는다.
    const alone = mostShooters(0);
    expect(alone).toBeGreaterThan(0);
    expect(alone).toBeLessThanOrEqual(limit);
    // 이미 그만큼 있으면 더 나오지 않는다.
    expect(mostShooters(limit)).toBe(limit);
  });

  it('부푼 그림자는 가까이 와서 부풀었다가 터지고, 그 자리에 서 있으면 다친다', () => {
    const sim = quietSim();
    const foe = enemy('puff', 70, 0, 9999);
    sim.state.enemies.push(foe);
    const info = ENEMIES.puff.bursts!;
    for (let i = 0; i < 600 && foe.mode === 0; i += 1) sim.step(STEP, 0, 0);
    // 닿기 전에 멈춰서 부푼다.
    expect(foe.mode).toBe(1);
    expect(distanceTo(sim, foe)).toBeGreaterThan(ENEMIES.puff.radius + PLAYER_BASE.radius);
    expect(sim.state.player.hp).toBe(BASE_HP);
    const at = foe.x;
    advance(sim, info.fuse / 2);
    expect(foe.x).toBe(at);
    expect(until(sim, 'burst', info.fuse)).toBe(true);
    expect(sim.events).toContainEqual({ type: 'burst', x: foe.x, y: foe.y, radius: info.radius });
    expect(sim.events).toContainEqual({ type: 'hurt' });
    expect(sim.state.player.hp).toBe(BASE_HP - info.damage);
    // 터진 것은 여느 적처럼 쓰러진 것으로 치고 빛 조각을 남긴다.
    sim.step(STEP, 0, 0);
    expect(sim.state.enemies).toHaveLength(0);
    expect(sim.state.kills).toBe(1);
    expect(sim.state.gems).toHaveLength(1);
  });

  it('부푸는 동안 둘레 밖으로 나가면 다치지 않는다', () => {
    const sim = quietSim();
    const foe = enemy('spore', 60, 0, 9999);
    sim.state.enemies.push(foe);
    for (let i = 0; i < 600 && foe.mode === 0; i += 1) sim.step(STEP, 0, 0);
    expect(foe.mode).toBe(1);
    expect(until(sim, 'burst', 2, -1, 0)).toBe(true);
    expect(sim.events).not.toContainEqual({ type: 'hurt' });
    expect(sim.state.player.hp).toBe(BASE_HP);
    expect(distanceTo(sim, foe)).toBeGreaterThan(ENEMIES.spore.bursts!.radius + PLAYER_BASE.radius);
  });

  it('터지면 둘레의 다른 그림자도 함께 다치고, 부푸는 동안 쓰러뜨리면 터지지 않는다', () => {
    const sim = quietSim();
    sim.state.player.hp = 1e9;
    const info = ENEMIES.puff.bursts!;
    const foe = enemy('puff', 20, 0, 9999);
    const beside = enemy('brute', 36, 12, 500);
    const away = enemy('brute', 20, info.radius + 40, 500);
    sim.state.enemies.push(foe, beside, away);
    expect(until(sim, 'burst', 3)).toBe(true);
    expect(beside.hp).toBe(500 - info.splash);
    expect(away.hp).toBe(500);

    const calm = quietSim();
    const dud = enemy('puff', 20, 0, 9999);
    calm.state.enemies.push(dud);
    calm.step(STEP, 0, 0);
    expect(dud.mode).toBe(1);
    dud.hp = 0;
    expect(advance(calm, 2)).not.toContainEqual(expect.objectContaining({ type: 'burst' }));
    expect(calm.state.player.hp).toBe(BASE_HP);
  });

  it('자동 플레이는 부풀고 있는 적의 둘레 밖으로 걸어 나간다', () => {
    const sim = quietSim();
    const foe = enemy('puff', 18, 0, 9999);
    foe.mode = 1;
    foe.timer = 5;
    sim.state.enemies.push(foe);
    const reach = ENEMIES.puff.bursts!.radius + PLAYER_BASE.radius;
    for (let i = 0; i < 90 && distanceTo(sim, foe) <= reach; i += 1) {
      const [x, y] = steer(sim);
      sim.step(STEP, x, y);
    }
    expect(distanceTo(sim, foe)).toBeGreaterThan(reach);
    expect(sim.state.player.x).toBeLessThan(0);
  });

  it('스테이지마다 쏘는 적과 터지는 적이 하나씩 있고, 처음부터 나오지는 않는다', () => {
    for (const id of STAGE_ORDER) {
      const rows = STAGES[id].spawns;
      const shooters = rows.filter((row) => ENEMIES[row.kind].shoots);
      const bursters = rows.filter((row) => ENEMIES[row.kind].bursts);
      expect(shooters).toHaveLength(1);
      expect(bursters).toHaveLength(1);
      // 쫓아오는 적에 익숙해진 뒤에 나오고, 무리의 대부분은 여전히 쫓아오는 적이다.
      expect(shooters[0].from).toBeGreaterThanOrEqual(90);
      expect(bursters[0].from).toBeGreaterThan(shooters[0].from);
      const total = rows.reduce((sum, row) => sum + row.weight, 0);
      expect((shooters[0].weight + bursters[0].weight) / total).toBeLessThan(0.15);
    }
  });
});

describe('등불 기둥', () => {
  /** 플레이어 바로 옆에 켜지 않은 기둥 하나만 서 있는 조용한 판. 때가 되어 저절로 나오는 기둥은 없다. */
  const besidePost = (): Sim => {
    const sim = quietSim();
    sim.state.player.hp = 1e9;
    sim.state.postsSpawned = POSTS.times.length;
    sim.state.posts = [{ x: 8, y: 0, lit: 0, tick: 0 }];
    return sim;
  };

  it('정해진 시각마다 플레이어 가까이에 하나씩 나타난다', () => {
    const sim = quietSim();
    sim.state.t = POSTS.times[0] - 0.05;
    const appeared = advance(sim, 0.2);
    expect(sim.state.posts).toHaveLength(1);
    const [post] = sim.state.posts!;
    expect(appeared).toContainEqual({ type: 'post', x: post.x, y: post.y, first: true });
    const distance = Math.hypot(post.x - sim.state.player.x, post.y - sim.state.player.y);
    // 화면 안에 보이지만, 걸어가야 닿는 거리다.
    expect(distance).toBeGreaterThanOrEqual(POSTS.near);
    expect(distance).toBeLessThanOrEqual(POSTS.far);
    expect(distance).toBeLessThan(config.viewW / 2);
    expect(post.lit).toBe(0);
    // 다음 시각이 되기 전에는 더 나오지 않는다.
    expect(advance(sim, 5)).not.toContainEqual(expect.objectContaining({ type: 'post' }));
    sim.state.t = POSTS.times[1] - 0.05;
    expect(advance(sim, 0.2)).toContainEqual(expect.objectContaining({ type: 'post', first: false }));
    expect(sim.state.posts).toHaveLength(2);
  });

  it('닿으면 불이 켜지고, 켜져 있는 동안 둘레의 그림자를 태우고 느리게 한다', () => {
    const sim = besidePost();
    const inside = enemy('brute', 30, 0, 1000);
    const outside = enemy('brute', 8, 130, 1000);
    sim.state.enemies.push(inside, outside);
    sim.step(STEP, 0, 0);
    expect(sim.events).toContainEqual({ type: 'light', x: 8, y: 0 });
    expect(sim.state.posts![0].lit).toBeGreaterThan(POSTS.seconds - 0.1);
    advance(sim, 1);
    expect(inside.hp).toBeLessThanOrEqual(1000 * (1 - 2 * POSTS.burn));
    expect(inside.slow).toBeGreaterThan(0);
    expect(inside.slowTo).toBeLessThanOrEqual(POSTS.slow);
    expect(outside.hp).toBe(1000);
    expect(outside.slow).toBeLessThanOrEqual(0);
    // 무기가 한 일이 아니므로 무기별 피해에는 들어가지 않는다.
    expect(sim.state.dealt).toEqual({});
  });

  it('빛 속의 보통 그림자는 체력이 얼마든 3초 안에 쓰러지고, 보스는 조금만 잃는다', () => {
    const sim = besidePost();
    const tough = enemy('brute', 24, 0, 50000);
    const boss = enemy('giant', 30, 12, 10000);
    sim.state.enemies.push(tough, boss);
    advance(sim, 3);
    expect(sim.state.kills).toBe(1);
    expect(sim.state.enemies).toEqual([boss]);
    // 다 타면 기둥이 사라진다. 보스는 끝까지 빛 속에 있어도 열에 하나쯤만 잃는다.
    const events = advance(sim, POSTS.seconds - 2.9);
    expect(events).toContainEqual({ type: 'dim', x: 8, y: 0 });
    expect(sim.state.posts).toHaveLength(0);
    expect(boss.hp).toBeLessThan(10000);
    expect(boss.hp).toBeGreaterThan(10000 * 0.88);
  });

  it('켜지 않은 기둥은 아껴 둘 수 있고, 너무 쌓이면 가장 오래된 것부터 사라진다', () => {
    const sim = quietSim();
    sim.state.postsSpawned = 1;
    sim.state.posts = [1000, 2000, 3000].map((x) => ({ x, y: 0, lit: 0, tick: 0 }));
    // 오래 두어도 꺼지거나 사라지지 않는다.
    sim.state.t = POSTS.times[0] + 1;
    advance(sim, 20);
    expect(sim.state.posts!.map((post) => post.x)).toEqual([1000, 2000, 3000]);
    sim.state.t = POSTS.times[1] - 0.05;
    advance(sim, 0.2);
    expect(sim.state.posts).toHaveLength(POSTS.keep);
    expect(sim.state.posts!.map((post) => post.x).slice(0, 2)).toEqual([2000, 3000]);
    // 걸어가서 닿으면 그때 켜진다.
    const saved = sim.state.posts![2];
    sim.state.player.x = saved.x;
    sim.state.player.y = saved.y;
    sim.step(STEP, 0, 0);
    expect(saved.lit).toBeGreaterThan(0);
  });

  it('기둥이 생기기 전에 저장한 판을 이어 해도 지난 시각의 기둥이 한꺼번에 나오지 않는다', () => {
    const old = JSON.parse(JSON.stringify(createRun(config))) as RunState;
    delete old.posts;
    delete old.postsSpawned;
    old.t = POSTS.times[2] + 5;
    const sim = newSim(1, old);
    expect(sim.state.posts).toEqual([]);
    expect(sim.state.postsSpawned).toBe(3);
    sim.step(STEP, 0, 0);
    expect(sim.events).not.toContainEqual(expect.objectContaining({ type: 'post' }));
    // 켜진 기둥은 저장했다가 이어 해도 남은 시간이 그대로다.
    sim.state.posts = [{ x: 500, y: 0, lit: 7, tick: 0.2 }];
    const resumed = newSim(2, JSON.parse(JSON.stringify(sim.state)) as RunState);
    expect(resumed.state.posts).toEqual([{ x: 500, y: 0, lit: 7, tick: 0.2 }]);
  });

  it('기둥은 밀물이 오기 전에 나와서 밀물에 대비할 수 있다', () => {
    for (const surge of SURGES) {
      const before = POSTS.times.filter((time) => time < surge && surge - time <= 40);
      expect(before, `밀물 ${surge}초`).toHaveLength(1);
    }
    expect(POSTS.times[0]).toBeLessThan(60);
    expect(POSTS.times[POSTS.times.length - 1]).toBeLessThan(RUN_SECONDS);
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

describe('오늘의 판', () => {
  it('그날의 조건으로 시작하고, 저장했다가 이어도 오늘의 판으로 남는다', () => {
    const plan = dailyPlan(20_769);
    const state = createRun({ ...config, meta: {}, hero: plan.hero, stage: plan.stage, seed: plan.seed, daily: plan.day });
    expect(state).toMatchObject({ hero: plan.hero, stage: plan.stage, seed: plan.seed, daily: plan.day, depth: 0 });
    expect(state.weapons).toEqual({ [HEROES[plan.hero].weapon]: 1 });
    // 영구 강화가 없으니 캐릭터의 타고난 체력 그대로다.
    expect(state.player.hp).toBe(100 + (HEROES[plan.hero].trait.maxHp ?? 0));
    expect(state.revives).toBe(0);
    const restored = restoreRun(JSON.parse(JSON.stringify(state)));
    expect(restored?.daily).toBe(plan.day);
    // 보통 판에는 그 표시가 없다.
    expect('daily' in createRun(config)).toBe(false);
  });

  it('같은 씨앗으로 똑같이 움직이면 판이 똑같이 흘러간다', () => {
    const plan = dailyPlan(20_769);
    const play = (): { kills: number; hp: number; enemies: number; level: number } => {
      const sim = new Sim(
        createRun({ ...config, meta: {}, hero: plan.hero, stage: plan.stage, seed: plan.seed, daily: plan.day }),
        seededRandom(plan.seed),
      );
      sim.state.player.hp = 1e9;
      for (let i = 0; i < Math.round(40 / STEP); i += 1) {
        sim.step(STEP, Math.cos(i / 90), Math.sin(i / 90));
        // 강화는 늘 첫 번째 것을 고른다.
        while (sim.state.pendingLevelUps > 0) sim.applyUpgrade(sim.options()[0]);
      }
      return { kills: sim.state.kills, hp: sim.state.player.hp, enemies: sim.state.enemies.length, level: sim.state.player.level };
    };
    const first = play();
    expect(first.kills).toBeGreaterThan(5);
    expect(play()).toEqual(first);
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

  it('준비 화면에 적힌 숫자는 실제 특성과 같다', () => {
    const percent = (ratio: number): string => `${ratio >= 1 ? '+' : '-'}${Math.round(Math.abs(ratio - 1) * 100)}%`;
    for (const id of HERO_ORDER) {
      const { trait, perk, flaw } = HEROES[id];
      const shown = `${perk} · ${flaw ?? ''}`;
      if (trait.speed) expect(shown).toContain(`이동 ${percent(trait.speed)}`);
      if (trait.cooldown) expect(shown).toContain(`재사용 ${percent(trait.cooldown)}`);
      if (trait.area) expect(shown).toContain(`범위 ${percent(trait.area)}`);
      if (trait.xp) expect(shown).toContain(`경험치 ${percent(trait.xp)}`);
      if (trait.taken) expect(shown).toContain(`받는 피해 ${percent(trait.taken)}`);
      // "받는 피해"와 헷갈리지 않게, 그 글을 뺀 나머지에서 찾는다.
      if (trait.damage) expect(shown.replace(/받는 피해 [+-]\d+%/, '')).toContain(`피해 ${percent(trait.damage)}`);
      if (trait.maxHp) expect(shown).toContain(`최대 체력 ${trait.maxHp > 0 ? '+' : '-'}${Math.abs(trait.maxHp)}`);
    }
  });

  it('종지기는 종소리로 시작하고, 같은 공격에 덜 다친다', () => {
    const hit = (hero: 'keeper' | 'ringer'): number => {
      const sim = quietSim(1, { hero });
      sim.state.weapons = {};
      const before = sim.state.player.hp;
      sim.state.enemies.push(enemy('slag', 2, 0, 1e9));
      sim.step(STEP, 0, 0);
      return before - sim.state.player.hp;
    };
    expect(createRun({ ...config, hero: 'ringer' }).weapons).toEqual({ bell: 1 });
    expect(hit('keeper')).toBe(ENEMIES.slag.damage);
    expect(hit('ringer')).toBeCloseTo(ENEMIES.slag.damage * (HEROES.ringer.trait.taken ?? 1), 5);
    // 가장 튼튼하고, 가장 느리다.
    for (const id of HERO_ORDER) {
      if (id === 'ringer') continue;
      expect(HEROES.ringer.trait.maxHp ?? 0).toBeGreaterThan(HEROES[id].trait.maxHp ?? 0);
      expect(HEROES.ringer.trait.speed ?? 1).toBeLessThan(HEROES[id].trait.speed ?? 1);
    }
  });

  it('달잡이는 초승달로 시작하고, 더 세게 때리지만 같은 공격에 더 다친다', () => {
    const hit = (hero: 'keeper' | 'mooner'): number => {
      const sim = quietSim(1, { hero });
      sim.state.weapons = {};
      const before = sim.state.player.hp;
      sim.state.enemies.push(enemy('slag', 2, 0, 1e9));
      sim.step(STEP, 0, 0);
      return before - sim.state.player.hp;
    };
    /** 같은 무기(불씨탄 1레벨)로 30초 동안 튼튼한 그림자 하나에게 준 피해 */
    const dealt = (hero: 'keeper' | 'mooner'): number => {
      const sim = quietSim(1, { hero });
      sim.state.weapons = { ember: 1 };
      sim.state.player.hp = 1e9;
      sim.state.enemies.push(enemy('slag', 60, 0, 1e9));
      advance(sim, 30);
      return 1e9 - sim.state.enemies[0].hp;
    };
    expect(createRun({ ...config, hero: 'mooner' }).weapons).toEqual({ moon: 1 });
    expect(hit('mooner')).toBeCloseTo(ENEMIES.slag.damage * (HEROES.mooner.trait.taken ?? 1), 5);
    expect(hit('mooner')).toBeGreaterThan(hit('keeper'));
    expect(dealt('mooner') / dealt('keeper')).toBeCloseTo(HEROES.mooner.trait.damage ?? 1, 2);
    // 새벽을 한 번 맞아야 열려서, 가장 늦게 열린다.
    expect(HEROES.mooner.unlockSeconds).toBe(RUN_SECONDS);
    expect(HEROES.mooner.unlockSeconds).toBe(Math.max(...HERO_ORDER.map((id) => HEROES[id].unlockSeconds)));
  });

  it('번개잡이는 손이 잦아서 같은 무기를 더 자주 쓴다', () => {
    const shots = (hero: 'keeper' | 'stormer'): number => {
      const sim = quietSim(1, { hero });
      sim.state.weapons = { ember: 1 };
      sim.state.player.hp = 1e9;
      sim.state.enemies.push(enemy('slag', 60, 0, 1e9));
      return advance(sim, 30).filter((e) => e.type === 'shoot').length;
    };
    const ratio = shots('stormer') / shots('keeper');
    expect(ratio).toBeGreaterThan(1.1);
    expect(ratio).toBeLessThan(1.25);
    // 그 대신 체력이 가장 낮다.
    expect(HEROES.stormer.trait.maxHp ?? 0).toBeLessThan(HEROES.stargazer.trait.maxHp ?? 0);
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
    sim.state.elites = ELITE.times.length;
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

describe('잿빛 고개', () => {
  const seed = 7;
  /** 출발 지점에서 가까운 불구멍 하나 */
  const someVent = (): Vent => {
    for (let cx = 1; cx < 9; cx += 1) {
      const vent = ventInCell(cx, 0, seed);
      if (vent) return vent;
    }
    throw new Error('불구멍이 없다');
  };
  /** 그 불구멍의 박자가 clock초에 와 있는 때의 시각 */
  const timeAt = (vent: Vent, clock: number): number => VENT.period * 3 - vent.offset + clock;

  it('고개에서는 고개의 적만 나온다', () => {
    const sim = newSim(4, createRun({ ...config, stage: 'ridge' }));
    sim.state.weapons = {};
    sim.state.player.hp = 1e9;
    sim.state.midBosses = MID_BOSS_COUNT;
    sim.state.finalBoss = true;
    sim.state.elites = ELITE.times.length;
    sim.state.t = 200;
    advance(sim, 6);
    const allowed = new Set<EnemyKind>(STAGES.ridge.spawns.map((row) => row.kind));
    expect(sim.state.enemies.length).toBeGreaterThan(10);
    for (const e of sim.state.enemies) expect(allowed.has(e.kind)).toBe(true);
  });

  it('불구멍은 씨앗이 같으면 늘 같은 자리에 있고, 출발 지점에는 없다', () => {
    expect(ventInCell(0, 0, seed)).toBeNull();
    let found = 0;
    for (let cx = -6; cx <= 6; cx += 1) {
      for (let cy = -6; cy <= 6; cy += 1) {
        const vent = ventInCell(cx, cy, seed);
        expect(ventInCell(cx, cy, seed)).toEqual(vent);
        if (!vent) continue;
        found += 1;
        expect(ventAt(vent.x, vent.y, seed)).toEqual(vent);
        expect(ventAt(vent.x + vent.rx + 1, vent.y, seed)).toBeNull();
        expect(vent.offset).toBeGreaterThanOrEqual(0);
        expect(vent.offset).toBeLessThan(VENT.period);
      }
    }
    expect(found).toBeGreaterThan(169 * 0.35);
    expect(found).toBeLessThan(169 * 0.7);
    expect(ventAt(0, 0, seed)).toBeNull();
  });

  it('불구멍은 달아올랐다가 솟고, 나머지 동안은 잠잠하다. 불구멍마다 박자가 다르다', () => {
    const vent = someVent();
    expect(ventClock(vent, timeAt(vent, 0.5))).toBeCloseTo(0.5);
    expect(ventPhase(vent, timeAt(vent, VENT.warm / 2))).toBe('warm');
    expect(ventPhase(vent, timeAt(vent, VENT.warm + VENT.erupt / 2))).toBe('erupt');
    expect(ventPhase(vent, timeAt(vent, VENT.warm + VENT.erupt + 0.1))).toBe('idle');
    expect(ventPhase(vent, timeAt(vent, VENT.period - 0.1))).toBe('idle');
    // 솟기 전에 비킬 틈이 넉넉하고, 잠잠한 동안이 가장 길다.
    expect(VENT.warm).toBeGreaterThanOrEqual(1);
    expect(VENT.period - VENT.warm - VENT.erupt).toBeGreaterThan(VENT.warm + VENT.erupt);
    const offsets = new Set<number>();
    for (let cx = -6; cx <= 6; cx += 1) {
      for (let cy = -6; cy <= 6; cy += 1) {
        const other = ventInCell(cx, cy, seed);
        if (other) offsets.add(other.offset);
      }
    }
    expect(offsets.size).toBeGreaterThan(20);
  });

  it('불길이 솟는 불구멍 위에 서 있으면 다치고, 잠잠할 때와 다른 스테이지에서는 다치지 않는다', () => {
    const vent = someVent();
    const stand = (stage: 'meadow' | 'ridge', clock: number): { lost: number; events: SimEvent[]; sim: Sim } => {
      const sim = quietSim(1, { stage, seed });
      sim.state.player.x = vent.x;
      sim.state.player.y = vent.y;
      sim.state.t = timeAt(vent, clock);
      const before = sim.state.player.hp;
      const events = advance(sim, 0.3);
      return { lost: before - sim.state.player.hp, events, sim };
    };
    const burnt = stand('ridge', VENT.warm + 0.1);
    expect(burnt.lost).toBe(VENT.damage);
    expect(burnt.events).toContainEqual({ type: 'hurt' });
    expect(burnt.sim.isScorching(vent.x, vent.y)).toBe(true);
    // 달아오르는 동안에는 아직 다치지 않지만, 곧 솟는다는 것은 알 수 있다.
    const warming = stand('ridge', 0.2);
    expect(warming.lost).toBe(0);
    expect(warming.sim.isScorching(vent.x, vent.y)).toBe(true);
    const calm = stand('ridge', VENT.warm + VENT.erupt + 1);
    expect(calm.lost).toBe(0);
    expect(calm.sim.isScorching(vent.x, vent.y)).toBe(false);
    const meadow = stand('meadow', VENT.warm + 0.1);
    expect(meadow.lost).toBe(0);
    expect(meadow.sim.isScorching(vent.x, vent.y)).toBe(false);
  });

  it('솟기 시작할 때 한 번 알리고, 한 번 솟는 동안 플레이어는 한 번만 덴다', () => {
    const vent = someVent();
    const sim = quietSim(1, { stage: 'ridge', seed });
    sim.state.player.x = vent.x;
    sim.state.player.y = vent.y;
    sim.state.t = timeAt(vent, VENT.warm - 0.1);
    const before = sim.state.player.hp;
    const events = advance(sim, 0.1 + VENT.erupt + 0.2);
    expect(events.filter((e) => e.type === 'vent' && e.x === vent.x && e.y === vent.y)).toHaveLength(1);
    // 무적 시간이 끝나도 같은 불길에 두 번 데지는 않는다.
    expect(VENT.erupt).toBeGreaterThan(PLAYER_BASE.invulnerable);
    expect(before - sim.state.player.hp).toBe(VENT.damage);
    // 다음에 솟을 때는 다시 덴다.
    sim.state.t = timeAt(vent, VENT.period + VENT.warm + 0.05);
    advance(sim, 0.2);
    expect(before - sim.state.player.hp).toBe(VENT.damage * 2);
  });

  it('불길 위의 그림자는 크게 데고, 보스는 조금만 덴다', () => {
    const vent = someVent();
    /** 불길이 솟는 0.6초 동안 불구멍 위에 둔 적들이 잃은 체력 */
    const scorch = (...foes: Enemy[]): number[] => {
      const sim = quietSim(1, { stage: 'ridge', seed });
      // 플레이어가 옆으로 떨어져 있어서, 느린 적은 그동안 불구멍을 벗어나지 못한다.
      sim.state.player.x = vent.x - 150;
      sim.state.player.y = vent.y;
      sim.state.player.hp = 1e9;
      sim.state.enemies.push(...foes);
      sim.state.t = timeAt(vent, VENT.warm + 0.01);
      advance(sim, 0.6);
      return foes.map((e) => e.maxHp - e.hp);
    };
    const [onVent, away] = scorch(enemy('slag', vent.x, vent.y, 100), enemy('slag', vent.x + vent.rx + 40, vent.y, 100));
    expect(onVent).toBeGreaterThan(1.9 * VENT.share * 100);
    expect(onVent).toBeLessThan(3.1 * VENT.share * 100);
    expect(away).toBe(0);
    // 약한 적도 한 번에 조금은 덴다.
    const [small] = scorch(enemy('cinder', vent.x, vent.y, 500));
    expect(small).toBeGreaterThan(1.9 * VENT.share * 500);
    expect(VENT.floor).toBeGreaterThan(ENEMIES.soot.hp * VENT.share);
    const giant = enemy('giant', vent.x + 4, vent.y, 2000);
    const [boss] = scorch(giant);
    expect(boss).toBeGreaterThanOrEqual(VENT.boss);
    expect(boss).toBeLessThanOrEqual(3 * VENT.boss);
    // 튼튼한 그림자도 한 번 솟는 동안 내내 서 있으면 체력의 절반쯤을 잃는다.
    expect((VENT.erupt / VENT.tick) * VENT.share).toBeGreaterThan(0.45);
    expect((VENT.erupt / VENT.tick) * VENT.share).toBeLessThan(0.8);
  });

  it('끝없는 밤에서 불어난 체력은 불길이 치지 않는다', () => {
    const vent = someVent();
    /** 끝없는 밤에 들어선 지 minutes분이 지났을 때, 불길 위의 그림자가 0.6초 동안 잃는 체력 */
    const scorch = (minutes: number): number => {
      const sim = quietSim(1, { stage: 'ridge', seed });
      sim.state.player.x = vent.x - 150;
      sim.state.player.y = vent.y;
      sim.state.player.inv = 1e9;
      const foe = enemy('slag', vent.x, vent.y, 1000);
      sim.state.enemies.push(foe);
      sim.state.t = timeAt(vent, VENT.warm + 0.01);
      // 보스와 밀물, 축복은 이미 다 나온 것으로 해서 불길만 본다.
      sim.state.endless = { at: sim.state.t - minutes * 60, kills: 0, bosses: 99, surges: 99, boons: 99 };
      advance(sim, 0.6);
      return foe.maxHp - foe.hp;
    };
    const early = scorch(0);
    const late = scorch(3);
    expect(early).toBeGreaterThan(1.9 * VENT.share * 1000);
    // 3분이면 체력이 ENDLESS.hp의 세제곱 배로 불어나 있다. 불길은 불어나기 전의 체력만큼만 태운다.
    expect(late / early).toBeCloseTo(1 / ENDLESS.hp ** 3, 1);
  });

  it('숯덩이는 쓰러지면 재방울 둘로 쪼개지고, 쪼개져 나온 것은 다시 쪼개지지 않는다', () => {
    const sim = quietSim(1, { stage: 'ridge', seed });
    sim.state.player.hp = 1e9;
    sim.state.enemies.push(enemy('clinker', 100, 0, 0), enemy('slag', 0, 200, 500));
    sim.step(STEP, 0, 0);
    expect(sim.state.kills).toBe(1);
    const kinds = sim.state.enemies.map((e) => e.kind).sort();
    expect(kinds).toEqual(['cinder', 'cinder', 'slag']);
    const pieces = sim.state.enemies.filter((e) => e.kind === 'cinder');
    // 양옆으로 튀어 나온다.
    expect(pieces[0].kx).toBeCloseTo(-(pieces[1].kx ?? 0), 5);
    expect(new Set(pieces.map((e) => e.uid)).size).toBe(2);
    for (const piece of pieces) piece.hp = 0;
    sim.step(STEP, 0, 0);
    expect(sim.state.kills).toBe(3);
    expect(sim.state.enemies.map((e) => e.kind)).toEqual(['slag']);
    expect(ENEMIES[ENEMIES.clinker.splits!.into].splits).toBeUndefined();
  });

  it('고개의 문지기는 내달린 다음에 숨을 고르고, 빛을 모아 부채꼴로 쏜다', () => {
    const sim = quietSim(1, { stage: 'ridge', seed });
    sim.state.player.hp = 1e9;
    const warden = enemy('warden', 0, -150, 99999);
    warden.timer = 0.01;
    warden.tier = MID_BOSS_COUNT - 1;
    sim.state.enemies.push(warden);
    // 먼저 힘을 모았다가 내달린다.
    sim.step(STEP, 0, 0);
    expect(sim.events).toContainEqual({ type: 'windup' });
    expect(warden.mode).toBe(1);
    const dash = dashOf('warden', warden.tier);
    expect(advance(sim, dash.windup + 0.05)).toContainEqual({ type: 'dash' });
    advance(sim, dash.seconds + 0.05);
    expect(warden.mode).toBe(WARDEN_REST);
    expect(sim.state.hazards).toHaveLength(0);
    // 숨을 고른 뒤에 빛을 모으고, 그다음에 쏜다.
    warden.timer = 0.01;
    sim.step(STEP, 0, 0);
    expect(sim.events).toContainEqual({ type: 'charge' });
    expect(warden.mode).toBe(WARDEN_CHARGING);
    const before = { x: warden.x, y: warden.y };
    expect(advance(sim, CHARGE_SECONDS + 0.05)).toContainEqual({ type: 'volley' });
    expect(sim.state.hazards).toHaveLength(7);
    // 모으는 동안에는 멈춰 있다.
    expect(Math.hypot(warden.x - before.x, warden.y - before.y)).toBeLessThan(2);
    expect(warden.mode).toBe(0);
    // 그다음은 다시 돌진이고, 부하는 부르지 않는다.
    warden.timer = 0.01;
    sim.step(STEP, 0, 0);
    expect(sim.events).toContainEqual({ type: 'windup' });
    expect(sim.state.enemies).toHaveLength(1);
  });

  it('자동 플레이는 달아오른 불구멍 밖으로 걸어 나간다', () => {
    const vent = someVent();
    const sim = quietSim(1, { stage: 'ridge', seed });
    sim.state.player.x = vent.x;
    sim.state.player.y = vent.y;
    sim.state.t = timeAt(vent, 0.05);
    const before = sim.state.player.hp;
    for (let i = 0; i < Math.round((VENT.warm + VENT.erupt) / STEP); i += 1) {
      const [x, y] = steer(sim);
      sim.step(STEP, x, y);
    }
    expect(ventAt(sim.state.player.x, sim.state.player.y, seed)).toBeNull();
    expect(sim.state.player.hp).toBe(before);
  });
});

describe('바람 설원', () => {
  /** 돌풍이 한창 부는 때(초): index번째 돌풍이 세게 불기 시작하고 1초 뒤 */
  const blowing = (index = 0): number => GUST.first + index * GUST.period + GUST.warn + 1;
  /** 돌풍이 잠잠한 때(초) */
  const calm = (index = 0): number => GUST.first + index * GUST.period + GUST.warn + GUST.blow + 2;
  const tundra = (seed = 3): Sim => {
    const sim = quietSim(seed, { stage: 'tundra', seed });
    sim.state.player.inv = 1e9;
    sim.state.postsSpawned = POSTS.times.length;
    return sim;
  };

  it('설원에서는 설원의 적만 나온다', () => {
    const sim = newSim(4, createRun({ ...config, stage: 'tundra' }));
    sim.state.weapons = {};
    sim.state.player.hp = 1e9;
    sim.state.midBosses = MID_BOSS_COUNT;
    sim.state.finalBoss = true;
    sim.state.elites = ELITE.times.length;
    sim.state.t = 200;
    advance(sim, 6);
    const allowed = new Set<EnemyKind>(STAGES.tundra.spawns.map((row) => row.kind));
    expect(sim.state.enemies.length).toBeGreaterThan(10);
    for (const e of sim.state.enemies) expect(allowed.has(e.kind)).toBe(true);
    // 다른 스테이지와 같은 짜임이다: 그림자 여섯, 그 가운데 쏘는 것과 터지는 것이 하나씩.
    expect(STAGES.tundra.spawns).toHaveLength(6);
    expect(STAGES.tundra.spawns.filter((row) => ENEMIES[row.kind].shoots)).toHaveLength(1);
    expect(STAGES.tundra.spawns.filter((row) => ENEMIES[row.kind].bursts)).toHaveLength(1);
    expect(STAGES.tundra.spawns[0].from).toBe(0);
    expect(ENEMIES[STAGES.tundra.finalBoss].brain).toBe('blizzard');
  });

  it('돌풍은 정해진 박자로 일었다가 불고 잦아든다', () => {
    const seed = 11;
    expect(gustAt(0, seed).phase).toBe('calm');
    expect(gustAt(GUST.first - 0.01, seed).phase).toBe('calm');
    expect(gustAt(GUST.first + 0.01, seed)).toMatchObject({ phase: 'warn', index: 0, force: 0 });
    expect(gustAt(GUST.first + GUST.warn + 0.01, seed).phase).toBe('blow');
    const full = gustAt(blowing(), seed);
    expect(full).toMatchObject({ phase: 'blow', index: 0, force: 1 });
    // 불기 시작할 때와 그칠 때는 조금씩 세지고 잦아든다.
    expect(gustAt(GUST.first + GUST.warn + 0.1, seed).force).toBeLessThan(0.5);
    expect(gustAt(GUST.first + GUST.warn + GUST.blow - 0.1, seed).force).toBeLessThan(0.5);
    expect(gustAt(calm(), seed)).toMatchObject({ phase: 'calm', index: 1, force: 0 });
    expect(gustAt(blowing(5), seed)).toMatchObject({ phase: 'blow', index: 5 });
    // 일기 시작할 때부터 어느 쪽으로 불지 정해져 있다.
    const warned = gustAt(GUST.first + 0.5, seed);
    expect([warned.dirX, warned.dirY]).toEqual([full.dirX, full.dirY]);
    // 부는 동안이 쉬는 동안보다 훨씬 짧다.
    expect(GUST.warn + GUST.blow).toBeLessThan(GUST.period / 2);
  });

  it('돌풍은 여덟 방향 가운데 하나로 불고, 잇달아 같은 쪽으로 불지 않는다', () => {
    const seen = new Set<string>();
    for (const seed of [1, 2, 3, 99]) {
      for (let index = 0; index < 60; index += 1) {
        const [x, y] = gustDirection(index, seed);
        expect(gustDirection(index, seed)).toEqual([x, y]);
        expect(Math.hypot(x, y)).toBeCloseTo(1, 6);
        const turn = Math.atan2(y, x) / (Math.PI / 4);
        expect(Math.abs(turn - Math.round(turn))).toBeLessThan(1e-6);
        const [nx, ny] = gustDirection(index + 1, seed);
        expect(Math.hypot(nx - x, ny - y)).toBeGreaterThan(0.5);
        seen.add(`${Math.round(turn)}`);
      }
    }
    expect(seen.size).toBe(8);
    // 씨앗이 다르면 부는 차례도 다르다.
    const order = (seed: number): string => Array.from({ length: 12 }, (_, i) => gustDirection(i, seed).join()).join(';');
    expect(order(1)).not.toBe(order(2));
  });

  it('돌풍이 부는 동안 가만히 있어도 바람 부는 쪽으로 밀리고, 다른 스테이지에는 돌풍이 없다', () => {
    const drift = (stage: 'meadow' | 'tundra', at: number): [number, number] => {
      const sim = quietSim(3, { stage, seed: 3 });
      sim.state.t = at;
      advance(sim, 1);
      return [sim.state.player.x, sim.state.player.y];
    };
    const gust = gustAt(blowing(), 3);
    const [x, y] = drift('tundra', blowing());
    expect(x).toBeCloseTo(gust.dirX * GUST.player, 0);
    expect(y).toBeCloseTo(gust.dirY * GUST.player, 0);
    expect(drift('tundra', calm())).toEqual([0, 0]);
    expect(drift('meadow', blowing())).toEqual([0, 0]);
    expect(quietSim(3, { stage: 'meadow' }).gust).toBeNull();
    // 바람을 거슬러도 걸을 수 있다.
    expect(GUST.player).toBeLessThan(PLAYER_BASE.speed * PUDDLE_SLOW * CHILL_SLOW);
  });

  it('그림자는 플레이어보다 세게 밀리고, 무거운 것은 덜 밀리고, 보스는 밀리지 않는다', () => {
    /** 바람 부는 쪽으로 1초 동안 얼마나 더 갔는지: 돌풍이 불 때와 잠잠할 때의 차이 */
    const pushed = (kind: EnemyKind): number => {
      const along = (at: number): number => {
        const sim = tundra();
        sim.state.t = at;
        const gust = gustAt(blowing(), 3);
        // 바람과 직각인 쪽에 멀리 세워서, 쫓아오는 걸음이 바람 부는 쪽으로는 거의 보태지지 않게 한다.
        const e = enemy(kind, -gust.dirY * 150, gust.dirX * 150, 1e9);
        sim.state.enemies.push(e);
        advance(sim, 1);
        return (e.x - -gust.dirY * 150) * gust.dirX + (e.y - gust.dirX * 150) * gust.dirY;
      };
      return along(blowing()) - along(calm());
    };
    const light = pushed('flake');
    const heavy = pushed('floe');
    const elite = pushed('fang');
    expect(light).toBeGreaterThan(GUST.enemy * 0.9);
    expect(light).toBeLessThan(GUST.enemy * 1.1);
    expect(heavy).toBeGreaterThan(GUST.enemy * GUST.heavy * 0.8);
    expect(heavy).toBeLessThan(GUST.enemy * GUST.heavy * 1.25);
    expect(elite).toBeLessThan(light * 0.6);
    expect(Math.abs(pushed('blizzard'))).toBeLessThan(2);
    // 그림자가 플레이어보다 훨씬 세게 밀려서, 바람이 불어오는 쪽의 그림자가 날아든다.
    expect(GUST.enemy).toBeGreaterThan(GUST.player * 2);
  });

  it('돌풍이 일 때와 세게 불기 시작할 때 한 번씩 알린다', () => {
    const sim = tundra();
    sim.state.t = GUST.first - 0.5;
    const events = advance(sim, GUST.period).filter((event) => event.type === 'gust');
    const gust = gustAt(blowing(), 3);
    expect(events).toEqual([
      { type: 'gust', phase: 'warn', dirX: gust.dirX, dirY: gust.dirY },
      { type: 'gust', phase: 'blow', dirX: gust.dirX, dirY: gust.dirY },
    ]);
    // 풀밭에서는 알릴 것이 없다.
    const meadow = quietSim(3);
    meadow.state.t = GUST.first - 0.5;
    expect(advance(meadow, GUST.period).some((event) => event.type === 'gust')).toBe(false);
  });

  it('서릿발에 닿으면 발이 얼어 잠깐 느려진다', () => {
    const walked = (chilled: boolean): number => {
      const sim = quietSim(3);
      sim.state.player.hp = 1e9;
      if (chilled) {
        sim.state.enemies.push(enemy('frost', 2, 0, 1e9));
        sim.step(STEP, 0, 0);
        expect(sim.events).toContainEqual({ type: 'chill' });
        expect(sim.state.player.chilled).toBe(ENEMIES.frost.chills);
        sim.state.enemies.length = 0;
      }
      const from = sim.state.player.x;
      advance(sim, 1, 1, 0);
      return sim.state.player.x - from;
    };
    const free = walked(false);
    const frozen = walked(true);
    expect(free).toBeCloseTo(PLAYER_BASE.speed, 0);
    expect(frozen).toBeCloseTo(PLAYER_BASE.speed * CHILL_SLOW, 0);
    // 시간이 지나면 풀린다.
    const sim = quietSim(3);
    sim.state.player.hp = 1e9;
    sim.state.enemies.push(enemy('frost', 2, 0, 1e9));
    sim.step(STEP, 0, 0);
    sim.state.enemies.length = 0;
    advance(sim, ENEMIES.frost.chills! + 0.1);
    expect(sim.state.player.chilled).toBe(0);
    // 얼리는 것은 서릿발과 설원의 정예뿐이다.
    const chillers = (Object.keys(ENEMIES) as EnemyKind[]).filter((kind) => ENEMIES[kind].chills);
    expect(chillers.sort()).toEqual(['fang', 'frost']);
  });

  it('등갓의 빛막이 막아 주면 얼지 않는다', () => {
    const sim = quietSim(3);
    sim.applyUpgrade({ type: 'passive', id: 'hood', level: 1 });
    sim.state.enemies.push(enemy('frost', 2, 0, 1e9));
    sim.step(STEP, 0, 0);
    expect(sim.events).toContainEqual({ type: 'block' });
    expect(sim.events).not.toContainEqual({ type: 'chill' });
    expect(sim.state.player.chilled ?? 0).toBe(0);
  });

  it('눈보라의 눈은 사방으로 세 겹을 엇갈려 쏘고, 사이사이에 부하를 부른다', () => {
    const sim = tundra();
    const boss = enemy('blizzard', 0, -200, 99999);
    boss.timer = 0.01;
    boss.tier = MID_BOSS_COUNT - 1;
    sim.state.enemies.push(boss);
    // 쏘기 전에는 멈춰서 빛을 모은다.
    sim.step(STEP, 0, 0);
    expect(sim.events).toContainEqual({ type: 'charge' });
    expect(boss.mode).toBe(CHARGING);
    expect(sim.state.hazards).toHaveLength(0);
    advance(sim, CHARGE_SECONDS + 0.05);
    expect(boss.mode).toBe(BLIZZARD_FIRING);
    expect(sim.state.hazards).toHaveLength(BLIZZARD.count);
    const angle = (index: number): number => Math.atan2(sim.state.hazards[index].vy, sim.state.hazards[index].vx);
    const first = angle(0);
    // 겹과 겹 사이에는 틈이 있다.
    advance(sim, BLIZZARD.gap - 0.1);
    expect(sim.state.hazards).toHaveLength(BLIZZARD.count);
    advance(sim, 0.15);
    expect(sim.state.hazards).toHaveLength(BLIZZARD.count * 2);
    // 다음 겹은 앞 겹의 갈래 사이로 온다: 반 칸 어긋난다.
    const step = (Math.PI * 2) / BLIZZARD.count;
    const off = (((angle(BLIZZARD.count) - first) % step) + step) % step;
    expect(off).toBeCloseTo(step / 2, 5);
    // 쏘는 동안에는 제자리에 서 있다.
    const stood = [boss.x, boss.y];
    advance(sim, BLIZZARD.gap - 0.1);
    expect([boss.x, boss.y]).toEqual(stood);
    advance(sim, 0.15);
    expect(sim.state.hazards).toHaveLength(BLIZZARD.count * BLIZZARD.rings);
    advance(sim, BLIZZARD.gap + 0.1);
    expect(sim.state.hazards.length).toBeLessThanOrEqual(BLIZZARD.count * BLIZZARD.rings);
    expect(boss.mode).toBe(1);
    // 그다음은 부하 부르기. 모으는 틈 없이 바로 부른다.
    boss.timer = 0.01;
    sim.step(STEP, 0, 0);
    expect(sim.events).not.toContainEqual({ type: 'charge' });
    const minions = sim.state.enemies.filter((e) => e !== boss);
    expect(minions).toHaveLength(5);
    for (const minion of minions) expect(STAGES.tundra.minions).toContain(minion.kind);
    // 그리고 다시 쏘기
    boss.timer = 0.01;
    sim.step(STEP, 0, 0);
    expect(sim.events).toContainEqual({ type: 'charge' });
  });

  it('설원은 가장 늦게 열리고, 쓰러뜨리면 새벽이 온다', () => {
    const times = STAGE_ORDER.map((id) => STAGES[id].unlockSeconds);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(STAGES.tundra.unlockSeconds).toBeGreaterThan(STAGES.ridge.unlockSeconds);
    expect(STAGES.tundra.unlockSeconds).toBeLessThan(RUN_SECONDS);
    const sim = tundra();
    sim.state.t = RUN_SECONDS + 5;
    sim.state.enemies.push(enemy('blizzard', 300, 0, 0));
    sim.step(STEP, 0, 0);
    expect(sim.state.over).toBe('cleared');
  });
});

describe('빛버섯 숲', () => {
  const grove = (seed = 3): Sim => {
    const sim = quietSim(seed, { stage: 'grove', seed });
    sim.state.postsSpawned = POSTS.times.length;
    return sim;
  };
  /** 시작하는 자리에서 가까운 빛버섯 하나. 내려앉을 자리에는 다른 버섯이 없는 것으로 고른다. */
  const nearShroom = (seed: number): Shroom => {
    for (let cellX = 1; cellX < 40; cellX += 1) {
      const shroom = shroomInCell(cellX, 0, seed);
      if (shroom && !shroomAt(shroom.x + LEAP.distance, shroom.y, seed)) return shroom;
    }
    throw new Error('빛버섯이 없다');
  };
  /** 플레이어를 버섯의 왼쪽 가장자리 바로 앞에 세운다. 오른쪽으로 걸으면 곧 밟는다. */
  const standBefore = (sim: Sim, shroom: Shroom): void => {
    sim.state.player.x = shroom.x - shroom.r - LEAP.reach - 1;
    sim.state.player.y = shroom.y;
  };
  /** 플레이어가 서 있는 쪽을 향해 퍼지는 땅울림 고리 */
  const ring = (x: number, y: number, r: number, gap: number, extra: Partial<Quake> = {}): Quake => ({
    x,
    y,
    r,
    gap,
    damage: QUAKE.damage,
    delay: 0,
    ...extra,
  });

  it('숲에서는 숲의 적만 나오고, 다른 스테이지와 같은 짜임이다', () => {
    const sim = newSim(4, createRun({ ...config, stage: 'grove' }));
    sim.state.weapons = {};
    sim.state.player.hp = 1e9;
    sim.state.midBosses = MID_BOSS_COUNT;
    sim.state.finalBoss = true;
    sim.state.elites = ELITE.times.length;
    sim.state.t = 200;
    advance(sim, 6);
    const allowed = new Set<EnemyKind>(STAGES.grove.spawns.map((row) => row.kind));
    expect(sim.state.enemies.length).toBeGreaterThan(10);
    for (const e of sim.state.enemies) expect(allowed.has(e.kind)).toBe(true);
    expect(STAGES.grove.spawns).toHaveLength(6);
    expect(STAGES.grove.spawns.filter((row) => ENEMIES[row.kind].shoots)).toHaveLength(1);
    expect(STAGES.grove.spawns.filter((row) => ENEMIES[row.kind].bursts)).toHaveLength(1);
    expect(STAGES.grove.spawns.filter((row) => ENEMIES[row.kind].sprouts)).toHaveLength(1);
    expect(STAGES.grove.spawns[0].from).toBe(0);
    expect(ENEMIES[STAGES.grove.elite].springs).toBe(true);
    expect(ENEMIES[STAGES.grove.finalBoss].brain).toBe('elder');
    // 빛버섯은 이 스테이지에만 있다.
    expect(STAGE_ORDER.filter((id) => STAGES[id].shrooms)).toEqual(['grove']);
  });

  it('빛버섯은 씨앗과 칸으로 자리가 정해지고, 시작하는 칸에는 없다', () => {
    for (const seed of [1, 2, 3, 77]) {
      expect(shroomInCell(0, 0, seed)).toBeNull();
      const shroom = nearShroom(seed);
      expect(shroomInCell(Math.floor(shroom.x / 116), Math.floor(shroom.y / 116), seed)).toEqual(shroom);
      expect(shroomAt(shroom.x, shroom.y, seed)).toEqual(shroom);
      expect(shroomAt(shroom.x + shroom.r + LEAP.reach - 0.5, shroom.y, seed)).toEqual(shroom);
      expect(shroomAt(shroom.x + shroom.r + LEAP.reach + 0.5, shroom.y, seed)).toBeNull();
    }
    // 넓은 땅에 고르게 돋아 있다.
    let count = 0;
    for (let cellY = -10; cellY < 10; cellY += 1) {
      for (let cellX = -10; cellX < 10; cellX += 1) if (shroomInCell(cellX, cellY, 5)) count += 1;
    }
    expect(count).toBeGreaterThan(120);
    expect(count).toBeLessThan(220);
  });

  it('빛버섯을 밟으면 걷던 쪽으로 뛰고, 뛰는 동안은 다치지 않는다', () => {
    const seed = 3;
    const sim = grove(seed);
    const shroom = nearShroom(seed);
    standBefore(sim, shroom);
    const p = sim.state.player;
    const events: SimEvent[] = [];
    for (let i = 0; i < 10 && !p.leap; i += 1) {
      sim.step(STEP, 1, 0);
      events.push(...sim.events);
    }
    expect(p.leap).toBeDefined();
    expect(events.some((event) => event.type === 'leap')).toBe(true);
    const start = { x: p.leap?.x0 ?? 0, y: p.leap?.y0 ?? 0 };
    expect(p.leap?.x1).toBeCloseTo(start.x + LEAP.distance, 5);
    expect(p.leap?.y1).toBeCloseTo(start.y, 5);
    // 공중에서는 그림자에 닿아도 다치지 않는다. 걷는 쪽을 바꿔도 날아가는 길은 그대로다.
    sim.state.enemies.push(enemy('cone', p.x + 4, p.y));
    const hp = p.hp;
    for (let i = 0; i < Math.ceil(LEAP.seconds / STEP) - 2; i += 1) {
      sim.state.enemies[0].x = p.x + 2;
      sim.state.enemies[0].y = p.y;
      sim.step(STEP, -1, 1);
      expect(p.hp).toBe(hp);
    }
    // 내려앉는 자리 가까이의 그림자는 밀려난다.
    sim.state.enemies.length = 0;
    const near = enemy('cone', start.x + LEAP.distance + 12, start.y);
    sim.state.enemies.push(near);
    const landed: SimEvent[] = [];
    for (let i = 0; i < 6 && p.leap; i += 1) {
      sim.step(STEP, 0, 0);
      landed.push(...sim.events);
    }
    expect(p.leap).toBeUndefined();
    expect(landed.some((event) => event.type === 'land')).toBe(true);
    expect(p.x).toBeCloseTo(start.x + LEAP.distance, 5);
    expect(near.kx ?? 0).toBeGreaterThan(0);
  });

  it('밟힌 빛버섯은 잠깐 납작해졌다가 다시 부푼다', () => {
    const seed = 3;
    const sim = grove(seed);
    const shroom = nearShroom(seed);
    standBefore(sim, shroom);
    const p = sim.state.player;
    for (let i = 0; i < 10 && !p.leap; i += 1) sim.step(STEP, 1, 0);
    expect(sim.shroomReady(shroom.key)).toBe(false);
    advance(sim, LEAP.seconds + 0.1);
    expect(p.leap).toBeUndefined();
    // 납작한 동안에는 다시 밟아도 뛰지 않는다.
    p.x = shroom.x;
    p.y = shroom.y;
    sim.step(STEP, 0, 0);
    expect(p.leap).toBeUndefined();
    // 버섯에서 내려와 기다린다. 위에 서 있으면 부푸는 대로 다시 뛴다.
    p.x = shroom.x - 50;
    advance(sim, LEAP.rest);
    expect(sim.shroomReady(shroom.key)).toBe(true);
    p.x = shroom.x + 1;
    p.y = shroom.y;
    sim.step(STEP, 0, 0);
    // 서 있다가 부풀면 버섯 가운데에서 먼 쪽으로 뛴다.
    expect(p.leap).toBeDefined();
    expect((p.leap?.x1 ?? 0) - (p.leap?.x0 ?? 0)).toBeCloseTo(LEAP.distance, 5);
    // 다시 부푼 버섯은 적어 둔 것에서 지워져 저장이 쌓이지 않는다.
    expect(Object.keys(sim.state.squashed ?? {})).toEqual([shroom.key]);
  });

  it('다른 스테이지에서는 같은 자리를 걸어도 뛰지 않는다', () => {
    const seed = 3;
    const sim = quietSim(seed, { stage: 'meadow', seed });
    const shroom = nearShroom(seed);
    standBefore(sim, shroom);
    advance(sim, 1, 1, 0);
    expect(sim.state.player.leap).toBeUndefined();
    expect(sim.state.squashed).toBeUndefined();
  });

  it('도토리가 쓰러진 자리에는 싹이 남는다. 밟으면 사라지고, 두면 솔방울로 자란다', () => {
    const sim = grove();
    const acorn = enemy('acorn', 60, 0);
    sim.state.enemies.push(acorn);
    acorn.hp = 0;
    sim.step(STEP, 0, 0);
    expect(sim.events).toContainEqual({ type: 'plant' });
    expect(sim.state.sprouts).toHaveLength(1);
    expect(sim.state.sprouts?.[0]).toMatchObject({ x: 60, y: 0 });
    expect(sim.state.sprouts?.[0].t).toBeCloseTo((ENEMIES.acorn.sprouts ?? 0) - STEP, 5);
    // 그대로 두면 자란다.
    const events = advance(sim, (ENEMIES.acorn.sprouts ?? 0) + 0.1);
    expect(events).toContainEqual({ type: 'sprout', x: 60, y: 0 });
    expect(sim.state.sprouts).toEqual([]);
    expect(sim.state.enemies.map((e) => e.kind)).toEqual([STAGES.grove.spawns[0].kind]);
    // 다시 하나를 남기고, 이번에는 밟는다.
    sim.state.enemies.length = 0;
    const next = enemy('acorn', 30, 0);
    sim.state.enemies.push(next);
    next.hp = 0;
    sim.step(STEP, 0, 0);
    sim.state.player.x = 30 - PLAYER_BASE.radius;
    sim.step(STEP, 0, 0);
    expect(sim.events).toContainEqual({ type: 'stomp', x: 30, y: 0 });
    expect(sim.state.sprouts).toEqual([]);
    advance(sim, 5);
    expect(sim.state.enemies).toEqual([]);
  });

  it('싹이 너무 많으면 가장 오래된 것부터 시든다', () => {
    const sim = grove();
    for (let i = 0; i < SPROUT.limit + 5; i += 1) {
      const acorn = enemy('acorn', 100 + i * 3, 50);
      acorn.hp = 0;
      sim.state.enemies.push(acorn);
      sim.step(STEP, 0, 0);
    }
    const sprouts = sim.state.sprouts ?? [];
    expect(sprouts).toHaveLength(SPROUT.limit);
    expect(sprouts[0].x).toBe(100 + 5 * 3);
  });

  it('날다람쥐는 빛버섯을 딛고 뛰어올라, 뛸 때 플레이어가 있던 쪽에 내려앉는다', () => {
    const seed = 3;
    const sim = grove(seed);
    const shroom = nearShroom(seed);
    const p = sim.state.player;
    p.x = shroom.x + 60;
    p.y = shroom.y;
    const glider = enemy('glider', shroom.x, shroom.y);
    glider.timer = 0;
    sim.state.enemies.push(glider);
    sim.step(STEP, 0, 0);
    expect(sim.events).toContainEqual({ type: 'pounce' });
    expect(glider.mode).toBe(1);
    expect(sim.shroomReady(shroom.key)).toBe(false);
    const hp = p.hp;
    const events = advance(sim, GLIDE.seconds + STEP);
    const thud = events.find((event) => event.type === 'thud');
    expect(thud).toBeDefined();
    expect(glider.mode).toBe(0);
    expect(glider.x).toBeCloseTo(p.x, 0);
    expect(p.hp).toBe(hp - GLIDE.damage);
    // 내려앉은 뒤에는 한동안 다시 뛰지 않는다.
    expect(glider.timer).toBeGreaterThan(GLIDE.rest - 0.1);
  });

  it('날다람쥐가 내려앉을 자리에서 비키면 다치지 않는다', () => {
    const seed = 3;
    const sim = grove(seed);
    const shroom = nearShroom(seed);
    const p = sim.state.player;
    p.x = shroom.x + 60;
    p.y = shroom.y;
    const glider = enemy('glider', shroom.x, shroom.y);
    glider.timer = 0;
    sim.state.enemies.push(glider);
    sim.step(STEP, 0, 0);
    const hp = p.hp;
    // 위로 비켜선다.
    advance(sim, GLIDE.seconds + STEP, 0, -1);
    expect(p.hp).toBe(hp);
    // 멀리 있는 플레이어에게는 GLIDE.reach까지만 뛴다.
    const far = grove(seed);
    // 멀리 있어도 다시 데려올 만큼 멀지는 않은 거리
    far.state.player.x = shroom.x + 250;
    far.state.player.y = shroom.y;
    const jumper = enemy('glider', shroom.x, shroom.y);
    jumper.timer = 0;
    far.state.enemies.push(jumper);
    far.step(STEP, 0, 0);
    expect(Math.hypot(jumper.vx, jumper.vy) * GLIDE.seconds).toBeCloseTo(GLIDE.reach, 3);
  });

  it('땅울림 고리의 틈은 같은 간격으로 나 있다', () => {
    const quake = ring(0, 0, 50, 0.3);
    const step = (Math.PI * 2) / QUAKE.gaps;
    for (let k = -2; k <= QUAKE.gaps + 2; k += 1) {
      expect(inQuakeGap(quake, 0.3 + k * step)).toBe(true);
      expect(inQuakeGap(quake, 0.3 + k * step + QUAKE.gap / 2 - 0.01)).toBe(true);
      expect(inQuakeGap(quake, 0.3 + k * step + QUAKE.gap / 2 + 0.01)).toBe(false);
      expect(inQuakeGap(quake, 0.3 + k * step + step / 2)).toBe(false);
    }
    // 이번 걸음에 고리가 지나간 자리만 닿는다.
    expect(quakeCrosses(ring(0, 0, 60, Math.PI), 55, 58, 0, 5)).toBe(true);
    expect(quakeCrosses(ring(0, 0, 60, Math.PI), 55, 90, 0, 5)).toBe(false);
    expect(quakeCrosses(ring(0, 0, 60, Math.PI), 55, 30, 0, 5)).toBe(false);
    // 틈 안에 있으면 지나가도 닿지 않는다.
    expect(quakeCrosses(ring(0, 0, 60, 0), 55, 58, 0, 5)).toBe(false);
  });

  it('땅울림 고리는 틈이 아닌 곳에 서 있던 플레이어를 한 번만 다치게 한다', () => {
    const hit = grove();
    hit.state.quakes = [ring(100, 0, 20, 0)];
    const hp = hit.state.player.hp;
    advance(hit, 2.5);
    expect(hit.state.player.hp).toBe(hp - QUAKE.damage);
    expect(hit.state.quakes).toEqual([]);
    // 틈에 서 있으면 다치지 않는다.
    const safe = grove();
    safe.state.quakes = [ring(100, 0, 20, Math.PI)];
    advance(safe, 2.5);
    expect(safe.state.player.hp).toBe(hp);
  });

  it('빛버섯을 밟고 공중에 떠 있는 동안 지나간 고리에는 다치지 않는다', () => {
    const sim = grove();
    const p = sim.state.player;
    p.leap = { x0: 0, y0: 0, x1: 0, y1: 0, t: 0 };
    sim.state.quakes = [ring(100, 0, 92, 0)];
    const hp = p.hp;
    advance(sim, 1);
    expect(p.hp).toBe(hp);
  });

  it('숲의 고목은 힘을 모았다가 땅을 굴러 고리를 퍼뜨리고, 쫓다가 부하를 부른다', () => {
    const sim = grove();
    sim.state.player.inv = 1e9;
    const boss = enemy('elder', 120, 0);
    boss.timer = 0.01;
    sim.state.enemies.push(boss);
    sim.step(STEP, 0, 0);
    expect(boss.mode).toBe(CHARGING);
    expect(sim.events).toContainEqual({ type: 'charge' });
    const charged = advance(sim, QUAKE.windup + STEP);
    expect(charged.some((event) => event.type === 'quake')).toBe(true);
    expect(sim.state.quakes).toHaveLength(1);
    // 그다음에는 쫓다가 부하를 부른다.
    advance(sim, QUAKE.rest + STEP);
    const minions = sim.state.enemies.filter((e) => e !== boss);
    expect(minions.length).toBeGreaterThan(0);
    for (const minion of minions) expect(STAGES.grove.minions).toContain(minion.kind);
  });

  it('숲의 고목은 체력이 반 아래면 틈이 어긋난 두 겹을 퍼뜨린다', () => {
    const sim = grove();
    sim.state.player.inv = 1e9;
    const boss = enemy('elder', 120, 0);
    boss.hp = boss.maxHp * (QUAKE.rage - 0.05);
    boss.mode = CHARGING;
    boss.timer = 0.01;
    sim.state.enemies.push(boss);
    sim.step(STEP, 0, 0);
    const quakes = sim.state.quakes ?? [];
    expect(quakes).toHaveLength(2);
    // 퍼뜨린 걸음에 이미 한 걸음만큼 기다렸다.
    expect(quakes[1].delay).toBeCloseTo(QUAKE.echo - STEP, 5);
    expect(quakes[1].gap - quakes[0].gap).toBeCloseTo(Math.PI / QUAKE.gaps, 5);
    // 두 번째 겹이 퍼지기 시작할 때도 알린다.
    const later = advance(sim, QUAKE.echo + STEP);
    expect(later.filter((event) => event.type === 'quake')).toHaveLength(1);
  });

  it('숲은 가장 늦게 열리고, 숲의 고목을 쓰러뜨리면 새벽이 온다', () => {
    const times = STAGE_ORDER.map((id) => STAGES[id].unlockSeconds);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(STAGES.grove.unlockSeconds).toBeGreaterThan(STAGES.tundra.unlockSeconds);
    expect(STAGES.grove.unlockSeconds).toBeLessThanOrEqual(RUN_SECONDS);
    const sim = grove();
    sim.state.player.inv = 1e9;
    sim.state.t = RUN_SECONDS + 5;
    sim.state.enemies.push(enemy('elder', 300, 0, 0));
    sim.step(STEP, 0, 0);
    expect(sim.state.over).toBe('cleared');
  });

  it('뛰는 중이나 싹과 고리가 있을 때 저장했다가 이어 해도 그대로 이어진다', () => {
    const seed = 3;
    const sim = grove(seed);
    const shroom = nearShroom(seed);
    standBefore(sim, shroom);
    for (let i = 0; i < 10 && !sim.state.player.leap; i += 1) sim.step(STEP, 1, 0);
    sim.state.sprouts = [{ x: 200, y: 200, t: 2 }];
    sim.state.quakes = [ring(300, 0, 20, 0)];
    const saved = JSON.parse(JSON.stringify(sim.state)) as unknown;
    expect(looksLikeRun(saved)).toBe(true);
    const restored = restoreRun(saved);
    expect(restored).not.toBeNull();
    const again = new Sim(restored as RunState, seededRandom(seed));
    advance(again, LEAP.seconds);
    expect(again.state.player.leap).toBeUndefined();
    expect(again.state.player.x).toBeGreaterThan(shroom.x);
    expect(again.shroomReady(shroom.key)).toBe(false);
  });
});

describe('정예 그림자와 보물 상자', () => {
  /** 저절로 나오는 것 가운데 정예만 남긴 조용한 판 */
  const eliteSim = (extra: Partial<Parameters<typeof createRun>[0]> = {}): Sim => {
    const sim = quietSim(3, extra);
    sim.state.player.inv = 1e9;
    sim.state.postsSpawned = POSTS.times.length;
    sim.state.elites = 0;
    return sim;
  };
  /** 플레이어 발밑에 보물 상자를 하나 놓고 한 걸음 돌린다. */
  const openChest = (sim: Sim): SimEvent[] => {
    const p = sim.state.player;
    sim.state.gems.push({ x: p.x, y: p.y, value: 0, kind: 'chest', pulled: false });
    sim.step(STEP, 0, 0);
    return [...sim.events];
  };
  const levels = (sim: Sim): number =>
    [...Object.values(sim.state.weapons), ...Object.values(sim.state.passives)].reduce((sum, level) => sum + (level ?? 0), 0);

  it('스테이지마다 정예가 하나씩 있고, 보스는 아니다', () => {
    const kinds = STAGE_ORDER.map((id) => STAGES[id].elite);
    expect(new Set(kinds).size).toBe(STAGE_ORDER.length);
    for (const kind of kinds) {
      expect(ENEMIES[kind].elite).toBe(true);
      expect(ENEMIES[kind].boss).toBeUndefined();
      // 그 스테이지의 가장 튼튼한 그림자보다 튼튼하고 크다.
      const tank = Math.max(...Object.values(ENEMIES).filter((info) => !info.boss && !info.elite).map((info) => info.hp));
      expect(ENEMIES[kind].hp).toBeGreaterThan(tank * 2);
    }
    // 정예만 정예로 적혀 있다.
    expect(Object.values(ENEMIES).filter((info) => info.elite)).toHaveLength(STAGE_ORDER.length);
  });

  it('정해진 시각마다 하나씩 화면 가장자리에서 나온다', () => {
    const sim = eliteSim();
    sim.state.t = ELITE.times[0] - 0.05;
    const events = advance(sim, 0.2);
    expect(events.filter((event) => event.type === 'elite')).toEqual([{ type: 'elite', kind: 'prowler' }]);
    expect(sim.state.enemies.map((e) => e.kind)).toEqual(['prowler']);
    expect(sim.state.elites).toBe(1);
    const [elite] = sim.state.enemies;
    const p = sim.state.player;
    // 화면 밖에서 걸어 들어온다.
    expect(Math.max(Math.abs(elite.x - p.x) - config.viewW / 2, Math.abs(elite.y - p.y) - config.viewH / 2)).toBeGreaterThan(0);
    // 다음 시각까지는 더 나오지 않는다.
    sim.state.t = ELITE.times[1] - 5;
    expect(advance(sim, 2).some((event) => event.type === 'elite')).toBe(false);
    sim.state.t = ELITE.times[1] - 0.05;
    expect(advance(sim, 0.2).filter((event) => event.type === 'elite')).toHaveLength(1);
    // 시각은 밀물과 중간 보스 사이에 있다.
    for (const time of ELITE.times) {
      expect(time).toBeLessThan(RUN_SECONDS);
      for (const surge of SURGES) expect(Math.abs(time - surge)).toBeGreaterThanOrEqual(30);
      expect(time % MID_BOSS_EVERY).toBeGreaterThanOrEqual(30);
      expect(MID_BOSS_EVERY - (time % MID_BOSS_EVERY)).toBeGreaterThanOrEqual(30);
    }
  });

  it('늦게 나오는 정예일수록 튼튼하다', () => {
    const hpAt = (index: number): number => {
      const sim = eliteSim({ stage: 'marsh' });
      sim.state.elites = index;
      sim.state.t = ELITE.times[index] - 0.05;
      advance(sim, 0.2);
      expect(sim.state.enemies.map((e) => e.kind)).toEqual(['lurker']);
      return sim.state.enemies[0].maxHp;
    };
    const first = hpAt(0);
    const last = hpAt(ELITE.times.length - 1);
    expect(first).toBeGreaterThan(ENEMIES.lurker.hp);
    expect(last).toBeGreaterThan(first * 5);
  });

  it('쓰러지면 보물 상자를 떨어뜨린다', () => {
    // 떨어뜨릴 것을 정하는 난수가 무엇이든 상자가 나온다.
    for (const roll of [0.001, 0.0085, 0.5]) {
      const sim = new Sim(eliteSim().state, () => roll);
      sim.state.elites = ELITE.times.length;
      sim.state.enemies.push(enemy('prowler', 100, 0, 0));
      sim.step(STEP, 0, 0);
      expect(sim.state.gems.map((gem) => gem.kind)).toEqual(['xp', 'chest']);
      expect(sim.state.pendingTickets).toBe(0);
    }
  });

  it('잔치의 밤에서는 어느 난이도든 정해진 정예 둘이 무기 강화권을 지니고 온다', () => {
    const carried = (feast: FeastId | null): boolean[] =>
      ELITE.times.map((time, index) => {
        const sim = eliteSim({ feast });
        sim.state.elites = index;
        sim.state.t = time - 0.05;
        advance(sim, 0.2);
        expect(sim.state.enemies).toHaveLength(1);
        return sim.state.enemies[0].ticket === true;
      });
    for (const level of FEAST_ORDER) {
      const feast = carried(level);
      expect(feast).toEqual(ELITE.times.map((_, index) => FEAST.ticketElites.includes(index)));
      expect(feast.filter(Boolean)).toHaveLength(2);
    }
    // 보통 판의 정예는 지니고 오지 않는다.
    expect(carried(null).some(Boolean)).toBe(false);
  });

  it('강화권을 지닌 정예가 쓰러지면 보물 상자와 함께 강화권을 준다', () => {
    const sim = new Sim(eliteSim({ feast: 'normal' }).state, () => 0.5);
    sim.state.elites = ELITE.times.length;
    sim.state.enemies.push({ ...enemy('prowler', 100, 0, 0), ticket: true });
    sim.step(STEP, 0, 0);
    expect(sim.state.gems.map((gem) => gem.kind)).toEqual(['xp', 'chest']);
    expect(sim.state.pendingTickets).toBe(1);
    expect(sim.events.filter((event) => event.type === 'ticket')).toHaveLength(1);
  });

  it('상자를 주우면 가진 무기나 패시브 하나가 한 단계 오른다', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const sim = quietSim(seed);
      sim.state.weapons = { ember: 2, star: MAX_LEVEL, lance: EVOLVE_LEVEL };
      sim.state.passives = { wick: 1, coat: MAX_LEVEL };
      const before = levels(sim);
      const events = openChest(sim);
      expect(sim.state.gems).toHaveLength(0);
      expect(levels(sim)).toBe(before + 1);
      // 새 것을 주지 않고, 다 올린 것이나 진화한 것은 건드리지 않는다.
      expect(Object.keys(sim.state.weapons).sort()).toEqual(['ember', 'lance', 'star']);
      expect(Object.keys(sim.state.passives).sort()).toEqual(['coat', 'wick']);
      expect(sim.state.weapons.star).toBe(MAX_LEVEL);
      expect(sim.state.weapons.lance).toBe(EVOLVE_LEVEL);
      expect(sim.state.passives.coat).toBe(MAX_LEVEL);
      const raised = sim.state.weapons.ember === 3 ? { type: 'weapon', id: 'ember', level: 3 } : { type: 'passive', id: 'wick', level: 2 };
      expect(events).toContainEqual({ type: 'chest', upgrade: raised });
      expect(sim.state.chests).toBe(1);
      expect(sim.state.seen).toContain('chest');
      expect(sim.state.pendingLevelUps).toBe(0);
    }
  });

  it('여러 번 열면 무기와 패시브가 고루 오른다', () => {
    const sim = quietSim(5);
    sim.state.weapons = { ember: 1, star: 1 };
    sim.state.passives = { wick: 1, coat: 1 };
    for (let i = 0; i < 16; i += 1) openChest(sim);
    // 열여섯 번이면 넷이 모두 끝까지 오른다.
    expect(sim.state.weapons).toEqual({ ember: MAX_LEVEL, star: MAX_LEVEL });
    expect(sim.state.passives).toEqual({ wick: MAX_LEVEL, coat: MAX_LEVEL });
    expect(sim.state.chests).toBe(16);
  });

  it('더 올릴 것이 없으면 불씨를 준다', () => {
    const sim = quietSim();
    sim.state.weapons = { ember: MAX_LEVEL, star: EVOLVE_LEVEL };
    sim.state.passives = {};
    const events = openChest(sim);
    expect(events).toContainEqual({ type: 'chest', upgrade: null });
    expect(sim.state.bonusEmbers).toBe(CHEST.embers);
    expect(sim.state.weapons).toEqual({ ember: MAX_LEVEL, star: EVOLVE_LEVEL });
    expect(sim.state.chests).toBe(1);
  });

  it('상자가 올려 준 뒤에는 뽑아 둔 레벨업 선택지를 다시 맞춘다', () => {
    const sim = quietSim(2);
    sim.state.weapons = { ember: 1 };
    sim.state.passives = {};
    sim.state.offer = [
      { type: 'weapon', id: 'ember', level: 2 },
      { type: 'weapon', id: 'star', level: 1 },
      { type: 'passive', id: 'wick', level: 1 },
    ];
    openChest(sim);
    expect(sim.state.weapons.ember).toBe(2);
    sim.state.pendingLevelUps = 1;
    // 이미 오른 단계를 다시 권하지 않는다.
    expect(sim.options()).not.toContainEqual({ type: 'weapon', id: 'ember', level: 2 });
  });

  it('등불 기둥과 불구멍, 불꽃 단지에는 보통 그림자보다 훨씬 덜 다친다', () => {
    // 불꽃 단지: 보통 그림자는 쓰러지고 정예는 체력의 절반을 잃는다.
    const sim = eliteSim();
    sim.state.elites = ELITE.times.length;
    const elite = enemy('prowler', 60, 0, 1000);
    const shade = enemy('shade', -60, 0, 1000);
    sim.state.enemies.push(elite, shade);
    sim.state.gems.push({ x: 0, y: 0, value: 0, kind: 'blast', pulled: false });
    sim.step(STEP, 0, 0);
    expect(shade.hp).toBeLessThanOrEqual(0);
    expect(elite.hp).toBe(1000 * (1 - ELITE.blast));

    // 등불 기둥: 켜져 있는 내내 빛 속에 있어야 쓰러진다.
    const lit = eliteSim();
    lit.state.elites = ELITE.times.length;
    lit.state.posts = [{ x: 0, y: 30, lit: POSTS.seconds, tick: 0 }];
    const burned = enemy('stoker', 0, 30, 1000);
    const plain = enemy('slag', 2, 32, 1000);
    lit.state.enemies.push(burned, plain);
    advance(lit, 3);
    expect(lit.state.enemies).not.toContain(plain);
    expect(burned.hp).toBeGreaterThan(1000 * 0.6);
    expect(burned.hp).toBeLessThan(1000);
    expect(ELITE.burn * (POSTS.seconds / POSTS.tick)).toBeGreaterThanOrEqual(1);
    expect(ELITE.burn).toBeLessThan(POSTS.burn / 3);
    expect(ELITE.vent).toBeLessThan(VENT.share / 3);
  });

  it('끝없는 밤에는 나오지 않는다', () => {
    const sim = eliteSim();
    sim.state.t = RUN_SECONDS + 30;
    sim.state.endless = { at: RUN_SECONDS, kills: 0, bosses: 99, surges: 99, boons: 99 };
    sim.state.elites = 2;
    const events = advance(sim, 1);
    expect(events.some((event) => event.type === 'elite')).toBe(false);
    expect(sim.state.enemies.filter((e) => ENEMIES[e.kind].elite)).toHaveLength(0);
  });

  it('정예가 생기기 전에 저장한 판을 이어 해도 지난 시각의 정예가 한꺼번에 나오지 않는다', () => {
    const old = JSON.parse(JSON.stringify(createRun(config))) as RunState;
    delete old.elites;
    delete old.chests;
    old.t = ELITE.times[2] + 5;
    old.spawnDebt = -1e6;
    const sim = newSim(1, old);
    expect(sim.state.elites).toBe(3);
    sim.step(STEP, 0, 0);
    expect(sim.events.some((event) => event.type === 'elite')).toBe(false);
    // 남은 것은 제때 나온다.
    sim.state.player.inv = 1e9;
    sim.state.t = ELITE.times[3] - 0.05;
    expect(advance(sim, 0.2).filter((event) => event.type === 'elite')).toHaveLength(1);
  });
});

describe('잔치의 밤', () => {
  it('고르고 시작한 판만 무기 여섯 칸이고, 판의 기록에도 난이도가 남는다', () => {
    const plain = newSim(1);
    expect(plain.state.feast).toBeUndefined();
    expect(plain.slots).toBe(MAX_WEAPONS);
    expect('feast' in plain.summary()).toBe(false);
    expect(createRun({ ...config, feast: null }).feast).toBeUndefined();

    for (const level of FEAST_ORDER) {
      const feast = newSim(1, createRun({ ...config, feast: level }));
      expect(feast.state.feast).toBe(level);
      expect(feast.slots).toBe(FEAST.weapons);
      expect(feast.summary().feast).toBe(level);
      // 저장했다가 이어 해도 그대로다.
      const copy = JSON.parse(JSON.stringify(feast.state)) as RunState;
      expect(looksLikeRun(copy)).toBe(true);
      expect(newSim(2, copy).slots).toBe(FEAST.weapons);
    }
  });

  it('빛 조각에서 난이도만큼 경험치를 더 받는다', () => {
    const gain = (feast: FeastId | null): number => {
      const sim = quietSim(1, { feast });
      const p = sim.state.player;
      sim.state.gems.push({ x: p.x, y: p.y, value: 2, kind: 'xp', pulled: false });
      sim.step(STEP, 0, 0);
      expect(p.level).toBe(1);
      return p.xp;
    };
    const plain = gain(null);
    expect(plain).toBeGreaterThan(0);
    for (const level of FEAST_ORDER) expect(gain(level)).toBeCloseTo(plain * FEAST_LEVELS[level].xp, 6);
  });

  it('무기를 넷 들고도 레벨업에 새 무기가 나오고, 여섯을 들면 더 나오지 않는다', () => {
    const offered = (feast: FeastId | null, weapons: RunState['weapons']): Set<string> => {
      const fresh = new Set<string>();
      for (let seed = 1; seed <= 60; seed += 1) {
        const sim = quietSim(seed, { feast });
        sim.state.weapons = { ...weapons };
        sim.state.pendingLevelUps = 1;
        for (const option of sim.options()) {
          if (option.type === 'weapon' && !weapons[option.id]) fresh.add(option.id);
        }
      }
      return fresh;
    };
    const four = { ember: 1, aura: 1, lance: 1, bolt: 1 };
    expect(offered(null, four).size).toBe(0);
    expect(offered('hard', four).size).toBeGreaterThan(0);
    expect(offered('hard', { ...four, star: 1, moon: 1 }).size).toBe(0);
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

describe('끝없는 밤', () => {
  /** 마지막 보스만 남은 판. 끝없는 밤으로 이어 갈 수 있다. */
  const atDawn = (extra: Partial<Parameters<typeof createRun>[0]> = {}): Sim => {
    const sim = quietSim(1, { endless: true, ...extra });
    sim.state.t = RUN_SECONDS + 20;
    sim.state.weapons = { ember: 1 };
    sim.state.enemies.push(enemy(STAGES[sim.state.stage].finalBoss, 30, 0, 1));
    advance(sim, 2);
    return sim;
  };

  it('마지막 보스를 쓰러뜨리면 판이 끝나지 않고 고를 때까지 멈춘다', () => {
    const sim = atDawn();
    expect(sim.state.over).toBeNull();
    expect(sim.state.pendingDawn).toBe(true);
    expect(sim.dawned).toBe(true);
    expect(runDawned(sim.state)).toBe(true);
    // 고르기 전에는 시간이 흐르지 않는다.
    const t = sim.state.t;
    advance(sim, 3);
    expect(sim.state.t).toBe(t);
    // 이때 저장해도 이어서 할 수 있고, 같은 선택이 다시 나온다.
    const copy = JSON.parse(JSON.stringify(sim.state)) as RunState;
    expect(looksLikeRun(copy)).toBe(true);
    expect(restoreRun(copy)?.pendingDawn).toBe(true);
  });

  it('끝없는 밤을 켜지 않은 판은 전처럼 새벽에서 바로 끝난다', () => {
    const sim = quietSim();
    sim.state.weapons = { ember: 1 };
    sim.state.enemies.push(enemy(STAGES.meadow.finalBoss, 30, 0, 1));
    advance(sim, 2);
    expect(sim.state.over).toBe('cleared');
    expect(sim.state.pendingDawn).toBeUndefined();
    expect(runDawned(createRun(config))).toBe(false);
    expect(runDawned(null)).toBe(false);
  });

  it('여기서 마치면 새벽을 맞은 판으로 끝난다', () => {
    const sim = atDawn();
    const before = sim.summary();
    sim.chooseDawn(false);
    expect(sim.state.over).toBe('cleared');
    expect(sim.state.pendingDawn).toBe(false);
    expect(sim.state.endless).toBeUndefined();
    expect(sim.summary()).toEqual(before);
    expect(before).toMatchObject({ cleared: true, seconds: RUN_SECONDS, endlessSeconds: 0 });
    // 이미 고른 뒤에는 다시 고를 수 없다.
    sim.chooseDawn(true);
    expect(sim.state.endless).toBeUndefined();
  });

  it('이어 가면 시간이 다시 흐르고, 버틴 만큼 점수와 불씨가 는다', () => {
    const sim = atDawn();
    const dawn = sim.summary();
    sim.chooseDawn(true);
    expect(sim.state.over).toBeNull();
    expect(sim.state.endless).toMatchObject({ at: sim.state.t, bosses: 0, surges: 0 });
    sim.state.player.inv = 1e9;
    sim.state.spawnDebt = 0;
    advance(sim, 61);
    const later = sim.summary();
    expect(sim.endlessSeconds).toBeCloseTo(61, 0);
    expect(later.endlessSeconds).toBeCloseTo(61, 0);
    expect(later.seconds).toBeCloseTo(RUN_SECONDS + 61, 0);
    expect(later.cleared).toBe(true);
    // 끝없는 밤에서 쓰러뜨린 것은 다시 센다.
    expect(sim.state.kills).toBeGreaterThan(dawn.kills);
    expect(later.countedKills - dawn.countedKills).toBe(sim.state.kills - dawn.kills);
    expect(scoreFor(later)).toBeGreaterThan(scoreFor(dawn));
    expect(embersFor(later)).toBeGreaterThan(embersFor(dawn));
  });

  it('끝없는 밤에서 쓰러져도 새벽을 맞은 기록은 남는다', () => {
    const sim = atDawn();
    const dawn = sim.summary();
    sim.chooseDawn(true);
    sim.state.weapons = {};
    sim.state.player.hp = 1;
    sim.state.enemies.push(enemy('wisp', 0, 0, 1e6));
    advance(sim, 2);
    expect(sim.state.over).toBe('dead');
    const end = sim.summary();
    expect(end.cleared).toBe(true);
    expect(scoreFor(end)).toBeGreaterThanOrEqual(scoreFor(dawn));
    // 끝난 판은 마칠 것이 없다.
    sim.settle();
    expect(sim.state.over).toBe('dead');
  });

  it('그림자는 분마다 튼튼해진다', () => {
    const sim = atDawn();
    sim.chooseDawn(true);
    sim.state.weapons = {};
    sim.state.player.inv = 1e9;
    sim.state.spawnDebt = 0;
    advance(sim, 1);
    const hpOf = (): Map<string, number> => new Map(sim.state.enemies.map((e) => [e.kind, e.maxHp]));
    const early = hpOf();
    // 끝없는 밤에 들어선 지 3분이 지난 것으로 친다.
    sim.state.enemies.length = 0;
    if (sim.state.endless) sim.state.endless.at -= 180;
    advance(sim, 1);
    const late = hpOf();
    const shared = [...late.keys()].filter((kind) => early.has(kind));
    expect(shared.length).toBeGreaterThan(0);
    // 3분이면 체력이 ENDLESS.hp의 세제곱 배다.
    for (const kind of shared) {
      expect((late.get(kind) ?? 0) / (early.get(kind) ?? 1)).toBeCloseTo(ENDLESS.hp ** 3, 0);
    }
  });

  it('보스가 정해진 간격으로 차례대로 돌아오고, 강화권을 준다', () => {
    const sim = atDawn();
    sim.chooseDawn(true);
    sim.state.weapons = {};
    sim.state.player.inv = 1e9;
    advance(sim, ENDLESS.bossEvery - 1);
    const bosses = (): Enemy[] => sim.state.enemies.filter((e) => ENEMIES[e.kind].boss);
    expect(bosses()).toHaveLength(0);
    advance(sim, 2);
    expect(bosses().map((e) => e.kind)).toEqual([endlessBossKind('meadow', 0)]);
    expect(sim.state.endless?.bosses).toBe(1);
    // 끝없는 밤의 보스는 마지막 보스가 아니다. 쓰러뜨리면 새벽이 다시 오지 않고 강화권을 받는다.
    const boss = bosses()[0];
    boss.hp = 1;
    boss.x = 30;
    boss.y = 0;
    sim.state.weapons = { ember: 1 };
    const tickets: SimEvent[] = [];
    for (let i = 0; i < 120 && tickets.length === 0; i += 1) {
      sim.step(STEP, 0, 0);
      tickets.push(...sim.events.filter((event) => event.type === 'ticket'));
    }
    expect(tickets).toHaveLength(1);
    expect(sim.state.over).toBeNull();
    expect(sim.state.pendingDawn).toBe(false);
    // 스테이지의 중간 보스 세 가지가 돌아가며 나온다.
    const kinds = [0, 1, 2, 3].map((index) => endlessBossKind('meadow', index));
    expect(new Set(kinds.slice(0, 3)).size).toBe(3);
    for (const kind of kinds) expect(STAGES.meadow.midBosses).toContain(kind);
    expect(kinds[3]).toBe(kinds[0]);
  });

  it('들어서면 밤의 축복 하나를 고를 때까지 멈춘다', () => {
    const sim = atDawn();
    expect(sim.pendingBoons).toBe(0);
    sim.chooseDawn(true);
    expect(sim.pendingBoons).toBe(1);
    const t = sim.state.t;
    sim.step(STEP, 0, 0);
    expect(sim.state.t).toBe(t);
    // 여섯 가지 가운데 서로 다른 셋이 나오고, 고를 때까지 같은 것이 나온다.
    const choices = sim.boonChoices();
    expect(choices).toHaveLength(3);
    expect(new Set(choices.map((u) => (u.type === 'boon' ? u.id : ''))).size).toBe(3);
    for (const upgrade of choices) expect(upgrade).toMatchObject({ type: 'boon', level: 1 });
    expect(sim.boonChoices()).toEqual(choices);
    // 고르던 채로 저장했다가 이어도 같은 선택지다(나갔다 들어와서 다시 뽑지 못한다).
    const copy = JSON.parse(JSON.stringify(sim.state)) as RunState;
    expect(newSim(99, copy).boonChoices()).toEqual(choices);

    const picked = choices[1];
    sim.takeBoon(picked);
    expect(sim.pendingBoons).toBe(0);
    expect(sim.state.boons).toEqual(picked.type === 'boon' ? { [picked.id]: 1 } : {});
    expect(sim.state.boonOffer).toBeUndefined();
    sim.step(STEP, 0, 0);
    expect(sim.state.t).toBeGreaterThan(t);
  });

  it('그림자가 세지는 1분마다 축복을 하나씩 더 고른다', () => {
    const sim = atDawn();
    sim.chooseDawn(true);
    sim.takeBoon(sim.boonChoices()[0]);
    sim.state.weapons = {};
    sim.state.player.inv = 1e9;
    const events: SimEvent[] = [];
    for (let i = 0; i < 61 / STEP && sim.pendingBoons === 0; i += 1) {
      sim.step(STEP, 0, 0);
      events.push(...sim.events);
    }
    expect(sim.endlessSeconds).toBeCloseTo(ENDLESS.boonEvery, 0);
    expect(sim.pendingBoons).toBe(1);
    expect(sim.state.endless?.boons).toBe(2);
    expect(events.filter((event) => event.type === 'boon')).toHaveLength(1);
    // 같은 축복을 다시 받으면 겹친다.
    const first = Object.keys(sim.state.boons ?? {})[0];
    sim.state.boonOffer = [{ type: 'boon', id: first as (typeof BOON_ORDER)[number], level: 2 }];
    sim.takeBoon(sim.boonChoices()[0]);
    expect(sim.state.boons).toEqual({ [first]: 2 });
    expect(sim.boonChoices().every((u) => u.type === 'boon' && u.level === (u.id === first ? 3 : 1))).toBe(true);
  });

  it('두꺼운 솜옷은 최대 체력을 늘리고 그만큼 채워 준다', () => {
    const sim = atDawn();
    sim.chooseDawn(true);
    sim.state.player.hp = 50;
    const before = sim.maxHp;
    sim.takeBoon({ type: 'boon', id: 'bulwark', level: 1 });
    expect(sim.maxHp).toBe(before + BOON_VALUES.bulwark);
    expect(sim.state.player.hp).toBe(50 + BOON_VALUES.bulwark);
  });

  it('끝없는 밤에서는 레벨업과 강화권의 빈자리도 축복이 채운다', () => {
    const maxed = (sim: Sim): void => {
      sim.state.weapons = Object.fromEntries(WEAPON_ORDER.slice(0, MAX_WEAPONS).map((id) => [id, EVOLVE_LEVEL]));
      sim.state.passives = Object.fromEntries(
        (Object.keys(PASSIVES) as PassiveId[]).slice(0, MAX_PASSIVES).map((id) => [id, MAX_LEVEL]),
      );
    };
    // 새벽 전에는 전처럼 회복과 불씨다.
    const plain = quietSim();
    maxed(plain);
    plain.state.pendingLevelUps = 1;
    expect(plain.options().map((u) => u.type)).toEqual(['heal', 'embers']);
    expect(plain.ticketChoices().map((u) => u.type)).toEqual(['heal', 'embers']);

    const sim = atDawn();
    sim.chooseDawn(true);
    sim.takeBoon(sim.boonChoices()[0]);
    maxed(sim);
    sim.state.pendingLevelUps = 1;
    const options = sim.options();
    expect(options).toHaveLength(3);
    expect(options.every((u) => u.type === 'boon')).toBe(true);
    const before = { ...sim.state.boons };
    sim.applyUpgrade(options[0]);
    expect(sim.state.pendingLevelUps).toBe(0);
    expect(Object.values(sim.state.boons ?? {}).reduce((a, b) => a + (b ?? 0), 0)).toBe(
      Object.values(before).reduce((a, b) => a + (b ?? 0), 0) + 1,
    );
    // 강화권도 올릴 무기가 없으면 축복을 고른다.
    sim.state.pendingTickets = 1;
    const tickets = sim.ticketChoices();
    expect(tickets.every((u) => u.type === 'boon')).toBe(true);
    sim.useTicket(tickets[0]);
    expect(sim.state.pendingTickets).toBe(0);
    // 올릴 무기가 남아 있으면 강화권은 무기를 올린다.
    sim.state.weapons = { ember: MAX_LEVEL };
    expect(sim.ticketChoices()).toEqual([{ type: 'weapon', id: 'ember', level: EVOLVE_LEVEL }]);
  });

  it('축복이 생기기 전에 저장한 끝없는 밤은 밀린 축복을 받는다', () => {
    const sim = atDawn();
    sim.chooseDawn(true);
    sim.takeBoon(sim.boonChoices()[0]);
    const old = JSON.parse(JSON.stringify(sim.state)) as RunState;
    delete old.boons;
    delete old.pendingBoons;
    if (old.endless) {
      delete old.endless.boons;
      old.endless.at -= 130;
    }
    const resumed = newSim(3, old);
    resumed.state.player.inv = 1e9;
    let taken = 0;
    for (let i = 0; i < 20; i += 1) {
      while (resumed.pendingBoons > 0) {
        resumed.takeBoon(resumed.boonChoices()[0]);
        taken += 1;
      }
      resumed.step(STEP, 0, 0);
    }
    // 들어설 때의 하나와 1분, 2분의 것까지 셋이다.
    expect(taken).toBe(3);
    expect(resumed.state.endless?.boons).toBe(3);
  });

  it('세진 그림자는 종소리에 덜 밀린다', () => {
    /** 끝없는 밤에 들어선 지 minutes분이 지났을 때, 종소리 한 번에 밀려난 거리 */
    const pushed = (minutes: number): number => {
      const ring = (weapons: RunState['weapons']): number => {
        const sim = quietSim();
        sim.state.weapons = weapons;
        sim.state.cd.bell = 0;
        sim.state.player.inv = 1e9;
        sim.state.enemies.push(enemy('brute', 30, 0, 1e6));
        sim.state.endless = { at: sim.state.t - minutes * 60, kills: 0, bosses: 99, surges: 99, boons: 99 };
        advance(sim, 0.6);
        return sim.state.enemies[0].x;
      };
      return ring({ bell: 1 }) - ring({});
    };
    const early = pushed(0);
    const late = pushed(4);
    expect(early).toBeGreaterThan(10);
    expect(late).toBeGreaterThan(0);
    expect(late / early).toBeCloseTo(1 / ENDLESS.damage ** 4, 1);
  });

  it('하던 판을 그 자리에서 마칠 수 있다', () => {
    // 고르는 중이던 판
    const choosing = atDawn();
    choosing.settle();
    expect(choosing.state.over).toBe('cleared');
    expect(choosing.state.pendingDawn).toBe(false);
    // 끝없는 밤으로 이어 간 판
    const going = atDawn();
    going.chooseDawn(true);
    going.state.player.inv = 1e9;
    advance(going, 30);
    going.settle();
    expect(going.state.over).toBe('cleared');
    expect(going.summary().endlessSeconds).toBeCloseTo(30, 0);
    // 새벽을 맞지 않은 판은 그대로다.
    const young = newSim();
    young.settle();
    expect(young.state.over).toBeNull();
  });

  it('끝없는 밤 도중에 저장한 판도 그대로 이어진다', () => {
    const sim = atDawn();
    sim.chooseDawn(true);
    sim.state.player.inv = 1e9;
    advance(sim, 20);
    const copy = JSON.parse(JSON.stringify(sim.state)) as RunState;
    expect(looksLikeRun(copy)).toBe(true);
    const restored = restoreRun(copy);
    expect(restored?.endless).toEqual(sim.state.endless);
    const resumed = newSim(7, restored as RunState);
    advance(resumed, 5);
    expect(resumed.endlessSeconds).toBeCloseTo(25, 0);
    expect(runDawned(resumed.state)).toBe(true);
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

  it('종소리와 초승달이 생기기 전에 저장한 판도 그대로 이어진다', () => {
    const state = createRun(config);
    const old = JSON.parse(JSON.stringify(state)) as Record<string, unknown> & { cd: Record<string, number> };
    delete old.waves;
    delete old.moons;
    delete old.cd.bell;
    delete old.cd.moon;
    const restored = restoreRun(old);
    expect(restored).not.toBeNull();
    const sim = newSim(1, restored as RunState);
    expect(sim.state.waves).toEqual([]);
    expect(sim.state.moons).toEqual([]);
    // 등대빛이 생기기 전에 저장한 판에는 빛줄기가 가리키는 쪽이 없다.
    expect(sim.state.beamAngle).toBeUndefined();
    sim.state.weapons = { bell: 1, moon: 1, beam: 1 };
    expect(() => advance(sim, 5)).not.toThrow();
    expect(Number.isFinite(sim.state.beamAngle)).toBe(true);
    expect(Number.isFinite(sim.state.cd.bell)).toBe(true);
    expect(Number.isFinite(sim.state.cd.moon)).toBe(true);
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
    // 캐릭터 다섯과 스테이지 넷으로 스무 판을 돌리므로 넉넉히 기다린다.
  }, 30000);

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

  it('잔치의 밤에서는 같은 영구 강화로 무기 여섯을 다 들고, 보통 판에서 드는 것보다 많이 진화한다', () => {
    const meta = { vigor: 5, swift: 5, might: 5, greed: 5, reach: 3 };
    const result = playRun(1, 'kite', { ...config, meta, feast: 'normal' }, 600);
    expect(result.over).toBeNull();
    expect(result.feast).toBe('normal');
    const levels = Object.values(result.weapons);
    expect(levels).toHaveLength(FEAST.weapons);
    expect(levels.filter((level) => level === EVOLVE_LEVEL).length).toBeGreaterThan(MAX_WEAPONS);
    // 쉬울수록 같은 때에 레벨이 높다.
    const easy = playRun(1, 'kite', { ...config, meta, feast: 'easy' }, 300);
    const hard = playRun(1, 'kite', { ...config, meta, feast: 'hard' }, 300);
    expect(easy.level).toBeGreaterThan(hard.level);
  }, 30000);

  it('적의 수가 상한을 크게 넘지 않는다', () => {
    const result = playRun(4, 'kite', { ...config, meta: { vigor: 5, might: 5, swift: 5 } }, 400);
    expect(result.peakEnemies).toBeLessThanOrEqual(maxAlive(RUN_SECONDS) + 80);
  });
});
