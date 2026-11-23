/**
 * 포커의 화면 점검: 몇 판을 체크·콜로 오류 없이 하고, 글이 가려지지 않는지, 족보표가 내 패를 빛내는지 본다.
 * 족보표의 줄을 누르면 예가 뜨는지, 칩을 다 잃으면 결과 화면으로 넘어가는지도 본다.
 */
import './app-globals';
import { expect, type Page } from '@playwright/test';
import { SCENE } from '../src/config';
import { RULE_BOOK } from '../src/games/rule-book';
import { activeScenes, hiddenTexts, it, openApp, startScene, tapText, textPoint, waitForScene } from './app';

interface TableView {
  phase: string;
  handNo: number;
  toAct: number | null;
  chips: number;
  busy: boolean;
  call: number;
  folded: boolean;
}

const view = (page: Page): Promise<TableView> =>
  page.evaluate((key) => {
    const scene = window.__pocketArcade?.scene.getScene(key) as unknown as {
      busy: boolean;
      table: { phase: string; handNo: number; toAct: number | null; currentBet: number; seats: { chips: number; bet: number; folded: boolean }[] };
    };
    const me = scene.table.seats[0];
    return {
      phase: scene.table.phase,
      handNo: scene.table.handNo,
      toAct: scene.table.toAct,
      chips: me.chips,
      busy: scene.busy,
      call: Math.max(0, scene.table.currentBet - me.bet),
      folded: me.folded,
    };
  }, SCENE.poker);

/** 족보표에서 빛나는 줄의 이름 */
const litRow = (page: Page): Promise<string | null> =>
  page.evaluate((key) => {
    const scene = window.__pocketArcade?.scene.getScene(key) as unknown as {
      chartRows: { info: { name: string }; bg: { fillAlpha: number } }[];
    };
    return scene.chartRows.find((row) => row.bg.fillAlpha > 0)?.info.name ?? null;
  }, SCENE.poker);

it('포커: 몇 판을 체크와 콜로 한다', async ({ page }) => {
  // 컴퓨터 셋이 차례마다 잠깐 생각해서 한 판에 15초쯤 걸린다. CI의 느린 기계에서도 넉넉하게 둔다.
  it.setTimeout(120_000);
  await openApp(page);
  await startScene(page, SCENE.poker);
  expect(await hiddenTexts(page, SCENE.poker), '시작 화면').toEqual([]);

  // 족보표의 줄을 누르면 예가 뜬다.
  await tapText(page, SCENE.poker, '풀하우스');
  await expect.poll(() => page.evaluate((key) => !!(window.__pocketArcade?.scene.getScene(key) as unknown as { popup: unknown }).popup, SCENE.poker)).toBe(true);
  expect(await hiddenTexts(page, SCENE.poker, { from: '트리플 + 원페어' })).toEqual([]);

  for (let hand = 1; hand <= 2; hand += 1) {
    const label = hand === 1 ? '딜하기 · 첫 판 시작' : `다음 판 (${hand}/10)`;
    await expect.poll(async () => (await view(page)).busy, { timeout: 15_000 }).toBe(false);
    await tapText(page, SCENE.poker, label);
    await expect.poll(async () => (await view(page)).handNo).toBe(hand);
    for (let step = 0; step < 30; step += 1) {
      await expect
        .poll(
          async () => {
            const now = await view(page);
            return now.phase !== 'betting' || (now.toAct === 0 && !now.busy);
          },
          { timeout: 15_000 },
        )
        .toBe(true);
      const state = await view(page);
      if (state.phase !== 'betting') break;
      expect(await litRow(page), '내 패가 족보표에 빛난다').not.toBeNull();
      expect(await hiddenTexts(page, SCENE.poker), '내 차례').toEqual([]);
      // 작게 따라가고, 크게 걸리면 접는다.
      if (state.call === 0) await tapText(page, SCENE.poker, '체크');
      else if (state.call <= 12) await tapText(page, SCENE.poker, `콜 ${state.call}`);
      else await tapText(page, SCENE.poker, '폴드');
      await page.waitForTimeout(150);
    }
    await expect.poll(async () => (await view(page)).phase, { timeout: 20_000 }).toBe('done');
    expect(await hiddenTexts(page, SCENE.poker), '판이 끝난 뒤').toEqual([]);
  }
});

