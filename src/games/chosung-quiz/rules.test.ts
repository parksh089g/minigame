import { describe, expect, it } from 'vitest';
import { GAME_WIDTH, MAX_GAME_HEIGHT, MIN_GAME_HEIGHT } from '../../config';
import {
  answerTiles,
  assembledWord,
  BASE_POINTS,
  buildQuestion,
  CHOSUNG,
  chosungOf,
  clearSlot,
  CORRECT_SECONDS,
  correctSeconds,
  DECOY_BLOCKLIST,
  DECOY_SYLLABLES,
  decoysWith,
  drawWord,
  elapse,
  isAccepted,
  isOver,
  isSyllable,
  lengthWeights,
  LENGTHS,
  MAX_STREAK_BONUS,
  MIN_CORRECT_SECONDS,
  newRun,
  nextQuestion,
  patternOf,
  pickLength,
  pickWord,
  placeTile,
  POOL_SPECS,
  poolSpec,
  quizLayout,
  RAMP,
  shuffled,
  SHRINK_EVERY,
  SHRINK_SECONDS,
  SKIP_BUTTON,
  SKIP_PENALTY_SECONDS,
  skipQuestion,
  slotSpots,
  START_SECONDS,
  streakBonus,
  STREAK_STEP_POINTS,
  TILE_LIP,
  tileSpots,
  wordPoints,
  wordsOfLength,
  WRONG_PENALTY_SECONDS,
  type PlaceOutcome,
  type Question,
  type RunState,
} from './rules';
import { CATEGORIES, WORDS } from './words';

/** 시드가 같으면 같은 수열이 나오는 난수(mulberry32). */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 주아 글꼴에 들어 있는 KS X 1001 한글 2,350자. EUC-KR에서 한글이 놓인 두 바이트 구간
 * (0xB0A1부터 0xC8FE까지)을 모두 풀어서 만든다.
 */
function ksx1001Syllables(): Set<string> {
  const decoder = new TextDecoder('euc-kr');
  const syllables = new Set<string>();
  for (let lead = 0xb0; lead <= 0xc8; lead += 1) {
    for (let trail = 0xa1; trail <= 0xfe; trail += 1) {
      syllables.add(decoder.decode(new Uint8Array([lead, trail])));
    }
  }
  return syllables;
}

const KSX1001 = ksx1001Syllables();

function wordOf(text: string): { text: string; category: string } {
  const word = WORDS.find((candidate) => candidate.text === text);
  if (!word) throw new Error(`목록에 없는 낱말: ${text}`);
  return word;
}

/** 손으로 만든 문제로 판을 시작한다. 조각의 순서를 알고 있어야 하는 테스트에 쓴다. */
function runWith(question: Question, overrides: Partial<RunState> = {}): RunState {
  return {
    ...newRun(seeded(1)),
    question,
    slots: new Array<number | null>(question.pattern.length).fill(null),
    used: new Set([question.answer]),
    ...overrides,
  };
}

const KIMBAP: Question = {
  answer: '김밥',
  category: '음식',
  pattern: 'ㄱㅂ',
  tiles: ['비', '김', '초', '갈', '밥', '면'],
};

/** 조각을 차례로 놓고 마지막 결과를 돌려준다. */
function placeAll(run: RunState, tiles: readonly number[]): PlaceOutcome {
  let outcome: PlaceOutcome = { kind: 'ignored', run };
  for (const tile of tiles) outcome = placeTile(outcome.run, tile);
  return outcome;
}

/** 지금 문제를 맞힌다. */
function solve(run: RunState): PlaceOutcome {
  return placeAll(run, answerTiles(run.question));
}

/** 지금 문제를 틀린다: 답의 마지막 글자 대신 가짜 조각을 놓는다. */
function miss(run: RunState): PlaceOutcome {
  const right = answerTiles(run.question);
  const decoy = run.question.tiles.findIndex(
    (tile, index) => !right.includes(index) && !isAccepted(run.question, run.question.answer.slice(0, -1) + tile),
  );
  return placeAll(run, [...right.slice(0, -1), decoy]);
}

describe('초성', () => {
  it('초성 열아홉 개는 모두 화면에 쓸 수 있는 호환 자모다', () => {
    expect(CHOSUNG).toHaveLength(19);
    expect(new Set(CHOSUNG).size).toBe(19);
    for (const jamo of CHOSUNG) {
      expect(jamo.charCodeAt(0)).toBeGreaterThanOrEqual(0x3131);
      expect(jamo.charCodeAt(0)).toBeLessThanOrEqual(0x314e);
    }
  });

  it.each([
    ['가', 'ㄱ'],
    ['깎', 'ㄲ'],
    ['넛', 'ㄴ'],
    ['돛', 'ㄷ'],
    ['떡', 'ㄸ'],
    ['릎', 'ㄹ'],
    ['멧', 'ㅁ'],
    ['볶', 'ㅂ'],
    ['뽕', 'ㅃ'],
    ['숟', 'ㅅ'],
    ['썹', 'ㅆ'],
    ['윷', 'ㅇ'],
    ['짚', 'ㅈ'],
    ['찐', 'ㅉ'],
    ['첼', 'ㅊ'],
    ['캥', 'ㅋ'],
    ['튤', 'ㅌ'],
    ['팥', 'ㅍ'],
    ['힣', 'ㅎ'],
  ])('"%s"의 초성은 %s이다', (syllable, chosung) => {
    expect(chosungOf(syllable)).toBe(chosung);
  });

  it('초성마다 첫 글자와 마지막 글자가 같은 초성으로 나온다', () => {
    CHOSUNG.forEach((jamo, index) => {
      expect(chosungOf(String.fromCharCode(0xac00 + index * 588))).toBe(jamo);
      expect(chosungOf(String.fromCharCode(0xac00 + index * 588 + 587))).toBe(jamo);
    });
  });

  it('한글 글자가 아니면 초성이 없다', () => {
    for (const other of ['a', '1', ' ', 'ㄱ', 'ㅏ', '', '가나']) {
      expect(isSyllable(other)).toBe(false);
      expect(chosungOf(other)).toBe('');
    }
    expect(isSyllable('가')).toBe(true);
    expect(isSyllable('힣')).toBe(true);
  });

  it('낱말의 초성을 이어 붙인다', () => {
    expect(patternOf('수박')).toBe('ㅅㅂ');
    expect(patternOf('떡볶이')).toBe('ㄸㅂㅇ');
    expect(patternOf('숨바꼭질')).toBe('ㅅㅂㄲㅈ');
    expect(patternOf('바나나')).toBe('ㅂㄴㄴ');
  });
});

