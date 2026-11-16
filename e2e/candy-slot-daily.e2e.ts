/**
 * 행운 슬롯의 오늘의 판을 화면에서 점검한다: 시작 화면의 버튼으로 오늘의 판으로 바꾸면 새로 열 때마다 같은 판이 나오는지,
 * 판을 바꾸는 버튼과 오늘의 판이라는 표시가 두 화면 크기에서 가려지거나 화면 밖으로 나가지 않는지,
 * 첫 스핀을 돌리면 버튼이 사라지는지, 그리고 마친 판이 그날의 기록으로 남는지 본다.
 * 장면을 새로 열기 전에는 하던 판을 마쳐 둔다. 하다 만 판이 남아 있으면 새로 연 장면이 그 판을 이어 줄 수도 있기 때문이다.
 */
import './app-globals';
import { expect, type Page } from '@playwright/test';
import { SCENE } from '../src/config';
import {
  addDailyRun,
  createDaily,
  DAILY_LABEL,
  dailyDayOf,
  dailyInfo,
  dailyVerdict,
  dayIndexOf,
} from '../src/games/candy-slot/daily';
import { newRun, randomOf, spin, type RunState } from '../src/games/candy-slot/rules';
import { hiddenTexts, it, openApp, startScene, tapText, textPoint, waitForScene } from './app';

/** 느린 기계에서도 스핀 하나가 다 보일 때까지 기다리는 시간 */
const WAIT = { timeout: 15_000 };
const SPIN = '돌리기';

/** 행운 슬롯 장면에서 이 점검이 들여다보는 것 */
interface SlotView {
  run: RunState;
  busy: boolean;
  /** 일시정지 화면의 "기록하고 끝내기"가 부르는 것 */
  finishFromPause(): void;
  /** 돌고 있는 스핀을 결과까지 건너뛴다(도는 중에 기계를 누른 것과 같다). */
  skipSpin(): boolean;
}

function view(page: Page): Promise<{ run: RunState; busy: boolean }> {
  return page.evaluate((key) => {
    const { run, busy } = window.__pocketArcade?.scene.getScene(key) as unknown as SlotView;
    return { run, busy };
  }, SCENE.candySlot);
}

/** 그 글자가 보이는지 */
async function shown(page: Page, text: string): Promise<boolean> {
  return (await textPoint(page, SCENE.candySlot, text)) !== null;
}

/** 시작 화면의 버튼을 눌러 오늘의 판으로 바꾸고, 그 판의 씨앗을 돌려준다. */
async function switchToDaily(page: Page): Promise<string> {
  await tapText(page, SCENE.candySlot, DAILY_LABEL.name);
  await expect.poll(async () => (await view(page)).run.seed, { message: '오늘의 판으로 바뀌어야 한다' }).not.toBeNull();
  const { seed } = (await view(page)).run;
  if (seed === null) throw new Error('오늘의 판의 씨앗이 없다');
  return seed;
}

/**
 * 돌리기를 한 번 누르고, 결과를 다 보여 줄 때까지 기다린 뒤 나온 판을 돌려준다.
 * 릴이 도는 것과 맞은 줄을 보여 주는 것은 건너뛴다. 끝까지 지켜보면 느린 기계에서는 스핀 여섯 번이 점검의 제한 시간을 넘긴다.
 * 건너뛰어도 같은 판이 된다는 것은 candy-slot-feel.e2e.ts가 본다.
 */
async function spinOnce(page: Page): Promise<number[]> {
  const before = (await view(page)).run.spinCount;
  await tapText(page, SCENE.candySlot, SPIN);
  await expect
    .poll(async () => (await view(page)).run.spinCount, { ...WAIT, message: '돌리기가 눌려야 한다' })
    .toBe(before + 1);
  await page.evaluate(
    (key) => (window.__pocketArcade?.scene.getScene(key) as unknown as SlotView).skipSpin(),
    SCENE.candySlot,
  );
  await expect
    .poll(async () => {
      const { run, busy } = await view(page);
      return run.spinCount === before + 1 && !busy;
    }, { ...WAIT, message: '스핀 하나가 끝나야 한다' })
    .toBe(true);
  const grid = (await view(page)).run.lastGrid;
  if (!grid) throw new Error('돌린 뒤에는 나온 판이 있어야 한다');
  return grid;
}

