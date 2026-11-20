import { describe, expect, it } from 'vitest';
import { botInput, buyCheapest, playCareer, playRun } from './bot';
import { CHARGE, DAY, DIG, ENEMIES, FIELD, GUN, HOP, SHOOTER, SPLIT, STORM, SUMMON, WEB, type EnemyKind } from './data';
import { allyDamage, fruitFor } from './allies';
import { clearBonus, createMeta, hpScale, recordBonus, type Levels } from './rules';
import {
  autoAim,
  chargePhase,
  clampAim,
  createRun,
  isBuried,
  runScore,
  step,
  stopYOf,
  stormReady,
  type Enemy,
  type Input,
  type RunState,
  type SimEvent,
} from './sim';

const DT = 1 / 60;

/** 판을 만들고, 첫날 앞에 열린 동료 가게를 아무것도 사지 않고 닫아서 첫날을 시작한다. */
function start(levels: Levels = {}, startDay = 1, bestBefore = 0, seed = 11): RunState {
  const { state } = createRun({ seed, startDay, levels, bestBefore });
  step(state, 0, { aim: null, storm: false, ready: true });
  return state;
}

/** 그날 나올 벌레를 모두 치우고 빈 판으로 만든다. 벌레를 손으로 놓아 보는 테스트에 쓴다. */
function emptied(levels: Levels = {}, startDay = 1): RunState {
  const state = start(levels, startDay);
  state.queue = [];
  state.dayTotal = 0;
  return state;
}

function put(state: RunState, kind: EnemyKind, x: number, y: number, hp = 1e6): Enemy {
  const enemy: Enemy = {
    id: state.nextId++,
    kind,
    x,
    y,
    homeX: x,
    hp,
    maxHp: hp,
    day: state.day,
    biting: false,
    biteIn: ENEMIES[kind].biteEvery,
    clock: 0,
    slow: 0,
    slowLeft: 0,
    summonIn: SUMMON.every,
    flash: 0,
  };
  state.enemies.push(enemy);
  state.dayTotal += 1;
  return enemy;
}

/** seconds초 동안 돌리고 그동안 일어난 일을 모은다. */
function run(state: RunState, seconds: number, input?: Input): SimEvent[] {
  const events: SimEvent[] = [];
  for (let time = 0; time < seconds && state.phase !== 'over'; time += DT) events.push(...step(state, DT, input));
  return events;
}

const count = (events: SimEvent[], type: SimEvent['type']): number => events.filter((event) => event.type === type).length;

describe('판의 시작', () => {
  it('고른 날에서, 울타리가 가득 찬 채로, 동료 가게를 먼저 열고 시작한다', () => {
    const { state, events } = createRun({ seed: 3, startDay: 6, levels: { fence: 2 }, bestBefore: 7 });
    expect(events).toEqual([{ type: 'shop' }]);
    expect(state.day).toBe(6);
    // 가게를 닫기 전에는 벌레가 오지 않는다.
    expect(state.phase).toBe('rest');
    expect(state.shopping).toBe(true);
    run(state, 5);
    expect(state.phase).toBe('rest');
    expect(state.enemies).toEqual([]);
    expect(step(state, DT, { aim: null, storm: false, ready: true })).toContainEqual({ type: 'dayStart', day: 6, boss: false });
    expect(state.day).toBe(6);
    expect(state.phase).toBe('fight');
    expect(state.fence).toBe(state.stats.fenceMax);
    expect(state.queue.length).toBe(state.dayTotal);
    expect(state.lastCleared).toBe(0);
    expect(runScore(state)).toBe(0);
  });

  it('같은 씨앗과 같은 조작이면 같은 판이 된다', () => {
    const play = (): RunState => {
      const state = start({ crit: 3, helper: 1, fork: 1 }, 1, 0, 42);
      run(state, 25, { aim: { x: 60, y: 100 }, storm: false });
      run(state, 10);
      return state;
    };
    expect(JSON.stringify(play())).toBe(JSON.stringify(play()));
  });
});

