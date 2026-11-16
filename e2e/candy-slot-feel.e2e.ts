/**
 * 행운 슬롯의 화면 점검: 스핀을 건너뛰어도 끝까지 본 것과 같은 판이 되는지, 잠근 열의 세 그림이 그대로 남는지 본다.
 * 나올 그림은 난수를 잠깐 바꿔서 정하고, 그 판에서 받을 금화는 규칙(rules.ts)으로 따로 셈해서 견준다.
 * 그래서 그림의 무게나 상금을 고쳐도 이 점검은 그대로 맞는다.
 */
import './app-globals';
import { expect, test, type Page } from '@playwright/test';
import { SCENE } from '../src/config';
import {
  CELLS,
  scoreSpin,
  settleRound,
  SIZE,
  spin,
  targetOf,
  type RunState,
  type SpinOutcome,
} from '../src/games/candy-slot/rules';
import { hiddenTexts, it, openApp, startScene, tapAt, textPoint } from './app';

/** 화면이 바뀌기를 기다리는 시간 */
const WAIT = { timeout: 20_000 } as const;
/**
 * 여덟 줄이 맞은 스핀이 저절로 끝나기를 기다리는 시간. 게임의 시간으로는 2초 남짓이지만, 그리는 것이 느린 기계에서는
 * 게임의 시간이 벽시계보다 느리게 간다(화면 없는 브라우저에서 재 보니 10초 남짓 걸렸다).
 */
const WAIT_PLAYED = { timeout: 45_000 } as const;

/** 한 칸의 그림을 정하는 난수: 가장 흔한 그림만 나오는 값과 7만 나오는 값 */
const FIRST_SYMBOL = 0.001;
const LAST_SYMBOL = 0.999;
/** 아홉 칸이 모두 같은 그림이 되는 난수들. 여덟 줄이 다 맞는다. */
const ALL_SAME: readonly number[] = Array.from({ length: CELLS }, () => FIRST_SYMBOL);
const ALL_SEVEN: readonly number[] = Array.from({ length: CELLS }, () => LAST_SYMBOL);

/** 행운 슬롯 장면에서 이 점검이 들여다보는 것 */
interface FeelScene {
  run: RunState;
  busy: boolean;
  layout: { cell: number; gridLeft: number; gridTop: number };
  /** 돌고 있는 스핀 */
  reel: { elapsed: number } | null;
  /** 결과를 보여 주고 있는 스핀과, 그 가운데 이미 그은 줄의 수 */
  showing: { lines: number } | null;
  /** 받았지만 아직 화면의 수에 넣지 않은 금화 */
  pending: number;
  /** 다음 스핀에서 잠그려고 골라 둔 열과, 돌고 있는 스핀에서 잠가 둔 열 */
  holdCol: number | null;
  heldNow: number | null;
  cells: Array<{ texture: { key: string }; alpha: number }>;
  time: { timeScale: number };
  trySpin(): void;
}

interface FeelView {
  run: RunState;
  busy: boolean;
  spinning: boolean;
  showing: boolean;
  pending: number;
  holdCol: number | null;
  heldNow: number | null;
  /** 칸마다 놓인 그림의 텍스처 이름과 또렷한 정도 */
  cells: Array<{ key: string; alpha: number }>;
}

function view(page: Page): Promise<FeelView> {
  return page.evaluate((key) => {
    const scene = window.__pocketArcade?.scene.getScene(key) as unknown as FeelScene;
    return {
      run: scene.run,
      busy: scene.busy,
      spinning: scene.reel !== null,
      showing: scene.showing !== null,
      pending: scene.pending,
      holdCol: scene.holdCol,
      heldNow: scene.heldNow,
      cells: scene.cells.map((cell) => ({ key: cell.texture.key, alpha: cell.alpha })),
    };
  }, SCENE.candySlot);
}

/** 정해 둔 수를 차례로 내주는 난수. 다 쓰면 0.5를 준다. */
function queued(values: readonly number[]): () => number {
  let at = 0;
  return () => (at < values.length ? values[at++] : 0.5);
}

/** 그 난수들로 돌렸을 때 규칙이 내는 결과 */
function ruled(run: RunState, values: readonly number[], hold: number | null = null): { run: RunState; outcome: SpinOutcome } {
  const result = spin(run, queued(values), hold);
  if (!result) throw new Error('돌릴 수 없는 판이다');
  return result;
}

