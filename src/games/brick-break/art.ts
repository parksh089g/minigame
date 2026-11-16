/**
 * 벽돌 깨기의 그림. 색은 LOOK 한곳에 모아 두고, 모든 것을 둥근 도형으로 그린다.
 * 겉모습을 바꿀 때는 이 파일만 고치면 된다. 씬은 여기 함수들이 그린 것을 놓고 움직이기만 한다.
 *
 * 벽돌의 색은 줄마다 돌아가며 바뀌는 꾸밈일 뿐이고 규칙과는 상관없다.
 * 종류는 색이 아니라 모양으로 가른다: 단단한 벽돌은 테를 두르고 못이 박혀 있고, 공이 든 벽돌은 가운데에 공이 보인다.
 */
import type Phaser from 'phaser';
import { THEME, THEME_CSS } from '../../config';
import { bakeShape } from '../../core/bake';
import {
  BALL_RADIUS,
  CELL_HEIGHT,
  CELL_WIDTH,
  FIELD_HEIGHT,
  FIELD_LEFT,
  FIELD_RIGHT,
  LIMIT_Y,
  PADDLE_HALF,
  PADDLE_HEIGHT,
  PADDLE_Y,
  type Brick,
} from './rules';

type Graphics = Phaser.GameObjects.Graphics;

interface Tone {
  face: number;
  light: number;
  dark: number;
}

export const LOOK = {
  /** 판: 흰 바닥과 그것을 두른 벽. pit은 막대 아래, 공이 빠지는 자리다. */
  field: { face: THEME.card, wall: THEME.shadow, pit: THEME.dim },
  /** 바닥 선 */
  limit: THEME.coral,
  limitGlow: THEME.pink,
  /** 벽돌의 색. 줄마다 차례로 돌아간다. */
  tones: [
    { face: THEME.pink, light: THEME.pinkSoft, dark: THEME.pinkDeep },
    { face: THEME.butter, light: THEME.butterSoft, dark: THEME.butterDeep },
    { face: THEME.mint, light: THEME.mintSoft, dark: THEME.mintDeep },
    { face: THEME.sky, light: THEME.skySoft, dark: THEME.skyDeep },
    { face: THEME.lilac, light: THEME.lilacSoft, dark: THEME.lilacDeep },
  ] as readonly Tone[],
  /** 단단한 벽돌에 박힌 못과 금 */
  rivet: THEME.white,
  crack: THEME.inkDeep,
  ball: { face: THEME.coral, dark: THEME.coralDeep, shine: THEME.white },
  paddle: { face: THEME.lilac, dark: THEME.lilacDeep, shine: THEME.lilacSoft },
  /** 공을 놓쳤을 때 튀는 알갱이 */
  puffs: [THEME.coral, THEME.pinkSoft, THEME.white],
  text: {
    hint: THEME_CSS.ink,
    hintSub: THEME_CSS.sub,
    outline: THEME_CSS.white,
    shadow: THEME_CSS.shadow,
    points: THEME_CSS.accent,
    gift: THEME_CSS.good,
    start: THEME_CSS.good,
    ready: THEME_CSS.accent,
    miss: THEME_CSS.bad,
    over: THEME_CSS.bad,
  },
} as const;

/** 줄 번호에 맞는 벽돌 색의 번호 */
export function toneOf(rowId: number): number {
  return rowId % LOOK.tones.length;
}

/** 벽의 두께 */
export const WALL = 3;
/** 벽돌은 칸보다 이만큼씩 안쪽에 그려서 벽돌 사이에 틈이 보인다. */
const BRICK_INSET = 1;
const BRICK = {
  width: CELL_WIDTH - BRICK_INSET * 2,
  height: CELL_HEIGHT - BRICK_INSET * 2,
  lip: 2,
  radius: 4,
} as const;

/**
 * 판의 바닥과 벽을 그린다. graphics의 (0, 0)이 판의 천장 왼쪽 끝(화면 x = 0)이다.
 * 벽은 왼쪽, 오른쪽, 위에만 있고 아래는 뚫려 있다.
 */
export function drawField(graphics: Graphics): void {
  const left = FIELD_LEFT;
  const width = FIELD_RIGHT - FIELD_LEFT;
  graphics.fillStyle(LOOK.field.wall, 1);
  graphics.fillRoundedRect(left - WALL, -WALL, width + WALL * 2, FIELD_HEIGHT + WALL, {
    tl: 8,
    tr: 8,
    bl: 4,
    br: 4,
  });
  graphics.fillStyle(LOOK.field.face, 1);
  graphics.fillRoundedRect(left, 0, width, FIELD_HEIGHT, { tl: 5, tr: 5, bl: 0, br: 0 });
  // 막대 아래는 공이 빠지는 자리다.
  const pitTop = PADDLE_Y + PADDLE_HEIGHT + 8;
  graphics.fillStyle(LOOK.field.pit, 1);
  graphics.fillRect(left, pitTop, width, FIELD_HEIGHT - pitTop);
}

/** 천장의 벽. 위에서 들어오는 줄이 이 뒤에서 나오는 것처럼 보이게 벽돌보다 앞에 그린다. */
export function drawCeiling(graphics: Graphics): void {
  graphics.fillStyle(LOOK.field.wall, 1);
  graphics.fillRoundedRect(FIELD_LEFT - WALL, -WALL, FIELD_RIGHT - FIELD_LEFT + WALL * 2, WALL, {
    tl: 3,
    tr: 3,
    bl: 0,
    br: 0,
  });
}

