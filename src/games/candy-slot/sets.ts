/**
 * 부적 세트: 뜻이 이어지는 부적 몇 장을 한 세트로 묶고, 같은 세트의 부적을 여럿 붙이면 덤 효과를 준다.
 * 무엇을 모아 갈지 방향을 잡아 주려는 것이다. 붙인 부적의 목록만 보고 셈하므로 저장할 것이 따로 없다.
 *
 * 세트의 덤은 부적의 효과(CharmEffect)와 같은 모양이라, rules.ts가 붙인 부적의 효과에 덤을 더해서 셈한다.
 * 그래서 확률, 상금, 줄의 곱, 스핀의 셈이 모두 세트를 따르고, 자동 플레이와 가게의 미리 보기도 같은 값을 본다.
 *
 * 화면과 저장소 어느 쪽에도 기대지 않는 순수 함수들이다. rules.ts와 서로를 가져오므로, 여기서는 rules.ts의 값을
 * 모듈을 읽는 때에 쓰지 않고 함수 안에서만 쓴다(그림 번호는 수로 적는다).
 */
import { baseOf, type CharmEffect } from './rules';

export type SetId = 'cherry' | 'clover' | 'bell' | 'horseshoe' | 'diamond' | 'seven';

/** 세트의 한 단계: 같은 세트의 부적을 count장 이상 붙이면 듣는 덤. 여러 단계에 닿으면 가장 높은 단계 하나만 듣는다. */
export interface SetTier {
  count: number;
  /** 덤을 알리는 짧은 한 줄 */
  description: string;
  effect: CharmEffect;
}

export interface CharmSet {
  id: SetId;
  /** "체리 세트" */
  name: string;
  /** 가게의 카드에 다는 짧은 표: "체리" */
  tag: string;
  /** 세트에 드는 부적의 id(강화하기 전의 것). 한 부적은 많아야 한 세트에만 든다. */
  members: readonly string[];
  /** 단계. count가 작은 것부터이고, 윗단계의 덤은 아랫단계의 덤을 갈음한다(겹쳐 듣지 않는다). */
  tiers: readonly SetTier[];
}

// 그림 번호(rules.ts의 SYMBOLS 차례)
const CHERRY = 0;
const CLOVER = 1;
const BELL = 2;
const HORSESHOE = 3;
const DIAMOND = 4;
const SEVEN = 5;

/**
 * 세트의 목록. 그림마다 듬뿍과 황금이 한 세트이고, 셋째 장은 그 그림과 어울리는 부적이다:
 * 체리는 둘씩 달리니 쌍둥이 줄, 클로버와 종은 자리를 비켜 주는 덜기, 말굽은 넘어져도 일어나는 오뚝이,
 * 다이아는 마지막에 터뜨리는 막판 한 방, 7은 7을 부르는 부적 셋이다.
 * 가로·세로 두 배, 덤 스핀, 저금통, 위로 금화, 왕관은 어느 세트에도 들지 않아서, 어느 세트에 붙여도 된다.
 *
 * 덤은 두 장이면 그 그림의 상금이 조금 오르고, 세 장을 다 모으면 더 오른다(7 세트는 7이 더 나오고, 다 모으면 한 번 더 돌린다).
 * 덤은 더하기라서 강화와 함께 커지지 않는다: 초반에 힘이 되고, 강화가 쌓인 뒤쪽 라운드에서는 작아진다.
 * 세 장의 덤을 곱(그 그림의 줄 두 배)으로 했을 때에는 끝까지 강화한 조합이 스무 라운드를 훌쩍 넘겼다.
 */
