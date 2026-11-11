/**
 * 색깔 물 나누기의 규칙: 병과 붓기, 다 나눴는지 판정, 단계 만들기.
 * 화면과 Phaser에 의존하지 않는 순수 함수들이다. 무작위가 필요한 곳은 random을 받아서 쓴다.
 */

/** 병 하나에 들어가는 칸 수 */
export const TUBE_CAPACITY = 4;
/** 단계마다 비워 두는 병의 수 */
export const EMPTY_TUBES = 2;
export const MIN_COLORS = 3;
export const MAX_COLORS = 7;

/** 병 하나. 바닥에서 위로 쌓인 순서의 색 번호들 */
export type Tube = readonly number[];
export type Tubes = readonly Tube[];

export interface Move {
  from: number;
  to: number;
}

/** 병 맨 위에 같은 색으로 이어진 덩어리. 빈 병이면 null. */
export function topRun(tube: Tube): { color: number; count: number } | null {
  if (tube.length === 0) return null;
  const color = tube[tube.length - 1];
  let count = 1;
  while (count < tube.length && tube[tube.length - 1 - count] === color) count += 1;
  return { color, count };
}

/** 한 가지 색으로 가득 찬 병인지 */
export function isComplete(tube: Tube): boolean {
  return tube.length === TUBE_CAPACITY && tube.every((color) => color === tube[0]);
}

/** 모든 병이 비었거나 한 가지 색으로 가득 찼는지 */
export function isSolved(tubes: Tubes): boolean {
  return tubes.every((tube) => tube.length === 0 || isComplete(tube));
}

/** from 병의 맨 위 덩어리를 to 병에 부을 수 있는지. 빈 병이거나 맨 위 색이 같고 자리가 있어야 한다. */
export function canPour(tubes: Tubes, from: number, to: number): boolean {
  if (from === to) return false;
  const source = tubes[from];
  const target = tubes[to];
  if (!source || !target) return false;
  if (source.length === 0 || target.length >= TUBE_CAPACITY) return false;
  return target.length === 0 || target[target.length - 1] === source[source.length - 1];
}

export interface PourResult {
  tubes: Tubes;
  color: number;
  /** 옮겨 간 칸 수. 자리가 모자라면 들어가는 만큼만 옮긴다. */
  moved: number;
  /** 이번에 부어서 to 병이 한 가지 색으로 가득 찼는지 */
  completed: boolean;
}

/** 붓는다. 부을 수 없으면 null. 원본은 바꾸지 않는다. */
export function pour(tubes: Tubes, from: number, to: number): PourResult | null {
  if (!canPour(tubes, from, to)) return null;
  const source = tubes[from];
  const target = tubes[to];
  const run = topRun(source)!;
  const moved = Math.min(run.count, TUBE_CAPACITY - target.length);
  const nextTarget = [...target, ...Array<number>(moved).fill(run.color)];
  const next = tubes.map((tube, index) =>
    index === from ? source.slice(0, source.length - moved) : index === to ? nextTarget : tube,
  );
  return { tubes: next, color: run.color, moved, completed: isComplete(nextTarget) };
}

/** 지금 할 수 있는 모든 붓기 */
export function legalMoves(tubes: Tubes): Move[] {
  const moves: Move[] = [];
  for (let from = 0; from < tubes.length; from += 1) {
    for (let to = 0; to < tubes.length; to += 1) {
      if (canPour(tubes, from, to)) moves.push({ from, to });
    }
  }
  return moves;
}

/** 다 나누지 못했는데 부을 곳이 하나도 없는지 */
export function isStuck(tubes: Tubes): boolean {
  return !isSolved(tubes) && legalMoves(tubes).length === 0;
}

// ───────── 단계 ─────────

/** stage(0부터)번째 단계의 색 수. 3색에서 시작해 두 단계마다 한 색씩 늘어난다. */
export function colorsFor(stage: number): number {
  const level = Math.max(0, Math.floor(stage));
  return Math.min(MAX_COLORS, MIN_COLORS + Math.floor((level + 1) / 2));
}

/** 찾아 둔 풀이보다 더 부을 수 있는 여유. 단계가 올라갈수록 줄어든다. */
export function slackFor(stage: number): number {
  return Math.max(2, 8 - Math.max(0, Math.floor(stage)));
}

/** 한 단계에서 부을 수 있는 횟수 */
export function pourBudget(par: number, stage: number): number {
  return par + slackFor(stage);
}

/** 병 하나를 한 색으로 채울 때마다 받는 점수 */
export const TUBE_POINTS = 10;
/** 단계를 깨고 남은 붓기 한 번마다 받는 점수 */
export const LEFTOVER_POINTS = 2;

/** 단계를 깼을 때의 보너스 */
export function clearBonus(stage: number): number {
  return 10 + 5 * Math.max(0, Math.floor(stage));
}

// ───────── 풀이 찾기 ─────────

function keyOf(tubes: Tubes): string {
  // 병의 순서만 다른 배치는 같은 것으로 본다.
  return tubes
    .map((tube) => tube.join(''))
    .sort()
    .join('|');
}

