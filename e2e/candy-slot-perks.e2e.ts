/**
 * 행운 슬롯의 영구 해금과 유물을 화면에서 점검한다: 판이 끝나면 넘긴 라운드만큼 조각을 받는지, 해금 창에서 조각이 넉넉할 때만
 * 열리는지, 연 해금이 여느 판에 듣고(여섯 자리, 두 번 잠그기, 금화 더, 첫 다시 뽑기 공짜) 오늘의 판에는 듣지 않는지,
 * 조각과 해금이 앱을 다시 열어도 남는지, 해금 창과 여섯 자리의 줄에서 글자가 가리거나 화면 밖으로 나가지 않는지 본다.
 * 유물은 창의 "유물" 쪽에서 조각으로 단계가 오르는지, 조각이 모자라거나 다 올렸으면 오르지 않는지, 올린 단계가 여느 판에
 * 듣고(낮아진 목표) 오늘의 판과 이어 하는 판에는 듣지 않는지, 앱을 다시 열어도 남는지 본다.
 * 조각이나 해금, 유물을 가진 채로 시작해야 하는 점검은 앱을 열기 전에 기기의 세이브에 넣어 둔다.
 */
import './app-globals';
import { expect, type Page } from '@playwright/test';
import { GAME_WIDTH, SCENE } from '../src/config';
import { SAVE_VERSION } from '../src/core/save';
import { DAILY_LABEL } from '../src/games/candy-slot/daily';
import {
  activeNote,
  holdHowText,
  holdUsedText,
  perkLabel,
  perkOf,
  PERKS,
  PERK_TEXT,
  piecesVerdict,
  rerollLabel,
  shortNotice,
  slotsNote,
  unlockedNotice,
  type PerkState,
} from '../src/games/candy-slot/perks';
import {
  effectLine,
  keepLabel,
  keepNote,
  LEVEL_SUM_MAX,
  levelText,
  raisedNotice,
  RELIC_TEXT,
  relicOf,
  relicPrice,
  RELICS,
  relicShortNotice,
  type KeepState,
} from '../src/games/candy-slot/relics';
import {
  charmOf,
  CHARMS,
  HOLDS_PER_ROUND,
  holdsOf,
  PERK_IDS,
  PERK_PURSE,
  RELIC_MAX,
  REROLL_COST,
  SIZE,
  SLOTS,
  SLOTS_MAX,
  START_COIN,
  targetFor,
  targetOf,
  type PerkId,
  type RelicId,
  type RelicLevels,
  type RunState,
} from '../src/games/candy-slot/rules';
import { RESUME_TEXT, type SlotSave } from '../src/games/candy-slot/save';
import { SHOP_HINT } from '../src/games/candy-slot/shop-text';
import { hiddenTexts, it, openApp, startScene, tapAt, tapText, textPoint, waitForScene } from './app';

const KEY = SCENE.candySlot;
const WAIT = { timeout: 15_000 };
const ALL: PerkId[] = [...PERK_IDS];
/** 해금 창은 화면 가운데에 놓인다. 글자는 이 사이(창의 안쪽)에 있어야 한다. */
const PANEL = { left: 10, right: GAME_WIDTH - 10 };

/** 장면에서 이 점검이 들여다보는 것. 화면에서는 감춰 둔 것(private)도 페이지 안에서는 그대로 부를 수 있다. */
interface SlotView {
  run: RunState;
  busy: boolean;
  layout: {
    cell: number;
    gridLeft: number;
    gridTop: number;
    slotSize: number;
    slots: Array<{ x: number; y: number }>;
    machine: { x: number; y: number; width: number; height: number };
  };
  slotImages: Phaser.GameObjects.Image[];
  holdCol: number | null;
  /** 기계 옆의 표에 적힌 남은 잠그기의 수 */
  holdCount: Phaser.GameObjects.Text;
  time: { now: number };
  shopGuardUntil: number;
  openShop(): void;
  refreshNumbers(): void;
  settle(): void;
  trySpin(): void;
  finishFromPause(): void;
}

interface Shown {
  run: RunState;
  busy: boolean;
  holdCol: number | null;
  /** 기계 옆의 표에 적힌 남은 잠그기의 수. 표가 보이지 않으면 null이다. */
  holds: string | null;
  layout: SlotView['layout'];
  /** 부적 자리에 놓인 그림들: 왼쪽 끝과 오른쪽 끝, 위와 아래, 텍스처 이름 */
  slots: Array<{ left: number; right: number; top: number; bottom: number; key: string }>;
  height: number;
}

function view(page: Page): Promise<Shown> {
  return page.evaluate((key) => {
    const scene = window.__pocketArcade?.scene.getScene(key) as unknown as SlotView & Phaser.Scene;
    return {
      run: scene.run,
      busy: scene.busy,
      holdCol: scene.holdCol,
      holds: scene.holdCount.visible ? scene.holdCount.text : null,
      layout: scene.layout,
      slots: scene.slotImages
        .filter((image) => image.active && image.visible)
        .map((image) => {
          const box = image.getBounds();
          return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, key: image.texture.key };
        }),
      height: scene.scale.height,
    };
  }, KEY);
}

async function shown(page: Page, text: string, scene: string = KEY): Promise<boolean> {
  return (await textPoint(page, scene, text)) !== null;
}

/**
 * 앱을 열기 전에 기기(IndexedDB)의 허브 세이브에 행운 슬롯의 몫을 넣어 둔다. 앱이 뜨지 않는 같은 주소의 파일을 열고 넣어서,
 * 앱이 저장하는 것과 엇갈리지 않는다. 저장하는 곳과 이름은 core/store.ts와 같다.
 */
async function seedSlot(page: Page, slot: Partial<KeepState>): Promise<void> {
  await page.goto('/licenses/Jua-OFL.txt');
  await page.evaluate(
    (value) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('pocket-arcade');
        open.onupgradeneeded = () => open.result.createObjectStore('kv');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(value, 'save');
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    { version: SAVE_VERSION, games: {}, slot: { found: [], run: null, pieces: 0, perks: [], relics: {}, ...slot } },
  );
}

/** 기기에 저장된 허브 세이브에서 행운 슬롯의 몫을 읽는다. 아직 저장된 것이 없으면 null. 앱이 뜬 뒤에만 부른다. */
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

/** 기기에 저장된 조각과 해금 */
async function storedPerks(page: Page): Promise<PerkState | null> {
  const slot = await storedSlot(page);
  return slot ? { pieces: slot.pieces, perks: slot.perks } : null;
}

/** 기기에 저장된 조각과 유물의 단계 */
async function storedRelics(page: Page): Promise<{ pieces: number; relics: RelicLevels } | null> {
  const slot = await storedSlot(page);
  return slot ? { pieces: slot.pieces, relics: slot.relics } : null;
}

/** 페이지를 새로 열고 행운 슬롯을 다시 연다(앱을 껐다 켠 것과 같다). */
async function reopen(page: Page): Promise<void> {
  await openApp(page);
  await startScene(page, KEY);
}

