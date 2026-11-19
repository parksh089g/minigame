/**
 * 행운 슬롯의 부적 강화와 가게의 미리 보기 화면 점검: 가게에서 붙인 부적을 눌러 강화하면 금화를 내고 별이 붙는지,
 * 세 단계까지 한 단계씩 오르는지, 지금 강화할 수 있는 부적에 표시가 달리는지,
 * 강화할 수 없을 때 까닭을 알리는지, 떼면 금화를 돌려받는지(유물이 있는 판에서도 적힌 수와 오가는 수가 같은지),
 * 가게의 부적과 강화 칸에 상금의 기댓값이 어떻게 바뀌는지 미리 보기가 붙는지,
 * 다음 스핀에 걸린 곱이 돌리기 버튼에 적히는지, 강화한 부적을 든 판을 이어 하고 도감과 결과 화면을 열어도 탈이 없는지 본다.
 * 값과 글은 규칙(rules.ts)과 글 모듈(shop-text.ts)에서 읽어 견주므로, 부적의 값이나 힘을 고쳐도 이 점검은 그대로 맞는다.
 * 점검마다 저장이 비어 있는 새 브라우저에서 시작한다.
 */
import './app-globals';
import { expect, type Page } from '@playwright/test';
import { SCENE, THEME_CSS } from '../src/config';
import { collectionLabel, COLLECTION_TEXT } from '../src/games/candy-slot/collection';
import {
  CELLS,
  charmOf,
  CHARMS,
  discard,
  HOLDS_PER_ROUND,
  levelOf,
  nextRound,
  nextSpinTimes,
  refundOf,
  REROLL_COST,
  SIZE,
  spin,
  targetFor,
  UPGRADE_MAX,
  upgrade,
  upgradeCostOf,
  upgradedOf,
  type CharmInfo,
  type RunState,
} from '../src/games/candy-slot/rules';
import { RESUME_TEXT, type SlotSave } from '../src/games/candy-slot/save';
import {
  BUBBLE_TEXT,
  bubbleShop,
  offerChip,
  PRIZE_CHIP_TEXT,
  SHOP_HINT,
  SPIN_TEXT,
  upgradableSlots,
  upgradeChip,
  type PreviewChip,
} from '../src/games/candy-slot/shop-text';
import { hiddenTexts, it, openApp, startScene, tapAt, tapText, textPoint, textsOutsideCards, waitForScene } from './app';

const KEY = SCENE.candySlot;
const WAIT = { timeout: 15_000 };
/** 붙인 부적의 그림 이름 앞머리(art.ts의 charmTexture)와 결과 화면의 작은 그림 이름 앞머리 */
const CHARM_TEXTURE = 'candy-slot-charm-';
const CHIP_TEXTURE = 'candy-slot-chip-';

/** 장면에서 이 점검이 들여다보는 것. 화면에서는 감춰 둔 것(private)도 페이지 안에서는 그대로 부를 수 있다. */
interface SlotView {
  run: RunState;
  busy: boolean;
  layout: {
    cell: number;
    gridLeft: number;
    gridTop: number;
    slotSize: number;
    slots: Array<{ x: number; y: number }>;
    goal: { x: number; y: number; width: number; height: number };
  };
  time: { now: number };
  shopGuardUntil: number;
  holdCol: number | null;
  reel: { elapsed: number } | null;
  slotImages: Array<{ texture: { key: string } }>;
  readyMarks: Array<{ visible: boolean }>;
  openShop(): void;
  refreshShop(): void;
  refreshNumbers(): void;
  refreshSlots(): void;
  refreshOdds(bounce: boolean): void;
  trySpin(): void;
  finishEarly(): void;
}

function runOf(page: Page): Promise<RunState> {
  return page.evaluate((key) => (window.__pocketArcade?.scene.getScene(key) as unknown as SlotView).run, KEY);
}

function mustCharm(id: string): CharmInfo {
  const charm = charmOf(id);
  if (!charm) throw new Error(`없는 부적: ${id}`);
  return charm;
}

/** 가게가 열린 판. 규칙으로 나올 수 있는 값만 써서, 저장했다 읽어도 버려지지 않는다. */
function shopRun(coin: number, charms: readonly string[], offers: readonly string[]): RunState {
  return {
    phase: 'shop',
    round: 1,
    spinsLeft: 0,
    coin,
    earned: 120,
    charms: [...charms],
    shop: { offers: [...offers], rerollCost: REROLL_COST },
    afterMiss: false,
    bestSpin: 20,
    lastGrid: [0, 1, 2, 3, 4, 5, 1, 2, 0],
    holdsLeft: HOLDS_PER_ROUND,
    seed: null,
    spinCount: 6,
    drawCount: 1,
    perks: [],
    relics: {},
  };
}

/** 하던 판을 바꿔 놓고 가게를 연 뒤, 가게가 막 열렸을 때의 누름 막기가 풀릴 때까지 기다린다. */
async function openShopWith(page: Page, run: RunState): Promise<void> {
  await page.evaluate(
    ([key, next]) => {
      const scene = window.__pocketArcade?.scene.getScene(key) as unknown as SlotView;
      scene.run = next;
      scene.refreshSlots();
      scene.refreshOdds(false);
      scene.openShop();
    },
    [KEY, run] as const,
  );
  await expect.poll(() => textPoint(page, KEY, '부적 가게'), WAIT).not.toBeNull();
  await page.waitForFunction(
    (key) => {
      const scene = window.__pocketArcade?.scene.getScene(key) as unknown as SlotView;
      return scene.time.now >= scene.shopGuardUntil;
    },
    KEY,
    WAIT,
  );
}

/** 열려 있는 가게의 판을 바꿔 놓고 가게의 줄을 다시 그린다(가게를 다시 열지는 않는다). */
function showShopRun(page: Page, run: RunState): Promise<void> {
  return page.evaluate(
    ([key, next]) => {
      const scene = window.__pocketArcade?.scene.getScene(key) as unknown as SlotView;
      scene.run = next;
      scene.refreshNumbers();
      scene.refreshSlots();
      scene.refreshOdds(false);
      scene.refreshShop();
    },
    [KEY, run] as const,
  );
}