describe('물총', () => {
  it('손을 떼고 있으면 울타리에 가장 가까운 벌레를 저절로 쏜다', () => {
    const state = emptied();
    put(state, 'ant', 40, 100);
    const near = put(state, 'ant', 200, 250);
    const target = autoAim(state, SHOOTER);
    expect(target?.x).toBe(near.x);
    // 물방울이 날아가는 동안 내려올 만큼 앞을 겨눈다.
    expect(target?.y).toBeGreaterThan(near.y);
    const events = run(state, 3);
    expect(count(events, 'fire')).toBeGreaterThan(3);
    expect(near.hp).toBeLessThan(near.maxHp);
    expect(state.manual).toBe(false);
  });

  it('겨눌 벌레가 없으면 쏘지 않고, 직접 겨누면 벌레가 없어도 쏜다', () => {
    const idle = emptied();
    put(idle, 'snail', 120, -40); // 아직 판 밖이다.
    expect(count(run(idle, 1), 'fire')).toBe(0);

    const held = emptied();
    put(held, 'snail', 120, -40);
    expect(count(run(held, 1, { aim: { x: 30, y: 200 }, storm: false }), 'fire')).toBeGreaterThan(0);
    expect(held.manual).toBe(true);
  });

  it('직접 겨누는 동안에는 더 빨리 쏜다', () => {
    const shots = (input?: Input): number => {
      const state = emptied();
      put(state, 'snail', 120, 20);
      return count(run(state, 12, input), 'fire');
    };
    const auto = shots();
    const manual = shots({ aim: { x: 120, y: 20 }, storm: false });
    expect(manual / auto).toBeGreaterThan(1.25);
    expect(manual / auto).toBeLessThan(1 / GUN.manualRate + 0.1);
  });

  it('아래쪽은 겨눌 수 없다', () => {
    expect(clampAim(-Math.PI / 2)).toBe(-Math.PI / 2);
    expect(clampAim(0.5)).toBe(-GUN.minLift);
    expect(clampAim(Math.PI - 0.5)).toBe(-Math.PI + GUN.minLift);
    expect(clampAim(-0.01)).toBe(-GUN.minLift);
  });

  it('껍데기가 있는 풍뎅이는 반만 받고, 크게 맞히면 다 받는다', () => {
    const plain = emptied();
    const beetle = put(plain, 'beetle', SHOOTER.x, 250);
    const first = run(plain, 0.8).find((event) => event.type === 'hit');
    expect(first).toMatchObject({ type: 'hit', crit: false, shell: true });
    expect(beetle.maxHp - beetle.hp).toBeCloseTo(plain.stats.damage * (ENEMIES.beetle.shell ?? 1), 5);

    const sharp = emptied({ crit: 1 });
    sharp.stats.critChance = 1;
    const other = put(sharp, 'beetle', SHOOTER.x, 250);
    const hit = run(sharp, 0.8).find((event) => event.type === 'hit');
    expect(hit).toMatchObject({ type: 'hit', crit: true, shell: false });
    expect(other.maxHp - other.hp).toBeCloseTo(sharp.stats.damage * GUN.critMult, 5);
  });

  it('뚫는 물줄기는 뒤의 벌레도 맞히고, 같은 벌레를 두 번 맞히지는 않는다', () => {
    const hits = (levels: Levels): [number, number] => {
      const state = emptied(levels);
      const front = put(state, 'snail', SHOOTER.x, 280);
      const back = put(state, 'snail', SHOOTER.x, 240);
      // 한 발만 쏘게 한다.
      run(state, 0.45);
      state.fireIn = 99;
      run(state, 1);
      return [front.maxHp - front.hp, back.maxHp - back.hp];
    };
    const [frontPlain, backPlain] = hits({});
    expect(frontPlain).toBeGreaterThan(0);
    expect(backPlain).toBe(0);
    const [front, back] = hits({ pierce: 1 });
    expect(front).toBeCloseTo(frontPlain, 5);
    expect(back).toBeCloseTo(frontPlain, 5);
  });

  it('갈래 물총은 한 번에 여러 줄기를 쏘고, 곁가지는 약하다', () => {
    const state = emptied({ fork: 2 });
    put(state, 'snail', SHOOTER.x, 20);
    run(state, 0.45);
    expect(state.shots).toHaveLength(3);
    const damages = state.shots.map((shot) => shot.damage).sort((a, b) => b - a);
    expect(damages[0]).toBe(state.stats.damage);
    expect(damages[1]).toBeCloseTo(state.stats.damage * GUN.forkDamage, 5);
    expect(new Set(state.shots.map((shot) => shot.vx.toFixed(3))).size).toBe(3);
  });

  it('물보라는 둘레의 벌레를 적시고, 찬물은 맞은 벌레를 늦춘다', () => {
    const state = emptied({ splash: 2, chill: 2 });
    const target = put(state, 'snail', SHOOTER.x, 270);
    const beside = put(state, 'snail', SHOOTER.x + 24, 262);
    const far = put(state, 'snail', 20, 100);
    run(state, 0.45);
    state.fireIn = 99;
    run(state, 0.5);
    const dealt = target.maxHp - target.hp;
    expect(dealt).toBeCloseTo(state.stats.damage, 5);
    expect(beside.maxHp - beside.hp).toBeCloseTo(dealt * state.stats.splashRatio, 5);
    expect(far.hp).toBe(far.maxHp);
    expect(target.slowLeft).toBeGreaterThan(0);
    expect(target.slow).toBe(state.stats.chill);
    expect(beside.slowLeft).toBe(0);
  });

  it('해바라기 모종을 사 두면 해바라기와 함께 시작하고, 그 씨에는 물총의 물보라와 찬물이 붙지 않는다', () => {
    const state = emptied({ helper: 2, splash: 3, chill: 3 });
    expect(state.allies).toEqual([expect.objectContaining({ id: 'sunflower', copies: 2 })]);
    state.fireIn = 999; // 물총은 쉬게 한다.
    const near = put(state, 'snail', 70, 300);
    const events = run(state, 2.5);
    expect(events.filter((event) => event.type === 'fire' && event.ally === 'sunflower').length).toBeGreaterThan(1);
    expect(near.hp).toBeLessThan(near.maxHp);
    const hits = (near.maxHp - near.hp) / allyDamage('sunflower', 2, state.stats.damage, state.stats.allyPower);
    expect(hits).toBeCloseTo(Math.round(hits), 5);
    expect(near.slowLeft).toBe(0);
  });
});

