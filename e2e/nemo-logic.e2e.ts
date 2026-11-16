/**
 * 네모 로직의 화면 점검: 처음 여는 사람에게 연습 판이 나오고 안내대로 따라 하면 본 게임이 열리는지,
 * 그리고 본 게임(연습을 마친 뒤의 판)이 눌러서 끝까지 풀리는지 본다.
 * smoke.e2e.ts는 저장이 비어 있는 채로 열어서 연습 판만 눌러 보므로, 본 게임은 여기서 따로 본다.
 */
import './app-globals';
import { expect, type Page } from '@playwright/test';
import { SCENE } from '../src/config';
import { PRACTICE_STEPS } from '../src/games/nemo-logic/rules';
import { activeScenes, expectRendering, it, openApp, scribble, seedOf, startScene, tapAt, tapText } from './app';

/** 장면에서 이 점검이 들여다보는 것 */
interface NemoView {
  practice: boolean;
  practiceAt: number;
  playing: boolean;
  stageLevel: number | null;
  layout: { cell: number; left: number; top: number };
  run: { hearts: number; board: { cols: number; solution: boolean[]; cells: string[] } };
}

function view(page: Page): Promise<NemoView> {
  return page.evaluate((key) => {
    const scene = window.__pocketArcade?.scene.getScene(key) as unknown as NemoView;
    const { practice, practiceAt, playing, stageLevel, layout, run } = scene;
    return {
      practice,
      practiceAt,
      playing,
      stageLevel,
      layout: { cell: layout.cell, left: layout.left, top: layout.top },
      run: { hearts: run.hearts, board: { cols: run.board.cols, solution: [...run.board.solution], cells: [...run.board.cells] } },
    };
  }, SCENE.nemoLogic);
}

/** 판이 깔려서 누를 수 있을 때까지 기다린다. */
async function waitForBoard(page: Page): Promise<void> {
  await expect.poll(async () => (await view(page)).playing, { message: '판을 누를 수 있어야 한다' }).toBe(true);
}

/** 칸 하나를 누른다. */
async function tapCell(page: Page, index: number): Promise<void> {
  const { layout, run } = await view(page);
  const col = index % run.board.cols;
  const row = Math.floor(index / run.board.cols);
  await tapAt(page, layout.left + (col + 0.5) * layout.cell, layout.top + (row + 0.5) * layout.cell);
}

it('네모 로직: 처음 열면 연습 판이 나오고, 안내대로 따라 하면 본 게임이 열린다', async ({ page }) => {
  await openApp(page);
  await startScene(page, SCENE.nemoLogic);
  await waitForBoard(page);
  expect((await view(page)).practice, '처음 여는 사람에게는 연습 판이 나와야 한다').toBe(true);

  for (const [at, step] of PRACTICE_STEPS.entries()) {
    await expect.poll(async () => (await view(page)).practiceAt, { message: `${at}번째 걸음을 안내해야 한다` }).toBe(at);
    const { board } = (await view(page)).run;
    if (step.markCol !== undefined) {
      // X를 표시하는 걸음: 표시 단추를 켜고 그 칸을 누른 뒤, 다음 걸음을 위해 칠하기로 돌아온다.
      await tapText(page, SCENE.nemoLogic, '표시');
      await tapCell(page, step.row * board.cols + step.markCol);
      await tapText(page, SCENE.nemoLogic, '칠하기');
      continue;
    }
    for (let col = 0; col < board.cols; col += 1) {
      const cell = step.row * board.cols + col;
      if (board.solution[cell] && board.cells[cell] === 'blank') await tapCell(page, cell);
    }
  }

  // 다 칠하면 잠깐 뒤에 본 게임이 열린다. 연습에서는 목숨이 줄지 않는다.
  await expect.poll(async () => (await view(page)).practice, { message: '본 게임이 열려야 한다', timeout: 10_000 }).toBe(false);
  await waitForBoard(page);
  const game = await view(page);
  expect(game.run.board.cells.every((cell) => cell === 'blank'), '본 게임은 빈 판으로 시작한다').toBe(true);
  expect(game.run.hearts).toBe(3);

  // 한 번 연습한 뒤에는 다시 열어도 연습 판이 나오지 않는다.
  await startScene(page, SCENE.nemoLogic);
  await waitForBoard(page);
  expect((await view(page)).practice).toBe(false);
});

it('네모 로직: 연습을 건너뛰면 본 게임이 바로 열리고, 여기저기 눌러 봐도 오류가 없다', async ({ page }, info) => {
  await openApp(page);
  await startScene(page, SCENE.nemoLogic);
  await waitForBoard(page);
  await tapText(page, SCENE.nemoLogic, '건너뛰기');
  await expect.poll(async () => (await view(page)).practice, { message: '본 게임이 열려야 한다' }).toBe(false);
  await waitForBoard(page);
  await scribble(page, seedOf(`nemo-logic game ${info.project.name}`), 3_000);
  await expectRendering(page);
  expect(await activeScenes(page), '떠 있는 장면이 있어야 한다').not.toEqual([]);
});

it('네모 로직 단계 도전: 1단계의 그림을 다 칠하면 단계 결과 화면이 뜬다', async ({ page }) => {
  await openApp(page);
  await startScene(page, SCENE.nemoLogic, { stageLevel: 1, practiced: true });
  await waitForBoard(page);
  const start = await view(page);
  expect(start.practice).toBe(false);
  expect(start.stageLevel).toBe(1);

  for (const [cell, fill] of start.run.board.solution.entries()) {
    if (fill) await tapCell(page, cell);
  }
  await expect
    .poll(() => activeScenes(page), { message: '단계 결과 화면이 떠야 한다', timeout: 15_000 })
    .toContain(SCENE.stageResult);
  await expectRendering(page);
});
