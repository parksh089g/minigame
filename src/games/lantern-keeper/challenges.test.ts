import { describe, expect, it } from 'vitest';
import {
  addRun,
  CHALLENGES,
  claimable,
  createStats,
  getChallenge,
  isDone,
  newlyDone,
  normalizeStats,
  progressOf,
  type ChallengeSource,
  type LanternStats,
  type RunFeats,
} from './challenges';
import { HERO_ORDER, MAX_DEPTH, META, META_ORDER, WEAPON_ORDER } from './data';
import { metaCost } from './rules';

const source = (stats: Partial<LanternStats> = {}, clears = 0): ChallengeSource => ({
  clears,
  stats: { ...createStats(), ...stats },
});
/** 따로 주지 않은 것은 등불지기로 밤의 풀밭에서 아무것도 못 하고 쓰러진 판이다. */
const run = (over: Partial<RunFeats> = {}): RunFeats => ({
  cleared: false,
  hero: 'keeper',
  stage: 'meadow',
  depth: 0,
  kills: 0,
  bossKills: 0,
  level: 1,
  evolved: [],
  ...over,
});
const must = (id: string) => {
  const challenge = getChallenge(id);
  if (!challenge) throw new Error(`없는 도전 과제: ${id}`);
  return challenge;
};

describe('도전 과제 목록', () => {
  it('id가 겹치지 않고, 목표와 보상은 양의 정수다', () => {
    const ids = CHALLENGES.map((challenge) => challenge.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const challenge of CHALLENGES) {
      expect(Number.isInteger(challenge.goal) && challenge.goal > 0).toBe(true);
      expect(Number.isInteger(challenge.reward) && challenge.reward > 0).toBe(true);
    }
  });

  it('제목과 설명은 준비 화면 한 줄에 들어가는 길이다', () => {
    // 한글 12px(작은 글씨는 10px), 숫자 7px(6px), 빈칸 5px(4px)로 어림한 폭
    const width = (text: string, big: boolean): number =>
      [...text].reduce((sum, char) => sum + (char === ' ' ? (big ? 5 : 4) : /[0-9]/.test(char) ? (big ? 7 : 6) : big ? 12 : 10), 0);
    for (const challenge of CHALLENGES) {
      expect(width(challenge.title, true)).toBeLessThanOrEqual(100);
      expect(width(challenge.description, false)).toBeLessThanOrEqual(140);
    }
  });

  it('아무 기록이 없으면 이룬 것이 없다', () => {
    for (const challenge of CHALLENGES) expect(isDone(challenge, source())).toBe(false);
    expect(claimable(source(), [])).toEqual([]);
  });

  it('보상을 다 모으면 새로 생긴 영구 강화를 모두 사고도 남는다', () => {
    const rewards = CHALLENGES.reduce((sum, challenge) => sum + challenge.reward, 0);
    const added = (['armor', 'reroll', 'headstart'] as const).reduce((sum, id) => {
      let cost = 0;
      for (let level = 0; level < META[id].maxLevel; level += 1) cost += metaCost(id, level) ?? 0;
      return sum + cost;
    }, 0);
    expect(META_ORDER).toEqual(expect.arrayContaining(['armor', 'reroll', 'headstart']));
    expect(rewards).toBeGreaterThan(added);
    // 새벽 뒤에 열리는 다섯까지 모두 사는 값도 보상을 다 모은 것보다는 적다.
    const all = META_ORDER.reduce((sum, id) => {
      let cost = 0;
      for (let level = 0; level < META[id].maxLevel; level += 1) cost += metaCost(id, level) ?? 0;
      return sum + cost;
    }, 0);
    expect(all).toBeGreaterThan(3000);
    expect(rewards).toBeGreaterThan(all);
  });
});

