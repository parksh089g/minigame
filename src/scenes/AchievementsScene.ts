import Phaser from 'phaser';
import { COLOR, CSS, FONT_SIZE, GAME_WIDTH, SCENE } from '../config';
import {
  ACHIEVEMENTS,
  achievementsIn,
  claimable,
  GROUP_LABEL,
  GROUPS,
  isClaimed,
  progressOf,
  statsOf,
  type Achievement,
  type AchievementGroup,
} from '../core/achievements';
import { vibrate } from '../core/haptics';
import { clampPage, layoutPages, pagedCapacity, pageOfIndex, pageSlice } from '../core/paging';
import { sfx } from '../core/sfx';
import { store } from '../core/store';
import {
  addBackdrop,
  addTapZone,
  addText,
  CoinCounter,
  drawPanel,
  fadeIn,
  fadeToScene,
  onSwipe,
  Pager,
  PAGER_HEIGHT,
  PixelButton,
} from '../core/ui';

const MARGIN = 12;
const CONTENT_WIDTH = GAME_WIDTH - MARGIN * 2;
const TABS_TOP = 44;
const TAB_GAP = 4;
const TAB_HEIGHT = 24;
const SUMMARY_TOP = 76;
const ROWS_TOP = 94;
const ROW_HEIGHT = 44;
const ROW_GAP = 4;
/** 줄 하나가 간격까지 쳐서 차지하는 높이 */
const ROW_STEP = ROW_HEIGHT + ROW_GAP;
const BOTTOM_MARGIN = 4;

interface AchievementsData {
  /** 처음에 열어 둘 탭. 없으면 받을 보상이 있는 탭을 연다. */
  group?: AchievementGroup;
}

/** 업적을 보고, 달성한 업적의 보상 코인을 받는 화면. */
export class AchievementsScene extends Phaser.Scene {
  private coins!: CoinCounter;
  private tabs!: Record<AchievementGroup, PixelButton>;
  private summary!: Phaser.GameObjects.Text;
  private waiting!: Phaser.GameObjects.Text;
  private group: AchievementGroup = GROUPS[0];
  /** 지금 탭에서 보고 있는 쪽. 줄이 화면에 다 들어가지 않는 탭만 여러 쪽이 된다. */
  private page = 0;
  /** 탭을 열 때 받을 보상이 있는 쪽을 찾아서 보여 줄지 */
  private seekReward = true;
  private pager!: Pager;
  /** 줄을 놓을 수 있는 높이 */
  private available = 0;
  /** 지금 탭의 줄들을 이루는 것들. 탭을 바꾸거나 보상을 받으면 지우고 다시 만든다. */
  private rowObjects: Phaser.GameObjects.GameObject[] = [];
  private rowsDirty = false;

  constructor() {
    super(SCENE.achievements);
  }

