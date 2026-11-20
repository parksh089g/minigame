/**
 * 텃밭 지키기의 오늘의 판: 날마다 누구에게나 같은 벌레 떼와 같은 가게가 나오는 한 판.
 * 1일째부터, 영구 강화와 새 밭의 덤과 유물 없이 시작해서 누구나 같은 조건으로 겨룬다.
 * 몇 번이든 다시 할 수 있고, 다시 해도 벌레와 가게는 그대로다. 그날의 가장 좋은 기록이 남는다.
 * 날은 등불지기와 행운 슬롯의 오늘의 판, 오늘의 랭킹이 쓰는 날(online/protocol.ts의 rankDayOf)과 같다:
 * 기기가 어느 나라에 있든 한국 시각으로 0시에 하루가 넘어간다.
 *
 * 판의 난수는 갈래(stream)마다 따로 센다(행운 슬롯의 randomOf와 같은 생각). 그날의 벌레 떼는 "그날의 판의 몇째 날"로,
 * 가게의 카드는 "몇째 날 뒤의 가게에서 몇 번째로 뽑은 것"으로만 정해진다. 그래서 물을 몇 번 쐈든, 대장이 부하를 몇 마리 불렀든,
 * 앞의 가게에서 몇 번을 다시 뽑았든 같은 날에는 같은 벌레 떼와 같은 카드가 나온다.
 *
 * 오늘의 판의 점수는 그날의 기록과 그날의 랭킹에만 남긴다. 벌레 떼를 알고 다시 할수록 점수가 오르는 판이라
 * 여느 판과 같은 최고 기록과 전체 랭킹에 넣으면 두 가지 판이 섞인다(씬의 offRecordNote). 한 판으로는 세고 코인과 씨앗도 준다.
 * 이 게임은 오늘의 랭킹이 있는 게임의 목록(protocol.ts의 DAILY_BOARD)에 들어 있고, 그 목록은 서버가 함께 쓰는 약속이다.
 *
 * 화면과 저장소에 의존하지 않는 순수한 값과 함수만 둔다. 기록의 저장은 daily-store.ts가 맡는다.
 */
import { isRankDay, MAX_SCORE, rankDayOf, rankDayStart, rankLabel } from '../../online/protocol';
import type { ShareOverride } from '../../share/link';
import { GARDEN_GAME_ID } from './data';
import { MAX_DAY } from './rules';

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

/**
 * 그날(day)이 끝나고 새 날의 판과 랭킹이 시작되는 때를 이 기기의 시각으로 적는다. 한국에서는 "0시"다.
 * 다른 나라에서는 다른 시각으로 보인다(날은 어디서나 한국 시각으로 바뀐다).
 */
export function dayResetLabel(day: number): string {
  const reset = new Date(rankDayStart(day + 1));
  const minutes = reset.getMinutes();
  return `${reset.getHours()}시${minutes > 0 ? ` ${minutes}분` : ''}`;
}

// ───────── 씨앗과 갈래 ─────────

/**
 * 하고 있는 판이 오늘의 판이면 판(sim.ts의 RunState.daily)에 붙는 표. 여느 판에는 없다.
 * day는 그 판의 날(dayIndexOf)이고, draws는 지금 열린 가게에서 다시 뽑은 횟수다(가게가 열릴 때마다 0부터).
 */
export interface DailyTag {
  day: number;
  draws: number;
}

const SEED_HEAD = `${GARDEN_GAME_ID}:daily:`;

/** 글을 32비트 씨앗으로 바꾼다(FNV-1a). 같은 글이면 언제나 같은 씨앗이다. */
function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}

/** 그날의 판의 씨앗(sim.ts의 createRun에 넘긴다). 게임 id와 날로만 정해지므로 같은 날에는 누구에게나 같다. */
export function dailySeed(day: number): number {
  return hashSeed(`${SEED_HEAD}${Math.max(0, Math.floor(day))}`);
}

/** 그날의 판에서 gameDay째 날의 벌레 떼를 정하는 씨앗. 그날이 시작될 때 판의 난수를 이것으로 맞춘다. */
export function waveSeed(day: number, gameDay: number): number {
  return hashSeed(`${SEED_HEAD}${Math.floor(day)}:waves:${Math.floor(gameDay)}`);
}

