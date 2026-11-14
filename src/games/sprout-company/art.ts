/**
 * 새싹 컴퍼니 전용 그림. 공용 art/ 폴더를 건드리지 않도록 이 게임 안에서 만든다.
 * 캔버스에 곡선으로 그려 텍스처로 등록한다. 크기는 모두 논리 픽셀이다.
 */
import type Phaser from 'phaser';
import { THEME_CSS } from '../../config';
import { addHiResCanvas, renderScale } from '../../core/hidpi';
import { DEPARTMENTS, type DepartmentDef, type DepartmentId, type TaskKind } from './data';

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

/** 돕는 부서의 색. 일하는 부서는 맡은 업무의 색을 쓴다. */
const SUPPORT_COLORS: Readonly<Record<string, { face: number; deep: number; css: string }>> = {
  music: { face: 0xe0d4ff, deep: 0xb9a2f0, css: '#7a63c9' },
  pr: { face: 0xffd9c2, deep: 0xf5a57a, css: '#c9662e' },
  service: { face: 0xdcefb0, deep: 0xb5d671, css: '#5f8f1e' },
};

/** 부서의 색과 그림. 일하는 부서는 맡은 업무의 것을, 돕는 부서는 제 것을 쓴다. */
export function departmentLook(id: DepartmentId): { face: number; deep: number; css: string; texture: string } {
  const kind = (DEPARTMENTS[id] as DepartmentDef).kind;
  if (kind) return { ...TASK_COLORS[kind], texture: taskTexture(kind) };
  return { ...(SUPPORT_COLORS[id] ?? TASK_COLORS.plan), texture: `sc-dept-${id}` };
}

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
  fruit: 'sc-fruit',
  chair: 'sc-chair',
  printer: 'sc-printer',
  meeting: 'sc-meeting',
  heart: 'sc-heart',
  sofa: 'sc-sofa',
  snack: 'sc-snack',
  nap: 'sc-nap',
  idea: 'sc-idea',
  bug: 'sc-bug',
  pair: 'sc-pair',
  flower: 'sc-flower',
  flowerOff: 'sc-flower-off',
} as const;

export const COMPUTER_SIZE = { width: 26, height: 22 } as const;

