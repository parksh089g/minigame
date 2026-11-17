/**
 * 숫자 퍼즐의 화면 점검: 일시정지에서 돌아온 "준비!" 도중에 다시 멈추기를 되풀이해도 판을 본 시간만큼 시계가 줄어드는지 본다.
 */
import './app-globals';
import { SCENE } from '../src/config';
import { it, openApp } from './app';
import { expectRepausingCostsTime } from './pause-grace';

it('숫자 퍼즐: "준비!" 도중에 다시 멈추기를 되풀이해도 판을 본 시간만큼 시계가 줄어든다', async ({ page }) => {
  await openApp(page);
  await expectRepausingCostsTime(page, { key: SCENE.numberPuzzle, clock: 'gate', phase: 'idle' });
});