describe('벌레', () => {
  it('울타리에 닿으면 멈춰서 갉고, 울타리가 다 갉히면 판이 끝난다', () => {
    const state = emptied();
    state.fireIn = 1e9;
    const ant = put(state, 'ant', 100, FIELD.depth - 30);
    const events = run(state, 200);
    expect(ant.biting).toBe(true);
    expect(ant.y).toBe(FIELD.depth - ENEMIES.ant.radius);
    expect(count(events, 'bite')).toBe(Math.ceil(state.stats.fenceMax / ENEMIES.ant.bite));
    expect(events[events.length - 1]).toEqual({ type: 'over' });
    expect(state.phase).toBe('over');
    expect(state.fence).toBe(0);
    // 끝난 판은 더 나아가지 않는다.
    const time = state.t;
    expect(step(state, DT)).toEqual([]);
    expect(state.t).toBe(time);
  });

  it('가시 울타리는 갉은 벌레에게 피해를 되갚는다', () => {
    const state = emptied({ thorn: 2 });
    state.fireIn = 1e9;
    const ant = put(state, 'ant', 100, FIELD.depth - ENEMIES.ant.radius, 1000);
    const events = run(state, ENEMIES.ant.biteEvery + 0.1);
    expect(count(events, 'bite')).toBe(1);
    expect(ant.maxHp - ant.hp).toBeCloseTo(state.stats.thorns, 5);
    expect(state.stats.thorns).toBeGreaterThan(0);
  });

  it('찬물에 젖으면 느리게 내려온다', () => {
    const walk = (slow: number): number => {
      const state = emptied();
      state.fireIn = 1e9;
      const ant = put(state, 'ant', 100, 0);
      ant.slow = slow;
      ant.slowLeft = 99;
      run(state, 2);
      return ant.y;
    };
    expect(walk(0)).toBeCloseTo(ENEMIES.ant.speed * 2, 0);
    expect(walk(0.5)).toBeCloseTo(ENEMIES.ant.speed, 0);
  });

  it('메뚜기는 쉬다가 뛰지만 평균 걸음은 적힌 속도와 같다', () => {
    const state = emptied();
    state.fireIn = 1e9;
    const hopper = put(state, 'hopper', 100, 0);
    const before = hopper.y;
    // 쉬고 뛰는 박자를 꼭 다섯 번 채운다.
    const frames = Math.round(((HOP.rest + HOP.leap) * 5) / DT);
    let stood = 0;
    for (let frame = 0; frame < frames; frame += 1) {
      const y = hopper.y;
      step(state, DT);
      if (hopper.y === y) stood += 1;
    }
    expect(stood).toBeGreaterThan(frames * 0.4);
    const pace = (hopper.y - before) / (frames * DT);
    expect(Math.abs(pace - ENEMIES.hopper.speed) / ENEMIES.hopper.speed).toBeLessThan(0.08);
  });

  it('꿀벌은 좌우로 흔들리며 내려오고 판 밖으로 나가지 않는다', () => {
    const state = emptied();
    state.fireIn = 1e9;
    const bee = put(state, 'bee', 30, 0);
    const xs: number[] = [];
    for (let time = 0; time < 4; time += DT) {
      step(state, DT);
      xs.push(bee.x);
    }
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(10);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(ENEMIES.bee.radius);
  });

  it('날이 갈수록 체력이 세다', () => {
    const state = start({}, 11);
    run(state, 3);
    const ant = state.enemies.find((enemy) => enemy.kind === 'ant' || enemy.kind === 'ladybug');
    expect(ant).toBeDefined();
    if (ant) expect(ant.maxHp).toBeCloseTo(ENEMIES[ant.kind].hp * hpScale(11), 5);
  });

  it('대장은 부하를 부르고, 부른 부하도 그날 쫓아낼 벌레에 든다', () => {
    const state = emptied({}, 5);
    state.fireIn = 1e9;
    put(state, 'mole', 120, 40);
    const total = state.dayTotal;
    const events = run(state, SUMMON.every + 0.2);
    expect(count(events, 'spawn')).toBe(SUMMON.count);
    expect(state.enemies).toHaveLength(1 + SUMMON.count);
    expect(state.dayTotal).toBe(total + SUMMON.count);
    for (const enemy of state.enemies.slice(1)) {
      expect(enemy.kind).toBe(SUMMON.kind);
      expect(enemy.x).toBeGreaterThanOrEqual(ENEMIES[SUMMON.kind].radius);
      expect(enemy.x).toBeLessThanOrEqual(FIELD.width - ENEMIES[SUMMON.kind].radius);
    }
  });
});