describe('낱말 목록', () => {
  it('KS X 1001 한글은 2,350자다', () => {
    expect(KSX1001.size).toBe(2350);
    expect(KSX1001.has('가')).toBe(true);
    expect(KSX1001.has('힝')).toBe(true);
    // 표준 완성형에 없는 글자들
    expect(KSX1001.has('똠')).toBe(false);
    expect(KSX1001.has('쀍')).toBe(false);
  });

  it('낱말은 240개 이상이고 분류는 10개 이상이다', () => {
    expect(WORDS.length).toBeGreaterThanOrEqual(240);
    expect(CATEGORIES.length).toBeGreaterThanOrEqual(10);
    expect(new Set(CATEGORIES).size).toBe(CATEGORIES.length);
  });

  it('모든 낱말은 두 글자에서 네 글자까지의 한글이다', () => {
    for (const word of WORDS) {
      expect(word.text, word.text).toMatch(/^[가-힣]{2,4}$/);
    }
  });

  it('같은 낱말이 두 번 들어 있지 않다', () => {
    const seen = new Set<string>();
    const repeated: string[] = [];
    for (const word of WORDS) {
      if (seen.has(word.text)) repeated.push(word.text);
      seen.add(word.text);
    }
    expect(repeated).toEqual([]);
  });

  it('모든 낱말의 모든 글자가 KS X 1001 안에 있다', () => {
    const missing = WORDS.filter((word) => [...word.text].some((syllable) => !KSX1001.has(syllable)));
    expect(missing.map((word) => word.text)).toEqual([]);
  });

  it('분류 이름은 짧고, 글꼴에 있는 글자만 쓴다', () => {
    for (const category of CATEGORIES) {
      expect(category.length, category).toBeGreaterThanOrEqual(1);
      expect(category.length, category).toBeLessThanOrEqual(5);
      for (const char of category.replaceAll(' ', '')) expect(KSX1001.has(char), category).toBe(true);
    }
  });

  it('모든 낱말은 목록에 있는 분류에 속하고, 분류마다 낱말이 열 개 이상이다', () => {
    for (const word of WORDS) expect(CATEGORIES, word.text).toContain(word.category);
    for (const category of CATEGORIES) {
      const count = WORDS.filter((word) => word.category === category).length;
      expect(count, category).toBeGreaterThanOrEqual(10);
    }
  });

  it('글자 수마다 낱말이 넉넉하다', () => {
    expect(wordsOfLength(2).length).toBeGreaterThanOrEqual(100);
    expect(wordsOfLength(3).length).toBeGreaterThanOrEqual(100);
    expect(wordsOfLength(4).length).toBeGreaterThanOrEqual(50);
    expect(wordsOfLength(2).length + wordsOfLength(3).length + wordsOfLength(4).length).toBe(WORDS.length);
    expect(wordsOfLength(5)).toEqual([]);
  });
});

describe('가짜 조각', () => {
  it('가짜 조각으로 나올 수 있는 글자는 모두 KS X 1001 안에 있다', () => {
    expect(DECOY_SYLLABLES.length).toBeGreaterThan(300);
    expect(DECOY_SYLLABLES.filter((syllable) => !KSX1001.has(syllable))).toEqual([]);
  });

  it('가짜 조각은 낱말 목록에 나오는 글자에서만 가져온다', () => {
    const inWords = new Set(WORDS.flatMap((word) => [...word.text]));
    expect(DECOY_SYLLABLES.filter((syllable) => !inWords.has(syllable))).toEqual([]);
    expect(new Set(DECOY_SYLLABLES).size).toBe(DECOY_SYLLABLES.length);
  });

  it('한 글자만 놓이면 보기 좋지 않은 글자는 가짜 조각으로 쓰지 않는다', () => {
    const inWords = new Set(WORDS.flatMap((word) => [...word.text]));
    expect(DECOY_BLOCKLIST.length).toBeGreaterThan(0);
    for (const syllable of DECOY_BLOCKLIST) {
      // 낱말에 나오지 않는 글자는 적어 둘 까닭이 없다.
      expect(inWords.has(syllable), syllable).toBe(true);
      expect(DECOY_SYLLABLES).not.toContain(syllable);
    }
    expect(DECOY_SYLLABLES).toHaveLength(inWords.size - DECOY_BLOCKLIST.length);
  });

  it('가짜 조각으로 쓰지 않는 글자도 그 글자가 든 낱말의 조각으로는 나온다', () => {
    const question = buildQuestion(wordOf('술래잡기'), seeded(3));
    expect(question.tiles).toContain('술');
    expect(answerTiles(question).map((index) => question.tiles[index]).join('')).toBe('술래잡기');
  });

  it('초성으로 찾은 후보는 모두 그 초성으로 시작한다', () => {
    for (const jamo of CHOSUNG) {
      for (const syllable of decoysWith(jamo)) expect(chosungOf(syllable)).toBe(jamo);
    }
    expect(decoysWith('ㅏ')).toEqual([]);
  });

  it('낱말에 나오는 초성마다 같은 초성의 후보가 답의 글자 말고도 넉넉히 있다', () => {
    for (const word of WORDS) {
      for (const syllable of word.text) {
        const others = decoysWith(chosungOf(syllable)).filter((other) => !word.text.includes(other));
        // 네 글자가 모두 같은 초성이어도 하나씩 붙이고 하나를 더 넣을 수 있어야 한다.
        const needed = [...word.text].filter((other) => chosungOf(other) === chosungOf(syllable)).length + 1;
        expect(others.length, `${word.text}의 ${syllable}`).toBeGreaterThanOrEqual(Math.max(needed, 3));
      }
    }
  });
});

