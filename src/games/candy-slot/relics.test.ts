import { describe, expect, it } from 'vitest';
import { PERKS, perkLabel, type PerkState } from './perks';
import {
  allUnlocked,
  canRaise,
  canRaiseAny,
  canSpend,
  effectLine,
  effectValue,
  keepLabel,
  keepNote,
  LEVEL_SUM_MAX,
  levelOf,
  levelSum,
  levelText,
  raise,
  raiseBlock,
  raisedNotice,
  RELIC_FULL_PRICE,
  RELIC_PRICE,
  RELIC_TEXT,
  relicOf,
  relicPrice,
  RELICS,
  relicShortNotice,
  relicShortOf,
  startTab,
  type KeepState,
  type RelicState,
} from './relics';
import {
  CHARMS,
  interestFor,
  newRun,
  PERK_IDS,
  REFUND_RATE,
  refundOf,
  RELIC_IDS,
  RELIC_MAX,
  RELIC_STEP,
  targetFor,
  targetOf,
  upgradeCostOf,
  type RelicId,
  type RelicLevels,
} from './rules';

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

const state = (pieces: number, relics: RelicLevels = {}): RelicState => ({ pieces, relics });
const keep = (pieces: number, perks: PerkState['perks'] = [], relics: RelicLevels = {}): KeepState => ({ pieces, perks, relics });
const FULL: RelicLevels = Object.fromEntries(RELIC_IDS.map((id) => [id, RELIC_MAX]));
const PERK_TOTAL = PERKS.reduce((sum, perk) => sum + perk.price, 0);

describe('유물의 목록', () => {
  it('규칙이 아는 유물마다 하나씩, 같은 차례로 있다', () => {
    expect(RELICS.map((relic) => relic.id)).toEqual([...RELIC_IDS]);
    expect(new Set(RELICS.map((relic) => relic.name)).size).toBe(RELICS.length);
    for (const id of RELIC_IDS) expect(relicOf(id).id).toBe(id);
    expect(() => relicOf('nope' as RelicId)).toThrow();
  });

  it('이름과 설명과 앞머리는 창의 줄에 들어가게 짧다', () => {
    for (const relic of RELICS) {
      expect(relic.name.length, relic.name).toBeLessThanOrEqual(7);
      expect(relic.description.length, relic.description).toBeLessThanOrEqual(24);
      expect(relic.lead.length, relic.lead).toBeLessThanOrEqual(6);
    }
  });
});

describe('단계를 올리는 값', () => {
  it('첫 단계가 가장 싸고, 한 단계마다 같은 만큼씩 비싸진다', () => {
    expect(relicPrice(0)).toBe(RELIC_PRICE.first);
    for (let level = 1; level < RELIC_MAX; level += 1) {
      expect(relicPrice(level)).toBe(relicPrice(level - 1)! + RELIC_PRICE.step);
    }
    expect(RELIC_PRICE.step).toBeGreaterThan(0);
  });

  it('다 올렸거나 단계가 이상하면 값이 없다', () => {
    expect(relicPrice(RELIC_MAX)).toBeNull();
    expect(relicPrice(RELIC_MAX + 3)).toBeNull();
    expect(relicPrice(-1)).toBeNull();
    expect(relicPrice(1.5)).toBeNull();
    expect(relicPrice(Number.NaN)).toBeNull();
  });

  it('첫 단계는 한 판이면 사고, 마지막 단계도 서너 판이면 산다', () => {
    // 한 판에 조각이 일곱 개쯤 들어온다(perks.ts의 PERKS).
    expect(relicPrice(0)!).toBeLessThanOrEqual(7);
    expect(relicPrice(RELIC_MAX - 1)!).toBeLessThanOrEqual(7 * 4);
  });

  it('유물 하나를 다 올리는 데 150개쯤, 넷을 다 올리는 데 백 판쯤 걸린다', () => {
    let sum = 0;
    for (let level = 0; level < RELIC_MAX; level += 1) sum += relicPrice(level)!;
    expect(RELIC_FULL_PRICE).toBe(sum);
    expect(RELIC_FULL_PRICE).toBeGreaterThanOrEqual(120);
    expect(RELIC_FULL_PRICE).toBeLessThanOrEqual(180);
    // 해금 넷까지 더해, 한 판에 일곱 개씩 받는 사람이 모두 채우는 데 걸리는 판의 수
    const runs = (RELIC_FULL_PRICE * RELIC_IDS.length + PERK_TOTAL) / 7;
    expect(runs).toBeGreaterThanOrEqual(70);
    expect(runs).toBeLessThanOrEqual(130);
    // 유물은 해금 넷을 다 연 뒤에도 오래 남는 쓸 곳이다.
    expect(RELIC_FULL_PRICE * RELIC_IDS.length).toBeGreaterThan(PERK_TOTAL * 3);
  });
});

