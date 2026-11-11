/**
 * 논리 타일의 그림. 색은 LOOK 한곳에 모아 두고, 모든 것을 둥근 도형으로 그린다.
 * 겉모습을 바꿀 때는 이 파일만 고치면 된다. 씬은 여기 함수들이 그린 것을 놓고 움직이기만 한다.
 * 덮인 칸은 도톰한 풀 방석, 열린 칸은 평평한 모래 바닥, 함정은 낮잠 자는 고슴도치다.
 */
import type Phaser from 'phaser';
import { THEME, THEME_CSS } from '../../config';
import { drawPanel } from '../../core/ui';

type Graphics = Phaser.GameObjects.Graphics;

/** 누르면 칸을 여는 모드와 깃발을 꽂는 모드. 단추에 놓이는 순서대로다. */
export const MODES = ['open', 'flag'] as const;
export type Mode = (typeof MODES)[number];
/** awake: 밟혀서 놀란 얼굴, asleep: 끝난 뒤에 드러난 자는 얼굴 */
export type HogMood = 'awake' | 'asleep';

export const LOOK = {
  board: {
    /** 판을 두르는 테두리와 그 아래 두께 */
    rim: THEME.card,
    rimLip: THEME.shadow,
    /** 깃발 모드일 때 테두리에 두르는 띠. 지금 누르면 깃발이 꽂힌다는 것을 판에서도 알 수 있다. */
    flagRim: THEME.coral,
    /** 열린 칸의 바닥과 칸 사이의 옅은 금 */
    floor: THEME.butterSoft,
    seam: THEME.butterDeep,
    /** 함정을 밟은 칸의 바닥 */
    tripped: THEME.pinkSoft,
  },
  /** 덮인 칸: 윗면, 아래 두께, 윗면의 반짝임 */
  pad: { face: THEME.mint, lip: THEME.mintDeep, shine: THEME.mintSoft },
  flag: { pole: THEME.ink, cloth: THEME.coral, fold: THEME.coralDeep, dot: THEME.white },
  hog: {
    spikes: THEME.sub,
    face: THEME.butter,
    ear: THEME.butterDeep,
    cheek: THEME.pink,
    nose: THEME.coralDeep,
    eye: THEME.inkDeep,
    glint: THEME.white,
  },
  hearts: { plate: THEME.card, plateLip: THEME.shadow, full: THEME.pinkDeep, empty: THEME.shadow },
  toggle: {
    plate: THEME.card,
    plateLip: THEME.shadow,
    pressed: THEME.dim,
    open: { face: THEME.mint, lip: THEME.mintDeep },
    flag: { face: THEME.coral, lip: THEME.coralDeep },
    /** 고른 쪽과 고르지 않은 쪽의 아이콘. 고른 깃발 아이콘은 천만 흰색이다. */
    iconOn: THEME.inkDeep,
    iconOff: THEME.faint,
    clothOn: THEME.white,
  },
  /** 숫자 1~8의 색. 숫자 모양만으로도 읽히고, 색은 한눈에 가려 보는 데 보탬이 된다. */
  digits: [
    THEME_CSS.lilacDeep,
    THEME_CSS.good,
    THEME_CSS.bad,
    THEME_CSS.inkDeep,
    THEME_CSS.accent,
    THEME_CSS.pinkDeep,
    THEME_CSS.sub,
    THEME_CSS.faint,
  ],
  sparks: {
    /** 칸이 열릴 때 날리는 풀잎 */
    open: [THEME.mint, THEME.mintDeep, THEME.mintSoft],
    trip: [THEME.coral, THEME.coralDeep, THEME.butter],
    clear: [THEME.gold, THEME.pink, THEME.mintDeep, THEME.skyDeep],
  },
  text: {
    hint: THEME_CSS.ink,
    hintSub: THEME_CSS.sub,
    outline: THEME_CSS.white,
    /** 판 위에 뜨는 "+점수 +시간" 글자 뒤의 바탕 */
    plate: THEME.card,
    points: THEME_CSS.accent,
    good: THEME_CSS.good,
    bad: THEME_CSS.bad,
    ready: THEME_CSS.accent,
    over: THEME_CSS.accent,
    stage: THEME_CSS.sub,
    toggleOn: THEME_CSS.inkDeep,
    toggleOff: THEME_CSS.faint,
  },
} as const;

