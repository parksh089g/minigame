import Phaser from 'phaser';
import { registerTextures } from '../art/textures';
import { SCENE } from '../config';
import { GAMES } from '../games/registry';
import { sharedGame, withoutShareParam } from '../share/link';
import { settleLastWeek } from './weekly-settle';

/** 텍스처를 만든 뒤 허브로 넘어간다. 글꼴과 세이브는 main.ts에서 이미 불러온 상태다. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super(SCENE.boot);
  }

  create(): void {
    registerTextures(this);

    // 친구가 보낸 공유 주소로 들어왔으면 허브를 거치지 않고 그 게임을 바로 연다.
    const shared = sharedGame(window.location.search, GAMES);
    if (shared) {
      // 주소창에서 표시를 지워 둔다. 새로고침하거나 홈 화면에 추가하면 그 게임이 아니라 허브에서 시작한다.
      const { pathname, search, hash } = window.location;
      window.history.replaceState(window.history.state, '', withoutShareParam(pathname, search, hash));
      // 허브를 거치지 않으므로, 지난주에 받지 않은 주간 미션 보상은 여기서 넣어 준다.
      settleLastWeek();
      this.scene.start(shared.sceneKey);
      return;
    }
    this.scene.start(SCENE.hub);
  }
}