describe('새 벌레와 대장', () => {
  it('땅강아지는 판의 가운데에서 땅속에 숨고, 숨은 동안에는 겨누지도 맞히지도 못한다', () => {
    const state = emptied({ splash: 3, storm: 1 });
    const digger = put(state, 'digger', SHOOTER.x, (DIG.from + DIG.to) / 2, 500);
    expect(isBuried(digger)).toBe(true);
    expect(autoAim(state, SHOOTER)).toBeNull();
    // 바로 앞을 겨눠 쏴도 물방울이 그냥 지나간다.
    const events = run(state, 1, { aim: { x: digger.x, y: digger.y }, storm: false });
    expect(count(events, 'fire')).toBeGreaterThan(0);
    expect(count(events, 'hit')).toBe(0);
    // 물벼락도 닿지 않는다.
    state.stormIn = 0;
    step(state, DT, { aim: null, storm: true });
    expect(digger.hp).toBe(digger.maxHp);
    // 땅 위로 나오면 다시 맞는다.
    const out = put(state, 'digger', SHOOTER.x, DIG.to + 5, 500);
    expect(isBuried(out)).toBe(false);
    expect(autoAim(state, SHOOTER)?.x).toBe(out.x);
  });

  it('땅강아지는 울타리에 닿기 전에 땅 위로 나온다', () => {
    expect(DIG.from).toBeGreaterThan(0);
    expect(DIG.to).toBeLessThan(FIELD.depth - ENEMIES.digger.radius - 40);
    const state = emptied();
    state.fireIn = 1e9;
    const digger = put(state, 'digger', 100, 0);
    const seen = new Set<boolean>();
    for (let time = 0; time < 20 && !digger.biting; time += DT) {
      step(state, DT);
      seen.add(isBuried(digger));
    }
    expect([...seen].sort()).toEqual([false, true]);
    expect(digger.biting).toBe(true);
    expect(isBuried(digger)).toBe(false);
  });

  it('장수풍뎅이는 웅크려 멈췄다가 빠르게 돌진하고, 부하는 부르지 않는다', () => {
    const state = emptied({}, 10);
    state.fireIn = 1e9;
    const rhino = put(state, 'rhino', 120, 0);
    rhino.summonIn = CHARGE.every;
    const phases: Array<{ phase: string; dy: number }> = [];
    let spawns = 0;
    for (let time = 0; time < CHARGE.every * 2; time += DT) {
      const before = rhino.y;
      // 이 프레임의 걸음은 프레임을 시작할 때의 때를 따른다.
      const phase = chargePhase(rhino);
      spawns += count(step(state, DT), 'spawn');
      phases.push({ phase, dy: rhino.y - before });
    }
    expect(spawns).toBe(0);
    expect(state.enemies).toHaveLength(1);
    const walk = phases.filter((frame) => frame.phase === 'walk');
    const windup = phases.filter((frame) => frame.phase === 'windup');
    const rush = phases.filter((frame) => frame.phase === 'rush');
    expect(windup.length).toBeGreaterThan(0);
    expect(rush.length).toBeGreaterThan(0);
    for (const frame of windup) expect(frame.dy).toBe(0);
    const pace = (frames: typeof phases): number => frames.reduce((sum, frame) => sum + frame.dy, 0) / (frames.length * DT);
    expect(pace(walk)).toBeCloseTo(ENEMIES.rhino.speed, 3);
    expect(pace(rush)).toBeCloseTo(ENEMIES.rhino.speed * CHARGE.speed, 3);
    // 웅크리는 때와 돌진하는 때가 차례로 온다.
    const firstWindup = phases.findIndex((frame) => frame.phase === 'windup');
    const firstRush = phases.findIndex((frame) => frame.phase === 'rush');
    expect(firstWindup).toBeLessThan(firstRush);
  });

  it('장수풍뎅이는 젖으면 돌진의 박자도 느려진다', () => {
    const rushesIn = (slow: number): number => {
      const state = emptied({}, 10);
      state.fireIn = 1e9;
      const rhino = put(state, 'rhino', 120, 0);
      rhino.summonIn = CHARGE.every;
      rhino.slow = slow;
      rhino.slowLeft = 99;
      let time = 0;
      while (chargePhase(rhino) !== 'rush') {
        step(state, DT);
        time += DT;
      }
      return time;
    };
    expect(rushesIn(0.5)).toBeGreaterThan(rushesIn(0) * 1.8);
  });

  it('대장의 날에는 그날의 대장이 나온다', () => {
    for (const [day, kind] of [
      [5, 'mole'],
      [10, 'rhino'],
      [30, 'spider'],
    ] as const) {
      const state = start({}, day, 0);
      const events = run(state, 3);
      expect(events.some((event) => event.type === 'spawn' && event.kind === kind), `${day}`).toBe(true);
    }
  });

  it('진딧물은 쫓아내면 그 자리에서 아기 진딧물 둘로 나뉘고, 나뉜 것도 그날 쫓아낼 벌레에 든다', () => {
    const state = emptied({}, 27);
    state.fireIn = 1e9;
    const aphid = put(state, 'aphid', 100, 120, 1);
    const total = state.dayTotal;
    aphid.hp = 0;
    const events = step(state, DT);
    expect(events.filter((event) => event.type === 'kill').map((event) => event.type === 'kill' && event.kind)).toEqual(['aphid']);
    const nymphs = state.enemies.filter((enemy) => enemy.kind === 'nymph');
    expect(nymphs).toHaveLength(2);
    expect(state.dayTotal).toBe(total + 2);
    expect(count(events, 'spawn')).toBe(2);
    expect(nymphs.map((nymph) => Math.round(nymph.x)).sort()).toEqual([100 - SPLIT.spread, 100 + SPLIT.spread].sort());
    for (const nymph of nymphs) {
      expect(nymph.y).toBeCloseTo(120, 0);
      expect(nymph.maxHp).toBeCloseTo(ENEMIES.nymph.hp * hpScale(27), 5);
    }
    // 아기 진딧물은 더 나뉘지 않는다.
    for (const nymph of nymphs) nymph.hp = 0;
    step(state, DT);
    expect(state.enemies).toHaveLength(0);
    // 다 쫓아내야 날을 지킨다.
    expect(state.lastCleared).toBe(27);
  });

  it('울타리를 갉던 진딧물이 나뉘면 아기 진딧물도 울타리 앞에 놓인다', () => {
    const state = emptied({}, 27);
    state.fireIn = 1e9;
    const aphid = put(state, 'aphid', 100, stopYOf('aphid'), 1);
    aphid.biting = true;
    aphid.hp = 0;
    step(state, DT);
    for (const nymph of state.enemies) expect(nymph.y).toBeLessThanOrEqual(stopYOf('nymph'));
    run(state, 0.2);
    expect(state.enemies.every((nymph) => nymph.biting)).toBe(true);
  });

  it('거미는 판의 가운데에 멈춰서 멀리서 울타리를 갉고, 가시 울타리에 찔리지 않는다', () => {
    const state = emptied({ thorn: 5 }, 30);
    state.fireIn = 1e9;
    const spider = put(state, 'spider', 120, 0, 5000);
    spider.summonIn = 1e9;
    const fence = state.fence;
    const events = run(state, 30);
    expect(spider.y).toBe(WEB.stopY);
    expect(spider.biting).toBe(true);
    expect(WEB.stopY).toBeLessThan(FIELD.depth - 100);
    // 거미줄로 갉는다.
    expect(count(events, 'bite')).toBeGreaterThan(3);
    expect(state.fence).toBeLessThan(fence);
    // 가시는 닿지 않는다.
    expect(spider.hp).toBe(5000);
    // 거미는 부하를 부르지 않는다.
    expect(count(events, 'spawn')).toBe(0);
    // 물총은 멈춘 거미를 겨눈다.
    expect(autoAim(state, SHOOTER)).toEqual({ x: spider.x, y: WEB.stopY });
  });
});