/** 붙인 부적의 줄에서 index번째 자리를 누른다. */
async function tapSlot(page: Page, index: number): Promise<void> {
  const point = await page.evaluate(
    ([key, at]) => {
      const { layout } = window.__pocketArcade?.scene.getScene(key) as unknown as SlotView;
      const slot = layout.slots[at];
      return { x: slot.x + layout.slotSize / 2, y: slot.y + layout.slotSize / 2 };
    },
    [KEY, index] as const,
  );
  await tapAt(page, point.x, point.y);
}

/** 떠 있는 설명 창을 닫는다: 누를 것이 없는 목표 카드의 한가운데를 누른다. */
async function closeBubble(page: Page): Promise<void> {
  const goal = await page.evaluate(
    (key) => (window.__pocketArcade?.scene.getScene(key) as unknown as SlotView).layout.goal,
    KEY,
  );
  await tapAt(page, goal.x + goal.width / 2, goal.y + goal.height / 2);
  await expect.poll(() => bubbleTexts(page), { ...WAIT, message: '설명 창이 닫혀야 한다' }).toEqual([]);
}

/** 붙인 부적의 줄에 놓인 그림의 이름들 */
function slotTextures(page: Page): Promise<string[]> {
  return page.evaluate(
    (key) => (window.__pocketArcade?.scene.getScene(key) as unknown as SlotView).slotImages.map((image) => image.texture.key),
    KEY,
  );
}

/** 지금 강화할 수 있다는 표시가 달린 자리들 */
function readySlots(page: Page): Promise<number[]> {
  return page.evaluate(
    (key) =>
      (window.__pocketArcade?.scene.getScene(key) as unknown as SlotView).readyMarks.flatMap((mark, slot) => (mark.visible ? [slot] : [])),
    KEY,
  );
}

/**
 * 가게에서 slot번째 부적을 눌렀을 때 설명 창에 적혀야 하는 글들(가나다순). 강화 칸의 글과 값은 shop-text.ts가 정한 대로다.
 * 강화 칸의 미리 보기 표(벌이)는 bubbleTexts가 빼고 모으므로 여기에도 넣지 않는다.
 */
function offerTexts(run: RunState, slot: number): string[] {
  const charm = mustCharm(run.charms[slot]);
  const shop = bubbleShop(run, slot);
  if (!shop) throw new Error('가게가 열린 판이 아니다');
  const offer = shop.upgrade;
  const step = offer.description !== null && offer.cost !== null ? [offer.description, BUBBLE_TEXT.upgrade, String(offer.cost)] : [];
  return [charm.name, charm.description, BUBBLE_TEXT.remove, `+${shop.refund}`, offer.lead, ...step].sort();
}

/**
 * 지금 보이는 글자들 가운데 pick이 고른 것. 글과 빛깔, 높이를 위에서부터 차례로 돌려준다.
 * bubble은 설명 창의 글에서 미리 보기 표를 뺀 것이고, bubbleChips는 설명 창의 미리 보기 표, chips는 가게의 미리 보기 표다.
 */
function shownTexts(
  page: Page,
  kind: 'bubble' | 'bubbleChips' | 'chips' | 'empty' | 'odds',
): Promise<Array<{ text: string; color: string }>> {
  return page.evaluate(
    ([key, what, chipLabels]) => {
      const scene = window.__pocketArcade?.scene.getScene(key);
      const texts = (scene?.children.list ?? []).filter(
        (item): item is Phaser.GameObjects.Text => item.type === 'Text' && (item as Phaser.GameObjects.Text).visible,
      );
      // 설명 창은 이 게임에서 층이 38인 것들이다(가게는 34, 알림 글자는 40).
      const picked = texts.filter((text) => {
        if (what === 'empty') return text.text.trim() === '';
        if (text.text.trim() === '' || text.alpha <= 0) return false;
        const chip = chipLabels.some((label) => text.text.startsWith(`${label} `));
        if (what === 'bubble') return text.depth === 38 && !chip;
        if (what === 'bubbleChips') return text.depth === 38 && chip;
        if (what === 'chips') return chip && text.depth === 34;
        return /^\d+%$/.test(text.text);
      });
      return picked
        .sort((a, b) => a.getBounds().centerY - b.getBounds().centerY || a.x - b.x)
        .map((text) => ({ text: text.text, color: String(text.style.color) }));
    },
    [KEY, kind, [PRIZE_CHIP_TEXT.label]] as const,
  );
}

/** 떠 있는 설명 창에 적힌 글들(가나다순). 창이 없으면 비어 있다. */
async function bubbleTexts(page: Page): Promise<string[]> {
  return (await shownTexts(page, 'bubble')).map((item) => item.text).sort();
}

/** 미리 보기 표에 적혀야 하는 글과 빛깔 */
function chipLook(chip: PreviewChip | null): { text: string; color: string } {
  if (!chip) throw new Error('미리 보기가 없는 부적이다');
  const colors = { good: THEME_CSS.good, bad: THEME_CSS.bad, same: THEME_CSS.sub };
  return { text: chip.text, color: colors[chip.tone] };
}

/** 기기(IndexedDB)에 저장된 허브 세이브에서 행운 슬롯의 몫을 읽는다. 아직 저장된 것이 없으면 null. */
function storedSlot(page: Page): Promise<SlotSave | null> {
  return page.evaluate(
    () =>
      new Promise<SlotSave | null>((resolve) => {
        const opening = indexedDB.open('pocket-arcade');
        opening.onerror = () => resolve(null);
        opening.onsuccess = () => {
          const db = opening.result;
          if (!db.objectStoreNames.contains('kv')) {
            db.close();
            resolve(null);
            return;
          }
          const request = db.transaction('kv', 'readonly').objectStore('kv').get('save');
          request.onerror = () => {
            db.close();
            resolve(null);
          };
          request.onsuccess = () => {
            const save = request.result as { slot?: SlotSave } | undefined;
            db.close();
            resolve(save?.slot ?? null);
          };
        };
      }),
  );
}

