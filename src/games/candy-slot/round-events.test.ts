import { describe, expect, it } from 'vitest';
import { seededRandom } from '../../core/stages';
import { dailySeed } from './daily';
import { piecesFor } from './perks';
import { eventHeadline, eventLine, eventName, eventTag, REWARD_TEXT } from './round-event-text';
import {
  BOSS_EVERY,
  BOSSES,
  bossPiecesOf,
  drawEvent,
  EVENT_FROM,
  EVENTS,
  hasEvent,
  isBossRound,
  PICKABLE_SYMBOLS,
  REWARD_OFFERS,
  ruleOf,
  SEVEN,
  type RoundEvent,
  type RoundEventId,
} from './round-events';
import {
  BASE_SPINS,
  buy,
  canHold,
  centerWildOf,
  claimReward,
  CELLS,
  CENTER,
  charmOf,
  discard,
  drawOffers,
  HOLDS_PER_ROUND,
  levelOf,
  LINES,
  MISS_COIN,
  newRun,
  nextRound,
  randomOf,
  rewardBlock,
  rollGrid,
  ruleAt,
  scoreSpin,
  settleRound,
  SLOTS,
  spin,
  spinsOf,
  SYMBOLS,
  takePieces,
  targetFor,
  targetOf,
  valuesOf,
  weightsOf,
  WILD,
  type RunState,
} from './rules';
import { packRun, readRun, RUN_VERSION } from './save';

const [CHERRY, CLOVER, BELL, HORSESHOE] = [0, 1, 2, 3];
/** 한 줄도 맞지 않는 판 */
const MISS_GRID = [CHERRY, CLOVER, BELL, CLOVER, BELL, CHERRY, HORSESHOE, CHERRY, CLOVER];
/** 아홉 칸이 다 체리인 판: 여덟 줄이 다 맞는다. */
const ALL_CHERRY = Array.from({ length: CELLS }, () => CHERRY);
const PLAIN = { last: false, afterMiss: false } as const;
const steady = (): number => 0.37;

/** 그 라운드를 돌리고 있는 판(이벤트가 걸려 있다) */
function playing(event: RoundEvent | undefined, extra: Partial<RunState> = {}): RunState {
  return { ...newRun(), round: event?.round ?? 3, event, ...extra };
}

/** 그 라운드 바로 앞의 가게: 가게를 닫으면 그 라운드가 시작된다. */
function shopBefore(event: RoundEvent, extra: Partial<RunState> = {}): RunState {
  return {
    ...newRun(),
    phase: 'shop',
    round: event.round - 1,
    spinsLeft: 0,
    shop: { offers: [], rerollCost: 2 },
    spinCount: 6,
    drawCount: 1,
    event,
    ...extra,
  };
}

const at = (id: RoundEventId, symbol?: number, round = 3): RoundEvent =>
  symbol === undefined ? { id, round } : { id, round, symbol };

/** 주아 글꼴에 들어 있는 한글: KS X 1001의 완성형 2,350자 */
function fontSyllables(): Set<string> {
  const decoder = new TextDecoder('euc-kr');
  const syllables = new Set<string>();
  for (let lead = 0xb0; lead <= 0xc8; lead += 1) {
    for (let trail = 0xa1; trail <= 0xfe; trail += 1) syllables.add(decoder.decode(new Uint8Array([lead, trail])));
  }
  return syllables;
}

/** 모든 이벤트(그림을 고르는 것은 그림마다) */
function everyEvent(round = 3): RoundEvent[] {
  return [...EVENTS, ...BOSSES].flatMap((info) => {
    const at = info.boss ? BOSS_EVERY : round;
    if (!info.picksSymbol) return [{ id: info.id, round: at }];
    return Array.from({ length: PICKABLE_SYMBOLS }, (_, symbol) => ({ id: info.id, round: at, symbol }));
  });
}

