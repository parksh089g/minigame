/**
 * 준비 화면: 가진 씨앗과 가장 멀리 지킨 날, 영구 강화를 사는 목록, 시작하는 날을 고르는 줄, 출발 버튼.
 * 목록이 화면보다 길면 쪽을 넘긴다. 강화를 누르면 목록 아래에 그 강화의 설명이 보인다.
 */
import Phaser from 'phaser';
import { GAME_WIDTH, THEME, THEME_CSS } from '../../config';
import { clampPage, layoutPages, pageSlice } from '../../core/paging';
import { sfx } from '../../core/sfx';
import { addBackdrop, addTapZone, addText, drawPanel, Pager, PAGER_HEIGHT, PixelButton } from '../../core/ui';
import { TEX, upgradeTexture } from './art';
import { UPGRADE_ORDER, UPGRADES, type UpgradeId } from './data';
import { buyUpgrade, effectLine, levelOf, startDays, upgradeCost, type GardenMeta } from './rules';

export interface LobbyHooks {
  getMeta: () => GardenMeta;
  setMeta: (meta: GardenMeta) => void;
  onStart: () => void;
  onBack: () => void;
}

const MARGIN = 8;
const WIDTH = GAME_WIDTH - MARGIN * 2;
/** 강화 한 줄의 높이와 줄 사이 */
const ROW = { height: 36, gap: 4 } as const;
const BUY = { width: 60, height: 26 } as const;
/** 목록의 위쪽 끝 */
const LIST_TOP = 76;
/** 목록 아래의 설명 칸 */
const INFO_HEIGHT = 30;
/** 맨 아래의 시작 줄: 시작하는 날을 고르는 칸과 출발 버튼 */
const FOOT = { height: 36, bottom: 8 } as const;
const STEPPER_WIDTH = 116;

/** 처음 하는 사람에게 기록 대신 보여 주는 두 줄 */
export const INTRO_LINES = '벌레 떼가 울타리를 넘지 못하게 물총으로 지켜요.\n판이 끝나도 씨앗과 강화는 그대로 남아요.';
/** 아직 아무 강화도 고르지 않았을 때 설명 칸에 적는 말 */
export const INFO_HINT = '강화를 누르면 설명이 보여요';
export const START_LABEL = '출발!';
/** 시작하는 날을 바꿨을 때 설명 칸에 적는 말 */
export const START_DAY_INFO = '고른 날부터 시작해요.\n대장을 물리치면 그다음 날이 열려요.';

interface RowView {
  id: UpgradeId;
  panel: Phaser.GameObjects.Graphics;
  level: Phaser.GameObjects.Text;
  effect: Phaser.GameObjects.Text;
  button: Phaser.GameObjects.Graphics;
  seed: Phaser.GameObjects.Image;
  cost: Phaser.GameObjects.Text;
  nameRight: number;
  top: number;
  pressed: boolean;
  objects: Phaser.GameObjects.GameObject[];
}

/** 가진 씨앗을 보여 주는 알약 모양 칸. 오른쪽 끝이 right에 맞춰진다. */
class SeedCounter {
  private readonly panel: Phaser.GameObjects.Graphics;
  private readonly icon: Phaser.GameObjects.Image;
  private readonly amount: Phaser.GameObjects.Text;

  constructor(
    scene: Phaser.Scene,
    private readonly right: number,
    private readonly y: number,
    seeds: number,
  ) {
    this.panel = scene.add.graphics();
    this.icon = scene.add.image(0, y + 11, TEX.seed).setOrigin(0, 0.5);
    this.amount = addText(scene, 0, y + 11, '', { originY: 0.5 });
    this.set(seeds);
  }

  set(seeds: number): void {
    this.amount.setText(String(seeds));
    const width = Math.ceil(this.amount.width) + 30;
    const left = this.right - width;
    this.panel.clear();
    drawPanel(this.panel, left, this.y, width, 22, { depth: 2 });
    this.icon.setX(left + 5);
    this.amount.setX(left + 21);
  }
}