/** 목표 카드에 적히는 글. 가게에서는 다음 라운드의 목표가 적힌다. */
function goalLabel(run: RunState): string {
  return `${run.coin} / ${targetFor(run, run.phase === 'shop' ? run.round + 1 : run.round)}`;
}

it('행운 슬롯: 가게에서 붙인 부적을 세 단계까지 강화하면 금화를 내고 별이 늘며, 강화한 설명이 보이고 판이 저장된다', async ({ page }) => {
  it.slow();
  await openApp(page);
  await startScene(page, KEY);
  const charm = mustCharm('wide');
  const start = shopRun(9000, [charm.id, 'twins'], ['tall', 'slant', 'crown']);
  await openShopWith(page, start);
  expect(await slotTextures(page), '강화하기 전의 부적 그림').toContain(`${CHARM_TEXTURE}${charm.id}`);
  // 금화가 넉넉하니 붙인 부적 두 장에 모두 강화할 수 있다는 표시가 달린다.
  expect(upgradableSlots(start)).toEqual([0, 1]);
  await expect.poll(() => readySlots(page), { ...WAIT, message: '강화할 수 있는 부적의 표시' }).toEqual([0, 1]);
  // 가게의 맨 아래에는 붙인 부적을 눌러 강화하거나 떼라는 한 줄이 적힌다.
  expect(await textPoint(page, KEY, SHOP_HINT), '부적을 눌러 보라는 안내').not.toBeNull();

  // 붙인 부적을 누르면 떼는 버튼(돌려받는 금화)과 강화 칸(강화하면 바뀌는 설명, 값, 버튼)이 뜬다.
  await tapSlot(page, 0);
  await expect.poll(() => textPoint(page, KEY, BUBBLE_TEXT.upgrade), WAIT).not.toBeNull();
  expect(await bubbleTexts(page), '강화할 수 있는 부적의 설명 창').toEqual(
    [
      charm.name,
      charm.description,
      BUBBLE_TEXT.remove,
      `+${refundOf(charm.id, start)}`,
      BUBBLE_TEXT.lead,
      charm.upgrades[0].description,
      BUBBLE_TEXT.upgrade,
      String(upgradeCostOf(charm.id, start)),
    ].sort(),
  );
  expect(await hiddenTexts(page, KEY, { from: BUBBLE_TEXT.remove }), '강화 칸이 있는 설명 창').toEqual([]);

  // 강화하면 금화가 줄고, 부적의 그림에 별이 붙고, 설명 창은 강화한 설명과 다음 단계의 강화 칸으로 바뀐다.
  let run = upgrade(start, 0);
  expect(run.coin, '강화할 수 있는 판이어야 한다').toBe(start.coin - upgradeCostOf(charm.id, start));
  await tapText(page, KEY, BUBBLE_TEXT.upgrade);
  await expect.poll(() => runOf(page), { ...WAIT, message: '한 단계 강화한 판' }).toEqual(run);
  expect((await slotTextures(page))[0], '강화한 부적은 별이 붙은 그림으로 바뀐다').toBe(`${CHARM_TEXTURE}${upgradedOf(charm.id)}`);
  await expect.poll(() => bubbleTexts(page), { ...WAIT, message: '한 단계 강화한 부적의 설명 창' }).toEqual(offerTexts(run, 0));
  expect(await bubbleTexts(page), '다음 단계의 설명이 적힌다').toContain(charm.upgrades[1].description);
  expect(await bubbleTexts(page), '다음 단계의 값이 적힌다').toContain(String(upgradeCostOf(run.charms[0], run)));
  expect(upgradeCostOf(run.charms[0], run), '단계가 오르면 더 비싸다').toBeGreaterThan(upgradeCostOf(charm.id, start));
  await expect.poll(() => textPoint(page, KEY, goalLabel(run)), { ...WAIT, message: '금화의 수가 줄어야 한다' }).not.toBeNull();
  await expect
    .poll(() => hiddenTexts(page, KEY, { from: BUBBLE_TEXT.remove }), { ...WAIT, message: '강화한 뒤의 설명 창' })
    .toEqual([]);

  // 두 번 더 강화하면 끝 단계가 된다. 단계마다 그림의 별이 늘고, 설명 창은 그 단계의 것으로 바뀐다.
  for (let level = 2; level <= UPGRADE_MAX; level += 1) {
    const next = upgrade(run, 0);
    expect(levelOf(next.charms[0]), '한 단계 더 강화할 수 있는 판이어야 한다').toBe(level);
    await tapText(page, KEY, BUBBLE_TEXT.upgrade);
    await expect.poll(() => runOf(page), { ...WAIT, message: `${level}단계로 강화한 판` }).toEqual(next);
    run = next;
    expect((await slotTextures(page))[0], `${level}단계의 부적 그림`).toBe(`${CHARM_TEXTURE}${run.charms[0]}`);
    await expect.poll(() => bubbleTexts(page), { ...WAIT, message: `${level}단계로 강화한 부적의 설명 창` }).toEqual(offerTexts(run, 0));
  }
  const after = run;
  const strong = mustCharm(after.charms[0]);
  expect(strong.description).toBe(charm.upgrades[UPGRADE_MAX - 1].description);
  // 끝까지 강화한 부적에는 강화 버튼이 없고, 표시도 달리지 않는다.
  expect(await bubbleTexts(page), '끝까지 강화한 부적의 설명 창').toEqual(
    [strong.name, strong.description, BUBBLE_TEXT.remove, `+${refundOf(strong.id, after)}`, BUBBLE_TEXT.done].sort(),
  );
  expect(upgrade(after, 0), '끝까지 강화한 부적은 더 강화되지 않는다').toBe(after);
  await expect.poll(() => readySlots(page), { ...WAIT, message: '끝까지 강화한 부적에는 표시가 없다' }).toEqual([1]);
  await expect
    .poll(() => hiddenTexts(page, KEY, { from: BUBBLE_TEXT.remove }), { ...WAIT, message: '끝까지 강화한 설명 창' })
    .toEqual([]);
  await expect
    .poll(async () => (await storedSlot(page))?.run?.run, { ...WAIT, message: '강화한 판이 기기에 저장되어야 한다' })
    .toEqual(after);

  // 설명 창을 닫아도 가게와 부적 줄에 가려진 글이 없다.
  await closeBubble(page);
  await expect.poll(() => hiddenTexts(page, KEY), { ...WAIT, message: '강화한 뒤의 가게' }).toEqual([]);

  // 다음 라운드로 넘어가도 별은 그대로이고, 돌리는 동안에는 설명만 보이며(강화도 떼기도 없다) 표시도 사라진다.
  await tapText(page, KEY, '다음 라운드');
  await expect.poll(() => runOf(page), { ...WAIT, message: '다음 라운드' }).toEqual(nextRound(after));
  expect((await slotTextures(page))[0], '돌리는 화면의 부적 그림').toBe(`${CHARM_TEXTURE}${strong.id}`);
  expect(await readySlots(page), '돌리는 동안에는 표시가 없다').toEqual([]);
  await tapSlot(page, 0);
  await expect.poll(() => bubbleTexts(page), { ...WAIT, message: '돌리는 동안의 설명 창' }).toEqual([strong.name, strong.description].sort());
  await expect.poll(() => hiddenTexts(page, KEY), { ...WAIT, message: '돌리는 화면' }).toEqual([]);
});

