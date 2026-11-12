import Phaser from 'phaser';
import { FONT_SIZE, GAME_WIDTH, SCENE, THEME, THEME_CSS } from '../config';
import type { BackAware } from '../core/app-events';
import { vibrate } from '../core/haptics';
import { clampPage, layoutPages, pageOfIndex, type PageLayout } from '../core/paging';
import { sfx } from '../core/sfx';
import { clearedOf, isUnlocked, MILESTONE_EVERY, nextLevel, STAGE_LEVELS } from '../core/stages';
import { store } from '../core/store';
import { tabRows } from '../core/tabs';
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
import { stageGames, type MiniGameInfo } from '../games/registry';
import type { StageStart } from './MiniGameScene';

export interface StagesData {
  /** 처음에 보여 줄 게임. 적지 않으면 마지막으로 보던 게임이다. */
  gameId?: string;
  /** 같은 화면에서 게임만 바꿔 다시 그리는 것이면 true. 서서히 나타나지 않고 바로 보인다. */
  quiet?: boolean;
}

const MARGIN = 12;
const CONTENT_WIDTH = GAME_WIDTH - MARGIN * 2;
/**
 * 게임을 고르는 탭: 한 줄에 다섯 개까지 놓고, 게임이 그보다 많으면 줄을 늘린다(core/tabs).
 * 한 줄에 다 넣으면 탭이 좁아져서 누르기 어렵다. 여러 줄일 때는 단계 칸의 자리를 덜 빼앗도록 탭을 조금 낮춘다.
 */
const TAB = {
  top: 42,
  gap: 4,
  /** 한 줄일 때 */
  one: { height: 44, icon: 24, iconTop: 4, countTop: 30 },
  /** 여러 줄일 때 */
  many: { height: 36, icon: 20, iconTop: 3, countTop: 23 },
} as const;
/** 탭 아래에서 고른 게임의 이름을 적는 줄까지의 틈, 그 줄에서 단계 칸까지의 거리 */
const TITLE = { above: 8, height: 20 } as const;
/** 단계 칸: 한 줄에 다섯 개 */
const COLUMNS = 5;
const CELL = { height: 32, gap: 4 } as const;
const CELL_WIDTH = (CONTENT_WIDTH - CELL.gap * (COLUMNS - 1)) / COLUMNS;
const ROW_STEP = CELL.height + CELL.gap;
/** 맨 아래의 "이어서 하기" 버튼과 그 위아래 여백 */
const FOOT = { button: 32, above: 6, below: 10 } as const;

const LOOK = {
  tab: { on: THEME.butter, off: THEME.card, onShadow: THEME.butterDeep },
  cleared: { fill: THEME.mintSoft, shadow: THEME.mint, text: THEME_CSS.inkDeep },
  next: { fill: THEME.butter, shadow: THEME.butterDeep, text: THEME_CSS.inkDeep },
  locked: { fill: THEME.dim, shadow: THEME.shadow, text: THEME_CSS.faint },
  milestone: THEME.gold,
} as const;

/** 마지막으로 보던 게임. 한 단계를 하고 돌아와도 같은 게임이 보인다. */
let lastGameId: string | null = null;

/**
 * 퍼즐 단계 모드의 첫 화면: 게임을 고르고, 그 게임의 단계를 고른다.
 * 깬 단계와 바로 다음 단계만 열려 있고, 맨 아래의 버튼은 다음 단계를 바로 연다.
 */
export class StagesScene extends Phaser.Scene implements BackAware {
  private games: MiniGameInfo[] = [];
  private picked!: MiniGameInfo;
  private layout: PageLayout = { perPage: COLUMNS, pages: 1 };
  private page = 0;
  private pager: Pager | null = null;
  /** 지금 쪽의 단계 칸을 이루는 것들. 쪽을 넘기면 지우고 다시 만든다. */
  private cellObjects: Phaser.GameObjects.GameObject[] = [];
  private cellsDirty = false;
  /** 고른 게임의 이름과 깬 단계 수를 적는 줄의 위치. 탭이 몇 줄인지에 따라 달라진다. */
  private titleTop = 0;
  /** 단계 칸이 시작하는 위치 */
  private gridTop = 0;

  constructor() {
    super(SCENE.stages);
  }

