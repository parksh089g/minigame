import Phaser from 'phaser';
import { APP_NAME, APP_VERSION, COLOR, CSS, FONT_SIZE, GAME_WIDTH, SCENE } from '../config';
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
  fillChamfer,
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
  ready: { text: '오프라인 준비 완료', color: COLOR.lime },
  preparing: { text: '오프라인 준비 중', color: COLOR.yellow },
  unsupported: { text: '온라인 전용', color: COLOR.slate },
};

/** 게임을 고르는 첫 화면. */
export class HubScene extends Phaser.Scene {
  private backdrop!: Phaser.GameObjects.TileSprite;
  private offlineDot!: Phaser.GameObjects.Rectangle;
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
    // 배경 점무늬가 천천히 흐른다. 정수 픽셀 단위로만 움직여 픽셀이 흐려지지 않게 한다.
    const step = Math.floor(time / 160);
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

    // 설정 옆: 업적. 받을 보상이 있으면 노랗게 바뀌고 빨간 점이 붙는다.
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
      fillChamfer(dot, 75, 5, 7, 7, COLOR.ink);
      fillChamfer(dot, 76, 6, 5, 5, COLOR.red);
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

    addText(this, GAME_WIDTH / 2, 38, APP_NAME, {
      size: FONT_SIZE.large,
      bold: true,
      color: CSS.yellow,
      shadow: CSS.orange,
      originX: 0.5,
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
    const right = x + CARD_WIDTH - 8;

    const frame = this.add.graphics();
    const drawFrame = (pressed: boolean): void => {
      frame.clear();
      drawPanel(frame, x, y, CARD_WIDTH, DAILY_HEIGHT, {
        fill: cleared ? COLOR.ink : pressed ? COLOR.blue : COLOR.navy,
        border: pressed ? COLOR.sky : cleared ? COLOR.navy : COLOR.ink,
        highlight: cleared ? COLOR.ink : pressed ? COLOR.blue : COLOR.blue,
      });
    };
    drawFrame(false);

    this.add
      .image(x + 18, y + DAILY_HEIGHT / 2, 'icon-star')
      .setScale(2)
      .setAlpha(cleared ? 0.45 : 1);
    const title = addText(this, x + 34, y + 6, '오늘의 도전', {
      bold: true,
      color: cleared ? CSS.silver : CSS.yellow,
    });
    if (streak > 0) {
      addText(this, Math.round(title.x + title.width) + 6, y + 6, `연속 ${streak}일`, {
        color: CSS.orange,
      });
    }

    if (cleared) {
      addText(this, right, y + 6, '달성!', { bold: true, color: CSS.lime, originX: 1 });
      addText(this, x + 34, y + 22, '내일 새 도전이 열려요', { color: CSS.silver });
    } else {
      // 오늘 달성하면 받을 코인. 연속 보너스까지 더해서 보여 준다.
      const reward = challenge.reward + streakBonus(streak + 1);
      const amount = addText(this, right, y + 6, `+${reward}`, { color: CSS.yellow, originX: 1 });
      this.add.image(Math.round(right - amount.width - 11), y + 8, 'coin').setOrigin(0, 0);
      addText(this, x + 34, y + 22, `${game.title} ${challenge.target}점 이상`, { color: CSS.white });
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

    const frame = this.add.graphics();
    const drawFrame = (pressed: boolean): void => {
      frame.clear();
      drawPanel(frame, 0, 0, CARD_WIDTH, CARD_HEIGHT, {
        fill: pressed ? COLOR.navy : COLOR.charcoal,
        border: pressed ? COLOR.sky : COLOR.ink,
        highlight: pressed ? COLOR.navy : COLOR.slate,
      });
      drawPanel(frame, 6, 8, 40, 40, { fill: COLOR.ink, border: COLOR.navy, highlight: COLOR.ink });
    };
    drawFrame(false);

    const icon = this.add.image(26, 28, game.icon).setScale(2);
    const title = addText(this, 54, 5, game.title, {
      bold: true,
      color: playable ? CSS.white : CSS.silver,
    });
    const tagline = addText(this, 54, 20, game.tagline, { color: CSS.silver });
    card.add([frame, icon, title, tagline]);

    if (playable) {
      const best =
        record.plays > 0
          ? addText(this, 54, 35, `최고 기록 ${record.best}`, { color: CSS.yellow })
          : addText(this, 54, 35, '첫 도전을 기다려요', { color: CSS.slate });
      const arrow = this.add.image(CARD_WIDTH - 16, CARD_HEIGHT / 2, 'icon-play').setTint(COLOR.lime);
      card.add([best, arrow]);
    } else {
      icon.setAlpha(0.35);
      tagline.setColor(CSS.slate);
      const soon = addText(this, 66, 35, '준비 중', { color: CSS.slate });
      const lock = this.add.image(54, 38, 'icon-lock').setOrigin(0, 0).setTint(COLOR.slate);
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
      color: CSS.silver,
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
    drawPanel(panel, MARGIN, top, CARD_WIDTH, panelHeight, {
      fill: COLOR.ink,
      border: COLOR.navy,
      highlight: COLOR.ink,
    });
    text.setY(top + 7).setDepth(1);
  }

  private addFooter(height: number): void {
    const y = height - 18;
    addText(this, 8, y, `v${APP_VERSION}`, { color: CSS.slate });
    this.offlineText = addText(this, GAME_WIDTH - 8, y, '', { originX: 1 });
    this.offlineDot = this.add.rectangle(0, y + 6, 4, 4, COLOR.slate).setOrigin(0, 0);
    this.showOfflineStatus(getOfflineStatus());
  }

  private showOfflineStatus(status: OfflineStatus): void {
    const label = OFFLINE_LABEL[status];
    this.offlineText.setText(label.text).setColor(CSS.silver);
    this.offlineDot.setFillStyle(label.color);
    this.offlineDot.setX(Math.round(GAME_WIDTH - 8 - this.offlineText.width - 8));
  }
}
