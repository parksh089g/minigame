/**
 * 자동 플레이. 밸런스를 숫자로 확인하는 테스트에서 쓴다.
 * 사람처럼 잘하지는 못하지만, 가까운 적에게서 멀어지고 안전하면 빛 조각을 주우러 간다.
 */
import { ENEMIES } from './data';
import { seededRandom, type RunSummary, type Upgrade } from './rules';
import { createRun, Sim, type RunConfig } from './sim';

export type BotStyle = 'still' | 'kite';

export interface BotResult extends RunSummary {
  over: 'dead' | 'cleared' | null;
  peakEnemies: number;
}

const DANGER_RANGE = 34;
const LOOK_AHEAD = 12;
const DIRECTIONS = 16;

/** 열여섯 방향 가운데, 조금 나아갔을 때 적과 덜 가깝고 빛 조각에 가까워지는 쪽을 고른다. */
function steer(sim: Sim): [number, number] {
  const { player, enemies, gems } = sim.state;
  const near = enemies.filter(
    (e) => Math.abs(e.x - player.x) < 70 && Math.abs(e.y - player.y) < 70,
  );
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
    if (gem) cost += Math.hypot(gem.x - x, gem.y - y) * 0.02;
    if (cost < bestCost) {
      bestCost = cost;
      bestX = dirX;
      bestY = dirY;
    }
  }
  return [bestX, bestY];
}

/** 선택지 가운데 무기를 먼저, 그다음 패시브를 고른다. */
function choose(options: Upgrade[]): Upgrade {
  return options.find((u) => u.type === 'weapon') ?? options[0];
}

export function playRun(
  seed: number,
  style: BotStyle,
  config: RunConfig,
  maxSeconds = 900,
  dt = 1 / 30,
): BotResult {
  const sim = new Sim(createRun(config), seededRandom(seed));
  let peakEnemies = 0;
  while (!sim.state.over && sim.state.t < maxSeconds) {
    while (sim.state.pendingLevelUps > 0) sim.applyUpgrade(choose(sim.options()));
    const [x, y] = style === 'kite' ? steer(sim) : [0, 0];
    sim.step(dt, x, y);
    peakEnemies = Math.max(peakEnemies, sim.state.enemies.length);
  }
  return { ...sim.summary(), over: sim.state.over, peakEnemies };
}