describe('한 판의 기록 쌓기', () => {
  it('처치와 보스는 더해지고, 레벨과 진화 수는 가장 좋았던 판이 남는다', () => {
    let stats = createStats();
    stats = addRun(stats, run({ kills: 900, bossKills: 2, level: 18, evolved: ['ember'] }));
    stats = addRun(stats, run({ kills: 300, bossKills: 1, level: 9 }));
    stats = addRun(stats, run({ kills: 6000, bossKills: 5, level: 41, evolved: ['star', 'bolt', 'ember'], cleared: true }));
    expect(stats).toMatchObject({ kills: 7200, bossKills: 8, bestLevel: 41, bestEvolved: 3 });
    // 진화시켜 본 무기는 정해진 차례로, 겹치지 않게 남는다.
    expect(stats.evolved).toEqual(['ember', 'star', 'bolt']);
  });

  it('캐릭터와 스테이지, 깊은 밤은 완주한 판만 센다', () => {
    let stats = addRun(createStats(), run({ hero: 'stormer', stage: 'marsh', depth: 3 }));
    expect(stats).toMatchObject({ heroes: [], stages: [], deepest: 0 });
    stats = addRun(stats, run({ hero: 'stormer', stage: 'marsh', depth: 0, cleared: true }));
    stats = addRun(stats, run({ hero: 'keeper', stage: 'meadow', depth: 2, cleared: true }));
    stats = addRun(stats, run({ hero: 'keeper', stage: 'meadow', depth: 1, cleared: true }));
    expect(stats.heroes).toEqual(['keeper', 'stormer']);
    expect(stats.stages).toEqual(['meadow', 'marsh']);
    // 깊은 밤 2를 완주했으므로 3이다(단계 + 1).
    expect(stats.deepest).toBe(3);
  });

  it('끝없는 밤에서 가장 오래 버틴 시간이 남는다', () => {
    let stats = addRun(createStats(), run({ cleared: true }));
    expect(stats.bestEndless).toBe(0);
    stats = addRun(stats, run({ cleared: true, endlessSeconds: 200.7 }));
    stats = addRun(stats, run({ cleared: true, endlessSeconds: 95 }));
    expect(stats.bestEndless).toBe(200);
    const three = must('endless-3');
    const six = must('endless-6');
    expect(progressOf(three, source({ bestEndless: 179 }))).toBe(2);
    expect(isDone(three, source({ bestEndless: 179 }))).toBe(false);
    expect(isDone(three, source({ bestEndless: 180 }))).toBe(true);
    expect(isDone(six, source({ bestEndless: 359 }))).toBe(false);
    expect(isDone(six, source({ bestEndless: 360 }))).toBe(true);
    // 이 항목이 없던 예전 저장은 0으로 채운다.
    expect(normalizeStats({ kills: 5 }).bestEndless).toBe(0);
    expect(normalizeStats({ bestEndless: 240.5 }).bestEndless).toBe(240);
  });

  it('연 보물 상자가 판마다 쌓인다', () => {
    let stats = addRun(createStats(), run({ chests: 4 }));
    stats = addRun(stats, run({}));
    stats = addRun(stats, run({ cleared: true, chests: 5 }));
    expect(stats.chests).toBe(9);
    const hunter = must('chests-25');
    expect(progressOf(hunter, source({ chests: 24 }))).toBe(24);
    expect(isDone(hunter, source({ chests: 24 }))).toBe(false);
    expect(isDone(hunter, source({ chests: 25 }))).toBe(true);
    // 이 항목이 없던 예전 저장은 0으로 채운다.
    expect(normalizeStats({ kills: 5 }).chests).toBe(0);
    expect(normalizeStats({ chests: 'x' }).chests).toBe(0);
  });

  it('저장된 기록에서 엉뚱한 값은 버린다', () => {
    expect(normalizeStats(undefined)).toEqual(createStats());
    expect(normalizeStats({ kills: -3, bossKills: 'x', evolved: 'ember' })).toEqual(createStats());
    const saved = normalizeStats({
      kills: 12.9,
      bestEvolved: 99,
      deepest: 99,
      evolved: ['bolt', 'sword', 'ember', 'bolt'],
      heroes: ['stormer', 'nobody'],
      stages: ['marsh'],
    });
    expect(saved).toMatchObject({
      kills: 12,
      bestEvolved: WEAPON_ORDER.length,
      deepest: MAX_DEPTH + 1,
      evolved: ['ember', 'bolt'],
      heroes: ['stormer'],
      stages: ['marsh'],
    });
  });
});

describe('도전 과제 달성', () => {
  it('진행은 목표를 넘지 않는 정수다', () => {
    const kills = must('kills-10k');
    expect(progressOf(kills, source({ kills: 2500.7 }))).toBe(2500);
    expect(progressOf(kills, source({ kills: 99999 }))).toBe(kills.goal);
    expect(isDone(kills, source({ kills: 9999 }))).toBe(false);
    expect(isDone(kills, source({ kills: 10000 }))).toBe(true);
  });

  it('깊은 밤 과제는 그 단계를 완주해야 이루어진다', () => {
    // deepest는 완주한 단계 + 1이다. 1은 보통 밤만 완주한 것.
    expect(isDone(must('deep-1'), source({ deepest: 1 }))).toBe(false);
    expect(isDone(must('deep-1'), source({ deepest: 2 }))).toBe(true);
    expect(isDone(must('deep-3'), source({ deepest: 3 }))).toBe(false);
    expect(isDone(must('deep-3'), source({ deepest: 4 }))).toBe(true);
    expect(isDone(must('deep-max'), source({ deepest: MAX_DEPTH }))).toBe(false);
    expect(isDone(must('deep-max'), source({ deepest: MAX_DEPTH + 1 }))).toBe(true);
  });

  it('세 캐릭터와 아홉 무기는 모두 채워야 이루어진다', () => {
    expect(isDone(must('heroes-all'), source({ heroes: ['keeper', 'stormer'] }))).toBe(false);
    expect(isDone(must('heroes-all'), source({ heroes: [...HERO_ORDER] }))).toBe(true);
    expect(progressOf(must('evolve-all'), source({ evolved: ['ember', 'aura'] }))).toBe(2);
    expect(isDone(must('evolve-all'), source({ evolved: [...WEAPON_ORDER] }))).toBe(true);
    expect(isDone(must('evolve-1'), source({ evolved: ['oil'] }))).toBe(true);
    expect(isDone(must('marsh-dawn'), source({ stages: ['meadow'] }))).toBe(false);
    expect(isDone(must('marsh-dawn'), source({ stages: ['meadow', 'marsh'] }))).toBe(true);
  });

  it('이루었지만 받지 않은 것만 받을 수 있다', () => {
    const done = source({ evolved: ['ember'] }, 1);
    expect(claimable(done, []).map((challenge) => challenge.id)).toEqual(['evolve-1', 'dawn-1']);
    expect(claimable(done, ['evolve-1']).map((challenge) => challenge.id)).toEqual(['dawn-1']);
    expect(claimable(done, ['evolve-1', 'dawn-1'])).toEqual([]);
  });

  it('이번 판으로 새로 이룬 것을 골라낸다', () => {
    const before = source({ kills: 9500 });
    const after = source({ kills: 10200, evolved: ['star'] });
    expect(newlyDone(before, after).map((challenge) => challenge.id)).toEqual(['evolve-1', 'kills-10k']);
    expect(newlyDone(after, after)).toEqual([]);
  });
});
