import Phaser from 'phaser';
import { FONT_SIZE, GAME_WIDTH, SCENE, THEME, THEME_CSS } from '../config';
import { clampPage, layoutPages, pageSlice, type PageLayout } from '../core/paging';
import { sfx } from '../core/sfx';
import { store } from '../core/store';
import {
  addBackdrop,
  addPanel,
  addText,
  fadeIn,
  fadeToScene,
  onSwipe,
  Pager,
  PAGER_HEIGHT,
  PixelButton,
} from '../core/ui';
import { HUB_GAMES, type MiniGameInfo } from '../games/registry';
import { failureText, type ApiFailure } from '../online/api';
import { loadBoard, syncScores } from '../online/online';
import { isJoined } from '../online/profile';
import { isRankedGame, rankLabel, type RankBoard, type RankRow } from '../online/protocol';
import { askNickname } from './nickname';

const MARGIN = 12;
const CONTENT_WIDTH = GAME_WIDTH - MARGIN * 2;
const RIGHT = GAME_WIDTH - MARGIN;
/** 게임을 고르는 줄 */
const PICKER = { top: 44, height: 26, button: 34 } as const;
/** 목록 카드의 위쪽 끝과 안쪽 여백 */
const LIST = { top: 80, pad: 6, row: 19 } as const;
/** 화면 아래의 내 기록 칸과 닉네임 버튼 */
const FOOT = { status: 34, gap: 8, button: 28, bottom: 13 } as const;
/** 1, 2, 3등의 순위 뒤에 까는 동그라미 색 */
const MEDALS = [THEME.gold, THEME.sky, THEME.pink] as const;

/** 랭킹이 있는 게임. 허브에 보이는 순서 그대로다. */
const RANKED: readonly MiniGameInfo[] = HUB_GAMES.filter(
  (game) => game.sceneKey !== null && isRankedGame(game.id),
);

/** 마지막으로 보던 게임. 다시 들어와도 같은 게임이 보인다. */
let lastGameId: string | null = null;

export interface RankingData {
  /** 처음에 보여 줄 게임. 없으면 마지막으로 보던 게임이다. */
  gameId?: string;
}

type View =
  | { kind: 'loading' }
  | { kind: 'failed'; reason: ApiFailure }
  | { kind: 'ready'; board: RankBoard };

/** 게임별 온라인 랭킹을 보고, 닉네임을 정해 참여하는 화면. 인터넷이 없으면 안내만 보인다. */
export class RankingScene extends Phaser.Scene {
  private gameIndex = 0;
  private view: View = { kind: 'loading' };
  private page = 0;
  private layout: PageLayout = { perPage: 1, pages: 1 };
  /** 목록 카드 안쪽의 위쪽 끝과 높이 */
  private listTop = 0;
  private listHeight = 0;
  private footTop = 0;
  private gameIcon!: Phaser.GameObjects.Image;
  private gameTitle!: Phaser.GameObjects.Text;
  private pager!: Pager;
  /** 목록과 내 기록 칸을 이루는 것들. 내용이 바뀌면 지우고 다시 만든다. */
  private listObjects: Phaser.GameObjects.GameObject[] = [];
  private footObjects: Phaser.GameObjects.GameObject[] = [];
  private retryButton: PixelButton | null = null;
  private nameButton: PixelButton | null = null;
  /** 불러오기를 시작할 때마다 올린다. 늦게 온 답이 지금 것이 아니면 버린다. */
  private request = 0;

  constructor() {
    super(SCENE.ranking);
  }

  /** 지금 보고 있는 게임 */
  private get shown(): MiniGameInfo {
    return RANKED[this.gameIndex];
  }

