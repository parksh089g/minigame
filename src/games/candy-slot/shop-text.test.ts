import { describe, expect, it } from 'vitest';
import {
  CHARMS,
  discard,
  newRun,
  nextSpinTimes,
  refundOf,
  REROLL_COST,
  upgrade,
  targetFor,
  upgradeCostOf,
  upgradedOf,
  type Box,
  type RunState,
} from './rules';
import {
  BUBBLE_TEXT,
  bubbleKindOf,
  bubbleLayout,
  bubbleShop,
  CHIP,
  chipPlace,
  offerChip,
  PRIZE_CHIP_TEXT,
  prizeChip,
  SPIN_TEXT,
  spinLabel,
  timesText,
  SHOP_HINT,
  upgradableSlots,
  upgradeChip,
  upgradeMarks,
  type BubbleKind,
} from './shop-text';
import { affectsPrize, expectedRound } from './expected';

function shopping(coin: number, charms: string[]): RunState {
  return { ...newRun(), phase: 'shop', spinsLeft: 0, coin, charms, shop: { offers: [null, null, null], rerollCost: REROLL_COST } };
}

const ODDS = CHARMS.filter((charm) => charm.kind === 'odds');

/** 그 부적들에서 after로 바꾸면 미리 보기에 적혀야 하는 것: 한 라운드의 기댓값이 바뀌는 비율 */
function chipFor(before: readonly string[], after: readonly string[]): ReturnType<typeof prizeChip> {
  return prizeChip(expectedRound(before), expectedRound(after));
}

describe('벌이의 미리 보기', () => {
  it('오르면 +, 내리면 -를 붙여 바뀌는 비율을 적는다: 10%보다 작으면 소수 첫째 자리까지, 크면 정수로', () => {
    expect(prizeChip(10, 10.42)).toEqual({ text: '벌이 +4.2%', tone: 'good' });
    expect(prizeChip(10, 9.92)).toEqual({ text: '벌이 -0.8%', tone: 'bad' });
    expect(prizeChip(10, 14.7)).toEqual({ text: '벌이 +47%', tone: 'good' });
    expect(prizeChip(10, 8.8)).toEqual({ text: '벌이 -12%', tone: 'bad' });
    expect(prizeChip(4, 10)).toEqual({ text: '벌이 +150%', tone: 'good' });
    // 반올림해서 10.0%가 되는 것부터는 정수로 적는다.
    expect(prizeChip(100, 109.94).text).toBe('벌이 +9.9%');
    expect(prizeChip(100, 109.96).text).toBe('벌이 +10%');
  });

  it('반올림해서 0이 되는 차이는 +0.0%라고 적지 않고 그대로라고 적는다', () => {
    const same = { text: `${PRIZE_CHIP_TEXT.label} ${PRIZE_CHIP_TEXT.same}`, tone: 'same' };
    expect(prizeChip(10, 10)).toEqual(same);
    expect(prizeChip(10, 10.004)).toEqual(same);
    expect(prizeChip(10, 9.996)).toEqual(same);
    expect(prizeChip(0, 3)).toEqual(same);
    // 반올림해서 0.1%가 되는 것부터는 수로 적는다.
    expect(prizeChip(10, 10.006).text).toBe('벌이 +0.1%');
    expect(prizeChip(10, 9.994).text).toBe('벌이 -0.1%');
    for (let step = -40; step <= 40; step += 1) {
      const chip = prizeChip(20, 20 + step * 0.0013);
      expect(chip.text, String(step)).not.toMatch(/[+-]0\.0%/);
      expect(chip.tone === 'same', String(step)).toBe(chip.text.endsWith(PRIZE_CHIP_TEXT.same));
    }
  });

  it('저금통 말고는 모든 부적에 붙고, 적힌 수는 지금 붙인 부적과 견준 한 라운드의 기댓값의 차와 같다', () => {
    expect(offerChip([], 'piggy')).toBeNull();
    expect(offerChip(['wide', 'extra'], 'piggy')).toBeNull();
    expect(offerChip([], 'no-such-charm')).toBeNull();
    const owned: string[][] = [
      [],
      ...ODDS.map((charm) => [charm.id]),
      ODDS.slice(0, 4).map((charm) => upgradedOf(charm.id)),
      ['gold-bell+', 'tall', 'twins', 'finale', 'rebound'],
    ];
    for (const charms of owned) {
      for (const charm of CHARMS) {
        if (charm.id === 'piggy' || charms.some((id) => id.startsWith(charm.id))) continue;
        const chip = offerChip(charms, charm.id);
        expect(chip, `${charms.join(',')} + ${charm.id}`).toEqual(chipFor(charms, [...charms, charm.id]));
        expect(chip?.text).not.toMatch(/[+-]0\.0%/);
      }
    }
  });

  it('같은 부적도 무엇과 짝을 짓느냐에 따라 오르기도 내리기도 한다', () => {
    // 아무것도 없을 때 체리 듬뿍은 벌이를 올리지만, 7을 늘려 둔 판에서는 7을 덜 나오게 해서 벌이를 깎는다.
    expect(offerChip([], 'more-cherry')?.tone).toBe('good');
    const tones = new Set(
      [['more-seven+++'], ['more-diamond+++', 'gold-diamond+++'], ['more-bell++', 'gold-bell+++']].map(
        (charms) => offerChip(charms, 'more-cherry')?.tone,
      ),
    );
    expect(tones.has('bad')).toBe(true);
  });

  it('덤 스핀은 스핀이 느는 만큼 라운드의 벌이가 는다', () => {
    // 곱이 없으면 꼭 스핀의 수만큼이다: 6번에서 9번.
    expect(offerChip([], 'extra')?.text).toBe('벌이 +50%');
    expect(upgradeChip(['extra'], 0)?.text).toBe('벌이 +22%');
  });
});

