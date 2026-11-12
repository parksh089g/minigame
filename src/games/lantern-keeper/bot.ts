/**
 * 자동 플레이. 밸런스를 숫자로 확인하는 테스트에서 쓴다.
 * 사람처럼 잘하지는 못하지만, 가까운 적과 날아오는 빛덩이에게서 멀어지고 안전하면 빛 조각을 주우러 간다.
 * 캐릭터와 스테이지는 RunConfig로 정한다.
 */
import { ENEMIES } from './data';
import { seededRandom, type RunSummary, type Upgrade } from './rules';
import { createRun, Sim, type RunConfig } from './sim';

export type BotStyle = 'still' | 'kite';

export interface BotResult extends RunSummary {
  over: 'dead' | 'cleared' | null;
  peakEnemies: number;
  /** 끝났을 때 들고 있던 무기와 그 레벨 */
  weapons: Sim['state']['weapons'];
}

const DANGER_RANGE = 34;
const LOOK_AHEAD = 12;
const DIRECTIONS = 16;
/** 빛덩이를 피할 때 두는 거리와, 얼마 뒤의 자리를 내다볼지(초) */
const HAZARD_RANGE = 16;
const HAZARD_AHEAD = 0.25;
/** 부풀고 있는 적의 터질 둘레에서 이만큼(px) 더 떨어지려고 한다. 사람은 바닥의 원을 보고 비킨다. */
const BURST_MARGIN = 8;
/** 웅덩이에 발을 들이는 것을 꺼리는 정도. 적을 피하는 것보다는 훨씬 가볍다. */
const MIRE_COST = 0.8;
/** 달아올랐거나 불길이 솟는 불구멍에 발을 들이는 것을 꺼리는 정도. 사람은 깜빡이는 테두리를 보고 비킨다. */
const SCORCH_COST = 6;

/** 열여섯 방향 가운데, 조금 나아갔을 때 적과 덜 가깝고 빛 조각에 가까워지는 쪽을 고른다. */
export function steer(sim: Sim): [number, number] {
  const { player, enemies, gems, hazards } = sim.state;
  const near = enemies.filter(
    (e) => Math.abs(e.x - player.x) < 70 && Math.abs(e.y - player.y) < 70,
  );
  const incoming = hazards.filter(
    (h) => Math.abs(h.x - player.x) < 60 && Math.abs(h.y - player.y) < 60,
  );
  const swelling = near.filter((e) => e.mode === 1 && ENEMIES[e.kind].bursts);
  let gem: { x: number; y: number } | null = null;
  let gemDistance = 140;
  for (const candidate of gems) {
    const d = Math.hypot(candidate.x - player.x, candidate.y - player.y);
    if (d < gemDistance) {
      gemDistance = d;
      gem = candidate;
    }
  }

  let bestX = 0;
  let bestY = 0;
  let bestCost = Number.POSITIVE_INFINITY;
  for (let i = 0; i <= DIRECTIONS; i += 1) {
    // 마지막 후보는 제자리에 서 있기
    const angle = (i / DIRECTIONS) * Math.PI * 2;
    const dirX = i === DIRECTIONS ? 0 : Math.cos(angle);
    const dirY = i === DIRECTIONS ? 0 : Math.sin(angle);
    const x = player.x + dirX * LOOK_AHEAD;
    const y = player.y + dirY * LOOK_AHEAD;
    let cost = 0;
    for (const e of near) {
      const d = Math.hypot(e.x - x, e.y - y) - ENEMIES[e.kind].radius;
      if (d < DANGER_RANGE) cost += ((DANGER_RANGE - d) / DANGER_RANGE) ** 2 * 10;
    }
    for (const e of swelling) {
      const reach = (ENEMIES[e.kind].bursts?.radius ?? 0) + BURST_MARGIN;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d < reach) cost += 4 + ((reach - d) / reach) * 12;
    }
    for (const h of incoming) {
      const d = Math.hypot(h.x + h.vx * HAZARD_AHEAD - x, h.y + h.vy * HAZARD_AHEAD - y);
      if (d < HAZARD_RANGE) cost += ((HAZARD_RANGE - d) / HAZARD_RANGE) ** 2 * 8;
    }
    if (sim.isMire(x, y)) cost += MIRE_COST;
    if (sim.isScorching(x, y)) cost += SCORCH_COST;
    if (gem) cost += Math.hypot(gem.x - x, gem.y - y) * 0.02;
    if (cost < bestCost) {
      bestCost = cost;
      bestX = dirX;
      bestY = dirY;
    }
  }
  return [bestX, bestY];
}

export type Chooser = (options: Upgrade[]) => Upgrade;

/** 무기 강화권은 가장 많이 올린 무기에 쓴다. 진화할 수 있으면 진화가 된다. */
function spendTicket(options: Upgrade[]): Upgrade {
  let best = options[0];
  for (const option of options) {
    if (option.type === 'weapon' && (best.type !== 'weapon' || option.level > best.level)) best = option;
  }
  return best;
}

/** 선택지 가운데 무기를 먼저, 그다음 패시브를 고른다. */
export const weaponFirst: Chooser = (options) => options.find((u) => u.type === 'weapon') ?? options[0];

export function playRun(
  seed: number,
  style: BotStyle,
  config: RunConfig,
  maxSeconds = 900,
  dt = 1 / 30,
  choose: Chooser = weaponFirst,
): BotResult {
  const sim = new Sim(createRun(config), seededRandom(seed));
  let peakEnemies = 0;
  while (!sim.state.over && sim.state.t < maxSeconds) {
    while (sim.state.pendingTickets > 0) sim.useTicket(spendTicket(sim.ticketChoices()));
    while (sim.state.pendingLevelUps > 0) sim.applyUpgrade(choose(sim.options()));
    const [x, y] = style === 'kite' ? steer(sim) : [0, 0];
    sim.step(dt, x, y);
    peakEnemies = Math.max(peakEnemies, sim.state.enemies.length);
  }
  return { ...sim.summary(), over: sim.state.over, peakEnemies, weapons: { ...sim.state.weapons } };
}
