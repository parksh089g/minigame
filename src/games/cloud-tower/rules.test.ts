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
  RELICS,
  RELIC_MAX,
  relicCost,
  type CardId,
  type EnemyId,
} from './data';
import {
  buyRelic,
  buyUpgrade,
  canBuyAny,
  shardsFor as shardsOf,
  chooseNode,
  choicesFor,
  createMeta,
  createRun,
  finishNode,
  floorsCleared,
  normalizeMeta,
  recordLabel,
  runScore,
  settleRun,
  shardsFor,
  type RunState,
} from './run';
import { cardLines, cardName, CODEX_TEXT, moveText, MAP_TEXT } from './text';
import { ACHIEVEMENTS, canClaim, claimAchievement, claimableCount } from './achievements';
import { DIFFICULTY_RULES, DIFFICULTY_TEXT, MAX_DIFFICULTY } from './difficulty';

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
    CODEX_TEXT.title,
    CODEX_TEXT.unknown,
    CODEX_TEXT.claimed,
    CODEX_TEXT.claim(10),
    CODEX_TEXT.reward(10),
    CODEX_TEXT.hp(10, 12),
    ...CODEX_TEXT.tabs,
    ...CODEX_TEXT.hints,
    ...CODEX_TEXT.count,
    '받은 업적',
    ...Object.values(RELICS).flatMap((def) => [def.name, def.blurb, def.effect(0), def.effect(10)]),
    '다 올림',
    '강화',
    '유물',
    '유물은 열 단계까지 조금씩 세져요',
    ...ACHIEVEMENTS.flatMap((item) => [item.name, item.blurb]),
    ...DIFFICULTY_RULES.map((rule) => rule.text),
    ...Array.from({ length: MAX_DIFFICULTY + 1 }, (_, level) => [DIFFICULTY_TEXT.name(level), DIFFICULTY_TEXT.blurb(level), DIFFICULTY_TEXT.bonus(level)]).flat(),
    DIFFICULTY_TEXT.hint,
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

describe('도감과 업적', () => {
  it('싸움에서 만난 적과 보상에 나온 카드를 판에 적고, 판이 끝나면 도감과 물리친 수에 옮긴다', () => {
    const run = createRun({ seed: 3, levels: {} });
    chooseNode(run, 0);
    const foes = run.battle?.foes.map((foe) => foe.id) ?? [];
    expect(run.met.foes).toEqual([...new Set(foes)]);
    run.stats.kills = 4;
    run.met.cards.push(CARD_IDS[20]);
    run.treasures.push('honey');
    const meta = settleRun(createMeta(), run);
    expect(meta.codex.foes).toEqual(run.met.foes);
    expect(meta.codex.cards).toEqual(expect.arrayContaining([...run.deck.map((card) => card.id), ...run.met.cards]));
    expect(meta.codex.treasures).toEqual(['honey']);
    expect(meta.kills).toBe(4);
  });

  it('저장한 도감에서 모르는 이름과 겹친 이름은 버린다', () => {
    const meta = normalizeMeta({ codex: { cards: ['zap', CARD_IDS[0], CARD_IDS[0]], foes: ['ghost'], treasures: 'honey' }, claimed: ['boss1', 3] });
    expect(meta.codex).toEqual({ cards: [CARD_IDS[0]], foes: [], treasures: [] });
    expect(meta.claimed).toEqual(['boss1']);
  });

  it('다 채운 업적은 한 번만 조각을 받는다', () => {
    const meta = { ...createMeta(), best: 7, shards: 5 };
    const boss1 = ACHIEVEMENTS.find((item) => item.id === 'boss1')!;
    expect(canClaim(meta, boss1)).toBe(true);
    expect(claimableCount(meta)).toBe(1);
    const after = claimAchievement(meta, 'boss1');
    expect(after.shards).toBe(5 + boss1.reward);
    expect(claimAchievement(after, 'boss1')).toBe(after);
    expect(claimAchievement(meta, 'top')).toBe(meta);
  });
});

describe('유물', () => {
  it('단계를 올릴수록 값이 오르고, 열 단계에서 멈춘다. 다 올리려면 조각이 아주 많이 든다', () => {
    let total = 0;
    for (let level = 0; level < RELIC_MAX; level += 1) total += relicCost(level) ?? 0;
    expect(relicCost(RELIC_MAX)).toBeNull();
    expect(total * Object.keys(RELICS).length).toBeGreaterThanOrEqual(1500);
    let meta = { ...createMeta(), shards: 10_000 };
    for (let i = 0; i < RELIC_MAX + 3; i += 1) meta = buyRelic(meta, 'seed');
    expect(meta.relics.seed).toBe(RELIC_MAX);
    expect(meta.shards).toBe(10_000 - total);
    expect(buyRelic({ ...createMeta(), shards: 9 }, 'seed').relics).toEqual({});
    expect(canBuyAny({ ...createMeta(), shards: 10, levels: { hp: 4, gold: 3, rest: 2, choice: 1, relic: 1, pack1: 1, pack2: 1 } })).toBe(true);
  });

  it('판을 시작할 때의 단계가 체력, 첫 차례 방어, 가게 값, 받는 조각에 듣는다', () => {
    const plain = createRun({ seed: 9, levels: {} });
    const strong = createRun({ seed: 9, levels: {}, relics: { seed: 3, shell: 4, net: 10, coupon: 10 } });
    expect(strong.maxHp).toBe(plain.maxHp + 6);
    chooseNode(plain, 0);
    chooseNode(strong, 0);
    expect((strong.battle?.me.block ?? 0) - (plain.battle?.me.block ?? 0)).toBe(4);
    for (const run of [plain, strong]) {
      run.floor = 3;
      run.stats.bosses = 1;
    }
    expect(shardsOf(strong)).toBe(Math.floor(shardsOf(plain) * 1.5));
  });

  it('저장한 유물에서 모르는 이름과 범위 밖의 단계는 고친다', () => {
    const meta = normalizeMeta({ relics: { seed: 99, ghost: 3, net: -1, acorn: 2.7 } });
    expect(meta.relics).toEqual({ seed: RELIC_MAX, acorn: 2 });
  });
});

