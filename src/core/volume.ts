/**
 * 효과음과 배경 음악의 크기. 켜고 끄는 것은 설정(save.ts의 Settings)에 있고, 여기서는 켜져 있을 때 얼마나 크게 낼지만 다룬다.
 * 저장소와 화면 어느 쪽에도 의존하지 않는 순수 함수들이다.
 */

/** 크기 단계: 1 작게, 2 보통, 3 크게 */
export const VOLUME_LEVELS = [1, 2, 3] as const;
export type VolumeLevel = (typeof VOLUME_LEVELS)[number];

/** 처음의 크기. 크기 조절이 생기기 전의 소리와 같다. */
export const DEFAULT_VOLUME: VolumeLevel = 2;

/** 세이브에 남기는 크기 */
export interface VolumeState {
  sound: VolumeLevel;
  music: VolumeLevel;
}

export function createVolume(): VolumeState {
  return { sound: DEFAULT_VOLUME, music: DEFAULT_VOLUME };
}

function toLevel(raw: unknown): VolumeLevel {
  return VOLUME_LEVELS.find((level) => level === raw) ?? DEFAULT_VOLUME;
}

/** 저장소나 가져온 파일에서 읽은 값을 믿을 수 있는 모양으로 맞춘다. 크기 조절이 생기기 전의 세이브는 보통 크기로 읽는다. */
export function normalizeVolume(raw: unknown): VolumeState {
  if (typeof raw !== 'object' || raw === null) return createVolume();
  const data = raw as Record<string, unknown>;
  return { sound: toLevel(data.sound), music: toLevel(data.music) };
}

/** 단계마다 소리에 곱하는 값. 보통이 1이고, 한 단계마다 귀에 또렷이 다르게 들릴 만큼 벌렸다. */
const GAIN: Record<VolumeLevel, number> = { 1: 0.4, 2: 1, 3: 1.7 };

export function volumeGain(level: VolumeLevel): number {
  return GAIN[level];
}

const LABEL: Record<VolumeLevel, string> = { 1: '작게', 2: '보통', 3: '크게' };

/** 설정 화면의 버튼에 적는 말 */
export function volumeLabel(on: boolean, level: VolumeLevel): string {
  return on ? LABEL[level] : '꺼짐';
}

/** 버튼을 누를 때마다 넘어가는 차례: 꺼짐 → 작게 → 보통 → 크게 → 꺼짐 */
export function nextVolume(on: boolean, level: VolumeLevel): { on: boolean; level: VolumeLevel } {
  if (!on) return { on: true, level: VOLUME_LEVELS[0] };
  const next = VOLUME_LEVELS[VOLUME_LEVELS.indexOf(level) + 1];
  // 가장 큰 단계 다음은 꺼짐이다. 다시 켜면 작게부터 시작하므로 단계는 그대로 두어도 된다.
  return next === undefined ? { on: false, level } : { on: true, level: next };
}
