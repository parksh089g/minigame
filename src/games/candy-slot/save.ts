/**
 * 행운 슬롯이 허브 세이브(core/save.ts의 slot)에 남기는 것: 하던 판과 부적 도감, 행운 조각과 영구 해금.
 * 허브 세이브에 들어 있어서 내보내기, 가져오기, 기기 옮기기에 그대로 실려 가고, 기록 초기화로 함께 지워진다.
 *
 * 하던 판은 RunState를 그대로 적는다. RunState에는 운의 씨앗과 차례(seed, spinCount, drawCount)까지 들어 있어서
 * 이어 한 판은 두고 간 판과 같은 운으로 이어진다. 읽을 때는 모양과 값을 모두 따져서,
 * 하나라도 맞지 않으면 고쳐 쓰지 않고 판을 통째로 버린다(반쯤 맞는 판으로 이어 하는 것보다 새 판이 낫다).
 * 화면과 저장소 어느 쪽에도 기대지 않는 순수 함수들이다.
 */
import { normalizeFound, addFound } from './collection';
import { addPieces, PIECES_MAX, unlock } from './perks';
import {
  CELLS,
  charmOf,
  holdsOf,
  isUpgraded,
  OFFERS,
  ownsCharm,
  PERK_IDS,
  RELIC_IDS,
  RELIC_MAX,
  slotsOf,
  spinsOf,
  SYMBOLS,
  type PerkId,
  type RelicLevels,
  type RunState,
  type Shop,
} from './rules';

/**
 * 하던 판을 적는 모양의 버전. RunState의 모양이나 뜻이 바뀌어 예전 판을 이어 할 수 없게 되면 하나 올린다.
 * 버전이 다른 판은 읽지 않고 버린다.
 */
export const RUN_VERSION = 1;

/** 세이브에 적힌 하던 판 */
export interface SavedRun {
  version: number;
  run: RunState;
}

/** 허브 세이브의 slot */
export interface SlotSave {
  /** 한 번이라도 붙여 본 부적의 id. 찾은 차례대로 들어 있다. */
  found: string[];
  /** 하던 판. 없으면 null이다. */
  run: SavedRun | null;
  /** 가진 행운 조각. 판이 끝날 때 받고, 영구 해금을 여는 데 쓴다(perks.ts). */
  pieces: number;
  /** 열어 둔 영구 해금. PERK_IDS의 차례로 들어 있다. */
  perks: PerkId[];
}

/** 이어 하기와 관련해 화면에 적는 글 */
export const RESUME_TEXT = {
  resume: '이어 하기',
  fresh: '새 판',
  /** 일시정지 화면에서 그만두려 할 때 알리는 한 줄 */
  quit: '하던 판은 이어 할 수 있어요',
  /** 하던 판이 있을 때 일시정지 화면의 "처음부터 다시" 대신 적는 이름 */
  restart: '시작 화면으로',
} as const;

/** 이어 할 판이 어디까지 갔는지 알리는 한 줄: "라운드 3 · 금화 12개" */
export function resumeCaption(run: RunState): string {
  return `라운드 ${run.round} · 금화 ${run.coin}개`;
}

export function createSlotSave(): SlotSave {
  return { found: [], run: null, pieces: 0, perks: [] };
}

/**
 * 이어 할 수 있는 판인지: 끝나지 않았고, 한 번이라도 돌린 판이어야 한다.
 * 아직 한 번도 돌리지 않은 판은 새 판과 다를 것이 없어서 남기지 않는다.
 */
export function isResumable(run: RunState): boolean {
  return run.phase !== 'over' && run.spinCount > 0;
}