describe('문제 만들기', () => {
  it('글자 수마다 조각 수가 정해져 있고 한 화면에 격자로 놓인다', () => {
    expect(POOL_SPECS[2]).toMatchObject({ tiles: 6, columns: 3 });
    expect(POOL_SPECS[3]).toMatchObject({ tiles: 9, columns: 3 });
    expect(POOL_SPECS[4]).toMatchObject({ tiles: 12, columns: 4 });
    for (const length of LENGTHS) {
      const spec = poolSpec(length);
      expect(spec.tiles % spec.columns).toBe(0);
      // 답의 글자마다 초성이 같은 가짜 조각을 하나씩은 넣을 자리가 있다.
      expect(spec.tiles - spec.others).toBeGreaterThanOrEqual(length * 2);
    }
  });

  it('모든 낱말로 만든 문제가 규칙을 지킨다', () => {
    for (const seed of [1, 2, 3]) {
      const random = seeded(seed);
      for (const word of WORDS) {
        const question = buildQuestion(word, random);
        const answer = [...word.text];
        const spec = poolSpec(answer.length);
        const label = `${word.text} (${question.tiles.join('')})`;

        expect(question.answer).toBe(word.text);
        expect(question.category).toBe(word.category);
        expect(question.pattern).toBe(patternOf(word.text));
        expect(question.tiles, label).toHaveLength(spec.tiles);

        // 답의 글자가 모두(같은 글자가 두 번이면 두 개) 조각에 들어 있다.
        const picked = answerTiles(question);
        expect(picked.every((index) => index >= 0), label).toBe(true);
        expect(new Set(picked).size, label).toBe(answer.length);
        expect(picked.map((index) => question.tiles[index]).join('')).toBe(word.text);

        // 가짜 조각은 답의 글자와도, 서로도 겹치지 않는다.
        const decoys = question.tiles.filter((_, index) => !picked.includes(index));
        expect(new Set(decoys).size, label).toBe(decoys.length);
        expect(decoys.filter((decoy) => answer.includes(decoy)), label).toEqual([]);
        for (const decoy of decoys) {
          expect(DECOY_SYLLABLES, label).toContain(decoy);
          expect(KSX1001.has(decoy), label).toBe(true);
        }

        // 초성만 보고는 고를 수 없게, 답의 글자마다 초성이 같은 가짜 조각이 하나씩은 있다.
        const chosungs = answer.map(chosungOf);
        for (const jamo of new Set(chosungs)) {
          const inAnswer = chosungs.filter((other) => other === jamo).length;
          const inDecoys = decoys.filter((decoy) => chosungOf(decoy) === jamo).length;
          expect(inDecoys, `${label}의 ${jamo}`).toBeGreaterThanOrEqual(inAnswer);
        }
        // 초성이 다른 가짜 조각도 정해진 수만큼 섞여 있다.
        const strangers = decoys.filter((decoy) => !chosungs.includes(chosungOf(decoy)));
        expect(strangers, label).toHaveLength(spec.others);
      }
    }
  });

  it('씨앗이 같으면 같은 문제가 나오고, 다르면 조각이 달라진다', () => {
    const word = wordOf('고슴도치');
    expect(buildQuestion(word, seeded(7))).toEqual(buildQuestion(word, seeded(7)));
    const pools = new Set([1, 2, 3, 4, 5, 6].map((seed) => buildQuestion(word, seeded(seed)).tiles.join('')));
    expect(pools.size).toBeGreaterThan(1);
  });

  it('답의 글자가 언제나 같은 자리에 놓이지는 않는다', () => {
    const random = seeded(11);
    const firstSpots = new Set<number>();
    for (const word of wordsOfLength(2).slice(0, 80)) {
      firstSpots.add(answerTiles(buildQuestion(word, random))[0]);
    }
    expect(firstSpots.size).toBe(POOL_SPECS[2].tiles);
  });

  it('섞어도 들어 있는 것은 그대로다', () => {
    const list = ['가', '나', '다', '라', '마'];
    const mixed = shuffled(list, seeded(3));
    expect([...mixed].sort()).toEqual([...list].sort());
    expect(list).toEqual(['가', '나', '다', '라', '마']);
  });

  it('같은 글자가 두 번 나오는 낱말은 그 글자의 조각도 두 개다', () => {
    const question = buildQuestion(wordOf('바나나'), seeded(5));
    expect(question.tiles.filter((tile) => tile === '나')).toHaveLength(2);
    const picked = answerTiles(question);
    expect(picked[1]).not.toBe(picked[2]);
  });
});

