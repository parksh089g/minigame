/**
 * 상자 밀기의 화면 점검: 9차 검토에서 찾은 것(B1~B4, C1)이 실제 장면에서 고쳐졌는지 본다.
 * 점수 도전 장면을 열고, 점검마다 정해 둔 판을 깔아서 키보드나 장면의 일시정지로 움직인다.
 */
import './app-globals';
import { expect, type Page } from '@playwright/test';
import { SCENE } from '../src/config';
import { levelPuzzle } from '../src/games/box-push/levels';
import { parsePuzzle, puzzleRun, type Puzzle, type RunState } from '../src/games/box-push/rules';
import { it, openApp, startScene } from './app';

/** 장면에서 이 점검이 들여다보는 것 */
interface BoxView {
  playing: boolean;
  timeUp: boolean;
  grace: number;
  started: boolean;
  timeLeft: number;
  score: number;
  boardsCleared: number;
  pushes: number;
  stuckShown: boolean;
  noticeVisible: boolean;
  restartEnabled: boolean;
  /** 캐릭터와 상자마다, 그려진 자리와 규칙상 칸의 가운데가 떨어진 거리(px) */
  playerOff: number;
  boxOff: number[];
}

function view(page: Page): Promise<BoxView> {
  return page.evaluate((key) => {
    type Spot = { x: number; y: number };
    const scene = window.__pocketArcade?.scene.getScene(key) as unknown as {
      playing: boolean;
      timeUp: boolean;
      grace: number;
      started: boolean;
      stuckShown: boolean;
      run: RunState;
      notice: { visible: boolean };
      restartButton: { enabled: boolean };
      player: Spot;
      boxViews: Spot[];
      spotOf(cell: number): Spot;
    };
    const off = (drawn: Spot, cell: number): number => {
      const spot = scene.spotOf(cell);
      return Math.hypot(drawn.x - spot.x, drawn.y - spot.y);
    };
    const { run } = scene;
    return {
      playing: scene.playing,
      timeUp: scene.timeUp,
      grace: scene.grace,
      started: scene.started,
      timeLeft: run.timeLeft,
      score: run.score,
      boardsCleared: run.boardsCleared,
      pushes: run.board.pushes,
      stuckShown: scene.stuckShown,
      noticeVisible: scene.notice.visible,
      restartEnabled: scene.restartButton.enabled,
      playerOff: off(scene.player, run.board.player),
      boxOff: run.board.boxes.map((cell, box) => off(scene.boxViews[box], cell)),
    };
  }, SCENE.boxPush);
}

function puzzleOf(code: string): Puzzle {
  const puzzle = parsePuzzle(code, 1);
  if (!puzzle) throw new Error(`읽을 수 없는 판: ${code}`);
  return puzzle;
}

/** 점수 도전을 열고 그 판을 깐다. 시계는 처음 움직일 때 가기 시작한다. */
async function load(page: Page, puzzle: Puzzle, timeLeft?: number): Promise<void> {
  await startScene(page, SCENE.boxPush);
  await expect.poll(async () => (await view(page)).playing, { message: '첫 판이 깔려야 한다', ...SLOW }).toBe(true);
  const run: RunState = { ...puzzleRun(puzzle), ...(timeLeft === undefined ? {} : { timeLeft }) };
  await page.evaluate(
    ([key, next]) => {
      const scene = window.__pocketArcade?.scene.getScene(key) as unknown as {
        run: unknown;
        playing: boolean;
        started: boolean;
        waited: number;
        dealBoard(): void;
      };
      scene.playing = false;
      scene.started = false;
      scene.waited = 0;
      scene.run = next;
      scene.dealBoard();
    },
    [SCENE.boxPush, run] as const,
  );
  await expect.poll(async () => (await view(page)).playing, { message: '정해 둔 판이 깔려야 한다', ...SLOW }).toBe(true);
}

/** 조작 하나: 그쪽으로 걷기(밀기), 되돌리기 */
type Act = 'up' | 'down' | 'left' | 'right' | 'undo';

