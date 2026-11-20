/**
 * 구름 탑 모험의 판과 판 밖의 진행.
 *
 * 판(RunState): 갈림길에서 다음 층을 고르고, 그 층의 일(싸움, 쉼터, 가게, 보물 상자, 수상한 길)을 마치면 다음 층이다.
 * 판은 통째로 저장돼서, 앱을 닫았다 열어도 하던 자리부터 이어 한다.
 * 판 밖(TowerMeta): 판이 끝나면 오른 층과 물리친 대장만큼 구름 조각을 받고, 그것으로 영구 강화를 산다.
 */
import { endTurn, pick, playCard, rand, randInt, shuffle, startBattle, type Battle, type BattleContext, type BattleKind, type Card, type FoeStep, type Rng } from './battle';
import {
  ACTS,
  BOSS_TREASURES,
  CARDS,
  CARD_IDS,
  COMMON_TREASURES,
  ENCOUNTERS,
  EVENT_IDS,
  FLOORS_PER_ACT,
  PLAYER,
  PRICES,
  REWARD,
  START_DECK,
  TOP_FLOOR,
  TREASURES,
  UPGRADES,
  ENEMIES,
  RELIC_MAX,
  RELIC_STEP,
  RELICS,
  relicCost,
  type CardId,
  type EnemyId,
  type EventId,
  type NodeKind,
  type Rarity,
  type RelicId,
  type TreasureId,
  type UpgradeId,
} from './data';
import { cardName } from './text';
import { applyDifficultyBattle, applyDifficultyStart, clampDifficulty, DIFFICULTY_SHARDS, difficultyOf, difficultyPrice, hpAfterBoss } from './difficulty';

// ───────── 판 ─────────

/** 지금 판이 어느 화면에 있는지 */
export type Stage = 'map' | 'battle' | 'reward' | 'rest' | 'shop' | 'chest' | 'event' | 'over';

export interface Reward {
  gold: number;
  /** 고를 카드. 골랐거나 건너뛰었으면 null */
  cards: CardId[] | null;
  /** 받은 보물(강한 적) */
  treasure: TreasureId | null;
  /** 고를 대장 보물. 골랐으면 null */
  bossPick: TreasureId[] | null;
}

export interface ShopItem<T> {
  id: T;
  price: number;
  sold: boolean;
}

export interface Shop {
  cards: ShopItem<CardId>[];
  treasures: ShopItem<TreasureId>[];
  /** 이 가게에서 카드를 이미 뺐는지 */
  removed: boolean;
}

export interface RunStats {
  kills: number;
  elites: number;
  bosses: number;
  cards: number;
}

export interface RunState {
  /** 난수 */
  rng: Rng;
  /** 지금 있는 층(1부터). 갈림길에서는 방금 마친 층이고, 처음엔 0이다. */
  floor: number;
  hp: number;
  maxHp: number;
  gold: number;
  deck: Card[];
  nextUid: number;
  treasures: TreasureId[];
  stage: Stage;
  /** 갈림길에서 고를 다음 층의 일 */
  choices: NodeKind[];
  /** 지금 층의 일 */
  node: NodeKind | null;
  /** 지나온 층마다 고른 일(1층부터). 갈림길의 탑 그림에 지나온 층을 보여 준다. */
  path: NodeKind[];
  battle: Battle | null;
  reward: Reward | null;
  shop: Shop | null;
  event: EventId | null;
  /** 고른 일의 결과 한 줄. 보였으면 null */
  eventResult: string | null;
  /** 이 판에서 이미 만난 일 */
  seenEvents: EventId[];
  /** 이 구역에서 한 싸움의 수. 구역의 처음 두 싸움은 쉬운 무리가 나온다. */
  actFights: number;
  /** 가게에서 카드를 뺀 횟수. 뺄 때마다 값이 오른다. */
  removals: number;
  /** 판을 시작할 때 정해진 것: 쉼터 회복(%), 카드 보상의 장 수, 나오는 카드 묶음 */
  restPercent: number;
  rewardChoices: number;
  packs: number[];
  stats: RunStats;
  /** 이 판에서 만난 카드(보상과 가게에 나온 것)와 적. 판이 끝나면 도감에 옮긴다. */
  met: Met;
  /** 판을 시작할 때의 유물 단계. 판 안의 값은 이것으로 셈해서, 판 중에 유물을 올려도 이 판은 그대로다. */
  relics: RelicLevels;
  result: null | 'win' | 'lose';
  /** 난이도(0이 보통). 난이도가 생기기 전에 저장한 판에는 없다. */
  difficulty?: number;
}

