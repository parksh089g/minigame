/**
 * 화면 점검: 빌드한 앱을 브라우저에 띄우고, 사람이 아무 데나 눌러 보는 동안 오류가 나지 않는지 본다.
 * 무엇을 누르든 상관없이 잡히지 않은 예외와 console.error가 하나도 없어야 하고, 화면이 멈추지 않아야 한다.
 * 게임 목록은 허브와 같은 registry에서 읽으므로, 게임을 새로 넣으면 따로 할 일 없이 이 점검에 들어온다.
 */
import './app-globals';
import { expect, test } from '@playwright/test';
import { SCENE } from '../src/config';
import { GAMES } from '../src/games/registry';
import { dayIndexOf } from '../src/games/lantern-keeper/daily';
import { LANTERN_GAME_ID, LANTERN_SCENE } from '../src/games/lantern-keeper/data';
import {
  activeScenes,
  collectErrors,
  expectRendering,
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

/** 모든 점검은 끝날 때 페이지에서 난 오류가 없어야 통과한다. */
const it = test.extend<{ errors: string[] }>({
  errors: [
    async ({ page }, use) => {
      const errors = collectErrors(page);
      await use(errors);
      expect(errors, '페이지에서 오류가 나지 않아야 한다').toEqual([]);
    },
    { auto: true },
  ],
});

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
