/**
 * 행운 슬롯의 이어 하기와 부적 도감의 화면 점검: 돌리던 판을 두고 페이지를 다시 열어도 그 자리에서 이어지는지,
 * 가게에서 부적을 사면 도감의 수가 오르는지, 도감의 창이 두 화면 크기에서 글자가 가리거나 넘치지 않는지 본다.
 * 점검마다 저장이 비어 있는 새 브라우저에서 시작한다.
 */
import './app-globals';
import { expect, type Page } from '@playwright/test';
import { SCENE } from '../src/config';
import { collectionLabel, COLLECTION_TEXT } from '../src/games/candy-slot/collection';
import { charmOf, CHARMS, HOLDS_PER_ROUND, REROLL_COST, type RunState } from '../src/games/candy-slot/rules';
import { RESUME_TEXT, resumeCaption, type SlotSave } from '../src/games/candy-slot/save';
import { hiddenTexts, it, openApp, startScene, tapAt, tapText, textPoint } from './app';

const KEY = SCENE.candySlot;
const WAIT = { timeout: 15_000 };

/** 장면에서 이 점검이 들여다보는 것 */
interface SlotView {
  run: RunState;
  busy: boolean;
  openShop(): void;
}

function runOf(page: Page): Promise<RunState> {
  return page.evaluate((key) => (window.__pocketArcade?.scene.getScene(key) as unknown as SlotView).run, KEY);
}

/**
 * 기기(IndexedDB)에 저장된 허브 세이브에서 행운 슬롯의 몫을 읽는다. 아직 저장된 것이 없으면 null.
 * 페이지를 다시 열기 전에, 방금 바뀐 판이 기기에 들어갔는지 기다리는 데 쓴다. 앱이 뜬 뒤에만 부른다.
 */
/**
 * 돌린 스핀의 결과를 끝까지 보여 줄 때까지 기다린다. 기다리는 동안 아직 보여 주고 있으면 건너뛴다(돌리기 버튼을 누른 것과 같다).
 * CI처럼 느린 곳에서는 게임의 시간이 실제보다 느리게 흘러, 연출이 끝나기를 그냥 기다리면 15초를 넘길 때가 있었다.
 * 건너뛰기가 다음 스핀을 돌리지 않도록, 보여 주는 중인지 보고 누르는 것을 한 번에 한다.
 */
async function finishSpin(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate((key) => {
          const scene = window.__pocketArcade?.scene.getScene(key) as unknown as SlotView & { trySpin(): void };
          if (scene.busy) scene.trySpin();
          return scene.busy;
        }, KEY),
      { ...WAIT, message: '스핀의 결과를 다 보여 줘야 한다' },
    )
    .toBe(false);
}

function storedSlot(page: Page): Promise<SlotSave | null> {
  return page.evaluate(
    () =>
      new Promise<SlotSave | null>((resolve) => {
        const opening = indexedDB.open('pocket-arcade');
        opening.onerror = () => resolve(null);
        opening.onsuccess = () => {
          const db = opening.result;
          if (!db.objectStoreNames.contains('kv')) {
            db.close();
            resolve(null);
            return;
          }
          const request = db.transaction('kv', 'readonly').objectStore('kv').get('save');
          request.onerror = () => {
            db.close();
            resolve(null);
          };
          request.onsuccess = () => {
            const save = request.result as { slot?: SlotSave } | undefined;
            db.close();
            resolve(save?.slot ?? null);
          };
        };
      }),
  );
}

/** 페이지를 새로 열고 행운 슬롯을 다시 연다(앱을 껐다 켠 것과 같다). */
async function reopen(page: Page): Promise<void> {
  await openApp(page);
  await startScene(page, KEY);
}

/** 첫 라운드를 넘겨 가게가 열린 판. 규칙으로 나올 수 있는 값만 써서, 저장했다 읽어도 버려지지 않는다. */
function shopRun(offers: readonly string[]): RunState {
  return {
    phase: 'shop',
    round: 1,
    spinsLeft: 0,
    coin: 99,
    earned: 120,
    charms: [],
    shop: { offers: [...offers], rerollCost: REROLL_COST },
    afterMiss: false,
    bestSpin: 20,
    lastGrid: [0, 1, 2, 3, 4, 5, 1, 2, 0],
    holdsLeft: HOLDS_PER_ROUND,
    seed: null,
    spinCount: 6,
    drawCount: 1,
    perks: [],
    relics: {},
  };
}