describe('정답 가리기', () => {
  it('문제를 만든 낱말은 정답이다', () => {
    for (const word of WORDS) {
      expect(isAccepted({ category: word.category, pattern: patternOf(word.text) }, word.text)).toBe(true);
    }
  });

  it('분류와 초성이 같은 다른 낱말도 정답이다', () => {
    expect(isAccepted(KIMBAP, '갈비')).toBe(true);
    expect(isAccepted(KIMBAP, '국밥')).toBe(true);
  });

  it('초성이 같아도 분류가 다르면 정답이 아니다', () => {
    const question = { category: '동물', pattern: 'ㅅㅈ' };
    expect(isAccepted(question, '사자')).toBe(true);
    expect(wordOf('시장').category).toBe('장소');
    expect(isAccepted(question, '시장')).toBe(false);
  });

  it('분류가 같아도 초성이 다르면 정답이 아니다', () => {
    expect(wordOf('김치').category).toBe('음식');
    expect(isAccepted(KIMBAP, '김치')).toBe(false);
  });

  it('목록에 없는 글자 묶음은 정답이 아니다', () => {
    expect(isAccepted(KIMBAP, '김비')).toBe(false);
    expect(isAccepted(KIMBAP, '김')).toBe(false);
    expect(isAccepted(KIMBAP, '')).toBe(false);
  });

  it('조각으로 다른 정답 낱말을 만들어도 맞은 것으로 치고, 그 낱말도 나온 것으로 적는다', () => {
    // 조각은 비(0) 김(1) 초(2) 갈(3) 밥(4) 면(5)이다.
    const outcome = placeAll(runWith(KIMBAP), [3, 0]);
    expect(outcome.kind).toBe('correct');
    if (outcome.kind !== 'correct') return;
    expect(outcome.word).toBe('갈비');
    expect(outcome.run.solved).toBe(1);
    expect(outcome.run.used.has('갈비')).toBe(true);
    expect(outcome.run.used.has('김밥')).toBe(true);
  });
});

describe('조각 놓기', () => {
  it('조각은 가장 앞의 빈칸에 들어간다', () => {
    const first = placeTile(runWith(KIMBAP), 1);
    expect(first.kind).toBe('placed');
    expect(first.run.slots).toEqual([1, null]);
    expect(assembledWord(first.run)).toBe('김');
  });

  it('이미 올라간 조각이나 없는 조각은 놓이지 않는다', () => {
    const first = placeTile(runWith(KIMBAP), 1).run;
    for (const tile of [1, -1, 6, 0.5, Number.NaN]) {
      const outcome = placeTile(first, tile);
      expect(outcome.kind).toBe('ignored');
      expect(outcome.run).toBe(first);
    }
  });

  it('채워진 칸을 비우면 그 조각을 다시 쓸 수 있고, 다음 조각은 그 빈칸으로 들어간다', () => {
    const question: Question = { ...buildQuestion(wordOf('고구마'), seeded(2)) };
    const [go, gu, ma] = answerTiles(question);
    let run = placeAll(runWith(question), [go, gu]).run;
    expect(run.slots).toEqual([go, gu, null]);

    run = clearSlot(run, 0);
    expect(run.slots).toEqual([null, gu, null]);
    // 빈칸을 한 번 더 비우려 해도 아무 일이 없다.
    expect(clearSlot(run, 0)).toBe(run);
    expect(clearSlot(run, 7)).toBe(run);

    run = placeTile(run, ma).run;
    expect(run.slots).toEqual([ma, gu, null]);
    const outcome = placeTile(run, go);
    // "마구고"는 낱말이 아니다.
    expect(outcome.kind).toBe('wrong');
  });

  it('마지막 칸이 채워지기 전에는 맞고 틀림을 가리지 않는다', () => {
    const run = placeTile(runWith(KIMBAP), 2).run;
    expect(run.misses).toBe(0);
    expect(run.timeLeft).toBe(START_SECONDS);
    expect(run.settled).toBe(false);
  });
});

describe('점수와 연속', () => {
  it('글자가 많은 낱말일수록 기본 점수가 높다', () => {
    expect(BASE_POINTS[2]).toBeLessThan(BASE_POINTS[3]);
    expect(BASE_POINTS[3]).toBeLessThan(BASE_POINTS[4]);
    expect(wordPoints(2, 1)).toBe(BASE_POINTS[2]);
    expect(wordPoints(3, 1)).toBe(BASE_POINTS[3]);
    expect(wordPoints(4, 1)).toBe(BASE_POINTS[4]);
  });

  it('이어서 맞힐수록 보너스가 붙고 상한에서 멈춘다', () => {
    expect(streakBonus(0)).toBe(0);
    expect(streakBonus(1)).toBe(0);
    expect(streakBonus(2)).toBe(STREAK_STEP_POINTS);
    expect(streakBonus(3)).toBe(STREAK_STEP_POINTS * 2);
    expect(streakBonus(100)).toBe(MAX_STREAK_BONUS);
    expect(wordPoints(4, 100)).toBe(BASE_POINTS[4] + MAX_STREAK_BONUS);
  });

  it('맞히면 점수와 맞힌 수와 연속이 오르고 문제가 끝난다', () => {
    const outcome = placeAll(runWith(KIMBAP, { streak: 2, bestStreak: 2, score: 30, solved: 2 }), [1, 4]);
    expect(outcome.kind).toBe('correct');
    if (outcome.kind !== 'correct') return;
    expect(outcome.word).toBe('김밥');
    expect(outcome.points).toBe(wordPoints(2, 3));
    expect(outcome.run.score).toBe(30 + wordPoints(2, 3));
    expect(outcome.run.solved).toBe(3);
    expect(outcome.run.streak).toBe(3);
    expect(outcome.run.bestStreak).toBe(3);
    expect(outcome.run.settled).toBe(true);
    // 맞힌 낱말은 칸에 남아서 화면에 보여 줄 수 있다.
    expect(assembledWord(outcome.run)).toBe('김밥');
  });

  it('틀리면 연속이 끊기지만 가장 길었던 연속은 남는다', () => {
    const outcome = placeAll(runWith(KIMBAP, { streak: 4, bestStreak: 6, score: 80 }), [1, 0]);
    expect(outcome.kind).toBe('wrong');
    if (outcome.kind !== 'wrong') return;
    expect(outcome.word).toBe('김비');
    expect(outcome.run.streak).toBe(0);
    expect(outcome.run.bestStreak).toBe(6);
    expect(outcome.run.score).toBe(80);
    expect(outcome.run.misses).toBe(1);
    expect(outcome.run.solved).toBe(0);
    // 칸이 비워져서 같은 문제를 다시 풀 수 있다.
    expect(outcome.run.slots).toEqual([null, null]);
    expect(outcome.run.settled).toBe(false);
    expect(placeAll(outcome.run, [1, 4]).kind).toBe('correct');
  });

  it('틀린 뒤에 다시 맞히면 보너스는 처음부터 다시 쌓인다', () => {
    const missed = placeAll(runWith(KIMBAP, { streak: 5, bestStreak: 5 }), [1, 0]).run;
    const outcome = placeAll(missed, [1, 4]);
    expect(outcome.kind).toBe('correct');
    if (outcome.kind !== 'correct') return;
    expect(outcome.points).toBe(BASE_POINTS[2]);
    expect(outcome.run.streak).toBe(1);
  });
});

