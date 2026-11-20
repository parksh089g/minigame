/**
 * 텃밭 지키기의 오늘의 판을 화면에서 점검한다: 준비 화면의 오늘의 판 줄과 오늘의 판 쪽, 강화 없이 시작하는 그날의 판,
 * 두고 갔다 이어 해도 오늘의 판 그대로인지, 마치면 결과 화면과 그날의 기록에 남는지, 친구가 보낸 주소로 들어오면
 * 넘어 볼 기록이 뜨는지, 오늘의 랭킹 쪽이 (꽉 찼을 때, 불러오지 못했을 때) 가려지는 글자 없이 보이는지 본다.
 * 랭킹은 서버의 답을 바꿔 끼워서 본다. 두 화면 크기에서 모두 돈다.
 */
import './app-globals';
import { expect, type Page } from '@playwright/test';
import { SCENE } from '../src/config';
import { failureText } from '../src/online/api';
import { rankDayOf, RANK_SCAN, TOP_COUNT, type RankBoard } from '../src/online/protocol';
import {
  DAILY_OFF_RECORD,
  DAILY_TEXT,
  dailyResumeInfo,
  friendNotice,
  RANK_TEXT,
  SHARED_DAY_PASSED,
  type GardenDaily,
} from '../src/games/garden-guard/daily';
import { GARDEN_GAME_ID, GARDEN_SCENE } from '../src/games/garden-guard/data';
import { META_VERSION, type GardenMeta } from '../src/games/garden-guard/rules';
import type { RunState } from '../src/games/garden-guard/sim';
import { hiddenTexts, it, openApp, startScene, tapText, textPoint, waitForScene } from './app';

const WAIT = { timeout: 20_000 } as const;

/** 강화를 여럿 사고 13일째까지 가 본 텃밭. 오늘의 판에서는 이것이 하나도 들지 않아야 한다. */
const META: GardenMeta = {
  version: META_VERSION,
  seeds: 300,
  levels: { power: 5, rapid: 3, helper: 1, fence: 2 },
  best: 13,
  runs: 12,
  kills: 900,
  startDay: 11,
  fields: 0,
  bestEver: 13,
  shards: 0,
  relics: {},
  savedAt: 1,
};

interface GardenView {
  run: RunState | null;
  finishFromPause(): void;
}

/** 텃밭 지키기의 판 밖 진행을 기기에 적는다. 저장하는 곳과 이름은 garden-guard/store.ts와 같다. */
async function writeMeta(page: Page, meta: object): Promise<void> {
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

/** 기기에 적힌 오늘의 판 기록. 저장하는 곳과 이름은 garden-guard/daily-store.ts와 같다. */
function readDaily(page: Page): Promise<GardenDaily | undefined> {
  return page.evaluate(
    () =>
      new Promise<GardenDaily | undefined>((resolve, reject) => {
        const open = indexedDB.open('pocket-arcade-garden-daily');
        open.onupgradeneeded = () => open.result.createObjectStore('kv');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const request = open.result.transaction('kv').objectStore('kv').get('daily');
          request.onsuccess = () => {
            open.result.close();
            resolve(request.result as GardenDaily | undefined);
          };
          request.onerror = () => reject(request.error);
        };
      }),
  );
}

const runOf = (page: Page): Promise<RunState | null> =>
  page.evaluate((key) => (window.__pocketArcade?.scene.getScene(key) as unknown as GardenView | null)?.run ?? null, GARDEN_SCENE);

const shown = async (page: Page, text: string): Promise<boolean> => (await textPoint(page, GARDEN_SCENE, text)) !== null;

/** 저장을 넣어 두고 앱을 새로 열어 텃밭 지키기의 준비 화면을 띄운다. */
async function openLobby(page: Page): Promise<void> {
  await openApp(page);
  await writeMeta(page, { ...META, savedAt: Date.now() });
  await page.reload();
  await openApp(page);
  await startScene(page, GARDEN_SCENE);
  await expect.poll(() => shown(page, '최고 13일째'), WAIT).toBe(true);
}

/** 준비 화면의 오늘의 판 줄을 눌러 오늘의 판 쪽을 연다. */
async function openDailyPage(page: Page): Promise<void> {
  await tapText(page, GARDEN_SCENE, DAILY_TEXT.name);
  await expect.poll(() => shown(page, DAILY_TEXT.rules), { ...WAIT, message: '오늘의 판 쪽이 열려야 한다' }).toBe(true);
}

