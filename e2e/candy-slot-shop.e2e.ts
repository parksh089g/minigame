/**
 * 행운 슬롯의 가게와 확률 줄의 화면 점검: 가게가 막 열렸을 때 돌리기를 누르던 손이 금화를 쓰거나 가게를 닫지 않는지,
 * 자리가 다 찼을 때의 안내가 금화부터 따지는지, 확률 줄의 퍼센트를 더하면 100인지, 가게에서 판을 끝내면 가게가 걷히는지 본다.
 * 점검마다 저장이 비어 있는 새 브라우저에서 시작한다.
 */
import './app-globals';
import { expect, type Page } from '@playwright/test';
import { SCENE } from '../src/config';
import { charmOf, CHARMS, HOLDS_PER_ROUND, REROLL_COST, SLOTS, type RunState } from '../src/games/candy-slot/rules';
import { it, openApp, startScene, tapAt, tapText, textPoint } from './app';

const KEY = SCENE.candySlot;
const WAIT = { timeout: 15_000 };
const FULL_NOTE = '자리가 없어요. 부적을 눌러 떼요';
const POOR_NOTE = '금화가 모자라요';
/** 가게의 첫 줄에 놓고 눌러 볼 부적의 이름 */
const FIRST = charmOf('wide')?.name ?? '';

/** 장면에서 이 점검이 들여다보는 것. 화면에서는 감춰 둔 것(private)도 페이지 안에서는 그대로 부를 수 있다. */
interface SlotView {
  run: RunState;
  busy: boolean;
  layout: { button: { x: number; y: number; width: number; height: number } };
  time: { now: number };
  shopGuardUntil: number;
  openShop(): void;
  tryReroll(): void;
  closeShop(): void;
  refreshOdds(bounce: boolean): void;
  finishEarly(): void;
}

function runOf(page: Page): Promise<RunState> {
  return page.evaluate((key) => (window.__pocketArcade?.scene.getScene(key) as unknown as SlotView).run, KEY);
}

/** 가게가 열린 판. 규칙으로 나올 수 있는 값만 쓴다. */
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

it('행운 슬롯: 가게가 막 열렸을 때는 다시 뽑기와 다음 라운드가 눌리지 않는다', async ({ page }) => {
  await openApp(page);
  await startScene(page, KEY);
  const offers = ['wide', 'tall', 'slant'];

  // 가게가 열린 바로 그 순간의 누름(돌리기를 잇달아 누르던 손)은 금화를 쓰지도, 가게를 닫지도 않는다.
  const start = shopRun(60, [], offers);
  const after = await page.evaluate(
    ([key, next]) => {
      const scene = window.__pocketArcade?.scene.getScene(key) as unknown as SlotView;
      scene.run = next;
      scene.openShop();
      scene.tryReroll();
      scene.closeShop();
      return scene.run;
    },
    [KEY, start] as const,
  );
  expect(after, '막 열린 가게에서는 아무 일도 일어나지 않는다').toEqual(start);

  // 돌리기 버튼이 있던 자리를 손가락으로 바로 눌러도 마찬가지다.
  const button = await page.evaluate(
    (key) => (window.__pocketArcade?.scene.getScene(key) as unknown as SlotView).layout.button,
    KEY,
  );
  const y = button.y + button.height / 2;
  const guarded = await page.evaluate((key) => {
    const scene = window.__pocketArcade?.scene.getScene(key) as unknown as SlotView;
    return scene.time.now < scene.shopGuardUntil;
  }, KEY);
  if (guarded) {
    await tapAt(page, button.x + button.width * 0.25, y);
    const stillGuarded = await page.evaluate((key) => {
      const scene = window.__pocketArcade?.scene.getScene(key) as unknown as SlotView;
      return scene.time.now < scene.shopGuardUntil;
    }, KEY);
    // 느린 기계에서 누르는 사이에 막기가 풀렸으면 이 누름은 따지지 않는다.
    if (stillGuarded) expect(await runOf(page), '막 열린 가게를 눌러도 그대로다').toEqual(start);
  }

  // 조금 지나면 두 버튼이 제대로 눌린다.
  await openShopWith(page, start);
  await tapText(page, KEY, '다시 뽑기');
  await expect.poll(async () => (await runOf(page)).coin, WAIT).toBe(start.coin - REROLL_COST);
  expect((await runOf(page)).phase).toBe('shop');
  await tapText(page, KEY, '다음 라운드');
  await expect.poll(async () => (await runOf(page)).phase, WAIT).toBe('spin');
  expect((await runOf(page)).round).toBe(start.round + 1);
});

