/**
 * 초성 퀴즈의 규칙. 화면과 분리된 순수 함수라서 숫자만 바꿔 밸런스를 조정할 수 있다.
 * 문제 하나는 분류와 초성, 그리고 글자 조각 한 무더기다. 조각을 차례로 골라 답 칸을 채우면 낱말이 된다.
 * 무작위가 필요한 곳은 random(0 이상 1 미만의 수를 돌려주는 함수)을 받아서 쓰고, 시간은 초로 받는다.
 */
import { WORDS, type Word } from './words';

// ───────── 한글 ─────────

const FIRST_SYLLABLE = 0xac00;
const LAST_SYLLABLE = 0xd7a3;
/** 초성 하나에 딸린 글자 수: 중성 21개 × 종성 28개(없는 것 포함) */
const SYLLABLES_PER_CHOSUNG = 21 * 28;

/** 초성 열아홉 개. 유니코드에 글자가 놓인 순서 그대로이고, 화면에 쓸 수 있는 호환 자모다. */
export const CHOSUNG = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
] as const;

/** 한글 글자(가~힣) 하나인지 */
export function isSyllable(char: string): boolean {
  if (char.length !== 1) return false;
  const code = char.charCodeAt(0);
  return code >= FIRST_SYLLABLE && code <= LAST_SYLLABLE;
}

/** 글자 하나의 초성. 한글 글자가 아니면 빈 문자열이다. */
export function chosungOf(syllable: string): string {
  if (!isSyllable(syllable)) return '';
  return CHOSUNG[Math.floor((syllable.charCodeAt(0) - FIRST_SYLLABLE) / SYLLABLES_PER_CHOSUNG)];
}

/** 낱말의 초성을 이어 붙인 것. "수박"이면 "ㅅㅂ"이다. */
export function patternOf(word: string): string {
  return [...word].map(chosungOf).join('');
}

// ───────── 낱말 찾기 ─────────

export const MIN_LENGTH = 2;
export const MAX_LENGTH = 4;
/** 문제로 나오는 낱말의 글자 수들 */
export const LENGTHS: readonly number[] = [2, 3, 4];

const WORD_BY_TEXT = new Map<string, Word>(WORDS.map((word) => [word.text, word]));

const WORDS_BY_LENGTH = new Map<number, Word[]>();
for (const word of WORDS) {
  const list = WORDS_BY_LENGTH.get(word.text.length);
  if (list) list.push(word);
  else WORDS_BY_LENGTH.set(word.text.length, [word]);
}

/** 글자 수가 length인 낱말들 */
export function wordsOfLength(length: number): readonly Word[] {
  return WORDS_BY_LENGTH.get(length) ?? [];
}

// ───────── 조각 ─────────

/**
 * 가짜 조각으로는 쓰지 않는 글자. 낱말 안에서는 아무렇지 않지만 한 글자만 따로 놓이면 보기에 좋지 않다.
 * (쇠똥구리, 술래잡기, 목욕탕처럼 이 글자가 든 낱말이 문제로 나올 때 그 낱말의 조각으로는 나온다.)
 */
export const DECOY_BLOCKLIST: readonly string[] = ['똥', '술', '욕'];

/** 가짜 조각으로 쓸 수 있는 글자들. 낱말 목록에 나오는 글자만 써서 진짜 낱말의 조각처럼 보인다. */
export const DECOY_SYLLABLES: readonly string[] = [
  ...new Set(WORDS.flatMap((word) => [...word.text])),
]
  .filter((syllable) => !DECOY_BLOCKLIST.includes(syllable))
  .sort();

const DECOYS_BY_CHOSUNG = new Map<string, string[]>();
for (const syllable of DECOY_SYLLABLES) {
  const chosung = chosungOf(syllable);
  const list = DECOYS_BY_CHOSUNG.get(chosung);
  if (list) list.push(syllable);
  else DECOYS_BY_CHOSUNG.set(chosung, [syllable]);
}

