/**
 * 배치 점검: 칸이나 줄이 늘어 길어지는 화면에서 글자가 화면 밖으로 나가거나 다른 것에 가리지 않는지,
 * 가장 작은 화면(320×568)과 흔한 화면(390×844)에서 본다. 화면 점검(smoke.e2e.ts)이 오류와 멈춤을 본다면,
 * 이 점검은 오류 없이 어긋나는 배치를 본다.
 */
import './app-globals';
import { expect, test, type Page } from '@playwright/test';
import { SCENE } from '../src/config';
import { STAGE_LEVELS } from '../src/core/stages';
import {
  EVOLVE_LEVEL,
  LANTERN_GAME_ID,
  LANTERN_SCENE,
  MAX_LEVEL,
  WEAPON_ORDER,
  WEAPONS,
  type WeaponId,
} from '../src/games/lantern-keeper/data';
import { iconKey } from '../src/games/lantern-keeper/icons';
import { NEWS_GAP, newsLine, normalizeMeta, unknownNews } from '../src/games/lantern-keeper/meta';
import { upgradeTitle, type Upgrade } from '../src/games/lantern-keeper/rules';
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
import { COMPANY_SCENE, GUIDE_STEPS, OFFICES, PROJECT_ORDER, PROJECTS, RATING } from '../src/games/sprout-company/data';
import { createCompany, type CompanyState } from '../src/games/sprout-company/rules';
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
      pendingTickets: number;
      pendingLevelUps: number;
    };
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
