import { SCENE } from '../../config';
import { MiniGameScene } from '../../scenes/MiniGameScene';

/** 둘이서 대결: 휴대폰 하나를 사이에 두고 위아래로 나눠 겨루는 게임. (자리만 잡아 둔 화면. 이 게임을 만들 때 채운다.) */
export class DuelScene extends MiniGameScene {
  protected readonly gameId = 'duel';

  constructor() {
    super(SCENE.duel);
  }

  create(): void {
    this.beginMiniGame();
  }
}