describe('이벤트의 목록', () => {
  it('7과 고르는 그림의 번호가 규칙과 같다', () => {
    expect(SEVEN).toBe(WILD);
    expect(PICKABLE_SYMBOLS).toBe(WILD);
    expect(PICKABLE_SYMBOLS).toBeLessThan(SYMBOLS.length);
  });

  it('여느 이벤트는 여덟 가지 남짓이고, 좋은 것과 나쁜 것과 비트는 것이 섞여 있다. 대장은 모두 사납다', () => {
    expect(EVENTS.length).toBeGreaterThanOrEqual(8);
    for (const tone of ['good', 'bad', 'twist'] as const) {
      expect(EVENTS.some((info) => info.tone === tone), tone).toBe(true);
    }
    expect(EVENTS.every((info) => !info.boss)).toBe(true);
    expect(BOSSES.length).toBeGreaterThanOrEqual(3);
    expect(BOSSES.every((info) => info.boss && info.tone === 'bad')).toBe(true);
    expect(new Set([...EVENTS, ...BOSSES].map((info) => info.id)).size).toBe(EVENTS.length + BOSSES.length);
  });

  it('첫 라운드에는 이벤트가 없고, 다섯째 라운드마다 대장이, 나머지에는 여느 이벤트가 걸린다', () => {
    expect(EVENT_FROM).toBe(2);
    expect(drawEvent(1, steady)).toBeUndefined();
    const random = seededRandom('events');
    for (let round = 2; round <= 40; round += 1) {
      const event = drawEvent(round, random);
      expect(event?.round).toBe(round);
      const boss = BOSSES.some((info) => info.id === event?.id);
      expect(boss, `${round}`).toBe(round % 5 === 0);
      expect(isBossRound(round)).toBe(round % 5 === 0);
      expect(hasEvent(round)).toBe(true);
    }
  });

  it('뽑기는 표의 모든 이벤트와 모든 그림을 고르게 낸다', () => {
    const random = seededRandom('spread');
    const seen = new Map<string, number>();
    for (let n = 0; n < 9_000; n += 1) {
      const event = drawEvent(3, random)!;
      seen.set(event.id, (seen.get(event.id) ?? 0) + 1);
      if (event.symbol !== undefined) {
        expect(event.symbol).toBeGreaterThanOrEqual(0);
        expect(event.symbol).toBeLessThan(PICKABLE_SYMBOLS);
      }
    }
    for (const info of EVENTS) expect(seen.get(info.id), info.id).toBeGreaterThan(700);
  });

  it('글은 글꼴에 든 한글만 쓰고, 이름은 "다음"을 붙여도 라운드 아래 표에 들어갈 만큼 짧다', () => {
    const known = fontSyllables();
    const texts = everyEvent().flatMap((event) => [
      eventName(event),
      eventLine(event),
      eventTag(event, true),
      eventTag(event, false),
      eventHeadline(event),
    ]);
    texts.push(REWARD_TEXT.title, REWARD_TEXT.guide, REWARD_TEXT.free, REWARD_TEXT.full, REWARD_TEXT.pieces(12));
    texts.push(REWARD_TEXT.took(12));
    for (const text of texts) {
      expect(text).not.toContain('—');
      for (const letter of text.match(/[ㄱ-ㆎ가-힣]/g) ?? []) expect(known.has(letter), `"${letter}" in "${text}"`).toBe(true);
    }
    for (const event of everyEvent()) {
      const syllables = (eventName(event).match(/[가-힣]/g) ?? []).length;
      expect(syllables, eventName(event)).toBeLessThanOrEqual(5);
      // 기계 위에 한 줄로 뜬다.
      expect(eventLine(event).length, eventLine(event)).toBeLessThanOrEqual(22);
    }
  });

  it('설명의 수는 규칙의 수에서 나온다', () => {
    expect(eventLine(at('gold', CHERRY))).toBe('체리 상금이 두 배예요');
    expect(eventLine(at('lucky', BELL))).toBe('종 그림이 자주 나와요');
    expect(eventLine(at('bonus'))).toBe(`이번 라운드는 두 번 더 돌려요`);
    expect(eventLine(at('short'))).toBe('한 번 덜 돌리고 목표가 25% 낮아요');
    expect(eventLine(at('heavy'))).toBe(`목표가 ${ruleOf(at('heavy')).targetRate! - 100}% 높아요`);
    expect(eventLine(at('greed', undefined, 5))).toBe(`목표가 ${ruleOf(at('greed', undefined, 5)).targetRate! - 100}% 높아요`);
    expect(eventLine(at('slow', undefined, 5))).toBe('두 번 덜 돌려요');
    expect(ruleOf(at('center')).centerWild).toBe(0.5);
    expect(eventTag(at('no-diag'), true)).toBe('다음 대각선 휴일');
    expect(eventTag(at('lock', undefined, 5), false)).toBe('대장 잠금 도깨비');
  });
});

