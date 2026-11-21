/**
 * 구름 탑 모험의 물약. 한 번 마시면(던지면) 없어지는 것으로, 판 동안 칸 3개에 들고 다닌다.
 * 싸움에서 이기면 가끔 받고, 가게에서 산다. 싸우는 동안 마력 없이 아무 때나 쓴다.
 * 물약이 하는 일은 카드와 같은 Act로 적어서, 싸움 규칙(battle.ts의 useActs)과 설명(text.ts)을 그대로 쓴다.
 */
import { pick, rand, shuffle, type BattleKind, type Rng } from './battle';
import type { Act } from './data';
import type { RunState } from './run';

/** 들고 다닐 수 있는 물약 수 */
export const POTION_SLOTS = 3;

export type PotionRarity = 'common' | 'uncommon';

export interface PotionDef {
  name: string;
  rarity: PotionRarity;
  acts: readonly Act[];
}

const POTION_DATA = {
  berry: { name: '딸기 물약', rarity: 'common', acts: [{ k: 'heal', n: 15 }] },
  fire: { name: '불꽃 물약', rarity: 'common', acts: [{ k: 'hit', n: 20 }] },
  cloud: { name: '구름 물약', rarity: 'common', acts: [{ k: 'block', n: 12 }] },
  toad: { name: '독버섯 물약', rarity: 'common', acts: [{ k: 'give', s: 'poison', n: 7 }] },
  thunder: { name: '번개 물약', rarity: 'uncommon', acts: [{ k: 'hitAll', n: 10 }] },
  brave: { name: '용기 물약', rarity: 'uncommon', acts: [{ k: 'gain', s: 'strength', n: 2 }] },
  star: { name: '별빛 물약', rarity: 'uncommon', acts: [{ k: 'mana', n: 2 }] },
  wise: { name: '지혜 물약', rarity: 'uncommon', acts: [{ k: 'draw', n: 3 }] },
} as const satisfies Record<string, PotionDef>;

export type PotionId = keyof typeof POTION_DATA;
export const POTIONS: Readonly<Record<PotionId, PotionDef>> = POTION_DATA;
export const POTION_IDS = Object.keys(POTIONS) as PotionId[];

export const isPotionId = (value: unknown): value is PotionId => typeof value === 'string' && value in POTIONS;

/** 가게 값(조금씩 오르내린다) */
export const POTION_PRICES: Readonly<Record<PotionRarity, number>> = { common: 50, uncommon: 70 };

/** 싸움에서 이겼을 때 물약이 나올 확률 */
export const POTION_DROP: Readonly<Record<BattleKind, number>> = { fight: 0.4, elite: 0.6, boss: 1 };

/** 물약 하나를 고른다. 귀한 물약은 셋에 하나꼴이다. */
export function rollPotion(rng: Rng): PotionId {
  const rarity: PotionRarity = rand(rng) < 1 / 3 ? 'uncommon' : 'common';
  return pick(
    rng,
    POTION_IDS.filter((id) => POTIONS[id].rarity === rarity),
  );
}

/** 싸움에서 이긴 뒤에 나오는 물약. 안 나오면 null */
export function rollPotionDrop(rng: Rng, kind: BattleKind): PotionId | null {
  return rand(rng) < POTION_DROP[kind] ? rollPotion(rng) : null;
}

/** 가게에 놓을 물약 두 개(서로 다르다) */
export function shopPotions(rng: Rng): { id: PotionId; price: number; sold: boolean }[] {
  return shuffle(rng, [...POTION_IDS])
    .slice(0, 2)
    .map((id) => ({ id, price: Math.round(POTION_PRICES[POTIONS[id].rarity] * (0.9 + rand(rng) * 0.2)), sold: false }));
}

// ───────── 판에서 ─────────

/** 들고 있는 물약. 물약이 생기기 전에 저장한 판도 빈 칸으로 읽는다. */
export function potionsOf(run: RunState): PotionId[] {
  if (!Array.isArray(run.potions)) run.potions = [];
  return run.potions;
}

export function hasPotionRoom(run: RunState): boolean {
  return potionsOf(run).length < POTION_SLOTS;
}

/** 빈 칸에 물약을 넣는다. 칸이 가득 차면 false */
export function addPotion(run: RunState, id: PotionId): boolean {
  if (!hasPotionRoom(run)) return false;
  potionsOf(run).push(id);
  return true;
}

/** 가게에서 물약을 산다. 칸이 가득 차면 못 산다. */
export function buyPotion(run: RunState, index: number): boolean {
  const item = run.shop?.potions?.[index];
  if (run.stage !== 'shop' || !item || item.sold || run.gold < item.price || !hasPotionRoom(run)) return false;
  run.gold -= item.price;
  item.sold = true;
  addPotion(run, item.id);
  return true;
}

/** 보상 화면에서 칸이 가득 차서 못 받은 물약이 있으면 그것 */
export function waitingPotion(run: RunState): PotionId | null {
  const potion = run.reward?.potion;
  return potion && !potion.taken ? potion.id : null;
}

/** 칸이 가득 찼을 때, slot번째 물약을 버리고 보상 물약을 그 자리에 넣는다. */
export function swapRewardPotion(run: RunState, slot: number): boolean {
  const potion = run.reward?.potion;
  const potions = potionsOf(run);
  if (run.stage !== 'reward' || !potion || potion.taken || slot < 0 || slot >= potions.length) return false;
  potions[slot] = potion.id;
  potion.taken = true;
  return true;
}

/** 싸움 밖(지도, 가게 등)에서 slot번째 물약을 버린다. 싸우는 중이거나 판이 끝났으면 false */
export function discardPotion(run: RunState, slot: number): boolean {
  const potions = potionsOf(run);
  if (run.stage === 'battle' || run.stage === 'over' || run.result !== null) return false;
  if (!Number.isInteger(slot) || slot < 0 || slot >= potions.length) return false;
  potions.splice(slot, 1);
  return true;
}
