/**
 * 테스트에서 쓰는 옛 저장 만들기. 지금의 판(버전 4)을 동료가 생기기 전(버전 3)의 모양으로 되돌린다.
 * 옛 판에는 동료 대신 해바라기 도우미의 수(stats.helpers)와 쏠 때까지의 시간(helperIn), 고른 강화(boons, offer)가 있었다.
 */
import type { RunState } from './sim';

export interface LegacyOptions {
  /** 해바라기 도우미의 수 */
  helpers?: number;
  /** 해바라기 거름의 단계 */
  compost?: number;
  /** 고른 강화와 고르기를 기다리던 강화 */
  boons?: string[];
  offer?: string[];
}

export function toVersion3(state: RunState, options: LegacyOptions = {}): Record<string, unknown> {
  const copy = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
  delete copy.allies;
  delete copy.fruit;
  delete copy.shopping;
  delete copy.shop;
  delete copy.rolls;
  const helpers = options.helpers ?? 0;
  copy.helperIn = Array.from({ length: helpers }, (_, index) => 0.3 + index * 0.2);
  copy.boons = options.boons ?? [];
  copy.offer = options.offer ?? [];
  const stats = copy.stats as Record<string, unknown>;
  delete stats.allyPower;
  stats.helpers = helpers;
  stats.helperDamage = (stats.damage as number) * (0.4 + 0.15 * (options.compost ?? 0));
  copy.shots = (copy.shots as Array<Record<string, unknown>>).map(({ ally, ...shot }) => ({ ...shot, helper: ally !== '' }));
  return copy;
}