describe('이벤트가 하는 일', () => {
  it('없는 이벤트나 다른 라운드의 이벤트는 아무것도 바꾸지 않는다', () => {
    const run = playing(undefined);
    expect(ruleAt(run, 3)).toEqual({});
    expect(ruleAt({ event: at('heavy', undefined, 4) }, 3)).toEqual({});
    expect(targetFor({ relics: {}, event: at('heavy', undefined, 4) }, 3)).toBe(targetOf(3));
  });

  it('황금: 고른 그림의 상금이 두 배다(부적까지 더한 상금에 곱한다)', () => {
    const rule = ruleOf(at('gold', CHERRY));
    expect(valuesOf([], rule)[CHERRY]).toBe(SYMBOLS[CHERRY].value * 2);
    expect(valuesOf(['gold-cherry'], rule)[CHERRY]).toBe((SYMBOLS[CHERRY].value + 4) * 2);
    expect(valuesOf([], rule)[CLOVER]).toBe(SYMBOLS[CLOVER].value);
    const plain = scoreSpin(ALL_CHERRY, [], PLAIN);
    expect(scoreSpin(ALL_CHERRY, [], { ...PLAIN, rule }).total).toBe(plain.total * 2);
  });

  it('풍년: 고른 그림이 더 자주 나온다', () => {
    const rule = ruleOf(at('lucky', HORSESHOE));
    const weights = weightsOf([], rule);
    expect(weights[HORSESHOE]).toBe(SYMBOLS[HORSESHOE].weight + 20);
    expect(weights[CHERRY]).toBe(SYMBOLS[CHERRY].weight);
  });

  it('넉넉한 날과 짧은 라운드와 느림보 거북: 그 라운드에 돌리는 횟수가 바뀐다', () => {
    expect(nextRound(shopBefore(at('bonus'))).spinsLeft).toBe(BASE_SPINS + 2);
    expect(nextRound(shopBefore(at('short'))).spinsLeft).toBe(BASE_SPINS - 1);
    expect(nextRound(shopBefore(at('slow', undefined, 5))).spinsLeft).toBe(BASE_SPINS - 2);
    expect(nextRound(shopBefore(at('slow', undefined, 5), { charms: ['extra'] })).spinsLeft).toBe(BASE_SPINS + 3 - 2);
    // 가게의 목표 카드에도 다음 라운드의 횟수가 적힌다.
    expect(spinsOf([], ruleOf(at('bonus')))).toBe(BASE_SPINS + 2);
    // 이벤트는 그 라운드에만 듣는다.
    const after = nextRound({ ...nextRound(shopBefore(at('bonus'))), phase: 'shop', shop: { offers: [], rerollCost: 2 } });
    expect(after.spinsLeft).toBe(BASE_SPINS);
  });

  it('짧은 라운드와 무거운 목표와 욕심 너구리: 그 라운드의 목표가 바뀐다', () => {
    expect(targetFor({ relics: {}, event: at('short') }, 3)).toBe(Math.round(targetOf(3) * 0.75));
    expect(targetFor({ relics: {}, event: at('heavy') }, 3)).toBe(Math.round(targetOf(3) * 1.2));
    expect(targetFor({ relics: {}, event: at('greed', undefined, 5) }, 5)).toBe(Math.round(targetOf(5) * 1.25));
    // 목표를 채우지 못하면 끝난다: 무거운 목표에서는 여느 목표만큼으로는 모자란다.
    const run = playing(at('heavy'), { spinsLeft: 0, coin: targetOf(3) });
    expect(settleRound(run, steady)?.cleared).toBe(false);
    expect(settleRound({ ...run, coin: targetFor(run, 3) }, steady)?.cleared).toBe(true);
  });

  it('가운데 행운: 가운데 칸이 둘에 한 번 7이고, 부적의 가운데 7과 따로 따진다', () => {
    const rule = ruleOf(at('center'));
    expect(centerWildOf([], rule)).toBe(0.5);
    expect(centerWildOf(['middle'], rule)).toBeCloseTo(1 - 0.65 * 0.5);
    // 가운데 칸을 뽑기 전에 먼저 따지는 수가 0.5보다 작으면 7이다.
    const grid = rollGrid([], () => 0.2, rule);
    expect(grid[CENTER]).toBe(WILD);
    expect(rollGrid([], () => 0.6, rule)[CENTER]).not.toBe(WILD);
  });

  it('자물쇠 풀림과 잠금 도깨비: 그 라운드에 잠글 수 있는 횟수가 바뀐다', () => {
    expect(nextRound(shopBefore(at('holds'))).holdsLeft).toBe(HOLDS_PER_ROUND + 2);
    const locked = nextRound(shopBefore(at('lock', undefined, 5)));
    expect(locked.holdsLeft).toBe(0);
    const spun = spin(locked, steady)!.run;
    expect(canHold(spun)).toBe(false);
    // 열을 골라도 잠기지 않는다: 첫 열까지 새로 돌아서 아홉 칸이 다 7이 된다.
    expect(spun.lastGrid?.every((symbol) => symbol === WILD)).toBe(false);
    const held = spin(spun, () => 0.99, 0)!;
    expect(held.outcome.grid.every((symbol) => symbol === WILD)).toBe(true);
  });

  it('대각선 휴일: 대각선은 맞아도 맞은 줄로 치지 않는다', () => {
    const rule = ruleOf(at('no-diag'));
    const outcome = scoreSpin(ALL_CHERRY, [], { ...PLAIN, rule });
    expect(outcome.wins).toHaveLength(LINES.length - 2);
    expect(outcome.wins.every((win) => LINES[win.line].kind !== 'diag')).toBe(true);
    expect(outcome.jackpot).toBe(false);
    // 대각선만 맞은 판은 꽝이다.
    const diagonal = [CHERRY, CLOVER, BELL, CLOVER, CHERRY, HORSESHOE, BELL, HORSESHOE, CHERRY];
    expect(scoreSpin(diagonal, [], PLAIN).wins).toHaveLength(1);
    expect(scoreSpin(diagonal, [], { ...PLAIN, rule }).wins).toHaveLength(0);
  });

  it('빈손의 날: 꽝이면 위로 금화(부적의 것까지)를 받지 않는다', () => {
    const rule = ruleOf(at('no-miss'));
    expect(scoreSpin(MISS_GRID, [], PLAIN).total).toBe(MISS_COIN);
    expect(scoreSpin(MISS_GRID, [], { ...PLAIN, rule }).total).toBe(0);
    expect(scoreSpin(MISS_GRID, ['comfort'], { ...PLAIN, rule }).total).toBe(0);
  });

  it('7 도둑 까치: 7이 하나도 나오지 않고, 가운데 7 부적도 듣지 않는다', () => {
    const rule = ruleOf(at('thief', undefined, 5));
    expect(weightsOf(['more-seven'], rule)[WILD]).toBe(0);
    expect(centerWildOf(['middle+++'], rule)).toBe(0);
    const random = seededRandom('thief');
    for (let n = 0; n < 300; n += 1) expect(rollGrid(['middle+++', 'more-seven'], random, rule)).not.toContain(WILD);
  });

  it('spin은 지금 라운드의 이벤트를 쓴다', () => {
    const random = (): number => 0;
    const plain = spin(playing(undefined), random)!;
    const gold = spin(playing(at('gold', CHERRY)), random)!;
    expect(gold.outcome.grid).toEqual(plain.outcome.grid);
    expect(gold.outcome.total).toBe(plain.outcome.total * 2);
  });
});

