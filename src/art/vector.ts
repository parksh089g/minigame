/**
 * 말랑 파스텔 그림. 픽셀 스프라이트(sprites.ts) 대신 캔버스에 곡선으로 그려서 텍스처로 등록한다.
 * 이미지 파일이 없어서 용량이 거의 들지 않고, 화면 배율에 맞춰 언제나 또렷하게 그려진다.
 *
 * 여기서 등록한 이름이 sprites.ts의 이름과 같으면 이쪽 그림이 쓰인다(textures.ts가 먼저 부른다).
 * 크기는 모두 논리 픽셀이다.
 */
import type Phaser from 'phaser';
import { THEME_CSS } from '../config';
import { addHiResCanvas, renderScale } from '../core/hidpi';
import {
  BACKDROP_LOOKS,
  backdropPreviewTexture,
  CARD_BACK_LOOKS,
  GOLD_ORB,
  mascotTexture,
  ORB_LOOKS,
  RUNNER_FRAMES,
  RUNNER_LOOKS,
  runnerTexture,
  type BackdropLook,
  type CardBackLook,
  type CharacterKind,
  type OrbLook,
} from './cosmetics';
import { TEXTURE } from './sprites';

type Ctx = CanvasRenderingContext2D;

const INK = THEME_CSS.inkDeep;
const BLUSH = '#ffb3c4';
const WHITE = '#ffffff';

// ───────── 그리기 도구 ─────────

function fillPath(c: Ctx, d: string, color: string): void {
  c.fillStyle = color;
  c.fill(new Path2D(d));
}

function strokePath(c: Ctx, d: string, color: string, width: number): void {
  c.strokeStyle = color;
  c.lineWidth = width;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.stroke(new Path2D(d));
}

/** 칠하고 같은 색으로 둘레를 한 번 더 그어 모서리를 둥글린다. */
function softPath(c: Ctx, d: string, color: string, round: number): void {
  fillPath(c, d, color);
  strokePath(c, d, color, round);
}

function oval(c: Ctx, cx: number, cy: number, rx: number, ry: number, color: string, rotation = 0): void {
  c.fillStyle = color;
  c.beginPath();
  c.ellipse(cx, cy, rx, ry, rotation, 0, Math.PI * 2);
  c.fill();
}

function ring(c: Ctx, cx: number, cy: number, r: number, color: string, width: number): void {
  c.strokeStyle = color;
  c.lineWidth = width;
  c.beginPath();
  c.arc(cx, cy, r, 0, Math.PI * 2);
  c.stroke();
}

function roundRect(c: Ctx, x: number, y: number, w: number, h: number, r: number, color: string): void {
  c.fillStyle = color;
  c.beginPath();
  c.roundRect(x, y, w, h, r);
  c.fill();
}

/** 꼭짓점이 다섯인 별 모양의 경로. 중심 (cx, cy), 바깥 반지름 r. */
function starPath(cx: number, cy: number, r: number, inner = 0.48): string {
  const points: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? r : r * inner;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    points.push(`${(cx + radius * Math.cos(angle)).toFixed(2)} ${(cy + radius * Math.sin(angle)).toFixed(2)}`);
  }
  return `M${points.join('L')}Z`;
}

type Mood = 'smile' | 'open' | 'dizzy' | 'happy' | 'sleepy' | 'grumpy' | 'none';

interface FaceOptions {
  /** 두 눈 사이의 거리 */
  gap: number;
  /** 눈의 반지름 */
  eye: number;
  mood?: Mood;
  blush?: boolean;
  /** 입을 그리지 않는다(부리가 있는 친구) */
  noMouth?: boolean;
}

/** (x, y)를 두 눈의 가운데로 하는 얼굴. */
function face(c: Ctx, x: number, y: number, options: FaceOptions): void {
  const { gap, eye } = options;
  const mood = options.mood ?? 'smile';
  const left = x - gap / 2;
  const right = x + gap / 2;
  const line = eye * 0.62;

  if (options.blush !== false) {
    oval(c, left - eye * 1.9, y + eye * 2.3, eye * 1.5, eye * 0.95, BLUSH);
    oval(c, right + eye * 1.9, y + eye * 2.3, eye * 1.5, eye * 0.95, BLUSH);
  }

  for (const ex of [left, right]) {
    if (mood === 'dizzy') {
      const s = eye * 0.95;
      strokePath(c, `M${ex - s} ${y - s}L${ex + s} ${y + s}M${ex + s} ${y - s}L${ex - s} ${y + s}`, INK, line);
    } else if (mood === 'happy') {
      strokePath(c, `M${ex - eye * 1.2} ${y + eye * 0.4}Q${ex} ${y - eye * 1.5} ${ex + eye * 1.2} ${y + eye * 0.4}`, INK, line * 1.1);
    } else if (mood === 'sleepy') {
      strokePath(c, `M${ex - eye * 1.1} ${y}Q${ex} ${y + eye * 1.3} ${ex + eye * 1.1} ${y}`, INK, line);
    } else {
      oval(c, ex, y, eye, eye, INK);
      oval(c, ex + eye * 0.34, y - eye * 0.36, eye * 0.33, eye * 0.33, WHITE);
      if (mood === 'grumpy') {
        const tilt = ex < x ? 1 : -1;
        strokePath(
          c,
          `M${ex - eye * 1.3} ${y - eye * 1.5 - tilt * eye * 0.45}L${ex + eye * 1.3} ${y - eye * 1.5 + tilt * eye * 0.45}`,
          INK,
          line * 0.9,
        );
      }
    }
  }

  if (options.noMouth || mood === 'none') return;
  const my = y + eye * 1.9;
  if (mood === 'open' || mood === 'happy') {
    oval(c, x, my + eye * 0.3, eye * 0.85, eye * 1.05, INK);
  } else if (mood === 'dizzy') {
    strokePath(c, `M${x - eye * 1.3} ${my + eye * 0.4}q${eye * 0.65} ${-eye} ${eye * 1.3} 0t${eye * 1.3} 0`, INK, line);
  } else if (mood === 'grumpy') {
    strokePath(c, `M${x - eye} ${my + eye * 0.5}Q${x} ${my - eye * 0.4} ${x + eye} ${my + eye * 0.5}`, INK, line);
  } else {
    strokePath(c, `M${x - eye * 1.1} ${my - eye * 0.2}Q${x} ${my + eye} ${x + eye * 1.1} ${my - eye * 0.2}`, INK, line);
  }
}

