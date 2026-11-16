/**
 * 핀 뽑기의 그림. 색은 LOOK 한곳에 모아 두고, 모든 것을 둥근 도형으로 그린다.
 * 겉모습을 바꿀 때는 이 파일만 고치면 된다. 씬은 여기 함수들이 그린 것을 놓고 움직이기만 한다.
 */
import type Phaser from 'phaser';
import { THEME, THEME_CSS } from '../../config';

type Graphics = Phaser.GameObjects.Graphics;

export const LOOK = {
  /** 동굴이 파인 바위 */
  rock: { face: THEME.lilac, lip: THEME.lilacDeep, speck: THEME.lilacSoft },
  /** 방과 구덩이의 안쪽. shade는 천장 쪽에 지는 그늘이다. */
  cave: { face: THEME.lilacSoft, shade: THEME.lilacDeep },
  pin: { face: THEME.mint, lip: THEME.mintDeep, shine: THEME.mintSoft },
  /** 자물쇠가 달린 핀: 잿빛 막대와 손잡이 위의 금빛 자물쇠 */
  lockedPin: { face: THEME.faint, lip: THEME.sub, shine: THEME.dim },
  padlock: { face: THEME.gold, lip: THEME.accent, hole: THEME.inkDeep },
  /** 사슬로 묶인 핀: 분홍 막대와 손잡이 위의 맞물린 고리 */
  chainedPin: { face: THEME.pink, lip: THEME.pinkDeep, shine: THEME.pinkSoft },
  chainLink: THEME.inkDeep,
  lava: { face: THEME.coral, deep: THEME.coralDeep, glow: THEME.butter },
  water: { face: THEME.sky, deep: THEME.skyDeep, light: THEME.skySoft },
  treasure: { face: THEME.gold, lip: THEME.butterDeep, shine: THEME.butterSoft },
  key: { face: THEME.gold, lip: THEME.accent, shine: THEME.butterSoft },
  /** 자물쇠가 풀릴 때의 반짝임 */
  unlock: THEME.gold,
  stone: { face: THEME.faint, lip: THEME.sub, light: THEME.dim },
  hero: { body: THEME.pink, deep: THEME.pinkDeep, light: THEME.pinkSoft, crown: THEME.gold },
  monster: { body: THEME.coralDeep, horn: THEME.coral, eye: THEME.white },
  /** 용사와 괴물의 눈 */
  eye: THEME.inkDeep,
  hearts: { plate: THEME.card, full: THEME.pinkDeep, empty: THEME.shadow },
  /** 용암이 식을 때 피어오르는 김 */
  steam: THEME.white,
  /** 보물이 탈 때의 번쩍임과 그 뒤에 오르는 연기 */
  burn: { flash: THEME.gold, smoke: THEME.sub },
  /** 눈의 반짝임, 손잡이를 알려 주는 물결 */
  glint: THEME.white,
  sparks: {
    win: [THEME.gold, THEME.butter, THEME.pink],
    burn: [THEME.coral, THEME.coralDeep, THEME.butter],
    water: [THEME.sky, THEME.skySoft, THEME.white],
  },
  text: {
    hint: THEME_CSS.ink,
    hintSub: THEME_CSS.sub,
    outline: THEME_CSS.white,
    points: THEME_CSS.accent,
    good: THEME_CSS.good,
    bad: THEME_CSS.bad,
    over: THEME_CSS.accent,
  },
} as const;

/** 방 안쪽의 폭. 물과 용암은 이 폭을 꽉 채운다. */
export const CHAMBER_WIDTH = 28;
/** 물이나 용암 한 덩이가 방에서 차지하는 높이 */
export const LIQUID_UNIT = 15;
/** 핀 막대의 굵기 */
export const PIN_THICKNESS = 6;
/** 핀 손잡이의 반지름 */
export const HANDLE_RADIUS = 6.5;
/** 용사와 괴물의 키. 말풍선이나 점수를 머리 위에 띄울 때 쓴다. */
export const FIGURE_HEIGHT = 22;

// ───────── 바위와 동굴 ─────────

