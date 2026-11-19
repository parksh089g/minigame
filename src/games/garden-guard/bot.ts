/**
 * 자동 플레이. 테스트에서 "강화 없이는 며칠째에 막히고, 강화를 사면 얼마나 더 가는지"를 숫자로 확인한다.
 * 화면에서 하는 판과 같은 step을 돌린다.
 */
import { canBuyCard, canReroll, mergeTarget, starOf } from './allies';
import { ALLIES, ENEMIES, RELIC_ORDER, SHOOTER, SHOP, UPGRADE_ORDER } from './data';
import {
  applyRun,
  bankSeeds,
  bankShards,
  buyRelic,
  buyUpgrade,
  canBuy,
  canBuyRelic,
  clampStartDay,
  levelOf,
  relicCost,
  relicLevel,
  startDays,
  upgradeCost,
  type GardenMeta,
} from './rules';
import { autoAim, createRun, step, stormReady, type Input, type RunConfig, type RunState } from './sim';

/** idle은 손을 떼고 지켜보기만 하고, active는 울타리에 가장 가까운 벌레를 직접 겨누고 물벼락도 쓴다. */
export type BotStyle = 'idle' | 'active';

const STEP = 1 / 60;

/**
 * 동료 가게에서 사는 법. keen은 사면 별이 오르는 동료가 있으면 그것부터 합치고, 빈칸이 있으면 값진(큰) 동료부터 새로 놓고, 칸이 차면 같은 동료를 사서 합치고,
 * 살 것이 없으면 한 번 다시 뽑아 보는 사람이다. first는 놓인 차례대로 살 수 있는 것을 사는(아무거나 사는) 사람이다.
 * 둘 다 놓을 수 있으면 새로 놓고, 아니면 합친다.
 */
export type PickStyle = 'keen' | 'first';

/** 가게가 열려 있으면 이번 걸음에 할 일(살 카드, 다시 뽑기, 다음 날). 열려 있지 않으면 빈 것 */
export function botShop(state: RunState, picks: PickStyle = 'keen'): Pick<Input, 'buy' | 'reroll' | 'ready'> {
  if (!state.shopping) return {};
  const cards = state.shop.map((_, index) => index);
  const placeable = cards.filter((index) => canBuyCard(state, index, 'place'));
  const mergeable = cards.filter((index) => canBuyCard(state, index, 'merge'));
  if (picks === 'first') {
    const first = cards.find((index) => placeable.includes(index) || mergeable.includes(index));
    if (first !== undefined) return { buy: { card: first, mode: placeable.includes(first) ? 'place' : 'merge' } };
  } else {
    // 사면 별이 오르는 카드가 있으면 그것부터 합친다. 별이 오르면 새로 하나 놓는 것보다 세다.
    const rising = mergeable.find((index) => {
      const target = mergeTarget(state, state.shop[index].id);
      return target !== undefined && starOf(target.copies + 1) > starOf(target.copies);
    });
    if (rising !== undefined) return { buy: { card: rising, mode: 'merge' } };
    if (placeable.length > 0) {
      const price = (index: number): number => ALLIES[state.shop[index].id].price;
      const best = placeable.reduce((a, b) => (price(b) > price(a) ? b : a));
      return { buy: { card: best, mode: 'place' } };
    }
    if (mergeable.length > 0) return { buy: { card: mergeable[0], mode: 'merge' } };
  }
  // 산 카드가 하나도 없는데 열매가 넉넉하면 한 번 다시 뽑는다.
  const untouched = state.shop.every((card) => !card.sold);
  if (picks === 'keen' && untouched && state.fruit >= SHOP.reroll + 3 && canReroll(state)) return { reroll: true };
  return { ready: true };
}

export function botInput(state: RunState, style: BotStyle, picks: PickStyle = 'keen'): Input {
  const shop = botShop(state, picks);
  if (style === 'idle') return { aim: null, storm: false, ...shop };
  const crowded = state.enemies.length >= 6 || state.enemies.some((enemy) => ENEMIES[enemy.kind].boss);
  return { aim: autoAim(state, SHOOTER), storm: crowded && stormReady(state), ...shop };
}

/** 한 판을 끝까지(또는 maxSeconds까지) 돌린다. */
export function playRun(config: RunConfig, style: BotStyle, maxSeconds = 3600, picks: PickStyle = 'keen'): RunState {
  const { state } = createRun(config);
  while (state.phase !== 'over' && state.t < maxSeconds) step(state, STEP, botInput(state, style, picks));
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
      if (cost !== null && cost < cheapest && canBuy(next, id)) {
        cheapest = cost;
        pick = id;
      }
    }
    if (!pick) return next;
    next = buyUpgrade(next, pick);
  }
}

/** 유물 조각이 되는 대로 가장 싼 유물부터 올린다. */
export function buyCheapestRelic(meta: GardenMeta): GardenMeta {
  let next = meta;
  for (;;) {
    let pick: (typeof RELIC_ORDER)[number] | null = null;
    let cheapest = Infinity;
    for (const id of RELIC_ORDER) {
      const cost = relicCost(id, relicLevel(next.relics, id));
      if (cost !== null && cost < cheapest && canBuyRelic(next, id)) {
        cheapest = cost;
        pick = id;
      }
    }
    if (!pick) return next;
    next = buyRelic(next, pick);
  }
}

export interface Career {
  meta: GardenMeta;
  /** 판마다: 시작한 날, 마지막으로 지킨 날, 걸린 시간(초), 번 씨앗, 받은 유물 조각 */
  runs: Array<{ start: number; cleared: number; seconds: number; seeds: number; shards: number }>;
}

/**
 * 여러 판을 이어서 한다: 판을 하고, 번 씨앗으로 가장 싼 강화부터 사고, 다시 한다.
 * 시작하는 날은 열린 날 가운데 가장 멀리 지킨 날보다 back일 넘게 앞선 가장 늦은 날이다(막힌 날 바로 앞에서 시작하지 않는다).
 * 받은 유물 조각은 늘 넣어 두고, relics가 true일 때만 그것으로 유물을 올린다(유물이 있을 때와 없을 때를 견줄 수 있게).
 */
export function playCareer(
  meta: GardenMeta,
  runs: number,
  style: BotStyle,
  seed = 1,
  back = 4,
  picks: PickStyle = 'keen',
  relics = false,
): Career {
  let next = meta;
  const log: Career['runs'] = [];
  for (let run = 0; run < runs; run += 1) {
    const wanted = Math.max(1, next.best - back);
    const start = clampStartDay(Math.max(...startDays(next.best).filter((day) => day <= wanted)), next.best);
    const state = playRun(
      {
        seed: seed * 1000 + run,
        startDay: start,
        levels: next.levels,
        bestBefore: next.best,
        fields: next.fields,
        relics: next.relics,
      },
      style,
      3600,
      picks,
    );
    const seeds = Math.floor(state.seeds);
    next = buyCheapest(applyRun(bankShards(bankSeeds(next, seeds), state.shards), state.lastCleared, state.kills));
    if (relics) next = buyCheapestRelic(next);
    log.push({ start, cleared: state.lastCleared, seconds: state.t, seeds, shards: state.shards });
  }
  return { meta: next, runs: log };
}