// ───────── 캐릭터 ─────────

/** 달리는 동작 넷에, 메뉴에 세워 두는 모습(idle)과 기뻐하는 모습(cheer)을 더했다. */
export type Pose = 'idle' | 'run1' | 'run2' | 'jump' | 'hit' | 'cheer';

/** 캐릭터 그림의 좌표계. 발바닥이 CHARACTER_BOX.height에 닿는다. */
const CHARACTER_BOX = { width: 100, height: 106 } as const;

interface Feet {
  /** 왼발, 오른발: [x, y, 기울기] */
  left: readonly [number, number, number];
  right: readonly [number, number, number];
}

const FEET: Record<Pose, Feet> = {
  idle: { left: [36, 99, 0], right: [64, 99, 0] },
  cheer: { left: [34, 99, -0.2], right: [66, 99, 0.2] },
  run1: { left: [34, 100, 0.15], right: [66, 95, -0.5] },
  run2: { left: [38, 95, -0.5], right: [62, 100, 0.15] },
  jump: { left: [30, 95, -0.7], right: [58, 98, -0.7] },
  hit: { left: [28, 99, 0.5], right: [72, 99, -0.5] },
};

function moodOf(pose: Pose): Mood {
  if (pose === 'hit') return 'dizzy';
  if (pose === 'jump') return 'open';
  if (pose === 'cheer') return 'happy';
  return 'smile';
}

function feet(c: Ctx, pose: Pose, color: string, rx = 9, ry = 5.5): void {
  const { left, right } = FEET[pose];
  oval(c, left[0], left[1], rx, ry, color, left[2]);
  oval(c, right[0], right[1], rx, ry, color, right[2]);
}

/** 기뻐할 때 번쩍 든 두 팔 */
function cheerArms(c: Ctx, pose: Pose, color: string): void {
  if (pose !== 'cheer') return;
  strokePath(c, 'M17 54L6 38M83 54L94 38', color, 11);
}

/** 몸이 위아래로 통통 튀는 정도. 달리는 두 그림이 번갈아 나오며 통통거린다. */
function bounce(pose: Pose): number {
  if (pose === 'run2') return -4;
  if (pose === 'cheer') return -2;
  return 0;
}

/** 달리는 쪽(오른쪽)을 보도록 얼굴을 살짝 민다. 메뉴에서는 정면을 본다. */
function faceX(pose: Pose): number {
  return pose === 'idle' || pose === 'cheer' ? 50 : 57;
}

const CHARACTERS: Record<CharacterKind, (c: Ctx, pose: Pose) => void> = {
  sprout(c, pose) {
    const body = '#9be3c9';
    const deep = '#7fd3ae';
    feet(c, pose, deep);
    c.save();
    c.translate(0, bounce(pose));
    cheerArms(c, pose, body);
    strokePath(c, 'M50 36c0-9 1-13 3-17', '#5fbf9a', 4.5);
    fillPath(c, 'M53 19c-10-8-19-1-19-1s9 9 19 1z', deep);
    fillPath(c, 'M53 19c9-10 19-4 19-4s-7 11-19 4z', body);
    oval(c, 50, 64, 40, 33, body);
    oval(c, 34, 46, 11, 5.5, '#c6f2e2', -0.42);
    face(c, faceX(pose), 62, { gap: 30, eye: 4.4, mood: moodOf(pose) });
    c.restore();
  },

  drop(c, pose) {
    const body = '#9dd6ff';
    feet(c, pose, '#7dbef2');
    c.save();
    c.translate(0, bounce(pose));
    cheerArms(c, pose, body);
    fillPath(c, 'M50 8C66 30 90 44 90 65A40 32 0 0 1 10 65C10 44 34 30 50 8Z', body);
    oval(c, 31, 52, 5.5, 10, '#cfebff', 0.5);
    face(c, faceX(pose), 66, { gap: 30, eye: 4.4, mood: moodOf(pose) });
    c.restore();
  },

  chick(c, pose) {
    const body = '#ffe08a';
    const deep = '#ffd25e';
    const orange = '#ffa348';
    feet(c, pose, orange, 8, 4.5);
    c.save();
    c.translate(0, bounce(pose));
    strokePath(c, 'M47 34c-4-7-2-12 1-15M55 33c0-7 3-11 7-13', '#f2b93b', 4.5);
    if (pose === 'cheer') {
      oval(c, 10, 46, 8, 13, deep, -0.5);
      oval(c, 90, 46, 8, 13, deep, 0.5);
    } else {
      oval(c, 12, 68, 8, 12, deep, 0.3);
      oval(c, 88, 68, 8, 12, deep, -0.3);
    }
    oval(c, 50, 64, 39, 33, body);
    oval(c, 34, 46, 11, 5.5, '#fff0bd', -0.42);
    const x = faceX(pose);
    face(c, x, 60, { gap: 30, eye: 4.4, mood: moodOf(pose), noMouth: true });
    softPath(c, `M${x - 7} 67h14l-7 8z`, orange, 3);
    c.restore();
  },

  ghost(c, pose) {
    // 발이 없어서 땅 위에 살짝 떠 있다.
    oval(c, 50, 103, 24, 3, 'rgba(74, 53, 69, 0.12)');
    c.save();
    c.translate(0, bounce(pose) - 2);
    const d =
      'M12 60C12 34 30 18 50 18S88 34 88 60V92c-6.300 6-12.700 6-19 0c-6.300 6-12.700 6-19 0c-6.300 6-12.700 6-19 0c-6.300 6-12.700 6-19 0Z';
    strokePath(c, d, '#d9cfff', 5);
    if (pose === 'cheer') strokePath(c, 'M17 54L6 38M83 54L94 38', '#d9cfff', 15);
    cheerArms(c, pose, WHITE);
    fillPath(c, d, WHITE);
    oval(c, 34, 40, 10, 5, '#f1ecff', -0.42);
    const mood = moodOf(pose);
    face(c, faceX(pose), 56, { gap: 30, eye: 4.4, mood: mood === 'smile' ? 'open' : mood });
    c.restore();
  },

  duck(c, pose) {
    const body = '#fffdf6';
    const edge = '#f0dfc4';
    const orange = '#ffa348';
    feet(c, pose, orange, 9, 4.5);
    c.save();
    c.translate(0, bounce(pose));
    // 꽁지깃과 머리 깃
    softPath(c, 'M16 60C6 58 2 50 5 42c6 3 13 8 17 14z', edge, 3);
    softPath(c, 'M17 60C9 58 6 52 8 46c5 3 10 7 13 11z', body, 1);
    strokePath(c, 'M50 32c-3-8 0-13 6-14', edge, 6.5);
    strokePath(c, 'M50 32c-3-8 0-13 6-14', '#ffe08a', 3.5);
    oval(c, 50, 64, 40.500, 34.500, edge);
    if (pose === 'cheer') {
      oval(c, 10, 46, 8, 13, edge, -0.5);
      oval(c, 90, 46, 8, 13, edge, 0.5);
    }
    oval(c, 50, 64, 38, 32, body);
    oval(c, 22, 72, 7, 11, '#f6ead4', 0.3);
    const x = faceX(pose);
    face(c, x, 57, { gap: 30, eye: 4.4, mood: moodOf(pose), noMouth: true });
    // 넓적한 부리
    oval(c, x + 2, 70, 14, 7, orange);
    strokePath(c, `M${x - 8} 70q10 3.500 20 0`, '#e0812a', 1.800);
    c.restore();
  },

  dog(c, pose) {
    const body = '#f6cfa3';
    const deep = '#e3b282';
    const brown = '#b9825a';
    feet(c, pose, deep);
    c.save();
    c.translate(0, bounce(pose));
    // 꼬리는 기쁠수록 높이 든다.
    strokePath(c, pose === 'cheer' || pose === 'jump' ? 'M16 76c-10-6-12-16-7-23' : 'M16 80c-10-2-14-9-12-17', deep, 7);
    cheerArms(c, pose, body);
    oval(c, 50, 64, 39, 33, body);
    oval(c, 34, 46, 11, 5.5, '#fde4c6', -0.42);
    const x = faceX(pose);
    // 한쪽 눈가의 얼룩, 축 늘어진 두 귀
    oval(c, x + 15, 57, 10, 9, deep);
    oval(c, 15, 52, 9, 18, brown, 0.28);
    oval(c, 85, 52, 9, 18, brown, -0.28);
    face(c, x, 58, { gap: 30, eye: 4.4, mood: moodOf(pose), noMouth: true });
    oval(c, x, 73, 13, 9.500, '#fff6ea');
    oval(c, x, 68.500, 4.500, 3.300, INK);
    if (pose === 'jump' || pose === 'cheer') {
      oval(c, x, 77.500, 3.400, 4, '#ff8fa6');
    } else if (pose === 'hit') {
      strokePath(c, `M${x - 5} 77q2.500-3 5 0t5 0`, INK, 2);
    } else {
      strokePath(c, `M${x} 72v3.500M${x} 75.500q-3 3.500-6 1M${x} 75.500q3 3.500 6 1`, INK, 1.800);
    }
    c.restore();
  },
};

