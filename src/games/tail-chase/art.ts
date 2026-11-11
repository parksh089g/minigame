/**
 * 꼬리 잡기의 그림. 색은 LOOK 한곳에 모아 두고, 모든 것을 둥근 도형으로 그린다.
 * 겉모습을 바꿀 때는 이 파일만 고치면 된다. 씬은 여기 함수들이 그린 것을 놓고 움직이기만 한다.
 */
import type Phaser from 'phaser';
import { THEME, THEME_CSS } from '../../config';
import { drawPanel } from '../../core/ui';
import type { Direction } from './rules';

type Graphics = Phaser.GameObjects.Graphics;

export interface Point {
  x: number;
  y: number;
}

export const LOOK = {
  /** 밭: 흰 테두리(벽) 안에 살짝 꺼진 흙. tile은 칸을 알아보게 하는 옅은 바둑판 무늬다. */
  bed: {
    rim: THEME.card,
    rimLip: THEME.shadow,
    soil: THEME.butterSoft,
    shade: THEME.butterDeep,
    tile: THEME.butter,
  },
  bug: { face: THEME.mint, lip: THEME.mintDeep, shine: THEME.mintSoft, cheek: THEME.pink },
  eye: THEME.inkDeep,
  glint: THEME.white,
  /** 먹이: 잎이 달린 작은 열매 */
  fruit: {
    face: THEME.coral,
    lip: THEME.coralDeep,
    shine: THEME.white,
    leaf: THEME.mintDeep,
    stem: THEME.accent,
  },
  /** 별사탕과 그것을 받친 접시, 둘레에서 줄어드는 남은 시간 고리 */
  candy: {
    face: THEME.lilac,
    lip: THEME.lilacDeep,
    shine: THEME.white,
    plate: THEME.card,
    ring: THEME.lilacDeep,
    track: THEME.lilacSoft,
  },
  /** 시작할 때 갈 수 있는 쪽을 알려 주는 화살표 */
  arrow: THEME.pinkDeep,
  sparks: {
    fruit: [THEME.coral, THEME.pink, THEME.butter],
    candy: [THEME.lilac, THEME.gold, THEME.white],
  },
  text: {
    hint: THEME_CSS.ink,
    hintSub: THEME_CSS.sub,
    outline: THEME_CSS.white,
    shadow: THEME_CSS.shadow,
    points: THEME_CSS.accent,
    treat: THEME_CSS.lilacDeep,
    ready: THEME_CSS.accent,
    over: THEME_CSS.bad,
    win: THEME_CSS.good,
  },
} as const;

/** 한 칸의 크기(px) */
export const CELL = 18;
/** 밭을 두르는 흰 테두리의 폭 */
export const BED_RIM = 6;
/** 테두리 아래로 비어져 나오는 두께 */
export const BED_LIP = 3;

/** 흙의 모서리 반지름과, 위쪽 벽이 흙에 드리우는 그늘의 두께 */
const BED_CORNER = 6;
const BED_SHADE = 2;

/** 화면에서 direction 쪽으로 1만큼 갈 때의 좌표 변화 */
export const UNIT: Readonly<Record<Direction, Point>> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

// ───────── 밭 ─────────

/** 밭을 그린다. (0, 0)이 흙의 왼쪽 위이고, 테두리는 그 바깥으로 BED_RIM만큼 나간다. */
export function drawBed(g: Graphics, cols: number, rows: number): void {
  const width = cols * CELL;
  const height = rows * CELL;
  drawPanel(g, -BED_RIM, -BED_RIM, width + BED_RIM * 2, height + BED_RIM * 2, {
    fill: LOOK.bed.rim,
    shadow: LOOK.bed.rimLip,
    radius: BED_RIM + BED_CORNER,
    depth: BED_LIP,
  });
  // 위쪽 벽이 드리운 그늘을 먼저 깔고 흙을 조금 아래에 겹쳐서 밭이 꺼져 보이게 한다.
  g.fillStyle(LOOK.bed.shade, 1);
  g.fillRoundedRect(0, 0, width, height, BED_CORNER);
  g.fillStyle(LOOK.bed.soil, 1);
  g.fillRoundedRect(0, BED_SHADE, width, height - BED_SHADE, BED_CORNER);

  // 칸을 알아보게 하는 바둑판 무늬. 밭의 둥근 모서리에 걸리는 칸만 그 모서리를 둥글린다.
  g.fillStyle(LOOK.bed.tile, 0.4);
  for (let row = 0; row < rows; row += 1) {
    // 맨 윗줄은 그늘을 가리지 않게 그 아래에서 시작한다.
    const top = row === 0 ? BED_SHADE : 0;
    for (let col = (row + 1) % 2; col < cols; col += 2) {
      const round = (onCol: number, onRow: number): number =>
        col === onCol && row === onRow ? BED_CORNER : 0;
      const radius = {
        tl: round(0, 0),
        tr: round(cols - 1, 0),
        bl: round(0, rows - 1),
        br: round(cols - 1, rows - 1),
      };
      const rounded = radius.tl + radius.tr + radius.bl + radius.br > 0;
      if (rounded) g.fillRoundedRect(col * CELL, row * CELL + top, CELL, CELL - top, radius);
      else g.fillRect(col * CELL, row * CELL + top, CELL, CELL - top);
    }
  }
}

