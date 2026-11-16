/**
 * 배치 점검: 칸이나 줄이 늘어 길어지는 화면에서 글자가 화면 밖으로 나가거나 다른 것에 가리지 않는지,
 * 가장 작은 화면(320×568)과 흔한 화면(390×844)에서 본다. 화면 점검(smoke.e2e.ts)이 오류와 멈춤을 본다면,
 * 이 점검은 오류 없이 어긋나는 배치를 본다.
 */
import './app-globals';
import { expect, test, type Page } from '@playwright/test';
import { FONT_SIZE, GAME_WIDTH, SCENE, THEME_CSS } from '../src/config';
import { STAGE_LEVELS, stageRandom } from '../src/core/stages';
import { dealLevel as colorSortLevel } from '../src/games/color-sort/rules';
import {
  EVOLVE_LEVEL,
  LANTERN_GAME_ID,
  LANTERN_SCENE,
  MAX_LEVEL,
  META,
  WEAPON_ORDER,
  WEAPONS,
  type WeaponId,
} from '../src/games/lantern-keeper/data';
import { CHARMS, REROLL_COST, SLOTS, type RunState } from '../src/games/candy-slot/rules';
import { GARDEN_SCENE, UPGRADE_ORDER, UPGRADES } from '../src/games/garden-guard/data';
import { iconKey } from '../src/games/lantern-keeper/icons';
import { NEWS_GAP, newsLine, normalizeMeta, unknownNews } from '../src/games/lantern-keeper/meta';
import { echoText, upgradeDescription, upgradeTitle, type Upgrade } from '../src/games/lantern-keeper/rules';
import { levelPuzzle as pathLinkPuzzle } from '../src/games/path-link/rules';
import { levelPuzzle } from '../src/games/pin-pull/levels';
import {
  MAX_STACK,
  puzzleSeconds,
  solve,
  STAGES,
  winPoints,
  type Pin,
  type Puzzle,
} from '../src/games/pin-pull/rules';
import {
  COMPANY_SCENE,
  GUIDE_STEPS,
  LEAD,
  OFFICES,
  PROJECT_ORDER,
  PROJECTS,
  RATING,
  SKILL_LEVEL,
  SKILLS,
  STAFF,
  STAFF_ORDER,
  TIPS,
  TRAINING,
  type StaffId,
} from '../src/games/sprout-company/data';
import { buddyOf, createCompany, hasBuddy, type CompanyState } from '../src/games/sprout-company/rules';
import { hiddenTexts, it, openApp, startScene, tapAt, tapText, textPoint, textsOutsideCards, waitForScene } from './app';

/** 강화권 창, 레벨업 창, 골라내기 화면의 머리글(levelup.ts) */
const TICKET_TITLE = '무기 강화권';
const LEVEL_UP_TITLE = '레벨 업!';
const BANISH_TITLE = '골라내기';

/**
 * 창이 뜨거나 판이 이어지기를 기다리는 시간. 창은 게임 시간으로 잠깐 뒤에 뜨고(강화권은 0.55초) 처음 뜰 때는 글자와
 * 아이콘을 새로 그려서, 느린 기계에서는 기본 5초를 넘긴다. 여기서 CPU를 20배 느리게 하면 첫 강화권 창이 뜨는 데 4.5초,
 * 30배면 판이 시작되는 데에도 5초 넘게 걸렸고, GitHub의 기계에서도 첫 강화권 창을 5초 안에 못 본 적이 있다.
 */
const WAIT = { timeout: 20_000 } as const;

/** 등불지기 장면에서 이 점검이 들여다보는 것 */
interface LanternView {
  phase: string;
  sim?: {
    state: {
      weapons: Record<string, number>;
      passives: Record<string, number>;
      /** 이 판에 들고 온 영구 강화 */
      meta: Record<string, number>;
      /** 뽑아 둔 레벨업 선택지. 가진 것과 맞으면 레벨업 창에 그대로 나온다. */
      offer?: Upgrade[];
      pendingTickets: number;
      pendingLevelUps: number;
    };
    /** 지금 무기에 얹히는 배율. echo는 무기마다 덤으로 나가는 것의 힘이다. */
    mods: { echo: number };
    /** 남은 다시 뽑기와 골라내기 */
    rerolls: number;
    banishes: number;
    /** 지금 레벨업 창에 나온 선택지 */
    options(): Upgrade[];
  };
  pauseGame(): void;
}

/**
 * 등불지기의 판 밖 진행을 앱이 읽기 전에 넣어 둔다. 저장하는 곳과 이름은 meta.ts(DB_NAME, STORE_NAME, KEY)와 같고,
 * 빠진 값은 normalizeMeta가 채워 읽는다. 저장이 읽히지 않으면 잔치의 밤 단추가 없어서 점검이 바로 실패한다.
 */
async function seedLanternMeta(page: Page, meta: object): Promise<void> {
  await page.evaluate(
    (value) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('pocket-arcade-lantern');
        open.onupgradeneeded = () => open.result.createObjectStore('kv');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(value, 'meta');
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    meta,
  );
}

/**
 * 판 화면의 위쪽에서 HUD가 차지하는 높이(hud.ts의 HUD_HEIGHT). 싸움터를 그리는 view가 이 값을 받아 둔다.
 * hud.ts는 Phaser를 불러오므로 여기서 가져오지 않고, 떠 있는 장면에서 읽는다. 읽지 못하면 점검이 바로 실패한다.
 */
async function hudHeight(page: Page): Promise<number> {
  const top = await page.evaluate((key) => {
    const scene = window.__pocketArcade?.scene.getScene(key) as unknown as { view?: { frame?: { top?: number } } } | null;
    return scene?.view?.frame?.top ?? null;
  }, LANTERN_SCENE);
  if (typeof top !== 'number' || top <= 0) throw new Error('등불지기 HUD의 높이를 읽지 못했다');
  return top;
}

const phaseOf = (page: Page): Promise<string> =>
  page.evaluate((key) => (window.__pocketArcade?.scene.getScene(key) as unknown as LanternView | null)?.phase ?? '', LANTERN_SCENE);

/** 지금 레벨업 창에 나온 선택지와, 이번 판에 남은 다시 뽑기와 골라내기 */
const levelUpOf = (page: Page): Promise<{ options: Upgrade[]; rerolls: number; banishes: number }> =>
  page.evaluate((key) => {
    const sim = (window.__pocketArcade?.scene.getScene(key) as unknown as LanternView).sim!;
    return { options: sim.options(), rerolls: sim.rerolls, banishes: sim.banishes };
  }, LANTERN_SCENE);

it('등불지기 잔치의 밤: 고르는 창, 강화권 카드 넷~여섯 장(진화 카드 포함), 일시정지 빌드, 레벨업 창, 골라내기 화면이 가려지지 않는다', async ({ page }) => {
  // 판을 하나 끝까지 하는 셈이라 화면 점검 하나보다 오래 걸린다.
  test.slow();
  await openApp(page);
  // 새벽을 한 번 봐서 잔치의 밤을 고를 수 있고, 아직 고르지 않은 저장.
  // 영구 강화 "다시 뽑기"와 "골라내기"를 사 두어서 레벨업 창에 작은 버튼이 둘 다 나온다.
  await seedLanternMeta(page, { clears: 1, runs: 1, bestSeconds: 600, upgrades: { reroll: 2, sift: 2 } });
  await page.reload();
  await waitForScene(page, 'Hub');
  await startScene(page, LANTERN_SCENE);

  // 준비 화면의 잔치의 밤 단추를 눌러 고르는 창을 띄우고, 쉬움을 고른다.
  await tapText(page, LANTERN_SCENE, '잔치의 밤');
  await expect.poll(() => textPoint(page, LANTERN_SCENE, '쉬움'), { ...WAIT, message: '고르는 창이 떠야 한다' }).not.toBeNull();
  expect(await hiddenTexts(page, LANTERN_SCENE, { from: '쉬움' }), '고르는 창').toEqual([]);
  expect(await textsOutsideCards(page, LANTERN_SCENE, '쉬움'), '고르는 창의 카드').toEqual([]);
  await tapText(page, LANTERN_SCENE, '쉬움');
  await expect
    .poll(() => textPoint(page, LANTERN_SCENE, '잔치의 밤 · 쉬움'), { ...WAIT, message: '단추에 고른 난이도가 적혀야 한다' })
    .not.toBeNull();

  await tapText(page, LANTERN_SCENE, '출발!');
  await expect.poll(() => phaseOf(page), { ...WAIT, message: '판이 시작되어야 한다' }).toBe('run');

  // 강화권은 가진 무기 가운데 더 올릴 수 있는 것을 모두 카드로 보여 준다. 잔치의 밤에서는 여섯 장까지 된다.
  // 진화 카드는 설명이 길어 두 줄이 되므로, 설명이 가장 긴 무기들로 카드가 가장 높아야 하는 때도 본다.
  const longest = [...WEAPON_ORDER].sort(
    (a, b) => WEAPONS[b].evolved.description.length - WEAPONS[a].evolved.description.length,
  );
  const tickets: Array<{ name: string; weapons: readonly WeaponId[]; level: number }> = [
    { name: '강화권 카드 4장', weapons: WEAPON_ORDER.slice(0, 4), level: 2 },
    { name: '강화권 카드 5장', weapons: WEAPON_ORDER.slice(0, 5), level: 2 },
    { name: '강화권 카드 6장', weapons: WEAPON_ORDER.slice(0, 6), level: 2 },
    { name: '진화 카드 5장', weapons: longest.slice(0, 5), level: MAX_LEVEL },
    { name: '진화 카드 6장', weapons: longest.slice(0, 6), level: MAX_LEVEL },
  ];
  for (const ticket of tickets) {
    await page.evaluate(
      ([key, weapons, level]) => {
        const state = (window.__pocketArcade?.scene.getScene(key) as unknown as LanternView).sim!.state;
        state.weapons = Object.fromEntries(weapons.map((id) => [id, level]));
        state.pendingTickets = 1;
      },
      [LANTERN_SCENE, ticket.weapons, ticket.level] as const,
    );
    await expect
      .poll(() => textPoint(page, LANTERN_SCENE, TICKET_TITLE), { ...WAIT, message: `${ticket.name}: 강화권 창이 떠야 한다` })
      .not.toBeNull();
    const hidden = await hiddenTexts(page, LANTERN_SCENE, { from: TICKET_TITLE, clearTop: await hudHeight(page) });
    expect(hidden, ticket.name).toEqual([]);
    expect(await textsOutsideCards(page, LANTERN_SCENE, TICKET_TITLE), ticket.name).toEqual([]);
    // 맨 위 카드를 골라 창을 닫는다(모두 같은 레벨이면 도감의 차례). 창이 뜨고 잠깐은 눌리지 않으므로 닫힐 때까지 다시 누른다.
    const first = WEAPON_ORDER.find((id) => ticket.weapons.includes(id))!;
    const firstTitle = ticket.level + 1 >= EVOLVE_LEVEL ? WEAPONS[first].evolved.name : WEAPONS[first].name;
    await expect(async () => {
      await tapText(page, LANTERN_SCENE, firstTitle);
      expect(await textPoint(page, LANTERN_SCENE, TICKET_TITLE)).toBeNull();
    }).toPass(WAIT);
    await expect.poll(() => phaseOf(page), { ...WAIT, message: `${ticket.name}: 판이 이어져야 한다` }).toBe('run');
  }

  // 무기 여섯을 든 빌드를 일시정지 화면에서 본다.
  await page.evaluate((key) => (window.__pocketArcade?.scene.getScene(key) as unknown as LanternView).pauseGame(), LANTERN_SCENE);
  await waitForScene(page, SCENE.pause);
  await expect.poll(() => textPoint(page, SCENE.pause, '계속하기'), WAIT).not.toBeNull();
  expect(await hiddenTexts(page, SCENE.pause), '일시정지 빌드').toEqual([]);
  await tapText(page, SCENE.pause, '계속하기');
  await expect.poll(() => phaseOf(page), WAIT).toBe('run');

  // 레벨업 창: 카드 셋 아래에 다시 뽑기와 골라내기가 나란히 놓인다.
  const expectClear = async (title: string, name: string): Promise<void> => {
    const hidden = await hiddenTexts(page, LANTERN_SCENE, { from: title, clearTop: await hudHeight(page) });
    expect(hidden, name).toEqual([]);
    expect(await textsOutsideCards(page, LANTERN_SCENE, title), `${name}의 카드`).toEqual([]);
  };
  await page.evaluate((key) => {
    (window.__pocketArcade?.scene.getScene(key) as unknown as LanternView).sim!.state.pendingLevelUps = 1;
  }, LANTERN_SCENE);
  await expect.poll(() => textPoint(page, LANTERN_SCENE, LEVEL_UP_TITLE), { ...WAIT, message: '레벨업 창이 떠야 한다' }).not.toBeNull();
  const before = await levelUpOf(page);
  expect(before.rerolls, '산 만큼 다시 뽑을 수 있어야 한다').toBe(2);
  expect(before.banishes, '산 만큼 골라낼 수 있어야 한다').toBe(2);
  expect(await textPoint(page, LANTERN_SCENE, `다시 뽑기 ${before.rerolls}`), '다시 뽑기 버튼').not.toBeNull();
  expect(await textPoint(page, LANTERN_SCENE, `골라내기 ${before.banishes}`), '골라내기 버튼').not.toBeNull();
  await expectClear(LEVEL_UP_TITLE, '레벨업 창');

  // 골라내기 화면: 같은 카드에 머리글이 바뀌고 그만두기 버튼이 하나 놓인다. 창이 뜨고 잠깐은 눌리지 않으므로 바뀔 때까지 다시 누른다.
  await expect(async () => {
    await tapText(page, LANTERN_SCENE, `골라내기 ${before.banishes}`);
    expect(await textPoint(page, LANTERN_SCENE, BANISH_TITLE)).not.toBeNull();
  }).toPass(WAIT);
  expect(await textPoint(page, LANTERN_SCENE, '그만두기'), '그만두기 버튼').not.toBeNull();
  await expectClear(BANISH_TITLE, '골라내기 화면');

  // 맨 위 카드를 빼면 그 자리에 다른 것이 나온 레벨업 창으로 돌아오고, 골라내기가 한 번 줄어든다.
  const banished = before.options[0];
  await expect(async () => {
    await tapText(page, LANTERN_SCENE, upgradeTitle(banished));
    expect(await textPoint(page, LANTERN_SCENE, LEVEL_UP_TITLE)).not.toBeNull();
  }).toPass(WAIT);
  const after = await levelUpOf(page);
  expect(after.banishes, '골라내기를 한 번 썼다').toBe(before.banishes - 1);
  expect(after.options.map(upgradeTitle), '뺀 것은 다시 나오지 않는다').not.toContain(upgradeTitle(banished));
  expect(after.options.slice(1), '나머지 카드는 그대로다').toEqual(before.options.slice(1));
  expect(await textPoint(page, LANTERN_SCENE, `골라내기 ${after.banishes}`), '남은 골라내기').not.toBeNull();
  await expectClear(LEVEL_UP_TITLE, '골라낸 뒤의 레벨업 창');
});

