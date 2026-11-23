/**
 * 블랙잭의 화면 점검: 칩을 걸고 딜해서 히트·스탠드로 몇 판을 오류 없이 하고, 글이 가려지지 않는지 본다.
 * 칩을 다 잃으면 결과 화면으로 넘어가는지도 본다.
 */
import './app-globals';
import { expect, type Page } from '@playwright/test';
import { SCENE } from '../src/config';
import { hiddenTexts, it, openApp, startScene, tapText } from './app';

interface TableView {
  phase: string;
  round: number;
  chips: number;
  bet: number;
  total: number | null;
  /** 카드가 날아가는 중이면 true */
  busy: boolean;
}

const view = (page: Page): Promise<TableView> =>
  page.evaluate((key) => {
    const scene = window.__pocketArcade?.scene.getScene(key) as unknown as {
      busy: boolean;
      table: { phase: string; round: number; seats: { chips: number; bet: number; hands: { cards: { rank: number }[] }[] }[] };
    };
    const seat = scene.table.seats[0];
    const hand = seat.hands[0];
    const total = hand ? hand.cards.reduce((sum, card) => sum + Math.min(10, card.rank), 0) : null;
    return { phase: scene.table.phase, round: scene.table.round, chips: seat.chips, bet: seat.bet, total, busy: scene.busy };
  }, SCENE.blackjack);

it('블랙잭: 칩을 걸고 몇 판을 한다', async ({ page }) => {
  await openApp(page);
  await startScene(page, SCENE.blackjack);
  expect(await hiddenTexts(page, SCENE.blackjack), '베팅 화면').toEqual([]);

  await tapText(page, SCENE.blackjack, '+25');
  await expect.poll(async () => (await view(page)).bet).toBe(35);

  for (let round = 1; round <= 3; round += 1) {
    await expect.poll(async () => (await view(page)).round, { timeout: 10_000 }).toBe(round - 1);
    await tapText(page, SCENE.blackjack, `딜하기 · ${(await view(page)).bet}칩`);
    await expect.poll(async () => (await view(page)).round).toBe(round);
    // 사람 차례면 합이 작을 때 한 장 받고 멈춘다.
    for (let step = 0; step < 10; step += 1) {
      const state = await view(page);
      if (state.phase !== 'playing') break;
      await expect
        .poll(async () => {
          const now = await view(page);
          return !now.busy || now.phase !== 'playing';
        })
        .toBe(true);
      const again = await view(page);
      if (again.phase !== 'playing') break;
      expect(await hiddenTexts(page, SCENE.blackjack), '판').toEqual([]);
      await tapText(page, SCENE.blackjack, (again.total ?? 21) < 12 ? '히트 (한 장 더)' : '스탠드 (멈춤)');
      await page.waitForTimeout(300);
    }
    await expect.poll(async () => (await view(page)).phase, { timeout: 10_000 }).toBe('settled');
  }
});

it('블랙잭: 칩을 다 잃으면 결과 화면이 뜬다', async ({ page }) => {
  await openApp(page);
  await startScene(page, SCENE.blackjack);
  // 칩을 다섯 개로 줄이고(건 칩 10개는 딜할 때 가진 만큼으로 줄어든다), 딜러가 블랙잭인 슈를 넣는다.
  await page.evaluate((key) => {
    const scene = window.__pocketArcade?.scene.getScene(key) as unknown as {
      table: { shoe: { rank: number; suit: string }[]; seats: { chips: number; bet: number }[] };
    };
    scene.table.seats[0].chips = 5;
    const filler = Array.from({ length: 60 }, () => ({ rank: 2, suit: 'club' }));
    // 사람 10, 딜러 A, 사람 9, 딜러 K(뽑는 차례의 거꾸로)
    scene.table.shoe = [...filler, { rank: 13, suit: 'heart' }, { rank: 9, suit: 'spade' }, { rank: 1, suit: 'spade' }, { rank: 10, suit: 'club' }];
  }, SCENE.blackjack);
  await tapText(page, SCENE.blackjack, '딜하기 · 10칩');
  await expect.poll(async () => (await view(page)).chips, { timeout: 10_000 }).toBe(0);
  await expect
    .poll(() => page.evaluate((key) => window.__pocketArcade?.scene.isActive(key) ?? false, SCENE.result), { timeout: 10_000 })
    .toBe(true);
});