it('행운 슬롯: 금화가 모자라거나 끝까지 강화한 부적은 강화되지 않고, 까닭이 한 줄로 적힌다', async ({ page }) => {
  await openApp(page);
  await startScene(page, KEY);
  const charm = mustCharm('twins');
  const done = mustCharm(`crown${'+'.repeat(UPGRADE_MAX)}`);
  const cost = upgradeCostOf(charm.id, shopRun(0, [], []));
  const poor = shopRun(cost - 1, [charm.id, done.id], ['tall', 'slant', 'wide']);
  await openShopWith(page, poor);
  // 강화할 수 있는 부적이 없으니 표시도 없다.
  expect(await readySlots(page), '강화할 수 없으면 표시가 없다').toEqual([]);

  // 금화가 모자라면 강화하면 바뀌는 설명과 값은 보이지만, 버튼을 눌러도 강화되지 않는다.
  await tapSlot(page, 0);
  await expect.poll(() => textPoint(page, KEY, BUBBLE_TEXT.poor), WAIT).not.toBeNull();
  expect(await bubbleTexts(page), '금화가 모자란 부적의 설명 창').toEqual(
    [
      charm.name,
      charm.description,
      BUBBLE_TEXT.remove,
      `+${refundOf(charm.id, poor)}`,
      BUBBLE_TEXT.poor,
      charm.upgrades[0].description,
      BUBBLE_TEXT.upgrade,
      String(cost),
    ].sort(),
  );
  expect(await hiddenTexts(page, KEY, { from: BUBBLE_TEXT.remove }), '금화가 모자란 설명 창').toEqual([]);
  await tapText(page, KEY, BUBBLE_TEXT.upgrade);

  // 끝까지 강화한 부적에는 강화 버튼이 없다. 여기까지 와도 판은 그대로다.
  await tapSlot(page, 1);
  await expect.poll(() => textPoint(page, KEY, BUBBLE_TEXT.done), WAIT).not.toBeNull();
  expect(await bubbleTexts(page), '끝까지 강화한 부적의 설명 창').toEqual(
    [done.name, done.description, BUBBLE_TEXT.remove, `+${refundOf(done.id, poor)}`, BUBBLE_TEXT.done].sort(),
  );
  expect(await hiddenTexts(page, KEY, { from: BUBBLE_TEXT.remove }), '끝까지 강화한 설명 창').toEqual([]);
  expect(await runOf(page), '강화할 수 없으면 판은 그대로다').toEqual(poor);

  // 금화가 꼭 값만큼 있으면 강화된다.
  const enough = { ...poor, coin: cost };
  await closeBubble(page);
  await showShopRun(page, enough);
  await expect.poll(() => readySlots(page), { ...WAIT, message: '금화가 닿으면 표시가 달린다' }).toEqual([0]);
  await tapSlot(page, 0);
  await tapText(page, KEY, BUBBLE_TEXT.upgrade);
  await expect.poll(() => runOf(page), { ...WAIT, message: '값만큼 있으면 강화된다' }).toEqual(upgrade(enough, 0));
  expect((await runOf(page)).coin).toBe(0);
});

it('행운 슬롯: 붙인 부적을 떼면 버튼에 적힌 만큼 금화를 돌려받는다', async ({ page }) => {
  await openApp(page);
  await startScene(page, KEY);
  const strong = mustCharm(upgradedOf('twins'));
  const start = shopRun(3, [strong.id, 'wide'], ['tall', 'slant', 'crown']);
  const refund = refundOf(strong.id, start);
  expect(refund, '돌려받는 금화가 있는 부적이어야 한다').toBeGreaterThan(0);
  await openShopWith(page, start);

  await tapSlot(page, 0);
  await expect.poll(() => textPoint(page, KEY, BUBBLE_TEXT.remove), WAIT).not.toBeNull();
  expect(await bubbleTexts(page), '떼는 버튼에 돌려받는 금화가 적힌다').toContain(`+${refund}`);
  await tapText(page, KEY, BUBBLE_TEXT.remove);

  const after = discard(start, 0);
  expect(after.coin).toBe(start.coin + refund);
  await expect.poll(() => runOf(page), { ...WAIT, message: '뗀 판' }).toEqual(after);
  await expect.poll(() => textPoint(page, KEY, goalLabel(after)), { ...WAIT, message: '금화의 수가 늘어야 한다' }).not.toBeNull();
  expect(await bubbleTexts(page), '떼면 설명 창이 닫힌다').toEqual([]);
  expect((await slotTextures(page))[0], '남은 부적이 앞으로 당겨진다').toBe(`${CHARM_TEXTURE}wide`);
  await expect
    .poll(async () => (await storedSlot(page))?.run?.run, { ...WAIT, message: '뗀 판이 기기에 저장되어야 한다' })
    .toEqual(after);
  await expect.poll(() => hiddenTexts(page, KEY), { ...WAIT, message: '뗀 뒤의 가게' }).toEqual([]);
});