/** 초성이 같은 가짜 조각 후보들 */
export function decoysWith(chosung: string): readonly string[] {
  return DECOYS_BY_CHOSUNG.get(chosung) ?? [];
}

export interface PoolSpec {
  /** 조각의 수. 답의 글자와 가짜 조각을 합친 것이다. */
  tiles: number;
  /** 답과 초성이 겹치지 않는 가짜 조각의 수. 나머지 가짜 조각은 답의 글자와 초성이 같다. */
  others: number;
  /** 조각을 한 줄에 몇 개씩 놓는지 */
  columns: number;
}

/**
 * 글자 수마다의 조각 무더기. 가짜 조각은 먼저 답의 글자마다 초성이 같은 것을 하나씩 넣고(초성만 보고는
 * 고를 수 없게 한다), others만큼 초성이 다른 것을 넣고, 남는 자리는 초성이 같은 것으로 더 채운다.
 * 두 글자는 6개(같은 초성 2, 다른 초성 2), 세 글자는 9개(4, 2), 네 글자는 12개(5, 3)다.
 */
export const POOL_SPECS: Readonly<Record<number, PoolSpec>> = {
  2: { tiles: 6, others: 2, columns: 3 },
  3: { tiles: 9, others: 2, columns: 3 },
  4: { tiles: 12, others: 3, columns: 4 },
};

export function poolSpec(length: number): PoolSpec {
  return POOL_SPECS[Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, length))];
}

function pickOne<T>(list: readonly T[], random: () => number): T {
  return list[Math.min(list.length - 1, Math.floor(random() * list.length))];
}

