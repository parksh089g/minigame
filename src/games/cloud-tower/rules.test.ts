import { describe, expect, it } from 'vitest';
import { attackDamage, endTurn, playCard, startBattle, type Battle, type BattleContext, type Card } from './battle';
import { autoplay } from './bot';
import {
  ACT_NAMES,
  CARD_IDS,
  CARDS,
  ENCOUNTERS,
  ENEMIES,
  EVENTS,
  FLOORS_PER_ACT,
  NODE_BLURBS,
  NODE_NAMES,
  STATUSES,
  TOP_FLOOR,
  TREASURES,
  UPGRADES,
  type CardId,
  type EnemyId,
} from './data';
import {
  buyUpgrade,
  chooseNode,
  choicesFor,
  createMeta,
  createRun,
  floorsCleared,
  normalizeMeta,
  recordLabel,
  runPlayCard,
  runScore,
  runUsePotion,
  settleRun,
  shardsFor,
} from './run';
import { addPotion, buyPotion, POTION_IDS, POTION_SLOTS, POTIONS, swapRewardPotion, waitingPotion } from './potions';
import { cardLines, cardName, moveText, MAP_TEXT, POTION_TEXT, potionText } from './text';

/** 주아 글꼴에 들어 있는 한글: KS X 1001의 완성형 2,350자 */
function fontSyllables(): Set<string> {
  const decoder = new TextDecoder('euc-kr');
  const syllables = new Set<string>();
  for (let lead = 0xb0; lead <= 0xc8; lead += 1) {
    for (let trail = 0xa1; trail <= 0xfe; trail += 1) syllables.add(decoder.decode(new Uint8Array([lead, trail])));
  }
  return syllables;
}

const ctx = (treasures: BattleContext['treasures'] = []): BattleContext => ({ rng: { s: 7 }, treasures });
const deckOf = (ids: readonly CardId[]): Card[] => ids.map((id, index) => ({ uid: index + 1, id, up: false }));

/** 손패를 정해 둔 싸움 */
function battleWith(hand: readonly CardId[], enemies: readonly EnemyId[] = ['jelly']): { battle: Battle; context: BattleContext } {
  const context = ctx();
  const { battle } = startBattle('fight', enemies, deckOf(['cloud', 'cloud', 'cloud', 'cloud', 'cloud']), 60, 60, context);
  battle.draw.push(...battle.hand);
  battle.hand = deckOf(hand).map((card) => ({ ...card, uid: card.uid + 100 }));
  battle.mana = 3;
  return { battle, context };
}

describe('글', () => {
  const syllables = fontSyllables();
  const texts: string[] = [
    ...ACT_NAMES,
    ...Object.values(NODE_NAMES),
    ...Object.values(NODE_BLURBS),
    ...CARD_IDS.flatMap((id) => [cardName(id, true), ...cardLines(id, false), ...cardLines(id, true)]),
    ...Object.entries(ENEMIES).flatMap(([id, def]) => [def.name, ...def.moves.map((_, move) => moveText(id as EnemyId, move))]),
    ...Object.values(STATUSES).flatMap((def) => [def.name, def.blurb(3)]),
    ...Object.values(TREASURES).flatMap((def) => [def.name, def.blurb]),
    ...Object.values(EVENTS).flatMap((def) => [def.title, def.story, ...def.choices.flatMap((choice) => [choice.label, choice.note])]),
    ...Object.values(UPGRADES).flatMap((def) => [def.name, def.blurb, def.effect(0), def.effect(1)]),
    MAP_TEXT.hint,
    MAP_TEXT.climb,
    MAP_TEXT.entrance,
    MAP_TEXT.deck(10),
    ...POTION_IDS.flatMap((id) => [POTIONS[id].name, potionText(id)]),
    ...Object.values(POTION_TEXT).map((value) => (typeof value === 'function' ? value('물약') : value)),
  ];

  it('화면에 보이는 글은 글꼴에 들어 있는 한글만 쓴다', () => {
    const missing = new Set<string>();
    for (const text of texts) {
      for (const char of text) {
        if (/[가-힣]/.test(char) && !syllables.has(char)) missing.add(char);
      }
    }
    expect([...missing]).toEqual([]);
  });

  it('카드 이름은 카드에 들어가게 짧다', () => {
    for (const id of CARD_IDS) expect(cardName(id, true).length, id).toBeLessThanOrEqual(7);
  });

  it('카드 설명은 강화하면 바뀐다(값이 오르거나 마력이 준다)', () => {
    for (const id of CARD_IDS) {
      const def = CARDS[id];
      const changed = cardLines(id, false).join() !== cardLines(id, true).join() || def.cost[0] !== def.cost[1];
      expect(changed, id).toBe(true);
    }
  });

  it('피해를 여러 번 주는 카드는 "씩 몇 번"으로 적는다', () => {
    expect(cardLines('twins', false)).toEqual(['피해 4씩 2번']);
    expect(cardLines('sparkle', true)).toEqual(['마력 +2', '사라짐']);
    expect(cardLines('armor', false)).toEqual(['차례가 올 때마다 방어 4']);
  });
});

