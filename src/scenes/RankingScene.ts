import Phaser from 'phaser';
import { FONT_SIZE, GAME_WIDTH, SCENE, THEME, THEME_CSS } from '../config';
import type { BackAware } from '../core/app-events';
import { clampPage, layoutPages, pageOfIndex, pageSlice, type PageLayout } from '../core/paging';
import { getRecord } from '../core/save';
import { sfx } from '../core/sfx';
import { store } from '../core/store';
import {
  addBackdrop,
  addPanel,
  addTapZone,
  addText,
  drawPanel,
  fadeIn,
  fadeToScene,
  onSwipe,
  Pager,
  PAGER_HEIGHT,
  PixelButton,
} from '../core/ui';
import { HUB_GAMES, lastPlayedGame, type MiniGameInfo } from '../games/registry';
import { failureText, type ApiFailure } from '../online/api';
import { knownRank, loadBoard, loadStandings, syncScores } from '../online/online';
import { isJoined, isWaitingToSend, isWaitingToSendWeek } from '../online/profile';
import {
  hasWeeklyBoard,
  isRankedGame,
  RANK_SCAN,
  rankLabel,
  RANK_WEEK_MS,
  rankWeekOf,
  rankWeekStart,
  type RankBoard,
  type RankRow,
  type RankSpan,
} from '../online/protocol';
import { askNickname } from './nickname';

const MARGIN = 12;
const CONTENT_WIDTH = GAME_WIDTH - MARGIN * 2;
const RIGHT = GAME_WIDTH - MARGIN;
/** 제목 오른쪽의 범위 버튼(전체, 이번 주). 오른쪽 끝에서부터 놓는다. */
const SPANS: ReadonlyArray<{ span: RankSpan; label: string; width: number }> = [
  { span: 'all', label: '전체', width: 36 },
  { span: 'week', label: '이번 주', width: 48 },
];
const SPAN_BUTTON = { y: 10, height: 22, gap: 4 } as const;
/** 범위 버튼들의 왼쪽 끝. 제목은 뒤로 가기 버튼과 이 사이의 가운데에 놓는다. */
const SPANS_LEFT = RIGHT - SPANS.reduce((sum, item) => sum + item.width, 0) - SPAN_BUTTON.gap * (SPANS.length - 1);
const TITLE_X = Math.round((8 + 26 + SPANS_LEFT) / 2);
/** 이번 주 랭킹의 목록 위에 적는 한 줄(언제 새로 시작하는지)의 높이 */
const WEEK_NOTE_HEIGHT = 14;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const;

/**
 * 이번 주 랭킹이 새로 시작하는 때를 이 기기의 시각으로 적는다. 한국에서는 "월요일 0시"다.
 * 다른 나라에서는 요일과 시각이 다르게 보인다(랭킹의 주는 어디서나 한국 시각으로 바뀐다).
 */
function weekResetLabel(now: number): string {
  const reset = new Date(rankWeekStart(now) + RANK_WEEK_MS);
  const minutes = reset.getMinutes();
  return `${WEEKDAYS[reset.getDay()]}요일 ${reset.getHours()}시${minutes > 0 ? ` ${minutes}분` : ''}`;
}
/** 게임을 고르는 줄 */
const PICKER = { top: 44, height: 26, button: 34 } as const;
/** 게임을 고르는 격자. 허브처럼 한 줄에 세 개씩, 아이콘 아래에 이름을 둔다. */
const CHOOSER = { columns: 3, height: 33, gap: 2, icon: 16 } as const;
/** 격자의 아이콘 오른쪽에 적는 내 순위. gap은 아이콘과의 사이, medal은 1, 2, 3등 동그라미의 반지름이다. */
const BADGE = { gap: 3, medal: 7 } as const;
/** 게임 이름 옆의 작은 세모. 누르면 격자가 펼쳐진다는 표시다. */
const CARET = { width: 7, height: 4, gap: 5 } as const;
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

