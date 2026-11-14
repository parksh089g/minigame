import { describe, expect, it } from 'vitest';
import {
  FEAST_ORDER,
  HERO_ORDER,
  HEROES,
  MAX_DEPTH,
  META,
  META_ORDER,
  STAGE_ORDER,
  STAGES,
  WEAPON_ORDER,
  type StageId,
} from './data';
import {
  announceNews,
  applyRun,
  buyMeta,
  chooseDepth,
  chooseFeast,
  chooseHero,
  chooseStage,
  claimChallenge,
  createDefaultMeta,
  feastOpen,
  hasNews,
  meetFriend,
  meetHero,
  newDepth,
  newsLine,
  newUnlocks,
  normalizeMeta,
  openDepth,
  unknownNews,
  type LanternMeta,
  type RunResult,
} from './meta';
import { DAILY_REWARD } from './daily';
import { embersFor, isUnlocked, metaCost, type RunSummary } from './rules';
import { OLD_HAND_TIPS } from './tips';

/** 한 판의 결과. 따로 주지 않은 것은 등불지기로 밤의 풀밭에서 아무것도 못 하고 쓰러진 판이다. */
const result = (over: Partial<RunResult> = {}): RunResult => ({
  embers: 0,
  seconds: 0,
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

describe('영구 강화 사기', () => {
  it('불씨가 충분하면 한 단계 오르고 값만큼 줄어든다', () => {
    const cost = metaCost('vigor', 0)!;
    const meta = { ...createDefaultMeta(), embers: cost + 3 };
    const next = buyMeta(meta, 'vigor');
    expect(next.upgrades.vigor).toBe(1);
    expect(next.embers).toBe(3);
    expect(meta.upgrades.vigor).toBeUndefined();
  });

  it('불씨가 모자라거나 최대 단계면 그대로다', () => {
    const poor = { ...createDefaultMeta(), embers: metaCost('might', 0)! - 1 };
    expect(buyMeta(poor, 'might')).toBe(poor);
    const maxed = { ...createDefaultMeta(), embers: 9999, upgrades: { reach: META.reach.maxLevel } };
    expect(buyMeta(maxed, 'reach')).toBe(maxed);
  });

  it('새벽을 맞아야 열리는 것은 불씨가 넉넉해도 그 전에는 살 수 없다', () => {
    const rich = { ...createDefaultMeta(), embers: 9999 };
    for (const id of META_ORDER) {
      const bought = buyMeta(rich, id);
      if (META[id].needsDawn) expect(bought).toBe(rich);
      else expect(bought.upgrades[id]).toBe(1);
    }
    const dawned = { ...rich, clears: 1 };
    for (const id of META_ORDER) expect(buyMeta(dawned, id).upgrades[id]).toBe(1);
    // 저장해 둔 단계는 잠겨 있던 때의 것이라도 그대로 둔다(다른 기기에서 옮겨 온 진행일 수 있다).
    expect(normalizeMeta({ embers: 5, upgrades: { sift: 2 } }).upgrades.sift).toBe(2);
  });
});

describe('판 결과 반영', () => {
  it('불씨와 횟수, 최고 기록이 쌓인다', () => {
    let meta = createDefaultMeta();
    meta = applyRun(meta, result({ embers: 20, seconds: 185.7 }));
    meta = applyRun(meta, result({ embers: 60, seconds: 600, cleared: true }));
    meta = applyRun(meta, result({ embers: 5, seconds: 90 }));
    expect(meta).toMatchObject({ embers: 85, runs: 3, clears: 1, bestSeconds: 600 });
  });
});

describe('오늘의 판', () => {
  const today = 20_769;

  it('그날 처음 마친 판에는 불씨가 더 붙고, 그날의 기록과 한 날 수가 남는다', () => {
    const before = { ...createDefaultMeta(), embers: 10 };
    const first = applyRun(before, result({ embers: 7, seconds: 130, daily: { day: today, score: 420 } }));
    expect(first.embers).toBe(10 + 7 + DAILY_REWARD);
    expect(first.daily).toEqual({ day: today, best: 420, seconds: 130, cleared: false, tries: 1, streak: 1 });
    expect(first.stats.dailyDays).toBe(1);
    expect(first.runs).toBe(1);
    expect(first.bestSeconds).toBe(130);

    // 같은 날 다시 하면 보너스는 없고, 더 좋은 기록만 바뀐다.
    const second = applyRun(first, result({ embers: 5, seconds: 300, cleared: true, daily: { day: today, score: 900 } }));
    expect(second.embers).toBe(first.embers + 5);
    expect(second.daily).toEqual({ day: today, best: 900, seconds: 300, cleared: true, tries: 2, streak: 1 });
    expect(second.stats.dailyDays).toBe(1);

    // 다음 날 하면 보너스가 다시 붙고 이어 온 날 수가 는다.
    const next = applyRun(second, result({ embers: 1, seconds: 50, daily: { day: today + 1, score: 30 } }));
    expect(next.embers).toBe(second.embers + 1 + DAILY_REWARD);
    expect(next.daily).toMatchObject({ day: today + 1, best: 30, tries: 1, streak: 2 });
    expect(next.stats.dailyDays).toBe(2);
  });

  it('보통 판은 오늘의 판의 기록을 건드리지 않는다', () => {
    const played = applyRun(createDefaultMeta(), result({ daily: { day: today, score: 100 } }));
    const after = applyRun(played, result({ embers: 3, seconds: 999 }));
    expect(after.daily).toBe(played.daily);
    expect(after.stats.dailyDays).toBe(1);
    expect(after.embers).toBe(played.embers + 3);
  });

  it('일곱 날을 하면 도전 과제가 이뤄진다', () => {
    let meta = createDefaultMeta();
    for (let day = 0; day < 7; day += 1) {
      expect(claimChallenge(meta, 'daily-7')).toBe(meta);
      // 하루를 걸러도 한 날 수는 쌓인다.
      meta = applyRun(meta, result({ daily: { day: today + day * 2, score: 1 } }));
    }
    expect(meta.stats.dailyDays).toBe(7);
    expect(claimChallenge(meta, 'daily-7').embers).toBeGreaterThan(meta.embers);
  });

  it('저장했다가 읽어도 그대로이고, 예전 저장에는 빈 기록이 채워진다', () => {
    const played = applyRun(createDefaultMeta(), result({ seconds: 60, daily: { day: today, score: 100 } }));
    expect(normalizeMeta(JSON.parse(JSON.stringify(played))).daily).toEqual(played.daily);
    expect(normalizeMeta(JSON.parse(JSON.stringify(played))).stats.dailyDays).toBe(1);
    const old = normalizeMeta({ embers: 5, runs: 2 });
    expect(old.daily).toEqual({ day: 0, best: 0, seconds: 0, cleared: false, tries: 0, streak: 0 });
    expect(old.stats.dailyDays).toBe(0);
  });
});

describe('깊은 밤', () => {
  const cleared = (meta: LanternMeta, stage: StageId, depth: number): LanternMeta =>
    applyRun(meta, result({ stage, depth, seconds: 600, cleared: true }));
  const veteran = (): LanternMeta => ({ ...createDefaultMeta(), bestSeconds: 600 });

  it('처음에는 보통 밤만 열려 있고, 완주하면 그 스테이지의 다음 단계가 열린다', () => {
    let meta = veteran();
    expect(openDepth(meta, 'meadow')).toBe(0);
    expect(chooseDepth(meta, 1)).toBe(meta);

    const before = meta;
    meta = cleared(meta, 'meadow', 0);
    expect(openDepth(meta, 'meadow')).toBe(1);
    expect(openDepth(meta, 'marsh')).toBe(0);
    expect(newDepth(before, meta, 'meadow')).toBe(`${STAGES.meadow.name} 깊은 밤 1`);
    expect(newDepth(before, meta, 'marsh')).toBeNull();
    expect(chooseDepth(meta, 1).depth).toBe(1);
  });

  it('쓰러진 판이나 이미 지나온 단계의 완주로는 더 열리지 않는다', () => {
    let meta = cleared(cleared(veteran(), 'meadow', 0), 'meadow', 1);
    expect(openDepth(meta, 'meadow')).toBe(2);
    const again = cleared(meta, 'meadow', 0);
    expect(openDepth(again, 'meadow')).toBe(2);
    expect(newDepth(meta, again, 'meadow')).toBeNull();
    meta = applyRun(meta, result({ depth: 2, seconds: 599 }));
    expect(openDepth(meta, 'meadow')).toBe(2);
  });

  it('가장 깊은 단계를 완주해도 그보다 깊어지지 않는다', () => {
    let meta = veteran();
    for (let depth = 0; depth <= MAX_DEPTH; depth += 1) meta = cleared(meta, 'marsh', depth);
    expect(openDepth(meta, 'marsh')).toBe(MAX_DEPTH);
  });

  it('열리지 않은 단계는 고를 수 없고, 스테이지를 바꾸면 그곳에서 열린 데까지 낮아진다', () => {
    let meta = cleared(cleared(veteran(), 'meadow', 0), 'meadow', 1);
    meta = chooseDepth(meta, 2);
    expect(meta.depth).toBe(2);
    expect(chooseDepth(meta, 3)).toBe(meta);
    expect(chooseDepth(meta, -1)).toBe(meta);
    expect(chooseDepth(meta, 1.5)).toBe(meta);
    meta = chooseStage(meta, 'marsh');
    expect(meta).toMatchObject({ stage: 'marsh', depth: 0 });
  });

  it('저장된 값에서 엉뚱한 단계는 버리고, 고른 단계는 열린 데까지만 받아들인다', () => {
    const saved = normalizeMeta({ bestSeconds: 600, stage: 'meadow', depths: { meadow: 3, marsh: 'x', cave: 2 }, depth: 7 });
    expect(saved.depths).toEqual({ meadow: 3 });
    expect(saved.depth).toBe(3);
    expect(normalizeMeta({ depths: { meadow: 99 } }).depths).toEqual({ meadow: MAX_DEPTH });
    // 깊은 밤이 생기기 전의 저장에는 이 항목들이 없다.
    expect(normalizeMeta({ embers: 5 })).toMatchObject({ depths: {}, depth: 0 });
  });

  it('깊은 밤이 생기기 전에 완주해 둔 저장은 첫 스테이지의 깊은 밤 1이 열린다', () => {
    const old = normalizeMeta({ bestSeconds: 600, clears: 3, stage: 'marsh' });
    expect(old.depths).toEqual({ meadow: 1 });
    // 고른 스테이지(안개 늪)는 열린 단계가 없으므로 보통 밤이다.
    expect(old.depth).toBe(0);
    expect(chooseDepth(chooseStage(old, 'meadow'), 1).depth).toBe(1);
    // 완주한 적이 없으면 열리지 않고, 이미 열린 단계가 있으면 건드리지 않는다.
    expect(normalizeMeta({ bestSeconds: 590, clears: 0 }).depths).toEqual({});
    expect(normalizeMeta({ bestSeconds: 600, clears: 3, depths: { marsh: 2 } }).depths).toEqual({ marsh: 2 });
  });
});

describe('도전 과제', () => {
  it('한 판이 끝나면 기록이 쌓이고, 이룬 과제의 보상을 한 번만 받는다', () => {
    let meta = createDefaultMeta();
    expect(claimChallenge(meta, 'dawn-1')).toBe(meta);

    meta = applyRun(meta, result({ seconds: 600, cleared: true, kills: 6000, bossKills: 5, level: 40, evolved: ['ember'] }));
    expect(meta.stats).toMatchObject({ kills: 6000, bossKills: 5, bestLevel: 40, deepest: 1, heroes: ['keeper'] });

    const embers = meta.embers;
    const claimed = claimChallenge(meta, 'dawn-1');
    expect(claimed.embers).toBe(embers + 30);
    expect(claimed.claimed).toEqual(['dawn-1']);
    // 두 번 받을 수 없고, 없는 과제나 이루지 못한 과제는 받을 수 없다.
    expect(claimChallenge(claimed, 'dawn-1')).toBe(claimed);
    expect(claimChallenge(claimed, 'nothing')).toBe(claimed);
    expect(claimChallenge(claimed, 'deep-1')).toBe(claimed);
  });

  it('저장된 값에서 모르는 과제는 버리고, 예전 저장의 완주 기록은 보통 밤 완주로 이어받는다', () => {
    const saved = normalizeMeta({ clears: 2, claimed: ['dawn-1', 'nothing', 'dawn-1'], stats: { kills: 500 } });
    expect(saved.claimed).toEqual(['dawn-1']);
    expect(saved.stats).toMatchObject({ kills: 500, deepest: 1 });
    expect(normalizeMeta({ clears: 0 }).stats.deepest).toBe(0);
    // 도전 과제가 생기기 전에 완주한 사람도 "첫 새벽"을 받을 수 있다.
    expect(claimChallenge(saved, 'dawn-1')).toBe(saved);
    const old = normalizeMeta({ clears: 2 });
    expect(claimChallenge(old, 'dawn-1').embers).toBe(30);
  });
});

describe('잔치의 밤 고르기', () => {
  it('새벽을 한 번 맞기 전에는 고를 수 없다', () => {
    const fresh = createDefaultMeta();
    expect(fresh.feast).toBeNull();
    expect(feastOpen(fresh)).toBe(false);
    expect(chooseFeast(fresh, 'normal')).toBe(fresh);
    const cleared = applyRun(fresh, result({ seconds: 600, cleared: true }));
    expect(feastOpen(cleared)).toBe(true);
    // 판을 마친다고 저절로 켜지지는 않는다.
    expect(cleared.feast).toBeNull();
  });

  it('열린 뒤에는 난이도를 고르거나 끌 수 있고, 바뀌는 것이 없으면 그대로 돌려준다', () => {
    const open = { ...createDefaultMeta(), clears: 1 };
    expect(chooseFeast(open, null)).toBe(open);
    for (const level of FEAST_ORDER) {
      const on = chooseFeast(open, level);
      expect(on.feast).toBe(level);
      expect(chooseFeast(on, level)).toBe(on);
      expect(chooseFeast(on, null).feast).toBeNull();
    }
    expect(chooseFeast(chooseFeast(open, 'easy'), 'hard').feast).toBe('hard');
  });

  it('저장된 값은 열려 있고 아는 난이도일 때만 되살린다', () => {
    for (const level of FEAST_ORDER) expect(normalizeMeta({ clears: 2, feast: level }).feast).toBe(level);
    expect(normalizeMeta({ clears: 0, feast: 'easy' }).feast).toBeNull();
    expect(normalizeMeta({ clears: 2, feast: true }).feast).toBeNull();
    expect(normalizeMeta({ clears: 2, feast: 'wild' }).feast).toBeNull();
    // 잔치의 밤이 생기기 전의 저장에는 없어서 꺼진 채로 시작한다.
    expect(normalizeMeta({ clears: 2 }).feast).toBeNull();
  });
});

describe('저장된 값 읽기', () => {
  it('없거나 망가진 값은 기본값이 된다', () => {
    expect(normalizeMeta(undefined)).toEqual(createDefaultMeta());
    expect(normalizeMeta('x')).toEqual(createDefaultMeta());
    expect(normalizeMeta({ embers: -5, upgrades: 3 })).toEqual(createDefaultMeta());
  });

  it('모르는 강화는 버리고 단계는 최대를 넘지 않는다', () => {
    const meta = normalizeMeta({
      embers: 12.9,
      runs: 4,
      upgrades: { vigor: 99, swift: 2, unknown: 3, might: 'a' },
    });
    expect(meta.embers).toBe(12);
    expect(meta.runs).toBe(4);
    expect(meta.upgrades).toEqual({ vigor: META.vigor.maxLevel, swift: 2 });
  });
});

describe('캐릭터와 스테이지 고르기', () => {
  it('오래 버틴 기록이 있어야 열린다', () => {
    const fresh = createDefaultMeta();
    expect(fresh).toMatchObject({ hero: 'keeper', stage: 'meadow' });
    expect(chooseHero(fresh, 'stargazer')).toBe(fresh);
    expect(chooseStage(fresh, 'marsh')).toBe(fresh);

    const seasoned = { ...fresh, bestSeconds: HEROES.stargazer.unlockSeconds };
    expect(chooseHero(seasoned, 'stargazer').hero).toBe('stargazer');
    expect(chooseHero(seasoned, 'stormer')).toBe(seasoned);

    const veteran = { ...fresh, bestSeconds: 600 };
    expect(chooseHero(veteran, 'stormer').hero).toBe('stormer');
    expect(chooseStage(veteran, 'marsh').stage).toBe('marsh');
    // 이미 고른 것을 다시 고르면 그대로다.
    expect(chooseHero(veteran, 'keeper')).toBe(veteran);
  });

  it('한 판을 끝까지 버티면 모두 열린다', () => {
    for (const id of HERO_ORDER) expect(isUnlocked(HEROES[id], 600)).toBe(true);
    for (const id of STAGE_ORDER) expect(isUnlocked(STAGES[id], 600)).toBe(true);
    // 뒤에 있는 것일수록 늦게 열린다.
    const heroTimes = HERO_ORDER.map((id) => HEROES[id].unlockSeconds);
    expect([...heroTimes].sort((a, b) => a - b)).toEqual(heroTimes);
  });

  it('기록이 늘면서 새로 열린 것만 알려 준다', () => {
    expect(newUnlocks(0, 100)).toEqual([]);
    expect(newUnlocks(0, 130)).toEqual([HEROES.stargazer.name]);
    expect(newUnlocks(130, 250)).toEqual([STAGES.marsh.name]);
    expect(newUnlocks(130, 130)).toEqual([]);
    expect(newUnlocks(250, 430)).toEqual([HEROES.stormer.name, STAGES.ridge.name]);
    expect(newUnlocks(430, 480)).toEqual([HEROES.ringer.name]);
    expect(newUnlocks(0, 600)).toEqual([
      HEROES.stargazer.name,
      HEROES.stormer.name,
      HEROES.ringer.name,
      HEROES.mooner.name,
      HEROES.bearer.name,
      STAGES.marsh.name,
      STAGES.ridge.name,
      STAGES.tundra.name,
      STAGES.grove.name,
    ]);
    // 새벽을 맞아야 달잡이와 횃불잡이와 빛버섯 숲이 열린다.
    expect(newUnlocks(599, 600)).toEqual([HEROES.mooner.name, HEROES.bearer.name, STAGES.grove.name]);
    expect(newUnlocks(480, 545)).toEqual([STAGES.tundra.name]);
    expect(newUnlocks(600, 600)).toEqual([]);
  });

  it('저장된 선택은 열려 있을 때만 되살린다', () => {
    expect(normalizeMeta({ bestSeconds: 600, hero: 'stormer', stage: 'marsh' })).toMatchObject({
      hero: 'stormer',
      stage: 'marsh',
    });
    expect(normalizeMeta({ bestSeconds: 10, hero: 'stormer', stage: 'marsh' })).toMatchObject({
      hero: 'keeper',
      stage: 'meadow',
    });
    expect(normalizeMeta({ bestSeconds: 600, hero: 'nobody', stage: 7 })).toMatchObject({
      hero: 'keeper',
      stage: 'meadow',
    });
  });

  it('예전에 저장한 값은 불씨와 강화를 그대로 두고 기본 선택을 채운다', () => {
    const old = { version: 1, embers: 40, upgrades: { vigor: 2 }, runs: 3, clears: 0, bestSeconds: 200 };
    expect(normalizeMeta(old)).toEqual({
      ...createDefaultMeta(),
      ...old,
      version: createDefaultMeta().version,
      // 안내가 생기기 전부터 하던 사람이므로, 그때도 있던 일의 안내는 본 것으로 친다.
      tips: OLD_HAND_TIPS,
      // 달잡이와 등대빛이 들어오기 전부터 하던 사람이므로, 그 뒤에 들어온 것은 아직 모르는 것으로 친다(준비 화면이 한 번 알린다).
      known: [
        ...HERO_ORDER.filter((id) => id !== 'mooner' && id !== 'bearer'),
        ...WEAPON_ORDER.filter((id) => !['beam', 'torch', 'lamp'].includes(id)),
        ...STAGE_ORDER.filter((id) => id !== 'grove'),
        ...META_ORDER.filter((id) => !META[id].needsDawn),
      ],
    });
  });
});

describe('새로 들어온 캐릭터와 무기와 스테이지와 영구 강화', () => {
  /** 새벽을 맞아야 열리는 영구 강화 다섯 가지. 영구 강화를 알리게 되면서 함께 들어왔다. */
  const DAWN_UPGRADES = META_ORDER.filter((id) => META[id].needsDawn);

  /** 달잡이와 등대빛이 들어오기 전부터 하던 사람의 저장 */
  const oldHand = (): LanternMeta => normalizeMeta({ embers: 40, runs: 3, bestSeconds: 200, unread: ['bat'] });

  it('처음 하는 사람은 지금 있는 것을 모두 아는 것으로 쳐서 따로 알리지 않는다', () => {
    const fresh = createDefaultMeta();
    expect(hasNews(unknownNews(fresh))).toBe(false);
    expect(announceNews(fresh)).toBe(fresh);
    // 판을 한 번도 마치지 않은 예전 저장도 처음 하는 사람이다.
    expect(hasNews(unknownNews(normalizeMeta({ embers: 5 })))).toBe(false);
  });

  it('그 전부터 하던 사람에게는 그 뒤에 들어온 캐릭터와 무기와 스테이지와 영구 강화를 알린다', () => {
    const news = unknownNews(oldHand());
    expect(news).toEqual({
      heroes: ['mooner', 'bearer'],
      weapons: ['beam', 'torch', 'lamp'],
      stages: ['grove'],
      upgrades: ['sift', 'kindle', 'trove', 'bounty', 'vigil'],
    });
    expect(news.upgrades).toEqual(DAWN_UPGRADES);
    expect(newsLine(news)).toBe(
      '새 캐릭터 달잡이, 횃불잡이 · 새 무기 등대빛, 횃불, 풍등 · 새 스테이지 빛버섯 숲 · 새 영구 강화 5가지',
    );
    const none = { heroes: [], weapons: [], stages: [], upgrades: [] };
    expect(newsLine({ ...none, heroes: ['mooner'] })).toBe('새 캐릭터 달잡이');
    expect(newsLine({ ...none, weapons: ['beam', 'moon'] })).toBe('새 무기 등대빛, 초승달');
    expect(newsLine({ ...none, stages: ['grove'] })).toBe('새 스테이지 빛버섯 숲');
    // 영구 강화는 하나면 이름을, 여럿이면 몇 가지인지를 적는다.
    expect(newsLine({ ...none, upgrades: ['sift'] })).toBe('새 영구 강화 골라내기');
    expect(newsLine({ ...none, upgrades: ['sift', 'vigil'] })).toBe('새 영구 강화 2가지');
    expect(hasNews(none)).toBe(false);
    expect(hasNews({ ...none, upgrades: ['sift'] })).toBe(true);
  });

  it('영구 강화를 알리기 전의 저장에는 그때 있던 열한 가지만 아는 것으로 쳐서, 새로 들어온 것만 알린다', () => {
    // 캐릭터와 무기와 스테이지는 모두 알린 저장. known에 영구 강화가 하나도 없다.
    const before = [...HERO_ORDER, ...WEAPON_ORDER, ...STAGE_ORDER];
    const told = normalizeMeta({ runs: 9, clears: 2, bestSeconds: 600, known: before });
    expect(told.known).toEqual([...before, ...META_ORDER.filter((id) => !DAWN_UPGRADES.includes(id))]);
    const news = unknownNews(told);
    expect(news).toEqual({ heroes: [], weapons: [], stages: [], upgrades: DAWN_UPGRADES });
    expect(newsLine(news)).toBe('새 영구 강화 5가지');
    const after = announceNews(told);
    // 영구 강화는 한 줄로만 알린다. 카드나 도감에 붙는 것은 없다.
    expect(after.fresh).toEqual([]);
    expect(after.unread).toEqual(told.unread);
    expect(hasNews(unknownNews(after))).toBe(false);
    expect(announceNews(after)).toBe(after);
    expect(normalizeMeta(JSON.parse(JSON.stringify(after)))).toEqual(after);
  });

  it('달잡이와 등대빛을 이미 알린 사람에게는 그 뒤에 들어온 것만 알린다', () => {
    // 스테이지를 알리기 전의 저장에는 known에 스테이지가 없다.
    const before = [
      ...HERO_ORDER.filter((id) => id !== 'bearer'),
      ...WEAPON_ORDER.filter((id) => id !== 'torch' && id !== 'lamp'),
    ];
    const told = normalizeMeta({ runs: 9, bestSeconds: 600, known: before });
    const news = unknownNews(told);
    expect(news).toEqual({ heroes: ['bearer'], weapons: ['torch', 'lamp'], stages: ['grove'], upgrades: DAWN_UPGRADES });
    const after = announceNews(told);
    // 스테이지는 카드에 "새"를 붙이지 않고 한 줄로만 알린다. 새 무기는 도감에 새 항목으로 뜬다.
    expect(after.fresh).toEqual(['bearer']);
    expect(after.unread).toEqual(['torch', 'lamp']);
    expect(hasNews(unknownNews(after))).toBe(false);
    expect(normalizeMeta(JSON.parse(JSON.stringify(after)))).toEqual(after);
  });

  it('알리면 새 캐릭터에는 "새"가 붙고 새 무기는 도감에 새 항목으로 뜨며, 다시 알리지 않는다', () => {
    const before = oldHand();
    const told = announceNews(before);
    expect(told.fresh).toEqual(['mooner', 'bearer']);
    // 도감에서 이미 새로 열려 있던 것은 그대로 두고, 도감의 차례대로 더한다.
    expect(told.unread).toContain('beam');
    expect(told.unread).toContain('bat');
    expect(told.unread.indexOf('beam')).toBeLessThan(told.unread.indexOf('bat'));
    expect(hasNews(unknownNews(told))).toBe(false);
    expect(announceNews(told)).toBe(told);
    // 저장했다가 다시 읽어도 같다.
    expect(normalizeMeta(JSON.parse(JSON.stringify(told)))).toEqual(told);
  });

  it('카드를 눌러 보면 "새"가 사라진다', () => {
    const told = announceNews(oldHand());
    const seen = meetHero(told, 'mooner');
    expect(seen.fresh).toEqual(['bearer']);
    expect(meetHero(seen, 'mooner')).toBe(seen);
    expect(meetHero(seen, 'bearer').fresh).toEqual([]);
    expect(meetHero(told, 'keeper')).toBe(told);
  });

  it('저장된 값에서 모르는 이름은 버린다', () => {
    const meta = normalizeMeta({ runs: 2, known: ['keeper', 'nobody', 'beam', 7, 'grove'], fresh: ['mooner', 'x', 'beam'] });
    // 영구 강화가 하나도 적혀 있지 않으면 예전의 열한 가지를 아는 것으로 친다.
    expect(meta.known).toEqual(['keeper', 'beam', 'grove', ...META_ORDER.filter((id) => !META[id].needsDawn)]);
    // 적혀 있으면 적힌 것만 안다.
    expect(normalizeMeta({ runs: 2, known: ['keeper', 'grove', 'sift', 'nothing', 'vigor'] }).known).toEqual([
      'keeper',
      'grove',
      'vigor',
      'sift',
    ]);
    expect(meta.fresh).toEqual(['mooner']);
  });
});

describe('공유받은 친구 기록', () => {
  const day = 20_770;

  it('받은 점수를 그날의 것으로 적고, 같은 날에는 가장 높은 것을 둔다', () => {
    const met = meetFriend(createDefaultMeta(), day, 333);
    expect(met.friend).toEqual({ day, score: 333 });
    expect(meetFriend(met, day, 200)).toBe(met);
    expect(meetFriend(met, day, 333)).toBe(met);
    expect(meetFriend(met, day, 500).friend).toEqual({ day, score: 500 });
    // 다른 날에 받은 것은 낮아도 새것으로 바꾼다.
    expect(meetFriend(met, day + 1, 10).friend).toEqual({ day: day + 1, score: 10 });
  });

  it('판을 마쳐도 남고, 저장했다가 다시 읽어도 같다', () => {
    const met = meetFriend(createDefaultMeta(), day, 333);
    expect(applyRun(met, result({ seconds: 30 })).friend).toEqual({ day, score: 333 });
    expect(normalizeMeta(JSON.parse(JSON.stringify(met))).friend).toEqual({ day, score: 333 });
  });

  it('모양이 아닌 값은 버린다', () => {
    for (const bad of [null, 3, { day }, { score: 5 }, { day, score: 0 }, { day: 0, score: 5 }, { day, score: 1_000_000 }]) {
      expect(normalizeMeta({ friend: bad }).friend, JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('늘어난 영구 강화', () => {
  it('열여섯 가지이고 모두 살 수 있는 값이 있다', () => {
    expect(META_ORDER).toHaveLength(16);
    for (const id of META_ORDER) {
      expect(metaCost(id, 0)).toBeGreaterThan(0);
      expect(metaCost(id, META[id].maxLevel)).toBeNull();
    }
  });

  it('불씨 복은 한 판에서 얻는 불씨를 늘린다', () => {
    const run: RunSummary = {
      seconds: 400,
      endlessSeconds: 0,
      kills: 500,
      countedKills: 500,
      level: 14,
      cleared: false,
      bonusEmbers: 0,
      bossKills: 2,
      depth: 0,
    };
    const plain = embersFor(run);
    expect(embersFor(run, 0)).toBe(plain);
    expect(embersFor(run, 3)).toBe(Math.floor(plain * 1.3));
    expect(embersFor(run, 1)).toBeGreaterThan(plain);
  });
});
