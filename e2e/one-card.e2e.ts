/**
 * 원카드의 화면 점검: 준비 화면의 글이 가려지지 않고, 시작해서 사람 차례에 카드를 손가락으로 내거나 받으며
 * 컴퓨터와 몇 차례를 주고받아도 오류 없이 이어지는지 본다.
 */
import './app-globals';
import { expect, type Page } from '@playwright/test';
import { ONE_CARD_SCENE } from '../src/games/one-card/text';
import { hiddenTexts, it, openApp, startScene, tapAt, tapText } from './app';

interface Card {
  id: number;
  suit: string | null;
  rank: number;
}
interface OneCardView {
  state: {
    turn: number;
    winner: number | null;
    attack: number;
    oneCard: number | null;
    choosingSuit: boolean;
    players: { hand: Card[]; out: boolean }[];
  } | null;
  handPoint(index: number): { x: number; y: number } | null;
}

const view = (page: Page): Promise<{ state: OneCardView['state'] }> =>
  page.evaluate((key) => {
    const scene = window.__pocketArcade?.scene.getScene(key) as unknown as OneCardView;
    return { state: scene.state ? JSON.parse(JSON.stringify(scene.state)) : null };
  }, ONE_CARD_SCENE);

it('원카드: 준비 화면에서 시작해 컴퓨터와 차례를 주고받는다', async ({ page }) => {
  await openApp(page);
  await startScene(page, ONE_CARD_SCENE);
  expect(await hiddenTexts(page, ONE_CARD_SCENE), '준비 화면').toEqual([]);
  await tapText(page, ONE_CARD_SCENE, '3명');
  await tapText(page, ONE_CARD_SCENE, '시작!');
  await expect.poll(async () => (await view(page)).state?.players.length, { timeout: 10_000 }).toBe(4);
  expect(await hiddenTexts(page, ONE_CARD_SCENE), '판').toEqual([]);

  let humanTurns = 0;
  for (let step = 0; step < 60 && humanTurns < 6; step += 1) {
    const { state } = await view(page);
    if (!state || state.winner !== null) break;
    if (state.oneCard !== null) {
      await tapText(page, ONE_CARD_SCENE, '원카드!');
      await page.waitForTimeout(300);
      continue;
    }
    if (state.turn !== 0) {
      await page.waitForTimeout(400);
      continue;
    }
    if (state.choosingSuit) {
      await tapText(page, ONE_CARD_SCENE, '하트');
      await page.waitForTimeout(300);
      continue;
    }
    // 낼 수 있는 카드를 찾아 두 번 누르고, 없으면 받는다.
    const before = state.players[0].hand.length;
    let played = false;
    for (let i = 0; i < before && !played; i += 1) {
      const point = await page.evaluate(([key, n]) => (window.__pocketArcade?.scene.getScene(key) as unknown as OneCardView).handPoint(n), [ONE_CARD_SCENE, i] as const);
      if (!point) continue;
      await tapAt(page, point.x, point.y);
      await page.waitForTimeout(80);
      const message = await page.evaluate((key) => {
        const scene = window.__pocketArcade?.scene.getScene(key) as unknown as { message: { text: string } };
        return scene.message.text;
      }, ONE_CARD_SCENE);
      if (message.includes('한 번 더 누르면')) {
        const again = await page.evaluate(([key, n]) => (window.__pocketArcade?.scene.getScene(key) as unknown as OneCardView).handPoint(n), [ONE_CARD_SCENE, i] as const);
        await tapAt(page, again!.x, again!.y);
        played = true;
      }
    }
    if (!played) await tapText(page, ONE_CARD_SCENE, state.attack > 0 ? `${state.attack}장 받기` : '카드 받기');
    humanTurns += 1;
    await page.waitForTimeout(500);
  }
  expect(humanTurns).toBeGreaterThan(0);
});