describe('물벼락', () => {
  it('강화가 없으면 쓸 수 없다', () => {
    const state = emptied();
    put(state, 'ant', 100, 100);
    expect(stormReady(state)).toBe(false);
    expect(count(run(state, 1, { aim: null, storm: true }), 'storm')).toBe(0);
  });

  it('판의 벌레를 모두 적시고 늦추며, 다시 쓰려면 기다려야 한다', () => {
    const state = emptied({ storm: 1 });
    state.fireIn = 1e9;
    const ant = put(state, 'ant', 40, 100);
    const beetle = put(state, 'beetle', 200, 200);
    const mole = put(state, 'mole', 120, 60);
    const outside = put(state, 'ant', 100, -60);
    expect(stormReady(state)).toBe(false); // 판을 시작하고 바로는 못 쓴다.
    state.stormIn = 0;
    expect(stormReady(state)).toBe(true);
    const events = step(state, DT, { aim: null, storm: true });
    expect(count(events, 'storm')).toBe(1);
    expect(ant.maxHp - ant.hp).toBeCloseTo(state.stats.stormDamage, 5);
    // 물벼락은 껍데기도 뚫는다.
    expect(beetle.maxHp - beetle.hp).toBeCloseTo(state.stats.stormDamage, 5);
    expect(ant.slow).toBe(STORM.slow);
    expect(mole.slow).toBe(STORM.slow / 2);
    expect(outside.hp).toBe(outside.maxHp);
    expect(stormReady(state)).toBe(false);
    expect(count(run(state, 2, { aim: null, storm: true }), 'storm')).toBe(0);
    state.stormIn = 0;
    expect(count(run(state, 0.1, { aim: null, storm: true }), 'storm')).toBe(1);
  });
});