describe('돌리기 버튼의 글', () => {
  it('걸린 곱이 없으면 여느 글이다', () => {
    expect(spinLabel({ skippable: false, holding: false, times: 1 })).toBe('돌리기');
    expect(spinLabel({ skippable: false, holding: true, times: 1 })).toBe('잠그고 돌리기');
  });

  it('다음 스핀에 곱이 걸려 있으면 뒤에 붙이고, 잠그고 돌릴 때도 붙인다', () => {
    expect(spinLabel({ skippable: false, holding: false, times: 4 })).toBe('돌리기 4배');
    expect(spinLabel({ skippable: false, holding: true, times: 12 })).toBe('잠그고 돌리기 12배');
    expect(timesText(3)).toBe('3배');
    expect(timesText(1.5)).toBe('1.5배');
  });

  it('돌고 있거나 결과를 보여 주는 중에는 곱이 걸려 있어도 건너뛰기다', () => {
    expect(spinLabel({ skippable: true, holding: false, times: 4 })).toBe(SPIN_TEXT.skip);
    expect(spinLabel({ skippable: true, holding: true, times: 1 })).toBe(SPIN_TEXT.skip);
  });

  it('규칙이 내는 곱을 그대로 적는다', () => {
    const run: RunState = { ...newRun(), charms: ['finale', 'rebound'], spinsLeft: 1, afterMiss: true };
    const times = nextSpinTimes(run);
    expect(times).toBeGreaterThan(1);
    expect(spinLabel({ skippable: false, holding: false, times })).toBe(`돌리기 ${times}배`);
    expect(spinLabel({ skippable: false, holding: false, times: nextSpinTimes({ ...run, spinsLeft: 3, afterMiss: false }) })).toBe(
      '돌리기',
    );
  });
});

/** 주아 글꼴에 들어 있는 한글: KS X 1001의 완성형 2,350자 */
function fontSyllables(): Set<string> {
  const decoder = new TextDecoder('euc-kr');
  const syllables = new Set<string>();
  for (let lead = 0xb0; lead <= 0xc8; lead += 1) {
    for (let trail = 0xa1; trail <= 0xfe; trail += 1) {
      syllables.add(decoder.decode(new Uint8Array([lead, trail])));
    }
  }
  return syllables;
}

