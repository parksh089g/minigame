/**
 * 하이로우 칩 걸기와 친구와 하기: 준비 화면에서 모드를 고르고, 칩을 걸어 열두 번 고르면 결과 화면이 뜨는지,
 * 한 폰으로 두 사람이 같은 카드 순서로 차례로 하고 결과가 나오는지 본다.
 */
import './app-globals';
import { expect, type Page } from '@playwright/test';
import { SCENE } from '../src/config';
import { hiddenTexts, it, openApp, startScene, tapAt, tapText } from './app';

const WAIT = { timeout: 20_000 } as const;

const look = (page: Page) =>
  page.evaluate((key) => {
    const scene = window.__pocketArcade?.scene.getScene(key) as unknown as {
      busy: boolean;
      run: { chips: number; round: number; current: { rank: number }; deck: { rank: number }[] } | null;
      friends: { covered: boolean; match: { room: { status: string; seat: number } } | null };
    };
    const run = scene.run;
    return {
      busy: scene.busy,
      chips: run?.chips ?? null,
      round: run?.round ?? null,
      canHigh: run ? run.deck.some((card) => card.rank > run.current.rank) : false,
      covered: scene.friends.covered,
      status: scene.friends.match?.room.status ?? null,
      seat: scene.friends.match?.room.seat ?? null,
    };
  }, SCENE.highLow);

/** 나올 수 있는 쪽을 골라 한 번 건다. */
async function guessOnce(page: Page): Promise<void> {
  const before = await look(page);
  await tapText(page, SCENE.highLow, before.canHigh ? '높다' : '낮다');
  await expect.poll(async () => {
    const now = await look(page);
    return !now.busy && (now.round !== before.round || now.seat !== before.seat || now.covered);
  }, WAIT).toBe(true);
}

it('하이로우 칩 걸기: 칩을 걸고 열두 번 고르면 결과 화면이 뜬다', async ({ page }) => {
  await openApp(page);
  await startScene(page, SCENE.highLow);
  expect(await hiddenTexts(page, SCENE.highLow), '준비 화면').toEqual([]);
  await tapText(page, SCENE.highLow, '칩 걸기');
  await expect.poll(async () => (await look(page)).chips, WAIT).toBe(100);
  expect(await hiddenTexts(page, SCENE.highLow), '칩 걸기 화면').toEqual([]);
  await tapText(page, SCENE.highLow, '+25');
  await expect(page.evaluate((key) => (window.__pocketArcade?.scene.getScene(key) as unknown as { betAmount: number }).betAmount, SCENE.highLow)).resolves.toBe(35);
  for (let i = 0; i < 12; i += 1) {
    const now = await look(page);
    if (now.chips === 0 || now.round === 12) break;
    await guessOnce(page);
  }
  await expect
    .poll(() => page.evaluate((key) => window.__pocketArcade?.scene.isActive(key) ?? false, SCENE.result), WAIT)
    .toBe(true);
});

it('하이로우 한 폰으로: 두 사람이 같은 카드로 차례로 하고 칩을 견준다', async ({ page }) => {
  await openApp(page);
  await startScene(page, SCENE.highLow);
  await tapText(page, SCENE.highLow, '친구와 함께');
  await tapText(page, SCENE.highLow, '한 폰으로 번갈아 하기');
  await expect.poll(async () => (await look(page)).covered, WAIT).toBe(true);
  const first = (await look(page)).seat;
  await tapAt(page, 120, 200);
  await expect.poll(async () => (await look(page)).covered, WAIT).toBe(false);
  expect(await hiddenTexts(page, SCENE.highLow), '판 화면').toEqual([]);
  for (let i = 0; i < 12 && (await look(page)).seat === first && !(await look(page)).covered; i += 1) await guessOnce(page);
  // 앞사람이 다 하면 폰을 넘긴다.
  await expect.poll(async () => (await look(page)).covered, WAIT).toBe(true);
  expect((await look(page)).seat).not.toBe(first);
  await tapAt(page, 120, 200);
  for (let i = 0; i < 12 && (await look(page)).status === 'playing'; i += 1) await guessOnce(page);
  await expect.poll(async () => (await look(page)).status, WAIT).toBe('over');
  await tapText(page, SCENE.highLow, '한 판 더');
  await expect.poll(async () => (await look(page)).status, WAIT).toBe('playing');
});
