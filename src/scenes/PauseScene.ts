import Phaser from 'phaser';
import { FONT_SIZE, GAME_WIDTH, SCENE, THEME, THEME_CSS } from '../config';
import type { BackAware } from '../core/app-events';
import { homeScene } from '../core/home';
import { addPanel, addScrim, addText, fadeToScene, PixelButton, type ButtonStyle } from '../core/ui';
import { howToFor } from '../games/how-to';
import type { PauseData, StageStart } from './MiniGameScene';
import type { StagesData } from './StagesScene';

const PANEL_WIDTH = 176;
/** 버튼이 셋일 때 카드의 높이. 버튼이 하나 늘 때마다 BUTTON.step만큼 커진다. */
const PANEL_HEIGHT = 168;
/** 그만둘지 묻는 카드: 제목 아래에 잃는 것을 알리는 한 줄(top)을 두고, 그 아래 first부터 버튼을 놓는다. */
const QUIT = { top: 46, first: 68 } as const;
const BUTTON = { width: PANEL_WIDTH - 32, height: 30, step: 37, first: 54 } as const;
/** 게임이 덧붙이는 내용의 좌우 여백과, 그 아래 버튼까지의 간격 */
const EXTRA = { pad: 12, gap: 8 } as const;
/**
 * "방법 보기"를 눌렀을 때의 카드. 글이 두 줄로 넘어가도 읽기 편하게 기본 카드보다 넓다.
 * top은 카드 위에서 첫 줄까지, dot은 줄 머리의 점이 차지하는 폭, gap은 줄 사이, foot은 글과 버튼 사이와 버튼 아래의 여백이다.
 */
const HOW_TO = { width: GAME_WIDTH - 16, pad: 14, top: 52, dot: 10, gap: 6, foot: 10 } as const;

/** 게임 위에 겹쳐 뜨는 일시정지 화면. 뒤의 게임 씬은 멈춘 채로 보인다. */
export class PauseScene extends Phaser.Scene implements BackAware {
  /** 이 화면을 띄울 때 받은 것. 멈춰 둔 게임 씬의 이름이 들어 있다. */
  private opened: PauseData = { sceneKey: '' };
  /** 버튼 대신 게임 방법을 보여 주고 있는지 */
  private showingHowTo = false;
  /** 그만둘지 한 번 더 묻고 있는지 */
  private asking = false;

  constructor() {
    super(SCENE.pause);
  }

  /** 방법을 보고 있었으면 버튼이 있는 쪽으로 돌아가고, 거기서 한 번 더 누르면 "그만하기"와 같다. */
  onBackRequest(): void {
    if (this.showingHowTo) this.turnTo('menu');
    else if (this.asking) this.quit();
    else this.askQuit();
  }

  /** "그만하기": 잃는 것이 있는 판이면 한 번 더 묻고, 아니면 바로 나간다. */
  private askQuit(): void {
    if (this.opened.quitWarning) this.turnTo('quit');
    else this.quit();
  }

  /** 게임으로 돌아간다. */
  private resume(): void {
    this.scene.stop();
    this.scene.resume(this.opened.sceneKey);
  }

  /** 게임을 다시 움직이고, 지금까지의 점수를 기록하며 판을 끝내게 한다. 결과 화면은 게임이 띄운다. */
  private finish(): void {
    const game = this.scene.get(this.opened.sceneKey) as Phaser.Scene & { finishFromPause?: () => void };
    // 멈춰 있는 동안에는 게임의 시계가 가지 않으므로, 다시 움직이기 시작한 뒤에 끝내게 한다.
    game.events.once(Phaser.Scenes.Events.RESUME, () => game.finishFromPause?.());
    this.resume();
  }

  /** 그만두고 나간다. 단계 모드였으면 허브가 아니라 단계를 고르던 화면으로 돌아간다. */
  private quit(): void {
    const { sceneKey, gameId, stageLevel } = this.opened;
    this.scene.stop(sceneKey);
    if (stageLevel === undefined) fadeToScene(this, homeScene());
    else fadeToScene(this, SCENE.stages, { gameId } satisfies StagesData);
  }