// ───────── 아이콘 ─────────

type Draw = (c: Ctx) => void;

interface Art {
  width: number;
  height: number;
  /** 그림을 그린 좌표계의 크기. 없으면 width × height 그대로 */
  view?: readonly [number, number];
  draw: Draw;
}

function coin(c: Ctx): void {
  oval(c, 12, 12, 11, 11, '#f2b93b');
  oval(c, 12, 11.200, 10.500, 10.200, '#ffcf5c');
  oval(c, 12, 11.200, 6.800, 6.600, '#ffe39a');
  oval(c, 9, 8.400, 1.900, 1.900, '#fff6da');
}

function sproutEmblem(c: Ctx, color: string): void {
  strokePath(c, 'M12 20c0-6 .500-8.500 1.800-11', color, 2.400);
  fillPath(c, 'M13.800 9c-6-4.800-11-1-11-1s5 5.800 11 1z', color);
  fillPath(c, 'M13.800 9c4.800-6 10.700-3 10.700-3s-3.900 6.500-10.700 3z', color);
}

const ICONS: Record<string, Art> = {
  coin: { width: 12, height: 12, view: [24, 24], draw: coin },

  'icon-gear': {
    width: 14,
    height: 14,
    view: [24, 24],
    draw(c) {
      strokePath(c, 'M12 3v2.500M12 18.500V21M3 12h2.500M18.500 12H21M5.600 5.600l1.800 1.800M16.600 16.600l1.800 1.800M5.600 18.400l1.800-1.800M16.600 7.400l1.800-1.800', THEME_CSS.ink, 3);
      ring(c, 12, 12, 4.600, THEME_CSS.ink, 3);
    },
  },
  'icon-back': {
    width: 14,
    height: 14,
    view: [24, 24],
    draw: (c) => strokePath(c, 'M14.500 4.500 7 12l7.500 7.500', THEME_CSS.ink, 3.600),
  },
  'icon-pause': {
    width: 14,
    height: 14,
    view: [24, 24],
    draw(c) {
      roundRect(c, 5, 3.500, 5, 17, 2.500, THEME_CSS.ink);
      roundRect(c, 14, 3.500, 5, 17, 2.500, THEME_CSS.ink);
    },
  },
  'icon-play': {
    width: 10,
    height: 10,
    view: [24, 24],
    draw: (c) => softPath(c, 'M8 5.500 18.500 12 8 18.500z', THEME_CSS.ink, 4),
  },
  'icon-prev': {
    width: 10,
    height: 10,
    view: [24, 24],
    draw: (c) => softPath(c, 'M16 5.500 5.500 12 16 18.500z', THEME_CSS.ink, 4),
  },
  'icon-check': {
    width: 12,
    height: 12,
    view: [24, 24],
    draw: (c) => strokePath(c, 'M4.500 12.500 10 18l9.500-11', THEME_CSS.good, 3.800),
  },
  'icon-lock': {
    width: 12,
    height: 12,
    view: [24, 24],
    draw(c) {
      strokePath(c, 'M8 11V8a4 4 0 0 1 8 0v3', THEME_CSS.sub, 2.800);
      roundRect(c, 4.500, 10.500, 15, 11, 3.500, THEME_CSS.sub);
    },
  },
  'icon-star': {
    width: 16,
    height: 16,
    view: [24, 24],
    draw: (c) => softPath(c, starPath(12, 12.800, 9.200), '#ffcf5c', 3.200),
  },
  /** 아직 이루지 못한 것을 나타내는 빈 별 */
  'icon-star-empty': {
    width: 16,
    height: 16,
    view: [24, 24],
    draw: (c) => softPath(c, starPath(12, 12.800, 9.200), '#dccac2', 3.200),
  },
  /** 점프 러너에서 모으는 별 */
  'star-buddy': {
    width: 22,
    height: 22,
    view: [24, 24],
    draw(c) {
      softPath(c, starPath(12, 12.600, 9.400, 0.52), '#ffcf5c', 3.600);
      oval(c, 8.400, 9, 2.200, 1.300, '#ffe9a8', -0.5);
      face(c, 12, 12.200, { gap: 5.600, eye: 1.050, blush: false });
    },
  },

  // 허브의 게임 아이콘. 색 타일 위에 놓인다.
  'icon-bolt': {
    width: 32,
    height: 32,
    view: [24, 24],
    draw: (c) => softPath(c, 'M13.500 3 6 13.200h5.200L10 21l8.200-10.500H13z', '#ffc23d', 2.400),
  },
  'icon-cards': {
    width: 32,
    height: 32,
    view: [44, 44],
    draw(c) {
      c.save();
      c.translate(16, 22);
      c.rotate(-0.17);
      roundRect(c, -10, -14, 20, 28, 5, '#b9a9f5');
      c.restore();
      c.save();
      c.translate(28, 22);
      c.rotate(0.14);
      roundRect(c, -11.200, -15.200, 22.400, 30.400, 6, '#b9a9f5');
      roundRect(c, -10, -14, 20, 28, 5, WHITE);
      fillPath(c, 'M0 6c-5-3.500-6-6-4.500-8 1.300-1.600 3.400-1.200 4.500.400 1.100-1.600 3.200-2 4.500-.400 1.500 2 .500 4.500-4.500 8z', '#ff9fb5');
      c.restore();
    },
  },
  'icon-runner': {
    width: 32,
    height: 32,
    view: [100, 100],
    draw(c) {
      c.translate(0, 4);
      strokePath(c, 'M50 36c0-9 1-13 3-17', '#5fbf9a', 5.500);
      fillPath(c, 'M53 19c-10-8-19-1-19-1s9 9 19 1z', '#7fd3ae');
      fillPath(c, 'M53 19c9-10 19-4 19-4s-7 11-19 4z', '#7fd3ae');
      oval(c, 50, 62, 40, 32, '#9be3c9');
      face(c, 50, 60, { gap: 30, eye: 5.200, mood: 'none' });
    },
  },
  /** 탑 쌓기: 조금씩 어긋나게 쌓인 말랑한 블록 */
  'icon-tower': {
    width: 32,
    height: 32,
    draw(c) {
      roundRect(c, 4, 22.500, 24, 7.500, 3, '#7dbef2');
      roundRect(c, 4, 22.500, 24, 5.500, 3, '#9dd6ff');
      roundRect(c, 6.500, 15.500, 20, 7.500, 3, '#7fd3ae');
      roundRect(c, 6.500, 15.500, 20, 5.500, 3, '#9be3c9');
      roundRect(c, 5, 8.500, 17, 7.500, 3, '#f2cf73');
      roundRect(c, 5, 8.500, 17, 5.500, 3, '#ffe9a8');
      roundRect(c, 11, 1.500, 14, 7.500, 3, '#e97f99');
      roundRect(c, 11, 1.500, 14, 5.500, 3, '#ff9fb5');
      face(c, 18, 4.200, { gap: 5, eye: 0.900, blush: false, mood: 'none' });
    },
  },
  /** 색깔 물 나누기: 세 가지 색이 층층이 담긴 유리병 */
  'icon-flask': {
    width: 32,
    height: 32,
    draw(c) {
      c.fillStyle = '#b5a3ab';
      c.beginPath();
      c.roundRect(9.500, 4, 13, 26, [0, 0, 6.500, 6.500]);
      c.fill();
      c.save();
      c.beginPath();
      c.roundRect(11.500, 4, 9, 24, [0, 0, 4.500, 4.500]);
      c.clip();
      c.fillStyle = '#f6ece7';
      c.fillRect(11.500, 4, 9, 24);
      c.fillStyle = '#9dd6ff';
      c.fillRect(11.500, 10, 9, 6);
      c.fillStyle = '#ffcf5c';
      c.fillRect(11.500, 16, 9, 6);
      c.fillStyle = '#7fd3ae';
      c.fillRect(11.500, 22, 9, 6);
      c.restore();
      roundRect(c, 7.500, 2, 17, 4, 2, '#b5a3ab');
      roundRect(c, 13, 11.500, 1.600, 12, 0.800, 'rgba(255, 255, 255, 0.7)');
    },
  },
  /** 관문 달리기: 더하기가 적힌 관문 */
  'icon-gate': {
    width: 32,
    height: 32,
    draw(c) {
      roundRect(c, 4, 12, 5, 18, 2.500, '#9684e0');
      roundRect(c, 23, 12, 5, 18, 2.500, '#9684e0');
      roundRect(c, 2, 5.500, 28, 15, 5, '#7dbef2');
      roundRect(c, 2, 4, 28, 15, 5, '#9dd6ff');
      roundRect(c, 14.400, 6.500, 3.200, 10, 1.600, WHITE);
      roundRect(c, 11, 9.900, 10, 3.200, 1.600, WHITE);
    },
  },
  /** 핀 뽑기: 고리 달린 핀과 그 아래의 보물 */
  'icon-pin': {
    width: 32,
    height: 32,
    draw(c) {
      roundRect(c, 10, 6.200, 20, 5, 2.500, '#b5a3ab');
      roundRect(c, 10, 6.200, 20, 3.200, 1.600, '#d5c8cd');
      ring(c, 7.500, 8.700, 4.200, '#e97f99', 3.200);
      oval(c, 17, 22.800, 7.600, 7.600, '#f2b93b');
      oval(c, 17, 22, 7.300, 7, '#ffcf5c');
      oval(c, 17, 22, 4.600, 4.400, '#ffe39a');
      oval(c, 14.800, 20, 1.400, 1.400, '#fff6da');
    },
  },
  /** 주차장 빼기: 옆에서 본 작은 차 */
  'icon-car': {
    width: 32,
    height: 32,
    draw(c) {
      roundRect(c, 7.500, 6, 15, 11, 4.500, '#ff8f8f');
      roundRect(c, 2.500, 14.500, 27, 11, 5, '#e06d75');
      roundRect(c, 2.500, 13, 27, 11, 5, '#ff8f8f');
      roundRect(c, 9.500, 8, 5, 5, 1.800, '#e3f2ff');
      roundRect(c, 16, 8, 5, 5, 1.800, '#e3f2ff');
      oval(c, 27.200, 17.500, 1.600, 1.600, '#ffe9a8');
      for (const x of [9.500, 22.500]) {
        oval(c, x, 25, 3.800, 3.800, INK);
        oval(c, x, 25, 1.500, 1.500, '#b5a3ab');
      }
    },
  },
  /** 나사 풀기: 십자 홈이 파인 나사 머리 */
  'icon-screw': {
    width: 32,
    height: 32,
    draw(c) {
      oval(c, 16, 17.300, 11.500, 11.500, '#9684e0');
      oval(c, 16, 15.300, 11.500, 11.500, '#c9bcf8');
      oval(c, 11.200, 9.800, 3, 1.700, '#e9e3ff', -0.6);
      roundRect(c, 14.400, 8.300, 3.200, 14, 1.600, '#9684e0');
      roundRect(c, 9, 13.700, 14, 3.200, 1.600, '#9684e0');
    },
  },
  /** 머지 타일: 색이 다른 타일 네 장, 큰 타일일수록 점이 많다 */
  'icon-merge': {
    width: 32,
    height: 32,
    draw(c) {
      const tile = (x: number, y: number, lip: string, top: string): void => {
        roundRect(c, x, y + 2, 13, 12, 3.500, lip);
        roundRect(c, x, y, 13, 12, 3.500, top);
      };
      tile(2, 2, '#7dbef2', '#9dd6ff');
      tile(17, 2, '#7fd3ae', '#9be3c9');
      tile(2, 17, '#f2cf73', '#ffe9a8');
      tile(17, 17, '#e97f99', '#ff9fb5');
      oval(c, 8.500, 8, 1.700, 1.700, '#ffffff');
      oval(c, 21, 8, 1.700, 1.700, '#ffffff');
      oval(c, 26, 8, 1.700, 1.700, '#ffffff');
      oval(c, 6, 23, 1.700, 1.700, '#ffffff');
      oval(c, 11, 23, 1.700, 1.700, '#ffffff');
      oval(c, 8.500, 20, 1.700, 1.700, '#ffffff');
      softPath(c, 'M21 23H26M23.500 20.500V25.500', '#ffffff', 2.400);
    },
  },
  /** 꼬리 잡기: 마디가 이어진 민트색 애벌레와 먹이 */
  'icon-tail': {
    width: 32,
    height: 32,
    draw(c) {
      oval(c, 5.500, 25.500, 4, 4, '#7fd3ae');
      oval(c, 10.500, 21.500, 4.600, 4.600, '#9be3c9');
      oval(c, 15, 16, 5, 5, '#7fd3ae');
      oval(c, 21, 10.500, 7.500, 7.500, '#9be3c9');
      oval(c, 17.500, 6, 2.400, 1.400, '#d5f5e8', -0.6);
      face(c, 21.500, 10.500, { gap: 6, eye: 1.100, blush: true });
      oval(c, 26, 26, 3.600, 3.600, '#ff8a7a');
      oval(c, 24.800, 24.800, 1.200, 0.800, '#ffc4bb', -0.6);
    },
  },
  /** 논리 타일: 열린 타일 위에 꽂힌 깃발 */
  'icon-logic': {
    width: 32,
    height: 32,
    draw(c) {
      roundRect(c, 3, 5, 26, 25, 6, '#9684e0');
      roundRect(c, 3, 3, 26, 25, 6, '#c9bcf8');
      roundRect(c, 6, 6, 20, 19, 4, '#e9e3ff');
      roundRect(c, 13.200, 8, 2.400, 15, 1.200, '#7a6170');
      fillPath(c, 'M15.600 8.500L23.500 12L15.600 15.500Z', '#ff8a7a');
      roundRect(c, 10.500, 21.500, 8, 2.600, 1.300, '#7a6170');
    },
  },
  /** 숫자 퍼즐: 아홉 칸 가운데 몇 칸이 채워진 판 */
  'icon-number': {
    width: 32,
    height: 32,
    draw(c) {
      roundRect(c, 2, 4, 28, 27, 6, '#f2cf73');
      roundRect(c, 2, 2, 28, 27, 6, '#ffe9a8');
      const fills: Record<string, string> = { '0,0': '#9dd6ff', '1,1': '#ff9fb5', '2,0': '#9be3c9', '0,2': '#c9bcf8', '2,2': '#9dd6ff' };
      for (let row = 0; row < 3; row += 1) {
        for (let col = 0; col < 3; col += 1) {
          roundRect(c, 5 + col * 7.700, 5 + row * 7.300, 6.600, 6.300, 1.800, fills[`${col},${row}`] ?? '#fffaf0');
        }
      }
    },
  },
};