it('등불지기 레벨업 카드: 손거울은 들고 온 곁불까지 더한 값을 적고, 고르면 적힌 그대로 덤이 나간다', async ({ page }) => {
  await openApp(page);
  // 새벽을 한 번 맞아 영구 강화 곁불을 다 올려 두고, 골라내기도 한 번 사 둔 저장.
  const echo = META.echo.maxLevel;
  await seedLanternMeta(page, { clears: 1, runs: 1, bestSeconds: 600, upgrades: { echo, sift: 1 } });
  await page.reload();
  await waitForScene(page, 'Hub');
  await startScene(page, LANTERN_SCENE);
  await tapText(page, LANTERN_SCENE, '출발!');
  await expect.poll(() => phaseOf(page), { ...WAIT, message: '판이 시작되어야 한다' }).toBe('run');
  const carried = await page.evaluate(
    (key) => (window.__pocketArcade?.scene.getScene(key) as unknown as LanternView).sim!.state.meta.echo,
    LANTERN_SCENE,
  );
  expect(carried, '이 판에 들고 온 곁불').toBe(echo);

  // 손거울을 처음 드는 카드와 다 올리는 카드. 다 올리면 온전한 하나가 되고, 곁불만큼이 약한 하나로 더 붙는다.
  // 전에는 카드가 손거울만의 값(20%, 100%)을 적어서, 곁불을 산 사람에게는 실제보다 적게 적혔다.
  const wrong = [1, MAX_LEVEL].map((level) => upgradeDescription({ type: 'passive', id: 'mirror', level }));
  for (const level of [1, MAX_LEVEL]) {
    const card: Upgrade = { type: 'passive', id: 'mirror', level };
    const text = upgradeDescription(card, { echo });
    expect(wrong, `손거울 ${level}레벨: 곁불이 더해진 글`).not.toContain(text);
    await page.evaluate(
      ([key, offer, owned]) => {
        const state = (window.__pocketArcade?.scene.getScene(key) as unknown as LanternView).sim!.state;
        state.passives = owned > 0 ? { mirror: owned } : {};
        state.offer = offer;
        state.pendingLevelUps = 1;
      },
      [LANTERN_SCENE, [card, { type: 'heal' }, { type: 'embers' }] satisfies Upgrade[], level - 1] as const,
    );
    await expect
      .poll(() => textPoint(page, LANTERN_SCENE, LEVEL_UP_TITLE), { ...WAIT, message: `손거울 ${level}레벨: 레벨업 창이 떠야 한다` })
      .not.toBeNull();
    expect(await textPoint(page, LANTERN_SCENE, text), `레벨업 창의 카드: ${text}`).not.toBeNull();
    // 글이 달라져도 카드 안에 가려지지 않고 들어가야 한다.
    const hidden = await hiddenTexts(page, LANTERN_SCENE, { from: LEVEL_UP_TITLE, clearTop: await hudHeight(page) });
    expect(hidden, `손거울 ${level}레벨의 레벨업 창`).toEqual([]);
    expect(await textsOutsideCards(page, LANTERN_SCENE, LEVEL_UP_TITLE), `손거울 ${level}레벨 카드`).toEqual([]);

    if (level === 1) {
      // 골라내기 화면은 같은 카드를 다시 그린다. 거기서도 같은 글이어야 한다.
      await expect(async () => {
        await tapText(page, LANTERN_SCENE, '골라내기 (1번 남음)');
        expect(await textPoint(page, LANTERN_SCENE, BANISH_TITLE)).not.toBeNull();
      }).toPass(WAIT);
      expect(await textPoint(page, LANTERN_SCENE, text), `골라내기 화면의 카드: ${text}`).not.toBeNull();
      await expect(async () => {
        await tapText(page, LANTERN_SCENE, '그만두기');
        expect(await textPoint(page, LANTERN_SCENE, LEVEL_UP_TITLE)).not.toBeNull();
      }).toPass(WAIT);
      expect(await textPoint(page, LANTERN_SCENE, text), `돌아온 레벨업 창의 카드: ${text}`).not.toBeNull();
    }

    // 카드를 고르면 무기에 얹히는 덤이 카드에 적힌 것과 같다.
    await expect(async () => {
      await tapText(page, LANTERN_SCENE, upgradeTitle(card));
      expect(await textPoint(page, LANTERN_SCENE, LEVEL_UP_TITLE)).toBeNull();
    }).toPass(WAIT);
    await expect.poll(() => phaseOf(page), { ...WAIT, message: `손거울 ${level}레벨: 판이 이어져야 한다` }).toBe('run');
    const power = await page.evaluate(
      (key) => (window.__pocketArcade?.scene.getScene(key) as unknown as LanternView).sim!.mods.echo,
      LANTERN_SCENE,
    );
    expect(echoText(power), `손거울 ${level}레벨을 고른 뒤의 덤`).toBe(text);
  }
});

/** 등불지기 준비 화면에 잠깐 뜨는 알림 */
interface NoticeView {
  /** 화면에 적힌 그대로의 글. 줄을 나눴으면 줄바꿈이 들어 있다. */
  text: string;
  lines: number;
  /** 줄인 것까지 넣은, 화면에 그려진 글씨의 크기(px) */
  fontPx: number;
  /** 글의 상자와, 그 뒤에 깔린 어두운 띠의 상자. 띠를 찾지 못하면 null이다. */
  box: { left: number; right: number; top: number; bottom: number };
  band: { left: number; right: number; top: number; bottom: number } | null;
}

