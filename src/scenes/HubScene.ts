import Phaser from 'phaser';
import { mascotTexture } from '../art/cosmetics';
import { MASCOT_SIZE } from '../art/vector';
import { APP_NAME, APP_VERSION, FONT_SIZE, GAME_WIDTH, SCENE, THEME, THEME_CSS } from '../config';
import { claimable, statsOf } from '../core/achievements';
import { bakedPanel } from '../core/bake';
import { activeStreak, dateKeyOf, isCleared, recentDays, streakBonus } from '../core/daily';
import { vibrate } from '../core/haptics';
import { setHome } from '../core/home';
import { installTip } from '../core/install';
import { currentPlatform, showInstallGuide } from '../core/install-guide';
import { clampPage, pageSlice } from '../core/paging';
import {
  getOfflineStatus,
  isStandalone,
  onOfflineStatus,
  type OfflineStatus,
} from '../core/pwa';
import { getRecord, isFavorite } from '../core/save';
import { sfx } from '../core/sfx';
import { clearedOf, totalCleared } from '../core/stages';
import { store } from '../core/store';
import { setToastAnchor } from '../core/toast';
import { HUB_TABS, listBottom, QUICK_CARD, QUICK_COLUMNS, quickList, steadyList, type HubList } from './hub-layout';
import { loadTodos, todosNow, watchTodos, type HubRecords, type Todo, type Todos } from './hub-todo';
import { settleLastWeek } from './weekly-settle';
import { claimableMissions } from '../core/weekly';
import {
  addBackdrop,
  addTapZone,
  addText,
  CoinCounter,
  drawDayDots,
  drawPanel,
  fadeIn,
  fadeToScene,
  onSwipe,
  Pager,
  PAGER_HEIGHT,
  PixelButton,
  whileBlocked,
} from '../core/ui';
import {
  GAMES,
  gamesInGroup,
  getGame,
  HUB_GROUP_LABEL,
  HUB_GROUPS,
  hubGroupOf,
  personalHubOrder,
  stageGames,
  startingHubGroup,
  thisWeek,
  todaysChallenge,
  type HubGroup,
  type MiniGameInfo,
} from '../games/registry';

const MARGIN = 12;
/** 안내 문구(core/toast.ts)의 가운데가 올 높이. 제목 줄의 한가운데다. */
const TOAST_Y = 56;
const CARD_WIDTH = GAME_WIDTH - MARGIN * 2;
/** 짧게 즐기는 게임의 카드는 한 줄에 세 개씩 격자로 놓는다. 한 화면에 많이 보여야 원하는 게임을 바로 찾는다. */
const COLUMNS = QUICK_COLUMNS;
const TILE_GAP = QUICK_CARD.roomy.gap;
const TILE_WIDTH = (CARD_WIDTH - TILE_GAP * (COLUMNS - 1)) / COLUMNS;
/** 격자 카드 안의 자리: 아이콘 바탕, 제목, 기록. 가장 짧은 화면에서는 카드를 조금 낮추고 안의 것도 당겨 놓는다(tight). */
const TILE_INSIDE = {
  roomy: { iconTop: 4, iconBox: 34, iconSize: 28, titleY: 39, recordY: 50 },
  tight: { iconTop: 3, iconBox: 30, iconSize: 25, titleY: 34, recordY: 44 },
} as const;
/** 격자 카드의 오른쪽 위에 놓는 별 */
const TILE_STAR = {
  x: TILE_WIDTH - 10,
  y: 10,
  size: 12,
  /**
   * 별을 누르는 자리. 카드의 오른쪽 위 모서리를 통째로 쓴다: 왼쪽은 아이콘 그림의 끝에서,
   * 오른쪽과 위는 옆 카드와의 틈 절반까지, 아래는 아이콘 바탕의 아래쪽 가까이까지다.
   * 별에서 조금 벗어나 눌러도 게임이 시작되지 않게 그림보다 훨씬 넉넉하게 잡았다.
   */
  zone: { left: TILE_WIDTH - 24, top: -TILE_GAP / 2, width: 24 + TILE_GAP / 2, height: 33 },
} as const;
/**
 * 꾸준히 하는 게임의 카드: 가로로 긴 카드를 한 줄에 하나씩 놓는다. 왼쪽에 아이콘, 그 옆에 이름과 한 줄 소개,
 * 이름 줄의 오른쪽에 기록이나 오늘 할 일, 오른쪽 끝에 별이 온다. 카드의 높이는 화면에 맞춰 달라져서(hub-layout),
 * 세로 자리는 카드의 가운데에서 잰다.
 */
const ROW = {
  /** 아이콘 바탕의 크기: 카드가 높아지면 함께 커진다. 카드의 높이에서 edge를 뺀 만큼이고, 그림은 바탕보다 inset만큼 작다. */
  icon: { least: 36, most: 46, edge: 14, inset: 8 },
  /** 아이콘 바탕과 카드의 왼쪽 끝 사이. 위아래의 틈과 같게 두되 이보다 벌리지는 않는다. */
  iconLeftMost: 10,
  /** 아이콘 바탕과 글 사이의 틈 */
  textGap: 7,
  /** 이름과 소개, 두 줄을 합친 높이와 줄 사이의 거리 */
  textHeight: 30,
  linePitch: 16,
  /** 기록이나 할 일의 오른쪽 끝. 그 오른쪽은 별의 자리다. */
  statusRight: CARD_WIDTH - 31,
  /** 이름과 기록 사이에 비워 두는 틈 */
  statusGap: 8,
  /** 할 일 뒤에 까는 알약 모양 바탕이 글자 밖으로 나오는 폭 */
  pillPad: 5,
  starX: CARD_WIDTH - 13,
  starSize: 12,
  /** 별을 누르는 자리의 폭. 카드의 오른쪽 끝을 위에서 아래까지 쓴다. */
  starZoneWidth: 28,
} as const;
const DAILY_TOP = 78;
const DAILY_HEIGHT = 40;
/** 오늘의 도전 카드에 그리는 최근 이레의 동그라미: 반지름과 가운데 사이의 간격 */
const DAILY_DOT = { radius: 2.5, pitch: 8 } as const;
/** 두 갈래를 고르는 탭 줄의 위쪽 끝. 게임 목록은 그 아래에 놓인다(hub-layout). */
const TABS_TOP = DAILY_TOP + DAILY_HEIGHT + 8;
const TAB_WIDTH = (CARD_WIDTH - HUB_TABS.gap * (HUB_GROUPS.length - 1)) / HUB_GROUPS.length;
/** 맨 아래 버전과 오프라인 표시가 차지하는 높이 */
const FOOTER_HEIGHT = 26;

