/**
 * 오늘의 목표: 날마다 바뀌는 목표 세 가지. 채우면 허브의 코인을 받는다.
 * 기기의 날짜만 보므로 인터넷이 필요 없다. 화면과 저장소 어느 쪽에도 기대지 않는 순수 함수들이다.
 */
import { seededUnit } from '../../core/daily';

export interface GoalDef {
  /** 목표를 한 줄로 적는다. */
  text: (target: number) => string;
  /** 쉬운 것부터 어려운 것까지의 목표 수. 날짜에서 하나를 뽑는다. */
  targets: readonly number[];
  /** 이 사무실부터 나온다. 그 전에는 할 수 없는 일이기 때문이다. */
  unlockOffice: number;
}

export const GOALS = {
  release: { text: (target) => `게임 ${target}번 출시하기`, targets: [2, 3, 4], unlockOffice: 0 },
  task: { text: (target) => `업무 ${target}개 끝내기`, targets: [10, 16, 24], unlockOffice: 0 },
  cheer: { text: (target) => `응원 ${target}번 하기`, targets: [15, 25, 40], unlockOffice: 0 },
  upgrade: { text: (target) => `장비 ${target}번 올리기`, targets: [3, 5, 8], unlockOffice: 0 },
  train: { text: (target) => `교육 ${target}번 하기`, targets: [2, 3, 5], unlockOffice: 1 },
  rush: { text: (target) => `급한 의뢰 ${target}번 성공하기`, targets: [1, 2, 3], unlockOffice: 1 },
} as const satisfies Record<string, GoalDef>;

export type GoalKind = keyof typeof GOALS;
export const GOAL_KINDS = Object.keys(GOALS) as GoalKind[];

/** 하루에 나오는 목표의 수 */
export const GOAL_COUNT = 3;
/** 목표 하나를 채우면 받는 코인 */
export const GOAL_REWARD = 5;
/** 출시로 받는 코인의 하루 상한. 오래 켜 두어도 코인이 끝없이 나오지 않게 한다. */
export const RELEASE_COINS_PER_DAY = 20;

export interface Goal {
  kind: GoalKind;
  target: number;
}

/** 세이브에 남기는 오늘의 목표 */
export interface GoalsState {
  /** 이 목표가 정해진 날(YYYY-MM-DD). 날이 바뀌면 새로 정한다. */
  day: string;
  /** 그날의 목표. 하루 동안은 이사를 해도 바뀌지 않는다. */
  list: Goal[];
  /** 목표마다의 진행 */
  progress: number[];
  /** 목표마다 보상을 받았는지 */
  claimed: boolean[];
  /** 오늘 출시로 받은 코인 */
  releaseCoins: number;
}

const isGoalKind = (value: unknown): value is GoalKind => typeof value === 'string' && value in GOALS;

/**
 * 그 날짜와 사무실에 맞는 목표를 정한다. 같은 날짜와 사무실이면 언제나 같다.
 * skip에 적힌 것은 고르지 않는다. 더 올릴 것이 남지 않아서 채울 수 없는 목표를 빼는 데 쓴다.
 */
export function goalsFor(day: string, office: number, skip: readonly GoalKind[] = []): Goal[] {
  const open = GOAL_KINDS.filter((kind) => (GOALS[kind] as GoalDef).unlockOffice <= office && !skip.includes(kind));
  // 날짜에서 뽑은 수로 줄을 세워 앞의 셋을 고른다. 날마다 다른 조합이 나온다.
  const ranked = open
    .map((kind) => ({ kind, order: seededUnit(`${day}:${kind}`) }))
    .sort((a, b) => a.order - b.order)
    .slice(0, GOAL_COUNT);
  return ranked.map(({ kind }) => {
    const targets = (GOALS[kind] as GoalDef).targets;
    const pick = Math.min(targets.length - 1, Math.floor(seededUnit(`${day}:${kind}:target`) * targets.length));
    return { kind, target: targets[pick] };
  });
}

export function createGoals(day = '', office = 0, skip: readonly GoalKind[] = []): GoalsState {
  const list = day === '' ? [] : goalsFor(day, office, skip);
  return { day, list, progress: list.map(() => 0), claimed: list.map(() => false), releaseCoins: 0 };
}

/** 날이 바뀌었으면 새 목표를, 아니면 그대로 돌려준다. */
export function rollGoals(goals: GoalsState, day: string, office: number, skip: readonly GoalKind[] = []): GoalsState {
  return goals.day === day ? goals : createGoals(day, office, skip);
}

/** 이 일을 amount번 한 것을 목표에 센다. 목표를 넘겨서는 세지 않는다. */
export function bumpGoals(goals: GoalsState, kind: GoalKind, amount = 1): void {
  goals.list.forEach((goal, index) => {
    if (goal.kind === kind) goals.progress[index] = Math.min(goal.target, (goals.progress[index] ?? 0) + amount);
  });
}

export function isGoalDone(goals: GoalsState, index: number): boolean {
  const goal = goals.list[index];
  return goal !== undefined && (goals.progress[index] ?? 0) >= goal.target;
}

/** 채웠지만 아직 보상을 받지 않은 목표가 있는가 */
export function hasGoalToClaim(goals: GoalsState): boolean {
  return goals.list.some((_, index) => isGoalDone(goals, index) && !goals.claimed[index]);
}

/** 채운 목표의 보상을 받은 것으로 적고, 받을 코인을 돌려준다. 받을 수 없으면 0 */
export function claimGoal(goals: GoalsState, index: number): number {
  if (!isGoalDone(goals, index) || goals.claimed[index]) return 0;
  goals.claimed[index] = true;
  return GOAL_REWARD;
}

/** 출시 한 번으로 받을 코인. 하루 상한을 채웠으면 0 */
export function takeReleaseCoin(goals: GoalsState): number {
  if (goals.releaseCoins >= RELEASE_COINS_PER_DAY) return 0;
  goals.releaseCoins += 1;
  return 1;
}

export function goalText(goal: Goal): string {
  return (GOALS[goal.kind] as GoalDef).text(goal.target);
}

/** 저장소에서 읽은 값을 안전한 GoalsState로 바꾼다. 이상하면 빈 목표가 되고, 다음에 날짜를 볼 때 새로 정해진다. */
export function normalizeGoals(raw: unknown): GoalsState {
  const empty = createGoals();
  if (typeof raw !== 'object' || raw === null) return empty;
  const from = raw as Record<string, unknown>;
  if (typeof from.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(from.day) || !Array.isArray(from.list)) return empty;
  const list: Goal[] = [];
  const progress: number[] = [];
  const claimed: boolean[] = [];
  const count = (value: unknown, max: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(0, Math.floor(value))) : 0;
  from.list.slice(0, GOAL_COUNT).forEach((entry: unknown, index: number) => {
    if (typeof entry !== 'object' || entry === null) return;
    const { kind, target } = entry as Record<string, unknown>;
    if (!isGoalKind(kind) || list.some((goal) => goal.kind === kind)) return;
    if (typeof target !== 'number' || !(GOALS[kind] as GoalDef).targets.includes(target)) return;
    list.push({ kind, target });
    progress.push(count(Array.isArray(from.progress) ? from.progress[index] : 0, target));
    claimed.push(Array.isArray(from.claimed) && from.claimed[index] === true && progress[progress.length - 1] >= target);
  });
  if (list.length === 0) return empty;
  return { day: from.day, list, progress, claimed, releaseCoins: count(from.releaseCoins, RELEASE_COINS_PER_DAY) };
}
