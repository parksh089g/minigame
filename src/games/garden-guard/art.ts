/**
 * 텃밭 지키기 전용 그림. 공용 art/ 폴더를 건드리지 않도록 이 게임 안에서 만든다.
 * 캔버스에 곡선으로 그려 텍스처로 등록한다. 크기는 모두 논리 픽셀이다.
 * 벌레는 아래(울타리 쪽)를 보고 내려오므로 얼굴이 아래쪽에 있다.
 */
import type Phaser from 'phaser';
import { THEME, THEME_CSS } from '../../config';
import { addHiResCanvas, renderScale } from '../../core/hidpi';
import type { EnemyKind, UpgradeId } from './data';

type Ctx = CanvasRenderingContext2D;

interface Art {
  width: number;
  height: number;
  /** 그릴 때 쓰는 좌표의 크기. 없으면 width × height */
  view?: readonly [number, number];
  draw: (c: Ctx) => void;
}

const INK = THEME_CSS.inkDeep;
const WHITE = '#ffffff';
const BLUSH = '#ffb3c4';
const WATER = '#7dbef2';
const WATER_DEEP = '#5aa3e0';
const LEAF = '#7fd3ae';
const LEAF_DEEP = '#57b98f';
const WOOD = '#f3cfa6';
const WOOD_DEEP = '#d9a878';

/** 화면(Phaser 도형)에서 쓰는 색 */
export const LOOK = {
  /** 풀밭과 그 위의 풀 포기 */
  grass: 0xe4f5dc,
  tuft: 0xc8e8bb,
  /** 울타리 아래 텃밭의 흙과 이랑 */
  soil: 0xf0d6bd,
  furrow: 0xe2c0a2,
  /** 울타리의 나무와 그 그늘 */
  wood: 0xf3cfa6,
  woodDeep: 0xd9a878,
  /** 울타리 체력 막대 */
  barBack: THEME.shadow,
  barGood: THEME.mintDeep,
  barWarn: THEME.gold,
  barBad: THEME.coral,
  /** 벌레의 작은 체력 막대 */
  hpBack: 0x5b4455,
  hpFill: THEME.coral,
  hpBoss: THEME.lilacDeep,
  /** 찬물에 젖은 벌레에 입히는 색 */
  chilled: 0xbfe3ff,
  /** 튀는 물방울과 터지는 조각 */
  drop: 0x7dbef2,
  dropLight: 0xcfe9ff,
  crit: THEME.gold,
  shell: 0xb9b3c9,
  seed: 0xe6b56e,
  bite: THEME.coral,
} as const;

/** 벌레를 쫓아냈을 때 튀는 조각의 색 */
export const ENEMY_TINT: Readonly<Record<EnemyKind, number>> = {
  ant: 0xc59a86,
  ladybug: 0xff8f8f,
  snail: 0xc9bcf8,
  bee: 0xffd866,
  hopper: 0xa8e6a1,
  beetle: 0x8fa3e8,
  mosquito: 0xb9b0d9,
  digger: 0xd1ab84,
  mole: 0xb79f93,
  rhino: 0x9b87d6,
};

export const enemyTexture = (kind: EnemyKind): string => `gg-${kind}`;
export const upgradeTexture = (id: UpgradeId): string => `gg-up-${id}`;
export const TEX = {
  drop: 'gg-drop',
  dropCrit: 'gg-drop-crit',
  pip: 'gg-pip',
  seed: 'gg-seed',
  sunflower: 'gg-sunflower',
  gun: 'gg-gun',
  storm: 'gg-storm',
  /** 땅강아지가 땅속에 숨어 지나가는 동안 보이는 흙더미 */
  mound: 'gg-mound',
} as const;

// ───────── 그리기 도구 ─────────

function fill(c: Ctx, d: string, color: string): void {
  c.fillStyle = color;
  c.fill(new Path2D(d));
}

