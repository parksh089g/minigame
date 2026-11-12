/**
 * 움직임 줄이기를 Phaser의 화면 효과에 건다. 규칙은 motion.ts에 있다.
 * 게임마다 고치지 않고 카메라의 흔들기와 번쩍이기 효과가 시작되는 곳 한 군데를 감싸므로,
 * 지금 있는 게임과 앞으로 생길 게임에 모두 똑같이 듣는다.
 */
import Phaser from 'phaser';
import { flashAlpha, shakeIntensity, wantsReducedMotion } from './motion';

/** 지금 기기가 움직임을 줄여 달라고 하는지 */
export function reducedMotion(): boolean {
  return wantsReducedMotion(typeof window.matchMedia === 'function' ? (query) => window.matchMedia(query) : undefined);
}

type Shake = Phaser.Cameras.Scene2D.Effects.Shake;
type Flash = Phaser.Cameras.Scene2D.Effects.Flash;

let installed = false;

/** 앱을 시작할 때 한 번 부른다. */
export function initMotionGuard(): void {
  if (installed) return;
  installed = true;

  const shake = Phaser.Cameras.Scene2D.Effects.Shake.prototype;
  const startShake = shake.start;
  shake.start = function (this: Shake, duration, intensity, ...rest) {
    return startShake.call(this, duration, shakeIntensity(reducedMotion(), intensity), ...rest);
  };

  // 흐리게 해 둔 번쩍임의 원래 세기. 기기의 설정을 도로 끄면 이 값으로 되돌린다.
  const calmed = new WeakMap<Flash, number>();
  const flash = Phaser.Cameras.Scene2D.Effects.Flash.prototype;
  const startFlash = flash.start;
  flash.start = function (this: Flash, ...args) {
    // 이미 번쩍이는 중이면(억지로 다시 시작하는 것이 아니면) Phaser가 이 요청을 무시하므로 건드리지 않는다.
    const starts = args[4] === true || !this.isRunning;
    if (starts) {
      const original = calmed.get(this);
      if (reducedMotion()) {
        // 번쩍이는 도중의 값은 이미 흐려지고 있는 값이라 원래 세기로 적어 두지 않는다.
        if (original === undefined && !this.isRunning) calmed.set(this, this.alpha);
        this.alpha = flashAlpha(true, original ?? this.alpha);
      } else if (original !== undefined) {
        this.alpha = original;
        calmed.delete(this);
      }
    }
    return startFlash.apply(this, args);
  };
}