/** 순서를 섞은 새 배열을 돌려준다. */
export function shuffled<T>(list: readonly T[], random: () => number): T[] {
  const result = [...list];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.min(index, Math.floor(random() * (index + 1)));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

// ───────── 문제 ─────────

export interface Question {
  /** 이 문제를 만든 낱말. 조각으로 만들 수 있는 다른 낱말도 정답일 수 있다(isAccepted). */
  answer: string;
  category: string;
  /** 초성을 이어 붙인 것 */
  pattern: string;
  /** 조각에 적힌 글자들. 화면에 놓이는 순서다. 같은 글자가 두 번 들어 있을 수 있다(바나나의 "나"). */
  tiles: readonly string[];
}

/** 낱말 하나로 문제를 만든다: 답의 글자에 가짜 조각을 더해 섞는다. */
export function buildQuestion(word: Word, random: () => number): Question {
  const answer = [...word.text];
  const spec = poolSpec(answer.length);
  /** 이미 무더기에 든 글자. 가짜 조각은 답의 글자와도, 서로도 겹치지 않는다. */
  const taken = new Set(answer);
  const decoys: string[] = [];

  const addSame = (syllable: string): void => {
    const candidates = decoysWith(chosungOf(syllable)).filter((other) => !taken.has(other));
    if (candidates.length === 0) return;
    const decoy = pickOne(candidates, random);
    taken.add(decoy);
    decoys.push(decoy);
  };
  for (const syllable of answer) addSame(syllable);
  const extras = spec.tiles - spec.others - answer.length * 2;
  for (let count = 0; count < extras; count += 1) addSame(pickOne(answer, random));

  // 나머지는 답과 초성이 겹치지 않는 글자로 채운다. 초성이 같은 후보가 모자랐던 자리도 여기서 채워진다.
  const chosungs = new Set(answer.map(chosungOf));
  const others = DECOY_SYLLABLES.filter((other) => !chosungs.has(chosungOf(other)) && !taken.has(other));
  while (answer.length + decoys.length < spec.tiles && others.length > 0) {
    const index = Math.min(others.length - 1, Math.floor(random() * others.length));
    decoys.push(...others.splice(index, 1));
  }

  return {
    answer: word.text,
    category: word.category,
    pattern: patternOf(word.text),
    tiles: shuffled([...answer, ...decoys], random),
  };
}

/**
 * 조각으로 만든 낱말이 정답인지. 문제를 만든 낱말이 아니어도, 목록에 있는 낱말이고
 * 분류와 초성이 문제와 같으면 정답이다(음식 ㄱㅂ에서 "김밥" 대신 "갈비"를 만든 경우).
 */
export function isAccepted(question: Pick<Question, 'category' | 'pattern'>, assembled: string): boolean {
  const word = WORD_BY_TEXT.get(assembled);
  return word !== undefined && word.category === question.category && patternOf(word.text) === question.pattern;
}

/** 답을 만드는 조각의 번호들(answer의 글자 순서대로). 건너뛰었을 때 답을 보여 주는 데 쓴다. */
export function answerTiles(question: Question): number[] {
  const picked: number[] = [];
  for (const syllable of question.answer) {
    picked.push(question.tiles.findIndex((tile, index) => tile === syllable && !picked.includes(index)));
  }
  return picked;
}

// ───────── 난이도 ─────────

export interface RampStep {
  /** 맞힌 낱말이 이만큼 되면 이 단계가 된다 */
  from: number;
  /** 두 글자, 세 글자, 네 글자 낱말이 나오는 비율 */
  weights: readonly [two: number, three: number, four: number];
}

/** 처음에는 두 글자 낱말만 나오고, 맞힐수록 세 글자와 네 글자가 섞여 나온다. */
export const RAMP: readonly RampStep[] = [
  { from: 0, weights: [1, 0, 0] },
  { from: 4, weights: [5, 5, 0] },
  { from: 10, weights: [3, 4, 3] },
  { from: 18, weights: [1, 4, 5] },
];

export function lengthWeights(solved: number): readonly [number, number, number] {
  let step = RAMP[0];
  for (const next of RAMP) {
    if (solved >= next.from) step = next;
  }
  return step.weights;
}

/** 다음 문제의 글자 수를 고른다. */
export function pickLength(solved: number, random: () => number): number {
  const weights = lengthWeights(solved);
  const total = weights[0] + weights[1] + weights[2];
  let roll = random() * total;
  let picked = LENGTHS[0];
  for (let index = 0; index < weights.length; index += 1) {
    if (weights[index] <= 0) continue;
    picked = LENGTHS[index];
    roll -= weights[index];
    if (roll < 0) break;
  }
  return picked;
}

/**
 * 글자 수가 length이고 아직 나오지 않은 낱말을 하나 고른다.
 * 그 길이의 낱말이 모두 나왔으면 null이다(부르는 쪽이 used를 비우고 다시 부른다).
 */
export function pickWord(length: number, used: ReadonlySet<string>, random: () => number): Word | null {
  const fresh = wordsOfLength(length).filter((word) => !used.has(word.text));
  return fresh.length > 0 ? pickOne(fresh, random) : null;
}

// ───────── 점수 ─────────

/** 글자 수마다의 기본 점수 */
export const BASE_POINTS: Readonly<Record<number, number>> = { 2: 10, 3: 15, 4: 20 };
/** 틀리거나 건너뛰지 않고 이어서 맞힐 때마다 더 붙는 점수와 그 상한 */
export const STREAK_STEP_POINTS = 2;
export const MAX_STREAK_BONUS = 10;

/** streak번째로 이어서 맞혔을 때 붙는 보너스. 첫 번째는 0이다. */
export function streakBonus(streak: number): number {
  return Math.min(MAX_STREAK_BONUS, Math.max(0, streak - 1) * STREAK_STEP_POINTS);
}

/** 글자 수가 length인 낱말을 streak번째로 이어서 맞혔을 때의 점수 */
export function wordPoints(length: number, streak: number): number {
  return BASE_POINTS[Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, length))] + streakBonus(streak);
}

// ───────── 시간 ─────────

