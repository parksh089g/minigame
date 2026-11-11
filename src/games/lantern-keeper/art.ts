/**
 * 등불지기 전용 픽셀 텍스처. 공용 art/ 폴더를 건드리지 않도록 이 게임 안에서 만든다.
 * 문자열 한 글자가 한 픽셀이고, 0~f는 config.ts의 PALETTE 번호, '.'은 투명이다.
 */
import Phaser from 'phaser';
import { COLOR, PALETTE } from '../../config';

type Rows = readonly string[];

export const LK = {
  keeper: ['lk-keeper-1', 'lk-keeper-2'],
  shade: ['lk-shade-1', 'lk-shade-2'],
  bat: ['lk-bat-1', 'lk-bat-2'],
  wisp: ['lk-wisp-1', 'lk-wisp-2'],
  brute: ['lk-brute-1', 'lk-brute-2'],
  giant: ['lk-giant-1', 'lk-giant-2'],
  lord: ['lk-lord-1', 'lk-lord-2'],
  gemSmall: 'lk-gem-s',
  gemMid: 'lk-gem-m',
  gemBig: 'lk-gem-b',
  heal: 'lk-heal',
  ember: 'lk-ember',
  emberEvo: 'lk-ember-evo',
  firefly: 'lk-firefly',
  fireflyEvo: 'lk-firefly-evo',
  star: 'lk-star',
  starEvo: 'lk-star-evo',
  lance: 'lk-lance',
  lanceEvo: 'lk-lance-evo',
  floor: 'lk-floor',
  spark: 'lk-spark',
} as const;

/**
 * 도형으로 그리는 효과의 색. 그림체를 바꿀 때는 이 파일(스프라이트 문자열, 색 번호, 이 표)만 고치면 된다.
 */
export const LOOK = {
  aura: COLOR.yellow,
  auraEdge: COLOR.orange,
  auraEvo: COLOR.white,
  auraEvoEdge: COLOR.yellow,
  strike: COLOR.yellow,
  fire: COLOR.orange,
  fireCore: COLOR.yellow,
  fireEvo: COLOR.red,
  bolt: COLOR.white,
  boltGlow: COLOR.cyan,
  boltEvoGlow: COLOR.yellow,
} as const;

/**
 * 이 게임의 패널은 밤 분위기에 맞춰 어둡게 그린다. 앱의 기본 패널(밝은 카드, 옅은 그림자) 대신
 * drawPanel에 이 색을 넘긴다.
 */
export const DARK_PANEL = { fill: COLOR.charcoal, shadow: COLOR.ink } as const;

/** 맞았을 때 잠깐 하얗게 보이는 텍스처의 이름 */
export const flashOf = (key: string): string => `${key}-flash`;

/** 등불을 든 수호자. 차가운 색의 적 사이에서 눈에 띄도록 따뜻한 색으로 칠한다. */
const KEEPER_TOP: Rows = [
  '....000000......',
  '...04444440.....',
  '..0444444440....',
  '..044cccc440....',
  '..04c0cc0c40....',
  '..04cccccc40....',
  '...04cccc40.000.',
  '..02333332004440',
  '.022333322004c40',
  '.022333322004440',
  '.0222332220.000.',
  '.0222222220.....',
  '..02222220......',
  '..00222200......',
];
const KEEPER_1: Rows = [...KEEPER_TOP, '...0e0.0e0......', '...00...00......'];
const KEEPER_2: Rows = [...KEEPER_TOP, '....0e00e0......', '....00.00.......'];

const BAT_1: Rows = [
  '0............0',
  '020........020',
  '0220.0000.0220',
  '02220222202220',
  '.0222c22c2220.',
  '..0222222220..',
  '...00200200...',
  '.....0..0.....',
];
const BAT_2: Rows = [
  '..............',
  '.....0000.....',
  '...00222200...',
  '.002222222200.',
  '02222c22c22220',
  '0220.2222.0220',
  '020...00...020',
  '0............0',
];