describe('라운드를 넘길 때', () => {
  it('가게를 열면서 다음 라운드의 이벤트를 뽑고, 가게의 부적은 그 앞에 뽑은 그대로다', () => {
    const run = playing(undefined, { round: 2, spinsLeft: 0, coin: 999 });
    const random = seededRandom('settle');
    const settled = settleRound(run, random)!;
    expect(settled.run.event?.round).toBe(3);
    // 가게의 부적은 이벤트를 뽑기 전에 같은 운으로 뽑는다.
    expect(settled.run.shop?.offers).toEqual(drawOffers(run.charms, seededRandom('settle')));
    expect(settled.run.reward).toBeUndefined();
  });

  it('대장 라운드를 넘기면 한 단계 강화한, 아직 붙이지 않은 서로 다른 부적 세 장이 상으로 나온다', () => {
    const run = playing(at('greed', undefined, 5), { spinsLeft: 0, coin: 9_999, charms: ['wide', 'tall'] });
    const settled = settleRound(run, seededRandom('boss'))!;
    const reward = settled.run.reward!;
    expect(reward).toHaveLength(REWARD_OFFERS);
    expect(new Set(reward).size).toBe(REWARD_OFFERS);
    for (const id of reward) {
      expect(charmOf(id), id).toBeDefined();
      expect(levelOf(id)).toBe(1);
      expect(['wide+', 'tall+']).not.toContain(id);
    }
    expect(settled.run.event?.round).toBe(6);
  });

  it('상의 부적을 고르면 공짜로 붙고, 상은 사라진다', () => {
    const shop = { ...shopBefore(at('heavy', undefined, 6)), round: 5, coin: 3, reward: ['tall+', 'crown+', 'piggy+'] };
    expect(rewardBlock(shop, 1)).toBeNull();
    const claimed = claimReward(shop, 1);
    expect(claimed.charms).toEqual(['crown+']);
    expect(claimed.coin).toBe(3);
    expect(claimed.reward).toBeUndefined();
    expect(claimReward(claimed, 0)).toBe(claimed);
    // 상을 고른 뒤에는 여느 가게다.
    expect(buy({ ...claimed, coin: 99, shop: { offers: ['wide'], rerollCost: 2 } }, 0).charms).toEqual(['crown+', 'wide']);
  });

  it('자리가 다 찼으면 고를 수 없고, 부적을 떼면 고를 수 있다. 조각을 대신 골라도 된다', () => {
    const charms = ['wide', 'more-cherry', 'gold-cherry', 'twins', 'finale'];
    expect(charms).toHaveLength(SLOTS);
    const shop = { ...shopBefore(at('heavy', undefined, 6)), round: 5, charms, reward: ['tall+', 'crown+', 'piggy+'] };
    expect(rewardBlock(shop, 0)).toBe('full');
    expect(claimReward(shop, 0)).toBe(shop);
    const freed = discard(shop, 0);
    expect(claimReward(freed, 0).charms).toEqual([...charms.slice(1), 'tall+']);
    const took = takePieces(shop);
    expect(took.reward).toBeUndefined();
    expect(took.bonusPieces).toBe(bossPiecesOf(5));
    expect(takePieces(took)).toBe(took);
  });

  it('상을 고르지 않고 가게를 닫으면 조각을 고른 것이고, 조각은 판이 끝날 때 함께 받는다', () => {
    const shop = { ...shopBefore(at('heavy', undefined, 11)), round: 10, bonusPieces: bossPiecesOf(5), reward: ['tall+'] };
    const next = nextRound(shop);
    expect(next.reward).toBeUndefined();
    expect(next.bonusPieces).toBe(bossPiecesOf(5) + bossPiecesOf(10));
    expect(bossPiecesOf(10)).toBeGreaterThan(bossPiecesOf(5));
    const over = settleRound({ ...next, spinsLeft: 0, coin: 0 }, steady)!.run;
    expect(piecesFor(over)).toBe(10 + bossPiecesOf(5) + bossPiecesOf(10));
  });
});