it('행운 슬롯: 강화하고 나면 다음 목표보다 적게 남을 때는 그렇다고 알리고, 그래도 강화는 된다', async ({ page }) => {
  await openApp(page);
  await startScene(page, KEY);
  const charm = mustCharm('more-cherry');
  const cost = upgradeCostOf(charm.id, shopRun(0, [], []));
  // 강화하면 다음 라운드의 목표보다 금화 한 개가 적게 남는 판
  const base = shopRun(0, [charm.id, 'wide'], ['tall', 'slant', 'crown']);
  const start = { ...base, coin: cost + targetFor(base, base.round + 1) - 1 };
  await openShopWith(page, start);
  await tapSlot(page, 0);
  await expect.poll(() => textPoint(page, KEY, BUBBLE_TEXT.tight), WAIT).not.toBeNull();
  expect(await bubbleTexts(page), '목표보다 적게 남는다고 알리는 설명 창').toEqual(
    [
      charm.name,
      charm.description,
      BUBBLE_TEXT.remove,
      `+${refundOf(charm.id, start)}`,
      BUBBLE_TEXT.tight,
      charm.upgrades[0].description,
      BUBBLE_TEXT.upgrade,
      String(cost),
    ].sort(),
  );
  expect(await hiddenTexts(page, KEY, { from: BUBBLE_TEXT.remove }), '알리는 글이 있는 설명 창').toEqual([]);

  // 막지는 않는다: 누르면 강화된다.
  await tapText(page, KEY, BUBBLE_TEXT.upgrade);
  await expect.poll(() => runOf(page), { ...WAIT, message: '강화한 판' }).toEqual(upgrade(start, 0));
});

it('행운 슬롯: 유물이 있는 판에서도 버튼에 적힌 강화 값과 돌려받는 금화가 실제로 오가는 금화와 같다', async ({ page }) => {
  await openApp(page);
  await startScene(page, KEY);
  // 대장장이 망치(강화가 싸진다)와 상인의 도장(돌려받는 몫이 는다)을 끝까지 올린 판
  const charm = mustCharm('twins');
  const start: RunState = { ...shopRun(600, [charm.id, 'wide'], ['tall', 'slant', 'crown']), relics: { hammer: 10, seal: 10 } };
  const cost = upgradeCostOf(charm.id, start);
  const refund = refundOf(charm.id, start);
  expect(cost, '유물로 강화가 싸지는 판이어야 한다').toBeLessThan(upgradeCostOf(charm.id));
  expect(refund, '유물로 돌려받는 금화가 느는 판이어야 한다').toBeGreaterThan(refundOf(charm.id));
  await openShopWith(page, start);

  // 버튼에는 유물까지 넣어 셈한 수가 적힌다.
  await tapSlot(page, 0);
  await expect.poll(() => textPoint(page, KEY, BUBBLE_TEXT.upgrade), WAIT).not.toBeNull();
  expect(await bubbleTexts(page), '유물이 있는 판의 설명 창').toEqual(
    [
      charm.name,
      charm.description,
      BUBBLE_TEXT.remove,
      `+${refund}`,
      BUBBLE_TEXT.lead,
      charm.upgrades[0].description,
      BUBBLE_TEXT.upgrade,
      String(cost),
    ].sort(),
  );

  // 강화하면 적힌 값만큼만 금화가 준다.
  await tapText(page, KEY, BUBBLE_TEXT.upgrade);
  const strong = upgrade(start, 0);
  await expect.poll(() => runOf(page), { ...WAIT, message: '강화한 판' }).toEqual(strong);
  expect((await runOf(page)).coin, '적힌 값만큼 낸다').toBe(start.coin - cost);

  // 강화한 부적의 떼는 버튼에는 강화하는 값까지 친 금화가 적히고, 떼면 그만큼 돌아온다.
  const back = refundOf(strong.charms[0], strong);
  expect(back).toBeGreaterThan(refund);
  await expect
    .poll(() => bubbleTexts(page), { ...WAIT, message: '강화한 뒤의 설명 창' })
    .toEqual(offerTexts(strong, 0));
  expect(await bubbleTexts(page), '떼는 버튼에 강화한 값까지 친 금화가 적힌다').toContain(`+${back}`);
  await tapText(page, KEY, BUBBLE_TEXT.remove);
  await expect.poll(() => runOf(page), { ...WAIT, message: '뗀 판' }).toEqual(discard(strong, 0));
  expect((await runOf(page)).coin, '적힌 만큼 돌려받는다').toBe(strong.coin + back);
  await expect.poll(() => textPoint(page, KEY, goalLabel(discard(strong, 0))), { ...WAIT, message: '금화의 수' }).not.toBeNull();
});

/** 지금 보이는 미리 보기 표의 글자 크기 배율(가게의 표와 설명 창의 표). 1보다 작으면 가장 작은 글자 크기보다 작게 줄인 것이다. */
function chipScales(page: Page): Promise<number[]> {
  return page.evaluate(
    ([key, label]) => {
      const scene = window.__pocketArcade?.scene.getScene(key);
      return (scene?.children.list ?? [])
        .filter((item): item is Phaser.GameObjects.Text => item.type === 'Text' && (item as Phaser.GameObjects.Text).visible)
        .filter((text) => text.text.startsWith(`${label} `))
        .map((text) => Math.min(text.scaleX, text.scaleY));
    },
    [KEY, PRIZE_CHIP_TEXT.label] as const,
  );
}

