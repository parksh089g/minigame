/**
 * 핀 뽑기의 단계 모드에 나오는 판 100개.
 * 핀이 여덟 개까지인 판을 모두 풀어 보고(뽑는 순서를 빠짐없이 따진다), 통로의 순서만 다른 판은 하나로 쳐서
 * 서로 다른 판만 골랐다. 그 자리에서 만들지 않고 적어 두는 까닭은, 핀이 여덟 개인 판은 풀어 보는 데
 * 시간이 걸려서 휴대폰에서 단계를 열 때마다 할 일이 못 되기 때문이다.
 * 표는 levels.test.ts의 pickLevels()가 만든다. 고르는 기준을 바꾸면 그 테스트가 새 표를 알려 준다.
 */
import { STAGE_LEVELS } from '../../core/stages';
import { MAX_SHAFTS, MAX_STACK, type Item, type Puzzle } from './rules';

/** 단계 모드에서 핀의 최대 수(문 핀 포함). 점수 도전(MAX_PINS)보다 큰 판까지 나온다. */
export const LEVEL_MAX_PINS = 8;

const ITEM_OF: Readonly<Record<string, Item>> = { t: 'treasure', l: 'lava', w: 'water' };
const LETTER_OF: Readonly<Record<Item, string>> = { treasure: 't', lava: 'l', water: 'w' };

/**
 * 판을 짧게 적은 것을 읽는다. 통로는 '/'로 나누고, 통로 안은 위에서 아래 순서로
 * t(보물) l(용암) w(물)를 적고, 괴물이 있으면 끝에 '!'를 붙인다. 예: "tl/w/l!"
 * 읽을 수 없으면 null.
 */
export function parsePuzzle(code: string): Puzzle | null {
  const monster = code.endsWith('!');
  const body = monster ? code.slice(0, -1) : code;
  const shafts = body.split('/').map((shaft) => [...shaft].map((letter) => ITEM_OF[letter]));
  if (shafts.length < 2 || shafts.length > MAX_SHAFTS) return null;
  if (shafts.some((shaft) => shaft.length < 1 || shaft.length > MAX_STACK || shaft.includes(undefined as never))) {
    return null;
  }
  const treasures = shafts.flat().filter((item) => item === 'treasure').length;
  return treasures === 1 ? { shafts, monster } : null;
}

/** parsePuzzle이 읽는 모양으로 적는다. */
export function puzzleCode(puzzle: Puzzle): string {
  const body = puzzle.shafts.map((shaft) => shaft.map((item) => LETTER_OF[item]).join('')).join('/');
  return puzzle.monster ? `${body}!` : body;
}

/**
 * 통로의 순서만 다른 판은 같은 판으로 치는 이름. 떨어진 것은 모두 한 구덩이에 모이므로,
 * 통로가 어느 자리에 있든 푸는 방법은 같다.
 */
export function puzzleKind(puzzle: Puzzle): string {
  const body = puzzle.shafts
    .map((shaft) => shaft.map((item) => LETTER_OF[item]).join(''))
    .sort()
    .join('/');
  return puzzle.monster ? `${body}!` : body;
}