  create(data: RankingData = {}): void {
    const { height } = this.scale;
    const wanted = data.gameId ?? lastGameId;
    this.gameIndex = Math.max(0, RANKED.findIndex((game) => game.id === wanted));
    this.listObjects = [];
    this.footObjects = [];
    this.retryButton = null;
    this.nameButton = null;
    this.page = 0;
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
    addText(this, GAME_WIDTH / 2, 8, '랭킹', { size: FONT_SIZE.large, originX: 0.5 });

    this.addPicker();

    this.footTop = height - FOOT.bottom - FOOT.button - FOOT.gap - FOOT.status;
    const cardHeight = this.footTop - 10 - LIST.top;
    addPanel(this, MARGIN, LIST.top, CONTENT_WIDTH, cardHeight);
    this.listTop = LIST.top + LIST.pad;
    this.listHeight = cardHeight - LIST.pad * 2;
    this.pager = new Pager(this, GAME_WIDTH / 2, this.listTop + this.listHeight - PAGER_HEIGHT, (page) =>
      this.showPage(page),
    );
    onSwipe(this, new Phaser.Geom.Rectangle(0, LIST.top, GAME_WIDTH, cardHeight), (direction) => {
      if (this.showPage(this.page + direction)) sfx.click();
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.request += 1;
    });

    this.showGame();
    this.drawFoot();
    fadeIn(this);
    void this.fetchBoard(true);
  }

  // ------------------------------------------------------------ 게임 고르기

  private addPicker(): void {
    const button = { y: PICKER.top, width: PICKER.button, height: PICKER.height, hitPadding: 4 };
    new PixelButton(this, { ...button, x: MARGIN, icon: 'icon-prev', onTap: () => this.changeGame(-1) });
    new PixelButton(this, {
      ...button,
      x: RIGHT - PICKER.button,
      icon: 'icon-play',
      onTap: () => this.changeGame(1),
    });
    const centerY = PICKER.top + PICKER.height / 2;
    this.gameIcon = this.add.image(0, centerY, this.shown.icon).setDisplaySize(18, 18);
    this.gameTitle = addText(this, 0, centerY, '', { color: THEME_CSS.inkDeep, originY: 0.5 });
  }

  private showGame(): void {
    lastGameId = this.shown.id;
    this.gameIcon.setTexture(this.shown.icon).setDisplaySize(18, 18);
    this.gameTitle.setText(this.shown.title);
    // 아이콘과 이름을 한 덩어리로 가운데에 놓는다.
    const width = 18 + 6 + Math.ceil(this.gameTitle.width);
    const left = Math.round(GAME_WIDTH / 2 - width / 2);
    this.gameIcon.setX(left + 9);
    this.gameTitle.setX(left + 24);
  }

  private changeGame(step: 1 | -1): void {
    this.gameIndex = (this.gameIndex + step + RANKED.length) % RANKED.length;
    this.page = 0;
    this.showGame();
    this.drawFoot();
    void this.fetchBoard(false);
  }

  // ------------------------------------------------------------ 불러오기

  /** 지금 고른 게임의 랭킹을 불러온다. sync면 올리지 못한 내 기록부터 올린다. */
  private async fetchBoard(sync: boolean): Promise<void> {
    const request = (this.request += 1);
    const gameId = this.shown.id;
    this.show({ kind: 'loading' });
    if (sync) await syncScores();
    if (request !== this.request) return;
    const result = await loadBoard(gameId);
    if (request !== this.request) return;
    this.show(result.ok ? { kind: 'ready', board: result.data } : { kind: 'failed', reason: result.reason });
  }

  private show(view: View): void {
    this.view = view;
    const rows = view.kind === 'ready' ? view.board.top.length : 0;
    this.layout = layoutPages(rows, this.listHeight, LIST.row, PAGER_HEIGHT);
    this.page = clampPage(this.page, this.layout.pages);
    this.pager.set(this.layout.pages, this.page);
    this.drawList();
    this.drawFoot();
  }

  private showPage(page: number): boolean {
    const next = clampPage(page, this.layout.pages);
    if (next === this.page) return false;
    this.page = next;
    this.pager.set(this.layout.pages, next);
    this.drawList();
    return true;
  }

  // ------------------------------------------------------------ 목록

  private clear(objects: Phaser.GameObjects.GameObject[]): void {
    for (const object of objects) object.destroy();
    objects.length = 0;
  }

  /** 목록 카드 한가운데에 안내 문구를 놓는다. */
  private addNote(message: string, offsetY = 0): void {
    this.listObjects.push(
      addText(this, GAME_WIDTH / 2, this.listTop + this.listHeight / 2 + offsetY, message, {
        color: THEME_CSS.sub,
        align: 'center',
        originX: 0.5,
        originY: 0.5,
        wrapWidth: CONTENT_WIDTH - 32,
      }),
    );
  }

