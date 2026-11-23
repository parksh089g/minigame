/**
 * 포커 컴퓨터의 생각. 화면과 떨어진 순수 함수라서 시험에서 그대로 돌리고, 같은 random이면 같은 수를 둔다.
 *
 * 남은 카드를 여러 번 무작위로 깔아 보고(몬테카를로) 내 카드가 이길 몫(승률)을 어림한다.
 * 승률을 상대 수에 맞춰 "보통보다 얼마나 센지"로 바꾼 뒤, 성격(얼마나 자주 들어오는지, 얼마나 세게 거는지, 허세)에 따라
 * 폴드, 체크·콜, 레이즈를 고른다. 콜할 칩에 견줘 팟이 크면(팟 오즈) 약한 패로도 따라간다.
 */
import type { Card } from '../high-low/rules';
import { compareHands, evaluate } from './hands';
import { inHand, newDeck, options, potTotal, type Move, type PokerTable } from './rules';

export interface BotStyle {
  /** 들어오는 문턱을 낮춘다(0이면 보통, 클수록 약한 패로도 따라간다) */
  loose: number;
  /** 센 패에서 레이즈하는 문턱을 낮추고 크게 건다(0~1) */
  aggression: number;
  /** 약한 패로 레이즈하는 확률 */
  bluff: number;
}

/** 자리마다의 성격: 토끼는 조심, 곰돌이는 잘 따라옴, 여우는 공격적 */
export const BOT_STYLES: readonly BotStyle[] = [
  { loose: 0, aggression: 0.3, bluff: 0.03 },
  { loose: 0.15, aggression: 0.2, bluff: 0.02 },
  { loose: 0.05, aggression: 0.7, bluff: 0.1 },
];

/** 승률을 어림할 때 깔아 보는 횟수 */
export const SAMPLES = 220;

/**
 * 내 카드가 이길 몫(0~1). 비기면 나눈 만큼 센다.
 * 다른 사람의 손패는 모르는 것으로 치고, 남은 카드에서 무작위로 나눠 본다.
 */
export function estimateEquity(
  hole: readonly Card[],
  board: readonly Card[],
  opponents: number,
  random: () => number = Math.random,
  samples = SAMPLES,
): number {
  if (opponents <= 0) return 1;
  const known = new Set([...hole, ...board].map((card) => `${card.rank}${card.suit}`));
  const pool = newDeck(() => 0).filter((card) => !known.has(`${card.rank}${card.suit}`));
  const need = 5 - board.length;
  let score = 0;
  for (let s = 0; s < samples; s += 1) {
    // 필요한 만큼만 앞에서 섞어 뽑는다.
    const picks = need + opponents * 2;
    for (let i = 0; i < picks; i += 1) {
      const j = i + Math.floor(random() * (pool.length - i));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const fullBoard = [...board, ...pool.slice(0, need)];
    const mine = evaluate([...hole, ...fullBoard]);
    let best = 1;
    let ties = 1;
    for (let o = 0; o < opponents; o += 1) {
      const start = need + o * 2;
      const theirs = evaluate([pool[start], pool[start + 1], ...fullBoard]);
      const diff = compareHands(mine, theirs);
      if (diff < 0) {
        best = 0;
        break;
      }
      if (diff === 0) ties += 1;
    }
    score += best / ties;
  }
  return score / samples;
}

/** 큰 블라인드 단위로 맞춘다 */
function roundTo(value: number, step: number): number {
  return Math.max(step, Math.round(value / step) * step);
}

/** 그 자리의 컴퓨터가 둘 수. 차례가 아니면 null */
export function chooseMove(table: PokerTable, index: number, style: BotStyle, random: () => number = Math.random): Move | null {
  const can = options(table, index);
  if (!can.check && !can.fold) return null;
  const seat = table.seats[index];
  const opponents = table.seats.filter((other, i) => i !== index && inHand(other)).length;
  const equity = estimateEquity(seat.hole, table.board, opponents, random);
  // 상대 수와 상관없이 "보통의 몫"이 1이 되게 바꾼다.
  const strength = equity * (opponents + 1);
  const pot = potTotal(table);
  const toCall = can.call;
  const odds = toCall > 0 ? toCall / (pot + toCall) : 0;
  const roll = random();

  const raiseFloor = 1.75 - style.aggression * 0.45;
  const wantsRaise = strength >= raiseFloor || (roll < style.bluff && table.street !== 'river');

  if (wantsRaise && (can.raise || can.allIn > 0)) {
    // 팟의 절반에서 한 배 사이로 건다. 아주 세면 더 크게.
    const fraction = 0.5 + style.aggression * 0.3 + (strength >= 2.4 ? 0.4 : 0) + random() * 0.2;
    const target = table.currentBet + roundTo(pot * fraction, table.bigBlind);
    if (can.raise && target <= can.raise.max) {
      // 같은 거리에서 레이즈가 너무 오가지 않게, 이미 크게 걸렸으면 콜로 받는다.
      const already = table.currentBet >= table.bigBlind * 6 && strength < 2.4;
      if (!already) return { type: 'raise', to: Math.max(can.raise.min, target) };
    } else if (strength >= 2.2 || (can.raise === null && strength >= raiseFloor)) {
      return { type: 'allin' };
    }
  }

  if (toCall === 0) return { type: 'check' };

  // 콜: 승률이 팟 오즈보다 넉넉하면 따라간다. 작은 콜은 조금 약해도 따라간다.
  const cheap = toCall <= table.bigBlind && table.street === 'preflop';
  const callFloor = odds + 0.04 - style.loose * 0.25 - (cheap ? 0.08 : 0);
  if (equity >= callFloor) return { type: 'call' };
  // 가진 칩이 콜할 칩보다 적어 올인이 되는 것도 콜로 친다.
  return { type: 'fold' };
}
