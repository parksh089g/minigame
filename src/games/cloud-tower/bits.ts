/**
 * 구름 탑 모험의 화면들이 같이 쓰는 작은 부품: 위쪽 줄, 카드 한 줄, 큰 줄 버튼, 쪽으로 나뉜 목록.
 */
import Phaser from 'phaser';
import { GAME_WIDTH } from '../../config';
import { clampPage, layoutPages, pageSlice } from '../../core/paging';
import { addTapZone, addText, drawPanel, Pager, PAGER_HEIGHT, type PanelColors } from '../../core/ui';
import { CARD_COLOR, cardTypeTexture, PX, PX_CSS, TEX } from './art';
import { CARDS, RARITY_NAME, type CardId } from './data';
import type { RunState } from './run';
import { actOf } from './run';
import { cardName, cardText, cardTypeName, type CardTextContext } from './text';
import { ACT_NAMES } from './data';

export const MARGIN = 8;
export const WIDTH = GAME_WIDTH - MARGIN * 2;
/** 위쪽 줄의 높이. 이 아래부터 화면의 내용이다. */
export const TOP_BAR = 34;

/** 화면마다 쓰는 깊이 */
export const DEPTH = { back: -10, base: 0, float: 20, overlay: 30 } as const;

/**
 * 판의 색을 등불지기처럼 어둡게 칠한다: 짙은 남색 판, 회청색 테두리, 검은 그림자, 작은 모서리.
 * 값을 주면 그 값을 쓴다.
 */
export function pxPanel(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  width: number,
  height: number,
  colors: PanelColors = {},
): Phaser.GameObjects.Graphics {
  drawPanel(graphics, x, y, width, height, {
    fill: PX.panel,
    border: PX.edge,
    shadow: PX.ink,
    ...colors,
    radius: Math.min(colors.radius ?? 6, 6),
  });
  return graphics;
}

/** 구역마다의 밤하늘: 위는 짙은 색, 아래로 갈수록 검게. 작은 별을 몇 개 띄운다. */
const SKY: readonly (readonly [number, number])[] = [
  [0x29366f, 0x1a1c2c],
  [0x5d275d, 0x1a1c2c],
  [0x257179, 0x1a1c2c],
];

export function drawSky(scene: Phaser.Scene, act: number): void {
  const { height } = scene.scale;
  const g = scene.add.graphics().setDepth(DEPTH.back);
  const [top, bottom] = SKY[act] ?? SKY[0];
  // 띠를 몇 줄로 나눠 칠해서 픽셀 느낌의 계단 그러데이션을 만든다.
  const bands = 8;
  const from = Phaser.Display.Color.ValueToColor(top);
  const to = Phaser.Display.Color.ValueToColor(bottom);
  for (let i = 0; i < bands; i += 1) {
    const mixed = Phaser.Display.Color.Interpolate.ColorWithColor(from, to, bands - 1, i);
    g.fillStyle(Phaser.Display.Color.GetColor(mixed.r, mixed.g, mixed.b), 1);
    g.fillRect(0, Math.floor((height * i) / bands), GAME_WIDTH, Math.ceil(height / bands) + 1);
  }
  // 별: 자리를 고정해서 화면이 바뀌어도 그대로 있다.
  const stars: readonly (readonly [number, number, number])[] = [
    [18, 46, 0xf4f4f4],
    [64, 80, 0x94b0c2],
    [210, 60, 0xffcd75],
    [150, 104, 0x94b0c2],
    [226, 150, 0xf4f4f4],
    [12, 190, 0x94b0c2],
    [100, 40, 0x73eff7],
    [180, 220, 0x94b0c2],
    [40, 300, 0xf4f4f4],
    [222, 340, 0x94b0c2],
  ];
  for (const [x, y, color] of stars) {
    g.fillStyle(color, 0.8);
    g.fillRect(x, y, 2, 2);
  }
}

/** 작은 알약 칸에 아이콘과 수를 보여 준다. 오른쪽 끝이 right에 맞춰진다. 칸의 왼쪽 끝을 돌려준다. */
export function addPill(scene: Phaser.Scene, right: number, y: number, texture: string, label: string, color: string = PX_CSS.text): number {
  const text = addText(scene, 0, y + 10, label, { color, originY: 0.5 });
  const width = Math.ceil(text.width) + 24;
  const left = right - width;
  const panel = scene.add.graphics();
  pxPanel(panel, left, y, width, 20, { depth: 2, radius: 10 });
  text.setX(left + 19).setDepth(1);
  scene.add.image(left + 10, y + 10, texture).setDepth(1);
  panel.setDepth(0);
  return left;
}

