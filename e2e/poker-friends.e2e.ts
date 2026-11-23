/**
 * 포커를 친구와 하기: 준비 화면에서 혼자 하기와 친구와 함께를 고를 수 있는지,
 * 한 폰으로 하면 컴퓨터 수를 고른 뒤 차례마다 패를 가리고 폰을 넘기게 하는지,
 * 온라인으로는 코드로 들어온 친구와 같은 탁자(컴퓨터 둘과 넷이서)를 보는지 본다(실제 서버 wrangler dev로).
 */
import './app-globals';
import { expect, type Page } from '@playwright/test';
import { SCENE } from '../src/config';
import { collectErrors, hiddenTexts, it, openApp, startScene, tapAt, tapText } from './app';

const WAIT = { timeout: 20_000 } as const;

const look = (page: Page) =>
  page.evaluate((key) => {
    const scene = window.__pocketArcade?.scene.getScene(key) as unknown as {
      busy: boolean;
      friends: {
        covered: boolean;
        myTurn(): boolean;
        match: { room: { code: string; status: string; seat: number; names: [string, string | null]; game: { table: unknown; moves: number } | null } } | null;
      };
      table: { phase: string; handNo: number; toAct: number | null; currentBet: number; seats: { name: string; bet: number; hole: { rank: number }[] }[] };
      seatName(index: number): string;
    };
    const room = scene.friends.match?.room ?? null;
    const me = scene.table.seats[0];
    return {
      covered: scene.friends.covered,
      status: room?.status ?? null,
      seat: room?.seat ?? null,
      code: room?.code ?? null,
      names: room?.names ?? null,
      started: !!room?.game?.table,
      moves: room?.game?.moves ?? -1,
      myTurn: scene.friends.myTurn(),
      phase: scene.table.phase,
      handNo: scene.table.handNo,
      seats: scene.table.seats.map((_, index) => scene.seatName(index)),
      call: Math.max(0, scene.table.currentBet - me.bet),
      myCards: me.hole.map((card) => card.rank),
      otherCards: scene.table.seats.slice(1).flatMap((seat) => seat.hole.map((card) => card.rank)),
      busy: scene.busy,
    };
  }, SCENE.poker);

async function answer(page: Page, title: string, value: string): Promise<void> {
  const dialog = page.locator('dialog', { has: page.getByRole('heading', { name: title }) });
  await expect(dialog).toBeVisible();
  await dialog.locator('.dialog-input').fill(value);
  await dialog.locator('.dialog-primary').click();
  await expect(dialog).toHaveCount(0);
}

/** 내 차례에 체크하거나 콜한다 */
async function checkOrCall(page: Page): Promise<void> {
  const state = await look(page);
  await tapText(page, SCENE.poker, state.call === 0 ? '체크' : `콜 ${state.call}`);
}

it('포커 한 폰으로: 컴퓨터 수를 고르면 딜하고, 차례마다 패를 가린다', async ({ page }) => {
  await openApp(page);
  await startScene(page, SCENE.poker);
  expect(await hiddenTexts(page, SCENE.poker), '준비 화면').toEqual([]);
  await tapText(page, SCENE.poker, '친구와 함께');
  await tapText(page, SCENE.poker, '한 폰으로 번갈아 하기');
  await expect.poll(async () => (await look(page)).covered, WAIT).toBe(true);
  expect((await look(page)).names).toEqual(['1P', '2P']);
  await tapAt(page, 120, 200);
  await expect.poll(async () => (await look(page)).covered, WAIT).toBe(false);
  expect(await hiddenTexts(page, SCENE.poker), '컴퓨터 고르기').toEqual([]);

  // 컴퓨터 하나와 셋이서
  await tapText(page, SCENE.poker, '컴퓨터 1명과');
  await expect.poll(async () => (await look(page)).handNo, WAIT).toBe(1);
  const dealt = await look(page);
  expect(dealt.seats).toHaveLength(3);
  expect(dealt.seats).toContain('토끼');
  // 다른 사람의 차례면 가림 판을 걷는다.
  if (dealt.covered) {
    await tapAt(page, 120, 200);
    await expect.poll(async () => (await look(page)).covered, WAIT).toBe(false);
  }
  const before = await look(page);
  expect(before.myCards.every((rank) => rank > 0)).toBe(true);
  expect(before.otherCards.every((rank) => rank === 0)).toBe(true);
  await page.waitForTimeout(1200);
  expect(await hiddenTexts(page, SCENE.poker), '내 차례').toEqual([]);

  // 핸드가 끝날 때까지 체크·콜로 넘긴다. 폰을 넘길 때마다 가림 판이 뜬다.
  let passes = 0;
  for (let step = 0; step < 40 && (await look(page)).phase === 'betting'; step += 1) {
    const now = await look(page);
    if (now.covered) {
      passes += 1;
      await tapAt(page, 120, 200);
      await expect.poll(async () => (await look(page)).covered, WAIT).toBe(false);
      continue;
    }
    await expect.poll(async () => (await look(page)).myTurn, WAIT).toBe(true);
    const seat = now.seat;
    await checkOrCall(page);
    await expect.poll(async () => { const after = await look(page); return after.seat !== seat || after.phase !== 'betting' || !after.busy; }, WAIT).toBe(true);
  }
  await expect.poll(async () => (await look(page)).phase, WAIT).toBe('done');
  expect(passes).toBeGreaterThan(0);
  // 드물게 콜이 올인이 되어 누군가 칩을 다 잃으면 판이 끝나고 결과 판이 뜬다.
  if ((await look(page)).status === 'over') return;
  if ((await look(page)).covered) await tapAt(page, 120, 200);
  await expect.poll(async () => (await look(page)).covered, WAIT).toBe(false);
  await page.waitForTimeout(1200);
  expect(await hiddenTexts(page, SCENE.poker), '핸드가 끝난 뒤').toEqual([]);
  await tapText(page, SCENE.poker, '다음 판 (2/10)');
  await expect.poll(async () => (await look(page)).handNo, WAIT).toBe(2);
});

