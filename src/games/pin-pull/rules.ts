/**
 * 핀 뽑기의 규칙. 화면과 분리된 순수 함수라서 숫자만 바꿔 밸런스를 조정할 수 있다.
 * 물리 계산은 없다. 핀을 뽑으면 그 방에 든 것이 곧장 아래 칸으로 떨어지고, 닿은 칸에서 한 번 섞인다.
 */

// ───────── 판의 모양 ─────────

/** 방에 처음 들어 있는 것. 열쇠는 단계 모드의 뒤쪽 판에만 나온다. */
export type Item = 'treasure' | 'lava' | 'water' | 'key';

export const MIN_SHAFTS = 2;
export const MAX_SHAFTS = 4;
/** 통로 하나에 위아래로 놓이는 방의 최대 수. 3층은 뒤쪽 단계에만 나온다. */
export const MAX_STACK = 3;
/** 점수 도전에서 핀의 최대 수(문 핀 포함) */
export const MAX_PINS = 8;

export interface Puzzle {
  /** 통로마다, 위에서 아래 순서로 방에 든 것. 방마다 그 아래를 핀이 받치고 있다. */
  shafts: readonly (readonly Item[])[];
  /** 구덩이에 괴물이 있는지 */
  monster: boolean;
  /**
   * 자물쇠가 달린 핀. 열쇠가 구덩이에 닿아야 풀리고, 그 전에는 뽑히지 않는다.
   * 자물쇠가 있는 판에는 열쇠가 꼭 하나 있다. 없는 판에서는 적지 않는다.
   */
  locks?: readonly Pin[];
  /** 사슬로 묶인 핀의 짝. 하나를 뽑으면 다른 하나도 함께 뽑힌다. 없는 판에서는 적지 않는다. */
  links?: readonly PinPair[];
}

/** 방을 받치는 핀(level은 위에서부터 0)이거나, 용사의 방을 막은 문 핀 */
export type Pin = { kind: 'chamber'; shaft: number; level: number } | { kind: 'door' };
/** 사슬로 묶인 두 핀 */
export type PinPair = readonly [Pin, Pin];

/** 떨어진 것이 닿는 곳 */
export type Place = { kind: 'chamber'; shaft: number; level: number } | { kind: 'pit' };

/** 한 칸(방이나 구덩이)에 들어 있는 것의 개수 */
export interface Contents {
  treasure: number;
  lava: number;
  water: number;
  /** 용암과 물이 만나 굳은 돌. 아무 일도 일으키지 않는다. */
  stone: number;
  /** 열쇠. 구덩이에 닿으면 자물쇠를 풀고 사라지므로, 구덩이에서는 언제나 0이다. */
  key: number;
}

export interface Chamber {
  contents: Contents;
  /** 아래를 받치는 핀이 아직 꽂혀 있는지 */
  pinned: boolean;
}

export type Status = 'playing' | 'won' | 'lost';
/** 진 까닭: 보물이 탐, 열쇠가 녹음, 용사가 용암에 닿음, 용사가 괴물을 만남 */
export type LossCause = 'burnt' | 'melted' | 'lava' | 'monster';

export interface PuzzleState {
  shafts: readonly (readonly Chamber[])[];
  pit: Contents;
  /** 구덩이에 괴물이 살아 있는지 */
  monster: boolean;
  /** 용사가 있는 곳. 문 핀을 뽑으면 구덩이로 간다. */
  hero: 'room' | 'pit';
  /** 아직 자물쇠가 잠겨 있는 핀. 열쇠가 구덩이에 닿으면 한꺼번에 풀려서 비워진다. */
  locks: readonly Pin[];
  /** 사슬로 묶인 핀의 짝. 판이 끝날 때까지 바뀌지 않는다. */
  links: readonly PinPair[];
  status: Status;
  lossCause: LossCause | null;
}

const NOTHING: Contents = { treasure: 0, lava: 0, water: 0, stone: 0, key: 0 };

/** 모든 핀. 통로 순서, 그 안에서는 위에서 아래 순서이고 문 핀이 맨 끝이다. */
export function pinsOf(puzzle: Puzzle): Pin[] {
  const pins: Pin[] = [];
  puzzle.shafts.forEach((chambers, shaft) => {
    chambers.forEach((_, level) => pins.push({ kind: 'chamber', shaft, level }));
  });
  pins.push({ kind: 'door' });
  return pins;
}

