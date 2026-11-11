/**
 * 앱 아이콘(PNG)을 코드로 그려서 public/icons/ 에 저장한다.
 * 32x32 픽셀 그림 한 장을 정수 배율로 키워 각 크기를 만든다. 실행: npm run icons
 * 외부 라이브러리 없이 Node 내장 zlib만으로 PNG를 인코딩한다.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';

// src/config.ts의 Sweetie 16 팔레트와 같은 순서.
const PALETTE = [
  '#1a1c2c', '#5d275d', '#b13e53', '#ef7d57', '#ffcd75', '#a7f070', '#38b764', '#257179',
  '#29366f', '#3b5dc9', '#41a6f6', '#73eff7', '#f4f4f4', '#94b0c2', '#566c86', '#333c57',
].map((hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)));

const INK = 0, PLUM = 1, RED = 2, YELLOW = 4, NAVY = 8, BLUE = 9, WHITE = 12, SILVER = 13, SLATE = 14, CHARCOAL = 15;
const BACKGROUND = BLUE;

const GRID = 32;
const cells = new Uint8Array(GRID * GRID).fill(BACKGROUND);

const px = (x, y, color) => {
  if (x >= 0 && y >= 0 && x < GRID && y < GRID) cells[y * GRID + x] = color;
};
const rect = (x, y, width, height, color) => {
  for (let j = y; j < y + height; j += 1) for (let i = x; i < x + width; i += 1) px(i, j, color);
};
/** 픽셀 중심이 원 안에 들어오는 칸을 칠한다. pick이 있으면 칸마다 색을 고른다. */
const disc = (cx, cy, radius, color, pick) => {
  for (let j = 0; j < GRID; j += 1) {
    for (let i = 0; i < GRID; i += 1) {
      const dx = i + 0.5 - cx;
      const dy = j + 0.5 - cy;
      if (Math.hypot(dx, dy) <= radius) px(i, j, pick ? pick(dx, dy) : color);
    }
  }
};
const sparkle = (x, y) => {
  px(x, y - 1, YELLOW);
  px(x - 1, y, YELLOW);
  px(x, y, WHITE);
  px(x + 1, y, YELLOW);
  px(x, y + 1, YELLOW);
};

// ── 조이스틱 그림 ──
rect(5, 28, 22, 2, NAVY); // 바닥 그림자
rect(6, 18, 20, 10, INK); // 받침대 외곽선
rect(7, 19, 18, 3, SLATE); // 받침대 윗면
rect(8, 19, 16, 1, SILVER);
rect(7, 22, 18, 5, CHARCOAL); // 받침대 앞면
rect(20, 20, 3, 1, YELLOW); // 받침대 위 버튼
rect(14, 10, 4, 11, INK); // 막대 외곽선
rect(15, 10, 1, 10, SILVER);
rect(16, 10, 1, 10, SLATE);
disc(16, 8.5, 6.6, INK); // 손잡이 외곽선
disc(16, 8.5, 5.6, RED, (dx, dy) => (dx + dy > 4.2 ? PLUM : RED));
px(13, 5, WHITE);
px(14, 5, WHITE);
px(13, 6, WHITE);
sparkle(26, 6);
sparkle(5, 11);

// ── PNG 인코딩 ──
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // 채널당 8비트
  header[9] = 6; // RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 모서리에서 줄마다 잘라 낼 칸 수. 픽셀 느낌의 둥근 모서리가 된다. */
const CORNER_CUTS = [4, 2, 1, 1];
const isCutCorner = (x, y) => {
  const fromX = Math.min(x, GRID - 1 - x);
  const fromY = Math.min(y, GRID - 1 - y);
  return fromY < CORNER_CUTS.length && fromX < CORNER_CUTS[fromY];
};

/**
 * @param size 결과 이미지의 한 변(px)
 * @param scale 격자 한 칸의 크기(px). 그림은 가운데에 놓이고 남는 테두리는 배경색으로 채운다.
 * @param rounded true면 모서리를 투명하게 깎는다.
 */
function render(size, scale, rounded) {
  const offset = (size - GRID * scale) / 2;
  if (!Number.isInteger(offset) || offset < 0) throw new Error(`배율이 맞지 않습니다: ${size}/${scale}`);
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const gx = Math.floor((x - offset) / scale);
      const gy = Math.floor((y - offset) / scale);
      const inside = gx >= 0 && gy >= 0 && gx < GRID && gy < GRID;
      if (rounded && inside && isCutCorner(gx, gy)) continue;
      const [r, g, b] = PALETTE[inside ? cells[gy * GRID + gx] : BACKGROUND];
      rgba.set([r, g, b, 255], (y * size + x) * 4);
    }
  }
  return encodePng(size, rgba);
}

const outDir = new URL('../public/icons/', import.meta.url);
mkdirSync(outDir, { recursive: true });

const outputs = [
  ['favicon-32.png', 32, 1, true],
  ['icon-192.png', 192, 6, true],
  ['icon-512.png', 512, 16, true],
  // 마스크 아이콘은 가운데 80% 안에 그림이 들어가야 잘리지 않는다.
  ['icon-maskable-512.png', 512, 12, false],
  // iOS는 투명한 부분을 검게 칠하므로 꽉 찬 사각형으로 만든다.
  ['apple-touch-icon.png', 180, 5, false],
];

for (const [name, size, scale, rounded] of outputs) {
  writeFileSync(new URL(name, outDir), render(size, scale, rounded));
  console.log(`${name} (${size}x${size})`);
}
