import { CSS, GAME_WIDTH, SCENE } from '../../config';
import { addBackdrop, addText } from '../../core/ui';
import { MiniGameScene } from '../../scenes/MiniGameScene';

/** 나사 풀기: 아직 만드는 중이라 자리만 잡아 둔 화면. */
export class ScrewSortScene extends MiniGameScene {
  protected readonly gameId = 'screw-sort';

  constructor() {
    super(SCENE.screwSort);
  }

  create(): void {
    this.beginMiniGame();
    addBackdrop(this);
    this.addPauseButton();
    addText(this, GAME_WIDTH / 2, this.scale.height / 2, '준비 중', {
      color: CSS.silver,
      originX: 0.5,
      originY: 0.5,
    });
  }
}
