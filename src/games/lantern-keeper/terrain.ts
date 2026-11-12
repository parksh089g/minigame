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

// ------------------------------------------------------------ 불구멍

/**
 * 잿빛 고개의 불구멍. 웅덩이처럼 칸 좌표와 씨앗으로 자리를 정하고,
 * 언제 솟는지도 그 칸의 값과 지난 시간으로 계산한다. 그래서 따로 저장할 것이 없다.
 */
export interface Vent {
  x: number;
  y: number;
  rx: number;
  ry: number;
  /** 이 불구멍의 박자가 어긋난 정도(초). 불구멍마다 솟는 때가 다르다. */
  offset: number;
}

/** 불구멍의 지금 모습: 잠잠하다 · 달아오른다(곧 솟는다) · 불길이 솟는다 */
export type VentPhase = 'idle' | 'warm' | 'erupt';

/**
 * 불구멍의 박자(초). period마다 한 번, warm 동안 달아올랐다가 erupt 동안 불길이 솟는다.
 * tick마다 그 위의 그림자가 덴다.
 */
export const VENT = {
  period: 7,
  warm: 1.4,
  erupt: 1.1,
  tick: 0.25,
  /** 불길 위에 있던 플레이어가 받는 피해 */
  damage: 9,
  /** 불길 위의 보통 그림자가 tick마다 잃는 체력: 최대 체력의 이만큼, 적어도 floor */
  share: 0.14,
  floor: 5,
  /** 보스가 tick마다 잃는 체력 */
  boss: 8,
} as const;

const VENT_CELL = 104;
const VENT_CHANCE = 52;
const VENT_MIN = 15;
const VENT_MAX = 21;
const VENT_INSET = VENT_MAX + 2;
/** 웅덩이와 같은 씨앗을 써도 자리가 겹치지 않게 섞는 값 */
const VENT_SALT = 0x5bd1e995;

/** (cellX, cellY) 칸의 불구멍. 없으면 null. 시작하는 자리의 칸에는 두지 않는다. */
export function ventInCell(cellX: number, cellY: number, seed: number): Vent | null {
  if (cellX === 0 && cellY === 0) return null;
  const h = mix(cellX, cellY, seed ^ VENT_SALT);
  if (h % 100 >= VENT_CHANCE) return null;
  const rx = VENT_MIN + ((h >>> 8) % (VENT_MAX - VENT_MIN + 1));
  const room = VENT_CELL - VENT_INSET * 2;
  return {
    x: cellX * VENT_CELL + VENT_INSET + ((h >>> 14) % (room + 1)),
    y: cellY * VENT_CELL + VENT_INSET + ((h >>> 22) % (room + 1)),
    rx,
    ry: Math.round(rx * 0.66),
    offset: ((h >>> 3) % 700) / 100,
  };
}

/** 세상 좌표 (x, y)를 덮고 있는 불구멍. 없으면 null */
export function ventAt(x: number, y: number, seed: number): Vent | null {
  const vent = ventInCell(Math.floor(x / VENT_CELL), Math.floor(y / VENT_CELL), seed);
  if (!vent) return null;
  const dx = (x - vent.x) / vent.rx;
  const dy = (y - vent.y) / vent.ry;
  return dx * dx + dy * dy < 1 ? vent : null;
}

/** 한 바퀴 가운데 지금 어디쯤인지(초). 0에서 달아오르기 시작한다. */
export function ventClock(vent: Vent, t: number): number {
  return (((t + vent.offset) % VENT.period) + VENT.period) % VENT.period;
}

/** t초일 때 그 불구멍의 모습 */
export function ventPhase(vent: Vent, t: number): VentPhase {
  const clock = ventClock(vent, t);
  if (clock < VENT.warm) return 'warm';
  return clock < VENT.warm + VENT.erupt ? 'erupt' : 'idle';
}

/** (x, y)를 가운데로 한 네모 안에 걸치는 불구멍을 모두 돌려준다. */
export function ventsAround(x: number, y: number, halfW: number, halfH: number, seed: number): Vent[] {
  const found: Vent[] = [];
  const fromX = Math.floor((x - halfW) / VENT_CELL);
  const toX = Math.floor((x + halfW) / VENT_CELL);
  const fromY = Math.floor((y - halfH) / VENT_CELL);
  const toY = Math.floor((y + halfH) / VENT_CELL);
  for (let cellY = fromY; cellY <= toY; cellY += 1) {
    for (let cellX = fromX; cellX <= toX; cellX += 1) {
      const vent = ventInCell(cellX, cellY, seed);
      if (vent) found.push(vent);
    }
  }
  return found;
}
