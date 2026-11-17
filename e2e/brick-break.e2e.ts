/**
 * 벽돌 깨기의 화면 점검: 일시정지에서 돌아와 멈춘 동안 막대도 서 있는지, 결과 화면의 "다시 하기"를 두 번 잇달아
 * 눌러도 새 판의 공이 바로 떠나지 않는지, 판이 끝날 때의 알림 글자가 벽돌에 겹치지 않는지 본다.
 */
import './app-globals';
import { expect, type Page } from '@playwright/test';
import { SCENE } from '../src/config';
import { FIELD_HEIGHT } from '../src/games/brick-break/rules';
import { activeScenes, expectRendering, it, openApp, startScene, tapAt, tapText, waitForScene } from './app';

const KEY = SCENE.brickBreak;

/** 장면에서 이 점검이 들여다보는 것 */
interface BrickView {
  phase: string;
  paddleX: number;
  grace: number;
  gateOpen: boolean;
  fieldTop: number;
}

function view(page: Page): Promise<BrickView> {
  return page.evaluate((key) => {
    const scene = window.__pocketArcade?.scene.getScene(key) as unknown as {
      board: { phase: string; paddleX: number };
      grace: number;
      gate: { open: boolean };
      fieldTop: number;
    };
    return {
      phase: scene.board.phase,
      paddleX: scene.board.paddleX,
      grace: scene.grace,
      gateOpen: scene.gate.open,
      fieldTop: scene.fieldTop,
    };
  }, KEY);
}

/** 판을 열고, 막 연 때의 누름을 거르는 동안을 기다린 뒤 판 아래쪽을 눌러 공을 출발시킨다. */
async function openAndServe(page: Page): Promise<BrickView> {
  await openApp(page);
  await startScene(page, KEY);
  await page.waitForTimeout(600);
  const { fieldTop } = await view(page);
  await tapAt(page, 120, fieldTop + FIELD_HEIGHT - 10);
  await expect.poll(async () => (await view(page)).gateOpen, { message: '누르면 공이 출발해야 한다' }).toBe(true);
  return view(page);
}

/** 캔버스 위의 논리 좌표를 페이지 좌표로 바꾼다. */
async function pagePoint(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('캔버스가 보이지 않는다');
  const scale = box.width / 240;
  return { x: box.x + x * scale, y: box.y + y * scale };
}

it('벽돌 깨기: 일시정지에서 돌아와 "준비!" 동안에는 막대도 움직이지 않는다', async ({ page }) => {
  const { fieldTop } = await openAndServe(page);
  await page.evaluate((key) => {
    const scene = window.__pocketArcade?.scene.getScene(key) as unknown as { pauseGame(): void };
    scene.pauseGame();
  }, KEY);
  await waitForScene(page, SCENE.pause);

  // 돌아온 뒤 프레임마다 멈춤이 남았는지와 막대의 자리를 적어 둔다.
  await page.evaluate((key) => {
    const scene = window.__pocketArcade?.scene.getScene(key) as unknown as Phaser.Scene & {
      board: { paddleX: number };
      grace: number;
    };
    const frames: Array<{ grace: number; paddleX: number }> = [];
    (window as unknown as { __brickFrames: typeof frames }).__brickFrames = frames;
    scene.events.on('postupdate', () => frames.push({ grace: scene.grace, paddleX: scene.board.paddleX }));
  }, KEY);
  await tapText(page, SCENE.pause, '계속하기');
  await expect.poll(() => activeScenes(page), { message: '판으로 돌아가야 한다' }).not.toContain(SCENE.pause);

  // 멈춘 동안 손가락을 판의 한쪽 끝에서 다른 끝으로 끈다.
  const y = fieldTop + FIELD_HEIGHT - 10;
  const from = await pagePoint(page, 20, y);
  const to = await pagePoint(page, 220, y);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  const dragged = await view(page);
  expect(dragged.grace, '끄는 동안 아직 멈춰 있어야 점검이 된다').toBeGreaterThan(0);

  const frames = await page.evaluate(
    () => (window as unknown as { __brickFrames: Array<{ grace: number; paddleX: number }> }).__brickFrames,
  );
  const held = frames.filter((frame) => frame.grace > 0);
  expect(held.length, '멈춘 동안의 프레임이 있어야 한다').toBeGreaterThan(3);
  for (const frame of held) expect(frame.paddleX, '멈춘 동안 막대가 서 있어야 한다').toBeCloseTo(held[0].paddleX, 6);

  // 멈춤이 끝나면 다시 손가락을 따라간다.
  await expect.poll(async () => (await view(page)).grace, { message: '멈춤이 끝나야 한다' }).toBeLessThanOrEqual(0);
  const before = (await view(page)).paddleX;
  const target = before < 120 ? 200 : 40;
  const end = await pagePoint(page, target, y);
  await page.mouse.move(end.x, end.y, { steps: 4 });
  await expect
    .poll(async () => Math.abs((await view(page)).paddleX - before), { message: '멈춤이 끝나면 막대가 다시 움직여야 한다' })
    .toBeGreaterThan(40);
});

