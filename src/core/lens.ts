/**
 * 누른 칸을 손가락 위에 크게 띄워 보여 주는 말풍선.
 * 칸이 작은 판에서는 손가락이 칸을 가려서 어느 칸을 눌렀는지 보이지 않는다.
 * 손을 떼기 전에 이것을 보고, 잘못 눌렀으면 손가락을 옆으로 밀어서 그만둘 수 있다.
 * 여기에는 자리를 정하는 계산만 있고, 그리는 것은 lens-view.ts의 PressLens가 한다.
 */
import { GAME_WIDTH } from '../config';

/** 말풍선의 크기, 칸에서 떨어진 거리, 모서리, 꼬리의 길이, 화면 가장자리와의 틈 */
export const LENS = { size: 44, gap: 12, radius: 12, tail: 6, margin: 4 } as const;
/** 말풍선 안에서 칸의 그림이 차지하는 크기 */
export const LENS_ROOM = LENS.size - 10;

/** 눌린 칸. (x, y)는 칸의 한가운데(화면 좌표)이고 size는 한 변의 길이다. */
export interface LensCell {
  x: number;
  y: number;
  size: number;
}

export interface LensSpot {
  /** 말풍선의 한가운데 */
  x: number;
  y: number;
  /** 꼬리가 가리킬 칸의 가로 자리. 말풍선을 옆으로 비켜 놓았으면(위에 자리가 없을 때) null이다. */
  tailX: number | null;
}

/**
 * 말풍선을 놓을 자리. 보통은 칸의 바로 위다. top은 말풍선이 넘어가면 안 되는 위쪽 끝이다.
 * 위에 자리가 모자라면 칸과 같은 높이에서 화면 가운데 쪽으로 비켜 놓는다(아래는 손에 가린다).
 */
export function lensSpot(cell: LensCell, top: number, width = GAME_WIDTH): LensSpot {
  const half = LENS.size / 2;
  const clampX = (x: number): number => Math.min(width - half - LENS.margin, Math.max(half + LENS.margin, x));
  const above = cell.y - cell.size / 2 - LENS.gap - half;
  if (above - half >= top) {
    const x = clampX(cell.x);
    // 꼬리는 말풍선의 둥근 모서리를 벗어나지 않는 데까지만 칸을 따라간다.
    const reach = half - LENS.radius - LENS.tail / 2;
    return { x, y: above, tailX: Math.min(x + reach, Math.max(x - reach, cell.x)) };
  }
  const side = cell.x < width / 2 ? 1 : -1;
  const x = clampX(cell.x + side * (cell.size / 2 + LENS.gap * 2 + half));
  return { x, y: Math.max(top + half, cell.y - half), tailX: null };
}