function stroke(c: Ctx, d: string, color: string, width: number): void {
  c.strokeStyle = color;
  c.lineWidth = width;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.stroke(new Path2D(d));
}

function oval(c: Ctx, cx: number, cy: number, rx: number, ry: number, color: string, rotation = 0): void {
  c.fillStyle = color;
  c.beginPath();
  c.ellipse(cx, cy, rx, ry, rotation, 0, Math.PI * 2);
  c.fill();
}

function box(c: Ctx, x: number, y: number, w: number, h: number, r: number, color: string): void {
  c.fillStyle = color;
  c.beginPath();
  c.roundRect(x, y, w, h, r);
  c.fill();
}

/** 두 눈과 볼, 작은 입. (x, y)가 두 눈의 가운데다. */
function face(c: Ctx, x: number, y: number, gap: number, eye: number, mood: 'smile' | 'grumpy' | 'none' = 'smile'): void {
  const left = x - gap / 2;
  const right = x + gap / 2;
  oval(c, left - eye * 1.7, y + eye * 2, eye * 1.4, eye * 0.9, BLUSH);
  oval(c, right + eye * 1.7, y + eye * 2, eye * 1.4, eye * 0.9, BLUSH);
  for (const ex of [left, right]) {
    oval(c, ex, y, eye, eye, INK);
    oval(c, ex + eye * 0.34, y - eye * 0.36, eye * 0.34, eye * 0.34, WHITE);
  }
  if (mood === 'grumpy') {
    stroke(c, `M${left - eye * 1.3} ${y - eye * 2}L${left + eye * 1.1} ${y - eye * 1.3}`, INK, eye * 0.6);
    stroke(c, `M${right + eye * 1.3} ${y - eye * 2}L${right - eye * 1.1} ${y - eye * 1.3}`, INK, eye * 0.6);
  }
  if (mood === 'none') return;
  const my = y + eye * 1.8;
  stroke(c, `M${x - eye * 0.9} ${my}Q${x} ${my + eye * (mood === 'grumpy' ? -0.9 : 1)} ${x + eye * 0.9} ${my}`, INK, eye * 0.55);
}

/** 물방울: 위가 뾰족하고 아래가 둥글다. (cx, cy)는 둥근 쪽의 가운데, r은 그 반지름 */
function dropPath(cx: number, cy: number, r: number): string {
  return `M${cx} ${cy - r * 2.1}C${cx + r * 0.4} ${cy - r * 1.2} ${cx + r} ${cy - r * 0.7} ${cx + r} ${cy}A${r} ${r} 0 1 1 ${cx - r} ${cy}C${cx - r} ${cy - r * 0.7} ${cx - r * 0.4} ${cy - r * 1.2} ${cx} ${cy - r * 2.1}Z`;
}

function drop(c: Ctx, cx: number, cy: number, r: number, color = WATER, shine = true): void {
  fill(c, dropPath(cx, cy, r), color);
  if (shine) oval(c, cx - r * 0.35, cy - r * 0.15, r * 0.25, r * 0.4, 'rgba(255, 255, 255, 0.85)', 0.5);
}

/** 꼭짓점이 다섯인 별 */
function star(c: Ctx, cx: number, cy: number, r: number, color: string): void {
  const points: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? r : r * 0.48;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    points.push(`${(cx + radius * Math.cos(angle)).toFixed(2)} ${(cy + radius * Math.sin(angle)).toFixed(2)}`);
  }
  const d = `M${points.join('L')}Z`;
  fill(c, d, color);
  stroke(c, d, color, r * 0.25);
}

/** 울타리의 말뚝 하나. (x, y)는 왼쪽 위 */
function picket(c: Ctx, x: number, y: number, w: number, h: number): void {
  fill(c, `M${x} ${y + w * 0.6}L${x + w / 2} ${y}L${x + w} ${y + w * 0.6}V${y + h}H${x}Z`, WOOD_DEEP);
  fill(c, `M${x} ${y + w * 0.6}L${x + w / 2} ${y}L${x + w} ${y + w * 0.6}V${y + h - 1.5}H${x}Z`, WOOD);
}

