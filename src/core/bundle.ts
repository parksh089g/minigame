/**
 * 이 기기에 저장된 것 전부를 한 묶음으로 내보내고 가져온다. 파일로 백업할 때와 다른 기기로 옮길 때 같이 쓴다.
 * 허브 세이브 말고 따로 저장하는 게임(등불지기)은 자기 몫을 여기에 등록해 둔다.
 */
import { looksLikeSave } from './save';
import { store } from './store';

export const BUNDLE_APP = 'pocket-arcade';
export const BUNDLE_VERSION = 1;

/** 허브 세이브와 따로 저장되는 한 덩어리 */
export interface SavePart {
  /** 내보낼 값. lean이면 없어도 되는 큰 덩어리(하던 판 같은 것)는 뺀다. */
  read(lean: boolean): Promise<unknown>;
  /**
   * 가져온 값으로 바꾼다. 값이 맞지 않으면 처음 상태로 돌린다. null을 받으면 반드시 처음 상태로 돌린다(resetParts).
   * undefined는 그 덩어리가 생기기 전에 내보낸 묶음이라는 뜻이라, 지금 것을 그대로 둬도 된다.
   */
  write(raw: unknown): Promise<void>;
}

export interface Bundle {
  app: typeof BUNDLE_APP;
  bundle: number;
  savedAt: number;
  save: unknown;
  /** 등록한 이름 → 그 덩어리의 값 */
  parts: Record<string, unknown>;
}

const parts = new Map<string, SavePart>();

/** 허브 세이브와 따로 저장하는 것을 묶음에 넣도록 등록한다. 이름은 한 번 정하면 바꾸지 않는다. */
export function registerSavePart(name: string, part: SavePart): void {
  parts.set(name, part);
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function packBundle(save: unknown, partValues: Record<string, unknown>, now: number): Bundle {
  return { app: BUNDLE_APP, bundle: BUNDLE_VERSION, savedAt: now, save, parts: partValues };
}

/**
 * 읽어 온 값에서 세이브와 덩어리들을 꺼낸다. 이 앱의 것이 아니면 null.
 * 묶음이 생기기 전에 내보낸 파일(허브 세이브만 든 것)도 받는다. 그때는 parts가 null이고, 따로 저장된 것은 건드리지 않는다.
 */
export function unpackBundle(raw: unknown): { save: unknown; parts: Record<string, unknown> | null } | null {
  if (!isObject(raw)) return null;
  if (raw.app === BUNDLE_APP) {
    if (!looksLikeSave(raw.save)) return null;
    return { save: raw.save, parts: isObject(raw.parts) ? raw.parts : {} };
  }
  return looksLikeSave(raw) ? { save: raw, parts: null } : null;
}

/** 이 기기에 저장된 것 전부를 묶는다. */
export async function exportBundle(lean = false): Promise<Bundle> {
  await store.flush();
  const values: Record<string, unknown> = {};
  for (const [name, part] of parts) values[name] = await part.read(lean);
  return packBundle(structuredClone(store.data), values, Date.now());
}

/**
 * 묶음을 글자로 만든다. maxChars를 넘으면 없어도 되는 것을 빼고 다시 만든다. 그래도 넘으면 null.
 * pretty면 사람이 읽기 좋게 줄을 나눈다(파일로 내보낼 때).
 */
export async function exportBundleText(maxChars = Infinity, pretty = false): Promise<string | null> {
  for (const lean of [false, true]) {
    const text = JSON.stringify(await exportBundle(lean), null, pretty ? 2 : undefined);
    if (text.length <= maxChars) return text;
  }
  return null;
}

/** 따로 저장하는 덩어리(등불지기, 새싹 컴퍼니, 텃밭 지키기, 행운 슬롯의 오늘의 판)를 모두 처음 상태로 돌린다. 설정의 "기록 초기화"가 허브 세이브와 함께 지운다. */
export async function resetParts(): Promise<void> {
  for (const part of parts.values()) await part.write(null);
}

/** 내보낸 묶음(또는 예전 세이브 파일)의 글자를 읽어 이 기기의 기록을 바꾼다. 이 앱의 것이 아니면 false. */
export async function importBundleText(text: string): Promise<boolean> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return false;
  }
  const unpacked = unpackBundle(raw);
  if (!unpacked || !store.importData(unpacked.save)) return false;
  if (unpacked.parts) {
    for (const [name, part] of parts) await part.write(unpacked.parts[name]);
  }
  await store.flush();
  return true;
}