export function samePin(a: Pin, b: Pin): boolean {
  if (a.kind === 'door' || b.kind === 'door') return a.kind === b.kind;
  return a.shaft === b.shaft && a.level === b.level;
}

/** 핀을 수 하나로 적는다. 문 핀은 -1이다. 핀의 모임을 견줄 때 쓴다. */
function pinNumber(pin: Pin): number {
  return pin.kind === 'door' ? -1 : pin.shaft * MAX_STACK + pin.level;
}

/** 자물쇠와 사슬을 순서에 상관없이 견줄 수 있게 적는다. */
function devicesKey(puzzle: Puzzle): string {
  const locks = (puzzle.locks ?? []).map(pinNumber).sort((a, b) => a - b);
  const links = (puzzle.links ?? [])
    .map((pair) => pair.map(pinNumber).sort((a, b) => a - b).join('+'))
    .sort();
  return `${locks.join()}|${links.join()}`;
}

export function samePuzzle(a: Puzzle, b: Puzzle): boolean {
  return (
    a.monster === b.monster &&
    a.shafts.length === b.shafts.length &&
    a.shafts.every((chambers, shaft) => chambers.join() === b.shafts[shaft].join()) &&
    devicesKey(a) === devicesKey(b)
  );
}

/** 아무 핀도 뽑지 않은 처음 상태 */
export function startPuzzle(puzzle: Puzzle): PuzzleState {
  return {
    shafts: puzzle.shafts.map((chambers) =>
      chambers.map((item) => ({ contents: { ...NOTHING, [item]: 1 }, pinned: true })),
    ),
    pit: NOTHING,
    monster: puzzle.monster,
    hero: 'room',
    locks: puzzle.locks ?? [],
    links: puzzle.links ?? [],
    status: 'playing',
    lossCause: null,
  };
}

/** 그 핀이 아직 꽂혀 있는지 */
export function isPinned(state: PuzzleState, pin: Pin): boolean {
  if (pin.kind === 'door') return state.hero === 'room';
  return state.shafts[pin.shaft]?.[pin.level]?.pinned ?? false;
}

/** 아직 꽂혀 있는 핀 */
export function remainingPins(state: PuzzleState): Pin[] {
  const pins: Pin[] = [];
  state.shafts.forEach((chambers, shaft) => {
    chambers.forEach((chamber, level) => {
      if (chamber.pinned) pins.push({ kind: 'chamber', shaft, level });
    });
  });
  if (state.hero === 'room') pins.push({ kind: 'door' });
  return pins;
}

/** 그 핀에 자물쇠가 아직 잠겨 있는지 */
export function isLocked(state: PuzzleState, pin: Pin): boolean {
  return state.locks.some((locked) => samePin(locked, pin));
}

/** 그 핀과 사슬로 묶인 핀. 묶인 핀이 아니면 null */
export function partnerOf(links: readonly PinPair[], pin: Pin): Pin | null {
  for (const [one, other] of links) {
    if (samePin(one, pin)) return other;
    if (samePin(other, pin)) return one;
  }
  return null;
}

/** 그 핀을 누르면 함께 뽑히는 핀: 그 핀과, 사슬로 묶인 짝이 있으면 그것까지 */
export function pulledWith(state: PuzzleState, pin: Pin): Pin[] {
  if (state.links.length === 0) return [pin];
  const partner = partnerOf(state.links, pin);
  return partner && isPinned(state, partner) ? [pin, partner] : [pin];
}

/** 그 핀을 지금 뽑을 수 있는지: 꽂혀 있고, 그 핀에도 사슬로 묶인 짝에도 자물쇠가 잠겨 있지 않다. */
export function canPull(state: PuzzleState, pin: Pin): boolean {
  if (!isPinned(state, pin)) return false;
  return state.locks.length === 0 || pulledWith(state, pin).every((each) => !isLocked(state, each));
}

/**
 * 지금 둘 수 있는 수: 눌러서 뽑을 수 있는 핀. 사슬로 묶인 핀은 둘 중 무엇을 눌러도 같으므로 앞선 것만 낸다.
 * 자물쇠도 사슬도 없는 판에서는 remainingPins와 같다.
 */