// ───────── 애벌레 ─────────

export type BugMood = 'calm' | 'happy' | 'dizzy';

export interface BugPose {
  /** 마디의 가운데. 머리부터 꼬리 끝까지 차례로. */
  points: readonly Point[];
  /** 얼굴이 보는 쪽(라디안). 오른쪽이 0이고 아래쪽이 +다. */
  facing: number;
  mood: BugMood;
  /** 머리의 배율. 먹을 때 잠깐 커진다. */
  headScale: number;
}

const HEAD_RADIUS = 8;
/** 몸통 마디의 반지름. 칸보다 작아서 나란히 지나가는 몸 사이로 흙이 보인다. */
const BODY_RADIUS = 7;
/** 꼬리 끝에서부터 차례로 가늘어지는 마디의 반지름 */
const TAIL_RADII = [5.5, 6.5] as const;
/** 마디 사이를 잇는 이음매는 마디보다 이만큼 가늘다. 이어진 마디와 그냥 옆에 있는 마디가 구별된다. */
const JOINT_INSET = 1.5;
/** 마디 아래에 보이는 두께 */
const BUG_LIP = 2;
/** 마디의 왼쪽 위에 찍는 반짝임: 가운데에서 떨어진 정도와 크기(마디 반지름에 대한 비율) */
const SHINE = { x: -0.32, y: -0.38, radius: 0.24 } as const;
/**
 * 동그라미를 몇 각으로 나눠 그릴지 정하는 값(1을 이 값으로 나눈 만큼의 각).
 * 작은 마디는 이 정도면 충분히 둥글고, 몸이 길어져도 그리는 값이 싸다.
 */
const DISC_STEP = 0.04;

type Disc = Phaser.GameObjects.Arc;

/** 몸통 마디 하나를 이루는 동그라미들 */
interface SegmentView {
  lip: Disc;
  /** 앞 마디와의 사이를 잇는 이음매 */
  joint: Disc;
  face: Disc;
  shine: Disc;
}

function drawEye(g: Graphics, x: number, y: number, mood: BugMood): void {
  if (mood === 'dizzy') {
    g.lineStyle(1.3, LOOK.eye, 1);
    g.lineBetween(x - 1.5, y - 1.5, x + 1.5, y + 1.5);
    g.lineBetween(x + 1.5, y - 1.5, x - 1.5, y + 1.5);
  } else if (mood === 'happy') {
    // 웃느라 감긴 눈. 보는 쪽으로 볼록하다.
    g.lineStyle(1.4, LOOK.eye, 1);
    g.beginPath();
    g.arc(x - 1, y, 1.9, -Math.PI / 2, Math.PI / 2);
    g.strokePath();
  } else {
    g.fillStyle(LOOK.eye, 1);
    g.fillCircle(x, y, 1.7);
    g.fillStyle(LOOK.glint, 1);
    g.fillCircle(x + 0.7, y, 0.6);
  }
}

/**
 * 머리를 오른쪽을 보는 모습으로 그린다: 앞으로 내민 더듬이, 가는 쪽을 보는 눈, 두 볼.
 * (0, 0)이 머리의 한가운데다. 보는 쪽은 그림을 돌려서 맞춘다.
 */
