/**
 * 둘이서 대결의 자리 잡기. Phaser에 기대지 않는 순수한 계산이라 화면 길이마다 테스트할 수 있다.
 *
 * 화면은 가운데 줄을 사이에 두고 위아래 반쪽으로 나뉜다. 두 사람이 자기 자리에서 똑같은 화면을 보도록,
 * 반쪽 안의 자리는 모두 "그 사람이 보는 좌표"로 적는다: 원점은 화면 한가운데이고,
 * x는 그 사람의 오른쪽으로, y는 가운데 줄에서 그 사람 쪽으로 늘어난다.
 * 아래쪽 사람에게는 화면 좌표를 옮긴 것과 같고, 위쪽 사람에게는 화면을 반 바퀴 돌린 것과 같다.
 */
import { GAME_WIDTH } from '../../config';
import { READY_OPTION, SYMBOL_OPTIONS, type Player } from './rules';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** 가운데 줄의 절반 두께. 이 안을 누른 것은 누구의 것도 아니다. 일시정지 버튼과 점수 표시가 여기 놓인다. */
export const STRIP_HALF = 17;
/** 가운데 줄 왼쪽 끝에 놓이는 일시정지 버튼 (화면 좌표에서 가운데 줄을 기준으로 한 자리) */
export const PAUSE_BUTTON = { x: 4, size: 26, hitPadding: 6 } as const;
/** 가운데 줄 오른쪽 끝에 놓이는 점수 표시 칸 */
export const SCORE_PLATE = { right: GAME_WIDTH - 4, width: 50, height: 28 } as const;

/** 반쪽 판의 좌우 여백, 가운데 줄에서 띄우는 거리, 화면 끝에서 띄우는 거리 */
const PANEL = { side: 6, top: 19, bottom: 6 } as const;
/**
 * 같은 그림 찾기의 버튼. 손가락으로 급하게 눌러도 맞도록 가장 짧은 화면에서도 44px보다 넉넉하게 두고,
 * 화면이 길면 세로로 더 키운다(반쪽이 1px 길어질 때마다 grow만큼, maxHeight까지).
 */
const SYMBOL_BUTTON = { width: 50, height: 52, maxHeight: 64, grow: 0.15, gap: 6, bottom: 10 } as const;
/** 가장 짧은 화면에서의 반쪽 길이. 여기서부터 길어진 만큼 버튼을 키운다. */
const SHORTEST_DEPTH = 200;
const READY_BUTTON = { width: 150, height: 46, bottom: 12 } as const;
const END_BUTTON = { width: 100, height: 32, gap: 8, bottom: 12 } as const;

export interface HalfLayout {
  /** 가운데 줄에서 화면 끝까지의 길이 */
  depth: number;
  /** 반쪽을 채우는 둥근 판 */
  panel: Rect;
  readyButton: Rect;
  /** 같은 그림 찾기의 버튼 넷. 그 사람이 보는 왼쪽부터다. */
  symbolButtons: Rect[];
  /** 찾아야 하는 그림이 놓이는 둥근 자리. 가운데 줄 바로 앞이다. */
  target: Point & { radius: number };
  /** 연타 줄다리기에서 가운데 줄부터 이 사람의 골라인까지의 거리 */
  goal: number;
  /** 경기가 끝났을 때의 "다시 하기"와 "나가기" */
  endButtons: [Rect, Rect];
}

/** 화면에서 가운데 줄이 놓이는 높이 */
export function centerLine(screenHeight: number): number {
  return Math.round(screenHeight / 2);
}