/** 깃발과 고슴도치를 그릴 때 기준으로 삼은 칸 크기. 칸이 더 크면 그만큼 키워서 놓는다. */
export const ART_CELL = 27;
/** 판의 테두리 폭 */
export const RIM = 4;
/** 덮인 칸 아래에 보이는 두께 */
const PAD_LIP = 2.5;

// ───────── 판 ─────────

/**
 * 판의 바닥을 그린다. 원점은 판의 한가운데다.
 * 덮인 칸은 이 위에 따로 얹으므로, 여기서는 테두리와 열린 칸의 바닥만 그린다.
 */
export function drawBoard(g: Graphics, cols: number, rows: number, cell: number, mode: Mode): void {
  const width = cols * cell;
  const height = rows * cell;
  const left = -width / 2;
  const top = -height / 2;

  g.clear();
  drawPanel(g, left - RIM, top - RIM, width + RIM * 2, height + RIM * 2, {
    fill: LOOK.board.rim,
    shadow: LOOK.board.rimLip,
    border: mode === 'flag' ? LOOK.board.flagRim : undefined,
    radius: RIM + 7,
  });
  g.fillStyle(LOOK.board.floor, 1);
  g.fillRoundedRect(left, top, width, height, 8);

  // 칸 사이의 금. 모서리에서 겹치지 않게 칸마다 짧게 끊어 그린다.
  g.fillStyle(LOOK.board.seam, 0.45);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = left + col * cell;
      const y = top + row * cell;
      if (col > 0) g.fillRect(x - 0.5, y + 5, 1, cell - 10);
      if (row > 0) g.fillRect(x + 5, y - 0.5, cell - 10, 1);
    }
  }
}

/** 덮인 칸: 도톰한 풀 방석. 원점은 칸의 한가운데다. */
export function drawPad(g: Graphics, cell: number): void {
  const size = cell - 2;
  const half = size / 2;
  const radius = cell * 0.26;
  g.clear();
  g.fillStyle(LOOK.pad.lip, 1);
  g.fillRoundedRect(-half, -half + PAD_LIP, size, size - PAD_LIP, radius);
  g.fillStyle(LOOK.pad.face, 1);
  g.fillRoundedRect(-half, -half, size, size - PAD_LIP, radius);
  g.fillStyle(LOOK.pad.shine, 0.8);
  g.fillEllipse(-size * 0.16, -size * 0.27, size * 0.36, size * 0.13);
}

/** 함정을 밟은 칸의 바닥. 원점은 칸의 한가운데다. */
export function drawTrippedFloor(g: Graphics, cell: number): void {
  const size = cell - 3;
  g.clear();
  g.fillStyle(LOOK.board.tripped, 1);
  g.fillRoundedRect(-size / 2, -size / 2, size, size, cell * 0.24);
}

// ───────── 깃발과 고슴도치 ─────────

/** 깃발: 작은 받침에 세운 세모 깃발. 원점은 칸의 한가운데이고, ART_CELL 크기의 칸에 맞춰 그린다. */
export function drawFlag(g: Graphics): void {
  g.clear();
  g.fillStyle(LOOK.flag.pole, 1);
  g.fillEllipse(-2.2, 7, 9, 3.2);
  g.fillRoundedRect(-3.4, -9, 2.4, 16.5, 1.2);
  g.fillStyle(LOOK.flag.fold, 1);
  g.fillTriangle(-1, -7.4, 8.6, -3.6, -1, 0.6);
  g.fillStyle(LOOK.flag.cloth, 1);
  g.fillTriangle(-1, -9, 8.6, -4.8, -1, -0.8);
  g.fillStyle(LOOK.flag.dot, 1);
  g.fillCircle(1.7, -4.9, 1.2);
}

