/**
 * 구름 탑 모험 전용 그림. 공용 art/ 폴더를 건드리지 않도록 이 게임 안에서 만든다.
 * 캔버스에 곡선으로 그려 텍스처로 등록한다. 크기는 모두 논리 픽셀이다.
 * 적은 모두 말랑한 동물 친구들이라, 둥근 몸에 눈과 볼을 그린 뒤 귀나 뿔 같은 것을 붙인다.
 */
import type Phaser from 'phaser';
import { THEME, THEME_CSS } from '../../config';
import { addHiResCanvas, renderScale } from '../../core/hidpi';
import type { CardType, EnemyLook, NodeKind, StatusId, TreasureId, UpgradeId } from './data';

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

/** 화면(Phaser 도형)에서 쓰는 색 */
export const LOOK = {
  /** 구역마다의 하늘 */
  sky: [0xe3f2ff, 0xf3e8ff, 0xe8e6ff] as const,
  skyLow: [0xfff4ec, 0xffeef3, 0xfff3e0] as const,
  cloud: 0xffffff,
  hpBack: 0x5b4455,
  hpFill: THEME.coral,
  hpMe: THEME.mintDeep,
  block: THEME.skyDeep,
  mana: THEME.lilacDeep,
  cardFace: 0xffffff,
  attack: THEME.coral,
  attackDeep: THEME.coralDeep,
  skill: THEME.sky,
  skillDeep: THEME.skyDeep,
  power: THEME.butter,
  powerDeep: THEME.butterDeep,
  rare: THEME.gold,
  selected: THEME.pinkDeep,
} as const;

export const CARD_COLOR: Readonly<Record<CardType, { face: number; deep: number }>> = {
  attack: { face: LOOK.attack, deep: LOOK.attackDeep },
  skill: { face: LOOK.skill, deep: LOOK.skillDeep },
  power: { face: LOOK.power, deep: LOOK.powerDeep },
};

export const enemyTexture = (look: EnemyLook): string => `ct-foe-${look}`;
export const statusTexture = (id: StatusId): string => `ct-st-${id}`;
export const nodeTexture = (kind: NodeKind): string => `ct-node-${kind}`;
export const treasureTexture = (id: TreasureId): string => `ct-tr-${id}`;
export const upgradeTexture = (id: UpgradeId): string => `ct-up-${id}`;
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
function face(c: Ctx, x: number, y: number, gap: number, eye: number, mood: 'smile' | 'grumpy' | 'sleepy' = 'grumpy'): void {
  const left = x - gap / 2;
  const right = x + gap / 2;
  oval(c, left - eye * 1.6, y + eye * 2, eye * 1.4, eye * 0.9, BLUSH);
  oval(c, right + eye * 1.6, y + eye * 2, eye * 1.4, eye * 0.9, BLUSH);
  if (mood === 'sleepy') {
    for (const ex of [left, right]) stroke(c, `M${ex - eye} ${y}Q${ex} ${y + eye} ${ex + eye} ${y}`, INK, eye * 0.6);
  } else {
    for (const ex of [left, right]) {
      oval(c, ex, y, eye, eye * 1.1, INK);
      oval(c, ex + eye * 0.34, y - eye * 0.4, eye * 0.36, eye * 0.36, WHITE);
    }
  }
  if (mood === 'grumpy') {
    stroke(c, `M${left - eye * 1.3} ${y - eye * 2.1}L${left + eye * 1.1} ${y - eye * 1.4}`, INK, eye * 0.6);
    stroke(c, `M${right + eye * 1.3} ${y - eye * 2.1}L${right - eye * 1.1} ${y - eye * 1.4}`, INK, eye * 0.6);
  }
  const my = y + eye * 2;
  const curve = mood === 'grumpy' ? -0.8 : 0.9;
  stroke(c, `M${x - eye * 0.9} ${my}Q${x} ${my + eye * curve} ${x + eye * 0.9} ${my}`, INK, eye * 0.5);
}

/** 꼭짓점이 n개인 별 */
function star(c: Ctx, cx: number, cy: number, r: number, color: string, points = 5, inner = 0.48): void {
  const list: string[] = [];
  for (let i = 0; i < points * 2; i += 1) {
    const radius = i % 2 === 0 ? r : r * inner;
    const angle = -Math.PI / 2 + (i * Math.PI) / points;
    list.push(`${(cx + radius * Math.cos(angle)).toFixed(2)} ${(cy + radius * Math.sin(angle)).toFixed(2)}`);
  }
  const d = `M${list.join('L')}Z`;
  fill(c, d, color);
  stroke(c, d, color, r * 0.22);
}