export const CHARM_SETS: readonly CharmSet[] = [
  {
    id: 'cherry', name: '체리 세트', tag: '체리',
    members: ['more-cherry', 'gold-cherry', 'twins'],
    tiers: [
      { count: 2, description: '체리 상금 +1', effect: { value: [CHERRY, 1] } },
      { count: 3, description: '체리 상금 +4', effect: { value: [CHERRY, 4] } },
    ],
  },
  {
    id: 'clover', name: '클로버 세트', tag: '클로버',
    members: ['more-clover', 'gold-clover', 'less-cherry'],
    tiers: [
      { count: 2, description: '클로버 상금 +1', effect: { value: [CLOVER, 1] } },
      { count: 3, description: '클로버 상금 +3', effect: { value: [CLOVER, 3] } },
    ],
  },
  {
    id: 'bell', name: '종 세트', tag: '종',
    members: ['more-bell', 'gold-bell', 'less-clover'],
    tiers: [
      { count: 2, description: '종 상금 +1', effect: { value: [BELL, 1] } },
      { count: 3, description: '종 상금 +6', effect: { value: [BELL, 6] } },
    ],
  },
  {
    id: 'horseshoe', name: '말굽 세트', tag: '말굽',
    members: ['more-horseshoe', 'gold-horseshoe', 'rebound'],
    tiers: [
      { count: 2, description: '말굽 상금 +2', effect: { value: [HORSESHOE, 2] } },
      { count: 3, description: '말굽 상금 +10', effect: { value: [HORSESHOE, 10] } },
    ],
  },
  {
    id: 'diamond', name: '다이아 세트', tag: '다이아',
    members: ['more-diamond', 'gold-diamond', 'finale'],
    tiers: [
      { count: 2, description: '다이아 상금 +3', effect: { value: [DIAMOND, 3] } },
      { count: 3, description: '다이아 상금 +15', effect: { value: [DIAMOND, 15] } },
    ],
  },
  {
    id: 'seven', name: '7 세트', tag: '7',
    members: ['more-seven', 'middle', 'slant'],
    tiers: [
      { count: 2, description: '7이 조금 더 나와요', effect: { weight: [SEVEN, 2] } },
      { count: 3, description: '7 늘고 한 번 더 돌려요', effect: { weight: [SEVEN, 3], spins: 1 } },
    ],
  },
];

/** 그 부적(강화했든 아니든)이 드는 세트. 어느 세트에도 들지 않으면 undefined. */
export function setOf(id: string): CharmSet | undefined {
  const base = baseOf(id);
  return CHARM_SETS.find((set) => set.members.includes(base));
}

/** 붙인 부적 가운데 그 세트에 드는 것의 수. 강화한 부적도 원래 부적으로 세고, 같은 부적은 한 번만 센다. */
export function setCount(charms: readonly string[], set: CharmSet): number {
  const bases = new Set(charms.map(baseOf));
  return set.members.filter((id) => bases.has(id)).length;
}

/** 세트 하나를 얼마나 모았는지 */
export interface SetProgress {
  set: CharmSet;
  /** 붙인 부적 가운데 이 세트에 드는 것의 수 */
  count: number;
  /** 세트에 드는 부적의 수 */
  size: number;
  /** 지금 듣는 단계. 두 장도 모으지 않았으면 null */
  active: SetTier | null;
  /** 다음에 닿을 단계. 다 모았으면 null */
  next: SetTier | null;
}

function progressOf(charms: readonly string[], set: CharmSet): SetProgress {
  const count = setCount(charms, set);
  return {
    set,
    count,
    size: set.members.length,
    active: set.tiers.filter((tier) => count >= tier.count).at(-1) ?? null,
    next: set.tiers.find((tier) => count < tier.count) ?? null,
  };
}

/** 한 장이라도 붙인 세트마다의 모은 정도. 차례는 CHARM_SETS의 차례다. */
export function setProgressOf(charms: readonly string[]): SetProgress[] {
  return CHARM_SETS.map((set) => progressOf(charms, set)).filter((progress) => progress.count > 0);
}

/** 지금 듣는 세트의 덤 하나 */
export interface SetBonus {
  set: CharmSet;
  tier: SetTier;
}