it('행운 슬롯: 자리가 다 찼어도 금화가 모자라면 금화가 모자란다고 알린다', async ({ page }) => {
  await openApp(page);
  await startScene(page, KEY);
  const owned = ['twins', 'crown', 'piggy', 'extra', 'comfort'];
  expect(owned).toHaveLength(SLOTS);

  // 금화가 없으면: 부적을 떼라고 하지 않는다(떼어도 살 수 없고, 뗀 부적은 돌아오지 않는다).
  const poor = shopRun(0, owned, ['wide', 'tall', 'slant']);
  await openShopWith(page, poor);
  await tapText(page, KEY, FIRST);
  await expect.poll(() => textPoint(page, KEY, POOR_NOTE), WAIT).not.toBeNull();
  expect(await textPoint(page, KEY, FULL_NOTE), '금화가 모자랄 때는 자리를 탓하지 않는다').toBeNull();
  expect(await runOf(page), '살 수 없으면 판은 그대로다').toEqual(poor);

  // 금화가 넉넉하면: 그때는 자리가 없다고 알린다.
  await startScene(page, KEY);
  const rich = shopRun(99, owned, ['wide', 'tall', 'slant']);
  await openShopWith(page, rich);
  await tapText(page, KEY, FIRST);
  await expect.poll(() => textPoint(page, KEY, FULL_NOTE), WAIT).not.toBeNull();
  expect(await runOf(page)).toEqual(rich);
});

it('행운 슬롯: 확률 줄의 퍼센트를 더하면 어떤 부적을 붙여도 100이다', async ({ page }) => {
  await openApp(page);
  await startScene(page, KEY);
  const sums = await page.evaluate(
    ([key, ids]) => {
      const scene = window.__pocketArcade?.scene.getScene(key) as unknown as SlotView;
      const shown = (): number => {
        const texts = (scene as unknown as Phaser.Scene).children.list.filter(
          (item): item is Phaser.GameObjects.Text => item.type === 'Text',
        );
        return texts
          .filter((text) => text.visible && /^\d+%$/.test(text.text))
          .reduce((sum, text) => sum + Number.parseInt(text.text, 10), 0);
      };
      const out: Array<[string, number]> = [];
      for (const id of ['', ...ids]) {
        scene.run = { ...scene.run, charms: id ? [id] : [] };
        scene.refreshOdds(false);
        out.push([id || '부적 없음', shown()]);
      }
      return out;
    },
    [KEY, CHARMS.map((charm) => charm.id)] as const,
  );
  expect(sums.filter(([, sum]) => sum !== 100)).toEqual([]);
});

it('행운 슬롯: 가게에서 판을 끝내면 가게가 걷히고 알림만 남는다', async ({ page }) => {
  await openApp(page);
  await startScene(page, KEY);
  await openShopWith(page, shopRun(12, ['wide'], ['tall', 'slant', 'twins']));
  await page.evaluate((key) => (window.__pocketArcade?.scene.getScene(key) as unknown as SlotView).finishEarly(), KEY);
  await expect.poll(() => textPoint(page, KEY, '여기까지!'), WAIT).not.toBeNull();
  for (const label of ['부적 가게', '눌러서 사요', '다시 뽑기', '다음 라운드']) {
    expect(await textPoint(page, KEY, label), `"${label}"는 걷혀야 한다`).toBeNull();
  }
});
