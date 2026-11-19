/**
 * 행운 슬롯의 부적 세트 화면 점검: 가게의 카드에 세트의 표가 달리고, 가게의 세트 줄에 모은 정도("체리 세트 2/3")가
 * 보이고, 세트를 다 모으면 덤을 알리며, 붙인 부적의 설명 창에 세트의 한 줄이 붙는지, 그 글들이 가리거나 화면 밖으로
 * 나가지 않는지 본다. 적는 글은 sets.ts에서 읽어 견주므로, 세트의 덤을 고쳐도 이 점검은 그대로 맞는다.
 * 점검마다 저장이 비어 있는 새 브라우저에서 시작한다.
 */
import './app-globals';
import { expect, type Page } from '@playwright/test';
import { SCENE } from '../src/config';
import { HOLDS_PER_ROUND, REROLL_COST, valuesOf, type RunState } from '../src/games/candy-slot/rules';
import {
  CHARM_SETS,
  SET_TEXT,
  setCheerText,
  setNoteOf,
  setProgressText,
  setProgressOf,
  newSetBonuses,
} from '../src/games/candy-slot/sets';
import { hiddenTexts, it, openApp, startScene, tapAt, tapText, textPoint } from './app';

const KEY = SCENE.candySlot;
const WAIT = { timeout: 15_000 };
const SHOT = '/tmp/claude-0/-home-user/cd3ba1c3-dcd8-57f3-b0e5-b7e054e7c1e1/scratchpad/slot-sets.png';

/** 장면에서 이 점검이 들여다보는 것. 화면에서는 감춰 둔 것(private)도 페이지 안에서는 그대로 부를 수 있다. */
interface SlotView {
  run: RunState;
  layout: { slotSize: number; slots: Array<{ x: number; y: number }> };
  time: { now: number };
  shopGuardUntil: number;
  oddsTexts: Array<{ value: { text: string } }>;
  openShop(): void;
  refreshNumbers(): void;
  refreshSlots(): void;
  refreshOdds(bounce: boolean): void;
}