describe('시간', () => {
  it('맞히면 시간을 돌려받지만 시작할 때의 시간을 넘지는 않는다', () => {
    const outcome = placeAll(runWith(KIMBAP, { timeLeft: 20 }), [1, 4]);
    expect(outcome.kind).toBe('correct');
    if (outcome.kind !== 'correct') return;
    expect(outcome.seconds).toBe(CORRECT_SECONDS);
    expect(outcome.run.timeLeft).toBe(20 + CORRECT_SECONDS);

    const full = placeAll(runWith(KIMBAP, { timeLeft: START_SECONDS - 1 }), [1, 4]);
    expect(full.run.timeLeft).toBe(START_SECONDS);
  });

  it('많이 맞힐수록 돌려받는 시간이 줄고, 바닥 아래로는 내려가지 않는다', () => {
    expect(correctSeconds(0)).toBe(CORRECT_SECONDS);
    expect(correctSeconds(SHRINK_EVERY - 1)).toBe(CORRECT_SECONDS);
    expect(correctSeconds(SHRINK_EVERY)).toBe(CORRECT_SECONDS - SHRINK_SECONDS);
    expect(correctSeconds(SHRINK_EVERY * 2)).toBe(CORRECT_SECONDS - SHRINK_SECONDS * 2);
    expect(correctSeconds(1000)).toBe(MIN_CORRECT_SECONDS);
    expect(CORRECT_SECONDS).toBeGreaterThanOrEqual(2);
    expect(CORRECT_SECONDS).toBeLessThanOrEqual(3);
    for (let solved = 0; solved < 200; solved += 1) {
      expect(correctSeconds(solved + 1)).toBeLessThanOrEqual(correctSeconds(solved));
      expect(correctSeconds(solved)).toBeGreaterThanOrEqual(MIN_CORRECT_SECONDS);
    }

    const late = placeAll(runWith(KIMBAP, { timeLeft: 20, solved: SHRINK_EVERY * 2 }), [1, 4]);
    expect(late.run.timeLeft).toBe(20 + CORRECT_SECONDS - SHRINK_SECONDS * 2);
  });

  it('틀리면 시간이 깎인다', () => {
    const outcome = placeAll(runWith(KIMBAP, { timeLeft: 20 }), [1, 0]);
    expect(outcome.run.timeLeft).toBe(20 - WRONG_PENALTY_SECONDS);
    expect(WRONG_PENALTY_SECONDS).toBe(3);
  });

  it('건너뛰면 시간이 조금 깎이고 연속이 끊기며 답이 칸에 채워진다', () => {
    const run = skipQuestion(runWith(KIMBAP, { timeLeft: 20, streak: 3, bestStreak: 3, score: 40 }));
    expect(run.timeLeft).toBe(20 - SKIP_PENALTY_SECONDS);
    expect(SKIP_PENALTY_SECONDS).toBeLessThan(WRONG_PENALTY_SECONDS);
    expect(run.streak).toBe(0);
    expect(run.bestStreak).toBe(3);
    expect(run.skipped).toBe(1);
    expect(run.score).toBe(40);
    expect(run.solved).toBe(0);
    expect(run.settled).toBe(true);
    expect(assembledWord(run)).toBe('김밥');
    // 이미 끝난 문제는 또 건너뛰어지지 않는다.
    expect(skipQuestion(run)).toBe(run);
  });

  it('깎여도 남은 시간이 0 아래로 내려가지 않고, 0이 되면 판이 끝난다', () => {
    const missed = placeAll(runWith(KIMBAP, { timeLeft: 1 }), [1, 0]).run;
    expect(missed.timeLeft).toBe(0);
    expect(isOver(missed)).toBe(true);

    const skipped = skipQuestion(runWith(KIMBAP, { timeLeft: 0.5 }));
    expect(skipped.timeLeft).toBe(0);
    expect(isOver(skipped)).toBe(true);
  });

  it('시간이 흐르면 줄어들고, 다 되면 끝난다', () => {
    let run = runWith(KIMBAP);
    expect(run.timeLeft).toBe(START_SECONDS);
    expect(START_SECONDS).toBe(60);
    run = elapse(run, 12.5);
    expect(run.timeLeft).toBe(START_SECONDS - 12.5);
    expect(isOver(run)).toBe(false);
    run = elapse(run, 100);
    expect(run.timeLeft).toBe(0);
    expect(isOver(run)).toBe(true);
  });

  it('판이 끝난 뒤에는 조각도, 칸 비우기도, 건너뛰기도 듣지 않는다', () => {
    const over = elapse(placeTile(runWith(KIMBAP), 1).run, START_SECONDS);
    expect(placeTile(over, 4).kind).toBe('ignored');
    expect(clearSlot(over, 0)).toBe(over);
    expect(skipQuestion(over)).toBe(over);
  });
});

