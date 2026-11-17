/**
 * 텃밭 지키기의 화면 점검 가운데 준비 화면의 저장과 사고팔기를 본다:
 * 띄워 둔 사이에 다른 곳이 저장한 진행을 덮어쓰지 않는지, 살 수 없는 강화와 큰 값이 어떻게 적히는지,
 * 망가진 저장으로도 열리는지. 점수와 코인이 이 판에서 지킨 날 수를 따르는지도 본다.
 * 유물도 여기서 본다: 유물 화면이 언제 열리고 조각으로 어떻게 올리는지, 대장의 날을 지키면 조각을 받는지.
 * 배치와 판의 흐름은 layout.e2e.ts와 smoke.e2e.ts가 본다.
 */
import './app-globals';
import { expect, type Page } from '@playwright/test';
import { GAME_WIDTH, SCENE } from '../src/config';
import { GARDEN_SCENE, RELIC_ORDER, RELICS, UPGRADES } from '../src/games/garden-guard/data';
import {
  costLabel,
  MAX_DAY,
  META_VERSION,
  needLine,
  relicLine,
  shardsUpTo,
  upgradeCost,
  type GardenMeta,
} from '../src/games/garden-guard/rules';
import { hiddenTexts, it, openApp, startScene, tapAt, tapText, textPoint, waitForScene } from './app';

const WAIT = { timeout: 20_000 } as const;

// 준비 화면의 글(garden-guard/lobby.ts). lobby.ts는 Phaser를 불러서 여기서 가져올 수 없다.
const INFO_HINT = '강화를 누르면 설명이 보여요';
const START_DAY_INFO = '고른 날부터 시작해요.\n대장을 물리치면 그다음 날이 열려요.';
const exactCost = (cost: number): string => `값은 씨앗 ${cost.toLocaleString('en-US')}개예요`;
// 유물 화면의 글(garden-guard/relic-page.ts). 그 파일도 Phaser를 불러서 여기서 가져올 수 없다.
const RELIC_LABEL = '유물';
const RELIC_HINT = '유물을 누르면 설명이 보여요';
const RELIC_BACK = '준비 화면으로';

/** 한 판을 해 본 사람의 빈 텃밭 */
const BASE: GardenMeta = {
  version: META_VERSION,
  seeds: 0,
  levels: {},
  best: 0,
  runs: 1,
  kills: 10,
  startDay: 1,
  fields: 0,
  bestEver: 0,
  shards: 0,
  relics: {},
  savedAt: 1,
};

/** 텃밭 지키기의 판 밖 진행을 기기에 적는다. 저장하는 곳과 이름은 garden-guard/store.ts와 같다. */
async function writeMeta(page: Page, meta: object): Promise<void> {
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

/** 기기에 적힌 판 밖 진행 */
function readMeta(page: Page): Promise<GardenMeta> {
  return page.evaluate(
    () =>
      new Promise<GardenMeta>((resolve, reject) => {
        const open = indexedDB.open('pocket-arcade-garden');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const request = open.result.transaction('kv').objectStore('kv').get('meta');
          request.onsuccess = () => {
            open.result.close();
            resolve(request.result as GardenMeta);
          };
          request.onerror = () => reject(request.error);
        };
      }),
  );
}

/** 저장을 넣어 두고 앱을 새로 열어 준비 화면을 띄운다. */
async function openLobby(page: Page, meta: object): Promise<void> {
  await openApp(page);
  await writeMeta(page, meta);
  await page.reload();
  await openApp(page);
  await startScene(page, GARDEN_SCENE);
  await expect.poll(() => textPoint(page, GARDEN_SCENE, '텃밭 지키기'), WAIT).not.toBeNull();
}