/** 해바라기의 꽃: 꽃잎을 빙 두르고 가운데에 얼굴 */
function sunflowerHead(c: Ctx, cx: number, cy: number, r: number, withFace: boolean): void {
  for (let i = 0; i < 10; i += 1) {
    const angle = (i / 10) * Math.PI * 2;
    oval(c, cx + Math.cos(angle) * r * 0.82, cy + Math.sin(angle) * r * 0.82, r * 0.42, r * 0.26, '#ffcf5c', angle);
  }
  oval(c, cx, cy, r * 0.66, r * 0.66, '#c98a5a');
  oval(c, cx, cy, r * 0.56, r * 0.56, '#dba06e');
  if (withFace) face(c, cx, cy - r * 0.06, r * 0.5, r * 0.11);
}

function sprout(c: Ctx, x: number, y: number, size: number): void {
  stroke(c, `M${x} ${y}V${y - size}`, LEAF_DEEP, size * 0.22);
  oval(c, x - size * 0.42, y - size * 1.05, size * 0.45, size * 0.26, LEAF, -0.6);
  oval(c, x + size * 0.42, y - size * 1.05, size * 0.45, size * 0.26, LEAF, 0.6);
}

// ───────── 벌레 ─────────

const BUG_VIEW = [40, 40] as const;