describe('하루', () => {
  it('벌레를 다 쫓아내면 날이 넘어가고, 씨앗과 열매를 받고, 가게를 닫고 잠깐 쉰 뒤 다음 날이 온다', () => {
    const state = start();
    const events = run(state, 60, { aim: null, storm: false, ready: true });
    const clear = events.find((event) => event.type === 'dayClear');
    expect(clear).toMatchObject({ type: 'dayClear', day: 1, record: true });
    expect(count(events, 'kill')).toBeGreaterThanOrEqual(DAY.count.first);
    expect(state.lastCleared).toBeGreaterThanOrEqual(1);
    expect(state.seeds).toBeGreaterThanOrEqual(clearBonus(1) + recordBonus(1) + DAY.count.first * ENEMIES.ant.seeds);
    expect(clear).toMatchObject({ fruit: fruitFor(1) });
    const starts = events.filter((event) => event.type === 'dayStart');
    expect(starts[0]).toEqual({ type: 'dayStart', day: 2, boss: false });
  });

  it('쉬는 동안에는 다음 날이 오지 않고 물벼락도 못 쓴다', () => {
    const state = emptied({ storm: 1 });
    const ant = put(state, 'ant', SHOOTER.x, 250, 1);
    const events = run(state, 1);
    expect(ant.hp).toBeLessThanOrEqual(0);
    expect(count(events, 'dayClear')).toBe(1);
    expect(state.phase).toBe('rest');
    // 가게는 allies.test.ts에서 본다. 여기서는 가게를 닫은 뒤의 쉬는 시간만 본다.
    expect(state.shopping).toBe(true);
    run(state, 3);
    expect(state.day).toBe(1);
    state.shopping = false;
    state.stormIn = 0;
    expect(stormReady(state)).toBe(false);
    const day = state.day;
    state.restLeft = DAY.rest;
    run(state, DAY.rest - 0.3);
    expect(state.day).toBe(day);
    run(state, 0.5);
    expect(state.day).toBe(day + 1);
    expect(state.phase).toBe('fight');
  });

  it('이미 넘겨 본 날은 새 기록 씨앗을 주지 않는다', () => {
    const seedsFor = (bestBefore: number): number => {
      const state = emptied();
      state.bestBefore = bestBefore;
      put(state, 'ant', SHOOTER.x, 250, 1);
      const clear = run(state, 1).find((event) => event.type === 'dayClear');
      return clear?.type === 'dayClear' ? clear.seeds : -1;
    };
    expect(seedsFor(0)).toBe(clearBonus(1) + recordBonus(1));
    expect(seedsFor(3)).toBe(clearBonus(1));
  });

  it('날을 넘길 때 울타리를 고친다', () => {
    const state = emptied({ mend: 2 });
    state.fence = 10;
    put(state, 'ant', SHOOTER.x, 250, 1);
    const clear = run(state, 1).find((event) => event.type === 'dayClear');
    const mended = state.stats.fenceMax * state.stats.mend;
    expect(clear).toMatchObject({ mended });
    expect(state.fence).toBe(10 + mended);
    // 가득 찬 것보다 더 차지는 않는다.
    const full = emptied({ mend: 2 });
    put(full, 'ant', SHOOTER.x, 250, 1);
    run(full, 1);
    expect(full.fence).toBe(full.stats.fenceMax);
  });

  it('판이 비면 다음 벌레를 당겨 온다', () => {
    const state = start();
    state.queue = [{ at: 9, kind: 'ant', x: 100 }];
    const events = run(state, 0.6);
    expect(count(events, 'spawn')).toBe(1);
  });

  it('점수는 이 판에서 지킨 날과 무너진 날에 쫓아낸 만큼이다', () => {
    const state = emptied({}, 6);
    state.lastCleared = 7;
    state.dayTotal = 8;
    state.dayKilled = 2;
    // 6일째에서 시작해 7일째까지 지켰으니 이틀이다. 몇째 날까지 갔는지(7)를 세지 않는다.
    expect(runScore(state)).toBe(225);
  });

  it('1일째에서 시작한 판의 점수는 지킨 날의 번호와 같다', () => {
    const state = emptied({}, 1);
    state.lastCleared = 7;
    state.dayTotal = 8;
    state.dayKilled = 2;
    expect(runScore(state)).toBe(725);
  });

  it('날을 지키고 쉬는 동안의 점수는 다음 날이 시작된 뒤와 같다', () => {
    const state = start({ power: 30, rapid: 8 }, 3, 0, 5);
    run(state, 120, { aim: null, storm: false });
    // 날을 지켜서 가게가 열려 있다. 그날 쫓아낸 비율은 100%로 남아 있다.
    expect(state.phase).toBe('rest');
    expect(state.lastCleared).toBe(3);
    expect(state.dayKilled).toBe(state.dayTotal);
    // 3일째에서 시작해 그날을 지켰으니 하루다.
    expect(runScore(state)).toBe(100);
    step(state, DT, { aim: null, storm: false, ready: true });
    while (state.phase === 'rest') step(state, DT);
    expect(state.day).toBe(4);
    expect(state.dayKilled).toBe(0);
    expect(runScore(state)).toBe(100);
  });
});