interface TextBox {
  text: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** 준비 화면에 보이는 글자들과 놓인 자리 */
const lobbyTexts = (page: Page): Promise<TextBox[]> =>
  page.evaluate((key) => {
    const scene = window.__pocketArcade?.scene.getScene(key);
    if (!scene) return [];
    return scene.children.list.flatMap((item) => {
      const text = item as Phaser.GameObjects.Text;
      if (item.type !== 'Text' || !text.visible || text.alpha <= 0) return [];
      const bounds = text.getBounds();
      return [{ text: text.text, left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom }];
    });
  }, GARDEN_SCENE);

const hasText = async (page: Page, text: string): Promise<boolean> => (await lobbyTexts(page)).some((item) => item.text === text);

/** 그 이름의 강화 줄에서 값 버튼의 한가운데. 그 줄이 지금 쪽에 없으면 null */
async function buyPoint(page: Page, name: string): Promise<{ x: number; y: number } | null> {
  const label = (await lobbyTexts(page)).find((item) => item.text === name);
  // 값 버튼은 줄의 오른쪽 끝에 있고(lobby.ts의 BUY), 이름은 줄의 위쪽에 적힌다.
  return label ? { x: GAME_WIDTH - 8 - 6 - 30, y: label.top + 13 } : null;
}

/** 강화 목록의 "다음 쪽" 버튼을 누른다. 시작하는 날을 고르는 버튼도 같은 그림이라 가장 위의 것을 고른다. */
async function nextPage(page: Page): Promise<void> {
  const arrow = await page.evaluate((key) => {
    const scene = window.__pocketArcade?.scene.getScene(key);
    const arrows = (scene?.children.list ?? []).filter((item): item is Phaser.GameObjects.Image => {
      const image = item as Phaser.GameObjects.Image;
      return item.type === 'Image' && image.texture.key === 'icon-play' && image.visible && image.alpha === 1;
    });
    arrows.sort((a, b) => a.y - b.y);
    return arrows.length > 0 ? { x: arrows[0].x, y: arrows[0].y } : null;
  }, GARDEN_SCENE);
  if (!arrow) throw new Error('다음 쪽 버튼이 없다');
  await tapAt(page, arrow.x, arrow.y);
}

it('텃밭 지키기: 준비 화면을 띄워 둔 사이에 다른 곳이 저장한 진행을, 강화를 사면서 덮어쓰지 않는다', async ({ page }) => {
  await openLobby(page, { ...BASE, seeds: 100 });
  expect(await hasText(page, '100')).toBe(true);

  // 다른 곳(설치한 앱과 브라우저 탭 같은)이 그사이 훨씬 나아간 진행을 저장했다.
  const elsewhere = { seeds: 5000, levels: { rapid: 4 }, best: 12, bestEver: 12, runs: 9, startDay: 11 };
  await writeMeta(page, { ...BASE, ...elsewhere, savedAt: Date.now() + 60_000 });

  // 읽어 둔 옛 값(씨앗 100개)으로 사지 않는다. 준비 화면이 새 값으로 다시 열리고, 저장은 그대로다.
  const power = await buyPoint(page, UPGRADES.power.name);
  if (!power) throw new Error('센 물줄기의 줄이 없다');
  await tapAt(page, power.x, power.y);
  await expect.poll(() => hasText(page, '5000'), WAIT).toBe(true);
  expect(await hasText(page, '최고 12일째')).toBe(true);
  expect(await readMeta(page)).toMatchObject(elsewhere);
  expect(await hiddenTexts(page, GARDEN_SCENE), '다시 열린 준비 화면').toEqual([]);

  // 다시 누르면 새 값에서 산다. 다른 곳의 강화와 기록은 남는다.
  const again = await buyPoint(page, UPGRADES.power.name);
  if (!again) throw new Error('다시 열린 준비 화면에 센 물줄기의 줄이 없다');
  await tapAt(page, again.x, again.y);
  await expect.poll(async () => (await readMeta(page)).levels.power, WAIT).toBe(1);
  expect(await readMeta(page)).toMatchObject({
    seeds: 5000 - UPGRADES.power.cost,
    levels: { rapid: 4, power: 1 },
    best: 12,
    runs: 9,
    startDay: 11,
  });

  // 가려져 있다가 다시 보일 때도 그사이의 저장을 읽어 와서 다시 그린다.
  await writeMeta(page, { ...BASE, ...elsewhere, seeds: 7777, runs: 10, savedAt: Date.now() + 120_000 });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => hasText(page, '7777'), WAIT).toBe(true);
  expect((await readMeta(page)).seeds).toBe(7777);
});