/** 그 씨앗의 판에서 첫 스핀에 나와야 하는 판(규칙이 셈한 것) */
function firstGridOf(seed: string): number[] {
  const run = newRun(seed);
  const result = spin(
    run,
    randomOf(run, 'spin', () => {
      throw new Error('오늘의 판은 밖에서 준 운을 쓰지 않는다');
    }),
  );
  if (!result) throw new Error('새 판은 돌릴 수 있어야 한다');
  return result.outcome.grid;
}

/** 일시정지 화면의 "기록하고 끝내기"와 같은 길로 판을 마치고, 결과 화면이 뜰 때까지 기다린다. */
async function finishRun(page: Page): Promise<void> {
  await page.evaluate(
    (key) => (window.__pocketArcade?.scene.getScene(key) as unknown as SlotView).finishFromPause(),
    SCENE.candySlot,
  );
  await waitForScene(page, SCENE.result);
}

it('행운 슬롯 오늘의 판: 새로 열 때마다 같은 판이 나온다', async ({ page }) => {
  // 앱을 두 번 열고 판을 세 번 시작하는 긴 점검이라, 느린 기계에서도 끝나도록 제한 시간을 늘린다.
  it.slow();
  const dayBefore = dayIndexOf(new Date());
  await openApp(page);
  await startScene(page, SCENE.candySlot);
  expect((await view(page)).run.seed, '여느 판으로 시작한다').toBeNull();

  const seed = await switchToDaily(page);
  // 씨앗은 오늘(한국 시각의 날)의 것이다. 점검하는 사이에 날이 넘어갔을 수도 있다.
  expect([dayBefore, dayIndexOf(new Date())]).toContain(dailyDayOf(seed));
  const first = [await spinOnce(page), await spinOnce(page)];
  expect(first[0], '첫 스핀은 규칙이 그 씨앗으로 셈한 판이다').toEqual(firstGridOf(seed));
  await finishRun(page);

  // 장면을 새로 열어도 같은 판이 같은 차례로 나온다.
  await startScene(page, SCENE.candySlot);
  expect((await view(page)).run.seed, '새로 열면 여느 판이다').toBeNull();
  expect(await switchToDaily(page)).toBe(seed);
  expect([await spinOnce(page), await spinOnce(page)], '장면을 새로 연 뒤').toEqual(first);
  await finishRun(page);

  // 앱을 새로 열어도 같다.
  await openApp(page);
  await startScene(page, SCENE.candySlot);
  expect(await switchToDaily(page)).toBe(seed);
  expect([await spinOnce(page), await spinOnce(page)], '앱을 새로 연 뒤').toEqual(first);
});

