/**
 * 주간 미션: 월요일마다 바뀌는 세 가지 목표. 한 주 동안 한 판 수와 얻은 코인을 세어서 채우고,
 * 다 채운 미션은 업적 화면에서 눌러 코인을 받는다.
 * 미션은 그 주의 날짜만으로 정해지므로 인터넷이 없어도 되고, 같은 주에는 어느 기기에서나 같은 미션이 나온다.
 * 저장소와 화면 어느 쪽에도 의존하지 않는 순수 함수들이다.
 */
import { dateKeyOfDay, dayNumber, seededUnit } from './daily';

/** 미션이 게임을 묶는 갈래. 갈래가 없는 게임(둘이서 대결, 등불지기)은 "아무 게임이나"에만 들어간다. */
export const GENRES = ['puzzle', 'action'] as const;
export type Genre = (typeof GENRES)[number];

export const GENRE_LABEL: Record<Genre, string> = {
  puzzle: '퍼즐',
  action: '순발력',
};

/** [목표, 보상] 세 단계. 그 주에 어느 단계가 나올지는 날짜에서 뽑는다. */
export type Tiers = readonly (readonly [goal: number, reward: number])[];

/**
 * 큰 게임 미션의 모양. 한 판이 길거나 판이 끝나지 않고 이어지는 게임(등불지기, 새싹 컴퍼니)은
 * "이번 주의 게임"에 나오지 않는 대신, 몇 주에 한 번 이 모양으로 따로 나온다.
 */
export interface BigMission {
  /** 목표를 받아 미션의 이름을 짓는다. 업적 화면 한 줄에 들어가게 짧게 */
  title: (goal: number) => string;
  /** 덧붙이는 한마디. 한글 14자 안팎 */
  description: string;
  /** 그 게임에 맞는 [목표, 보상] 세 단계 */
  tiers: Tiers;
}

/** 미션을 정할 때 보는 게임의 모습 */
export interface WeeklyGame {
  id: string;
  title: string;
  genre: Genre | null;
  /** 한 판이 짧아서 "이 게임 몇 판" 미션으로 내도 되는지 */
  quick: boolean;
  /** 큰 게임이면 그 미션의 모양. 없으면 큰 게임 미션에 나오지 않는다. */
  big?: BigMission;
}

/** 한 주의 미션 세 개. 쉬운 것부터 차례로 하나씩 나오고, 세이브에는 이 이름으로 남는다. */
export const MISSION_IDS = ['easy', 'normal', 'hard'] as const;
export type MissionId = (typeof MISSION_IDS)[number];

export type MissionKind =
  /** 아무 게임이나 몇 판 */
  | 'plays'
  /** 서로 다른 게임 몇 가지 */
  | 'variety'
  /** 한 갈래의 게임 몇 판 */
  | 'genre'
  /** 정해진 게임 몇 판 */
  | 'game'
  /** 게임으로 코인 몇 개 */
  | 'coins'
  /** 오늘의 도전 몇 번 */
  | 'daily'
  /** 큰 게임(등불지기, 새싹 컴퍼니) 가운데 하나를 몇 판. 새싹 컴퍼니는 출시 한 번이 한 판이다. */
  | 'big';

export interface WeeklyMission {
  id: MissionId;
  kind: MissionKind;
  /** 무엇을 하면 되는지. 업적 화면 한 줄에 들어가도록 한글 11자 안팎 */
  title: string;
  /** 덧붙이는 한마디. 한글 14자 안팎 */
  description: string;
  /** 이 값 이상이면 달성 */
  goal: number;
  /** 보상 코인 */
  reward: number;
  /** 판 수를 세는 게임의 id. 갈래 미션, 게임 미션, 큰 게임 미션에만 있고, 없으면 모든 게임을 센다. */
  counts?: readonly string[];
}

/**
 * 미션을 정하는 규칙의 판. 규칙이 바뀌면 1씩 올린다. 주간 기록에 그 주를 시작한 규칙을 적어 두어서,
 * 새 버전이 깔려도 이미 채우던 그 주의 미션은 바뀌지 않는다(WeeklyState.rules).
 * 1: 첫 규칙. 2: 보통 미션에 큰 게임 미션이 끼어든다.
 */
export const MISSION_RULES = 2;

