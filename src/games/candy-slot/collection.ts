/**
 * 부적 도감: 한 번이라도 붙여 본(가게에서 산) 부적을 판이 끝나도 기억해 둔다.
 * 찾은 부적의 id만 남기고, 무엇이 실리는지는 rules.ts의 CHARMS에서 그때그때 읽는다. 그래서 부적이 늘면 도감도 따라 늘어난다.
 * 화면과 저장소 어느 쪽에도 기대지 않는 순수 함수들이다.
 */
import { baseOf, CHARMS, charmOf, isUpgraded, type CharmInfo } from './rules';
import { setOf, type CharmSet } from './sets';

/** 도감에 실리는 부적의 수 */
export const COLLECTION_SIZE = CHARMS.length;

/** 도감 화면에 적는 글 */
export const COLLECTION_TEXT = {
  title: '부적 도감',
  close: '닫기',
  /** 아직 찾지 못한 부적의 칸에 적는 글자와, 그 칸을 눌렀을 때의 이름과 설명 */
  unknownMark: '?',
  unknownName: '???',
  unknownDescription: '아직 찾지 못한 부적이에요',
  /** 아무 칸도 누르지 않았을 때: 찾은 부적이 있을 때와 없을 때 */
  hint: '부적을 누르면 설명이 나와요',
  empty: '가게에서 부적을 사면 여기에 모여요',
} as const;

/**
 * 저장소에서 읽은 값을 찾은 부적의 목록으로 정리한다: 지금 있는 부적의 id만 남기고 겹친 것을 뺀다.
 * 차례는 찾은 차례 그대로다.
 */
export function normalizeFound(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const found: string[] = [];
  for (const id of raw) {
    // 도감에는 강화하지 않은 id만 적는다. 강화한 부적은 addFound가 원래 부적으로 적는다.
    if (typeof id === 'string' && charmOf(id) && !isUpgraded(id) && !found.includes(id)) found.push(id);
  }
  return found;
}

/** 그 부적을 찾은 적이 있는지 */
export function isFound(found: readonly string[], id: string): boolean {
  return found.includes(baseOf(id));
}

/**
 * 부적 하나를 찾은 것으로 적은 새 목록을 돌려준다. 원본은 바꾸지 않는다.
 * 이미 찾았거나 없는 부적이면 받은 목록 그대로다(같은 배열).
 */
export function addFound(found: readonly string[], id: string): readonly string[] {
  const base = baseOf(id);
  if (!charmOf(base) || found.includes(base)) return found;
  return [...found, base];
}

/** 찾은 부적의 수. 지금 있는 부적만, 겹치지 않게 센다. */
export function foundCount(found: readonly string[]): number {
  return CHARMS.filter((charm) => found.includes(charm.id)).length;
}

/** 버튼에 적는 글: "도감 7/24" */
export function collectionLabel(found: readonly string[]): string {
  return `도감 ${foundCount(found)}/${COLLECTION_SIZE}`;
}

/** 도감의 한 칸 */
export interface CollectionEntry {
  charm: CharmInfo;
  found: boolean;
}

/** 도감에 놓이는 칸들. 차례는 CHARMS의 차례(갈래끼리 모여 있다)이고, 찾은 차례와는 상관없다. */
export function collectionEntries(found: readonly string[]): CollectionEntry[] {
  return CHARMS.map((charm) => ({ charm, found: found.includes(charm.id) }));
}

/** 도감의 칸을 눌렀을 때 보여 줄 이름과 설명. 찾지 못한 부적은 아무것도 알려 주지 않는다. */
export function entryText(entry: CollectionEntry): { name: string; description: string } {
  if (!entry.found) return { name: COLLECTION_TEXT.unknownName, description: COLLECTION_TEXT.unknownDescription };
  return { name: entry.charm.name, description: entry.charm.description };
}

/** 도감의 칸을 눌렀을 때 이름 옆에 적을 세트(sets.ts). 세트에 들지 않거나 아직 찾지 못한 부적이면 undefined */
export function entrySet(entry: CollectionEntry): CharmSet | undefined {
  return entry.found ? setOf(entry.charm.id) : undefined;
}
