/**
 * 새싹 컴퍼니의 효과음. 음 하나하나를 값으로 적어 두고, 실제로 소리를 내는 일은 씬이 core/sfx.ts의 tone()으로 한다.
 * 그래서 이 파일은 브라우저 없이도 테스트할 수 있다.
 *
 * 자주 나는 소리(맡기기, 응원, 업무 끝)는 짧고 작게, 드물게 나는 소리(출시, 이사)는 길고 또렷하게 둔다.
 */

/** 음 하나 */
export interface Note {
  /** 주파수(Hz) */
  f: number;
  /** 길이(초) */
  d: number;
  /** 파형. 안 주면 triangle */
  type?: OscillatorType;
  /** 크기 0~1. 안 주면 0.3 */
  v?: number;
  /** 끝날 때의 주파수. 주면 음높이가 미끄러진다. */
  to?: number;
  /** 몇 초 뒤에 낼지 */
  at?: number;
}

/** 같은 간격으로 이어지는 음들 */
const run = (notes: readonly number[], step: number, d: number, rest: Omit<Note, 'f' | 'd' | 'at'> = {}): Note[] =>
  notes.map((f, index) => ({ f, d, at: index * step, ...rest }));

export const SOUNDS = {
  /** 카드를 맡겼다: 톡 하고 올려놓는 소리 */
  assign: [{ f: 520, d: 0.04 }, { f: 780, d: 0.05, at: 0.04 }],
  /** 응원했다 */
  cheer: [{ f: 1320, d: 0.03, type: 'square', v: 0.16 }],
  /** 업무 하나가 끝났다 */
  done: [{ f: 880, d: 0.07, type: 'sine', v: 0.32 }, { f: 1320, d: 0.1, type: 'sine', v: 0.28, at: 0.06 }],
  /** 카드를 모두 끝내서 출시만 남았다 */
  ready: run([659, 784, 1047], 0.07, 0.11, { v: 0.32 }),
  /** 출시했다 */
  release: [...run([523, 659, 784, 1047, 1319], 0.08, 0.14, { v: 0.34 }), { f: 1568, d: 0.32, v: 0.3, at: 0.4 }],
  /** 장비를 올렸거나 교육했다 */
  upgrade: [{ f: 440, d: 0.11, to: 880, type: 'square', v: 0.16 }, { f: 1175, d: 0.09, at: 0.1 }],
  /** 새 친구가 들어왔거나 팀장을 두었다 */
  hire: run([587, 740, 880, 1175], 0.07, 0.11, { v: 0.32 }),
  /** 이사했다 */
  move: [...run([392, 523, 659, 784], 0.1, 0.16, { v: 0.34 }), { f: 1047, d: 0.4, v: 0.32, at: 0.4 }],
  /** 자회사를 세웠다: 이사보다 길게 올라가는 팡파르 */
  found: [...run([392, 523, 659, 784, 1047, 1319], 0.09, 0.15, { v: 0.34 }), { f: 1568, d: 0.45, v: 0.32, at: 0.54 }],
  /** 급한 의뢰가 들어왔다: 자명종 */
  rushIn: run([988, 784, 988, 784], 0.09, 0.07, { type: 'square', v: 0.16 }),
  /** 의뢰를 받았다 */
  rushStart: run([659, 988], 0.07, 0.09, { v: 0.3 }),
  /** 의뢰를 제때 끝냈다 */
  rushWon: run([784, 988, 1175, 1568], 0.07, 0.13, { v: 0.34 }),
  /** 의뢰를 놓쳤다 */
  rushLost: [{ f: 330, d: 0.3, to: 196, type: 'sawtooth', v: 0.2 }],
  /** 버그가 나왔다: 낮게 붕붕거리는 소리 */
  bug: [{ f: 220, d: 0.09, to: 180, type: 'sawtooth', v: 0.18 }, { f: 220, d: 0.09, to: 180, type: 'sawtooth', v: 0.18, at: 0.11 }],
  /** 버그를 잡았다: 톡 터지는 소리 */
  squash: [{ f: 520, d: 0.05, to: 240, type: 'square', v: 0.18 }, { f: 1175, d: 0.09, type: 'sine', v: 0.3, at: 0.05 }],
  /** 아이디어가 번뜩였다: 반짝 올라가는 소리 */
  idea: run([1047, 1319, 1568, 2093], 0.05, 0.09, { type: 'sine', v: 0.28 }),
  /** 코인이나 잎사귀를 받았다 */
  reward: run([1047, 1568], 0.06, 0.1, { type: 'sine', v: 0.32 }),
  /** 처음 안내가 떴다 */
  tip: [{ f: 660, d: 0.08, type: 'sine', v: 0.22 }, { f: 880, d: 0.1, type: 'sine', v: 0.2, at: 0.07 }],
} as const satisfies Record<string, readonly Note[]>;

export type SoundId = keyof typeof SOUNDS;
export const SOUND_IDS = Object.keys(SOUNDS) as SoundId[];

/** 소리가 처음부터 끝까지 나는 시간(초) */
export function soundLength(id: SoundId): number {
  return Math.max(...(SOUNDS[id] as readonly Note[]).map((note) => (note.at ?? 0) + note.d));
}
