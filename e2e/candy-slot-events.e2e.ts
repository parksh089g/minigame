/**
 * 행운 슬롯의 라운드 이벤트와 대장의 상 화면 점검: 가게에서는 다음 라운드의 이벤트가, 라운드를 시작하면 그 라운드의 이벤트가
 * HUD의 "라운드" 아래 표에 보이고 다른 글을 가리지 않는지, 대장을 넘기고 연 가게에서 상을 고르는 창이 제대로 보이고
 * 조각을 고르면 여느 가게가 열리는지 본다. 점검마다 저장이 비어 있는 새 브라우저에서 시작한다.
 */
import './app-globals';
import { expect, test, type Page } from '@playwright/test';
import { SCENE } from '../src/config';
import { eventLine, eventTag, REWARD_TEXT } from '../src/games/candy-slot/round-event-text';
import { bossPiecesOf, type RoundEvent } from '../src/games/candy-slot/round-events';
import { HOLDS_PER_ROUND, REROLL_COST, type RunState } from '../src/games/candy-slot/rules';
import { hiddenTexts, it, openApp, startScene, tapText, textPoint } from './app';

const KEY = SCENE.candySlot;
const WAIT = { timeout: 15_000 };

interface SlotView {
  run: RunState;
  time: { now: number };
  shopGuardUntil: number;
  openShop(): void;
  closeShop(): void;
}

/** round번째 라운드를 넘기고 가게가 열린 판. 규칙으로 나올 수 있는 값만 쓴다. */
function shopRun(round: number, event: RoundEvent, reward?: string[]): RunState {
  return {
    phase: 'shop',
    round,
    spinsLeft: 0,
    coin: 14,
    earned: 40,
    charms: ['wide'],
    shop: { offers: ['tall', 'piggy', 'comfort'], rerollCost: REROLL_COST },
    afterMiss: false,
    bestSpin: 9,
    lastGrid: [0, 1, 2, 3, 4, 5, 1, 2, 0],
    holdsLeft: HOLDS_PER_ROUND,
    seed: null,
    spinCount: round * 6,
    drawCount: round,
    perks: [],
    relics: {},
    event,
    ...(reward ? { reward } : {}),
  };
}

/** 하던 판을 바꿔 놓고 가게를 연 뒤, 가게가 막 열렸을 때의 누름 막기가 풀릴 때까지 기다린다. */
async function openShopWith(page: Page, run: RunState): Promise<void> {
  await page.evaluate(
    ([key, next]) => {
      const scene = window.__pocketArcade?.scene.getScene(key) as unknown as SlotView;
      scene.run = next;
      scene.openShop();
    },
    [KEY, run] as const,
  );
  await page.waitForFunction(
    (key) => {
      const scene = window.__pocketArcade?.scene.getScene(key) as unknown as SlotView;
      return scene.time.now >= scene.shopGuardUntil;
    },
    KEY,
    WAIT,
  );
}

/** 화면을 눈으로 볼 때만 찍는다(EVENTS_SHOT=찍을 곳의 앞부분). wait만큼 기다렸다 찍는다(알림이 다 떴을 때). */
const shot = async (page: Page, name: string, wait = 0): Promise<void> => {
  const prefix = process.env.EVENTS_SHOT;
  if (!prefix) return;
  if (wait > 0) await page.waitForTimeout(wait);
  await page.screenshot({ path: `${prefix}-${test.info().project.name}-${name}.png` });
};

it('행운 슬롯: 이벤트의 이름이 라운드 아래 표에 보이고, 대장의 상을 고르는 창도 글이 가리지 않는다', async ({ page }) => {
  await openApp(page);
  await startScene(page, KEY);

  // 1. 가게에서는 다음 라운드의 이벤트가 "다음"을 붙여 적힌다.
  const event: RoundEvent = { id: 'no-diag', round: 3 };
  await openShopWith(page, shopRun(2, event));
  await expect.poll(() => textPoint(page, KEY, eventTag(event, true)), WAIT).not.toBeNull();
  await expect.poll(() => hiddenTexts(page, KEY), { ...WAIT, message: '가게' }).toEqual([]);
  await shot(page, 'shop');

  // 2. 라운드를 시작하면 그 라운드의 이벤트가 적히고, 알림이 사라진 뒤 가려진 글이 없다.
  await page.evaluate((key) => (window.__pocketArcade?.scene.getScene(key) as unknown as SlotView).closeShop(), KEY);
  await expect.poll(() => textPoint(page, KEY, eventTag(event, false)), WAIT).not.toBeNull();
  // 라운드를 알리는 글 뒤에 이벤트가 하는 일이 기계 위에 뜬다.
  await expect.poll(() => textPoint(page, KEY, eventLine(event)), WAIT).not.toBeNull();
  await shot(page, 'banner', 200);
  await expect.poll(() => hiddenTexts(page, KEY), { ...WAIT, message: '이벤트가 걸린 라운드' }).toEqual([]);
  await shot(page, 'spin');

  // 3. 대장을 넘기고 연 가게는 상을 고르는 창부터 연다. 조각을 고르면 여느 가게가 열린다.
  const next: RoundEvent = { id: 'heavy', round: 6 };
  await openShopWith(page, shopRun(5, next, ['tall+', 'piggy+', 'crown+']));
  await expect.poll(() => textPoint(page, KEY, REWARD_TEXT.title), WAIT).not.toBeNull();
  await expect.poll(() => hiddenTexts(page, KEY), { ...WAIT, message: '대장의 상' }).toEqual([]);
  await shot(page, 'reward');
  await tapText(page, KEY, REWARD_TEXT.pieces(bossPiecesOf(5)));
  await expect.poll(() => textPoint(page, KEY, '부적 가게'), WAIT).not.toBeNull();
  const run = await page.evaluate((key) => (window.__pocketArcade?.scene.getScene(key) as unknown as SlotView).run, KEY);
  expect(run.reward, '상을 골랐다').toBeUndefined();
  expect(run.bonusPieces).toBe(bossPiecesOf(5));
});
