/**
 * 앱 아이콘(PNG)을 코드로 그려서 public/icons/ 에 저장한다. 실행: npm run icons
 * 분홍 바탕 위의 새싹이를 도형(타원, 둥근 선)으로 그리고, 칸마다 여러 점을 찍어 가장자리를 부드럽게 한다.
 * 외부 라이브러리 없이 Node 내장 zlib만으로 PNG를 인코딩한다.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';

const rgb = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));

// src/config.ts의 THEME과 같은 색.
const PINK = rgb('#ff9fb5');
const PINK_LIGHT = rgb('#ffb7c8');
const PINK_DEEP = rgb('#e97f99');
const MINT = rgb('#9be3c9');
const MINT_LIGHT = rgb('#c6f2e2');
const MINT_DEEP = rgb('#5fbf9a');
const LEAF = rgb('#7fd3ae');
const BLUSH = rgb('#ffb3c4');
const INK = rgb('#4a3545');
const WHITE = rgb('#ffffff');

// ── 도형: 100 × 100 좌표계의 점 (x, y)가 안에 있는지 답하는 함수 ──
const ellipse = (cx, cy, rx, ry, rotation = 0) => {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    const u = (dx * cos + dy * sin) / rx;
    const v = (-dx * sin + dy * cos) / ry;
    return u * u + v * v <= 1;
  };
};
/** 두 점을 잇는 끝이 둥근 선 */
const capsule = (x1, y1, x2, y2, width) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  const radiusSq = (width / 2) ** 2;
  return (x, y) => {
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lengthSq));
    return (x - x1 - t * dx) ** 2 + (y - y1 - t * dy) ** 2 <= radiusSq;
  };
};
/** 아래로 볼록한 웃는 입. 짧은 선 여러 개로 곡선을 만든다. */
const smile = (cx, y, halfWidth, dip, width) => {
  const parts = [];
  const steps = 8;
  const at = (i) => {
    const t = (i / steps) * 2 - 1;
    return [cx + t * halfWidth, y + dip * (1 - t * t)];
  };
  for (let i = 0; i < steps; i += 1) parts.push(capsule(...at(i), ...at(i + 1), width));
  return (px, py) => parts.some((part) => part(px, py));
};

/** 뒤에서 앞으로 그리는 순서. 그림은 100 × 100 상자의 가운데에 놓인다. */
const ART = [
  // 바탕의 물방울무늬
  [ellipse(14, 20, 12, 12), PINK_LIGHT],
  [ellipse(88, 34, 8, 8), PINK_LIGHT],
  [ellipse(84, 86, 14, 14), PINK_LIGHT],
  [ellipse(10, 78, 6, 6), PINK_LIGHT],
  // 바닥 그림자
  [ellipse(50, 90, 24, 4.5), PINK_DEEP],
  // 줄기와 잎
  [capsule(50, 40, 53, 21, 5.5), MINT_DEEP],
  [ellipse(42, 19, 11, 5.6, 0.3), LEAF],
  [ellipse(64, 15.5, 11.5, 6, -0.45), LEAF],
  // 몸
  [ellipse(50, 63, 35, 28.5), MINT],
  [ellipse(35, 47.5, 9, 4.4, -0.42), MINT_LIGHT],
  // 얼굴
  [ellipse(27.5, 71, 5.8, 3.5), BLUSH],
  [ellipse(72.5, 71, 5.8, 3.5), BLUSH],
  [ellipse(37.5, 62, 4.7, 4.7), INK],
  [ellipse(62.5, 62, 4.7, 4.7), INK],
  [ellipse(39.1, 60.3, 1.6, 1.6), WHITE],
  [ellipse(64.1, 60.3, 1.6, 1.6), WHITE],
  [smile(50, 68.2, 5.2, 4.2, 2.8), INK],
];

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

/** 한 칸을 가로세로 이만큼씩 나눠 찍어서 가장자리를 부드럽게 한다. */
const SAMPLES = 4;

/**
 * @param size 결과 이미지의 한 변(px)
 * @param artScale 그림의 크기. 1이면 이미지에 꽉 차고, 작을수록 둘레에 바탕이 남는다.
 * @param cornerRadius 0보다 크면 그 반지름(이미지 한 변에 대한 비율)으로 모서리를 투명하게 깎는다.
 */
function render(size, artScale, cornerRadius) {
  const rgba = Buffer.alloc(size * size * 4);
  const radius = cornerRadius * size;
  const insideCorner = (x, y) => {
    if (radius <= 0) return true;
    const dx = Math.max(radius - x, x - (size - radius), 0);
    const dy = Math.max(radius - y, y - (size - radius), 0);
    return dx * dx + dy * dy <= radius * radius;
  };
  // 이미지의 점을 그림의 100 × 100 좌표로 옮긴다.
  const unit = 100 / (size * artScale);
  const shift = 50 - (size / 2) * unit;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let covered = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const px = x + (sx + 0.5) / SAMPLES;
          const py = y + (sy + 0.5) / SAMPLES;
          if (!insideCorner(px, py)) continue;
          const ax = px * unit + shift;
          const ay = py * unit + shift;
          let color = PINK;
          for (const [contains, fill] of ART) if (contains(ax, ay)) color = fill;
          r += color[0];
          g += color[1];
          b += color[2];
          covered += 1;
        }
      }
      if (covered === 0) continue;
      const total = SAMPLES * SAMPLES;
      rgba.set(
        [Math.round(r / covered), Math.round(g / covered), Math.round(b / covered), Math.round((255 * covered) / total)],
        (y * size + x) * 4,
      );
    }
  }
  return encodePng(size, rgba);
}

const outDir = new URL('../public/icons/', import.meta.url);
mkdirSync(outDir, { recursive: true });

const outputs = [
  ['favicon-32.png', 32, 1, 0.24],
  ['icon-192.png', 192, 0.92, 0.22],
  ['icon-512.png', 512, 0.92, 0.22],
  // 마스크 아이콘은 가운데 80% 안에 그림이 들어가야 잘리지 않는다.
  ['icon-maskable-512.png', 512, 0.68, 0],
  // iOS는 투명한 부분을 검게 칠하므로 꽉 찬 사각형으로 만든다.
  ['apple-touch-icon.png', 180, 0.86, 0],
];

for (const [name, size, artScale, cornerRadius] of outputs) {
  writeFileSync(new URL(name, outDir), render(size, artScale, cornerRadius));
  console.log(`${name} (${size}x${size})`);
}