export interface Met {
  cards: CardId[];
  foes: EnemyId[];
}

function meet<T>(list: T[], id: T): void {
  if (!list.includes(id)) list.push(id);
}

export interface RunOptions {
  seed: number;
  levels: Partial<Record<UpgradeId, number>>;
  relics?: RelicLevels;
  difficulty?: number;
}

export type RelicLevels = Partial<Record<RelicId, number>>;

export const relicLevel = (relics: RelicLevels | undefined, id: RelicId): number =>
  Math.max(0, Math.min(RELIC_MAX, Math.floor(relics?.[id] ?? 0)));

export const levelOf = (levels: Partial<Record<UpgradeId, number>>, id: UpgradeId): number =>
  Math.max(0, Math.min(UPGRADES[id].costs.length, Math.floor(levels[id] ?? 0)));

/** 몇째 구역인지(0부터) */
export const actOf = (floor: number): number => Math.min(ACTS - 1, Math.floor((Math.max(1, floor) - 1) / FLOORS_PER_ACT));
/** 구역 안에서 몇째 층인지(1부터) */
export const floorInAct = (floor: number): number => ((Math.max(1, floor) - 1) % FLOORS_PER_ACT) + 1;

export const ctxOf = (run: RunState): BattleContext => ({
  rng: run.rng,
  treasures: run.treasures,
  firstBlock: relicLevel(run.relics, 'shell') * RELIC_STEP.shell,
});

function newCard(run: RunState, id: CardId, up = false): Card {
  const card: Card = { uid: run.nextUid, id, up };
  run.nextUid += 1;
  return card;
}

export function createRun(options: RunOptions): RunState {
  const { levels } = options;
  const relics: RelicLevels = {};
  for (const id of Object.keys(RELICS) as RelicId[]) {
    const level = relicLevel(options.relics, id);
    if (level > 0) relics[id] = level;
  }
  const hp = PLAYER.hp + levelOf(levels, 'hp') * 5 + relicLevel(relics, 'seed') * RELIC_STEP.seed;
  const run: RunState = {
    rng: { s: options.seed | 0 },
    floor: 0,
    hp,
    maxHp: hp,
    gold: 50 + levelOf(levels, 'gold') * 30,
    deck: [],
    nextUid: 1,
    treasures: [],
    stage: 'map',
    choices: [],
    node: null,
    path: [],
    battle: null,
    reward: null,
    shop: null,
    event: null,
    eventResult: null,
    seenEvents: [],
    actFights: 0,
    removals: 0,
    restPercent: REWARD.restPercent + levelOf(levels, 'rest') * 10,
    rewardChoices: 3 + levelOf(levels, 'choice'),
    packs: [0, ...(levelOf(levels, 'pack1') > 0 ? [1] : []), ...(levelOf(levels, 'pack2') > 0 ? [2] : [])],
    stats: { kills: 0, elites: 0, bosses: 0, cards: 0 },
    met: { cards: [], foes: [] },
    relics,
    result: null,
    difficulty: clampDifficulty(options.difficulty ?? 0),
  };
  applyDifficultyStart(run);
  run.deck = START_DECK.map((id) => newCard(run, id));
  if (levelOf(levels, 'relic') > 0) gainTreasure(run, pick(run.rng, COMMON_TREASURES));
  run.choices = choicesFor(run, 1);
  return run;
}

/** 판에서 마친 층 수. 갈림길이나 그 층의 일을 마친 뒤면 지금 층까지, 일을 하는 중이면 그 앞 층까지다. */
export function floorsCleared(run: RunState): number {
  if (run.result === 'win') return TOP_FLOOR;
  return run.stage === 'map' ? run.floor : Math.max(0, run.floor - 1);
}

/** 판의 점수: 마친 층마다 100점, 꼭대기까지 오르면 500점 더 */
export function runScore(run: RunState): number {
  return floorsCleared(run) * 100 + (run.result === 'win' ? 500 : 0);
}

/** 판이 끝났을 때 받는 구름 조각: 마친 층마다 1, 강한 적마다 2, 대장마다 8, 꼭대기까지 오르면 15에 난이도마다 5 더 */
export function shardsFor(run: RunState): number {
  const base =
    floorsCleared(run) + run.stats.elites * 2 + run.stats.bosses * 8 + (run.result === 'win' ? 15 + difficultyOf(run) * DIFFICULTY_SHARDS : 0);
  return Math.floor((base * (100 + relicLevel(run.relics, 'net') * RELIC_STEP.net)) / 100);
}