it('텃밭 지키기: 동료 거름은 해바라기 모종 없이도 사고, 큰 값은 줄여 적어 버튼 안에 넣고, 설명 칸의 두 줄에 위아래 틈이 있다', async ({
  page,
}) => {
  // 거름의 값(80)은 넘고 해바라기 모종의 값(150)에는 모자란 씨앗. 동료 거름은 판에서 들인 모든 동료에게 들어서 조건 없이 산다.
  await openLobby(page, { ...BASE, seeds: 120 });
  await expect(async () => {
    if (!(await hasText(page, UPGRADES.compost.name))) await nextPage(page);
    expect(await hasText(page, UPGRADES.compost.name)).toBe(true);
  }).toPass(WAIT);
  expect(await hasText(page, needLine('helper')), '조건을 적지 않는다').toBe(false);
  expect(await hiddenTexts(page, GARDEN_SCENE), '거름이 있는 쪽').toEqual([]);
  const compost = await buyPoint(page, UPGRADES.compost.name);
  if (!compost) throw new Error('거름의 줄이 없다');
  await tapAt(page, compost.x, compost.y);
  await expect.poll(async () => (await readMeta(page)).levels, WAIT).toEqual({ compost: 1 });
  expect((await readMeta(page)).seeds).toBe(120 - UPGRADES.compost.cost);

  // 센 물줄기의 마지막 단계: 값이 여덟 자리다. 대장을 둘 넘겨서 시작하는 날도 고를 수 있다.
  const levels = { power: UPGRADES.power.maxLevel - 1 };
  const cost = upgradeCost('power', levels.power) ?? 0;
  expect(cost).toBeGreaterThan(9_999_999);
  await openLobby(page, { ...BASE, seeds: 99_999_999, levels, best: 12, bestEver: 12, startDay: 11 });
  const label = (await lobbyTexts(page)).find((item) => item.text === costLabel(cost));
  if (!label) throw new Error(`값 "${costLabel(cost)}"가 보이지 않는다`);
  // 값 버튼은 오른쪽 끝에서 폭 60이다(lobby.ts의 BUY). 씨앗 그림까지 그 안에 든다.
  const buttonRight = GAME_WIDTH - 8 - 6;
  expect(label.right).toBeLessThanOrEqual(buttonRight - 2);
  expect(label.left - 16).toBeGreaterThanOrEqual(buttonRight - 60 + 2);
  // 줄을 고르면 줄여 적지 않은 값이 설명 아래에 적힌다.
  const row = (await lobbyTexts(page)).find((item) => item.text === UPGRADES.power.name);
  if (!row) throw new Error('센 물줄기의 줄이 없다');
  await tapAt(page, 60, row.top + 13);
  const told = `${UPGRADES.power.blurb}\n${exactCost(cost)}`;
  await expect.poll(() => hasText(page, told), WAIT).toBe(true);

  /** 설명 칸: 맨 아래의 시작 줄(높이 36, 아래 여백 8) 위로 4만큼 띄운 높이 30의 칸 */
  const infoBox = await page.evaluate((key) => {
    const height = window.__pocketArcade?.scene.getScene(key)?.scale.height ?? 0;
    const bottom = height - 8 - 36 - 4;
    return { top: bottom - 30, bottom };
  }, GARDEN_SCENE);
  const inside = async (text: string): Promise<void> => {
    const box = (await lobbyTexts(page)).find((item) => item.text === text);
    if (!box) throw new Error(`"${text}"가 보이지 않는다`);
    expect(box.top - infoBox.top, `${text}: 위쪽 틈`).toBeGreaterThanOrEqual(1);
    expect(infoBox.bottom - box.bottom, `${text}: 아래쪽 틈`).toBeGreaterThanOrEqual(1);
  };
  await inside(told);
  expect(await hiddenTexts(page, GARDEN_SCENE), '큰 값의 줄을 고른 준비 화면').toEqual([]);

  // 시작하는 날을 앞으로 옮기면 두 줄의 안내가 나온다.
  const earlier = await page.evaluate((key) => {
    const scene = window.__pocketArcade?.scene.getScene(key);
    const arrow = (scene?.children.list ?? []).find((item) => {
      const image = item as Phaser.GameObjects.Image;
      return item.type === 'Image' && image.texture.key === 'icon-prev' && image.visible && image.y > scene!.scale.height - 60;
    }) as Phaser.GameObjects.Image | undefined;
    return arrow ? { x: arrow.x, y: arrow.y } : null;
  }, GARDEN_SCENE);
  if (!earlier) throw new Error('시작하는 날을 앞으로 옮기는 버튼이 없다');
  await tapAt(page, earlier.x, earlier.y);
  await expect.poll(() => hasText(page, START_DAY_INFO), WAIT).toBe(true);
  await inside(START_DAY_INFO);
  expect((await readMeta(page)).startDay).toBe(6);
  expect(await hiddenTexts(page, GARDEN_SCENE), '시작하는 날을 바꾼 준비 화면').toEqual([]);
});

