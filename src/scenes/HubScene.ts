import Phaser from 'phaser';
import { mascotTexture } from '../art/cosmetics';
import { MASCOT_SIZE } from '../art/vector';
import { APP_NAME, APP_VERSION, FONT_SIZE, GAME_WIDTH, SCENE, THEME, THEME_CSS } from '../config';
import { claimable, statsOf } from '../core/achievements';
import { activeStreak, dateKeyOf, isCleared, streakBonus } from '../core/daily';
import { vibrate } from '../core/haptics';
import { clampPage, layoutPages, pageSlice, type PageLayout } from '../core/paging';
import {
  getOfflineStatus,
  isStandalone,
  onOfflineStatus,
  type OfflineStatus,
} from '../core/pwa';
import { getRecord } from '../core/save';
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
import { GAMES, getGame, todaysChallenge, type MiniGameInfo } from '../games/registry';

const MARGIN = 12;
const CARD_WIDTH = GAME_WIDTH - MARGIN * 2;
const CARD_HEIGHT = 56;
const CARD_GAP = 8;
/** 카드 하나가 간격까지 쳐서 차지하는 높이 */
const CARD_STEP = CARD_HEIGHT + CARD_GAP;
const DAILY_TOP = 78;
const DAILY_HEIGHT = 40;
const CARDS_TOP = DAILY_TOP + DAILY_HEIGHT + 8;
/** 맨 아래 버전과 오프라인 표시가 차지하는 높이 */
const FOOTER_HEIGHT = 26;

/** 마지막으로 보던 쪽. 게임을 하고 돌아와도 같은 쪽이 보인다. */
let lastPage = 0;

const OFFLINE_LABEL: Record<OfflineStatus, { text: string; color: number }> = {
  ready: { text: '오프라인 준비 완료', color: THEME.mintDeep },
  preparing: { text: '오프라인 준비 중', color: THEME.gold },
  unsupported: { text: '온라인 전용', color: THEME.faint },
};

/** 게임 카드의 아이콘 뒤에 까는 색. 게임 순서대로 돌아가며 쓴다. */
const ICON_TILES = [THEME.butterSoft, THEME.lilacSoft, THEME.mintSoft, THEME.skySoft, THEME.pinkSoft] as const;
/** 카드에 놓는 게임 아이콘의 크기. 픽셀로 그린 작은 아이콘도 이 크기로 맞춘다. */
const ICON_SIZE = 32;

/** 게임을 고르는 첫 화면. */
export class HubScene extends Phaser.Scene {
  private backdrop!: Phaser.GameObjects.TileSprite;
  private offlineDot!: Phaser.GameObjects.Arc;
  private offlineText!: Phaser.GameObjects.Text;
  /** 화면을 그린 날짜. 켜 둔 채 자정이 지나면 오늘의 도전을 새로 그린다. */
  private shownDate = '';
  /** 게임 카드를 한 쪽에 몇 개씩, 몇 쪽으로 나눠 놓는지. 화면이 짧으면 여러 쪽이 된다. */
  private layout: PageLayout = { perPage: 1, pages: 1 };
  private page = 0;
  private pager: Pager | null = null;
  /** 지금 쪽의 카드를 이루는 것들. 쪽을 넘기면 지우고 다시 만든다. */
  private cardObjects: Phaser.GameObjects.GameObject[] = [];
  private cardsDirty = false;
  /** 새 카드가 밀려 들어오는 방향(1이면 오른쪽에서). 0이면 그냥 나타난다. */
  private slideFrom = 0;

  constructor() {
    super(SCENE.hub);
  }

  create(): void {
    const { height } = this.scale;
    this.backdrop = addBackdrop(this);

    this.addHeader();
    this.shownDate = dateKeyOf(new Date());
    this.addDaily();
    this.addGames(height);
    this.addTip(height);
    this.addFooter(height);

    const unsubscribe = onOfflineStatus((status) => this.showOfflineStatus(status));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, unsubscribe);

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

    // 설정 옆: 업적. 받을 보상이 있으면 노랗게 바뀌고 산호색 점이 붙는다.
    const waiting = claimable(store.data.achievements, statsOf(store.data)).length;
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

    if (cleared) {
      addText(this, right, y + 5, '달성!', { color: THEME_CSS.good, originX: 1 });
      addText(this, x + 40, y + 22, '내일 새 도전이 열려요', {
        size: FONT_SIZE.small,
        color: THEME_CSS.sub,
      });
    } else {
      // 오늘 달성하면 받을 코인. 연속 보너스까지 더해서 보여 준다.
      const reward = challenge.reward + streakBonus(streak + 1);
      const amount = addText(this, right, y + 5, `+${reward}`, { originX: 1 });
      this.add
        .image(Math.round(right - amount.width - 3), y + 13, 'coin')
        .setOrigin(1, 0.5);
      addText(this, x + 40, y + 22, `${game.title} ${challenge.target}점 이상`, {
        size: FONT_SIZE.small,
      });
    }

