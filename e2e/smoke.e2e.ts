/**
 * 화면 점검: 빌드한 앱을 브라우저에 띄우고, 사람이 아무 데나 눌러 보는 동안 오류가 나지 않는지 본다.
 * 무엇을 누르든 상관없이 잡히지 않은 예외와 console.error가 하나도 없어야 하고, 화면이 멈추지 않아야 한다.
 * 게임 목록은 허브와 같은 registry에서 읽으므로, 게임을 새로 넣으면 따로 할 일 없이 이 점검에 들어온다.
 */
import './app-globals';
import { expect, type Page } from '@playwright/test';
import { GAME_WIDTH, SCENE } from '../src/config';
import { GAMES } from '../src/games/registry';
import {
  GROUP_FULL_SECONDS,
  GROUP_UNLOCK_SECONDS,
  groupParts,
  runSpeed,
  SECOND_ACT_SECONDS,
  type GroupKind,
  type ObstacleKind,
} from '../src/games/jump-runner/rules';
import { dayIndexOf } from '../src/games/lantern-keeper/daily';
import { LANTERN_GAME_ID, LANTERN_SCENE } from '../src/games/lantern-keeper/data';
import {
  ARCADE_KINDS,
  areAdjacent,
  cellOf,
  CELLS,
  COLS,
  isValidSwap,
  playSwap,
  ROWS,
  secondsBack,
  swapped,
  type Piece,
  type Turn,
} from '../src/games/match-three/rules';
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
  /** 칸마다 놓인 조각 그림 */
  views: Array<{ texture: { key: string } } | null>;
  phase: string;
  timeLeft: number;
  score: number;
  rainbows: number;
  /** 새로 들어오는 조각을 뽑는 난수 */
  random: () => number;
  syncViews(): void;
  trySwap(a: number, b: number): void;
  /** 장면에 놓인 것들. 터지는 모습(빛줄기와 띠)은 Graphics로 그렸다가 지운다. */
  children: { list: Array<{ type: string }> };
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

/**
 * 글자로 그린 세 개 맞추기 판. 줄마다 COLS글자이고 숫자는 조각의 갈래, 소문자 a~f는 그 갈래(0~5)의 무지개다.
 * 적지 않은 윗줄과 '?'는 서로 맞지 않는 무늬(갈래 3, 4, 5)로 채운다.
 */
function matchThreeBoard(rows: readonly string[]): Piece[] {
  const board: Piece[] = [];
  const offset = ROWS - rows.length;
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const letter = row < offset ? '?' : rows[row - offset][col];
      if (letter === '?') board.push({ kind: 3 + ((col + row * 2) % 3), power: null });
      else if (letter >= 'a' && letter <= 'f') board.push({ kind: letter.charCodeAt(0) - 97, power: 'rainbow' });
      else board.push({ kind: Number(letter), power: null });
    }
  }
  return board;
}

/** 점검이 장면에 끼워 넣는 난수: 부를 때마다 갈래가 0, 5, 4, 3, 2, 1 차례로 나온다. 페이지 안에서도 같은 식을 쓴다. */
function steadyRandom(): () => number {
  let index = 0;
  return () => (((index++ * 5) % ARCADE_KINDS) + 0.5) / ARCADE_KINDS;
}

/** 장면의 판을 board로 바꿔 놓고 a와 b를 맞바꾼 뒤, 그 차례가 다 끝났을 때의 장면을 돌려준다. */
async function playMatchThree(
  page: Page,
  board: Piece[],
  a: number,
  b: number,
  timeLeft: number,
): Promise<{
  board: Piece[];
  textures: Array<string | null>;
  /** 옮겨 간 칸(b)에 그 차례 동안 놓였던 그림들. 처음 나온 차례대로다. */
  shown: string[];
  score: number;
  rainbows: number;
  /** 그 차례 동안 시계가 는 만큼(초). 손을 기다리는 동안 흐른 시간만큼 모자란다. */
  gained: number;
  /** 장면에 놓인 Graphics의 수: 바꾸기 전, 차례 도중 가장 많았을 때 */
  drawn: { before: number; peak: number };
}> {
  return page.evaluate(
    ([key, next, from, to, seconds, kinds]) =>
      new Promise((resolve, reject) => {
        const scene = window.__pocketArcade?.scene.getScene(key) as unknown as MatchThreeView;
        const graphics = (): number => scene.children.list.filter((child) => child.type === 'Graphics').length;
        scene.board = next;
        scene.syncViews();
        let index = 0;
        scene.random = () => (((index++ * 5) % kinds) + 0.5) / kinds;
        scene.timeLeft = seconds;
        const before = graphics();
        let peak = before;
        const shown: string[] = [];
        const giveUp = setTimeout(() => {
          scene.events.off('update', onUpdate);
          reject(new Error(`차례가 끝나지 않았다(phase ${scene.phase})`));
        }, 30_000);
        function onUpdate(): void {
          peak = Math.max(peak, graphics());
          const texture = scene.views[to]?.texture.key;
          if (texture && !shown.includes(texture)) shown.push(texture);
          if (scene.phase !== 'idle') return;
          clearTimeout(giveUp);
          scene.events.off('update', onUpdate);
          resolve({
            board: scene.board,
            textures: scene.views.map((view) => view?.texture.key ?? null),
            shown,
            score: scene.score,
            rainbows: scene.rainbows,
            gained: scene.timeLeft - seconds,
            drawn: { before, peak },
          });
        }
        scene.trySwap(from, to);
        if (scene.phase === 'idle') {
          clearTimeout(giveUp);
          reject(new Error('바꿀 수 없는 자리다'));
          return;
        }
        scene.events.on('update', onUpdate);
      }),
    [SCENE.matchThree, board, a, b, timeLeft, ARCADE_KINDS] as const,
  );
}