/**
 * 그날의 판에서 gameDay째 날을 지킨 뒤(판의 첫날 앞이면 첫날 앞)의 가게에서, draw번째로 뽑는 카드의 씨앗.
 * 가게를 열 때 뽑는 것이 0번째이고, 다시 뽑을 때마다 하나씩 는다.
 */
export function shopSeed(day: number, gameDay: number, draw: number): number {
  return hashSeed(`${SEED_HEAD}${Math.floor(day)}:shop:${Math.floor(gameDay)}:${Math.floor(draw)}`);
}

/**
 * 그날의 판을 시작하는 조건(sim.ts의 RunConfig): 1일째부터, 영구 강화와 새 밭의 덤과 유물 없이.
 * 가장 멀리 지킨 날은 끝(MAX_DAY)으로 두어서, 이 밭의 기록을 넘었다고 주는 덤 씨앗과 "새 기록!"이 나오지 않는다.
 */
export function dailyConfig(day: number): {
  seed: number;
  startDay: number;
  levels: Record<string, never>;
  bestBefore: number;
  fields: number;
  relics: Record<string, never>;
  daily: number;
} {
  const index = Math.max(0, Math.floor(day));
  return { seed: dailySeed(index), startDay: 1, levels: {}, bestBefore: MAX_DAY, fields: 0, relics: {}, daily: index };
}

/** 판에 붙은 표가 맞는 모양인지(저장에서 읽을 때 본다) */
export function isDailyTag(value: unknown): value is DailyTag {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const tag = value as Record<string, unknown>;
  const draws = tag.draws;
  return isRankDay(tag.day) && typeof draws === 'number' && Number.isInteger(draws) && draws >= 0 && draws <= 1e9;
}

/**
 * 끝난 판의 점수를 올릴 오늘의 랭킹의 날. 올리지 않는 판이면 null이다.
 * 오늘의 판이고 그 날이 지금(now)의 랭킹 날과 같을 때만 올린다. 여느 판이나, 날이 넘어간 뒤에 끝낸 어제의 판은 올리지 않는다.
 * 기기의 시계가 틀려서 다른 날의 판을 했으면 서버가 자기 시각의 오늘과 다른 날의 것을 버린다(worker/service.ts).
 */
export function boardDayOf(tag: DailyTag | undefined, now: number): number | null {
  return tag && isRankDay(tag.day) && tag.day === rankDayOf(now) ? tag.day : null;
}

// ───────── 기록 ─────────

export interface GardenDaily {
  /** 마지막으로 오늘의 판을 마친 날. 한 번도 안 했으면 0 */
  day: number;
  /** 그날의 가장 높은 점수와, 그 판에서 지킨 날 수 */
  best: number;
  kept: number;
  /** 그날 마친 판의 수 */
  tries: number;
  /** 그날까지 하루도 거르지 않고 이어 온 날 수 */
  streak: number;
  /** 저장한 때(ms). 같은 기기의 다른 곳이 더 늦게 저장한 것을 가려 읽는 데 쓴다. 저장한 적이 없으면 0 */
  savedAt: number;
}

export function createDaily(): GardenDaily {
  return { day: 0, best: 0, kept: 0, tries: 0, streak: 0, savedAt: 0 };
}

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

/** 저장된 값을 믿을 수 있는 모양으로 맞춘다. */
export function normalizeDaily(raw: unknown): GardenDaily {
  if (typeof raw !== 'object' || raw === null) return createDaily();
  const data = raw as Record<string, unknown>;
  const savedAt = count(data.savedAt);
  const day = count(data.day);
  const tries = count(data.tries);
  if (day === 0 || tries === 0) return { ...createDaily(), savedAt };
  return {
    day,
    best: Math.min(count(data.best), MAX_SCORE),
    kept: count(data.kept),
    tries,
    streak: Math.max(1, count(data.streak)),
    savedAt,
  };
}

/**
 * today에서 본 기록. 날이 바뀌었으면 오늘 것은 비어 있다.
 * 어제 했으면 이어 온 날 수는 남아 있고(오늘 하면 하루가 더해진다), 하루라도 걸렀으면 0으로 돌아간다.
 */
