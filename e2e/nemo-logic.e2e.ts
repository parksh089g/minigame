/**
 * 네모 로직의 화면 점검: 처음 여는 사람에게 연습 판이 나오고 안내대로 따라 하면 본 게임이 열리는지,
 * 그리고 본 게임(연습을 마친 뒤의 판)이 눌러서 끝까지 풀리는지 본다.
 * smoke.e2e.ts는 저장이 비어 있는 채로 열어서 연습 판만 눌러 보므로, 본 게임은 여기서 따로 본다.
 */
import './app-globals';
import { expect, type Page } from '@playwright/test';
import { GAME_WIDTH, SCENE } from '../src/config';
import { PRACTICE_STEPS } from '../src/games/nemo-logic/rules';
import {
  activeScenes,
  expectRendering,
  it,
  openApp,
  scribble,
  seedOf,
  startScene,
  tapAt,
  tapText,
  textPoint,
  waitForScene,
} from './app';

/** 장면에서 이 점검이 들여다보는 것 */
interface NemoView {
  practice: boolean;
  practiceAt: number;
  playing: boolean;
  stageLevel: number | null;
  layout: { cell: number; left: number; top: number };
  run: { hearts: number; timeLeft: number; board: { cols: number; solution: boolean[]; cells: string[] } };
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
      run: {
        hearts: run.hearts,
        timeLeft: run.timeLeft,
        board: { cols: run.board.cols, solution: [...run.board.solution], cells: [...run.board.cells] },
      },
    };
  }, SCENE.nemoLogic);
}

/** 판이 깔려서 누를 수 있을 때까지 기다린다. */
async function waitForBoard(page: Page): Promise<void> {
  await expect.poll(async () => (await view(page)).playing, { message: '판을 누를 수 있어야 한다' }).toBe(true);
}

/** 칸의 가운데(논리 좌표) */
function cellCenter({ layout, run }: NemoView, index: number): { x: number; y: number } {
  const col = index % run.board.cols;
  const row = Math.floor(index / run.board.cols);
  return { x: layout.left + (col + 0.5) * layout.cell, y: layout.top + (row + 0.5) * layout.cell };
}

/** 칸 하나를 누른다. */
async function tapCell(page: Page, index: number): Promise<void> {
  const { x, y } = cellCenter(await view(page), index);
  await tapAt(page, x, y);
}

/** 판 위에 지금 보이는 글자들 */
function visibleTexts(page: Page): Promise<string[]> {
  return page.evaluate((key) => {
    const scene = window.__pocketArcade?.scene.getScene(key);
    return (scene?.children.list ?? [])
      .filter((item) => item.type === 'Text' && (item as Phaser.GameObjects.Text).visible)
      .map((item) => (item as Phaser.GameObjects.Text).text);
  }, SCENE.nemoLogic);
}

/** 누른 칸을 띄워 보여 주는 말풍선의 자리. 떠 있지 않으면 null이다. */
function lensBox(page: Page): Promise<{ x: number; y: number } | null> {
  return page.evaluate((key) => {
    const scene = window.__pocketArcade?.scene.getScene(key) as unknown as {
      lens: { box: { visible: boolean; x: number; y: number } };
    };
    const { box } = scene.lens;
    return box.visible ? { x: box.x, y: box.y } : null;
  }, SCENE.nemoLogic);
}

/**
 * 손가락 하나로 터치를 보낸다(Chrome의 CDP). Playwright의 touchscreen은 누르기만 있어서,
 * 누른 채 끌기와 터치가 취소되는 것(전화가 오거나 알림 창을 내릴 때)은 이것으로 흉내 낸다.
 */
async function touch(page: Page): Promise<{
  start(x: number, y: number): Promise<void>;
  move(x: number, y: number): Promise<void>;
  cancel(): Promise<void>;
}> {
  const cdp = await page.context().newCDPSession(page);
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('캔버스가 보이지 않는다');
  const scale = box.width / GAME_WIDTH;
  const point = (x: number, y: number): { x: number; y: number } => ({ x: box.x + x * scale, y: box.y + y * scale });
  return {
    start: async (x, y) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(x, y)] });
    },
    move: async (x, y) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(x, y)] });
    },
    cancel: async () => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    },
  };
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