export function movesOf(state: PuzzleState): Pin[] {
  const pins = remainingPins(state);
  // 판을 낼 때마다 수천 번 불리므로, 장치가 없는 판은 따질 것 없이 바로 돌려준다.
  if (state.locks.length === 0 && state.links.length === 0) return pins;
  return pins.filter((pin, index) => {
    if (!canPull(state, pin)) return false;
    const partner = partnerOf(state.links, pin);
    return !partner || !pins.slice(0, index).some((earlier) => samePin(earlier, partner));
  });
}

// ───────── 핀 뽑기 ─────────

/** 방 하나에서 떨어진 것 */
export interface Fall {
  shaft: number;
  level: number;
  contents: Contents;
  to: Place;
}

/** 떨어진 것이 닿은 칸에서 일어난 일. 사슬로 묶인 핀을 뽑으면 두 칸에 닿을 수 있다. */
export interface Landing {
  to: Place;
  /** 이 칸에서 물과 만나 돌이 된 용암의 수 */
  cooled: number;
  /** 이 칸에서 보물이 탔는지 */
  burnt: boolean;
  /** 이 칸에서 열쇠가 녹았는지 */
  melted: boolean;
}

export interface PullResult {
  state: PuzzleState;
  /** 핀이 뽑혔는지. 이미 뽑힌 핀, 자물쇠가 잠긴 핀이거나 판이 끝난 뒤라면 false이고 상태는 그대로다. */
  pulled: boolean;
  /** 함께 뽑힌 핀. 사슬로 묶인 핀이면 둘이다. */
  pins: readonly Pin[];
  /** 방에서 떨어진 것과 닿은 곳. 문 핀을 뽑았으면 비어 있다. */
  falls: readonly Fall[];
  /** 닿은 칸마다 일어난 일. 같은 칸에 둘이 떨어졌으면 한 번만 적는다. */
  landings: readonly Landing[];
  /** 닿은 칸들에서 물과 만나 돌이 된 용암의 수 */
  cooled: number;
  /** 구덩이의 괴물이 용암에 사라졌는지 */
  slain: boolean;
  /** 열쇠가 구덩이에 닿아 자물쇠가 풀렸는지 */
  unlocked: boolean;
}

function add(a: Contents, b: Contents): Contents {
  return {
    treasure: a.treasure + b.treasure,
    lava: a.lava + b.lava,
    water: a.water + b.water,
    stone: a.stone + b.stone,
    key: a.key + b.key,
  };
}

/**
 * 한 칸에 모인 것을 섞는다. 용암과 물은 하나씩 짝지어 돌이 되고, 그러고도 용암이 남으면 보물이 타고 열쇠가 녹는다.
 * 물이 먼저 용암을 식히므로, 물이 넉넉한 칸에서는 용암이 아무것도 해치지 못한다.
 */
function mix(contents: Contents): { contents: Contents; cooled: number; burnt: boolean; melted: boolean } {
  const cooled = Math.min(contents.lava, contents.water);
  const lava = contents.lava - cooled;
  const burnt = lava > 0 && contents.treasure > 0;
  const melted = lava > 0 && contents.key > 0;
  return {
    contents: {
      treasure: burnt ? 0 : contents.treasure,
      lava,
      water: contents.water - cooled,
      stone: contents.stone + cooled,
      key: melted ? 0 : contents.key,
    },
    cooled,
    burnt,
    melted,
  };
}

/** 보물이 탔거나 열쇠가 녹았으면 그 까닭. 둘 다면 보물이 탄 것으로 친다. */
function ruinOf(mixed: { burnt: boolean; melted: boolean }): LossCause | null {
  if (mixed.burnt) return 'burnt';
  return mixed.melted ? 'melted' : null;
}

/**
 * 구덩이에 새로 무언가(떨어진 것이나 용사)가 들어온 뒤의 상태를 정한다.
 * 섞고 남은 용암은 괴물을 없애고 그대로 남는다. 무사히 닿은 열쇠는 자물쇠를 모두 풀고 사라진다.
 * 용사는 용암이나 괴물과 함께 있으면 지고, 위험한 것 없이 보물과 함께 있으면 이긴다. 그 밖에는 구덩이에서 기다린다.
 */
