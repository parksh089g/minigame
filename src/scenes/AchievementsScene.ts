import Phaser from 'phaser';
import { FONT_SIZE, GAME_WIDTH, SCENE, THEME, THEME_CSS } from '../config';
import {
  ACHIEVEMENTS,
  achievementsIn,
  claimable,
  GROUP_LABEL,
  GROUPS,
  isClaimed,
  progressOf,
  statsOf,
  type AchievementGroup,
} from '../core/achievements';
import { dateKeyOf } from '../core/daily';
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
import { claimableMissions, daysLeft, missionProgress, weeklyFor, type WeekContext } from '../core/weekly';
import { thisWeek } from '../games/registry';

const MARGIN = 12;
const CONTENT_WIDTH = GAME_WIDTH - MARGIN * 2;
const TABS_TOP = 44;
const TAB_GAP = 4;
const TAB_HEIGHT = 24;
const SUMMARY_TOP = 76;
const ROWS_TOP = 94;
// 줄 아래로 그림자가 3px 내려오므로 간격을 그보다 넉넉히 둔다.
const ROW_HEIGHT = 42;
const ROW_GAP = 6;
/** 줄 하나가 간격까지 쳐서 차지하는 높이 */
const ROW_STEP = ROW_HEIGHT + ROW_GAP;
const BOTTOM_MARGIN = 4;
/** 주간 미션 아래의 한마디: 줄과의 간격과 글자 높이 */
const NOTE_GAP = 6;
const NOTE_HEIGHT = 14;

/** 주간 미션 탭의 이름 */
const WEEKLY = 'weekly';
/** 화면의 탭. 맨 앞이 이번 주의 미션이고, 그 뒤로 업적의 갈래들이 온다. */
export type AchievementsTab = typeof WEEKLY | AchievementGroup;
const TABS: readonly AchievementsTab[] = [WEEKLY, ...GROUPS];
const TAB_LABEL: Record<AchievementsTab, string> = { [WEEKLY]: '주간', ...GROUP_LABEL };

export interface AchievementsData {
  /** 처음에 열어 둘 탭. 없으면 받을 보상이 있는 탭을, 그것도 없으면 주간 미션을 연다. */
  tab?: AchievementsTab;
}

/** 한 줄에 보여 줄 것. 주간 미션과 업적이 같은 모양의 줄을 쓴다. */
interface Row {
  title: string;
  description: string;
  reward: number;
  current: number;
  goal: number;
  complete: boolean;
  /** 보상을 이미 받았는지 */
  claimed: boolean;
  /** 보상을 받는다. 받았으면 true. */
  claim: () => boolean;
}

/** 주간 미션과 업적을 보고, 다 채운 것의 보상 코인을 받는 화면. */
export class AchievementsScene extends Phaser.Scene {
  private coins!: CoinCounter;
  private tabs!: Record<AchievementsTab, PixelButton>;
  private summary!: Phaser.GameObjects.Text;
  private waiting!: Phaser.GameObjects.Text;
  private tab: AchievementsTab = TABS[0];
  /** 이번 주와 그 주의 미션. 화면을 열 때 정한다. */
  private week: WeekContext | null = null;
  /** 화면을 그린 날짜. 켜 둔 채 자정이 지나면 주가 바뀌었을 수 있으니 새로 그린다. */
  private shownDate = '';
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
    this.shownDate = dateKeyOf(new Date());
    this.week = thisWeek(store.data.weekly);

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
    addText(this, GAME_WIDTH / 2, 8, '업적', { size: FONT_SIZE.large, originX: 0.5 });
    this.coins = new CoinCounter(this, GAME_WIDTH - 8, 11, store.data.coins);

    const tabWidth = (CONTENT_WIDTH - TAB_GAP * (TABS.length - 1)) / TABS.length;
    const tabs: Partial<Record<AchievementsTab, PixelButton>> = {};
    TABS.forEach((tab, index) => {
      tabs[tab] = new PixelButton(this, {
        x: MARGIN + index * (tabWidth + TAB_GAP),
        y: TABS_TOP,
        width: tabWidth,
        height: TAB_HEIGHT,
        label: TAB_LABEL[tab],
        onTap: () => this.showTab(tab),
      });
    });
    this.tabs = tabs as Record<AchievementsTab, PixelButton>;

    this.summary = addText(this, MARGIN + 2, SUMMARY_TOP, '', { color: THEME_CSS.sub });
    this.waiting = addText(this, GAME_WIDTH - MARGIN - 2, SUMMARY_TOP, '', {
      color: THEME_CSS.accent,
      originX: 1,
    });