/** 한 줄도 맞지 않는 판이 나오는 난수들을 찾는다. 씨앗이 정해져 있어서 언제나 같은 것을 찾는다. */
function missValues(run: RunState): number[] {
  let state = 12345;
  const next = (): number => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return state / 4294967296;
  };
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const values = Array.from({ length: CELLS }, next);
    if (ruled(run, values).outcome.wins.length === 0) return values;
  }
  throw new Error('꽝이 나오는 난수를 찾지 못했다');
}

/**
 * 난수를 잠깐 바꿔 놓고 한 번 돌린다. 그다음은 then에 따른다:
 * play는 그대로 두고, freeze는 열들이 저절로 멈추지 않게 도는 시간을 멀찍이 뒤로 돌려 두고(건너뛰어야만 끝난다),
 * skip은 그 자리에서 건너뛴다(돌리기 버튼을 곧바로 한 번 더 누른 것과 같다).
 */
function spinWith(page: Page, values: readonly number[], then: 'play' | 'freeze' | 'skip' = 'play'): Promise<void> {
  return page.evaluate(
    ([key, list, next]) => {
      const scene = window.__pocketArcade?.scene.getScene(key) as unknown as FeelScene;
      const real = Math.random;
      let at = 0;
      Math.random = () => (at < list.length ? list[at++] : real());
      try {
        scene.trySpin();
      } finally {
        Math.random = real;
      }
      if (next === 'freeze' && scene.reel) scene.reel.elapsed = -600_000;
      if (next === 'skip') scene.trySpin();
    },
    [SCENE.candySlot, values, then] as const,
  );
}

/** 기계의 한 열(0부터)의 가운데 칸을 누른다. */
async function tapColumn(page: Page, col: number): Promise<void> {
  const layout = await page.evaluate(
    (key) => (window.__pocketArcade?.scene.getScene(key) as unknown as FeelScene).layout,
    SCENE.candySlot,
  );
  await tapAt(page, layout.gridLeft + (col + 0.5) * layout.cell, layout.gridTop + (SIZE / 2) * layout.cell);
}

/** 돌리기 버튼을 누른다. 버튼의 글은 때에 따라 바뀌므로 지금 적힌 글로 찾는다. */
async function tapButton(page: Page, label: string): Promise<void> {
  const point = await textPoint(page, SCENE.candySlot, label);
  expect(point, `버튼에 "${label}"가 적혀 있어야 한다`).not.toBeNull();
  if (point) await tapAt(page, point.x, point.y);
}

async function waitIdle(page: Page, message: string, wait: { timeout: number } = WAIT): Promise<void> {
  await expect.poll(async () => (await view(page)).busy, { ...wait, message }).toBe(false);
}

/** 화면의 아홉 칸이 판과 맞는지: 같은 그림의 칸은 같은 텍스처를, 다른 그림의 칸은 다른 텍스처를 쓰고 모두 또렷하다. */
function expectCellsShow(shown: FeelView, grid: readonly number[]): void {
  for (let a = 0; a < CELLS; a += 1) {
    expect(shown.cells[a].alpha, `${a}번 칸은 또렷해야 한다`).toBe(1);
    for (let b = a + 1; b < CELLS; b += 1) {
      expect(shown.cells[a].key === shown.cells[b].key, `${a}번 칸과 ${b}번 칸의 그림`).toBe(grid[a] === grid[b]);
    }
  }
}