// ───────── 기억 카드의 그림 ─────────

/** 32 × 32 좌표계에 그린다. 모양과 색이 모두 달라서 색만으로 구별하지 않아도 된다. */
const CARD_ART: Record<string, Draw> = {
  'card-heart'(c) {
    fillPath(c, 'M16 28C5 20.500 2.500 14.500 5.200 9.800 7.700 5.600 13.300 6 16 10.200 18.700 6 24.300 5.600 26.800 9.800 29.500 14.500 27 20.500 16 28Z', '#ff9fb5');
    oval(c, 9.500, 11, 2.600, 1.500, '#ffd0db', -0.6);
    face(c, 16, 14.500, { gap: 8.400, eye: 1.350, blush: false });
  },
  'card-star'(c) {
    softPath(c, starPath(16, 17, 11.500, 0.52), '#ffcf5c', 4.400);
    face(c, 16, 16, { gap: 7.600, eye: 1.350, blush: false });
  },
  'card-clover'(c) {
    strokePath(c, 'M16 20c.800 4 2 6.800 4.800 8.800', '#5fbf9a', 2.400);
    for (const [x, y] of [
      [10.600, 10.200],
      [21.400, 10.200],
      [10.600, 19.400],
      [21.400, 19.400],
    ]) {
      oval(c, x, y, 6.200, 6.200, '#7fd3ae');
    }
    oval(c, 16, 14.800, 5.400, 5.400, '#7fd3ae');
    face(c, 16, 13.800, { gap: 6.400, eye: 1.350, blush: false });
  },
  'card-drop'(c) {
    fillPath(c, 'M16 3.500C22 10.800 25.400 15.600 25.400 20.200A9.400 9.400 0 0 1 6.600 20.200C6.600 15.600 10 10.800 16 3.500Z', '#8ccbff');
    oval(c, 11.600, 15.600, 1.900, 3.400, '#c9e8ff', 0.42);
    face(c, 16, 19.600, { gap: 6.400, eye: 1.350, blush: false });
  },
  'card-gem'(c) {
    softPath(c, 'M9.500 6h13l5 6.500L16 27 4.500 12.500z', '#b9a9f5', 2.400);
    fillPath(c, 'M9.500 6h13l5 6.500h-23z', '#d9cfff');
    face(c, 16, 15.800, { gap: 6.400, eye: 1.350, blush: false });
  },
  'card-moon'(c) {
    fillPath(c, 'M19.500 4.200A12 12 0 1 0 27.800 21.600 10 10 0 0 1 19.500 4.200Z', '#ffd772');
    face(c, 13.400, 17.200, { gap: 5.600, eye: 1.250, blush: false, mood: 'sleepy' });
  },
  'card-orange'(c) {
    oval(c, 16, 18, 10.600, 10, '#ffb05c');
    fillPath(c, 'M16 8.500c-4.500-4-8.500-1.200-8.500-1.200S11.300 11.800 16 8.500z', '#7fd3ae');
    strokePath(c, 'M16 9V6.500', '#5fbf9a', 2);
    oval(c, 10.800, 13.200, 2.600, 1.500, '#ffd0a0', -0.6);
    face(c, 16, 17.800, { gap: 7.600, eye: 1.350, blush: false });
  },
  'card-cat'(c) {
    softPath(c, 'M6 14 5 4.500l8 4zM26 14l1-9.500-8 4z', '#ffc9a3', 2);
    oval(c, 16, 18.200, 12, 10, '#ffc9a3');
    oval(c, 11.600, 16.800, 1.500, 1.500, INK);
    oval(c, 20.400, 16.800, 1.500, 1.500, INK);
    oval(c, 8.400, 20.600, 2.200, 1.400, '#ff9fb5');
    oval(c, 23.600, 20.600, 2.200, 1.400, '#ff9fb5');
    strokePath(c, 'M14 20q1 1.400 2 0q1 1.400 2 0', INK, 1.100);
  },
  'card-fish'(c) {
    softPath(c, 'M23 16l6.500-6v12z', '#7dbef2', 1.600);
    oval(c, 14, 16, 10.500, 7.800, '#9dd6ff');
    strokePath(c, 'M17.500 12.500q2.500 3.500 0 7', '#7dbef2', 1.400);
    oval(c, 9.400, 14.600, 1.400, 1.400, INK);
    strokePath(c, 'M6.500 18.200q1.600 1.200 3.200 0', INK, 1.100);
  },
  'card-note'(c) {
    strokePath(c, 'M13 23V7.500l11-2.500v15', '#b9a9f5', 2.600);
    oval(c, 9.800, 23.200, 4.400, 3.600, '#b9a9f5', -0.3);
    oval(c, 20.800, 20.200, 4.400, 3.600, '#b9a9f5', -0.3);
    face(c, 9.800, 22.800, { gap: 3.200, eye: 0.800, blush: false, mood: 'none' });
  },
};

