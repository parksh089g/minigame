/**
 * 행운 슬롯의 오늘의 판: 날마다 누구에게나 같은 운(같은 스핀, 같은 가게)이 나오는 한 판.
 * 몇 번이든 다시 할 수 있고, 다시 해도 운은 그대로다. 그날의 가장 좋은 기록이 남는다.
 * 날은 등불지기의 오늘의 판과 오늘의 랭킹이 쓰는 날(online/protocol.ts의 rankDayOf)과 같다:
 * 기기가 어느 나라에 있든 한국 시각으로 0시에 하루가 넘어간다.
 * 화면과 저장소에 의존하지 않는 순수한 값과 함수만 둔다. 저장은 daily-store.ts가 맡는다.
 *
 * 오늘의 판의 점수는 그날의 기록에만 남긴다. 운을 알고 다시 할수록 점수가 오르는 판이라, 운에 맡기는 여느 판과 같은
 * 최고 기록과 랭킹에 넣으면 두 가지 판이 섞인다(씬의 offRecordNote). 한 판으로는 세고 코인도 준다.
 *
 * 기록은 이 기기에만 남는다. 오늘의 랭킹(online/)에는 올리지 않는다: 오늘의 랭킹이 있는 게임의 목록
 * (protocol.ts의 DAILY_BOARD)은 서버가 함께 쓰는 약속이라, 거기에 이 게임을 넣고 서버를 다시 올려야 받는다.
 */
import { MAX_SCORE, rankDayOf } from '../../online/protocol';
import type { ShareOverride } from '../../share/link';

/** registry.ts에 등록한 이 게임의 id. 씨앗과 저장에 쓰이므로 바꾸지 않는다. */
export const SLOT_GAME_ID = 'candy-slot';

const DAY_MS = 86_400_000;

/** 그 시각이 며칠째인지(한국 시각, 1970년 1월 1일이 0) */
export function dayIndexOf(date: Date): number {
  return rankDayOf(date.getTime());
}

/** 날짜를 "11월 12일" 꼴로 */
export function dayLabel(day: number): string {
  const date = new Date(day * DAY_MS);
  return `${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일`;
}

// ───────── 씨앗 ─────────

const SEED_HEAD = `${SLOT_GAME_ID}:daily:`;

/**
 * 그날의 판의 씨앗(rules.ts의 newRun에 넘긴다). 게임 id와 날로만 정해지므로 같은 날에는 누구에게나 같다.
 * 예: 2026년 11월 16일은 "candy-slot:daily:20773"
 */
export function dailySeed(day: number): string {
  return `${SEED_HEAD}${Math.max(0, Math.floor(day))}`;
}

/** 판의 씨앗이 오늘의 판의 것이면 그 날을 돌려준다. 여느 판(null)이나 다른 씨앗이면 null. */
export function dailyDayOf(seed: string | null): number | null {
  if (seed === null || !seed.startsWith(SEED_HEAD)) return null;
  const rest = seed.slice(SEED_HEAD.length);
  return /^\d{1,6}$/.test(rest) ? Number(rest) : null;
}

// ───────── 기록 ─────────

export interface SlotDaily {
  /** 마지막으로 오늘의 판을 마친 날. 한 번도 안 했으면 0 */
  day: number;
  /** 그날의 가장 높은 점수와, 그 판에서 넘긴 라운드의 수 */
  best: number;
  rounds: number;
  /** 그날 마친 판의 수 */
  tries: number;
  /** 그날까지 하루도 거르지 않고 이어 온 날 수 */
  streak: number;
  /** 저장한 때(ms). 같은 기기의 다른 곳이 더 늦게 저장한 것을 가려 읽는 데 쓴다. 저장한 적이 없으면 0 */
  savedAt: number;
}

export function createDaily(): SlotDaily {
  return { day: 0, best: 0, rounds: 0, tries: 0, streak: 0, savedAt: 0 };
}

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

/** 저장된 값을 믿을 수 있는 모양으로 맞춘다. */
export function normalizeDaily(raw: unknown): SlotDaily {
  if (typeof raw !== 'object' || raw === null) return createDaily();
  const data = raw as Record<string, unknown>;
  const savedAt = count(data.savedAt);
  const day = count(data.day);
  const tries = count(data.tries);
  if (day === 0 || tries === 0) return { ...createDaily(), savedAt };
  return {
    day,
    best: count(data.best),
    rounds: count(data.rounds),
    tries,
    streak: Math.max(1, count(data.streak)),
    savedAt,
  };
}

/**
 * today에서 본 기록. 날이 바뀌었으면 오늘 것은 비어 있다.
 * 어제 했으면 이어 온 날 수는 남아 있고(오늘 하면 하루가 더해진다), 하루라도 걸렀으면 0으로 돌아간다.
 */
export function dailyToday(record: SlotDaily, today: number): SlotDaily {
  if (record.day === today) return record;
  return {
    ...createDaily(),
    day: today,
    streak: record.day === today - 1 ? record.streak : 0,
    savedAt: record.savedAt,
  };
}

/** 오늘의 판 한 판의 결과 */
export interface DailyRun {
  score: number;
  /** 넘긴 라운드의 수 */
  rounds: number;
}