// ───────── 갈림길 ─────────

const NODE_WEIGHTS: readonly (readonly [NodeKind, number])[] = [
  ['fight', 40],
  ['event', 22],
  ['elite', 15],
  ['shop', 13],
  ['rest', 10],
];

function weightedNode(rng: Rng, allowed: readonly NodeKind[]): NodeKind {
  const pool = NODE_WEIGHTS.filter(([kind]) => allowed.includes(kind));
  const total = pool.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rand(rng) * total;
  for (const [kind, weight] of pool) {
    roll -= weight;
    if (roll < 0) return kind;
  }
  return pool[pool.length - 1][0];
}

/** floor층에서 고를 수 있는 일. 구역의 첫 층은 싸움, 마지막 층은 대장, 그 앞 층에는 늘 쉼터가 있다. */
export function choicesFor(run: RunState, floor: number): NodeKind[] {
  const position = floorInAct(floor);
  if (position === 1) return ['fight'];
  if (position === FLOORS_PER_ACT) return ['boss'];
  const rng = run.rng;
  if (position === FLOORS_PER_ACT - 1) return ['rest', weightedNode(rng, ['shop', 'fight', 'event'])];
  // 첫 구역의 앞쪽에는 강한 적이 나오지 않는다.
  const allowed: NodeKind[] = ['fight', 'event', 'shop', 'rest'];
  if (actOf(floor) > 0 || position >= 3) allowed.push('elite');
  const count = rand(rng) < 0.5 ? 3 : 2;
  const picked: NodeKind[] = position === 4 ? ['chest'] : [];
  while (picked.length < count) {
    const kind = weightedNode(rng, allowed.filter((item) => !picked.includes(item)));
    picked.push(kind);
  }
  return shuffle(rng, picked);
}

/** 갈림길에서 index번째 일을 고른다. 그 층으로 올라가 일을 연다. */
export function chooseNode(run: RunState, index: number): boolean {
  if (run.stage !== 'map' || run.result !== null) return false;
  const kind = run.choices[index];
  if (!kind) return false;
  run.floor += 1;
  run.node = kind;
  run.path.push(kind);
  run.choices = [];
  switch (kind) {
    case 'fight':
    case 'elite':
    case 'boss':
      beginBattle(run, kind);
      break;
    case 'rest':
      run.stage = 'rest';
      break;
    case 'shop':
      run.shop = makeShop(run);
      run.stage = 'shop';
      break;
    case 'chest':
      run.stage = 'chest';
      run.reward = { gold: 0, cards: null, treasure: rollTreasure(run), bossPick: null };
      if (run.reward.treasure) gainTreasure(run, run.reward.treasure);
      else {
        run.reward.gold = 50;
        run.gold += 50;
      }
      break;
    case 'event':
      run.event = rollEvent(run);
      run.eventResult = null;
      run.stage = 'event';
      break;
  }
  return true;
}

/** 그 층의 일을 마치고 갈림길로 간다. 대장을 물리친 뒤면 다음 구역이 열린다. */
export function finishNode(run: RunState): void {
  if (run.result !== null) return;
  if (run.floor >= TOP_FLOOR) {
    run.result = 'win';
    run.stage = 'over';
    return;
  }
  if (floorInAct(run.floor) === FLOORS_PER_ACT) {
    // 대장을 넘으면 체력이 다 차고, 다음 구역이 시작된다.
    run.hp = hpAfterBoss(run);
    run.actFights = 0;
  }
  run.stage = 'map';
  run.node = null;
  run.battle = null;
  run.reward = null;
  run.shop = null;
  run.event = null;
  run.eventResult = null;
  run.choices = choicesFor(run, run.floor + 1);
}

// ───────── 싸움 ─────────

function beginBattle(run: RunState, kind: BattleKind): void {
  const act = ENCOUNTERS[actOf(run.floor)];
  let enemies;
  if (kind === 'boss') enemies = [act.boss];
  else if (kind === 'elite') enemies = pick(run.rng, act.elite);
  else enemies = pick(run.rng, run.actFights < 2 ? act.easy : act.normal);
  if (kind !== 'boss') run.actFights += kind === 'fight' ? 1 : 0;
  const { battle } = startBattle(kind, enemies, run.deck, run.hp, run.maxHp, ctxOf(run));
  for (const foe of battle.foes) meet(run.met.foes, foe.id);
  applyDifficultyBattle(run, battle);
  run.battle = battle;
  run.stage = 'battle';
}

