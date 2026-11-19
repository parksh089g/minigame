import { describe, expect, it } from 'vitest';
import {
  activeNote,
  addPieces,
  canUnlock,
  canUnlockAny,
  holdHowText,
  holdUsedText,
  isUnlocked,
  orderText,
  perkHint,
  perkLabel,
  perkOf,
  PERKS,
  PERK_TEXT,
  PIECES_MAX,
  piecesFor,
  piecesVerdict,
  rerollLabel,
  shortNotice,
  shortOf,
  slotsNote,
  timesText,
  unlock,
  unlockBlock,
  unlockedCount,
  unlockedNotice,
  type PerkState,
} from './perks';
import {
  clearedRounds,
  firstRerollCost,
  HOLDS_PER_ROUND,
  holdsOf,
  newRun,
  nextRound,
  PERK_IDS,
  PERK_PURSE,
  REROLL_COST,
  settleRound,
  SLOTS,
  SLOTS_MAX,
  slotsOf,
  spin,
  START_COIN,
  targetFor,
  type PerkId,
  type RunState,
} from './rules';
import { bossPiecesOf } from './round-events';

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

const state = (pieces: number, perks: readonly PerkId[] = []): PerkState => ({ pieces, perks });
const steady = (): number => 0.37;

/**
 * rounds개의 라운드를 넘기고 그다음 라운드를 하고 있는 판. 목표는 이벤트까지 넣은 것(targetFor)만큼 채운다.
 * 대장의 상은 고르지 않고 가게를 닫아서 행운 조각을 받는다.
 */
function runAt(rounds: number, seed: string | null = null): RunState {
  let run = newRun(seed);
  for (let round = 0; round < rounds; round += 1) {
    const settled = settleRound({ ...run, spinsLeft: 0, coin: targetFor(run, run.round) }, steady);
    if (!settled?.cleared) throw new Error('목표를 채우지 못했다');
    run = nextRound(settled.run);
  }
  return run;
}

describe('해금의 목록', () => {
  it('규칙이 아는 해금마다 하나씩, 같은 차례로 있다', () => {
    expect(PERKS.map((perk) => perk.id)).toEqual([...PERK_IDS]);
    for (const id of PERK_IDS) expect(perkOf(id).id).toBe(id);
    expect(() => perkOf('nope' as PerkId)).toThrow();
  });

  it('값은 1 이상의 정수이고, 뒤로 갈수록 비싸고, 가질 수 있는 조각으로 살 수 있다', () => {
    const prices = PERKS.map((perk) => perk.price);
    for (const price of prices) {
      expect(Number.isInteger(price)).toBe(true);
      expect(price).toBeGreaterThan(0);
      expect(price).toBeLessThanOrEqual(PIECES_MAX);
    }
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
    expect(new Set(prices).size).toBe(prices.length);
  });

  it('값을 모두 더하면, 일곱 라운드쯤 넘기는 판으로 스무 판쯤 걸린다', () => {
    const total = PERKS.reduce((sum, perk) => sum + perk.price, 0);
    // 일곱 라운드에 한 개씩, 그리고 다섯째 라운드의 대장을 넘기고 고른 조각
    const typical = piecesFor(runAt(7));
    expect(typical).toBe(7 + bossPiecesOf(5));
    const runs = total / typical;
    expect(runs).toBeGreaterThanOrEqual(15);
    expect(runs).toBeLessThanOrEqual(25);
    // 첫 해금은 두세 판이면 열린다.
    expect(Math.ceil(PERKS[0].price / typical)).toBeLessThanOrEqual(3);
  });

  it('이름과 설명은 규칙의 수에서 만들어서, 규칙의 수가 바뀌어도 맞는다', () => {
    expect(perkOf('purse').name).toBe('두둑한 시작');
    expect(perkOf('purse').description).toBe(`금화를 ${PERK_PURSE}개 더 들고 시작해요`);
    expect(perkOf('reroll').name).toBe('첫 뽑기 공짜');
    expect(perkOf('reroll').description).toBe('가게마다 첫 다시 뽑기가 공짜예요');
    expect(perkOf('hold').name).toBe('잠그기 한 번 더');
    expect(holdsOf({ perks: ['hold'] })).toBe(HOLDS_PER_ROUND + 1);
    expect(perkOf('hold').description).toBe(`라운드마다 열을 ${timesText(HOLDS_PER_ROUND + 1)} 잠가요`);
    expect(perkOf('slot').name).toBe(`${orderText(SLOTS_MAX)} 자리`);
    expect(perkOf('slot').description).toBe(`부적을 ${SLOTS_MAX}장까지 붙여요`);
    // 세는 말
    expect(timesText(2)).toBe('두 번');
    expect(orderText(6)).toBe('여섯째');
    expect(orderText(11)).toBe('11번째');
    // 설명대로 듣는지: 규칙에서 해금이 하는 일과 맞춘다.
    expect(newRun(null, ['purse']).coin).toBe(START_COIN + PERK_PURSE);
    expect(firstRerollCost({ perks: ['reroll'] })).toBe(0);
    expect(slotsOf({ perks: ['slot'] })).toBe(SLOTS_MAX);
  });

  it('이름과 설명은 해금 창의 줄에 들어가는 길이이고, 글꼴에 들어 있는 한글만 쓴다', () => {
    const known = fontSyllables();
    expect(known.size).toBe(2350);
    for (const perk of PERKS) {
      expect(perk.name.length, perk.name).toBeLessThanOrEqual(9);
      expect(perk.description.length, perk.description).toBeLessThanOrEqual(18);
      for (const text of [perk.name, perk.description]) {
        for (const letter of text.match(/[ㄱ-ㆎ가-힣]/g) ?? []) {
          expect(known.has(letter), `"${letter}" in "${text}"`).toBe(true);
        }
        // 글꼴에는 한글과 숫자, 흔한 부호만 있다. 화살표 같은 것은 글자로 쓰지 않는다.
        expect(text, text).toMatch(/^[가-힣0-9 .,!?·:+/-]+$/);
      }
    }
  });
});