it('행운 슬롯: 가게의 부적에는 사면 벌이(한 라운드의 기댓값)가 어떻게 바뀌는지가 적힌다', async ({ page }) => {
  it.slow();
  await openApp(page);
  await startScene(page, KEY);
  const owned = ['more-cherry'];
  // 저금통은 벌이로 셈할 수 없어 표가 붙지 않는다.
  const offers = ['more-clover', 'piggy', 'slant'];
  const start = shopRun(60, owned, offers);
  await openShopWith(page, start);

  // 표가 붙는 두 줄에 적힌 수와 빛깔은 규칙으로 셈한 것과 같다.
  expect(await shownTexts(page, 'chips'), '가게의 미리 보기').toEqual([
    chipLook(offerChip(owned, offers[0])),
    chipLook(offerChip(owned, offers[2])),
  ]);
  expect(await hiddenTexts(page, KEY, { from: '부적 가게' }), '미리 보기가 붙은 가게').toEqual([]);
  expect(await textsOutsideCards(page, KEY, '부적 가게'), '미리 보기가 붙은 가게의 줄').toEqual([]);
  expect(await shownTexts(page, 'empty'), '빈 글자는 감춰 둔다').toEqual([]);

  // 한 장을 사면 남은 줄의 수가 새로 붙인 부적까지 넣어 다시 셈해지고, 팔린 줄의 표는 사라진다.
  await tapText(page, KEY, mustCharm(offers[0]).name);
  const bought = [...owned, offers[0]];
  await expect.poll(async () => (await runOf(page)).charms, { ...WAIT, message: '산 부적이 붙어야 한다' }).toEqual(bought);
  expect(await shownTexts(page, 'chips'), '사고 난 뒤의 미리 보기').toEqual([chipLook(offerChip(bought, offers[2]))]);
  expect(await shownTexts(page, 'empty'), '팔린 줄의 빈 글자도 감춰 둔다').toEqual([]);

  // 부적을 모두, 부적이 없을 때와 다른 부적을 강화해 겹쳐 둔 때에 올려 본다. 이름이나 값을 가리거나 줄 밖으로 넘치지 않고,
  // 이름이 가장 긴 부적 옆에서도 글자를 줄이지 않는다.
  const ids = CHARMS.map((charm) => charm.id);
  for (let first = 0; first < ids.length; first += 3) {
    const group = ids.slice(first, first + 3);
    const stack = ids.filter((id) => !group.includes(id) && id !== 'piggy').slice(first % 7, (first % 7) + 4).map(upgradedOf);
    for (const charms of [[], stack]) {
      await showShopRun(page, shopRun(60, charms, group));
      const where = `${charms.join(',')}에 ${group.join(',')}`;
      const chips = await shownTexts(page, 'chips');
      expect(chips, where).toEqual(group.flatMap((id) => (offerChip(charms, id) ? [chipLook(offerChip(charms, id))] : [])));
      for (const chip of chips) expect(chip.text).not.toMatch(/[+-]0\.0%/);
      expect(await chipScales(page), `${where}: 줄이지 않은 글자`).toEqual(chips.map(() => 1));
      expect(await hiddenTexts(page, KEY, { from: '부적 가게' }), `${where}가 나온 가게`).toEqual([]);
      expect(await textsOutsideCards(page, KEY, '부적 가게'), `${where}가 나온 가게의 줄`).toEqual([]);
    }
  }
});

it('행운 슬롯: 붙인 부적의 강화 칸에는 강화하면 벌이가 어떻게 바뀌는지가 적힌다', async ({ page }) => {
  it.slow();
  await openApp(page);
  await startScene(page, KEY);
  // 덤 스핀, 확률, 줄, 상금 부적과 저금통. 강화 칸의 머리말 옆 좁은 자리에 들어가는지 본다.
  const charms = ['extra', 'more-seven+', 'slant', 'gold-diamond++', 'piggy'];
  const run = shopRun(99_999, charms, ['tall', 'crown', 'wide']);
  await openShopWith(page, run);
  for (let slot = 0; slot < charms.length; slot += 1) {
    await tapSlot(page, slot);
    await expect.poll(() => textPoint(page, KEY, BUBBLE_TEXT.upgrade), WAIT).not.toBeNull();
    const chip = upgradeChip(charms, slot);
    const expected = chip ? [chipLook(chip)] : [];
    await expect.poll(() => shownTexts(page, 'bubbleChips'), { ...WAIT, message: `${charms[slot]}의 강화 칸` }).toEqual(expected);
    expect(await bubbleTexts(page), `${charms[slot]}의 설명 창`).toEqual(offerTexts(run, slot));
    expect(await chipScales(page), `${charms[slot]}: 줄이지 않은 글자`).toEqual([...expected, ...(await shownTexts(page, 'chips'))].map(() => 1));
    expect(await hiddenTexts(page, KEY, { from: BUBBLE_TEXT.remove }), `${charms[slot]}의 설명 창`).toEqual([]);
    await closeBubble(page);
  }
});

// ───────── 돌리기 버튼의 곱 ─────────

/** 한 칸의 그림을 정하는 난수: 가장 흔한 그림만 나오는 값. 아홉 칸이 모두 같아서 여덟 줄이 다 맞는다. */
const ALL_SAME: readonly number[] = Array.from({ length: CELLS }, () => 0.001);

/** 정해 둔 수를 차례로 내주는 난수. 다 쓰면 0.5를 준다. */
function queued(values: readonly number[]): () => number {
  let at = 0;
  return () => (at < values.length ? values[at++] : 0.5);
}

/** 그 난수들로 돌렸을 때 규칙이 내는 판 */
function ruled(run: RunState, values: readonly number[]): RunState {
  const result = spin(run, queued(values));
  if (!result) throw new Error('돌릴 수 없는 판이다');
  return result.run;
}

