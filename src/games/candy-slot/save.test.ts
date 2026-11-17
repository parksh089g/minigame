import { describe, expect, it } from 'vitest';
import {
  buy,
  CHARMS,
  HOLDS_PER_ROUND,
  newRun,
  nextRound,
  randomOf,
  reroll,
  settleRound,
  PERK_IDS,
  RELIC_IDS,
  RELIC_MAX,
  SLOTS,
  spin,
  spinsOf,
  SYMBOLS,
  type RelicLevels,
  type RunState,
} from './rules';
import { PERKS, PIECES_MAX } from './perks';
import { RELIC_FULL_PRICE, relicPrice } from './relics';
import {
  createSlotSave,
  isResumable,
  normalizeSlotSave,
  packRun,
  readRun,
  RESUME_TEXT,
  resumeCaption,
  RUN_VERSION,
  savedRunOf,
  withFound,
  withPerk,
  withRelic,
  withPieces,
  withRun,
  type SavedRun,
} from './save';

/** 언제나 체리만 나오는 운. 아홉 칸이 모두 맞아서 목표를 넉넉히 채운다. */
const ALL_CHERRY = (): number => 0;

/** 주아 글꼴에 들어 있는 한글: KS X 1001의 완성형 2,350자 */
function fontSyllables(): Set<string> {
  const decoder = new TextDecoder('euc-kr');
  const syllables = new Set<string>();
  for (let lead = 0xb0; lead <= 0xc8; lead += 1) {
    for (let trail = 0xa1; trail <= 0xfe; trail += 1) {
      syllables.add(decoder.decode(new Uint8Array([lead, trail])));
    }
  }
  return syllables;
}

/** times번 돌린 판 */
function spun(run: RunState, times: number, random: () => number = ALL_CHERRY): RunState {
  let next = run;
  for (let count = 0; count < times; count += 1) {
    const result = spin(next, randomOf(next, 'spin', random));
    if (!result) throw new Error('돌릴 수 없는 판');
    next = result.run;
  }
  return next;
}

/** 첫 라운드의 스핀을 다 쓴 판(아직 맺기 전) */
function spent(seed: string | null = null): RunState {
  return spun(newRun(seed), spinsOf([]));
}

/** 첫 라운드를 넘겨 가게가 열린 판 */
function shopping(seed: string | null = null): RunState {
  const run = spent(seed);
  const settled = settleRound(run, randomOf(run, 'shop', ALL_CHERRY));
  if (!settled?.cleared) throw new Error('목표를 채우지 못했다');
  return settled.run;
}

/** 세이브에 적혔다가 읽힌 것처럼 글자로 바꿨다가 되돌린다. */
function stored(run: RunState): unknown {
  return JSON.parse(JSON.stringify(packRun(run)));
}

/** 적힌 판의 한 곳을 고친 것 */
function broken(run: RunState, patch: Record<string, unknown>): unknown {
  const saved = stored(run) as SavedRun;
  return { ...saved, run: { ...saved.run, ...patch } };
}

describe('packRun', () => {
  it('한 번도 돌리지 않은 판은 남기지 않는다', () => {
    expect(isResumable(newRun())).toBe(false);
    expect(packRun(newRun())).toBeNull();
    expect(packRun(newRun('2026-11-16'))).toBeNull();
  });

  it('끝난 판은 남기지 않는다', () => {
    const over: RunState = { ...spun(newRun(), 1), phase: 'over' };
    expect(isResumable(over)).toBe(false);
    expect(packRun(over)).toBeNull();
  });

  it('돌린 판은 버전과 함께 그대로 적는다', () => {
    const run = spun(newRun(), 2);
    const saved = packRun(run);
    expect(saved).toEqual({ version: RUN_VERSION, run });
    // 사본이라, 적은 뒤에 판이 바뀌어도 적힌 것은 그대로다.
    expect(saved?.run).not.toBe(run);
    expect(saved?.run.lastGrid).not.toBe(run.lastGrid);
  });
});

