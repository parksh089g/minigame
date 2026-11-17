/**
 * 행운 슬롯의 오늘의 판 랭킹을 화면에서 점검한다. 로컬 서버(wrangler dev)의 실제 랭킹에 올리고 불러온다.
 * 오늘의 판을 마치면 그 점수가 오늘의 랭킹에 한 번만 올라가는지, 여느 판은 올라가지 않는지, 닉네임을 정하기 전에 낸
 * 점수가 참여할 때 올라가는지, 인터넷이 없어도 결과 화면이 그대로 뜨고 나중에 올라가는지, 그리고 랭킹 창이
 * (줄이 찼을 때, 비었을 때, 불러오지 못했을 때) 두 화면 크기에서 글자가 가려지지 않는지 본다.
 *
 * 로컬 서버의 랭킹은 점검끼리, 지난 점검과도 함께 쓴다. 그래서 점검마다 새 닉네임과 새 기기 id를 쓰고,
 * 점수는 뒤에 돌린 점검일수록 높게 잡아서(늘 랭킹의 맨 위쪽에 놓인다) 남아 있는 줄이나 차례에 기대지 않는다.
 * 마치면 올린 줄을 지운다. 줄이 빈 랭킹과 꽉 찬 랭킹은 서버의 답을 바꿔 끼워서 본다.
 * 한국 시각 0시를 사이에 두고 돌면 어제의 판이 되어 올라가지 않는다. 그때는 다시 돌리면 된다.
 */
import './app-globals';
import { randomUUID } from 'node:crypto';
import { expect, type Page, type Request } from '@playwright/test';
import { SCENE } from '../src/config';
import { failureText } from '../src/online/api';
import { rankDayOf, RANK_SCAN, TOP_COUNT, type RankBoard, type SubmitRequest } from '../src/online/protocol';
import { DAILY_LABEL, dailyDayOf, SLOT_GAME_ID } from '../src/games/candy-slot/daily';
import { RANK_TEXT, rankDate } from '../src/games/candy-slot/rank';
import type { RunState } from '../src/games/candy-slot/rules';
import { hiddenTexts, it, openApp, startScene, tapAt, tapText, textPoint, waitForScene } from './app';

const KEY = SCENE.candySlot;
/** 느린 기계에서도 스핀 하나가 다 보이고 서버의 답이 올 때까지 기다리는 시간 */
const WAIT = { timeout: 15_000 };
const SPIN = '돌리기';
const RETRY = '다시 하기';

/** 행운 슬롯 장면에서 이 점검이 들여다보고 부르는 것 */
interface SlotView {
  run: RunState;
  busy: boolean;
  /** 일시정지 화면의 "기록하고 끝내기"가 부르는 것 */
  finishFromPause(): void;
  /** 돌고 있는 스핀을 결과까지 건너뛴다(도는 중에 기계를 누른 것과 같다). */
  skipSpin(): boolean;
  /** 뒤로 가기 */
  onBackRequest(): void;
}

function view(page: Page): Promise<{ run: RunState; busy: boolean }> {
  return page.evaluate((key) => {
    const { run, busy } = window.__pocketArcade?.scene.getScene(key) as unknown as SlotView;
    return { run, busy };
  }, KEY);
}

/** 그 글자가 보이는지 */
async function shown(page: Page, text: string): Promise<boolean> {
  return (await textPoint(page, KEY, text)) !== null;
}

/** 장면에 보이는 글자들. 같은 글이 여러 번 적혀 있으면 여러 번 든다. */
function texts(page: Page): Promise<string[]> {
  return page.evaluate((key) => {
    const scene = window.__pocketArcade?.scene.getScene(key);
    const list = (scene?.children.list ?? []) as Phaser.GameObjects.Text[];
    return list.filter((item) => item.type === 'Text' && item.visible && item.alpha > 0).map((item) => item.text);
  }, KEY);
}

/** 이 점검만의 기기: 닉네임과 기기 id, 그리고 로컬 서버가 요청을 셀 때 보는 주소 */
interface Player {
  name: string;
  device: string;
  place: string;
}