describe('다음 문제', () => {
  it('문제가 끝나기 전에는 다음 문제로 넘어가지 않는다', () => {
    const run = newRun(seeded(4));
    expect(nextQuestion(run, seeded(5))).toBe(run);
  });

  it('맞히거나 건너뛴 뒤에는 새 문제가 빈칸으로 나온다', () => {
    const random = seeded(6);
    const solved = solve(newRun(random)).run;
    const next = nextQuestion(solved, random);
    expect(next.question.answer).not.toBe(solved.question.answer);
    expect(next.settled).toBe(false);
    expect(next.slots.every((slot) => slot === null)).toBe(true);
    expect(next.slots).toHaveLength(next.question.answer.length);
    expect(next.score).toBe(solved.score);
    expect(next.timeLeft).toBe(solved.timeLeft);

    const after = nextQuestion(skipQuestion(next), random);
    expect(after.question.answer).not.toBe(next.question.answer);
    expect(after.used.has(next.question.answer)).toBe(true);
  });

  it('끝난 문제에는 조각이 더 놓이지 않는다', () => {
    const solved = solve(newRun(seeded(8))).run;
    const spare = solved.question.tiles.findIndex((_, index) => !solved.slots.includes(index));
    expect(placeTile(solved, spare).kind).toBe('ignored');
    expect(clearSlot(solved, 0)).toBe(solved);
  });

  it('한 판에서 같은 낱말이 다시 나오지 않는다', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const random = seeded(seed);
      let run = newRun(random);
      const asked = [run.question.answer];
      for (let count = 0; count < 120; count += 1) {
        // 맞히기, 틀린 뒤 맞히기, 건너뛰기를 섞는다.
        if (count % 7 === 3) run = skipQuestion(run);
        else if (count % 5 === 2) run = solve(miss(run).run).run;
        else run = solve(run).run;
        run = nextQuestion({ ...run, timeLeft: START_SECONDS }, random);
        asked.push(run.question.answer);
      }
      expect(new Set(asked).size, `씨앗 ${seed}`).toBe(asked.length);
    }
  });

  it('한 길이의 낱말이 다 나오면 그 길이만 처음부터 다시 돈다', () => {
    const random = seeded(9);
    const fours = wordsOfLength(4).length;
    let run = newRun(random);
    const asked: string[] = [];
    for (let count = 0; count < 600; count += 1) {
      run = nextQuestion({ ...solve(run).run, timeLeft: START_SECONDS }, random);
      asked.push(run.question.answer);
    }
    const askedFours = asked.filter((text) => text.length === 4);
    expect(askedFours.length).toBeGreaterThan(fours * 2);
    // 처음 한 바퀴는 모두 다른 낱말이고, 목록의 네 글자 낱말이 빠짐없이 나온다.
    expect(new Set(askedFours.slice(0, fours)).size).toBe(fours);
    // 둘째 바퀴도 그 안에서는 겹치지 않는다.
    expect(new Set(askedFours.slice(fours, fours * 2)).size).toBe(fours);
    // 그동안 다른 길이의 낱말은 다시 나오지 않았다.
    const askedThrees = asked.filter((text) => text.length === 3);
    expect(new Set(askedThrees).size).toBe(Math.min(askedThrees.length, wordsOfLength(3).length));
    for (let index = 1; index < asked.length; index += 1) {
      expect(asked[index]).not.toBe(asked[index - 1]);
    }
  });

  it('다 나와서 다시 돌 때에도 바로 앞 문제의 낱말은 잇달아 나오지 않는다', () => {
    const fours = wordsOfLength(4).map((word) => word.text);
    const used = new Set([...fours, '수박', '고구마']);
    const random = seeded(31);
    const drawnWords = new Set<string>();
    for (let count = 0; count < 2000; count += 1) {
      const drawn = drawWord(4, used, '고슴도치', random);
      expect(drawn.word.text).not.toBe('고슴도치');
      drawnWords.add(drawn.word.text);
      // 네 글자 낱말은 새로 고른 것만 남고, 다른 길이의 낱말은 그대로 남는다.
      expect([...drawn.used].filter((text) => text.length === 4)).toEqual([drawn.word.text]);
      expect(drawn.used.has('수박')).toBe(true);
      expect(drawn.used.has('고구마')).toBe(true);
    }
    expect(drawnWords.size).toBe(fours.length - 1);
    // 받은 묶음은 바꾸지 않는다.
    expect(used.size).toBe(fours.length + 2);
  });

  it('아직 나오지 않은 낱말이 있으면 그 가운데에서 고르고 나온 낱말에 더한다', () => {
    const used = new Set(wordsOfLength(4).map((word) => word.text));
    used.delete('고슴도치');
    used.delete('숨바꼭질');
    const random = seeded(32);
    const picked = new Set<string>();
    for (let count = 0; count < 60; count += 1) {
      const drawn = drawWord(4, used, null, random);
      picked.add(drawn.word.text);
      expect(drawn.used.size).toBe(used.size + 1);
    }
    expect([...picked].sort()).toEqual(['고슴도치', '숨바꼭질']);
  });

  it('지난 판에 나온 낱말을 알려 주면 새 판에서는 뒤로 미룬다', () => {
    const recent = wordsOfLength(2)
      .slice(0, wordsOfLength(2).length - 3)
      .map((word) => word.text);
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const run = newRun(seeded(seed), recent);
      expect(recent).not.toContain(run.question.answer);
      expect(run.used.has(run.question.answer)).toBe(true);
    }
    // 두 글자 낱말이 모두 지난 판에 나왔어도 판은 시작된다.
    const all = wordsOfLength(2).map((word) => word.text);
    expect(newRun(seeded(1), all).question.answer).toHaveLength(2);
  });

  it('아직 나오지 않은 낱말이 없으면 고르지 못한다', () => {
    const all = new Set(wordsOfLength(4).map((word) => word.text));
    expect(pickWord(4, all, seeded(1))).toBeNull();
    all.delete('고슴도치');
    expect(pickWord(4, all, seeded(1))?.text).toBe('고슴도치');
  });
});