describe('readRun: 맞는 판', () => {
  it('라운드 도중의 판을 그대로 읽는다', () => {
    const run = spun(newRun(), 3);
    expect(run.lastGrid).not.toBeNull();
    expect(readRun(stored(run))).toEqual(run);
  });

  it('가게가 열린 판은 팔린 자리와 다시 뽑는 값까지 그대로 읽는다', () => {
    let run = shopping();
    run = reroll(run, randomOf(run, 'shop', ALL_CHERRY));
    const bought = buy(run, 0);
    expect(bought.charms).toHaveLength(1);
    expect(bought.shop?.offers[0]).toBeNull();
    expect(readRun(stored(bought))).toEqual(bought);
  });

  it('스핀을 다 쓰고 아직 맺지 않은 판을 읽으면 이어서 맺을 수 있다', () => {
    const run = spent();
    expect(run.spinsLeft).toBe(0);
    const restored = readRun(stored(run));
    expect(restored).toEqual(run);
    if (!restored) return;
    const settled = settleRound(restored, ALL_CHERRY);
    expect(settled?.cleared).toBe(true);
    expect(settled?.run.phase).toBe('shop');
  });

  it('다음 라운드를 막 시작한 판(아직 돌리지 않은 라운드)도 읽는다', () => {
    const run = nextRound(buy(shopping(), 1));
    expect(run.lastGrid).toBeNull();
    expect(run.round).toBe(2);
    expect(readRun(stored(run))).toEqual(run);
  });

  it('정해진 운의 판은 이어 해도 같은 운으로 이어진다', () => {
    const run = spun(newRun('2026-11-16'), 2, Math.random);
    const restored = readRun(stored(run));
    expect(restored).toEqual(run);
    if (!restored) return;
    // 이어 한 판과 두고 가지 않은 판에서, 다음 스핀과 그 뒤의 가게가 똑같이 나온다.
    const here = spun(run, spinsOf([]) - 2, Math.random);
    const there = spun(restored, spinsOf([]) - 2, Math.random);
    expect(there).toEqual(here);
    expect(settleRound(there, randomOf(there, 'shop', Math.random))).toEqual(
      settleRound(here, randomOf(here, 'shop', Math.random)),
    );
  });

  it('읽은 판은 사본이라, 고쳐도 적힌 것은 그대로다', () => {
    const raw = stored(spun(newRun(), 1)) as SavedRun;
    const restored = readRun(raw);
    expect(restored?.lastGrid).not.toBe(raw.run.lastGrid);
    expect(restored?.charms).not.toBe(raw.run.charms);
  });
});