/** 세이브에 남기는 이번 주의 기록 */
export interface WeeklyState {
  /** 이 기록이 속한 주(그 주 월요일의 날짜, YYYY-MM-DD). 아직 한 판도 하지 않았으면 null */
  weekKey: string | null;
  /** 게임 id → 이번 주에 한 판 수 */
  plays: Record<string, number>;
  /** 이번 주에 게임을 해서 얻은 코인(오늘의 도전 보상까지). 업적이나 미션의 보상은 세지 않는다. */
  coins: number;
  /** 이번 주에 오늘의 도전을 달성한 횟수 */
  dailyClears: number;
  /** 이번 주에 보상을 받은 미션 */
  claimed: MissionId[];
  /**
   * 이번 주의 "정해진 게임 몇 판" 미션에 뽑힌 게임의 id. 그 주의 첫 판을 기록할 때 적어 둔다.
   * 주 중간에 게임이 늘어난 버전이 깔려도 채우던 미션이 다른 게임으로 바뀌지 않게 하려는 것이다.
   * 그런 미션이 없는 주에는 적지 않는다. 큰 게임 미션이 나온 주에는 그 게임을 적는다.
   */
  pick?: string;
  /**
   * 이 주의 미션을 정한 규칙의 판(MISSION_RULES). 그 주의 첫 판을 기록할 때 그때의 규칙이 적힌다.
   * 이것이 생기기 전에 시작한 주의 기록에는 없고, 그때는 1이다.
   */
  rules?: number;
}

/** 지금 따지는 주와 그 주의 미션 */
export interface WeekContext {
  weekKey: string;
  missions: readonly WeeklyMission[];
  /**
   * 미션을 뽑은 게임 목록. 있으면 주가 바뀐 뒤 첫 판을 기록할 때 지난주 미션을 다시 뽑아서,
   * 다 채우고도 받지 않은 보상을 먼저 넣어 줄 수 있다(save.ts의 applyPlayResult).
   */
  games?: readonly WeeklyGame[];
}

const DAYS_IN_WEEK = 7;
/**
 * 기록의 주가 오늘의 주보다 이보다 많이(일) 앞서 있으면 기기 시계가 틀려 있던 때의 기록으로 보고 버린다.
 * 한 주까지는 시계를 되돌린 것으로 보고 기록을 따른다.
 */
const MAX_AHEAD_DAYS = DAYS_IN_WEEK;
/** 날짜 수 0(1970년 1월 1일)은 목요일이라, 3을 더하면 월요일이 7의 배수가 된다. */
const MONDAY_SHIFT = 3;

const TIERS: Record<Exclude<MissionKind, 'big'>, Tiers> = {
  plays: [[8, 25], [10, 30], [12, 35]],
  variety: [[3, 25], [4, 30], [5, 35]],
  genre: [[5, 45], [6, 50], [8, 60]],
  game: [[3, 45], [4, 50], [5, 60]],
  coins: [[60, 70], [80, 80], [100, 90]],
  // 주말에 시작해도 채울 수 있게 많아야 나흘이다.
  daily: [[2, 70], [3, 80], [4, 90]],
};

const GENRE_HINT: Record<Genre, string> = {
  puzzle: '머리를 쓰는 게임이에요',
  action: '손이 빨라야 하는 게임이에요',
};

/** 갈래 미션의 설명에 예로 드는 게임 이름의 가장 긴 길이. 두 개를 나란히 적어도 한 줄에 들어가는 길이다. */
const EXAMPLE_TITLE_MAX = 5;

const mod = (value: number, by: number): number => ((value % by) + by) % by;

/** 그 날짜가 속한 주의 이름: 그 주 월요일의 날짜. 날짜가 잘못됐으면 null. */
export function weekKeyOf(dateKey: string): string | null {
  const day = dayNumber(dateKey);
  if (day === null) return null;
  return dateKeyOfDay(day - mod(day + MONDAY_SHIFT, DAYS_IN_WEEK));
}

/** 주마다 1씩 늘어나는 수. 미션의 종류를 주마다 돌아가며 고를 때 쓴다. */
function weekIndex(weekKey: string): number | null {
  const day = dayNumber(weekKey);
  return day === null ? null : Math.floor((day + MONDAY_SHIFT) / DAYS_IN_WEEK);
}

/**
 * 그 주가 끝날 때까지 남은 날 수(오늘 포함). 일요일이면 1, 월요일이면 7이다.
 * 기기 시계가 그 주 밖에 있어도 1에서 7 사이로 맞춘다.
 */
