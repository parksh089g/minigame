/**
 * 음원 파일 없이 Web Audio로 연주하는 배경 음악.
 * 악보(score.ts의 Song)를 받아서, 조금 앞의 소리까지만 미리 예약해 가며 끊김 없이 되풀이한다.
 * 씬이 프레임마다 tick()을 불러 주어야 이어지므로, 화면이 가려져 프레임이 멈추면 음악도 곧 멎는다.
 */
import { compile, STEPS_PER_BAR, type Compiled, type Drum, type Hit, type Song } from './score';
import { runningAudio } from './sfx';
import { store } from './store';

/** 음악 전체의 크기. 효과음(0.22) 아래에 깔리게 작게 둔다. */
const VOLUME = 0.11;
/** 이만큼(초) 앞의 소리까지 미리 예약한다. 프레임이 잠깐 밀려도 끊기지 않을 만큼이다. */
const AHEAD = 0.25;
/** 곡이 바뀌거나 멈출 때 흐려지는 시간(초) */
const FADE = 0.7;
/** 처음 시작할 때 커지는 시간(초) */
const RISE = 0.5;
/** 고르는 화면이 떠 있는 동안의 크기 비율 */
const HUSH = 0.4;
/** rest() 뒤에 이만큼(ms) tick()이 없으면 정말로 멈춘 것으로 본다. */
const REST_MS = 150;

class Music {
  private song: Song | null = null;
  private compiled: Compiled | null = null;
  /** 지금 곡이 흘러나가는 통로. 곡을 바꿀 때는 옛 통로를 흐리게 닫고 새 통로를 연다. */
  private bus: GainNode | null = null;
  private step = 0;
  private nextTime = 0;
  /** 곡마다 마지막으로 떠난 자리(마디의 첫 칸). 이어서 틀 때 쓴다. */
  private readonly left = new Map<Song, number>();
  private hushed = false;
  /** rest()가 걸어 둔 타이머. tick()이 다시 불리면 푼다. */
  private resting: number | null = null;
  private noise: { ctx: AudioContext; buffer: AudioBuffer } | null = null;

  /**
   * 이 곡을 되풀이해서 튼다. 이미 틀고 있는 곡이면 그대로 둔다.
   * resume을 주면 지난번에 이 곡을 떠난 마디에서 이어 가고, 안 주면 처음부터 튼다.
   */
  play(song: Song, options: { resume?: boolean } = {}): void {
    if (this.song === song) return;
    this.leave();
    this.close(FADE);
    this.song = song;
    this.compiled = compile(song);
    this.step = options.resume ? (this.left.get(song) ?? 0) : 0;
  }

  /** 음악을 멈춘다. 다시 틀려면 play()를 부른다. */
  stop(seconds: number = FADE): void {
    this.left.clear();
    this.close(seconds);
    this.song = null;
    this.compiled = null;
  }

  /**
   * 씬이 멈추거나 떠날 때 부른다. 곧바로 tick()이 다시 불리지 않으면 소리를 줄여 닫는다.
   * 곡과 자리는 그대로 두므로, 다시 tick()이 불리면 멈췄던 자리에서 이어진다.
   * (씬을 다시 그리느라 잠깐 끊긴 것이면 tick()이 바로 이어지므로 소리가 끊기지 않는다.)
   */
  rest(): void {
    if (this.resting !== null) return;
    this.resting = window.setTimeout(() => {
      this.resting = null;
      this.close(0.3);
    }, REST_MS);
  }

  /** 고르는 화면이 떠 있는 동안 음악을 작게 한다. */
  hush(on: boolean): void {
    if (this.hushed === on) return;
    this.hushed = on;
    const ctx = runningAudio();
    if (!ctx || !this.bus) return;
    this.ramp(ctx, this.bus, this.level(), 0.25);
  }