/** 세이브에 적을 모양으로 싼다. 이어 할 수 없는 판이면 null(남기지 않는다). */
export function packRun(run: RunState): SavedRun | null {
  if (!isResumable(run)) return null;
  return { version: RUN_VERSION, run: structuredClone(run) };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** 0 이상의 정수인지. NaN, 소수, 음수, 너무 큰 수는 아니다. */
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** 씨앗으로 받아 주는 가장 긴 글자 수. 깨진 세이브가 끝없이 커지지 않게 막는 값이다. */
const SEED_MAX = 64;

/**
 * 붙인 부적: 있는 부적만(강화한 것도 받는다), 같은 부적이 겹치지 않게, limit장까지. 맞지 않으면 null.
 */
function readCharms(raw: unknown, limit: number): string[] | null {
  if (!Array.isArray(raw) || raw.length > limit) return null;
  const charms: string[] = [];
  for (const id of raw) {
    if (typeof id !== 'string' || !charmOf(id) || ownsCharm(charms, id)) return null;
    charms.push(id);
  }
  return charms;
}

/**
 * 판을 시작할 때 켜져 있던 영구 해금: 있는 해금만, 겹치지 않게. 맞지 않으면 null.
 * 해금이 생기기 전에 저장된 판에는 이 값이 없다. 그때는 해금 없이 시작한 판이다.
 */
function readPerks(raw: unknown): PerkId[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return null;
  const perks: PerkId[] = [];
  for (const id of raw) {
    const perk = PERK_IDS.find((known) => known === id);
    if (!perk || perks.includes(perk)) return null;
    perks.push(perk);
  }
  return perks;
}

/**
 * 판을 시작할 때의 유물 단계: 있는 유물만, 1부터 RELIC_MAX까지의 정수만. 맞지 않으면 null.
 * 유물이 생기기 전에 저장된 판에는 이 값이 없다. 그때는 유물 없이 시작한 판이다.
 */
function readRelics(raw: unknown): RelicLevels | null {
  if (raw === undefined) return {};
  if (!isObject(raw)) return null;
  const relics: RelicLevels = {};
  for (const [key, level] of Object.entries(raw)) {
    const id = RELIC_IDS.find((known) => known === key);
    if (!id || !isCount(level) || level < 1 || level > RELIC_MAX) return null;
    relics[id] = level;
  }
  return relics;
}

/** 가게: 팔린 자리는 null이고, 남은 자리는 서로 다른 있는 부적이다. 맞지 않으면 null. */
function readShop(raw: unknown): Shop | null {
  if (!isObject(raw) || !Array.isArray(raw.offers) || raw.offers.length > OFFERS || !isCount(raw.rerollCost)) {
    return null;
  }
  const offers: (string | null)[] = [];
  for (const id of raw.offers) {
    if (id === null) {
      offers.push(null);
      continue;
    }
    // 가게에는 강화하지 않은 부적만 나온다.
    if (typeof id !== 'string' || !charmOf(id) || isUpgraded(id) || offers.includes(id)) return null;
    offers.push(id);
  }
  return { offers, rerollCost: raw.rerollCost };
}

/** 바로 앞 스핀의 판: 아홉 칸에 있는 그림의 번호. 맞지 않으면 null. */
function readGrid(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length !== CELLS) return null;
  const grid: number[] = [];
  for (const symbol of raw) {
    if (!isCount(symbol) || symbol >= SYMBOLS.length) return null;
    grid.push(symbol);
  }
  return grid;
}

/**
 * 세이브에서 읽은 값에서 하던 판을 꺼낸다. 버전이 다르거나, 모양이 맞지 않거나, 없는 부적이 있거나,
 * 규칙으로는 나올 수 없는 값이 있으면 null을 돌려준다(그 판은 버린다).
 */
export function readRun(raw: unknown): RunState | null {
  if (!isObject(raw) || raw.version !== RUN_VERSION || !isObject(raw.run)) return null;
  const from = raw.run;
  const { phase, seed } = from;
  if (phase !== 'spin' && phase !== 'shop') return null;
  const perks = readPerks(from.perks);
  // 정해진 운의 판(오늘의 판)은 누구나 같은 조건이라 해금도 유물도 켜져 있을 수 없다.
  if (!perks || (seed !== null && perks.length > 0)) return null;
  const relics = readRelics(from.relics);
  if (!relics || (seed !== null && Object.keys(relics).length > 0)) return null;
  const charms = readCharms(from.charms, slotsOf({ perks }));
  if (!charms) return null;

  const { round, spinsLeft, coin, earned, bestSpin, holdsLeft, spinCount, drawCount, afterMiss } = from;
  if (!isCount(round) || round < 1) return null;
  if (!isCount(coin) || !isCount(earned) || !isCount(bestSpin)) return null;
  if (!isCount(spinCount) || !isCount(drawCount)) return null;
  if (!isCount(holdsLeft) || holdsLeft > holdsOf({ perks })) return null;
  if (typeof afterMiss !== 'boolean') return null;
  if (seed !== null && (typeof seed !== 'string' || seed.length > SEED_MAX)) return null;

  // 스핀을 하는 동안에는 가게가 닫혀 있고, 남은 스핀은 그 라운드에 돌릴 수 있는 횟수를 넘지 않는다.
  // 가게는 스핀을 다 쓴 뒤에만 열린다.
  if (!isCount(spinsLeft)) return null;
  let shop: Shop | null = null;
  if (phase === 'spin') {
    if (from.shop !== null || spinsLeft > spinsOf(charms)) return null;
  } else {
    shop = readShop(from.shop);
    if (!shop || spinsLeft !== 0) return null;
  }

  let lastGrid: number[] | null = null;
  if (from.lastGrid !== null) {
    lastGrid = readGrid(from.lastGrid);
    if (!lastGrid) return null;
  }

  return {
    phase,
    round,
    spinsLeft,
    coin,
    earned,
    charms,
    shop,
    afterMiss,
    bestSpin,
    lastGrid,
    holdsLeft,
    seed,
    spinCount,
    drawCount,
    perks,
    relics,
  };
}

