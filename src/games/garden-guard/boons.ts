/**
 * 판마다 고르는 강화. 날을 지킬 때마다 셋을 내놓고, 고른 것을 그 판의 능력치에 더한다.
 * 화면이 없는 규칙이라서 시뮬레이션(sim.ts)과 자동 플레이(bot.ts)가 함께 쓴다.
 */
import { BOON_CHOICES, BOON_HEAT, BOON_ORDER, BOON_PICKS, BOON_STEP, BOONS, type BoonId } from './data';
import { nextRandom } from './rules';
import type { RunState } from './sim';

/** 이 판에서 그 강화를 고른 횟수 */
export function boonCount(boons: readonly BoonId[], id: BoonId): number {
  return boons.reduce((sum, picked) => sum + (picked === id ? 1 : 0), 0);
}

/**
 * 그 판에서 지킨 날 수에 따라 벌레의 체력에 곱하는 값. 강화를 고를 수 있었던 횟수만큼만 오른다.
 * cleared는 그 판에서 이미 지킨 날 수(판의 첫날이면 0)다.
 */
export function heatScale(cleared: number): number {
  return BOON_HEAT ** Math.min(BOON_PICKS, Math.max(0, Math.floor(cleared)));
}

/** 이 판에서 더 고를 수 있는 횟수 */
export function picksLeft(state: RunState): number {
  return Math.max(0, BOON_PICKS - state.boons.length);
}

/** 지금 그 강화를 내놓을 수 있는지. 다 고른 것과, 붙을 데가 없는 것(해바라기, 물벼락이 없을 때)은 빠진다. */
export function canOffer(state: RunState, id: BoonId): boolean {
  if (boonCount(state.boons, id) >= BOONS[id].max) return false;
  const { stats } = state;
  switch (id) {
    case 'patch':
      return state.fence < stats.fenceMax * BOON_STEP.patch.below;
    case 'bloom':
      return stats.helpers > 0;
    case 'cloud':
      return stats.stormCooldown > 0;
    default:
      return true;
  }
}

/**
 * 이번에 내놓을 강화를 뽑는다(많아야 BOON_CHOICES개, 서로 다른 것). 더 고를 수 없으면 빈 목록이다.
 * 판의 난수(state.rng)에서 갈라 낸 난수를 쓰고 판의 난수는 건드리지 않아서, 벌레가 나오는 차례는 그대로다.
 */
export function drawOffer(state: RunState): BoonId[] {
  if (picksLeft(state) === 0) return [];
  let seed = (state.rng ^ Math.imul(state.day + 1, 0x9e3779b1)) | 0;
  const random = (): number => {
    const next = nextRandom(seed);
    seed = next.state;
    return next.value;
  };
  const pool = BOON_ORDER.filter((id) => canOffer(state, id));
  const offer: BoonId[] = [];
  while (offer.length < BOON_CHOICES && pool.length > 0) {
    const total = pool.reduce((sum, id) => sum + BOONS[id].weight, 0);
    let at = random() * total;
    let index = 0;
    while (index < pool.length - 1 && at >= BOONS[pool[index]].weight) {
      at -= BOONS[pool[index]].weight;
      index += 1;
    }
    offer.push(...pool.splice(index, 1));
  }
  return offer;
}

/** 고른 강화를 판에 더한다. */
export function applyBoon(state: RunState, id: BoonId): void {
  // 판을 시작할 때의 능력치를 다른 곳과 함께 들고 있을 수 있으니, 고쳐 쓰지 않고 새로 만든다.
  const stats = { ...state.stats };
  switch (id) {
    case 'jet':
      stats.damage *= BOON_STEP.jet;
      break;
    case 'quick':
      stats.interval /= BOON_STEP.quick;
      break;
    case 'needle':
      stats.critChance += BOON_STEP.needle;
      break;
    case 'lance':
      stats.pierce += BOON_STEP.lance;
      break;
    case 'spray':
      if (stats.splashRadius > 0) {
        stats.splashRadius += BOON_STEP.spray.radiusStep;
        stats.splashRatio += BOON_STEP.spray.ratioStep;
      } else {
        stats.splashRadius = BOON_STEP.spray.radius;
        stats.splashRatio = BOON_STEP.spray.ratio;
      }
      break;
    case 'frost':
      if (stats.chill > 0) {
        stats.chill = Math.min(BOON_STEP.frost.max, stats.chill + BOON_STEP.frost.slowStep);
      } else {
        stats.chill = BOON_STEP.frost.slow;
        stats.chillSeconds = BOON_STEP.frost.seconds;
      }
      break;
    case 'plank': {
      const more = Math.round(stats.fenceMax * BOON_STEP.plank);
      stats.fenceMax += more;
      state.fence += more;
      break;
    }
    case 'patch':
      state.fence = Math.min(stats.fenceMax, state.fence + stats.fenceMax * BOON_STEP.patch.heal);
      break;
    case 'bramble':
      stats.thorns += stats.damage * BOON_STEP.bramble;
      break;
    case 'bloom':
      stats.helperDamage *= BOON_STEP.bloom;
      break;
    case 'cloud':
      stats.stormCooldown *= BOON_STEP.cloud;
      // 이미 기다리던 시간도 같이 줄여서, 고르자마자 달라진 것이 보이게 한다.
      state.stormIn *= BOON_STEP.cloud;
      break;
    case 'sack':
      stats.seedMult *= BOON_STEP.sack;
      break;
  }
  state.stats = stats;
  state.boons.push(id);
}
