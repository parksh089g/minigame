/**
 * 행운 슬롯의 가게와 돌리기 버튼에 적는 글, 그리고 붙인 부적의 설명 창에 놓이는 것들의 자리.
 * 규칙(rules.ts)이 낸 값을 화면에 적을 글과 자리로 바꾸기만 하는 순수 함수들이라, 화면 없이도 따져 볼 수 있다.
 */
import { affectsPrize, expectedRound, type ExpectContext } from './expected';
import {
  charmOf,
  isMaxed,
  levelOf,
  refundOf,
  targetFor,
  upgradeBlock,
  upgradeCostOf,
  upgradedOf,
  type Box,
  type RunState,
} from './rules';

// ───────── 상금의 미리 보기 ─────────

/** 미리 보기 표의 빛깔: 오르면 good, 내리면 bad, 거의 그대로면 same */
export type ChipTone = 'good' | 'bad' | 'same';

export interface PreviewChip {
  text: string;
  tone: ChipTone;
}

/**
 * 미리 보기 표의 머리말과, 달라지는 것이 없을 때 적는 말.
 * 셈하는 것은 언제나 한 라운드에 받을 금화의 기댓값(expected.ts의 expectedRound)이 바뀌는 비율이다. 스핀의 수가 그대로인
 * 부적이면 스핀 한 번의 평균 상금이 바뀌는 비율과 같고, 덤 스핀처럼 스핀의 수를 바꾸는 부적도 같은 잣대로 견줄 수 있다.
 * 그래서 "평균 상금"이나 "라운드 상금"으로 나누지 않고, 라운드에 버는 금화라는 뜻의 "벌이" 하나로 적는다.
 * 가게의 좁은 줄에서 가장 긴 이름(대각선 세 배) 옆에도 글자를 줄이지 않고 들어가는 길이이기도 하다.
 */
export const PRIZE_CHIP_TEXT = { label: '벌이', same: '그대로' } as const;

/**
 * 기댓값이 before에서 after로 바뀔 때 작은 표에 적을 글.
 * 바뀌는 비율이 10%보다 작으면 소수 첫째 자리까지("+4.2%"), 그보다 크면 정수로("+47%") 적는다.
 * 그 자리까지 반올림해서 0이 되는 작은 차이는 "+0.0%"라고 적지 않고 그대로라고 적는다.
 */
export function prizeChip(before: number, after: number): PreviewChip {
  const { label, same } = PRIZE_CHIP_TEXT;
  const tenths = before > 0 ? Math.round((after / before - 1) * 1000) : NaN;
  if (tenths === 0 || !Number.isFinite(tenths)) return { text: `${label} ${same}`, tone: 'same' };
  const size = Math.abs(tenths) < 100 ? (Math.abs(tenths) / 10).toFixed(1) : String(Math.round(Math.abs(tenths) / 10));
  return { text: `${label} ${tenths > 0 ? '+' : '-'}${size}%`, tone: tenths > 0 ? 'good' : 'bad' };
}

/**
 * 부적을 before에서 after로 바꾸면 한 라운드에 받을 금화의 기댓값이 어떻게 바뀌는지. 저금통처럼 상금으로 셈할 수 없는
 * 부적(changed가 그런 것)이면 null이다. context는 라운드의 변화 같은 것을 셈에 넣을 때 준다.
 */
function changeChip(
  before: readonly string[],
  after: readonly string[],
  changed: string,
  context?: ExpectContext,
): PreviewChip | null {
  if (!affectsPrize(changed)) return null;
  return prizeChip(expectedRound(before, context), expectedRound(after, context));
}

/**
 * 가게의 부적 id를 사서 붙이면 상금의 기댓값이 어떻게 바뀌는지. 지금 붙인 부적과 함께 셈하므로, 같은 부적도 무엇과
 * 짝을 짓느냐에 따라 수가 다르다(서로 다른 그림을 함께 늘리면 도로 줄기도 한다). 셈할 수 없는 부적이면 null이다.
 */
export function offerChip(charms: readonly string[], id: string, context?: ExpectContext): PreviewChip | null {
  const charm = charmOf(id);
  if (!charm) return null;
  return changeChip(charms, [...charms, charm.id], charm.id, context);
}

