import { describe, expect, it } from 'vitest';
import { compile, frequencyOf, lengthOf, midiOf, STEPS_PER_BAR, tokensOf, type Song } from '../../core/score';
import { STAGE_ORDER } from './data';
import { BOSS_SONG, FINAL_SONG, SONGS, STAGE_SONGS } from './music';

const NAMES = Object.keys(SONGS) as (keyof typeof SONGS)[];

/** 곡에 적힌 음을 모두 MIDI 번호로 모은다(옮기기 전의 높이). */
function notesOf(song: Song): number[] {
  const notes: number[] = [];
  for (const voice of song.voices) {
    for (const bar of voice.bars) {
      for (const token of tokensOf(bar)) if (token !== '.' && token !== '-') notes.push(midiOf(token));
    }
  }
  return notes;
}

/** 음계에 드는 음 이름을 12음 가운데의 자리로 */
const scale = (...names: string[]): Set<number> => new Set(names.map((name) => midiOf(`${name}4`) % 12));

/** 곡마다 쓰는 음. 단조 곡은 딸림화음의 올린 음을 함께 쓴다. */
const SCALES: Readonly<Record<keyof typeof SONGS, Set<number>>> = {
  lobby: scale('c', 'd', 'e', 'f', 'g', 'a', 'b'),
  meadow: scale('a', 'b', 'c', 'd', 'e', 'f', 'g', 'g#'),
  marsh: scale('d', 'e', 'f', 'g', 'a', 'bb', 'c', 'c#', 'eb'),
  boss: scale('e', 'f#', 'g', 'a', 'b', 'c', 'd', 'd#', 'c#', 'f'),
  final: scale('e', 'f#', 'g', 'a', 'b', 'c', 'd', 'd#', 'c#', 'f'),
};

describe('등불지기 배경 음악', () => {
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

  it.each(NAMES)('%s: 모든 음이 그 곡의 음계 안에 있다', (name) => {
    const strays = notesOf(SONGS[name]).filter((midi) => !SCALES[name].has(midi % 12));
    expect(strays).toEqual([]);
  });

  it.each(NAMES)('%s: 휴대폰 스피커로 들리는 높이 안에 있다', (name) => {
    const song = SONGS[name];
    const frequencies = notesOf(song).map((midi) => frequencyOf(midi + (song.transpose ?? 0)));
    expect(Math.min(...frequencies)).toBeGreaterThan(80);
    expect(Math.max(...frequencies)).toBeLessThan(2100);
  });

  it.each(NAMES)('%s: 성부마다 소리가 너무 크지 않다', (name) => {
    const song = SONGS[name];
    for (const voice of song.voices) {
      expect(voice.volume).toBeGreaterThan(0);
      // 네모파는 같은 크기라도 훨씬 세게 들리므로 작게 둔다.
      expect(voice.volume).toBeLessThanOrEqual(voice.wave === 'square' ? 0.12 : 0.6);
    }
  });

  it.each(NAMES)('%s: 한 칸에서 한 성부가 음을 둘 이상 시작하지 않는다', (name) => {
    const song = SONGS[name];
    const compiled = compile(song);
    for (const hits of compiled.steps) {
      const tones = hits.filter((hit) => hit.kind === 'tone');
      expect(tones.length).toBeLessThanOrEqual(song.voices.length);
    }
  });

  it('스테이지마다 곡이 있고 서로 다르다', () => {
    const songs = STAGE_ORDER.map((stage) => STAGE_SONGS[stage]);
    expect(songs.every(Boolean)).toBe(true);
    expect(new Set(songs).size).toBe(STAGE_ORDER.length);
    expect(new Set(songs.map((song) => song.bpm)).size).toBe(STAGE_ORDER.length);
  });

  it('스테이지의 곡은 한 바퀴가 넉넉히 길어서 금방 되풀이되지 않는다', () => {
    for (const stage of STAGE_ORDER) expect(lengthOf(STAGE_SONGS[stage])).toBeGreaterThan(45);
  });

  it('마지막 보스는 보스의 곡을 더 빠르고 높게 연주한다', () => {
    expect(FINAL_SONG.voices).toBe(BOSS_SONG.voices);
    expect(FINAL_SONG.bpm).toBeGreaterThan(BOSS_SONG.bpm);
    expect(FINAL_SONG.transpose ?? 0).toBeGreaterThan(BOSS_SONG.transpose ?? 0);
  });
});
