/**
 * 핀 뽑기의 단계 모드에 나오는 판 100개.
 * 핀이 아홉 개까지인 판을 수천 개 풀어 보고(뽑는 순서를 빠짐없이 따진다), 통로의 순서만 다르거나 장치만 다르게 단
 * 판은 하나로 쳐서 서로 다른 판만 골랐다. 그 자리에서 만들지 않고 적어 두는 까닭은, 고르려면 판을 수천 개 풀어 봐야 해서
 * 휴대폰에서 단계를 열 때마다 할 일이 못 되기 때문이다.
 * 뒤쪽 단계에는 점수 도전에 없는 장치가 나온다: 사슬로 묶여 함께 뽑히는 핀, 열쇠가 구덩이에 닿아야 풀리는 자물쇠.
 * 표는 levels.test.ts의 pickLevels()가 만든다. 고르는 기준을 바꾸면 그 테스트가 새 표를 알려 준다.
 */
import { STAGE_LEVELS } from '../../core/stages';
import { MAX_SHAFTS, MAX_STACK, type Item, type Pin, type Puzzle } from './rules';

/** 단계 모드에서 핀의 최대 수(문 핀 포함). 점수 도전(MAX_PINS)보다 큰 판까지 나온다. */
export const LEVEL_MAX_PINS = 9;

const ITEM_OF: Readonly<Record<string, Item>> = { t: 'treasure', l: 'lava', w: 'water', k: 'key' };
const LETTER_OF: Readonly<Record<Item, string>> = { treasure: 't', lava: 'l', water: 'w', key: 'k' };

/**
 * 판을 짧게 적은 것을 읽는다. 통로는 '/'로 나누고, 통로 안은 위에서 아래 순서로
 * t(보물) l(용암) w(물) k(열쇠)를 적고, 괴물이 있으면 끝에 '!'를 붙인다. 예: "tl/w/l!"
 * 방을 받치는 핀에 자물쇠가 달렸으면 그 방을 대문자로, 사슬로 묶인 핀이면 그 방 뒤에 '*'를 적는다.
 * 문 핀에 자물쇠가 달렸으면 끝에(괴물 표시 앞에) '#'를 붙인다. 예: "tL/k*w/l*#!"
 * 읽을 수 없거나 판이 될 수 없으면 null: 보물은 하나, 열쇠는 자물쇠가 있을 때만 하나, 사슬은 없거나 한 쌍이어야 하고,
 * 자물쇠가 달린 핀은 사슬로 묶이지 않고, 열쇠가 든 방과 그 아래의 핀에는 자물쇠가 달리지 않는다(열쇠가 내려올 길이 없어진다).
 */