it('텃밭 지키기 오늘의 판: 준비 화면의 줄로 들어가 강화 없이 그날의 판을 하고, 이어 해도 오늘의 판이며, 마치면 그날의 기록에 남는다', async ({
  page,
}) => {
  await page.route('**/api/**', (route) => route.abort());
  await openLobby(page);
  expect(await hiddenTexts(page, GARDEN_SCENE), '오늘의 판 줄이 생긴 준비 화면').toEqual([]);

  await openDailyPage(page);
  expect(await shown(page, DAILY_TEXT.go)).toBe(true);
  expect(await shown(page, RANK_TEXT.button)).toBe(true);
  expect(await hiddenTexts(page, GARDEN_SCENE), '오늘의 판 쪽').toEqual([]);

  // 도전! 강화와 고른 출발점(11일째)은 들지 않고 1일째부터, 그날의 표를 달고 시작한다.
  await tapText(page, GARDEN_SCENE, DAILY_TEXT.go);
  await expect.poll(async () => (await runOf(page))?.daily?.day ?? null, WAIT).toBe(rankDayOf(Date.now()));
  const run = (await runOf(page)) as RunState;
  expect(run.startDay).toBe(1);
  expect(run.allies, '해바라기 모종을 샀어도 데리고 시작하지 않는다').toEqual([]);
  expect(await shown(page, DAILY_TEXT.badge), 'HUD에 오늘의 판 표시').toBe(true);

  // 첫날을 시작하고 판을 두고 준비 화면으로 간다. 이어 할 판도 오늘의 판이다.
  await tapText(page, GARDEN_SCENE, '1일째 시작');
  await expect.poll(async () => (await runOf(page))?.phase, WAIT).toBe('fight');
  expect(await hiddenTexts(page, GARDEN_SCENE), '오늘의 판을 하는 화면').toEqual([]);
  await page.evaluate((key) => window.__pocketArcade?.scene.getScene(key)?.scene.restart({}), GARDEN_SCENE);
  await expect.poll(() => shown(page, dailyResumeInfo(1)), { ...WAIT, message: '멈춘 오늘의 판을 알려야 한다' }).toBe(true);
  expect(await hiddenTexts(page, GARDEN_SCENE), '오늘의 판을 두고 온 준비 화면').toEqual([]);
  await tapText(page, GARDEN_SCENE, '이어하기 · 1일째');
  await expect.poll(async () => (await runOf(page))?.daily?.day ?? null, WAIT).toBe(rankDayOf(Date.now()));

  // 이틀을 지킨 것으로 치고 기록하고 끝낸다. 결과 화면에 오늘의 판 줄이 있고, 최고 기록에는 들지 않는다.
  await page.evaluate((key) => {
    const scene = window.__pocketArcade?.scene.getScene(key) as unknown as GardenView;
    if (scene.run) {
      scene.run.lastCleared = 2;
      scene.run.phase = 'rest';
    }
    scene.finishFromPause();
  }, GARDEN_SCENE);
  await waitForScene(page, SCENE.result);
  await expect.poll(() => textPoint(page, SCENE.result, DAILY_OFF_RECORD.today), WAIT).not.toBeNull();
  expect(await textPoint(page, SCENE.result, DAILY_TEXT.name)).not.toBeNull();
  expect(await textPoint(page, SCENE.result, '1일째 · 오늘의 첫 기록')).not.toBeNull();
  expect(await hiddenTexts(page, SCENE.result)).toEqual([]);
  await expect.poll(() => readDaily(page), WAIT).toMatchObject({ best: 200, kept: 2, tries: 1, streak: 1 });

  // 다시 열면 준비 화면의 줄과 오늘의 판 쪽에 오늘의 기록이 보인다.
  await startScene(page, GARDEN_SCENE);
  await expect.poll(() => shown(page, '오늘 최고 200점'), WAIT).toBe(true);
  expect(await shown(page, '최고 13일째'), '이 밭의 기록은 그대로다').toBe(true);
  await openDailyPage(page);
  expect(await shown(page, '200점 · 2일 지킴')).toBe(true);
  expect(await shown(page, DAILY_TEXT.again)).toBe(true);
  expect(await hiddenTexts(page, GARDEN_SCENE), '기록이 있는 오늘의 판 쪽').toEqual([]);
});