const ENEMY_ART: Readonly<Record<EnemyKind, Art>> = {
  ant: {
    width: 22,
    height: 22,
    view: BUG_VIEW,
    draw(c) {
      // 다리
      stroke(c, 'M11 12L5 8M11 16L4 17M29 12L35 8M29 16L36 17', '#9a6c5c', 2.2);
      oval(c, 20, 11, 8, 7.5, '#b98a78');
      stroke(c, 'M14 16Q9 11 8 5M26 16Q31 11 32 5', '#9a6c5c', 1.8);
      oval(c, 8, 5, 1.8, 1.8, '#9a6c5c');
      oval(c, 32, 5, 1.8, 1.8, '#9a6c5c');
      oval(c, 20, 25, 12, 11, '#c9a08e');
      face(c, 20, 24, 10, 2.2);
    },
  },
  ladybug: {
    width: 21,
    height: 21,
    view: BUG_VIEW,
    draw(c) {
      stroke(c, 'M9 14L4 11M9 22L3 23M31 14L36 11M31 22L37 23', INK, 2);
      oval(c, 20, 18, 14, 14, '#ff8f8f');
      oval(c, 15, 11, 5, 3, 'rgba(255, 255, 255, 0.45)', -0.5);
      stroke(c, 'M20 4V24', '#e06d75', 1.6);
      for (const [x, y] of [
        [13, 14],
        [27, 14],
        [14, 23],
        [26, 23],
        [20, 8],
      ]) {
        oval(c, x, y, 2.4, 2.4, INK);
      }
      oval(c, 20, 31, 9, 7, '#6b5263');
      oval(c, 16.5, 31, 2.3, 2.3, WHITE);
      oval(c, 23.5, 31, 2.3, 2.3, WHITE);
      oval(c, 16.8, 31.6, 1.1, 1.1, INK);
      oval(c, 23.2, 31.6, 1.1, 1.1, INK);
    },
  },
  snail: {
    width: 28,
    height: 28,
    view: BUG_VIEW,
    draw(c) {
      oval(c, 20, 16, 14, 13.5, '#b7a6f2');
      oval(c, 20, 15, 12.5, 12, '#c9bcf8');
      stroke(c, 'M20 15a3 3 0 1 1 3 3a6 6 0 1 1-6-6a9 9 0 0 1 9 9', '#9684e0', 2);
      stroke(c, 'M10 28L7 20M30 28L33 20', '#f2cf73', 2.4);
      oval(c, 7, 19.5, 2.4, 2.4, '#ffe9a8');
      oval(c, 33, 19.5, 2.4, 2.4, '#ffe9a8');
      box(c, 5, 24, 30, 13, 6.5, '#ffe9a8');
      face(c, 20, 29, 11, 2);
    },
  },
  bee: {
    width: 24,
    height: 22,
    view: [44, 40],
    draw(c) {
      oval(c, 9, 13, 9, 6, 'rgba(207, 233, 255, 0.92)', -0.5);
      oval(c, 35, 13, 9, 6, 'rgba(207, 233, 255, 0.92)', 0.5);
      stroke(c, 'M17 9Q15 4 12 3M27 9Q29 4 32 3', INK, 1.6);
      oval(c, 22, 21, 12, 13, '#ffd866');
      c.save();
      c.beginPath();
      c.ellipse(22, 21, 12, 13, 0, 0, Math.PI * 2);
      c.clip();
      box(c, 8, 10, 28, 3.6, 0, '#6b5263');
      box(c, 8, 16, 28, 3.6, 0, '#6b5263');
      c.restore();
      face(c, 22, 25.5, 9, 2.1);
    },
  },
  hopper: {
    width: 24,
    height: 24,
    view: BUG_VIEW,
    draw(c) {
      // 접힌 뒷다리
      stroke(c, 'M11 20L3 8L8 26M29 20L37 8L32 26', '#6cc48a', 3);
      oval(c, 20, 10, 6.5, 8, '#8fdb9a');
      stroke(c, 'M16 14Q12 8 11 3M24 14Q28 8 29 3', '#6cc48a', 1.6);
      oval(c, 20, 25, 11.5, 11, '#a8e6a1');
      face(c, 20, 24, 11, 2.5);
    },
  },
  beetle: {
    width: 26,
    height: 26,
    view: BUG_VIEW,
    draw(c) {
      stroke(c, 'M9 12L3 9M8 20L2 21M31 12L37 9M32 20L38 21', '#5d6fc2', 2.4);
      oval(c, 20, 17, 14.5, 14, '#7f93e0');
      oval(c, 20, 16, 13, 12.5, '#9db0f0');
      stroke(c, 'M20 4V28', '#6f83d6', 1.8);
      stroke(c, 'M11 9Q14 6 17 6', 'rgba(255, 255, 255, 0.8)', 2);
      stroke(c, 'M9.5 14Q10 12.500 11 11.500', 'rgba(255, 255, 255, 0.8)', 2);
      oval(c, 20, 31, 9.5, 7, '#5d6fc2');
      // 뿔
      fill(c, 'M18 36L20 40L22 36Z', '#5d6fc2');
      stroke(c, 'M18 36L20 39.500L22 36', '#5d6fc2', 1.4);
      oval(c, 16.5, 31, 2.2, 2.2, WHITE);
      oval(c, 23.5, 31, 2.2, 2.2, WHITE);
      oval(c, 16.8, 31.6, 1.1, 1.1, INK);
      oval(c, 23.2, 31.6, 1.1, 1.1, INK);
    },
  },
  mosquito: {
    width: 18,
    height: 18,
    view: BUG_VIEW,
    draw(c) {
      // 가늘고 긴 다리
      stroke(c, 'M15 18L5 13L2 16M15 22L4 25M25 18L35 13L38 16M25 22L36 25', '#8f84b8', 1.6);
      // 날개
      oval(c, 11, 10, 9, 5, 'rgba(207, 233, 255, 0.92)', -0.7);
      oval(c, 29, 10, 9, 5, 'rgba(207, 233, 255, 0.92)', 0.7);
      // 줄무늬 배
      oval(c, 20, 12, 5.5, 9.5, '#b9b0d9');
      box(c, 15, 7, 10, 2.2, 1.1, '#8f84b8');
      box(c, 15, 12, 10, 2.2, 1.1, '#8f84b8');
      // 머리와 울타리를 노리는 뾰족한 침
      stroke(c, 'M20 30L20 39', '#6b5263', 1.8);
      oval(c, 20, 25, 8.5, 7.5, '#cfc7ec');
      face(c, 20, 24.5, 7.5, 1.8, 'none');
    },
  },
  digger: {
    width: 24,
    height: 24,
    view: BUG_VIEW,
    draw(c) {
      stroke(c, 'M11 14L4 11M11 20L4 22M29 14L36 11M29 20L36 22', '#a0764f', 2.2);
      // 보송한 배
      oval(c, 20, 13, 10, 10.5, '#d1ab84');
      stroke(c, 'M13 10Q20 13 27 10M12.500 15.500Q20 19 27.500 15.500', '#bd9469', 1.4);
      // 앞쪽 몸통과 얼굴
      oval(c, 20, 27, 11.5, 9, '#b98d62');
      oval(c, 20, 26, 10.5, 8, '#c99f75');
      face(c, 20, 26, 9, 2);
      // 흙을 파는 큰 앞발(삽 같은 발톱)
      for (const side of [-1, 1]) {
        const x = 20 + side * 12.5;
        oval(c, x, 33, 5, 4, '#a0764f', side * 0.5);
        stroke(c, `M${x - 3} 36L${x - 3.5} 39M${x} 36.500L${x} 39.500M${x + 3} 36L${x + 3.5} 39`, '#8a6342', 1.4);
      }
      stroke(c, 'M16 21Q12 14 9 4M24 21Q28 14 31 4', '#a0764f', 1.3);
    },
  },
  mole: {
    width: 46,
    height: 46,
    view: [46, 46],
    draw(c) {
      // 앞발
      oval(c, 6, 30, 5.5, 4.5, '#ffc4d3', -0.5);
      oval(c, 40, 30, 5.5, 4.5, '#ffc4d3', 0.5);
      stroke(c, 'M3 33L1.500 36M6 34.500L5.500 38M40 34.500L40.500 38M43 33L44.500 36', WHITE, 1.6);
      oval(c, 23, 24, 18, 17.5, '#a58b7f');
      oval(c, 23, 23, 17, 16, '#b79f93');
      oval(c, 23, 30, 11, 8.5, '#d9c5ba');
      // 왕관
      fill(c, 'M14 9L15.500 2.500L19.500 6.500L23 1.500L26.500 6.500L30.500 2.500L32 9Z', '#ffcf5c');
      stroke(c, 'M14 9L15.500 2.500L19.500 6.500L23 1.500L26.500 6.500L30.500 2.500L32 9Z', '#ffcf5c', 1.2);
      box(c, 13.500, 8, 19, 3, 1.5, '#f2b53a');
      face(c, 23, 21, 13, 2, 'grumpy');
      oval(c, 23, 27.500, 3.6, 2.8, '#ff9fb5');
      oval(c, 22, 26.800, 1.1, 0.8, 'rgba(255, 255, 255, 0.8)');
    },
  },
  rhino: {
    width: 46,
    height: 46,
    view: [46, 46],
    draw(c) {
      // 다리
      stroke(c, 'M8 15L2 11M7 23L1 25M9 30L4 35M38 15L44 11M39 23L45 25M37 30L42 35', '#6d5bb0', 2.6);
      // 반짝이는 등딱지
      oval(c, 23, 19, 17.5, 16, '#7f6bc2');
      oval(c, 23, 18, 16.5, 14.5, '#9b87d6');
      stroke(c, 'M23 4V31', '#7f6bc2', 1.8);
      stroke(c, 'M12 11Q15 7 19 6.500', 'rgba(255, 255, 255, 0.75)', 2.2);
      // 갈라진 큰 뿔이 아래(울타리 쪽)를 향한다. 머리 뒤에서 나와 머리 아래로 길게 뻗는다.
      fill(c, 'M17.500 33Q23 49 28.500 33Z', '#e9b54a');
      fill(c, 'M18.500 33Q23 47 27.500 33Z', '#ffd77a');
      stroke(c, 'M23 41.500L18.500 45.500M23 41.500L27.500 45.500', '#ffd77a', 2.4);
      // 머리
      oval(c, 23, 31, 11.5, 6.5, '#6d5bb0');
      // 왕관
      fill(c, 'M15 6L16.500 0.500L20 4L23 0L26 4L29.500 0.500L31 6Z', '#ffcf5c');
      box(c, 14.500, 5, 17, 2.6, 1.3, '#f2b53a');
      face(c, 23, 29.500, 11, 1.8, 'none');
      // 찌푸린 눈썹
      stroke(c, 'M14.500 26L19 27.300M31.500 26L27 27.300', INK, 1.1);
    },
  },
};