/** round번째 라운드를 하고 있는 판. 규칙으로 나올 수 있는 값만 써서, 저장했다 읽어도 버려지지 않는다. */
function spinRun(round: number, patch: Partial<RunState> = {}): RunState {
  const perks = patch.perks ?? [];
  return {
    phase: 'spin',
    round,
    spinsLeft: 2,
    coin: 0,
    earned: 60 * round,
    charms: [],
    shop: null,
    afterMiss: false,
    bestSpin: 20,
    lastGrid: [0, 1, 2, 3, 4, 5, 1, 2, 0],
    holdsLeft: holdsOf({ perks }),
    seed: null,
    spinCount: round * 6 - 2,
    drawCount: round - 1,
    perks,
    relics: {},
    ...patch,
  };
}

/** round번째 라운드를 넘겨 가게가 열린 판 */
function shopRun(round: number, patch: Partial<RunState> = {}): RunState {
  return {
    ...spinRun(round, patch),
    phase: 'shop',
    spinsLeft: 0,
    coin: 99,
    spinCount: round * 6,
    drawCount: round,
    shop: { offers: ['piggy', 'wide', 'gold-bell'], rerollCost: REROLL_COST },
    ...patch,
  };
}

/** 하던 판을 바꿔 놓는다. 자리의 수 같은 화면의 것은 다음에 수를 고쳐 적을 때 그 판에 맞춰진다. */
function setRun(page: Page, run: RunState): Promise<void> {
  return page.evaluate(
    ([key, next]) => {
      (window.__pocketArcade?.scene.getScene(key) as unknown as SlotView).run = next;
    },
    [KEY, run] as const,
  );
}

/** 하던 판을 바꿔 놓고 화면의 수(목표, 금화, 남은 스핀)를 그 판에 맞게 다시 적는다. */
function showRun(page: Page, run: RunState): Promise<void> {
  return page.evaluate(
    ([key, next]) => {
      const scene = window.__pocketArcade?.scene.getScene(key) as unknown as SlotView;
      scene.run = next;
      scene.refreshNumbers();
    },
    [KEY, run] as const,
  );
}

/** 하던 판을 바꿔 놓고 가게를 연 뒤, 가게가 막 열렸을 때의 누름 막기가 풀릴 때까지 기다린다. */
async function openShopWith(page: Page, run: RunState): Promise<void> {
  await page.evaluate(
    ([key, next]) => {
      const scene = window.__pocketArcade?.scene.getScene(key) as unknown as SlotView;
      scene.run = next;
      scene.openShop();
    },
    [KEY, run] as const,
  );
  await expect.poll(() => shown(page, '부적 가게'), WAIT).toBe(true);
  await page.waitForFunction(
    (key) => {
      const scene = window.__pocketArcade?.scene.getScene(key) as unknown as SlotView;
      return scene.time.now >= scene.shopGuardUntil;
    },
    KEY,
    WAIT,
  );
}

/** 한 번 돌리고 결과까지 건너뛴다(돌리기를 누르고 곧바로 한 번 더 누른 것과 같다). 릴이 도는 것을 기다리지 않는다. */
async function spinOnce(page: Page): Promise<void> {
  const before = (await view(page)).run.spinCount;
  await page.evaluate((key) => {
    const scene = window.__pocketArcade?.scene.getScene(key) as unknown as SlotView;
    scene.trySpin();
    scene.trySpin();
  }, KEY);
  await expect
    .poll(async () => {
      const { run, busy } = await view(page);
      return run.spinCount === before + 1 && !busy;
    }, { ...WAIT, message: '스핀 하나가 끝나야 한다' })
    .toBe(true);
}

/** 목표를 채우지 못한 채 스핀을 다 쓴 판으로 바꿔 놓고 라운드를 맺는다. 판이 끝나고 결과 화면이 뜬다. */
async function failAt(page: Page, round: number): Promise<void> {
  await page.evaluate(
    ([key, next]) => {
      const scene = window.__pocketArcade?.scene.getScene(key) as unknown as SlotView;
      scene.run = next;
      scene.settle();
    },
    [KEY, spinRun(round, { spinsLeft: 0, spinCount: round * 6 })] as const,
  );
}

/** 기계의 한 열(0부터)의 가운데 칸을 누른다. */
async function tapColumn(page: Page, col: number): Promise<void> {
  const { layout } = await view(page);
  await tapAt(page, layout.gridLeft + (col + 0.5) * layout.cell, layout.gridTop + (SIZE / 2) * layout.cell);
}

/** 기계 옆의, 남은 잠그기를 적는 작은 표를 누른다. */
async function tapHoldChip(page: Page): Promise<void> {
  const { machine } = (await view(page)).layout;
  await tapAt(page, machine.x + machine.width + 13, machine.y + 21);
}

/** 부적 자리의 줄이 화면 안에 나란히 놓였는지: 자리의 수가 맞고, 화면 밖으로 나가거나 서로 겹치지 않는다. */
function expectSlotRow(now: Shown, count: number, where: string): void {
  expect(now.layout.slots, `${where}: 자리의 수`).toHaveLength(count);
  expect(now.slots, `${where}: 놓인 자리의 수`).toHaveLength(count);
  now.slots.forEach((slot, index) => {
    expect(slot.left, `${where}: ${index}번 자리의 왼쪽 끝`).toBeGreaterThanOrEqual(0);
    expect(slot.right, `${where}: ${index}번 자리의 오른쪽 끝`).toBeLessThanOrEqual(GAME_WIDTH);
    expect(slot.bottom, `${where}: ${index}번 자리의 아래 끝`).toBeLessThanOrEqual(now.height);
    if (index > 0) expect(slot.left, `${where}: ${index}번 자리가 앞 자리와 겹치지 않는다`).toBeGreaterThan(now.slots[index - 1].right);
  });
}

/** 해금 창의 글자 가운데 창의 안쪽을 벗어났거나 줄여 적은 것. 창은 머리글과 같은 층에 놓인다. */
function panelProblems(page: Page): Promise<string[]> {
  return page.evaluate(
    ([key, titleLabel, left, right]) => {
      const scene = window.__pocketArcade?.scene.getScene(key);
      const texts = (scene?.children.list ?? []).filter((item) => item.type === 'Text') as Phaser.GameObjects.Text[];
      const title = texts.find((text) => text.text === titleLabel && text.visible);
      if (!title) return [`"${titleLabel}"가 보이지 않는다`];
      const problems: string[] = [];
      for (const text of texts) {
        if (text.depth !== title.depth || !text.visible || text.text.trim() === '') continue;
        const box = text.getBounds();
        if (box.left < left || box.right > right) {
          problems.push(`${text.text}: 창 밖 (${Math.round(box.left)}~${Math.round(box.right)})`);
        }
        // 누를 때 잠깐 튀는 것(1보다 큰 것)은 괜찮고, 자리가 모자라 줄여 적은 것만 잡는다.
        if (text.scaleX < 1) problems.push(`${text.text}: 줄여 적음 (${text.scaleX.toFixed(2)})`);
      }
      return problems;
    },
    [KEY, PERK_TEXT.title, PANEL.left, PANEL.right] as const,
  );
}

