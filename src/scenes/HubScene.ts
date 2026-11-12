import Phaser from 'phaser';
import { mascotTexture } from '../art/cosmetics';
import { MASCOT_SIZE } from '../art/vector';
import { APP_NAME, APP_VERSION, FONT_SIZE, GAME_WIDTH, SCENE, THEME, THEME_CSS } from '../config';
import { claimable, statsOf } from '../core/achievements';
import { activeStreak, dateKeyOf, isCleared, streakBonus } from '../core/daily';
import { vibrate } from '../core/haptics';
import { installTip } from '../core/install';
import { currentPlatform, showInstallGuide } from '../core/install-guide';
import { clampPage, layoutPages, pageSlice, type PageLayout } from '../core/paging';
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
import { claimableMissions } from '../core/weekly';
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
  whileBlocked,
} from '../core/ui';
import {
  GAMES,
  getGame,
  personalHubOrder,
  stageGames,
  thisWeek,
  todaysChallenge,
  type MiniGameInfo,
} from '../games/registry';

const MARGIN = 12;
const CARD_WIDTH = GAME_WIDTH - MARGIN * 2;
/** 게임 카드는 한 줄에 세 개씩 격자로 놓는다. 한 화면에 많이 보여야 원하는 게임을 바로 찾는다. */
const COLUMNS = 3;
const TILE_GAP = 6;
const TILE_WIDTH = (CARD_WIDTH - TILE_GAP * (COLUMNS - 1)) / COLUMNS;
const TILE_HEIGHT = 64;
/** 카드 한 줄이 간격까지 쳐서 차지하는 높이 */
const ROW_STEP = TILE_HEIGHT + TILE_GAP;
/** 카드 안의 자리: 아이콘 바탕, 제목, 기록, 별 */
const TILE = {
  iconTop: 4,
  iconBox: 34,
  /** 게임 아이콘의 크기. 픽셀로 그린 작은 아이콘도 이 크기로 맞춘다. */
  iconSize: 28,
  titleY: 39,
  recordY: 50,
  starX: TILE_WIDTH - 10,
  starY: 10,
  starSize: 12,
  /**
   * 별을 누르는 자리. 카드의 오른쪽 위 모서리를 통째로 쓴다: 왼쪽은 아이콘 그림의 끝에서,
   * 오른쪽과 위는 옆 카드와의 틈 절반까지, 아래는 아이콘 바탕의 아래쪽 가까이까지다.
   * 별에서 조금 벗어나 눌러도 게임이 시작되지 않게 그림보다 훨씬 넉넉하게 잡았다.
   */
  starZone: { left: TILE_WIDTH - 24, top: -TILE_GAP / 2, width: 24 + TILE_GAP / 2, height: 33 },
} as const;
const DAILY_TOP = 78;
const DAILY_HEIGHT = 40;
const CARDS_TOP = DAILY_TOP + DAILY_HEIGHT + 8;
/** 맨 아래 버전과 오프라인 표시가 차지하는 높이 */
const FOOTER_HEIGHT = 26;

/** 마지막으로 보던 쪽. 설정이나 꾸미기에 다녀와도 같은 쪽이 보인다. 게임을 하러 갈 때는 첫 쪽으로 돌린다. */
let lastPage = 0;

/** 별을 누른 뒤 카드를 다시 늘어놓기까지의 틈(ms). 별이 바뀐 것을 먼저 보여 주고 나서 자리를 옮긴다. */
const STAR_SETTLE_MS = 160;

const OFFLINE_LABEL: Record<OfflineStatus, { text: string; color: number }> = {
  ready: { text: '오프라인 준비 완료', color: THEME.mintDeep },
  preparing: { text: '오프라인 준비 중', color: THEME.gold },
  unsupported: { text: '온라인 전용', color: THEME.faint },
};

/** 게임 카드의 아이콘 뒤에 까는 색. 게임 순서대로 돌아가며 쓴다. */
const ICON_TILES = [THEME.butterSoft, THEME.lilacSoft, THEME.mintSoft, THEME.skySoft, THEME.pinkSoft] as const;

/** 허브의 격자에 놓이는 카드: 게임이거나, 퍼즐 단계 모드로 들어가는 카드 */
type HubCard = { kind: 'game'; game: MiniGameInfo } | { kind: 'stages' };