function drawHead(g: Graphics, mood: BugMood): void {
  g.clear();
  g.fillStyle(LOOK.bug.lip, 1);
  for (const side of [-1, 1]) g.fillCircle(HEAD_RADIUS + 0.5, 3.6 * side, 1.6);
  g.fillStyle(LOOK.bug.face, 1);
  g.fillCircle(0, 0, HEAD_RADIUS);
  g.fillStyle(LOOK.bug.cheek, 0.85);
  for (const side of [-1, 1]) g.fillCircle(-1.2, 5.4 * side, 1.5);
  for (const side of [-1, 1]) drawEye(g, 2.6, 3.3 * side, mood);
}

/**
 * 애벌레 그림. 마디마다 동그라미를 만들어 두고 프레임마다 자리만 옮긴다(몸이 길어져도 다시 그리지 않는다).
 * 아래 두께, 몸통(이음매와 마디), 반짝임, 머리를 층으로 나눠 겹쳐서,
 * 몸이 제 몸 옆을 지나가도 어디가 이어졌는지 보인다.
 */
export class BugView {
  private readonly lips: Phaser.GameObjects.Container;
  private readonly body: Phaser.GameObjects.Container;
  private readonly shines: Phaser.GameObjects.Container;
  private readonly headLip: Disc;
  private readonly head: Graphics;
  private readonly segments: SegmentView[] = [];
  /** 머리에 그려져 있는 표정. 바뀔 때만 머리를 다시 그린다. */
  private mood: BugMood | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    depth: number,
  ) {
    this.lips = scene.add.container(0, 0);
    this.body = scene.add.container(0, 0);
    this.shines = scene.add.container(0, 0);
    this.headLip = this.addDisc(this.lips, HEAD_RADIUS, LOOK.bug.lip);
    this.head = scene.add.graphics();
    scene.add.container(0, 0, [this.lips, this.body, this.shines, this.head]).setDepth(depth);
  }

  private addDisc(layer: Phaser.GameObjects.Container, radius: number, color: number): Disc {
    const disc = this.scene.add.circle(0, 0, radius, color).setIterations(DISC_STEP);
    layer.add(disc);
    return disc;
  }

  private addSegment(): SegmentView {
    return {
      lip: this.addDisc(this.lips, BODY_RADIUS, LOOK.bug.lip),
      joint: this.addDisc(this.body, BODY_RADIUS - JOINT_INSET, LOOK.bug.face),
      face: this.addDisc(this.body, BODY_RADIUS, LOOK.bug.face),
      shine: this.addDisc(this.shines, BODY_RADIUS * SHINE.radius, LOOK.bug.shine),
    };
  }

  /** 애벌레를 pose대로 놓는다. 몸이 길어졌으면 마디를 더 만든다. */
  show(pose: BugPose): void {
    const { points } = pose;
    const count = points.length;
    while (this.segments.length < count - 1) this.segments.push(this.addSegment());

    for (let index = 1; index < count; index += 1) {
      const { lip, joint, face, shine } = this.segments[index - 1];
      const at = points[index];
      const ahead = points[index - 1];
      // 꼬리 끝으로 갈수록 가늘다.
      const radius = TAIL_RADII[count - 1 - index] ?? BODY_RADIUS;
      const size = radius / BODY_RADIUS;
      lip.setPosition(at.x, at.y + BUG_LIP).setScale(size);
      joint.setPosition((at.x + ahead.x) / 2, (at.y + ahead.y) / 2).setScale(size);
      face.setPosition(at.x, at.y).setScale(size);
      shine.setPosition(at.x + radius * SHINE.x, at.y + radius * SHINE.y).setScale(size);
    }

    const head = points[0];
    this.headLip.setPosition(head.x, head.y + BUG_LIP).setScale(pose.headScale);
    this.head.setPosition(head.x, head.y).setRotation(pose.facing).setScale(pose.headScale);
    if (pose.mood !== this.mood) {
      this.mood = pose.mood;
      drawHead(this.head, pose.mood);
    }
  }
}

// ───────── 먹이와 별사탕 ─────────

/** 먹이: 꼭지와 잎이 달린 동그란 열매. (0, 0)이 칸의 한가운데다. */
export function drawFruit(g: Graphics): void {
  g.clear();
  g.fillStyle(LOOK.fruit.stem, 1);
  g.fillRoundedRect(-0.8, -7.4, 1.6, 4.4, 0.8);
  g.fillStyle(LOOK.fruit.leaf, 1);
  g.fillEllipse(3, -5.6, 5.6, 3.2);
  g.fillStyle(LOOK.fruit.lip, 1);
  g.fillCircle(0, 2.4, 5.6);
  g.fillStyle(LOOK.fruit.face, 1);
  g.fillCircle(0, 1, 5.6);
  g.fillStyle(LOOK.fruit.shine, 1);
  g.fillCircle(-2.1, -0.9, 1.4);
}

