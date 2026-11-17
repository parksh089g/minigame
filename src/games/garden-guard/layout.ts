/**
 * 판이 화면에 놓이는 자리와, 시뮬레이션 좌표와 화면 좌표를 서로 바꾸는 셈.
 * 그리는 일(view.ts)과 따로 두어서 화면 없이 테스트한다.
 */
import { FIELD, SHOOTER } from './data';

export interface FieldLayout {
  /** 벌레가 나타나는 줄(시뮬레이션의 y = 0)의 화면 y */
  top: number;
  /** 울타리(시뮬레이션의 y = FIELD.depth)의 화면 y */
  fenceY: number;
  /** 시뮬레이션의 세로 1이 화면에서 차지하는 길이 */
  scaleY: number;
  /** 화면의 세로 길이 */
  height: number;
}

/** 울타리 아래에 텃밭(세 줄의 칸)과 물총, 물벼락 버튼, 울타리 막대가 놓이는 높이 */
export const GARDEN_HEIGHT = 98;

/** 화면 길이에 맞춰 판이 놓일 자리를 정한다. hudHeight 아래부터 판이다. */
export function layoutField(height: number, hudHeight: number): FieldLayout {
  const fenceY = height - GARDEN_HEIGHT;
  return { top: hudHeight, fenceY, scaleY: (fenceY - hudHeight) / FIELD.depth, height };
}

/**
 * 시뮬레이션의 y를 화면의 y로 바꾼다. 울타리 위의 판만 화면 길이에 맞춰 늘이거나 줄이고,
 * 울타리 아래(물총과 해바라기가 선 텃밭)는 늘 같은 크기로 둔다.
 */
export function toScreenY(layout: FieldLayout, y: number): number {
  return layout.fenceY + (y - FIELD.depth) * (y > FIELD.depth ? 1 : layout.scaleY);
}

/** 화면의 한 점을 시뮬레이션 좌표로 바꾼다. */
export function toSim(layout: FieldLayout, x: number, y: number): { x: number; y: number } {
  return { x, y: FIELD.depth + (y - layout.fenceY) / (y > layout.fenceY ? 1 : layout.scaleY) };
}

/**
 * 직접 겨눌 때 보여 주는 점선의 점들(화면 좌표). 물방울이 실제로 날아가는 길 위에, 물총에서 화면으로 잰 길이
 * from부터 to까지 gap마다 놓는다. aim은 시뮬레이션에서 물방울이 날아가는 쪽이다.
 * 물방울은 시뮬레이션에서 곧게 날아가지만 화면은 울타리 위쪽만 세로로 늘이므로, 화면에서는 울타리에서 한 번 꺾인다.
 * 곧게만 그으면 옆을 겨눌수록 물방울의 길과 어긋난다.
 */
export function aimDots(
  layout: FieldLayout,
  aim: number,
  from: number,
  to: number,
  gap: number,
): Array<{ x: number; y: number }> {
  const cos = Math.cos(aim);
  const sin = Math.sin(aim);
  // 울타리까지의 길이. 울타리 아래는 늘이지 않으므로 화면에서도 같은 길이다. 위를 겨누지 않으면 울타리에 닿지 않는다.
  const toFence = sin < 0 ? (FIELD.depth - SHOOTER.y) / sin : Infinity;
  // 울타리 위에서 시뮬레이션의 길이 1이 화면에서 차지하는 길이
  const stretch = Math.hypot(cos, sin * layout.scaleY);
  const dots: Array<{ x: number; y: number }> = [];
  for (let length = from; length < to; length += gap) {
    const along = length <= toFence ? length : toFence + (length - toFence) / stretch;
    dots.push({ x: SHOOTER.x + cos * along, y: toScreenY(layout, SHOOTER.y + sin * along) });
  }
  return dots;
}
