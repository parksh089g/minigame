/**
 * 배치 점검: 칸이나 줄이 늘어 길어지는 화면에서 글자가 화면 밖으로 나가거나 다른 것에 가리지 않는지,
 * 가장 작은 화면(320×568)과 흔한 화면(390×844)에서 본다. 화면 점검(smoke.e2e.ts)이 오류와 멈춤을 본다면,
 * 이 점검은 오류 없이 어긋나는 배치를 본다.
 */
import './app-globals';
import { expect, test, type Page } from '@playwright/test';
import { SCENE } from '../src/config';
import {
  EVOLVE_LEVEL,
  LANTERN_GAME_ID,
  LANTERN_SCENE,
  MAX_LEVEL,
  WEAPON_ORDER,
  WEAPONS,
  type WeaponId,
} from '../src/games/lantern-keeper/data';
import { iconKey } from '../src/games/lantern-keeper/icons';
import { hiddenTexts, it, openApp, startScene, tapText, textPoint, textsOutsideCards, waitForScene } from './app';

/** 강화권 창과 레벨업 창의 머리글(levelup.ts) */
const TICKET_TITLE = '무기 강화권';
const LEVEL_UP_TITLE = '레벨 업!';

/** 등불지기 장면에서 이 점검이 들여다보는 것 */
interface LanternView {
  phase: string;
  sim?: {
    state: {
      weapons: Record<string, number>;
      pendingTickets: number;
      pendingLevelUps: number;
    };
  };
  pauseGame(): void;
}

/**
 * 등불지기의 판 밖 진행을 앱이 읽기 전에 넣어 둔다. 저장하는 곳과 이름은 meta.ts(DB_NAME, STORE_NAME, KEY)와 같고,
 * 빠진 값은 normalizeMeta가 채워 읽는다. 저장이 읽히지 않으면 잔치의 밤 단추가 없어서 점검이 바로 실패한다.
 */