    addTapZone(this, x, y, CARD_WIDTH, DAILY_HEIGHT, drawFrame, () => {
      sfx.click();
      vibrate(8);
      fadeToScene(this, sceneKey);
    });
  }

  /**
   * 게임 카드 목록. 화면에 다 들어가면 그대로 늘어놓고,
   * 넘치면 쪽으로 나눠서 아래의 버튼이나 옆으로 밀기로 넘겨 본다.
   */
  private addGames(height: number): void {
    this.cardObjects = [];
    this.cardsDirty = false;
    this.slideFrom = 0;
    this.pager = null;

    const available = height - FOOTER_HEIGHT - CARDS_TOP;
    this.layout = layoutPages(GAMES.length, available, CARD_STEP, PAGER_HEIGHT);
    this.page = clampPage(lastPage, this.layout.pages);
    this.buildCards();
    if (this.layout.pages <= 1) return;

    const listHeight = this.layout.perPage * CARD_STEP;
    this.pager = new Pager(this, GAME_WIDTH / 2, CARDS_TOP + listHeight, (page) => this.showPage(page));
    this.pager.set(this.layout.pages, this.page);
    onSwipe(this, new Phaser.Geom.Rectangle(0, CARDS_TOP, GAME_WIDTH, listHeight), (direction) => {
      if (this.showPage(this.page + direction)) sfx.click();
    });
  }

  /** 다른 쪽으로 넘긴다. 실제로 넘어갔으면 true. */
  private showPage(page: number): boolean {
    const next = clampPage(page, this.layout.pages);
    if (next === this.page) return false;
    this.slideFrom = next > this.page ? 1 : -1;
    this.page = next;
    lastPage = next;
    this.pager?.set(this.layout.pages, next);
    this.cardsDirty = true;
    return true;
  }

  private buildCards(): void {
    this.tweens.killTweensOf(this.cardObjects);
    for (const object of this.cardObjects) object.destroy();
    this.cardObjects = [];
    pageSlice(GAMES, this.page, this.layout.perPage).forEach((game, index) => {
      this.addCard(game, MARGIN, CARDS_TOP + index * CARD_STEP);
    });
  }

  private addCard(game: MiniGameInfo, x: number, y: number): void {
    const playable = game.sceneKey !== null;
    const record = getRecord(store.data, game.id);
    const card = this.add.container(x, y);
    this.cardObjects.push(card);
    if (this.slideFrom !== 0) {
      // 넘긴 방향에서 살짝 밀려 들어온다.
      card.setX(x + this.slideFrom * 16).setAlpha(0);
      this.tweens.add({ targets: card, x, alpha: 1, duration: 130, ease: 'Quad.Out' });
    }

    const tile = ICON_TILES[Math.max(0, GAMES.indexOf(game)) % ICON_TILES.length];
    const goX = CARD_WIDTH - 22;
    const goY = CARD_HEIGHT / 2;
    const frame = this.add.graphics();
    const drawFrame = (pressed: boolean): void => {
      frame.clear();
      drawPanel(frame, 0, 0, CARD_WIDTH, CARD_HEIGHT, {
        fill: pressed ? THEME.dim : THEME.card,
        radius: 14,
      });
      frame.fillStyle(playable ? tile : THEME.dim, 1);
      frame.fillRoundedRect(8, 8, 40, 40, 11);
      if (playable) {
        // 오른쪽의 동그란 시작 버튼
        frame.fillStyle(THEME.pinkDeep, 1);
        frame.fillCircle(goX, goY + 2, 12);
        frame.fillStyle(THEME.pink, 1);
        frame.fillCircle(goX, goY, 12);
      }
    };
    drawFrame(false);

    const icon = this.add.image(28, 28, game.icon).setDisplaySize(ICON_SIZE, ICON_SIZE);
    const title = addText(this, 56, 6, game.title, {
      color: playable ? THEME_CSS.inkDeep : THEME_CSS.sub,
    });
    const tagline = addText(this, 56, 23, game.tagline, {
      size: FONT_SIZE.small,
      color: THEME_CSS.sub,
    });
    card.add([frame, icon, title, tagline]);

    if (playable) {
      const best =
        record.plays > 0
          ? addText(this, 56, 37, `최고 기록 ${record.best}`, {
              size: FONT_SIZE.small,
              color: THEME_CSS.accent,
            })
          : addText(this, 56, 37, '첫 도전을 기다려요', {
              size: FONT_SIZE.small,
              color: THEME_CSS.faint,
            });
      const arrow = this.add.image(goX + 1, goY, 'icon-play');
      card.add([best, arrow]);
    } else {
      icon.setAlpha(0.35);
      const lock = this.add.image(56, 43, 'icon-lock').setOrigin(0, 0.5).setDisplaySize(10, 10).setAlpha(0.6);
      const soon = addText(this, 69, 37, '준비 중', { size: FONT_SIZE.small, color: THEME_CSS.faint });
      card.add([soon, lock]);
    }

    const zone = addTapZone(this, x, y, CARD_WIDTH, CARD_HEIGHT, (pressed) => drawFrame(pressed && playable), () => {
      if (game.sceneKey) {
        sfx.click();
        vibrate(8);
        fadeToScene(this, game.sceneKey);
      } else {
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
    });
    this.cardObjects.push(zone);
  }

  /** 카드 아래 빈자리에 짧은 도움말을 둔다. 화면이 짧아 카드와 겹치면 생략한다. */
  private addTip(height: number): void {
    const plays = Object.values(store.data.games).reduce((sum, record) => sum + record.plays, 0);
    const message = !isStandalone()
      ? "앱처럼 쓰려면 브라우저 메뉴에서 '홈 화면에 추가'를 눌러 주세요."
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
    const paged = this.layout.pages > 1;
    const shown = paged ? this.layout.perPage : GAMES.length;
    const cardsBottom = CARDS_TOP + shown * CARD_STEP + (paged ? PAGER_HEIGHT : 0);
    if (top < cardsBottom) {
      text.destroy();
      return;
    }
    const panel = this.add.graphics();
    drawPanel(panel, MARGIN, top, CARD_WIDTH, panelHeight, { fill: THEME.dim, shadow: null });
    text.setY(top + 7).setDepth(1);
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