    // 줄이 넘치는 탭에서만 보이는 쪽 넘김 줄. 자리는 쪽을 나눴을 때 들어가는 줄 수 바로 아래다.
    const listHeight = pagedCapacity(this.available, ROW_STEP, PAGER_HEIGHT) * ROW_STEP;
    this.pager = new Pager(this, GAME_WIDTH / 2, ROWS_TOP + listHeight, (page) => this.showPage(page));
    onSwipe(this, new Phaser.Geom.Rectangle(0, ROWS_TOP, GAME_WIDTH, listHeight), (direction) => {
      if (this.showPage(this.page + direction)) sfx.click();
    });

    // 받을 보상이 있으면 그 탭부터 보여 준다. 주간 미션은 한 주가 지나면 사라지니 업적보다 먼저다.
    const ready = claimable(store.data.achievements, statsOf(store.data));
    const fallback = this.readyMissions() > 0 ? WEEKLY : (ready[0]?.group ?? WEEKLY);
    this.showTab(data.tab ?? fallback);
    fadeIn(this);
  }

  override update(): void {
    // 줄을 누른 손가락이 떨어지는 도중에 그 줄을 지우지 않도록, 다시 그리는 일은 다음 프레임으로 미룬다.
    if (this.rowsDirty) {
      this.rowsDirty = false;
      this.buildRows();
    }
    if (dateKeyOf(new Date()) !== this.shownDate) {
      this.scene.restart({ tab: this.tab } satisfies AchievementsData);
    }
  }

  /** 다 채웠지만 아직 보상을 받지 않은 주간 미션의 수 */
  private readyMissions(): number {
    return this.week ? claimableMissions(store.data.weekly, this.week).length : 0;
  }

  /** 지금 탭에 늘어놓을 줄들 */
  private rows(): Row[] {
    if (this.tab !== WEEKLY) {
      const stats = statsOf(store.data);
      return achievementsIn(this.tab).map((achievement) => {
        const claimed = isClaimed(store.data.achievements, achievement.id);
        const progress = progressOf(achievement, stats);
        return {
          title: achievement.title,
          description: achievement.description,
          reward: achievement.reward,
          // 보상을 받은 업적은 다 채운 것으로 보여 준다. 점수 세는 법이 바뀌어 기록을 비운 게임에서는 진행이 다시 0부터 찬다.
          ...(claimed ? { current: progress.goal, goal: progress.goal, complete: true } : progress),
          claimed,
          claim: () => store.claimAchievement(achievement.id).ok,
        };
      });
    }
    const week = this.week;
    const state = week ? weeklyFor(store.data.weekly, week.weekKey) : null;
    if (!week || !state) return [];
    return week.missions.map((mission) => ({
      title: mission.title,
      description: mission.description,
      reward: mission.reward,
      ...missionProgress(mission, state),
      claimed: state.claimed.includes(mission.id),
      claim: () => store.claimWeeklyMission(week, mission.id).ok,
    }));
  }

  private showTab(tab: AchievementsTab): void {
    this.tab = tab;
    this.page = 0;
    this.seekReward = true;
    this.refreshHeader();
    this.rowsDirty = true;
  }

  /** 같은 탭의 다른 쪽으로 넘긴다. 실제로 넘어갔으면 true. */
  private showPage(page: number): boolean {
    const count = this.rows().length;
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
    const readyMissions = this.readyMissions();
    for (const tab of TABS) {
      const hasReward =
        tab === WEEKLY ? readyMissions > 0 : ready.some((achievement) => achievement.group === tab);
      this.tabs[tab].setStyle(tab === this.tab ? 'pink' : hasReward ? 'yellow' : 'neutral');
    }
    if (this.tab === WEEKLY) {
      const rows = this.rows();
      const left = this.week ? daysLeft(this.week.weekKey, this.shownDate) : 0;
      const until = left <= 1 ? '오늘까지' : `${left}일 남음`;
      this.summary.setText(`이번 주 ${rows.filter((row) => row.complete).length}/${rows.length} · ${until}`);
    } else {
      // 보상을 받은 업적은 이룬 것으로 센다. 점수 세는 법이 바뀌어 기록을 비운 게임에서는 받은 업적의 진행이 다시 0부터 찬다.
      const done = ACHIEVEMENTS.filter(
        (achievement) =>
          progressOf(achievement, stats).complete || isClaimed(store.data.achievements, achievement.id),
      );
      this.summary.setText(`달성 ${done.length}/${ACHIEVEMENTS.length}`);
    }
    const waiting = ready.length + readyMissions;
    this.waiting.setText(waiting > 0 ? `받을 보상 ${waiting}개` : '');
  }

  private buildRows(): void {
    this.tweens.killTweensOf(this.rowObjects);
    for (const object of this.rowObjects) object.destroy();
    this.rowObjects = [];

    const items = this.rows();
    const { perPage, pages } = layoutPages(items.length, this.available, ROW_STEP, PAGER_HEIGHT);
    if (this.seekReward) {
      // 탭을 처음 열 때는 받을 보상이 있는 쪽을 보여 준다.
      this.seekReward = false;
      const index = items.findIndex((item) => item.complete && !item.claimed);
      this.page = index < 0 ? 0 : pageOfIndex(index, perPage);
    }
    this.page = clampPage(this.page, pages);
    this.pager.set(pages, this.page);
    const shown = pageSlice(items, this.page, perPage);
    shown.forEach((row, index) => {
      this.addRow(row, MARGIN, ROWS_TOP + index * ROW_STEP);
    });
    if (this.tab === WEEKLY) this.addWeeklyNote(ROWS_TOP + shown.length * ROW_STEP + NOTE_GAP);
  }

  /** 주간 미션 아래에 적는 한마디. 화면이 짧아 자리가 없으면 생략한다. */
  private addWeeklyNote(y: number): void {
    if (y + NOTE_HEIGHT > this.scale.height - BOTTOM_MARGIN) return;
    this.rowObjects.push(
      addText(this, GAME_WIDTH / 2, y, '월요일마다 새 미션으로 바뀌어요', {
        size: FONT_SIZE.small,
        color: THEME_CSS.sub,
        originX: 0.5,
      }),
    );
  }

  private addRow(row: Row, x: number, y: number): void {
    const { claimed } = row;
    const ready = row.complete && !claimed;
    const keep = <T extends Phaser.GameObjects.GameObject>(object: T): T => {
      this.rowObjects.push(object);
      return object;
    };

    const frame = keep(this.add.graphics());
    const drawFrame = (pressed: boolean): void => {
      frame.clear();
      drawPanel(frame, x, y, CONTENT_WIDTH, ROW_HEIGHT, {
        fill: ready ? (pressed ? THEME.butterSoft : THEME.butter) : claimed ? THEME.dim : THEME.card,
        shadow: ready ? THEME.butterDeep : THEME.shadow,
      });
      // 별이 놓이는 동그란 자리
      frame.fillStyle(ready ? THEME.white : claimed ? THEME.card : THEME.dim, 1);
      frame.fillCircle(x + 19, y + ROW_HEIGHT / 2, 13);
    };
    drawFrame(false);

    const star = keep(
      this.add.image(x + 19, y + ROW_HEIGHT / 2, row.complete ? 'icon-star' : 'icon-star-empty'),
    );
    if (claimed) {
      star.setAlpha(0.6);
    } else if (ready) {
      this.tweens.add({
        targets: star,
        scale: 1.18,
        duration: 320,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
      });
    }

    const right = x + CONTENT_WIDTH - 9;
    keep(
      addText(this, x + 38, y + 6, row.title, {
        color: claimed ? THEME_CSS.sub : THEME_CSS.inkDeep,
      }),
    );
    keep(addText(this, x + 38, y + 23, row.description, { size: FONT_SIZE.small, color: THEME_CSS.sub }));

    if (claimed) {
      keep(this.add.image(right, y + 13, 'icon-check').setOrigin(1, 0.5));
    } else if (ready) {
      const label = keep(addText(this, right - 7, y + 12, '받기', { color: THEME_CSS.inkDeep, originX: 1, originY: 0.5 }));
      const pill = keep(this.add.graphics());
      const pillWidth = Math.ceil(label.width) + 14;
      pill.fillStyle(THEME.pinkDeep, 1);
      pill.fillRoundedRect(right - pillWidth, y + 6, pillWidth, 16, 8);
      pill.fillStyle(THEME.pink, 1);
      pill.fillRoundedRect(right - pillWidth, y + 4, pillWidth, 16, 8);
      label.setDepth(1);
    } else {
      keep(
        addText(this, right, y + 6, `${row.current}/${row.goal}`, {
          color: THEME_CSS.sub,
          originX: 1,
        }),
      );
    }
    const reward = keep(
      addText(this, right, y + 24, `+${row.reward}`, {
        size: FONT_SIZE.small,
        color: claimed ? THEME_CSS.faint : THEME_CSS.ink,
        originX: 1,
      }),
    );
    keep(
      this.add
        .image(Math.round(right - reward.width - 2), y + 30, 'coin')
        .setOrigin(1, 0.5)
        .setDisplaySize(10, 10)
        .setAlpha(claimed ? 0.5 : 1),
    );

    if (!ready) return;
    keep(
      addTapZone(this, x, y, CONTENT_WIDTH, ROW_HEIGHT, drawFrame, () => {
        if (!row.claim()) return;
        sfx.gold();
        vibrate([15, 30, 15]);
        this.coins.set(store.data.coins);
        this.showReward(right, y + 6, row.reward);
        this.refreshHeader();
        this.rowsDirty = true;
      }),
    );
  }

  /** 받은 코인 수가 줄 위로 떠오른다. */
  private showReward(x: number, y: number, amount: number): void {
    const text = addText(this, x, y, `+${amount}`, {
      color: THEME_CSS.accent,
      originX: 1,
      stroke: THEME_CSS.white,
    });
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