  /** 같은 일시정지 화면의 다른 쪽을 보여 준다. 뒤의 게임은 멈춘 그대로다. */
  private turnTo(page: NonNullable<PauseData['page']>): void {
    this.scene.restart({ ...this.opened, page } satisfies PauseData);
  }

  create(data: PauseData): void {
    this.input.enabled = true;
    this.opened = data;
    const howTo = data.gameId ? howToFor(data.gameId, data.stageLevel !== undefined) : null;
    this.showingHowTo = data.page === 'howTo' && howTo !== null;
    this.asking = data.page === 'quit' && data.quitWarning !== undefined;

    addScrim(this);
    if (this.showingHowTo && howTo) this.drawHowTo(howTo);
    else if (this.asking && data.quitWarning) this.drawQuit(data.quitWarning);
    else this.drawMenu(howTo !== null);
  }

  private drawMenu(hasHowTo: boolean): void {
    const data = this.opened;
    const { height } = this.scale;
    const buttons: Array<{ label: string; style?: ButtonStyle; onTap: () => void }> = [
      { label: '계속하기', style: 'pink', onTap: () => this.resume() },
      {
        label: data.restartLabel ?? '처음부터 다시',
        style: 'green',
        // 단계 모드였으면 같은 단계를 다시 연다.
        onTap: () =>
          this.scene.start(
            data.sceneKey,
            data.stageLevel === undefined ? undefined : ({ stageLevel: data.stageLevel } satisfies StageStart),
          ),
      },
      { label: '그만하기', onTap: () => this.askQuit() },
    ];
    // 점수를 남기고 끝낼 수 있는 게임이면 "그만하기" 바로 위에 둔다.
    if (data.canFinish) {
      buttons.splice(2, 0, { label: '기록하고 끝내기', style: 'green', onTap: () => this.finish() });
      buttons[1].style = undefined;
    }
    // 방법을 적어 둔 게임이면 "계속하기" 바로 아래에 둔다. 판을 버리는 버튼 둘은 아래쪽에 모여 있다.
    if (hasHowTo) buttons.splice(1, 0, { label: '방법 보기', style: 'yellow', onTap: () => this.turnTo('howTo') });

    // 게임이 덧붙이는 내용(예: 지금 빌드)이 있으면 제목과 버튼 사이에 자리를 내주고, 카드를 그만큼 키운다.
    const extra = data.extra;
    const lift = extra ? extra.height + EXTRA.gap : 0;
    const panelWidth = Math.min(GAME_WIDTH - 8, Math.max(PANEL_WIDTH, extra?.width ?? 0));
    const panelHeight = PANEL_HEIGHT + lift + (buttons.length - 3) * BUTTON.step;
    const left = Math.round((GAME_WIDTH - panelWidth) / 2);
    const top = Math.max(2, Math.round((height - panelHeight) / 2));
    const buttonX = Math.round((GAME_WIDTH - BUTTON.width) / 2);

    addPanel(this, left, top, panelWidth, panelHeight, { radius: 18, depth: 4 });
    addText(this, GAME_WIDTH / 2, top + 14, '일시정지', {
      size: FONT_SIZE.large,
      originX: 0.5,
    });
    if (data.stageLevel !== undefined) {
      addText(this, GAME_WIDTH / 2, top + 41, `${data.stageLevel}단계`, {
        size: FONT_SIZE.small,
        color: THEME_CSS.sub,
        originX: 0.5,
      });
    }
    if (extra) extra.draw(this, left + EXTRA.pad, top + 50, panelWidth - EXTRA.pad * 2);

    buttons.forEach((button, index) => {
      new PixelButton(this, {
        x: buttonX,
        y: top + BUTTON.first + lift + index * BUTTON.step,
        width: BUTTON.width,
        height: BUTTON.height,
        label: button.label,
        style: button.style,
        onTap: button.onTap,
      });
    });
  }