/** 시작할 때 주어지는 시간(초). 남은 시간은 이보다 많아지지 않는다. */
export const START_SECONDS = 60;
/** 틀린 낱말을 만들면 깎이는 시간 */
export const WRONG_PENALTY_SECONDS = 3;
/** 건너뛰면 깎이는 시간 */
export const SKIP_PENALTY_SECONDS = 2;
/** 맞히면 돌려받는 시간 */
export const CORRECT_SECONDS = 3;
/**
 * 맞힌 낱말이 SHRINK_EVERY개 늘 때마다 돌려받는 시간이 SHRINK_SECONDS씩 줄고, MIN_CORRECT_SECONDS 아래로는
 * 내려가지 않는다. 뒤로 갈수록 빠듯해져서 아주 잘하는 사람의 판도 끝이 난다.
 */
export const SHRINK_EVERY = 10;
export const SHRINK_SECONDS = 0.5;
export const MIN_CORRECT_SECONDS = 1;

/** 이미 solved개를 맞힌 뒤에 하나를 더 맞히면 돌려받는 시간 */
export function correctSeconds(solved: number): number {
  const shrink = Math.floor(Math.max(0, solved) / SHRINK_EVERY) * SHRINK_SECONDS;
  return Math.max(MIN_CORRECT_SECONDS, CORRECT_SECONDS - shrink);
}

// ───────── 한 판의 진행 ─────────

export interface RunState {
  timeLeft: number;
  score: number;
  /** 맞힌 낱말 수 */
  solved: number;
  /** 지금 이어서 맞히고 있는 수. 틀리거나 건너뛰면 0이 된다. */
  streak: number;
  bestStreak: number;
  skipped: number;
  /** 틀린 낱말을 만든 횟수 */
  misses: number;
  /** 이미 나온 낱말. 같은 낱말이 다시 나오지 않게 한다. */
  used: ReadonlySet<string>;
  question: Question;
  /** 답 칸마다 놓인 조각의 번호(question.tiles에서의 자리). 빈칸은 null이다. */
  slots: readonly (number | null)[];
  /** 이 문제가 끝났는지(맞혔거나 건너뛰었다). true면 nextQuestion으로 다음 문제를 낸다. */
  settled: boolean;
}

export type PlaceOutcome =
  /** 놓을 수 없었다(이미 쓴 조각, 끝난 문제, 끝난 판) */
  | { kind: 'ignored'; run: RunState }
  | { kind: 'placed'; run: RunState; slot: number }
  /** 마지막 칸이 채워져 정답이 되었다. 칸은 채워진 채로 남는다. */
  | { kind: 'correct'; run: RunState; slot: number; word: string; points: number; seconds: number }
  /** 마지막 칸이 채워졌지만 정답이 아니다. 칸은 모두 비워진다. */
  | { kind: 'wrong'; run: RunState; slot: number; word: string };

function emptySlots(question: Question): (number | null)[] {
  return new Array<number | null>(question.pattern.length).fill(null);
}

/**
 * 글자 수가 length인 다음 낱말을 고르고, 그 낱말까지 적은 "나온 낱말"을 함께 돌려준다.
 * 그 길이의 낱말이 모두 나왔으면 그 길이만 처음부터 다시 돈다. 그때도 바로 앞 문제의 낱말(last)이
 * 곧바로 또 나오지는 않는다.
 */
export function drawWord(
  length: number,
  used: ReadonlySet<string>,
  last: string | null,
  random: () => number,
): { word: Word; used: Set<string> } {
  let next = new Set(used);
  let word = pickWord(length, next, random);
  if (!word) {
    next = new Set([...next].filter((text) => text.length !== length));
    const others = wordsOfLength(length).filter((candidate) => candidate.text !== last);
    word = pickOne(others.length > 0 ? others : wordsOfLength(length), random);
  }
  next.add(word.text);
  return { word, used: next };
}

