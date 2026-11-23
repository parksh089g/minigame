import { describe, expect, it } from 'vitest';
import { HIDDEN, hulaVersus, perspective, readHulaMove, readHulaView, type HulaMatch } from './versus';

/** 늘 같은 판이 나오는 난수 */
function seeded(seed = 7): () => number {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

const fresh = (first: 0 | 1 = 0): HulaMatch => hulaVersus.start(seeded(), first);

describe('친구와 하는 훌라', () => {
  it('보는 자리가 늘 아래쪽(me)이 되고, 판이 끝나기 전에는 상대의 손패와 덱을 가린다', () => {
    const state = fresh(0);
    const zero = perspective(state.round, 0);
    const one = perspective(state.round, 1);
    expect(zero.hands.me).toEqual(state.round.hands.me);
    expect(one.hands.me).toEqual(state.round.hands.cpu);
    expect(zero.hands.cpu.every((card) => card === HIDDEN)).toBe(true);
    expect(one.hands.cpu).toHaveLength(state.round.hands.me.length);
    expect(one.stock.every((card) => card === HIDDEN)).toBe(true);
    expect(zero.turn).toBe('me');
    expect(one.turn).toBe('cpu');
    // 보낸 판에 상대의 실제 카드가 섞여 있지 않다.
    const sent = JSON.stringify(hulaVersus.view(state, 1));
    for (const card of state.round.hands.me) expect(JSON.parse(sent).round.hands.me).not.toContain(card);
  });

  it('차례가 아닌 자리의 수는 받지 않는다', () => {
    const state = fresh(0);
    expect(hulaVersus.play(state, 1, { type: 'draw' })).toBe(false);
    expect(hulaVersus.play(state, 0, { type: 'draw' })).toBe(true);
    expect(hulaVersus.turnOf(state)).toBe(0);
  });

  it('한 차례에 한 일을 상대가 볼 수 있게 적어 두고, 뽑은 카드는 상대에게 보이지 않는다', () => {
    const state = fresh(0);
    hulaVersus.play(state, 0, { type: 'draw' });
    const card = state.round.hands.me[0];
    expect(hulaVersus.play(state, 0, { type: 'discard', card })).toBe(true);
    expect(hulaVersus.turnOf(state)).toBe(1);
    const seen = hulaVersus.view(state, 1);
    expect(seen.theirs).toEqual([{ type: 'draw' }, { type: 'discard', card }]);
    expect(seen.round.turn).toBe('me');
    expect(seen.round.discard[seen.round.discard.length - 1]).toBe(card);
    // 1번 자리가 새 차례를 시작하면 자기의 지난 차례 기록이 비워진다.
    hulaVersus.play(state, 1, { type: 'draw' });
    expect(hulaVersus.view(state, 0).theirs).toEqual([{ type: 'draw' }]);
  });

  it('끝난 판은 이긴 자리를 알려 주고, 그때는 상대의 손패도 보인다', () => {
    const state = fresh(0);
    // 0번 자리가 손을 다 비우게 맞춰 둔다: 같은 숫자 셋 + 7 + 버릴 카드 하나
    state.round.hands.me = [4, 17, 30, 6];
    state.round.phase = 'draw';
    state.round.turn = 'me';
    state.round.stock = state.round.stock.filter((c) => ![4, 17, 30, 6].includes(c));
    hulaVersus.play(state, 0, { type: 'draw' });
    hulaVersus.play(state, 0, { type: 'meld', cards: [4, 17, 30] });
    hulaVersus.play(state, 0, { type: 'meld', cards: [6] });
    const last = state.round.hands.me[0];
    hulaVersus.play(state, 0, { type: 'discard', card: last });
    expect(hulaVersus.outcome(state)).toEqual({ winner: 0 });
    expect(hulaVersus.turnOf(state)).toBeNull();
    const seen = hulaVersus.view(state, 1);
    expect(seen.round.hands.cpu).toEqual([]);
    expect(seen.round.hands.me.every((card) => card !== HIDDEN)).toBe(true);
    expect(seen.round.result?.winner).toBe('cpu');
  });

  it('밖에서 온 수는 모양을 확인한다', () => {
    expect(readHulaMove({ type: 'draw', extra: 1 })).toEqual({ type: 'draw' });
    expect(readHulaMove({ type: 'discard', card: 51 })).toEqual({ type: 'discard', card: 51 });
    expect(readHulaMove({ type: 'discard', card: 52 })).toBeNull();
    expect(readHulaMove({ type: 'meld', cards: [] })).toBeNull();
    expect(readHulaMove({ type: 'meld', cards: [1, 2, 'x'] })).toBeNull();
    expect(readHulaMove({ type: 'layoff', card: 3, meld: -1 })).toBeNull();
    expect(readHulaMove({ type: 'cheat' })).toBeNull();
    expect(readHulaMove(null)).toBeNull();
  });

  it('서버가 보낸 판을 그대로 읽고, 모양이 틀리면 받지 않는다', () => {
    const state = fresh(1);
    const view = JSON.parse(JSON.stringify(hulaVersus.view(state, 0)));
    expect(readHulaView(view)).toEqual(view);
    expect(readHulaView({ ...view, theirs: 'x' })).toBeNull();
    expect(readHulaView({ ...view, round: { ...view.round, turn: 'nobody' } })).toBeNull();
  });
});