  /** 그만둘지 한 번 더 묻는다. 잃는 것을 한 줄로 알리고, 계속할지 그만둘지 고르게 한다. */
  private drawQuit(warning: string): void {
    const data = this.opened;
    const { height } = this.scale;
    const buttons: Array<{ label: string; style?: ButtonStyle; onTap: () => void }> = [
      { label: '계속하기', style: 'pink', onTap: () => this.resume() },
      { label: '그만하기', onTap: () => this.quit() },
    ];
    if (data.canFinish) {
      buttons.splice(1, 0, { label: '기록하고 끝내기', style: 'green', onTap: () => this.finish() });
    }

    const panelHeight = QUIT.first + buttons.length * BUTTON.step + 3;
    const left = Math.round((GAME_WIDTH - PANEL_WIDTH) / 2);
    const top = Math.max(2, Math.round((height - panelHeight) / 2));
    addPanel(this, left, top, PANEL_WIDTH, panelHeight, { radius: 18, depth: 4 });
    addText(this, GAME_WIDTH / 2, top + 14, '그만할까요?', { size: FONT_SIZE.large, originX: 0.5 });
    addText(this, GAME_WIDTH / 2, top + QUIT.top, warning, {
      color: THEME_CSS.sub,
      originX: 0.5,
      align: 'center',
      wrapWidth: PANEL_WIDTH - 24,
    });
    buttons.forEach((button, index) => {
      new PixelButton(this, {
        x: Math.round((GAME_WIDTH - BUTTON.width) / 2),
        y: top + QUIT.first + index * BUTTON.step,
        width: BUTTON.width,
        height: BUTTON.height,
        label: button.label,
        style: button.style,
        onTap: button.onTap,
      });
    });
  }

  /** 게임 방법을 한 줄씩 늘어놓고, 아래에 돌아가는 버튼을 둔다. */
  private drawHowTo(lines: readonly string[]): void {
    const { height } = this.scale;
    const left = Math.round((GAME_WIDTH - HOW_TO.width) / 2);
    const textLeft = left + HOW_TO.pad + HOW_TO.dot;
    const wrapWidth = HOW_TO.width - HOW_TO.pad * 2 - HOW_TO.dot;
    const below = HOW_TO.foot + BUTTON.height + HOW_TO.foot;
    // 카드가 화면 위아래로 조금씩 남기고 들어갈 때 글이 쓸 수 있는 높이
    const room = height - 8 - HOW_TO.top - below;

    // 보통 글씨로 놓아 보고, 화면이 짧아 넘치면 작은 글씨로 다시 놓는다.
    let size: number = FONT_SIZE.normal;
    let texts: Phaser.GameObjects.Text[] = [];
    let bodyHeight = 0;
    for (const candidate of [FONT_SIZE.normal, FONT_SIZE.small]) {
      for (const text of texts) text.destroy();
      size = candidate;
      texts = lines.map((line) => addText(this, textLeft, 0, line, { size, wrapWidth }).setDepth(1));
      bodyHeight =
        texts.reduce((sum, text) => sum + Math.ceil(text.height), 0) + HOW_TO.gap * (texts.length - 1);
      if (bodyHeight <= room) break;
    }

    const panelHeight = HOW_TO.top + bodyHeight + below;
    const top = Math.max(2, Math.round((height - panelHeight) / 2));
    addPanel(this, left, top, HOW_TO.width, panelHeight, { radius: 18, depth: 4 });
    addText(this, GAME_WIDTH / 2, top + 14, '게임 방법', { size: FONT_SIZE.large, originX: 0.5 });

    const dots = this.add.graphics().setDepth(1).fillStyle(THEME.pinkDeep, 1);
    let y = top + HOW_TO.top;
    for (const text of texts) {
      text.setY(y);
      // 점은 첫 줄의 가운데 높이에 찍는다.
      dots.fillCircle(left + HOW_TO.pad + 3, y + 1 + size * 0.55, 2);
      y += Math.ceil(text.height) + HOW_TO.gap;
    }

    new PixelButton(this, {
      x: Math.round((GAME_WIDTH - BUTTON.width) / 2),
      y: top + HOW_TO.top + bodyHeight + HOW_TO.foot,
      width: BUTTON.width,
      height: BUTTON.height,
      label: '돌아가기',
      style: 'pink',
      onTap: () => this.turnTo('menu'),
    });
  }
}