describe('붙인 부적의 설명 창', () => {
  it('가게가 아니거나 빈자리면 더 적을 것이 없다', () => {
    expect(bubbleShop({ ...newRun(), charms: ['wide'] }, 0)).toBeNull();
    expect(bubbleShop(shopping(999, ['wide']), 1)).toBeNull();
    expect(bubbleKindOf(null)).toBe('plain');
  });

  it('강화할 수 있으면 강화하면 바뀌는 설명과 값을, 떼면 돌려받는 금화와 함께 낸다', () => {
    for (const charm of CHARMS) {
      const shop = bubbleShop(shopping(999, [charm.id]), 0);
      expect(shop?.refund, charm.id).toBe(refundOf(charm.id));
      expect(shop?.upgrade.state, charm.id).toBe('ready');
      expect(shop?.upgrade.lead).toBe(BUBBLE_TEXT.lead);
      expect(shop?.upgrade.description).toBe(charm.upgrades[0].description);
      expect(shop?.upgrade.cost).toBe(upgradeCostOf(charm.id));
      // 강화하면 벌이가 어떻게 바뀌는지도 낸다(저금통은 벌이로 셈할 수 없어 없다).
      expect(shop?.upgrade.chip !== null, charm.id).toBe(affectsPrize(charm.id));
      expect(shop?.upgrade.chip ?? null, charm.id).toEqual(affectsPrize(charm.id) ? chipFor([charm.id], [upgradedOf(charm.id)]) : null);
      expect(bubbleKindOf(shop ?? null)).toBe('upgrade');
    }
    const stacked = ['more-cherry', 'more-clover'];
    const chip = bubbleShop(shopping(999, stacked), 1)?.upgrade.chip;
    expect(chip).toEqual(chipFor(stacked, ['more-cherry', 'more-clover+']));
    expect(chip).toEqual(upgradeChip(stacked, 1));
  });

  it('금화가 모자라면 까닭을 적고 값과 설명은 그대로 보여 준다', () => {
    const cost = upgradeCostOf('twins');
    const shop = bubbleShop(shopping(cost - 1, ['twins']), 0);
    expect(shop?.upgrade).toEqual({
      state: 'poor',
      lead: '금화가 모자라요',
      description: CHARMS.find((charm) => charm.id === 'twins')?.upgrades[0].description,
      cost,
      chip: null,
      tight: false,
    });
    expect(bubbleShop(shopping(cost, ['twins']), 0)?.upgrade.state).toBe('ready');
  });

  it('강화하고 나면 다음 목표보다 적게 남을 때는 막지 않고 알리기만 한다', () => {
    const cost = upgradeCostOf('more-cherry');
    const next = targetFor(shopping(0, []), 2);
    // 목표만큼은 남는다: 여느 머리말이고, 미리 보기 표가 놓인다.
    const roomy = bubbleShop(shopping(cost + next, ['more-cherry']), 0)?.upgrade;
    expect(roomy).toMatchObject({ state: 'ready', lead: BUBBLE_TEXT.lead, tight: false });
    expect(roomy?.chip).not.toBeNull();
    // 하나라도 모자라게 남는다: 강화할 수는 있지만 머리말이 알리는 글로 바뀐다.
    const tight = bubbleShop(shopping(cost + next - 1, ['more-cherry']), 0)?.upgrade;
    expect(tight).toMatchObject({ state: 'ready', lead: '목표보다 적게 남아요', cost, chip: null, tight: true });
    // 낡은 저울로 목표가 낮아진 판에서는 낮아진 목표로 따진다.
    const relics = { scale: 10 };
    const late = { ...shopping(0, ['more-cherry']), round: 9, relics };
    const lowered = targetFor(late, 10);
    expect(lowered).toBeLessThan(targetFor(shopping(0, []), 10));
    expect(bubbleShop({ ...late, coin: cost + lowered }, 0)?.upgrade.tight).toBe(false);
    expect(bubbleShop({ ...late, coin: cost + lowered - 1 }, 0)?.upgrade.tight).toBe(true);
  });

  it('한 단계 강화한 부적은 다음 단계의 설명과 값을 내고, 돌려받는 금화는 강화한 값까지 친 것이다', () => {
    const before = shopping(9999, ['twins']);
    const once = upgrade(before, 0);
    const shop = bubbleShop(once, 0);
    const twins = CHARMS.find((charm) => charm.id === 'twins');
    expect(shop?.upgrade).toMatchObject({
      state: 'ready',
      lead: BUBBLE_TEXT.lead,
      description: twins?.upgrades[1].description,
      cost: upgradeCostOf('twins+'),
    });
    expect(shop?.upgrade.cost).toBeGreaterThan(upgradeCostOf('twins'));
    expect(shop?.refund).toBe(refundOf('twins+'));
    expect(shop?.refund).toBeGreaterThan(refundOf('twins'));
    expect(bubbleKindOf(shop ?? null)).toBe('upgrade');
    const twice = bubbleShop(upgrade(once, 0), 0);
    expect(twice?.upgrade).toMatchObject({ state: 'ready', description: twins?.upgrades[2].description, cost: upgradeCostOf('twins++') });
    // 단계마다 다음 단계의 벌이를 미리 보여 주고, 끝까지 강화한 부적에는 없다.
    const chip = bubbleShop(shopping(9999, ['more-cherry++']), 0)?.upgrade.chip;
    expect(chip).toEqual(chipFor(['more-cherry++'], ['more-cherry+++']));
    expect(bubbleShop(shopping(9999, ['twins++']), 0)?.upgrade.chip).toEqual(chipFor(['twins++'], ['twins+++']));
    expect(upgradeChip(['twins+++'], 0)).toBeNull();
    expect(upgradeChip(['twins'], 1)).toBeNull();
  });

  it('끝까지 강화한 부적은 그렇다고 적고, 이름 옆의 별은 강화한 단계만큼이다', () => {
    const before = shopping(9999, ['twins']);
    const after = upgrade(upgrade(upgrade(before, 0), 0), 0);
    expect(after.charms).toEqual(['twins+++']);
    const shop = bubbleShop(after, 0);
    expect(shop?.upgrade).toEqual({ state: 'done', lead: '끝까지 강화했어요', description: null, cost: null, chip: null, tight: false });
    expect(shop?.refund).toBe(refundOf('twins+++'));
    expect(shop?.refund).toBeGreaterThan(refundOf('twins++'));
    expect(bubbleKindOf(shop ?? null)).toBe('done');
    expect(upgradeMarks(after.charms[0])).toBe(3);
    expect(upgradeMarks('twins++')).toBe(2);
    expect(upgradeMarks('twins+')).toBe(1);
    expect(upgradeMarks(before.charms[0])).toBe(0);
    expect(upgradeMarks(undefined)).toBe(0);
    expect(upgradeMarks('no-such-charm+')).toBe(0);
    expect(upgradeMarks('twins++++')).toBe(0);
  });
});