/** 싸움에서 카드를 낸다. 싸움이 끝나면 판에 결과를 넣는다. */
export function runPlayCard(run: RunState, handIndex: number, target: number | null): ReturnType<typeof playCard> {
  const battle = run.battle;
  if (!battle || run.stage !== 'battle') return null;
  const events = playCard(battle, handIndex, target, ctxOf(run));
  if (events) {
    run.stats.cards += 1;
    afterBattleChange(run);
  }
  return events;
}

/** "차례 끝". 적들이 행동한 걸음을 돌려준다. */
export function runEndTurn(run: RunState): FoeStep[] {
  const battle = run.battle;
  if (!battle || run.stage !== 'battle') return [];
  const steps = endTurn(battle, ctxOf(run));
  afterBattleChange(run);
  return steps;
}

function afterBattleChange(run: RunState): void {
  const battle = run.battle;
  if (!battle) return;
  run.hp = Math.max(0, battle.me.hp);
  if (battle.result === 'lose') {
    run.result = 'lose';
    run.stage = 'over';
    return;
  }
  if (battle.result === 'win') winBattle(run, battle);
}

function winBattle(run: RunState, battle: Battle): void {
  run.stats.kills += battle.foes.length;
  if (battle.kind === 'elite') run.stats.elites += 1;
  if (battle.kind === 'boss') run.stats.bosses += 1;
  if (run.treasures.includes('cushion')) run.hp = Math.min(run.maxHp, run.hp + 6);
  const mend = relicLevel(run.relics, 'scarf') * RELIC_STEP.scarf;
  if (mend > 0) run.hp = Math.min(run.maxHp, run.hp + mend);
  if (battle.kind === 'boss' && run.floor >= TOP_FLOOR) {
    run.result = 'win';
    run.stage = 'over';
    return;
  }
  const [low, high] = REWARD[battle.kind];
  let gold = randInt(run.rng, low, high);
  gold = Math.round((gold * (100 + relicLevel(run.relics, 'acorn') * RELIC_STEP.acorn)) / 100);
  if (run.treasures.includes('piggy')) gold += 12;
  run.gold += gold;
  const reward: Reward = { gold, cards: rollCards(run, battle.kind), treasure: null, bossPick: null };
  for (const id of reward.cards ?? []) meet(run.met.cards, id);
  if (battle.kind === 'elite') {
    reward.treasure = rollTreasure(run);
    if (reward.treasure) gainTreasure(run, reward.treasure);
  }
  if (battle.kind === 'boss') {
    const left = BOSS_TREASURES.filter((id) => !run.treasures.includes(id));
    reward.bossPick = left.length > 0 ? left : null;
  }
  run.reward = reward;
  run.stage = 'reward';
}

// ───────── 보상 ─────────

/** 이 판에서 나올 수 있는 카드 */
function cardPool(run: RunState, rarity: Rarity): CardId[] {
  return CARD_IDS.filter((id) => CARDS[id].rarity === rarity && run.packs.includes(CARDS[id].pack));
}

function rollRarity(rng: Rng, kind: BattleKind | 'shop'): Rarity {
  if (kind === 'boss') return 'rare';
  const roll = rand(rng);
  const [rare, uncommon] = kind === 'elite' ? [0.15, 0.45] : [0.06, 0.34];
  if (roll < rare) return 'rare';
  if (roll < rare + uncommon) return 'uncommon';
  return 'common';
}

/** 카드 보상: 서로 다른 카드 몇 장. 큰 별이 있으면 하나 적다. */
export function rollCards(run: RunState, kind: BattleKind, count = run.rewardChoices - (run.treasures.includes('bigStar') ? 1 : 0)): CardId[] {
  const picked: CardId[] = [];
  let guard = 0;
  while (picked.length < count && guard < 200) {
    guard += 1;
    const pool = cardPool(run, rollRarity(run.rng, kind)).filter((id) => !picked.includes(id));
    if (pool.length > 0) picked.push(pick(run.rng, pool));
  }
  return picked;
}

/** 아직 없는 흔한 보물 하나. 다 가졌으면 null */
function rollTreasure(run: RunState): TreasureId | null {
  const left = COMMON_TREASURES.filter((id) => !run.treasures.includes(id));
  return left.length > 0 ? pick(run.rng, left) : null;
}

export function gainTreasure(run: RunState, id: TreasureId): void {
  if (run.treasures.includes(id)) return;
  run.treasures.push(id);
  if (id === 'honey') {
    run.maxHp += 10;
    run.hp += 10;
  }
}