describe('난이도', () => {
  it('처음에는 두 글자만, 그다음 세 글자, 그다음 네 글자가 섞인다', () => {
    expect(RAMP[0].from).toBe(0);
    expect(lengthWeights(0)).toEqual([1, 0, 0]);
    const threeFrom = RAMP.find((step) => step.weights[1] > 0)?.from ?? 0;
    const fourFrom = RAMP.find((step) => step.weights[2] > 0)?.from ?? 0;
    expect(threeFrom).toBeGreaterThanOrEqual(3);
    expect(fourFrom).toBeGreaterThan(threeFrom);
    expect(lengthWeights(threeFrom - 1)[1]).toBe(0);
    expect(lengthWeights(threeFrom)[1]).toBeGreaterThan(0);
    expect(lengthWeights(fourFrom - 1)[2]).toBe(0);
    expect(lengthWeights(fourFrom)[2]).toBeGreaterThan(0);
    // 단계가 오를수록 긴 낱말의 몫이 커진다.
    for (let index = 1; index < RAMP.length; index += 1) {
      expect(RAMP[index].from).toBeGreaterThan(RAMP[index - 1].from);
      const share = (weights: readonly number[]): number =>
        (weights[1] * 3 + weights[2] * 4 + weights[0] * 2) / (weights[0] + weights[1] + weights[2]);
      expect(share(RAMP[index].weights)).toBeGreaterThan(share(RAMP[index - 1].weights));
    }
    expect(lengthWeights(10_000)).toEqual(RAMP[RAMP.length - 1].weights);
  });

  it('글자 수는 그 단계의 비율대로 나온다', () => {
    const random = seeded(12);
    for (const step of RAMP) {
      const counts = [0, 0, 0];
      const rolls = 6000;
      for (let count = 0; count < rolls; count += 1) {
        counts[LENGTHS.indexOf(pickLength(step.from, random))] += 1;
      }
      const total = step.weights[0] + step.weights[1] + step.weights[2];
      step.weights.forEach((weight, index) => {
        if (weight === 0) expect(counts[index]).toBe(0);
        else expect(Math.abs(counts[index] / rolls - weight / total)).toBeLessThan(0.03);
      });
    }
  });

  it('난수가 양 끝 값이어도 비율이 0인 글자 수는 나오지 않는다', () => {
    expect(pickLength(0, () => 0)).toBe(2);
    expect(pickLength(0, () => 0.999999)).toBe(2);
    const threeFrom = RAMP.find((step) => step.weights[1] > 0 && step.weights[2] === 0)?.from ?? 0;
    expect(pickLength(threeFrom, () => 0.999999)).toBe(3);
    expect(pickLength(10_000, () => 0.999999)).toBe(4);
  });

  it('한 판을 돌려 보면 맞힌 수에 따라 낱말이 길어진다', () => {
    const threeFrom = RAMP.find((step) => step.weights[1] > 0)?.from ?? 0;
    const fourFrom = RAMP.find((step) => step.weights[2] > 0)?.from ?? 0;
    const seen = new Set<number>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const random = seeded(seed);
      let run = newRun(random);
      for (let count = 0; count < 40; count += 1) {
        const length = run.question.answer.length;
        seen.add(length);
        if (run.solved < threeFrom) expect(length).toBe(2);
        if (run.solved < fourFrom) expect(length).toBeLessThanOrEqual(3);
        expect(run.question.tiles).toHaveLength(poolSpec(length).tiles);
        run = nextQuestion({ ...solve(run).run, timeLeft: START_SECONDS }, random);
      }
    }
    expect([...seen].sort()).toEqual([2, 3, 4]);
  });

  it('건너뛰기만 해서는 낱말이 길어지지 않는다', () => {
    const random = seeded(13);
    let run = newRun(random);
    for (let count = 0; count < 20; count += 1) {
      expect(run.question.answer).toHaveLength(2);
      run = nextQuestion({ ...skipQuestion(run), timeLeft: START_SECONDS }, random);
    }
    expect(run.solved).toBe(0);
    expect(run.skipped).toBe(20);
  });
});

describe('한 판', () => {
  it('새 판은 60초, 0점, 두 글자 문제로 시작한다', () => {
    const run = newRun(seeded(21));
    expect(run).toMatchObject({
      timeLeft: START_SECONDS,
      score: 0,
      solved: 0,
      streak: 0,
      bestStreak: 0,
      skipped: 0,
      misses: 0,
      settled: false,
    });
    expect(run.question.answer).toHaveLength(2);
    expect(run.slots).toEqual([null, null]);
    expect([...run.used]).toEqual([run.question.answer]);
  });

  it('가만히 있으면 60초에 0점으로 끝난다', () => {
    let run = newRun(seeded(22));
    let seconds = 0;
    while (!isOver(run)) {
      run = elapse(run, 0.5);
      seconds += 0.5;
    }
    expect(seconds).toBe(START_SECONDS);
    expect(run.score).toBe(0);
  });

  it('맞힐 때마다 걸린 시간보다 덜 돌려받으면 판은 반드시 끝난다', () => {
    const random = seeded(23);
    let run = newRun(random);
    let questions = 0;
    while (!isOver(run) && questions < 5000) {
      run = elapse(run, CORRECT_SECONDS + 0.5);
      if (isOver(run)) break;
      run = nextQuestion(solve(run).run, random);
      questions += 1;
    }
    expect(isOver(run)).toBe(true);
    expect(questions).toBeGreaterThan(20);
    expect(run.score).toBeGreaterThan(questions * BASE_POINTS[2]);
    expect(run.bestStreak).toBe(run.solved);
  });
});

