/**
 * 공유할 점수 카드를 그린다. 게임 화면과 따로 720 × 900 캔버스에 2D로 그려서 PNG 파일로 만든다.
 * 게임 화면은 기기마다 크기와 배율이 달라서, 그대로 찍으면 받는 사람에게 보이는 모양이 제각각이 된다.
 * 아이콘과 캐릭터를 어떻게 그릴지는 부르는 쪽이 paint로 넘긴다(이 파일은 텍스처를 모른다).
 */
import { APP_NAME, FONT_FAMILY, THEME_CSS } from '../config';

/** 카드의 크기(px). 세로로 긴 4:5라서 채팅 창에서 크게 보인다. */
export const SHARE_CARD = { width: 720, height: 900 } as const;

type Ctx = CanvasRenderingContext2D;

export interface ShareCardInput {
  /** 게임 이름 */
  title: string;
  score: number;
  /** 지금까지의 최고 기록 */
  best: number;
  isNewBest: boolean;
  /** 카드 아래에 적는 주소(https:// 없이) */
  host: string;
  /** 게임 아이콘의 텍스처 이름 */
  icon: string;
  /** 카드 위에 올라앉는 캐릭터의 텍스처 이름 */
  mascot: string;
  /** 최고 기록 자리에 대신 적을 한 줄. 판이 없는 게임(새싹 컴퍼니)이 회사의 모습을 적는다. */
  note?: string;
  /** 받는 사람에게 건네는 말. 안 주면 "나도 도전하기" */
  invite?: string;
  /** 이름이 가리키는 그림을 (x, y)에 width × height로 그린다. */
  paint: (context: Ctx, key: string, x: number, y: number, width: number, height: number) => void;
}

/** 자리와 크기. 숫자는 모두 카드의 px이다. */
const LOOK = {
  /** 바탕에 흩어 놓는 연한 동그라미: [x, y, 반지름, 색] */
  dots: [
    [84, 150, 74, THEME_CSS.pinkSoft],
    [648, 96, 58, THEME_CSS.mintSoft],
    [690, 420, 86, THEME_CSS.butterSoft],
    [22, 520, 70, THEME_CSS.lilacSoft],
    [120, 838, 88, THEME_CSS.skySoft],
    [610, 800, 64, THEME_CSS.pinkSoft],
  ] as const,
  header: { y: 74, size: 48 },
  panel: { x: 60, y: 250, width: 600, height: 470, radius: 56, lip: 12 },
  /** 캐릭터의 크기와, 카드 위쪽 끝에 걸치는 높이 */
  mascot: { width: 170, height: 181, overlap: 56 },
  /** 아이콘과 게임 이름이 놓이는 줄: 카드 위쪽 끝에서 가운데까지의 거리 */
  title: { offset: 122, size: 54, tile: 100, icon: 76, gap: 20, maxWidth: 540 },
  score: { offset: 250, size: 168, unit: 60, gap: 10, maxWidth: 520 },
  badge: { offset: 386, size: 40, height: 68, pad: 44, star: 46, starGap: 14 },
  button: { y: 764, width: 420, height: 76, lip: 8, size: 40 },
  host: { y: 872, size: 26, maxWidth: 640 },
} as const;

function font(size: number): string {
  return `${size}px ${FONT_FAMILY}, sans-serif`;
}

function pill(c: Ctx, x: number, y: number, width: number, height: number, radius: number, color: string): void {
  c.fillStyle = color;
  c.beginPath();
  c.roundRect(x, y, width, height, radius);
  c.fill();
}

/** text가 maxWidth에 들어가는 가장 큰 글자 크기(size 이하)를 고른다. */
function fitSize(c: Ctx, text: string, size: number, maxWidth: number): number {
  let fitted = size;
  c.font = font(fitted);
  while (fitted > 12 && c.measureText(text).width > maxWidth) {
    fitted -= 2;
    c.font = font(fitted);
  }
  return fitted;
}

function centered(c: Ctx, text: string, x: number, y: number, size: number, color: string): void {
  c.font = font(size);
  c.fillStyle = color;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(text, x, y);
}