/** 글자 수가 length인 새 문제를 낸다. */
function deal(
  used: ReadonlySet<string>,
  length: number,
  last: string | null,
  random: () => number,
): { question: Question; used: Set<string> } {
  const drawn = drawWord(length, used, last, random);
  return { question: buildQuestion(drawn.word, random), used: drawn.used };
}

/** 새 판을 시작한다. recent에 지난 판에 나온 낱말을 주면 이번 판에서는 뒤로 미룬다. */
export function newRun(random: () => number, recent: Iterable<string> = []): RunState {
  const { question, used } = deal(new Set(recent), pickLength(0, random), null, random);
  return {
    timeLeft: START_SECONDS,
    score: 0,
    solved: 0,
    streak: 0,
    bestStreak: 0,
    skipped: 0,
    misses: 0,
    used,
    question,
    slots: emptySlots(question),
    settled: false,
  };
}

/** 답 칸에 놓인 글자를 이어 붙인 것. 빈칸은 건너뛴다. */
export function assembledWord(run: Pick<RunState, 'question' | 'slots'>): string {
  return run.slots.map((tile) => (tile === null ? '' : run.question.tiles[tile])).join('');
}

/**
 * 조각 하나를 가장 앞의 빈칸에 놓는다. 마지막 칸이 채워지면 바로 정답인지 가린다.
 * 정답이면 점수와 시간을 받고, 아니면 시간이 깎이고 이어 맞히던 수가 끊기며 칸이 비워진다.
 */
export function placeTile(run: RunState, tile: number): PlaceOutcome {
  const slot = run.slots.indexOf(null);
  const known = Number.isInteger(tile) && tile >= 0 && tile < run.question.tiles.length;
  if (run.settled || isOver(run) || !known || run.slots.includes(tile) || slot < 0) {
    return { kind: 'ignored', run };
  }
  const slots = run.slots.map((placed, index) => (index === slot ? tile : placed));
  if (slots.includes(null)) return { kind: 'placed', run: { ...run, slots }, slot };

  const word = assembledWord({ question: run.question, slots });
  if (!isAccepted(run.question, word)) {
    return {
      kind: 'wrong',
      slot,
      word,
      run: {
        ...run,
        slots: emptySlots(run.question),
        timeLeft: Math.max(0, run.timeLeft - WRONG_PENALTY_SECONDS),
        streak: 0,
        misses: run.misses + 1,
      },
    };
  }

  const streak = run.streak + 1;
  const points = wordPoints(word.length, streak);
  const seconds = correctSeconds(run.solved);
  return {
    kind: 'correct',
    slot,
    word,
    points,
    seconds,
    run: {
      ...run,
      slots,
      settled: true,
      score: run.score + points,
      solved: run.solved + 1,
      streak,
      bestStreak: Math.max(run.bestStreak, streak),
      timeLeft: Math.min(START_SECONDS, run.timeLeft + seconds),
      // 문제의 낱말 대신 다른 낱말로 맞혔으면 그 낱말도 나온 것으로 친다.
      used: new Set([...run.used, word]),
    },
  };
}

/** 답 칸 하나를 비워 그 조각을 무더기로 돌려보낸다. */
export function clearSlot(run: RunState, slot: number): RunState {
  if (run.settled || isOver(run) || run.slots[slot] === null || run.slots[slot] === undefined) return run;
  return { ...run, slots: run.slots.map((placed, index) => (index === slot ? null : placed)) };
}

/**
 * 이 문제를 건너뛴다. 시간이 조금 깎이고 이어 맞히던 수가 끊긴다.
 * 답 칸은 답으로 채워져서, 다음 문제로 넘어가기 전에 답을 보여 줄 수 있다.
 */
export function skipQuestion(run: RunState): RunState {
  if (run.settled || isOver(run)) return run;
  return {
    ...run,
    slots: answerTiles(run.question),
    settled: true,
    timeLeft: Math.max(0, run.timeLeft - SKIP_PENALTY_SECONDS),
    streak: 0,
    skipped: run.skipped + 1,
  };
}

