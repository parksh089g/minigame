/**
 * 구름 탑 모험의 싸움 규칙. 화면 없이 상태만 바꾸고, 일어난 일(BattleEvent)을 돌려주면 화면이 그것을 그린다.
 *
 * 한 차례의 흐름: 내 차례가 오면 방어가 사라지고 마력을 받고 카드를 뽑는다. 카드를 내고 "차례 끝"을 누르면
 * 남은 손패를 버리고, 적이 하나씩 미리 알려 준 행동을 한다. 그다음 다시 내 차례다.
 * 무작위는 모두 run의 난수(Rng)를 써서, 저장한 판을 다시 열어도 똑같이 이어진다.
 */
import {
  CARDS,
  ENEMIES,
  PLAYER,
  STATUSES,
  type Act,
  type CardId,
  type EnemyId,
  type StatusId,
  type TreasureId,
} from './data';

// ───────── 난수 ─────────

/** 저장할 수 있는 난수. s만 들고 있다. */
export interface Rng {
  s: number;
}

/** 0 이상 1 미만 (mulberry32) */
export function rand(rng: Rng): number {
  rng.s = (rng.s + 0x6d2b79f5) | 0;
  let t = rng.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** min 이상 max 이하의 정수 */
export function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rand(rng) * (max - min + 1));
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rand(rng) * items.length)];
}

