/**
 * 텃밭 지키기 가게의 "꾹 누르면 자세히" 말풍선: 처음 가게에 뜨고, 카드나 글과 겹치지 않으며 누르는 것을 막지 않는다.
 * 날을 지킨 뒤의 긴 가게에서도 창이 울타리를 넘지 않는다. 꾹 눌러 정보 창을 한 번 열면 걷히고, 다시는 뜨지 않는다.
 */
import './app-globals';
import { expect, type Page } from '@playwright/test';
import { GAME_WIDTH } from '../src/config';
import { ALLIES, GARDEN_SCENE } from '../src/games/garden-guard/data';
import { HOLD_HINT_SHOPS, type GardenMeta } from '../src/games/garden-guard/rules';
import { INFO_TEXT, SHOP_TEXT } from '../src/games/garden-guard/shop-text';
import { hiddenTexts, it, openApp, startScene, tapText, textPoint, waitForScene } from './app';

const WAIT = { timeout: 20_000 } as const;
const SHOT = '/tmp/claude-0/-home-user/cd3ba1c3-dcd8-57f3-b0e5-b7e054e7c1e1/scratchpad/garden-hint.png';

/** 한 판을 해 본 사람. 꾹 누르기 안내(holdHint)가 생기기 전의 저장이라 그 항목이 없다. */
const META = {
  version: 4,
  seeds: 0,
  levels: { power: 20, rapid: 6, fence: 10, storm: 1 },
  best: 0,
  runs: 2,
  kills: 30,
  startDay: 1,
  fields: 0,
  bestEver: 0,
  shards: 0,
  relics: {},
};

/** 기기의 판 밖 진행을 읽거나(value 없이) 적는다. 저장하는 곳과 이름은 garden-guard/store.ts와 같다. */
function meta(page: Page, value?: object): Promise<GardenMeta> {
  return page.evaluate(
    (put) =>
      new Promise<GardenMeta>((resolve, reject) => {
        const open = indexedDB.open('pocket-arcade-garden');
        open.onupgradeneeded = () => open.result.createObjectStore('kv');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('kv', put ? 'readwrite' : 'readonly');
          const store = tx.objectStore('kv');
          const request = put ? store.put(put, 'meta') : store.get('meta');
          tx.oncomplete = () => {
            open.result.close();
            resolve((put ?? request.result) as GardenMeta);
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    value ?? null,
  );
}

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** 그 글자의 상자(컨테이너 안의 것도 찾는다). 없으면 null */
function textBox(page: Page, text: string): Promise<Box | null> {
  return page.evaluate(
    ([key, label]) => {
      const scene = window.__pocketArcade?.scene.getScene(key);
      const all = (list: Phaser.GameObjects.GameObject[]): Phaser.GameObjects.GameObject[] =>
        list.flatMap((item) => (item.type === 'Container' ? all((item as Phaser.GameObjects.Container).list) : [item]));
      const found = all(scene?.children.list ?? []).find(
        (item): item is Phaser.GameObjects.Text =>
          item.type === 'Text' && (item as Phaser.GameObjects.Text).text === label && (item as Phaser.GameObjects.Text).visible,
      );
      if (!found) return null;
      const b = found.getBounds();
      return { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
    },
    [GARDEN_SCENE, text] as const,
  );
}

/** 가게의 첫 카드 이름의 위쪽 끝과 울타리의 높이 */
async function shopFrame(page: Page): Promise<{ cardTop: number; fenceY: number; firstName: string }> {
  const { first, fenceY } = await page.evaluate((key) => {
    const scene = window.__pocketArcade?.scene.getScene(key) as unknown as { run: { shop: Array<{ id: string }> }; layout: { fenceY: number } };
    return { first: scene.run.shop[0].id, fenceY: scene.layout.fenceY };
  }, GARDEN_SCENE);
  const name = ALLIES[first as keyof typeof ALLIES].name;
  const box = await textBox(page, name);
  // 카드의 이름은 카드 위쪽 끝에서 6 아래에 적힌다(shop.ts).
  return { cardTop: (box?.top ?? 0) - 4, fenceY, firstName: name };
}

/** 말풍선이 카드 위에, 화면 안에 들고, 가게 창의 단추가 울타리 위에 있는지 본다. */
async function expectBubbleFits(page: Page, what: string, button: string): Promise<void> {
  const bubble = await textBox(page, SHOP_TEXT.holdHint);
  expect(bubble, `${what}: 말풍선`).not.toBeNull();
  const { cardTop, fenceY } = await shopFrame(page);
  expect(bubble!.left, `${what}: 왼쪽`).toBeGreaterThanOrEqual(8);
  expect(bubble!.right, `${what}: 오른쪽`).toBeLessThanOrEqual(GAME_WIDTH - 8);
  expect(bubble!.bottom, `${what}: 카드와의 틈`).toBeLessThanOrEqual(cardTop);
  const start = await textBox(page, button);
  expect(start!.bottom, `${what}: 단추가 울타리 위`).toBeLessThanOrEqual(fenceY);
  expect(await hiddenTexts(page, GARDEN_SCENE), what).toEqual([]);
}

/** 캔버스의 논리 좌표 at을 손가락으로 ms만큼 누르고 있다가 뗀다. */
async function hold(page: Page, at: { x: number; y: number }, ms: number): Promise<void> {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('캔버스가 보이지 않는다');
  const scale = box.width / GAME_WIDTH;
  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + at.x * scale, y: box.y + at.y * scale }] });
  await page.waitForTimeout(ms);
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.detach();
}