it('등불지기 준비 화면: 업데이트를 여러 번 건너뛴 저장에 알리는 새 소식을 줄을 나눠 적어서, 글씨가 작아지지 않는다', async ({ page }) => {
  await openApp(page);
  // 들어온 줄 아는 것이 적혀 있지 않은 가장 오래된 저장. 캐릭터, 무기, 패시브, 스테이지, 영구 강화가 모두 새 소식이라 알림이 가장 길다.
  const save = { runs: 3, clears: 0, bestSeconds: 300 };
  const news = newsLine(unknownNews(normalizeMeta(save)));
  expect(news.split(NEWS_GAP), '새 소식의 갈래').toHaveLength(5);
  await seedLanternMeta(page, save);
  await page.reload();
  await waitForScene(page, 'Hub');
  await startScene(page, LANTERN_SCENE);

  // 알림은 몇 초 뒤에 흐려지며 사라진다. 찾으면 그 움직임을 멈춰 두어서, 보는 동안 사라지지 않게 한다.
  const noticeOf = (): Promise<NoticeView | null> =>
    page.evaluate(
      ([key, line, gap]) => {
        const scene = window.__pocketArcade?.scene.getScene(key);
        if (!scene) return null;
        const label = scene.children.list.find(
          (item): item is Phaser.GameObjects.Text =>
            item.type === 'Text' && (item as Phaser.GameObjects.Text).text.split('\n').join(gap) === line,
        );
        if (!label) return null;
        for (const tween of scene.tweens.getTweensOf(label)) tween.pause();
        const box = label.getBounds();
        // 글의 한가운데를 덮는 네모 가운데 가장 작은 것이 알림의 띠다.
        const bands = scene.children.list
          .filter((item): item is Phaser.GameObjects.Rectangle => item.type === 'Rectangle')
          .map((item) => item.getBounds())
          .filter((bounds) => bounds.contains(box.centerX, box.centerY))
          .sort((a, b) => a.width * a.height - b.width * b.height);
        const sides = (bounds: Phaser.Geom.Rectangle): NoticeView['box'] => ({
          left: bounds.left,
          right: bounds.right,
          top: bounds.top,
          bottom: bounds.bottom,
        });
        return {
          text: label.text,
          lines: label.text.split('\n').length,
          fontPx: parseFloat(String(label.style.fontSize)) * label.scaleY,
          box: sides(box),
          band: bands.length > 0 ? sides(bands[0]) : null,
        };
      },
      [LANTERN_SCENE, news, NEWS_GAP] as const,
    );
  await expect.poll(noticeOf, { ...WAIT, message: '새 소식 알림이 떠야 한다' }).not.toBeNull();
  const notice = (await noticeOf())!;
  // 한 줄에 줄여 적으면 0.39배(4.7px)가 된다. 줄을 나눠서, 앱에서 가장 작게 쓰는 글씨(10px)보다 작아지지 않아야 한다.
  expect(notice.lines, notice.text).toBeGreaterThan(1);
  expect(notice.fontPx, notice.text).toBeGreaterThanOrEqual(10);
  // 글은 어두운 띠 안에 들고, 화면 밖으로 나가거나 다른 것에 가리지 않는다.
  expect(notice.band, '알림의 띠').not.toBeNull();
  const { box } = notice;
  const band = notice.band!;
  expect(box.left, '띠의 왼쪽').toBeGreaterThanOrEqual(band.left);
  expect(box.right, '띠의 오른쪽').toBeLessThanOrEqual(band.right);
  expect(box.top, '띠의 위쪽').toBeGreaterThanOrEqual(band.top);
  expect(box.bottom, '띠의 아래쪽').toBeLessThanOrEqual(band.bottom);
  expect(await hiddenTexts(page, LANTERN_SCENE, { from: notice.text.replace(/\s+/g, ' ') }), '새 소식 알림').toEqual([]);
});

/**
 * 새싹 컴퍼니의 회사를 앱이 읽기 전에 넣어 둔다. 저장하는 곳과 이름은 sprout-company/store.ts(DB_NAME, STORE_NAME, KEY)와 같다.
 * 저장이 읽히지 않으면 회사를 새로 세우므로 출시하기 버튼이 없어서 점검이 바로 실패한다.
 */
async function seedCompany(page: Page, state: CompanyState): Promise<void> {
  await page.evaluate(
    (value) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('pocket-arcade-company');
        open.onupgradeneeded = () => open.result.createObjectStore('kv');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(value, 'state');
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    state,
  );
}

it('새싹 컴퍼니: 이름이 가장 긴 게임을 다 만들었을 때도 띠의 글자가 출시하기 버튼에 가려지지 않는다', async ({ page }) => {
  await openApp(page);
  // 가장 큰 사무실에서, 이름이 가장 긴 게임을 열세 번째로 내려는 회사. 이름 옆에 "업데이트 12"가 붙는다.
  const longest = [...PROJECT_ORDER].sort((a, b) => PROJECTS[b].title.length - PROJECTS[a].title.length)[0];
  const cards = PROJECTS[longest].cards.length;
  const state = createCompany('sprout', Date.now());
  state.office = OFFICES.length - 1;
  state.guide = GUIDE_STEPS.length;
  state.released[longest] = 12;
  state.releases = 12;
  state.project = { id: longest, done: cards, total: cards, care: cards * RATING.full };
  await seedCompany(page, state);
  await page.reload();
  await waitForScene(page, 'Hub');
  await startScene(page, COMPANY_SCENE);

  await expect.poll(() => textPoint(page, COMPANY_SCENE, '출시하기'), { ...WAIT, message: '다 만든 게임의 띠가 떠야 한다' }).not.toBeNull();
  // 띠에 놓인 글자만 본다. 회사 화면의 다른 글자들은 글 상자가 옆의 칸과 한두 픽셀씩 맞닿아 있어서 여기서 가리지 않는다.
  const strip = [PROJECTS[longest].title, '업데이트 12', '출시하기'];
  for (const label of strip) expect(await textPoint(page, COMPANY_SCENE, label), label).not.toBeNull();
  const hidden = await hiddenTexts(page, COMPANY_SCENE);
  expect(hidden.filter((line) => strip.some((label) => line.startsWith(`${label}:`))), '다 만든 게임의 띠').toEqual([]);
});

/** 새싹 컴퍼니 장면에서 이 점검이 들여다보는 것 */
interface CompanyView {
  state: CompanyState;
  /** 만드는 게임의 띠에 놓인 것들 */
  strip: { list: Array<{ type: string; text?: string }> };
}

it('새싹 컴퍼니: 만드는 게임의 띠에 끝낸 카드 수가 가려지지 않게 적히고, 카드를 끝내면 따라 오른다', async ({ page }) => {
  await openApp(page);
  // 카드가 가장 많은 게임을 스무 장 끝낸 회사. 남은 카드는 일감함과 그 뒤에 쌓여 있고, 맡은 친구는 없다.
  const biggest = [...PROJECT_ORDER].sort((a, b) => PROJECTS[b].cards.length - PROJECTS[a].cards.length)[0];
  const cards = PROJECTS[biggest].cards;
  const done = 20;
  const state = createCompany('sprout', Date.now());
  state.office = OFFICES.length - 1;
  state.guide = GUIDE_STEPS.length;
  state.project = { id: biggest, done, total: cards.length, care: done * RATING.full };
  state.backlog = cards.slice(done).map((kind) => ({ kind, left: 1000, total: 1000 }));
  await seedCompany(page, state);
  await page.reload();
  await waitForScene(page, 'Hub');
  await startScene(page, COMPANY_SCENE);

  const count = (finished: number): string => `${finished}/${cards.length}`;
  // 띠에 적힌 글자(이름, 몇 번째 출시인지, 끝낸 카드 수, 받을 잎사귀와 평판)가 서로나 꽃에 가리지 않는지 본다.
  const expectStripClear = async (name: string): Promise<void> => {
    const strip = await page.evaluate((key) => {
      const scene = window.__pocketArcade?.scene.getScene(key) as unknown as CompanyView;
      return scene.strip.list.flatMap((item) => (item.type === 'Text' && item.text ? [item.text] : []));
    }, COMPANY_SCENE);
    expect(strip, name).toContain(PROJECTS[biggest].title);
    const hidden = await hiddenTexts(page, COMPANY_SCENE);
    expect(hidden.filter((line) => strip.some((label) => line.startsWith(`${label}:`))), name).toEqual([]);
  };
  await expect.poll(() => textPoint(page, COMPANY_SCENE, count(done)), { ...WAIT, message: '끝낸 카드 수가 띠에 적혀야 한다' }).not.toBeNull();
  await expectStripClear('스무 장을 끝낸 띠');

  // 일감함의 카드 한 장을 사장의 책상에 올리고 일을 거의 끝내 둔다. 게임이 그 카드를 끝낸 것으로 세면 띠의 수도 한 장 오른다.
  await page.evaluate((key) => {
    const { state: company } = window.__pocketArcade?.scene.getScene(key) as unknown as CompanyView;
    const card = company.inbox.shift();
    if (!card) throw new Error('일감함에 카드가 없다');
    company.desks[0].task = { ...card, left: 0.001 };
  }, COMPANY_SCENE);
  await expect.poll(() => textPoint(page, COMPANY_SCENE, count(done + 1)), { ...WAIT, message: '카드를 끝내면 수가 올라야 한다' }).not.toBeNull();
  expect(await textPoint(page, COMPANY_SCENE, count(done)), '지난 수는 지워져야 한다').toBeNull();
  await expectStripClear('한 장을 더 끝낸 띠');
});

