import Phaser from 'phaser';
import { FONT_SIZE, GAME_WIDTH, SCENE, THEME, THEME_CSS } from '../config';
import type { BackAware } from '../core/app-events';
import { clampPage, layoutPages, pageSlice } from '../core/paging';
import { sfx } from '../core/sfx';
import { gameStats, STATS_TEXT, summarize, summaryLines, type GameStat } from '../core/stats';
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
import { GAMES } from '../games/registry';

const MARGIN = 12;
const CONTENT_WIDTH = GAME_WIDTH - MARGIN * 2;
/** 카드 안쪽의 좌우 여백 */
const PAD = 8;
/** 맨 위의 요약 카드. row는 한 줄의 높이다. */
const SUMMARY = { top: 46, row: 16, pad: 6 } as const;
/** 게임마다의 줄. icon은 아이콘의 크기, plays는 판 수가 끝나는 자리(오른쪽 끝에서 잰 거리)다. */
const LIST = { gap: 10, head: 14, row: 20, icon: 14, plays: 62 } as const;
const BOTTOM_MARGIN = 8;

/** 지금까지 얼마나 했는지 보여 주는 화면. 설정에서 들어온다. */
export class StatsScene extends Phaser.Scene implements BackAware {
  private stats: GameStat[] = [];
  private page = 0;
  private pager!: Pager;
  private rowsTop = 0;
  /** 줄을 놓을 수 있는 높이 */
  private available = 0;
  /** 지금 쪽의 줄들을 이루는 것들. 쪽을 넘기면 지우고 다시 만든다. */
  private rowObjects: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super(SCENE.stats);
  }

  /** 들어온 곳이 설정이라서 설정으로 돌아간다. */
  onBackRequest(): void {
    fadeToScene(this, SCENE.settings);
  }

  create(): void {
    this.rowObjects = [];
    this.page = 0;
    this.stats = gameStats(GAMES, store.data);

    addBackdrop(this);
    new PixelButton(this, {
      x: 8,
      y: 8,
      width: 26,
      height: 26,
      icon: 'icon-back',
      hitPadding: 6,
      onTap: () => this.onBackRequest(),
    });
    addText(this, GAME_WIDTH / 2, 8, STATS_TEXT.title, { size: FONT_SIZE.large, originX: 0.5 });

    const listTop = this.addSummary() + LIST.gap;
    this.addColumnTitles(listTop);
    this.rowsTop = listTop + LIST.head;
    this.available = this.scale.height - this.rowsTop - BOTTOM_MARGIN;

    const { perPage } = this.layout();
    const listHeight = perPage * LIST.row;
    addPanel(this, MARGIN, this.rowsTop - 3, CONTENT_WIDTH, Math.min(this.stats.length, perPage) * LIST.row + 4);
    this.pager = new Pager(this, GAME_WIDTH / 2, this.rowsTop + listHeight, (page) => this.showPage(page));
    onSwipe(this, new Phaser.Geom.Rectangle(0, this.rowsTop, GAME_WIDTH, listHeight), (direction) => {
      if (this.showPage(this.page + direction)) sfx.click();
    });

    this.buildRows();
    fadeIn(this);
  }

  private layout(): { perPage: number; pages: number } {
    return layoutPages(this.stats.length, this.available, LIST.row, PAGER_HEIGHT);
  }

  /** 맨 위의 요약 카드를 그리고, 카드가 끝나는 자리를 돌려준다. */
  private addSummary(): number {
    const rows = summaryLines(summarize(GAMES, store.data));

    const height = rows.length * SUMMARY.row + SUMMARY.pad * 2;
    addPanel(this, MARGIN, SUMMARY.top, CONTENT_WIDTH, height);
    const right = MARGIN + CONTENT_WIDTH - PAD;
    rows.forEach(([label, value], index) => {
      const y = SUMMARY.top + SUMMARY.pad + index * SUMMARY.row + 1;
      const name = addText(this, MARGIN + PAD, y, label, { color: THEME_CSS.sub });
      const amount = addText(this, right, y, value, { color: THEME_CSS.inkDeep, originX: 1 });
      // 값이 길어도 이름과 겹치지 않게 줄인다.
      const room = CONTENT_WIDTH - PAD * 2 - name.width - 6;
      amount.setScale(Math.min(1, room / amount.width));
    });
    return SUMMARY.top + height + 3;
  }

  private addColumnTitles(y: number): void {
    const right = MARGIN + CONTENT_WIDTH - PAD;
    const title = (x: number, text: string, originX: number): void => {
      addText(this, x, y, text, { size: FONT_SIZE.small, color: THEME_CSS.sub, originX });
    };
    title(MARGIN + PAD, STATS_TEXT.columnGame, 0);
    title(right - LIST.plays, STATS_TEXT.columnPlays, 1);
    title(right, STATS_TEXT.columnBest, 1);
  }

  /** 다른 쪽으로 넘긴다. 실제로 넘어갔으면 true. */
  private showPage(page: number): boolean {
    const next = clampPage(page, this.layout().pages);
    if (next === this.page) return false;
    this.page = next;
    this.buildRows();
    return true;
  }

  private buildRows(): void {
    for (const object of this.rowObjects) object.destroy();
    this.rowObjects = [];

    const { perPage, pages } = this.layout();
    this.page = clampPage(this.page, pages);
    this.pager.set(pages, this.page);
    pageSlice(this.stats, this.page, perPage).forEach((stat, index) => {
      this.addRow(stat, this.rowsTop + index * LIST.row, index);
    });
  }

  private addRow(stat: GameStat, y: number, index: number): void {
    const keep = <T extends Phaser.GameObjects.GameObject>(object: T): T => {
      this.rowObjects.push(object);
      return object;
    };
    const played = stat.plays > 0;
    const left = MARGIN + PAD;
    const right = MARGIN + CONTENT_WIDTH - PAD;
    const middle = y + LIST.row / 2 - 1;

    // 줄을 눈으로 따라가기 쉽게 한 줄 걸러 옅은 띠를 깐다.
    if (index % 2 === 1) {
      const band = keep(this.add.graphics());
      band.fillStyle(THEME.dim, 0.6);
      band.fillRoundedRect(MARGIN + 3, y - 1, CONTENT_WIDTH - 6, LIST.row, 6);
    }

    keep(
      this.add
        .image(left + LIST.icon / 2, middle, stat.icon)
        .setDisplaySize(LIST.icon, LIST.icon)
        .setAlpha(played ? 1 : 0.45),
    );

    const playsText = keep(
      addText(this, right - LIST.plays, middle, played ? String(stat.plays) : STATS_TEXT.none, {
        color: played ? THEME_CSS.ink : THEME_CSS.faint,
        originX: 1,
        originY: 0.5,
      }),
    );
    const best =
      stat.best !== null
        ? { text: String(stat.best), color: THEME_CSS.accent, size: FONT_SIZE.normal }
        : stat.versus
          ? { text: STATS_TEXT.versus, color: THEME_CSS.lilacDeep, size: FONT_SIZE.small }
          : { text: STATS_TEXT.none, color: THEME_CSS.faint, size: FONT_SIZE.normal };
    keep(addText(this, right, middle, best.text, { color: best.color, size: best.size, originX: 1, originY: 0.5 }));

    const titleLeft = left + LIST.icon + 5;
    const title = keep(
      addText(this, titleLeft, middle, stat.title, {
        color: played ? THEME_CSS.inkDeep : THEME_CSS.sub,
        originY: 0.5,
      }),
    );
    // 긴 제목이 판 수와 겹치지 않게 줄인다.
    const room = playsText.x - playsText.width - 4 - titleLeft;
    title.setScale(Math.min(1, room / title.width));
  }
}
