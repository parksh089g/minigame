/**
 * 유물 화면: 가진 유물 조각과, 유물을 강화하는 목록. 준비 화면(lobby.ts)의 "유물" 버튼이 연다.
 * 줄의 모양은 준비 화면의 강화 목록과 같다(shop-row.ts). 유물을 누르면 목록 아래에 그 유물의 설명이 보인다.
 * 무엇이 얼마나 바뀌는지는 rules.ts와 data.ts가 정하고, 여기는 그리기만 한다.
 */
import type Phaser from 'phaser';
import { GAME_WIDTH, THEME, THEME_CSS } from '../../config';
import { clampPage, layoutPages, pageSlice } from '../../core/paging';
import { sfx } from '../../core/sfx';
import { addTapZone, addText, drawPanel, Pager, PAGER_HEIGHT, PixelButton } from '../../core/ui';
import { relicTexture, TEX } from './art';
import { RELIC_ORDER, RELICS, type RelicId } from './data';
import { buyRelic, canBuyRelic, relicCost, relicLevel, relicLine, type GardenMeta } from './rules';
import { BUY, drawBuyButton, FOOT, INFO_HEIGHT, LIST_TOP, MARGIN, PillCounter, ROW, WIDTH } from './shop-row';

/** 준비 화면의 버튼과 이 화면의 머리글 */
export const RELIC_LABEL = '유물';
/** 머리글 아래에 늘 적어 두는 두 줄: 조각을 어디서 받는지와, 유물이 남는다는 것 */
export const RELIC_INTRO = '대장의 날을 지키면 유물 조각을 받아요.\n유물은 새 밭을 일궈도 그대로 남아요.';
/** 아직 아무 유물도 고르지 않았을 때 설명 칸에 적는 말 */
export const RELIC_HINT = '유물을 누르면 설명이 보여요';
export const RELIC_BACK = '준비 화면으로';

export interface RelicPageHooks {
  /**
   * 저장을 다시 읽은 뒤에 apply를 부른다. apply는 지금의 진행을 받아 바꾼 진행을 돌려주고(바꾸지 않았으면 받은 그대로),
   * 바뀌었으면 그것이 저장된다. 그사이 다른 곳이 저장한 것이 있으면 apply를 부르지 않고 준비 화면이 새 값으로 다시 열린다.
   */
  change: (apply: (meta: GardenMeta) => GardenMeta) => void;
  onClose: () => void;
}

interface RowView {
  id: RelicId;
  panel: Phaser.GameObjects.Graphics;
  level: Phaser.GameObjects.Text;
  effect: Phaser.GameObjects.Text;
  button: Phaser.GameObjects.Graphics;
  /** 값 단추의 유물 조각 그림 */
  icon: Phaser.GameObjects.Image;
  cost: Phaser.GameObjects.Text;
  nameRight: number;
  top: number;
  pressed: boolean;
  objects: Phaser.GameObjects.GameObject[];
}

