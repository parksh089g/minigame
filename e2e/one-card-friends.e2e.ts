/**
 * 원카드를 친구와 하기: 한 폰으로 번갈아 하면 차례마다 패를 가리고 폰을 넘기게 하는지,
 * 온라인으로는 방을 만들고 코드로 들어온 친구와 서로 둔 수가 보이는지 본다(실제 서버 wrangler dev로).
 */
import './app-globals';
import { expect, type Page } from '@playwright/test';
import { ONE_CARD_SCENE } from '../src/games/one-card/text';
import { collectErrors, hiddenTexts, it, openApp, startScene, tapAt, tapText, textPoint } from './app';

const WAIT = { timeout: 20_000 } as const;

interface SceneView {
  friends: { covered: boolean; match: { room: { code: string; status: string; seat: number; names: [string, string | null] } } | null };
  state: { turn: number; oneCard: number | null; choosingSuit: boolean; discard: { id: number }[]; players: { hand: { id: number }[] }[] } | null;
  handPoint(index: number): { x: number; y: number } | null;
}

const look = (page: Page) =>
  page.evaluate((key) => {
    const scene = window.__pocketArcade?.scene.getScene(key) as unknown as SceneView;
    const state = scene.state;
    return {
      covered: scene.friends.covered,
      status: scene.friends.match?.room.status ?? null,
      seat: scene.friends.match?.room.seat ?? null,
      code: scene.friends.match?.room.code ?? null,
      names: scene.friends.match?.room.names ?? null,
      turn: state?.turn ?? null,
      hand: state ? state.players[0].hand.map((card) => card.id) : [],
      foeCards: state?.players[1].hand.length ?? 0,
      top: state ? state.discard[state.discard.length - 1].id : null,
    };
  }, ONE_CARD_SCENE);

async function answer(page: Page, title: string, value: string): Promise<void> {
  const dialog = page.locator('dialog', { has: page.getByRole('heading', { name: title }) });
  await expect(dialog).toBeVisible();
  await dialog.locator('.dialog-input').fill(value);
  await dialog.locator('.dialog-primary').click();
  await expect(dialog).toHaveCount(0);
}

it('원카드 한 폰으로: 차례가 바뀔 때마다 패를 가리고, 화면을 누르면 다음 사람의 패가 보인다', async ({ page }) => {
  await openApp(page);
  await startScene(page, ONE_CARD_SCENE);
  await tapText(page, ONE_CARD_SCENE, '친구와 함께');
  expect(await hiddenTexts(page, ONE_CARD_SCENE), '친구와 함께 화면').toEqual([]);
  await tapText(page, ONE_CARD_SCENE, '한 폰으로 번갈아 하기');
  await expect.poll(async () => (await look(page)).covered, WAIT).toBe(true);
  const first = await look(page);
  expect(first.names).toEqual(['1P', '2P']);
  await tapAt(page, 120, 200);
  await expect.poll(async () => (await look(page)).covered, WAIT).toBe(false);
  expect(await hiddenTexts(page, ONE_CARD_SCENE), '판 화면').toEqual([]);
  expect((await look(page)).foeCards).toBe(7);

  // 카드를 받아 차례를 넘긴다.
  await tapText(page, ONE_CARD_SCENE, '카드 받기');
  await expect.poll(async () => (await look(page)).covered, WAIT).toBe(true);
  const next = await look(page);
  expect(next.seat).not.toBe(first.seat);
  expect(next.foeCards).toBe(8);
  await tapAt(page, 120, 200);
  await expect.poll(async () => (await look(page)).covered, WAIT).toBe(false);
  expect((await look(page)).turn).toBe(0);
});