it('행운 슬롯 오늘의 판: 판을 바꾸는 버튼과 표시가 가려지지 않고, 첫 스핀을 돌리면 버튼이 사라진다', async ({ page }) => {
  await openApp(page);
  await startScene(page, SCENE.candySlot);

  // 여느 판의 시작 화면: 오늘의 판으로 가는 버튼이 보인다.
  expect(await shown(page, DAILY_LABEL.name), '오늘의 판으로 가는 버튼').toBe(true);
  expect(await shown(page, DAILY_LABEL.back)).toBe(false);
  expect(await hiddenTexts(page, SCENE.candySlot), '여느 판의 시작 화면').toEqual([]);

  // 오늘의 판의 시작 화면: 돌아가는 버튼, 오늘의 판이라는 표시, 오늘의 기록 한 줄이 보인다.
  await switchToDaily(page);
  // 저장이 비어 있는 채로 열었으므로 오늘의 기록 대신 무엇을 하는 판인지가 적힌다.
  const info = dailyInfo(createDaily(), 1);
  for (const text of [DAILY_LABEL.back, DAILY_LABEL.name, info]) {
    await expect.poll(() => shown(page, text), { message: `"${text}"가 보여야 한다` }).toBe(true);
  }
  // 표시는 스르르 나타난다. 다 나타난 뒤에 본다.
  await expect.poll(() => hiddenTexts(page, SCENE.candySlot), { message: '오늘의 판의 시작 화면' }).toEqual([]);

  // 여느 판으로 돌아가면 표시가 사라지고, 다시 오늘의 판으로 갈 수 있다.
  await tapText(page, SCENE.candySlot, DAILY_LABEL.back);
  await expect.poll(async () => (await view(page)).run.seed, { message: '여느 판으로 돌아가야 한다' }).toBeNull();
  expect(await shown(page, DAILY_LABEL.back)).toBe(false);
  expect(await shown(page, info)).toBe(false);
  expect(await shown(page, DAILY_LABEL.name), '오늘의 판으로 가는 버튼').toBe(true);
  expect(await hiddenTexts(page, SCENE.candySlot), '돌아온 시작 화면').toEqual([]);

  // 첫 스핀을 돌리면 버튼과 기록 한 줄은 사라지고, 오늘의 판이라는 표시만 남는다.
  const seed = await switchToDaily(page);
  await spinOnce(page);
  expect(await shown(page, DAILY_LABEL.back), '돌린 뒤에는 판을 바꿀 수 없다').toBe(false);
  expect(await shown(page, info)).toBe(false);
  expect(await shown(page, DAILY_LABEL.name), '오늘의 판이라는 표시는 남는다').toBe(true);
  expect((await view(page)).run.seed).toBe(seed);
  // 받은 금화가 떠오르는 글자가 사라진 뒤에 본다.
  await expect.poll(() => hiddenTexts(page, SCENE.candySlot), { ...WAIT, message: '오늘의 판을 하는 동안' }).toEqual([]);
});

it('행운 슬롯 오늘의 판: 여느 판에서도 첫 스핀을 돌리면 오늘의 판으로 가는 버튼이 사라진다', async ({ page }) => {
  await openApp(page);
  await startScene(page, SCENE.candySlot);
  expect(await shown(page, DAILY_LABEL.name)).toBe(true);
  await spinOnce(page);
  expect(await shown(page, DAILY_LABEL.name), '돌린 뒤에는 판을 바꿀 수 없다').toBe(false);
  expect((await view(page)).run.seed, '여느 판 그대로다').toBeNull();
});

it('행운 슬롯 오늘의 판: 마친 판이 그날의 기록으로 남고, 다시 하기는 오늘의 판을 다시 연다', async ({ page }) => {
  await openApp(page);
  await startScene(page, SCENE.candySlot);
  const seed = await switchToDaily(page);
  const today = dailyDayOf(seed) ?? 0;
  await spinOnce(page);
  // 한 번 돌리고 마친 판: 넘긴 라운드는 없다.
  const outcome = addDailyRun(createDaily(), today, { score: (await view(page)).run.earned, rounds: 0 });

  await finishRun(page);
  await expect.poll(() => textPoint(page, SCENE.result, DAILY_LABEL.name), WAIT).not.toBeNull();
  expect(await textPoint(page, SCENE.result, dailyVerdict(outcome)), '오늘 처음 마친 판이라고 적힌다').not.toBeNull();

  // 다시 하기를 누르면 오늘의 판이 다시 열리고, 시작 화면에 오늘의 최고 기록이 적힌다.
  await tapText(page, SCENE.result, '다시 하기');
  await expect
    .poll(async () => (await view(page)).run, { ...WAIT, message: '오늘의 판이 새로 열려야 한다' })
    .toMatchObject({ seed, spinCount: 0 });
  const best = dailyInfo(outcome.record, today);
  await expect.poll(() => shown(page, best), { ...WAIT, message: `"${best}"가 보여야 한다` }).toBe(true);
  expect(await shown(page, DAILY_LABEL.back), '여느 판으로 돌아갈 수 있다').toBe(true);
  await expect.poll(() => hiddenTexts(page, SCENE.candySlot), { message: '기록이 있는 시작 화면' }).toEqual([]);
});