it('텃밭 지키기 오늘의 판: 친구가 점수와 함께 보낸 주소로 들어오면 오늘의 판 쪽에 넘어 볼 기록이 뜬다', async ({ page }) => {
  await page.route('**/api/**', (route) => route.abort());
  const today = rankDayOf(Date.now());
  await openApp(page, `/?game=${GARDEN_GAME_ID}&day=${today}&score=333`, GARDEN_SCENE);
  await expect.poll(() => shown(page, friendNotice(333)), WAIT).toBe(true);
  expect(await shown(page, '333점'), '기록 칸의 친구 기록').toBe(true);
  expect(await hiddenTexts(page, GARDEN_SCENE)).toEqual([]);

  // 지난 날의 주소면 오늘의 판을 열고 그렇다고 알린다.
  await openApp(page, `/?game=${GARDEN_GAME_ID}&day=${today - 3}&score=50`, GARDEN_SCENE);
  await expect.poll(() => shown(page, SHARED_DAY_PASSED), WAIT).toBe(true);
});

it('텃밭 지키기 오늘의 판: 랭킹 쪽은 꽉 차도, 불러오지 못해도 가려지는 글자가 없다', async ({ page, context }) => {
  const today = rankDayOf(Date.now());
  const wide = ['WWWWWWWWWW', '가나다라마바사아자차', '일곱빛깔무지개구름떡', 'MMMMMMMMMM'];
  const top = Array.from({ length: TOP_COUNT }, (_, index) => ({
    rank: index + 1,
    name: wide[index % wide.length],
    score: 999_999 - index,
    mine: false,
  }));
  const board: RankBoard = { top, me: { rank: RANK_SCAN + 1, score: 999_999, name: wide[0] }, day: today };
  await page.route(`**/api/daily/${GARDEN_GAME_ID}*`, (route) => route.fulfill({ json: board }));
  await page.route('**/api/rank', (route) => route.fulfill({ json: { bests: {}, ranks: {} } }));
  await page.addInitScript(
    (name) =>
      localStorage.setItem(
        'pocket-arcade:save',
        JSON.stringify({ online: { id: '12345678-1234-1234-1234-123456789abc', name, sentName: name } }),
      ),
    wide[0],
  );
  await openApp(page);
  await startScene(page, GARDEN_SCENE, { lobby: 'daily' });
  await expect.poll(() => shown(page, '오늘의 랭킹 · 500위 밖'), { ...WAIT, message: '알아 온 순위가 버튼에 적혀야 한다' }).toBe(true);
  await tapText(page, GARDEN_SCENE, '오늘의 랭킹 · 500위 밖');
  await expect.poll(() => shown(page, '999999'), { ...WAIT, message: '랭킹 줄이 보여야 한다' }).toBe(true);
  expect(await shown(page, '999970'), '서른 줄이 한 쪽에 다 들어가지 않아 쪽으로 나뉜다').toBe(false);
  expect(await hiddenTexts(page, GARDEN_SCENE), '꽉 찬 랭킹 쪽').toEqual([]);
  expect(await shown(page, RANK_TEXT.rename)).toBe(true);

  // 돌아가면 오늘의 판 쪽이다.
  await page.evaluate((key) => (window.__pocketArcade?.scene.getScene(key) as unknown as { onBackRequest(): void }).onBackRequest(), GARDEN_SCENE);
  await expect.poll(() => shown(page, DAILY_TEXT.rules), WAIT).toBe(true);

  // 인터넷이 없으면 그렇다고 알리고 다시 불러오기 버튼을 둔다. 방금 불러온 랭킹은 앱이 잠깐 들고 있어서 새로 연다.
  await page.reload();
  await openApp(page);
  await context.setOffline(true);
  try {
    await startScene(page, GARDEN_SCENE, { lobby: 'rank' });
    await expect.poll(() => shown(page, failureText('offline')), WAIT).toBe(true);
    expect(await shown(page, RANK_TEXT.retry)).toBe(true);
    expect(await hiddenTexts(page, GARDEN_SCENE), '불러오지 못한 랭킹 쪽').toEqual([]);
  } finally {
    await context.setOffline(false);
  }
});