function heartPath(cx: number, cy: number, r: number): string {
  return `M${cx} ${cy + r * 0.9}C${cx - r * 1.4} ${cy - r * 0.1} ${cx - r * 0.9} ${cy - r * 1.2} ${cx} ${cy - r * 0.45}C${cx + r * 0.9} ${cy - r * 1.2} ${cx + r * 1.4} ${cy - r * 0.1} ${cx} ${cy + r * 0.9}Z`;
}

function shieldPath(cx: number, cy: number, r: number): string {
  return `M${cx} ${cy - r}L${cx + r * 0.85} ${cy - r * 0.6}V${cy}C${cx + r * 0.85} ${cy + r * 0.6} ${cx + r * 0.4} ${cy + r * 0.85} ${cx} ${cy + r}C${cx - r * 0.4} ${cy + r * 0.85} ${cx - r * 0.85} ${cy + r * 0.6} ${cx - r * 0.85} ${cy}V${cy - r * 0.6}Z`;
}

function drop(c: Ctx, cx: number, cy: number, r: number, color: string): void {
  fill(
    c,
    `M${cx} ${cy - r * 2}C${cx + r * 0.4} ${cy - r * 1.2} ${cx + r} ${cy - r * 0.7} ${cx + r} ${cy}A${r} ${r} 0 1 1 ${cx - r} ${cy}C${cx - r} ${cy - r * 0.7} ${cx - r * 0.4} ${cy - r * 1.2} ${cx} ${cy - r * 2}Z`,
    color,
  );
  oval(c, cx - r * 0.35, cy - r * 0.1, r * 0.22, r * 0.38, 'rgba(255,255,255,0.8)', 0.4);
}

function cloudShape(c: Ctx, cx: number, cy: number, r: number, color: string): void {
  oval(c, cx - r * 0.7, cy + r * 0.15, r * 0.6, r * 0.5, color);
  oval(c, cx + r * 0.7, cy + r * 0.15, r * 0.6, r * 0.5, color);
  oval(c, cx - r * 0.1, cy - r * 0.25, r * 0.7, r * 0.65, color);
  box(c, cx - r * 1.2, cy, r * 2.4, r * 0.65, r * 0.3, color);
}

// ───────── 토끼 마법사 ─────────

const BUNNY: Art = {
  width: 46,
  height: 52,
  view: [46, 52],
  draw(c) {
    // 귀
    oval(c, 16, 12, 5, 12, '#f6eef2', -0.15);
    oval(c, 30, 12, 5, 12, '#f6eef2', 0.15);
    oval(c, 16, 13, 2.4, 8.5, '#ffc6d4', -0.15);
    oval(c, 30, 13, 2.4, 8.5, '#ffc6d4', 0.15);
    // 망토
    fill(c, 'M8 50Q10 30 23 30Q36 30 38 50Z', '#9684e0');
    fill(c, 'M11 50Q13 33 23 33Q33 33 35 50Z', '#c9bcf8');
    // 머리
    oval(c, 23, 27, 13, 11.5, '#fffafc');
    face(c, 23, 26, 9, 1.9, 'smile');
    // 모자
    fill(c, 'M10 18Q23 13 36 18Q30 20 23 20Q16 20 10 18Z', '#7b6ad0');
    fill(c, 'M15 17L24 1L31 17Z', '#9684e0');
    star(c, 25, 9, 3, '#ffcf5c');
    // 지팡이
    stroke(c, 'M40 48L42 26', '#c98a5a', 2.4);
    star(c, 42, 24, 5, '#ffcf5c');
    oval(c, 41, 23, 1.2, 1.2, WHITE);
  },
};

// ───────── 적 ─────────

const FOE_VIEW = [48, 48] as const;

function foeArt(draw: (c: Ctx) => void): Art {
  return { width: 48, height: 48, view: FOE_VIEW, draw };
}