export function dailyToday(record: GardenDaily, today: number): GardenDaily {
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
  /** 그 판에서 지킨 날 수 */
  kept: number;
}

export interface DailyOutcome {
  record: GardenDaily;
  /** 오늘 처음 마친 판인지. 이어 온 날 수가 하루 는다. */
  first: boolean;
  /** 오늘의 최고 점수를 새로 썼는지 */
  improved: boolean;
}

/** 오늘의 판을 마친 결과를 기록에 보탠다. 그날의 가장 높은 점수와 그 판에서 지킨 날 수가 남는다. */
export function addDailyRun(record: GardenDaily, today: number, run: DailyRun): DailyOutcome {
  const base = dailyToday(record, today);
  const first = base.tries === 0;
  const score = Math.min(count(run.score), MAX_SCORE);
  const improved = first || score > base.best;
  return {
    record: {
      day: today,
      best: improved ? score : base.best,
      kept: improved ? count(run.kept) : base.kept,
      tries: base.tries + 1,
      streak: first ? base.streak + 1 : base.streak,
      savedAt: base.savedAt,
    },
    first,
    improved,
  };
}

// ───────── 글 ─────────

/** 화면에 적는 이름과 버튼의 글 */
export const DAILY_TEXT = {
  name: '오늘의 판',
  /** 오늘의 판 쪽에서 준비 화면으로 돌아가는 버튼 */
  back: '돌아가기',
  go: '도전!',
  again: '다시 도전!',
  /** 하던 판이 있을 때 도전을 한 번 누르면 바뀌는 글. 한 번 더 누르면 하던 판을 마치고 시작한다. */
  sure: '정말 도전!',
  rules: '오늘의 조건',
  record: '오늘의 기록',
  best: '최고 기록',
  streak: '이어 온 날',
  friend: '친구 기록',
  none: '아직 없어요',
  /** 판을 하는 동안 HUD에 붙는 표시 */
  badge: '오늘의 판',
} as const;

/** 오늘의 판 쪽의 "오늘의 조건" 칸에 적는 줄들 */
export const DAILY_RULES = ['1일째부터, 강화와 유물 없이 해요', '벌레 떼와 가게는 모두 똑같아요', '받은 씨앗과 조각은 텃밭에 들어와요'] as const;

/** 하던 판이 있을 때 도전을 처음 누르면 설명 칸에 적는 말 */
export function dailyDiscard(day: number): string {
  return `${day}일째에서 멈춘 판을 마치고 시작해요.\n한 번 더 누르면 그렇게 해요.`;
}

/**
 * 오늘의 판을 마쳤을 때 결과 화면에서 최고 기록 자리에 적는 한 줄. today는 오늘의 판이고,
 * past는 두었다가 날이 넘어간 뒤에 마친 판이다(그날의 기록에도 남지 않는다).
 */
export const DAILY_OFF_RECORD = {
  today: '오늘의 판은 그날의 기록에만 남아요',
  past: '날이 지나서 기록에 안 남아요',
} as const;

/** 준비 화면의 오늘의 판 줄 오른쪽에 적는 한 줄: 오늘의 최고 기록이나, 아직 안 했으면 무엇을 하는 판인지 */
export function dailyInfo(record: GardenDaily, today: number): string {
  const now = dailyToday(record, today);
  if (now.tries > 0) return `오늘 최고 ${now.best}점`;
  if (now.streak > 0) return `이어 온 날 ${now.streak}일`;
  return '모두 같은 벌레 떼';
}

/** 오늘의 판 쪽의 기록 칸에 적는 최고 기록 */
export function dailyBest(record: GardenDaily, today: number): string {
  const now = dailyToday(record, today);
  return now.tries > 0 ? `${now.best}점 · ${now.kept}일 지킴` : DAILY_TEXT.none;
}

/** 오늘의 판 쪽의 기록 칸에 적는 이어 온 날 */
export function dailyStreak(record: GardenDaily, today: number): string {
  const now = dailyToday(record, today);
  if (now.streak === 0) return '오늘부터 시작';
  return now.tries > 0 ? `${now.streak}일` : `${now.streak}일 · 오늘 하면 하루 더`;
}

