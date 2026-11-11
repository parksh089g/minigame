/** 앱 전역 상수: 화면 크기, 팔레트, 글꼴. Phaser에 의존하지 않는다. */

export const APP_NAME = '포켓 아케이드';
export const APP_VERSION = __APP_VERSION__;

/** 논리 해상도의 가로는 고정이고, 세로는 기기 화면 비율에 맞춰 정한다. */
export const GAME_WIDTH = 240;
export const MIN_GAME_HEIGHT = 400;
export const MAX_GAME_HEIGHT = 560;

/**
 * 부모 요소 크기에 맞는 논리 세로 길이를 구한다.
 * 세로로 긴 휴대폰에서는 화면을 꽉 채우고, 가로로 넓은 화면에서는 최소 높이로 가운데에 놓인다.
 */
export function computeGameHeight(parentWidth: number, parentHeight: number): number {
  if (!(parentWidth > 0) || !(parentHeight > 0)) return MIN_GAME_HEIGHT;
  const fitted = Math.round((GAME_WIDTH * parentHeight) / parentWidth);
  return Math.min(MAX_GAME_HEIGHT, Math.max(MIN_GAME_HEIGHT, fitted));
}

/**
 * Sweetie 16 팔레트 (GrafxKid 제작).
 * 스프라이트 문자열에서는 16진수 한 글자(0~f)가 이 배열의 색 하나를 가리킨다.
 */
export const PALETTE = [
  '#1a1c2c', // 0 ink
  '#5d275d', // 1 plum
  '#b13e53', // 2 red
  '#ef7d57', // 3 orange
  '#ffcd75', // 4 yellow
  '#a7f070', // 5 lime
  '#38b764', // 6 green
  '#257179', // 7 teal
  '#29366f', // 8 navy
  '#3b5dc9', // 9 blue
  '#41a6f6', // a sky
  '#73eff7', // b cyan
  '#f4f4f4', // c white
  '#94b0c2', // d silver
  '#566c86', // e slate
  '#333c57', // f charcoal
] as const;

const hex = (index: number): number => Number.parseInt(PALETTE[index].slice(1), 16);

/** 팔레트 번호(0~15)를 Phaser 도형·틴트용 숫자 색으로 바꾼다. */
export function paletteColor(index: number): number {
  return hex(index);
}

/** Phaser 도형·틴트용 숫자 색. */
export const COLOR = {
  ink: hex(0),
  plum: hex(1),
  red: hex(2),
  orange: hex(3),
  yellow: hex(4),
  lime: hex(5),
  green: hex(6),
  teal: hex(7),
  navy: hex(8),
  blue: hex(9),
  sky: hex(10),
  cyan: hex(11),
  white: hex(12),
  silver: hex(13),
  slate: hex(14),
  charcoal: hex(15),
} as const;

/** 텍스트용 CSS 색 문자열. */
export const CSS = {
  ink: PALETTE[0],
  plum: PALETTE[1],
  red: PALETTE[2],
  orange: PALETTE[3],
  yellow: PALETTE[4],
  lime: PALETTE[5],
  green: PALETTE[6],
  teal: PALETTE[7],
  navy: PALETTE[8],
  blue: PALETTE[9],
  sky: PALETTE[10],
  cyan: PALETTE[11],
  white: PALETTE[12],
  silver: PALETTE[13],
  slate: PALETTE[14],
  charcoal: PALETTE[15],
} as const;

/** 갈무리11은 12px의 배수에서 픽셀이 또렷하게 나온다. */
export const FONT_FAMILY = 'Galmuri11';
export const FONT_SIZE = { normal: 12, large: 24, huge: 36 } as const;

export const SCENE = {
  boot: 'Boot',
  hub: 'Hub',
  settings: 'Settings',
  shop: 'Shop',
  result: 'Result',
  pause: 'Pause',
  lightningTap: 'LightningTap',
  memoryCards: 'MemoryCards',
  jumpRunner: 'JumpRunner',
} as const;
