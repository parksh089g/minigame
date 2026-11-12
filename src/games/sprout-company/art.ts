/**
 * 새싹 컴퍼니 전용 그림. 공용 art/ 폴더를 건드리지 않도록 이 게임 안에서 만든다.
 * 캔버스에 곡선으로 그려 텍스처로 등록한다. 크기는 모두 논리 픽셀이다.
 */
import type Phaser from 'phaser';
import { THEME_CSS } from '../../config';
import { addHiResCanvas, renderScale } from '../../core/hidpi';
import type { TaskKind } from './data';

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

/** 업무의 색: 카드의 바탕, 짙은 테두리, 옅은 바탕 */
export const TASK_COLORS: Readonly<Record<TaskKind, { face: number; deep: number; css: string }>> = {
  plan: { face: 0xffe9a8, deep: 0xf2c75c, css: '#c98a1e' },
  art: { face: 0xffc4d3, deep: 0xf59bb2, css: '#d9608a' },
  code: { face: 0xbfe3ff, deep: 0x8cc4f0, css: '#3f86c4' },
  test: { face: 0xbdeedb, deep: 0x86d6b6, css: '#2f9a74' },
};

export const taskTexture = (kind: TaskKind): string => `sc-task-${kind}`;

/** 컴퓨터는 레벨이 오르면 모습이 바뀐다. */
const COMPUTER_TIERS = [1, 5, 10, 15] as const;
export function computerTexture(level: number): string {
  let tier = -1;
  for (const from of COMPUTER_TIERS) if (level >= from) tier += 1;
  return tier < 0 ? 'sc-notebook' : `sc-computer-${tier}`;
}

export const SC = {
  leaf: 'sc-leaf',
  coffee: 'sc-coffee',
  spark: 'sc-spark',
  plant: 'sc-plant',
  window: 'sc-window',
  tray: 'sc-tray',
  internet: 'sc-internet',
  server: 'sc-server',
  rush: 'sc-rush',
} as const;

export const COMPUTER_SIZE = { width: 26, height: 22 } as const;

/** 화면이 켜진 모니터. (x, y)는 왼쪽 위, 받침은 아래로 붙는다. */
function monitor(c: Ctx, x: number, y: number, w: number, h: number, frame: string, screen: string): void {
  box(c, x + w / 2 - 2, y + h - 1, 4, 4, 1, '#b9b3c9');
  box(c, x + w / 2 - 5, y + h + 2, 10, 2.4, 1.2, '#b9b3c9');
  box(c, x, y, w, h, 2.6, frame);
  box(c, x + 1.6, y + 1.6, w - 3.2, h - 3.6, 1.4, screen);
  stroke(c, `M${x + 3.4} ${y + 4.4}h${w * 0.3}`, WHITE, 1.1);
  stroke(c, `M${x + 3.4} ${y + 7}h${w * 0.18}`, WHITE, 1.1);
}

/** 머리만 있는 직원의 그림 크기 */
const HEAD_SIZE = { width: 28, height: 28 } as const;

/** 두 눈과 볼. left와 right는 눈의 x, y는 눈의 높이다. */
function face(c: Ctx, left: number, right: number, y: number): void {
  oval(c, left, y, 1.4, 1.8, INK);
  oval(c, right, y, 1.4, 1.8, INK);
  oval(c, left - 2.6, y + 3.4, 1.9, 1.2, '#ffb3c4');
  oval(c, right + 2.6, y + 3.4, 1.9, 1.2, '#ffb3c4');
}

