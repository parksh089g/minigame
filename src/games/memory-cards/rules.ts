/**
 * 기억 카드의 규칙. 화면과 분리된 순수 함수라서 숫자만 바꿔 밸런스를 조정할 수 있다.
 * 60초 동안 카드 짝을 맞추고, 판을 모두 맞추면 더 큰 판이 나온다.
 */

/** 한 판 길이(초). 카드를 미리 보여 주는 동안과 판이 바뀌는 동안에는 흐르지 않는다. */
export const ROUND_SECONDS = 60;

/** 짝이 맞지 않은 두 장을 보여 주는 시간(ms). 그 전에 다른 카드를 누르면 바로 덮인다. */
export const MISMATCH_SHOW_MS = 650;

export interface BoardSize {
  cols: number;
  rows: number;
}

/** 판 크기. 첫 판은 3×4(6쌍), 둘째 판은 4×4(8쌍), 그 뒤로는 4×5(10쌍). */
export function boardSize(boardIndex: number): BoardSize {
  if (boardIndex <= 0) return { cols: 3, rows: 4 };
  if (boardIndex === 1) return { cols: 4, rows: 4 };
  return { cols: 4, rows: 5 };
}

export function pairCount(size: BoardSize): number {
  return (size.cols * size.rows) / 2;
}

/** 판이 더 커지지 않는 첫 판의 번호(0부터): 이 판부터는 4×5가 이어진다. */
export const LARGEST_BOARD_INDEX = 2;
/** 가장 큰 판이 이어지는 동안 판마다 줄어드는 미리 보기 시간(ms) */
export const PREVIEW_CUT_MS = 250;
/** 미리 보기 시간의 바닥(ms). 이보다 짧으면 카드를 훑어볼 수조차 없다. */
export const MIN_PREVIEW_MS = 800;

/**
 * 판을 시작할 때 카드를 모두 보여 주는 시간(ms). 카드가 많을수록 조금 길다.
 * 판은 셋째 판부터 더 커지지 않으므로, 그 뒤로는 판마다 미리 보는 시간이 줄어서 계속 어려워진다.
 * boardIndex는 0부터 세는 판 번호다.
 */
export function previewMs(pairs: number, boardIndex = 0): number {
  const repeats = Math.max(0, Math.floor(boardIndex) - LARGEST_BOARD_INDEX);
  return Math.max(MIN_PREVIEW_MS, 1000 + 100 * pairs - PREVIEW_CUT_MS * repeats);
}

/** 실수 없이 연속으로 맞히면 한 번에 5점씩 보너스가 붙는다(최대 +20). */
export function streakBonus(streak: number): number {
  return Math.min(20, 5 * Math.max(0, streak));
}

/**
 * 짝 하나를 맞혔을 때의 점수.
 * streak는 이번에 맞히기 직전까지 실수 없이 이어진 횟수.
 */
export function matchPoints(streak: number): number {
  return 10 + streakBonus(streak);
}

/** 판을 모두 맞혔을 때의 보너스. 큰 판일수록 많다. */
export function clearBonus(pairs: number): number {
  return 5 * pairs;
}

/**
 * 카드 더미를 만든다. 그림 symbolCount종 가운데 pairs종을 골라 두 장씩 넣고 섞는다.
 * 돌려주는 배열의 값은 그림 번호(0부터)이고, 순서가 곧 판 위의 자리다.
 * random은 0 이상 1 미만의 수를 돌려주는 함수(Math.random과 같은 모양).
 */
export function buildDeck(pairs: number, symbolCount: number, random: () => number): number[] {
  if (!Number.isInteger(pairs) || pairs < 1) throw new Error('쌍의 수는 1 이상의 정수여야 합니다.');
  if (pairs > symbolCount) throw new Error('그림 종류가 쌍의 수보다 적습니다.');

  const symbols = shuffle(
    Array.from({ length: symbolCount }, (_, index) => index),
    random,
  ).slice(0, pairs);
  return shuffle([...symbols, ...symbols], random);
}

/** 피셔-예이츠 섞기. 받은 배열을 그 자리에서 섞어 돌려준다. */
function shuffle<T>(items: T[], random: () => number): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CardMetrics {
  width: number;
  height: number;
  gap: number;
}

/**
 * 판을 영역 한가운데에 놓았을 때 각 카드의 중심 좌표. 왼쪽 위부터 가로로 센다.
 * 좌표는 정수로 맞춰 픽셀이 흐려지지 않게 한다.
 */
export function cardCenters(size: BoardSize, area: Area, card: CardMetrics): { x: number; y: number }[] {
  const boardWidth = size.cols * card.width + (size.cols - 1) * card.gap;
  const boardHeight = size.rows * card.height + (size.rows - 1) * card.gap;
  const left = Math.round(area.x + (area.width - boardWidth) / 2);
  const top = Math.round(area.y + (area.height - boardHeight) / 2);

  const centers: { x: number; y: number }[] = [];
  for (let row = 0; row < size.rows; row += 1) {
    for (let col = 0; col < size.cols; col += 1) {
      centers.push({
        x: left + col * (card.width + card.gap) + card.width / 2,
        y: top + row * (card.height + card.gap) + card.height / 2,
      });
    }
  }
  return centers;
}
