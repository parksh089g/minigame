import Phaser from 'phaser';
import { COLOR, CSS, FONT_SIZE, GAME_WIDTH, SCENE } from '../config';
import { addPanel, addText, fadeToScene, PixelButton } from '../core/ui';
import type { PauseData } from './MiniGameScene';

const PANEL_WIDTH = 176;
const PANEL_HEIGHT = 156;

/** 게임 위에 겹쳐 뜨는 일시정지 화면. 뒤의 게임 씬은 멈춘 채로 보인다. */
export class PauseScene extends Phaser.Scene {
  constructor() {
    super(SCENE.pause);
  }

  create(data: PauseData): void {
    this.input.enabled = true;
    const { width, height } = this.scale;
    const left = Math.round((GAME_WIDTH - PANEL_WIDTH) / 2);
    const top = Math.round((height - PANEL_HEIGHT) / 2);
    const buttonX = left + 16;
    const buttonWidth = PANEL_WIDTH - 32;

    this.add.rectangle(0, 0, width, height, COLOR.ink, 0.72).setOrigin(0, 0).setInteractive();
    addPanel(this, left, top, PANEL_WIDTH, PANEL_HEIGHT);
    addText(this, GAME_WIDTH / 2, top + 14, '일시정지', {
      size: FONT_SIZE.large,
      bold: true,
      originX: 0.5,
      shadow: CSS.ink,
    });

    new PixelButton(this, {
      x: buttonX,
      y: top + 52,
      width: buttonWidth,
      height: 28,
      label: '계속하기',
      style: 'green',
      onTap: () => {
        this.scene.stop();
        this.scene.resume(data.sceneKey);
      },
    });
    new PixelButton(this, {
      x: buttonX,
      y: top + 84,
      width: buttonWidth,
      height: 28,
      label: '처음부터 다시',
      style: 'blue',
      onTap: () => this.scene.start(data.sceneKey),
    });
    new PixelButton(this, {
      x: buttonX,
      y: top + 116,
      width: buttonWidth,
      height: 28,
      label: '그만하기',
      onTap: () => {
        this.scene.stop(data.sceneKey);
        fadeToScene(this, SCENE.hub);
      },
    });
  }
}