const ARTS: Record<string, Art> = {
  /** 기획: 전구 */
  'sc-task-plan': {
    width: 16,
    height: 16,
    view: [24, 24],
    draw(c) {
      oval(c, 12, 10, 6.6, 6.6, '#ffcf5c');
      box(c, 9, 14.6, 6, 3.4, 1, '#ffcf5c');
      box(c, 9.2, 18, 5.6, 3, 1.2, '#8d7aa8');
      oval(c, 9.8, 7.8, 1.5, 2.2, '#fff3c4', -0.6);
    },
  },
  /** 그림: 붓 */
  'sc-task-art': {
    width: 16,
    height: 16,
    view: [24, 24],
    draw(c) {
      stroke(c, 'M19.5 4.500 11.500 12.500', '#c89b6d', 3.2);
      stroke(c, 'M12.300 11.700 10.300 13.700', '#b9b3c9', 3.6);
      fill(c, 'M10.500 13.500c-3-1-6 1-5.500 4.500 0 1.500-1 2-2 2.300 3.500 1.200 8 .700 9.300-3.300.500-1.500-.300-2.800-1.800-3.500z', '#ff7fa3');
    },
  },
  /** 코딩: 꺾쇠 */
  'sc-task-code': {
    width: 16,
    height: 16,
    view: [24, 24],
    draw(c) {
      stroke(c, 'M8.500 7 3.500 12l5 5', '#3f86c4', 3);
      stroke(c, 'M15.500 7l5 5-5 5', '#3f86c4', 3);
      stroke(c, 'M13.300 5.500 10.700 18.500', '#7db8ea', 2.4);
    },
  },
  /** 검사: 돋보기 */
  'sc-task-test': {
    width: 16,
    height: 16,
    view: [24, 24],
    draw(c) {
      stroke(c, 'M15 15l5.500 5.500', '#8d7aa8', 3.6);
      oval(c, 10.5, 10.5, 7, 7, '#2f9a74');
      oval(c, 10.5, 10.5, 4.6, 4.6, '#e6fbf2');
      stroke(c, 'M8.300 10.700l1.700 1.700 3-3.300', '#2f9a74', 1.7);
    },
  },
  /** 잎사귀: 회사의 돈 */
  'sc-leaf': {
    width: 12,
    height: 12,
    view: [24, 24],
    draw(c) {
      fill(c, 'M4 20C3 10 9 3.500 21 3c.500 12-6 18-16 17z', '#5cc79a');
      fill(c, 'M4 20C3 10 9 3.500 21 3 12 6 7 11 4 20z', '#8fe0bd');
      stroke(c, 'M4.500 19.500C8 13 12 9 17 6.500', '#3fa77c', 1.8);
    },
  },
  /** 컴퓨터가 없을 때: 공책과 연필 */
  'sc-notebook': {
    ...COMPUTER_SIZE,
    draw(c) {
      box(c, 5, 12, 15, 9, 1.6, '#fffaf0');
      box(c, 5, 12, 15, 2.6, 1.3, '#ffb3c4');
      stroke(c, 'M8 17h9M8 19.200h6', '#d9d2e6', 1);
      stroke(c, 'M21 11l2.500 8', '#ffcf5c', 1.8);
    },
  },
  /** 낡은 컴퓨터: 뚱뚱한 모니터 */
  'sc-computer-0': {
    ...COMPUTER_SIZE,
    draw(c) {
      box(c, 5.5, 17.5, 15, 3.5, 1.4, '#cfc8dc');
      box(c, 4, 4, 18, 14.5, 3.4, '#e4deee');
      box(c, 6.2, 6.2, 13.6, 9.6, 2, '#a9c9c0');
      stroke(c, 'M8.300 9h4M8.300 11.500h2.500', '#e6fbf2', 1.1);
      oval(c, 19, 17, 0.8, 0.8, '#86d6b6');
    },
  },
  /** 납작한 모니터 */
  'sc-computer-1': {
    ...COMPUTER_SIZE,
    draw: (c) => monitor(c, 3.5, 2.5, 19, 13.5, '#8d7aa8', '#9dd6ff'),
  },
  /** 넓은 모니터 */
  'sc-computer-2': {
    ...COMPUTER_SIZE,
    draw: (c) => monitor(c, 1, 2, 24, 14, '#6b5b8c', '#b9a9f5'),
  },
  /** 모니터 두 대 */
  'sc-computer-3': {
    ...COMPUTER_SIZE,
    draw(c) {
      monitor(c, 0.5, 4.5, 13, 11, '#4a3f66', '#ffb3c4');
      monitor(c, 12.5, 2, 13, 13.5, '#4a3f66', '#8fe0bd');
      oval(c, 23.6, 3.2, 1.2, 1.2, '#ffcf5c');
    },
  },
  /** 커피 머신 */
  'sc-coffee': {
    width: 20,
    height: 24,
    draw(c) {
      box(c, 3, 2, 14, 20, 3, '#c8b8f0');
      box(c, 3, 2, 14, 6, 3, '#a892e6');
      box(c, 5.5, 10, 9, 8.5, 1.6, '#4a3f66');
      box(c, 7.6, 13.8, 4.8, 4.4, 1, '#fffaf0');
      stroke(c, 'M12.400 15h1.200v1.800h-1.200', '#fffaf0', 0.9);
      oval(c, 7, 5, 1, 1, '#ffcf5c');
      oval(c, 10, 5, 1, 1, '#ff9fb5');
      stroke(c, 'M9.300 12.600q-.800-1 0-2M10.900 12.600q-.800-1 0-2', WHITE, 0.7);
      box(c, 2, 21, 16, 2.4, 1.2, '#8d7aa8');
    },
  },
  /** 응원했을 때 튀는 반짝이 */
  'sc-spark': {
    width: 10,
    height: 10,
    view: [20, 20],
    draw(c) {
      fill(c, 'M10 1c1 5.500 3.500 8 9 9-5.500 1-8 3.500-9 9-1-5.500-3.500-8-9-9 5.500-1 8-3.500 9-9z', '#ffcf5c');
    },
  },
  /** 사무실 구석의 화분 */
  'sc-plant': {
    width: 18,
    height: 26,
    draw(c) {
      stroke(c, 'M9 18V9', '#3fa77c', 1.6);
      fill(c, 'M9 11C3 11 2 6 2.500 3.500 7 4 9.500 6.500 9 11z', '#8fe0bd');
      fill(c, 'M9 9c5.500.500 7-4 7-7-4 0-7.500 2.500-7 7z', '#5cc79a');
      fill(c, 'M9 15c-4 0-5.500-2.500-5.500-4.500 3 0 5.500 1.500 5.500 4.500z', '#5cc79a');
      fill(c, 'M4 17h10l-1.300 7.500a1.500 1.500 0 0 1-1.500 1.200H6.800a1.500 1.500 0 0 1-1.500-1.200z', '#f2a98c');
      box(c, 3.2, 16, 11.6, 2.6, 1.2, '#e58f72');
    },
  },
  /** 사무실 벽의 창문 */
  'sc-window': {
    width: 34,
    height: 26,
    draw(c) {
      box(c, 0, 0, 34, 26, 4, '#fffaf0');
      box(c, 2.5, 2.5, 29, 21, 2.4, '#bfe3ff');
      oval(c, 10, 17, 6, 3.2, WHITE);
      oval(c, 15, 15, 5, 3.6, WHITE);
      oval(c, 25, 8, 3, 3, '#ffe9a8');
      box(c, 16, 2.5, 2, 21, 0, '#fffaf0');
      box(c, 2.5, 12, 29, 2, 0, '#fffaf0');
    },
  },
  /** 일감함: 서류가 꽂힌 받침 */
  'sc-tray': {
    width: 22,
    height: 22,
    draw(c) {
      box(c, 5.5, 3.5, 12, 12, 1.4, '#bfe3ff');
      box(c, 4, 6.5, 14, 10, 1.4, '#fffaf0');
      stroke(c, 'M6.5 10h8M6.5 12.5h5', '#d9d2e6', 1);
      box(c, 2, 14, 18, 6.5, 2, '#c8b8f0');
      box(c, 7.5, 16.2, 7, 2, 1, '#a892e6');
    },
  },
  /** 인터넷: 안테나가 달린 공유기 */
  'sc-internet': {
    width: 22,
    height: 22,
    draw(c) {
      stroke(c, 'M5.5 13V7.5M16.5 13V7.5', '#8d7aa8', 1.6);
      stroke(c, 'M7.5 5.5q3.5-3.5 7 0', '#3f86c4', 1.3);
      stroke(c, 'M9.3 8.2q1.7-1.7 3.4 0', '#3f86c4', 1.3);
      box(c, 2, 12.5, 18, 6.5, 2.4, '#bfe3ff');
      box(c, 2, 16, 18, 3, 1.5, '#8cc4f0');
      oval(c, 6, 15, 1, 1, '#5cc79a');
      oval(c, 9.5, 15, 1, 1, '#ffcf5c');
      box(c, 4, 19, 3, 1.8, 0.8, '#8d7aa8');
      box(c, 15, 19, 3, 1.8, 0.8, '#8d7aa8');
    },
  },
  /** 서버: 불이 깜박이는 선반 */
  'sc-server': {
    width: 22,
    height: 22,
    draw(c) {
      box(c, 4, 1, 14, 19.5, 2.4, '#6b5b8c');
      const lights = ['#8fe0bd', '#ffcf5c', '#ff9fb5'];
      lights.forEach((light, index) => {
        const y = 3 + index * 5.6;
        box(c, 6, y, 10, 4.2, 1, '#8d7aa8');
        oval(c, 8, y + 2.1, 0.9, 0.9, light);
        stroke(c, `M11 ${y + 2.1}h3.2`, '#c8b8f0', 1);
      });
      box(c, 3, 19.5, 16, 2.2, 1.1, '#4a3f66');
    },
  },
  /** 급한 의뢰: 자명종 */
  'sc-rush': {
    width: 18,
    height: 18,
    draw(c) {
      oval(c, 4.3, 4, 2.6, 2.6, '#e06d75');
      oval(c, 13.7, 4, 2.6, 2.6, '#e06d75');
      stroke(c, 'M4.6 15.6l-1.2 1.6M13.4 15.6l1.2 1.6', '#e06d75', 1.4);
      oval(c, 9, 10, 7.2, 7.2, '#ff8f8f');
      oval(c, 9, 10, 5.3, 5.3, WHITE);
      stroke(c, 'M9 7v3.2l2.2 1.3', INK, 1.2);
    },
  },
  /** 곰 */
  'sc-staff-bear': {
    ...HEAD_SIZE,
    draw(c) {
      oval(c, 6.5, 7, 4.6, 4.6, '#b98a62');
      oval(c, 21.5, 7, 4.6, 4.6, '#b98a62');
      oval(c, 6.5, 7, 2.2, 2.2, '#f2c9a5');
      oval(c, 21.5, 7, 2.2, 2.2, '#f2c9a5');
      oval(c, 14, 16, 11.5, 10.5, '#c99a70');
      oval(c, 14, 19.5, 5.2, 4, '#f6dcc0');
      face(c, 9.3, 18.7, 14.5);
      oval(c, 14, 18, 1.7, 1.2, INK);
      stroke(c, 'M14 19v1.6', INK, 0.9);
    },
  },
  /** 토끼 */
  'sc-staff-rabbit': {
    ...HEAD_SIZE,
    draw(c) {
      oval(c, 9, 7.5, 3, 7, '#ffd9e2', -0.16);
      oval(c, 19, 7.5, 3, 7, '#ffd9e2', 0.16);
      oval(c, 9, 7.5, 1.3, 4.8, '#ff9fb5', -0.16);
      oval(c, 19, 7.5, 1.3, 4.8, '#ff9fb5', 0.16);
      oval(c, 14, 18.5, 10.5, 8.8, '#ffd9e2');
      face(c, 9.6, 18.4, 17.5);
      oval(c, 14, 20.2, 1.3, 1, '#ff7fa3');
    },
  },
  /** 개구리 */
  'sc-staff-frog': {
    ...HEAD_SIZE,
    draw(c) {
      oval(c, 7.5, 8.5, 4.8, 4.8, '#8fd67a');
      oval(c, 20.5, 8.5, 4.8, 4.8, '#8fd67a');
      oval(c, 14, 17.5, 11.5, 9.3, '#8fd67a');
      oval(c, 7.5, 8.5, 3.1, 3.1, WHITE);
      oval(c, 20.5, 8.5, 3.1, 3.1, WHITE);
      oval(c, 8, 9, 1.5, 1.7, INK);
      oval(c, 20, 9, 1.5, 1.7, INK);
      stroke(c, 'M9.5 19q4.5 3.2 9 0', INK, 1.1);
      oval(c, 6.5, 19, 1.9, 1.2, '#ffb3c4');
      oval(c, 21.5, 19, 1.9, 1.2, '#ffb3c4');
    },
  },
  /** 펭귄 */
  'sc-staff-penguin': {
    ...HEAD_SIZE,
    draw(c) {
      oval(c, 14, 15.5, 11, 11.5, '#566699');
      oval(c, 10, 16.5, 5, 6, WHITE);
      oval(c, 18, 16.5, 5, 6, WHITE);
      oval(c, 14, 20.5, 6.5, 5, WHITE);
      face(c, 10, 18, 15.5);
      fill(c, 'M11.3 18.6h5.4L14 21.8z', '#ffb14a');
    },
  },
  /** 여우 */
  'sc-staff-fox': {
    ...HEAD_SIZE,
    draw(c) {
      fill(c, 'M3 3.5l8.5 3-6.5 7z', '#f59a4a');
      fill(c, 'M25 3.5l-8.5 3 6.500 7z', '#f59a4a');
      fill(c, 'M5.4 6l3.800 1.400-2.900 3.100z', '#fff3e6');
      fill(c, 'M22.6 6l-3.800 1.400 2.900 3.100z', '#fff3e6');
      oval(c, 14, 16.5, 11.5, 9.5, '#f7a85a');
      oval(c, 8.5, 20, 5, 4, '#fff3e6');
      oval(c, 19.5, 20, 5, 4, '#fff3e6');
      face(c, 9.5, 18.5, 15.5);
      oval(c, 14, 19.6, 1.6, 1.2, INK);
    },
  },
};

/** 이 게임의 텍스처를 등록한다. 여러 번 불러도 한 번만 만든다. */
export function registerCompanyTextures(scene: Phaser.Scene): void {
  const density = renderScale();
  for (const [key, art] of Object.entries(ARTS)) {
    if (scene.textures.exists(key)) continue;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(art.width * density);
    canvas.height = Math.ceil(art.height * density);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2D 캔버스를 만들 수 없습니다.');
    const [viewWidth, viewHeight] = art.view ?? [art.width, art.height];
    context.scale(canvas.width / viewWidth, canvas.height / viewHeight);
    art.draw(context);
    addHiResCanvas(scene.textures, key, canvas, art.width, art.height);
  }
}

/** 그림에 쓰는 진한 글자색. 화면 쪽에서 같은 색을 쓰도록 내보낸다. */
export const ART_INK = INK;
