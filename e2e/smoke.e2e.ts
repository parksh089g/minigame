/**
 * 화면 점검: 빌드한 앱을 브라우저에 띄우고, 사람이 아무 데나 눌러 보는 동안 오류가 나지 않는지 본다.
 * 무엇을 누르든 상관없이 잡히지 않은 예외와 console.error가 하나도 없어야 하고, 화면이 멈추지 않아야 한다.
 * 게임 목록은 허브와 같은 registry에서 읽으므로, 게임을 새로 넣으면 따로 할 일 없이 이 점검에 들어온다.
 */
import './app-globals';
import { expect } from '@playwright/test';
import { SCENE } from '../src/config';
import { GAMES } from '../src/games/registry';
import { dayIndexOf } from '../src/games/lantern-keeper/daily';
import { LANTERN_GAME_ID, LANTERN_SCENE } from '../src/games/lantern-keeper/data';
import { areAdjacent, CELLS, COLS, isValidSwap, type Piece } from '../src/games/match-three/rules';
import {
  activeScenes,
  expectRendering,
  it,
  openApp,
  scribble,
  seedOf,
  startScene,
  tapText,
  textPoint,
  waitForScene,
} from './app';

/** 씬이 있는(준비 중이 아닌) 게임 */
const PLAYABLE = GAMES.flatMap((game) => (game.sceneKey ? [{ ...game, sceneKey: game.sceneKey }] : []));

it('허브가 열리고, 여기저기 눌러 봐도 오류가 없다', async ({ page }, info) => {
  await openApp(page);
  await expectRendering(page);
  await scribble(page, seedOf(`hub ${info.project.name}`), 4_000);
  await expectRendering(page);
});

for (const game of PLAYABLE) {
  it(`${game.title}: 열리고, 여기저기 눌러 봐도 오류가 없다`, async ({ page }, info) => {
    await openApp(page);
    await startScene(page, game.sceneKey);
    await expectRendering(page);
    await scribble(page, seedOf(`${game.id} ${info.project.name}`), 3_000);
    await expectRendering(page);
    expect(await activeScenes(page), '떠 있는 장면이 있어야 한다').not.toEqual([]);
  });
}

it('판을 마치면 결과 화면이 뜨고, "다시 하기"를 누르면 그 게임이 다시 열린다', async ({ page }) => {
  // 결과 화면을 쓰는 보통 게임 하나(승패로 끝나는 게임과 이어지는 게임은 결과 화면을 따로 쓴다)
  const game = PLAYABLE.find((item) => !item.versus && !item.ongoing && item.id !== LANTERN_GAME_ID);
  if (!game) throw new Error('결과 화면을 쓰는 게임이 없다');
  await openApp(page);
  await startScene(page, game.sceneKey);
  await page.evaluate((key) => {
    const scene = window.__pocketArcade?.scene.getScene(key) as unknown as { finishMiniGame(score: number): void };
    scene.finishMiniGame(123);
  }, game.sceneKey);
  await waitForScene(page, SCENE.result);
  await expectRendering(page);
  await tapText(page, SCENE.result, '다시 하기');
  await expect.poll(() => activeScenes(page), { message: '그 게임이 다시 열려야 한다' }).toContain(game.sceneKey);
  expect(await activeScenes(page)).not.toContain(SCENE.result);
});

it('등불지기: 출발해서 움직이고, 멈췄다가 이어 할 수 있다', async ({ page }) => {
  await openApp(page);
  await startScene(page, LANTERN_SCENE);
  await tapText(page, LANTERN_SCENE, '출발!');
  const runSeconds = (): Promise<number> =>
    page.evaluate((key) => {
      const scene = window.__pocketArcade?.scene.getScene(key) as unknown as { sim?: { state: { t: number } } };
      return scene.sim?.state.t ?? -1;
    }, LANTERN_SCENE);
  await expect.poll(runSeconds, { message: '판이 시작되어야 한다' }).toBeGreaterThan(0);

  // 화면 가운데를 누른 채 빙 돌려서 조이스틱으로 움직인다.
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('캔버스가 보이지 않는다');
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height * 0.6;
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  for (let step = 0; step < 24; step++) {
    const angle = (step / 24) * Math.PI * 4;
    await page.mouse.move(centerX + Math.cos(angle) * 40, centerY + Math.sin(angle) * 40, { steps: 2 });
    await page.waitForTimeout(80);
  }
  await page.mouse.up();
  await expectRendering(page);

  // 멈추면 일시정지 화면이 뜨고 판의 시간이 서고, "계속하기"를 누르면 판으로 돌아간다.
  await page.evaluate((key) => {
    const scene = window.__pocketArcade?.scene.getScene(key) as unknown as { pauseGame(): void };
    scene.pauseGame();
  }, LANTERN_SCENE);
  await waitForScene(page, SCENE.pause);
  const paused = await runSeconds();
  await page.waitForTimeout(500);
  expect(await runSeconds(), '멈춘 동안에는 판의 시간이 서 있어야 한다').toBe(paused);
  await tapText(page, SCENE.pause, '계속하기');
  await expect.poll(() => activeScenes(page), { message: '판으로 돌아가야 한다' }).not.toContain(SCENE.pause);
  expect(await activeScenes(page)).toContain(LANTERN_SCENE);
});