// ───────── 번개 탭의 구슬 ─────────

function drawOrb(c: Ctx, look: OrbLook): void {
  oval(c, 14, 14, 13, 13, look.shade);
  oval(c, 14, 13.200, 12.600, 12.200, look.base);
  oval(c, 8.800, 7.800, 3.600, 1.900, look.light, -0.5);
  if (look.motif === 'berry') {
    fillPath(c, 'M14 3.200c-3.600-2.600-6.400-.400-6.400-.400S10.400 5.800 14 3.200z', '#7fd3ae');
    fillPath(c, 'M14 3.200c3.600-2.600 6.400-.400 6.400-.400S17.600 5.800 14 3.200z', '#7fd3ae');
    for (const [x, y] of [
      [6.400, 14.500],
      [21.600, 14.500],
      [9, 21],
      [19, 21],
    ]) {
      oval(c, x, y, 0.700, 1, '#fff0c9', 0.2);
    }
  }
  if (look.motif === 'sparkle') {
    softPath(c, starPath(21, 7.200, 2.600, 0.42), WHITE, 0.800);
  }
  face(c, 14, 13.400, { gap: 8.600, eye: 1.500, mood: look.mood ?? 'smile' });
}

// ───────── 기억 카드 ─────────

const CARD_SIZE = { width: 48, height: 56 } as const;
/** 카드 아래에 보이는 도톰한 두께 */
const CARD_LIP = 3;