/** 점수 카드를 캔버스에 그려서 돌려준다. */
export function drawShareCard(input: ShareCardInput): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = SHARE_CARD.width;
  canvas.height = SHARE_CARD.height;
  const c = canvas.getContext('2d');
  if (!c) throw new Error('2D 캔버스를 만들 수 없습니다.');
  const middle = SHARE_CARD.width / 2;

  // 바탕
  c.fillStyle = THEME_CSS.bg;
  c.fillRect(0, 0, SHARE_CARD.width, SHARE_CARD.height);
  for (const [x, y, radius, color] of LOOK.dots) {
    c.fillStyle = color;
    c.beginPath();
    c.arc(x, y, radius, 0, Math.PI * 2);
    c.fill();
  }

  centered(c, APP_NAME, middle, LOOK.header.y, LOOK.header.size, THEME_CSS.inkDeep);

  // 흰 카드와 그 위에 올라앉은 캐릭터
  const panel = LOOK.panel;
  pill(c, panel.x, panel.y + panel.lip, panel.width, panel.height, panel.radius, THEME_CSS.shadow);
  pill(c, panel.x, panel.y, panel.width, panel.height, panel.radius, THEME_CSS.card);
  const mascot = LOOK.mascot;
  input.paint(
    c,
    input.mascot,
    middle - mascot.width / 2,
    panel.y + mascot.overlap - mascot.height,
    mascot.width,
    mascot.height,
  );

  // 아이콘과 게임 이름을 한 줄로, 가운데에 맞춘다.
  const title = LOOK.title;
  const titleY = panel.y + title.offset;
  const titleSize = fitSize(c, input.title, title.size, title.maxWidth - title.tile - title.gap);
  const titleWidth = c.measureText(input.title).width;
  const rowLeft = middle - (title.tile + title.gap + titleWidth) / 2;
  pill(c, rowLeft, titleY - title.tile / 2, title.tile, title.tile, 28, THEME_CSS.bg);
  const inset = (title.tile - title.icon) / 2;
  input.paint(c, input.icon, rowLeft + inset, titleY - title.icon / 2, title.icon, title.icon);
  c.font = font(titleSize);
  c.fillStyle = THEME_CSS.ink;
  c.textAlign = 'left';
  c.textBaseline = 'middle';
  c.fillText(input.title, rowLeft + title.tile + title.gap, titleY + 2);

  // 점수: 숫자는 크게, "점"은 작게 같은 밑줄에 놓는다.
  const score = LOOK.score;
  const scoreText = String(input.score);
  c.font = font(score.unit);
  const unitWidth = c.measureText('점').width;
  const scoreSize = fitSize(c, scoreText, score.size, score.maxWidth - unitWidth - score.gap);
  const scoreWidth = c.measureText(scoreText).width;
  const scoreLeft = middle - (scoreWidth + score.gap + unitWidth) / 2;
  const baseline = panel.y + score.offset + scoreSize * 0.34;
  c.textAlign = 'left';
  c.textBaseline = 'alphabetic';
  c.fillStyle = THEME_CSS.inkDeep;
  c.fillText(scoreText, scoreLeft, baseline);
  c.font = font(score.unit);
  c.fillStyle = THEME_CSS.sub;
  c.fillText('점', scoreLeft + scoreWidth + score.gap, baseline - 6);

  // 신기록이면 노란 띠와 별, 아니면 최고 기록
  const badge = LOOK.badge;
  const badgeY = panel.y + badge.offset;
  if (input.isNewBest) {
    c.font = font(badge.size);
    const width = c.measureText('신기록!').width + badge.pad * 2;
    pill(c, middle - width / 2, badgeY - badge.height / 2, width, badge.height, badge.height / 2, THEME_CSS.butter);
    centered(c, '신기록!', middle, badgeY + 2, badge.size, THEME_CSS.inkDeep);
    const starY = badgeY - badge.star / 2;
    input.paint(c, 'icon-star', middle - width / 2 - badge.starGap - badge.star, starY, badge.star, badge.star);
    input.paint(c, 'icon-star', middle + width / 2 + badge.starGap, starY, badge.star, badge.star);
  } else {
    const line = input.note ?? `최고 기록 ${input.best}`;
    centered(c, line, middle, badgeY, fitSize(c, line, badge.size, LOOK.score.maxWidth), THEME_CSS.sub);
  }

  // 받는 사람에게 건네는 말과 주소
  const button = LOOK.button;
  const buttonLeft = middle - button.width / 2;
  pill(c, buttonLeft, button.y + button.lip, button.width, button.height, button.height / 2, THEME_CSS.pinkDeep);
  pill(c, buttonLeft, button.y, button.width, button.height, button.height / 2, THEME_CSS.pink);
  centered(c, input.invite ?? '나도 도전하기', middle, button.y + button.height / 2 + 2, button.size, THEME_CSS.inkDeep);
  const host = LOOK.host;
  centered(c, input.host, middle, host.y, fitSize(c, input.host, host.size, host.maxWidth), THEME_CSS.sub);

  return canvas;
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}

/** 점수 카드를 PNG 파일로 만든다. 만들지 못하면 null이고, 그때는 그림 없이 공유하면 된다. */
export async function makeShareImage(input: ShareCardInput, fileName: string): Promise<File | null> {
  try {
    const blob = await toBlob(drawShareCard(input));
    return blob ? new File([blob], fileName, { type: 'image/png' }) : null;
  } catch {
    return null;
  }
}
