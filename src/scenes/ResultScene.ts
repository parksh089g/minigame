import Phaser from 'phaser';
import { COLOR, CSS, FONT_SIZE, GAME_WIDTH, SCENE } from '../config';
import { vibrate } from '../core/haptics';
import { sfx } from '../core/sfx';
import { addPanel, addText, fadeToScene, PixelButton } from '../core/ui';
import type { ResultData } from './MiniGameScene';

const PANEL_WIDTH = 200;
const STAT_ROW = 16;

/** 한 판이 끝난 뒤 게임 위에 겹쳐 뜨는 결과 화면. 기록은 게임 씬이 이미 저장해 두었다. */
export class ResultScene extends Phaser.Scene {
  constructor() {
    super(SCENE.result);
  }

  create(data: ResultData): void {
    this.input.enabled = true;
    const { result, stats } = data;

    const { width, height } = this.scale;
    const panelHeight = 210 + stats.length * STAT_ROW;
    const left = Math.round((GAME_WIDTH - PANEL_WIDTH) / 2);
    const top = Math.round((height - panelHeight) / 2);
    const centerX = GAME_WIDTH / 2;
    const innerLeft = left + 16;
    const innerRight = left + PANEL_WIDTH - 16;

    this.add.rectangle(0, 0, width, height, COLOR.ink, 0.72).setOrigin(0, 0).setInteractive();
    addPanel(this, left, top, PANEL_WIDTH, panelHeight);

    addText(this, centerX, top + 12, data.title, { color: CSS.silver, originX: 0.5 });

    const scoreText = addText(this, centerX, top + 28, '0', {
      size: FONT_SIZE.huge,
      bold: true,
      originX: 0.5,
      shadow: CSS.ink,
    });
    this.tweens.addCounter({
      from: 0,
      to: result.score,
      duration: Math.min(700, 150 + result.score * 8),
      onUpdate: (tween) => scoreText.setText(String(Math.round(tween.getValue() ?? 0))),
      onComplete: () => scoreText.setText(String(result.score)),
    });

    if (result.isNewBest) {
      const badge = addText(this, centerX, top + 76, '신기록!', {
        bold: true,
        color: CSS.yellow,
        originX: 0.5,
      });
      const offset = Math.round(badge.width / 2) + 10;
      const stars = [
        this.add.image(centerX - offset, top + 82, 'icon-star'),
        this.add.image(centerX + offset, top + 82, 'icon-star'),
      ];
      this.tweens.add({ targets: stars, alpha: 0.25, duration: 320, yoyo: true, repeat: -1 });
      this.time.delayedCall(350, () => {
        sfx.fanfare();
        vibrate([20, 40, 20]);
      });
    } else {
      addText(this, centerX, top + 76, `최고 기록 ${result.best}`, {
        color: CSS.silver,
        originX: 0.5,
      });
    }

    let y = top + 102;
    for (const [label, value] of stats) {
      addText(this, innerLeft, y, label, { color: CSS.silver });
      addText(this, innerRight, y, value, { originX: 1 });
      y += STAT_ROW;
    }

    y += 4;
    const coinLabel = addText(this, 0, y, `+${result.coinsEarned}`, { color: CSS.yellow });
    const coinRowWidth = 12 + Math.ceil(coinLabel.width);
    const coinLeft = Math.round(centerX - coinRowWidth / 2);
    this.add.image(coinLeft, y + 2, 'coin').setOrigin(0, 0);
    coinLabel.setX(coinLeft + 12);
    if (result.coinsEarned > 0) this.time.delayedCall(result.isNewBest ? 900 : 500, () => sfx.coin());

    y += 24;
    const buttonWidth = PANEL_WIDTH - 32;
    new PixelButton(this, {
      x: innerLeft,
      y,
      width: buttonWidth,
      height: 28,
      label: '다시 하기',
      style: 'green',
      onTap: () => this.scene.start(data.sceneKey),
    });
    new PixelButton(this, {
      x: innerLeft,
      y: y + 34,
      width: buttonWidth,
      height: 28,
      label: '다른 게임 고르기',
      onTap: () => {
        this.scene.stop(data.sceneKey);
        fadeToScene(this, SCENE.hub);
      },
    });
  }
}
