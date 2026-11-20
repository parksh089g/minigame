/**
 * 훌라의 화면 점검: 준비 화면에서 상대를 고르고, 덱에서 뽑아 한 장 버리면 컴퓨터가 두고 내 차례로 돌아오는지,
 * 손을 다 비우면 결과 화면이 뜨는지 본다. 화면의 글이 가려지지 않는지도 본다.
 */
import './app-globals';
import { expect, type Page } from '@playwright/test';
import { HULA_SCENE } from '../src/games/hula/data';
import { hiddenTexts, it, openApp, startScene, tapAt, tapText, waitForScene } from './app';

const WAIT = { timeout: 20_000 } as const;

interface HulaView {
  state: {
    turn: 'me' | 'cpu';
    phase: 'draw' | 'play' | 'over';
    hands: { me: number[]; cpu: number[] };
    melds: { cards: number[] }[];
    stock: number[];
    discard: number[];
    taken: number | null;
    registered: { me: boolean; cpu: boolean };
    freshTurn: boolean;
  } | null;
  points: {
    hand: Map<number, { x: number; y: number }>;
    stock: { x: number; y: number };
  };
}

const view = (page: Page): Promise<{ turn: string; phase: string; hand: number[] } | null> =>
  page.evaluate((key) => {
    const state = (window.__pocketArcade?.scene.getScene(key) as unknown as HulaView).state;
    return state ? { turn: state.turn, phase: state.phase, hand: [...state.hands.me] } : null;
  }, HULA_SCENE);

const handPoint = (page: Page, card: number): Promise<{ x: number; y: number } | null> =>
  page.evaluate(
    ([key, c]) => (window.__pocketArcade?.scene.getScene(key) as unknown as HulaView).points.hand.get(c) ?? null,
    [HULA_SCENE, card] as const,
  );

it('훌라: 상대를 고르고 덱에서 뽑아 버리면 컴퓨터가 두고 내 차례가 돌아오며, 손을 다 비우면 결과 화면이 뜬다', async ({ page }) => {
  await openApp(page);
  await startScene(page, HULA_SCENE);
  expect(await hiddenTexts(page, HULA_SCENE), '준비 화면').toEqual([]);
  await tapText(page, HULA_SCENE, '보통');
  await expect.poll(async () => (await view(page))?.phase, WAIT).toBeDefined();

  // 내 차례의 뽑기가 될 때까지 기다린다(컴퓨터가 먼저 둘 수도 있다).
  await expect.poll(async () => {
    const v = await view(page);
    return v ? `${v.turn}/${v.phase}` : null;
  }, WAIT).toBe('me/draw');
  expect(await hiddenTexts(page, HULA_SCENE), '판 화면').toEqual([]);

  const stock = await page.evaluate((key) => (window.__pocketArcade?.scene.getScene(key) as unknown as HulaView).points.stock, HULA_SCENE);
  await tapAt(page, stock.x, stock.y);
  await expect.poll(async () => (await view(page))?.phase, WAIT).toBe('play');

  // 아무 카드 하나를 골라 버린다.
  const hand = (await view(page))!.hand;
  const point = await handPoint(page, hand[0]);
  await tapAt(page, point!.x, point!.y);
  await tapText(page, HULA_SCENE, '버리기');
  await expect.poll(async () => {
    const v = await view(page);
    return v ? `${v.turn}/${v.phase}` : null;
  }, WAIT).toMatch(/^(me\/draw|cpu\/\w+|me\/over|cpu\/over)$/);

  // 판을 끝내기 좋게 손패를 바꿔 두고(같은 숫자 셋 + 7 + 버릴 카드 한 장) 손가락으로 등록해 끝낸다.
  await expect.poll(async () => {
    const v = await view(page);
    return v ? `${v.turn}/${v.phase}` : null;
  }, WAIT).toMatch(/^(me\/draw|me\/over|cpu\/over)$/);
  const over = (await view(page))!.phase === 'over';
  if (!over) {
    await page.evaluate((key) => {
      const scene = window.__pocketArcade?.scene.getScene(key) as unknown as HulaView & { render(): void };
      const state = scene.state!;
      const wanted = [4, 17, 30, 6];
      const all = [...state.stock, ...state.hands.me, ...state.hands.cpu, ...state.discard];
      const rest = all.filter((card) => !wanted.includes(card) && !state.melds.some((m) => m.cards.includes(card)));
      state.hands.me = [...wanted];
      state.hands.cpu = rest.splice(0, 5);
      state.discard = [rest.pop()!];
      state.stock = rest;
      scene.render();
    }, HULA_SCENE);
    await tapAt(page, ...(Object.values(await page.evaluate((key) => (window.__pocketArcade?.scene.getScene(key) as unknown as HulaView).points.stock, HULA_SCENE)) as [number, number]));
    await expect.poll(async () => (await view(page))?.phase, WAIT).toBe('play');
    for (const card of [4, 17, 30]) {
      const p = await handPoint(page, card);
      await tapAt(page, p!.x, p!.y);
    }
    await tapText(page, HULA_SCENE, '등록');
    const seven = await handPoint(page, 6);
    await tapAt(page, seven!.x, seven!.y);
    await tapText(page, HULA_SCENE, '등록');
    const last = (await view(page))!.hand[0];
    const lp = await handPoint(page, last);
    await tapAt(page, lp!.x, lp!.y);
    await tapText(page, HULA_SCENE, '버리기');
  }
  await expect.poll(async () => (await view(page))?.phase, WAIT).toBe('over');
  await waitForScene(page, 'Result');
});