it('텃밭 지키기: 최고 기록이 터무니없이 큰 저장도 준비 화면이 열리고, 기록은 잘라서 읽는다', async ({ page }) => {
  await openLobby(page, { ...BASE, seeds: 5, best: 1e12, bestEver: 1e12, startDay: 1e12 });
  await expect.poll(() => hasText(page, `최고 ${MAX_DAY}일째`), WAIT).toBe(true);
  expect(await hasText(page, INFO_HINT)).toBe(true);
  expect(await hiddenTexts(page, GARDEN_SCENE), '준비 화면').toEqual([]);
});

/** 허브의 세이브(core/store.ts)에 적힌 코인과 텃밭 지키기의 기록. 저장하는 곳과 이름은 그 파일과 같다. */
function readHubSave(page: Page): Promise<{ coins: number; best: number; plays: number } | null> {
  return page.evaluate(
    () =>
      new Promise<{ coins: number; best: number; plays: number } | null>((resolve, reject) => {
        const open = indexedDB.open('pocket-arcade');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const request = open.result.transaction('kv').objectStore('kv').get('save');
          request.onsuccess = () => {
            open.result.close();
            const save = request.result as { coins: number; games: Record<string, { best: number; plays: number }> } | undefined;
            const record = save?.games['garden-guard'];
            resolve(save && record ? { coins: save.coins, best: record.best, plays: record.plays } : null);
          };
          request.onerror = () => reject(request.error);
        };
      }),
  );
}

it('텃밭 지키기: 뒤쪽 날에서 시작해 하루만 지키고 끝낸 판은 100점에 코인 하나다', async ({ page }) => {
  // 대장을 여섯 넘겨서 31일째에서 시작하는 저장
  await openLobby(page, { ...BASE, best: 32, runs: 40, startDay: 31, savedAt: Date.now() + 60_000 });
  await tapText(page, GARDEN_SCENE, '출발!');
  const day = (): Promise<number | undefined> =>
    page.evaluate((key) => (window.__pocketArcade?.scene.getScene(key) as unknown as { run: { day: number } | null }).run?.day, GARDEN_SCENE);
  await expect.poll(day, { ...WAIT, message: '고른 날에서 시작해야 한다' }).toBe(31);

  // 그날을 지킨 것으로 적고 울타리를 무너뜨려 판을 끝낸다.
  await page.evaluate((key) => {
    const run = (window.__pocketArcade?.scene.getScene(key) as unknown as { run: { lastCleared: number; fence: number; dayKilled: number } }).run;
    run.lastCleared = 31;
    run.dayKilled = 0;
    run.fence = 0;
  }, GARDEN_SCENE);
  await waitForScene(page, SCENE.result);

  // 몇째 날까지 갔는지(31일째)가 아니라 이 판에서 지킨 날 수(하루)로 센다. 전에는 3100점에 코인 30개였다.
  await expect.poll(() => readHubSave(page), WAIT).toMatchObject({ coins: 1, plays: 1 });
  // 끝나는 순간에 벌레가 쫓겨나면 그날의 몫이 몇 점 붙는다. 그래도 지킨 하루의 100점대다.
  const best = (await readHubSave(page))?.best ?? 0;
  expect(best, '이 판에서 지킨 하루의 점수').toBeGreaterThanOrEqual(100);
  expect(best).toBeLessThan(200);
  await expect.poll(() => textPoint(page, SCENE.result, '1일 (31일째까지)'), { ...WAIT, message: '결과 화면의 지킨 날' }).not.toBeNull();
  expect(await textPoint(page, SCENE.result, '+1'), '받은 코인').not.toBeNull();
  expect(await hiddenTexts(page, SCENE.result), '결과 화면').toEqual([]);
});