/** 붙여 둔 slot번째 부적을 한 단계 강화하면 상금의 기댓값이 어떻게 바뀌는지. 셈할 수 없거나 강화할 수 없으면 null이다. */
export function upgradeChip(charms: readonly string[], slot: number, context?: ExpectContext): PreviewChip | null {
  const id = charms[slot];
  if (id === undefined || !charmOf(id) || isMaxed(id)) return null;
  const after = charms.map((charm, index) => (index === slot ? upgradedOf(charm) : charm));
  return changeChip(charms, after, id, context);
}

// ───────── 돌리기 버튼 ─────────

export const SPIN_TEXT = { spin: '돌리기', hold: '잠그고 돌리기', skip: '건너뛰기' } as const;

/** 곱을 적는 글. 곱해진 상금을 알리는 글("막판 한 방! 4배")과 같은 적기다. */
export function timesText(times: number): string {
  return `${Number.isInteger(times) ? times : times.toFixed(1)}배`;
}

export interface SpinLabelState {
  /** 돌고 있거나 결과를 보여 주는 중인지. 그동안 버튼은 건너뛰기다. */
  skippable: boolean;
  /** 잠글 열을 골라 두었는지 */
  holding: boolean;
  /** 다음 스핀의 상금에 미리 걸려 있는 곱(rules.ts의 nextSpinTimes). 걸린 것이 없으면 1이다. */
  times: number;
}

/** 돌리기 버튼에 적는 글. 다음 스핀에 곱이 걸려 있으면 "돌리기 4배"처럼 뒤에 붙인다. */
export function spinLabel({ skippable, holding, times }: SpinLabelState): string {
  if (skippable) return SPIN_TEXT.skip;
  const base = holding ? SPIN_TEXT.hold : SPIN_TEXT.spin;
  return times > 1 ? `${base} ${timesText(times)}` : base;
}

// ───────── 가게의 안내 ─────────

/** 붙인 부적이 있을 때 가게의 맨 아래에 적는 한 줄. 부적을 눌러야 강화와 떼기가 나온다는 것을 알린다. */
export const SHOP_HINT = '붙인 부적을 눌러 강화하거나 떼요';

/**
 * 지금 강화할 수 있는 자리들(금화가 닿고, 끝까지 강화하지 않은 부적). 가게에서 그 부적의 아래에 표시를 단다.
 * 가게가 아니면 비어 있다.
 */
export function upgradableSlots(run: RunState): number[] {
  return run.charms.flatMap((_, slot) => (upgradeBlock(run, slot) === null ? [slot] : []));
}

// ───────── 붙인 부적의 설명 창 ─────────

export const BUBBLE_TEXT = {
  remove: '떼기',
  upgrade: '강화',
  /** 강화하면 바뀌는 설명의 머리말 */
  lead: '강화하면',
  poor: '금화가 모자라요',
  /** 끝 단계까지 강화한 부적의 설명 창에 적는 글 */
  done: '끝까지 강화했어요',
  /** 강화할 수는 있지만, 하고 나면 가진 금화가 다음 라운드의 목표보다 적어질 때의 머리말 */
  tight: '목표보다 적게 남아요',
} as const;

/** 설명 창의 강화 칸 */
export interface UpgradeOffer {
  /** ready: 한 단계 더 강화할 수 있다. poor: 금화가 모자란다. done: 끝까지 강화했다. */
  state: 'ready' | 'poor' | 'done';
  /** 강화 칸의 첫 줄: 머리말이거나, 강화할 수 없는 까닭 */
  lead: string;
  /** 한 단계 더 강화하면 바뀌는 설명. 끝까지 강화했으면 null */
  description: string | null;
  /** 한 단계 더 강화하는 값. 끝까지 강화했으면 null */
  cost: number | null;
  /** 강화하면 상금의 기댓값이 어떻게 바뀌는지. 강화할 수 있고 상금으로 셈할 수 있는 부적에만 있다. */
  chip: PreviewChip | null;
  /**
   * 강화하고 나면 가진 금화가 다음 라운드의 목표보다 적어지는지. 강화는 값이 커서, 있는 금화를 다 쓰면
   * 다음 라운드를 넘기기 어려워진다. 막지는 않고 머리말로 알리기만 한다.
   */
  tight: boolean;
}

