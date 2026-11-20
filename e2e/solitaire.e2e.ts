/**
 * 솔리테어의 화면 점검: 새 판을 열어 더미를 넘기고, 카드를 끌어 옮기고, 거의 다 모은 판에서 카드 하나를 누르면
 * 남은 카드가 저절로 모여 결과 화면이 뜨는지 본다. 오늘의 판과 오늘의 랭킹 쪽도 열어 본다.
 */
import './app-globals';
import { expect, type Page } from '@playwright/test';
import { SCENE } from '../src/config';
import { SOLITAIRE_SCENE } from '../src/games/solitaire/rules';
import { activeScenes, hiddenTexts, it, openApp, startScene, tapAt, tapText, waitForScene } from './app';

const WAIT = { timeout: 20_000 } as const;
const CARD = { w: 30, h: 42 } as const;
const colLeft = (column: number): number => 6 + column * 33;

interface CardData {
  suit: number;
  rank: number;
  up: boolean;
}
interface BoardData {
  stock: CardData[];
  waste: CardData[];
  foundations: CardData[][];
  tableau: CardData[][];
  score: number;
  moves: number;
  recycles: number;
}

const boardOf = (page: Page): Promise<BoardData | null> =>
  page.evaluate((key) => (window.__pocketArcade?.scene.getScene(key) as unknown as { board: BoardData | null }).board, SOLITAIRE_SCENE);

/** 판을 바꿔 놓고 다시 그린다. */
async function setBoard(page: Page, board: BoardData): Promise<void> {
  await page.evaluate(
    ([key, next]) => {
      const scene = window.__pocketArcade?.scene.getScene(key) as unknown as { board: BoardData; render(animate: boolean): void };
      scene.board = next;
      scene.render(false);
    },
    [SOLITAIRE_SCENE, board] as const,
  );
}

const empty = (): BoardData => ({
  stock: [],
  waste: [],
  foundations: [[], [], [], []],
  tableau: [[], [], [], [], [], [], []],
  score: 0,
  moves: 0,
  recycles: 0,
});

it('솔리테어: 새 판에서 더미를 넘기고, 카드를 끌어 옮기고, 다 모으면 결과 화면이 뜬다', async ({ page }) => {
  await openApp(page);
  await startScene(page, SOLITAIRE_SCENE);
  expect(await hiddenTexts(page, SOLITAIRE_SCENE), '시작 화면').toEqual([]);
  await tapText(page, SOLITAIRE_SCENE, '새 판');
  await expect.poll(async () => (await boardOf(page))?.stock.length, WAIT).toBe(24);
  await page.waitForTimeout(1_200);

  // 더미를 누르면 한 장이 버림 칸으로 간다.
  await tapAt(page, colLeft(0) + CARD.w / 2, 40 + CARD.h / 2);
  await expect.poll(async () => (await boardOf(page))?.waste.length, WAIT).toBe(1);

  // 빨간 5를 끌어 검은 6 위에 놓는다.
  const drag = empty();
  drag.tableau[0] = [{ suit: 1, rank: 5, up: true }];
  drag.tableau[3] = [{ suit: 0, rank: 6, up: true }];
  drag.stock = [{ suit: 3, rank: 9, up: false }];
  await setBoard(page, drag);
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('캔버스가 보이지 않는다');
  const scale = box.width / 240;
  const at = (x: number, y: number): [number, number] => [box.x + x * scale, box.y + y * scale];
  await page.mouse.move(...at(colLeft(0) + 15, 100));
  await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) await page.mouse.move(...at(colLeft(0) + 15 + step * 12.4, 100 + step * 2));
  await page.mouse.up();
  await expect.poll(async () => (await boardOf(page))?.tableau[3].map((card) => card.rank), WAIT).toEqual([6, 5]);

  // K 네 장만 남은 판: K 하나를 누르면 모음 칸으로 가고, 나머지는 저절로 모인다.
  const last = empty();
  last.foundations = [0, 1, 2, 3].map((suit) => Array.from({ length: 12 }, (_, i) => ({ suit, rank: i + 1, up: true })));
  last.tableau = [0, 1, 2, 3].map((suit) => [{ suit, rank: 13, up: true }]);
  last.tableau.push([], [], []);
  last.score = 480;
  await setBoard(page, last);
  await tapAt(page, colLeft(0) + 15, 100);
  await waitForScene(page, SCENE.result);
  expect(await activeScenes(page)).toContain(SCENE.result);
});

it('솔리테어: 오늘의 판은 날마다 같은 판이고, 오늘의 랭킹 쪽이 열린다', async ({ page }) => {
  await openApp(page);
  await startScene(page, SOLITAIRE_SCENE, { mode: 'play', daily: true });
  const first = await boardOf(page);
  await startScene(page, SOLITAIRE_SCENE, { mode: 'play', daily: true });
  expect(await boardOf(page)).toEqual(first);
  await startScene(page, SOLITAIRE_SCENE, { mode: 'rank' });
  await expect.poll(() => hiddenTexts(page, SOLITAIRE_SCENE), WAIT).toEqual([]);
});