export function daysLeft(weekKey: string, dateKey: string): number {
  const start = dayNumber(weekKey);
  const today = dayNumber(dateKey);
  if (start === null || today === null) return DAYS_IN_WEEK;
  return Math.min(DAYS_IN_WEEK, Math.max(1, DAYS_IN_WEEK - (today - start)));
}

/** 새 주간 기록. 새로 시작하는 주는 지금의 규칙으로 미션을 정한다. */
export function createWeekly(): WeeklyState {
  return { weekKey: null, plays: {}, coins: 0, dailyClears: 0, claimed: [], rules: MISSION_RULES };
}

/** 그 기록의 주가 미션을 정한 규칙의 판. 적혀 있지 않은 옛 기록은 1이다. */
function rulesOf(state: WeeklyState): number {
  return state.rules ?? 1;
}

const isMissionId = (value: unknown): value is MissionId =>
  typeof value === 'string' && (MISSION_IDS as readonly string[]).includes(value);

/** 저장소에서 읽은 값을 안전한 WeeklyState로 바꾼다. 주가 잘못 적힌 기록은 통째로 버린다. */
export function normalizeWeekly(raw: unknown): WeeklyState {
  if (typeof raw !== 'object' || raw === null) return createWeekly();
  const value = raw as Record<string, unknown>;
  const count = (input: unknown): number =>
    typeof input === 'number' && Number.isFinite(input) ? Math.max(0, Math.floor(input)) : 0;

  // 주의 이름은 월요일이어야 한다.
  const weekKey = typeof value.weekKey === 'string' ? value.weekKey : null;
  if (weekKey === null || weekKeyOf(weekKey) !== weekKey) return createWeekly();

  const plays: Record<string, number> = {};
  if (typeof value.plays === 'object' && value.plays !== null && !Array.isArray(value.plays)) {
    for (const [id, played] of Object.entries(value.plays)) {
      if (id.length > 0 && count(played) > 0) plays[id] = count(played);
    }
  }
  const claimed: MissionId[] = [];
  if (Array.isArray(value.claimed)) {
    for (const id of value.claimed) {
      if (isMissionId(id) && !claimed.includes(id)) claimed.push(id);
    }
  }
  const pick = typeof value.pick === 'string' && value.pick.length > 0 ? value.pick : null;
  // 규칙의 판이 없으면 그 전의 기록이다(1). 이 버전이 모르는 새 판이면 아는 가장 새 판으로 본다.
  const rules = count(value.rules) > 0 ? Math.min(MISSION_RULES, count(value.rules)) : null;
  return {
    weekKey,
    plays,
    coins: count(value.coins),
    dailyClears: count(value.dailyClears),
    claimed,
    ...(pick !== null ? { pick } : {}),
    ...(rules !== null ? { rules } : {}),
  };
}

/** 기록의 주가 그 주보다 한 주 넘게 앞서 있는지. 기기 시계가 미래에 가 있을 때 남은 기록이 그렇다. */
function isFarAhead(recordWeek: string, weekKey: string): boolean {
  const record = dayNumber(recordWeek);
  const week = dayNumber(weekKey);
  return record !== null && week !== null && record - week > MAX_AHEAD_DAYS;
}

/**
 * 지금 미션을 따질 주. 오늘이 속한 주이지만, 기록이 바로 다음 주 것이면 기록의 주를 따른다.
 * 기기 시계를 되돌려 지난주의 미션을 다시 받지 못하게 하려는 것이다. 날짜가 잘못됐으면 null.
 * 기록이 한 주 넘게 앞서 있으면 시계가 미래에 가 있던 때의 기록이므로 따르지 않는다.
 * 그대로 따르면 그 주가 올 때까지 미션이 바뀌지 않는다.
 */
export function currentWeekKey(state: WeeklyState, todayKey: string): string | null {
  const today = weekKeyOf(todayKey);
  if (today === null) return null;
  // YYYY-MM-DD는 글자 순서가 날짜 순서와 같다.
  const record = state.weekKey;
  if (record !== null && record > today && !isFarAhead(record, today)) return record;
  return today;
}