/** 판의 위쪽 줄: 일시정지 버튼 자리 옆에 층과 구역, 오른쪽에 체력과 별사탕 */
export function drawTopBar(scene: Phaser.Scene, run: RunState): void {
  const floor = Math.max(1, run.floor);
  addText(scene, 40, 14, `${floor}층`, { size: 14, color: PX_CSS.text, originY: 0.5 });
  addText(scene, 40, 29, ACT_NAMES[actOf(floor)], { size: 9, color: PX_CSS.sub, originY: 0.5 });
  const goldLeft = addPill(scene, GAME_WIDTH - MARGIN, 8, TEX.candy, String(run.gold), PX_CSS.accent);
  addPill(scene, goldLeft - 4, 8, TEX.heart, `${run.hp}/${run.maxHp}`, PX_CSS.bad);
}

/** 카드 한 장을 한 줄로 보여 준다: 왼쪽에 마력과 갈래 아이콘, 가운데 이름과 설명, 오른쪽은 비워 둔다(right만큼). */
export interface CardRowOptions {
  x: number;
  y: number;
  width: number;
  height?: number;
  id: CardId;
  up: boolean;
  /** 오른쪽에 비워 둘 폭. 값이나 버튼을 놓는다. */
  right?: number;
  dim?: boolean;
  picked?: boolean;
  ctx?: CardTextContext | null;
  onTap?: () => void;
}

export const CARD_ROW_HEIGHT = 44;

export function addCardRow(scene: Phaser.Scene, options: CardRowOptions): Phaser.GameObjects.GameObject[] {
  const { x, y, width, id, up } = options;
  const height = options.height ?? CARD_ROW_HEIGHT;
  const def = CARDS[id];
  const color = CARD_COLOR[def.type];
  const objects: Phaser.GameObjects.GameObject[] = [];
  const panel = scene.add.graphics();
  objects.push(panel);
  const draw = (pressed: boolean): void => {
    panel.clear();
    const offset = pressed ? 1 : 0;
    pxPanel(panel, x, y + offset, width, height, {
      depth: 2,
      radius: 9,
      border: options.picked ? PX.yellow : def.rarity === 'rare' ? PX.yellow : undefined,
      fill: options.dim ? PX.ink : PX.panel,
    });
    panel.fillStyle(color.face, options.dim ? 0.5 : 1);
    panel.fillRect(x + 4, y + 4 + offset, 30, height - 8);
  };
  draw(false);
  const alpha = options.dim ? 0.55 : 1;
  objects.push(scene.add.image(x + 19, y + height / 2 + 5, cardTypeTexture(def.type)).setScale(0.7).setAlpha(alpha));
  // 마력은 왼쪽 위의 동그라미
  const bubble = scene.add.graphics();
  bubble.fillStyle(PX.navy, alpha);
  bubble.fillCircle(x + 12, y + 12, 8);
  bubble.fillStyle(PX.blue, alpha);
  bubble.fillCircle(x + 12, y + 11, 7);
  objects.push(bubble);
  objects.push(
    addText(scene, x + 12, y + 11, String(def.cost[up ? 1 : 0]), { size: 11, color: PX_CSS.text, originX: 0.5, originY: 0.5 }).setAlpha(alpha),
  );
  const textLeft = x + 40;
  const textWidth = width - 44 - (options.right ?? 0);
  const name = addText(scene, textLeft, y + 5, cardName(id, up), {
    size: 12,
    color: up ? PX_CSS.good : PX_CSS.text,
  }).setAlpha(alpha);
  objects.push(name);
  objects.push(
    addText(scene, name.x + name.width + 4, y + 7, `${cardTypeName(id)} · ${RARITY_NAME[def.rarity]}`, {
      size: 9,
      color: PX_CSS.faint,
    }).setAlpha(alpha),
  );
  const body = addText(scene, textLeft, y + 21, cardText(id, up, options.ctx ?? null), {
    size: 10,
    color: PX_CSS.sub,
    wrapWidth: textWidth,
    lineSpacing: 0,
  }).setAlpha(alpha);
  // 두 줄을 넘으면 칸에 들어가게 줄인다.
  const room = height - 23;
  if (body.height > room) body.setScale(room / body.height);
  objects.push(body);
  if (options.onTap) objects.push(addTapZone(scene, x, y, width, height, draw, options.onTap));
  return objects;
}

