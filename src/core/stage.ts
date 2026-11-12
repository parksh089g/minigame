/**
 * 게임 화면(캔버스)이 창의 어디에 얼마나 크게 놓였는지에 맞춰, 캔버스 밖(DOM)에 띄우는 것들의 자리와 크기를 정한다.
 * 안내 문구와 입력 창은 캔버스 밖에 그리는데, 창의 크기만 보고 놓으면 태블릿처럼 캔버스가 크게 보이는 화면에서
 * 게임 속 글자보다 훨씬 작아 보인다. 여기에는 계산만 있고, 캔버스를 재는 일은 stage-watch.ts가 한다.
 */
import { GAME_WIDTH } from '../config';

/** 창 안에서 캔버스가 차지하는 자리(CSS 픽셀) */
export interface StageBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 캔버스가 이 폭으로 보일 때 안내 문구와 입력 창이 제 크기(1배)다. 흔한 휴대폰의 폭이다. */
const UI_BASE_WIDTH = 390;
/** 아주 큰 화면에서도 이보다 키우지는 않는다. */
const UI_SCALE_MAX = 2;

/**
 * 안내 문구와 입력 창을 몇 배로 보여 줄지. 휴대폰에서는 1이고, 캔버스가 넓게 보일수록 커진다.
 * 작은 휴대폰에서도 줄이지는 않는다(글자가 읽기 어려워진다).
 */
export function uiScale(displayWidth: number): number {
  if (!Number.isFinite(displayWidth) || displayWidth <= 0) return 1;
  const scale = Math.min(UI_SCALE_MAX, Math.max(1, displayWidth / UI_BASE_WIDTH));
  return Math.round(scale * 100) / 100;
}

/** 안내 문구가 캔버스 아래쪽 끝에서 떨어진 거리(1배일 때의 CSS 픽셀) */
const TOAST_BOTTOM_GAP = 28;
/** 안내 문구와 캔버스 옆 끝 사이의 틈(CSS 픽셀) */
const TOAST_SIDE_GAP = 12;

export interface ToastPlace {
  /** 문구의 가로 가운데(창의 왼쪽 끝에서) */
  centerX: number;
  /** 문구의 세로 가운데(창의 위쪽 끝에서). 아래쪽에 붙여 놓을 때는 null이다. */
  centerY: number | null;
  /** 문구의 아래쪽 끝이 창의 아래쪽 끝에서 떨어진 거리. 세로 가운데를 정해 놓을 때는 null이다. */
  bottom: number | null;
  scale: number;
  /** 키우기 전의 폭이 이보다 넓어지면 안 된다(키운 뒤에도 캔버스를 넘지 않게). */
  maxWidth: number;
}

/**
 * 안내 문구를 놓을 자리. anchorY는 문구의 가운데가 올 높이(게임 화면의 논리 좌표)이고,
 * null이면 캔버스의 아래쪽에 놓는다.
 */
export function placeToast(stage: StageBox, viewportHeight: number, anchorY: number | null): ToastPlace {
  const scale = uiScale(stage.width);
  const base = {
    centerX: stage.left + stage.width / 2,
    scale,
    maxWidth: Math.max(0, (stage.width - TOAST_SIDE_GAP * 2) / scale),
  };
  if (anchorY === null) {
    const bottom = viewportHeight - (stage.top + stage.height) + TOAST_BOTTOM_GAP * scale;
    return { ...base, centerY: null, bottom };
  }
  return { ...base, centerY: stage.top + (anchorY * stage.width) / GAME_WIDTH, bottom: null };
}