export function shuffle<T>(rng: Rng, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand(rng) * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

// ───────── 상태 ─────────

/** 덱에 든 카드 한 장. uid는 판 안에서 겹치지 않는 번호다. */
export interface Card {
  uid: number;
  id: CardId;
  up: boolean;
}

export type Statuses = Partial<Record<StatusId, number>>;

export interface Fighter {
  hp: number;
  maxHp: number;
  block: number;
  st: Statuses;
}

export interface Foe extends Fighter {
  id: EnemyId;
  /** 다음 차례에 할 행동(ENEMIES[id].moves의 번호). 화면이 머리 위에 보여 준다. */
  next: number;
  /** 최근에 한 행동들. 같은 행동을 세 번 잇지 않으려고 본다. */
  history: number[];
  dead: boolean;
}

export type BattleKind = 'fight' | 'elite' | 'boss';

export interface Battle {
  kind: BattleKind;
  foes: Foe[];
  me: Fighter;
  draw: Card[];
  hand: Card[];
  discard: Card[];
  /** 이번 싸움에서 사라진 카드(사라짐 카드와 낸 마법 카드) */
  gone: Card[];
  mana: number;
  turn: number;
  /** 이번 싸움에서 낸 공격 카드 수. 네잎클로버가 센다. */
  attacks: number;
  /** 작은 주전자를 이번 싸움에서 썼는지 */
  kettleUsed: boolean;
  result: null | 'win' | 'lose';
}

/** 'me'는 토끼, 숫자는 foes의 번호 */
export type Who = 'me' | number;

export type BattleEvent =
  | { t: 'hurt'; who: Who; n: number; blocked: number }
  | { t: 'poison'; who: Who; n: number }
  | { t: 'block'; who: Who; n: number }
  | { t: 'heal'; who: Who; n: number }
  | { t: 'status'; who: Who; s: StatusId; n: number }
  | { t: 'die'; who: number }
  | { t: 'act'; who: number; move: number }
  | { t: 'draw'; n: number }
  | { t: 'mana'; n: number }
  | { t: 'treasure'; id: TreasureId };

/** 싸움이 판에서 받는 것 */
export interface BattleContext {
  rng: Rng;
  treasures: readonly TreasureId[];
}

const has = (ctx: BattleContext, id: TreasureId): boolean => ctx.treasures.includes(id);

const stat = (fighter: Fighter, id: StatusId): number => fighter.st[id] ?? 0;

function addStatus(fighter: Fighter, id: StatusId, n: number): void {
  const next = stat(fighter, id) + n;
  if (next === 0) delete fighter.st[id];
  else fighter.st[id] = next;
}

const fighterOf = (battle: Battle, who: Who): Fighter => (who === 'me' ? battle.me : battle.foes[who]);

/** 보물 가운데 차례마다 마력을 하나 더 주는 대장 보물의 수 */
export function bonusMana(treasures: readonly TreasureId[]): number {
  return treasures.filter((id) => id === 'bigStar' || id === 'sleepyMoon' || id === 'marble').length;
}

// ───────── 피해 셈 ─────────

/** 공격 한 번의 피해: 힘을 더하고, 움츠림이면 4분의 1을 덜고, 맞는 쪽이 허점이면 절반을 더한다. */
export function attackDamage(base: number, attacker: Fighter, defender: Fighter | null): number {
  let damage = base + stat(attacker, 'strength');
  if (stat(attacker, 'weak') > 0) damage = Math.floor(damage * 0.75);
  if (defender && stat(defender, 'vuln') > 0) damage = Math.floor(damage * 1.5);
  return Math.max(0, damage);
}

/** 카드로 얻는 방어: 단단함을 더한다. */
export function cardBlock(base: number, me: Fighter): number {
  return Math.max(0, base + stat(me, 'tough'));
}

/** 방어를 먼저 깎고 남은 만큼 체력을 깎는다. */
function damage(battle: Battle, who: Who, amount: number, events: BattleEvent[], ctx: BattleContext): void {
  const target = fighterOf(battle, who);
  if (amount <= 0 || target.hp <= 0) return;
  const blocked = Math.min(target.block, amount);
  target.block -= blocked;
  const lost = Math.min(target.hp, amount - blocked);
  target.hp -= lost;
  events.push({ t: 'hurt', who, n: lost, blocked });
  afterHpLoss(battle, who, events, ctx);
}

function loseHp(battle: Battle, who: Who, amount: number, events: BattleEvent[], ctx: BattleContext): void {
  const target = fighterOf(battle, who);
  if (amount <= 0 || target.hp <= 0) return;
  const lost = Math.min(target.hp, amount);
  target.hp -= lost;
  events.push({ t: 'poison', who, n: lost });
  afterHpLoss(battle, who, events, ctx);
}

function afterHpLoss(battle: Battle, who: Who, events: BattleEvent[], ctx: BattleContext): void {
  if (who === 'me') {
    const me = battle.me;
    if (me.hp > 0 && me.hp * 2 < me.maxHp && !battle.kettleUsed && has(ctx, 'kettle')) {
      battle.kettleUsed = true;
      events.push({ t: 'treasure', id: 'kettle' });
      heal(battle, 'me', 12, events);
    }
    if (me.hp <= 0) battle.result = 'lose';
    return;
  }
  const foe = battle.foes[who];
  if (foe.hp <= 0 && !foe.dead) {
    foe.dead = true;
    foe.block = 0;
    foe.st = {};
    events.push({ t: 'die', who });
    if (battle.foes.every((item) => item.dead) && battle.result === null) battle.result = 'win';
  }
}

function heal(battle: Battle, who: Who, amount: number, events: BattleEvent[]): void {
  const target = fighterOf(battle, who);
  if (target.hp <= 0) return;
  const gained = Math.min(amount, target.maxHp - target.hp);
  if (gained <= 0) return;
  target.hp += gained;
  events.push({ t: 'heal', who, n: gained });
}

function gainBlock(battle: Battle, who: Who, amount: number, events: BattleEvent[]): void {
  const target = fighterOf(battle, who);
  if (amount <= 0 || target.hp <= 0) return;
  target.block += amount;
  events.push({ t: 'block', who, n: amount });
}

function giveStatus(battle: Battle, who: Who, id: StatusId, n: number, events: BattleEvent[]): void {
  const target = fighterOf(battle, who);
  if (n === 0 || target.hp <= 0) return;
  addStatus(target, id, n);
  events.push({ t: 'status', who, s: id, n });
}

/** attacker가 who를 한 번 때린다. 맞은 쪽에 가시가 있으면 때린 쪽이 그만큼 받는다. */
function strike(battle: Battle, from: Who, to: Who, base: number, events: BattleEvent[], ctx: BattleContext): void {
  const attacker = fighterOf(battle, from);
  const defender = fighterOf(battle, to);
  if (attacker.hp <= 0 || defender.hp <= 0) return;
  damage(battle, to, attackDamage(base, attacker, defender), events, ctx);
  const thorns = stat(defender, 'thorns');
  if (thorns > 0 && attacker.hp > 0) damage(battle, from, thorns, events, ctx);
}

const livingFoes = (battle: Battle): number[] =>
  battle.foes.flatMap((foe, index) => (foe.dead ? [] : [index]));

// ───────── 카드 뽑기 ─────────

function drawCards(battle: Battle, count: number, events: BattleEvent[], ctx: BattleContext): void {
  let drawn = 0;
  for (let i = 0; i < count; i += 1) {
    if (battle.hand.length >= PLAYER.maxHand) break;
    if (battle.draw.length === 0) {
      if (battle.discard.length === 0) break;
      battle.draw = shuffle(ctx.rng, battle.discard);
      battle.discard = [];
    }
    const card = battle.draw.pop();
    if (!card) break;
    battle.hand.push(card);
    drawn += 1;
  }
  if (drawn > 0) events.push({ t: 'draw', n: drawn });
}

// ───────── 적의 행동 ─────────

/** 다음에 할 행동을 정한다. */
function planMove(foe: Foe, ctx: BattleContext): void {
  const def = ENEMIES[foe.id];
  if (def.pattern === 'cycle') {
    foe.next = foe.history.length % def.moves.length;
    return;
  }
  const [a, b] = foe.history.slice(-2);
  const banned = a !== undefined && a === b ? a : -1;
  const options = def.moves.map((_, index) => index).filter((index) => index !== banned);
  foe.next = pick(ctx.rng, options);
}

/** 머리 위에 보여 줄 행동의 생김새 */
export interface Intent {
  /** 때리는 피해 한 번의 값과 횟수. 때리지 않으면 null */
  attack: { n: number; times: number } | null;
  defend: boolean;
  buff: boolean;
  debuff: boolean;
}

/** 그 적이 다음에 할 행동이 어떤 것인지. 피해는 지금의 힘과 움츠림, 토끼의 허점을 셈한 값이다. */
export function intentOf(battle: Battle, index: number): Intent {
  const foe = battle.foes[index];
  const move = ENEMIES[foe.id].moves[foe.next];
  const intent: Intent = { attack: null, defend: false, buff: false, debuff: false };
  for (const act of move.acts) {
    switch (act.k) {
      case 'hit':
        intent.attack = { n: attackDamage(act.n, foe, battle.me), times: act.times ?? 1 };
        break;
      case 'block':
      case 'shieldAll':
        intent.defend = true;
        break;
      case 'gain':
      case 'heal':
        intent.buff = true;
        break;
      case 'give':
        intent.debuff = true;
        break;
      default:
        break;
    }
  }
  return intent;
}

function foeAct(battle: Battle, index: number, act: Act, events: BattleEvent[], ctx: BattleContext): void {
  const foe = battle.foes[index];
  if (foe.dead || battle.result !== null) return;
  switch (act.k) {
    case 'hit':
      for (let i = 0; i < (act.times ?? 1); i += 1) strike(battle, index, 'me', act.n, events, ctx);
      break;
    case 'block':
      gainBlock(battle, index, act.n, events);
      break;
    case 'shieldAll':
      for (const other of livingFoes(battle)) gainBlock(battle, other, act.n, events);
      break;
    case 'heal':
      heal(battle, index, act.n, events);
      break;
    case 'give':
      giveStatus(battle, 'me', act.s, act.n, events);
      break;
    case 'gain':
      giveStatus(battle, index, act.s, act.n, events);
      break;
    default:
      break;
  }
}

// ───────── 싸움의 시작과 차례 ─────────

/** 싸움을 연다. deck은 그대로 두고 복사해서 섞는다. 첫 차례의 카드까지 뽑아 둔다. */
export function startBattle(
  kind: BattleKind,
  enemies: readonly EnemyId[],
  deck: readonly Card[],
  hp: number,
  maxHp: number,
  ctx: BattleContext,
): { battle: Battle; events: BattleEvent[] } {
  const events: BattleEvent[] = [];
  const foes: Foe[] = enemies.map((id) => {
    const def = ENEMIES[id];
    const max = randInt(ctx.rng, def.hp[0], def.hp[1]);
    return { id, hp: max, maxHp: max, block: 0, st: { ...def.start }, next: 0, history: [], dead: false };
  });
  const battle: Battle = {
    kind,
    foes,
    me: { hp, maxHp, block: 0, st: {} },
    draw: shuffle(ctx.rng, deck.map((card) => ({ ...card }))),
    hand: [],
    discard: [],
    gone: [],
    mana: 0,
    turn: 0,
    attacks: 0,
    kettleUsed: false,
    result: null,
  };
  for (const foe of foes) planMove(foe, ctx);
  if (has(ctx, 'ribbon')) giveStatus(battle, 'me', 'strength', 1, events);
  if (has(ctx, 'glove')) giveStatus(battle, 'me', 'thorns', 3, events);
  if (has(ctx, 'marble')) giveStatus(battle, 'me', 'weak', 2, events);
  if (has(ctx, 'pouch')) for (const index of livingFoes(battle)) giveStatus(battle, index, 'poison', 3, events);
  events.push(...startTurn(battle, ctx));
  return { battle, events };
}

/** 내 차례를 연다: 방어가 사라지고, 차례마다 붙는 상태가 일하고, 마력을 받고, 카드를 뽑는다. */
function startTurn(battle: Battle, ctx: BattleContext): BattleEvent[] {
  const events: BattleEvent[] = [];
  const me = battle.me;
  battle.turn += 1;
  const first = battle.turn === 1;
  me.block = 0;
  const poison = stat(me, 'poison');
  if (poison > 0) {
    loseHp(battle, 'me', poison, events, ctx);
    addStatus(me, 'poison', -1);
    if (battle.result !== null) return events;
  }
  if (stat(me, 'guard') > 0) gainBlock(battle, 'me', stat(me, 'guard'), events);
  if (stat(me, 'growth') > 0) giveStatus(battle, 'me', 'strength', stat(me, 'growth'), events);
  if (stat(me, 'toxin') > 0) {
    for (const index of livingFoes(battle)) giveStatus(battle, index, 'poison', stat(me, 'toxin'), events);
  }
  battle.mana = PLAYER.mana + bonusMana(ctx.treasures) + stat(me, 'pump');
  let count = PLAYER.hand + stat(me, 'busy');
  if (first) {
    if (has(ctx, 'badge')) {
      events.push({ t: 'treasure', id: 'badge' });
      gainBlock(battle, 'me', 10, events);
    }
    if (has(ctx, 'candy')) battle.mana += 1;
    if (has(ctx, 'hourglass')) count += 2;
  }
  drawCards(battle, count, events, ctx);
  return events;
}

// ───────── 카드 내기 ─────────

/** 카드가 적 하나를 골라야 하는지 */
export function needsTarget(id: CardId, up: boolean): boolean {
  return actsNeedTarget(CARDS[id].acts[up ? 1 : 0]);
}

/** 하는 일 가운데 적 하나를 골라야 하는 것이 있는지. 물약도 이것으로 본다. */
export function actsNeedTarget(acts: readonly Act[]): boolean {
  return acts.some((act) => act.k === 'hit' || act.k === 'hitBlock' || act.k === 'give' || act.k === 'doublePoison');
}

/**
 * 카드 없이 하는 일들을 한다(물약). 마력도 손패도 건드리지 않는다.
 * 적을 골라야 하면 target에 살아 있는 적의 번호를 준다. 할 수 없으면 null을 돌려주고 아무것도 바꾸지 않는다.
 */
export function useActs(battle: Battle, acts: readonly Act[], target: number | null, ctx: BattleContext): BattleEvent[] | null {
  if (battle.result !== null) return null;
  if (actsNeedTarget(acts) && (target === null || !battle.foes[target] || battle.foes[target].dead)) return null;
  const events: BattleEvent[] = [];
  for (const act of acts) {
    if (battle.result !== null) break;
    playAct(battle, act, target, events, ctx);
  }
  return events;
}

export function cardCost(card: Card): number {
  return CARDS[card.id].cost[card.up ? 1 : 0];
}

export function canPlay(battle: Battle, card: Card): boolean {
  return battle.result === null && cardCost(card) <= battle.mana;
}

/**
 * 손패의 handIndex번째 카드를 낸다. 적을 골라야 하는 카드는 target에 살아 있는 적의 번호를 준다.
 * 낼 수 없으면(마력이 모자라거나 고른 적이 없으면) null을 돌려주고 아무것도 바꾸지 않는다.
 */
export function playCard(battle: Battle, handIndex: number, target: number | null, ctx: BattleContext): BattleEvent[] | null {
  const card = battle.hand[handIndex];
  if (!card || !canPlay(battle, card)) return null;
  const targeted = needsTarget(card.id, card.up);
  if (targeted) {
    if (target === null || !battle.foes[target] || battle.foes[target].dead) return null;
  }
  const def = CARDS[card.id];
  const events: BattleEvent[] = [];
  battle.mana -= cardCost(card);
  battle.hand.splice(handIndex, 1);
  for (const act of def.acts[card.up ? 1 : 0]) {
    if (battle.result !== null) break;
    playAct(battle, act, target, events, ctx);
  }
  const vanish = def.vanish?.[card.up ? 1 : 0] ?? false;
  if (def.type === 'power' || vanish) battle.gone.push(card);
  else battle.discard.push(card);
  if (def.type === 'attack') {
    battle.attacks += 1;
    if (battle.attacks % 3 === 0 && has(ctx, 'clover') && battle.result === null) {
      events.push({ t: 'treasure', id: 'clover' });
      drawCards(battle, 1, events, ctx);
    }
  }
  return events;
}

function playAct(battle: Battle, act: Act, target: number | null, events: BattleEvent[], ctx: BattleContext): void {
  const me = battle.me;
  switch (act.k) {
    case 'hit':
      for (let i = 0; i < (act.times ?? 1); i += 1) {
        if (target === null || battle.foes[target].dead) break;
        strike(battle, 'me', target, act.n, events, ctx);
      }
      break;
    case 'hitAll':
      for (let i = 0; i < (act.times ?? 1); i += 1) {
        for (const index of livingFoes(battle)) strike(battle, 'me', index, act.n, events, ctx);
      }
      break;
    case 'hitBlock':
      if (target !== null) strike(battle, 'me', target, me.block, events, ctx);
      break;
    case 'block':
      gainBlock(battle, 'me', cardBlock(act.n, me), events);
      break;
    case 'draw':
      drawCards(battle, act.n, events, ctx);
      break;
    case 'mana':
      battle.mana += act.n;
      events.push({ t: 'mana', n: act.n });
      break;
    case 'heal':
      heal(battle, 'me', act.n, events);
      break;
    case 'lose':
      loseHp(battle, 'me', act.n, events, ctx);
      break;
    case 'give':
      if (target !== null) giveStatus(battle, target, act.s, act.n, events);
      break;
    case 'giveAll':
      for (const index of livingFoes(battle)) giveStatus(battle, index, act.s, act.n, events);
      break;
    case 'gain':
      giveStatus(battle, 'me', act.s, act.n, events);
      break;
    case 'doublePoison':
      if (target !== null) giveStatus(battle, target, 'poison', stat(battle.foes[target], 'poison'), events);
      break;
    case 'shieldAll':
      break;
  }
}

// ───────── 차례 끝 ─────────

/** 줄어드는 상태(허점, 움츠림)를 1씩 줄인다. */
function fade(fighter: Fighter): void {
  for (const [id, def] of Object.entries(STATUSES) as [StatusId, (typeof STATUSES)[StatusId]][]) {
    if (def.fades && stat(fighter, id) > 0) addStatus(fighter, id, -1);
  }
}

/** 적 하나가 차례를 보낸 뒤의 모습. 화면이 한 마리씩 차례로 보여 준다. */
export interface FoeStep {
  who: number;
  events: BattleEvent[];
  /** 이 적이 행동을 마친 뒤의 싸움 */
  after: Battle;
}

/**
 * "차례 끝": 손패를 버리고, 적들이 차례로 행동한 뒤, 다시 내 차례를 연다.
 * 토끼의 일(차례를 마칠 때의 보물, 새 차례를 열며 생긴 일)은 who가 -1인 걸음에 담긴다.
 */
export function endTurn(battle: Battle, ctx: BattleContext): FoeStep[] {
  if (battle.result !== null) return [];
  const steps: FoeStep[] = [];
  const mine: BattleEvent[] = [];
  if (has(ctx, 'feather') && battle.me.block === 0) {
    mine.push({ t: 'treasure', id: 'feather' });
    gainBlock(battle, 'me', 5, mine);
  }
  battle.discard.push(...battle.hand);
  battle.hand = [];
  fade(battle.me);
  if (mine.length > 0) steps.push({ who: -1, events: mine, after: structuredClone(battle) });

  for (let index = 0; index < battle.foes.length; index += 1) {
    const foe = battle.foes[index];
    if (foe.dead || battle.result !== null) continue;
    const events: BattleEvent[] = [];
    foe.block = 0;
    const poison = stat(foe, 'poison');
    if (poison > 0) {
      loseHp(battle, index, poison, events, ctx);
      addStatus(foe, 'poison', -1);
    }
    if (!foe.dead) {
      if (stat(foe, 'guard') > 0) gainBlock(battle, index, stat(foe, 'guard'), events);
      if (stat(foe, 'growth') > 0) giveStatus(battle, index, 'strength', stat(foe, 'growth'), events);
      const move = ENEMIES[foe.id].moves[foe.next];
      events.push({ t: 'act', who: index, move: foe.next });
      for (const act of move.acts) foeAct(battle, index, act, events, ctx);
      foe.history.push(foe.next);
      if (foe.history.length > 6) foe.history.shift();
      fade(foe);
      planMove(foe, ctx);
    }
    steps.push({ who: index, events, after: structuredClone(battle) });
  }
  if (battle.result === null) {
    const events = startTurn(battle, ctx);
    steps.push({ who: -1, events, after: structuredClone(battle) });
  }
  return steps;
}

/** 덱에서 싸우는 동안의 카드 수: 뽑을 더미, 버린 더미, 사라진 카드 */
export function pileCounts(battle: Battle): { draw: number; discard: number; gone: number } {
  return { draw: battle.draw.length, discard: battle.discard.length, gone: battle.gone.length };
}
