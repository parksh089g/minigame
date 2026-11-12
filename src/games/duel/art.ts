/**
 * 둘이서 대결의 그림과 색. 겉모습을 바꿀 때는 이 파일만 고치면 된다.
 * 아래쪽 사람은 분홍, 위쪽 사람은 하늘색이다. 반쪽의 테두리, 점수 표시, 줄다리기 표시가 모두 이 색을 쓴다.
 * 같은 그림 찾기의 그림은 캔버스에 곡선으로 그려 텍스처로 등록한다. 모양과 색이 모두 달라서 색만으로 가리지 않아도 된다.
 */
import type Phaser from 'phaser';
import { THEME, THEME_CSS } from '../../config';
import { addHiResCanvas, renderScale } from '../../core/hidpi';
import type { Pair } from './rules';

type Graphics = Phaser.GameObjects.Graphics;
type Ctx = CanvasRenderingContext2D;

export interface PlayerLook {
  /** 버튼과 테두리의 색 */
  face: number;
  /** 버튼 아래 두께, 채워진 점수 표시, 물결의 색 */
  lip: number;
  /** 반쪽 판의 바탕색 */
  soft: number;
}

export const LOOK = {
  players: [
    { face: THEME.pink, lip: THEME.pinkDeep, soft: THEME.pinkSoft },
    { face: THEME.sky, lip: THEME.skyDeep, soft: THEME.skySoft },
  ] as Pair<PlayerLook>,
  panel: {
    /** 판 아래에 깔리는 두께 */
    lip: THEME.shadow,
    /** "지금!" 신호가 뜬 판 */
    signal: THEME.gold,
    /** 이긴 쪽과 진 쪽의 판 */
    won: THEME.butter,
    lost: THEME.dim,
  },
  button: {
    ready: { face: THEME.mint, lip: THEME.mintDeep },
    neutral: { face: THEME.card, lip: THEME.shadow },
    /** 그림 버튼: 보통, 맞혔을 때, 틀렸을 때 */
    symbol: { face: THEME.card, lip: THEME.shadow },
    right: { face: THEME.butter, lip: THEME.butterDeep },
    wrong: { face: THEME.coral, lip: THEME.coralDeep },
  },
  plate: { face: THEME.card, lip: THEME.shadow, empty: THEME.shadow },
  tug: { rail: THEME.card, railLip: THEME.shadow, knob: THEME.card, knobLip: THEME.sub, goal: THEME.card },
  bar: { back: THEME.card, time: THEME.mintDeep, hurry: THEME.coral, lock: THEME.coral },
  /** 신호가 뜰 때 판을 덮었다가 걷히는 빛 */
  blink: THEME.white,
  confetti: [THEME.pink, THEME.gold, THEME.mintDeep, THEME.lilac, THEME.sky],
  text: {
    title: THEME_CSS.inkDeep,
    sub: THEME_CSS.ink,
    hint: THEME_CSS.sub,
    wait: THEME_CSS.sub,
    good: THEME_CSS.good,
    bad: THEME_CSS.bad,
    win: THEME_CSS.accent,
    button: THEME_CSS.inkDeep,
    coin: THEME_CSS.accent,
  },
} as const;

// ───────── 같은 그림 찾기의 그림 ─────────

/** 그림 텍스처의 크기(논리 픽셀). 버튼과 가운데 자리에서 이보다 작게 놓는다. */
export const SYMBOL_SIZE = 40;

function fillPath(c: Ctx, d: string, color: string): void {
  c.fillStyle = color;
  c.fill(new Path2D(d));
}

/** 칠하고 같은 색으로 둘레를 한 번 더 그어 모서리를 둥글린다. */
function softPath(c: Ctx, d: string, color: string, round: number): void {
  fillPath(c, d, color);
  c.strokeStyle = color;
  c.lineWidth = round;
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

function starPath(cx: number, cy: number, r: number, inner: number): string {
  const points: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? r : r * inner;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    points.push(`${(cx + radius * Math.cos(angle)).toFixed(2)} ${(cy + radius * Math.sin(angle)).toFixed(2)}`);
  }
  return `M${points.join('L')}Z`;
}

/**
 * 그림마다 32 × 32 좌표계에 그린다. 순서가 곧 rules.ts의 그림 번호라서, SYMBOL_KINDS만큼 있어야 한다.
 * 별(노랑), 하트(산호), 클로버(초록), 물방울(파랑), 보석(보라).
 */