/**
 * 그 장면이 뜨기를 페이지 안에서 기다렸다가, 뜨자마자 판 아래쪽을 누른 것을 장면에 알린다.
 * 점검 쪽에서 캔버스를 누르면 느린 기계에서는 누름이 닿기까지 0.5초 가까이 걸려서,
 * 사람이 두 번 잇달아 누르는 빠르기(0.1~0.3초)를 낼 수 없다. 그래서 장면이 받는 누름을 페이지 안에서 바로 건넨다.
 */
function pressAsSoonAsOpen(page: Page): Promise<void> {
  return page.evaluate(async (key) => {
    const game = window.__pocketArcade;
    if (!game) throw new Error('앱이 아직 뜨지 않았다');
    await new Promise<void>((done) => {
      const check = (): void => (game.scene.isActive(key) ? done() : void requestAnimationFrame(check));
      check();
    });
    const scene = game.scene.getScene(key) as unknown as Phaser.Scene & { fieldTop: number };
    const pointer = scene.input.activePointer;
    // 실제 누름처럼 자리와 누른 때를 채운 손가락
    const press = Object.assign(Object.create(pointer) as Phaser.Input.Pointer, {
      id: 41,
      worldX: 120,
      worldY: scene.fieldTop + 280,
      downTime: performance.now(),
      wasTouch: true,
      isDown: true,
    });
    scene.input.emit('pointerdown', press);
  }, KEY);
}

it('벽돌 깨기: 결과 화면의 "다시 하기"를 두 번 잇달아 눌러도 새 판의 공은 바로 떠나지 않는다', async ({ page }) => {
  await openApp(page);
  await startScene(page, KEY);
  await page.evaluate((key) => {
    const scene = window.__pocketArcade?.scene.getScene(key) as unknown as { finishMiniGame(score: number): void };
    scene.finishMiniGame(12);
  }, KEY);
  await waitForScene(page, SCENE.result);
  await tapText(page, SCENE.result, '다시 하기');
  // 두 번째 누름이 막 열린 새 판에 떨어진다.
  await pressAsSoonAsOpen(page);
  await page.waitForTimeout(300);
  const fresh = await view(page);
  expect(fresh.gateOpen, '두 번째 누름은 첫 조작이 아니다').toBe(false);
  expect(fresh.phase).toBe('serve');

  // 조금 뒤에 같은 식으로 누르면 여느 때처럼 공이 출발한다.
  await page.waitForTimeout(400);
  await pressAsSoonAsOpen(page);
  await expect.poll(async () => (await view(page)).gateOpen, { message: '다음 누름에는 출발해야 한다' }).toBe(true);
});

it('벽돌 깨기: 판이 끝날 때 "끝!" 아래의 줄이 벽돌에 겹치지 않는다', async ({ page }) => {
  await openAndServe(page);
  const sub = '벽돌이 점선에 닿았어요';
  // 공을 놓친 벌처럼 벽돌을 한꺼번에 내려보내서 판을 끝낸다. 벽돌이 점선까지 내려오는 동안은 기다리지 않고
  // 장면을 손수 돌린다. 장면의 시간은 그린 프레임 수만큼만 가서, 프레임이 드문 CI의 느린 기계에서는 2초 남짓한
  // 길이 벽시계로 10초를 넘겼다. 끝났다는 줄은 0.9초 뒤에 사라지므로 겹치는지도 그 자리에서 바로 잰다.
  const overlaps = await page.evaluate(
    ([key, label]) => {
      const scene = window.__pocketArcade?.scene.getScene(key) as unknown as
        | (Phaser.Scene & { board: { drop: number; phase: string }; update(time: number, deltaMs: number): void })
        | undefined;
      if (!scene) return ['장면이 없다'];
      scene.board = { ...scene.board, drop: 400 };
      for (let step = 0; step < 400 && scene.board.phase !== 'over'; step += 1) scene.update(0, 50);
      if (scene.board.phase !== 'over') return ['판이 끝나지 않았다'];

      const all = (list: Phaser.GameObjects.GameObject[]): Phaser.GameObjects.GameObject[] =>
        list.flatMap((item) => (item.type === 'Container' ? all((item as Phaser.GameObjects.Container).list) : [item]));
      const items = all(scene.children.list);
      const text = items.find(
        (item): item is Phaser.GameObjects.Text => item.type === 'Text' && (item as Phaser.GameObjects.Text).text === label,
      );
      if (!text) return ['끝났다는 줄이 뜨지 않았다'];
      const box = text.getBounds();
      // 벽돌 그림은 줄마다의 컨테이너 안에 든 그림이다.
      const bricks = scene.children.list
        .filter((item) => item.type === 'Container')
        .flatMap((item) => (item as Phaser.GameObjects.Container).list)
        .filter((item): item is Phaser.GameObjects.Image => item.type === 'Image' && (item as Phaser.GameObjects.Image).visible);
      return bricks
        .map((brick) => brick.getBounds())
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .filter((rect) => rect.x < box.right && rect.right > box.x && rect.y < box.bottom && rect.bottom > box.y)
        .map((rect) => `벽돌 (${Math.round(rect.x)}, ${Math.round(rect.y)})와 겹친다`);
    },
    [KEY, sub] as const,
  );
  expect(overlaps).toEqual([]);
  await expectRendering(page);
});
