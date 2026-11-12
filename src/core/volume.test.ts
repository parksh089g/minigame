import { describe, expect, it } from 'vitest';
import {
  createVolume,
  DEFAULT_VOLUME,
  nextVolume,
  normalizeVolume,
  VOLUME_LEVELS,
  volumeGain,
  volumeLabel,
} from './volume';

describe('소리 크기', () => {
  it('처음에는 보통이고, 보통은 크기 조절이 생기기 전의 소리 그대로다', () => {
    expect(createVolume()).toEqual({ sound: 2, music: 2 });
    expect(volumeGain(DEFAULT_VOLUME)).toBe(1);
  });

  it('단계가 오를수록 커진다', () => {
    const gains = VOLUME_LEVELS.map(volumeGain);
    expect([...gains].sort((a, b) => a - b)).toEqual(gains);
    expect(new Set(gains).size).toBe(gains.length);
    expect(gains[0]).toBeGreaterThan(0);
  });

  it('누를 때마다 꺼짐, 작게, 보통, 크게를 차례로 돈다', () => {
    const seen: string[] = [];
    let state = { on: false, level: DEFAULT_VOLUME };
    for (let press = 0; press < 5; press += 1) {
      state = nextVolume(state.on, state.level);
      seen.push(volumeLabel(state.on, state.level));
    }
    expect(seen).toEqual(['작게', '보통', '크게', '꺼짐', '작게']);
  });

  it('꺼져 있으면 단계와 상관없이 꺼짐이라고 적는다', () => {
    for (const level of VOLUME_LEVELS) expect(volumeLabel(false, level)).toBe('꺼짐');
  });

  it('저장된 값을 읽는다. 없거나 이상하면 보통이다', () => {
    expect(normalizeVolume({ sound: 1, music: 3 })).toEqual({ sound: 1, music: 3 });
    expect(normalizeVolume(undefined)).toEqual(createVolume());
    expect(normalizeVolume('x')).toEqual(createVolume());
    expect(normalizeVolume({ sound: 0, music: 4 })).toEqual(createVolume());
    expect(normalizeVolume({ sound: '3', music: 2.5 })).toEqual(createVolume());
    expect(normalizeVolume({ sound: 3 })).toEqual({ sound: 3, music: 2 });
  });
});
