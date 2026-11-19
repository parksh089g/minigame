import { describe, expect, it } from 'vitest';
import { placeAlly } from './allies';
import { botShop } from './bot';
import { ALLY_ORDER, ENEMIES, FIELD, SUMMON, type EnemyKind } from './data';
import {
  addDamage,
  DAMAGE_SOURCES,
  DAMAGE_TEXT,
  damageLabel,
  damageRows,
  emptyDamage,
  isDamageLog,
  sharePercent,
  sourceName,
} from './damage';
import { readRunRecord, runRecord } from './saved-run';
import { toVersion3 } from './legacy-run.testutil';
import { allyInfo } from './shop-text';
import { createRun, step, type Enemy, type RunState } from './sim';

const DT = 1 / 60;
const T = 1_700_000_000_000;

/** 첫날 앞 가게를 닫고, 나올 벌레를 치운 빈 판 */
function emptied(levels = {}): RunState {
  const { state } = createRun({ seed: 3, startDay: 1, levels, bestBefore: 0 });
  step(state, 0, { aim: null, storm: false, ready: true });
  state.queue = [];
  state.dayTotal = 0;
  return state;
}

function put(state: RunState, kind: EnemyKind, x: number, y: number, hp = 1e6): Enemy {
  const enemy: Enemy = {
    id: state.nextId++,
    kind,
    x,
    y,
    homeX: x,
    hp,
    maxHp: hp,
    day: state.day,
    biting: false,
    biteIn: ENEMIES[kind].biteEvery,
    clock: 0,
    slow: 0,
    slowLeft: 0,
    summonIn: SUMMON.every,
    flash: 0,
  };
  state.enemies.push(enemy);
  state.dayTotal += 1;
  return enemy;
}

const total = (tally: Partial<Record<string, number>>): number =>
  Object.values(tally).reduce<number>((sum, value) => sum + (value ?? 0), 0);

/** 주아 글꼴에 들어 있는 한글: KS X 1001의 완성형 2,350자(how-to.test.ts와 같은 셈) */
function fontSyllables(): Set<string> {
  const decoder = new TextDecoder('euc-kr');
  const syllables = new Set<string>();
  for (let lead = 0xb0; lead <= 0xc8; lead += 1) {
    for (let trail = 0xa1; trail <= 0xfe; trail += 1) syllables.add(decoder.decode(new Uint8Array([lead, trail])));
  }
  return syllables;
}

describe('피해 기록의 셈(damage.ts)', () => {
  it('많이 준 차례로 늘어놓고 몫을 셈한다', () => {
    const log = emptyDamage();
    addDamage(log, 'frog', 30);
    addDamage(log, 'gun', 60);
    addDamage(log, 'frog', 10);
    addDamage(log, 'storm', 0);
    expect(damageRows(log.day)).toEqual([
      { source: 'gun', amount: 60, share: 0.6 },
      { source: 'frog', amount: 40, share: 0.4 },
    ]);
    expect(log.run).toEqual(log.day);
    expect(damageRows({})).toEqual([]);
    expect(sharePercent(0.001)).toBe(1);
    expect(sharePercent(0)).toBe(0);
  });

  it('큰 수는 짧게 적는다', () => {
    expect(damageLabel(0)).toBe('0');
    expect(damageLabel(1234.4)).toBe('1,234');
    expect(damageLabel(99_999)).toBe('99,999');
    expect(damageLabel(123_456)).toBe('12.3만');
    expect(damageLabel(12_345_678)).toBe('1,235만');
    expect(damageLabel(150_000_000)).toBe('1.5억');
  });

  it('저장에서 읽은 기록의 모양을 본다', () => {
    expect(isDamageLog({ day: {}, run: { gun: 3, frog: 2 } }, 1e9)).toBe(true);
    expect(isDamageLog({ day: {}, run: { laser: 3 } }, 1e9)).toBe(false);
    expect(isDamageLog({ day: {}, run: { gun: -1 } }, 1e9)).toBe(false);
    expect(isDamageLog({ day: [], run: {} }, 1e9)).toBe(false);
    expect(isDamageLog({ run: {} }, 1e9)).toBe(false);
    expect(isDamageLog(null, 1e9)).toBe(false);
  });

  it('글이 글꼴에 있는 글자만 쓴다', () => {
    const known = fontSyllables();
    const texts: string[] = [
      ...DAMAGE_SOURCES.map(sourceName),
      ...Object.values(DAMAGE_TEXT).flatMap((value) => (typeof value === 'string' ? [value] : [])),
      DAMAGE_TEXT.today(12),
      DAMAGE_TEXT.rest(3),
      DAMAGE_TEXT.allyRun(123_456, 31, 2),
      DAMAGE_TEXT.resultValue('물총', 60),
      damageLabel(1e7),
      damageLabel(1e9),
    ];
    for (const text of texts) {
      for (const char of text) {
        if (/[가-힣]/.test(char)) expect(known.has(char), `${text}: ${char}`).toBe(true);
      }
    }
  });
});

