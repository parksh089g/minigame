/**
 * 오목의 화면 점검: 컴퓨터와 둘 때 점을 두 번 눌러 돌을 놓고 컴퓨터가 받아 두는지, 무르기와 끝난 판의 결과 화면,
 * 한 폰으로 번갈아 하기와 "한 판 더", 온라인 방에서 친구가 둔 수가 보이는지(실제 서버 wrangler dev로) 본다.
 */
import './app-globals';
import { expect, type Page } from '@playwright/test';
import { OMOK_SCENE } from '../src/games/omok/text';
import { collectErrors, hiddenTexts, it, openApp, startScene, tapAt, tapText } from './app';

const WAIT = { timeout: 20_000 } as const;

interface SceneView {
  state: { moves: number[]; board: number[]; winner: number | null } | null;
  mine: number;
  cursor: number | null;
  pointPosition(point: number): { x: number; y: number };
  friends: { match: { room: { code: string; status: string; seat: number; wins: [number, number] } } | null };
}

const look = (page: Page) =>
  page.evaluate((key) => {
    const scene = window.__pocketArcade?.scene.getScene(key) as unknown as SceneView;
    const room = scene.friends.match?.room ?? null;
    return {
      moves: scene.state ? scene.state.moves.slice() : [],
      winner: scene.state?.winner ?? null,
      mine: scene.mine,
      cursor: scene.cursor,
      status: room?.status ?? null,
      code: room?.code ?? null,
      seat: room?.seat ?? null,
      wins: room?.wins ?? null,
    };
  }, OMOK_SCENE);

const at = (x: number, y: number): number => y * 15 + x;

/** 판의 점을 누른다. */
async function tapPoint(page: Page, point: number): Promise<void> {
  const spot = await page.evaluate(
    ([key, p]) => (window.__pocketArcade?.scene.getScene(key) as unknown as SceneView).pointPosition(p),
    [OMOK_SCENE, point] as const,
  );
  await tapAt(page, spot.x, spot.y);
}

async function answer(page: Page, title: string, value: string): Promise<void> {
  const dialog = page.locator('dialog', { has: page.getByRole('heading', { name: title }) });
  await expect(dialog).toBeVisible();
  await dialog.locator('.dialog-input').fill(value);
  await dialog.locator('.dialog-primary').click();
  await expect(dialog).toHaveCount(0);
}

it('오목: 점을 두 번 눌러 두면 컴퓨터가 받아 두고, 무르기로 되돌린다', async ({ page }) => {
  await openApp(page);
  await startScene(page, OMOK_SCENE);
  expect(await hiddenTexts(page, OMOK_SCENE), '준비 화면').toEqual([]);
  await tapText(page, OMOK_SCENE, '어려움');
  await tapText(page, OMOK_SCENE, '흑 · 먼저');
  await tapText(page, OMOK_SCENE, '컴퓨터와 시작');
  await expect.poll(async () => (await look(page)).mine, WAIT).toBe(1);
  expect(await hiddenTexts(page, OMOK_SCENE), '판').toEqual([]);

  // 한 번 누르면 미리 보기만 하고, 같은 점을 다시 누르면 놓는다.
  await tapPoint(page, at(7, 7));
  await expect.poll(async () => (await look(page)).cursor, WAIT).toBe(at(7, 7));
  expect((await look(page)).moves).toEqual([]);
  await tapPoint(page, at(7, 7));
  await expect.poll(async () => (await look(page)).moves.length, WAIT).toBe(2);
  expect((await look(page)).moves[0]).toBe(at(7, 7));

  // 두기 버튼으로도 놓는다.
  const free = (await look(page)).moves.includes(at(6, 6)) ? at(8, 8) : at(6, 6);
  await tapPoint(page, free);
  await tapText(page, OMOK_SCENE, '여기에 두기');
  await expect.poll(async () => (await look(page)).moves.length, WAIT).toBe(4);

  await tapText(page, OMOK_SCENE, '무르기 3');
  await expect.poll(async () => (await look(page)).moves.length, WAIT).toBe(2);
  await expect.poll(async () => page.evaluate((key) => {
    const scene = window.__pocketArcade?.scene.getScene(key) as unknown as { undoButton: { label: { text: string } } };
    return scene.undoButton.label.text;
  }, OMOK_SCENE), WAIT).toBe('무르기 2');
});