it('행운 슬롯: 스핀을 건너뛰어도 끝까지 본 것과 같은 판이 되고, 건너뛴 누름으로 다음 스핀이 돌지 않는다', async ({ page }) => {
  // 여덟 줄을 하나씩 보여 주는 스핀을 한 번은 끝까지 기다려서 화면 점검 하나보다 오래 걸린다.
  test.slow();
  await openApp(page);
  await startScene(page, SCENE.candySlot);
  const start = (await view(page)).run;

  // 1. 아홉 칸이 다 맞는 판을 끝까지 본다.
  const played = ruled(start, ALL_SAME);
  expect(played.outcome.jackpot, '아홉 칸이 다 맞는 판이어야 한다').toBe(true);
  await spinWith(page, ALL_SAME);
  expect(await textPoint(page, SCENE.candySlot, '건너뛰기'), '도는 동안 버튼은 건너뛰기다').not.toBeNull();
  await waitIdle(page, '스핀이 저절로 끝나야 한다', WAIT_PLAYED);
  expect((await view(page)).run, '끝까지 본 판').toEqual(played.run);

  // 2. 한 줄도 맞지 않는 판을, 도는 중에 기계를 눌러 건너뛴다.
  const miss = missValues(played.run);
  const skippedMiss = ruled(played.run, miss);
  await spinWith(page, miss, 'freeze');
  expect((await view(page)).spinning).toBe(true);
  await tapColumn(page, 1);
  await waitIdle(page, '기계를 누르면 스핀이 바로 끝나야 한다');
  let now = await view(page);
  expect(now.run, '도는 중에 건너뛴 판').toEqual(skippedMiss.run);
  expect(now.pending, '보여 주지 않은 금화가 남지 않는다').toBe(0);
  expect(now.holdCol, '건너뛴 누름으로 열이 잠기지 않는다').toBeNull();
  expectCellsShow(now, skippedMiss.run.lastGrid ?? []);

  // 3. 같은 아홉 칸짜리 판을, 줄을 긋는 중에 버튼을 눌러 건너뛴다. 끝까지 본 1번과 받은 금화가 같아야 한다.
  const skipped = ruled(skippedMiss.run, ALL_SAME);
  expect(skipped.outcome.total).toBe(played.outcome.total);
  await spinWith(page, ALL_SAME);
  // 줄을 긋기 시작하면 씬의 시계를 거의 세워서, 누르기 전에 결과가 저절로 다 보이지 않게 한다.
  await page.waitForFunction(
    (key) => {
      const scene = window.__pocketArcade?.scene.getScene(key) as unknown as FeelScene;
      if (!scene.showing || scene.showing.lines < 1) return false;
      scene.time.timeScale = 0.001;
      return true;
    },
    SCENE.candySlot,
    WAIT,
  );
  expect((await view(page)).pending, '아직 보여 주지 않은 줄의 금화가 남아 있다').toBeGreaterThan(0);
  await tapButton(page, '건너뛰기');
  await waitIdle(page, '버튼을 누르면 남은 줄을 한꺼번에 보여 주고 끝나야 한다');
  await page.evaluate((key) => {
    (window.__pocketArcade?.scene.getScene(key) as unknown as FeelScene).time.timeScale = 1;
  }, SCENE.candySlot);
  now = await view(page);
  expect(now.run, '줄을 보여 주는 중에 건너뛴 판').toEqual(skipped.run);
  expect(now.pending).toBe(0);
  expect(now.showing).toBe(false);
  expectCellsShow(now, skipped.run.lastGrid ?? []);
  const goal = `${skipped.run.coin} / ${targetOf(skipped.run.round)}`;
  expect(await textPoint(page, SCENE.candySlot, goal), `목표 카드에 "${goal}"가 적혀야 한다`).not.toBeNull();
  expect(await textPoint(page, SCENE.candySlot, '돌리기'), '버튼은 다시 돌리기다').not.toBeNull();

  // 거둔 일이 뒤늦게 돌아서 금화가 더 들어오거나, 건너뛴 누름으로 다음 스핀이 돌지 않는다.
  await page.waitForTimeout(1_500);
  now = await view(page);
  expect(now.run, '건너뛴 뒤 한참 지난 판').toEqual(skipped.run);
  expect(now.busy).toBe(false);

  // 4. 남은 스핀을 모두 돌리자마자 건너뛴다. 마지막 스핀을 건너뛰어도 라운드는 한 번만 맺힌다.
  let expected = skipped.run;
  while (expected.spinsLeft > 0) {
    expected = ruled(expected, ALL_SAME).run;
    await spinWith(page, ALL_SAME, 'skip');
    // 마지막 스핀 뒤에는 곧 라운드가 맺혀 판이 바뀌므로, 그 전의 스핀들만 여기서 견준다.
    if (expected.spinsLeft === 0) break;
    now = await view(page);
    expect(now.run, `스핀이 ${expected.spinsLeft}번 남은 판`).toEqual(expected);
    expect(now.busy, '건너뛰면 바로 다음 스핀을 받는다').toBe(false);
  }
  const settled = settleRound(expected, Math.random);
  expect(settled?.cleared, '목표를 채운 판이어야 한다').toBe(true);
  await expect.poll(async () => (await view(page)).run.phase, { ...WAIT, message: '가게가 열려야 한다' }).toBe('shop');
  await expect.poll(() => textPoint(page, SCENE.candySlot, '부적 가게'), WAIT).not.toBeNull();
  now = await view(page);
  expect(now.run.coin, '목표만큼만 낸다').toBe(settled?.run.coin);
  expect(now.run.earned).toBe(settled?.run.earned);
  expect(now.run.round).toBe(expected.round);
});