const ENEMY_ART: Readonly<Record<EnemyLook, Art>> = {
  jelly: foeArt((c) => {
    fill(c, 'M6 42Q6 14 24 12Q42 14 42 42Q24 46 6 42Z', '#9be3c9');
    fill(c, 'M10 40Q10 20 24 18Q38 20 38 40Q24 43 10 40Z', '#b9eedb');
    oval(c, 16, 20, 3, 5, 'rgba(255,255,255,0.8)', 0.4);
    face(c, 24, 30, 10, 2.2);
  }),
  squirrel: foeArt((c) => {
    fill(c, 'M36 44Q48 34 42 18Q40 8 32 12Q40 20 34 30Z', '#d9a878');
    oval(c, 22, 32, 13, 12, '#e8b98a');
    oval(c, 22, 35, 8, 8, '#fbe3c8');
    oval(c, 13, 18, 4, 5, '#e8b98a');
    oval(c, 31, 18, 4, 5, '#e8b98a');
    face(c, 22, 28, 9, 2);
    oval(c, 22, 43, 4, 3.5, '#b97a4a');
  }),
  chestnut: foeArt((c) => {
    for (let i = 0; i < 14; i += 1) {
      const a = (i / 14) * Math.PI * 2;
      stroke(c, `M${24 + Math.cos(a) * 14} ${28 + Math.sin(a) * 13}L${24 + Math.cos(a) * 21} ${28 + Math.sin(a) * 19}`, '#8fa35a', 2.2);
    }
    oval(c, 24, 28, 15, 14, '#b9cf7a');
    oval(c, 24, 31, 10, 9, '#a8794e');
    face(c, 24, 29, 8, 1.9);
  }),
  crow: foeArt((c) => {
    fill(c, 'M6 30Q2 24 10 22L16 28Z', '#5d5a7a');
    fill(c, 'M42 30Q46 24 38 22L32 28Z', '#5d5a7a');
    oval(c, 24, 30, 14, 13, '#6f6b8f');
    oval(c, 24, 34, 8, 7, '#8c88aa');
    face(c, 24, 26, 10, 2.1);
    fill(c, 'M21 31L27 31L24 36Z', '#ffcf5c');
    stroke(c, 'M24 17L22 11M24 17L27 12', '#6f6b8f', 2);
  }),
  mushroom: foeArt((c) => {
    box(c, 15, 26, 18, 18, 7, '#fbe3c8');
    face(c, 24, 33, 8, 1.8);
    fill(c, 'M4 27Q6 6 24 5Q42 6 44 27Q24 31 4 27Z', '#ff8f8f');
    oval(c, 14, 15, 3.5, 3, WHITE);
    oval(c, 26, 11, 3, 2.5, WHITE);
    oval(c, 35, 18, 3.5, 3, WHITE);
    fill(c, 'M38 46L46 30L42 29Z', '#c9bcf8');
    stroke(c, 'M36 40L44 40', '#9684e0', 2.5);
  }),
  sheep: foeArt((c) => {
    for (const [x, y] of [
      [12, 22],
      [24, 16],
      [36, 22],
      [10, 34],
      [38, 34],
      [18, 40],
      [30, 40],
      [24, 28],
    ] as const) {
      oval(c, x, y, 9, 8.5, '#f4f1ff');
    }
    box(c, 15, 22, 18, 17, 8, '#5b4f6b');
    face(c, 24, 29, 8, 1.8);
    fill(c, 'M22 2L17 12H22L19 20L29 8H24L27 2Z', '#ffcf5c');
    oval(c, 11, 26, 4, 2.4, '#5b4f6b', 0.4);
    oval(c, 37, 26, 4, 2.4, '#5b4f6b', -0.4);
  }),
  fox: foeArt((c) => {
    fill(c, 'M8 22L12 4L22 16Z', '#ff9f6b');
    fill(c, 'M40 22L36 4L26 16Z', '#ff9f6b');
    fill(c, 'M11 18L13 9L18 15Z', '#fff0e0');
    fill(c, 'M37 18L35 9L30 15Z', '#fff0e0');
    oval(c, 24, 28, 16, 14, '#ffb07f');
    fill(c, 'M10 30Q24 48 38 30Q32 40 24 40Q16 40 10 30Z', '#fff0e0');
    face(c, 24, 27, 11, 2);
    oval(c, 24, 34, 2, 1.5, INK);
  }),
  penguin: foeArt((c) => {
    oval(c, 24, 27, 15, 18, '#5d6a8f');
    oval(c, 24, 31, 10, 13, WHITE);
    face(c, 24, 24, 9, 1.9);
    fill(c, 'M21 28L27 28L24 32Z', '#ffcf5c');
    oval(c, 18, 45, 5, 2, '#ffcf5c');
    oval(c, 30, 45, 5, 2, '#ffcf5c');
    oval(c, 14, 30, 3, 8, '#4b5878', 0.3);
    oval(c, 34, 30, 3, 8, '#4b5878', -0.3);
    box(c, 13, 12, 22, 5, 2.5, '#9dd6ff');
  }),
  turtle: foeArt((c) => {
    oval(c, 24, 20, 8, 7, '#a8d8a0');
    face(c, 24, 19, 7, 1.6);
    oval(c, 24, 34, 20, 12, '#8a9a8a');
    oval(c, 24, 32, 17, 10, '#b4c0b0');
    for (const [x, y] of [
      [16, 31],
      [24, 28],
      [32, 31],
      [20, 37],
      [28, 37],
    ] as const) {
      oval(c, x, y, 3.6, 3, '#98a594');
    }
    oval(c, 9, 44, 4, 3, '#a8d8a0');
    oval(c, 39, 44, 4, 3, '#a8d8a0');
  }),
  bee: foeArt((c) => {
    oval(c, 15, 16, 7, 5, 'rgba(220,240,255,0.95)', -0.5);
    oval(c, 33, 16, 7, 5, 'rgba(220,240,255,0.95)', 0.5);
    oval(c, 24, 29, 14, 13, '#ffd866');
    box(c, 11, 31, 26, 4, 2, '#5b4455');
    box(c, 13, 38, 22, 3.5, 2, '#5b4455');
    face(c, 24, 25, 9, 1.9);
    fill(c, 'M22 42L26 42L24 47Z', '#5b4455');
    stroke(c, 'M19 17L16 10M29 17L32 10', '#5b4455', 1.6);
  }),
  bear: foeArt((c) => {
    oval(c, 11, 12, 6, 6, '#c9a08e');
    oval(c, 37, 12, 6, 6, '#c9a08e');
    oval(c, 11, 12, 3, 3, '#ffc6d4');
    oval(c, 37, 12, 3, 3, '#ffc6d4');
    oval(c, 24, 27, 17, 16, '#d8b4a0');
    oval(c, 24, 33, 8, 6, '#f3dccd');
    face(c, 24, 25, 12, 2.2);
    oval(c, 24, 31, 2.2, 1.6, INK);
    stroke(c, 'M8 38L14 34M10 42L15 37', '#9a6c5c', 1.5);
    stroke(c, 'M33 15L37 19M37 15L33 19', '#9a6c5c', 1.5);
  }),
  owl: foeArt((c) => {
    fill(c, 'M8 12L16 18L12 24Z', '#7a6a9a');
    fill(c, 'M40 12L32 18L36 24Z', '#7a6a9a');
    oval(c, 24, 29, 17, 17, '#8f7fb0');
    oval(c, 24, 34, 10, 11, '#c9bcf8');
    oval(c, 17, 24, 6.5, 6.5, '#fff4d6');
    oval(c, 31, 24, 6.5, 6.5, '#fff4d6');
    oval(c, 17, 24, 3, 3.2, INK);
    oval(c, 31, 24, 3, 3.2, INK);
    oval(c, 18, 23, 1, 1, WHITE);
    oval(c, 32, 23, 1, 1, WHITE);
    stroke(c, 'M11 17L21 20M37 17L27 20', INK, 1.6);
    fill(c, 'M21 29L27 29L24 34Z', '#ffcf5c');
    star(c, 24, 9, 4, '#ffcf5c');
    for (const x of [18, 24, 30]) stroke(c, `M${x} 36Q${x + 2} 38 ${x} 40`, '#9684e0', 1.2);
  }),
  jellyfish: foeArt((c) => {
    for (const x of [13, 19, 25, 31, 36]) stroke(c, `M${x} 28Q${x - 3} 36 ${x} 44`, '#f2a8d8', 2.2);
    fill(c, 'M6 30Q6 6 24 6Q42 6 42 30Q24 34 6 30Z', '#f7bde3');
    fill(c, 'M10 28Q10 11 24 11Q38 11 38 28Q24 31 10 28Z', '#fbd5ee');
    face(c, 24, 21, 10, 2);
    star(c, 15, 13, 2.2, '#ffcf5c');
    star(c, 33, 14, 1.8, '#ffcf5c');
  }),
  cat: foeArt((c) => {
    fill(c, 'M8 22L10 5L21 14Z', '#5f5878');
    fill(c, 'M40 22L38 5L27 14Z', '#5f5878');
    oval(c, 24, 28, 16, 15, '#6f688a');
    fill(c, 'M38 40Q48 36 44 24', '#6f688a');
    stroke(c, 'M38 40Q48 36 44 24', '#6f688a', 4);
    oval(c, 18, 26, 3.5, 4, '#ffe066');
    oval(c, 30, 26, 3.5, 4, '#ffe066');
    oval(c, 18, 26, 1.2, 3.2, INK);
    oval(c, 30, 26, 1.2, 3.2, INK);
    stroke(c, 'M21 33Q24 35 27 33', '#ffc6d4', 1.4);
    stroke(c, 'M6 30L14 31M6 34L14 33M42 30L34 31M42 34L34 33', '#a9a3c0', 1);
  }),
  clock: foeArt((c) => {
    oval(c, 16, 10, 4, 10, WHITE, -0.2);
    oval(c, 32, 10, 4, 10, WHITE, 0.2);
    oval(c, 24, 29, 17, 17, '#ffcf5c');
    oval(c, 24, 29, 14, 14, '#fff8e6');
    for (let i = 0; i < 12; i += 1) {
      const a = (i / 12) * Math.PI * 2;
      oval(c, 24 + Math.cos(a) * 11.5, 29 + Math.sin(a) * 11.5, 0.9, 0.9, '#c9a050');
    }
    face(c, 24, 26, 10, 1.9);
    stroke(c, 'M24 29L24 21M24 29L30 32', '#e06d75', 1.6);
    box(c, 20, 9, 8, 4, 2, '#e0b040');
  }),
  whale: foeArt((c) => {
    for (const x of [18, 24, 30]) drop(c, x, 8, 2, '#9dd6ff');
    fill(c, 'M4 32Q4 14 24 14Q44 14 44 30Q44 44 24 44Q8 44 4 32Z', '#8fb6f0');
    fill(c, 'M8 36Q24 46 40 34Q38 42 24 42Q12 42 8 36Z', '#d7e6ff');
    face(c, 22, 27, 12, 2.2, 'sleepy');
    fill(c, 'M40 26Q48 18 46 30Q44 34 40 32Z', '#7aa4e0');
    star(c, 34, 20, 2, '#ffcf5c');
    star(c, 12, 22, 1.6, '#ffcf5c');
  }),
};