it('오목: 다섯을 이으면 이긴 판으로 결과 화면이 뜬다', async ({ page }) => {
  await openApp(page);
  await startScene(page, OMOK_SCENE, { quick: true });
  await expect.poll(async () => (await look(page)).mine, WAIT).toBe(1);
  // 흑 넷이 한 줄로 놓이고 백은 멀리 떨어진 판을 만들어 둔다.
  await page.evaluate((key) => {
    const scene = window.__pocketArcade?.scene.getScene(key) as unknown as SceneView;
    const state = scene.state!;
    const black = [0, 1, 2, 3].map((x) => 7 * 15 + 3 + x);
    const white = [0, 2, 4, 6].map((x) => 14 * 15 + x);
    for (let i = 0; i < 4; i += 1) {
      state.board[black[i]] = 1;
      state.moves.push(black[i]);
      state.board[white[i]] = 2;
      state.moves.push(white[i]);
    }
  }, OMOK_SCENE);
  await tapPoint(page, at(7, 7));
  await tapPoint(page, at(7, 7));
  await expect.poll(async () => (await look(page)).winner, WAIT).toBe(1);
  await page.waitForFunction(() => window.__pocketArcade?.scene.isActive('Result') ?? false, undefined, WAIT);
});

it('오목 한 폰으로: 판을 가리지 않고 번갈아 두고, 이긴 뒤 한 판 더는 흑백을 바꾼다', async ({ page }) => {
  await openApp(page);
  await startScene(page, OMOK_SCENE);
  await tapText(page, OMOK_SCENE, '친구와 함께');
  await tapText(page, OMOK_SCENE, '한 폰으로 번갈아 하기');
  await expect.poll(async () => (await look(page)).status, WAIT).toBe('playing');
  expect(await hiddenTexts(page, OMOK_SCENE), '판').toEqual([]);
  const firstSeat = (await look(page)).seat;
  expect((await look(page)).mine).toBe(1);

  // 흑은 맨 윗줄, 백은 여섯째 줄에 둔다. 흑이 다섯째를 두면 이긴다.
  for (let i = 0; i < 9; i += 1) {
    const point = i % 2 === 0 ? at(i / 2, 0) : at((i - 1) / 2, 5);
    await tapPoint(page, point);
    await tapPoint(page, point);
    await expect.poll(async () => (await look(page)).moves.length, WAIT).toBe(i + 1);
  }
  await expect.poll(async () => (await look(page)).status, WAIT).toBe('over');
  expect((await look(page)).wins?.[firstSeat!]).toBe(1);
  await tapText(page, OMOK_SCENE, '한 판 더');
  await expect.poll(async () => (await look(page)).moves.length, WAIT).toBe(0);
  await expect.poll(async () => (await look(page)).status, WAIT).toBe('playing');
  // 지난 판에 백을 쥔 자리가 이번에는 흑으로 먼저 둔다.
  expect((await look(page)).seat).not.toBe(firstSeat);
  expect((await look(page)).mine).toBe(1);
});

it('오목 온라인: 방을 만들고 코드로 들어온 친구와 서로 둔 수가 보인다', async ({ page, browser }) => {
  const context = await browser.newContext({ viewport: page.viewportSize() ?? undefined, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const friend = await context.newPage();
  const friendErrors = collectErrors(friend);

  await openApp(page);
  await startScene(page, OMOK_SCENE);
  await tapText(page, OMOK_SCENE, '친구와 함께');
  await tapText(page, OMOK_SCENE, '방 만들기');
  await answer(page, '내 이름', '민수');
  await expect.poll(async () => (await look(page)).status, WAIT).toBe('waiting');
  const code = (await look(page)).code!;

  await openApp(friend);
  await startScene(friend, OMOK_SCENE);
  await tapText(friend, OMOK_SCENE, '친구와 함께');
  await tapText(friend, OMOK_SCENE, '코드로 들어가기');
  await answer(friend, '방 코드', code);
  await answer(friend, '내 이름', '지원');

  await expect.poll(async () => (await look(friend)).status, WAIT).toBe('playing');
  await expect.poll(async () => (await look(page)).status, WAIT).toBe('playing');
  expect([(await look(page)).mine, (await look(friend)).mine].sort()).toEqual([1, 2]);
  expect(await hiddenTexts(page, OMOK_SCENE), '판 화면').toEqual([]);

  const [black, white] = (await look(page)).mine === 1 ? [page, friend] : [friend, page];
  await tapPoint(black, at(7, 7));
  await tapPoint(black, at(7, 7));
  await expect.poll(async () => (await look(white)).moves, WAIT).toEqual([at(7, 7)]);
  await tapPoint(white, at(8, 8));
  await tapPoint(white, at(8, 8));
  await expect.poll(async () => (await look(black)).moves, WAIT).toEqual([at(7, 7), at(8, 8)]);

  await friend.evaluate((key) => window.__pocketArcade?.scene.stop(key), OMOK_SCENE);
  await expect.poll(async () => (await look(page)).status, WAIT).toBe('closed');
  expect(friendErrors).toEqual([]);
  await context.close();
});