function settlePit(
  state: PuzzleState,
  arrived: Contents,
  hero: 'room' | 'pit',
): { state: PuzzleState; landing: Landing; slain: boolean; unlocked: boolean } {
  const mixed = mix(add(state.pit, arrived));
  const unlocked = mixed.contents.key > 0;
  const pit = unlocked ? { ...mixed.contents, key: 0 } : mixed.contents;
  const slain = state.monster && pit.lava > 0;
  const monster = state.monster && !slain;

  let status: Status = 'playing';
  let lossCause = ruinOf(mixed);
  if (lossCause) status = 'lost';
  else if (hero === 'pit' && pit.lava > 0) [status, lossCause] = ['lost', 'lava'];
  else if (hero === 'pit' && monster) [status, lossCause] = ['lost', 'monster'];
  else if (hero === 'pit' && pit.treasure > 0) status = 'won';

  return {
    state: { ...state, pit, monster, hero, locks: unlocked ? [] : state.locks, status, lossCause },
    landing: { to: { kind: 'pit' }, cooled: mixed.cooled, burnt: mixed.burnt, melted: mixed.melted },
    slain,
    unlocked,
  };
}

/** 그 방에서 떨어진 것이 닿는 곳: 바로 아래에 핀이 꽂힌 방이 있으면 그 방, 없으면 구덩이 */
function landingOf(shafts: PuzzleState['shafts'], shaft: number, level: number): Place {
  const chambers = shafts[shaft];
  for (let below = level + 1; below < chambers.length; below += 1) {
    if (chambers[below].pinned) return { kind: 'chamber', shaft, level: below };
  }
  return { kind: 'pit' };
}

const NOT_PULLED = { pulled: false, pins: [], falls: [], landings: [], cooled: 0, slain: false, unlocked: false };

/**
 * 핀 하나를 뽑는다. 받은 상태는 바꾸지 않고 새 상태를 돌려준다.
 * 방의 핀이면 든 것이 아래로 떨어져 닿은 칸에서 섞이고, 문 핀이면 용사가 구덩이로 들어간다.
 * 사슬로 묶인 핀은 짝과 함께 뽑힌다: 두 방에 든 것이 한꺼번에 떨어지고, 같은 칸에 닿으면 함께 섞인다.
 */
export function pull(state: PuzzleState, pin: Pin): PullResult {
  if (state.status !== 'playing' || !canPull(state, pin)) return { state, ...NOT_PULLED };

  const pins = pulledWith(state, pin);
  if (pin.kind === 'door') {
    const settled = settlePit(state, NOTHING, 'pit');
    return { ...NOT_PULLED, state: settled.state, pulled: true, pins };
  }

  // 함께 뽑히는 핀을 먼저 모두 빼고 나서 닿는 곳을 정한다: 위아래로 묶인 핀이면 둘 다 그 아래로 떨어진다.
  let shafts = state.shafts;
  for (const each of pins) {
    if (each.kind === 'chamber') shafts = withChamber(shafts, each.shaft, each.level, OPENED);
  }
  const falls: Fall[] = [];
  for (const each of pins) {
    if (each.kind !== 'chamber') continue;
    const { shaft, level } = each;
    falls.push({ shaft, level, contents: state.shafts[shaft][level].contents, to: landingOf(shafts, shaft, level) });
  }

  // 방에 닿은 것부터 섞는다. 같은 칸에 닿은 것(위아래로 묶인 짝)은 한꺼번에 섞는다.
  const landings: Landing[] = [];
  let lossCause: LossCause | null = null;
  let intoPit: Contents | null = null;
  // 풀이가 수없이 부르는 곳이라, 하나만 떨어지는 흔한 경우에 헛일을 하지 않게 차례를 세어 가며 돈다.
  for (let index = 0; index < falls.length; index += 1) {
    const fall = falls[index];
    const { to } = fall;
    if (to.kind === 'pit') {
      intoPit = intoPit ? add(intoPit, fall.contents) : fall.contents;
      continue;
    }
    let counted = false;
    for (let earlier = 0; earlier < index; earlier += 1) counted ||= samePlace(falls[earlier].to, to);
    if (counted) continue;
    let arrived = fall.contents;
    for (let later = index + 1; later < falls.length; later += 1) {
      if (samePlace(falls[later].to, to)) arrived = add(arrived, falls[later].contents);
    }
    const mixed = mix(add(shafts[to.shaft][to.level].contents, arrived));
    shafts = withChamber(shafts, to.shaft, to.level, { contents: mixed.contents, pinned: true });
    landings.push({ to, cooled: mixed.cooled, burnt: mixed.burnt, melted: mixed.melted });
    lossCause ??= ruinOf(mixed);
  }

  let next: PuzzleState = { ...state, shafts };
  let slain = false;
  let unlocked = false;
  if (intoPit) {
    const settled = settlePit(next, intoPit, state.hero);
    next = settled.state;
    landings.push(settled.landing);
    ({ slain, unlocked } = settled);
  }
  // 방에서 보물이 탔거나 열쇠가 녹았으면, 구덩이에서 무슨 일이 있었든 진 판이다.
  if (lossCause) next = { ...next, status: 'lost', lossCause };

  let cooled = 0;
  for (const landing of landings) cooled += landing.cooled;
  return { state: next, pulled: true, pins, falls, landings, cooled, slain, unlocked };
}