describe('유물이 있는 판의 설명 창', () => {
  it('적힌 강화 값과 돌려받는 금화는 그 판에서 실제로 내고 받는 금화와 같다', () => {
    const relics = { hammer: 10, seal: 10 };
    let cheaper = 0;
    let richer = 0;
    for (const charm of CHARMS) {
      const run: RunState = { ...shopping(999, [charm.id]), relics };
      const shop = bubbleShop(run, 0);
      const cost = shop?.upgrade.cost ?? -1;
      expect(cost, charm.id).toBe(upgradeCostOf(charm.id, run));
      expect(shop?.refund, charm.id).toBe(refundOf(charm.id, run));
      // 강화하면 적힌 값만큼 줄고, 떼면 적힌 만큼 는다.
      const strong = upgrade(run, 0);
      expect(run.coin - strong.coin, charm.id).toBe(cost);
      expect(discard(run, 0).coin - run.coin, charm.id).toBe(shop?.refund);
      const after = bubbleShop(strong, 0);
      expect(after?.refund, charm.id).toBe(refundOf(strong.charms[0], strong));
      expect(discard(strong, 0).coin - strong.coin, charm.id).toBe(after?.refund);
      if (cost < upgradeCostOf(charm.id)) cheaper += 1;
      if ((shop?.refund ?? 0) > refundOf(charm.id)) richer += 1;
    }
    // 유물이 듣는 판이어야 이 점검에 뜻이 있다.
    expect(cheaper).toBeGreaterThan(0);
    expect(richer).toBeGreaterThan(0);
  });

  it('금화가 모자란지도 그 판의 값으로 따진다', () => {
    const relics = { hammer: 10 };
    const id = CHARMS.find((charm) => upgradeCostOf(charm.id, { relics }) < upgradeCostOf(charm.id))?.id;
    expect(id, '유물로 강화가 싸지는 부적이 있어야 한다').toBeDefined();
    if (!id) return;
    const cost = upgradeCostOf(id, { relics });
    // 유물이 없으면 모자랐을 금화로도 강화할 수 있다.
    expect(bubbleShop({ ...shopping(cost, [id]), relics }, 0)?.upgrade.state).toBe('ready');
    expect(bubbleShop(shopping(cost, [id]), 0)?.upgrade.state).toBe('poor');
    expect(bubbleShop({ ...shopping(cost - 1, [id]), relics }, 0)?.upgrade).toMatchObject({ state: 'poor', cost });
  });
});