describe('단계 올리기', () => {
  it('단계는 0에서 RELIC_MAX까지로만 본다', () => {
    expect(levelOf(state(0), 'scale')).toBe(0);
    expect(levelOf(state(0, { scale: 4 }), 'scale')).toBe(4);
    expect(levelOf(state(0, { scale: 99 }), 'scale')).toBe(RELIC_MAX);
    expect(levelOf(state(0, { scale: -3 }), 'scale')).toBe(0);
    expect(levelSum(state(0))).toBe(0);
    expect(levelSum(state(0, { scale: 4, jar: 1 }))).toBe(5);
    expect(levelSum(state(0, FULL))).toBe(LEVEL_SUM_MAX);
    expect(LEVEL_SUM_MAX).toBe(RELIC_IDS.length * RELIC_MAX);
  });

  it('조각이 값만큼 있어야 올린다', () => {
    const price = relicPrice(0)!;
    expect(raiseBlock(state(price - 1), 'seal')).toBe('pieces');
    expect(canRaise(state(price - 1), 'seal')).toBe(false);
    expect(relicShortOf(state(price - 1), 'seal')).toBe(1);
    expect(raiseBlock(state(price), 'seal')).toBeNull();
    expect(canRaise(state(price), 'seal')).toBe(true);
    expect(relicShortOf(state(price), 'seal')).toBe(0);
    // 단계가 오르면 값도 오른다.
    const next = relicPrice(3)!;
    expect(canRaise(state(next - 1, { seal: 3 }), 'seal')).toBe(false);
    expect(canRaise(state(next, { seal: 3 }), 'seal')).toBe(true);
  });

  it('올리면 조각이 값만큼 줄고 그 유물만 한 단계 오른다. 원본은 그대로다', () => {
    const before = state(40, { jar: 2 });
    const after = raise(before, 'scale');
    expect(after).toEqual({ pieces: 40 - relicPrice(0)!, relics: { scale: 1, jar: 2 } });
    expect(before).toEqual({ pieces: 40, relics: { jar: 2 } });
    const again = raise(after, 'jar');
    expect(again).toEqual({ pieces: after.pieces - relicPrice(2)!, relics: { scale: 1, jar: 3 } });
    // 적는 차례는 올린 차례가 아니라 정해진 차례다.
    expect(Object.keys(raise(raise(state(40), 'jar'), 'scale').relics)).toEqual(['scale', 'jar']);
  });

  it('조각이 모자라면 받은 것 그대로 돌려준다', () => {
    const poor = state(relicPrice(0)! - 1);
    expect(raise(poor, 'hammer')).toBe(poor);
  });

  it('RELIC_MAX에서 멈춘다: 다 올린 유물은 조각이 넘쳐도 오르지 않는다', () => {
    let now = state(RELIC_FULL_PRICE + 500);
    for (let level = 1; level <= RELIC_MAX; level += 1) {
      now = raise(now, 'hammer');
      expect(levelOf(now, 'hammer')).toBe(level);
    }
    expect(now.pieces).toBe(500);
    expect(raiseBlock(now, 'hammer')).toBe('max');
    expect(canRaise(now, 'hammer')).toBe(false);
    expect(relicShortOf(now, 'hammer')).toBe(0);
    expect(raise(now, 'hammer')).toBe(now);
  });

  it('깨진 단계가 적혀 있어도 올린 뒤에는 맞는 단계만 남는다', () => {
    const odd = { pieces: 100, relics: { scale: 2.9, seal: -4, nope: 3 } as RelicLevels };
    expect(raise(odd, 'scale').relics).toEqual({ scale: 3 });
  });

  it('세이브처럼 다른 것이 함께 든 상태도 그대로 들고 간다', () => {
    const slot = { found: ['piggy'], pieces: 10, perks: ['purse' as const], relics: {} };
    expect(raise(slot, 'jar')).toEqual({ found: ['piggy'], pieces: 10 - relicPrice(0)!, perks: ['purse'], relics: { jar: 1 } });
  });

  it('올릴 수 있는 유물이 있는지 안다', () => {
    expect(canRaiseAny(state(0))).toBe(false);
    expect(canRaiseAny(state(relicPrice(0)! - 1))).toBe(false);
    expect(canRaiseAny(state(relicPrice(0)!))).toBe(true);
    expect(canRaiseAny(state(9999, FULL))).toBe(false);
    // 하나만 덜 올렸으면 그 유물의 값을 본다.
    const almost: RelicLevels = { ...FULL, jar: RELIC_MAX - 1 };
    expect(canRaiseAny(state(relicPrice(RELIC_MAX - 1)! - 1, almost))).toBe(false);
    expect(canRaiseAny(state(relicPrice(RELIC_MAX - 1)!, almost))).toBe(true);
  });

  it('넷을 다 올리는 데 드는 조각은 값을 모두 더한 것과 같다', () => {
    let now = state(RELIC_FULL_PRICE * RELIC_IDS.length);
    for (const id of RELIC_IDS) for (let level = 0; level < RELIC_MAX; level += 1) now = raise(now, id);
    expect(now).toEqual({ pieces: 0, relics: FULL });
  });
});

