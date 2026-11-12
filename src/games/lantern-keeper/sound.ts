/**
 * 등불지기의 효과음. 음 하나하나를 값으로 적어 두고, 실제로 소리를 내는 일은 밖에서 받은 함수에 맡긴다.
 * 그래서 이 파일은 브라우저 없이도 테스트할 수 있다.
 *
 * 한 판에 수백 번 나는 소리(빛 조각, 처치)는 짧고 작게, 드물게 나는 소리(보스, 진화, 끝)는 길고 또렷하게 둔다.
 */

/** 음 하나 */
export interface Note {
  /** 주파수(Hz) */
  f: number;
  /** 길이(초) */
  d: number;
  /** 파형. 안 주면 square */
  type?: OscillatorType;
  /** 크기 0~1. 안 주면 0.3 */
  v?: number;
  /** 끝날 때의 주파수. 주면 음높이가 미끄러진다. */
  to?: number;
  /** 몇 초 뒤에 낼지 */
  at?: number;
}

export type SoundId =
  | 'kill'
  | 'bossKill'
  | 'bossFall'
  | 'hurt'
  | 'heartbeat'
  | 'heal'
  | 'pull'
  | 'blast'
  | 'block'
  | 'spit'
  | 'burst'
  | 'post'
  | 'light'
  | 'dim'
  | 'levelUp'
  | 'ticket'
  | 'evolve'
  | 'boss'
  | 'elite'
  | 'chest'
  | 'surge'
  | 'windup'
  | 'dash'
  | 'charge'
  | 'volley'
  | 'strike'
  | 'bolt'
  | 'bell'
  | 'flint'
  | 'vent'
  | 'revive'
  | 'clear'
  | 'death';

/** 음을 차례로 늘어놓는다. step초 간격으로 하나씩. */
function run(freqs: readonly number[], step: number, d: number, rest: Omit<Note, 'f' | 'd' | 'at'> = {}, at = 0): Note[] {
  return freqs.map((f, index) => ({ f, d, at: at + index * step, ...rest }));
}

/** 큰 것이 무너지는 낮은 소리 */
const FALL: readonly Note[] = [
  { f: 170, to: 42, d: 0.5, type: 'sawtooth', v: 0.34 },
  { f: 85, to: 40, d: 0.4, v: 0.16 },
];

