import { describe, expect, it } from 'vitest';
import { compile, frequencyOf, lengthOf, midiOf, STEPS_PER_BAR, tokensOf, type Song } from './score';

describe('음 이름', () => {
  it('a4는 69번, 440Hz다', () => {
    expect(midiOf('a4')).toBe(69);
    expect(frequencyOf(69)).toBe(440);
  });

  it('올림표와 내림표를 읽는다', () => {
    expect(midiOf('c4')).toBe(60);
    expect(midiOf('c#4')).toBe(61);
    expect(midiOf('eb4')).toBe(63);
    expect(midiOf('bb3')).toBe(58);
    expect(midiOf('b3')).toBe(59);
  });

  it('한 옥타브 위는 주파수가 두 배다', () => {
    expect(frequencyOf(midiOf('a5'))).toBeCloseTo(880);
    expect(frequencyOf(midiOf('a2'))).toBeCloseTo(110);
  });

  it('음 이름이 아니면 알린다', () => {
    expect(() => midiOf('h4')).toThrow();
    expect(() => midiOf('a')).toThrow();
  });
});

describe('한 마디 읽기', () => {
  it('칸마다 토큰 하나로 푼다', () => {
    expect(tokensOf('a3 . . . e3 - - - . . . . c4 . . .')).toHaveLength(STEPS_PER_BAR);
  });

  it('*n은 같은 것을 여러 칸으로 편다', () => {
    expect(tokensOf('a3*4 .*4 e3*8')).toEqual([
      'a3', '-', '-', '-',
      '.', '.', '.', '.',
      'e3', '-', '-', '-', '-', '-', '-', '-',
    ]);
  });

  it('16칸이 아니면 알린다', () => {
    expect(() => tokensOf('a3 . .')).toThrow();
    expect(() => tokensOf('a3*17')).toThrow();
    expect(() => tokensOf('a3*0 .*16')).toThrow();
  });
});

describe('곡 풀기', () => {
  const song: Song = {
    bpm: 120,
    bars: 2,
    voices: [
      { wave: 'triangle', volume: 0.5, gate: 1, bars: ['a3*8 e3*8', 'c4*16'] },
      { wave: 'square', volume: 0.2, bars: ['a4 . . . a4 . . . a4 . . . a4 . . .'] },
    ],
    drums: ['k... h... s... h...'],
    drumVolume: 0.4,
  };

  it('한 칸은 16분음표 길이다', () => {
    const compiled = compile(song);
    expect(compiled.stepSeconds).toBeCloseTo(0.125);
    expect(compiled.steps).toHaveLength(2 * STEPS_PER_BAR);
    expect(lengthOf(song)).toBeCloseTo(4);
  });

  it('끈 만큼 음이 길어진다', () => {
    const compiled = compile(song);
    const first = compiled.steps[0].find((hit) => hit.kind === 'tone' && hit.wave === 'triangle');
    expect(first).toMatchObject({ frequency: frequencyOf(midiOf('a3')), seconds: 1 });
    const whole = compiled.steps[STEPS_PER_BAR].find((hit) => hit.kind === 'tone' && hit.wave === 'triangle');
    expect(whole).toMatchObject({ seconds: 2 });
    // 끄는 칸에서는 새 음이 시작하지 않는다
    expect(compiled.steps[1].some((hit) => hit.kind === 'tone' && hit.wave === 'triangle')).toBe(false);
  });

  it('마디 수가 모자란 성부는 처음부터 되풀이된다', () => {
    const compiled = compile(song);
    const squares = compiled.steps.map((hits) => hits.filter((hit) => hit.kind === 'tone' && hit.wave === 'square').length);
    expect(squares.reduce((sum, count) => sum + count, 0)).toBe(8);
    expect(squares[0]).toBe(1);
    expect(squares[STEPS_PER_BAR]).toBe(1);
  });

  it('gate를 안 주면 조금 짧게 끊긴다', () => {
    const compiled = compile(song);
    const square = compiled.steps[0].find((hit) => hit.kind === 'tone' && hit.wave === 'square');
    expect(square).toMatchObject({ seconds: 0.125 * 0.9, soft: false });
  });

  it('북은 적힌 칸에서만 난다', () => {
    const compiled = compile(song);
    const drums = compiled.steps.map((hits) => hits.filter((hit) => hit.kind === 'drum'));
    expect(drums[0]).toEqual([{ kind: 'drum', drum: 'kick', volume: 0.4 }]);
    expect(drums[4]).toEqual([{ kind: 'drum', drum: 'hat', volume: 0.4 }]);
    expect(drums[8]).toEqual([{ kind: 'drum', drum: 'snare', volume: 0.4 }]);
    expect(drums[1]).toEqual([]);
    expect(drums.flat()).toHaveLength(8);
  });

  it('음은 곡의 끝에서 끊긴다', () => {
    const compiled = compile({ bpm: 120, bars: 1, voices: [{ wave: 'sine', volume: 1, gate: 1, bars: ['.*12 a3*4'] }] });
    expect(compiled.steps[12][0]).toMatchObject({ seconds: 0.5 });
  });

  it('transpose만큼 모든 음이 옮겨진다', () => {
    const up = compile({ ...song, transpose: 12 });
    const first = up.steps[0].find((hit) => hit.kind === 'tone' && hit.wave === 'triangle');
    expect(first).toMatchObject({ frequency: frequencyOf(midiOf('a4')) });
  });

  it('틀린 악보는 알린다', () => {
    expect(() => compile({ bpm: 120, bars: 1, voices: [{ wave: 'sine', volume: 1, bars: ['a3 . .'] }] })).toThrow();
    expect(() => compile({ bpm: 120, bars: 1, voices: [], drums: ['k...'] })).toThrow();
    expect(() => compile({ bpm: 120, bars: 1, voices: [], drums: ['x... .... .... ....'] })).toThrow();
  });
});
