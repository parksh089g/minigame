/**
 * 유물: 행운 조각으로 단계를 올리는 것. 판이 끝나도 남고, 오래 할수록 아주 조금씩 세지며, 단계는 RELIC_MAX에서 멈춘다.
 * 유물이 판에서 하는 일은 rules.ts(RELIC_IDS, RELIC_STEP, targetFor, interestFor, upgradeCostOf, refundOf)가 정하고,
 * 여기서는 이름과 설명, 단계를 올리는 값, 화면에 적는 글을 정한다. 조각은 영구 해금(perks.ts)과 같은 것을 쓴다:
 * 해금 넷은 한 번씩만 열고, 그 뒤에 모이는 조각은 모두 유물로 간다.
 * 누구나 같은 조건으로 하는 오늘의 판에는 듣지 않는다.
 * 화면과 저장소 어느 쪽에도 기대지 않는 순수 함수들이다.
 */
import { activeNote, canUnlockAny, perkLabel, PERKS, unlockedCount, type PerkState } from './perks';
import {
  REFUND_RATE,
  RELIC_IDS,
  RELIC_MAX,
  RELIC_STEP,
  relicLevel,
  type RelicId,
  type RelicLevels,
} from './rules';

/** 가진 조각과 유물의 단계. 허브 세이브의 slot(save.ts의 SlotSave)에 들어 있다. */
export interface RelicState {
  pieces: number;
  relics: RelicLevels;
}

/** 조각으로 사 둔 것 모두: 영구 해금과 유물 */
export type KeepState = PerkState & RelicState;

export interface RelicInfo {
  id: RelicId;
  name: string;
  /** 유물을 눌렀을 때 목록 아래에 보이는 한 줄 */
  description: string;
  /** 효과를 적는 줄의 앞머리. 뒤에 "지금 값 → 다음 값"이 붙는다. */
  lead: string;
}

/** 유물의 목록. 차례는 RELIC_IDS의 차례다. */
export const RELICS: readonly RelicInfo[] = [
  { id: 'scale', name: '낡은 저울', description: '라운드마다 내는 목표가 조금 낮아져요', lead: '목표' },
  { id: 'seal', name: '상인의 도장', description: '부적을 뗄 때 금화를 더 돌려받아요', lead: '돌려받는 몫' },
  { id: 'hammer', name: '대장장이 망치', description: '부적을 강화하는 값이 싸져요', lead: '강화 값' },
  { id: 'jar', name: '금화 항아리', description: '라운드를 넘길 때 남은 금화에 덤을 받아요', lead: '남은 금화의' },
];

export function relicOf(id: RelicId): RelicInfo {
  const relic = RELICS.find((item) => item.id === id);
  if (!relic) throw new Error(`없는 유물: ${id}`);
  return relic;
}

// ───────── 값 ─────────

/**
 * 단계를 올리는 값: 첫 단계는 first개, 그 뒤로 한 단계마다 step개씩 비싸진다(6, 8, … 24).
 * 조각은 한 판에 일곱에서 열 개쯤 들어온다(perks.ts의 PERKS를 보라). 첫 단계는 한 판이면 사고 마지막 단계는 세 판쯤 걸려서,
 * 처음에는 판마다 무엇인가 오르고 갈수록 천천히 오른다. 유물 하나를 다 올리는 데 150개, 넷을 다 올리는 데 600개가 든다.
 * 해금 넷(140개)까지 더하면 740개라, 모두 채우려면 백 판쯤 해야 한다. 유물 넷의 값은 같다:
 * 어느 것도 판을 크게 바꾸지 않아서 값으로 차례를 정해 줄 까닭이 없고, 좋아하는 것부터 올리면 된다.
 */
export const RELIC_PRICE = { first: 6, step: 2 } as const;

/** level단계에서 한 단계 올리는 데 드는 조각. 다 올렸으면 null이다. */
export function relicPrice(level: number): number | null {
  if (!Number.isInteger(level) || level < 0 || level >= RELIC_MAX) return null;
  return RELIC_PRICE.first + RELIC_PRICE.step * level;
}

