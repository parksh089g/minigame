/**
 * 꾸미기의 실제 색과 무늬. 무엇을 얼마에 파는지는 core/shop.ts에 있고, 여기서는 id마다 생김새만 정한다.
 * 그림은 art/vector.ts가 이 값을 보고 그린다. 색은 CSS 색 문자열이다.
 */

/** 배경 위에 드문드문 놓는 무늬 */
export type BackdropShape = 'dot' | 'leaf' | 'cloud' | 'star';

/** 배경 무늬. 타일 하나를 그려서 화면 가득 이어 붙인다. */
export interface BackdropLook {
  /** 타일 한 변의 길이(논리 픽셀) */
  size: number;
  base: string;
  /** 타일 위에 놓는 무늬: [모양, 중심 x, 중심 y, 크기, 색]. 타일 밖으로 나가면 이음매가 보인다. */
  marks: ReadonlyArray<readonly [BackdropShape, number, number, number, string]>;
}

/**
 * 글자가 배경 위에 바로 놓이는 화면이 있어서, 바탕은 언제나 아주 밝은 색으로 두고
 * 무늬도 바탕과 비슷한 밝기로만 그린다.
 */
export const BACKDROP_LOOKS: Record<string, BackdropLook> = {
  // 기본 배경. 이름은 예전(밤하늘) 그대로지만 지금은 복숭아빛 크림이다.
  'backdrop-night': {
    size: 120,
    base: '#fff4ec',
    marks: [
      ['dot', 26, 28, 20, '#ffe9ee'],
      ['dot', 88, 64, 16, '#eaf7f1'],
      ['dot', 36, 96, 12, '#fff0d2'],
      ['dot', 98, 18, 5, '#ffe9ee'],
      ['dot', 66, 108, 4, '#eaf7f1'],
    ],
  },
  // 바람에 날리는 잎
  'backdrop-forest': {
    size: 120,
    base: '#f1faf4',
    marks: [
      ['leaf', 24, 26, 12, '#d6f0e2'],
      ['leaf', 84, 50, 9, '#dff5ea'],
      ['leaf', 44, 88, 11, '#d6f0e2'],
      ['leaf', 100, 100, 7, '#dff5ea'],
      ['dot', 68, 18, 3.5, '#d6f0e2'],
      ['dot', 14, 66, 3, '#dff5ea'],
    ],
  },
  // 길게 누운 구름
  'backdrop-sunset': {
    size: 120,
    base: '#fff0e6',
    marks: [
      ['cloud', 34, 32, 22, '#ffe2d2'],
      ['cloud', 88, 80, 18, '#ffe6ea'],
      ['dot', 96, 26, 4, '#ffe6ea'],
      ['dot', 22, 92, 5, '#ffe2d2'],
    ],
  },
  // 크고 작은 별
  'backdrop-galaxy': {
    size: 120,
    base: '#f4f0ff',
    marks: [
      ['star', 26, 28, 9, '#e4dcff'],
      ['star', 88, 58, 12, '#e9e3ff'],
      ['star', 40, 96, 7, '#fff0c9'],
      ['star', 102, 104, 5, '#e4dcff'],
      ['dot', 66, 16, 2.5, '#fff0c9'],
      ['dot', 12, 66, 2.5, '#e4dcff'],
      ['dot', 70, 100, 2, '#e9e3ff'],
    ],
  },
};

/** 달리는 친구의 생김새. 그림은 art/vector.ts의 CHARACTERS에 있다. */
export type CharacterKind = 'sprout' | 'drop' | 'chick' | 'ghost' | 'duck' | 'dog';

export interface RunnerLook {
  kind: CharacterKind;
  /** 몸의 대표색. 장애물과 같은 산호색 계열은 쓰지 않는다. */
  body: string;
}

/** 점프 러너의 장애물은 모두 이 색 계열이다. */
export const OBSTACLE_COLORS = ['#ff8f8f', '#ffa3a0', '#e06d75'] as const;

export const RUNNER_LOOKS: Record<string, RunnerLook> = {
  'runner-sprout': { kind: 'sprout', body: '#9be3c9' },
  'runner-drop': { kind: 'drop', body: '#9dd6ff' },
  'runner-duck': { kind: 'duck', body: '#fffdf6' },
  'runner-chick': { kind: 'chick', body: '#ffe08a' },
  'runner-dog': { kind: 'dog', body: '#f6cfa3' },
  'runner-ghost': { kind: 'ghost', body: '#ffffff' },
};