/** 가게에서 붙인 부적의 설명 창에 더 적는 것 */
export interface BubbleShop {
  /** 떼면 돌려받는 금화 */
  refund: number;
  upgrade: UpgradeOffer;
}

/**
 * 가게에서 slot번째 부적을 눌렀을 때 설명 창에 더 적을 것(돌려받는 금화와 강화 칸).
 * 가게가 아니거나 그 자리에 부적이 없으면 null이고, 그때는 이름과 설명만 보인다.
 * 돌려받는 금화와 강화하는 값은 그 판의 유물까지 넣어 셈해서, 적힌 수가 곧 실제로 오가는 수다.
 */
export function bubbleShop(run: RunState, slot: number): BubbleShop | null {
  const block = upgradeBlock(run, slot);
  if (block === 'closed' || block === 'none') return null;
  const id = run.charms[slot];
  const refund = refundOf(id, run);
  if (block === 'done') {
    return { refund, upgrade: { state: 'done', lead: BUBBLE_TEXT.done, description: null, cost: null, chip: null, tight: false } };
  }
  const description = charmOf(upgradedOf(id))?.description ?? '';
  const cost = upgradeCostOf(id, run);
  if (block === 'coin') {
    return { refund, upgrade: { state: 'poor', lead: BUBBLE_TEXT.poor, description, cost, chip: null, tight: false } };
  }
  // 가게가 열려 있는 동안 run.round는 방금 넘긴 라운드다. 다음에 낼 목표는 그다음 라운드의 것이다.
  if (run.coin - cost < targetFor(run, run.round + 1)) {
    // 알리는 글이 길어서 미리 보기 표는 놓지 않는다.
    return { refund, upgrade: { state: 'ready', lead: BUBBLE_TEXT.tight, description, cost, chip: null, tight: true } };
  }
  const chip = upgradeChip(run.charms, slot);
  return { refund, upgrade: { state: 'ready', lead: BUBBLE_TEXT.lead, description, cost, chip, tight: false } };
}

/** 강화한 단계(0~UPGRADE_MAX). 설명 창의 이름 옆에 그 수만큼 별을 놓을 때 쓴다. 없는 부적이면 0이다. */
export function upgradeMarks(id: string | undefined): number {
  return id !== undefined && charmOf(id) !== undefined ? levelOf(id) : 0;
}

/** 돌려받는 금화를 버튼에 적을 때 앞에 붙이는 표시. 값을 치르는 버튼(강화, 다시 뽑기)과 헷갈리지 않게 한다. */
export const REFUND_SIGN = '+';

/** 설명 창의 모양: 이름과 설명만(plain), 강화 칸까지(upgrade), 끝까지 강화한 부적(done) */
export type BubbleKind = 'plain' | 'upgrade' | 'done';

export function bubbleKindOf(shop: BubbleShop | null): BubbleKind {
  if (!shop) return 'plain';
  return shop.upgrade.state === 'done' ? 'done' : 'upgrade';
}

interface Point {
  x: number;
  y: number;
}

/** 설명 창에 놓이는 것들의 자리. 길이는 모두 논리 픽셀이다. */
export interface BubbleLayout {
  box: Box;
  /** 이름과 설명의 왼쪽 위 */
  title: Point;
  body: Point;
  /** 글이 쓸 수 있는 폭. 버튼이 있으면 그 왼쪽까지다. */
  textWidth: number;
  /** 가게에서만: 떼는 버튼, 강화 칸의 첫 줄(머리말이나 까닭)의 왼쪽 위, 강화 칸 위에 긋는 가름선의 높이 */
  shop: { remove: Box; lead: Point; rule: number } | null;
  /** 강화하면 바뀌는 설명의 왼쪽 위와 강화 버튼. 강화할 것이 없으면(가게가 아니거나 이미 강화했으면) null */
  upgrade: { body: Point; button: Box } | null;
}