export interface Hollow {
  x: number;
  y: number;
  width: number;
  height: number;
  /** 위쪽 모서리의 반지름. 아래쪽은 다른 칸과 이어지도록 조금만 둥글린다. */
  radius: number;
}

/** 바위 덩어리. 아래에 짙은 두께를 두고, 밋밋하지 않게 옅은 점을 드문드문 찍는다. */
export function drawRock(g: Graphics, x: number, y: number, width: number, height: number): void {
  g.fillStyle(LOOK.rock.lip, 1);
  g.fillRoundedRect(x, y + 3, width, height, 16);
  g.fillStyle(LOOK.rock.face, 1);
  g.fillRoundedRect(x, y, width, height, 16);

  g.fillStyle(LOOK.rock.speck, 0.5);
  // 자리는 정해 둔 비율로 고른다. 화면 높이가 달라도 같은 무늬가 늘어난다.
  const specks: ReadonlyArray<readonly [number, number, number]> = [
    [0.1, 0.16, 3],
    [0.86, 0.1, 2.2],
    [0.72, 0.2, 3.4],
    [0.3, 0.24, 2],
    [0.93, 0.5, 2.6],
    [0.05, 0.62, 2.2],
    [0.5, 0.95, 3],
    [0.2, 0.92, 2],
    [0.82, 0.9, 2.4],
  ];
  for (const [rx, ry, radius] of specks) {
    g.fillCircle(x + width * rx, y + height * ry, radius);
  }
}

/** 바위에 파인 자리들. 그늘을 먼저 깔고 조금 아래에 밝은 안쪽을 겹쳐서 천장 쪽이 어두워 보인다. */
export function drawHollows(g: Graphics, hollows: readonly Hollow[]): void {
  const shadeDepth = 2.5;
  g.fillStyle(LOOK.cave.shade, 1);
  for (const h of hollows) {
    g.fillRoundedRect(h.x, h.y, h.width, h.height, { tl: h.radius, tr: h.radius, bl: 4, br: 4 });
  }
  g.fillStyle(LOOK.cave.face, 1);
  for (const h of hollows) {
    g.fillRoundedRect(h.x, h.y + shadeDepth, h.width, h.height - shadeDepth, {
      tl: h.radius,
      tr: h.radius,
      bl: 4,
      br: 4,
    });
  }
}

// ───────── 핀 ─────────

/** 핀의 겉모습: 보통 핀, 자물쇠가 달린 핀, 사슬로 묶인 핀 */
export type PinLook = 'plain' | 'locked' | 'chained';

const PIN_COLORS = { plain: LOOK.pin, locked: LOOK.lockedPin, chained: LOOK.chainedPin } as const;

/** 손잡이. 자물쇠가 달린 핀은 자물쇠를, 사슬로 묶인 핀은 맞물린 고리 둘을 얹어서 색이 아니어도 구별된다. */
function drawHandle(g: Graphics, x: number, y: number, look: PinLook): void {
  const colors = PIN_COLORS[look];
  g.fillStyle(colors.lip, 1);
  g.fillCircle(x, y + 1.5, HANDLE_RADIUS);
  g.fillStyle(colors.face, 1);
  g.fillCircle(x, y, HANDLE_RADIUS);

  if (look === 'locked') {
    // 고리가 위로 솟은 자물쇠
    g.lineStyle(1.6, LOOK.padlock.hole, 1);
    g.beginPath();
    g.arc(x, y - 1.6, 2.5, Math.PI, Math.PI * 2);
    g.strokePath();
    g.fillStyle(LOOK.padlock.lip, 1);
    g.fillRoundedRect(x - 4.2, y - 1.4, 8.4, 6.6, 1.6);
    g.fillStyle(LOOK.padlock.face, 1);
    g.fillRoundedRect(x - 4.2, y - 1.8, 8.4, 6, 1.6);
    g.fillStyle(LOOK.padlock.hole, 1);
    g.fillCircle(x, y + 0.8, 1.1);
  } else if (look === 'chained') {
    g.lineStyle(1.5, LOOK.chainLink, 1);
    g.strokeCircle(x - 1.9, y, 2.5);
    g.strokeCircle(x + 1.9, y, 2.5);
  } else {
    g.fillStyle(colors.shine, 1);
    g.fillCircle(x, y, HANDLE_RADIUS * 0.42);
  }
}

