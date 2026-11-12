import { SCENE } from '../../config';
import { MiniGameScene } from '../../scenes/MiniGameScene';

/** 블록 채우기: 주어진 블록을 판에 놓아 줄을 완성해 지우는 퍼즐. (자리만 잡아 둔 화면. 이 게임을 만들 때 채운다.) */
export class BlockFillScene extends MiniGameScene {
  protected readonly gameId = 'block-fill';

  constructor() {
    super(SCENE.blockFill);
  }

  create(): void {
    this.beginMiniGame();
  }
}