/** 설명 창의 왼쪽 끝과 폭, 부적 줄과의 틈(꼬리가 들어가는 자리) */
const BUBBLE = { x: 16, gap: 6, pad: 10 } as const;
/** 설명 창 안의 버튼: 폭과 높이, 창의 오른쪽 끝과의 틈, 글과의 틈 */
const BUBBLE_BUTTON = { width: 70, height: 28, inset: 8, gap: 6 } as const;
/** 설명 창의 높이: 이름과 설명만 있을 때와, 가게에서 강화 칸까지 있을 때 */
const BUBBLE_HEIGHT = { plain: 44, shop: 74 } as const;

/**
 * 설명 창의 자리. slotsTop은 부적 줄의 위쪽 끝이고, 창은 그 바로 위에 뜬다(아래쪽 끝이 늘 같은 높이다).
 * screenWidth는 화면의 논리 폭이다.
 *
 * 이미 강화한 부적의 창(done)도 크기와 떼는 버튼의 자리는 강화 칸이 있는 창(upgrade)과 같고, 강화 버튼만 없다.
 * 강화하면 창이 그 자리에서 done으로 바뀌는데, 강화 버튼을 잇달아 누르던 손이 떼는 버튼에 닿지 않게 하려는 것이다.
 */
export function bubbleLayout(kind: BubbleKind, slotsTop: number, screenWidth: number): BubbleLayout {
  const height = kind === 'plain' ? BUBBLE_HEIGHT.plain : BUBBLE_HEIGHT.shop;
  const box: Box = { x: BUBBLE.x, y: slotsTop - BUBBLE.gap - height, width: screenWidth - BUBBLE.x * 2, height };
  const left = box.x + BUBBLE.pad;
  const title = { x: left, y: box.y + 6 };
  if (kind === 'plain') {
    return { box, title, body: { x: left, y: box.y + 24 }, textWidth: box.width - BUBBLE.pad * 2, shop: null, upgrade: null };
  }
  const buttonLeft = box.x + box.width - BUBBLE_BUTTON.inset - BUBBLE_BUTTON.width;
  const button = (y: number): Box => ({ x: buttonLeft, y, width: BUBBLE_BUTTON.width, height: BUBBLE_BUTTON.height });
  const shared = { box, title, body: { x: left, y: box.y + 23 }, textWidth: buttonLeft - BUBBLE_BUTTON.gap - left };
  const remove = button(box.y + 7);
  const rule = box.y + 38.5;
  if (kind === 'done') {
    // 까닭 한 줄만 남으므로 강화 칸의 가운데 높이에 놓는다.
    return { ...shared, shop: { remove, lead: { x: left, y: box.y + 48 }, rule }, upgrade: null };
  }
  return {
    ...shared,
    shop: { remove, lead: { x: left, y: box.y + 41 }, rule },
    upgrade: { body: { x: left, y: box.y + 54 }, button: button(box.y + 40) },
  };
}

// ───────── 작은 표의 자리 ─────────

/** 작은 표의 높이와, 글의 양옆에 두는 여백 */
export const CHIP = { height: 14, padX: 3 } as const;

export interface ChipPlace {
  /** 자리가 좁으면 글을 이만큼 줄인다(1이면 그대로). */
  scale: number;
  /** 글의 왼쪽 끝 */
  textX: number;
  /** 글 뒤에 까는 둥근 바탕 */
  back: Box;
}

/**
 * left와 right 사이에 작은 표를 놓는다. middle은 표의 한가운데 높이, textWidth는 줄이지 않은 글의 폭이다.
 * align이 right면 오른쪽 끝에, left면 왼쪽 끝에 붙인다. 자리가 글보다 좁으면 글을 줄여서 밖으로 나가지 않게 한다.
 */
export function chipPlace(
  left: number,
  right: number,
  middle: number,
  textWidth: number,
  align: 'left' | 'right',
): ChipPlace {
  const room = Math.max(1, right - left - CHIP.padX * 2);
  const scale = Math.min(1, room / Math.max(1, textWidth));
  const width = textWidth * scale + CHIP.padX * 2;
  const x = align === 'right' ? right - width : left;
  return {
    scale,
    textX: x + CHIP.padX,
    back: { x, y: middle - CHIP.height / 2, width, height: CHIP.height },
  };
}