/** 가로 핀. (0, 0)이 막대의 왼쪽 끝 가운데이고, 오른쪽 끝에 둥근 손잡이가 달린다. 그리기 전에 지우므로 다시 그려도 된다. */
export function drawPin(g: Graphics, length: number, look: PinLook = 'plain'): void {
  const half = PIN_THICKNESS / 2;
  const colors = PIN_COLORS[look];
  g.clear();
  g.fillStyle(colors.lip, 1);
  g.fillRoundedRect(0, -half, length, PIN_THICKNESS, half);
  g.fillStyle(colors.face, 1);
  g.fillRoundedRect(0, -half, length, PIN_THICKNESS - 2, half - 1);
  drawHandle(g, length, 0, look);
}

/** 세로로 선 문 핀. (0, 0)이 막대의 아래쪽 끝 가운데이고, 위쪽 끝에 손잡이가 달린다. 그리기 전에 지우므로 다시 그려도 된다. */
export function drawDoorPin(g: Graphics, length: number, look: PinLook = 'plain'): void {
  const half = PIN_THICKNESS / 2;
  const colors = PIN_COLORS[look];
  g.clear();
  g.fillStyle(colors.lip, 1);
  g.fillRoundedRect(-half, -length, PIN_THICKNESS, length, half);
  g.fillStyle(colors.face, 1);
  g.fillRoundedRect(-half, -length, PIN_THICKNESS - 2, length, half - 1);
  drawHandle(g, 0, -length, look);
}

// ───────── 방과 구덩이에 드는 것 ─────────

/**
 * 용암. (x, y)가 바닥의 왼쪽 끝이고 위로 height만큼 찬다.
 * 윗면이 봉긋봉긋하고 둥근 방울이 떠 있어서 색이 아니어도 물과 구별된다.
 */
export function drawLava(g: Graphics, x: number, y: number, width: number, height: number): void {
  const bump = 3.5;
  const top = y - height;
  const bumps = Math.max(2, Math.round(width / 11));
  const span = width / bumps;

  g.fillStyle(LOOK.lava.face, 1);
  for (let i = 0; i < bumps; i += 1) {
    g.fillEllipse(x + span * (i + 0.5), top + bump, span * 1.04, bump * 2);
  }
  g.fillRoundedRect(x, top + bump, width, height - bump, Math.min(4, (height - bump) / 2));

  // 폭이 넓으면 같은 무늬를 옆으로 되풀이한다: 바닥의 짙은 결, 안쪽의 밝은 방울, 윗면 위로 튄 방울
  const groups = Math.max(1, Math.round(width / 30));
  const group = width / groups;
  for (let i = 0; i < groups; i += 1) {
    const left = x + group * i;
    g.fillStyle(LOOK.lava.deep, 1);
    g.fillRoundedRect(left + group * 0.14, y - 4.5, group * 0.5, 2.4, 1.2);
    g.fillStyle(LOOK.lava.glow, 1);
    g.fillCircle(left + group * 0.3, top + height * 0.5, 2.2);
    g.fillCircle(left + group * 0.72, top + height * 0.66, 1.5);
    g.fillStyle(LOOK.lava.face, 1);
    g.fillCircle(left + group * 0.68, top - 2.5, 1.8);
  }
}

/** 물. (x, y)가 바닥의 왼쪽 끝이고 위로 height만큼 찬다. 윗면이 반듯하고 가로로 잔물결이 있다. */
export function drawWater(g: Graphics, x: number, y: number, width: number, height: number): void {
  const top = y - height;
  g.fillStyle(LOOK.water.face, 1);
  g.fillRoundedRect(x, top, width, height, Math.min(4, height / 2));
  g.fillStyle(LOOK.water.light, 1);
  g.fillRoundedRect(x + 2, top + 1.5, width - 4, 2, 1);

  const groups = Math.max(1, Math.round(width / 30));
  const group = width / groups;
  for (let i = 0; i < groups; i += 1) {
    const left = x + group * i;
    g.fillStyle(LOOK.water.light, 1);
    g.fillRoundedRect(left + group * 0.14, top + height * 0.48, group * 0.26, 1.6, 0.8);
    g.fillRoundedRect(left + group * 0.56, top + height * 0.68, group * 0.3, 1.6, 0.8);
    g.fillStyle(LOOK.water.deep, 1);
    g.fillRoundedRect(left + group * 0.3, y - 4, group * 0.5, 2.2, 1.1);
  }
}