  onBackRequest(): void {
    fadeToScene(this, SCENE.hub);
  }

  create(data: StagesData = {}): void {
    const { height } = this.scale;
    this.games = stageGames();
    const wanted = data.gameId ?? lastGameId;
    this.picked = this.games.find((game) => game.id === wanted) ?? this.games[0];
    lastGameId = this.picked.id;
    this.cellObjects = [];
    this.cellsDirty = false;
    this.pager = null;

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
    addText(this, GAME_WIDTH / 2, 8, '퍼즐 단계', { size: FONT_SIZE.large, originX: 0.5 });
    new CoinCounter(this, GAME_WIDTH - 8, 11, store.data.coins);

    this.addTabs();
    this.addTitle();
    this.addGrid(height);
    this.addContinue(height);

    if (data.quiet) this.input.enabled = true;
    else fadeIn(this);
  }

  override update(): void {
    // 칸을 누른 손가락이 떨어지는 도중에 그 칸을 지우지 않도록, 다시 그리는 일은 다음 프레임으로 미룬다.
    if (this.cellsDirty) {
      this.cellsDirty = false;
      this.buildCells();
    }
  }

  // ───────── 게임 고르기 ─────────

  private addTabs(): void {
    const { rows, perRow } = tabRows(this.games.length);
    const size = rows > 1 ? TAB.many : TAB.one;
    const width = (CONTENT_WIDTH - TAB.gap * (perRow - 1)) / perRow;
    this.titleTop = TAB.top + rows * size.height + (rows - 1) * TAB.gap + TITLE.above;
    this.gridTop = this.titleTop + TITLE.height;
    this.games.forEach((game, index) => {
      const x = MARGIN + (index % perRow) * (width + TAB.gap);
      const top = TAB.top + Math.floor(index / perRow) * (size.height + TAB.gap);
      const selected = game === this.picked;
      const frame = this.add.graphics();
      const draw = (pressed: boolean): void => {
        frame.clear();
        drawPanel(frame, x, top, width, size.height, {
          fill: selected ? LOOK.tab.on : pressed ? THEME.dim : LOOK.tab.off,
          shadow: selected ? LOOK.tab.onShadow : undefined,
          radius: 10,
        });
      };
      draw(false);
      this.add
        .image(x + width / 2, top + size.iconTop + size.icon / 2, game.icon)
        .setDisplaySize(size.icon, size.icon);
      // 아이콘 아래에 그 게임에서 깬 단계 수를 적는다.
      addText(this, x + width / 2, top + size.countTop, String(clearedOf(store.data.stages, game.id)), {
        size: FONT_SIZE.small,
        color: selected ? THEME_CSS.inkDeep : THEME_CSS.sub,
        originX: 0.5,
      });
      addTapZone(this, x, top, width, size.height, draw, () => {
        if (selected) return;
        sfx.click();
        this.scene.restart({ gameId: game.id, quiet: true } satisfies StagesData);
      });
    });
  }

  private addTitle(): void {
    addText(this, MARGIN, this.titleTop, this.picked.title, { color: THEME_CSS.inkDeep });
    const cleared = clearedOf(store.data.stages, this.picked.id);
    addText(this, GAME_WIDTH - MARGIN, this.titleTop, `${cleared} / ${STAGE_LEVELS}단계`, {
      color: THEME_CSS.accent,
      originX: 1,
    });
  }

  // ───────── 단계 고르기 ─────────

  private addGrid(height: number): void {
    const available = height - this.gridTop - (FOOT.above + FOOT.button + FOOT.below);
    const rows = layoutPages(Math.ceil(STAGE_LEVELS / COLUMNS), available, ROW_STEP, PAGER_HEIGHT);
    this.layout = { perPage: rows.perPage * COLUMNS, pages: rows.pages };
    // 다음에 깰 단계가 있는 쪽을 연다. 다 깼으면 마지막 쪽이다.
    const focus = nextLevel(store.data.stages, this.picked.id) ?? STAGE_LEVELS;
    this.page = clampPage(pageOfIndex(focus - 1, this.layout.perPage), this.layout.pages);
    this.buildCells();
    if (this.layout.pages <= 1) return;

    const listHeight = rows.perPage * ROW_STEP;
    this.pager = new Pager(this, GAME_WIDTH / 2, this.gridTop + listHeight, (page) => this.showPage(page));
    this.pager.set(this.layout.pages, this.page);
    onSwipe(this, new Phaser.Geom.Rectangle(0, this.gridTop, GAME_WIDTH, listHeight), (direction) => {
      if (this.showPage(this.page + direction)) sfx.click();
    });
  }