/**
 * 붙인 부적으로 지금 듣는 세트의 덤들. 세트마다 많아야 하나(닿은 가장 높은 단계)이고, 차례는 세트의 차례다.
 * 가게의 미리 보기처럼 "이 부적을 붙이면" 무엇이 달라지는지 볼 때는 붙일 부적까지 넣은 목록을 준다.
 */
export function setBonusesOf(charms: readonly string[]): SetBonus[] {
  return CHARM_SETS.flatMap((set) => {
    const { active } = progressOf(charms, set);
    return active ? [{ set, tier: active }] : [];
  });
}

/** 세트의 덤들의 효과. rules.ts가 붙인 부적의 효과 뒤에 더한다. */
export function setEffectsOf(charms: readonly string[]): CharmEffect[] {
  return setBonusesOf(charms).map((bonus) => bonus.tier.effect);
}

/** 모은 정도를 적는 글: "체리 세트 2/3" */
export function setProgressText(progress: Pick<SetProgress, 'set' | 'count' | 'size'>): string {
  return `${progress.set.name} ${progress.count}/${progress.size}`;
}

// ───────── 화면에 적는 글 ─────────

/** 세트에 대해 화면에 적는 글 */
export const SET_TEXT = {
  /** 가게의 세트 줄: 모은 세트가 하나도 없을 때 */
  teach: '같은 세트를 모으면 덤이 있어요',
} as const;

/** 아직 닿지 못한 단계를 알리는 글: "2장이면 체리 상금 +2" */
export function nextTierText(tier: SetTier): string {
  return `${tier.count}장이면 ${tier.description}`;
}

/** 붙인 부적의 설명 창에 적는 세트의 한 줄 */
export interface SetNote {
  set: CharmSet;
  /** "체리 세트 2/3" */
  progress: string;
  /** 지금 듣는 덤의 설명이거나, 아직 듣는 덤이 없으면 다음 단계를 알리는 글 */
  bonus: string;
  /** 덤이 듣고 있는지 */
  active: boolean;
}

/** 붙인 부적 id의 설명 창에 적을 세트의 한 줄. 세트에 들지 않는 부적이면 null */
export function setNoteOf(charms: readonly string[], id: string): SetNote | null {
  const set = setOf(id);
  if (!set) return null;
  const progress = progressOf(charms, set);
  const bonus = progress.active ? progress.active.description : progress.next ? nextTierText(progress.next) : '';
  return { set, progress: setProgressText(progress), bonus, active: progress.active !== null };
}

/**
 * 가게의 세트 줄에 놓을 세트들: 한 장이라도 붙인 세트를, 많이 모은 것부터 놓는다.
 * 모은 수가 같으면 지금 가게에 나온 부적이 드는 세트를 앞에 놓는다(사면 바로 모은 수가 느는 세트다).
 */
export function shopSetsOf(charms: readonly string[], offers: readonly (string | null)[]): SetProgress[] {
  const offered = new Set(offers.flatMap((id) => (id ? [setOf(id)?.id] : [])));
  return setProgressOf(charms)
    .map((progress, order) => ({ progress, order, offered: offered.has(progress.set.id) ? 0 : 1 }))
    .sort((a, b) => b.progress.count - a.progress.count || a.offered - b.offered || a.order - b.order)
    .map((item) => item.progress);
}

/** before에서 after로 붙인 부적이 바뀌며 새로 들게 된 덤(새로 든 세트이거나 윗단계로 오른 것). 차례는 세트의 차례다. */
export function newSetBonuses(before: readonly string[], after: readonly string[]): SetBonus[] {
  const had = setBonusesOf(before);
  return setBonusesOf(after).filter(
    (bonus) => !had.some((old) => old.set.id === bonus.set.id && old.tier.count >= bonus.tier.count),
  );
}

/** 덤이 새로 들었을 때 띄우는 알림: "체리 세트! 체리 상금 +2" */
export function setCheerText(bonus: SetBonus): string {
  return `${bonus.set.name}! ${bonus.tier.description}`;
}