function drawCoin(g: Graphics, x: number, y: number): void {
  const radius = 5.2;
  g.fillStyle(LOOK.treasure.lip, 1);
  g.fillCircle(x, y + 1.3, radius);
  g.fillStyle(LOOK.treasure.face, 1);
  g.fillCircle(x, y, radius);
  g.fillStyle(LOOK.treasure.shine, 1);
  g.fillCircle(x - 1.6, y - 1.7, 1.5);
}

/** 보물의 키. 위에 다른 것을 얹을 때 쓴다. */
export const TREASURE_HEIGHT = 19;
/** 보물: 금화 세 닢. (x, y)가 바닥의 가운데다. */
export function drawTreasure(g: Graphics, x: number, y: number): void {
  drawCoin(g, x, y - 13);
  drawCoin(g, x - 5.2, y - 6.5);
  drawCoin(g, x + 5.2, y - 6.5);
}

/** 열쇠의 키. 위에 다른 것을 얹을 때 쓴다. */
export const KEY_HEIGHT = 18;
/** 열쇠: 둥근 고리가 위에 있고 아래로 이가 난 금빛 열쇠가 서 있다. (x, y)가 바닥의 가운데다. */
export function drawKey(g: Graphics, x: number, y: number): void {
  // 고리
  g.fillStyle(LOOK.key.lip, 1);
  g.fillCircle(x, y - 12.6, 4.6);
  g.fillStyle(LOOK.key.face, 1);
  g.fillCircle(x, y - 13.4, 4.6);
  g.fillStyle(LOOK.cave.face, 1);
  g.fillCircle(x, y - 13.4, 1.8);
  // 대와 이
  g.fillStyle(LOOK.key.lip, 1);
  g.fillRoundedRect(x - 1.3, y - 9.6, 3.2, 9.6, 1.2);
  g.fillRoundedRect(x + 0.8, y - 3.2, 4, 2.6, 1);
  g.fillRoundedRect(x + 0.8, y - 6.8, 3, 2.4, 1);
  g.fillStyle(LOOK.key.face, 1);
  g.fillRoundedRect(x - 1.6, y - 9.8, 2.6, 9.4, 1.2);
  g.fillStyle(LOOK.key.shine, 1);
  g.fillCircle(x - 1.6, y - 15, 1.1);
}

export const STONE_HEIGHT = 12;
/** 식어서 굳은 돌. (x, y)가 바닥의 가운데다. */
export function drawStone(g: Graphics, x: number, y: number): void {
  g.fillStyle(LOOK.stone.lip, 1);
  g.fillRoundedRect(x - 9, y - 10, 18, 10, 5);
  g.fillStyle(LOOK.stone.face, 1);
  g.fillRoundedRect(x - 9, y - 12, 18, 10, 5);
  g.fillStyle(LOOK.stone.light, 1);
  g.fillEllipse(x - 3.5, y - 9.2, 6, 2.4);
}

// ───────── 용사와 괴물 ─────────

export type HeroMood = 'calm' | 'happy' | 'dizzy';

function drawEyes(g: Graphics, y: number, gap: number, mood: HeroMood): void {
  for (const x of [-gap / 2, gap / 2]) {
    if (mood === 'happy') {
      // 웃느라 감긴 눈
      g.lineStyle(1.3, LOOK.eye, 1);
      g.beginPath();
      g.arc(x, y + 0.8, 1.7, Math.PI, Math.PI * 2);
      g.strokePath();
    } else if (mood === 'dizzy') {
      g.lineStyle(1.2, LOOK.eye, 1);
      g.lineBetween(x - 1.4, y - 1.4, x + 1.4, y + 1.4);
      g.lineBetween(x + 1.4, y - 1.4, x - 1.4, y + 1.4);
    } else {
      g.fillStyle(LOOK.eye, 1);
      g.fillCircle(x, y, 1.4);
      g.fillStyle(LOOK.glint, 1);
      g.fillCircle(x + 0.5, y - 0.5, 0.5);
    }
  }
}