describe('밸런스', () => {
  it('영구 강화 없이도 동료를 모아 첫 대장 근처까지는 가지만, 둘째 대장은 넘지 못한다', () => {
    // 동료가 생기기 전에는 지켜보기만 하면 4일째에서 막혔다. 지금은 첫 판에도 동료가 붙어서 여드레쯤 간다.
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const idle = playRun({ seed, startDay: 1, levels: {}, bestBefore: 0 }, 'idle');
      const active = playRun({ seed, startDay: 1, levels: {}, bestBefore: 0 }, 'active');
      expect(idle.phase).toBe('over');
      expect(idle.lastCleared, `idle ${seed}`).toBeGreaterThanOrEqual(4);
      expect(idle.lastCleared, `idle ${seed}`).toBeLessThan(10);
      expect(active.lastCleared, `active ${seed}`).toBeLessThan(15);
      // 판에서 동료를 들였다.
      expect(idle.allies.length, `idle ${seed}`).toBeGreaterThan(0);
      // 첫 판에서도 강화 하나는 살 만큼 번다.
      expect(Math.floor(idle.seeds), `idle ${seed}`).toBeGreaterThanOrEqual(12);
      // 한 판이 너무 길지 않다.
      expect(active.t).toBeLessThan(360);
    }
  });

  it('판을 거듭하며 강화를 사면 점점 더 멀리 간다', () => {
    const career = playCareer(createMeta(), 10, 'active', 5);
    const bests = career.runs.map((_, index) => Math.max(...career.runs.slice(0, index + 1).map((run) => run.cleared)));
    expect(bests[0]).toBeLessThan(15);
    expect(bests[4]).toBeGreaterThan(bests[0]);
    expect(bests[9]).toBeGreaterThan(bests[4]);
    expect(career.meta.best).toBe(bests[9]);
    expect(career.meta.runs).toBe(10);
    // 열 판으로 끝을 보지는 못한다.
    expect(career.meta.best).toBeLessThan(35);
    // 판마다 무언가를 살 만큼은 번다.
    for (const played of career.runs) expect(played.seeds).toBeGreaterThanOrEqual(10);
  });

  it('서른 판을 하는 동안 같은 날에서 오래 막히지 않는다', () => {
    // 강화 값은 단계마다 곱으로 오르는데 한 판에 버는 씨앗은 날 수만큼만 늘어서, 뒤로 가면 벽이 생기기 쉽다.
    // 예전 곡선에서는 40일째 근처에서 같은 판을 30번쯤 되풀이해야 넘었다.
    for (const seed of [3, 5]) {
      const career = playCareer(createMeta(), 30, 'active', seed);
      let best = 0;
      let stuck = 0;
      let longest = 0;
      for (const played of career.runs) {
        if (played.cleared > best) {
          best = played.cleared;
          stuck = 0;
        } else {
          stuck += 1;
          longest = Math.max(longest, stuck);
        }
      }
      expect(best, `seed ${seed}`).toBeGreaterThanOrEqual(40);
      expect(longest, `seed ${seed}: ${career.runs.map((played) => played.cleared).join(',')}`).toBeLessThanOrEqual(8);
    }
    // 판 예순 개를 끝까지 돌리므로 여느 테스트보다 오래 걸린다.
  }, 60_000);

  it('손으로 겨누는 쪽이 지켜보기만 하는 쪽보다 못하지 않다', () => {
    const levels: Levels = { power: 6, rapid: 3, fence: 5, crit: 2, splash: 1 };
    let idle = 0;
    let active = 0;
    for (const seed of [1, 2, 3]) {
      idle += playRun({ seed, startDay: 1, levels, bestBefore: 0 }, 'idle').lastCleared;
      active += playRun({ seed, startDay: 1, levels, bestBefore: 0 }, 'active').lastCleared;
    }
    expect(active).toBeGreaterThanOrEqual(idle);
  });

  it('가장 싼 것부터 사는 사람도 씨앗을 남기지 않고 쓴다', () => {
    const meta = buyCheapest({ ...createMeta(), seeds: 500 });
    expect(meta.seeds).toBeLessThan(40);
    expect(Object.keys(meta.levels).length).toBeGreaterThan(4);
  });

  it('25일째에 닿지 않는 판은 새 벌레와 거미를 넣기 전과 똑같이 흘러간다', () => {
    // 일곱 판 모두 26일째 앞에서 끝난다. 새 벌레와 거미를 넣기 전에 잰 값이다.
    const career = playCareer(createMeta(), 7, 'active', 3);
    expect(career.runs.map((played) => [played.start, played.cleared, played.seeds, played.shards])).toEqual([
      [1, 10, 451, 2],
      [6, 12, 440, 1],
      [6, 14, 606, 1],
      [6, 17, 1076, 2],
      [11, 19, 1048, 1],
      [11, 23, 1967, 2],
      [16, 24, 1554, 1],
    ]);
    expect(career.runs.map((played) => Math.round(played.seconds * 60))).toEqual(
      [235.9, 193.66667, 249.41667, 349.38333, 299.46667, 441.2, 300.93333].map((seconds) => Math.round(seconds * 60)),
    );
  }, 30_000);

  it('25일째 뒤의 새 벌레와 거미가 판을 크게 어렵게도 쉽게도 하지 않는다', () => {
    // 26일째 판을 앞쪽 일곱 판을 한 강화에 씨앗 3만을 더 들인 사람이 한다. 새 벌레와 거미를 넣기 전에는
    // 열 판(씨앗 1~10) 평균 53.7일째까지 지켰고(50~56), 넣은 뒤에는 52.7일째다. 씨앗 12만을 더 들이면 71.3일째에서 70.2일째로,
    // 31일째에서 시작하면 48.9일째에서 49.9일째로 바뀌었다(zz- 점검으로 잰 값).
    const base = playCareer(createMeta(), 7, 'active', 3).meta;
    const meta = buyCheapest({ ...base, seeds: base.seeds + 30_000 });
    const kinds = new Set<string>();
    const cleared: number[] = [];
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { state } = createRun({ seed, startDay: 26, levels: meta.levels, bestBefore: 99 });
      while (state.phase !== 'over' && state.t < 3600) {
        for (const event of step(state, DT, botInput(state, 'active'))) if (event.type === 'kill') kinds.add(event.kind);
      }
      cleared.push(state.lastCleared);
    }
    // 새 벌레와 거미를 실제로 만나고 쫓아냈다.
    for (const kind of ['aphid', 'nymph', 'spider']) expect(kinds.has(kind), kind).toBe(true);
    // 30일째의 거미가 벽이 되지 않는다.
    for (const days of cleared) expect(days, cleared.join(',')).toBeGreaterThan(40);
    const mean = cleared.reduce((sum, days) => sum + days, 0) / cleared.length;
    expect(mean, cleared.join(',')).toBeGreaterThan(53.7 - 4);
    expect(mean, cleared.join(',')).toBeLessThan(53.7 + 4);
  }, 90_000);

  it('뒤쪽 날에서 시작하면 그날의 벌레가 바로 나온다', () => {
    const state = start({}, 11, 12);
    expect(state.day).toBe(11);
    const first = run(state, 4).filter((event) => event.type === 'spawn');
    expect(first.length).toBeGreaterThan(2);
    // 강화 없이 11일째는 버티지 못한다.
    run(state, 240);
    expect(state.phase).toBe('over');
    expect(state.lastCleared).toBe(0);
    expect(runScore(state)).toBeLessThan(100);
  });
});
