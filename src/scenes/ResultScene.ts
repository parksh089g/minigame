import Phaser from 'phaser';
import { COLOR, CSS, FONT_SIZE, GAME_WIDTH, SCENE } from '../config';
import { vibrate } from '../core/haptics';
import { sfx } from '../core/sfx';
import { addPanel, addText, fadeToScene, PixelButton } from '../core/ui';
import type { DailyOutcome } from '../core/save';
import type { ResultData } from './MiniGameScene';

const PANEL_WIDTH = 200;
const STAT_ROW = 16;
/** 오늘의 도전 결과를 알리는 줄의 높이 */
const DAILY_ROW = 22;

/** 한 판이 끝난 뒤 게임 위에 겹쳐 뜨는 결과 화면. 기록은 게임 씬이 이미 저장해 두었다. */
export class ResultScene extends Phaser.Scene {
  constructor() {
    super(SCENE.result);
  }

  create(data: ResultData): void {
    this.input.enabled = true;
    const { result, stats } = data;

    const { width, height } = this.scale;
    const daily = result.daily;
    const panelHeight = 210 + stats.length * STAT_ROW + (daily ? DAILY_ROW : 0);
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
    const coinDelay = result.isNewBest ? 900 : 500;
    if (result.coinsEarned > 0) this.time.delayedCall(coinDelay, () => sfx.coin());

    if (daily) {
      y += DAILY_ROW;
      this.addDailyRow(daily, innerLeft, innerRight, y, coinDelay + 350);
    }

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

  /** 이번 판이 오늘의 도전이었을 때, 달성했는지 또는 몇 점이 모자랐는지 알린다. */
  private addDailyRow(
    daily: DailyOutcome,
    left: number,
    right: number,
    y: number,
    delay: number,
  ): void {
    const band = this.add.graphics();
    band.fillStyle(daily.cleared ? COLOR.navy : COLOR.ink, 1);
    band.fillRect(left - 6, y - 4, right - left + 12, 20);

    if (!daily.cleared) {
      addText(this, GAME_WIDTH / 2, y, `오늘의 도전까지 ${daily.shortBy}점`, {
        color: CSS.silver,
        originX: 0.5,
      });
      return;
    }

    const label = addText(this, left, y, '오늘의 도전 달성!', { bold: true, color: CSS.yellow });
    const amount = addText(this, right, y, `+${daily.reward}`, { color: CSS.yellow, originX: 1 });
    const coin = this.add
      .image(Math.round(right - amount.width - 11), y + 2, 'coin')
      .setOrigin(0, 0);

    // 점수와 코인 소리가 끝난 뒤에 따로 축하한다.
    const parts = [band, label, amount, coin];
    parts.forEach((part) => part.setAlpha(0));
    this.time.delayedCall(delay, () => {
      this.tweens.add({ targets: parts, alpha: 1, duration: 160 });
      sfx.gold();
      vibrate([15, 30, 15]);
    });
  }
}
