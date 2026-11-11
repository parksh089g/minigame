import Phaser from 'phaser';
import { FONT_SIZE, GAME_WIDTH, SCENE } from '../config';
import type { BackAware } from '../core/app-events';
import { addPanel, addScrim, addText, fadeToScene, PixelButton } from '../core/ui';
import type { PauseData } from './MiniGameScene';

const PANEL_WIDTH = 176;
const PANEL_HEIGHT = 168;

/** 게임 위에 겹쳐 뜨는 일시정지 화면. 뒤의 게임 씬은 멈춘 채로 보인다. */
export class PauseScene extends Phaser.Scene implements BackAware {
  /** 멈춰 둔 게임 씬의 이름 */
  private gameKey = '';

  constructor() {
    super(SCENE.pause);
  }

  /** 일시정지 화면에서 뒤로 가기를 한 번 더 누르면 "그만하기"와 같다. */
  onBackRequest(): void {
    this.quit();
  }

  private quit(): void {
    this.scene.stop(this.gameKey);
    fadeToScene(this, SCENE.hub);
  }

  create(data: PauseData): void {
    this.input.enabled = true;
    this.gameKey = data.sceneKey;
    const { height } = this.scale;
    const left = Math.round((GAME_WIDTH - PANEL_WIDTH) / 2);
    const top = Math.round((height - PANEL_HEIGHT) / 2);
    const buttonX = left + 16;
    const buttonWidth = PANEL_WIDTH - 32;

    addScrim(this);
    addPanel(this, left, top, PANEL_WIDTH, PANEL_HEIGHT, { radius: 18, depth: 4 });
    addText(this, GAME_WIDTH / 2, top + 14, '일시정지', {
      size: FONT_SIZE.large,
      originX: 0.5,
    });

    new PixelButton(this, {
      x: buttonX,
      y: top + 54,
      width: buttonWidth,
      height: 30,
      label: '계속하기',
      style: 'pink',
      onTap: () => {
        this.scene.stop();
        this.scene.resume(data.sceneKey);
      },
    });
    new PixelButton(this, {
      x: buttonX,
      y: top + 91,
      width: buttonWidth,
      height: 30,
      label: '처음부터 다시',
      style: 'green',
      onTap: () => this.scene.start(data.sceneKey),
    });
    new PixelButton(this, {
      x: buttonX,
      y: top + 128,
      width: buttonWidth,
      height: 30,
      label: '그만하기',
      onTap: () => this.quit(),
    });
  }
}