/**
 * 그 주의 기록. 세이브의 기록이 그 주의 것이면 그대로, 지난주 것이거나 아직 없으면 빈 기록이다.
 * weekKey가 기록보다 앞선 주이면(currentWeekKey로 고른 주가 아니면) null이고, 그때는 아무것도 하지 않는다.
 * 다만 기록이 한 주 넘게 앞서 있으면 시계가 틀려 있던 때의 기록이라 버리고 빈 기록을 준다.
 */
export function weeklyFor(state: WeeklyState, weekKey: string): WeeklyState | null {
  if (state.weekKey === weekKey) return state;
  if (state.weekKey !== null && state.weekKey > weekKey && !isFarAhead(state.weekKey, weekKey)) return null;
  return { ...createWeekly(), weekKey };
}

function mission(
  id: MissionId,
  kind: MissionKind,
  weekKey: string,
  text: (goal: number) => { title: string; description: string },
  counts?: readonly string[],
  tiers: Tiers = TIERS[kind as Exclude<MissionKind, 'big'>],
): WeeklyMission {
  const [goal, reward] = tiers[Math.floor(seededUnit(`${weekKey}:${id}`) * tiers.length)];
  return { id, kind, goal, reward, ...text(goal), ...(counts ? { counts } : {}) };
}

function playsMission(id: MissionId, weekKey: string): WeeklyMission {
  return mission(id, 'plays', weekKey, (goal) => ({
    title: `아무 게임이나 ${goal}판`,
    description: '어떤 게임이든 좋아요',
  }));
}

function varietyMission(id: MissionId, weekKey: string): WeeklyMission {
  return mission(id, 'variety', weekKey, (goal) => ({
    title: `서로 다른 게임 ${goal}가지`,
    description: '안 해 본 게임도 해 보세요',
  }));
}

/** 그 갈래의 게임 몇 판. 어떤 게임이 그 갈래인지 알 수 있게 설명에 두 개를 예로 든다. */
function genreMission(
  id: MissionId,
  weekKey: string,
  genre: Genre,
  games: readonly WeeklyGame[],
): WeeklyMission | null {
  const members = games.filter((game) => game.genre === genre);
  if (members.length === 0) return null;
  const short = members.filter((game) => game.title.length <= EXAMPLE_TITLE_MAX);
  let description = GENRE_HINT[genre];
  if (short.length >= 2) {
    const first = Math.floor(seededUnit(`${weekKey}:${genre}`) * short.length);
    const second = (first + 1 + Math.floor(seededUnit(`${weekKey}:${genre}:2`) * (short.length - 1))) % short.length;
    description = `${short[first].title}, ${short[second].title} 같은 게임`;
  }
  return mission(
    id,
    'genre',
    weekKey,
    (goal) => ({ title: `${GENRE_LABEL[genre]} 게임 ${goal}판`, description }),
    members.map((game) => game.id),
  );
}

/**
 * 이번 주의 게임 몇 판. 한 판이 짧은 게임 가운데에서 주마다 하나를 뽑는다.
 * 목록에서 몇 번째인지로 뽑기 때문에 게임이 늘면 다른 게임이 뽑힌다. 그래서 그 주에 이미 뽑아 둔 게임(pick)이
 * 아직 목록에 있으면 그 게임을 그대로 쓴다.
 */
function gameMission(
  id: MissionId,
  weekKey: string,
  games: readonly WeeklyGame[],
  pick?: string,
): WeeklyMission | null {
  const quick = games.filter((game) => game.quick);
  if (quick.length === 0) return null;
  const game =
    quick.find((candidate) => candidate.id === pick) ??
    quick[Math.floor(seededUnit(`${weekKey}:game`) * quick.length)];
  return mission(
    id,
    'game',
    weekKey,
    (goal) => ({ title: `${game.title} ${goal}판`, description: '이번 주의 게임이에요' }),
    [game.id],
  );
}

/**
 * 큰 게임 몇 판. 이 미션이 돌아올 때마다(turn) 큰 게임을 차례로 하나씩 고른다.
 * 그 주에 이미 뽑아 둔 게임(pick)이 큰 게임이면 그 게임을 그대로 쓴다. 게임이 늘어도 채우던 미션이 바뀌지 않게.
 */
function bigMission(
  id: MissionId,
  weekKey: string,
  games: readonly WeeklyGame[],
  turn: number,
  pick?: string,
): WeeklyMission | null {
  const big = games.filter((game): game is WeeklyGame & { big: BigMission } => game.big !== undefined);
  if (big.length === 0) return null;
  const game = big.find((candidate) => candidate.id === pick) ?? big[mod(turn, big.length)];
  return mission(
    id,
    'big',
    weekKey,
    (goal) => ({ title: game.big.title(goal), description: game.big.description }),
    [game.id],
    game.big.tiers,
  );
}