describe('오늘의 판의 이벤트', () => {
  const never = (): number => {
    throw new Error('오늘의 판은 밖에서 준 운을 쓰지 않는다');
  };

  /** 정해진 운으로 끝까지 한다. pick번째 부적을 사고, 상은 첫 부적(자리가 없으면 조각)을 고른다. */
  function play(seed: string, pick: number): { events: (RoundEvent | undefined)[]; rewards: string[][]; run: RunState } {
    const events: (RoundEvent | undefined)[] = [];
    const rewards: string[][] = [];
    let run = newRun(seed);
    while (run.phase !== 'over' && run.round <= 30) {
      while (run.spinsLeft > 0) run = spin(run, randomOf(run, 'spin', never))!.run;
      const settled = settleRound(run, randomOf(run, 'shop', never))!;
      run = settled.run;
      if (run.phase !== 'shop') break;
      events.push(run.event);
      if (run.reward) {
        rewards.push([...run.reward]);
        run = rewardBlock(run, 0) === null ? claimReward(run, 0) : takePieces(run);
      }
      run = nextRound(buy(run, pick));
    }
    return { events, rewards, run };
  }

  it('같은 씨앗이면 이벤트와 대장과 상이 누구에게나 같다', () => {
    const seed = dailySeed(20_773);
    const a = play(seed, 0);
    const b = play(seed, 0);
    expect(a.events.length).toBeGreaterThan(2);
    expect(b.events).toEqual(a.events);
    expect(b.rewards).toEqual(a.rewards);
    expect(b.run).toEqual(a.run);
  });

  it('라운드의 이벤트는 씨앗과 라운드로만 정해진다: 무엇을 사든 같다', () => {
    const seed = dailySeed(20_774);
    const a = play(seed, 0);
    const b = play(seed, 2);
    const shared = Math.min(a.events.length, b.events.length);
    expect(shared).toBeGreaterThan(1);
    expect(b.events.slice(0, shared)).toEqual(a.events.slice(0, shared));
  });

  it('이벤트는 따로 센 운으로 뽑아서, 가게의 운은 이벤트가 생기기 전과 같은 차례로 쓰인다', () => {
    const seed = dailySeed(20_775);
    const run = { ...newRun(seed), spinsLeft: 0, coin: 999, drawCount: 4 };
    const settled = settleRound(run, randomOf(run, 'shop', never))!;
    expect(settled.run.shop?.offers).toEqual(drawOffers([], seededRandom(`${seed}:shop:4`)));
    expect(settled.run.event).toEqual(drawEvent(2, seededRandom(`${seed}:event:2`)));
  });
});