// ───────── 작은 아이콘 ─────────

function icon(size: number, draw: (c: Ctx) => void): Art {
  return { width: size, height: size, view: [24, 24], draw };
}

const STATUS_ART: Readonly<Record<StatusId, Art>> = {
  strength: icon(12, (c) => {
    fill(c, 'M12 2Q20 8 18 15Q17 22 12 22Q6 22 6 15Q6 10 10 8Q10 12 12 13Q14 8 12 2Z', '#ff8f6b');
    oval(c, 12, 17, 3, 4, '#ffcf5c');
  }),
  tough: icon(12, (c) => {
    fill(c, shieldPath(12, 12, 10), '#7dbef2');
    fill(c, shieldPath(12, 12, 6), '#c8e6ff');
  }),
  vuln: icon(12, (c) => {
    fill(c, heartPath(12, 12, 10), '#e06d75');
    stroke(c, 'M12 6L10 11L14 13L11 19', WHITE, 2);
  }),
  weak: icon(12, (c) => {
    drop(c, 12, 15, 6, '#9da3c0');
    stroke(c, 'M8 16Q12 13 16 16', INK, 1.4);
  }),
  poison: icon(12, (c) => {
    drop(c, 12, 15, 7, '#7fcf6a');
  }),
  thorns: icon(12, (c) => {
    star(c, 12, 12, 10, '#8fa35a', 6, 0.45);
  }),
  guard: icon(12, (c) => {
    fill(c, 'M3 18Q3 4 12 4Q21 4 21 18Z', '#b4c0b0');
    stroke(c, 'M8 18Q8 8 12 6M16 18Q16 8 12 6', '#8a9a8a', 1.6);
  }),
  growth: icon(12, (c) => {
    stroke(c, 'M12 22V10', '#57b98f', 2.6);
    oval(c, 7, 9, 5, 3, '#7fd3ae', -0.5);
    oval(c, 17, 9, 5, 3, '#7fd3ae', 0.5);
  }),
  busy: icon(12, (c) => {
    box(c, 3, 6, 11, 15, 2, '#9dd6ff');
    box(c, 10, 3, 11, 15, 2, '#ff9fb5');
  }),
  toxin: icon(12, (c) => {
    cloudShape(c, 12, 13, 8, '#b49ae0');
    oval(c, 9, 13, 1.6, 1.6, '#7fcf6a');
    oval(c, 15, 15, 1.6, 1.6, '#7fcf6a');
  }),
  pump: icon(12, (c) => {
    fill(c, heartPath(12, 13, 10), '#ff9fb5');
    oval(c, 8, 9, 2, 1.4, 'rgba(255,255,255,0.8)', -0.6);
  }),
};