function coinsMission(id: MissionId, weekKey: string): WeeklyMission {
  return mission(id, 'coins', weekKey, (goal) => ({
    title: `코인 ${goal}개 모으기`,
    description: '게임에서 얻은 코인만 세요',
  }));
}

function dailyMission(id: MissionId, weekKey: string): WeeklyMission {
  return mission(id, 'daily', weekKey, (goal) => ({
    title: `오늘의 도전 ${goal}번 달성`,
    description: '날마다 바뀌는 도전이에요',
  }));
}

/**
 * 그 주의 미션 세 개(쉬운 것부터). 종류는 주마다 차례로 돌아가서 같은 미션이 잇달아 나오지 않고,
 * 목표의 크기와 어느 게임인지는 그 주의 날짜에서 뽑는다. 주의 이름이 잘못됐으면 빈 목록이다.
 * pick은 그 주에 이미 뽑아 둔 게임이다(WeeklyState.pick). rules는 그 주를 시작한 규칙의 판이다(MISSION_RULES).
 */
export function missionsFor(
  weekKey: string,
  games: readonly WeeklyGame[],
  pick?: string,
  rules: number = MISSION_RULES,
): WeeklyMission[] {
  const index = weekIndex(weekKey);
  if (index === null || weekKeyOf(weekKey) !== weekKey) return [];

  // 쉬운 미션: 판 수와 가짓수가 한 주씩 번갈아 나온다.
  const playsFirst = mod(index, 2) === 0;
  const easy = playsFirst ? playsMission('easy', weekKey) : varietyMission('easy', weekKey);

  // 보통 미션: 퍼즐, 이번 주의 게임, 순발력이 차례로 돈다. 낼 수 없는 것은 건너뛴다.
  // 규칙 2부터는 큰 게임이 한 자리 끼어서 네 주에 한 번 나오고, 나올 때마다 큰 게임을 번갈아 고른다.
  const makers = [
    () => genreMission('normal', weekKey, 'puzzle', games),
    () => gameMission('normal', weekKey, games, pick),
    () => genreMission('normal', weekKey, 'action', games),
  ];
  if (rules >= 2 && games.some((game) => game.big !== undefined)) {
    const cycle = makers.length + 1;
    makers.unshift(() => bigMission('normal', weekKey, games, Math.floor(index / cycle), pick));
  }
  let normal: WeeklyMission | null = null;
  for (let step = 0; step < makers.length && normal === null; step += 1) {
    normal = makers[mod(index + step, makers.length)]();
  }
  // 게임 목록이 비어 있을 때만 여기까지 온다. 쉬운 미션과 겹치지 않는 쪽으로 채운다.
  normal ??= playsFirst ? varietyMission('normal', weekKey) : playsMission('normal', weekKey);

  // 어려운 미션: 코인과 오늘의 도전이 두 주씩 번갈아 나온다. 쉬운 미션과 박자가 달라서 짝이 고루 섞인다.
  const hard =
    mod(Math.floor(index / 2), 2) === 0 ? coinsMission('hard', weekKey) : dailyMission('hard', weekKey);

  return [easy, normal, hard];
}

/** 오늘 기준으로 지금 따질 주와 그 주의 미션. 날짜가 잘못됐으면 null. */
export function weekContext(
  state: WeeklyState,
  todayKey: string,
  games: readonly WeeklyGame[],
): WeekContext | null {
  const weekKey = currentWeekKey(state, todayKey);
  if (weekKey === null) return null;
  // 그 주의 기록이 있으면 뽑아 둔 게임과 그 주를 시작한 규칙을 그대로 쓴다. 없으면 지금의 규칙으로 새로 시작한다.
  const recorded = state.weekKey === weekKey;
  const pick = recorded ? state.pick : undefined;
  const rules = recorded ? rulesOf(state) : MISSION_RULES;
  return { weekKey, missions: missionsFor(weekKey, games, pick, rules), games };
}