it('텃밭 지키기: 대장을 물리친 사람은 준비 화면에서 유물을 열어, 조각으로 유물을 한 단계씩 올린다', async ({ page }) => {
  // 처음 하는 사람의 준비 화면에는 아직 쓸 일이 없는 유물 버튼이 없다.
  await openLobby(page, BASE);
  expect(await hasText(page, RELIC_LABEL)).toBe(false);

  // 대장을 둘 물리친 사람: 조각 셋을 가지고 있다.
  await openLobby(page, { ...BASE, best: 12, bestEver: 12, runs: 9, startDay: 11, shards: 3, savedAt: Date.now() + 60_000 });
  await expect.poll(() => hasText(page, RELIC_LABEL), WAIT).toBe(true);
  expect(await hiddenTexts(page, GARDEN_SCENE), '유물 버튼이 있는 준비 화면').toEqual([]);
  await tapText(page, GARDEN_SCENE, RELIC_LABEL);
  await expect.poll(() => hasText(page, RELIC_HINT), WAIT).toBe(true);
  // 유물 여섯이 한 쪽에 다 보이고, 지금 값과 다음 값이 적혀 있다.
  for (const id of RELIC_ORDER) {
    expect(await hasText(page, RELICS[id].name), RELICS[id].name).toBe(true);
    expect(await hasText(page, relicLine(id, 0)), relicLine(id, 0)).toBe(true);
  }
  expect(await hiddenTexts(page, GARDEN_SCENE), '유물 화면').toEqual([]);

  // 두더지 발톱을 한 단계 올린다(조각 하나).
  const claw = await buyPoint(page, RELICS.claw.name);
  expect(claw, '두더지 발톱의 값 버튼').not.toBeNull();
  await tapAt(page, claw!.x, claw!.y);
  await expect.poll(async () => (await readMeta(page)).relics, WAIT).toEqual({ claw: 1 });
  expect((await readMeta(page)).shards).toBe(2);
  await expect.poll(() => hasText(page, relicLine('claw', 1)), WAIT).toBe(true);
  expect(await hasText(page, RELICS.claw.blurb), '고른 유물의 설명').toBe(true);

  // 허수아비는 조각 둘이 든다. 올리고 나면 조각이 없어서 다른 유물은 올라가지 않는다.
  const scarecrow = await buyPoint(page, RELICS.scarecrow.name);
  await tapAt(page, scarecrow!.x, scarecrow!.y);
  await expect.poll(async () => (await readMeta(page)).relics, WAIT).toEqual({ claw: 1, scarecrow: 1 });
  expect((await readMeta(page)).shards).toBe(0);
  const dew = await buyPoint(page, RELICS.dew.name);
  await tapAt(page, dew!.x, dew!.y);
  await expect.poll(() => hasText(page, RELICS.dew.blurb), WAIT).toBe(true);
  expect(await readMeta(page)).toMatchObject({ shards: 0, relics: { claw: 1, scarecrow: 1 } });
  expect(await hiddenTexts(page, GARDEN_SCENE), '유물을 올린 유물 화면').toEqual([]);

  // 돌아가면 준비 화면이 그대로 열린다.
  await tapText(page, GARDEN_SCENE, RELIC_BACK);
  await expect.poll(() => hasText(page, INFO_HINT), WAIT).toBe(true);
  expect(await hasText(page, '출발!')).toBe(true);
});