/** 유물 하나를 0단계에서 끝까지 올리는 데 드는 조각 */
export const RELIC_FULL_PRICE = Array.from({ length: RELIC_MAX }, (_, level) => relicPrice(level) ?? 0).reduce(
  (sum, price) => sum + price,
  0,
);

// ───────── 단계 올리기 ─────────

/** 그 유물의 단계(0~RELIC_MAX) */
export function levelOf(state: Pick<RelicState, 'relics'>, id: RelicId): number {
  return relicLevel(state, id);
}

/** 모든 유물의 단계를 더한 것 */
export function levelSum(state: Pick<RelicState, 'relics'>): number {
  return RELIC_IDS.reduce((sum, id) => sum + levelOf(state, id), 0);
}

/** 모든 유물을 다 올렸을 때의 단계의 합 */
export const LEVEL_SUM_MAX = RELIC_IDS.length * RELIC_MAX;

/** 단계를 올릴 수 없는 까닭. 올릴 수 있으면 null. max는 다 올린 것, pieces는 조각이 모자란 것이다. */
export type RaiseBlock = 'max' | 'pieces';

export function raiseBlock(state: RelicState, id: RelicId): RaiseBlock | null {
  const price = relicPrice(levelOf(state, id));
  if (price === null) return 'max';
  return state.pieces < price ? 'pieces' : null;
}

export function canRaise(state: RelicState, id: RelicId): boolean {
  return raiseBlock(state, id) === null;
}

/** 지금 가진 조각으로 올릴 수 있는 유물이 하나라도 있는지 */
export function canRaiseAny(state: RelicState): boolean {
  return RELIC_IDS.some((id) => canRaise(state, id));
}

/** 다음 단계까지 모자란 조각. 다 올렸거나 넉넉하면 0이다. */
export function relicShortOf(state: RelicState, id: RelicId): number {
  const price = relicPrice(levelOf(state, id));
  return price === null ? 0 : Math.max(0, price - state.pieces);
}

/**
 * 조각을 내고 그 유물을 한 단계 올린 새 상태를 돌려준다. 올릴 수 없으면(다 올렸거나 조각이 모자라면) 받은 것 그대로다.
 * 단계는 RELIC_IDS의 차례로, 1단계 이상인 것만 적는다. 한 번 올린 단계는 내려가지 않는다.
 */
export function raise<T extends RelicState>(state: T, id: RelicId): T {
  const level = levelOf(state, id);
  const price = relicPrice(level);
  if (price === null || state.pieces < price) return state;
  const relics: RelicLevels = {};
  for (const relic of RELIC_IDS) {
    const next = relic === id ? level + 1 : levelOf(state, relic);
    if (next > 0) relics[relic] = next;
  }
  return { ...state, pieces: state.pieces - price, relics };
}

// ───────── 화면에 적는 글 ─────────

/** 천분율을 백분율로 적는다: 5는 "0.5", 20은 "2". 소수 셈을 거치지 않아서 값이 어긋나지 않는다. */
function permilleText(permille: number): string {
  const whole = Math.floor(permille / 10);
  const rest = permille % 10;
  return rest === 0 ? String(whole) : `${whole}.${rest}`;
}

/**
 * 그 단계에서 유물이 하는 일을 값으로 적는다. rules.ts의 셈과 같은 수(RELIC_STEP, REFUND_RATE)에서 만든다.
 * 깎이는 것(목표, 강화 값)은 앞에 -를 붙이고, 0단계는 "0%"다.
 */
export function effectValue(id: RelicId, level: number): string {
  const amount = RELIC_STEP[id] * level;
  switch (id) {
    case 'scale':
      return amount === 0 ? '0%' : `-${permilleText(amount)}%`;
    case 'seal':
      return `${Math.round(REFUND_RATE * 100) + amount}%`;
    case 'hammer':
      return amount === 0 ? '0%' : `-${amount}%`;
    case 'jar':
      return `${permilleText(amount)}%`;
  }
}

