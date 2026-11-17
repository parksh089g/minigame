/**
 * 영구 해금: 판에서 모은 행운 조각으로 한 번 열어 두면 판이 끝나도 남아서, 다음 여느 판부터 늘 듣는 것.
 * 해금이 판에서 하는 일은 rules.ts(PERK_IDS, slotsOf, holdsOf, firstRerollCost, newRun)가 정하고,
 * 여기서는 무엇을 얼마에 여는지와 조각을 어떻게 받는지, 화면에 적는 글을 정한다.
 * 누구나 같은 조건으로 하는 오늘의 판에는 듣지 않는다(조각은 오늘의 판을 끝내도 받는다).
 * 화면과 저장소 어느 쪽에도 기대지 않는 순수 함수들이다.
 */
import {
  clearedRounds,
  holdsOf,
  PERK_IDS,
  PERK_PURSE,
  SLOTS_MAX,
  type PerkId,
  type RunState,
} from './rules';

/** 가진 조각과 열어 둔 해금. 허브 세이브의 slot(save.ts의 SlotSave)에 들어 있다. */
export interface PerkState {
  pieces: number;
  perks: readonly PerkId[];
}

/** 가질 수 있는 가장 많은 조각. 깨진 세이브가 터무니없는 수를 들고 오지 않게 막고, 화면에는 네 자리까지만 적는다. */
export const PIECES_MAX = 9999;

export interface PerkInfo {
  id: PerkId;
  name: string;
  /** 해금 창의 한 줄에 적는 설명. 좁은 줄에 들어가게 짧게 쓴다. */
  description: string;
  /** 여는 데 드는 조각 */
  price: number;
}

/** 하나, 둘을 세는 말("한 번", "두 번")과 차례를 세는 말("여섯째"). 규칙의 수가 바뀌어도 글이 맞게 수에서 만든다. */
const COUNT_WORDS = ['한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열'] as const;
const ORDER_WORDS = ['첫째', '둘째', '셋째', '넷째', '다섯째', '여섯째', '일곱째', '여덟째', '아홉째', '열째'] as const;

/** "두 번"처럼 세는 말. 열을 넘는 수는 숫자로 적는다. */
export function timesText(count: number): string {
  const word = COUNT_WORDS[count - 1];
  return word ? `${word} 번` : `${count}번`;
}

/** "여섯째"처럼 차례를 세는 말. 열을 넘는 수는 숫자로 적는다. */
export function orderText(count: number): string {
  return ORDER_WORDS[count - 1] ?? `${count}번째`;
}

/** 잠그기를 연 판에서 라운드마다 잠글 수 있는 횟수 */
const HOLDS_WITH_PERK = holdsOf({ perks: ['hold'] });

/**
 * 해금의 목록. 값은 조각을 받는 빠르기(piecesFor)에 맞췄다: 아무 부적이나 사는 사람이 한 판에 일곱 라운드쯤,
 * 잘 고르는 사람이 열 라운드쯤 넘기므로 한 판에 조각이 일곱에서 열 개쯤 들어온다. 그래서 첫 해금은 두 판쯤이면 열리고,
 * 넷을 다 열려면(모두 140개) 스무 판쯤 걸린다. 판을 가장 크게 바꾸는 것(여섯째 자리, 잠그기)을 비싸게 뒀다.
 * 차례는 PERK_IDS의 차례이고, 무엇부터 열지는 마음대로다.
 */
export const PERKS: readonly PerkInfo[] = [
  { id: 'purse', name: '두둑한 시작', description: `금화를 ${PERK_PURSE}개 더 들고 시작해요`, price: 15 },
  { id: 'reroll', name: '첫 뽑기 공짜', description: '가게마다 첫 다시 뽑기가 공짜예요', price: 25 },
  { id: 'hold', name: '잠그기 한 번 더', description: `라운드마다 열을 ${timesText(HOLDS_WITH_PERK)} 잠가요`, price: 40 },
  { id: 'slot', name: `${orderText(SLOTS_MAX)} 자리`, description: `부적을 ${SLOTS_MAX}장까지 붙여요`, price: 60 },
];

export function perkOf(id: PerkId): PerkInfo {
  const perk = PERKS.find((item) => item.id === id);
  if (!perk) throw new Error(`없는 해금: ${id}`);
  return perk;
}

// ───────── 조각 ─────────

/**
 * 끝난 판이 주는 조각: 넘긴 라운드마다 한 개. 멀리 갈수록 많이 받고, 첫 라운드도 못 넘긴 판은 받지 못한다.
 * 판마다 한 번, 끝났을 때만 준다(화면이 결과를 낼 때 부른다). 도중에 버리고 새로 시작한 판은 받지 못한다.
 * 오늘의 판도 똑같이 받는다.
 */
export function piecesFor(run: RunState): number {
  return Math.max(0, clearedRounds(run));
}

/** 조각을 더한 새 상태. 한도(PIECES_MAX)를 넘지 않고, 0보다 작거나 정수가 아닌 값은 더하지 않는다. */
export function addPieces(state: PerkState, amount: number): PerkState {
  if (!Number.isSafeInteger(amount) || amount <= 0) return state;
  const pieces = Math.min(PIECES_MAX, state.pieces + amount);
  return pieces === state.pieces ? state : { ...state, pieces };
}

// ───────── 열기 ─────────

/** 그 해금을 열어 두었는지 */
export function isUnlocked(state: PerkState, id: PerkId): boolean {
  return state.perks.includes(id);
}