it('텃밭 지키기: 유물이 생기기 전의 저장은 그동안 물리친 대장만큼의 조각을 받고 시작한다', async ({ page }) => {
  // 유물이 없던 버전(3)의 저장: 42일째까지 간 사람
  const { shards: _shards, relics: _relics, ...old } = BASE;
  await openLobby(page, { ...old, version: 3, best: 42, bestEver: 42, runs: 60, startDay: 41, savedAt: Date.now() + 60_000 });
  await expect.poll(() => hasText(page, RELIC_LABEL), WAIT).toBe(true);
  await tapText(page, GARDEN_SCENE, RELIC_LABEL);
  await expect.poll(() => hasText(page, RELIC_HINT), WAIT).toBe(true);
  expect(shardsUpTo(42)).toBe(12);
  expect(await hasText(page, '12'), '가진 유물 조각').toBe(true);
});

it('텃밭 지키기: 대장의 날을 지키면 유물 조각을 받아서 저장하고, 결과 화면에도 적는다', async ({ page }) => {
  // 몇 판 해 본 사람이다. 처음 몇 판에는 조작 안내가 떠서, 곧바로 띄우는 동료 가게와 겹친다.
  await openLobby(page, { ...BASE, runs: 5, savedAt: Date.now() + 60_000 });
  await tapText(page, GARDEN_SCENE, '출발!');
  type Run = { day: number; queue: unknown[]; enemies: unknown[]; shards: number; fence: number };
  const day = (): Promise<number | undefined> =>
    page.evaluate((key) => (window.__pocketArcade?.scene.getScene(key) as unknown as { run: Run | null }).run?.day, GARDEN_SCENE);
  const shards = (): Promise<number | undefined> =>
    page.evaluate((key) => (window.__pocketArcade?.scene.getScene(key) as unknown as { run: Run | null }).run?.shards, GARDEN_SCENE);
  await expect.poll(day, { ...WAIT, message: '판이 시작돼야 한다' }).toBe(1);
  // 첫날 앞의 동료 가게를 닫고 첫날을 시작한다.
  await expect.poll(() => hasText(page, '1일째 시작'), WAIT).toBe(true);
  await tapText(page, GARDEN_SCENE, '1일째 시작');
  await expect.poll(async () => (await lobbyTexts(page)).some((item) => item.text === '동료 가게'), WAIT).toBe(false);

  // 오늘을 대장의 날(5일째)로 바꾸고 나올 벌레를 치워서, 그날을 지킨 것으로 만든다.
  await page.evaluate((key) => {
    const run = (window.__pocketArcade?.scene.getScene(key) as unknown as { run: Run }).run;
    run.day = 5;
    run.queue = [];
    run.enemies = [];
  }, GARDEN_SCENE);
  await expect.poll(shards, { ...WAIT, message: '대장의 날을 지키면 조각을 받는다' }).toBe(1);
  await expect.poll(async () => (await readMeta(page)).shards, { ...WAIT, message: '받은 조각을 바로 저장한다' }).toBe(1);
  // 동료 가게의 맨 위에, 받은 씨앗 옆에 적는다.
  await expect
    .poll(async () => (await lobbyTexts(page)).some((item) => item.text.includes('유물 조각 +1')), { ...WAIT, message: '받은 조각의 알림' })
    .toBe(true);
  expect(await hiddenTexts(page, GARDEN_SCENE), '조각을 받은 날의 동료 가게').toEqual([]);

  // 판을 끝내면 결과 화면에도 적힌다. 조각은 이미 넣어 두었으니 두 번 들어가지 않는다.
  await page.evaluate((key) => {
    (window.__pocketArcade?.scene.getScene(key) as unknown as { run: Run }).run.fence = 0;
  }, GARDEN_SCENE);
  await waitForScene(page, SCENE.result);
  await expect.poll(() => textPoint(page, SCENE.result, '받은 유물 조각'), { ...WAIT, message: '결과 화면의 조각' }).not.toBeNull();
  expect(await textPoint(page, SCENE.result, '1개')).not.toBeNull();
  expect(await hiddenTexts(page, SCENE.result), '결과 화면').toEqual([]);
  expect(await readMeta(page)).toMatchObject({ shards: 1, best: 5, runs: 6 });
});