/**
 * 점검마다 새 사람을 만든다. 서버는 한곳에서 랭킹에 처음 오르는 기기를 한 시간에 열 대까지만 받는데(worker/limiter.ts),
 * 로컬에서는 모든 점검이 같은 곳에서 오므로 점검을 되풀이하면 그 한도에 걸린다. 로컬 서버는 요청에 적힌 주소를 그대로
 * 믿으므로 점검마다 다른 주소를 적어 보낸다(실제 서버에서는 Cloudflare가 이 값을 덮어쓴다).
 */
async function newPlayer(page: Page): Promise<Player> {
  const part = (): number => 1 + Math.floor(Math.random() * 250);
  const player = {
    name: `슬롯${Math.random().toString(36).slice(2, 8)}`,
    device: randomUUID(),
    place: `10.${part()}.${part()}.${part()}`,
  };
  await page.setExtraHTTPHeaders({ 'cf-connecting-ip': player.place });
  return player;
}

/**
 * 앱이 저장을 읽기 전에, 닉네임을 정해 랭킹에 참여한 세이브를 넣어 둔다. 닉네임은 이미 올린 것으로 적어 둬서,
 * 앱을 켠 뒤에 닉네임만 올리는 요청이 따로 나가지 않는다(올린 요청을 셀 때 섞이지 않게 한다).
 */
async function joinBeforeOpen(page: Page, player: Player): Promise<void> {
  await page.addInitScript(
    ({ device, name }) =>
      localStorage.setItem('pocket-arcade:save', JSON.stringify({ online: { id: device, name, sentName: name } })),
    player,
  );
}

/**
 * 오늘 지금까지 돌린 어느 점검보다 높은 점수. 하루 동안 초마다 1씩 오르므로, 뒤에 돌린 점검의 줄이 늘 앞선 줄들 위에 놓인다.
 * 랭킹에 올릴 수 있는 가장 큰 점수(999,999)를 넘지 않는다.
 */
function freshScore(): number {
  const seconds = Math.floor((Date.now() + 9 * 3_600_000) / 1000) % 86_400;
  return 900_000 + seconds;
}

/** 페이지가 서버에 점수를 올린 요청(POST /api/rank)의 본문을 차례로 모은다. */
function collectSubmits(page: Page): SubmitRequest[] {
  const submits: SubmitRequest[] = [];
  page.on('request', (request) => {
    if (isSubmit(request)) submits.push(request.postDataJSON() as SubmitRequest);
  });
  return submits;
}

const isSubmit = (request: Request): boolean =>
  request.method() === 'POST' && new URL(request.url()).pathname === '/api/rank';

/** 오늘의 판의 점수가 실린 요청만 고른다. */
const dailySubmits = (submits: readonly SubmitRequest[]): SubmitRequest[] =>
  submits.filter((submit) => submit.daily?.scores[SLOT_GAME_ID] !== undefined);

/** 서버에 직접 물어본 오늘의 랭킹 */
async function serverBoard(page: Page, player: Player, device = player.device): Promise<RankBoard> {
  const response = await page.request.get(`/api/daily/${SLOT_GAME_ID}?me=${device}`, {
    headers: { 'cf-connecting-ip': player.place },
  });
  expect(response.ok(), '오늘의 랭킹을 불러와야 한다').toBe(true);
  return (await response.json()) as RankBoard;
}

/** 점검이 올린 줄을 모든 랭킹에서 지운다. */
async function forget(page: Page, player: Player, device = player.device): Promise<void> {
  await page.request.delete('/api/rank', { headers: { 'cf-connecting-ip': player.place }, data: { device } });
}

/** 시작 화면의 버튼을 눌러 오늘의 판으로 바꾸고, 그 판의 날을 돌려준다. */
async function switchToDaily(page: Page): Promise<number> {
  await tapText(page, KEY, DAILY_LABEL.name);
  await expect.poll(async () => (await view(page)).run.seed, { message: '오늘의 판으로 바뀌어야 한다' }).not.toBeNull();
  const day = dailyDayOf((await view(page)).run.seed);
  if (day === null) throw new Error('오늘의 판의 씨앗에 날이 없다');
  return day;
}