/** 화면이 켜진 모니터. (x, y)는 왼쪽 위, 받침은 아래로 붙는다. */
/** 22×22 칸에 꽃잎 다섯 장의 꽃을 그린다. 어느 바탕에서도 보이게 흰 테두리를 두른다. */
function flower(c: Ctx, petal: string, middle: string): void {
  const petals = Array.from({ length: 5 }, (_, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / 5;
    return [11 + Math.cos(angle) * 5.6, 11 + Math.sin(angle) * 5.6] as const;
  });
  for (const [x, y] of petals) oval(c, x, y, 5.2, 5.2, WHITE);
  for (const [x, y] of petals) oval(c, x, y, 4.1, 4.1, petal);
  oval(c, 11, 11, 3.3, 3.3, middle);
}

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
  /** 열매: 자회사를 세우면 받는다. 본사의 힘을 올리는 데 쓴다. */
  'sc-fruit': {
    width: 12,
    height: 12,
    view: [24, 24],
    draw(c) {
      stroke(c, 'M12 9C12 6.5 12.6 4.6 14 3', '#9a7353', 1.8);
      fill(c, 'M13.4 6.4C15 3.2 18.4 2.4 21 3.6 19.8 6.6 16.6 8 13.4 6.4z', '#5cc79a');
      oval(c, 12, 14.4, 8.4, 7.8, '#ff8a9e');
      oval(c, 12, 15.4, 8.4, 6.8, '#ff9fb0');
      oval(c, 8.6, 12, 2, 2.8, '#ffd3db', -0.5);
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
  /** 편한 의자: 등받이가 둥근 바퀴 의자 */
  'sc-chair': {
    width: 22,
    height: 22,
    draw(c) {
      box(c, 6, 1.5, 10, 10.5, 3.6, '#ff9fb5');
      box(c, 7.6, 3.2, 6.8, 6, 2.4, '#ffc4d3');
      box(c, 4, 11.5, 14, 4, 2, '#f07f9c');
      box(c, 10, 15.2, 2, 3.2, 0, '#8d7aa8');
      stroke(c, 'M5.5 19h11', '#8d7aa8', 1.6);
      oval(c, 5.5, 20, 1.3, 1.3, '#4a3f66');
      oval(c, 16.5, 20, 1.3, 1.3, '#4a3f66');
    },
  },
  /** 복합기: 종이가 나오는 기계 */
  'sc-printer': {
    width: 22,
    height: 22,
    draw(c) {
      box(c, 6, 1.5, 10, 7, 1, '#fffaf0');
      stroke(c, 'M8 4h6M8 6h4', '#d9d2e6', 1);
      box(c, 2, 7, 18, 9, 2.4, '#c8b8f0');
      box(c, 2, 12, 18, 4, 2, '#a892e6');
      oval(c, 16.5, 10, 1, 1, '#8fe0bd');
      box(c, 5, 13.5, 12, 7, 1, '#fffaf0');
      stroke(c, 'M7 16.500h8M7 18.500h5', '#d9d2e6', 1);
    },
  },
  /** 회의실: 둥근 탁자와 말풍선 */
  'sc-meeting': {
    width: 22,
    height: 22,
    draw(c) {
      box(c, 3, 1.5, 12, 8, 3, '#bfe3ff');
      fill(c, 'M6 9l-1 3.500 4-3.500z', '#bfe3ff');
      oval(c, 6.6, 5.5, 0.9, 0.9, '#3f86c4');
      oval(c, 9, 5.5, 0.9, 0.9, '#3f86c4');
      oval(c, 11.4, 5.5, 0.9, 0.9, '#3f86c4');
      oval(c, 11, 15, 9, 3.6, '#e0b98a');
      oval(c, 11, 14, 9, 3.6, '#f0cfa5');
      box(c, 10, 16.5, 2, 4, 0, '#e0b98a');
      box(c, 7, 19.6, 8, 1.8, 0.9, '#e0b98a');
    },
  },
  /** 음악부: 음표 */
  'sc-dept-music': {
    width: 16,
    height: 16,
    view: [24, 24],
    draw(c) {
      stroke(c, 'M10 18V6.5l9-2V16', '#8d7aa8', 2.2);
      oval(c, 7.2, 18, 3.6, 2.8, '#9684e0', -0.3);
      oval(c, 16.2, 16, 3.6, 2.8, '#9684e0', -0.3);
    },
  },
  /** 홍보부: 확성기 */
  'sc-dept-pr': {
    width: 16,
    height: 16,
    view: [24, 24],
    draw(c) {
      box(c, 6.5, 13, 3.4, 7.5, 1.4, '#8d7aa8');
      fill(c, 'M3.5 9.5h4.5l8-5v15l-8-5H3.5z', '#f59a5c');
      box(c, 2.5, 9, 3.6, 6, 1.4, '#ffd0a8');
      stroke(c, 'M19 9c1.6 1.6 1.6 4.4 0 6', '#f59a5c', 1.8);
    },
  },
  /** 고객 응대부: 머리에 쓰는 전화기 */
  'sc-dept-service': {
    width: 16,
    height: 16,
    view: [24, 24],
    draw(c) {
      stroke(c, 'M5.5 14v-2.5a6.5 6.5 0 0 1 13 0V14', '#8d7aa8', 2.2);
      box(c, 3, 12.5, 4.6, 7.5, 2, '#8fcf5c');
      box(c, 16.4, 12.5, 4.6, 7.5, 2, '#8fcf5c');
      stroke(c, 'M18.6 20c0 1.8-2 2.4-4.6 2.4', '#8d7aa8', 1.6);
      oval(c, 13, 22.3, 1.7, 1.3, '#5f8f1e');
    },
  },
  /** 단짝이 옆자리에 앉았다 */
  'sc-heart': {
    width: 10,
    height: 10,
    view: [20, 20],
    draw(c) {
      fill(c, 'M10 18C4 13.500 1 10 1 6.500 1 3.500 3.300 1.500 6 1.500c1.600 0 3 .800 4 2 1-1.200 2.400-2 4-2 2.700 0 5 2 5 5 0 3.500-3 7-9 11.500z', '#ff7f9c');
      oval(c, 6, 6, 1.6, 2.2, '#ffc4d3', -0.5);
    },
  },
  /** 소파: 휴게실에서 쉬는 자리 */
  'sc-sofa': {
    width: 22,
    height: 22,
    draw(c) {
      box(c, 4, 4, 14, 10, 4, '#8fe0bd');
      box(c, 1.5, 9, 5, 9, 2.4, '#5cc79a');
      box(c, 15.5, 9, 5, 9, 2.4, '#5cc79a');
      box(c, 5, 11, 12, 6, 2, '#bdeedb');
      box(c, 3, 18, 2.4, 2.6, 0.8, '#8d7aa8');
      box(c, 16.6, 18, 2.4, 2.6, 0.8, '#8d7aa8');
    },
  },
  /** 간식: 접시에 담긴 쿠키와 음료 */
  'sc-snack': {
    width: 22,
    height: 22,
    draw(c) {
      box(c, 13, 5, 6.5, 12, 1.6, '#ffc4d3');
      box(c, 13, 5, 6.5, 3.4, 1.6, '#fffaf0');
      stroke(c, 'M16.500 5.500V2l2-1', '#8d7aa8', 1.2);
      oval(c, 8, 17.5, 7, 2.6, '#d9d2e6');
      oval(c, 8, 16.8, 7, 2.4, '#fffaf0');
      oval(c, 7.5, 12.5, 4.6, 4.2, '#f0cfa5');
      oval(c, 6, 11.4, 0.9, 0.9, '#9a7353');
      oval(c, 8.8, 12.4, 0.9, 0.9, '#9a7353');
      oval(c, 7, 14.2, 0.9, 0.9, '#9a7353');
    },
  },
  /** 쉬는 중: 졸음 표시 */
  'sc-nap': {
    width: 14,
    height: 14,
    view: [28, 28],
    draw(c) {
      stroke(c, 'M4 15h8l-8 9h8', '#8d7aa8', 2.6);
      stroke(c, 'M15 4h8l-8 9h8', '#a892e6', 2.6);
    },
  },
  /** 아이디어 카드: 흰 동그라미 안의 반짝이 */
  'sc-idea': {
    width: 16,
    height: 16,
    view: [22, 22],
    draw(c) {
      oval(c, 11, 11, 11, 11, WHITE);
      oval(c, 11, 11, 9.4, 9.4, '#fff3c4');
      fill(c, 'M11 3c.9 4.9 3.1 7.1 8 8-4.9.9-7.1 3.1-8 8-.9-4.9-3.100-7.100-8-8 4.900-.9 7.100-3.100 8-8z', '#f5a700');
    },
  },
  /** 버그 카드: 흰 동그라미 안의 붉은 벌레 */
  'sc-bug': {
    width: 16,
    height: 16,
    view: [22, 22],
    draw(c) {
      oval(c, 11, 11, 11, 11, WHITE);
      stroke(c, 'M6 9.500l-2.600-1.500M5.500 13H2.500M6 16.500l-2.400 1.800M16 9.500l2.600-1.500M16.500 13h3M16 16.500l2.400 1.800', '#4a3f5c', 1.3);
      oval(c, 11, 6.6, 3.4, 2.8, '#4a3f5c');
      oval(c, 11, 12.6, 5.6, 6, '#e8505b');
      stroke(c, 'M11 7v11.500', '#4a3f5c', 1.1);
      oval(c, 8.4, 11.2, 1.1, 1.1, '#4a3f5c');
      oval(c, 13.6, 11.2, 1.1, 1.1, '#4a3f5c');
      oval(c, 8.8, 15, 1, 1, '#4a3f5c');
      oval(c, 13.2, 15, 1, 1, '#4a3f5c');
    },
  },
  /** 협업 카드: 흰 동그라미 안의 맞물린 고리 둘 */
  'sc-pair': {
    width: 16,
    height: 16,
    view: [22, 22],
    draw(c) {
      oval(c, 11, 11, 11, 11, WHITE);
      stroke(c, 'M4.300 11a4.200 4.200 0 1 0 8.400 0a4.200 4.200 0 1 0-8.400 0', '#7c6cf0', 2.2);
      stroke(c, 'M9.300 11a4.200 4.200 0 1 0 8.400 0a4.200 4.200 0 1 0-8.400 0', '#2fae93', 2.2);
    },
  },
  /** 출시 평가의 꽃 한 송이 */
  'sc-flower': {
    width: 16,
    height: 16,
    view: [22, 22],
    draw(c) {
      flower(c, '#ff8fb0', '#ffd24a');
    },
  },
  /** 아직 피지 않은 꽃 */
  'sc-flower-off': {
    width: 16,
    height: 16,
    view: [22, 22],
    draw(c) {
      flower(c, '#d6cee6', '#bfb4d6');
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