/** 해금 창에 적힌 글자들. 밑의 화면에 같은 숫자가 적혀 있어도 헷갈리지 않게, 창의 층에 놓인 것만 모은다. */
function panelTexts(page: Page): Promise<string[]> {
  return page.evaluate(
    ([key, titleLabel]) => {
      const scene = window.__pocketArcade?.scene.getScene(key);
      const texts = (scene?.children.list ?? []).filter((item) => item.type === 'Text') as Phaser.GameObjects.Text[];
      const title = texts.find((text) => text.text === titleLabel && text.visible);
      if (!title) return [];
      return texts.filter((text) => text.depth === title.depth && text.visible && text.text.trim() !== '').map((text) => text.text);
    },
    [KEY, PERK_TEXT.title] as const,
  );
}

/**
 * 시작 화면의 해금 버튼을 눌러 해금과 유물의 창을 연다. 해금이 남아 있으면 해금 쪽이, 다 열었으면 유물 쪽이 먼저 보인다.
 */
async function openPanel(page: Page, state: PerkState & { relics?: RelicLevels }): Promise<void> {
  await tapText(page, KEY, keepLabel({ relics: {}, ...state }));
  await expect.poll(() => shown(page, PERK_TEXT.noDaily), { ...WAIT, message: '해금 창이 열려야 한다' }).toBe(true);
}

/** 창의 머리글에서 쪽의 이름을 눌러 그 쪽으로 바꾼다. 그 쪽의 안내(hint)가 보일 때까지 기다린다. */
async function showTab(page: Page, title: string, hint: string): Promise<void> {
  await tapText(page, KEY, title);
  await expect.poll(() => shown(page, hint), { ...WAIT, message: `${title} 쪽이 보여야 한다` }).toBe(true);
}

/** 유물 쪽에서 그 유물의 줄 오른쪽에 있는 값 버튼을 누른다. 버튼은 이름과 같은 줄의, 창의 오른쪽 끝에 놓인다. */
async function tapRaise(page: Page, id: RelicId): Promise<void> {
  const name = await textPoint(page, KEY, relicOf(id).name);
  if (!name) throw new Error(`${relicOf(id).name}의 줄이 보이지 않는다`);
  await tapAt(page, PANEL.right - 32, name.y + 6);
}

async function closePanel(page: Page): Promise<void> {
  await tapText(page, KEY, PERK_TEXT.close);
  await expect.poll(() => shown(page, PERK_TEXT.noDaily), { ...WAIT, message: '해금 창이 닫혀야 한다' }).toBe(false);
}

it('행운 슬롯 해금: 판이 끝나면 넘긴 라운드만큼 조각을 받아 결과 화면에 적히고, 한 판에 한 번만 받는다', async ({ page }) => {
  it.slow();
  await openApp(page);
  await startScene(page, KEY);
  expect(await shown(page, perkLabel({ pieces: 0, perks: [] })), '시작 화면의 해금 버튼').toBe(true);
  expect(await hiddenTexts(page, KEY), '해금 버튼이 놓인 시작 화면').toEqual([]);

  // 넷째 라운드에서 목표를 채우지 못한 판: 세 라운드를 넘겼으니 조각 셋을 받는다.
  await failAt(page, 4);
  await expect.poll(() => storedPerks(page), { ...WAIT, message: '받은 조각이 기기에 저장되어야 한다' }).toEqual({ pieces: 3, perks: [] });
  await expect.poll(() => shown(page, '+3'), { ...WAIT, message: '끝난 판 위에 받은 조각이 뜬다' }).toBe(true);
  expect(await hiddenTexts(page, KEY), '판이 끝났다는 글과 받은 조각').toEqual([]);
  await waitForScene(page, SCENE.result);
  await expect.poll(() => shown(page, PERK_TEXT.piece, SCENE.result), WAIT).toBe(true);
  expect(await shown(page, piecesVerdict(3, 3), SCENE.result), '받은 조각과 가진 조각').toBe(true);
  await expect.poll(() => hiddenTexts(page, SCENE.result), { ...WAIT, message: '조각 줄이 놓인 결과 화면' }).toEqual([]);

  // 다시 하기로 새 판을 열어도 끝난 판의 조각을 또 받지 않는다.
  await tapText(page, SCENE.result, '다시 하기');
  await expect
    .poll(async () => (await view(page)).run, { ...WAIT, message: '새 판이 열려야 한다' })
    .toMatchObject({ round: 1, spinCount: 0, phase: 'spin' });
  await expect.poll(() => shown(page, perkLabel({ pieces: 3, perks: [] })), WAIT).toBe(true);
  expect(await storedPerks(page)).toEqual({ pieces: 3, perks: [] });

  // 가게에서 기록하고 끝낸 판: 방금 넘긴 둘째 라운드까지 조각 둘을 받아 다섯이 된다.
  await openShopWith(page, shopRun(2));
  // 붙인 부적이 없는 가게의 맨 아래에는 붙일 수 있는 수가 적힌다.
  expect(await shown(page, slotsNote(SLOTS)), '다섯 장까지').toBe(true);
  expect(await shown(page, SHOP_HINT), '붙인 부적이 없으면 눌러 보라는 안내는 없다').toBe(false);
  await page.evaluate((key) => (window.__pocketArcade?.scene.getScene(key) as unknown as SlotView).finishFromPause(), KEY);
  await waitForScene(page, SCENE.result);
  await expect.poll(() => shown(page, piecesVerdict(2, 5), SCENE.result), WAIT).toBe(true);
  await expect.poll(() => storedPerks(page), WAIT).toEqual({ pieces: 5, perks: [] });
  await expect.poll(() => hiddenTexts(page, SCENE.result), { ...WAIT, message: '둘째 판의 결과 화면' }).toEqual([]);
});

it('행운 슬롯 해금: 버리고 새 판을 고른 판은 조각을 받지 못하고, 오늘의 판을 마치면 받는다', async ({ page }) => {
  it.slow();
  await openApp(page);
  await startScene(page, KEY);

  // 두 라운드를 넘긴 판을 한 번 돌리고 두고 간다.
  await setRun(page, spinRun(3));
  await spinOnce(page);
  await expect.poll(async () => (await storedSlot(page))?.run?.run.round, { ...WAIT, message: '하던 판이 저장되어야 한다' }).toBe(3);

  // 다시 열어 새 판을 고르면 두고 간 판은 버려지고, 조각은 생기지 않는다.
  await reopen(page);
  await tapText(page, KEY, RESUME_TEXT.fresh);
  await expect.poll(async () => (await storedSlot(page))?.run, { ...WAIT, message: '두고 간 판이 지워져야 한다' }).toBeNull();
  expect(await storedPerks(page), '버린 판은 조각을 주지 않는다').toEqual({ pieces: 0, perks: [] });
  expect(await shown(page, perkLabel({ pieces: 0, perks: [] }))).toBe(true);

  // 오늘의 판에서 둘째 라운드를 넘기고 끝내면 조각 둘을 받는다.
  await tapText(page, KEY, DAILY_LABEL.name);
  await expect.poll(async () => (await view(page)).run.seed, { ...WAIT, message: '오늘의 판으로 바뀌어야 한다' }).not.toBeNull();
  const { seed } = (await view(page)).run;
  await openShopWith(page, shopRun(2, { seed }));
  await page.evaluate((key) => (window.__pocketArcade?.scene.getScene(key) as unknown as SlotView).finishFromPause(), KEY);
  await waitForScene(page, SCENE.result);
  await expect.poll(() => shown(page, piecesVerdict(2, 2), SCENE.result), WAIT).toBe(true);
  await expect.poll(() => storedPerks(page), WAIT).toEqual({ pieces: 2, perks: [] });
  await expect.poll(() => hiddenTexts(page, SCENE.result), { ...WAIT, message: '오늘의 판의 결과 화면' }).toEqual([]);
});