const OPENED: Chamber = { contents: NOTHING, pinned: false };

/** 방 하나만 바꾼 통로들. 다른 통로는 그대로 쓴다. */
function withChamber(
  shafts: PuzzleState['shafts'],
  shaft: number,
  level: number,
  chamber: Chamber,
): PuzzleState['shafts'] {
  return shafts.map((chambers, at) =>
    at !== shaft ? chambers : chambers.map((before, floor) => (floor === level ? chamber : before)),
  );
}

export function samePlace(a: Place, b: Place): boolean {
  if (a.kind === 'pit' || b.kind === 'pit') return a.kind === b.kind;
  return a.shaft === b.shaft && a.level === b.level;
}

// ───────── 풀이 ─────────

export interface Solution {
  /**
   * 뽑을 수 있는 핀 가운데 아무거나 고르기를 끝까지 되풀이했을 때 보물을 얻을 확률(0~1).
   * 자물쇠도 사슬도 없는 판에서는 핀을 뽑는 모든 순서 가운데 이기는 순서의 비율과 같다.
   */
  chance: number;
  /** 보물을 얻는 가장 짧은 순서. 사슬로 묶인 핀은 누르는 것 하나만 적는다. 얻을 길이 없으면 null */
  shortest: readonly Pin[] | null;
}

/** 어느 핀이 꽂혀 있는지와 괴물이 살아 있는지를 수 하나로 적는다. */
function standingKey(state: PuzzleState): number {
  let key = state.monster ? 1 : 0;
  let bit = 2;
  for (const chambers of state.shafts) {
    for (const chamber of chambers) {
      if (chamber.pinned) key += bit;
      bit *= 2;
    }
  }
  return state.hero === 'room' ? key + bit : key;
}

/** 확률을 더하고 나누며 생긴 끝자리의 어긋남을 지운다. 1/20이 0.05보다 털끝만큼 크게 나오는 일이 없게 한다. */
function tidy(chance: number): number {
  return Math.round(chance * 1e12) / 1e12;
}

/**
 * 지금 상태에서 핀을 뽑는 길을 빠짐없이 따져 본다. state는 startPuzzle과 pull로 만든 것이어야 한다.
 * 핀을 다 뽑으면 모든 것이 구덩이에 모이므로, 어느 길이든 이기거나 지는 것으로 끝난다.
 * (자물쇠 때문에 더 뽑을 핀이 없어진 상태는 진 것으로 친다.)
 *
 * 길을 하나하나 늘어놓지는 않는다. 지지 않고 이어지는 상태는 어느 핀이 뽑혔는지와 괴물이 살아 있는지만으로
 * 정해지기 때문이다: 같은 핀들을 어떤 차례로 뽑았든 든 것은 같은 칸에 모이고, 용암과 물은 만나는 차례와 상관없이
 * 같은 수만큼 돌이 되고, 자물쇠는 열쇠가 든 방 아래가 모두 뚫렸을 때 풀린다. 그래서 그런 상태마다 한 번만 따지고
 * 적어 둔다. 핀이 아홉 개면 순서는 36만 가지가 넘지만 상태는 많아야 천 개쯤이라서, 판을 낼 때마다 여러 판을
 * 풀어 봐도 금방 끝난다.
 */