/**
 * 마지막으로 보던 갈래와, 갈래마다 보던 쪽. 설정이나 꾸미기에 다녀와도 같은 자리가 보인다.
 * 앱을 켜고 처음 여는 허브는 가장 최근에 한 게임이 있는 갈래를 연다. 게임을 하러 갈 때는 그 게임의 갈래와 첫 쪽으로 돌린다.
 */
let lastGroup: HubGroup | null = null;
const lastPages: Record<HubGroup, number> = { steady: 0, quick: 0 };

/** 별을 누른 뒤 카드를 다시 늘어놓기까지의 틈(ms). 별이 바뀐 것을 먼저 보여 주고 나서 자리를 옮긴다. */
const STAR_SETTLE_MS = 160;

/** 큰 게임의 할 일(hub-todo.ts)을 셈하는 데 쓰는 허브 세이브의 것 */
const RECORDS: HubRecords = {
  playedBefore: (id) => getRecord(store.data, id).plays > 0,
  weekly: () => store.data.weekly,
};

/** 허브를 띄워 둔 동안 할 일을 다시 셈하는 틈(ms). 닫아 둔 회사의 수익이 그사이 다 차는 것 같은 일을 따라간다. */
const TODO_RECHECK_MS = 60_000;

/** 카드 아랫줄에 쓰는 글과 색 */
interface CardLine {
  text: string;
  color: string;
}

const OFFLINE_LABEL: Record<OfflineStatus, { text: string; color: number }> = {
  ready: { text: '오프라인 준비 완료', color: THEME.mintDeep },
  preparing: { text: '오프라인 준비 중', color: THEME.gold },
  unsupported: { text: '온라인 전용', color: THEME.faint },
};

/** 게임 카드의 아이콘 뒤에 까는 색. 게임 순서대로 돌아가며 쓴다. */
const ICON_TILES = [THEME.butterSoft, THEME.lilacSoft, THEME.mintSoft, THEME.skySoft, THEME.pinkSoft] as const;

/** 허브의 목록에 놓이는 카드: 게임이거나, 퍼즐 단계 모드로 들어가는 카드 */
type HubCard = { kind: 'game'; game: MiniGameInfo } | { kind: 'stages' };

/** 탭 한 칸을 이루는 것들 */
interface TabView {
  frame: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  pressed: boolean;
}

/** 카드에서 기록이나 오늘 할 일을 적는 자리 */
interface LineView {
  label: Phaser.GameObjects.Text;
  /** 할 일이 없을 때 쓰는 기록 */
  record: CardLine;
  /** 글이 쓸 수 있는 폭. 넘치면 글자를 줄인다. */
  room: number;
  /** 할 일 뒤에 까는 알약 모양 바탕. 가로로 긴 카드에만 있다. */
  pill: Phaser.GameObjects.Graphics | null;
}

/** 게임을 고르는 첫 화면. */
export class HubScene extends Phaser.Scene {
  private backdrop!: Phaser.GameObjects.TileSprite;
  private offlineDot!: Phaser.GameObjects.Arc;
  private offlineText!: Phaser.GameObjects.Text;
  /** 화면을 그린 날짜. 켜 둔 채 자정이 지나면 오늘의 도전을 새로 그린다. */
  private shownDate = '';
  /** 지금 보여 주는 갈래와, 그 갈래에서 보는 쪽 */
  private group: HubGroup = HUB_GROUPS[0];
  private page = 0;
  /** 갈래마다 카드를 놓는 법: 카드의 크기와 한 쪽의 줄 수, 쪽 수. 화면이 짧으면 여러 쪽이 된다. */
  private lists!: Record<HubGroup, HubList>;
  /** 쪽이 여럿인 갈래의 쪽 넘김 줄. 고른 갈래의 것만 보인다. */
  private pagers: Partial<Record<HubGroup, Pager>> = {};
  private tabs!: Record<HubGroup, TabView>;
  /** 가려져 있는 갈래에 할 일이 있다고 알리는 탭 모서리의 점 */
  private tabDot!: Phaser.GameObjects.Graphics;
  /** 지금 쪽의 카드를 이루는 것들. 쪽이나 갈래를 넘기면 지우고 다시 만든다. */
  private cardObjects: Phaser.GameObjects.GameObject[] = [];
  private cardsDirty = false;
  /** 새 카드가 밀려 들어오는 방향(1이면 오른쪽에서). 0이면 그냥 나타난다. */
  private slideFrom = 0;
  /** 지금 쪽에 놓인 카드에서 기록이나 할 일을 적는 자리. 할 일을 새로 읽으면 바꾼다. */
  private readonly cardLines = new Map<string, LineView>();
  /** 큰 게임의 할 일. 카드를 누르면 그 일이 있는 곳을 바로 연다. */
  private todos: Todos = {};
  /** 할 일을 마지막으로 셈한 때(씬의 시각, ms) */
  private todosAt = 0;

  constructor() {
    super(SCENE.hub);
  }

