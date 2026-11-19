/**
 * 누가 벌레에게 얼마나 피해를 주었는지의 기록. 물총, 물벼락, 가시 울타리와 동료마다 따로 센다.
 * 시뮬레이션(sim.ts의 hurt)이 맞힐 때마다 더하고, 가게의 "피해 기록"과 동료 정보 창, 결과 화면이 읽는다.
 * 같은 동료가 밭에 여럿 서 있으면 한데 센다(물방울에는 쏜 동료의 종류만 적혀 있다).
 * 화면 없이 테스트하도록 Phaser를 부르지 않는다.
 */
import { ALLIES, ALLY_ORDER, type AllyId } from './data';

/** 피해를 준 것: 물총(물방울과 그 물보라), 물벼락, 가시 울타리, 동료 */
export type DamageSource = AllyId | 'gun' | 'storm' | 'thorns';

/** 준 것마다의 피해. 피해를 주지 않은 것은 적지 않는다. */
export type DamageTally = Partial<Record<DamageSource, number>>;

export interface DamageLog {
  /** 지금 날(지켰으면 방금 지킨 날)에 준 피해. 날이 시작될 때 비운다. */
  day: DamageTally;
  /** 이 판에서 준 피해 */
  run: DamageTally;
}

/** 늘 있는 것(물총, 물벼락, 가시)의 차례. 동료는 ALLY_ORDER를 따른다. */
const GEAR = ['gun', 'storm', 'thorns'] as const;
export const DAMAGE_SOURCES: readonly DamageSource[] = [...GEAR, ...ALLY_ORDER];

export const emptyDamage = (): DamageLog => ({ day: {}, run: {} });

export const isDamageSource = (value: string): value is DamageSource =>
  (GEAR as readonly string[]).includes(value) || Object.hasOwn(ALLIES, value);

/** 피해를 적는다. 시뮬레이션이 맞힐 때마다 부르므로 가볍게 둔다. */
export function addDamage(log: DamageLog, source: DamageSource, amount: number): void {
  if (!(amount > 0)) return;
  log.day[source] = (log.day[source] ?? 0) + amount;
  log.run[source] = (log.run[source] ?? 0) + amount;
}

/** 화면에 적는 글. 한글은 글꼴에 들어 있는 글자만 쓴다(damage.test.ts가 확인한다). */
export const DAMAGE_TEXT = {
  title: '피해 기록',
  /** 가게에서 피해 기록을 여는 단추 */
  open: '피해 보기',
  today: (day: number) => `${day}일째`,
  run: '이번 판',
  empty: '아직 준 피해가 없어요',
  close: '닫기',
  /** 다 적지 못한 나머지를 한 줄로 */
  rest: (count: number) => `그 밖 ${count}`,
  /** 동료 정보 창: 이 판에서 그 동료가 준 피해. 같은 동료가 여럿이면 몇이 함께 준 것인지도 적는다. */
  allyRun: (amount: number, share: number, together: number) =>
    `이번 판 피해 ${damageLabel(amount)} (${share}%)${together > 1 ? ` · ${together}마리 합` : ''}`,
  /** 결과 화면의 한 줄 */
  resultLabel: '가장 큰 피해',
  resultValue: (name: string, share: number) => `${name} ${share}%`,
} as const;

/** 짧게 적는 이름 */
export function sourceName(source: DamageSource): string {
  switch (source) {
    case 'gun':
      return '물총';
    case 'storm':
      return '물벼락';
    case 'thorns':
      return '가시';
    default:
      return ALLIES[source].name;
  }
}

/** 피해의 수를 짧게: 1,234 · 12,345 · 12.3만 · 123만 · 1.2억 */
export function damageLabel(amount: number): string {
  const value = Math.max(0, Math.round(amount));
  if (value < 100_000) return value.toLocaleString('en-US');
  if (value < 100_000_000) {
    const man = value / 10_000;
    return `${man < 100 ? Number(man.toFixed(1)) : Math.round(man).toLocaleString('en-US')}만`;
  }
  const eok = value / 100_000_000;
  return `${eok < 100 ? Number(eok.toFixed(1)) : Math.round(eok).toLocaleString('en-US')}억`;
}

export interface DamageRow {
  source: DamageSource;
  amount: number;
  /** 모두가 준 피해 가운데 이것의 몫(0~1) */
  share: number;
}

/** 피해를 준 것들을 많이 준 차례로. 같으면 DAMAGE_SOURCES의 차례다. 피해가 없으면 빈 목록이다. */
export function damageRows(tally: DamageTally): DamageRow[] {
  let total = 0;
  for (const source of DAMAGE_SOURCES) total += tally[source] ?? 0;
  if (!(total > 0)) return [];
  const rows: DamageRow[] = [];
  for (const source of DAMAGE_SOURCES) {
    const amount = tally[source] ?? 0;
    if (amount > 0) rows.push({ source, amount, share: amount / total });
  }
  return rows.sort((a, b) => b.amount - a.amount);
}

/** 몫을 백분율의 정수로. 조금이라도 준 것은 0%로 적지 않는다. */
export const sharePercent = (share: number): number => (share > 0 ? Math.max(1, Math.round(share * 100)) : 0);

/** 저장에서 읽은 기록이 맞는 모양인지. 값은 0 이상 limit 이하의 수만 받는다. */
export function isDamageLog(value: unknown, limit: number): value is DamageLog {
  const tallyFits = (tally: unknown): boolean =>
    typeof tally === 'object' &&
    tally !== null &&
    !Array.isArray(tally) &&
    Object.entries(tally).every(
      ([key, amount]) => isDamageSource(key) && typeof amount === 'number' && Number.isFinite(amount) && amount >= 0 && amount <= limit,
    );
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const log = value as Record<string, unknown>;
  return tallyFits(log.day) && tallyFits(log.run);
}