/** 해금을 열 수 없는 까닭. 열 수 있으면 null. owned는 이미 연 것, pieces는 조각이 모자란 것이다. */
export type UnlockBlock = 'owned' | 'pieces';

export function unlockBlock(state: PerkState, id: PerkId): UnlockBlock | null {
  if (isUnlocked(state, id)) return 'owned';
  return state.pieces < perkOf(id).price ? 'pieces' : null;
}

export function canUnlock(state: PerkState, id: PerkId): boolean {
  return unlockBlock(state, id) === null;
}

/** 지금 가진 조각으로 열 수 있는 해금이 하나라도 있는지. 시작 화면의 버튼에 표시를 달 때 쓴다. */
export function canUnlockAny(state: PerkState): boolean {
  return PERK_IDS.some((id) => canUnlock(state, id));
}

/** 그 해금까지 모자란 조각. 이미 열었거나 넉넉하면 0이다. */
export function shortOf(state: PerkState, id: PerkId): number {
  return isUnlocked(state, id) ? 0 : Math.max(0, perkOf(id).price - state.pieces);
}

/**
 * 조각을 내고 해금을 연 새 상태를 돌려준다. 열 수 없으면(이미 열었거나 조각이 모자라면) 받은 것 그대로다.
 * 열어 둔 해금은 PERK_IDS의 차례로 적는다. 한 번 열면 다시 닫히지 않는다.
 */
export function unlock(state: PerkState, id: PerkId): PerkState {
  if (!canUnlock(state, id)) return state;
  return {
    ...state,
    pieces: state.pieces - perkOf(id).price,
    perks: PERK_IDS.filter((perk) => perk === id || state.perks.includes(perk)),
  };
}

/** 연 해금의 수 */
export function unlockedCount(state: PerkState): number {
  return PERK_IDS.filter((id) => state.perks.includes(id)).length;
}

// ───────── 화면에 적는 글 ─────────

export const PERK_TEXT = {
  /** 해금 창의 머리글 */
  title: '해금',
  close: '닫기',
  /** 조각의 이름. 결과 화면의 줄에 적는다. */
  piece: '행운 조각',
  /** 이미 연 해금의 줄에 값 대신 적는 글 */
  open: '열림',
  /** 창의 맨 아래에 늘 적어 두는 한 줄 */
  noDaily: '오늘의 판에는 듣지 않아요',
  /** 아무 줄도 누르지 않았을 때의 안내: 조각을 어떻게 받는지 */
  how: '판이 끝나면 넘긴 라운드만큼 조각을 받아요',
  /** 넷을 다 열었을 때의 안내 */
  all: '모두 열었어요!',
  /** 이미 연 줄을 눌렀을 때 */
  owned: '이미 열었어요',
} as const;

/** 시작 화면의 버튼에 적는 글: "해금 1/4" */
export function perkLabel(state: PerkState): string {
  return `해금 ${unlockedCount(state)}/${PERKS.length}`;
}

/** 해금 창에서 아무 줄도 누르지 않았을 때의 안내 */
export function perkHint(state: PerkState): string {
  return unlockedCount(state) >= PERKS.length ? PERK_TEXT.all : PERK_TEXT.how;
}

/** 방금 열었을 때 알리는 한 줄. 이름의 받침에 따라 토씨가 달라지지 않게 토씨 없이 적는다. */
export function unlockedNotice(id: PerkId): string {
  return `${perkOf(id).name} 열림!`;
}

/** 조각이 모자라서 열지 못했을 때 알리는 한 줄 */
export function shortNotice(state: PerkState, id: PerkId): string {
  return `조각이 ${shortOf(state, id)}개 모자라요`;
}

/** 결과 화면에 적는 한 줄의 값: 이번 판에 받은 조각과, 받은 뒤에 가진 조각. "+7 · 모두 32개" */
export function piecesVerdict(earned: number, total: number): string {
  return `+${earned} · 모두 ${total}개`;
}

/**
 * 시작 화면에 작게 적는 한 줄: 여느 판이면 켜져 있는 해금의 수, 오늘의 판이면 해금이 듣지 않는다는 것.
 * 열어 둔 해금이 없으면 적을 것이 없어서 null이다.
 */
export function activeNote(state: PerkState, daily: boolean): string | null {
  const count = unlockedCount(state);
  if (count === 0) return null;
  return daily ? '오늘의 판은 해금 없이 해요' : `해금 ${count}개가 켜져 있어요`;
}

/** 열을 잠그는 법을 알리는 글. 한 라운드에 total번 잠글 수 있고, 지금 left번 남았다. */
export function holdHowText(total: number, left: number): string {
  if (total > 1 && left < total) return `열을 누르면 ${timesText(left)} 더 잠글 수 있어요`;
  return `열을 누르면 ${timesText(Math.max(1, left))} 잠글 수 있어요`;
}

/** 잠그기를 다 썼을 때 알리는 글 */
export function holdUsedText(total: number): string {
  return `잠그기는 라운드마다 ${timesText(total)}이에요`;
}

/** 가게의 다시 뽑기 버튼에 적는 글. 공짜일 때는 값 대신 공짜라고 적는다. */
export function rerollLabel(cost: number): string {
  return cost === 0 ? '다시 뽑기 공짜' : '다시 뽑기';
}

/** 가게의 맨 아래에 적는 한 줄: 이 판에서 붙일 수 있는 부적의 수 */
export function slotsNote(slots: number): string {
  return `부적은 ${slots}장까지 붙일 수 있어요`;
}
