/**
 * 구름 탑 모험 전용 그림. 공용 art/ 폴더를 건드리지 않도록 이 게임 안에서 만든다.
 * 등불지기처럼 픽셀 그림(sprites.ts의 문자열)을 어두운 바탕에 놓는다. 크기는 모두 논리 픽셀이다.
 * 기기의 화면 밀도에 맞춰 한 칸을 정수 개의 실제 픽셀로 칠해서, 확대해도 칸이 번지지 않는다.
 */
import Phaser from 'phaser';
import { COLOR, PALETTE } from '../../config';
import { addHiResCanvas, renderScale } from '../../core/hidpi';
import type { CardType, EnemyLook, NodeKind, RelicId, StatusId, TreasureId, UpgradeId } from './data';
import {
  CARD_TYPE_ROWS,
  FOES,
  HERO,
  ITEM_ROWS,
  NODE_ROWS,
  placeIn,
  RELIC_ROWS,
  STATUS_ROWS,
  TREASURE_ROWS,
  UPGRADE_ROWS,
  withOutline,
  type Rows,
} from './sprites';

/** 도형에 쓰는 색. 모두 등불지기와 같은 팔레트에서 고른다. */
export const PX = {
  ink: COLOR.ink,
  night: COLOR.charcoal,
  panel: COLOR.charcoal,
  panelHi: 0x3d4766,
  edge: COLOR.slate,
  navy: COLOR.navy,
  plum: COLOR.plum,
  red: COLOR.red,
  orange: COLOR.orange,
  yellow: COLOR.yellow,
  lime: COLOR.lime,
  green: COLOR.green,
  teal: COLOR.teal,
  blue: COLOR.blue,
  sky: COLOR.sky,
  cyan: COLOR.cyan,
  white: COLOR.white,
  silver: COLOR.silver,
  slate: COLOR.slate,
} as const;

/** 글자에 쓰는 색 */
export const PX_CSS = {
  text: PALETTE[12],
  sub: PALETTE[13],
  faint: '#7d93ab',
  accent: PALETTE[4],
  good: PALETTE[5],
  bad: PALETTE[3],
  sky: PALETTE[11],
  dark: PALETTE[0],
} as const;

/** 화면(Phaser 도형)에서 쓰는 색 */
export const LOOK = {
  hpBack: PX.ink,
  hpFill: PX.red,
  hpMe: PX.green,
  block: PX.sky,
  selected: PX.yellow,
} as const;

export const CARD_COLOR: Readonly<Record<CardType, { face: number; deep: number }>> = {
  attack: { face: PX.red, deep: PX.plum },
  skill: { face: PX.blue, deep: PX.navy },
  power: { face: PX.green, deep: PX.teal },
};

export const enemyTexture = (look: EnemyLook): string => `ct-foe-${look}`;
export const statusTexture = (id: StatusId): string => `ct-st-${id}`;
export const nodeTexture = (kind: NodeKind): string => `ct-node-${kind}`;
export const treasureTexture = (id: TreasureId): string => `ct-tr-${id}`;
export const upgradeTexture = (id: UpgradeId): string => `ct-up-${id}`;
export const relicTexture = (id: RelicId): string => `ct-relic-${id}`;
export const cardTypeTexture = (type: CardType): string => `ct-type-${type}`;

export const TEX = {
  bunny: 'ct-bunny',
  candy: 'ct-candy',
  shard: 'ct-shard',
  mana: 'ct-mana',
  heart: 'ct-heart',
  shield: 'ct-shield',
  sword: 'ct-sword',
  buff: 'ct-buff',
  debuff: 'ct-debuff',
  deck: 'ct-deck',
  discard: 'ct-discard',
  spark: 'ct-spark',
} as const;

// ───────── 등록 ─────────

/** 테두리를 붙인 그림을 논리 크기 width × height로 등록한다. */
function addRows(scene: Phaser.Scene, key: string, rows: Rows, width: number, height: number): void {
  if (scene.textures.exists(key)) return;
  const cellsX = rows[0].length;
  const cellsY = rows.length;
  const cell = Math.max(1, Math.ceil((Math.max(width / cellsX, height / cellsY) * renderScale())));
  const canvas = document.createElement('canvas');
  canvas.width = cellsX * cell;
  canvas.height = cellsY * cell;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D 캔버스를 만들 수 없습니다.');
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      const index = Number.parseInt(row[x], 16);
      if (Number.isNaN(index)) continue;
      context.fillStyle = PALETTE[index];
      context.fillRect(x * cell, y * cell, cell, cell);
    }
  });
  addHiResCanvas(scene.textures, key, canvas, width, height);
  scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
}

/** 작은 그림: 9칸 그림에 테두리를 붙여 11칸 정사각형에 놓는다. */
const icon = (rows: Rows): Rows => withOutline(placeIn(rows, 9, false));

/** 기존 화면 배치에 맞춘 논리 크기 */
const SIZE = {
  foe: 48,
  status: 12,
  node: 26,
  treasure: 22,
  upgrade: 22,
  type: 22,
} as const;
const ITEM_SIZE: Readonly<Record<keyof typeof ITEM_ROWS, number>> = {
  candy: 13,
  shard: 13,
  mana: 24,
  heart: 12,
  shield: 13,
  sword: 13,
  buff: 12,
  debuff: 12,
  deck: 15,
  discard: 15,
  spark: 10,
};

export function registerTowerTextures(scene: Phaser.Scene): void {
  const hero = withOutline(HERO);
  addRows(scene, TEX.bunny, hero, (hero[0].length * 8) / 3, (hero.length * 8) / 3);
  for (const [look, rows] of Object.entries(FOES)) {
    addRows(scene, enemyTexture(look as EnemyLook), withOutline(placeIn(rows, 16, true)), SIZE.foe, SIZE.foe);
  }
  for (const [id, rows] of Object.entries(STATUS_ROWS)) addRows(scene, statusTexture(id as StatusId), icon(rows), SIZE.status, SIZE.status);
  for (const [kind, rows] of Object.entries(NODE_ROWS)) addRows(scene, nodeTexture(kind as NodeKind), icon(rows), SIZE.node, SIZE.node);
  for (const [id, rows] of Object.entries(TREASURE_ROWS)) addRows(scene, treasureTexture(id as TreasureId), icon(rows), SIZE.treasure, SIZE.treasure);
  for (const [id, rows] of Object.entries(UPGRADE_ROWS)) addRows(scene, upgradeTexture(id as UpgradeId), icon(rows), SIZE.upgrade, SIZE.upgrade);
  for (const [id, rows] of Object.entries(RELIC_ROWS)) addRows(scene, relicTexture(id as RelicId), icon(rows), SIZE.upgrade, SIZE.upgrade);
  for (const [type, rows] of Object.entries(CARD_TYPE_ROWS)) addRows(scene, cardTypeTexture(type as CardType), icon(rows), SIZE.type, SIZE.type);
  for (const [name, rows] of Object.entries(ITEM_ROWS)) {
    const size = ITEM_SIZE[name as keyof typeof ITEM_ROWS];
    addRows(scene, TEX[name as keyof typeof ITEM_ROWS], icon(rows), size, size);
  }
}