/** 화살표 버튼 사이에서 게임 이름이 차지하는 자리 */
const TITLE_LEFT = MARGIN + PICKER.button + 6;
const TITLE_WIDTH = CONTENT_WIDTH - (PICKER.button + 6) * 2;

/** 마지막으로 보던 게임과 범위. 다시 들어와도 같은 것이 보인다. */
let lastGameId: string | null = null;
let lastSpan: RankSpan = 'all';

export interface RankingData {
  /** 처음에 보여 줄 게임. 없으면 마지막으로 보던 게임이다. */
  gameId?: string;
  /** 처음에 보여 줄 범위. 없으면 마지막으로 보던 범위다. */
  span?: RankSpan;
}

type View =
  | { kind: 'loading' }
  | { kind: 'failed'; reason: ApiFailure }
  | { kind: 'ready'; board: RankBoard };

/** 게임별 온라인 랭킹을 보고, 닉네임을 정해 참여하는 화면. 인터넷이 없으면 안내만 보인다. */
export class RankingScene extends Phaser.Scene implements BackAware {
  private gameIndex = 0;
  /** 전체 랭킹을 보는지, 이번 주 랭킹을 보는지 */
  private span: RankSpan = 'all';
  private spanButtons: Array<{ span: RankSpan; button: PixelButton }> = [];
  /** 목록 자리에 랭킹 대신 게임을 고르는 격자를 펼쳐 놓았는지 */
  private choosing = false;
  private view: View = { kind: 'loading' };
  private page = 0;
  private layout: PageLayout = { perPage: 1, pages: 1 };
  /** 목록 카드 안쪽의 위쪽 끝과 높이 */
  private listTop = 0;
  private listHeight = 0;
  private footTop = 0;
  private gameIcon!: Phaser.GameObjects.Image;
  private gameTitle!: Phaser.GameObjects.Text;
  /** 게임 이름을 감싸는 알약 모양 바탕과, 이름 옆의 세모 */
  private titleFrame!: Phaser.GameObjects.Graphics;
  private titleCaret!: Phaser.GameObjects.Graphics;
  private pager!: Pager;
  /** 목록과 내 기록 칸을 이루는 것들. 내용이 바뀌면 지우고 다시 만든다. */
  private listObjects: Phaser.GameObjects.GameObject[] = [];
  private footObjects: Phaser.GameObjects.GameObject[] = [];
  private retryButton: PixelButton | null = null;
  private nameButton: PixelButton | null = null;
  /** 불러오기를 시작할 때마다 올린다. 늦게 온 답이 지금 것이 아니면 버린다. */
  private request = 0;
  /** 마지막으로 내 기록을 올리려다 실패한 까닭. 올라갔거나 올릴 것이 없었으면 null. */
  private sendFailure: ApiFailure | null = null;

  constructor() {
    super(SCENE.ranking);
  }

  /** 지금 보고 있는 게임 */
  private get shown(): MiniGameInfo {
    return RANKED[this.gameIndex];
  }