export const SOUNDS: Readonly<Record<SoundId, readonly Note[]>> = {
  // 그림자가 톡 하고 꺼진다. 가장 자주 나므로 가장 작다.
  kill: [{ f: 240, to: 110, d: 0.06, type: 'triangle', v: 0.22 }],
  // 중간 보스: 무너지는 소리 뒤에 밝은 음이 올라간다.
  bossKill: [
    ...FALL,
    ...run([523, 659, 784, 1047], 0.08, 0.14, { type: 'triangle', v: 0.34 }, 0.22),
    { f: 1319, d: 0.3, type: 'triangle', v: 0.3, at: 0.54 },
  ],
  // 마지막 보스: 무너지는 소리만 낸다. 밝은 음은 뒤따르는 새벽 소리가 맡는다.
  bossFall: FALL,
  hurt: [
    { f: 210, to: 70, d: 0.18, type: 'sawtooth', v: 0.36 },
    { f: 92, d: 0.08, v: 0.2 },
  ],
  // 쿵, 쿵. 휴대폰 스피커로도 들리게 너무 낮지 않은 삼각파로 낸다.
  heartbeat: [
    { f: 116, to: 82, d: 0.1, type: 'triangle', v: 0.36 },
    { f: 98, to: 70, d: 0.12, type: 'triangle', v: 0.28, at: 0.17 },
  ],
  heal: [
    { f: 659, d: 0.07, type: 'triangle', v: 0.3 },
    { f: 988, d: 0.16, type: 'triangle', v: 0.3, at: 0.07 },
  ],
  // 자석: 휘익 하고 빨려 들어오는 소리
  pull: [
    { f: 330, to: 1320, d: 0.28, type: 'triangle', v: 0.28 },
    { f: 1568, d: 0.1, v: 0.14, at: 0.26 },
  ],
  // 불꽃 단지: 펑 하고 터진 뒤에 불길이 번진다.
  blast: [
    { f: 220, to: 55, d: 0.34, type: 'sawtooth', v: 0.3 },
    { f: 880, to: 220, d: 0.22, type: 'triangle', v: 0.2 },
    { f: 110, to: 60, d: 0.3, v: 0.16, at: 0.12 },
  ],
  // 빛막이 피해를 튕겨 낸다: 맑게 쨍 하는 소리
  block: [
    { f: 1319, d: 0.05, type: 'triangle', v: 0.3 },
    { f: 1976, to: 1568, d: 0.18, type: 'triangle', v: 0.24, at: 0.04 },
  ],
  // 쏘는 적이 어둠 방울을 뱉는다: 작게 퉤 하는 소리
  spit: [{ f: 420, to: 180, d: 0.09, type: 'square', v: 0.12 }],
  // 터지는 적: 짧게 퍽 하고 터진다.
  burst: [
    { f: 300, to: 70, d: 0.16, type: 'sawtooth', v: 0.26 },
    { f: 620, to: 240, d: 0.1, type: 'triangle', v: 0.16 },
  ],
  // 등불 기둥이 나타났다: 멀리서 종이 두 번 울린다.
  post: [
    { f: 988, d: 0.14, type: 'triangle', v: 0.22 },
    { f: 1319, d: 0.24, type: 'triangle', v: 0.2, at: 0.14 },
  ],
  // 기둥에 불이 붙는다: 훅 하고 타오른 뒤 밝은 화음
  light: [
    { f: 196, to: 784, d: 0.22, type: 'sawtooth', v: 0.2 },
    { f: 784, d: 0.3, type: 'triangle', v: 0.26, at: 0.18 },
    { f: 1175, d: 0.3, type: 'triangle', v: 0.2, at: 0.18 },
  ],
  // 기둥이 다 탔다: 조용히 꺼진다.
  dim: [{ f: 523, to: 196, d: 0.3, type: 'triangle', v: 0.18 }],
  levelUp: [
    ...run([523, 659, 784, 1047], 0.06, 0.1, { v: 0.26 }),
    { f: 1319, d: 0.22, v: 0.24, at: 0.24 },
    { f: 659, d: 0.22, type: 'triangle', v: 0.22, at: 0.24 },
  ],
  ticket: [
    ...run([392, 523, 659, 784], 0.07, 0.11, { type: 'triangle', v: 0.32 }),
    { f: 1568, d: 0.06, v: 0.14, at: 0.3 },
    { f: 2093, d: 0.12, v: 0.12, at: 0.36 },
  ],
  // 낮은 데서 치솟은 뒤 화음이 한꺼번에 울린다.
  evolve: [
    { f: 196, to: 880, d: 0.36, type: 'sawtooth', v: 0.22 },
    { f: 880, d: 0.5, type: 'triangle', v: 0.3, at: 0.36 },
    { f: 1109, d: 0.46, type: 'triangle', v: 0.26, at: 0.4 },
    { f: 1319, d: 0.42, type: 'triangle', v: 0.26, at: 0.44 },
    { f: 1760, d: 0.4, v: 0.16, at: 0.48 },
  ],
  // 반음 어긋난 낮은 음 둘이 불길하게 깔린다.
  boss: [
    { f: 110, d: 0.36, type: 'sawtooth', v: 0.34 },
    { f: 104, d: 0.5, type: 'sawtooth', v: 0.34, at: 0.2 },
    { f: 55, d: 0.7, v: 0.16 },
  ],
  // 정예 그림자: 보스보다 짧고 가벼운 으르렁 소리
  elite: [
    { f: 147, d: 0.22, type: 'sawtooth', v: 0.28 },
    { f: 131, d: 0.3, type: 'sawtooth', v: 0.28, at: 0.14 },
  ],
  // 보물 상자: 뚜껑이 덜컥 열리고 반짝이는 소리가 올라간다.
  chest: [
    { f: 196, to: 131, d: 0.08, type: 'triangle', v: 0.3 },
    ...run([659, 784, 988, 1319], 0.06, 0.1, { type: 'triangle', v: 0.3 }, 0.08),
    { f: 1976, d: 0.16, v: 0.12, at: 0.32 },
  ],
  surge: run([330, 392, 330, 392], 0.09, 0.08, { v: 0.24 }),
  windup: [{ f: 130, to: 430, d: 0.55, type: 'sawtooth', v: 0.2 }],
  dash: [
    { f: 520, to: 110, d: 0.24, type: 'sawtooth', v: 0.28 },
    { f: 260, to: 70, d: 0.2, v: 0.12 },
  ],
  charge: [{ f: 380, to: 1240, d: 0.42, type: 'triangle', v: 0.26 }],
  volley: [{ f: 740, to: 330, d: 0.11, v: 0.24 }],
  strike: [{ f: 160, to: 62, d: 0.09, type: 'triangle', v: 0.26 }],
  bolt: [{ f: 1500, to: 520, d: 0.05, type: 'sawtooth', v: 0.12 }],
  // 종소리: 댕 하고 한 번 울린다. 몇 초마다 나므로 등불 기둥의 종보다 낮고 작게 둔다.
  bell: [
    { f: 659, d: 0.2, type: 'triangle', v: 0.18 },
    { f: 1319, to: 1305, d: 0.12, type: 'sine', v: 0.08 },
  ],
  // 불구멍: 훅 하고 불길이 솟는다. 화면에 여럿 있어서 작게 둔다.
  vent: [
    { f: 140, to: 420, d: 0.16, type: 'sawtooth', v: 0.12 },
    { f: 90, to: 60, d: 0.22, type: 'triangle', v: 0.14, at: 0.06 },
  ],
  // 부싯돌: 탁 하고 불꽃이 튄다.
  flint: [{ f: 980, to: 260, d: 0.05, type: 'square', v: 0.1 }],
  revive: [
    ...run([392, 523, 659, 784, 1047, 1319], 0.07, 0.14, { type: 'triangle', v: 0.32 }),
    { f: 1568, d: 0.3, v: 0.16, at: 0.42 },
  ],
  // 새벽: 밝게 올라가서 화음으로 끝난다.
  clear: [
    ...run([523, 659, 784, 1047], 0.12, 0.16, { type: 'triangle', v: 0.34 }),
    { f: 1319, d: 0.6, type: 'triangle', v: 0.32, at: 0.5 },
    { f: 1047, d: 0.6, type: 'triangle', v: 0.24, at: 0.5 },
    { f: 784, d: 0.6, v: 0.12, at: 0.5 },
    { f: 1568, d: 0.1, v: 0.12, at: 0.74 },
    { f: 2093, d: 0.24, v: 0.12, at: 0.84 },
  ],
  // 불이 꺼진다: 한 음씩 내려가다 낮게 가라앉는다.
  death: [
    ...run([440, 392, 330, 262], 0.17, 0.2, { type: 'triangle', v: 0.32 }),
    { f: 196, to: 98, d: 0.6, type: 'triangle', v: 0.3, at: 0.68 },
    { f: 98, to: 49, d: 0.6, v: 0.1, at: 0.68 },
  ],
};

