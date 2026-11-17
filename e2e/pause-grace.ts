/**
 * 시간 제한 퍼즐의 일시정지 점검을 여러 게임이 함께 쓰는 도구.
 *
 * 시간 제한 퍼즐은 일시정지한 동안 판을 가리고, 돌아오면 판을 곧바로 다시 보여 준 뒤 "준비!"가 떠 있는 동안 시계를 세워 둔다.
 * 그 "준비!"가 끝나기 전에 다시 멈추면 그동안 판을 본 시간을 시계에서 빼야 한다(9차 검토 C1).
 * 그러지 않으면 멈추기를 되풀이해 시계를 세워 둔 채 판을 볼 수 있다.
 */
import { expect, type Page } from '@playwright/test';
import { startScene } from './app';

/** 장면들이 일시정지에서 돌아온 뒤 시계를 세워 두는 시간(초). 따로 적지 않은 게임은 이 값을 쓴다. */
const RESUME_GRACE_SECONDS = 0.6;

/** 장면에서 이 점검이 들여다보는 것 */
interface ClockView {
  playing: boolean;
  phase?: string;
  /** 남은 시간은 판의 상태(run)에 두는 게임이 많고, 장면에 바로 두는 게임(핀 뽑기)도 있다. */
  run?: { timeLeft: number };
  timeLeft?: number;
}

export interface PauseGraceGame {
  /** 장면 이름 */
  key: string;
  /** 시계가 흐르기 시작하게 하는 길: 첫 조작을 기다리는 문(gate), 또는 저절로 시작하기를 기다리는 표시(started) */
  clock: 'gate' | 'started';
  /** 판을 누를 수 있을 때의 장면 단계. 단계를 따로 두지 않는 게임은 비워 둔다. */
  phase?: string;
  /** 돌아온 뒤 시계를 세워 두는 시간(초). 비우면 RESUME_GRACE_SECONDS */
  graceSeconds?: number;
}

function timeLeft(page: Page, key: string): Promise<number> {
  return page.evaluate((k) => {
    const scene = window.__pocketArcade?.scene.getScene(k) as unknown as ClockView;
    const left = scene.run?.timeLeft ?? scene.timeLeft;
    if (left === undefined) throw new Error('남은 시간을 찾지 못했다');
    return left;
  }, key);
}

/** 시계가 그만큼 줄어들 때까지 기다린다. */
async function waitForClock(page: Page, key: string, seconds: number, message: string): Promise<void> {
  const from = await timeLeft(page, key);
  await expect.poll(async () => from - (await timeLeft(page, key)), { message, timeout: 10_000 }).toBeGreaterThan(seconds);
}

/**
 * 점수 도전으로 열어 시계를 흐르게 한 뒤, "준비!"가 끝나기 전에 다시 멈추기를 되풀이한다.
 * 판이 보인 시간만큼 시계가 줄어야 한다.
 *
 * 화면을 그리는 틈은 기계마다 고르지 않으므로, 판이 보인 시간은 벽시계가 아니라 장면이 센 "준비!"의 남은 시간으로 잰다.
 */
export async function expectRepausingCostsTime(page: Page, game: PauseGraceGame): Promise<void> {
  await startScene(page, game.key);
  await expect
    .poll(
      () =>
        page.evaluate(
          ([k, phase]) => {
            const scene = window.__pocketArcade?.scene.getScene(k) as unknown as ClockView;
            return scene.playing && (phase === null || scene.phase === phase);
          },
          [game.key, game.phase ?? null] as const,
        ),
      { message: '판을 누를 수 있어야 한다' },
    )
    .toBe(true);

  // 첫 조작을 한 것으로 해서 시계를 흐르게 한다.
  await page.evaluate(
    ([k, clock]) => {
      const scene = window.__pocketArcade?.scene.getScene(k) as unknown as {
        gate: { start(): boolean };
        started: boolean;
      };
      if (clock === 'gate') scene.gate.start();
      else scene.started = true;
    },
    [game.key, game.clock] as const,
  );
  // 그냥 두면 시계가 흐르는지부터 본다. 흐르지 않으면 아래의 견줌이 아무것도 보여 주지 못한다.
  await waitForClock(page, game.key, 0.3, '그냥 두면 시계가 흘러야 한다');

  await page.evaluate((k) => window.__pocketArcade?.scene.pause(k), game.key);
  const start = await timeLeft(page, game.key);
  let shown = 0;
  for (let round = 0; round < 6; round += 1) {
    // 돌아온 뒤 "준비!"가 0.3초 안쪽으로 남았을 때 다시 멈춘다.
    // 장면은 한 프레임에 0.1초 넘게 세지 않으므로, 프레임마다 살피면 "준비!"가 끝나기 전에 멈출 수 있다.
    const grace = await page.evaluate(
      (k) =>
        new Promise<number>((resolve) => {
          const scenes = window.__pocketArcade?.scene;
          if (!scenes) throw new Error('앱이 아직 뜨지 않았다');
          const scene = scenes.getScene(k) as unknown as { grace: number };
          scenes.resume(k);
          const watch = (): void => {
            if (scene.grace > 0.3) {
              requestAnimationFrame(watch);
              return;
            }
            const left = scene.grace;
            scenes.pause(k);
            resolve(left);
          };
          requestAnimationFrame(watch);
        }),
      game.key,
    );
    expect(grace, '다시 멈춘 것은 "준비!"가 끝나기 전이어야 한다').toBeGreaterThan(0);
    shown += (game.graceSeconds ?? RESUME_GRACE_SECONDS) - grace;
  }
  const spent = start - (await timeLeft(page, game.key));
  // 고치기 전에는 시계가 조금도 줄지 않았다.
  expect(spent, `판이 ${shown.toFixed(2)}초 보였으면 그만큼 시계가 줄어야 한다`).toBeCloseTo(shown, 3);

  // 다시 돌아오면 "준비!" 뒤에 시계가 이어서 흐른다.
  await page.evaluate((k) => window.__pocketArcade?.scene.resume(k), game.key);
  await waitForClock(page, game.key, 0.3, '돌아온 뒤에도 시계가 흘러야 한다');
}