/** 별의 크기: 끝과 골짜기까지의 거리, 끝을 둥글리는 작은 원의 반지름 */
const STAR = { tips: 5, outer: 7, inner: 3.7, round: 1.5 } as const;
/** 별사탕 둘레에 그리는 남은 시간 고리의 반지름과 굵기 */
const RING = { radius: 8.2, width: 1.6 } as const;

/**
 * 끝을 둥글린 별의 꼭짓점들. (0, 0)이 한가운데다.
 * 뾰족한 끝 하나 대신, 끝 안쪽에 놓은 작은 원을 따라 세 점을 찍어서 뭉툭하게 만든다.
 */
function starOutline(): Point[] {
  const outline: Point[] = [];
  for (let tip = 0; tip < STAR.tips; tip += 1) {
    const angle = -Math.PI / 2 + (tip * 2 * Math.PI) / STAR.tips;
    const reach = STAR.outer - STAR.round;
    for (const lean of [-1, 0, 1]) {
      outline.push({
        x: Math.cos(angle) * reach + Math.cos(angle + lean) * STAR.round,
        y: Math.sin(angle) * reach + Math.sin(angle + lean) * STAR.round,
      });
    }
    const valley = angle + Math.PI / STAR.tips;
    outline.push({ x: Math.cos(valley) * STAR.inner, y: Math.sin(valley) * STAR.inner });
  }
  return outline;
}

function fillOutline(g: Graphics, outline: readonly Point[], dy: number, color: number): void {
  g.fillStyle(color, 1);
  g.beginPath();
  outline.forEach((point, index) => {
    if (index === 0) g.moveTo(point.x, point.y + dy);
    else g.lineTo(point.x, point.y + dy);
  });
  g.closePath();
  g.fillPath();
}

/** 별사탕: 끝이 둥근 별. 열매와는 색도 모양도 다르다. (0, 0)이 칸의 한가운데다. */
export function drawCandy(g: Graphics): void {
  const outline = starOutline();
  g.clear();
  fillOutline(g, outline, 1.5, LOOK.candy.lip);
  fillOutline(g, outline, 0, LOOK.candy.face);
  g.fillStyle(LOOK.candy.shine, 1);
  g.fillCircle(-1.6, -1.8, 1.2);
}

/**
 * 별사탕을 받친 동그란 접시와, 사라지기까지 남은 비율(0~1)을 보여 주는 고리를 그린다.
 * 고리는 위에서 시작해 시계 방향으로 줄어든다.
 */
export function drawCandyRing(g: Graphics, ratio: number): void {
  g.clear();
  g.fillStyle(LOOK.candy.plate, 0.8);
  g.fillCircle(0, 0, RING.radius);
  g.lineStyle(RING.width, LOOK.candy.track, 1);
  g.strokeCircle(0, 0, RING.radius);
  if (ratio <= 0) return;
  const start = -Math.PI / 2;
  g.lineStyle(RING.width, LOOK.candy.ring, 1);
  g.beginPath();
  g.arc(0, 0, RING.radius, start, start + Math.PI * 2 * Math.min(1, ratio));
  g.strokePath();
}

// ───────── 시작 안내 ─────────

/** 머리 둘레에 갈 수 있는 쪽을 가리키는 작은 화살표들. (0, 0)이 머리의 한가운데다. */
export function drawArrows(g: Graphics, directions: readonly Direction[]): void {
  const reach = CELL * 0.95;
  const size = 5;
  g.clear();
  g.fillStyle(LOOK.arrow, 1);
  for (const direction of directions) {
    const forward = UNIT[direction];
    const side = { x: -forward.y, y: forward.x };
    const tipX = forward.x * (reach + size);
    const tipY = forward.y * (reach + size);
    const baseX = forward.x * reach;
    const baseY = forward.y * reach;
    g.fillTriangle(
      tipX,
      tipY,
      baseX + side.x * size,
      baseY + side.y * size,
      baseX - side.x * size,
      baseY - side.y * size,
    );
  }
}