/** 가게가 열린 판. 규칙으로 나올 수 있는 값만 쓴다. */
function shopRun(coin: number, charms: readonly string[], offers: readonly string[]): RunState {
  return {
    phase: 'shop',
    round: 2,
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
    spinCount: 12,
    drawCount: 2,
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

function runOf(page: Page): Promise<RunState> {
  return page.evaluate((key) => (window.__pocketArcade?.scene.getScene(key) as unknown as SlotView).run, KEY);
}

async function shown(page: Page, text: string): Promise<boolean> {
  return (await textPoint(page, KEY, text)) !== null;
}

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

const cherry = CHARM_SETS.find((set) => set.id === 'cherry');
const seven = CHARM_SETS.find((set) => set.id === 'seven');

it('행운 슬롯: 가게에 세트의 표와 모은 정도가 보이고, 다 모으면 덤을 알리고 설명 창에도 적힌다', async ({ page }, info) => {
  if (!cherry || !seven) throw new Error('없는 세트');
  await openApp(page);
  await startScene(page, KEY);

  // 아직 모은 세트가 없는 가게: 세트를 모으라는 안내가 적히고, 세트에 드는 부적의 카드에는 세트의 표가 달린다.
  await openShopWith(page, shopRun(40, ['wide'], ['twins', 'more-seven', 'crown']));
  expect(await shown(page, SET_TEXT.teach), '세트를 모으라는 안내').toBe(true);
  expect(await shown(page, cherry.tag), '쌍둥이 줄의 카드에 체리 세트의 표').toBe(true);
  expect(await shown(page, seven.tag), '7 듬뿍의 카드에 7 세트의 표').toBe(true);
  expect(await hiddenTexts(page, KEY), '모은 세트가 없는 가게').toEqual([]);
  // 가게를 닫는다(다시 열 때 앞의 가게가 남지 않게).
  await tapText(page, KEY, '다음 라운드');
  await expect.poll(async () => (await runOf(page)).phase, WAIT).toBe('spin');

  // 체리 세트를 두 장 붙인 가게: 모은 정도가 적힌다.
  const owned = ['more-cherry', 'gold-cherry', 'wide'];
  await openShopWith(page, shopRun(40, owned, ['twins', 'more-seven', 'crown']));
  const progress = setProgressOf(owned).find((item) => item.set.id === 'cherry');
  if (!progress) throw new Error('체리 세트를 모으지 않았다');
  expect(setProgressText(progress)).toBe('체리 세트 2/3');
  await expect.poll(() => shown(page, setProgressText(progress)), { ...WAIT, message: '체리 세트 2/3' }).toBe(true);
  expect(await shown(page, SET_TEXT.teach), '모은 세트가 있으면 안내 대신 모은 정도').toBe(false);
  // 앞의 가게를 닫을 때 뜬 라운드 알림이 걷힌 뒤에 잰다.
  await expect.poll(() => hiddenTexts(page, KEY), { ...WAIT, message: '체리 세트를 모으는 가게' }).toEqual([]);

  // 셋째 장을 사면 세트를 다 모았다고 알리고, 모은 정도와 상금이 바뀐다.
  const after = [...owned, 'twins'];
  const [bonus] = newSetBonuses(owned, after);
  expect(bonus?.set.id).toBe('cherry');
  await tapText(page, KEY, '쌍둥이 줄');
  await expect.poll(async () => (await runOf(page)).charms, WAIT).toEqual(after);
  // 덤이 새로 들었다는 알림은 세트 줄에 잠깐 뜨고(가게의 다른 글을 가리지 않는다), 걷히면 모은 정도로 돌아간다.
  await expect.poll(() => shown(page, setCheerText(bonus)), { ...WAIT, message: '세트의 덤을 알린다' }).toBe(true);
  expect(await hiddenTexts(page, KEY), '덤을 알리는 가게').toEqual([]);
  await expect.poll(() => shown(page, '체리 세트 3/3'), { ...WAIT, message: '다 모았다' }).toBe(true);
  const cherryValue = await page.evaluate(
    (key) => (window.__pocketArcade?.scene.getScene(key) as unknown as SlotView).oddsTexts[0].value.text,
    KEY,
  );
  expect(cherryValue, '상금 줄에 세트의 덤까지 든 체리의 상금').toBe(String(valuesOf(after)[0]));
  expect(await shown(page, setCheerText(bonus)), '알림은 걷혔다').toBe(false);
  expect(await hiddenTexts(page, KEY), '체리 세트를 다 모은 가게').toEqual([]);

  // 붙인 부적을 누르면 설명 창의 맨 아래에 세트의 한 줄이 붙는다.
  await tapSlot(page, 0);
  const note = setNoteOf(after, after[0]);
  if (!note) throw new Error('세트에 드는 부적이 아니다');
  await expect.poll(() => shown(page, note.progress), { ...WAIT, message: '설명 창의 세트 표' }).toBe(true);
  expect(await shown(page, note.bonus), '지금 듣는 덤').toBe(true);
  expect(await hiddenTexts(page, KEY, { from: '떼기' }), '세트의 한 줄이 붙은 설명 창').toEqual([]);
  if (info.project.name === '390x844') await page.screenshot({ path: SHOT });

  // 세트에 들지 않는 부적의 설명 창에는 세트의 한 줄이 없다.
  await tapSlot(page, 2);
  // 세트 줄의 "체리 세트 3/3"은 그대로 있으므로 덤의 글로 본다.
  await expect.poll(() => shown(page, note.bonus), WAIT).toBe(false);
  expect(await hiddenTexts(page, KEY, { from: '떼기' }), '세트에 들지 않는 부적의 설명 창').toEqual([]);
});

it('행운 슬롯: 여러 세트를 모아도 세트 줄이 가게 창 안에 들어가고, 돌리는 동안의 설명 창에도 세트가 적힌다', async ({ page }) => {
  await openApp(page);
  await startScene(page, KEY);
  // 다섯 장이 모두 다른 세트에 든다. 많이 모은 것부터 줄에 들어가는 만큼만 놓인다.
  const owned = ['more-clover', 'gold-clover', 'more-horseshoe', 'more-diamond', 'middle'];
  await openShopWith(page, shopRun(40, owned, ['less-cherry', 'gold-horseshoe', 'finale']));
  const clover = setProgressOf(owned).find((item) => item.set.id === 'clover');
  if (!clover) throw new Error('클로버 세트를 모으지 않았다');
  expect(await shown(page, setProgressText(clover)), '가장 많이 모은 세트는 늘 놓인다').toBe(true);
  expect(await hiddenTexts(page, KEY), '여러 세트를 모으는 가게').toEqual([]);

  // 가게를 닫고 돌리는 동안에도 붙인 부적을 누르면 세트의 한 줄이 보인다.
  await tapText(page, KEY, '다음 라운드');
  await expect.poll(async () => (await runOf(page)).phase, WAIT).toBe('spin');
  await tapSlot(page, 0);
  const note = setNoteOf(owned, owned[0]);
  if (!note) throw new Error('세트에 드는 부적이 아니다');
  await expect.poll(() => shown(page, note.progress), { ...WAIT, message: '돌리는 동안의 설명 창' }).toBe(true);
  expect(await shown(page, note.bonus)).toBe(true);
  expect(await hiddenTexts(page, KEY), '돌리는 동안의 설명 창').toEqual([]);
});
