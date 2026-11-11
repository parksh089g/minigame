import { GAME_WIDTH, SCENE, THEME_CSS } from '../../config';
import { addBackdrop, addText } from '../../core/ui';
import { MiniGameScene } from '../../scenes/MiniGameScene';

/** 꼬리 잡기: 아직 만드는 중이라 자리만 잡아 둔 화면. */
export class TailChaseScene extends MiniGameScene {
  protected readonly gameId = 'tail-chase';

  constructor() {
    super(SCENE.tailChase);
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