describe('설명 창의 자리', () => {
  const WIDTH = 240;
  const SLOTS_TOP = 300;
  const KINDS: readonly BubbleKind[] = ['plain', 'upgrade', 'done'];
  const inside = (inner: Box, outer: Box): boolean =>
    inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
  const overlap = (a: Box, b: Box): boolean =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

  it('이름과 설명만 있는 창은 부적 줄 바로 위에 예전 그대로 놓인다', () => {
    const place = bubbleLayout('plain', SLOTS_TOP, WIDTH);
    expect(place.box).toEqual({ x: 16, y: SLOTS_TOP - 50, width: WIDTH - 32, height: 44 });
    expect(place.title).toEqual({ x: 26, y: place.box.y + 6 });
    expect(place.body).toEqual({ x: 26, y: place.box.y + 24 });
    expect(place.shop).toBeNull();
    expect(place.upgrade).toBeNull();
  });

  it('어떤 모양이든 아래쪽 끝은 같은 높이이고, 버튼은 창 안에 들며 글의 자리와 겹치지 않는다', () => {
    for (const kind of KINDS) {
      const place = bubbleLayout(kind, SLOTS_TOP, WIDTH);
      expect(place.box.y + place.box.height, kind).toBe(SLOTS_TOP - 6);
      expect(place.box.x + place.box.width, kind).toBe(WIDTH - place.box.x);
      const buttons = [place.shop?.remove, place.upgrade?.button].filter((box): box is Box => box != null);
      for (const button of buttons) {
        expect(inside(button, place.box), kind).toBe(true);
        expect(place.title.x + place.textWidth, kind).toBeLessThanOrEqual(button.x - 4);
      }
      // 글 한 줄의 상자(작은 글자는 높이 14)가 창의 아래쪽 테두리 안에 든다.
      const lines = [place.body, place.shop?.lead, place.upgrade?.body].filter((at): at is { x: number; y: number } => at != null);
      for (const line of lines) expect(line.y + 14, kind).toBeLessThanOrEqual(place.box.y + place.box.height - 2);
    }
  });

  it('강화 칸이 있는 창은 떼는 버튼과 강화 버튼이 위아래로 놓이고, 그 사이에 가름선이 지난다', () => {
    const place = bubbleLayout('upgrade', SLOTS_TOP, WIDTH);
    expect(place.shop).not.toBeNull();
    expect(place.upgrade).not.toBeNull();
    if (!place.shop || !place.upgrade) return;
    const { remove, lead, rule } = place.shop;
    expect(place.upgrade.button.y).toBeGreaterThanOrEqual(remove.y + remove.height);
    expect(rule).toBeGreaterThan(place.body.y);
    expect(rule).toBeLessThan(lead.y);
    expect(place.upgrade.body.y).toBeGreaterThan(lead.y);
  });

  it('강화한 뒤의 창은 떼는 버튼이 그 자리 그대로이고, 강화 버튼이 있던 자리에는 누를 것이 없다', () => {
    const before = bubbleLayout('upgrade', SLOTS_TOP, WIDTH);
    const after = bubbleLayout('done', SLOTS_TOP, WIDTH);
    expect(after.box).toEqual(before.box);
    expect(after.upgrade).toBeNull();
    expect(after.shop?.remove).toEqual(before.shop?.remove);
    if (!after.shop || !before.upgrade) throw new Error('가게의 창이 아니다');
    // 강화 버튼을 잇달아 누르던 손이 떼는 버튼에 닿지 않는다.
    expect(overlap(after.shop.remove, before.upgrade.button)).toBe(false);
    expect(after.shop.lead.y).toBeGreaterThan(after.shop.rule);
  });
});