export const RUNNER_FRAMES = ['run1', 'run2', 'jump', 'hit'] as const;
export type RunnerFrame = (typeof RUNNER_FRAMES)[number];

/** 캐릭터 꾸미기 id와 동작으로 텍스처 이름을 만든다. */
export function runnerTexture(id: string, frame: RunnerFrame): string {
  return `${id}-${frame}`;
}

/** 메뉴에 세워 두는 큰 캐릭터의 텍스처 이름. idle은 서 있는 모습, cheer는 기뻐하는 모습이다. */
export function mascotTexture(id: string, pose: 'idle' | 'cheer'): string {
  return `${id}-big-${pose}`;
}

export type CardMotif = 'diamond' | 'dots' | 'checks' | 'stripes';

export interface CardBackLook {
  /** 카드 면의 색 */
  face: string;
  /** 카드 아래에 보이는 두께의 색 */
  lip: string;
  /** 무늬의 색 */
  mark: string;
  motif: CardMotif;
}

export const CARD_BACK_LOOKS: Record<string, CardBackLook> = {
  'cardback-blue': { face: '#9dd6ff', lip: '#7dbef2', mark: '#bfe4ff', motif: 'diamond' },
  'cardback-green': { face: '#9be3c9', lip: '#7fd3ae', mark: '#bff0dd', motif: 'dots' },
  'cardback-red': { face: '#ff9fb5', lip: '#e97f99', mark: '#ffbccb', motif: 'checks' },
  'cardback-gold': { face: '#ffd772', lip: '#f2b93b', mark: '#ffe9a8', motif: 'stripes' },
};

/** 상점에서 보여 주는 배경 조각의 텍스처 이름 */
export function backdropPreviewTexture(id: string): string {
  return `${id}-preview`;
}

export interface OrbLook {
  base: string;
  /** 아래쪽에 살짝 보이는 그늘 */
  shade: string;
  /** 왼쪽 위의 반짝임 */
  light: string;
  /** 덧붙는 장식. berry는 딸기 꼭지와 씨, sparkle은 작은 별 */
  motif?: 'berry' | 'sparkle';
  /** 표정. 없으면 웃는 얼굴 */
  mood?: 'smile' | 'sleepy' | 'happy';
  /** 사라지기까지 남은 시간을 알려 주는 고리의 색 */
  ring: number;
  /** 터질 때 튀는 조각의 색 */
  sparks: readonly number[];
}

/** 보너스 구슬. 상점에서 팔지 않고 언제나 이 모습이다. */
export const GOLD_ORB: OrbLook = {
  base: '#ffcf5c',
  shade: '#f2b93b',
  light: '#fff0bd',
  motif: 'sparkle',
  mood: 'happy',
  ring: 0xf2b93b,
  sparks: [0xffcf5c, 0xffe9a8, 0xffffff],
};

/** 금색 구슬(보너스)과 헷갈리지 않도록 노란 계열은 쓰지 않는다. */
export const ORB_LOOKS: Record<string, OrbLook> = {
  'orb-blue': {
    base: '#8ccbff',
    shade: '#6fb5ee',
    light: '#c9e8ff',
    ring: 0x7dbef2,
    sparks: [0x8ccbff, 0xc9e8ff, 0xffffff],
  },
  'orb-green': {
    base: '#9be3c9',
    shade: '#74cba6',
    light: '#c6f2e2',
    ring: 0x7fd3ae,
    sparks: [0x9be3c9, 0xc6f2e2, 0xffffff],
  },
  'orb-red': {
    base: '#ff9fb5',
    shade: '#e97f99',
    light: '#ffd0db',
    motif: 'berry',
    ring: 0xe97f99,
    sparks: [0xff9fb5, 0xffd0db, 0xffffff],
  },
  'orb-moon': {
    base: '#d9cfff',
    shade: '#b9a9f5',
    light: '#f1ecff',
    mood: 'sleepy',
    ring: 0xb9a9f5,
    sparks: [0xd9cfff, 0xf1ecff, 0xffffff],
  },
};
