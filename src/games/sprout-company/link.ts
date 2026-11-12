/**
 * 미니게임과 잇기: 출시작은 포켓 아케이드의 실제 게임이라서, 그 게임의 내 최고 기록으로 별을 딴다.
 * 여기서는 기록을 별로 바꾸는 일만 하고, 별이 수익을 얼마나 올리는지는 rules.ts에 있다.
 */
import { getGame } from '../registry';
import { PLAY_STARS, PROJECT_ORDER, type ProjectId } from './data';

/** 이 게임의 별을 따는 점수. 낮은 것부터 차례로 적혀 있다. */
export function starTargets(id: ProjectId): readonly number[] {
  return PLAY_STARS.targets[id] ?? getGame(id)?.dailyTargets ?? [];
}

/** 최고 기록이 best일 때 딴 별의 수 */
export function starsFor(id: ProjectId, best: number): number {
  const reached = starTargets(id).filter((target) => best >= target).length;
  return Math.min(PLAY_STARS.count, reached);
}

/** 다음 별을 따는 점수. 별을 다 땄으면 null */
export function nextStarTarget(id: ProjectId, best: number): number | null {
  const stars = starsFor(id, best);
  return stars >= PLAY_STARS.count ? null : (starTargets(id)[stars] ?? null);
}

/** 게임마다의 최고 기록으로 모든 출시작의 별을 센다. bestOf는 게임 id를 받아 최고 기록을 돌려준다. */
export function readStars(bestOf: (gameId: string) => number): Partial<Record<ProjectId, number>> {
  const stars: Partial<Record<ProjectId, number>> = {};
  for (const id of PROJECT_ORDER) {
    const count = starsFor(id, bestOf(id));
    if (count > 0) stars[id] = count;
  }
  return stars;
}