const NODE_ART: Readonly<Record<NodeKind, Art>> = {
  fight: icon(28, (c) => {
    stroke(c, 'M5 19L17 5', '#c98a5a', 2.4);
    stroke(c, 'M19 19L7 5', '#c98a5a', 2.4);
    star(c, 18, 5, 4, '#ffcf5c');
    star(c, 6, 5, 4, '#ff9fb5');
  }),
  elite: icon(28, (c) => {
    fill(c, 'M4 9L7 2L10 7Z', '#e06d75');
    fill(c, 'M20 9L17 2L14 7Z', '#e06d75');
    oval(c, 12, 14, 9, 8.5, '#ff8f8f');
    face(c, 12, 13, 6, 1.4);
  }),
  rest: icon(28, (c) => {
    fill(c, 'M15 3A9 9 0 1 0 21 17A7 7 0 1 1 15 3Z', '#ffcf5c');
    star(c, 6, 6, 2, '#ffe9a8');
    box(c, 3, 18, 18, 4, 2, '#c9bcf8');
  }),
  shop: icon(28, (c) => {
    fill(c, 'M5 9H19L18 21H6Z', '#ff9fb5');
    stroke(c, 'M9 10V7Q12 3 15 7V10', '#e97f99', 1.8);
    star(c, 12, 15, 3, WHITE);
  }),
  chest: icon(28, (c) => {
    box(c, 3, 9, 18, 12, 2, '#d9a878');
    fill(c, 'M3 11Q3 4 12 4Q21 4 21 11Z', '#f3cfa6');
    box(c, 3, 10, 18, 2.5, 1, '#ffcf5c');
    box(c, 10, 11, 4, 5, 1, '#ffcf5c');
  }),
  event: icon(28, (c) => {
    oval(c, 12, 12, 10, 10, '#c9bcf8');
    stroke(c, 'M9 9Q9 5 12.5 5Q16 5 16 9Q16 11 12.5 13V15', WHITE, 2.4);
    oval(c, 12.5, 19, 1.5, 1.5, WHITE);
  }),
  boss: icon(28, (c) => {
    fill(c, 'M3 19L4 7L9 12L12 4L15 12L20 7L21 19Z', '#ffcf5c');
    box(c, 3, 18, 18, 3, 1, '#f2b84b');
    oval(c, 12, 13, 1.6, 1.6, '#ff8f8f');
  }),
};

