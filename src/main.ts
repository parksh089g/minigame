import Phaser from 'phaser';
import './style.css';
import { COLOR, computeGameHeight, FONT_FAMILY, FONT_SIZE, GAME_WIDTH } from './config';
import { initPwa, isStandalone } from './core/pwa';
import { initAudioUnlock } from './core/sfx';
import { store } from './core/store';
import { LightningTapScene } from './games/lightning-tap/LightningTapScene';
import { MemoryCardsScene } from './games/memory-cards/MemoryCardsScene';
import { BootScene } from './scenes/BootScene';
import { HubScene } from './scenes/HubScene';
import { PauseScene } from './scenes/PauseScene';
import { ResultScene } from './scenes/ResultScene';
import { SettingsScene } from './scenes/SettingsScene';

declare global {
  interface Window {
    /** 디버깅과 자동 테스트에서 게임 상태를 들여다보는 용도 */
    __pocketArcade?: Phaser.Game;
  }
}

/** 캔버스에 글자를 그리기 전에 픽셀 글꼴을 받아 둔다. 실패해도 기본 글꼴로 계속 진행한다. */
async function loadFonts(): Promise<void> {
  const size = `${FONT_SIZE.normal}px`;
  try {
    await Promise.all([
      document.fonts.load(`${size} ${FONT_FAMILY}`, '가A1'),
      document.fonts.load(`bold ${size} ${FONT_FAMILY}`, '가A1'),
    ]);
  } catch {
    // 글꼴이 없어도 게임은 할 수 있다.
  }
}

async function boot(): Promise<void> {
  await Promise.all([loadFonts(), store.load()]);

  const parent = document.getElementById('app');
  if (!parent) throw new Error('#app 요소가 없습니다.');

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: GAME_WIDTH,
    height: computeGameHeight(parent.clientWidth, parent.clientHeight),
    backgroundColor: COLOR.ink,
    pixelArt: true,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    input: { activePointers: 3 },
    disableContextMenu: true,
    // 효과음은 core/sfx.ts가 Web Audio로 직접 만든다.
    audio: { noAudio: true },
    banner: false,
    scene: [
      BootScene,
      HubScene,
      SettingsScene,
      LightningTapScene,
      MemoryCardsScene,
      PauseScene,
      ResultScene,
    ],
  });
  window.__pocketArcade = game;

  document.getElementById('boot')?.remove();
  initAudioUnlock();
  initPwa();

  // 홈 화면에 설치해 쓰는 경우에는 브라우저가 세이브를 지우지 않도록 요청한다.
  if (isStandalone()) void store.requestPersistence();
}

boot().catch((error: unknown) => {
  console.error(error);
  const message =
    document.getElementById('boot') ?? document.body.appendChild(document.createElement('div'));
  message.id = 'boot';
  message.textContent = '게임을 시작하지 못했어요. 새로고침해 주세요.';
});