  /** 다른 쪽으로 넘긴다. 실제로 넘어갔으면 true. */
  private showPage(page: number): boolean {
    const next = clampPage(page, this.layout.pages);
    if (next === this.page) return false;
    this.page = next;
    this.pager?.set(this.layout.pages, next);
    this.cellsDirty = true;
    return true;
  }

  private buildCells(): void {
    this.tweens.killTweensOf(this.cellObjects);
    for (const object of this.cellObjects) object.destroy();
    this.cellObjects = [];
    const first = this.page * this.layout.perPage + 1;
    const last = Math.min(STAGE_LEVELS, first + this.layout.perPage - 1);
    for (let level = first; level <= last; level += 1) {
      const index = level - first;
      const x = MARGIN + (index % COLUMNS) * (CELL_WIDTH + CELL.gap);
      const y = this.gridTop + Math.floor(index / COLUMNS) * ROW_STEP;
      this.addCell(level, x, y);
    }
  }

  private addCell(level: number, x: number, y: number): void {
    const progress = store.data.stages;
    const cleared = level <= clearedOf(progress, this.picked.id);
    const open = isUnlocked(progress, this.picked.id, level);
    const look = cleared ? LOOK.cleared : open ? LOOK.next : LOOK.locked;

    const cell = this.add.container(x, y);
    const frame = this.add.graphics();
    const draw = (pressed: boolean): void => {
      frame.clear();
      drawPanel(frame, 0, 0, CELL_WIDTH, CELL.height, {
        fill: pressed && open ? THEME.dim : look.fill,
        shadow: look.shadow,
        radius: 9,
        depth: 2,
      });
      // 열 단계마다 있는 고비는 아직 깨지 않았으면 코인을 더 준다는 뜻으로 금색 점을 찍는다.
      if (!cleared && level % MILESTONE_EVERY === 0) {
        frame.fillStyle(LOOK.milestone, 1);
        frame.fillCircle(CELL_WIDTH - 7, 7, 3);
      }
    };
    draw(false);
    const label = addText(this, CELL_WIDTH / 2, CELL.height / 2, String(level), {
      color: look.text,
      originX: 0.5,
      originY: 0.5,
    });
    cell.add([frame, label]);
    this.cellObjects.push(cell);

    // 다음에 깰 단계는 살짝 들썩여서 눈에 띄게 한다.
    if (open && !cleared) {
      this.tweens.add({
        targets: cell,
        y: y - 2,
        duration: 420,
        ease: 'Sine.InOut',
        yoyo: true,
        repeat: -1,
      });
    }

    const zone = addTapZone(this, x, y, CELL_WIDTH, CELL.height, draw, () => {
      if (open) {
        this.play(level);
        return;
      }
      sfx.deny();
      this.tweens.add({
        targets: cell,
        x: { from: x - 2, to: x },
        duration: 60,
        repeat: 2,
        yoyo: true,
        onComplete: () => cell.setX(x),
      });
    });
    this.cellObjects.push(zone);
  }

  // ───────── 이어서 하기 ─────────

  private addContinue(height: number): void {
    const next = nextLevel(store.data.stages, this.picked.id);
    const y = height - FOOT.below - FOOT.button;
    if (next === null) {
      addText(this, GAME_WIDTH / 2, y + FOOT.button / 2, '모든 단계를 깼어요!', {
        color: THEME_CSS.good,
        originX: 0.5,
        originY: 0.5,
      });
      return;
    }
    new PixelButton(this, {
      x: MARGIN,
      y,
      width: CONTENT_WIDTH,
      height: FOOT.button,
      label: next === 1 ? '1단계부터 시작하기' : `${next}단계 이어서 하기`,
      style: 'pink',
      onTap: () => this.play(next),
    });
  }

  private play(level: number): void {
    if (!this.picked.sceneKey) return;
    sfx.click();
    vibrate(8);
    fadeToScene(this, this.picked.sceneKey, { stageLevel: level } satisfies StageStart);
  }
}