/** 한 줄도 맞지 않는 판이 나오는 난수들을 찾는다. 씨앗이 정해져 있어서 언제나 같은 것을 찾는다. */
function missValues(run: RunState): number[] {
  let state = 12345;
  const next = (): number => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return state / 4294967296;
  };
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const values = Array.from({ length: CELLS }, next);
    if (ruled(run, values).afterMiss) return values;
  }
  throw new Error('꽝이 나오는 난수를 찾지 못했다');
}

/**
 * 난수를 잠깐 바꿔 놓고 한 번 돌린다. skip이면 그 자리에서 건너뛰고(돌리기 버튼을 곧바로 한 번 더 누른 것과 같다),
 * freeze면 열들이 저절로 멈추지 않게 도는 시간을 멀찍이 뒤로 돌려 둔다(건너뛰어야만 끝난다).
 */
function spinWith(page: Page, values: readonly number[], then: 'skip' | 'freeze'): Promise<void> {
  return page.evaluate(
    ([key, list, next]) => {
      const scene = window.__pocketArcade?.scene.getScene(key) as unknown as SlotView;
      const real = Math.random;
      let at = 0;
      Math.random = () => (at < list.length ? list[at++] : real());
      try {
        scene.trySpin();
      } finally {
        Math.random = real;
      }
      if (next === 'freeze' && scene.reel) scene.reel.elapsed = -600_000;
      if (next === 'skip') scene.trySpin();
    },
    [KEY, values, then] as const,
  );
}

/** 기계의 한 열(0부터)의 가운데 칸을 누른다. */
async function tapColumn(page: Page, col: number): Promise<void> {
  const layout = await page.evaluate(
    (key) => (window.__pocketArcade?.scene.getScene(key) as unknown as SlotView).layout,
    KEY,
  );
  await tapAt(page, layout.gridLeft + (col + 0.5) * layout.cell, layout.gridTop + (SIZE / 2) * layout.cell);
}

function holdColOf(page: Page): Promise<number | null> {
  return page.evaluate((key) => (window.__pocketArcade?.scene.getScene(key) as unknown as SlotView).holdCol, KEY);
}

/** 돌리기 버튼에 꼭 이 글이 적혀 있는지: 이 글은 보이고, 버튼에 적힐 수 있는 다른 글은 보이지 않아야 한다. */
async function expectSpinLabel(page: Page, label: string, others: readonly string[], message: string): Promise<void> {
  expect(await textPoint(page, KEY, label), `${message}: 버튼에 "${label}"가 적혀야 한다`).not.toBeNull();
  for (const other of others) {
    if (other !== label) expect(await textPoint(page, KEY, other), `${message}: "${other}"는 보이지 않아야 한다`).toBeNull();
  }
}

it('행운 슬롯: 다음 스핀에 걸린 곱이 돌리기 버튼에 적히고, 걸린 것이 없으면 여느 글로 돌아간다', async ({ page }) => {
  it.slow();
  await openApp(page);
  await startScene(page, KEY);

  // 오뚝이(꽝 다음 스핀)와 막판 한 방(마지막 스핀)을 붙이고 스핀을 네 번 남긴다.
  const start = await page.evaluate(
    ([key, charms]) => {
      const scene = window.__pocketArcade?.scene.getScene(key) as unknown as SlotView;
      scene.run = { ...scene.run, charms: [...charms], spinsLeft: 4 };
      scene.refreshNumbers();
      scene.refreshSlots();
      scene.refreshOdds(false);
      return scene.run;
    },
    [KEY, ['rebound', 'finale']] as const,
  );
  const miss = missValues(start);
  const afterMiss = ruled(start, miss);
  const afterWin = ruled(afterMiss, ALL_SAME);
  const lastSpin = ruled(afterWin, miss);
  const rebound = nextSpinTimes(afterMiss);
  const both = nextSpinTimes(lastSpin);
  expect(nextSpinTimes(start), '처음에는 걸린 곱이 없다').toBe(1);
  expect(rebound, '꽝 다음 스핀에는 오뚝이의 곱이 걸린다').toBeGreaterThan(1);
  expect(nextSpinTimes(afterWin), '맞은 다음 스핀에는 걸린 곱이 없다').toBe(1);
  expect(both, '꽝 다음의 마지막 스핀에는 두 곱이 함께 걸린다').toBeGreaterThan(rebound);
  const labels = [
    SPIN_TEXT.spin,
    SPIN_TEXT.hold,
    SPIN_TEXT.skip,
    `${SPIN_TEXT.spin} ${rebound}배`,
    `${SPIN_TEXT.hold} ${rebound}배`,
    `${SPIN_TEXT.spin} ${both}배`,
  ];
  await expectSpinLabel(page, SPIN_TEXT.spin, labels, '걸린 곱이 없을 때');

  // 꽝이 나오면 다음 스핀의 곱이 버튼에 적힌다. 열을 잠가도 곱은 그대로 적혀 있다.
  await spinWith(page, miss, 'skip');
  expect(await runOf(page), '꽝이 나온 판').toEqual(afterMiss);
  await expectSpinLabel(page, `${SPIN_TEXT.spin} ${rebound}배`, labels, '꽝 다음');
  await expect.poll(() => hiddenTexts(page, KEY), { ...WAIT, message: '곱이 적힌 화면' }).toEqual([]);
  await tapColumn(page, 0);
  await expect.poll(() => holdColOf(page), { ...WAIT, message: '누른 열이 골라져야 한다' }).toBe(0);
  await expectSpinLabel(page, `${SPIN_TEXT.hold} ${rebound}배`, labels, '열을 잠갔을 때');
  expect(await hiddenTexts(page, KEY), '잠그고 돌리기에 곱이 적힌 화면').toEqual([]);
  await tapColumn(page, 0);
  await expect.poll(() => holdColOf(page), { ...WAIT, message: '다시 누르면 풀려야 한다' }).toBeNull();
  await expectSpinLabel(page, `${SPIN_TEXT.spin} ${rebound}배`, labels, '잠근 열을 풀었을 때');

  // 도는 동안에는 곱이 걸려 있어도 건너뛰기이고, 맞고 나면 걸린 곱이 없어서 여느 글로 돌아간다.
  await spinWith(page, ALL_SAME, 'freeze');
  await expectSpinLabel(page, SPIN_TEXT.skip, labels, '도는 동안');
  await tapText(page, KEY, SPIN_TEXT.skip);
  await expect.poll(() => runOf(page), { ...WAIT, message: '맞은 판' }).toEqual(afterWin);
  await expectSpinLabel(page, SPIN_TEXT.spin, labels, '맞은 다음');

  // 꽝 다음의 마지막 스핀에는 두 곱을 곱한 값이 적힌다.
  await spinWith(page, miss, 'skip');
  expect(await runOf(page), '마지막 스핀을 남긴 판').toEqual(lastSpin);
  await expectSpinLabel(page, `${SPIN_TEXT.spin} ${both}배`, labels, '꽝 다음의 마지막 스핀');
  await expect.poll(() => hiddenTexts(page, KEY), { ...WAIT, message: '두 곱이 적힌 화면' }).toEqual([]);
});

