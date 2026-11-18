import { describe, expect, it } from 'vitest';
import { allyDamage, allyInterval, copiesFor, placeAlly } from './allies';
import { ALLIES, ALLY_ORDER, ALLY_STARS, GUN, type AllyAim } from './data';
import { AIM_TEXT, allyInfo, INFO_TEXT, SHOP_TEXT } from './shop-text';
import { createRun, type RunState } from './sim';

/** 주아 글꼴에 들어 있는 한글: KS X 1001의 완성형 2,350자(how-to.test.ts와 같은 셈) */
function fontSyllables(): Set<string> {
  const decoder = new TextDecoder('euc-kr');
  const syllables = new Set<string>();
  for (let lead = 0xb0; lead <= 0xc8; lead += 1) {
    for (let trail = 0xa1; trail <= 0xfe; trail += 1) syllables.add(decoder.decode(new Uint8Array([lead, trail])));
  }
  return syllables;
}

/** 첫날 앞 가게가 열린 판. 영구 강화를 주면 그 능력치로 시작한다. */
function shopRun(levels = {}): RunState {
  return createRun({ seed: 7, startDay: 1, levels, bestBefore: 0 }).state;
}

describe('동료 정보 창의 글(allyInfo)', () => {
  it('겨누는 벌레를 AllyAim마다 쉬운 말로 적는다', () => {
    const want: Record<AllyAim, string> = {
      near: '가까운 벌레를 겨눠요',
      boss: '대장과 튼튼한 벌레를 겨눠요',
      front: '울타리에 다가온 벌레를 겨눠요',
      crowd: '몰려 있는 벌레를 겨눠요',
      far: '멀리 있는 벌레를 겨눠요',
    };
    const state = shopRun();
    for (const id of ALLY_ORDER) expect(allyInfo(state, id, 1).aim, id).toBe(want[ALLIES[id].aim]);
    // 뒤에 "를"을 붙이므로 모두 받침 없는 "벌레"로 끝나야 한다.
    for (const text of Object.values(AIM_TEXT)) expect(text.endsWith('벌레')).toBe(true);
  });

  it('솜씨(껍데기 뚫기, 느리게 하기, 둘레 치기, 닿는 거리)를 데이터에서 읽어 적는다', () => {
    const state = shopRun();
    const specials = (id: Parameters<typeof allyInfo>[1]): string[] => allyInfo(state, id, 1).specials;
    expect(specials('sunflower')).toEqual([]);
    expect(specials('sparrow')).toEqual([]);
    expect(specials('frog')).toEqual(['껍데기를 뚫어요']);
    expect(specials('mint')).toEqual(['맞은 벌레가 느려져요']);
    expect(specials('can')).toEqual(['둘레도 쳐요']);
    expect(specials('pumpkin')).toEqual(['둘레도 쳐요']);
    expect(specials('cactus')).toEqual(['껍데기를 뚫어요', '울타리 가까이만 닿아요']);
    expect(specials('toad')).toEqual(['껍데기를 뚫어요', '맞은 벌레가 느려져요']);
  });

  it('밭의 동료: 지금 별의 한 발 피해(물총 한 발에 견주어)와 1초에 쏘는 수, 다음 별, 값과 돌려받는 열매', () => {
    const state = shopRun();
    const sunflower = allyInfo(state, 'sunflower', 1);
    expect(sunflower.name).toBe('해바라기');
    expect(sunflower.star).toBe('★1');
    expect(sunflower.cells).toBe('1칸');
    expect(sunflower.numbers).toEqual([
      '한 발 피해: 물총의 0.36배',
      '1초에 1.1번 쏴요',
      '★1 → ★2: 피해 ×1.5 · 빠르기 ×1.1',
      `값: 열매 ${ALLIES.sunflower.price}개 · 내보내면 1개`,
    ]);
    // 개구리 ★2(두 마리): 피해는 별마다 ALLY_STARS.damage배, 내보내면 두 마리 값의 절반
    const frog = allyInfo(state, 'frog', copiesFor(2));
    expect(frog.star).toBe('★2');
    expect(frog.cells).toBe('2칸');
    expect(frog.numbers[0]).toBe(`한 발 피해: 물총의 ${Number((ALLIES.frog.damage * ALLY_STARS.damage).toFixed(2))}배`);
    expect(frog.numbers[2]).toBe('★2 → ★3: 피해 ×1.5 · 빠르기 ×1.1');
    expect(frog.numbers[3]).toBe(`값: 열매 ${ALLIES.frog.price}개 · 내보내면 ${ALLIES.frog.price}개`);
  });

  it('피해와 빠르기는 그 판의 능력치(동료 거름, 빠른 손)를 따른다', () => {
    const state = shopRun({ compost: 2, rapid: 3, power: 5 });
    const { stats } = state;
    expect(stats.allyPower).toBeGreaterThan(1);
    const star = 3;
    const info = allyInfo(state, 'mint', copiesFor(star));
    const ratio = allyDamage('mint', star, stats.damage, stats.allyPower) / stats.damage;
    const perSecond = 1 / (allyInterval('mint', star) * (stats.interval / GUN.interval));
    expect(info.numbers[0]).toBe(`한 발 피해: 물총의 ${Number(ratio.toFixed(2))}배`);
    expect(info.numbers[1]).toBe(`1초에 ${Number(perSecond.toFixed(1))}번 쏴요`);
    // 거름 없는 판보다 세고, 빠른 손 없는 판보다 자주 쏜다.
    const plain = allyInfo(shopRun(), 'mint', copiesFor(star));
    expect(info.numbers[0]).not.toBe(plain.numbers[0]);
    expect(info.numbers[1]).not.toBe(plain.numbers[1]);
  });

  it('다 올린 동료에게는 다음 별이 없다', () => {
    const state = shopRun();
    const info = allyInfo(state, 'cactus', copiesFor(ALLY_STARS.max));
    expect(info.star).toBe(`★${ALLY_STARS.max}`);
    expect(info.numbers).toContain(SHOP_TEXT.top(ALLY_STARS.max));
    expect(info.numbers.some((line) => line.includes('→'))).toBe(false);
    // ★4는 아직 다음 별이 있다.
    expect(allyInfo(state, 'cactus', copiesFor(4)).numbers).toContain('★4 → ★5: 피해 ×1.5 · 빠르기 ×1.1');
  });

  it('가게의 카드: 처음 보는 동료는 "새 동료", 있는 동료는 합친 뒤의 별과 그 별의 숫자를 적는다', () => {
    const state = shopRun();
    expect(allyInfo(state, 'sunflower').star).toBe(SHOP_TEXT.fresh);
    expect(allyInfo(state, 'sunflower').numbers).toEqual(allyInfo(state, 'sunflower', 1).numbers);
    placeAlly(state, 'sunflower', 2);
    const card = allyInfo(state, 'sunflower');
    expect(card.star).toBe('합치면 ★3');
    // 합친 뒤(세 마리)의 모습이다.
    expect(card.numbers).toEqual(allyInfo(state, 'sunflower', 3).numbers);
    // 세 마리(★3)에 하나를 더 합쳐도 아직 ★3이다(★4는 다섯 마리).
    state.allies[0].copies = 3;
    expect(allyInfo(state, 'sunflower').star).toBe('합치면 ★3');
    // 다 올린 동료뿐이면 합칠 수 없으니 새로 놓을 ★1이다.
    state.allies[0].copies = copiesFor(ALLY_STARS.max);
    expect(allyInfo(state, 'sunflower').star).toBe('★1');
    expect(allyInfo(state, 'sunflower').numbers).toEqual(allyInfo(state, 'sunflower', 1).numbers);
  });

  it('모든 동료와 별의 글이 글꼴에 있는 글자만 쓴다', () => {
    const known = fontSyllables();
    const state = shopRun();
    const texts: string[] = [INFO_TEXT.close];
    for (const id of ALLY_ORDER) {
      texts.push(...Object.values(allyInfo(state, id)).flat().map(String));
      for (let star = 1; star <= ALLY_STARS.max; star += 1) {
        const info = allyInfo(state, id, copiesFor(star));
        texts.push(info.name, info.star, info.cells, info.aim, ...info.specials, ...info.numbers);
      }
    }
    for (const text of texts) {
      for (const char of text) {
        if (/[가-힣]/.test(char)) expect(known.has(char), `${text}: ${char}`).toBe(true);
      }
    }
  });
});