  /** 프레임마다 부른다. 곧 나올 소리를 예약한다. */
  tick(): void {
    if (this.resting !== null) {
      window.clearTimeout(this.resting);
      this.resting = null;
    }
    const compiled = this.compiled;
    if (!compiled) return;
    if (!store.data.settings.music) {
      this.close(0.2);
      return;
    }
    const ctx = runningAudio();
    if (!ctx) return;

    if (!this.bus) {
      this.bus = ctx.createGain();
      this.bus.gain.setValueAtTime(0, ctx.currentTime);
      this.bus.connect(ctx.destination);
      this.ramp(ctx, this.bus, this.level(), RISE);
      this.nextTime = ctx.currentTime + 0.06;
    }
    // 화면이 가려졌다 돌아오면 밀린 만큼을 한꺼번에 내지 않고, 멈췄던 자리에서 이어 간다.
    if (this.nextTime < ctx.currentTime) this.nextTime = ctx.currentTime + 0.06;

    while (this.nextTime < ctx.currentTime + AHEAD) {
      for (const hit of compiled.steps[this.step]) this.sound(ctx, this.bus, hit, this.nextTime);
      this.step = (this.step + 1) % compiled.steps.length;
      this.nextTime += compiled.stepSeconds;
    }
  }

  /** 지금 곡을 떠나기 전에, 어느 마디까지 왔는지 적어 둔다. */
  private leave(): void {
    if (this.song) this.left.set(this.song, this.step - (this.step % STEPS_PER_BAR));
  }

  private level(): number {
    return VOLUME * (this.hushed ? HUSH : 1);
  }

  private ramp(ctx: AudioContext, bus: GainNode, to: number, seconds: number): void {
    const now = ctx.currentTime;
    bus.gain.cancelScheduledValues(now);
    bus.gain.setValueAtTime(bus.gain.value, now);
    bus.gain.linearRampToValueAtTime(to, now + seconds);
  }

  /** 지금 통로를 흐리게 닫는다. 이미 예약된 소리는 그 사이에 함께 잦아든다. */
  private close(seconds: number): void {
    const bus = this.bus;
    if (!bus) return;
    this.bus = null;
    const ctx = runningAudio();
    if (!ctx) {
      bus.disconnect();
      return;
    }
    this.ramp(ctx, bus, 0, seconds);
    window.setTimeout(() => bus.disconnect(), (seconds + 0.2) * 1000);
  }

  private sound(ctx: AudioContext, bus: GainNode, hit: Hit, at: number): void {
    if (hit.kind === 'drum') this.drum(ctx, bus, hit.drum, hit.volume, at);
    else this.tone(ctx, bus, hit, at);
  }

  private tone(ctx: AudioContext, bus: GainNode, hit: Extract<Hit, { kind: 'tone' }>, at: number): void {
    const end = at + hit.seconds;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = hit.wave;
    oscillator.frequency.setValueAtTime(hit.frequency, at);

    gain.gain.setValueAtTime(0.0001, at);
    if (hit.soft) {
      // 부드럽게 올라와서 끝까지 머물다 내려간다.
      const edge = Math.min(0.08, hit.seconds / 3);
      gain.gain.linearRampToValueAtTime(hit.volume, at + edge);
      gain.gain.setValueAtTime(hit.volume, end - edge);
      gain.gain.linearRampToValueAtTime(0.0001, end);
    } else {
      // 퉁기듯 시작해서 잦아든다.
      gain.gain.linearRampToValueAtTime(hit.volume, at + 0.008);
      gain.gain.exponentialRampToValueAtTime(hit.volume * 0.3, end);
      gain.gain.linearRampToValueAtTime(0.0001, end + 0.03);
    }

    oscillator.connect(gain);
    gain.connect(bus);
    oscillator.start(at);
    oscillator.stop(end + 0.05);
  }

  private drum(ctx: AudioContext, bus: GainNode, drum: Drum, volume: number, at: number): void {
    if (drum === 'kick') {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(150, at);
      oscillator.frequency.exponentialRampToValueAtTime(46, at + 0.11);
      gain.gain.setValueAtTime(volume, at);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.14);
      oscillator.connect(gain);
      gain.connect(bus);
      oscillator.start(at);
      oscillator.stop(at + 0.16);
      return;
    }
    // 작은북과 심벌은 잡음을 걸러서 낸다.
    const seconds = drum === 'snare' ? 0.1 : 0.035;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(drum === 'snare' ? 1400 : 6500, at);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume * (drum === 'snare' ? 0.8 : 0.5), at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(bus);
    source.start(at);
    source.stop(at + seconds + 0.02);
  }

  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noise?.ctx === ctx) return this.noise.buffer;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.2), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
    this.noise = { ctx, buffer };
    return buffer;
  }
}

/** 앱 전체에서 하나만 쓰는 배경 음악 연주기 */
export const music = new Music();