describe('효과를 적는 줄', () => {
  it('지금 값과 다음 단계의 값을 적고, 다 올렸으면 지금 값만 적는다', () => {
    expect(effectLine('scale', 0)).toBe('목표 0% → -0.5%');
    expect(effectLine('scale', 3)).toBe('목표 -1.5% → -2%');
    expect(effectLine('scale', RELIC_MAX)).toBe('목표 -5%');
    expect(effectLine('seal', 0)).toBe('돌려받는 몫 50% → 52%');
    expect(effectLine('seal', 2)).toBe('돌려받는 몫 54% → 56%');
    expect(effectLine('seal', RELIC_MAX)).toBe('돌려받는 몫 70%');
    expect(effectLine('hammer', 0)).toBe('강화 값 0% → -2%');
    expect(effectLine('hammer', 3)).toBe('강화 값 -6% → -8%');
    expect(effectLine('hammer', RELIC_MAX)).toBe('강화 값 -20%');
    expect(effectLine('jar', 0)).toBe('남은 금화의 0% → 0.2%');
    expect(effectLine('jar', 2)).toBe('남은 금화의 0.4% → 0.6%');
    expect(effectLine('jar', RELIC_MAX)).toBe('남은 금화의 2%');
  });

  it('적힌 값은 규칙의 수에서 나온다', () => {
    const number = (text: string): number => Number(text.replace('%', ''));
    for (let level = 0; level <= RELIC_MAX; level += 1) {
      expect(number(effectValue('scale', level))).toBeCloseTo((-RELIC_STEP.scale * level) / 10, 9);
      expect(number(effectValue('jar', level))).toBeCloseTo((RELIC_STEP.jar * level) / 10, 9);
      expect(number(effectValue('hammer', level))).toBeCloseTo(-RELIC_STEP.hammer * level, 9);
      expect(number(effectValue('seal', level))).toBe(Math.round(REFUND_RATE * 100) + RELIC_STEP.seal * level);
    }
    for (const id of RELIC_IDS) {
      for (let level = 0; level < RELIC_MAX; level += 1) {
        expect(effectLine(id, level)).toBe(`${relicOf(id).lead} ${effectValue(id, level)} → ${effectValue(id, level + 1)}`);
      }
      expect(effectLine(id, RELIC_MAX)).toBe(`${relicOf(id).lead} ${effectValue(id, RELIC_MAX)}`);
    }
  });

  it('적힌 값대로 판에서 듣는다', () => {
    const number = (text: string): number => Number(text.replace('%', ''));
    for (let level = 0; level <= RELIC_MAX; level += 1) {
      // 낡은 저울: 큰 목표에서는 적힌 비율만큼 낮아진다(가까운 정수로 맞추므로 금화 한 개까지는 어긋난다).
      const scale = newRun(null, [], { scale: level });
      const target = targetOf(14);
      const lowered = target * (1 + number(effectValue('scale', level)) / 100);
      expect(Math.abs(targetFor(scale, 14) - lowered)).toBeLessThan(1);
      // 금화 항아리: 남은 금화 1000개에서 적힌 비율만큼 받는다.
      expect(interestFor(1000, newRun(null, [], { jar: level }))).toBe(Math.round(number(effectValue('jar', level)) * 10));
      // 대장장이 망치: 적힌 비율만큼 싸지고, 금화 한 개가 안 되는 나머지는 깎아 준다.
      // 상인의 도장: 기본 몫은 내림하고, 유물로 느는 몫은 올림한다. 그래도 치른 값보다는 적다.
      for (const charm of CHARMS) {
        const base = upgradeCostOf(charm.id);
        const cut = upgradeCostOf(charm.id, newRun(null, [], { hammer: level }));
        expect(cut).toBe(Math.max(1, Math.floor((base * (100 + number(effectValue('hammer', level)))) / 100)));
        const back = refundOf(charm.id, newRun(null, [], { seal: level }));
        const share = Math.round(REFUND_RATE * 100);
        const bonus = number(effectValue('seal', level)) - share;
        expect(back).toBe(
          Math.min(charm.price - 1, Math.floor((charm.price * share) / 100) + Math.ceil((charm.price * bonus) / 100)),
        );
      }
    }
  });

  it('단계는 "3단계"로, 다 올린 것은 "끝"으로 적는다', () => {
    expect(levelText(0)).toBe('0단계');
    expect(levelText(3)).toBe('3단계');
    expect(levelText(RELIC_MAX - 1)).toBe(`${RELIC_MAX - 1}단계`);
    expect(levelText(RELIC_MAX)).toBe(RELIC_TEXT.end);
    expect(RELIC_TEXT.max).toBe('다 올림');
    expect(RELIC_TEXT.title).toBe('유물');
  });

  it('올렸을 때와 모자랄 때 알리는 글', () => {
    expect(raisedNotice('scale', 3)).toBe('낡은 저울 3단계로 강화!');
    expect(relicShortNotice(state(2), 'scale')).toBe(`조각이 ${relicPrice(0)! - 2}개 모자라요`);
    expect(relicShortNotice(state(2, { scale: 4 }), 'scale')).toBe(`조각이 ${relicPrice(4)! - 2}개 모자라요`);
  });
});