/** 아이콘과 두 줄 글을 가진 넓은 줄. 갈림길의 길, 보물, 수상한 길의 고르기에 쓴다. */
export interface WideRowOptions {
  x?: number;
  y: number;
  width?: number;
  height: number;
  texture?: string;
  title: string;
  note: string;
  /** 오른쪽 끝의 작은 글(값 같은 것) */
  side?: string;
  sideColor?: string;
  dim?: boolean;
  fill?: number;
  border?: number;
  onTap?: () => void;
}

export function addWideRow(scene: Phaser.Scene, options: WideRowOptions): Phaser.GameObjects.GameObject[] {
  const x = options.x ?? MARGIN;
  const width = options.width ?? WIDTH;
  const { y, height } = options;
  const objects: Phaser.GameObjects.GameObject[] = [];
  const panel = scene.add.graphics();
  objects.push(panel);
  const draw = (pressed: boolean): void => {
    panel.clear();
    pxPanel(panel, x, y + (pressed ? 1 : 0), width, height, {
      depth: 3,
      radius: 11,
      fill: options.dim ? PX.ink : (options.fill ?? PX.panel),
      border: options.border,
    });
  };
  draw(false);
  const alpha = options.dim ? 0.5 : 1;
  let left = x + 10;
  if (options.texture) {
    objects.push(scene.add.image(x + 22, y + height / 2, options.texture).setAlpha(alpha));
    left = x + 40;
  }
  const sideText = options.side
    ? addText(scene, x + width - 10, y + height / 2, options.side, {
        color: options.sideColor ?? PX_CSS.accent,
        originX: 1,
        originY: 0.5,
      }).setAlpha(alpha)
    : null;
  const textWidth = x + width - left - 10 - (sideText ? sideText.width + 6 : 0);
  const title = addText(scene, left, y + height / 2 - 1, options.title, {
    size: 13,
    color: PX_CSS.text,
    originY: 1,
  }).setAlpha(alpha);
  if (title.width > textWidth) title.setScale(textWidth / title.width);
  const note = addText(scene, left, y + height / 2 + 2, options.note, {
    size: 10,
    color: PX_CSS.sub,
    wrapWidth: textWidth,
    lineSpacing: 0,
  }).setAlpha(alpha);
  const room = height / 2 - 4;
  if (note.height > room) note.setScale(room / note.height);
  objects.push(title, note);
  if (sideText) objects.push(sideText);
  if (options.onTap) objects.push(addTapZone(scene, x, y, width, height, draw, options.onTap));
  return objects;
}

/**
 * 쪽으로 나뉘는 목록. top에서 bottom 사이에 rowHeight짜리 줄을 놓고, 넘치면 아래에 쪽 넘김 줄을 둔다.
 * build는 그 쪽에 놓일 항목과 줄의 위쪽 y를 받아 그린 것들을 돌려준다.
 */
export class PagedList<T> {
  private page = 0;
  private objects: Phaser.GameObjects.GameObject[] = [];
  private readonly pager: Pager;
  private readonly perPage: number;
  private readonly pages: number;

  constructor(
    scene: Phaser.Scene,
    private readonly items: readonly T[],
    private readonly top: number,
    bottom: number,
    private readonly rowHeight: number,
    private readonly gap: number,
    private readonly build: (item: T, y: number, index: number) => Phaser.GameObjects.GameObject[],
    startPage = 0,
  ) {
    const layout = layoutPages(items.length, bottom - top, rowHeight + gap, PAGER_HEIGHT);
    this.perPage = layout.perPage;
    this.pages = layout.pages;
    this.pager = new Pager(scene, GAME_WIDTH / 2, bottom - PAGER_HEIGHT, (next) => this.show(next));
    this.show(startPage);
  }

  get current(): number {
    return this.page;
  }

  show(page: number): void {
    this.page = clampPage(page, this.pages);
    for (const object of this.objects) object.destroy();
    this.objects = [];
    const start = this.page * this.perPage;
    pageSlice(this.items, this.page, this.perPage).forEach((item, offset) => {
      const y = this.top + offset * (this.rowHeight + this.gap);
      this.objects.push(...this.build(item, y, start + offset));
    });
    this.pager.set(this.pages, this.page);
  }
}

/** 화면 가운데에 큰 제목 한 줄과 그 아래 작은 줄 */
export function addHeading(scene: Phaser.Scene, y: number, title: string, sub?: string): void {
  addText(scene, GAME_WIDTH / 2, y, title, { size: 18, color: PX_CSS.text, originX: 0.5, originY: 0.5 });
  if (sub) addText(scene, GAME_WIDTH / 2, y + 18, sub, { size: 10, color: PX_CSS.sub, originX: 0.5, originY: 0.5, align: 'center' });
}
