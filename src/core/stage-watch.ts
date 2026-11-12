/**
 * 캔버스가 창의 어디에 놓였는지 재고, 그것이 바뀔 때 알린다.
 * 안내 문구(toast.ts)와 입력 창(dialog.ts, style.css의 --ui-scale)이 이것을 보고 자리와 크기를 맞춘다.
 */
import type Phaser from 'phaser';
import { uiScale, type StageBox } from './stage';

const listeners = new Set<() => void>();

/** 지금 캔버스가 차지하는 자리. 아직 캔버스가 없으면 null. */
export function stageBox(): StageBox | null {
  const canvas = document.querySelector<HTMLCanvasElement>('#app canvas');
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

/** 캔버스의 자리가 바뀌었을 수 있을 때마다 부른다. 돌려주는 함수를 부르면 그만 듣는다. */
export function onStageChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function sync(): void {
  const box = stageBox();
  if (box) document.documentElement.style.setProperty('--ui-scale', String(uiScale(box.width)));
  for (const listener of listeners) listener();
}

/** 게임을 만든 뒤 한 번 부른다. */
export function initStage(game: Phaser.Game): void {
  // Phaser가 창 크기에 맞춰 캔버스를 다시 놓은 뒤에 잰다.
  game.scale.on('resize', sync);
  window.addEventListener('resize', () => window.requestAnimationFrame(sync));
  sync();
}
