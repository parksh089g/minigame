import Phaser from 'phaser';
import { FONT_SIZE, GAME_WIDTH, THEME, THEME_CSS } from '../config';
import { addText } from '../core/ui';

/** 미니게임 화면 위쪽에 놓이는 HUD의 높이. 이 아래부터 게임 영역이다. */
export const HUD_HEIGHT = 56;

const TIME_BAR = { x: 10, y: 41, width: GAME_WIDTH - 20, height: 8 } as const;
const SIDE_Y = 14;

/**
 * 미니게임 공통 HUD: 가운데의 점수, 오른쪽의 한 줄 표시(콤보 등), 남은 시간 막대.
 * 왼쪽의 일시정지 버튼은 MiniGameScene.addPauseButton()이 따로 둔다.
 */
export class GameHud {
  private readonly scoreText: Phaser.GameObjects.Text;
  private readonly sideText: Phaser.GameObjects.Text;
  private readonly timeBar: Phaser.GameObjects.Graphics;
  /** 단계 모드인지. 점수와 시간 대신 단계 번호만 보여 준다. */
  private staged = false;

  constructor(
    private readonly scene: Phaser.Scene,
    depth: number,
  ) {
    this.scoreText = addText(scene, GAME_WIDTH / 2, 5, '0', {
      size: FONT_SIZE.large,
      color: THEME_CSS.inkDeep,
      originX: 0.5,
      stroke: THEME_CSS.white,
    }).setDepth(depth);
    this.sideText = addText(scene, GAME_WIDTH - 10, SIDE_Y, '', {
      color: THEME_CSS.accent,
      originX: 1,
      stroke: THEME_CSS.white,
    }).setDepth(depth);
    this.timeBar = scene.add.graphics().setDepth(depth);
  }

  /**
   * 단계 모드의 HUD로 바꾼다: 가운데에 점수 대신 단계 번호를 적고, 시간 막대는 그리지 않는다.
   * 그 뒤의 setScore와 setTime은 아무 일도 하지 않으므로, 게임은 여느 때처럼 불러도 된다.
   */
  showStage(level: number): void {
    this.staged = true;
    this.scoreText.setText(`${level}단계`);
    this.timeBar.clear();
  }

  setScore(score: number): void {
    if (this.staged) return;
    this.scoreText.setText(String(score));
  }

  /** 오른쪽 위의 한 줄 표시를 바꾼다. bounce를 주면 살짝 튀어 눈에 띈다. */
  setSide(label: string, bounce = false): void {
    this.sideText.setText(label);
    if (!bounce) return;
    this.scene.tweens.killTweensOf(this.sideText);
    this.scene.tweens.add({
      targets: this.sideText,
      y: { from: SIDE_Y - 4, to: SIDE_Y },
      duration: 160,
      ease: 'Bounce.Out',
    });
  }

  /** 남은 시간 막대를 그린다. 10초, 5초 아래에서 색이 바뀐다. */
  setTime(remaining: number, total: number): void {
    if (this.staged) return;
    const { x, y, width, height } = TIME_BAR;
    const ratio = Phaser.Math.Clamp(remaining / total, 0, 1);
    const color = remaining <= 5 ? THEME.coral : remaining <= 10 ? THEME.gold : THEME.mintDeep;
    const radius = height / 2;

    this.timeBar.clear();
    this.timeBar.fillStyle(THEME.shadow, 1);
    this.timeBar.fillRoundedRect(x, y + 2, width, height, radius);
    this.timeBar.fillStyle(THEME.card, 1);
    this.timeBar.fillRoundedRect(x, y, width, height, radius);
    // 거의 다 닳아도 둥근 끝이 찌그러지지 않게 막대의 가장 짧은 길이를 높이만큼 둔다.
    const filled = Math.max(height - 2, (width - 2) * ratio);
    if (ratio > 0) {
      this.timeBar.fillStyle(color, 1);
      this.timeBar.fillRoundedRect(x + 1, y + 1, filled, height - 2, radius - 1);
    }
  }
}

/** 화면 가운데(centerY 높이)에 큰 글자를 잠깐 띄운다. */
export function showBanner(
  scene: Phaser.Scene,
  centerY: number,
  label: string,
  color: string,
  durationMs: number,
  depth: number,
): void {
  const banner = addText(scene, GAME_WIDTH / 2, Math.round(centerY), label, {
    size: FONT_SIZE.huge,
    color,
    originX: 0.5,
    originY: 0.5,
    stroke: THEME_CSS.white,
    shadow: THEME_CSS.shadow,
  }).setDepth(depth);
  scene.tweens.add({
    targets: banner,
    alpha: 0,
    delay: durationMs * 0.6,
    duration: durationMs * 0.4,
    onComplete: () => banner.destroy(),
  });
}

/** 점수나 판정 글자가 위로 떠오르며 사라진다. bounds 밖으로 나가지 않게 자리를 맞춘다. */
export function floatText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  color: string,
  bounds: Phaser.Geom.Rectangle,
  depth: number,
): void {
  const clampedX = Phaser.Math.Clamp(x, bounds.left + 20, bounds.right - 20);
  const text = addText(scene, clampedX, Math.max(y, bounds.top + 8), label, {
    color,
    originX: 0.5,
    originY: 1,
    stroke: THEME_CSS.white,
  }).setDepth(depth);
  scene.tweens.add({
    targets: text,
    y: text.y - 14,
    alpha: 0,
    duration: 480,
    ease: 'Quad.Out',
    onComplete: () => text.destroy(),
  });
}
