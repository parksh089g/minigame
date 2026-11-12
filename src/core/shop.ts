/**
 * 꾸미기 상점: 코인으로 사서 바꿔 끼우는 겉모습(배경, 캐릭터, 카드 뒷면, 구슬).
 * 게임 규칙에는 영향을 주지 않는다. 저장소와 화면 어느 쪽에도 의존하지 않는 순수 함수들이다.
 * 실제 색과 무늬는 art/cosmetics.ts에 있다.
 */

/** 꾸미기를 끼우는 자리. 자리마다 하나만 쓸 수 있다. */
export const SLOTS = ['backdrop', 'runner', 'cardBack', 'orb'] as const;
export type CosmeticSlot = (typeof SLOTS)[number];

export interface SlotInfo {
  /** 상점 탭에 보이는 짧은 이름 */
  label: string;
  /** 어디에 쓰이는지 한 줄 설명 */
  hint: string;
}

export const SLOT_INFO: Record<CosmeticSlot, SlotInfo> = {
  backdrop: { label: '배경', hint: '모든 화면에 깔리는 배경 무늬예요.' },
  runner: { label: '캐릭터', hint: '함께 노는 친구예요. 점프 러너에서 달려요.' },
  cardBack: { label: '카드', hint: '기억 카드의 뒷면 무늬예요.' },
  orb: { label: '구슬', hint: '번개 탭에 나오는 구슬이에요.' },
};

export interface CosmeticItem {
  /** 세이브에 쓰이는 고유 id. 한 번 정하면 바꾸지 않는다. */
  id: string;
  slot: CosmeticSlot;
  name: string;
  /** 코인 가격. 0이면 처음부터 가지고 있다. */
  price: number;
}

/**
 * 살 수 있는 것 전부. 자리마다 첫 번째가 기본(무료)이다.
 * 상점은 한 자리에 여섯 개까지 한 화면에 놓는다(가장 짧은 화면 기준). 더 늘리려면 상점에 쪽 넘기기가 있어야 한다.
 */
export const CATALOG: readonly CosmeticItem[] = [
  // id는 픽셀 디자인 시절에 정한 것이라 이름과 다를 수 있다(backdrop-night는 지금 크림색이다).
  { id: 'backdrop-night', slot: 'backdrop', name: '복숭아 크림', price: 0 },
  { id: 'backdrop-forest', slot: 'backdrop', name: '민트 숲', price: 40 },
  { id: 'backdrop-sunset', slot: 'backdrop', name: '살구 노을', price: 100 },
  { id: 'backdrop-galaxy', slot: 'backdrop', name: '라벤더 별밤', price: 180 },
  { id: 'backdrop-ocean', slot: 'backdrop', name: '하늘 구름', price: 260 },
  { id: 'backdrop-blossom', slot: 'backdrop', name: '벚꽃 길', price: 360 },

  { id: 'runner-sprout', slot: 'runner', name: '새싹이', price: 0 },
  { id: 'runner-drop', slot: 'runner', name: '물방울', price: 40 },
  { id: 'runner-duck', slot: 'runner', name: '오리', price: 70 },
  { id: 'runner-chick', slot: 'runner', name: '병아리', price: 100 },
  { id: 'runner-dog', slot: 'runner', name: '강아지', price: 140 },
  { id: 'runner-ghost', slot: 'runner', name: '꼬마 유령', price: 180 },

  { id: 'cardback-blue', slot: 'cardBack', name: '하늘 마름모', price: 0 },
  { id: 'cardback-green', slot: 'cardBack', name: '풀빛 물방울', price: 40 },
  { id: 'cardback-red', slot: 'cardBack', name: '딸기 바둑판', price: 100 },
  { id: 'cardback-gold', slot: 'cardBack', name: '황금 줄무늬', price: 180 },
  { id: 'cardback-lavender', slot: 'cardBack', name: '라벤더 물방울', price: 260 },
  { id: 'cardback-peach', slot: 'cardBack', name: '복숭아 바둑판', price: 360 },

  { id: 'orb-blue', slot: 'orb', name: '하늘 구슬', price: 0 },
  { id: 'orb-green', slot: 'orb', name: '풀빛 구슬', price: 40 },
  { id: 'orb-red', slot: 'orb', name: '딸기 구슬', price: 100 },
  { id: 'orb-moon', slot: 'orb', name: '달빛 구슬', price: 180 },
  { id: 'orb-grape', slot: 'orb', name: '포도 구슬', price: 260 },
  { id: 'orb-ocean', slot: 'orb', name: '바다 구슬', price: 360 },
];