describe('이벤트가 있는 판의 저장', () => {
  /** 세이브에 적혔다가 읽힌 것처럼 글자로 바꿨다가 되돌린다. */
  const roundTrip = (run: RunState): RunState | null => readRun(JSON.parse(JSON.stringify(packRun(run))));

  it('이벤트, 상, 고른 조각이 든 판을 그대로 읽는다', () => {
    const spinning = { ...nextRound(shopBefore(at('bonus'))), spinCount: 7, spinsLeft: BASE_SPINS + 2 };
    expect(roundTrip(spinning)).toEqual(spinning);
    const gold = { ...nextRound(shopBefore(at('gold', BELL))), spinCount: 7 };
    expect(roundTrip(gold)).toEqual(gold);
    const holds = { ...nextRound(shopBefore(at('holds'))), spinCount: 7 };
    expect(holds.holdsLeft).toBe(HOLDS_PER_ROUND + 2);
    expect(roundTrip(holds)).toEqual(holds);
    const reward = { ...shopBefore(at('heavy', undefined, 6)), round: 5, reward: ['tall+', 'crown+'], bonusPieces: 4 };
    expect(roundTrip(reward)).toEqual(reward);
  });

  it('이벤트가 생기기 전에 저장한 판(버전 1, 이벤트 칸이 없다)도 그대로 읽고, 다음 라운드부터 이벤트가 걸린다', () => {
    expect(RUN_VERSION).toBe(1);
    const old = {
      version: 1,
      run: {
        phase: 'shop',
        round: 3,
        spinsLeft: 0,
        coin: 20,
        earned: 60,
        charms: ['wide'],
        shop: { offers: ['tall', null, 'piggy'], rerollCost: 2 },
        afterMiss: false,
        bestSpin: 12,
        lastGrid: [0, 1, 2, 3, 4, 5, 0, 1, 2],
        holdsLeft: 0,
        seed: null,
        spinCount: 18,
        drawCount: 3,
        perks: [],
        relics: {},
      },
    };
    const run = readRun(old)!;
    expect(run).not.toBeNull();
    expect(run.event).toBeUndefined();
    expect(run.reward).toBeUndefined();
    expect(piecesFor(run)).toBe(3);
    // 이벤트 없이 다음 라운드를 하고, 그 라운드를 넘기면 이벤트가 걸린다.
    const next = nextRound(run);
    expect(next.spinsLeft).toBe(BASE_SPINS);
    const settled = settleRound({ ...next, spinsLeft: 0, coin: 999 }, steady)!;
    expect(settled.run.event?.round).toBe(5);
  });

  it('규칙으로 나올 수 없는 이벤트와 상은 판째로 버린다', () => {
    const base = { ...nextRound(shopBefore(at('bonus'))), spinCount: 7 };
    const bad = (run: object): RunState | null => readRun({ version: RUN_VERSION, run });
    expect(bad({ ...base, event: { id: 'nope', round: 3 } })).toBeNull();
    expect(bad({ ...base, event: { id: 'bonus', round: 4 } })).toBeNull();
    expect(bad({ ...base, event: { id: 'lock', round: 3 } })).toBeNull();
    expect(bad({ ...base, event: { id: 'bonus', round: 3, symbol: 1 } })).toBeNull();
    expect(bad({ ...base, event: { id: 'gold', round: 3 } })).toBeNull();
    expect(bad({ ...base, event: { id: 'gold', round: 3, symbol: WILD } })).toBeNull();
    expect(bad({ ...base, spinsLeft: BASE_SPINS + 3 })).toBeNull();
    expect(bad({ ...base, event: undefined, spinsLeft: BASE_SPINS + 2 })).toBeNull();
    expect(bad({ ...base, holdsLeft: HOLDS_PER_ROUND + 1 })).toBeNull();
    expect(bad({ ...base, bonusPieces: -1 })).toBeNull();
    // 상은 대장 라운드를 넘기고 연 가게에만 있고, 한 단계 강화한 붙이지 않은 부적이다.
    const shop = { ...shopBefore(at('heavy', undefined, 6)), round: 5, charms: ['wide'] };
    expect(bad({ ...shop, reward: ['tall+'] })).not.toBeNull();
    expect(bad({ ...shop, reward: ['tall'] })).toBeNull();
    expect(bad({ ...shop, reward: ['wide+'] })).toBeNull();
    expect(bad({ ...shop, reward: ['tall+', 'tall+'] })).toBeNull();
    expect(bad({ ...shop, reward: [] })).toBeNull();
    expect(bad({ ...shopBefore(at('heavy', undefined, 4)), reward: ['tall+'] })).toBeNull();
    expect(bad({ ...base, reward: ['tall+'] })).toBeNull();
  });
});