/** 하던 판을 바꿔 놓고 가게를 연다. */
async function openShopWith(page: Page, run: RunState): Promise<void> {
  await page.evaluate(
    ([key, next]) => {
      const scene = window.__pocketArcade?.scene.getScene(key) as unknown as SlotView;
      scene.run = next;
      scene.openShop();
    },
    [KEY, run] as const,
  );
  await expect.poll(() => textPoint(page, KEY, '부적 가게'), WAIT).not.toBeNull();
}

/** 도감의 창에 놓인 것 */
interface BookView {
  /** 부적 칸의 가운데와, 그 칸에 놓인 그림의 이름 */
  tiles: Array<{ x: number; y: number; texture: string }>;
  /** 창의 글자 가운데 머리글의 왼쪽 끝과 찾은 수의 오른쪽 끝 사이를 벗어난 것 */
  outside: string[];
}

/** 열려 있는 도감을 들여다본다. 도감은 머리글과 같은 층에 놓인다. */
function bookView(page: Page): Promise<BookView> {
  return page.evaluate(
    ([key, titleLabel]) => {
      const scene = window.__pocketArcade?.scene.getScene(key);
      const list = scene?.children.list ?? [];
      const texts = list.filter((item) => item.type === 'Text') as Phaser.GameObjects.Text[];
      const title = texts.find((text) => text.text === titleLabel && text.visible);
      if (!title) return { tiles: [], outside: [`"${titleLabel}"가 보이지 않는다`] };
      const images = list.filter((item) => item.type === 'Image') as Phaser.GameObjects.Image[];
      const tiles = images
        .filter((image) => image.depth === title.depth && image.visible && image.texture.key.startsWith('candy-slot-charm-'))
        .map((image) => ({ x: image.x, y: image.y, texture: image.texture.key }));
      const shown = texts.filter((text) => text.depth === title.depth && text.visible && text.text.trim() !== '');
      const left = title.getBounds().left;
      const right = Math.max(...shown.filter((text) => /^\d+\/\d+$/.test(text.text)).map((text) => text.getBounds().right));
      const outside = shown
        .filter((text) => text.getBounds().left < left - 1 || text.getBounds().right > right + 1)
        .map((text) => `${text.text}: ${Math.round(text.getBounds().left)}~${Math.round(text.getBounds().right)}`);
      return { tiles, outside };
    },
    [KEY, COLLECTION_TEXT.title] as const,
  );
}

it('행운 슬롯: 한 번 돌리고 페이지를 다시 열어 이어 하기를 고르면 판이 그대로다', async ({ page }) => {
  await openApp(page);
  await startScene(page, KEY);
  expect(await textPoint(page, KEY, RESUME_TEXT.resume), '두고 간 판이 없으면 묻지 않는다').toBeNull();

  await tapText(page, KEY, '돌리기');
  await expect.poll(async () => (await runOf(page)).spinCount, { ...WAIT, message: '한 번 돌아야 한다' }).toBe(1);
  await finishSpin(page);
  const before = await runOf(page);
  await expect
    .poll(async () => (await storedSlot(page))?.run?.run, { ...WAIT, message: '돌린 판이 기기에 저장되어야 한다' })
    .toEqual(before);

  // 다시 열면 처음의 도움말 대신 이어 할지 묻고, 고르기 전에는 돌리기를 받지 않는다.
  await reopen(page);
  await expect.poll(() => textPoint(page, KEY, RESUME_TEXT.resume), WAIT).not.toBeNull();
  expect(await textPoint(page, KEY, RESUME_TEXT.fresh)).not.toBeNull();
  expect(await textPoint(page, KEY, resumeCaption(before)), '어디까지 갔는지 적혀 있어야 한다').not.toBeNull();
  expect(await hiddenTexts(page, KEY), '이어 할지 묻는 화면').toEqual([]);
  await tapText(page, KEY, '돌리기');
  expect((await runOf(page)).spinCount, '고르기 전에는 돌지 않는다').toBe(0);

  await tapText(page, KEY, RESUME_TEXT.resume);
  await expect.poll(() => runOf(page), { ...WAIT, message: '두고 간 판이 그대로 이어져야 한다' }).toEqual(before);
  expect(await textPoint(page, KEY, RESUME_TEXT.resume), '고른 뒤에는 카드가 사라진다').toBeNull();

  // 이어 한 판에서 한 번 더 돌리면 그 판에서 이어진다.
  await finishSpin(page);
  await tapText(page, KEY, '돌리기');
  await expect.poll(async () => (await runOf(page)).spinCount, WAIT).toBe(2);
  expect((await runOf(page)).spinsLeft).toBe(before.spinsLeft - 1);
});

