/**
 * 핀 뽑기의 단계 모드에 나오는 판 100개.
 * 핀이 아홉 개까지인 판을 모두 풀어 보고(뽑는 순서를 빠짐없이 따진다), 통로의 순서만 다른 판은 하나로 쳐서
 * 서로 다른 판만 골랐다. 그 자리에서 만들지 않고 적어 두는 까닭은, 고르려면 판을 수천 개 풀어 봐야 해서
 * 휴대폰에서 단계를 열 때마다 할 일이 못 되기 때문이다.
 * 표는 levels.test.ts의 pickLevels()가 만든다. 고르는 기준을 바꾸면 그 테스트가 새 표를 알려 준다.
 */
import { STAGE_LEVELS } from '../../core/stages';
import { MAX_SHAFTS, MAX_STACK, type Item, type Puzzle } from './rules';

/** 단계 모드에서 핀의 최대 수(문 핀 포함). 점수 도전(MAX_PINS)보다 큰 판까지 나온다. */
export const LEVEL_MAX_PINS = 9;

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

/**
 * 단계 순서대로 적은 판. 꼭 뽑아야 하는 핀의 수가 뒤로 갈수록 늘어난다: 처음 8단계는 두세 번, 50단계까지는 네 번,
 * 51단계부터는 3층으로 쌓인 통로가 나와서 다섯 번에서 여덟 번이다. 뽑는 수가 같은 판끼리는 아무렇게나 뽑아도
 * 이기기 쉬운 판이 먼저다.
 */
export const LEVEL_CODES: readonly string[] = [
  // 1~10단계
  't/l', 'll/t', 'w/t/l/l', 't/l/wl', 'l/l/t', 'lt/l', 'l/l/t/l', 'tw/l/l', 'tl/w', 'tw/l!',
  // 11~20단계
  'w/l/tw!', 'wt/w/w/l!', 'wt/w/l!', 'w/wt/wl!', 'wl/wt!', 'l/ww/l/t!', 'l/w/l/wt!', 'wl/w/w/t!', 'wl/w/t!', 'w/tl/w/w!',
  // 21~30단계
  'lw/wt/l!', 'lw/wl/t!', 'l/t/w!', 'l/t/ww!', 'l/tl/w/w!', 'l/wt!', 'wl/t!', 'w/tl!', 'tl/ww!', 'w/wl/tl!',
  // 31~40단계
  'ww/t/ll!', 'tl/w/l', 'tl/ll/w', 'tw/l/l/l!', 'l/l/t/w!', 'tw/ll!', 'lt/wl/w!', 'll/wt/l!', 'tl/l/w/l', 'lt/l/w!',
  // 41~50단계
  't/wl/l!', 'll/w/t!', 'wl/ll/t!', 'll/wt!', 'tl/lw!', 'l/lt/l/w!', 'wl/l/t/l!', 'lw/lt/l!', 'l/lw/tl!', 't/lw/ll!',
  // 51~60단계
  'tww/l/l!', 'wll/tww!', 'l/w/tww!', 'l/tww/ww!', 'tww/wl!', 'tww/wwl!', 'll/w/tww!', 'tww/l/lw!', 'tww/ll!', 'w/w/l/tww!',
  // 61~70단계
  'w/tww/wl!', 'l/tww/l/l!', 'll/l/tww!', 'lll/tww!', 'tll/w/w/w', 'tll/wlw/w', 'wwl/tl/wl', 'l/tlw/w/w!', 'tll/ww/ww!', 'tlw/w/lwl!',
  // 71~80단계
  'tll/w/w/w!', 'ww/tll/llw', 'tl/wwl/wl!', 'www/tll!', 'wl/w/tll/w!', 'llw/w/wt!', 'llw/w/wwt!', 'tlw/llw/wl!', 'tll/l/ww', 'lwt/w/llw!',
  // 81~90단계
  'tl/l/wwl', 'ww/wl/l/tll', 't/lw/llw/w!', 'l/tlw/lw!', 'w/tlw/ll!', 'w/lll/tlw!', 'wl/tlw/lll!', 'llw/ltw!', 'w/lw/tll!', 'tll/lw/lw',
  // 91~100단계
  'wwl/l/ltl', 'll/ltl/wwl', 'lw/t/llw!', 'lwl/l/tlw!', 'llw/lw/lt!', 'l/lw/tll/lw!', 'lw/llw/tww!', 'ww/tlw/llw!', 'lw/tll/wwl', 'lw/tlw/llw!',
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

/** 처음의 도움말을 보여 주는 단계의 수: 두세 번만 뽑으면 끝나는, 뽑는 법을 익히는 단계들 */
export const HINT_LEVELS = 8;

export function levelShowsHints(level: number): boolean {
  return level <= HINT_LEVELS;
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