function drawCardFront(c: Ctx): void {
  const { width, height } = CARD_SIZE;
  roundRect(c, 0, CARD_LIP, width, height - CARD_LIP, 9, THEME_CSS.shadow);
  roundRect(c, 0, 0, width, height - CARD_LIP, 9, WHITE);
}

function drawCardBack(c: Ctx, look: CardBackLook): void {
  const { width, height } = CARD_SIZE;
  const faceHeight = height - CARD_LIP;
  roundRect(c, 0, CARD_LIP, width, faceHeight, 9, look.lip);
  roundRect(c, 0, 0, width, faceHeight, 9, look.face);

  // 무늬는 둥근 테두리 안쪽에만 그린다.
  c.save();
  c.beginPath();
  c.roundRect(4, 4, width - 8, faceHeight - 8, 6);
  c.clip();
  c.fillStyle = look.mark;
  if (look.motif === 'stripes') {
    c.lineWidth = 4;
    c.strokeStyle = look.mark;
    for (let x = -faceHeight; x < width; x += 11) {
      c.beginPath();
      c.moveTo(x, faceHeight);
      c.lineTo(x + faceHeight, 0);
      c.stroke();
    }
  } else if (look.motif === 'checks') {
    const step = 8;
    for (let row = 0; row * step < faceHeight; row += 1) {
      for (let column = 0; column * step < width; column += 1) {
        if ((row + column) % 2 === 0) c.fillRect(4 + column * step, 4 + row * step, step, step);
      }
    }
  } else {
    for (let row = 0; row < 5; row += 1) {
      for (let column = 0; column < 4; column += 1) {
        const x = 9 + column * 10 + (row % 2 === 0 ? 0 : 5);
        const y = 8.500 + row * 9;
        if (look.motif === 'diamond') {
          fillPath(c, `M${x} ${y - 3.200}l2.700 3.200-2.700 3.200-2.700-3.200z`, look.mark);
        } else {
          oval(c, x, y, 2.200, 2.200, look.mark);
        }
      }
    }
  }
  c.restore();

  // 가운데의 새싹 표시
  oval(c, width / 2, faceHeight / 2, 11, 11, look.face);
  ring(c, width / 2, faceHeight / 2, 10, look.mark, 1.600);
  c.save();
  c.translate(width / 2 - 8.600, faceHeight / 2 - 8.800);
  c.scale(0.64, 0.64);
  sproutEmblem(c, WHITE);
  c.restore();
}