export interface DailyOutcome {
  record: SlotDaily;
  /** 오늘 처음 마친 판인지. 이어 온 날 수가 하루 는다. */
  first: boolean;
  /** 오늘의 최고 점수를 새로 썼는지 */
  improved: boolean;
}

/** 오늘의 판을 마친 결과를 기록에 보탠다. 그날의 가장 높은 점수와 그 판에서 넘긴 라운드가 남는다. */
export function addDailyRun(record: SlotDaily, today: number, run: DailyRun): DailyOutcome {
  const base = dailyToday(record, today);
  const first = base.tries === 0;
  const score = count(run.score);
  const improved = first || score > base.best;
  return {
    record: {
      day: today,
      best: improved ? score : base.best,
      rounds: improved ? count(run.rounds) : base.rounds,
      tries: base.tries + 1,
      streak: first ? base.streak + 1 : base.streak,
      savedAt: base.savedAt,
    },
    first,
    improved,
  };
}

// ───────── 글 ─────────

/**
 * 화면에 적는 이름들: 판의 이름(버튼과 표시, 결과 화면의 줄), 여느 판으로 돌아가는 버튼,
 * 결과 화면에서 친구 점수와 견준 줄의 이름
 */
export const DAILY_LABEL = { name: '오늘의 판', back: '보통 판으로', friend: '친구 기록' } as const;

/**
 * 오늘의 판을 마쳤을 때 결과 화면에서 최고 기록 자리에 적는 한 줄. 오늘의 판은 운이 정해져 있고 몇 번이든 다시 할 수 있어서,
 * 그 점수를 여느 판과 같은 최고 기록과 랭킹에는 넣지 않는다(10차 검토 S10). today는 오늘의 판이고,
 * past는 두었다가 날이 넘어간 뒤에 마친 판이다(그날의 기록에도 남지 않는다).
 */
export const DAILY_OFF_RECORD = {
  today: '오늘의 판은 그날의 기록에만 남아요',
  past: '날이 지나서 기록에 안 남아요',
} as const;

/** 시작 화면에서 오늘의 판을 골랐을 때 그 아래에 적는 한 줄: 오늘의 최고 기록이나, 아직 안 했으면 무엇을 하는 판인지 */
export function dailyInfo(record: SlotDaily, today: number): string {
  const now = dailyToday(record, today);
  if (now.tries > 0) return `오늘 최고 ${now.best}점 · 넘긴 라운드 ${now.rounds}번`;
  if (now.streak > 0) return `이어 온 날 ${now.streak}일 · 오늘 하면 하루 더`;
  return '누구나 같은 운으로 하는 판이에요';
}

/** 결과 화면의 "오늘의 판" 줄. outcome은 방금 끝난 판을 기록에 보탠 결과다. */
export function dailyVerdict(outcome: DailyOutcome): string {
  if (outcome.first) return `${outcome.record.streak}일째 · 오늘의 첫 기록`;
  if (outcome.improved) return '오늘의 최고 기록!';
  return `오늘 최고 ${outcome.record.best}점`;
}

/**
 * 오늘의 판의 결과를 공유할 때 카드와 문구에 적을 것. 받은 사람이 주소를 열면 행운 슬롯이 오늘의 판으로 열린다.
 * 카드에는 "11월 16일 오늘의 판 · 3일째"와 "넘긴 라운드 4번"이 두 줄로 적힌다. streak는 그날까지 이어 온 날 수다.
 * 주소에는 점수도 실려서, 받은 사람에게 넘어 볼 친구 기록으로 보인다.
 */
export function dailyShare(day: number, run: DailyRun, streak: number): ShareOverride {
  const label = `${dayLabel(day)} 오늘의 판`;
  return {
    note: streak > 0 ? `${label} · ${Math.floor(streak)}일째` : label,
    detail: `넘긴 라운드 ${count(run.rounds)}번`,
    invite: '같은 판 도전하기',
    text: `포켓 아케이드 [행운 슬롯] ${label} ${run.score}점! 같은 판에서 겨뤄 볼까요?`,
    day,
    score: run.score,
  };
}

/** 공유받은 주소의 날이 오늘이 아닐 때 띄우는 한 줄. 지난 날의 판은 다시 할 수 없어서 오늘의 판을 연다. */
export const SHARED_DAY_PASSED = '그날은 지났어요. 오늘의 판이에요';

/**
 * 공유받은 주소에 실려 온 친구의 점수 가운데 견줄 수 있는 것: 오늘의 것이고 점수의 모양이어야 한다.
 * 주소의 점수는 누구나 고칠 수 있으므로 보여 주기만 하고 기록에는 쓰지 않는다.
 */
export function friendScoreOf(sharedDay: unknown, sharedScore: unknown, today: number): number | null {
  if (sharedDay !== today) return null;
  const score = count(sharedScore);
  return score > 0 && score <= MAX_SCORE ? score : null;
}

/** 친구 점수가 실린 주소로 들어왔을 때 띄우는 한 줄 */
export function friendNotice(score: number): string {
  return `친구 기록 ${score}점을 넘어 보세요`;
}

/** 결과 화면에서 이번 판의 점수를 친구 점수와 견준 한 줄 */
export function friendVerdict(friend: number, score: number): string {
  if (score > friend) return `${friend}점을 넘었어요!`;
  if (score === friend) return `${friend}점과 같아요`;
  return `${friend}점까지 ${friend - score}점`;
}
