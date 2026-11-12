import Phaser from 'phaser';
import { FONT_SIZE, GAME_WIDTH, SCENE } from '../config';
import type { BackAware } from '../core/app-events';
import { addPanel, addScrim, addText, fadeToScene, PixelButton } from '../core/ui';
import type { PauseData } from './MiniGameScene';

const PANEL_WIDTH = 176;
const PANEL_HEIGHT = 168;
/** 게임이 덧붙이는 내용의 좌우 여백과, 그 아래 버튼까지의 간격 */
const EXTRA = { pad: 12, gap: 8 } as const;

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
    // 게임이 덧붙이는 내용(예: 지금 빌드)이 있으면 제목과 버튼 사이에 자리를 내주고, 카드를 그만큼 키운다.
    const extra = data.extra;
    const lift = extra ? extra.height + EXTRA.gap : 0;
    const panelWidth = Math.min(GAME_WIDTH - 8, Math.max(PANEL_WIDTH, extra?.width ?? 0));
    const panelHeight = PANEL_HEIGHT + lift;
    const left = Math.round((GAME_WIDTH - panelWidth) / 2);
    const top = Math.max(2, Math.round((height - panelHeight) / 2));
    const buttonWidth = PANEL_WIDTH - 32;
    const buttonX = Math.round((GAME_WIDTH - buttonWidth) / 2);

    addScrim(this);
    addPanel(this, left, top, panelWidth, panelHeight, { radius: 18, depth: 4 });
    addText(this, GAME_WIDTH / 2, top + 14, '일시정지', {
      size: FONT_SIZE.large,
      originX: 0.5,
    });
    if (extra) extra.draw(this, left + EXTRA.pad, top + 50, panelWidth - EXTRA.pad * 2);

    new PixelButton(this, {
      x: buttonX,
      y: top + 54 + lift,
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
      y: top + 91 + lift,
      width: buttonWidth,
      height: 30,
      label: '처음부터 다시',
      style: 'green',
      onTap: () => this.scene.start(data.sceneKey),
    });
    new PixelButton(this, {
      x: buttonX,
      y: top + 128 + lift,
      width: buttonWidth,
      height: 30,
      label: '그만하기',
      onTap: () => this.quit(),
    });
  }
}