function drawHogEyes(g: Graphics, mood: HogMood): void {
  for (const x of [-2.7, 2.7]) {
    if (mood === 'asleep') {
      // 감은 눈: 아래로 둥근 짧은 금
      g.lineStyle(1.2, LOOK.hog.eye, 1);
      g.beginPath();
      g.arc(x, 1.9, 1.5, 0, Math.PI);
      g.strokePath();
    } else {
      g.fillStyle(LOOK.hog.eye, 1);
      g.fillCircle(x, 2.5, 1.3);
      g.fillStyle(LOOK.hog.glint, 1);
      g.fillCircle(x + 0.45, 2.05, 0.45);
    }
  }
}

/**
 * 함정: 가시를 세운 동글동글한 고슴도치. 원점은 칸의 한가운데이고, ART_CELL 크기의 칸에 맞춰 그린다.
 * 등 둘레에 삐죽한 가시가 있어서 색이 아니어도 숫자나 깃발과 헷갈리지 않는다.
 */
export function drawHog(g: Graphics, mood: HogMood): void {
  g.clear();
  g.fillStyle(LOOK.hog.spikes, 1);
  const spikes = 9;
  for (let i = 0; i < spikes; i += 1) {
    // 왼쪽 아래에서 머리 위를 지나 오른쪽 아래까지 고르게 세운다.
    const angle = Math.PI * (0.92 + (1.16 * i) / (spikes - 1));
    const spread = 0.27;
    g.fillTriangle(
      Math.cos(angle) * 11.4,
      Math.sin(angle) * 10.6 + 1,
      Math.cos(angle - spread) * 7.6,
      Math.sin(angle - spread) * 7 + 1,
      Math.cos(angle + spread) * 7.6,
      Math.sin(angle + spread) * 7 + 1,
    );
  }
  g.fillEllipse(0, 1, 18.4, 16.4);

  g.fillStyle(LOOK.hog.ear, 1);
  g.fillCircle(-5.6, -1.6, 1.9);
  g.fillCircle(5.6, -1.6, 1.9);
  g.fillStyle(LOOK.hog.face, 1);
  g.fillEllipse(0, 3.7, 13.4, 10.4);
  g.fillStyle(LOOK.hog.cheek, 0.85);
  g.fillEllipse(-4.4, 5.1, 2.8, 1.8);
  g.fillEllipse(4.4, 5.1, 2.8, 1.8);
  g.fillStyle(LOOK.hog.nose, 1);
  g.fillEllipse(0, 5, 2.4, 1.8);
  drawHogEyes(g, mood);
}

// ───────── 목숨 ─────────

const HEART_GAP = 14;
/** 목숨 판의 크기. 옆에 다른 것을 놓을 때 쓴다. */
export const HEARTS_SIZE = { width: 3 * HEART_GAP + 10, height: 20 } as const;

function drawHeart(g: Graphics, x: number, y: number, color: number): void {
  g.fillStyle(color, 1);
  g.fillCircle(x - 2.7, y - 1.7, 3.1);
  g.fillCircle(x + 2.7, y - 1.7, 3.1);
  g.fillTriangle(x - 5.5, y - 0.2, x + 5.5, y - 0.2, x, y + 5.6);
}

/** 목숨을 흰 알약 모양 판 위에 하트로 그린다. (x, y)가 판의 왼쪽 위다. */
export function drawHearts(g: Graphics, x: number, y: number, full: number, total: number): void {
  const { width, height } = HEARTS_SIZE;
  g.clear();
  g.fillStyle(LOOK.hearts.plateLip, 1);
  g.fillRoundedRect(x, y + 2, width, height, height / 2);
  g.fillStyle(LOOK.hearts.plate, 1);
  g.fillRoundedRect(x, y, width, height, height / 2);
  for (let i = 0; i < total; i += 1) {
    const color = i < full ? LOOK.hearts.full : LOOK.hearts.empty;
    drawHeart(g, x + 12 + i * HEART_GAP, y + height / 2 - 0.6, color);
  }
}

// ───────── 열기·깃발 단추 ─────────

