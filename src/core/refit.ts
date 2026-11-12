/**
 * 화면 크기가 바뀌었을 때 게임 화면의 세로 길이를 다시 맞춘다.
 * 논리 세로 길이는 시작할 때 한 번 재는데(main.ts), 창 크기를 바꾸거나 화면을 나눠 쓰거나
 * 접는 휴대폰을 펴면 그 뒤로는 위아래가 비거나 화면이 작아진다.
 *
 * 씬은 만들어질 때 화면 길이에 맞춰 자리를 잡으므로, 길이를 바꾸려면 씬을 다시 만들어야 한다.
 * 그래서 플레이 중에는 건드리지 않고, 허브·설정·상점·업적·랭킹 화면이 시작되는 순간에만 바꾼다.
 * 그 화면들에 머물러 있을 때 크기가 바뀌었으면 같은 화면을 한 번 다시 연다.
 */
import Phaser from 'phaser';
import { computeGameHeight, GAME_WIDTH, SCENE } from '../config';
import { COMPANY_SCENE } from '../games/sprout-company/data';
import { isSideways } from './orientation';
import { renderScale } from './render-scale';

/** 언제 다시 만들어도 잃을 것이 없는 화면 */
const MENU_SCENES: readonly string[] = [
  SCENE.hub,
  SCENE.settings,
  SCENE.shop,
  SCENE.achievements,
  SCENE.ranking,
  // 새싹 컴퍼니는 진행이 따로 저장되어 있어서 화면을 다시 만들어도 그대로 이어진다.
  COMPANY_SCENE,
];

let parent: HTMLElement | null = null;
/** 화면 크기가 바뀌어서 다음 기회에 세로 길이를 다시 맞춰야 하는지 */
let pending = false;

/**
 * 글자를 입력받는 창(core/dialog.ts)이 떠 있는지.
 * 자판이 올라오면 화면 높이가 줄어드는 브라우저가 있는데, 그것은 화면 크기가 바뀐 것으로 치지 않는다.
 * 창을 닫아 자판이 내려가면 크기가 되돌아오고, 그때 다시 판단한다.
 */
const dialogOpen = (): boolean => document.querySelector('dialog[open]') !== null;

const wantedHeight = (): number =>
  parent ? computeGameHeight(parent.clientWidth, parent.clientHeight) : 0;

/** 잠들었거나 멈춘 것까지, 지금 살아 있는 씬 */
function aliveScenes(game: Phaser.Game): Phaser.Scene[] {
  return game.scene
    .getScenes(false)
    .filter((scene) => scene.sys.isActive() || scene.sys.isPaused() || scene.sys.isSleeping());
}

/**
 * reopen은 씬을 같은 씬으로 다시 여는 함수다(화면 전환 효과를 쓰도록 밖에서 받는다).
 * 전환 중이면 아무 일도 하지 않아야 한다.
 */
export function initRefit(
  game: Phaser.Game,
  element: HTMLElement,
  reopen: (scene: Phaser.Scene) => void,
): void {
  parent = element;
  window.addEventListener('resize', () => {
    // 가로로 눕힌 동안에는 안내가 화면을 덮고 있다. 다시 세웠을 때의 크기로 판단한다.
    if (isSideways() || dialogOpen()) return;
    pending = wantedHeight() * renderScale() !== game.scale.height;
  });

  game.events.on(Phaser.Core.Events.POST_STEP, () => {
    if (!pending) return;
    const alive = aliveScenes(game);
    if (alive.length !== 1 || !MENU_SCENES.includes(alive[0].scene.key)) return;
    if (!alive[0].input.enabled) return;
    reopen(alive[0]);
  });
}

/**
 * 씬이 시작될 때(자리를 잡기 전에) 불린다(core/hidpi.ts).
 * 미뤄 둔 크기 변경이 있고 다시 만들어도 되는 화면이면 게임 화면의 세로 길이를 바꾼다.
 */
export function applyPendingRefit(scene: Phaser.Scene): void {
  if (!pending || !MENU_SCENES.includes(scene.scene.key)) return;
  const game = scene.game;
  const others = aliveScenes(game).filter((other) => other !== scene);
  if (others.length > 0) return;

  pending = false;
  const scale = renderScale();
  const height = wantedHeight() * scale;
  if (height > 0 && height !== game.scale.height) game.scale.setGameSize(GAME_WIDTH * scale, height);
}
