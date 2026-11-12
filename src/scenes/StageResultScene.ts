import Phaser from 'phaser';
import { FONT_SIZE, GAME_WIDTH, SCENE, THEME, THEME_CSS } from '../config';
import type { BackAware } from '../core/app-events';
import { sfx } from '../core/sfx';
import { STAGE_LEVELS } from '../core/stages';
import { addPanel, addScrim, addTapZone, addText, fadeToScene, PixelButton } from '../core/ui';
import type { AchievementsData } from './AchievementsScene';
import type { StageResultData, StageStart } from './MiniGameScene';
import type { StagesData } from './StagesScene';

const PANEL_WIDTH = 204;
const STAT_ROW = 16;
/** 처음 깨서 받은 코인, 새로 달성한 업적, 다 채운 주간 미션을 알리는 줄의 높이 */
const EXTRA_ROW = 24;
const BUTTON_HEIGHT = 30;
const BUTTON_GAP = 7;
/** 카드 위에서 게임 이름, 큰 글자, 그 아래 첫 줄까지의 자리 */
const HEAD = { title: 12, banner: 30, body: 72 } as const;

/**
 * 단계 모드에서 한 단계가 끝난 뒤 게임 위에 겹쳐 뜨는 화면.
 * 깼으면 다음 단계로, 깨지 못했으면 같은 단계를 다시 하도록 이끈다. 기록은 게임 씬이 이미 저장해 두었다.
 */
export class StageResultScene extends Phaser.Scene implements BackAware {
  private opened: StageResultData | null = null;

  constructor() {
    super(SCENE.stageResult);
  }

  /** 뒤로 가기는 "단계 고르기"와 같다. */
  onBackRequest(): void {
    this.toStages();
  }

  private toStages(): void {
    if (!this.opened) return;
    this.scene.stop(this.opened.sceneKey);
    fadeToScene(this, SCENE.stages, { gameId: this.opened.gameId } satisfies StagesData);
  }

  private play(level: number): void {
    if (!this.opened) return;
    this.scene.start(this.opened.sceneKey, { stageLevel: level } satisfies StageStart);
  }

  create(data: StageResultData): void {
    this.input.enabled = true;
    this.opened = data;
    const { height } = this.scale;
    const { cleared, stats } = data;

    const achieved = data.achievements;
    const extraRows = (data.coins > 0 ? 1 : 0) + (achieved.length > 0 ? 1 : 0) + (data.missions > 0 ? 1 : 0);
    const cardHeight = HEAD.body + stats.length * STAT_ROW + extraRows * EXTRA_ROW + 12;
    const buttonsHeight = 12 + BUTTON_HEIGHT * 2 + BUTTON_GAP + 3;
    const left = Math.round((GAME_WIDTH - PANEL_WIDTH) / 2);
    const top = Math.max(4, Math.round((height - cardHeight - buttonsHeight) / 2));

    addScrim(this);
    addPanel(this, left, top, PANEL_WIDTH, cardHeight, { radius: 18, depth: 4 });
    addText(this, GAME_WIDTH / 2, top + HEAD.title, `${data.title} ${data.level}단계`, {
      color: THEME_CSS.sub,
      originX: 0.5,
    });
    const banner = addText(this, GAME_WIDTH / 2, top + HEAD.banner, cleared ? '클리어!' : '아쉬워요', {
      size: FONT_SIZE.large,
      color: cleared ? THEME_CSS.good : THEME_CSS.inkDeep,
      originX: 0.5,
    });
    if (cleared) {
      banner.setScale(0.6);
      this.tweens.add({ targets: banner, scale: 1, duration: 260, ease: 'Back.Out' });
    }

    let y = top + HEAD.body;
    for (const [label, value] of stats) {
      addText(this, left + 16, y, label, { color: THEME_CSS.sub });
      addText(this, left + PANEL_WIDTH - 16, y, value, { color: THEME_CSS.inkDeep, originX: 1 });
      y += STAT_ROW;
    }
    if (data.coins > 0) {
      this.addBand(left, y + 2, THEME.butterSoft, `처음 깼어요  +${data.coins} 코인`, THEME_CSS.accent);
      y += EXTRA_ROW;
      sfx.gold();
    }
    if (achieved.length > 0) {
      // 보상은 업적 화면에서 받으므로, 누르면 그 업적이 있는 탭으로 바로 간다.
      const label = achieved.length > 1 ? `업적 ${achieved.length}개 달성!` : `업적 달성!  ${achieved[0].title}`;
      this.addBand(left, y + 2, THEME.lilacSoft, label, THEME_CSS.inkDeep, () => {
        this.scene.stop(data.sceneKey);
        fadeToScene(this, SCENE.achievements, { tab: achieved[0].group } satisfies AchievementsData);
      });
      y += EXTRA_ROW;
      if (data.coins <= 0) sfx.fanfare();
    }
    if (data.missions > 0) {
      const label = data.missions > 1 ? `주간 미션 ${data.missions}개 달성!` : '주간 미션 달성!';
      this.addBand(left, y + 2, THEME.mintSoft, label, THEME_CSS.good, () => {
        this.scene.stop(data.sceneKey);
        fadeToScene(this, SCENE.achievements, { tab: 'weekly' } satisfies AchievementsData);
      });
      y += EXTRA_ROW;
    }

    const buttonY = top + cardHeight + 12;
    const next = data.next;
    if (cleared && next !== null) {
      this.addButton(left, buttonY, `${next}단계 하기`, 'pink', () => this.play(next));
    } else if (cleared) {
      addText(this, GAME_WIDTH / 2, buttonY + BUTTON_HEIGHT / 2, `${STAGE_LEVELS}단계를 모두 깼어요!`, {
        color: THEME_CSS.good,
        originX: 0.5,
        originY: 0.5,
      });
    } else {
      this.addButton(left, buttonY, '다시 하기', 'pink', () => this.play(data.level));
    }
    this.addButton(left, buttonY + BUTTON_HEIGHT + BUTTON_GAP, '단계 고르기', undefined, () => this.toStages());
  }

  /** 카드 안에 가로로 깔리는 알림 줄. onTap을 주면 눌러서 갈 수 있다는 뜻으로 오른쪽에 화살표를 붙인다. */
  private addBand(left: number, y: number, fill: number, label: string, color: string, onTap?: () => void): void {
    const band = this.add.graphics();
    band.fillStyle(fill, 1);
    band.fillRoundedRect(left + 10, y, PANEL_WIDTH - 20, EXTRA_ROW - 4, 8);
    addText(this, GAME_WIDTH / 2, y + (EXTRA_ROW - 4) / 2, onTap ? `${label}  ›` : label, {
      color,
      originX: 0.5,
      originY: 0.5,
    });
    if (!onTap) return;
    // 이 줄 안에서 누르기 시작했을 때만 반응한다. 마지막 수를 두던 손가락을 이 줄 위에서 떼는 것은 누른 것이 아니다.
    addTapZone(
      this,
      left + 10,
      y,
      PANEL_WIDTH - 20,
      EXTRA_ROW - 4,
      (pressed) => band.setAlpha(pressed ? 0.55 : 1),
      onTap,
    );
  }

  private addButton(
    left: number,
    y: number,
    label: string,
    style: 'pink' | undefined,
    onTap: () => void,
  ): void {
    new PixelButton(this, { x: left, y, width: PANEL_WIDTH, height: BUTTON_HEIGHT, label, style, onTap });
  }
}
