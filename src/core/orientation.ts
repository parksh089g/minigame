/**
 * 화면 방향. 이 앱은 세로로 쓰는 앱이라, 휴대폰을 가로로 눕히면 세로로 돌려 달라는 안내(#rotate)가 화면을 덮는다.
 * 안내를 보이고 숨기는 일은 style.css의 미디어 쿼리가 하고, 여기서는 그에 맞춰 게임을 멈추거나 기다린다.
 * 설치한 앱의 세로 고정(manifest의 orientation)은 안드로이드에서만 통해서, 아이폰과 브라우저에서는 이 안내가 필요하다.
 */
import type Phaser from 'phaser';
import { APP_EVENT } from './app-events';

/**
 * 가로로 눕힌 휴대폰. style.css의 #rotate 미디어 쿼리와 같아야 한다.
 * 태블릿과 컴퓨터는 가로여도 세로 길이가 넉넉해서 게임이 읽을 만한 크기로 들어가므로 빼 둔다.
 * 폭 조건은 세로로 든 휴대폰에서 자판이 올라와 높이만 줄어든 경우를 빼려는 것이다(style.css의 설명 참고).
 */
const SIDEWAYS_PHONE =
  '(orientation: landscape) and (min-width: 520px) and (max-height: 500px) and (pointer: coarse)';

const sidewaysQuery = (): MediaQueryList | null => window.matchMedia?.(SIDEWAYS_PHONE) ?? null;

export function isSideways(): boolean {
  return sidewaysQuery()?.matches === true;
}

/**
 * 세로가 될 때까지 기다린다. 이미 세로면 바로 끝난다.
 * 게임 화면의 크기는 시작할 때 재므로, 가로로 눕힌 채 앱을 켰으면 세로로 돌린 뒤에 재야 한다.
 */
export function untilUpright(): Promise<void> {
  const query = sidewaysQuery();
  if (!query?.matches) return Promise.resolve();
  return new Promise((resolve) => {
    const onChange = (): void => {
      if (query.matches) return;
      query.removeEventListener('change', onChange);
      // 돌린 직후에는 화면 크기가 아직 자리를 잡지 않았을 수 있어 한 프레임 기다린다.
      requestAnimationFrame(() => resolve());
    };
    query.addEventListener('change', onChange);
  });
}

/** 플레이 도중에 가로로 눕히면 안내에 가려 보이지 않는 동안 게임이 흘러가지 않게 일시정지를 부탁한다. */
export function initOrientation(game: Phaser.Game): void {
  const query = sidewaysQuery();
  if (!query) return;
  query.addEventListener('change', () => {
    if (query.matches) game.events.emit(APP_EVENT.pauseRequest);
  });
}