it('세 개 맞추기: 다섯을 맞추면 무지개 조각이 생기고, 무지개를 맞추면 같은 조각이 모두 함께 사라진다', async ({ page }) => {
  await openApp(page);
  await startScene(page, SCENE.matchThree);
  const textureOf = (piece: Piece): string => `match-three:${piece.power ?? 'piece'}:${piece.kind}`;
  const graphicsNow = (): Promise<number> =>
    page.evaluate(
      (key) =>
        (window.__pocketArcade?.scene.getScene(key) as unknown as MatchThreeView).children.list.filter(
          (child) => child.type === 'Graphics',
        ).length,
      SCENE.matchThree,
    );

  // 가운데 칸의 0을 아래로 내리면 맨 아래 줄에 0이 다섯 나란해진다.
  const fiveBoard = matchThreeBoard(['??0????', '00?00??']);
  const made = playSwap(fiveBoard, cellOf(2, 6), cellOf(2, 7), ARCADE_KINDS, steadyRandom()) as Turn;
  expect(made.steps[0].made, '다섯이 맞으면 옮긴 칸에 무지개가 생겨야 한다').toEqual([
    { cell: cellOf(2, 7), kind: 0, power: 'rainbow' },
  ]);
  expect(made.board[cellOf(2, 7)], '이 점검의 판에서는 무지개가 차례가 끝날 때까지 남아야 한다').toEqual({
    kind: 0,
    power: 'rainbow',
  });
  expect(secondsBack(made), '이 점검의 판에서는 첫 차례에 터지는 것이 없어야 한다').toBe(0);
  const afterFive = await playMatchThree(page, fiveBoard, cellOf(2, 6), cellOf(2, 7), 30);
  expect(afterFive.board, '장면의 판이 규칙이 낸 판과 같아야 한다').toEqual(made.board);
  expect(afterFive.textures, '칸마다 그 조각의 그림이 놓여야 한다').toEqual(made.board.map(textureOf));
  // 옮겨 온 여느 조각이 그 자리에서 곧바로 무지개로 바뀐다. 잠깐이라도 폭죽으로 보이면 안 된다.
  expect(afterFive.shown, '옮긴 칸의 조각이 무지개로 바뀌어야 한다').toEqual(['match-three:piece:0', 'match-three:rainbow:0']);
  expect(afterFive.score).toBe(made.points);
  expect(afterFive.rainbows, '만들기만 해서는 터뜨린 것으로 세지 않는다').toBe(0);
  expect(afterFive.gained, '무지개를 만들기만 해서는 시간을 돌려받지 않는다').toBeLessThanOrEqual(0);

  // 왼쪽 아래의 무지개(갈래 0) 옆으로 0을 내려서 셋을 맞춘다. 판 곳곳에 0이 다섯, 다른 조각(1)이 넷 흩어져 있다.
  const sweepBoard = matchThreeBoard(['0?1??01', '???0?1?', '?0????0', 'a?0?0?1']);
  const zeros = swapped(sweepBoard, cellOf(1, 6), cellOf(1, 7)).flatMap((piece, cell) => (piece.kind === 0 ? [cell] : []));
  const swept = playSwap(sweepBoard, cellOf(1, 6), cellOf(1, 7), ARCADE_KINDS, steadyRandom()) as Turn;
  expect(swept.steps[0].swept).toEqual([{ cell: cellOf(0, 7), kind: 0 }]);
  const gone = [...swept.steps[0].matched, ...swept.steps[0].blasted].sort((x, y) => x - y);
  expect(zeros).toHaveLength(8);
  expect(gone, '판의 0이 모두 사라지고 다른 조각은 남아야 한다').toEqual(zeros);
  const back = secondsBack(swept);
  expect(back).toBeGreaterThan(0);

  const afterSweep = await playMatchThree(page, sweepBoard, cellOf(1, 6), cellOf(1, 7), 30);
  expect(afterSweep.board, '장면의 판이 규칙이 낸 판과 같아야 한다').toEqual(swept.board);
  expect(afterSweep.textures, '칸마다 그 조각의 그림이 놓여야 한다').toEqual(swept.board.map(textureOf));
  expect(afterSweep.score).toBe(made.points + swept.points);
  expect(afterSweep.rainbows, '터뜨린 무지개를 세어야 한다').toBe(swept.rainbows);
  // 시계는 조각이 사라지고 떨어지는 동안 서 있으므로, 돌려받은 시간에서 차례가 끝난 뒤의 한두 프레임만큼만 모자란다.
  expect(afterSweep.gained, '무지개를 터뜨리면 시간을 돌려받아야 한다').toBeGreaterThan(back - 0.35);
  expect(afterSweep.gained).toBeLessThanOrEqual(back);
  // 무지개가 같은 조각마다 잇는 빛줄기를 그렸다가, 다 사라지면 남기지 않고 지운다.
  expect(afterSweep.drawn.peak, '무지개가 터지는 모습을 그려야 한다').toBeGreaterThan(afterSweep.drawn.before);
  await expect.poll(graphicsNow, { message: '터지는 모습을 그린 것이 남아 있으면 안 된다' }).toBe(afterSweep.drawn.before);
});