/** 끝난 문제 다음의 새 문제를 낸다. 아직 풀고 있는 문제가 있으면 그대로 둔다. */
export function nextQuestion(run: RunState, random: () => number): RunState {
  if (!run.settled) return run;
  const { question, used } = deal(run.used, pickLength(run.solved, random), run.question.answer, random);
  return { ...run, question, used, slots: emptySlots(question), settled: false };
}

/** 시간이 seconds만큼 흐른다. */
export function elapse(run: RunState, seconds: number): RunState {
  return { ...run, timeLeft: Math.max(0, run.timeLeft - seconds) };
}

/** 시간이 다 되어 판이 끝났는지 */
export function isOver(run: RunState): boolean {
  return run.timeLeft <= 0;
}

// ───────── 화면 배치 ─────────

/** 게임 화면에서 HUD를 뺀 나머지 영역 */
export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Spot {
  /** 왼쪽 위 모서리 */
  x: number;
  y: number;
  size: number;
}

export interface QuizLayout {
  area: Area;
  /** 문제 카드(분류, 초성, 답 칸, 한 줄 알림이 놓이는 흰 판) */
  card: Area;
  /** 분류 칸의 가운데 높이 */
  chipY: number;
  /** 큰 초성 글자의 가운데 높이 */
  patternY: number;
  /** 답 칸의 위쪽 끝과 한 변 */
  slotTop: number;
  slotSize: number;
  /** 한 줄 알림의 가운데 높이 */
  noteY: number;
  /** 조각이 놓이는 자리(세 줄이 꽉 찼을 때)의 위쪽 끝과 높이 */
  gridTop: number;
  gridHeight: number;
  /** 세 개씩 놓을 때의 조각 한 변. 네 개씩 놓을 때는 WIDE_TILE_MAX를 넘지 않게 줄인다. */
  tileSize: number;
  tileGap: number;
  /** 건너뛰기 단추의 위쪽 끝 */
  skipTop: number;
}

/** 문제 카드가 화면 좌우 끝에서 떨어진 거리 */
export const CARD_MARGIN = 10;
/** 조각과 답 칸 아래로 도톰하게 내려오는 옆면의 두께 */
export const TILE_LIP = 3;
export const SLOT_GAP = 6;
export const SKIP_BUTTON = { width: 116, height: 28 } as const;
/** 조각 한 변의 범위. 화면이 길수록 커진다. */
export const TILE_MIN = 44;
export const TILE_MAX = 60;
/** 한 줄에 네 개를 놓을 때의 가장 큰 조각 */
export const WIDE_TILE_MAX = 50;
export const SLOT_MIN = 44;
export const SLOT_MAX = 48;
/** 조각이 가장 많을 때의 줄 수. 조각 자리의 높이는 언제나 이만큼으로 잡는다. */
export const GRID_ROWS = 3;
/** 높이가 정해진 것들: 카드 안쪽 여백, 분류 칸, 초성, 한 줄 알림 */
const CARD_PAD = 6;
export const CHIP_HEIGHT = 18;
export const PATTERN_HEIGHT = 40;
export const NOTE_HEIGHT = 14;
/** 가장 짧은 화면에서 HUD를 뺀 높이. 이보다 긴 만큼 조각과 답 칸을 키운다. */
const BASE_AREA_HEIGHT = 344;
/**
 * 사이사이의 틈: 가장 좁을 때의 높이와, 남는 높이를 나눠 가지는 비율.
 * 차례로 카드 위, 분류와 초성 사이, 초성과 답 칸 사이, 답 칸과 알림 사이, 카드와 조각 사이,
 * 조각과 단추 사이, 단추 아래.
 */
const GAPS: readonly (readonly [min: number, share: number])[] = [
  [4, 1],
  [3, 0.5],
  [3, 0.5],
  [5, 0.5],
  [8, 1.5],
  [8, 1.5],
  [8, 1],
];

