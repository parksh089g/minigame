/**
 * 친구가 자리를 비웠을 때(앱을 닫았거나 다른 앱으로 가서 서버에 소식이 오지 않을 때) 판 위에 띄우는 띠.
 * 친구가 판을 버린 것으로 치기까지 남은 초를 센다. 0초가 되면 서버에 바로 물어서 방을 정리하게 한다.
 * 친구가 돌아오면 띠는 사라진다. 원카드, 블랙잭, 하이로우(FriendsKit)와 훌라가 같이 쓴다.
 */
import Phaser from 'phaser';
import { GAME_WIDTH } from '../config';
import { addText, drawPanel } from '../core/ui';
import { PX, PX_CSS } from '../games/high-low/art';
import type { Match } from './match';
import { withSubject } from './text';

const WIDTH = GAME_WIDTH - 32;
const HEIGHT = 36;

/** 띠에 적을 두 줄. 판을 하는 중이면 내가 이기는 것, 판이 끝났으면 방이 닫히는 것을 센다. */
export function awayLines(foe: string, seconds: number, playing: boolean): [string, string] {
  if (seconds <= 0) return [`${withSubject(foe)} 돌아오지 않았어요`, '방을 정리하는 중…'];
  return [`${withSubject(foe)} 자리를 비웠어요`, playing ? `${seconds}초 안에 안 오면 내가 이긴 판이 돼요` : `${seconds}초 안에 안 오면 방이 닫혀요`];
}

export class AwayBanner {
  private readonly box: Phaser.GameObjects.Graphics;
  private readonly title: Phaser.GameObjects.Text;
  private readonly line: Phaser.GameObjects.Text;
  private readonly timer: Phaser.Time.TimerEvent;
  private asked = false;
  /** 띠를 보이는 중인지. 자동 점검이 들여다본다. */
  shown = false;

  constructor(
    scene: Phaser.Scene,
    private readonly source: () => { match: Match<unknown, unknown> | null; foe: string; poll?: () => void },
    y: number,
    depth = 70,
  ) {
    const x = Math.round(GAME_WIDTH / 2 - WIDTH / 2);
    this.box = scene.add.graphics().setDepth(depth);
    drawPanel(this.box, x, y, WIDTH, HEIGHT, { fill: PX.panel, border: PX.orange, shadow: PX.ink, radius: 4 });
    this.title = addText(scene, GAME_WIDTH / 2, y + 5, '', { size: 11, color: PX_CSS.accent, originX: 0.5 }).setDepth(depth + 1);
    this.line = addText(scene, GAME_WIDTH / 2, y + 20, '', { size: 9, color: PX_CSS.text, originX: 0.5 }).setDepth(depth + 1);
    this.setVisible(false);
    this.timer = scene.time.addEvent({ delay: 250, loop: true, callback: () => this.refresh() });
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
    this.refresh();
  }

  private setVisible(visible: boolean): void {
    this.shown = visible;
    this.box.setVisible(visible);
    this.title.setVisible(visible);
    this.line.setVisible(visible);
  }

  /** 남은 초를 다시 센다. 방이 바뀌었을 때도 부른다. */
  refresh(): void {
    const { match, foe, poll } = this.source();
    const until = match?.kind === 'online' ? match.awayUntil : null;
    const status = match?.room.status;
    if (until === null || (status !== 'playing' && status !== 'over')) {
      this.asked = false;
      this.setVisible(false);
      return;
    }
    const seconds = Math.max(0, Math.ceil((until - Date.now()) / 1000));
    const [title, line] = awayLines(foe, seconds, status === 'playing');
    this.title.setText(title);
    this.line.setText(line);
    this.setVisible(true);
    // 시간이 다 되면 바로 물어서, 서버가 친구를 내보내고 방을 닫은 것을 받아 온다.
    if (seconds <= 0 && !this.asked) {
      this.asked = true;
      poll?.();
    }
  }

  destroy(): void {
    this.timer.remove();
    this.box.destroy();
    this.title.destroy();
    this.line.destroy();
  }
}