it('네모 로직 점수 도전: "준비!" 도중에 다시 멈추기를 되풀이해도 판을 본 시간만큼 시계가 간다', async ({ page }) => {
  await openApp(page);
  await startScene(page, SCENE.nemoLogic, { practiced: true });
  await waitForBoard(page);
  // 첫 칸을 누르기 전에는 시계가 서 있으므로, 누른 것처럼 문을 열고 멈춘다.
  await page.evaluate((key) => {
    const nemo = window.__pocketArcade?.scene.getScene(key) as unknown as Phaser.Scene & { gate: { start(): void } };
    nemo.gate.start();
    nemo.scene.pause();
  }, SCENE.nemoLogic);
  const before = (await view(page)).run.timeLeft;

  // 돌아와서 "준비!"(0.6초)가 반쯤 지났을 때 다시 멈추기를 다섯 번. 판을 본 시간은 게임의 시계로 잰다.
  let seen = 0;
  for (let round = 0; round < 5; round += 1) {
    const left = await page.evaluate(
      (key) =>
        new Promise<number>((resolve) => {
          const nemo = window.__pocketArcade?.scene.getScene(key) as unknown as Phaser.Scene & { grace: number };
          nemo.scene.resume();
          const check = (): void => {
            if (nemo.grace > 0 && nemo.grace < 0.35) {
              const grace = nemo.grace;
              nemo.scene.pause();
              resolve(grace);
            } else requestAnimationFrame(check);
          };
          requestAnimationFrame(check);
        }),
      SCENE.nemoLogic,
    );
    seen += 0.6 - left;
  }
  expect(seen, '다섯 번 모두 "준비!" 도중에 멈췄다').toBeGreaterThan(1);
  // 멈추기와 계속하기는 다음 프레임에 처리되므로 마지막 멈추기가 시계에 닿기를 기다린다.
  await expect
    .poll(async () => before - (await view(page)).run.timeLeft, { message: '판을 본 시간만큼 시계가 가야 한다' })
    .toBeCloseTo(seen, 2);
  await page.evaluate((key) => window.__pocketArcade?.scene.getScene(key)?.scene.resume(), SCENE.nemoLogic);
  await expectRendering(page);
});

it('네모 로직: 큰 판의 맨 윗줄을 끌어도 말풍선은 손가락 위에 뜨고, 끌다가 터치가 취소되면 칠하지 않는다', async ({
  page,
  errors,
}, info) => {
  // 49단계(5×10)는 판 위의 자리가 가장 좁은 판이다. 그 단계까지 열린 저장을 앱이 읽기 전에 넣어 둔다(layout.e2e.ts의 핀 뽑기 참고).
  const level = 49;
  await page.addInitScript(
    (cleared) => localStorage.setItem('pocket-arcade:save', JSON.stringify({ stages: { 'nemo-logic': cleared } })),
    level - 1,
  );
  await openApp(page);
  await startScene(page, SCENE.nemoLogic, { stageLevel: level });
  await waitForBoard(page);
  const start = await view(page);
  expect(start.stageLevel, '잠긴 단계라 점수 도전이 열렸다').toBe(level);
  const finger = await touch(page);

  const from = cellCenter(start, 0);
  await finger.start(from.x, from.y);
  for (let col = 1; col < start.run.board.cols; col += 1) {
    const to = cellCenter(start, col);
    await finger.move(to.x, to.y);
    const lens = await lensBox(page);
    if (start.layout.cell >= 33) {
      expect(lens, '칸이 크면 말풍선이 뜨지 않는다').toBeNull();
      continue;
    }
    expect(lens, '칸이 작으면 말풍선이 떠야 한다').not.toBeNull();
    // 말풍선(한 변 44)이 맨 윗줄보다 위에 있어서 끌어 갈 칸을 가리지 않는다.
    expect((lens?.y ?? 0) + 22, `${col}번째 칸을 끌 때`).toBeLessThanOrEqual(start.layout.top);
  }
  if (info.project.name === '320x568') expect(start.layout.cell, '작은 화면에서는 말풍선이 뜨는 판이다').toBeLessThan(33);

  await finger.cancel();
  await expect.poll(() => lensBox(page), { message: '말풍선이 사라져야 한다' }).toBeNull();
  // 취소된 터치는 막을 수 없는데 Phaser가 막으려 해서 Chrome이 알림을 남긴다. 실제 기기에서도 같고 해가 없으므로 뺀다.
  const ignored = errors.findIndex((error) => error.includes('cancel a touchcancel event'));
  if (ignored >= 0) errors.splice(ignored, 1);
  const after = await view(page);
  expect(after.run.board.cells, '취소된 터치는 칸을 칠하지 않는다').toEqual(start.run.board.cells);
  expect(after.run.hearts).toBe(start.run.hearts);
});