  create(data: AchievementsData = {}): void {
    this.rowObjects = [];
    this.rowsDirty = false;
    this.page = 0;
    this.available = this.scale.height - ROWS_TOP - BOTTOM_MARGIN;

    addBackdrop(this);
    new PixelButton(this, {
      x: 8,
      y: 8,
      width: 26,
      height: 26,
      icon: 'icon-back',
      hitPadding: 6,
      onTap: () => fadeToScene(this, SCENE.hub),
    });
    addText(this, GAME_WIDTH / 2, 9, '업적', {
      size: FONT_SIZE.large,
      bold: true,
      originX: 0.5,
      shadow: CSS.navy,
    });
    this.coins = new CoinCounter(this, GAME_WIDTH - 8, 11, store.data.coins);

    const tabWidth = (CONTENT_WIDTH - TAB_GAP * (GROUPS.length - 1)) / GROUPS.length;
    const tabs: Partial<Record<AchievementGroup, PixelButton>> = {};
    GROUPS.forEach((group, index) => {
      tabs[group] = new PixelButton(this, {
        x: MARGIN + index * (tabWidth + TAB_GAP),
        y: TABS_TOP,
        width: tabWidth,
        height: TAB_HEIGHT,
        label: GROUP_LABEL[group],
        onTap: () => this.showGroup(group),
      });
    });
    this.tabs = tabs as Record<AchievementGroup, PixelButton>;

    this.summary = addText(this, MARGIN + 2, SUMMARY_TOP, '', { color: CSS.silver });
    this.waiting = addText(this, GAME_WIDTH - MARGIN - 2, SUMMARY_TOP, '', {
      color: CSS.yellow,
      originX: 1,
    });

    // 줄이 넘치는 탭에서만 보이는 쪽 넘김 줄. 자리는 쪽을 나눴을 때 들어가는 줄 수 바로 아래다.
    const listHeight = pagedCapacity(this.available, ROW_STEP, PAGER_HEIGHT) * ROW_STEP;
    this.pager = new Pager(this, GAME_WIDTH / 2, ROWS_TOP + listHeight, (page) => this.showPage(page));
    onSwipe(this, new Phaser.Geom.Rectangle(0, ROWS_TOP, GAME_WIDTH, listHeight), (direction) => {
      if (this.showPage(this.page + direction)) sfx.click();
    });

    // 받을 보상이 있으면 그 탭부터 보여 준다.
    const ready = claimable(store.data.achievements, statsOf(store.data));
    this.showGroup(data.group ?? ready[0]?.group ?? GROUPS[0]);
    fadeIn(this);
  }

  override update(): void {
    // 줄을 누른 손가락이 떨어지는 도중에 그 줄을 지우지 않도록, 다시 그리는 일은 다음 프레임으로 미룬다.
    if (this.rowsDirty) {
      this.rowsDirty = false;
      this.buildRows();
    }
  }

  private showGroup(group: AchievementGroup): void {
    this.group = group;
    this.page = 0;
    this.seekReward = true;
    this.refreshHeader();
    this.rowsDirty = true;
  }

  /** 같은 탭의 다른 쪽으로 넘긴다. 실제로 넘어갔으면 true. */
  private showPage(page: number): boolean {
    const count = achievementsIn(this.group).length;
    const { pages } = layoutPages(count, this.available, ROW_STEP, PAGER_HEIGHT);
    const next = clampPage(page, pages);
    if (next === this.page) return false;
    this.page = next;
    this.rowsDirty = true;
    return true;
  }

  /** 탭 색과 요약 줄을 지금 상태에 맞춘다. 받을 보상이 있는 탭은 노랗게 보인다. */
  private refreshHeader(): void {
    const stats = statsOf(store.data);
    const ready = claimable(store.data.achievements, stats);
    for (const group of GROUPS) {
      const hasReward = ready.some((achievement) => achievement.group === group);
      this.tabs[group].setStyle(group === this.group ? 'blue' : hasReward ? 'yellow' : 'neutral');
    }
    const done = ACHIEVEMENTS.filter((achievement) => progressOf(achievement, stats).complete);
    this.summary.setText(`달성 ${done.length}/${ACHIEVEMENTS.length}`);
    this.waiting.setText(ready.length > 0 ? `받을 보상 ${ready.length}개` : '');
  }

  private buildRows(): void {
    this.tweens.killTweensOf(this.rowObjects);
    for (const object of this.rowObjects) object.destroy();
    this.rowObjects = [];

    const items = achievementsIn(this.group);
    const { perPage, pages } = layoutPages(items.length, this.available, ROW_STEP, PAGER_HEIGHT);
    if (this.seekReward) {
      // 탭을 처음 열 때는 받을 보상이 있는 쪽을 보여 준다.
      this.seekReward = false;
      const ready = claimable(store.data.achievements, statsOf(store.data));
      const index = items.findIndex((item) => ready.includes(item));
      this.page = index < 0 ? 0 : pageOfIndex(index, perPage);
    }
    this.page = clampPage(this.page, pages);
    this.pager.set(pages, this.page);
    pageSlice(items, this.page, perPage).forEach((achievement, index) => {
      this.addRow(achievement, MARGIN, ROWS_TOP + index * ROW_STEP);
    });
  }