describe('싸움', () => {
  it('힘은 더하고, 움츠림은 4분의 1을 덜고, 허점은 절반을 더한다', () => {
    const plain = { hp: 10, maxHp: 10, block: 0, st: {} };
    expect(attackDamage(6, plain, plain)).toBe(6);
    expect(attackDamage(6, { ...plain, st: { strength: 2 } }, plain)).toBe(8);
    expect(attackDamage(8, { ...plain, st: { weak: 1 } }, plain)).toBe(6);
    expect(attackDamage(6, plain, { ...plain, st: { vuln: 1 } })).toBe(9);
  });

  it('카드를 내면 마력이 줄고 적이 맞는다. 방어를 먼저 깎는다', () => {
    const { battle, context } = battleWith(['wand']);
    battle.foes[0].block = 2;
    const hp = battle.foes[0].hp;
    expect(playCard(battle, 0, 0, context)).not.toBeNull();
    expect(battle.mana).toBe(2);
    expect(battle.foes[0].block).toBe(0);
    expect(battle.foes[0].hp).toBe(hp - 4);
    expect(battle.discard).toHaveLength(1);
  });

  it('적을 골라야 하는 카드는 적 없이 낼 수 없고, 마력이 모자라면 낼 수 없다', () => {
    const { battle, context } = battleWith(['wand', 'bean']);
    expect(playCard(battle, 0, null, context)).toBeNull();
    battle.mana = 1;
    expect(playCard(battle, 1, 0, context)).toBeNull();
    expect(battle.hand).toHaveLength(2);
  });

  it('마법 카드와 사라짐 카드는 낸 뒤 이번 싸움에서 사라진다', () => {
    const { battle, context } = battleWith(['cheer', 'sparkle']);
    playCard(battle, 0, null, context);
    playCard(battle, 0, null, context);
    expect(battle.gone.map((card) => card.id)).toEqual(['cheer', 'sparkle']);
    expect(battle.me.st.strength).toBe(2);
    expect(battle.mana).toBe(3);
  });

  it('적을 모두 물리치면 이긴다', () => {
    const { battle, context } = battleWith(['bean']);
    battle.foes[0].hp = 5;
    playCard(battle, 0, 0, context);
    expect(battle.foes[0].dead).toBe(true);
    expect(battle.result).toBe('win');
  });

  it('차례를 마치면 적이 알려 준 행동을 하고, 다시 내 차례가 오며 카드 5장을 뽑는다', () => {
    const { battle, context } = battleWith(['wand']);
    const hp = battle.me.hp;
    const steps = endTurn(battle, context);
    expect(steps.length).toBeGreaterThanOrEqual(2);
    expect(steps.at(-1)?.who).toBe(-1);
    expect(battle.me.hp).toBeLessThan(hp);
    expect(battle.turn).toBe(2);
    expect(battle.hand).toHaveLength(5);
    expect(battle.mana).toBe(3);
  });

  it('독은 차례가 올 때 체력을 깎고 1 준다', () => {
    const { battle, context } = battleWith(['spore']);
    playCard(battle, 0, 0, context);
    expect(battle.foes[0].st.poison).toBe(5);
    const hp = battle.foes[0].hp;
    endTurn(battle, context);
    expect(battle.foes[0].hp).toBe(hp - 5);
    expect(battle.foes[0].st.poison).toBe(4);
  });

  it('가시가 있는 적을 때리면 나도 다친다', () => {
    const { battle, context } = battleWith(['wand'], ['chestnut']);
    playCard(battle, 0, 0, context);
    expect(battle.me.hp).toBe(58);
  });

  it('보물: 방패 배지는 첫 차례에 방어 10, 빨간 리본은 힘 1', () => {
    const { battle } = startBattle('fight', ['jelly'], deckOf(['wand']), 60, 60, ctx(['badge', 'ribbon']));
    expect(battle.me.block).toBe(10);
    expect(battle.me.st.strength).toBe(1);
  });
});