const SYMBOL_DRAWS: readonly ((c: Ctx) => void)[] = [
  (c) => {
    softPath(c, starPath(16, 17, 11.5, 0.52), '#ffc23d', 4.4);
    oval(c, 12.4, 12.6, 2.2, 1.2, '#ffe39a', -0.6);
  },
  (c) => {
    fillPath(
      c,
      'M16 28C5 20.5 2.5 14.5 5.2 9.8 7.7 5.6 13.3 6 16 10.2 18.7 6 24.3 5.6 26.8 9.8 29.5 14.5 27 20.5 16 28Z',
      '#ff8088',
    );
    oval(c, 9.6, 11.2, 2.6, 1.5, '#ffc4c8', -0.6);
  },
  (c) => {
    c.strokeStyle = '#4fae88';
    c.lineWidth = 2.6;
    c.lineCap = 'round';
    c.stroke(new Path2D('M16 20c.8 4 2 6.8 4.8 8.8'));
    for (const [x, y] of [
      [10.6, 10.2],
      [21.4, 10.2],
      [10.6, 19.4],
      [21.4, 19.4],
    ]) {
      oval(c, x, y, 6.2, 6.2, '#62c79c');
    }
    oval(c, 16, 14.8, 5.4, 5.4, '#62c79c');
    oval(c, 8.6, 8, 2.2, 1.3, '#b5ecd4', -0.6);
  },
  (c) => {
    fillPath(c, 'M16 3.5C22 10.8 25.4 15.6 25.4 20.2A9.4 9.4 0 0 1 6.6 20.2C6.6 15.6 10 10.8 16 3.5Z', '#63b4f5');
    oval(c, 11.8, 17.4, 1.9, 3.4, '#c3e3ff', 0.42);
  },
  (c) => {
    softPath(c, 'M9.5 6h13l5 6.5L16 27 4.5 12.5z', '#a08bf0', 2.4);
    fillPath(c, 'M9.5 6h13l5 6.5h-23z', '#cdc1ff');
  },
];

/** 그림 번호에 맞는 텍스처 이름 */
export function symbolTexture(kind: number): string {
  return `duel-symbol-${kind}`;
}

/** 이 게임이 쓰는 텍스처를 등록한다. 씬의 create()에서 부르고, 이미 있는 것은 건너뛴다. */
export function registerDuelTextures(scene: Phaser.Scene): void {
  const density = renderScale();
  SYMBOL_DRAWS.forEach((draw, kind) => {
    const key = symbolTexture(kind);
    if (scene.textures.exists(key)) return;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(SYMBOL_SIZE * density);
    canvas.height = Math.ceil(SYMBOL_SIZE * density);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2D 캔버스를 만들 수 없습니다.');
    context.scale(canvas.width / 32, canvas.height / 32);
    draw(context);
    addHiResCanvas(scene.textures, key, canvas, SYMBOL_SIZE, SYMBOL_SIZE);
  });
}

// ───────── 도형 ─────────

/** 버튼 아래쪽에 보이는 두께. 누르면 이만큼 들어간다. */
export const BUTTON_LIP = 3;

/** 도톰한 둥근 버튼을 그린다. (x, y)는 왼쪽 위이고, height에는 아래 두께까지 들어 있다. */
export function drawButton(
  g: Graphics,
  x: number,
  y: number,
  width: number,
  height: number,
  colors: { face: number; lip: number },
  pressed: boolean,
  radius = 12,
): void {
  const faceHeight = height - BUTTON_LIP;
  const round = Math.min(radius, faceHeight / 2, width / 2);
  g.fillStyle(colors.lip, 1);
  g.fillRoundedRect(x, y + BUTTON_LIP, width, faceHeight, round);
  g.fillStyle(colors.face, 1);
  g.fillRoundedRect(x, y + (pressed ? BUTTON_LIP - 1 : 0), width, faceHeight, round);
}

/** 가로로 긴 알약 모양의 막대. ratio(0~1)만큼 가운데에서 양쪽으로 채워져서, 어느 쪽에서 봐도 똑같이 줄어든다. */
export function drawBar(
  g: Graphics,
  centerX: number,
  y: number,
  width: number,
  height: number,
  ratio: number,
  color: number,
): void {
  g.fillStyle(LOOK.bar.back, 0.85);
  g.fillRoundedRect(centerX - width / 2, y, width, height, height / 2);
  const filled = Math.max(0, Math.min(1, ratio)) * (width - 2);
  if (filled < height - 2) return;
  g.fillStyle(color, 1);
  g.fillRoundedRect(centerX - filled / 2, y + 1, filled, height - 2, (height - 2) / 2);
}
