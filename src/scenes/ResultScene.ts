import Phaser from 'phaser';
import { mascotTexture } from '../art/cosmetics';
import { TEXTURE } from '../art/sprites';
import { FONT_SIZE, GAME_WIDTH, SCENE, THEME, THEME_CSS } from '../config';
import { vibrate } from '../core/haptics';
import { sfx } from '../core/sfx';
import { store } from '../core/store';
import { addPanel, addScrim, addText, fadeToScene, PixelButton } from '../core/ui';
import type { Achievement } from '../core/achievements';
import type { DailyOutcome } from '../core/save';
import type { ResultData } from './MiniGameScene';

const PANEL_WIDTH = 204;
const STAT_ROW = 16;
/** 오늘의 도전 결과나 새로 달성한 업적을 알리는 줄의 높이 */
const EXTRA_ROW = 24;
/** 캐릭터가 카드 위로 올라와 보이는 높이와 카드에 걸치는 높이 */
const MASCOT = { above: 46, overlap: 20 } as const;
const BUTTON_HEIGHT = 30;
const BUTTON_GAP = 7;

/** 한 판이 끝난 뒤 게임 위에 겹쳐 뜨는 결과 화면. 기록은 게임 씬이 이미 저장해 두었다. */
export class ResultScene extends Phaser.Scene {
  constructor() {
    super(SCENE.result);
  }

  create(data: ResultData): void {
    this.input.enabled = true;
    const { result, stats } = data;

    const { height } = this.scale;
    const daily = result.daily;
    const achieved = result.newAchievements;
    const extraRows = (daily ? 1 : 0) + (achieved.length > 0 ? 1 : 0);
    const statsHeight = stats.length > 0 ? stats.length * STAT_ROW + 12 : 0;
    const cardHeight = 106 + statsHeight + 28 + extraRows * EXTRA_ROW + 6;
    const buttonsHeight = 12 + BUTTON_HEIGHT * 2 + BUTTON_GAP + 3;
    const total = MASCOT.above + cardHeight + buttonsHeight;
    const top = Math.max(2, Math.round((height - total) / 2)) + MASCOT.above;
    const left = Math.round((GAME_WIDTH - PANEL_WIDTH) / 2);
    const centerX = GAME_WIDTH / 2;
    const innerLeft = left + 16;
    const innerRight = left + PANEL_WIDTH - 16;

    addScrim(this);
    addPanel(this, left, top, PANEL_WIDTH, cardHeight, { radius: 20, depth: 4 });

    // 고른 캐릭터가 카드 위에 올라앉아 결과를 같이 본다. 신기록이면 팔을 들고 기뻐한다.
    const mascot = this.add
      .image(
        centerX,
        top + MASCOT.overlap,
        mascotTexture(store.data.cosmetics.equipped.runner, result.isNewBest ? 'cheer' : 'idle'),
      )
      .setOrigin(0.5, 1);

    addText(this, centerX, top + 23, data.title, { color: THEME_CSS.sub, originX: 0.5 });

    const scoreText = addText(this, centerX, top + 36, '0', {
      size: FONT_SIZE.huge,
      color: THEME_CSS.inkDeep,
      originX: 0.5,
    });
    this.tweens.addCounter({
      from: 0,
      to: result.score,
      duration: Math.min(700, 150 + result.score * 8),
      onUpdate: (tween) => scoreText.setText(String(Math.round(tween.getValue() ?? 0))),
      onComplete: () => scoreText.setText(String(result.score)),
    });

    const badgeY = top + 81;
    if (result.isNewBest) {
      const badge = addText(this, centerX, badgeY + 9, '신기록!', {
        color: THEME_CSS.inkDeep,
        originX: 0.5,
        originY: 0.5,
      });
      const pillWidth = Math.ceil(badge.width) + 24;
      const pill = this.add.graphics();
      pill.fillStyle(THEME.butter, 1);
      pill.fillRoundedRect(Math.round(centerX - pillWidth / 2), badgeY, pillWidth, 18, 9);
      badge.setDepth(1);
      const offset = Math.round(pillWidth / 2) + 10;
      const stars = [
        this.add.image(centerX - offset, badgeY + 9, 'icon-star').setDisplaySize(12, 12),
        this.add.image(centerX + offset, badgeY + 9, 'icon-star').setDisplaySize(12, 12),
      ];
      this.tweens.add({ targets: stars, alpha: 0.3, duration: 320, yoyo: true, repeat: -1 });
      this.tweens.add({
        targets: mascot,
        y: mascot.y - 6,
        duration: 260,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
      });
      this.time.delayedCall(350, () => {
        sfx.fanfare();
        vibrate([20, 40, 20]);
        this.celebrate(centerX, top);
      });
    } else {
      addText(this, centerX, badgeY + 9, `최고 기록 ${result.best}`, {
        color: THEME_CSS.sub,
        originX: 0.5,
        originY: 0.5,
      });
    }

    let y = top + 106;
    if (stats.length > 0) {
      addPanel(this, innerLeft - 6, y, innerRight - innerLeft + 12, statsHeight - 4, {
        fill: THEME.bg,
        shadow: null,
        radius: 10,
      });
      y += 5;
      for (const [label, value] of stats) {
        addText(this, innerLeft + 2, y, label, { color: THEME_CSS.sub });
        addText(this, innerRight - 2, y, value, { originX: 1 });
        y += STAT_ROW;
      }
      y += 7;
    }

    y += 4;
    const coinLabel = addText(this, 0, y, `+${result.coinsEarned}`, { size: 14 });
    const coinRowWidth = 16 + Math.ceil(coinLabel.width);
    const coinLeft = Math.round(centerX - coinRowWidth / 2);
    this.add.image(coinLeft, y + 9, 'coin').setOrigin(0, 0.5);
    coinLabel.setX(coinLeft + 16);
    const coinDelay = result.isNewBest ? 900 : 500;
    if (result.coinsEarned > 0) this.time.delayedCall(coinDelay, () => sfx.coin());

    y += 24;
    let extraDelay = coinDelay + 350;
    if (daily) {
      this.addDailyRow(daily, innerLeft, innerRight, y, extraDelay);
      if (daily.cleared) extraDelay += 450;
      y += EXTRA_ROW;
    }
    if (achieved.length > 0) {
      this.addAchievementRow(achieved, innerLeft, innerRight, y, extraDelay);
    }

    const buttonY = top + cardHeight + 12;
    new PixelButton(this, {
      x: left,
      y: buttonY,
      width: PANEL_WIDTH,
      height: BUTTON_HEIGHT,
      label: '다시 하기',
      style: 'pink',
      onTap: () => this.scene.start(data.sceneKey),
    });
    new PixelButton(this, {
      x: left,
      y: buttonY + BUTTON_HEIGHT + BUTTON_GAP,
      width: PANEL_WIDTH,
      height: BUTTON_HEIGHT,
      label: '다른 게임 고르기',
      onTap: () => {
        this.scene.stop(data.sceneKey);
        fadeToScene(this, SCENE.hub);
      },
    });
  }