  private drawList(): void {
    this.clear(this.listObjects);
    this.retryButton?.setVisible(false);
    const view = this.view;

    if (view.kind === 'loading') {
      this.addNote('랭킹을 불러오는 중…');
      return;
    }
    if (view.kind === 'failed') {
      this.addNote(failureText(view.reason), -22);
      this.retryButton ??= new PixelButton(this, {
        x: GAME_WIDTH / 2 - 50,
        y: this.listTop + this.listHeight / 2 + 6,
        width: 100,
        height: 26,
        label: '다시 불러오기',
        onTap: () => void this.fetchBoard(true),
      });
      this.retryButton.setVisible(true);
      return;
    }
    if (view.board.top.length === 0) {
      this.addNote('아직 아무도 없어요.\n첫 번째로 이름을 올려 보세요!');
      return;
    }
    pageSlice(view.board.top, this.page, this.layout.perPage).forEach((row, index) => {
      this.addRow(row, this.listTop + index * LIST.row);
    });
  }

  private addRow(row: RankRow, y: number): void {
    const left = MARGIN + 8;
    const right = RIGHT - 10;
    const middle = y + LIST.row / 2;
    const decor = this.add.graphics();
    this.listObjects.push(decor);
    if (row.mine) {
      decor.fillStyle(THEME.butterSoft, 1);
      decor.fillRoundedRect(MARGIN + 4, y + 1, CONTENT_WIDTH - 8, LIST.row - 2, 7);
    }
    if (row.rank <= MEDALS.length) {
      decor.fillStyle(MEDALS[row.rank - 1], 1);
      decor.fillCircle(left + 8, middle, 7.5);
    }
    this.listObjects.push(
      addText(this, left + 8, middle, String(row.rank), {
        size: row.rank <= MEDALS.length ? FONT_SIZE.normal : FONT_SIZE.small,
        color: row.rank <= MEDALS.length ? THEME_CSS.inkDeep : THEME_CSS.sub,
        originX: 0.5,
        originY: 0.5,
      }),
      addText(this, left + 24, middle, row.name, {
        color: row.mine ? THEME_CSS.accent : THEME_CSS.ink,
        originY: 0.5,
      }),
      addText(this, right, middle, String(row.score), {
        color: row.mine ? THEME_CSS.accent : THEME_CSS.inkDeep,
        originX: 1,
        originY: 0.5,
      }),
    );
  }

  // ------------------------------------------------------------ 내 기록과 닉네임

  private drawFoot(): void {
    this.clear(this.footObjects);
    const online = store.data.online;
    const joined = isJoined(online);
    const top = this.footTop;
    const middle = top + FOOT.status / 2;

    this.footObjects.push(
      addPanel(this, MARGIN, top, CONTENT_WIDTH, FOOT.status, { fill: THEME.dim, shadow: null }),
    );
    if (!joined) {
      this.footObjects.push(
        addText(this, GAME_WIDTH / 2, middle, '닉네임을 정하면 내 최고 기록이\n랭킹에 올라가요.', {
          size: FONT_SIZE.small,
          color: THEME_CSS.sub,
          align: 'center',
          originX: 0.5,
          originY: 0.5,
        }),
      );
    } else {
      const me = this.view.kind === 'ready' ? this.view.board.me : null;
      const status =
        this.view.kind !== 'ready'
          ? ''
          : me
            ? `${rankLabel(me.rank)} · ${me.score}점`
            : '이 게임은 아직 기록이 없어요';
      this.footObjects.push(
        addText(this, MARGIN + 10, middle, online.name, { color: THEME_CSS.accent, originY: 0.5 }),
        addText(this, RIGHT - 10, middle, status, {
          size: me ? FONT_SIZE.normal : FONT_SIZE.small,
          color: me ? THEME_CSS.inkDeep : THEME_CSS.sub,
          originX: 1,
          originY: 0.5,
        }),
      );
    }

    this.nameButton ??= new PixelButton(this, {
      x: MARGIN,
      y: top + FOOT.status + FOOT.gap,
      width: CONTENT_WIDTH,
      height: FOOT.button,
      label: '',
      onTap: () => void this.editName(),
    });
    this.nameButton
      .setLabel(joined ? '닉네임 바꾸기' : '닉네임 정하고 참여하기')
      .setStyle(joined ? 'neutral' : 'pink');
  }

  private async editName(): Promise<void> {
    if (!(await askNickname(this))) return;
    this.drawFoot();
    await this.fetchBoard(true);
  }
}
