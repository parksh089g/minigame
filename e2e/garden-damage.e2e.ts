/**
 * 텃밭 지키기의 피해 기록을 화면에서 본다: 날을 지키면 가게 창의 맨 위에 "피해 보기"와(자리가 있으면) 그날의 짧은 막대가 뜨고,
 * 피해 기록 창에서 그날과 이 판을 바꿔 보며, 밭의 동료를 꾹 누르면 이 판에서 준 피해가 적히고, 결과 화면에도 가장 큰 피해가 적힌다.
 * 글자가 화면 밖으로 나가거나 겹치지 않는지 두 화면 크기에서 모두 본다.
 */
import './app-globals';
import { expect, type Page } from '@playwright/test';
import { GAME_WIDTH, SCENE } from '../src/config';
import { cellCorner } from '../src/games/garden-guard/allies';
import { FIELD, GARDEN_CELLS, GARDEN_SCENE } from '../src/games/garden-guard/data';
import { DAMAGE_TEXT, damageLabel, sourceName, type DamageTally } from '../src/games/garden-guard/damage';
import { allyInfo, INFO_TEXT, SHOP_TEXT } from '../src/games/garden-guard/shop-text';
import { hiddenTexts, it, openApp, startScene, tapText, textPoint, textsOutsideCards, waitForScene } from './app';

const WAIT = { timeout: 20_000 } as const;
/** 눈으로 볼 수 있게 피해 기록 창을 찍어 두는 곳(작은 화면에서만). 비워 두면 찍지 않는다. */
const SHOT_PATH = process.env.GARDEN_DAMAGE_SHOT ?? '';

/** 텃밭 지키기의 판 밖 진행을 앱이 읽기 전에 넣어 둔다. 저장하는 곳과 이름은 garden-guard/store.ts와 같다. */
async function seedGardenMeta(page: Page, meta: object): Promise<void> {
  await page.evaluate(
    (value) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('pocket-arcade-garden');
        open.onupgradeneeded = () => open.result.createObjectStore('kv');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(value, 'meta');
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    meta,
  );
}

/** 캔버스의 논리 좌표 at을 손가락으로 ms만큼 누르고 있다가 뗀다(움직이지 않는다). */
async function holdOnCanvas(page: Page, at: { x: number; y: number }, ms: number): Promise<void> {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('캔버스가 보이지 않는다');
  const scale = box.width / GAME_WIDTH;
  const point = { x: box.x + at.x * scale, y: box.y + at.y * scale };
  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [point],
  });
  await page.waitForTimeout(ms);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await client.detach();
}

/** 밭의 그 칸의 한가운데(화면의 논리 좌표) */
function cellPoint(fenceY: number, cell: number): { x: number; y: number } {
  const corner = cellCorner(cell);
  return {
    x: corner.x + GARDEN_CELLS.cell / 2,
    y: fenceY + (corner.y - FIELD.depth) + GARDEN_CELLS.cell / 2,
  };
}

/** 그날과 이 판의 피해: 일곱 가지가 피해를 주어서 창의 줄이 많다. */
const DAY: DamageTally = {
  gun: 5200,
  frog: 3100,
  toad: 920,
  storm: 450,
  thorns: 120,
  sunflower: 60,
  mint: 30,
};
const RUN: DamageTally = {
  gun: 81_200,
  frog: 64_100,
  toad: 123_456,
  storm: 2450,
  thorns: 820,
  sunflower: 960,
  mint: 330,
};