/** 점프 러너 장면에서 이 점검이 들여다보는 것 */
interface JumpRunnerView {
  elapsed: number;
  frontier: number;
  secondAct: boolean;
  obstacles: Array<{ kind: ObstacleKind; x: number }>;
  spawnAhead(): void;
}

it('점프 러너: 둘씩 붙은 장애물이 묶음마다 제 모양대로 놓이고, 40초를 달리면 2막에 들어선다', async ({ page }) => {
  await openApp(page);
  await startScene(page, SCENE.jumpRunner);

  // 첫 터치 전이라 아직 아무것도 움직이지 않는다. 묶음이 가장 자주 나오는 때로 시간을 옮기고 다음 장애물을 여러 번 놓아 본다.
  // 놓을 자리를 비워 두고 부르므로 부를 때마다 꼭 하나(또는 한 묶음)가 놓인다.
  // 다 놓은 뒤에는 출발하자마자 2막이 되게, 시간을 2막 바로 앞으로 되돌려 둔다.
  const { startedInSecondAct, placed } = await page.evaluate(
    ([key, groupSeconds, times, startSeconds]) => {
      const scene = window.__pocketArcade?.scene.getScene(key) as unknown as JumpRunnerView;
      const startedInSecondAct = scene.secondAct;
      scene.elapsed = groupSeconds;
      const spawns: Array<Array<{ kind: ObstacleKind; x: number }>> = [];
      for (let i = 0; i < times; i += 1) {
        const before = scene.obstacles.length;
        scene.frontier = 100;
        scene.spawnAhead();
        spawns.push(scene.obstacles.slice(before).map(({ kind, x }) => ({ kind, x })));
      }
      scene.elapsed = startSeconds;
      return { startedInSecondAct, placed: spawns };
    },
    [SCENE.jumpRunner, GROUP_FULL_SECONDS, 240, SECOND_ACT_SECONDS - 0.05] as const,
  );
  expect(startedInSecondAct, '달리기 전에는 1막이다').toBe(false);

  const groups = Object.keys(GROUP_UNLOCK_SECONDS) as GroupKind[];
  const speed = runSpeed(GROUP_FULL_SECONDS);
  const seen = new Set<GroupKind>();
  let singles = 0;
  for (const spawn of placed) {
    if (spawn.length === 1) {
      singles += 1;
      continue;
    }
    // 화면에 놓인 자리가 규칙이 정한 묶음의 모양과 같아야 한다.
    const shape = spawn.map(({ kind, x }) => ({ kind, offset: x - spawn[0].x }));
    const group = groups.find((item) => JSON.stringify(groupParts(item, speed)) === JSON.stringify(shape));
    expect(group, `규칙에 없는 모양으로 놓였다: ${JSON.stringify(shape)}`).toBeDefined();
    if (group) seen.add(group);
  }
  expect([...seen].sort(), '묶음 네 가지가 모두 나와야 한다').toEqual([...groups].sort());
  expect(singles, '하나짜리도 나와야 한다').toBeGreaterThan(0);

  // 화면을 눌러 출발한다(첫 터치가 출발 신호다). 곧 40초를 넘기므로 2막에 들어섰다고 알려야 한다.
  await tapAt(page, 120, 200);
  const secondAct = (): Promise<boolean> =>
    page.evaluate(
      (key) => (window.__pocketArcade?.scene.getScene(key) as unknown as JumpRunnerView).secondAct,
      SCENE.jumpRunner,
    );
  await expect.poll(secondAct, { message: '40초를 달리면 2막에 들어서야 한다' }).toBe(true);

  // 놓아 둔 장애물과 묶음이 화면에 흘러 들어온 뒤에도 계속 그려져야 한다.
  const onScreen = (): Promise<boolean> =>
    page.evaluate(
      ([key, width]) =>
        (window.__pocketArcade?.scene.getScene(key) as unknown as JumpRunnerView).obstacles.some(({ x }) => x < width),
      [SCENE.jumpRunner, GAME_WIDTH] as const,
    );
  await expect.poll(onScreen, { message: '놓아 둔 장애물이 화면에 들어와야 한다' }).toBe(true);
  await expectRendering(page);
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