/** 그 주의 미션 가운데 한 게임만 세는 미션("이번 주의 게임"이나 큰 게임)이 세는 게임. 그런 미션이 없는 주면 null. */
export function pickedGame(week: WeekContext): string | null {
  return week.missions.find((mission) => mission.kind === 'game' || mission.kind === 'big')?.counts?.[0] ?? null;
}

/**
 * 한 판을 그 주의 기록에 더한 새 기록을 돌려준다. 원본은 바꾸지 않는다. weekKey가 기록보다 앞선 주이면 그대로다.
 * pick은 그 주의 "이번 주의 게임"이다(pickedGame). 기록에 아직 적혀 있지 않으면 함께 적어 둔다.
 */
export function recordWeeklyPlay(
  state: WeeklyState,
  weekKey: string,
  play: { gameId: string; coins: number; dailyCleared: boolean },
  pick: string | null = null,
): WeeklyState {
  const base = weeklyFor(state, weekKey);
  if (base === null) return state;
  const kept = base.pick ?? pick;
  return {
    ...base,
    ...(kept !== null ? { pick: kept } : {}),
    plays: { ...base.plays, [play.gameId]: (base.plays[play.gameId] ?? 0) + 1 },
    coins: base.coins + Math.max(0, Math.floor(play.coins)),
    dailyClears: base.dailyClears + (play.dailyCleared ? 1 : 0),
  };
}

export interface MissionProgress {
  /** 목표를 넘지 않게 자른 진행 */
  current: number;
  goal: number;
  complete: boolean;
}

function measure(mission: WeeklyMission, state: WeeklyState): number {
  switch (mission.kind) {
    case 'variety':
      return Object.values(state.plays).filter((played) => played > 0).length;
    case 'coins':
      return state.coins;
    case 'daily':
      return state.dailyClears;
    default: {
      const ids = mission.counts ?? Object.keys(state.plays);
      return ids.reduce((sum, id) => sum + (state.plays[id] ?? 0), 0);
    }
  }
}

/** 그 기록으로 미션을 얼마나 채웠는지. state는 그 미션의 주의 기록이어야 한다(weeklyFor로 고른 것). */
export function missionProgress(mission: WeeklyMission, state: WeeklyState): MissionProgress {
  const value = Math.max(0, Math.floor(measure(mission, state)));
  return { current: Math.min(value, mission.goal), goal: mission.goal, complete: value >= mission.goal };
}

/** 다 채웠지만 아직 보상을 받지 않은 미션 */
export function claimableMissions(state: WeeklyState, week: WeekContext): WeeklyMission[] {
  const current = weeklyFor(state, week.weekKey);
  if (current === null) return [];
  return week.missions.filter(
    (mission) => !current.claimed.includes(mission.id) && missionProgress(mission, current).complete,
  );
}

/**
 * 지난 주에 다 채우고도 보상을 받지 않은 미션. 지금 따지는 주(weekKey)가 기록의 주보다 뒤일 때만 있다.
 * 주가 바뀌면 기록이 지워지므로, 그 전에 이 미션들의 보상을 넣어 주는 데 쓴다(save.ts의 settleLastWeek).
 */
export function unclaimedFromLastWeek(
  state: WeeklyState,
  weekKey: string,
  games: readonly WeeklyGame[],
): WeeklyMission[] {
  if (state.weekKey === null || state.weekKey >= weekKey) return [];
  const past: WeekContext = {
    weekKey: state.weekKey,
    missions: missionsFor(state.weekKey, games, state.pick, rulesOf(state)),
  };
  return claimableMissions(state, past);
}

export type ClaimMissionResult =
  | { ok: true; state: WeeklyState; mission: WeeklyMission }
  | { ok: false; reason: 'unknown' | 'incomplete' | 'claimed' };

/** 다 채운 미션의 보상을 받은 것으로 기록한다. 보상 코인은 mission.reward이다. 원본은 바꾸지 않는다. */
export function claimMission(state: WeeklyState, week: WeekContext, id: string): ClaimMissionResult {
  const mission = week.missions.find((candidate) => candidate.id === id);
  const current = weeklyFor(state, week.weekKey);
  if (!mission || current === null) return { ok: false, reason: 'unknown' };
  if (current.claimed.includes(mission.id)) return { ok: false, reason: 'claimed' };
  if (!missionProgress(mission, current).complete) return { ok: false, reason: 'incomplete' };
  return { ok: true, state: { ...current, claimed: [...current.claimed, mission.id] }, mission };
}
