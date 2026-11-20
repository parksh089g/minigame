/**
 * 피라미드를 혼자 두는 자동 플레이. 테스트에서 판이 끝까지 돌아가는지와 점수가 어느 만큼 나오는지 잰다.
 * 고를 수 있는 짝이 있으면 바로 치우고(피라미드의 카드를 많이 치우는 것부터), 없으면 더미를 넘긴다.
 */
import {
  availableMoves,
  clearPoints,
  clearSpots,
  deal,
  drawCard,
  finishBonus,
  isCleared,
  isStuck,
  pyramidLeft,
  type Board,
  type Move,
} from './rules';

export interface BotResult {
  score: number;
  cleared: boolean;
  /** 남은 피라미드 카드 */
  left: number;
  board: Board;
}

const pyramidCount = (move: Move): number => move.filter((spot) => spot.kind === 'pyramid').length;

/** 씨앗 하나의 판을 끝까지 둔다. 한 수에 secondsPerMove초가 걸린다고 치고 빨리 깬 점수를 셈한다. */
export function playOut(seed: number, secondsPerMove = 2): BotResult {
  const board = deal(seed);
  let score = 0;
  let chain = 0;
  let moves = 0;
  // 수가 끝없이 이어지지 않게 넉넉한 한도를 둔다(카드 52장을 세 번 넘겨도 200수가 안 된다).
  for (let guard = 0; guard < 1000 && !isCleared(board) && !isStuck(board); guard += 1) {
    moves += 1;
    const options = availableMoves(board).sort((a, b) => pyramidCount(b) - pyramidCount(a));
    const best = options[0];
    if (best) {
      const fromPyramid = pyramidCount(best);
      clearSpots(board, best);
      chain += 1;
      score += clearPoints(fromPyramid, best.length - fromPyramid, chain);
      continue;
    }
    chain = 0;
    if (drawCard(board) === 'none') break;
  }
  score += finishBonus(board, moves * secondsPerMove);
  return { score, cleared: isCleared(board), left: pyramidLeft(board), board };
}