function treasure(draw: (c: Ctx) => void): Art {
  return icon(22, draw);
}

const TREASURE_ART: Readonly<Record<TreasureId, Art>> = {
  cushion: treasure((c) => {
    cloudShape(c, 12, 13, 8, '#ffc6d4');
    oval(c, 12, 11, 3, 2, '#ffe3ea');
  }),
  badge: treasure((c) => {
    fill(c, shieldPath(12, 12, 10), '#9dd6ff');
    star(c, 12, 12, 4, WHITE);
  }),
  ribbon: treasure((c) => {
    fill(c, 'M12 11L3 5V17Z', '#ff8f8f');
    fill(c, 'M12 11L21 5V17Z', '#ff8f8f');
    fill(c, 'M12 11L8 22H11Z', '#e06d75');
    fill(c, 'M12 11L16 22H13Z', '#e06d75');
    oval(c, 12, 11, 3, 3, '#e06d75');
  }),
  hourglass: treasure((c) => {
    box(c, 5, 2, 14, 3, 1, '#c98a5a');
    box(c, 5, 19, 14, 3, 1, '#c98a5a');
    fill(c, 'M7 5H17L12 12L17 19H7L12 12Z', '#e3f2ff');
    fill(c, 'M9 16H15L12 12Z', '#ffcf5c');
  }),
  candy: treasure((c) => {
    star(c, 12, 12, 9, '#ff9fb5', 6, 0.7);
    oval(c, 10, 9, 2, 1.4, 'rgba(255,255,255,0.8)', -0.5);
  }),
  glove: treasure((c) => {
    box(c, 6, 8, 12, 13, 5, '#8fa35a');
    box(c, 3, 10, 5, 7, 2.5, '#8fa35a');
    for (const x of [8, 12, 16]) fill(c, `M${x - 2} 9L${x} 3L${x + 2} 9Z`, '#b9cf7a');
  }),
  piggy: treasure((c) => {
    oval(c, 12, 13, 9, 7.5, '#ffb3c4');
    oval(c, 19, 13, 3, 2.6, '#ff9fb5');
    fill(c, 'M7 7L9 3L11 7Z', '#ff9fb5');
    oval(c, 9, 11, 1.2, 1.2, INK);
    box(c, 10, 6, 5, 1.6, 0.8, '#e97f99');
  }),
  clover: treasure((c) => {
    for (const [x, y] of [
      [8, 8],
      [16, 8],
      [8, 15],
      [16, 15],
    ] as const) {
      oval(c, x, y, 4.2, 4.2, '#7fd3ae');
    }
    stroke(c, 'M12 12L16 22', '#57b98f', 1.8);
  }),
  feather: treasure((c) => {
    fill(c, 'M19 3Q4 6 5 20Q15 18 19 3Z', '#e3f2ff');
    stroke(c, 'M19 3Q10 12 5 20', '#9dd6ff', 1.4);
  }),
  honey: treasure((c) => {
    fill(c, 'M5 9Q5 21 12 21Q19 21 19 9Z', '#f2b84b');
    box(c, 5, 5, 14, 5, 2, '#d9a878');
    fill(c, 'M7 10Q12 14 17 10V12Q12 16 7 12Z', '#ffd866');
  }),
  pouch: treasure((c) => {
    oval(c, 12, 15, 8, 7, '#b49ae0');
    fill(c, 'M8 8H16L14 10H10Z', '#9684e0');
    oval(c, 9, 15, 1.6, 1.6, '#7fcf6a');
    oval(c, 14, 17, 1.6, 1.6, '#7fcf6a');
  }),
  kettle: treasure((c) => {
    oval(c, 11, 14, 8, 7, '#9be3c9');
    fill(c, 'M18 12L23 8L21 14Z', '#7fd3ae');
    box(c, 8, 5, 6, 3, 1.5, '#7fd3ae');
    stroke(c, 'M5 10Q2 14 5 18', '#7fd3ae', 1.6);
  }),
  bigStar: treasure((c) => {
    star(c, 12, 12, 10, '#ffcf5c');
    oval(c, 12, 13, 2.5, 2.5, '#fff0c9');
  }),
  sleepyMoon: treasure((c) => {
    fill(c, 'M14 2A10 10 0 1 0 22 16A8 8 0 1 1 14 2Z', '#c9bcf8');
    stroke(c, 'M8 12Q10 14 12 12', INK, 1.2);
  }),
  marble: treasure((c) => {
    oval(c, 12, 12, 10, 10, '#ff9fb5');
    fill(c, 'M2 12A10 10 0 0 1 12 2V12Z', '#9dd6ff');
    fill(c, 'M12 22A10 10 0 0 0 22 12H12Z', '#9be3c9');
    oval(c, 8, 8, 2.5, 1.6, 'rgba(255,255,255,0.85)', -0.6);
  }),
};