/** 게임을 고르는 첫 화면. */
export class HubScene extends Phaser.Scene {
  private backdrop!: Phaser.GameObjects.TileSprite;
  private offlineDot!: Phaser.GameObjects.Arc;
  private offlineText!: Phaser.GameObjects.Text;
  /** 화면을 그린 날짜. 켜 둔 채 자정이 지나면 오늘의 도전을 새로 그린다. */
  private shownDate = '';
  /** 게임 카드를 한 쪽에 몇 개씩, 몇 쪽으로 나눠 놓는지. 화면이 짧으면 여러 쪽이 된다. */
  private layout: PageLayout = { perPage: COLUMNS, pages: 1 };
  /** 한 쪽에 놓는 줄 수 */
  private rowsPerPage = 1;
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
      this.launchGame(sceneKey);
    });
  }

  /**
   * 게임 카드 격자. 화면에 다 들어가면 그대로 늘어놓고,
   * 넘치면 쪽으로 나눠서 아래의 버튼이나 옆으로 밀기로 넘겨 본다.
   */
  private addGames(height: number): void {
    this.cardObjects = [];
    this.cardsDirty = false;
    this.slideFrom = 0;
    this.pager = null;

    const available = height - FOOTER_HEIGHT - CARDS_TOP;
    const rows = layoutPages(Math.ceil(this.cards().length / COLUMNS), available, ROW_STEP, PAGER_HEIGHT);
    this.rowsPerPage = rows.perPage;
    this.layout = { perPage: rows.perPage * COLUMNS, pages: rows.pages };
    this.page = clampPage(lastPage, this.layout.pages);
    this.buildCards();
    if (this.layout.pages <= 1) return;

    const listHeight = this.rowsPerPage * ROW_STEP;
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

  /** 이 사람의 허브에 놓는 순서: 대표 게임, 즐겨찾기, 최근에 한 게임, 안 해 본 게임 */
  private orderedGames(): MiniGameInfo[] {
    const save = store.data;
    return personalHubOrder(GAMES, save.favorites, (id) => getRecord(save, id).lastPlayedAt);
  }

  /**
   * 격자에 놓는 카드들. 퍼즐 단계 모드의 카드는 대표 게임 바로 뒤에 두어 언제나 첫 쪽에서 보인다.
   */
  private cards(): HubCard[] {
    const games = this.orderedGames();
    const cards: HubCard[] = games.map((game) => ({ kind: 'game', game }));
    if (stageGames().length > 0) {
      cards.splice(games.filter((game) => game.featured).length, 0, { kind: 'stages' });
    }
    return cards;
  }

  private buildCards(): void {
    this.tweens.killTweensOf(this.cardObjects);
    for (const object of this.cardObjects) object.destroy();
    this.cardObjects = [];
    pageSlice(this.cards(), this.page, this.layout.perPage).forEach((card, index) => {
      const x = MARGIN + (index % COLUMNS) * (TILE_WIDTH + TILE_GAP);
      const y = CARDS_TOP + Math.floor(index / COLUMNS) * ROW_STEP;
      if (card.kind === 'game') this.addCard(card.game, x, y);
      else this.addStagesCard(x, y);
    });
    // 넘겨서 다시 그린 것이 아니면(즐겨찾기를 바꿨을 때) 다음에는 밀려 들어오지 않는다.
    this.slideFrom = 0;
  }

  private addCard(game: MiniGameInfo, x: number, y: number): void {
    const playable = game.sceneKey !== null;
    const record = getRecord(store.data, game.id);
    const favorite = isFavorite(store.data, game.id);
    const card = this.add.container(x, y);
    this.cardObjects.push(card);
    if (this.slideFrom !== 0) {
      // 넘긴 방향에서 살짝 밀려 들어온다.
      card.setX(x + this.slideFrom * 16).setAlpha(0);
      this.tweens.add({ targets: card, x, alpha: 1, duration: 130, ease: 'Quad.Out' });
    }

    const center = TILE_WIDTH / 2;
    const tile = ICON_TILES[Math.max(0, GAMES.indexOf(game)) % ICON_TILES.length];
    const frame = this.add.graphics();
    const drawFrame = (pressed: boolean): void => {
      frame.clear();
      drawPanel(frame, 0, 0, TILE_WIDTH, TILE_HEIGHT, {
        fill: pressed ? THEME.dim : THEME.card,
        radius: 12,
      });
      frame.fillStyle(playable ? tile : THEME.dim, 1);
      frame.fillRoundedRect(center - TILE.iconBox / 2, TILE.iconTop, TILE.iconBox, TILE.iconBox, 10);
    };
    drawFrame(false);

    const icon = this.add
      .image(center, TILE.iconTop + TILE.iconBox / 2, game.icon)
      .setDisplaySize(TILE.iconSize, TILE.iconSize);
    const title = addText(this, center, TILE.titleY, game.title, {
      size: FONT_SIZE.small,
      color: playable ? THEME_CSS.inkDeep : THEME_CSS.sub,
      originX: 0.5,
    });
    // 긴 제목도 카드 안에 들어가도록 줄인다.
    title.setScale(Math.min(1, (TILE_WIDTH - 4) / title.width));
    card.add([frame, icon, title]);

    if (playable) {
      // 승패로 끝나는 게임은 최고 기록이 없으므로, 둘이 하는 게임이라는 것을 대신 알린다.
      // 이어지는 성장 게임은 최고 기록 자리에 지금까지 쌓은 평판을 보여 준다.
      // 단계 모드로만 해 본 게임은 최고 점수가 없으니, 0점이라고 적는 대신 깬 단계를 적는다.
      const cleared = record.best === 0 ? clearedOf(store.data.stages, game.id) : 0;
      const line = game.versus
        ? { text: '둘이서', color: THEME_CSS.lilacDeep }
        : cleared > 0
          ? { text: `깬 단계 ${cleared}`, color: THEME_CSS.accent }
          : record.plays > 0
            ? { text: `${game.ongoing ? '평판' : '최고'} ${record.best}`, color: THEME_CSS.accent }
            : { text: '새 게임', color: THEME_CSS.faint };
      const best = addText(this, center, TILE.recordY, line.text, {
        size: FONT_SIZE.small,
        color: line.color,
        originX: 0.5,
      });
      best.setScale(Math.min(1, (TILE_WIDTH - 4) / best.width));
      card.add(best);
    } else {
      icon.setAlpha(0.35);
      const soon = addText(this, center, TILE.recordY, '준비 중', {
        size: FONT_SIZE.small,
        color: THEME_CSS.faint,
        originX: 0.5,
      });
      card.add(soon);
    }

    const zone = addTapZone(this, x, y, TILE_WIDTH, TILE_HEIGHT, (pressed) => drawFrame(pressed && playable), () => {
      if (game.sceneKey) {
        sfx.click();
        vibrate(8);
        this.launchGame(game.sceneKey);
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
    if (playable) this.addStar(game, card, x, y, favorite);
  }

  /** 퍼즐 단계 모드로 들어가는 카드. 게임 카드와 같은 모양이고, 기록 자리에 지금까지 깬 단계 수를 적는다. */
  private addStagesCard(x: number, y: number): void {
    const card = this.add.container(x, y);
    this.cardObjects.push(card);
    if (this.slideFrom !== 0) {
      card.setX(x + this.slideFrom * 16).setAlpha(0);
      this.tweens.add({ targets: card, x, alpha: 1, duration: 130, ease: 'Quad.Out' });
    }

    const center = TILE_WIDTH / 2;
    const frame = this.add.graphics();
    const drawFrame = (pressed: boolean): void => {
      frame.clear();
      drawPanel(frame, 0, 0, TILE_WIDTH, TILE_HEIGHT, { fill: pressed ? THEME.dim : THEME.card, radius: 12 });
      frame.fillStyle(THEME.butterSoft, 1);
      frame.fillRoundedRect(center - TILE.iconBox / 2, TILE.iconTop, TILE.iconBox, TILE.iconBox, 10);
    };
    drawFrame(false);
    const icon = this.add
      .image(center, TILE.iconTop + TILE.iconBox / 2, 'icon-stages')
      .setDisplaySize(TILE.iconSize, TILE.iconSize);
    const title = addText(this, center, TILE.titleY, '퍼즐 단계', {
      size: FONT_SIZE.small,
      color: THEME_CSS.inkDeep,
      originX: 0.5,
    });
    const cleared = totalCleared(
      store.data.stages,
      stageGames().map((game) => game.id),
    );
    const line = addText(this, center, TILE.recordY, cleared > 0 ? `깬 단계 ${cleared}` : '새 모드', {
      size: FONT_SIZE.small,
      color: cleared > 0 ? THEME_CSS.accent : THEME_CSS.lilacDeep,
      originX: 0.5,
    });
    line.setScale(Math.min(1, (TILE_WIDTH - 4) / line.width));
    card.add([frame, icon, title, line]);

    const zone = addTapZone(this, x, y, TILE_WIDTH, TILE_HEIGHT, drawFrame, () => {
      sfx.click();
      vibrate(8);
      fadeToScene(this, SCENE.stages);
    });
    this.cardObjects.push(zone);
  }

  /** 게임을 하러 간다. 방금 한 게임은 목록의 앞쪽으로 오므로, 돌아왔을 때는 그 게임이 보이는 첫 쪽을 연다. */
  private launchGame(sceneKey: string): void {
    lastPage = 0;
    fadeToScene(this, sceneKey);
  }

  /** 카드 오른쪽 위의 별. 누르면 즐겨찾기에 넣거나 빼고, 넣은 게임은 목록의 앞쪽에 놓인다. */
  private addStar(
    game: MiniGameInfo,
    card: Phaser.GameObjects.Container,
    x: number,
    y: number,
    favorite: boolean,
  ): void {
    const star = this.add
      .image(TILE.starX, TILE.starY, favorite ? 'icon-star' : 'icon-star-empty')
      .setDisplaySize(TILE.starSize, TILE.starSize);
    card.add(star);
    // 카드 전체를 덮는 누름 영역보다 나중에 만들어서, 별 자리를 누르면 이쪽이 먼저 받는다.
    const zone = addTapZone(
      this,
      x + TILE.starZone.left,
      y + TILE.starZone.top,
      TILE.starZone.width,
      TILE.starZone.height,
      (pressed) => star.setDisplaySize(TILE.starSize + (pressed ? 3 : 0), TILE.starSize + (pressed ? 3 : 0)),
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

  /** 카드 아래 빈자리에 짧은 도움말을 둔다. 화면이 짧아 카드와 겹치면 생략한다. */
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
    const paged = this.layout.pages > 1;
    const rows = paged ? this.rowsPerPage : Math.ceil(GAMES.length / COLUMNS);
    const cardsBottom = CARDS_TOP + rows * ROW_STEP + (paged ? PAGER_HEIGHT : 0);
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