/**
 * 조작 여러 개를 한 프레임 안에 넣는다(사이에 그림이 한 번도 그려지지 않는다). 키보드와 같은 길로 들어간다.
 * 키 이벤트를 꾸며서 보내면 Phaser가 한 프레임에 여러 번 처리하는 일이 있어서, 키가 부르는 함수를 바로 부른다.
 */
function act(page: Page, acts: readonly Act[]): Promise<void> {
  return page.evaluate(
    ([key, list]) => {
      const scene = window.__pocketArcade?.scene.getScene(key) as unknown as {
        undoPush(): void;
        queueSwipe(direction: string): void;
        canAct: boolean;
      };
      for (const one of list) {
        if (!scene.canAct) continue;
        if (one === 'undo') scene.undoPush();
        else scene.queueSwipe(one);
      }
    },
    [SCENE.boxPush, acts] as const,
  );
}

/** 기다림의 한도. CI의 느린 기계에서는 장면의 시간이 벽시계보다 한참 느리게 갈 수 있어서 넉넉히 둔다. */
const SLOW = { timeout: 20_000 } as const;

/**
 * 걸음과 움직임이 모두 끝나기를 기다린다. 장면의 시간은 기계마다 빠르기가 달라서, 정해 둔 시간만큼 기다리지 않고
 * 장면이 걷는 중이 아니고 캐릭터와 상자의 움직임(tween)이 모두 멈출 때까지 지켜본다.
 */
async function settle(page: Page): Promise<void> {
  const busy = (): Promise<boolean> =>
    page.evaluate((key) => {
      const scene = window.__pocketArcade?.scene.getScene(key) as unknown as {
        stepping: boolean;
        player: object;
        boxViews: object[];
        tweens: { isTweening(target: object): boolean };
      };
      return scene.stepping || [scene.player, ...scene.boxViews].some((target) => scene.tweens.isTweening(target));
    }, SCENE.boxPush);
  await expect.poll(busy, { message: '움직임이 끝나야 한다', ...SLOW }).toBe(false);
}

it('상자 밀기: 상자끼리 얽혀 깰 수 없게 된 판도 알린다 (B1)', async ({ page }) => {
  await openApp(page);
  // 31단계는 걷지 않고 바로 위로 한 번 밀면 깰 수 없는 판이 되는데, 전에는 알림이 뜨지 않았다.
  await load(page, levelPuzzle(31));
  await act(page, ['up']);
  await settle(page);
  const after = await view(page);
  expect(after.pushes).toBe(1);
  expect(after.noticeVisible, '"더 갈 곳이 없는 상자가 있어요"가 떠야 한다').toBe(true);
  // 되돌리면 알림이 사라진다.
  await act(page, ['undo']);
  await settle(page);
  expect((await view(page)).noticeVisible).toBe(false);

  // 벽에 나란히 붙어 서로를 막은 상자 둘: 상자는 회색이 되고 알림이 뜬다.
  await load(page, puzzleOf('..bo/.b.o/p...'));
  for (const one of ['right', 'up'] as const) {
    await act(page, [one]);
    await settle(page);
  }
  expect((await view(page)).noticeVisible).toBe(true);
});

it('상자 밀기: 마지막 상자를 미는 동안 시간이 끝나면 깬 판으로 친다 (B2)', async ({ page }) => {
  await openApp(page);
  // 한 번 밀면 깨는 판. 미는 움직임(0.11초)보다 남은 시간(0.05초)이 짧다.
  await load(page, puzzleOf('pbo/...'), 0.05);
  await act(page, ['right']);
  await expect.poll(async () => (await view(page)).boardsCleared, { message: '다 깬 판으로 쳐야 한다', ...SLOW }).toBe(1);
  const cleared = await view(page);
  expect(cleared.score).toBeGreaterThan(0);
  // 돌려받은 시간으로 다음 판을 이어 한다.
  await expect.poll(async () => (await view(page)).playing, { message: '다음 판이 깔려야 한다', ...SLOW }).toBe(true);
  expect((await view(page)).timeLeft).toBeGreaterThan(1);

  // 깨지 못하는 걸음이었으면 그 걸음이 끝난 뒤에 끝난다.
  await load(page, puzzleOf('pb.o/....'), 0.05);
  await act(page, ['right']);
  await expect.poll(async () => (await view(page)).timeLeft, { message: '시간이 끝나야 한다', ...SLOW }).toBe(0);
  const over = await view(page);
  expect(over.playing).toBe(false);
  expect(over.boardsCleared).toBe(0);
});