const UPGRADE_ART: Readonly<Record<UpgradeId, Art>> = {
  hp: icon(22, (c) => fill(c, heartPath(12, 13, 10), '#ff8f8f')),
  gold: icon(22, (c) => {
    star(c, 9, 13, 6, '#ff9fb5', 6, 0.7);
    star(c, 16, 9, 5, '#9dd6ff', 6, 0.7);
    star(c, 16, 17, 4, '#ffcf5c', 6, 0.7);
  }),
  rest: NODE_ART.rest,
  choice: icon(22, (c) => {
    box(c, 2, 6, 7, 11, 2, '#ff8f8f');
    box(c, 8.5, 4, 7, 11, 2, '#9dd6ff');
    box(c, 15, 6, 7, 11, 2, '#ffe9a8');
  }),
  relic: TREASURE_ART.clover,
  pack1: icon(22, (c) => {
    box(c, 4, 4, 14, 18, 3, '#c9bcf8');
    star(c, 11, 13, 4, WHITE);
  }),
  pack2: icon(22, (c) => {
    box(c, 4, 4, 14, 18, 3, '#ff9fb5');
    star(c, 11, 13, 4, '#ffcf5c');
  }),
};

const CARD_TYPE_ART: Readonly<Record<CardType, Art>> = {
  attack: icon(26, (c) => {
    stroke(c, 'M5 20L15 8', '#c98a5a', 2.8);
    star(c, 16, 7, 5.5, '#ffcf5c');
  }),
  skill: icon(26, (c) => {
    fill(c, shieldPath(12, 12, 10), '#7dbef2');
    cloudShape(c, 12, 12, 5, WHITE);
  }),
  power: icon(26, (c) => {
    star(c, 12, 12, 10, '#ffcf5c', 4, 0.35);
    star(c, 19, 5, 3, '#ff9fb5', 4, 0.35);
  }),
};

