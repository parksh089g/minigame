/**
 * 카드와 적의 행동을 사람이 읽는 말로 적는다. 카드의 값이 바뀌어도 설명이 저절로 맞게 한다.
 * 싸우는 동안에는 지금의 힘과 단단함, 고른 적의 허점을 셈한 값으로 적을 수 있다(CardTextContext).
 */
import { CARDS, CARD_TYPE_NAME, ENEMIES, STATUSES, type Act, type CardId, type EnemyId, type StatusId } from './data';

/** 피해와 방어를 지금 싸움의 값으로 바꾸는 것. 없으면 카드에 적힌 그대로다. */
export interface CardTextContext {
  hit: (n: number) => number;
  block: (n: number) => number;
}

/** 차례마다 일하는 상태는 이름보다 하는 일을 적는다. */
const LASTING: readonly StatusId[] = ['guard', 'growth', 'busy', 'toxin', 'pump'];

function times(n: number, count: number | undefined): string {
  return count && count > 1 ? `${n}씩 ${count}번` : String(n);
}

/** 카드 하나가 하는 일 한 줄 */
function cardActLine(act: Act, ctx: CardTextContext | null): string {
  const hit = (n: number): number => (ctx ? ctx.hit(n) : n);
  switch (act.k) {
    case 'hit':
      return `피해 ${times(hit(act.n), act.times)}`;
    case 'hitAll':
      return `모든 적에게 피해 ${times(hit(act.n), act.times)}`;
    case 'hitBlock':
      return '내 방어만큼 피해';
    case 'block':
      return `방어 ${ctx ? ctx.block(act.n) : act.n}`;
    case 'shieldAll':
      return `모든 적이 방어 ${act.n}`;
    case 'draw':
      return `카드 ${act.n}장 뽑기`;
    case 'mana':
      return `마력 +${act.n}`;
    case 'heal':
      return `체력 ${act.n} 회복`;
    case 'lose':
      return `체력 ${act.n} 잃기`;
    case 'give':
      return `${STATUSES[act.s].name} ${act.n} 주기`;
    case 'giveAll':
      return `모든 적에게 ${STATUSES[act.s].name} ${act.n}`;
    case 'gain':
      return LASTING.includes(act.s) ? STATUSES[act.s].blurb(act.n) : `${STATUSES[act.s].name} +${act.n}`;
    case 'doublePoison':
      return '적의 독을 두 배로';
  }
}

/** 카드의 설명. 줄마다 하나씩 하는 일을 적고, 사라지는 카드면 끝에 "사라짐"을 붙인다. */
export function cardLines(id: CardId, up: boolean, ctx: CardTextContext | null = null): string[] {
  const def = CARDS[id];
  const lines = def.acts[up ? 1 : 0].map((act) => cardActLine(act, ctx));
  if (def.vanish?.[up ? 1 : 0]) lines.push('사라짐');
  return lines;
}

/** 카드 설명을 한 덩어리로. 줄 사이는 쉼표다. */
export function cardText(id: CardId, up: boolean, ctx: CardTextContext | null = null): string {
  return cardLines(id, up, ctx).join(', ');
}

/** 카드 이름. 강화한 카드는 끝에 +가 붙는다. */
export function cardName(id: CardId, up: boolean): string {
  return up ? `${CARDS[id].name}+` : CARDS[id].name;
}

/** 카드의 갈래 이름(공격, 기술, 마법) */
export function cardTypeName(id: CardId): string {
  return CARD_TYPE_NAME[CARDS[id].type];
}

/** 적의 행동 하나를 적는다. 적을 누르면 보이는 설명에 쓴다. */
function foeActLine(act: Act, hit: (n: number) => number): string {
  switch (act.k) {
    case 'hit':
      return `피해 ${times(hit(act.n), act.times)}`;
    case 'block':
      return `방어 ${act.n}`;
    case 'shieldAll':
      return `모든 적이 방어 ${act.n}`;
    case 'heal':
      return `체력 ${act.n} 회복`;
    case 'give':
      return `${STATUSES[act.s].name} ${act.n} 주기`;
    case 'gain':
      return `${STATUSES[act.s].name} +${act.n}`;
    default:
      return '';
  }
}

/** 적이 다음에 할 행동의 이름과 설명. hit은 피해를 지금의 값으로 바꾼다. */
export function moveText(id: EnemyId, move: number, hit: (n: number) => number = (n) => n): string {
  const def = ENEMIES[id].moves[move];
  const lines = def.acts.map((act) => foeActLine(act, hit)).filter((line) => line.length > 0);
  return `${def.name}: ${lines.join(', ')}`;
}

/** 갈림길(탑) 화면의 글 */
export const MAP_TEXT = {
  hint: '문을 눌러 다음 층을 골라요',
  climb: '올라가기!',
  entrance: '입구',
  deck: (count: number) => `덱 ${count}장`,
} as const;