export function buildLobby(scene: Phaser.Scene, hooks: LobbyHooks): void {
  const { height } = scene.scale;
  let meta = hooks.getMeta();
  let page = 0;
  let picked: UpgradeId | null = null;
  let rows: RowView[] = [];

  addBackdrop(scene);
  new PixelButton(scene, {
    x: 8,
    y: 8,
    width: 26,
    height: 26,
    icon: 'icon-back',
    hitPadding: 6,
    onTap: hooks.onBack,
  });
  addText(scene, 42, 21, '텃밭 지키기', { size: 16, originY: 0.5 });
  const seeds = new SeedCounter(scene, GAME_WIDTH - MARGIN, 10, meta.seeds);

  // 기록 칸: 해 본 사람에게는 가장 멀리 지킨 날을, 처음 하는 사람에게는 무엇을 하는 게임인지를 보여 준다.
  drawPanel(scene.add.graphics(), MARGIN, 40, WIDTH, 30, { depth: 2, radius: 10 });
  if (meta.runs > 0) {
    addText(scene, MARGIN + 10, 55, meta.best > 0 ? `최고 ${meta.best}일째` : '아직 하루도 못 지켰어요', {
      color: THEME_CSS.accent,
      originY: 0.5,
    });
    addText(scene, GAME_WIDTH - MARGIN - 10, 55, `${meta.runs}판 · 벌레 ${meta.kills}마리`, {
      size: 10,
      color: THEME_CSS.sub,
      originX: 1,
      originY: 0.5,
    });
  } else {
    addText(scene, GAME_WIDTH / 2, 55, INTRO_LINES, {
      size: 10,
      color: THEME_CSS.sub,
      originX: 0.5,
      originY: 0.5,
      align: 'center',
      lineSpacing: 1,
    });
  }

  // 아래에서부터 자리를 잡는다: 시작 줄, 설명 칸, (쪽이 나뉘면) 쪽 넘김 줄, 그 위가 목록이다.
  const footTop = height - FOOT.bottom - FOOT.height;
  const infoTop = footTop - INFO_HEIGHT - 4;
  const layout = layoutPages(UPGRADE_ORDER.length, infoTop - LIST_TOP, ROW.height + ROW.gap, PAGER_HEIGHT);
  const pager = new Pager(scene, GAME_WIDTH / 2, infoTop - PAGER_HEIGHT, (next) => {
    page = clampPage(next, layout.pages);
    drawList();
  });

  const infoPanel = scene.add.graphics();
  drawPanel(infoPanel, MARGIN, infoTop, WIDTH, INFO_HEIGHT - 3, { fill: THEME.butterSoft, shadow: null, radius: 9 });
  const info = addText(scene, GAME_WIDTH / 2, infoTop + (INFO_HEIGHT - 3) / 2, INFO_HINT, {
    size: 10,
    color: THEME_CSS.ink,
    originX: 0.5,
    originY: 0.5,
    align: 'center',
    wrapWidth: WIDTH - 16,
    lineSpacing: 1,
  });
  const showInfo = (id: UpgradeId | null): void => {
    picked = id;
    info.setText(id ? UPGRADES[id].blurb : INFO_HINT);
    for (const row of rows) drawRow(row);
  };

  const drawRow = (row: RowView): void => {
    const level = levelOf(meta.levels, row.id);
    const def = UPGRADES[row.id];
    const cost = upgradeCost(row.id, level);
    const affordable = cost !== null && meta.seeds >= cost;
    row.panel.clear();
    drawPanel(row.panel, MARGIN, row.top, WIDTH, ROW.height, {
      depth: 2,
      radius: 10,
      border: picked === row.id ? THEME.pinkDeep : undefined,
    });
    row.level.setText(level >= def.maxLevel ? '끝' : `${level}단계`).setX(row.nameRight + 5);
    row.effect.setText(effectLine(row.id, level));

    const x = MARGIN + WIDTH - BUY.width - 6;
    const y = row.top + (ROW.height - BUY.height) / 2;
    const offset = row.pressed && affordable ? 2 : 0;
    row.button.clear();
    if (cost === null) {
      row.seed.setVisible(false);
      row.cost.setText('다 올림').setColor(THEME_CSS.good).setPosition(x + BUY.width / 2, y + BUY.height / 2);
      row.cost.setOrigin(0.5, 0.5);
      return;
    }
    row.button.fillStyle(affordable ? THEME.pinkDeep : THEME.shadow, 1);
    row.button.fillRoundedRect(x, y + 3, BUY.width, BUY.height - 3, 10);
    row.button.fillStyle(affordable ? THEME.pink : THEME.dim, 1);
    row.button.fillRoundedRect(x, y + offset, BUY.width, BUY.height - 3, 10);
    const middle = y + offset + (BUY.height - 3) / 2;
    row.cost
      .setText(String(cost))
      .setColor(affordable ? THEME_CSS.inkDeep : THEME_CSS.faint)
      .setOrigin(0, 0.5);
    // 씨앗 그림과 값을 한 덩어리로 가운데에 놓는다.
    const span = 14 + 2 + row.cost.width;
    const left = x + (BUY.width - span) / 2;
    row.seed.setVisible(true).setPosition(left + 7, middle).setAlpha(affordable ? 1 : 0.55);
    row.cost.setPosition(Math.round(left + 16), Math.round(middle));
  };

  const buy = (id: UpgradeId): void => {
    const next = buyUpgrade(meta, id);
    showInfo(id);
    if (next === meta) {
      sfx.deny();
      return;
    }
    meta = next;
    hooks.setMeta(next);
    sfx.coin();
    seeds.set(meta.seeds);
    for (const row of rows) drawRow(row);
  };

  const drawList = (): void => {
    for (const row of rows) for (const object of row.objects) object.destroy();
    rows = [];
    pager.set(layout.pages, page);
    pageSlice(UPGRADE_ORDER, page, layout.perPage).forEach((id, index) => {
      const top = LIST_TOP + index * (ROW.height + ROW.gap);
      const panel = scene.add.graphics();
      const icon = scene.add.image(MARGIN + 19, top + ROW.height / 2, upgradeTexture(id));
      const name = addText(scene, MARGIN + 36, top + 5, UPGRADES[id].name);
      const level = addText(scene, 0, top + 7, '', { size: 10, color: THEME_CSS.sub });
      const effect = addText(scene, MARGIN + 36, top + 21, '', { size: 10, color: THEME_CSS.sub });
      const button = scene.add.graphics();
      const seed = scene.add.image(0, 0, TEX.seed);
      const cost = addText(scene, 0, 0, '', { originY: 0.5 });
      const row: RowView = {
        id,
        panel,
        level,
        effect,
        button,
        seed,
        cost,
        nameRight: name.x + name.width,
        top,
        pressed: false,
        objects: [panel, icon, name, level, effect, button, seed, cost],
      };
      // 줄의 왼쪽을 누르면 설명만 보이고, 오른쪽의 값 버튼을 누르면 산다.
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

  // 시작 줄: 대장을 물리쳐서 뒤쪽 날이 열렸으면 시작하는 날을 고르는 칸이 왼쪽에 생긴다.
  const days = startDays(meta.best);
  const hasStepper = days.length > 1;
  const startX = hasStepper ? MARGIN + STEPPER_WIDTH + 6 : MARGIN;
  new PixelButton(scene, {
    x: startX,
    y: footTop,
    width: GAME_WIDTH - MARGIN - startX,
    height: FOOT.height,
    label: START_LABEL,
    style: 'pink',
    onTap: hooks.onStart,
  });
  if (!hasStepper) return;

  drawPanel(scene.add.graphics(), MARGIN, footTop, STEPPER_WIDTH, FOOT.height - 3, { depth: 3, radius: 12 });
  const dayLabel = addText(scene, MARGIN + STEPPER_WIDTH / 2, footTop + (FOOT.height - 3) / 2, '', {
    originX: 0.5,
    originY: 0.5,
  });
  const arrow = { width: 26, height: 24 } as const;
  const arrowY = footTop + (FOOT.height - 3 - arrow.height) / 2;
  const step = (by: number): void => {
    const at = days.indexOf(meta.startDay);
    const next = days[Math.min(days.length - 1, Math.max(0, at + by))];
    if (next === meta.startDay) return;
    meta = { ...meta, startDay: next };
    hooks.setMeta(meta);
    drawStepper();
    showInfo(null);
    info.setText(START_DAY_INFO);
  };
  const prev = new PixelButton(scene, {
    x: MARGIN + 4,
    y: arrowY,
    ...arrow,
    icon: 'icon-prev',
    hitPadding: 5,
    onTap: () => step(-1),
  });
  const next = new PixelButton(scene, {
    x: MARGIN + STEPPER_WIDTH - arrow.width - 4,
    y: arrowY,
    ...arrow,
    icon: 'icon-play',
    hitPadding: 5,
    onTap: () => step(1),
  });
  const drawStepper = (): void => {
    const at = days.indexOf(meta.startDay);
    dayLabel.setText(`${meta.startDay}일째`);
    prev.setEnabled(at > 0);
    next.setEnabled(at < days.length - 1);
  };
  drawStepper();
}
