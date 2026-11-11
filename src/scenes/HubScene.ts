import Phaser from 'phaser';
import { APP_NAME, APP_VERSION, COLOR, CSS, FONT_SIZE, GAME_WIDTH, SCENE } from '../config';
import { activeStreak, dateKeyOf, isCleared, streakBonus } from '../core/daily';
import { vibrate } from '../core/haptics';
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
  PixelButton,
} from '../core/ui';
import { GAMES, getGame, todaysChallenge, type MiniGameInfo } from '../games/registry';

const MARGIN = 12;
const CARD_WIDTH = GAME_WIDTH - MARGIN * 2;
const CARD_HEIGHT = 56;
const CARD_GAP = 8;
const DAILY_TOP = 78;
const DAILY_HEIGHT = 40;
const CARDS_TOP = DAILY_TOP + DAILY_HEIGHT + 8;

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

  constructor() {
    super(SCENE.hub);
  }

  create(): void {
    const { height } = this.scale;
    this.backdrop = addBackdrop(this);

    this.addHeader();
    this.shownDate = dateKeyOf(new Date());
    this.addDaily();
    GAMES.forEach((game, index) => {
      this.addCard(game, MARGIN, CARDS_TOP + index * (CARD_HEIGHT + CARD_GAP));
    });
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

  private addCard(game: MiniGameInfo, x: number, y: number): void {
    const playable = game.sceneKey !== null;
    const record = getRecord(store.data, game.id);
    const card = this.add.container(x, y);

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

    addTapZone(this, x, y, CARD_WIDTH, CARD_HEIGHT, (pressed) => drawFrame(pressed && playable), () => {
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
    const cardsBottom = CARDS_TOP + GAMES.length * (CARD_HEIGHT + CARD_GAP);
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
