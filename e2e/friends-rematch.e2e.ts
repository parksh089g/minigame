/**
 * 친구와 다시 하자와 친구 전적: 친구가 방에서 나가 방이 닫혀도, 같은 방 코드로 서로 다시 불러 새 판을 시작하는지,
 * 친구마다의 전적이 결과와 친구와 함께 화면에 보이는지 본다(실제 서버 wrangler dev로, 원카드로 본다).
 * 공용 친구와 하기(FriendsKit)를 쓰는 게임은 모두 같은 화면을 쓴다.
 */
import './app-globals';
import { expect, type Page } from '@playwright/test';
import { HULA_SCENE } from '../src/games/hula/data';
import { ONE_CARD_SCENE } from '../src/games/one-card/text';
import { collectErrors, hiddenTexts, it, openApp, startScene, tapText, textPoint } from './app';

const WAIT = { timeout: 20_000 } as const;
const SHOTS = process.env.REMATCH_SHOTS;

const look = (page: Page) =>
  page.evaluate((key) => {
    const scene = window.__pocketArcade?.scene.getScene(key) as unknown as {
      friends: {
        screenMode: string;
        match: { room: { code: string; status: string; rematch: boolean; again: [boolean, boolean]; ids: [string | null, string | null] } } | null;
      };
    };
    const room = scene.friends.match?.room ?? null;
    return { status: room?.status ?? null, rematch: room?.rematch ?? null, code: room?.code ?? null, ids: room?.ids ?? null, mode: scene.friends.screenMode };
  }, ONE_CARD_SCENE);

const friendsOf = (page: Page) =>
  page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('pocket-arcade:friends') ?? '{}') as { friends?: Record<string, { name: string; games: Record<string, { wins: number; losses: number }> }> };
    return Object.values(saved.friends ?? {}).map((friend) => [friend.name, friend.games['one-card']]);
  });

async function answer(page: Page, title: string, value: string): Promise<void> {
  const dialog = page.locator('dialog', { has: page.getByRole('heading', { name: title }) });
  await expect(dialog).toBeVisible();
  await dialog.locator('.dialog-input').fill(value);
  await dialog.locator('.dialog-primary').click();
  await expect(dialog).toHaveCount(0);
}

it('친구가 나가도 "다시 하자"로 같은 방에서 다시 시작하고, 친구마다 전적이 쌓인다', async ({ page, browser }) => {
  it.setTimeout(90_000);
  const context = await browser.newContext({ viewport: page.viewportSize() ?? undefined, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const friend = await context.newPage();
  const friendErrors = collectErrors(friend);

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
  // 두 기기가 서로 다른 친구 표를 보낸다.
  const ids = (await look(page)).ids!;
  expect(ids[0]).toMatch(/^[0-9a-f]{16}$/);
  expect(ids[1]).toMatch(/^[0-9a-f]{16}$/);
  expect(ids[0]).not.toBe(ids[1]);

  // 친구가 판을 하다 방에서 나간다: 친구는 친구와 함께 화면으로, 나는 "다시 하자"가 있는 알림을 본다.
  await friend.evaluate((key) => (window.__pocketArcade?.scene.getScene(key) as unknown as { friends: { exit(): void } }).friends.exit(), ONE_CARD_SCENE);
  await expect.poll(async () => (await look(page)).status, WAIT).toBe('closed');
  await expect.poll(() => textPoint(page, ONE_CARD_SCENE, '다시 하자'), WAIT).not.toBeNull();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/1-host-closed.png` });
  expect(await friendsOf(page)).toEqual([['지원', { wins: 1, losses: 0 }]]);

  await expect.poll(async () => (await look(friend)).mode, WAIT).toBe('menu');
  await expect.poll(() => textPoint(friend, ONE_CARD_SCENE, '민수와 한 판 더'), WAIT).not.toBeNull();
  await expect.poll(() => textPoint(friend, ONE_CARD_SCENE, '친구 전적'), WAIT).not.toBeNull();
  expect(await textPoint(friend, ONE_CARD_SCENE, '0승 1패')).not.toBeNull();
  expect(await hiddenTexts(friend, ONE_CARD_SCENE), '친구와 함께 화면').toEqual([]);
  if (SHOTS) await friend.screenshot({ path: `${SHOTS}/2-friend-menu.png` });

  // 내가 "다시 하자"를 누르면 같은 방이 다시 열리고, 친구 화면에 알림이 뜬다.
  await tapText(page, ONE_CARD_SCENE, '다시 하자');
  await expect.poll(async () => (await look(page)).rematch, WAIT).toBe(true);
  await expect.poll(() => textPoint(page, ONE_CARD_SCENE, '지원이 한 판 더를 누르면 시작해요'), WAIT).not.toBeNull();
  expect(await hiddenTexts(page, ONE_CARD_SCENE), '다시 하자 기다리기').toEqual([]);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/3-host-waiting.png` });
  await expect.poll(() => textPoint(friend, ONE_CARD_SCENE, '민수가 한 판 더 하재요!'), WAIT).not.toBeNull();
  if (SHOTS) await friend.screenshot({ path: `${SHOTS}/4-friend-invited.png` });

  // 친구가 누르면 코드 없이 같은 방에서 새 판이 시작된다.
  await tapText(friend, ONE_CARD_SCENE, '민수가 한 판 더 하재요!');
  await expect.poll(async () => (await look(friend)).status, WAIT).toBe('playing');
  await expect.poll(async () => (await look(page)).status, WAIT).toBe('playing');
  expect((await look(friend)).code).toBe(code);
  expect(await hiddenTexts(page, ONE_CARD_SCENE), '새 판').toEqual([]);
  expect(friendErrors).toEqual([]);
  await context.close();
});