describe('작은 표의 자리', () => {
  it('자리가 넉넉하면 글을 줄이지 않고 한쪽 끝에 붙인다', () => {
    const right = chipPlace(100, 200, 50, 60, 'right');
    expect(right.scale).toBe(1);
    expect(right.back).toEqual({ x: 200 - 60 - CHIP.padX * 2, y: 50 - CHIP.height / 2, width: 60 + CHIP.padX * 2, height: CHIP.height });
    expect(right.textX).toBe(right.back.x + CHIP.padX);
    const left = chipPlace(100, 200, 50, 60, 'left');
    expect(left.back.x).toBe(100);
    expect(left.textX).toBe(100 + CHIP.padX);
  });

  it('자리가 글보다 좁으면 글을 줄여서 두 끝 사이에 넣는다', () => {
    for (const align of ['left', 'right'] as const) {
      const place = chipPlace(113, 177, 50, 64, align);
      expect(place.scale).toBeLessThan(1);
      expect(place.back.x).toBeGreaterThanOrEqual(113 - 1e-9);
      expect(place.back.x + place.back.width).toBeLessThanOrEqual(177 + 1e-9);
      expect(place.textX + 64 * place.scale).toBeLessThanOrEqual(177 - CHIP.padX + 1e-9);
    }
  });
});

describe('가게의 안내', () => {
  it('지금 강화할 수 있는 자리는 금화가 닿고 끝까지 강화하지 않은 부적의 자리다', () => {
    const charms = ['wide', 'twins+', 'crown+++', 'rebound'];
    // 금화가 넉넉하면 끝까지 강화한 것만 빠진다.
    expect(upgradableSlots(shopping(99_999, charms))).toEqual([0, 1, 3]);
    // 가장 싼 강화 값만큼만 있으면 그 부적만 남는다.
    const costs = charms.map((id) => upgradeCostOf(id));
    const cheapest = Math.min(...costs.filter((cost) => cost > 0));
    expect(upgradableSlots(shopping(cheapest, charms))).toEqual([costs.indexOf(cheapest)]);
    expect(upgradableSlots(shopping(cheapest - 1, charms))).toEqual([]);
    // 돌리는 동안에는 없다.
    expect(upgradableSlots({ ...newRun(), coin: 99_999, charms })).toEqual([]);
    expect(upgradableSlots(shopping(99_999, []))).toEqual([]);
  });

  it('안내와 설명 창의 글은 글꼴에 들어 있는 한글만 쓴다', () => {
    const known = fontSyllables();
    expect(known.size).toBe(2350);
    for (const text of [SHOP_HINT, ...Object.values(BUBBLE_TEXT), ...Object.values(SPIN_TEXT), ...Object.values(PRIZE_CHIP_TEXT)]) {
      for (const letter of String(text).match(/[ㄱ-ㆎ가-힣]/g) ?? []) {
        expect(known.has(letter), `"${letter}" in "${text}"`).toBe(true);
      }
    }
    // 가게의 창 안에 한 줄로 들어가는 길이다.
    expect(SHOP_HINT.length).toBeLessThanOrEqual(18);
  });
});