it('상자 밀기: 막힌 걸음이나 되돌리기 바로 뒤에 움직여도 그림이 칸에 맞는다 (B3)', async ({ page }) => {
  await openApp(page);
  await load(page, puzzleOf('pb..o/.....'));
  // 한 번 밀어 두고, 되돌리기와 다시 밀기를 한 프레임에 넣는다.
  await act(page, ['right']);
  await settle(page);
  await act(page, ['undo', 'right']);
  await settle(page);
  let now = await view(page);
  expect(now.pushes).toBe(1);
  expect(now.playerOff, '캐릭터가 제 칸에 그려져야 한다').toBeLessThan(0.5);
  expect(Math.max(...now.boxOff), '상자가 제 칸에 그려져야 한다').toBeLessThan(0.5);

  // 벽에 부딪히고 바로 걷기
  await act(page, ['up', 'down']);
  await settle(page);
  now = await view(page);
  expect(now.playerOff, '캐릭터가 제 칸에 그려져야 한다').toBeLessThan(0.5);
});

it('상자 밀기: 걷기만 해도 "처음부터"를 누를 수 있다 (B4)', async ({ page }) => {
  await openApp(page);
  await load(page, puzzleOf('pb.o/....'));
  expect((await view(page)).restartEnabled).toBe(false);
  await act(page, ['down']);
  await settle(page);
  expect((await view(page)).restartEnabled, '걸었으면 처음부터를 누를 수 있어야 한다').toBe(true);
});

it('상자 밀기: "준비!" 동안 다시 멈추면 판을 본 만큼 시계가 간다 (C1)', async ({ page }) => {
  // 멈췄다 돌아오기를 되풀이하므로, 느린 기계에서는 다른 점검보다 오래 걸린다.
  it.setTimeout(120_000);
  await openApp(page);
  await load(page, puzzleOf('pb.o/....'));
  // 한 걸음 걸어서 시계를 움직인다.
  await act(page, ['down']);
  await settle(page);
  const before = (await view(page)).timeLeft;
  // 멈췄다 돌아와서 "준비!"(0.6초)가 반쯤 지났을 때 다시 멈추기를 여러 번 되풀이한다.
  // 기계마다 프레임의 빠르기가 달라서, 페이지 안에서 프레임마다 지켜보다가 "준비!"가 0.3초 남으면 바로 멈춘다.
  const rounds = 4;
  await page.evaluate((key) => window.__pocketArcade?.scene.pause(key), SCENE.boxPush);
  for (let round = 0; round < rounds; round += 1) {
    const left = await page.evaluate(
      (key) =>
        new Promise<number>((resolve) => {
          const game = window.__pocketArcade;
          const scene = game?.scene.getScene(key) as unknown as { grace: number };
          game?.scene.resume(key);
          const watch = (): void => {
            if (scene.grace > 0 && scene.grace <= 0.3) {
              const grace = scene.grace;
              game?.scene.pause(key);
              resolve(grace);
            } else requestAnimationFrame(watch);
          };
          requestAnimationFrame(watch);
        }),
      SCENE.boxPush,
    );
    expect(left, '"준비!"가 끝나기 전에 멈춰야 한다').toBeGreaterThan(0);
  }
  const now = await view(page);
  // 판이 보인 시간은 회마다 0.3초가 넘는다. 고치기 전에는 시계가 조금도 가지 않았다.
  expect(before - now.timeLeft, '판을 본 만큼 시계가 가야 한다').toBeGreaterThanOrEqual(rounds * 0.3);
  await page.evaluate((key) => window.__pocketArcade?.scene.resume(key), SCENE.boxPush);
});