describe('판', () => {
  const levels = {};

  it('처음 덱은 10장이고, 첫 층은 싸움이다', () => {
    const run = createRun({ seed: 1, levels });
    expect(run.deck).toHaveLength(10);
    expect(run.choices).toEqual(['fight']);
    expect(chooseNode(run, 0)).toBe(true);
    expect(run.stage).toBe('battle');
    expect(run.battle?.foes.length).toBeGreaterThan(0);
    expect(run.path).toEqual(['fight']);
  });

  it('구역의 마지막 층은 대장, 그 앞 층에는 쉼터가 있다', () => {
    const run = createRun({ seed: 2, levels });
    for (let act = 0; act < 3; act += 1) {
      expect(choicesFor(run, act * FLOORS_PER_ACT + FLOORS_PER_ACT)).toEqual(['boss']);
      expect(choicesFor(run, act * FLOORS_PER_ACT + FLOORS_PER_ACT - 1)).toContain('rest');
      expect(choicesFor(run, act * FLOORS_PER_ACT + 1)).toEqual(['fight']);
    }
    for (let floor = 1; floor <= TOP_FLOOR; floor += 1) {
      const choices = choicesFor(run, floor);
      expect(new Set(choices).size, `${floor}층`).toBe(choices.length);
    }
  });

  it('구역마다 대장이 정해져 있다', () => {
    expect(ENCOUNTERS.map((act) => act.boss)).toEqual(['ram', 'owl', 'whale']);
  });

  it('봇이 여러 판을 끝까지 해도 막히지 않고, 판마다 결과가 난다', () => {
    const cleared: number[] = [];
    for (let seed = 1; seed <= 40; seed += 1) {
      const run = createRun({ seed, levels });
      autoplay(run);
      expect(run.result, `씨앗 ${seed}`).not.toBeNull();
      cleared.push(floorsCleared(run));
      expect(runScore(run)).toBe(floorsCleared(run) * 100 + (run.result === 'win' ? 500 : 0));
    }
    // 단순한 봇도 첫 층은 대개 넘지만, 꼭대기까지 늘 가지는 못한다.
    const average = cleared.reduce((sum, value) => sum + value, 0) / cleared.length;
    expect(average).toBeGreaterThan(3);
    expect(Math.min(...cleared)).toBeLessThan(TOP_FLOOR);
  });

  it('강화를 다 산 봇은 더 높이 오른다', () => {
    const full = { hp: 4, gold: 3, rest: 2, choice: 1, relic: 1, pack1: 1, pack2: 1 };
    const average = (lv: object): number => {
      let total = 0;
      for (let seed = 1; seed <= 30; seed += 1) {
        const run = createRun({ seed, levels: lv });
        autoplay(run);
        total += floorsCleared(run);
      }
      return total / 30;
    };
    expect(average(full)).toBeGreaterThan(average({}));
  });
});