// ───────── 물방울, 씨앗, 도우미 ─────────

const ITEM_ART: Readonly<Record<string, Art>> = {
  /** 물총의 물방울. 위(날아가는 쪽)가 뾰족하다. */
  [TEX.drop]: {
    width: 8,
    height: 12,
    view: [16, 24],
    draw(c) {
      drop(c, 8, 15, 6.5, WATER);
    },
  },
  [TEX.dropCrit]: {
    width: 11,
    height: 16,
    view: [22, 32],
    draw(c) {
      drop(c, 11, 20, 9.5, '#ffcf5c');
      drop(c, 11, 20, 6.5, '#fff0c9', false);
    },
  },
  /** 해바라기가 쏘는 씨 */
  [TEX.pip]: {
    width: 6,
    height: 10,
    view: [12, 20],
    draw(c) {
      oval(c, 6, 10, 4.5, 8, '#8a6f5c');
      stroke(c, 'M6 4V16', '#f6ece7', 1.6);
    },
  },
  /** 씨앗: 판에서 모아 영구 강화를 사는 돈. 싹이 튼 씨앗이다. */
  [TEX.seed]: {
    width: 14,
    height: 14,
    view: [28, 28],
    draw(c) {
      sprout(c, 14, 14, 8);
      oval(c, 14, 18.5, 8, 6.5, '#c98a4e');
      oval(c, 14, 17.5, 7.5, 6, '#e6b56e');
      oval(c, 11, 15.5, 2.4, 1.4, 'rgba(255, 255, 255, 0.7)', -0.4);
    },
  },
  [TEX.sunflower]: {
    width: 30,
    height: 38,
    view: [30, 38],
    draw(c) {
      stroke(c, 'M15 20V37', LEAF_DEEP, 2.6);
      oval(c, 9.5, 29, 5.5, 2.8, LEAF, 0.5);
      oval(c, 20.5, 31, 5.5, 2.8, LEAF, -0.5);
      sunflowerHead(c, 15, 13, 12.5, true);
    },
  },
  [TEX.mound]: {
    width: 26,
    height: 20,
    view: [40, 30],
    draw(c) {
      oval(c, 20, 19, 18, 10, '#d9b48f');
      oval(c, 20, 17, 15, 8, '#e6c6a3');
      for (const [x, y, r] of [
        [9, 25, 1.8],
        [31, 24, 2],
        [14, 13, 1.4],
        [26, 12.500, 1.6],
        [20, 21, 1.5],
      ] as const) {
        oval(c, x, y, r, r * 0.8, '#c49a73');
      }
      // 흙 위로 살짝 나온 발톱 끝
      oval(c, 15.500, 9.500, 2.4, 1.8, '#a0764f');
      oval(c, 24.500, 9.500, 2.4, 1.8, '#a0764f');
    },
  },
  /** 물총. 오른쪽(0도)을 보고 있고, 손잡이 쪽이 원점에 가깝다. */
  [TEX.gun]: {
    width: 26,
    height: 14,
    view: [26, 14],
    draw(c) {
      box(c, 3, 7, 6, 7, 2.5, '#e97f99');
      box(c, 1, 2.5, 18, 7, 3.5, '#ff9fb5');
      box(c, 17, 4, 8, 4, 2, WATER_DEEP);
      box(c, 5, 0, 8, 4.5, 2, WATER);
      box(c, 4, 4, 9, 1.4, 0.7, 'rgba(255, 255, 255, 0.7)');
    },
  },
  /** 물벼락: 구름과 떨어지는 물방울 */
  [TEX.storm]: {
    width: 24,
    height: 24,
    view: [24, 24],
    draw(c) {
      oval(c, 8, 10, 5.5, 5, WHITE);
      oval(c, 14, 7.5, 6.5, 6, WHITE);
      oval(c, 18.5, 11, 4.5, 4.2, WHITE);
      box(c, 4, 9.5, 18, 6, 3, WHITE);
      drop(c, 7.5, 21, 1.8, WATER_DEEP, false);
      drop(c, 12.5, 22.5, 1.8, WATER_DEEP, false);
      drop(c, 17.5, 21, 1.8, WATER_DEEP, false);
    },
  },
};