/**
 * area(HUD 아래의 화면) 안에 위에서부터 문제 카드, 조각, 건너뛰기 단추를 놓는다.
 * 화면이 길면 조각과 답 칸이 커지고, 그래도 남는 높이는 틈에 나눠 준다.
 */
export function quizLayout(area: Area): QuizLayout {
  const grow = Math.max(0, area.height - BASE_AREA_HEIGHT);
  const tileSize = Math.min(TILE_MAX, Math.round(TILE_MIN + grow * 0.12));
  const tileGap = tileSize >= 52 ? 8 : 6;
  const slotSize = Math.min(SLOT_MAX, Math.round(SLOT_MIN + grow * 0.08));
  const gridHeight = GRID_ROWS * tileSize + (GRID_ROWS - 1) * tileGap + TILE_LIP;
  const cardInner = CHIP_HEIGHT + PATTERN_HEIGHT + slotSize + TILE_LIP + NOTE_HEIGHT;
  const fixed = CARD_PAD * 2 + cardInner + gridHeight + SKIP_BUTTON.height;
  const spare = Math.max(0, area.height - fixed - GAPS.reduce((sum, [min]) => sum + min, 0));
  const shares = GAPS.reduce((sum, [, share]) => sum + share, 0);
  const gap = (index: number): number => Math.round(GAPS[index][0] + (spare * GAPS[index][1]) / shares);

  const cardTop = area.y + gap(0);
  const chipTop = cardTop + CARD_PAD;
  const patternTop = chipTop + CHIP_HEIGHT + gap(1);
  const slotTop = patternTop + PATTERN_HEIGHT + gap(2);
  const noteTop = slotTop + slotSize + TILE_LIP + gap(3);
  const cardBottom = noteTop + NOTE_HEIGHT + CARD_PAD;
  const gridTop = cardBottom + gap(4);
  const skipTop = gridTop + gridHeight + gap(5);

  return {
    area,
    card: {
      x: area.x + CARD_MARGIN,
      y: cardTop,
      width: area.width - CARD_MARGIN * 2,
      height: cardBottom - cardTop,
    },
    chipY: chipTop + CHIP_HEIGHT / 2,
    patternY: patternTop + PATTERN_HEIGHT / 2,
    slotTop,
    slotSize,
    noteY: noteTop + NOTE_HEIGHT / 2,
    gridTop,
    gridHeight,
    tileSize,
    tileGap,
    skipTop,
  };
}

/** 답 칸 length개의 자리. 가로로 가운데에 모아 놓는다. */
export function slotSpots(layout: QuizLayout, length: number): Spot[] {
  const size = layout.slotSize;
  const width = length * size + (length - 1) * SLOT_GAP;
  const left = Math.round(layout.area.x + (layout.area.width - width) / 2);
  return Array.from({ length }, (_, index) => ({ x: left + index * (size + SLOT_GAP), y: layout.slotTop, size }));
}

/** 조각 count개의 자리. 한 줄에 columns개씩, 조각 자리의 한가운데에 모아 놓는다. */
export function tileSpots(layout: QuizLayout, count: number, columns: number): Spot[] {
  const size = columns > 3 ? Math.min(layout.tileSize, WIDE_TILE_MAX) : layout.tileSize;
  const gap = columns > 3 ? Math.min(layout.tileGap, 6) : layout.tileGap;
  const rows = Math.ceil(count / columns);
  const width = columns * size + (columns - 1) * gap;
  const height = rows * size + (rows - 1) * gap + TILE_LIP;
  const left = Math.round(layout.area.x + (layout.area.width - width) / 2);
  const top = Math.round(layout.gridTop + (layout.gridHeight - height) / 2);
  return Array.from({ length: count }, (_, index) => ({
    x: left + (index % columns) * (size + gap),
    y: top + Math.floor(index / columns) * (size + gap),
    size,
  }));
}
