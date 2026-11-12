import { SCENE } from '../../config';
import { MiniGameScene } from '../../scenes/MiniGameScene';

/** 초성 퀴즈: 초성과 분류를 보고 글자 조각으로 낱말을 완성하는 게임. (자리만 잡아 둔 화면. 이 게임을 만들 때 채운다.) */
export class ChosungQuizScene extends MiniGameScene {
  protected readonly gameId = 'chosung-quiz';

  constructor() {
    super(SCENE.chosungQuiz);
  }

  create(): void {
    this.beginMiniGame();
  }
}