describe('readRun: 버리는 판', () => {
  const mid = spun(newRun(), 2);
  const shop = shopping();

  it('판이 아닌 값은 버린다', () => {
    for (const raw of [undefined, null, 3, 'run', [], {}, { version: RUN_VERSION }, { version: RUN_VERSION, run: [] }]) {
      expect(readRun(raw)).toBeNull();
    }
  });

  it('버전이 다른 판은 버린다', () => {
    const saved = stored(mid) as SavedRun;
    expect(readRun({ ...saved, version: RUN_VERSION + 1 })).toBeNull();
    expect(readRun({ ...saved, version: undefined })).toBeNull();
    expect(readRun({ run: saved.run })).toBeNull();
  });

  it('끝난 판과 모르는 단계의 판은 버린다', () => {
    expect(readRun(broken(mid, { phase: 'over' }))).toBeNull();
    expect(readRun(broken(mid, { phase: 'bonus' }))).toBeNull();
    expect(readRun(broken(mid, { phase: undefined }))).toBeNull();
  });

  it('없는 부적이 붙어 있으면 버린다', () => {
    expect(readRun(broken(shop, { charms: ['wide', 'no-such-charm'] }))).toBeNull();
    expect(readRun(broken(shop, { charms: [7] }))).toBeNull();
    expect(readRun(broken(shop, { charms: 'wide' }))).toBeNull();
  });

  it('같은 부적이 두 장이거나 자리보다 많이 붙어 있으면 버린다', () => {
    expect(readRun(broken(shop, { charms: ['wide', 'wide'] }))).toBeNull();
    const many = CHARMS.slice(0, SLOTS + 1).map((charm) => charm.id);
    expect(readRun(broken(shop, { charms: many }))).toBeNull();
    // 자리를 꽉 채운 것은 괜찮다.
    expect(readRun(broken(shop, { charms: many.slice(0, SLOTS) }))).not.toBeNull();
  });

  it('수가 아니거나, 음수이거나, 정수가 아닌 값이 있으면 버린다', () => {
    const fields = ['round', 'spinsLeft', 'coin', 'earned', 'bestSpin', 'holdsLeft', 'spinCount', 'drawCount'];
    for (const field of fields) {
      for (const value of [-1, 1.5, Number.NaN, Infinity, '3', null, undefined]) {
        expect(readRun(broken(mid, { [field]: value })), `${field}: ${String(value)}`).toBeNull();
      }
    }
    expect(readRun(broken(mid, { round: 0 }))).toBeNull();
    expect(readRun(broken(mid, { afterMiss: 'yes' }))).toBeNull();
  });

  it('규칙으로는 나올 수 없는 횟수면 버린다', () => {
    expect(readRun(broken(mid, { spinsLeft: spinsOf([]) + 1 }))).toBeNull();
    expect(readRun(broken(mid, { holdsLeft: HOLDS_PER_ROUND + 1 }))).toBeNull();
    // 가게는 스핀을 다 쓴 뒤에만 열린다.
    expect(readRun(broken(shop, { spinsLeft: 1 }))).toBeNull();
    // 덤 스핀을 붙였으면 그만큼은 더 남아 있을 수 있다.
    expect(readRun(broken(mid, { charms: ['extra'], spinsLeft: spinsOf(['extra']) }))).not.toBeNull();
  });

  it('가게와 단계가 맞지 않으면 버린다', () => {
    expect(readRun(broken(shop, { shop: null }))).toBeNull();
    expect(readRun(broken(mid, { shop: shop.shop }))).toBeNull();
    expect(readRun(broken(mid, { shop: undefined }))).toBeNull();
  });

  it('가게에 없는 부적이나 같은 부적이 두 번 나와 있으면 버린다', () => {
    expect(readRun(broken(shop, { shop: { offers: ['wide', 'gone', null], rerollCost: 2 } }))).toBeNull();
    expect(readRun(broken(shop, { shop: { offers: ['wide', 'wide', null], rerollCost: 2 } }))).toBeNull();
    expect(readRun(broken(shop, { shop: { offers: ['wide', 'tall', 'slant', 'piggy'], rerollCost: 2 } }))).toBeNull();
    expect(readRun(broken(shop, { shop: { offers: 'wide', rerollCost: 2 } }))).toBeNull();
    expect(readRun(broken(shop, { shop: { offers: ['wide', 'tall', 'slant'], rerollCost: -1 } }))).toBeNull();
    expect(readRun(broken(shop, { shop: { offers: ['wide', 'tall', 'slant'] } }))).toBeNull();
    // 다 팔린 가게는 괜찮다.
    expect(readRun(broken(shop, { shop: { offers: [null, null, null], rerollCost: 4 } }))).not.toBeNull();
  });

  it('바로 앞 스핀의 판이 아홉 칸이 아니거나 없는 그림이 있으면 버린다', () => {
    expect(readRun(broken(mid, { lastGrid: [0, 1, 2] }))).toBeNull();
    expect(readRun(broken(mid, { lastGrid: [0, 1, 2, 3, 4, 5, 0, 1, SYMBOLS.length] }))).toBeNull();
    expect(readRun(broken(mid, { lastGrid: [0, 1, 2, 3, 4, 5, 0, 1, -1] }))).toBeNull();
    expect(readRun(broken(mid, { lastGrid: [0, 1, 2, 3, 4, 5, 0, 1, 0.5] }))).toBeNull();
    expect(readRun(broken(mid, { lastGrid: 'grid' }))).toBeNull();
    expect(readRun(broken(mid, { lastGrid: undefined }))).toBeNull();
  });

  it('씨앗이 글자가 아니거나 터무니없이 길면 버린다', () => {
    expect(readRun(broken(mid, { seed: 7 }))).toBeNull();
    expect(readRun(broken(mid, { seed: undefined }))).toBeNull();
    expect(readRun(broken(mid, { seed: 'x'.repeat(65) }))).toBeNull();
    expect(readRun(broken(mid, { seed: '2026-11-16' }))?.seed).toBe('2026-11-16');
  });

  it('모르는 항목은 옮기지 않는다', () => {
    const restored = readRun(broken(mid, { cheat: 999 }));
    expect(restored).toEqual(mid);
    expect(restored && 'cheat' in restored).toBe(false);
  });
});