// ───────── 영구 강화의 아이콘 ─────────

const UP_VIEW = [24, 24] as const;
const UP_SIZE = { width: 24, height: 24, view: UP_VIEW } as const;

const UPGRADE_ART: Readonly<Record<UpgradeId, Art>> = {
  power: {
    ...UP_SIZE,
    draw(c) {
      drop(c, 12, 14.5, 7.5, WATER_DEEP);
      drop(c, 12, 14.5, 5.2, WATER);
    },
  },
  rapid: {
    ...UP_SIZE,
    draw(c) {
      drop(c, 6, 17, 3.2);
      drop(c, 12.5, 13, 3.6);
      drop(c, 19, 8.5, 3.2);
      stroke(c, 'M2.500 9H7M3.500 5.500H9.500', '#ffb14a', 1.8);
    },
  },
  fence: {
    ...UP_SIZE,
    draw(c) {
      box(c, 1.5, 12, 21, 3, 1.5, WOOD_DEEP);
      picket(c, 3, 4, 5, 17);
      picket(c, 9.5, 4, 5, 17);
      picket(c, 16, 4, 5, 17);
    },
  },
  mend: {
    ...UP_SIZE,
    draw(c) {
      stroke(c, 'M8 16L17 7', WOOD_DEEP, 3.2);
      c.save();
      c.translate(17, 7);
      c.rotate(Math.PI / 4);
      box(c, -6.5, -3.5, 13, 7, 2, '#9db0c4');
      box(c, -6.5, -3.5, 13, 2.2, 1, '#c3d2e0');
      c.restore();
      star(c, 6.5, 18.5, 2.6, '#ffcf5c');
    },
  },
  crit: {
    ...UP_SIZE,
    draw(c) {
      drop(c, 10, 15.5, 6.5, WATER);
      star(c, 17, 7.5, 5, '#ffcf5c');
    },
  },
  splash: {
    ...UP_SIZE,
    draw(c) {
      stroke(c, 'M3.500 18.500Q12 23 20.500 18.500', WATER, 2);
      stroke(c, 'M6.500 15Q12 18 17.500 15', WATER_DEEP, 2);
      drop(c, 12, 9, 3.6);
      drop(c, 5, 10.5, 1.9, WATER, false);
      drop(c, 19, 10.5, 1.9, WATER, false);
    },
  },
  chill: {
    ...UP_SIZE,
    draw(c) {
      drop(c, 12, 14.5, 7.5, '#bfe3ff');
      stroke(c, 'M12 9.500V19.500M7.700 12L16.300 17M16.300 12L7.700 17', WHITE, 1.8);
      oval(c, 12, 14.5, 1.5, 1.5, WATER);
    },
  },
  thorn: {
    ...UP_SIZE,
    draw(c) {
      box(c, 1.5, 13, 21, 3, 1.5, WOOD_DEEP);
      picket(c, 4, 7, 5, 14);
      picket(c, 15, 7, 5, 14);
      fill(c, 'M9.500 13.500L12 3L14.500 13.500Z', '#57b98f');
      fill(c, 'M1 9.500L4 12.500L1.500 14Z', '#57b98f');
      fill(c, 'M23 9.500L20 12.500L22.500 14Z', '#57b98f');
    },
  },
  harvest: {
    ...UP_SIZE,
    draw(c) {
      box(c, 4, 9, 16, 13, 5, '#e6b56e');
      box(c, 6, 6.5, 12, 4, 2, '#c98a4e');
      sprout(c, 12, 7, 5);
      oval(c, 12, 16, 3.2, 2.6, '#fff0c9');
    },
  },
  helper: {
    ...UP_SIZE,
    draw(c) {
      stroke(c, 'M12 14V23', LEAF_DEEP, 2.2);
      oval(c, 8, 19.5, 3.6, 1.9, LEAF, 0.5);
      sunflowerHead(c, 12, 9, 8.5, false);
    },
  },
  compost: {
    ...UP_SIZE,
    draw(c) {
      fill(c, 'M3 21Q4 12 12 12Q20 12 21 21Z', '#a9825f');
      stroke(c, 'M3 21Q4 12 12 12Q20 12 21 21Z', '#a9825f', 1.6);
      oval(c, 9, 17.5, 1.6, 1.2, '#c9a27a');
      oval(c, 15, 16, 1.6, 1.2, '#c9a27a');
      sprout(c, 12, 12.5, 6.5);
      star(c, 19, 5.5, 2.8, '#ffcf5c');
    },
  },
  pierce: {
    ...UP_SIZE,
    draw(c) {
      oval(c, 7, 12, 4.2, 6.5, '#ffc4d3');
      oval(c, 7, 12, 2, 4, WHITE);
      stroke(c, 'M2 12H17', WATER, 2.6);
      fill(c, 'M15.500 7L22.500 12L15.500 17Z', WATER_DEEP);
      stroke(c, 'M15.500 7L22.500 12L15.500 17Z', WATER_DEEP, 1.2);
    },
  },
  fork: {
    ...UP_SIZE,
    draw(c) {
      stroke(c, 'M12 22L5 10M12 22V8M12 22L19 10', '#cfe9ff', 2);
      drop(c, 4.5, 8, 2.6);
      drop(c, 12, 6, 2.8);
      drop(c, 19.5, 8, 2.6);
    },
  },
  storm: {
    ...UP_SIZE,
    draw(c) {
      oval(c, 8, 9.5, 5.5, 5, '#c9bcf8');
      oval(c, 14, 7.5, 6.5, 6, '#c9bcf8');
      oval(c, 18.5, 10.5, 4.5, 4.2, '#c9bcf8');
      box(c, 4, 9, 18, 6, 3, '#c9bcf8');
      drop(c, 7.5, 21, 1.8, WATER_DEEP, false);
      drop(c, 12.5, 22.5, 1.8, WATER_DEEP, false);
      drop(c, 17.5, 21, 1.8, WATER_DEEP, false);
    },
  },
};

/** 이 게임의 텍스처를 등록한다. 여러 번 불러도 한 번만 만든다. */
export function registerGardenTextures(scene: Phaser.Scene): void {
  const density = renderScale();
  const add = (key: string, art: Art): void => {
    if (scene.textures.exists(key)) return;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(art.width * density);
    canvas.height = Math.ceil(art.height * density);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2D 캔버스를 만들 수 없습니다.');
    const [viewWidth, viewHeight] = art.view ?? [art.width, art.height];
    context.scale(canvas.width / viewWidth, canvas.height / viewHeight);
    art.draw(context);
    addHiResCanvas(scene.textures, key, canvas, art.width, art.height);
  };
  for (const [kind, art] of Object.entries(ENEMY_ART)) add(enemyTexture(kind as EnemyKind), art);
  for (const [key, art] of Object.entries(ITEM_ART)) add(key, art);
  for (const [id, art] of Object.entries(UPGRADE_ART)) add(upgradeTexture(id as UpgradeId), art);
}