describe('난이도', () => {
  /** 봇으로 꼭대기까지 오른 판을 하나 찾는다. */
  const winningRun = (difficulty: number): RunState => {
    const full = { hp: 4, gold: 3, rest: 2, choice: 1, relic: 1, pack1: 1, pack2: 1 };
    for (let seed = 1; seed < 400; seed += 1) {
      const run = createRun({ seed, levels: full, difficulty });
      autoplay(run);
      if (run.result === 'win') return run;
    }
    throw new Error('꼭대기까지 오른 판이 없다');
  };

  it('규칙마다 한 줄이 있고, 화면에 들어가게 짧다', () => {
    expect(MAX_DIFFICULTY).toBe(DIFFICULTY_RULES.length);
    for (const rule of DIFFICULTY_RULES) expect(rule.text.length).toBeLessThanOrEqual(22);
  });

  it('난이도가 오를수록 처음 별사탕과 쉼터 회복이 줄어든다', () => {
    const easy = createRun({ seed: 5, levels: {} });
    const hard = createRun({ seed: 5, levels: {}, difficulty: MAX_DIFFICULTY });
    expect(hard.gold).toBe(Math.floor(easy.gold / 2));
    expect(hard.restPercent).toBe(easy.restPercent - 10);
    expect(createRun({ seed: 5, levels: {}, difficulty: 1 }).gold).toBe(easy.gold);
  });

  it('보통 적은 체력이 늘고, 마지막 난이도에서는 힘을 갖고 나온다', () => {
    const easy = createRun({ seed: 11, levels: {} });
    const hard = createRun({ seed: 11, levels: {}, difficulty: MAX_DIFFICULTY });
    chooseNode(easy, 0);
    chooseNode(hard, 0);
    const [a, b] = [easy.battle!.foes, hard.battle!.foes];
    expect(b.map((foe) => foe.id)).toEqual(a.map((foe) => foe.id));
    b.forEach((foe, index) => {
      expect(foe.maxHp).toBe(Math.round(a[index].maxHp * 1.1));
      expect(foe.hp).toBe(foe.maxHp);
      expect(foe.st.strength ?? 0).toBe((a[index].st.strength ?? 0) + 1);
    });
  });

  it('난이도 7부터 대장을 넘으면 잃은 체력의 절반만 찬다', () => {
    const run = createRun({ seed: 1, levels: {}, difficulty: 7 });
    run.floor = FLOORS_PER_ACT;
    run.stage = 'reward';
    run.maxHp = 60;
    run.hp = 20;
    finishNode(run);
    expect(run.hp).toBe(40);
  });

  it('지금 연 가장 높은 난이도로 꼭대기에 오르면 다음 난이도가 열리고, 그것을 고른다', () => {
    const run = winningRun(0);
    const meta = settleRun(createMeta(), run);
    expect(meta.unlocked).toBe(1);
    expect(meta.difficulty).toBe(1);
    // 낮은 난이도로 다시 올라도 더 열리지 않는다.
    expect(settleRun({ ...createMeta(), unlocked: 3, difficulty: 0 }, run)).toMatchObject({ unlocked: 3, difficulty: 0 });
    // 지는 판은 열지 않는다.
    const lost = createRun({ seed: 1, levels: {} });
    lost.result = 'lose';
    expect(settleRun(createMeta(), lost).unlocked).toBe(0);
  });

  it('꼭대기에 오르면 난이도마다 구름 조각을 5개 더 받는다', () => {
    const run = winningRun(0);
    const base = shardsFor(run);
    run.difficulty = 4;
    expect(shardsFor(run)).toBe(base + 20);
  });

  it('마지막 난이도보다 더 열리지 않는다', () => {
    const run = createRun({ seed: 1, levels: {}, difficulty: MAX_DIFFICULTY });
    run.result = 'win';
    run.stage = 'over';
    const meta = settleRun({ ...createMeta(), unlocked: MAX_DIFFICULTY, difficulty: MAX_DIFFICULTY }, run);
    expect(meta.unlocked).toBe(MAX_DIFFICULTY);
  });

  it('저장한 난이도는 연 것을 넘지 않고, 난이도가 없던 저장은 보통으로 읽는다', () => {
    expect(normalizeMeta({ unlocked: 2, difficulty: 6 })).toMatchObject({ unlocked: 2, difficulty: 2 });
    expect(normalizeMeta({ unlocked: 99 }).unlocked).toBe(MAX_DIFFICULTY);
    const run = createRun({ seed: 9, levels: {} });
    const old = JSON.parse(JSON.stringify(run)) as Record<string, unknown>;
    delete old.difficulty;
    const meta = normalizeMeta({ ...createMeta(), run: old });
    expect(meta.run).not.toBeNull();
    expect(shardsFor(meta.run!)).toBe(0);
  });

  it('봇은 난이도가 높을수록 덜 오른다', () => {
    const average = (difficulty: number): number => {
      let total = 0;
      for (let seed = 1; seed <= 30; seed += 1) {
        const run = createRun({ seed, levels: { hp: 4, rest: 2 }, difficulty });
        autoplay(run);
        total += floorsCleared(run);
      }
      return total / 30;
    };
    expect(average(MAX_DIFFICULTY)).toBeLessThan(average(0));
  });
});