  /** 신기록일 때 카드 위에서 색종이가 터진다. */
  private celebrate(x: number, y: number): void {
    const confetti = this.add.particles(0, 0, TEXTURE.spark, {
      speed: { min: 60, max: 150 },
      angle: { min: 200, max: 340 },
      gravityY: 260,
      lifespan: { min: 500, max: 900 },
      scale: { min: 0.8, max: 1.4 },
      alpha: { start: 1, end: 0 },
      tint: [THEME.pink, THEME.gold, THEME.mintDeep, THEME.lilac],
      emitting: false,
    });
    confetti.explode(26, x, y);
  }

  /** 알림 줄의 바탕이 되는 둥근 띠 */
  private addBand(left: number, right: number, y: number, color: number): Phaser.GameObjects.Graphics {
    const band = this.add.graphics();
    band.fillStyle(color, 1);
    band.fillRoundedRect(left - 6, y, right - left + 12, EXTRA_ROW - 4, 8);
    return band;
  }

  /** 이번 판으로 새로 달성한 업적을 알린다. 보상은 업적 화면에서 받는다. */
  private addAchievementRow(
    achieved: readonly Achievement[],
    left: number,
    right: number,
    y: number,
    delay: number,
  ): void {
    const band = this.addBand(left, right, y, THEME.lilacSoft);
    const label = addText(this, left + 2, y + 3, '업적 달성!');
    const detail = addText(
      this,
      right - 2,
      y + 3,
      achieved.length === 1 ? achieved[0].title : `${achieved.length}개`,
      { originX: 1 },
    );

    const parts = [band, label, detail];
    parts.forEach((part) => part.setAlpha(0));
    this.time.delayedCall(delay, () => {
      this.tweens.add({ targets: parts, alpha: 1, duration: 160 });
      sfx.fanfare();
      vibrate([15, 30, 15]);
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
    const band = this.addBand(left, right, y, daily.cleared ? THEME.butterSoft : THEME.dim);

    if (!daily.cleared) {
      addText(this, GAME_WIDTH / 2, y + 3, `오늘의 도전까지 ${daily.shortBy}점`, {
        color: THEME_CSS.sub,
        originX: 0.5,
      });
      return;
    }

    const label = addText(this, left + 2, y + 3, '오늘의 도전 달성!');
    const amount = addText(this, right - 2, y + 3, `+${daily.reward}`, { originX: 1 });
    const coin = this.add
      .image(Math.round(right - 2 - amount.width - 3), y + 10, 'coin')
      .setOrigin(1, 0.5);

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
