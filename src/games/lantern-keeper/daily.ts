/**
 * 오늘의 판: 날마다 누구나 같은 조건(캐릭터, 스테이지, 씨앗, 영구 강화 없음)으로 하는 한 판.
 * 몇 번이든 다시 할 수 있고, 그날의 가장 좋은 기록이 남는다. 그날 처음 마친 판에는 불씨가 더 붙는다.
 * 그날의 점수는 오늘의 랭킹(online/)에 올라가서 다른 사람과 겨룬다.
 * 화면에 의존하지 않는 순수한 값과 함수만 둔다.
 */
import { MAX_SCORE, rankDayOf, rankDayStart } from '../../online/protocol';
import type { ShareOverride } from '../../share/link';
import { HERO_ORDER, HEROES, STAGE_ORDER, STAGES, type HeroId, type StageId } from './data';

/** 그날 처음 마친 오늘의 판에 더 주는 불씨 */
export const DAILY_REWARD = 30;

const DAY_MS = 86_400_000;

/**
 * 그 시각이 며칠째인지(1970년 1월 1일이 0). 오늘의 랭킹과 같은 날을 쓴다:
 * 누구나 같은 날에 같은 판을 하도록, 기기가 어느 나라에 있든 한국 시각으로 0시에 하루가 넘어간다.
 */
export function dayIndexOf(date: Date): number {
  return rankDayOf(date.getTime());
}

/** 날짜를 "11월 12일" 꼴로 */
export function dayLabel(day: number): string {
  const date = new Date(day * DAY_MS);
  return `${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일`;
}

/**
 * 그날(day)이 끝나고 새 날의 판과 랭킹이 시작되는 때를 이 기기의 시각으로 적는다. 한국에서는 "0시"다.
 * 다른 나라에서는 다른 시각으로 보인다(날은 어디서나 한국 시각으로 바뀐다).
 */
export function dayResetLabel(day: number): string {
  const reset = new Date(rankDayStart(day + 1));
  const minutes = reset.getMinutes();
  return `${reset.getHours()}시${minutes > 0 ? ` ${minutes}분` : ''}`;
}

/** "종소리" → "종소리로", "불씨탄" → "불씨탄으로". 받침이 없거나 ㄹ이면 "로"가 붙는다. */
export function withRo(word: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  if (code < 0 || code > 11171) return `${word}로`;
  const final = code % 28;
  return `${word}${final === 0 || final === 8 ? '로' : '으로'}`;
}

