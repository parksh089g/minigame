/**
 * 배경 음악의 악보. 음 이름을 글로 적어 두면 여기서 "몇 번째 칸에 어떤 소리를 얼마나 길게"로 풀어 준다.
 * 소리를 실제로 내는 일은 music.ts가 맡으므로, 이 파일은 브라우저 없이도 테스트할 수 있다.
 *
 * 한 마디는 16칸(16분음표)이다. 칸마다 토큰 하나를 띄어 적는다.
 *   a3, c#4, eb5   그 칸에서 음을 낸다
 *   -              앞의 음을 한 칸 더 끈다
 *   .              쉰다
 *   a3*4, .*8      같은 것을 여러 칸: a3*4는 `a3 - - -`, .*8은 여덟 칸 쉼
 * 북은 칸마다 글자 하나로 적는다(띄어쓰기는 무시한다): k 큰북, s 작은북, h 심벌, . 쉼
 */

export const STEPS_PER_BAR = 16;

export type Drum = 'kick' | 'snare' | 'hat';

/** 한 성부: 같은 음색으로 이어지는 한 줄의 가락 */
export interface Voice {
  wave: OscillatorType;
  /** 크기 0~1 */
  volume: number;
  /** 적힌 길이 가운데 실제로 울리는 비율. 안 주면 0.9. 작을수록 짧게 끊긴다. */
  gate?: number;
  /** 부드럽게 시작해서 끝까지 이어지는 소리. 안 주면 퉁기듯 시작해서 잦아든다. */
  soft?: boolean;
  /** 마디마다의 악보. 곡의 마디 수보다 적으면 처음부터 되풀이된다. */
  bars: readonly string[];
}

export interface Song {
  /** 1분에 4분음표가 몇 번인지 */
  bpm: number;
  /** 마디 수. 이만큼 연주하고 처음으로 돌아간다. */
  bars: number;
  voices: readonly Voice[];
  /** 마디마다의 북. 곡의 마디 수보다 적으면 처음부터 되풀이된다. */
  drums?: readonly string[];
  /** 북의 크기 0~1. 안 주면 0.5 */
  drumVolume?: number;
  /** 모든 음을 반음 몇 개만큼 올리거나 내린다. 같은 악보를 다른 높이로 쓸 때 준다. */
  transpose?: number;
}

/** 어느 칸에서 시작하는 소리 하나 */
export type Hit =
  | { kind: 'tone'; wave: OscillatorType; volume: number; frequency: number; seconds: number; soft: boolean }
  | { kind: 'drum'; drum: Drum; volume: number };

/** 연주할 수 있게 풀어 놓은 곡 */
export interface Compiled {
  /** 한 칸의 길이(초) */
  stepSeconds: number;
  /** 칸마다 그 칸에서 시작하는 소리들 */
  steps: readonly (readonly Hit[])[];
}

const SEMITONE: Readonly<Record<string, number>> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const DRUM: Readonly<Record<string, Drum>> = { k: 'kick', s: 'snare', h: 'hat' };

/** 음 이름(a4, c#3, eb5)의 MIDI 번호. a4가 69다. */
export function midiOf(name: string): number {
  const match = /^([a-g])([#b]?)(\d)$/.exec(name);
  if (!match) throw new Error(`음 이름이 아니다: "${name}"`);
  const accidental = match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0;
  return 12 * (Number(match[3]) + 1) + SEMITONE[match[1]] + accidental;
}

export function frequencyOf(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** 한 마디의 글을 칸마다의 토큰으로 푼다. 16칸이 아니면 악보가 틀린 것이다. */
export function tokensOf(bar: string): string[] {
  const tokens: string[] = [];
  for (const word of bar.trim().split(/\s+/)) {
    const [head, times] = word.split('*');
    const count = times === undefined ? 1 : Number(times);
    if (!Number.isInteger(count) || count < 1) throw new Error(`칸 수가 아니다: "${word}"`);
    tokens.push(head);
    for (let index = 1; index < count; index += 1) tokens.push(head === '.' ? '.' : '-');
  }
  if (tokens.length !== STEPS_PER_BAR) {
    throw new Error(`한 마디는 ${STEPS_PER_BAR}칸인데 ${tokens.length}칸이다: "${bar}"`);
  }
  return tokens;
}

/** 곡 전체의 길이(초) */
export function lengthOf(song: Song): number {
  return (song.bars * STEPS_PER_BAR * 60) / song.bpm / 4;
}

/** 악보를 칸마다의 소리로 푼다. 음은 마디를 넘어서도 이어지지만, 곡의 끝에서는 끊긴다. */
export function compile(song: Song): Compiled {
  const total = song.bars * STEPS_PER_BAR;
  const stepSeconds = 60 / song.bpm / 4;
  const steps: Hit[][] = Array.from({ length: total }, () => []);

  for (const voice of song.voices) {
    const tokens: string[] = [];
    for (let bar = 0; bar < song.bars; bar += 1) tokens.push(...tokensOf(voice.bars[bar % voice.bars.length]));
    let index = 0;
    while (index < total) {
      const token = tokens[index];
      if (token === '.' || token === '-') {
        index += 1;
        continue;
      }
      let length = 1;
      while (index + length < total && tokens[index + length] === '-') length += 1;
      steps[index].push({
        kind: 'tone',
        wave: voice.wave,
        volume: voice.volume,
        frequency: frequencyOf(midiOf(token) + (song.transpose ?? 0)),
        seconds: length * stepSeconds * (voice.gate ?? 0.9),
        soft: voice.soft ?? false,
      });
      index += length;
    }
  }

  const drums = song.drums;
  if (drums && drums.length > 0) {
    for (let bar = 0; bar < song.bars; bar += 1) {
      const pattern = drums[bar % drums.length].replace(/\s+/g, '');
      if (pattern.length !== STEPS_PER_BAR) {
        throw new Error(`북도 한 마디가 ${STEPS_PER_BAR}칸이다: "${drums[bar % drums.length]}"`);
      }
      [...pattern].forEach((mark, index) => {
        if (mark === '.') return;
        const drum = DRUM[mark];
        if (!drum) throw new Error(`북 글자가 아니다: "${mark}"`);
        steps[bar * STEPS_PER_BAR + index].push({ kind: 'drum', drum, volume: song.drumVolume ?? 0.5 });
      });
    }
  }

  return { stepSeconds, steps };
}