/**
 * 같은 소리를 다시 낼 수 있을 때까지의 간격(ms). 한꺼번에 몰려 나는 소리가 뭉개지지 않게 한다.
 * 적혀 있지 않은 소리는 부를 때마다 난다.
 */
export const MIN_GAP_MS: Readonly<Partial<Record<SoundId, number>>> = {
  kill: 85,
  spit: 160,
  burst: 120,
  strike: 140,
  bolt: 170,
  flint: 150,
  vent: 450,
  volley: 200,
  charge: 200,
  windup: 200,
  dash: 200,
};

// ------------------------------------------------------------ 빛 조각

/** 빛 조각을 이어서 주울 때 올라가는 음계: 5음 음계라 어디서 끊겨도 듣기에 어긋나지 않는다. */
const GEM_SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19] as const;
const GEM_BASE = 784;
/** 이만큼(ms) 안에 다시 주우면 한 음 올라간다. 넘기면 처음 음으로 돌아간다. */
export const GEM_CHAIN_MS = 600;
/** 줍는 소리 사이의 가장 짧은 간격(ms) */
export const GEM_GAP_MS = 60;
export const GEM_STEPS = GEM_SCALE.length;

/** 이어서 주운 횟수(0부터)에 맞는 줍는 소리 */
export function gemNote(step: number): Note {
  const index = Math.min(Math.max(0, Math.floor(step)), GEM_SCALE.length - 1);
  return { f: GEM_BASE * 2 ** (GEM_SCALE[index] / 12), d: 0.05, type: 'triangle', v: 0.26 };
}

// ------------------------------------------------------------ 소리판

/** 소리를 낼지 말지를 정하는 판. 실제로 소리를 내는 함수와 지금 시각(ms)은 밖에서 받는다. */
export class SoundBoard {
  private readonly last = new Map<SoundId, number>();
  private gemStep = 0;
  private lastGem = -Infinity;

  constructor(private readonly emit: (note: Note) => void) {}

  /** 소리를 낸다. 너무 바로 다시 부르면 내지 않고 false를 돌려준다. delay초 뒤부터 나게 할 수도 있다. */
  play(id: SoundId, now: number, delay = 0): boolean {
    const gap = MIN_GAP_MS[id];
    if (gap !== undefined) {
      const last = this.last.get(id);
      if (last !== undefined && now - last < gap) return false;
      this.last.set(id, now);
    }
    for (const note of SOUNDS[id]) this.emit(delay > 0 ? { ...note, at: (note.at ?? 0) + delay } : note);
    return true;
  }

  /** 빛 조각을 주웠다. 이어서 주울수록 음이 올라간다. */
  gem(now: number): boolean {
    const since = now - this.lastGem;
    if (since < GEM_GAP_MS) return false;
    this.gemStep = since <= GEM_CHAIN_MS ? Math.min(this.gemStep + 1, GEM_STEPS - 1) : 0;
    this.lastGem = now;
    this.emit(gemNote(this.gemStep));
    return true;
  }
}