it('행운 슬롯 해금: 창에서 조각이 넉넉한 것만 열리고, 연 것은 다시 열어도 남는다', async ({ page }) => {
  it.slow();
  const purse = perkOf('purse');
  const reroll = perkOf('reroll');
  // 가장 싼 것 하나는 열 수 있고, 열고 나면 그다음 것에는 한 개가 모자란 만큼의 조각
  const start: PerkState = { pieces: purse.price + reroll.price - 1, perks: [] };
  await seedSlot(page, { pieces: start.pieces });
  await reopen(page);
  expect((await view(page)).run.coin, '아직 연 해금이 없다').toBe(START_COIN);
  expect(await shown(page, activeNote({ pieces: 0, perks: ['purse'] }, false) ?? ''), '연 것이 없으면 한 줄도 없다').toBe(false);

  await openPanel(page, start);
  expect(await hiddenTexts(page, KEY, { from: PERK_TEXT.title }), '해금 창').toEqual([]);
  expect(await panelProblems(page), '해금 창의 글자').toEqual([]);
  // 두 쪽의 이름, 가진 조각, 해금마다 이름과 설명과 값, 조각을 받는 법, 오늘의 판에는 듣지 않는다는 줄, 닫기
  expect([...(await panelTexts(page))].sort(), '해금 창에 적힌 것').toEqual(
    [
      PERK_TEXT.title,
      RELIC_TEXT.title,
      String(start.pieces),
      ...PERKS.flatMap((perk) => [perk.name, perk.description, String(perk.price)]),
      PERK_TEXT.how,
      PERK_TEXT.noDaily,
      PERK_TEXT.close,
    ].sort(),
  );
  // 창이 덮고 있는 동안에는 밑의 돌리기가 눌리지 않는다.
  await page.keyboard.press('Space');
  expect((await view(page)).run.spinCount).toBe(0);

  // 조각이 모자란 것을 누르면 열리지 않고, 얼마나 모자란지 알린다.
  await tapText(page, KEY, perkOf('slot').name);
  await expect.poll(() => shown(page, shortNotice(start, 'slot')), { ...WAIT, message: '모자란 조각을 알려야 한다' }).toBe(true);
  expect((await view(page)).run.perks).toEqual([]);
  expect(await hiddenTexts(page, KEY, { from: PERK_TEXT.title }), '모자라다고 알린 창').toEqual([]);
  expect(await panelProblems(page), '모자라다고 알린 창의 글자').toEqual([]);

  // 넉넉한 것을 누르면 조각을 내고 열리고, 아직 돌리지 않은 판에 바로 듣는다.
  const after: PerkState = { pieces: start.pieces - purse.price, perks: ['purse'] };
  await tapText(page, KEY, purse.name);
  await expect.poll(() => storedPerks(page), { ...WAIT, message: '연 해금이 기기에 저장되어야 한다' }).toEqual(after);
  await expect.poll(() => shown(page, unlockedNotice('purse')), WAIT).toBe(true);
  let texts = await panelTexts(page);
  expect(texts, '연 줄에는 열림이라고 적힌다').toContain(PERK_TEXT.open);
  expect(texts, '줄어든 조각').toContain(String(after.pieces));
  expect(texts, '연 줄에는 값이 없다').not.toContain(String(purse.price));
  expect(texts, '가진 조각이 바뀌었다').not.toContain(String(start.pieces));
  expect((await view(page)).run, '방금 연 해금이 켜진 판').toMatchObject({ perks: ['purse'], coin: START_COIN + PERK_PURSE, spinCount: 0 });
  // 톡 튀는 움직임이 끝난 뒤에 본다.
  await expect.poll(() => panelProblems(page), { ...WAIT, message: '연 뒤의 창의 글자' }).toEqual([]);
  expect(await hiddenTexts(page, KEY, { from: PERK_TEXT.title }), '연 뒤의 창').toEqual([]);

  // 한 개가 모자란 것은 열리지 않고, 이미 연 것은 다시 눌러도 조각이 줄지 않는다.
  await tapText(page, KEY, reroll.name);
  await expect.poll(() => shown(page, shortNotice(after, 'reroll')), WAIT).toBe(true);
  await tapText(page, KEY, purse.name);
  await expect.poll(() => shown(page, PERK_TEXT.owned), WAIT).toBe(true);
  expect(await storedPerks(page)).toEqual(after);

  // 닫으면 시작 화면의 버튼과 한 줄이 연 해금을 알린다.
  await closePanel(page);
  expect(await shown(page, perkLabel(after)), '버튼의 수가 오른다').toBe(true);
  const note = activeNote(after, false) ?? '';
  expect(await shown(page, note), `"${note}"`).toBe(true);
  expect(await hiddenTexts(page, KEY), '해금을 연 뒤의 시작 화면').toEqual([]);

  // 앱을 다시 열어도 조각과 해금이 그대로이고, 새 판은 해금을 켜고 시작한다.
  await reopen(page);
  await expect.poll(() => shown(page, perkLabel(after)), WAIT).toBe(true);
  expect(await storedPerks(page)).toEqual(after);
  expect((await view(page)).run).toMatchObject({ perks: ['purse'], coin: START_COIN + PERK_PURSE });
  await openPanel(page, after);
  texts = await panelTexts(page);
  expect(texts.filter((text) => text === PERK_TEXT.open), '연 것은 하나다').toHaveLength(1);
  expect(texts).toContain(String(after.pieces));
  expect(await hiddenTexts(page, KEY, { from: PERK_TEXT.title }), '다시 연 해금 창').toEqual([]);
});