/** 보상의 카드 가운데 하나를 덱에 넣는다. index가 null이면 건너뛴다. */
export function takeRewardCard(run: RunState, index: number | null): boolean {
  const reward = run.reward;
  if (run.stage !== 'reward' || !reward?.cards) return false;
  if (index !== null) {
    const id = reward.cards[index];
    if (!id) return false;
    run.deck.push(newCard(run, id));
  }
  reward.cards = null;
  return true;
}

/** 대장 보물을 고른다. */
export function takeBossTreasure(run: RunState, index: number): boolean {
  const reward = run.reward;
  if (run.stage !== 'reward' || !reward?.bossPick) return false;
  const id = reward.bossPick[index];
  if (!id) return false;
  gainTreasure(run, id);
  reward.bossPick = null;
  return true;
}

/** 보상 화면에서 더 고를 것이 없는지 */
export function rewardDone(run: RunState): boolean {
  return !run.reward || (run.reward.cards === null && run.reward.bossPick === null);
}

// ───────── 쉼터 ─────────

/** 쉼터에서 쉬면 회복하는 체력 */
export function restAmount(run: RunState): number {
  return Math.max(1, Math.floor((run.maxHp * run.restPercent) / 100));
}

export function canRest(run: RunState): boolean {
  return !run.treasures.includes('sleepyMoon');
}

export function rest(run: RunState): boolean {
  if (run.stage !== 'rest' || !canRest(run)) return false;
  run.hp = Math.min(run.maxHp, run.hp + restAmount(run));
  finishNode(run);
  return true;
}

/** 강화할 수 있는 카드(아직 강화하지 않은 카드) */
export function upgradable(run: RunState): Card[] {
  return run.deck.filter((card) => !card.up);
}

/** 덱의 그 카드를 강화한다. */
export function upgradeCard(run: RunState, uid: number): boolean {
  const card = run.deck.find((item) => item.uid === uid);
  if (!card || card.up) return false;
  card.up = true;
  return true;
}

/** 쉼터에서 카드를 강화하고 층을 마친다. */
export function restUpgrade(run: RunState, uid: number): boolean {
  if (run.stage !== 'rest' || !upgradeCard(run, uid)) return false;
  finishNode(run);
  return true;
}

// ───────── 가게 ─────────

/** 유물 단골 쿠폰만큼 깎은 값 */
function discounted(run: RunState, price: number): number {
  return Math.round((price * (100 - relicLevel(run.relics, 'coupon') * RELIC_STEP.coupon)) / 100);
}

function jitter(rng: Rng, price: number): number {
  return Math.round(price * (0.9 + rand(rng) * 0.2));
}

function makeShop(run: RunState): Shop {
  const ids: CardId[] = [];
  const wanted: Rarity[] = ['common', 'common', 'uncommon', 'uncommon', rand(run.rng) < 0.5 ? 'rare' : 'uncommon'];
  for (const rarity of wanted) {
    const pool = cardPool(run, rarity).filter((id) => !ids.includes(id));
    if (pool.length > 0) ids.push(pick(run.rng, pool));
  }
  const treasures = shuffle(
    run.rng,
    COMMON_TREASURES.filter((id) => !run.treasures.includes(id)),
  ).slice(0, 2);
  return {
    cards: ids.map((id) => {
      meet(run.met.cards, id);
      return { id, price: difficultyPrice(run, discounted(run, jitter(run.rng, PRICES.card[CARDS[id].rarity]))), sold: false };
    }),
    treasures: treasures.map((id) => ({ id, price: difficultyPrice(run, discounted(run, jitter(run.rng, PRICES.treasure))), sold: false })),
    removed: false,
  };
}

/** 가게에서 카드를 빼는 값 */
export function removePrice(run: RunState): number {
  return PRICES.remove + run.removals * PRICES.removeStep;
}

export function buyCard(run: RunState, index: number): boolean {
  const item = run.shop?.cards[index];
  if (run.stage !== 'shop' || !item || item.sold || run.gold < item.price) return false;
  run.gold -= item.price;
  item.sold = true;
  run.deck.push(newCard(run, item.id));
  return true;
}

export function buyTreasure(run: RunState, index: number): boolean {
  const item = run.shop?.treasures[index];
  if (run.stage !== 'shop' || !item || item.sold || run.gold < item.price) return false;
  run.gold -= item.price;
  item.sold = true;
  gainTreasure(run, item.id);
  return true;
}

/** 덱에서 카드 한 장을 뺀다. 덱에는 적어도 5장이 남아야 한다. */
export function canRemove(run: RunState): boolean {
  return run.deck.length > 5;
}