// ───────── 배경 ─────────

function drawBackdrop(c: Ctx, look: BackdropLook): void {
  c.fillStyle = look.base;
  c.fillRect(0, 0, look.size, look.size);
  for (const [shape, x, y, size, color] of look.marks) {
    if (shape === 'dot') {
      oval(c, x, y, size, size, color);
    } else if (shape === 'leaf') {
      c.save();
      c.translate(x, y);
      c.rotate(-0.6);
      fillPath(c, `M${-size} 0Q0 ${-size * 0.9} ${size} 0Q0 ${size * 0.9} ${-size} 0Z`, color);
      c.restore();
    } else if (shape === 'cloud') {
      oval(c, x, y, size, size * 0.42, color);
      oval(c, x - size * 0.34, y - size * 0.28, size * 0.42, size * 0.36, color);
      oval(c, x + size * 0.26, y - size * 0.38, size * 0.5, size * 0.44, color);
    } else {
      softPath(c, starPath(x, y, size, 0.42), color, size * 0.3);
    }
  }
}

/** 상점에서 보여 주는 배경 조각. 모서리를 둥글리고, 흰 카드 위에서도 보이게 옅은 테두리를 두른다. */
function drawBackdropPreview(c: Ctx, look: BackdropLook, width: number, height: number): void {
  const radius = 9;
  c.save();
  c.beginPath();
  c.roundRect(0, 0, width, height, radius);
  c.clip();
  // 무늬가 드문드문해서 조금 줄여 여러 개가 보이게 한다.
  const zoom = 0.7;
  c.scale(zoom, zoom);
  for (let x = 0; x * zoom < width; x += look.size) {
    c.save();
    c.translate(x, -look.size * 0.12);
    drawBackdrop(c, look);
    c.restore();
  }
  c.restore();
  c.strokeStyle = THEME_CSS.shadow;
  c.lineWidth = 1.5;
  c.beginPath();
  c.roundRect(0.750, 0.750, width - 1.500, height - 1.500, radius - 0.750);
  c.stroke();
}

// ───────── 점프 러너의 세상 ─────────