/** 세이브에 남기는 꾸미기 상태 */
export interface CosmeticsState {
  /** 코인으로 산 꾸미기의 id. 무료인 기본 꾸미기는 적지 않는다. */
  owned: string[];
  /** 자리마다 지금 쓰고 있는 꾸미기의 id */
  equipped: Record<CosmeticSlot, string>;
}

export function getItem(id: string): CosmeticItem | undefined {
  return CATALOG.find((item) => item.id === id);
}

export function itemsIn(slot: CosmeticSlot): CosmeticItem[] {
  return CATALOG.filter((item) => item.slot === slot);
}

/** 그 자리의 기본 꾸미기(무료인 첫 번째) */
export function defaultItem(slot: CosmeticSlot): CosmeticItem {
  const item = CATALOG.find((entry) => entry.slot === slot && entry.price === 0);
  if (!item) throw new Error(`기본 꾸미기가 없는 자리: ${slot}`);
  return item;
}

function defaultEquipped(): Record<CosmeticSlot, string> {
  return {
    backdrop: defaultItem('backdrop').id,
    runner: defaultItem('runner').id,
    cardBack: defaultItem('cardBack').id,
    orb: defaultItem('orb').id,
  };
}

export function createCosmetics(): CosmeticsState {
  return { owned: [], equipped: defaultEquipped() };
}

/** 가지고 있는지. 무료 꾸미기는 언제나 가진 것으로 친다. */
export function isOwned(state: CosmeticsState, id: string): boolean {
  const item = getItem(id);
  if (!item) return false;
  return item.price === 0 || state.owned.includes(id);
}

export function isEquipped(state: CosmeticsState, id: string): boolean {
  const item = getItem(id);
  return item !== undefined && state.equipped[item.slot] === id;
}

/**
 * 저장소에서 읽은 값을 안전한 CosmeticsState로 바꾼다.
 * 모르는 id는 버리고, 가지지 않은 것을 쓰고 있으면 기본으로 되돌린다.
 */
export function normalizeCosmetics(raw: unknown): CosmeticsState {
  const state = createCosmetics();
  if (typeof raw !== 'object' || raw === null) return state;
  const value = raw as Record<string, unknown>;

  if (Array.isArray(value.owned)) {
    for (const id of value.owned) {
      if (typeof id !== 'string' || state.owned.includes(id)) continue;
      const item = getItem(id);
      if (item && item.price > 0) state.owned.push(id);
    }
  }

  if (typeof value.equipped === 'object' && value.equipped !== null) {
    const equipped = value.equipped as Record<string, unknown>;
    for (const slot of SLOTS) {
      const id = equipped[slot];
      if (typeof id !== 'string') continue;
      if (getItem(id)?.slot === slot && isOwned(state, id)) state.equipped[slot] = id;
    }
  }
  return state;
}

export type PurchaseResult =
  | { ok: true; coins: number; cosmetics: CosmeticsState; item: CosmeticItem }
  | { ok: false; reason: 'unknown' | 'owned' }
  | { ok: false; reason: 'coins'; shortBy: number };

/** 코인을 내고 꾸미기를 산다. 산 것은 바로 끼운다. 원본은 바꾸지 않는다. */
export function purchase(coins: number, state: CosmeticsState, id: string): PurchaseResult {
  const item = getItem(id);
  if (!item) return { ok: false, reason: 'unknown' };
  if (isOwned(state, id)) return { ok: false, reason: 'owned' };
  if (coins < item.price) return { ok: false, reason: 'coins', shortBy: item.price - coins };
  return {
    ok: true,
    coins: coins - item.price,
    cosmetics: {
      owned: [...state.owned, id],
      equipped: { ...state.equipped, [item.slot]: id },
    },
    item,
  };
}

/** 가진 꾸미기를 끼운 새 상태를 돌려준다. 가지지 않았거나 이미 쓰는 중이면 받은 상태 그대로다. */
export function equip(state: CosmeticsState, id: string): CosmeticsState {
  const item = getItem(id);
  if (!item || !isOwned(state, id) || state.equipped[item.slot] === id) return state;
  return { owned: [...state.owned], equipped: { ...state.equipped, [item.slot]: id } };
}