/** 가게를 닫고 다시 연다(날을 지킨 뒤의 가게처럼 맨 위에 알림을 적을 수 있다). */
function reopenShop(page: Page, cleared: { title: string; detail: string } | null): Promise<void> {
  return page.evaluate(
    ({ key, note }) => {
      const scene = window.__pocketArcade?.scene.getScene(key) as unknown as {
        cleared: unknown;
        run: unknown;
        closeShop(): void;
        openShop(run: unknown): void;
      };
      scene.closeShop();
      scene.cleared = note;
      scene.openShop(scene.run);
    },
    { key: GARDEN_SCENE, note: cleared },
  );
}

it('텃밭 지키기: 처음 가게에 꾹 누르기 말풍선이 뜨고, 꾹 눌러 보면 걷혀 다시 뜨지 않는다', async ({ page }, testInfo) => {
  await openApp(page);
  await meta(page, { ...META, savedAt: Date.now() + 60_000 });
  await page.reload();
  await waitForScene(page, 'Hub');
  await startScene(page, GARDEN_SCENE);
  await expect.poll(() => textPoint(page, GARDEN_SCENE, '출발!'), WAIT).not.toBeNull();
  await tapText(page, GARDEN_SCENE, '출발!');
  await expect.poll(() => textPoint(page, GARDEN_SCENE, SHOP_TEXT.holdHint), { ...WAIT, message: '첫 가게의 말풍선' }).not.toBeNull();
  // 창이 나타나기를 기다린다. 끌어다 놓는 도움말도 그대로 있다.
  await page.waitForTimeout(400);
  expect(await textPoint(page, GARDEN_SCENE, SHOP_TEXT.dragHint)).not.toBeNull();
  await expectBubbleFits(page, '첫날 앞의 가게', SHOP_TEXT.start(1));
  if (testInfo.project.name === '320x568') await page.screenshot({ path: SHOT });
  await expect.poll(async () => (await meta(page)).holdHint, { ...WAIT, message: '띄운 가게를 센다' }).toBe(1);

  // 날을 지킨 뒤의 가게(맨 위에 두 줄이 더 있다)에서도 창이 울타리를 넘지 않는다.
  await reopenShop(page, { title: '1일째 지킴!', detail: '씨앗 +12 · 열매 +4 · 유물 조각 +2 · 새 기록!' });
  await expect.poll(() => textPoint(page, GARDEN_SCENE, '1일째 지킴!'), WAIT).not.toBeNull();
  await page.waitForTimeout(400);
  await expectBubbleFits(page, '날을 지킨 뒤의 가게', SHOP_TEXT.start(1));
  await expect.poll(async () => (await meta(page)).holdHint, WAIT).toBe(2);

  // 말풍선은 누르는 것을 막지 않는다: 그 바로 아래의 자물쇠를 누르면 카드가 묶인다.
  const locked = (): Promise<boolean> =>
    page.evaluate((key) => (window.__pocketArcade?.scene.getScene(key) as unknown as { run: { shop: Array<{ locked?: boolean }> } }).run.shop[0].locked === true, GARDEN_SCENE);
  const { cardTop, firstName } = await shopFrame(page);
  await expect
    .poll(async () => {
      if (!(await locked())) await page.touchscreen.tap(...(await canvasPoint(page, { x: 22, y: cardTop - 2 })));
      return locked();
    }, { ...WAIT, message: '말풍선 곁의 자물쇠' })
    .toBe(true);

  // 카드를 꾹 누르면 정보 창이 뜨고, 닫으면 말풍선은 걷혀 있다. 다시는 띄우지 않게 저장된다.
  await hold(page, (await textPoint(page, GARDEN_SCENE, firstName))!, 700);
  await expect.poll(() => textPoint(page, GARDEN_SCENE, INFO_TEXT.close), { ...WAIT, message: '정보 창' }).not.toBeNull();
  await tapText(page, GARDEN_SCENE, INFO_TEXT.close);
  await expect.poll(() => textPoint(page, GARDEN_SCENE, SHOP_TEXT.title), WAIT).not.toBeNull();
  expect(await textPoint(page, GARDEN_SCENE, SHOP_TEXT.holdHint)).toBeNull();
  await expect.poll(async () => (await meta(page)).holdHint, WAIT).toBe(HOLD_HINT_SHOPS);
  await reopenShop(page, null);
  await expect.poll(() => textPoint(page, GARDEN_SCENE, SHOP_TEXT.title), WAIT).not.toBeNull();
  expect(await textPoint(page, GARDEN_SCENE, SHOP_TEXT.holdHint)).toBeNull();
  expect(await hiddenTexts(page, GARDEN_SCENE), '말풍선이 걷힌 가게').toEqual([]);
});

/** 논리 좌표를 페이지 좌표로 바꾼다. */
async function canvasPoint(page: Page, at: { x: number; y: number }): Promise<[number, number]> {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('캔버스가 보이지 않는다');
  const scale = box.width / GAME_WIDTH;
  return [box.x + at.x * scale, box.y + at.y * scale];
}