/** 세 개 맞추기 장면에서 이 점검이 들여다보는 것 */
interface MatchThreeView {
  board: Piece[];
  phase: string;
  timeLeft: number;
  trySwap(a: number, b: number): void;
  events: {
    on(event: 'update', listener: (time: number, delta: number) => void): void;
    off(event: 'update', listener: (time: number, delta: number) => void): void;
  };
}

it('세 개 맞추기: 맞지 않는 자리를 이어서 바꿔도 점수 도전의 시계가 멈추지 않는다', async ({ page }) => {
  await openApp(page);
  await startScene(page, SCENE.matchThree);
  const board = await page.evaluate(
    (key) => (window.__pocketArcade?.scene.getScene(key) as unknown as MatchThreeView).board,
    SCENE.matchThree,
  );
  // 맞바꿔도 줄이 생기지 않는, 그림이 서로 다른 이웃한 두 칸
  const pairs = Array.from({ length: CELLS }, (_, cell) => [cell + 1, cell + COLS].map((other) => ({ a: cell, b: other }))).flat();
  const pair = pairs.find(
    ({ a, b }) => b < CELLS && areAdjacent(a, b) && board[a].kind !== board[b].kind && !isValidSwap(board, a, b),
  );
  if (!pair) throw new Error('맞지 않는 자리를 찾지 못했다');

  // 되돌아오는 조각을 기다렸다가 곧바로 다시 바꾸기를 여섯 번 한다. 처음 바꾸기가 시계를 연다.
  // 그동안 게임이 센 시간(한 프레임에 0.1초까지 센다)과 시계가 준 시간을 프레임마다 같은 자리에서 잰다.
  const SWAPS = 6;
  const measured = await page.evaluate(
    ([key, a, b, wanted]) =>
      new Promise<{ swaps: number; played: number; spent: number }>((resolve, reject) => {
        const scene = window.__pocketArcade?.scene.getScene(key) as unknown as MatchThreeView;
        let from: number | null = null;
        let swaps = 0;
        let played = 0;
        const giveUp = setTimeout(() => {
          scene.events.off('update', onUpdate);
          reject(new Error(`바꾸기 ${swaps}번에서 멈췄다(phase ${scene.phase})`));
        }, 30_000);
        // 장면의 update보다 먼저 불린다. 여기서 본 시계는 앞 프레임까지 준 값이다.
        function onUpdate(_time: number, delta: number): void {
          if (from === null) from = scene.timeLeft;
          else if (swaps >= wanted && scene.phase === 'idle') {
            clearTimeout(giveUp);
            scene.events.off('update', onUpdate);
            resolve({ swaps, played, spent: from - scene.timeLeft });
            return;
          }
          if (scene.phase === 'idle' && swaps < wanted) {
            scene.trySwap(a, b);
            if (scene.phase !== 'idle') swaps += 1;
          }
          played += Math.min(delta, 100) / 1000;
        }
        scene.events.on('update', onUpdate);
      }),
    [SCENE.matchThree, pair.a, pair.b, SWAPS] as const,
  );
  expect(measured.swaps, '맞지 않는 바꾸기를 다 해 봐야 한다').toBe(SWAPS);
  // 한 프레임이 아무리 길어도 바꾸기 한 번에 한 프레임(0.1초까지 센다)은 지나간다.
  expect(measured.played, '되돌아오는 시간만큼은 흘렀어야 한다').toBeGreaterThan(0.5);
  // 되돌아오는 동안 시계가 서면, 그동안 지나간 프레임만큼 준 시간이 센 시간보다 모자란다.
  expect(measured.spent, '시계는 게임이 센 시간만큼 줄어야 한다').toBeGreaterThan(measured.played - 0.05);
  expect(measured.spent).toBeLessThan(measured.played + 0.05);
});

it('공유 주소로 들어오면 허브를 거치지 않고 그 게임이 열리고, 주소의 표시는 지워진다', async ({ page }) => {
  // 모든 게임이 같은 길(BootScene)로 열리므로, 보통 게임 하나와 두 큰 게임만 본다.
  const games = [PLAYABLE.find((item) => !item.bigMission), ...PLAYABLE.filter((item) => item.bigMission)];
  for (const game of games) {
    if (!game) continue;
    await openApp(page, `/?game=${game.id}`, game.sceneKey);
    await expect(page).not.toHaveURL(/[?&]game=/);
  }
});

it('등불지기 오늘의 판을 친구가 점수와 함께 보내면, 오늘의 판 쪽에 넘어 볼 기록이 뜬다', async ({ page }) => {
  const today = dayIndexOf(new Date());
  await openApp(page, `/?game=${LANTERN_GAME_ID}&day=${today}&score=333`, LANTERN_SCENE);
  await expect(page).not.toHaveURL(/[?&](game|day|score)=/);
  await expect
    .poll(() => textPoint(page, LANTERN_SCENE, '친구 기록 333점을 넘어 보세요'), { message: '친구 기록 알림이 떠야 한다' })
    .not.toBeNull();
});

it('모르는 게임을 가리키는 공유 주소는 허브를 연다', async ({ page }) => {
  await openApp(page, '/?game=no-such-game');
  await expectRendering(page);
});