/** 오늘의 판 쪽의 설명 칸에 처음 적는 말 */
export function dailyHint(record: GardenDaily, today: number): string {
  const now = dailyToday(record, today);
  if (now.tries > 0) return `오늘 ${now.tries}판 했어요.\n더 높은 기록에 도전해 봐요!`;
  return '오늘의 벌레 떼가 기다려요.\n친구와 같은 판으로 겨뤄 봐요!';
}

/** 결과 화면의 "오늘의 판" 줄. outcome은 방금 끝난 판을 기록에 보탠 결과다. */
export function dailyVerdict(outcome: DailyOutcome): string {
  if (outcome.first) return `${outcome.record.streak}일째 · 오늘의 첫 기록`;
  if (outcome.improved) return '오늘의 최고 기록!';
  return `오늘 최고 ${outcome.record.best}점`;
}

/** 이어 할 판이 오늘의 판일 때 준비 화면의 설명 칸과, 이어 할 때 뜨는 알림 */
export function dailyResumeInfo(day: number): string {
  return `오늘의 판 ${day}일째에서 멈췄어요.\n이어 하면 같은 벌레 떼가 나와요.`;
}
export const dailyResumed = (day: number): string => `오늘의 판 ${day}일째!`;

/**
 * 오늘의 판의 결과를 공유할 때 카드와 문구에 적을 것. 받은 사람이 주소를 열면 텃밭 지키기의 오늘의 판 쪽으로 바로 간다.
 * 카드에는 "11월 19일 오늘의 판 · 3일째"와 "지킨 날 7일"이 두 줄로 적힌다. streak는 그날까지 이어 온 날 수다.
 * 주소에는 점수도 실려서, 받은 사람에게 넘어 볼 친구 기록으로 보인다.
 */
export function dailyShare(day: number, run: DailyRun, streak: number): ShareOverride {
  const label = `${dayLabel(day)} 오늘의 판`;
  return {
    note: streak > 0 ? `${label} · ${Math.floor(streak)}일째` : label,
    detail: `지킨 날 ${count(run.kept)}일`,
    invite: '같은 판 도전하기',
    text: `포켓 아케이드 [텃밭 지키기] ${label} ${run.score}점! 같은 벌레 떼로 겨뤄 볼까요?`,
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

/** 오늘의 판 쪽의 기록 칸에 적는 친구 기록 */
export function friendLine(friend: number, best: number | null): string {
  return best !== null && best > friend ? `${friend}점 · 넘었어요!` : `${friend}점`;
}

/** 결과 화면에서 이번 판의 점수를 친구 점수와 견준 한 줄 */
export function friendVerdict(friend: number, score: number): string {
  if (score > friend) return `${friend}점을 넘었어요!`;
  if (score === friend) return `${friend}점과 같아요`;
  return `${friend}점까지 ${friend - score}점`;
}

// ───────── 오늘의 랭킹 ─────────

/** 오늘의 랭킹 쪽(rank-page.ts)과 그리로 가는 버튼에 적는 글 */
export const RANK_TEXT = {
  title: '오늘의 랭킹',
  /** 오늘의 판 쪽의 버튼. 내 순위를 알면 rankButton으로 적는다. */
  button: '오늘의 랭킹 보기',
  loading: '랭킹을 불러오는 중...',
  retry: '다시 불러오기',
  empty: '오늘은 아직 아무도 없어요.\n첫 번째로 이름을 올려 보세요!',
  guest: '닉네임을 정하면 오늘의 판 기록이\n랭킹에 올라가요.',
  join: '닉네임 정하고 참여하기',
  rename: '닉네임 바꾸기',
  none: '오늘의 판을 마치면 올라가요',
  slow: '기록은 잠시 뒤에 올라가요',
  unsent: '기록을 아직 올리지 못했어요',
  back: '오늘의 판으로',
} as const;

/** 내 순위를 알 때 오늘의 판 쪽의 랭킹 버튼에 적는 글 */
export const rankButton = (rank: number): string => `오늘의 랭킹 · ${rankLabel(rank)}`;

/** 랭킹 목록 위의 한 줄: 무엇으로 겨루는 랭킹이고 언제 새로 시작하는지 */
export function rankNote(day: number): string {
  return `같은 벌레 떼로 겨뤄요 · ${dayResetLabel(day)}에 새로 시작`;
}
