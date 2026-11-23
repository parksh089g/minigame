/**
 * 화면 점검에서 앱을 다루는 도구. 앱이 자동 테스트용으로 열어 둔 window.__pocketArcade(Phaser.Game)로
 * 장면을 들여다보고, 캔버스는 사람처럼 실제로 눌러서 움직인다.
 */
import { expect, test, type Page } from '@playwright/test';

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

/** 점검 하나. 끝날 때 페이지에서 난 오류가 하나도 없어야 통과한다. */
export const it = test.extend<{ errors: string[] }>({
  errors: [
    async ({ page }, use) => {
      const errors = collectErrors(page);
      await use(errors);
      expect(errors, '페이지에서 오류가 나지 않아야 한다').toEqual([]);
    },
    { auto: true },
  ],
});

/** 그 장면이 움직이기 시작할 때까지 기다린다. */
export async function waitForScene(page: Page, key: string, timeout = 20_000): Promise<void> {
  await page.waitForFunction((k) => window.__pocketArcade?.scene.isActive(k) ?? false, key, { timeout });
}

/** 처음 하는 카드 게임에서 저절로 뜨는 규칙 안내서(src/games/rule-book.ts)를 본 것으로 적어 두는 자리 */
const RULE_BOOK_SEEN_KEY = 'pocket-arcade:rule-book-seen';

/**
 * 앱을 열고 처음 장면(보통은 허브)이 뜰 때까지 기다린다.
 * 카드 게임의 규칙 안내서는 본 것으로 적어 두어서, 다른 점검이 준비 화면을 바로 누를 수 있게 한다.
 * 안내서가 저절로 뜨는지를 보는 점검은 ruleBooks: 'fresh'로 연다.
 */