/** 단추 아래에 보이는 두께 */
const TOGGLE_LIP = 3;
/** 흰 판 가장자리에서 색 있는 알약까지의 틈 */
const TOGGLE_INSET = 3;

/** 단추 반쪽의 가운데 좌표. 글자와 아이콘을 놓을 때 쓴다. */
export function toggleCenter(
  x: number,
  y: number,
  segment: number,
  height: number,
  mode: Mode,
): { x: number; y: number } {
  return { x: x + (mode === 'open' ? 0.5 : 1.5) * segment, y: y + (height - TOGGLE_LIP) / 2 };
}

/** "열기" 아이콘: 손가락으로 톡 누른 자리의 물결 */
function drawTapIcon(g: Graphics, x: number, y: number, color: number): void {
  g.lineStyle(1.6, color, 1);
  g.strokeCircle(x, y, 5);
  g.fillStyle(color, 1);
  g.fillCircle(x, y, 2.1);
}

/** "깃발" 아이콘: 판에 꽂는 깃발을 줄여 그린 것. 고르지 않았을 때는 한 가지 옅은 색으로 그린다. */
function drawFlagIcon(g: Graphics, x: number, y: number, active: boolean): void {
  g.fillStyle(active ? LOOK.toggle.iconOn : LOOK.toggle.iconOff, 1);
  g.fillRoundedRect(x - 3.6, y - 6, 1.8, 12, 0.9);
  g.fillStyle(active ? LOOK.toggle.clothOn : LOOK.toggle.iconOff, 1);
  g.fillTriangle(x - 1.8, y - 6, x + 5.4, y - 2.8, x - 1.8, y + 0.4);
}

/**
 * 열기·깃발 단추를 그린다. 흰 판 위에서 지금 고른 쪽만 색 있는 알약으로 도드라진다.
 * (x, y)가 왼쪽 위이고, 반쪽의 폭이 segment다. pressed는 손가락이 눌려 있는 쪽이다.
 * iconOffset은 반쪽의 가운데에서 아이콘까지의 거리(왼쪽이 음수)다.
 */
export function drawToggle(
  g: Graphics,
  x: number,
  y: number,
  segment: number,
  height: number,
  mode: Mode,
  pressed: Mode | null,
  iconOffset: number,
): void {
  const face = height - TOGGLE_LIP;
  g.clear();
  g.fillStyle(LOOK.toggle.plateLip, 1);
  g.fillRoundedRect(x, y + TOGGLE_LIP, segment * 2, face, face / 2);
  g.fillStyle(LOOK.toggle.plate, 1);
  g.fillRoundedRect(x, y, segment * 2, face, face / 2);

  for (const side of MODES) {
    const left = x + (side === 'open' ? 0 : segment) + TOGGLE_INSET;
    const width = segment - TOGGLE_INSET * 2;
    const pillHeight = face - TOGGLE_INSET * 2;
    const radius = pillHeight / 2;
    if (side === mode) {
      g.fillStyle(LOOK.toggle[side].lip, 1);
      g.fillRoundedRect(left, y + TOGGLE_INSET, width, pillHeight, radius);
      g.fillStyle(LOOK.toggle[side].face, 1);
      g.fillRoundedRect(left, y + TOGGLE_INSET, width, pillHeight - 2, radius - 1);
    } else if (side === pressed) {
      g.fillStyle(LOOK.toggle.pressed, 1);
      g.fillRoundedRect(left, y + TOGGLE_INSET, width, pillHeight, radius);
    }

    const center = toggleCenter(x, y, segment, height, side);
    const active = side === mode;
    // 색 있는 알약은 아래 두께만큼 윗면이 올라가 있으므로 아이콘도 같이 올린다.
    const iconY = center.y - (active ? 1 : 0);
    if (side === 'open') {
      drawTapIcon(g, center.x + iconOffset, iconY, active ? LOOK.toggle.iconOn : LOOK.toggle.iconOff);
    } else {
      drawFlagIcon(g, center.x + iconOffset, iconY, active);
    }
  }
}
