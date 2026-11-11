/**
 * 꾸미기의 실제 색과 무늬. 무엇을 얼마에 파는지는 core/shop.ts에 있고, 여기서는 id마다 생김새만 정한다.
 * 숫자는 모두 config.ts의 PALETTE 색 번호다.
 */

/** 배경 무늬. 타일 하나를 그려서 화면 가득 이어 붙인다. */
export interface BackdropLook {
  /** 타일 한 변의 길이(px) */
  size: number;
  base: number;
  /** 타일 위에 찍는 점과 선: [x, y, 폭, 높이, 색] */
  marks: ReadonlyArray<readonly [number, number, number, number, number]>;
}

/**
 * 글자가 배경 위에 바로 놓이는 화면이 있어서, 바탕은 언제나 가장 어두운 색으로 두고
 * 무늬만 드문드문 바꾼다.
 */
export const BACKDROP_LOOKS: Record<string, BackdropLook> = {
  'backdrop-night': {
    size: 16,
    base: 0,
    marks: [
      [0, 0, 1, 1, 8],
      [8, 8, 1, 1, 8],
    ],
  },
  // 바람에 날리는 잎
  'backdrop-forest': {
    size: 32,
    base: 0,
    marks: [
      [5, 4, 2, 1, 7],
      [4, 5, 2, 1, 7],
      [6, 4, 1, 1, 6],
      [21, 12, 2, 1, 7],
      [20, 13, 2, 1, 7],
      [12, 21, 2, 1, 7],
      [11, 22, 2, 1, 7],
      [13, 21, 1, 1, 6],
      [28, 27, 2, 1, 7],
      [27, 28, 2, 1, 7],
      [14, 7, 1, 1, 7],
      [29, 18, 1, 1, 7],
      [2, 16, 1, 1, 7],
      [19, 29, 1, 1, 7],
    ],
  },
  // 길게 누운 구름과 불씨
  'backdrop-sunset': {
    size: 32,
    base: 0,
    marks: [
      [2, 5, 6, 1, 1],
      [4, 6, 3, 1, 1],
      [18, 13, 5, 1, 1],
      [19, 12, 2, 1, 1],
      [7, 22, 7, 1, 1],
      [10, 23, 3, 1, 1],
      [24, 28, 5, 1, 1],
      [23, 4, 1, 1, 3],
      [4, 15, 1, 1, 2],
      [28, 20, 1, 1, 3],
      [14, 29, 1, 1, 2],
    ],
  },
  // 크고 작은 별
  'backdrop-galaxy': {
    size: 32,
    base: 0,
    marks: [
      [0, 0, 1, 1, 8],
      [16, 16, 1, 1, 8],
      [8, 24, 1, 1, 8],
      [24, 8, 1, 1, 8],
      [13, 5, 1, 1, 8],
      [29, 25, 1, 1, 8],
      [20, 2, 1, 1, 1],
      [3, 18, 1, 1, 1],
      [26, 17, 1, 1, 1],
      [6, 11, 1, 3, 9],
      [5, 12, 3, 1, 9],
      [6, 12, 1, 1, 12],
      [22, 26, 1, 1, 4],
      [11, 30, 1, 1, 11],
    ],
  },
};

/** 러너 스프라이트의 몸 색 세 가지(밝은 곳, 그늘, 발)를 무엇으로 바꿀지 */
export interface RunnerLook {
  light: number;
  shade: number;
  dark: number;
}

/** 원본 스프라이트(sprites.ts의 runner-*)에서 몸을 그리는 데 쓴 색 */
export const RUNNER_SOURCE: RunnerLook = { light: 5, shade: 6, dark: 7 };

/** 장애물이 모두 붉은색이라, 캐릭터에는 붉은 계열을 쓰지 않는다. */
export const RUNNER_LOOKS: Record<string, RunnerLook> = {
  'runner-sprout': RUNNER_SOURCE,
  'runner-drop': { light: 11, shade: 10, dark: 9 },
  'runner-chick': { light: 4, shade: 3, dark: 3 },
  'runner-ghost': { light: 12, shade: 13, dark: 14 },
};

export const RUNNER_FRAMES = ['run1', 'run2', 'jump', 'hit'] as const;
export type RunnerFrame = (typeof RUNNER_FRAMES)[number];

/** 캐릭터 꾸미기 id와 동작으로 텍스처 이름을 만든다. */
export function runnerTexture(id: string, frame: RunnerFrame): string {
  return `${id}-${frame}`;
}

export type CardMotif = 'diamond' | 'dots' | 'checks' | 'stripes';

export interface CardBackLook {
  border: number;
  fill: number;
  mark: number;
  motif: CardMotif;
}

export const CARD_BACK_LOOKS: Record<string, CardBackLook> = {
  'cardback-blue': { border: 9, fill: 8, mark: 9, motif: 'diamond' },
  'cardback-green': { border: 6, fill: 7, mark: 6, motif: 'dots' },
  'cardback-red': { border: 2, fill: 1, mark: 2, motif: 'checks' },
  'cardback-gold': { border: 4, fill: 3, mark: 4, motif: 'stripes' },
};

/** 상점에서 보여 주는 작은 카드 뒷면의 텍스처 이름 */
export function cardBackPreviewTexture(id: string): string {
  return `${id}-mini`;
}

export interface OrbLook {
  /** 바깥에서 안쪽 순서의 [반지름, 색] */
  rings: ReadonlyArray<readonly [number, number]>;
  /** 사라지기까지 남은 시간을 알려 주는 고리의 색 */
  ring: number;
  /** 터질 때 튀는 조각의 색 */
  sparks: readonly number[];
}

/** 금색 구슬(보너스)과 헷갈리지 않도록 노란 계열은 쓰지 않는다. */
export const ORB_LOOKS: Record<string, OrbLook> = {
  'orb-blue': {
    rings: [
      [14, 0],
      [13, 9],
      [10.5, 10],
      [7, 11],
      [3.5, 12],
    ],
    ring: 10,
    sparks: [11, 10, 12],
  },
  'orb-green': {
    rings: [
      [14, 0],
      [13, 7],
      [10.5, 6],
      [7, 5],
      [3.5, 12],
    ],
    ring: 6,
    sparks: [5, 6, 12],
  },
  'orb-red': {
    rings: [
      [14, 0],
      [13, 1],
      [10.5, 2],
      [4.5, 12],
    ],
    ring: 2,
    sparks: [2, 1, 12],
  },
  'orb-moon': {
    rings: [
      [14, 0],
      [13, 14],
      [10.5, 13],
      [6, 12],
    ],
    ring: 13,
    sparks: [13, 14, 12],
  },
};