function removeFromDeck(run: RunState, uid: number): boolean {
  const index = run.deck.findIndex((card) => card.uid === uid);
  if (index < 0 || !canRemove(run)) return false;
  run.deck.splice(index, 1);
  return true;
}

export function shopRemove(run: RunState, uid: number): boolean {
  const shop = run.shop;
  const price = removePrice(run);
  if (run.stage !== 'shop' || !shop || shop.removed || run.gold < price) return false;
  if (!removeFromDeck(run, uid)) return false;
  run.gold -= price;
  run.removals += 1;
  shop.removed = true;
  return true;
}

// ───────── 수상한 길 ─────────

function rollEvent(run: RunState): EventId {
  const fresh = EVENT_IDS.filter((id) => !run.seenEvents.includes(id));
  const id = pick(run.rng, fresh.length > 0 ? fresh : EVENT_IDS);
  run.seenEvents.push(id);
  return id;
}

/** 그 고르기를 할 수 있는지(별사탕이 모자라거나 뺄 카드가 없으면 못 한다) */
export function canChoose(run: RunState, choice: number): boolean {
  if (run.event === 'spring' && choice === 1) return run.gold >= 30;
  if (run.event === 'gardener' && choice === 0) return canRemove(run);
  return true;
}

/** 구름 정원사의 "카드 빼기"처럼 덱에서 카드를 골라야 하는 고르기인지 */
export function choiceNeedsCard(run: RunState, choice: number): boolean {
  return run.event === 'gardener' && choice === 0;
}

/**
 * 수상한 길에서 고른다. 카드를 골라야 하는 고르기면 uid를 준다.
 * 결과는 run.eventResult에 한 줄로 남고, 화면이 그것을 보인 뒤 finishNode로 넘어간다.
 */
export function chooseEvent(run: RunState, choice: number, uid: number | null = null): boolean {
  if (run.stage !== 'event' || run.event === null || run.eventResult !== null || !canChoose(run, choice)) return false;
  const nothing = '아무 일도 없었어요';
  switch (run.event) {
    case 'spring':
      if (choice === 0) {
        const before = run.hp;
        run.hp = Math.min(run.maxHp, run.hp + Math.floor(run.maxHp / 4));
        run.eventResult = `체력을 ${run.hp - before} 회복했어요`;
      } else {
        run.gold -= 30;
        const id = rollTreasure(run);
        if (id) {
          gainTreasure(run, id);
          run.eventResult = `보물을 얻었어요: ${TREASURES[id].name}`;
        } else {
          run.gold += 30;
          run.eventResult = '소원이 이루어지지 않았어요';
        }
      }
      break;
    case 'cat':
      if (choice === 0) {
        run.hp = Math.max(1, run.hp - 8);
        run.gold += 50;
        run.eventResult = '고양이가 별사탕 50개를 줬어요';
      } else {
        const id = pick(run.rng, cardPool(run, 'uncommon'));
        run.deck.push(newCard(run, id));
        run.eventResult = `${cardName(id, false)} 카드를 받았어요`;
      }
      break;
    case 'books':
      if (choice === 0) {
        const targets = shuffle(run.rng, upgradable(run)).slice(0, 2);
        for (const card of targets) card.up = true;
        run.eventResult = targets.length > 0 ? `${targets.map((card) => cardName(card.id, true)).join(', ')} 강화!` : '강화할 카드가 없었어요';
      } else run.eventResult = nothing;
      break;
    case 'mushrooms':
      if (choice === 0) {
        run.maxHp += 6;
        run.hp = Math.max(1, run.hp - 6);
        run.eventResult = '최대 체력이 6 늘었어요';
      } else run.eventResult = nothing;
      break;
    case 'gardener':
      if (choice === 0) {
        const card = run.deck.find((item) => item.uid === uid);
        if (!card || !removeFromDeck(run, card.uid)) return false;
        run.eventResult = `${cardName(card.id, card.up)} 카드를 뺐어요`;
      } else run.eventResult = nothing;
      break;
  }
  return true;
}

/** 수상한 길에서 결과를 보고 넘어간다. */
export function leaveEvent(run: RunState): boolean {
  if (run.stage !== 'event' || run.eventResult === null) return false;
  finishNode(run);
  return true;
}

/** 판을 그만둔다(포기). 마친 층까지로 판이 끝난다. */
export function abandon(run: RunState): void {
  if (run.result !== null) return;
  run.result = 'lose';
  run.stage = 'over';
}

// ───────── 판 밖 ─────────