describe('normalizeSlotSave', () => {
  it('없거나 이상한 값은 빈 도감과 판 없음이 된다', () => {
    for (const raw of [undefined, null, 'slot', 3, []]) {
      expect(normalizeSlotSave(raw)).toEqual(createSlotSave());
    }
    expect(createSlotSave()).toEqual({ found: [], run: null, pieces: 0, perks: [], relics: {} });
  });

  it('맞는 것은 그대로 둔다', () => {
    const slot = {
      found: ['piggy', 'wide'],
      run: packRun(shopping('2026-11-16')),
      pieces: 37,
      perks: ['purse', 'hold'],
      relics: { scale: 1, hammer: RELIC_MAX },
    };
    expect(slot.run).not.toBeNull();
    expect(normalizeSlotSave(JSON.parse(JSON.stringify(slot)))).toEqual(slot);
  });

  it('하던 판이 깨졌으면 판만 버리고 도감은 살린다', () => {
    const raw = { found: ['piggy', 'gone', 'piggy'], run: broken(spun(newRun(), 1), { coin: -3 }) };
    expect(normalizeSlotSave(raw)).toEqual({ found: ['piggy'], run: null, pieces: 0, perks: [], relics: {} });
  });

  it('도감이 깨졌어도 하던 판은 살린다', () => {
    const run = spun(newRun(), 1);
    expect(normalizeSlotSave({ found: 'all', run: stored(run) })).toEqual({
      found: [],
      run: packRun(run),
      pieces: 0,
      perks: [],
      relics: {},
    });
  });

  it('조각과 해금이 생기기 전의 세이브는 조각 0개와 해금 없음으로 읽는다', () => {
    const run = spun(newRun(), 1);
    expect(normalizeSlotSave({ found: ['piggy'], run: stored(run) })).toEqual({
      found: ['piggy'],
      run: packRun(run),
      pieces: 0,
      perks: [],
      relics: {},
    });
  });

  it('조각은 0 이상의 정수만 받고, 한도에서 자른다', () => {
    const piecesOf = (pieces: unknown): number => normalizeSlotSave({ found: [], run: null, pieces }).pieces;
    expect(piecesOf(0)).toBe(0);
    expect(piecesOf(57)).toBe(57);
    expect(piecesOf(PIECES_MAX)).toBe(PIECES_MAX);
    expect(piecesOf(PIECES_MAX + 1)).toBe(PIECES_MAX);
    expect(piecesOf(1e12)).toBe(PIECES_MAX);
    for (const bad of [-1, 2.5, Number.NaN, Number.POSITIVE_INFINITY, '12', null, [3], { pieces: 3 }, true]) {
      expect(piecesOf(bad), String(bad)).toBe(0);
    }
  });

  it('해금은 지금 있는 것만, 겹치지 않게, 정해진 차례로 남긴다', () => {
    const perksOf = (perks: unknown): string[] => normalizeSlotSave({ found: [], run: null, perks }).perks;
    expect(perksOf([])).toEqual([]);
    expect(perksOf(['slot', 'purse'])).toEqual(['purse', 'slot']);
    expect(perksOf(['hold', 'hold', 'nope', 3, null, 'reroll'])).toEqual(['reroll', 'hold']);
    expect(perksOf([...PERK_IDS].reverse())).toEqual([...PERK_IDS]);
    for (const bad of ['slot', { slot: true }, 4, null, true]) expect(perksOf(bad), String(bad)).toEqual([]);
  });

  it('유물은 지금 있는 것의 1부터 RELIC_MAX까지의 정수 단계만, 정해진 차례로 남긴다', () => {
    const relicsOf = (relics: unknown): RelicLevels => normalizeSlotSave({ found: [], run: null, relics }).relics;
    expect(relicsOf({})).toEqual({});
    expect(relicsOf({ jar: 2, scale: 7 })).toEqual({ scale: 7, jar: 2 });
    expect(Object.keys(relicsOf({ jar: 2, hammer: 1, seal: 3, scale: 7 }))).toEqual([...RELIC_IDS]);
    expect(relicsOf({ scale: 1, seal: RELIC_MAX })).toEqual({ scale: 1, seal: RELIC_MAX });
    // 0단계는 적지 않는다. 모르는 유물은 버리고, 맞지 않는 단계는 0단계로 본다(고쳐 쓰지 않는다).
    expect(relicsOf({ scale: 0, seal: 4, nope: 3 })).toEqual({ seal: 4 });
    for (const bad of [-1, 2.5, RELIC_MAX + 1, 1e9, Number.NaN, Number.POSITIVE_INFINITY, '3', null, [3], { level: 3 }, true]) {
      expect(relicsOf({ scale: bad, jar: 5 }), String(bad)).toEqual({ jar: 5 });
    }
    for (const bad of ['scale', ['scale'], [3, 4], 4, null, true, undefined]) expect(relicsOf(bad), String(bad)).toEqual({});
    // 물려받은 이름은 유물이 아니다.
    expect(relicsOf(Object.create({ scale: 3 }))).toEqual({});
  });

  it('유물이 생기기 전의 세이브는 유물 없음으로 읽고, 조각과 해금은 살린다', () => {
    expect(normalizeSlotSave({ found: ['piggy'], run: null, pieces: 9, perks: ['purse'] })).toEqual({
      found: ['piggy'],
      run: null,
      pieces: 9,
      perks: ['purse'],
      relics: {},
    });
  });

  it('유물을 올린 채로 시작한 판은 지금의 단계와 상관없이 그대로 읽는다', () => {
    const run = spun(newRun(null, [], { scale: 3, jar: 1 }), 1);
    const read = normalizeSlotSave({ found: [], run: stored(run), pieces: 3, relics: 'broken' });
    expect(read.relics).toEqual({});
    expect(read.run?.run.relics).toEqual({ scale: 3, jar: 1 });
  });

  it('조각이나 해금이 깨졌어도 도감과 하던 판은 살린다', () => {
    const run = spun(newRun(), 1);
    const raw = { found: ['piggy'], run: stored(run), pieces: 'many', perks: 'all' };
    expect(normalizeSlotSave(raw)).toEqual({ found: ['piggy'], run: packRun(run), pieces: 0, perks: [], relics: {} });
  });

  it('해금을 켠 채로 시작한 판은 지금 열어 둔 해금과 상관없이 그대로 읽는다', () => {
    // 여섯째 자리를 켜고 시작해 여섯 장을 붙인 판. 해금 목록이 깨져서 비어도 판은 제 해금을 적어 두고 있다.
    const six = CHARMS.slice(0, SLOTS + 1).map((charm) => charm.id);
    const run: RunState = { ...spun(newRun(null, ['slot', 'hold']), 1), charms: six };
    const read = normalizeSlotSave({ found: [], run: stored(run), pieces: 3, perks: 'broken' });
    expect(read.perks).toEqual([]);
    expect(read.run?.run.perks).toEqual(['hold', 'slot']);
    expect(read.run?.run.charms).toEqual(six);
    expect(read.run?.run.holdsLeft).toBe(HOLDS_PER_ROUND + 1);
  });

  it('이어 할 수 없는 판은 적혀 있어도 버린다', () => {
    const fresh = { version: RUN_VERSION, run: newRun() };
    expect(normalizeSlotSave({ found: [], run: fresh }).run).toBeNull();
  });
});