const WISP_1: Rows = [
  '....00....',
  '...0aa0...',
  '...0ab0...',
  '..0abba0..',
  '..0abba0..',
  '.0abbbba0.',
  '.0abccba0.',
  '0ab0cc0ba0',
  '0abccccba0',
  '0aabccbaa0',
  '.0aabbaa0.',
  '..000000..',
];
/** 불꽃 끝이 옆으로 흔들린다. */
const WISP_2: Rows = [...WISP_1.slice(0, 3).map((row) => `.${row.slice(0, -1)}`), ...WISP_1.slice(3)];

/** 빛화살. 오른쪽을 보게 그리고, 날아가는 쪽으로 돌려서 쓴다. */
const LANCE: Rows = [
  '.........c..',
  '.4444444ccc.',
  'cccccccccccc',
  '.4444444ccc.',
  '.........c..',
];
const LANCE_EVO: Rows = [
  '...........cc...',
  '..33333333cccc..',
  '.3444444444cccc.',
  '44cccccccccccccc',
  '.3444444444cccc.',
  '..33333333cccc..',
  '...........cc...',
];

/** 회복 떡 */
const HEAL: Rows = [
  '..0000..',
  '.0cccc0.',
  '0cc22cc0',
  '0c2222c0',
  '0cc22cc0',
  '0dccccd0',
  '.0dddd0.',
  '..0000..',
];

function canvasOf(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D 캔버스를 만들 수 없습니다.');
  return [canvas, context];
}

/** flash면 그림이 있는 픽셀을 모두 흰색으로 칠한다. */
function drawRows(rows: Rows, flash = false): HTMLCanvasElement {
  const [canvas, context] = canvasOf(rows[0].length, rows.length);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      const index = Number.parseInt(row[x], 16);
      if (Number.isNaN(index)) continue;
      context.fillStyle = flash ? PALETTE[12] : PALETTE[index];
      context.fillRect(x, y, 1, 1);
    }
  });
  return canvas;
}

interface BlobLook {
  size: number;
  body: number;
  shade: number;
  eye: number;
  /** 왕관을 씌운다 */
  crown?: boolean;
  /** 아래쪽 물결 */
  frill?: boolean;
}

/**
 * 동그란 그림자 괴물을 그린다. 크기만 바꿔 작은 적부터 보스까지 같은 모양으로 만든다.
 * frame 2는 위아래로 살짝 눌려 꿈틀거리는 것처럼 보인다.
 */
function blobRows(look: BlobLook, frame: 1 | 2): Rows {
  const { size } = look;
  const crownRows = look.crown ? Math.round(size / 4) : 0;
  const height = size + crownRows;
  const grid: string[][] = Array.from({ length: height }, () => Array<string>(size).fill('.'));
  const cx = size / 2;
  const squash = frame === 2 ? 0.92 : 1;
  const ry = (size / 2) * squash;
  const cy = crownRows + size - ry;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x + 0.5 - cx) / (size / 2);
      const py = crownRows + y + 0.5;
      const dy = (py - cy) / ry;
      // 아래쪽은 조금 넓고 평평한 물방울 모양
      const d = Math.hypot(dx * (dy > 0 ? 0.92 : 1), dy);
      if (d > 1) continue;
      let color = d > 0.84 ? 0 : look.body;
      if (color !== 0 && dx < -0.2 && dy < -0.3 && d > 0.55) color = look.shade;
      grid[crownRows + y][x] = color.toString(16);
    }
  }
  // 물결치는 아랫단: 한 칸씩 건너 구멍을 낸다.
  if (look.frill) {
    const bottom = height - 1;
    for (let x = 0; x < size; x += 1) {
      if ((x + frame) % 3 === 0 && grid[bottom][x] !== '.') grid[bottom][x] = '.';
    }
  }
  // 눈: 가로 가운데에서 대칭으로 두 칸씩
  const eyeY = Math.round(cy - ry * 0.15);
  const eyeGap = Math.max(1, Math.round(size / 7));
  const eyeSize = size >= 20 ? 2 : 1;
  for (const side of [-1, 1]) {
    const ex = Math.round(cx + side * eyeGap - (side < 0 ? eyeSize : 0));
    for (let i = 0; i < eyeSize; i += 1) {
      for (let j = 0; j < eyeSize + (size >= 12 ? 1 : 0); j += 1) {
        const gx = ex + i;
        const gy = eyeY + j;
        if (grid[gy]?.[gx] !== undefined && grid[gy][gx] !== '.') grid[gy][gx] = look.eye.toString(16);
      }
    }
  }
  // 왕관: 뾰족한 세 봉우리
  if (look.crown) {
    const left = Math.round(size * 0.25);
    const right = Math.round(size * 0.75);
    for (let x = left; x < right; x += 1) {
      const t = (x - left) / (right - left);
      const peak = Math.abs(Math.sin(t * Math.PI * 3));
      const top = Math.round((1 - peak) * (crownRows - 1));
      for (let y = top; y < crownRows + 2; y += 1) {
        grid[y][x] = y === top || x === left || x === right - 1 ? '0' : y === crownRows ? '3' : '4';
      }
    }
  }
  return grid.map((row) => row.join(''));
}