export function parsePuzzle(code: string): Puzzle | null {
  const match = /^([^#!]*)(#?)(!?)$/.exec(code);
  if (!match) return null;
  const words = match[1].split('/');
  if (words.length < 2 || words.length > MAX_SHAFTS) return null;

  const shafts: Item[][] = [];
  const locks: Pin[] = [];
  const chained: Pin[] = [];
  for (const [shaft, word] of words.entries()) {
    if (!/^([a-zA-Z]\*?)+$/.test(word)) return null;
    const chambers: Item[] = [];
    for (const [, letter, star] of word.matchAll(/([a-zA-Z])(\*?)/g)) {
      const item = ITEM_OF[letter.toLowerCase()];
      if (!item) return null;
      const pin: Pin = { kind: 'chamber', shaft, level: chambers.length };
      const locked = letter !== letter.toLowerCase();
      if (locked && star) return null;
      if (locked) locks.push(pin);
      if (star) chained.push(pin);
      chambers.push(item);
    }
    if (chambers.length > MAX_STACK) return null;
    shafts.push(chambers);
  }
  if (match[2]) locks.push({ kind: 'door' });

  const count = (item: Item): number => shafts.flat().filter((each) => each === item).length;
  if (count('treasure') !== 1 || count('key') !== (locks.length > 0 ? 1 : 0)) return null;
  if (chained.length !== 0 && chained.length !== 2) return null;
  const blocked = locks.some(
    (pin) => pin.kind === 'chamber' && shafts[pin.shaft].slice(0, pin.level + 1).includes('key'),
  );
  if (blocked) return null;

  return {
    shafts,
    monster: match[3] === '!',
    ...(locks.length > 0 ? { locks } : {}),
    ...(chained.length === 2 ? { links: [[chained[0], chained[1]]] } : {}),
  };
}

/** 통로마다 적은 것. 자물쇠와 사슬의 표시까지 붙인다. */
function shaftWords(puzzle: Puzzle): string[] {
  const has = (pins: readonly Pin[], shaft: number, level: number): boolean =>
    pins.some((pin) => pin.kind === 'chamber' && pin.shaft === shaft && pin.level === level);
  const locks = puzzle.locks ?? [];
  const chained = (puzzle.links ?? []).flat();
  return puzzle.shafts.map((chambers, shaft) =>
    chambers
      .map((item, level) => {
        const letter = LETTER_OF[item];
        return `${has(locks, shaft, level) ? letter.toUpperCase() : letter}${has(chained, shaft, level) ? '*' : ''}`;
      })
      .join(''),
  );
}

/** 문 핀의 자물쇠와 괴물을 적은 끝 표시 */
function endMarks(puzzle: Puzzle): string {
  const doorLocked = (puzzle.locks ?? []).some((pin) => pin.kind === 'door');
  return `${doorLocked ? '#' : ''}${puzzle.monster ? '!' : ''}`;
}

/** parsePuzzle이 읽는 모양으로 적는다. */
export function puzzleCode(puzzle: Puzzle): string {
  return `${shaftWords(puzzle).join('/')}${endMarks(puzzle)}`;
}

/**
 * 통로의 순서만 다른 판은 같은 판으로 치는 이름. 떨어진 것은 모두 한 구덩이에 모이므로,
 * 통로가 어느 자리에 있든 푸는 방법은 같다.
 */
export function puzzleKind(puzzle: Puzzle): string {
  return `${shaftWords(puzzle).sort().join('/')}${endMarks(puzzle)}`;
}

/**
 * 단계 순서대로 적은 판. 구간마다 새로 궁리할 것이 나온다: 처음 8단계는 두세 번에 끝나는 익히는 판, 9단계부터는 네 번을
 * 뽑아야 하는 판, 21단계부터는 3층으로 쌓인 통로, 33단계부터는 사슬로 묶인 핀, 49단계부터는 열쇠와 자물쇠,
 * 73단계부터는 그 모두가 섞인 판이고 많게는 아홉 번을 뽑아야 한다. 구간 안에서는 쉬운 판이 먼저다.
 */
export const LEVEL_CODES: readonly string[] = [
  // 1~10단계
  't/l', 'll/t', 'lt/l', 'l/l/t', 'l/lt/w', 'l/wt/l', 'lt/l/l', 'l/l/t/l', 'tl/w', 'tl/ww/l!',
  // 11~20단계
  'w/tl!', 'tl/ww!', 'wt/ll/w!', 'wl/t!', 'tl/w/l', 'w/tl/w/w!', 'l/l/t/w!', 'w/t/l/ll!', 'll/w/t!', 't/lw/ll!',
  // 21~30단계
  'tww/l/l!', 'wll/tww!', 'tll/wlw/w', 'tww/wl!', 'w/tww/wl!', 'w/tll/www!', 'wwt/llw!', 'wlw/llw/t!', 'tll/ww/l!', 'ww/l/l/tll',
  // 31~40단계
  'lw/t/llw!', 'llw/lw/lt!', 'w/w*/t*l', 'w*/l/lt*!', 'l*/l*w/tw!', 'w*t*/ll!', 'lt/w*/w*/l!', 'w/l/l*/tw*l', 'l/w/tw*l*/ww!', 'w/w/t*l*l/w!',
  // 41~50단계
  'tw*w/l/ll*l!', 'w*l/l*l/t!', 'wtl*/lwl*', 'tl*w/lw/l*/l', 'w/l/l*/wt*l!', 'ww*t/ll*l!', 't*l*/l/w/llw!', 'l*lw/w*w/lt!', 'T/lk/W', 'Wl/w/twk#!',
  // 51~60단계
  'wl/Tk#!', 'wk/w/l/T#!', 'W/wtL/l/k!', 'kw/l/t/L#!', 'tw/lw/kwl#!', 'tww/llk#!', 'L/lk/tw#!', 'L/l/w/tLk', 'l/kwl/W/twl#', 'w/lk/t#!',
  // 61~70단계
  't/WL/wk!', 'tl/w/w/klw#!', 'k/ww/TlL!', 'ww/L/k/tlw!', 'w/tL/k/L!', 'lkl/l/t/w#!', 'tLL/kw/llw', 'Llw/twk/W!', 'kl/tlw/wW/l#', 'llW/Ww/tk!',
  // 71~80단계
  'll/tlw/Wk#!', 'Tll/l/lWw/k', 'lw/llw/tww!', 'l*/wtW/lwk*!', 'wl/kww/Tlw!', 'wll*/k*/T/wLw!', 'Tlw*/l/wk*l!', 'l*kw*/lwt/W/L!', 'wk*w*/wt/LL!', 'tl/k*l/wwL/w*#!',
  // 81~90단계
  'wWk*/tw/lwl*#!', 'wLl*/w/lT/k*!', 'wl/klw/tLw#!', 'l*k/LWl*/wt!', 'lw/tll/wwl', 'L/lkw*/ww*t/w!', 'LL/t*w*/klw!', 'llw/tLW/kw!', 'WTl/kll/ww', 'lw*/T/kl*w/ll!',
  // 91~100단계
  'LLw/w/l*k/wt*!', 'lLw/wk/tww#!', 'lw/llk*/Tw*#!', 'Wl*t*/k/lwl/l#!', 'kll/w/W/Tlw!', 'lwl*/L/k/lWt*!', 'lw/tlw/llw!', 'l/wL/t/wl*k*!', 'lkw/lLw/t/w!', 'Wl/tk*/l/Lwl*!',
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

/** 처음 나왔을 때 알려 주는 장치: 사슬로 묶인 핀, 자물쇠가 달린 핀 */
export type Device = 'chain' | 'lock';

/** 그 판에 나오는 장치 */
export function devicesOf(puzzle: Puzzle): Device[] {
  const devices: Device[] = [];
  if ((puzzle.links ?? []).length > 0) devices.push('chain');
  if ((puzzle.locks ?? []).length > 0) devices.push('lock');
  return devices;
}

/** 새 장치를 알려 주는 단계의 수: 그 장치가 나오는 처음 몇 단계 */
export const DEVICE_NOTE_LEVELS = 3;

/**
 * 그 단계에서 쓰는 법을 알려 줄 장치. 그 장치가 나오는 처음 몇 단계에서만 알려 주고, 아니면 null이다.
 * 한 판에 두 장치가 함께 처음 나오는 일은 없게 표를 짰지만, 그렇더라도 사슬을 먼저 알려 준다.
 */
export function levelDeviceNote(level: number): Device | null {
  const at = Math.min(LEVEL_CODES.length, Math.max(1, Math.floor(level)));
  for (const device of devicesOf(levelPuzzle(at))) {
    let seen = 0;
    for (let earlier = 1; earlier <= at; earlier += 1) {
      if (devicesOf(levelPuzzle(earlier)).includes(device)) seen += 1;
    }
    if (seen <= DEVICE_NOTE_LEVELS) return device;
  }
  return null;
}

/** 표에 적힌 단계의 수. 단계 모드의 단계 수와 같아야 한다. */
export const LEVEL_COUNT = STAGE_LEVELS;