describe('화면 배치', () => {
  /** 화면 위쪽의 HUD가 차지하는 높이. 그 아래가 이 게임의 자리다. */
  const HUD_HEIGHT = 56;
  const heights: number[] = [];
  for (let height = MIN_GAME_HEIGHT; height <= MAX_GAME_HEIGHT; height += 1) heights.push(height);
  const layoutFor = (height: number) =>
    quizLayout({ x: 0, y: HUD_HEIGHT, width: GAME_WIDTH, height: height - HUD_HEIGHT });

  it('어느 화면 높이에서도 위에서부터 카드, 조각, 단추가 겹치지 않고 화면 안에 놓인다', () => {
    for (const height of heights) {
      const layout = layoutFor(height);
      const label = `높이 ${height}`;
      expect(layout.card.y, label).toBeGreaterThanOrEqual(HUD_HEIGHT + 2);
      expect(layout.card.x, label).toBeGreaterThanOrEqual(0);
      expect(layout.card.x + layout.card.width, label).toBeLessThanOrEqual(GAME_WIDTH);
      // 카드 아래의 그림자까지 조각 자리와 겹치지 않는다.
      expect(layout.gridTop, label).toBeGreaterThanOrEqual(layout.card.y + layout.card.height + 5);
      expect(layout.skipTop, label).toBeGreaterThanOrEqual(layout.gridTop + layout.gridHeight + 5);
      expect(layout.skipTop + SKIP_BUTTON.height, label).toBeLessThanOrEqual(height - 5);
      // 카드 안에서는 분류, 초성, 답 칸, 알림 순서다.
      expect(layout.chipY, label).toBeGreaterThan(layout.card.y);
      expect(layout.patternY, label).toBeGreaterThan(layout.chipY + 20);
      expect(layout.slotTop, label).toBeGreaterThan(layout.patternY + 18);
      expect(layout.noteY, label).toBeGreaterThan(layout.slotTop + layout.slotSize + TILE_LIP);
      expect(layout.noteY + 7, label).toBeLessThanOrEqual(layout.card.y + layout.card.height);
    }
  });

  it('조각은 한 변이 40px 이상이고 격자로 화면 안에 놓인다', () => {
    for (const height of heights) {
      const layout = layoutFor(height);
      for (const length of LENGTHS) {
        const spec = poolSpec(length);
        const spots = tileSpots(layout, spec.tiles, spec.columns);
        const label = `높이 ${height}, ${length}글자`;
        expect(spots).toHaveLength(spec.tiles);
        for (const [index, spot] of spots.entries()) {
          expect(spot.size, label).toBeGreaterThanOrEqual(40);
          expect(spot.x, label).toBeGreaterThanOrEqual(8);
          expect(spot.x + spot.size, label).toBeLessThanOrEqual(GAME_WIDTH - 8);
          expect(spot.y, label).toBeGreaterThanOrEqual(layout.gridTop);
          expect(spot.y + spot.size, label).toBeLessThanOrEqual(layout.gridTop + layout.gridHeight);
          // 옆 조각, 아래 조각과 겹치지 않는다.
          const right = (index + 1) % spec.columns === 0 ? undefined : spots[index + 1];
          const below = spots[index + spec.columns];
          if (right) expect(right.x, label).toBeGreaterThanOrEqual(spot.x + spot.size + 4);
          if (below) expect(below.y, label).toBeGreaterThanOrEqual(spot.y + spot.size + 4);
        }
        // 가로로 가운데에 놓인다.
        const left = spots[0].x;
        const rightEdge = spots[spec.columns - 1].x + spots[0].size;
        expect(Math.abs(left - (GAME_WIDTH - rightEdge)), label).toBeLessThanOrEqual(1);
      }
    }
  });

  it('답 칸은 40px 이상이고 카드 안에 가운데로 놓인다', () => {
    for (const height of heights) {
      const layout = layoutFor(height);
      for (const length of LENGTHS) {
        const spots = slotSpots(layout, length);
        const label = `높이 ${height}, ${length}글자`;
        expect(spots).toHaveLength(length);
        for (const [index, spot] of spots.entries()) {
          expect(spot.size, label).toBeGreaterThanOrEqual(40);
          expect(spot.y, label).toBe(layout.slotTop);
          expect(spot.x, label).toBeGreaterThanOrEqual(layout.card.x + 4);
          expect(spot.x + spot.size, label).toBeLessThanOrEqual(layout.card.x + layout.card.width - 4);
          if (index > 0) expect(spot.x, label).toBeGreaterThanOrEqual(spots[index - 1].x + spot.size + 4);
        }
        const left = spots[0].x;
        const rightEdge = spots[length - 1].x + spots[0].size;
        expect(Math.abs(left - (GAME_WIDTH - rightEdge)), label).toBeLessThanOrEqual(1);
      }
    }
  });

  it('화면이 길수록 조각이 작아지지 않는다', () => {
    let previous = layoutFor(MIN_GAME_HEIGHT);
    for (const height of heights) {
      const layout = layoutFor(height);
      expect(layout.tileSize).toBeGreaterThanOrEqual(previous.tileSize);
      expect(layout.slotSize).toBeGreaterThanOrEqual(previous.slotSize);
      previous = layout;
    }
    expect(layoutFor(MAX_GAME_HEIGHT).tileSize).toBeGreaterThan(layoutFor(MIN_GAME_HEIGHT).tileSize);
  });
});