it('원카드 온라인: 방을 만들고 코드로 들어온 친구와 서로 둔 수가 보인다', async ({ page, browser }) => {
  const context = await browser.newContext({ viewport: page.viewportSize() ?? undefined, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const friend = await context.newPage();
  const friendErrors = collectErrors(friend);

  await openApp(page);
  await startScene(page, ONE_CARD_SCENE);
  await tapText(page, ONE_CARD_SCENE, '친구와 함께');
  await tapText(page, ONE_CARD_SCENE, '방 만들기');
  await answer(page, '내 이름', '민수');
  await expect.poll(async () => (await look(page)).status, WAIT).toBe('waiting');
  expect(await hiddenTexts(page, ONE_CARD_SCENE), '기다리는 화면').toEqual([]);
  const code = (await look(page)).code!;

  await openApp(friend);
  await startScene(friend, ONE_CARD_SCENE);
  await tapText(friend, ONE_CARD_SCENE, '친구와 함께');
  await tapText(friend, ONE_CARD_SCENE, '코드로 들어가기');
  await answer(friend, '방 코드', code);
  await answer(friend, '내 이름', '지원');

  await expect.poll(async () => (await look(friend)).status, WAIT).toBe('playing');
  await expect.poll(async () => (await look(page)).status, WAIT).toBe('playing');
  expect((await look(page)).names).toEqual(['민수', '지원']);
  expect([(await look(page)).turn, (await look(friend)).turn].sort()).toEqual([0, 1]);
  expect(await hiddenTexts(page, ONE_CARD_SCENE), '판 화면').toEqual([]);

  const [mover, waiter] = (await look(page)).turn === 0 ? [page, friend] : [friend, page];
  const before = (await look(waiter)).foeCards;
  await tapText(mover, ONE_CARD_SCENE, '카드 받기');
  await expect.poll(async () => (await look(waiter)).turn, WAIT).toBe(0);
  expect((await look(waiter)).foeCards).toBe(before + 1);

  await friend.evaluate((key) => window.__pocketArcade?.scene.stop(key), ONE_CARD_SCENE);
  await expect.poll(async () => (await look(page)).status, WAIT).toBe('closed');
  await tapText(page, ONE_CARD_SCENE, '지원이 나갔어요');
  expect(friendErrors).toEqual([]);
  await context.close();
});

it('원카드 온라인: 친구가 앱을 닫으면 남은 시간을 보여 주고, 시간이 지나면 내가 이긴 것으로 방이 닫힌다', async ({ page, browser }) => {
  // 서버가 자리를 비운 것으로 보기까지 20초, 판을 버린 것으로 치기까지 60초를 실제로 기다린다.
  it.setTimeout(150_000);
  const context = await browser.newContext({ viewport: page.viewportSize() ?? undefined, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const friend = await context.newPage();

  await openApp(page);
  await startScene(page, ONE_CARD_SCENE);
  await tapText(page, ONE_CARD_SCENE, '친구와 함께');
  await tapText(page, ONE_CARD_SCENE, '방 만들기');
  await answer(page, '내 이름', '민수');
  await expect.poll(async () => (await look(page)).status, WAIT).toBe('waiting');
  const code = (await look(page)).code!;

  await openApp(friend);
  await startScene(friend, ONE_CARD_SCENE);
  await tapText(friend, ONE_CARD_SCENE, '친구와 함께');
  await tapText(friend, ONE_CARD_SCENE, '코드로 들어가기');
  await answer(friend, '방 코드', code);
  await answer(friend, '내 이름', '지원');
  await expect.poll(async () => (await look(page)).status, WAIT).toBe('playing');

  // 친구가 "나가기" 없이 앱을 닫는다(서버에 아무것도 보내지 않는다).
  await context.close();
  await expect.poll(() => textPoint(page, ONE_CARD_SCENE, '지원이 자리를 비웠어요'), { timeout: 40_000 }).not.toBeNull();
  expect(await hiddenTexts(page, ONE_CARD_SCENE), '자리를 비웠다는 띠').toEqual([]);
  expect(await page.evaluate((key) => (window.__pocketArcade?.scene.getScene(key) as unknown as { friends: { quitWarning(): string | null } }).friends.quitWarning(), ONE_CARD_SCENE)).toContain(
    '내가 이긴 판',
  );
  await expect.poll(async () => (await look(page)).status, { timeout: 70_000 }).toBe('closed');
  await tapText(page, ONE_CARD_SCENE, '지원이 돌아오지 않았어요');
  expect(await textPoint(page, ONE_CARD_SCENE, '지원이 자리를 비웠어요')).toBeNull();
});
