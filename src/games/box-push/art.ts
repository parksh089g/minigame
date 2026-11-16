/**
 * 상자 밀기의 그림. 색은 LOOK 한곳에 모아 두고, 모든 것을 둥근 도형으로 그린다.
 * 겉모습을 바꿀 때는 이 파일만 고치면 된다. 씬은 여기 함수들이 그린 것을 놓고 움직이기만 한다.
 * 상자의 상태는 색과 함께 위에 그린 모양으로도 알 수 있다: 아직 놓지 않은 상자에는 끈, 별 자리에 놓인 상자에는 별,
 * 더 갈 곳이 없는 상자에는 가위표가 그려진다.
 */
import type Phaser from 'phaser';
import { THEME, THEME_CSS } from '../../config';
import { drawPanel } from '../../core/ui';
import type { Puzzle } from './rules';

type Graphics = Phaser.GameObjects.Graphics;

export const LOOK = {
  room: {
    /** 벽과 판의 테두리, 그 아래 두께 */
    wall: THEME.lilac,
    wallLip: THEME.lilacDeep,
    /** 안쪽 벽 덩어리의 윗면 */
    wallTop: 0xddd4fc,
    floor: THEME.card,
    /** 별 자리의 바닥과 거기 그리는 별 */
    spot: THEME.butterSoft,
    spotStar: THEME.butterDeep,
  },
  /** 상자: 윗면, 아래 두께, 위에 그리는 모양의 색 */
  box: {
    loose: { face: 0xffc98f, lip: 0xe59f5c, mark: 0xfff0dc },
    placed: { face: THEME.mint, lip: THEME.mintDeep, mark: THEME.white },
    stuck: { face: 0xd9cdd3, lip: 0xb5a3ab, mark: THEME.sub },
  },
  /** 캐릭터 발밑의 그림자 */
  shade: THEME.inkDeep,
  sparks: {
    place: [THEME.gold, THEME.mintDeep, THEME.white],
    clear: [THEME.gold, THEME.pink, THEME.mintDeep, THEME.skyDeep],
  },
  text: {
    hint: THEME_CSS.ink,
    hintSub: THEME_CSS.sub,
    outline: THEME_CSS.white,
    notice: THEME_CSS.bad,
    status: THEME_CSS.sub,
    statusDone: THEME_CSS.good,
    /** 판 위에 뜨는 "+점수 +시간" 글자 뒤의 바탕 */
    plate: THEME.card,
    points: THEME_CSS.accent,
    good: THEME_CSS.good,
    ready: THEME_CSS.accent,
    over: THEME_CSS.accent,
  },
} as const;

export type BoxLook = keyof typeof LOOK.box;

/** 판의 테두리 폭. 맨 바깥의 벽 둘레는 칸으로 그리지 않고 이 테두리로 그린다. */
export const RIM = 7;
/** 칸의 바닥을 칸 경계에서 안쪽으로 들이는 폭 */
const CELL_INSET = 1;
/** 상자 아래에 보이는 두께 */
const BOX_LIP = 3;

interface Point {
  x: number;
  y: number;
}

function starPoints(outer: number, inner: number): Point[] {
  return Array.from({ length: 10 }, (_, index) => {
    const radius = index % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (index * Math.PI) / 5;
    return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
  });
}

/** 가운데가 (cx, cy)이고 바깥 반지름이 radius인 별을 지금 색으로 칠한다. */
function fillStar(g: Graphics, cx: number, cy: number, radius: number): void {
  const points = starPoints(radius, radius * 0.5);
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    g.fillTriangle(cx, cy, cx + point.x, cy + point.y, cx + next.x, cy + next.y);
  });
}

// ───────── 방 ─────────

/**
 * 방을 그린다: 벽 색의 판 위에 바닥 칸을 하나씩 깔고, 별 자리에는 별을 그린다.
 * 원점은 안쪽 왼쪽 위 칸(판의 (1, 1) 칸)의 왼쪽 위 모서리다.
 */
export function drawRoom(g: Graphics, puzzle: Puzzle, cell: number): void {
  const innerCols = puzzle.cols - 2;
  const innerRows = puzzle.rows - 2;
  const round = cell * 0.2;
  g.clear();
  drawPanel(g, -RIM, -RIM, innerCols * cell + RIM * 2, innerRows * cell + RIM * 2, {
    fill: LOOK.room.wall,
    shadow: LOOK.room.wallLip,
    radius: RIM + 7,
    depth: 4,
  });
  for (let row = 1; row <= innerRows; row += 1) {
    for (let col = 1; col <= innerCols; col += 1) {
      const at = row * puzzle.cols + col;
      const x = (col - 1) * cell;
      const y = (row - 1) * cell;
      if (puzzle.walls[at]) {
        // 안쪽 벽은 도톰한 덩어리로 그려서 바닥보다 솟아 보이게 한다.
        g.fillStyle(LOOK.room.wallLip, 0.55);
        g.fillRoundedRect(x + 2, y + 4, cell - 4, cell - 5, round);
        g.fillStyle(LOOK.room.wallTop, 1);
        g.fillRoundedRect(x + 2, y + 1, cell - 4, cell - 5, round);
        continue;
      }
      const spot = puzzle.targets.includes(at);
      g.fillStyle(spot ? LOOK.room.spot : LOOK.room.floor, 1);
      g.fillRoundedRect(x + CELL_INSET, y + CELL_INSET, cell - CELL_INSET * 2, cell - CELL_INSET * 2, round);
      if (!spot) continue;
      g.fillStyle(LOOK.room.spotStar, 1);
      fillStar(g, x + cell / 2, y + cell / 2 + 0.5, cell * 0.27);
    }
  }
}

// ───────── 상자 ─────────

/** 상자 한 변의 길이 */
export function boxSide(cell: number): number {
  return Math.round(cell * 0.8);
}

/** 상자를 그린다. 원점은 상자가 놓인 칸의 한가운데다. */
export function drawBox(g: Graphics, look: BoxLook, cell: number): void {
  const colors = LOOK.box[look];
  const side = boxSide(cell);
  const half = side / 2;
  const round = side * 0.22;
  // 윗면을 조금 올려 그려서 아래에 두께가 보이게 한다.
  const top = -half - BOX_LIP / 2;
  g.clear();
  g.fillStyle(colors.lip, 1);
  g.fillRoundedRect(-half, top + BOX_LIP, side, side, round);
  g.fillStyle(colors.face, 1);
  g.fillRoundedRect(-half, top, side, side, round);

  const cy = top + half;
  g.fillStyle(colors.mark, 1);
  if (look === 'placed') {
    fillStar(g, 0, cy + 0.5, side * 0.3);
  } else if (look === 'stuck') {
    // 가위표
    const reach = side * 0.22;
    g.lineStyle(Math.max(2, side * 0.14), colors.mark, 1);
    g.lineBetween(-reach, cy - reach, reach, cy + reach);
    g.lineBetween(-reach, cy + reach, reach, cy - reach);
  } else {
    // 상자를 묶은 끈: 가로와 세로로 한 줄씩
    const band = Math.max(2, Math.round(side * 0.14));
    g.fillRect(-half, cy - band / 2, side, band);
    g.fillRect(-band / 2, top, band, side);
  }
}

// ───────── 캐릭터 ─────────

/** 캐릭터 발밑의 그림자. 원점은 캐릭터가 선 칸의 한가운데다. */
export function drawShade(g: Graphics, cell: number): void {
  g.clear();
  g.fillStyle(LOOK.shade, 0.14);
  g.fillEllipse(0, cell * 0.32, cell * 0.56, cell * 0.18);
}
