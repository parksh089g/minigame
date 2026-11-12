import { describe, expect, it } from 'vitest';
import { SOUND_IDS, soundLength, SOUNDS, type Note } from './sound';

const notes = (id: (typeof SOUND_IDS)[number]): readonly Note[] => SOUNDS[id];

describe('새싹 컴퍼니 효과음', () => {
  it.each(SOUND_IDS)('%s: 음이 있고, 길이와 크기가 알맞다', (id) => {
    expect(notes(id).length).toBeGreaterThan(0);
    for (const note of notes(id)) {
      expect(note.d).toBeGreaterThan(0);
      expect(note.at ?? 0).toBeGreaterThanOrEqual(0);
      expect(note.v ?? 0.3).toBeGreaterThan(0);
      // 네모파와 톱니파는 같은 크기라도 세게 들리므로 작게 둔다.
      const loud = note.type === 'square' || note.type === 'sawtooth' ? 0.22 : 0.4;
      expect(note.v ?? 0.3).toBeLessThanOrEqual(loud);
    }
  });

  it.each(SOUND_IDS)('%s: 휴대폰 스피커로 들리는 높이 안에 있다', (id) => {
    for (const note of notes(id)) {
      for (const frequency of [note.f, note.to ?? note.f]) {
        expect(frequency).toBeGreaterThan(150);
        expect(frequency).toBeLessThan(2100);
      }
    }
  });

  it('자주 나는 소리는 짧고, 드문 소리도 일 초를 넘지 않는다', () => {
    for (const id of ['assign', 'cheer', 'done'] as const) expect(soundLength(id)).toBeLessThan(0.2);
    for (const id of SOUND_IDS) expect(soundLength(id)).toBeLessThanOrEqual(1);
  });
});
