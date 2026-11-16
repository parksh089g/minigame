/**
 * 자동 플레이. 테스트에서 "강화 없이는 며칠째에 막히고, 강화를 사면 얼마나 더 가는지"를 숫자로 확인한다.
 * 화면에서 하는 판과 같은 step을 돌린다.
 */
import { ENEMIES, SHOOTER, UPGRADE_ORDER } from './data';
import {
  applyRun,
  bankSeeds,
  buyUpgrade,
  clampStartDay,
  levelOf,
  startDays,
  upgradeCost,
  type GardenMeta,
} from './rules';
import { autoAim, createRun, step, stormReady, type Input, type RunConfig, type RunState } from './sim';

/** idle은 손을 떼고 지켜보기만 하고, active는 울타리에 가장 가까운 벌레를 직접 겨누고 물벼락도 쓴다. */
export type BotStyle = 'idle' | 'active';

const STEP = 1 / 60;

export function botInput(state: RunState, style: BotStyle): Input {
  if (style === 'idle') return { aim: null, storm: false };
  const crowded = state.enemies.length >= 6 || state.enemies.some((enemy) => ENEMIES[enemy.kind].boss);
  return { aim: autoAim(state, SHOOTER), storm: crowded && stormReady(state) };
}

/** 한 판을 끝까지(또는 maxSeconds까지) 돌린다. */
export function playRun(config: RunConfig, style: BotStyle, maxSeconds = 3600): RunState {
  const { state } = createRun(config);
  while (state.phase !== 'over' && state.t < maxSeconds) step(state, STEP, botInput(state, style));
  return state;
}

/** 씨앗이 되는 대로 가장 싼 강화부터 산다. 무엇이 좋은지 모르는 사람의 사는 법이다. */
export function buyCheapest(meta: GardenMeta): GardenMeta {
  let next = meta;
  for (;;) {
    let pick: (typeof UPGRADE_ORDER)[number] | null = null;
    let cheapest = Infinity;
    for (const id of UPGRADE_ORDER) {
      const cost = upgradeCost(id, levelOf(next.levels, id));
      if (cost !== null && cost <= next.seeds && cost < cheapest) {
        cheapest = cost;
        pick = id;
      }
    }
    if (!pick) return next;
    next = buyUpgrade(next, pick);
  }
}

export interface Career {
  meta: GardenMeta;
  /** 판마다: 시작한 날, 마지막으로 지킨 날, 걸린 시간(초), 번 씨앗 */
  runs: Array<{ start: number; cleared: number; seconds: number; seeds: number }>;
}

/**
 * 여러 판을 이어서 한다: 판을 하고, 번 씨앗으로 가장 싼 강화부터 사고, 다시 한다.
 * 시작하는 날은 열린 날 가운데 가장 멀리 지킨 날보다 back일 넘게 앞선 가장 늦은 날이다(막힌 날 바로 앞에서 시작하지 않는다).
 */
export function playCareer(meta: GardenMeta, runs: number, style: BotStyle, seed = 1, back = 4): Career {
  let next = meta;
  const log: Career['runs'] = [];
  for (let run = 0; run < runs; run += 1) {
    const wanted = Math.max(1, next.best - back);
    const start = clampStartDay(Math.max(...startDays(next.best).filter((day) => day <= wanted)), next.best);
    const state = playRun({ seed: seed * 1000 + run, startDay: start, levels: next.levels, bestBefore: next.best }, style);
    const seeds = Math.floor(state.seeds);
    next = buyCheapest(applyRun(bankSeeds(next, seeds), state.lastCleared, state.kills));
    log.push({ start, cleared: state.lastCleared, seconds: state.t, seeds });
  }
  return { meta: next, runs: log };
}