it('행운 슬롯: 강화한 부적을 든 판을 다시 열어 이어 하고, 도감과 결과 화면을 열어도 탈이 없다', async ({ page }) => {
  it.slow();
  await openApp(page);
  await startScene(page, KEY);
  // 갈래마다 한 장씩 저마다 다른 단계로 강화해 두고, 재주 부적 한 장은 가게에서 강화한다.
  const strong = ['more-cherry+', 'gold-bell++', 'slant+++', 'extra+'];
  for (const id of strong) mustCharm(id);
  const last = mustCharm('finale');
  const start = shopRun(900, [...strong, last.id], ['tall', 'wide', 'twins']);
  await openShopWith(page, start);
  await tapSlot(page, start.charms.length - 1);
  await tapText(page, KEY, BUBBLE_TEXT.upgrade);
  const after = upgrade(start, start.charms.length - 1);
  await expect.poll(() => runOf(page), { ...WAIT, message: '강화한 판' }).toEqual(after);
  const textures = after.charms.map((id) => `${CHARM_TEXTURE}${id}`);
  expect(await slotTextures(page), '다섯 장 모두 별이 붙은 그림').toEqual(textures);

  // 강화한 부적은 도감에 원래 부적으로 실린다.
  const found = [last.id];
  await expect
    .poll(() => storedSlot(page), { ...WAIT, message: '강화한 판과 도감이 기기에 저장되어야 한다' })
    .toEqual(expect.objectContaining({ found, run: expect.objectContaining({ run: after }) }));
  await expect.poll(() => textPoint(page, KEY, collectionLabel(found)), WAIT).not.toBeNull();

  // 다시 열어 이어 하면 강화한 부적이 그대로 붙어 있고, 확률 줄의 퍼센트를 더하면 100이다.
  await openApp(page);
  await startScene(page, KEY);
  await tapText(page, KEY, RESUME_TEXT.resume);
  await expect.poll(() => runOf(page), { ...WAIT, message: '두고 간 판이 그대로 이어져야 한다' }).toEqual(after);
  await expect.poll(() => textPoint(page, KEY, '부적 가게'), WAIT).not.toBeNull();
  expect(await slotTextures(page), '이어 한 판의 부적 그림').toEqual(textures);
  const percents = (await shownTexts(page, 'odds')).map((item) => Number.parseInt(item.text, 10));
  expect(percents.reduce((sum, value) => sum + value, 0), '확률 줄의 퍼센트의 합').toBe(100);
  await expect.poll(() => hiddenTexts(page, KEY), { ...WAIT, message: '이어 한 가게' }).toEqual([]);

  // 도감에는 별이 붙지 않은 원래 그림이 놓인다.
  await tapText(page, KEY, collectionLabel(found));
  await expect.poll(() => textPoint(page, KEY, COLLECTION_TEXT.title), WAIT).not.toBeNull();
  const tiles = await page.evaluate(
    ([key, prefix]) => {
      const scene = window.__pocketArcade?.scene.getScene(key);
      const images = (scene?.children.list ?? []).filter((item) => item.type === 'Image') as Phaser.GameObjects.Image[];
      // 도감의 창은 이 게임의 모든 것 위(층 50)에 놓인다.
      return images.filter((image) => image.depth === 50 && image.texture.key.startsWith(prefix)).map((image) => image.texture.key);
    },
    [KEY, CHARM_TEXTURE] as const,
  );
  expect(tiles, '도감의 칸 수').toHaveLength(CHARMS.length);
  expect(tiles, '찾은 부적은 원래 그림으로 실린다').toContain(`${CHARM_TEXTURE}${last.id}`);
  expect(tiles.filter((key) => key.endsWith('+')), '도감에는 강화한 그림이 없다').toEqual([]);
  await tapText(page, KEY, COLLECTION_TEXT.close);
  await expect.poll(() => textPoint(page, KEY, COLLECTION_TEXT.title), WAIT).toBeNull();

  // 판을 끝내면 결과 화면의 붙인 부적 줄에 강화한 부적이 별과 함께 놓인다.
  await page.evaluate((key) => (window.__pocketArcade?.scene.getScene(key) as unknown as SlotView).finishEarly(), KEY);
  await waitForScene(page, SCENE.result);
  const chips = await page.evaluate(
    ([key, prefix]) => {
      const scene = window.__pocketArcade?.scene.getScene(key);
      const all = (list: Phaser.GameObjects.GameObject[]): Phaser.GameObjects.GameObject[] =>
        list.flatMap((item) => (item.type === 'Container' ? all((item as Phaser.GameObjects.Container).list) : [item]));
      return all(scene?.children.list ?? [])
        .filter((item) => item.type === 'Image')
        .map((item) => (item as Phaser.GameObjects.Image).texture.key)
        .filter((name) => name.startsWith(prefix));
    },
    [SCENE.result, CHIP_TEXTURE] as const,
  );
  expect(chips.sort(), '결과 화면의 붙인 부적').toEqual(after.charms.map((id) => `${CHIP_TEXTURE}${id}`).sort());
});