it('행운 슬롯 해금: 다 연 여느 판은 여섯 자리와 두 번 잠그기, 금화 더로 시작하고, 오늘의 판에는 듣지 않는다', async ({ page }) => {
  it.slow();
  const owned: PerkState = { pieces: 4, perks: ALL };
  await seedSlot(page, owned);
  await reopen(page);

  // 여느 판: 해금이 모두 켜져 있다.
  let now = await view(page);
  expect(now.run).toMatchObject({ perks: ALL, seed: null, coin: START_COIN + PERK_PURSE, holdsLeft: HOLDS_PER_ROUND + 1 });
  expectSlotRow(now, SLOTS_MAX, '여느 판');
  // 해금을 다 열었으면 버튼에는 유물의 단계가 적히고, 창은 유물 쪽부터 보인다.
  expect(await shown(page, `${RELIC_TEXT.title} 0/${LEVEL_SUM_MAX}`)).toBe(true);
  expect(await shown(page, perkLabel(owned)), '해금의 수는 더 적지 않는다').toBe(false);
  expect(await shown(page, activeNote(owned, false) ?? ''), '켜진 해금을 알리는 한 줄').toBe(true);
  expect(await hiddenTexts(page, KEY), '여섯 자리의 시작 화면').toEqual([]);
  await openPanel(page, owned);
  expect(await shown(page, RELIC_TEXT.idle), '유물 쪽이 먼저 보인다').toBe(true);
  // 해금 쪽: 다 열었으면 값이 하나도 없고, 다 열었다고 적힌다.
  await showTab(page, PERK_TEXT.title, PERK_TEXT.all);
  const texts = await panelTexts(page);
  expect(texts).toContain(PERK_TEXT.all);
  expect(texts.filter((text) => text === PERK_TEXT.open), '줄마다 열림이라고 적힌다').toHaveLength(PERKS.length);
  for (const perk of PERKS) expect(texts, `${perk.name}의 값`).not.toContain(String(perk.price));
  expect(await hiddenTexts(page, KEY, { from: PERK_TEXT.title }), '다 연 해금 창').toEqual([]);
  expect(await panelProblems(page), '다 연 해금 창의 글자').toEqual([]);
  await closePanel(page);

  // 오늘의 판: 누구나 같은 조건이라 해금이 듣지 않는다. 자리도 다섯으로 돌아간다.
  await tapText(page, KEY, DAILY_LABEL.name);
  await expect.poll(async () => (await view(page)).run.seed, { ...WAIT, message: '오늘의 판으로 바뀌어야 한다' }).not.toBeNull();
  now = await view(page);
  expect(now.run).toMatchObject({ perks: [], coin: START_COIN, holdsLeft: HOLDS_PER_ROUND });
  expectSlotRow(now, SLOTS, '오늘의 판');
  await expect.poll(() => shown(page, activeNote(owned, true) ?? ''), { ...WAIT, message: '해금 없이 한다는 한 줄' }).toBe(true);
  expect(await shown(page, activeNote(owned, false) ?? '')).toBe(false);
  await expect.poll(() => hiddenTexts(page, KEY), { ...WAIT, message: '오늘의 판의 시작 화면' }).toEqual([]);

  // 여느 판으로 돌아오면 다시 켜진다.
  await tapText(page, KEY, DAILY_LABEL.back);
  await expect.poll(async () => (await view(page)).run.seed, { ...WAIT, message: '여느 판으로 돌아가야 한다' }).toBeNull();
  now = await view(page);
  expect(now.run).toMatchObject({ perks: ALL, coin: START_COIN + PERK_PURSE, holdsLeft: HOLDS_PER_ROUND + 1 });
  expectSlotRow(now, SLOTS_MAX, '돌아온 여느 판');

  // 두 번 잠그기: 한 번 돌리면 두 번 잠글 수 있다고 알리고, 한 번 쓰면 한 번 더 남는다.
  const total = HOLDS_PER_ROUND + 1;
  await spinOnce(page);
  await expect.poll(() => shown(page, holdHowText(total, total)), { ...WAIT, message: '잠그는 법을 알려야 한다' }).toBe(true);
  expect((await view(page)).holds, '남은 잠그기의 수').toBe(String(total));
  await tapColumn(page, 0);
  await expect.poll(async () => (await view(page)).holdCol, { message: '누른 열이 골라져야 한다' }).toBe(0);
  expect(await shown(page, '잠그고 돌리기')).toBe(true);
  await spinOnce(page);
  now = await view(page);
  expect(now.run.holdsLeft, '한 번 쓰면 한 번 남는다').toBe(total - 1);
  expect(now.holds, '표에도 한 번 남았다고 적힌다').toBe(String(total - 1));
  expect(now.holdCol).toBeNull();
  expect(await shown(page, '돌리기')).toBe(true);
  await tapHoldChip(page);
  await expect.poll(() => shown(page, holdHowText(total, total - 1)), { ...WAIT, message: '한 번 더 잠글 수 있다고 알려야 한다' }).toBe(true);
  // 잠깐 떴다 사라지는 알림이 지나간 뒤에는 가려진 글이 없어야 한다(여섯 자리의 줄과 남은 잠그기의 표까지).
  await expect.poll(() => hiddenTexts(page, KEY), { ...WAIT, message: '여섯 자리로 하는 판' }).toEqual([]);

  // 남은 한 번도 쓰면 더는 골라지지 않고, 두 번이라고 알린다.
  await tapColumn(page, 1);
  await expect.poll(async () => (await view(page)).holdCol, { message: '둘째 잠그기도 골라져야 한다' }).toBe(1);
  await spinOnce(page);
  expect(await view(page)).toMatchObject({ run: { holdsLeft: 0 }, holds: '0' });
  await tapColumn(page, 2);
  await expect.poll(() => shown(page, holdUsedText(total)), { ...WAIT, message: '다 썼다고 알려야 한다' }).toBe(true);
  expect((await view(page)).holdCol, '다 쓰면 열이 골라지지 않는다').toBeNull();
});

