/**
 * 화면 점검에서 앱을 다루는 도구. 앱이 자동 테스트용으로 열어 둔 window.__pocketArcade(Phaser.Game)로
 * 장면을 들여다보고, 캔버스는 사람처럼 실제로 눌러서 움직인다.
 */
import { expect, type Page } from '@playwright/test';

/** 앱이 그리는 논리 화면의 폭(config.ts의 GAME_WIDTH). 높이는 기기 화면의 비율을 따른다. */
const GAME_WIDTH = 240;

/**
 * 페이지에서 난 오류를 모은다: 잡히지 않은 예외(약속이 거절된 채 버려진 것 포함)와 console.error.
 * 점검이 끝날 때 이 목록이 비어 있어야 한다.
 */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console.error: ${message.text()}`);
  });
  return errors;
}

/** 그 장면이 움직이기 시작할 때까지 기다린다. */
export async function waitForScene(page: Page, key: string, timeout = 20_000): Promise<void> {
  await page.waitForFunction((k) => window.__pocketArcade?.scene.isActive(k) ?? false, key, { timeout });
}

/** 앱을 열고 처음 장면(보통은 허브)이 뜰 때까지 기다린다. */
export async function openApp(page: Page, path = '/', scene = 'Hub'): Promise<void> {
  await page.goto(path);
  await waitForScene(page, scene);
}

/** 지금 움직이는 장면들의 이름 */
export function activeScenes(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__pocketArcade?.scene.getScenes(true).map((scene) => scene.scene.key) ?? []);
}

/** 허브를 거치지 않고 그 장면을 바로 연다. 떠 있던 장면은 모두 내린다. */
export async function startScene(page: Page, key: string, data?: object): Promise<void> {
  await page.evaluate(
    ([sceneKey, startData]) => {
      const game = window.__pocketArcade;
      if (!game) throw new Error('앱이 아직 뜨지 않았다');
      for (const scene of game.scene.getScenes(false)) {
        const status = scene.sys.settings.status;
        // 시작하는 중(START, 2)부터 잠든 것(SLEEPING, 7)까지 내린다. 페이지 안에는 Phaser 이름이 따로 없어서 값으로 적는다.
        if (status >= 2 && status <= 7) game.scene.stop(scene.scene.key);
      }
      game.scene.start(sceneKey, startData);
    },
    [key, data] as const,
  );
  await waitForScene(page, key);
}

/** 캔버스가 놓인 자리. 화면 크기에 따라 비율대로 커진다. */
async function canvasBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('캔버스가 보이지 않는다');
  return box;
}

/** 논리 좌표(폭 240)의 한 점을 손가락으로 누른다. */
export async function tapAt(page: Page, x: number, y: number): Promise<void> {
  const box = await canvasBox(page);
  const scale = box.width / GAME_WIDTH;
  await page.touchscreen.tap(box.x + x * scale, box.y + y * scale);
}

/** 그 장면에서 이 글자가 적힌 것(버튼의 글 같은)이 보이는 논리 좌표. 없으면 null이다. */
export function textPoint(page: Page, sceneKey: string, text: string): Promise<{ x: number; y: number } | null> {
  return page.evaluate(
    ([key, label]) => {
      const scene = window.__pocketArcade?.scene.getScene(key);
      if (!scene) return null;
      // 컨테이너 안에 든 것까지 모두 훑는다. 페이지 안에는 Phaser 이름이 따로 없어서 종류(type)로 가린다.
      const all = (list: Phaser.GameObjects.GameObject[]): Phaser.GameObjects.GameObject[] =>
        list.flatMap((item) => (item.type === 'Container' ? all((item as Phaser.GameObjects.Container).list) : [item]));
      const found = all(scene.children.list).find(
        (item): item is Phaser.GameObjects.Text =>
          item.type === 'Text' &&
          (item as Phaser.GameObjects.Text).text === label &&
          (item as Phaser.GameObjects.Text).visible &&
          (item as Phaser.GameObjects.Text).alpha > 0,
      );
      if (!found) return null;
      const bounds = found.getBounds();
      const camera = scene.cameras.main;
      return {
        x: bounds.centerX - camera.scrollX * found.scrollFactorX,
        y: bounds.centerY - camera.scrollY * found.scrollFactorY,
      };
    },
    [sceneKey, text] as const,
  );
}

/** 그 장면에서 이 글자가 적힌 것을 찾아 누른다. 보일 때까지 잠깐 기다린다. */
export async function tapText(page: Page, sceneKey: string, text: string): Promise<void> {
  await expect
    .poll(() => textPoint(page, sceneKey, text), { message: `${sceneKey}에 "${text}"가 보여야 한다`, timeout: 10_000 })
    .not.toBeNull();
  const point = await textPoint(page, sceneKey, text);
  if (point) await tapAt(page, point.x, point.y);
}

/** 씨앗을 따르는 흉내 난수(mulberry32). 같은 씨앗이면 같은 자리를 누르므로 실패를 되풀이해 볼 수 있다. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 글을 씨앗으로 바꾼다. 게임마다, 화면 크기마다 다른 자리를 누르게 하려는 것이다. */
export function seedOf(text: string): number {
  let hash = 2166136261;
  for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

/**
 * ms 동안 캔버스 여기저기를 누르고 끌어 본다. 처음 해 보는 사람이 아무 데나 눌러 보는 것을 흉내 낸다.
 * 무엇이 열리든 상관없고, 그동안 오류가 나지 않는지만 본다.
 */
export async function scribble(page: Page, seed: number, ms: number): Promise<void> {
  const random = seededRandom(seed);
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const box = await canvasBox(page);
    const pick = (): [number, number] => [box.x + 4 + random() * (box.width - 8), box.y + 4 + random() * (box.height - 8)];
    const [x, y] = pick();
    if (random() < 0.6) {
      await page.touchscreen.tap(x, y);
    } else {
      const [toX, toY] = pick();
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(toX, toY, { steps: 3 + Math.floor(random() * 6) });
      await page.mouse.up();
    }
    await page.waitForTimeout(40 + random() * 120);
  }
}

/** 화면이 멈추지 않고 계속 그려지는지 본다. */
export async function expectRendering(page: Page): Promise<void> {
  const frame = (): Promise<number> => page.evaluate(() => window.__pocketArcade?.loop.frame ?? 0);
  const before = await frame();
  await expect.poll(frame, { message: '화면이 계속 그려져야 한다', timeout: 5_000 }).toBeGreaterThan(before);
}