/** 새싹 컴퍼니 장면의 글자 하나: 줄여 적은 배율, 글씨 크기, 색, 화면에서의 상자 */
interface CompanyText {
  text: string;
  scale: number;
  fontPx: number;
  color: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** 새싹 컴퍼니의 겹쳐 뜬 창에 놓인 글자와 하트 그림. 창이 없으면 장면에 바로 놓인 글자(알림 같은 것)를 모은다. */
interface CompanyShown {
  texts: CompanyText[];
  /** 하트 그림(sc-heart)의 가운데 */
  hearts: Array<{ x: number; y: number }>;
}

const companyShown = (page: Page): Promise<CompanyShown> =>
  page.evaluate((key) => {
    const scene = window.__pocketArcade?.scene.getScene(key) as unknown as
      | (Phaser.Scene & { panel: Phaser.GameObjects.Container | null })
      | undefined;
    const shown: CompanyShown = { texts: [], hearts: [] };
    if (!scene) return shown;
    const walk = (list: Phaser.GameObjects.GameObject[], scale: number): void => {
      for (const item of list) {
        const seen = item as unknown as { visible: boolean; alpha: number; scaleX: number };
        if (!seen.visible || seen.alpha <= 0.05) continue;
        if (item.type === 'Container') {
          walk((item as Phaser.GameObjects.Container).list, scale * seen.scaleX);
        } else if (item.type === 'Image') {
          const image = item as Phaser.GameObjects.Image;
          if (image.texture.key === 'sc-heart') shown.hearts.push({ x: image.x, y: image.y });
        } else if (item.type === 'Text') {
          const text = item as Phaser.GameObjects.Text;
          if (text.text.trim() === '') continue;
          const box = text.getBounds();
          shown.texts.push({
            text: text.text,
            scale: Math.round(text.scaleX * scale * 1000) / 1000,
            fontPx: parseFloat(String(text.style.fontSize)),
            color: String(text.style.color),
            left: box.left,
            right: box.right,
            top: box.top,
            bottom: box.bottom,
          });
        }
      }
    };
    walk(scene.panel ? scene.panel.list : scene.children.list.filter((item) => item.type !== 'Container'), 1);
    return shown;
  }, COMPANY_SCENE);

/** 직원 창의 줄 높이의 반(SproutCompanyScene의 buildStaffPanel: 한 줄 38). 이름은 줄의 가운데에서 15 위에 적힌다. */
const STAFF_ROW_HALF = 19;
const staffRowMiddle = (name: CompanyText): number => name.top + 15;

/** 직원 창에서 그 친구의 이름이 적힌 글자. 줄의 다른 글자는 모두 더 작은 글씨다. */
const staffRowName = (shown: CompanyShown, id: StaffId): CompanyText | undefined =>
  shown.texts.find((text) => text.text === STAFF[id].name && text.fontPx === FONT_SIZE.normal);

/** 새싹 컴퍼니를 이 회사로 열고 직원 창을 띄운다. */
async function openStaffPanel(page: Page, state: CompanyState): Promise<void> {
  await seedCompany(page, state);
  await page.reload();
  await waitForScene(page, 'Hub');
  await startScene(page, COMPANY_SCENE);
  await expect.poll(() => textPoint(page, COMPANY_SCENE, '직원'), { ...WAIT, message: '회사 화면이 떠야 한다' }).not.toBeNull();
  await tapText(page, COMPANY_SCENE, '직원');
  await expect.poll(() => textPoint(page, COMPANY_SCENE, '닫기'), { ...WAIT, message: '직원 창이 떠야 한다' }).not.toBeNull();
}

it('새싹 컴퍼니 직원 창: 기술을 적는 아랫줄은 뽑을 친구든 우리 친구든 줄여 적지 않고, 레벨과 하트는 얼굴 그림에 단다', async ({ page }) => {
  await openApp(page);
  // 가장 큰 사무실에 아홉이 앉아 있고 세 자리가 비어서, 남은 셋이 뽑을 친구로 나오는 회사.
  // 열두 친구의 기술이 모두 창에 적히고, 뽑을 셋은 모두 단짝이 회사에 있다(전에는 그 이름을 같은 줄에 적느라 글씨가 가장 작아졌다).
  const members: StaffId[] = ['sprout', 'drop', 'duck', 'dog', 'ghost', 'cat', 'rabbit', 'frog', 'penguin'];
  const levels = [0, 1, SKILL_LEVEL - 1, SKILL_LEVEL, 5, TRAINING.maxLevel, 0, SKILL_LEVEL - 1, SKILL_LEVEL];
  const hopefuls: StaffId[] = ['chick', 'bear', 'fox'];
  expect([...members, ...hopefuls].sort(), '열두 친구 모두').toEqual([...STAFF_ORDER].sort());
  const state = createCompany('sprout', Date.now());
  state.office = OFFICES.length - 1;
  state.guide = GUIDE_STEPS.length;
  state.tips = Object.keys(TIPS);
  state.leaves = 1e12;
  state.desks = Array.from({ length: OFFICES[state.office].desks }, (_, index) => ({
    ...state.desks[0],
    staff: members[index] ?? null,
    level: levels[index] ?? 0,
  }));
  state.candidates = hopefuls;
  for (const id of hopefuls) expect(members, `${STAFF[id].name}의 단짝은 회사에 있다`).toContain(buddyOf(id));
  await openStaffPanel(page, state);

  // 팀장 줄의 아랫줄은 다음 단계에서 달라지는 것을 값 버튼 옆에 적는다. 어느 단계의 글도 그 자리에 줄이지 않고 들어가야 한다.
  for (const [lead, next] of LEAD.levels.entries()) {
    await page.evaluate(
      ([key, level]) => {
        (window.__pocketArcade?.scene.getScene(key) as unknown as CompanyView).state.lead = level;
      },
      [COMPANY_SCENE, lead] as const,
    );
    const lineOf = async (): Promise<CompanyText | undefined> =>
      (await companyShown(page)).texts.find((text) => text.text === next.description);
    await expect.poll(lineOf, { ...WAIT, message: `팀장 ${lead}단계의 줄: ${next.description}` }).toBeDefined();
    expect((await lineOf())?.scale, `${next.description}: 줄여 적은 배율`).toBe(1);
  }

  // 쪽을 넘겨 가며 본다. 줄이 열셋이라 두 화면 크기 모두에서 쪽이 나뉜다.
  const found = new Set<StaffId>();
  let pageCount = 1;
  for (let turn = 1; turn <= pageCount; turn += 1) {
    const shown = await companyShown(page);
    // 버튼의 값은 잎 그림 자리만큼 띄어 적어서 글 상자가 그 그림과 겹치는데, 글자가 가리지는 않는다.
    const hidden = (await hiddenTexts(page, COMPANY_SCENE, { from: '닫기' })).filter((line) => !line.includes('그림(sc-leaf)'));
    expect(hidden, `직원 창 ${turn}쪽에서 가려진 글`).toEqual([]);
    // 줄여 적는 글은 이름 옆의 덤 글뿐이어야 한다(이름이 세 글자인 친구의 "출시 보너스 +10%"가 0.8배쯤으로 줄어든다).
    // 아랫줄과 레벨 표, 창 아래의 안내는 모두 제 크기다.
    const shrunk = shown.texts.filter((text) => text.scale < 1);
    expect(shrunk.filter((text) => !/ \+\d+%$/.test(text.text)).map((text) => `${text.text} ×${text.scale}`), `직원 창 ${turn}쪽에서 줄여 적은 글`).toEqual([]);
    for (const note of shrunk) expect(note.scale, `${note.text}: 줄여 적은 배율`).toBeGreaterThanOrEqual(0.8);

    for (const id of STAFF_ORDER) {
      const name = staffRowName(shown, id);
      if (!name) continue;
      found.add(id);
      const who = STAFF[id].name;
      const middle = staffRowMiddle(name);
      const row = shown.texts.filter((text) => Math.abs((text.top + text.bottom) / 2 - middle) < STAFF_ROW_HALF);
      const desk = members.indexOf(id);
      const level = desk < 0 ? null : levels[desk];
      const open = level !== null && level >= SKILL_LEVEL;

      // 아랫줄에는 기술이 하는 일 하나만 적는다. 레벨이나 단짝의 이름을 함께 적으면 그만큼 글씨가 줄어든다.
      const description = SKILLS[STAFF[id].skill].description;
      const lines = row.filter((text) => Math.abs(text.left - name.left) < 1 && text.top > name.bottom - 2);
      expect(lines.map((text) => text.text), `${who}의 아랫줄`).toEqual([description]);
      expect(lines[0].scale, `${who}의 아랫줄을 줄여 적은 배율`).toBe(1);
      expect(lines[0].fontPx, `${who}의 아랫줄의 글씨 크기`).toBe(FONT_SIZE.small);
      // 기술이 열린 친구의 줄은 눈에 띄는 색으로, 아직 열리지 않았거나 뽑기 전인 친구의 줄은 보통 색으로 적는다.
      expect(lines[0].color, `${who}의 아랫줄의 색`).toBe(open ? THEME_CSS.good : THEME_CSS.sub);

      // 레벨은 얼굴 그림(이름의 왼쪽)에 단다: 기술이 열리기 전에는 열리는 레벨까지 얼마나 왔는지를, 열린 뒤에는 레벨만.
      const badges = row.filter((text) => text.right <= name.left);
      expect(badges.map((text) => text.text), `${who}의 레벨 표`).toEqual(
        level === null ? [] : [open ? `${level}` : `${level}/${SKILL_LEVEL}`],
      );
      for (const badge of badges) expect(badge.scale, `${who}의 레벨 표를 줄여 적은 배율`).toBe(1);

      // 하트도 얼굴 그림에 단다: 뽑을 친구는 단짝이 회사에 있을 때, 우리 친구는 단짝과 나란히 앉았을 때.
      const hearts = shown.hearts.filter((heart) => heart.x < name.left && Math.abs(heart.y - middle) < STAFF_ROW_HALF);
      expect(hearts.length, `${who}의 얼굴에 붙은 하트`).toBe(desk < 0 || hasBuddy(state, desk) ? 1 : 0);
    }

    const pager = shown.texts.map((text) => /^(\d+) \/ (\d+)$/.exec(text.text)).find((match) => match !== null);
    if (!pager) break;
    expect(Number(pager[1]), '보고 있는 쪽').toBe(turn);
    pageCount = Number(pager[2]);
    if (turn === pageCount) break;
    await tapText(page, COMPANY_SCENE, '다음');
    await expect.poll(() => textPoint(page, COMPANY_SCENE, `${turn + 1} / ${pageCount}`), WAIT).not.toBeNull();
  }
  expect(pageCount, '직원 창의 쪽 수').toBeGreaterThan(1);
  expect([...found].sort(), '창에서 본 친구').toEqual([...STAFF_ORDER].sort());
});

it('새싹 컴퍼니: 여덟 줄짜리 직원 창은 쪽을 나누지 않고, 기술이 열릴 때의 알림은 기술 이름과 설명이 서로 닿지 않으며 설명은 바탕 위에 제 크기로 적힌다', async ({
  page,
}) => {
  await openApp(page);
  // 여섯 자리 사무실에 넷이 앉아 있고, 한 번만 더 교육하면 사장의 기술이 열리는 회사.
  // 직원 창에는 뽑을 친구 셋, 팀장, 직원 넷으로 여덟 줄이 놓인다.
  const members: StaffId[] = ['sprout', 'chick', 'drop', 'duck'];
  const state = createCompany('sprout', Date.now());
  state.office = OFFICES.findIndex((office) => office.desks === 6);
  expect(state.office, '여섯 자리 사무실').toBeGreaterThanOrEqual(TRAINING.unlockOffice);
  state.guide = GUIDE_STEPS.length;
  state.tips = Object.keys(TIPS);
  state.leaves = 1e9;
  state.desks = Array.from({ length: OFFICES[state.office].desks }, (_, index) => ({
    ...state.desks[0],
    staff: members[index] ?? null,
    level: index === 0 ? SKILL_LEVEL - 1 : 0,
  }));
  await openStaffPanel(page, state);

  // 여덟 줄은 가장 작은 화면(320×568)에도 한 쪽에 다 들어간다. 창 아래의 안내가 한 줄 늘어도 이것은 지켜야 한다.
  const shown = await companyShown(page);
  expect(shown.texts.filter((text) => text.fontPx === FONT_SIZE.normal && text.left === staffRowName(shown, 'sprout')?.left), '직원 창의 줄').toHaveLength(8);
  expect(shown.texts.filter((text) => /^\d+ \/ \d+$/.test(text.text)).map((text) => text.text), '쪽 번호').toEqual([]);
  expect((await hiddenTexts(page, COMPANY_SCENE, { from: '닫기' })).filter((hidden) => !hidden.includes('그림(sc-leaf)')), '여덟 줄짜리 직원 창에서 가려진 글').toEqual([]);

  const boss = STAFF.sprout;
  const skill = SKILLS[boss.skill];
  const title = `${skill.name}!`;
  const line = `${boss.name}: ${skill.description}`;
  const name = staffRowName(shown, 'sprout');
  if (!name) throw new Error('사장의 줄이 없다');
  // 교육 버튼은 줄의 오른쪽 끝에 있다(창의 왼쪽 10 + 폭 220 - 66에서 폭 56). 알림은 곧 흐려지므로, 뜨면 그 움직임을 멈춰 둔다.
  await tapAt(page, 192, staffRowMiddle(name));
  await page.waitForFunction(
    ([key, label]) => {
      const scene = window.__pocketArcade?.scene.getScene(key);
      const up = scene?.children.list.some((item) => item.type === 'Text' && (item as Phaser.GameObjects.Text).text === label) ?? false;
      if (up) scene?.tweens.pauseAll();
      return up;
    },
    [COMPANY_SCENE, line] as const,
    { timeout: WAIT.timeout, polling: 'raf' },
  );

  // 창은 닫혔으므로 장면에 바로 놓인 글자를 본다.
  const { texts } = await companyShown(page);
  const big = texts.find((text) => text.text === title);
  const small = texts.find((text) => text.text === line);
  if (!big || !small) throw new Error(`알림의 두 줄이 보여야 한다: ${title} / ${line}`);
  // 전에는 두 줄의 글 상자가 12만큼 겹쳐서 큰 글씨의 아래와 설명의 위가 닿았다.
  expect(small.top, '설명은 기술 이름의 아래에 닿지 않게 놓인다').toBeGreaterThanOrEqual(big.bottom);
  expect(small.scale, '설명을 줄여 적은 배율').toBe(1);
  expect(small.fontPx, '설명의 글씨 크기').toBe(FONT_SIZE.normal);
  expect(small.left, '설명의 왼쪽 끝').toBeGreaterThanOrEqual(0);
  expect(small.right, '설명의 오른쪽 끝').toBeLessThanOrEqual(GAME_WIDTH);
  // 설명은 책상과 이름표 위에 뜨므로, 바로 아래에 그 글을 다 덮는 바탕이 깔려 있어야 한다.
  const plate = await page.evaluate(
    ([key, label]) => {
      const list = window.__pocketArcade?.scene.getScene(key)?.children.list ?? [];
      const at = list.findIndex((item) => item.type === 'Text' && (item as Phaser.GameObjects.Text).text === label);
      const below = list[at - 1] as Phaser.GameObjects.Image | undefined;
      if (at < 1 || !below || below.type !== 'Image') return null;
      const box = below.getBounds();
      const text = (list[at] as Phaser.GameObjects.Text).getBounds();
      return {
        covers: box.left <= text.left && box.right >= text.right && box.top <= text.top + 1 && box.bottom >= text.bottom - 1,
        alpha: below.alpha,
      };
    },
    [COMPANY_SCENE, line] as const,
  );
  expect(plate?.covers, '설명 아래에 그 글을 덮는 바탕').toBe(true);
  expect(plate?.alpha ?? 0, '바탕의 진하기').toBeGreaterThan(0.8);
});

it('결과 카드: 기록 일곱 줄과 랭킹 줄에 무기 여섯의 피해 줄까지 가려지지 않고 들어간다', async ({ page }) => {
  // 깊은 밤에서 한 잔치의 밤 판에 도전 과제까지 이룬 판의 결과. 가장 작은 화면에서는 기록 줄을 좁혀야 들어간다.
  await openApp(page);
  // 등불지기를 한 번 열어 무기 아이콘을 만들어 둔다.
  await startScene(page, LANTERN_SCENE);
  await page.evaluate(
    ([key, gameId, icons]) => {
      const game = window.__pocketArcade;
      if (!game) throw new Error('앱이 아직 뜨지 않았다');
      const rows: Array<[string, string]> = [
        ['깊은 밤 3', '점수 ×2.5 · 불씨 ×1.75'],
        ['잔치의 밤', '쉬움 · 점수와 불씨 ×0.6'],
        ['버틴 시간', '12:34'],
        ['쓰러뜨린 그림자', '1234'],
        ['레벨', '31'],
        ['얻은 불씨', '+321'],
        ['도전 과제 달성', '첫 진화'],
      ];
      game.scene.stop(key);
      game.scene.start('Result', {
        title: '등불지기',
        sceneKey: key,
        gameId,
        // 랭킹 줄이 붙는 판(최고 기록이 있다). 오늘의 도전, 업적, 주간 미션은 없다.
        result: {
          score: 1234,
          best: 2345,
          previousBest: 2345,
          isNewBest: false,
          coinsEarned: 3,
          daily: null,
          newAchievements: [],
          newMissions: [],
          lastWeekCoins: 0,
        },
        stats: rows,
        strip: { caption: '무기별 피해 (%)', chips: icons.map((texture, index) => ({ texture, label: String(30 - index * 5) })) },
      });
    },
    [LANTERN_SCENE, LANTERN_GAME_ID, WEAPON_ORDER.slice(0, 6).map((id) => iconKey(id))] as const,
  );
  await waitForScene(page, SCENE.result);
  await expect.poll(() => textPoint(page, SCENE.result, '무기별 피해 (%)'), { ...WAIT, message: '피해 줄이 빠지지 않아야 한다' }).not.toBeNull();
  expect(await hiddenTexts(page, SCENE.result), '결과 카드').toEqual([]);
});

/** 핀 뽑기 장면에서 이 점검이 들여다보는 것 */
interface PinPullView {
  stage: number;
  score: number;
  phase: string;
  /** 장면을 연 뒤로 뽑은 핀의 수 */
  pulls: number;
  timeLimit: number;
  /** 0보다 크면 시간이 흐르지 않는다. */
  grace: number;
  /** 괴물 알림을 이미 띄웠는지 */
  monsterSeen: boolean;
  puzzle: Puzzle | null;
  layout: {
    /** 방을 놓는 줄의 수 */
    floors: number;
    /** 윗줄 방의 천장 높이 */
    top: number;
    rock: Phaser.Geom.Rectangle;
    pit: Phaser.Geom.Rectangle;
    room: Phaser.Geom.Rectangle;
  };
  pinViews: Array<{ pin: Pin; handle: { x: number; y: number }; zone: Phaser.Geom.Rectangle }>;
  hints: Phaser.GameObjects.Text[];
  note: Phaser.GameObjects.Text | null;
  pinAt(x: number, y: number): unknown;
  deal(): void;
}

/** 지금 깔린 판에 대해 이 점검이 읽는 것 */
interface PinPullBoard {
  puzzle: Puzzle | null;
  floors: number;
  stage: number;
  score: number;
  pulls: number;
  timeLimit: number;
  /** 동굴 위에 떠 있는 도움말과 알림 */
  notes: string[];
  /** 동굴이 어긋난 곳을 "무엇: 까닭"으로 모은 것. 제대로 놓였으면 비어 있다. */
  problems: string[];
}

/**
 * 지금 깔린 판을 읽고, 동굴이 제대로 놓였는지 본다: 구덩이와 옆방, 핀마다 누르는 영역이 바위 안에 들고, 방은 모두 동굴 꼭대기
 * 아래에 놓이고, 손잡이를 누르면 바로 그 핀이 잡히고, 떠 있는 도움말과 알림은 목숨 아래, 동굴 꼭대기 위에 있어야 한다.
 * 방과 핀은 그래픽이라 hiddenTexts가 볼 수 없어서, 장면이 잡아 둔 자리를 읽어 견준다.
 */
const pinPullBoard = (page: Page): Promise<PinPullBoard> =>
  page.evaluate((key) => {
    const scene = window.__pocketArcade?.scene.getScene(key) as unknown as PinPullView;
    const { rock, pit, room, top, floors } = scene.layout;
    // 목숨을 그린 판이 바위 꼭대기에서 차지하는 높이(art.ts의 drawHearts: 7 내려온 곳에서 17.5)
    const heartsBottom = rock.top + 25;
    const problems: string[] = [];
    const inRock = (box: Phaser.Geom.Rectangle, label: string): void => {
      if (box.left < rock.left || box.right > rock.right || box.top < rock.top || box.bottom > rock.bottom) {
        problems.push(`${label}: 바위 밖 (${Math.round(box.top)}~${Math.round(box.bottom)} / ${rock.top}~${rock.bottom})`);
      }
    };
    inRock(pit, '구덩이');
    inRock(room, '옆방');
    for (const view of scene.pinViews) {
      const { pin, handle, zone } = view;
      const label = pin.kind === 'door' ? '문 핀' : `통로 ${pin.shaft + 1}의 ${pin.level + 1}번째 핀`;
      inRock(zone, label);
      if (pin.kind === 'chamber' && zone.top < top) problems.push(`${label}: 방이 동굴 꼭대기(${top})보다 위 (${zone.top})`);
      if (scene.pinAt(handle.x, handle.y) !== view) problems.push(`${label}: 손잡이를 눌러도 이 핀이 잡히지 않는다`);
    }
    const notes = [...scene.hints, ...(scene.note ? [scene.note] : [])];
    for (const text of notes) {
      const box = text.getBounds();
      const where = `${Math.round(box.top)}~${Math.round(box.bottom)}`;
      if (box.bottom > top) problems.push(`${text.text}: 동굴 꼭대기(${top})에 걸침 (${where})`);
      if (box.top < heartsBottom) problems.push(`${text.text}: 목숨(${heartsBottom}까지)에 걸침 (${where})`);
    }
    const { puzzle, stage, score, pulls, timeLimit } = scene;
    return { puzzle, floors, stage, score, pulls, timeLimit, notes: notes.map((text) => text.text), problems };
  }, SCENE.pinPull);

/** 판이 다 깔리거나 뽑은 핀의 뒤처리가 끝나서, 다음 핀을 누를 수 있을 때까지 기다린다. */
async function waitForPinPullIdle(page: Page): Promise<void> {
  await page.waitForFunction(
    (key) => (window.__pocketArcade?.scene.getScene(key) as unknown as PinPullView | null)?.phase === 'idle',
    SCENE.pinPull,
    WAIT,
  );
}

/** 손잡이를 차례로 눌러 핀을 뽑는다. 누를 때마다 바로 그 핀이 뽑혔는지 본다. */
async function pullPins(page: Page, order: readonly Pin[]): Promise<void> {
  const { pulls } = await pinPullBoard(page);
  for (const [index, wanted] of order.entries()) {
    await waitForPinPullIdle(page);
    const handle = await page.evaluate(
      ([key, pin]) => {
        const scene = window.__pocketArcade?.scene.getScene(key) as unknown as PinPullView;
        const same = (other: Pin): boolean =>
          pin.kind === 'door'
            ? other.kind === 'door'
            : other.kind === 'chamber' && other.shaft === pin.shaft && other.level === pin.level;
        return scene.pinViews.find((view) => same(view.pin))?.handle ?? null;
      },
      [SCENE.pinPull, wanted] as const,
    );
    if (!handle) throw new Error(`뽑을 핀이 화면에 없다: ${JSON.stringify(wanted)}`);
    await tapAt(page, handle.x, handle.y);
    await expect
      .poll(async () => (await pinPullBoard(page)).pulls, { ...WAIT, message: `${index + 1}번째 핀이 뽑혀야 한다` })
      .toBe(pulls + index + 1);
  }
}

/** 그 판을 가장 짧게 푸는 순서. 풀 수 없는 판이면 점검이 바로 실패한다. */
function shortestOrder(puzzle: Puzzle): readonly Pin[] {
  const { shortest } = solve(puzzle);
  if (!shortest) throw new Error(`풀 수 없는 판이 나왔다: ${JSON.stringify(puzzle)}`);
  return shortest;
}

it('핀 뽑기 단계 도전: 3층으로 쌓인 마지막 단계의 동굴이 바위 안에 놓이고, 손잡이를 눌러 끝까지 풀 수 있다', async ({ page }) => {
  // 핀을 여러 번 뽑고 그때마다 내용물이 내려앉기를 기다려서 화면 점검 하나보다 오래 걸린다(CPU가 20배 느리면 40초 남짓).
  // 마지막 단계에는 자물쇠가 달린 핀과 사슬로 묶인 핀도 있다. 풀이는 잠긴 핀을 열쇠 다음에 누르고, 묶인 핀은 하나만 누른다.
  test.slow();
  // 마지막 단계까지 열린 저장을 앱이 읽기 전에 넣어 둔다. 기기 안(IndexedDB)에 저장이 없으면 앱은 localStorage의 이 자리를
  // 읽는다(core/store.ts의 FALLBACK_KEY). 읽히지 않으면 잠긴 단계라 점수 도전의 1단계 판이 나와서 아래에서 바로 실패한다.
  await page.addInitScript(
    (cleared) => localStorage.setItem('pocket-arcade:save', JSON.stringify({ stages: { 'pin-pull': cleared } })),
    STAGE_LEVELS - 1,
  );
  await openApp(page);
  await startScene(page, SCENE.pinPull, { stageLevel: STAGE_LEVELS });
  await waitForPinPullIdle(page);

  const puzzle = levelPuzzle(STAGE_LEVELS);
  const board = await pinPullBoard(page);
  expect(board.puzzle, '마지막 단계에 정해진 판이 나와야 한다').toEqual(puzzle);
  expect(Math.max(...puzzle.shafts.map((chambers) => chambers.length)), '마지막 단계는 3층으로 쌓인 판이다').toBe(MAX_STACK);
  expect(board.floors, '방을 세 줄로 놓아야 한다').toBe(MAX_STACK);
  expect(board.problems, '3층 동굴의 배치').toEqual([]);

  await pullPins(page, shortestOrder(puzzle));
  await waitForScene(page, SCENE.stageResult);
});

it('핀 뽑기 점수 도전: 3층 방이 나오는 단계에서 동굴과 도움말이 제자리에 놓이고, 판을 풀면 규칙대로 점수가 오른다', async ({ page }) => {
  // 핀을 적어도 여섯 번 뽑아서 오래 걸린다.
  test.slow();
  await openApp(page);
  await startScene(page, SCENE.pinPull);
  await waitForPinPullIdle(page);

  // 3층 방이 처음 나오는 단계로 건너뛴다. 1단계의 2층 동굴에 맞춰 떠 있던 도움말 두 줄도 새 동굴에 맞춰 옮겨져야 한다.
  // 여기까지 온 사람은 괴물 알림을 이미 봤으므로(그 알림이 뜨면 도움말이 치워진다) 본 것으로 해 둔다.
  // 시간은 여기서 보는 것이 아니라서 세워 둔다. 남긴 시간이 그대로라 받는 점수도 정해진다.
  const stage = STAGES.findIndex((spec) => spec.maxStack === MAX_STACK) + 1;
  expect(stage, '3층 방이 나오는 단계가 있어야 한다').toBeGreaterThan(0);
  await page.evaluate(
    ([key, to]) => {
      const scene = window.__pocketArcade?.scene.getScene(key) as unknown as PinPullView;
      scene.stage = to;
      scene.monsterSeen = true;
      scene.deal();
      scene.grace = Infinity;
    },
    [SCENE.pinPull, stage] as const,
  );
  const board = await pinPullBoard(page);
  const puzzle = board.puzzle;
  if (!puzzle) throw new Error('판이 깔리지 않았다');
  expect(Math.max(...puzzle.shafts.map((chambers) => chambers.length)), '3층으로 쌓인 통로가 있는 판이 나와야 한다').toBe(MAX_STACK);
  expect(board.floors, '방을 세 줄로 놓아야 한다').toBe(MAX_STACK);
  expect(board.notes, '도움말 두 줄이 아직 떠 있어야 옮겨진 자리를 볼 수 있다').toHaveLength(2);
  expect(board.problems, '3층 동굴과 도움말의 배치').toEqual([]);
  // 거듭제곱은 브라우저와 Node에서 마지막 자리가 다르게 나올 수 있어서 가까운지로 견준다.
  expect(board.timeLimit, '뽑을 핀이 많은 만큼 시간을 더 준다').toBeCloseTo(puzzleSeconds(stage), 6);

  const order = shortestOrder(puzzle);
  expect(order.length, '여러 번을 뽑아야 풀리는 판이 나와야 한다').toBeGreaterThanOrEqual(STAGES[stage - 1].minPulls);
  await pullPins(page, order);
  await expect
    .poll(async () => (await pinPullBoard(page)).stage, { ...WAIT, message: '다음 단계로 넘어가야 한다' })
    .toBe(stage + 1);
  expect((await pinPullBoard(page)).score - board.score, '시간을 그대로 남기고 깬 판의 점수').toBe(
    winPoints(stage, puzzleSeconds(stage)),
  );
});

/** 행운 슬롯 장면에서 이 점검이 들여다보는 것 */
interface CandySlotView {
  run: RunState;
  busy: boolean;
  layout: { slotSize: number; slots: Array<{ x: number; y: number }> };
  openShop(): void;
}

it('행운 슬롯: 가게의 부적 세 줄과 붙인 부적의 설명, 상금이 가장 큰 확률 줄이 가려지지 않는다', async ({ page }) => {
  await openApp(page);
  await startScene(page, SCENE.candySlot);
  expect(await hiddenTexts(page, SCENE.candySlot), '시작 화면').toEqual([]);

  // 설명이 가장 긴 부적 세 장을 가게에 올리고, 상금의 자릿수가 가장 많아지는 부적들을 붙여 둔다.
  const longest = [...CHARMS].sort((a, b) => b.description.length - a.description.length).slice(0, 3);
  const widest = CHARMS.filter((charm) => charm.effect.value !== undefined && !longest.includes(charm)).slice(-(SLOTS - 1));
  await page.evaluate(
    ([key, offers, charms, rerollCost]) => {
      const scene = window.__pocketArcade?.scene.getScene(key) as unknown as CandySlotView;
      scene.run = { ...scene.run, phase: 'shop', spinsLeft: 0, coin: 999, charms, shop: { offers, rerollCost } };
      scene.openShop();
    },
    [SCENE.candySlot, longest.map((charm) => charm.id), widest.map((charm) => charm.id), REROLL_COST] as const,
  );
  await expect.poll(() => textPoint(page, SCENE.candySlot, '부적 가게'), WAIT).not.toBeNull();
  expect(await hiddenTexts(page, SCENE.candySlot, { from: '부적 가게' }), '가게').toEqual([]);

  // 한 장을 사면 그 줄은 팔린 자리가 되고, 다섯 자리가 다 찬다.
  await tapText(page, SCENE.candySlot, longest[0].name);
  const run = (): Promise<RunState> =>
    page.evaluate((key) => (window.__pocketArcade?.scene.getScene(key) as unknown as CandySlotView).run, SCENE.candySlot);
  await expect.poll(async () => (await run()).charms.length, { message: '산 부적이 붙어야 한다' }).toBe(SLOTS);
  expect(await hiddenTexts(page, SCENE.candySlot), '부적을 붙인 뒤의 가게와 확률 줄').toEqual([]);

  // 붙인 부적을 누르면 설명과 떼는 버튼이 뜨고, 떼면 자리가 빈다.
  const slot = await page.evaluate((key) => {
    const { layout } = window.__pocketArcade?.scene.getScene(key) as unknown as CandySlotView;
    const last = layout.slots[layout.slots.length - 1];
    return { x: last.x + layout.slotSize / 2, y: last.y + layout.slotSize / 2 };
  }, SCENE.candySlot);
  await tapAt(page, slot.x, slot.y);
  await expect.poll(() => textPoint(page, SCENE.candySlot, '떼기'), WAIT).not.toBeNull();
  expect(await hiddenTexts(page, SCENE.candySlot, { from: '떼기' }), '붙인 부적의 설명').toEqual([]);
  await tapText(page, SCENE.candySlot, '떼기');
  await expect.poll(async () => (await run()).charms.length, { message: '뗀 자리가 비어야 한다' }).toBe(SLOTS - 1);

  // 가게를 닫으면 다음 라운드가 시작된다.
  await tapText(page, SCENE.candySlot, '다음 라운드');
  await expect.poll(async () => (await run()).phase, { message: '다음 라운드가 시작되어야 한다' }).toBe('spin');
  expect((await run()).round).toBe(2);
});

/**
 * 단계 모드의 장면에서 아래의 점검이 들여다보는 것. 색깔 물 나누기는 깔아 둔 판(stageData)과 지금의 병들(tubes)을,
 * 길 잇기는 판의 문제(run.board.puzzle)와 지금까지 그린 길(run.board.paths)을 든다.
 */
interface StageDealView {
  stageLevel: number | null;
  /** 위쪽 HUD. 장면을 열 때마다 새로 만든다. */
  hud: object;
  stageData?: { tubes: unknown; solution: Array<{ from: number; to: number }> } | null;
  tubes?: unknown;
  views?: Array<{ x: number; y: number }>;
  run?: { board: { puzzle: { size: number; solution: number[][] }; paths: number[][] } };
  layout?: { cell: number; left: number; top: number };
}

interface StageDeal {
  level: number | null;
  /** 장면이 든 판(색깔 물 나누기)이나 문제(길 잇기) */
  dealt: unknown;
  /** 그 판이나 문제에 매긴 번호. 값이 같아도 따로 만든 것이면 번호가 다르다. */
  dealtId: number;
  /** 장면을 연 번째에 매긴 번호. 장면을 다시 열면 달라진다. */
  openId: number;
  /** 아직 아무것도 하지 않은 처음 모습인지 */
  untouched: boolean;
}

/** 단계 모드의 장면이 든 판을 읽는다. 같은 것을 다시 쓰는지 볼 수 있게, 본 것마다 페이지 안에서 번호를 매겨 둔다. */
const stageDeal = (page: Page, key: string): Promise<StageDeal> =>
  page.evaluate((sceneKey) => {
    const scene = window.__pocketArcade?.scene.getScene(sceneKey) as unknown as StageDealView;
    const seen = ((window as unknown as { __stageDealsSeen?: unknown[] }).__stageDealsSeen ??= []);
    const idOf = (thing: unknown): number => {
      const at = seen.indexOf(thing);
      return at >= 0 ? at : seen.push(thing) - 1;
    };
    const dealt = scene.run ? scene.run.board.puzzle : (scene.stageData ?? null);
    const untouched = scene.run
      ? scene.run.board.paths.every((path) => path.length === 0)
      : JSON.stringify(scene.tubes) === JSON.stringify(scene.stageData?.tubes);
    return { level: scene.stageLevel, dealt, dealtId: idOf(dealt), openId: idOf(scene.hud), untouched };
  }, key);

it('색깔 물 나누기와 길 잇기의 단계 도전: 하던 단계를 다시 열면 만들어 둔 판을 다시 만들지 않고 처음 모습으로 쓰고, 다른 단계에는 그 단계의 판이 나온다', async ({
  page,
}) => {
  // 단계 모드의 판은 단계 번호로 정해지는데 만드는 데 시간이 걸려서(느린 기기에서는 반 초쯤 화면이 멈춘다),
  // 다시 하기를 누를 때마다 똑같은 판을 또 만들지 않고 만들어 둔 것을 쓴다.
  // 마지막 단계까지 열린 저장을 앱이 읽기 전에 넣어 둔다(core/store.ts의 FALLBACK_KEY).
  await page.addInitScript(
    (cleared) =>
      localStorage.setItem('pocket-arcade:save', JSON.stringify({ stages: { 'color-sort': cleared, 'path-link': cleared } })),
    STAGE_LEVELS - 1,
  );
  await openApp(page);
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('캔버스가 보이지 않는다');
  const scale = box.width / GAME_WIDTH;

  /** 색깔 물 나누기: 찾아 둔 풀이의 첫 붓기를 한다(부을 병을 누르고 받을 병을 누른다). 판이 깔리는 동안에는 눌리지 않는다. */
  const pourOnce = async (): Promise<void> => {
    await expect(async () => {
      const spots = await page.evaluate((key) => {
        const scene = window.__pocketArcade?.scene.getScene(key) as unknown as StageDealView;
        const move = scene.stageData?.solution[0];
        const views = scene.views ?? [];
        return move && views[move.from] && views[move.to] ? [views[move.from], views[move.to]].map((view) => ({ x: view.x, y: view.y + 30 })) : [];
      }, SCENE.colorSort);
      for (const spot of spots) await tapAt(page, spot.x, spot.y);
      await expect.poll(async () => (await stageDeal(page, SCENE.colorSort)).untouched, { timeout: 2_000 }).toBe(false);
    }).toPass(WAIT);
  };
  /** 길 잇기: 저장된 풀이의 첫 길을 두 칸만 그린다(첫 점을 누른 채 옆 칸으로 끈다). 판이 뜨고 잠깐은 그려지지 않는다. */
  const drawOnce = async (): Promise<void> => {
    await expect(async () => {
      const cells = await page.evaluate((key) => {
        const scene = window.__pocketArcade?.scene.getScene(key) as unknown as StageDealView;
        if (!scene.run || !scene.layout || scene.layout.cell <= 0) return [];
        const { size, solution } = scene.run.board.puzzle;
        const { cell, left, top } = scene.layout;
        return solution[0].slice(0, 2).map((at) => ({ x: left + ((at % size) + 0.5) * cell, y: top + (Math.floor(at / size) + 0.5) * cell }));
      }, SCENE.pathLink);
      expect(cells, '판이 놓여야 한다').toHaveLength(2);
      await page.mouse.move(box.x + cells[0].x * scale, box.y + cells[0].y * scale);
      await page.mouse.down();
      await page.mouse.move(box.x + cells[1].x * scale, box.y + cells[1].y * scale, { steps: 4 });
      await page.mouse.up();
      expect((await stageDeal(page, SCENE.pathLink)).untouched).toBe(false);
    }).toPass(WAIT);
  };

  const games = [
    { name: '색깔 물 나누기', key: SCENE.colorSort, play: pourOnce, made: (level: number): unknown => colorSortLevel(level, stageRandom('color-sort', level)) },
    { name: '길 잇기', key: SCENE.pathLink, play: drawOnce, made: (level: number): unknown => pathLinkPuzzle(level, stageRandom('path-link', level)) },
  ];
  for (const game of games) {
    const top = STAGE_LEVELS;
    // 브라우저에서 읽어 온 판과 견주므로, 여기서 만든 판도 같은 꼴(JSON)로 바꿔 둔다.
    const made = (level: number): unknown => JSON.parse(JSON.stringify(game.made(level)));

    // 처음 열면 그 단계의 판을 만들어 깐다.
    await startScene(page, game.key, { stageLevel: top });
    const first = await stageDeal(page, game.key);
    expect(first.level, `${game.name}: 단계 모드로 열려야 한다`).toBe(top);
    expect(first.dealt, `${game.name}: ${top}단계의 판`).toEqual(made(top));
    expect(first.untouched, `${game.name}: 처음 모습`).toBe(true);

    // 한 수를 두고 나서 같은 단계를 다시 연다(결과 화면의 다시 하기와 같다). 만들어 둔 바로 그 판을 쓰되, 둔 수는 남지 않는다.
    await game.play();
    await startScene(page, game.key, { stageLevel: top });
    const again = await stageDeal(page, game.key);
    expect(again.openId, `${game.name}: 장면이 다시 열려야 한다`).not.toBe(first.openId);
    expect(again.dealtId, `${game.name}: 같은 단계를 다시 열면 만들어 둔 판을 그대로 쓴다`).toBe(first.dealtId);
    expect(again.dealt, `${game.name}: 다시 연 ${top}단계의 판`).toEqual(made(top));
    expect(again.untouched, `${game.name}: 다시 열면 처음 모습에서 시작한다`).toBe(true);

    // 다른 단계를 열면 만들어 둔 판이 아니라 그 단계의 판이 나오고, 돌아오면 다시 처음의 판이 나온다.
    await startScene(page, game.key, { stageLevel: top - 1 });
    const other = await stageDeal(page, game.key);
    expect(other.level, `${game.name}: 앞 단계`).toBe(top - 1);
    expect(other.dealtId, `${game.name}: 다른 단계에는 다른 판`).not.toBe(first.dealtId);
    expect(other.dealt, `${game.name}: ${top - 1}단계의 판`).toEqual(made(top - 1));
    expect(other.dealt, `${game.name}: 두 단계의 판은 서로 다르다`).not.toEqual(made(top));
    await startScene(page, game.key, { stageLevel: top });
    const back = await stageDeal(page, game.key);
    expect(back.dealt, `${game.name}: 돌아온 ${top}단계의 판`).toEqual(made(top));
    expect(back.untouched, `${game.name}: 돌아온 판의 처음 모습`).toBe(true);
  }
});

/** 텃밭 지키기 장면에서 이 점검이 들여다보는 것 */
interface GardenView {
  run: { fence: number; day: number; phase: string } | null;
}

/** 텃밭 지키기의 판 밖 진행을 앱이 읽기 전에 넣어 둔다. 저장하는 곳과 이름은 garden-guard/store.ts와 같다. */
async function seedGardenMeta(page: Page, meta: object): Promise<void> {
  await page.evaluate(
    (value) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('pocket-arcade-garden');
        open.onupgradeneeded = () => open.result.createObjectStore('kv');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(value, 'meta');
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    meta,
  );
}

/** 텃밭 지키기 장면에 보이는 글자들 */
const gardenTexts = (page: Page): Promise<string[]> =>
  page.evaluate((key) => {
    const scene = window.__pocketArcade?.scene.getScene(key);
    if (!scene) return [];
    return scene.children.list.flatMap((item) => {
      const text = item as Phaser.GameObjects.Text;
      return item.type === 'Text' && text.visible && text.alpha > 0 ? [text.text] : [];
    });
  }, GARDEN_SCENE);

/** 강화 목록 아래의 "다음 쪽" 버튼 자리. 시작하는 날을 고르는 버튼도 같은 그림을 쓰므로 가장 위의 것을 고른다. */
const gardenNextPage = (page: Page): Promise<{ x: number; y: number } | null> =>
  page.evaluate((key) => {
    const scene = window.__pocketArcade?.scene.getScene(key);
    if (!scene) return null;
    const arrows = scene.children.list.filter((item): item is Phaser.GameObjects.Image => {
      const image = item as Phaser.GameObjects.Image;
      return item.type === 'Image' && image.texture.key === 'icon-play' && image.visible && image.alpha === 1;
    });
    arrows.sort((a, b) => a.y - b.y);
    return arrows.length > 0 ? { x: arrows[0].x, y: arrows[0].y } : null;
  }, GARDEN_SCENE);

it('텃밭 지키기: 준비 화면의 강화 줄(모든 쪽)과 판 화면이 가려지지 않고, 판이 끝나면 씨앗과 기록이 남은 준비 화면으로 돌아온다', async ({ page }) => {
  await openApp(page);
  // 대장을 둘 넘겨서 시작하는 날을 고를 수 있고, 강화의 값과 효과가 길게 적히는 저장.
  const levels = Object.fromEntries(UPGRADE_ORDER.map((id) => [id, Math.min(UPGRADES[id].maxLevel - 1, 9)]));
  await seedGardenMeta(page, {
    version: 2,
    seeds: 98765,
    levels,
    best: 13,
    runs: 21,
    kills: 2890,
    startDay: 6,
    savedAt: Date.now() + 60_000,
  });
  await page.reload();
  await waitForScene(page, 'Hub');
  await startScene(page, GARDEN_SCENE);
  await expect.poll(() => textPoint(page, GARDEN_SCENE, '출발!'), { ...WAIT, message: '준비 화면이 떠야 한다' }).not.toBeNull();
  await expect.poll(() => textPoint(page, GARDEN_SCENE, '최고 13일째'), { ...WAIT, message: '넣어 둔 저장을 읽어야 한다' }).not.toBeNull();
  expect(await textPoint(page, GARDEN_SCENE, '6일째'), '시작하는 날을 고르는 칸').not.toBeNull();

  // 강화 목록을 끝 쪽까지 넘겨 가며 본다. 강화마다 이름이 한 번씩은 보여야 한다.
  const seen = new Set<string>();
  for (let turn = 0; turn < UPGRADE_ORDER.length; turn += 1) {
    expect(await hiddenTexts(page, GARDEN_SCENE), `준비 화면 ${turn + 1}쪽`).toEqual([]);
    const texts = await gardenTexts(page);
    const before = seen.size;
    for (const id of UPGRADE_ORDER) if (texts.includes(UPGRADES[id].name)) seen.add(id);
    if (seen.size === UPGRADE_ORDER.length || seen.size === before) break;
    const next = await gardenNextPage(page);
    if (!next) break;
    await tapAt(page, next.x, next.y);
    await page.waitForTimeout(200);
  }
  expect([...seen].sort(), '모든 강화가 목록에 나와야 한다').toEqual([...UPGRADE_ORDER].sort());

  // 판을 시작한다. 고른 날(6일째)에서 시작하고, 위쪽 띠와 울타리의 글자가 가려지지 않는다.
  await tapText(page, GARDEN_SCENE, '출발!');
  const runOf = (): Promise<GardenView['run']> =>
    page.evaluate((key) => {
      const run = (window.__pocketArcade?.scene.getScene(key) as unknown as GardenView | null)?.run;
      return run ? { fence: run.fence, day: run.day, phase: run.phase } : null;
    }, GARDEN_SCENE);
  await expect.poll(async () => (await runOf())?.day, { ...WAIT, message: '판이 시작되어야 한다' }).toBe(6);
  await expect.poll(() => textPoint(page, GARDEN_SCENE, '6일째'), WAIT).not.toBeNull();
  expect(await hiddenTexts(page, GARDEN_SCENE), '판 화면').toEqual([]);

  // 울타리를 무너뜨려 판을 끝내고, 결과 화면에서 다시 하기를 누르면 준비 화면이다.
  await page.evaluate((key) => {
    const run = (window.__pocketArcade?.scene.getScene(key) as unknown as GardenView).run;
    if (run) run.fence = 0;
  }, GARDEN_SCENE);
  await waitForScene(page, SCENE.result);
  await tapText(page, SCENE.result, '다시 하기');
  await expect.poll(() => textPoint(page, GARDEN_SCENE, '출발!'), { ...WAIT, message: '준비 화면으로 돌아와야 한다' }).not.toBeNull();
  const after = await gardenTexts(page);
  expect(after.some((text) => text.startsWith('22판')), `판 수가 하나 늘어야 한다: ${after.join(' / ')}`).toBe(true);
  expect(after, '고른 시작 날이 그대로 남아야 한다').toContain('6일째');
  expect(await hiddenTexts(page, GARDEN_SCENE), '돌아온 준비 화면').toEqual([]);
});

it('텃밭 지키기: 하던 판을 두고 나가거나 앱이 꺼져도 준비 화면에서 그 자리부터 이어 하고, 새 판을 고르면 그 판을 마친다', async ({ page }) => {
  await openApp(page);
  await seedGardenMeta(page, {
    version: 2,
    seeds: 0,
    levels: {},
    best: 0,
    runs: 5,
    kills: 100,
    startDay: 1,
    savedAt: Date.now() + 60_000,
  });
  await page.reload();
  await waitForScene(page, 'Hub');
  await startScene(page, GARDEN_SCENE);
  await expect.poll(() => textPoint(page, GARDEN_SCENE, '출발!'), WAIT).not.toBeNull();
  await tapText(page, GARDEN_SCENE, '출발!');
  type Snapshot = { day: number; t: number; enemies: number; phase: string };
  const runOf = (): Promise<Snapshot | null> =>
    page.evaluate((key) => {
      const scene = window.__pocketArcade?.scene.getScene(key) as unknown as {
        run: { day: number; t: number; enemies: unknown[]; phase: string } | null;
      } | null;
      const run = scene?.run;
      return run ? { day: run.day, t: run.t, enemies: run.enemies.length, phase: run.phase } : null;
    }, GARDEN_SCENE);
  await expect.poll(async () => (await runOf())?.enemies ?? 0, { ...WAIT, message: '벌레가 나와야 한다' }).toBeGreaterThan(0);

  // 멈추고 준비 화면으로 나가면, 준비 화면의 맨 아래가 "새 판"과 "이어하기"다.
  await page.evaluate((key) => (window.__pocketArcade?.scene.getScene(key) as unknown as { pauseGame(): void }).pauseGame(), GARDEN_SCENE);
  await waitForScene(page, SCENE.pause);
  const paused = (await runOf())!;
  await tapText(page, SCENE.pause, '준비 화면으로');
  await expect.poll(() => textPoint(page, GARDEN_SCENE, '이어하기 · 1일째'), { ...WAIT, message: '이어하기 버튼' }).not.toBeNull();
  expect(await textPoint(page, GARDEN_SCENE, '새 판')).not.toBeNull();
  expect(await textPoint(page, GARDEN_SCENE, '출발!'), '두고 간 판이 있으면 출발 버튼 대신 이어하기').toBeNull();
  expect(await hiddenTexts(page, GARDEN_SCENE), '이어하기가 있는 준비 화면').toEqual([]);

  // 이어 하면 멈춘 자리(같은 날, 같은 때, 같은 벌레)에서 시작한다.
  await tapText(page, GARDEN_SCENE, '이어하기 · 1일째');
  await expect.poll(async () => (await runOf())?.t ?? -1, WAIT).toBeGreaterThanOrEqual(paused.t);
  const resumed = (await runOf())!;
  expect(resumed.day).toBe(paused.day);
  expect(resumed.t - paused.t, '멈춘 자리에서 이어 한다').toBeLessThan(1);
  expect(resumed.enemies).toBe(paused.enemies);

  // 앱이 그대로 꺼져도(멈추지도 나가지도 않고) 다시 열면 이어 할 수 있다.
  await page.reload();
  await waitForScene(page, 'Hub');
  await startScene(page, GARDEN_SCENE);
  await expect.poll(() => textPoint(page, GARDEN_SCENE, '이어하기 · 1일째'), { ...WAIT, message: '꺼진 뒤의 이어하기' }).not.toBeNull();

  // 새 판은 한 번 더 물어보고, 두 번째에 두고 간 판을 마친 뒤(판 수가 하나 는다) 여느 준비 화면이 된다.
  await tapText(page, GARDEN_SCENE, '새 판');
  await expect
    .poll(async () => (await gardenTexts(page)).some((text) => text.includes('한 번 더 누르면')), { ...WAIT, message: '새 판을 한 번 더 묻는다' })
    .toBe(true);
  expect(await textPoint(page, GARDEN_SCENE, '이어하기 · 1일째'), '한 번 눌러서는 판이 남아 있다').not.toBeNull();
  expect(await hiddenTexts(page, GARDEN_SCENE), '새 판을 묻는 준비 화면').toEqual([]);
  await tapText(page, GARDEN_SCENE, '새 판');
  await expect.poll(() => textPoint(page, GARDEN_SCENE, '출발!'), { ...WAIT, message: '여느 준비 화면' }).not.toBeNull();
  const texts = await gardenTexts(page);
  expect(texts.some((text) => text.startsWith('6판')), `판 수가 하나 늘어야 한다: ${texts.join(' / ')}`).toBe(true);
  expect(texts).not.toContain('이어하기 · 1일째');
});

it('텃밭 지키기: 50일째를 지키면 새 밭을 일굴 수 있고, 잃는 것과 얻는 것을 보여 준 뒤 두 번 눌러야 일군다', async ({ page }) => {
  // 준비 화면의 글(garden-guard/lobby.ts). lobby.ts는 Phaser를 불러서 여기서 가져올 수 없다.
  const PLOW_LABEL = '새 밭 일구기';
  const PLOW_GO = '일구기';
  const PLOW_SURE = '정말 일구기';
  const PLOW_CONFIRM = '되돌릴 수 없어요.\n한 번 더 누르면 새 밭으로 가요.';
  await openApp(page);
  const levels = Object.fromEntries(UPGRADE_ORDER.map((id) => [id, Math.min(UPGRADES[id].maxLevel, 8)]));
  await seedGardenMeta(page, {
    version: 2,
    seeds: 98765,
    levels,
    best: 63,
    runs: 88,
    kills: 123456,
    startDay: 61,
    savedAt: Date.now() + 60_000,
  });
  await page.reload();
  await waitForScene(page, 'Hub');
  await startScene(page, GARDEN_SCENE);
  await expect.poll(() => textPoint(page, GARDEN_SCENE, PLOW_LABEL), { ...WAIT, message: '새 밭 일구기 버튼' }).not.toBeNull();
  expect(await hiddenTexts(page, GARDEN_SCENE), '새 밭 버튼이 있는 준비 화면').toEqual([]);

  // 버튼을 누르면 준비 화면 대신 두고 가는 것, 얻는 것, 남는 것이 보인다.
  await tapText(page, GARDEN_SCENE, PLOW_LABEL);
  await expect.poll(() => textPoint(page, GARDEN_SCENE, '두고 가는 것'), { ...WAIT, message: '새 밭 쪽' }).not.toBeNull();
  const texts = await gardenTexts(page);
  for (const line of ['· 씨앗 98765개', '· 강화 14가지 (모두 0단계로)', '· 최고 63일째와 열린 출발점', '· 물총 피해 +0% → +30%', '· 받는 씨앗 +0% → +30%']) {
    expect(texts, line).toContain(line);
  }
  expect(texts, '준비 화면의 출발 버튼은 감춘다').not.toContain('출발!');
  expect(await hiddenTexts(page, GARDEN_SCENE), '새 밭 쪽').toEqual([]);

  // 한 번 누르면 되묻기만 하고, 그만두면 그대로인 준비 화면으로 돌아간다.
  await tapText(page, GARDEN_SCENE, PLOW_GO);
  await expect.poll(() => textPoint(page, GARDEN_SCENE, PLOW_CONFIRM), { ...WAIT, message: '한 번 더 묻는다' }).not.toBeNull();
  expect(await textPoint(page, GARDEN_SCENE, PLOW_SURE)).not.toBeNull();
  expect(await hiddenTexts(page, GARDEN_SCENE), '되묻는 새 밭 쪽').toEqual([]);
  await tapText(page, GARDEN_SCENE, '그만두기');
  await expect.poll(() => textPoint(page, GARDEN_SCENE, '최고 63일째'), { ...WAIT, message: '그만두면 그대로' }).not.toBeNull();
  expect(await textPoint(page, GARDEN_SCENE, '61일째'), '고른 시작 날도 그대로').not.toBeNull();

  // 두 번 누르면 일군다: 1일째부터, 씨앗 0, 강화 0단계, "2번째 밭"이 보이고 효과 줄에 늘어난 피해가 들어간다.
  await tapText(page, GARDEN_SCENE, PLOW_LABEL);
  await expect.poll(() => textPoint(page, GARDEN_SCENE, PLOW_GO), WAIT).not.toBeNull();
  await tapText(page, GARDEN_SCENE, PLOW_GO);
  await expect.poll(() => textPoint(page, GARDEN_SCENE, PLOW_SURE), WAIT).not.toBeNull();
  await tapText(page, GARDEN_SCENE, PLOW_SURE);
  await expect.poll(() => textPoint(page, GARDEN_SCENE, '출발!'), { ...WAIT, message: '새 밭의 준비 화면' }).not.toBeNull();
  const after = await gardenTexts(page);
  expect(after).toContain('2번째 밭을 일궜어요!\n물총 피해와 씨앗이 +30%예요.');
  expect(after).toContain('2번째 밭 · 88판');
  expect(after).toContain('아직 하루도 못 지켰어요');
  expect(after, '시작하는 날을 고르는 칸이 없어진다').not.toContain('61일째');
  expect(after, '새 밭 버튼은 다시 50일째를 지켜야 생긴다').not.toContain(PLOW_LABEL);
  expect(after.filter((text) => text === '0단계').length, '강화가 0단계로 돌아간다').toBeGreaterThan(0);
  expect(await hiddenTexts(page, GARDEN_SCENE), '새 밭의 준비 화면').toEqual([]);
  const stored = await page.evaluate(
    () =>
      new Promise<{ seeds: number; fields: number; best: number; bestEver: number }>((resolve, reject) => {
        const open = indexedDB.open('pocket-arcade-garden');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const request = open.result.transaction('kv').objectStore('kv').get('meta');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        };
      }),
  );
  expect(stored).toMatchObject({ seeds: 0, fields: 1, best: 0, bestEver: 63 });
});