describe('세이브 고치기', () => {
  it('하던 판을 적고, 꺼내고, 지운다', () => {
    const empty = createSlotSave();
    const run = spun(newRun(), 2);
    const kept = withRun(empty, run);
    expect(savedRunOf(kept)).toEqual(run);
    // 원본은 그대로다.
    expect(empty.run).toBeNull();
    expect(savedRunOf(empty)).toBeNull();
    expect(withRun(kept, null).run).toBeNull();
    // 끝난 판을 적으면 지워진다.
    expect(withRun(kept, { ...run, phase: 'over' }).run).toBeNull();
  });

  it('꺼낸 판을 고쳐도 세이브는 그대로다', () => {
    const kept = withRun(createSlotSave(), spun(newRun(), 1));
    const out = savedRunOf(kept);
    out?.charms.push('wide');
    expect(savedRunOf(kept)?.charms).toEqual([]);
  });

  it('판을 적거나 지워도 도감은 그대로다', () => {
    const slot = withFound(createSlotSave(), 'piggy');
    expect(withRun(slot, spun(newRun(), 1)).found).toEqual(['piggy']);
    expect(withRun(slot, null).found).toEqual(['piggy']);
  });

  it('찾은 부적을 도감에 넣는다. 이미 찾았거나 없는 부적이면 그대로다', () => {
    const empty = createSlotSave();
    const one = withFound(empty, 'piggy');
    expect(one.found).toEqual(['piggy']);
    expect(empty.found).toEqual([]);
    expect(withFound(one, 'piggy')).toBe(one);
    expect(withFound(one, 'gone')).toBe(one);
    expect(withFound(one, 'wide').found).toEqual(['piggy', 'wide']);
  });
});