export function halfLayout(screenHeight: number): HalfLayout {
  const depth = Math.floor(screenHeight / 2);
  const panel: Rect = {
    x: -GAME_WIDTH / 2 + PANEL.side,
    y: PANEL.top,
    width: GAME_WIDTH - PANEL.side * 2,
    height: depth - PANEL.top - PANEL.bottom,
  };
  const bottom = panel.y + panel.height;

  const rowWidth = SYMBOL_OPTIONS * SYMBOL_BUTTON.width + (SYMBOL_OPTIONS - 1) * SYMBOL_BUTTON.gap;
  const symbolHeight = Math.round(
    Math.min(
      SYMBOL_BUTTON.maxHeight,
      SYMBOL_BUTTON.height + Math.max(0, depth - SHORTEST_DEPTH) * SYMBOL_BUTTON.grow,
    ),
  );
  const symbolButtons = Array.from({ length: SYMBOL_OPTIONS }, (_, index) => ({
    x: -rowWidth / 2 + index * (SYMBOL_BUTTON.width + SYMBOL_BUTTON.gap),
    y: bottom - SYMBOL_BUTTON.bottom - symbolHeight,
    width: SYMBOL_BUTTON.width,
    height: symbolHeight,
  }));

  const endTop = bottom - END_BUTTON.bottom - END_BUTTON.height;
  const endButton = (x: number): Rect => ({ x, y: endTop, width: END_BUTTON.width, height: END_BUTTON.height });

  const radius = 25;
  return {
    depth,
    panel,
    readyButton: {
      x: -READY_BUTTON.width / 2,
      y: bottom - READY_BUTTON.bottom - READY_BUTTON.height,
      width: READY_BUTTON.width,
      height: READY_BUTTON.height,
    },
    symbolButtons,
    target: { x: 0, y: panel.y + 8 + radius, radius },
    goal: Math.round(Math.min(124, Math.max(90, depth * 0.46))),
    endButtons: [endButton(-END_BUTTON.width - END_BUTTON.gap / 2), endButton(END_BUTTON.gap / 2)],
  };
}

/**
 * 화면의 한 점이 누구의 반쪽인지. 가운데 줄과 일시정지 버튼 둘레는 누구의 것도 아니라서 null이다.
 */
export function sideOf(x: number, y: number, screenHeight: number): Player | null {
  const offset = y - centerLine(screenHeight);
  if (Math.abs(offset) < STRIP_HALF) return null;
  const pauseReach = PAUSE_BUTTON.size / 2 + PAUSE_BUTTON.hitPadding + 2;
  if (x < PAUSE_BUTTON.x + PAUSE_BUTTON.size + PAUSE_BUTTON.hitPadding + 2 && Math.abs(offset) < pauseReach) {
    return null;
  }
  return offset > 0 ? 0 : 1;
}

/** 화면의 점을 그 사람이 보는 좌표로 바꾼다. */
export function toLocal(player: Player, x: number, y: number, screenHeight: number): Point {
  const mid = centerLine(screenHeight);
  return player === 0 ? { x: x - GAME_WIDTH / 2, y: y - mid } : { x: GAME_WIDTH / 2 - x, y: mid - y };
}

/** 그 사람이 보는 좌표의 점을 화면의 점으로 바꾼다. */
export function toScreen(player: Player, x: number, y: number, screenHeight: number): Point {
  const mid = centerLine(screenHeight);
  return player === 0 ? { x: GAME_WIDTH / 2 + x, y: mid + y } : { x: GAME_WIDTH / 2 - x, y: mid - y };
}

/** 그 사람이 보는 좌표의 네모를 화면의 네모로 바꾼다. 위쪽 사람의 것은 반 바퀴 돌아간 자리에 놓인다. */
export function screenRect(player: Player, rect: Rect, screenHeight: number): Rect {
  const corner =
    player === 0
      ? toScreen(player, rect.x, rect.y, screenHeight)
      : toScreen(player, rect.x + rect.width, rect.y + rect.height, screenHeight);
  return { x: corner.x, y: corner.y, width: rect.width, height: rect.height };
}

function contains(rect: Rect, x: number, y: number, slopX: number, slopY: number): boolean {
  return (
    x >= rect.x - slopX &&
    x < rect.x + rect.width + slopX &&
    y >= rect.y - slopY &&
    y < rect.y + rect.height + slopY
  );
}

/** 지금 그 사람의 반쪽에 누를 수 있게 나와 있는 버튼들 */
export type Buttons = 'none' | 'ready' | 'symbols';

/**
 * 그 사람이 보는 좌표 (x, y)를 눌렀을 때 눌린 버튼의 번호. 버튼이 아닌 곳이면 undefined다.
 * 급하게 누르는 버튼이라 보이는 것보다 조금 넓게 받는다. 그림 버튼은 사이의 틈을 반씩 나눠 갖는다.
 */
export function optionAt(layout: HalfLayout, buttons: Buttons, x: number, y: number): number | undefined {
  if (buttons === 'ready') {
    return contains(layout.readyButton, x, y, 8, 8) ? READY_OPTION : undefined;
  }
  if (buttons === 'symbols') {
    const index = layout.symbolButtons.findIndex((rect) =>
      contains(rect, x, y, SYMBOL_BUTTON.gap / 2, SYMBOL_BUTTON.bottom - 2),
    );
    return index >= 0 ? index : undefined;
  }
  return undefined;
}