/** 단계 순서대로 적은 판. 핀이 적은 판부터 나오고, 핀 수가 같으면 아무렇게나 뽑아 이기기 쉬운 판이 먼저다. */
export const LEVEL_CODES: readonly string[] = [
  // 1~10단계
  't/l', 'll/t', 'l/l/t', 'lt/l', 'tl/w', 'tw/l!', 'l/t/w!', 'l/wt!', 'wl/t!', 'w/tl!',
  // 11~20단계
  'w/t/l/l', 'll/tw', 'wl/lt', 'l/t/ll', 'ww/tl', 'lt/l/l', 'wt/w/l!', 'l/w/w/t!', 'w/w/tl!', 'tl/ww!',
  // 21~30단계
  'tl/lw', 'l/wt/l!', 'lt/l/w!', 't/wl/l!', 'll/wt!', 'tl/lw!', 'l/w/w/lt', 't/wl/ll', 'lt/w/ll', 'tl/w/lw',
  // 31~40단계
  'l/wl/t/l', 'll/lt/l', 'ww/tl/l', 'tw/l/lw!', 'l/l/lt/l', 'w/wt/wl!', 'wl/wl/t!', 'ww/t/wl!', 'wl/l/wt!', 'w/lw/tl!',
  // 41~50단계
  'w/wl/tl!', 'tl/ll/w', 'w/l/lt/w!', 'lt/l/ww!', 'l/wt/l/l!', 't/l/l/lw!', 'lw/lt/l!', 't/lw/ll!', 'lt/ww/wl', 'lw/l/wt/l',
  // 51~60단계
  'll/ww/lt', 'lt/wl/l/w', 'wl/t/wl/l', 'lt/l/w/ll', 'l/lw/l/lt', 'll/ll/t/l', 'l/lw/tw/w!', 'tw/ll/w/w!', 'tw/wl/w/w!', 'tl/w/w/ll',
  // 61~70단계
  'wt/w/ll/w!', 'w/tl/lw/l', 'lw/l/t/ww!', 'l/w/ll/tw!', 'lw/l/wt/l!', 'wl/wt/ll!', 'w/ww/l/lt!', 'll/l/tw/l!', 'w/wl/l/lt!', 'll/tl/w/l',
  // 71~80단계
  'w/wl/tl/l!', 'l/l/lw/tl', 'wl/lt/ll!', 'lw/ll/lt!', 't/wl/wl/wl', 'wl/t/lw/ll', 'lw/w/ll/lt', 'tl/lw/lw/w', 'll/l/ww/lt', 'wl/l/ll/tw',
  // 81~90단계
  'lw/ww/tl/l', 'l/lw/wl/tw!', 'wl/l/ww/wt!', 'w/tw/ll/wl!', 'lt/ll/l/ll', 'tl/ww/ww/l!', 'wl/wt/w/ww!', 'wl/ww/lw/t!', 'l/wt/wl/wl!', 'tl/lw/lw/w!',
  // 91~100단계
  'lw/t/ww/ll!', 'l/wl/ll/tw!', 'lt/wl/l/ww!', 't/ll/ww/ll!', 'w/ll/lt/ww!', 'll/ww/l/tl!', 'lw/l/tl/lw!', 'l/lw/tl/ll', 'll/ll/lt/w!', 'l/tl/ll/lw!',
];

/** 단계 모드의 level(1부터)번째 단계의 판 */
export function levelPuzzle(level: number): Puzzle {
  const index = Math.min(LEVEL_CODES.length, Math.max(1, Math.floor(level))) - 1;
  const puzzle = parsePuzzle(LEVEL_CODES[index] ?? '');
  // 표가 잘못 적혔을 때만 쓰이는 판. 테스트가 표의 모든 줄을 읽어 보므로 실제로 쓰일 일은 없다.
  return puzzle ?? { shafts: [['treasure'], ['lava']], monster: false };
}

/** 그 판의 핀 수(문 핀 포함) */
export function pinCount(puzzle: Puzzle): number {
  return puzzle.shafts.reduce((sum, shaft) => sum + shaft.length, 0) + 1;
}

/** 처음의 도움말을 보여 주는 단계: 핀이 가장 적은 판들 */
export const HINT_MAX_PINS = 4;

export function levelShowsHints(level: number): boolean {
  return pinCount(levelPuzzle(level)) <= HINT_MAX_PINS;
}

/** 괴물을 물리치는 법을 알려 주는 단계의 수: 괴물이 나오는 처음 몇 단계 */
export const MONSTER_NOTE_LEVELS = 3;

/** 그 단계에서 괴물을 물리치는 법을 알려 주는지 */
export function levelShowsMonsterNote(level: number): boolean {
  const at = Math.min(LEVEL_CODES.length, Math.max(1, Math.floor(level)));
  if (!levelPuzzle(at).monster) return false;
  let seen = 0;
  for (let earlier = 1; earlier <= at; earlier += 1) {
    if (levelPuzzle(earlier).monster) seen += 1;
  }
  return seen <= MONSTER_NOTE_LEVELS;
}

/** 표에 적힌 단계의 수. 단계 모드의 단계 수와 같아야 한다. */
export const LEVEL_COUNT = STAGE_LEVELS;