export async function openApp(page: Page, path = '/', scene = 'Hub', options: { ruleBooks?: 'seen' | 'fresh' } = {}): Promise<void> {
  if (options.ruleBooks !== 'fresh') {
    await page.addInitScript((key) => {
      try {
        if (localStorage.getItem(key) === null) {
          localStorage.setItem(key, JSON.stringify(['solitaire', 'pyramid', 'hula', 'one-card', 'high-low', 'poker']));
        }
      } catch {
        // 저장소를 못 쓰는 곳이면 안내서가 뜰 수 있다.
      }
    }, RULE_BOOK_SEEN_KEY);
  }
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

/** hiddenTexts가 볼 범위 */
export interface HiddenTextsOptions {
  /** 이 글자와 같은 층이나 그 위에 그려지는 글자만 본다. 게임 위에 덮이는 선택 창을 볼 때 그 창의 머리글을 준다. */
  from?: string;
  /** from과 같은 층의 글자는 이 높이(논리 좌표)보다 아래에 있어야 한다. 위쪽 HUD가 차지하는 높이를 준다. */
  clearTop?: number;
}

/**
 * 그 장면에서 보이는 글자 가운데 화면 밖으로 나갔거나, 그 위에 그려진 그림이나 글자에 가린 것을 "글자: 까닭"으로 모은다.
 * 모두 제대로 보이면 빈 목록이다. 칸이나 줄이 늘어 화면이 길어졌을 때 오류 없이 어긋나는 것을 잡는다.
 * 글자의 상자는 줄 높이만큼 위아래가 넉넉해서, 글자끼리는 낮은 쪽 상자 높이의 40%를 넘게 겹칠 때만 가렸다고 본다.
 */
export function hiddenTexts(page: Page, sceneKey: string, options: HiddenTextsOptions = {}): Promise<string[]> {
  return page.evaluate(
    ([key, fromLabel, clearTop]) => {
      const scene = window.__pocketArcade?.scene.getScene(key);
      if (!scene) return [`${key} 장면이 없다`];
      const camera = scene.cameras.main;
      const { width, height } = scene.scale;
      interface Box {
        left: number;
        top: number;
        right: number;
        bottom: number;
      }
      interface Item {
        object: Phaser.GameObjects.GameObject;
        depth: number;
        order: number;
        box: Box;
      }
      const items: Item[] = [];
      // 그려지는 차례대로 훑는다: 층(depth)이 낮은 것부터, 같은 층이면 먼저 넣은 것부터. 컨테이너 안의 것은 컨테이너의 층을 따른다.
      // 페이지 안에는 Phaser 이름이 따로 없어서 종류(type)로 가린다. 그래픽(Graphics)은 크기를 잴 수 없어 넣지 않는다.
      type Shown = Phaser.GameObjects.GameObject &
        Phaser.GameObjects.Components.Visible &
        Phaser.GameObjects.Components.AlphaSingle &
        Phaser.GameObjects.Components.ScrollFactor &
        Phaser.GameObjects.Components.Depth & { getBounds?: () => Phaser.Geom.Rectangle };
      const walk = (list: Phaser.GameObjects.GameObject[], depth: number | null, root: Shown | null): void => {
        for (const item of list) {
          const shown = item as Shown;
          if (!shown.visible || shown.alpha <= 0.05) continue;
          const layer = depth ?? shown.depth;
          const owner = root ?? shown;
          if (item.type === 'Container') {
            walk((item as Phaser.GameObjects.Container).list, layer, owner);
            continue;
          }
          if (item.type !== 'Text' && item.type !== 'Image' && item.type !== 'Sprite') continue;
          const bounds = shown.getBounds?.();
          if (!bounds) continue;
          const dx = camera.scrollX * owner.scrollFactorX;
          const dy = camera.scrollY * owner.scrollFactorY;
          items.push({
            object: item,
            depth: layer,
            order: items.length,
            box: { left: bounds.left - dx, top: bounds.top - dy, right: bounds.right - dx, bottom: bounds.bottom - dy },
          });
        }
      };
      const sorted = [...scene.children.list].sort((a, b) => (a as Shown).depth - (b as Shown).depth);
      walk(sorted, null, null);

      const isText = (item: Item): boolean => item.object.type === 'Text';
      const label = (item: Item): string => (item.object as Phaser.GameObjects.Text).text.replace(/\s+/g, ' ');
      const texts = items.filter((item) => isText(item) && label(item).trim() !== '');
      const fromItem = fromLabel === null ? undefined : texts.find((item) => label(item) === fromLabel);
      if (fromLabel !== null && !fromItem) return [`"${fromLabel}"가 보이지 않는다`];
      const above = (a: Item, b: Item): boolean => a.depth > b.depth || (a.depth === b.depth && a.order > b.order);
      const covers = (cover: Item, text: Item): boolean => {
        const a = cover.box;
        const b = text.box;
        const wide = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const tall = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (wide <= 1 || tall <= 1) return false;
        if (!isText(cover)) return true;
        return tall > 0.4 * Math.min(a.bottom - a.top, b.bottom - b.top);
      };

      const problems: string[] = [];
      for (const text of texts) {
        if (fromItem && text.depth < fromItem.depth) continue;
        const { box } = text;
        const where = `${Math.round(box.top)}~${Math.round(box.bottom)}`;
        if (box.left < -1 || box.top < -1 || box.right > width + 1 || box.bottom > height + 1) {
          problems.push(`${label(text)}: 화면 밖 (${where} / ${height})`);
          continue;
        }
        if (fromItem && clearTop !== null && text.depth === fromItem.depth && box.top < clearTop - 1) {
          problems.push(`${label(text)}: 위쪽 ${clearTop}까지를 차지하는 HUD 밑 (${where})`);
          continue;
        }
        const cover = items.find((other) => other !== text && above(other, text) && covers(other, text));
        if (cover) {
          const what = isText(cover) ? `"${label(cover)}"` : `그림(${(cover.object as Phaser.GameObjects.Image).texture.key})`;
          problems.push(`${label(text)}: ${what}에 가림 (${where})`);
        }
      }
      return problems;
    },
    [sceneKey, options.from ?? null, options.clearTop ?? null] as const,
  );
}

/**
 * 카드처럼 누르는 칸(Zone)에 놓인 글이 그 칸의 테두리 안쪽에 드는지 보고, 넘친 것을 "글자: 까닭"으로 모은다.
 * from 글자와 같은 층의 칸과 글만 본다(게임 위에 덮이는 선택 창의 머리글을 준다). 글의 가운데가 칸 안에 있으면 그 칸의 글이다.
 * 카드 테두리는 2px이고(drawPanel) 글 상자는 사방에 1px씩 여유가 있어서(addText), 상자가 칸의 안쪽 1px보다 밖으로 나가면
 * 글자가 테두리에 걸린다. 칸을 낮췄을 때 두 줄짜리 설명이 넘치는 것을 잡는다(그래픽은 크기를 잴 수 없어 hiddenTexts가 못 본다).
 */
export function textsOutsideCards(page: Page, sceneKey: string, from: string): Promise<string[]> {
  return page.evaluate(
    ([key, fromLabel]) => {
      const scene = window.__pocketArcade?.scene.getScene(key);
      if (!scene) return [`${key} 장면이 없다`];
      const objects = scene.children.list as Array<Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Depth>;
      const texts = objects.filter((item) => item.type === 'Text') as unknown as Phaser.GameObjects.Text[];
      const label = (text: Phaser.GameObjects.Text): string => text.text.replace(/\s+/g, ' ');
      const anchor = texts.find((text) => label(text) === fromLabel);
      if (!anchor) return [`"${fromLabel}"가 보이지 않는다`];
      const zones = objects.filter(
        (item) => item.type === 'Zone' && item.depth === anchor.depth && item.input?.enabled,
      ) as unknown as Phaser.GameObjects.Zone[];
      const cards = zones.map((zone) => zone.getBounds());
      const problems: string[] = [];
      for (const text of texts) {
        if (text.depth !== anchor.depth || !text.visible || label(text).trim() === '') continue;
        const box = text.getBounds();
        const card = cards.find((zone) => zone.contains(box.centerX, box.centerY));
        if (!card) continue;
        const inside =
          box.left >= card.left + 1 && box.right <= card.right - 1 && box.top >= card.top + 1 && box.bottom <= card.bottom - 1;
        if (!inside) {
          const where = `${Math.round(box.top)}~${Math.round(box.bottom)}`;
          problems.push(`${label(text)}: 카드(${Math.round(card.top)}~${Math.round(card.bottom)}) 테두리에 걸림 (${where})`);
        }
      }
      return problems;
    },
    [sceneKey, from] as const,
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
