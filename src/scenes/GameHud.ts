import Phaser from 'phaser';
import { COLOR, CSS, FONT_SIZE, GAME_WIDTH } from '../config';
import { addText, drawPanel } from '../core/ui';

/** 미니게임 화면 위쪽에 놓이는 HUD의 높이. 이 아래부터 게임 영역이다. */
export const HUD_HEIGHT = 56;

const TIME_BAR = { x: 8, y: 40, width: GAME_WIDTH - 16, height: 8 } as const;
const SIDE_Y = 14;

/**
 * 미니게임 공통 HUD: 가운데의 점수, 오른쪽의 한 줄 표시(콤보 등), 남은 시간 막대.
 * 왼쪽의 일시정지 버튼은 MiniGameScene.addPauseButton()이 따로 둔다.
 */
export class GameHud {
  private readonly scoreText: Phaser.GameObjects.Text;
  private readonly sideText: Phaser.GameObjects.Text;
  private readonly timeBar: Phaser.GameObjects.Graphics;

  constructor(
    private readonly scene: Phaser.Scene,
    depth: number,
  ) {
    this.scoreText = addText(scene, GAME_WIDTH / 2, 6, '0', {
      size: FONT_SIZE.large,
      bold: true,
      originX: 0.5,
      shadow: CSS.navy,
    }).setDepth(depth);
    this.sideText = addText(scene, GAME_WIDTH - 8, SIDE_Y, '', {
      color: CSS.yellow,
      originX: 1,
    }).setDepth(depth);
    this.timeBar = scene.add.graphics().setDepth(depth);
  }

  setScore(score: number): void {
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
    const { x, y, width, height } = TIME_BAR;
    const ratio = Phaser.Math.Clamp(remaining / total, 0, 1);
    const color = remaining <= 5 ? COLOR.red : remaining <= 10 ? COLOR.yellow : COLOR.lime;

    this.timeBar.clear();
    drawPanel(this.timeBar, x, y, width, height, {
      fill: COLOR.ink,
      border: COLOR.slate,
      highlight: COLOR.ink,
    });
    this.timeBar.fillStyle(color, 1);
    this.timeBar.fillRect(x + 2, y + 2, Math.round((width - 4) * ratio), height - 4);
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
    bold: true,
    color,
    originX: 0.5,
    originY: 0.5,
    shadow: CSS.navy,
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
    shadow: CSS.ink,
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