describe('시작 화면', () => {
  const ALL = [...PERK_IDS];

  it('해금이 남아 있으면 버튼에 해금의 수를, 다 열었으면 유물의 단계를 적는다', () => {
    expect(allUnlocked(keep(0))).toBe(false);
    expect(allUnlocked(keep(0, ['purse', 'reroll', 'hold']))).toBe(false);
    expect(allUnlocked(keep(0, ALL))).toBe(true);
    expect(keepLabel(keep(0))).toBe(perkLabel(keep(0)));
    expect(keepLabel(keep(9, ['purse'], { scale: 3 }))).toBe('해금 1/4');
    expect(keepLabel(keep(9, ALL))).toBe(`유물 0/${LEVEL_SUM_MAX}`);
    expect(keepLabel(keep(9, ALL, { scale: 3, jar: 9 }))).toBe(`유물 12/${LEVEL_SUM_MAX}`);
    expect(keepLabel(keep(9, ALL, FULL))).toBe(`유물 ${LEVEL_SUM_MAX}/${LEVEL_SUM_MAX}`);
  });

  it('창은 버튼에 적힌 쪽부터 보인다', () => {
    expect(startTab(keep(0))).toBe('perks');
    expect(startTab(keep(0, ['slot']))).toBe('perks');
    expect(startTab(keep(0, ALL))).toBe('relics');
  });

  it('살 것이 있는지: 해금이 남아 있으면 해금만, 다 열었으면 유물을 본다', () => {
    const cheapest = Math.min(...PERKS.map((perk) => perk.price));
    // 유물은 살 수 있어도 해금을 살 수 없으면 점을 달지 않는다.
    expect(relicPrice(0)!).toBeLessThan(cheapest);
    expect(canSpend(keep(relicPrice(0)!))).toBe(false);
    expect(canSpend(keep(cheapest))).toBe(true);
    expect(canSpend(keep(relicPrice(0)! - 1, ALL))).toBe(false);
    expect(canSpend(keep(relicPrice(0)!, ALL))).toBe(true);
    expect(canSpend(keep(9999, ALL, FULL))).toBe(false);
  });

  it('켜져 있는 해금과 유물을 한 줄로 알리고, 오늘의 판이면 그것들 없이 한다고 알린다', () => {
    expect(keepNote(keep(50), false)).toBeNull();
    expect(keepNote(keep(50), true)).toBeNull();
    expect(keepNote(keep(0, ['purse', 'slot']), false)).toBe('해금 2개가 켜져 있어요');
    expect(keepNote(keep(0, ['purse', 'slot']), true)).toBe('오늘의 판은 해금 없이 해요');
    expect(keepNote(keep(0, [], { jar: 2, seal: 1 }), false)).toBe('유물 3단계가 켜져 있어요');
    expect(keepNote(keep(0, [], { jar: 2 }), true)).toBe('오늘의 판은 유물 없이 해요');
    expect(keepNote(keep(0, ['purse'], { jar: 2, seal: 10 }), false)).toBe('해금 1개와 유물 12단계가 켜져 있어요');
    expect(keepNote(keep(0, ['purse'], { jar: 2 }), true)).toBe('오늘의 판은 해금과 유물 없이 해요');
  });
});

