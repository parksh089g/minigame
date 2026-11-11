/**
 * 안개 늪의 웅덩이. 끝없이 이어지는 땅이라 미리 만들어 두지 않고,
 * 칸 좌표와 그 판의 씨앗으로 "이 칸에 웅덩이가 있는가"를 그때그때 계산한다.
 * 같은 씨앗이면 늘 같은 자리에 있어서, 저장했다 이어 해도 지형이 그대로다.
 */

export interface Puddle {
  x: number;
  y: number;
  /** 가로, 세로 반지름. 위에서 비스듬히 본 것처럼 가로로 넓다. */
  rx: number;
  ry: number;
}

/** 웅덩이에 빠져 있는 동안의 이동 속도 배율 */
export const PUDDLE_SLOW = 0.6;

/** 한 칸의 크기(px). 칸마다 웅덩이가 하나 있거나 없다. */
const CELL = 112;
/** 칸에 웅덩이가 있을 확률(%) */
const CHANCE = 58;
const MIN_RADIUS = 18;
const MAX_RADIUS = 30;
/** 웅덩이가 칸 밖으로 나가지 않게 가장자리에서 띄우는 거리 */
const INSET = MAX_RADIUS + 2;

function mix(a: number, b: number, c: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** (cellX, cellY) 칸의 웅덩이. 없으면 null. 시작하는 자리의 칸에는 두지 않는다. */
export function puddleInCell(cellX: number, cellY: number, seed: number): Puddle | null {
  if (cellX === 0 && cellY === 0) return null;
  const h = mix(cellX, cellY, seed);
  if (h % 100 >= CHANCE) return null;
  const rx = MIN_RADIUS + ((h >>> 8) % (MAX_RADIUS - MIN_RADIUS + 1));
  const room = CELL - INSET * 2;
  return {
    x: cellX * CELL + INSET + ((h >>> 14) % (room + 1)),
    y: cellY * CELL + INSET + ((h >>> 22) % (room + 1)),
    rx,
    ry: Math.round(rx * 0.62),
  };
}

/** 세상 좌표 (x, y)가 웅덩이 안인지 */
export function inPuddle(x: number, y: number, seed: number): boolean {
  // 웅덩이는 제 칸을 벗어나지 않으므로 그 점이 든 칸만 보면 된다.
  const puddle = puddleInCell(Math.floor(x / CELL), Math.floor(y / CELL), seed);
  if (!puddle) return false;
  const dx = (x - puddle.x) / puddle.rx;
  const dy = (y - puddle.y) / puddle.ry;
  return dx * dx + dy * dy < 1;
}

/** (x, y)를 가운데로 한 네모 안에 걸치는 웅덩이를 모두 돌려준다. 화면에 그릴 때 쓴다. */
export function puddlesAround(x: number, y: number, halfW: number, halfH: number, seed: number): Puddle[] {
  const found: Puddle[] = [];
  const fromX = Math.floor((x - halfW) / CELL);
  const toX = Math.floor((x + halfW) / CELL);
  const fromY = Math.floor((y - halfH) / CELL);
  const toY = Math.floor((y + halfH) / CELL);
  for (let cellY = fromY; cellY <= toY; cellY += 1) {
    for (let cellX = fromX; cellX <= toX; cellX += 1) {
      const puddle = puddleInCell(cellX, cellY, seed);
      if (puddle) found.push(puddle);
    }
  }
  return found;
}