const WORLD: Record<string, Art> = {
  // 장애물은 모두 산호색이다. 캐릭터에는 이 색을 쓰지 않는다.
  'ob-spike': {
    width: 26,
    height: 18,
    draw(c) {
      softPath(c, 'M2 18C2 9 4.500 3 7.500 3S13 9 13 18Z', '#ff8f8f', 1.500);
      softPath(c, 'M13 18C13 9 15.500 3 18.500 3S24 9 24 18Z', '#ff8f8f', 1.500);
      face(c, 7.500, 11, { gap: 4.200, eye: 0.900, blush: false, mood: 'grumpy' });
      face(c, 18.500, 11, { gap: 4.200, eye: 0.900, blush: false, mood: 'grumpy' });
    },
  },
  'ob-thorns': {
    width: 50,
    height: 18,
    draw(c) {
      for (let i = 0; i < 4; i += 1) {
        const x = 3 + i * 11;
        softPath(c, `M${x} 18C${x} 9 ${x + 2.500} 3 ${x + 5.500} 3S${x + 11} 9 ${x + 11} 18Z`, i % 2 === 0 ? '#ff8f8f' : '#ffa3a0', 1.500);
        face(c, x + 5.500, 11, { gap: 4.200, eye: 0.900, blush: false, mood: 'grumpy' });
      }
    },
  },
  'ob-pillar': {
    width: 20,
    height: 40,
    draw(c) {
      roundRect(c, 3, 1, 14, 39, 7, '#ff8f8f');
      roundRect(c, 3, 22, 14, 4, 0, '#ffa9a6');
      roundRect(c, 3, 31, 14, 4, 0, '#ffa9a6');
      roundRect(c, 0.500, 35, 19, 5, 2.500, '#e06d75');
      oval(c, 7, 5.500, 2.800, 1.400, '#ffc2bf', -0.4);
      face(c, 10, 11.500, { gap: 6, eye: 1.150, blush: false, mood: 'grumpy' });
    },
  },
  'ob-bat1': {
    width: 30,
    height: 20,
    draw(c) {
      softPath(c, 'M11 11C7 4 3 2.500 1 3c1.500 3 1 5.500 2.500 8 2-.500 5 0 7.500 2zM19 11c4-7 8-8.500 10-8-1.500 3-1 5.500-2.500 8-2-.500-5 0-7.500 2z', '#e06d75', 1.200);
      softPath(c, 'M10.500 5.500 9.500 1.500 13 4zM19.500 5.500l1-4L17 4z', '#ff8f8f', 1);
      oval(c, 15, 10.500, 6.600, 6.400, '#ff8f8f');
      face(c, 15, 9.600, { gap: 5, eye: 1.050, blush: false, mood: 'grumpy' });
    },
  },
  'ob-bat2': {
    width: 30,
    height: 20,
    draw(c) {
      softPath(c, 'M11 10C7 12 4 15.500 2.500 19c2.500-1 4.500-.500 6.500-2 .500-2 1.500-3.500 3-4.500zM19 10c4 2 7 5.500 8.500 9-2.500-1-4.500-.500-6.500-2-.500-2-1.500-3.500-3-4.500z', '#e06d75', 1.200);
      softPath(c, 'M10.500 5.500 9.500 1.500 13 4zM19.500 5.500l1-4L17 4z', '#ff8f8f', 1);
      oval(c, 15, 10.500, 6.600, 6.400, '#ff8f8f');
      face(c, 15, 9.600, { gap: 5, eye: 1.050, blush: false, mood: 'grumpy' });
    },
  },

  'sky-cloud': {
    width: 52,
    height: 24,
    draw(c) {
      oval(c, 26, 16, 25, 8, WHITE);
      oval(c, 17, 11, 11, 9, WHITE);
      oval(c, 32, 9.500, 12.500, 9.500, WHITE);
    },
  },
  /** 예전 이름은 달이지만 지금은 낮이라 해가 뜬다. */
  'runner-moon': {
    width: 48,
    height: 48,
    draw(c) {
      oval(c, 24, 24, 23, 23, '#ffe9a8');
      oval(c, 24, 24, 16.500, 16.500, '#ffd772');
      face(c, 24, 23, { gap: 11, eye: 1.700, mood: 'sleepy' });
    },
  },
  /** 먼 언덕. 양 끝이 이어지도록 한 주기만 그린다. */
  'runner-hills': {
    width: 240,
    height: 48,
    draw(c) {
      fillPath(c, 'M0 48V30C30 6 62 6 92 28C112 42 128 42 150 26C180 4 214 8 240 30V48Z', '#c9ebd9');
      fillPath(c, 'M0 48V40C24 26 52 24 78 38C100 49 124 48 150 36C182 22 214 26 240 40V48Z', '#b5e3cc');
    },
  },
  /** 땅 윗면의 풀. 봉긋한 풀이 흘러가며 속도가 느껴진다. */
  'runner-edge': {
    width: 48,
    height: 12,
    draw(c) {
      oval(c, 8, 5, 6, 5, '#7fd3ae');
      oval(c, 31, 5.500, 4.500, 4, '#7fd3ae');
      c.fillStyle = '#9be3c9';
      c.fillRect(0, 4, 48, 8);
    },
  },
  /** 땅속. 옆으로 흘러가는 것이 보이도록 드문드문 물방울무늬를 둔다. */
  'runner-soil': {
    width: 64,
    height: 64,
    draw(c) {
      c.fillStyle = '#ffe3ea';
      c.fillRect(0, 0, 64, 64);
      for (const [x, y, r] of [
        [12, 18, 4],
        [44, 10, 2.500],
        [30, 40, 5],
        [56, 50, 3],
        [8, 54, 2.500],
      ]) {
        oval(c, x, y, r, r, '#ffd0db');
      }
    },
  },
  /** 터질 때 튀는 조각. 색은 쓰는 쪽에서 입힌다. */
  spark: { width: 5, height: 5, draw: (c) => oval(c, 2.500, 2.500, 2.500, 2.500, WHITE) },
  'card-front': { width: CARD_SIZE.width, height: CARD_SIZE.height, draw: drawCardFront },
};

// ───────── 등록 ─────────

/** 상점에서 보여 주는 배경 조각의 크기 */
export const BACKDROP_PREVIEW = { width: 84, height: 42 } as const;
/** 달리는 캐릭터의 크기. 판정 상자(14 × 22)보다 넉넉하게 그린다. */
export const RUNNER_SIZE = { width: 34, height: 36 } as const;
/** 메뉴에 세워 두는 큰 캐릭터 */
export const MASCOT_SIZE = { width: 62, height: 66 } as const;
export const ORB_SIZE = 28;
export const CARD_WIDTH = CARD_SIZE.width;
export const CARD_HEIGHT = CARD_SIZE.height;

/** 모든 벡터 텍스처를 등록한다. 같은 이름의 픽셀 스프라이트보다 먼저 불러야 한다. */
export function registerVectorTextures(scene: Phaser.Scene): void {
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

  for (const [key, art] of Object.entries(ICONS)) add(key, art);
  for (const [key, art] of Object.entries(WORLD)) add(key, art);
  for (const [key, draw] of Object.entries(CARD_ART)) add(key, { width: 32, height: 32, draw });

  // 꾸미기: 어떤 것을 쓰고 있든 바로 바꿀 수 있게 모두 만들어 둔다.
  const view = [CHARACTER_BOX.width, CHARACTER_BOX.height] as const;
  for (const [id, look] of Object.entries(RUNNER_LOOKS)) {
    const character = CHARACTERS[look.kind];
    for (const frame of RUNNER_FRAMES) {
      add(runnerTexture(id, frame), { ...RUNNER_SIZE, view, draw: (c) => character(c, frame) });
    }
    for (const pose of ['idle', 'cheer'] as const) {
      add(mascotTexture(id, pose), { ...MASCOT_SIZE, view, draw: (c) => character(c, pose) });
    }
  }
  for (const [id, look] of Object.entries(BACKDROP_LOOKS)) {
    add(id, { width: look.size, height: look.size, draw: (c) => drawBackdrop(c, look) });
    add(backdropPreviewTexture(id), {
      ...BACKDROP_PREVIEW,
      draw: (c) => drawBackdropPreview(c, look, BACKDROP_PREVIEW.width, BACKDROP_PREVIEW.height),
    });
  }
  for (const [id, look] of Object.entries(CARD_BACK_LOOKS)) {
    add(id, { ...CARD_SIZE, draw: (c) => drawCardBack(c, look) });
  }
  for (const [id, look] of [...Object.entries(ORB_LOOKS), [TEXTURE.orbGold, GOLD_ORB] as const]) {
    add(id, { width: ORB_SIZE, height: ORB_SIZE, draw: (c) => drawOrb(c, look) });
  }
}
