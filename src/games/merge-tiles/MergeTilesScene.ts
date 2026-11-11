import { GAME_WIDTH, SCENE, THEME_CSS } from '../../config';
import { addBackdrop, addText } from '../../core/ui';
import { MiniGameScene } from '../../scenes/MiniGameScene';

/** 머지 타일: 아직 만드는 중이라 자리만 잡아 둔 화면. */
export class MergeTilesScene extends MiniGameScene {
  protected readonly gameId = 'merge-tiles';

  constructor() {
    super(SCENE.mergeTiles);
  }

  create(): void {
    this.beginMiniGame();
    addBackdrop(this);
    this.addPauseButton();
    addText(this, GAME_WIDTH / 2, this.scale.height / 2, '준비 중', {
      color: THEME_CSS.sub,
      originX: 0.5,
      originY: 0.5,
    });
  }
}