it('행운 슬롯 해금: 가게에서 여섯째 부적을 붙일 수 있고, 첫 다시 뽑기는 공짜라고 적힌다', async ({ page }) => {
  it.slow();
  const owned: PerkState = { pieces: 0, perks: ALL };
  await seedSlot(page, owned);
  await reopen(page);

  // 부적 다섯 장을 붙인 채 가게가 열린 판. 해금이 있어서 첫 다시 뽑기의 값이 0이다.
  const five = CHARMS.slice(0, SLOTS).map((charm) => charm.id);
  const offers = ['twins', 'piggy', 'crown'];
  const sixth = charmOf(offers[0]);
  if (!sixth) throw new Error('없는 부적');
  await openShopWith(page, shopRun(2, { perks: ALL, charms: five, shop: { offers, rerollCost: 0 } }));
  expect(await shown(page, rerollLabel(0)), '공짜라고 적힌다').toBe(true);
  expect(await shown(page, rerollLabel(REROLL_COST)), '값이 있을 때의 글은 없다').toBe(false);
  expect(await shown(page, slotsNote(SLOTS)), '다섯 장까지라는 글은 없다').toBe(false);
  // 붙인 부적이 있으면 맨 아래의 한 줄은 부적을 눌러 강화하거나 떼라는 안내다.
  expect(await shown(page, slotsNote(SLOTS_MAX)), '붙인 부적이 있으면 붙일 수 있는 수는 적지 않는다').toBe(false);
  expect(await shown(page, SHOP_HINT), '부적을 눌러 보라는 안내').toBe(true);
  expect(await hiddenTexts(page, KEY, { from: '부적 가게' }), '첫 다시 뽑기가 공짜인 가게').toEqual([]);

  // 여섯째 부적이 붙는다.
  await tapText(page, KEY, sixth.name);
  await expect
    .poll(async () => (await view(page)).run.charms, { ...WAIT, message: '여섯째 부적이 붙어야 한다' })
    .toEqual([...five, sixth.id]);
  // 방금 붙인 부적이 톡 튀는 움직임이 끝난 뒤에 줄을 잰다.
  await expect
    .poll(async () => {
      const { slots } = await view(page);
      return slots.length === SLOTS_MAX && slots.every((slot) => slot.right - slot.left <= 31);
    }, WAIT)
    .toBe(true);
  let now = await view(page);
  expectSlotRow(now, SLOTS_MAX, '부적 여섯 장');
  expect(now.slots.map((slot) => slot.key), '자리마다 붙인 부적의 그림').toEqual(
    [...five, sixth.id].map((id) => `candy-slot-charm-${id}`),
  );
  expect(await hiddenTexts(page, KEY), '부적 여섯 장을 붙인 가게').toEqual([]);

  // 양 끝 자리의 부적을 눌러도 설명이 제대로 뜬다.
  for (const index of [0, SLOTS_MAX - 1]) {
    const slot = now.layout.slots[index];
    await tapAt(page, slot.x + now.layout.slotSize / 2, slot.y + now.layout.slotSize / 2);
    const name = charmOf(now.run.charms[index])?.name ?? '';
    // 붙인 부적의 이름은 가게에는 없고 설명에만 적힌다.
    await expect.poll(() => shown(page, name), { ...WAIT, message: `${index}번 자리의 설명` }).toBe(true);
    expect(await shown(page, '떼기')).toBe(true);
    expect(await hiddenTexts(page, KEY, { from: '떼기' }), `${name}의 설명`).toEqual([]);
  }
  // 설명을 치운다(가게의 머리글은 누를 것이 없는 자리다).
  await tapText(page, KEY, '부적 가게');
  await expect.poll(() => shown(page, '떼기'), WAIT).toBe(false);

  // 공짜로 다시 뽑으면 금화는 그대로이고, 그다음부터는 여느 값이 적힌다.
  const before = (await view(page)).run;
  await tapText(page, KEY, rerollLabel(0));
  await expect.poll(async () => (await view(page)).run.drawCount, { ...WAIT, message: '다시 뽑혀야 한다' }).toBe(before.drawCount + 1);
  now = await view(page);
  expect(now.run.coin, '공짜라서 금화가 줄지 않는다').toBe(before.coin);
  expect(now.run.shop?.rerollCost).toBe(REROLL_COST);
  expect(await shown(page, rerollLabel(REROLL_COST))).toBe(true);
  expect(await shown(page, rerollLabel(0)), '둘째부터는 공짜가 아니다').toBe(false);
  await expect.poll(() => hiddenTexts(page, KEY, { from: '부적 가게' }), { ...WAIT, message: '다시 뽑은 뒤의 가게' }).toEqual([]);
});

it('행운 슬롯 해금: 이어 하는 판은 시작할 때의 해금을 지키고, 새 판은 지금 열어 둔 해금으로 시작한다', async ({ page }) => {
  it.slow();
  const slot = perkOf('slot');
  const start: PerkState = { pieces: slot.price + 5, perks: [] };
  await seedSlot(page, { pieces: start.pieces });
  await reopen(page);

  // 해금 없이 시작한 판을 한 번 돌리고 두고 간다.
  await spinOnce(page);
  await expect.poll(async () => (await storedSlot(page))?.run?.run.spinCount, { ...WAIT, message: '하던 판이 저장되어야 한다' }).toBe(1);
  const left = (await view(page)).run;
  expect(left.perks).toEqual([]);

  // 다시 열면 이어 할지 묻는 카드 밑에도 해금 버튼이 있다. 여기서 여섯째 자리를 연다.
  await reopen(page);
  await expect.poll(() => shown(page, RESUME_TEXT.resume), WAIT).toBe(true);
  expect(await hiddenTexts(page, KEY), '이어 할지 묻는 화면').toEqual([]);
  await openPanel(page, start);
  const after: PerkState = { pieces: start.pieces - slot.price, perks: ['slot'] };
  await tapText(page, KEY, slot.name);
  await expect.poll(() => storedPerks(page), { ...WAIT, message: '연 해금이 기기에 저장되어야 한다' }).toEqual(after);
  expect((await storedSlot(page))?.run?.run, '두고 간 판은 그대로다').toEqual(left);
  await closePanel(page);
  expect(await hiddenTexts(page, KEY), '해금을 연 뒤의 이어 할지 묻는 화면').toEqual([]);

  // 이어 한 판은 해금 없이 시작한 판 그대로라 자리가 다섯이다.
  await tapText(page, KEY, RESUME_TEXT.resume);
  await expect.poll(async () => (await view(page)).run, { ...WAIT, message: '두고 간 판이 이어져야 한다' }).toEqual(left);
  expectSlotRow(await view(page), SLOTS, '이어 한 판');

  // 다시 열어 새 판을 고르면 여섯 자리로 시작한다.
  await reopen(page);
  await tapText(page, KEY, RESUME_TEXT.fresh);
  await expect.poll(() => shown(page, '돌리기를 눌러요'), { ...WAIT, message: '새 판의 도움말이 떠야 한다' }).toBe(true);
  const fresh = await view(page);
  expect(fresh.run).toMatchObject({ perks: ['slot'], spinCount: 0 });
  expectSlotRow(fresh, SLOTS_MAX, '새 판');
  expect(await storedPerks(page)).toEqual(after);
  expect(await hiddenTexts(page, KEY), '여섯 자리로 시작한 새 판').toEqual([]);
});