/** 돌리기를 한 번 누르고, 릴이 도는 것은 건너뛰어 결과가 다 보일 때까지 기다린다. */
async function spinOnce(page: Page): Promise<void> {
  const before = (await view(page)).run.spinCount;
  await tapText(page, KEY, SPIN);
  await expect
    .poll(async () => (await view(page)).run.spinCount, { ...WAIT, message: '돌리기가 눌려야 한다' })
    .toBe(before + 1);
  await page.evaluate((key) => (window.__pocketArcade?.scene.getScene(key) as unknown as SlotView).skipSpin(), KEY);
  await expect
    .poll(async () => {
      const { run, busy } = await view(page);
      return run.spinCount === before + 1 && !busy;
    }, { ...WAIT, message: '스핀 하나가 끝나야 한다' })
    .toBe(true);
}

/**
 * 한 번 돌린 판의 점수를 score로 맞춰 놓고, 일시정지 화면의 "기록하고 끝내기"와 같은 길로 판을 마친다.
 * 결과 화면이 뜰 때까지 기다린다.
 */
async function finishWith(page: Page, score: number): Promise<void> {
  await spinOnce(page);
  await page.evaluate(
    ([key, earned]) => {
      const scene = window.__pocketArcade?.scene.getScene(key) as unknown as SlotView;
      scene.run = { ...scene.run, earned };
      scene.finishFromPause();
    },
    [KEY, score] as const,
  );
  await waitForScene(page, SCENE.result);
}

/** 오늘의 판의 시작 화면에서 랭킹 버튼을 눌러 창을 연다. */
async function openRank(page: Page): Promise<void> {
  await tapText(page, KEY, RANK_TEXT.button);
  await expect.poll(() => shown(page, RANK_TEXT.title), { message: '랭킹 창이 열려야 한다' }).toBe(true);
}

/** 랭킹 창에 가려지거나 화면 밖으로 나간 글자가 없는지 본다. */
async function expectClear(page: Page, message: string): Promise<void> {
  await expect.poll(() => hiddenTexts(page, KEY, { from: RANK_TEXT.title }), { message }).toEqual([]);
}

/** 창에 내 줄이 보이는지: 목록의 줄과 내 기록 칸에 닉네임이 한 번씩, 점수와 "N위 · 점수"가 적힌다. */
async function expectMine(page: Page, player: Player, score: number): Promise<void> {
  await expect
    .poll(async () => (await texts(page)).filter((text) => text === player.name).length, {
      ...WAIT,
      message: '목록과 내 기록 칸에 닉네임이 보여야 한다',
    })
    .toBe(2);
  const all = await texts(page);
  expect(all, '목록의 내 줄에 점수가 적힌다').toContain(String(score));
  expect(
    all.some((text) => new RegExp(`^\\d+위 · ${score}점$`).test(text)),
    `내 기록 칸에 순위와 점수가 적힌다: ${all.join(' | ')}`,
  ).toBe(true);
}