it('텃밭 지키기: 날을 지키면 피해 기록을 보고, 밭의 동료와 결과 화면에도 준 피해가 적힌다', async ({ page }) => {
  await openApp(page);
  await seedGardenMeta(page, {
    version: 4,
    seeds: 0,
    levels: { power: 20, rapid: 6, fence: 10, storm: 1 },
    best: 10,
    runs: 5,
    kills: 100,
    startDay: 1,
    fields: 0,
    bestEver: 10,
    shards: 0,
    relics: {},
    savedAt: Date.now() + 60_000,
  });
  await page.reload();
  await waitForScene(page, 'Hub');
  await startScene(page, GARDEN_SCENE);
  await expect.poll(() => textPoint(page, GARDEN_SCENE, '출발!'), WAIT).not.toBeNull();
  await tapText(page, GARDEN_SCENE, '출발!');
  await expect.poll(() => textPoint(page, GARDEN_SCENE, SHOP_TEXT.title), WAIT).not.toBeNull();
  // 아직 준 피해가 없는 첫날 앞 가게에는 "피해 보기"가 없다.
  expect(await textPoint(page, GARDEN_SCENE, DAMAGE_TEXT.open)).toBeNull();
  await tapText(page, GARDEN_SCENE, SHOP_TEXT.start(1));
  await expect.poll(() => textPoint(page, GARDEN_SCENE, SHOP_TEXT.title), WAIT).toBeNull();

  // 개구리(2·3번 칸) 아래에 두꺼비(10·11·18·19번 칸)를 세우고, 피해를 적은 뒤 나올 벌레를 치워서 그날을 지킨 것으로 만든다.
  const fenceY = await page.evaluate(
    ({ key, day, run }) => {
      const scene = window.__pocketArcade?.scene.getScene(key) as unknown as {
        run: {
          allies: unknown[];
          queue: unknown[];
          enemies: unknown[];
          dealt: object;
        };
        layout: { fenceY: number };
      };
      scene.run.allies = [
        { id: 'frog', copies: 2, fireIn: 0.5, cell: 2 },
        { id: 'toad', copies: 1, fireIn: 0.5, cell: 10 },
      ];
      scene.run.dealt = { day, run };
      scene.run.queue = [];
      scene.run.enemies = [];
      return scene.layout.fenceY;
    },
    { key: GARDEN_SCENE, day: DAY, run: RUN },
  );
  await expect.poll(() => textPoint(page, GARDEN_SCENE, '1일째 지킴!'), WAIT).not.toBeNull();
  await expect.poll(() => textPoint(page, GARDEN_SCENE, DAMAGE_TEXT.open), WAIT).not.toBeNull();
  // 긴 화면에는 그날 가장 많이 준 셋이 짧은 막대로 함께 적힌다. 짧은 화면(320×568)에는 자리가 없어 "피해 보기"로만 본다.
  const height = await page.evaluate((key) => window.__pocketArcade?.scene.getScene(key)?.scale.height ?? 0, GARDEN_SCENE);
  const summary = await textPoint(page, GARDEN_SCENE, sourceName('gun'));
  if (height >= 480) expect(summary, '그날의 막대').not.toBeNull();
  await page.waitForTimeout(300);
  expect(await hiddenTexts(page, GARDEN_SCENE), '피해 보기가 있는 가게').toEqual([]);
  expect(await textsOutsideCards(page, GARDEN_SCENE, SHOP_TEXT.title), '가게의 카드').toEqual([]);

  // 피해 기록 창: 그날의 기록부터 보인다.
  await tapText(page, GARDEN_SCENE, DAMAGE_TEXT.open);
  await expect.poll(() => textPoint(page, GARDEN_SCENE, DAMAGE_TEXT.title), WAIT).not.toBeNull();
  expect(await textPoint(page, GARDEN_SCENE, SHOP_TEXT.title), '가게의 글은 감춘다').toBeNull();
  for (const text of [DAMAGE_TEXT.today(1), DAMAGE_TEXT.run, sourceName('gun'), damageLabel(5200), sourceName('frog'), damageLabel(3100)]) {
    expect(await textPoint(page, GARDEN_SCENE, text), text).not.toBeNull();
  }
  expect(await hiddenTexts(page, GARDEN_SCENE), '그날의 피해 기록').toEqual([]);
  if (SHOT_PATH && page.viewportSize()?.width === 320) await page.screenshot({ path: SHOT_PATH });

  // 이 판의 기록으로 바꾸면 두꺼비가 맨 위다.
  await tapText(page, GARDEN_SCENE, DAMAGE_TEXT.run);
  await expect.poll(() => textPoint(page, GARDEN_SCENE, damageLabel(123_456)), WAIT).not.toBeNull();
  expect(await hiddenTexts(page, GARDEN_SCENE), '이 판의 피해 기록').toEqual([]);
  await tapText(page, GARDEN_SCENE, DAMAGE_TEXT.close);
  await expect.poll(() => textPoint(page, GARDEN_SCENE, SHOP_TEXT.title), WAIT).not.toBeNull();
  expect(await textPoint(page, GARDEN_SCENE, DAMAGE_TEXT.title)).toBeNull();

  // 밭의 두꺼비를 꾹 누르면 이 판에서 준 피해가 적힌다. 솜씨와 짝이 많은 두꺼비의 창은 줄이 가장 많지만 모두 보인다.
  const state = await page.evaluate((key) => (window.__pocketArcade?.scene.getScene(key) as unknown as { run: object }).run, GARDEN_SCENE);
  const toad = allyInfo(state as Parameters<typeof allyInfo>[0], 'toad', 1, 1);
  expect(toad.dealt).toBe(DAMAGE_TEXT.allyRun(123_456, 45, 1));
  await holdOnCanvas(page, cellPoint(fenceY, 18), 700);
  await expect
    .poll(() => textPoint(page, GARDEN_SCENE, toad.dealt!), {
      ...WAIT,
      message: '두꺼비가 준 피해',
    })
    .not.toBeNull();
  expect(await hiddenTexts(page, GARDEN_SCENE), '두꺼비의 정보 창').toEqual([]);
  await tapText(page, GARDEN_SCENE, INFO_TEXT.close);
  await expect.poll(() => textPoint(page, GARDEN_SCENE, SHOP_TEXT.title), WAIT).not.toBeNull();

  // 판을 끝내면 결과 화면에 이 판에서 가장 많이 준 것과 그 몫이 적힌다.
  await page.evaluate((key) => {
    (
      window.__pocketArcade?.scene.getScene(key) as unknown as {
        run: { fence: number };
      }
    ).run.fence = 0;
  }, GARDEN_SCENE);
  await waitForScene(page, SCENE.result);
  await expect.poll(() => textPoint(page, SCENE.result, DAMAGE_TEXT.resultLabel), WAIT).not.toBeNull();
  expect(await textPoint(page, SCENE.result, DAMAGE_TEXT.resultValue(sourceName('toad'), 45))).not.toBeNull();
  expect(await hiddenTexts(page, SCENE.result), '결과 화면').toEqual([]);
});