describe('조각 받기', () => {
  it('넘긴 라운드마다 한 개를 받고, 대장의 상으로 고른 조각을 더 받는다', () => {
    expect(piecesFor(newRun())).toBe(0);
    expect(piecesFor(runAt(1))).toBe(1);
    expect(piecesFor(runAt(4))).toBe(4);
    expect(piecesFor(runAt(7))).toBe(7 + bossPiecesOf(5));
    expect(piecesFor(runAt(10))).toBe(10 + bossPiecesOf(5) + bossPiecesOf(10));
    for (const rounds of [0, 3, 10]) {
      const run = runAt(rounds);
      expect(piecesFor(run)).toBe(clearedRounds(run) + (run.bonusPieces ?? 0));
    }
  });

  it('목표를 채우지 못해 끝난 판은 그 앞 라운드까지만 센다', () => {
    const failed = settleRound({ ...runAt(4), spinsLeft: 0, coin: 0 }, steady);
    expect(failed?.cleared).toBe(false);
    expect(failed?.run.phase).toBe('over');
    expect(piecesFor(failed!.run)).toBe(4);
    // 첫 라운드도 넘기지 못하면 받지 못한다.
    const first = settleRound({ ...newRun(), spinsLeft: 0, coin: 0 }, steady);
    expect(piecesFor(first!.run)).toBe(0);
  });

  it('가게에서 끝낸 판은 방금 넘긴 라운드까지 센다', () => {
    const settled = settleRound({ ...runAt(2), spinsLeft: 0, coin: 999 }, steady);
    expect(settled?.run.phase).toBe('shop');
    expect(piecesFor(settled!.run)).toBe(3);
  });

  it('오늘의 판도, 해금을 켠 판도 똑같이 받는다', () => {
    expect(piecesFor(runAt(5, 'candy-slot:daily:1'))).toBe(5 + bossPiecesOf(5));
    expect(piecesFor({ ...runAt(5), perks: [...PERK_IDS] })).toBe(5 + bossPiecesOf(5));
  });

  it('조각을 더한다. 0 이하이거나 정수가 아니면 그대로이고, 한도를 넘지 않는다', () => {
    const start = state(10, ['purse']);
    expect(addPieces(start, 7)).toEqual(state(17, ['purse']));
    expect(start.pieces).toBe(10);
    for (const bad of [0, -2, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(addPieces(start, bad)).toBe(start);
    expect(addPieces(start, PIECES_MAX).pieces).toBe(PIECES_MAX);
    const full = state(PIECES_MAX);
    expect(addPieces(full, 3)).toBe(full);
  });
});

describe('해금 열기', () => {
  const purse = perkOf('purse');
  const slot = perkOf('slot');

  it('조각이 값만큼 있어야 열 수 있다', () => {
    expect(unlockBlock(state(purse.price - 1), 'purse')).toBe('pieces');
    expect(canUnlock(state(purse.price - 1), 'purse')).toBe(false);
    expect(shortOf(state(purse.price - 1), 'purse')).toBe(1);
    expect(unlockBlock(state(purse.price), 'purse')).toBeNull();
    expect(canUnlock(state(purse.price), 'purse')).toBe(true);
    expect(shortOf(state(purse.price), 'purse')).toBe(0);
  });

  it('열면 값만큼 조각이 줄고 해금이 켜진다. 원본은 바꾸지 않는다', () => {
    const before = state(purse.price + 4);
    const after = unlock(before, 'purse');
    expect(after).toEqual(state(4, ['purse']));
    expect(before).toEqual(state(purse.price + 4));
    expect(isUnlocked(after, 'purse')).toBe(true);
    expect(isUnlocked(before, 'purse')).toBe(false);
  });

  it('조각이 모자라면 그대로다', () => {
    const poor = state(slot.price - 1);
    expect(unlock(poor, 'slot')).toBe(poor);
  });

  it('이미 연 것은 다시 열 수 없고 조각도 줄지 않는다', () => {
    const owned = state(500, ['slot']);
    expect(unlockBlock(owned, 'slot')).toBe('owned');
    expect(unlock(owned, 'slot')).toBe(owned);
    expect(shortOf(state(0, ['slot']), 'slot')).toBe(0);
  });

  it('아무 차례로나 열 수 있고, 열어 둔 것은 정해진 차례로 적힌다', () => {
    const total = PERKS.reduce((sum, perk) => sum + perk.price, 0);
    let now = state(total);
    for (const id of ['slot', 'purse', 'hold', 'reroll'] as const) now = unlock(now, id);
    expect(now).toEqual(state(0, [...PERK_IDS]));
    expect(unlockedCount(now)).toBe(PERKS.length);
    expect(canUnlockAny(now)).toBe(false);
  });

  it('열 수 있는 것이 하나라도 있는지 안다', () => {
    expect(canUnlockAny(state(0))).toBe(false);
    expect(canUnlockAny(state(purse.price - 1))).toBe(false);
    expect(canUnlockAny(state(purse.price))).toBe(true);
    // 가장 싼 것을 이미 열었으면 그다음 것의 값을 따진다.
    expect(canUnlockAny(state(purse.price, ['purse']))).toBe(false);
    expect(canUnlockAny(state(perkOf('reroll').price, ['purse']))).toBe(true);
  });

  it('연 해금으로 시작한 여느 판에는 듣고, 오늘의 판에는 듣지 않는다', () => {
    const owned = unlock(unlock(state(500), 'slot'), 'purse');
    const normal = newRun(null, owned.perks);
    expect(normal.perks).toEqual(['purse', 'slot']);
    expect(normal.coin).toBe(START_COIN + PERK_PURSE);
    expect(slotsOf(normal)).toBe(SLOTS_MAX);
    const daily = newRun('candy-slot:daily:1', owned.perks);
    expect(daily.perks).toEqual([]);
    expect(daily.coin).toBe(START_COIN);
    expect(slotsOf(daily)).toBe(SLOTS);
  });
});

describe('화면에 적는 글', () => {
  it('버튼에는 연 해금의 수를 적는다', () => {
    expect(perkLabel(state(0))).toBe('해금 0/4');
    expect(perkLabel(state(3, ['purse', 'hold']))).toBe('해금 2/4');
    // 모르는 해금이 섞여 있어도 세지 않는다.
    expect(perkLabel(state(3, ['purse', 'nope' as PerkId]))).toBe('해금 1/4');
  });

  it('창의 안내는 조각을 받는 법이고, 다 열면 다 열었다고 적는다', () => {
    expect(perkHint(state(0))).toBe(PERK_TEXT.how);
    expect(perkHint(state(0, [...PERK_IDS]))).toBe(PERK_TEXT.all);
  });

  it('열었을 때와 모자랄 때 알리는 글', () => {
    expect(unlockedNotice('purse')).toBe('두둑한 시작 열림!');
    expect(shortNotice(state(perkOf('hold').price - 6), 'hold')).toBe('조각이 6개 모자라요');
  });

  it('결과 화면의 줄에는 받은 조각과 가진 조각을 적는다', () => {
    expect(piecesVerdict(7, 32)).toBe('+7 · 모두 32개');
    expect(piecesVerdict(0, 0)).toBe('+0 · 모두 0개');
  });

  it('시작 화면의 한 줄: 켜진 해금의 수, 오늘의 판이면 듣지 않는다는 것, 연 것이 없으면 적지 않는다', () => {
    expect(activeNote(state(50), false)).toBeNull();
    expect(activeNote(state(50), true)).toBeNull();
    expect(activeNote(state(0, ['purse', 'slot']), false)).toBe('해금 2개가 켜져 있어요');
    expect(activeNote(state(0, ['purse', 'slot']), true)).toBe('오늘의 판은 해금 없이 해요');
  });

  it('잠그는 법은 남은 횟수에 맞춰 적는다', () => {
    // 해금이 없을 때는 예전 그대로다.
    expect(holdHowText(1, 1)).toBe('열을 누르면 한 번 잠글 수 있어요');
    expect(holdUsedText(1)).toBe('잠그기는 라운드마다 한 번이에요');
    expect(holdHowText(2, 2)).toBe('열을 누르면 두 번 잠글 수 있어요');
    expect(holdHowText(2, 1)).toBe('열을 누르면 한 번 더 잠글 수 있어요');
    expect(holdUsedText(2)).toBe('잠그기는 라운드마다 두 번이에요');
    expect(timesText(3)).toBe('세 번');
    expect(timesText(12)).toBe('12번');
  });

  it('잠그기를 연 판에서 한 번 쓰고 나면 더 잠글 수 있다고 적는다', () => {
    let run = newRun(null, ['hold']);
    run = spin(run, steady)!.run;
    const total = holdsOf(run);
    expect(run.holdsLeft).toBe(total);
    expect(holdHowText(total, run.holdsLeft)).toBe(`열을 누르면 ${timesText(total)} 잠글 수 있어요`);
    run = spin(run, steady, 0)!.run;
    expect(run.holdsLeft).toBe(total - 1);
    expect(holdHowText(total, run.holdsLeft)).toBe(`열을 누르면 ${timesText(total - 1)} 더 잠글 수 있어요`);
  });

  it('다시 뽑기가 공짜일 때는 공짜라고 적는다', () => {
    expect(rerollLabel(0)).toBe('다시 뽑기 공짜');
    expect(rerollLabel(REROLL_COST)).toBe('다시 뽑기');
    expect(rerollLabel(firstRerollCost({ perks: ['reroll'] }))).toBe('다시 뽑기 공짜');
    expect(rerollLabel(firstRerollCost({ perks: [] }))).toBe('다시 뽑기');
  });

  it('가게에는 이 판에서 붙일 수 있는 부적의 수를 적는다', () => {
    expect(slotsNote(slotsOf(newRun()))).toBe(`부적은 ${SLOTS}장까지 붙일 수 있어요`);
    expect(slotsNote(slotsOf(newRun(null, ['slot'])))).toBe(`부적은 ${SLOTS_MAX}장까지 붙일 수 있어요`);
  });

  it('글꼴에 들어 있는 한글만 쓴다', () => {
    const known = fontSyllables();
    const some = state(3, ['purse']);
    const texts = [
      ...Object.values(PERK_TEXT),
      perkLabel(some),
      perkHint(some),
      ...PERK_IDS.flatMap((id) => [unlockedNotice(id), shortNotice(state(0), id)]),
      piecesVerdict(7, 32),
      activeNote(some, false) ?? '',
      activeNote(some, true) ?? '',
      holdHowText(1, 1),
      holdHowText(2, 2),
      holdHowText(2, 1),
      holdUsedText(1),
      holdUsedText(2),
      ...Array.from({ length: 11 }, (_, index) => [timesText(index + 1), orderText(index + 1)]).flat(),
      rerollLabel(0),
      rerollLabel(2),
      slotsNote(SLOTS),
      slotsNote(SLOTS_MAX),
    ];
    for (const text of texts) {
      for (const letter of text.match(/[ㄱ-ㆎ가-힣]/g) ?? []) {
        expect(known.has(letter), `"${letter}" in "${text}"`).toBe(true);
      }
      expect(text, text).toMatch(/^[가-힣0-9 .,!?·:+/-]*$/);
    }
  });
});