it('네모 로직 단계 도전: 칠하던 그림이 있으면 그만하기 전에 한 번 더 묻는다', async ({ page }) => {
  await openApp(page);
  await startScene(page, SCENE.nemoLogic, { stageLevel: 1, practiced: true });
  await waitForBoard(page);
  const pause = (): Promise<void> =>
    page.evaluate((key) => {
      (window.__pocketArcade?.scene.getScene(key) as unknown as { pauseGame(): void }).pauseGame();
    }, SCENE.nemoLogic);

  // 아직 아무것도 칠하지 않았으면 묻지 않고 나간다.
  await pause();
  await waitForScene(page, SCENE.pause);
  await tapText(page, SCENE.pause, '그만하기');
  await expect.poll(() => activeScenes(page), { message: '바로 나가야 한다' }).not.toContain(SCENE.nemoLogic);

  await startScene(page, SCENE.nemoLogic, { stageLevel: 1, practiced: true });
  await waitForBoard(page);
  const { run } = await view(page);
  await tapCell(page, run.board.solution.indexOf(true));
  await expect.poll(async () => (await view(page)).run.board.cells.includes('filled')).toBe(true);
  const painted = (await view(page)).run.board.cells;
  await pause();
  await waitForScene(page, SCENE.pause);
  await tapText(page, SCENE.pause, '그만하기');
  await expect
    .poll(() => textPoint(page, SCENE.pause, '칠하던 그림이 사라져요'), { message: '한 번 더 물어야 한다' })
    .not.toBeNull();
  expect(await activeScenes(page)).toContain(SCENE.pause);
  // 계속하면 칠하던 그림이 그대로 있다.
  await tapText(page, SCENE.pause, '계속하기');
  await expect.poll(() => activeScenes(page)).not.toContain(SCENE.pause);
  expect((await view(page)).run.board.cells).toEqual(painted);
});

it('네모 로직 연습: 칠할 줄에 X를 쳐 버리면 지우는 법을 알려 주고, 지우면 다시 칠하기를 안내한다', async ({ page }) => {
  await openApp(page);
  await startScene(page, SCENE.nemoLogic);
  await waitForBoard(page);
  await expect.poll(async () => (await view(page)).practiceAt).toBe(0);
  const step = PRACTICE_STEPS[0];
  const { run } = await view(page);
  const cell = step.row * run.board.cols + 1;

  // 첫 걸음에서 표시를 켜고 안내하는 줄을 누르면 X가 쳐진다.
  await tapText(page, SCENE.nemoLogic, '표시');
  await tapCell(page, cell);
  await expect.poll(async () => (await view(page)).run.board.cells[cell]).toBe('marked');
  await expect.poll(() => visibleTexts(page), { message: 'X를 지우는 법을 알려야 한다' }).toContain('X를 친 칸은 칠해지지 않아요');

  // 표시를 켠 채 X를 다시 누르면 지워지고, 첫 걸음의 안내로 돌아온다.
  await tapCell(page, cell);
  await expect.poll(async () => (await view(page)).run.board.cells[cell]).toBe('blank');
  await expect.poll(() => visibleTexts(page)).toContain(step.lines[0]);
  expect(await visibleTexts(page)).not.toContain('X를 친 칸은 칠해지지 않아요');

  // 칠하기로 돌아와 그 줄을 칠하면 다음 걸음으로 넘어간다.
  await tapText(page, SCENE.nemoLogic, '칠하기');
  for (let col = 0; col < run.board.cols; col += 1) await tapCell(page, step.row * run.board.cols + col);
  await expect.poll(async () => (await view(page)).practiceAt).toBe(1);
});