/** 바닥 선: 벽돌이 닿으면 끝나는 높이에 긋는 점선. graphics의 (0, 0)이 판의 천장 왼쪽 끝이다. */
export function drawLimit(graphics: Graphics): void {
  const dash = { length: 6, gap: 4, height: 2 } as const;
  graphics.fillStyle(LOOK.limit, 1);
  for (let x = FIELD_LEFT + 3; x + dash.length <= FIELD_RIGHT - 2; x += dash.length + dash.gap) {
    graphics.fillRoundedRect(x, LIMIT_Y - dash.height / 2, dash.length, dash.height, 1);
  }
}

/** 바닥 선 둘레에 깔리는 붉은 띠. 벽돌이 선에 가까워지면 씬이 이것을 깜빡인다. */
export function drawLimitGlow(graphics: Graphics): void {
  const height = 10;
  graphics.fillStyle(LOOK.limitGlow, 1);
  graphics.fillRoundedRect(FIELD_LEFT + 1, LIMIT_Y - height / 2, FIELD_RIGHT - FIELD_LEFT - 2, height, height / 2);
}

/** 벽돌의 모습. 금이 간 단단한 벽돌은 따로 친다. */
export type BrickLook = 'plain' | 'sturdy' | 'cracked' | 'gift';

export function lookOf(brick: Brick): BrickLook {
  if (brick.kind === 'sturdy') return brick.hits > 1 ? 'sturdy' : 'cracked';
  return brick.kind;
}

/** 벽돌 하나를 칸의 왼쪽 위가 (0, 0)에 오도록 그린다. */
function drawBrick(graphics: Graphics, look: BrickLook, tone: Tone): void {
  const { width, height, lip, radius } = BRICK;
  const left = BRICK_INSET;
  const top = BRICK_INSET;
  const face = height - lip;
  graphics.fillStyle(tone.dark, 1);
  graphics.fillRoundedRect(left, top, width, height, radius);

  if (look === 'sturdy' || look === 'cracked') {
    // 짙은 테 안에 면을 작게 넣고 양 끝에 못을 박는다.
    graphics.fillStyle(tone.face, 1);
    graphics.fillRoundedRect(left + 2, top + 2, width - 4, face - 3, radius - 2);
    graphics.fillStyle(LOOK.rivet, 1);
    graphics.fillCircle(left + 5.5, top + face / 2 + 0.5, 1.3);
    graphics.fillCircle(left + width - 5.5, top + face / 2 + 0.5, 1.3);
    if (look === 'cracked') {
      const midX = left + width / 2;
      graphics.lineStyle(1.4, LOOK.crack, 0.75);
      graphics.beginPath();
      graphics.moveTo(midX - 3, top + 1);
      graphics.lineTo(midX + 1, top + 4);
      graphics.lineTo(midX - 2, top + 6.5);
      graphics.lineTo(midX + 2.5, top + height - 1.5);
      graphics.strokePath();
    }
    return;
  }

  graphics.fillStyle(tone.face, 1);
  graphics.fillRoundedRect(left, top, width, face, radius);
  graphics.fillStyle(tone.light, 1);
  graphics.fillRoundedRect(left + 4, top + 2, 8, 2, 1);
  if (look === 'gift') {
    // 가운데에 든 공
    const cx = left + width / 2;
    const cy = top + face / 2;
    graphics.fillStyle(LOOK.rivet, 1);
    graphics.fillCircle(cx, cy, 4.2);
    graphics.fillStyle(LOOK.ball.dark, 1);
    graphics.fillCircle(cx, cy + 0.5, 2.8);
    graphics.fillStyle(LOOK.ball.face, 1);
    graphics.fillCircle(cx, cy, 2.6);
  }
}

/** 벽돌 그림. 같은 벽돌이 수십 개 놓이므로 모습과 색마다 한 장씩 구워서 같이 쓴다. 이미지의 원점은 칸의 왼쪽 위다. */
export function brickTexture(scene: Phaser.Scene, look: BrickLook, tone: number): string {
  const box = { width: CELL_WIDTH, height: CELL_HEIGHT, originX: 0, originY: 0 };
  return bakeShape(scene, `brick-break-${look}-${tone}`, box, (graphics) =>
    drawBrick(graphics, look, LOOK.tones[tone]),
  );
}

/** 공 그림. 이미지의 한가운데가 공의 한가운데다. */
export function ballTexture(scene: Phaser.Scene): string {
  const size = BALL_RADIUS * 2 + 2;
  return bakeShape(scene, 'brick-break-ball', { width: size, height: size }, (graphics) => {
    graphics.fillStyle(LOOK.ball.dark, 1);
    graphics.fillCircle(0, 0.6, BALL_RADIUS);
    graphics.fillStyle(LOOK.ball.face, 1);
    graphics.fillCircle(0, -0.2, BALL_RADIUS - 0.4);
    graphics.fillStyle(LOOK.ball.shine, 0.9);
    graphics.fillEllipse(-1.3, -1.6, 2.4, 1.6);
  });
}

/** 막대를 윗면의 가운데가 (0, 0)에 오도록 그린다. */
export function drawPaddle(graphics: Graphics): void {
  const width = PADDLE_HALF * 2;
  const radius = PADDLE_HEIGHT / 2;
  graphics.fillStyle(LOOK.paddle.dark, 1);
  graphics.fillRoundedRect(-PADDLE_HALF, 2, width, PADDLE_HEIGHT, radius);
  graphics.fillStyle(LOOK.paddle.face, 1);
  graphics.fillRoundedRect(-PADDLE_HALF, 0, width, PADDLE_HEIGHT, radius);
  graphics.fillStyle(LOOK.paddle.shine, 1);
  graphics.fillRoundedRect(-PADDLE_HALF + 6, 2, 14, 2, 1);
}