it('행운 슬롯 유물: 조각으로 단계가 오르고, 모자라면 오르지 않고, 다시 열어도 남는다', async ({ page }) => {
  it.slow();
  const first = relicPrice(0);
  const second = relicPrice(1);
  if (first === null || second === null) throw new Error('값이 없는 단계');
  // 낡은 저울을 두 번 올리고 나면 다른 유물의 첫 단계에 한 개가 모자란 만큼의 조각
  const start = { pieces: first + second + first - 1, perks: [] as PerkId[], relics: {} as RelicLevels };
  await seedSlot(page, { pieces: start.pieces });
  await reopen(page);
  expect((await view(page)).run.relics, '아직 올린 유물이 없다').toEqual({});

  // 해금이 남아 있으면 해금 쪽이 먼저 보인다. 머리글의 "유물"을 누르면 유물 쪽으로 바뀐다.
  await openPanel(page, start);
  expect(await shown(page, PERK_TEXT.how)).toBe(true);
  await showTab(page, RELIC_TEXT.title, RELIC_TEXT.idle);
  expect(await shown(page, PERK_TEXT.how), '해금 쪽의 줄은 치워진다').toBe(false);
  expect(await hiddenTexts(page, KEY, { from: PERK_TEXT.title }), '유물 쪽').toEqual([]);
  expect(await panelProblems(page), '유물 쪽의 글자').toEqual([]);
  // 두 쪽의 이름, 가진 조각, 유물마다 이름과 단계와 효과와 값, 설명 칸의 안내, 오늘의 판에는 듣지 않는다는 줄, 닫기
  expect([...(await panelTexts(page))].sort(), '유물 쪽에 적힌 것').toEqual(
    [
      PERK_TEXT.title,
      RELIC_TEXT.title,
      String(start.pieces),
      ...RELICS.flatMap((relic) => [relic.name, levelText(0), effectLine(relic.id, 0), String(first)]),
      RELIC_TEXT.idle,
      PERK_TEXT.noDaily,
      PERK_TEXT.close,
    ].sort(),
  );

  // 줄의 왼쪽을 누르면 설명만 보이고 조각은 그대로다.
  const scale = relicOf('scale');
  await tapText(page, KEY, scale.name);
  await expect.poll(() => shown(page, scale.description), { ...WAIT, message: '설명이 보여야 한다' }).toBe(true);
  expect(await shown(page, RELIC_TEXT.idle), '안내 대신 설명이 적힌다').toBe(false);
  expect(await storedRelics(page)).toEqual({ pieces: start.pieces, relics: {} });
  expect(await hiddenTexts(page, KEY, { from: PERK_TEXT.title }), '설명이 보이는 유물 쪽').toEqual([]);
  expect(await panelProblems(page), '설명이 보이는 유물 쪽의 글자').toEqual([]);

  // 값 버튼을 누르면 조각을 내고 한 단계 오르고, 아직 돌리지 않은 판에 바로 듣는다.
  await tapRaise(page, 'scale');
  await expect
    .poll(() => storedRelics(page), { ...WAIT, message: '올린 단계가 기기에 저장되어야 한다' })
    .toEqual({ pieces: start.pieces - first, relics: { scale: 1 } });
  await expect.poll(() => shown(page, raisedNotice('scale', 1)), WAIT).toBe(true);
  let texts = await panelTexts(page);
  expect(texts, '단계가 오른다').toContain(levelText(1));
  expect(texts, '다음 단계의 효과').toContain(effectLine('scale', 1));
  expect(texts, '앞 단계의 효과는 지워진다').not.toContain(effectLine('scale', 0));
  expect(texts, '다음 단계의 값').toContain(String(second));
  expect(texts, '줄어든 조각').toContain(String(start.pieces - first));
  expect((await view(page)).run, '방금 올린 유물이 켜진 판').toMatchObject({ relics: { scale: 1 }, spinCount: 0, seed: null });

  // 한 번 더 올리면 둘째 단계의 값을 낸다.
  await tapRaise(page, 'scale');
  const after = { pieces: start.pieces - first - second, perks: [] as PerkId[], relics: { scale: 2 } as RelicLevels };
  await expect.poll(() => storedRelics(page), WAIT).toEqual({ pieces: after.pieces, relics: after.relics });
  await expect.poll(() => shown(page, raisedNotice('scale', 2)), WAIT).toBe(true);

  // 조각이 한 개 모자란 유물은 오르지 않고, 얼마나 모자란지 알린다.
  await tapRaise(page, 'jar');
  await expect.poll(() => shown(page, relicShortNotice(after, 'jar')), { ...WAIT, message: '모자란 조각을 알려야 한다' }).toBe(true);
  expect(await storedRelics(page)).toEqual({ pieces: after.pieces, relics: after.relics });
  expect((await view(page)).run.relics).toEqual(after.relics);
  // 톡 튀고 흔들리는 움직임이 끝난 뒤에 본다.
  await expect.poll(() => panelProblems(page), { ...WAIT, message: '올린 뒤의 유물 쪽의 글자' }).toEqual([]);
  expect(await hiddenTexts(page, KEY, { from: PERK_TEXT.title }), '올린 뒤의 유물 쪽').toEqual([]);

  // 닫으면 시작 화면의 한 줄이 켜진 유물을 알린다.
  await closePanel(page);
  const note = keepNote(after, false) ?? '';
  expect(await shown(page, note), `"${note}"`).toBe(true);
  expect(await hiddenTexts(page, KEY), '유물을 올린 뒤의 시작 화면').toEqual([]);

  // 앱을 다시 열어도 조각과 단계가 그대로이고, 새 판은 그 단계로 시작한다.
  await reopen(page);
  await expect.poll(() => shown(page, note), WAIT).toBe(true);
  expect(await storedRelics(page)).toEqual({ pieces: after.pieces, relics: after.relics });
  expect((await view(page)).run).toMatchObject({ relics: after.relics, spinCount: 0 });
  await openPanel(page, after);
  await showTab(page, RELIC_TEXT.title, RELIC_TEXT.idle);
  texts = await panelTexts(page);
  expect(texts).toContain(levelText(2));
  expect(texts).toContain(effectLine('scale', 2));
  expect(texts).toContain(String(after.pieces));
  expect(await hiddenTexts(page, KEY, { from: PERK_TEXT.title }), '다시 연 유물 쪽').toEqual([]);
});

it('행운 슬롯 유물: 끝까지 올린 유물은 "다 올림"이 되고 조각이 넘쳐도 더 오르지 않는다', async ({ page }) => {
  it.slow();
  const last = relicPrice(RELIC_MAX - 1);
  if (last === null) throw new Error('값이 없는 단계');
  // 해금은 다 열었고, 낡은 저울은 한 단계가 남았고, 상인의 도장은 다 올렸다.
  const owned = { pieces: last + 50, perks: ALL, relics: { scale: RELIC_MAX - 1, seal: RELIC_MAX } as RelicLevels };
  await seedSlot(page, owned);
  await reopen(page);
  expect((await view(page)).run.relics).toEqual(owned.relics);
  expect(await shown(page, `${RELIC_TEXT.title} ${RELIC_MAX * 2 - 1}/${LEVEL_SUM_MAX}`), '버튼에 단계의 합이 적힌다').toBe(true);
  expect(await hiddenTexts(page, KEY), '유물을 올려 둔 시작 화면').toEqual([]);

  // 해금을 다 열었으면 창은 유물 쪽부터 보인다.
  await openPanel(page, owned);
  expect(await shown(page, RELIC_TEXT.idle)).toBe(true);
  let texts = await panelTexts(page);
  expect(texts.filter((text) => text === RELIC_TEXT.max), '다 올린 유물은 하나다').toHaveLength(1);
  expect(texts.filter((text) => text === RELIC_TEXT.end)).toHaveLength(1);
  expect(texts, '다 올린 유물은 지금 값만 적는다').toContain(effectLine('seal', RELIC_MAX));
  expect(texts).toContain(effectLine('scale', RELIC_MAX - 1));
  expect(texts).toContain(String(last));
  expect(await hiddenTexts(page, KEY, { from: PERK_TEXT.title }), '다 올린 유물이 있는 유물 쪽').toEqual([]);
  expect(await panelProblems(page), '다 올린 유물이 있는 유물 쪽의 글자').toEqual([]);

  // 마지막 단계를 올리면 값 대신 "다 올림"이 적힌다.
  await tapRaise(page, 'scale');
  const full = { pieces: 50, relics: { ...owned.relics, scale: RELIC_MAX } };
  await expect.poll(() => storedRelics(page), { ...WAIT, message: '마지막 단계가 저장되어야 한다' }).toEqual(full);
  await expect.poll(() => shown(page, raisedNotice('scale', RELIC_MAX)), WAIT).toBe(true);
  texts = await panelTexts(page);
  expect(texts.filter((text) => text === RELIC_TEXT.max), '다 올린 유물이 둘이 된다').toHaveLength(2);
  expect(texts.filter((text) => text === RELIC_TEXT.end)).toHaveLength(2);
  expect(texts).toContain(effectLine('scale', RELIC_MAX));
  expect(texts, '다 올린 줄에는 값이 없다').not.toContain(String(last));

  // 다 올린 유물은 조각이 남아 있어도 더 오르지 않는다. 눌러도 조각이 줄지 않는다.
  await tapRaise(page, 'scale');
  await expect.poll(() => shown(page, RELIC_TEXT.maxed), { ...WAIT, message: '끝까지 올렸다고 알려야 한다' }).toBe(true);
  await tapRaise(page, 'seal');
  expect(await storedRelics(page)).toEqual(full);
  expect((await view(page)).run.relics).toEqual(full.relics);
  await expect.poll(() => panelProblems(page), { ...WAIT, message: '끝까지 올린 뒤의 글자' }).toEqual([]);
  expect(await hiddenTexts(page, KEY, { from: PERK_TEXT.title }), '끝까지 올린 뒤의 유물 쪽').toEqual([]);

  await closePanel(page);
  await expect.poll(() => shown(page, `${RELIC_TEXT.title} ${RELIC_MAX * 2}/${LEVEL_SUM_MAX}`), WAIT).toBe(true);
  expect(await hiddenTexts(page, KEY), '끝까지 올린 뒤의 시작 화면').toEqual([]);
});