/**
 * 가진 조각: 0 이상의 정수만 받고 한도(PIECES_MAX)에서 자른다. 없거나(조각이 생기기 전의 세이브) 맞지 않으면 0이다.
 */
function normalizePieces(raw: unknown): number {
  return isCount(raw) ? Math.min(PIECES_MAX, raw) : 0;
}

/**
 * 열어 둔 해금: 지금 있는 해금만, 겹치지 않게, PERK_IDS의 차례로 남긴다. 없거나 목록이 아니면 연 것이 없다.
 * 하던 판의 해금(readPerks)과 달리 모르는 것이 섞여 있어도 아는 것은 살린다. 조각을 내고 연 것이라 버리면 아깝다.
 */
function normalizeUnlocked(raw: unknown): PerkId[] {
  if (!Array.isArray(raw)) return [];
  return PERK_IDS.filter((id) => raw.includes(id));
}

/**
 * 저장소나 가져오기 파일에서 읽은 값을 안전한 SlotSave로 바꾼다.
 * 도감과 해금은 맞는 것만 남기고, 하던 판은 조금이라도 맞지 않으면 버린다. 한쪽이 깨져도 다른 쪽은 살린다.
 */
export function normalizeSlotSave(raw: unknown): SlotSave {
  if (!isObject(raw)) return createSlotSave();
  const run = readRun(raw.run);
  return {
    found: normalizeFound(raw.found),
    run: run && isResumable(run) ? { version: RUN_VERSION, run } : null,
    pieces: normalizePieces(raw.pieces),
    perks: normalizeUnlocked(raw.perks),
  };
}

/** 세이브에 남아 있는 이어 할 판. 없으면 null. 돌려주는 것은 사본이라 고쳐도 세이브는 그대로다. */
export function savedRunOf(slot: SlotSave): RunState | null {
  return slot.run ? structuredClone(slot.run.run) : null;
}

/** 하던 판을 적은(run이 이어 할 수 없는 판이거나 null이면 지운) 새 SlotSave를 돌려준다. 원본은 바꾸지 않는다. */
export function withRun(slot: SlotSave, run: RunState | null): SlotSave {
  return { ...slot, run: run ? packRun(run) : null };
}

/** 부적 하나를 도감에 넣은 새 SlotSave를 돌려준다. 이미 찾았거나 없는 부적이면 받은 것 그대로다. */
export function withFound(slot: SlotSave, charmId: string): SlotSave {
  const found = addFound(slot.found, charmId);
  return found === slot.found ? slot : { ...slot, found: [...found] };
}

/** 조각을 amount개 더한 새 SlotSave를 돌려준다. 더할 것이 없거나 이미 한도면 받은 것 그대로다. */
export function withPieces(slot: SlotSave, amount: number): SlotSave {
  const next = addPieces(slot, amount);
  return next === slot ? slot : { ...slot, pieces: next.pieces };
}

/**
 * 조각을 내고 해금 하나를 연 새 SlotSave를 돌려준다. 이미 열었거나 조각이 모자라면 받은 것 그대로다.
 * 하던 판은 건드리지 않는다. 판은 시작할 때 켜져 있던 해금을 스스로 적어 두고 있다(RunState.perks).
 */
export function withPerk(slot: SlotSave, id: PerkId): SlotSave {
  const next = unlock(slot, id);
  return next === slot ? slot : { ...slot, pieces: next.pieces, perks: [...next.perks] };
}