/** 용사: 작은 왕관을 쓴 동글동글한 친구. (0, 0)이 발밑의 가운데다. */
export function drawHero(g: Graphics, mood: HeroMood): void {
  g.clear();
  g.fillStyle(LOOK.hero.deep, 1);
  g.fillEllipse(-4, -1.8, 6.4, 3.8);
  g.fillEllipse(4, -1.8, 6.4, 3.8);
  g.fillStyle(LOOK.hero.body, 1);
  g.fillCircle(0, -9.5, 8.2);
  g.fillStyle(LOOK.hero.light, 1);
  g.fillEllipse(-3.6, -14.2, 5, 2.4);

  g.fillStyle(LOOK.hero.crown, 1);
  g.fillRoundedRect(-4.5, -19.6, 9, 3.4, 1.2);
  for (const x of [-3.6, 0, 3.6]) g.fillCircle(x, -20.2, 1.5);

  g.fillStyle(LOOK.hero.deep, 0.55);
  g.fillEllipse(-5.6, -7.2, 3.2, 2);
  g.fillEllipse(5.6, -7.2, 3.2, 2);
  drawEyes(g, -9.8, 6.2, mood);
}

/** 괴물: 뿔이 나고 눈썹을 찌푸린 덩어리. (0, 0)이 발밑의 가운데다. */
export function drawMonster(g: Graphics): void {
  g.clear();
  g.fillStyle(LOOK.monster.horn, 1);
  g.fillTriangle(-7.5, -13, -6.5, -20.5, -2.5, -15.5);
  g.fillTriangle(7.5, -13, 6.5, -20.5, 2.5, -15.5);
  g.fillStyle(LOOK.monster.body, 1);
  g.fillRoundedRect(-9, -17, 18, 17, { tl: 8, tr: 8, bl: 5, br: 5 });

  g.fillStyle(LOOK.monster.eye, 1);
  g.fillCircle(-3.6, -10, 2.7);
  g.fillCircle(3.6, -10, 2.7);
  g.fillStyle(LOOK.eye, 1);
  g.fillCircle(-3.2, -9.6, 1.3);
  g.fillCircle(3.2, -9.6, 1.3);
  // 안쪽으로 내려간 눈썹
  g.lineStyle(1.4, LOOK.eye, 1);
  g.lineBetween(-6.6, -14.2, -1.4, -12.2);
  g.lineBetween(6.6, -14.2, 1.4, -12.2);
  // 삐죽 나온 이
  g.fillStyle(LOOK.monster.eye, 1);
  g.fillTriangle(-3.4, -5, -0.8, -5, -2.1, -2.4);
  g.fillTriangle(3.4, -5, 0.8, -5, 2.1, -2.4);
}

// ───────── 목숨 ─────────

const HEART_GAP = 13;

function drawHeart(g: Graphics, x: number, y: number, color: number): void {
  g.fillStyle(color, 1);
  g.fillCircle(x - 2.5, y - 1.6, 2.9);
  g.fillCircle(x + 2.5, y - 1.6, 2.9);
  g.fillTriangle(x - 5.1, y - 0.2, x + 5.1, y - 0.2, x, y + 5.2);
}

/** 목숨을 흰 알약 모양 판 위에 하트로 그린다. (x, y)가 판의 왼쪽 위다. */
export function drawHearts(g: Graphics, x: number, y: number, full: number, total: number): void {
  const width = total * HEART_GAP + 9;
  g.clear();
  g.fillStyle(LOOK.rock.lip, 1);
  g.fillRoundedRect(x, y + 1.5, width, 16, 8);
  g.fillStyle(LOOK.hearts.plate, 1);
  g.fillRoundedRect(x, y, width, 16, 8);
  for (let i = 0; i < total; i += 1) {
    const color = i < full ? LOOK.hearts.full : LOOK.hearts.empty;
    drawHeart(g, x + 11 + i * HEART_GAP, y + 7.4, color);
  }
}