it('행운 슬롯 유물: 여느 판은 올린 단계로 시작해 목표가 낮아지고, 오늘의 판에는 듣지 않는다', async ({ page }) => {
  it.slow();
  const owned = { pieces: 0, perks: [] as PerkId[], relics: { scale: RELIC_MAX, jar: 3 } as RelicLevels };
  await seedSlot(page, owned);
  await reopen(page);

  // 여느 판: 올린 단계가 판에 적혀 있다.
  let now = await view(page);
  expect(now.run).toMatchObject({ relics: owned.relics, seed: null, perks: [] });
  const note = keepNote(owned, false) ?? '';
  expect(await shown(page, note), `"${note}"`).toBe(true);
  expect(await hiddenTexts(page, KEY), '유물이 켜진 시작 화면').toEqual([]);

  // 목표가 큰 여덟째 라운드로 가면, 낡은 저울만큼 낮아진 목표가 적힌다.
  const round = 8;
  const low = targetFor(now.run, round);
  expect(low, '낡은 저울을 다 올리면 여덟째 라운드의 목표가 낮아진다').toBeLessThan(targetOf(round));
  await showRun(page, spinRun(round, { relics: now.run.relics }));
  await expect.poll(() => shown(page, `0 / ${low}`), { ...WAIT, message: '낮아진 목표가 적혀야 한다' }).toBe(true);
  expect(await shown(page, `0 / ${targetOf(round)}`)).toBe(false);

  // 오늘의 판: 누구나 같은 조건이라 유물이 듣지 않는다. 같은 라운드의 목표가 그대로다.
  await showRun(page, now.run);
  await tapText(page, KEY, DAILY_LABEL.name);
  await expect.poll(async () => (await view(page)).run.seed, { ...WAIT, message: '오늘의 판으로 바뀌어야 한다' }).not.toBeNull();
  now = await view(page);
  expect(now.run.relics, '오늘의 판에는 유물이 없다').toEqual({});
  const dailyNote = keepNote(owned, true) ?? '';
  await expect.poll(() => shown(page, dailyNote), { ...WAIT, message: '유물 없이 한다는 한 줄' }).toBe(true);
  expect(await shown(page, note)).toBe(false);
  await expect.poll(() => hiddenTexts(page, KEY), { ...WAIT, message: '오늘의 판의 시작 화면' }).toEqual([]);
  const daily = now.run;
  await showRun(page, spinRun(round, { seed: daily.seed, relics: daily.relics }));
  await expect.poll(() => shown(page, `0 / ${targetOf(round)}`), { ...WAIT, message: '오늘의 판의 목표는 그대로다' }).toBe(true);
  expect(await shown(page, `0 / ${low}`)).toBe(false);

  // 여느 판으로 돌아오면 다시 켜진다.
  await showRun(page, daily);
  await tapText(page, KEY, DAILY_LABEL.back);
  await expect.poll(async () => (await view(page)).run.seed, { ...WAIT, message: '여느 판으로 돌아가야 한다' }).toBeNull();
  expect((await view(page)).run.relics).toEqual(owned.relics);
  expect(await storedRelics(page), '단계는 그대로 남아 있다').toEqual({ pieces: 0, relics: owned.relics });
});

it('행운 슬롯 유물: 이어 하는 판은 시작할 때의 단계를 지키고, 새 판은 지금의 단계로 시작한다', async ({ page }) => {
  it.slow();
  const next = relicPrice(2);
  if (next === null) throw new Error('값이 없는 단계');
  const start = { pieces: next, perks: [] as PerkId[], relics: { scale: 2 } as RelicLevels };
  await seedSlot(page, start);
  await reopen(page);

  // 낡은 저울 2단계로 시작한 판을 한 번 돌리고 두고 간다.
  await spinOnce(page);
  await expect.poll(async () => (await storedSlot(page))?.run?.run.spinCount, { ...WAIT, message: '하던 판이 저장되어야 한다' }).toBe(1);
  const left = (await view(page)).run;
  expect(left.relics).toEqual({ scale: 2 });

  // 다시 열어 이어 할지 묻는 화면에서 한 단계 올린다. 두고 간 판은 그대로다.
  await reopen(page);
  await expect.poll(() => shown(page, RESUME_TEXT.resume), WAIT).toBe(true);
  await openPanel(page, start);
  await showTab(page, RELIC_TEXT.title, RELIC_TEXT.idle);
  await tapRaise(page, 'scale');
  await expect.poll(() => storedRelics(page), { ...WAIT, message: '올린 단계가 저장되어야 한다' }).toEqual({ pieces: 0, relics: { scale: 3 } });
  expect((await storedSlot(page))?.run?.run, '두고 간 판은 그대로다').toEqual(left);
  await closePanel(page);
  expect(await hiddenTexts(page, KEY), '유물을 올린 뒤의 이어 할지 묻는 화면').toEqual([]);

  // 이어 한 판은 시작할 때의 단계 그대로다.
  await tapText(page, KEY, RESUME_TEXT.resume);
  await expect.poll(async () => (await view(page)).run, { ...WAIT, message: '두고 간 판이 이어져야 한다' }).toEqual(left);

  // 다시 열어 새 판을 고르면 지금의 단계로 시작한다.
  await reopen(page);
  await tapText(page, KEY, RESUME_TEXT.fresh);
  await expect.poll(() => shown(page, '돌리기를 눌러요'), { ...WAIT, message: '새 판의 도움말이 떠야 한다' }).toBe(true);
  expect((await view(page)).run).toMatchObject({ relics: { scale: 3 }, spinCount: 0 });
  expect(await storedRelics(page)).toEqual({ pieces: 0, relics: { scale: 3 } });
});
