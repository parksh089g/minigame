/**
 * 훌라를 친구와 하기: 한 폰으로 번갈아 하면 차례마다 패를 가리고 폰을 넘기게 하는지,
 * 온라인으로는 한 사람이 방을 만들고 다른 사람이 코드로 들어와 서로 둔 수가 보이는지, 나가면 친구가 아는지 본다.
 * 온라인 점검은 두 브라우저(두 기기)를 띄워 실제 서버(wrangler dev)로 한다.
 */
import './app-globals';
import { expect, type Page } from '@playwright/test';
import { HULA_SCENE } from '../src/games/hula/data';
import { collectErrors, hiddenTexts, it, openApp, startScene, tapAt, tapText } from './app';

const WAIT = { timeout: 20_000 } as const;

interface FriendView {
  covered: boolean;
  mode: string;
  state: { turn: 'me' | 'cpu'; phase: string; hands: { me: number[]; cpu: number[] } } | null;
  match: { kind: string; room: { code: string; status: string; seat: number; names: [string, string | null] } } | null;
  points: { hand: Map<number, { x: number; y: number }>; stock: { x: number; y: number } };
}

const look = (page: Page) =>
  page.evaluate((key) => {
    const scene = window.__pocketArcade?.scene.getScene(key) as unknown as FriendView;
    return {
      covered: scene.covered,
      turn: scene.state?.turn ?? null,
      phase: scene.state?.phase ?? null,
      hand: scene.state ? [...scene.state.hands.me] : [],
      foeCards: scene.state?.hands.cpu.length ?? 0,
      status: scene.match?.room.status ?? null,
      seat: scene.match?.room.seat ?? null,
      code: scene.match?.room.code ?? null,
      names: scene.match?.room.names ?? null,
      stock: scene.points.stock,
    };
  }, HULA_SCENE);

const handPoint = (page: Page, card: number) =>
  page.evaluate(([key, c]) => (window.__pocketArcade?.scene.getScene(key) as unknown as FriendView).points.hand.get(c) ?? null, [HULA_SCENE, card] as const);

/** 덱에서 한 장 뽑고 첫 카드를 버린다. */
async function drawAndDiscard(page: Page): Promise<number> {
  const before = await look(page);
  await tapAt(page, before.stock.x, before.stock.y);
  await expect.poll(async () => (await look(page)).phase, WAIT).toBe('play');
  const card = (await look(page)).hand[0];
  const point = await handPoint(page, card);
  await tapAt(page, point!.x, point!.y);
  await tapText(page, HULA_SCENE, '버리기');
  return card;
}

/** 제목이 title인 DOM 창에 글을 넣고 확인을 누른다. 창이 닫힐 때까지 기다린다(바로 다음 창이 뜰 수 있다). */
async function answer(page: Page, title: string, value: string): Promise<void> {
  const dialog = page.locator('dialog', { has: page.getByRole('heading', { name: title }) });
  await expect(dialog).toBeVisible();
  await dialog.locator('.dialog-input').fill(value);
  await dialog.locator('.dialog-primary').click();
  await expect(dialog).toHaveCount(0);
}

it('훌라 한 폰으로: 차례가 바뀔 때마다 패를 가리고, 화면을 누르면 다음 사람의 패가 보인다', async ({ page }) => {
  await openApp(page);
  await startScene(page, HULA_SCENE);
  expect(await hiddenTexts(page, HULA_SCENE), '준비 화면').toEqual([]);
  await tapText(page, HULA_SCENE, '한 폰으로');
  await expect.poll(async () => (await look(page)).covered, WAIT).toBe(true);
  const first = await look(page);
  expect(first.names).toEqual(['1P', '2P']);

  await tapAt(page, 120, 200);
  await expect.poll(async () => (await look(page)).covered, WAIT).toBe(false);
  expect(await hiddenTexts(page, HULA_SCENE), '판 화면').toEqual([]);
  const hand = (await look(page)).hand;

  const card = await drawAndDiscard(page);
  await expect.poll(async () => (await look(page)).covered, WAIT).toBe(true);
  const next = await look(page);
  expect(next.seat).not.toBe(first.seat);
  // 가린 뒤에는 다음 사람의 패가 들려 있고, 앞사람의 패는 뒷면으로만 보인다.
  expect(next.hand).not.toContain(hand.find((c) => c !== card));
  expect(next.foeCards).toBe(7);
  await tapAt(page, 120, 200);
  await expect.poll(async () => (await look(page)).turn, WAIT).toBe('me');
  expect((await look(page)).phase).toBe('draw');
});

it('훌라 온라인: 방을 만들고 코드로 들어온 친구와 서로 둔 수가 보이며, 친구가 나가면 알린다', async ({ page, browser }) => {
  // 친구의 폰
  const context = await browser.newContext({ viewport: page.viewportSize() ?? undefined, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const friend = await context.newPage();
  const friendErrors = collectErrors(friend);

  await openApp(page);
  await startScene(page, HULA_SCENE);
  await tapText(page, HULA_SCENE, '온라인 · 방 코드');
  await tapText(page, HULA_SCENE, '방 만들기');
  await answer(page, '내 이름', '민수');
  await expect.poll(async () => (await look(page)).status, WAIT).toBe('waiting');
  expect(await hiddenTexts(page, HULA_SCENE), '기다리는 화면').toEqual([]);
  const code = (await look(page)).code!;
  expect(code).toMatch(/^[2-9A-Z]{6}$/);

  await openApp(friend);
  await startScene(friend, HULA_SCENE);
  await tapText(friend, HULA_SCENE, '온라인 · 방 코드');
  await tapText(friend, HULA_SCENE, '코드로 들어가기');
  await answer(friend, '방 코드', `${code.slice(0, 3).toLowerCase()}-${code.slice(3)}`);
  await answer(friend, '내 이름', '지원');

  // 두 사람 모두 판이 시작되고, 한 사람만 차례다.
  await expect.poll(async () => (await look(friend)).status, WAIT).toBe('playing');
  await expect.poll(async () => (await look(page)).status, WAIT).toBe('playing');
  expect((await look(page)).names).toEqual(['민수', '지원']);
  const turns = [(await look(page)).turn, (await look(friend)).turn].sort();
  expect(turns).toEqual(['cpu', 'me']);
  expect(await hiddenTexts(page, HULA_SCENE), '판 화면').toEqual([]);

  const [mover, waiter] = (await look(page)).turn === 'me' ? [page, friend] : [friend, page];
  const card = await drawAndDiscard(mover);
  // 기다리던 쪽에 차례가 넘어오고, 버린 카드가 더미 맨 위에 보인다.
  await expect.poll(async () => (await look(waiter)).turn, WAIT).toBe('me');
  const top = await waiter.evaluate((key) => {
    const state = (window.__pocketArcade?.scene.getScene(key) as unknown as { state: { discard: number[] } }).state;
    return state.discard[state.discard.length - 1];
  }, HULA_SCENE);
  expect(top).toBe(card);
  expect((await look(mover)).turn).toBe('cpu');

  // 친구가 판을 하다 나가면(그만하기) 남은 사람에게 알린다.
  await friend.evaluate((key) => window.__pocketArcade?.scene.stop(key), HULA_SCENE);
  await expect.poll(async () => (await look(page)).status, WAIT).toBe('closed');
  await tapText(page, HULA_SCENE, '지원이 나갔어요');

  expect(friendErrors).toEqual([]);
  await context.close();
});