export function buildRelicPage(scene: Phaser.Scene, initial: GardenMeta, hooks: RelicPageHooks): void {
  const { height } = scene.scale;
  let meta = initial;
  let page = 0;
  let picked: RelicId | null = null;
  let rows: RowView[] = [];

  new PixelButton(scene, {
    x: 8,
    y: 8,
    width: 26,
    height: 26,
    icon: 'icon-back',
    hitPadding: 6,
    onTap: hooks.onClose,
  });
  addText(scene, 42, 21, RELIC_LABEL, { size: 16, originY: 0.5 });
  const shards = new PillCounter(scene, GAME_WIDTH - MARGIN, 10, TEX.shard, meta.shards);

  drawPanel(scene.add.graphics(), MARGIN, 40, WIDTH, 30, { depth: 2, radius: 10 });
  addText(scene, GAME_WIDTH / 2, 55, RELIC_INTRO, {
    size: 10,
    color: THEME_CSS.sub,
    originX: 0.5,
    originY: 0.5,
    align: 'center',
    lineSpacing: 1,
  });

  // 아래에서부터 자리를 잡는다: 돌아가는 버튼, 설명 칸, (쪽이 나뉘면) 쪽 넘김 줄, 그 위가 목록이다.
  const footTop = height - FOOT.bottom - FOOT.height;
  const infoTop = footTop - INFO_HEIGHT - 4;
  const layout = layoutPages(RELIC_ORDER.length, infoTop - LIST_TOP, ROW.height + ROW.gap, PAGER_HEIGHT);
  const pager = new Pager(scene, GAME_WIDTH / 2, infoTop - PAGER_HEIGHT, (next) => {
    page = clampPage(next, layout.pages);
    drawList();
  });

  drawPanel(scene.add.graphics(), MARGIN, infoTop, WIDTH, INFO_HEIGHT, { fill: THEME.butterSoft, shadow: null, radius: 9 });
  const info = addText(scene, GAME_WIDTH / 2, infoTop + INFO_HEIGHT / 2, RELIC_HINT, {
    size: 10,
    color: THEME_CSS.ink,
    originX: 0.5,
    originY: 0.5,
    align: 'center',
    wrapWidth: WIDTH - 16,
    lineSpacing: 1,
  });

  const drawRow = (row: RowView): void => {
    const level = relicLevel(meta.relics, row.id);
    const cost = relicCost(row.id, level);
    row.panel.clear();
    drawPanel(row.panel, MARGIN, row.top, WIDTH, ROW.height, {
      depth: 2,
      radius: 10,
      border: picked === row.id ? THEME.pinkDeep : undefined,
    });
    row.level.setText(cost === null ? '끝' : `${level}단계`).setX(row.nameRight + 5);
    row.effect.setText(relicLine(row.id, level));
    drawBuyButton(row, row.top, cost === null ? null : String(cost), canBuyRelic(meta, row.id), row.pressed);
  };

  const showInfo = (id: RelicId): void => {
    picked = id;
    info.setText(RELICS[id].blurb);
    for (const row of rows) drawRow(row);
  };

  const buy = (id: RelicId): void =>
    hooks.change((fresh) => {
      const next = buyRelic(fresh, id);
      meta = next;
      if (next === fresh) sfx.deny();
      else sfx.coin();
      shards.set(meta.shards);
      showInfo(id);
      return next;
    });

  const drawList = (): void => {
    for (const row of rows) for (const object of row.objects) object.destroy();
    rows = [];
    pager.set(layout.pages, page);
    pageSlice(RELIC_ORDER, page, layout.perPage).forEach((id, index) => {
      const top = LIST_TOP + index * (ROW.height + ROW.gap);
      const panel = scene.add.graphics();
      const icon = scene.add.image(MARGIN + 19, top + ROW.height / 2, relicTexture(id));
      const name = addText(scene, MARGIN + 36, top + 5, RELICS[id].name);
      const level = addText(scene, 0, top + 7, '', { size: 10, color: THEME_CSS.sub });
      const effect = addText(scene, MARGIN + 36, top + 21, '', { size: 10, color: THEME_CSS.sub });
      const button = scene.add.graphics();
      const shard = scene.add.image(0, 0, TEX.shard);
      const cost = addText(scene, 0, 0, '', { originY: 0.5 });
      const row: RowView = {
        id,
        panel,
        level,
        effect,
        button,
        icon: shard,
        cost,
        nameRight: name.x + name.width,
        top,
        pressed: false,
        objects: [panel, icon, name, level, effect, button, shard, cost],
      };
      // 줄의 왼쪽을 누르면 설명만 보이고, 오른쪽의 값 단추를 누르면 강화한다.
      const pickZone = addTapZone(
        scene,
        MARGIN,
        top,
        WIDTH - BUY.width - 10,
        ROW.height,
        () => {},
        () => {
          sfx.click();
          showInfo(id);
        },
      );
      const buyZone = addTapZone(
        scene,
        MARGIN + WIDTH - BUY.width - 10,
        top,
        BUY.width + 10,
        ROW.height,
        (pressed) => {
          row.pressed = pressed;
          drawRow(row);
        },
        () => buy(id),
      );
      row.objects.push(pickZone, buyZone);
      rows.push(row);
      drawRow(row);
    });
  };
  drawList();

  new PixelButton(scene, {
    x: MARGIN,
    y: footTop,
    width: WIDTH,
    height: FOOT.height,
    label: RELIC_BACK,
    style: 'neutral',
    onTap: hooks.onClose,
  });
}
