/**
 * 블랙잭을 친구와 하기: 준비 화면에서 혼자 하기와 친구와 함께를 고를 수 있는지,
 * 한 폰으로 두 사람이 차례로 걸고 손을 해서 딜이 정산되는지, 온라인으로 방에 들어온 친구와 같은 탁자를 보는지 본다.
 */
import './app-globals';
import { expect, type Page } from '@playwright/test';
import { SCENE } from '../src/config';
import { collectErrors, hiddenTexts, it, openApp, startScene, tapText } from './app';

const WAIT = { timeout: 20_000 } as const;

const look = (page: Page) =>
  page.evaluate((key) => {
    const scene = window.__pocketArcade?.scene.getScene(key) as unknown as {
      busy: boolean;
      friends: { match: { room: { code: string; status: string; seat: number; names: [string, string | null] } } | null };
      table: { phase: string; round: number; seats: { chips: number; hands: unknown[] }[] };
    };
    const room = scene.friends.match?.room ?? null;
    return {
      status: room?.status ?? null,
      seat: room?.seat ?? null,
      code: room?.code ?? null,
      names: room?.names ?? null,
      phase: scene.table.phase,
      round: scene.table.round,
      hands: scene.table.seats.map((seat) => seat.hands.length),
      busy: scene.busy,
    };
  }, SCENE.blackjack);

async function answer(page: Page, title: string, value: string): Promise<void> {
  const dialog = page.locator('dialog', { has: page.getByRole('heading', { name: title }) });
  await expect(dialog).toBeVisible();
  await dialog.locator('.dialog-input').fill(value);
  await dialog.locator('.dialog-primary').click();
  await expect(dialog).toHaveCount(0);
}

it('블랙잭 한 폰으로: 두 사람이 차례로 걸고 손을 하면 딜러와 정산한다', async ({ page }) => {
  await openApp(page);
  await startScene(page, SCENE.blackjack);
  expect(await hiddenTexts(page, SCENE.blackjack), '준비 화면').toEqual([]);
  await tapText(page, SCENE.blackjack, '친구와 함께');
  await tapText(page, SCENE.blackjack, '한 폰으로 번갈아 하기');
  await expect.poll(async () => (await look(page)).status, WAIT).toBe('playing');
  expect((await look(page)).names).toEqual(['1P', '2P']);
  expect(await hiddenTexts(page, SCENE.blackjack), '거는 화면').toEqual([]);

  // 두 사람이 차례로 건다.
  await tapText(page, SCENE.blackjack, '걸기 · 10칩');
  await expect.poll(async () => (await look(page)).busy, WAIT).toBe(false);
  await tapText(page, SCENE.blackjack, '걸기 · 10칩');
  await expect.poll(async () => (await look(page)).round, WAIT).toBe(1);
  // 나눠 받은 손을 모두 멈추면 정산된다(블랙잭이나 딜러 블랙잭이면 저절로 넘어간다).
  for (let step = 0; step < 6 && (await look(page)).phase === 'playing'; step += 1) {
    await tapText(page, SCENE.blackjack, '스탠드 (멈춤)');
    await expect.poll(async () => (await look(page)).busy, WAIT).toBe(false);
  }
  await expect.poll(async () => (await look(page)).phase, WAIT).toBe('settled');
  expect(await hiddenTexts(page, SCENE.blackjack), '정산한 화면').toEqual([]);
});

it('블랙잭 온라인: 코드로 들어온 친구와 같은 탁자에서 차례로 건다', async ({ page, browser }) => {
  const context = await browser.newContext({ viewport: page.viewportSize() ?? undefined, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const friend = await context.newPage();
  const friendErrors = collectErrors(friend);

  await openApp(page);
  await startScene(page, SCENE.blackjack);
  await tapText(page, SCENE.blackjack, '친구와 함께');
  await tapText(page, SCENE.blackjack, '방 만들기');
  await answer(page, '내 이름', '민수');
  await expect.poll(async () => (await look(page)).status, WAIT).toBe('waiting');
  const code = (await look(page)).code!;

  await openApp(friend);
  await startScene(friend, SCENE.blackjack);
  await tapText(friend, SCENE.blackjack, '친구와 함께');
  await tapText(friend, SCENE.blackjack, '코드로 들어가기');
  await answer(friend, '방 코드', code);
  await answer(friend, '내 이름', '지원');
  await expect.poll(async () => (await look(page)).status, WAIT).toBe('playing');
  await expect.poll(async () => (await look(friend)).status, WAIT).toBe('playing');

  // 먼저 거는 사람을 찾아 걸고, 다른 사람도 건다.
  const first = await page.evaluate((key) => {
    const scene = window.__pocketArcade?.scene.getScene(key) as unknown as { friends: { match: { room: { game: { first: number } } } } };
    return scene.friends.match.room.game.first;
  }, SCENE.blackjack);
  const [a, b] = (await look(page)).seat === first ? [page, friend] : [friend, page];
  await tapText(a, SCENE.blackjack, '걸기 · 10칩');
  await expect.poll(async () => b.evaluate((key) => {
    const scene = window.__pocketArcade?.scene.getScene(key) as unknown as { friends: { myTurn(): boolean } };
    return scene.friends.myTurn();
  }, SCENE.blackjack), WAIT).toBe(true);
  await tapText(b, SCENE.blackjack, '걸기 · 10칩');
  await expect.poll(async () => (await look(page)).round, WAIT).toBe(1);
  await expect.poll(async () => (await look(friend)).round, WAIT).toBe(1);
  expect((await look(page)).hands).toEqual([1, 1]);
  expect(await hiddenTexts(page, SCENE.blackjack), '판 화면').toEqual([]);
  expect(friendErrors).toEqual([]);
  await context.close();
});