  create(): void {
    const { height } = this.scale;
    // 허브에서 하러 가는 게임은 끝나면 허브로 돌아온다.
    setHome(null);
    // 주가 바뀌었으면 지난주에 받지 않은 주간 미션 보상을 먼저 넣어 준다. 아래의 코인 수에 바로 보인다.
    settleLastWeek();
    this.backdrop = addBackdrop(this);

    this.addHeader();
    this.shownDate = dateKeyOf(new Date());
    // 큰 게임의 저장을 이미 읽었으면 그것으로 바로 셈해서, 카드를 그릴 때부터 맞는 할 일이 보이게 한다.
    // 기록 초기화나 가져오기로 저장이 바뀌었어도 이 곳의 저장소는 이미 바뀐 것을 들고 있다.
    this.todos = todosNow(RECORDS);
    this.todosAt = 0;
    this.addDaily();
    this.addGames(height);
    this.addTip(height);
    this.addFooter(height);

    const unsubscribe = onOfflineStatus((status) => this.showOfflineStatus(status));
    // 같은 기기의 다른 곳(설치한 앱이나 다른 탭)에서 등불지기나 새싹 컴퍼니를 하면 할 일을 바로 고친다.
    const unwatch = watchTodos(() => this.paintTodos(todosNow(RECORDS)));
    // 뒤에 있다가 다시 보이면 두 게임의 저장을 다시 읽는다. 그사이 다른 곳에서 한 것도 따라간다.
    const onVisible = (): void => {
      if (!document.hidden) this.refreshTodos();
    };
    document.addEventListener('visibilitychange', onVisible);
    // 이 화면은 아래쪽에 누르는 도움말과 상태 표시가 있어서, 안내 문구는 제목 자리에 띄운다.
    setToastAnchor(TOAST_Y);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      unsubscribe();
      unwatch();
      document.removeEventListener('visibilitychange', onVisible);
      setToastAnchor(null);
      this.cardLines.clear();
    });
    this.refreshTodos();

    fadeIn(this);
  }

  override update(time: number): void {
    // 배경 무늬가 천천히 흐른다.
    const step = time / 160;
    this.backdrop.setTilePosition(step, step);

    // 카드를 누른 손가락이 떨어지는 도중에 그 카드를 지우지 않도록, 다시 그리는 일은 다음 프레임으로 미룬다.
    if (this.cardsDirty) {
      this.cardsDirty = false;
      this.buildCards();
    }

    if (dateKeyOf(new Date()) !== this.shownDate) this.scene.restart();

    // 띄워 둔 채로 시간이 흐르면(닫아 둔 회사의 수익이 다 차는 것 같은) 할 일을 다시 셈한다.
    if (time - this.todosAt >= TODO_RECHECK_MS) {
      if (this.todosAt > 0) this.paintTodos(todosNow(RECORDS));
      this.todosAt = time;
    }
  }

  private addHeader(): void {
    new PixelButton(this, {
      x: 8,
      y: 8,
      width: 26,
      height: 26,
      icon: 'icon-gear',
      hitPadding: 6,
      onTap: () => fadeToScene(this, SCENE.settings),
    });

    // 설정 옆: 업적. 받을 보상(업적이나 주간 미션)이 있으면 노랗게 바뀌고 산호색 점이 붙는다.
    const week = thisWeek(store.data.weekly);
    const waiting =
      claimable(store.data.achievements, statsOf(store.data)).length +
      (week ? claimableMissions(store.data.weekly, week).length : 0);
    new PixelButton(this, {
      x: 40,
      y: 8,
      width: 40,
      height: 26,
      label: '업적',
      style: waiting > 0 ? 'yellow' : 'neutral',
      hitPadding: 4,
      onTap: () => fadeToScene(this, SCENE.achievements),
    });
    if (waiting > 0) {
      const dot = this.add.graphics();
      dot.fillStyle(THEME.white, 1);
      dot.fillCircle(78, 9, 5);
      dot.fillStyle(THEME.coral, 1);
      dot.fillCircle(78, 9, 3.5);
    }

    // 업적 옆: 온라인 랭킹
    new PixelButton(this, {
      x: 86,
      y: 8,
      width: 26,
      height: 26,
      icon: 'icon-trophy',
      hitPadding: 3,
      onTap: () => fadeToScene(this, SCENE.ranking),
    });

    // 오른쪽 위: 가진 코인과, 그 코인을 쓰는 꾸미기 상점
    const shopWidth = 50;
    new PixelButton(this, {
      x: GAME_WIDTH - 8 - shopWidth,
      y: 8,
      width: shopWidth,
      height: 26,
      label: '꾸미기',
      style: 'blue',
      hitPadding: 6,
      onTap: () => fadeToScene(this, SCENE.shop),
    });
    new CoinCounter(this, GAME_WIDTH - 8 - shopWidth - 6, 11, store.data.coins);

    // 제목 옆에는 고른 캐릭터가 서서 까딱거린다.
    const mascotWidth = 30;
    const title = addText(this, GAME_WIDTH / 2 + (mascotWidth + 4) / 2, 40, APP_NAME, {
      size: FONT_SIZE.large,
      color: THEME_CSS.inkDeep,
      originX: 0.5,
    });
    const mascot = this.add
      .image(
        Math.round(title.x - title.width / 2) - 4,
        69,
        mascotTexture(store.data.cosmetics.equipped.runner, 'idle'),
      )
      .setOrigin(1, 1)
      .setDisplaySize(mascotWidth, (mascotWidth * MASCOT_SIZE.height) / MASCOT_SIZE.width);
    this.tweens.add({
      targets: mascot,
      scaleY: mascot.scaleY * 0.93,
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    });
  }

  /** 오늘의 도전: 날마다 바뀌는 목표. 누르면 그 게임으로 바로 간다. */
  private addDaily(): void {
    const challenge = todaysChallenge();
    const game = challenge ? getGame(challenge.gameId) : undefined;
    if (!challenge || !game?.sceneKey) return;
    const sceneKey = game.sceneKey;

    const daily = store.data.daily;
    const cleared = isCleared(daily, challenge.dateKey);
    const streak = activeStreak(daily, challenge.dateKey);
    const x = MARGIN;
    const y = DAILY_TOP;
    const right = x + CARD_WIDTH - 10;

    const frame = this.add.graphics();
    const drawFrame = (pressed: boolean): void => {
      frame.clear();
      drawPanel(frame, x, y, CARD_WIDTH, DAILY_HEIGHT, {
        fill: cleared ? THEME.dim : pressed ? THEME.butterSoft : THEME.butter,
        shadow: cleared ? THEME.shadow : THEME.butterDeep,
      });
      // 별이 놓이는 동그란 자리
      frame.fillStyle(THEME.white, 1);
      frame.fillCircle(x + 20, y + DAILY_HEIGHT / 2, 13);
    };
    drawFrame(false);

    this.add.image(x + 20, y + DAILY_HEIGHT / 2, 'icon-star').setAlpha(cleared ? 0.5 : 1);
    const title = addText(this, x + 40, y + 5, '오늘의 도전', {
      color: cleared ? THEME_CSS.sub : THEME_CSS.inkDeep,
    });
    if (streak > 0) {
      addText(this, Math.round(title.x + title.width) + 6, y + 7, `연속 ${streak}일`, {
        size: FONT_SIZE.small,
        color: THEME_CSS.accent,
      });
    }

    // 아랫줄 오른쪽: 오늘까지 이레 동안 달성한 날. 한 번이라도 달성한 적이 있을 때부터 보인다.
    const dots = this.add.graphics();
    const dotsLeft =
      daily.totalCleared > 0
        ? drawDayDots(dots, recentDays(daily, challenge.dateKey), right, y + 28, DAILY_DOT.radius, DAILY_DOT.pitch)
        : right;
    /** 아랫줄의 글자가 동그라미와 겹치지 않게 줄인다. */
    const fitSubtitle = (text: Phaser.GameObjects.Text): void => {
      text.setScale(Math.min(1, (dotsLeft - 5 - text.x) / text.width));
    };

    if (cleared) {
      addText(this, right, y + 5, '달성!', { color: THEME_CSS.good, originX: 1 });
      fitSubtitle(
        addText(this, x + 40, y + 22, '내일 새 도전이 열려요', {
          size: FONT_SIZE.small,
          color: THEME_CSS.sub,
        }),
      );
    } else {
      // 오늘 달성하면 받을 코인. 연속 보너스까지 더해서 보여 준다.
      const reward = challenge.reward + streakBonus(streak + 1);
      const amount = addText(this, right, y + 5, `+${reward}`, { originX: 1 });
      this.add
        .image(Math.round(right - amount.width - 3), y + 13, 'coin')
        .setOrigin(1, 0.5);
      fitSubtitle(
        addText(this, x + 40, y + 22, `${game.title} ${challenge.target}점 이상`, {
          size: FONT_SIZE.small,
        }),
      );
    }

    addTapZone(this, x, y, CARD_WIDTH, DAILY_HEIGHT, drawFrame, () => {
      sfx.click();
      vibrate(8);
      this.launchGame(game, sceneKey);
    });
  }

  /**
   * 게임 목록. 위에는 두 갈래(꾸준히 하는 게임, 짧게 즐기는 게임)를 고르는 탭이 있고, 그 아래에 고른 갈래의 카드가 놓인다.
   * 화면에 다 들어가면 그대로 늘어놓고, 넘치면 쪽으로 나눠서 아래의 버튼이나 옆으로 밀기로 넘겨 본다.
   */
  private addGames(height: number): void {
    this.cardObjects = [];
    this.cardsDirty = false;
    this.slideFrom = 0;
    this.pagers = {};

    const room = height - FOOTER_HEIGHT - TABS_TOP;
    this.lists = {
      steady: steadyList(this.cards('steady').length, room, PAGER_HEIGHT),
      quick: quickList(this.cards('quick').length, room, PAGER_HEIGHT),
    };
    const save = store.data;
    this.group = lastGroup ?? startingHubGroup(GAMES, (id) => getRecord(save, id).lastPlayedAt);
    lastGroup = this.group;
    this.page = clampPage(lastPages[this.group], this.lists[this.group].pages);

    this.addTabs();
    for (const group of HUB_GROUPS) {
      const list = this.lists[group];
      if (list.pages <= 1) continue;
      const y = TABS_TOP + list.top + list.rows * (list.card.height + list.card.gap);
      this.pagers[group] = new Pager(this, GAME_WIDTH / 2, y, (page) => this.showPage(page));
    }
    this.showPagers();
    this.buildCards();

    // 옆으로 밀면 쪽을 넘기고, 끝 쪽에서 더 밀면 옆 갈래로 넘어간다.
    onSwipe(this, new Phaser.Geom.Rectangle(0, TABS_TOP, GAME_WIDTH, room), (direction) => {
      if (this.showPage(this.page + direction)) {
        sfx.click();
        return;
      }
      const next = HUB_GROUPS[HUB_GROUPS.indexOf(this.group) + direction] as HubGroup | undefined;
      if (next && this.showGroup(next, direction > 0 ? 0 : this.lists[next].pages - 1)) sfx.click();
    });
  }

  /** 탭 한 칸의 바탕. 고른 탭은 다른 화면의 탭처럼 분홍이고, 나머지는 카드와 같은 흰 면이다. */
  private tabTexture(selected: boolean, pressed: boolean): string {
    return bakedPanel(this, TAB_WIDTH, HUB_TABS.height, {
      fill: selected ? THEME.pink : pressed ? THEME.dim : THEME.card,
      shadow: selected ? THEME.pinkDeep : THEME.shadow,
      radius: 10,
      depth: HUB_TABS.depth,
    });
  }

  /** 두 갈래를 고르는 탭 줄 */
  private addTabs(): void {
    const views: Partial<Record<HubGroup, TabView>> = {};
    HUB_GROUPS.forEach((group, index) => {
      const x = MARGIN + index * (TAB_WIDTH + HUB_TABS.gap);
      const frame = this.add.image(x, TABS_TOP, this.tabTexture(false, false)).setOrigin(0, 0);
      const label = addText(this, x + TAB_WIDTH / 2, TABS_TOP + HUB_TABS.height / 2, HUB_GROUP_LABEL[group], {
        originX: 0.5,
        originY: 0.5,
      });
      // 긴 이름도 탭 안에 들어가도록 줄인다.
      label.setScale(Math.min(1, (TAB_WIDTH - 8) / label.width));
      const view: TabView = { frame, label, pressed: false };
      views[group] = view;
      addTapZone(
        this,
        x,
        TABS_TOP,
        TAB_WIDTH,
        HUB_TABS.height + HUB_TABS.depth,
        (pressed) => {
          view.pressed = pressed;
          this.paintTabs();
        },
        () => {
          if (!this.showGroup(group)) return;
          sfx.click();
          vibrate(8);
        },
      );
    });
    this.tabs = views as Record<HubGroup, TabView>;
    this.tabDot = this.add.graphics();
    this.paintTabs();
  }

  /**
   * 탭을 지금 고른 갈래에 맞춰 다시 칠한다. 짧게 즐기는 게임을 보고 있는 동안 꾸준히 하는 게임에 오늘 할 일이 있으면,
   * 가려져 있는 그쪽 탭의 모서리에 초록 점을 붙여 알린다.
   */
  private paintTabs(): void {
    HUB_GROUPS.forEach((group, index) => {
      const view = this.tabs[group];
      const selected = group === this.group;
      view.frame.setTexture(this.tabTexture(selected, view.pressed && !selected));
      view.label.setColor(selected ? THEME_CSS.inkDeep : THEME_CSS.sub);
      if (group !== 'steady') return;
      this.tabDot.clear();
      const waiting = !selected && gamesInGroup(GAMES, group).some((game) => this.todos[game.id] !== undefined);
      if (!waiting) return;
      const x = MARGIN + index * (TAB_WIDTH + HUB_TABS.gap) + TAB_WIDTH - 4;
      this.tabDot.fillStyle(THEME.white, 1);
      this.tabDot.fillCircle(x, TABS_TOP + 3, 5);
      this.tabDot.fillStyle(THEME.mintDeep, 1);
      this.tabDot.fillCircle(x, TABS_TOP + 3, 3.5);
    });
  }

  /** 고른 갈래의 쪽 넘김 줄만 보인다. */
  private showPagers(): void {
    for (const group of HUB_GROUPS) {
      const shown = group === this.group;
      this.pagers[group]?.set(shown ? this.lists[group].pages : 1, shown ? this.page : 0);
    }
  }

  /**
   * 다른 갈래를 보여 준다. page를 주지 않으면 그 갈래에서 마지막으로 보던 쪽을 연다. 실제로 바뀌었으면 true.
   */
  private showGroup(group: HubGroup, page: number = lastPages[group]): boolean {
    if (group === this.group) return false;
    this.slideFrom = HUB_GROUPS.indexOf(group) > HUB_GROUPS.indexOf(this.group) ? 1 : -1;
    this.group = group;
    lastGroup = group;
    this.page = clampPage(page, this.lists[group].pages);
    lastPages[group] = this.page;
    this.showPagers();
    this.paintTabs();
    this.cardsDirty = true;
    return true;
  }

  /** 같은 갈래의 다른 쪽으로 넘긴다. 실제로 넘어갔으면 true. */
  private showPage(page: number): boolean {
    const { pages } = this.lists[this.group];
    const next = clampPage(page, pages);
    if (next === this.page) return false;
    this.slideFrom = next > this.page ? 1 : -1;
    this.page = next;
    lastPages[this.group] = next;
    this.pagers[this.group]?.set(pages, next);
    this.cardsDirty = true;
    return true;
  }

  /**
   * 그 갈래에 놓는 카드들. 게임은 이 사람의 순서로 놓는다: 대표 게임, 즐겨찾기, 최근에 한 게임, 안 해 본 게임.
   * 퍼즐 단계 모드의 카드는 짧게 즐기는 게임의 맨 앞(대표 게임이 있으면 그 뒤)에 두어 언제나 첫 쪽에서 보인다.
   */
  private cards(group: HubGroup): HubCard[] {
    const save = store.data;
    const games = personalHubOrder(
      gamesInGroup(GAMES, group),
      save.favorites,
      (id) => getRecord(save, id).lastPlayedAt,
    );
    const cards: HubCard[] = games.map((game) => ({ kind: 'game', game }));
    if (group === 'quick' && stageGames().length > 0) {
      cards.splice(games.filter((game) => game.featured).length, 0, { kind: 'stages' });
    }
    return cards;
  }

  /** 격자 카드 안의 자리. 낮춘 카드에서는 안의 것도 당겨 놓는다. */
  private tileInside(): (typeof TILE_INSIDE)[keyof typeof TILE_INSIDE] {
    return this.lists.quick.compact ? TILE_INSIDE.tight : TILE_INSIDE.roomy;
  }

  /**
   * 격자 카드의 바탕: 둥근 카드와 그 위의 아이콘 자리. 카드가 여러 장이라, 프레임마다 다시 그리는 도형 대신
   * 한 번 구워 둔 그림을 쓴다(core/bake). 느린 기기에서 허브가 끊기지 않게 하려는 것이다.
   */
  private tileTexture(pressed: boolean, iconFill: number): string {
    const inside = this.tileInside();
    return bakedPanel(this, TILE_WIDTH, this.lists.quick.card.height, {
      fill: pressed ? THEME.dim : THEME.card,
      shadow: THEME.shadow,
      radius: 12,
      depth: 3,
      extra: {
        tag: `icon-${iconFill.toString(16)}`,
        draw: (graphics) => {
          graphics.fillStyle(iconFill, 1);
          graphics.fillRoundedRect(TILE_WIDTH / 2 - inside.iconBox / 2, inside.iconTop, inside.iconBox, inside.iconBox, 10);
        },
      },
    });
  }

  /** 가로로 긴 카드 안에서 아이콘 바탕이 놓이는 자리와 크기. 카드의 높이를 따른다. */
  private rowIcon(): { left: number; top: number; box: number; size: number } {
    const height = this.lists.steady.card.height;
    const box = Math.min(ROW.icon.most, Math.max(ROW.icon.least, height - ROW.icon.edge));
    const top = (height - box) / 2;
    return { left: Math.min(ROW.iconLeftMost, Math.round(top)), top, box, size: box - ROW.icon.inset };
  }

  /** 가로로 긴 카드(꾸준히 하는 게임)의 바탕: 둥근 카드와 왼쪽의 아이콘 자리 */
  private rowTexture(pressed: boolean, iconFill: number): string {
    const height = this.lists.steady.card.height;
    const at = this.rowIcon();
    return bakedPanel(this, CARD_WIDTH, height, {
      fill: pressed ? THEME.dim : THEME.card,
      shadow: THEME.shadow,
      radius: 12,
      depth: 3,
      extra: {
        tag: `row-icon-${iconFill.toString(16)}`,
        draw: (graphics) => {
          graphics.fillStyle(iconFill, 1);
          graphics.fillRoundedRect(at.left, at.top, at.box, at.box, 10);
        },
      },
    });
  }

  private buildCards(): void {
    this.tweens.killTweensOf(this.cardObjects);
    for (const object of this.cardObjects) object.destroy();
    this.cardObjects = [];
    this.cardLines.clear();
    const list = this.lists[this.group];
    const top = TABS_TOP + list.top;
    const step = list.card.height + list.card.gap;
    if (this.group === 'steady') {
      pageSlice(this.cards('steady'), this.page, list.rows).forEach((card, index) => {
        if (card.kind === 'game') this.addRowCard(card.game, MARGIN, top + index * step);
      });
    } else {
      pageSlice(this.cards('quick'), this.page, list.rows * COLUMNS).forEach((card, index) => {
        const x = MARGIN + (index % COLUMNS) * (TILE_WIDTH + TILE_GAP);
        const y = top + Math.floor(index / COLUMNS) * step;
        if (card.kind === 'game') this.addCard(card.game, x, y);
        else this.addStagesCard(x, y);
      });
    }
    // 넘겨서 다시 그린 것이 아니면(즐겨찾기를 바꿨을 때) 다음에는 밀려 들어오지 않는다.
    this.slideFrom = 0;
  }

  /** 카드 한 장을 담는 컨테이너. 쪽이나 갈래를 넘겨서 그리는 것이면 넘긴 방향에서 살짝 밀려 들어온다. */
  private addCardContainer(x: number, y: number): Phaser.GameObjects.Container {
    const card = this.add.container(x, y);
    this.cardObjects.push(card);
    if (this.slideFrom !== 0) {
      card.setX(x + this.slideFrom * 16).setAlpha(0);
      this.tweens.add({ targets: card, x, alpha: 1, duration: 130, ease: 'Quad.Out' });
    }
    return card;
  }

  /**
   * 카드에서 기록을 적는 자리의 글. 승패로 끝나는 게임은 최고 기록이 없으므로, 둘이 하는 게임이라는 것을 대신 알린다.
   * 이어지는 성장 게임은 최고 기록 자리에 지금까지 쌓은 평판을 보여 준다.
   * 단계 모드로만 해 본 게임은 최고 점수가 없으니, 0점이라고 적는 대신 깬 단계를 적는다.
   */
  private recordLine(game: MiniGameInfo): CardLine {
    const record = getRecord(store.data, game.id);
    if (game.versus) return { text: '둘이서', color: THEME_CSS.lilacDeep };
    const cleared = record.best === 0 ? clearedOf(store.data.stages, game.id) : 0;
    if (cleared > 0) return { text: `깬 단계 ${cleared}`, color: THEME_CSS.accent };
    if (record.plays === 0) return { text: '새 게임', color: THEME_CSS.faint };
    return {
      text: game.recordLabel?.(record.best) ?? `${game.ongoing ? '평판' : '최고'} ${record.best}`,
      color: THEME_CSS.accent,
    };
  }

  /** 카드를 눌렀을 때: 할 수 있는 게임이면 하러 가고, 준비 중이면 카드를 좌우로 흔든다. */
  private tapCard(game: MiniGameInfo, card: Phaser.GameObjects.Container, x: number): void {
    if (game.sceneKey) {
      sfx.click();
      vibrate(8);
      // 할 일이 있으면 그 일이 있는 곳(등불지기의 오늘의 판 쪽, 회사의 목표 창)을 바로 연다.
      this.launchGame(game, game.sceneKey, this.todos[game.id]?.start);
      return;
    }
    sfx.deny();
    this.tweens.add({
      targets: card,
      x: { from: x - 2, to: x },
      duration: 60,
      repeat: 2,
      yoyo: true,
      onComplete: () => card.setX(x),
    });
  }

  /** 격자에 놓는 작은 카드: 아이콘, 이름, 기록이나 오늘 할 일 */
  private addCard(game: MiniGameInfo, x: number, y: number): void {
    const playable = game.sceneKey !== null;
    const favorite = isFavorite(store.data, game.id);
    const inside = this.tileInside();
    const height = this.lists.quick.card.height;
    const card = this.addCardContainer(x, y);

    const center = TILE_WIDTH / 2;
    const tile = playable ? ICON_TILES[Math.max(0, GAMES.indexOf(game)) % ICON_TILES.length] : THEME.dim;
    const frame = this.add.image(0, 0, this.tileTexture(false, tile)).setOrigin(0, 0);
    const drawFrame = (pressed: boolean): void => {
      frame.setTexture(this.tileTexture(pressed, tile));
    };

    const icon = this.add
      .image(center, inside.iconTop + inside.iconBox / 2, game.icon)
      .setDisplaySize(inside.iconSize, inside.iconSize);
    const title = addText(this, center, inside.titleY, game.title, {
      size: FONT_SIZE.small,
      color: playable ? THEME_CSS.inkDeep : THEME_CSS.sub,
      originX: 0.5,
    });
    // 긴 제목도 카드 안에 들어가도록 줄인다.
    title.setScale(Math.min(1, (TILE_WIDTH - 4) / title.width));
    card.add([frame, icon, title]);

    if (playable) {
      const record = this.recordLine(game);
      const label = addText(this, center, inside.recordY, record.text, {
        size: FONT_SIZE.small,
        color: record.color,
        originX: 0.5,
      });
      const line: LineView = { label, record, room: TILE_WIDTH - 4, pill: null };
      this.cardLines.set(game.id, line);
      this.paintLine(line, this.todos[game.id]);
      card.add(label);
    } else {
      icon.setAlpha(0.35);
      const soon = addText(this, center, inside.recordY, '준비 중', {
        size: FONT_SIZE.small,
        color: THEME_CSS.faint,
        originX: 0.5,
      });
      card.add(soon);
    }

    const zone = addTapZone(this, x, y, TILE_WIDTH, height, (pressed) => drawFrame(pressed && playable), () =>
      this.tapCard(game, card, x),
    );
    this.cardObjects.push(zone);
    if (playable) {
      this.addStar(game, card, favorite, { x: TILE_STAR.x, y: TILE_STAR.y, size: TILE_STAR.size }, {
        x: x + TILE_STAR.zone.left,
        y: y + TILE_STAR.zone.top,
        width: TILE_STAR.zone.width,
        height: TILE_STAR.zone.height,
      });
    }
  }

  /**
   * 꾸준히 하는 게임의 가로로 긴 카드: 왼쪽에 아이콘, 그 옆에 이름과 한 줄 소개, 이름 줄의 오른쪽에 기록이나 오늘 할 일.
   * 오늘 할 일은 초록 알약 모양 바탕 위에 적어서, 들어가 볼 까닭이 있는 카드가 한눈에 보인다.
   */
  private addRowCard(game: MiniGameInfo, x: number, y: number): void {
    const playable = game.sceneKey !== null;
    const favorite = isFavorite(store.data, game.id);
    const height = this.lists.steady.card.height;
    const card = this.addCardContainer(x, y);

    const tile = playable ? ICON_TILES[Math.max(0, GAMES.indexOf(game)) % ICON_TILES.length] : THEME.dim;
    const frame = this.add.image(0, 0, this.rowTexture(false, tile)).setOrigin(0, 0);
    const drawFrame = (pressed: boolean): void => {
      frame.setTexture(this.rowTexture(pressed, tile));
    };

    const at = this.rowIcon();
    const icon = this.add.image(at.left + at.box / 2, height / 2, game.icon).setDisplaySize(at.size, at.size);
    const textLeft = at.left + at.box + ROW.textGap;
    const titleY = Math.round((height - ROW.textHeight) / 2);
    const title = addText(this, textLeft, titleY, game.title, {
      color: playable ? THEME_CSS.inkDeep : THEME_CSS.sub,
    });
    const intro = addText(this, textLeft, titleY + ROW.linePitch, game.steady ?? '', {
      size: FONT_SIZE.small,
      color: THEME_CSS.sub,
    });
    // 긴 소개도 카드 안에 들어가도록 줄인다.
    intro.setScale(Math.min(1, (CARD_WIDTH - textLeft - 8) / Math.max(1, intro.width)));
    card.add([frame, icon, title, intro]);

    // 기록이나 할 일은 이름 줄의 오른쪽에, 작은 글씨의 가운데를 이름의 가운데 높이에 맞춰 적는다.
    const statusY = Math.round(titleY + title.height / 2);
    const room = ROW.statusRight - (textLeft + title.width + ROW.statusGap);
    if (playable) {
      const record = this.recordLine(game);
      const pill = this.add.graphics();
      const label = addText(this, ROW.statusRight, statusY, record.text, {
        size: FONT_SIZE.small,
        color: record.color,
        originX: 1,
        originY: 0.5,
      });
      const line: LineView = { label, record, room, pill };
      this.cardLines.set(game.id, line);
      this.paintLine(line, this.todos[game.id]);
      card.add([pill, label]);
    } else {
      icon.setAlpha(0.35);
      card.add(
        addText(this, ROW.statusRight, statusY, '준비 중', {
          size: FONT_SIZE.small,
          color: THEME_CSS.faint,
          originX: 1,
          originY: 0.5,
        }),
      );
    }

    const zone = addTapZone(this, x, y, CARD_WIDTH, height, (pressed) => drawFrame(pressed && playable), () =>
      this.tapCard(game, card, x),
    );
    this.cardObjects.push(zone);
    if (playable) {
      // 별은 이름 줄의 오른쪽 끝에 놓고, 카드의 오른쪽 끝을 위에서 아래까지 별을 누르는 자리로 쓴다.
      this.addStar(game, card, favorite, { x: ROW.starX, y: statusY, size: ROW.starSize }, {
        x: x + CARD_WIDTH - ROW.starZoneWidth,
        y: y - TILE_GAP / 2,
        width: ROW.starZoneWidth + TILE_GAP / 2,
        height: height + TILE_GAP,
      });
    }
  }

  /** 퍼즐 단계 모드로 들어가는 카드. 게임 카드와 같은 모양이고, 기록 자리에 지금까지 깬 단계 수를 적는다. */
  private addStagesCard(x: number, y: number): void {
    const inside = this.tileInside();
    const card = this.addCardContainer(x, y);

    const center = TILE_WIDTH / 2;
    const frame = this.add.image(0, 0, this.tileTexture(false, THEME.butterSoft)).setOrigin(0, 0);
    const drawFrame = (pressed: boolean): void => {
      frame.setTexture(this.tileTexture(pressed, THEME.butterSoft));
    };
    const icon = this.add
      .image(center, inside.iconTop + inside.iconBox / 2, 'icon-stages')
      .setDisplaySize(inside.iconSize, inside.iconSize);
    const title = addText(this, center, inside.titleY, '퍼즐 단계', {
      size: FONT_SIZE.small,
      color: THEME_CSS.inkDeep,
      originX: 0.5,
    });
    const cleared = totalCleared(
      store.data.stages,
      stageGames().map((game) => game.id),
    );
    const line = addText(this, center, inside.recordY, cleared > 0 ? `깬 단계 ${cleared}` : '새 모드', {
      size: FONT_SIZE.small,
      color: cleared > 0 ? THEME_CSS.accent : THEME_CSS.lilacDeep,
      originX: 0.5,
    });
    line.setScale(Math.min(1, (TILE_WIDTH - 4) / line.width));
    card.add([frame, icon, title, line]);

    const zone = addTapZone(this, x, y, TILE_WIDTH, this.lists.quick.card.height, drawFrame, () => {
      sfx.click();
      vibrate(8);
      fadeToScene(this, SCENE.stages);
    });
    this.cardObjects.push(zone);
  }

  /**
   * 카드에서 기록을 적는 자리를 쓴다. 오늘 할 일이 있으면(큰 게임) 기록 대신 그것을 초록 글씨로 쓰고, 없으면 기록을 쓴다.
   * 긴 글도 제자리에 들어가도록 줄인다. 가로로 긴 카드에서는 할 일 뒤에 알약 모양 바탕을 깐다.
   */
  private paintLine(line: LineView, todo: Todo | undefined): void {
    const { label, pill } = line;
    const shown = todo ? { text: todo.text, color: THEME_CSS.good } : line.record;
    const room = todo && pill ? line.room - ROW.pillPad : line.room;
    label.setText(shown.text).setColor(shown.color);
    label.setScale(Math.min(1, room / label.width));
    if (!pill) return;
    // 알약 바탕을 깔 때는 글자를 그 안쪽으로 들여 놓는다. 글자는 오른쪽 끝에 맞춰져 있다.
    label.setX(ROW.statusRight - (todo ? ROW.pillPad : 0));
    pill.clear();
    if (!todo) return;
    const width = label.displayWidth + ROW.pillPad * 2;
    const height = 15;
    pill.fillStyle(THEME.mintSoft, 1);
    pill.fillRoundedRect(ROW.statusRight - width, label.y - height / 2, width, height, height / 2);
  }

  /** 큰 게임의 저장을 기기에서 다시 읽어서 할 일을 새로 고친다. 읽는 사이에 허브를 떠났으면 아무것도 하지 않는다. */
  private refreshTodos(): void {
    void loadTodos(RECORDS)
      .then((todos) => {
        if (this.sys.isActive()) this.paintTodos(todos);
      })
      .catch(() => undefined);
  }

  /** 할 일을 바꾸고, 지금 쪽에 놓인 카드의 기록 자리와 탭의 점을 다시 쓴다. */
  private paintTodos(todos: Todos): void {
    this.todos = todos;
    for (const [id, line] of this.cardLines) {
      if (line.label.active) this.paintLine(line, todos[id]);
    }
    this.paintTabs();
  }

  /**
   * 게임을 하러 간다. 방금 한 게임은 그 갈래의 앞쪽으로 오므로, 돌아왔을 때는 그 게임이 보이는 갈래의 첫 쪽을 연다.
   * data는 그 게임 씬에 넘길 값이다(할 일이 있는 곳을 바로 여는 것).
   */
  private launchGame(game: MiniGameInfo, sceneKey: string, data?: object): void {
    lastGroup = hubGroupOf(game);
    lastPages[lastGroup] = 0;
    fadeToScene(this, sceneKey, data);
  }

  /**
   * 카드의 별. 누르면 즐겨찾기에 넣거나 빼고, 넣은 게임은 그 갈래의 앞쪽에 놓인다.
   * at은 카드 안에서 별이 놓이는 자리이고, zone은 화면에서 별을 누르는 자리다.
   */
  private addStar(
    game: MiniGameInfo,
    card: Phaser.GameObjects.Container,
    favorite: boolean,
    at: { x: number; y: number; size: number },
    area: { x: number; y: number; width: number; height: number },
  ): void {
    const star = this.add
      .image(at.x, at.y, favorite ? 'icon-star' : 'icon-star-empty')
      .setDisplaySize(at.size, at.size);
    card.add(star);
    // 카드 전체를 덮는 누름 영역보다 나중에 만들어서, 별 자리를 누르면 이쪽이 먼저 받는다.
    const zone = addTapZone(
      this,
      area.x,
      area.y,
      area.width,
      area.height,
      (pressed) => star.setDisplaySize(at.size + (pressed ? 3 : 0), at.size + (pressed ? 3 : 0)),
      () => {
        const added = store.toggleFavorite(game.id);
        if (added) sfx.gold();
        else sfx.click();
        vibrate(8);
        // 별이 바뀐 것을 먼저 보여 주고, 조금 뒤에 바뀐 순서대로 다시 늘어놓는다. 보던 쪽은 그대로 둔다.
        star.setTexture(added ? 'icon-star' : 'icon-star-empty');
        this.time.delayedCall(STAR_SETTLE_MS, () => {
          this.cardsDirty = true;
        });
      },
    );
    this.cardObjects.push(zone);
  }

  /** 목록 아래 빈자리에 짧은 도움말을 둔다. 화면이 짧아 어느 갈래의 목록과든 겹치면 생략한다. */
  private addTip(height: number): void {
    const plays = Object.values(store.data.games).reduce((sum, record) => sum + record.plays, 0);
    // 아직 홈 화면에 추가하지 않았으면 그것부터 권한다. 방법은 기기마다 달라서, 누르면 그 기기에 맞는 순서가 나온다.
    const toInstall = !isStandalone();
    const message = toInstall
      ? installTip(currentPlatform())
      : plays > 0 && store.data.favorites.length === 0
        ? '카드의 별을 누르면 그 게임이 앞쪽에 놓여요. 그다음은 최근에 한 순서예요.'
        : plays > 0
          ? `지금까지 ${plays}판을 플레이했어요. 모은 코인은 꾸미기에서 쓸 수 있어요.`
          : '인터넷이 없어도 언제든 플레이할 수 있어요.';

    const text = addText(this, MARGIN + 10, 0, message, {
      size: FONT_SIZE.small,
      color: THEME_CSS.sub,
      wrapWidth: CARD_WIDTH - 20,
    });
    const panelHeight = Math.ceil(text.height) + 14;
    const top = height - 26 - panelHeight;
    // 탭을 바꿔도 도움말은 그대로 있으므로, 두 갈래 가운데 더 길게 내려오는 목록을 피한다.
    const cardsBottom = TABS_TOP + Math.max(...HUB_GROUPS.map((group) => listBottom(this.lists[group], PAGER_HEIGHT)));
    if (top < cardsBottom) {
      text.destroy();
      return;
    }
    const panel = this.add.graphics();
    const drawTip = (pressed: boolean): void => {
      panel.clear();
      drawPanel(panel, MARGIN, top, CARD_WIDTH, panelHeight, {
        fill: pressed ? THEME.shadow : THEME.dim,
        shadow: null,
      });
    };
    drawTip(false);
    text.setY(top + 7).setDepth(1);
    if (toInstall) {
      addTapZone(this, MARGIN, top, CARD_WIDTH, panelHeight, drawTip, () => {
        sfx.click();
        void whileBlocked(this, showInstallGuide);
      });
    }
  }

  private addFooter(height: number): void {
    const y = height - 18;
    addText(this, 10, y, `v${APP_VERSION}`, { size: FONT_SIZE.small, color: THEME_CSS.sub });
    this.offlineText = addText(this, GAME_WIDTH - 10, y, '', {
      size: FONT_SIZE.small,
      color: THEME_CSS.sub,
      originX: 1,
    });
    this.offlineDot = this.add.circle(0, y + 7, 2.5, THEME.faint);
    this.showOfflineStatus(getOfflineStatus());
  }

  private showOfflineStatus(status: OfflineStatus): void {
    const label = OFFLINE_LABEL[status];
    this.offlineText.setText(label.text);
    this.offlineDot.setFillStyle(label.color);
    this.offlineDot.setX(Math.round(GAME_WIDTH - 10 - this.offlineText.width - 6));
  }
}