describe('물약', () => {
  /** 첫 싸움을 연 판. 물약 칸은 비어 있다. */
  function fightingRun() {
    const run = createRun({ seed: 5, levels: {} });
    chooseNode(run, 0);
    return run;
  }

  it('판은 빈 물약 칸으로 시작하고, 칸은 3개까지 찬다', () => {
    const run = createRun({ seed: 1, levels: {} });
    expect(run.potions).toEqual([]);
    for (let i = 0; i < POTION_SLOTS; i += 1) expect(addPotion(run, 'berry')).toBe(true);
    expect(addPotion(run, 'fire')).toBe(false);
    expect(run.potions).toHaveLength(POTION_SLOTS);
  });

  it('싸움에서 마력 없이 쓰고, 쓰면 칸에서 사라진다', () => {
    const run = fightingRun();
    const battle = run.battle!;
    battle.me.hp = 30;
    battle.mana = 0;
    run.potions = ['berry', 'star'];
    expect(runUsePotion(run, 0, null)).not.toBeNull();
    expect(battle.me.hp).toBe(45);
    expect(run.hp).toBe(45);
    expect(run.potions).toEqual(['star']);
    runUsePotion(run, 0, null);
    expect(battle.mana).toBe(2);
    expect(run.potions).toEqual([]);
    expect(runUsePotion(run, 0, null)).toBeNull();
  });

  it('던지는 물약은 살아 있는 적을 골라야 하고, 적을 쓰러뜨리면 이긴다', () => {
    const run = fightingRun();
    const battle = run.battle!;
    run.potions = ['fire'];
    expect(runUsePotion(run, 0, null)).toBeNull();
    expect(run.potions).toEqual(['fire']);
    battle.foes.forEach((foe, index) => {
      foe.hp = index === 0 ? 5 : 0;
      foe.dead = index !== 0;
    });
    expect(runUsePotion(run, 0, 0)).not.toBeNull();
    expect(battle.foes[0].dead).toBe(true);
    expect(run.stage).toBe('reward');
  });

  it('싸움 밖에서는 쓸 수 없다', () => {
    const run = createRun({ seed: 1, levels: {} });
    run.potions = ['berry'];
    expect(runUsePotion(run, 0, null)).toBeNull();
    expect(run.potions).toEqual(['berry']);
  });

  it('싸움에서 이기면 가끔 물약이 나오고, 칸이 가득 차면 내 물약과 바꿀 수 있다', () => {
    let got = 0;
    let waited = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const run = createRun({ seed, levels: {} });
      chooseNode(run, 0);
      run.potions = seed % 2 === 0 ? ['berry', 'berry', 'berry'] : [];
      const battle = run.battle!;
      for (const foe of battle.foes) foe.hp = 1;
      battle.mana = 99;
      battle.hand.push({ uid: 999, id: 'whirl', up: true });
      expect(runPlayCard(run, battle.hand.length - 1, null)).not.toBeNull();
      expect(run.stage).toBe('reward');
      const potion = run.reward?.potion;
      if (!potion) continue;
      got += 1;
      if (seed % 2 === 1) {
        expect(potion.taken).toBe(true);
        expect(run.potions).toEqual([potion.id]);
      } else {
        waited += 1;
        expect(waitingPotion(run)).toBe(potion.id);
        expect(swapRewardPotion(run, 1)).toBe(true);
        expect(run.potions).toEqual(['berry', potion.id, 'berry']);
        expect(waitingPotion(run)).toBeNull();
        expect(swapRewardPotion(run, 0)).toBe(false);
      }
    }
    expect(got).toBeGreaterThan(5);
    expect(got).toBeLessThan(40);
    expect(waited).toBeGreaterThan(0);
  });

  it('가게에서 물약을 산다. 칸이 가득 차면 못 산다', () => {
    const run = createRun({ seed: 3, levels: {} });
    run.choices = ['shop'];
    chooseNode(run, 0);
    const items = run.shop?.potions ?? [];
    expect(items).toHaveLength(2);
    run.gold = 1000;
    expect(buyPotion(run, 0)).toBe(true);
    expect(run.potions).toEqual([items[0].id]);
    expect(run.gold).toBe(1000 - items[0].price);
    expect(buyPotion(run, 0)).toBe(false);
    run.potions = ['berry', 'berry', 'berry'];
    expect(buyPotion(run, 1)).toBe(false);
  });

  it('물약이 생기기 전에 저장한 판도 빈 칸으로 이어 한다', () => {
    const run = createRun({ seed: 9, levels: {} });
    const old = JSON.parse(JSON.stringify(run));
    delete old.potions;
    expect(normalizeMeta({ ...createMeta(), run: old }).run?.potions).toEqual([]);
    const broken = { ...JSON.parse(JSON.stringify(run)), potions: ['berry', 'nope', 'fire', 'cloud', 'star'] };
    expect(normalizeMeta({ ...createMeta(), run: broken }).run?.potions).toEqual(['berry', 'fire', 'cloud']);
  });
});

describe('판 밖', () => {
  it('끝난 판을 넣으면 구름 조각과 최고 기록, 판 수가 늘고 하던 판이 지워진다', () => {
    const run = createRun({ seed: 3, levels: {} });
    autoplay(run);
    const meta = settleRun({ ...createMeta(), run }, run);
    expect(meta.shards).toBe(shardsFor(run));
    expect(meta.best).toBe(floorsCleared(run));
    expect(meta.runs).toBe(1);
    expect(meta.run).toBeNull();
  });

  it('강화는 조각이 있어야 사고, 다 올리면 더 살 수 없다', () => {
    const meta = { ...createMeta(), shards: 1000 };
    let next = meta;
    for (let i = 0; i < 10; i += 1) next = buyUpgrade(next, 'choice');
    expect(next.levels.choice).toBe(1);
    expect(next.shards).toBe(1000 - UPGRADES.choice.costs[0]);
    expect(buyUpgrade(createMeta(), 'hp')).toEqual(createMeta());
  });

  it('망가진 저장은 처음 상태로 읽는다', () => {
    expect(normalizeMeta(null)).toEqual(createMeta());
    expect(normalizeMeta({ shards: -5, levels: { hp: 99 }, run: { nope: 1 } })).toMatchObject({ shards: 0, levels: { hp: 4 }, run: null });
  });

  it('하던 판은 저장했다 읽어도 그대로다', () => {
    const run = createRun({ seed: 9, levels: {} });
    chooseNode(run, 0);
    const meta = normalizeMeta(JSON.parse(JSON.stringify({ ...createMeta(), run })));
    expect(meta.run).toEqual(run);
  });

  it('기록은 마친 층으로 적는다', () => {
    expect(recordLabel(700)).toBe('최고 7층');
    expect(recordLabel(TOP_FLOOR * 100 + 500)).toBe('꼭대기 도착');
  });
});
