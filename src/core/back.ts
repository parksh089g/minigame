/**
 * 뒤로 가기(안드로이드의 뒤로 버튼과 뒤로 밀기, 컴퓨터의 Esc)를 앱 안의 동작으로 바꾼다.
 * 게임 중에는 일시정지, 일시정지와 결과 화면에서는 허브로, 설정·상점·업적에서도 허브로 간다.
 * 허브에서는 아무것도 가로채지 않아서 브라우저가 하던 대로 앱이 닫힌다.
 *
 * 브라우저의 CloseWatcher로 구현한다. 방문 기록에 가짜 항목을 쌓는 방식은 크롬이 사용자 동작 없이
 * 쌓인 항목을 건너뛰어서 두 번째 뒤로 가기부터 앱이 닫히고, 아이폰에서는 가장자리를 스칠 때마다
 * 게임이 멈추는 부작용이 있어 쓰지 않는다. CloseWatcher가 없는 브라우저에서는 예전처럼 동작한다.
 */
import Phaser from 'phaser';
import { SCENE } from '../config';
import type { BackAware } from './app-events';
import { fadeToScene } from './ui';

interface CloseWatcherLike {
  onclose: (() => void) | null;
  destroy(): void;
}

type CloseWatcherCtor = new () => CloseWatcherLike;

/** 뒤로 갈 곳이 없는 씬. 여기서는 뒤로 가기를 가로채지 않는다. */
const ROOT_SCENES: readonly string[] = [SCENE.boot, SCENE.hub];

/** 지금 맨 위에서 돌아가는 씬. 일시정지나 결과 화면이 떠 있으면 그 화면이다. */
function topScene(game: Phaser.Game): Phaser.Scene | null {
  const running = game.scene.getScenes(true);
  return running[running.length - 1] ?? null;
}

const hasWayBack = (scene: Phaser.Scene | null): scene is Phaser.Scene =>
  scene !== null && !ROOT_SCENES.includes(scene.scene.key);

/** 뒤로 가기를 한 번 처리한다. 앱 안에서 처리했으면 true. */
export function handleBack(game: Phaser.Game): boolean {
  const scene = topScene(game);
  if (!hasWayBack(scene)) return false;
  // 다른 화면으로 넘어가는 중에는 입력이 꺼져 있다. 그동안의 뒤로 가기는 삼킨다.
  if (!scene.input.enabled) return true;

  const aware = scene as Phaser.Scene & Partial<BackAware>;
  if (typeof aware.onBackRequest === 'function') aware.onBackRequest();
  else fadeToScene(scene, SCENE.hub);
  return true;
}

export function initBackButton(game: Phaser.Game): void {
  const Watcher = (window as unknown as { CloseWatcher?: CloseWatcherCtor }).CloseWatcher;
  if (!Watcher) return;

  // 뒤로 갈 곳이 있는 동안에만 감시자를 둔다. 감시자는 한 번 불리면 사라지므로 그때마다 새로 만든다.
  let watcher: CloseWatcherLike | null = null;
  const sync = (): void => {
    const needed = hasWayBack(topScene(game));
    if (needed && !watcher) {
      try {
        const created = new Watcher();
        created.onclose = () => {
          if (watcher === created) watcher = null;
          handleBack(game);
        };
        watcher = created;
      } catch {
        // 만들 수 없으면 뒤로 가기는 브라우저가 하던 대로 동작한다.
      }
    } else if (!needed && watcher) {
      watcher.onclose = null;
      watcher.destroy();
      watcher = null;
    }
  };
  game.events.on(Phaser.Core.Events.POST_STEP, sync);
}