it('행운 슬롯: 새 판을 고르면 두고 간 판이 지워진다', async ({ page }) => {
  await openApp(page);
  await startScene(page, KEY);
  await tapText(page, KEY, '돌리기');
  await expect.poll(async () => (await storedSlot(page))?.run?.run.spinCount, WAIT).toBe(1);

  await reopen(page);
  await tapText(page, KEY, RESUME_TEXT.fresh);
  await expect.poll(() => textPoint(page, KEY, '돌리기를 눌러요'), { ...WAIT, message: '새 판의 도움말이 떠야 한다' }).not.toBeNull();
  expect((await runOf(page)).spinCount).toBe(0);
  await expect.poll(async () => (await storedSlot(page))?.run, { ...WAIT, message: '두고 간 판이 지워져야 한다' }).toBeNull();

  await reopen(page);
  expect(await textPoint(page, KEY, RESUME_TEXT.resume), '다시 열어도 묻지 않는다').toBeNull();
  expect(await textPoint(page, KEY, '돌리기를 눌러요')).not.toBeNull();
});

it('행운 슬롯: 가게에서 부적을 사면 도감의 수가 오르고, 다시 열어 이어 하면 같은 가게가 열린다', async ({ page }) => {
  const offers = ['piggy', 'wide', 'gold-bell'];
  const bought = charmOf(offers[0]);
  if (!bought) throw new Error('없는 부적');

  await openApp(page);
  await startScene(page, KEY);
  expect(await textPoint(page, KEY, collectionLabel([])), '시작 화면의 도감 버튼').not.toBeNull();
  await openShopWith(page, shopRun(offers));
  expect(await textPoint(page, KEY, collectionLabel([])), '가게 머리글의 도감 버튼').not.toBeNull();
  expect(await hiddenTexts(page, KEY, { from: '부적 가게' }), '도감 버튼이 놓인 가게').toEqual([]);

  await tapText(page, KEY, bought.name);
  await expect.poll(async () => (await runOf(page)).charms, { ...WAIT, message: '산 부적이 붙어야 한다' }).toEqual([bought.id]);
  await expect
    .poll(() => textPoint(page, KEY, collectionLabel([bought.id])), { ...WAIT, message: '도감의 수가 올라야 한다' })
    .not.toBeNull();
  expect(await textPoint(page, KEY, collectionLabel([]))).toBeNull();
  const before = await runOf(page);
  expect(before.shop?.offers).toEqual([null, offers[1], offers[2]]);
  await expect
    .poll(() => storedSlot(page), { ...WAIT, message: '도감과 판이 기기에 저장되어야 한다' })
    .toMatchObject({ found: [bought.id], run: { run: before } });

  // 다시 열면 시작 화면의 버튼에도 찾은 수가 적혀 있고, 이어 하면 팔리던 부적 그대로 가게가 열린다.
  await reopen(page);
  await expect.poll(() => textPoint(page, KEY, collectionLabel([bought.id])), WAIT).not.toBeNull();
  await tapText(page, KEY, RESUME_TEXT.resume);
  await expect.poll(() => textPoint(page, KEY, '부적 가게'), { ...WAIT, message: '가게가 다시 열려야 한다' }).not.toBeNull();
  expect(await runOf(page)).toEqual(before);
  for (const id of offers.slice(1)) {
    expect(await textPoint(page, KEY, charmOf(id)?.name ?? ''), `${id}가 그대로 팔리고 있어야 한다`).not.toBeNull();
  }
  expect(await hiddenTexts(page, KEY, { from: '부적 가게' }), '다시 열린 가게').toEqual([]);

  // 이어 한 가게에서 한 장을 더 사면 도감의 수가 또 오른다.
  await tapText(page, KEY, charmOf(offers[1])?.name ?? '');
  await expect
    .poll(() => textPoint(page, KEY, collectionLabel([offers[0], offers[1]])), { ...WAIT, message: '둘째 부적도 도감에 들어가야 한다' })
    .not.toBeNull();
});