const BLOBS = {
  shade: { size: 12, body: 1, shade: 2, eye: 12, frill: true },
  brute: { size: 16, body: 14, shade: 13, eye: 3 },
  giant: { size: 30, body: 7, shade: 6, eye: 4, frill: true },
  lord: { size: 34, body: 2, shade: 3, eye: 12, crown: true, frill: true },
} as const satisfies Record<string, BlobLook>;

function drawGem(size: number, rim: number, body: number): HTMLCanvasElement {
  const [canvas, context] = canvasOf(size, size);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const d = Math.abs(x - c) + Math.abs(y - c);
      if (d > c + 0.01) continue;
      context.fillStyle = PALETTE[d > c - 1 ? rim : body];
      context.fillRect(x, y, 1, 1);
    }
  }
  context.fillStyle = PALETTE[12];
  context.fillRect(Math.floor(c) - (size > 5 ? 1 : 0), Math.floor(c) - 1, 1, 1);
  return canvas;
}

function drawDot(size: number, rings: ReadonlyArray<readonly [number, number]>): HTMLCanvasElement {
  const [canvas, context] = canvasOf(size, size);
  const c = size / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      let color = -1;
      for (const [r, index] of rings) if (d <= r) color = index;
      if (color < 0) continue;
      context.fillStyle = PALETTE[color];
      context.fillRect(x, y, 1, 1);
    }
  }
  return canvas;
}

/** 밤의 풀밭. 어두운 바탕에 드문드문 풀포기와 돌을 박는다. */
function drawFloor(): HTMLCanvasElement {
  const size = 48;
  const [canvas, context] = canvasOf(size, size);
  context.fillStyle = PALETTE[15];
  context.fillRect(0, 0, size, size);
  context.fillStyle = PALETTE[7];
  for (const [x, y] of [
    [6, 8],
    [30, 4],
    [40, 30],
    [14, 36],
    [24, 20],
  ]) {
    context.fillRect(x, y, 1, 2);
    context.fillRect(x + 2, y - 1, 1, 3);
    context.fillRect(x + 4, y, 1, 2);
  }
  context.fillStyle = PALETTE[0];
  for (const [x, y, w] of [
    [2, 22, 3],
    [36, 14, 2],
    [20, 44, 3],
    [44, 42, 2],
    [10, 2, 2],
  ]) {
    context.fillRect(x, y, w, 1);
  }
  context.fillStyle = PALETTE[14];
  for (const [x, y] of [
    [33, 40],
    [17, 12],
  ]) {
    context.fillRect(x, y, 2, 1);
  }
  return canvas;
}

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