it('행운 슬롯: 열을 눌러 잠그면 그 열의 세 그림은 돌지 않고 그대로 남는다', async ({ page }) => {
  await openApp(page);
  await startScene(page, SCENE.candySlot);
  const start = (await view(page)).run;

  // 첫 스핀 전에는 잠글 것이 없다.
  await tapColumn(page, 0);
  expect((await view(page)).holdCol, '첫 스핀 전에는 열이 골라지지 않는다').toBeNull();

  // 한 번 돌리면 열을 잠글 수 있다.
  const miss = missValues(start);
  const first = ruled(start, miss).run;
  await spinWith(page, miss, 'skip');
  expect((await view(page)).run).toEqual(first);
  // 잠깐 떴다 사라지는 알림이 지나간 뒤에는 가려진 글이 없어야 한다(남은 잠그기를 적는 표까지).
  await expect.poll(() => hiddenTexts(page, SCENE.candySlot), { ...WAIT, message: '가려진 글이 없어야 한다' }).toEqual([]);

  // 열을 누르면 골라지고, 다른 열을 누르면 옮겨 가고, 다시 누르면 풀린다.
  const held0 = { message: '누른 열이 골라져야 한다' };
  await tapColumn(page, 0);
  await expect.poll(async () => (await view(page)).holdCol, held0).toBe(0);
  expect(await textPoint(page, SCENE.candySlot, '잠그고 돌리기'), '버튼에 잠그고 돌린다고 적힌다').not.toBeNull();
  await tapColumn(page, 2);
  await expect.poll(async () => (await view(page)).holdCol, { message: '다른 열로 옮겨 가야 한다' }).toBe(2);
  await tapColumn(page, 2);
  await expect.poll(async () => (await view(page)).holdCol, { message: '다시 누르면 풀려야 한다' }).toBeNull();
  expect(await textPoint(page, SCENE.candySlot, '돌리기')).not.toBeNull();
  await tapColumn(page, 0);
  await expect.poll(async () => (await view(page)).holdCol, held0).toBe(0);
  const before = await view(page);
  const heldCells = Array.from({ length: SIZE }, (_, row) => row * SIZE);

  // 0번 열을 잠그고 돌린다. 나머지 칸에는 모두 7이 나오게 해서, 잠근 열만 앞의 그림으로 남는지 본다.
  const held = ruled(first, ALL_SEVEN, 0);
  await spinWith(page, ALL_SEVEN, 'freeze');
  await page.waitForTimeout(400);
  const turning = await view(page);
  expect(turning.spinning, '건너뛰기 전에는 계속 돈다').toBe(true);
  expect(turning.heldNow).toBe(0);
  for (let cell = 0; cell < CELLS; cell += 1) {
    if (heldCells.includes(cell)) {
      expect(turning.cells[cell], `잠근 ${cell}번 칸은 도는 동안에도 그대로다`).toEqual({ key: before.cells[cell].key, alpha: 1 });
    } else {
      expect(turning.cells[cell].alpha, `${cell}번 칸은 돌고 있다`).toBeLessThan(1);
    }
  }
  await tapColumn(page, 1);
  await waitIdle(page, '기계를 누르면 스핀이 바로 끝나야 한다');

  const after = await view(page);
  expect(after.run, '잠그고 돌린 판').toEqual(held.run);
  const grid = after.run.lastGrid ?? [];
  for (const cell of heldCells) {
    expect(grid[cell], `잠근 ${cell}번 칸의 그림`).toBe(first.lastGrid?.[cell]);
    expect(after.cells[cell].key, `화면의 ${cell}번 칸`).toBe(before.cells[cell].key);
  }
  expectCellsShow(after, grid);
  expect(after.run.holdsLeft, '잠그기는 라운드에 한 번이다').toBe(0);
  expect(after.holdCol).toBeNull();
  expect(after.heldNow).toBeNull();
  // 받은 금화는 나온 판을 규칙으로 셈한 것과 같다.
  const scored = scoreSpin(grid, after.run.charms, { last: first.spinsLeft === 1, afterMiss: first.afterMiss });
  expect(after.run.coin).toBe(first.coin + scored.total);

  // 다 쓴 뒤에는 열을 눌러도 골라지지 않고, 까닭을 알린다.
  await tapColumn(page, 2);
  await expect
    .poll(() => textPoint(page, SCENE.candySlot, '잠그기는 라운드마다 한 번이에요'), { message: '다 썼다고 알려야 한다' })
    .not.toBeNull();
  expect((await view(page)).holdCol, '잠그기를 다 쓰면 열이 골라지지 않는다').toBeNull();
  expect((await view(page)).run).toEqual(held.run);
});