describe('조각과 해금을 세이브에 적기', () => {
  it('조각을 더한다. 더할 것이 없으면 그대로이고, 한도를 넘지 않는다', () => {
    const empty = createSlotSave();
    const some = withPieces(empty, 7);
    expect(some.pieces).toBe(7);
    expect(empty.pieces).toBe(0);
    expect(withPieces(some, 0)).toBe(some);
    expect(withPieces(some, -3)).toBe(some);
    expect(withPieces(some, 1.5)).toBe(some);
    expect(withPieces(some, PIECES_MAX * 2).pieces).toBe(PIECES_MAX);
    const full = withPieces(some, PIECES_MAX);
    expect(withPieces(full, 5)).toBe(full);
  });

  it('조각을 내고 해금을 연다. 조각이 모자라거나 이미 열었으면 그대로다', () => {
    const purse = PERKS.find((perk) => perk.id === 'purse');
    if (!purse) throw new Error('없는 해금');
    const poor = withPieces(createSlotSave(), purse.price - 1);
    expect(withPerk(poor, 'purse')).toBe(poor);
    const rich = withPieces(poor, 6);
    const opened = withPerk(rich, 'purse');
    expect(opened.perks).toEqual(['purse']);
    expect(opened.pieces).toBe(rich.pieces - purse.price);
    // 원본은 그대로다.
    expect(rich.perks).toEqual([]);
    expect(withPerk(withPieces(opened, 99), 'purse').pieces).toBe(opened.pieces + 99);
  });

  it('조각을 받거나 해금을 열어도 도감과 하던 판은 그대로이고, 판을 적거나 도감에 넣어도 조각과 해금은 그대로다', () => {
    const run = spun(newRun(), 1);
    const base = withRun(withFound(createSlotSave(), 'piggy'), run);
    const paid = withPerk(withPieces(base, 50), 'reroll');
    expect(paid.found).toEqual(['piggy']);
    expect(savedRunOf(paid)).toEqual(run);
    // 하던 판은 시작할 때의 해금 그대로다.
    expect(savedRunOf(paid)?.perks).toEqual([]);
    const later = withFound(withRun(paid, null), 'wide');
    expect(later.pieces).toBe(paid.pieces);
    expect(later.perks).toEqual(['reroll']);
  });

  it('조각을 내고 유물을 한 단계 올린다. 조각이 모자라거나 다 올렸으면 그대로다', () => {
    const first = relicPrice(0)!;
    const poor = withPieces(createSlotSave(), first - 1);
    expect(withRelic(poor, 'scale')).toBe(poor);
    const rich = withPieces(poor, 1 + relicPrice(1)!);
    const one = withRelic(rich, 'scale');
    expect(one.relics).toEqual({ scale: 1 });
    expect(one.pieces).toBe(rich.pieces - first);
    // 원본은 그대로다.
    expect(rich.relics).toEqual({});
    const two = withRelic(one, 'scale');
    expect(two.relics).toEqual({ scale: 2 });
    expect(two.pieces).toBe(0);
    expect(withRelic(two, 'scale')).toBe(two);

    // 끝까지 올리면 더 오르지 않고, 조각도 그대로다.
    let slot = withPieces(createSlotSave(), RELIC_FULL_PRICE + 30);
    for (let level = 1; level <= RELIC_MAX; level += 1) {
      slot = withRelic(slot, 'jar');
      expect(slot.relics.jar).toBe(level);
    }
    expect(slot.pieces).toBe(30);
    expect(withRelic(slot, 'jar')).toBe(slot);
  });

  it('유물을 올려도 도감과 하던 판, 해금은 그대로이고, 하던 판은 시작할 때의 단계를 따른다', () => {
    const run = spun(newRun(null, ['purse'], { seal: 2 }), 1);
    const base = withPerk(withPieces(withRun(withFound(createSlotSave(), 'piggy'), run), 60), 'purse');
    const raised = withRelic(withRelic(base, 'seal'), 'hammer');
    expect(raised.found).toEqual(['piggy']);
    expect(raised.perks).toEqual(['purse']);
    expect(raised.relics).toEqual({ seal: 1, hammer: 1 });
    expect(savedRunOf(raised)).toEqual(run);
    expect(savedRunOf(raised)?.relics).toEqual({ seal: 2 });
    const later = withFound(withRun(raised, null), 'wide');
    expect(later.relics).toEqual(raised.relics);
    expect(later.pieces).toBe(raised.pieces);
  });

  it('세이브를 문자열로 옮겼다가 읽어도 유물의 단계가 그대로다', () => {
    const slot = withRelic(withRelic(withRelic(withPieces(createSlotSave(), 100), 'jar'), 'scale'), 'jar');
    expect(slot.relics).toEqual({ scale: 1, jar: 2 });
    expect(normalizeSlotSave(JSON.parse(JSON.stringify(slot)))).toEqual(slot);
  });

  it('세이브를 문자열로 옮겼다가 읽어도 조각과 해금이 그대로다', () => {
    const slot = withPerk(withPerk(withPieces(createSlotSave(), 120), 'slot'), 'purse');
    expect(slot.perks).toEqual(['purse', 'slot']);
    expect(normalizeSlotSave(JSON.parse(JSON.stringify(slot)))).toEqual(slot);
  });
});

describe('이어 하기의 글', () => {
  it('어디까지 갔는지 라운드와 금화로 알린다', () => {
    expect(resumeCaption({ ...newRun(), round: 3, coin: 12 })).toBe('라운드 3 · 금화 12개');
  });

  it('글꼴에 들어 있는 한글만 쓴다', () => {
    const known = fontSyllables();
    expect(known.size).toBe(2350);
    for (const text of [...Object.values(RESUME_TEXT), resumeCaption(newRun())]) {
      for (const letter of text.match(/[ㄱ-ㆎ가-힣]/g) ?? []) {
        expect(known.has(letter), `"${letter}" in "${text}"`).toBe(true);
      }
    }
  });
});