const hulaRoom = (page: Page) =>
  page.evaluate((key) => {
    const scene = window.__pocketArcade?.scene.getScene(key) as unknown as { mode: string; match: { room: { code: string; status: string; rematch: boolean } } | null };
    return { status: scene.match?.room.status ?? null, rematch: scene.match?.room.rematch ?? null, code: scene.match?.room.code ?? null, mode: scene.mode };
  }, HULA_SCENE);

it('훌라: 나간 친구가 먼저 "한 판 더"로 부르면, 남아 있던 사람에게 다시 하자 화면이 뜨고 같은 방에서 시작한다', async ({ page, browser }) => {
  it.setTimeout(90_000);
  const context = await browser.newContext({ viewport: page.viewportSize() ?? undefined, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const friend = await context.newPage();
  const friendErrors = collectErrors(friend);

  await openApp(page);
  await startScene(page, HULA_SCENE);
  await tapText(page, HULA_SCENE, '온라인 · 방 코드');
  await tapText(page, HULA_SCENE, '방 만들기');
  await answer(page, '내 이름', '민수');
  await expect.poll(async () => (await hulaRoom(page)).status, WAIT).toBe('waiting');
  const code = (await hulaRoom(page)).code!;

  await openApp(friend);
  await startScene(friend, HULA_SCENE);
  await tapText(friend, HULA_SCENE, '온라인 · 방 코드');
  await tapText(friend, HULA_SCENE, '코드로 들어가기');
  await answer(friend, '방 코드', code);
  await answer(friend, '내 이름', '지원');
  await expect.poll(async () => (await hulaRoom(page)).status, WAIT).toBe('playing');

  await friend.evaluate((key) => (window.__pocketArcade?.scene.getScene(key) as unknown as { exitFriends(): void }).exitFriends(), HULA_SCENE);
  await expect.poll(async () => (await hulaRoom(page)).status, WAIT).toBe('closed');
  await expect.poll(async () => (await hulaRoom(friend)).mode, WAIT).toBe('friends');
  await expect.poll(() => textPoint(friend, HULA_SCENE, '민수와 한 판 더'), WAIT).not.toBeNull();
  expect(await textPoint(friend, HULA_SCENE, '친구 전적')).not.toBeNull();
  expect(await hiddenTexts(friend, HULA_SCENE), '친구와 온라인 화면').toEqual([]);
  if (SHOTS) await friend.screenshot({ path: `${SHOTS}/5-hula-friend-menu.png` });

  // 나갔던 친구가 먼저 부른다. 닫힌 방 알림을 보던 나에게 다시 하자 화면이 뜬다.
  await tapText(friend, HULA_SCENE, '민수와 한 판 더');
  await expect.poll(async () => (await hulaRoom(friend)).rematch, WAIT).toBe(true);
  await expect.poll(async () => (await hulaRoom(page)).rematch, WAIT).toBe(true);
  await expect.poll(() => textPoint(page, HULA_SCENE, '지원이 다시 하재요!'), WAIT).not.toBeNull();
  expect(await hiddenTexts(page, HULA_SCENE), '다시 하자 화면').toEqual([]);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/6-hula-host-invited.png` });
  await tapText(page, HULA_SCENE, '한 판 더');
  await expect.poll(async () => (await hulaRoom(page)).status, WAIT).toBe('playing');
  await expect.poll(async () => (await hulaRoom(friend)).status, WAIT).toBe('playing');
  expect((await hulaRoom(page)).code).toBe(code);
  expect(friendErrors).toEqual([]);
  await context.close();
});
