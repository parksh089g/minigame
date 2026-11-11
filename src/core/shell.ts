/**
 * 게임 화면을 둘러싼 바깥 틀을 한꺼번에 켠다: 뒤로 가기, 화면 방향, 화면 크기 변화, 오류 안내.
 * main.ts는 이 파일만 알면 된다.
 */
import type Phaser from 'phaser';
import { initBackButton } from './back';
import { initCrashNotice } from './crash';
import { initOrientation } from './orientation';
import { initRefit } from './refit';
import { fadeToScene } from './ui';

export { untilUpright } from './orientation';

export function initAppShell(game: Phaser.Game, parent: HTMLElement): void {
  initCrashNotice();
  initBackButton(game);
  initOrientation(game);
  initRefit(game, parent, (scene) => fadeToScene(scene, scene.scene.key));
}
