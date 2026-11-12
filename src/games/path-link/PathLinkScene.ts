import { SCENE } from '../../config';
import { MiniGameScene } from '../../scenes/MiniGameScene';

/** 길 잇기: 같은 색 점끼리 선이 겹치지 않게 이어 판을 채우는 퍼즐. (자리만 잡아 둔 화면. 이 게임을 만들 때 채운다.) */
export class PathLinkScene extends MiniGameScene {
  protected readonly gameId = 'path-link';

  constructor() {
    super(SCENE.pathLink);
  }

  create(): void {
    this.beginMiniGame();
  }
}
