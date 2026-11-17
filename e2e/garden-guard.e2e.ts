/**
 * 텃밭 지키기의 화면 점검 가운데 준비 화면의 저장과 사고팔기를 본다:
 * 띄워 둔 사이에 다른 곳이 저장한 진행을 덮어쓰지 않는지, 살 수 없는 강화와 큰 값이 어떻게 적히는지,
 * 망가진 저장으로도 열리는지. 배치와 판의 흐름은 layout.e2e.ts와 smoke.e2e.ts가 본다.
 */
import './app-globals';
import { expect, type Page } from '@playwright/test';
import { GAME_WIDTH } from '../src/config';
import { GARDEN_SCENE, UPGRADES } from '../src/games/garden-guard/data';
import { costLabel, MAX_DAY, META_VERSION, needLine, upgradeCost, type GardenMeta } from '../src/games/garden-guard/rules';
import { hiddenTexts, it, openApp, startScene, tapAt, textPoint } from './app';

const WAIT = { timeout: 20_000 } as const;

// 준비 화면의 글(garden-guard/lobby.ts). lobby.ts는 Phaser를 불러서 여기서 가져올 수 없다.
const INFO_HINT = '강화를 누르면 설명이 보여요';
const START_DAY_INFO = '고른 날부터 시작해요.\n대장을 물리치면 그다음 날이 열려요.';
const exactCost = (cost: number): string => `값은 씨앗 ${cost.toLocaleString('en-US')}개예요`;

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

it('텃밭 지키기: 해바라기 없이는 거름을 팔지 않고, 큰 값은 줄여 적어 버튼 안에 넣고, 설명 칸의 두 줄에 위아래 틈이 있다', async ({
  page,
}) => {
  // 거름의 값(80)은 넘고 해바라기의 값(150)에는 모자란 씨앗.
  await openLobby(page, { ...BASE, seeds: 120 });
  const need = needLine('helper');
  await expect(async () => {
    if (!(await hasText(page, UPGRADES.compost.name))) await nextPage(page);
    expect(await hasText(page, UPGRADES.compost.name)).toBe(true);
  }).toPass(WAIT);
  expect(await hasText(page, need), '효과 대신 조건을 적는다').toBe(true);
  expect(await hiddenTexts(page, GARDEN_SCENE), '거름이 있는 쪽').toEqual([]);
  const compost = await buyPoint(page, UPGRADES.compost.name);
  if (!compost) throw new Error('거름의 줄이 없다');
  await tapAt(page, compost.x, compost.y);
  // 누르면 설명은 보이지만 사지지는 않는다.
  await expect.poll(() => hasText(page, UPGRADES.compost.blurb), WAIT).toBe(true);
  expect(await readMeta(page)).toMatchObject({ seeds: 120, levels: {} });

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
