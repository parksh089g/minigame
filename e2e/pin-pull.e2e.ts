/**
 * 핀 뽑기의 화면 점검: 일시정지에서 돌아온 뒤의 여유가 끝나기 전에 다시 멈추기를 되풀이해도
 * 판을 본 시간만큼 시계가 줄어드는지 본다.
 * 판이 3층으로 놓이는 것은 layout.e2e.ts에서 본다.
 */
import './app-globals';
import { SCENE } from '../src/config';
import { it, openApp } from './app';
import { expectRepausingCostsTime } from './pause-grace';

it('핀 뽑기: 돌아온 뒤의 여유 도중에 다시 멈추기를 되풀이해도 판을 본 시간만큼 시계가 줄어든다', async ({ page }) => {
  await openApp(page);
  await expectRepausingCostsTime(page, { key: SCENE.pinPull, clock: 'gate', phase: 'idle', graceSeconds: 0.8 });
});

