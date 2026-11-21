/**
 * 카드 게임 규칙 안내서의 화면 점검: 처음 하는 카드 게임은 준비 화면에서 안내서가 저절로 한 번 뜨고,
 * 쪽을 끝까지 넘겨 닫으면 준비 화면이 다시 움직이며, 다음에 열 때는 뜨지 않는지 본다.
 * 준비 화면의 "규칙" 버튼과, 판 도중 일시정지의 "방법 보기 → 규칙 자세히"로도 열리는지 본다.
 */
import './app-globals';
import { expect, type Page } from '@playwright/test';
import { SCENE } from '../src/config';
import { HULA_SCENE } from '../src/games/hula/data';
import { RULE_BOOK } from '../src/games/rule-book';
import { activeScenes, hiddenTexts, it, openApp, startScene, tapText, textPoint, waitForScene } from './app';

const WAIT = { timeout: 20_000 } as const;

const isActive = (page: Page, key: string): Promise<boolean> =>
  page.evaluate((k) => window.__pocketArcade?.scene.isActive(k) ?? false, key);

it('규칙 안내서: 처음 하는 카드 게임에서 저절로 뜨고, 끝까지 넘겨 닫으면 다시 뜨지 않는다', async ({ page }) => {
  await openApp(page, '/', 'Hub', { ruleBooks: 'fresh' });
  await startScene(page, HULA_SCENE);
  await waitForScene(page, SCENE.ruleBook);
  expect(await activeScenes(page)).toEqual([SCENE.ruleBook]);

  const pages = RULE_BOOK.hula;
  for (let index = 0; index < pages.length; index += 1) {
    await expect.poll(() => textPoint(page, SCENE.ruleBook, `${index + 1}. ${pages[index].title}`), WAIT).not.toBeNull();
    expect(await hiddenTexts(page, SCENE.ruleBook), pages[index].title).toEqual([]);
    await tapText(page, SCENE.ruleBook, index < pages.length - 1 ? '다음' : '다 봤어요');
  }
  await expect.poll(() => isActive(page, HULA_SCENE), WAIT).toBe(true);
  expect(await isActive(page, SCENE.ruleBook)).toBe(false);

  // 한 번 봤으니 다시 열어도 뜨지 않는다.
  await startScene(page, HULA_SCENE);
  await page.waitForTimeout(800);
  expect(await isActive(page, SCENE.ruleBook)).toBe(false);

  // 준비 화면의 "규칙" 버튼으로는 언제든 연다. 위쪽의 "닫기"로 바로 닫는다.
  await tapText(page, HULA_SCENE, '규칙');
  await waitForScene(page, SCENE.ruleBook);
  await tapText(page, SCENE.ruleBook, '닫기');
  await expect.poll(() => isActive(page, HULA_SCENE), WAIT).toBe(true);
});

it('규칙 안내서: 판 도중 일시정지의 방법 보기에서 규칙 자세히로 열고, 돌아가면 방법 보기로 온다', async ({ page }) => {
  await openApp(page);
  await startScene(page, HULA_SCENE);
  await tapText(page, HULA_SCENE, '보통');
  await expect
    .poll(() => page.evaluate((k) => (window.__pocketArcade?.scene.getScene(k) as unknown as { mode: string }).mode, HULA_SCENE), WAIT)
    .toBe('round');
  await page.evaluate((k) => (window.__pocketArcade?.scene.getScene(k) as unknown as { pauseGame(): void }).pauseGame(), HULA_SCENE);
  await waitForScene(page, SCENE.pause);
  await tapText(page, SCENE.pause, '방법 보기');
  await tapText(page, SCENE.pause, '규칙 자세히');
  await waitForScene(page, SCENE.ruleBook);
  expect(await hiddenTexts(page, SCENE.ruleBook)).toEqual([]);
  await tapText(page, SCENE.ruleBook, '닫기');
  await expect.poll(() => isActive(page, SCENE.pause), WAIT).toBe(true);
  expect(await isActive(page, SCENE.ruleBook)).toBe(false);
  // 일시정지 화면은 방법을 보던 그대로이고, 뒤의 판은 멈춰 있다.
  await tapText(page, SCENE.pause, '돌아가기');
  await tapText(page, SCENE.pause, '계속하기');
  await expect.poll(() => isActive(page, HULA_SCENE), WAIT).toBe(true);
});
