import { describe, expect, it } from 'vitest';
import { compile, frequencyOf, lengthOf, midiOf, STEPS_PER_BAR, tokensOf, type Song } from '../../core/score';
import { SONGS } from './music';

const NAMES = Object.keys(SONGS) as (keyof typeof SONGS)[];

/** 곡에 적힌 음을 모두 MIDI 번호로 모은다. */
function notesOf(song: Song): number[] {
  const notes: number[] = [];
  for (const voice of song.voices) {
    for (const bar of voice.bars) {
      for (const token of tokensOf(bar)) if (token !== '.' && token !== '-') notes.push(midiOf(token));
    }
  }
  return notes;
}

/** 다장조의 음 */
const C_MAJOR = new Set(['c', 'd', 'e', 'f', 'g', 'a', 'b'].map((name) => midiOf(`${name}4`) % 12));

describe('새싹 컴퍼니 배경 음악', () => {
  it.each(NAMES)('%s: 악보가 틀리지 않고 풀린다', (name) => {
    const song = SONGS[name];
    const compiled = compile(song);
    expect(compiled.steps).toHaveLength(song.bars * STEPS_PER_BAR);
    expect(compiled.steps[0].length).toBeGreaterThan(0);
  });

  it.each(NAMES)('%s: 성부와 북의 마디 수가 곡의 마디 수와 맞아떨어진다', (name) => {
    const song = SONGS[name];
    for (const voice of song.voices) {
      expect(voice.bars.length).toBeGreaterThan(0);
      expect(song.bars % voice.bars.length).toBe(0);
    }
    if (song.drums) expect(song.bars % song.drums.length).toBe(0);
  });

  it.each(NAMES)('%s: 모든 음이 다장조 안에 있다', (name) => {
    expect(notesOf(SONGS[name]).filter((midi) => !C_MAJOR.has(midi % 12))).toEqual([]);
  });

  it.each(NAMES)('%s: 휴대폰 스피커로 들리는 높이 안에 있다', (name) => {
    const song = SONGS[name];
    const frequencies = notesOf(song).map((midi) => frequencyOf(midi + (song.transpose ?? 0)));
    expect(Math.min(...frequencies)).toBeGreaterThan(80);
    expect(Math.max(...frequencies)).toBeLessThan(2100);
  });

  it.each(NAMES)('%s: 성부마다 소리가 너무 크지 않다', (name) => {
    for (const voice of SONGS[name].voices) {
      expect(voice.volume).toBeGreaterThan(0);
      // 네모파는 같은 크기라도 훨씬 세게 들리므로 작게 둔다.
      expect(voice.volume).toBeLessThanOrEqual(voice.wave === 'square' ? 0.12 : 0.6);
    }
  });

  it.each(NAMES)('%s: 오래 켜 두어도 질리지 않게 한 바퀴가 너무 짧지 않다', (name) => {
    expect(lengthOf(SONGS[name])).toBeGreaterThan(15);
  });
});