it('행운 슬롯 오늘의 판 랭킹: 여느 판은 올라가지 않고, 오늘의 판을 마치면 그 점수가 한 번 올라가 랭킹에 보인다', async ({ page }) => {
  // 판을 두 번 마치고 서버와 여러 번 주고받는 긴 점검이라, 느린 기계에서도 끝나도록 제한 시간을 늘린다.
  it.slow();
  const player = await newPlayer(page);
  await joinBeforeOpen(page, player);
  const submits = collectSubmits(page);
  const score = freshScore();
  try {
    await openApp(page);
    await startScene(page, KEY);
    expect(await shown(page, RANK_TEXT.button), '여느 판의 시작 화면에는 랭킹 버튼이 없다').toBe(false);

    // 여느 판: 최고 기록은 올라가지만 오늘의 랭킹에는 올리지 않는다.
    let posted = page.waitForResponse((response) => isSubmit(response.request()), WAIT);
    await finishWith(page, 37);
    expect((await posted).ok(), '여느 판의 기록이 올라가야 한다').toBe(true);
    expect(submits).toHaveLength(1);
    expect(submits[0]).toMatchObject({ device: player.device, name: player.name, scores: { [SLOT_GAME_ID]: 37 } });
    expect(submits[0].daily, '여느 판은 오늘의 랭킹에 올리지 않는다').toBeUndefined();
    expect((await serverBoard(page, player)).me).toBeNull();

    // 오늘의 판: 판을 마칠 때 그 판의 날로 한 번 올라간다. 랭킹 창을 열기 전에 이미 올라가 있다.
    await tapText(page, SCENE.result, RETRY);
    await expect.poll(async () => (await view(page)).run.spinCount, WAIT).toBe(0);
    const day = await switchToDaily(page);
    posted = page.waitForResponse((response) => isSubmit(response.request()), WAIT);
    await finishWith(page, score);
    expect((await posted).ok(), '오늘의 판의 기록이 올라가야 한다').toBe(true);
    expect(dailySubmits(submits).map((submit) => submit.daily)).toEqual([{ day, scores: { [SLOT_GAME_ID]: score } }]);
    const board = await serverBoard(page, player);
    expect(board.day, '판의 씨앗에 적힌 날과 서버가 보는 오늘이 같다').toBe(day);
    expect(board.me).toMatchObject({ score, name: player.name });

    // 결과 화면의 "다시 하기"가 오늘의 판의 시작 화면을 열고, 거기의 랭킹 버튼으로 창을 연다.
    await tapText(page, SCENE.result, RETRY);
    await expect.poll(() => shown(page, DAILY_LABEL.back), WAIT).toBe(true);
    await expect.poll(() => hiddenTexts(page, KEY), { message: '랭킹 버튼이 놓인 시작 화면' }).toEqual([]);
    await openRank(page);
    await expectMine(page, player, score);
    expect(await shown(page, rankDate(day)), '머리글에 그날의 날짜가 적힌다').toBe(true);
    expect(await shown(page, RANK_TEXT.rename)).toBe(true);
    await expectClear(page, '내 줄이 있는 랭킹 창');

    // 창을 닫으면 시작 화면이 그대로 있다. 창을 여닫는 동안 같은 점수를 다시 올리지 않는다.
    await tapText(page, KEY, RANK_TEXT.close);
    await expect.poll(() => shown(page, RANK_TEXT.title), { message: '창이 닫혀야 한다' }).toBe(false);
    expect(await shown(page, RANK_TEXT.button)).toBe(true);
    expect(dailySubmits(submits), '오늘의 판의 점수는 한 번만 올린다').toHaveLength(1);
    expect((await view(page)).run, '창을 여닫아도 판은 그대로다').toMatchObject({ spinCount: 0, earned: 0 });
  } finally {
    await forget(page, player);
  }
});

it('행운 슬롯 오늘의 판 랭킹: 닉네임이 없으면 올리지 않고, 창에서 닉네임을 정하면 오늘 낸 점수가 올라간다', async ({ page }) => {
  it.slow();
  const player = await newPlayer(page);
  const submits = collectSubmits(page);
  const score = freshScore();
  let device = player.device;
  try {
    await openApp(page);
    await startScene(page, KEY);
    const day = await switchToDaily(page);
    await finishWith(page, score);
    await tapText(page, SCENE.result, RETRY);
    await expect.poll(() => shown(page, DAILY_LABEL.back), WAIT).toBe(true);

    // 닉네임을 정하기 전: 랭킹은 볼 수 있지만 서버에는 아무것도 올리지 않았다.
    await openRank(page);
    await expect.poll(() => shown(page, RANK_TEXT.loading), { ...WAIT, message: '랭킹을 다 불러와야 한다' }).toBe(false);
    expect(await texts(page)).toContain(RANK_TEXT.guest);
    expect(await shown(page, RANK_TEXT.join)).toBe(true);
    await expectClear(page, '닉네임을 정하기 전의 랭킹 창');
    expect(submits, '닉네임을 정하기 전에는 올리지 않는다').toEqual([]);

    // 창에서 닉네임을 정하면, 정하기 전에 마친 오늘의 판의 점수가 같이 올라가고 내 줄이 보인다.
    await tapText(page, KEY, RANK_TEXT.join);
    await page.locator('dialog input').fill(player.name);
    await page.locator('dialog button[type=submit]').click();
    await expectMine(page, player, score);
    expect(await shown(page, RANK_TEXT.rename)).toBe(true);
    await expectClear(page, '닉네임을 정한 뒤의 랭킹 창');
    expect(dailySubmits(submits).map((submit) => submit.daily)).toEqual([{ day, scores: { [SLOT_GAME_ID]: score } }]);
    device = submits[0].device;
    expect(submits[0].name).toBe(player.name);
    expect((await serverBoard(page, player, device)).me).toMatchObject({ score, name: player.name });
  } finally {
    await forget(page, player, device);
  }
});