export function solveFrom(state: PuzzleState): Solution {
  const known = new Map<number, Solution>();

  const visit = (current: PuzzleState): Solution => {
    if (current.status === 'won') return { chance: 1, shortest: [] };
    if (current.status === 'lost') return { chance: 0, shortest: null };
    const key = standingKey(current);
    const before = known.get(key);
    if (before) return before;

    const moves = movesOf(current);
    let total = 0;
    let shortest: Pin[] | null = null;
    // 길이가 같으면 먼저 따진 핀의 것을 남긴다: 가장 짧은 순서가 여럿이면 핀 순서로 가장 앞선 것이 나온다.
    for (const pin of moves) {
      const next = visit(pull(current, pin).state);
      total += next.chance;
      if (next.shortest && (!shortest || next.shortest.length + 1 < shortest.length)) {
        shortest = [pin, ...next.shortest];
      }
    }
    const found = { chance: moves.length > 0 ? total / moves.length : 0, shortest };
    known.set(key, found);
    return found;
  };

  const found = visit(state);
  return { chance: tidy(found.chance), shortest: found.shortest };
}

export function solve(puzzle: Puzzle): Solution {
  return solveFrom(startPuzzle(puzzle));
}

/**
 * 핀을 limit번까지만 뽑아서 이길 수 있는지. 풀이를 끝까지 따지는 것보다 빨라서,
 * 판을 만들 때 너무 짧게 풀리는 판을 먼저 걸러 내는 데 쓴다.
 * 뽑은 수가 같은 상태를 한 켜씩 넓혀 가고, solveFrom처럼 같은 상태는 한 번만 본다.
 */
export function canWinWithin(state: PuzzleState, limit: number): boolean {
  if (state.status === 'won') return true;
  if (state.status === 'lost') return false;
  let layer = new Map([[standingKey(state), state]]);
  for (let pulled = 0; pulled < limit && layer.size > 0; pulled += 1) {
    const next = new Map<number, PuzzleState>();
    for (const current of layer.values()) {
      for (const pin of movesOf(current)) {
        const after = pull(current, pin).state;
        if (after.status === 'won') return true;
        if (after.status === 'playing') next.set(standingKey(after), after);
      }
    }
    layer = next;
  }
  return false;
}

/** 아무렇게나 뽑았을 때 이길 확률(0~1). 낮을수록 순서를 따져야 하는 판이다. */
export function winShare(solution: Solution): number {
  return solution.chance;
}

// ───────── 단계와 판 만들기 ─────────

export interface StageSpec {
  /** 핀의 수(문 핀 포함) */
  pins: number;
  /** 통로 하나에 위아래로 놓일 수 있는 방의 수 */
  maxStack: number;
  /** 구덩이에 괴물이 있을 확률 */
  monsterChance: number;
  /**
   * 이기는 가장 짧은 순서가 적어도 이만큼은 길어야 한다. 4면 용암을 식혀야만 풀리는 판이고,
   * 6이면 그런 일을 두 번 해야 풀리는 판이다(3층으로 쌓인 통로가 있어야 나온다).
   */
  minPulls: number;
  /** 이기는 순서의 비율이 이보다 높으면 너무 쉬운 판이라 쓰지 않는다 */
  maxWinShare: number;
}

/**
 * 단계별 판의 조건. 핀이 늘고, 위아래로 놓인 방과 괴물이 차례로 나오고, 아무렇게나 뽑아서 이길 확률은 낮아진다.
 * 8단계부터는 3층으로 쌓인 통로가 나와서 여섯 번을 뽑아야 풀린다. 마지막 줄이 그 뒤의 모든 단계에 쓰인다.
 */
export const STAGES: readonly StageSpec[] = [
  { pins: 3, maxStack: 1, monsterChance: 0, minPulls: 2, maxWinShare: 0.34 },
  { pins: 4, maxStack: 2, monsterChance: 0, minPulls: 2, maxWinShare: 0.34 },
  { pins: 5, maxStack: 2, monsterChance: 0, minPulls: 2, maxWinShare: 0.25 },
  { pins: 5, maxStack: 2, monsterChance: 0, minPulls: 4, maxWinShare: 0.25 },
  { pins: 5, maxStack: 2, monsterChance: 1, minPulls: 4, maxWinShare: 0.1 },
  { pins: 6, maxStack: 2, monsterChance: 0.7, minPulls: 4, maxWinShare: 0.1 },
  { pins: 6, maxStack: 2, monsterChance: 0.7, minPulls: 4, maxWinShare: 0.05 },
  { pins: 7, maxStack: 3, monsterChance: 0.8, minPulls: 6, maxWinShare: 0.05 },
  { pins: 8, maxStack: 3, monsterChance: 0.8, minPulls: 6, maxWinShare: 0.05 },
  { pins: 8, maxStack: 3, monsterChance: 0.8, minPulls: 6, maxWinShare: 0.02 },
];