/** 고르게 섞인 32비트 값 */
function mix(value: number): number {
  let x = (value ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

export interface DailyPlan {
  day: number;
  hero: HeroId;
  stage: StageId;
  /** 지형과 적이 나오는 차례를 정하는 씨앗 */
  seed: number;
}

/**
 * 바람 설원이 오늘의 판에 섞이기 시작하는 날(2026년 11월 16일). 그 전의 날은 스테이지 셋이 돌던 차례 그대로다.
 * 이미 지난 날이나 하고 있던 날의 조건이 바뀌면 그날의 랭킹에 서로 다른 판의 점수가 섞이기 때문이다.
 */
export const TUNDRA_DAILY_FROM = 20_773;
/** 바람 설원이 생기기 전에 돌던 스테이지의 수 */
const OLD_STAGES = 3;
/**
 * 다섯 번째 캐릭터(달잡이)가 오늘의 판에 섞이기 시작하는 날(2026년 11월 20일). 그 전의 날은 캐릭터 넷이 돌던 차례 그대로다.
 * 캐릭터 다섯과 스테이지 넷은 저마다 하루에 한 칸씩만 돌아도 스무 날 동안 모든 짝이 한 번씩 나온다.
 */
export const MOONER_DAILY_FROM = 20_777;
/** 달잡이가 생기기 전에 돌던 캐릭터의 수 */
const OLD_HEROES = 4;
/**
 * 빛버섯 숲이 오늘의 판에 섞이기 시작하는 날(2026년 11월 23일). 그 전의 날은 스테이지 넷이 돌던 차례 그대로다.
 * 캐릭터와 스테이지가 다섯씩이라 하루에 한 칸씩 돌면 같은 짝만 나오므로, 스테이지는 캐릭터가 한 바퀴 돌 때마다 한 칸 더 밀린다.
 */
export const GROVE_DAILY_FROM = 20_780;
/** 빛버섯 숲이 생기기 전에 돌던 스테이지의 수 */
const FOUR_STAGES = 4;
/**
 * 여섯 번째 캐릭터(횃불잡이)가 오늘의 판에 섞이기 시작하는 날(2026년 11월 26일). 그 전의 날은 캐릭터 다섯이 돌던 차례 그대로다.
 * 캐릭터 여섯과 스테이지 다섯은 저마다 하루에 한 칸씩만 돌아도 서른 날 동안 모든 짝이 한 번씩 나오고, 이틀 내리 같은 것이 나오지 않는다.
 */
export const BEARER_DAILY_FROM = 20_783;
/** 횃불잡이가 생기기 전에 돌던 캐릭터와, 그때 돌던 스테이지의 수 */
const FIVE_HEROES = 5;
const FIVE_STAGES = 5;
/** 횃불잡이가 섞이는 첫날이 그 전날(바람 설원)과 같은 스테이지가 되지 않도록 스테이지의 차례를 한 칸 민다. */
const BEARER_STAGE_SHIFT = 1;
/**
 * 패시브 손거울이 오늘의 판의 레벨업 선택지에 섞이기 시작하는 날(2026년 11월 17일). 그 전의 날에는 나오지 않는다.
 * 오늘의 판은 씨앗으로 선택지를 뽑으므로, 하고 있던 날에 패시브가 하나 늘면 같은 날의 랭킹에 서로 다른 선택지로 한 판이 섞인다.
 */
export const MIRROR_DAILY_FROM = 20_774;

/**
 * 그날의 조건. 캐릭터와 스테이지가 하루에 한 칸씩 돌아가서(캐릭터와 스테이지의 수가 같던 때는 스테이지가
 * 캐릭터가 한 바퀴 돌 때마다 한 칸 더 밀려서) 이틀 내리 같은 것이 나오지 않고 모든 짝이 차례로 한 번씩 나온다.
 * 아직 열지 못한 캐릭터와 스테이지도 여기서는 쓸 수 있다.
 */
export function dailyPlan(day: number): DailyPlan {
  const index = Math.max(0, Math.floor(day));
  return {
    day: index,
    hero: HERO_ORDER[index % heroCount(index)],
    stage: dailyStage(index),
    seed: mix(index) & 0x7fffffff,
  };
}

/** 그날 돌던 캐릭터의 수 */
function heroCount(index: number): number {
  if (index < MOONER_DAILY_FROM) return OLD_HEROES;
  if (index < BEARER_DAILY_FROM) return FIVE_HEROES;
  return HERO_ORDER.length;
}

/** 그날의 스테이지. 스테이지나 캐릭터가 늘어난 날보다 앞의 날은 그때 정해 둔 차례 그대로 둔다. */
function dailyStage(index: number): StageId {
  if (index < TUNDRA_DAILY_FROM) return STAGE_ORDER[index % OLD_STAGES];
  if (index < MOONER_DAILY_FROM) return STAGE_ORDER[(index + Math.floor(index / OLD_HEROES)) % FOUR_STAGES];
  if (index < GROVE_DAILY_FROM) return STAGE_ORDER[index % FOUR_STAGES];
  if (index < BEARER_DAILY_FROM) return STAGE_ORDER[(index + Math.floor(index / FIVE_HEROES)) % FIVE_STAGES];
  return STAGE_ORDER[(index + BEARER_STAGE_SHIFT) % STAGE_ORDER.length];
}

/**
 * 오늘의 판의 결과를 공유할 때 카드와 문구에 적을 것. 받은 사람이 주소를 열면 등불지기의 오늘의 판으로 바로 간다.
 * 카드에는 "11월 13일 오늘의 판 · 3일째"와 "달잡이 · 바람 설원"이 두 줄로 적힌다. streak는 그날까지 이어 온 날 수다.
 * 주소에는 점수도 실려서, 받은 사람의 오늘의 판 쪽에 넘어 볼 친구 기록으로 보인다.
 */
export function dailyShare(day: number, score: number, streak: number): ShareOverride {
  const plan = dailyPlan(day);
  const label = `${dayLabel(plan.day)} 오늘의 판`;
  return {
    note: streak > 0 ? `${label} · ${Math.floor(streak)}일째` : label,
    detail: `${HEROES[plan.hero].name} · ${STAGES[plan.stage].name}`,
    invite: '같은 판 도전하기',
    text: `포켓 아케이드 [등불지기] ${label} ${score}점! 같은 판에서 겨뤄 볼까요?`,
    day: plan.day,
    // 받은 사람의 오늘의 판 쪽에 넘어 볼 기록으로 보인다.
    score,
  };
}

/** 공유받은 주소의 날이 오늘이 아닐 때 준비 화면에 띄우는 한 줄. 지난 날의 판은 다시 할 수 없어서 오늘의 판을 연다. */
export const SHARED_DAY_PASSED = '그날은 지났어요. 오늘의 판이에요';

export interface DailyRecord {
  /** 마지막으로 오늘의 판을 마친 날. 한 번도 안 했으면 0 */
  day: number;
  /** 그날의 가장 높은 점수와, 그 판에서 버틴 시간(초) */
  best: number;
  seconds: number;
  /** 그날 새벽을 맞은 적이 있는지 */
  cleared: boolean;
  /** 그날 마친 판의 수 */
  tries: number;
  /** 그날까지 하루도 거르지 않고 이어 온 날 수 */
  streak: number;
}

export function createDaily(): DailyRecord {
  return { day: 0, best: 0, seconds: 0, cleared: false, tries: 0, streak: 0 };
}

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

/** 저장된 값을 믿을 수 있는 모양으로 맞춘다. */
export function normalizeDaily(raw: unknown): DailyRecord {
  if (typeof raw !== 'object' || raw === null) return createDaily();
  const data = raw as Record<string, unknown>;
  const day = count(data.day);
  const tries = count(data.tries);
  if (day === 0 || tries === 0) return createDaily();
  return {
    day,
    best: count(data.best),
    seconds: count(data.seconds),
    cleared: data.cleared === true,
    tries,
    streak: Math.max(1, count(data.streak)),
  };
}

/**
 * today에서 본 기록. 날이 바뀌었으면 오늘 것은 비어 있다.
 * 어제 했으면 이어 온 날 수는 남아 있고(오늘 하면 하루가 더해진다), 하루라도 걸렀으면 0으로 돌아간다.
 */
export function dailyToday(record: DailyRecord, today: number): DailyRecord {
  if (record.day === today) return record;
  return { ...createDaily(), day: today, streak: record.day === today - 1 ? record.streak : 0 };
}

/** 오늘의 판 한 판의 결과 */
export interface DailyRun {
  score: number;
  seconds: number;
  cleared: boolean;
}

export interface DailyOutcome {
  record: DailyRecord;
  /** 오늘 처음 마친 판인지. 보너스 불씨가 붙고 이어 온 날 수가 하루 는다. */
  first: boolean;
  /** 오늘의 최고 점수를 새로 썼는지 */
  improved: boolean;
}

/** 오늘의 판을 마친 결과를 기록에 보탠다. */
export function addDailyRun(record: DailyRecord, today: number, run: DailyRun): DailyOutcome {
  const base = dailyToday(record, today);
  const first = base.tries === 0;
  const score = count(run.score);
  const improved = first || score > base.best;
  return {
    record: {
      day: today,
      best: improved ? score : base.best,
      seconds: improved ? count(run.seconds) : base.seconds,
      cleared: base.cleared || run.cleared,
      tries: base.tries + 1,
      streak: first ? base.streak + 1 : base.streak,
    },
    first,
    improved,
  };
}

/**
 * 공유받은 주소에 실려 온 친구의 오늘의 판 점수. 그날 동안 오늘의 판 쪽과 결과 화면에 넘어 볼 기록으로 보인다.
 * 주소의 점수는 누구나 고칠 수 있으므로 보여 주기만 하고 랭킹에는 쓰지 않는다.
 */
export interface FriendScore {
  day: number;
  score: number;
}

/** 저장된 친구 점수를 믿을 수 있는 모양으로 맞춘다. 모양이 아니면 null */
export function normalizeFriend(raw: unknown): FriendScore | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const data = raw as Record<string, unknown>;
  const day = count(data.day);
  const score = count(data.score);
  return day > 0 && score > 0 && score <= MAX_SCORE ? { day, score } : null;
}

/** 받은 친구 점수를 적는다. 같은 날의 것을 여럿 받으면 가장 높은 것을 넘어 볼 기록으로 둔다. */
export function addFriend(current: FriendScore | null, day: number, score: number): FriendScore {
  if (current && current.day === day && current.score >= score) return current;
  return { day, score };
}

/** today에 보일 친구 점수. 그날 받은 것이 아니면 null */
export function friendToday(friend: FriendScore | null, today: number): number | null {
  return friend && friend.day === today ? friend.score : null;
}

/** 친구 점수가 실린 주소로 들어왔을 때 준비 화면에 띄우는 한 줄 */
export function friendNotice(score: number): string {
  return `친구 기록 ${score}점을 넘어 보세요`;
}

/** 결과 화면에서 이번 판의 점수를 친구 점수와 견준 한 줄 */
export function friendVerdict(friend: number, score: number): string {
  if (score > friend) return `${friend}점을 넘었어요!`;
  if (score === friend) return `${friend}점과 같아요`;
  return `${friend}점까지 ${friend - score}점`;
}