it('행운 슬롯 오늘의 판 랭킹: 인터넷이 없어도 결과 화면은 그대로 뜨고, 다시 연결되면 기록이 올라간다', async ({ page, context }) => {
  it.slow();
  const player = await newPlayer(page);
  await joinBeforeOpen(page, player);
  const submits = collectSubmits(page);
  const score = freshScore();
  try {
    await openApp(page);
    await startScene(page, KEY);
    await switchToDaily(page);
    await context.setOffline(true);

    // 올리지 못해도 판은 여느 때처럼 끝나고 결과 화면이 뜬다.
    await finishWith(page, score);
    await expect.poll(() => textPoint(page, SCENE.result, DAILY_LABEL.name), WAIT).not.toBeNull();
    await tapText(page, SCENE.result, RETRY);
    await expect.poll(() => shown(page, DAILY_LABEL.back), WAIT).toBe(true);

    // 랭킹 창에는 불러오지 못했다는 안내와 다시 불러오는 버튼이 보인다. 닫고 오늘의 판을 그대로 할 수 있다.
    await openRank(page);
    await expect.poll(() => shown(page, RANK_TEXT.retry), WAIT).toBe(true);
    expect(await texts(page)).toContain(failureText('offline'));
    expect(await texts(page), '내 기록 칸에는 닉네임이 보인다').toContain(player.name);
    await expectClear(page, '불러오지 못한 랭킹 창');
    expect(submits, '인터넷이 없을 때는 올리지 못한다').toEqual([]);

    // 뒤로 가기는 게임을 멈추지 않고 창만 닫는다.
    await page.evaluate((key) => (window.__pocketArcade?.scene.getScene(key) as unknown as SlotView).onBackRequest(), KEY);
    await expect.poll(() => shown(page, RANK_TEXT.title), { message: '뒤로 가기로 창이 닫혀야 한다' }).toBe(false);
    expect(await page.evaluate((key) => window.__pocketArcade?.scene.isActive(key), KEY)).toBe(true);

    // 다시 연결되면 올리지 못한 기록이 올라가서, 다시 불러온 랭킹에 내 줄이 보인다.
    await openRank(page);
    await expect.poll(() => shown(page, RANK_TEXT.retry), WAIT).toBe(true);
    await context.setOffline(false);
    await page.waitForFunction(() => navigator.onLine);
    await tapText(page, KEY, RANK_TEXT.retry);
    await expectMine(page, player, score);
    expect(await shown(page, RANK_TEXT.retry)).toBe(false);
    await expectClear(page, '다시 불러온 랭킹 창');
    expect(dailySubmits(submits), '오늘의 판의 점수는 한 번만 올린다').toHaveLength(1);
    expect((await serverBoard(page, player)).me).toMatchObject({ score, name: player.name });
  } finally {
    await context.setOffline(false);
    await forget(page, player);
  }
});

it('행운 슬롯 오늘의 판 랭킹: 아직 아무도 없는 랭킹은 그렇다고 알리고, 닉네임을 정하라고 권한다', async ({ page }) => {
  // 로컬 서버의 오늘의 랭킹에는 다른 점검이 올린 줄이 있을 수 있어서, 빈 랭킹은 서버의 답을 바꿔 끼워서 본다.
  const today = rankDayOf(Date.now());
  await page.route(`**/api/daily/${SLOT_GAME_ID}*`, (route) =>
    route.fulfill({ json: { top: [], me: null, day: today } satisfies RankBoard }),
  );
  const submits = collectSubmits(page);
  await openApp(page);
  await startScene(page, KEY);
  await switchToDaily(page);
  await openRank(page);
  await expect.poll(async () => (await texts(page)).includes(RANK_TEXT.empty), WAIT).toBe(true);
  expect(await texts(page)).toContain(RANK_TEXT.guest);
  expect(await shown(page, RANK_TEXT.join)).toBe(true);
  expect(await shown(page, rankDate(today))).toBe(true);
  expect(await shown(page, RANK_TEXT.retry)).toBe(false);
  expect(await shown(page, RANK_TEXT.next), '한 쪽에 다 들어가면 쪽을 넘기는 버튼이 없다').toBe(false);
  await expectClear(page, '빈 랭킹 창');
  expect(submits, '닉네임이 없으면 창을 열어도 아무것도 올리지 않는다').toEqual([]);

  // 창 밖을 누르면 닫히고, 판은 그대로다.
  await tapAt(page, 3, 3);
  await expect.poll(() => shown(page, RANK_TEXT.title), { message: '창 밖을 누르면 닫혀야 한다' }).toBe(false);
  expect((await view(page)).run.spinCount).toBe(0);
  await expect.poll(() => hiddenTexts(page, KEY), { message: '창을 닫은 뒤의 시작 화면' }).toEqual([]);
});