/** stage(1부터)의 조건 */
export function stageSpec(stage: number): StageSpec {
  const index = Math.min(STAGES.length, Math.max(1, Math.floor(stage))) - 1;
  return STAGES[index];
}

/** 보물이 아닌 방에 용암이 들어갈 확률. 나머지는 물이다. */
export const LAVA_CHANCE = 0.5;
/**
 * 조건에 맞는 판이 나올 때까지 다시 만들어 보는 횟수.
 * 가장 드문 것은 괴물 없이 여섯 번을 뽑아야 하는 8핀 판으로, 백 번에 한 번쯤 나온다.
 */
export const MAX_ATTEMPTS = 3000;
/**
 * 끝내 조건에 맞는 판을 만들지 못했을 때 내는 판: 보물 하나와 용암 하나.
 * 백 번에 한 번 나오는 판도 3000번이면 못 만들 일이 없어서 실제로 쓰일 일은 없다.
 */
export const FALLBACK_PUZZLE: Puzzle = { shafts: [['treasure'], ['lava']], monster: false };

/**
 * 방 count개를 통로에 나눠 담는 모든 방법. 돌려주는 배열은 통로마다의 방 수다.
 * 통로 하나에는 방이 maxStack개까지 놓인다.
 */
export function shaftShapes(count: number, maxStack: number): number[][] {
  const tallest = Math.min(MAX_STACK, Math.max(1, Math.floor(maxStack)));
  const shapes: number[][] = [];
  const extend = (shape: number[], left: number): void => {
    if (left === 0) {
      if (shape.length >= MIN_SHAFTS) shapes.push(shape);
      return;
    }
    if (shape.length === MAX_SHAFTS) return;
    for (let size = 1; size <= tallest && size <= left; size += 1) {
      extend([...shape, size], left - size);
    }
  };
  extend([], count);
  return shapes;
}

/**
 * 그 단계의 판이 쓰는 통로 모양. 3층까지 쌓는 단계는 3층 통로가 있는 모양만 쓴다:
 * 네 번 넘게 뽑아야 하는 판은 3층 통로가 있어야만 나오므로, 없는 모양은 만들어 봐야 버려진다.
 */
export function stageShapes(spec: StageSpec): number[][] {
  const shapes = shaftShapes(spec.pins - 1, spec.maxStack);
  return spec.maxStack < MAX_STACK ? shapes : shapes.filter((shape) => shape.includes(MAX_STACK));
}

/** 조건의 겉모양(핀 수, 쌓인 방)만 맞춰 방을 아무렇게나 채운다. 풀리는지는 따지지 않는다. */
function randomShafts(spec: StageSpec, random: () => number): Item[][] {
  const count = spec.pins - 1;
  const shapes = stageShapes(spec);
  const shape = shapes[Math.floor(random() * shapes.length)];
  const treasureAt = Math.floor(random() * count);

  let index = 0;
  return shape.map((size) =>
    Array.from({ length: size }, (): Item => {
      const item: Item = index === treasureAt ? 'treasure' : random() < LAVA_CHANCE ? 'lava' : 'water';
      index += 1;
      return item;
    }),
  );
}

/** 풀어 본 결과가 그 단계의 조건에 맞는지: 이길 수도 질 수도 있고, 충분히 길고, 충분히 까다롭다. */
export function fitsStage(spec: StageSpec, solution: Solution): boolean {
  if (!solution.shortest || solution.chance === 1) return false;
  return solution.shortest.length >= spec.minPulls && winShare(solution) <= spec.maxWinShare;
}

/**
 * stage(1부터)에 맞는 판을 만든다. 아무렇게나 만든 판을 빠짐없이 풀어 보고 조건에 맞는 것만 낸다.
 * random은 0 이상 1 미만의 수를 돌려주는 함수(Math.random과 같은 모양).
 * avoid를 주면 그것과 다른 판을 낸다. 같은 단계를 다시 할 때 방금 그 판이 또 나오지 않게 한다.
 */