async function seedLanternMeta(page: Page, meta: object): Promise<void> {
  await page.evaluate(
    (value) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('pocket-arcade-lantern');
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

/**
 * 판 화면의 위쪽에서 HUD가 차지하는 높이(hud.ts의 HUD_HEIGHT). 싸움터를 그리는 view가 이 값을 받아 둔다.
 * hud.ts는 Phaser를 불러오므로 여기서 가져오지 않고, 떠 있는 장면에서 읽는다. 읽지 못하면 점검이 바로 실패한다.
 */
async function hudHeight(page: Page): Promise<number> {
  const top = await page.evaluate((key) => {
    const scene = window.__pocketArcade?.scene.getScene(key) as unknown as { view?: { frame?: { top?: number } } } | null;
    return scene?.view?.frame?.top ?? null;
  }, LANTERN_SCENE);
  if (typeof top !== 'number' || top <= 0) throw new Error('등불지기 HUD의 높이를 읽지 못했다');
  return top;
}

const phaseOf = (page: Page): Promise<string> =>
  page.evaluate((key) => (window.__pocketArcade?.scene.getScene(key) as unknown as LanternView | null)?.phase ?? '', LANTERN_SCENE);

it('등불지기 잔치의 밤: 고르는 창, 강화권 카드 넷~여섯 장(진화 카드 포함), 일시정지 빌드, 레벨업 창이 가려지지 않는다', async ({ page }) => {
  // 판을 하나 끝까지 하는 셈이라 화면 점검 하나보다 오래 걸린다.
  test.slow();
  await openApp(page);
  // 새벽을 한 번 봐서 잔치의 밤을 고를 수 있고, 아직 고르지 않은 저장
  await seedLanternMeta(page, { clears: 1, runs: 1, bestSeconds: 600 });
  await page.reload();
  await waitForScene(page, 'Hub');
  await startScene(page, LANTERN_SCENE);

  // 준비 화면의 잔치의 밤 단추를 눌러 고르는 창을 띄우고, 쉬움을 고른다.
  await tapText(page, LANTERN_SCENE, '잔치의 밤');
  await expect.poll(() => textPoint(page, LANTERN_SCENE, '쉬움'), { message: '고르는 창이 떠야 한다' }).not.toBeNull();
  expect(await hiddenTexts(page, LANTERN_SCENE, { from: '쉬움' }), '고르는 창').toEqual([]);
  expect(await textsOutsideCards(page, LANTERN_SCENE, '쉬움'), '고르는 창의 카드').toEqual([]);
  await tapText(page, LANTERN_SCENE, '쉬움');
  await expect.poll(() => textPoint(page, LANTERN_SCENE, '잔치의 밤 · 쉬움'), { message: '단추에 고른 난이도가 적혀야 한다' }).not.toBeNull();

  await tapText(page, LANTERN_SCENE, '출발!');
  await expect.poll(() => phaseOf(page), { message: '판이 시작되어야 한다' }).toBe('run');

  // 강화권은 가진 무기 가운데 더 올릴 수 있는 것을 모두 카드로 보여 준다. 잔치의 밤에서는 여섯 장까지 된다.
  // 진화 카드는 설명이 길어 두 줄이 되므로, 설명이 가장 긴 무기들로 카드가 가장 높아야 하는 때도 본다.
  const longest = [...WEAPON_ORDER].sort(
    (a, b) => WEAPONS[b].evolved.description.length - WEAPONS[a].evolved.description.length,
  );
  const tickets: Array<{ name: string; weapons: readonly WeaponId[]; level: number }> = [
    { name: '강화권 카드 4장', weapons: WEAPON_ORDER.slice(0, 4), level: 2 },
    { name: '강화권 카드 5장', weapons: WEAPON_ORDER.slice(0, 5), level: 2 },
    { name: '강화권 카드 6장', weapons: WEAPON_ORDER.slice(0, 6), level: 2 },
    { name: '진화 카드 5장', weapons: longest.slice(0, 5), level: MAX_LEVEL },
    { name: '진화 카드 6장', weapons: longest.slice(0, 6), level: MAX_LEVEL },
  ];
  for (const ticket of tickets) {
    await page.evaluate(
      ([key, weapons, level]) => {
        const state = (window.__pocketArcade?.scene.getScene(key) as unknown as LanternView).sim!.state;
        state.weapons = Object.fromEntries(weapons.map((id) => [id, level]));
        state.pendingTickets = 1;
      },
      [LANTERN_SCENE, ticket.weapons, ticket.level] as const,
    );
    await expect.poll(() => textPoint(page, LANTERN_SCENE, TICKET_TITLE), { message: '강화권 창이 떠야 한다' }).not.toBeNull();
    const hidden = await hiddenTexts(page, LANTERN_SCENE, { from: TICKET_TITLE, clearTop: await hudHeight(page) });
    expect(hidden, ticket.name).toEqual([]);
    expect(await textsOutsideCards(page, LANTERN_SCENE, TICKET_TITLE), ticket.name).toEqual([]);
    // 맨 위 카드를 골라 창을 닫는다(모두 같은 레벨이면 도감의 차례). 창이 뜨고 잠깐은 눌리지 않으므로 닫힐 때까지 다시 누른다.
    const first = WEAPON_ORDER.find((id) => ticket.weapons.includes(id))!;
    const firstTitle = ticket.level + 1 >= EVOLVE_LEVEL ? WEAPONS[first].evolved.name : WEAPONS[first].name;
    await expect(async () => {
      await tapText(page, LANTERN_SCENE, firstTitle);
      expect(await textPoint(page, LANTERN_SCENE, TICKET_TITLE)).toBeNull();
    }).toPass({ timeout: 10_000 });
    await expect.poll(() => phaseOf(page)).toBe('run');
  }

  // 무기 여섯을 든 빌드를 일시정지 화면에서 본다.
  await page.evaluate((key) => (window.__pocketArcade?.scene.getScene(key) as unknown as LanternView).pauseGame(), LANTERN_SCENE);
  await waitForScene(page, SCENE.pause);
  await expect.poll(() => textPoint(page, SCENE.pause, '계속하기')).not.toBeNull();
  expect(await hiddenTexts(page, SCENE.pause), '일시정지 빌드').toEqual([]);
  await tapText(page, SCENE.pause, '계속하기');
  await expect.poll(() => phaseOf(page)).toBe('run');

  // 레벨업 창: 카드 셋과 다시 뽑기
  await page.evaluate((key) => {
    (window.__pocketArcade?.scene.getScene(key) as unknown as LanternView).sim!.state.pendingLevelUps = 1;
  }, LANTERN_SCENE);
  await expect.poll(() => textPoint(page, LANTERN_SCENE, LEVEL_UP_TITLE), { message: '레벨업 창이 떠야 한다' }).not.toBeNull();
  const hidden = await hiddenTexts(page, LANTERN_SCENE, { from: LEVEL_UP_TITLE, clearTop: await hudHeight(page) });
  expect(hidden, '레벨업 창').toEqual([]);
  expect(await textsOutsideCards(page, LANTERN_SCENE, LEVEL_UP_TITLE), '레벨업 창의 카드').toEqual([]);
});

it('결과 카드: 기록 일곱 줄과 랭킹 줄에 무기 여섯의 피해 줄까지 가려지지 않고 들어간다', async ({ page }) => {
  // 깊은 밤에서 한 잔치의 밤 판에 도전 과제까지 이룬 판의 결과. 가장 작은 화면에서는 기록 줄을 좁혀야 들어간다.
  await openApp(page);
  // 등불지기를 한 번 열어 무기 아이콘을 만들어 둔다.
  await startScene(page, LANTERN_SCENE);
  await page.evaluate(
    ([key, gameId, icons]) => {
      const game = window.__pocketArcade;
      if (!game) throw new Error('앱이 아직 뜨지 않았다');
      const rows: Array<[string, string]> = [
        ['깊은 밤 3', '점수 ×2.5 · 불씨 ×1.75'],
        ['잔치의 밤', '쉬움 · 점수와 불씨 ×0.6'],
        ['버틴 시간', '12:34'],
        ['쓰러뜨린 그림자', '1234'],
        ['레벨', '31'],
        ['얻은 불씨', '+321'],
        ['도전 과제 달성', '첫 진화'],
      ];
      game.scene.stop(key);
      game.scene.start('Result', {
        title: '등불지기',
        sceneKey: key,
        gameId,
        // 랭킹 줄이 붙는 판(최고 기록이 있다). 오늘의 도전, 업적, 주간 미션은 없다.
        result: {
          score: 1234,
          best: 2345,
          previousBest: 2345,
          isNewBest: false,
          coinsEarned: 3,
          daily: null,
          newAchievements: [],
          newMissions: [],
          lastWeekCoins: 0,
        },
        stats: rows,
        strip: { caption: '무기별 피해 (%)', chips: icons.map((texture, index) => ({ texture, label: String(30 - index * 5) })) },
      });
    },
    [LANTERN_SCENE, LANTERN_GAME_ID, WEAPON_ORDER.slice(0, 6).map((id) => iconKey(id))] as const,
  );
  await waitForScene(page, SCENE.result);
  await expect.poll(() => textPoint(page, SCENE.result, '무기별 피해 (%)'), { message: '피해 줄이 빠지지 않아야 한다' }).not.toBeNull();
  expect(await hiddenTexts(page, SCENE.result), '결과 카드').toEqual([]);
});