it('포커: 칩을 다 잃으면 결과 화면이 뜬다', async ({ page }) => {
  await openApp(page);
  await startScene(page, SCENE.poker);
  // 내 칩을 빅 블라인드만큼으로 줄인다. 첫 판에 나는 버튼이라 블라인드를 내지 않는다.
  await page.evaluate((key) => {
    const scene = window.__pocketArcade?.scene.getScene(key) as unknown as { table: { seats: { chips: number }[] } };
    scene.table.seats[0].chips = 4;
  }, SCENE.poker);
  await tapText(page, SCENE.poker, '딜하기 · 첫 판 시작');
  await expect.poll(async () => { const v = await view(page); return v.toAct === 0 && !v.busy; }, { timeout: 15_000 }).toBe(true);
  // 올인한 뒤 손패를 아주 약하게 바꿔서 지게 만든다(다른 사람 패는 그대로).
  await page.evaluate((key) => {
    const scene = window.__pocketArcade?.scene.getScene(key) as unknown as {
      table: { deck: { rank: number; suit: string }[]; seats: { hole: { rank: number; suit: string }[] }[] };
    };
    const table = scene.table;
    table.seats[0].hole = [
      { rank: 2, suit: 'club' },
      { rank: 7, suit: 'diamond' },
    ];
    // 컴퓨터 하나에게 A 두 장을 주고, 공용 카드에 A를 하나 더 깐다.
    table.seats[1].hole = [
      { rank: 1, suit: 'spade' },
      { rank: 1, suit: 'heart' },
    ];
    table.deck = table.deck.filter((card) => !((card.rank === 2 && card.suit === 'club') || (card.rank === 7 && card.suit === 'diamond') || card.rank === 1));
    table.deck.push({ rank: 1, suit: 'club' });
  }, SCENE.poker);
  await tapText(page, SCENE.poker, '올인 4');
  // 컴퓨터가 모두 폴드할 수도 있어서, 내가 지거나 판이 끝날 때까지 다른 버튼은 누르지 않고 기다린다.
  await expect.poll(async () => (await view(page)).phase, { timeout: 20_000 }).toBe('done');
  const after = await view(page);
  if (after.chips === 0) {
    await expect
      .poll(() => page.evaluate((key) => window.__pocketArcade?.scene.isActive(key) ?? false, SCENE.result), { timeout: 10_000 })
      .toBe(true);
  }
});

it('포커: 처음 하면 규칙 안내서가 뜨고, 모든 쪽의 글이 보인다', async ({ page }) => {
  await openApp(page, '/', 'Hub', { ruleBooks: 'fresh' });
  await startScene(page, SCENE.poker);
  await waitForScene(page, SCENE.ruleBook);
  expect(await activeScenes(page)).toEqual([SCENE.ruleBook]);
  const pages = RULE_BOOK.poker;
  for (let index = 0; index < pages.length; index += 1) {
    await expect.poll(() => textPoint(page, SCENE.ruleBook, `${index + 1}. ${pages[index].title}`), { timeout: 10_000 }).not.toBeNull();
    expect(await hiddenTexts(page, SCENE.ruleBook), pages[index].title).toEqual([]);
    await tapText(page, SCENE.ruleBook, index < pages.length - 1 ? '다음' : '다 봤어요');
  }
  await expect.poll(() => page.evaluate((key) => window.__pocketArcade?.scene.isActive(key) ?? false, SCENE.poker)).toBe(true);
});
