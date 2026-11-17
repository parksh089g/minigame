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
  SLOTS,
  spin,
  spinsOf,
  SYMBOLS,
  type RunState,
} from './rules';
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
    expect(createSlotSave()).toEqual({ found: [], run: null });
  });

  it('맞는 것은 그대로 둔다', () => {
    const slot = { found: ['piggy', 'wide'], run: packRun(shopping('2026-11-16')) };
    expect(slot.run).not.toBeNull();
    expect(normalizeSlotSave(JSON.parse(JSON.stringify(slot)))).toEqual(slot);
  });

  it('하던 판이 깨졌으면 판만 버리고 도감은 살린다', () => {
    const raw = { found: ['piggy', 'gone', 'piggy'], run: broken(spun(newRun(), 1), { coin: -3 }) };
    expect(normalizeSlotSave(raw)).toEqual({ found: ['piggy'], run: null });
  });

  it('도감이 깨졌어도 하던 판은 살린다', () => {
    const run = spun(newRun(), 1);
    expect(normalizeSlotSave({ found: 'all', run: stored(run) })).toEqual({ found: [], run: packRun(run) });
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