it('행운 슬롯 오늘의 판 랭킹: 서른 줄이 꽉 차고 닉네임과 점수가 가장 길어도 가려지는 글자가 없다', async ({ page }) => {
  // 가장 넓은 닉네임(열 글자)과 가장 큰 점수로 꽉 찬 랭킹. 내 순위는 세는 범위 밖이라 내 기록 칸의 글이 가장 길다.
  const today = rankDayOf(Date.now());
  const wide = ['WWWWWWWWWW', '가나다라마바사아자차', '일곱빛깔무지개구름떡', 'MMMMMMMMMM'];
  const me = { device: randomUUID(), name: wide[0] };
  const top = Array.from({ length: TOP_COUNT }, (_, index) => ({
    rank: index + 1,
    name: wide[index % wide.length],
    score: 999_999 - index,
    mine: false,
  }));
  const board: RankBoard = { top, me: { rank: RANK_SCAN + 1, score: 999_999, name: me.name }, day: today };
  await page.route(`**/api/daily/${SLOT_GAME_ID}*`, (route) => route.fulfill({ json: board }));
  // 닉네임을 올리는 요청도 서버까지 가지 않게 한다.
  await page.route('**/api/rank', (route) => route.fulfill({ json: { bests: {}, ranks: {} } }));
  await page.addInitScript(
    ({ device, name }) => localStorage.setItem('pocket-arcade:save', JSON.stringify({ online: { id: device, name } })),
    me,
  );
  await openApp(page);
  await startScene(page, KEY);
  await switchToDaily(page);
  await openRank(page);

  // 한 쪽에 다 들어가지 않아서 쪽으로 나뉜다. 끝 쪽까지 넘기며 본다.
  await expect.poll(() => shown(page, RANK_TEXT.next), WAIT).toBe(true);
  const pageLabel = async (): Promise<[number, number]> => {
    const label = (await texts(page)).find((text) => /^\d+\/\d+$/.test(text)) ?? '0/0';
    const [now, all] = label.split('/').map(Number);
    return [now, all];
  };
  const [, pages] = await pageLabel();
  expect(pages, '서른 줄은 한 쪽에 다 들어가지 않는다').toBeGreaterThan(1);
  const seen = new Set<string>();
  for (let index = 1; index <= pages; index += 1) {
    await expect.poll(async () => (await pageLabel())[0], { message: `${index}쪽이 보여야 한다` }).toBe(index);
    await expectClear(page, `꽉 찬 랭킹의 ${index}쪽`);
    for (const text of await texts(page)) if (/^\d{6}$/.test(text)) seen.add(text);
    if (index < pages) await tapText(page, KEY, RANK_TEXT.next);
  }
  expect(seen.size, '쪽을 다 넘기면 서른 줄을 모두 본다').toBe(TOP_COUNT);
  // 내 기록 칸: 닉네임과, 세는 범위 밖의 순위와 점수가 함께 보인다.
  const all = await texts(page);
  expect(all).toContain(me.name);
  expect(all.some((text) => text.replace(/\s+/g, ' ') === `${RANK_SCAN}위 밖 · 999999점`)).toBe(true);
  // 이전으로 돌아갈 수 있다.
  await tapText(page, KEY, RANK_TEXT.prev);
  await expect.poll(async () => (await pageLabel())[0]).toBe(pages - 1);
});
