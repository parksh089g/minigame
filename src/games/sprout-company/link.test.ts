import { describe, expect, it } from 'vitest';
import { getGame } from '../registry';
import { PLAY_STARS, PROJECT_ORDER, PROJECTS } from './data';
import { nextStarTarget, readStars, starsFor, starTargets } from './link';
import { createCompany, gameIncome, incomePerSecond, normalizeCompany, setStars, starsOf } from './rules';

describe('미니게임과 잇기', () => {
  it('출시작마다 직접 할 수 있는 게임과 별을 따는 점수 셋이 있다', () => {
    for (const id of PROJECT_ORDER) {
      expect(getGame(id)?.sceneKey, id).toBeTruthy();
      const targets = starTargets(id);
      expect(targets, id).toHaveLength(PLAY_STARS.count);
      expect(targets[0], id).toBeGreaterThan(0);
      for (let index = 1; index < targets.length; index += 1) {
        expect(targets[index], id).toBeGreaterThan(targets[index - 1]);
      }
    }
  });

  it('오늘의 도전에 나오는 게임은 그 목표를, 나오지 않는 게임은 따로 적은 점수를 쓴다', () => {
    expect(starTargets('lightning-tap')).toEqual(getGame('lightning-tap')?.dailyTargets);
    expect(getGame('lantern-keeper')?.dailyTargets).toEqual([]);
    expect(starTargets('lantern-keeper')).toEqual(PLAY_STARS.targets['lantern-keeper']);
  });

  it('최고 기록이 점수를 넘을 때마다 별이 하나씩 는다', () => {
    const [one, two, three] = starTargets('lightning-tap');
    expect(starsFor('lightning-tap', 0)).toBe(0);
    expect(starsFor('lightning-tap', one - 1)).toBe(0);
    expect(starsFor('lightning-tap', one)).toBe(1);
    expect(starsFor('lightning-tap', two)).toBe(2);
    expect(starsFor('lightning-tap', three)).toBe(3);
    expect(starsFor('lightning-tap', three * 100)).toBe(3);

    expect(nextStarTarget('lightning-tap', 0)).toBe(one);
    expect(nextStarTarget('lightning-tap', one)).toBe(two);
    expect(nextStarTarget('lightning-tap', three)).toBeNull();
  });

  it('게임마다의 최고 기록으로 별을 한꺼번에 센다', () => {
    const bests: Record<string, number> = {
      'lightning-tap': starTargets('lightning-tap')[1],
      'stack-tower': starTargets('stack-tower')[2],
      'memory-cards': 1,
      'no-such-game': 99999,
    };
    expect(readStars((id) => bests[id] ?? 0)).toEqual({ 'lightning-tap': 2, 'stack-tower': 3 });
    expect(readStars(() => 0)).toEqual({});
  });

  it('별은 낸 게임의 수익을 올린다. 아직 내지 않은 게임의 별은 내고 나서야 쓰인다', () => {
    const state = createCompany('sprout');
    state.released = { 'lightning-tap': 1, 'stack-tower': 2 };
    const before = incomePerSecond(state);
    const tap = gameIncome(state, 'lightning-tap');
    expect(gameIncome(state, 'lightning-tap') + gameIncome(state, 'stack-tower')).toBeCloseTo(before);
    expect(gameIncome(state, 'memory-cards')).toBe(0);

    expect(setStars(state, { 'lightning-tap': 2, 'memory-cards': 3 })).toEqual(['lightning-tap', 'memory-cards']);
    expect(starsOf(state, 'lightning-tap')).toBe(2);
    expect(gameIncome(state, 'lightning-tap')).toBeCloseTo(tap * (1 + PLAY_STARS.income * 2));
    expect(incomePerSecond(state)).toBeCloseTo(before + tap * PLAY_STARS.income * 2);
    expect(gameIncome(state, 'memory-cards')).toBe(0);

    state.released['memory-cards'] = 1;
    const bonus = 1 + state.desks.reduce((sum, desk) => sum + (desk.staff === 'chick' ? 0.1 : 0), 0);
    expect(gameIncome(state, 'memory-cards')).toBeCloseTo(PROJECTS['memory-cards'].income * (1 + PLAY_STARS.income * 3) * bonus);
  });

  it('딴 별은 줄지 않고, 셋을 넘지 않는다', () => {
    const state = createCompany('sprout');
    setStars(state, { 'lightning-tap': 2 });
    expect(setStars(state, { 'lightning-tap': 1 })).toEqual([]);
    expect(setStars(state, {})).toEqual([]);
    expect(starsOf(state, 'lightning-tap')).toBe(2);
    expect(setStars(state, { 'lightning-tap': 99 })).toEqual(['lightning-tap']);
    expect(starsOf(state, 'lightning-tap')).toBe(PLAY_STARS.count);
  });

  it('별을 저장했다가 그대로 읽고, 이상한 값은 버린다', () => {
    const state = createCompany('sprout');
    setStars(state, { 'lightning-tap': 2, 'lantern-keeper': 3 });
    expect(normalizeCompany(JSON.parse(JSON.stringify(state)))).toEqual(state);

    const raw = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    raw.stars = { 'lightning-tap': 99, 'stack-tower': -4, 'no-such-game': 3, 'memory-cards': 'many' };
    expect(normalizeCompany(raw)?.stars).toEqual({ 'lightning-tap': PLAY_STARS.count });

    // 별이 생기기 전의 세이브에는 별이 없다.
    delete raw.stars;
    expect(normalizeCompany(raw)?.stars).toEqual({});
  });
});