/**
 * 유물의 줄에 적는 효과: "목표 -1.5% → -2%"처럼 지금 값과 다음 단계의 값. 다 올렸으면 지금 값만 적는다.
 */
export function effectLine(id: RelicId, level: number): string {
  const { lead } = relicOf(id);
  const now = effectValue(id, level);
  return level >= RELIC_MAX ? `${lead} ${now}` : `${lead} ${now} → ${effectValue(id, level + 1)}`;
}

export const RELIC_TEXT = {
  /** 유물 쪽의 이름 */
  title: '유물',
  /** 다 올린 유물의 줄에 값 대신 적는 글 */
  max: '다 올림',
  /** 다 올린 유물의 단계 자리에 적는 글 */
  end: '끝',
  /** 아무 유물도 누르지 않았을 때 설명 칸에 적는 글 */
  idle: '유물을 누르면 설명이 보여요',
  /** 다 올린 유물의 값 자리를 눌렀을 때 */
  maxed: '끝까지 올렸어요',
} as const;

/** 이름 옆에 적는 단계: "3단계". 다 올렸으면 "끝" */
export function levelText(level: number): string {
  return level >= RELIC_MAX ? RELIC_TEXT.end : `${level}단계`;
}

/** 방금 단계를 올렸을 때 알리는 한 줄. level은 올린 뒤의 단계다. */
export function raisedNotice(id: RelicId, level: number): string {
  return `${relicOf(id).name} ${level}단계로 강화!`;
}

/** 조각이 모자라서 올리지 못했을 때 알리는 한 줄 */
export function relicShortNotice(state: RelicState, id: RelicId): string {
  return `조각이 ${relicShortOf(state, id)}개 모자라요`;
}

// ───────── 시작 화면 ─────────

/** 해금을 다 열었는지. 다 열고 나면 조각은 유물에만 쓴다. */
export function allUnlocked(state: PerkState): boolean {
  return unlockedCount(state) >= PERKS.length;
}

/**
 * 시작 화면의 버튼에 적는 글. 해금이 남아 있으면 "해금 1/4", 다 열었으면 유물의 단계를 더해 "유물 12/40"이다.
 * 버튼을 누르면 그 글에 적힌 쪽이 먼저 보인다(startTab).
 */
export function keepLabel(state: KeepState): string {
  return allUnlocked(state) ? `${RELIC_TEXT.title} ${levelSum(state)}/${LEVEL_SUM_MAX}` : perkLabel(state);
}

/** 창을 열었을 때 먼저 보이는 쪽 */
export type KeepTab = 'perks' | 'relics';

export function startTab(state: PerkState): KeepTab {
  return allUnlocked(state) ? 'relics' : 'perks';
}

/**
 * 시작 화면의 버튼에 점을 달지: 지금 가진 조각으로 살 것이 있는지. 해금이 남아 있는 동안에는 해금만 본다
 * (해금을 모으는 사람에게 값싼 유물 때문에 늘 점이 달려 있지 않게). 다 열고 나면 유물을 본다.
 */
export function canSpend(state: KeepState): boolean {
  return allUnlocked(state) ? canRaiseAny(state) : canUnlockAny(state);
}

/**
 * 시작 화면에 작게 적는 한 줄: 여느 판이면 켜져 있는 해금의 수와 유물의 단계, 오늘의 판이면 그것들 없이 한다는 것.
 * 연 해금도 올린 유물도 없으면 적을 것이 없어서 null이다.
 */
export function keepNote(state: KeepState, daily: boolean): string | null {
  const levels = levelSum(state);
  if (levels === 0) return activeNote(state, daily);
  const perks = unlockedCount(state);
  if (daily) return perks > 0 ? '오늘의 판은 해금과 유물 없이 해요' : '오늘의 판은 유물 없이 해요';
  return perks > 0 ? `해금 ${perks}개와 유물 ${levels}단계가 켜져 있어요` : `유물 ${levels}단계가 켜져 있어요`;
}