/** 풀이에 도움이 될 수 있는 붓기만 고르고, 좋아 보이는 것부터 늘어놓는다. */
function candidateMoves(tubes: Tubes, random: () => number): Move[] {
  const scored: Array<{ move: Move; score: number }> = [];
  const firstEmpty = tubes.findIndex((tube) => tube.length === 0);
  for (let from = 0; from < tubes.length; from += 1) {
    const source = tubes[from];
    const run = topRun(source);
    if (!run || isComplete(source)) continue;
    const singleColor = run.count === source.length;
    for (let to = 0; to < tubes.length; to += 1) {
      if (!canPour(tubes, from, to)) continue;
      const target = tubes[to];
      let score: number;
      if (target.length === 0) {
        // 빈 병은 어느 것이든 같으니 하나만 보고, 한 색뿐인 병을 빈 병으로 옮기는 헛수고는 뺀다.
        if (to !== firstEmpty || singleColor) continue;
        score = 1;
      } else {
        const space = TUBE_CAPACITY - target.length;
        if (run.count > space) score = 0;
        else score = target.length + run.count === TUBE_CAPACITY && singleColorTube(target) ? 3 : 2;
      }
      scored.push({ move: { from, to }, score: score + random() * 0.9 });
    }
  }
  return scored.sort((a, b) => b.score - a.score).map((item) => item.move);
}

function singleColorTube(tube: Tube): boolean {
  return tube.every((color) => color === tube[0]);
}

/**
 * 깊이 우선으로 풀이 하나를 찾는다. 가장 짧은 풀이는 아니다.
 * nodeLimit개의 배치를 살펴보고도 못 찾으면 null.
 */
export function solve(tubes: Tubes, random: () => number, nodeLimit = 4000): Move[] | null {
  const seen = new Set<string>();
  const path: Move[] = [];
  let nodes = 0;

  const visit = (state: Tubes): boolean => {
    if (isSolved(state)) return true;
    const key = keyOf(state);
    if (seen.has(key)) return false;
    seen.add(key);
    nodes += 1;
    if (nodes > nodeLimit) return false;
    for (const move of candidateMoves(state, random)) {
      const result = pour(state, move.from, move.to);
      if (!result) continue;
      path.push(move);
      if (visit(result.tubes)) return true;
      path.pop();
      if (nodes > nodeLimit) return false;
    }
    return false;
  };

  return visit(tubes) ? [...path] : null;
}

/** 여러 번 풀어 보고 가장 짧았던 풀이를 고른다. 풀 수 없으면 null. */
export function bestSolution(tubes: Tubes, random: () => number, attempts = 12): Move[] | null {
  let best: Move[] | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const found = solve(tubes, random);
    if (!found) {
      // 한 번 못 찾은 배치는 다시 해도 대개 못 찾는다.
      if (!best && attempt >= 1) return null;
      continue;
    }
    if (!best || found.length < best.length) best = found;
  }
  return best;
}

// ───────── 단계 만들기 ─────────

export interface Stage {
  tubes: Tubes;
  colors: number;
  /** 찾아 둔 풀이의 붓기 횟수. 이 횟수로는 반드시 풀 수 있다. */
  par: number;
  solution: readonly Move[];
}

function shuffle<T>(items: T[], random: () => number): T[] {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [items[index], items[other]] = [items[other], items[index]];
  }
  return items;
}

function dealRandom(colors: number, random: () => number): Tubes {
  const units: number[] = [];
  for (let color = 0; color < colors; color += 1) {
    for (let count = 0; count < TUBE_CAPACITY; count += 1) units.push(color);
  }
  shuffle(units, random);
  const tubes: number[][] = [];
  for (let index = 0; index < colors; index += 1) {
    tubes.push(units.slice(index * TUBE_CAPACITY, (index + 1) * TUBE_CAPACITY));
  }
  for (let index = 0; index < EMPTY_TUBES; index += 1) tubes.push([]);
  return tubes;
}

/**
 * 반드시 풀 수 있는 쉬운 배치: 병마다 제 색 세 칸 위에 옆 병의 색 한 칸이 올라가 있다.
 * 무작위 배치에서 풀이를 찾지 못했을 때만 쓴다.
 */
export function fallbackTubes(colors: number): Tubes {
  const tubes: number[][] = [];
  for (let color = 0; color < colors; color += 1) {
    tubes.push([color, color, color, (color + 1) % colors]);
  }
  for (let index = 0; index < EMPTY_TUBES; index += 1) tubes.push([]);
  return tubes;
}

/** 무작위 배치를 몇 번까지 다시 해 볼지 */
const DEAL_ATTEMPTS = 40;

/** stage(0부터)번째 단계를 만든다. 풀 수 있는 배치만 낸다. */
export function dealStage(stage: number, random: () => number): Stage {
  const colors = colorsFor(stage);
  for (let attempt = 0; attempt < DEAL_ATTEMPTS; attempt += 1) {
    const tubes = dealRandom(colors, random);
    // 처음부터 다 된 병이 있으면 싱겁다.
    if (tubes.some(isComplete)) continue;
    const solution = bestSolution(tubes, random);
    if (solution) return { tubes, colors, par: solution.length, solution };
  }
  const tubes = fallbackTubes(colors);
  const solution = bestSolution(tubes, random) ?? [];
  return { tubes, colors, par: solution.length, solution };
}