  create(data: RankingData = {}): void {
    const { height } = this.scale;
    // 따로 정해 주지 않았으면 보던 게임을, 처음 들어왔으면 가장 최근에 한 게임을 먼저 보여 준다.
    const wanted =
      data.gameId ??
      lastGameId ??
      lastPlayedGame(
        RANKED.map((game) => game.id),
        (id) => getRecord(store.data, id).lastPlayedAt,
      );
    this.gameIndex = Math.max(0, RANKED.findIndex((game) => game.id === wanted));
    this.span = data.span ?? lastSpan;
    this.choosing = false;
    this.listObjects = [];
    this.footObjects = [];
    this.retryButton = null;
    this.nameButton = null;
    this.page = 0;
    this.sendFailure = null;
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
    addText(this, TITLE_X, 8, '랭킹', { size: FONT_SIZE.large, originX: 0.5 });

    this.addSpanButtons();
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

  // ------------------------------------------------------------ 범위 고르기

  private addSpanButtons(): void {
    let right = RIGHT;
    this.spanButtons = [...SPANS].reverse().map(({ span, label, width }) => {
      const button = new PixelButton(this, {
        x: right - width,
        y: SPAN_BUTTON.y,
        width,
        height: SPAN_BUTTON.height,
        label,
        hitPadding: 2,
        onTap: () => this.pickSpan(span),
      });
      right -= width + SPAN_BUTTON.gap;
      return { span, button };
    });
    this.showSpan();
  }

  private showSpan(): void {
    lastSpan = this.span;
    for (const { span, button } of this.spanButtons) button.setStyle(span === this.span ? 'pink' : 'neutral');
  }

  /** 전체 랭킹과 이번 주 랭킹을 오간다. 보던 게임은 그대로다. */
  private pickSpan(span: RankSpan): void {
    if (span === this.span) return;
    this.span = span;
    this.page = 0;
    this.showSpan();
    if (this.choosing) {
      // 격자에 적힌 내 순위를 고른 범위의 것으로 바꾼다.
      this.drawList();
      void this.refreshStandings();
    }
    this.drawFoot();
    void this.fetchBoard(false);
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
    // 가운데의 게임 이름을 누르면 모든 게임이 격자로 펼쳐진다. 화살표로 하나씩 넘기지 않아도 된다.
    this.titleFrame = this.add.graphics();
    addTapZone(
      this,
      TITLE_LEFT,
      PICKER.top,
      TITLE_WIDTH,
      PICKER.height,
      (pressed) => this.drawTitleFrame(pressed),
      () => {
        sfx.click();
        this.setChoosing(!this.choosing);
      },
    );
    this.gameIcon = this.add.image(0, centerY, this.shown.icon).setDisplaySize(18, 18);
    this.gameTitle = addText(this, 0, centerY, '', { color: THEME_CSS.inkDeep, originY: 0.5 });
    this.titleCaret = this.add.graphics();
  }

  private drawTitleFrame(pressed = false): void {
    this.titleFrame.clear();
    drawPanel(this.titleFrame, TITLE_LEFT, PICKER.top, TITLE_WIDTH, PICKER.height, {
      fill: this.choosing ? THEME.butterSoft : THEME.dim,
      shadow: null,
      radius: PICKER.height / 2,
    });
    this.titleFrame.setAlpha(pressed ? 0.6 : 1);
  }

  private showGame(): void {
    lastGameId = this.shown.id;
    this.gameIcon.setTexture(this.shown.icon).setDisplaySize(18, 18);
    this.gameTitle.setText(this.shown.title);
    // 아이콘, 이름, 세모를 한 덩어리로 가운데에 놓는다.
    const titleWidth = Math.ceil(this.gameTitle.width);
    const width = 18 + 6 + titleWidth + CARET.gap + CARET.width;
    const left = Math.round(GAME_WIDTH / 2 - width / 2);
    this.gameIcon.setX(left + 9);
    this.gameTitle.setX(left + 24);
    this.drawTitleFrame();

    // 세모는 격자가 접혀 있으면 아래를, 펼쳐져 있으면 위를 가리킨다.
    const caretLeft = left + 24 + titleWidth + CARET.gap;
    const centerY = PICKER.top + PICKER.height / 2 + 1;
    const tip = this.choosing ? -CARET.height / 2 : CARET.height / 2;
    this.titleCaret.clear().fillStyle(THEME.sub, 1);
    this.titleCaret.fillTriangle(
      caretLeft,
      centerY - tip,
      caretLeft + CARET.width,
      centerY - tip,
      caretLeft + CARET.width / 2,
      centerY + tip,
    );
  }

  private changeGame(step: 1 | -1): void {
    this.pickGame((this.gameIndex + step + RANKED.length) % RANKED.length);
  }

  /** index번째 게임의 랭킹을 보여 준다. 격자가 펼쳐져 있었으면 접는다. */
  private pickGame(index: number): void {
    this.gameIndex = index;
    this.choosing = false;
    this.page = 0;
    this.showGame();
    this.drawFoot();
    void this.fetchBoard(false);
  }

  /** 목록 자리에 게임을 고르는 격자를 펼치거나 접는다. */
  private setChoosing(open: boolean): void {
    if (this.choosing === open) return;
    this.choosing = open;
    this.page = 0;
    this.showGame();
    this.relayout();
    if (!open) return;
    // 지금 보던 게임이 있는 쪽을 펼친다.
    const page = pageOfIndex(this.gameIndex, this.layout.perPage);
    if (page !== this.page) this.showPage(page);
    void this.refreshStandings();
  }

  /** 격자에 적을 내 순위를 모든 게임에 대해 한 번에 불러온다. 새로 알게 된 것이 있으면 격자를 다시 그린다. */
  private async refreshStandings(): Promise<void> {
    const span = this.span;
    if ((await loadStandings(span)) && this.sys.isActive() && this.choosing && span === this.span) this.drawList();
  }

  /** 뒤로 가기를 누르면 펼쳐 둔 격자부터 접고, 접혀 있으면 허브로 돌아간다. */
  onBackRequest(): void {
    if (this.choosing) this.setChoosing(false);
    else fadeToScene(this, SCENE.hub);
  }

  // ------------------------------------------------------------ 불러오기

  /** 지금 고른 게임의 랭킹을 불러온다. sync면 올리지 못한 내 기록부터 올린다. */
  private async fetchBoard(sync: boolean): Promise<void> {
    const request = (this.request += 1);
    const gameId = this.shown.id;
    const span = this.span;
    if (this.weekless) {
      // 서버에 묻지 않는다. 목록 자리에는 주간 랭킹이 없다는 안내가 나온다.
      this.show({ kind: 'ready', board: { top: [], me: null } });
      // 화면을 열면서 올리기로 한 기록은 그대로 올린다.
      if (sync) void syncScores();
      return;
    }
    this.show({ kind: 'loading' });
    if (sync) {
      const outcome = await syncScores();
      this.sendFailure = outcome.status === 'failed' ? outcome.reason : null;
      // 올리는 사이에 다른 게임으로 넘겼으면, 방금 알게 된 사정을 지금 보이는 내 기록 칸에 반영한다.
      if (request !== this.request && this.sys.isActive()) this.drawFoot();
    }
    if (request !== this.request) return;
    const result = await loadBoard(gameId, span);
    if (request !== this.request) return;
    this.show(result.ok ? { kind: 'ready', board: result.data } : { kind: 'failed', reason: result.reason });
  }

  private show(view: View): void {
    this.view = view;
    this.relayout();
    this.drawFoot();
  }

  /** 목록 자리에 놓을 것(랭킹 줄, 또는 게임 격자)에 맞춰 쪽을 나누고 다시 그린다. */
  private relayout(): void {
    if (this.choosing) {
      const rows = Math.ceil(RANKED.length / CHOOSER.columns);
      const byRow = layoutPages(rows, this.listHeight, CHOOSER.height + CHOOSER.gap, PAGER_HEIGHT);
      this.layout = { perPage: byRow.perPage * CHOOSER.columns, pages: byRow.pages };
    } else {
      const rows = this.view.kind === 'ready' ? this.view.board.top.length : 0;
      this.layout = layoutPages(rows, this.listHeight - this.weekNoteRoom, LIST.row, PAGER_HEIGHT);
    }
    this.page = clampPage(this.page, this.layout.pages);
    this.pager.set(this.layout.pages, this.page);
    this.drawList();
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

  /**
   * 이번 주 랭킹을 보는데 지금 고른 게임에는 주간 랭킹이 없는지.
   * 점수가 계속 쌓이는 게임(새싹 컴퍼니의 평판)은 이번 주에 낸 기록을 따로 가릴 수 없어서 전체 랭킹만 있다.
   */
  private get weekless(): boolean {
    return this.span === 'week' && !hasWeeklyBoard(this.shown.id);
  }

  /** 이번 주 랭킹을 볼 때 목록 위에 비워 두는 높이. 언제 새로 시작하는지를 거기에 적는다. */
  private get weekNoteRoom(): number {
    return this.span === 'week' && !this.choosing && !this.weekless ? WEEK_NOTE_HEIGHT : 0;
  }

  private drawList(): void {
    this.clear(this.listObjects);
    this.retryButton?.setVisible(false);
    if (this.choosing) {
      this.drawChooser();
      return;
    }
    const view = this.view;
    if (this.weekless) {
      this.addNote('기록이 계속 쌓이는 게임이라\n이번 주 랭킹이 따로 없어요.\n전체에서 볼 수 있어요.');
      return;
    }
    if (this.span === 'week') {
      const note = addText(
        this,
        GAME_WIDTH / 2,
        this.listTop + (WEEK_NOTE_HEIGHT - 2) / 2,
        `이번 주 기록만 겨뤄요 · ${weekResetLabel(Date.now())}에 새로 시작`,
        { size: FONT_SIZE.small, color: THEME_CSS.sub, originX: 0.5, originY: 0.5 },
      );
      note.setScale(Math.min(1, (CONTENT_WIDTH - 16) / note.width));
      this.listObjects.push(note);
    }

    if (view.kind === 'loading') {
      this.addNote('랭킹을 불러오는 중...');
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
      this.addNote(
        this.span === 'week'
          ? '이번 주에는 아직 아무도 없어요.\n첫 번째로 이름을 올려 보세요!'
          : '아직 아무도 없어요.\n첫 번째로 이름을 올려 보세요!',
      );
      return;
    }
    const top = this.listTop + this.weekNoteRoom;
    pageSlice(view.board.top, this.page, this.layout.perPage).forEach((row, index) => {
      this.addRow(row, top + index * LIST.row);
    });
  }

  /** 랭킹이 있는 게임을 격자로 늘어놓는다. 하나를 누르면 그 게임의 랭킹으로 간다. */
  private drawChooser(): void {
    const width = (CONTENT_WIDTH - LIST.pad * 2 - CHOOSER.gap * (CHOOSER.columns - 1)) / CHOOSER.columns;
    const first = this.page * this.layout.perPage;
    pageSlice(RANKED, this.page, this.layout.perPage).forEach((game, offset) => {
      const x = MARGIN + LIST.pad + (offset % CHOOSER.columns) * (width + CHOOSER.gap);
      const y = this.listTop + Math.floor(offset / CHOOSER.columns) * (CHOOSER.height + CHOOSER.gap);
      this.addChoice(game, first + offset, x, y, width);
    });
  }

  private addChoice(game: MiniGameInfo, index: number, x: number, y: number, width: number): void {
    const current = index === this.gameIndex;
    const frame = this.add.graphics();
    const drawFrame = (pressed: boolean): void => {
      frame.clear();
      if (!current && !pressed) return;
      frame.fillStyle(current ? THEME.butterSoft : THEME.dim, 1);
      frame.fillRoundedRect(x, y, width, CHOOSER.height, 8);
    };
    drawFrame(false);
    const icon = this.add
      .image(x + width / 2, y + 2 + CHOOSER.icon / 2, game.icon)
      .setDisplaySize(CHOOSER.icon, CHOOSER.icon);
    const title = addText(this, x + width / 2, y + CHOOSER.icon + 3, game.title, {
      size: FONT_SIZE.small,
      color: current ? THEME_CSS.accent : THEME_CSS.inkDeep,
      originX: 0.5,
    });
    // 긴 이름도 칸 안에 들어가도록 줄인다.
    title.setScale(Math.min(1, (width - 4) / title.width));
    const zone = addTapZone(this, x, y, width, CHOOSER.height, drawFrame, () => {
      sfx.click();
      this.pickGame(index);
    });
    this.listObjects.push(frame, icon, title, zone);

    // 랭킹에 올라 있는 게임은 아이콘 옆에 내 순위를 적는다. 게임을 하나씩 넘겨 보지 않아도 한눈에 보인다.
    const rank = isJoined(store.data.online) ? knownRank(game.id, this.span) : null;
    if (rank !== null) this.addBadge(rank, icon.x + CHOOSER.icon / 2 + BADGE.gap, icon.y, x + width - 2);
  }

  /** (left, middle)에서 오른쪽으로 순위를 적는다. right를 넘지 않게 글자를 줄인다. */
  private addBadge(rank: number, left: number, middle: number, right: number): void {
    if (rank <= MEDALS.length) {
      const medal = this.add.graphics().fillStyle(MEDALS[rank - 1], 1);
      medal.fillCircle(left + BADGE.medal, middle, BADGE.medal);
      const number = addText(this, left + BADGE.medal, middle, String(rank), {
        size: FONT_SIZE.small,
        color: THEME_CSS.inkDeep,
        originX: 0.5,
        originY: 0.5,
      });
      this.listObjects.push(medal, number);
      return;
    }
    const label = addText(this, left, middle, rank > RANK_SCAN ? `${RANK_SCAN}+` : `${rank}위`, {
      size: FONT_SIZE.small,
      color: THEME_CSS.sub,
      originY: 0.5,
    });
    label.setScale(Math.min(1, (right - left) / label.width));
    this.listObjects.push(label);
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
      const waiting = this.view.kind === 'ready' ? this.waitingNote() : null;
      // 순위는 올라가 있는 기록의 것이다. 새 기록을 올리지 못했으면 순위 대신 그 사정을 알린다.
      // 이어지는 성장 게임은 점수가 아니라 평판이다.
      const score = me ? (this.shown.ongoing ? `평판 ${me.score}` : `${me.score}점`) : '';
      const rank = me && waiting === null ? `${rankLabel(me.rank)} · ${score}` : null;
      const none = this.weekless
        ? '이번 주 랭킹이 없는 게임이에요'
        : this.span === 'week'
          ? '이번 주에는 아직 기록이 없어요'
          : '이 게임은 아직 기록이 없어요';
      const status = this.view.kind !== 'ready' ? '' : (rank ?? waiting ?? none);
      const name = addText(this, MARGIN + 10, middle, online.name, { color: THEME_CSS.accent, originY: 0.5 });
      const note = addText(this, RIGHT - 10, middle, status, {
        size: rank ? FONT_SIZE.normal : FONT_SIZE.small,
        color: rank ? THEME_CSS.inkDeep : THEME_CSS.sub,
        align: 'right',
        lineSpacing: 1,
        originX: 1,
        originY: 0.5,
      });
      // 닉네임이 길면 오른쪽 글의 자리가 좁다. 넘치면 작은 글씨로 줄이고 두 줄로 접어서 닉네임과 겹치지 않게 한다.
      const room = RIGHT - 10 - (name.x + name.width + 6);
      if (note.width > room) note.setFontSize(FONT_SIZE.small).setWordWrapWidth(room, true);
      this.footObjects.push(name, note);
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

  /**
   * 지금 보는 게임의 내 기록을 서버에 올리지 못했으면 그 사정을 알리는 문구. 다 올라가 있으면 null.
   * 올리지 못한 기록은 세이브에 남아 있다가, 다음에 게임을 마치거나 이 화면을 열 때 다시 올라간다.
   */
  private waitingNote(): string | null {
    if (this.sendFailure === null) return null;
    const online = store.data.online;
    const waiting =
      this.span === 'week'
        ? isWaitingToSendWeek(online, this.shown.id, rankWeekOf(Date.now()))
        : isWaitingToSend(online, store.data.games, this.shown.id);
    if (!waiting) return null;
    // 같은 인터넷을 쓰는 사람들이 한꺼번에 참여하면 서버가 잠깐 받지 않는다(요청 한도).
    return this.sendFailure === 'slow' ? '기록은 잠시 뒤에 올라가요' : '기록을 아직 올리지 못했어요';
  }

  private async editName(): Promise<void> {
    if (!(await askNickname(this))) return;
    this.drawFoot();
    await this.fetchBoard(true);
  }
}