describe('화면에 적는 글', () => {
  it('글꼴에 들어 있는 글자만 쓴다', () => {
    const known = fontSyllables();
    const ALL = [...PERK_IDS];
    const texts = [
      ...Object.values(RELIC_TEXT),
      ...RELICS.flatMap((relic) => [relic.name, relic.description, relic.lead]),
      ...RELIC_IDS.flatMap((id) => [
        ...Array.from({ length: RELIC_MAX + 1 }, (_, level) => effectLine(id, level)),
        raisedNotice(id, 1),
        raisedNotice(id, RELIC_MAX),
        relicShortNotice(state(0), id),
      ]),
      ...Array.from({ length: RELIC_MAX + 1 }, (_, level) => levelText(level)),
      keepLabel(keep(0, ALL, { scale: 3 })),
      keepLabel(keep(0, ['purse'])),
      keepNote(keep(0, [], { jar: 2 }), false) ?? '',
      keepNote(keep(0, [], { jar: 2 }), true) ?? '',
      keepNote(keep(0, ['purse'], { jar: 2 }), false) ?? '',
      keepNote(keep(0, ['purse'], { jar: 2 }), true) ?? '',
    ];
    expect(texts.every((text) => text !== '')).toBe(true);
    for (const text of texts) {
      for (const letter of text.match(/[ㄱ-ㆎ가-힣]/g) ?? []) {
        expect(known.has(letter), `"${letter}" in "${text}"`).toBe(true);
      }
      // 화살표(→)는 글꼴에 들어 있다. 그 밖에는 한글과 숫자와 흔한 부호만 쓴다.
      expect(text, text).toMatch(/^[가-힣0-9 .,!?%/→-]+$/);
    }
  });
});