const ITEM_ART: Readonly<Record<string, Art>> = {
  [TEX.bunny]: BUNNY,
  [TEX.candy]: icon(14, (c) => {
    star(c, 12, 12, 10, '#ff9fb5', 6, 0.68);
    oval(c, 9, 8, 2.5, 1.6, 'rgba(255,255,255,0.85)', -0.5);
  }),
  [TEX.shard]: icon(14, (c) => {
    cloudShape(c, 12, 13, 9, '#9dd6ff');
    cloudShape(c, 12, 12, 6.5, '#e3f2ff');
    star(c, 12, 12, 3, '#ffcf5c');
  }),
  [TEX.mana]: icon(22, (c) => {
    oval(c, 12, 12, 11, 11, '#9684e0');
    oval(c, 12, 12, 9, 9, '#c9bcf8');
    oval(c, 9, 8, 3, 2, 'rgba(255,255,255,0.85)', -0.5);
  }),
  [TEX.heart]: icon(12, (c) => fill(c, heartPath(12, 13, 10), '#ff8f8f')),
  [TEX.shield]: icon(14, (c) => {
    fill(c, shieldPath(12, 12, 11), '#7dbef2');
    fill(c, shieldPath(12, 12, 7), '#c8e6ff');
  }),
  [TEX.sword]: icon(14, (c) => {
    stroke(c, 'M4 20L18 6', '#e06d75', 3.2);
    stroke(c, 'M6 13L11 18', '#c98a5a', 2.4);
    stroke(c, 'M18 6L20 4', '#e06d75', 3);
  }),
  [TEX.buff]: icon(14, (c) => {
    fill(c, 'M12 2L21 12H15V22H9V12H3Z', '#7fd3ae');
  }),
  [TEX.debuff]: icon(14, (c) => {
    oval(c, 12, 12, 10, 10, '#b49ae0');
    stroke(c, 'M12 6Q18 8 16 13Q13 17 9 13Q8 10 12 10', WHITE, 2);
  }),
  [TEX.deck]: icon(16, (c) => {
    box(c, 6, 3, 13, 18, 3, '#c9bcf8');
    box(c, 3, 5, 13, 18, 3, '#9684e0');
    star(c, 9.5, 14, 3, WHITE);
  }),
  [TEX.discard]: icon(16, (c) => {
    box(c, 5, 5, 13, 18, 3, '#f3dcd3');
    box(c, 8, 2, 13, 18, 3, '#e5c7bb');
    stroke(c, 'M11 9L17 15M17 9L11 15', WHITE, 1.8);
  }),
  [TEX.spark]: icon(10, (c) => star(c, 12, 12, 10, '#ffcf5c', 4, 0.35)),
};

export function registerTowerTextures(scene: Phaser.Scene): void {
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
  for (const [look, art] of Object.entries(ENEMY_ART)) add(enemyTexture(look as EnemyLook), art);
  for (const [id, art] of Object.entries(STATUS_ART)) add(statusTexture(id as StatusId), art);
  for (const [kind, art] of Object.entries(NODE_ART)) add(nodeTexture(kind as NodeKind), art);
  for (const [id, art] of Object.entries(TREASURE_ART)) add(treasureTexture(id as TreasureId), art);
  for (const [id, art] of Object.entries(UPGRADE_ART)) add(upgradeTexture(id as UpgradeId), art);
  for (const [type, art] of Object.entries(CARD_TYPE_ART)) add(cardTypeTexture(type as CardType), art);
  for (const [key, art] of Object.entries(ITEM_ART)) add(key, art);
}