  private addRow(achievement: Achievement, x: number, y: number): void {
    const progress = progressOf(achievement, statsOf(store.data));
    const claimed = isClaimed(store.data.achievements, achievement.id);
    const ready = progress.complete && !claimed;
    const keep = <T extends Phaser.GameObjects.GameObject>(object: T): T => {
      this.rowObjects.push(object);
      return object;
    };

    const frame = keep(this.add.graphics());
    const drawFrame = (pressed: boolean): void => {
      frame.clear();
      drawPanel(frame, x, y, CONTENT_WIDTH, ROW_HEIGHT, {
        fill: claimed ? COLOR.ink : ready ? (pressed ? COLOR.blue : COLOR.navy) : COLOR.charcoal,
        border: ready ? COLOR.yellow : claimed ? COLOR.navy : COLOR.ink,
        highlight: claimed ? COLOR.ink : ready ? COLOR.blue : COLOR.slate,
      });
    };
    drawFrame(false);

    const star = keep(this.add.image(x + 16, y + ROW_HEIGHT / 2, 'icon-star').setScale(2));
    if (!progress.complete) {
      star.setTint(COLOR.slate).setTintMode(Phaser.TintModes.FILL).setAlpha(0.6);
    } else if (claimed) {
      star.setAlpha(0.55);
    } else {
      this.tweens.add({ targets: star, alpha: 0.35, duration: 320, yoyo: true, repeat: -1 });
    }

    const right = x + CONTENT_WIDTH - 8;
    keep(
      addText(this, x + 32, y + 6, achievement.title, {
        bold: true,
        color: ready ? CSS.yellow : claimed ? CSS.silver : CSS.white,
      }),
    );
    keep(
      addText(this, x + 32, y + 24, achievement.description, {
        color: claimed ? CSS.slate : CSS.silver,
      }),
    );

    if (claimed) {
      keep(this.add.image(right, y + 13, 'icon-check').setOrigin(1, 0.5).setTint(COLOR.lime));
    } else if (ready) {
      keep(addText(this, right, y + 6, '받기', { bold: true, color: CSS.lime, originX: 1 }));
    } else {
      keep(
        addText(this, right, y + 6, `${progress.current}/${progress.goal}`, {
          color: CSS.silver,
          originX: 1,
        }),
      );
    }
    const reward = keep(
      addText(this, right, y + 24, `+${achievement.reward}`, {
        color: claimed ? CSS.slate : CSS.yellow,
        originX: 1,
      }),
    );
    keep(
      this.add
        .image(Math.round(right - reward.width - 11), y + 26, 'coin')
        .setOrigin(0, 0)
        .setAlpha(claimed ? 0.4 : 1),
    );

    if (!ready) return;
    keep(
      addTapZone(this, x, y, CONTENT_WIDTH, ROW_HEIGHT, drawFrame, () => {
        const result = store.claimAchievement(achievement.id);
        if (!result.ok) return;
        sfx.gold();
        vibrate([15, 30, 15]);
        this.coins.set(store.data.coins);
        this.showReward(right, y + 6, achievement.reward);
        this.refreshHeader();
        this.rowsDirty = true;
      }),
    );
  }

  /** 받은 코인 수가 줄 위로 떠오른다. */
  private showReward(x: number, y: number, amount: number): void {
    const text = addText(this, x, y, `+${amount}`, { bold: true, color: CSS.yellow, originX: 1 });
    text.setDepth(10);
    this.tweens.add({
      targets: text,
      y: y - 18,
      alpha: 0,
      duration: 700,
      ease: 'Cubic.Out',
      onComplete: () => text.destroy(),
    });
  }
}