/** 등불 빛이 닿는 가운데는 비우고 가장자리로 갈수록 어두워지는 덮개. 계단 사이는 점무늬로 잇는다. */
function drawDarkness(width: number, height: number, clear: number, reach: number): HTMLCanvasElement {
  const [canvas, context] = canvasOf(width, height);
  const image = context.createImageData(width, height);
  const steps = 4;
  const cx = width / 2;
  const cy = height / 2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const v = Math.min(1, Math.max(0, (d - clear) / reach)) * steps;
      const band = Math.min(steps, Math.floor(v + (BAYER[y & 3][x & 3] + 0.5) / 16));
      const offset = (y * width + x) * 4;
      image.data[offset] = 16;
      image.data[offset + 1] = 14;
      image.data[offset + 2] = 34;
      image.data[offset + 3] = Math.round(band * 0.15 * 255);
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

/** 게임 전체의 픽셀 그림 설정과 상관없이, 이 게임의 텍스처는 늘 또렷한 픽셀로 보이게 등록한다. */
function addPixelTexture(scene: Phaser.Scene, key: string, canvas: HTMLCanvasElement): void {
  scene.textures.addCanvas(key, canvas)?.setFilter(Phaser.Textures.FilterMode.NEAREST);
}

/** 화면 크기에 맞는 어둠 덮개 텍스처를 만들고 그 이름을 돌려준다. */
export function darknessTexture(scene: Phaser.Scene, width: number, height: number): string {
  const key = `lk-dark-${width}x${height}`;
  if (!scene.textures.exists(key)) {
    addPixelTexture(scene, key, drawDarkness(width, height, 64, 150));
  }
  return key;
}

/** 이 게임에서 쓰는 텍스처를 모두 만든다. 이미 있으면 건너뛴다. */
export function registerLanternTextures(scene: Phaser.Scene): void {
  const add = (key: string, canvas: HTMLCanvasElement): void => {
    if (!scene.textures.exists(key)) addPixelTexture(scene, key, canvas);
  };
  const addWithFlash = (key: string, rows: Rows): void => {
    add(key, drawRows(rows));
    add(flashOf(key), drawRows(rows, true));
  };

  addWithFlash(LK.keeper[0], KEEPER_1);
  addWithFlash(LK.keeper[1], KEEPER_2);
  addWithFlash(LK.bat[0], BAT_1);
  addWithFlash(LK.bat[1], BAT_2);
  addWithFlash(LK.wisp[0], WISP_1);
  addWithFlash(LK.wisp[1], WISP_2);
  for (const kind of ['shade', 'brute', 'giant', 'lord'] as const) {
    addWithFlash(LK[kind][0], blobRows(BLOBS[kind], 1));
    addWithFlash(LK[kind][1], blobRows(BLOBS[kind], 2));
  }
  add(LK.gemSmall, drawGem(7, 10, 11));
  add(LK.gemMid, drawGem(9, 6, 5));
  add(LK.gemBig, drawGem(11, 3, 4));
  add(
    LK.ember,
    drawDot(6, [
      [3, 2],
      [2.2, 3],
      [1.3, 4],
    ]),
  );
  add(
    LK.firefly,
    drawDot(7, [
      [3.5, 6],
      [2.5, 5],
      [1.5, 4],
    ]),
  );
  add(
    LK.star,
    drawDot(8, [
      [4, 3],
      [3, 4],
      [1.6, 12],
    ]),
  );
  add(
    LK.emberEvo,
    drawDot(8, [
      [4, 2],
      [3.2, 3],
      [2.3, 4],
      [1.2, 12],
    ]),
  );
  add(
    LK.fireflyEvo,
    drawDot(9, [
      [4.5, 10],
      [3.5, 11],
      [2, 12],
    ]),
  );
  add(
    LK.starEvo,
    drawDot(10, [
      [5, 3],
      [4, 4],
      [2.4, 12],
    ]),
  );
  add(LK.lance, drawRows(LANCE));
  add(LK.lanceEvo, drawRows(LANCE_EVO));
  add(
    LK.spark,
    drawDot(2, [[1.5, 12]]),
  );
  add(LK.heal, drawRows(HEAL));
  add(LK.floor, drawFloor());
}