export function generatePuzzle(stage: number, random: () => number, avoid?: Puzzle): Puzzle {
  const spec = stageSpec(stage);
  // 괴물이 있는 판이 조건에 맞기 쉬워서, 괴물부터 정해 두어야 정한 확률대로 나온다.
  const monster = random() < spec.monsterChance;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const puzzle: Puzzle = { shafts: randomShafts(spec, random), monster };
    if (avoid && samePuzzle(puzzle, avoid)) continue;
    // 버려지는 판은 대부분 너무 짧게 풀리는 판이라서, 그것부터 싸게 걸러 낸다.
    if (canWinWithin(startPuzzle(puzzle), spec.minPulls - 1)) continue;
    if (fitsStage(spec, solve(puzzle))) return puzzle;
  }
  return FALLBACK_PUZZLE;
}

// ───────── 한 판의 흐름: 목숨, 시간, 점수 ─────────

export const START_HEARTS = 3;
/** 첫 단계의 제한 시간(초) */
export const FIRST_SECONDS = 15;
/** 단계가 아무리 올라도 이보다 짧아지지는 않는다(초). 판을 읽고 핀 네 개를 뽑기에 빠듯한 시간이다. */
export const MIN_SECONDS = 5;
/**
 * 한 단계 오를 때마다 남은 여유(제한 시간 - 가장 짧은 시간)가 이 비율로 줄어든다.
 * 처음에는 빨리, 갈수록 천천히 줄어서 7단계에 11초 남짓이 된다.
 */
export const SECONDS_DECAY = 0.93;
/** 2층까지의 판에서 가장 길게 뽑는 횟수. 시간과 점수는 여기까지를 기준으로 삼고, 더 뽑아야 하는 단계에는 얹어 준다. */
export const PLAIN_PULLS = 4;
/** 더 뽑아야 하는 한 번마다 얹어 주는 시간(초). 가장 짧은 시간을 네 번에 나눈 만큼이라서, 한 번에 쓸 시간이 늘지는 않는다. */
export const EXTRA_PULL_SECONDS = MIN_SECONDS / PLAIN_PULLS;

/** stage(1부터)의 판이 PLAIN_PULLS보다 적어도 몇 번을 더 뽑아야 하는지 */
function extraPulls(stage: number): number {
  return Math.max(0, stageSpec(stage).minPulls - PLAIN_PULLS);
}

/** stage(1부터)의 판 하나에 주어지는 시간(초). 떨어지는 동안과 판이 바뀌는 동안에는 흐르지 않는다. */
export function puzzleSeconds(stage: number): number {
  const steps = Math.max(1, Math.floor(stage)) - 1;
  const plain = MIN_SECONDS + (FIRST_SECONDS - MIN_SECONDS) * SECONDS_DECAY ** steps;
  return plain + EXTRA_PULL_SECONDS * extraPulls(stage);
}

export const BASE_POINTS = 10;
/** 한 단계 오를 때마다 늘어나는 기본 점수 */
export const STAGE_POINTS = 2;
/** 이 단계부터는 기본 점수가 더 늘지 않는다. 오래 버틴 판의 점수가 끝없이 불어나지 않게 한다. */
export const TOP_POINT_STAGE = 11;
/** 더 뽑아야 하는 한 번마다 얹어 주는 기본 점수. 길게 풀어야 하는 판이 그만큼 더 값지다. */
export const EXTRA_PULL_POINTS = 8;

/** stage(1부터)의 판을 깼을 때의 기본 점수 */
export function stagePoints(stage: number): number {
  const steps = Math.min(TOP_POINT_STAGE, Math.max(1, Math.floor(stage))) - 1;
  return BASE_POINTS + STAGE_POINTS * steps + EXTRA_PULL_POINTS * extraPulls(stage);
}

/** 남긴 시간 1초마다 1점. 소수점 아래는 버린다. */
export function timeBonus(secondsLeft: number): number {
  return Math.max(0, Math.floor(secondsLeft));
}

/** 판을 깼을 때 받는 점수: 단계의 기본 점수에 남긴 시간만큼 더한다. */
export function winPoints(stage: number, secondsLeft: number): number {
  return stagePoints(stage) + timeBonus(secondsLeft);
}
