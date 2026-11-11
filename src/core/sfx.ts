/**
 * 음원 파일 없이 Web Audio 오실레이터로 만드는 칩튠 효과음.
 * 파일이 없으니 오프라인에서도 그대로 동작하고 용량도 들지 않는다.
 */
import { store } from './store';

type AudioContextCtor = typeof AudioContext;

let context: AudioContext | null = null;
let master: GainNode | null = null;

function getContext(): AudioContext | null {
  if (context) return context;
  const Ctor: AudioContextCtor | undefined =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    context = new Ctor();
    master = context.createGain();
    master.gain.value = 0.22;
    master.connect(context.destination);
  } catch {
    context = null;
    master = null;
  }
  return context;
}

/**
 * 모바일 브라우저는 사용자가 화면을 건드린 뒤에야 소리를 낼 수 있다.
 * 터치가 있을 때마다 오디오 컨텍스트를 깨운다(전화·알림 뒤에 다시 잠기는 경우 포함).
 */
export function initAudioUnlock(): void {
  const unlock = (): void => {
    const ctx = getContext();
    if (ctx && ctx.state !== 'running') void ctx.resume().catch(() => undefined);
  };
  window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
  window.addEventListener('keydown', unlock, { capture: true, passive: true });
}

interface ToneOptions {
  type?: OscillatorType;
  /** 0~1 */
  volume?: number;
  /** 끝날 때의 주파수. 주면 음높이가 미끄러진다. */
  slideTo?: number;
  /** 지금부터 몇 초 뒤에 낼지 */
  delay?: number;
}

function tone(frequency: number, duration: number, options: ToneOptions = {}): void {
  if (!store.data.settings.sound) return;
  const ctx = getContext();
  if (!ctx || !master || ctx.state !== 'running') return;

  const start = ctx.currentTime + (options.delay ?? 0);
  const end = start + duration;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();

  oscillator.type = options.type ?? 'square';
  oscillator.frequency.setValueAtTime(frequency, start);
  if (options.slideTo) oscillator.frequency.exponentialRampToValueAtTime(options.slideTo, end);

  const volume = options.volume ?? 0.5;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);

  oscillator.connect(gain);
  gain.connect(master);
  oscillator.start(start);
  oscillator.stop(end + 0.02);
}

function arpeggio(notes: number[], step: number, duration: number, options: ToneOptions = {}): void {
  notes.forEach((note, index) => tone(note, duration, { ...options, delay: index * step }));
}

/** 반음 n개만큼 올린 주파수 */
const semitones = (base: number, n: number): number => base * 2 ** (n / 12);

export const sfx = {
  /** 버튼 누름 */
  click: (): void => tone(660, 0.05, { volume: 0.3 }),
  /** 명중. 콤보가 이어질수록 음이 올라간다. */
  hit: (combo: number): void => {
    const pitch = semitones(523.25, Math.min(combo, 14));
    tone(pitch, 0.07, { volume: 0.4 });
    tone(pitch * 2, 0.05, { volume: 0.15, type: 'triangle', delay: 0.02 });
  },
  /** 금색 구슬 명중 */
  gold: (): void => arpeggio([784, 988, 1175, 1568], 0.045, 0.09, { volume: 0.35 }),
  /** 빈 곳을 누름 */
  miss: (): void => tone(170, 0.14, { type: 'sawtooth', slideTo: 80, volume: 0.35 }),
  /** 구슬이 사라짐 */
  expire: (): void => tone(196, 0.07, { type: 'triangle', volume: 0.3 }),
  /** 카드 뒤집기 */
  flip: (): void => tone(540, 0.04, { type: 'triangle', volume: 0.3 }),
  /** 점프 */
  jump: (): void => tone(330, 0.1, { slideTo: 700, volume: 0.28 }),
  /** 착지 */
  land: (): void => tone(120, 0.05, { type: 'triangle', volume: 0.3 }),
  /** 카운트다운 */
  count: (): void => tone(440, 0.09, { volume: 0.3 }),
  /** 시작 */
  go: (): void => tone(880, 0.2, { volume: 0.35 }),
  /** 시간이 얼마 안 남았을 때 */
  tick: (): void => tone(1320, 0.03, { volume: 0.2 }),
  /** 게임 종료 */
  finish: (): void => arpeggio([659, 523, 392], 0.11, 0.14, { volume: 0.35 }),
  /** 신기록 */
  fanfare: (): void => arpeggio([523, 659, 784, 1047, 1319], 0.08, 0.16, { volume: 0.35 }),
  /** 코인 획득 */
  coin: (): void => {
    tone(988, 0.06, { volume: 0.3 });
    tone(1319, 0.14, { volume: 0.3, delay: 0.06 });
  },
  /** 할 수 없는 동작 */
  deny: (): void => arpeggio([220, 185], 0.07, 0.09, { type: 'sawtooth', volume: 0.3 }),
};