export const META_VERSION = 1;

export interface TowerMeta {
  version: number;
  /** 구름 조각 */
  shards: number;
  levels: Partial<Record<UpgradeId, number>>;
  /** 가장 많이 마친 층 수 */
  best: number;
  runs: number;
  wins: number;
  /** 도감: 만난 카드와 적, 가져 본 보물 */
  codex: Codex;
  /** 지금까지 물리친 적의 수 */
  kills: number;
  /** 보상을 받은 업적 */
  claimed: string[];
  /** 유물의 단계 */
  relics: RelicLevels;
  /** 열린 가장 높은 난이도와 고른 난이도(0이 보통) */
  unlocked: number;
  difficulty: number;
  /** 하던 판. 없으면 null */
  run: RunState | null;
  /** 저장한 때(ms). 같은 기기의 다른 곳이 저장한 것과 견준다. */
  savedAt: number;
}

export function createMeta(): TowerMeta {
  return {
    version: META_VERSION,
    shards: 0,
    levels: {},
    best: 0,
    runs: 0,
    wins: 0,
    codex: { cards: [], foes: [], treasures: [] },
    kills: 0,
    claimed: [],
    relics: {},
    unlocked: 0,
    difficulty: 0,
    run: null,
    savedAt: 0,
  };
}

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

function relicsOf(value: unknown): RelicLevels {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const relics: RelicLevels = {};
  for (const id of Object.keys(RELICS) as RelicId[]) {
    const level = Math.min(RELIC_MAX, count(raw[id]));
    if (level > 0) relics[id] = level;
  }
  return relics;
}

/** 목록 가운데 아는 이름만, 겹치지 않게 남긴다. */
function known<K extends string>(value: unknown, table: Readonly<Record<K, unknown>>): K[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is K => typeof id === 'string' && id in table))];
}

/** 하던 판이 지금의 규칙으로 읽을 수 있는 모양인지 대강 본다. 아니면 버린다. */
function looksLikeRun(value: unknown): value is RunState {
  if (!value || typeof value !== 'object') return false;
  const run = value as Partial<RunState>;
  return (
    typeof run.floor === 'number' &&
    typeof run.hp === 'number' &&
    typeof run.stage === 'string' &&
    Array.isArray(run.deck) &&
    run.deck.every((card) => card && typeof card === 'object' && (card as Card).id in CARDS) &&
    Array.isArray(run.treasures) &&
    typeof run.rng === 'object' &&
    run.rng !== null
  );
}

/** 기기에서 읽은 값을 쓸 수 있는 모양으로 바꾼다. 망가진 값은 처음 상태로 둔다. */
export function normalizeMeta(raw: unknown): TowerMeta {
  if (!raw || typeof raw !== 'object') return createMeta();
  const value = raw as Record<string, unknown>;
  const levels: Partial<Record<UpgradeId, number>> = {};
  const rawLevels = value.levels && typeof value.levels === 'object' ? (value.levels as Record<string, unknown>) : {};
  for (const id of Object.keys(UPGRADES) as UpgradeId[]) {
    const level = Math.min(UPGRADES[id].costs.length, count(rawLevels[id]));
    if (level > 0) levels[id] = level;
  }
  const unlocked = clampDifficulty(value.unlocked);
  const run = looksLikeRun(value.run) && value.run.result === null ? value.run : null;
  // 지나온 길을 적기 전에 저장한 판은 지나온 층을 모르는 채로 둔다.
  if (run && !Array.isArray(run.path)) run.path = [];
  // 도감을 만들기 전에 저장한 판은 만난 것이 비어 있는 채로 이어 한다.
  if (run && (!run.relics || typeof run.relics !== 'object')) run.relics = {};
  if (run && !(run.met && Array.isArray(run.met.cards) && Array.isArray(run.met.foes))) run.met = { cards: [], foes: [] };
  const rawCodex = value.codex && typeof value.codex === 'object' ? (value.codex as Record<string, unknown>) : {};
  return {
    version: META_VERSION,
    shards: count(value.shards),
    levels,
    best: Math.min(TOP_FLOOR, count(value.best)),
    runs: count(value.runs),
    wins: count(value.wins),
    codex: {
      cards: known(rawCodex.cards, CARDS),
      foes: known(rawCodex.foes, ENEMIES),
      treasures: known(rawCodex.treasures, TREASURES),
    },
    kills: count(value.kills),
    relics: relicsOf(value.relics),
    claimed: Array.isArray(value.claimed) ? [...new Set(value.claimed.filter((id): id is string => typeof id === 'string'))] : [],
    unlocked,
    difficulty: Math.min(unlocked, clampDifficulty(value.difficulty)),
    run,
    savedAt: count(value.savedAt),
  };
}