it('포커 온라인: 코드로 들어온 친구와 컴퓨터 둘이 한 탁자에 앉는다', async ({ page, browser }) => {
  const context = await browser.newContext({ viewport: page.viewportSize() ?? undefined, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const friend = await context.newPage();
  const friendErrors = collectErrors(friend);

  await openApp(page);
  await startScene(page, SCENE.poker);
  await tapText(page, SCENE.poker, '친구와 함께');
  await tapText(page, SCENE.poker, '방 만들기');
  await answer(page, '내 이름', '민수');
  await expect.poll(async () => (await look(page)).status, WAIT).toBe('waiting');
  const code = (await look(page)).code!;

  await openApp(friend);
  await startScene(friend, SCENE.poker);
  await tapText(friend, SCENE.poker, '친구와 함께');
  await tapText(friend, SCENE.poker, '코드로 들어가기');
  await answer(friend, '방 코드', code);
  await answer(friend, '내 이름', '지원');
  await expect.poll(async () => (await look(page)).status, WAIT).toBe('playing');
  await expect.poll(async () => (await look(friend)).status, WAIT).toBe('playing');

  // 먼저 하는 사람이 컴퓨터 둘과 넷이서 딜한다.
  const [a, b] = (await look(page)).myTurn ? [page, friend] : [friend, page];
  expect(await hiddenTexts(a, SCENE.poker), '컴퓨터 고르기').toEqual([]);
  await tapText(a, SCENE.poker, '컴퓨터 2명과 넷이서');
  await expect.poll(async () => (await look(a)).handNo, WAIT).toBe(1);
  await expect.poll(async () => (await look(b)).handNo, WAIT).toBe(1);
  const mine = await look(page);
  const theirs = await look(friend);
  expect(mine.seats).toEqual(['나', '토끼', '지원', '곰돌이']);
  expect(theirs.seats).toEqual(['나', '곰돌이', '민수', '토끼']);
  expect(mine.otherCards.every((rank) => rank === 0)).toBe(true);
  // 카드가 덱에서 날아오는 동안에는 글을 덮을 수 있어서 다 나눌 때까지 기다린다.
  await page.waitForTimeout(1200);
  expect(await hiddenTexts(page, SCENE.poker), '판 화면').toEqual([]);

  // 차례인 사람이 한 수 두면 다른 쪽에도 보인다.
  const [turn, other] = (await look(page)).myTurn ? [page, friend] : [friend, page];
  await expect.poll(async () => (await look(turn)).myTurn, WAIT).toBe(true);
  const moves = (await look(turn)).moves;
  await checkOrCall(turn);
  await expect.poll(async () => (await look(turn)).moves, WAIT).toBe(moves + 1);
  await expect.poll(async () => (await look(other)).moves, WAIT).toBe(moves + 1);
  expect(friendErrors).toEqual([]);
  await context.close();
});
