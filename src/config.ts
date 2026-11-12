/** 앱 전역 상수: 화면 크기, 팔레트, 글꼴. Phaser에 의존하지 않는다. */

export const APP_NAME = '포켓 아케이드';
export const APP_VERSION = __APP_VERSION__;

/** 파일 주소에서 빌드가 붙인 해시를 꺼낸다: ".../assets/index-CHpDxKHg.js"에서 "CHpDxKHg". 없으면 빈 글자열. */
export function buildCodeOf(url: string): string {
  return /-([\w-]{8})\.js$/.exec(url.split(/[?#]/)[0])?.[1] ?? '';
}

/**
 * 이 빌드를 가리키는 짧은 코드. 빌드한 파일 이름에 붙는 해시라서, 게임 코드가 바뀐 배포마다 달라진다.
 * 설정 화면의 버전 옆에 보여서 기기에 새 버전이 깔렸는지 알아볼 수 있다.
 * 날짜를 따로 적어 넣지 않는 것은, 글만 고친 배포에도 파일이 달라져서 새 버전 안내가 뜨기 때문이다.
 * 개발 서버와 테스트에서는 빈 글자열이다.
 */
export const APP_BUILD = buildCodeOf(import.meta.url);

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

/**
 * 말랑 파스텔 테마. 화면의 바탕, 카드, 글자, 버튼은 모두 여기 색을 쓴다.
 * 위의 PALETTE는 픽셀 스프라이트 문자열이 가리키는 색이라 그대로 둔다.
 */
const THEME_HEX = {
  /** 화면 바탕 */
  bg: '#fff4ec',
  /** 카드와 버튼의 흰 면 */
  card: '#ffffff',
  /** 카드 아래에 깔리는 도톰한 그림자 */
  shadow: '#f3dcd3',
  /** 눌렸거나 비활성인 면 */
  dim: '#f6ece7',
  /** 기본 글자 */
  ink: '#5b4455',
  /** 색 있는 버튼 위의 글자, 캐릭터의 눈 */
  inkDeep: '#4a3545',
  /** 덜 중요한 글자 */
  sub: '#7a6170',
  /** 비활성 글자와 빈 아이콘 */
  faint: '#94818a',
  /** 점수, 코인처럼 눈에 띄어야 하는 글자 */
  accent: '#b3541e',
  /** 잘됐다는 글자 */
  good: '#2f7d5f',
  /** 안 됐다는 글자 */
  bad: '#c2413b',
  pink: '#ff9fb5',
  pinkDeep: '#e97f99',
  pinkSoft: '#ffe3ea',
  mint: '#9be3c9',
  mintDeep: '#7fd3ae',
  mintSoft: '#e2f6ee',
  butter: '#ffe9a8',
  butterDeep: '#f2cf73',
  butterSoft: '#fff0c9',
  gold: '#ffcf5c',
  lilac: '#c9bcf8',
  lilacDeep: '#9684e0',
  lilacSoft: '#e9e3ff',
  sky: '#9dd6ff',
  skyDeep: '#7dbef2',
  skySoft: '#e3f2ff',
  coral: '#ff8f8f',
  coralDeep: '#e06d75',
  white: '#ffffff',
} as const;

export type ThemeColor = keyof typeof THEME_HEX;

/** 글자용 CSS 색 문자열 */
export const THEME_CSS: Readonly<Record<ThemeColor, string>> = THEME_HEX;

/** Phaser 도형·틴트용 숫자 색 */
export const THEME = Object.fromEntries(
  Object.entries(THEME_HEX).map(([name, value]) => [name, Number.parseInt(value.slice(1), 16)]),
) as Readonly<Record<ThemeColor, number>>;

/** 주아(Jua)는 굵기가 하나뿐인 둥근 글꼴이다. */
export const FONT_FAMILY = 'Jua';
export const FONT_SIZE = { small: 10, normal: 12, large: 24, huge: 36 } as const;

export const SCENE = {
  boot: 'Boot',
  hub: 'Hub',
  settings: 'Settings',
  stats: 'Stats',
  stages: 'Stages',
  stageResult: 'StageResult',
  shop: 'Shop',
  achievements: 'Achievements',
  ranking: 'Ranking',
  result: 'Result',
  pause: 'Pause',
  lightningTap: 'LightningTap',
  memoryCards: 'MemoryCards',
  jumpRunner: 'JumpRunner',
  stackTower: 'StackTower',
  colorSort: 'ColorSort',
  gateRun: 'GateRun',
  pinPull: 'PinPull',
  parkingOut: 'ParkingOut',
  screwSort: 'ScrewSort',
  mergeTiles: 'MergeTiles',
  tailChase: 'TailChase',
  logicTiles: 'LogicTiles',
  numberPuzzle: 'NumberPuzzle',
  duel: 'Duel',
  pathLink: 'PathLink',
  blockFill: 'BlockFill',
  chosungQuiz: 'ChosungQuiz',
} as const;