it('행운 슬롯: 도감의 창에서 글자가 가리거나 화면 밖으로 나가지 않고, 찾지 못한 부적은 알려 주지 않는다', async ({ page }) => {
  await openApp(page);
  await startScene(page, KEY);

  // 아무것도 찾지 못한 도감: 시작 화면의 버튼으로 연다.
  await tapText(page, KEY, collectionLabel([]));
  await expect.poll(() => textPoint(page, KEY, COLLECTION_TEXT.title), WAIT).not.toBeNull();
  expect(await hiddenTexts(page, KEY, { from: COLLECTION_TEXT.title }), '빈 도감').toEqual([]);
  let book = await bookView(page);
  expect(book.outside, '빈 도감의 글자가 창 안에 있어야 한다').toEqual([]);
  expect(book.tiles).toHaveLength(CHARMS.length);
  expect(await textPoint(page, KEY, COLLECTION_TEXT.empty), '빈 도감의 안내').not.toBeNull();
  // 도감이 덮고 있는 동안에는 밑의 돌리기가 눌리지 않는다.
  await page.keyboard.press('Space');
  expect((await runOf(page)).spinCount).toBe(0);
  await tapText(page, KEY, COLLECTION_TEXT.close);
  await expect.poll(() => textPoint(page, KEY, COLLECTION_TEXT.title), WAIT).toBeNull();

  // 부적을 하나 산 뒤의 도감: 가게 위에 덮여 열린다.
  const offers = ['comfort', 'twins', 'more-diamond'];
  const found = charmOf(offers[0]);
  if (!found) throw new Error('없는 부적');
  await openShopWith(page, shopRun(offers));
  await tapText(page, KEY, found.name);
  await expect.poll(() => textPoint(page, KEY, collectionLabel([found.id])), WAIT).not.toBeNull();
  const shopping = await runOf(page);
  await tapText(page, KEY, collectionLabel([found.id]));
  await expect.poll(() => textPoint(page, KEY, COLLECTION_TEXT.title), WAIT).not.toBeNull();
  expect(await hiddenTexts(page, KEY, { from: COLLECTION_TEXT.title }), '가게 위의 도감').toEqual([]);
  expect(await textPoint(page, KEY, COLLECTION_TEXT.hint), '찾은 부적이 있을 때의 안내').not.toBeNull();

  // 칸을 눌러 본다. 찾은 부적은 이름과 설명이 나오고, 찾지 못한 부적은 물음표뿐이다.
  // 찾지 못한 칸은 모두 같은 글이 뜨니 맨 앞과 맨 끝의 칸만 누르고, 그 사이에 찾은 칸을 누른다.
  book = await bookView(page);
  expect(book.tiles).toHaveLength(CHARMS.length);
  expect(book.tiles.filter((tile) => tile.texture === `candy-slot-charm-${found.id}`), '찾은 부적은 그림이 보인다').toHaveLength(1);
  expect(book.tiles.filter((tile) => tile.texture === 'candy-slot-charm-unknown')).toHaveLength(CHARMS.length - 1);
  const foundAt = CHARMS.findIndex((charm) => charm.id === found.id);
  for (const index of new Set([0, foundAt, CHARMS.length - 1])) {
    const charm = CHARMS[index];
    const tile = book.tiles[index];
    await tapAt(page, tile.x, tile.y);
    if (charm.id === found.id) {
      await expect.poll(() => textPoint(page, KEY, charm.description), { ...WAIT, message: `${charm.id}의 설명` }).not.toBeNull();
      expect(await textPoint(page, KEY, charm.name)).not.toBeNull();
      expect(await textPoint(page, KEY, COLLECTION_TEXT.unknownDescription)).toBeNull();
    } else {
      await expect
        .poll(() => textPoint(page, KEY, COLLECTION_TEXT.unknownDescription), { ...WAIT, message: `${charm.id}는 알려 주지 않는다` })
        .not.toBeNull();
      // 가게에 나와 있는 부적의 이름은 도감 밑의 가게에 적혀 있으니, 가게에 없는 부적만 따진다.
      if (!offers.includes(charm.id)) expect(await textPoint(page, KEY, charm.name), charm.id).toBeNull();
    }
    expect(await hiddenTexts(page, KEY, { from: COLLECTION_TEXT.title }), `${charm.id}를 누른 도감`).toEqual([]);
    expect((await bookView(page)).outside, `${charm.id}를 누른 도감의 글자가 창 안에 있어야 한다`).toEqual([]);
  }

  // 닫으면 밑의 가게가 그대로다(도감 밑으로 눌림이 새지 않았다).
  await tapText(page, KEY, COLLECTION_TEXT.close);
  await expect.poll(() => textPoint(page, KEY, COLLECTION_TEXT.title), WAIT).toBeNull();
  expect(await runOf(page)).toEqual(shopping);
  expect(await hiddenTexts(page, KEY, { from: '부적 가게' }), '도감을 닫은 뒤의 가게').toEqual([]);
});
