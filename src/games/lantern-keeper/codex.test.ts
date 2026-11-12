import { describe, expect, it } from 'vitest';
import {
  CODEX,
  CODEX_IDS,
  CODEX_TABS,
  discover,
  entriesOf,
  evolvedId,
  foundCount,
  isOpen,
  MET_IDS,
  normalizeCodex,
  unreadIn,
  type CodexProgress,
} from './codex';
import { ENEMIES, PASSIVES, STAGE_ORDER, STAGES, WEAPON_ORDER } from './data';
import { ICON_IDS } from './icons';
import { applyRun, createDefaultMeta, normalizeMeta, readEntries, type RunResult } from './meta';
import { seededRandom } from './rules';
import { createRun, Sim } from './sim';

const empty: CodexProgress = { codex: [], unread: [], stats: { evolved: [] } };
const entry = (id: string) => CODEX.find((item) => item.id === id)!;

describe('도감의 내용', () => {
  it('항목의 이름은 하나씩뿐이고, 모든 항목이 네 쪽 가운데 하나에 든다', () => {
    expect(new Set(CODEX_IDS).size).toBe(CODEX_IDS.length);
    const tabs = CODEX_TABS.map((tab) => tab.id);
    expect(CODEX.every((item) => tabs.includes(item.tab))).toBe(true);
    expect(tabs.reduce((sum, tab) => sum + entriesOf(tab).length, 0)).toBe(CODEX.length);
  });

  it('무기는 진화형까지, 패시브는 모두, 그림자는 나올 수 있는 종류가 모두 들어 있다', () => {
    for (const id of WEAPON_ORDER) {
      expect(CODEX_IDS).toContain(id);
      expect(CODEX_IDS).toContain(evolvedId(id));
    }
    for (const id of Object.keys(PASSIVES)) expect(CODEX_IDS).toContain(id);
    const foes = entriesOf('foes').map((item) => item.id);
    expect([...foes].sort()).toEqual(Object.keys(ENEMIES).sort());
  });

  it('그림자는 스테이지마다 한 줄이고, 줄 안에서는 나오는 차례대로 놓이며 끝에 마지막 보스가 온다', () => {
    STAGE_ORDER.forEach((stage, row) => {
      const line = entriesOf('foes')
        .filter((item) => item.row === row)
        .map((item) => item.id);
      const spawns = [...STAGES[stage].spawns].sort((a, b) => a.from - b.from).map((spawn) => spawn.kind);
      expect(line).toEqual([...spawns, STAGES[stage].finalBoss]);
    });
  });

  it('한 줄에는 일곱 칸까지만 놓인다', () => {
    for (const tab of CODEX_TABS) {
      const rows = new Map<number, number>();
      for (const item of entriesOf(tab.id)) rows.set(item.row, (rows.get(item.row) ?? 0) + 1);
      expect(Math.max(...rows.values())).toBeLessThanOrEqual(7);
    }
  });

  it('모든 항목에 이름과 설명이 있고, 가려 두는 항목에는 열리기 전에 보일 글이 있다', () => {
    for (const item of CODEX) {
      expect(item.name.length).toBeGreaterThan(0);
      expect(item.note.length).toBeGreaterThan(0);
      expect(item.text.length).toBeGreaterThan(0);
      if (item.secret) expect(item.hint?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('무기와 패시브 항목에는 아이콘이 있다', () => {
    for (const item of [...entriesOf('weapons'), ...entriesOf('passives')]) expect(ICON_IDS).toContain(item.id);
  });
});

describe('도감이 열리는 규칙', () => {
  it('무기와 패시브, 빛 조각은 처음부터 열려 있고 나머지는 가려져 있다', () => {
    for (const id of WEAPON_ORDER) expect(isOpen(entry(id), empty)).toBe(true);
    for (const item of entriesOf('passives')) expect(isOpen(item, empty)).toBe(true);
    expect(isOpen(entry('gem'), empty)).toBe(true);
    for (const item of entriesOf('foes')) expect(isOpen(item, empty)).toBe(false);
    for (const id of ['heal', 'pull', 'blast', 'post']) expect(isOpen(entry(id), empty)).toBe(false);
    for (const id of WEAPON_ORDER) expect(isOpen(entry(evolvedId(id)), empty)).toBe(false);
    expect(foundCount(empty)).toEqual({ found: 0, total: MET_IDS.length + WEAPON_ORDER.length });
  });

  it('판에서 만난 것이 열리고, 새로 열린 것은 들여다볼 때까지 표시가 남는다', () => {
    const first = discover(empty, ['shade', 'bat', 'heal', 'post', '모르는 것'], []);
    expect(first.codex).toEqual(['shade', 'bat', 'heal', 'post']);
    expect(first.unread).toEqual(['shade', 'bat', 'heal', 'post']);
    const progress = { ...empty, ...first };
    expect(isOpen(entry('shade'), progress)).toBe(true);
    expect(isOpen(entry('wisp'), progress)).toBe(false);
    expect(unreadIn('foes', progress)).toBe(2);
    expect(unreadIn('finds', progress)).toBe(2);
    expect(foundCount(progress).found).toBe(4);
    // 이미 만난 것을 또 만나도 새 표시가 붙지 않는다.
    const read = { ...progress, unread: [] };
    const second = discover(read, ['shade', 'wisp'], []);
    expect(second.codex).toEqual(['shade', 'bat', 'wisp', 'heal', 'post']);
    expect(second.unread).toEqual(['wisp']);
  });

  it('진화형은 그 무기를 처음 진화시킨 판에서 열린다', () => {
    const first = discover(empty, [], ['star']);
    expect(first.unread).toEqual([evolvedId('star')]);
    const progress: CodexProgress = { ...empty, ...first, stats: { evolved: ['star'] } };
    expect(isOpen(entry(evolvedId('star')), progress)).toBe(true);
    expect(isOpen(entry(evolvedId('ember')), progress)).toBe(false);
    // 다음 판에 또 진화시켜도 새 표시는 붙지 않는다.
    expect(discover({ ...progress, unread: [] }, [], ['star']).unread).toEqual([]);
  });

  it('저장된 기록에서 모르는 이름과 엉뚱한 값은 버린다', () => {
    expect(normalizeCodex(['bat', 'ember', 'nope', 3, 'shade'], ['starEvo', 'bat', null])).toEqual({
      codex: ['shade', 'bat'],
      unread: ['starEvo', 'bat'],
    });
    expect(normalizeCodex('x', undefined)).toEqual({ codex: [], unread: [] });
  });
});

describe('도감과 저장', () => {
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

  it('판이 끝나면 만난 것이 도감에 적히고, 들여다보면 새 표시가 사라진다', () => {
    const after = applyRun(createDefaultMeta(), result({ seen: ['shade', 'giant', 'pull'], evolved: ['ember'] }));
    expect(after.codex).toEqual(['shade', 'giant', 'pull']);
    expect(after.unread).toEqual([evolvedId('ember'), 'shade', 'giant', 'pull']);
    const read = readEntries(after, ['shade', 'giant']);
    expect(read.unread).toEqual([evolvedId('ember'), 'pull']);
    expect(read.codex).toEqual(after.codex);
    // 읽을 것이 없으면 그대로 돌려준다.
    expect(readEntries(read, ['shade'])).toBe(read);
  });

  it('만난 것이 적히지 않은 결과(예전 판)도 그대로 반영된다', () => {
    const after = applyRun(createDefaultMeta(), result());
    expect(after.codex).toEqual([]);
    expect(after.unread).toEqual([]);
    expect(after.runs).toBe(1);
  });

  it('도감이 생기기 전의 저장은 빈 도감으로 읽히고, 도감 기록은 저장했다 읽어도 그대로다', () => {
    const old = normalizeMeta({ embers: 40, runs: 5, bestSeconds: 300 });
    expect(old.codex).toEqual([]);
    expect(old.unread).toEqual([]);
    const meta = applyRun(old, result({ seen: ['drip', 'toad'] }));
    expect(normalizeMeta(JSON.parse(JSON.stringify(meta)))).toEqual(meta);
  });
});

describe('판에서 만난 것 적기', () => {
  const config = { viewW: 240, viewH: 520, meta: {} };

  it('나타난 적의 종류와 등불 기둥이 적히고, 같은 것은 한 번만 적힌다', () => {
    const sim = new Sim(createRun(config), seededRandom(4));
    for (let i = 0; i < 60 * 100; i += 1) {
      while (sim.state.pendingLevelUps > 0) sim.applyUpgrade(sim.options()[0]);
      // 쓰러지지 않게 체력을 채워 가며 버틴다.
      sim.state.player.hp = sim.maxHp;
      sim.step(1 / 60, 0, 0);
    }
    expect(sim.state.over).toBeNull();
    const seen = sim.state.seen!;
    expect(seen).toContain('shade');
    expect(seen).toContain('bat');
    expect(seen).toContain('post');
    expect(seen).not.toContain('lord');
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('주운 것은 주웠을 때 적힌다', () => {
    const sim = new Sim(createRun(config), seededRandom(1));
    sim.state.weapons = {};
    sim.state.spawnDebt = -1e6;
    const p = sim.state.player;
    sim.state.gems.push({ x: p.x + 300, y: p.y, value: 0, kind: 'pull', pulled: false });
    sim.step(1 / 60, 0, 0);
    expect(sim.state.seen).not.toContain('pull');
    sim.state.gems[0].x = p.x;
    sim.step(1 / 60, 0, 0);
    expect(sim.state.seen).toContain('pull');
    // 빛 조각은 도감에 처음부터 열려 있으므로 적지 않는다.
    sim.state.gems.push({ x: p.x, y: p.y, value: 1, kind: 'xp', pulled: false });
    sim.step(1 / 60, 0, 0);
    expect(sim.state.seen).not.toContain('xp');
  });

  it('도감이 생기기 전에 저장한 판은 지금 싸움터에 있는 것부터 적는다', () => {
    const state = createRun(config);
    const sim = new Sim(state, seededRandom(2));
    for (let i = 0; i < 60 * 20; i += 1) sim.step(1 / 60, 0, 0);
    const kinds = [...new Set(state.enemies.map((e) => e.kind))];
    expect(kinds.length).toBeGreaterThan(0);
    const old = JSON.parse(JSON.stringify(state)) as typeof state;
    delete old.seen;
    const resumed = new Sim(old, seededRandom(2));
    expect([...resumed.state.seen!].sort()).toEqual([...kinds].sort());
  });
});
