/**
 * 구름 탑 모험의 화면 점검: 출발해서 첫 싸움을 손가락으로 이기고, 카드 보상을 고르고,
 * 앱을 다시 열어도 하던 판을 이어 할 수 있는지 본다. 화면의 글이 가려지지 않는지도 본다.
 */
import './app-globals';
import { expect, type Page } from '@playwright/test';
import { TOWER_SCENE } from '../src/games/cloud-tower/data';
import { CODEX_TEXT } from '../src/games/cloud-tower/text';
import { hiddenTexts, it, openApp, startScene, tapAt, tapText, waitForScene } from './app';

const WAIT = { timeout: 20_000 } as const;

// 화면의 글(cloud-tower/screens.ts, battle-view.ts). 그 파일들은 Phaser를 불러서 여기서 가져올 수 없다.
const START = '출발!';
const FIGHT = '싸움';
const END_TURN = '차례 끝';
const SKIP = '건너뛰기';

interface TowerView {
  run: {
    floor: number;
    stage: string;
    deck: unknown[];
    battle: { result: string | null; mana: number; hand: { id: string }[]; foes: { hp: number; dead: boolean; block: number; st: Record<string, number> }[] } | null;
  } | null;
  battleView: {
    handPoint(index: number): { x: number; y: number } | null;
    foePoint(index: number): { x: number; y: number } | null;
    render(): void;
  } | null;
}

const runOf = (page: Page): Promise<TowerView['run']> =>
  page.evaluate((key) => (window.__pocketArcade?.scene.getScene(key) as unknown as TowerView).run, TOWER_SCENE);

/** 손패에서 공격 카드를 하나 골라 첫 살아 있는 적에게 낸다. */
async function playAttack(page: Page): Promise<void> {
  const target = await page.evaluate((key) => {
    const scene = window.__pocketArcade?.scene.getScene(key) as unknown as TowerView;
    const battle = scene.run?.battle;
    const view = scene.battleView;
    if (!battle || !view) return null;
    const index = battle.hand.findIndex((card) => card.id === 'wand' || card.id === 'popper');
    const foe = battle.foes.findIndex((item) => !item.dead);
    return { card: view.handPoint(Math.max(0, index)), foe: view.foePoint(foe), count: battle.foes.filter((item) => !item.dead).length };
  }, TOWER_SCENE);
  if (!target?.card) throw new Error('낼 카드가 없다');
  await tapAt(page, target.card.x, target.card.y);
  await tapAt(page, target.card.x, target.card.y - 12);
  if (target.count > 1 && target.foe) await tapAt(page, target.foe.x, target.foe.y);
}

it('구름 탑 모험: 출발해서 첫 싸움을 이기고 카드를 고르면 다음 층 갈림길이 나오고, 다시 열어도 이어 한다', async ({ page }) => {
  await openApp(page);
  await startScene(page, TOWER_SCENE);
  await tapText(page, TOWER_SCENE, START);
  await tapText(page, TOWER_SCENE, FIGHT);
  await expect.poll(async () => (await runOf(page))?.stage, WAIT).toBe('battle');
  expect(await hiddenTexts(page, TOWER_SCENE), '싸움 화면').toEqual([]);

  // 적을 약하게 만들어 두고 공격 카드로 이긴다.
  await page.evaluate((key) => {
    const scene = window.__pocketArcade?.scene.getScene(key) as unknown as TowerView;
    for (const foe of scene.run?.battle?.foes ?? []) {
      foe.hp = 1;
      foe.block = 0;
      foe.st = {};
    }
    if (scene.run?.battle) scene.run.battle.mana = 9;
    scene.battleView?.render();
  }, TOWER_SCENE);
  for (let i = 0; i < 4 && (await runOf(page))?.stage === 'battle'; i += 1) {
    await playAttack(page);
    await page.waitForTimeout(200);
  }
  await expect.poll(async () => (await runOf(page))?.stage, WAIT).toBe('reward');
  await waitForScene(page, TOWER_SCENE);
  await tapText(page, TOWER_SCENE, SKIP);
  await expect.poll(async () => (await runOf(page))?.stage, WAIT).toBe('map');
  expect((await runOf(page))?.floor).toBe(1);
  expect(await hiddenTexts(page, TOWER_SCENE), '갈림길').toEqual([]);

  // 앱을 다시 열면 준비 화면에 "이어하기"가 있고, 누르면 갈림길로 돌아온다.
  await page.waitForTimeout(400);
  await openApp(page);
  await startScene(page, TOWER_SCENE);
  await tapText(page, TOWER_SCENE, '이어하기 (1층)');
  await expect.poll(async () => (await runOf(page))?.stage, WAIT).toBe('map');
  expect((await runOf(page))?.deck.length).toBe(10);
});

it('구름 탑 모험: 차례를 마치면 적이 행동하고 다시 내 차례가 온다', async ({ page }) => {
  await openApp(page);
  await startScene(page, TOWER_SCENE);
  await tapText(page, TOWER_SCENE, START);
  await tapText(page, TOWER_SCENE, FIGHT);
  await expect.poll(async () => (await runOf(page))?.stage, WAIT).toBe('battle');
  await tapText(page, TOWER_SCENE, END_TURN);
  await expect
    .poll(() => page.evaluate((key) => (window.__pocketArcade?.scene.getScene(key) as unknown as { run: { battle: { turn: number } } }).run.battle.turn, TOWER_SCENE), WAIT)
    .toBe(2);
  await expect.poll(async () => (await runOf(page))?.battle?.hand.length, WAIT).toBe(5);
});

it('구름 탑 모험: 준비 화면에서 도감을 열고 쪽을 바꿔 보고, 글이 가려지지 않는다', async ({ page }) => {
  await openApp(page);
  await startScene(page, TOWER_SCENE);
  await tapText(page, TOWER_SCENE, CODEX_TEXT.title);
  await waitForScene(page, TOWER_SCENE);
  for (const tab of CODEX_TEXT.tabs) {
    await tapText(page, TOWER_SCENE, tab);
    await waitForScene(page, TOWER_SCENE);
    expect(await hiddenTexts(page, TOWER_SCENE), `도감의 ${tab} 쪽`).toEqual([]);
  }
});