/** 다음 단계의 값. 다 올렸으면 null */
export function upgradeCost(levels: Partial<Record<UpgradeId, number>>, id: UpgradeId): number | null {
  const level = levelOf(levels, id);
  return UPGRADES[id].costs[level] ?? null;
}

/** 영구 강화를 한 단계 산다. 살 수 없으면 meta를 그대로 돌려준다. */
export function buyUpgrade(meta: TowerMeta, id: UpgradeId): TowerMeta {
  const cost = upgradeCost(meta.levels, id);
  if (cost === null || meta.shards < cost) return meta;
  return { ...meta, shards: meta.shards - cost, levels: { ...meta.levels, [id]: levelOf(meta.levels, id) + 1 } };
}

/** 유물을 한 단계 올린다. 올릴 수 없으면 meta를 그대로 돌려준다. */
export function buyRelic(meta: TowerMeta, id: RelicId): TowerMeta {
  const level = relicLevel(meta.relics, id);
  const cost = relicCost(level);
  if (cost === null || meta.shards < cost) return meta;
  return { ...meta, shards: meta.shards - cost, relics: { ...meta.relics, [id]: level + 1 } };
}

/** 가진 구름 조각으로 살 수 있는 강화나 유물이 있는지 */
export function canBuyAny(meta: TowerMeta): boolean {
  const upgrade = (Object.keys(UPGRADES) as UpgradeId[]).some((id) => {
    const cost = upgradeCost(meta.levels, id);
    return cost !== null && meta.shards >= cost;
  });
  if (upgrade) return true;
  return (Object.keys(RELICS) as RelicId[]).some((id) => {
    const cost = relicCost(relicLevel(meta.relics, id));
    return cost !== null && meta.shards >= cost;
  });
}

/** 끝난 판의 결과를 판 밖 진행에 넣는다: 조각, 최고 기록, 판 수. 하던 판은 지운다. */
export function settleRun(meta: TowerMeta, run: RunState): TowerMeta {
  const opened = unlockedAfter(meta, run);
  return {
    ...meta,
    codex: codexWith(meta.codex, run),
    kills: meta.kills + run.stats.kills,
    shards: meta.shards + shardsFor(run),
    best: Math.max(meta.best, floorsCleared(run)),
    runs: meta.runs + 1,
    wins: meta.wins + (run.result === 'win' ? 1 : 0),
    unlocked: opened,
    // 새 난이도가 열리면 다음 판은 그 난이도로 고른다.
    difficulty: opened > meta.unlocked ? opened : meta.difficulty,
    run: null,
  };
}

/** 판이 끝난 뒤 열린 가장 높은 난이도: 연 난이도 가운데 가장 높은 것으로 꼭대기에 오르면 하나 더 열린다. */
export function unlockedAfter(meta: TowerMeta, run: RunState): number {
  const level = difficultyOf(run);
  if (run.result !== 'win' || level < meta.unlocked) return meta.unlocked;
  return clampDifficulty(level + 1);
}

/** 허브 카드와 결과 화면에 쓰는 기록: 점수에서 마친 층을 꺼낸다. */
export function recordLabel(best: number): string {
  if (best >= TOP_FLOOR * 100 + 500) return '꼭대기 도착';
  return `최고 ${Math.floor(best / 100)}층`;
}

/** 점수(마친 층 × 100)에 따라 주는 코인: 층마다 1 */
export function coinsFor(score: number): number {
  return Math.floor(score / 100);
}

export interface Codex {
  cards: CardId[];
  foes: EnemyId[];
  treasures: TreasureId[];
}

const union = <T>(base: readonly T[], more: readonly T[]): T[] => [...new Set([...base, ...more])];

/** 도감에 판에서 만난 것(덱의 카드, 나온 카드, 만난 적, 가진 보물)을 더한다. */
export function codexWith(codex: Codex, run: RunState | null): Codex {
  if (!run) return codex;
  return {
    cards: union(codex.cards, [...run.deck.map((card) => card.id), ...run.met.cards]),
    foes: union(codex.foes, run.met.foes),
    treasures: union(codex.treasures, run.treasures),
  };
}

/** 하던 판까지 넣은 도감. 준비 화면의 도감은 이것을 보여 준다. */
export const codexNow = (meta: TowerMeta): Codex => codexWith(meta.codex, meta.run);