describe('시뮬레이션이 적는 피해', () => {
  it('물총, 물보라, 동료, 물벼락, 가시가 준 피해를 저마다 적고, 남은 체력을 넘는 몫은 적지 않는다', () => {
    const state = emptied({ splash: 2, storm: 1, thorn: 2 });
    placeAlly(state, 'frog', 1);
    const near = put(state, 'ant', 120, 120, 40);
    const other = put(state, 'ant', 128, 124, 40);
    const tough = put(state, 'ant', 60, FIELD.depth - ENEMIES.ant.radius, 1e6);
    for (let time = 0; time < 3; time += DT) step(state, DT, { aim: null, storm: false });
    state.stormIn = 0;
    step(state, DT, { aim: null, storm: true });
    for (let time = 0; time < 3; time += DT) step(state, DT, { aim: null, storm: false });
    const { day, run } = state.dealt;
    expect(day.gun).toBeGreaterThan(0);
    expect(day.frog).toBeGreaterThan(0);
    expect(day.storm).toBeGreaterThan(0);
    expect(day.thorns).toBeGreaterThan(0);
    expect(run).toEqual(day);
    // 쓰러진 두 마리는 체력만큼만 센다. 남은 한 마리는 깎인 만큼이다.
    expect(near.hp <= 0 && other.hp <= 0).toBe(true);
    const lost = 40 + 40 + (tough.maxHp - Math.max(0, tough.hp));
    expect(total(day)).toBeCloseTo(lost, 4);
  });

  it('날이 시작되면 그날의 기록만 비우고, 이 판의 기록은 남는다', () => {
    const { state } = createRun({
      seed: 5,
      startDay: 1,
      levels: { power: 4 },
      bestBefore: 0,
    });
    let cleared = 0;
    for (let time = 0; time < 400 && cleared < 2; time += DT) {
      for (const event of step(state, DT, {
        aim: null,
        storm: false,
        ...botShop(state),
      })) {
        if (event.type === 'dayClear') {
          cleared += 1;
          if (cleared === 1) expect(state.dealt.run).toEqual(state.dealt.day);
        }
      }
    }
    expect(cleared).toBe(2);
    expect(total(state.dealt.run)).toBeGreaterThan(total(state.dealt.day));
    expect(total(state.dealt.day)).toBeGreaterThan(0);
  });
});

describe('피해 기록의 저장', () => {
  it('적었다가 읽어도 그대로이고, 기록이 생기기 전의 판은 빈 기록으로 이어 한다', () => {
    const state = emptied();
    addDamage(state.dealt, 'gun', 12);
    addDamage(state.dealt, 'sunflower', 5);
    const restored = readRunRecord(JSON.parse(JSON.stringify(runRecord({ state, banked: 0, bankedShards: 0 }, T)))).run!;
    expect(restored.state.dealt).toEqual(state.dealt);

    const old = JSON.parse(JSON.stringify(runRecord({ state, banked: 0, bankedShards: 0 }, T)));
    delete old.run.state.dealt;
    expect(readRunRecord(old).run!.state.dealt).toEqual(emptyDamage());
    // 동료가 생기기 전(버전 3)의 판도 그렇다.
    const older = toVersion3(state);
    delete older.dealt;
    const legacy = readRunRecord({
      version: 3,
      savedAt: T,
      run: { state: older, banked: 0, bankedShards: 0 },
    }).run;
    expect(legacy?.state.dealt).toEqual(emptyDamage());
  });

  it('기록이 망가졌으면 판은 버리지 않고 기록만 비운다', () => {
    const state = emptied();
    const record = JSON.parse(JSON.stringify(runRecord({ state, banked: 0, bankedShards: 0 }, T)));
    record.run.state.dealt = { day: { gun: 'lots' }, run: 3 };
    const restored = readRunRecord(record).run;
    expect(restored).not.toBeNull();
    expect(restored!.state.dealt).toEqual(emptyDamage());
  });
});

describe('동료 정보 창의 피해 줄', () => {
  it('밭의 동료에게만, 피해를 준 뒤에 적고 같은 동료가 여럿이면 함께 센다', () => {
    const state = emptied();
    placeAlly(state, 'frog', 1);
    expect(allyInfo(state, 'frog', 1, 0).dealt).toBeNull();
    addDamage(state.dealt, 'frog', 1234);
    addDamage(state.dealt, 'gun', 766);
    expect(allyInfo(state, 'frog', 1, 0).dealt).toBe('이번 판 피해 1,234 (62%)');
    expect(allyInfo(state, 'frog').dealt).toBeNull();
    placeAlly(state, 'frog', 1);
    expect(allyInfo(state, 'frog', 1, 1).dealt).toBe('이번 판 피해 1,234 (62%) · 2마리 합');
    expect(ALLY_ORDER).toContain('frog');
  });
});
